-- REVENIRE 20261024a — redeschide citirea PDF-urilor din contracte-terti pentru ORICE authenticated (starea dinainte, cu gaura).
-- DOAR la cererea explicită a lui Răzvan. Armare per tranzacție: SELECT set_config('gazpet.revenire_20261024a', 'CONTRACTE_STORAGE_SELECT_REVENIRE:' || txid_current(), true);
-- Copilot r1 (P1-2): starea restrânsă e constanta exactă c_nou (artefactul aplicat), nu politica UPDATE live; (P1-3) gardă finală + dezarmare.
DO $revenire$
DECLARE
  c_vechi CONSTANT text := '(bucket_id = ''contracte-terti''::text)';
  c_nou   CONSTANT text := '((bucket_id = ''contracte-terti''::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_manage_contracts = true))))))';
  v_q     text;
  v_w     text;
BEGIN
  IF current_setting('gazpet.revenire_20261024a', true)
       IS DISTINCT FROM 'CONTRACTE_STORAGE_SELECT_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261024a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261024a=%') THEN
    RAISE EXCEPTION '20261024a: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261024a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid) INTO v_q, v_w
    FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'contracte_terti_storage_select'
     AND p.polcmd = 'r' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid];
  IF NOT FOUND OR v_q IS DISTINCT FROM c_nou OR v_w IS NOT NULL THEN
    RAISE EXCEPTION '20261024a: preconditie, SELECT nu e in starea restransa (c_nou)';
  END IF;
  EXECUTE format('ALTER POLICY contracte_terti_storage_select ON storage.objects USING %s', c_vechi);
  SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid) INTO v_q, v_w
    FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'contracte_terti_storage_select'
     AND p.polcmd = 'r' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid];
  IF NOT FOUND OR v_q IS DISTINCT FROM c_vechi OR v_w IS NOT NULL THEN
    RAISE EXCEPTION '20261024a: postconditie revenire';
  END IF;
  IF current_setting('gazpet.revenire_20261024a', true)
       IS DISTINCT FROM 'CONTRACTE_STORAGE_SELECT_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261024a: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261024a', '', true);
END $revenire$;
