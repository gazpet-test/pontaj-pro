-- DRY 20261130m_redari_autorizare_tgz (r2). Runner: o singura tranzactie ANULATA (BEGIN + marcaj + migrare + acest fisier + ROLLBACK).
-- Identitati REALE (owner + admin Redari ne-owner din user_module_access), simulate prin request.jwt.claims + SET LOCAL ROLE authenticated / anon /
-- service_role. Proiectul TEST-RAZVAN si convocarile lui postale existente; obiecte fictive in storage.objects (bucket redari) cu owner_id ales.
-- Totul se anuleaza la ROLLBACK. DELETE direct pe storage.objects e interzis de Supabase: „disparitia” / „inlocuirea” unui PDF se simuleaza
-- mutand obiectul (UPDATE name) si inserand altul la aceeasi cale. La final: RESET ROLE + claims goale.
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
-- UPDATE pe proiectul de test, ca text SQL
CREATE FUNCTION pg_temp.r30m_upd(p_set text) RETURNS text LANGUAGE sql STABLE AS $h$
  SELECT format('UPDATE public.red_proiecte SET %s WHERE id = %L', p_set, pg_temp.r30m_g('pr'));
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.r30m_ca(uuid, text), pg_temp.r30m_stare(text), pg_temp.r30m_g(text), pg_temp.r30m_upd(text) TO authenticated, anon, service_role;

-- TEST0: garda, identitati, proiect, o convocare postala de test; nimic publicat; obiectele fictive din storage
DO $t$
DECLARE ow uuid; ad uuid; pr uuid; cv uuid; dt uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130m_redari_autorizare_tgz:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: garda';
  END IF;
  SELECT id INTO ow FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT uma.profile_id INTO ad FROM public.user_module_access uma JOIN public.profiles p ON p.id = uma.profile_id
   WHERE uma.module = 'redari' AND uma.access_level = 'admin' AND p.is_owner IS NOT TRUE ORDER BY uma.profile_id LIMIT 1;
  SELECT id INTO pr FROM public.red_proiecte WHERE cod = 'TEST-RAZVAN';
  SELECT c.id, c.detinator_id INTO cv, dt FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele x ON x.id = d.parcela_id
   WHERE x.proiect_id = pr AND c.canal = 'posta' AND c.sters_la IS NULL AND c.data_expediere IS NULL AND c.continut_hash IS NOT NULL ORDER BY c.id LIMIT 1;
  IF ow IS NULL OR ad IS NULL OR pr IS NULL OR cv IS NULL THEN
    RAISE EXCEPTION 'TEST0 FAIL: identitati / proiect / convocare (owner %, admin %, proiect %, convocare %)', ow IS NOT NULL, ad IS NOT NULL, pr IS NOT NULL, cv IS NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_proiecte WHERE public.fn_red_informare_publicata(cod)) THEN RAISE EXCEPTION 'TEST0 FAIL: ceva publicat'; END IF;
  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('redari', 'TEST-RAZVAN/autorizare_tgz/1_dry30m.pdf', ow::text, '{"eTag": "\"e1\""}');
  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('redari', 'LOT1-PRUNISOR-JUPA/autorizare_tgz/1_dry30m.pdf', ow::text, '{"eTag": "\"e2\""}');
  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('redari', 'TEST-RAZVAN/autorizare_tgz/2_editor30m.pdf', ad::text, '{"eTag": "\"e3\""}');
  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('redari', 'TEST-RAZVAN/autorizare_tgz/3_faraetag30m.pdf', ow::text, '{}');
  PERFORM set_config('r30m.ow', ow::text, true); PERFORM set_config('r30m.ad', ad::text, true); PERFORM set_config('r30m.pr', pr::text, true);
  PERFORM set_config('r30m.cv', cv::text, true); PERFORM set_config('r30m.dt', dt::text, true);
  RAISE NOTICE 'TEST0 OK';
END $t$;

