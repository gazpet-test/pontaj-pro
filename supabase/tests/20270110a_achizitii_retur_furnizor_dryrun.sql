-- Dry-run 20270110a_achizitii_retur_furnizor — DOAR pe clona schemei de producție (PG ca în producție, postgres NOSUPERUSER), NICIODATĂ pe producție.
-- Cere migrarea 20270110a APLICATĂ pe clonă (prin runner, cu L15 v2). Rulare din rădăcina repo-ului:
--   psql -X -v ON_ERROR_STOP=1 -f supabase/tests/20270110a_achizitii_retur_furnizor_dryrun.sql
-- O singură tranzacție, ANULATĂ la final (ROLLBACK). Fixturile NU se bazează pe date existente: D0 creează în tranzacție 3 profiluri SINTETICE
-- (owner, achiziții cu modulul 'achizitii', cont fără drept), cheia de modul 'achizitii' dacă lipsește (FK user_module_access → app_modules) și o
-- comandă de furnizor SINTETICĂ (CMD_T_DRY_001, livrare la sediu, fără proiect) cu repere fictive (DRY_MAT_*). Nimic din datele reale nu se citește
-- sau se schimbă și nimic nu rămâne. Fiecare test se termină cu NOTICE „Dn OK”; orice abatere oprește rularea (RAISE EXCEPTION). Refuzurile se
-- verifică după SQLSTATE și după codul CF_* din mesaj (L25). Aceleași scenarii rulează local pe PGlite (scripts/pglite/test_achizitii_retur_local.mjs).
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;

-- rolul + JWT-ul unui cont (ambele surse: auth.uid() citește întâi request.jwt.claim.sub); 'postgres' = înapoi la operator, fără JWT
CREATE FUNCTION pg_temp.d_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text
                                              ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
-- o instrucțiune ca un cont; întoarce jsonb-ul RPC-ului sau {"sqlstate", "cod"} la refuz (codul CF_* din mesaj)
CREATE FUNCTION pg_temp.d_rpc(p_uid uuid, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $h$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.d_ca(p_uid, 'authenticated');
  BEGIN
    EXECUTE p_sql INTO r;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.d_ca(NULL, 'postgres');
    RETURN jsonb_build_object('sqlstate', SQLSTATE, 'cod', substring(SQLERRM FROM '^(CF_[A-Z_]+):'), 'mesaj', left(SQLERRM, 200));
  END;
  PERFORM pg_temp.d_ca(NULL, 'postgres');
  RETURN r;
END $h$;
CREATE FUNCTION pg_temp.d_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('dretur.' || p, true), ''); $h$;
CREATE FUNCTION pg_temp.d_cheie() RETURNS uuid LANGUAGE sql VOLATILE AS $h$ SELECT gen_random_uuid(); $h$;
GRANT EXECUTE ON FUNCTION pg_temp.d_ca(uuid, text), pg_temp.d_rpc(uuid, text), pg_temp.d_g(text), pg_temp.d_cheie() TO authenticated;

