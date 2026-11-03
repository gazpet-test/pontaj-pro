-- Version 20261130123000. Runner supplies one transaction.
-- 20261130d_sms_sold — soldul SMSLink, citit zilnic, cu alerta sub prag (variantele implicite acceptate de Razvan, 03.11.2026:
-- docs/sms/RAPORT_SMSLINK_API_2026-11-03.md §4 „mode=Credit -> cron zilnic + alerta sub un prag (de exemplu 150 de SMS-uri)”).
-- Peste 20261130a + 20261130b (aplicate). NU depinde de 20261130c si nu o atinge: nu inlocuieste nicio functie si nu creeaza functii
-- cu prefixul fn_sms_ (portile 30b / 30c numara exact functiile fn_sms_*), deci 30c si 30d se pot aplica in orice ordine.
-- Ce face:
--   * public.sms_sold: un singur rand cu ultima citire BUNA (credit + citit_la) si ultima EROARE (cod scurt + eroare_la), in coloane
--     separate (o eroare nu sterge citirea buna). Fara raspunsul brut al furnizorului (eroarea 7 SMSLink contine parola).
--     RLS pornit, nicio politica, niciun drept pentru anon / authenticated / service_role: scrierea si citirea DOAR prin RPC-uri.
--   * fn_sold_sms_prag() = 150 (constanta; o schimba Razvan cu o migrare noua) si fn_sold_sms_stare() = SINGURA definitie a alertei
--     (sub_prag / citire_veche peste 36 h / eroare_dupa_citire), folosita si la scriere, si la citire (UI + Administrator -> Alerte);
--   * fn_sold_sms_inregistreaza(p_credit, p_eroare): DOAR service_role (edge-ul sms-sold, dupa poarta cron intern / owner);
--   * fn_sold_sms_citeste(): DOAR owner-ul (fn_sms_e_owner din 20261130a, md5 verificat), pentru panoul SMS; vederea v_sms_sold
--     (security_invoker, un rand din fn_sold_sms_citeste) pentru sursa din Administrator -> Alerte (adaptorii de acolo citesc doar
--     tabele / vederi, fara rpc); pentru non-owner vederea are 0 randuri (filtrul fn_sms_e_owner), iar functia refuza oricum;
--   * jobul pg_cron sms_sold_zilnic '10 5 * * *' (cron.timezone = GMT: 07:10 ora Romaniei iarna, 08:10 vara) -> pg_net -> edge-ul
--     sms-sold cu x-intern-secret din Vault (INTERN_EDGE_SECRET), ca 20261014a. Programat cu cron.schedule (cron.job NU se scrie /
--     blocheaza direct: pe productie postgres nu e superuser).
-- Fara mail, fara SMS, fara date reale atinse (doar randul nou din sms_sold). Ordinea de livrare: deploy edge sms-sold (NO_JWT), apoi
-- migrarea (pana la primul deploy cronul ar primi 404 — fara efect). Revenire: supabase/revenire/20261130d_sms_sold_ROLLBACK.sql.
-- DRY: supabase/tests/20261130d_sms_sold_dryrun.sql. Izolare: READ COMMITTED (ca PostgREST).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130d_sms_sold:' || txid_current() THEN
    RAISE EXCEPTION '20261130d: garda start invalida';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION '20261130d: izolarea trebuie sa fie READ COMMITTED'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.sms_setari') IS NULL OR to_regprocedure('public.fn_sms_nivel()') IS NULL THEN
    RAISE EXCEPTION '20261130d: 20261130a / 20261130b lipsesc';
  END IF;
  IF to_regclass('public.sms_sold') IS NOT NULL OR to_regclass('public.v_sms_sold') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sold!_sms!_%' ESCAPE '!') THEN
    RAISE EXCEPTION '20261130d: sms_sold sau functiile fn_sold_sms_* exista deja';
  END IF;
  -- verificarea de owner folosita de fn_sold_sms_citeste: exact cea din 20261130a (md5 fara CR, ca in 20261130c)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_sms_e_owner()') AND p.prosecdef
                   AND md5(replace(p.prosrc, chr(13), '')) = '4ea29d605a2a8b491594f9d43da7385c'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[] AND pg_get_userbyid(p.proowner) = 'postgres') THEN
    RAISE EXCEPTION '20261130d: public.fn_sms_e_owner() difera de 20261130a';
  END IF;
  -- poarta edge-ului sms-sold cere fn_sms_nivel() cu JWT-ul contului: trebuie sa fie apelabila de authenticated
  IF NOT has_function_privilege('authenticated', 'public.fn_sms_nivel()', 'EXECUTE') THEN
    RAISE EXCEPTION '20261130d: fn_sms_nivel() nu e apelabila de authenticated (poarta owner a edge-ului sms-sold)';
  END IF;
  IF to_regclass('cron.job') IS NULL OR to_regprocedure('cron.schedule(text,text,text)') IS NULL
     OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION '20261130d: lipsesc pg_cron / pg_net / vault';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sms_sold_zilnic') THEN RAISE EXCEPTION '20261130d: jobul sms_sold_zilnic exista deja'; END IF;
  -- '10 5 * * *' = 07:10 ora Romaniei (iarna) DOAR daca pg_cron ruleaza pe GMT (ca 20261014a)
  IF current_setting('cron.timezone', true) IS DISTINCT FROM 'GMT' THEN
    RAISE EXCEPTION '20261130d: cron.timezone = % (astept GMT)', coalesce(current_setting('cron.timezone', true), '<nesetat>');
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'INTERN_EDGE_SECRET' AND decrypted_secret ~ '^[0-9a-f]{64}$') <> 1 THEN
    RAISE EXCEPTION '20261130d: INTERN_EDGE_SECRET lipsa sau nu are formatul de 64 hex cerut de _shared/poartaIntern.ts';
  END IF;
  IF has_schema_privilege('anon', 'public', 'CREATE') OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION '20261130d: anon/authenticated pot crea obiecte in public';
  END IF;
