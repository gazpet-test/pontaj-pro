-- DRY 20261126a_redari_teren — rulat de chat (NU de sesiunile de cod) ÎN ACEEAȘI TRANZACȚIE cu migrarea, după ea, apoi ROLLBACK:
--   BEGIN;  SELECT set_config('gazpet.livrare_migrare', '20261126a_redari_teren:' || txid_current(), true);
--   \i supabase/migrations/20261126a_redari_teren.sql     \i supabase/tests/20261126a_redari_teren_dryrun.sql     ROLLBACK;
-- TEST0 refuză să ruleze dacă marcajul migrării nu e al tranzacției curente — adică nu rulează niciodată pe o migrare deja comisă.
-- Identități REALE din bază (ownerul + un cont fără modulul redari), prin SET LOCAL ROLE authenticated / anon + request.jwt.claims; datele
-- sunt fictive (POPESCU TEST ION …) și dispar la ROLLBACK. Aserțiunile folosesc IS DISTINCT FROM true (NULL pică). Fiecare bloc termină
-- cu RAISE NOTICE 'TESTn OK …'; orice abatere = RAISE EXCEPTION 'TESTn FAIL …' (tranzacția cade, nimic nu rămâne).
-- Local (PG17 de unică folosință): supabase/tests/20261126a_redari_teren_schelet.sql întâi — vezi docs/redari/MIGRARE_20261126a.md.

-- ── TEST0: garda tranzacției de probă, identitățile, ajutoarele ──────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.red_ca(p_uid uuid, p_rol text, p_email text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text
         ELSE jsonb_build_object('sub', p_uid, 'role', p_rol, 'email', p_email)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
CREATE FUNCTION pg_temp.red_ip(p_ip text) RETURNS void LANGUAGE sql AS $h$
  SELECT set_config('request.headers', jsonb_build_object('x-forwarded-for', p_ip)::text, true);
$h$;
CREATE FUNCTION pg_temp.red_g(p_nume text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('red_test.' || p_nume, true), ''); $h$;
CREATE FUNCTION pg_temp.red_stare(p_detinator uuid) RETURNS text LANGUAGE sql STABLE AS $h$
  SELECT s.stare FROM public.red_v_stare_parcela s WHERE s.detinator_id = p_detinator;
$h$;
DO $t0$
DECLARE v_owner uuid; v_fara uuid;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261126a_redari_teren:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: DRY-ul ruleaza DOAR in tranzactia de proba a migrarii (marcaj lipsa) — nu pe o migrare comisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'TEST0 FAIL: necesita postgres'; END IF;
  SELECT id INTO v_owner FROM public.profiles WHERE is_owner = true ORDER BY id LIMIT 1;
  SELECT p.id INTO v_fara FROM public.profiles p
   WHERE coalesce(p.is_owner, false) = false AND NOT EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p.id AND u.module = 'redari')
   ORDER BY p.id LIMIT 1;
  IF v_owner IS NULL OR v_fara IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: nu gasesc ownerul / un cont fara modulul redari'; END IF;
  PERFORM set_config('red_test.owner', v_owner::text, true);
  PERFORM set_config('red_test.fara', v_fara::text, true);
  PERFORM set_config('red_test.email', 'owner.test@redari.local', true);
  PERFORM set_config('red_test.azi', current_date::text, true);
  RAISE NOTICE 'TEST0 OK garda tranzactiei + identitati (owner=%, fara=%)', v_owner, v_fara;
END $t0$;

-- ── TEST1: fn_red_nivel — owner = admin, cont fără modul = NULL, fără sesiune = NULL ──────────────────────────────────────────
DO $t1$
DECLARE v text;
BEGIN
  PERFORM pg_temp.red_ca(pg_temp.red_g('owner')::uuid, 'authenticated', pg_temp.red_g('email'));
  v := public.fn_red_nivel();
  IF (v = 'admin') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST1 FAIL: owner nivel=% (astept admin)', v; END IF;
  PERFORM pg_temp.red_ca(pg_temp.red_g('fara')::uuid, 'authenticated', 'fara@redari.local');
  v := public.fn_red_nivel();
  IF v IS NOT NULL THEN RAISE EXCEPTION 'TEST1 FAIL: cont fara modul nivel=% (astept NULL)', v; END IF;
  PERFORM pg_temp.red_ca(NULL, 'postgres', NULL);
  IF public.fn_red_nivel() IS NOT NULL THEN RAISE EXCEPTION 'TEST1 FAIL: fara sesiune nivel nu e NULL'; END IF;
  RAISE NOTICE 'TEST1 OK fn_red_nivel: owner=admin, fara modul=NULL, fara sesiune=NULL';
END $t1$;

-- ── TEST2: owner scrie proiect / UAT / parcelă / deținători; token generat în BD; expirarea; valoare_lei mascată ──────────────
DO $t2$
DECLARE
  v_owner uuid := pg_temp.red_g('owner')::uuid; v_azi date := pg_temp.red_g('azi')::date;
  v_pr uuid; v_uat uuid; v_p uuid; v_d1 uuid; v_d2 uuid; v_d3 uuid; v_d4 uuid; v_d5 uuid;
  v_tok text; v_tok2 text; v_exp timestamptz; v_astept timestamptz; v_n numeric; v_ok boolean;
