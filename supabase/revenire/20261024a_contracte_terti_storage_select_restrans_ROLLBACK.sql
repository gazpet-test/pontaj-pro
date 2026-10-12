-- REVENIRE 20261024a — redeschide citirea PDF-urilor din contracte-terti pentru ORICE authenticated (starea dinainte, cu gaura).
-- DOAR la cererea explicită a lui Răzvan. Armare per tranzacție: SELECT set_config('gazpet.revenire_20261024a', 'CONTRACTE_STORAGE_SELECT_REVENIRE:' || txid_current(), true);
DO $revenire$
DECLARE
  c_vechi CONSTANT text := '(bucket_id = ''contracte-terti''::text)';
  v_nou   text;
  v_q     text;
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
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_nou FROM pg_policy p
   WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'contracte_terti_storage_update' AND p.polcmd = 'w';
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_q FROM pg_policy p
   WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'contracte_terti_storage_select' AND p.polcmd = 'r'
     AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid];
  IF v_q IS NULL OR v_q IS DISTINCT FROM v_nou THEN
    RAISE EXCEPTION '20261024a: preconditie, SELECT nu e in starea restransa';
  END IF;
  EXECUTE format('ALTER POLICY contracte_terti_storage_select ON storage.objects USING %s', c_vechi);
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_q FROM pg_policy p
   WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'contracte_terti_storage_select';
  IF v_q IS DISTINCT FROM c_vechi THEN RAISE EXCEPTION '20261024a: postconditie revenire'; END IF;
END $revenire$;
