-- REVENIRE 20270115b_izometrie_ndt_citiri. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (fără amprenta globală).
-- Scoate EXACT ce a pus migrarea: tabelul sud_citiri (cu politica și secvența lui), funcțiile fn_sud_citire_valida / fn_sud_citire_rezerva /
--   fn_sud_citire_salveaza / fn_sud_amprenta_pachet, și repune fn_sud_export_inregistreaza cu corpul 20270114a (aceeași semnătură, ACL păstrat).
-- Refuză (nimic schimbat) dacă: sud_citiri are rânduri (citirile plătite nu se pierd pe tăcute — golirea e o decizie separată a proprietarului),
--   starea nu e cea lăsată de migrare (obiecte lipsă / în plus, corpul înregistrării exportului schimbat), porțile Izometrie nu sunt verzi.
-- Exporturile înregistrate după migrare rămân (fotografia lor are în plus amprenta_pachet, pe care corpul 20270114a o ignoră).
DO $pre$
DECLARE v_plafon text; v_n bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270115b_izometrie_ndt_citiri_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270115b revenire: garda start invalida';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION '20270115b revenire: necesita READ COMMITTED'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session' OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270115b revenire: PLAFON_TRANZACTIE lipsa (cerut 2000/session: livrare_migrare.sh --plafon-tranzactie-ms 2000)';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.sud_citiri') IS NULL
     OR (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'sud\_%') <> 7
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_sud\_%') <> 15
     OR to_regprocedure('public.fn_sud_citire_valida(jsonb)') IS NULL OR to_regprocedure('public.fn_sud_citire_rezerva(bigint, text, text, uuid)') IS NULL
     OR to_regprocedure('public.fn_sud_citire_salveaza(uuid, jsonb, numeric, boolean, text)') IS NULL
     OR to_regprocedure('public.fn_sud_amprenta_pachet(bigint)') IS NULL
     OR (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p
          WHERE p.oid = to_regprocedure('public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text)')) IS DISTINCT FROM '2881656bdc951dd5d53318ccab93feba'
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = to_regclass('public.sud_citiri')) <> 1 THEN
    RAISE EXCEPTION '20270115b revenire: starea nu e cea pusa de migrare (obiecte lipsa sau in plus, corp schimbat); nimic schimbat';
  END IF;
  -- L14: lock ÎNAINTEA verificării „fără date” (o rezervare de citire scrisă între numărare și DROP s-ar pierde); ocupat = refuz (NOWAIT)
  LOCK TABLE public.sud_citiri IN ACCESS EXCLUSIVE MODE NOWAIT;
  SELECT count(*) FROM public.sud_citiri INTO v_n;
  IF v_n > 0 THEN RAISE EXCEPTION '20270115b revenire: exista % cereri de citire in sud_citiri; revenirea nu sterge date (decizie separata)', v_n; END IF;
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270115b revenire: portile Izometrie nu sunt verzi inainte: %', public.fn_izo_porti_lipsa();
  END IF;
END $pre$;

