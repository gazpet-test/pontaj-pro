-- DRY 20261130a_sms_mvp. Runner: o singura tranzactie ANULATA (migrare + teste + revenire + ROLLBACK), izolare READ COMMITTED.
-- Identitati reale: owner-ul + un cont non-owner cu modulul redari (editor/admin) + anon + service_role, prin helperii pg_temp (ca la 29h).
-- Date: numai fictive (telefoane 0700…, proiect TEST-SMS-DRY); singura citire de date reale e numaratoarea angajatilor cu mobil (TEST4),
-- fara niciun telefon afisat. Nu se apeleaza niciun furnizor: DRY-ul nu trimite nimic (fn_sms_rezerva doar rezerva, in tranzactia anulata).
-- Ordinea testelor conteaza (consumul de plafon se aduna in tranzactie). r2: lista fixata (fn_sms_lot_destinatari), coada_golita,
-- reconcilierea DLR repetat (TEST6d), raportul anularii partiale (TEST8c). Concurenta reala: scripts/test_sms_concurenta.sh (cluster local).
CREATE FUNCTION pg_temp.s30_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
CREATE FUNCTION pg_temp.s30_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE = p_stare;
END $h$;
CREATE FUNCTION pg_temp.s30_eroare(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $h$;
CREATE FUNCTION pg_temp.s30_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('s30.' || p, true), ''); $h$;
CREATE FUNCTION pg_temp.s30_s(p text, v text) RETURNS void LANGUAGE sql AS $h$ SELECT set_config('s30.' || p, v, true); $h$;
-- lot fictiv creat direct (ca postgres): testeaza fluxul aval (aprobare, rezervare, rezultat, DLR) fara date reale
CREATE FUNCTION pg_temp.s30_lot(p_cat text, p_tels text[], p_proiect uuid) RETURNS uuid LANGUAGE plpgsql AS $h$
DECLARE v uuid;
BEGIN
  INSERT INTO public.sms_loturi (categorie, text, proiect_id, nr_destinatari, segmente, cost_estimat_eur)
  VALUES (p_cat, 'Test DRY SMS (fictiv)', p_proiect, cardinality(p_tels), 1, round(cardinality(p_tels) * 0.049, 3)) RETURNING id INTO v;
  INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
  SELECT v, u.t, CASE WHEN p_cat = 'intern' THEN 'angajat' ELSE 'detinator' END, 'fictiv-' || u.o FROM unnest(p_tels) WITH ORDINALITY AS u(t, o);
  RETURN v;
END $h$;
CREATE FUNCTION pg_temp.s30_ver(p_lot uuid) RETURNS integer LANGUAGE sql STABLE AS $h$ SELECT versiune FROM public.sms_loturi WHERE id = p_lot; $h$;
CREATE FUNCTION pg_temp.s30_vs() RETURNS integer LANGUAGE sql STABLE AS $h$ SELECT versiune FROM public.sms_setari WHERE id; $h$;
CREATE FUNCTION pg_temp.s30_msg(p_lot uuid, p_tel text) RETURNS uuid LANGUAGE sql STABLE AS $h$ SELECT id FROM public.sms_mesaje WHERE lot_id = p_lot AND telefon = p_tel; $h$;
GRANT EXECUTE ON FUNCTION pg_temp.s30_ca(uuid, text), pg_temp.s30_refuza(text, text), pg_temp.s30_eroare(text), pg_temp.s30_g(text), pg_temp.s30_s(text, text),
  pg_temp.s30_ver(uuid), pg_temp.s30_vs(), pg_temp.s30_msg(uuid, text) TO authenticated, anon, service_role;

-- ── TEST0: garda, identitati, starea de instalare ─────────────────────────────────────────────────────────────────────────
DO $t$
DECLARE own uuid; ed uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130a_sms_mvp:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: garda';
  END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner ORDER BY id LIMIT 1;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.module = 'redari' AND a.access_level IN ('editor', 'admin') AND p.is_owner IS NOT TRUE ORDER BY (a.access_level = 'editor') DESC, a.id LIMIT 1;
  IF own IS NULL OR ed IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati lipsa'; END IF;
  PERFORM pg_temp.s30_s('owner', own::text); PERFORM pg_temp.s30_s('editor', ed::text);
  PERFORM pg_temp.s30_s('azi', (now() AT TIME ZONE 'Europe/Bucharest')::date::text);
  PERFORM pg_temp.s30_s('ora', extract(hour FROM now() AT TIME ZONE 'Europe/Bucharest')::integer::text);
  IF NOT (SELECT kill_switch AND NOT redari_autorizat AND plafon_zi = 200 AND plafon_luna = 1500 AND versiune = 1 FROM public.sms_setari)
     OR (SELECT count(*) FROM public.sms_loturi) <> 0 THEN
    RAISE EXCEPTION 'TEST0 FAIL: starea de instalare';
  END IF;
  RAISE NOTICE 'TEST0 OK';
END $t$;

-- ── TEST1: fara scriere directa; anon si service_role nu ating nimic din UI ────────────────────────────────────────────────
SELECT pg_temp.s30_ca(NULL, 'anon');
DO $t$
DECLARE q text;
BEGIN
  FOREACH q IN ARRAY ARRAY['SELECT count(*) FROM public.sms_setari', 'SELECT count(*) FROM public.sms_loturi', 'SELECT count(*) FROM public.sms_mesaje',
      'SELECT count(*) FROM public.sms_optout', 'SELECT count(*) FROM public.sms_dlr', 'SELECT count(*) FROM public.sms_v_loturi',
      'SELECT public.fn_sms_panou()', 'SELECT public.fn_sms_e_owner()', $q$SELECT public.fn_sms_lot_intern_creeaza('x')$q$,
      'SELECT public.fn_sms_lot_destinatari(gen_random_uuid())',
      $q$SELECT public.fn_sms_rezerva(NULL, 1, 'simulator')$q$, $q$SELECT public.fn_sms_dlr_aplica('simulator', 'sim-1', true, now())$q$] LOOP
    IF NOT pg_temp.s30_refuza(q, '42501') THEN RAISE EXCEPTION 'TEST1 FAIL: anon: %', q; END IF;
  END LOOP;
  RAISE NOTICE 'TEST1a OK anon';
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE q text;
BEGIN
  -- nici owner-ul nu scrie direct: doar prin RPC
  FOREACH q IN ARRAY ARRAY[
      $q$INSERT INTO public.sms_loturi (categorie, text, nr_destinatari, cost_estimat_eur) VALUES ('intern', 'x', 1, 0)$q$,
      $q$UPDATE public.sms_setari SET kill_switch = false$q$, $q$DELETE FROM public.sms_setari$q$,
      $q$INSERT INTO public.sms_optout (telefon) VALUES ('+40700000001')$q$, $q$UPDATE public.sms_mesaje SET stare = 'trimis'$q$,
      $q$INSERT INTO public.sms_dlr (furnizor, furnizor_id, status, rezultat) VALUES ('simulator', 'sim-1', 'livrat', 'aplicat')$q$,
      $q$SELECT public.fn_sms_rezerva(NULL, 1, 'simulator')$q$, $q$SELECT public.fn_sms_rezultat(gen_random_uuid(), true, 'sim-1', NULL, NULL)$q$,
      $q$SELECT public.fn_sms_dlr_aplica('simulator', 'sim-1', true, now())$q$, 'SELECT public.fn_sms_consum()', $q$SELECT public.fn_sms_text_final('x')$q$] LOOP
    IF NOT pg_temp.s30_refuza(q, '42501') THEN RAISE EXCEPTION 'TEST1 FAIL: authenticated: %', q; END IF;
  END LOOP;
  IF NOT public.fn_sms_e_owner() OR (SELECT count(*) FROM public.sms_setari) <> 1 THEN RAISE EXCEPTION 'TEST1 FAIL: owner nu se vede ca owner'; END IF;
  RAISE NOTICE 'TEST1b OK authenticated (owner) fara scriere directa';
