-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261029d — x-radar-secret: cron-ul citește din Vault + rotirea RADAR_SECRET (securitate etapa 2, punctul b).
-- Decizia Răzvan 14.10.2026, scrisă direct în sesiunea Module: „da RADAR B: fișier + PR draft + dry-run acum; apply separat”.
-- De ce: valoarea curentă a RADAR_SECRET stă în CLAR în 10 comenzi cron.job (31, 32, 36, 42, 43, 45, 46, 47, 49, 54) și
--   a stat scrisă în sursa olx-api (scoasă la 13.10, #688) → e considerată compromisă.
-- Inventar 14.10 (read-only): toate edge-urile cu x-radar-secret verifică în BD (fn_verifica_radar_secret /
--   fn_radar_secret_ok → Vault RADAR_SECRET); nicio valoare în repo, pe Terra, pe serverul AI, în app_secrets, în funcții
--   sau în alte joburi. Rutina zilnică (olx_get) citește deja din Vault prin pg_net. ⇒ NU e nevoie de redeploy edge și
--   NICI de fereastră „acceptă ambele”: comenzile cron și secretul se schimbă în ACEEAȘI tranzacție.
-- Ce face:
--   * cele 10 joburi: literalul înlocuit cu (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'RADAR_SECRET');
--     restul comenzii, programul și starea active rămân identice (precondiție pe md5-ul exact al comenzilor de azi);
--   * valoarea veche copiată în Vault ca RADAR_SECRET_VECHI — DOAR pentru revenire, NU e acceptată de nicio funcție;
--   * RADAR_SECRET primește o valoare nouă generată aici (gen_random_bytes, același format gzp-<48 hex>) — nu trece prin
--     chat, repo sau loguri.
-- Revenire: supabase/revenire/20261029d_radar_secret_vault_rotire_ROLLBACK.sql (pune la loc valoarea veche în RADAR_SECRET;
--   cron-ul rămâne pe Vault). RADAR_SECRET_VECHI se șterge după 7 zile fără 401, cu „da” separat.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (versiune 20261029140000); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
DECLARE
  c_md5 CONSTANT jsonb := '{"31":"bb30c8598e80025933d626b06b058c7a","32":"412ce34a7073225d806f93590722b056","36":"719844ac6df8e30b7e8a6b1290f3d1f3","42":"9e1098d6b5a43a41cd36b37cf6cad30a","43":"9e1098d6b5a43a41cd36b37cf6cad30a","45":"502a8f0f8876e9a84c9528447b766e35","46":"77aface21f18e43445c21853a8c3045c","47":"979b0692dad03ff8238c58d82a964f93","49":"d7b6eab0a479ed767df2186794b6fac7","54":"21898a246e585f9b54895dafd70a388a"}';
  r record; n int := 0; v text;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261029d_radar_secret_vault_rotire:' || txid_current() THEN
    RAISE EXCEPTION '20261029d: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261029d: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'RADAR_SECRET') <> 1 THEN RAISE EXCEPTION '20261029d: RADAR_SECRET lipsa/dublat'; END IF;
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'RADAR_SECRET_VECHI') THEN RAISE EXCEPTION '20261029d: RADAR_SECRET_VECHI exista deja'; END IF;
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = 'RADAR_SECRET';
  IF v !~ '^gzp-[0-9a-f]{48}$' THEN RAISE EXCEPTION '20261029d: formatul RADAR_SECRET difera de cel inventariat'; END IF;
  FOR r IN SELECT jobid, command, md5(command) m FROM cron.job WHERE command ILIKE '%x-radar-secret%' LOOP
    n := n + 1;
    IF r.m IS DISTINCT FROM c_md5->>r.jobid::text THEN RAISE EXCEPTION '20261029d: preconditie job % (comanda schimbata)', r.jobid; END IF;
    IF (length(r.command) - length(replace(r.command, quote_literal(v), ''))) <> length(quote_literal(v)) THEN
      RAISE EXCEPTION '20261029d: job % nu contine exact o data valoarea din Vault', r.jobid;
    END IF;
  END LOOP;
  IF n <> 10 THEN RAISE EXCEPTION '20261029d: numar joburi x-radar = % (asteptat 10)', n; END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE command NOT ILIKE '%x-radar-secret%' AND position(v IN command) > 0)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE position(v IN prosrc) > 0) THEN
    RAISE EXCEPTION '20261029d: valoarea apare si in alte joburi/functii';
  END IF;
