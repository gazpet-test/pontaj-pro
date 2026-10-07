-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261019a_tts_mesaj_vocal_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Scoate contorul, cache-ul, funcțiile și cheia de modul ale mesajului vocal. Edge-ul tts-google trebuie retras ÎNAINTE.
-- PĂSTREAZĂ politica RESTRICTIVE tts_audio_inchis (r3, Copilot P13-1): bucket-ul tts-audio și MP3-urile rămân în Storage
--   până la ștergerea lor manuală (Dashboard → Storage), iar politica îl ține închis între timp. Politica se scoate DOAR
--   după ce bucket-ul a dispărut, separat, cu:
--     DO $c$ BEGIN IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'tts-audio') THEN RAISE EXCEPTION 'bucket încă există'; END IF;
--       DROP POLICY tts_audio_inchis ON storage.objects; END $c$;
-- Refuză dacă obiectele nu mai sunt exact cele lăsate de 20261019a (r3, P13-2) sau dacă modulul e acordat cuiva.
-- ATENȚIE la consum: contorul se pierde. O reactivare în aceeași lună trebuie să pornească contorul de la consumul deja
--   făcut la Google în luna respectivă (din raportul de facturare), nu de la zero.
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

LOCK TABLE public.tts_cota_lunara, public.tts_cache IN ACCESS EXCLUSIVE MODE;

DO $amprenta$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'mesaj_vocal') THEN
    RAISE EXCEPTION 'Revenire 20261019a: cheia mesaj_vocal e acordată unor utilizatori — drepturile se scot întâi, cu acordul lui Răzvan; refuz';
  END IF;
  -- funcțiile exact cum le-a lăsat 20261019a (corp, SECURITY DEFINER, search_path, drepturi)
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.fn_tts_rezerva(integer)')) IS DISTINCT FROM '01a75fd96d210e59606806f62b6ca4a6'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.fn_tts_poate()')) IS DISTINCT FROM 'c206cd97f9d0fdd72f24d4ef6a01744a'
     OR (SELECT count(*) FROM pg_proc WHERE oid IN (to_regprocedure('public.fn_tts_rezerva(integer)'), to_regprocedure('public.fn_tts_poate()'))
           AND prosecdef AND proconfig = ARRAY['search_path=public, pg_temp']) <> 2
     OR has_function_privilege('authenticated', 'public.fn_tts_rezerva(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_tts_poate()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Revenire 20261019a: funcțiile nu mai sunt exact cele din 20261019a (o versiune ulterioară s-ar pierde) — refuz';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'tts_audio_inchis'
        AND permissive = 'RESTRICTIVE' AND cmd = 'ALL' AND roles = '{public}'
        AND qual = '(bucket_id IS DISTINCT FROM ''tts-audio''::text)' AND with_check = '(bucket_id IS DISTINCT FROM ''tts-audio''::text)') <> 1 THEN
    RAISE EXCEPTION 'Revenire 20261019a: politica tts_audio_inchis lipsește sau a fost modificată — refuz';
  END IF;
  IF (SELECT count(*) FROM public.app_modules WHERE key = 'mesaj_vocal') <> 1 THEN
    RAISE EXCEPTION 'Revenire 20261019a: rândul mesaj_vocal din app_modules lipsește — refuz';
  END IF;
END
$amprenta$;

DELETE FROM public.app_modules WHERE key = 'mesaj_vocal';
DROP FUNCTION public.fn_tts_rezerva(integer);
DROP FUNCTION public.fn_tts_poate();
DROP TABLE public.tts_cache;
DROP TABLE public.tts_cota_lunara;

DO $post$
BEGIN
  IF to_regclass('public.tts_cota_lunara') IS NOT NULL OR to_regclass('public.tts_cache') IS NOT NULL
     OR to_regprocedure('public.fn_tts_rezerva(integer)') IS NOT NULL OR to_regprocedure('public.fn_tts_poate()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'mesaj_vocal') THEN
    RAISE EXCEPTION 'Revenire 20261019a: postcondiție — obiectele n-au fost scoase';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'tts_audio_inchis'
        AND permissive = 'RESTRICTIVE') <> 1 THEN
    RAISE EXCEPTION 'Revenire 20261019a: postcondiție — politica tts_audio_inchis trebuie să rămână cât timp bucket-ul există';
  END IF;
END
$post$;
