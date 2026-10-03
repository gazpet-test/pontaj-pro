-- ════════════════════════════════════════════════════════════════════════════
-- 20261010a_admin_automatizari_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/). Șterge tabelul
-- public.automatizari (cu tot cu rândurile lui — registrul rămâne oricum în claude_docs registru_automatizari).
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261010a', 'STERGE_AUTOMATIZARI:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
DO $arm$
BEGIN
  IF current_setting('gazpet.revenire_20261010a', true) IS DISTINCT FROM 'STERGE_AUTOMATIZARI:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261010a: nearmată (gazpet.revenire_20261010a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261010a=%') THEN
    RAISE EXCEPTION 'Revenire 20261010a: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF to_regclass('public.automatizari') IS NULL THEN
    RAISE EXCEPTION 'Revenire 20261010a: public.automatizari nu există — nimic de revenit';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refobjid = 'public.automatizari'::regclass AND d.deptype = 'n'
             AND d.classid = 'pg_rewrite'::regclass) THEN
    RAISE EXCEPTION 'Revenire 20261010a: există view-uri care depind de automatizari — refuz (fără CASCADE)';
  END IF;
END $arm$;

DROP TABLE public.automatizari;

DO $post$
BEGIN
  IF to_regclass('public.automatizari') IS NOT NULL THEN RAISE EXCEPTION 'Revenire 20261010a: tabelul a rămas'; END IF;
END $post$;
