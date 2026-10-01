-- ============================================================================
-- Teste SQL — ciclul de viață al conturilor (R1 legare automată, R2 închidere la contract
-- încheiat, R3 fost angajat ca extern). Rulare: scripts/test_conturi_ciclu_viata.sh
-- ============================================================================
-- Convenții:
--   * totul într-o tranzacție încheiată cu ROLLBACK → fișierul poate rula de mai multe ori
--     pe aceeași bază (ex. după migrare, apoi după rollback + reaplicare);
--   * teste.assert(cond, 'Tn descriere') / teste.asteapta_eroare(sql, 'Tn ...', sqlstate, fragment)
--     → la eșec RAISE EXCEPTION, psql oprește (ON_ERROR_STOP) și scriptul iese cu cod ≠ 0;
--   * identități (LOGIN real, corecția 30.09): teste.ca_utilizator(uuid) = PostgREST (login authenticator +
--     SET ROLE authenticated + request.jwt.claims), teste.ca_anon(), teste.ca_service_role() (tot prin authenticator),
--     teste.ca_login('<login>') = conexiune directă fără claims (ex. supabase_auth_admin, authenticator),
--     teste.ca_admin() = login postgres fără claims (ca migrările și pg_cron); conturi noi:
--     teste.creeaza_cont(email, uuid) = GoTrue (login supabase_auth_admin), teste.creeaza_cont_owner = funcția
--     edge cont-nou (GoTrue cu marcaj de încredere + RPC fn_cont_leaga_la_creare cu service_role);
--   * precondiția live: S-A 20260929g (trg_profiles_campuri_owner_only) e aplicat de harness înaintea pachetului;
--   * coada R2 (pg_cron în producție): SELECT public.fn_conturi_inchideri_sweep() ca admin;
--   * cron-ul de producție: teste.cron_hr_auto_deactivate_terminated() (copie exactă);
--   * variabile psql prin RETURNING ... \gset (nu merg în interiorul blocurilor DO $$).
-- Secțiunea „BAZĂ” fixează comportamentul actual al producției și trebuie să rămână verde
-- și după migrările R1/R2/R3; testele noi se adaugă în secțiunile R1/R2/R3 de la final.
-- ============================================================================
\set ON_ERROR_STOP on
-- doar_baza=true (dat de script după rollback) sare peste secțiunile R1–R3
\if :{?doar_baza}
\else
  \set doar_baza false
\endif
\set owner 00000000-0000-4000-8000-000000000121
\set u_ion 00000000-0000-4000-8000-00000000a001
\set u_hr 00000000-0000-4000-8000-00000000a002

BEGIN;

-- ---------------------------------------------------------------- BAZĂ: mediu
SELECT teste.assert(current_database() ~ '_test$', 'T0 baza este una locală *_test');
SELECT teste.assert(current_setting('server_version_num')::int >= 160000, 'T0 PostgreSQL >= 16');
SELECT teste.assert(auth.uid() IS NULL AND current_user = session_user, 'T0 admin: auth.uid() NULL (ca migrările / pg_cron)');
SELECT teste.assert(current_setting('TimeZone') = 'UTC', 'T0 TimeZone UTC, ca în producție');

-- ---------------------------------------------------------------- BAZĂ: potrivire nume (fundația R1)
SET LOCAL search_path = public, pg_temp;   -- ca în funcțiile SECURITY DEFINER
SELECT teste.assert(extensions.unaccent('ȘTEFĂNESCU Țuțu Şerban Ţ âîă') = 'STEFANESCU Tutu Serban T aia',
  'T1 extensions.unaccent acoperă ș/ț (virgulă și sedilă) și cu search_path restrâns');
SELECT teste.assert(lower('ȘTEFĂNESCU ÎȚ') = 'ștefănescu îț', 'T1 lower() pe diacritice (ICU en-US, ca în producție)');
SET LOCAL search_path = public, extensions, pg_catalog;

\if :doar_baza
\else
-- R2-42 (runda 3, constatarea 5 — ordinea lock-urilor coadă ↔ profil). Rulat PRIMUL: are nevoie de date CONFIRMATE (commit,
-- prin dblink) și de alte conexiuni care scriu în auth.users / profiles, deci înaintea oricărui DDL al tranzacției testului
-- (CREATE TRIGGER pe auth.users / profiles ține SHARE ROW EXCLUSIVE până la final și le-ar bloca).
-- Scenariul deadlock-ului: o tranzacție ține profilul și vrea apoi intrarea din coadă (fn_cont_inchide / fn_cont_restaureaza:
-- profil → coadă). Sweep-ul trebuie să aștepte profilul FĂRĂ să țină deja intrarea (varianta din 30.09 bloca intrarea întâi:
-- coadă → profil ⇒ 40P01). Verificare deterministă: cât timp sweep-ul (conexiunea c_sweep) stă la lock-ul profilului,
-- tranzacția care ține profilul (c_tine) poate lua intrarea cu NOWAIT.
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA teste;
CREATE FUNCTION teste.asteapta_lock(p_pid integer) RETURNS boolean LANGUAGE plpgsql AS $fn$
BEGIN
  FOR i IN 1..200 LOOP
    PERFORM pg_stat_clear_snapshot();
    IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = p_pid AND wait_event_type = 'Lock') THEN
      RETURN true;
    END IF;
    PERFORM pg_sleep(0.025);
  END LOOP;
  RETURN false;
END $fn$;
SELECT format('host=127.0.0.1 port=%s dbname=%s user=postgres', current_setting('port'), current_database()) AS conn_lock \gset
SELECT gen_random_uuid() AS u_lock \gset
SELECT teste.dblink_exec(:'conn_lock', format($q$
  INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
  VALUES (%1$L, 'authenticated', 'authenticated', 'ordine.lock@exemplu.ro', '{"provider":"email"}', now(), now(), now());
  UPDATE public.profiles SET receive_tichete_hr = true WHERE id = %1$L;
  INSERT INTO public.conturi_inchideri_jurnal (profile_id, email, motiv, sursa, snapshot)
  VALUES (%1$L, 'ordine.lock@exemplu.ro', 'test ordine lock (R2-42)', 'import_manual',
          '{"versiune":1,"flaguri":{},"module":[],"santiere":[],"banned_until":null}');
  INSERT INTO public.conturi_inchideri_coada (profile_id, tip, motiv) VALUES (%1$L, 'flaguri', 'test ordine lock (R2-42)');
$q$, :'u_lock'));
SELECT teste.dblink_connect('c_tine', :'conn_lock');
SELECT teste.dblink_exec('c_tine', 'BEGIN');
SELECT * FROM teste.dblink('c_tine', format('SELECT id::text FROM public.profiles WHERE id = %L FOR UPDATE', :'u_lock')) AS t(id text);
SELECT teste.dblink_connect('c_sweep', :'conn_lock');
SELECT pid AS pid_sweep FROM teste.dblink('c_sweep', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
SELECT teste.dblink_send_query('c_sweep', 'SELECT public.fn_conturi_inchideri_sweep()::text');
SELECT teste.assert(teste.asteapta_lock(:pid_sweep), 'R2-42 pregătire: sweep-ul (altă conexiune, ca pg_cron) așteaptă profilul ținut de altă tranzacție');
SELECT COALESCE(teste.eroare(format('SELECT * FROM teste.dblink(%L, %L) AS t(id text)', 'c_tine',
         format('SELECT id::text FROM public.conturi_inchideri_coada WHERE profile_id = %L FOR UPDATE NOWAIT', :'u_lock')))::text, '') AS err_coada \gset
SELECT teste.assert(:'err_coada' = '',
  'R2-42 cât timp sweep-ul așteaptă profilul NU ține intrarea din coadă → tranzacția cu profilul o ia (NOWAIT): fără ciclu coadă ↔ profil (40P01)');
SELECT teste.dblink_exec('c_tine', 'ROLLBACK');
SELECT res AS sweep_r242 FROM teste.dblink_get_result('c_sweep') AS t(res text) \gset
SELECT count(*) AS rest_r242 FROM teste.dblink_get_result('c_sweep') AS t(res text) \gset
SELECT teste.assert((:'sweep_r242'::jsonb ->> 'flaguri_resetate')::int = 1,
  'R2-42 după eliberarea profilului sweep-ul își termină intrarea (profil → coadă, fără eroare)');
SELECT teste.dblink_disconnect('c_tine');
SELECT teste.dblink_disconnect('c_sweep');
SELECT teste.dblink_exec(:'conn_lock', format($q$
  SET session_replication_role = replica;               -- doar pentru curățenia testului: jurnalul e append-only
  DELETE FROM public.conturi_inchideri_jurnal WHERE profile_id = %1$L;
  SET session_replication_role = origin;
  DELETE FROM public.conturi_inchideri_coada WHERE profile_id = %1$L;
  DELETE FROM auth.users WHERE id = %1$L;
$q$, :'u_lock'));
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id = :'u_lock')
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = :'u_lock')
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_lock')
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_lock'),
  'R2-42 curățenie: datele confirmate ale testului au fost șterse');

-- ============================================================ r3 (verdict Copilot pe dad549b): teste de concurență REALE
-- Două conexiuni (dblink), date comise, ordinea forțată determinist: prima tranzacție ține lock-ul, a doua e pornită și se
-- verifică faptul că AȘTEAPTĂ (pg_stat_activity.wait_event_type = 'Lock'), apoi prima face COMMIT și se verifică starea finală.
SELECT gen_random_uuid() AS u_dr, gen_random_uuid() AS u_ehr, gen_random_uuid() AS u_dr2, gen_random_uuid() AS u_dr3, gen_random_uuid() AS u_dr4 \gset
SELECT teste.dblink_exec(:'conn_lock', format($q$
  INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
  VALUES (%1$L, 'authenticated', 'authenticated', 'drace.unu@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
         (%2$L, 'authenticated', 'authenticated', 'erace.hr@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
         (%3$L, 'authenticated', 'authenticated', 'drace.doi@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
         (%4$L, 'authenticated', 'authenticated', 'drace.trei@exemplu.ro', '{"provider":"email"}', now(), now(), now()),
         (%5$L, 'authenticated', 'authenticated', 'drace.cinci@exemplu.ro', '{"provider":"email"}', now(), now(), now());
  UPDATE public.profiles SET can_modify_employees = true WHERE id = %2$L;
  INSERT INTO public.employees (name, department, email, active, termination_date) VALUES
    ('DRACESCU UNU', 'Test', 'drace.unu@exemplu.ro', false, CURRENT_DATE),
    ('DRACESCU DOI', 'Test', 'drace.doi@exemplu.ro', false, CURRENT_DATE),   -- CNP pus mai jos (garda „aceeași persoană”)
    ('DRACESCU TREI', 'Test', 'drace.trei@exemplu.ro', false, CURRENT_DATE),
    ('DRACESCU PATRU', 'Test', 'drace.patru@exemplu.ro', false, CURRENT_DATE),
    ('DRACESCU CINCI', 'Test', 'drace.cinci@exemplu.ro', false, CURRENT_DATE),
    ('DRACESCU SASE', 'Test', 'drace.sase@exemplu.ro', false, CURRENT_DATE),
    ('ERACESCU UNU', 'Test', 'erace.unu@exemplu.ro', false, CURRENT_DATE - 1),
    ('ERACESCU DOI', 'Test', 'erace.doi@exemplu.ro', false, CURRENT_DATE - 1),
    ('GRACESCU TREI', 'Test', 'grace.trei@exemplu.ro', true, NULL);
  UPDATE public.profiles SET employee_id = (SELECT id FROM public.employees WHERE name = 'DRACESCU UNU') WHERE id = %1$L;
  INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la)
  SELECT %1$L, id, 'programata', 'test D-RACE-1', CURRENT_DATE FROM public.employees WHERE name = 'DRACESCU UNU';
  UPDATE public.profiles SET employee_id = (SELECT id FROM public.employees WHERE name = 'DRACESCU DOI') WHERE id = %3$L;
  INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la)
  SELECT %3$L, id, 'programata', 'test D-RACE-1b', CURRENT_DATE + 1 FROM public.employees WHERE name = 'DRACESCU DOI';
  UPDATE public.employees SET cnp = '1900303000085' WHERE name = 'DRACESCU DOI';
  UPDATE public.employees SET cnp = '1900303000093' WHERE name = 'DRACESCU TREI';
  UPDATE public.employees SET cnp = '1900303000107' WHERE name = 'DRACESCU PATRU';
  UPDATE public.profiles SET employee_id = (SELECT id FROM public.employees WHERE name = 'DRACESCU TREI') WHERE id = %4$L;
  INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la)
  SELECT %4$L, id, 'programata', 'test D-RACE-2', CURRENT_DATE + 1 FROM public.employees WHERE name = 'DRACESCU TREI';
  UPDATE public.employees SET cnp = '1900303000115' WHERE name = 'DRACESCU CINCI';
  UPDATE public.employees SET cnp = '1900303000123' WHERE name = 'DRACESCU SASE';
  UPDATE public.profiles SET employee_id = (SELECT id FROM public.employees WHERE name = 'DRACESCU CINCI') WHERE id = %5$L;
  INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la)
  SELECT %5$L, id, 'programata', 'test D-RACE-ERR', CURRENT_DATE + 1 FROM public.employees WHERE name = 'DRACESCU CINCI';
$q$, :'u_dr', :'u_ehr', :'u_dr2', :'u_dr3', :'u_dr4'));
SELECT max(id) FILTER (WHERE name = 'DRACESCU CINCI') AS e_dr4a, max(id) FILTER (WHERE name = 'DRACESCU SASE') AS e_dr4b,
       max(id) FILTER (WHERE name = 'DRACESCU TREI') AS e_dr3a, max(id) FILTER (WHERE name = 'DRACESCU PATRU') AS e_dr3b,
       max(id) FILTER (WHERE name = 'DRACESCU DOI') AS e_dr2, max(id) FILTER (WHERE name = 'DRACESCU UNU') AS e_dr, max(id) FILTER (WHERE name = 'ERACESCU UNU') AS e_f1,
       max(id) FILTER (WHERE name = 'ERACESCU DOI') AS e_f2, max(id) FILTER (WHERE name = 'GRACESCU TREI') AS e_g
  FROM public.employees WHERE name IN ('DRACESCU CINCI', 'DRACESCU SASE', 'DRACESCU TREI', 'DRACESCU PATRU', 'DRACESCU DOI', 'DRACESCU UNU', 'ERACESCU UNU', 'ERACESCU DOI', 'GRACESCU TREI') \gset
-- acordul „accepta” și externii legați (inactivi) — puse de un OM din HR (JWT prin authenticator), ca în aplicație
SELECT teste.dblink_connect('c_hr1', :'conn_lock');
SELECT teste.dblink_connect('c_hr2', :'conn_lock');
SELECT teste.dblink_connect('c_pg', :'conn_lock');
SELECT * FROM teste.dblink('c_hr1', format('SELECT teste.ca_utilizator(%L)::text', :'u_ehr')) AS t(x text);
SELECT * FROM teste.dblink('c_hr2', format('SELECT teste.ca_utilizator(%L)::text', :'u_ehr')) AS t(x text);
SELECT teste.dblink_exec('c_hr1', format($q$DO $d$ BEGIN
  PERFORM public.fn_colaborare_externa_seteaza(%1$s, 'accepta', 'acord de test E-RACE');
  PERFORM public.fn_colaborare_externa_seteaza(%2$s, 'accepta', 'acord de test E-RACE');
  INSERT INTO public.hr_personal_extern (nume, activ, fost_angajat_employee_id) VALUES ('Eracescu Unu', false, %1$s), ('Eracescu Doi', false, %2$s);
END $d$$q$,
  :e_f1, :e_f2));
SELECT max(id) FILTER (WHERE fost_angajat_employee_id = :e_f1) AS x1, max(id) FILTER (WHERE fost_angajat_employee_id = :e_f2) AS x2
  FROM public.hr_personal_extern \gset
SELECT teste.assert((SELECT count(*) = 2 FROM public.employees WHERE id IN (:e_f1, :e_f2) AND colaborare_externa_status = 'accepta')
    AND :x1 IS NOT NULL AND :x2 IS NOT NULL,
  'RACE pregătire: date comise (2 foști angajați cu acord „accepta”, externi legați inactivi, coada D-RACE-1)');

-- D-RACE-1: HR mută termination_date în viitor (necomis) ↔ sweep-ul pe intrarea „programata” scadentă azi.
SELECT pid AS pid_pg FROM teste.dblink('c_pg', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
SELECT pid AS pid_hr2 FROM teste.dblink('c_hr2', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
SELECT teste.dblink_connect('c_dsw', :'conn_lock');
SELECT pid AS pid_dsw FROM teste.dblink('c_dsw', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
SELECT teste.dblink_exec('c_pg', 'BEGIN');
SELECT teste.dblink_exec('c_pg', format('UPDATE public.employees SET termination_date = CURRENT_DATE + 30 WHERE id = %s', :e_dr));
SELECT teste.dblink_send_query('c_dsw', 'SELECT public.fn_conturi_inchideri_sweep()::text');
SELECT teste.assert(teste.asteapta_lock(:pid_dsw),
  'D-RACE-1 sweep-ul AȘTEAPTĂ fișa (employees FOR UPDATE) cât timp UPDATE-ul HR pe termination_date e necomis');
SELECT teste.dblink_exec('c_pg', 'COMMIT');
SELECT res AS sweep_dr FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
SELECT count(*) AS rest_dr FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
\echo '   D-RACE-1 sweep:' :sweep_dr
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_dr')
    AND (SELECT termination_date FROM public.employees WHERE id = :e_dr) = CURRENT_DATE + 30
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada
                     WHERE profile_id = :'u_dr' AND rezolvat_la IS NULL AND abandonat_la IS NULL AND scadent_la <= CURRENT_DATE),
  'D-RACE-1 după COMMIT-ul HR sweep-ul recitește fișa: contul NU se închide, data viitoare rămâne, nicio intrare scadentă azi');
-- D-RACE-1b (ordinea inversă, structural): sweep-ul ia fișa ÎNAINTE de profil. Cât timp sweep-ul stă la profilul ținut de
-- altă tranzacție, fișa e deja blocată de el ⇒ un UPDATE HR pe termination_date nu se mai poate strecura între citirea
-- sweep-ului și închidere (varianta dinainte de r3 nu bloca fișa: NOWAIT reușea).
SELECT teste.dblink_exec(:'conn_lock', format('UPDATE public.conturi_inchideri_coada SET scadent_la = CURRENT_DATE WHERE profile_id = %L AND rezolvat_la IS NULL', :'u_dr2'));
SELECT teste.dblink_connect('c_tine2', :'conn_lock');
SELECT teste.dblink_exec('c_tine2', 'BEGIN');
SELECT * FROM teste.dblink('c_tine2', format('SELECT id::text FROM public.profiles WHERE id = %L FOR UPDATE', :'u_dr2')) AS t(id text);
SELECT teste.dblink_send_query('c_dsw', 'SELECT public.fn_conturi_inchideri_sweep()::text');
SELECT teste.assert(teste.asteapta_lock(:pid_dsw), 'D-RACE-1b pregătire: sweep-ul așteaptă profilul ținut de altă tranzacție');
SELECT res AS nowait_dr2 FROM teste.dblink('c_pg', format($q$SELECT COALESCE(teste.eroare('SELECT 1 FROM public.employees WHERE id = %s FOR UPDATE NOWAIT')::text, 'OK')$q$, :e_dr2)) AS t(res text) \gset
SELECT teste.assert(:'nowait_dr2' ~ '"state": "55P03"',
  'D-RACE-1b cât timp sweep-ul așteaptă profilul, fișa e DEJA blocată de el (FOR UPDATE NOWAIT din altă conexiune → 55P03)');
SELECT teste.dblink_exec('c_tine2', 'ROLLBACK');
SELECT res AS sweep_dr2 FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
SELECT count(*) AS rest_dr2 FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
\echo '   D-RACE-1b sweep:' :sweep_dr2
SELECT teste.assert(EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_dr2' AND restaurat_la IS NULL),
  'D-RACE-1b după eliberarea profilului sweep-ul închide contul (data încetării = azi, citită sub lock-ul fișei)');
SELECT teste.dblink_disconnect('c_tine2');

-- D-RACE-2 (r4): intrarea e RETARGETATĂ (fn_cont_coada_pune, upsert employee_id A→B) cât timp sweep-ul a blocat deja fișa A
-- și stă la lock-ul intrării. După recitire sweep-ul vede (profil, fișă, tip) schimbat ⇒ CONTINUE: nu închide, nu rezolvă
-- intrarea, nu blochează fișa B după coadă (ordinea lock-urilor rămâne fișă → advisory → profil → coadă).
SELECT teste.dblink_exec(:'conn_lock', format('UPDATE public.conturi_inchideri_coada SET scadent_la = CURRENT_DATE WHERE profile_id = %L AND rezolvat_la IS NULL', :'u_dr3'));
SELECT teste.dblink_connect('c_tine3', :'conn_lock');
SELECT teste.dblink_exec('c_tine3', 'BEGIN');
SELECT * FROM teste.dblink('c_tine3', format($q$SELECT public.fn_cont_coada_pune(%L, %s, 'programata', 'retargetare A→B (test D-RACE-2)', CURRENT_DATE)::text$q$,
  :'u_dr3', :e_dr3b)) AS t(x text);
SELECT teste.dblink_send_query('c_dsw', 'SELECT public.fn_conturi_inchideri_sweep()::text');
SELECT teste.assert(teste.asteapta_lock(:pid_dsw), 'D-RACE-2 pregătire: sweep-ul stă la lock-ul intrării (retargetare necomisă)');
SELECT res AS nowait_dr3 FROM teste.dblink('c_pg', format($q$SELECT COALESCE(teste.eroare('SELECT 1 FROM public.employees WHERE id = %s FOR UPDATE NOWAIT')::text, 'OK')$q$, :e_dr3a)) AS t(res text) \gset
SELECT teste.assert(:'nowait_dr3' ~ '"state": "55P03"', 'D-RACE-2 sweep-ul ține deja fișa A (blocată înaintea cozii)');
SELECT teste.dblink_exec('c_tine3', 'COMMIT');
SELECT res AS sweep_dr3 FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
SELECT count(*) AS rest_dr3 FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
\echo '   D-RACE-2 sweep:' :sweep_dr3
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_dr3')
    AND (SELECT count(*) = 1 FROM public.conturi_inchideri_coada
          WHERE profile_id = :'u_dr3' AND rezolvat_la IS NULL AND employee_id = :e_dr3b AND incercari = 0),
  'D-RACE-2 intrarea retargetată A→B e sărită (CONTINUE): contul nu se închide, intrarea rămâne deschisă pe B, neatinsă');
SELECT teste.dblink_disconnect('c_tine3');

-- D-RACE-ERR (r5, D-ERR-IDENTITY): eroare FORȚATĂ în sweep (lock_timeout la profilul ținut de altă tranzacție) cât timp
-- intrarea e retargetată A→B și comisă. Handlerul de eroare face backoff / abandon / notificare DOAR dacă intrarea are încă
-- (profil, fișă, tip) de la selecție; altfel NOT FOUND ⇒ nimic. Cronologie (lock_timeout 2s): t0 sweep-ul așteaptă profilul;
-- retargetarea se comite; ~t0+2s prima eroare (55P03) → handlerul re-așteaptă profilul; t0+3s profilul e eliberat → handlerul
-- își face UPDATE-ul de backoff pe o intrare care nu mai e a lui.
SELECT teste.dblink_exec(:'conn_lock', format('UPDATE public.conturi_inchideri_coada SET scadent_la = CURRENT_DATE WHERE profile_id = %L AND rezolvat_la IS NULL', :'u_dr4'));
SELECT teste.dblink_connect('c_tine4', :'conn_lock');
SELECT teste.dblink_exec('c_tine4', 'BEGIN');
SELECT * FROM teste.dblink('c_tine4', format('SELECT id::text FROM public.profiles WHERE id = %L FOR UPDATE', :'u_dr4')) AS t(id text);
SELECT teste.dblink_exec('c_dsw', 'SET lock_timeout = ''2s''');
SELECT teste.dblink_send_query('c_dsw', 'SELECT public.fn_conturi_inchideri_sweep()::text');
SELECT teste.assert(teste.asteapta_lock(:pid_dsw), 'D-RACE-ERR pregătire: sweep-ul așteaptă profilul (ținut de altă tranzacție)');
SELECT * FROM teste.dblink(:'conn_lock', format($q$SELECT public.fn_cont_coada_pune(%L, %s, 'programata', 'retargetare A→B (test D-RACE-ERR)', CURRENT_DATE)::text$q$,
  :'u_dr4', :e_dr4b)) AS t(x text);
SELECT pg_sleep(3);
SELECT teste.dblink_exec('c_tine4', 'ROLLBACK');
SELECT res AS sweep_dr4 FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
SELECT count(*) AS rest_dr4 FROM teste.dblink_get_result('c_dsw') AS t(res text) \gset
SELECT teste.dblink_exec('c_dsw', 'RESET lock_timeout');
\echo '   D-RACE-ERR sweep:' :sweep_dr4
SELECT teste.assert((:'sweep_dr4'::jsonb ->> 'eroare')::int = 1,
  'D-RACE-ERR eroarea forțată a ajuns în handlerul sweep-ului (rezultat: eroare = 1)');
SELECT teste.assert((SELECT count(*) = 1 FROM public.conturi_inchideri_coada
                      WHERE profile_id = :'u_dr4' AND rezolvat_la IS NULL AND employee_id = :e_dr4b AND incercari = 0
                        AND ultima_eroare IS NULL AND urmatoarea_incercare_la IS NULL AND abandonat_la IS NULL AND notificat_la IS NULL)
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_dr4'),
  'D-RACE-ERR intrarea retargetată pe B rămâne curată: incercari = 0, fără ultima_eroare, fără backoff, neabandonată, nenotificată');
SELECT teste.dblink_disconnect('c_tine4');
SELECT teste.dblink_disconnect('c_dsw');

-- C-RACE-LINK-1 (r6): legarea cont ↔ fișă (owner, fn_cont_leaga_automat aplicare) e blocată la profil (ținut de altă
-- tranzacție) DUPĂ ce a calculat candidatul; între timp altă conexiune încheie contractul fișei și comite. După eliberarea
-- profilului legarea blochează fișa, revalidează sub lock și NU leagă („schimbat” / „fara_candidat”).
SELECT gen_random_uuid() AS u_own, gen_random_uuid() AS u_lk \gset
SELECT teste.dblink_exec(:'conn_lock', format($q$
  INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
  VALUES (%1$L, 'authenticated', 'authenticated', 'owner.race@gazpet.ro', '{"provider":"email"}', now(), now(), now()),
         (%2$L, 'authenticated', 'authenticated', 'link.race@gazpet.ro', '{"provider":"email"}', now(), now(), now());
  UPDATE public.profiles SET is_owner = true WHERE id = %1$L;
  INSERT INTO public.employees (name, department, email, active) VALUES ('LINKESCU RACE', 'Test', 'link.race@gazpet.ro', true);
  INSERT INTO public.employees (name, department, email, active) VALUES ('CNPESCU UNU', 'Test', 'cnp.unu@exemplu.ro', true),
                                                                        ('CNPESCU DOI', 'Test', 'cnp.doi@exemplu.ro', true);
$q$, :'u_own', :'u_lk'));
SELECT max(id) FILTER (WHERE name = 'LINKESCU RACE') AS e_lk, max(id) FILTER (WHERE name = 'CNPESCU UNU') AS e_cn1,
       max(id) FILTER (WHERE name = 'CNPESCU DOI') AS e_cn2
  FROM public.employees WHERE name IN ('LINKESCU RACE', 'CNPESCU UNU', 'CNPESCU DOI') \gset
SELECT teste.dblink_connect('c_own', :'conn_lock');
SELECT * FROM teste.dblink('c_own', format('SELECT teste.ca_utilizator(%L)::text', :'u_own')) AS t(x text);
SELECT pid AS pid_own FROM teste.dblink('c_own', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
SELECT teste.dblink_connect('c_tine5', :'conn_lock');
SELECT teste.dblink_exec('c_tine5', 'BEGIN');
SELECT * FROM teste.dblink('c_tine5', format('SELECT id::text FROM public.profiles WHERE id = %L FOR UPDATE', :'u_lk')) AS t(id text);
SELECT teste.dblink_send_query('c_own', format($q$SELECT COALESCE((SELECT string_agg(rezultat, ',') FROM public.fn_cont_leaga_automat(false, %L::jsonb) WHERE profile_id = %L), '<nimic>')$q$,
  jsonb_build_array(jsonb_build_object('profile_id', :'u_lk', 'employee_id', :e_lk))::text, :'u_lk'));
SELECT teste.assert(teste.asteapta_lock(:pid_own), 'C-RACE-LINK-1 legarea (owner) stă la profilul ținut de altă tranzacție, cu candidatul deja calculat');
SELECT teste.dblink_exec('c_pg', format('UPDATE public.employees SET active = false, termination_date = CURRENT_DATE WHERE id = %s', :e_lk));
SELECT teste.dblink_exec('c_tine5', 'ROLLBACK');
SELECT res AS lk_rez FROM teste.dblink_get_result('c_own') AS t(res text) \gset
SELECT count(*) AS rest_lk FROM teste.dblink_get_result('c_own') AS t(res text) \gset
\echo '   C-RACE-LINK-1 rezultat:' :lk_rez
SELECT teste.assert(:'lk_rez' IN ('schimbat', 'fara_candidat')
    AND (SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_lk'),
  'C-RACE-LINK-1 contractul încheiat între timp ⇒ revalidarea sub lock refuză legarea (schimbat / fara_candidat), profilul rămâne nelegat');
SELECT teste.dblink_disconnect('c_tine5');
SELECT teste.dblink_disconnect('c_own');

-- D-RACE-CNP-NULL (r6): fișa fără CNP (nicio cheie de CNP); CNP-ul apare (NULL → X) în hr_employees_private în timp ce garda
-- rulează ⇒ cheia stabilă gazpet.persoana.emp:<id> le serializează, în ambele ordini.
SELECT teste.dblink_connect('c_g', :'conn_lock');
SELECT teste.dblink_connect('c_h', :'conn_lock');
SELECT pid AS pid_g FROM teste.dblink('c_g', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
SELECT pid AS pid_h FROM teste.dblink('c_h', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
-- ordinea 1: garda întâi (ține lock-urile), apoi CNP-ul apare în datele personale → așteaptă
SELECT teste.dblink_exec('c_g', 'BEGIN');
SELECT res AS g1 FROM teste.dblink('c_g', format('SELECT COALESCE(public.fn_cont_garda_persoana(%s), ''NULL'')', :e_cn1)) AS t(res text) \gset
SELECT teste.dblink_send_query('c_h', format($q$INSERT INTO public.hr_employees_private (employee_id, cnp) VALUES (%s, '1900303000131')$q$, :e_cn1));
SELECT teste.assert(:'g1' = 'cnp_lipsa' AND teste.asteapta_lock(:pid_h),
  'D-RACE-CNP-NULL (1) garda a văzut „cnp_lipsa” și ține cheia fișei: CNP-ul nou în datele personale AȘTEAPTĂ');
SELECT teste.dblink_exec('c_g', 'COMMIT');
SELECT res AS h1 FROM teste.dblink_get_result('c_h') AS t(res text) \gset
SELECT count(*) AS rest_h1 FROM teste.dblink_get_result('c_h') AS t(res text) \gset
-- ordinea 2: CNP-ul apare întâi (necomis), apoi garda → așteaptă și, după COMMIT, vede CNP-ul
SELECT teste.dblink_exec('c_h', 'BEGIN');
SELECT teste.dblink_exec('c_h', format($q$INSERT INTO public.hr_employees_private (employee_id, cnp) VALUES (%s, '1900303000140')$q$, :e_cn2));
SELECT teste.dblink_send_query('c_g', format('SELECT COALESCE(public.fn_cont_garda_persoana(%s), ''NULL'')', :e_cn2));
SELECT teste.assert(teste.asteapta_lock(:pid_g), 'D-RACE-CNP-NULL (2) garda AȘTEAPTĂ CNP-ul necomis din datele personale (cheia fișei)');
SELECT teste.dblink_exec('c_h', 'COMMIT');
SELECT res AS g2 FROM teste.dblink_get_result('c_g') AS t(res text) \gset
SELECT count(*) AS rest_g2 FROM teste.dblink_get_result('c_g') AS t(res text) \gset
\echo '   D-RACE-CNP-NULL garda după COMMIT:' :g2
SELECT teste.assert(:'g2' <> 'cnp_lipsa', 'D-RACE-CNP-NULL (2) după COMMIT garda vede CNP-ul nou (nu mai e „cnp_lipsa”): rulările sunt serializate');
SELECT teste.dblink_disconnect('c_g');
SELECT teste.dblink_disconnect('c_h');
SELECT teste.dblink_exec(:'conn_lock', format($q$
  SET session_replication_role = replica;
  DELETE FROM public.hr_employees_private WHERE employee_id IN (%3$s, %4$s, %5$s);
  DELETE FROM public.hr_colaborare_externa_jurnal WHERE employee_id IN (%3$s, %4$s, %5$s);
  DELETE FROM public.hr_employees_audit WHERE employee_id IN (%3$s, %4$s, %5$s);
  UPDATE public.profiles SET employee_id = NULL WHERE id IN (%1$L, %2$L);
  DELETE FROM public.employees WHERE id IN (%3$s, %4$s, %5$s);
  SET session_replication_role = origin;
  DELETE FROM auth.users WHERE id IN (%1$L, %2$L);
$q$, :'u_own', :'u_lk', :e_lk, :e_cn1, :e_cn2));
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (:'u_own', :'u_lk'))
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id IN (:'u_own', :'u_lk'))
    AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id IN (:e_lk, :e_cn1, :e_cn2))
    AND NOT EXISTS (SELECT 1 FROM public.hr_employees_private WHERE employee_id IN (:e_lk, :e_cn1, :e_cn2)),
  'C-RACE-LINK-1 / D-RACE-CNP-NULL curățenie: datele comise au fost șterse');

