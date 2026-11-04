-- DRY 20261130h_redari_parcele_nr_crt_grup. Runner: o singura tranzactie ANULATA (marcaj + migrare + acest fisier + ROLLBACK).
-- Identitati REALE din user_module_access (admin / editor / viewer ne-owner pe modulul redari, ca DRY-ul 20261130e), simulate prin
-- request.jwt.claims + SET LOCAL ROLE; date fictive pe proiectul TEST-RAZVAN (parcele DRY-99xx), toate anulate la ROLLBACK.
-- La final: RESET ROLE + claims goale (sesiunea revine la postgres / mentenanta).
CREATE FUNCTION pg_temp.r30h_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
CREATE FUNCTION pg_temp.r30h_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE = p_stare;
END $h$;
CREATE FUNCTION pg_temp.r30h_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r30h.' || p, true), ''); $h$;
-- INSERT de parcela fictiva (textul SQL), cu grupul dat (NULL = fara subnumar)
CREATE FUNCTION pg_temp.r30h_ins(p_nr text, p_grup text) RETURNS text LANGUAGE sql STABLE AS $h$
  SELECT format($q$INSERT INTO public.red_parcele(proiect_id, uat_id, id_parcela, cheie_sursa, nr_crt_grup) VALUES (%L, %L, %L, %L, %L)$q$,
                pg_temp.r30h_g('proiect'), pg_temp.r30h_g('uat'), pg_temp.r30h_g('uat3') || '-' || p_nr, 'DRY30H|HG ' || p_nr || '||', p_grup);
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.r30h_ca(uuid, text), pg_temp.r30h_refuza(text, text), pg_temp.r30h_g(text), pg_temp.r30h_ins(text, text) TO authenticated, anon, service_role;

-- TEST0: garda, identitati, proiect; parcelele existente toate NULL; niciun DRY-99xx preexistent
DO $t$
DECLARE ad uuid; ed uuid; vw uuid; pr uuid; ua uuid; u3 text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130h_redari_parcele_nr_crt_grup:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: garda';
  END IF;
  SELECT a.profile_id INTO ad FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.module = 'redari' AND a.access_level = 'admin' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.module = 'redari' AND a.access_level = 'editor' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT a.profile_id INTO vw FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.module = 'redari' AND a.access_level = 'viewer' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT id INTO pr FROM public.red_proiecte WHERE cod = 'TEST-RAZVAN';
  SELECT id, uat3 INTO ua, u3 FROM public.red_uat WHERE proiect_id = pr ORDER BY uat3 LIMIT 1;
  IF ad IS NULL OR ed IS NULL OR vw IS NULL OR pr IS NULL OR ua IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati / proiect TEST-RAZVAN / UAT lipsa'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_parcele WHERE proiect_id = pr AND id_parcela LIKE u3 || '-99__') THEN RAISE EXCEPTION 'TEST0 FAIL: exista deja parcele %-99xx', u3; END IF;
  IF (SELECT count(*) FROM public.red_parcele WHERE nr_crt_grup IS NOT NULL) <> 0 THEN RAISE EXCEPTION 'TEST0 FAIL: parcele existente cu nr_crt_grup'; END IF;
  PERFORM set_config('r30h.admin', ad::text, true); PERFORM set_config('r30h.editor', ed::text, true); PERFORM set_config('r30h.viewer', vw::text, true);
  PERFORM set_config('r30h.proiect', pr::text, true); PERFORM set_config('r30h.uat', ua::text, true); PERFORM set_config('r30h.uat3', u3, true);
  PERFORM set_config('r30h.existente', (SELECT count(*) FROM public.red_parcele)::text, true);
  RAISE NOTICE 'TEST0 OK';
END $t$;

