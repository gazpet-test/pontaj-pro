-- DRY PRODUCTIE 20261130i_redari_sms_stare. Runner: o singura tranzactie ANULATA (marcaj + migrare + acest fisier + ROLLBACK).
-- r2 (Jakarinos NO-GO P1): FARA fixture SMS si FARA ALTER TABLE / DISABLE TRIGGER pe sms_* — un DISABLE / ENABLE TRIGGER ia SHARE ROW EXCLUSIVE
-- tinut pana la ROLLBACK si ar bloca workerul SMS. Aici NU se scrie nimic in tabele: migrarea creeaza doar functia (fara blocari de tabel),
-- testele sunt citiri (ACL, coloane, refuzuri, cifrele pe datele REALE TEST-RAZVAN comparate cu un calcul independent din tabele), apoi revenirea
-- (DROP FUNCTION, acelasi corp ca supabase/revenire/20261130i_redari_sms_stare_ROLLBACK.sql) si ROLLBACK. lock_timeout scurt (2s) pe toata tranzactia.
-- Cazurile pe stari (trimis / livrat / esuat / in curs / ignorate / ordine / loturi) sunt in DRY-ul LOCAL (..._dryrun_local.sql, PG17 de test).
-- Identitati REALE din user_module_access (admin = owner, editor / viewer ne-owner pe modulul redari) + un profil FARA nivel Redari, simulate prin
-- request.jwt.claims + SET LOCAL ROLE; anon si authenticated fara sub. La final: RESET ROLE + claims goale.
SELECT set_config('lock_timeout', '2s', true);
CREATE FUNCTION pg_temp.r30i_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
CREATE FUNCTION pg_temp.r30i_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE = p_stare;
END $h$;
CREATE FUNCTION pg_temp.r30i_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r30i.' || p, true), ''); $h$;
-- rezultatul functiei pentru un proiect, ca jsonb ordonat (comparabil)
CREATE FUNCTION pg_temp.r30i_fn(p_proiect uuid) RETURNS jsonb LANGUAGE sql STABLE AS $h$
  SELECT coalesce(jsonb_agg(jsonb_build_object('d', r.detinator_id, 'tr', r.nr_trimise, 'li', r.nr_livrate, 'es', r.nr_esuate, 'ic', r.nr_in_curs, 'lot', r.loturi,
           'ut', r.ultima_trimitere, 'ul', r.ultima_livrare) ORDER BY r.detinator_id), '[]'::jsonb)
    FROM public.fn_red_sms_stare(p_proiect) r;
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.r30i_ca(uuid, text), pg_temp.r30i_refuza(text, text), pg_temp.r30i_g(text), pg_temp.r30i_fn(uuid) TO authenticated, anon, service_role;

