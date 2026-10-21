-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261102b — Bonuri de consum: salvarea tranzacțională (antet + linii într-o singură tranzacție)
-- Decizia Razvan 21.10.2026 (Codex r4 pct. 3 pe PR #806): RPC tranzacțional pentru salvarea bonurilor, ACUM, separat de
-- registrul E2a (20261102a) — poate fi revizuită și aplicată independent.
--
-- Ce face: public.fn_bon_salveaza(p_bon_id, p_versiune, p_antet, p_linii) → jsonb {bon_id, updated_at, linii, idempotent}
--   • bon nou (p_bon_id NULL): antet + linii într-o tranzacție (fără antet orfan); numărul bonului vine din client și e
--     cheia de idempotență (lock pe (proiect, număr); același număr cu ACELAȘI conținut = răspunsul anterior, alt conținut =
--     eroare „număr folosit”);
--   • bon existent: CAS pe updated_at (p_versiune) → UPDATE antet → liniile vechi șterse (numărate) → liniile noi inserate;
--     versiune veche + conținut identic cu cel salvat = idempotent (retry după răspuns pierdut, fără dubluri); versiune
--     veche + alt conținut = eroare „modificat între timp” (40001);
--   • SECURITY INVOKER, search_path fix: RLS-ul apelantului rămâne în vigoare, nicio permisiune în plus; gărzile E2a pe
--     linii (bucățile din registrul de țeavă) se aplică la fel.
-- Ce NU face: nicio dată, nicio schimbare de schemă pe tabelele bonurilor, niciun drept pentru oameni.
-- LIVRARE: doar prin scripts/livrare_migrare.sh. Revenire: supabase/revenire/20261102b_bon_salvare_tranzactionala_ROLLBACK.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $migrare$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261102b_bon_salvare_tranzactionala:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261102b: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── precondiții ───────────────────────────────────────────────────────────────────────────────────────
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_bon_salveaza') THEN
    RAISE EXCEPTION 'Precondiție 0b: public.fn_bon_salveaza există deja';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns c
       JOIN (VALUES ('executie_bonuri_consum','id','bigint'), ('executie_bonuri_consum','numar_bon','text'),
                    ('executie_bonuri_consum','proiect_id','bigint'), ('executie_bonuri_consum','situatie_plata_id','bigint'),
                    ('executie_bonuri_consum','provenienta','text'), ('executie_bonuri_consum','data_bon','date'),
                    ('executie_bonuri_consum','sursa','text'), ('executie_bonuri_consum','stare','text'),
                    ('executie_bonuri_consum','generat_de','uuid'), ('executie_bonuri_consum','observatii','text'),
                    ('executie_bonuri_consum','updated_at','timestamp with time zone'),
                    ('executie_bonuri_consum_linii','bon_id','bigint'), ('executie_bonuri_consum_linii','magazie_bucata_id','bigint'),
                    ('executie_bonuri_consum_linii','tip_material_id','integer'), ('executie_bonuri_consum_linii','denumire','text'),
                    ('executie_bonuri_consum_linii','serie','text'), ('executie_bonuri_consum_linii','sarja','text'),
                    ('executie_bonuri_consum_linii','dimensiune','text'), ('executie_bonuri_consum_linii','cantitate','numeric'),
                    ('executie_bonuri_consum_linii','um','text'), ('executie_bonuri_consum_linii','lungime_m','numeric'),
                    ('executie_bonuri_consum_linii','cost_unitar','numeric'), ('executie_bonuri_consum_linii','valoare','numeric'),
                    ('executie_bonuri_consum_linii','observatii','text')) x(t, col, tip)
         ON c.table_schema = 'public' AND c.table_name = x.t AND c.column_name = x.col AND c.data_type = x.tip) <> 24 THEN
    RAISE EXCEPTION 'Precondiție 0c: coloanele bonurilor diferă de forma live (21.10.2026)';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.executie_bonuri_consum'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.executie_bonuri_consum_linii'::regclass) THEN
    RAISE EXCEPTION 'Precondiție 0d: RLS inactiv pe tabelele bonurilor';
  END IF;
  IF has_schema_privilege('authenticated', 'public', 'CREATE') OR has_schema_privilege('anon', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Precondiție 0e: anon/authenticated au CREATE pe schema public';
  END IF;

  -- ── funcția ──────────────────────────────────────────────────────────────────────────────────────────
  CREATE FUNCTION public.fn_bon_salveaza(p_bon_id bigint, p_versiune timestamptz, p_antet jsonb, p_linii jsonb) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE
    v_id bigint := p_bon_id; v_ver timestamptz; v_numar text; v_pid bigint; v_cerut jsonb; v_curent jsonb;
    v_antet_cerut jsonb; v_antet_curent jsonb; v_vechi int; v_sterse int; v_n int;
  BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'bon: neautentificat' USING ERRCODE = '42501'; END IF;
    IF jsonb_typeof(p_antet) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'bon: antetul trebuie să fie obiect'; END IF;
    IF jsonb_typeof(p_linii) IS DISTINCT FROM 'array' OR jsonb_array_length(p_linii) = 0 THEN
      RAISE EXCEPTION 'bon: bonul cere cel puțin o linie';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_linii) l WHERE jsonb_typeof(l) IS DISTINCT FROM 'object') THEN
      RAISE EXCEPTION 'bon: fiecare linie trebuie să fie obiect';
    END IF;
    -- liniile în formă canonică (aceeași pentru inserare și pentru comparația de idempotență)
    SELECT coalesce(jsonb_agg(x ORDER BY x::text), '[]'::jsonb) INTO v_cerut FROM (
      SELECT jsonb_build_object(
        'magazie_bucata_id', (l->>'magazie_bucata_id')::bigint, 'tip_material_id', (l->>'tip_material_id')::integer,
        'denumire', nullif(btrim(l->>'denumire'), ''), 'serie', nullif(btrim(l->>'serie'), ''),
        'sarja', nullif(btrim(l->>'sarja'), ''), 'dimensiune', nullif(btrim(l->>'dimensiune'), ''),
        'cantitate', (l->>'cantitate')::numeric, 'um', coalesce(nullif(btrim(l->>'um'), ''), 'buc'),
        'lungime_m', (l->>'lungime_m')::numeric, 'cost_unitar', (l->>'cost_unitar')::numeric,
        'observatii', nullif(btrim(l->>'observatii'), '')) AS x
      FROM jsonb_array_elements(p_linii) l) z;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_cerut) x
                WHERE (x->>'cantitate') IS NULL OR (x->>'cantitate')::numeric <= 0
                   OR ((x->>'denumire') IS NULL AND (x->>'tip_material_id') IS NULL)) THEN
      RAISE EXCEPTION 'bon: fiecare linie cere cantitate > 0 și denumire sau tip de material';
    END IF;
    v_antet_cerut := jsonb_build_object('situatie_plata_id', (p_antet->>'situatie_plata_id')::bigint,
      'provenienta', p_antet->>'provenienta', 'data_bon', (p_antet->>'data_bon')::date,
      'observatii', nullif(btrim(p_antet->>'observatii'), ''));

    IF v_id IS NULL THEN
      -- ── bon nou: numărul (din client) e cheia de idempotență ──
      v_numar := nullif(btrim(p_antet->>'numar_bon'), '');
      v_pid := (p_antet->>'proiect_id')::bigint;
      IF v_numar IS NULL OR v_pid IS NULL THEN RAISE EXCEPTION 'bon: bonul nou cere proiect_id și numar_bon'; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('fn_bon_salveaza:' || v_pid || ':' || v_numar, 0));
      SELECT b.id, b.updated_at INTO v_id, v_ver FROM public.executie_bonuri_consum b
       WHERE b.proiect_id = v_pid AND b.numar_bon = v_numar ORDER BY b.id LIMIT 1;
      IF FOUND THEN
        SELECT jsonb_build_object('situatie_plata_id', b.situatie_plata_id, 'provenienta', b.provenienta, 'data_bon', b.data_bon,
                                  'observatii', b.observatii) INTO v_antet_curent FROM public.executie_bonuri_consum b WHERE b.id = v_id;
        SELECT coalesce(jsonb_agg(x ORDER BY x::text), '[]'::jsonb) INTO v_curent FROM (
          SELECT jsonb_build_object('magazie_bucata_id', l.magazie_bucata_id, 'tip_material_id', l.tip_material_id, 'denumire', l.denumire,
            'serie', l.serie, 'sarja', l.sarja, 'dimensiune', l.dimensiune, 'cantitate', l.cantitate, 'um', l.um,
            'lungime_m', l.lungime_m, 'cost_unitar', l.cost_unitar, 'observatii', l.observatii) AS x
          FROM public.executie_bonuri_consum_linii l WHERE l.bon_id = v_id) z;
        IF v_antet_curent = v_antet_cerut AND v_curent = v_cerut THEN
          RETURN jsonb_build_object('bon_id', v_id, 'updated_at', v_ver, 'linii', jsonb_array_length(v_curent), 'idempotent', true);
        END IF;
        RAISE EXCEPTION 'bon: numărul % există deja pe proiectul % (alt conținut) — reîncarcă', v_numar, v_pid USING ERRCODE = '23505';
      END IF;
      INSERT INTO public.executie_bonuri_consum (numar_bon, proiect_id, situatie_plata_id, provenienta, data_bon, sursa, stare,
                                                 generat_de, observatii)
      VALUES (v_numar, v_pid, (v_antet_cerut->>'situatie_plata_id')::bigint, v_antet_cerut->>'provenienta',
              (v_antet_cerut->>'data_bon')::date, 'manual', 'generat', auth.uid(), v_antet_cerut->>'observatii')
      RETURNING id, updated_at INTO v_id, v_ver;
    ELSE
      -- ── bon existent: CAS pe versiune ──
      IF p_versiune IS NULL THEN RAISE EXCEPTION 'bon: versiunea (updated_at) e obligatorie la editare'; END IF;
      UPDATE public.executie_bonuri_consum
         SET situatie_plata_id = (v_antet_cerut->>'situatie_plata_id')::bigint, provenienta = v_antet_cerut->>'provenienta',
             data_bon = (v_antet_cerut->>'data_bon')::date, observatii = v_antet_cerut->>'observatii', updated_at = clock_timestamp()
       WHERE id = v_id AND updated_at = p_versiune
      RETURNING updated_at INTO v_ver;
      IF NOT FOUND THEN
        SELECT b.updated_at, jsonb_build_object('situatie_plata_id', b.situatie_plata_id, 'provenienta', b.provenienta,
                                                'data_bon', b.data_bon, 'observatii', b.observatii)
          INTO v_ver, v_antet_curent FROM public.executie_bonuri_consum b WHERE b.id = v_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'bon: bonul % nu există (sau nu e vizibil)', v_id USING ERRCODE = 'P0002'; END IF;
        SELECT coalesce(jsonb_agg(x ORDER BY x::text), '[]'::jsonb) INTO v_curent FROM (
          SELECT jsonb_build_object('magazie_bucata_id', l.magazie_bucata_id, 'tip_material_id', l.tip_material_id, 'denumire', l.denumire,
            'serie', l.serie, 'sarja', l.sarja, 'dimensiune', l.dimensiune, 'cantitate', l.cantitate, 'um', l.um,
            'lungime_m', l.lungime_m, 'cost_unitar', l.cost_unitar, 'observatii', l.observatii) AS x
          FROM public.executie_bonuri_consum_linii l WHERE l.bon_id = v_id) z;
        -- retry după răspuns pierdut: conținutul cerut e deja cel salvat → același rezultat, fără dubluri
        IF v_antet_curent = v_antet_cerut AND v_curent = v_cerut THEN
          RETURN jsonb_build_object('bon_id', v_id, 'updated_at', v_ver, 'linii', jsonb_array_length(v_curent), 'idempotent', true);
        END IF;
        RAISE EXCEPTION 'bon: bonul % a fost modificat între timp — reîncarcă și reia editarea', v_id USING ERRCODE = '40001';
      END IF;
      SELECT count(*) INTO v_vechi FROM public.executie_bonuri_consum_linii WHERE bon_id = v_id;
      DELETE FROM public.executie_bonuri_consum_linii WHERE bon_id = v_id;
      GET DIAGNOSTICS v_sterse = ROW_COUNT;
      IF v_sterse <> v_vechi THEN
        RAISE EXCEPTION 'bon: s-au șters % din % linii vechi (vizibilitate / drepturi) — salvare anulată', v_sterse, v_vechi USING ERRCODE = '40001';
      END IF;
    END IF;

    INSERT INTO public.executie_bonuri_consum_linii (bon_id, magazie_bucata_id, tip_material_id, denumire, serie, sarja, dimensiune,
                                                      cantitate, um, lungime_m, cost_unitar, valoare, observatii)
    SELECT v_id, (x->>'magazie_bucata_id')::bigint, (x->>'tip_material_id')::integer, x->>'denumire', x->>'serie', x->>'sarja',
           x->>'dimensiune', (x->>'cantitate')::numeric, x->>'um', (x->>'lungime_m')::numeric, (x->>'cost_unitar')::numeric,
           (x->>'cost_unitar')::numeric * (x->>'cantitate')::numeric, x->>'observatii'
      FROM jsonb_array_elements(v_cerut) x;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('bon_id', v_id, 'updated_at', v_ver, 'linii', v_n, 'idempotent', false);
  END $f$;

  REVOKE ALL ON FUNCTION public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb) TO authenticated, service_role;

  -- ── postcondiții ──────────────────────────────────────────────────────────────────────────────────────
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)'::regprocedure)
     OR NOT (SELECT coalesce(proconfig @> ARRAY['search_path=public, pg_temp'], false) FROM pg_proc
              WHERE oid = 'public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'Postcondiție 1: fn_bon_salveaza trebuie să fie SECURITY INVOKER cu search_path fixat';
  END IF;
  IF has_function_privilege('anon', 'public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondiție 2: EXECUTE — anon nu, authenticated da';
  END IF;
  EXECUTE format('COMMENT ON FUNCTION public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb) IS %L',
    'Salvarea tranzacțională a unui bon de consum (antet + linii). 20261102b. amprenta=' ||
    (SELECT md5(p.prosrc || '|' || coalesce(p.proacl::text, '') || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text)
       FROM pg_proc p WHERE p.oid = 'public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)'::regprocedure));

  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261102b_bon_salvare_tranzactionala:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261102b: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$migrare$;