-- D0: identități, drepturi și comanda SINTETICE, create în tranzacție
DO $t$
DECLARE own uuid := 'f0000000-0000-4000-8000-0000000000e0'; ach uuid := 'f0000000-0000-4000-8000-0000000000e1'; fara uuid := 'f0000000-0000-4000-8000-0000000000e2';
  cf bigint; la bigint; lb bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'D0 FAIL: ruleaza ca postgres'; END IF;
  IF to_regclass('public.comenzi_furnizor_retururi') IS NULL THEN RAISE EXCEPTION 'D0 FAIL: migrarea 20270110a nu e aplicata'; END IF;
  IF EXISTS (SELECT 1 FROM public.comenzi_furnizor WHERE numar_comanda LIKE 'CMD\_T\_DRY\_%') THEN RAISE EXCEPTION 'D0 FAIL: CMD_T_DRY_* exista deja'; END IF;
  IF EXISTS (SELECT 1 FROM public.stocuri WHERE material_denumire LIKE 'DRY\_MAT\_%') THEN RAISE EXCEPTION 'D0 FAIL: DRY_MAT_* exista deja in stoc'; END IF;
  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO auth.users (id) SELECT x FROM unnest(ARRAY[own, ach, fara]) x ON CONFLICT (id) DO NOTHING;
  END IF;
  INSERT INTO public.profiles (id, is_owner, role, can_process_achizitii, can_create_comenzi)
  VALUES (own, true, 'teren', false, false), (ach, false, 'teren', true, false), (fara, false, 'teren', false, false)
  ON CONFLICT (id) DO UPDATE SET is_owner = EXCLUDED.is_owner, role = EXCLUDED.role, can_process_achizitii = EXCLUDED.can_process_achizitii,
    can_create_comenzi = EXCLUDED.can_create_comenzi;
  INSERT INTO public.app_modules (key, parent_key, name, is_active, show_on_homepage) VALUES ('achizitii', NULL, 'Achizitii', true, true) ON CONFLICT (key) DO NOTHING;
  DELETE FROM public.user_module_access WHERE profile_id IN (own, ach, fara);
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (ach, 'achizitii', 'editor');
  INSERT INTO public.comenzi_furnizor (numar_comanda, livrare_tip, status) VALUES ('CMD_T_DRY_001', 'sediu', 'emisa') RETURNING id INTO cf;
  -- liniile se adaugă ca de ecran (authenticated): serverul calculează marcajul de reconciliere (comanda nouă = fără intrări vechi)
  PERFORM pg_temp.d_ca(ach, 'authenticated');
  INSERT INTO public.comenzi_furnizor_linii (comanda_furnizor_id, denumire, um, cantitate) VALUES (cf, 'DRY_MAT_A', 'buc', 100) RETURNING id INTO la;
  INSERT INTO public.comenzi_furnizor_linii (comanda_furnizor_id, denumire, um, cantitate) VALUES (cf, 'DRY_MAT_B', 'm', 12.5) RETURNING id INTO lb;
  PERFORM pg_temp.d_ca(NULL, 'postgres');
  IF NOT (SELECT bool_and(intrare_reconciliata) FROM public.comenzi_furnizor_linii WHERE id IN (la, lb)) THEN RAISE EXCEPTION 'D0 FAIL: liniile noi nu sunt reconciliate'; END IF;
  PERFORM set_config('dretur.own', own::text, true); PERFORM set_config('dretur.ach', ach::text, true); PERFORM set_config('dretur.fara', fara::text, true);
  PERFORM set_config('dretur.cf', cf::text, true); PERFORM set_config('dretur.la', la::text, true); PERFORM set_config('dretur.lb', lb::text, true);
  RAISE NOTICE 'D0 OK (cf=%, la=%, lb=%)', cf, la, lb;
END $t$;

-- D1: recepția incrementală (40 + 60) + CAS (formularul vechi nu suprascrie), clientul vechi refuzat
DO $t$
DECLARE ach uuid := pg_temp.d_g('ach')::uuid; la bigint := pg_temp.d_g('la')::bigint; r jsonb;
BEGIN
  r := pg_temp.d_rpc(ach, format('SELECT public.fn_cf_receptie_adauga(%L, %s, 40, NULL)', gen_random_uuid(), la));
  IF r ->> 'sqlstate' IS NOT NULL OR (r ->> 'primita')::numeric <> 40 THEN RAISE EXCEPTION 'D1 FAIL: receptia 40: %', r; END IF;
  r := pg_temp.d_rpc(ach, format('SELECT public.fn_cf_receptie_adauga(%L, %s, 60, 40)', gen_random_uuid(), la));
  IF (r ->> 'primita')::numeric IS DISTINCT FROM 100 THEN RAISE EXCEPTION 'D1 FAIL: receptia +60: %', r; END IF;
  r := pg_temp.d_rpc(ach, format('SELECT public.fn_cf_receptie_adauga(%L, %s, 5, 40)', gen_random_uuid(), la));
  IF r ->> 'cod' IS DISTINCT FROM 'CF_VALOARE_SCHIMBATA' THEN RAISE EXCEPTION 'D1 FAIL: CAS: %', r; END IF;
  r := pg_temp.d_rpc(ach, format('UPDATE public.comenzi_furnizor_linii SET cantitate_primita = 1 WHERE id = %s RETURNING NULL::jsonb', la));
  IF r ->> 'sqlstate' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'D1 FAIL: clientul vechi (authenticated) nu e refuzat pe drept: %', r; END IF;
  BEGIN
    UPDATE public.comenzi_furnizor_linii SET cantitate_primita = 1 WHERE id = la;
    RAISE EXCEPTION 'D1 FAIL: UPDATE direct fara marcaj a trecut';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'CF_CLIENT_VECHI:%' THEN RAISE; END IF;
  END;
  IF (SELECT cantitate_primita FROM public.comenzi_furnizor_linii WHERE id = la) <> 100 THEN RAISE EXCEPTION 'D1 FAIL: primita schimbata'; END IF;
  RAISE NOTICE 'D1 OK';
