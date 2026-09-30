-- ============================================================================
-- J02b — test SQL (BEGIN … ROLLBACK). NU lasă nimic în urmă.
-- Rulează pe o bază cu schema producției (Supabase branch / clonă), NU pe producție înainte de GO:
--   psql "$PGURI" -X -v ON_ERROR_STOP=1 -f supabase/tests/j02b_na_confirmare_test.sql
-- (din rădăcina repo-ului: \i folosește calea relativă a migrării). Local, același fișier îl rulează
-- scripts/test_j02b_na_confirmare.mjs pe un fixture determinist (licitația 103 construită de harness).
-- Fixture cerut pe licitația 103 (lipsă = FAIL, niciun test nu se sare):
--   F1: o cerință activă cu „nu se aplică” propus de AI și fără dovadă verificată;
--   F2: o cerință activă fără niciun rând de acoperire;
--   F3: o cerință PT (propunere/forma) activă, fără legături și fără acoperire „acoperit”.
-- Ieșire: „J02b TEST PASS” la final; orice eșec ⇒ excepție ⇒ ROLLBACK.
-- Notă: variabilele psql NU se interpolează în blocurile DO ($…$) ⇒ fixture-ul trece prin GUC-uri j02b_t.*.
-- ============================================================================
\set ON_ERROR_STOP 1
BEGIN;
SELECT set_config('gazpet.livrare_migrare', '20261004a_ofertare_j02b_na_confirmare_umana:' || txid_current(), true) \g /dev/null
\i supabase/migrations/20261004a_ofertare_j02b_na_confirmare_umana.sql

-- Fixture (determinist: cel mai mic id care îndeplinește condiția; lipsă ⇒ FAIL)
DO $fx$
DECLARE v_cid bigint; v_cid2 bigint; v_c bigint; v_owner uuid;
BEGIN
  SELECT c.id INTO v_cid FROM ofertare_cerinte c
   WHERE c.licitatie_id = 103 AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
     AND EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id AND a.status = 'nu_se_aplica')
     AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id AND a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan)
   ORDER BY c.id LIMIT 1;
  SELECT c.id INTO v_cid2 FROM ofertare_cerinte c
   WHERE c.licitatie_id = 103 AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
     AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id)
   ORDER BY c.id LIMIT 1;
  SELECT c.id INTO v_c FROM ofertare_cerinte c
   WHERE c.licitatie_id = 103 AND c.tip IN ('propunere','forma') AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
     AND NOT EXISTS (SELECT 1 FROM ofertare_pt_legaturi l WHERE l.cerinta_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id AND a.status IN ('acoperit','acoperit_partener'))
   ORDER BY c.id LIMIT 1;
  SELECT id INTO v_owner FROM profiles WHERE is_owner ORDER BY id LIMIT 1;
  IF v_cid IS NULL OR v_cid2 IS NULL OR v_c IS NULL OR v_owner IS NULL THEN
    RAISE EXCEPTION 'FIXTURE FAIL: licitația 103 nu are F1/F2/F3 sau lipsește ownerul (F1 %, F2 %, F3 %, owner %)', v_cid, v_cid2, v_c, v_owner;
  END IF;
  PERFORM set_config('j02b_t.cid', v_cid::text, true), set_config('j02b_t.cid2', v_cid2::text, true),
          set_config('j02b_t.cpt', v_c::text, true), set_config('j02b_t.owner', v_owner::text, true);
END $fx$;

-- T1: AI-only ⇒ neconfirmată
DO $t1$ BEGIN
  IF public.fn_ofertare_cerinta_na_confirmata(current_setting('j02b_t.cid')::bigint, 'nu_se_aplica') THEN RAISE EXCEPTION 'T1 FAIL: AI-only apare confirmată'; END IF;
END $t1$;