END $t$;
SELECT pg_temp.s30_ca(NULL, 'service_role');
DO $t$
DECLARE q text;
BEGIN
  FOREACH q IN ARRAY ARRAY['SELECT count(*) FROM public.sms_loturi', $q$UPDATE public.sms_setari SET kill_switch = false$q$,
      $q$INSERT INTO public.sms_optout (telefon) VALUES ('+40700000001')$q$, 'SELECT public.fn_sms_panou()',
      $q$SELECT public.fn_sms_lot_intern_creeaza('x')$q$, $q$SELECT public.fn_sms_setari_salveaza(false, 200, 1500, 1)$q$,
      $q$SELECT public.fn_sms_redari_autorizare_seteaza(true, 'X', current_date, 1)$q$] LOOP
    IF NOT pg_temp.s30_refuza(q, '42501') THEN RAISE EXCEPTION 'TEST1 FAIL: service_role: %', q; END IF;
  END LOOP;
  RAISE NOTICE 'TEST1c OK service_role doar pe cele 3 RPC de edge';
END $t$;

-- ── TEST2: contul non-owner (chiar cu modulul redari) e refuzat de fiecare RPC si nu vede nimic ───────────────────────────
SELECT pg_temp.s30_ca(pg_temp.s30_g('editor')::uuid, 'authenticated');
DO $t$
DECLARE q text;
BEGIN
  IF public.fn_sms_e_owner() THEN RAISE EXCEPTION 'TEST2 FAIL: non-owner vazut ca owner'; END IF;
  IF (SELECT count(*) FROM public.sms_setari) <> 0 THEN RAISE EXCEPTION 'TEST2 FAIL: non-owner vede setarile'; END IF;
  FOREACH q IN ARRAY ARRAY['SELECT public.fn_sms_panou()', 'SELECT count(*) FROM public.fn_sms_angajati_lista()',
      $q$SELECT public.fn_sms_lot_intern_creeaza('Test DRY', NULL, NULL, true)$q$, $q$SELECT public.fn_sms_lot_redari_creeaza('Test DRY', gen_random_uuid(), NULL, true)$q$,
      $q$SELECT public.fn_sms_lot_aproba(gen_random_uuid(), 1)$q$, $q$SELECT public.fn_sms_lot_anuleaza(gen_random_uuid(), 'x')$q$,
      $q$SELECT public.fn_sms_lot_destinatari(gen_random_uuid())$q$,
      $q$SELECT public.fn_sms_setari_salveaza(false, 200, 1500, 1)$q$, $q$SELECT public.fn_sms_redari_autorizare_seteaza(true, 'X', current_date, 1)$q$,
      $q$SELECT public.fn_sms_optout_seteaza('0700000001', true, 'x')$q$] LOOP
    IF NOT pg_temp.s30_refuza(q, '42501') THEN RAISE EXCEPTION 'TEST2 FAIL: non-owner: %', q; END IF;
  END LOOP;
  RAISE NOTICE 'TEST2 OK non-owner refuzat';
END $t$;

-- ── TEST3: textul si telefonul (aceleasi cazuri ca src/sms/smsText.test.js) ───────────────────────────────────────────────
SELECT pg_temp.s30_ca(NULL, 'postgres');
DO $t$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('Ședință mâine la 7:00, țineți „aproape”!', 'Sedinta maine la 7:00, tineti ' || chr(39) || 'aproape' || chr(39) || '!'),
      ('Îți mulțumim — Gazpet', 'Iti multumim - Gazpet'),
      ('  doua   spatii' || chr(10) || 'rand nou' || chr(9) || ' ', 'doua spatii rand nou'),
      ('Așa… ok', 'Asa... ok'),
      ('ş ţ Ş Ţ ă Â î', 's t S T a A i')) AS v(intrare, asteptat) LOOP
    IF public.fn_sms_text_final(r.intrare) IS DISTINCT FROM r.asteptat THEN RAISE EXCEPTION 'TEST3 FAIL: text final pentru %', r.asteptat; END IF;
  END LOOP;
  IF (SELECT lungime FROM public.fn_sms_text_verifica('Pret 5' || chr(8364) || ' [lot]')) <> 16 THEN RAISE EXCEPTION 'TEST3 FAIL: lungime cu caractere extinse'; END IF;
  IF (SELECT nepermise FROM public.fn_sms_text_verifica('Salut ' || chr(128512))) IS DISTINCT FROM chr(128512) THEN RAISE EXCEPTION 'TEST3 FAIL: emoji nedetectat'; END IF;
  IF (SELECT segmente FROM public.fn_sms_text_verifica(repeat('a', 160))) <> 1 OR (SELECT segmente FROM public.fn_sms_text_verifica(repeat('a', 161))) <> 2 THEN
    RAISE EXCEPTION 'TEST3 FAIL: segmente';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('0700 000 001'), ('+40 700-000-001'), ('0040700000001'), ('700000001'), ('(0700) 000.001'), ('40700000001')) AS v(t) LOOP
    IF public.fn_sms_tel_normalizat(r.t) IS DISTINCT FROM '+40700000001' THEN RAISE EXCEPTION 'TEST3 FAIL: telefon %', r.t; END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES ('0210000000'), ('07000'), ('+40800000000'), (''), ('070000000012'), ('07OO000001')) AS v(t) LOOP
    IF public.fn_sms_tel_normalizat(r.t) IS NOT NULL THEN RAISE EXCEPTION 'TEST3 FAIL: telefon invalid acceptat %', r.t; END IF;
  END LOOP;
  IF public.fn_sms_tel_normalizat(NULL) IS NOT NULL THEN RAISE EXCEPTION 'TEST3 FAIL: NULL'; END IF;
  RAISE NOTICE 'TEST3a OK text + telefon';
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE q text;
BEGIN
  FOREACH q IN ARRAY ARRAY[$q$SELECT public.fn_sms_lot_intern_creeaza('   ')$q$, $q$SELECT public.fn_sms_lot_intern_creeaza(NULL)$q$,
      $q$SELECT public.fn_sms_lot_intern_creeaza(repeat('a', 161))$q$, $q$SELECT public.fn_sms_lot_intern_creeaza(repeat('a', 159) || chr(8364))$q$,
      $q$SELECT public.fn_sms_lot_intern_creeaza('Salut ' || chr(128512))$q$, $q$SELECT public.fn_sms_lot_intern_creeaza('Test', NULL, ARRAY[-1], true)$q$,
      $q$SELECT public.fn_sms_lot_intern_creeaza('Test', ARRAY['DEPARTAMENT-INEXISTENT-DRY'], NULL, true)$q$] LOOP
    IF NOT pg_temp.s30_refuza(q, '22023') THEN RAISE EXCEPTION 'TEST3 FAIL: text / selectie invalida acceptata: %', q; END IF;
  END LOOP;
  RAISE NOTICE 'TEST3b OK refuzuri de text / selectie';
END $t$;

