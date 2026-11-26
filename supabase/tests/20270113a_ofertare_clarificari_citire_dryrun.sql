-- DRY 20270113a_ofertare_clarificari_citire: se ruleaza DUPA 20270113a, intr-o singura tranzactie cu ROLLBACK la final, pe clona PG17
-- (psql -X -v ON_ERROR_STOP=1 -f) sau pe PGlite (scripts/pglite/test_ofertare_clarificari_citire_local.mjs). Nimic nu ramane scris.
-- Conturi si licitatie SINTETICE (fara date reale): u_owner = is_owner; u_of = modulul 'ofertare'; u_sub = DOAR un sub-modul ofertare_*
--   (cheia modulului e exacta, L09: nu da acces); u_alt = alt modul (cel mai folosit pe clona, doar numele lui e citit); u_nimic = niciun modul.
--   Fiecare pas ruleaza ca rolul authenticated cu JWT-ul contului (ambele surse: request.jwt.claim.sub si request.jwt.claims), verificat la fiecare
--   pas: auth.uid(), current_user, rol fara BYPASSRLS; anon = rolul anon fara JWT.
--   t_politica   politica SELECT e cea din 20270113a, celelalte 3 neschimbate, RLS activ, vederea security_invoker (altfel migrarea nu e aplicata);
--   t_fara_acces u_nimic / u_alt / u_sub: 0 randuri in TOT tabelul si in TOATA vederea (inclusiv clarificarile reale ale clonei, doar citite);
--                scrierea directa ramane refuzata (42501), ca inainte;
--   t_cu_acces   u_of si u_owner: vad clarificarile licitatiei de proba (numarate ca postgres) si acelasi numar total ca postgres, in tabel si in
--                vedere; u_of scrie o clarificare (politica de scriere neschimbata) si o vede;
--   t_anon       anon: nimic (0 randuri sau 42501, dupa drepturile tabelului), in tabel si in vedere.
-- Rezultatul asteptat: fiecare sectiune tipareste „DRY 20270113a <nume> OK”, ultima linie „DRY 20270113a TOTUL OK”; orice FAIL opreste (ON_ERROR_STOP).
-- FIXTURI: pe clona, daca ofertare_licitatii / profiles / user_module_access cer alte coloane NOT NULL sau alte valori, se completeaza DOAR aici.
BEGIN;
SET LOCAL search_path = public, pg_temp;
DO $fix$
DECLARE u uuid; m text; v_lic bigint; v_alt text; v_sub text; v_owner boolean;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'DRY 20270113a PRECONDITIE: se ruleaza ca postgres (acum %)', current_user; END IF;
  IF nullif(current_setting('request.jwt.claim.sub', true), '') IS NOT NULL OR nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'DRY 20270113a PRECONDITIE: sesiune proaspata (fara JWT setat inainte)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass AND p.polname = 'clar_all_sel'
                   AND pg_get_expr(p.polqual, p.polrelid) = '((auth.uid() IS NOT NULL) AND ( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare))') THEN
    RAISE EXCEPTION 't_politica FAIL: migrarea 20270113a nu e aplicata (clar_all_sel nu are USING-ul restrans)';
  END IF;
  -- alt modul decat Ofertare: numele celui mai folosit pe clona (doar numele; sub-modulele ofertare_* excluse); fara niciunul = 'logistica'
  SELECT module INTO v_alt FROM public.user_module_access WHERE module <> 'ofertare' AND module NOT LIKE 'ofertare%' GROUP BY module ORDER BY count(*) DESC, module LIMIT 1;
  v_alt := coalesce(v_alt, 'logistica');
  -- un sub-modul ofertare_* existent pe clona (cheia modulului e exacta: nu trebuie sa dea acces); fara niciunul = 'ofertare_clarificari'
  SELECT module INTO v_sub FROM public.user_module_access WHERE module LIKE 'ofertare\_%' GROUP BY module ORDER BY count(*) DESC, module LIMIT 1;
  v_sub := coalesce(v_sub, 'ofertare_clarificari');
  PERFORM set_config('dry.alt', v_alt, true);
  PERFORM set_config('dry.sub', v_sub, true);
  FOR u, m, v_owner IN SELECT * FROM (VALUES ('f0000000-0000-4000-8000-0000000113a1'::uuid, NULL, true), ('f0000000-0000-4000-8000-0000000113a2'::uuid, 'ofertare', false),
                                             ('f0000000-0000-4000-8000-0000000113a3'::uuid, v_sub, false), ('f0000000-0000-4000-8000-0000000113a4'::uuid, v_alt, false),
                                             ('f0000000-0000-4000-8000-0000000113a5'::uuid, NULL, false)) v LOOP
    IF to_regclass('auth.users') IS NOT NULL THEN
      EXECUTE 'INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING' USING u;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'role' AND NOT attisdropped) THEN
      EXECUTE 'INSERT INTO public.profiles (id, is_owner, role) VALUES ($1, $2, ''teren'') ON CONFLICT (id) DO NOTHING' USING u, v_owner;
    ELSE
      INSERT INTO public.profiles (id, is_owner) VALUES (u, v_owner) ON CONFLICT (id) DO NOTHING;
    END IF;
    IF m IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.user_module_access'::regclass AND attname = 'access_level' AND NOT attisdropped) THEN
        EXECUTE 'INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ($1, $2, ''editor'')' USING u, m;
      ELSE
        INSERT INTO public.user_module_access (profile_id, module) VALUES (u, m);
      END IF;
    END IF;
  END LOOP;
  -- licitatia sintetica (fara responsabil) cu doua clarificari: una obisnuita si o ciorna automata auto_planse_* (apare in v_ofertare_clarificari_baza;
  -- baza ei e sintetica: vederea o arata ca „schimbata”, ceea ce e suficient pentru numarare)
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, responsabil_id, stare_loturi) VALUES ('DRY-0113-1', 'DRY AUTORITATE', 'DRY licitatie citire', NULL, 'fara_loturi') RETURNING id INTO v_lic;
  PERFORM set_config('dry.lic', v_lic::text, true);
  INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) VALUES (v_lic, 1, 'DRY intrebare unu', 'propunere');
  INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, sursa, status, origine, cheie, baza_generare)
    VALUES (v_lic, 2, 'Solicitare de clarificare (art. 160–161 din Legea nr. 98/2016) — date cantitative din planșe' || chr(10) || chr(10) || 'text dry', 'planse_auto:',
            'propunere', 'automat', 'auto_planse_1', jsonb_build_object('evaluare', 'r9b', 'amprenta', 'dry', 'la', now(), 'sursa_generare', 'dry', 'text_hash', md5('text dry')));
  RAISE NOTICE 'DRY 20270113a fixturi: licitatia %, modulul alternativ %, sub-modulul %', v_lic, v_alt, v_sub;