BEGIN
  PERFORM pg_temp.red_ca(v_owner, 'authenticated', pg_temp.red_g('email'));
  INSERT INTO public.red_proiecte (cod, denumire, beneficiar, contact_nume, contact_telefon, contact_email, activ)
  VALUES ('TEST-REDARI-DRY', 'Proiect test redari (DRY)', 'Beneficiar test', 'Contact Test', '0700000000', 'redari-test@exemplu.local', true) RETURNING id INTO v_pr;
  INSERT INTO public.red_uat (proiect_id, nume, uat3, judet, sesiune_zi1, sesiune_zi2, sesiune_zi3, program_zi1, program_zi2, program_zi3)
  VALUES (v_pr, 'UAT Test Husnicioara', 'HUS', 'Mehedinti', v_azi + 10, v_azi + 11, v_azi + 12, '09-12', '09-12', '13-16') RETURNING id INTO v_uat;
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson, sat, tarla, suprafata_temporara_mp, articol_deviz, cantitate)
  VALUES (v_pr, v_uat, 'T3-HUS-0001', 3, 'Sat Test', 'T12', 250, 'Readucere teren arabil', 250) RETURNING id INTO v_p;
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate, cota)
  VALUES (v_p, 'Popescu Test Ion', 'POPESCU TEST ION', 'proprietar', '1/1') RETURNING id INTO v_d1;
  INSERT INTO public.red_detinatori_contact (detinator_id, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal, adresa_cunoscuta, telefon)
  VALUES (v_d1, 'Str. Test nr. 1', 'Sat Test', 'Comuna Test', 'Mehedinti', '227000', true, '0700000001');
  -- d2 fara rand de contact
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate)
  VALUES (v_p, 'Ionescu Test Maria', 'IONESCU TEST MARIA', 'coproprietar') RETURNING id INTO v_d2;
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate)
  VALUES (v_p, 'Neidentificat Test', 'NEIDENTIFICAT TEST', 'neidentificat') RETURNING id INTO v_d3;
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate)
  VALUES (v_p, 'Georgescu Test Ana', 'GEORGESCU TEST ANA', 'mostenitor') RETURNING id INTO v_d4;
  INSERT INTO public.red_detinatori_contact (detinator_id, adresa_cunoscuta) VALUES (v_d4, false);
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate)
  VALUES (v_p, 'Dumitrescu Test Vasile', 'DUMITRESCU TEST VASILE', 'arendas') RETURNING id INTO v_d5;
  INSERT INTO public.red_detinatori_contact (detinator_id, adresa_strada, adresa_comuna, adresa_judet, adresa_cunoscuta) VALUES (v_d5, 'Str. Test nr. 5', 'Comuna Test', 'Mehedinti', true);
  -- dublura pe (parcela, nume_normalizat) activa e refuzata
  BEGIN
    INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate) VALUES (v_p, 'POPESCU TEST ION', 'POPESCU TEST ION', 'proprietar');
    RAISE EXCEPTION 'TEST2 FAIL: dublura de detinator acceptata';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- cheie_sursa: identitatea din Excel e unica pe proiect (activ)
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson, cheie_sursa) VALUES (v_pr, v_uat, 'T3-HUS-0002', 3, 'HUS|12|123|T12');
  BEGIN
    INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson, cheie_sursa) VALUES (v_pr, v_uat, 'T3-HUS-0003', 3, 'HUS|12|123|T12');
    RAISE EXCEPTION 'TEST2 FAIL: cheie_sursa dubla acceptata';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- tokenul: tabela separata, fara scriere pentru authenticated (nici admin)
  BEGIN
    INSERT INTO public.red_detinatori_token (detinator_id, token_raspuns) VALUES (v_d2, repeat('a', 40));
    RAISE EXCEPTION 'TEST2 FAIL: admin a scris in red_detinatori_token';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.red_detinatori_token SET token_raspuns = repeat('b', 40) WHERE detinator_id = v_d1;
    RAISE EXCEPTION 'TEST2 FAIL: admin a modificat tokenul';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM public.red_detinatori_token) <> 5 THEN RAISE EXCEPTION 'TEST2 FAIL: admin nu vede cele 5 tokenuri'; END IF;
  -- valoare_lei: coloana nu e citibila direct nici de admin; doar prin functii
  BEGIN
    PERFORM p.valoare_lei FROM public.red_parcele p WHERE p.id = v_p;
    RAISE EXCEPTION 'TEST2 FAIL: valoare_lei citibila direct de authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.red_parcele p WHERE p.id = v_p;
    RAISE EXCEPTION 'TEST2 FAIL: select * pe red_parcele a mers pentru authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM public.red_v_parcele WHERE id = v_p) <> 1 THEN RAISE EXCEPTION 'TEST2 FAIL: red_v_parcele nu arata parcela'; END IF;
  PERFORM public.fn_red_valoare_parcela_seteaza(v_p, 1234.5);
  v_n := public.fn_red_valoare_parcela(v_p);
  IF (v_n = 1234.5) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST2 FAIL: fn_red_valoare_parcela=% (astept 1234.5)', v_n; END IF;
  UPDATE public.red_detinatori SET cota = '1/2' WHERE id = v_d1;
  PERFORM pg_temp.red_ca(NULL, 'postgres', NULL);
  -- tokenul: imutabil chiar la UPDATE ca postgres
  UPDATE public.red_detinatori_token SET token_raspuns = repeat('c', 40), token_expira_la = token_expira_la WHERE detinator_id = v_d1;
  SELECT token_raspuns, token_expira_la INTO v_tok, v_exp FROM public.red_detinatori_token WHERE detinator_id = v_d1;
  IF (length(v_tok) >= 32 AND v_tok ~ '^[A-Za-z0-9_-]+$' AND v_tok <> repeat('c', 40)) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST2 FAIL: token invalid sau modificabil (%)', v_tok; END IF;
  SELECT token_raspuns INTO v_tok2 FROM public.red_detinatori_token WHERE detinator_id = v_d2;
  IF (length(v_tok2) >= 32 AND v_tok2 <> v_tok) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST2 FAIL: tokenul d2'; END IF;
  v_astept := ((v_azi + 12 + 30) + time '23:59:59') AT TIME ZONE 'Europe/Bucharest';
  IF (v_exp = v_astept) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST2 FAIL: token_expira_la=% (astept %)', v_exp, v_astept; END IF;
  -- schimbarea sesiunilor UAT recalculeaza expirarea
  PERFORM pg_temp.red_ca(v_owner, 'authenticated', pg_temp.red_g('email'));
  UPDATE public.red_uat SET sesiune_zi3 = v_azi + 20 WHERE id = v_uat;
  PERFORM pg_temp.red_ca(NULL, 'postgres', NULL);
  v_astept := ((v_azi + 20 + 30) + time '23:59:59') AT TIME ZONE 'Europe/Bucharest';
  IF (SELECT count(*) FROM public.red_detinatori_token t JOIN public.red_detinatori d ON d.id = t.detinator_id WHERE d.parcela_id = v_p AND t.token_expira_la = v_astept) <> 5 THEN
    RAISE EXCEPTION 'TEST2 FAIL: expirarea nu s-a recalculat pe toti detinatorii UAT-ului';
  END IF;
  PERFORM set_config('red_test.pr', v_pr::text, true); PERFORM set_config('red_test.uat', v_uat::text, true); PERFORM set_config('red_test.p', v_p::text, true);
  PERFORM set_config('red_test.d1', v_d1::text, true); PERFORM set_config('red_test.d2', v_d2::text, true); PERFORM set_config('red_test.d3', v_d3::text, true);
  PERFORM set_config('red_test.d4', v_d4::text, true); PERFORM set_config('red_test.d5', v_d5::text, true);
  PERFORM set_config('red_test.tok1', v_tok, true); PERFORM set_config('red_test.tok2', v_tok2, true);
  RAISE NOTICE 'TEST2 OK insert owner: token % caractere in red_detinatori_token, imutabil, expira % (+30 zile dupa ultima sesiune), cheie_sursa unica, valoare_lei doar prin functii', length(v_tok), v_astept;
