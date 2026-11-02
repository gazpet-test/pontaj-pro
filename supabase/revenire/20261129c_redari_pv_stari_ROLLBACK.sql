-- Runner supplies one transaction. No business rows are removed.
-- harness-armare: gazpet.revenire_20261129c REDARI_PV_STARI_SCOASA
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261129c',true) IS DISTINCT FROM 'REDARI_PV_STARI_SCOASA:'||txid_current() THEN RAISE EXCEPTION '20261129c: revenire neinarmata'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261129c%') THEN RAISE EXCEPTION '20261129c: armare persistenta'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.red_procese_verbale IN ACCESS EXCLUSIVE MODE;
  IF to_regprocedure('public.fn_red_pv_stare_tranzitie()') IS NULL THEN RAISE EXCEPTION '20261129c: functia lipseste'; END IF;
END $pre$;
DROP TRIGGER red_pv_stare_tranzitie ON public.red_procese_verbale;
DROP FUNCTION public.fn_red_pv_stare_tranzitie();
DO $post$
BEGIN
  IF to_regprocedure('public.fn_red_pv_stare_tranzitie()') IS NOT NULL OR EXISTS
    (SELECT 1 FROM pg_trigger WHERE tgrelid='public.red_procese_verbale'::regclass AND tgname='red_pv_stare_tranzitie') THEN RAISE EXCEPTION '20261129c: revenire incompleta'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE version='20261129120200';
  END IF;
END $post$;
