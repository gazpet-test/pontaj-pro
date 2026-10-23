-- LOCAL ONLY, after unmodified skeletons, BEFORE any migration/stamp.
-- Skeletons need bootstrap for service_role BYPASSRLS, Storage baseline DDL,
-- and the test executor in information_schema. Transfer only fixture objects;
-- never REASSIGN OWNED (which would transfer bootstrap/system objects too).
DO $owners$
DECLARE r record;
BEGIN
  IF current_database() !~ '^[a-z0-9_]+_test$' OR current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION 'prodlike owners: fixture only';
  END IF;
  FOR r IN SELECT nspname FROM pg_namespace
           WHERE nspname IN ('public','auth','teste','supabase_migrations') LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO postgres', r.nspname);
  END LOOP;
  -- Tables first: ownership of their serial sequences follows automatically.
  FOR r IN SELECT c.oid::regclass AS obj FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname IN ('public','auth','teste','supabase_migrations') AND c.relkind IN ('r','p') LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO postgres', r.obj);
  END LOOP;
  FOR r IN SELECT c.oid::regclass AS obj FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname IN ('public','auth','teste','supabase_migrations') AND c.relkind='S' LOOP
    EXECUTE format('ALTER SEQUENCE %s OWNER TO postgres', r.obj);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS obj FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname IN ('public','auth','teste','supabase_migrations') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', r.obj);
  END LOOP;
END $owners$;
ALTER SCHEMA storage OWNER TO supabase_storage_admin;
ALTER FUNCTION storage.foldername(text) OWNER TO supabase_storage_admin;
-- Supabase's direct postgres session can resolve Storage objects. Table ACLs
-- alone do not grant schema USAGE; it must survive the membership revocation.
GRANT USAGE ON SCHEMA storage TO postgres;
-- The baseline already sets storage.objects/buckets owners and exact ACLs.
-- Recreate the skeleton's defaults FOR postgres, rather than the bootstrap user.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO postgres;
-- Earlier E3/E4a artifacts create Storage policies as postgres. Give only this
-- provisioning membership; revoke it before E4b and before taking its baseline.
-- This harness proves E4b delivery/rollback, not non-owner delivery of E3/E4a.
GRANT supabase_storage_admin TO postgres WITH INHERIT TRUE, SET TRUE;