END $t2$;

-- ── TEST3: contul fără modul nu vede nimic și nu poate scrie ─────────────────────────────────────────────────────────────────
DO $t3$
DECLARE v_fara uuid := pg_temp.red_g('fara')::uuid; v_total bigint; n bigint;
BEGIN
  PERFORM pg_temp.red_ca(v_fara, 'authenticated', 'fara@redari.local');
  SELECT (SELECT count(*) FROM public.red_proiecte) + (SELECT count(*) FROM public.red_uat) + (SELECT count(*) FROM public.red_v_parcele)
       + (SELECT count(*) FROM public.red_detinatori) + (SELECT count(*) FROM public.red_detinatori_contact) + (SELECT count(*) FROM public.red_convocari)
       + (SELECT count(*) FROM public.red_raspunsuri) + (SELECT count(*) FROM public.red_procese_verbale) + (SELECT count(*) FROM public.red_jurnal)
       + (SELECT count(*) FROM public.red_numere) + (SELECT count(*) FROM public.red_import_loturi) + (SELECT count(*) FROM public.red_v_stare_parcela)
       + (SELECT count(*) FROM public.red_v_centralizator_uat) + (SELECT count(*) FROM public.red_v_tronson) + (SELECT count(*) FROM public.red_detinatori_token)
    INTO v_total;
  IF v_total <> 0 THEN RAISE EXCEPTION 'TEST3 FAIL: contul fara modul vede % randuri', v_total; END IF;
  BEGIN
    PERFORM count(*) FROM public.red_rate_limit;
    RAISE EXCEPTION 'TEST3 FAIL: red_rate_limit citibil de authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.red_proiecte (cod) VALUES ('TEST-FARA');
    RAISE EXCEPTION 'TEST3 FAIL: insert proiect acceptat pentru cont fara modul';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune) VALUES (pg_temp.red_g('d1')::uuid, 'telefon', 'particip');
    RAISE EXCEPTION 'TEST3 FAIL: insert raspuns acceptat pentru cont fara modul';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.red_detinatori SET cota = 'x' WHERE id = pg_temp.red_g('d1')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'TEST3 FAIL: update detinator a atins % randuri', n; END IF;
  BEGIN
    PERFORM public.fn_red_numar_document('C', NULL, NULL);
    RAISE EXCEPTION 'TEST3 FAIL: numerotare acceptata pentru cont fara modul';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.red_ca(NULL, 'postgres', NULL);
  RAISE NOTICE 'TEST3 OK contul fara modul: 0 randuri vizibile, insert/update/numerotare refuzate';
END $t3$;

