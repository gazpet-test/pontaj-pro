-- DRY LOCAL 20261130i_redari_sms_stare — DOAR pe clusterul PG17 de unica folosinta (schelet 30a + migrarea 30a + 20261130i_redari_sms_stare_schelet.sql).
-- NU se ruleaza pe productie (r2, Jakarinos NO-GO P1): fixture-ul opreste triggerele de reguli SMS (ALTER TABLE ... DISABLE TRIGGER = SHARE ROW EXCLUSIVE
-- pe sms_loturi / sms_mesaje, tinut pana la ROLLBACK). Garda TEST0: GUC gazpet.dry_local = 'DA' + profilul fictiv owner.test@exemplu.local al scheletului.
-- DRY-ul de productie (fara fixture SMS, doar citiri) e supabase/tests/20261130i_redari_sms_stare_dryrun.sql.
-- Runner local: o singura tranzactie ANULATA (marcaj + migrare + acest fisier + ROLLBACK).
-- Identitati din user_module_access (admin = owner, editor / viewer ne-owner pe modulul redari) + un profil FARA nivel Redari, simulate prin
-- request.jwt.claims + SET LOCAL ROLE; anon si authenticated fara sub.
-- Date fictive pe proiectul TEST-RAZVAN: 9 detinatori DRY30I-D1..D9 pe o parcela a proiectului + 7 loturi SMS fictive cu mesaje in toate starile
-- (telefoane +40700000xxx fictive). Triggerele SMS se opresc pe durata insertului de fixture si se repornesc; CHECK-urile si FK-urile raman active.
-- Lotul redari „real” al scheletului (imita testul lui Razvan, 1 mesaj livrat) nu se modifica: e doar citit (TEST7).
-- La final: RESET ROLE + claims goale.
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
-- randul functiei pentru un detinator fictiv (cheia = D1..D6), ca jsonb; NULL = absent
CREATE FUNCTION pg_temp.r30i_rand(p_cheie text) RETURNS jsonb LANGUAGE sql STABLE AS $h$
  SELECT to_jsonb(r) FROM public.fn_red_sms_stare(pg_temp.r30i_g('proiect')::uuid) r WHERE r.detinator_id = pg_temp.r30i_g(p_cheie)::uuid;
$h$;
-- verifica un rand: trimise, livrate, esuate, in_curs, ultima_stare, loturi, categorie
CREATE FUNCTION pg_temp.r30i_e(p_cheie text, p_tr int, p_li int, p_es int, p_ic int, p_ult text, p_lot int, p_cat text) RETURNS boolean LANGUAGE sql STABLE AS $h$
  SELECT coalesce((x->>'nr_trimise')::int = p_tr AND (x->>'nr_livrate')::int = p_li AND (x->>'nr_esuate')::int = p_es AND (x->>'nr_in_curs')::int = p_ic
         AND x->>'ultima_stare' = p_ult AND (x->>'loturi')::int = p_lot AND x->>'categorie' = p_cat, false)
    FROM (SELECT pg_temp.r30i_rand(p_cheie) AS x) s;
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.r30i_ca(uuid, text), pg_temp.r30i_refuza(text, text), pg_temp.r30i_g(text), pg_temp.r30i_rand(text),
  pg_temp.r30i_e(text, int, int, int, int, text, int, text) TO authenticated, anon, service_role;