-- ── TEST4: lot intern din angajatii reali (doar numaratori): previzualizare, creare, imutabilitate, aprobare owner, anulare ──
SELECT pg_temp.s30_ca(NULL, 'postgres');
DO $t$
BEGIN
  PERFORM pg_temp.s30_s('n_asteptat', (SELECT count(DISTINCT public.fn_sms_tel_normalizat(e.telefon)) FROM public.employees e
                                         WHERE e.active IS TRUE AND public.fn_sms_tel_normalizat(e.telefon) IS NOT NULL)::text);
  PERFORM pg_temp.s30_s('n_activi', (SELECT count(*) FROM public.employees e WHERE e.active IS TRUE)::text);
  IF pg_temp.s30_g('n_asteptat')::integer < 1 THEN RAISE EXCEPTION 'TEST4 FAIL: niciun angajat activ cu mobil (fixture)'; END IF;
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb; v_lot uuid;
BEGIN
  j := public.fn_sms_lot_intern_creeaza('Ședință generală mâine, ora 8:00, la sediu.');
  IF j->>'lot_id' IS NOT NULL OR (j->>'preview')::boolean IS NOT TRUE OR (j->>'nr_destinatari')::integer <> pg_temp.s30_g('n_asteptat')::integer
     OR (j->>'candidati')::integer <> pg_temp.s30_g('n_activi')::integer OR j->>'text_final' <> 'Sedinta generala maine, ora 8:00, la sediu.'
     OR (j->>'cost_estimat_eur')::numeric <> round((j->>'nr_destinatari')::integer * 0.049, 3) OR (j->>'segmente')::integer <> 1 THEN
    RAISE EXCEPTION 'TEST4 FAIL: previzualizare %', j - 'text_final';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sms_loturi) THEN RAISE EXCEPTION 'TEST4 FAIL: previzualizarea a scris'; END IF;
  j := public.fn_sms_lot_intern_creeaza('Ședință generală mâine, ora 8:00, la sediu.', NULL, NULL, false);
  v_lot := (j->>'lot_id')::uuid;
  PERFORM pg_temp.s30_s('lot_real', v_lot::text);
  IF v_lot IS NULL OR (SELECT count(*) FROM public.sms_mesaje WHERE lot_id = v_lot AND stare = 'in_coada') <> pg_temp.s30_g('n_asteptat')::integer
     OR (SELECT stare <> 'draft' OR creat_de IS DISTINCT FROM pg_temp.s30_g('owner')::uuid OR categorie <> 'intern' OR text <> j->>'text_final'
           FROM public.sms_loturi WHERE id = v_lot) THEN
    RAISE EXCEPTION 'TEST4 FAIL: creare';
  END IF;
  IF NOT pg_temp.s30_refuza(format('SELECT public.fn_sms_lot_aproba(%L, 99)', v_lot), '40001') THEN RAISE EXCEPTION 'TEST4 FAIL: aprobare pe alta versiune'; END IF;
  -- lista FIXATA in lot, vazuta inainte de aprobare: exact mesajele din sms_mesaje, cu nume si telefon mascat, plus versiunea
  j := public.fn_sms_lot_destinatari(v_lot);
  IF (j->>'versiune')::integer <> 1 OR jsonb_array_length(j->'destinatari') <> pg_temp.s30_g('n_asteptat')::integer
     OR j->>'text' <> 'Sedinta generala maine, ora 8:00, la sediu.' OR (j->>'segmente')::integer <> 1 OR (j->>'lungime')::integer <> 43
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(j->'destinatari') e
                 WHERE e->>'telefon_mascat' !~ '^07[*]{2} [*]{3} [0-9]{3}$' OR coalesce(e->>'nume', '') IN ('', '(destinatar indisponibil)')
                    OR e->>'destinatar_tip' <> 'angajat' OR e->>'stare' <> 'in_coada' OR e ? 'telefon')
     OR (SELECT count(*) FROM jsonb_array_elements(j->'destinatari') e JOIN public.sms_mesaje m ON m.id = (e->>'mesaj_id')::uuid AND m.lot_id = v_lot)
          <> pg_temp.s30_g('n_asteptat')::integer THEN
    RAISE EXCEPTION 'TEST4 FAIL: lista fixata a lotului';
  END IF;
  RAISE NOTICE 'TEST4a OK previzualizare + creare + lista fixata (% destinatari)', jsonb_array_length(j->'destinatari');
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('editor')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.s30_refuza(format('SELECT public.fn_sms_lot_aproba(%L, 1)', pg_temp.s30_g('lot_real')), '42501') THEN RAISE EXCEPTION 'TEST4 FAIL: non-owner aproba'; END IF;
  IF NOT pg_temp.s30_refuza(format('SELECT public.fn_sms_lot_destinatari(%L)', pg_temp.s30_g('lot_real')), '42501') THEN RAISE EXCEPTION 'TEST4 FAIL: non-owner vede lista'; END IF;
  RAISE NOTICE 'TEST4b OK non-owner nu aproba si nu vede lista';
END $t$;
SELECT pg_temp.s30_ca(NULL, 'postgres');
DO $t$ BEGIN
  -- nici mentenanta (postgres fara JWT de owner) nu aproba si nu schimba continutul
  IF NOT pg_temp.s30_refuza(format($q$UPDATE public.sms_loturi SET stare = 'aprobat' WHERE id = %L$q$, pg_temp.s30_g('lot_real')), '42501') THEN RAISE EXCEPTION 'TEST4 FAIL: postgres aproba'; END IF;
  IF NOT pg_temp.s30_refuza(format($q$UPDATE public.sms_loturi SET text = 'Alt text' WHERE id = %L$q$, pg_temp.s30_g('lot_real')), '23514') THEN RAISE EXCEPTION 'TEST4 FAIL: text schimbat'; END IF;
  IF NOT pg_temp.s30_refuza(format($q$UPDATE public.sms_mesaje SET telefon = '+40700000999' WHERE lot_id = %L$q$, pg_temp.s30_g('lot_real')), '23514') THEN RAISE EXCEPTION 'TEST4 FAIL: destinatar schimbat'; END IF;
  RAISE NOTICE 'TEST4c OK continut imuabil, aprobarea doar owner';
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb; v_lot uuid := pg_temp.s30_g('lot_real')::uuid;
BEGIN
  j := public.fn_sms_lot_aproba(v_lot, 1);
  IF (SELECT stare <> 'aprobat' OR aprobat_de IS DISTINCT FROM pg_temp.s30_g('owner')::uuid OR aprobat_la IS NULL OR versiune <> 2 FROM public.sms_loturi WHERE id = v_lot) THEN
    RAISE EXCEPTION 'TEST4 FAIL: aprobare owner';
  END IF;
  IF NOT pg_temp.s30_refuza(format('SELECT public.fn_sms_lot_aproba(%L, 2)', v_lot), '23514') THEN RAISE EXCEPTION 'TEST4 FAIL: dubla aprobare'; END IF;
  j := public.fn_sms_lot_anuleaza(v_lot, 'DRY');
  IF (j->>'mesaje_anulate')::integer <> pg_temp.s30_g('n_asteptat')::integer OR (j->>'deja_predate')::integer <> 0
     OR (SELECT stare <> 'anulat' OR anulat_de IS DISTINCT FROM pg_temp.s30_g('owner')::uuid OR motiv_anulare <> 'DRY' FROM public.sms_loturi WHERE id = v_lot)
     OR EXISTS (SELECT 1 FROM public.sms_mesaje WHERE lot_id = v_lot AND (stare <> 'anulat' OR cod_eroare <> 'lot_anulat')) THEN
    RAISE EXCEPTION 'TEST4 FAIL: anulare';
  END IF;
  IF NOT pg_temp.s30_refuza(format($q$SELECT public.fn_sms_lot_anuleaza(%L, 'x')$q$, v_lot), '23514') THEN RAISE EXCEPTION 'TEST4 FAIL: anulare dubla'; END IF;
  RAISE NOTICE 'TEST4d OK aprobare owner + anulare';
END $t$;

-- ── TEST5: kill-switch, opt-out (la creare si la trimitere), plafoane zi / luna ─────────────────────────────────────────────
SELECT pg_temp.s30_ca(NULL, 'postgres');
DO $t$ BEGIN
  PERFORM pg_temp.s30_s('L1', pg_temp.s30_lot('intern', ARRAY['+40700000001', '+40700000002', '+40700000003', '+40700000004'], NULL)::text);
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_optout_seteaza('0700 000 002', true, 'cerut (DRY)');
  IF j->>'telefon_mascat' <> '07** *** 002' OR NOT (SELECT activ FROM public.sms_optout WHERE telefon = '+40700000002') THEN RAISE EXCEPTION 'TEST5 FAIL: opt-out'; END IF;
  IF NOT pg_temp.s30_refuza($q$SELECT public.fn_sms_optout_seteaza('0210000000', true)$q$, '22023') THEN RAISE EXCEPTION 'TEST5 FAIL: opt-out pe numar invalid'; END IF;
  PERFORM public.fn_sms_lot_aproba(pg_temp.s30_g('L1')::uuid, 1);
  RAISE NOTICE 'TEST5a OK opt-out + aprobare L1';
