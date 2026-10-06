-- ════════════════════════════════════════════════════════════════════════════
-- 20261016a_sec_f3_cron_ingest_vault — DRAFT, NEAPLICAT. Task #17 faza 3 (06.10.2026, decizia Răzvan „A”).
-- Găsit la #17 F2: șase joburi pg_cron trimit mailuri programate cu x-ingest-secret = INGEST_SECRET scris în CLAR în
-- cron.job (aceeași valoare stă și în Apps Script-ul Gmail care alimentează ingest-document):
--   21 reminder-rapoarte-zilnice · 25 necesar-deschidere · 26 necesar-reminder · 27 necesar-inchidere ·
--   28 probleme-parc-reminder · 29 upa-plafon-alerta
-- Ce face: aceeași țintă, același corp ('{}') și același program; antetele = Content-Type + Authorization/apikey din Vault
--   SUPABASE_ANON_JWT (aceeași valoare ca JWT-ul din comenzi — verificat în 0c) + x-intern-secret din Vault
--   INTERN_EDGE_SECRET (verificat de _shared/poartaIntern.ts prin _shared/poartaCron.ts). Timeout-ul rămâne implicitul
--   pg_net, ca înainte (comenzile vechi nu-l setau) — schimbarea e doar a antetelor.
--   INGEST_SECRET dispare din cron.job; după deploy rămâne folosit de Apps Script → ingest-document (și de orice altă funcție live care îl citește — de verificat înainte de rotire).
-- ORDINEA DE LIVRARE (ca la 20261015b): această migrare → IMEDIAT deploy edge reminder-rapoarte, probleme-parc-reminder,
--   necesar-notificari, upa-plafon-alerta (verify_jwt=true; acceptă DOAR x-intern-secret / owner). Între cele două,
--   joburile trimit antetul nou spre edge-urile vechi ⇒ 401. Joburile rulează rar (L–S 19:00 RO; luni 09:00; joi 06:00 și
--   12:00; pe 25 la 09:00): livrarea se face în afara acestor ore ⇒ fereastra nu atinge nicio rulare.
-- Revenire (NU e migrare): supabase/revenire/20261016a_sec_f3_cron_ingest_vault_ROLLBACK.sql — oprește cele 6 joburi (active := false). Joburile NU se
--   readuc la secretul în clar (valoarea nu e și nu va fi în repo); o nouă livrare le repornește.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261016a_sec_f3_cron_ingest_vault:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261016a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