-- TEST0: garda, identitati, proiect, fixture (ca postgres = mentenanta)
DO $t$
DECLARE ad uuid; ed uuid; vw uuid; fa uuid; pr uuid; pa uuid; alt_pr uuid; alt_det uuid; ua uuid; d uuid; i int;
        l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; l6 uuid; l7 uuid; t0 timestamptz := now() - interval '3 days';
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130i_redari_sms_stare:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: garda';
  END IF;
  -- doar local: GUC explicit + profilul fictiv al scheletului (pe productie nu exista)
  IF current_setting('gazpet.dry_local', true) IS DISTINCT FROM 'DA' OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'owner.test@exemplu.local' AND is_owner) THEN
    RAISE EXCEPTION 'TEST0 FAIL: DRY-ul local nu ruleaza decat pe clusterul de test (gazpet.dry_local + schelet)';
  END IF;
  SELECT id INTO ad FROM public.profiles WHERE is_owner ORDER BY id LIMIT 1;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.module = 'redari' AND a.access_level IN ('editor', 'admin') AND p.is_owner IS NOT TRUE ORDER BY (a.access_level = 'editor') DESC, a.id LIMIT 1;
  SELECT a.profile_id INTO vw FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.module = 'redari' AND a.access_level = 'viewer' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT p.id INTO fa FROM public.profiles p WHERE p.is_owner IS NOT TRUE
    AND NOT EXISTS (SELECT 1 FROM public.user_module_access a WHERE a.profile_id = p.id AND a.module = 'redari') ORDER BY p.id LIMIT 1;
  SELECT id INTO pr FROM public.red_proiecte WHERE cod = 'TEST-RAZVAN';
  SELECT id, uat_id INTO pa, ua FROM public.red_parcele WHERE proiect_id = pr ORDER BY id LIMIT 1;
  SELECT x.id, p.proiect_id INTO alt_det, alt_pr FROM public.red_detinatori x JOIN public.red_parcele p ON p.id = x.parcela_id WHERE p.proiect_id <> pr ORDER BY x.id LIMIT 1;
  IF ad IS NULL OR ed IS NULL OR vw IS NULL OR fa IS NULL OR pr IS NULL OR pa IS NULL OR alt_det IS NULL THEN
    RAISE EXCEPTION 'TEST0 FAIL: identitati / proiect TEST-RAZVAN / parcela / detinator din alt proiect lipsa';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_detinatori WHERE nume LIKE 'DRY30I-%') THEN RAISE EXCEPTION 'TEST0 FAIL: fixture DRY30I preexistent'; END IF;
  PERFORM set_config('r30i.admin', ad::text, true); PERFORM set_config('r30i.editor', ed::text, true); PERFORM set_config('r30i.viewer', vw::text, true);
  PERFORM set_config('r30i.fara', fa::text, true); PERFORM set_config('r30i.proiect', pr::text, true); PERFORM set_config('r30i.alt_proiect', alt_pr::text, true);
  PERFORM set_config('r30i.alt_det', alt_det::text, true);
  FOR i IN 1..9 LOOP
    INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate) VALUES (pa, 'DRY30I-D' || i, 'DRY30I-D' || i, 'proprietar') RETURNING id INTO d;
    PERFORM set_config('r30i.D' || i, d::text, true);
  END LOOP;

  ALTER TABLE public.sms_loturi DISABLE TRIGGER trg_sms_loturi_reguli;
  ALTER TABLE public.sms_mesaje DISABLE TRIGGER trg_sms_mesaje_reguli;
  INSERT INTO public.sms_loturi (categorie, text, stare, proiect_id, uat_id, nr_destinatari, cost_estimat_eur, aprobat_de, aprobat_la, aprobat_autorizare_nr, aprobat_autorizare_data, creat_la)
    VALUES ('redari', 'DRY30I lot 1', 'coada_golita', pr, ua, 5, 0, ad, t0, 'DRY-1', current_date, t0) RETURNING id INTO l1;
  INSERT INTO public.sms_loturi (categorie, text, stare, proiect_id, uat_id, nr_destinatari, cost_estimat_eur, aprobat_de, aprobat_la, aprobat_autorizare_nr, aprobat_autorizare_data, creat_la)
    VALUES ('redari', 'DRY30I lot 2', 'in_trimitere', pr, ua, 5, 0, ad, t0 + interval '1 day', 'DRY-1', current_date, t0 + interval '1 day') RETURNING id INTO l2;
  INSERT INTO public.sms_loturi (categorie, text, stare, proiect_id, nr_destinatari, cost_estimat_eur, creat_la)
    VALUES ('redari', 'DRY30I lot 3 draft', 'draft', pr, 1, 0, t0 + interval '2 days') RETURNING id INTO l3;
  INSERT INTO public.sms_loturi (categorie, text, stare, proiect_id, nr_destinatari, cost_estimat_eur, anulat_de, anulat_la, creat_la)
    VALUES ('redari', 'DRY30I lot 4 anulat', 'anulat', pr, 1, 0, ad, t0, t0) RETURNING id INTO l4;
  INSERT INTO public.sms_loturi (categorie, text, stare, nr_destinatari, cost_estimat_eur, aprobat_de, aprobat_la, creat_la)
    VALUES ('intern', 'DRY30I lot 5 intern', 'coada_golita', 1, 0, ad, t0, t0) RETURNING id INTO l5;
  INSERT INTO public.sms_loturi (categorie, text, stare, proiect_id, nr_destinatari, cost_estimat_eur, aprobat_de, aprobat_la, aprobat_autorizare_nr, aprobat_autorizare_data, creat_la)
    VALUES ('redari', 'DRY30I lot 6 alt proiect', 'coada_golita', alt_pr, 1, 0, ad, t0, 'DRY-1', current_date, t0) RETURNING id INTO l6;
  -- r2 (P2-5): lot 'aprobat' (inca nepornit) — un mesaj in coada aici e „in curs”
  INSERT INTO public.sms_loturi (categorie, text, stare, proiect_id, nr_destinatari, cost_estimat_eur, aprobat_de, aprobat_la, aprobat_autorizare_nr, aprobat_autorizare_data, creat_la)
    VALUES ('redari', 'DRY30I lot 7 aprobat', 'aprobat', pr, 1, 0, ad, t0 + interval '2 days', 'DRY-1', current_date, t0 + interval '2 days') RETURNING id INTO l7;
  INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id, stare, furnizor, furnizor_id, cod_eroare, rezervat_la, trimis_la, livrat_la, creat_la) VALUES
    -- D1: livrat in L1 + trimis (fara confirmare) in L2 -> trimise 2, livrate 1, ultima trimis, categorie livrat, loturi 2
    (l1, '+40700000901', 'detinator', pg_temp.r30i_g('D1'), 'livrat', 'simulator', 'dry30i-1', NULL, t0, t0 + interval '1 minute', t0 + interval '2 minutes', t0),
    (l2, '+40700000901', 'detinator', pg_temp.r30i_g('D1'), 'trimis', 'simulator', 'dry30i-2', NULL, t0 + interval '1 day', t0 + interval '1 day 1 minute', NULL, t0 + interval '1 day'),
    -- D2: trimis de doua ori, nicio livrare -> trimise 2, categorie trimis
    (l1, '+40700000902', 'detinator', pg_temp.r30i_g('D2'), 'trimis', 'simulator', 'dry30i-3', NULL, t0, t0 + interval '1 minute', NULL, t0),
    (l2, '+40700000902', 'detinator', pg_temp.r30i_g('D2'), 'trimis', 'simulator', 'dry30i-4', NULL, t0 + interval '1 day', t0 + interval '1 day 2 minutes', NULL, t0 + interval '1 day'),
    -- D3: respins la trimitere (necunoscut -> esuat, fara trimis_la) -> trimise 0, esuate 1, categorie esuat
    (l1, '+40700000903', 'detinator', pg_temp.r30i_g('D3'), 'esuat', 'simulator', NULL, 'respins_dry', t0, NULL, NULL, t0),
    -- D4: in coada intr-un lot in_trimitere -> in_curs 1
    (l2, '+40700000904', 'detinator', pg_temp.r30i_g('D4'), 'in_coada', NULL, NULL, NULL, NULL, NULL, NULL, t0 + interval '1 day'),
    -- D5: in coada intr-un lot draft + anulat intr-un lot anulat -> ignorat (absent)
    (l3, '+40700000905', 'detinator', pg_temp.r30i_g('D5'), 'in_coada', NULL, NULL, NULL, NULL, NULL, NULL, t0 + interval '2 days'),
    (l4, '+40700000905', 'detinator', pg_temp.r30i_g('D5'), 'anulat', NULL, NULL, NULL, NULL, NULL, NULL, t0),
    -- D6: acceptat apoi esuat (DLR) in L1 + necunoscut (rezervat, rezultat necunoscut) in L2 -> trimise 1, esuate 1, in_curs 1, ultima in_curs, categorie in_curs
    (l1, '+40700000906', 'detinator', pg_temp.r30i_g('D6'), 'esuat', 'simulator', 'dry30i-5', 'dlr_dry', t0, t0 + interval '1 minute', NULL, t0),
    (l2, '+40700000906', 'detinator', pg_temp.r30i_g('D6'), 'necunoscut', 'simulator', NULL, 'timeout_dry', t0 + interval '1 day 5 minutes', NULL, NULL, t0 + interval '1 day'),
    -- excluse: D1 intr-un lot intern si intr-un lot redari al altui proiect; un detinator din alt proiect intr-un lot al TEST-RAZVAN; un 'angajat' cu id-ul lui D2
    (l5, '+40700000901', 'detinator', pg_temp.r30i_g('D1'), 'livrat', 'simulator', 'dry30i-6', NULL, t0, t0 + interval '1 minute', t0 + interval '2 minutes', t0),
    (l6, '+40700000901', 'detinator', pg_temp.r30i_g('D1'), 'livrat', 'simulator', 'dry30i-7', NULL, t0, t0 + interval '1 minute', t0 + interval '2 minutes', t0),
    (l1, '+40700000907', 'detinator', alt_det::text, 'livrat', 'simulator', 'dry30i-8', NULL, t0, t0 + interval '1 minute', t0 + interval '2 minutes', t0),
    (l1, '+40700000908', 'angajat', pg_temp.r30i_g('D2'), 'livrat', 'simulator', 'dry30i-9', NULL, t0, t0 + interval '1 minute', t0 + interval '2 minutes', t0),
    -- r2 (P2-5) D7: in coada intr-un lot 'aprobat' -> in_curs 1 (prinde scoaterea lui 'aprobat' din conditie)
    (l7, '+40700000909', 'detinator', pg_temp.r30i_g('D7'), 'in_coada', NULL, NULL, NULL, NULL, NULL, NULL, t0 + interval '2 days'),
    -- r2 (P2-5) D8: DOUA mesaje (doua numere) in ACELASI lot L1 -> loturi 1, nu 2 (prinde count(*) in loc de count(DISTINCT lot))
    (l1, '+40700000911', 'detinator', pg_temp.r30i_g('D8'), 'livrat', 'simulator', 'dry30i-11', NULL, t0, t0 + interval '1 minute', t0 + interval '2 minutes', t0),
    (l1, '+40700000912', 'detinator', pg_temp.r30i_g('D8'), 'trimis', 'simulator', 'dry30i-12', NULL, t0, t0 + interval '3 minutes', NULL, t0),
    -- r2 (P2-5) D9: ordinea dupa trimis_la e INVERSA fata de creat_la: livratul e creat mai tarziu (t0+2z) dar trimis primul (t0+1min); esuatul
    -- e creat primul (t0) dar trimis ultimul (t0+1z) -> ultima_stare = esuat (dupa coalesce(trimis_la, ...)), nu livrat (dupa creat_la)
    (l1, '+40700000913', 'detinator', pg_temp.r30i_g('D9'), 'livrat', 'simulator', 'dry30i-13', NULL, t0, t0 + interval '1 minute', t0 + interval '2 minutes', t0 + interval '2 days'),
    (l2, '+40700000913', 'detinator', pg_temp.r30i_g('D9'), 'esuat', 'simulator', 'dry30i-14', 'dlr_dry', t0, t0 + interval '1 day', NULL, t0);
  ALTER TABLE public.sms_loturi ENABLE TRIGGER trg_sms_loturi_reguli;
  ALTER TABLE public.sms_mesaje ENABLE TRIGGER trg_sms_mesaje_reguli;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN ('public.sms_loturi'::regclass, 'public.sms_mesaje'::regclass) AND tgname IN ('trg_sms_loturi_reguli', 'trg_sms_mesaje_reguli') AND tgenabled <> 'O') THEN
    RAISE EXCEPTION 'TEST0 FAIL: triggerele SMS nu au fost repornite';
  END IF;
  RAISE NOTICE 'TEST0 OK';
