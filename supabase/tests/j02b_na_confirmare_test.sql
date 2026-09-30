-- ============================================================================
-- J02b — test SQL (BEGIN … ROLLBACK). NU lasă nimic în urmă.
-- Rulează pe o bază cu schema producției (Supabase branch / clonă), NU pe producție înainte de GO:
--   psql "$PGURI" -X -v ON_ERROR_STOP=1 -f supabase/tests/j02b_na_confirmare_test.sql
-- (din rădăcina repo-ului: \i folosește calea relativă a migrării). Fixture: licitația-clonă 103 (Domnești).
-- Ieșire: „J02b TEST PASS” la final; orice eșec ⇒ excepție ⇒ ROLLBACK.
-- ============================================================================
\set ON_ERROR_STOP 1
BEGIN;
SELECT set_config('gazpet.livrare_migrare', '20261004a_ofertare_j02b_na_confirmare_umana:' || txid_current(), true);
\i supabase/migrations/20261004a_ofertare_j02b_na_confirmare_umana.sql

-- cerința-țintă: activă pe 103, doar „nu se aplică” propus de AI, fără dovadă verificată
SELECT c.id AS cid FROM ofertare_cerinte c
 WHERE c.licitatie_id = 103 AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
   AND EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id AND a.status = 'nu_se_aplica')
   AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id AND a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan)
 ORDER BY c.id LIMIT 1 \gset
SELECT id AS owner_id FROM profiles WHERE is_owner ORDER BY id LIMIT 1 \gset

-- T1: AI-only ⇒ neconfirmată
DO $t1$ BEGIN
  IF public.fn_ofertare_cerinta_na_confirmata(:cid, 'nu_se_aplica') THEN RAISE EXCEPTION 'T1 FAIL: AI-only apare confirmată'; END IF;
END $t1$;