END $t$;
SELECT pg_temp.s30_ca(NULL, 'service_role');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_rezerva(pg_temp.s30_g('L1')::uuid, 5, 'simulator');
  IF j->>'motiv' <> 'kill_switch' OR jsonb_array_length(j->'mesaje') <> 0 THEN RAISE EXCEPTION 'TEST5 FAIL: kill-switch la instalare %', j->>'motiv'; END IF;
  IF NOT pg_temp.s30_refuza(format($q$SELECT public.fn_sms_rezerva(%L, 5, 'altul')$q$, pg_temp.s30_g('L1')), '22023')
     OR NOT pg_temp.s30_refuza(format($q$SELECT public.fn_sms_rezerva(%L, 500, 'simulator')$q$, pg_temp.s30_g('L1')), '22023') THEN
    RAISE EXCEPTION 'TEST5 FAIL: argumente de rezervare';
  END IF;
  RAISE NOTICE 'TEST5b OK kill-switch oprit la instalare';
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  IF NOT pg_temp.s30_refuza(format('SELECT public.fn_sms_setari_salveaza(false, 2, 1, %s)', pg_temp.s30_vs()), '22023') THEN RAISE EXCEPTION 'TEST5 FAIL: plafon zi > luna'; END IF;
  IF NOT pg_temp.s30_refuza('SELECT public.fn_sms_setari_salveaza(false, 2, 1500, 999)', '40001') THEN RAISE EXCEPTION 'TEST5 FAIL: setari pe alta versiune'; END IF;
  j := public.fn_sms_setari_salveaza(false, (public.fn_sms_panou()->>'consum_zi')::integer + 2, 1500, pg_temp.s30_vs());
  IF (j->>'kill_switch')::boolean OR j->>'kill_motiv' IS NOT NULL THEN RAISE EXCEPTION 'TEST5 FAIL: pornire'; END IF;
  RAISE NOTICE 'TEST5c OK trimiterea pornita de owner, plafon zi = consum + 2';
END $t$;
SELECT pg_temp.s30_ca(NULL, 'service_role');
DO $t$
DECLARE j jsonb; v_lot uuid := pg_temp.s30_g('L1')::uuid;
BEGIN
  j := public.fn_sms_rezerva(v_lot, 5, 'simulator');
  IF j->>'motiv' <> 'ok' OR jsonb_array_length(j->'mesaje') <> 2 OR (j->>'ramase')::integer <> 1 OR j->>'text' <> 'Test DRY SMS (fictiv)'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(j->'mesaje') e WHERE e->>'telefon' = '+40700000002') THEN
    RAISE EXCEPTION 'TEST5 FAIL: rezervare sub plafon (%, %)', j->>'motiv', jsonb_array_length(j->'mesaje');
  END IF;
  j := public.fn_sms_rezerva(v_lot, 5, 'simulator');
  IF j->>'motiv' <> 'plafon_zi' OR jsonb_array_length(j->'mesaje') <> 0 THEN RAISE EXCEPTION 'TEST5 FAIL: plafon zi (%)', j->>'motiv'; END IF;
  RAISE NOTICE 'TEST5d OK rezervare atomica sub plafonul zilnic';
END $t$;
SELECT pg_temp.s30_ca(NULL, 'postgres');
DO $t$
DECLARE v_lot uuid := pg_temp.s30_g('L1')::uuid;
BEGIN
  IF (SELECT stare <> 'anulat' OR cod_eroare <> 'optout' OR rezervat_la IS NOT NULL FROM public.sms_mesaje WHERE lot_id = v_lot AND telefon = '+40700000002')
     OR (SELECT count(*) FROM public.sms_mesaje WHERE lot_id = v_lot AND stare = 'necunoscut' AND furnizor = 'simulator' AND rezervat_la IS NOT NULL) <> 2
     OR (SELECT stare FROM public.sms_loturi WHERE id = v_lot) <> 'in_trimitere' THEN
    RAISE EXCEPTION 'TEST5 FAIL: opt-out la trimitere / stari dupa rezervare';
  END IF;
  RAISE NOTICE 'TEST5d2 OK opt-out verificat din nou la trimitere (numarul nu pleaca), lot in trimitere';
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$ BEGIN
  PERFORM public.fn_sms_setari_salveaza(false, (public.fn_sms_panou()->>'consum_luna')::integer, (public.fn_sms_panou()->>'consum_luna')::integer, pg_temp.s30_vs());
END $t$;
SELECT pg_temp.s30_ca(NULL, 'service_role');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_rezerva(pg_temp.s30_g('L1')::uuid, 5, 'simulator');
  IF j->>'motiv' <> 'plafon_luna' THEN RAISE EXCEPTION 'TEST5 FAIL: plafon luna (%)', j->>'motiv'; END IF;
  RAISE NOTICE 'TEST5e OK plafon lunar';
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$ BEGIN
  PERFORM public.fn_sms_setari_salveaza(false, (public.fn_sms_panou()->>'consum_zi')::integer + 3, 1500, pg_temp.s30_vs());
END $t$;
SELECT pg_temp.s30_ca(NULL, 'service_role');
DO $t$
DECLARE j jsonb; v_lot uuid := pg_temp.s30_g('L1')::uuid;
BEGIN
  j := public.fn_sms_rezerva(v_lot, 5, 'simulator');
  IF j->>'motiv' <> 'ok' OR jsonb_array_length(j->'mesaje') <> 1 OR (j->>'ramase')::integer <> 0 THEN RAISE EXCEPTION 'TEST5 FAIL: ultimul mesaj'; END IF;
  j := public.fn_sms_rezerva(v_lot, 5, 'simulator');
  IF j->>'motiv' <> 'lot_coada_golita' THEN RAISE EXCEPTION 'TEST5 FAIL: lot cu coada golita (%)', j->>'motiv'; END IF;
  RAISE NOTICE 'TEST5f OK lotul se inchide cand coada e goala';
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_setari_salveaza(true, 200, 1500, pg_temp.s30_vs());
  IF NOT (j->>'kill_switch')::boolean OR j->>'kill_motiv' <> 'oprit de owner' THEN RAISE EXCEPTION 'TEST5 FAIL: oprire owner'; END IF;
  RAISE NOTICE 'TEST5g OK oprire de owner';
END $t$;

-- ── TEST6: rezultatul trimiterii si DLR-ul (monoton, deduplicat, nu porneste nimic) ────────────────────────────────────────
SELECT pg_temp.s30_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF (SELECT stare <> 'coada_golita' OR coada_golita_la IS NULL FROM public.sms_loturi WHERE id = pg_temp.s30_g('L1')::uuid)
     OR (SELECT count(*) FROM public.sms_mesaje WHERE lot_id = pg_temp.s30_g('L1')::uuid AND stare = 'necunoscut') <> 3 THEN
    RAISE EXCEPTION 'TEST6 FAIL: pregatire (lot cu coada golita, 3 mesaje in zbor — necunoscut, nu „trimis”)';
  END IF;
  PERFORM pg_temp.s30_s('m1', pg_temp.s30_msg(pg_temp.s30_g('L1')::uuid, '+40700000001')::text);
  PERFORM pg_temp.s30_s('m3', pg_temp.s30_msg(pg_temp.s30_g('L1')::uuid, '+40700000003')::text);
  PERFORM pg_temp.s30_s('m4', pg_temp.s30_msg(pg_temp.s30_g('L1')::uuid, '+40700000004')::text);
