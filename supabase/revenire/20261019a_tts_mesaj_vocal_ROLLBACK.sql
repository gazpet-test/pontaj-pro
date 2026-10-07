-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261019a_tts_mesaj_vocal_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Scoate contorul, cache-ul și funcțiile mesajului vocal. Edge-ul tts-google trebuie retras ÎNAINTE (altfel întoarce 500).
-- ATENȚIE la consum: contorul se pierde. O reactivare în aceeași lună trebuie să pornească contorul de la consumul deja
--   făcut la Google în luna respectivă (din raportul de facturare), nu de la zero.
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
  IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'mesaj_vocal') THEN
    RAISE EXCEPTION 'Revenire 20261019a: cheia mesaj_vocal e acordată unor utilizatori — drepturile se scot întâi, cu acordul lui Răzvan; refuz';
  END IF;
END
$arm$;

DROP POLICY tts_audio_inchis ON storage.objects;
DELETE FROM public.app_modules WHERE key = 'mesaj_vocal';
DROP FUNCTION public.fn_tts_rezerva(integer);
DROP FUNCTION public.fn_tts_poate();
DROP TABLE public.tts_cache;
DROP TABLE public.tts_cota_lunara;

DO $post$
BEGIN
  IF to_regclass('public.tts_cota_lunara') IS NOT NULL OR to_regclass('public.tts_cache') IS NOT NULL
     OR to_regprocedure('public.fn_tts_rezerva(integer)') IS NOT NULL OR to_regprocedure('public.fn_tts_poate()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'tts_audio_inchis')
     OR EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'mesaj_vocal') THEN
    RAISE EXCEPTION 'Revenire 20261019a: postcondiție — obiectele n-au fost scoase';
  END IF;
END
$post$;
