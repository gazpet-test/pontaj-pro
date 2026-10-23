-- LOCAL ONLY: connected as initdb's supabase_admin, before creating *_test.
-- postgres stays NOSUPERUSER throughout; no membership of bootstrap/system roles.
DO $check$ BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'supabase_admin'
     OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'prodlike bootstrap: unexpected connection';
  END IF;
END $check$;
CREATE ROLE postgres NOSUPERUSER CREATEROLE BYPASSRLS LOGIN
  INHERIT NOCREATEDB NOREPLICATION;
-- No CREATEDB is needed: supabase_admin creates the test database for postgres.
-- pg_control_system is restricted by default in PG16; the delivery protocol
-- explicitly requires it (system_identifier). Narrow fixture grant, no pg_monitor.
-- This ACL must also be granted in the test DB; function ACLs are per-database.