-- E-RACE-1: activarea externului (necomisă) ↔ acordul trece accepta → refuza.
SELECT teste.dblink_exec('c_hr1', 'BEGIN');
SELECT teste.dblink_exec('c_hr1', format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :x1));
SELECT teste.dblink_send_query('c_hr2', format($q$SELECT COALESCE(teste.eroare('SELECT public.fn_colaborare_externa_seteaza(%s, ''refuza'', ''refuz de test E-RACE'')')::text, 'OK')$q$, :e_f1));
SELECT teste.assert(teste.asteapta_lock(:pid_hr2), 'E-RACE-1 schimbarea acordului AȘTEAPTĂ activarea externului necomisă');
SELECT teste.dblink_exec('c_hr1', 'COMMIT');
SELECT res AS er1 FROM teste.dblink_get_result('c_hr2') AS t(res text) \gset
SELECT count(*) AS rest_er1 FROM teste.dblink_get_result('c_hr2') AS t(res text) \gset
SELECT teste.assert(:'er1' = 'OK'
    AND (SELECT colaborare_externa_status = 'refuza' FROM public.employees WHERE id = :e_f1)
    AND (SELECT activ IS FALSE FROM public.hr_personal_extern WHERE id = :x1),
  'E-RACE-1 stare finală consistentă: acord „refuza” ȘI externul dezactivat (nu rămâne activ fără acord)');

-- E-RACE-2: reactivarea fișei (necomisă) ↔ activarea externului legat.
SELECT pid AS pid_hr1 FROM teste.dblink('c_hr1', 'SELECT pg_backend_pid()') AS t(pid integer) \gset
SELECT teste.dblink_exec('c_pg', 'BEGIN');
SELECT teste.dblink_exec('c_pg', format('UPDATE public.employees SET active = true, termination_date = NULL WHERE id = %s', :e_f2));
SELECT teste.dblink_send_query('c_hr1', format($q$SELECT COALESCE(teste.eroare('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s')::text, 'OK')$q$, :x2));
SELECT teste.assert(teste.asteapta_lock(:pid_hr1), 'E-RACE-2 activarea externului AȘTEAPTĂ reactivarea fișei necomisă');
SELECT teste.dblink_exec('c_pg', 'COMMIT');
SELECT res AS er2 FROM teste.dblink_get_result('c_hr1') AS t(res text) \gset
SELECT count(*) AS rest_er2 FROM teste.dblink_get_result('c_hr1') AS t(res text) \gset
SELECT teste.assert(:'er2' ~ '"state": "23514"'
    AND (SELECT activ IS FALSE FROM public.hr_personal_extern WHERE id = :x2)
    AND (SELECT active IS TRUE FROM public.employees WHERE id = :e_f2),
  'E-RACE-2 după reactivare activarea externului e refuzată (23514): niciun extern activ legat de un angajat activ');

-- E-RACE-3: fișa activă devine „fost angajat” (necomis) ↔ un extern NELEGAT activ cu aceeași identitate (HR, nu owner).
SELECT teste.dblink_exec('c_pg', 'BEGIN');
SELECT teste.dblink_exec('c_pg', format('UPDATE public.employees SET active = false, termination_date = CURRENT_DATE - 1 WHERE id = %s', :e_g));
SELECT teste.dblink_send_query('c_hr1', $q$SELECT COALESCE(teste.eroare('INSERT INTO public.hr_personal_extern (nume, activ) VALUES (''Trei Gracescu'', true)')::text, 'OK')$q$);
SELECT teste.assert(teste.asteapta_lock(:pid_hr1), 'E-RACE-3 externul nelegat cu aceeași identitate AȘTEAPTĂ trecerea fișei în „fost angajat”');
SELECT teste.dblink_exec('c_pg', 'COMMIT');
SELECT res AS er3 FROM teste.dblink_get_result('c_hr1') AS t(res text) \gset
SELECT count(*) AS rest_er3 FROM teste.dblink_get_result('c_hr1') AS t(res text) \gset
SELECT teste.assert(:'er3' ~ '"state": "23514"'
    AND NOT EXISTS (SELECT 1 FROM public.hr_personal_extern WHERE lower(nume) = 'trei gracescu'),
  'E-RACE-3 după COMMIT externul nelegat e refuzat (23514): marcajul / acordul nu pot fi ocolite prin cursă');

SELECT teste.dblink_disconnect('c_hr1');
SELECT teste.dblink_disconnect('c_hr2');
SELECT teste.dblink_disconnect('c_pg');
SELECT teste.dblink_exec(:'conn_lock', format($q$
  SET session_replication_role = replica;               -- doar pentru curățenia testului: jurnalele sunt append-only
  DELETE FROM public.hr_personal_extern WHERE id IN (%3$s, %4$s) OR lower(nume) = 'trei gracescu';
  DELETE FROM public.hr_colaborare_externa_jurnal WHERE employee_id IN (%5$s, %6$s, %7$s, %8$s);
  DELETE FROM public.conturi_inchideri_coada WHERE profile_id IN (%1$L, %9$L, %11$L, %14$L) OR employee_id IN (%5$s, %6$s, %7$s, %8$s, %10$s, %12$s, %13$s, %15$s, %16$s);
  DELETE FROM public.conturi_inchideri_jurnal WHERE profile_id IN (%1$L, %9$L, %11$L, %14$L);
  DELETE FROM public.hr_employees_audit WHERE employee_id IN (%5$s, %6$s, %7$s, %8$s, %10$s, %12$s, %13$s, %15$s, %16$s);
  UPDATE public.profiles SET employee_id = NULL WHERE id IN (%1$L, %9$L, %11$L, %14$L);
  DELETE FROM public.employees WHERE id IN (%5$s, %6$s, %7$s, %8$s, %10$s, %12$s, %13$s, %15$s, %16$s);
  SET session_replication_role = origin;
  DELETE FROM auth.users WHERE id IN (%1$L, %2$L, %9$L, %11$L, %14$L);
$q$, :'u_dr', :'u_ehr', :x1, :x2, :e_dr, :e_f1, :e_f2, :e_g, :'u_dr2', :e_dr2, :'u_dr3', :e_dr3a, :e_dr3b, :'u_dr4', :e_dr4a, :e_dr4b));
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (:'u_dr', :'u_ehr', :'u_dr2', :'u_dr3', :'u_dr4'))
    AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id IN (:e_dr4a, :e_dr4b))
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_dr4')
    AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id IN (:e_dr3a, :e_dr3b))
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_dr3')
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id IN (:'u_dr', :'u_ehr', :'u_dr2'))
    AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id IN (:e_dr, :e_f1, :e_f2, :e_g, :e_dr2))
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_dr2')
    AND NOT EXISTS (SELECT 1 FROM public.hr_personal_extern WHERE id IN (:x1, :x2))
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_dr')
    AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE profile_id IN (:'u_dr', :'u_ehr', :'u_dr2')),
  'RACE curățenie: datele comise ale testelor de concurență au fost șterse');

-- R2-28e-lock / X2 (runda 3) — tot aici, înaintea oricărui DDL al tranzacției testului (DROP / CREATE TRIGGER pe profiles și
-- auth.users ar bloca citirile / verificările FK ale celorlalte conexiuni și testul n-ar mai arăta ce lock așteaptă).
-- Tranzacția testului încheie fișa A (CNP pe fișă, ca din wizard): garda ia lock-urile persoanei (CNP, cuvintele numelui,
-- email) până la final. Altă conexiune, în același timp:
--   * pune CNP-ul lui A în DATELE PERSONALE ale unei fișe noi (hr_employees_private, sursa aplicației) → așteaptă garda;
--   * creează o fișă nouă ACTIVĂ cu numele lui A și FĂRĂ CNP (X2: înainte nu lua niciun lock) → așteaptă garda;
--   * control: alt CNP / alt nume → trec.
-- Contextul erorii (fn_cont_lock_chei) arată că se așteaptă lock-ul persoanei, nu altceva.
CREATE FUNCTION teste.eroare_ctx(p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v_state text; v_msg text; v_ctx text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
    RETURN jsonb_build_object('state', v_state, 'msg', v_msg, 'ctx', v_ctx);
  END;
  RETURN NULL;
END $fn$;
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('LOCKESCU PAUL', 'Test', 'lockescu.paul@gazpet.ro', true, '1900303000077')
  RETURNING id AS e_lk \gset
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_lk;          -- garda A: lock pe persoană până la COMMIT
SELECT COALESCE(teste.eroare_ctx(format('SELECT teste.dblink_exec(%L, %L)', :'conn_lock',
    $q$BEGIN; SET LOCAL lock_timeout = '300ms';
       WITH e AS (INSERT INTO public.employees (name, department, active) VALUES ('ZZPRIV ALFA', 'Test', true) RETURNING id)
       INSERT INTO public.hr_employees_private (employee_id, cnp) SELECT id, '1900303000077' FROM e; ROLLBACK;$q$)), '{}'::jsonb) AS err_priv \gset
SELECT teste.assert(:'err_priv'::jsonb ->> 'state' = '55P03' AND :'err_priv'::jsonb ->> 'ctx' LIKE '%fn_cont_lock_chei%'
                    AND :'err_priv'::jsonb ->> 'ctx' LIKE '%fn_hr_employees_private_persoana_lock%',
  'R2-28e-lock altă conexiune: CNP-ul persoanei în curs de încheiere pus în hr_employees_private (fișă nouă) → așteaptă lock-ul persoanei (55P03, trg_hr_employees_private_persoana_lock)');
SELECT teste.assert(teste.dblink_exec(:'conn_lock',
    $q$BEGIN; SET LOCAL lock_timeout = '300ms';
       WITH e AS (INSERT INTO public.employees (name, department, active) VALUES ('ZZPRIV BETA', 'Test', true) RETURNING id)
       INSERT INTO public.hr_employees_private (employee_id, cnp) SELECT id, '1900303000088' FROM e; ROLLBACK;$q$) = 'ROLLBACK',
  'R2-28e-lock control: alt CNP în datele personale → trece (lock doar pe persoana în curs de încheiere)');
SELECT COALESCE(teste.eroare_ctx(format('SELECT teste.dblink_exec(%L, %L)', :'conn_lock',
    'BEGIN; SET LOCAL lock_timeout = ''300ms''; INSERT INTO public.employees (name, department, active) VALUES (''LOCKESCU PAUL'', ''Execuție'', true); ROLLBACK;')), '{}'::jsonb) AS err_x2 \gset
SELECT teste.assert(:'err_x2'::jsonb ->> 'state' = '55P03' AND :'err_x2'::jsonb ->> 'ctx' LIKE '%fn_employees_persoana_lock%',
  'X2 altă conexiune: fișă nouă ACTIVĂ cu numele persoanei în curs de încheiere, FĂRĂ CNP → așteaptă lock-ul persoanei (55P03; înainte: niciun lock)');
SELECT teste.assert(teste.dblink_exec(:'conn_lock',
    'BEGIN; SET LOCAL lock_timeout = ''300ms''; INSERT INTO public.employees (name, department, active) VALUES (''ZZALTUL ION'', ''Execuție'', true); ROLLBACK;') = 'ROLLBACK',
  'X2 control: fișă nouă fără CNP cu alt nume → trece');
\endif

-- ---------------------------------------------------------------- BAZĂ: crearea contului (GoTrue)
SELECT teste.creeaza_cont('owner.test@gazpet.ro', :'owner');
UPDATE public.profiles SET is_owner = true WHERE id = :'owner';           -- admin: triggerele sar peste
SELECT teste.creeaza_cont('ion.popescu@gazpet.ro', :'u_ion');
SELECT teste.creeaza_cont('hr.test@gazpet.ro', :'u_hr');
UPDATE public.profiles SET can_modify_employees = true WHERE id = :'u_hr';

SELECT teste.assert((SELECT count(*) = 1 FROM public.profiles
    WHERE id = :'u_ion' AND email = 'ion.popescu@gazpet.ro' AND role = 'manager_santier' AND name = 'Ion Popescu'),
  'T2 on_auth_user_created creează profilul (INSERT făcut ca supabase_auth_admin, search_path=auth)');
SELECT teste.assert((SELECT count(*) = 1 FROM auth.sessions WHERE user_id = :'u_ion')
    AND (SELECT count(*) = 1 FROM auth.refresh_tokens WHERE user_id = :'u_ion'::text AND revoked = false),
  'T2 contul are o sesiune și un refresh token nerevocat (ținte pentru revocarea R2)');
SELECT teste.assert(NOT has_table_privilege('supabase_auth_admin', 'public.employees', 'SELECT'),
  'T2 supabase_auth_admin nu are drepturi pe public.employees → logica din triggerul pe auth.users trebuie SECURITY DEFINER');
SELECT teste.assert(NOT has_table_privilege('authenticated', 'auth.users', 'UPDATE'),
  'T2 authenticated nu poate scrie auth.users (banned_until se setează doar prin funcție SECURITY DEFINER)');
-- T2b (audit A #7) harness-ul simulează LOGIN-UL real al GoTrue, nu doar rolul
CREATE TABLE teste.captura_login (sesiune text, curent text, claims text);
CREATE FUNCTION teste.fn_captura_login() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  INSERT INTO teste.captura_login VALUES (session_user, current_user, nullif(current_setting('request.jwt.claims', true), ''));
  RETURN NULL;
END $fn$;
CREATE TRIGGER zz_test_captura_login AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION teste.fn_captura_login();
SELECT teste.creeaza_cont('captura.login@gazpet.ro');
DROP TRIGGER zz_test_captura_login ON auth.users;
SELECT teste.assert((SELECT sesiune = 'supabase_auth_admin' AND claims IS NULL FROM teste.captura_login),
  'T2b crearea contului rulează pe login-ul GoTrue: session_user = supabase_auth_admin, fără claims (ca în producție)');

-- ---------------------------------------------------------------- BAZĂ: RLS + triggere owner-only
SELECT teste.ca_utilizator(:'u_ion');
SELECT teste.assert(auth.uid() = :'u_ion'::uuid AND current_user = 'authenticated' AND session_user = 'authenticator'
                    AND nullif(current_setting('request.jwt.claim.sub', true), '') IS NULL,
  'T3 identitate PostgREST simulată: login authenticator, rol authenticated, doar request.jwt.claims (PostgREST v12)');
SELECT teste.asteapta_eroare(
  $$INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('00000000-0000-4000-8000-00000000a001', 'hr', 'admin')$$,
  'T3 non-owner nu își poate acorda module (RLS)', '42501');
UPDATE public.profiles SET can_access_salarii = true, whatsapp_enabled = true WHERE id = :'u_ion';
SELECT teste.ca_admin();
SELECT teste.assert((SELECT NOT can_access_salarii AND whatsapp_enabled FROM public.profiles WHERE id = :'u_ion'),
  'T3 enforce_owner_only_salary_flags anulează SILENȚIOS flagurile protejate setate de non-owner');

SELECT teste.ca_utilizator(:'owner');
INSERT INTO public.user_module_access (profile_id, module, access_level, granted_by) VALUES (:'u_ion', 'hr', 'viewer', :'owner');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT count(*) = 1 FROM public.user_module_access WHERE profile_id = :'u_ion' AND module = 'hr'),
  'T3 owner poate acorda un modul');

-- CAPCANĂ R2: o funcție SECURITY DEFINER apelată (sau declanșată) de un NON-owner păstrează
-- auth.uid() = apelantul → triggerele owner-only anulează resetarea flagurilor protejate.
UPDATE public.profiles SET can_access_salarii = true WHERE id = :'u_ion';  -- admin
CREATE FUNCTION public.tmp_test_inchide_flaguri(p uuid) RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  UPDATE public.profiles SET can_access_salarii = false, whatsapp_enabled = false WHERE id = p;
END $fn$;
SELECT teste.ca_utilizator(:'u_hr');                                       -- HR cu can_modify_employees
SELECT public.tmp_test_inchide_flaguri(:'u_ion');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT can_access_salarii AND NOT whatsapp_enabled FROM public.profiles WHERE id = :'u_ion'),
  'T3 capcană confirmată: SECURITY DEFINER rulat de non-owner NU poate reseta can_access_salarii (triggerul îl repune)');

-- ---------------------------------------------------------------- BAZĂ: încheierea contractului azi
INSERT INTO public.employees (name, department, email, active) VALUES ('POPESCU ION', 'Execuție', 'ion.popescu@gazpet.ro', true)
  RETURNING id AS emp_ion \gset
INSERT INTO public.employees (name, department, active, termination_date) VALUES ('TEST CRON', 'Test', true, CURRENT_DATE - 1)
  RETURNING id AS emp_cron \gset

-- Calea UI: termination_date setată în trecut/azi → fn_employees_termination_notify pune active=false în același UPDATE
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :emp_ion;
SELECT teste.ca_admin();
SELECT teste.assert((SELECT active = false FROM public.employees WHERE id = :emp_ion),
  'T4 UPDATE termination_date <= azi (UI, HR) → active=false prin triggerul existent');
UPDATE public.employees SET termination_date = CURRENT_DATE + 30, active = true WHERE id = :emp_ion;
SELECT teste.assert((SELECT active FROM public.employees WHERE id = :emp_ion),
  'T4 termination_date în viitor → angajatul rămâne activ până rulează cron-ul');

-- Calea pg_cron (04:00 UTC, ca postgres fără JWT)
SELECT teste.assert(teste.cron_hr_auto_deactivate_terminated() = 1, 'T5 cron-ul dezactivează exact angajatul cu termination_date ajunsă');
SELECT teste.assert((SELECT NOT active FROM public.employees WHERE id = :emp_cron)
    AND (SELECT active FROM public.employees WHERE id = :emp_ion),
  'T5 cron: TEST CRON inactiv, POPESCU ION (dată viitoare) încă activ');

-- ---------------------------------------------------------------- BAZĂ: precondiția live S-A (20260929g)
-- md5 canonic al variantei LIVE (2 coloane) = c06d7ce0…; rularea de verificare cu S-A EXTINS (20260930a, NEAPLICAT în
-- producție, pus ca a doua precondiție doar din scratchpad) are f4871f5a… — ambele sunt acceptate, variantă afișată.
-- 01.10.2026: producția are acum varianta SEC F2 r4 (20260930j, live 01.10) — md5 9acc36a4… (citit read-only de pe live).
-- 01.10.2026 seara: 30a (#532) e LIVE (v20261001178000) peste F2 r4 — md5 1114af39… (citit read-only de pe live).
SELECT CASE md5(prosrc) WHEN 'c06d7ce0f212c7bba2093c50614a88fc' THEN 'live_20260929g'
                        WHEN '9acc36a4067eddbdf29956220023ea92' THEN 'live_f2_20260930j'
                        WHEN 'f4871f5a99d6d880cc62a80c3fe65c01' THEN 'extins_20260930a'
                        WHEN '1114af39c13e295dd2ab666dab495567' THEN 'live_30a_v20261001178000' END AS sa_varianta
  FROM pg_proc WHERE oid = 'public.fn_profiles_campuri_owner_only()'::regprocedure \gset
\echo '   S-A varianta:' :sa_varianta
SELECT teste.assert(:'sa_varianta' IN ('live_20260929g', 'live_f2_20260930j', 'extins_20260930a', 'live_30a_v20261001178000')
    AND (SELECT tgenabled = 'O' FROM pg_trigger WHERE tgname = 'trg_profiles_campuri_owner_only' AND tgrelid = 'public.profiles'::regclass),
  'SA-01 S-A: trg_profiles_campuri_owner_only activ, md5(prosrc) = c06d7ce0f212c7bba2093c50614a88fc (= producția) sau varianta extinsă verificată');
-- decizia unui UPDATE făcut printr-un RPC SECURITY DEFINER (ajunge la rând ocolind RLS): 'trece' sau SQLSTATE;
-- modificarea se anulează mereu (P0T99), identitatea (login + claims) e a apelantului
CREATE FUNCTION teste.decizie_rpc(p_sql text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'anulat' USING ERRCODE = 'P0T99';
  EXCEPTION
    WHEN SQLSTATE 'P0T99' THEN RETURN 'trece';
    WHEN OTHERS THEN RETURN SQLSTATE;
  END;
END $fn$;
SELECT teste.ca_login('supabase_auth_admin');
SELECT teste.decizie_rpc(format('UPDATE public.profiles SET employee_id = %s WHERE id = %L', :emp_cron, :'u_ion')) AS sa_gotrue \gset
SELECT teste.ca_admin();
SELECT teste.decizie_rpc(format('UPDATE public.profiles SET employee_id = %s WHERE id = %L', :emp_cron, :'u_ion')) AS sa_admin \gset
SELECT teste.assert(:'sa_gotrue' = '42501' AND :'sa_admin' = 'trece',
  'SA-02 S-A: login GoTrue (supabase_auth_admin, fără claims) NU poate scrie employee_id (42501); login postgres fără claims (cron / migrare) poate');
SELECT teste.assert((SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger
                      WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal AND tgtype & 2 = 2 AND tgtype & 16 = 16)
                    @> ARRAY['trg_profiles_campuri_owner_only'],
  'SA-03 S-A e trigger BEFORE UPDATE pe profiles');

-- ---------------------------------------------------------------- BAZĂ: reguli Supabase pentru obiecte noi (CLAUDE.md pct. 4)
CREATE TABLE public.tmp_canar_privilegii (id int);
SELECT teste.assert(has_table_privilege('anon', 'public.tmp_canar_privilegii', 'SELECT'),
  'T6 un tabel nou din public e implicit accesibil lui anon/authenticated → ENABLE RLS obligatoriu');
CREATE FUNCTION public.tmp_canar_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
REVOKE EXECUTE ON FUNCTION public.tmp_canar_fn() FROM PUBLIC;
SELECT teste.assert(has_function_privilege('anon', 'public.tmp_canar_fn()', 'EXECUTE'),
  'T6 REVOKE ... FROM PUBLIC NU ajunge: anon păstrează EXECUTE (grant implicit Supabase)');
REVOKE EXECUTE ON FUNCTION public.tmp_canar_fn() FROM anon, authenticated;
SELECT teste.assert(NOT has_function_privilege('anon', 'public.tmp_canar_fn()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.tmp_canar_fn()', 'EXECUTE'),
  'T6 după REVOKE FROM PUBLIC, anon, authenticated funcția nu mai e apelabilă din API');

\if :doar_baza
\echo '   (R1–R3 sărite: rulare doar BAZĂ)'
\else
-- ============================================================================
-- R1 — legare automată cont ↔ angajat (migrarea 20260929c)
-- ============================================================================
SELECT teste.ca_admin();
\set u_r1email 00000000-0000-4000-8000-0000000b0001
\set u_r1diac 00000000-0000-4000-8000-0000000b0002
\set u_r1sed 00000000-0000-4000-8000-0000000b0003
\set u_r1ord 00000000-0000-4000-8000-0000000b0004
\set u_r1amb 00000000-0000-4000-8000-0000000b0005
\set u_r1zero 00000000-0000-4000-8000-0000000b0006
\set u_r1inact 00000000-0000-4000-8000-0000000b0007
\set u_r1inch 00000000-0000-4000-8000-0000000b0008
\set u_r1vechi 00000000-0000-4000-8000-0000000b0009
\set u_r1ocup 00000000-0000-4000-8000-0000000b000a
\set u_r1gmail 00000000-0000-4000-8000-0000000b000b
\set u_r1adrom 00000000-0000-4000-8000-0000000b000c
\set u_r1dublu 00000000-0000-4000-8000-0000000b000d
\set u_r1pre 00000000-0000-4000-8000-0000000b000e
\set u_r1err 00000000-0000-4000-8000-0000000b000f
\set u_r1notif 00000000-0000-4000-8000-0000000b0010
\set u_r1tarziu 00000000-0000-4000-8000-0000000b0011
\set u_r1simplu 00000000-0000-4000-8000-0000000b0012

INSERT INTO public.employees (name, department, email, active) VALUES ('EMAILESCU TEST', 'Test', '  Legat.Email@Gazpet.RO ', true)
  RETURNING id AS e_r1email \gset
INSERT INTO public.employees (name, department, active) VALUES ('ȘTEFĂNESCU ANA-MARIA', 'Test', true) RETURNING id AS e_r1diac \gset
INSERT INTO public.employees (name, department, active) VALUES ('ŢUŢUIANU ŞTEFAN', 'Test', true) RETURNING id AS e_r1sed \gset
INSERT INTO public.employees (name, department, active) VALUES ('IORDACHE RADU', 'Test', true) RETURNING id AS e_r1ord \gset
INSERT INTO public.employees (name, department, active) VALUES ('POPESCU MIHAI', 'Test', true) RETURNING id AS e_r1amb1 \gset
INSERT INTO public.employees (name, department, active) VALUES ('POPESCU MIHAI', 'Execuție', true) RETURNING id AS e_r1amb2 \gset
INSERT INTO public.employees (name, department, active) VALUES ('INACTIV DORU', 'Test', false) RETURNING id AS e_r1inact \gset
INSERT INTO public.employees (name, department, active, termination_date) VALUES ('INCHEIAT PAUL', 'Test', true, CURRENT_DATE)
  RETURNING id AS e_r1inch \gset
INSERT INTO public.employees (name, department, active) VALUES ('OCUPAT GELU', 'Test', true) RETURNING id AS e_r1ocup \gset
INSERT INTO public.employees (name, department, active) VALUES ('ALEXANDRU MARIUS', 'Test', true), ('KONSTANTINOS TSIRIGOTIS', 'Test', true),
  ('VLADUCU SORIN', 'Test', true), ('ION ION', 'Test', true);
INSERT INTO public.employees (name, department, email, active) VALUES ('ADROM EXTERN', 'Test', 'dragos.test@adromevolution.ro', true)
  RETURNING id AS e_r1adrom \gset
INSERT INTO public.employees (name, department, email, active) VALUES ('DUBLU UNU', 'Test', 'dublu.unu@gazpet.ro', true), ('DUBLU DOI', 'Test', 'Dublu.Unu@gazpet.ro', true);
INSERT INTO public.employees (name, department, active) VALUES ('PREEXISTENT XAVIER', 'Test', true) RETURNING id AS e_r1prex \gset
INSERT INTO public.employees (name, department, email, active) VALUES ('SUPRASCRIS YANIS', 'Test', 'yanis.suprascris@gazpet.ro', true)
  RETURNING id AS e_r1prey \gset
INSERT INTO public.employees (name, department, active) VALUES ('LEGARE EROARE', 'Test', true) RETURNING id AS e_r1err \gset
INSERT INTO public.employees (name, department, active) VALUES ('PICA NOTIF', 'Test', true) RETURNING id AS e_r1notif \gset
INSERT INTO public.employees (name, department, active) VALUES ('LIBER LUCIAN', 'Test', true) RETURNING id AS e_r1liber \gset

-- R1-00 (review, critic) înscrierea publică NU leagă singură: doar propune candidatul unic owner-ului.
-- Aceeași fișă și același email ca R1-01, dar prin signUp (fără app_metadata de încredere).
\set u_r1public 00000000-0000-4000-8000-0000000b0013
SELECT teste.creeaza_cont('legat.email@gazpet.ro', :'u_r1public');
SELECT teste.assert((SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1public'),
  'R1-00 înscriere publică (signUp) cu emailul de pe fișă → contul NU se leagă singur');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_legare_propusa'
    AND message LIKE 'Cont nou legat.email@gazpet.ro → propunere: EMAILESCU TEST (#' || :e_r1email || ', prin email)%NU-l lega%'),
  'R1-00 owner-ul primește propunerea (cont_legare_propusa) cu candidatul unic');
DELETE FROM auth.users WHERE id = :'u_r1public';                                   -- profilul cade în cascadă
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = :'u_r1public'), 'R1-00 curățenie: contul de test șters');

-- R1-01 email identic (majuscule/spații pe fișă), metoda email, notificare owner — CALEA DE ÎNCREDERE
-- (funcția edge cont-nou: createUser cu app_metadata.gazpet_legare_automata = true, pe care signUp nu-l poate pune,
--  apoi RPC-ul fn_cont_leaga_la_creare cu service_role — teste.creeaza_cont_owner)
SELECT teste.creeaza_cont_owner('legat.email@gazpet.ro', :'u_r1email');
SELECT teste.assert((SELECT employee_id = :e_r1email FROM public.profiles WHERE id = :'u_r1email'),
  'R1-01 email identic (case/spații) → legat automat de fișa unică');
SELECT teste.assert((SELECT count(*) = 1 AND bool_and(metoda = 'email') FROM public.fn_cont_candidati_angajat('legat.email@gazpet.ro')),
  'R1-01 candidatul vine din pasul email (metoda=email)');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_legat_automat'
    AND message LIKE '%legat.email@gazpet.ro%EMAILESCU TEST%prin email%'),
  'R1-01 owner-ul primește notificarea cont_legat_automat');

-- R1-02 diacritice (virgulă și sedilă), nume compus cu cratimă
SELECT teste.creeaza_cont_owner('ana-maria.stefanescu@gazpet.ro', :'u_r1diac');
SELECT teste.assert((SELECT employee_id = :e_r1diac FROM public.profiles WHERE id = :'u_r1diac'),
  'R1-02 ȘTEFĂNESCU ANA-MARIA ← ana-maria.stefanescu@gazpet.ro (fără diacritice, cu cratimă) → legat');
SELECT teste.creeaza_cont_owner('stefan.tutuianu@gazpet.ro', :'u_r1sed');
SELECT teste.assert((SELECT employee_id = :e_r1sed FROM public.profiles WHERE id = :'u_r1sed'),
  'R1-02 ŢUŢUIANU ŞTEFAN (ţ/ş cu sedilă) ← stefan.tutuianu@gazpet.ro → legat');