END $t$;
SELECT pg_temp.s30_ca(NULL, 'service_role');
DO $t$
DECLARE m1 uuid := pg_temp.s30_g('m1')::uuid; m3 uuid := pg_temp.s30_g('m3')::uuid; m4 uuid := pg_temp.s30_g('m4')::uuid; v_r text;
BEGIN
  IF NOT pg_temp.s30_refuza('SELECT count(*) FROM public.sms_mesaje', '42501') THEN RAISE EXCEPTION 'TEST6 FAIL: service_role citeste sms_mesaje'; END IF;
  -- rezultatul vine si cu kill-switch-ul oprit (mesajele erau deja in zbor)
  v_r := public.fn_sms_rezultat(m1, true, 'sim-dry-1', NULL, NULL);
  IF v_r <> 'trimis' THEN RAISE EXCEPTION 'TEST6 FAIL: trimis (%)', v_r; END IF;
  IF public.fn_sms_rezultat(m1, true, 'sim-dry-x', NULL, NULL) <> 'ignorat' THEN RAISE EXCEPTION 'TEST6 FAIL: rezultat dublu'; END IF;
  IF public.fn_sms_dlr_aplica('simulator', 'sim-dry-1', true, now()) <> 'aplicat' THEN RAISE EXCEPTION 'TEST6 FAIL: DLR livrat'; END IF;
  IF public.fn_sms_dlr_aplica('simulator', 'sim-dry-1', true, now()) <> 'duplicat' THEN RAISE EXCEPTION 'TEST6 FAIL: DLR duplicat'; END IF;
  IF public.fn_sms_dlr_aplica('simulator', 'sim-dry-1', false, now()) <> 'ignorat' THEN RAISE EXCEPTION 'TEST6 FAIL: DLR inapoi din livrat'; END IF;
  IF public.fn_sms_dlr_aplica('simulator', 'sim-dry-999', true, now()) <> 'necunoscut' THEN RAISE EXCEPTION 'TEST6 FAIL: DLR id necunoscut'; END IF;
  -- DLR sosit inaintea raspunsului de trimitere: aplicat la rezultat
  IF public.fn_sms_dlr_aplica('simulator', 'sim-dry-3', true, now()) <> 'necunoscut' THEN RAISE EXCEPTION 'TEST6 FAIL: DLR timpuriu'; END IF;
  IF public.fn_sms_rezultat(m3, true, 'sim-dry-3', NULL, NULL) <> 'trimis_livrat' THEN RAISE EXCEPTION 'TEST6 FAIL: DLR timpuriu neaplicat'; END IF;
  -- codul de eroare e doar un cod (textul furnizorului, ex. eroarea 7 cu parola, e refuzat)
  IF NOT pg_temp.s30_refuza(format($q$SELECT public.fn_sms_rezultat(%L, false, NULL, 'Password x is not approved', 'config')$q$, m4), '22023') THEN
    RAISE EXCEPTION 'TEST6 FAIL: text brut acceptat ca cod de eroare';
  END IF;
  IF NOT pg_temp.s30_refuza(format($q$SELECT public.fn_sms_rezultat(%L, false, NULL, 'smslink_7', 'altceva')$q$, m4), '22023') THEN RAISE EXCEPTION 'TEST6 FAIL: clasa'; END IF;
  IF NOT pg_temp.s30_refuza($q$SELECT public.fn_sms_dlr_aplica('simulator', 'abc def', true, now())$q$, '22023')
     OR NOT pg_temp.s30_refuza($q$SELECT public.fn_sms_dlr_aplica('alt', 'sim-1', true, now())$q$, '22023') THEN
    RAISE EXCEPTION 'TEST6 FAIL: DLR invalid acceptat';
  END IF;
  IF NOT pg_temp.s30_refuza(format($q$UPDATE public.sms_mesaje SET stare = 'trimis' WHERE id = %L$q$, m4), '42501') THEN RAISE EXCEPTION 'TEST6 FAIL: service_role scrie direct'; END IF;
  RAISE NOTICE 'TEST6a OK rezultat + DLR';
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$ BEGIN
  PERFORM public.fn_sms_setari_salveaza(false, 200, 1500, pg_temp.s30_vs());
END $t$;
SELECT pg_temp.s30_ca(NULL, 'service_role');
DO $t$
DECLARE m4 uuid := pg_temp.s30_g('m4')::uuid;
BEGIN
  IF public.fn_sms_rezultat(m4, false, NULL, 'smslink_7', 'config') <> 'esuat' THEN RAISE EXCEPTION 'TEST6 FAIL: eroare de configurare'; END IF;
  IF public.fn_sms_dlr_aplica('simulator', 'sim-dry-4', true, now()) <> 'necunoscut' THEN RAISE EXCEPTION 'TEST6 FAIL: DLR pe mesaj esuat'; END IF;
  RAISE NOTICE 'TEST6b OK eroare de configurare';
END $t$;
SELECT pg_temp.s30_ca(NULL, 'postgres');
DO $t$
DECLARE v_lot uuid := pg_temp.s30_g('L1')::uuid; m1 uuid := pg_temp.s30_g('m1')::uuid; m3 uuid := pg_temp.s30_g('m3')::uuid;
BEGIN
  IF NOT (SELECT kill_switch AND kill_motiv = 'oprire automata: smslink_7' FROM public.sms_setari) THEN RAISE EXCEPTION 'TEST6 FAIL: kill-switch automat'; END IF;
  IF (SELECT stare <> 'livrat' OR livrat_la IS NULL OR furnizor_id <> 'sim-dry-1' OR trimis_la IS NULL FROM public.sms_mesaje WHERE id = m1)
     OR (SELECT stare <> 'livrat' FROM public.sms_mesaje WHERE id = m3)
     OR (SELECT stare <> 'esuat' OR cod_eroare <> 'smslink_7' FROM public.sms_mesaje WHERE lot_id = v_lot AND telefon = '+40700000004')
     OR (SELECT rezultat FROM public.sms_dlr WHERE furnizor_id = 'sim-dry-3') <> 'aplicat_tarziu'
     OR (SELECT count(*) FROM public.sms_dlr) <> 5 OR (SELECT count(*) FROM public.sms_dlr WHERE rezultat = 'necunoscut') <> 2 THEN
    RAISE EXCEPTION 'TEST6 FAIL: stari finale / jurnal';
  END IF;
  -- monoton: nimic nu se intoarce din livrat / esuat; id-ul de la furnizor nu se rescrie; nimic nu se sterge
  IF NOT pg_temp.s30_refuza(format($q$UPDATE public.sms_mesaje SET stare = 'trimis' WHERE id = %L$q$, m1), '23514')
     OR NOT pg_temp.s30_refuza(format($q$UPDATE public.sms_mesaje SET furnizor_id = 'sim-alt' WHERE id = %L$q$, m3), '23514')
     OR NOT pg_temp.s30_refuza(format($q$UPDATE public.sms_mesaje SET stare = 'in_coada' WHERE id = %L$q$, m3), '23514')
     OR NOT pg_temp.s30_refuza(format('DELETE FROM public.sms_mesaje WHERE id = %L', m1), '42501')
     OR NOT pg_temp.s30_refuza('DELETE FROM public.sms_dlr', '42501')
     OR NOT pg_temp.s30_refuza($q$UPDATE public.sms_dlr SET status = 'esuat' WHERE furnizor_id = 'sim-dry-1'$q$, '23514') THEN
    RAISE EXCEPTION 'TEST6 FAIL: tranzitii inapoi / stergere';
  END IF;
  IF (SELECT count(*) FROM public.sms_mesaje WHERE lot_id = v_lot) <> 4 THEN RAISE EXCEPTION 'TEST6 FAIL: DLR-ul a creat mesaje'; END IF;
  RAISE NOTICE 'TEST6c OK stari finale monotone, jurnal minim';