-- corpul 20270114a, VERBATIM (proba PGlite verifică textul față de supabase/migrations/20270114a_izometrie_buletine_ndt.sql)
-- CORP_20270114A_INCEPUT
CREATE OR REPLACE FUNCTION public.fn_sud_export_inregistreaza(p_pachet bigint, p_tip text, p_fotografie jsonb, p_deblocare_id bigint, p_fisier_path text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_proiect bigint; v_tronson bigint; v_id bigint; d public.sud_export_deblocari%ROWTYPE; v_rau text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT proiect_id, tronson_id INTO v_proiect, v_tronson FROM public.executie_pachete_lansare WHERE id = p_pachet FOR UPDATE;
  IF v_proiect IS NULL THEN RAISE EXCEPTION 'sud: pachet inexistent' USING ERRCODE = '22023'; END IF;
  IF p_tip IS NULL OR p_tip NOT IN ('izo', 'inventar') THEN RAISE EXCEPTION 'sud: tip export invalid' USING ERRCODE = '22023'; END IF;
  IF p_fotografie IS NULL OR jsonb_typeof(p_fotografie) <> 'object' OR octet_length(p_fotografie::text) > 2000000
     OR jsonb_typeof(p_fotografie->'buletine') IS DISTINCT FROM 'array' OR jsonb_typeof(p_fotografie->'eliminate') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_fotografie->'metode') IS DISTINCT FROM 'array' OR jsonb_typeof(p_fotografie->'lipsuri_blocante') IS DISTINCT FROM 'array'
     OR coalesce(jsonb_typeof(p_fotografie->'avertismente'), 'array') <> 'array' OR length(p_fisier_path) > 500 THEN
    RAISE EXCEPTION 'sud: fotografia exportului e incompleta (buletine, eliminate, metode, lipsuri_blocante)' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_fotografie->'buletine') e
              WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e->'id') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'versiune') IS DISTINCT FROM 'number'
                 OR e->>'id' !~ '^[0-9]{1,18}$' OR e->>'versiune' !~ '^[0-9]{1,9}$')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_fotografie->'eliminate') e WHERE jsonb_typeof(e) <> 'string')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_fotografie->'metode') e WHERE jsonb_typeof(e) <> 'string') THEN
    RAISE EXCEPTION 'sud: elementele fotografiei au alt tip (buletine {id, versiune} intregi, eliminate / metode text)' USING ERRCODE = '22023';
  END IF;
  IF p_deblocare_id IS NULL THEN
    -- exportul complet: oricine are dreptul de export (ca exportul de azi), doar fără lipsuri blocante
    IF public.fn_sud_drept(v_proiect, 'export') IS NOT TRUE THEN RAISE EXCEPTION 'sud: fara drept de export pe proiect' USING ERRCODE = '42501'; END IF;
    IF jsonb_array_length(p_fotografie->'lipsuri_blocante') > 0 THEN
      RAISE EXCEPTION 'sud: exportul are lipsuri blocante; cere deblocarea managerului de proiect' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF public.fn_sud_drept(v_proiect, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
    SELECT * INTO d FROM public.sud_export_deblocari WHERE id = p_deblocare_id FOR UPDATE;
    IF NOT FOUND OR d.pachet_id <> p_pachet OR d.tip <> p_tip OR d.creat_de <> auth.uid() OR d.folosit_la IS NOT NULL
       OR d.creat_la < now() - interval '1 hour' OR d.lipsuri IS DISTINCT FROM p_fotografie->'lipsuri_blocante' THEN
      RAISE EXCEPTION 'sud: deblocarea nu e valabila pentru acest export' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- sursele: aceleași ca acum (mulțimi întregi, cu dublurile numărate)
  SELECT string_agg(x, ', ' ORDER BY x) INTO v_rau FROM (
    SELECT 'buletine' AS x
     WHERE (SELECT coalesce(array_agg(k ORDER BY k), '{}') FROM (SELECT (e->>'id') || ':' || (e->>'versiune') AS k
                                                                    FROM jsonb_array_elements(p_fotografie->'buletine') e) fb)
           IS DISTINCT FROM
           (SELECT coalesce(array_agg(k ORDER BY k), '{}') FROM (SELECT b.id::text || ':' || b.versiune::text AS k FROM public.sud_buletine b
                                                                   WHERE b.tronson_id = v_tronson AND b.proiect_id = v_proiect AND b.stare = 'confirmat') sb)
    UNION ALL
    SELECT 'eliminate' WHERE (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM jsonb_array_elements_text(p_fotografie->'eliminate') x)
      IS DISTINCT FROM (SELECT coalesce(array_agg(cheie ORDER BY cheie), '{}') FROM public.sud_suduri_eliminate WHERE tronson_id = v_tronson AND activ)
    UNION ALL
    SELECT 'metode' WHERE (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM jsonb_array_elements_text(p_fotografie->'metode') x)
      IS DISTINCT FROM coalesce((SELECT metode FROM public.sud_metode_proiect WHERE proiect_id = v_proiect), '{}')
  ) z;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'sud: sursele s-au schimbat intre verificare si export (%); reincarca fereastra', v_rau USING ERRCODE = '40001'; END IF;
  IF p_deblocare_id IS NOT NULL THEN UPDATE public.sud_export_deblocari SET folosit_la = now() WHERE id = d.id; END IF;
  INSERT INTO public.sud_exporturi (proiect_id, pachet_id, tip, fotografie, incomplet, deblocare_id, fisier_path, creat_de)
  VALUES (v_proiect, p_pachet, p_tip, p_fotografie, p_deblocare_id IS NOT NULL, p_deblocare_id, p_fisier_path, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;
-- CORP_20270114A_SFARSIT
DROP FUNCTION public.fn_sud_amprenta_pachet(bigint);
DROP FUNCTION public.fn_sud_citire_salveaza(uuid, jsonb, numeric, boolean, text);
DROP FUNCTION public.fn_sud_citire_rezerva(bigint, text, text, uuid);
DROP TABLE public.sud_citiri;
DROP FUNCTION public.fn_sud_citire_valida(jsonb);

DO $post$
BEGIN
  IF to_regclass('public.sud_citiri') IS NOT NULL
     OR (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'sud\_%') <> 6
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_sud\_%') <> 11
     OR (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND c.relname LIKE 'sud\_%') <> 5
     OR (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p
          WHERE p.oid = to_regprocedure('public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text)')) IS DISTINCT FROM '6ed3ac6e346c9d9e53fd8b3178874a4a'
     OR NOT has_function_privilege('authenticated', 'public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '20270115b revenire post: starea 20270114a nu e refacuta exact';
  END IF;
  -- ștampilele porților Izometrie, CALCULATE după ultima schimbare (docs/izometrie/PORTI_REGULA.md: revenirea urmează aceeași formă)
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L', 'porti_e3=' || public.fn_izo_porti_e3_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L', 'porti_e3b=' || public.fn_izo_porti_e3b_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS %L', 'porti_e4=' || public.fn_izo_porti_e4_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS %L', 'porti_e4b=' || public.fn_izo_porti_e4b_definitii());
  -- IZO POST
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270115b revenire post: portile Izometrie nu sunt verzi dupa: %', public.fn_izo_porti_lipsa();
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270115b_izometrie_ndt_citiri_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270115b revenire: garda final invalida';
  END IF;
END $post$;