-- R1-03 ordinea nu contează
SELECT teste.assert((SELECT count(*) = 1 AND min(employee_id) = :e_r1diac AND bool_and(metoda = 'nume')
    FROM public.fn_cont_candidati_angajat('stefanescu.ana@gazpet.ro')),
  'R1-03 stefanescu.ana@ găsește aceeași fișă (tokeni în orice ordine)');
SELECT teste.assert((SELECT profil_legat = :'u_r1diac'::uuid FROM public.fn_cont_candidati_angajat('stefanescu.ana@gazpet.ro')),
  'R1-03 candidatul raportează profilul deja legat');
SELECT teste.creeaza_cont_owner('iordache.radu@gazpet.ro', :'u_r1ord');
SELECT teste.assert((SELECT employee_id = :e_r1ord FROM public.profiles WHERE id = :'u_r1ord'),
  'R1-03 nume.prenume@ (IORDACHE RADU ← iordache.radu@) → legat');

-- R1-04 doi candidați → nelegat, notificare, alertă cu 2 candidați
SELECT teste.creeaza_cont('mihai.popescu@gazpet.ro', :'u_r1amb');
SELECT teste.assert((SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1amb'),
  'R1-04 doi angajați activi POPESCU MIHAI → contul NU se leagă');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_nelegat'
    AND message = 'Cont nou mihai.popescu@gazpet.ro nelegat: 2 candidați'),
  'R1-04 notificare cont_nelegat „2 candidați”');

-- R1-05 zero potriviri → profil creat normal
SELECT teste.creeaza_cont('test.ofertare@gazpet.ro', :'u_r1zero');
SELECT teste.assert((SELECT employee_id IS NULL AND role = 'manager_santier' AND name = 'Test Ofertare' FROM public.profiles WHERE id = :'u_r1zero'),
  'R1-05 0 candidați → nelegat, profil creat normal (role manager_santier)');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_nelegat'
    AND message = 'Cont nou test.ofertare@gazpet.ro nelegat: 0 candidați'),
  'R1-05 notificare cont_nelegat „0 candidați”');

-- R1-06 singura potrivire e inactivă / cu contract încheiat azi → nelegat
SELECT teste.creeaza_cont('doru.inactiv@gazpet.ro', :'u_r1inact');
SELECT teste.creeaza_cont('paul.incheiat@gazpet.ro', :'u_r1inch');
SELECT teste.assert((SELECT count(*) = 2 FROM public.profiles WHERE id IN (:'u_r1inact', :'u_r1inch') AND employee_id IS NULL),
  'R1-06 angajat inactiv / termination_date <= azi nu e candidat → nelegat');

-- R1-07 candidatul unic are deja cont → nelegat, fără eroare
SELECT teste.creeaza_cont('gelu.vechi@gazpet.ro', :'u_r1vechi');
UPDATE public.profiles SET employee_id = :e_r1ocup WHERE id = :'u_r1vechi';          -- admin
SELECT teste.creeaza_cont_owner('gelu.ocupat@gazpet.ro', :'u_r1ocup');
SELECT teste.assert((SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1ocup')
    AND (SELECT employee_id = :e_r1ocup FROM public.profiles WHERE id = :'u_r1vechi'),
  'R1-07 candidat unic deja legat → contul nou se creează nelegat, cel vechi rămâne legat');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_nelegat'
    AND message = 'Cont nou gelu.ocupat@gazpet.ro nelegat: candidatul unic are deja cont'),
  'R1-07 notificare „candidatul unic are deja cont”');

-- R1-08 inițialele nu trec
SELECT teste.assert((SELECT count(*) = 0 FROM public.fn_cont_candidati_angajat('m.alexandru@gazpet.ro'))
    AND (SELECT count(*) = 0 FROM public.fn_cont_candidati_angajat('konstantinos.t@gazpet.ro')),
  'R1-08 m.alexandru@ / konstantinos.t@ → 0 candidați (inițialele nu sunt cuvinte întregi)');

-- R1-09 sub 2 tokeni distincți → niciodată
SELECT teste.assert((SELECT count(*) = 0 FROM public.fn_cont_candidati_angajat('vladucu@gazpet.ro')),
  'R1-09 un singur token (vladucu@, un singur VLADUCU activ) → 0 candidați');
SELECT teste.assert((SELECT count(*) = 0 FROM public.fn_cont_candidati_angajat('ion.ion@gazpet.ro')),
  'R1-09 ion.ion@ (1 token distinct, deși există ION ION) → 0 candidați');

-- R1-10 domeniu extern: pasul nume nu se aplică; email identic → legat
SELECT teste.creeaza_cont('ion.popescu@gmail.com', :'u_r1gmail');
SELECT teste.assert((SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1gmail')
    AND (SELECT count(*) = 0 FROM public.fn_cont_candidati_angajat('ion.popescu@gmail.com')),
  'R1-10 ion.popescu@gmail.com → pasul nume nu se aplică în afara gazpet.ro');
SELECT teste.assert((SELECT count(*) = 0 FROM public.notifications WHERE type = 'cont_nelegat' AND message LIKE '%@gmail.com%'),
  'R1-10 cont extern nelegat → fără notificare cont_nelegat (doar @gazpet.ro)');
SELECT teste.creeaza_cont_owner('dragos.test@adromevolution.ro', :'u_r1adrom');
SELECT teste.assert((SELECT employee_id = :e_r1adrom FROM public.profiles WHERE id = :'u_r1adrom'),
  'R1-10 email identic pe fișă, alt domeniu (adromevolution.ro) → legat');

-- R1-11 email duplicat pe 2 fișe active → nelegat, fără trecere la pasul nume
SELECT teste.creeaza_cont('dublu.unu@gazpet.ro', :'u_r1dublu');
SELECT teste.assert((SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1dublu'),
  'R1-11 email identic pe 2 fișe active → ambiguu, nelegat');
SELECT teste.assert((SELECT count(*) = 2 AND bool_and(metoda = 'email') FROM public.fn_cont_candidati_angajat('dublu.unu@gazpet.ro')),
  'R1-11 doar potrivirile pe email (pasul nume, care ar fi dat DUBLU UNU unic, NU rulează)');

-- R1-12 fără suprascriere: profil deja existent cu employee_id (simulat cu un trigger AFTER ordonat înaintea
-- lui on_auth_user_created; în producție nu se pot pune triggere pe auth.users — doar în testul local)
CREATE FUNCTION teste.fn_preprofil() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.email = 'yanis.suprascris@gazpet.ro' THEN
    INSERT INTO public.profiles (id, email, name, role, employee_id)
    VALUES (NEW.id, NEW.email, 'Preexistent', 'manager_santier', (SELECT id FROM public.employees WHERE name = 'PREEXISTENT XAVIER'));
  END IF;
  RETURN NULL;
END $fn$;
CREATE TRIGGER a_test_preprofil AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION teste.fn_preprofil();
SELECT teste.creeaza_cont_owner('yanis.suprascris@gazpet.ro', :'u_r1pre');
DROP TRIGGER a_test_preprofil ON auth.users;
SELECT teste.assert((SELECT employee_id = :e_r1prex FROM public.profiles WHERE id = :'u_r1pre'),
  'R1-12 legătura existentă NU se suprascrie (candidatul unic pe email era altă fișă)');

-- R1-13 izolarea erorilor (eroarea de legare apare acum în RPC-ul fn_cont_leaga_la_creare, nu în triggerul GoTrue)
CREATE FUNCTION teste.fn_pica_legare() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN RAISE EXCEPTION 'test: legarea pică'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER zz_test_pica_legare BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION teste.fn_pica_legare();
SELECT teste.creeaza_cont_owner('eroare.legare@gazpet.ro', :'u_r1err');
DROP TRIGGER zz_test_pica_legare ON public.profiles;
SELECT teste.assert((SELECT count(*) = 1 FROM auth.users WHERE id = :'u_r1err')
    AND (SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1err'),
  'R1-13 eroare la legare → contul și profilul există, employee_id NULL');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_nelegat'
    AND message LIKE 'Cont nou eroare.legare@gazpet.ro nelegat: eroare la legare:%'),
  'R1-13 eroarea de legare ajunge la owner ca motiv în cont_nelegat');
CREATE FUNCTION teste.fn_pica_notif() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION 'test: notificarea pică'; END $fn$;
CREATE TRIGGER zz_test_pica_notif BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION teste.fn_pica_notif();
SELECT teste.creeaza_cont_owner('notif.pica@gazpet.ro', :'u_r1notif');
DROP TRIGGER zz_test_pica_notif ON public.notifications;
SELECT teste.assert((SELECT employee_id = :e_r1notif FROM public.profiles WHERE id = :'u_r1notif'),
  'R1-13 eroare la notificare → legarea rămâne făcută');

-- R1-14 securitate: legătura și tipul contului
SELECT teste.creeaza_cont('simplu.user@gazpet.ro', :'u_r1simplu');
SELECT teste.ca_utilizator(:'u_r1simplu');
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET employee_id = %s WHERE id = %L', :e_r1liber, :'u_r1simplu'),
  'R1-14 utilizatorul NU își poate lega singur contul de o fișă', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET tip_cont = %L WHERE id = %L', 'test', :'u_r1simplu'),
  'R1-14 utilizatorul NU își poate marca singur tipul contului', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET email = %L WHERE id = %L', 'liber.lucian@gazpet.ro', :'u_r1simplu'),
  'R1-14 utilizatorul NU își poate schimba singur profiles.email (review: falsificarea potrivirii)', '42501');
UPDATE public.profiles SET whatsapp_enabled = true WHERE id = :'u_r1simplu';
SELECT teste.assert((SELECT whatsapp_enabled FROM public.profiles WHERE id = :'u_r1simplu'),
  'R1-14 auto-editarea altor câmpuri ale profilului propriu funcționează în continuare');
SELECT teste.ca_utilizator(:'owner');
UPDATE public.profiles SET employee_id = :e_r1liber, tip_cont = 'angajat' WHERE id = :'u_r1simplu';
SELECT teste.assert((SELECT employee_id = :e_r1liber AND tip_cont = 'angajat' FROM public.profiles WHERE id = :'u_r1simplu'),
  'R1-14 owner poate lega fișa și marca tipul');
UPDATE public.profiles SET employee_id = NULL, tip_cont = NULL WHERE id = :'u_r1simplu';
UPDATE public.profiles SET email = 'simplu.user.nou@gazpet.ro' WHERE id = :'u_r1simplu';
SELECT teste.assert((SELECT email = 'simplu.user.nou@gazpet.ro' FROM public.profiles WHERE id = :'u_r1simplu'),
  'R1-14 owner poate schimba emailul profilului (Admin → Manageri)');
UPDATE public.profiles SET email = 'simplu.user@gazpet.ro' WHERE id = :'u_r1simplu';
SELECT teste.ca_admin();
UPDATE public.profiles SET tip_cont = 'extern' WHERE id = :'u_r1simplu';
SELECT teste.assert((SELECT tip_cont = 'extern' FROM public.profiles WHERE id = :'u_r1simplu'),
  'R1-14 admin fără JWT (migrare / DML confirmat) poate marca tipul');
UPDATE public.profiles SET tip_cont = NULL WHERE id = :'u_r1simplu';

-- R1-14b (audit A #4, M1) matricea identităților: o SINGURĂ regulă (fn_identitate_privilegiata) = decizia S-A.
-- Trec DOAR owner JWT / service_role JWT / login postgres fără claims. „auth.uid() IS NULL ⇒ sistem” nu mai deschide
-- tip_cont / email (înainte treceau GoTrue, authenticator cu claims golite și anon printr-un RPC SECURITY DEFINER).
CREATE FUNCTION teste.identitate() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $fn$ SELECT public.fn_identitate_privilegiata() $fn$;
CREATE FUNCTION teste.matrice_identitati(p_tinta uuid, p_emp bigint, p_owner uuid, p_hr uuid)
RETURNS TABLE(identitate text, privilegiata text, sa text, tip text, login text, owner_flag text, rol text) LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['owner','hr','simplu','anon','service_role','postgres','supabase_auth_admin','authenticator','sub_nu_uuid'] LOOP
    PERFORM teste.ca_admin();
    CASE v
      WHEN 'owner' THEN PERFORM teste.ca_utilizator(p_owner);
      WHEN 'hr' THEN PERFORM teste.ca_utilizator(p_hr);
      WHEN 'simplu' THEN PERFORM teste.ca_utilizator(p_tinta);
      WHEN 'anon' THEN PERFORM teste.ca_anon();
      WHEN 'service_role' THEN PERFORM teste.ca_service_role();
      WHEN 'postgres' THEN PERFORM teste.ca_login('postgres');
      WHEN 'supabase_auth_admin' THEN PERFORM teste.ca_login('supabase_auth_admin');
      WHEN 'authenticator' THEN PERFORM teste.ca_login('authenticator');
      WHEN 'sub_nu_uuid' THEN PERFORM teste.ca_login_api('{"role":"authenticated","sub":"nu-e-uuid"}'::jsonb, 'authenticated');
    END CASE;
    identitate := v;
    login := session_user;
    privilegiata := teste.identitate();
    sa := teste.decizie_rpc(format('UPDATE public.profiles SET employee_id = %s WHERE id = %L', p_emp, p_tinta));
    tip := teste.decizie_rpc(format('UPDATE public.profiles SET tip_cont = %L WHERE id = %L', 'test', p_tinta));
    -- runda 3 (P10): is_owner / role — triggerele vechi au bypass „auth.uid() IS NULL”; protecția pachetului le păzește acum
    owner_flag := teste.decizie_rpc(format('UPDATE public.profiles SET is_owner = true WHERE id = %L', p_tinta));
    rol := teste.decizie_rpc(format('UPDATE public.profiles SET role = %L WHERE id = %L', 'superadmin', p_tinta));
    PERFORM teste.ca_admin();
    RETURN NEXT;
  END LOOP;
END $fn$;
CREATE TEMP TABLE tmp_matrice AS SELECT * FROM teste.matrice_identitati(:'u_r1simplu', :e_r1liber, :'owner', :'u_hr');
SELECT teste.assert((SELECT bool_and((privilegiata IS NOT NULL) = (sa = 'trece') AND (sa = 'trece') = (tip = 'trece')) FROM tmp_matrice),
  'R1-14b pentru fiecare identitate: decizia funcției comune = decizia S-A (employee_id) = decizia protecției (tip_cont)');
SELECT teste.assert((SELECT jsonb_object_agg(identitate, COALESCE(privilegiata, '—') || '/' || sa) FROM tmp_matrice)
    = '{"owner":"owner/trece","hr":"—/42501","simplu":"—/42501","anon":"—/42501","service_role":"service_role/trece",
        "postgres":"db_login/trece","supabase_auth_admin":"—/42501","authenticator":"—/42501","sub_nu_uuid":"—/22P02"}'::jsonb,
  'R1-14b matricea de 9 identități: doar owner JWT / service_role JWT / login postgres fără claims trec');
SELECT teste.assert((SELECT tip = '42501' FROM tmp_matrice WHERE identitate = 'supabase_auth_admin')
    AND (SELECT tip = '42501' FROM tmp_matrice WHERE identitate = 'authenticator')
    AND (SELECT login = 'authenticator' AND tip = '42501' FROM tmp_matrice WHERE identitate = 'anon'),
  'R1-14b tip_cont: GoTrue fără claims / authenticator cu claims golite / anon printr-un RPC → 42501 (înainte: „sistem”, trecea)');
SELECT teste.assert((SELECT privilegiata IS NULL AND sa <> 'trece' AND tip <> 'trece' FROM tmp_matrice WHERE identitate = 'sub_nu_uuid'),
  'R1-14b JWT cu sub care nu e uuid: funcția comună întoarce NULL fără eroare; UPDATE-ul e refuzat (22P02 vine din triggerele VECHI prevent_role_escalation / enforce_owner_only, prin auth.uid() — fail-closed; porțile pachetului dau 42501, vezi R1-35)');
SELECT teste.assert((SELECT bool_and((privilegiata IS NOT NULL) = (owner_flag = 'trece') AND (owner_flag = 'trece') = (rol = 'trece')) FROM tmp_matrice),
  'R1-14b (runda 3, P10) is_owner / role: trec DOAR identitățile privilegiate explicite — aceeași regulă ca employee_id / tip_cont');
SELECT teste.assert((SELECT jsonb_object_agg(identitate, owner_flag || '/' || rol) FROM tmp_matrice)
    = '{"owner":"trece/trece","hr":"P0001/P0001","simplu":"P0001/P0001","anon":"42501/42501","service_role":"trece/trece",
        "postgres":"trece/trece","supabase_auth_admin":"42501/42501","authenticator":"42501/42501","sub_nu_uuid":"22P02/22P02"}'::jsonb,
  'R1-14b (P10) matricea is_owner / role: anon, authenticator cu claims golite și GoTrue printr-un RPC SECURITY DEFINER → 42501 (înainte: treceau prin bypass-ul triggerelor vechi); HR / cont simplu → P0001 (prevent_role_escalation)');
SELECT teste.assert((SELECT employee_id IS NULL AND tip_cont IS NULL AND is_owner IS FALSE AND role = 'manager_santier' FROM public.profiles WHERE id = :'u_r1simplu'),
  'R1-14b profilul țintă a rămas neschimbat după matrice');

-- R1-14c (01.10.2026) service_role legat ca în SEC F2 r4 (20260930j): claims service_role NU ajung — trebuie și
-- session_user = 'authenticator' ȘI current_setting('role') = 'service_role'; claim.role ≠ claims.role ⇒ NULL.
-- Fiecare caz: decizia funcției comune = decizia S-A rescrisă de F2 (employee_id) = decizia protecției (tip_cont).
CREATE FUNCTION teste.eticheta() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $fn$ SELECT public.fn_identitate_eticheta() $fn$;
CREATE FUNCTION teste.matrice_sr_f2(p_tinta uuid, p_emp bigint)
RETURNS TABLE(caz text, privilegiata text, eticheta text, sa text, tip text, login text, rol_sql text) LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['sr_fara_set_role','sr_role_authenticated','sr_set_role','postgres_direct','postgres_claims_sr',
                           'sr_contradictoriu','sr_claim_vechi_set_role'] LOOP
    PERFORM teste.ca_admin();
    CASE v
      WHEN 'sr_fara_set_role' THEN PERFORM teste.ca_login_api('{"role":"service_role"}'::jsonb, NULL);
      WHEN 'sr_role_authenticated' THEN PERFORM teste.ca_login_api('{"role":"service_role"}'::jsonb, 'authenticated');
      WHEN 'sr_set_role' THEN PERFORM teste.ca_login_api('{"role":"service_role"}'::jsonb, 'service_role');
      WHEN 'postgres_direct' THEN PERFORM teste.ca_login('postgres');
      WHEN 'postgres_claims_sr' THEN
        PERFORM teste.ca_login('postgres');
        PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', false);
      WHEN 'sr_contradictoriu' THEN
        PERFORM teste.ca_login_api('{"role":"authenticated"}'::jsonb, 'service_role');
        PERFORM set_config('request.jwt.claim.role', 'service_role', false);
      WHEN 'sr_claim_vechi_set_role' THEN
        PERFORM teste.ca_login_api(NULL, 'service_role');
        PERFORM set_config('request.jwt.claim.role', 'service_role', false);
    END CASE;
    caz := v;
    login := session_user;
    rol_sql := current_setting('role', true);
    privilegiata := teste.identitate();
    eticheta := teste.eticheta();
    sa := teste.decizie_rpc(format('UPDATE public.profiles SET employee_id = %s WHERE id = %L', p_emp, p_tinta));
    tip := teste.decizie_rpc(format('UPDATE public.profiles SET tip_cont = %L WHERE id = %L', 'test', p_tinta));
    PERFORM teste.ca_admin();
    RETURN NEXT;
  END LOOP;
END $fn$;
CREATE TEMP TABLE tmp_matrice_sr AS SELECT * FROM teste.matrice_sr_f2(:'u_r1simplu', :e_r1liber);
SELECT teste.assert((SELECT bool_and((privilegiata IS NOT NULL) = (sa = 'trece') AND (sa = 'trece') = (tip = 'trece')) FROM tmp_matrice_sr),
  'R1-14c fiecare caz service_role: fn_identitate_privilegiata = decizia S-A/F2 (employee_id) = protecția (tip_cont)');
SELECT teste.assert((SELECT jsonb_object_agg(caz, COALESCE(privilegiata, '—') || '/' || sa) FROM tmp_matrice_sr)
    = '{"sr_fara_set_role":"—/42501","sr_role_authenticated":"—/42501","sr_set_role":"service_role/trece",
        "postgres_direct":"db_login/trece","postgres_claims_sr":"—/42501","sr_contradictoriu":"—/42501",
        "sr_claim_vechi_set_role":"service_role/trece"}'::jsonb,
  'R1-14c matricea F2: claims service_role fără SET ROLE / ca authenticated / din postgres / contradictorii → NULL; authenticator + SET ROLE service_role → service_role; postgres direct → db_login');
SELECT teste.assert((SELECT login = 'authenticator' AND rol_sql = 'none' FROM tmp_matrice_sr WHERE caz = 'sr_fara_set_role')
    AND (SELECT login = 'authenticator' AND rol_sql = 'service_role' FROM tmp_matrice_sr WHERE caz = 'sr_set_role')
    AND (SELECT login = 'postgres' FROM tmp_matrice_sr WHERE caz = 'postgres_direct'),
  'R1-14c contextul cazurilor e cel declarat (login + rol SQL efectiv)');
SELECT teste.assert((SELECT eticheta = 'service_role' FROM tmp_matrice_sr WHERE caz = 'sr_set_role')
    AND (SELECT bool_and(eticheta LIKE 'service_role_nelegat:%') FROM tmp_matrice_sr WHERE caz IN ('sr_fara_set_role','sr_role_authenticated')),
  'R1-14c eticheta de audit: „service_role” doar legat; claims service_role nelegate → service_role_nelegat:<rol>');
SELECT teste.assert((SELECT employee_id IS NULL AND tip_cont IS NULL FROM public.profiles WHERE id = :'u_r1simplu'),
  'R1-14c profilul țintă a rămas neschimbat');
DROP TABLE tmp_matrice;

-- R1-15 CHECK pe tip_cont
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET tip_cont = %L WHERE id = %L', 'altceva', :'u_r1simplu'),
  'R1-15 tip_cont în afara listei → CHECK', '23514');

-- R1-16 alerta „fără angajat” și excepțiile marcate
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) = 1 FROM public.v_admin_conturi_alerte WHERE id = 'fara_angajat:' || :'u_r1zero' AND cod = 'fara_angajat'
    AND candidati = '[]'::jsonb),
  'R1-16 owner vede fara_angajat pentru test.ofertare@ (0 candidați)');
SELECT teste.assert((SELECT jsonb_array_length(candidati) = 2 FROM public.v_admin_conturi_alerte WHERE id = 'fara_angajat:' || :'u_r1amb'),
  'R1-16 fara_angajat pentru mihai.popescu@ are cei 2 candidați');
SELECT teste.assert((SELECT candidati -> 0 ->> 'profil_legat' = :'u_r1vechi' FROM public.v_admin_conturi_alerte WHERE id = 'fara_angajat:' || :'u_r1ocup'),
  'R1-16 fara_angajat pentru gelu.ocupat@: candidatul unic are profil_legat');
UPDATE public.profiles SET tip_cont = 'test' WHERE id = :'u_r1zero';
SELECT teste.assert((SELECT count(*) = 0 FROM public.v_admin_conturi_alerte WHERE profile_id = :'u_r1zero'),
  'R1-16 tip_cont=test → rândul dispare din alertă');
UPDATE public.profiles SET tip_cont = 'angajat' WHERE id = :'u_r1zero';
SELECT teste.assert((SELECT count(*) = 1 FROM public.v_admin_conturi_alerte WHERE profile_id = :'u_r1zero'),
  'R1-16 tip_cont=angajat și nelegat → rândul rămâne');
SELECT teste.assert((SELECT count(*) = 0 FROM public.v_admin_conturi_alerte WHERE profile_id = :'u_r1email'),
  'R1-16 contul legat nu apare în alertă');

-- R1-17 acces: doar owner
SELECT teste.ca_admin();
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (:'u_hr', 'admin_alerte', 'viewer');
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare('SELECT count(*) FROM public.v_admin_conturi_alerte',
  'R1-17 HR cu can_modify_employees + modulul admin_alerte → refuzat pe view', '42501');
SELECT teste.asteapta_eroare('SELECT count(*) FROM public.fn_admin_conturi_alerte()',
  'R1-17 HR → refuzat și pe funcție', '42501');
SELECT teste.ca_anon();
SELECT teste.asteapta_eroare('SELECT count(*) FROM public.v_admin_conturi_alerte', 'R1-17 anon → refuzat', '42501');
SELECT teste.ca_admin();
SELECT teste.assert(NOT has_table_privilege('authenticated', 'auth.users', 'SELECT')
    AND NOT has_schema_privilege('authenticated', 'auth', 'CREATE'),
  'R1-17 authenticated nu are SELECT pe auth.users (banned_until se citește doar prin funcția SECURITY DEFINER)');
SELECT teste.assert((SELECT (reloptions @> ARRAY['security_invoker=on']) FROM pg_class WHERE oid = 'public.v_admin_conturi_alerte'::regclass),
  'R1-17 view-ul are security_invoker = on');

-- R1-18 drepturi pe funcții
SELECT teste.assert(NOT has_function_privilege('anon', 'public.fn_cont_candidati_angajat(text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.fn_cont_candidati_angajat(text)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.fn_cont_candidati_angajat(text)', 'EXECUTE'),
  'R1-18 fn_cont_candidati_angajat e internă (fără EXECUTE pentru anon/authenticated/service_role)');
SELECT teste.assert(NOT has_function_privilege('anon', 'public.fn_cont_notifica_owneri(text,text,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.fn_cont_notifica_owneri(text,text,text,text)', 'EXECUTE'),
  'R1-18 fn_cont_notifica_owneri e internă');
SELECT teste.assert(NOT has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.handle_new_user()', 'EXECUTE'),
  'R1-18 handle_new_user nu e apelabilă din API (P4: nici service_role)');
SELECT teste.assert(NOT has_function_privilege('anon', 'public.fn_admin_conturi_alerte()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.fn_admin_conturi_alerte()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.fn_cont_leaga_automat(boolean,jsonb)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.fn_cont_leaga_automat(boolean,jsonb)', 'EXECUTE'),
  'R1-18 fn_admin_conturi_alerte / fn_cont_leaga_automat: EXECUTE doar pentru authenticated (poarta e în cod)');
SELECT teste.assert(NOT has_function_privilege('service_role', 'public.fn_admin_conturi_alerte()', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.fn_cont_leaga_automat(boolean,jsonb)', 'EXECUTE')
    AND NOT has_table_privilege('service_role', 'public.v_admin_conturi_alerte', 'SELECT'),
  'R1-18 P3: RPC-urile cu poartă owner nu mai au EXECUTE / SELECT pentru service_role');
SELECT teste.assert(has_function_privilege('service_role', 'public.fn_cont_leaga_la_creare(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.fn_cont_leaga_la_creare(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.fn_cont_leaga_la_creare(uuid)', 'EXECUTE'),
  'R1-18 fn_cont_leaga_la_creare: EXECUTE pentru service_role (cont-nou) și authenticated (owner), nu anon');
SELECT teste.assert((SELECT bool_and(NOT has_function_privilege(r, f, 'EXECUTE'))
                       FROM unnest(ARRAY['anon','authenticated','service_role']) r,
                            unnest(ARRAY['public.fn_identitate_claims()','public.fn_identitate_privilegiata()','public.fn_identitate_uid()',
                                         'public.fn_identitate_om()','public.fn_identitate_eticheta()']) f),
  'R1-18 funcțiile de identitate sunt interne (fără EXECUTE pentru anon / authenticated / service_role)');
SELECT teste.assert((SELECT bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp'])
                       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                        AND p.proname IN ('fn_cont_candidati_angajat','fn_cont_notifica_owneri','handle_new_user',
                                          'fn_profiles_protectie_legatura','fn_cont_leaga_automat','fn_admin_conturi_alerte',
                                          'fn_cont_leaga_la_creare','fn_identitate_claims','fn_identitate_privilegiata',
                                          'fn_identitate_uid','fn_identitate_om','fn_identitate_eticheta'))
    AND (SELECT count(*) = 12 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN ('fn_cont_candidati_angajat','fn_cont_notifica_owneri','handle_new_user',
                            'fn_profiles_protectie_legatura','fn_cont_leaga_automat','fn_admin_conturi_alerte',
                            'fn_cont_leaga_la_creare','fn_identitate_claims','fn_identitate_privilegiata',
                            'fn_identitate_uid','fn_identitate_om','fn_identitate_eticheta')),
  'R1-18 funcțiile R1 (12): SECURITY DEFINER cu search_path = public, pg_temp');
SELECT teste.assert((SELECT bool_and(NOT has_function_privilege(r, f, 'EXECUTE'))
                       FROM unnest(ARRAY['anon','authenticated','service_role']) r,
                            unnest(ARRAY['public.fn_identitate_revocata(uuid)','public.fn_nume_cuvinte(text)','public.fn_nume_familie(text)']) f)
    AND (SELECT count(*) = 3 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp'])
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('fn_identitate_revocata','fn_nume_cuvinte','fn_nume_familie')),
  'R1-18 (runda 3) fn_identitate_revocata / fn_nume_cuvinte / fn_nume_familie: interne, SECURITY DEFINER + search_path');

-- R1-19 legarea la cerere (contul a apărut înaintea fișei)
SELECT teste.creeaza_cont('gheorghe.vasilescu@gazpet.ro', :'u_r1tarziu');
INSERT INTO public.employees (name, department, active) VALUES ('VASILESCU GHEORGHE', 'Test', true) RETURNING id AS e_r1tarziu \gset
SELECT count(*) AS legate_inainte FROM public.profiles WHERE employee_id IS NOT NULL \gset
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare('SELECT * FROM public.fn_cont_leaga_automat(true)', 'R1-19 non-owner → refuzat (și în simulare)', '42501');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT rezultat = 'de_legat' AND employee_id = :e_r1tarziu FROM public.fn_cont_leaga_automat(true) WHERE profile_id = :'u_r1tarziu'),
  'R1-19 simularea arată de_legat pentru contul apărut înaintea fișei');
SELECT teste.assert((SELECT rezultat FROM public.fn_cont_leaga_automat(true) WHERE profile_id = :'u_r1amb') = 'ambiguu'
    AND (SELECT rezultat FROM public.fn_cont_leaga_automat(true) WHERE profile_id = :'u_r1ocup') = 'candidat_ocupat'
    AND (SELECT rezultat FROM public.fn_cont_leaga_automat(true) WHERE profile_id = :'u_r1zero') = 'fara_candidat',
  'R1-19 simularea clasifică ambiguu / candidat_ocupat / fara_candidat');
SELECT teste.assert((SELECT count(*) FROM public.profiles WHERE employee_id IS NOT NULL) = :legate_inainte,
  'R1-19 simularea NU scrie nimic');
SELECT COALESCE(jsonb_agg(jsonb_build_object('profile_id', profile_id, 'employee_id', employee_id)), '[]'::jsonb) AS lista_r119
  FROM public.fn_cont_leaga_automat(true) WHERE rezultat = 'de_legat' \gset
SELECT teste.assert((SELECT rezultat = 'legat' FROM public.fn_cont_leaga_automat(false, :'lista_r119'::jsonb) WHERE profile_id = :'u_r1tarziu'),
  'R1-19 p_simulare=false + perechile confirmate din previzualizare leagă potrivirea unică');