END $t$;
-- TEST6d (Jakarinos r1 P2): jurnal DLR ramas neaplicat + mesajul primit id-ul pe alta cale => DLR-ul repetat il aplica (reconciliere)
DO $t$ BEGIN
  PERFORM pg_temp.s30_s('L3', pg_temp.s30_lot('intern', ARRAY['+40700000031'], NULL)::text);
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$ BEGIN
  PERFORM public.fn_sms_lot_aproba(pg_temp.s30_g('L3')::uuid, 1);
  PERFORM public.fn_sms_setari_salveaza(false, 200, 1500, pg_temp.s30_vs());
END $t$;
SELECT pg_temp.s30_ca(NULL, 'service_role');
DO $t$ BEGIN
  IF jsonb_array_length(public.fn_sms_rezerva(pg_temp.s30_g('L3')::uuid, 5, 'simulator')->'mesaje') <> 1 THEN RAISE EXCEPTION 'TEST6d FAIL: rezervare L3'; END IF;
  IF public.fn_sms_dlr_aplica('simulator', 'sim-dry-31', true, now()) <> 'necunoscut' THEN RAISE EXCEPTION 'TEST6d FAIL: DLR inainte de id'; END IF;
END $t$;
SELECT pg_temp.s30_ca(NULL, 'postgres');
DO $t$ BEGIN
  -- simuleaza cursa pierduta: id-ul ajunge pe mesaj fara ca jurnalul sa fie aplicat
  UPDATE public.sms_mesaje SET stare = 'trimis', furnizor_id = 'sim-dry-31' WHERE lot_id = pg_temp.s30_g('L3')::uuid;
  IF (SELECT rezultat FROM public.sms_dlr WHERE furnizor_id = 'sim-dry-31') <> 'necunoscut' THEN RAISE EXCEPTION 'TEST6d FAIL: pregatire'; END IF;
END $t$;
SELECT pg_temp.s30_ca(NULL, 'service_role');
DO $t$
DECLARE v text;
BEGIN
  v := public.fn_sms_dlr_aplica('simulator', 'sim-dry-31', true, now());
  IF v <> 'reconciliat' THEN RAISE EXCEPTION 'TEST6d FAIL: DLR repetat nu a reconciliat (%)', v; END IF;
  IF public.fn_sms_dlr_aplica('simulator', 'sim-dry-31', true, now()) <> 'duplicat' THEN RAISE EXCEPTION 'TEST6d FAIL: al treilea DLR'; END IF;
  RAISE NOTICE 'TEST6d OK reconciliere la DLR repetat';
END $t$;
SELECT pg_temp.s30_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF (SELECT stare <> 'livrat' OR livrat_la IS NULL FROM public.sms_mesaje WHERE lot_id = pg_temp.s30_g('L3')::uuid)
     OR (SELECT rezultat FROM public.sms_dlr WHERE furnizor_id = 'sim-dry-31') <> 'aplicat_tarziu'
     OR (SELECT stare FROM public.sms_loturi WHERE id = pg_temp.s30_g('L3')::uuid) <> 'coada_golita' THEN
    RAISE EXCEPTION 'TEST6d FAIL: stare dupa reconciliere';
  END IF;
  RAISE NOTICE 'TEST6e OK stari dupa reconciliere';
END $t$;

