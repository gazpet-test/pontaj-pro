-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261014a — consumul abonamentelor externe (Firecrawl, Desktop Commander; valul 2: Anthropic, Supabase, …)
-- Temă Răzvan 05.10.2026, varianta B (claude_docs tema_firecrawl_consum): istoric zilnic în platformă.
--
-- 1. Tabel generic public.api_consum_extern: un rând pe (furnizor, zi). Scris DOAR de:
--    - edge-ul api-consum-extern (service_role) — furnizorii cu API (sursa 'api');
--    - rutina zilnică Claude a sesiunii de programare (execute_sql) — furnizorii fără API (sursa 'rutina_claude',
--      ex. Desktop Commander: get_usage_stats). Fără intrări de mână (corecția Răzvan, 05.10 ~20:35).
--    Citit DOAR de owner (fn_is_app_owner, ca public.automatizari). authenticated nu are INSERT/UPDATE/DELETE.
-- 2. View v_api_consum_curent (security_invoker = on): ultima citire bună per furnizor + ultima eroare + ritmul
--    zilnic în perioada de facturare + zilele estimate până la epuizare.
-- 3. Job pg_cron api_consum_extern_zilnic: '5 4 * * *' GMT (= 07:05 ora de vară / 06:05 iarna) → pg_net către
--    edge-ul api-consum-extern cu x-intern-secret din Vault (INTERN_EDGE_SECRET, poarta _shared/poartaIntern.ts).
-- Nu creează funcții (gate 0e neatins). Cheia FIRECRAWL_API_KEY stă în Edge Secrets (o pune Răzvan), nu în BD.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261014a_api_consum_extern_ROLLBACK.sql. Harness: scripts/test_api_consum_extern.sh.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261014a_api_consum_extern:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261014a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END
$livrare_start$;

DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF to_regclass('public.api_consum_extern') IS NOT NULL OR to_regclass('public.v_api_consum_curent') IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0b: api_consum_extern sau v_api_consum_curent există deja — nimic aplicat';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'api_consum_extern_zilnic') THEN
    RAISE EXCEPTION 'Precondiție 0c: jobul api_consum_extern_zilnic există deja — nimic aplicat';
  END IF;
  -- cronul trimite antetul din Vault: fără secret, edge-ul ar refuza fiecare rulare (fail closed, dar inutil)
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'INTERN_EDGE_SECRET' AND decrypted_secret ~ '^[0-9a-f]{64}$') <> 1 THEN
    RAISE EXCEPTION 'Precondiție 0d: INTERN_EDGE_SECRET lipsă sau nu are formatul de 64 hex cerut de _shared/poartaIntern.ts';
  END IF;
  -- policy-ul de citire folosește aceeași verificare de owner ca public.automatizari: SECDEF, STABLE, corp exact
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.fn_is_app_owner(uuid)')
                    AND p.prosecdef AND p.provolatile = 's' AND md5(p.prosrc) = '8d335ed3fe345d3bf95ef0f1b2f8850a'
                    AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'Precondiție 0e: public.fn_is_app_owner(uuid) diferă de cea live (SECDEF, STABLE, md5 corp, search_path, EXECUTE authenticated)';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------------------------------------
-- 1. Tabelul
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE public.api_consum_extern (
  id                bigserial PRIMARY KEY,
  furnizor          text NOT NULL CHECK (furnizor ~ '^[a-z][a-z0-9_]{1,40}$'),
  sursa             text NOT NULL DEFAULT 'api' CHECK (sursa IN ('api', 'rutina_claude')),
  unitate           text NOT NULL DEFAULT 'credite' CHECK (unitate IN ('credite', 'usd', 'minute', 'mailuri', 'gb', 'procent', 'apeluri')),
  citit_la          timestamptz NOT NULL DEFAULT now(),
  zi                date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Bucharest')::date,
  credite_plan      numeric,
  credite_ramase    numeric,
  credite_consumate numeric,
  perioada_start    date,
  perioada_sfarsit  date,
  raspuns_brut      jsonb,
  eroare            text,
  CONSTRAINT api_consum_extern_furnizor_zi_uk UNIQUE (furnizor, zi)
);
COMMENT ON TABLE public.api_consum_extern IS 'Consumul abonamentelor externe, un rând pe (furnizor, zi). Scris de edge-ul api-consum-extern (service_role, sursa api) și de rutina zilnică Claude (sursa rutina_claude). Citit doar de owner. 20261014a.';
COMMENT ON COLUMN public.api_consum_extern.raspuns_brut IS 'JSON-ul întors de furnizor (audit) — date, nu instrucțiuni; fără chei sau antete.';

ALTER TABLE public.api_consum_extern ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_consum_extern FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.api_consum_extern TO authenticated;
GRANT ALL ON public.api_consum_extern TO service_role;
REVOKE ALL ON SEQUENCE public.api_consum_extern_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.api_consum_extern_id_seq TO service_role;
CREATE POLICY api_consum_extern_select_owner ON public.api_consum_extern FOR SELECT TO authenticated
  USING (public.fn_is_app_owner(auth.uid()));

