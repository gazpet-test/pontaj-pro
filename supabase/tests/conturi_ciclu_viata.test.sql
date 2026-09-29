-- ============================================================================
-- Teste SQL — ciclul de viață al conturilor (R1 legare automată, R2 închidere la contract
-- încheiat, R3 fost angajat ca extern). Rulare: scripts/test_conturi_ciclu_viata.sh
-- ============================================================================
-- Convenții:
--   * totul într-o tranzacție încheiată cu ROLLBACK → fișierul poate rula de mai multe ori
--     pe aceeași bază (ex. după migrare, apoi după rollback + reaplicare);
--   * teste.assert(cond, 'Tn descriere') / teste.asteapta_eroare(sql, 'Tn ...', sqlstate, fragment)
--     → la eșec RAISE EXCEPTION, psql oprește (ON_ERROR_STOP) și scriptul iese cu cod ≠ 0;
--   * identități: teste.ca_utilizator(uuid) = PostgREST cu JWT (SET ROLE authenticated),
--     teste.ca_anon(), teste.ca_service_role(), teste.ca_admin() = postgres fără JWT
--     (ca migrările și pg_cron); conturi noi: teste.creeaza_cont(email, uuid) = GoTrue;
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

-- ---------------------------------------------------------------- BAZĂ: RLS + triggere owner-only
SELECT teste.ca_utilizator(:'u_ion');
SELECT teste.assert(auth.uid() = :'u_ion'::uuid AND current_user = 'authenticated', 'T3 identitate PostgREST simulată');
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
-- (contul creat de owner prin API-ul admin: app_metadata.gazpet_legare_automata = true, pe care signUp nu-l poate pune)
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

-- R1-13 izolarea erorilor
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
    AND NOT has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE'),
  'R1-18 handle_new_user nu e apelabilă din API');
SELECT teste.assert(NOT has_function_privilege('anon', 'public.fn_admin_conturi_alerte()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.fn_admin_conturi_alerte()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.fn_cont_leaga_automat(boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.fn_cont_leaga_automat(boolean)', 'EXECUTE'),
  'R1-18 fn_admin_conturi_alerte / fn_cont_leaga_automat: EXECUTE doar pentru authenticated (poarta e în cod)');
SELECT teste.assert((SELECT bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp'])
                       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                        AND p.proname IN ('fn_cont_candidati_angajat','fn_cont_notifica_owneri','handle_new_user',
                                          'fn_profiles_protectie_legatura','fn_cont_leaga_automat','fn_admin_conturi_alerte')),
  'R1-18 funcțiile R1: SECURITY DEFINER cu search_path = public, pg_temp');

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
SELECT teste.assert((SELECT rezultat = 'legat' FROM public.fn_cont_leaga_automat(false) WHERE profile_id = :'u_r1tarziu'),
  'R1-19 p_simulare=false leagă potrivirea unică');
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
SELECT teste.assert((SELECT count(*) = 2 FROM public.fn_cont_leaga_automat(false) WHERE profile_id IN (:'u_r1pub1', :'u_r1pub2') AND rezultat = 'legat'),
  'R1-20 confirmarea owner-ului leagă (un clic)');
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
SELECT teste.assert((SELECT rezultat = 'email_diferit' FROM public.fn_cont_leaga_automat(false) WHERE profile_id = :'u_r1spoof'),
  'R1-21 aplicarea sare peste profilul cu email diferit');
SELECT teste.assert((SELECT candidati = '[]'::jsonb AND email = 'atacator@adromevolution.ro' FROM public.v_admin_conturi_alerte
                     WHERE id = 'fara_angajat:' || :'u_r1spoof'),
  'R1-21 alerta fara_angajat: candidații și emailul vin din emailul de logare');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r1spoof')
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE employee_id = :e_r1victima),
  'R1-21 fișa victimei rămâne nelegată');

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
                     FROM public.fn_cont_leaga_automat(false) WHERE profile_id IN (:'u_r1d1', :'u_r1d2')),
  'R1-23 aplicare: tot „ambiguu”, identic cu previzualizarea');
