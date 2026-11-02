-- REVENIRE armată, nu migrare. Operatorul gestionează o singură tranzacție:
-- BEGIN;
-- SELECT set_config('gazpet.revenire_20261128a', 'REDARI_LEGATURA_EXECUTIE_SCOASA:' || txid_current(), true);
-- Opțional, DOAR la decizia lui Răzvan: set_config('gazpet.revenire_20261128a_forta', 'DA', true).
-- <acest fișier>; COMMIT;
-- harness-armare: gazpet.revenire_20261128a REDARI_LEGATURA_EXECUTIE_SCOASA
DO $pre$
BEGIN
  IF current_setting('gazpet.revenire_20261128a', true) IS DISTINCT FROM 'REDARI_LEGATURA_EXECUTIE_SCOASA:' || txid_current() THEN
    RAISE EXCEPTION '20261128a revenire: neinarmata';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261128a revenire: necesita postgres'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261128a%') THEN
    RAISE EXCEPTION '20261128a revenire: armare persistenta — refuz';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte'
      AND column_name IN ('executie_proiect_id', 'link_informare_gdpr')) <> 2 THEN RAISE EXCEPTION '20261128a revenire: migrarea nu e aplicata integral'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_proiecte WHERE executie_proiect_id IS NOT NULL OR link_informare_gdpr IS NOT NULL)
      AND current_setting('gazpet.revenire_20261128a_forta', true) IS DISTINCT FROM 'DA' THEN
    RAISE EXCEPTION '20261128a revenire: exista date; refuz fara gazpet.revenire_20261128a_forta = DA';
  END IF;
END $pre$;
DROP INDEX public.red_proiecte_executie_uq;
ALTER TABLE public.red_proiecte DROP CONSTRAINT red_proiecte_executie_fk, DROP CONSTRAINT red_proiecte_link_gdpr_ck,
  DROP COLUMN executie_proiect_id, DROP COLUMN link_informare_gdpr;
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte'
      AND column_name IN ('executie_proiect_id', 'link_informare_gdpr')) OR to_regclass('public.red_proiecte_executie_uq') IS NOT NULL THEN
    RAISE EXCEPTION '20261128a revenire: postconditie esuata';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261128120000';
  END IF;
END $post$;