-- T2: ACL — anon nimic; authenticated și service_role doar SELECT pe tabel; RPC-urile doar authenticated
DO $t2$ DECLARE rol text; pr text; BEGIN
  FOREACH rol IN ARRAY ARRAY['authenticated','service_role','anon'] LOOP
    FOREACH pr IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF has_table_privilege(rol, 'public.ofertare_cerinte_na_confirmari', pr) THEN RAISE EXCEPTION 'T2 FAIL: % are % pe tabel', rol, pr; END IF;
    END LOOP;
  END LOOP;
  IF has_table_privilege('anon', 'public.ofertare_cerinte_na_confirmari', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.ofertare_cerinte_na_confirmari', 'SELECT')
     OR has_function_privilege('anon', 'public.ofertare_confirma_neaplicabil(bigint,text,text,text,bigint)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.ofertare_confirma_neaplicabil(bigint,text,text,text,bigint)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.ofertare_revoca_neaplicabil(bigint,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ofertare_cerinta_amprenta(bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ofertare_na_propunere_curenta(bigint,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_gate_depunere()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T2 FAIL: ACL prea larg';
  END IF;
END $t2$;

-- T3: fără utilizator (auth.uid() NULL) confirmarea e refuzată
DO $t3$ DECLARE v_cid bigint := current_setting('j02b_t.cid')::bigint; BEGIN
  BEGIN
    PERFORM public.ofertare_confirma_neaplicabil(v_cid, 'nu_se_aplica', 'motiv de test', public.fn_ofertare_cerinta_amprenta(v_cid),
      (SELECT propunere_id FROM public.fn_ofertare_na_propunere_curenta(v_cid, 'nu_se_aplica')));
    RAISE EXCEPTION 'T3 FAIL: confirmare fără actor acceptată';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $t3$;

-- T3b: service_role (fără actor) nu poate scrie direct în tabel și nu poate chema RPC-ul
SET LOCAL ROLE service_role;
DO $t3b$ BEGIN
  BEGIN
    INSERT INTO ofertare_cerinte_na_confirmari (cerinta_id, tip, actor, motiv, amprenta_sursa)
    VALUES (current_setting('j02b_t.cid')::bigint, 'nu_se_aplica', current_setting('j02b_t.owner')::uuid, 'direct service_role', md5('x'));
    RAISE EXCEPTION 'T3b FAIL: service_role a scris direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM ofertare_cerinte_na_confirmari;
    RAISE EXCEPTION 'T3b FAIL: service_role a putut DELETE';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.ofertare_revoca_neaplicabil(1, 'motiv de test');
    RAISE EXCEPTION 'T3b FAIL: service_role a chemat revocarea';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $t3b$;
RESET ROLE;

-- ca utilizator autentificat (owner) prin JWT simulat
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('j02b_t.owner'), 'role', 'authenticated')::text, true) \g /dev/null
SET LOCAL ROLE authenticated;

-- T4: motiv scurt / tip greșit / amprentă stale / propunere stale ⇒ refuz
DO $t4$ DECLARE v_cid bigint := current_setting('j02b_t.cid')::bigint; amp text := public.fn_ofertare_cerinta_amprenta(v_cid);
  pid bigint := (SELECT propunere_id FROM public.fn_ofertare_na_propunere_curenta(v_cid, 'nu_se_aplica')); BEGIN
  IF amp IS NULL OR pid IS NULL THEN RAISE EXCEPTION 'T4 FAIL: amprenta/propunerea NULL pentru owner'; END IF;
  BEGIN PERFORM public.ofertare_confirma_neaplicabil(v_cid, 'nu_se_aplica', 'x', amp, pid); RAISE EXCEPTION 'T4 FAIL motiv';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.ofertare_confirma_neaplicabil(v_cid, 'altceva', 'motiv de test', amp, pid); RAISE EXCEPTION 'T4 FAIL tip';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.ofertare_confirma_neaplicabil(v_cid, 'nu_se_aplica', 'motiv de test', md5('altceva'), pid); RAISE EXCEPTION 'T4 FAIL stale amprentă';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN PERFORM public.ofertare_confirma_neaplicabil(v_cid, 'nu_se_aplica', 'motiv de test', amp, NULL); RAISE EXCEPTION 'T4 FAIL: confirmare fără propunerea AI existentă';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN PERFORM public.ofertare_confirma_neaplicabil(v_cid, 'nu_se_aplica', 'motiv de test', amp, pid + 100000000); RAISE EXCEPTION 'T4 FAIL: propunere străină';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN PERFORM public.ofertare_confirma_neaplicabil(v_cid, 'exceptat_pt', 'motiv de test', amp, NULL); RAISE EXCEPTION 'T4 FAIL: exceptat fără legătură';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $t4$;