-- ── TEST7: Redari — blocat in BD cat timp nu e autorizat; apoi lotul din convocari (fixture fictiv) ───────────────────────
DO $t$
DECLARE v_pr uuid; v_pr2 uuid; v_uat uuid; v_uat2 uuid; v_p uuid; d1 uuid; d2 uuid; d3 uuid; d4 uuid; d5 uuid; d6 uuid;
BEGIN
  INSERT INTO public.red_proiecte (cod, denumire, activ) VALUES ('TEST-SMS-DRY', 'Proiect test SMS (DRY, fictiv)', true) RETURNING id INTO v_pr;
  INSERT INTO public.red_proiecte (cod, denumire, activ) VALUES ('TEST-SMS-DRY-2', 'Al doilea proiect test SMS (DRY, fictiv)', false) RETURNING id INTO v_pr2;
  INSERT INTO public.red_uat (proiect_id, nume, uat3, judet) VALUES (v_pr, 'UAT Test Sms', 'TSX', 'Test') RETURNING id INTO v_uat;
  INSERT INTO public.red_uat (proiect_id, nume, uat3, judet) VALUES (v_pr2, 'UAT Test Sms Doi', 'TSY', 'Test') RETURNING id INTO v_uat2;
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson) VALUES (v_pr, v_uat, 'TSX-0001', 1) RETURNING id INTO v_p;
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate) VALUES (v_p, 'Test Sms Unu', 'TEST SMS UNU', 'proprietar') RETURNING id INTO d1;
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate) VALUES (v_p, 'Test Sms Doi', 'TEST SMS DOI', 'coproprietar') RETURNING id INTO d2;
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate) VALUES (v_p, 'Test Sms Trei', 'TEST SMS TREI', 'coproprietar') RETURNING id INTO d3;
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate) VALUES (v_p, 'Test Sms Patru', 'TEST SMS PATRU', 'coproprietar') RETURNING id INTO d4;
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate, decedat) VALUES (v_p, 'Test Sms Cinci', 'TEST SMS CINCI', 'coproprietar', true) RETURNING id INTO d5;
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate) VALUES (v_p, 'Test Sms Sase', 'TEST SMS SASE', 'coproprietar') RETURNING id INTO d6;
  INSERT INTO public.red_detinatori_contact (detinator_id, telefon) VALUES (d1, '0700000011'), (d2, '0700 000 012'), (d3, '+40700000011'), (d5, '0700000013'), (d6, '0700000014');
  INSERT INTO public.red_detinatori_contact (detinator_id) VALUES (d4);
  INSERT INTO public.red_convocari (detinator_id, canal) VALUES (d1, 'telefon'), (d1, 'telefon'), (d2, 'telefon'), (d3, 'telefon'), (d4, 'telefon'), (d5, 'telefon');
  INSERT INTO public.red_convocari (detinator_id, canal, stare) VALUES (d6, 'telefon', 'anulat');
  PERFORM pg_temp.s30_s('pr', v_pr::text); PERFORM pg_temp.s30_s('uat', v_uat::text); PERFORM pg_temp.s30_s('uat2', v_uat2::text);
  IF NOT pg_temp.s30_refuza(format($q$INSERT INTO public.sms_loturi (categorie, text, proiect_id, nr_destinatari, cost_estimat_eur) VALUES ('redari', 'Test', %L, 1, 0.049)$q$, v_pr), '42501') THEN
    RAISE EXCEPTION 'TEST7 FAIL: lot redari creat direct fara autorizare';
  END IF;
  RAISE NOTICE 'TEST7a OK fixture fictiv + insert direct redari refuzat';
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE e text;
BEGIN
  e := pg_temp.s30_eroare(format($q$SELECT public.fn_sms_lot_redari_creeaza('Reamintire sesiune (DRY)', %L, NULL, true)$q$, pg_temp.s30_g('pr')));
  IF e IS NULL OR e NOT LIKE '42501%autorizarea scrisa Transgaz%' THEN RAISE EXCEPTION 'TEST7 FAIL: redari neautorizat acceptat / mesaj (%)', e; END IF;
  IF NOT pg_temp.s30_refuza(format($q$SELECT public.fn_sms_lot_redari_creeaza('Reamintire sesiune (DRY)', %L, NULL, false)$q$, pg_temp.s30_g('pr')), '42501') THEN
    RAISE EXCEPTION 'TEST7 FAIL: creare redari neautorizat';
  END IF;
  IF NOT pg_temp.s30_refuza(format('SELECT public.fn_sms_redari_autorizare_seteaza(true, NULL, NULL, %s)', pg_temp.s30_vs()), '22023')
     OR NOT pg_temp.s30_refuza(format($q$SELECT public.fn_sms_redari_autorizare_seteaza(true, 'TGZ-DRY-1', %L::date + 1, %s)$q$, pg_temp.s30_g('azi'), pg_temp.s30_vs()), '22023') THEN
    RAISE EXCEPTION 'TEST7 FAIL: autorizare fara nr / data sau in viitor';
  END IF;
  RAISE NOTICE 'TEST7b OK redari refuzat cat nu e autorizat (mesaj clar)';
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('editor')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.s30_refuza(format($q$SELECT public.fn_sms_redari_autorizare_seteaza(true, 'TGZ-DRY-1', %L::date, %s)$q$, pg_temp.s30_g('azi'), 9), '42501') THEN
    RAISE EXCEPTION 'TEST7 FAIL: non-owner autorizeaza redari';
  END IF;
  RAISE NOTICE 'TEST7c OK doar owner-ul autorizeaza';
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_redari_autorizare_seteaza(true, ' TGZ-DRY-1 ', pg_temp.s30_g('azi')::date, pg_temp.s30_vs());
  IF NOT (j->>'redari_autorizat')::boolean OR j->>'redari_autorizare_nr' <> 'TGZ-DRY-1' THEN RAISE EXCEPTION 'TEST7 FAIL: autorizare'; END IF;
  PERFORM public.fn_sms_optout_seteaza('0700000012', true, NULL);
  j := public.fn_sms_lot_redari_creeaza('Reamintire: sesiunea de redare e mâine la primărie.', pg_temp.s30_g('pr')::uuid, NULL, true);
  IF (j->>'nr_destinatari')::integer <> 1 OR (j->>'candidati')::integer <> 4 OR (j->>'excluse_optout')::integer <> 1
     OR (j->>'excluse_fara_mobil')::integer <> 1 OR (j->>'excluse_duplicat')::integer <> 1 OR j->>'lot_id' IS NOT NULL THEN
    RAISE EXCEPTION 'TEST7 FAIL: destinatari redari %', j - 'text_final';
  END IF;
  IF NOT pg_temp.s30_refuza(format($q$SELECT public.fn_sms_lot_redari_creeaza('Test', %L, %L, true)$q$, pg_temp.s30_g('pr'), pg_temp.s30_g('uat2')), '22023') THEN
    RAISE EXCEPTION 'TEST7 FAIL: UAT din alt proiect';
  END IF;
  j := public.fn_sms_lot_redari_creeaza('Reamintire: sesiunea de redare e mâine la primărie.', pg_temp.s30_g('pr')::uuid, pg_temp.s30_g('uat')::uuid, false);
  PERFORM pg_temp.s30_s('R1', j->>'lot_id');
  IF (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = (j->>'lot_id')::uuid AND m.telefon = '+40700000011' AND m.destinatar_tip = 'detinator') <> 1
     OR (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = (j->>'lot_id')::uuid) <> 1
     OR (SELECT categorie <> 'redari' OR uat_id IS DISTINCT FROM pg_temp.s30_g('uat')::uuid FROM public.sms_loturi WHERE id = (j->>'lot_id')::uuid) THEN
    RAISE EXCEPTION 'TEST7 FAIL: lot redari creat';
  END IF;
  j := public.fn_sms_lot_destinatari(pg_temp.s30_g('R1')::uuid);
  IF jsonb_array_length(j->'destinatari') <> 1 OR j->>'categorie' <> 'redari'
     OR (j->'destinatari'->0->>'nume') NOT IN ('Test Sms Unu', 'Test Sms Trei') OR j->'destinatari'->0->>'telefon_mascat' <> '07** *** 011'
     OR j->'destinatari'->0->>'destinatar_tip' <> 'detinator' THEN
    RAISE EXCEPTION 'TEST7 FAIL: lista fixata redari';
  END IF;
  j := public.fn_sms_lot_redari_creeaza('Al doilea lot (DRY).', pg_temp.s30_g('pr')::uuid, NULL, false);
  PERFORM pg_temp.s30_s('R2', j->>'lot_id');
  j := public.fn_sms_lot_aproba(pg_temp.s30_g('R1')::uuid, 1);
  IF j->>'aprobat_autorizare_nr' <> 'TGZ-DRY-1' OR (SELECT aprobat_autorizare_data FROM public.sms_loturi WHERE id = pg_temp.s30_g('R1')::uuid) <> pg_temp.s30_g('azi')::date THEN
    RAISE EXCEPTION 'TEST7 FAIL: referinta autorizarii pe lotul aprobat';
  END IF;
  -- autorizarea retrasa: nu se mai aproba si nu mai pleaca nimic
  PERFORM public.fn_sms_redari_autorizare_seteaza(false, NULL, NULL, pg_temp.s30_vs());
  IF NOT pg_temp.s30_refuza(format('SELECT public.fn_sms_lot_aproba(%L, 1)', pg_temp.s30_g('R2')), '42501') THEN RAISE EXCEPTION 'TEST7 FAIL: aprobare redari dupa retragere'; END IF;
  PERFORM public.fn_sms_setari_salveaza(false, 200, 1500, pg_temp.s30_vs());
  RAISE NOTICE 'TEST7d OK lot redari din convocari (dedup, opt-out, fara mobil, decedat, convocare anulata)';
END $t$;
SELECT pg_temp.s30_ca(NULL, 'service_role');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_rezerva(pg_temp.s30_g('R1')::uuid, 5, 'simulator');
  IF j->>'motiv' <> 'redari_neautorizat' OR jsonb_array_length(j->'mesaje') <> 0 THEN RAISE EXCEPTION 'TEST7 FAIL: rezervare redari neautorizat (%)', j->>'motiv'; END IF;
  -- cronul (fara lot) nu ia loturi redari neautorizate
  j := public.fn_sms_rezerva(NULL, 5, 'simulator');
  IF j->>'motiv' <> 'fara_lot' THEN RAISE EXCEPTION 'TEST7 FAIL: cron pe redari neautorizat (%)', j->>'motiv'; END IF;
  RAISE NOTICE 'TEST7e OK trimitere redari refuzata dupa retragerea autorizarii';
END $t$;
SELECT pg_temp.s30_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF NOT pg_temp.s30_refuza(format($q$UPDATE public.sms_mesaje SET stare = 'necunoscut', furnizor = 'simulator' WHERE lot_id = %L$q$, pg_temp.s30_g('R1')), '23514') THEN
    RAISE EXCEPTION 'TEST7 FAIL: mesaj redari rezervat direct (lot neinceput)';
  END IF;
  RAISE NOTICE 'TEST7f OK triggerul mesajelor tine regula si fara RPC';
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$ BEGIN
  PERFORM public.fn_sms_redari_autorizare_seteaza(true, 'TGZ-DRY-1', pg_temp.s30_g('azi')::date, pg_temp.s30_vs());
END $t$;
SELECT pg_temp.s30_ca(NULL, 'service_role');
DO $t$
DECLARE j jsonb; v_ora integer := pg_temp.s30_g('ora')::integer;
BEGIN
  j := public.fn_sms_rezerva(pg_temp.s30_g('R1')::uuid, 5, 'simulator');
  IF v_ora BETWEEN 8 AND 19 THEN
    IF j->>'motiv' <> 'ok' OR jsonb_array_length(j->'mesaje') <> 1 THEN RAISE EXCEPTION 'TEST7 FAIL: redari autorizat in ore (%)', j->>'motiv'; END IF;
  ELSIF j->>'motiv' <> 'in_afara_orelor' THEN
    RAISE EXCEPTION 'TEST7 FAIL: redari in afara orelor 08-20 (%)', j->>'motiv';
  END IF;
  RAISE NOTICE 'TEST7g OK redari autorizat (ora %: %)', v_ora, j->>'motiv';
END $t$;

