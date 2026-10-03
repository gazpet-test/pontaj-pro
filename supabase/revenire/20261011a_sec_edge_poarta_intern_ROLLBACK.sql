-- ════════════════════════════════════════════════════════════════════════════
-- 20261011a_sec_edge_poarta_intern_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Scoate antetul x-intern-secret din cele 2 triggere și din jobul cron (cronul revine la comanda exactă de dinainte,
-- md5 0bd8aadf…; triggerul inbox păstrează cheia anon citită din Vault — aceeași valoare, fără literal în cod).
-- Secretul INTERN_EDGE_SECRET rămâne în Vault (inofensiv; se șterge separat, doar la cerere).
-- ⚠️ REDESCHIDE cele 3 endpointuri doar dacă edge-urile sunt redeployate FĂRĂ poartă; altfel, cu edge-urile cu poartă,
--    triggerele/cronul fără antet vor fi refuzate (detect-ordine, citeste-orice, cleanup-recycle-bin nu mai rulează).
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261011a', 'SCOATE_POARTA_INTERN:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
DO $arm$
BEGIN
  IF current_setting('gazpet.revenire_20261011a', true) IS DISTINCT FROM 'SCOATE_POARTA_INTERN:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261011a: nearmată (gazpet.revenire_20261011a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261011a=%') THEN
    RAISE EXCEPTION 'Revenire 20261011a: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_detect_ordine_trigger()'::regprocedure) !~ 'INTERN_EDGE_SECRET'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_ai_inbox_trigger_clasificare()'::regprocedure) !~ 'INTERN_EDGE_SECRET'
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recycle_bin_cleanup_zilnic' AND command ~ 'INTERN_EDGE_SECRET') THEN
    RAISE EXCEPTION 'Revenire 20261011a: precondiție — starea nu e cea a patch-ului 20261011a';
  END IF;
END $arm$;

CREATE OR REPLACE FUNCTION public.fn_detect_ordine_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (COALESCE(NEW.nume_fisier,'') || ' ' || COALESCE(NEW.subiect,'')) ~* 'ordin[^a-z]*(de)?[^a-z]*(incep|re[- ]?incep|sistar|reluar)' THEN
    PERFORM net.http_post(
      url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/detect-ordine',
      body := jsonb_build_object('doc_id', NEW.id),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 55000
    );
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_ai_inbox_trigger_clasificare()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'pg_temp'
AS $function$
DECLARE v_anon text;
BEGIN
  IF NEW.status = 'in_asteptare' THEN
    SELECT s.decrypted_secret INTO v_anon FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT';
    PERFORM net.http_post(
      url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/citeste-orice',
      body := jsonb_build_object('inbox_id', NEW.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon,
        'apikey', v_anon
      ),
      timeout_milliseconds := 55000
    );
  END IF;
  RETURN NEW;
END $function$;

DO $cron$
BEGIN
  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname = 'recycle_bin_cleanup_zilnic'),
    command := $cmd$
  SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/cleanup-recycle-bin',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json')
  );
  $cmd$);
END $cron$;

DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_detect_ordine_trigger()'::regprocedure) IS DISTINCT FROM 'f726b68fc75833429780a546a4d4f654'
     OR (SELECT md5(command) FROM cron.job WHERE jobname = 'recycle_bin_cleanup_zilnic') IS DISTINCT FROM '0bd8aadf5dbb6966ec074bfda39a59a7'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_ai_inbox_trigger_clasificare()'::regprocedure) ~ 'INTERN_EDGE_SECRET' THEN
    RAISE EXCEPTION 'Revenire 20261011a: postcondiție — starea de dinainte nu a fost refăcută exact';
  END IF;
END $post$;