END $fix$;
CREATE FUNCTION pg_temp.rd_lic() RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT current_setting('dry.lic')::bigint $f$;
CREATE FUNCTION pg_temp.rd_u(k text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE k WHEN 'owner' THEN 'f0000000-0000-4000-8000-0000000113a1' WHEN 'of' THEN 'f0000000-0000-4000-8000-0000000113a2'
                WHEN 'sub' THEN 'f0000000-0000-4000-8000-0000000113a3' WHEN 'alt' THEN 'f0000000-0000-4000-8000-0000000113a4'
                ELSE 'f0000000-0000-4000-8000-0000000113a5' END::uuid $f$;
-- devine contul k (rolul authenticated, ambele surse JWT), verificat; inapoi la postgres cu rd_postgres(); anon = rd_anon()
CREATE FUNCTION pg_temp.rd_ca(k text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.rd_u(k)::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.rd_u(k)::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM pg_temp.rd_u(k)
     OR (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'rd_ca: identitate gresita (rol %, uid %)', current_user, auth.uid();
  END IF;
END $f$;
CREATE FUNCTION pg_temp.rd_anon() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  IF current_user <> 'anon' OR auth.uid() IS NOT NULL OR (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'rd_anon: rol % / uid %', current_user, auth.uid();
  END IF;
END $f$;
CREATE FUNCTION pg_temp.rd_postgres() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'rd_postgres: rol %', current_user; END IF;
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.rd_lic(), pg_temp.rd_u(text), pg_temp.rd_ca(text), pg_temp.rd_anon(), pg_temp.rd_postgres() TO authenticated, anon;

-- ── t_politica ──
DO $t$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(coalesce(a.nume, '+' || c.nume) || coalesce(': ' || c.detaliu, ''), '; ' ORDER BY coalesce(a.nume, c.nume)) INTO v_rau
    FROM (VALUES
      ('clar_all_sel', 'r|permisiva|{authenticated}|((auth.uid() IS NOT NULL) AND ( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare))|-'),
      ('clar_all_ins', 'a|permisiva|{authenticated}|-|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)'),
      ('clar_all_upd', 'w|permisiva|{authenticated}|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)'),
      ('clar_all_del', 'd|permisiva|{authenticated}|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)|-')
    ) a(nume, detaliu)
    FULL JOIN (SELECT p.polname::text AS nume,
                      p.polcmd::text || '|' || CASE WHEN p.polpermissive THEN 'permisiva' ELSE 'restrictiva' END || '|'
                        || coalesce((SELECT '{' || string_agg(CASE WHEN ro = 0 THEN 'PUBLIC' ELSE ro::regrole::text END, ',' ORDER BY ro::regrole::text) || '}' FROM unnest(p.polroles) ro), '{}')
                        || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') AS detaliu
                 FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass) c ON c.nume = a.nume
   WHERE a.nume IS NULL OR c.nume IS NULL OR a.detaliu IS DISTINCT FROM c.detaliu;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 't_politica FAIL: politicile: %', v_rau; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION 't_politica FAIL: RLS inactiv sau fortat';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.v_ofertare_clarificari_baza'::regclass AND c.relkind = 'v' AND 'security_invoker=on' = ANY (c.reloptions)) THEN
    RAISE EXCEPTION 't_politica FAIL: vederea nu e security_invoker';
  END IF;
  RAISE NOTICE 'DRY 20270113a t_politica OK';
END $t$;

-- ── t_fara_acces ──
DO $t$
DECLARE k text; v int;
BEGIN
  FOREACH k IN ARRAY ARRAY['nimic', 'alt', 'sub'] LOOP
    PERFORM pg_temp.rd_ca(k);
    SELECT count(*) INTO v FROM public.ofertare_clarificari;
    IF v <> 0 THEN RAISE EXCEPTION 't_fara_acces FAIL: contul % (fara Ofertare) vede % clarificari in tabel', k, v; END IF;
    SELECT count(*) INTO v FROM public.v_ofertare_clarificari_baza;
    IF v <> 0 THEN RAISE EXCEPTION 't_fara_acces FAIL: contul % (fara Ofertare) vede % randuri in vedere', k, v; END IF;
    SELECT count(*) INTO v FROM public.ofertare_clarificari WHERE licitatie_id = pg_temp.rd_lic();
    IF v <> 0 THEN RAISE EXCEPTION 't_fara_acces FAIL: contul % vede % clarificari ale licitatiei de proba', k, v; END IF;
    -- scrierea directa: refuzata ca inainte (politica de scriere neschimbata)
    BEGIN
      INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) VALUES (pg_temp.rd_lic(), 9, 'DRY scriere refuzata', 'propunere');
      RAISE EXCEPTION 't_fara_acces FAIL: contul % a scris o clarificare', k;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    PERFORM pg_temp.rd_postgres();
  END LOOP;
  RAISE NOTICE 'DRY 20270113a t_fara_acces OK (nimic, % = %, % = %)', 'alt', current_setting('dry.alt'), 'sub', current_setting('dry.sub');
END $t$;

-- ── t_cu_acces ──
DO $t$
DECLARE k text; v int; v_lic_pg int; v_tot_pg int; v_vlic_pg int; v_vtot_pg int;
BEGIN
  SELECT count(*) INTO v_lic_pg FROM public.ofertare_clarificari WHERE licitatie_id = pg_temp.rd_lic();
  SELECT count(*) INTO v_tot_pg FROM public.ofertare_clarificari;
  SELECT count(*) INTO v_vlic_pg FROM public.v_ofertare_clarificari_baza WHERE licitatie_id = pg_temp.rd_lic();
  SELECT count(*) INTO v_vtot_pg FROM public.v_ofertare_clarificari_baza;
  IF v_lic_pg <> 2 OR v_vlic_pg <> 1 THEN RAISE EXCEPTION 't_cu_acces FAIL: fixtura (astept 2 clarificari, 1 in vedere): % / %', v_lic_pg, v_vlic_pg; END IF;
  FOREACH k IN ARRAY ARRAY['of', 'owner'] LOOP
    PERFORM pg_temp.rd_ca(k);
    SELECT count(*) INTO v FROM public.ofertare_clarificari WHERE licitatie_id = pg_temp.rd_lic();
    IF v <> v_lic_pg THEN RAISE EXCEPTION 't_cu_acces FAIL: contul % vede % din % clarificari ale licitatiei', k, v, v_lic_pg; END IF;
    SELECT count(*) INTO v FROM public.ofertare_clarificari;
    IF v <> v_tot_pg THEN RAISE EXCEPTION 't_cu_acces FAIL: contul % vede % din % clarificari in total', k, v, v_tot_pg; END IF;
    SELECT count(*) INTO v FROM public.v_ofertare_clarificari_baza WHERE licitatie_id = pg_temp.rd_lic();
    IF v <> v_vlic_pg THEN RAISE EXCEPTION 't_cu_acces FAIL: contul % vede % din % randuri ale licitatiei in vedere', k, v, v_vlic_pg; END IF;
    SELECT count(*) INTO v FROM public.v_ofertare_clarificari_baza;
    IF v <> v_vtot_pg THEN RAISE EXCEPTION 't_cu_acces FAIL: contul % vede % din % randuri in vedere, in total', k, v, v_vtot_pg; END IF;
    PERFORM pg_temp.rd_postgres();
  END LOOP;
  -- scrierea cu acces Ofertare merge ca inainte si randul scris e vazut de acelasi cont
  PERFORM pg_temp.rd_ca('of');
  INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) VALUES (pg_temp.rd_lic(), 3, 'DRY intrebare scrisa de of', 'propunere');
  SELECT count(*) INTO v FROM public.ofertare_clarificari WHERE licitatie_id = pg_temp.rd_lic();
  IF v <> v_lic_pg + 1 THEN RAISE EXCEPTION 't_cu_acces FAIL: dupa scriere u_of vede % (astept %)', v, v_lic_pg + 1; END IF;
  PERFORM pg_temp.rd_postgres();
  RAISE NOTICE 'DRY 20270113a t_cu_acces OK (licitatia: % clarificari, % in vedere; total: % / %)', v_lic_pg, v_vlic_pg, v_tot_pg, v_vtot_pg;
END $t$;

-- ── t_anon ──
DO $t$
DECLARE v int; v_cum text;
BEGIN
  PERFORM pg_temp.rd_anon();
  BEGIN
    SELECT count(*) INTO v FROM public.ofertare_clarificari;
    IF v <> 0 THEN RAISE EXCEPTION 't_anon FAIL: anon vede % clarificari', v; END IF;
    v_cum := '0 randuri';
  EXCEPTION WHEN insufficient_privilege THEN v_cum := 'fara drept (42501)';
  END;
  BEGIN
    SELECT count(*) INTO v FROM public.v_ofertare_clarificari_baza;
    IF v <> 0 THEN RAISE EXCEPTION 't_anon FAIL: anon vede % randuri in vedere', v; END IF;
    v_cum := v_cum || '; vedere: 0 randuri';
  EXCEPTION WHEN insufficient_privilege THEN v_cum := v_cum || '; vedere: fara drept (42501)';
  END;
  PERFORM pg_temp.rd_postgres();
  RAISE NOTICE 'DRY 20270113a t_anon OK (%)', v_cum;
END $t$;
DO $t$ BEGIN RAISE NOTICE 'DRY 20270113a TOTUL OK'; END $t$;
ROLLBACK;
