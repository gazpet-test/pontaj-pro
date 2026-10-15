-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261030d — Ofertare: pilot OCR local, RELUAREA unei rulări oprite automat pe pragul de needs_human (spec §8), decizia A Răzvan
-- 15.10.2026 (laborator OCR). fn_ofertare_ocr_stare (20261029b) face din „oprita” o stare finală; proba pe r1 (licitația 102) s-a
-- oprit singură după 24 de decizii (4 needs_human, > 15%), iar proba cu promptul arb-v2 cere aceeași rulare înapoi în „citita”.
--   * ofertare_ocr_reluari — jurnalul reluărilor (append-only pentru rolurile aplicației; postgres îl poate modifica): rularea, motivul opririi reluate, motivul reluării, costul și
--     numărul de arbitraje în acel moment, cine a rulat-o; citire ca celelalte tabele OCR (accesul Ofertare), scriere DOAR prin RPC;
--   * fn_ofertare_ocr_reia(rulare, motiv) — oprita → citita, DOAR dacă: oprirea a fost cea AUTOMATĂ pe pragul §8 (oprit_motiv în
--     forma exactă scrisă de scripts/ocr_local/client.py arbitreaza), motivul reluării are 10..300 de caractere, nicio rezervare
--     deschisă, compararea încheiată, a mai rămas plafon, nicio altă rulare activă pe licitație, cel mult 3 reluări pe rulare.
--     EXECUTE pentru NIMENI (nici service_role, nici edge): se rulează manual prin psql, cu „da”-ul lui Răzvan (poarta umană);
--     pragul §8 din client rămâne activ după reluare (numără doar deciziile de după reluare).
-- Nu atinge nicio tabelă / funcție existentă; re-ștampilează amprenta (revenirea lui e / c / b refuză cât d e aplicată).
-- Revenire: supabase/revenire/20261030d_ofertare_ocr_reluare_ROLLBACK.sql.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
DECLARE v_fp text;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261030d_ofertare_ocr_reluare:' || txid_current() THEN
    RAISE EXCEPTION '20261030d: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261030d: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_ofertare_ocr_rulare_stare(bigint)') IS NULL THEN
    RAISE EXCEPTION '20261030d: 20261029e nu e aplicata';
  END IF;
  IF to_regclass('public.ofertare_ocr_reluari') IS NOT NULL OR to_regprocedure('public.fn_ofertare_ocr_reia(bigint,text)') IS NOT NULL THEN
    RAISE EXCEPTION '20261030d: obiectele exista deja';
  END IF;
  -- pornește DOAR peste obiectele exacte b + c + e (amprenta re-ștampilată de e la aplicare)
  v_fp := public.fn_ofertare_ocr_amprenta();
  IF v_fp IS NULL OR coalesce(obj_description('public.ofertare_ocr_rulari'::regclass, 'pg_class'), '') NOT LIKE '%amprenta=' || v_fp THEN
    RAISE EXCEPTION '20261030d: obiectele 20261029b/c/e s-au schimbat dupa aplicare (amprenta difera)';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%') <> 25 THEN
    RAISE EXCEPTION '20261030d: numar functii neasteptat inainte';
  END IF;
END $pre$;

