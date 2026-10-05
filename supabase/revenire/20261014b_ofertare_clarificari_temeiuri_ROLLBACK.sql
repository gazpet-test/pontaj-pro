-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261014b_ofertare_clarificari_temeiuri_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Șterge tabelul ofertare_clarificari_temeiuri (ȘI TOATE temeiurile atașate de oameni), trigger-ul și funcția lui.
-- ⚠️ Ireversibil pentru date: înainte de rulare se face export (SELECT * ... ) dacă tabelul are rânduri.
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261014b', 'TEMEIURI_DROP:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $arm$
DECLARE
  n bigint;
BEGIN
  IF current_setting('gazpet.revenire_20261014b', true) IS DISTINCT FROM 'TEMEIURI_DROP:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261014b: nearmată (gazpet.revenire_20261014b legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261014b=%') THEN
    RAISE EXCEPTION 'Revenire 20261014b: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF to_regclass('public.ofertare_clarificari_temeiuri') IS NULL THEN
    RAISE EXCEPTION 'Revenire 20261014b: tabelul nu există — nimic de revenit';
  END IF;
  EXECUTE 'SELECT count(*) FROM public.ofertare_clarificari_temeiuri' INTO n;
  IF n > 0 AND current_setting('gazpet.revenire_20261014b_cu_date', true) IS DISTINCT FROM 'DA' THEN
    RAISE EXCEPTION 'Revenire 20261014b: tabelul are % rânduri — exportă-le și armează și gazpet.revenire_20261014b_cu_date = DA', n;
  END IF;
END
$arm$;

DROP TRIGGER IF EXISTS trg_temei_citat_verifica ON public.ofertare_clarificari_temeiuri;
DROP TABLE public.ofertare_clarificari_temeiuri;
DROP FUNCTION IF EXISTS public.fn_temei_citat_verifica();

DO $post$
BEGIN
  IF to_regclass('public.ofertare_clarificari_temeiuri') IS NOT NULL OR to_regprocedure('public.fn_temei_citat_verifica()') IS NOT NULL THEN
    RAISE EXCEPTION 'Revenire 20261014b: tabelul sau funcția încă există';
  END IF;
END
$post$;