END $t$;

-- TEST1: viewer-ul vede agregatele corecte pe toate cazurile; iesirea nu are telefon / text / cod de eroare / furnizor
SELECT pg_temp.r30i_ca(pg_temp.r30i_g('viewer')::uuid, 'authenticated');
DO $t$
DECLARE k text[];
BEGIN
  IF NOT pg_temp.r30i_e('D1', 2, 1, 0, 0, 'trimis', 2, 'livrat') THEN RAISE EXCEPTION 'TEST1 FAIL: D1 (livrat + trimis, de doua ori) %', pg_temp.r30i_rand('D1'); END IF;
  IF NOT pg_temp.r30i_e('D2', 2, 0, 0, 0, 'trimis', 2, 'trimis') THEN RAISE EXCEPTION 'TEST1 FAIL: D2 (trimis x2, nelivrat) %', pg_temp.r30i_rand('D2'); END IF;
  IF NOT pg_temp.r30i_e('D3', 0, 0, 1, 0, 'esuat', 1, 'esuat') THEN RAISE EXCEPTION 'TEST1 FAIL: D3 (respins) %', pg_temp.r30i_rand('D3'); END IF;
  IF NOT pg_temp.r30i_e('D4', 0, 0, 0, 1, 'in_curs', 1, 'in_curs') THEN RAISE EXCEPTION 'TEST1 FAIL: D4 (in coada, lot in trimitere) %', pg_temp.r30i_rand('D4'); END IF;
  IF pg_temp.r30i_rand('D5') IS NOT NULL THEN RAISE EXCEPTION 'TEST1 FAIL: D5 (draft / anulat) apare'; END IF;
  IF NOT pg_temp.r30i_e('D6', 1, 0, 1, 1, 'in_curs', 2, 'in_curs') THEN RAISE EXCEPTION 'TEST1 FAIL: D6 (esuat dupa acceptare + necunoscut) %', pg_temp.r30i_rand('D6'); END IF;
  IF NOT pg_temp.r30i_e('D7', 0, 0, 0, 1, 'in_curs', 1, 'in_curs') THEN RAISE EXCEPTION 'TEST1 FAIL: D7 (in coada, lot aprobat) %', pg_temp.r30i_rand('D7'); END IF;
  IF NOT pg_temp.r30i_e('D8', 2, 1, 0, 0, 'trimis', 1, 'livrat') THEN RAISE EXCEPTION 'TEST1 FAIL: D8 (doua mesaje in acelasi lot -> loturi 1) %', pg_temp.r30i_rand('D8'); END IF;
  IF NOT pg_temp.r30i_e('D9', 2, 1, 1, 0, 'esuat', 2, 'livrat') THEN RAISE EXCEPTION 'TEST1 FAIL: D9 (ultima dupa trimis_la, nu creat_la) %', pg_temp.r30i_rand('D9'); END IF;
  IF (SELECT x->>'ultima_trimitere' IS NOT NULL OR x->>'ultima_livrare' IS NOT NULL FROM (SELECT pg_temp.r30i_rand('D3') x) s) THEN RAISE EXCEPTION 'TEST1 FAIL: D3 date trebuie NULL'; END IF;
  IF (SELECT x->>'ultima_livrare' IS NULL OR x->>'ultima_trimitere' IS NULL FROM (SELECT pg_temp.r30i_rand('D1') x) s) THEN RAISE EXCEPTION 'TEST1 FAIL: D1 date'; END IF;
  IF (SELECT (x->>'ultima_trimitere')::timestamptz <= (x->>'ultima_livrare')::timestamptz FROM (SELECT pg_temp.r30i_rand('D1') x) s) THEN
    RAISE EXCEPTION 'TEST1 FAIL: D1 ultima_trimitere trebuie sa fie trimiterea din L2 (dupa livrarea din L1)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fn_red_sms_stare(pg_temp.r30i_g('proiect')::uuid) r WHERE r.detinator_id = pg_temp.r30i_g('alt_det')::uuid) THEN
    RAISE EXCEPTION 'TEST1 FAIL: detinator din alt proiect apare in TEST-RAZVAN';
  END IF;
  SELECT array_agg(j ORDER BY j) INTO k FROM (SELECT DISTINCT jsonb_object_keys(to_jsonb(r)) j FROM public.fn_red_sms_stare(pg_temp.r30i_g('proiect')::uuid) r) s;
  IF k IS DISTINCT FROM ARRAY['categorie', 'detinator_id', 'loturi', 'nr_esuate', 'nr_in_curs', 'nr_livrate', 'nr_trimise', 'ultima_livrare', 'ultima_stare', 'ultima_trimitere']::text[] THEN
    RAISE EXCEPTION 'TEST1 FAIL: coloanele iesirii %', k;
  END IF;
  -- viewer-ul NU citeste direct tabelele SMS (RLS pe nivelul SMS) — calea noua e singura
  IF EXISTS (SELECT 1 FROM public.sms_mesaje) OR EXISTS (SELECT 1 FROM public.sms_loturi) THEN RAISE EXCEPTION 'TEST1 FAIL: viewer-ul citeste sms_* direct'; END IF;
  RAISE NOTICE 'TEST1 OK';
