-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261019a_tts_mesaj_vocal_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Scoate contorul, cache-ul și funcțiile mesajului vocal. Edge-ul tts-google trebuie retras ÎNAINTE (altfel întoarce 500).
-- Bucket-ul tts-audio NU se șterge din SQL (Storage interzice ștergerea directă din storage.objects): după revenire,
--   fișierele și bucket-ul se golesc/șterg din Dashboard → Storage, la cererea lui Răzvan.
-- Fără GO de execuție: doar la cererea lui Răzvan. Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261019a', 'TTS_MESAJ_VOCAL:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_temp;

DO $arm$
BEGIN
  IF current_setting('gazpet.revenire_20261019a', true) IS DISTINCT FROM 'TTS_MESAJ_VOCAL:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261019a: nearmată (gazpet.revenire_20261019a legat de txid_current) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Revenire 20261019a: rulează ca postgres'; END IF;
END
$arm$;

DROP FUNCTION public.fn_tts_rezerva(integer);
DROP FUNCTION public.fn_tts_restituie(integer);
DROP TABLE public.tts_cache;
DROP TABLE public.tts_cota_lunara;

DO $post$
BEGIN
  IF to_regclass('public.tts_cota_lunara') IS NOT NULL OR to_regclass('public.tts_cache') IS NOT NULL
     OR to_regprocedure('public.fn_tts_rezerva(integer)') IS NOT NULL OR to_regprocedure('public.fn_tts_restituie(integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Revenire 20261019a: postcondiție — obiectele n-au fost scoase';
  END IF;
END
$post$;
