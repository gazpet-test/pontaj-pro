-- DRY 20270115a_ofertare_clarificari_puncte_citire: se ruleaza DUPA 20270115a, intr-o singura tranzactie cu ROLLBACK la final, pe clona PG17
-- (psql -X -v ON_ERROR_STOP=1 -f) sau pe PGlite (scripts/pglite/test_ofertare_clarificari_puncte_citire_local.mjs). Nimic nu ramane scris.
-- Conturi, licitatii, clarificari si puncte SINTETICE (fara date reale):
--   u_owner = is_owner; u_of = modulul 'ofertare' (editor), NU e responsabil; u_resp = modulul 'ofertare' + responsabil 1 al licitatiei L1, numit de
--   u_owner (dovada 2A: responsabil_setat_de = owner, responsabil_numitor_autorizat = true — pe clona le scrie si triggerul fn_ofertare_responsabil_setat_de,
--   fiindca INSERT-ul ruleaza cu JWT-ul ownerului; aici sunt scrise si explicit, pentru o baza fara trigger); u_resp2 = modulul + responsabil 2 al L1
--   (la fel); u_auto = modulul + responsabil 1 al L3, numit de EL INSUSI (JWT-ul lui la INSERT → dovada false); u_rfm = responsabil 1 al L2 numit de
--   owner, dar FARA modulul Ofertare; u_sub = DOAR un sub-modul ofertare_*; u_nimic = niciun modul.
--   Fiecare pas ruleaza ca rolul authenticated cu JWT-ul contului (ambele surse: request.jwt.claim.sub si request.jwt.claims), verificat la fiecare
--   pas: auth.uid(), current_user, rol fara BYPASSRLS; anon = rolul anon fara JWT.
--   t_politica    politicile sunt cele din 20270115a, functia exista cu drepturile exacte, RLS activ (altfel migrarea nu e aplicata);
--   t_fara_drept  u_of / u_sub / u_nimic / u_auto (pe L3) / u_rfm (pe L2, fara modul): 0 randuri in TOT tabelul (inclusiv punctele reale ale clonei, doar
--                 citite) si pe fiecare clarificare de proba; INSERT = 42501; UPDATE / DELETE ating 0 randuri; RPC-ul fn_ofertare_clar_puncte_poarta = false;
--   t_cu_drept    u_resp / u_resp2 vad EXACT punctele clarificarii C1 (2) si nimic de pe C2 / C3; u_resp scrie un punct pe C1 (si il vede), schimba
--                 rezolutia (triggerul semneaza cu auth.uid() = u_resp), NU poate scrie pe C2 (42501); u_owner vede acelasi numar total ca postgres
--                 (toate punctele clonei) si poate scrie pe orice clarificare; RPC-ul = true pe C1 pentru u_resp, false pe C2;
--   t_parinte     garda pe ofertare_clarificari: u_of nu sterge C1 (are puncte; 42501) dar editeaza / sterge o clarificare fara puncte (ca azi); nimeni
--                 din aplicatie (u_of, u_owner, u_resp) nu muta o clarificare pe alta licitatie (cu sau fara puncte; 42501); u_resp sterge C1 (cascada =
--                 punctele licitatiei lui); C1 si punctele ei raman intacte pana atunci;
--   t_anon        anon: nimic (0 randuri sau 42501).
-- Rezultatul asteptat: fiecare sectiune tipareste „DRY 20270115a <nume> OK”, ultima linie „DRY 20270115a TOTUL OK”; orice FAIL opreste (ON_ERROR_STOP).
-- FIXTURI: pe clona, daca ofertare_licitatii / profiles / user_module_access cer alte coloane NOT NULL sau alte valori, se completeaza DOAR aici.
--   UUID-urile sintetice (f0000000-…-0000000115aN) nu trebuie sa existe pe clona (ON CONFLICT DO NOTHING pe profiles pastreaza un profil existent cu acel
--   id — verifica inainte ca nu exista). ROLLBACK-ul readuce randurile si obiectele, nu si valorile secventelor identity (consumate; fara efect functional).
BEGIN;
SET LOCAL search_path = public, pg_temp;
CREATE FUNCTION pg_temp.rd_u(k text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE k WHEN 'owner' THEN 'f0000000-0000-4000-8000-0000000115a1' WHEN 'of' THEN 'f0000000-0000-4000-8000-0000000115a2'
                WHEN 'resp' THEN 'f0000000-0000-4000-8000-0000000115a3' WHEN 'resp2' THEN 'f0000000-0000-4000-8000-0000000115a4'
                WHEN 'auto' THEN 'f0000000-0000-4000-8000-0000000115a5' WHEN 'rfm' THEN 'f0000000-0000-4000-8000-0000000115a6'
                WHEN 'sub' THEN 'f0000000-0000-4000-8000-0000000115a7' ELSE 'f0000000-0000-4000-8000-0000000115a8' END::uuid $f$;
-- JWT-ul contului k, ca postgres (pentru triggerele care citesc auth.uid() la INSERT-urile fixturilor); '' = fara JWT
CREATE FUNCTION pg_temp.rd_jwt(k text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF k = '' THEN
    PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM set_config('request.jwt.claims', '', true);
  ELSE
    PERFORM set_config('request.jwt.claim.sub', pg_temp.rd_u(k)::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.rd_u(k)::text, 'role', 'authenticated')::text, true);
  END IF;
END $f$;
DO $fix$
DECLARE u uuid; m text; v_owner boolean; v_alt text; v_sub text; l1 bigint; l2 bigint; l3 bigint; c1 bigint; c2 bigint; c3 bigint;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'DRY 20270115a PRECONDITIE: se ruleaza ca postgres (acum %)', current_user; END IF;
  IF nullif(current_setting('request.jwt.claim.sub', true), '') IS NOT NULL OR nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'DRY 20270115a PRECONDITIE: sesiune proaspata (fara JWT setat inainte)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass AND p.polname = 'clar_puncte_sel'
                   AND pg_get_expr(p.polqual, p.polrelid) = 'fn_ofertare_clar_puncte_poarta(clarificare_id)') THEN
    RAISE EXCEPTION 't_politica FAIL: migrarea 20270115a nu e aplicata (clar_puncte_sel nu e pe poarta noua)';
  END IF;
  -- UUID-urile sintetice nu trebuie sa existe (garda executabila, nu doar nota: ON CONFLICT DO NOTHING ar pastra un profil strain cu alt is_owner)
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id::text LIKE 'f0000000-0000-4000-8000-0000000115a%')
     OR (to_regclass('auth.users') IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE 'f0000000-0000-4000-8000-0000000115a%')) THEN
    RAISE EXCEPTION 'DRY 20270115a PRECONDITIE: exista deja conturi cu UUID-urile sintetice f0000000-…-0000000115aN';
  END IF;
  -- alt modul decat Ofertare (doar numele) si un sub-modul ofertare_* (cheia modulului e exacta: nu trebuie sa dea acces)
  SELECT module INTO v_alt FROM public.user_module_access WHERE module <> 'ofertare' AND module NOT LIKE 'ofertare%' GROUP BY module ORDER BY count(*) DESC, module LIMIT 1;
  v_alt := coalesce(v_alt, 'logistica');
  SELECT module INTO v_sub FROM public.user_module_access WHERE module LIKE 'ofertare\_%' GROUP BY module ORDER BY count(*) DESC, module LIMIT 1;
  IF v_sub IS NULL AND to_regclass('public.app_modules') IS NOT NULL THEN EXECUTE 'SELECT key FROM public.app_modules WHERE key LIKE ''ofertare\_%'' ORDER BY key LIMIT 1' INTO v_sub; END IF;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'fixturi: nu exista niciun sub-modul ofertare_*'; END IF;
  FOR u, m, v_owner IN SELECT * FROM (VALUES (pg_temp.rd_u('owner'), NULL, true), (pg_temp.rd_u('of'), 'ofertare', false), (pg_temp.rd_u('resp'), 'ofertare', false),
                                             (pg_temp.rd_u('resp2'), 'ofertare', false), (pg_temp.rd_u('auto'), 'ofertare', false), (pg_temp.rd_u('rfm'), NULL, false),
                                             (pg_temp.rd_u('sub'), v_sub, false), (pg_temp.rd_u('nimic'), NULL, false)) v LOOP
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
  -- L1: responsabil 1 = u_resp, responsabil 2 = u_resp2, numiti de owner (JWT-ul ownerului la INSERT → triggerul 20261124a scrie dovada true; valorile
  -- explicite sunt aceleasi, pentru o baza fara trigger). L2: responsabil u_rfm numit de owner. L3: u_auto numit de el insusi (dovada false).
  PERFORM pg_temp.rd_jwt('owner');
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, stare_loturi, responsabil_id, responsabil_setat_de, responsabil_numitor_autorizat,
                                         responsabil2_id, responsabil2_setat_de, responsabil2_numitor_autorizat)
    VALUES ('DRY-0114-1', 'DRY AUTORITATE', 'DRY licitatie puncte', 'fara_loturi', pg_temp.rd_u('resp'), pg_temp.rd_u('owner'), true,
            pg_temp.rd_u('resp2'), pg_temp.rd_u('owner'), true) RETURNING id INTO l1;
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, stare_loturi, responsabil_id, responsabil_setat_de, responsabil_numitor_autorizat)
    VALUES ('DRY-0114-2', 'DRY AUTORITATE', 'DRY licitatie fara modul', 'fara_loturi', pg_temp.rd_u('rfm'), pg_temp.rd_u('owner'), true) RETURNING id INTO l2;
  PERFORM pg_temp.rd_jwt('auto');
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, stare_loturi, responsabil_id, responsabil_setat_de, responsabil_numitor_autorizat)
    VALUES ('DRY-0114-3', 'DRY AUTORITATE', 'DRY licitatie autonumit', 'fara_loturi', pg_temp.rd_u('auto'), pg_temp.rd_u('auto'), false) RETURNING id INTO l3;
  PERFORM pg_temp.rd_jwt('');
  -- dovada 2A asa cum a ramas in tabel (cu sau fara trigger): L1 / L2 numite de owner cu dovada true, L3 autonumita cu dovada false
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE id = l1 AND responsabil_setat_de = pg_temp.rd_u('owner') AND responsabil_numitor_autorizat IS TRUE
                   AND responsabil2_setat_de = pg_temp.rd_u('owner') AND responsabil2_numitor_autorizat IS TRUE)
     OR NOT EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE id = l2 AND responsabil_setat_de = pg_temp.rd_u('owner') AND responsabil_numitor_autorizat IS TRUE)
     OR NOT EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE id = l3 AND responsabil_setat_de = pg_temp.rd_u('auto') AND responsabil_numitor_autorizat IS FALSE) THEN
    RAISE EXCEPTION 'fixturi FAIL: dovezile de numire nu au iesit cum trebuie (trigger sau coloane diferite): %',
      (SELECT string_agg(id || ':' || coalesce(responsabil_setat_de::text, '-') || '/' || coalesce(responsabil_numitor_autorizat::text, '-'), ', ') FROM public.ofertare_licitatii WHERE id IN (l1, l2, l3));
  END IF;
  INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status, origine) VALUES (l1, 1, 'DRY intrebare L1', 'propunere', 'manual') RETURNING id INTO c1;
  INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status, origine) VALUES (l2, 1, 'DRY intrebare L2', 'propunere', 'manual') RETURNING id INTO c2;
  INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status, origine) VALUES (l3, 1, 'DRY intrebare L3', 'propunere', 'manual') RETURNING id INTO c3;
  INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (c1, 1, 'DRY punct 1'), (c1, 2, 'DRY punct 2'), (c2, 1, 'DRY punct L2'), (c3, 1, 'DRY punct L3');
  PERFORM set_config('dry.l1', l1::text, true); PERFORM set_config('dry.l2', l2::text, true); PERFORM set_config('dry.l3', l3::text, true);
  PERFORM set_config('dry.c1', c1::text, true); PERFORM set_config('dry.c2', c2::text, true); PERFORM set_config('dry.c3', c3::text, true);
  PERFORM set_config('dry.alt', v_alt, true); PERFORM set_config('dry.sub', v_sub, true);
  RAISE NOTICE 'DRY 20270115a fixturi: licitatiile % / % / %, clarificarile % / % / %, sub-modulul %', l1, l2, l3, c1, c2, c3, v_sub;