DO $pre$
DECLARE v_anon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user; END IF;

  -- 0b. Vault: exact un INTERN_EDGE_SECRET de 64 hex minuscule și exact un SUPABASE_ANON_JWT cu formă de JWT
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'INTERN_EDGE_SECRET') <> 1
     OR (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'INTERN_EDGE_SECRET') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Precondiție 0b: INTERN_EDGE_SECRET lipsește, e dublat sau nu are formatul de 64 hex';
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_JWT') <> 1 THEN
    RAISE EXCEPTION 'Precondiție 0b: SUPABASE_ANON_JWT lipsește sau e dublat în Vault';
  END IF;
  SELECT decrypted_secret INTO v_anon FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_JWT';
  IF v_anon IS NULL OR v_anon !~ '^eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Precondiție 0b: SUPABASE_ANON_JWT din Vault nu are forma unui JWT (header.payload.semnătură)';
  END IF;

  -- 0c. cele 6 joburi, exact ca pe live 06.10.2026 (comanda normalizată: JWT și secretul din antet mascate),
  --     iar JWT-ul din comandă = Vault (exact, nu substring)
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('reminder-rapoarte-zilnice', 'necesar-deschidere', 'necesar-reminder', 'necesar-inchidere', 'probleme-parc-reminder', 'upa-plafon-alerta')) <> 6 THEN
    RAISE EXCEPTION 'Precondiție 0c: lipsește unul dintre cele 6 joburi sau există dubluri';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reminder-rapoarte-zilnice' AND schedule = '0 16 * * 1-6' AND username = 'postgres' AND active
                   AND md5(regexp_replace(regexp_replace(command, 'eyJ[A-Za-z0-9_.-]+', '<JWT>', 'g'),
                         '(x-internal-secret|x-ingest-secret)''[[:space:]]*,[[:space:]]*''[^'']*''', E'\\1'',''<S>''', 'g')) = '224f93d71c807d03bd2d55f282609810'
                   AND (regexp_match(command, 'Bearer (eyJ[A-Za-z0-9_.-]+)'))[1] = v_anon)
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'necesar-deschidere' AND schedule = '0 6 * * 1' AND username = 'postgres' AND active
                   AND md5(regexp_replace(regexp_replace(command, 'eyJ[A-Za-z0-9_.-]+', '<JWT>', 'g'),
                         '(x-internal-secret|x-ingest-secret)''[[:space:]]*,[[:space:]]*''[^'']*''', E'\\1'',''<S>''', 'g')) = 'a0fce748d7e11aad230ed731b0608114'
                   AND (regexp_match(command, 'Bearer (eyJ[A-Za-z0-9_.-]+)'))[1] = v_anon)
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'necesar-reminder' AND schedule = '0 3 * * 4' AND username = 'postgres' AND active
                   AND md5(regexp_replace(regexp_replace(command, 'eyJ[A-Za-z0-9_.-]+', '<JWT>', 'g'),
                         '(x-internal-secret|x-ingest-secret)''[[:space:]]*,[[:space:]]*''[^'']*''', E'\\1'',''<S>''', 'g')) = 'ebb7b6a59132d8b6ef49d3a2963c28f4'
                   AND (regexp_match(command, 'Bearer (eyJ[A-Za-z0-9_.-]+)'))[1] = v_anon)
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'necesar-inchidere' AND schedule = '0 9 * * 4' AND username = 'postgres' AND active
                   AND md5(regexp_replace(regexp_replace(command, 'eyJ[A-Za-z0-9_.-]+', '<JWT>', 'g'),
                         '(x-internal-secret|x-ingest-secret)''[[:space:]]*,[[:space:]]*''[^'']*''', E'\\1'',''<S>''', 'g')) = '2f64e307b15ceceb4f77e1098b72e608'
                   AND (regexp_match(command, 'Bearer (eyJ[A-Za-z0-9_.-]+)'))[1] = v_anon)
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'probleme-parc-reminder' AND schedule = '0 16 * * 1-6' AND username = 'postgres' AND active
                   AND md5(regexp_replace(regexp_replace(command, 'eyJ[A-Za-z0-9_.-]+', '<JWT>', 'g'),
                         '(x-internal-secret|x-ingest-secret)''[[:space:]]*,[[:space:]]*''[^'']*''', E'\\1'',''<S>''', 'g')) = '8de2c8b4bf8c1b3b8c7348397cbcd4a4'
                   AND (regexp_match(command, 'Bearer (eyJ[A-Za-z0-9_.-]+)'))[1] = v_anon)
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'upa-plafon-alerta' AND schedule = '0 6 25 * *' AND username = 'postgres' AND active
                   AND md5(regexp_replace(regexp_replace(command, 'eyJ[A-Za-z0-9_.-]+', '<JWT>', 'g'),
                         '(x-internal-secret|x-ingest-secret)''[[:space:]]*,[[:space:]]*''[^'']*''', E'\\1'',''<S>''', 'g')) = 'bb33b0b3ae9cb120d158d28c602bb792'
                   AND (regexp_match(command, 'Bearer (eyJ[A-Za-z0-9_.-]+)'))[1] = v_anon) THEN
    RAISE EXCEPTION 'Precondiție 0c: comanda / programul / proprietarul unui job diferă de cel auditat pe 06.10.2026 sau JWT-ul din comandă nu e cel din Vault';
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- Joburile pe Vault (aceeași țintă, corp, program)
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname = 'reminder-rapoarte-zilnice'),
    command := $cmd$SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/reminder-rapoarte',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'apikey', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')
    ),
    body := '{}'::jsonb
  )$cmd$);
  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname = 'necesar-deschidere'),
    command := $cmd$SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/necesar-notificari?actiune=deschidere',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'apikey', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')
    ),
    body := '{}'::jsonb
  )$cmd$);
  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname = 'necesar-reminder'),
    command := $cmd$SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/necesar-notificari?actiune=reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'apikey', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')
    ),
    body := '{}'::jsonb
  )$cmd$);
  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname = 'necesar-inchidere'),
    command := $cmd$SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/necesar-notificari?actiune=inchidere',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'apikey', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')
    ),
    body := '{}'::jsonb
  )$cmd$);
  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname = 'probleme-parc-reminder'),
    command := $cmd$SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/probleme-parc-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'apikey', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')
    ),
    body := '{}'::jsonb
  )$cmd$);
  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname = 'upa-plafon-alerta'),
    command := $cmd$SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/upa-plafon-alerta',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'apikey', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')
    ),
    body := '{}'::jsonb
  )$cmd$);
END $cron$;

-- ---------------------------------------------------------------------------
-- Postcondiții
-- ---------------------------------------------------------------------------
DO $post$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('reminder-rapoarte-zilnice', 'necesar-deschidere', 'necesar-reminder', 'necesar-inchidere', 'probleme-parc-reminder', 'upa-plafon-alerta')
        AND active AND username = 'postgres'
        AND command ~ 'x-intern-secret.*INTERN_EDGE_SECRET' AND command ~ 'SUPABASE_ANON_JWT'
        AND command !~ 'eyJ' AND command !~ 'x-internal-secret' AND command !~ 'x-ingest-secret') <> 6
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reminder-rapoarte-zilnice' AND schedule = '0 16 * * 1-6' AND command ~ 'functions/v1/reminder-rapoarte''')
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'necesar-deschidere' AND schedule = '0 6 * * 1' AND command ~ 'functions/v1/necesar-notificari[?]actiune=deschidere''')
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'necesar-reminder' AND schedule = '0 3 * * 4' AND command ~ 'functions/v1/necesar-notificari[?]actiune=reminder''')
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'necesar-inchidere' AND schedule = '0 9 * * 4' AND command ~ 'functions/v1/necesar-notificari[?]actiune=inchidere''')
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'probleme-parc-reminder' AND schedule = '0 16 * * 1-6' AND command ~ 'functions/v1/probleme-parc-reminder''')
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'upa-plafon-alerta' AND schedule = '0 6 25 * *' AND command ~ 'functions/v1/upa-plafon-alerta''') THEN
    RAISE EXCEPTION 'Postcondiție 1: joburile nu citesc din Vault, mai au un secret/JWT în clar sau ținta/programul s-a schimbat';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE command ~ 'x-ingest-secret' AND jobname IN ('reminder-rapoarte-zilnice', 'necesar-deschidere', 'necesar-reminder', 'necesar-inchidere', 'probleme-parc-reminder', 'upa-plafon-alerta')) THEN
    RAISE EXCEPTION 'Postcondiție 2: a rămas x-ingest-secret într-unul dintre cele 6 joburi';
  END IF;
  RAISE NOTICE '20261016a după: 6 joburi de mail programat pe Vault, INGEST_SECRET scos din cron.job';
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261016a_sec_f3_cron_ingest_vault:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261016a: garda de livrare (final) — marcajul s-a pierdut; se anulează tot';
  END IF;
END $livrare_final$;