-- TEST1: adminul ne-owner nu poate scrie autorizarea (42501), dar poate schimba alte campuri; _obiect / _de / _la nu se scriu de mana
DO $t$
DECLARE s text; r record;
BEGIN
  PERFORM pg_temp.r30m_ca(pg_temp.r30m_g('ad')::uuid, 'authenticated');
  s := pg_temp.r30m_stare(pg_temp.r30m_upd($q$autorizare_tgz_nr = 'X'$q$));
  IF s IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'TEST1 FAIL: admin ne-owner a scris nr (%)', s; END IF;
  s := pg_temp.r30m_stare(pg_temp.r30m_upd($q$autorizare_tgz_fisier = 'TEST-RAZVAN/autorizare_tgz/2_editor30m.pdf'$q$));
  IF s IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'TEST1 FAIL: admin ne-owner a scris PDF-ul (%)', s; END IF;
  s := pg_temp.r30m_stare(pg_temp.r30m_upd(format($q$apm_nume = coalesce(apm_nume, '') || '', autorizare_tgz_de = %L, autorizare_tgz_la = now() - interval '9 days'$q$, pg_temp.r30m_g('ad'))));
  IF s IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'TEST1 FAIL: admin ne-owner nu poate schimba alt camp (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'postgres');
  SELECT autorizare_tgz_nr, autorizare_tgz_obiect, autorizare_tgz_de, autorizare_tgz_la INTO r FROM public.red_proiecte WHERE id = pg_temp.r30m_g('pr')::uuid;
  IF r.autorizare_tgz_nr IS NOT NULL OR r.autorizare_tgz_obiect IS NOT NULL OR r.autorizare_tgz_de IS NOT NULL OR r.autorizare_tgz_la IS NOT NULL THEN
    RAISE EXCEPTION 'TEST1 FAIL: _obiect / _de / _la scrise de mana';
  END IF;
  RAISE NOTICE 'TEST1 OK';
END $t$;

-- TEST2: owner-ul — PDF inexistent, PDF sub alt proiect, PDF urcat de altcineva, cale cu „..”, nr gol refuzate; nr + data + PDF propriu → publicat
DO $t$
DECLARE s text; r record; pub boolean;
BEGIN
  PERFORM pg_temp.r30m_ca(pg_temp.r30m_g('ow')::uuid, 'authenticated');
  s := pg_temp.r30m_stare(pg_temp.r30m_upd($q$autorizare_tgz_fisier = 'TEST-RAZVAN/autorizare_tgz/nu_exista.pdf'$q$));
  IF s IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'TEST2 FAIL: PDF inexistent acceptat (%)', s; END IF;
  s := pg_temp.r30m_stare(pg_temp.r30m_upd($q$autorizare_tgz_fisier = 'LOT1-PRUNISOR-JUPA/autorizare_tgz/1_dry30m.pdf'$q$));
  IF s IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'TEST2 FAIL: PDF al altui proiect acceptat (%)', s; END IF;
  -- r2 (Jakarinos P1-2): PDF urcat de altcineva (admin / editor ne-owner) nu se poate lega
  s := pg_temp.r30m_stare(pg_temp.r30m_upd($q$autorizare_tgz_fisier = 'TEST-RAZVAN/autorizare_tgz/2_editor30m.pdf'$q$));
  IF s IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'TEST2 FAIL: PDF urcat de altcineva acceptat (%)', s; END IF;
  -- r4: obiect fără eTag (conținut neverificabil) nu se poate lega
  s := pg_temp.r30m_stare(pg_temp.r30m_upd($q$autorizare_tgz_fisier = 'TEST-RAZVAN/autorizare_tgz/3_faraetag30m.pdf'$q$));
  IF s IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'TEST2 FAIL: PDF fara eTag acceptat (%)', s; END IF;
  s := pg_temp.r30m_stare(pg_temp.r30m_upd($q$autorizare_tgz_fisier = 'TEST-RAZVAN/autorizare_tgz/../1_dry30m.pdf'$q$));
  IF s NOT IN ('23514', '22023') THEN RAISE EXCEPTION 'TEST2 FAIL: cale cu .. acceptata (%)', s; END IF;
  s := pg_temp.r30m_stare(pg_temp.r30m_upd($q$autorizare_tgz_nr = '   '$q$));
  IF s IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'TEST2 FAIL: nr gol acceptat (%)', s; END IF;
  s := pg_temp.r30m_stare(pg_temp.r30m_upd($q$autorizare_tgz_nr = 'DRY-1', autorizare_tgz_data = '2026-11-05'$q$));
  IF s IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'TEST2 FAIL: owner nr + data (%)', s; END IF;
  IF public.fn_red_informare_publicata('TEST-RAZVAN') THEN RAISE EXCEPTION 'TEST2 FAIL: publicat fara PDF'; END IF;
  s := pg_temp.r30m_stare(pg_temp.r30m_upd($q$autorizare_tgz_fisier = 'TEST-RAZVAN/autorizare_tgz/1_dry30m.pdf'$q$));
  IF s IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'TEST2 FAIL: owner PDF (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'postgres');
  SELECT p.autorizare_tgz_de, p.autorizare_tgz_la, p.autorizare_tgz_obiect, p.autorizare_tgz_etag, o.id AS oid INTO r
    FROM public.red_proiecte p LEFT JOIN storage.objects o ON o.bucket_id = 'redari' AND o.name = 'TEST-RAZVAN/autorizare_tgz/1_dry30m.pdf'
   WHERE p.id = pg_temp.r30m_g('pr')::uuid;
  IF r.autorizare_tgz_de IS DISTINCT FROM pg_temp.r30m_g('ow')::uuid OR r.autorizare_tgz_la IS NULL OR r.autorizare_tgz_obiect IS DISTINCT FROM r.oid OR r.autorizare_tgz_etag IS DISTINCT FROM '"e1"' THEN
    RAISE EXCEPTION 'TEST2 FAIL: _de / _la / _obiect / _etag';
  END IF;
  -- anon vede doar da / nu: TEST-RAZVAN publicat, LOT1 nu, cod necunoscut / NULL nu; anon nu citeste red_proiecte
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