-- T2: ACL — anon nu poate executa nimic, authenticated nu poate scrie direct în tabel
DO $t2$ BEGIN
  IF has_function_privilege('anon', 'public.ofertare_confirma_neaplicabil(bigint,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ofertare_cerinta_amprenta(bigint)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.ofertare_cerinte_na_confirmari', 'INSERT')
     OR has_function_privilege('authenticated', 'public.fn_gate_depunere()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T2 FAIL: ACL prea larg';
  END IF;
END $t2$;

-- T3: fără utilizator (auth.uid() NULL) confirmarea e refuzată
DO $t3$ BEGIN
  BEGIN
    PERFORM public.ofertare_confirma_neaplicabil(:cid, 'nu_se_aplica', 'motiv de test', public.fn_ofertare_cerinta_amprenta(:cid));
    RAISE EXCEPTION 'T3 FAIL: confirmare fără actor acceptată';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $t3$;

-- ca utilizator autentificat (owner) prin JWT simulat
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

-- T4: motiv scurt / tip greșit / amprentă stale ⇒ refuz
DO $t4$ DECLARE amp text := public.fn_ofertare_cerinta_amprenta(:cid); BEGIN
  IF amp IS NULL THEN RAISE EXCEPTION 'T4 FAIL: amprenta NULL pentru owner'; END IF;
  BEGIN PERFORM public.ofertare_confirma_neaplicabil(:cid, 'nu_se_aplica', 'x', amp); RAISE EXCEPTION 'T4 FAIL motiv';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.ofertare_confirma_neaplicabil(:cid, 'altceva', 'motiv de test', amp); RAISE EXCEPTION 'T4 FAIL tip';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.ofertare_confirma_neaplicabil(:cid, 'nu_se_aplica', 'motiv de test', md5('altceva')); RAISE EXCEPTION 'T4 FAIL stale';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
END $t4$;

-- T5: confirmare validă ⇒ închisă; view-ul o arată validă; INSERT direct refuzat
DO $t5$ DECLARE v_id bigint; BEGIN
  v_id := public.ofertare_confirma_neaplicabil(:cid, 'nu_se_aplica', 'nu e cazul — test J02b', public.fn_ofertare_cerinta_amprenta(:cid));
  IF NOT public.fn_ofertare_cerinta_na_confirmata(:cid, 'nu_se_aplica') THEN RAISE EXCEPTION 'T5 FAIL: confirmarea nu închide'; END IF;
  IF public.fn_ofertare_cerinta_na_confirmata(:cid, 'exceptat_pt') THEN RAISE EXCEPTION 'T5 FAIL: tipul nu e separat'; END IF;
  IF NOT (SELECT valida FROM v_ofertare_cerinte_na_stare WHERE confirmare_id = v_id) THEN RAISE EXCEPTION 'T5 FAIL: view valida=false'; END IF;
  IF (SELECT actor FROM ofertare_cerinte_na_confirmari WHERE id = v_id) IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'T5 FAIL: actor'; END IF;
  BEGIN
    INSERT INTO ofertare_cerinte_na_confirmari (cerinta_id, tip, actor, motiv, amprenta_sursa)
    VALUES (:cid, 'nu_se_aplica', auth.uid(), 'direct fără RPC', md5('x'));
    RAISE EXCEPTION 'T5 FAIL: INSERT direct acceptat';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $t5$;

RESET ROLE;

-- T6: sursa se schimbă (textul cerinței) ⇒ confirmarea se invalidează automat
UPDATE ofertare_cerinte SET text_cerinta = text_cerinta || ' [modificat test J02b]' WHERE id = :cid;
DO $t6$ BEGIN
  IF public.fn_ofertare_cerinta_na_confirmata(:cid, 'nu_se_aplica') THEN RAISE EXCEPTION 'T6 FAIL: confirmarea a supraviețuit schimbării sursei'; END IF;
  IF (SELECT bool_or(valida) FROM v_ofertare_cerinte_na_stare WHERE cerinta_id = :cid) THEN RAISE EXCEPTION 'T6 FAIL: view valida=true după schimbare'; END IF;
END $t6$;

-- T7: poarta de depunere — cerința AI-only blochează și mesajul numără „nu se aplică” propus de AI
SET LOCAL session_replication_role = replica;  -- doar pentru fixture-ul pachetului (fără matricea de tranziții)
INSERT INTO ofertare_pt_pachet (licitatie_id, versiune, stare) VALUES (103, 9901, 'depus');
UPDATE ofertare_cerinte SET confirmata_de = :'owner_id'::uuid, confirmata_la = now()
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

-- T8: v_ofertare_pt_stare — o legătură 'exceptat' sursa='ai' NU scoate cerința din fara_capitol
DO $t8$ DECLARE v_c bigint; fc0 bigint; fc1 bigint; ep bigint; BEGIN
  SELECT c.id INTO v_c FROM ofertare_cerinte c
   WHERE c.licitatie_id = 103 AND c.tip IN ('propunere','forma') AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
     AND NOT EXISTS (SELECT 1 FROM ofertare_pt_legaturi l WHERE l.cerinta_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id AND a.status IN ('acoperit','acoperit_partener'))
   ORDER BY c.id LIMIT 1;
  IF v_c IS NULL THEN RAISE NOTICE 'T8 SKIP: nicio cerință PT liberă pe 103'; RETURN; END IF;
  SELECT fara_capitol INTO fc0 FROM v_ofertare_pt_stare WHERE licitatie_id = 103;
  INSERT INTO ofertare_pt_legaturi (cerinta_id, capitol_id, fel, motiv, sursa) VALUES (v_c, NULL, 'exceptat', 'test AI', 'ai');
  SELECT fara_capitol, exceptate_propuse_ai INTO fc1, ep FROM v_ofertare_pt_stare WHERE licitatie_id = 103;
  IF fc1 <> fc0 OR ep < 1 THEN RAISE EXCEPTION 'T8 FAIL: exceptarea AI a închis cerința (fc % → %, propuse %)', fc0, fc1, ep; END IF;
  INSERT INTO ofertare_cerinte_na_confirmari (cerinta_id, tip, actor, motiv, amprenta_sursa)
  VALUES (v_c, 'exceptat_pt', :'owner_id'::uuid, 'confirmat test J02b', public.fn_ofertare_cerinta_amprenta(v_c));
  SELECT fara_capitol INTO fc1 FROM v_ofertare_pt_stare WHERE licitatie_id = 103;
  IF fc1 <> fc0 - 1 THEN RAISE EXCEPTION 'T8 FAIL: confirmarea umană nu închide (fc % → %)', fc0, fc1; END IF;
END $t8$;

SELECT 'J02b TEST PASS' AS rezultat;
ROLLBACK;