END $fix$;
CREATE FUNCTION pg_temp.rd_c(k text) RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT current_setting('dry.' || k)::bigint $f$;
-- devine contul k (rolul authenticated, ambele surse JWT), verificat; inapoi la postgres cu rd_postgres(); anon = rd_anon()
CREATE FUNCTION pg_temp.rd_ca(k text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.rd_jwt(k);
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
  PERFORM pg_temp.rd_jwt('');
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'rd_postgres: rol %', current_user; END IF;
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.rd_u(text), pg_temp.rd_jwt(text), pg_temp.rd_c(text), pg_temp.rd_ca(text), pg_temp.rd_anon(), pg_temp.rd_postgres() TO authenticated, anon;

-- ── t_politica ──
DO $t$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(coalesce(a.nume, '+' || c.nume) || coalesce(': ' || c.detaliu, ''), '; ' ORDER BY coalesce(a.nume, c.nume)) INTO v_rau
    FROM (VALUES
      ('clar_puncte_sel', 'r|permisiva|{authenticated}|fn_ofertare_clar_puncte_poarta(clarificare_id)|-'),
      ('clar_puncte_rw', '*|permisiva|{authenticated}|fn_ofertare_clar_puncte_poarta(clarificare_id)|fn_ofertare_clar_puncte_poarta(clarificare_id)')
    ) a(nume, detaliu)
    FULL JOIN (SELECT p.polname::text AS nume,
                      p.polcmd::text || '|' || CASE WHEN p.polpermissive THEN 'permisiva' ELSE 'restrictiva' END || '|'
                        || coalesce((SELECT '{' || string_agg(CASE WHEN ro = 0 THEN 'PUBLIC' ELSE ro::regrole::text END, ',' ORDER BY ro::regrole::text) || '}' FROM unnest(p.polroles) ro), '{}')
                        || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') AS detaliu
                 FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass) c ON c.nume = a.nume
   WHERE a.nume IS NULL OR c.nume IS NULL OR a.detaliu IS DISTINCT FROM c.detaliu;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 't_politica FAIL: politicile: %', v_rau; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION 't_politica FAIL: RLS inactiv sau fortat';
  END IF;
  IF (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
        SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type AS d FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
         WHERE p.oid = to_regprocedure('public.fn_ofertare_clar_puncte_poarta(bigint)') AND e.grantee <> 0) a) IS DISTINCT FROM 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE'
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE p.oid = to_regprocedure('public.fn_ofertare_clar_puncte_poarta(bigint)') AND e.grantee = 0) THEN
    RAISE EXCEPTION 't_politica FAIL: drepturile functiei fn_ofertare_clar_puncte_poarta nu sunt cele asteptate';
  END IF;
  RAISE NOTICE 'DRY 20270115a t_politica OK';