-- T5: confirmare validă ⇒ închisă; legată de rândul AI; view valida; scriere directă refuzată
DO $t5$ DECLARE v_cid bigint := current_setting('j02b_t.cid')::bigint; v_id bigint; v_id2 bigint;
  pid bigint := (SELECT propunere_id FROM public.fn_ofertare_na_propunere_curenta(v_cid, 'nu_se_aplica')); BEGIN
  v_id := public.ofertare_confirma_neaplicabil(v_cid, 'nu_se_aplica', 'nu e cazul — test J02b', public.fn_ofertare_cerinta_amprenta(v_cid), pid);
  IF NOT public.fn_ofertare_cerinta_na_confirmata(v_cid, 'nu_se_aplica') THEN RAISE EXCEPTION 'T5 FAIL: confirmarea nu închide'; END IF;
  IF public.fn_ofertare_cerinta_na_confirmata(v_cid, 'exceptat_pt') THEN RAISE EXCEPTION 'T5 FAIL: tipul nu e separat'; END IF;
  IF NOT (SELECT valida FROM v_ofertare_cerinte_na_stare WHERE confirmare_id = v_id) THEN RAISE EXCEPTION 'T5 FAIL: view valida=false'; END IF;
  IF (SELECT actor FROM ofertare_cerinte_na_confirmari WHERE id = v_id) IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'T5 FAIL: actor'; END IF;
  IF (SELECT acoperire_id FROM ofertare_cerinte_na_confirmari WHERE id = v_id) IS DISTINCT FROM pid THEN RAISE EXCEPTION 'T5 FAIL: nu e legată de rândul AI'; END IF;
  BEGIN
    INSERT INTO ofertare_cerinte_na_confirmari (cerinta_id, tip, actor, motiv, amprenta_sursa)
    VALUES (v_cid, 'nu_se_aplica', auth.uid(), 'direct fără RPC', md5('x'));
    RAISE EXCEPTION 'T5 FAIL: INSERT direct acceptat';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE ofertare_cerinte_na_confirmari SET revocata_la = NULL WHERE id = v_id;
    RAISE EXCEPTION 'T5 FAIL: UPDATE direct acceptat';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- T5b: idempotent — aceeași confirmare ⇒ același id, un singur rând activ
  v_id2 := public.ofertare_confirma_neaplicabil(v_cid, 'nu_se_aplica', 'a doua oară — test J02b', public.fn_ofertare_cerinta_amprenta(v_cid), pid);
  IF v_id2 <> v_id THEN RAISE EXCEPTION 'T5b FAIL: confirmarea repetată a creat alt rând (% vs %)', v_id2, v_id; END IF;
  IF (SELECT count(*) FROM ofertare_cerinte_na_confirmari WHERE cerinta_id = v_cid AND tip = 'nu_se_aplica' AND revocata_la IS NULL) <> 1 THEN
    RAISE EXCEPTION 'T5b FAIL: duplicate active';
  END IF;
  -- T5c: revocare ⇒ helper=false; reconfirmarea după revocare e permisă (rând nou)
  PERFORM public.ofertare_revoca_neaplicabil(v_id, 'revocat — test J02b');
  IF public.fn_ofertare_cerinta_na_confirmata(v_cid, 'nu_se_aplica') THEN RAISE EXCEPTION 'T5c FAIL: revocarea nu redeschide'; END IF;
  IF (SELECT valida FROM v_ofertare_cerinte_na_stare WHERE confirmare_id = v_id) THEN RAISE EXCEPTION 'T5c FAIL: view valida după revocare'; END IF;
  BEGIN PERFORM public.ofertare_revoca_neaplicabil(v_id, 'a doua revocare'); RAISE EXCEPTION 'T5c FAIL: revocare dublă';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  v_id2 := public.ofertare_confirma_neaplicabil(v_cid, 'nu_se_aplica', 'reconfirmat — test J02b', public.fn_ofertare_cerinta_amprenta(v_cid), pid);
  IF v_id2 = v_id OR NOT public.fn_ofertare_cerinta_na_confirmata(v_cid, 'nu_se_aplica') THEN RAISE EXCEPTION 'T5c FAIL: reconfirmarea după revocare'; END IF;
  PERFORM set_config('j02b_t.conf', v_id2::text, true);