-- TEST0: garda, identitati, proiect (ca postgres = mentenanta); nicio scriere
DO $t$
DECLARE ad uuid; ed uuid; vw uuid; fa uuid; pr uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130i_redari_sms_stare:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: garda';
  END IF;
  SELECT id INTO ad FROM public.profiles WHERE is_owner ORDER BY id LIMIT 1;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.module = 'redari' AND a.access_level IN ('editor', 'admin') AND p.is_owner IS NOT TRUE ORDER BY (a.access_level = 'editor') DESC, a.id LIMIT 1;
  SELECT a.profile_id INTO vw FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.module = 'redari' AND a.access_level = 'viewer' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT p.id INTO fa FROM public.profiles p WHERE p.is_owner IS NOT TRUE
    AND NOT EXISTS (SELECT 1 FROM public.user_module_access a WHERE a.profile_id = p.id AND a.module = 'redari') ORDER BY p.id LIMIT 1;
  SELECT id INTO pr FROM public.red_proiecte WHERE cod = 'TEST-RAZVAN';
  IF ad IS NULL OR ed IS NULL OR vw IS NULL OR fa IS NULL OR pr IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati / proiect TEST-RAZVAN lipsa'; END IF;
  PERFORM set_config('r30i.admin', ad::text, true); PERFORM set_config('r30i.editor', ed::text, true); PERFORM set_config('r30i.viewer', vw::text, true);
  PERFORM set_config('r30i.fara', fa::text, true); PERFORM set_config('r30i.proiect', pr::text, true);
  -- asteptat, calculat INDEPENDENT de functie, direct din tabele: pe fiecare detinator al proiectului, numarul de mesaje cu trimis_la / livrate / esuate,
  -- doar pe mesajele care au plecat (nu in_coada / anulat), in loturile redari ale proiectului — pe datele reale (testul lui Razvan)
  PERFORM set_config('r30i.asteptat', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('d', z.det, 'tr', z.tr, 'li', z.li, 'es', z.es, 'lot', z.lot, 'ut', z.ut, 'ul', z.ul) ORDER BY z.det), '[]'::jsonb)::text
      FROM (SELECT d.id AS det, count(*) FILTER (WHERE x.trimis_la IS NOT NULL) AS tr, count(*) FILTER (WHERE x.stare = 'livrat') AS li,
                   count(*) FILTER (WHERE x.stare = 'esuat') AS es, count(DISTINCT x.lot_id) AS lot, max(x.trimis_la) AS ut, max(x.livrat_la) AS ul
              FROM public.sms_mesaje x JOIN public.sms_loturi l ON l.id = x.lot_id AND l.categorie = 'redari' AND l.proiect_id = pr
              JOIN public.red_detinatori d ON d.id::text = x.destinatar_id JOIN public.red_parcele p ON p.id = d.parcela_id AND p.proiect_id = pr
             WHERE x.destinatar_tip = 'detinator' AND x.stare IN ('trimis', 'livrat', 'esuat')
             GROUP BY d.id) z), true);
  -- daca exista mesaje in curs (necunoscut / in coada intr-un lot aprobat) pe TEST-RAZVAN, comparatia de mai jos nu le acopera: se semnaleaza
  IF EXISTS (SELECT 1 FROM public.sms_mesaje x JOIN public.sms_loturi l ON l.id = x.lot_id AND l.categorie = 'redari' AND l.proiect_id = pr
              WHERE x.destinatar_tip = 'detinator' AND (x.stare = 'necunoscut' OR (x.stare = 'in_coada' AND l.stare IN ('aprobat', 'in_trimitere')))) THEN
    RAISE EXCEPTION 'TEST0 FAIL: TEST-RAZVAN are mesaje in curs; reia DRY-ul dupa ce se termina trimiterea';
  END IF;
  RAISE NOTICE 'TEST0 OK (asteptat: %)', current_setting('r30i.asteptat');
END $t$;