END $t$;

-- ── t_fara_drept ──
DO $t$
DECLARE k text; v int; v_p boolean; n_upd int;
BEGIN
  FOREACH k IN ARRAY ARRAY['of', 'sub', 'nimic', 'auto', 'rfm'] LOOP
    PERFORM pg_temp.rd_ca(k);
    SELECT count(*) INTO v FROM public.ofertare_clarificari_puncte;
    IF v <> 0 THEN RAISE EXCEPTION 't_fara_drept FAIL: contul % vede % puncte in tabel', k, v; END IF;
    SELECT count(*) INTO v FROM public.ofertare_clarificari_puncte WHERE clarificare_id IN (pg_temp.rd_c('c1'), pg_temp.rd_c('c2'), pg_temp.rd_c('c3'));
    IF v <> 0 THEN RAISE EXCEPTION 't_fara_drept FAIL: contul % vede % puncte ale clarificarilor de proba', k, v; END IF;
    SELECT public.fn_ofertare_clar_puncte_poarta(pg_temp.rd_c('c1')) INTO v_p;
    IF v_p IS DISTINCT FROM false THEN RAISE EXCEPTION 't_fara_drept FAIL: poarta pentru contul % pe C1 = %', k, v_p; END IF;
    BEGIN
      INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (pg_temp.rd_c('c1'), 9, 'DRY scriere refuzata ' || k);
      RAISE EXCEPTION 't_fara_drept FAIL: contul % a scris un punct', k;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    UPDATE public.ofertare_clarificari_puncte SET text = text || '!' WHERE clarificare_id = pg_temp.rd_c('c1');
    GET DIAGNOSTICS n_upd = ROW_COUNT;
    IF n_upd <> 0 THEN RAISE EXCEPTION 't_fara_drept FAIL: contul % a modificat % puncte', k, n_upd; END IF;
    DELETE FROM public.ofertare_clarificari_puncte WHERE clarificare_id = pg_temp.rd_c('c1');
    GET DIAGNOSTICS n_upd = ROW_COUNT;
    IF n_upd <> 0 THEN RAISE EXCEPTION 't_fara_drept FAIL: contul % a sters % puncte', k, n_upd; END IF;
    PERFORM pg_temp.rd_postgres();
  END LOOP;
  -- autonumitul (L3) si responsabilul fara modul (L2): nici pe clarificarea „lor”
  PERFORM pg_temp.rd_ca('auto');
  SELECT count(*) INTO v FROM public.ofertare_clarificari_puncte WHERE clarificare_id = pg_temp.rd_c('c3');
  IF v <> 0 OR public.fn_ofertare_clar_puncte_poarta(pg_temp.rd_c('c3')) IS DISTINCT FROM false THEN RAISE EXCEPTION 't_fara_drept FAIL: autonumitul vede % puncte pe C3', v; END IF;
  PERFORM pg_temp.rd_postgres();
  PERFORM pg_temp.rd_ca('rfm');
  SELECT count(*) INTO v FROM public.ofertare_clarificari_puncte WHERE clarificare_id = pg_temp.rd_c('c2');
  IF v <> 0 OR public.fn_ofertare_clar_puncte_poarta(pg_temp.rd_c('c2')) IS DISTINCT FROM false THEN RAISE EXCEPTION 't_fara_drept FAIL: responsabilul fara modul vede % puncte pe C2', v; END IF;
  PERFORM pg_temp.rd_postgres();
  RAISE NOTICE 'DRY 20270115a t_fara_drept OK (of, sub = %, nimic, auto, rfm)', current_setting('dry.sub');