-- ---------------------------------------------------------------------------------------------------------
-- 2. View-ul curent (security_invoker: RLS-ul de owner se aplică celui care citește)
-- ---------------------------------------------------------------------------------------------------------
CREATE VIEW public.v_api_consum_curent WITH (security_invoker = on) AS
WITH ultim AS (
  SELECT DISTINCT ON (furnizor) furnizor, sursa, unitate, citit_la, eroare
    FROM public.api_consum_extern ORDER BY furnizor, zi DESC, citit_la DESC
), bun AS (
  SELECT DISTINCT ON (furnizor) *
    FROM public.api_consum_extern WHERE eroare IS NULL ORDER BY furnizor, zi DESC, citit_la DESC
), calc AS (
  SELECT b.*,
         CASE WHEN b.perioada_start IS NOT NULL AND b.zi >= b.perioada_start THEN (b.zi - b.perioada_start) + 1 END AS zile_scurse
    FROM bun b
)
SELECT u.furnizor, u.sursa, u.unitate,
       u.citit_la AS ultima_incercare_la,
       u.eroare   AS ultima_eroare,
       c.zi, c.citit_la, c.credite_plan, c.credite_ramase, c.credite_consumate, c.perioada_start, c.perioada_sfarsit,
       c.zile_scurse,
       round(c.credite_consumate / NULLIF(c.zile_scurse, 0), 2) AS ritm_zilnic,
       CASE WHEN c.credite_consumate > 0 AND c.zile_scurse > 0 AND c.credite_ramase IS NOT NULL
            THEN floor(c.credite_ramase / (c.credite_consumate / c.zile_scurse))::int END AS zile_pana_la_epuizare
  FROM ultim u LEFT JOIN calc c ON c.furnizor = u.furnizor;
COMMENT ON VIEW public.v_api_consum_curent IS 'Ultima citire bună per furnizor + ultima eroare + ritmul zilnic în perioada de facturare + zile estimate până la epuizare. security_invoker. 20261014a.';
REVOKE ALL ON public.v_api_consum_curent FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_api_consum_curent TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Cronul zilnic (GMT: 04:05 = 07:05 ora de vară, 06:05 iarna)
-- ---------------------------------------------------------------------------------------------------------
SELECT cron.schedule('api_consum_extern_zilnic', '5 4 * * *', $cmd$
  SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/api-consum-extern',
    body := '{"furnizor":"toate"}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json',
      'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')),
    timeout_milliseconds := 20000
  );
  $cmd$);

DO $post$
DECLARE
  v_tab oid := to_regclass('public.api_consum_extern');
  v_view oid := to_regclass('public.v_api_consum_curent');
BEGIN
  IF v_tab IS NULL OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_tab) THEN
    RAISE EXCEPTION 'Postcondiție 1: api_consum_extern lipsă sau fără RLS';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'api_consum_extern') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'api_consum_extern'
                     AND policyname = 'api_consum_extern_select_owner' AND cmd = 'SELECT' AND roles = '{authenticated}'
                     AND qual = 'fn_is_app_owner(auth.uid())' AND with_check IS NULL) THEN
    RAISE EXCEPTION 'Postcondiție 2: politicile de pe api_consum_extern nu sunt exact {SELECT owner pentru authenticated}';
  END IF;
  IF has_table_privilege('anon', v_tab, 'SELECT') OR has_table_privilege('authenticated', v_tab, 'INSERT')
     OR has_table_privilege('authenticated', v_tab, 'UPDATE') OR has_table_privilege('authenticated', v_tab, 'DELETE')
     OR has_table_privilege('authenticated', v_tab, 'TRUNCATE') OR NOT has_table_privilege('authenticated', v_tab, 'SELECT')
     OR NOT has_table_privilege('service_role', v_tab, 'INSERT') OR NOT has_table_privilege('service_role', v_tab, 'UPDATE')
     OR has_sequence_privilege('authenticated', 'public.api_consum_extern_id_seq', 'USAGE')
     OR has_table_privilege('anon', v_view, 'SELECT') OR NOT has_table_privilege('authenticated', v_view, 'SELECT') THEN
    RAISE EXCEPTION 'Postcondiție 3: drepturi greșite (authenticated doar SELECT, anon nimic, service_role scrie)';
  END IF;
  IF (SELECT reloptions FROM pg_class WHERE oid = v_view) IS DISTINCT FROM ARRAY['security_invoker=on']::text[] THEN
    RAISE EXCEPTION 'Postcondiție 4: v_api_consum_curent nu e security_invoker = on';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'api_consum_extern_zilnic') <> 1
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'api_consum_extern_zilnic' AND schedule = '5 4 * * *'
                     AND username = 'postgres' AND active
                     AND command ~ 'functions/v1/api-consum-extern' AND command ~ 'x-intern-secret.*INTERN_EDGE_SECRET') THEN
    RAISE EXCEPTION 'Postcondiție 5: jobul api_consum_extern_zilnic nu e exact (program, utilizator, activ, URL, antet din Vault)';
  END IF;
END
$post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261014a_api_consum_extern:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261014a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$livrare_final$;