END $t5$;

-- T5d: propunere AI NOUĂ (B după A) pe aceeași cerință ⇒ confirmarea lui A nu se moștenește
RESET ROLE;
INSERT INTO ofertare_acoperire (cerinta_id, mod, status) VALUES (current_setting('j02b_t.cid')::bigint, 'nu_se_aplica', 'nu_se_aplica');
SET LOCAL ROLE authenticated;
DO $t5d$ DECLARE v_cid bigint := current_setting('j02b_t.cid')::bigint; pid bigint; BEGIN
  IF public.fn_ofertare_cerinta_na_confirmata(v_cid, 'nu_se_aplica') THEN RAISE EXCEPTION 'T5d FAIL: propunerea AI nouă a moștenit confirmarea'; END IF;
  pid := (SELECT propunere_id FROM public.fn_ofertare_na_propunere_curenta(v_cid, 'nu_se_aplica'));
  PERFORM public.ofertare_confirma_neaplicabil(v_cid, 'nu_se_aplica', 'confirm propunerea B — test', public.fn_ofertare_cerinta_amprenta(v_cid), pid);
  IF NOT public.fn_ofertare_cerinta_na_confirmata(v_cid, 'nu_se_aplica') THEN RAISE EXCEPTION 'T5d FAIL: confirmarea lui B nu închide'; END IF;
END $t5d$;

-- T5e: „nu se aplică” fără nicio propunere AI (F2) ⇒ confirmare pe „nicio propunere”; o propunere AI ulterioară o invalidează
DO $t5e$ DECLARE v bigint := current_setting('j02b_t.cid2')::bigint; BEGIN
  PERFORM public.ofertare_confirma_neaplicabil(v, 'nu_se_aplica', 'decizie umană fără AI — test', public.fn_ofertare_cerinta_amprenta(v), NULL);
  IF NOT public.fn_ofertare_cerinta_na_confirmata(v, 'nu_se_aplica') THEN RAISE EXCEPTION 'T5e FAIL: confirmarea fără propunere nu închide'; END IF;
END $t5e$;
RESET ROLE;
INSERT INTO ofertare_acoperire (cerinta_id, mod, status) VALUES (current_setting('j02b_t.cid2')::bigint, 'nu_se_aplica', 'nu_se_aplica');
DO $t5e2$ BEGIN
  IF public.fn_ofertare_cerinta_na_confirmata(current_setting('j02b_t.cid2')::bigint, 'nu_se_aplica') THEN
    RAISE EXCEPTION 'T5e FAIL: propunerea AI apărută după decizia umană a moștenit-o';
  END IF;
END $t5e2$;

