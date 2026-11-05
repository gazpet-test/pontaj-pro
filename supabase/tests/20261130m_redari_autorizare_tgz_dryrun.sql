-- DRY 20261130m_redari_autorizare_tgz. Runner: o singura tranzactie ANULATA (BEGIN + marcaj + migrare + acest fisier + ROLLBACK).
-- Identitati REALE (owner + admin Redari ne-owner din user_module_access), simulate prin request.jwt.claims + SET LOCAL ROLE authenticated / anon.
-- Proiectul TEST-RAZVAN; un obiect fictiv in storage.objects (bucket redari), anulat la ROLLBACK. La final: RESET ROLE + claims goale.
CREATE FUNCTION pg_temp.r30m_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
CREATE FUNCTION pg_temp.r30m_stare(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $h$;
CREATE FUNCTION pg_temp.r30m_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r30m.' || p, true), ''); $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r30m_ca(uuid, text), pg_temp.r30m_stare(text), pg_temp.r30m_g(text) TO authenticated, anon, service_role;

-- TEST0: garda, identitati, proiect; nimic publicat; obiectul fictiv din storage
DO $t$
DECLARE ow uuid; ad uuid; pr uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130m_redari_autorizare_tgz:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: garda';
  END IF;
  SELECT id INTO ow FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT uma.profile_id INTO ad FROM public.user_module_access uma JOIN public.profiles p ON p.id = uma.profile_id
   WHERE uma.module = 'redari' AND uma.access_level = 'admin' AND p.is_owner IS NOT TRUE ORDER BY uma.profile_id LIMIT 1;
  SELECT id INTO pr FROM public.red_proiecte WHERE cod = 'TEST-RAZVAN';
  IF ow IS NULL OR ad IS NULL OR pr IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati / proiect (owner %, admin %, proiect %)', ow IS NOT NULL, ad IS NOT NULL, pr IS NOT NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.red_proiecte WHERE public.fn_red_informare_publicata(cod)) THEN RAISE EXCEPTION 'TEST0 FAIL: ceva publicat'; END IF;
  INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('redari', 'TEST-RAZVAN/autorizare_tgz/1_dry30m.pdf', ow::text);
  INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('redari', 'LOT1-PRUNISOR-JUPA/autorizare_tgz/1_dry30m.pdf', ow::text);
  PERFORM set_config('r30m.ow', ow::text, true); PERFORM set_config('r30m.ad', ad::text, true); PERFORM set_config('r30m.pr', pr::text, true);
  RAISE NOTICE 'TEST0 OK';
END $t$;

-- TEST1: adminul ne-owner nu poate scrie autorizarea (42501), dar poate schimba alte campuri; _de / _la nu se scriu de mana
DO $t$
DECLARE s text; r record;
BEGIN
  PERFORM pg_temp.r30m_ca(pg_temp.r30m_g('ad')::uuid, 'authenticated');
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_proiecte SET autorizare_tgz_nr = 'X' WHERE id = %L$q$, pg_temp.r30m_g('pr')));
  IF s IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'TEST1 FAIL: admin ne-owner a scris nr (%)', s; END IF;
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_proiecte SET autorizare_tgz_fisier = 'TEST-RAZVAN/autorizare_tgz/1_dry30m.pdf' WHERE id = %L$q$, pg_temp.r30m_g('pr')));
  IF s IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'TEST1 FAIL: admin ne-owner a scris PDF-ul (%)', s; END IF;
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_proiecte SET apm_nume = coalesce(apm_nume, '') || '', autorizare_tgz_de = %L, autorizare_tgz_la = now() - interval '9 days' WHERE id = %L$q$,
                                 pg_temp.r30m_g('ad'), pg_temp.r30m_g('pr')));
  IF s IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'TEST1 FAIL: admin ne-owner nu poate schimba alt camp (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'postgres');
  SELECT autorizare_tgz_nr, autorizare_tgz_de, autorizare_tgz_la INTO r FROM public.red_proiecte WHERE id = pg_temp.r30m_g('pr')::uuid;
  IF r.autorizare_tgz_nr IS NOT NULL OR r.autorizare_tgz_de IS NOT NULL OR r.autorizare_tgz_la IS NOT NULL THEN RAISE EXCEPTION 'TEST1 FAIL: _de / _la scrise de mana'; END IF;
  RAISE NOTICE 'TEST1 OK';
END $t$;