END $pre$;

-- ─── 1. Tabela (un rand) ──────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.sms_sold (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  credit integer CHECK (credit IS NULL OR credit BETWEEN 0 AND 10000000),
  citit_la timestamptz,
  eroare text CHECK (eroare IS NULL OR eroare ~ '^[a-z0-9_]{1,40}$'),
  eroare_la timestamptz,
  CONSTRAINT sms_sold_citire CHECK ((credit IS NULL) = (citit_la IS NULL)),
  CONSTRAINT sms_sold_eroare CHECK ((eroare IS NULL) = (eroare_la IS NULL))
);
COMMENT ON TABLE public.sms_sold IS 'SMS: soldul SMSLink, un singur rand. credit + citit_la = ultima citire buna (mode=Credit); eroare + eroare_la = ultima eroare (doar cod scurt, niciodata textul furnizorului). Scris DOAR de fn_sold_sms_inregistreaza (edge sms-sold), citit DOAR prin fn_sold_sms_citeste (owner). 20261130d.';
ALTER TABLE public.sms_sold ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_sold FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.sms_sold (id) VALUES (true);

-- ─── 2. Functii ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_sold_sms_prag() RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT 150
$fn$;
COMMENT ON FUNCTION public.fn_sold_sms_prag() IS 'SMS (pura, interna): pragul de alerta pentru soldul SMSLink, in SMS-uri. Constanta: 150 (o schimba Razvan cu o migrare noua).';

CREATE FUNCTION public.fn_sold_sms_stare() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT jsonb_build_object('credit', x.credit, 'citit_la', x.citit_la, 'eroare', x.eroare, 'eroare_la', x.eroare_la, 'prag', x.prag,
           'sub_prag', x.sub_prag, 'citire_veche', x.veche, 'eroare_dupa_citire', x.err,
           'alerta', x.sub_prag OR x.veche OR x.err)
    FROM (SELECT s.credit, s.citit_la, s.eroare, s.eroare_la, public.fn_sold_sms_prag() AS prag,
                 (s.credit IS NOT NULL AND s.credit < public.fn_sold_sms_prag()) AS sub_prag,
                 (s.citit_la IS NULL OR s.citit_la < now() - interval '36 hours') AS veche,
                 (s.eroare_la IS NOT NULL AND (s.citit_la IS NULL OR s.eroare_la > s.citit_la)) AS err
            FROM public.sms_sold s WHERE s.id) x
$fn$;
COMMENT ON FUNCTION public.fn_sold_sms_stare() IS 'SMS (intern, fara drept de apel): starea soldului + SINGURA definitie a alertei: sub_prag (credit < fn_sold_sms_prag()), citire_veche (nicio citire buna in ultimele 36 h), eroare_dupa_citire (ultima incercare a esuat). alerta = oricare.';