END $t$;

-- D2: predarea 40, returul 20 + 20 din stoc (intrata 40 → 20 → 0), stoc insuficient, anularea (pune la loc exact), identitatea înghețată
DO $t$
DECLARE ach uuid := pg_temp.d_g('ach')::uuid; la bigint := pg_temp.d_g('la')::bigint; r jsonb; t1 bigint; s numeric;
BEGIN
  r := pg_temp.d_rpc(ach, format('SELECT public.fn_cf_intra_stoc(%L, %s, 40, false)', gen_random_uuid(), la));
  IF (r ->> 'intrata_stoc')::numeric IS DISTINCT FROM 40 THEN RAISE EXCEPTION 'D2 FAIL: predarea: %', r; END IF;
  r := pg_temp.d_rpc(ach, format($s$SELECT public.fn_cf_retur_inregistreaza(%L, %s, 20, 20, 'sediu', NULL, 'reper neconform', NULL, true)$s$, gen_random_uuid(), la));
  t1 := (r ->> 'retur_id')::bigint;
  IF t1 IS NULL OR (r ->> 'intrata_stoc')::numeric <> 20 THEN RAISE EXCEPTION 'D2 FAIL: returul 1: %', r; END IF;
  r := pg_temp.d_rpc(ach, format($s$SELECT public.fn_cf_retur_inregistreaza(%L, %s, 20, 20, 'sediu', NULL, 'reper neconform', NULL, false)$s$, gen_random_uuid(), la));
  IF (r ->> 'intrata_stoc')::numeric IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'D2 FAIL: returul 2: %', r; END IF;
  SELECT cantitate INTO s FROM public.stocuri WHERE locatie_tip = 'sediu' AND locatie_id IS NULL AND material_denumire = 'DRY_MAT_A';
  IF s IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'D2 FAIL: stocul DRY_MAT_A = % (asteptat 0)', s; END IF;
  r := pg_temp.d_rpc(ach, format($s$SELECT public.fn_cf_retur_inregistreaza(%L, %s, 10, 10, 'sediu', NULL, 'reper neconform', NULL, false)$s$, gen_random_uuid(), la));
  IF r ->> 'cod' NOT IN ('CF_DIN_STOC_INVALID', 'CF_STOC_INSUFICIENT') THEN RAISE EXCEPTION 'D2 FAIL: returul fara stoc: %', r; END IF;
  r := pg_temp.d_rpc(ach, format($s$SELECT public.fn_cf_retur_anuleaza(%L, %s, 'retur inregistrat gresit')$s$, gen_random_uuid(), t1));
  IF (r ->> 'pus_inapoi_in_stoc')::numeric IS DISTINCT FROM 20 THEN RAISE EXCEPTION 'D2 FAIL: anularea: %', r; END IF;
  r := pg_temp.d_rpc(ach, format($s$SELECT public.fn_cf_retur_anuleaza(%L, %s, 'retur inregistrat gresit')$s$, gen_random_uuid(), t1));
  IF r ->> 'cod' IS DISTINCT FROM 'CF_DEJA_ANULAT' THEN RAISE EXCEPTION 'D2 FAIL: a doua anulare: %', r; END IF;
  IF (SELECT cantitate FROM public.stocuri WHERE locatie_tip = 'sediu' AND locatie_id IS NULL AND material_denumire = 'DRY_MAT_A') <> 20
     OR (SELECT cantitate_primita FROM public.comenzi_furnizor_linii WHERE id = la) <> 80 OR (SELECT cantitate_intrata_stoc FROM public.comenzi_furnizor_linii WHERE id = la) <> 20 THEN
    RAISE EXCEPTION 'D2 FAIL: starea dupa anulare';
  END IF;
  r := pg_temp.d_rpc(ach, format($s$UPDATE public.comenzi_furnizor_linii SET denumire = 'DRY_MAT_X' WHERE id = %s RETURNING NULL::jsonb$s$, la));
  IF r ->> 'cod' IS DISTINCT FROM 'CF_MATERIAL_RECEPTIONAT' THEN RAISE EXCEPTION 'D2 FAIL: redenumirea dupa receptie: %', r; END IF;
  RAISE NOTICE 'D2 OK';
END $t$;

