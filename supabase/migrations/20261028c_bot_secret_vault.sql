-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261028c — Rotirea BOT_SECRET (decizia Răzvan 13.10.2026, scrisă direct în sesiunea Module:
-- „da, fix bot-secret: PR + deploy edge + rotire BOT_SECRET”).
-- De ce: valoarea veche era în bundle-ul JS (src/SugestiiChuckTab.jsx) și ca fallback literal în nightly_patrol_bot și
-- chuck_norris_hr_bot → oricine putea porni boții (cost AI + date HR în răspuns). Valoarea veche e compromisă.
-- Ce face:
--   * secret NOU în Vault, „BOT_SECRET”, generat aici din gen_random_bytes(32) — nu e scris nicăieri, nu trece prin chat;
--   * fn_bot_secret_ok(p_secret) — SECURITY DEFINER, DOAR service_role: compară sha256(p_secret) cu sha256(Vault);
--     edge-urile noi o cheamă (supabase/functions/*/acces.ts); fără fallback;
--   * cele 7 joburi cron (scorilos_patrol_0200…0315, chuck_norris_hr_zilnic_0700): antetul x-bot-secret citit din
--     vault.decrypted_secrets în loc de literal. Precondiție pe md5-ul exact al comenzilor de azi.
-- NU atinge: import-evogps-gmail și productie-mail-facturi (alte secrete — PR-ul separat de Vault, etapa 2).
-- Ordinea livrării (Copilot r1 P1-1): ÎNTÂI deploy chuck_norris_hr_bot + nightly_patrol_bot (codul nou nu mai are
--   fallback → secretul compromis nu mai deschide nimic; până la migrare cron-ul pică fail-closed), APOI migrarea.
-- Joburile 6–12 sunt oprite (active=false) din 13.10 la decizia lui Răzvan: migrarea schimbă DOAR comanda, nu active.
-- Revenire: supabase/revenire/20261028c_bot_secret_vault_ROLLBACK.sql (dezactivează joburile, nu reînvie secretul vechi).
-- LIVRARE: doar prin scripts/livrare_migrare.sh; fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
DECLARE
  c_md5 CONSTANT jsonb := '{"6":"2e3e123c57e85056bdbf29728571a2c3","7":"9f3f7679e42574c4663f1c3202650780","8":"8c42b72a1a27a64b800bc560c34e62bf","9":"a36b7a4544d1d694e1471257d6c8f5fc","10":"2e591e7e1a98286d20164ab203b1de4d","11":"d2d9e810dac2416dae6b2f5c7b69683b","12":"0aa19a32d9c3f639e687d8697cee0ce7"}';
  r record; n int := 0;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261028c_bot_secret_vault:' || txid_current() THEN
    RAISE EXCEPTION '20261028c: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261028c: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_bot_secret_ok(text)') IS NOT NULL THEN RAISE EXCEPTION '20261028c: functia exista deja'; END IF;
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'BOT_SECRET') THEN RAISE EXCEPTION '20261028c: BOT_SECRET exista deja in Vault'; END IF;
  FOR r IN SELECT jobid, md5(command) m FROM cron.job WHERE jobid IN (6,7,8,9,10,11,12) LOOP
    n := n + 1;
    IF r.m IS DISTINCT FROM c_md5->>r.jobid::text THEN RAISE EXCEPTION '20261028c: preconditie job %', r.jobid; END IF;
  END LOOP;
  IF n <> 7 THEN RAISE EXCEPTION '20261028c: joburi lipsa (%)', n; END IF;
END $pre$;

SELECT vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'BOT_SECRET',
  'x-bot-secret pentru nightly_patrol_bot + chuck_norris_hr_bot (20261028c, rotit 13.10.2026)');

CREATE FUNCTION public.fn_bot_secret_ok(p_secret text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  SELECT coalesce(length(p_secret) BETWEEN 32 AND 200
     AND extensions.digest(p_secret, 'sha256') = extensions.digest(
           (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'BOT_SECRET'), 'sha256'), false)
$f$;
REVOKE ALL ON FUNCTION public.fn_bot_secret_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bot_secret_ok(text) TO service_role;

DO $cron$
DECLARE r record; v_nou text;
BEGIN
  FOR r IN SELECT jobid, command FROM cron.job WHERE jobid IN (6,7,8,9,10,11,12) LOOP
    v_nou := regexp_replace(r.command, '''x-bot-secret'',\s*''[^'']+''',
      '''x-bot-secret'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''BOT_SECRET'')');
    IF v_nou = r.command THEN RAISE EXCEPTION '20261028c: inlocuire esuata job %', r.jobid; END IF;
    PERFORM cron.alter_job(job_id := r.jobid, command := v_nou);
  END LOOP;
END $cron$;

DO $post$
DECLARE v text;
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobid IN (6,7,8,9,10,11,12)
        AND command LIKE '%''x-bot-secret'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''BOT_SECRET'')%'
        AND command !~ '''x-bot-secret'',\s*''') <> 7 THEN
    RAISE EXCEPTION '20261028c: postconditie cron';
  END IF;
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = 'BOT_SECRET';
  IF length(v) <> 64 OR NOT public.fn_bot_secret_ok(v) OR public.fn_bot_secret_ok(v || 'x') OR public.fn_bot_secret_ok(NULL)
     OR public.fn_bot_secret_ok(left(v, 20)) THEN
    RAISE EXCEPTION '20261028c: postconditie fn_bot_secret_ok';
  END IF;
  IF has_function_privilege('anon', 'public.fn_bot_secret_ok(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_bot_secret_ok(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_bot_secret_ok(text)', 'EXECUTE')
     OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc
              WHERE oid = 'public.fn_bot_secret_ok(text)'::regprocedure) THEN
    RAISE EXCEPTION '20261028c: postconditie drepturi';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261028c_bot_secret_vault:' || txid_current() THEN
    RAISE EXCEPTION '20261028c: garda final invalida';
  END IF;
END $post$;