-- T6: sursa se schimbă (textul cerinței) ⇒ confirmarea se invalidează automat; reconfirmarea pe amprenta nouă e permisă
UPDATE ofertare_cerinte SET text_cerinta = text_cerinta || ' [modificat test J02b]' WHERE id = current_setting('j02b_t.cid')::bigint;
SET LOCAL ROLE authenticated;
DO $t6$ DECLARE v_cid bigint := current_setting('j02b_t.cid')::bigint; BEGIN
  IF public.fn_ofertare_cerinta_na_confirmata(v_cid, 'nu_se_aplica') THEN RAISE EXCEPTION 'T6 FAIL: confirmarea a supraviețuit schimbării sursei'; END IF;
  IF (SELECT bool_or(valida) FROM v_ofertare_cerinte_na_stare WHERE cerinta_id = v_cid) THEN RAISE EXCEPTION 'T6 FAIL: view valida=true după schimbare'; END IF;
  PERFORM public.ofertare_confirma_neaplicabil(v_cid, 'nu_se_aplica', 'reconfirmat pe sursa nouă — test', public.fn_ofertare_cerinta_amprenta(v_cid),
    (SELECT propunere_id FROM public.fn_ofertare_na_propunere_curenta(v_cid, 'nu_se_aplica')));
  IF NOT public.fn_ofertare_cerinta_na_confirmata(v_cid, 'nu_se_aplica') THEN RAISE EXCEPTION 'T6 FAIL: reconfirmarea pe amprenta nouă nu închide'; END IF;
END $t6$;
RESET ROLE;

-- T7: poarta de depunere — cerințele AI-only blochează și mesajul numără „nu se aplică” propus de AI
SET LOCAL session_replication_role = replica;  -- doar pentru fixture-ul pachetului (fără matricea de tranziții)
INSERT INTO ofertare_pt_pachet (licitatie_id, versiune, stare) VALUES (103, 9901, 'depus');
UPDATE ofertare_cerinte SET confirmata_de = current_setting('j02b_t.owner')::uuid, confirmata_la = now()
 WHERE licitatie_id = 103 AND inlocuita_de IS NULL AND duplicat_al IS NULL AND confirmata_de IS NULL;
SET LOCAL session_replication_role = origin;
DO $t7$ DECLARE m text; BEGIN
  BEGIN
    UPDATE ofertare_licitatii SET status = 'depusa', derogare_depunere = false WHERE id = 103;
    RAISE EXCEPTION 'T7 FAIL: poarta a trecut cu cerințe închise doar de AI';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS m = MESSAGE_TEXT;
    IF m NOT LIKE 'BLOCAT LA DEPUNERE:%propus de AI%' THEN RAISE EXCEPTION 'T7 FAIL: alt mesaj: %', m; END IF;
    IF substring(m FROM 'din ele ([0-9]+) au doar')::int < 1 THEN RAISE EXCEPTION 'T7 FAIL: contor n_na_ai = 0: %', m; END IF;
  END;
END $t7$;

-- T8: v_ofertare_pt_stare — exceptarea AI nu scade fara_capitol; confirmarea umană pe legătura A da;
--     legătura NOUĂ B (după A) ⇒ neconfirmată; modificarea legăturii confirmate ⇒ neconfirmată. Fixture F3 obligatoriu.
DO $t8a$ DECLARE v_c bigint := current_setting('j02b_t.cpt')::bigint; fc0 bigint; fc1 bigint; ep bigint; v_a bigint; BEGIN
  SELECT fara_capitol INTO fc0 FROM v_ofertare_pt_stare WHERE licitatie_id = 103;
  IF fc0 IS NULL OR fc0 < 1 THEN RAISE EXCEPTION 'T8 FAIL (fixture): fara_capitol pe 103 = % (F3 trebuie să fie numărată)', fc0; END IF;
  INSERT INTO ofertare_pt_legaturi (cerinta_id, capitol_id, fel, motiv, sursa) VALUES (v_c, NULL, 'exceptat', 'test AI A', 'ai') RETURNING id INTO v_a;
  SELECT fara_capitol, exceptate_propuse_ai INTO fc1, ep FROM v_ofertare_pt_stare WHERE licitatie_id = 103;
  IF fc1 <> fc0 OR ep < 1 THEN RAISE EXCEPTION 'T8 FAIL: exceptarea AI a închis cerința (fc % → %, propuse %)', fc0, fc1, ep; END IF;
  PERFORM set_config('j02b_t.fc0', fc0::text, true), set_config('j02b_t.leg_a', v_a::text, true);
