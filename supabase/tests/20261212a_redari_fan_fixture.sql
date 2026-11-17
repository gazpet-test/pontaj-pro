-- Fixture SINTETIC pentru proba cu două sesiuni a 20261212a (FAN Courier, runda 3 a PR #1118) — DOAR pe CLONĂ, fără date personale reale.
-- De ce: clona coordonatorului nu are niciun proiect / plic Redări; scriptul supabase/tests/20261212a_redari_fan_doua_sesiuni.sh --cu-fixture
--   îl creează la început și îl șterge la final. Se poate rula și separat:
--   psql -X -v ON_ERROR_STOP=1 -v sistem=<system_identifier clonă> -v actiune=creeaza|sterge -f supabase/tests/20261212a_redari_fan_fixture.sql <conexiune>
-- Garda țintei (ca scriptul): system_identifier = :sistem, altfel refuz înainte de orice scriere; sesiune postgres fără JWT (mentenanță).
-- CE CREEAZĂ (o tranzacție; FK / CHECK / trigger-ele REALE, toate active — doar căile de mentenanță pe care trigger-ele însele le permit):
--   * 3 conturi distincte: owner (profiles.is_owner), editor Redări ne-owner (user_module_access 'redari' / 'editor'), viewer Redări ne-owner
--     ('viewer'): rânduri în auth.users (trigger-ul real handle_new_user creează profiles + conturi_tip), adrese .invalid (fără notificări);
--   * proiectul de TEST „TEST-FAN-FIXTURE”, UAT „ZFX”, parcela ZFX-0001, 3 deținători proprietari cu contacte SINTETICE valide
--     (0700000101…103, „Strada Fictiva nr. 1…3”), câte o convocare poștală activă pe deținător, 3 plicuri active, neexpediate, fără AWB
--     (PL-ZFX-0001…0003, cheia persoanei = fn_red_cheie_persoana reală), toate în lotul PP-9912, fără niciun rând FAN.
--   Convocările se inserează cu auth.uid() = owner-ul fixture (trigger-ul calității cere admin / editor) și FĂRĂ request.jwt.claims (sesiune de
--   mentenanță: informarea GDPR publicată nu e cerută). Plicurile și lotul: inserare directă de mentenanță (fără contoarele globale „C” / „PP”
--   / „PL-…”, care rămân neatinse).
-- CE ȘTERGE (actiune=sterge): DOAR rândurile cu identificatorii de mai jos (și rândurile FAN ale lotului fixture — lotul e sintetic), apoi
--   jurnalele scrise de trigger-ele lor (red_jurnal după inregistrare_id, conturi_tip_jurnal după auth_user_id), cu trigger-ele de
--   imuabilitate oprite DOAR în acea tranzacție; la final verifică dispariția fiecărui identificator (altfel refuz, nimic șters).
-- Identificatorii (fixați, prefix f12a…): conturi …a1 / a2 / a3, proiect …b1, UAT …c1, parcelă …d1, deținători …e1-e3, lot …f1,
--   plicuri …71-73, convocări …81-83. Urme ale unei rulări anterioare = refuz la creare („rulează întâi actiune=sterge”).
-- Dependențe de verificat pe clonă (nu sunt în repo): dreptul lui postgres de INSERT / DELETE pe auth.users; trigger-ele GoTrue de pe auth.users.
\set ON_ERROR_STOP 1
SELECT :'actiune' = 'creeaza' AS creeaza, :'actiune' = 'sterge' AS sterge, :'actiune' IN ('creeaza', 'sterge') AS valid \gset
\if :valid
\else
DO $a$ BEGIN RAISE EXCEPTION 'FIXTURE: actiune = creeaza | sterge'; END $a$;
\endif
BEGIN;
SELECT set_config('fixture.sistem', :'sistem', true) IS NOT NULL AS ok \gset
DO $garda$
BEGIN
  IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM current_setting('fixture.sistem', true) THEN
    RAISE EXCEPTION 'FIXTURE: alta tinta (system_identifier diferit de --sistem); nimic scris';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' OR session_user IS DISTINCT FROM 'postgres'
     OR coalesce(current_setting('request.jwt.claims', true), '') <> '' OR coalesce(current_setting('request.jwt.claim.sub', true), '') <> '' THEN
    RAISE EXCEPTION 'FIXTURE: cere o sesiune postgres fara JWT (mentenanta)';
  END IF;
  IF to_regprocedure('public.fn_red_fan_claim_lot(uuid, uuid[], text[], text[])') IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: 20261212a nu e aplicata pe clona';
  END IF;
END $garda$;

-- identificatorii fixture-ului (o singură definiție, folosită la creare, ștergere și verificare)
CREATE TEMP TABLE fx_id (rol text PRIMARY KEY, id uuid NOT NULL UNIQUE) ON COMMIT DROP;
INSERT INTO fx_id VALUES
  ('owner', 'f12a0000-0000-4000-8000-0000000000a1'), ('editor', 'f12a0000-0000-4000-8000-0000000000a2'), ('viewer', 'f12a0000-0000-4000-8000-0000000000a3'),
  ('proiect', 'f12a0000-0000-4000-8000-0000000000b1'), ('uat', 'f12a0000-0000-4000-8000-0000000000c1'), ('parcela', 'f12a0000-0000-4000-8000-0000000000d1'),
  ('det1', 'f12a0000-0000-4000-8000-0000000000e1'), ('det2', 'f12a0000-0000-4000-8000-0000000000e2'), ('det3', 'f12a0000-0000-4000-8000-0000000000e3'),
  ('lot', 'f12a0000-0000-4000-8000-0000000000f1'),
  ('plic1', 'f12a0000-0000-4000-8000-000000000071'), ('plic2', 'f12a0000-0000-4000-8000-000000000072'), ('plic3', 'f12a0000-0000-4000-8000-000000000073'),
  ('conv1', 'f12a0000-0000-4000-8000-000000000081'), ('conv2', 'f12a0000-0000-4000-8000-000000000082'), ('conv3', 'f12a0000-0000-4000-8000-000000000083');
CREATE FUNCTION pg_temp.fx(p text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT id FROM pg_temp.fx_id WHERE rol = p $f$;

-- câte rânduri cu identificatorii fixture-ului există (sau cu codurile lui unice), pe fiecare tabel atins
CREATE FUNCTION pg_temp.fx_urme() RETURNS TABLE (tabel text, n bigint) LANGUAGE sql AS $f$
  SELECT 'auth.users', count(*) FROM auth.users WHERE id IN (SELECT id FROM pg_temp.fx_id) OR email LIKE 'fixture-fan-r3-%@exemplu.invalid'
  UNION ALL SELECT 'profiles', count(*) FROM public.profiles WHERE id IN (SELECT id FROM pg_temp.fx_id)
  UNION ALL SELECT 'user_module_access', count(*) FROM public.user_module_access WHERE profile_id IN (SELECT id FROM pg_temp.fx_id)
  UNION ALL SELECT 'conturi_tip', count(*) FROM public.conturi_tip WHERE auth_user_id IN (SELECT id FROM pg_temp.fx_id)
  UNION ALL SELECT 'conturi_tip_jurnal', count(*) FROM public.conturi_tip_jurnal WHERE auth_user_id IN (SELECT id FROM pg_temp.fx_id)
  UNION ALL SELECT 'red_proiecte', count(*) FROM public.red_proiecte WHERE id = pg_temp.fx('proiect') OR cod = 'TEST-FAN-FIXTURE'
  UNION ALL SELECT 'red_uat', count(*) FROM public.red_uat WHERE id = pg_temp.fx('uat') OR proiect_id = pg_temp.fx('proiect')
  UNION ALL SELECT 'red_parcele', count(*) FROM public.red_parcele WHERE id = pg_temp.fx('parcela') OR proiect_id = pg_temp.fx('proiect')
  UNION ALL SELECT 'red_detinatori', count(*) FROM public.red_detinatori WHERE id IN (SELECT id FROM pg_temp.fx_id) OR parcela_id = pg_temp.fx('parcela')
  UNION ALL SELECT 'red_detinatori_contact', count(*) FROM public.red_detinatori_contact WHERE detinator_id IN (SELECT id FROM pg_temp.fx_id)
  UNION ALL SELECT 'red_detinatori_token', count(*) FROM public.red_detinatori_token WHERE detinator_id IN (SELECT id FROM pg_temp.fx_id)
  UNION ALL SELECT 'red_convocari', count(*) FROM public.red_convocari WHERE id IN (SELECT id FROM pg_temp.fx_id) OR nr_document LIKE 'FIXTURE-FAN-%'
  UNION ALL SELECT 'red_plicuri', count(*) FROM public.red_plicuri WHERE id IN (SELECT id FROM pg_temp.fx_id) OR nr_plic LIKE 'PL-ZFX-%'
  UNION ALL SELECT 'red_loturi_plicuire', count(*) FROM public.red_loturi_plicuire WHERE id = pg_temp.fx('lot') OR nr_lot = 'PP-9912'
  UNION ALL SELECT 'red_fan_loturi', count(*) FROM public.red_fan_loturi WHERE lot_id = pg_temp.fx('lot')
  UNION ALL SELECT 'red_fan_awb', count(*) FROM public.red_fan_awb WHERE lot_id = pg_temp.fx('lot') OR plic_id IN (SELECT id FROM pg_temp.fx_id)
  UNION ALL SELECT 'red_jurnal', count(*) FROM public.red_jurnal WHERE inregistrare_id IN (SELECT id FROM pg_temp.fx_id)
  UNION ALL SELECT 'red_numere PL-ZFX', count(*) FROM public.red_numere WHERE cheie = 'PL-ZFX'
$f$;

\if :creeaza
DO $curat$
DECLARE v text;
BEGIN
  SELECT string_agg(tabel || '=' || n, ', ') INTO v FROM pg_temp.fx_urme() WHERE n > 0;
  IF v IS NOT NULL THEN RAISE EXCEPTION 'FIXTURE: urme ale unei rulari anterioare (%); ruleaza intai actiune=sterge', v; END IF;
  IF EXISTS (SELECT 1 FROM public.red_uat WHERE uat3 = 'ZFX') THEN RAISE EXCEPTION 'FIXTURE: UAT-ul ZFX exista deja pe clona; alege alt cod'; END IF;
END $curat$;

-- conturile: trigger-ul real (handle_new_user) creează profilul + conturi_tip; INSERT-ul de profil e doar plasă dacă trigger-ul lipsește
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', pg_temp.fx(r), 'authenticated', 'authenticated', 'fixture-fan-r3-' || r || '@exemplu.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()
  FROM unnest(ARRAY['owner', 'editor', 'viewer']) r;
INSERT INTO public.profiles (id, email, name, role)
SELECT pg_temp.fx(r), 'fixture-fan-r3-' || r || '@exemplu.invalid', 'FIXTURE FAN ' || upper(r), 'in_asteptare' FROM unnest(ARRAY['owner', 'editor', 'viewer']) r
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET name = 'FIXTURE FAN ' || upper(x.rol), is_owner = (x.rol = 'owner')
  FROM pg_temp.fx_id x WHERE profiles.id = x.id AND x.rol IN ('owner', 'editor', 'viewer');
INSERT INTO public.user_module_access (profile_id, module, access_level)
VALUES (pg_temp.fx('editor'), 'redari', 'editor'), (pg_temp.fx('viewer'), 'redari', 'viewer');

-- proiectul de TEST, UAT, parcelă, deținători + contacte sintetice
INSERT INTO public.red_proiecte (id, cod) VALUES (pg_temp.fx('proiect'), 'TEST-FAN-FIXTURE');
INSERT INTO public.red_uat (id, proiect_id, nume, uat3) VALUES (pg_temp.fx('uat'), pg_temp.fx('proiect'), 'UAT FICTIV FIXTURE', 'ZFX');
INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela) VALUES (pg_temp.fx('parcela'), pg_temp.fx('proiect'), pg_temp.fx('uat'), 'ZFX-0001');
INSERT INTO public.red_detinatori (id, parcela_id, nume, nume_normalizat, calitate)
SELECT pg_temp.fx('det' || i), pg_temp.fx('parcela'), 'FIXTURE ' || n, 'FIXTURE ' || n, 'proprietar'
  FROM (VALUES (1, 'UNU'), (2, 'DOI'), (3, 'TREI')) v(i, n);
INSERT INTO public.red_detinatori_contact (detinator_id, telefon, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal, adresa_cunoscuta)
SELECT pg_temp.fx('det' || i), '07000001' || lpad(i::text, 2, '0'), 'Strada Fictiva nr. ' || i, 'Sat Fictiv', 'Comuna Fictiva', 'Prahova', '10000' || i, true
  FROM generate_series(1, 3) i;

-- lotul și plicurile (mentenanță: plicul nou poate veni direct cu lotul), cheia persoanei = funcția reală
INSERT INTO public.red_loturi_plicuire (id, proiect_id, nr_lot, data_plicuire) VALUES (pg_temp.fx('lot'), pg_temp.fx('proiect'), 'PP-9912', current_date);
INSERT INTO public.red_plicuri (id, proiect_id, uat_id, nr_plic, cheie_persoana, destinatar_nume, lot_id)
SELECT pg_temp.fx('plic' || i), pg_temp.fx('proiect'), pg_temp.fx('uat'), 'PL-ZFX-000' || i, public.fn_red_cheie_persoana(pg_temp.fx('det' || i)),
       'FIXTURE ' || n, pg_temp.fx('lot')
  FROM (VALUES (1, 'UNU'), (2, 'DOI'), (3, 'TREI')) v(i, n);

-- convocările poștale active, legate de plic: auth.uid() = owner-ul fixture DOAR pentru această instrucțiune (claim.sub, fără claims)
SELECT set_config('request.jwt.claim.sub', pg_temp.fx('owner')::text, true) IS NOT NULL AS ok \gset
INSERT INTO public.red_convocari (id, detinator_id, canal, nr_document, calitate_document, plic_id)
SELECT pg_temp.fx('conv' || i), pg_temp.fx('det' || i), 'posta', 'FIXTURE-FAN-000' || i, 'proprietar', pg_temp.fx('plic' || i) FROM generate_series(1, 3) i;
SELECT set_config('request.jwt.claim.sub', '', true) IS NOT NULL AS ok \gset

-- postcondiții: forma cerută de scriptul cu două sesiuni
DO $post$
DECLARE v_niv text; r text;
BEGIN
  IF (SELECT count(*) FROM public.red_plicuri WHERE lot_id = pg_temp.fx('lot') AND stare = 'activ' AND awb IS NULL AND data_expediere IS NULL) <> 3
     OR (SELECT count(*) FROM public.red_convocari WHERE plic_id IN (pg_temp.fx('plic1'), pg_temp.fx('plic2'), pg_temp.fx('plic3')) AND stare = 'activ' AND sters_la IS NULL) <> 3
     OR (SELECT count(*) FROM public.red_detinatori_contact WHERE detinator_id IN (pg_temp.fx('det1'), pg_temp.fx('det2'), pg_temp.fx('det3')) AND telefon IS NOT NULL) <> 3
     OR EXISTS (SELECT 1 FROM public.red_fan_awb WHERE lot_id = pg_temp.fx('lot')) OR EXISTS (SELECT 1 FROM public.red_fan_loturi WHERE lot_id = pg_temp.fx('lot'))
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = pg_temp.fx('owner') AND is_owner IS TRUE)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id IN (pg_temp.fx('editor'), pg_temp.fx('viewer')) AND is_owner IS TRUE) THEN
    RAISE EXCEPTION 'FIXTURE: postconditiile crearii nu sunt indeplinite';
  END IF;
  -- nivelurile reale (fn_red_nivel) ale celor trei conturi
  FOREACH r IN ARRAY ARRAY['owner', 'editor', 'viewer'] LOOP
    PERFORM set_config('request.jwt.claim.sub', pg_temp.fx(r)::text, true);
    v_niv := r || '=' || coalesce(public.fn_red_nivel(), '-');
    IF v_niv NOT IN ('owner=admin', 'editor=editor', 'viewer=viewer') THEN RAISE EXCEPTION 'FIXTURE: nivel Redari neasteptat: %', v_niv; END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $post$;
