-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261024a — Storage contracte-terti: citirea (SELECT) PDF-urilor se restrânge la owner + can_manage_contracts
-- (decizia Răzvan 12.10.2026, prin chat: „Da pe lista de PDF-uri”; Mirela Popescu și Răzvan Toma pierd și ei accesul).
-- Azi: contracte_terti_storage_select = doar bucket_id = 'contracte-terti' pentru ORICE authenticated (156 obiecte, 31 profile).
-- După: aceeași expresie ca la UPDATE (owner OR can_manage_contracts). Rămân 10 profile: 2 owneri + 8 cu can_manage_contracts.
-- Schimbă DOAR expresia USING a unei politici existente. Fără obiecte noi, fără date, fără GRANT-uri; nu atinge
-- user_module_access sau can_manage_contracts. Edge-urile cu service_role nu sunt afectate (ocolesc RLS).
-- Copilot r1 (NO-GO, P1-1): expresia nouă e o constantă exactă, comparată cu politica UPDATE live — fără LIKE euristic.
-- Pre/post: expresiile exacte; altfel refuz atomic. Revenire: supabase/revenire/20261024a_contracte_terti_storage_select_restrans_ROLLBACK.sql.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $migrare$
DECLARE
  c_vechi CONSTANT text := '(bucket_id = ''contracte-terti''::text)';
  c_nou   CONSTANT text := '((bucket_id = ''contracte-terti''::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_manage_contracts = true))))))';
  v_q     text;
  v_w     text;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261024a_contracte_terti_storage_select_restrans:' || txid_current() THEN
    RAISE EXCEPTION '20261024a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261024a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'contracte_terti_storage_%') <> 4 THEN
    RAISE EXCEPTION '20261024a: numar politici contracte_terti_storage_* neasteptat';
  END IF;
  -- politica UPDATE live trebuie sa fie EXACT c_nou (USING), fara WITH CHECK
  SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid) INTO v_q, v_w
    FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'contracte_terti_storage_update'
     AND p.polcmd = 'w' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid];
  IF NOT FOUND OR v_q IS DISTINCT FROM c_nou OR v_w IS NOT NULL THEN
    RAISE EXCEPTION '20261024a: preconditie contracte_terti_storage_update (expresie diferita de c_nou)';
  END IF;
  SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid) INTO v_q, v_w
    FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'contracte_terti_storage_select'
     AND p.polcmd = 'r' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid];
  IF NOT FOUND OR v_q IS DISTINCT FROM c_vechi OR v_w IS NOT NULL THEN
    RAISE EXCEPTION '20261024a: preconditie contracte_terti_storage_select';
  END IF;
  EXECUTE format('ALTER POLICY contracte_terti_storage_select ON storage.objects USING %s', c_nou);
  SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid) INTO v_q, v_w
    FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'contracte_terti_storage_select'
     AND p.polcmd = 'r' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid];
  IF NOT FOUND OR v_q IS DISTINCT FROM c_nou OR v_w IS NOT NULL THEN
    RAISE EXCEPTION '20261024a: postconditie contracte_terti_storage_select';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261024a_contracte_terti_storage_select_restrans:' || txid_current() THEN
    RAISE EXCEPTION '20261024a: garda final invalida';
  END IF;
END $migrare$;
