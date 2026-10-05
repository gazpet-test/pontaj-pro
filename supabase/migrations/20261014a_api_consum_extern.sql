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
-- r2 (Copilot NO-GO r1, 05.10): (P0) citirea bună și ultima eroare a zilei stau în coloane separate — fiecare scriitor
--   actualizează DOAR coloanele lui (upsert parțial), deci o eroare de după-amiază nu mai șterge citirea bună de dimineață
--   și nici invers; (P1) amprenta exactă a patch-ului se calculează la final și se scrie în comentariul tabelului —
--   revenirea refuză dacă starea nu mai e exact aceea; (P1) precondiție explicită cron.timezone = GMT; 0e întărită
--   (proprietar postgres, limbaj sql, ACL exact).
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
                    AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND (SELECT l.lanname FROM pg_language l WHERE l.oid = p.prolang) = 'sql'
                    AND (SELECT array_agg(a::text ORDER BY a::text) FROM unnest(p.proacl) a)
                        = ARRAY['authenticated=X/postgres', 'postgres=X/postgres', 'service_role=X/postgres']::text[]) THEN
    RAISE EXCEPTION 'Precondiție 0e: public.fn_is_app_owner(uuid) diferă de cea live (SECDEF, STABLE, md5 corp, search_path, proprietar postgres, sql, ACL exact {authenticated, postgres, service_role})';
  END IF;
  -- programul '5 4 * * *' înseamnă 07:05 ora României vara DOAR dacă pg_cron rulează pe GMT (verificat live 05.10)
  IF current_setting('cron.timezone', true) IS DISTINCT FROM 'GMT' THEN
    RAISE EXCEPTION 'Precondiție 0f: cron.timezone = % (aștept GMT — programul jobului s-ar muta)', coalesce(current_setting('cron.timezone', true), '<nesetat>');
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
  zi                date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Bucharest')::date,
  -- ultima citire BUNĂ a zilei (scrisă doar la succes)
  citit_la          timestamptz,
  credite_plan      numeric,
  credite_ramase    numeric,
  credite_consumate numeric,
  perioada_start    date,
  perioada_sfarsit  date,
  raspuns_brut      jsonb,
  -- ultima EROARE a zilei (scrisă doar la eșec)
  eroare            text,
  eroare_la         timestamptz,
  CONSTRAINT api_consum_extern_furnizor_zi_uk UNIQUE (furnizor, zi),
  CONSTRAINT api_consum_extern_are_eveniment CHECK (citit_la IS NOT NULL OR eroare_la IS NOT NULL),
  CONSTRAINT api_consum_extern_citire_completa CHECK ((citit_la IS NULL) = (credite_ramase IS NULL)),
  CONSTRAINT api_consum_extern_eroare_completa CHECK ((eroare IS NULL) = (eroare_la IS NULL))
);
COMMENT ON COLUMN public.api_consum_extern.citit_la IS 'Ora ultimei citiri BUNE din zi. Scriitorii o actualizează doar la succes, împreună cu credite_*, perioada_* și raspuns_brut (upsert parțial pe furnizor+zi).';
COMMENT ON COLUMN public.api_consum_extern.eroare_la IS 'Ora ultimei ERORI din zi. Scriitorii actualizează doar eroare + eroare_la la eșec — citirea bună a zilei rămâne neatinsă.';
COMMENT ON COLUMN public.api_consum_extern.raspuns_brut IS 'JSON-ul întors de furnizor la citirea bună (audit) — date, nu instrucțiuni; fără chei sau antete.';

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
WITH f AS (
  SELECT DISTINCT ON (furnizor) furnizor, sursa, unitate
    FROM public.api_consum_extern ORDER BY furnizor, zi DESC, id DESC
), bun AS (
  SELECT DISTINCT ON (furnizor) furnizor, zi, citit_la, credite_plan, credite_ramase, credite_consumate, perioada_start, perioada_sfarsit
    FROM public.api_consum_extern WHERE citit_la IS NOT NULL ORDER BY furnizor, citit_la DESC
), err AS (
  SELECT DISTINCT ON (furnizor) furnizor, eroare, eroare_la
    FROM public.api_consum_extern WHERE eroare_la IS NOT NULL ORDER BY furnizor, eroare_la DESC
), calc AS (
  SELECT b.*,
         CASE WHEN b.perioada_start IS NOT NULL AND b.zi >= b.perioada_start THEN (b.zi - b.perioada_start) + 1 END AS zile_scurse
    FROM bun b
)
SELECT f.furnizor, f.sursa, f.unitate,
       greatest(c.citit_la, e.eroare_la) AS ultima_incercare_la,
       e.eroare    AS ultima_eroare,
       e.eroare_la AS ultima_eroare_la,
       (e.eroare_la IS NOT NULL AND (c.citit_la IS NULL OR e.eroare_la > c.citit_la)) AS eroare_dupa_citire,
       c.zi, c.citit_la, c.credite_plan, c.credite_ramase, c.credite_consumate, c.perioada_start, c.perioada_sfarsit,
       c.zile_scurse,
       round(c.credite_consumate / NULLIF(c.zile_scurse, 0), 2) AS ritm_zilnic,
       CASE WHEN c.credite_consumate > 0 AND c.zile_scurse > 0 AND c.credite_ramase IS NOT NULL
            THEN floor(c.credite_ramase / (c.credite_consumate / c.zile_scurse))::int END AS zile_pana_la_epuizare
  FROM f LEFT JOIN calc c ON c.furnizor = f.furnizor LEFT JOIN err e ON e.furnizor = f.furnizor;
