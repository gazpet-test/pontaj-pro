-- Runner supplies one transaction; no business rows are removed.
-- harness-armare: gazpet.revenire_20261129b REDARI_PV_CREARE_SCOASA
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261129b',true) IS DISTINCT FROM 'REDARI_PV_CREARE_SCOASA:'||txid_current() THEN RAISE EXCEPTION '20261129b: revenire neinarmata'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261129b%') THEN RAISE EXCEPTION '20261129b: armare persistenta'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.red_procese_verbale IN ACCESS EXCLUSIVE MODE;
  IF to_regprocedure('public.fn_red_pv_creeaza(text,uuid,uuid,integer)') IS NULL THEN RAISE EXCEPTION '20261129b: functia lipseste'; END IF;
END $pre$;
DROP INDEX public.red_pv_a_activ_uq;
DROP INDEX public.red_pv_b_activ_uq;
DROP FUNCTION public.fn_red_pv_creeaza(text,uuid,uuid,integer);
DO $post$
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.red_procese_verbale IN ACCESS EXCLUSIVE MODE;
  IF to_regprocedure('public.fn_red_pv_creeaza(text,uuid,uuid,integer)') IS NOT NULL THEN RAISE EXCEPTION '20261129b: revenire incompleta'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE version='20261129120100';
  END IF;
END $post$;