END $t$;

-- ── t_cu_drept ──
DO $t$
DECLARE k text; v int; v_tot_pg int; v_id bigint; v_de uuid; v_p boolean; n_upd int;
BEGIN
  SELECT count(*) INTO v_tot_pg FROM public.ofertare_clarificari_puncte;
  IF (SELECT count(*) FROM public.ofertare_clarificari_puncte WHERE clarificare_id = pg_temp.rd_c('c1')) <> 2 THEN RAISE EXCEPTION 't_cu_drept FAIL: fixtura (astept 2 puncte pe C1)'; END IF;
  FOREACH k IN ARRAY ARRAY['resp', 'resp2'] LOOP
    PERFORM pg_temp.rd_ca(k);
    SELECT count(*) INTO v FROM public.ofertare_clarificari_puncte WHERE clarificare_id = pg_temp.rd_c('c1');
    IF v <> 2 THEN RAISE EXCEPTION 't_cu_drept FAIL: contul % vede % din 2 puncte pe C1', k, v; END IF;
    SELECT count(*) INTO v FROM public.ofertare_clarificari_puncte WHERE clarificare_id IN (pg_temp.rd_c('c2'), pg_temp.rd_c('c3'));
    IF v <> 0 THEN RAISE EXCEPTION 't_cu_drept FAIL: contul % vede % puncte pe C2 / C3 (alte licitatii)', k, v; END IF;
    SELECT count(*) INTO v FROM public.ofertare_clarificari_puncte;
    IF v <> 2 THEN RAISE EXCEPTION 't_cu_drept FAIL: contul % vede % puncte in total (astept doar cele 2 ale licitatiei lui)', k, v; END IF;
    IF public.fn_ofertare_clar_puncte_poarta(pg_temp.rd_c('c1')) IS DISTINCT FROM true OR public.fn_ofertare_clar_puncte_poarta(pg_temp.rd_c('c2')) IS DISTINCT FROM false
       OR public.fn_ofertare_clar_puncte_poarta(999999999) IS DISTINCT FROM false THEN
      RAISE EXCEPTION 't_cu_drept FAIL: poarta pentru % nu e (true pe C1, false pe C2, false pe inexistenta)', k;
    END IF;
    PERFORM pg_temp.rd_postgres();
  END LOOP;
  -- u_resp scrie pe C1 si il vede; schimba rezolutia → triggerul semneaza cu auth.uid(); pe C2 scrierea e refuzata
  PERFORM pg_temp.rd_ca('resp');
  INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (pg_temp.rd_c('c1'), 3, 'DRY punct scris de resp') RETURNING id INTO v_id;
  SELECT count(*) INTO v FROM public.ofertare_clarificari_puncte WHERE clarificare_id = pg_temp.rd_c('c1');
  IF v <> 3 THEN RAISE EXCEPTION 't_cu_drept FAIL: dupa scriere u_resp vede % (astept 3)', v; END IF;
  UPDATE public.ofertare_clarificari_puncte SET rezolutie = 'rezolvat' WHERE id = v_id;
  GET DIAGNOSTICS n_upd = ROW_COUNT;
  SELECT rezolvat_de INTO v_de FROM public.ofertare_clarificari_puncte WHERE id = v_id;
  IF n_upd <> 1 OR v_de IS DISTINCT FROM pg_temp.rd_u('resp') THEN RAISE EXCEPTION 't_cu_drept FAIL: rezolutia (% randuri) semnata de % (astept u_resp)', n_upd, v_de; END IF;
  BEGIN
    INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (pg_temp.rd_c('c2'), 9, 'DRY scriere refuzata pe alta licitatie');
    RAISE EXCEPTION 't_cu_drept FAIL: u_resp a scris pe C2 (alta licitatie)';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.rd_postgres();
  -- ownerul: tot (acelasi total ca postgres, inclusiv punctele reale ale clonei), scrie pe orice clarificare
  PERFORM pg_temp.rd_ca('owner');
  SELECT count(*) INTO v FROM public.ofertare_clarificari_puncte;
  IF v <> v_tot_pg + 1 THEN RAISE EXCEPTION 't_cu_drept FAIL: ownerul vede % din % puncte', v, v_tot_pg + 1; END IF;
  INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (pg_temp.rd_c('c3'), 2, 'DRY punct scris de owner pe L3');
  IF public.fn_ofertare_clar_puncte_poarta(pg_temp.rd_c('c1')) IS DISTINCT FROM true OR public.fn_ofertare_clar_puncte_poarta(pg_temp.rd_c('c3')) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 't_cu_drept FAIL: poarta ownerului nu e true pe C1 / C3';
  END IF;
  PERFORM pg_temp.rd_postgres();
  RAISE NOTICE 'DRY 20270115a t_cu_drept OK (total puncte ca postgres: %)', v_tot_pg + 2;