END $pre$;

-- 1) cron → Vault (aceeași comandă, doar literalul înlocuit)
DO $cron$
DECLARE r record; v text; v_nou text;
BEGIN
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = 'RADAR_SECRET';
  FOR r IN SELECT jobid, command FROM cron.job WHERE command ILIKE '%x-radar-secret%' LOOP
    v_nou := replace(r.command, quote_literal(v),
      '(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''RADAR_SECRET'')');
    IF v_nou = r.command THEN RAISE EXCEPTION '20261029d: inlocuire esuata job %', r.jobid; END IF;
    PERFORM cron.alter_job(job_id := r.jobid, command := v_nou);
  END LOOP;
END $cron$;

-- 2) rotirea: valoarea veche → RADAR_SECRET_VECHI (doar revenire), valoare nouă în RADAR_SECRET
DO $rot$
DECLARE v_id uuid; v_vechi text;
BEGIN
  SELECT id, decrypted_secret INTO v_id, v_vechi FROM vault.decrypted_secrets WHERE name = 'RADAR_SECRET';
  PERFORM vault.create_secret(v_vechi, 'RADAR_SECRET_VECHI',
    'valoarea x-radar dinainte de 20261029d (compromisa) - DOAR pentru revenire, neacceptata; de sters dupa 7 zile');
  PERFORM vault.update_secret(v_id, 'gzp-' || encode(extensions.gen_random_bytes(24), 'hex'));
END $rot$;

DO $post$
DECLARE v_nou text; v_vechi text;
BEGIN
  SELECT decrypted_secret INTO v_nou FROM vault.decrypted_secrets WHERE name = 'RADAR_SECRET';
  SELECT decrypted_secret INTO v_vechi FROM vault.decrypted_secrets WHERE name = 'RADAR_SECRET_VECHI';
  IF v_nou !~ '^gzp-[0-9a-f]{48}$' OR v_vechi !~ '^gzp-[0-9a-f]{48}$' OR v_nou = v_vechi THEN
    RAISE EXCEPTION '20261029d: postconditie Vault';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE command ILIKE '%x-radar-secret%' AND active AND username = 'postgres'
        AND command LIKE '%(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''RADAR_SECRET'')%'
        AND command !~ 'gzp-[0-9a-f]{20,}') <> 10
     OR EXISTS (SELECT 1 FROM cron.job WHERE position(v_vechi IN command) > 0 OR position(v_nou IN command) > 0) THEN
    RAISE EXCEPTION '20261029d: postconditie cron';
  END IF;
  IF (SELECT jsonb_object_agg(jobid::text, schedule) FROM cron.job WHERE command ILIKE '%x-radar-secret%')
       IS DISTINCT FROM '{"31":"0 5 * * *","32":"30 12 * * *","36":"40 6-20/2 * * *","42":"40 5 * * *","43":"10 13 * * *","45":"20 4 * * 1","46":"40 4 * * 1","47":"*/30 * * * *","49":"50 4 * * *","54":"30 4 * * *"}'::jsonb THEN
    RAISE EXCEPTION '20261029d: postconditie program';
  END IF;
  IF NOT public.fn_verifica_radar_secret(v_nou) OR public.fn_verifica_radar_secret(v_vechi)
     OR public.fn_verifica_radar_secret(NULL) OR public.fn_verifica_radar_secret(v_nou || 'x')
     OR NOT public.fn_radar_secret_ok(v_nou) OR public.fn_radar_secret_ok(v_vechi) OR public.fn_radar_secret_ok(left(v_nou, 24)) THEN
    RAISE EXCEPTION '20261029d: postconditie verificare (nou acceptat, vechi refuzat)';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261029d_radar_secret_vault_rotire:' || txid_current() THEN
    RAISE EXCEPTION '20261029d: garda final invalida';
  END IF;
END $post$;