SELECT teste.assert((SELECT employee_id = :e_r1tarziu FROM public.profiles WHERE id = :'u_r1tarziu')
    AND (SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1amb')
    AND (SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1ocup')
    AND (SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1dublu'),
  'R1-19 doar potrivirile unice și libere s-au legat (ambiguu / ocupat / email dublu rămân nelegate)');
SELECT teste.assert((SELECT cont_creat_la IS NOT NULL AND metoda IS NULL FROM public.fn_cont_leaga_automat(true) WHERE profile_id = :'u_r1zero'),
  'R1-19 previzualizarea arată data creării contului (owner-ul recunoaște un cont pe care nu l-a creat)');
SELECT teste.ca_admin();

-- R1-20 (review, critic) înscrierea publică: nimic legat singur, legarea o confirmă owner-ul dintr-un clic
\set u_r1pub1 00000000-0000-4000-8000-0000000b0014
\set u_r1pub2 00000000-0000-4000-8000-0000000b0015
INSERT INTO public.employees (name, department, email, active) VALUES ('IONESCU MARIA', 'Test', 'maria.personal@gmail.com', true)
  RETURNING id AS e_r1maria \gset
INSERT INTO public.employees (name, department, active) VALUES ('POPESCU VASILE', 'Test', true) RETURNING id AS e_r1vasile \gset
SELECT teste.creeaza_cont('maria.personal@gmail.com', :'u_r1pub1');                 -- signUp cu emailul personal de pe fișă
SELECT teste.creeaza_cont('vasile.popescu@gazpet.ro', :'u_r1pub2');                 -- signUp „prenume.nume@gazpet.ro”
SELECT teste.assert((SELECT count(*) = 2 FROM public.profiles WHERE id IN (:'u_r1pub1', :'u_r1pub2') AND employee_id IS NULL),
  'R1-20 signUp (cheia anon) cu emailul personal de pe fișă / cu prenume.nume@gazpet.ro → NU se leagă (fără acces la semnătura victimei)');
SELECT teste.assert((SELECT count(*) = 2 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_legare_propusa'
    AND (message LIKE 'Cont nou maria.personal@gmail.com → propunere: IONESCU MARIA%' OR message LIKE 'Cont nou vasile.popescu@gazpet.ro → propunere: POPESCU VASILE%')),
  'R1-20 owner-ul primește câte o propunere, și pentru domeniul extern');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) = 2 FROM public.fn_cont_leaga_automat(true) WHERE profile_id IN (:'u_r1pub1', :'u_r1pub2') AND rezultat = 'de_legat'),
  'R1-20 previzualizarea le arată „de_legat”');
SELECT COALESCE(jsonb_agg(jsonb_build_object('profile_id', profile_id, 'employee_id', employee_id)), '[]'::jsonb) AS lista_r120
  FROM public.fn_cont_leaga_automat(true) WHERE rezultat = 'de_legat' \gset
SELECT teste.assert((SELECT count(*) = 2 FROM public.fn_cont_leaga_automat(false, :'lista_r120'::jsonb) WHERE profile_id IN (:'u_r1pub1', :'u_r1pub2') AND rezultat = 'legat'),
  'R1-20 confirmarea owner-ului (lista din previzualizare) leagă');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT employee_id = :e_r1maria FROM public.profiles WHERE id = :'u_r1pub1')
    AND (SELECT employee_id = :e_r1vasile FROM public.profiles WHERE id = :'u_r1pub2'),
  'R1-20 după confirmare, conturile sunt legate de fișele propuse');

-- R1-21 (review, major) potrivirea se face pe emailul de LOGARE, nu pe profiles.email
\set u_r1spoof 00000000-0000-4000-8000-0000000b0016
INSERT INTO public.employees (name, department, active) VALUES ('VICTIMA SPOOF', 'Test', true) RETURNING id AS e_r1victima \gset
SELECT teste.creeaza_cont('atacator@adromevolution.ro', :'u_r1spoof');
SELECT teste.ca_utilizator(:'u_r1spoof');
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET email = %L WHERE id = %L', 'spoof.victima@gazpet.ro', :'u_r1spoof'),
  'R1-21 contul extern nu-și poate pune în profil emailul victimei', '42501');
SELECT teste.ca_admin();
UPDATE public.profiles SET email = 'spoof.victima@gazpet.ro' WHERE id = :'u_r1spoof';   -- nepotrivire moștenită (simulată ca admin)
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT rezultat = 'email_diferit' AND email = 'atacator@adromevolution.ro' AND employee_id IS NULL
                     FROM public.fn_cont_leaga_automat(true) WHERE profile_id = :'u_r1spoof'),
  'R1-21 previzualizarea marchează „email_diferit” și arată emailul de LOGARE (nu pe cel falsificat)');
SELECT teste.assert((SELECT rezultat = 'email_diferit' FROM public.fn_cont_leaga_automat(false, '[]'::jsonb) WHERE profile_id = :'u_r1spoof'),
  'R1-21 aplicarea sare peste profilul cu email diferit');
SELECT teste.assert((SELECT candidati = '[]'::jsonb AND email = 'atacator@adromevolution.ro' FROM public.v_admin_conturi_alerte
                     WHERE id = 'fara_angajat:' || :'u_r1spoof'),
  'R1-21 alerta fara_angajat: candidații și emailul vin din emailul de logare');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1spoof')
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE employee_id = :e_r1victima),
  'R1-21 fișa victimei rămâne nelegată');

-- R1-21b (runda 3, P12b) alerta fara_angajat MARCHEAZĂ nepotrivirea email de logare ≠ profiles.email (înainte: afișa
-- emailul de logare și candidatul fără niciun semn) — și când nepotrivirea vine din emailul de LOGARE schimbat prin GoTrue
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT (alocari ->> 'email_diferit')::boolean AND alocari ->> 'email_profil' = 'spoof.victima@gazpet.ro'
                     FROM public.v_admin_conturi_alerte WHERE id = 'fara_angajat:' || :'u_r1spoof')
    AND (SELECT alocari IS NULL FROM public.v_admin_conturi_alerte WHERE id = 'fara_angajat:' || :'u_r1zero'),
  'R1-21b alerta: marcaj email_diferit + emailul din profil; contul fără nepotrivire nu are marcaj');
SELECT teste.ca_admin();
\set u_p12 00000000-0000-4000-8000-0000000b001f
INSERT INTO public.employees (name, department, email, active) VALUES ('TINTA PDOISPE', 'Test', 'tinta.p12@gazpet.ro', true) RETURNING id AS e_p12 \gset
SELECT teste.creeaza_cont('p12.personal@gmail.com', :'u_p12');
SELECT teste.ca_login('supabase_auth_admin');                                   -- GoTrue aplică schimbarea emailului (autoconfirm)
UPDATE auth.users SET email = 'tinta.p12@gazpet.ro' WHERE id = :'u_p12';
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT rezultat = 'email_diferit' FROM public.fn_cont_leaga_automat(true) WHERE profile_id = :'u_p12')
    AND (SELECT (alocari ->> 'email_diferit')::boolean AND alocari ->> 'email_profil' = 'p12.personal@gmail.com' AND email = 'tinta.p12@gazpet.ro'
         FROM public.v_admin_conturi_alerte WHERE id = 'fara_angajat:' || :'u_p12'),
  'R1-21b (P12) emailul de logare schimbat spre adresa altcuiva: „Leagă automat” îl sare, alerta arată nepotrivirea (email_diferit + emailul din profil)');
SELECT teste.ca_admin();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.profiles WHERE employee_id = :e_p12), 'R1-21b fișa țintei rămâne nelegată');

-- R1-22 (review, major) numele de familie e obligatoriu în pasul pe nume
INSERT INTO public.employees (name, department, active) VALUES ('IONESCU ANA MARIA', 'Test', true) RETURNING id AS e_r1anamaria \gset
SELECT teste.assert((SELECT count(*) = 0 FROM public.fn_cont_candidati_angajat('ana.maria@gazpet.ro'))
    AND (SELECT count(*) = 0 FROM public.fn_cont_candidati_angajat('maria.ana@gazpet.ro')),
  'R1-22 ana.maria@ / maria.ana@ (doar prenume) → 0 candidați');
SELECT teste.assert((SELECT count(*) = 1 AND min(employee_id) = :e_r1anamaria FROM public.fn_cont_candidati_angajat('ana.ionescu@gazpet.ro'))
    AND (SELECT count(*) = 1 FROM public.fn_cont_candidati_angajat('ionescu.maria.ana@gazpet.ro')),
  'R1-22 cu numele de familie (în orice ordine) → candidat unic');

-- R1-23 (review, minor) două conturi nelegate cu același candidat unic → ambele „ambiguu”, nimic legat
\set u_r1d1 00000000-0000-4000-8000-0000000b0017
\set u_r1d2 00000000-0000-4000-8000-0000000b0018
INSERT INTO public.employees (name, department, email, active) VALUES ('DUBLURA ION', 'Test', 'idublura.personal@gmail.com', true)
  RETURNING id AS e_r1dublura \gset
SELECT teste.creeaza_cont('ion.dublura@gazpet.ro', :'u_r1d1');
SELECT teste.creeaza_cont('idublura.personal@gmail.com', :'u_r1d2');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) = 2 AND bool_and(rezultat = 'ambiguu' AND employee_id = :e_r1dublura)
                     FROM public.fn_cont_leaga_automat(true) WHERE profile_id IN (:'u_r1d1', :'u_r1d2')),
  'R1-23 previzualizare: ambele conturi „ambiguu” (aceeași fișă propusă de 2 conturi)');
SELECT teste.assert((SELECT count(*) = 2 AND bool_and(rezultat = 'ambiguu')
                     FROM public.fn_cont_leaga_automat(false, (SELECT jsonb_agg(jsonb_build_object('profile_id', x.profile_id, 'employee_id', x.employee_id))
                                                                FROM public.fn_cont_leaga_automat(true) x WHERE x.profile_id IN (:'u_r1d1', :'u_r1d2')))
                     WHERE profile_id IN (:'u_r1d1', :'u_r1d2')),
  'R1-23 aplicare: tot „ambiguu”, identic cu previzualizarea');
SELECT teste.ca_admin();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.profiles WHERE employee_id = :e_r1dublura),
  'R1-23 fișa nu s-a legat arbitrar de niciunul');

-- R1-30 (audit A #1, CRITIC) calea de încredere cu S-A live: GoTrue (login supabase_auth_admin) NU mai încearcă
-- UPDATE employee_id (S-A îl refuza cu 42501, iar eroarea era înghițită); legarea o face RPC-ul cu service_role.
\set u_r1inc 00000000-0000-4000-8000-0000000b0019
INSERT INTO public.employees (name, department, email, active) VALUES ('INCREDERE TOMA', 'Test', 'toma.incredere@gazpet.ro', true)
  RETURNING id AS e_r1inc \gset
SELECT teste.creeaza_cont('toma.incredere@gazpet.ro', :'u_r1inc', '{}'::jsonb, '{"gazpet_legare_automata": true}'::jsonb);
SELECT teste.assert((SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1inc')
    AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE message LIKE '%toma.incredere@gazpet.ro%'),
  'R1-30 createUser cu marcaj de încredere (GoTrue): fără UPDATE în trigger → nicio eroare 42501 înghițită, nicio notificare de eșec');
SELECT teste.ca_service_role();
SELECT teste.assert(session_user = 'authenticator' AND current_user = 'service_role', 'R1-30 actor: cont-nou cu cheia service (PostgREST)');
SELECT public.fn_cont_leaga_la_creare(:'u_r1inc') AS rez_r1inc \gset
SELECT teste.ca_admin();
SELECT teste.assert(:'rez_r1inc' = 'legat' AND (SELECT employee_id = :e_r1inc FROM public.profiles WHERE id = :'u_r1inc')
    AND (SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_legat_automat'
           AND message LIKE 'Cont nou toma.incredere@gazpet.ro legat automat de INCREDERE TOMA%'),
  'R1-30 RPC-ul cu service_role leagă (S-A acceptă service_role) și anunță owner-ul');
SELECT teste.ca_service_role();
SELECT teste.assert(public.fn_cont_leaga_la_creare(:'u_r1inc') = 'legatura_existenta', 'R1-30 al doilea apel → legatura_existenta (idempotent)');
SELECT teste.ca_admin();

-- R1-31 poarta RPC-ului: doar service_role (cont-nou) sau owner; lipsa identității nu deschide nimic
\set u_r1inc2 00000000-0000-4000-8000-0000000b001a
INSERT INTO public.employees (name, department, email, active) VALUES ('INCREDERE DOI', 'Test', 'doi.incredere@gazpet.ro', true)
  RETURNING id AS e_r1inc2 \gset
SELECT teste.creeaza_cont('doi.incredere@gazpet.ro', :'u_r1inc2', '{}'::jsonb, '{"gazpet_legare_automata": true}'::jsonb);
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_leaga_la_creare(%L)', :'u_r1inc2'), 'R1-31 HR (JWT non-owner) → refuzat', '42501');
SELECT teste.ca_utilizator(:'u_r1inc2');
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_leaga_la_creare(%L)', :'u_r1inc2'), 'R1-31 contul însuși (JWT) → refuzat', '42501');
SELECT teste.ca_anon();
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_leaga_la_creare(%L)', :'u_r1inc2'), 'R1-31 anon → fără EXECUTE', '42501');
SELECT teste.ca_login('authenticator');
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_leaga_la_creare(%L)', :'u_r1inc2'), 'R1-31 authenticator fără claims → refuzat', '42501');
SELECT teste.ca_login('supabase_auth_admin');
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_leaga_la_creare(%L)', :'u_r1inc2'), 'R1-31 supabase_auth_admin fără claims → refuzat', '42501');
SELECT teste.ca_admin();
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_leaga_la_creare(%L)', :'u_r1inc2'),
  'R1-31 login postgres fără claims → refuzat (RPC-ul e doar pentru cont-nou / owner; din SQL se leagă direct, cu confirmare)', '42501');
SELECT teste.assert((SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1inc2'), 'R1-31 după refuzuri: contul tot nelegat');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert(public.fn_cont_leaga_la_creare(:'u_r1inc2') = 'legat', 'R1-31 owner (JWT) → legat');
SELECT teste.ca_admin();

-- R1-32 RPC-ul NU leagă un cont fără marcajul de încredere (signUp public), nici cu service_role
\set u_r1pub3 00000000-0000-4000-8000-0000000b001b
INSERT INTO public.employees (name, department, email, active) VALUES ('URSU PUBLIC', 'Test', 'ursu.public@gazpet.ro', true)
  RETURNING id AS e_r1pub3 \gset
SELECT teste.creeaza_cont('ursu.public@gazpet.ro', :'u_r1pub3');
SELECT teste.ca_service_role();
SELECT teste.assert(public.fn_cont_leaga_la_creare(:'u_r1pub3') = 'fara_marcaj_incredere', 'R1-32 cont public + service_role → fara_marcaj_incredere');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1pub3'), 'R1-32 contul public rămâne nelegat (doar propunere la owner)');

-- R1-33 (audit A #6, TOCTOU) aplicarea leagă DOAR perechile confirmate din previzualizare
\set u_r1tt1 00000000-0000-4000-8000-0000000b001c
\set u_r1tt2 00000000-0000-4000-8000-0000000b001d
INSERT INTO public.employees (name, department, email, active) VALUES ('TOCTOU UNU', 'Test', 'tt.unu@gazpet.ro', true) RETURNING id AS e_tt1 \gset
INSERT INTO public.employees (name, department, email, active) VALUES ('TOCTOU DOI', 'Test', 'tt.doi.personal@gmail.com', true) RETURNING id AS e_tt2 \gset
SELECT teste.creeaza_cont('tt.unu@gazpet.ro', :'u_r1tt1');
SELECT teste.ca_utilizator(:'owner');
SELECT jsonb_agg(jsonb_build_object('profile_id', profile_id, 'employee_id', employee_id)) AS lista_tt
  FROM public.fn_cont_leaga_automat(true) WHERE rezultat = 'de_legat' AND profile_id = :'u_r1tt1' \gset
SELECT teste.ca_admin();
-- între previzualizare și „Continui”: cineva își face cont public cu emailul personal de pe altă fișă
SELECT teste.creeaza_cont('tt.doi.personal@gmail.com', :'u_r1tt2');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.asteapta_eroare('SELECT * FROM public.fn_cont_leaga_automat(false)', 'R1-33 aplicarea fără lista confirmată → refuz', '22023');
SELECT teste.assert((SELECT rezultat = 'de_legat' FROM public.fn_cont_leaga_automat(true) WHERE profile_id = :'u_r1tt2'),
  'R1-33 contul nou apare „de_legat” într-o previzualizare NOUĂ');
CREATE TEMP TABLE tmp_tt AS SELECT * FROM public.fn_cont_leaga_automat(false, :'lista_tt'::jsonb) WHERE profile_id IN (:'u_r1tt1', :'u_r1tt2');
SELECT teste.assert((SELECT rezultat = 'legat' FROM tmp_tt WHERE profile_id = :'u_r1tt1')
    AND (SELECT rezultat = 'neconfirmat' FROM tmp_tt WHERE profile_id = :'u_r1tt2'),
  'R1-33 aplicarea cu lista din previzualizare: contul văzut → legat; contul apărut după → „neconfirmat”, NU se leagă');
SELECT teste.assert((SELECT rezultat = 'schimbat' FROM public.fn_cont_leaga_automat(false,
                       jsonb_build_array(jsonb_build_object('profile_id', :'u_r1tt2', 'employee_id', :e_tt1))) WHERE profile_id = :'u_r1tt2'),
  'R1-33 pereche confirmată cu altă fișă decât potrivirea de acum → „schimbat”, nu se leagă');
SELECT teste.assert((SELECT cont_incredere IS FALSE AND cont_provider = 'email' FROM public.fn_cont_leaga_automat(true) WHERE profile_id = :'u_r1tt2'),
  'R1-33 previzualizarea arată provider-ul și marcajul de încredere (fals pentru signUp public)');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1tt2')
    AND (SELECT employee_id = :e_tt1 FROM public.profiles WHERE id = :'u_r1tt1'),
  'R1-33 fișa TOCTOU DOI rămâne nelegată');
DROP TABLE tmp_tt;

-- R1-34 (audit A #1) eroarea la potrivire și nelegarea pe calea de încredere ajung la owner pe ORICE domeniu
ALTER FUNCTION public.fn_cont_candidati_angajat(text) RENAME TO fn_cont_candidati_angajat_ascuns_test;
SELECT teste.creeaza_cont('eroare.potrivire@yahoo.com');
ALTER FUNCTION public.fn_cont_candidati_angajat_ascuns_test(text) RENAME TO fn_cont_candidati_angajat;
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_nelegat'
    AND message LIKE 'Cont nou eroare.potrivire@yahoo.com nelegat: eroare la potrivire:%'),
  'R1-34 eroare la potrivire pe domeniu extern → owner-ul e anunțat (înainte: tăcere în afara gazpet.ro)');
SELECT teste.creeaza_cont('extern.incredere@yahoo.com', gen_random_uuid(), '{}'::jsonb, '{"gazpet_legare_automata": true}'::jsonb);
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_nelegat'
    AND message = 'Cont nou extern.incredere@yahoo.com nelegat: 0 candidați'),
  'R1-34 cale de încredere fără candidat, domeniu extern → cont_nelegat');

-- R1-35 (audit A #9) porțile owner cer identitatea explicită: JWT cu sub care nu e uuid → 42501, nu 22P02
SELECT teste.ca_login_api('{"role":"authenticated","sub":"nu-e-uuid"}'::jsonb, 'authenticated');
SELECT teste.asteapta_eroare('SELECT * FROM public.fn_cont_leaga_automat(true)', 'R1-35 fn_cont_leaga_automat, sub non-uuid → 42501', '42501');
SELECT teste.asteapta_eroare('SELECT * FROM public.fn_admin_conturi_alerte()', 'R1-35 fn_admin_conturi_alerte, sub non-uuid → 42501', '42501');
SELECT teste.ca_admin();

-- R1-36 (runda 3, condiția Copilot: potrivirea folosește identitate VERIFICATĂ = email de logare confirmat + marcaj)
-- un cont cu emailul de logare neconfirmat (ex. invitație neacceptată) nu se leagă nici pe calea de încredere, nici la cerere
\set u_r1nc 00000000-0000-4000-8000-0000000b001e
INSERT INTO public.employees (name, department, email, active) VALUES ('NECONFIRMAT NICU', 'Test', 'nicu.neconfirmat@gazpet.ro', true)
  RETURNING id AS e_r1nc \gset
SELECT teste.creeaza_cont('nicu.neconfirmat@gazpet.ro', :'u_r1nc', '{}'::jsonb, '{"gazpet_legare_automata": true}'::jsonb);
UPDATE auth.users SET email_confirmed_at = NULL WHERE id = :'u_r1nc';
SELECT teste.ca_service_role();
SELECT teste.assert(public.fn_cont_leaga_la_creare(:'u_r1nc') = 'email_neconfirmat',
  'R1-36 calea de încredere (cont-nou, service_role) cu marcaj dar email de logare NECONFIRMAT → email_neconfirmat, nelegat');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT rezultat = 'email_neconfirmat' AND employee_id IS NULL FROM public.fn_cont_leaga_automat(true) WHERE profile_id = :'u_r1nc')
    AND (SELECT (alocari ->> 'email_neconfirmat')::boolean FROM public.v_admin_conturi_alerte WHERE id = 'fara_angajat:' || :'u_r1nc'),
  'R1-36 „Leagă automat” îl sare (email_neconfirmat); alerta fara_angajat îl marchează');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1nc'), 'R1-36 contul neconfirmat rămâne nelegat');
UPDATE auth.users SET email_confirmed_at = now() WHERE id = :'u_r1nc';
SELECT teste.ca_service_role();
SELECT teste.assert(public.fn_cont_leaga_la_creare(:'u_r1nc') = 'legat', 'R1-36 după confirmarea emailului de logare → legat pe calea de încredere');
SELECT teste.ca_admin();

-- ============================================================================
-- R2 — contract închis → cont închis + jurnal + restaurare doar owner (migrarea 20260929d)
-- ============================================================================
SELECT teste.ca_admin();
\set u_r2ui 00000000-0000-4000-8000-0000000c0001
\set u_r2tg 00000000-0000-4000-8000-0000000c0002
\set u_r2cron 00000000-0000-4000-8000-0000000c0003
\set u_r2fd 00000000-0000-4000-8000-0000000c0004
\set u_r2fv 00000000-0000-4000-8000-0000000c0005
\set u_r2v2 00000000-0000-4000-8000-0000000c0006
\set u_r2err 00000000-0000-4000-8000-0000000c0007
\set u_r2lot1 00000000-0000-4000-8000-0000000c0008
\set u_r2lot2 00000000-0000-4000-8000-0000000c0009
\set u_r2ext 00000000-0000-4000-8000-0000000c000a

-- utilitare de test (în tranzacție; dispar la ROLLBACK)
CREATE FUNCTION teste.da_acces(p uuid, p_site integer DEFAULT 1) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_set text;
BEGIN
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (p, 'hr', 'admin'), (p, 'executie', 'viewer')
    ON CONFLICT (profile_id, module) DO NOTHING;
  INSERT INTO public.profile_sites (profile_id, site_id, valid_until, note) VALUES (p, p_site, DATE '2027-06-30', 'acces test')
    ON CONFLICT (profile_id, site_id) DO NOTHING;
  SELECT string_agg(format('%I = true', f), ', ') INTO v_set FROM unnest(public.fn_cont_flaguri()) f;
  EXECUTE format('UPDATE public.profiles SET %s WHERE id = $1', v_set) USING p;
END $fn$;
CREATE FUNCTION teste.flaguri(p uuid) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_object_agg(f.key, f.value ORDER BY f.key)
    FROM jsonb_each((SELECT to_jsonb(x) FROM public.profiles x WHERE x.id = p)) f
   WHERE f.key = ANY (public.fn_cont_flaguri())
$fn$;
CREATE FUNCTION teste.flaguri_toate(p uuid, v boolean) RETURNS boolean LANGUAGE sql AS $fn$
  SELECT bool_and((f.value)::boolean IS NOT DISTINCT FROM v) FROM jsonb_each(teste.flaguri(p)) f
$fn$;
CREATE FUNCTION teste.inchis_complet(p uuid) RETURNS boolean LANGUAGE sql AS $fn$
  SELECT NOT EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = p)
     AND NOT EXISTS (SELECT 1 FROM public.profile_sites WHERE profile_id = p)
     AND teste.flaguri_toate(p, false)
     AND (SELECT banned_until = '2999-12-31 00:00:00+00' FROM auth.users WHERE id = p)
     AND NOT EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = p)
     AND NOT EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE user_id = p::text AND revoked IS NOT TRUE)
$fn$;
-- declanșator de eroare controlat (R2-19 / R2-20): DELETE pe user_module_access pică pentru profilurile listate
CREATE TABLE teste.pica_la_stergere (profile_id uuid PRIMARY KEY);
CREATE FUNCTION teste.fn_pica_stergere() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM teste.pica_la_stergere WHERE profile_id = OLD.profile_id) THEN
    RAISE EXCEPTION 'test: ștergerea modulelor pică pentru %', OLD.profile_id;
  END IF;
  RETURN OLD;
END $fn$;
CREATE TRIGGER zz_test_pica_stergere BEFORE DELETE ON public.user_module_access FOR EACH ROW EXECUTE FUNCTION teste.fn_pica_stergere();

-- R2-00 lista flagurilor e fixată
SELECT teste.assert(public.fn_cont_flaguri() = ARRAY[
    'can_access_ctc','can_access_diurne','can_access_financiar','can_access_personal_data','can_access_pontaj_brut',
    'can_access_salarii','can_create_comenzi','can_manage_contracts','can_manage_stoc','can_modify_employees',
    'can_process_achizitii','can_use_document_scanner','email_notifications_enabled','email_notifications_logistica',
    'receive_bonuri_consum','receive_tichete_administrativ','receive_tichete_comercial','receive_tichete_financiar',
    'receive_tichete_hr','receive_tichete_it','receive_tichete_logistica','whatsapp_enabled']::text[]
    AND NOT ('is_owner' = ANY (public.fn_cont_flaguri())),
  'R2-00 fn_cont_flaguri() = exact cele 22 de flaguri, fără is_owner');

-- fișe + conturi (legate automat prin email). CNP pe fiecare fișă: garda „alt contract activ” (condiția Copilot)
-- cere CNP-ul; fără el închiderea automată NU se face (situație incompletă → doar alertă, R2-28c).
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('INCHIDERE UI', 'Test', 'r2.ui@gazpet.ro', true, '1800101000011') RETURNING id AS e_r2ui \gset
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('INCHIDERE TOGGLE', 'Test', 'r2.toggle@gazpet.ro', true, '1800101000012') RETURNING id AS e_r2tg \gset
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('FARA DATA', 'Test', 'r2.faradata@gazpet.ro', true, '1800101000013') RETURNING id AS e_r2fd \gset
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('DATA VIITOR', 'Test', 'r2.viitor@gazpet.ro', true, '1800101000014') RETURNING id AS e_r2fv \gset
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('VIITOR CRON', 'Test', 'r2.viitorcron@gazpet.ro', true, '1800101000015') RETURNING id AS e_r2v2 \gset
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('EROARE INCHIDERE', 'Test', 'r2.eroare@gazpet.ro', true, '1800101000016') RETURNING id AS e_r2err \gset
SELECT teste.creeaza_cont_owner('r2.ui@gazpet.ro', :'u_r2ui');
SELECT teste.creeaza_cont_owner('r2.toggle@gazpet.ro', :'u_r2tg');
SELECT teste.creeaza_cont_owner('r2.faradata@gazpet.ro', :'u_r2fd');
SELECT teste.creeaza_cont_owner('r2.viitor@gazpet.ro', :'u_r2fv');
SELECT teste.creeaza_cont_owner('r2.viitorcron@gazpet.ro', :'u_r2v2');
SELECT teste.creeaza_cont_owner('r2.eroare@gazpet.ro', :'u_r2err');
SELECT teste.assert((SELECT count(*) = 6 FROM public.profiles
    WHERE (id, employee_id) IN ((:'u_r2ui', :e_r2ui), (:'u_r2tg', :e_r2tg), (:'u_r2fd', :e_r2fd), (:'u_r2fv', :e_r2fv),
                                (:'u_r2v2', :e_r2v2), (:'u_r2err', :e_r2err))),
  'R2 pregătire: cele 6 conturi (create pe calea de încredere) s-au legat automat de fișele lor (R1)');
SELECT teste.da_acces(:'u_r2ui');
SELECT teste.da_acces(:'u_r2fd');
SELECT teste.da_acces(:'u_r2fv');
SELECT teste.da_acces(:'u_r2v2');
SELECT teste.da_acces(:'u_r2err');
-- u_r2tg: stare mixtă, ca restaurarea să poată fi verificată exact (inclusiv un ban vechi, expirat)
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (:'u_r2tg', 'hr', 'admin'), (:'u_r2tg', 'executie', 'viewer'), (:'u_r2tg', 'magazie', 'editor');
INSERT INTO public.profile_sites (profile_id, site_id, valid_until, note) VALUES (:'u_r2tg', 2, DATE '2027-01-31', 'șef punct lucru');
UPDATE public.profiles SET can_access_salarii = true, whatsapp_enabled = true, receive_tichete_hr = true, email_notifications_logistica = false
 WHERE id = :'u_r2tg';
UPDATE auth.users SET banned_until = '2020-01-01 00:00:00+00' WHERE id = :'u_r2tg';
SELECT teste.flaguri(:'u_r2tg') AS flaguri_tg_inainte \gset

-- R2-01 calea UI: HR non-owner setează DOAR termination_date = azi
INSERT INTO public.notifications (profile_id, type, title, message) VALUES (:'u_r2ui', 'test_istoric', 'Istoric', 'notificare veche')
  RETURNING id AS notif_veche \gset
SELECT count(*) AS audit_inainte FROM public.hr_employees_audit \gset
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_r2ui;
-- R2-18 identitatea HR e aceeași în toată tranzacția: fn_cont_inchide NU mai golește / repune claims
SELECT teste.assert(auth.uid() = :'u_hr'::uuid AND current_user = 'authenticated' AND session_user = 'authenticator',
  'R2-18 după închidere, în aceeași tranzacție: auth.uid() = HR, current_user = authenticated, login authenticator');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT active = false FROM public.employees WHERE id = :e_r2ui),
  'R2-01 fișa e inactivă (UPDATE-ul HR a reușit)');
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = :'u_r2ui')
    AND NOT EXISTS (SELECT 1 FROM public.profile_sites WHERE profile_id = :'u_r2ui'),
  'R2-01 0 rânduri în user_module_access și profile_sites');
SELECT teste.assert((SELECT banned_until = '2999-12-31 00:00:00+00' FROM auth.users WHERE id = :'u_r2ui')
    AND NOT EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = :'u_r2ui')
    AND NOT EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE user_id = :'u_r2ui'::text),
  'R2-01 banned_until=2999-12-31, 0 sesiuni, 0 refresh tokens (ȘTERȘI, nu doar revocați) — pe loc, și pe calea HR');
-- (audit A #2) calea HR = identitate neprivilegiată: flagurile NU se mai resetează prin golirea claims (falsificare),
-- ci intră în coadă; le pune pe false fn_conturi_inchideri_sweep (pg_cron, login postgres = identitate explicită)
SELECT teste.assert(teste.flaguri_toate(:'u_r2ui', true)
    AND (SELECT count(*) = 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_r2ui' AND tip = 'flaguri' AND rezolvat_la IS NULL
           AND creat_de_identitate = 'authenticated:' || :'u_hr'),
  'R2-01 calea HR: flagurile rămân până la coadă (fără falsificarea identității), intrare „flaguri” deschisă');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT (alocari ->> 'flaguri_in_coada')::boolean FROM public.v_admin_conturi_alerte WHERE id = 'inchis_cu_acces_rest:' || :'u_r2ui'),
  'R2-01 alerta inchis_cu_acces_rest arată că flagurile sunt în coadă');
