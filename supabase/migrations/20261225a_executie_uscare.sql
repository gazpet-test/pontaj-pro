-- Version 20261225120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 (DOAR cu plafon; marcajul gazpet.livrare_migrare legat de txid;
--   amprenta globală L15 v2 a runnerului, --amprenta-globala + --diferente-globale).
-- CE NU E ÎNCĂ PROBAT (L15 v2): manifestul diferențelor supabase/migrations/20261225a_executie_uscare.l15.tsv NU e în acest PR: îl generează
--   coordonatorul pe clonă (docs/LIVRARE_L15_V2.md §7), apoi proba cu ROLLBACK pe țintă. Ce probează migrarea singură: lanțul funcțiilor de drept
--   de care depinde (amprenta corpului + proprietățile, ÎNAINTE și DUPĂ) și postcondițiile pe definiția exactă a obiectelor ei.
-- 20261225a_executie_uscare — Execuție → proiect → „Uscare conductă”: raportul de uscare pe tronson cerut de beneficiar (model de raport primit
--   pe 27.10.2026; cerințe: notificare cu minimum 24 h înainte, fotografii pentru tot ce se trece în tabel). Specificația:
--   docs/executie/USCARE_CONDUCTA_SPEC.md (fluxul, stările, matricea de acces, ce se calculează, ce NU se știe).
--
-- Ce face (DOAR obiecte noi, nicio dată, niciun drept pe tabele existente):
--   * executie_uscari: o operațiune de uscare pe proiect, legată OPȚIONAL de un tronson de probă (executie_probe_tronsoane, același proiect,
--     FK compus) sau pe un interval liber de km (ex. uscarea finală pe tot traseul). Ține rubricile modelului: data, tronson, km, lungime,
--     temperatura exterioară (cu sursa: introdusă de om sau propusă din meteo, cu ora datelor meteo), constructorul, utilajele (listă), orele,
--     pistoanele (PIG metalic / piston poliuretan / bureți), cântăririle bureților (listă: 3 în model, extensibilă), punctul de rouă (valoare +
--     loc), presiunea în spatele buretelui, timpul de deplasare, observațiile, concluzia (conform / neconform), semnatarii (nume, funcție);
--     plus planificarea (ora de început planificată, momentul notificării beneficiarului și referința ei).
--     NU se stochează ce se calculează (durata, viteza medie, diferența de greutate, verificarea celor 24 h): o singură definiție, în
--     src/uscareLogica.js (L19).
--   * executie_uscare_poze: fotografiile, cu categoria (manometru, temperatura, pistoane, cântar intrare / ieșire, punct de rouă, utilaje,
--     altele), numărul buretelui la cântăriri și legenda; fișierele în bucket-ul PRIVAT executie-uscare (<proiect>/<uscare>/<uuid>.jpg).
--   * executie_uscare_jurnal: jurnalul operațiilor (creare, salvare cu diferențele, închidere / redeschidere cu fotografia completă a
--     raportului, anulare, poze), doar adăugare; ține cheia de idempotență a fiecărei apăsări (L04).
--   * Stările: deschisa (se completează pe parcurs) -> inchisa (concluzie pusă; NIMIC nu se mai schimbă, nici pozele) -> deschisa
--     („redeschidere consemnată”: motiv obligatoriu, doar admin Execuție / owner, revizia crește, conținutul închis rămâne în jurnal);
--     deschisa -> anulata (motiv; final). Închiderea cere toate rubricile modelului, în afara observațiilor și a numelor semnatarilor.
--   * Scrierea DOAR prin 3 RPC-uri SECURITY DEFINER (fn_executie_uscare_salveaza / _stare / _poza): auth.uid() obligatoriu, dreptul pe
--     proiect prin fn_executie_nod_drept (20261201a, cu restricția pe proiect din 20261209a — O SINGURĂ definiție a dreptului pe Execuție;
--     redeschiderea: fn_executie_contract_drept, nivelul admin), lock pe rând, CAS pe versiune, cheie de idempotență per apăsare.
--     Fără INSERT / UPDATE / DELETE pentru anon / authenticated / service_role. Citirea prin RLS: același drept, orice nivel.
--   * Gărzi în BD pe ORICE cale (L07, trigger-e BEFORE): proveniența (creat_de / modificat_de = auth.uid(), serverul), proiectul imuabil,
--     raportul închis / anulat nu se modifică, închiderea doar complet, schimbarea stării nu schimbă datele, nicio ștergere de raport; pozele
--     nu se modifică și se adaugă / scot doar cât raportul e deschis (rândul raportului blocat FOR SHARE).
--   * Storage: bucket privat executie-uscare (doar image/jpeg, 10 MB). Politici pe storage.objects DOAR pentru acest bucket: citire cu
--     dreptul de citire pe proiectul din cale și o uscare a ACELUI proiect; încărcare cu dreptul de scriere și uscarea DESCHISĂ; nicio
--     modificare / ștergere pentru clienți (dovezile rămân; o poză scoasă din raport rămâne în bucket, jurnalul spune care).
-- Ce NU face: nicio dată, niciun drept pe module, nicio schimbare pe tabelele / funcțiile existente (doar cheile străine spre executie_proiecte
--   și executie_probe_tronsoane: trigger-ele referențiale interne ale PostgreSQL pe ele; un tronson de probă referit nu se mai poate șterge —
--   tronsoanele de probă se anulează, nu se șterg, deci nimic nu se schimbă în practică). Nicio automatizare, niciun mail.
-- Depinde de 20261201a (fn_executie_nod_drept), 20261202a (executie_probe_tronsoane cu UNIQUE (id, proiect_id)), 20261209a + 20261213a
--   (restricția pe proiect: corpul nou al funcțiilor de drept). Verificat mai jos pe amprentă.
-- Ordinea lock-urilor (L06), aceeași pe toate căile:
--   salveaza: executie_uscari FOR UPDATE (la modificare) -> INSERT / UPDATE (FOR KEY SHARE implicit pe executie_proiecte și
--             executie_probe_tronsoane, din FK) -> INSERT în jurnal (FOR KEY SHARE pe rândul uscării, deja blocat mai tare);
--   stare:    executie_uscari FOR UPDATE -> citirea pozelor (fără lock: orice scriere de poză așteaptă lock-ul raportului) -> UPDATE -> jurnal;
--   poza:     executie_uscari FOR UPDATE -> (scoatere) executie_uscare_poze FOR UPDATE -> INSERT / DELETE poză (trigger: FOR SHARE pe
--             raport, deja ținut) -> jurnal.
--   Modulul Probe pe tronsoane (20261202a) blochează executie_probe_tronsoane / _etape și nu atinge nimic de aici: fără ciclu.
-- Lock-uri la aplicare (punct unic, NOWAIT, reîncercat ≤ 1 s de la BEGIN): executie_proiecte și executie_probe_tronsoane SHARE ROW EXCLUSIVE
--   (cheile străine), storage.objects ACCESS EXCLUSIVE (CREATE POLICY): oprește scurt (cât rămâne din tranzacție, < 2 s) și citirile de
--   fișiere din toată aplicația — de aplicat într-un moment liniștit.
-- Revenire: supabase/revenire/20261225a_executie_uscare_ROLLBACK.sql (refuză dacă există date: uscări, poze, jurnal sau fișiere în bucket).
-- Probe: scripts/pglite/test_executie_uscare_local.mjs (local, PGlite: drepturi pe roluri, stări, idempotență, revenire, mutanți).
DO $pre$
DECLARE v_plafon text; r record; v_tip text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261225a_executie_uscare:' || txid_current() THEN
    RAISE EXCEPTION '20261225a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261225a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261225a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261225a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261225a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regclass('public.executie_uscari') IS NOT NULL OR to_regclass('public.executie_uscare_poze') IS NOT NULL
     OR to_regclass('public.executie_uscare_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_uscare\_%')
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'executie-uscare')
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'executie\_uscare\_%') THEN
    RAISE EXCEPTION '20261225a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele de care depind cheile străine, cu tipurile citite din migrări
  FOR r IN SELECT * FROM (VALUES
      ('executie_proiecte', 'id', 'bigint'), ('executie_probe_tronsoane', 'id', 'bigint'), ('executie_probe_tronsoane', 'proiect_id', 'bigint'),
      ('executie_probe_tronsoane', 'stare', 'text')
    ) v(t, c, tip) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS DISTINCT FROM r.tip THEN
      RAISE EXCEPTION '20261225a: coloana %.% lipseste sau are alt tip (%; asteptat %): aplica intai 20261201a / 20261202a', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tip;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.executie_probe_tronsoane'::regclass AND conname = 'executie_probe_tronsoane_id_proiect_uq'
                   AND contype = 'u')
     OR to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL
     OR (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass) IS NOT TRUE
     OR to_regprocedure('auth.uid()') IS NULL
     OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid THEN
    RAISE EXCEPTION '20261225a: dependentele (UNIQUE (id, proiect_id) pe executie_probe_tronsoane, storage cu RLS, auth.uid) lipsesc sau difera';
  END IF;
END $pre$;