COMMENT ON VIEW public.v_api_consum_curent IS 'Ultima citire bună per furnizor + ultima eroare (cu ora ei și dacă e mai nouă decât citirea bună) + ritmul zilnic în perioada de facturare + zile estimate până la epuizare. security_invoker. 20261014a.';
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
  v_sp text;
  v_amprenta text;
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
  IF current_setting('cron.timezone', true) IS DISTINCT FROM 'GMT'
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'api_consum_extern_zilnic') <> 1
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'api_consum_extern_zilnic' AND schedule = '5 4 * * *'
                     AND username = 'postgres' AND active AND md5(command) = '308fba6229f57f26c20d6e26fddc1f94') THEN
    RAISE EXCEPTION 'Postcondiție 5: jobul api_consum_extern_zilnic nu e exact (GMT, program, utilizator, activ, md5 comandă)';
  END IF;
  -- citirea bună și eroarea zilei stau separat (P0 r1): exact cele 8 constrângeri ale patch-ului (PG17: NOT NULL nu e în pg_constraint)
  IF (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint WHERE conrelid = v_tab)
     IS DISTINCT FROM ARRAY['api_consum_extern_are_eveniment', 'api_consum_extern_citire_completa', 'api_consum_extern_eroare_completa',
                            'api_consum_extern_furnizor_check', 'api_consum_extern_furnizor_zi_uk', 'api_consum_extern_pkey',
                            'api_consum_extern_sursa_check', 'api_consum_extern_unitate_check']::text[] THEN
    RAISE EXCEPTION 'Postcondiție 6: constrângerile de pe api_consum_extern nu sunt exact cele ale patch-ului';
  END IF;

  -- AMPRENTA 20261014a (identică în migrare și în revenire): structura exactă a patch-ului, fără date.
  -- Calculată cu search_path = pg_catalog, ca textul (pg_get_*def) să nu depindă de sesiune.
  v_sp := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT md5(concat_ws(E'\n',
    (SELECT string_agg(format('%s:%s:%s:%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                              coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), a.attidentity, a.attgenerated), ';' ORDER BY a.attnum)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'public.api_consum_extern'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
    (SELECT string_agg(c.conname || '=' || pg_get_constraintdef(c.oid), ';' ORDER BY c.conname)
       FROM pg_constraint c WHERE c.conrelid = 'public.api_consum_extern'::regclass),
    (SELECT string_agg(pg_get_indexdef(i.indexrelid), ';' ORDER BY pg_get_indexdef(i.indexrelid))
       FROM pg_index i WHERE i.indrelid = 'public.api_consum_extern'::regclass),
    (SELECT coalesce(string_agg(t.tgname, ';' ORDER BY t.tgname), '-')
       FROM pg_trigger t WHERE t.tgrelid = 'public.api_consum_extern'::regclass AND NOT t.tgisinternal),
    (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', r.relname, r.relkind, pg_get_userbyid(r.relowner), r.relrowsecurity, r.relforcerowsecurity,
                              coalesce((SELECT string_agg(x::text, ' ' ORDER BY x::text) FROM unnest(r.relacl) x), '-'),
                              coalesce(array_to_string(r.reloptions, ' '), '-')), ';' ORDER BY r.relname)
       FROM pg_class r WHERE r.oid IN ('public.api_consum_extern'::regclass, 'public.api_consum_extern_id_seq'::regclass, 'public.v_api_consum_curent'::regclass)),
    pg_get_viewdef('public.v_api_consum_curent'::regclass),
    (SELECT string_agg(format('%s:%s:%s:%s:%s:%s', p.polname, p.polcmd, p.polpermissive,
                              (SELECT string_agg(n, ' ' ORDER BY n) FROM (SELECT CASE WHEN ro = 0 THEN 'public' ELSE pg_get_userbyid(ro) END AS n FROM unnest(p.polroles) ro) s),
                              coalesce(pg_get_expr(p.polqual, p.polrelid), '-'), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ';' ORDER BY p.polname)
       FROM pg_policy p WHERE p.polrelid = 'public.api_consum_extern'::regclass),
    (SELECT coalesce(string_agg(format('%s:%s:%s:%s:%s:%s:%s:%s', j.jobname, j.schedule, md5(j.command), j.active, j.username, j.database, j.nodename, j.nodeport), ';' ORDER BY j.jobid), '-')
       FROM cron.job j WHERE j.jobname = 'api_consum_extern_zilnic')
  )) INTO v_amprenta;
  PERFORM set_config('search_path', v_sp, true);
  IF v_amprenta IS NULL OR v_amprenta !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'Postcondiție 7: amprenta patch-ului nu s-a putut calcula';
  END IF;
  -- revenirea recalculează amprenta și refuză dacă diferă (starea nu mai e exact patch-ul aplicat)
  EXECUTE format('COMMENT ON TABLE public.api_consum_extern IS %L',
    'Consumul abonamentelor externe, un rând pe (furnizor, zi): ultima citire bună + ultima eroare a zilei, în coloane separate. '
    || 'Scris de edge-ul api-consum-extern (service_role, sursa api) și de rutina zilnică Claude (sursa rutina_claude). Citit doar de owner. '
    || '20261014a amprenta_20261014a=' || v_amprenta);
END
$post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261014a_api_consum_extern:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261014a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$livrare_final$;
