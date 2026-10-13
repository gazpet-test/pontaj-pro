-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261028d — fn_radar_secret_ok (13.10.2026, „da (a)” Răzvan direct în sesiunea Module, inventar securitate).
-- olx-api avea secretul x-radar SCRIS ÎN COD (compromis, citibil de oricine cu acces la sursă). Codul nou nu mai are
-- valoare: antetul x-radar-secret se verifică AICI, prin sha256, față de secretul RADAR_SECRET din Vault (același pe care
-- îl trimit deja joburile cron ale Ofertării). Doar service_role are EXECUTE (edge-ul îl cheamă cu cheia de serviciu).
-- Nu schimbă nimic altceva. Revenire: supabase/revenire/20261028d_radar_secret_ok_ROLLBACK.sql (DROP FUNCTION).
-- LIVRARE: doar prin scripts/livrare_migrare.sh; fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261028d_radar_secret_ok:' || txid_current() THEN
    RAISE EXCEPTION '20261028d: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261028d: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_radar_secret_ok(text)') IS NOT NULL THEN RAISE EXCEPTION '20261028d: functia exista deja'; END IF;
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'RADAR_SECRET') <> 1 THEN RAISE EXCEPTION '20261028d: RADAR_SECRET lipsa in Vault'; END IF;
END $pre$;

CREATE FUNCTION public.fn_radar_secret_ok(p_secret text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  SELECT coalesce(length(p_secret) BETWEEN 32 AND 200
     AND extensions.digest(p_secret, 'sha256') = extensions.digest(
           (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'RADAR_SECRET'), 'sha256'), false)
$f$;
REVOKE ALL ON FUNCTION public.fn_radar_secret_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_radar_secret_ok(text) TO service_role;

DO $post$
DECLARE v text;
BEGIN
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = 'RADAR_SECRET';
  IF NOT public.fn_radar_secret_ok(v) OR public.fn_radar_secret_ok(v || 'x') OR public.fn_radar_secret_ok(NULL)
     OR public.fn_radar_secret_ok(left(v, 24)) THEN
    RAISE EXCEPTION '20261028d: postconditie fn_radar_secret_ok';
  END IF;
  IF has_function_privilege('anon', 'public.fn_radar_secret_ok(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_radar_secret_ok(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_radar_secret_ok(text)', 'EXECUTE')
     OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc
              WHERE oid = 'public.fn_radar_secret_ok(text)'::regprocedure) THEN
    RAISE EXCEPTION '20261028d: postconditie drepturi';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261028d_radar_secret_ok:' || txid_current() THEN
    RAISE EXCEPTION '20261028d: garda final invalida';
  END IF;
END $post$;