-- ── TEST4: jurnalul (autor + email, mascare), append-only și pentru postgres, privilegii ─────────────────────────────────────
DO $t4$
DECLARE v_owner uuid := pg_temp.red_g('owner')::uuid; v_pr uuid := pg_temp.red_g('pr')::uuid; v_p uuid := pg_temp.red_g('p')::uuid; v_azi date := pg_temp.red_g('azi')::date; v_min bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_proiecte' AND inregistrare_id = v_pr AND actiune = 'insert'
                   AND user_id = v_owner AND user_email = pg_temp.red_g('email') AND date_noi ->> 'cod' = 'TEST-REDARI-DRY') THEN
    RAISE EXCEPTION 'TEST4 FAIL: lipseste randul de jurnal insert proiect cu user_id / user_email';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_uat' AND actiune = 'update' AND user_id = v_owner
                   AND date_vechi ->> 'sesiune_zi3' = (v_azi + 12)::text AND date_noi ->> 'sesiune_zi3' = (v_azi + 20)::text) THEN
    RAISE EXCEPTION 'TEST4 FAIL: lipseste randul de jurnal update UAT cu date_vechi / date_noi';
  END IF;
  IF (SELECT count(*) FROM public.red_jurnal WHERE tabela = 'red_detinatori' AND actiune = 'insert' AND user_id = v_owner) <> 5
     OR EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela IN ('red_detinatori_token', 'red_rate_limit'))
     OR EXISTS (SELECT 1 FROM public.red_jurnal WHERE date_noi::text LIKE '%' || pg_temp.red_g('tok1') || '%' OR date_vechi::text LIKE '%' || pg_temp.red_g('tok1') || '%') THEN
    RAISE EXCEPTION 'TEST4 FAIL: jurnal detinatori (5 insert-uri; tokenul nu apare nicaieri in jurnal)';
  END IF;
  -- update-ul de cota (TEST2) e jurnalizat; recalculul expirarii (doar token_expira_la / updated_at) nu
  IF (SELECT count(*) FROM public.red_jurnal WHERE tabela = 'red_detinatori' AND actiune = 'update') <> 1 THEN
    RAISE EXCEPTION 'TEST4 FAIL: astept exact 1 update jurnalizat pe red_detinatori (cota), am %', (SELECT count(*) FROM public.red_jurnal WHERE tabela = 'red_detinatori' AND actiune = 'update');
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_parcele' AND (date_noi ? 'valoare_lei' OR date_vechi ? 'valoare_lei'))
     OR NOT EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_parcele' AND inregistrare_id = v_p AND actiune = 'update'
                      AND date_vechi ->> 'valoare_lei_setata' = 'false' AND date_noi ->> 'valoare_lei_setata' = 'true') THEN
    RAISE EXCEPTION 'TEST4 FAIL: mascarea valoare_lei in jurnal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_detinatori_contact' AND actiune = 'insert' AND date_noi ->> 'telefon' = '0700000001') THEN
    RAISE EXCEPTION 'TEST4 FAIL: contactul nu e jurnalizat';
  END IF;
  -- append-only, chiar ca postgres (owner-ul tabelului)
  SELECT min(id) INTO v_min FROM public.red_jurnal;
  BEGIN
    UPDATE public.red_jurnal SET tabela = 'falsificat' WHERE id = v_min;
    RAISE EXCEPTION 'TEST4 FAIL: UPDATE pe red_jurnal a mers ca postgres';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.red_jurnal WHERE id = v_min;
    RAISE EXCEPTION 'TEST4 FAIL: DELETE pe red_jurnal a mers ca postgres';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    TRUNCATE public.red_jurnal;
    RAISE EXCEPTION 'TEST4 FAIL: TRUNCATE pe red_jurnal a mers ca postgres';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF has_table_privilege('service_role', 'public.red_jurnal', 'UPDATE') OR has_table_privilege('service_role', 'public.red_jurnal', 'DELETE')
     OR has_table_privilege('service_role', 'public.red_jurnal', 'TRUNCATE') OR has_table_privilege('service_role', 'public.red_jurnal', 'INSERT')
     OR has_table_privilege('authenticated', 'public.red_jurnal', 'UPDATE') OR has_table_privilege('authenticated', 'public.red_jurnal', 'DELETE')
     OR has_table_privilege('authenticated', 'public.red_jurnal', 'INSERT') OR has_table_privilege('anon', 'public.red_jurnal', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.red_jurnal', 'SELECT') OR NOT has_table_privilege('authenticated', 'public.red_jurnal', 'SELECT') THEN
    RAISE EXCEPTION 'TEST4 FAIL: privilegiile pe red_jurnal';
  END IF;
  RAISE NOTICE 'TEST4 OK jurnal: % randuri, autor + email, mascare valoare_lei / token, UPDATE/DELETE/TRUNCATE refuzate si pentru postgres', (SELECT count(*) FROM public.red_jurnal);
END $t4$;

-- ── TEST5: numerotarea ───────────────────────────────────────────────────────────────────────────────────────────────────────
DO $t5$
DECLARE v text; i int;
BEGIN
  PERFORM pg_temp.red_ca(pg_temp.red_g('owner')::uuid, 'authenticated', pg_temp.red_g('email'));
  v := public.fn_red_numar_document('C', NULL, NULL);
  IF (v = 'C-0001') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST5 FAIL: % (astept C-0001)', v; END IF;
  v := public.fn_red_numar_document('C', NULL, NULL);
  IF (v = 'C-0002') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST5 FAIL: % (astept C-0002)', v; END IF;
  v := public.fn_red_numar_document('PVA', 'HUS', NULL);
  IF (v = 'PVA-HUS-0001') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST5 FAIL: % (astept PVA-HUS-0001)', v; END IF;
  v := public.fn_red_numar_document('PVB', 'HUS', NULL);
  IF (v = 'PVB-HUS-0001') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST5 FAIL: % (astept PVB-HUS-0001)', v; END IF;
  v := public.fn_red_numar_document('PVC', NULL, 3);
  IF (v = 'PVC-T3-0001') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST5 FAIL: % (astept PVC-T3-0001)', v; END IF;
  BEGIN
    PERFORM public.fn_red_numar_document('PVA', 'hus', NULL);
    RAISE EXCEPTION 'TEST5 FAIL: uat3 invalid acceptat';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    PERFORM public.fn_red_numar_document('PVC', NULL, 12);
    RAISE EXCEPTION 'TEST5 FAIL: tronson 12 acceptat';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    PERFORM public.fn_red_numar_document('X', NULL, NULL);
    RAISE EXCEPTION 'TEST5 FAIL: tip X acceptat';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  -- rezervarea numerelor de parcela: porneste de la max(nnnn) existent (T3-HUS-0001, -0002 → baza 2), blocuri consecutive
  i := public.fn_red_rezerva_numere_parcele('HUS', 3, 5);
  IF (i = 3) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST5 FAIL: rezerva HUS/3/5 = % (astept 3)', i; END IF;
  i := public.fn_red_rezerva_numere_parcele('HUS', 3, 1);
  IF (i = 8) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST5 FAIL: rezerva HUS/3/1 = % (astept 8)', i; END IF;
  i := public.fn_red_rezerva_numere_parcele('HUS', 4, 3);
  IF (i = 1) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST5 FAIL: rezerva HUS/4/3 = % (astept 1)', i; END IF;
  -- o parcela inserata peste contor (fara rezervare) ridica baza la urmatoarea rezervare
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson) VALUES (pg_temp.red_g('pr')::uuid, pg_temp.red_g('uat')::uuid, 'T4-HUS-0010', 4);
  i := public.fn_red_rezerva_numere_parcele('HUS', 4, 2);
  IF (i = 11) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST5 FAIL: rezerva HUS/4/2 dupa T4-HUS-0010 = % (astept 11)', i; END IF;
  BEGIN
    PERFORM public.fn_red_rezerva_numere_parcele('HUS', 3, 0);
    RAISE EXCEPTION 'TEST5 FAIL: p_n = 0 acceptat';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    PERFORM public.fn_red_rezerva_numere_parcele('HUS', 3, 5001);
    RAISE EXCEPTION 'TEST5 FAIL: p_n = 5001 acceptat';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  PERFORM pg_temp.red_ca(pg_temp.red_g('fara')::uuid, 'authenticated', 'fara@redari.local');
  BEGIN
    PERFORM public.fn_red_numar_document('C', NULL, NULL);
    RAISE EXCEPTION 'TEST5 FAIL: numerotare acceptata pentru nivel NULL';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.fn_red_rezerva_numere_parcele('HUS', 3, 1);
    RAISE EXCEPTION 'TEST5 FAIL: rezervare acceptata pentru nivel NULL';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.red_ca(NULL, 'postgres', NULL);
  IF (SELECT ultimul FROM public.red_numere WHERE cheie = 'C') <> 2 OR (SELECT ultimul FROM public.red_numere WHERE cheie = 'P-T3-HUS') <> 8
     OR (SELECT ultimul FROM public.red_numere WHERE cheie = 'P-T4-HUS') <> 12 THEN
    RAISE EXCEPTION 'TEST5 FAIL: red_numere (C=2, P-T3-HUS=8, P-T4-HUS=12)';
  END IF;
  RAISE NOTICE 'TEST5 OK numerotare: C-0001, C-0002, PVA-HUS-0001, PVB-HUS-0001, PVC-T3-0001; rezervare parcele 3..7, 8, 1..3, 11..12; refuz pentru nivel NULL / argumente invalide';
