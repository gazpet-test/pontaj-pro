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
--   * fn_sold_sms_inregistreaza(p_credit, p_eroare, p_inceput): DOAR service_role (edge-ul sms-sold, dupa poarta cron intern / owner);
--   * fn_sold_sms_citeste(): DOAR owner-ul (fn_sms_e_owner din 20261130a, md5 verificat), pentru panoul SMS; vederea v_sms_sold
--     (security_invoker, un rand din fn_sold_sms_citeste) pentru sursa din Administrator -> Alerte (adaptorii de acolo citesc doar
--     tabele / vederi, fara rpc);
--   * jobul pg_cron sms_sold_zilnic '10 5 * * *' -> pg_net -> edge-ul sms-sold cu x-intern-secret din Vault (INTERN_EDGE_SECRET), ca
--     20261014a. Programat cu cron.schedule (cron.job NU se scrie / blocheaza direct: pe productie postgres nu e superuser).
-- r2 (#971, Jakarinos r1 + Copilot r1 NO-GO; variantele implicite ale coordonatorului, Razvan doarme):
--   * P2-04 (implicit): scrierea e CAS pe momentul de START al citirii (p_inceput, trimis de edge inainte de apelul SMSLink):
--     citit_la / eroare_la = p_inceput si se scriu DOAR daca p_inceput > valoarea existenta. O citire inceputa mai devreme si terminata
--     mai tarziu (cron + „Citeste acum” in paralel) nu suprascrie rezultatul uneia incepute ulterior. p_inceput: maxim 2 min in viitor
--     (ceasul edge-ului), minim 15 min in trecut (o citire blocata nu se mai scrie).
--   * P2-05: vederea nu mai apeleaza fn_sms_e_owner direct; fn_sold_sms_citeste e VOLATILE (planificatorul nu o poate scoate dintr-un
--     SELECT count(*)), deci pentru non-owner orice citire a vederii pica cu 42501 (testat in DRY ca non-owner real).
--   * P2-08 / P3 Jakarinos: amprenta exacta a obiectelor (coloane, definitiile constrangerilor, RLS, ACL, atributele si corpurile
--     functiilor, definitia vederii, jobul) e verificata la final aici si la inceputul revenirii (aceeasi interogare, aceeasi constanta).
--   * P3-02 (limitare acceptata): cron.timezone = GMT, deci jobul ruleaza la 05:10 UTC = 07:10 ora Romaniei iarna, 08:10 vara.
--   * P3-03 (risc documentat, tiparul existent din repo): la rulare, antetul x-intern-secret trece prin coada pg_net
--     (net.http_request_queue, randul se sterge dupa trimitere; net._http_response tine raspunsurile, nu antetele cererii). ACL-ul
--     extensiei da PUBLIC pe coada, dar schema net NU e expusa de PostgREST (PGRST106, proba 03.10 la 20261011a); precondiția 0g de mai
--     jos (aceeasi ca in 20261011a) refuza migrarea daca o functie executabila / o vedere citibila de anon / authenticated din alta
--     schema atinge coada sau raspunsurile. Cine poate citi coada direct: rolurile cu acces SQL (postgres, service_role prin SQL,
--     supabase_admin) — aceleasi care pot citi oricum Vault-ul.
-- r3 (#971, Copilot r2 NO-GO P2-01 + P3, Jakarinos r2 GO cu P3):
--   * P2-01: furnizorul curent se afla din BD, nu doar dupa un click: la FIECARE apel, sms-sold scrie furnizor_ultim + furnizor_la
--     (smslink / simulator, CAS pe momentul de start), fara sa atinga soldul. Am ales doua coloane pe randul existent (nu o tabela
--     sau un secret citit din BD): un singur scriitor, aceeasi functie, acelasi lock. Cu furnizor_ultim = simulator, fn_sold_sms_stare
--     intoarce simulator = true si toate flagurile de alerta false: soldul ramas e doar „ultimul cunoscut” (panou + Alerte), fara
--     „sub prag” pe un sold vechi. La revenirea pe smslink, primul apel reface furnizorul si alerta se calculeaza din nou.
--   * Jakarinos P3: amprenta include si privilegiile pe coloane (attacl) si proisstrict.
--   * P3-02 (documentat): precondiția 0g pe coada pg_net e o verificare PUNCTUALA, la instalare, nu un control permanent. La deploy
--     (si dupa orice schimbare a schemelor expuse / a politicilor) se face o proba HTTP reala ca anon si ca utilizator autentificat
--     ca /rest/v1 nu da acces la net.* (asteptat: PGRST106 / 4xx).
--   * P3-03 (documentat): modul STRICT al filtrului IP din sms-dlr cere validarea reala a infrastructurii (DLR-uri reale + proba de
--     falsificare a antetului din retea); testele unitare valideaza doar parserul si decizia.
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
  -- '10 5 * * *' = 07:10 ora Romaniei (iarna) / 08:10 (vara) DOAR daca pg_cron ruleaza pe GMT (ca 20261014a)
  IF current_setting('cron.timezone', true) IS DISTINCT FROM 'GMT' THEN
    RAISE EXCEPTION '20261130d: cron.timezone = % (astept GMT)', coalesce(current_setting('cron.timezone', true), '<nesetat>');
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'INTERN_EDGE_SECRET' AND decrypted_secret ~ '^[0-9a-f]{64}$') <> 1 THEN
    RAISE EXCEPTION '20261130d: INTERN_EDGE_SECRET lipsa sau nu are formatul de 64 hex cerut de _shared/poartaIntern.ts';
  END IF;
  -- 0g (ca 20261011a, P3-03): antetul trece prin coada pg_net; niciun obiect accesibil anon / authenticated din alta schema nu o atinge
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname NOT IN ('net', 'pg_catalog', 'information_schema') AND p.prosrc ~ '(http_request_queue|_http_response)'
               AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind IN ('v', 'm') AND n.nspname NOT IN ('net', 'pg_catalog', 'information_schema')
               AND pg_get_viewdef(c.oid) ~ '(http_request_queue|_http_response)'
               AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'))) THEN
    RAISE EXCEPTION '20261130d: un obiect accesibil anon/authenticated citeste coada pg_net — secretul ar putea fi vazut';
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
  furnizor_ultim text CHECK (furnizor_ultim IS NULL OR furnizor_ultim IN ('smslink', 'simulator')),
  furnizor_la timestamptz,
  CONSTRAINT sms_sold_citire CHECK ((credit IS NULL) = (citit_la IS NULL)),
  CONSTRAINT sms_sold_eroare CHECK ((eroare IS NULL) = (eroare_la IS NULL)),
  CONSTRAINT sms_sold_furnizor CHECK ((furnizor_ultim IS NULL) = (furnizor_la IS NULL))
);
COMMENT ON COLUMN public.sms_sold.furnizor_ultim IS 'SMS (r3): furnizorul configurat la ULTIMUL apel sms-sold (smslink / simulator), scris la fiecare apel, fara sa atinga soldul. simulator = soldul ramas e doar „ultimul cunoscut”, fara alerta.';
COMMENT ON TABLE public.sms_sold IS 'SMS: soldul SMSLink, un singur rand. credit + citit_la = ultima citire buna (mode=Credit; citit_la = momentul de START al citirii); eroare + eroare_la = ultima eroare (doar cod scurt, niciodata textul furnizorului). Scris DOAR de fn_sold_sms_inregistreaza (edge sms-sold, CAS pe momentul de start), citit DOAR prin fn_sold_sms_citeste (owner). 20261130d.';
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
           'furnizor_ultim', x.furnizor_ultim, 'furnizor_la', x.furnizor_la, 'simulator', x.sim,
           'sub_prag', x.sub_prag AND NOT x.sim, 'citire_veche', x.veche AND NOT x.sim, 'eroare_dupa_citire', x.err AND NOT x.sim,
           'alerta', (x.sub_prag OR x.veche OR x.err) AND NOT x.sim)
    FROM (SELECT s.credit, s.citit_la, s.eroare, s.eroare_la, s.furnizor_ultim, s.furnizor_la, public.fn_sold_sms_prag() AS prag,
                 (s.furnizor_ultim IS NOT DISTINCT FROM 'simulator') AS sim,
                 (s.credit IS NOT NULL AND s.credit < public.fn_sold_sms_prag()) AS sub_prag,
                 (s.citit_la IS NULL OR s.citit_la < now() - interval '36 hours') AS veche,
                 (s.eroare_la IS NOT NULL AND (s.citit_la IS NULL OR s.eroare_la > s.citit_la)) AS err
            FROM public.sms_sold s WHERE s.id) x