SELECT teste.ca_admin();
SELECT public.fn_conturi_inchideri_sweep() AS sweep_r201 \gset
SELECT teste.assert((:'sweep_r201'::jsonb ->> 'flaguri_resetate')::int = 1
    AND (SELECT rezultat = 'flaguri_resetate' AND incercari = 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_r2ui' AND tip = 'flaguri'),
  'R2-01 sweep-ul cozii (cron, login postgres): o intrare procesată, rezolvată');
SELECT teste.assert(teste.flaguri_toate(:'u_r2ui', false),
  'R2-01 toate cele 22 de flaguri sunt false');
SELECT teste.assert((SELECT NOT (can_access_salarii OR can_access_personal_data OR can_access_pontaj_brut OR can_modify_employees
                           OR can_manage_contracts OR can_access_diurne OR can_access_financiar) FROM public.profiles WHERE id = :'u_r2ui'),
  'R2-01 inclusiv cele 8 flaguri owner-only (capcana trg_enforce_owner_only_salary_flags evitată fără golirea claims)');
SELECT teste.assert(teste.inchis_complet(:'u_r2ui'), 'R2-01 după coadă: cont închis complet');
SELECT teste.assert((SELECT count(*) = 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2ui'),
  'R2-01 exact 1 rând în jurnal');
SELECT teste.assert((SELECT facut_de_identitate = 'authenticated:' || :'u_hr' FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2ui'),
  'R2-01 (audit A #8) jurnal: facut_de_identitate = authenticated:<HR> (identitate explicită)');
SELECT teste.assert((SELECT facut_de = :'u_hr'::uuid AND sursa = 'trigger_contract_incheiat' AND employee_id = :e_r2ui
                          AND email = 'r2.ui@gazpet.ro' AND motiv LIKE 'Contract încheiat la %(fișa #' || :e_r2ui || ' INCHIDERE UI)'
                          AND restaurat_la IS NULL
                     FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2ui'),
  'R2-01 jurnal: facut_de = HR, sursa trigger_contract_incheiat, motiv cu data și fișa');
SELECT teste.assert((SELECT jsonb_array_length(snapshot -> 'module') = 2
                          AND snapshot -> 'module' -> 0 ->> 'module' = 'executie' AND snapshot -> 'module' -> 1 ->> 'access_level' = 'admin'
                          AND (SELECT count(*) = 22 AND bool_and(f.value = 'true'::jsonb) FROM jsonb_each(snapshot -> 'flaguri') f)
                          AND jsonb_array_length(snapshot -> 'santiere') = 1 AND snapshot -> 'santiere' -> 0 ->> 'site_id' = '1'
                          AND NOT (snapshot -> 'santiere' -> 0 ? 'profile_id')
                          AND snapshot -> 'banned_until' = 'null'::jsonb AND snapshot ? 'banned_until'
                          AND snapshot -> 'profil' ->> 'email' = 'r2.ui@gazpet.ro' AND (snapshot ->> 'versiune')::int = 1
                          AND (snapshot -> 'rezumat' ->> 'sesiuni')::int = 1 AND (snapshot -> 'rezumat' ->> 'refresh_tokens_active')::int = 1
                          AND (snapshot -> 'rezumat' ->> 'flaguri_true')::int = 22
                     FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2ui'),
  'R2-01 snapshot: module, 22 flaguri, șantiere, banned_until anterior, profil, rezumat');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchis_automat'
    AND title = '🔒 Cont închis: r2.ui@gazpet.ro'),
  'R2-01 owner-ul primește cont_inchis_automat');
-- R2-21 istoricul NU se atinge
SELECT teste.assert((SELECT employee_id = :e_r2ui AND role = 'manager_santier' AND email = 'r2.ui@gazpet.ro' FROM public.profiles WHERE id = :'u_r2ui')
    AND (SELECT count(*) = 1 FROM public.notifications WHERE id = :notif_veche AND read_at IS NULL AND message = 'notificare veche')
    AND (SELECT count(*) FROM public.hr_employees_audit) = :audit_inainte,
  'R2-21 profilul, legătura employee_id, notificările vechi și hr_employees_audit rămân neatinse');

-- R2-02 calea toggleEmp (active=false + termination_date=azi), făcută de owner
SELECT teste.ca_utilizator(:'owner');
UPDATE public.employees SET active = false, termination_date = CURRENT_DATE WHERE id = :e_r2tg;
SELECT teste.ca_admin();
SELECT teste.assert(teste.inchis_complet(:'u_r2tg'),
  'R2-02 toggleEmp: module/șantiere scoase, flaguri false, ban, sesiuni revocate');
SELECT teste.assert((SELECT facut_de = :'owner'::uuid AND sursa = 'trigger_contract_incheiat'
                          AND snapshot -> 'flaguri' = :'flaguri_tg_inainte'::jsonb
                          AND snapshot ->> 'banned_until' LIKE '2020-01-01%'
                     FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2tg'),
  'R2-02 jurnal cu facut_de = owner; snapshot păstrează flagurile mixte și banul vechi expirat');
SELECT teste.assert((SELECT facut_de_identitate = 'owner:' || :'owner' FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2tg')
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_r2tg'),
  'R2-02 owner (JWT legitim, login authenticator) → flagurile pe loc (S-A / triggerele vechi îl acceptă), nimic în coadă');

-- R2-03 calea cron (postgres fără JWT) pe o fișă cu data de ieri
INSERT INTO public.employees (name, department, email, active, termination_date, cnp) VALUES ('INCHIDERE CRON', 'Test', 'r2.cron@gazpet.ro', true, CURRENT_DATE - 1, '1800101000017')
  RETURNING id AS e_r2cron \gset
SELECT teste.creeaza_cont('r2.cron@gazpet.ro', :'u_r2cron');
SELECT teste.assert((SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r2cron'),
  'R2-03 pregătire: fișa cu contract încheiat nu e candidat R1 (se leagă manual)');
UPDATE public.profiles SET employee_id = :e_r2cron WHERE id = :'u_r2cron';
INSERT INTO public.app_modules (key, name, is_active) VALUES ('test_modul_efemer', 'Modul efemer (test)', true);
SELECT teste.da_acces(:'u_r2cron');
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (:'u_r2cron', 'test_modul_efemer', 'viewer');
SELECT teste.ca_login('postgres');                                     -- pg_cron: SET SESSION AUTHORIZATION postgres, fără claims
SELECT teste.assert(session_user = 'postgres' AND nullif(current_setting('request.jwt.claims', true), '') IS NULL,
  'R2-03 actor: login postgres fără claims (ca jobul pg_cron 13)');
SELECT teste.assert(teste.cron_hr_auto_deactivate_terminated() >= 1, 'R2-03 cron-ul rulează');
SELECT teste.assert(teste.inchis_complet(:'u_r2cron'), 'R2-03 cron: cont închis complet, pe loc (identitate explicită db_login)');
SELECT teste.assert((SELECT facut_de IS NULL AND facut_de_identitate = 'db_login:postgres' AND sursa = 'trigger_contract_incheiat'
                          AND jsonb_array_length(snapshot -> 'module') = 3
                     FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2cron'),
  'R2-03 jurnal: facut_de NULL (nu e un om), facut_de_identitate = db_login:postgres, sursa trigger_contract_incheiat');
SELECT teste.ca_admin();

-- R2-04 active=false FĂRĂ termination_date → NU se închide
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET active = false WHERE id = :e_r2fd;
SELECT teste.ca_admin();
SELECT teste.assert((SELECT count(*) = 2 FROM public.user_module_access WHERE profile_id = :'u_r2fd')
    AND teste.flaguri_toate(:'u_r2fd', true)
    AND (SELECT banned_until IS NULL FROM auth.users WHERE id = :'u_r2fd')
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2fd'),
  'R2-04 inactiv fără dată de încetare → module, flaguri și logare intacte, fără jurnal');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_angajat_inactiv_fara_incetare'
    AND message LIKE 'r2.faradata@gazpet.ro%fără dată de încetare%'),
  'R2-04 notificare cont_angajat_inactiv_fara_incetare');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) = 1 FROM public.v_admin_conturi_alerte WHERE id = 'cont_activ_fost_angajat:' || :'u_r2fd'
                       AND employee_id = :e_r2fd AND employee_active = false AND termination_date IS NULL)
    AND (SELECT count(*) = 1 FROM public.v_admin_conturi_alerte WHERE id = 'inactiv_fara_data:' || :'u_r2fd'),
  'R2-04 alerte cont_activ_fost_angajat + inactiv_fara_data');
SELECT teste.ca_admin();

-- R2-05 active=false cu dată de încetare în viitor → NU se închide, alertă
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET active = false, termination_date = CURRENT_DATE + 10 WHERE id = :e_r2fv;
SELECT teste.ca_admin();
SELECT teste.assert((SELECT count(*) = 2 FROM public.user_module_access WHERE profile_id = :'u_r2fv')
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2fv'),
  'R2-05 dezactivat înainte de data încetării → neînchis');
SELECT teste.assert((SELECT count(*) = 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_r2fv' AND tip = 'programata'
                       AND scadent_la = CURRENT_DATE + 10 AND rezolvat_la IS NULL),
  'R2-05 (audit B #5-ii) închiderea e PROGRAMATĂ în coadă pentru data încetării');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_angajat_inactiv_fara_incetare'
    AND message LIKE 'r2.viitor@gazpet.ro%înainte de data încetării%'),
  'R2-05 notificarea explică data din viitor');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) = 1 FROM public.v_admin_conturi_alerte WHERE id = 'cont_activ_fost_angajat:' || :'u_r2fv'
                       AND termination_date = CURRENT_DATE + 10),
  'R2-05 alertă cont_activ_fost_angajat cu data viitoare');
SELECT teste.ca_admin();

-- R2-28d (garda „alt contract activ”, audit B #4) ATOMICĂ: cât timp tranzacția care încheie contractul ține lock-ul pe
-- persoană, o fișă nouă activă cu același CNP (altă conexiune) așteaptă → lock_timeout 55P03 (nu se strecoară între
-- verificare și închidere). Rulat ÎNAINTEA oricărui ALTER TABLE pe employees din tranzacția testului (ALTER TABLE ține
-- AccessExclusiveLock până la final și ar bloca orice INSERT, indiferent de gardă) + control cu alt CNP.
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA teste;
\set u_r2p3 00000000-0000-4000-8000-0000000c0012
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('CONCURENT UNU', 'Test', 'r2.concurent@gazpet.ro', true, '1900303000033')
  RETURNING id AS e_conc \gset
SELECT teste.creeaza_cont_owner('r2.concurent@gazpet.ro', :'u_r2p3');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_conc;
SELECT teste.ca_admin();
SELECT format('host=127.0.0.1 port=%s dbname=%s user=postgres', current_setting('port'), current_database()) AS conn_alt \gset
SELECT teste.assert(teste.dblink_exec(:'conn_alt',
    'BEGIN; SET LOCAL lock_timeout = ''300ms''; INSERT INTO public.employees (name, department, active, cnp) VALUES (''ALTA PERSOANA'', ''Test'', true, ''1900303000044''); ROLLBACK;') = 'ROLLBACK',
  'R2-28d control: altă conexiune, altă persoană (alt CNP) → INSERT-ul trece (tabelul nu e blocat de tranzacția testului)');

SELECT teste.asteapta_eroare(format('SELECT teste.dblink_exec(%L, %L)', :'conn_alt',
    'BEGIN; SET LOCAL lock_timeout = ''300ms''; INSERT INTO public.employees (name, department, active, cnp) VALUES (''CONCURENT DOI'', ''Test'', true, ''1900303000033''); ROLLBACK;'),
  'R2-28d altă conexiune: fișă nouă ACTIVĂ cu același CNP în timpul încheierii → așteaptă lock-ul persoanei (lock_timeout)', '55P03');
SELECT teste.asteapta_eroare(format('SELECT teste.dblink_exec(%L, %L)', :'conn_alt',
    'BEGIN; SET LOCAL lock_timeout = ''300ms''; SELECT public.fn_cont_lock_persoana(''1900303000033''); ROLLBACK;'),
  'R2-28d altă conexiune: garda aceleiași persoane așteaptă și ea (55P03)', '55P03');
-- R2-06 dată în viitor, fișa rămâne activă → nimic; „trece timpul” → cron-ul închide
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE + 5 WHERE id = :e_r2v2;
SELECT teste.ca_admin();
SELECT teste.assert((SELECT active FROM public.employees WHERE id = :e_r2v2)
    AND (SELECT count(*) = 2 FROM public.user_module_access WHERE profile_id = :'u_r2v2')
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2v2'),
  'R2-06 dată de încetare în viitor, fișă activă → nimic închis');
-- simulăm trecerea timpului: data ajunge azi FĂRĂ triggerul BEFORE (care altfel ar dezactiva imediat)
ALTER TABLE public.employees DISABLE TRIGGER trg_employees_termination_notify;
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_r2v2;
ALTER TABLE public.employees ENABLE TRIGGER trg_employees_termination_notify;
SELECT teste.assert((SELECT active FROM public.employees WHERE id = :e_r2v2), 'R2-06 fișa încă activă înainte de cron');
SELECT teste.assert(teste.cron_hr_auto_deactivate_terminated() >= 1, 'R2-06 cron-ul rulează dimineața');
SELECT teste.assert(teste.inchis_complet(:'u_r2v2')
    AND (SELECT facut_de IS NULL FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2v2'),
  'R2-06 după cron: cont închis, jurnal făcut de sistem');

-- R2-07 OWNER: nu se închide niciodată automat
INSERT INTO public.employees (name, department, active) VALUES ('OWNER TEST', 'Conducere', true) RETURNING id AS e_owner \gset
UPDATE public.profiles SET employee_id = :e_owner WHERE id = :'owner';
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (:'owner', 'admin_alerte', 'admin') ON CONFLICT DO NOTHING;
SELECT count(*) AS module_owner FROM public.user_module_access WHERE profile_id = :'owner' \gset
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_owner;
SELECT teste.ca_admin();
SELECT teste.assert((SELECT is_owner FROM public.profiles WHERE id = :'owner')
    AND (SELECT count(*) FROM public.user_module_access WHERE profile_id = :'owner') = :module_owner
    AND (SELECT banned_until IS NULL FROM auth.users WHERE id = :'owner')
    AND (SELECT count(*) = 1 FROM auth.sessions WHERE user_id = :'owner'),
  'R2-07 profilul owner-ului rămâne neatins (is_owner, module, logare, sesiune)');
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'owner'),
  'R2-07 0 rânduri în jurnal pentru owner');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_owner_neinchis'
    AND message LIKE 'Contul OWNER owner.test@gazpet.ro%NU a fost închis automat%'),
  'R2-07 notificare cont_owner_neinchis');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) = 1 FROM public.v_admin_conturi_alerte WHERE id = 'cont_activ_fost_angajat:' || :'owner' AND is_owner),
  'R2-07 alertă cont_activ_fost_angajat pentru owner (critică în UI)');
SELECT teste.ca_admin();

-- R2-08 idempotență
SELECT md5(snapshot::text) AS snap_ui FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2ui' \gset
SELECT teste.assert(public.fn_cont_inchide(:'u_r2ui', 'Test idempotență', 'manual_owner') = 'deja_inchis',
  'R2-08 al doilea apel → deja_inchis');
SELECT teste.assert((SELECT count(*) = 1 AND min(md5(snapshot::text)) = :'snap_ui' FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2ui'),
  'R2-08 tot 1 rând în jurnal, snapshot identic cu primul');
UPDATE public.employees SET active = true WHERE id = :e_r2ui;                 -- reactivare (data încetării rămâne azi)
SELECT teste.assert(teste.cron_hr_auto_deactivate_terminated() >= 1, 'R2-08 cron-ul dezactivează din nou');
SELECT teste.assert((SELECT count(*) = 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2ui')
    AND (SELECT md5(snapshot::text) = :'snap_ui' FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2ui')
    AND teste.inchis_complet(:'u_r2ui'),
  'R2-08 reactivare + cron → tot un singur rând deschis, snapshot neschimbat');

-- R2-09 convergență: acces redat manual → alertă → reaplicarea îl scoate
SELECT teste.ca_utilizator(:'owner');
INSERT INTO public.user_module_access (profile_id, module, access_level, granted_by) VALUES (:'u_r2ui', 'hr', 'viewer', :'owner');
SELECT teste.assert((SELECT count(*) = 1 FROM public.v_admin_conturi_alerte WHERE id = 'inchis_cu_acces_rest:' || :'u_r2ui'
                       AND (alocari ->> 'module')::int = 1),
  'R2-09 acces redat pe cont închis → alertă inchis_cu_acces_rest');
SELECT teste.ca_admin();
SELECT teste.assert(public.fn_cont_inchide(:'u_r2ui', 'Reaplicare închidere', 'manual_owner') = 'deja_inchis',
  'R2-09 al doilea apel întoarce deja_inchis');
-- (verificarea efectelor într-o instrucțiune separată: aceeași instrucțiune ar citi snapshot-ul dinaintea apelului)
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = :'u_r2ui')
    AND (SELECT count(*) = 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2ui'),
  'R2-09 al doilea apel scoate accesul, fără snapshot nou');

-- R2-10 reactivare: accesul NU se redă
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET active = true, termination_date = NULL WHERE id = :e_r2tg;
SELECT teste.ca_admin();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = :'u_r2tg')
    AND (SELECT banned_until = '2999-12-31 00:00:00+00' FROM auth.users WHERE id = :'u_r2tg'),
  'R2-10 reactivarea NU redă module și NU ridică banul');
SELECT teste.assert(teste.flaguri_toate(:'u_r2tg', false)
    AND NOT EXISTS (SELECT 1 FROM public.profile_sites WHERE profile_id = :'u_r2tg')
    AND NOT EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = :'u_r2tg'),
  'R2-10 (audit B #8) reactivarea NU redă nici flagurile, nici șantierele, nici sesiunile');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_angajat_reactivat'
    AND message LIKE 'r2.toggle@gazpet.ro%NU a fost redat automat%'),
  'R2-10 notificare cont_angajat_reactivat');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) = 1 FROM public.v_admin_conturi_alerte WHERE id = 'reactivat_acces_neredat:' || :'u_r2tg'
                       AND employee_active AND jurnal_id IS NOT NULL),
  'R2-10 alertă reactivat_acces_neredat');

-- R2-11 restaurare de către owner
SELECT id AS j_tg FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2tg' \gset
-- R2-11c (audit C v) previzualizarea restaurării: ce s-ar reda, fără nicio scriere
SELECT public.fn_cont_restaureaza(:j_tg, NULL, true) AS sim_tg \gset
SELECT teste.assert((:'sim_tg'::jsonb ->> 'simulare')::boolean
    AND (:'sim_tg'::jsonb -> 'module_refacute') = '["executie","hr","magazie"]'::jsonb
    AND (:'sim_tg'::jsonb -> 'flaguri') = :'flaguri_tg_inainte'::jsonb
    AND NOT EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = :'u_r2tg')
    AND (SELECT restaurat_la IS NULL FROM public.conturi_inchideri_jurnal WHERE id = :j_tg),
  'R2-11c p_simulare=true: arată modulele și flagurile, nu scrie nimic, jurnalul rămâne nerestaurat');
SELECT public.fn_cont_restaureaza(:j_tg, 'Revine în firmă din 01.10') AS rez_tg \gset
SELECT teste.ca_admin();
SELECT teste.assert((SELECT jsonb_agg(jsonb_build_object('module', module, 'access_level', access_level) ORDER BY module)
                       FROM public.user_module_access WHERE profile_id = :'u_r2tg')
    = (SELECT jsonb_agg(jsonb_build_object('module', e ->> 'module', 'access_level', e ->> 'access_level') ORDER BY e ->> 'module')
         FROM public.conturi_inchideri_jurnal j, jsonb_array_elements(j.snapshot -> 'module') e WHERE j.id = :j_tg),
  'R2-11 modulele (și nivelul de acces) identice cu snapshot-ul');
SELECT teste.assert((SELECT count(*) = 1 FROM public.profile_sites WHERE profile_id = :'u_r2tg' AND site_id = 2
                       AND valid_until = DATE '2027-01-31' AND note = 'șef punct lucru' AND granted_by = :'owner'::uuid),
  'R2-11 șantierul refăcut (valid_until, nota), granted_by = owner');
SELECT teste.assert(teste.flaguri(:'u_r2tg') = :'flaguri_tg_inainte'::jsonb,
  'R2-11 flagurile identice cu cele dinainte (inclusiv can_access_salarii și un false)');
SELECT teste.assert((SELECT banned_until = '2020-01-01 00:00:00+00' FROM auth.users WHERE id = :'u_r2tg'),
  'R2-11 banned_until revine la valoarea veche');
SELECT teste.assert((SELECT restaurat_de = :'owner'::uuid AND restaurat_la IS NOT NULL AND restaurare_nota = 'Revine în firmă din 01.10'
                     FROM public.conturi_inchideri_jurnal WHERE id = :j_tg)
    AND (:'rez_tg'::jsonb -> 'module_refacute') = '["executie","hr","magazie"]'::jsonb
    AND (:'rez_tg'::jsonb -> 'module_sarite') = '[]'::jsonb,
  'R2-11 restaurat_de/la completate; rezultatul listează modulele refăcute');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_restaureaza(%s, %L)', :j_tg, 'A doua oară'),
  'R2-11 al doilea apel → „deja restaurată”', NULL, 'deja restaurat');
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_restaureaza(%s, %L)', :j_tg, 'abc'),
  'R2-11 nota sub 5 caractere → refuz', '22023');
SELECT teste.ca_admin();

-- R2-12 restaurarea e refuzată pentru oricine altcineva
SELECT id AS j_ui FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2ui' \gset
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_restaureaza(%s, %L)', :j_ui, 'Încercare HR'), 'R2-12 HR non-owner → refuzat', '42501');
SELECT teste.ca_utilizator(:'u_ion');
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_restaureaza(%s, %L)', :j_ui, 'Încercare user'), 'R2-12 utilizator simplu → refuzat', '42501');
SELECT teste.ca_anon();
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_restaureaza(%s, %L)', :j_ui, 'Încercare anon'), 'R2-12 anon → fără EXECUTE', '42501');
SELECT teste.ca_service_role();
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_restaureaza(%s, %L)', :j_ui, 'Încercare service'), 'R2-12 service_role (auth.uid NULL) → refuzat', '42501');
SELECT teste.ca_admin();
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_restaureaza(%s, %L)', :j_ui, 'Încercare cron'), 'R2-12 admin fără JWT (cron) → refuzat', '42501');
SELECT teste.assert(NOT has_function_privilege('anon', 'public.fn_cont_restaureaza(bigint,text,boolean)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.fn_cont_restaureaza(bigint,text,boolean)', 'EXECUTE')
    AND (SELECT restaurat_la IS NULL FROM public.conturi_inchideri_jurnal WHERE id = :j_ui)
    AND NOT EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = :'u_r2ui'),
  'R2-12 după refuzuri: jurnalul și contul neschimbate (P3: fără EXECUTE pentru anon / service_role)');

-- R2-13 restaurarea sare peste un modul dispărut din app_modules
DELETE FROM public.app_modules WHERE key = 'test_modul_efemer';
SELECT id AS j_cron FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2cron' \gset
SELECT teste.ca_utilizator(:'owner');
SELECT public.fn_cont_restaureaza(:j_cron, 'Test modul dispărut') AS rez_cron \gset
SELECT teste.ca_admin();
SELECT teste.assert((:'rez_cron'::jsonb -> 'module_sarite') = '["test_modul_efemer"]'::jsonb
    AND (:'rez_cron'::jsonb -> 'module_refacute') = '["executie","hr"]'::jsonb
    AND (SELECT count(*) = 2 FROM public.user_module_access WHERE profile_id = :'u_r2cron'),
  'R2-13 modulul dispărut e sărit și raportat, fără eroare');

-- R2-14 jurnal append-only (chiar și pentru admin)
SELECT teste.asteapta_eroare(format('DELETE FROM public.conturi_inchideri_jurnal WHERE id = %s', :j_ui), 'R2-14 DELETE pe jurnal → refuzat', NULL, 'append-only');
SELECT teste.asteapta_eroare(format('UPDATE public.conturi_inchideri_jurnal SET snapshot = %L WHERE id = %s', '{}', :j_ui), 'R2-14 UPDATE pe snapshot → refuzat', NULL, 'append-only');
SELECT teste.asteapta_eroare(format('UPDATE public.conturi_inchideri_jurnal SET restaurat_de = %L, restaurat_la = now(), motiv = %L WHERE id = %s', :'owner', 'motiv schimbat', :j_ui),
  'R2-14 restaurare + altă coloană schimbată → refuzat', NULL, 'append-only');
SELECT teste.asteapta_eroare('TRUNCATE public.conturi_inchideri_jurnal', 'R2-14 TRUNCATE pe jurnal → refuzat', NULL, 'append-only');
SELECT teste.asteapta_eroare(format('UPDATE public.conturi_inchideri_jurnal SET restaurat_de = %L, restaurat_la = now(), restaurare_nota = %L WHERE id = %s', :'owner', 'a doua restaurare', :j_tg),
  'R2-14 a doua setare a restaurării → refuzat', NULL, 'deja restaurat');

-- R2-14b (P1, audit C) service_role nu mai poate scrie în jurnal / coadă (un snapshot fabricat ar deveni drepturi)
SELECT teste.ca_service_role();
SELECT teste.asteapta_eroare(format('INSERT INTO public.conturi_inchideri_jurnal (profile_id, email, motiv, sursa, snapshot) VALUES (%L, %L, %L, %L, %L)',
    :'u_ion', 'x@y.ro', 'snapshot fabricat', 'import_manual', '{"versiune":1,"flaguri":{"can_access_salarii":true},"module":[],"santiere":[],"banned_until":null}'),
  'R2-14b service_role: INSERT în jurnal → refuzat', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.conturi_inchideri_jurnal SET restaurat_de = %L, restaurat_la = now() WHERE id = %s', :'owner', :j_ui),
  'R2-14b service_role: marcarea „restaurat” fără restaurare → refuzată', '42501');
SELECT teste.asteapta_eroare(format('INSERT INTO public.conturi_inchideri_coada (profile_id, tip, motiv) VALUES (%L, %L, %L)', :'u_ion', 'reincercare', 'fals'),
  'R2-14b service_role: INSERT în coadă → refuzat', '42501');
SELECT teste.assert((SELECT count(*) > 0 FROM public.conturi_inchideri_jurnal), 'R2-14b service_role păstrează citirea jurnalului');
SELECT teste.ca_admin();

-- R2-15 RLS pe jurnal
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) = 5 FROM public.conturi_inchideri_jurnal), 'R2-15 owner vede jurnalul (5 închideri până aici, cu R2-28d)');
SELECT teste.asteapta_eroare(format('INSERT INTO public.conturi_inchideri_jurnal (profile_id, email, motiv, sursa, snapshot) VALUES (%L, %L, %L, %L, %L)',
    :'u_ion', 'x@y.ro', 'motiv fals', 'manual_owner', '{}'), 'R2-15 owner: INSERT direct prin API → refuzat', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.conturi_inchideri_jurnal SET restaurare_nota = %L WHERE id = %s', 'x', :j_ui), 'R2-15 owner: UPDATE direct → refuzat', '42501');
SELECT teste.asteapta_eroare(format('DELETE FROM public.conturi_inchideri_jurnal WHERE id = %s', :j_ui), 'R2-15 owner: DELETE direct → refuzat', '42501');
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.assert((SELECT count(*) = 0 FROM public.conturi_inchideri_jurnal), 'R2-15 HR non-owner vede 0 rânduri');
SELECT teste.asteapta_eroare(format('INSERT INTO public.conturi_inchideri_jurnal (profile_id, email, motiv, sursa, snapshot) VALUES (%L, %L, %L, %L, %L)',
    :'u_hr', 'x@y.ro', 'motiv fals', 'manual_owner', '{}'), 'R2-15 HR: INSERT direct → refuzat', '42501');
SELECT teste.ca_anon();
SELECT teste.asteapta_eroare('SELECT count(*) FROM public.conturi_inchideri_jurnal', 'R2-15 anon → refuzat', '42501');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.conturi_inchideri_jurnal'::regclass)
    AND NOT has_table_privilege('authenticated', 'public.conturi_inchideri_jurnal', 'INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_table_privilege('anon', 'public.conturi_inchideri_jurnal', 'SELECT'),
  'R2-15 RLS activ, fără drepturi de scriere pentru authenticated, nimic pentru anon');

-- R2-16 funcțiile interne nu sunt apelabile din API; triggerul nu cere EXECUTE de la declanșator
SELECT teste.assert(NOT has_function_privilege('anon', 'public.fn_cont_inchide(uuid,text,text,integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.fn_cont_inchide(uuid,text,text,integer)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.fn_cont_inchide(uuid,text,text,integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.fn_cont_flaguri()', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.fn_cont_flaguri()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.fn_employees_ciclu_cont()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.fn_employees_ciclu_cont()', 'EXECUTE'),
  'R2-16 fn_cont_inchide / fn_cont_flaguri / fn_employees_ciclu_cont: fără EXECUTE pentru anon/authenticated/service_role');
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_inchide(%L, %L, %L)', :'u_ion', 'Închidere directă', 'manual_owner'),
  'R2-16 HR nu poate apela direct fn_cont_inchide (dar UPDATE-ul lui pe employees a închis contul în R2-01)', '42501');
SELECT teste.ca_admin();

-- R2-17 închiderea manuală de către owner (cont extern, fără fișă)
SELECT teste.creeaza_cont('extern.firma@adromevolution.ro', :'u_r2ext');
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_inchide_owner(%L, %L)', :'u_r2ext', 'Colaborare încheiată'), 'R2-17 non-owner → refuzat', '42501');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_inchide_owner(%L, %L)', :'u_r2ext', 'x'), 'R2-17 motiv prea scurt → refuzat', '22023');
SELECT teste.assert(public.fn_cont_inchide_owner(:'u_r2ext', 'Colaborare Adrom încheiată') = 'inchis', 'R2-17 owner închide contul extern');
SELECT teste.assert(public.fn_cont_inchide_owner(:'owner', 'Test pe owner') = 'sarit_owner', 'R2-17 pe un profil owner → sarit_owner');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT employee_id IS NULL AND sursa = 'manual_owner' AND facut_de = :'owner'::uuid AND motiv = 'Colaborare Adrom încheiată'
                     FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2ext')
    AND teste.inchis_complet(:'u_r2ext')
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'owner'),
  'R2-17 jurnal cu employee_id NULL, sursa manual_owner; owner-ul tot fără jurnal');
SELECT teste.assert((SELECT facut_de_identitate = 'owner:' || :'owner' FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2ext')
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_r2ext'),
  'R2-17 owner prin JWT legitim (login authenticator): închidere completă PE LOC, fără coadă');

-- R2-19 izolarea erorilor: închiderea pică → UPDATE-ul din HR reușește
INSERT INTO teste.pica_la_stergere VALUES (:'u_r2err');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_r2err;
SELECT teste.ca_admin();
SELECT teste.assert((SELECT active = false FROM public.employees WHERE id = :e_r2err),
  'R2-19 UPDATE-ul pe employees a reușit (active=false) deși închiderea a picat');
SELECT teste.assert((SELECT count(*) = 2 FROM public.user_module_access WHERE profile_id = :'u_r2err')
    AND teste.flaguri_toate(:'u_r2err', true)
    AND (SELECT banned_until IS NULL FROM auth.users WHERE id = :'u_r2err')
    AND (SELECT count(*) = 1 FROM auth.sessions WHERE user_id = :'u_r2err')
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2err'),
  'R2-19 profilul rămâne neschimbat (subtranzacția anulată, inclusiv rândul din jurnal)');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_esuata'
    AND message LIKE 'r2.eroare@gazpet.ro%test: ștergerea modulelor pică%'),
  'R2-19 owner-ul primește cont_inchidere_esuata cu eroarea');
