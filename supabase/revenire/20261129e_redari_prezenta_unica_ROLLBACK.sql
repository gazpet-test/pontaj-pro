-- Runner supplies one transaction. No business rows are removed.
-- harness-armare: gazpet.revenire_20261129e REDARI_PREZENTA_UNICA_SCOASA
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261129e',true) IS DISTINCT FROM 'REDARI_PREZENTA_UNICA_SCOASA:'||txid_current() THEN RAISE EXCEPTION '20261129e: revenire neinarmata'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261129e%') THEN RAISE EXCEPTION '20261129e: armare persistenta'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  IF to_regclass('public.red_raspunsuri_prezenta_uq') IS NULL THEN RAISE EXCEPTION '20261129e: indexul lipseste'; END IF;
END $pre$;
DROP INDEX public.red_raspunsuri_prezenta_uq;
DO $post$
BEGIN
  IF to_regclass('public.red_raspunsuri_prezenta_uq') IS NOT NULL THEN RAISE EXCEPTION '20261129e: revenire incompleta'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE version='20261129120400';
  END IF;
END $post$;