$fn$;
COMMENT ON FUNCTION public.fn_sold_sms_stare() IS 'SMS (intern, fara drept de apel): starea soldului + SINGURA definitie a alertei: sub_prag (credit < fn_sold_sms_prag()), citire_veche (nicio citire buna in ultimele 36 h), eroare_dupa_citire (ultima incercare a esuat). alerta = oricare. r3: cu furnizor_ultim = simulator, soldul ramas e doar „ultimul cunoscut” si toate flagurile de alerta sunt false (simulator = true).';

CREATE FUNCTION public.fn_sold_sms_inregistreaza(p_credit integer, p_eroare text, p_inceput timestamptz, p_furnizor text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_gasit boolean;
BEGIN
  IF p_furnizor IS NULL OR p_furnizor NOT IN ('smslink', 'simulator') THEN
    RAISE EXCEPTION 'sms sold: furnizor necunoscut' USING ERRCODE = '22023';
  END IF;
  IF p_furnizor = 'simulator' AND (p_credit IS NOT NULL OR p_eroare IS NOT NULL) THEN
    RAISE EXCEPTION 'sms sold: simulatorul nu are sold si nici eroare de sold' USING ERRCODE = '22023';
  END IF;
  IF p_furnizor = 'smslink' AND (p_credit IS NULL) = (p_eroare IS NULL) THEN
    RAISE EXCEPTION 'sms sold: exact unul dintre credit si eroare' USING ERRCODE = '22023';
  END IF;
  IF p_inceput IS NULL OR p_inceput > now() + interval '2 minutes' OR p_inceput < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'sms sold: momentul de start al citirii lipseste sau e in afara ferestrei' USING ERRCODE = '22023';
  END IF;
  IF p_credit IS NOT NULL AND p_credit NOT BETWEEN 0 AND 10000000 THEN
    RAISE EXCEPTION 'sms sold: credit in afara limitelor' USING ERRCODE = '22023';
  END IF;
  IF p_eroare IS NOT NULL AND p_eroare !~ '^[a-z0-9_]{1,40}$' THEN
    RAISE EXCEPTION 'sms sold: codul de eroare nu e un cod scurt' USING ERRCODE = '22023';
  END IF;
  -- randul unic, blocat: doua citiri concurente se serializeaza aici; CAS pe momentul de start (o citire mai veche nu suprascrie)
  SELECT true INTO v_gasit FROM public.sms_sold WHERE id FOR UPDATE;
  IF v_gasit IS NOT TRUE THEN RAISE EXCEPTION 'sms sold: randul de sold lipseste' USING ERRCODE = 'P0002'; END IF;
  -- furnizorul curent (r3): la fiecare apel, tot CAS pe momentul de start; nu atinge soldul / eroarea
  UPDATE public.sms_sold SET furnizor_ultim = p_furnizor, furnizor_la = p_inceput WHERE id AND (furnizor_la IS NULL OR furnizor_la < p_inceput);
  v_n := 0;
  IF p_credit IS NOT NULL THEN
    UPDATE public.sms_sold SET credit = p_credit, citit_la = p_inceput WHERE id AND (citit_la IS NULL OR citit_la < p_inceput);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSIF p_eroare IS NOT NULL THEN
    UPDATE public.sms_sold SET eroare = p_eroare, eroare_la = p_inceput WHERE id AND (eroare_la IS NULL OR eroare_la < p_inceput);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  RETURN public.fn_sold_sms_stare() || jsonb_build_object('scris', v_n = 1);
END $fn$;
COMMENT ON FUNCTION public.fn_sold_sms_inregistreaza(integer, text, timestamptz, text) IS 'SMS (doar service_role, din edge sms-sold dupa poarta cron intern / owner): scrie furnizorul curent (p_furnizor smslink / simulator, la fiecare apel) si, pentru smslink, ultima citire buna (p_credit) SAU ultima eroare (p_eroare = cod scurt [a-z0-9_]); simulator = doar furnizorul, fara sold. Toate cu momentul de START al citirii (p_inceput, CAS: doar daca e mai nou). Intoarce fn_sold_sms_stare() + scris (soldul / eroarea).';

CREATE FUNCTION public.fn_sold_sms_citeste() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.fn_sms_e_owner() THEN
    RAISE EXCEPTION 'sms: doar owner-ul vede soldul SMSLink' USING ERRCODE = '42501';
  END IF;
  RETURN public.fn_sold_sms_stare();
END $fn$;
COMMENT ON FUNCTION public.fn_sold_sms_citeste() IS 'SMS (owner): soldul SMSLink + alerta (fn_sold_sms_stare). VOLATILE ca vederea v_sms_sold sa o evalueze mereu (refuz 42501 pentru non-owner, si la count). Folosita de panoul SMS si de Administrator -> Alerte.';

-- privilegiile implicite Supabase dau EXECUTE pe functii noi: se scot explicit, apoi exact cine trebuie
REVOKE ALL ON FUNCTION public.fn_sold_sms_prag(), public.fn_sold_sms_stare(), public.fn_sold_sms_inregistreaza(integer, text, timestamptz, text),
  public.fn_sold_sms_citeste() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sold_sms_inregistreaza(integer, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_sold_sms_citeste() TO authenticated;

CREATE VIEW public.v_sms_sold WITH (security_invoker = on) AS
SELECT true AS id, (x.s->>'credit')::integer AS credit, (x.s->>'citit_la')::timestamptz AS citit_la, x.s->>'eroare' AS eroare,
       (x.s->>'eroare_la')::timestamptz AS eroare_la, (x.s->>'prag')::integer AS prag, (x.s->>'sub_prag')::boolean AS sub_prag,
       (x.s->>'citire_veche')::boolean AS citire_veche, (x.s->>'eroare_dupa_citire')::boolean AS eroare_dupa_citire, (x.s->>'alerta')::boolean AS alerta,
       x.s->>'furnizor_ultim' AS furnizor_ultim, (x.s->>'furnizor_la')::timestamptz AS furnizor_la, (x.s->>'simulator')::boolean AS simulator
  FROM (SELECT public.fn_sold_sms_citeste() AS s) x;
COMMENT ON VIEW public.v_sms_sold IS 'SMS: soldul SMSLink + alerta, un rand, din fn_sold_sms_citeste() (VOLATILE: doar owner, altfel 42501 la orice citire). security_invoker. Sursa SMS sold din Administrator -> Alerte. 20261130d.';
REVOKE ALL ON public.v_sms_sold FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_sms_sold TO authenticated;

-- ─── 3. Cronul zilnic (05:10 UTC = 07:10 ora Romaniei iarna / 08:10 vara); comanda pe un rand (md5 independent de CRLF) ─────────
SELECT cron.schedule('sms_sold_zilnic', '10 5 * * *', $cmd$SELECT net.http_post(url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/sms-sold', body := '{}'::jsonb, headers := jsonb_build_object('Content-Type', 'application/json', 'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')), timeout_milliseconds := 30000)$cmd$);

DO $post$
DECLARE v_o oid; v_s jsonb; v_amprenta text;
  v_toate regprocedure[] := ARRAY['public.fn_sold_sms_prag()', 'public.fn_sold_sms_stare()', 'public.fn_sold_sms_inregistreaza(integer,text,timestamptz,text)',
    'public.fn_sold_sms_citeste()']::regprocedure[];
BEGIN
  -- textul din catalog (regprocedure, pg_get_viewdef) depinde de search_path: fixat pentru amprenta (doar in aceasta tranzactie)
  PERFORM set_config('search_path', 'public, pg_temp', true);
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
       OR has_function_privilege('service_role', v_o, 'EXECUTE') IS DISTINCT FROM (v_o = 'public.fn_sold_sms_inregistreaza(integer,text,timestamptz,text)'::regprocedure) THEN
      RAISE EXCEPTION '20261130d: functia % are setari / drepturi gresite', v_o::regprocedure;
    END IF;
  END LOOP;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.fn_sold_sms_citeste()'::regprocedure) <> 'v' THEN
    RAISE EXCEPTION '20261130d: fn_sold_sms_citeste trebuie sa fie VOLATILE (vederea o evalueaza mereu)';
  END IF;
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
  -- AMPRENTA 20261130d (identica in migrare si in revenire): structura exacta, fara date
  SELECT md5(concat_ws(E'\n',
    (SELECT string_agg(format('%s:%s:%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), coalesce((SELECT string_agg(x::text, ' ' ORDER BY x::text) FROM unnest(a.attacl) x), '-')), ';' ORDER BY a.attnum)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'public.sms_sold'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
    (SELECT string_agg(c.conname || '=' || pg_get_constraintdef(c.oid), ';' ORDER BY c.conname) FROM pg_constraint c WHERE c.conrelid = 'public.sms_sold'::regclass),
    (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', r.relname, r.relkind, pg_get_userbyid(r.relowner), r.relrowsecurity, r.relforcerowsecurity,
                              coalesce((SELECT string_agg(x::text, ' ' ORDER BY x::text) FROM unnest(r.relacl) x), '-'), coalesce(array_to_string(r.reloptions, ' '), '-')), ';' ORDER BY r.relname)
       FROM pg_class r WHERE r.oid IN ('public.sms_sold'::regclass, 'public.v_sms_sold'::regclass)),
    (SELECT count(*)::text FROM pg_policy WHERE polrelid = 'public.sms_sold'::regclass) || ':'
      || (SELECT count(*)::text FROM pg_trigger WHERE tgrelid = 'public.sms_sold'::regclass AND NOT tgisinternal),
    md5(replace(pg_get_viewdef('public.v_sms_sold'::regclass), chr(13), '')),
    (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s:%s', p.oid::regprocedure, p.prosecdef, p.proisstrict, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '-'),
                              pg_get_userbyid(p.proowner), coalesce((SELECT string_agg(x::text, ' ' ORDER BY x::text) FROM unnest(p.proacl) x), '-'),
                              md5(replace(p.prosrc, chr(13), ''))), ';' ORDER BY p.proname)
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sold!_sms!_%' ESCAPE '!'),
    (SELECT string_agg(format('%s:%s:%s:%s:%s', j.jobname, j.schedule, md5(replace(j.command, chr(13), '')), j.active, j.username), ';' ORDER BY j.jobid)
       FROM cron.job j WHERE j.jobname = 'sms_sold_zilnic'))) INTO v_amprenta;
  IF v_amprenta IS DISTINCT FROM '33cbff5fea50460503f200095b4eb370' THEN
    RAISE EXCEPTION '20261130d: amprenta obiectelor = % (asteptat 33cbff5fea50460503f200095b4eb370)', v_amprenta;
  END IF;
END $post$;

DO $final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130d_sms_sold:' || txid_current() THEN
    RAISE EXCEPTION '20261130d: garda final invalida';
  END IF;
END $final$;