-- D3: înlocuirea (retur 30 așteaptă; recepție 10 acoperă; renunțare la rest; corectura -10 redeschide doar 10), zecimalele
DO $t$
DECLARE ach uuid := pg_temp.d_g('ach')::uuid; la bigint := pg_temp.d_g('la')::bigint; lb bigint := pg_temp.d_g('lb')::bigint; r jsonb; t bigint; p numeric;
BEGIN
  r := pg_temp.d_rpc(ach, format($s$SELECT public.fn_cf_retur_inregistreaza(%L, %s, 30, 0, 'sediu', NULL, 'lot neconform', NULL, true)$s$, gen_random_uuid(), la));
  t := (r ->> 'retur_id')::bigint;
  IF t IS NULL THEN RAISE EXCEPTION 'D3 FAIL: returul 30: %', r; END IF;
  SELECT cantitate_primita INTO p FROM public.comenzi_furnizor_linii WHERE id = la;
  r := pg_temp.d_rpc(ach, format('SELECT public.fn_cf_receptie_adauga(%L, %s, 10, %s)', gen_random_uuid(), la, p));
  IF (r ->> 'de_inlocuit')::numeric IS DISTINCT FROM 20 THEN RAISE EXCEPTION 'D3 FAIL: inlocuirea 10: %', r; END IF;
  r := pg_temp.d_rpc(ach, format($s$SELECT public.fn_cf_retur_inchide_fara_inlocuire(%L, %s, 'furnizorul nu mai livreaza')$s$, gen_random_uuid(), t));
  IF (r ->> 'renuntat')::numeric IS DISTINCT FROM 20 OR (r ->> 'de_inlocuit')::numeric <> 0 THEN RAISE EXCEPTION 'D3 FAIL: renuntarea: %', r; END IF;
  r := pg_temp.d_rpc(ach, format('SELECT public.fn_cf_receptie_adauga(%L, %s, -10, %s)', gen_random_uuid(), la, p + 10));
  IF (r ->> 'de_inlocuit')::numeric IS DISTINCT FROM 10 THEN RAISE EXCEPTION 'D3 FAIL: corectura dupa renuntare (asteptat de inlocuit 10): %', r; END IF;
  r := pg_temp.d_rpc(ach, format('SELECT public.fn_cf_receptie_adauga(%L, %s, 12.5, NULL)', gen_random_uuid(), lb));
  r := pg_temp.d_rpc(ach, format('SELECT public.fn_cf_intra_stoc(%L, %s, 12.5, false)', gen_random_uuid(), lb));
  r := pg_temp.d_rpc(ach, format($s$SELECT public.fn_cf_retur_inregistreaza(%L, %s, 2.25, NULL, 'sediu', NULL, 'tronson deteriorat', NULL, false)$s$, gen_random_uuid(), lb));
  IF (r ->> 'primita')::numeric IS DISTINCT FROM 10.25 OR (r ->> 'stoc_ramas')::numeric IS DISTINCT FROM 10.25 THEN RAISE EXCEPTION 'D3 FAIL: zecimale: %', r; END IF;
  r := pg_temp.d_rpc(ach, format($s$SELECT public.fn_cf_retur_inregistreaza(%L, %s, 0.0001, NULL, 'sediu', NULL, 'tronson deteriorat', NULL, false)$s$, gen_random_uuid(), lb));
  IF r ->> 'cod' IS DISTINCT FROM 'CF_CANTITATE_INVALIDA' THEN RAISE EXCEPTION 'D3 FAIL: 4 zecimale: %', r; END IF;
  RAISE NOTICE 'D3 OK';
END $t$;

-- D4: dreptul (cont fără drept = 42501 pe fiecare RPC; reconcilierea și ștergerea poziției doar owner), idempotența (aceeași cheie = rezultatul comis)
DO $t$
DECLARE ach uuid := pg_temp.d_g('ach')::uuid; fara uuid := pg_temp.d_g('fara')::uuid; own uuid := pg_temp.d_g('own')::uuid; la bigint := pg_temp.d_g('la')::bigint;
  r jsonb; r2 jsonb; k uuid := gen_random_uuid(); sid bigint; n int;