SELECT teste.ca_admin();
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.profiles WHERE employee_id = :e_r1dublura),
  'R1-23 fișa nu s-a legat arbitrar de niciunul');

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

-- fișe + conturi (legate automat prin email)
INSERT INTO public.employees (name, department, email, active) VALUES ('INCHIDERE UI', 'Test', 'r2.ui@gazpet.ro', true) RETURNING id AS e_r2ui \gset
INSERT INTO public.employees (name, department, email, active) VALUES ('INCHIDERE TOGGLE', 'Test', 'r2.toggle@gazpet.ro', true) RETURNING id AS e_r2tg \gset
INSERT INTO public.employees (name, department, email, active) VALUES ('FARA DATA', 'Test', 'r2.faradata@gazpet.ro', true) RETURNING id AS e_r2fd \gset
INSERT INTO public.employees (name, department, email, active) VALUES ('DATA VIITOR', 'Test', 'r2.viitor@gazpet.ro', true) RETURNING id AS e_r2fv \gset
INSERT INTO public.employees (name, department, email, active) VALUES ('VIITOR CRON', 'Test', 'r2.viitorcron@gazpet.ro', true) RETURNING id AS e_r2v2 \gset
INSERT INTO public.employees (name, department, email, active) VALUES ('EROARE INCHIDERE', 'Test', 'r2.eroare@gazpet.ro', true) RETURNING id AS e_r2err \gset
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
-- R2-18 claims restaurate după golirea locală din fn_cont_inchide
SELECT teste.assert(auth.uid() = :'u_hr'::uuid AND current_user = 'authenticated',
  'R2-18 după închidere, în aceeași tranzacție: auth.uid() = HR și current_user = authenticated');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT active = false FROM public.employees WHERE id = :e_r2ui),
  'R2-01 fișa e inactivă (UPDATE-ul HR a reușit)');
SELECT teste.assert(NOT EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = :'u_r2ui')
    AND NOT EXISTS (SELECT 1 FROM public.profile_sites WHERE profile_id = :'u_r2ui'),
  'R2-01 0 rânduri în user_module_access și profile_sites');
SELECT teste.assert(teste.flaguri_toate(:'u_r2ui', false),
  'R2-01 toate cele 22 de flaguri sunt false');
SELECT teste.assert((SELECT NOT (can_access_salarii OR can_access_personal_data OR can_access_pontaj_brut OR can_modify_employees
                           OR can_manage_contracts OR can_access_diurne OR can_access_financiar) FROM public.profiles WHERE id = :'u_r2ui'),
  'R2-01 inclusiv cele 8 flaguri owner-only (capcana trg_enforce_owner_only_salary_flags evitată)');
SELECT teste.assert((SELECT banned_until = '2999-12-31 00:00:00+00' FROM auth.users WHERE id = :'u_r2ui')
    AND NOT EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = :'u_r2ui')
    AND NOT EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE user_id = :'u_r2ui'::text AND revoked IS NOT TRUE),
  'R2-01 banned_until=2999-12-31, 0 sesiuni, niciun refresh token activ (revocați; cei legați de sesiuni cad în cascadă)');
SELECT teste.assert((SELECT count(*) = 1 FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2ui'),
  'R2-01 exact 1 rând în jurnal');
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

-- R2-03 calea cron (postgres fără JWT) pe o fișă cu data de ieri
INSERT INTO public.employees (name, department, email, active, termination_date) VALUES ('INCHIDERE CRON', 'Test', 'r2.cron@gazpet.ro', true, CURRENT_DATE - 1)
  RETURNING id AS e_r2cron \gset
SELECT teste.creeaza_cont('r2.cron@gazpet.ro', :'u_r2cron');
SELECT teste.assert((SELECT employee_id IS NULL FROM public.profiles WHERE id = :'u_r2cron'),
  'R2-03 pregătire: fișa cu contract încheiat nu e candidat R1 (se leagă manual)');
UPDATE public.profiles SET employee_id = :e_r2cron WHERE id = :'u_r2cron';
INSERT INTO public.app_modules (key, name, is_active) VALUES ('test_modul_efemer', 'Modul efemer (test)', true);
SELECT teste.da_acces(:'u_r2cron');
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (:'u_r2cron', 'test_modul_efemer', 'viewer');
SELECT teste.assert(teste.cron_hr_auto_deactivate_terminated() >= 1, 'R2-03 cron-ul rulează');
SELECT teste.assert(teste.inchis_complet(:'u_r2cron'), 'R2-03 cron: cont închis complet');
SELECT teste.assert((SELECT facut_de IS NULL AND sursa = 'trigger_contract_incheiat' AND jsonb_array_length(snapshot -> 'module') = 3
                     FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2cron'),
  'R2-03 jurnal: facut_de NULL (sistem), sursa trigger_contract_incheiat');

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
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_angajat_inactiv_fara_incetare'
    AND message LIKE 'r2.viitor@gazpet.ro%înainte de data încetării%'),
  'R2-05 notificarea explică data din viitor');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) = 1 FROM public.v_admin_conturi_alerte WHERE id = 'cont_activ_fost_angajat:' || :'u_r2fv'
                       AND termination_date = CURRENT_DATE + 10),
  'R2-05 alertă cont_activ_fost_angajat cu data viitoare');