SELECT teste.assert((SELECT count(*) = 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_r2err' AND tip = 'reincercare'
                       AND rezolvat_la IS NULL AND ultima_eroare LIKE 'test: ștergerea modulelor pică%'),
  'R2-19 (audit A #3) închiderea eșuată intră în coadă pentru reîncercare (înainte: nu se mai reîncerca niciodată)');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) = 1 FROM public.v_admin_conturi_alerte WHERE id = 'cont_activ_fost_angajat:' || :'u_r2err'),
  'R2-19 alertă cont_activ_fost_angajat pentru închiderea eșuată');
SELECT teste.ca_admin();

-- R2-20 lotul cron nu se blochează când o închidere pică
INSERT INTO public.employees (name, department, active, termination_date, cnp) VALUES ('LOT UNU', 'Test', true, CURRENT_DATE - 1, '1800101000018') RETURNING id AS e_lot1 \gset
INSERT INTO public.employees (name, department, active, termination_date, cnp) VALUES ('LOT DOI', 'Test', true, CURRENT_DATE - 1, '1800101000019') RETURNING id AS e_lot2 \gset
SELECT teste.creeaza_cont('r2.lot1@gazpet.ro', :'u_r2lot1');
SELECT teste.creeaza_cont('r2.lot2@gazpet.ro', :'u_r2lot2');
UPDATE public.profiles SET employee_id = :e_lot1 WHERE id = :'u_r2lot1';
UPDATE public.profiles SET employee_id = :e_lot2 WHERE id = :'u_r2lot2';
SELECT teste.da_acces(:'u_r2lot1');
SELECT teste.da_acces(:'u_r2lot2');
INSERT INTO teste.pica_la_stergere VALUES (:'u_r2lot1');
SELECT teste.assert(teste.cron_hr_auto_deactivate_terminated() = 2, 'R2-20 cron-ul dezactivează ambele fișe din lot');
SELECT teste.assert((SELECT count(*) = 2 FROM public.employees WHERE id IN (:e_lot1, :e_lot2) AND active = false)
    AND teste.inchis_complet(:'u_r2lot2')
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2lot1')
    AND (SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_esuata' AND message LIKE 'r2.lot1@gazpet.ro%'),
  'R2-20 ambele dezactivate; LOT DOI închis, LOT UNU raportat ca eșuat');
DROP TRIGGER zz_test_pica_stergere ON public.user_module_access;

-- R2-19-bis (audit A #3) cauza eșecului a dispărut → sweep-ul (cron, login postgres) închide complet ambele conturi
SELECT teste.ca_login('postgres');
SELECT public.fn_conturi_inchideri_sweep() AS sweep_r219 \gset
SELECT teste.ca_admin();
SELECT teste.assert(teste.inchis_complet(:'u_r2err') AND teste.inchis_complet(:'u_r2lot1'),
  'R2-19-bis după sweep: r2.eroare și LOT UNU închise complet (module, șantiere, flaguri, ban, sesiuni)');
SELECT teste.assert((SELECT count(*) = 2 FROM public.conturi_inchideri_jurnal WHERE profile_id IN (:'u_r2err', :'u_r2lot1')
                       AND sursa = 'coada_contract_incheiat' AND facut_de_identitate = 'db_login:postgres' AND motiv LIKE '%reîncercare după eșec')
    AND (SELECT count(*) = 2 FROM public.conturi_inchideri_coada WHERE profile_id IN (:'u_r2err', :'u_r2lot1') AND tip = 'reincercare'
           AND rezultat = 'inchis' AND rezolvat_la IS NOT NULL),
  'R2-19-bis jurnal cu sursa coada_contract_incheiat / db_login:postgres; intrările din coadă rezolvate');

-- inchis_dar_deblocat: cineva ridică banul direct (ex. din Dashboard) → alertă critică
UPDATE auth.users SET banned_until = NULL WHERE id = :'u_r2lot2';
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) = 1 FROM public.v_admin_conturi_alerte WHERE id = 'inchis_dar_deblocat:' || :'u_r2lot2' AND banned_until IS NULL),
  'R2-08b închidere nerestaurată dar ban ridicat → alertă inchis_dar_deblocat');
SELECT teste.ca_admin();

-- R2-22 starea contului pe fișa HR
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.assert((SELECT stare = 'inchis' AND inchis_la IS NOT NULL AND jurnal_id = :j_ui AND email = 'r2.ui@gazpet.ro'
                     FROM public.fn_cont_stare_angajati() WHERE employee_id = :e_r2ui)
    AND (SELECT stare = 'activ' FROM public.fn_cont_stare_angajati() WHERE employee_id = :e_r2fd),
  'R2-22 HR (can_modify_employees) vede „inchis” cu data și „activ”');
SELECT teste.ca_utilizator(:'u_ion');
SELECT teste.assert((SELECT count(*) = 0 FROM public.fn_cont_stare_angajati()), 'R2-22 utilizator simplu → 0 rânduri, fără eroare');
SELECT teste.ca_admin();

-- R2-23 alocări rămase după închidere → doar alertă
INSERT INTO public.comenzi_aprobatori (profile_id, activ) VALUES (:'u_r2ui', true);
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT alocari = '{"comenzi_aprobatori": 1}'::jsonb FROM public.v_admin_conturi_alerte WHERE id = 'alocari_ramase:' || :'u_r2ui'),
  'R2-23 alocari_ramase cu {"comenzi_aprobatori":1}');
SELECT teste.assert((SELECT count(*) = 1 FROM public.comenzi_aprobatori WHERE profile_id = :'u_r2ui' AND activ),
  'R2-23 alocarea NU se dezactivează automat (D3 varianta A)');
SELECT teste.ca_admin();

-- R2-24 (review, minor) contul închis nu-și mai poate repune singur flagurile / emailul cu JWT-ul încă valabil
SELECT teste.ca_utilizator(:'u_r2ui');
-- (flaguri pe care niciun alt trigger nu le păzește: email_notifications_*, whatsapp_enabled — mailurile
--  de notificare ar pleca în continuare spre omul plecat)
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET email_notifications_enabled = true, email_notifications_logistica = true, whatsapp_enabled = true WHERE id = %L', :'u_r2ui'),
  'R2-24 cont închis: auto-repunerea flagurilor neprotejate → refuz', '42501', 'închis');
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET email = %L WHERE id = %L', 'personal.ana@yahoo.com', :'u_r2ui'),
  'R2-24 cont închis: schimbarea emailului (notificările ar pleca spre adresa personală) → refuz', '42501');
SELECT teste.ca_admin();
SELECT teste.assert(teste.flaguri_toate(:'u_r2ui', false)
    AND (SELECT email = 'r2.ui@gazpet.ro' FROM public.profiles WHERE id = :'u_r2ui'),
  'R2-24 flagurile rămân false și emailul neschimbat');

-- R2-25 (review, minor) restaurarea refuză un snapshot cu altă formă (ex. importul manual din claude_context 1483)
INSERT INTO public.conturi_inchideri_jurnal (profile_id, email, employee_id, motiv, sursa, snapshot)
VALUES (:'u_r2fd', 'r2.faradata@gazpet.ro', :e_r2fd, 'Import manual cu forma veche (test)', 'import_manual',
        '{"profile": {"email_notifications_enabled": true, "can_create_comenzi": true}, "module": [{"module": "hr", "access_level": "viewer"}]}'::jsonb)
RETURNING id AS j_r2import \gset
SELECT teste.flaguri(:'u_r2fd') AS flaguri_fd_inainte \gset
SELECT teste.ca_utilizator(:'owner');
SELECT teste.asteapta_eroare(format('SELECT public.fn_cont_restaureaza(%s, %L)', :j_r2import, 'Restaurare import vechi'),
  'R2-25 snapshot fără versiune=1 / flaguri{} / santiere[] → refuz', '22023', 'forma așteptată');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT restaurat_la IS NULL FROM public.conturi_inchideri_jurnal WHERE id = :j_r2import)
    AND teste.flaguri(:'u_r2fd') = :'flaguri_fd_inainte'::jsonb,
  'R2-25 jurnalul NU e marcat restaurat, profilul neatins (se poate corecta importul)');

-- R2-26 (review, minor) triggerul R2 nu blochează nimic nici dacă notificarea lipsește (ordine greșită de rollback)
\set u_r2fn 00000000-0000-4000-8000-0000000c000b
\set u_r2fn2 00000000-0000-4000-8000-0000000c000c
INSERT INTO public.employees (name, department, email, active, termination_date, cnp) VALUES ('FARA NOTIF', 'Test', 'r2.faranotif@gazpet.ro', true, CURRENT_DATE - 1, '1800101000020')
  RETURNING id AS e_r2fn \gset
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('FARA NOTIF DOI', 'Test', 'r2.faranotif2@gazpet.ro', true, '1800101000021')
  RETURNING id AS e_r2fn2 \gset
SELECT teste.creeaza_cont('r2.faranotif@gazpet.ro', :'u_r2fn');
SELECT teste.creeaza_cont_owner('r2.faranotif2@gazpet.ro', :'u_r2fn2');
UPDATE public.profiles SET employee_id = :e_r2fn WHERE id = :'u_r2fn';
SELECT teste.da_acces(:'u_r2fn');
SELECT teste.da_acces(:'u_r2fn2');
ALTER FUNCTION public.fn_cont_notifica_owneri(text, text, text, text) RENAME TO fn_cont_notifica_owneri_ascuns_test;
SELECT teste.asteapta_eroare($$SELECT public.fn_cont_notifica_owneri('a', 'b', 'c')$$, 'R2-26 pregătire: fn_cont_notifica_owneri lipsește', '42883');
SELECT teste.assert(teste.cron_hr_auto_deactivate_terminated() >= 1, 'R2-26 cron-ul NU pică fără funcția de notificare');
SELECT teste.assert(teste.inchis_complet(:'u_r2fn') AND (SELECT NOT active FROM public.employees WHERE id = :e_r2fn),
  'R2-26 fișa dezactivată și contul închis complet (notificarea e best-effort)');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET active = false WHERE id = :e_r2fn2;                     -- ramura „fără dată” (doar notificare)
SELECT teste.ca_admin();
SELECT teste.assert((SELECT NOT active FROM public.employees WHERE id = :e_r2fn2)
    AND (SELECT count(*) = 2 FROM public.user_module_access WHERE profile_id = :'u_r2fn2'),
  'R2-26 dezactivarea fără dată reușește, contul rămâne deschis (fără notificare, fără eroare)');
ALTER FUNCTION public.fn_cont_notifica_owneri_ascuns_test(text, text, text, text) RENAME TO fn_cont_notifica_owneri;

-- R2-27 (review, minor) owner-ul vede starea TUTUROR conturilor (și nelegate / blocate fără jurnal)
\set u_r2blocat 00000000-0000-4000-8000-0000000c000d
SELECT teste.creeaza_cont('blocat.manual@gazpet.ro', :'u_r2blocat');
UPDATE auth.users SET banned_until = '2999-12-31 00:00:00+00' WHERE id = :'u_r2blocat';   -- blocare din Dashboard, fără jurnal
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT stare = 'inchis' AND employee_id IS NULL FROM public.fn_cont_stare_angajati() WHERE profile_id = :'u_r2ext')
    AND (SELECT stare = 'blocat' FROM public.fn_cont_stare_angajati() WHERE profile_id = :'u_r2blocat')
    AND (SELECT stare = 'activ' FROM public.fn_cont_stare_angajati() WHERE profile_id = :'u_ion'),
  'R2-27 owner: cont extern închis = „inchis”, ban fără jurnal = „blocat”, restul „activ”');
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.fn_cont_stare_angajati() WHERE profile_id IN (:'u_r2ext', :'u_r2blocat'))
    AND NOT EXISTS (SELECT 1 FROM public.fn_cont_stare_angajati() WHERE employee_id IS NULL),
  'R2-27 HR vede în continuare doar conturile legate de fișe');
SELECT teste.ca_admin();

-- R2-28 (condiția Copilot, audit B #4) garda „alt contract activ”: aceeași persoană (același CNP) cu altă fișă activă
\set u_r2p1 00000000-0000-4000-8000-0000000c0010
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('PERSOANA DUBLA', 'Test', 'r2.dubla@gazpet.ro', true, '1850505123456')
  RETURNING id AS e_da \gset
INSERT INTO public.employees (name, department, active, cnp) VALUES ('PERSOANA DUBLA', 'Execuție', true, ' 1850505-123456 ')
  RETURNING id AS e_db \gset
SELECT teste.creeaza_cont_owner('r2.dubla@gazpet.ro', :'u_r2p1');
SELECT teste.assert((SELECT employee_id = :e_da FROM public.profiles WHERE id = :'u_r2p1'), 'R2-28 pregătire: contul e legat de fișa A');
SELECT teste.da_acces(:'u_r2p1');
-- R2-28a: HR încheie fișa A, dar omul are contractul B activ → contul NU se închide, doar alertă
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_da;
SELECT teste.ca_admin();
SELECT teste.assert((SELECT NOT active FROM public.employees WHERE id = :e_da)
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2p1')
    AND (SELECT count(*) = 2 FROM public.user_module_access WHERE profile_id = :'u_r2p1')
    AND (SELECT banned_until IS NULL FROM auth.users WHERE id = :'u_r2p1'),
  'R2-28a contract A încheiat, contract B (același CNP, normalizat) activ → contul NU se închide');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_suspendata'
    AND message LIKE 'r2.dubla@gazpet.ro%are alt contract ACTIV (fișa #' || :e_db || ')%'),
  'R2-28a owner-ul primește cont_inchidere_suspendata cu fișa B');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT alocari ->> 'motiv_neinchis' = 'alt_contract_activ' AND (alocari ->> 'alt_contract')::int = :e_db
                     FROM public.v_admin_conturi_alerte WHERE id = 'cont_activ_fost_angajat:' || :'u_r2p1'),
  'R2-28a alerta cont_activ_fost_angajat explică: alt_contract_activ (fișa B)');
SELECT teste.ca_admin();
-- R2-28b: se încheie și contractul B → contul legat de A (aceeași persoană) se închide
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_db;
SELECT teste.ca_admin();
SELECT public.fn_conturi_inchideri_sweep();
SELECT teste.assert(teste.inchis_complet(:'u_r2p1')
    AND (SELECT employee_id = :e_da AND motiv LIKE '%(fișa #' || :e_db || ' PERSOANA DUBLA)' FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2p1'),
  'R2-28b ultimul contract al persoanei încheiat → contul legat de fișa A se închide (găsit prin CNP)');
-- R2-28c: fișă fără CNP = situație incompletă → fără închidere automată, doar alertă
\set u_r2p2 00000000-0000-4000-8000-0000000c0011
INSERT INTO public.employees (name, department, email, active) VALUES ('FARA CNP', 'Test', 'r2.faracnp@gazpet.ro', true) RETURNING id AS e_fcnp \gset
SELECT teste.creeaza_cont_owner('r2.faracnp@gazpet.ro', :'u_r2p2');
SELECT teste.da_acces(:'u_r2p2');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_fcnp;
SELECT teste.ca_admin();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2p2')
    AND (SELECT count(*) = 2 FROM public.user_module_access WHERE profile_id = :'u_r2p2')
    AND (SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_suspendata'
           AND message LIKE 'r2.faracnp@gazpet.ro%CNP lipsă%'),
  'R2-28c fără CNP → contul NU se închide automat; owner-ul e anunțat');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT alocari ->> 'motiv_neinchis' = 'cnp_lipsa' FROM public.v_admin_conturi_alerte WHERE id = 'cont_activ_fost_angajat:' || :'u_r2p2'),
  'R2-28c alerta explică: cnp_lipsa');
SELECT teste.ca_admin();

-- R2-28e (runda 3, X1 — MAJOR) CNP-ul aplicației stă în hr_employees_private (Admin → Angajați → Editează, AdeverinteLegator;
-- index UNIQUE); employees.cnp îl scrie doar wizard-ul „Angajat nou”. Garda citește AMBELE surse.
\set u_r2e1 00000000-0000-4000-8000-0000000c0020
\set u_r2e2 00000000-0000-4000-8000-0000000c0021
\set u_r2e3 00000000-0000-4000-8000-0000000c0022
-- e1: CNP DOAR în datele personale, niciun alt contract → se închide normal, fără alerta falsă „CNP lipsă”
INSERT INTO public.employees (name, department, email, active) VALUES ('PRIVATU DORIN', 'Test', 'r2.privat@gazpet.ro', true) RETURNING id AS e_pv \gset
INSERT INTO public.hr_employees_private (employee_id, cnp) VALUES (:e_pv, '1850101000201');
SELECT teste.creeaza_cont_owner('r2.privat@gazpet.ro', :'u_r2e1');
SELECT teste.da_acces(:'u_r2e1');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_pv;
SELECT teste.ca_admin();
SELECT public.fn_conturi_inchideri_sweep();
SELECT teste.assert(teste.inchis_complet(:'u_r2e1')
    AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE type = 'cont_inchidere_suspendata' AND message LIKE 'r2.privat@gazpet.ro%'),
  'R2-28e CNP doar în hr_employees_private → garda îl vede: contul se închide, fără alerta falsă „CNP lipsă”');
-- e2: fișa A cu CNP pe fișă (wizard), fișa B = contract nou ACTIV al aceluiași om, cu același CNP DOAR în datele personale
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('WIZARDESCU ANDREI', 'Test', 'r2.wizard@gazpet.ro', true, '1850101000202')
  RETURNING id AS e_wa \gset
SELECT teste.creeaza_cont_owner('r2.wizard@gazpet.ro', :'u_r2e2');
INSERT INTO public.employees (name, department, active) VALUES ('WIZARDESCU ANDREI', 'Execuție', true) RETURNING id AS e_wb \gset
INSERT INTO public.hr_employees_private (employee_id, cnp) VALUES (:e_wb, '1850101000202');
SELECT teste.da_acces(:'u_r2e2');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_wa;
SELECT teste.ca_admin();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2e2')
    AND (SELECT count(*) = 2 FROM public.user_module_access WHERE profile_id = :'u_r2e2')
    AND (SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_suspendata'
           AND message LIKE 'r2.wizard@gazpet.ro%are alt contract ACTIV (fișa #' || :e_wb || '), același CNP%'),
  'R2-28e fișa A cu CNP pe fișă, fișa B ACTIVĂ cu același CNP doar în datele personale → NU se închide (alt contract activ)');
-- e3: invers — CNP-ul fișei A în datele personale, fișa B activă cu el pe fișă
INSERT INTO public.employees (name, department, email, active) VALUES ('INVERSESCU BOGDAN', 'Test', 'r2.invers@gazpet.ro', true) RETURNING id AS e_ia \gset
INSERT INTO public.hr_employees_private (employee_id, cnp) VALUES (:e_ia, '1850101000203');
SELECT teste.creeaza_cont_owner('r2.invers@gazpet.ro', :'u_r2e3');
INSERT INTO public.employees (name, department, active, cnp) VALUES ('INVERSESCU BOGDAN', 'Execuție', true, '1850101000203') RETURNING id AS e_ib \gset
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_ia;
SELECT teste.ca_admin();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2e3'),
  'R2-28e invers: CNP-ul fișei A în datele personale, fișa B activă cu el pe fișă → NU se închide');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT alocari ->> 'motiv_neinchis' = 'alt_contract_activ' AND (alocari ->> 'alt_contract')::int = :e_ib
                     FROM public.v_admin_conturi_alerte WHERE id = 'cont_activ_fost_angajat:' || :'u_r2e3')
    AND (SELECT alocari ->> 'motiv_neinchis' = 'alt_contract_activ' AND (alocari ->> 'alt_contract')::int = :e_wb
         FROM public.v_admin_conturi_alerte WHERE id = 'cont_activ_fost_angajat:' || :'u_r2e2'),
  'R2-28e alerta: alt_contract_activ cu fișa B, din oricare sursă a CNP-ului');
SELECT teste.ca_admin();

-- R2-28f (runda 3) „situație incompletă” și pe NUME DE FAMILIE / EMAIL: altă fișă ACTIVĂ fără niciun CNP cunoscut
-- X1 (verificator): contract nou ACTIV al aceluiași om creat FĂRĂ CNP (Admin → „Adaugă angajat”; în datele personale CNP-ul nu
-- poate intra — UNIQUE, îl are fișa veche) → HR încheie contractul vechi → contul NU se închide, doar alertă
\set u_x1 00000000-0000-4000-8000-0000000c0023
\set u_r2f2 00000000-0000-4000-8000-0000000c0024
\set u_r2f3 00000000-0000-4000-8000-0000000c0025
\set u_r2f4 00000000-0000-4000-8000-0000000c0026
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('VASILACHE PETRU', 'Execuție', 'petru.vasilache@gazpet.ro', true, '1900101223344')
  RETURNING id AS e_x1a \gset
SELECT teste.creeaza_cont_owner('petru.vasilache@gazpet.ro', :'u_x1');
INSERT INTO public.employees (name, department, active, hire_date) VALUES ('VASILACHE PETRU', 'Execuție', true, CURRENT_DATE) RETURNING id AS e_x1b \gset
SELECT teste.da_acces(:'u_x1');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_x1a;
SELECT teste.ca_admin();
SELECT public.fn_conturi_inchideri_sweep();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_x1')
    AND (SELECT count(*) = 2 FROM public.user_module_access WHERE profile_id = :'u_x1')
    AND (SELECT banned_until IS NULL FROM auth.users WHERE id = :'u_x1')
    AND (SELECT count(*) = 1 FROM auth.sessions WHERE user_id = :'u_x1'),
  'X1 / R2-28f contract vechi încheiat, contract nou ACTIV cu același nume și FĂRĂ CNP → contul NU se închide');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_suspendata'
    AND message LIKE 'petru.vasilache@gazpet.ro%posibil alt contract ACTIV: fișa #' || :e_x1b || ' VASILACHE PETRU, fără CNP%completează CNP-ul%'),
  'X1 / R2-28f owner-ul primește cont_inchidere_suspendata: fișa B și ce e de făcut');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT alocari ->> 'motiv_neinchis' = 'posibil_alt_contract' AND (alocari ->> 'alt_contract')::int = :e_x1b
                     FROM public.v_admin_conturi_alerte WHERE id = 'cont_activ_fost_angajat:' || :'u_x1'),
  'X1 / R2-28f alerta: posibil_alt_contract (fișa B)');
SELECT teste.ca_admin();
-- f2: același EMAIL (nume de familie schimbat, ex. după căsătorie), fișa nouă activă fără CNP → la fel
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('EMAILOVICI ELENA', 'Test', 'elena.personal.r3@yahoo.com', true, '2900101000204')
  RETURNING id AS e_f2a \gset
INSERT INTO public.employees (name, department, email, active) VALUES ('MARITATA ELENA', 'Test', 'Elena.Personal.R3@yahoo.com ', true) RETURNING id AS e_f2b \gset
SELECT teste.creeaza_cont('elena.r3@gazpet.ro', :'u_r2f2');
UPDATE public.profiles SET employee_id = :e_f2a WHERE id = :'u_r2f2';
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_f2a;
SELECT teste.ca_admin();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2f2')
    AND (SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_suspendata'
           AND message LIKE 'elena.r3@gazpet.ro%posibil alt contract ACTIV: fișa #' || :e_f2b || ' MARITATA ELENA%'),
  'R2-28f același email (alt nume de familie), fișă activă fără CNP → NU se închide, alertă cu fișa B');
-- f3: ordinea numelui inversată („ZAHARIA COSTEL” / „COSTEL ZAHARIA”) → la fel
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('ZAHARIA COSTEL', 'Test', 'costel.zaharia@gazpet.ro', true, '1900101000205')
  RETURNING id AS e_f3a \gset
SELECT teste.creeaza_cont_owner('costel.zaharia@gazpet.ro', :'u_r2f3');
INSERT INTO public.employees (name, department, active) VALUES ('COSTEL ZAHARIA', 'Test', true) RETURNING id AS e_f3b \gset
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_f3a;
SELECT teste.ca_admin();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2f3')
    AND (SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_suspendata'
           AND message LIKE 'costel.zaharia@gazpet.ro%posibil alt contract ACTIV: fișa #' || :e_f3b || ' %'),
  'R2-28f ordinea inversată a numelui (familie ↔ prenume), fișă activă fără CNP → NU se închide');
-- f4 (control): același nume de familie dar cu ALT CNP cunoscut (în datele personale) + alt om fără CNP cu alt nume de
-- familie și același prenume → nu sunt „situație incompletă”: contul se închide
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('CONTROLESCU DAN', 'Test', 'dan.controlescu@gazpet.ro', true, '1900101000206')
  RETURNING id AS e_f4a \gset
SELECT teste.creeaza_cont_owner('dan.controlescu@gazpet.ro', :'u_r2f4');
INSERT INTO public.employees (name, department, active) VALUES ('CONTROLESCU DANA', 'Test', true) RETURNING id AS e_f4b \gset
INSERT INTO public.hr_employees_private (employee_id, cnp) VALUES (:e_f4b, '2900101000207');
INSERT INTO public.employees (name, department, active) VALUES ('ALTESCU DAN', 'Test', true);
SELECT teste.da_acces(:'u_r2f4');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_f4a;
SELECT teste.ca_admin();
SELECT public.fn_conturi_inchideri_sweep();
SELECT teste.assert(teste.inchis_complet(:'u_r2f4'),
  'R2-28f control: rudă cu alt CNP cunoscut + om fără CNP cu alt nume de familie → nu blochează, contul se închide');
-- R2-29 (audit A #5 / B #6) revocarea EFECTIVĂ a JWT-urilor deja emise: hook-ul PostgREST pre-request
SELECT id AS sesiune_ion FROM auth.sessions WHERE user_id = :'u_ion' LIMIT 1 \gset
SELECT teste.ca_utilizator(:'u_r2ui');
SELECT teste.assert((SELECT count(*) > 0 FROM public.employees),
  'R2-29b (caracterizare, FĂRĂ hook) contul închis cu JWT-ul încă valabil citește employees (CNP, IBAN) — riscul de acoperit');
SELECT teste.asteapta_eroare('SELECT public.fn_pgrst_pre_request()', 'R2-29 cont închis (jurnal deschis) → hook-ul refuză cererea', '42501', 'închis');
SELECT teste.ca_utilizator(:'u_r2blocat');
SELECT teste.asteapta_eroare('SELECT public.fn_pgrst_pre_request()', 'R2-29 cont banat fără jurnal → refuz', '42501');
SELECT teste.ca_login_api(jsonb_build_object('role', 'authenticated', 'sub', :'u_ion', 'session_id', gen_random_uuid()), 'authenticated');
SELECT teste.asteapta_eroare('SELECT public.fn_pgrst_pre_request()', 'R2-29 sesiune ștearsă (session_id inexistent) → refuz', '42501', 'Sesiunea');
SELECT teste.ca_login_api(jsonb_build_object('role', 'authenticated', 'sub', :'u_ion', 'session_id', :'sesiune_ion'), 'authenticated');
SELECT teste.assert(teste.eroare('SELECT public.fn_pgrst_pre_request()') IS NULL, 'R2-29 utilizator activ cu sesiune validă → trece');
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.assert(teste.eroare('SELECT public.fn_pgrst_pre_request()') IS NULL, 'R2-29 HR activ (fără session_id în token) → trece');
SELECT teste.ca_anon();
SELECT teste.assert(teste.eroare('SELECT public.fn_pgrst_pre_request()') IS NULL, 'R2-29 anon → trece (hook-ul privește doar authenticated)');
SELECT teste.ca_service_role();
SELECT teste.assert(teste.eroare('SELECT public.fn_pgrst_pre_request()') IS NULL, 'R2-29 service_role → trece');
SELECT teste.ca_admin();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
                                 WHERE r.rolname = 'authenticator' AND array_to_string(s.setconfig, ',') LIKE '%db_pre_request%'),
  'R2-29 hook-ul e CREAT, dar NU e activat de migrare (ALTER ROLE authenticator = decizia lui Răzvan)');

-- R2-30 (audit B #5-iii) alt cont NELEGAT al aceleiași persoane (emailul de logare = emailul de pe fișă) → doar alertă
\set u_r2a1 00000000-0000-4000-8000-0000000c0013
\set u_r2a2 00000000-0000-4000-8000-0000000c0014
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('DOUA CONTURI', 'Test', 'doua.conturi@yahoo.com', true, '1700707000077')
  RETURNING id AS e_2c \gset
SELECT teste.creeaza_cont('doua.conturi.firma@gazpet.ro', :'u_r2a1');
UPDATE public.profiles SET employee_id = :e_2c WHERE id = :'u_r2a1';
SELECT teste.creeaza_cont('doua.conturi@yahoo.com', :'u_r2a2');                     -- rămâne nelegat (doar propunere)
SELECT teste.ca_utilizator(:'owner');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_2c;
SELECT teste.ca_admin();
SELECT teste.assert(teste.inchis_complet(:'u_r2a1')
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2a2')
    AND (SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_posibil_aceeasi_persoana'
           AND message LIKE '%doua.conturi@yahoo.com%NU s-a închis automat%'),
  'R2-30 contul legat se închide; contul nelegat cu emailul de pe fișă NU se închide, owner-ul primește cont_posibil_aceeasi_persoana');

-- R2-31 (audit B #5-iv) cont marcat sistem / extern / test, legat de o fișă → nu se închide automat, doar alertă
\set u_r2sis 00000000-0000-4000-8000-0000000c0015
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('CONT SISTEM', 'Test', 'r2.sistem@gazpet.ro', true, '1700707000088')
  RETURNING id AS e_sis \gset
SELECT teste.creeaza_cont_owner('r2.sistem@gazpet.ro', :'u_r2sis');
UPDATE public.profiles SET tip_cont = 'sistem' WHERE id = :'u_r2sis';
SELECT teste.da_acces(:'u_r2sis');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_sis;
SELECT teste.ca_admin();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2sis')
    AND (SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_suspendata'
           AND message LIKE 'r2.sistem@gazpet.ro%marcat „sistem”%'),
  'R2-31 tip_cont=sistem legat de o fișă încheiată → neînchis, owner-ul decide');

-- R2-32 (audit A #2, M2) niciun obiect din public nu mai golește / falsifică request.jwt.* (grep în pg_proc)
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                                  AND p.prosrc ~* 'set_config\s*\(\s*''request\.jwt'),
  'R2-32 fără set_config(''request.jwt…'') în funcțiile din public');

-- R2-33 login authenticator FĂRĂ claims (ex. un RPC care golește claims) nu mai e tratat „ca sistem”
\set u_r2fi 00000000-0000-4000-8000-0000000c0016
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('FARA IDENTITATE', 'Test', 'r2.faraidentitate@gazpet.ro', true, '1700707000099')
  RETURNING id AS e_fi \gset