END $t8a$;
SET LOCAL ROLE authenticated;
DO $t8b$ DECLARE v_c bigint := current_setting('j02b_t.cpt')::bigint; fc0 bigint := current_setting('j02b_t.fc0')::bigint; fc1 bigint; BEGIN
  -- confirmarea cere legătura concretă: alt id ⇒ refuz
  BEGIN PERFORM public.ofertare_confirma_neaplicabil(v_c, 'exceptat_pt', 'confirmat test J02b', public.fn_ofertare_cerinta_amprenta(v_c), current_setting('j02b_t.leg_a')::bigint + 1);
    RAISE EXCEPTION 'T8 FAIL: confirmare pe altă legătură acceptată';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  PERFORM public.ofertare_confirma_neaplicabil(v_c, 'exceptat_pt', 'confirmat test J02b', public.fn_ofertare_cerinta_amprenta(v_c), current_setting('j02b_t.leg_a')::bigint);
  SELECT fara_capitol INTO fc1 FROM v_ofertare_pt_stare WHERE licitatie_id = 103;
  IF fc1 <> fc0 - 1 THEN RAISE EXCEPTION 'T8 FAIL: confirmarea umană nu închide (fc % → %)', fc0, fc1; END IF;
  IF (SELECT legatura_id FROM ofertare_cerinte_na_confirmari WHERE cerinta_id = v_c AND tip = 'exceptat_pt' AND revocata_la IS NULL) <> current_setting('j02b_t.leg_a')::bigint THEN
    RAISE EXCEPTION 'T8 FAIL: confirmarea nu memorează legatura_id';
  END IF;
END $t8b$;
RESET ROLE;
INSERT INTO ofertare_pt_legaturi (cerinta_id, capitol_id, fel, motiv, sursa) VALUES (current_setting('j02b_t.cpt')::bigint, NULL, 'exceptat', 'test AI B (replay)', 'ai');
DO $t8c$ DECLARE v_c bigint := current_setting('j02b_t.cpt')::bigint; fc0 bigint := current_setting('j02b_t.fc0')::bigint; fc1 bigint; BEGIN
  SELECT fara_capitol INTO fc1 FROM v_ofertare_pt_stare WHERE licitatie_id = 103;
  IF fc1 <> fc0 OR public.fn_ofertare_cerinta_na_confirmata(v_c, 'exceptat_pt') THEN
    RAISE EXCEPTION 'T8 FAIL (replay): legătura nouă B a moștenit confirmarea lui A (fc % → %)', fc0, fc1;
  END IF;
END $t8c$;
SET LOCAL ROLE authenticated;
DO $t8d$ DECLARE v_c bigint := current_setting('j02b_t.cpt')::bigint; fc0 bigint := current_setting('j02b_t.fc0')::bigint; fc1 bigint; BEGIN
  PERFORM public.ofertare_confirma_neaplicabil(v_c, 'exceptat_pt', 'confirm B — test J02b', public.fn_ofertare_cerinta_amprenta(v_c),
    (SELECT propunere_id FROM public.fn_ofertare_na_propunere_curenta(v_c, 'exceptat_pt')));
  SELECT fara_capitol INTO fc1 FROM v_ofertare_pt_stare WHERE licitatie_id = 103;
  IF fc1 <> fc0 - 1 THEN RAISE EXCEPTION 'T8 FAIL: confirmarea lui B nu închide (fc % → %)', fc0, fc1; END IF;
END $t8d$;
RESET ROLE;
UPDATE ofertare_pt_legaturi SET motiv = motiv || ' [editat]' WHERE id = (SELECT max(id) FROM ofertare_pt_legaturi WHERE cerinta_id = current_setting('j02b_t.cpt')::bigint AND fel = 'exceptat');
DO $t8e$ BEGIN
  IF public.fn_ofertare_cerinta_na_confirmata(current_setting('j02b_t.cpt')::bigint, 'exceptat_pt') THEN
    RAISE EXCEPTION 'T8 FAIL: confirmarea a supraviețuit modificării legăturii confirmate';
  END IF;
END $t8e$;

SELECT 'J02b TEST PASS' AS rezultat;
ROLLBACK;