-- ── L15: lanțul funcțiilor de drept folosite de politici / RPC-uri, cu amprenta revizuită (corpul fără CR) + proprietățile, verificat ÎNAINTE
-- și DUPĂ (migrarea nu le schimbă). Lanțul (citit din corpuri): fn_executie_nod_drept și fn_executie_contract_drept (corpul din 20261209a)
-- -> fn_executie_proiect_permis -> fn_executie_acces_nerestrans -> fn_executie_acces_nerestrans_cont; fn_executie_acces_lista ->
-- fn_executie_acces_lista_cont (20261209a, neschimbate de 20261213a; amprentele = cele verificate de 20261213a). Toate cheamă doar auth.uid()
-- și citesc profiles / user_module_access / executie_proiecte / executie_acces_proiect.
CREATE FUNCTION pg_temp.lant_20261225a(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $lant$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      ('public.fn_executie_nod_drept(bigint, boolean)', '1f0faa030d0459412aafb6e1a024beff', true, true),
      ('public.fn_executie_contract_drept(bigint, boolean)', 'f3c3dc6add32d563682494e804864e99', true, true),
      ('public.fn_executie_proiect_permis(bigint, boolean)', 'bd4320f76e9f36f492c7186c0a982155', true, true),
      ('public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1', true, true),
      ('public.fn_executie_acces_nerestrans_cont(uuid)', '9a07e0089139e54ba5c6a0cfaaf093cc', false, false),
      ('public.fn_executie_acces_lista(boolean)', 'd9e123a46b83530a7203d4a24da5cf9b', true, false),
      ('public.fn_executie_acces_lista_cont(uuid, boolean)', 'e7cf9b852002a1c1cbe781772c33bf0c', false, false)
    ) a(semnatura, amprenta, definer, cu_auth)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = 'sql')
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR p.prorettype IS DISTINCT FROM (CASE WHEN a.semnatura LIKE '%lista%' THEN 'bigint[]'::regtype ELSE 'boolean'::regtype END)::oid
      OR p.provolatile IS DISTINCT FROM 's'
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_auth;
  IF v_rau IS NOT NULL THEN
    RAISE EXCEPTION '20261225a: lantul de drept (%) difera de amprenta revizuita: %', p_moment, v_rau;
  END IF;
END $lant$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.lant_20261225a('inainte'); END $l15_inainte$;

-- ── punctul UNIC de blocare (L06), după verificările de catalog: NOWAIT, reîncercare ≤ 1 s de la BEGIN, mereu în aceeași ordine ──
DO $lock$
DECLARE v_incercari integer := 0;
BEGIN
  LOOP
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.executie_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.executie_probe_tronsoane IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20261225a: BUGET_LOCK: tabel ocupat; % incercari, % ms de la BEGIN; nimic schimbat',
          v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  RAISE NOTICE '20261225a: lock la % ms de la BEGIN (% incercari)', round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari;
END $lock$;

-- ── listele (utilaje, cântăriri): forma exactă, verificată pe ORICE cale (CHECK) ──
-- utilaje: [{denumire: text 1–120 fără caractere de control, buc: întreg 1–99}], cel mult 20, chei exacte
CREATE FUNCTION public.fn_executie_uscare_utilaje_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'array' AND jsonb_array_length(p) <= 20
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p) e(x)
       WHERE jsonb_typeof(e.x) IS DISTINCT FROM 'object'
          OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e.x) k) IS DISTINCT FROM ARRAY['buc', 'denumire']
          OR jsonb_typeof(e.x -> 'denumire') IS DISTINCT FROM 'string'
          OR length(e.x ->> 'denumire') NOT BETWEEN 1 AND 120
          OR (e.x ->> 'denumire') !~ '[^[:space:]]'
          OR (e.x ->> 'denumire') ~ '[[:cntrl:]]'
          OR (e.x ->> 'denumire') IS DISTINCT FROM btrim(e.x ->> 'denumire')
          OR jsonb_typeof(e.x -> 'buc') IS DISTINCT FROM 'number'
          OR (e.x ->> 'buc') !~ '^[0-9]{1,2}$'
          OR (e.x ->> 'buc')::int NOT BETWEEN 1 AND 99)