-- ── TEST8: tranzitiile loturilor si continutul (ca postgres: triggerele tin si fara RPC) ───────────────────────────────────
SELECT pg_temp.s30_ca(NULL, 'postgres');
DO $t$
DECLARE v_l2 uuid;
BEGIN
  v_l2 := pg_temp.s30_lot('intern', ARRAY['+40700000021'], NULL);
  PERFORM pg_temp.s30_s('L2', v_l2::text);
  IF NOT pg_temp.s30_refuza(format($q$UPDATE public.sms_loturi SET stare = 'coada_golita' WHERE id = %L$q$, v_l2), '23514')
     OR NOT pg_temp.s30_refuza(format($q$UPDATE public.sms_loturi SET stare = 'trimis' WHERE id = %L$q$, v_l2), '23514')
     OR NOT pg_temp.s30_refuza(format($q$UPDATE public.sms_loturi SET stare = 'in_trimitere' WHERE id = %L$q$, v_l2), '23514')
     OR NOT pg_temp.s30_refuza(format($q$UPDATE public.sms_loturi SET nr_destinatari = 2 WHERE id = %L$q$, v_l2), '23514')
     OR NOT pg_temp.s30_refuza(format('DELETE FROM public.sms_loturi WHERE id = %L', v_l2), '42501')
     OR NOT pg_temp.s30_refuza($q$INSERT INTO public.sms_loturi (categorie, text, nr_destinatari, cost_estimat_eur, stare) VALUES ('intern', 'Test', 1, 0.049, 'aprobat')$q$, '23514')
     OR NOT pg_temp.s30_refuza($q$INSERT INTO public.sms_loturi (categorie, text, nr_destinatari, cost_estimat_eur) VALUES ('intern', 'Ședință', 1, 0.049)$q$, '23514')
     OR NOT pg_temp.s30_refuza(format($q$INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id) VALUES (%L, '+40700000022', 'angajat', 'x')$q$, pg_temp.s30_g('L1')), '23514')
     OR NOT pg_temp.s30_refuza(format($q$INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id, stare) VALUES (%L, '+40700000023', 'angajat', 'x', 'trimis')$q$, v_l2), '23514')
     OR NOT pg_temp.s30_refuza(format($q$INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id) VALUES (%L, '0700000024', 'angajat', 'x')$q$, v_l2), '23514')
     OR NOT pg_temp.s30_refuza($q$UPDATE public.sms_setari SET plafon_zi = 5000, plafon_luna = 50000$q$, '42501')
     OR NOT pg_temp.s30_refuza($q$UPDATE public.sms_setari SET redari_autorizat = false$q$, '42501')
     OR NOT pg_temp.s30_refuza('DELETE FROM public.sms_setari', '42501')
     OR NOT pg_temp.s30_refuza($q$INSERT INTO public.sms_optout (telefon) VALUES ('+40700000025')$q$, '42501') THEN
    RAISE EXCEPTION 'TEST8 FAIL: tranzitii / continut / setari fara owner';
  END IF;
  -- fara owner se poate doar OPRI trimiterea
  UPDATE public.sms_setari SET kill_switch = true, kill_motiv = 'mentenanta (DRY)';
  IF NOT pg_temp.s30_refuza($q$UPDATE public.sms_setari SET kill_switch = false$q$, '42501') THEN RAISE EXCEPTION 'TEST8 FAIL: pornire fara owner'; END IF;
  RAISE NOTICE 'TEST8a OK';
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$ BEGIN
  PERFORM public.fn_sms_lot_anuleaza(pg_temp.s30_g('L2')::uuid, NULL);
  IF NOT pg_temp.s30_refuza(format($q$SELECT public.fn_sms_lot_anuleaza(%L, 'x')$q$, pg_temp.s30_g('L1')), '23514') THEN RAISE EXCEPTION 'TEST8 FAIL: anulare lot cu coada golita'; END IF;
  IF NOT pg_temp.s30_refuza(format('SELECT public.fn_sms_lot_aproba(%L, 2)', pg_temp.s30_g('L2')), '23514') THEN RAISE EXCEPTION 'TEST8 FAIL: aprobare lot anulat'; END IF;
  RAISE NOTICE 'TEST8b OK loturile inchise raman inchise';
END $t$;
SELECT pg_temp.s30_ca(NULL, 'postgres');
DO $t$ BEGIN
  PERFORM pg_temp.s30_s('L4', pg_temp.s30_lot('intern', ARRAY['+40700000041', '+40700000042', '+40700000043'], NULL)::text);
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$ BEGIN
  PERFORM public.fn_sms_lot_aproba(pg_temp.s30_g('L4')::uuid, 1);
  PERFORM public.fn_sms_setari_salveaza(false, 200, 1500, pg_temp.s30_vs());
END $t$;
SELECT pg_temp.s30_ca(NULL, 'service_role');
DO $t$ BEGIN
  IF jsonb_array_length(public.fn_sms_rezerva(pg_temp.s30_g('L4')::uuid, 1, 'simulator')->'mesaje') <> 1 THEN RAISE EXCEPTION 'TEST8c FAIL: rezervare partiala'; END IF;
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE j jsonb;
BEGIN
  j := public.fn_sms_lot_anuleaza(pg_temp.s30_g('L4')::uuid, 'oprire DRY');
  IF (j->>'mesaje_anulate')::integer <> 2 OR (j->>'deja_predate')::integer <> 1 OR (j->>'deja_rezervate_necunoscut')::integer <> 1
     OR (j->>'deja_trimise')::integer <> 0 OR (SELECT count(*) FROM public.sms_mesaje WHERE lot_id = pg_temp.s30_g('L4')::uuid AND stare = 'necunoscut') <> 1 THEN
    RAISE EXCEPTION 'TEST8c FAIL: raportul anularii partiale %', j;
  END IF;
  RAISE NOTICE 'TEST8c OK anulare partiala: 2 scoase din coada, 1 deja predat (ramane necunoscut, nu se opreste)';
END $t$;

-- ── TEST9: vederea de istoric (owner) si RLS (non-owner / anon) ─────────────────────────────────────────────────────────────
DO $t$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.sms_v_loturi WHERE id = pg_temp.s30_g('L1')::uuid;
  IF r.n_livrat <> 2 OR r.n_esuat <> 1 OR r.n_anulat <> 1 OR r.n_in_coada <> 0 OR r.n_necunoscut <> 0 OR r.stare <> 'coada_golita' THEN
    RAISE EXCEPTION 'TEST9 FAIL: numaratori in vedere';
  END IF;
  IF (SELECT count(*) FROM public.fn_sms_angajati_lista()) <> pg_temp.s30_g('n_activi')::integer THEN RAISE EXCEPTION 'TEST9 FAIL: lista angajati'; END IF;
  IF EXISTS (SELECT 1 FROM public.fn_sms_angajati_lista() a WHERE a.telefon_mascat IS NOT NULL AND a.telefon_mascat !~ '^07[*]{2} [*]{3} [0-9]{3}$') THEN
    RAISE EXCEPTION 'TEST9 FAIL: telefon nemascat in lista';
  END IF;
  IF (public.fn_sms_panou()->>'consum_zi')::integer < 3 THEN RAISE EXCEPTION 'TEST9 FAIL: consum in panou'; END IF;
  RAISE NOTICE 'TEST9a OK vedere + lista mascata + panou';
END $t$;
SELECT pg_temp.s30_ca(pg_temp.s30_g('editor')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.sms_v_loturi) <> 0 OR (SELECT count(*) FROM public.sms_mesaje) <> 0 OR (SELECT count(*) FROM public.sms_optout) <> 0
     OR (SELECT count(*) FROM public.sms_dlr) <> 0 OR (SELECT count(*) FROM public.sms_loturi) <> 0 THEN
    RAISE EXCEPTION 'TEST9 FAIL: non-owner vede date SMS';
  END IF;
  RAISE NOTICE 'TEST9b OK non-owner: 0 randuri';
END $t$;
SELECT pg_temp.s30_ca(NULL, 'postgres');