-- TEST3 (r2 Jakarinos P1-1): codul proiectului nu se schimba cat exista autorizarea — nici de admin, nici de owner
DO $t$
DECLARE s text;
BEGIN
  PERFORM pg_temp.r30m_ca(pg_temp.r30m_g('ad')::uuid, 'authenticated');
  s := pg_temp.r30m_stare(pg_temp.r30m_upd($q$cod = 'LOT1-PRUNISOR-JUPA-X'$q$));
  IF s IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'TEST3 FAIL: admin a schimbat codul (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(pg_temp.r30m_g('ow')::uuid, 'authenticated');
  s := pg_temp.r30m_stare(pg_temp.r30m_upd($q$cod = 'TEST-RAZVAN-2'$q$));
  IF s IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'TEST3 FAIL: owner a schimbat codul cu autorizarea pusa (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'postgres');
  RAISE NOTICE 'TEST3 OK';
END $t$;

-- TEST4 (r2 Jakarinos P1-3 / Copilot P1-03): convocarile postale — un UPDATE fara fisier / hash nou trece; dupa „inlocuirea” PDF-ului la aceeasi
-- cale (alt obiect, urcat de altcineva) informarea NU mai e publicata, iar hash nou / expediere / rezervare noua sunt refuzate
DO $t$
DECLARE s text;
BEGIN
  PERFORM pg_temp.r30m_ca(pg_temp.r30m_g('ad')::uuid, 'authenticated');
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_convocari SET continut_hash = continut_hash WHERE id = %L$q$, pg_temp.r30m_g('cv')));
  IF s IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'TEST4 FAIL: update fara schimbare refuzat (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'postgres');
  -- r4 (Copilot r2 P1-03): conținut rescris PE LOC (același id, aceeași cale, alt eTag) → nepublicat; revenit la eTag-ul legat → publicat din nou
  UPDATE storage.objects SET metadata = '{"eTag": "\"rescris\""}' WHERE bucket_id = 'redari' AND name = 'TEST-RAZVAN/autorizare_tgz/1_dry30m.pdf';
  IF public.fn_red_informare_publicata('TEST-RAZVAN') THEN RAISE EXCEPTION 'TEST4 FAIL: publicat cu continut rescris pe loc'; END IF;
  UPDATE storage.objects SET metadata = '{"eTag": "\"e1\""}' WHERE bucket_id = 'redari' AND name = 'TEST-RAZVAN/autorizare_tgz/1_dry30m.pdf';
  IF NOT public.fn_red_informare_publicata('TEST-RAZVAN') THEN RAISE EXCEPTION 'TEST4 FAIL: nepublicat cu eTag-ul legat'; END IF;
  UPDATE storage.objects SET name = 'TEST-RAZVAN/alt_folder/1_dry30m.pdf' WHERE bucket_id = 'redari' AND name = 'TEST-RAZVAN/autorizare_tgz/1_dry30m.pdf';
  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('redari', 'TEST-RAZVAN/autorizare_tgz/1_dry30m.pdf', pg_temp.r30m_g('ad'), '{"eTag": "\"e1\""}');
  IF public.fn_red_informare_publicata('TEST-RAZVAN') THEN RAISE EXCEPTION 'TEST4 FAIL: publicat cu PDF inlocuit'; END IF;
  PERFORM pg_temp.r30m_ca(pg_temp.r30m_g('ad')::uuid, 'authenticated');
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_convocari SET continut_hash = continut_hash || 'x' WHERE id = %L$q$, pg_temp.r30m_g('cv')));
  IF s IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'TEST4 FAIL: hash nou fara informare publicata (%)', s; END IF;
  s := pg_temp.r30m_stare(format($q$UPDATE public.red_convocari SET data_expediere = current_date WHERE id = %L$q$, pg_temp.r30m_g('cv')));
  IF s IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'TEST4 FAIL: expediere fara informare publicata (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'postgres');
  -- INSERT postal nou: pe TEST-RAZVAN RPC-ul de rezervare se opreste mai devreme (RD002, lipsuri de proiect), deci garda se testeaza direct:
  -- rol postgres (trece de trg_red_convocari_garda_rezerva, care scuteste current_user postgres) DAR cu claims de utilizator (nu e mentenanta)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.r30m_g('ad'), 'role', 'authenticated')::text, true);
  s := pg_temp.r30m_stare(format($q$INSERT INTO public.red_convocari (detinator_id, canal) VALUES (%L, 'posta')$q$, pg_temp.r30m_g('dt')));
  IF s IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'TEST4 FAIL: convocare postala noua fara informare publicata (%)', s; END IF;
  -- alt canal nu e atins de garda (poate fi oprit de alte reguli, dar nu cu 42501 de la ea)
  s := pg_temp.r30m_stare(format($q$INSERT INTO public.red_convocari (detinator_id, canal) VALUES (%L, 'afisare')$q$, pg_temp.r30m_g('dt')));
  IF s = '42501' THEN RAISE EXCEPTION 'TEST4 FAIL: garda a oprit alt canal'; END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'postgres');
  RAISE NOTICE 'TEST4 OK';