$f$;
-- cântăriri: [{nr: întreg 1–20 unic, intrare_kg / iesire_kg: număr 0,001–1000 cu cel mult 3 zecimale sau null}], cel mult 20, chei exacte
CREATE FUNCTION public.fn_executie_uscare_cantariri_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'array' AND jsonb_array_length(p) <= 20
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p) e(x)
       WHERE jsonb_typeof(e.x) IS DISTINCT FROM 'object'
          OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e.x) k) IS DISTINCT FROM ARRAY['iesire_kg', 'intrare_kg', 'nr']
          OR jsonb_typeof(e.x -> 'nr') IS DISTINCT FROM 'number' OR (e.x ->> 'nr') !~ '^[0-9]{1,2}$' OR (e.x ->> 'nr')::int NOT BETWEEN 1 AND 20
          OR jsonb_typeof(e.x -> 'intrare_kg') NOT IN ('number', 'null') OR jsonb_typeof(e.x -> 'iesire_kg') NOT IN ('number', 'null')
          OR (jsonb_typeof(e.x -> 'intrare_kg') = 'number' AND ((e.x ->> 'intrare_kg')::numeric NOT BETWEEN 0.001 AND 1000
                                                               OR (e.x ->> 'intrare_kg')::numeric <> round((e.x ->> 'intrare_kg')::numeric, 3)))
          OR (jsonb_typeof(e.x -> 'iesire_kg') = 'number' AND ((e.x ->> 'iesire_kg')::numeric NOT BETWEEN 0.001 AND 1000
                                                              OR (e.x ->> 'iesire_kg')::numeric <> round((e.x ->> 'iesire_kg')::numeric, 3))))
    AND (SELECT count(DISTINCT e.x ->> 'nr') FROM jsonb_array_elements(p) e(x)) = jsonb_array_length(p)
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_utilaje_ok(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_cantariri_ok(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ── operațiunea de uscare ──
CREATE TABLE public.executie_uscari (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  proba_id bigint,
  tronson text NOT NULL CHECK (length(tronson) BETWEEN 1 AND 120 AND tronson ~ '[^[:space:]]'),
  km_de_la_m integer NOT NULL CHECK (km_de_la_m BETWEEN 0 AND 999999),
  km_pana_la_m integer NOT NULL CHECK (km_pana_la_m BETWEEN 1 AND 1000000),
  lungime_m numeric(8,1) CHECK (lungime_m > 0 AND lungime_m <= 1000000),
  inceput_planificat timestamptz,
  notificare_la timestamptz,
  notificare_ref text CHECK (length(notificare_ref) BETWEEN 1 AND 300),
  data_operatie date,
  ora_inceput timestamptz,
  ora_final timestamptz,
  temperatura_c numeric(4,1) CHECK (temperatura_c BETWEEN -50 AND 60),
  temperatura_sursa text CHECK (temperatura_sursa IN ('manual', 'meteo')),
  meteo_la timestamptz,
  vreme text CHECK (length(vreme) BETWEEN 1 AND 120),
  constructor text CHECK (length(constructor) BETWEEN 1 AND 200),
  utilaje jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (public.fn_executie_uscare_utilaje_ok(utilaje)),
  pig_metalic_buc smallint CHECK (pig_metalic_buc BETWEEN 0 AND 99),
  piston_pu_buc smallint CHECK (piston_pu_buc BETWEEN 0 AND 99),
  bureti_buc smallint CHECK (bureti_buc BETWEEN 0 AND 99),
  cantariri jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (public.fn_executie_uscare_cantariri_ok(cantariri)),
  punct_roua_c numeric(4,1) CHECK (punct_roua_c BETWEEN -100 AND 50),
  punct_roua_loc text CHECK (length(punct_roua_loc) BETWEEN 1 AND 200),
  presiune_bar numeric(5,2) CHECK (presiune_bar > 0 AND presiune_bar <= 100),
  timp_deplasare_min numeric(6,1) CHECK (timp_deplasare_min > 0 AND timp_deplasare_min <= 10000),
  observatii text CHECK (length(observatii) BETWEEN 1 AND 4000),
  concluzie text CHECK (concluzie IN ('conform', 'neconform')),
  semn_constructor_nume text CHECK (length(semn_constructor_nume) BETWEEN 1 AND 120),
  semn_constructor_functie text CHECK (length(semn_constructor_functie) BETWEEN 1 AND 120),
  semn_beneficiar_nume text CHECK (length(semn_beneficiar_nume) BETWEEN 1 AND 120),
  semn_beneficiar_functie text CHECK (length(semn_beneficiar_functie) BETWEEN 1 AND 120),
  stare text NOT NULL DEFAULT 'deschisa' CHECK (stare IN ('deschisa', 'inchisa', 'anulata')),
  motiv_anulare text CHECK (length(motiv_anulare) BETWEEN 1 AND 500),
  revizie smallint NOT NULL DEFAULT 0 CHECK (revizie BETWEEN 0 AND 999),
  inchis_la timestamptz,
  inchis_de uuid,
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune > 0),
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  modificat_de uuid,
  modificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_uscari_proba_fk FOREIGN KEY (proba_id, proiect_id) REFERENCES public.executie_probe_tronsoane (id, proiect_id),
  CONSTRAINT executie_uscari_id_proiect_uq UNIQUE (id, proiect_id),
  CONSTRAINT executie_uscari_interval CHECK (km_pana_la_m > km_de_la_m),
  CONSTRAINT executie_uscari_ore CHECK (ora_final IS NULL OR (ora_inceput IS NOT NULL AND ora_final > ora_inceput AND ora_final <= ora_inceput + interval '30 days')),
  -- temperatura are sursa; ora datelor meteo există exact când sursa e meteo (coalesce: sursa NULL = „nu e meteo”, nu NULL)
  CONSTRAINT executie_uscari_temperatura CHECK ((temperatura_c IS NULL) = (temperatura_sursa IS NULL)
                                                AND coalesce(temperatura_sursa = 'meteo', false) = (meteo_la IS NOT NULL)),
  CONSTRAINT executie_uscari_anulare CHECK ((stare = 'anulata') = (motiv_anulare IS NOT NULL)),
  CONSTRAINT executie_uscari_inchidere CHECK ((stare = 'inchisa') = (inchis_la IS NOT NULL) AND (inchis_la IS NULL) = (inchis_de IS NULL))
);
CREATE INDEX executie_uscari_proiect_idx ON public.executie_uscari (proiect_id, id);
CREATE INDEX executie_uscari_proba_idx ON public.executie_uscari (proba_id, proiect_id) WHERE proba_id IS NOT NULL;
COMMENT ON TABLE public.executie_uscari IS
  'Execuție: operațiunile de uscare a conductei (raportul de uscare cerut de beneficiar), pe tronson de probă sau interval de km. Scriere DOAR prin fn_executie_uscare_salveaza / _stare. 20261225a.';
COMMENT ON COLUMN public.executie_uscari.temperatura_sursa IS 'manual = introdusă de om; meteo = propusă din vremea șantierului (meteo_la = ora datelor meteo) și acceptată de om.';
COMMENT ON COLUMN public.executie_uscari.revizie IS 'De câte ori a fost redeschis raportul după închidere (0 = niciodată). Conținutul fiecărei închideri rămâne în executie_uscare_jurnal.';

-- ce lipsește pentru închidere (cheile formularului, în ordinea modelului): aceeași listă ca OBLIGATORII din src/uscareLogica.js (testul de
-- paritate citește blocul). Observațiile și numele semnatarilor NU sunt obligatorii (se pot completa de mână pe hârtie).
CREATE FUNCTION public.fn_executie_uscare_lipsa(u public.executie_uscari) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT coalesce(array_agg(v.k ORDER BY v.o), '{}'::text[]) FROM (VALUES
    -- OBLIGATORII-START
    (1, 'data_operatie', u.data_operatie IS NULL),
    (2, 'lungime_m', u.lungime_m IS NULL),
    (3, 'temperatura_c', u.temperatura_c IS NULL),
    (4, 'constructor', u.constructor IS NULL),
    (5, 'utilaje', jsonb_array_length(u.utilaje) = 0),
    (6, 'ora_inceput', u.ora_inceput IS NULL),
    (7, 'ora_final', u.ora_final IS NULL),
    (8, 'pistoane', u.pig_metalic_buc IS NULL OR u.piston_pu_buc IS NULL OR u.bureti_buc IS NULL),
    (9, 'cantariri', jsonb_array_length(u.cantariri) = 0
                     OR EXISTS (SELECT 1 FROM jsonb_array_elements(u.cantariri) e(x)
                                 WHERE jsonb_typeof(e.x -> 'intrare_kg') <> 'number' OR jsonb_typeof(e.x -> 'iesire_kg') <> 'number')),
    (10, 'punct_roua_c', u.punct_roua_c IS NULL),
    (11, 'punct_roua_loc', u.punct_roua_loc IS NULL),
    (12, 'presiune_bar', u.presiune_bar IS NULL),
    (13, 'timp_deplasare_min', u.timp_deplasare_min IS NULL),
    (14, 'concluzie', u.concluzie IS NULL)
    -- OBLIGATORII-END
  ) v(o, k, lipseste) WHERE v.lipseste
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_lipsa(public.executie_uscari) FROM PUBLIC, anon, authenticated, service_role;

-- tranzițiile: lista albă (aceeași ca TRANZITII din src/uscareLogica.js; testul de paritate citește blocul). NULL = nepermisă.
CREATE FUNCTION public.fn_executie_uscare_tranzitie(p_veche text, p_actiune text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT t.n FROM (VALUES
    -- TRANZITII-START
    ('deschisa', 'inchide', 'inchisa'),
    ('inchisa', 'redeschide', 'deschisa'),
    ('deschisa', 'anuleaza', 'anulata')
    -- TRANZITII-END
  ) t(v, a, n) WHERE t.v = p_veche AND t.a = p_actiune
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_tranzitie(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── fotografiile ──
CREATE TABLE public.executie_uscare_poze (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uscare_id bigint NOT NULL,
  proiect_id bigint NOT NULL,
  -- CATEGORII-START
  categorie text NOT NULL CHECK (categorie IN ('manometru', 'temperatura', 'pistoane', 'cantar_intrare', 'cantar_iesire', 'punct_roua', 'utilaje', 'altele')),
  -- CATEGORII-END
  burete_nr smallint CHECK (burete_nr BETWEEN 1 AND 20),
  cale text NOT NULL CHECK (cale ~ '^[0-9]{1,18}/[0-9]{1,18}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'),
  legenda text CHECK (length(legenda) BETWEEN 1 AND 300),
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_uscare_poze_uscare_fk FOREIGN KEY (uscare_id, proiect_id) REFERENCES public.executie_uscari (id, proiect_id),
  CONSTRAINT executie_uscare_poze_cale_uq UNIQUE (cale),
  CONSTRAINT executie_uscare_poze_cale_proprie CHECK (split_part(cale, '/', 1) = proiect_id::text AND split_part(cale, '/', 2) = uscare_id::text),
  CONSTRAINT executie_uscare_poze_burete CHECK (burete_nr IS NULL OR categorie IN ('cantar_intrare', 'cantar_iesire'))
);
CREATE INDEX executie_uscare_poze_uscare_idx ON public.executie_uscare_poze (uscare_id, proiect_id, id);
CREATE INDEX executie_uscare_poze_proiect_idx ON public.executie_uscare_poze (proiect_id, id);
COMMENT ON TABLE public.executie_uscare_poze IS
  'Execuție: fotografiile raportului de uscare (bucket privat executie-uscare, <proiect>/<uscare>/<uuid>.jpg), pe categorii. Scriere DOAR prin fn_executie_uscare_poza, doar cât raportul e deschis. 20261225a.';

-- ── jurnalul (doar adăugare) ──
CREATE TABLE public.executie_uscare_jurnal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uscare_id bigint NOT NULL,
  proiect_id bigint NOT NULL,
  actiune text NOT NULL CHECK (actiune IN ('creare', 'salvare', 'inchidere', 'redeschidere', 'anulare', 'poza_adaugata', 'poza_scoasa')),
  stare_veche text,
  stare_noua text,
  valori jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(valori) = 'object'),
  motiv text CHECK (length(motiv) BETWEEN 1 AND 500),
  cheie uuid NOT NULL,
  amprenta text NOT NULL CHECK (amprenta ~ '^[0-9a-f]{32}$'),
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_uscare_jurnal_uscare_fk FOREIGN KEY (uscare_id, proiect_id) REFERENCES public.executie_uscari (id, proiect_id),
  CONSTRAINT executie_uscare_jurnal_cheie_uq UNIQUE (cheie),
  CONSTRAINT executie_uscare_jurnal_stari CHECK ((actiune IN ('inchidere', 'redeschidere', 'anulare')) = (stare_veche IS NOT NULL AND stare_noua IS NOT NULL)),
  CONSTRAINT executie_uscare_jurnal_motiv CHECK ((actiune IN ('redeschidere', 'anulare')) = (motiv IS NOT NULL))
);
CREATE INDEX executie_uscare_jurnal_uscare_idx ON public.executie_uscare_jurnal (uscare_id, proiect_id, id);
CREATE INDEX executie_uscare_jurnal_proiect_idx ON public.executie_uscare_jurnal (proiect_id, id);
COMMENT ON TABLE public.executie_uscare_jurnal IS
  'Execuție: jurnalul rapoartelor de uscare (creare, salvări cu diferențele, închideri / redeschideri cu conținutul complet, anulări, poze); scris doar de RPC-urile fn_executie_uscare_*, nu se modifică. Ține cheile de idempotență. 20261225a.';

-- ── gărzile pe ORICE cale (L07, L08): proveniența, imuabilitatea, raportul închis ──
-- Coloanele de date ale raportului = tot rândul fără coloanele de stare / proveniență (lista de mai jos): o schimbare de stare nu le atinge.
CREATE FUNCTION public.fn_executie_uscare_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE
  v_meta constant text[] := ARRAY['stare', 'motiv_anulare', 'revizie', 'inchis_la', 'inchis_de', 'versiune', 'creat_de', 'creat_la', 'modificat_de', 'modificat_la'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'uscare: un raport de uscare nu se șterge (se anulează, cu motiv)' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.stare IS DISTINCT FROM 'deschisa' OR NEW.revizie IS DISTINCT FROM 0::smallint OR NEW.versiune IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'uscare: un raport nou începe deschis, la versiunea 1' USING ERRCODE = '23514';
    END IF;
    NEW.creat_de := auth.uid();
    NEW.creat_la := now();
  ELSE
    IF NEW.proiect_id IS DISTINCT FROM OLD.proiect_id THEN
      RAISE EXCEPTION 'uscare: proiectul raportului nu se schimbă' USING ERRCODE = '23514';
    END IF;
    IF OLD.stare = 'anulata' OR (OLD.stare = 'inchisa' AND NEW.stare = 'inchisa') THEN
      RAISE EXCEPTION 'uscare: raportul e % și nu se mai modifică (redeschidere consemnată, doar din raport închis)', OLD.stare USING ERRCODE = '42501';
    END IF;
    IF NEW.stare IS DISTINCT FROM OLD.stare AND (to_jsonb(NEW) - v_meta) IS DISTINCT FROM (to_jsonb(OLD) - v_meta) THEN
      RAISE EXCEPTION 'uscare: schimbarea stării nu modifică datele raportului' USING ERRCODE = '23514';
    END IF;
    IF NEW.versiune IS DISTINCT FROM OLD.versiune + 1 THEN
      RAISE EXCEPTION 'uscare: versiunea crește cu 1 la fiecare scriere' USING ERRCODE = '23514';
    END IF;
    NEW.creat_de := OLD.creat_de;
    NEW.creat_la := OLD.creat_la;
  END IF;
  IF NEW.stare = 'inchisa' AND cardinality(public.fn_executie_uscare_lipsa(NEW)) > 0 THEN
    RAISE EXCEPTION 'uscare: raportul se închide doar complet (lipsesc: %)', array_to_string(public.fn_executie_uscare_lipsa(NEW), ', ') USING ERRCODE = '23514';
  END IF;
  NEW.modificat_de := auth.uid();
  NEW.modificat_la := now();
  RETURN NEW;
END $f$;
-- pozele: nu se modifică; se adaugă / scot doar cât raportul e deschis (rândul raportului blocat FOR SHARE: o închidere concurentă așteaptă)
CREATE FUNCTION public.fn_executie_uscare_poza_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_stare text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'uscare: o poză înregistrată nu se modifică (se scoate și se adaugă alta)' USING ERRCODE = '42501';
  END IF;
  SELECT u.stare INTO v_stare FROM public.executie_uscari u
   WHERE u.id = CASE WHEN TG_OP = 'INSERT' THEN NEW.uscare_id ELSE OLD.uscare_id END FOR SHARE;
  IF v_stare IS DISTINCT FROM 'deschisa' THEN
    RAISE EXCEPTION 'uscare: pozele se adaugă / scot doar cât raportul e deschis' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.creat_de := auth.uid();
  NEW.creat_la := now();
  RETURN NEW;
END $f$;
CREATE FUNCTION public.fn_executie_uscare_jurnal_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'uscare: jurnalul nu se modifică' USING ERRCODE = '42501';
  END IF;
  NEW.creat_de := auth.uid();
  NEW.creat_la := now();
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_garda() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_poza_garda() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_jurnal_garda() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_uscare_garda BEFORE INSERT OR UPDATE OR DELETE ON public.executie_uscari
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_uscare_garda();
CREATE TRIGGER trg_executie_uscare_poza_garda BEFORE INSERT OR UPDATE OR DELETE ON public.executie_uscare_poze
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_uscare_poza_garda();
CREATE TRIGGER trg_executie_uscare_jurnal_garda BEFORE INSERT OR UPDATE OR DELETE ON public.executie_uscare_jurnal
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_uscare_jurnal_garda();
-- TRUNCATE: refuzat pe toate trei (și proprietarului; revenirea scoate tabelele prin DROP, doar goale)
CREATE FUNCTION public.fn_executie_uscare_fara_golire() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  RAISE EXCEPTION 'uscare: tabelele rapoartelor de uscare nu se golesc' USING ERRCODE = '42501';
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_fara_golire() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_uscare_fara_golire BEFORE TRUNCATE ON public.executie_uscari
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_executie_uscare_fara_golire();
CREATE TRIGGER trg_executie_uscare_poze_fara_golire BEFORE TRUNCATE ON public.executie_uscare_poze
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_executie_uscare_fara_golire();
CREATE TRIGGER trg_executie_uscare_jurnal_fara_golire BEFORE TRUNCATE ON public.executie_uscare_jurnal
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_executie_uscare_fara_golire();

-- ── RPC 1: creare / salvare pe parcurs (L01, L02, L04, L07, L08, L09, L12, L17) ──
-- p_id NULL = raport nou (p_versiune NULL); altfel salvare cu CAS pe versiune, doar pe raport deschis.
-- p_date = TOATE câmpurile formularului (cheile EXACTE din lista CAMPURI de mai jos; o cheie lipsă sau necunoscută = refuz, nimic nu se
-- golește / ignoră pe tăcute). Valorile: text (gol = NULL), numere JSON cu zecimalele permise (în plus = refuz, nu rotunjire), momente ISO cu
-- fus orar explicit, zile AAAA-LL-ZZ (Europe/Bucharest), listele cu forma exactă.
-- Ordinea: identitate -> rândul FOR UPDATE (la salvare) -> drept pe proiect -> idempotență -> CAS + stare -> valori -> reguli -> scriere + jurnal.
-- Rezultat: {ok, duplicat, uscare} sau {ok:false, motiv:'conflict', uscare} (s-a schimbat între timp: clientul reîncarcă).
CREATE FUNCTION public.fn_executie_uscare_salveaza(p_proiect bigint, p_id bigint, p_versiune integer, p_date jsonb, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  r public.executie_uscari;
  n public.executie_uscari;
  v_norm jsonb := '{}'::jsonb;
  v_amprenta text;
  v_strain text;
  v_lipsa text;
  v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
  v_dif jsonb;
  c record;
  v_val jsonb;
  v_txt text;
  v_nr numeric;
  j record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'uscare: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_proiect IS NULL OR p_cheie IS NULL OR p_date IS NULL OR jsonb_typeof(p_date) IS DISTINCT FROM 'object' OR ((p_id IS NULL) <> (p_versiune IS NULL)) THEN
    RAISE EXCEPTION 'uscare: parametri lipsă' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NOT NULL THEN
    SELECT * INTO r FROM public.executie_uscari WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR r.proiect_id IS DISTINCT FROM p_proiect THEN
      RAISE EXCEPTION 'uscare: raportul nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT public.fn_executie_nod_drept(p_proiect, true) THEN
    RAISE EXCEPTION 'uscare: raportul nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  v_amprenta := md5(jsonb_build_object('op', 'salveaza', 'proiect', p_proiect, 'id', p_id, 'versiune', p_versiune, 'date', p_date)::text);
  -- reluarea aceleiași apăsări (aceeași cheie): același conținut = succesul de data trecută; alt conținut = eroare
  SELECT uscare_id, amprenta INTO j FROM public.executie_uscare_jurnal WHERE cheie = p_cheie;
  IF FOUND THEN
    IF j.amprenta = v_amprenta THEN
      RETURN jsonb_build_object('ok', true, 'duplicat', true, 'uscare', (SELECT to_jsonb(u) FROM public.executie_uscari u WHERE u.id = j.uscare_id));
    END IF;
    RAISE EXCEPTION 'uscare: cheia apăsării a fost folosită pentru altă operație' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NOT NULL THEN
    IF r.versiune IS DISTINCT FROM p_versiune THEN
      RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'uscare', to_jsonb(r));
    END IF;
    IF r.stare <> 'deschisa' THEN
      RAISE EXCEPTION 'uscare: raportul e % și nu se mai modifică', r.stare USING ERRCODE = '22023';
    END IF;
  END IF;
  -- cheile EXACTE
  SELECT string_agg(k, ', ' ORDER BY k) INTO v_strain FROM jsonb_object_keys(p_date) k
   WHERE k NOT IN (SELECT x.k FROM (VALUES
    -- CAMPURI-START
    ('proba_id'), ('tronson'), ('km_de_la_m'), ('km_pana_la_m'), ('lungime_m'), ('inceput_planificat'), ('notificare_la'), ('notificare_ref'),
    ('data_operatie'), ('ora_inceput'), ('ora_final'), ('temperatura_c'), ('temperatura_sursa'), ('meteo_la'), ('vreme'), ('constructor'),
    ('utilaje'), ('pig_metalic_buc'), ('piston_pu_buc'), ('bureti_buc'), ('cantariri'), ('punct_roua_c'), ('punct_roua_loc'), ('presiune_bar'),
    ('timp_deplasare_min'), ('observatii'), ('concluzie'), ('semn_constructor_nume'), ('semn_constructor_functie'), ('semn_beneficiar_nume'),
    ('semn_beneficiar_functie')
    -- CAMPURI-END
   ) x(k));
  IF v_strain IS NOT NULL THEN RAISE EXCEPTION 'uscare: câmpuri necunoscute: %', v_strain USING ERRCODE = '22023'; END IF;
  -- valorile, pe tipuri (lista: cheie, tip, min, max, zecimale / lungime)
  FOR c IN SELECT * FROM (VALUES
      ('proba_id', 'id', 1, 999999999999, 0), ('tronson', 'text', NULL, NULL, 120), ('km_de_la_m', 'int', 0, 999999, 0),
      ('km_pana_la_m', 'int', 1, 1000000, 0), ('lungime_m', 'num', 0.1, 1000000, 1), ('inceput_planificat', 'moment', NULL, NULL, NULL),
      ('notificare_la', 'moment', NULL, NULL, NULL), ('notificare_ref', 'text', NULL, NULL, 300), ('data_operatie', 'zi', NULL, NULL, NULL),
      ('ora_inceput', 'moment', NULL, NULL, NULL), ('ora_final', 'moment', NULL, NULL, NULL), ('temperatura_c', 'num', -50, 60, 1),
      ('temperatura_sursa', 'sursa', NULL, NULL, NULL), ('meteo_la', 'moment', NULL, NULL, NULL), ('vreme', 'text', NULL, NULL, 120),
      ('constructor', 'text', NULL, NULL, 200), ('utilaje', 'utilaje', NULL, NULL, NULL), ('pig_metalic_buc', 'int', 0, 99, 0),
      ('piston_pu_buc', 'int', 0, 99, 0), ('bureti_buc', 'int', 0, 99, 0), ('cantariri', 'cantariri', NULL, NULL, NULL),
      ('punct_roua_c', 'num', -100, 50, 1), ('punct_roua_loc', 'text', NULL, NULL, 200), ('presiune_bar', 'num', 0.01, 100, 2),
      ('timp_deplasare_min', 'num', 0.1, 10000, 1), ('observatii', 'textlung', NULL, NULL, 4000), ('concluzie', 'concluzie', NULL, NULL, NULL),
      ('semn_constructor_nume', 'text', NULL, NULL, 120), ('semn_constructor_functie', 'text', NULL, NULL, 120),
      ('semn_beneficiar_nume', 'text', NULL, NULL, 120), ('semn_beneficiar_functie', 'text', NULL, NULL, 120)
    ) s(k, tip, mn, mx, z) LOOP
    IF NOT p_date ? c.k THEN v_lipsa := concat_ws(', ', v_lipsa, c.k); CONTINUE; END IF;
    v_val := p_date -> c.k;
    IF jsonb_typeof(v_val) = 'null' AND c.tip NOT IN ('utilaje', 'cantariri') THEN
      v_norm := v_norm || jsonb_build_object(c.k, NULL); CONTINUE;
    END IF;
    IF c.tip IN ('text', 'textlung', 'sursa', 'concluzie') THEN
      IF jsonb_typeof(v_val) <> 'string' THEN RAISE EXCEPTION 'uscare: % trebuie să fie text', c.k USING ERRCODE = '22023'; END IF;
      v_txt := nullif(btrim(v_val #>> '{}'), '');
      IF v_txt IS NOT NULL AND ((c.tip <> 'textlung' AND v_txt ~ '[[:cntrl:]]')
                                OR (c.tip = 'textlung' AND v_txt ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
                                OR length(v_txt) > coalesce(c.z, 50)) THEN
        RAISE EXCEPTION 'uscare: % are caractere nepermise sau e prea lung (cel mult % caractere)', c.k, coalesce(c.z, 50) USING ERRCODE = '22023';
      END IF;
      IF c.tip = 'sursa' AND v_txt IS NOT NULL AND v_txt NOT IN ('manual', 'meteo') THEN RAISE EXCEPTION 'uscare: sursa temperaturii e manual sau meteo' USING ERRCODE = '22023'; END IF;
      IF c.tip = 'concluzie' AND v_txt IS NOT NULL AND v_txt NOT IN ('conform', 'neconform') THEN RAISE EXCEPTION 'uscare: concluzia e conform sau neconform' USING ERRCODE = '22023'; END IF;
      v_norm := v_norm || jsonb_build_object(c.k, v_txt);
    ELSIF c.tip IN ('id', 'int', 'num') THEN
      IF jsonb_typeof(v_val) <> 'number' THEN RAISE EXCEPTION 'uscare: % trebuie să fie număr', c.k USING ERRCODE = '22023'; END IF;
      v_nr := (v_val #>> '{}')::numeric;
      IF v_nr < c.mn OR v_nr > c.mx OR v_nr <> round(v_nr, c.z) THEN
        RAISE EXCEPTION 'uscare: % în afara domeniului (% … %, cel mult % zecimale)', c.k, c.mn, c.mx, c.z USING ERRCODE = '22023';
      END IF;
      -- întregii ca întregi (un 5.0 din JSON nu intră altfel într-o coloană integer)
      v_norm := v_norm || jsonb_build_object(c.k, CASE WHEN c.tip IN ('id', 'int') THEN to_jsonb(v_nr::bigint) ELSE to_jsonb(v_nr) END);
    ELSIF c.tip = 'moment' THEN
      IF jsonb_typeof(v_val) <> 'string'
         OR (v_val #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
        RAISE EXCEPTION 'uscare: % trebuie să fie un moment ISO cu fus orar', c.k USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_norm := v_norm || jsonb_build_object(c.k, (v_val #>> '{}')::timestamptz);
      EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
        RAISE EXCEPTION 'uscare: % nu e un moment valid', c.k USING ERRCODE = '22023';
      END;
      IF (v_norm ->> c.k)::timestamptz < now() - interval '730 days' OR (v_norm ->> c.k)::timestamptz > now() + interval '60 days' THEN
        RAISE EXCEPTION 'uscare: % trebuie să fie în ultimii 2 ani sau în următoarele 60 de zile', c.k USING ERRCODE = '22023';
      END IF;
    ELSIF c.tip = 'zi' THEN
      IF jsonb_typeof(v_val) <> 'string' OR (v_val #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'uscare: % trebuie să fie o zi AAAA-LL-ZZ', c.k USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_norm := v_norm || jsonb_build_object(c.k, (v_val #>> '{}')::date);
      EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
        RAISE EXCEPTION 'uscare: % nu e o zi validă', c.k USING ERRCODE = '22023';
      END;
      IF (v_norm ->> c.k)::date < v_azi - 730 OR (v_norm ->> c.k)::date > v_azi + 60 THEN
        RAISE EXCEPTION 'uscare: data operației trebuie să fie între % și %', v_azi - 730, v_azi + 60 USING ERRCODE = '22023';
      END IF;
    ELSIF c.tip = 'utilaje' THEN
      IF NOT public.fn_executie_uscare_utilaje_ok(v_val) THEN
        RAISE EXCEPTION 'uscare: utilajele: listă de {denumire, buc} (cel mult 20; buc 1–99; denumire 1–120 caractere)' USING ERRCODE = '22023';
      END IF;
      v_norm := v_norm || jsonb_build_object(c.k, v_val);
    ELSIF c.tip = 'cantariri' THEN
      IF NOT public.fn_executie_uscare_cantariri_ok(v_val) THEN
        RAISE EXCEPTION 'uscare: cântăririle: listă de {nr, intrare_kg, iesire_kg} (nr 1–20 unic; kg 0,001–1000 cu cel mult 3 zecimale)' USING ERRCODE = '22023';
      END IF;
      v_norm := v_norm || jsonb_build_object(c.k, v_val);
    END IF;
  END LOOP;
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'uscare: câmpuri lipsă: %', v_lipsa USING ERRCODE = '22023'; END IF;
  n := jsonb_populate_record(NULL::public.executie_uscari, v_norm);
  -- regulile între câmpuri
  IF n.tronson IS NULL OR n.km_de_la_m IS NULL OR n.km_pana_la_m IS NULL THEN
    RAISE EXCEPTION 'uscare: tronsonul și intervalul de km sunt obligatorii' USING ERRCODE = '22023';
  END IF;
  IF n.km_pana_la_m <= n.km_de_la_m THEN RAISE EXCEPTION 'uscare: intervalul de km e greșit (sfârșitul trebuie să fie după început)' USING ERRCODE = '22023'; END IF;
  IF n.ora_final IS NOT NULL AND (n.ora_inceput IS NULL OR n.ora_final <= n.ora_inceput OR n.ora_final > n.ora_inceput + interval '30 days') THEN
    RAISE EXCEPTION 'uscare: ora de final trebuie să fie după ora de început (cel mult 30 de zile)' USING ERRCODE = '22023';
  END IF;
  IF (n.temperatura_c IS NULL) <> (n.temperatura_sursa IS NULL) OR coalesce(n.temperatura_sursa = 'meteo', false) <> (n.meteo_la IS NOT NULL) THEN
    RAISE EXCEPTION 'uscare: temperatura cere sursa (manual / meteo); ora datelor meteo doar la sursa meteo' USING ERRCODE = '22023';
  END IF;
  -- tronsonul de probă: al ACELUIAȘI proiect (FK compus); o legătură NOUĂ doar spre un tronson de probă activ
  IF n.proba_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.executie_probe_tronsoane t WHERE t.id = n.proba_id AND t.proiect_id = p_proiect
                    AND (t.stare = 'activ' OR (p_id IS NOT NULL AND t.id = r.proba_id))) THEN
      RAISE EXCEPTION 'uscare: tronsonul de probă nu există pe acest proiect sau e anulat' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.executie_uscari (proiect_id, proba_id, tronson, km_de_la_m, km_pana_la_m, lungime_m, inceput_planificat, notificare_la,
      notificare_ref, data_operatie, ora_inceput, ora_final, temperatura_c, temperatura_sursa, meteo_la, vreme, constructor, utilaje,
      pig_metalic_buc, piston_pu_buc, bureti_buc, cantariri, punct_roua_c, punct_roua_loc, presiune_bar, timp_deplasare_min, observatii,
      concluzie, semn_constructor_nume, semn_constructor_functie, semn_beneficiar_nume, semn_beneficiar_functie)
    VALUES (p_proiect, n.proba_id, n.tronson, n.km_de_la_m, n.km_pana_la_m, n.lungime_m, n.inceput_planificat, n.notificare_la,
      n.notificare_ref, n.data_operatie, n.ora_inceput, n.ora_final, n.temperatura_c, n.temperatura_sursa, n.meteo_la, n.vreme, n.constructor,
      n.utilaje, n.pig_metalic_buc, n.piston_pu_buc, n.bureti_buc, n.cantariri, n.punct_roua_c, n.punct_roua_loc, n.presiune_bar,
      n.timp_deplasare_min, n.observatii, n.concluzie, n.semn_constructor_nume, n.semn_constructor_functie, n.semn_beneficiar_nume,
      n.semn_beneficiar_functie)
    RETURNING * INTO r;
    INSERT INTO public.executie_uscare_jurnal (uscare_id, proiect_id, actiune, valori, cheie, amprenta)
    VALUES (r.id, r.proiect_id, 'creare', jsonb_strip_nulls(v_norm), p_cheie, v_amprenta);
  ELSE
    -- diferențele (doar câmpurile formularului), pentru jurnal: {camp: [vechi, nou]}
    SELECT coalesce(jsonb_object_agg(k, jsonb_build_array(to_jsonb(r) -> k, to_jsonb(n) -> k)), '{}'::jsonb) INTO v_dif
      FROM jsonb_object_keys(v_norm) k WHERE (to_jsonb(r) -> k) IS DISTINCT FROM (to_jsonb(n) -> k);
    UPDATE public.executie_uscari SET
      proba_id = n.proba_id, tronson = n.tronson, km_de_la_m = n.km_de_la_m, km_pana_la_m = n.km_pana_la_m, lungime_m = n.lungime_m,
      inceput_planificat = n.inceput_planificat, notificare_la = n.notificare_la, notificare_ref = n.notificare_ref,
      data_operatie = n.data_operatie, ora_inceput = n.ora_inceput, ora_final = n.ora_final, temperatura_c = n.temperatura_c,
      temperatura_sursa = n.temperatura_sursa, meteo_la = n.meteo_la, vreme = n.vreme, constructor = n.constructor, utilaje = n.utilaje,
      pig_metalic_buc = n.pig_metalic_buc, piston_pu_buc = n.piston_pu_buc, bureti_buc = n.bureti_buc, cantariri = n.cantariri,
      punct_roua_c = n.punct_roua_c, punct_roua_loc = n.punct_roua_loc, presiune_bar = n.presiune_bar,
      timp_deplasare_min = n.timp_deplasare_min, observatii = n.observatii, concluzie = n.concluzie,
      semn_constructor_nume = n.semn_constructor_nume, semn_constructor_functie = n.semn_constructor_functie,
      semn_beneficiar_nume = n.semn_beneficiar_nume, semn_beneficiar_functie = n.semn_beneficiar_functie,
      versiune = r.versiune + 1
    WHERE id = p_id
    RETURNING * INTO r;
    INSERT INTO public.executie_uscare_jurnal (uscare_id, proiect_id, actiune, valori, cheie, amprenta)
    VALUES (r.id, r.proiect_id, 'salvare', v_dif, p_cheie, v_amprenta);
  END IF;
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'uscare', to_jsonb(r));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_salveaza(bigint, bigint, integer, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_uscare_salveaza(bigint, bigint, integer, jsonb, uuid) TO authenticated;

-- ── RPC 2: închidere / redeschidere consemnată / anulare (L01, L04, L07, L09, L20) ──
-- Ordinea: identitate -> rândul FOR UPDATE -> drept (scriere pe proiect; redeschiderea: admin Execuție / owner) -> idempotență -> CAS
--   -> tranziție (lista albă) -> motiv -> completitudine (închidere) -> UPDATE + jurnal cu conținutul complet (închidere / redeschidere).
CREATE FUNCTION public.fn_executie_uscare_stare(p_id bigint, p_versiune integer, p_actiune text, p_motiv text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  r public.executie_uscari;
  v_noua text;
  v_motiv text := nullif(btrim(coalesce(p_motiv, '')), '');
  v_amprenta text;
  v_lipsa text[];
  v_continut jsonb;
  j record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'uscare: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_versiune IS NULL OR p_actiune IS NULL OR p_cheie IS NULL THEN RAISE EXCEPTION 'uscare: parametri lipsă' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM public.executie_uscari WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.fn_executie_nod_drept(r.proiect_id, true) THEN
    RAISE EXCEPTION 'uscare: raportul nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  IF p_actiune = 'redeschide' AND NOT public.fn_executie_contract_drept(r.proiect_id, true) THEN
    RAISE EXCEPTION 'uscare: redeschiderea unui raport închis cere drept de administrator pe Execuție' USING ERRCODE = '42501';
  END IF;
  v_amprenta := md5(jsonb_build_object('op', 'stare', 'id', p_id, 'versiune', p_versiune, 'actiune', p_actiune, 'motiv', v_motiv)::text);
  SELECT uscare_id, amprenta INTO j FROM public.executie_uscare_jurnal WHERE cheie = p_cheie;
  IF FOUND THEN
    IF j.amprenta = v_amprenta THEN RETURN jsonb_build_object('ok', true, 'duplicat', true, 'uscare', to_jsonb(r)); END IF;
    RAISE EXCEPTION 'uscare: cheia apăsării a fost folosită pentru altă operație' USING ERRCODE = '22023';
  END IF;
  IF r.versiune IS DISTINCT FROM p_versiune THEN RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'uscare', to_jsonb(r)); END IF;
  v_noua := public.fn_executie_uscare_tranzitie(r.stare, p_actiune);
  IF v_noua IS NULL THEN RAISE EXCEPTION 'uscare: acțiunea % nu se poate face pe un raport %', p_actiune, r.stare USING ERRCODE = '22023'; END IF;
  IF p_actiune IN ('redeschide', 'anuleaza') AND (v_motiv IS NULL OR length(v_motiv) > 500 OR v_motiv ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'uscare: motivul e obligatoriu (cel mult 500 de caractere, un rând)' USING ERRCODE = '22023';
  END IF;
  IF p_actiune = 'inchide' AND v_motiv IS NOT NULL THEN RAISE EXCEPTION 'uscare: închiderea nu are motiv' USING ERRCODE = '22023'; END IF;
  IF p_actiune = 'inchide' THEN
    v_lipsa := public.fn_executie_uscare_lipsa(r);
    IF cardinality(v_lipsa) > 0 THEN
      RAISE EXCEPTION 'uscare: pentru închidere lipsesc: %', array_to_string(v_lipsa, ', ') USING ERRCODE = '22023';
    END IF;
  END IF;
  -- conținutul raportului închis (la închidere: ce se închide; la redeschidere: ce era semnat), cu pozele lui
  IF p_actiune IN ('inchide', 'redeschide') THEN
    v_continut := jsonb_build_object('raport', to_jsonb(r), 'poze',
      (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]'::jsonb) FROM public.executie_uscare_poze p WHERE p.uscare_id = r.id));
  ELSE
    v_continut := '{}'::jsonb;
  END IF;
  UPDATE public.executie_uscari SET
    stare = v_noua,
    revizie = CASE WHEN p_actiune = 'redeschide' THEN r.revizie + 1 ELSE r.revizie END,
    inchis_la = CASE WHEN v_noua = 'inchisa' THEN now() ELSE NULL END,
    inchis_de = CASE WHEN v_noua = 'inchisa' THEN v_uid ELSE NULL END,
    motiv_anulare = CASE WHEN v_noua = 'anulata' THEN v_motiv ELSE NULL END,
    versiune = r.versiune + 1
  WHERE id = p_id
  RETURNING * INTO r;
  INSERT INTO public.executie_uscare_jurnal (uscare_id, proiect_id, actiune, stare_veche, stare_noua, valori, motiv, cheie, amprenta)
  VALUES (r.id, r.proiect_id, CASE p_actiune WHEN 'inchide' THEN 'inchidere' WHEN 'redeschide' THEN 'redeschidere' ELSE 'anulare' END,
          CASE p_actiune WHEN 'inchide' THEN 'deschisa' WHEN 'redeschide' THEN 'inchisa' ELSE 'deschisa' END, v_noua,
          v_continut, CASE WHEN p_actiune = 'inchide' THEN NULL ELSE v_motiv END, p_cheie, v_amprenta);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'uscare', to_jsonb(r));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_stare(bigint, integer, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_uscare_stare(bigint, integer, text, text, uuid) TO authenticated;

-- ── RPC 3: o poză adăugată / scoasă (L02, L04, L07, L09) ──
-- adauga: fișierul e DEJA încărcat de client în executie-uscare, la <proiect>/<uscare>/<uuid>.jpg (politica de încărcare cere dreptul de scriere
--   și raportul deschis); RPC-ul verifică existența obiectului și înregistrează poza. scoate: rândul pozei se șterge (fișierul rămâne în
--   bucket, ca dovadă; jurnalul păstrează rândul). Nu schimbă versiunea raportului (formularul deschis pe telefon nu intră în conflict cu
--   pozele lui); închiderea blochează același rând, deci nu există poză adăugată după închidere.
-- Ordinea: identitate -> raportul FOR UPDATE -> drept -> idempotență -> stare -> (scoate) poza FOR UPDATE -> INSERT / DELETE + jurnal.
CREATE FUNCTION public.fn_executie_uscare_poza(p_uscare bigint, p_actiune text, p_poza bigint, p_cale text, p_categorie text, p_burete_nr integer,
  p_legenda text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  u public.executie_uscari;
  p public.executie_uscare_poze;
  v_leg text := nullif(btrim(coalesce(p_legenda, '')), '');
  v_amprenta text;
  j record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'uscare: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_uscare IS NULL OR p_cheie IS NULL OR p_actiune IS NULL OR p_actiune NOT IN ('adauga', 'scoate')
     OR (p_actiune = 'adauga' AND (p_poza IS NOT NULL OR p_cale IS NULL OR p_categorie IS NULL))
     OR (p_actiune = 'scoate' AND (p_poza IS NULL OR p_cale IS NOT NULL OR p_categorie IS NOT NULL OR p_burete_nr IS NOT NULL OR p_legenda IS NOT NULL)) THEN
    RAISE EXCEPTION 'uscare: parametri lipsă sau în plus' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO u FROM public.executie_uscari WHERE id = p_uscare FOR UPDATE;
  IF NOT FOUND OR NOT public.fn_executie_nod_drept(u.proiect_id, true) THEN
    RAISE EXCEPTION 'uscare: raportul nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  v_amprenta := md5(jsonb_build_object('op', 'poza', 'uscare', p_uscare, 'actiune', p_actiune, 'poza', p_poza, 'cale', p_cale,
                                       'categorie', p_categorie, 'burete', p_burete_nr, 'legenda', v_leg)::text);
  SELECT uscare_id, amprenta INTO j FROM public.executie_uscare_jurnal WHERE cheie = p_cheie;
  IF FOUND THEN
    IF j.amprenta = v_amprenta THEN
      RETURN jsonb_build_object('ok', true, 'duplicat', true,
                                'poza', (SELECT to_jsonb(x) FROM public.executie_uscare_poze x WHERE x.cale = p_cale AND x.uscare_id = p_uscare));
    END IF;
    RAISE EXCEPTION 'uscare: cheia apăsării a fost folosită pentru altă operație' USING ERRCODE = '22023';
  END IF;
  IF u.stare <> 'deschisa' THEN RAISE EXCEPTION 'uscare: raportul e % și pozele nu se mai schimbă', u.stare USING ERRCODE = '22023'; END IF;
  IF p_actiune = 'adauga' THEN
    IF p_categorie NOT IN ('manometru', 'temperatura', 'pistoane', 'cantar_intrare', 'cantar_iesire', 'punct_roua', 'utilaje', 'altele') THEN
      RAISE EXCEPTION 'uscare: categoria pozei e necunoscută' USING ERRCODE = '22023';
    END IF;
    IF p_burete_nr IS NOT NULL AND (p_categorie NOT IN ('cantar_intrare', 'cantar_iesire') OR p_burete_nr NOT BETWEEN 1 AND 20) THEN
      RAISE EXCEPTION 'uscare: numărul buretelui (1–20) doar la cântăriri' USING ERRCODE = '22023';
    END IF;
    IF length(coalesce(v_leg, '')) > 300 OR v_leg ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'uscare: legenda: cel mult 300 de caractere, un rând' USING ERRCODE = '22023'; END IF;
    IF p_cale !~ '^[0-9]{1,18}/[0-9]{1,18}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
       OR split_part(p_cale, '/', 1) <> u.proiect_id::text OR split_part(p_cale, '/', 2) <> u.id::text THEN
      RAISE EXCEPTION 'uscare: calea pozei nu e a acestui raport' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'executie-uscare' AND o.name = p_cale) THEN
      RAISE EXCEPTION 'uscare: fișierul pozei nu e încărcat' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.executie_uscare_poze x WHERE x.cale = p_cale) THEN
      RAISE EXCEPTION 'uscare: poza e deja înregistrată' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.executie_uscare_poze x WHERE x.uscare_id = u.id) >= 200 THEN
      RAISE EXCEPTION 'uscare: cel mult 200 de poze pe raport' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.executie_uscare_poze (uscare_id, proiect_id, categorie, burete_nr, cale, legenda)
    VALUES (u.id, u.proiect_id, p_categorie, p_burete_nr, p_cale, v_leg)
    RETURNING * INTO p;
    INSERT INTO public.executie_uscare_jurnal (uscare_id, proiect_id, actiune, valori, cheie, amprenta)
    VALUES (u.id, u.proiect_id, 'poza_adaugata', jsonb_strip_nulls(to_jsonb(p)), p_cheie, v_amprenta);
  ELSE
    SELECT * INTO p FROM public.executie_uscare_poze x WHERE x.id = p_poza AND x.uscare_id = u.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'uscare: poza nu (mai) e în acest raport' USING ERRCODE = '22023'; END IF;
    DELETE FROM public.executie_uscare_poze WHERE id = p.id;
    INSERT INTO public.executie_uscare_jurnal (uscare_id, proiect_id, actiune, valori, cheie, amprenta)
    VALUES (u.id, u.proiect_id, 'poza_scoasa', jsonb_strip_nulls(to_jsonb(p)), p_cheie, v_amprenta);
  END IF;
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'poza', CASE WHEN p_actiune = 'adauga' THEN to_jsonb(p) ELSE NULL END);
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_poza(bigint, text, bigint, text, text, integer, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_uscare_poza(bigint, text, bigint, text, text, integer, text, uuid) TO authenticated;

-- ── RLS + privilegii: doar citire pentru aplicație (L07); scrierea trece numai prin RPC-uri ──
ALTER TABLE public.executie_uscari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_uscare_poze ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_uscare_jurnal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_uscari, public.executie_uscare_poze, public.executie_uscare_jurnal FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_uscari, public.executie_uscare_poze, public.executie_uscare_jurnal TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.executie_uscari_id_seq, public.executie_uscare_poze_id_seq, public.executie_uscare_jurnal_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY executie_uscari_citire ON public.executie_uscari FOR SELECT TO authenticated
  USING (public.fn_executie_nod_drept(proiect_id, false));
CREATE POLICY executie_uscare_poze_citire ON public.executie_uscare_poze FOR SELECT TO authenticated
  USING (public.fn_executie_nod_drept(proiect_id, false));
CREATE POLICY executie_uscare_jurnal_citire ON public.executie_uscare_jurnal FOR SELECT TO authenticated
  USING (public.fn_executie_nod_drept(proiect_id, false));

-- ── Storage: bucket privat, doar JPEG (clientul comprimă), 10 MB ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('executie-uscare', 'executie-uscare', false, 10485760, ARRAY['image/jpeg']);
-- cale: <proiect_id>/<uscare_id>/<uuid>.jpg; alt bucket sau altă formă = fals (CASE: conversia la bigint doar după verificarea formei).
-- Citire: dreptul de citire pe proiect + o uscare a ACELUI proiect; încărcare: dreptul de scriere + uscarea DESCHISĂ.
-- Întoarce doar adevărat / fals despre apelant: pentru un proiect pe care apelantul nu-l vede răspunsul e fals indiferent ce există (fără oracol);
-- în proiectele pe care le vede, uscările îi sunt oricum vizibile prin RLS.
CREATE FUNCTION public.fn_executie_uscare_obiect(p_bucket text, p_name text, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN p_bucket IS DISTINCT FROM 'executie-uscare' OR p_scriere IS NULL THEN false
    WHEN p_name ~ '^[0-9]{1,18}/[0-9]{1,18}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$' THEN
      public.fn_executie_nod_drept(split_part(p_name, '/', 1)::bigint, p_scriere)
      AND EXISTS (SELECT 1 FROM public.executie_uscari u
                   WHERE u.id = split_part(p_name, '/', 2)::bigint AND u.proiect_id = split_part(p_name, '/', 1)::bigint
                     AND (p_scriere IS FALSE OR u.stare = 'deschisa'))
    ELSE false END
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_obiect(text, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_uscare_obiect(text, text, boolean) TO authenticated;
CREATE POLICY executie_uscare_citire ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'executie-uscare' AND public.fn_executie_uscare_obiect(bucket_id, name, false));
CREATE POLICY executie_uscare_adauga ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'executie-uscare' AND public.fn_executie_uscare_obiect(bucket_id, name, true));

-- ── postcondiții ──
DO $post$
DECLARE v_rel oid; v_tab text; r record; v_alt text;
BEGIN
  FOREACH v_tab IN ARRAY ARRAY['executie_uscari', 'executie_uscare_poze', 'executie_uscare_jurnal'] LOOP
    v_rel := to_regclass('public.' || v_tab);
    -- RLS + exact o politică: SELECT, permisivă, doar authenticated, fără WITH CHECK, expresia EXACTĂ, dependentă de funcția de drept
    IF v_rel IS NULL OR (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) IS NOT TRUE
       OR (SELECT relforcerowsecurity FROM pg_class WHERE oid = v_rel) IS NOT FALSE
       OR (SELECT count(*) FROM pg_policy WHERE polrelid = v_rel) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = v_rel AND pol.polname = v_tab || '_citire'
                       AND pol.polcmd = 'r' AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid]
                       AND pol.polwithcheck IS NULL
                       AND pg_get_expr(pol.polqual, pol.polrelid) IN ('fn_executie_nod_drept(proiect_id, false)', 'public.fn_executie_nod_drept(proiect_id, false)')
                       AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_policy'::regclass AND d.objid = pol.oid
                                    AND d.refclassid = 'pg_proc'::regclass AND d.refobjid = 'public.fn_executie_nod_drept(bigint, boolean)'::regprocedure)) THEN
      RAISE EXCEPTION '20261225a post: RLS / politica %', v_tab;
    END IF;
    -- privilegiile, fiecare pe rând (o listă în has_table_privilege e adevărată dacă ORICARE există): doar SELECT pentru authenticated /
    -- service_role, nimic pentru anon; nimic pentru PUBLIC, pe coloane, pe secvențe
    FOR r IN SELECT * FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) rol,
                       unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) drept LOOP
      IF has_table_privilege(r.rol, v_rel, r.drept) IS DISTINCT FROM (r.drept = 'SELECT' AND r.rol <> 'anon') THEN
        RAISE EXCEPTION '20261225a post: drept % pe % pentru %', r.drept, v_tab, r.rol;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = v_rel AND e.grantee = 0)
       OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND attacl IS NOT NULL)
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) rol, unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) drept
                   WHERE has_sequence_privilege(rol, pg_get_serial_sequence('public.' || v_tab, 'id'), drept))
       OR pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = v_rel)) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION '20261225a post: privilegii PUBLIC / coloane / secventa / proprietar pe %', v_tab;
    END IF;
  END LOOP;
  -- funcțiile: limbaj, DEFINER, search_path fix, proprietar, EXECUTE exact (RPC-urile + predicatul Storage: doar authenticated; restul: nimeni)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_executie_uscare_utilaje_ok(jsonb)', 'sql', false, false),
      ('public.fn_executie_uscare_cantariri_ok(jsonb)', 'sql', false, false),
      ('public.fn_executie_uscare_lipsa(public.executie_uscari)', 'sql', false, false),
      ('public.fn_executie_uscare_tranzitie(text, text)', 'sql', false, false),
      ('public.fn_executie_uscare_garda()', 'plpgsql', false, false),
      ('public.fn_executie_uscare_poza_garda()', 'plpgsql', false, false),
      ('public.fn_executie_uscare_jurnal_garda()', 'plpgsql', false, false),
      ('public.fn_executie_uscare_fara_golire()', 'plpgsql', false, false),
      ('public.fn_executie_uscare_salveaza(bigint, bigint, integer, jsonb, uuid)', 'plpgsql', true, true),
      ('public.fn_executie_uscare_stare(bigint, integer, text, text, uuid)', 'plpgsql', true, true),
      ('public.fn_executie_uscare_poza(bigint, text, bigint, text, text, integer, text, uuid)', 'plpgsql', true, true),
      ('public.fn_executie_uscare_obiect(text, text, boolean)', 'sql', true, true)
    ) v(fn, limbaj, definer, exec_auth) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef = r.definer
                      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                      AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = r.exec_auth
                      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)) THEN
      RAISE EXCEPTION '20261225a post: functia % (limbaj / definer / search_path / owner / EXECUTE)', r.fn;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_uscare\_%') <> 12 THEN
    RAISE EXCEPTION '20261225a post: numarul functiilor fn_executie_uscare_* difera de 12';
  END IF;
  -- trigger-ele: forma exactă (funcția, evenimentele, fără WHEN / argumente / coloane), active, singurele ne-interne de pe tabele
  IF (SELECT count(*) FROM pg_trigger tg JOIN (VALUES
        ('public.executie_uscari'::regclass, 'trg_executie_uscare_garda', 'public.fn_executie_uscare_garda()'::regprocedure, 1 | 2 | 4 | 8 | 16),
        ('public.executie_uscare_poze'::regclass, 'trg_executie_uscare_poza_garda', 'public.fn_executie_uscare_poza_garda()'::regprocedure, 1 | 2 | 4 | 8 | 16),
        ('public.executie_uscare_jurnal'::regclass, 'trg_executie_uscare_jurnal_garda', 'public.fn_executie_uscare_jurnal_garda()'::regprocedure, 1 | 2 | 4 | 8 | 16),
        ('public.executie_uscari'::regclass, 'trg_executie_uscare_fara_golire', 'public.fn_executie_uscare_fara_golire()'::regprocedure, 2 | 32),
        ('public.executie_uscare_poze'::regclass, 'trg_executie_uscare_poze_fara_golire', 'public.fn_executie_uscare_fara_golire()'::regprocedure, 2 | 32),
        ('public.executie_uscare_jurnal'::regclass, 'trg_executie_uscare_jurnal_fara_golire', 'public.fn_executie_uscare_fara_golire()'::regprocedure, 2 | 32)
      ) a(rel, nume, fn, tip) ON tg.tgrelid = a.rel AND tg.tgname = a.nume
     WHERE NOT tg.tgisinternal AND tg.tgfoid = a.fn AND tg.tgtype = a.tip AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0
       AND coalesce(array_length(tg.tgattr::int2[], 1), 0) = 0) <> 6
     OR (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
          AND tgrelid IN ('public.executie_uscari'::regclass, 'public.executie_uscare_poze'::regclass, 'public.executie_uscare_jurnal'::regclass)) <> 6 THEN
    RAISE EXCEPTION '20261225a post: trigger-ele';
  END IF;
  -- Storage: bucket privat, doar JPEG; exact cele două politici ale lui, nicio altă politică nu numește bucket-ul, nicio politică de
  -- modificare / ștergere pentru el
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'executie-uscare' AND public IS FALSE AND file_size_limit = 10485760
                   AND allowed_mime_types = ARRAY['image/jpeg'])
     OR NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = 'storage.objects'::regclass AND pol.polname = 'executie_uscare_citire'
                      AND pol.polcmd = 'r' AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid] AND pol.polwithcheck IS NULL
                      AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%fn_executie_uscare_obiect(bucket_id, name, false)%')
     OR NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = 'storage.objects'::regclass AND pol.polname = 'executie_uscare_adauga'
                      AND pol.polcmd = 'a' AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid] AND pol.polqual IS NULL
                      AND pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%fn_executie_uscare_obiect(bucket_id, name, true)%')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                  AND policyname NOT IN ('executie_uscare_citire', 'executie_uscare_adauga')
                  AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%executie-uscare%') THEN
    RAISE EXCEPTION '20261225a post: bucket privat / politicile storage';
  END IF;
  -- funcțiile NOI cheamă (regula de nume a apelurilor) doar funcțiile lor, lanțul de drept amprentat și auth.uid(); nimic dinamic
  SELECT string_agg(DISTINCT p2.oid::regprocedure::text, ', ') INTO v_alt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL regexp_matches(p.prosrc, '([[:alpha:]_][[:alnum:]_$]*)"?[[:space:]]*\(', 'g') w
    JOIN pg_proc p2 ON lower(p2.proname) = lower(w[1]) AND p2.oid <> p.oid
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_uscare\_%'
     AND p2.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND p2.proname NOT LIKE 'fn\_executie\_uscare\_%'
     AND p2.oid NOT IN ('auth.uid()'::regprocedure, 'public.fn_executie_nod_drept(bigint, boolean)'::regprocedure,
                        'public.fn_executie_contract_drept(bigint, boolean)'::regprocedure);
  IF v_alt IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_uscare\_%' AND p.prosrc ~* '\mexecute\M') THEN
    RAISE EXCEPTION '20261225a post: functiile noi cheama in afara lantului amprentat: %', coalesce(v_alt, 'EXECUTE dinamic');
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_uscari) OR EXISTS (SELECT 1 FROM public.executie_uscare_poze)
     OR EXISTS (SELECT 1 FROM public.executie_uscare_jurnal) OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'executie-uscare') THEN
    RAISE EXCEPTION '20261225a post: migrarea nu scrie date';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261225a_executie_uscare:' || txid_current() THEN
    RAISE EXCEPTION '20261225a: garda final invalida';
  END IF;
END $post$;

-- L15: același lanț DUPĂ schimbare, timpul, apoi funcția pg_temp se șterge
DO $l15_dupa$ BEGIN
  PERFORM pg_temp.lant_20261225a('dupa');
  RAISE NOTICE '20261225a: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $l15_dupa$;
DROP FUNCTION pg_temp.lant_20261225a(text);