-- TEST1: editorul insereaza cu grup valid si fara grup; formele invalide sunt refuzate de CHECK (23514)
SELECT pg_temp.r30h_ca(pg_temp.r30h_g('editor')::uuid, 'authenticated');
DO $t$ DECLARE v text; BEGIN
  EXECUTE pg_temp.r30h_ins('9901', '166.1');
  EXECUTE pg_temp.r30h_ins('9902', NULL);
  EXECUTE pg_temp.r30h_ins('9903', '198.12');
  IF (SELECT nr_crt_grup FROM public.red_parcele WHERE id_parcela = pg_temp.r30h_g('uat3') || '-9901' AND proiect_id = pg_temp.r30h_g('proiect')::uuid) IS DISTINCT FROM '166.1'
     OR (SELECT nr_crt_grup FROM public.red_parcele WHERE id_parcela = pg_temp.r30h_g('uat3') || '-9902' AND proiect_id = pg_temp.r30h_g('proiect')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST1 FAIL: valorile inserate';
  END IF;
  FOREACH v IN ARRAY ARRAY['166', '166.0', '166.01', '0.1', '07.1', '166.1.2', '166.', '.1', 'abc', '166,1', ' 166.1', '166.1 ', '1234567890.1', '1.1234567890', ''] LOOP
    IF NOT pg_temp.r30h_refuza(pg_temp.r30h_ins('9909', v), '23514') THEN RAISE EXCEPTION 'TEST1 FAIL: forma invalida acceptata: [%]', v; END IF;
  END LOOP;
  RAISE NOTICE 'TEST1 OK';
END $t$;

-- TEST2: UPDATE pe nr_crt_grup refuzat pentru editor si admin (nu au privilegiu pe coloana: 42501); celelalte coloane raman editabile
SELECT pg_temp.r30h_ca(pg_temp.r30h_g('editor')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r30h_refuza(format($q$UPDATE public.red_parcele SET nr_crt_grup = '166.2' WHERE id_parcela = %L AND proiect_id = %L$q$, pg_temp.r30h_g('uat3') || '-9901', pg_temp.r30h_g('proiect')), '42501') THEN
    RAISE EXCEPTION 'TEST2 FAIL: editor schimba grupul';
  END IF;
  IF NOT pg_temp.r30h_refuza(format($q$UPDATE public.red_parcele SET nr_crt_grup = '166.2' WHERE id_parcela = %L AND proiect_id = %L$q$, pg_temp.r30h_g('uat3') || '-9902', pg_temp.r30h_g('proiect')), '42501') THEN
    RAISE EXCEPTION 'TEST2 FAIL: editor pune grup pe NULL';
  END IF;
  UPDATE public.red_parcele SET observatii = 'DRY 30h' WHERE id_parcela = pg_temp.r30h_g('uat3') || '-9901' AND proiect_id = pg_temp.r30h_g('proiect')::uuid;
  IF (SELECT observatii IS DISTINCT FROM 'DRY 30h' OR nr_crt_grup IS DISTINCT FROM '166.1' FROM public.red_parcele WHERE id_parcela = pg_temp.r30h_g('uat3') || '-9901' AND proiect_id = pg_temp.r30h_g('proiect')::uuid) THEN
    RAISE EXCEPTION 'TEST2 FAIL: UPDATE pe alta coloana';
  END IF;
  RAISE NOTICE 'TEST2a OK';
END $t$;
SELECT pg_temp.r30h_ca(pg_temp.r30h_g('admin')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r30h_refuza(format($q$UPDATE public.red_parcele SET nr_crt_grup = NULL WHERE id_parcela = %L AND proiect_id = %L$q$, pg_temp.r30h_g('uat3') || '-9901', pg_temp.r30h_g('proiect')), '42501') THEN
    RAISE EXCEPTION 'TEST2 FAIL: admin sterge grupul';
  END IF;
  RAISE NOTICE 'TEST2b OK';
END $t$;

-- TEST3: service_role (drepturi pe tabel, ocoleste RLS) — triggerul refuza orice schimbare a grupului (23514), inclusiv NULL -> valoare
SELECT pg_temp.r30h_ca(NULL, 'service_role');
DO $t$ BEGIN
  IF NOT pg_temp.r30h_refuza(format($q$UPDATE public.red_parcele SET nr_crt_grup = '166.2' WHERE id_parcela = %L AND proiect_id = %L$q$, pg_temp.r30h_g('uat3') || '-9901', pg_temp.r30h_g('proiect')), '23514') THEN
    RAISE EXCEPTION 'TEST3 FAIL: service_role schimba grupul';
  END IF;
  IF NOT pg_temp.r30h_refuza(format($q$UPDATE public.red_parcele SET nr_crt_grup = '7.2' WHERE id_parcela = %L AND proiect_id = %L$q$, pg_temp.r30h_g('uat3') || '-9902', pg_temp.r30h_g('proiect')), '23514') THEN
    RAISE EXCEPTION 'TEST3 FAIL: service_role NULL -> valoare';
  END IF;
  IF NOT pg_temp.r30h_refuza(format($q$UPDATE public.red_parcele SET nr_crt_grup = NULL WHERE id_parcela = %L AND proiect_id = %L$q$, pg_temp.r30h_g('uat3') || '-9901', pg_temp.r30h_g('proiect')), '23514') THEN
    RAISE EXCEPTION 'TEST3 FAIL: service_role valoare -> NULL';
  END IF;
  RAISE NOTICE 'TEST3 OK';
END $t$;

-- TEST4: viewer-ul citeste coloana dar nu insereaza (RLS 42501); anon nu citeste coloana
SELECT pg_temp.r30h_ca(pg_temp.r30h_g('viewer')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.red_parcele WHERE nr_crt_grup = '166.1' AND proiect_id = pg_temp.r30h_g('proiect')::uuid) <> 1 THEN RAISE EXCEPTION 'TEST4 FAIL: viewer nu vede grupul'; END IF;
  IF NOT pg_temp.r30h_refuza(pg_temp.r30h_ins('9904', '166.3'), '42501') THEN RAISE EXCEPTION 'TEST4 FAIL: viewer insereaza'; END IF;
  RAISE NOTICE 'TEST4a OK';
END $t$;
SELECT pg_temp.r30h_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.r30h_refuza('SELECT nr_crt_grup FROM public.red_parcele LIMIT 1', '42501') THEN RAISE EXCEPTION 'TEST4 FAIL: anon citeste'; END IF;
  RAISE NOTICE 'TEST4b OK';
END $t$;

-- TEST5: mentenanta (postgres fara claims) poate corecta grupul; parcelele existente raman NULL; nimic altceva atins
SELECT pg_temp.r30h_ca(NULL, 'postgres');
DO $t$ BEGIN
  UPDATE public.red_parcele SET nr_crt_grup = '166.4' WHERE id_parcela = pg_temp.r30h_g('uat3') || '-9903' AND proiect_id = pg_temp.r30h_g('proiect')::uuid;
  IF (SELECT nr_crt_grup FROM public.red_parcele WHERE id_parcela = pg_temp.r30h_g('uat3') || '-9903' AND proiect_id = pg_temp.r30h_g('proiect')::uuid) IS DISTINCT FROM '166.4' THEN
    RAISE EXCEPTION 'TEST5 FAIL: mentenanta';
  END IF;
  IF (SELECT count(*) FROM public.red_parcele WHERE nr_crt_grup IS NOT NULL AND NOT (proiect_id = pg_temp.r30h_g('proiect')::uuid AND id_parcela LIKE pg_temp.r30h_g('uat3') || '-99__')) <> 0
     OR (SELECT count(*) FROM public.red_parcele) <> pg_temp.r30h_g('existente')::bigint + 3 THEN
    RAISE EXCEPTION 'TEST5 FAIL: parcelele existente atinse';
  END IF;
  RAISE NOTICE 'TEST5 OK';
END $t$;

-- final: sesiunea revine la postgres fara claims
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