SELECT teste.creeaza_cont_owner('r2.faraidentitate@gazpet.ro', :'u_r2fi');
SELECT teste.da_acces(:'u_r2fi');
CREATE FUNCTION teste.rpc_incheie(p_emp integer) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $fn$ UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = p_emp $fn$;
SELECT teste.ca_login('authenticator');
SELECT teste.rpc_incheie(:e_fi);
SELECT teste.ca_admin();
SELECT teste.assert((SELECT facut_de IS NULL AND facut_de_identitate = 'fara_identitate:authenticator' FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2fi')
    AND teste.flaguri_toate(:'u_r2fi', true)
    AND (SELECT count(*) = 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_r2fi' AND tip = 'flaguri' AND rezolvat_la IS NULL),
  'R2-33 authenticator fără claims: închiderea se face, dar FĂRĂ privilegiu (flagurile în coadă), identitatea jurnalizată explicit');
SELECT public.fn_conturi_inchideri_sweep();
SELECT teste.assert(teste.inchis_complet(:'u_r2fi'), 'R2-33 după coadă: închis complet');
SELECT teste.ca_login('authenticator');
SELECT teste.asteapta_eroare('SELECT public.fn_conturi_inchideri_sweep()', 'R2-33 authenticator nu poate rula coada (fără EXECUTE)', '42501');
SELECT teste.ca_login('supabase_auth_admin');
SELECT teste.asteapta_eroare('SELECT public.fn_conturi_inchideri_sweep()', 'R2-33 supabase_auth_admin nu poate rula coada', '42501');
SELECT teste.ca_admin();

-- R2-36 restaurarea owner-ului e respectată: sweep-ul NU re-închide un cont restaurat (fișă tot inactivă, dată trecută)
SELECT public.fn_conturi_inchideri_sweep();
SELECT teste.assert((SELECT count(*) = 2 FROM public.user_module_access WHERE profile_id = :'u_r2cron')
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2cron' AND restaurat_la IS NULL),
  'R2-36 contul restaurat de owner (R2-13) rămâne restaurat după sweep (nimic nu se re-aplică automat)');

-- R2-37 (audit B #5-ii) închiderea PROGRAMATĂ: fișa dezactivată înainte de dată (R2-05) se închide când data ajunge
ALTER TABLE public.employees DISABLE TRIGGER trg_employees_zz_ciclu_cont;           -- „trece timpul”, fără declanșator
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_r2fv;
ALTER TABLE public.employees ENABLE TRIGGER trg_employees_zz_ciclu_cont;
UPDATE public.conturi_inchideri_coada SET scadent_la = CURRENT_DATE WHERE profile_id = :'u_r2fv' AND tip = 'programata' AND rezolvat_la IS NULL;
SELECT teste.ca_login('postgres');
SELECT public.fn_conturi_inchideri_sweep() AS sweep_r237 \gset
SELECT teste.ca_admin();
SELECT teste.assert(teste.inchis_complet(:'u_r2fv')
    AND (SELECT sursa = 'coada_contract_incheiat' AND motiv LIKE '%închidere programată' FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2fv')
    AND (SELECT rezultat = 'inchis' FROM public.conturi_inchideri_coada WHERE profile_id = :'u_r2fv' AND tip = 'programata'),
  'R2-37 la scadență sweep-ul (cron) închide contul programat');
-- … iar o programare pentru o fișă REACTIVATĂ între timp se anulează (nimic nu se închide)
\set u_r2re 00000000-0000-4000-8000-0000000c0017
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('PROGRAMAT REACTIVAT', 'Test', 'r2.reactivat@gazpet.ro', true, '1700707000100')
  RETURNING id AS e_re \gset
SELECT teste.creeaza_cont_owner('r2.reactivat@gazpet.ro', :'u_r2re');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET active = false, termination_date = CURRENT_DATE + 3 WHERE id = :e_re;
UPDATE public.employees SET active = true, termination_date = NULL WHERE id = :e_re;
SELECT teste.ca_admin();
SELECT teste.assert((SELECT rezultat = 'anulat_reactivat' FROM public.conturi_inchideri_coada WHERE profile_id = :'u_r2re' AND tip = 'programata')
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2re'),
  'R2-37 reactivarea anulează programarea; contul rămâne deschis');

-- R2-38 pct. 4 pentru obiectele noi din d: tabele cu RLS, funcții interne fără EXECUTE din API
SELECT teste.assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.conturi_inchideri_coada'::regclass)
    AND NOT has_table_privilege('authenticated', 'public.conturi_inchideri_coada', 'INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('anon', 'public.conturi_inchideri_coada', 'SELECT')
    AND (SELECT bool_and(NOT has_function_privilege(r, f, 'EXECUTE'))
           FROM unnest(ARRAY['anon','authenticated','service_role']) r,
                unnest(ARRAY['public.fn_conturi_inchideri_sweep()','public.fn_cont_garda_persoana(integer)',
                             'public.fn_cont_lock_persoana(text)','public.fn_cont_cnp_normalizat(text)',
                             'public.fn_employees_persoana_lock()','public.fn_cont_coada_pune(uuid,integer,text,text,date,text)']) f)
    AND has_function_privilege('authenticated', 'public.fn_pgrst_pre_request()', 'EXECUTE')
    AND (SELECT bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']) FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('fn_conturi_inchideri_sweep','fn_cont_garda_persoana','fn_cont_lock_persoana','fn_cont_cnp_normalizat',
                              'fn_employees_persoana_lock','fn_cont_coada_pune','fn_pgrst_pre_request')),
  'R2-38 coada: RLS + doar citire owner; funcțiile noi SECURITY DEFINER + search_path, interne fără EXECUTE din API');
SELECT teste.assert((SELECT bool_and(NOT has_function_privilege(r, f, 'EXECUTE'))
           FROM unnest(ARRAY['anon','authenticated','service_role']) r,
                unnest(ARRAY['public.fn_cont_persoana_cnp(integer)','public.fn_cont_persoana_chei(text[],text,text)',
                             'public.fn_cont_lock_chei(text[])','public.fn_cont_alt_contract_activ(integer,text[])',
                             'public.fn_cont_posibil_aceeasi_persoana(integer)','public.fn_cont_motiv_garda(text)',
                             'public.fn_hr_employees_private_persoana_lock()','public.fn_cont_revocat_nu_scrie()',
                             'public.fn_cont_restaurare_activa(uuid)']) f)
    AND (SELECT count(*) = 9 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']) FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('fn_cont_persoana_cnp','fn_cont_persoana_chei','fn_cont_lock_chei','fn_cont_alt_contract_activ',
                              'fn_cont_posibil_aceeasi_persoana','fn_cont_motiv_garda','fn_hr_employees_private_persoana_lock',
                              'fn_cont_revocat_nu_scrie','fn_cont_restaurare_activa'))
    AND (SELECT count(*) = 2 FROM pg_trigger WHERE tgrelid = 'public.hr_employees_private'::regclass AND NOT tgisinternal
          AND tgname IN ('trg_hr_employees_private_persoana_lock','trg_hr_employees_private_00_cont_revocat')),
  'R2-38 (runda 3) funcțiile noi (garda pe ambele surse, lock, cont revocat, restaurare): interne, SECURITY DEFINER + search_path; 2 triggere pe hr_employees_private');

-- R2-39 (runda 3, X10 / P1 — MEDIU) un HR cu contul ÎNCHIS pe calea HR, înainte de coadă (flagurile încă TRUE) și cu JWT-ul
-- emis înainte de închidere (hook-ul = D9, neactivat), NU mai lucrează ca HR: nu e „om” pentru R3, nu scrie fișe / CNP-uri
\set u_h1 00000000-0000-4000-8000-0000000c0030
\set u_h2 00000000-0000-4000-8000-0000000c0031
\set u_hb 00000000-0000-4000-8000-0000000c0032
INSERT INTO public.employees (name, department, email, active) VALUES ('HRUNESCU ANA', 'HR', 'ana.hrunescu@gazpet.ro', true) RETURNING id AS e_h1 \gset
INSERT INTO public.hr_employees_private (employee_id, cnp) VALUES (:e_h1, '2900101112233');
INSERT INTO public.employees (name, department, active, termination_date) VALUES ('ACORDESCU FOST', 'Test', false, CURRENT_DATE - 30) RETURNING id AS e_fa \gset
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('VICTIMESCU HR', 'Test', 'victima.hr@gazpet.ro', true, '1900101000777')
  RETURNING id AS e_vh \gset
SELECT teste.creeaza_cont_owner('ana.hrunescu@gazpet.ro', :'u_h1');
SELECT teste.creeaza_cont('hr.doi.r3@gazpet.ro', :'u_h2');
UPDATE public.profiles SET can_modify_employees = true, can_access_personal_data = true WHERE id IN (:'u_h1', :'u_h2');
CREATE FUNCTION teste.om() RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $fn$ SELECT public.fn_identitate_om() $fn$;
SELECT teste.ca_utilizator(:'u_h2');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_h1;          -- HR2 încheie contractul lui HR1
SELECT teste.ca_admin();
SELECT teste.assert((SELECT can_modify_employees AND can_access_personal_data FROM public.profiles WHERE id = :'u_h1')
    AND EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_h1' AND restaurat_la IS NULL)
    AND EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_h1' AND tip = 'flaguri' AND rezolvat_la IS NULL),
  'R2-39 pregătire: HR1 închis pe calea HR, flagurile HR încă TRUE (coada nu a rulat)');
SELECT teste.ca_utilizator(:'u_h1');                                                    -- același JWT, emis înainte de închidere
SELECT teste.assert(teste.om() IS NULL AND auth.uid() = :'u_h1'::uuid AND session_user = 'authenticator',
  'R2-39 fn_identitate_om: contul închis (JWT încă valabil, login authenticator) NU mai e „om”');
SELECT teste.asteapta_eroare(format($s$SELECT public.fn_colaborare_externa_seteaza(%s, 'accepta', 'acord telefonic de test')$s$, :e_fa),
  'R2-39 (P1a) acordul de colaborare prin RPC → refuz', '42501');
SELECT teste.asteapta_eroare(format($s$UPDATE public.employees SET colaborare_externa_status = 'refuza', colaborare_externa_nota = 'refuz de test' WHERE id = %s$s$, :e_fa),
  'R2-39 (P1b) acordul prin UPDATE direct → refuz', '42501');
SELECT teste.asteapta_eroare(format('SELECT public.fn_fost_angajat_leaga_extern(%s)', :e_fa),
  'R2-39 (P1c) trecerea unui fost angajat ca extern → refuz', '42501');
SELECT teste.asteapta_eroare(format($s$SELECT public.fn_colaborare_externa_seteaza(%s, 'accepta', 'acordul meu de test')$s$, :e_h1),
  'R2-39 (P1d) propriul acord → refuz', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = %s', :e_vh),
  'R2-39 (P1e) încheie contractul altcuiva (i-ar închide contul) → refuz', '42501', 'închis');
SELECT teste.asteapta_eroare(format('UPDATE public.employees SET cnp = NULL WHERE id = %s', :e_vh),
  'R2-39 (P1f) golește CNP-ul altei fișe (ocolirea gărzii) → refuz', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_employees_private SET cnp = NULL WHERE employee_id = %s', :e_h1),
  'R2-39 date personale: golește un CNP → refuz', '42501');
SELECT teste.asteapta_eroare(format($s$INSERT INTO public.hr_employees_private (employee_id, cnp) VALUES (%s, '1900101000888')$s$, :e_vh),
  'R2-39 date personale: inserează un CNP → refuz', '42501');
SELECT teste.assert((SELECT count(*) = 0 FROM public.fn_cont_stare_angajati()), 'R2-39 (P1g) starea conturilor → 0 rânduri pentru contul închis');
SELECT teste.asteapta_eroare(format('UPDATE public.employees SET active = true, termination_date = NULL WHERE id = %s', :e_h1),
  'R2-39 (P1l) își reactivează singur fișa → refuz (oricum nu i se redă nimic)', '42501');
SELECT teste.ca_utilizator(:'u_h2');
SELECT teste.assert(teste.om() = :'u_h2'::uuid AND (SELECT count(*) > 0 FROM public.fn_cont_stare_angajati()),
  'R2-39 HR2 (cont activ) rămâne „om” și vede starea conturilor');
UPDATE public.employees SET position = 'verificare R2-39' WHERE id = :e_vh;
SELECT teste.ca_admin();
SELECT teste.assert((SELECT position = 'verificare R2-39' AND cnp = '1900101000777' AND active AND termination_date IS NULL FROM public.employees WHERE id = :e_vh)
    AND (SELECT colaborare_externa_status = 'necunoscut' FROM public.employees WHERE id = :e_fa)
    AND (SELECT cnp = '2900101112233' FROM public.hr_employees_private WHERE employee_id = :e_h1)
    AND NOT EXISTS (SELECT 1 FROM public.hr_employees_private WHERE employee_id = :e_vh)
    AND NOT EXISTS (SELECT 1 FROM public.hr_personal_extern WHERE fost_angajat_employee_id = :e_fa)
    AND NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j JOIN public.profiles p ON p.id = j.profile_id WHERE p.employee_id = :e_vh),
  'R2-39 efect: nimic din ce a încercat contul închis nu s-a scris; HR-ul activ scrie în continuare');
-- ban activ FĂRĂ jurnal (blocare din Dashboard): același tratament
SELECT teste.creeaza_cont('hr.banat.r3@gazpet.ro', :'u_hb');
UPDATE public.profiles SET can_modify_employees = true WHERE id = :'u_hb';
UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = :'u_hb';
SELECT teste.ca_utilizator(:'u_hb');
SELECT teste.assert(teste.om() IS NULL, 'R2-39 cont banat (fără jurnal) → nu e „om”');
SELECT teste.asteapta_eroare(format('UPDATE public.employees SET position = %L WHERE id = %s', 'scris de un cont banat', :e_vh),
  'R2-39 cont banat → nu scrie fișe', '42501');
SELECT teste.ca_admin();
-- restaurarea owner-ului redă tot (inclusiv calitatea de „om”)
SELECT id AS j_h1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_h1' AND restaurat_la IS NULL \gset
SELECT teste.ca_utilizator(:'owner');
SELECT public.fn_cont_restaureaza(:j_h1, 'Revine în firmă (test R2-39)');
SELECT teste.ca_utilizator(:'u_h1');
SELECT teste.assert(teste.om() = :'u_h1'::uuid, 'R2-39 după restaurarea owner-ului contul e din nou „om”');
SELECT teste.ca_admin();

-- R2-40 (runda 3, X3 — MINOR) „nimic nu re-închide automat un cont restaurat”: corecția datei de încetare pe fișa
-- inactivă a unui cont restaurat de owner NU îl mai re-închide; o plecare NOUĂ (activ → inactiv) îl închide din nou
\set u_x3 00000000-0000-4000-8000-0000000c0033
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('RESTAURESCU TEST', 'Test', 'restaurat.test@gazpet.ro', true, '1910202334455')
  RETURNING id AS e_x3 \gset
SELECT teste.creeaza_cont_owner('restaurat.test@gazpet.ro', :'u_x3');
SELECT teste.da_acces(:'u_x3');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE - 2 WHERE id = :e_x3;
SELECT teste.ca_admin();
SELECT public.fn_conturi_inchideri_sweep();
SELECT id AS j_x3 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_x3' AND restaurat_la IS NULL \gset
SELECT teste.ca_utilizator(:'owner');
SELECT public.fn_cont_restaureaza(:j_x3, 'Rămâne colaborator, păstrez accesul');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE - 1 WHERE id = :e_x3;          -- HR corectează data; fișa rămâne inactivă
SELECT teste.ca_admin();
SELECT public.fn_conturi_inchideri_sweep();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_x3' AND restaurat_la IS NULL)
    AND (SELECT count(*) = 2 FROM public.user_module_access WHERE profile_id = :'u_x3')
    AND (SELECT banned_until IS NULL FROM auth.users WHERE id = :'u_x3'),
  'R2-40 (X3) corecția datei pe fișa inactivă a unui cont RESTAURAT → contul NU se re-închide');
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_suspendata'
    AND message LIKE 'restaurat.test@gazpet.ro%RESTAURAT de owner (jurnal #' || :j_x3 || ')%'),
  'R2-40 owner-ul e anunțat că închiderea nu se re-aplică (cont restaurat)');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE + 3 WHERE id = :e_x3;          -- dată mutată în viitor, fișa tot inactivă
SELECT teste.ca_admin();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_x3' AND tip = 'programata' AND rezolvat_la IS NULL),
  'R2-40 nici o dată viitoare pe fișa inactivă nu programează re-închiderea contului restaurat');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE - 1 WHERE id = :e_x3;
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT alocari ->> 'motiv_neinchis' = 'restaurat' AND (alocari -> 'restaurat' ->> 'jurnal_id')::bigint = :j_x3
                     FROM public.v_admin_conturi_alerte WHERE id = 'cont_activ_fost_angajat:' || :'u_x3'),
  'R2-40 alerta spune „restaurat” (jurnalul restaurării), nu „esuat_sau_neprins”');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET active = true, termination_date = NULL WHERE id = :e_x3;         -- revine în firmă…
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_x3;                 -- …și pleacă din nou
SELECT teste.ca_admin();
SELECT public.fn_conturi_inchideri_sweep();
SELECT teste.assert(teste.inchis_complet(:'u_x3')
    AND (SELECT count(*) = 2 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_x3')
    AND (SELECT count(*) = 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_x3' AND restaurat_la IS NULL),
  'R2-40 plecare NOUĂ (activ → inactiv) după restaurare → contul se închide din nou (jurnal nou; cel restaurat rămâne istoric)');

-- R2-41 (runda 3, X6 — MINOR) coada NU mai reîncearcă la nesfârșit: backoff, limită de încercări, notificare o singură dată
\set u_x6 00000000-0000-4000-8000-0000000c0034
INSERT INTO public.employees (name, department, email, active, cnp) VALUES ('PERSISTENTESCU EROARE', 'Test', 'eroare.persist@gazpet.ro', true, '1920303445566')
  RETURNING id AS e_x6 \gset
SELECT teste.creeaza_cont_owner('eroare.persist@gazpet.ro', :'u_x6');
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (:'u_x6', 'executie', 'viewer');
CREATE FUNCTION teste.fn_pica_persistent() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.profile_id = '00000000-0000-4000-8000-0000000c0034' THEN RAISE EXCEPTION 'eroare persistentă simulată'; END IF;
  RETURN OLD;
END $fn$;
CREATE TRIGGER zz_test_pica_persistent BEFORE DELETE ON public.user_module_access FOR EACH ROW EXECUTE FUNCTION teste.fn_pica_persistent();
CREATE FUNCTION teste.sweep_scadent(p_id bigint, p_n integer) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  FOR i IN 1..p_n LOOP                                   -- „trece timpul” până la următoarea încercare, apoi rulează coada
    UPDATE public.conturi_inchideri_coada SET urmatoarea_incercare_la = now() - interval '1 second' WHERE id = p_id AND abandonat_la IS NULL;
    PERFORM public.fn_conturi_inchideri_sweep();
  END LOOP;
END $fn$;
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :e_x6;
SELECT teste.ca_admin();
SELECT id AS q_x6 FROM public.conturi_inchideri_coada WHERE profile_id = :'u_x6' AND tip = 'reincercare' AND rezolvat_la IS NULL \gset
SELECT teste.assert((SELECT incercari = 0 AND notificat_la IS NOT NULL FROM public.conturi_inchideri_coada WHERE id = :q_x6)
    AND (SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_esuata' AND message LIKE 'eroare.persist@gazpet.ro%'),
  'R2-41 pregătire: închiderea eșuată → intrare „reincercare” + o notificare (din trigger, marcată notificat_la)');
SELECT public.fn_conturi_inchideri_sweep();
SELECT public.fn_conturi_inchideri_sweep();
SELECT public.fn_conturi_inchideri_sweep();
SELECT teste.assert((SELECT incercari = 1 AND urmatoarea_incercare_la = now() + interval '5 minutes' AND abandonat_la IS NULL
                     FROM public.conturi_inchideri_coada WHERE id = :q_x6),
  'R2-41 backoff: 3 rulări la rând = O SINGURĂ încercare; următoarea abia peste 5 min (înainte: câte o încercare la fiecare rulare)');
UPDATE public.notifications SET read_at = now() WHERE profile_id = :'owner' AND type = 'cont_inchidere_esuata';   -- owner-ul citește
SELECT teste.sweep_scadent(:q_x6, 6);
SELECT teste.assert((SELECT incercari = 7 AND abandonat_la IS NULL AND urmatoarea_incercare_la = now() + interval '320 minutes'
                     FROM public.conturi_inchideri_coada WHERE id = :q_x6)
    AND (SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_esuata' AND message LIKE 'eroare.persist@gazpet.ro%'),
  'R2-41 7 eșecuri: backoff exponențial (a 7-a → +320 min); owner-ul NU e re-anunțat la fiecare încercare, nici după ce a citit');
SELECT teste.sweep_scadent(:q_x6, 1);
SELECT teste.assert((SELECT incercari = 8 AND abandonat_la IS NOT NULL AND rezolvat_la IS NULL AND ultima_eroare LIKE 'eroare persistentă simulată%'
                     FROM public.conturi_inchideri_coada WHERE id = :q_x6)
    AND (SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_abandonata'
           AND message LIKE 'eroare.persist@gazpet.ro%8 încercări eșuate%NU mai reîncearcă%'),
  'R2-41 a 8-a eroare: coada se oprește (abandonat_la; intrarea rămâne DESCHISĂ) + o singură notificare „oprită”');
UPDATE public.notifications SET read_at = now() WHERE profile_id = :'owner' AND type = 'cont_inchidere_abandonata';
SELECT teste.sweep_scadent(:q_x6, 1);
UPDATE public.conturi_inchideri_coada SET urmatoarea_incercare_la = NULL WHERE id = :q_x6;
SELECT public.fn_conturi_inchideri_sweep();
SELECT teste.assert((SELECT incercari = 8 FROM public.conturi_inchideri_coada WHERE id = :q_x6)
    AND (SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_abandonata' AND message LIKE 'eroare.persist@gazpet.ro%')
    AND (SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_inchidere_esuata' AND message LIKE 'eroare.persist@gazpet.ro%'),
  'R2-41 intrarea oprită nu mai e reîncercată și nu mai produce notificări (nici după citire)');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT alocari ->> 'motiv_neinchis' = 'esuat_abandonat' AND (alocari -> 'coada' ->> 'incercari')::int = 8
                          AND alocari -> 'coada' ->> 'abandonat_la' IS NOT NULL
                     FROM public.v_admin_conturi_alerte WHERE id = 'cont_activ_fost_angajat:' || :'u_x6'),
  'R2-41 alerta: esuat_abandonat, cu numărul de încercări');
SELECT teste.ca_admin();
DROP TRIGGER zz_test_pica_persistent ON public.user_module_access;
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert(public.fn_cont_inchide_owner(:'u_x6', 'Închidere manuală după eșec persistent') = 'inchis',
  'R2-41 cauza eliminată: owner-ul închide manual');
SELECT teste.ca_admin();
SELECT teste.assert(teste.inchis_complet(:'u_x6')
    AND (SELECT rezultat = 'inchis' AND rezolvat_la IS NOT NULL FROM public.conturi_inchideri_coada WHERE id = :q_x6),
  'R2-41 închiderea manuală rezolvă și intrarea oprită');

-- ============================================================================
-- R3 — fost angajat ca posibil colaborator extern, acord tri-valent (migrarea 20260929e)
-- ============================================================================
SELECT teste.ca_admin();
\set u_pd 00000000-0000-4000-8000-0000000d0001
SELECT teste.creeaza_cont('pd.test@gazpet.ro', :'u_pd');
UPDATE public.profiles SET can_access_personal_data = true WHERE id = :'u_pd';

-- R3-01 implicit: necunoscut, fără proveniență — pe toate fișele existente și pe cele noi
SELECT teste.assert((SELECT count(*) = 0 FROM public.employees
    WHERE colaborare_externa_status <> 'necunoscut' OR colaborare_externa_confirmat_de IS NOT NULL
       OR colaborare_externa_confirmat_la IS NOT NULL OR colaborare_externa_document IS NOT NULL),
  'R3-01 toate fișele existente au acordul „necunoscut”, fără proveniență');
-- rând vechi în Personal extern, omonim cu un viitor fost angajat (există dinaintea fișei; R3-12)
INSERT INTO public.hr_personal_extern (nume, firma, activ) VALUES ('FOST COLIZIUNE', 'Firma X', true) RETURNING id AS ext_col \gset
INSERT INTO public.employees (name, department, active, termination_date) VALUES ('FOST UNU', 'Test', false, CURRENT_DATE - 10) RETURNING id AS f1 \gset
INSERT INTO public.employees (name, department, active, termination_date) VALUES ('FOST DOI', 'Test', false, CURRENT_DATE - 10) RETURNING id AS f2 \gset
INSERT INTO public.employees (name, department, active, termination_date, functie, telefon, email)
  VALUES ('FOST TREI', 'Test', false, CURRENT_DATE - 10, 'Sudor', '0722000000', '') RETURNING id AS f3 \gset
INSERT INTO public.employees (name, department, active, termination_date) VALUES ('Fost Coliziune', 'Test', false, CURRENT_DATE - 10) RETURNING id AS f4 \gset
INSERT INTO public.employees (name, department, active, termination_date) VALUES ('FOST CINCI', 'Test', false, CURRENT_DATE - 10) RETURNING id AS f5 \gset
INSERT INTO public.employees (name, department, active) VALUES ('ACTIV COLAB', 'Test', true) RETURNING id AS a1 \gset
SELECT teste.assert((SELECT bool_and(colaborare_externa_status = 'necunoscut' AND colaborare_externa_confirmat_de IS NULL)
                     FROM public.employees WHERE id IN (:f1, :f2, :f3, :f4, :f5, :a1)),
  'R3-01 fișele noi încep ca „necunoscut”');

-- R3-02 INSERT cu acord deja setat → refuz (și cu confirmat_de fals)
SELECT teste.asteapta_eroare(format('INSERT INTO public.employees (name, department, active, termination_date, colaborare_externa_status, colaborare_externa_nota, colaborare_externa_confirmat_de, colaborare_externa_confirmat_la) VALUES (%L, %L, false, CURRENT_DATE - 1, %L, %L, %L, now())',
    'INSERT ACCEPTA', 'Test', 'accepta', 'acord inventat la import', :'owner'), 'R3-02 INSERT cu accepta (admin, confirmat_de fals) → refuz', '42501');
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('INSERT INTO public.employees (name, department, colaborare_externa_status, colaborare_externa_nota) VALUES (%L, %L, %L, %L)',
    'INSERT HR ACCEPTA', 'Test', 'accepta', 'acord inventat de HR'), 'R3-02 INSERT cu accepta (HR) → refuz', '42501');
SELECT teste.asteapta_eroare(format('INSERT INTO public.employees (name, department, colaborare_externa_confirmat_de) VALUES (%L, %L, %L)',
    'INSERT DOAR CONFIRMAT', 'Test', :'u_hr'), 'R3-02 INSERT „necunoscut” dar cu confirmat_de → refuz', '42501');

-- R3-03 HR, prin funcție: accepta + notă → proveniența din sesiune + jurnal
SELECT public.fn_colaborare_externa_seteaza(:f1, 'accepta', 'A semnat acordul de colaborare pe 29.09') AS rez_f1 \gset
SELECT teste.ca_admin();
SELECT teste.assert((SELECT colaborare_externa_status = 'accepta' AND colaborare_externa_confirmat_de = :'u_hr'::uuid
                          AND colaborare_externa_confirmat_la = now() AND colaborare_externa_nota = 'A semnat acordul de colaborare pe 29.09'
                     FROM public.employees WHERE id = :f1)
    AND (:'rez_f1'::jsonb ->> 'schimbat')::boolean,
  'R3-03 accepta: confirmat_de = HR (din sesiune), confirmat_la = acum');
SELECT teste.assert((SELECT count(*) = 1 FROM public.hr_colaborare_externa_jurnal WHERE employee_id = :f1
                       AND status_vechi = 'necunoscut' AND status_nou = 'accepta' AND facut_de = :'u_hr'::uuid),
  'R3-03 rând în jurnalul acordului (necunoscut → accepta, făcut de HR)');
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.assert((public.fn_colaborare_externa_seteaza(:f1, 'accepta', 'A semnat acordul de colaborare pe 29.09') ->> 'schimbat')::boolean = false,
  'R3-03 același apel a doua oară → nimic schimbat');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT count(*) = 1 FROM public.hr_colaborare_externa_jurnal WHERE employee_id = :f1),
  'R3-03 … și fără rând nou în jurnal');

-- R3-04 dovada e obligatorie
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('SELECT public.fn_colaborare_externa_seteaza(%s, %L, NULL, NULL)', :f2, 'accepta'),
  'R3-04 accepta fără notă și fără document → refuz', '22023');
SELECT teste.asteapta_eroare(format('SELECT public.fn_colaborare_externa_seteaza(%s, %L, %L)', :f2, 'refuza', ' abc '),
  'R3-04 notă sub 5 caractere → refuz', '22023');
SELECT teste.asteapta_eroare(format('SELECT public.fn_colaborare_externa_seteaza(%s, %L, %L)', :f2, 'poate', 'Nota destul de lunga'),
  'R3-04 stare necunoscută sistemului → refuz', '22023');
SELECT public.fn_colaborare_externa_seteaza(:f2, 'refuza', NULL, 'hr-documente/f2/refuz-colaborare.pdf');
SELECT teste.assert((SELECT colaborare_externa_status = 'refuza' AND colaborare_externa_document = 'hr-documente/f2/refuz-colaborare.pdf'
                     FROM public.employees WHERE id = :f2),
  'R3-04 refuza doar cu document (fără notă) → acceptat');

-- R3-05 utilizator simplu / anon
SELECT teste.ca_utilizator(:'u_ion');
SELECT teste.asteapta_eroare(format('SELECT public.fn_colaborare_externa_seteaza(%s, %L, %L)', :f5, 'accepta', 'Acord inventat de user'),
  'R3-05 utilizator simplu → refuzat', '42501');
SELECT teste.asteapta_eroare(format('SELECT public.fn_fost_angajat_leaga_extern(%s)', :f5), 'R3-05 utilizator simplu nu poate trece un fost angajat ca extern', '42501');
SELECT teste.ca_anon();
SELECT teste.asteapta_eroare(format('SELECT public.fn_colaborare_externa_seteaza(%s, %L, %L)', :f5, 'accepta', 'Acord inventat anon'),
  'R3-05 anon → fără EXECUTE', '42501');
SELECT teste.ca_admin();
SELECT teste.assert(NOT has_function_privilege('anon', 'public.fn_colaborare_externa_seteaza(integer,text,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.fn_fost_angajat_leaga_extern(integer,bigint)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.fn_colaborare_externa_seteaza(integer,text,text,text)', 'EXECUTE'),
  'R3-05 RPC-urile: EXECUTE doar pentru authenticated (poarta de rol e în cod)');

-- R3-06 UPDATE direct prin API (HR) cu proveniență falsă → rescrisă din sesiune
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET colaborare_externa_status = 'accepta', colaborare_externa_nota = 'Acord verbal confirmat telefonic',
       colaborare_externa_confirmat_de = :'owner', colaborare_externa_confirmat_la = '2020-01-01 00:00:00+00' WHERE id = :f5;
SELECT teste.ca_admin();
SELECT teste.assert((SELECT colaborare_externa_confirmat_de = :'u_hr'::uuid AND colaborare_externa_confirmat_la = now()
                     FROM public.employees WHERE id = :f5)
    AND (SELECT count(*) = 1 FROM public.hr_colaborare_externa_jurnal WHERE employee_id = :f5 AND facut_de = :'u_hr'::uuid AND status_nou = 'accepta'),
  'R3-06 confirmat_de/la venite din client sunt rescrise cu HR/acum; jurnalul se completează');

-- R3-07 sistemul (admin fără JWT) / service_role nu pot seta acordul
SELECT teste.asteapta_eroare(format('UPDATE public.employees SET colaborare_externa_status = %L WHERE id = %s', 'refuza', :f5),
  'R3-07 admin fără JWT (cron / migrare) → refuz', '42501');
SELECT teste.ca_service_role();
SELECT teste.asteapta_eroare(format('UPDATE public.employees SET colaborare_externa_status = %L WHERE id = %s', 'refuza', :f5),
  'R3-07 service_role → refuz', '42501');
SELECT teste.asteapta_eroare(format('SELECT public.fn_colaborare_externa_seteaza(%s, %L, %L)', :f5, 'refuza', 'Setat de un robot'),
  'R3-07 service_role prin RPC → refuz', '42501');
SELECT teste.ca_admin();
-- R3-07b (audit B #9a) „un om” = JWT prin PostgREST (login authenticator): o sesiune directă postgres (MCP / SQL editor)
-- care își pune SINGURĂ claims de HR nu poate decide acordul (înainte: auth.uid() = HR → trecea)
SELECT set_config('request.jwt.claims', json_build_object('sub', :'u_hr', 'role', 'authenticated')::text, false);
SELECT teste.assert(session_user = 'postgres' AND auth.uid() = :'u_hr'::uuid, 'R3-07b actor: login postgres cu claims de HR falsificate');
SELECT teste.asteapta_eroare(format('SELECT public.fn_colaborare_externa_seteaza(%s, %L, %L)', :f5, 'refuza', 'Setat din SQL cu claims HR'),
  'R3-07b postgres + claims HR falsificate, prin RPC → refuz', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.employees SET colaborare_externa_status = %L, colaborare_externa_nota = %L WHERE id = %s',
    'refuza', 'Setat direct din SQL', :f5), 'R3-07b postgres + claims HR falsificate, UPDATE direct → refuz', '42501');