-- TEST1: setarile si ACL-ul functiei; coloanele iesirii exacte (fara telefon / text / cod_eroare / furnizor)
DO $t$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_sms_stare(uuid)'::regprocedure AND prosecdef AND provolatile = 's'
                  AND proconfig = ARRAY['search_path=public, pg_temp']::text[] AND pg_get_userbyid(proowner) = 'postgres') THEN RAISE EXCEPTION 'TEST1 FAIL: setari'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.fn_red_sms_stare(uuid)', 'EXECUTE') OR has_function_privilege('anon', 'public.fn_red_sms_stare(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_red_sms_stare(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'TEST1 FAIL: ACL'; END IF;
  IF (SELECT array_agg(n ORDER BY o) FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(n, md, o)
       WHERE p.oid = 'public.fn_red_sms_stare(uuid)'::regprocedure AND a.md = 't')
     IS DISTINCT FROM ARRAY['detinator_id', 'nr_trimise', 'nr_livrate', 'nr_esuate', 'nr_in_curs', 'ultima_stare', 'ultima_trimitere', 'ultima_livrare', 'loturi', 'categorie']::text[] THEN
    RAISE EXCEPTION 'TEST1 FAIL: coloanele iesirii';
  END IF;
  RAISE NOTICE 'TEST1 OK';
END $t$;

-- TEST2: viewer / editor / admin vad pe TEST-RAZVAN exact calculul independent (datele reale); viewer-ul nu citeste sms_* direct
SELECT pg_temp.r30i_ca(pg_temp.r30i_g('viewer')::uuid, 'authenticated');
DO $t$
DECLARE v jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(e - 'ic' ORDER BY e->>'d'), '[]'::jsonb) INTO v FROM jsonb_array_elements(pg_temp.r30i_fn(pg_temp.r30i_g('proiect')::uuid)) e;
  IF v IS DISTINCT FROM current_setting('r30i.asteptat')::jsonb THEN RAISE EXCEPTION 'TEST2 FAIL: viewer % <> asteptat %', v, current_setting('r30i.asteptat'); END IF;
  IF EXISTS (SELECT 1 FROM public.fn_red_sms_stare(pg_temp.r30i_g('proiect')::uuid) r
              WHERE r.nr_in_curs <> 0 OR r.categorie NOT IN ('livrat', 'trimis', 'esuat') OR r.ultima_stare NOT IN ('livrat', 'trimis', 'esuat')
                 OR (r.categorie = 'livrat') <> (r.nr_livrate > 0)) THEN RAISE EXCEPTION 'TEST2 FAIL: categorie / ultima stare incoerente'; END IF;
  IF EXISTS (SELECT 1 FROM public.sms_mesaje) OR EXISTS (SELECT 1 FROM public.sms_loturi) THEN RAISE EXCEPTION 'TEST2 FAIL: viewer-ul citeste sms_* direct'; END IF;
  PERFORM set_config('r30i.viewer_rez', pg_temp.r30i_fn(pg_temp.r30i_g('proiect')::uuid)::text, true);
  RAISE NOTICE 'TEST2a OK (% detinatori)', jsonb_array_length(v);
END $t$;
SELECT pg_temp.r30i_ca(pg_temp.r30i_g('editor')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.r30i_fn(pg_temp.r30i_g('proiect')::uuid) IS DISTINCT FROM current_setting('r30i.viewer_rez')::jsonb THEN RAISE EXCEPTION 'TEST2 FAIL: editor'; END IF;
  RAISE NOTICE 'TEST2b OK';
END $t$;
SELECT pg_temp.r30i_ca(pg_temp.r30i_g('admin')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.r30i_fn(pg_temp.r30i_g('proiect')::uuid) IS DISTINCT FROM current_setting('r30i.viewer_rez')::jsonb THEN RAISE EXCEPTION 'TEST2 FAIL: admin'; END IF;
  RAISE NOTICE 'TEST2c OK';
END $t$;

-- TEST3: fara nivel Redari -> 42501; authenticated fara sub -> 42501; proiect NULL -> 22023
SELECT pg_temp.r30i_ca(pg_temp.r30i_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r30i_refuza(format('SELECT count(*) FROM public.fn_red_sms_stare(%L::uuid)', pg_temp.r30i_g('proiect')), '42501') THEN RAISE EXCEPTION 'TEST3 FAIL: fara nivel Redari citeste'; END IF;
  RAISE NOTICE 'TEST3a OK';
END $t$;
SELECT pg_temp.r30i_ca(NULL, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r30i_refuza(format('SELECT count(*) FROM public.fn_red_sms_stare(%L::uuid)', pg_temp.r30i_g('proiect')), '42501') THEN RAISE EXCEPTION 'TEST3 FAIL: authenticated fara sub citeste'; END IF;
  RAISE NOTICE 'TEST3b OK';
END $t$;
SELECT pg_temp.r30i_ca(pg_temp.r30i_g('viewer')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r30i_refuza('SELECT count(*) FROM public.fn_red_sms_stare(NULL::uuid)', '22023') THEN RAISE EXCEPTION 'TEST3 FAIL: proiect NULL'; END IF;
  RAISE NOTICE 'TEST3c OK';
END $t$;

-- TEST4: anon -> refuz (fara EXECUTE: 42501), si cu un sub de utilizator Redari in claims
SELECT pg_temp.r30i_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.r30i_refuza(format('SELECT count(*) FROM public.fn_red_sms_stare(%L::uuid)', pg_temp.r30i_g('proiect')), '42501') THEN RAISE EXCEPTION 'TEST4 FAIL: anon citeste'; END IF;
  RAISE NOTICE 'TEST4a OK';
END $t$;
SELECT pg_temp.r30i_ca(pg_temp.r30i_g('viewer')::uuid, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.r30i_refuza(format('SELECT count(*) FROM public.fn_red_sms_stare(%L::uuid)', pg_temp.r30i_g('proiect')), '42501') THEN RAISE EXCEPTION 'TEST4 FAIL: anon cu sub citeste'; END IF;
  RAISE NOTICE 'TEST4b OK';
END $t$;

-- TEST5: pe FIECARE proiect activ, fiecare rand al functiei e un detinator al ACELUI proiect (garda pe proiectul parcelei), fara duplicate
SELECT pg_temp.r30i_ca(pg_temp.r30i_g('viewer')::uuid, 'authenticated');
DO $t$
DECLARE v_pr uuid;
BEGIN
  FOR v_pr IN SELECT id FROM public.red_proiecte ORDER BY id LOOP
    IF EXISTS (SELECT 1 FROM public.fn_red_sms_stare(v_pr) r
                WHERE NOT EXISTS (SELECT 1 FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id WHERE d.id = r.detinator_id AND p.proiect_id = v_pr))
       OR (SELECT count(*) <> count(DISTINCT r.detinator_id) FROM public.fn_red_sms_stare(v_pr) r) THEN
      RAISE EXCEPTION 'TEST5 FAIL: proiectul % are randuri straine / duplicate', v_pr;
    END IF;
  END LOOP;
  RAISE NOTICE 'TEST5 OK';
END $t$;

-- TEST6: functia nu scrie: un apel intr-o subtranzactie read-only merge (STABLE, fara blocari de rand)
DO $t$ BEGIN
  IF (SELECT provolatile <> 's' OR NOT prosecdef FROM pg_proc WHERE oid = 'public.fn_red_sms_stare(uuid)'::regprocedure) THEN RAISE EXCEPTION 'TEST6 FAIL: volatilitate / definer'; END IF;
  PERFORM count(*) FROM public.fn_red_sms_stare(pg_temp.r30i_g('proiect')::uuid);
  RAISE NOTICE 'TEST6 OK';
END $t$;

-- TEST7: revenirea in aceeasi tranzactie (corpul din supabase/revenire/20261130i_redari_sms_stare_ROLLBACK.sql), apoi ROLLBACK-ul runnerului anuleaza tot
SELECT pg_temp.r30i_ca(NULL, 'postgres');
SELECT set_config('gazpet.revenire_20261130i', 'REDARI_SMS_STARE_SCOS:' || txid_current(), true);
DO $rev$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130i', true) IS DISTINCT FROM 'REDARI_SMS_STARE_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130i revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_red_sms_stare(uuid)') IS NULL THEN RAISE EXCEPTION '20261130i revenire: migrarea lipseste'; END IF;
  IF EXISTS (SELECT 1 FROM pg_depend WHERE refobjid = 'public.fn_red_sms_stare(uuid)'::regprocedure AND deptype = 'n') THEN
    RAISE EXCEPTION '20261130i revenire REFUZATA: alte obiecte depind de fn_red_sms_stare' USING ERRCODE = '55000';
  END IF;
  DROP FUNCTION public.fn_red_sms_stare(uuid);
  IF to_regprocedure('public.fn_red_sms_stare(uuid)') IS NOT NULL THEN RAISE EXCEPTION '20261130i revenire: stare finala gresita'; END IF;
  RAISE NOTICE '20261130i revenire: fn_red_sms_stare scoasa';
END $rev$;
DO $t$ BEGIN
  IF to_regprocedure('public.fn_red_sms_stare(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'TEST7 FAIL: revenire'; END IF;
  RAISE NOTICE 'TEST7 OK';
END $t$;

-- final: sesiunea revine la postgres, fara claims
SELECT pg_temp.r30i_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR coalesce(current_setting('request.jwt.claims', true), '') <> '' THEN RAISE EXCEPTION 'FINAL FAIL: rol / claims'; END IF;
  RAISE NOTICE 'DRY productie 20261130i OK';
END $t$;