CREATE FUNCTION public.fn_sold_sms_inregistreaza(p_credit integer, p_eroare text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer;
BEGIN
  IF (p_credit IS NULL) = (p_eroare IS NULL) THEN
    RAISE EXCEPTION 'sms sold: exact unul dintre credit si eroare' USING ERRCODE = '22023';
  END IF;
  IF p_credit IS NOT NULL THEN
    IF p_credit NOT BETWEEN 0 AND 10000000 THEN RAISE EXCEPTION 'sms sold: credit in afara limitelor' USING ERRCODE = '22023'; END IF;
    UPDATE public.sms_sold SET credit = p_credit, citit_la = now() WHERE id;
  ELSE
    IF p_eroare !~ '^[a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'sms sold: codul de eroare nu e un cod scurt' USING ERRCODE = '22023'; END IF;
    UPDATE public.sms_sold SET eroare = p_eroare, eroare_la = now() WHERE id;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'sms sold: randul de sold lipseste' USING ERRCODE = 'P0002'; END IF;
  RETURN public.fn_sold_sms_stare();
END $fn$;
COMMENT ON FUNCTION public.fn_sold_sms_inregistreaza(integer, text) IS 'SMS (doar service_role, din edge sms-sold dupa poarta cron intern / owner): scrie ultima citire buna (p_credit) SAU ultima eroare (p_eroare = cod scurt [a-z0-9_]); cealalta pereche ramane neatinsa. Intoarce fn_sold_sms_stare().';

CREATE FUNCTION public.fn_sold_sms_citeste() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.fn_sms_e_owner() THEN
    RAISE EXCEPTION 'sms: doar owner-ul vede soldul SMSLink' USING ERRCODE = '42501';
  END IF;
  RETURN public.fn_sold_sms_stare();
END $fn$;
COMMENT ON FUNCTION public.fn_sold_sms_citeste() IS 'SMS (owner): soldul SMSLink + alerta (fn_sold_sms_stare). Folosita de panoul SMS si de Administrator -> Alerte (sursa SMS sold).';

-- privilegiile implicite Supabase dau EXECUTE pe functii noi: se scot explicit, apoi exact cine trebuie
REVOKE ALL ON FUNCTION public.fn_sold_sms_prag(), public.fn_sold_sms_stare(), public.fn_sold_sms_inregistreaza(integer, text), public.fn_sold_sms_citeste()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sold_sms_inregistreaza(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_sold_sms_citeste() TO authenticated;

CREATE VIEW public.v_sms_sold WITH (security_invoker = on) AS
SELECT true AS id, (x.s->>'credit')::integer AS credit, (x.s->>'citit_la')::timestamptz AS citit_la, x.s->>'eroare' AS eroare,
       (x.s->>'eroare_la')::timestamptz AS eroare_la, (x.s->>'prag')::integer AS prag, (x.s->>'sub_prag')::boolean AS sub_prag,
       (x.s->>'citire_veche')::boolean AS citire_veche, (x.s->>'eroare_dupa_citire')::boolean AS eroare_dupa_citire, (x.s->>'alerta')::boolean AS alerta
  FROM (SELECT public.fn_sold_sms_citeste() AS s) x
 WHERE public.fn_sms_e_owner();
COMMENT ON VIEW public.v_sms_sold IS 'SMS: soldul SMSLink + alerta, un rand, din fn_sold_sms_citeste(); doar owner (filtrul fn_sms_e_owner: altcineva vede 0 randuri, iar functia refuza oricum cu 42501). security_invoker. Sursa SMS sold din Administrator -> Alerte. 20261130d.';
REVOKE ALL ON public.v_sms_sold FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_sms_sold TO authenticated;

-- ─── 3. Cronul zilnic (GMT 05:10 = 07:10 ora Romaniei iarna / 08:10 vara); comanda pe un rand (md5 independent de CRLF) ─────────
SELECT cron.schedule('sms_sold_zilnic', '10 5 * * *', $cmd$SELECT net.http_post(url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/sms-sold', body := '{}'::jsonb, headers := jsonb_build_object('Content-Type', 'application/json', 'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')), timeout_milliseconds := 30000)$cmd$);

DO $post$
DECLARE v_o oid; v_s jsonb;
  v_toate regprocedure[] := ARRAY['public.fn_sold_sms_prag()', 'public.fn_sold_sms_stare()', 'public.fn_sold_sms_inregistreaza(integer,text)',
    'public.fn_sold_sms_citeste()']::regprocedure[];
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sms_sold'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sms_sold')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.sms_sold'::regclass AND NOT tgisinternal)
     OR has_table_privilege('anon', 'public.sms_sold', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_table_privilege('authenticated', 'public.sms_sold', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_table_privilege('service_role', 'public.sms_sold', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR (SELECT count(*) FROM public.sms_sold) <> 1 THEN
    RAISE EXCEPTION '20261130d: sms_sold nu e exact cea asteptata (RLS fara politici, fara drepturi, un rand)';
  END IF;
  IF (SELECT reloptions FROM pg_class WHERE oid = 'public.v_sms_sold'::regclass) IS DISTINCT FROM ARRAY['security_invoker=on']::text[]
     OR has_table_privilege('anon', 'public.v_sms_sold', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_table_privilege('service_role', 'public.v_sms_sold', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_table_privilege('authenticated', 'public.v_sms_sold', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR NOT has_table_privilege('authenticated', 'public.v_sms_sold', 'SELECT') THEN
    RAISE EXCEPTION '20261130d: vederea v_sms_sold nu e exact cea asteptata (security_invoker, doar SELECT pentru authenticated)';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sold!_sms!_%' ESCAPE '!') <> 4 THEN
    RAISE EXCEPTION '20261130d: functiile fn_sold_sms_* nu sunt exact 4';
  END IF;
  FOREACH v_o IN ARRAY v_toate::oid[] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_o AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
                     AND pg_get_userbyid(p.proowner) = 'postgres')
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_o) IS DISTINCT FROM (v_o <> 'public.fn_sold_sms_prag()'::regprocedure)
       OR (SELECT p.proacl IS NULL FROM pg_proc p WHERE p.oid = v_o)
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_o AND a.grantee = 0)
       OR has_function_privilege('anon', v_o, 'EXECUTE')
       OR has_function_privilege('authenticated', v_o, 'EXECUTE') IS DISTINCT FROM (v_o = 'public.fn_sold_sms_citeste()'::regprocedure)
       OR has_function_privilege('service_role', v_o, 'EXECUTE') IS DISTINCT FROM (v_o = 'public.fn_sold_sms_inregistreaza(integer,text)'::regprocedure) THEN
      RAISE EXCEPTION '20261130d: functia % are setari / drepturi gresite', v_o::regprocedure;
    END IF;
  END LOOP;
  -- echivalentul local al portii permanente 0e (scripts/control_0e.sql) pe singura functie expusa
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.fn_sold_sms_citeste()'::regprocedure
               AND lower(p.prosrc || ' ' || pg_get_function_arguments(p.oid)) ~ '(set_config|request[[:space:]]*[.][[:space:]]*jwt|[[:<:]]execute[[:>:]]|session[_[:space:]]+authorization|[[:<:]]role[[:>:]]|[[:<:]]u&)') THEN
    RAISE EXCEPTION '20261130d: fn_sold_sms_citeste contine o constructie interzisa de poarta 0e';
  END IF;
  IF current_setting('cron.timezone', true) IS DISTINCT FROM 'GMT'
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'sms_sold_zilnic') <> 1
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sms_sold_zilnic' AND schedule = '10 5 * * *' AND active AND username = 'postgres'
                      AND md5(replace(command, chr(13), '')) = '1e88170e8c48a2e27bb97e45d31a77f5') THEN
    RAISE EXCEPTION '20261130d: jobul sms_sold_zilnic nu e exact (GMT, program, activ, postgres, md5 comanda)';
  END IF;
  -- starea initiala: nicio citire = alerta „citire veche” (Date lipsa), nu „sub prag”
  v_s := public.fn_sold_sms_stare();
  IF public.fn_sold_sms_prag() <> 150 OR v_s->>'credit' IS NOT NULL OR (v_s->>'sub_prag')::boolean OR NOT (v_s->>'citire_veche')::boolean
     OR NOT (v_s->>'alerta')::boolean THEN
    RAISE EXCEPTION '20261130d: starea initiala a soldului nu e cea asteptata';
  END IF;
END $post$;

DO $final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130d_sms_sold:' || txid_current() THEN
    RAISE EXCEPTION '20261130d: garda final invalida';
  END IF;
END $final$;
