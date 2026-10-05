-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261013b_ofertare_doc_are_bucati_invoker_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Readuce ofertare_doc_are_bucati la SECURITY DEFINER cu EXECUTE doar postgres + service_role (starea din 20260915).
-- ⚠️ Readuce și eroarea „permission denied for function ofertare_doc_are_bucati” pe v_ofertare_seap_completitudine
--    pentru orice utilizator logat (Propunere tehnică / poarta PT blocate).
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261013b', 'DOC_ARE_BUCATI_DEFINER:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $arm$
BEGIN
  IF current_setting('gazpet.revenire_20261013b', true) IS DISTINCT FROM 'DOC_ARE_BUCATI_DEFINER:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261013b: nearmată (gazpet.revenire_20261013b legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261013b=%') THEN
    RAISE EXCEPTION 'Revenire 20261013b: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.ofertare_doc_are_bucati(bigint,bigint,text)'::regprocedure) IS NOT FALSE
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.ofertare_doc_are_bucati(bigint,bigint,text)'::regprocedure) IS DISTINCT FROM '9d50c502093fdffb2485ce973a20abb9' THEN
    RAISE EXCEPTION 'Revenire 20261013b: precondiție — starea nu e cea a patch-ului 20261013b';
  END IF;
END $arm$;

REVOKE EXECUTE ON FUNCTION public.ofertare_doc_are_bucati(bigint, bigint, text) FROM authenticated;
ALTER FUNCTION public.ofertare_doc_are_bucati(bigint, bigint, text) SECURITY DEFINER;

DO $post$
BEGIN
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.ofertare_doc_are_bucati(bigint,bigint,text)'::regprocedure) IS NOT TRUE
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.ofertare_doc_are_bucati(bigint,bigint,text)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'Revenire 20261013b: postcondiție — funcția nu a revenit la SECDEF cu ACL {postgres,service_role}';
  END IF;
END $post$;