END $t$;

-- TEST5: adminul ne-owner nu poate goli autorizarea; owner-ul o poate goli (_obiect NULL, _de / _la raman urma lui)
DO $t$
DECLARE s text; r record;
BEGIN
  PERFORM pg_temp.r30m_ca(pg_temp.r30m_g('ad')::uuid, 'authenticated');
  s := pg_temp.r30m_stare(pg_temp.r30m_upd('autorizare_tgz_fisier = NULL'));
  IF s IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'TEST5 FAIL: admin ne-owner a golit autorizarea (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(pg_temp.r30m_g('ow')::uuid, 'authenticated');
  s := pg_temp.r30m_stare(pg_temp.r30m_upd('autorizare_tgz_nr = NULL, autorizare_tgz_data = NULL, autorizare_tgz_fisier = NULL'));
  IF s IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'TEST5 FAIL: owner nu poate goli (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'postgres');
  SELECT autorizare_tgz_obiect, autorizare_tgz_etag, autorizare_tgz_de INTO r FROM public.red_proiecte WHERE id = pg_temp.r30m_g('pr')::uuid;
  IF r.autorizare_tgz_obiect IS NOT NULL OR r.autorizare_tgz_etag IS NOT NULL OR r.autorizare_tgz_de IS DISTINCT FROM pg_temp.r30m_g('ow')::uuid THEN RAISE EXCEPTION 'TEST5 FAIL: _obiect / _de dupa golire'; END IF;
  RAISE NOTICE 'TEST5 OK';
END $t$;

-- TEST6: mentenanta (postgres direct, fara claims) trece si nu schimba _obiect / _de / _la; service_role cu claims e refuzat (nu e owner)
DO $t$
DECLARE s text; de0 uuid; la0 timestamptz;
BEGIN
  SELECT autorizare_tgz_de, autorizare_tgz_la INTO de0, la0 FROM public.red_proiecte WHERE id = pg_temp.r30m_g('pr')::uuid;
  UPDATE public.red_proiecte SET autorizare_tgz_nr = 'MENT' WHERE id = pg_temp.r30m_g('pr')::uuid;
  IF (SELECT autorizare_tgz_de IS DISTINCT FROM de0 OR autorizare_tgz_la IS DISTINCT FROM la0 OR autorizare_tgz_nr IS DISTINCT FROM 'MENT' FROM public.red_proiecte WHERE id = pg_temp.r30m_g('pr')::uuid) THEN
    RAISE EXCEPTION 'TEST6 FAIL: mentenanta';
  END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'service_role');
  s := pg_temp.r30m_stare(pg_temp.r30m_upd($q$autorizare_tgz_nr = 'SR'$q$));
  IF s IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'TEST6 FAIL: service_role a scris autorizarea (%)', s; END IF;
  PERFORM pg_temp.r30m_ca(NULL, 'postgres');
  RAISE NOTICE 'TEST6 OK';
END $t$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
DO $t$ BEGIN RAISE NOTICE 'DRY 20261130m: TOATE TESTELE OK'; END $t$;
