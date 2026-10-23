-- Run through a DIRECT -U postgres connection before/after E4b and rollback.
SELECT rolsuper FROM pg_roles WHERE rolname = 'postgres'; -- must print f
DO $check$
DECLARE r record; v_refused boolean := false;
BEGIN
  IF current_database() !~ '^[a-z0-9_]+_test$'
     OR session_user <> 'postgres' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'prodlike: direct postgres fixture connection required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres'
                 AND NOT rolsuper AND rolcreaterole AND rolbypassrls AND rolcanlogin) THEN
    RAISE EXCEPTION 'prodlike: postgres attributes incorrect';
  END IF;
  IF pg_has_role('postgres','supabase_admin','MEMBER')
     OR pg_has_role('postgres','supabase_storage_admin','MEMBER') THEN
    RAISE EXCEPTION 'prodlike: privileged provisioning membership remains';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('storage.objects'::regclass,'storage.buckets'::regclass)
              AND relowner <> 'supabase_storage_admin'::regrole)
     OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','S')
                 AND relowner <> 'postgres'::regrole)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
                 AND proowner='supabase_admin'::regrole) THEN
    RAISE EXCEPTION 'prodlike: fixture ownership incorrect';
  END IF;
  FOR r IN SELECT rolname FROM (VALUES ('izo_registru_writer'),('izo_montaj_writer')) AS expected(rolname) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r.rolname) THEN
      RAISE EXCEPTION 'prodlike: missing writer %', r.rolname;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid=r.rolname::regrole
                     AND member='postgres'::regrole AND set_option AND NOT inherit_option)
       OR EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid=r.rolname::regrole AND inherit_option) THEN
      RAISE EXCEPTION 'prodlike: invalid writer membership %', r.rolname;
    END IF;
  END LOOP;
  BEGIN
    -- Successful DDL must never escape this subtransaction, even on regression.
    ALTER TABLE storage.objects ADD COLUMN izo_e4b_owner_probe boolean;
    RAISE EXCEPTION 'prodlike: Storage ALTER unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%must be owner of table objects%' THEN
      RAISE EXCEPTION 'prodlike: wrong Storage refusal: %', SQLERRM;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'prodlike: Storage owner probe failed'; END IF;
  RAISE NOTICE 'OK prodlike: postgres NOSUPERUSER; Storage ALTER must be owner';
END $check$;