END $t5$;

-- ── TEST6: fluxul de stare (cele 12 stări) ───────────────────────────────────────────────────────────────────────────────────
DO $t6$
DECLARE
  v_owner uuid := pg_temp.red_g('owner')::uuid; v_azi date := pg_temp.red_g('azi')::date;
  v_p uuid := pg_temp.red_g('p')::uuid; v_uat uuid := pg_temp.red_g('uat')::uuid; v_pr uuid := pg_temp.red_g('pr')::uuid;
  v_d1 uuid := pg_temp.red_g('d1')::uuid; v_d2 uuid := pg_temp.red_g('d2')::uuid; v_d3 uuid := pg_temp.red_g('d3')::uuid;
  v_d4 uuid := pg_temp.red_g('d4')::uuid; v_d5 uuid := pg_temp.red_g('d5')::uuid;
  v_c1 uuid; v_c5 uuid; v_pva uuid; v_pvb uuid; v_r jsonb; s text; x record;
BEGIN
  PERFORM pg_temp.red_ca(v_owner, 'authenticated', pg_temp.red_g('email'));
  s := pg_temp.red_stare(v_d1); IF (s = 'DE_CONVOCAT') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d1 initial % (astept DE_CONVOCAT)', s; END IF;
  s := pg_temp.red_stare(v_d2); IF (s = 'FARA_ADRESA_AFISARE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d2 fara contact % (astept FARA_ADRESA_AFISARE)', s; END IF;
  s := pg_temp.red_stare(v_d3); IF (s = 'NEIDENTIFICAT_AFISARE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d3 % (astept NEIDENTIFICAT_AFISARE)', s; END IF;
  s := pg_temp.red_stare(v_d4); IF (s = 'FARA_ADRESA_AFISARE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d4 adresa necunoscuta % (astept FARA_ADRESA_AFISARE)', s; END IF;
  s := pg_temp.red_stare(v_d5); IF (s = 'DE_CONVOCAT') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d5 initial % (astept DE_CONVOCAT)', s; END IF;
  -- d1: convocare expediata → AR → raspuns online fara obiectii → PV A trimis → semnat
  INSERT INTO public.red_convocari (detinator_id, canal, nr_document, data_expediere, nr_tracking, continut_hash)
  VALUES (v_d1, 'posta', public.fn_red_numar_document('C', NULL, NULL), v_azi, 'AR-TEST-1', repeat('a', 64)) RETURNING id INTO v_c1;
  s := pg_temp.red_stare(v_d1); IF (s = 'EXPEDIAT_ASTEPTAM_AR') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d1 dupa expediere % (astept EXPEDIAT_ASTEPTAM_AR)', s; END IF;
  UPDATE public.red_convocari SET data_confirmare_primire = v_azi + 2 WHERE id = v_c1;
  s := pg_temp.red_stare(v_d1); IF (s = 'CONVOCAT_FARA_RASPUNS') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d1 dupa AR % (astept CONVOCAT_FARA_RASPUNS)', s; END IF;
  PERFORM pg_temp.red_ca(NULL, 'anon', NULL);
  PERFORM pg_temp.red_ip('10.0.0.1, 10.0.0.254');
  v_r := public.fn_red_raspuns_public(pg_temp.red_g('tok1'), 'nu_particip_fara_obiectii', NULL, NULL, true, 'DRY/1.0');
  IF ((v_r ->> 'ok')::boolean AND (v_r ->> 'deja_raspuns')::boolean = false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: raspuns online %', v_r; END IF;
  PERFORM pg_temp.red_ca(v_owner, 'authenticated', pg_temp.red_g('email'));
  s := pg_temp.red_stare(v_d1); IF (s = 'A_RASPUNS_FARA_OBIECTII') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d1 dupa raspuns % (astept A_RASPUNS_FARA_OBIECTII)', s; END IF;
  SELECT * INTO x FROM public.red_raspunsuri WHERE detinator_id = v_d1;
  IF (x.canal = 'online' AND x.created_by IS NULL AND x.ip_sau_sursa = '10.0.0.1' AND x.user_agent = 'DRY/1.0' AND x.declaratie_confirmata) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST6 FAIL: randul de raspuns online (canal/created_by/ip/user_agent)';
  END IF;
  INSERT INTO public.red_procese_verbale (parcela_id, detinator_id, uat_id, tip, nr_pv, data_pv, stare, trimis_spre_semnare_data)
  VALUES (v_p, v_d1, v_uat, 'A', public.fn_red_numar_document('PVA', 'HUS', NULL), v_azi + 10, 'trimis_spre_semnare', v_azi + 10) RETURNING id INTO v_pva;
  s := pg_temp.red_stare(v_d1); IF (s = 'PV_TRIMIS_SPRE_SEMNARE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d1 dupa PV trimis % (astept PV_TRIMIS_SPRE_SEMNARE)', s; END IF;
  UPDATE public.red_procese_verbale SET stare = 'semnat', semnat_primit_data = v_azi + 15, semnat_fizic = true WHERE id = v_pva;
  s := pg_temp.red_stare(v_d1); IF (s = 'PV_A_SEMNAT') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d1 dupa semnare % (astept PV_A_SEMNAT)', s; END IF;
  SELECT * INTO x FROM public.red_v_stare_parcela WHERE detinator_id = v_d1;
  IF (x.stare_ordine = 1 AND x.pv_stare = 'semnat' AND x.pv_nr LIKE 'PVA-HUS-%' AND x.ultimul_raspuns_optiune = 'nu_particip_fara_obiectii'
      AND x.ultima_convocare_data = v_azi AND x.adresa_cunoscuta = true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST6 FAIL: coloanele vederii pentru d1';
  END IF;
  -- d5: retur → raspuns telefonic particip → constatare teren (obiectii) → PV B pe parcela → anulare PV B
  INSERT INTO public.red_convocari (detinator_id, canal, nr_document, data_expediere, retur, retur_data)
  VALUES (v_d5, 'posta', public.fn_red_numar_document('C', NULL, NULL), v_azi, 'mutat', v_azi + 5) RETURNING id INTO v_c5;
  s := pg_temp.red_stare(v_d5); IF (s = 'CONVOCARE_RETURNATA') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d5 retur % (astept CONVOCARE_RETURNATA)', s; END IF;
  INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, zi_sesiune_aleasa, data) VALUES (v_d5, 'telefon', 'particip', v_azi + 10, now() - interval '1 minute');
  s := pg_temp.red_stare(v_d5); IF (s = 'A_RASPUNS_PARTICIPA') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d5 particip % (astept A_RASPUNS_PARTICIPA)', s; END IF;
  INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES (v_d5, 'telefon', 'constatare_teren', 'Teren necompactat test');
  s := pg_temp.red_stare(v_d5); IF (s = 'OBIECTII_DE_TRATAT') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d5 obiectii % (astept OBIECTII_DE_TRATAT)', s; END IF;
  IF (SELECT obiectii_deschise FROM public.red_v_tronson WHERE parcela_id = v_p) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: red_v_tronson.obiectii_deschise'; END IF;
  INSERT INTO public.red_procese_verbale (parcela_id, uat_id, tip, nr_pv, data_pv) VALUES (v_p, v_uat, 'B', public.fn_red_numar_document('PVB', 'HUS', NULL), v_azi + 12) RETURNING id INTO v_pvb;
  s := pg_temp.red_stare(v_d5); IF (s = 'PV_B_CONSTATARE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d5 PV B % (astept PV_B_CONSTATARE)', s; END IF;
  s := pg_temp.red_stare(v_d1); IF (s = 'PV_A_SEMNAT') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d1 dupa PV B % (PV A semnat trebuie sa ramana)', s; END IF;
  IF (SELECT tip_pv FROM public.red_v_tronson WHERE parcela_id = v_p) IS DISTINCT FROM 'A' THEN RAISE EXCEPTION 'TEST6 FAIL: red_v_tronson.tip_pv'; END IF;
  IF (SELECT count(*) FROM public.red_v_centralizator_uat WHERE uat_id = v_uat AND total_uat = 5 AND procent_inchise = 100.0) <> 2 THEN
    RAISE EXCEPTION 'TEST6 FAIL: centralizator cu PV B (astept 2 stari, total 5, 100%%)';
  END IF;
  UPDATE public.red_procese_verbale SET stare = 'anulat', motiv_anulare = 'test' WHERE id = v_pvb;
  s := pg_temp.red_stare(v_d5); IF (s = 'OBIECTII_DE_TRATAT') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST6 FAIL: d5 dupa anulare PV B % (astept OBIECTII_DE_TRATAT)', s; END IF;
  IF (SELECT count(*) FROM public.red_v_centralizator_uat WHERE uat_id = v_uat) <> 4
     OR (SELECT numar FROM public.red_v_centralizator_uat WHERE uat_id = v_uat AND stare = 'FARA_ADRESA_AFISARE') <> 2
     OR (SELECT min(procent_inchise) FROM public.red_v_centralizator_uat WHERE uat_id = v_uat) <> 20.0
     OR (SELECT max(procent_inchise) FROM public.red_v_centralizator_uat WHERE uat_id = v_uat) <> 20.0 THEN
    RAISE EXCEPTION 'TEST6 FAIL: centralizator final (astept 4 stari, FARA_ADRESA=2, 20%%)';
  END IF;
  -- convocare anulata nu conteaza; a doua convocare confirmata dupa retur invinge returul
  PERFORM pg_temp.red_ca(NULL, 'postgres', NULL);
  RAISE NOTICE 'TEST6 OK stari: DE_CONVOCAT → EXPEDIAT_ASTEPTAM_AR → CONVOCAT_FARA_RASPUNS → A_RASPUNS_FARA_OBIECTII → PV_TRIMIS_SPRE_SEMNARE → PV_A_SEMNAT; NEIDENTIFICAT / FARA_ADRESA / CONVOCARE_RETURNATA / A_RASPUNS_PARTICIPA / OBIECTII_DE_TRATAT / PV_B_CONSTATARE; centralizator + tronson';
END $t6$;

-- ── TEST7: RPC public — token invalid, validări, rate limit, fără nume, expirare ─────────────────────────────────────────────
DO $t7$
DECLARE
  v_owner uuid := pg_temp.red_g('owner')::uuid; v_azi date := pg_temp.red_g('azi')::date; v_uat uuid := pg_temp.red_g('uat')::uuid;
  v_t1 text := pg_temp.red_g('tok1'); v_t2 text := pg_temp.red_g('tok2'); v_t3 text; v_r jsonb; i int;
BEGIN
  SELECT token_raspuns INTO v_t3 FROM public.red_detinatori_token WHERE detinator_id = pg_temp.red_g('d3')::uuid;
  PERFORM pg_temp.red_ca(NULL, 'anon', NULL);
  PERFORM pg_temp.red_ip('10.0.0.2');
  v_r := public.fn_red_formular_public(repeat('x', 36));
  IF ((v_r ->> 'ok')::boolean = false AND v_r ->> 'motiv' = 'token_invalid' AND v_r ? 'contact_telefon' AND v_r ->> 'contact_nume' = 'Contact Test') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST7 FAIL: token inexistent %', v_r;
  END IF;
  v_r := public.fn_red_formular_public('abc');
  IF (v_r ->> 'motiv' = 'token_invalid') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST7 FAIL: token scurt %', v_r; END IF;
  v_r := public.fn_red_formular_public(v_t2);
  IF ((v_r ->> 'ok')::boolean AND v_r ->> 'id_parcela' = 'T3-HUS-0001' AND v_r ->> 'uat_nume' = 'UAT Test Husnicioara' AND jsonb_array_length(v_r -> 'sesiune') = 3
      AND v_r -> 'sesiune' -> 0 ->> 'zi' = to_char(v_azi + 10, 'YYYY-MM-DD') AND v_r -> 'sesiune' -> 0 ->> 'program' = '09-12'
      AND v_r ->> 'text_declaratie' IS NOT NULL AND v_r ->> 'contact_nume' = 'Contact Test' AND v_r ->> 'contact_telefon' = '0700000000'
      AND (v_r ->> 'deja_raspuns')::boolean = false AND (v_r ->> 'expirat')::boolean = false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST7 FAIL: formular valid %', v_r;
  END IF;
  IF v_r::text ILIKE '%ionescu%' OR v_r::text ILIKE '%popescu%' OR v_r::text ILIKE '%Str. Test%' OR v_r::text LIKE '%0700000001%' THEN
    RAISE EXCEPTION 'TEST7 FAIL: formularul scurge nume / adresa / telefon de detinator';
  END IF;
  v_r := public.fn_red_formular_public(v_t1);
  IF ((v_r ->> 'deja_raspuns')::boolean) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST7 FAIL: deja_raspuns pentru d1 %', v_r; END IF;
  -- validarile raspunsului (5 apeluri pe tokenul d2 → al 6-lea e prea_multe)
  v_r := public.fn_red_raspuns_public(v_t2, 'nu_particip_fara_obiectii', NULL, NULL, false, 'DRY');
  IF (v_r ->> 'motiv' = 'declaratie_neconfirmata') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST7 FAIL: fara declaratie %', v_r; END IF;
  v_r := public.fn_red_raspuns_public(v_t2, 'constatare_teren', NULL, '   ', NULL, 'DRY');
  IF (v_r ->> 'motiv' = 'obiectii_lipsa') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST7 FAIL: obiectii goale %', v_r; END IF;
  v_r := public.fn_red_raspuns_public(v_t2, 'nu_particip_cu_obiectii', NULL, repeat('x', 4001), NULL, 'DRY');
  IF (v_r ->> 'motiv' = 'obiectii_prea_lungi') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST7 FAIL: obiectii lungi %', v_r; END IF;
  v_r := public.fn_red_raspuns_public(v_t2, 'altceva', NULL, NULL, NULL, 'DRY');
  IF (v_r ->> 'motiv' = 'optiune_invalida') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST7 FAIL: optiune invalida %', v_r; END IF;
  v_r := public.fn_red_raspuns_public(v_t2, 'particip', v_azi + 99, NULL, NULL, 'DRY');
  IF (v_r ->> 'motiv' = 'zi_invalida') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST7 FAIL: zi invalida %', v_r; END IF;
  v_r := public.fn_red_raspuns_public(v_t2, 'particip', v_azi + 10, NULL, NULL, 'DRY');
  IF (v_r ->> 'motiv' = 'prea_multe') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST7 FAIL: al 6-lea apel pe token nu e prea_multe %', v_r; END IF;
  -- al doilea raspuns pe d1: acceptat, istoricul ramane, deja_raspuns + mesaj
  v_r := public.fn_red_raspuns_public(v_t1, 'particip', v_azi + 10, NULL, NULL, 'DRY');
  IF ((v_r ->> 'ok')::boolean AND (v_r ->> 'deja_raspuns')::boolean AND v_r ->> 'mesaj' IS NOT NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST7 FAIL: al doilea raspuns %', v_r; END IF;
  -- limita pe IP: 30 / 10 min
  PERFORM pg_temp.red_ip('10.0.0.9');
  FOR i IN 1..30 LOOP
    v_r := public.fn_red_formular_public('abc');
    IF (v_r ->> 'motiv' = 'token_invalid') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST7 FAIL: apelul % pe IP: %', i, v_r; END IF;
  END LOOP;
  v_r := public.fn_red_formular_public(v_t3);
  IF (v_r ->> 'motiv' = 'prea_multe') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST7 FAIL: al 31-lea apel pe IP nu e prea_multe %', v_r; END IF;
  -- anon nu citeste tabelele direct
  BEGIN
    PERFORM count(*) FROM public.red_detinatori;
    RAISE EXCEPTION 'TEST7 FAIL: anon citeste red_detinatori';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.red_v_stare_parcela;
    RAISE EXCEPTION 'TEST7 FAIL: anon citeste red_v_stare_parcela';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.red_ca(NULL, 'postgres', NULL);
  IF EXISTS (SELECT 1 FROM public.red_rate_limit WHERE cheie LIKE '%' || v_t2 || '%' OR cheie LIKE '%' || v_t1 || '%') THEN RAISE EXCEPTION 'TEST7 FAIL: tokenul in clar in red_rate_limit'; END IF;
  IF (SELECT numar FROM public.red_rate_limit WHERE cheie = 'ip:10.0.0.9') <> 31 THEN RAISE EXCEPTION 'TEST7 FAIL: contorul IP'; END IF;
  IF (SELECT count(*) FROM public.red_raspunsuri WHERE detinator_id = pg_temp.red_g('d1')::uuid) <> 2 THEN RAISE EXCEPTION 'TEST7 FAIL: istoricul raspunsurilor d1'; END IF;
  -- expirare: sesiunile UAT in trecut → tokenul d3 (nefolosit) devine invalid; apoi sesiunile revin
  PERFORM pg_temp.red_ca(v_owner, 'authenticated', pg_temp.red_g('email'));
  UPDATE public.red_uat SET sesiune_zi1 = v_azi - 100, sesiune_zi2 = v_azi - 99, sesiune_zi3 = v_azi - 98 WHERE id = v_uat;
  PERFORM pg_temp.red_ca(NULL, 'anon', NULL);
  PERFORM pg_temp.red_ip('10.0.0.3');
  v_r := public.fn_red_formular_public(v_t3);
  IF (v_r ->> 'motiv' = 'token_invalid' AND v_r ? 'contact_telefon') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST7 FAIL: token expirat %', v_r; END IF;
  v_r := public.fn_red_raspuns_public(v_t3, 'particip', NULL, NULL, NULL, 'DRY');
  IF (v_r ->> 'motiv' = 'token_invalid') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST7 FAIL: raspuns pe token expirat %', v_r; END IF;
  PERFORM pg_temp.red_ca(v_owner, 'authenticated', pg_temp.red_g('email'));
  UPDATE public.red_uat SET sesiune_zi1 = v_azi + 10, sesiune_zi2 = v_azi + 11, sesiune_zi3 = v_azi + 20 WHERE id = v_uat;
  PERFORM pg_temp.red_ca(NULL, 'anon', NULL);
  v_r := public.fn_red_formular_public(v_t3);
  IF ((v_r ->> 'ok')::boolean) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST7 FAIL: tokenul d3 nu a revenit valid %', v_r; END IF;
  PERFORM pg_temp.red_ca(NULL, 'postgres', NULL);
  RAISE NOTICE 'TEST7 OK RPC public: token_invalid (inexistent / scurt / expirat, cu contact), validari jsonb, 5/token si 30/IP → prea_multe, al doilea raspuns acceptat cu deja_raspuns, fara nume in raspuns, anon fara tabele';
END $t7$;

-- ── TEST8: viewer (drept temporar în user_module_access, în tranzacție) ──────────────────────────────────────────────────────
DO $t8$
DECLARE v_fara uuid := pg_temp.red_g('fara')::uuid; v_p uuid := pg_temp.red_g('p')::uuid; n bigint; s text;
BEGIN
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (v_fara, 'redari', 'viewer');
  PERFORM pg_temp.red_ca(v_fara, 'authenticated', 'viewer@redari.local');
  s := public.fn_red_nivel(); IF (s = 'viewer') IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST8 FAIL: nivel % (astept viewer)', s; END IF;
  IF (SELECT count(*) FROM public.red_detinatori) <> 5 THEN RAISE EXCEPTION 'TEST8 FAIL: viewer nu vede cei 5 detinatori'; END IF;
  IF (SELECT count(*) FROM public.red_detinatori_contact) <> 0 THEN RAISE EXCEPTION 'TEST8 FAIL: viewer vede red_detinatori_contact'; END IF;
  IF (SELECT count(*) FROM public.red_detinatori_token) <> 0 THEN RAISE EXCEPTION 'TEST8 FAIL: viewer vede tokenurile (red_detinatori_token)'; END IF;
  IF (SELECT count(*) FROM public.red_v_stare_parcela WHERE adresa_cunoscuta IS NOT NULL) <> 0 OR (SELECT count(*) FROM public.red_v_stare_parcela) <> 5 THEN
    RAISE EXCEPTION 'TEST8 FAIL: viewer: adresa_cunoscuta trebuie NULL pe toate cele 5 randuri';
  END IF;
  IF (SELECT stare FROM public.red_v_stare_parcela WHERE detinator_id = pg_temp.red_g('d4')::uuid) IS DISTINCT FROM 'FARA_ADRESA_AFISARE'
     OR (SELECT stare FROM public.red_v_stare_parcela WHERE detinator_id = pg_temp.red_g('d1')::uuid) IS DISTINCT FROM 'PV_A_SEMNAT' THEN
    RAISE EXCEPTION 'TEST8 FAIL: viewer: starea se evalueaza si fara acces la contact';
  END IF;
  IF (SELECT count(*) FROM public.red_jurnal) = 0 OR EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_detinatori_contact') THEN
    RAISE EXCEPTION 'TEST8 FAIL: viewer: jurnalul (vizibil, dar fara randurile de contact)';
  END IF;
  IF (SELECT count(*) FROM public.red_v_centralizator_uat) = 0 OR (SELECT count(*) FROM public.red_v_tronson) = 0 OR (SELECT count(*) FROM public.red_v_parcele) = 0 THEN
    RAISE EXCEPTION 'TEST8 FAIL: viewer nu vede vederile';
  END IF;
  BEGIN
    INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune) VALUES (pg_temp.red_g('d2')::uuid, 'telefon', 'particip');
    RAISE EXCEPTION 'TEST8 FAIL: viewer a inserat raspuns';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.red_detinatori SET cota = 'x' WHERE id = pg_temp.red_g('d1')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'TEST8 FAIL: viewer a modificat % detinatori', n; END IF;
  BEGIN
    PERFORM public.fn_red_numar_document('C', NULL, NULL);
    RAISE EXCEPTION 'TEST8 FAIL: viewer a numerotat';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.fn_red_valoare_parcela(v_p);
    RAISE EXCEPTION 'TEST8 FAIL: viewer a citit valoare_lei';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM p.valoare_lei FROM public.red_parcele p WHERE p.id = v_p;
    RAISE EXCEPTION 'TEST8 FAIL: viewer a citit coloana valoare_lei';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('redari', 'TEST-REDARI-DRY/HUS/T3-HUS-0001/C-0001.pdf');
    RAISE EXCEPTION 'TEST8 FAIL: viewer a scris in bucket-ul redari';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.red_ca(NULL, 'postgres', NULL);
  DELETE FROM public.user_module_access WHERE profile_id = v_fara AND module = 'redari';
  RAISE NOTICE 'TEST8 OK viewer: vede detinatori + vederi + jurnal, NU contactul (nici in jurnal), NU tokenurile, nu scrie, nu numeroteaza, fara valoare_lei, fara storage';
END $t8$;

-- ── TEST9: storage — politicile, anon / cont fără acces fără drum ────────────────────────────────────────────────────────────
DO $t9$
DECLARE v_fara uuid := pg_temp.red_g('fara')::uuid;
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname IN ('red_storage_sel', 'red_storage_ins', 'red_storage_upd')
        AND cmd IN ('SELECT', 'INSERT', 'UPDATE') AND coalesce(qual, with_check) LIKE '%fn_red_nivel()%') <> 3
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'red\_%' AND cmd = 'DELETE') THEN
    RAISE EXCEPTION 'TEST9 FAIL: politicile storage red_storage_*';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'redari' AND public = false AND 'application/pdf' = ANY (allowed_mime_types)) THEN
    RAISE EXCEPTION 'TEST9 FAIL: bucket-ul redari (privat, pdf)';
  END IF;
  PERFORM pg_temp.red_ca(NULL, 'anon', NULL);
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('redari', 'TEST-REDARI-DRY/anon.pdf');
    RAISE EXCEPTION 'TEST9 FAIL: anon a scris in bucket-ul redari';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'redari') <> 0 THEN RAISE EXCEPTION 'TEST9 FAIL: anon vede obiecte in redari'; END IF;
  PERFORM pg_temp.red_ca(v_fara, 'authenticated', 'fara@redari.local');
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('redari', 'TEST-REDARI-DRY/fara.pdf');
    RAISE EXCEPTION 'TEST9 FAIL: contul fara acces a scris in bucket-ul redari';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.red_ca(NULL, 'postgres', NULL);
  RAISE NOTICE 'TEST9 OK storage: 3 politici (SELECT/INSERT/UPDATE, fara DELETE) pe fn_red_nivel, bucket privat, anon si contul fara acces refuzati';
END $t9$;

DO $fin$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261126a_redari_teren:' || txid_current() THEN RAISE EXCEPTION 'DRY FAIL: marcajul s-a pierdut'; END IF;
  RAISE NOTICE 'DRY 20261126a_redari_teren OK (TEST0–TEST9) — totul se anuleaza la ROLLBACK';
END $fin$;