SELECT teste.ca_admin();
SELECT teste.ca_login('authenticator');
SELECT teste.asteapta_eroare(format('SELECT public.fn_colaborare_externa_seteaza(%s, %L, %L)', :f5, 'refuza', 'Fără claims'),
  'R3-07b authenticator fără claims → refuz', '42501');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT colaborare_externa_status = 'accepta' AND colaborare_externa_confirmat_de = :'u_hr'::uuid FROM public.employees WHERE id = :f5),
  'R3-07b acordul lui f5 a rămas cel setat de HR prin aplicație');

-- R3-08 CHECK-ul (cu protecția oprită în tranzacția testului)
ALTER TABLE public.employees DISABLE TRIGGER trg_employees_colab_ext_protectie_upd;
SELECT teste.asteapta_eroare(format('UPDATE public.employees SET colaborare_externa_status = %L, colaborare_externa_nota = %L WHERE id = %s', 'accepta', 'Nota suficient de lunga', :f3),
  'R3-08 accepta fără confirmat_de → CHECK', '23514');
SELECT teste.asteapta_eroare(format('UPDATE public.employees SET colaborare_externa_document = %L WHERE id = %s', 'doc.pdf', :f3),
  'R3-08 necunoscut cu document → CHECK', '23514');
ALTER TABLE public.employees ENABLE TRIGGER trg_employees_colab_ext_protectie_upd;

-- R3-09 angajat fără dată de încetare
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('SELECT public.fn_colaborare_externa_seteaza(%s, %L, %L)', :a1, 'accepta', 'Acord pentru angajat activ'),
  'R3-09 angajat fără termination_date → refuz', '22023');

-- R3-11 trecerea ca extern (HR)
SELECT public.fn_fost_angajat_leaga_extern(:f3) AS ext_f3 \gset
SELECT public.fn_fost_angajat_leaga_extern(:f1) AS ext_f1 \gset
SELECT teste.assert((SELECT fost_angajat_gazpet AND fost_angajat_employee_id = :f3 AND activ = false AND nume = 'FOST TREI'
                          AND functie = 'Sudor' AND telefon = '0722000000' AND email IS NULL AND created_by = :'u_hr'::uuid
                          AND observatii LIKE 'Fost angajat Gazpet (fișa #' || :f3 || '), contract încheiat la %'
                     FROM public.hr_personal_extern WHERE id = :ext_f3),
  'R3-11 fost angajat „necunoscut” → extern nou marcat „Fost angajat Gazpet”, colaborare INACTIVĂ');
SELECT teste.assert((SELECT fost_angajat_gazpet AND activ FROM public.hr_personal_extern WHERE id = :ext_f1),
  'R3-11 fost angajat cu „accepta” → colaborare activă');
SELECT teste.assert(public.fn_fost_angajat_leaga_extern(:f1) = :ext_f1, 'R3-11 al doilea apel întoarce același id (idempotent)');

-- R3-10 revenire la „necunoscut” → proveniența se golește, jurnal, externul se dezactivează
SELECT public.fn_colaborare_externa_seteaza(:f1, 'necunoscut', 'A retras acordul verbal');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT colaborare_externa_status = 'necunoscut' AND colaborare_externa_confirmat_de IS NULL
                          AND colaborare_externa_confirmat_la IS NULL AND colaborare_externa_document IS NULL
                     FROM public.employees WHERE id = :f1),
  'R3-10 „necunoscut” → confirmat_de/la și documentul golite');
SELECT teste.assert((SELECT count(*) = 1 FROM public.hr_colaborare_externa_jurnal WHERE employee_id = :f1 AND status_vechi = 'accepta' AND status_nou = 'necunoscut')
    AND (SELECT activ = false FROM public.hr_personal_extern WHERE id = :ext_f1),
  'R3-10 rând în jurnal și externul legat trece pe activ=false');

-- R3-12 coliziune pe nume → eroare cu HINT; legarea explicită merge
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.eroare(format('SELECT public.fn_fost_angajat_leaga_extern(%s)', :f4)) AS err_col \gset
SELECT teste.assert(:'err_col'::jsonb ->> 'state' = '23505'
    AND :'err_col'::jsonb ->> 'hint' = format('Există deja externul Fost Coliziune (#%s): leagă-l explicit', :ext_col),
  'R3-12 coliziune pe nume → 23505 cu HINT „Există deja externul … (#id): leagă-l explicit”');
SELECT teste.assert(public.fn_fost_angajat_leaga_extern(:f4, :ext_col) = :ext_col, 'R3-12 legarea explicită cu p_extern_id');
SELECT teste.assert((SELECT fost_angajat_employee_id = :f4 AND fost_angajat_gazpet AND activ = false FROM public.hr_personal_extern WHERE id = :ext_col),
  'R3-12 externul existent e legat și colaborarea devine inactivă (acord necunoscut)');

-- R3-13 un singur rând de extern per fost angajat
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_personal_extern (nume, activ, fost_angajat_employee_id) VALUES (%L, false, %s)', 'Duplicat F3', :f3),
  'R3-13 al doilea extern legat de același angajat → unic', '23505');

-- R3-14 utilizator simplu (RLS îl lasă să scrie în hr_personal_extern) → poarta din trigger
SELECT public.fn_colaborare_externa_seteaza(:f4, 'accepta', 'Acord scris primit pe email');
SELECT teste.ca_utilizator(:'u_ion');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET fost_angajat_employee_id = NULL WHERE id = %s', :ext_f3),
  'R3-14 simplu: ștergerea legăturii → refuz', '42501');
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_personal_extern (nume, activ, fost_angajat_employee_id) VALUES (%L, false, %s)', 'Legat de user', :f5),
  'R3-14 simplu: setarea legăturii → refuz', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :ext_f3),
  'R3-14 simplu: activ=true pe fost angajat cu acord „necunoscut” → refuz', '23514');
UPDATE public.hr_personal_extern SET activ = true WHERE id = :ext_col;
SELECT teste.assert((SELECT activ FROM public.hr_personal_extern WHERE id = :ext_col),
  'R3-14 simplu: activ=true cu acord „accepta” → permis');

-- R3-15 un angajat activ nu poate fi legat
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('SELECT public.fn_fost_angajat_leaga_extern(%s)', :a1), 'R3-15 angajat activ prin RPC → refuz', '22023');
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_personal_extern (nume, activ, fost_angajat_employee_id) VALUES (%L, false, %s)', 'Activ legat', :a1),
  'R3-15 angajat activ prin INSERT direct → refuz', '22023');

-- R3-16 accepta → refuza dezactivează externul; înapoi la accepta NU îl reactivează
SELECT public.fn_colaborare_externa_seteaza(:f4, 'refuza', 'S-a răzgândit, a refuzat în scris');
SELECT teste.assert((SELECT activ = false FROM public.hr_personal_extern WHERE id = :ext_col), 'R3-16 accepta → refuza: externul trece singur pe inactiv');
SELECT public.fn_colaborare_externa_seteaza(:f4, 'accepta', 'A revenit, acord nou semnat');
SELECT teste.assert((SELECT activ = false FROM public.hr_personal_extern WHERE id = :ext_col), 'R3-16 refuza → accepta: externul RĂMÂNE inactiv (activarea o face un om)');

-- R3-17 jurnalul acordului: append-only + RLS
SELECT teste.ca_admin();
SELECT min(id) AS jcol FROM public.hr_colaborare_externa_jurnal \gset
SELECT teste.asteapta_eroare(format('UPDATE public.hr_colaborare_externa_jurnal SET nota = %L WHERE id = %s', 'x', :jcol), 'R3-17 UPDATE pe jurnalul acordului → refuz', NULL, 'append-only');
SELECT teste.asteapta_eroare(format('DELETE FROM public.hr_colaborare_externa_jurnal WHERE id = %s', :jcol), 'R3-17 DELETE → refuz', NULL, 'append-only');
SELECT teste.asteapta_eroare('TRUNCATE public.hr_colaborare_externa_jurnal', 'R3-17 TRUNCATE → refuz', NULL, 'append-only');
SELECT count(*) AS n_jurnal_colab FROM public.hr_colaborare_externa_jurnal \gset
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) FROM public.hr_colaborare_externa_jurnal) = :n_jurnal_colab, 'R3-17 owner vede tot jurnalul');
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.assert((SELECT count(*) FROM public.hr_colaborare_externa_jurnal) = :n_jurnal_colab, 'R3-17 HR (can_modify_employees) vede jurnalul');
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_colaborare_externa_jurnal (employee_id, status_nou, facut_de) VALUES (%s, %L, %L)', :f5, 'accepta', :'u_hr'),
  'R3-17 HR nu poate scrie direct în jurnal', '42501');
SELECT teste.ca_utilizator(:'u_pd');
SELECT teste.assert((SELECT count(*) FROM public.hr_colaborare_externa_jurnal) = :n_jurnal_colab, 'R3-17 can_access_personal_data vede jurnalul');
SELECT teste.ca_utilizator(:'u_ion');
SELECT teste.assert((SELECT count(*) = 0 FROM public.hr_colaborare_externa_jurnal), 'R3-17 utilizatorul simplu vede 0 rânduri');

-- R3-18 nicio regresie pentru externii nelegați
INSERT INTO public.hr_personal_extern (nume, firma, activ) VALUES ('EXTERN LIBER', 'Firma Y', true) RETURNING id AS ext_liber \gset
UPDATE public.hr_personal_extern SET telefon = '0733000000', activ = true WHERE id = :ext_liber;
SELECT teste.assert((SELECT activ AND NOT fost_angajat_gazpet AND telefon = '0733000000' FROM public.hr_personal_extern WHERE id = :ext_liber),
  'R3-18 utilizatorul simplu inserează / actualizează în continuare un extern nelegat, activ');

-- R3-19 fișa legată nu se poate șterge (FK RESTRICT)
SELECT teste.ca_utilizator(:'owner');
SELECT teste.asteapta_eroare(format('DELETE FROM public.employees WHERE id = %s', :f3), 'R3-19 ștergerea fișei legate de un extern → FK RESTRICT', '23503');

-- R3-20 reactivarea fostului angajat → externul legat se dezactivează
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.hr_personal_extern SET activ = true WHERE id = :ext_col;          -- f4 are acordul „accepta”
SELECT teste.assert((SELECT activ FROM public.hr_personal_extern WHERE id = :ext_col), 'R3-20 pregătire: colaborare activă');
UPDATE public.employees SET active = true, termination_date = NULL WHERE id = :f4;
SELECT teste.assert((SELECT activ = false FROM public.hr_personal_extern WHERE id = :ext_col),
  'R3-20 reactivarea fostului angajat → externul legat trece pe activ=false');
-- (review, major) acordul e legat de încetarea curentă: la reactivare revine la „necunoscut”
SELECT teste.ca_admin();
SELECT teste.assert((SELECT colaborare_externa_status = 'necunoscut' AND colaborare_externa_confirmat_de IS NULL
                          AND colaborare_externa_confirmat_la IS NULL AND colaborare_externa_nota IS NULL AND colaborare_externa_document IS NULL
                     FROM public.employees WHERE id = :f4),
  'R3-20 reactivare → acordul „accepta” revine la „necunoscut”, fără proveniență și fără notă');
SELECT teste.assert((SELECT count(*) = 1 FROM public.hr_colaborare_externa_jurnal WHERE employee_id = :f4 AND sursa = 'reset_automat'
                       AND status_vechi = 'accepta' AND status_nou = 'necunoscut' AND facut_de = :'u_hr'::uuid
                       AND nota LIKE 'Resetat automat: fișa a fost reactivată; acordul era pentru încetarea din %'),
  'R3-20 rând în jurnal: sursa reset_automat, cine a reactivat, încetarea la care se referea acordul');
SELECT teste.ca_utilizator(:'u_ion');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :ext_col),
  'R3-20 utilizator simplu: colaborare activă pentru un angajat REACTIVAT → refuz', '23514');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE WHERE id = :f4;          -- a doua plecare
SELECT teste.assert((SELECT NOT active AND colaborare_externa_status = 'necunoscut' FROM public.employees WHERE id = :f4),
  'R3-20 la a doua încetare acordul NU e moștenit: „necunoscut”');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :ext_col),
  'R3-20 după a doua încetare, fără acord nou → colaborarea nu se poate activa', '23514', 'acceptat');
SELECT public.fn_colaborare_externa_seteaza(:f4, 'accepta', 'Acord nou semnat la a doua plecare');
UPDATE public.hr_personal_extern SET activ = true WHERE id = :ext_col;
SELECT teste.assert((SELECT activ FROM public.hr_personal_extern WHERE id = :ext_col),
  'R3-20 cu acord nou pentru încetarea curentă → colaborarea se poate activa');
SELECT teste.ca_admin();
-- poarta pe rândul legat verifică și că fișa e ÎNCĂ a unui fost angajat (independent de reset):
-- stare forțată cu protecția oprită în tranzacția testului (fișă reactivată care păstrează „accepta”)
UPDATE public.hr_personal_extern SET activ = false WHERE id = :ext_col;
ALTER TABLE public.employees DISABLE TRIGGER trg_employees_colab_ext_protectie_upd;
UPDATE public.employees SET active = true WHERE id = :f4;
ALTER TABLE public.employees ENABLE TRIGGER trg_employees_colab_ext_protectie_upd;
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :ext_col),
  'R3-20 fișă din nou activă (chiar cu „accepta” rămas) → colaborarea externă nu se poate activa', '23514', 'doar pentru un fost angajat');
SELECT teste.ca_admin();
ALTER TABLE public.employees DISABLE TRIGGER trg_employees_colab_ext_protectie_upd;
UPDATE public.employees SET active = false WHERE id = :f4;
ALTER TABLE public.employees ENABLE TRIGGER trg_employees_colab_ext_protectie_upd;
UPDATE public.hr_personal_extern SET activ = true WHERE id = :ext_col;             -- admin: f4 e din nou fost angajat cu „accepta”

-- R3-21 resetul merge și pe calea de sistem (admin fără JWT) și la anularea încetării (fișa rămâne inactivă)
INSERT INTO public.employees (name, department, active, termination_date) VALUES ('REACTIVAT ADMIN', 'Test', false, CURRENT_DATE - 3) RETURNING id AS f6 \gset
INSERT INTO public.employees (name, department, active, termination_date) VALUES ('ANULARE INCETARE', 'Test', false, CURRENT_DATE - 3) RETURNING id AS f7 \gset
SELECT teste.ca_utilizator(:'u_hr');
SELECT public.fn_colaborare_externa_seteaza(:f6, 'accepta', 'Acord scris pentru test admin');
SELECT public.fn_colaborare_externa_seteaza(:f7, 'refuza', 'Refuz scris pentru test anulare');
SELECT teste.ca_admin();
UPDATE public.employees SET active = true WHERE id = :f6;                               -- admin, auth.uid() NULL
SELECT teste.assert((SELECT active AND colaborare_externa_status = 'necunoscut' FROM public.employees WHERE id = :f6)
    AND (SELECT facut_de IS NULL AND sursa = 'reset_automat' FROM public.hr_colaborare_externa_jurnal WHERE employee_id = :f6 AND status_nou = 'necunoscut'),
  'R3-21 reactivare ca admin (fără JWT): nu e blocată (42501), acordul revine la „necunoscut”, jurnal cu facut_de NULL = sistem');
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = NULL WHERE id = :f7;                     -- „Editează Angajat”: data ștearsă
SELECT teste.ca_admin();
SELECT teste.assert((SELECT NOT active AND termination_date IS NULL AND colaborare_externa_status = 'necunoscut' FROM public.employees WHERE id = :f7)
    AND (SELECT nota LIKE 'Resetat automat: data încetării a fost ștearsă%' FROM public.hr_colaborare_externa_jurnal
          WHERE employee_id = :f7 AND sursa = 'reset_automat'),
  'R3-21 ștergerea datei de încetare → acordul revine la „necunoscut” (invariantul „acord ⇒ contract încheiat”)');
SELECT teste.ca_admin();
SELECT teste.assert(teste.cron_hr_auto_deactivate_terminated() >= 0
    AND (SELECT colaborare_externa_status = 'accepta' FROM public.employees WHERE id = :f4),
  'R3-21 cron-ul (dezactivări) nu atinge acordul și nu e blocat de protecție');

-- R3-22 (review, major) extern NELEGAT, activ, cu numele / emailul unui fost angajat → refuz (acordul nu se ocolește)
INSERT INTO public.employees (name, department, active, termination_date) VALUES ('RADU MIHAI', 'Test', false, CURRENT_DATE - 5) RETURNING id AS f8 \gset
INSERT INTO public.employees (name, department, email, active, termination_date)
  VALUES ('STEFANESCU ION', 'Test', 'stefanescu.ion@yahoo.com', false, CURRENT_DATE - 5) RETURNING id AS f9 \gset
SELECT teste.ca_utilizator(:'u_hr');
SELECT public.fn_colaborare_externa_seteaza(:f8, 'refuza', 'A refuzat colaborarea în scris');
SELECT public.fn_colaborare_externa_seteaza(:f9, 'refuza', 'A refuzat colaborarea telefonic');
SELECT teste.ca_utilizator(:'u_ion');
SELECT teste.asteapta_eroare($$INSERT INTO public.hr_personal_extern (nume, activ) VALUES ('Radu Mihai', true)$$,
  'R3-22 simplu: extern activ „Radu Mihai” (fost angajat care a refuzat) → refuz', '23514', 'fost angajat Gazpet');
SELECT teste.asteapta_eroare($$INSERT INTO public.hr_personal_extern (nume, activ) VALUES ('Ștefănescu Ion', true)$$,
  'R3-22 simplu: varianta cu diacritice „Ștefănescu Ion” → refuz', '23514', 'fost angajat Gazpet');
SELECT teste.asteapta_eroare($$INSERT INTO public.hr_personal_extern (nume, activ) VALUES ('Ion Stefanescu Marian', true)$$,
  'R3-22 simplu: alt ordin + un prenume în plus → refuz', '23514', 'fost angajat Gazpet');
SELECT teste.asteapta_eroare($$INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Alt Nume Complet', ' Stefanescu.Ion@yahoo.com ', true)$$,
  'R3-22 simplu: emailul fostului angajat → refuz', '23514', 'fost angajat Gazpet');
SELECT teste.eroare($$INSERT INTO public.hr_personal_extern (nume, activ) VALUES ('Radu Mihai', true)$$) AS err_om \gset
SELECT teste.assert(:'err_om'::jsonb ->> 'hint' LIKE 'Folosește HR → Foști angajați → „Trece ca extern” (fișa #' || :f8 || ' RADU MIHAI)%',
  'R3-22 HINT-ul trimite la HR → Foști angajați, cu fișa');
INSERT INTO public.hr_personal_extern (nume, activ) VALUES ('Radu Mihaela', true);
INSERT INTO public.hr_personal_extern (nume, activ) VALUES ('Radu Mihai', false) RETURNING id AS ext_om \gset
SELECT teste.assert((SELECT count(*) = 1 FROM public.hr_personal_extern WHERE nume = 'Radu Mihaela' AND activ)
    AND (SELECT NOT activ FROM public.hr_personal_extern WHERE id = :ext_om),
  'R3-22 alt nume („Radu Mihaela”) și un rând INACTIV cu numele fostului angajat → permise');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :ext_om),
  'R3-22 simplu: activarea rândului omonim → refuz', '23514', 'fost angajat Gazpet');
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :ext_om),
  'R3-22 HR: activarea rândului omonim → refuz (trece prin Foști angajați)', '23514', 'fost angajat Gazpet');
SELECT teste.ca_utilizator(:'owner');
UPDATE public.hr_personal_extern SET activ = true WHERE id = :ext_om;
SELECT teste.assert((SELECT activ AND NOT fost_angajat_gazpet FROM public.hr_personal_extern WHERE id = :ext_om),
  'R3-22 owner: activarea unui omonim (altă persoană) e decizia lui → permisă');
SELECT teste.ca_utilizator(:'u_ion');
UPDATE public.hr_personal_extern SET telefon = '0744000000' WHERE id = :ext_om;
SELECT teste.assert((SELECT telefon = '0744000000' FROM public.hr_personal_extern WHERE id = :ext_om),
  'R3-22 editarea altor câmpuri (nume/email/activ neschimbate) nu reverifică omonimia');
SELECT teste.ca_admin();

-- R3-23 (review, minor) dezlegarea din UI (HR): colaborarea devine inactivă; reactivarea trece prin verificarea de omonimie
INSERT INTO public.employees (name, department, active, termination_date) VALUES ('DEZLEGAT TEST', 'Test', false, CURRENT_DATE - 2) RETURNING id AS f10 \gset
SELECT teste.ca_utilizator(:'u_hr');
SELECT public.fn_colaborare_externa_seteaza(:f10, 'accepta', 'Acord scris pentru test dezlegare');
SELECT public.fn_fost_angajat_leaga_extern(:f10) AS ext_f10 \gset
SELECT teste.assert((SELECT activ AND fost_angajat_gazpet FROM public.hr_personal_extern WHERE id = :ext_f10), 'R3-23 pregătire: extern legat, activ');
UPDATE public.hr_personal_extern SET fost_angajat_employee_id = NULL WHERE id = :ext_f10;
SELECT teste.assert((SELECT NOT activ AND NOT fost_angajat_gazpet FROM public.hr_personal_extern WHERE id = :ext_f10),
  'R3-23 dezlegare (HR) → colaborarea trece pe inactiv, marcajul dispare');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :ext_f10),
  'R3-23 reactivarea rândului dezlegat, omonim cu fostul angajat → refuz', '23514', 'fost angajat Gazpet');
SELECT teste.ca_admin();

-- R3-24 (audit B #9b) SCHIMBAREA datei de încetare pe o fișă inactivă (altă încetare) → acordul revine la „necunoscut”
SELECT teste.ca_utilizator(:'u_hr');
UPDATE public.employees SET termination_date = CURRENT_DATE - 5 WHERE id = :f2;          -- f2: „refuza” din R3-04, încetare CURRENT_DATE - 10
SELECT teste.ca_admin();
SELECT teste.assert((SELECT NOT active AND colaborare_externa_status = 'necunoscut' AND colaborare_externa_document IS NULL
                          AND colaborare_externa_confirmat_de IS NULL FROM public.employees WHERE id = :f2)
    AND (SELECT count(*) = 1 FROM public.hr_colaborare_externa_jurnal WHERE employee_id = :f2 AND sursa = 'reset_automat'
           AND status_vechi = 'refuza' AND nota LIKE 'Resetat automat: data încetării a fost schimbată%'),
  'R3-24 data încetării schimbată pe fișă inactivă → acordul NU trece la altă încetare: „necunoscut” + rând reset_automat');

-- R3-25 (audit A #8 / C P1) jurnalul acordului: identitatea explicită + service_role doar citește
SELECT teste.assert((SELECT facut_de_identitate = 'authenticated:' || :'u_hr' FROM public.hr_colaborare_externa_jurnal
                      WHERE employee_id = :f1 AND status_nou = 'accepta' ORDER BY id LIMIT 1)
    AND (SELECT facut_de_identitate = 'db_login:postgres' FROM public.hr_colaborare_externa_jurnal
          WHERE employee_id = :f6 AND sursa = 'reset_automat'),
  'R3-25 jurnalul acordului: facut_de_identitate = authenticated:<HR> (om) / db_login:postgres (reset din SQL)');
SELECT teste.ca_service_role();
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_colaborare_externa_jurnal (employee_id, status_nou, facut_de) VALUES (%s, %L, %L)', :f5, 'accepta', :'u_hr'),
  'R3-25 service_role nu mai poate scrie în jurnalul acordului (P1)', '42501');
SELECT teste.assert((SELECT count(*) > 0 FROM public.hr_colaborare_externa_jurnal), 'R3-25 service_role păstrează citirea');
SELECT teste.ca_admin();
SELECT teste.assert(NOT has_function_privilege('service_role', 'public.fn_colaborare_externa_seteaza(integer,text,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.fn_fost_angajat_leaga_extern(integer,bigint)', 'EXECUTE'),
  'R3-25 P3: RPC-urile R3 (decizia unui om) fără EXECUTE pentru service_role');

-- E-LIFECYCLE-1 (r4, varianta C): externi ACTIVI NELEGAȚI care existau deja când omul devine fost angajat.
--   email identic → dezactivare automată + notificare owner; doar nume → notificare owner, fără dezactivare;
--   un extern fără nicio potrivire și unul legat de altă fișă nu sunt atinși.
SELECT teste.ca_admin();
INSERT INTO public.employees (name, department, email, active) VALUES ('LIFECU ANA', 'Test', 'lifecu.ana@exemplu.ro', true) RETURNING id AS el_ana \gset
INSERT INTO public.employees (name, department, email, active) VALUES ('LIFECU BOGDAN', 'Test', 'lifecu.bogdan@exemplu.ro', true) RETURNING id AS el_bog \gset
INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Firma Ana Extern', 'Lifecu.Ana@exemplu.ro ', true) RETURNING id AS xl_em \gset
INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Bogdan Lifecu', 'alt.email@exemplu.ro', true) RETURNING id AS xl_nume \gset
INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Lifecu Neinrudit Total', NULL, true) RETURNING id AS xl_nu \gset
SELECT count(*) AS n_notif_el FROM public.notifications WHERE type IN ('extern_fost_angajat_dezactivat', 'extern_fost_angajat_omonim') \gset
UPDATE public.employees SET active = false, termination_date = CURRENT_DATE WHERE id IN (:el_ana, :el_bog);
SELECT teste.assert((SELECT activ IS FALSE FROM public.hr_personal_extern WHERE id = :xl_em),
  'E-LIFECYCLE-1 extern activ nelegat cu EMAILUL fostului angajat → dezactivat automat');
SELECT teste.assert((SELECT activ IS TRUE FROM public.hr_personal_extern WHERE id = :xl_nume),
  'E-LIFECYCLE-1 extern activ nelegat potrivit DOAR pe nume → rămâne activ (poate fi altă persoană)');
SELECT teste.assert((SELECT activ IS TRUE FROM public.hr_personal_extern WHERE id = :xl_nu),
  'E-LIFECYCLE-1 extern fără potrivire (alt nume de familie în poziția fișei, alt email) → neatins');
SELECT teste.assert(EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'extern_fost_angajat_dezactivat'
                             AND message LIKE '%#' || :xl_em || '%')
    AND EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'extern_fost_angajat_omonim'
                 AND message LIKE '%#' || :xl_nume || '%')
    AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE type LIKE 'extern_fost_angajat_%' AND message LIKE '%#' || :xl_nu || ' %'),
  'E-LIFECYCLE-1 owner-ul primește notificare pentru ambele (dezactivat / omonim), nimic pentru externul fără potrivire');
SELECT count(*) AS n_notif_el2 FROM public.notifications WHERE type IN ('extern_fost_angajat_dezactivat', 'extern_fost_angajat_omonim') \gset
UPDATE public.employees SET observatii_hr = 'fără legătură' WHERE id = :el_ana;
UPDATE public.employees SET termination_date = CURRENT_DATE - 1 WHERE id = :el_bog;   -- rămâne fost angajat: nu e o nouă plecare
SELECT teste.assert(:n_notif_el2 > :n_notif_el
    AND (SELECT count(*) FROM public.notifications WHERE type IN ('extern_fost_angajat_dezactivat', 'extern_fost_angajat_omonim')) = :n_notif_el2,
  'E-LIFECYCLE-1 doar TRECEREA în „fost angajat” declanșează verificarea (alte UPDATE-uri pe fișa deja fostă nu re-notifică)');

-- E-LIFECYCLE-2 (r5, varianta A): dezactivare cu termination_date în VIITOR — la scadență nu mai vine niciun UPDATE, deci
-- politica C se aplică anticipat, la dezactivare; trecerea timpului (fără UPDATE) nu mai are ce face.
INSERT INTO public.employees (name, department, email, active) VALUES ('VIITORU CARMEN', 'Test', 'viitoru.carmen@exemplu.ro', true) RETURNING id AS el2 \gset
INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Carmen Consult SRL', 'viitoru.carmen@exemplu.ro', true) RETURNING id AS xl2_em \gset
INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Carmen Viitoru', NULL, true) RETURNING id AS xl2_nume \gset
UPDATE public.employees SET active = false, termination_date = CURRENT_DATE + 30 WHERE id = :el2;
SELECT teste.assert((SELECT activ IS FALSE FROM public.hr_personal_extern WHERE id = :xl2_em)
    AND (SELECT activ IS TRUE FROM public.hr_personal_extern WHERE id = :xl2_nume),
  'E-LIFECYCLE-2 dezactivare cu dată de încetare VIITOARE: externul pe email e dezactivat imediat, cel pe nume rămâne activ');
SELECT teste.assert(EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'extern_fost_angajat_dezactivat'
                             AND message LIKE '%#' || :xl2_em || '%')
    AND EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'extern_fost_angajat_omonim'
                 AND message LIKE '%#' || :xl2_nume || '%'),
  'E-LIFECYCLE-2 owner-ul e notificat la dezactivare (anticipat), nu abia la data încetării');
-- și o dezactivare FĂRĂ dată de încetare (varianta A: indiferent de termination_date)
INSERT INTO public.employees (name, department, email, active) VALUES ('FARADATA DAN', 'Test', 'faradata.dan@exemplu.ro', true) RETURNING id AS el3 \gset
INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Dan Servicii', 'faradata.dan@exemplu.ro', true) RETURNING id AS xl3_em \gset
UPDATE public.employees SET active = false WHERE id = :el3;
SELECT teste.assert((SELECT activ IS FALSE FROM public.hr_personal_extern WHERE id = :xl3_em),
  'E-LIFECYCLE-2 dezactivare fără termination_date → aceeași politică (extern pe email dezactivat)');

-- E-LIFECYCLE-2B (r6): reactivarea unui extern NELEGAT cu emailul EXACT al unei fișe INACTIVE → refuz 23514, indiferent de
-- termination_date și CHIAR pentru owner (excepția owner-ului rămâne doar la potrivirea ambiguă pe nume).
SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :xl2_em),
  'E-LIFECYCLE-2B dezactivare cu încetare +30 zile, apoi reactivarea externului pe email → refuz', '23514', 'același email');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :xl3_em),
  'E-LIFECYCLE-2B fără termination_date: reactivarea externului pe email → refuz', '23514', 'același email');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_personal_extern SET activ = true WHERE id = %s', :xl2_em),
  'E-LIFECYCLE-2B owner: reactivarea externului cu emailul exact al fișei inactive → refuz (fără excepție de owner)', '23514', 'același email');
SELECT teste.asteapta_eroare($$INSERT INTO public.hr_personal_extern (nume, email, activ) VALUES ('Alt Extern Owner', 'VIITORU.CARMEN@exemplu.ro', true)$$,
  'E-LIFECYCLE-2B owner: extern NOU activ cu emailul exact al fișei inactive → refuz', '23514', 'același email');
INSERT INTO public.hr_personal_extern (nume, activ) VALUES ('Lifecu Bogdan Ionut', true) RETURNING id AS xl2_owner_nume \gset
SELECT teste.assert((SELECT activ FROM public.hr_personal_extern WHERE id = :xl2_owner_nume),
  'E-LIFECYCLE-2B owner: potrivirea DOAR pe nume cu un fost angajat (LIFECU BOGDAN) rămâne decizia owner-ului (permis)');
SELECT teste.ca_admin();

\endif

ROLLBACK;
\echo 'PASS conturi_ciclu_viata.test.sql: toate aserțiunile au trecut'
