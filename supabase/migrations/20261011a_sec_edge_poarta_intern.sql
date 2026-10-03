-- ════════════════════════════════════════════════════════════════════════════
-- 20261011a_sec_edge_poarta_intern — DRAFT, NEAPLICAT. Poartă pe 3 edge functions apelate doar de mașină (task #17).
-- Găsit la inventarul automatizărilor (03.10.2026), verificat pe codul live:
--   * detect-ordine (verify_jwt=false, fără verificare în cod): oricine cu URL-ul proiectului pornește citiri AI plătite
--     și un backfill care întoarce numele documentelor de proiect;
--   * cleanup-recycle-bin (verify_jwt=false, fără verificare): oricine poate porni purjarea coșului;
--   * citeste-orice (verify_jwt=true, fără verificare de rol): cheia anon publică pornește citiri AI.
-- Singurii apelanți legitimi sunt mașina: triggerele trg_detect_ordine / trg_ai_inbox_clasificare și jobul pg_cron
-- recycle_bin_cleanup_zilnic (niciun ecran nu le cheamă — grep src/ 03.10). Decizie Răzvan 03.10: varianta A.
-- Ce face migrarea (partea BD; poarta din edge vine în același PR, se deployează DUPĂ aplicare):
--   1. Secret nou în Vault: INTERN_EDGE_SECRET = 32 de octeți aleatori (hex), generat ÎN BD — valoarea nu iese niciodată
--      din baza de date (nici în chat, nici în repo, nici în jurnalul migrării).
--   2. fn_detect_ordine_trigger: același corp, plus antetul x-intern-secret citit din Vault.
--   3. fn_ai_inbox_trigger_clasificare: același corp, plus x-intern-secret; cheia anon (pentru gateway-ul verify_jwt)
--      nu mai e literal în funcție — se citește din Vault (SUPABASE_ANON_JWT, aceeași valoare, md5 verificat).
--   4. Jobul recycle_bin_cleanup_zilnic: aceeași comandă, plus x-intern-secret din Vault (programul neschimbat).
-- Edge-urile verifică antetul prin public.fn_verifica_secret('INTERN_EDGE_SECRET', antet) (SECDEF, doar service_role).
-- Compatibil înainte/după: edge-urile vechi ignoră antetul în plus; ordinea e migrare → deploy edge.
-- Precondiții (fail-closed): postgres; fn_verifica_secret exactă (md5 dbd1439c…); cele 2 funcții trigger exacte
--   (detect md5 f726b68f…; inbox md5 normalizat 4e1dd9f7… și literalul JWT = Vault SUPABASE_ANON_JWT; ACL exact
--   {postgres=X/postgres,service_role=X/postgres} pe ambele, păstrat și după); jobul cron exact
--   (md5 0bd8aadf…, '0 7 * * *', postgres, activ); nici INTERN_EDGE_SECRET, nici _VECHI nu există; SUPABASE_ANON_JWT există o
--   dată; niciun obiect accesibil anon/authenticated nu citește coada pg_net. Runda 2 (Copilot NO-GO pe ddbf54b): P0 _VECHI,
--   P1.1 fn_verifica_secret pinuită complet, P1.2 garda pe coada pg_net.
-- Revenire (NU e migrare): supabase/revenire/20261011a_sec_edge_poarta_intern_ROLLBACK.sql — doar ÎMPREUNĂ cu
--   redeploy-ul edge-urilor fără poartă, altfel triggerele/cronul fără antet ar fi refuzate.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT. Gate 0e = 0.
-- ════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261011a_sec_edge_poarta_intern:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261011a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

DO $pre$
DECLARE v_n integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user; END IF;
  -- 0b. verificatorul de secret din Vault, pinuit complet (folosit deja de ofertare-seap-veghe; Copilot P1.1 pe #595)
  IF to_regprocedure('public.fn_verifica_secret(text,text)') IS NULL
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'fn_verifica_secret') <> 1
     OR NOT (SELECT md5(p.prosrc) = 'dbd1439c7c2102841c7c457f4a7e95f9' AND l.lanname = 'sql' AND p.provolatile = 'v' AND p.prosecdef
                    AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel = 'u' AND p.prorettype = 'boolean'::regtype
                    AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig = ARRAY['search_path=public, vault, pg_temp']
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
             FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.fn_verifica_secret(text,text)'::regprocedure) THEN
    RAISE EXCEPTION 'Precondiție 0b: public.fn_verifica_secret diferă de cea live (unică, md5, sql, VOLATILE, SECDEF, owner postgres, search_path, ACL exact)';
  END IF;
  -- 0c. funcțiile trigger, exact ca pe live (inbox: literalul JWT normalizat, apoi comparat cu Vault)
  IF to_regprocedure('public.fn_detect_ordine_trigger()') IS NULL
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_detect_ordine_trigger()'::regprocedure) IS DISTINCT FROM 'f726b68fc75833429780a546a4d4f654'
     OR NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(proowner) = 'postgres'
             FROM pg_proc WHERE oid = 'public.fn_detect_ordine_trigger()'::regprocedure) THEN
    RAISE EXCEPTION 'Precondiție 0c: fn_detect_ordine_trigger() diferă de cea live';
  END IF;
  IF to_regprocedure('public.fn_ai_inbox_trigger_clasificare()') IS NULL
     OR (SELECT md5(regexp_replace(prosrc, 'eyJ[A-Za-z0-9_\-\.]+', '<JWT>', 'g')) FROM pg_proc WHERE oid = 'public.fn_ai_inbox_trigger_clasificare()'::regprocedure) IS DISTINCT FROM '4e1dd9f786eafc208bb33e9437a72e2b'
     OR NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=public, net, pg_temp'] AND pg_get_userbyid(proowner) = 'postgres'
             FROM pg_proc WHERE oid = 'public.fn_ai_inbox_trigger_clasificare()'::regprocedure) THEN
    RAISE EXCEPTION 'Precondiție 0c: fn_ai_inbox_trigger_clasificare() diferă de cea live';
  END IF;
  IF (SELECT proacl::text FROM pg_proc WHERE oid = 'public.fn_detect_ordine_trigger()'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.fn_ai_inbox_trigger_clasificare()'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'Precondiție 0c: ACL-ul funcțiilor trigger diferă de cel live ({postgres=X/postgres,service_role=X/postgres})';
  END IF;
  IF (SELECT count(DISTINCT m[1]) FROM pg_proc p, regexp_matches(p.prosrc, '(eyJ[A-Za-z0-9_\-\.]+)', 'g') m
       WHERE p.oid = 'public.fn_ai_inbox_trigger_clasificare()'::regprocedure) <> 1
     OR (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_JWT') <> 1
     OR (SELECT (regexp_match(p.prosrc, '(eyJ[A-Za-z0-9_\-\.]+)'))[1] FROM pg_proc p WHERE p.oid = 'public.fn_ai_inbox_trigger_clasificare()'::regprocedure)
        IS DISTINCT FROM (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_JWT') THEN
    RAISE EXCEPTION 'Precondiție 0d: cheia din fn_ai_inbox_trigger_clasificare nu e exact Vault SUPABASE_ANON_JWT';
  END IF;
  -- 0e. jobul cron exact
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'recycle_bin_cleanup_zilnic';
  IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recycle_bin_cleanup_zilnic' AND md5(command) = '0bd8aadf5dbb6966ec074bfda39a59a7'
                             AND schedule = '0 7 * * *' AND username = 'postgres' AND active) THEN
    RAISE EXCEPTION 'Precondiție 0e: jobul recycle_bin_cleanup_zilnic diferă de cel live (n=%)', v_n;
  END IF;
  -- 0f. nici secretul nou, nici o variantă _VECHI nu există (fn_verifica_secret acceptă ȘI _VECHI: un rest de acolo ar
  --     deschide poarta din prima secundă — Copilot P0 pe #595). La introducerea porții nu suntem într-o rotație.
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name IN ('INTERN_EDGE_SECRET', 'INTERN_EDGE_SECRET_VECHI')) THEN
    RAISE EXCEPTION 'Precondiție 0f: INTERN_EDGE_SECRET sau INTERN_EDGE_SECRET_VECHI există deja în Vault — nimic aplicat';
  END IF;
  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 0f: extensions.gen_random_bytes sau vault.create_secret lipsesc';
  END IF;
  -- 0g. antetul trece prin coada pg_net (net.http_request_queue; ACL-ul extensiei dă PUBLIC pe ea). Schema net NU e expusă
  --     de PostgREST (probă 03.10: PGRST106 „Invalid schema: net”), deci rămâne doar calea prin obiecte din alte scheme:
  --     nicio funcție executabilă și niciun view citibil de anon/authenticated nu au voie să atingă coada sau răspunsurile.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname NOT IN ('net', 'pg_catalog', 'information_schema') AND p.prosrc ~ '(http_request_queue|_http_response)'
               AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind IN ('v', 'm') AND n.nspname NOT IN ('net', 'pg_catalog', 'information_schema')
               AND pg_get_viewdef(c.oid) ~ '(http_request_queue|_http_response)'
               AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'))) THEN
    RAISE EXCEPTION 'Precondiție 0g: un obiect accesibil anon/authenticated citește coada pg_net — secretul ar putea fi văzut';
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- 1. Secretul intern — generat în BD, valoarea nu se afișează nicăieri
-- ---------------------------------------------------------------------------
DO $secret$
BEGIN
  PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'INTERN_EDGE_SECRET',
    'Secret intern trigger/cron -> edge (detect-ordine, citeste-orice, cleanup-recycle-bin). Task #17, 03.10.2026. Nu iese din BD.');
END $secret$;

-- ---------------------------------------------------------------------------
-- 2. Trigger detect-ordine: + x-intern-secret
-- ---------------------------------------------------------------------------
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
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')
      ),
      timeout_milliseconds := 55000
    );
  END IF;
  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------------