CREATE TABLE public.ofertare_ocr_reluari (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rulare_id          bigint NOT NULL REFERENCES public.ofertare_ocr_rulari(id),
  oprit_motiv        text NOT NULL CHECK (length(oprit_motiv) BETWEEN 1 AND 300),
  motiv              text NOT NULL CHECK (length(btrim(motiv)) BETWEEN 10 AND 300),
  cost_usd           numeric(10,4) NOT NULL CHECK (cost_usd >= 0),
  arbitraje          integer NOT NULL CHECK (arbitraje >= 0),
  reluat_de          text NOT NULL CHECK (length(reluat_de) BETWEEN 1 AND 100),
  reluat_la          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ofertare_ocr_reluari_rulare_idx ON public.ofertare_ocr_reluari (rulare_id);

ALTER TABLE public.ofertare_ocr_reluari ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_ocr_reluari FROM PUBLIC, anon, authenticated, service_role;
DO $secventa$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', pg_get_serial_sequence('public.ofertare_ocr_reluari', 'id'));
END $secventa$;
GRANT SELECT ON public.ofertare_ocr_reluari TO authenticated;
CREATE POLICY ofertare_ocr_reluari_select ON public.ofertare_ocr_reluari FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
COMMENT ON TABLE public.ofertare_ocr_reluari IS 'Pilot OCR local (20261030d). Jurnalul reluarilor oprita -> citita; scriere doar prin fn_ofertare_ocr_reia.';

-- oprita → citita, doar după oprirea AUTOMATĂ pe pragul §8. Forma motivului opririi = exact cea scrisă de client.arbitreaza
-- („needs_human pe N din M arbitraje Claude (> P%, spec §8)”); o oprire umană / la depășire de cost / altă cauză nu se reia aici.
CREATE FUNCTION public.fn_ofertare_ocr_reia(p_rulare_id bigint, p_motiv text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record; v_arb int; v_id bigint;
BEGIN
  IF p_motiv IS NULL OR length(btrim(p_motiv)) NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION 'Motivul reluării e obligatoriu (10..300 de caractere)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE id = p_rulare_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rulare inexistentă' USING ERRCODE = 'P0002'; END IF;
  IF r.stare <> 'oprita' THEN RAISE EXCEPTION 'Doar o rulare oprita se reia (stare: %)', r.stare USING ERRCODE = '55000'; END IF;
  IF r.oprit_motiv IS NULL OR r.oprit_motiv !~ '^needs_human pe [0-9]+ din [0-9]+ arbitraje Claude [(]> [0-9]+%, spec §8[)]$' THEN
    RAISE EXCEPTION 'Se reia doar o rulare oprita automat pe pragul de needs_human (spec §8)' USING ERRCODE = '55000';
  END IF;
  IF r.comparatie_nr IS NULL OR r.plan IS NULL THEN RAISE EXCEPTION 'Rularea nu a ajuns la comparare' USING ERRCODE = '55000'; END IF;
  IF r.cost_rezervat <> 0 OR EXISTS (SELECT 1 FROM public.ofertare_ocr_rezervari z WHERE z.rulare_id = r.id AND z.stare = 'deschisa') THEN
    RAISE EXCEPTION 'Mai sunt rezervări deschise' USING ERRCODE = '55000';
  END IF;
  IF r.cost_usd + r.cost_abandonat >= r.plafon_usd THEN RAISE EXCEPTION 'Plafonul rulării e consumat' USING ERRCODE = '55000'; END IF;
  IF (SELECT count(*) FROM public.ofertare_ocr_reluari WHERE rulare_id = r.id) >= 3 THEN
    RAISE EXCEPTION 'Rularea a fost deja reluată de 3 ori' USING ERRCODE = '55000';
  END IF;
  -- blocarea licitației, ca la cerere: o altă rulare activă pe aceeași licitație = refuz explicit (nu eroarea indexului unic)
  PERFORM 1 FROM public.ofertare_licitatii WHERE id = r.licitatie_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.ofertare_ocr_rulari o WHERE o.licitatie_id = r.licitatie_id AND o.id <> r.id
              AND o.stare IN ('ceruta', 'preluata', 'citita', 'arbitrata')) THEN
    RAISE EXCEPTION 'Există altă rulare activă pe această licitație' USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_arb FROM public.ofertare_ocr_arbitraje a JOIN public.ofertare_ocr_dezacorduri d ON d.id = a.dezacord_id WHERE d.rulare_id = r.id;
  INSERT INTO public.ofertare_ocr_reluari (rulare_id, oprit_motiv, motiv, cost_usd, arbitraje, reluat_de)
       VALUES (r.id, r.oprit_motiv, btrim(p_motiv), r.cost_usd, v_arb, left(session_user::text, 100)) RETURNING id INTO v_id;
  -- urma reluării, citită de client prin fn_ofertare_ocr_rulare_stare (oprit_motiv): `erp reluata` acceptă DOAR un reluare_id nou văzut
  -- aici — „citita” fără urma asta (ex. oprirea care n-a ajuns în BD) nu resetează pragul (Jakarinos r2 P1)
  UPDATE public.ofertare_ocr_rulari
     SET stare = 'citita', terminata_la = NULL,
         oprit_motiv = left('reluata #' || (SELECT count(*) FROM public.ofertare_ocr_reluari WHERE rulare_id = r.id) || ' (reluare_id ' || v_id || '): ' || r.oprit_motiv, 300)
   WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'stare', 'citita', 'reluare_id', v_id, 'arbitraje', v_arb, 'cost_usd', r.cost_usd);
END $f$;

-- ── execuție + postcondiții + amprenta re-ștampilată ──
DO $post$
DECLARE v_fp text; rol text;
BEGIN
  REVOKE ALL ON FUNCTION public.fn_ofertare_ocr_reia(bigint, text) FROM PUBLIC, anon, authenticated, service_role;
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(rol, 'public.fn_ofertare_ocr_reia(bigint,text)', 'EXECUTE') THEN
      RAISE EXCEPTION '20261030d: postconditie executie % / reia', rol;
    END IF;
    IF has_table_privilege(rol, 'public.ofertare_ocr_reluari', 'INSERT') OR has_table_privilege(rol, 'public.ofertare_ocr_reluari', 'UPDATE')
       OR has_table_privilege(rol, 'public.ofertare_ocr_reluari', 'DELETE') OR has_table_privilege(rol, 'public.ofertare_ocr_reluari', 'TRUNCATE')
       OR has_table_privilege(rol, 'public.ofertare_ocr_reluari', 'REFERENCES') OR has_table_privilege(rol, 'public.ofertare_ocr_reluari', 'TRIGGER')
       OR has_any_column_privilege(rol, 'public.ofertare_ocr_reluari', 'INSERT') OR has_any_column_privilege(rol, 'public.ofertare_ocr_reluari', 'UPDATE')
       OR has_sequence_privilege(rol, pg_get_serial_sequence('public.ofertare_ocr_reluari', 'id'), 'USAGE')
       OR has_sequence_privilege(rol, pg_get_serial_sequence('public.ofertare_ocr_reluari', 'id'), 'UPDATE')
       OR has_sequence_privilege(rol, pg_get_serial_sequence('public.ofertare_ocr_reluari', 'id'), 'SELECT')
       OR (rol <> 'authenticated') = has_table_privilege(rol, 'public.ofertare_ocr_reluari', 'SELECT') THEN
      RAISE EXCEPTION '20261030d: postconditie drepturi reluari / %', rol;
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ofertare_ocr_reluari'::regclass) THEN RAISE EXCEPTION '20261030d: RLS oprit'; END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%') <> 26 THEN
    RAISE EXCEPTION '20261030d: postconditie obiecte';
  END IF;
  v_fp := public.fn_ofertare_ocr_amprenta();
  EXECUTE format('COMMENT ON TABLE public.ofertare_ocr_rulari IS %L', 'Pilot OCR local (20261029b + 20261029c + 20261029e + 20261030d). Stare doar prin RPC. amprenta=' || v_fp);
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261030d_ofertare_ocr_reluare:' || txid_current() THEN
    RAISE EXCEPTION '20261030d: garda final invalida';
  END IF;
END $post$;