END $t$;

-- ── t_parinte (garda pe ofertare_clarificari: mutarea / stergerea unei clarificari cu puncte, de catre client) ──
DO $t$
DECLARE n_upd int; c_fara bigint;
BEGIN
  -- u_of (modul, fara poarta): nu muta si nu sterge C1 (are puncte); poate muta / sterge o clarificare FARA puncte (ca azi)
  PERFORM pg_temp.rd_ca('of');
  BEGIN
    UPDATE public.ofertare_clarificari SET licitatie_id = pg_temp.rd_c('l2'), nr = 97 WHERE id = pg_temp.rd_c('c1');
    RAISE EXCEPTION 't_parinte FAIL: u_of a mutat clarificarea C1 (cu puncte) pe L2';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.ofertare_clarificari WHERE id = pg_temp.rd_c('c1');
    RAISE EXCEPTION 't_parinte FAIL: u_of a sters clarificarea C1 (cu puncte)';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status, origine) VALUES (pg_temp.rd_c('l1'), 98, 'DRY fara puncte', 'propunere', 'manual') RETURNING id INTO c_fara;
  -- mutarea pe alta licitatie e refuzata din aplicatie si FARA puncte (r2: cursa cu primul punct inserat concurent)
  BEGIN
    UPDATE public.ofertare_clarificari SET licitatie_id = pg_temp.rd_c('l2') WHERE id = c_fara;
    RAISE EXCEPTION 't_parinte FAIL: u_of a mutat o clarificare (fara puncte) pe alta licitatie';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.ofertare_clarificari SET intrebare = intrebare || ' (editata)' WHERE id = c_fara;
  GET DIAGNOSTICS n_upd = ROW_COUNT;
  IF n_upd <> 1 THEN RAISE EXCEPTION 't_parinte FAIL: u_of nu a putut edita o clarificare fara puncte (% randuri)', n_upd; END IF;
  DELETE FROM public.ofertare_clarificari WHERE id = c_fara;
  GET DIAGNOSTICS n_upd = ROW_COUNT;
  IF n_upd <> 1 THEN RAISE EXCEPTION 't_parinte FAIL: u_of nu a putut sterge o clarificare fara puncte (% randuri)', n_upd; END IF;
  PERFORM pg_temp.rd_postgres();
  IF (SELECT licitatie_id FROM public.ofertare_clarificari WHERE id = pg_temp.rd_c('c1')) <> pg_temp.rd_c('l1')
     OR (SELECT count(*) FROM public.ofertare_clarificari_puncte WHERE clarificare_id = pg_temp.rd_c('c1')) <> 3 THEN
    RAISE EXCEPTION 't_parinte FAIL: C1 sau punctele ei s-au schimbat';
  END IF;
  -- u_resp (poarta pe L1): nici el nu muta C1 (mutarea nu e flux de client); poate sterge C1 (cascada = punctele lui); u_owner nu muta nici el
  PERFORM pg_temp.rd_ca('owner');
  BEGIN
    UPDATE public.ofertare_clarificari SET licitatie_id = pg_temp.rd_c('l2'), nr = 97 WHERE id = pg_temp.rd_c('c1');
    RAISE EXCEPTION 't_parinte FAIL: u_owner a mutat clarificarea C1 pe alta licitatie din aplicatie';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.rd_postgres();
  PERFORM pg_temp.rd_ca('resp');
  BEGIN
    UPDATE public.ofertare_clarificari SET licitatie_id = pg_temp.rd_c('l2'), nr = 97 WHERE id = pg_temp.rd_c('c1');
    RAISE EXCEPTION 't_parinte FAIL: u_resp a mutat clarificarea C1 (cu puncte) pe alta licitatie';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  DELETE FROM public.ofertare_clarificari WHERE id = pg_temp.rd_c('c1');
  GET DIAGNOSTICS n_upd = ROW_COUNT;
  IF n_upd <> 1 THEN RAISE EXCEPTION 't_parinte FAIL: u_resp nu a putut sterge clarificarea C1 a licitatiei lui (% randuri)', n_upd; END IF;
  PERFORM pg_temp.rd_postgres();
  IF EXISTS (SELECT 1 FROM public.ofertare_clarificari WHERE id = pg_temp.rd_c('c1')) OR EXISTS (SELECT 1 FROM public.ofertare_clarificari_puncte WHERE clarificare_id = pg_temp.rd_c('c1')) THEN
    RAISE EXCEPTION 't_parinte FAIL: C1 sau punctele ei au ramas dupa stergerea de catre responsabil';
  END IF;
  RAISE NOTICE 'DRY 20270115a t_parinte OK';
END $t$;

-- ── t_anon ──
DO $t$
DECLARE v int; v_cum text;
BEGIN
  PERFORM pg_temp.rd_anon();
  BEGIN
    SELECT count(*) INTO v FROM public.ofertare_clarificari_puncte;
    IF v <> 0 THEN RAISE EXCEPTION 't_anon FAIL: anon vede % puncte', v; END IF;
    v_cum := '0 randuri';
  EXCEPTION WHEN insufficient_privilege THEN v_cum := 'fara drept (42501)';
  END;
  BEGIN
    PERFORM public.fn_ofertare_clar_puncte_poarta(pg_temp.rd_c('c1'));
    RAISE EXCEPTION 't_anon FAIL: anon poate chema poarta';
  EXCEPTION WHEN insufficient_privilege THEN v_cum := v_cum || '; functia: fara drept (42501)';
  END;
  PERFORM pg_temp.rd_postgres();
  RAISE NOTICE 'DRY 20270115a t_anon OK (%)', v_cum;
END $t$;
DO $t$ BEGIN RAISE NOTICE 'DRY 20270115a TOTUL OK'; END $t$;
ROLLBACK;