-- 3. Trigger citeste-orice: cheia anon din Vault (nu literal) + x-intern-secret
-- ---------------------------------------------------------------------------
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
        'apikey', v_anon,
        'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')
      ),
      timeout_milliseconds := 55000
    );
  END IF;
  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------------
-- 4. Cron cleanup-recycle-bin: + x-intern-secret (program neschimbat)
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname = 'recycle_bin_cleanup_zilnic'),
    command := $cmd$
  SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/cleanup-recycle-bin',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json',
      'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET'))
  );
  $cmd$);
END $cron$;

-- ---------------------------------------------------------------------------
-- 5. Postcondiții
-- ---------------------------------------------------------------------------
DO $post$
BEGIN
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'INTERN_EDGE_SECRET') <> 1
     OR (SELECT count(*) FROM vault.secrets WHERE name = 'INTERN_EDGE_SECRET_VECHI') <> 0
     OR (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'INTERN_EDGE_SECRET') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Postcondiție 1: INTERN_EDGE_SECRET nu e exact unul de 64 hex minuscule (formatul cerut de _shared/poartaIntern.ts) sau există _VECHI';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_detect_ordine_trigger()'::regprocedure) !~ 'x-intern-secret.*INTERN_EDGE_SECRET'
     OR NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(proowner) = 'postgres'
             FROM pg_proc WHERE oid = 'public.fn_detect_ordine_trigger()'::regprocedure)
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.fn_detect_ordine_trigger()'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'Postcondiție 2: fn_detect_ordine_trigger nu are antetul sau atributele/ACL s-au schimbat';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_ai_inbox_trigger_clasificare()'::regprocedure) ~ 'eyJ'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_ai_inbox_trigger_clasificare()'::regprocedure) !~ 'SUPABASE_ANON_JWT'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_ai_inbox_trigger_clasificare()'::regprocedure) !~ 'x-intern-secret.*INTERN_EDGE_SECRET'
     OR NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=public, net, pg_temp'] AND pg_get_userbyid(proowner) = 'postgres'
             FROM pg_proc WHERE oid = 'public.fn_ai_inbox_trigger_clasificare()'::regprocedure)
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.fn_ai_inbox_trigger_clasificare()'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'Postcondiție 3: fn_ai_inbox_trigger_clasificare încă are JWT literal, n-are antetul sau atributele/ACL s-au schimbat';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recycle_bin_cleanup_zilnic' AND command ~ 'x-intern-secret.*INTERN_EDGE_SECRET'
                 AND command ~ 'cleanup-recycle-bin' AND schedule = '0 7 * * *' AND username = 'postgres' AND active) THEN
    RAISE EXCEPTION 'Postcondiție 4: jobul recycle_bin_cleanup_zilnic nu are antetul sau programul s-a schimbat';
  END IF;
  -- triggerele rămân atașate și active
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_detect_ordine' AND tgrelid = 'public.documente_proiect'::regclass AND tgenabled = 'O'
        AND tgfoid = 'public.fn_detect_ordine_trigger()'::regprocedure) <> 1
     OR (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_ai_inbox_clasificare' AND tgrelid = 'public.ai_documente_inbox'::regclass AND tgenabled = 'O'
        AND tgfoid = 'public.fn_ai_inbox_trigger_clasificare()'::regprocedure) <> 1 THEN
    RAISE EXCEPTION 'Postcondiție 5: triggerele trg_detect_ordine / trg_ai_inbox_clasificare nu mai sunt atașate și active';
  END IF;
  RAISE NOTICE '20261011a după: INTERN_EDGE_SECRET creat (valoare nevăzută), 2 triggere + 1 cron trimit x-intern-secret';
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261011a_sec_edge_poarta_intern:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261011a: garda de livrare (final) — marcajul s-a pierdut; se anulează tot';
  END IF;
END $livrare_final$;
