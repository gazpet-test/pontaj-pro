-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261102b — Bonuri de consum: salvarea tranzacțională (antet + linii într-o singură tranzacție)
-- Decizia Razvan 21.10.2026 (Codex r4 pct. 3 pe PR #806): RPC tranzacțional pentru salvarea bonurilor, ACUM, separat de
-- registrul E2a (20261102a) — poate fi revizuită și aplicată independent.
--
-- Ce face:
--   • UNIQUE (proiect_id, numar_bon) — numărul unic pe proiect în BD, nu doar în RPC (Copilot r6 b);
--   • coloana executie_bonuri_consum.cheie_operatie (uuid, UNIQUE parțial): cheia unei CREĂRI, generată o dată în client
--     la deschiderea formularului — un retry al aceleiași creări găsește bonul, două creări distincte au chei distincte
--     (Jakarinos r6 N1); bonurile existente rămân cu NULL;
--   • scrierile pe LINII se închid pentru API (r11, Jakarinos + Copilot r10) ȘI pentru service_role (r12, Copilot r11):
--     REVOKE INSERT/UPDATE/DELETE/TRUNCATE de la anon/authenticated/service_role; liniile se scriu DOAR prin RPC-urile de
--     mai jos (postgres direct rămâne doar cale administrativă). Inventar: nicio funcție, cron, edge function sau script nu
--     scrie pe linii în afara RPC-urilor (postcondiția 4 o verifică pe catalog);
--   • garda preluării (r12, Jakarinos + Copilot r11 P1): trigger-ul trg_bonc_preluare_garda refuză orice trecere în
--     „preluat” sau atingere a preluat_de / preluat_la care nu vine din fn_bon_preia (current_user = postgres, owner-ul
--     RPC-urilor DEFINER) — un tab cu UI-ul vechi nu mai poate marca un bon „preluat” fără costuri; anularea directă
--     (stare → „anulat”) rămâne permisă, dar nu poate atinge câmpurile de preluare.
--     Motivul: cu DML direct pe linii, lock-ul liniei vine înaintea oricărui trigger, deci nicio ordine globală de lock-uri
--     nu se putea garanta (deadlock DELETE antet CASCADE ↔ RPC, DML pe mai multe linii ↔ RPC);
--   • ordinea UNICĂ a lock-urilor: ANTETUL ÎNTÂI, apoi liniile (RPC-urile, DELETE-ul de antet cu CASCADE, UPDATE-ul direct
--     pe antet — anularea — toate încep cu antetul);
--   • public.fn_bon_salveaza(p_bon_id, p_versiune, p_antet, p_linii) → jsonb {bon_id, numar_bon, updated_at, linii, idempotent}
--     – bon nou (p_bon_id NULL): numărul se ALOCĂ pe server, atomic (max+1 pe proiect și an, sub lock), apoi antet + linii
--       într-o tranzacție (fără antet orfan); aceeași cheie de operație = același bon (idempotent dacă și conținutul e
--       același, altfel eroare);
--     – bon existent: antetul FOR UPDATE → CAS pe updated_at (p_versiune) → antet → liniile vechi șterse → cele noi; la CAS
--       eșuat (cu antetul deja blocat): conținut identic = idempotent (retry după răspuns pierdut), altfel „modificat între
--       timp” (40001); doar bonurile în starea „generat” se editează; data rămâne în anul din număr (Copilot r7 P2);
--       liniile se inserează în ordinea trimisă;
--   • public.fn_bon_preia(p_bon_id, p_versiune, p_costuri) → jsonb {bon_id, updated_at, linii, idempotent}: preluarea
--     financiară (costurile pe linii + starea „preluat”) într-o tranzacție, cu CAS; gazpet → exact câte un cost pe fiecare
--     linie a bonului; beneficiar → fără costuri;
--   • ambele RPC-uri: SECURITY DEFINER (owner postgres, search_path fix) — liniile nu mai sunt scriptibile de apelant.
--     Fiecare verifică EXPLICIT tot ce verificau politicile live (bonc_* / boncl_*: doar auth.uid() IS NOT NULL — fără
--     condiție de proiect sau de stare; 21.10.2026): deci un utilizator autentificat NU poate face prin RPC nimic ce nu
--     putea deja direct; în plus RPC-urile cer starea „generat”. Gărzile E2a pe linii (trg_bon_linii_izo_bucata) sunt
--     trigger-e necondiționate și se aplică la fel.
-- Precondiții pe forma live: coloanele, RLS, politicile exacte și drepturile de scriere ale API-ului pe linii.
-- Relivrare după o RETRAGERE (revenirea cu chei de operație existente păstrează coloana și indexurile): acceptată doar dacă
--   coloana și cele 2 indexuri au exact definițiile de aici și funcțiile lipsesc.
-- Ce NU face: nicio dată existentă modificată, niciun drept pentru oameni.
-- LIVRARE: doar prin scripts/livrare_migrare.sh. Revenire: supabase/revenire/20261102b_bon_salvare_tranzactionala_ROLLBACK.sql
--   (coordonată cu retragerea UI-ului care cheamă funcțiile).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $migrare$
DECLARE v_relivrare boolean;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261102b_bon_salvare_tranzactionala:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261102b: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── precondiții ───────────────────────────────────────────────────────────────────────────────────────
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('fn_bon_salveaza', 'fn_bon_preia', 'fn_bon_preluare_garda'))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.executie_bonuri_consum'::regclass AND tgname = 'trg_bonc_preluare_garda') THEN
    RAISE EXCEPTION 'Precondiție 0b: public.fn_bon_salveaza / fn_bon_preia / garda preluării există deja';
  END IF;
  -- livrare nouă (nimic) sau relivrare după retragere (coloana + exact cele 2 indexuri)
  v_relivrare := EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_bonuri_consum'
                          AND column_name = 'cheie_operatie' AND data_type = 'uuid');
  IF v_relivrare THEN
    IF to_regclass('public.ux_bonc_cheie_operatie') IS NULL OR to_regclass('public.ux_bonc_proiect_numar') IS NULL
       OR pg_get_indexdef('public.ux_bonc_cheie_operatie'::regclass) IS DISTINCT FROM
            'CREATE UNIQUE INDEX ux_bonc_cheie_operatie ON public.executie_bonuri_consum USING btree (cheie_operatie) WHERE (cheie_operatie IS NOT NULL)'
       OR pg_get_indexdef('public.ux_bonc_proiect_numar'::regclass) IS DISTINCT FROM
            'CREATE UNIQUE INDEX ux_bonc_proiect_numar ON public.executie_bonuri_consum USING btree (proiect_id, numar_bon) WHERE (numar_bon IS NOT NULL)' THEN
      RAISE EXCEPTION 'Precondiție 0b2: coloana cheie_operatie există, dar indexurile nu sunt cele lăsate de o retragere — refuz';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_bonuri_consum' AND column_name = 'cheie_operatie')
     OR to_regclass('public.ux_bonc_cheie_operatie') IS NOT NULL OR to_regclass('public.ux_bonc_proiect_numar') IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0b3: obiecte parțiale (coloană de alt tip / index fără coloană) — refuz';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns c
       JOIN (VALUES ('executie_bonuri_consum','id','bigint'), ('executie_bonuri_consum','numar_bon','text'),
                    ('executie_bonuri_consum','proiect_id','bigint'), ('executie_bonuri_consum','situatie_plata_id','bigint'),
                    ('executie_bonuri_consum','provenienta','text'), ('executie_bonuri_consum','data_bon','date'),
                    ('executie_bonuri_consum','sursa','text'), ('executie_bonuri_consum','stare','text'),
                    ('executie_bonuri_consum','generat_de','uuid'), ('executie_bonuri_consum','observatii','text'),
                    ('executie_bonuri_consum','updated_at','timestamp with time zone'),
                    ('executie_bonuri_consum','preluat_de','uuid'), ('executie_bonuri_consum','preluat_la','timestamp with time zone'),
                    ('executie_bonuri_consum_linii','id','bigint'),
                    ('executie_bonuri_consum_linii','bon_id','bigint'), ('executie_bonuri_consum_linii','magazie_bucata_id','bigint'),
                    ('executie_bonuri_consum_linii','tip_material_id','integer'), ('executie_bonuri_consum_linii','denumire','text'),
                    ('executie_bonuri_consum_linii','serie','text'), ('executie_bonuri_consum_linii','sarja','text'),
                    ('executie_bonuri_consum_linii','dimensiune','text'), ('executie_bonuri_consum_linii','cantitate','numeric'),
                    ('executie_bonuri_consum_linii','um','text'), ('executie_bonuri_consum_linii','lungime_m','numeric'),
                    ('executie_bonuri_consum_linii','cost_unitar','numeric'), ('executie_bonuri_consum_linii','valoare','numeric'),
                    ('executie_bonuri_consum_linii','observatii','text')) x(t, col, tip)
         ON c.table_schema = 'public' AND c.table_name = x.t AND c.column_name = x.col AND c.data_type = x.tip) <> 27 THEN
    RAISE EXCEPTION 'Precondiție 0c: coloanele bonurilor diferă de forma live (21.10.2026)';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.executie_bonuri_consum'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.executie_bonuri_consum_linii'::regclass) THEN
    RAISE EXCEPTION 'Precondiție 0d: RLS inactiv pe tabelele bonurilor';
  END IF;
  -- politicile exacte de pe live (21.10.2026): SELECT USING true, I/U/D doar cu utilizator autentificat — fără condiție de
  -- proiect / stare; RPC-urile DEFINER le reproduc explicit (auth.uid() IS NOT NULL)
  IF (SELECT string_agg(format('%s.%s:%s:%s:%s:%s:%s', c.relname, p.polname, p.polcmd, p.polpermissive,
              (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r),
              coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')), '|' ORDER BY c.relname, p.polname)
        FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.relname IN ('executie_bonuri_consum', 'executie_bonuri_consum_linii') AND c.relnamespace = 'public'::regnamespace)
     IS DISTINCT FROM concat_ws('|',
       'executie_bonuri_consum.bonc_del:d:t:authenticated:(auth.uid() IS NOT NULL):',
       'executie_bonuri_consum.bonc_ins:a:t:authenticated::(auth.uid() IS NOT NULL)',
       'executie_bonuri_consum.bonc_sel:r:t:authenticated:true:',
       'executie_bonuri_consum.bonc_upd:w:t:authenticated:(auth.uid() IS NOT NULL):',
       'executie_bonuri_consum_linii.boncl_del:d:t:authenticated:(auth.uid() IS NOT NULL):',
       'executie_bonuri_consum_linii.boncl_ins:a:t:authenticated::(auth.uid() IS NOT NULL)',
       'executie_bonuri_consum_linii.boncl_sel:r:t:authenticated:true:',
       'executie_bonuri_consum_linii.boncl_upd:w:t:authenticated:(auth.uid() IS NOT NULL):') THEN
    RAISE EXCEPTION 'Precondiție 0d2: politicile RLS ale bonurilor diferă de forma live (21.10.2026)';
  END IF;
  -- drepturile API pe linii ca pe live (anon/authenticated = arwdxt): ce închide migrarea și ce reface revenirea
  IF NOT (has_table_privilege('authenticated', 'public.executie_bonuri_consum_linii', 'INSERT')
          AND has_table_privilege('authenticated', 'public.executie_bonuri_consum_linii', 'UPDATE')
          AND has_table_privilege('authenticated', 'public.executie_bonuri_consum_linii', 'DELETE')
          AND has_table_privilege('anon', 'public.executie_bonuri_consum_linii', 'INSERT')
          AND has_table_privilege('service_role', 'public.executie_bonuri_consum_linii', 'INSERT')
          AND has_table_privilege('service_role', 'public.executie_bonuri_consum_linii', 'TRUNCATE'))
     OR has_table_privilege('authenticated', 'public.executie_bonuri_consum_linii', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.executie_bonuri_consum_linii', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Precondiție 0g: drepturile API pe executie_bonuri_consum_linii diferă de live (anon/authenticated = arwdxt, service_role = arwdDxt…)';
  END IF;
  IF has_schema_privilege('authenticated', 'public', 'CREATE') OR has_schema_privilege('anon', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Precondiție 0e: anon/authenticated au CREATE pe schema public';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_bonuri_consum WHERE numar_bon IS NOT NULL GROUP BY proiect_id, numar_bon HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Precondiție 0f: există numere de bon duplicate pe același proiect — de lămurit înaintea UNIQUE';
  END IF;

  -- ── cheia de operație (idempotența creării) ─────────────────────────────────────────────────────────
  IF NOT v_relivrare THEN
    ALTER TABLE public.executie_bonuri_consum ADD COLUMN cheie_operatie uuid;
    CREATE UNIQUE INDEX ux_bonc_cheie_operatie ON public.executie_bonuri_consum (cheie_operatie) WHERE cheie_operatie IS NOT NULL;
    -- numărul bonului unic pe proiect, în BD (Copilot r6 b): și o creare din afara RPC-ului e oprită de index
    CREATE UNIQUE INDEX ux_bonc_proiect_numar ON public.executie_bonuri_consum (proiect_id, numar_bon) WHERE numar_bon IS NOT NULL;
  END IF;

  -- ── liniile: scrierile din API închise (doar prin RPC-uri) ───────────────────────────────────────────
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.executie_bonuri_consum_linii FROM anon, authenticated, service_role;

  -- ── garda preluării: doar fn_bon_preia (DEFINER, current_user = postgres) trece un bon în „preluat” ──────
  CREATE FUNCTION public.fn_bon_preluare_garda() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $g$
  BEGIN
    IF current_user IS DISTINCT FROM 'postgres' AND (
         (TG_OP = 'INSERT' AND (NEW.stare = 'preluat' OR NEW.preluat_de IS NOT NULL OR NEW.preluat_la IS NOT NULL))
      OR (TG_OP = 'UPDATE' AND ((NEW.stare = 'preluat' AND OLD.stare IS DISTINCT FROM 'preluat')
                                OR NEW.preluat_de IS DISTINCT FROM OLD.preluat_de OR NEW.preluat_la IS DISTINCT FROM OLD.preluat_la))) THEN
      RAISE EXCEPTION 'bon: preluarea în Financiar se face doar prin fn_bon_preia (reîncarcă pagina)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END $g$;
  REVOKE ALL ON FUNCTION public.fn_bon_preluare_garda() FROM PUBLIC, anon, authenticated, service_role;
  CREATE TRIGGER trg_bonc_preluare_garda BEFORE INSERT OR UPDATE ON public.executie_bonuri_consum
    FOR EACH ROW EXECUTE FUNCTION public.fn_bon_preluare_garda();
  ALTER TABLE public.executie_bonuri_consum ENABLE ALWAYS TRIGGER trg_bonc_preluare_garda;

  -- ── salvarea ─────────────────────────────────────────────────────────────────────────────────────────
  CREATE FUNCTION public.fn_bon_salveaza(p_bon_id bigint, p_versiune timestamptz, p_antet jsonb, p_linii jsonb) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE
    v_id bigint := p_bon_id; v_ver timestamptz; v_numar text; v_pid bigint; v_cheie uuid; v_an int; v_secv int; v_stare text;
    v_cerut jsonb; v_ordonat jsonb; v_curent jsonb; v_antet_cerut jsonb; v_antet_curent jsonb; v_n int;
  BEGIN
    -- ce verificau politicile bonc_* / boncl_* (DEFINER le ocolește): utilizator autentificat
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'bon: neautentificat' USING ERRCODE = '42501'; END IF;
    IF jsonb_typeof(p_antet) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'bon: antetul trebuie să fie obiect'; END IF;
    IF jsonb_typeof(p_linii) IS DISTINCT FROM 'array' OR jsonb_array_length(p_linii) = 0 THEN
      RAISE EXCEPTION 'bon: bonul cere cel puțin o linie';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_linii) l WHERE jsonb_typeof(l) IS DISTINCT FROM 'object') THEN
      RAISE EXCEPTION 'bon: fiecare linie trebuie să fie obiect';
    END IF;
    -- liniile în formă canonică: v_ordonat în ordinea trimisă (pentru INSERT), v_cerut sortat (doar pentru comparația
    -- de idempotență)
    SELECT coalesce(jsonb_agg(x ORDER BY o), '[]'::jsonb), coalesce(jsonb_agg(x ORDER BY x::text), '[]'::jsonb) INTO v_ordonat, v_cerut FROM (
      SELECT o, jsonb_build_object(
        'magazie_bucata_id', (l->>'magazie_bucata_id')::bigint, 'tip_material_id', (l->>'tip_material_id')::integer,
        'denumire', nullif(btrim(l->>'denumire'), ''), 'serie', nullif(btrim(l->>'serie'), ''),
        'sarja', nullif(btrim(l->>'sarja'), ''), 'dimensiune', nullif(btrim(l->>'dimensiune'), ''),
        'cantitate', (l->>'cantitate')::numeric, 'um', coalesce(nullif(btrim(l->>'um'), ''), 'buc'),
        'lungime_m', (l->>'lungime_m')::numeric, 'cost_unitar', (l->>'cost_unitar')::numeric,
        'observatii', nullif(btrim(l->>'observatii'), '')) AS x
      FROM jsonb_array_elements(p_linii) WITH ORDINALITY AS e(l, o)) z;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_cerut) x
                WHERE (x->>'cantitate') IS NULL OR (x->>'cantitate')::numeric <= 0
                   OR ((x->>'denumire') IS NULL AND (x->>'tip_material_id') IS NULL)) THEN
      RAISE EXCEPTION 'bon: fiecare linie cere cantitate > 0 și denumire sau tip de material';
    END IF;
    v_antet_cerut := jsonb_build_object('situatie_plata_id', (p_antet->>'situatie_plata_id')::bigint,
      'provenienta', p_antet->>'provenienta', 'data_bon', coalesce((p_antet->>'data_bon')::date, current_date),
      'observatii', nullif(btrim(p_antet->>'observatii'), ''));

    IF v_id IS NULL THEN
      -- ── bon nou: cheia operației (din client, o dată per creare) + numărul alocat pe server ──
      v_cheie := (p_antet->>'cheie_operatie')::uuid;
      v_pid := (p_antet->>'proiect_id')::bigint;
      IF v_cheie IS NULL OR v_pid IS NULL THEN RAISE EXCEPTION 'bon: bonul nou cere proiect_id și cheie_operatie'; END IF;
      -- retry-urile aceleiași operații se serializează; antetul existent se blochează ÎNAINTE de citirile de comparație
      PERFORM pg_advisory_xact_lock(hashtextextended('fn_bon_salveaza:op:' || v_cheie::text, 0));
      SELECT b.id INTO v_id FROM public.executie_bonuri_consum b WHERE b.cheie_operatie = v_cheie FOR SHARE;
      IF FOUND THEN
        SELECT b.updated_at, b.numar_bon, jsonb_build_object('proiect_id', b.proiect_id, 'situatie_plata_id', b.situatie_plata_id,
                 'provenienta', b.provenienta, 'data_bon', b.data_bon, 'observatii', b.observatii)
          INTO v_ver, v_numar, v_antet_curent FROM public.executie_bonuri_consum b WHERE b.id = v_id;
        SELECT coalesce(jsonb_agg(x ORDER BY x::text), '[]'::jsonb) INTO v_curent FROM (
          SELECT jsonb_build_object('magazie_bucata_id', l.magazie_bucata_id, 'tip_material_id', l.tip_material_id, 'denumire', l.denumire,
            'serie', l.serie, 'sarja', l.sarja, 'dimensiune', l.dimensiune, 'cantitate', l.cantitate, 'um', l.um,
            'lungime_m', l.lungime_m, 'cost_unitar', l.cost_unitar, 'observatii', l.observatii) AS x
          FROM public.executie_bonuri_consum_linii l WHERE l.bon_id = v_id) z;
        IF v_antet_curent = (v_antet_cerut || jsonb_build_object('proiect_id', v_pid)) AND v_curent = v_cerut THEN
          RETURN jsonb_build_object('bon_id', v_id, 'numar_bon', v_numar, 'updated_at', v_ver, 'linii', jsonb_array_length(v_curent), 'idempotent', true);
        END IF;
        RAISE EXCEPTION 'bon: operația % a creat deja bonul % cu alt conținut — reîncarcă', v_cheie, v_numar USING ERRCODE = '23505';
      END IF;
      -- numărul: max + 1 pe (proiect, an), sub lock — două creări simultane primesc numere diferite
      v_an := extract(year FROM (v_antet_cerut->>'data_bon')::date)::int;
      PERFORM pg_advisory_xact_lock(hashtextextended('fn_bon_salveaza:numar:' || v_pid || ':' || v_an, 0));
      SELECT coalesce(max((regexp_match(b.numar_bon, '^BC-[0-9]{4}-[0-9]+-([0-9]+)$'))[1]::int), 0) + 1 INTO v_secv
        FROM public.executie_bonuri_consum b WHERE b.proiect_id = v_pid AND b.numar_bon LIKE 'BC-' || v_an || '-' || v_pid || '-%';
      -- lățime minimă 4, fără trunchiere peste 9999 (lpad ar tăia „10000” la „1000”) — Jakarinos r7
      v_numar := format('BC-%s-%s-%s', v_an, v_pid, CASE WHEN v_secv > 9999 THEN v_secv::text ELSE lpad(v_secv::text, 4, '0') END);
      INSERT INTO public.executie_bonuri_consum (numar_bon, proiect_id, situatie_plata_id, provenienta, data_bon, sursa, stare,
                                                 generat_de, observatii, cheie_operatie)
      VALUES (v_numar, v_pid, (v_antet_cerut->>'situatie_plata_id')::bigint, v_antet_cerut->>'provenienta',
              (v_antet_cerut->>'data_bon')::date, 'manual', 'generat', auth.uid(), v_antet_cerut->>'observatii', v_cheie)
      RETURNING id, updated_at INTO v_id, v_ver;
    ELSE
      -- ── bon existent: ANTETUL ÎNTÂI (ordinea unică a lock-urilor), apoi CAS pe versiune ──
      IF p_versiune IS NULL THEN RAISE EXCEPTION 'bon: versiunea (updated_at) e obligatorie la editare'; END IF;
      SELECT b.updated_at, b.numar_bon, b.stare INTO v_ver, v_numar, v_stare FROM public.executie_bonuri_consum b WHERE b.id = v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'bon: bonul % nu există', v_id USING ERRCODE = 'P0002'; END IF;
      IF v_ver IS DISTINCT FROM p_versiune THEN
        -- antetul e deja blocat: o editare concurentă a fost așteptată, nu amestecată (N2)
        SELECT jsonb_build_object('situatie_plata_id', b.situatie_plata_id, 'provenienta', b.provenienta, 'data_bon', b.data_bon, 'observatii', b.observatii)
          INTO v_antet_curent FROM public.executie_bonuri_consum b WHERE b.id = v_id;
        SELECT coalesce(jsonb_agg(x ORDER BY x::text), '[]'::jsonb) INTO v_curent FROM (
          SELECT jsonb_build_object('magazie_bucata_id', l.magazie_bucata_id, 'tip_material_id', l.tip_material_id, 'denumire', l.denumire,
            'serie', l.serie, 'sarja', l.sarja, 'dimensiune', l.dimensiune, 'cantitate', l.cantitate, 'um', l.um,
            'lungime_m', l.lungime_m, 'cost_unitar', l.cost_unitar, 'observatii', l.observatii) AS x
          FROM public.executie_bonuri_consum_linii l WHERE l.bon_id = v_id) z;
        -- retry după răspuns pierdut: conținutul cerut e deja cel salvat → același rezultat, fără dubluri
        IF v_antet_curent = v_antet_cerut AND v_curent = v_cerut THEN
          RETURN jsonb_build_object('bon_id', v_id, 'numar_bon', v_numar, 'updated_at', v_ver, 'linii', jsonb_array_length(v_curent), 'idempotent', true);
        END IF;
        RAISE EXCEPTION 'bon: bonul % a fost modificat între timp — reîncarcă și reia editarea', v_id USING ERRCODE = '40001';
      END IF;
      IF v_stare IS DISTINCT FROM 'generat' THEN
        RAISE EXCEPTION 'bon: bonul % e „%” — se editează doar bonurile generate', v_numar, v_stare USING ERRCODE = '55000';
      END IF;
      -- data rămâne în anul din număr (Copilot r7 P2): numerotarea e pe (proiect, an)
      IF v_numar ~ '^BC-[0-9]{4}-' AND substring(v_numar FROM 4 FOR 4)::int <> extract(year FROM (v_antet_cerut->>'data_bon')::date)::int THEN
        RAISE EXCEPTION 'bon: data % iese din anul bonului % — bonul se reface în anul nou', v_antet_cerut->>'data_bon', v_numar USING ERRCODE = '22023';
      END IF;
      UPDATE public.executie_bonuri_consum
         SET situatie_plata_id = (v_antet_cerut->>'situatie_plata_id')::bigint, provenienta = v_antet_cerut->>'provenienta',
             data_bon = (v_antet_cerut->>'data_bon')::date, observatii = v_antet_cerut->>'observatii', updated_at = clock_timestamp()
       WHERE id = v_id
      RETURNING updated_at INTO v_ver;
      DELETE FROM public.executie_bonuri_consum_linii WHERE bon_id = v_id;
    END IF;

    INSERT INTO public.executie_bonuri_consum_linii (bon_id, magazie_bucata_id, tip_material_id, denumire, serie, sarja, dimensiune,
                                                      cantitate, um, lungime_m, cost_unitar, valoare, observatii)
    SELECT v_id, (x->>'magazie_bucata_id')::bigint, (x->>'tip_material_id')::integer, x->>'denumire', x->>'serie', x->>'sarja',
           x->>'dimensiune', (x->>'cantitate')::numeric, x->>'um', (x->>'lungime_m')::numeric, (x->>'cost_unitar')::numeric,
           (x->>'cost_unitar')::numeric * (x->>'cantitate')::numeric, x->>'observatii'
      FROM jsonb_array_elements(v_ordonat) WITH ORDINALITY AS e(x, o) ORDER BY o;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('bon_id', v_id, 'numar_bon', v_numar, 'updated_at', v_ver, 'linii', v_n, 'idempotent', false);
  END $f$;

  -- ── preluarea financiară ──────────────────────────────────────────────────────────────────────────────
  -- p_costuri: [{linie_id, cost_unitar}] — gazpet: câte unul pentru FIECARE linie a bonului (cost_unitar poate fi null =
  -- nevalorizat); beneficiar: [] (fără valorizare). Retry după răspuns pierdut (bonul deja preluat cu aceleași costuri) →
  -- idempotent; altfel „modificat între timp”.
  CREATE FUNCTION public.fn_bon_preia(p_bon_id bigint, p_versiune timestamptz, p_costuri jsonb) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_ver timestamptz; v_stare text; v_prov text; v_linii int; v_cerute int; v_bune int; v_n int; v_la_fel boolean;
  BEGIN
    -- ce verificau politicile bonc_upd / boncl_upd (DEFINER le ocolește): utilizator autentificat
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'bon: neautentificat' USING ERRCODE = '42501'; END IF;
    IF p_bon_id IS NULL OR p_versiune IS NULL THEN RAISE EXCEPTION 'bon: preluarea cere bonul și versiunea'; END IF;
    IF jsonb_typeof(p_costuri) IS DISTINCT FROM 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_costuri) c WHERE jsonb_typeof(c) IS DISTINCT FROM 'object' OR (c->>'linie_id') IS NULL) THEN
      RAISE EXCEPTION 'bon: costurile trebuie să fie [{linie_id, cost_unitar}]';
    END IF;
    -- ANTETUL ÎNTÂI (ordinea unică a lock-urilor), apoi liniile
    SELECT b.updated_at, b.stare, b.provenienta INTO v_ver, v_stare, v_prov FROM public.executie_bonuri_consum b WHERE b.id = p_bon_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'bon: bonul % nu există', p_bon_id USING ERRCODE = 'P0002'; END IF;
    SELECT count(*) INTO v_linii FROM public.executie_bonuri_consum_linii l WHERE l.bon_id = p_bon_id;
    SELECT count(*), count(DISTINCT (c->>'linie_id')::bigint) FILTER (WHERE EXISTS (SELECT 1 FROM public.executie_bonuri_consum_linii l
             WHERE l.id = (c->>'linie_id')::bigint AND l.bon_id = p_bon_id))
      INTO v_cerute, v_bune FROM jsonb_array_elements(p_costuri) c;
    IF v_ver IS DISTINCT FROM p_versiune THEN
      -- retry: deja preluat, cu exact costurile cerute → idempotent
      SELECT bool_and(l.cost_unitar IS NOT DISTINCT FROM (c->>'cost_unitar')::numeric) INTO v_la_fel
        FROM jsonb_array_elements(p_costuri) c JOIN public.executie_bonuri_consum_linii l ON l.id = (c->>'linie_id')::bigint AND l.bon_id = p_bon_id;
      IF v_stare = 'preluat' AND v_cerute = v_bune AND v_bune = (CASE WHEN v_prov = 'gazpet' THEN v_linii ELSE 0 END) AND coalesce(v_la_fel, true) THEN
        RETURN jsonb_build_object('bon_id', p_bon_id, 'updated_at', v_ver, 'linii', v_bune, 'idempotent', true);
      END IF;
      RAISE EXCEPTION 'bon: bonul % a fost modificat între timp — reîncarcă', p_bon_id USING ERRCODE = '40001';
    END IF;
    IF v_stare IS DISTINCT FROM 'generat' THEN
      RAISE EXCEPTION 'bon: bonul % e „%” — se preiau doar bonurile generate', p_bon_id, v_stare USING ERRCODE = '55000';
    END IF;
    IF v_prov = 'gazpet' AND (v_cerute <> v_linii OR v_bune <> v_linii) THEN
      RAISE EXCEPTION 'bon: preluarea unui bon gazpet cere câte un cost pentru fiecare dintre cele % linii (primite %, valide distincte %)', v_linii, v_cerute, v_bune
        USING ERRCODE = '22023';
    END IF;
    IF v_prov IS DISTINCT FROM 'gazpet' AND v_cerute <> 0 THEN
      RAISE EXCEPTION 'bon: bonul beneficiar nu se valorizează (costuri primite: %)', v_cerute USING ERRCODE = '22023';
    END IF;
    UPDATE public.executie_bonuri_consum_linii l
       SET cost_unitar = (c->>'cost_unitar')::numeric, valoare = (c->>'cost_unitar')::numeric * l.cantitate
      FROM jsonb_array_elements(p_costuri) c
     WHERE l.id = (c->>'linie_id')::bigint AND l.bon_id = p_bon_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> v_cerute THEN RAISE EXCEPTION 'bon: s-au valorizat % din % linii — preluare anulată', v_n, v_cerute USING ERRCODE = '40001'; END IF;
    UPDATE public.executie_bonuri_consum
       SET stare = 'preluat', preluat_de = auth.uid(), preluat_la = now(), updated_at = clock_timestamp()
     WHERE id = p_bon_id
    RETURNING updated_at INTO v_ver;
    RETURN jsonb_build_object('bon_id', p_bon_id, 'updated_at', v_ver, 'linii', v_n, 'idempotent', false);
  END $f$;

  REVOKE ALL ON FUNCTION public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb), public.fn_bon_preia(bigint, timestamptz, jsonb) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb), public.fn_bon_preia(bigint, timestamptz, jsonb) TO authenticated, service_role;

  -- ── postcondiții ──────────────────────────────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN ('public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)'::regprocedure,
                                                     'public.fn_bon_preia(bigint, timestamptz, jsonb)'::regprocedure)
              AND (NOT p.prosecdef OR p.proowner <> 'postgres'::regrole OR NOT coalesce(p.proconfig @> ARRAY['search_path=public, pg_temp'], false)
                   OR has_function_privilege('anon', p.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'Postcondiție 1: RPC-urile bonului trebuie să fie DEFINER (owner postgres), search_path fixat, EXECUTE authenticated da / anon nu';
  END IF;
  IF has_table_privilege('authenticated', 'public.executie_bonuri_consum_linii', 'INSERT')
     OR has_table_privilege('authenticated', 'public.executie_bonuri_consum_linii', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.executie_bonuri_consum_linii', 'DELETE')
     OR has_table_privilege('anon', 'public.executie_bonuri_consum_linii', 'INSERT')
     OR has_table_privilege('anon', 'public.executie_bonuri_consum_linii', 'UPDATE')
     OR has_table_privilege('anon', 'public.executie_bonuri_consum_linii', 'DELETE')
     OR has_table_privilege('service_role', 'public.executie_bonuri_consum_linii', 'INSERT')
     OR has_table_privilege('service_role', 'public.executie_bonuri_consum_linii', 'UPDATE')
     OR has_table_privilege('service_role', 'public.executie_bonuri_consum_linii', 'DELETE')
     OR has_table_privilege('service_role', 'public.executie_bonuri_consum_linii', 'TRUNCATE')
     OR NOT has_table_privilege('authenticated', 'public.executie_bonuri_consum_linii', 'SELECT') THEN
    RAISE EXCEPTION 'Postcondiție 2: liniile bonului — API (anon / authenticated / service_role) doar citire';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.executie_bonuri_consum'::regclass AND tgname = 'trg_bonc_preluare_garda' AND tgenabled = 'A') THEN
    RAISE EXCEPTION 'Postcondiție 2b: garda preluării lipsește sau nu e ENABLE ALWAYS';
  END IF;
  -- nicio funcție din afara RPC-urilor nu scrie pe linii (inventarul r12: cron / edge / scripturi — 0)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
                AND p.oid NOT IN ('public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)'::regprocedure, 'public.fn_bon_preia(bigint, timestamptz, jsonb)'::regprocedure)
                AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), ''))
                    ~* '(insert\s+into|update|delete\s+from|truncate(\s+table)?|copy)\s+(only\s+)?("?public"?\s*\.\s*)?"?executie_bonuri_consum_linii\M') THEN
    RAISE EXCEPTION 'Postcondiție 4: o funcție din afara RPC-urilor bonului scrie pe executie_bonuri_consum_linii';
  END IF;
  IF NOT v_relivrare AND EXISTS (SELECT 1 FROM public.executie_bonuri_consum WHERE cheie_operatie IS NOT NULL) THEN
    RAISE EXCEPTION 'Postcondiție 3: bonurile existente trebuie să rămână fără cheie de operație';
  END IF;
  EXECUTE format('COMMENT ON FUNCTION public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb) IS %L',
    'Salvarea tranzacțională a unui bon de consum (antet + linii). 20261102b. amprenta=' ||
    (SELECT md5(string_agg(p.prosrc || '|' || coalesce(p.proacl::text, '') || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text
                           || '|' || pg_get_userbyid(p.proowner), '#' ORDER BY p.proname)
                || '|' || (SELECT pg_get_indexdef('public.ux_bonc_cheie_operatie'::regclass))
                || '|' || (SELECT pg_get_indexdef('public.ux_bonc_proiect_numar'::regclass))
                || '|' || (SELECT coalesce(c.relacl::text, '') FROM pg_class c WHERE c.oid = 'public.executie_bonuri_consum_linii'::regclass)
                || '|' || (SELECT pg_get_triggerdef(g.oid) || ':' || g.tgenabled::text FROM pg_trigger g
                            WHERE g.tgrelid = 'public.executie_bonuri_consum'::regclass AND g.tgname = 'trg_bonc_preluare_garda'))
       FROM pg_proc p WHERE p.oid IN ('public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)'::regprocedure,
                                      'public.fn_bon_preia(bigint, timestamptz, jsonb)'::regprocedure,
                                      'public.fn_bon_preluare_garda()'::regprocedure)));

  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261102b_bon_salvare_tranzactionala:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261102b: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$migrare$;