SELECT teste.ca_admin();

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
SELECT teste.assert((SELECT count(*) = 1 FROM public.notifications WHERE profile_id = :'owner' AND type = 'cont_angajat_reactivat'
    AND message LIKE 'r2.toggle@gazpet.ro%NU a fost redat automat%'),
  'R2-10 notificare cont_angajat_reactivat');
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) = 1 FROM public.v_admin_conturi_alerte WHERE id = 'reactivat_acces_neredat:' || :'u_r2tg'
                       AND employee_active AND jurnal_id IS NOT NULL),
  'R2-10 alertă reactivat_acces_neredat');

-- R2-11 restaurare de către owner
SELECT id AS j_tg FROM public.conturi_inchideri_jurnal WHERE profile_id = :'u_r2tg' \gset
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
SELECT teste.assert(NOT has_function_privilege('anon', 'public.fn_cont_restaureaza(bigint,text)', 'EXECUTE')
    AND (SELECT restaurat_la IS NULL FROM public.conturi_inchideri_jurnal WHERE id = :j_ui)
    AND NOT EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = :'u_r2ui'),
  'R2-12 după refuzuri: jurnalul și contul neschimbate');

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

-- R2-15 RLS pe jurnal
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) = 4 FROM public.conturi_inchideri_jurnal), 'R2-15 owner vede jurnalul (4 închideri până aici)');
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
SELECT teste.ca_utilizator(:'owner');
SELECT teste.assert((SELECT count(*) = 1 FROM public.v_admin_conturi_alerte WHERE id = 'cont_activ_fost_angajat:' || :'u_r2err'),
  'R2-19 alertă cont_activ_fost_angajat pentru închiderea eșuată');
SELECT teste.ca_admin();

-- R2-20 lotul cron nu se blochează când o închidere pică
INSERT INTO public.employees (name, department, active, termination_date) VALUES ('LOT UNU', 'Test', true, CURRENT_DATE - 1) RETURNING id AS e_lot1 \gset
INSERT INTO public.employees (name, department, active, termination_date) VALUES ('LOT DOI', 'Test', true, CURRENT_DATE - 1) RETURNING id AS e_lot2 \gset
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
SELECT teste.asteapta_eroare(format('UPDATE public.profiles SET can_create_comenzi = true, receive_bonuri_consum = true, email_notifications_enabled = true WHERE id = %L', :'u_r2ui'),
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
        '{"profile": {"email_notifications_enabled": true, "can_create_comenzi": true}, "module": [{"module": "hr"}]}'::jsonb)
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
INSERT INTO public.employees (name, department, email, active, termination_date) VALUES ('FARA NOTIF', 'Test', 'r2.faranotif@gazpet.ro', true, CURRENT_DATE - 1)
  RETURNING id AS e_r2fn \gset
INSERT INTO public.employees (name, department, email, active) VALUES ('FARA NOTIF DOI', 'Test', 'r2.faranotif2@gazpet.ro', true)
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

\endif

ROLLBACK;
\echo 'PASS conturi_ciclu_viata.test.sql: toate aserțiunile au trecut'