BEGIN
  FOR r IN SELECT pg_temp.d_rpc(fara, q) FROM unnest(ARRAY[
      format('SELECT public.fn_cf_receptie_adauga(%L, %s, 1, 80)', gen_random_uuid(), la),
      format('SELECT public.fn_cf_intra_stoc(%L, %s, 1, false)', gen_random_uuid(), la),
      format($s$SELECT public.fn_cf_retur_inregistreaza(%L, %s, 1, NULL, 'sediu', NULL, 'reper neconform', NULL, false)$s$, gen_random_uuid(), la),
      format($s$SELECT public.fn_cf_reconciliaza_linie(%L, %s, 0, 'reconciliere de proba')$s$, gen_random_uuid(), la)]) q LOOP
    IF r ->> 'sqlstate' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'D4 FAIL: cont fara drept: %', r; END IF;
  END LOOP;
  r := pg_temp.d_rpc(ach, format($s$SELECT public.fn_cf_reconciliaza_linie(%L, %s, 0, 'reconciliere de proba')$s$, gen_random_uuid(), la));
  IF r ->> 'sqlstate' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'D4 FAIL: reconcilierea de non-owner: %', r; END IF;
  r := pg_temp.d_rpc(ach, format($s$SELECT public.fn_cf_retur_inregistreaza(%L, %s, 5, 5, 'sediu', NULL, 'reper neconform', NULL, false)$s$, k, la));
  r2 := pg_temp.d_rpc(ach, format($s$SELECT public.fn_cf_retur_inregistreaza(%L, %s, 5, 5, 'sediu', NULL, 'reper neconform', NULL, false)$s$, k, la));
  IF r2 ->> 'reluat' IS DISTINCT FROM 'true' OR r2 ->> 'retur_id' IS DISTINCT FROM r ->> 'retur_id' THEN RAISE EXCEPTION 'D4 FAIL: reluarea cheii: % / %', r, r2; END IF;
  SELECT count(*) INTO n FROM public.comenzi_furnizor_retururi WHERE cheie = k;
  IF n <> 1 THEN RAISE EXCEPTION 'D4 FAIL: % randuri pe cheie', n; END IF;
  r2 := pg_temp.d_rpc(ach, format($s$SELECT public.fn_cf_retur_inregistreaza(%L, %s, 6, 5, 'sediu', NULL, 'reper neconform', NULL, false)$s$, k, la));
  IF r2 ->> 'cod' IS DISTINCT FROM 'CF_CHEIE_ALTI_PARAMETRI' THEN RAISE EXCEPTION 'D4 FAIL: cheia cu alt payload: %', r2; END IF;
  SELECT id INTO sid FROM public.stocuri WHERE locatie_tip = 'sediu' AND locatie_id IS NULL AND material_denumire = 'DRY_MAT_A';
  r := pg_temp.d_rpc(own, format('SELECT public.fn_stoc_sterge_pozitie(%s)', sid));
  IF r ->> 'cod' IS DISTINCT FROM 'CF_ISTORIC_PROTEJAT' THEN RAISE EXCEPTION 'D4 FAIL: stergerea pozitiei cu istoric: %', r; END IF;
  r := pg_temp.d_rpc(ach, format('SELECT public.fn_stoc_sterge_pozitie(%s)', sid));
  IF r ->> 'sqlstate' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'D4 FAIL: stergerea de non-owner: %', r; END IF;
  RAISE NOTICE 'D4 OK';
END $t$;

-- D5: invarianții pe liniile probei (sursa independentă: mișcările de stoc și jurnalul)
DO $t$
DECLARE l record;
BEGIN
  FOR l IN SELECT * FROM public.comenzi_furnizor_linii WHERE id IN (pg_temp.d_g('la')::bigint, pg_temp.d_g('lb')::bigint) LOOP
    IF (SELECT coalesce(sum(m.delta), 0) FROM public.stocuri_miscari m WHERE (m.ref_tip = 'comanda_furnizor_linie' AND m.ref_id = l.id)
          OR (m.ref_tip = 'comanda_furnizor_retur' AND m.ref_id IN (SELECT t.id FROM public.comenzi_furnizor_retururi t WHERE t.linie_id = l.id))) <> l.cantitate_intrata_stoc THEN
      RAISE EXCEPTION 'D5 FAIL: miscarile liniei % <> intrata_stoc', l.id;
    END IF;
    IF (SELECT coalesce(sum(CASE WHEN r.tip = 'corectura' THEN -r.cantitate ELSE r.cantitate END), 0) FROM public.comenzi_furnizor_receptii r WHERE r.linie_id = l.id)
       <> l.cantitate_primita + (SELECT coalesce(sum(t.cantitate), 0) FROM public.comenzi_furnizor_retururi t WHERE t.linie_id = l.id AND t.tip = 'retur'
                                   AND NOT EXISTS (SELECT 1 FROM public.comenzi_furnizor_retururi a WHERE a.retur_id = t.id)) THEN
      RAISE EXCEPTION 'D5 FAIL: jurnalul liniei % <> primita + retururi', l.id;
    END IF;
  END LOOP;
  RAISE NOTICE 'D5 OK';
END $t$;

ROLLBACK;