END $t$;

-- TEST2: editor si admin (owner) vad aceleasi cifre
SELECT pg_temp.r30i_ca(pg_temp.r30i_g('editor')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r30i_e('D2', 2, 0, 0, 0, 'trimis', 2, 'trimis') OR NOT pg_temp.r30i_e('D6', 1, 0, 1, 1, 'in_curs', 2, 'in_curs') THEN RAISE EXCEPTION 'TEST2 FAIL: editor'; END IF;
  RAISE NOTICE 'TEST2a OK';
END $t$;
SELECT pg_temp.r30i_ca(pg_temp.r30i_g('admin')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r30i_e('D1', 2, 1, 0, 0, 'trimis', 2, 'livrat') OR NOT pg_temp.r30i_e('D3', 0, 0, 1, 0, 'esuat', 1, 'esuat') THEN RAISE EXCEPTION 'TEST2 FAIL: admin'; END IF;
  RAISE NOTICE 'TEST2b OK';
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

-- TEST4: anon -> refuz (fara EXECUTE: 42501), chiar si cu un sub de utilizator Redari in claims
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

-- TEST5: alt proiect -> nu contine fixture-ul TEST-RAZVAN (lotul L6 al altui proiect are doar D1, care NU e detinator al acelui proiect -> exclus)
SELECT pg_temp.r30i_ca(pg_temp.r30i_g('viewer')::uuid, 'authenticated');
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM public.fn_red_sms_stare(pg_temp.r30i_g('alt_proiect')::uuid) r
              WHERE r.detinator_id IN (SELECT pg_temp.r30i_g('D' || i)::uuid FROM generate_series(1, 9) i)) THEN
    RAISE EXCEPTION 'TEST5 FAIL: detinatorii TEST-RAZVAN apar in alt proiect';
  END IF;
  RAISE NOTICE 'TEST5 OK';
END $t$;

-- TEST6: functia nu scrie si nu blocheaza randuri (STABLE; un apel in tranzactie read-only merge)
DO $t$ BEGIN
  IF (SELECT provolatile <> 's' OR NOT prosecdef FROM pg_proc WHERE oid = 'public.fn_red_sms_stare(uuid)'::regprocedure) THEN RAISE EXCEPTION 'TEST6 FAIL: volatilitate / definer'; END IF;
  RAISE NOTICE 'TEST6 OK';
END $t$;

-- TEST7: lotul redari REAL pe TEST-RAZVAN (doar citit): fiecare mesaj livrat al unui detinator real al proiectului apare cu categorie livrat
SELECT pg_temp.r30i_ca(NULL, 'postgres');
DO $t$
DECLARE v_real jsonb; v_fn jsonb;
BEGIN
  -- asteptat, calculat INDEPENDENT de functie, direct din tabele (ca postgres): detinatorii reali (ne-DRY30I) cu cel putin un mesaj livrat in loturile redari ale proiectului
  SELECT coalesce(jsonb_agg(DISTINCT d.id ORDER BY d.id), '[]') INTO v_real
    FROM public.sms_mesaje x JOIN public.sms_loturi l ON l.id = x.lot_id AND l.categorie = 'redari' AND l.proiect_id = pg_temp.r30i_g('proiect')::uuid
    JOIN public.red_detinatori d ON d.id::text = x.destinatar_id JOIN public.red_parcele p ON p.id = d.parcela_id AND p.proiect_id = l.proiect_id
   WHERE x.destinatar_tip = 'detinator' AND x.stare = 'livrat' AND d.nume NOT LIKE 'DRY30I-%';
  PERFORM pg_temp.r30i_ca(pg_temp.r30i_g('viewer')::uuid, 'authenticated');
  SELECT coalesce(jsonb_agg(r.detinator_id ORDER BY r.detinator_id), '[]') INTO v_fn
    FROM public.fn_red_sms_stare(pg_temp.r30i_g('proiect')::uuid) r
   WHERE r.categorie = 'livrat' AND r.detinator_id NOT IN (SELECT pg_temp.r30i_g('D' || i)::uuid FROM generate_series(1, 9) i);
  PERFORM pg_temp.r30i_ca(NULL, 'postgres');
  IF v_real IS DISTINCT FROM v_fn THEN RAISE EXCEPTION 'TEST7 FAIL: livratii reali % <> functie %', v_real, v_fn; END IF;
  IF jsonb_array_length(v_real) < 1 THEN RAISE NOTICE 'TEST7: atentie, niciun mesaj livrat real pe TEST-RAZVAN (local / alta stare)'; END IF;
  RAISE NOTICE 'TEST7 OK (% detinatori reali livrati)', jsonb_array_length(v_real);
END $t$;

-- final: sesiunea revine la postgres, fara claims
SELECT pg_temp.r30i_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR coalesce(current_setting('request.jwt.claims', true), '') <> '' THEN RAISE EXCEPTION 'FINAL FAIL: rol / claims'; END IF;
  RAISE NOTICE 'DRY 20261130i OK';
END $t$;