COMMIT;
SELECT 'FIXTURE_CREAT LOT=' || 'f12a0000-0000-4000-8000-0000000000f1' || ' OWNER=f12a0000-0000-4000-8000-0000000000a1 EDITOR=f12a0000-0000-4000-8000-0000000000a2 VIEWER=f12a0000-0000-4000-8000-0000000000a3';
\endif

\if :sterge
-- rândurile FAN ale lotului fixture (lotul e sintetic: tot ce e pe el ține de probă), cu garda marcajului oprită DOAR aici
ALTER TABLE public.red_fan_loturi DISABLE TRIGGER trg_red_fan_loturi_garda;
DELETE FROM public.red_fan_awb WHERE lot_id = pg_temp.fx('lot') OR plic_id IN (SELECT id FROM pg_temp.fx_id);
DELETE FROM public.red_fan_loturi WHERE lot_id = pg_temp.fx('lot');
ALTER TABLE public.red_fan_loturi ENABLE TRIGGER trg_red_fan_loturi_garda;
DELETE FROM public.red_convocari WHERE id IN (SELECT id FROM pg_temp.fx_id) OR detinator_id IN (SELECT id FROM pg_temp.fx_id);
DELETE FROM public.red_plicuri WHERE id IN (SELECT id FROM pg_temp.fx_id) OR proiect_id = pg_temp.fx('proiect');
DELETE FROM public.red_loturi_plicuire WHERE id = pg_temp.fx('lot') OR proiect_id = pg_temp.fx('proiect');
DELETE FROM public.red_detinatori_contact WHERE detinator_id IN (SELECT id FROM pg_temp.fx_id);
DELETE FROM public.red_detinatori_token WHERE detinator_id IN (SELECT id FROM pg_temp.fx_id);
DELETE FROM public.red_detinatori WHERE id IN (SELECT id FROM pg_temp.fx_id) OR parcela_id = pg_temp.fx('parcela');
DELETE FROM public.red_parcele WHERE id = pg_temp.fx('parcela') OR proiect_id = pg_temp.fx('proiect');
DELETE FROM public.red_uat WHERE id = pg_temp.fx('uat') OR proiect_id = pg_temp.fx('proiect');
DELETE FROM public.red_proiecte WHERE id = pg_temp.fx('proiect');
DELETE FROM public.user_module_access WHERE profile_id IN (SELECT id FROM pg_temp.fx_id);
DELETE FROM auth.users WHERE id IN (SELECT id FROM pg_temp.fx_id);
DELETE FROM public.conturi_tip WHERE auth_user_id IN (SELECT id FROM pg_temp.fx_id);
DELETE FROM public.profiles WHERE id IN (SELECT id FROM pg_temp.fx_id);
-- jurnalele scrise de trigger-ele rândurilor fixture-ului (și de ștergerile de mai sus), DOAR după identificatori
ALTER TABLE public.red_jurnal DISABLE TRIGGER trg_red_jurnal_imuabil;
DELETE FROM public.red_jurnal WHERE inregistrare_id IN (SELECT id FROM pg_temp.fx_id);
ALTER TABLE public.red_jurnal ENABLE TRIGGER trg_red_jurnal_imuabil;
ALTER TABLE public.conturi_tip_jurnal DISABLE TRIGGER conturi_jurnal_imuabil;
DELETE FROM public.conturi_tip_jurnal WHERE auth_user_id IN (SELECT id FROM pg_temp.fx_id);
ALTER TABLE public.conturi_tip_jurnal ENABLE TRIGGER conturi_jurnal_imuabil;
DO $disparut$
DECLARE v text;
BEGIN
  SELECT string_agg(tabel || '=' || n, ', ') INTO v FROM pg_temp.fx_urme() WHERE n > 0;
  IF v IS NOT NULL THEN RAISE EXCEPTION 'FIXTURE: dupa stergere au ramas randuri (%); nimic sters', v; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_red_fan_loturi_garda', 'trg_red_jurnal_imuabil', 'conturi_jurnal_imuabil') AND tgenabled <> 'O') THEN
    RAISE EXCEPTION 'FIXTURE: un trigger de garda a ramas oprit';
  END IF;
END $disparut$;
COMMIT;
SELECT 'FIXTURE_STERS: niciun rand cu identificatorii fixture-ului';
\endif