-- TEST2: owner-ul — PDF inexistent, PDF sub alt proiect, cale cu „..” refuzate; apoi nr + data + PDF → publicat, _de / _la de server
DO $t$
DECLARE s text; r record; pub boolean;
BEGIN
  PERFORM pg_temp.r30m_ca(pg_temp.r30m_g('ow')::uuid, 'authenticated');
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_proiecte SET autorizare_tgz_fisier = 'TEST-RAZVAN/autorizare_tgz/nu_exista.pdf' WHERE id = %L$q$, pg_temp.r30m_g('pr')));
  IF s IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'TEST2 FAIL: PDF inexistent acceptat (%)', s; END IF;
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_proiecte SET autorizare_tgz_fisier = 'LOT1-PRUNISOR-JUPA/autorizare_tgz/1_dry30m.pdf' WHERE id = %L$q$, pg_temp.r30m_g('pr')));
  IF s IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'TEST2 FAIL: PDF al altui proiect acceptat (%)', s; END IF;
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_proiecte SET autorizare_tgz_fisier = 'TEST-RAZVAN/autorizare_tgz/../1_dry30m.pdf' WHERE id = %L$q$, pg_temp.r30m_g('pr')));
  IF s NOT IN ('23514', '22023') THEN RAISE EXCEPTION 'TEST2 FAIL: cale cu .. acceptata (%)', s; END IF;
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_proiecte SET autorizare_tgz_nr = '   ' WHERE id = %L$q$, pg_temp.r30m_g('pr')));
  IF s IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'TEST2 FAIL: nr gol acceptat (%)', s; END IF;
  -- doar nr + data: inca nepublicat
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_proiecte SET autorizare_tgz_nr = 'DRY-1', autorizare_tgz_data = '2026-11-05' WHERE id = %L$q$, pg_temp.r30m_g('pr')));
  IF s IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'TEST2 FAIL: owner nr + data (%)', s; END IF;
  IF public.fn_red_informare_publicata('TEST-RAZVAN') THEN RAISE EXCEPTION 'TEST2 FAIL: publicat fara PDF'; END IF;
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_proiecte SET autorizare_tgz_fisier = 'TEST-RAZVAN/autorizare_tgz/1_dry30m.pdf' WHERE id = %L$q$, pg_temp.r30m_g('pr')));
  IF s IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'TEST2 FAIL: owner PDF (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'postgres');
  SELECT autorizare_tgz_de, autorizare_tgz_la INTO r FROM public.red_proiecte WHERE id = pg_temp.r30m_g('pr')::uuid;
  IF r.autorizare_tgz_de IS DISTINCT FROM pg_temp.r30m_g('ow')::uuid OR r.autorizare_tgz_la IS NULL THEN RAISE EXCEPTION 'TEST2 FAIL: _de / _la'; END IF;
  -- anon vede doar da / nu: TEST-RAZVAN publicat, LOT1 nu, cod necunoscut nu
  PERFORM pg_temp.r30m_ca(NULL, 'anon');
  pub := public.fn_red_informare_publicata('TEST-RAZVAN');
  IF pub IS NOT TRUE THEN RAISE EXCEPTION 'TEST2 FAIL: anon nu vede publicarea'; END IF;
  IF public.fn_red_informare_publicata('LOT1-PRUNISOR-JUPA') OR public.fn_red_informare_publicata('NU-EXISTA') OR public.fn_red_informare_publicata(NULL) THEN
    RAISE EXCEPTION 'TEST2 FAIL: publicat fara autorizare';
  END IF;
  s := pg_temp.r30m_stare('SELECT autorizare_tgz_nr FROM public.red_proiecte LIMIT 1');
  IF s IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'TEST2 FAIL: anon citeste red_proiecte (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'postgres');
  RAISE NOTICE 'TEST2 OK';
END $t$;

-- TEST3: PDF-ul mutat din locul lui in storage → nepublicat (fn verifica existenta); adminul ne-owner nu poate goli autorizarea; owner-ul o poate goli
DO $t$
DECLARE s text;
BEGIN
  -- DELETE direct pe storage.objects e interzis de Supabase; mutarea obiectului simuleaza la fel lipsa PDF-ului
  UPDATE storage.objects SET name = 'TEST-RAZVAN/alt_folder/1_dry30m.pdf' WHERE bucket_id = 'redari' AND name = 'TEST-RAZVAN/autorizare_tgz/1_dry30m.pdf';
  IF public.fn_red_informare_publicata('TEST-RAZVAN') THEN RAISE EXCEPTION 'TEST3 FAIL: publicat cu PDF sters'; END IF;
  PERFORM pg_temp.r30m_ca(pg_temp.r30m_g('ad')::uuid, 'authenticated');
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_proiecte SET autorizare_tgz_fisier = NULL WHERE id = %L$q$, pg_temp.r30m_g('pr')));
  IF s IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'TEST3 FAIL: admin ne-owner a golit autorizarea (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(pg_temp.r30m_g('ow')::uuid, 'authenticated');
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_proiecte SET autorizare_tgz_nr = NULL, autorizare_tgz_data = NULL, autorizare_tgz_fisier = NULL WHERE id = %L$q$, pg_temp.r30m_g('pr')));
  IF s IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'TEST3 FAIL: owner nu poate goli (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'postgres');
  RAISE NOTICE 'TEST3 OK';
END $t$;

-- TEST4: mentenanta (postgres direct, fara claims) trece; service_role cu claims e tratat ca utilizator (nu e owner → refuz)
DO $t$
DECLARE s text; de0 uuid; la0 timestamptz;
BEGIN
  SELECT autorizare_tgz_de, autorizare_tgz_la INTO de0, la0 FROM public.red_proiecte WHERE id = pg_temp.r30m_g('pr')::uuid;
  UPDATE public.red_proiecte SET autorizare_tgz_nr = 'MENT' WHERE id = pg_temp.r30m_g('pr')::uuid;
  -- mentenanta nu schimba _de / _la (raman cele puse de owner in TEST3)
  IF (SELECT autorizare_tgz_de IS DISTINCT FROM de0 OR autorizare_tgz_la IS DISTINCT FROM la0 OR autorizare_tgz_nr IS DISTINCT FROM 'MENT' FROM public.red_proiecte WHERE id = pg_temp.r30m_g('pr')::uuid) THEN
    RAISE EXCEPTION 'TEST4 FAIL: mentenanta';
  END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'service_role');
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_proiecte SET autorizare_tgz_nr = 'SR' WHERE id = %L$q$, pg_temp.r30m_g('pr')));
  IF s IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'TEST4 FAIL: service_role a scris autorizarea (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'postgres');
  RAISE NOTICE 'TEST4 OK';
END $t$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
DO $t$ BEGIN RAISE NOTICE 'DRY 20261130m: TOATE TESTELE OK'; END $t$;
