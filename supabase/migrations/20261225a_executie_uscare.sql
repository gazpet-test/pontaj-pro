-- Version 20261225120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20261225a_executie_uscare.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al runnerului
--   în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 (runda 2): garanția la aplicare = amprenta GLOBALĂ v2 a runnerului (docs/LIVRARE_L15_V2.md): orice derivă a oricărei funcții, politici,
--   drept sau trigger față de baseline-ul revizuit = refuz, nimic comis. Manifestul .l15.tsv îl generează coordonatorul pe clonă
--   (scripts/livrare_l15_manifest.sh); lista OBIECTELOR pe care trebuie să le conțină (familie, etichetă, operație — scrisă și verificată pe
--   PGlite cu pașii reali ai runnerului) e în supabase/tests/20261225a_executie_uscare.l15.obiecte.tsv; comanda de comparare: spec §11.
--   Pe lângă ea, migrarea verifică pe amprentă (corp + proprietăți, ÎNAINTE și DUPĂ) cele două porți de drept pe care le cheamă direct și
--   lanțul lor (listă scrisă, fără citirea corpurilor cu regex).
-- 20261225a_executie_uscare — Execuție → proiect → „Uscare conductă”: raportul de uscare pe tronson cerut de beneficiar (model de raport primit
--   pe 27.10.2026; cerințe: notificare cu minimum 24 h înainte, fotografii pentru tot ce se trece în tabel). Specificația:
--   docs/executie/USCARE_CONDUCTA_SPEC.md (fluxul, criteriul de acceptare, stările, matricea de acces, ce NU se știe, poziția și vremea).
--
-- Ce face (DOAR obiecte noi, nicio dată, niciun drept pe tabele existente):
--   * executie_uscari: o operațiune de uscare pe proiect, legată OPȚIONAL de un tronson de probă (executie_probe_tronsoane, același proiect,
--     FK compus) sau pe un interval liber de km. Rubricile modelului (data, tronson, km, lungime, temperatura exterioară, constructorul,
--     utilajele, orele, pistoanele, cântăririle bureților, punctul de rouă și locul — OPȚIONALE —, presiunea, timpul de deplasare, observațiile,
--     concluzia, semnatarii) + CRITERIUL din caietul de sarcini (cap. 4.1.8.5: „conducta se consideră uscată atunci când ultimul piston vehiculat
--     iese uscat”): rezultatul consemnat explicit (uscat / umed) + fotografia ultimului piston; poziția operațiunii (coordonate, sursa
--     gps / traseu / manual, precizia, momentul; la traseu km-ul și versiunea traseului); instantaneul meteo construit de SERVER din vremea
--     șantierului proiectului (furnizorul, coordonatele, ora cerută = ora începerii, ora observației, ora preluării, valoarea automată) —
--     temperatura din raport rămâne a omului (măsurată) sau cea automată, iar instantaneul se păstrează în ambele cazuri; justificarea
--     fotografiilor lipsă. NU se stochează ce se calculează (durata, viteza, diferența de greutate, verificarea celor 24 h) — src/uscareLogica.js.
--   * executie_uscare_incarcari: EVIDENȚA fiecărui fișier înainte de urcare (rezervarea căii, cu categoria / buretele / legenda): încărcarea în
--     Storage cere o rezervare a utilizatorului; o rezervare neînregistrată ca poză rămâne vizibilă („de lămurit”) până la înregistrare sau
--     renunțare consemnată (fișierul NU se șterge niciodată automat). Închiderea cere zero rezervări nelămurite.
--   * executie_uscare_poze: fotografiile înregistrate (din rezervare), pe categorii (inclusiv „piston_final” = ultimul piston vehiculat).
--   * executie_uscare_jurnal: jurnalul operațiilor (creare, salvare cu diferențele, închidere / redeschidere cu conținutul complet, anulare,
--     rezervări, poze, renunțări), doar adăugare; cheia de idempotență a fiecărei apăsări (L04).
--   * Stările: deschisa -> inchisa (NIMIC nu se mai schimbă) -> deschisa („redeschidere consemnată”: motiv obligatoriu, doar administrator
--     Execuție / owner cu acces la proiect, revizia crește, conținutul închis rămâne în jurnal); deschisa -> anulata (motiv; final).
--     Închiderea cere: rubricile modelului (fără punctul de rouă, observații, semnatari), rezultatul ultimului piston, câte o cântărire pe
--     FIECARE burete declarat (sau „nu se aplică” cu motiv), la CONFORM rezultatul „uscat” + fotografia ultimului piston (blocant), pentru
--     celelalte fotografii cerute de beneficiar (corelate cu bureții cântăriți) justificarea lipsei consemnată, zero încărcări nelămurite.
--   * Scrierea DOAR prin 4 RPC-uri SECURITY DEFINER (fn_executie_uscare_salveaza / _stare / _poza / _retrage): auth.uid() obligatoriu, cheia
--     apăsării REVENDICATĂ întâi (lock consultativ pe cheie: două apeluri cu aceeași cheie se serializează, al doilea vede jurnalul primului),
--     dreptul pe proiect prin fn_executie_nod_drept (redeschiderea: fn_executie_contract_drept, nivelul admin), lock pe rând, CAS pe versiune.
--     _retrage = „Renunț” la o cerere nelămurită: răspunde după cheie dacă s-a aplicat; dacă nu, o retrage DEFINITIV (nicio cale spre dublură).
--     Fără INSERT / UPDATE / DELETE pentru anon / authenticated / service_role. Citirea prin RLS: același drept, orice nivel.
--   * Gărzi în BD pe ORICE cale (L07, trigger-e BEFORE): proveniența (creat_de / modificat_de = auth.uid()), proiectul imuabil, raportul
--     închis / anulat nu se modifică, închiderea doar completă (aceeași funcție ca RPC-ul), schimbarea stării nu schimbă datele, nicio ștergere;
--     pozele și rezervările se schimbă doar cât raportul e deschis (rândul raportului blocat FOR SHARE); rezervarea: doar renunțarea, o dată.
--   * Storage: bucket privat executie-uscare (doar image/jpeg, 10 MB). Politici DOAR pentru acest bucket: citire cu dreptul de citire pe
--     proiectul din cale și o uscare a ACELUI proiect; încărcare cu dreptul de scriere, uscarea DESCHISĂ și o rezervare deschisă pe ACEA cale;
--     nicio modificare / ștergere. Postcondiția verifică politicile EFECTIVE (sondă cu rolurile aplicației, anulată): un cont fără drept —
--     chiar „proprietar” al fișierului — și anon nu văd, nu modifică, nu șterg și nu încarcă nimic în bucket, oricare ar fi celelalte politici.
-- Ce NU face: nicio dată, niciun drept pe module, nicio schimbare pe tabelele / funcțiile existente (doar cheile străine spre executie_proiecte
--   și executie_probe_tronsoane: trigger-ele referențiale interne pe ele). Citește (în RPC) sites + meteo_cache, fără să le schimbe.
--   Nicio automatizare, niciun mail, nicio funcție edge (cea pentru vremea pe coordonate e doar proiectată: spec §10).
-- Depinde de 20261201a (fn_executie_nod_drept), 20261202a (executie_probe_tronsoane cu UNIQUE (id, proiect_id)), 20261209a + 20261213a
--   (restricția pe proiect), meteo_cache (meteo-sync) și sites. Verificat mai jos.
-- Ordinea lock-urilor (L06), aceeași pe toate căile: lock consultativ pe cheia apăsării -> executie_uscari FOR UPDATE -> executie_uscare_incarcari
--   FOR UPDATE -> executie_uscare_poze (FOR UPDATE / INSERT / DELETE) -> INSERT în jurnal. Lock-urile implicite: FK-urile (FOR KEY SHARE pe
--   executie_proiecte / executie_probe_tronsoane / executie_uscari / executie_uscare_incarcari), trigger-ele pozei și rezervării (FOR SHARE pe
--   raport, deja ținut mai tare). Modulul Probe pe tronsoane (20261202a) nu atinge nimic de aici: fără ciclu.
-- Lock-uri la aplicare (punct unic, NOWAIT, reîncercat cât timp nu s-a depășit 1 s de la BEGIN — bugetul se verifică și DUPĂ obținere: un lock
--   luat după prima secundă = refuz, nimic schimbat): executie_proiecte și executie_probe_tronsoane SHARE ROW EXCLUSIVE (cheile străine),
--   storage.objects ACCESS EXCLUSIVE (CREATE POLICY + sonda politicilor): oprește scurt și citirile de fișiere — de aplicat într-un moment liniștit.
-- GĂRZILE DE TIMP reale (runda 3; nu există alt plafon): transaction_timeout = 2000 ms pus de runner înainte de BEGIN (verificat în $pre$),
--   lock_timeout = 100 ms, bugetul lock-urilor de 1 s de la BEGIN (mai sus) și garda finală a runnerului. Migrarea NU fixează
--   statement_timeout și nu are alt plafon (ex. 1.500 ms): durata „sfarsit la … ms” de la final e doar afișată.
-- LIVRAREA PE PRODUCȚIE NU ÎNCAPE ÎN ACESTE GĂRZI cu runnerul de azi: amprenta globală L15 v2 se calculează ÎNAINTE și DUPĂ, în aceeași tranzacție,
--   iar pe producție un calcul durează ~1,7–2,3 s (sesiune caldă; mai mult la rece). Fără refacerea uneltei de livrare (sau o derogare aprobată
--   separat) aplicarea se oprește cu BUGET_LOCK / transaction_timeout, fără efect. Ce trebuie măsurat înainte: spec §11 „Livrarea pe producție”.
-- Revenire: supabase/revenire/20261225a_executie_uscare_ROLLBACK.sql (refuză dacă există date; verifică DEFINIȚIILE, nu doar numerele).
-- Probe: scripts/pglite/test_executie_uscare_local.mjs (PGlite, cu pașii reali L15 v2 ai runnerului) + supabase/tests/20261225a_executie_uscare_doua_sesiuni.sh
--   (DOUĂ sesiuni reale, pe clonă: creare / reîncercare, salvare / închidere, poză / închidere).
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
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tabelul lui temporar, cu tag aleator, există în schema temporară a
  -- sesiunii și a fost CREAT de tranzacția curentă: xmin-ul rândului din pg_class = xid-ul ei — o tabelă rămasă dintr-o tranzacție anterioară,
  -- chiar citită acum (și deci blocată), nu trece; doar catalogul, nimic citit sau schimbat). Fără --amprenta-globala / --diferente-globale (sau
  -- în afara runnerului) = refuz. Dovada completă rămâne runnerul + manifestul aprobat (comparația finală cu .l15.tsv).
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20261225a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regclass('public.executie_uscari') IS NOT NULL OR to_regclass('public.executie_uscare_poze') IS NOT NULL
     OR to_regclass('public.executie_uscare_jurnal') IS NOT NULL OR to_regclass('public.executie_uscare_incarcari') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_uscare\_%')
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'executie-uscare')
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'executie\_uscare\_%') THEN
    RAISE EXCEPTION '20261225a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele de care depind cheile străine și citirile RPC-urilor (tipurile citite din migrări / funcțiile care le scriu)
  FOR r IN SELECT * FROM (VALUES
      ('executie_proiecte', 'id', '^bigint$'), ('executie_probe_tronsoane', 'id', '^bigint$'), ('executie_probe_tronsoane', 'proiect_id', '^bigint$'),
      ('executie_probe_tronsoane', 'stare', '^text$'),
      ('sites', 'id', '^(integer|bigint)$'), ('sites', 'proiect_id', '^(integer|bigint)$'), ('sites', 'name', '^(text|character varying)$'),
      ('sites', 'lat', '^(numeric|double precision|real)$'), ('sites', 'lng', '^(numeric|double precision|real)$'),
      ('meteo_cache', 'site_id', '^(integer|bigint)$'), ('meteo_cache', 'curent', '^jsonb$'),
      ('meteo_cache', 'actualizat_la', '^timestamp with time zone$'), ('meteo_cache', 'sursa', '^(text|character varying)$')
    ) v(t, c, tip) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR v_tip !~ r.tip THEN
      RAISE EXCEPTION '20261225a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tip;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.executie_probe_tronsoane'::regclass AND conname = 'executie_probe_tronsoane_id_proiect_uq'
                   AND contype = 'u')
     OR to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL
     OR (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass) IS NOT TRUE
     OR to_regprocedure('auth.uid()') IS NULL
     OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid
     OR NOT pg_has_role('postgres', 'authenticated', 'USAGE') OR NOT pg_has_role('postgres', 'anon', 'USAGE') THEN
    RAISE EXCEPTION '20261225a: dependentele (UNIQUE (id, proiect_id) pe executie_probe_tronsoane, storage cu RLS, auth.uid, rolurile aplicatiei) lipsesc sau difera';
  END IF;
END $pre$;

-- ── lanțul funcțiilor de drept chemate DIRECT de politici / RPC-uri (fn_executie_nod_drept, fn_executie_contract_drept) și al celor chemate de
-- ele (listă revizuită pe corpurile din 20261209a / 20261213a, nu citită cu regex), cu amprenta corpului (fără CR) + proprietățile, ÎNAINTE și
-- DUPĂ. Garanția completă (orice altă funcție / politică / drept) e amprenta globală L15 v2 a runnerului.
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

-- ── punctul UNIC de blocare (L06), după verificările de catalog: NOWAIT, mereu în aceeași ordine; bugetul = 1 s de la BEGIN, verificat ÎNAINTE de
-- fiecare încercare și DUPĂ obținere (și pe calea fără coliziune: un lock obținut după prima secundă = refuz, nimic schimbat) ──
DO $lock$
DECLARE v_incercari integer := 0;
BEGIN
  LOOP
    IF clock_timestamp() >= now() + interval '1 second' THEN
      RAISE EXCEPTION '20261225a: BUGET_LOCK: % incercari, % ms de la BEGIN (bugetul lock-urilor e 1 s de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.executie_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.executie_probe_tronsoane IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= now() + interval '1 second' THEN
    RAISE EXCEPTION '20261225a: BUGET_LOCK: lock-urile obtinute abia la % ms de la BEGIN (% incercari; bugetul e 1 s de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari USING ERRCODE = '55P03';
  END IF;
  RAISE NOTICE '20261225a: lock la % ms de la BEGIN (% incercari)', round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari;
END $lock$;

-- ── listele și instantaneul meteo: forma exactă, verificată pe ORICE cale (CHECK) ──
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
-- cântăriri: [{nr: întreg 1–20 unic, intrare_kg / iesire_kg: număr 0,001–1000 cu cel mult 3 zecimale sau null, motiv: text 1–200 sau null}],
-- cel mult 20, chei exacte; motiv („nu se aplică”: buretele nu s-a putut cântări) exclude valorile (kg null)
CREATE FUNCTION public.fn_executie_uscare_cantariri_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'array' AND jsonb_array_length(p) <= 20
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p) e(x)
       WHERE jsonb_typeof(e.x) IS DISTINCT FROM 'object'
          OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e.x) k) IS DISTINCT FROM ARRAY['iesire_kg', 'intrare_kg', 'motiv', 'nr']
          OR jsonb_typeof(e.x -> 'nr') IS DISTINCT FROM 'number' OR (e.x ->> 'nr') !~ '^[0-9]{1,2}$' OR (e.x ->> 'nr')::int NOT BETWEEN 1 AND 20
          OR jsonb_typeof(e.x -> 'intrare_kg') NOT IN ('number', 'null') OR jsonb_typeof(e.x -> 'iesire_kg') NOT IN ('number', 'null')
          OR jsonb_typeof(e.x -> 'motiv') NOT IN ('string', 'null')
          OR (jsonb_typeof(e.x -> 'motiv') = 'string' AND (length(e.x ->> 'motiv') NOT BETWEEN 1 AND 200 OR (e.x ->> 'motiv') ~ '[[:cntrl:]]'
                                                          OR (e.x ->> 'motiv') !~ '[^[:space:]]' OR (e.x ->> 'motiv') IS DISTINCT FROM btrim(e.x ->> 'motiv')
                                                          OR jsonb_typeof(e.x -> 'intrare_kg') <> 'null' OR jsonb_typeof(e.x -> 'iesire_kg') <> 'null'))
          OR (jsonb_typeof(e.x -> 'intrare_kg') = 'number' AND ((e.x ->> 'intrare_kg')::numeric NOT BETWEEN 0.001 AND 1000
                                                               OR (e.x ->> 'intrare_kg')::numeric <> round((e.x ->> 'intrare_kg')::numeric, 3)))
          OR (jsonb_typeof(e.x -> 'iesire_kg') = 'number' AND ((e.x ->> 'iesire_kg')::numeric NOT BETWEEN 0.001 AND 1000
                                                              OR (e.x ->> 'iesire_kg')::numeric <> round((e.x ->> 'iesire_kg')::numeric, 3))))
    AND (SELECT count(DISTINCT e.x ->> 'nr') FROM jsonb_array_elements(p) e(x)) = jsonb_array_length(p)
$f$;
-- instantaneul meteo (scris DOAR de fn_executie_uscare_salveaza, din meteo_cache): chei exacte, tipurile, momentele ISO cu fus orar
CREATE FUNCTION public.fn_executie_uscare_meteo_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT p IS NULL OR (jsonb_typeof(p) = 'object'
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k)
        = ARRAY['furnizor', 'lat', 'lng', 'ora_ceruta', 'ora_observatiei', 'preluat_la', 'santier', 'site_id', 'temperatura_c', 'tip', 'vreme']
    AND p ->> 'tip' = 'santier'
    AND jsonb_typeof(p -> 'furnizor') = 'string' AND length(p ->> 'furnizor') BETWEEN 1 AND 60
    AND jsonb_typeof(p -> 'site_id') = 'number' AND (p ->> 'site_id') ~ '^[0-9]{1,18}$'
    AND jsonb_typeof(p -> 'santier') IN ('string', 'null') AND coalesce(length(p ->> 'santier'), 0) <= 200
    AND jsonb_typeof(p -> 'lat') IN ('number', 'null') AND jsonb_typeof(p -> 'lng') IN ('number', 'null')
    AND (jsonb_typeof(p -> 'lat') <> 'number' OR (p ->> 'lat')::numeric BETWEEN -90 AND 90)
    AND (jsonb_typeof(p -> 'lng') <> 'number' OR (p ->> 'lng')::numeric BETWEEN -180 AND 180)
    AND jsonb_typeof(p -> 'temperatura_c') = 'number' AND (p ->> 'temperatura_c')::numeric BETWEEN -50 AND 60
    AND (p ->> 'temperatura_c')::numeric = round((p ->> 'temperatura_c')::numeric, 1)
    AND jsonb_typeof(p -> 'vreme') IN ('string', 'null') AND coalesce(length(p ->> 'vreme'), 0) <= 120
    AND (SELECT bool_and(jsonb_typeof(p -> k) = 'string'
                         AND (p ->> k) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}(:[0-9]{2})?)$')
           FROM unnest(ARRAY['ora_ceruta', 'ora_observatiei', 'preluat_la']) k))
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_utilaje_ok(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_cantariri_ok(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_meteo_ok(jsonb) FROM PUBLIC, anon, authenticated, service_role;

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
  poz_lat numeric(8,6) CHECK (poz_lat BETWEEN -90 AND 90),
  poz_lng numeric(9,6) CHECK (poz_lng BETWEEN -180 AND 180),
  poz_sursa text CHECK (poz_sursa IN ('gps', 'traseu', 'manual')),
  poz_precizie_m numeric(7,1) CHECK (poz_precizie_m > 0 AND poz_precizie_m <= 100000),
  poz_la timestamptz,
  poz_km_m integer CHECK (poz_km_m BETWEEN 0 AND 1000000),
  poz_traseu_versiune text CHECK (poz_traseu_versiune ~ '^[0-9a-f]{64}$'),
  temperatura_c numeric(4,1) CHECK (temperatura_c BETWEEN -50 AND 60),
  temperatura_sursa text CHECK (temperatura_sursa IN ('manual', 'meteo')),
  meteo jsonb CHECK (public.fn_executie_uscare_meteo_ok(meteo)),
  vreme text CHECK (length(vreme) BETWEEN 1 AND 120),
  constructor text CHECK (length(constructor) BETWEEN 1 AND 200),
  utilaje jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (public.fn_executie_uscare_utilaje_ok(utilaje)),
  pig_metalic_buc smallint CHECK (pig_metalic_buc BETWEEN 0 AND 99),
  piston_pu_buc smallint CHECK (piston_pu_buc BETWEEN 0 AND 99),
  bureti_buc smallint CHECK (bureti_buc BETWEEN 0 AND 20),
  cantariri jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (public.fn_executie_uscare_cantariri_ok(cantariri)),
  punct_roua_c numeric(4,1) CHECK (punct_roua_c BETWEEN -100 AND 50),
  punct_roua_loc text CHECK (length(punct_roua_loc) BETWEEN 1 AND 200),
  presiune_bar numeric(5,2) CHECK (presiune_bar > 0 AND presiune_bar <= 100),
  timp_deplasare_min numeric(6,1) CHECK (timp_deplasare_min > 0 AND timp_deplasare_min <= 10000),
  piston_final_rezultat text CHECK (piston_final_rezultat IN ('uscat', 'umed')),
  poze_justificare text CHECK (length(poze_justificare) BETWEEN 1 AND 1000),
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
  -- temperatura are sursa; „meteo” = valoarea instantaneului (instantaneul poate rămâne și la sursa manuală: valoarea automată păstrată)
  CONSTRAINT executie_uscari_temperatura CHECK ((temperatura_c IS NULL) = (temperatura_sursa IS NULL)
                                                AND (temperatura_sursa IS DISTINCT FROM 'meteo'
                                                     OR (meteo IS NOT NULL AND temperatura_c = (meteo ->> 'temperatura_c')::numeric))),
  -- poziția: toată sau deloc; precizia doar la GPS (obligatorie acolo); km + versiunea traseului exact la propunerea din traseu
  CONSTRAINT executie_uscari_pozitie CHECK (
    (poz_lat IS NULL) = (poz_lng IS NULL) AND (poz_lat IS NULL) = (poz_sursa IS NULL) AND (poz_lat IS NULL) = (poz_la IS NULL)
    AND coalesce(poz_sursa = 'gps', false) = (poz_precizie_m IS NOT NULL)),
  CONSTRAINT executie_uscari_pozitie_traseu CHECK (coalesce(poz_sursa = 'traseu', false) = (poz_km_m IS NOT NULL)
                                                   AND (poz_km_m IS NULL) = (poz_traseu_versiune IS NULL)),
  CONSTRAINT executie_uscari_anulare CHECK ((stare = 'anulata') = (motiv_anulare IS NOT NULL)),
  CONSTRAINT executie_uscari_inchidere CHECK ((stare = 'inchisa') = (inchis_la IS NOT NULL) AND (inchis_la IS NULL) = (inchis_de IS NULL))
);
CREATE INDEX executie_uscari_proiect_idx ON public.executie_uscari (proiect_id, id);
CREATE INDEX executie_uscari_proba_idx ON public.executie_uscari (proba_id, proiect_id) WHERE proba_id IS NOT NULL;
COMMENT ON TABLE public.executie_uscari IS
  'Execuție: operațiunile de uscare a conductei (raportul de uscare cerut de beneficiar), pe tronson de probă sau interval de km. Scriere DOAR prin fn_executie_uscare_salveaza / _stare. 20261225a.';
COMMENT ON COLUMN public.executie_uscari.piston_final_rezultat IS 'Criteriul din caietul de sarcini (cap. 4.1.8.5): ultimul piston vehiculat iese uscat (uscat) sau nu (umed). CONFORM cere uscat + fotografia ultimului piston.';
COMMENT ON COLUMN public.executie_uscari.meteo IS 'Instantaneul meteo construit de server din vremea șantierului (furnizor, coordonate, ora cerută = ora începerii, ora observației, ora preluării, valoarea automată). Se păstrează și când omul scrie temperatura măsurată.';
COMMENT ON COLUMN public.executie_uscari.revizie IS 'De câte ori a fost redeschis raportul după închidere (0 = niciodată). Conținutul fiecărei închideri rămâne în executie_uscare_jurnal.';

-- ── evidența încărcărilor (rezervarea căii ÎNAINTE de urcarea fișierului) ──
CREATE TABLE public.executie_uscare_incarcari (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uscare_id bigint NOT NULL,
  proiect_id bigint NOT NULL,
  cale text NOT NULL CHECK (cale ~ '^[0-9]{1,18}/[0-9]{1,18}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'),
  -- CATEGORII-INCARCARI-START
  categorie text NOT NULL CHECK (categorie IN ('manometru', 'temperatura', 'pistoane', 'cantar_intrare', 'cantar_iesire', 'piston_final', 'punct_roua', 'utilaje', 'altele')),
  -- CATEGORII-INCARCARI-END
  burete_nr smallint CHECK (burete_nr BETWEEN 1 AND 20),
  legenda text CHECK (length(legenda) BETWEEN 1 AND 300),
  renuntat_motiv text CHECK (length(renuntat_motiv) BETWEEN 1 AND 300),
  renuntat_la timestamptz,
  renuntat_de uuid,
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_uscare_incarcari_uscare_fk FOREIGN KEY (uscare_id, proiect_id) REFERENCES public.executie_uscari (id, proiect_id),
  CONSTRAINT executie_uscare_incarcari_cale_uq UNIQUE (cale),
  CONSTRAINT executie_uscare_incarcari_cale_proprie CHECK (split_part(cale, '/', 1) = proiect_id::text AND split_part(cale, '/', 2) = uscare_id::text),
  CONSTRAINT executie_uscare_incarcari_burete CHECK ((burete_nr IS NOT NULL) = (categorie IN ('cantar_intrare', 'cantar_iesire'))),
  CONSTRAINT executie_uscare_incarcari_renuntare CHECK ((renuntat_la IS NULL) = (renuntat_motiv IS NULL) AND (renuntat_la IS NULL) = (renuntat_de IS NULL))
);
CREATE INDEX executie_uscare_incarcari_uscare_idx ON public.executie_uscare_incarcari (uscare_id, proiect_id, id);
CREATE INDEX executie_uscare_incarcari_proiect_idx ON public.executie_uscare_incarcari (proiect_id, id);
COMMENT ON TABLE public.executie_uscare_incarcari IS
  'Execuție: evidența fișierelor raportului de uscare — calea e rezervată ÎNAINTE de urcare (Storage cere rezervarea); o rezervare neînregistrată ca poză rămâne de lămurit (înregistrare sau renunțare consemnată); fișierul nu se șterge automat. 20261225a.';

-- ── fotografiile înregistrate (din rezervare) ──
CREATE TABLE public.executie_uscare_poze (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uscare_id bigint NOT NULL,
  proiect_id bigint NOT NULL,
  -- CATEGORII-START
  categorie text NOT NULL CHECK (categorie IN ('manometru', 'temperatura', 'pistoane', 'cantar_intrare', 'cantar_iesire', 'piston_final', 'punct_roua', 'utilaje', 'altele')),
  -- CATEGORII-END
  burete_nr smallint CHECK (burete_nr BETWEEN 1 AND 20),
  cale text NOT NULL CHECK (cale ~ '^[0-9]{1,18}/[0-9]{1,18}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'),
  legenda text CHECK (length(legenda) BETWEEN 1 AND 300),
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_uscare_poze_uscare_fk FOREIGN KEY (uscare_id, proiect_id) REFERENCES public.executie_uscari (id, proiect_id),
  CONSTRAINT executie_uscare_poze_incarcare_fk FOREIGN KEY (cale) REFERENCES public.executie_uscare_incarcari (cale),
  CONSTRAINT executie_uscare_poze_cale_uq UNIQUE (cale),
  CONSTRAINT executie_uscare_poze_cale_proprie CHECK (split_part(cale, '/', 1) = proiect_id::text AND split_part(cale, '/', 2) = uscare_id::text),
  CONSTRAINT executie_uscare_poze_burete CHECK ((burete_nr IS NOT NULL) = (categorie IN ('cantar_intrare', 'cantar_iesire')))
);
CREATE INDEX executie_uscare_poze_uscare_idx ON public.executie_uscare_poze (uscare_id, proiect_id, id);
CREATE INDEX executie_uscare_poze_proiect_idx ON public.executie_uscare_poze (proiect_id, id);
COMMENT ON TABLE public.executie_uscare_poze IS
  'Execuție: fotografiile raportului de uscare (bucket privat executie-uscare, <proiect>/<uscare>/<uuid>.jpg), pe categorii, fiecare dintr-o rezervare. Scriere DOAR prin fn_executie_uscare_poza, doar cât raportul e deschis. 20261225a.';

-- ── jurnalul (doar adăugare) ──
-- 'cheie_retrasa' (runda 3, L05): retragerea unei cereri nelămurite („Renunț”), scrisă de fn_executie_uscare_retrage DOAR dacă cheia nu era
-- în jurnal; e singurul rând fără raport (uscare_id NULL) și face orice cerere ulterioară cu acea cheie refuzată (UNIQUE pe cheie).
CREATE TABLE public.executie_uscare_jurnal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uscare_id bigint,
  proiect_id bigint NOT NULL,
  actiune text NOT NULL CHECK (actiune IN ('creare', 'salvare', 'inchidere', 'redeschidere', 'anulare', 'poza_rezervata', 'poza_adaugata', 'poza_scoasa', 'poza_renuntata', 'cheie_retrasa')),
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
  CONSTRAINT executie_uscare_jurnal_motiv CHECK ((actiune IN ('redeschidere', 'anulare', 'poza_renuntata')) = (motiv IS NOT NULL)),
  CONSTRAINT executie_uscare_jurnal_retragere CHECK ((actiune = 'cheie_retrasa') = (uscare_id IS NULL) AND (actiune <> 'cheie_retrasa' OR valori = '{}'::jsonb))
);
CREATE INDEX executie_uscare_jurnal_uscare_idx ON public.executie_uscare_jurnal (uscare_id, proiect_id, id);
CREATE INDEX executie_uscare_jurnal_proiect_idx ON public.executie_uscare_jurnal (proiect_id, id);
COMMENT ON TABLE public.executie_uscare_jurnal IS
  'Execuție: jurnalul rapoartelor de uscare (creare, salvări cu diferențele, închideri / redeschideri cu conținutul complet, anulări, rezervări, poze, renunțări, retrageri de cereri nelămurite); scris doar de RPC-urile fn_executie_uscare_*, nu se modifică. Ține cheile de idempotență. 20261225a.';

-- ── ce lipsește pentru închidere: O SINGURĂ definiție (L19), aceeași ca lipsaDinRand / pozeLipsa din src/uscareLogica.js (testul de paritate
-- citește blocurile și compară pe cazuri în proba PGlite). p_poze = fotografiile înregistrate [{categorie, burete_nr}], p_deschise = câte
-- rezervări nu sunt nici înregistrate, nici renunțate.
-- Fotografiile cerute de beneficiar (presiunea, temperatura exterioară, pistoanele, cântărirea la intrare și la ieșire) — cântăririle pe
-- FIECARE burete cântărit (cel cu „nu se aplică” nu cere poză). Lista cheilor: 'manometru', 'temperatura', 'pistoane',
-- 'cantar_intrare:<nr>', 'cantar_iesire:<nr>' (bureții în ordine).
CREATE FUNCTION public.fn_executie_uscare_poze_lipsa(u public.executie_uscari, p_poze jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  WITH cerute AS (
    SELECT o, k, cat, nr FROM (VALUES
      -- POZE-CERUTE-START
      (1, 'manometru', 'manometru', NULL::int), (2, 'temperatura', 'temperatura', NULL::int), (3, 'pistoane', 'pistoane', NULL::int)
      -- POZE-CERUTE-END
    ) v(o, k, cat, nr)
    UNION ALL
    SELECT 100 + (e.x ->> 'nr')::int * 2 + s.d, s.cat || ':' || (e.x ->> 'nr'), s.cat, (e.x ->> 'nr')::int
      FROM jsonb_array_elements(coalesce(u.cantariri, '[]'::jsonb)) e(x)
      CROSS JOIN (VALUES (0, 'cantar_intrare'), (1, 'cantar_iesire')) s(d, cat)
     WHERE jsonb_typeof(e.x -> 'motiv') IS DISTINCT FROM 'string')
  SELECT coalesce(array_agg(c.k ORDER BY c.o), '{}'::text[]) FROM cerute c
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_poze, '[]'::jsonb)) p(x)
                      WHERE p.x ->> 'categorie' = c.cat AND (c.nr IS NULL OR (p.x ->> 'burete_nr') = c.nr::text))
$f$;
CREATE FUNCTION public.fn_executie_uscare_lipsa(u public.executie_uscari, p_poze jsonb, p_deschise integer) RETURNS text[]
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
    (9, 'cantariri', u.bureti_buc IS NULL OR jsonb_array_length(u.cantariri) <> u.bureti_buc
                     OR EXISTS (SELECT 1 FROM jsonb_array_elements(u.cantariri) e(x)
                                 WHERE (e.x ->> 'nr')::int > u.bureti_buc
                                    OR (jsonb_typeof(e.x -> 'motiv') IS DISTINCT FROM 'string'
                                        AND (jsonb_typeof(e.x -> 'intrare_kg') <> 'number' OR jsonb_typeof(e.x -> 'iesire_kg') <> 'number')))),
    (10, 'presiune_bar', u.presiune_bar IS NULL),
    (11, 'timp_deplasare_min', u.timp_deplasare_min IS NULL),
    (12, 'piston_final_rezultat', u.piston_final_rezultat IS NULL),
    (13, 'concluzie', u.concluzie IS NULL),
    (14, 'dovada_conform', u.concluzie = 'conform'
                           AND (u.piston_final_rezultat IS DISTINCT FROM 'uscat'
                                OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_poze, '[]'::jsonb)) p(x) WHERE p.x ->> 'categorie' = 'piston_final'))),
    (15, 'poze_justificare', u.poze_justificare IS NULL AND cardinality(public.fn_executie_uscare_poze_lipsa(u, p_poze)) > 0),
    (16, 'incarcari_nelamurite', coalesce(p_deschise, 0) > 0)
    -- OBLIGATORII-END
  ) v(o, k, lipseste) WHERE v.lipseste
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_poze_lipsa(public.executie_uscari, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_lipsa(public.executie_uscari, jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;
-- starea pozelor / rezervărilor unui raport, citită pentru regula de mai sus (de trigger și de RPC: o singură citire, L19)
CREATE FUNCTION public.fn_executie_uscare_lipsa_raport(u public.executie_uscari) RETURNS text[]
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT public.fn_executie_uscare_lipsa(u,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('categorie', p.categorie, 'burete_nr', p.burete_nr) ORDER BY p.id), '[]'::jsonb)
       FROM public.executie_uscare_poze p WHERE p.uscare_id = u.id),
    (SELECT count(*)::int FROM public.executie_uscare_incarcari i
      WHERE i.uscare_id = u.id AND i.renuntat_la IS NULL AND NOT EXISTS (SELECT 1 FROM public.executie_uscare_poze p WHERE p.cale = i.cale)))
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_lipsa_raport(public.executie_uscari) FROM PUBLIC, anon, authenticated, service_role;

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

-- ── gărzile pe ORICE cale (L07, L08): proveniența, imuabilitatea, raportul închis ──
-- Coloanele de date ale raportului = tot rândul fără coloanele de stare / proveniență (lista de mai jos): o schimbare de stare nu le atinge.
CREATE FUNCTION public.fn_executie_uscare_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE
  v_meta constant text[] := ARRAY['stare', 'motiv_anulare', 'revizie', 'inchis_la', 'inchis_de', 'versiune', 'creat_de', 'creat_la', 'modificat_de', 'modificat_la'];
  v_lipsa text[];
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
    IF NEW.proiect_id IS DISTINCT FROM OLD.proiect_id OR NEW.id IS DISTINCT FROM OLD.id THEN
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
  IF NEW.stare = 'inchisa' THEN
    v_lipsa := public.fn_executie_uscare_lipsa_raport(NEW);
    IF cardinality(v_lipsa) > 0 THEN
      RAISE EXCEPTION 'uscare: raportul se închide doar complet (lipsesc: %)', array_to_string(v_lipsa, ', ') USING ERRCODE = '23514';
    END IF;
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
-- rezervările: se creează și se renunță la ele doar cât raportul e deschis; singura schimbare = renunțarea, o dată; nu se șterg
CREATE FUNCTION public.fn_executie_uscare_incarcare_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_stare text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'uscare: evidența încărcărilor nu se șterge' USING ERRCODE = '42501';
  END IF;
  SELECT u.stare INTO v_stare FROM public.executie_uscari u WHERE u.id = NEW.uscare_id FOR SHARE;
  IF v_stare IS DISTINCT FROM 'deschisa' THEN
    RAISE EXCEPTION 'uscare: încărcările se rezervă / se renunță doar cât raportul e deschis' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.renuntat_la IS NOT NULL OR NEW.renuntat_motiv IS NOT NULL OR NEW.renuntat_de IS NOT NULL THEN
      RAISE EXCEPTION 'uscare: o rezervare nouă nu e renunțată' USING ERRCODE = '23514';
    END IF;
    NEW.creat_de := auth.uid();
    NEW.creat_la := now();
    RETURN NEW;
  END IF;
  IF OLD.renuntat_la IS NOT NULL OR NEW.renuntat_motiv IS NULL
     OR (to_jsonb(NEW) - ARRAY['renuntat_motiv', 'renuntat_la', 'renuntat_de']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['renuntat_motiv', 'renuntat_la', 'renuntat_de'])
     OR EXISTS (SELECT 1 FROM public.executie_uscare_poze p WHERE p.cale = OLD.cale) THEN
    RAISE EXCEPTION 'uscare: la o rezervare se poate doar renunța, o dată, cu motiv (și doar dacă nu e înregistrată ca poză)' USING ERRCODE = '42501';
  END IF;
  NEW.renuntat_la := now();
  NEW.renuntat_de := auth.uid();
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
REVOKE ALL ON FUNCTION public.fn_executie_uscare_incarcare_garda() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_jurnal_garda() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_uscare_garda BEFORE INSERT OR UPDATE OR DELETE ON public.executie_uscari
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_uscare_garda();
CREATE TRIGGER trg_executie_uscare_poza_garda BEFORE INSERT OR UPDATE OR DELETE ON public.executie_uscare_poze
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_uscare_poza_garda();
CREATE TRIGGER trg_executie_uscare_incarcare_garda BEFORE INSERT OR UPDATE OR DELETE ON public.executie_uscare_incarcari
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_uscare_incarcare_garda();
CREATE TRIGGER trg_executie_uscare_jurnal_garda BEFORE INSERT OR UPDATE OR DELETE ON public.executie_uscare_jurnal
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_uscare_jurnal_garda();
-- TRUNCATE: refuzat pe toate patru (și proprietarului; revenirea scoate tabelele prin DROP, doar goale)
CREATE FUNCTION public.fn_executie_uscare_fara_golire() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  RAISE EXCEPTION 'uscare: tabelele rapoartelor de uscare nu se golesc' USING ERRCODE = '42501';
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_fara_golire() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_uscare_fara_golire BEFORE TRUNCATE ON public.executie_uscari
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_executie_uscare_fara_golire();
CREATE TRIGGER trg_executie_uscare_incarcari_fara_golire BEFORE TRUNCATE ON public.executie_uscare_incarcari
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_executie_uscare_fara_golire();
CREATE TRIGGER trg_executie_uscare_poze_fara_golire BEFORE TRUNCATE ON public.executie_uscare_poze
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_executie_uscare_fara_golire();
CREATE TRIGGER trg_executie_uscare_jurnal_fara_golire BEFORE TRUNCATE ON public.executie_uscare_jurnal
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_executie_uscare_fara_golire();

-- ── RPC 1: creare / salvare pe parcurs (L01, L02, L04, L07, L08, L09, L12, L17) ──
-- p_id NULL = raport nou (p_versiune NULL); altfel salvare cu CAS pe versiune, doar pe raport deschis.
-- p_date = TOATE câmpurile formularului (cheile EXACTE din lista CAMPURI; o cheie lipsă sau necunoscută = refuz). Valorile: text (gol = NULL),
-- numere JSON cu zecimalele permise (în plus = refuz, nu rotunjire), momente ISO cu fus orar explicit, zile AAAA-LL-ZZ, listele cu forma exactă.
-- meteo: NULL, instantaneul deja salvat (neschimbat, octet cu octet ca JSON) sau CEREREA {"cerere": "santier", "site_id": N} — instantaneul îl
--   construiește serverul din meteo_cache al unui șantier AL PROIECTULUI, pentru ora începerii (ora observației la cel mult 3 h de ea: nu se
--   propune vremea curentă pentru o operațiune trecută). Sursa „meteo” cere temperatura = valoarea instantaneului, iar instantaneul să fie
--   pentru ora începerii de acum (o oră schimbată invalidează propunerea).
-- Ordinea: identitate -> cheia revendicată (lock consultativ) -> idempotență -> rândul FOR UPDATE (la salvare) -> drept pe proiect -> CAS +
--   stare -> valori -> reguli -> scriere + jurnal. (Cheia ÎNAINTEA rândului: două apeluri cu aceeași cheie se serializează pe cheie, iar al
--   doilea vede în jurnal rezultatul primului — fără dublură la creare. Reluarea întoarce rândul doar dacă apelantul are încă drept de citire.)
-- Rezultat: {ok, duplicat, uscare} sau {ok:false, motiv:'conflict', uscare} (s-a schimbat între timp: clientul îmbină explicit).
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
  v_meteo jsonb;
  s record;
  j record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'uscare: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_proiect IS NULL OR p_cheie IS NULL OR p_date IS NULL OR jsonb_typeof(p_date) IS DISTINCT FROM 'object' OR ((p_id IS NULL) <> (p_versiune IS NULL)) THEN
    RAISE EXCEPTION 'uscare: parametri lipsă' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(20261225, hashtext(p_cheie::text));
  v_amprenta := md5(jsonb_build_object('op', 'salveaza', 'proiect', p_proiect, 'id', p_id, 'versiune', p_versiune, 'date', p_date)::text);
  -- reluarea aceleiași apăsări (aceeași cheie): același conținut = succesul de data trecută; alt conținut = eroare
  SELECT uscare_id, proiect_id, actiune, amprenta INTO j FROM public.executie_uscare_jurnal WHERE cheie = p_cheie;
  IF FOUND THEN
    IF j.actiune = 'cheie_retrasa' THEN
      RAISE EXCEPTION 'uscare: cererea a fost retrasă (Renunț) și nu se mai aplică' USING ERRCODE = '22023';
    END IF;
    IF j.amprenta IS DISTINCT FROM v_amprenta OR j.proiect_id IS DISTINCT FROM p_proiect THEN
      RAISE EXCEPTION 'uscare: cheia apăsării a fost folosită pentru altă operație' USING ERRCODE = '22023';
    END IF;
    IF NOT public.fn_executie_nod_drept(p_proiect, false) THEN
      RAISE EXCEPTION 'uscare: raportul nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('ok', true, 'duplicat', true, 'uscare', (SELECT to_jsonb(u) FROM public.executie_uscari u WHERE u.id = j.uscare_id));
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
    ('data_operatie'), ('ora_inceput'), ('ora_final'), ('poz_lat'), ('poz_lng'), ('poz_sursa'), ('poz_precizie_m'), ('poz_la'), ('poz_km_m'),
    ('poz_traseu_versiune'), ('temperatura_c'), ('temperatura_sursa'), ('meteo'), ('vreme'), ('constructor'), ('utilaje'), ('pig_metalic_buc'),
    ('piston_pu_buc'), ('bureti_buc'), ('cantariri'), ('punct_roua_c'), ('punct_roua_loc'), ('presiune_bar'), ('timp_deplasare_min'),
    ('piston_final_rezultat'), ('poze_justificare'), ('observatii'), ('concluzie'), ('semn_constructor_nume'), ('semn_constructor_functie'),
    ('semn_beneficiar_nume'), ('semn_beneficiar_functie')
    -- CAMPURI-END
   ) x(k));
  IF v_strain IS NOT NULL THEN RAISE EXCEPTION 'uscare: câmpuri necunoscute: %', v_strain USING ERRCODE = '22023'; END IF;
  -- valorile, pe tipuri (lista: cheie, tip, min, max, zecimale / lungime)
  FOR c IN SELECT * FROM (VALUES
      ('proba_id', 'id', 1, 999999999999, 0), ('tronson', 'text', NULL, NULL, 120), ('km_de_la_m', 'int', 0, 999999, 0),
      ('km_pana_la_m', 'int', 1, 1000000, 0), ('lungime_m', 'num', 0.1, 1000000, 1), ('inceput_planificat', 'moment', NULL, NULL, NULL),
      ('notificare_la', 'moment', NULL, NULL, NULL), ('notificare_ref', 'text', NULL, NULL, 300), ('data_operatie', 'zi', NULL, NULL, NULL),
      ('ora_inceput', 'moment', NULL, NULL, NULL), ('ora_final', 'moment', NULL, NULL, NULL),
      ('poz_lat', 'num', -90, 90, 6), ('poz_lng', 'num', -180, 180, 6), ('poz_sursa', 'poz_sursa', NULL, NULL, NULL),
      ('poz_precizie_m', 'num', 0.1, 100000, 1), ('poz_la', 'moment', NULL, NULL, NULL), ('poz_km_m', 'int', 0, 1000000, 0),
      ('poz_traseu_versiune', 'versiune', NULL, NULL, NULL),
      ('temperatura_c', 'num', -50, 60, 1), ('temperatura_sursa', 'sursa', NULL, NULL, NULL), ('meteo', 'meteo', NULL, NULL, NULL),
      ('vreme', 'text', NULL, NULL, 120), ('constructor', 'text', NULL, NULL, 200), ('utilaje', 'utilaje', NULL, NULL, NULL),
      ('pig_metalic_buc', 'int', 0, 99, 0), ('piston_pu_buc', 'int', 0, 99, 0), ('bureti_buc', 'int', 0, 20, 0),
      ('cantariri', 'cantariri', NULL, NULL, NULL), ('punct_roua_c', 'num', -100, 50, 1), ('punct_roua_loc', 'text', NULL, NULL, 200),
      ('presiune_bar', 'num', 0.01, 100, 2), ('timp_deplasare_min', 'num', 0.1, 10000, 1), ('piston_final_rezultat', 'piston', NULL, NULL, NULL),
      ('poze_justificare', 'textlung', NULL, NULL, 1000), ('observatii', 'textlung', NULL, NULL, 4000), ('concluzie', 'concluzie', NULL, NULL, NULL),
      ('semn_constructor_nume', 'text', NULL, NULL, 120), ('semn_constructor_functie', 'text', NULL, NULL, 120),
      ('semn_beneficiar_nume', 'text', NULL, NULL, 120), ('semn_beneficiar_functie', 'text', NULL, NULL, 120)
    ) s(k, tip, mn, mx, z) LOOP
    IF NOT p_date ? c.k THEN v_lipsa := concat_ws(', ', v_lipsa, c.k); CONTINUE; END IF;
    v_val := p_date -> c.k;
    IF jsonb_typeof(v_val) = 'null' AND c.tip NOT IN ('utilaje', 'cantariri') THEN
      v_norm := v_norm || jsonb_build_object(c.k, NULL); CONTINUE;
    END IF;
    IF c.tip IN ('text', 'textlung', 'sursa', 'concluzie', 'poz_sursa', 'piston', 'versiune') THEN
      IF jsonb_typeof(v_val) <> 'string' THEN RAISE EXCEPTION 'uscare: % trebuie să fie text', c.k USING ERRCODE = '22023'; END IF;
      v_txt := nullif(btrim(v_val #>> '{}'), '');
      IF v_txt IS NOT NULL AND ((c.tip <> 'textlung' AND v_txt ~ '[[:cntrl:]]')
                                OR (c.tip = 'textlung' AND v_txt ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
                                OR length(v_txt) > coalesce(c.z, 64)) THEN
        RAISE EXCEPTION 'uscare: % are caractere nepermise sau e prea lung (cel mult % caractere)', c.k, coalesce(c.z, 64) USING ERRCODE = '22023';
      END IF;
      IF c.tip = 'sursa' AND v_txt IS NOT NULL AND v_txt NOT IN ('manual', 'meteo') THEN RAISE EXCEPTION 'uscare: sursa temperaturii e manual sau meteo' USING ERRCODE = '22023'; END IF;
      IF c.tip = 'concluzie' AND v_txt IS NOT NULL AND v_txt NOT IN ('conform', 'neconform') THEN RAISE EXCEPTION 'uscare: concluzia e conform sau neconform' USING ERRCODE = '22023'; END IF;
      IF c.tip = 'poz_sursa' AND v_txt IS NOT NULL AND v_txt NOT IN ('gps', 'traseu', 'manual') THEN RAISE EXCEPTION 'uscare: sursa poziției e gps, traseu sau manual' USING ERRCODE = '22023'; END IF;
      IF c.tip = 'piston' AND v_txt IS NOT NULL AND v_txt NOT IN ('uscat', 'umed') THEN RAISE EXCEPTION 'uscare: rezultatul ultimului piston e uscat sau umed' USING ERRCODE = '22023'; END IF;
      IF c.tip = 'versiune' AND v_txt IS NOT NULL AND v_txt !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'uscare: versiunea traseului e amprenta sha256 (64 hex)' USING ERRCODE = '22023'; END IF;
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
        RAISE EXCEPTION 'uscare: cântăririle: listă de {nr, intrare_kg, iesire_kg, motiv} (nr 1–20 unic; kg 0,001–1000 cu cel mult 3 zecimale; motivul „nu se aplică” fără kg)' USING ERRCODE = '22023';
      END IF;
      v_norm := v_norm || jsonb_build_object(c.k, v_val);
    ELSIF c.tip = 'meteo' THEN
      -- tratat după celelalte câmpuri (are nevoie de ora începerii); aici doar forma de bază
      IF jsonb_typeof(v_val) <> 'object' THEN RAISE EXCEPTION 'uscare: meteo: instantaneul salvat sau o cerere' USING ERRCODE = '22023'; END IF;
      v_norm := v_norm || jsonb_build_object(c.k, v_val);
    END IF;
  END LOOP;
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'uscare: câmpuri lipsă: %', v_lipsa USING ERRCODE = '22023'; END IF;
  -- meteo: instantaneul vechi neschimbat sau unul NOU construit aici din meteo_cache (proveniența o pune serverul, L08)
  v_meteo := v_norm -> 'meteo';
  IF jsonb_typeof(v_meteo) = 'object' AND v_meteo ? 'cerere' THEN
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_meteo) k) IS DISTINCT FROM ARRAY['cerere', 'site_id']
       OR v_meteo ->> 'cerere' IS DISTINCT FROM 'santier' OR jsonb_typeof(v_meteo -> 'site_id') IS DISTINCT FROM 'number'
       OR (v_meteo ->> 'site_id') !~ '^[0-9]{1,18}$' THEN
      RAISE EXCEPTION 'uscare: meteo: cererea e {cerere: santier, site_id}' USING ERRCODE = '22023';
    END IF;
    IF v_norm ->> 'ora_inceput' IS NULL THEN
      RAISE EXCEPTION 'uscare: vremea se propune pentru ora începerii: completeaz-o întâi' USING ERRCODE = '22023';
    END IF;
    SELECT st.id::bigint AS site_id, st.name::text AS santier, st.lat::numeric AS lat, st.lng::numeric AS lng, mc.curent, mc.actualizat_la, mc.sursa::text AS sursa
      INTO s
      FROM public.sites st JOIN public.meteo_cache mc ON mc.site_id = st.id
     WHERE st.id = (v_meteo ->> 'site_id')::bigint AND st.proiect_id = p_proiect;
    IF NOT FOUND THEN RAISE EXCEPTION 'uscare: meteo: șantierul nu e al proiectului sau nu are vreme' USING ERRCODE = '22023'; END IF;
    IF jsonb_typeof(s.curent -> 'temp') IS DISTINCT FROM 'number' OR jsonb_typeof(s.curent -> 'la') IS DISTINCT FROM 'string'
       OR (s.curent ->> 'la') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}(:[0-9]{2})?)$' THEN
      RAISE EXCEPTION 'uscare: meteo: vremea șantierului nu are temperatura sau ora observației' USING ERRCODE = '22023';
    END IF;
    IF abs(extract(epoch FROM (s.curent ->> 'la')::timestamptz - (v_norm ->> 'ora_inceput')::timestamptz)) > 3 * 3600 THEN
      RAISE EXCEPTION 'uscare: meteo: vremea curentă a șantierului e din %, la peste 3 h de ora începerii: scrie temperatura măsurată', s.curent ->> 'la' USING ERRCODE = '22023';
    END IF;
    v_meteo := jsonb_build_object('tip', 'santier', 'furnizor', coalesce(nullif(btrim(left(s.sursa, 60)), ''), 'necunoscut'), 'site_id', s.site_id,
      'santier', left(s.santier, 200), 'lat', round(s.lat, 6), 'lng', round(s.lng, 6),
      'ora_ceruta', to_char((v_norm ->> 'ora_inceput')::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'ora_observatiei', s.curent ->> 'la', 'preluat_la', to_char(s.actualizat_la AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'temperatura_c', round((s.curent ->> 'temp')::numeric, 1), 'vreme', nullif(left(s.curent ->> 'vreme', 120), ''));
    IF NOT public.fn_executie_uscare_meteo_ok(v_meteo) THEN RAISE EXCEPTION 'uscare: meteo: datele șantierului sunt în afara domeniului' USING ERRCODE = '22023'; END IF;
    v_norm := jsonb_set(v_norm, '{meteo}', v_meteo);
  ELSIF jsonb_typeof(v_meteo) = 'object' THEN
    IF p_id IS NULL OR r.meteo IS NULL OR v_meteo IS DISTINCT FROM r.meteo THEN
      RAISE EXCEPTION 'uscare: meteo: instantaneul îl scrie doar serverul (trimite instantaneul salvat, neschimbat, sau o cerere nouă)' USING ERRCODE = '22023';
    END IF;
  END IF;
  n := jsonb_populate_record(NULL::public.executie_uscari, v_norm);
  -- regulile între câmpuri
  IF n.tronson IS NULL OR n.km_de_la_m IS NULL OR n.km_pana_la_m IS NULL THEN
    RAISE EXCEPTION 'uscare: tronsonul și intervalul de km sunt obligatorii' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL AND n.constructor IS NULL THEN
    RAISE EXCEPTION 'uscare: constructorul se confirmă la creare' USING ERRCODE = '22023';
  END IF;
  IF n.km_pana_la_m <= n.km_de_la_m THEN RAISE EXCEPTION 'uscare: intervalul de km e greșit (sfârșitul trebuie să fie după început)' USING ERRCODE = '22023'; END IF;
  IF n.ora_final IS NOT NULL AND (n.ora_inceput IS NULL OR n.ora_final <= n.ora_inceput OR n.ora_final > n.ora_inceput + interval '30 days') THEN
    RAISE EXCEPTION 'uscare: ora de final trebuie să fie după ora de început (cel mult 30 de zile)' USING ERRCODE = '22023';
  END IF;
  IF (n.temperatura_c IS NULL) <> (n.temperatura_sursa IS NULL) THEN
    RAISE EXCEPTION 'uscare: temperatura cere sursa (manual / meteo)' USING ERRCODE = '22023';
  END IF;
  IF n.temperatura_sursa = 'meteo' AND (n.meteo IS NULL OR n.temperatura_c IS DISTINCT FROM (n.meteo ->> 'temperatura_c')::numeric
                                        OR n.ora_inceput IS NULL OR (n.meteo ->> 'ora_ceruta')::timestamptz IS DISTINCT FROM n.ora_inceput) THEN
    RAISE EXCEPTION 'uscare: temperatura „din meteo” = valoarea propunerii pentru ora începerii de acum (ora sau propunerea s-au schimbat: propune din nou sau scrie temperatura măsurată)' USING ERRCODE = '22023';
  END IF;
  IF NOT ((n.poz_lat IS NULL) = (n.poz_lng IS NULL) AND (n.poz_lat IS NULL) = (n.poz_sursa IS NULL) AND (n.poz_lat IS NULL) = (n.poz_la IS NULL)
          AND coalesce(n.poz_sursa = 'gps', false) = (n.poz_precizie_m IS NOT NULL)
          AND coalesce(n.poz_sursa = 'traseu', false) = (n.poz_km_m IS NOT NULL) AND (n.poz_km_m IS NULL) = (n.poz_traseu_versiune IS NULL)) THEN
    RAISE EXCEPTION 'uscare: poziția: coordonatele, sursa și momentul împreună; precizia doar la GPS; km-ul și versiunea traseului doar la propunerea din traseu' USING ERRCODE = '22023';
  END IF;
  IF n.bureti_buc IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(n.cantariri) e(x) WHERE (e.x ->> 'nr')::int > n.bureti_buc) THEN
    RAISE EXCEPTION 'uscare: cântăririle: numărul buretelui e peste bureții declarați' USING ERRCODE = '22023';
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
      notificare_ref, data_operatie, ora_inceput, ora_final, poz_lat, poz_lng, poz_sursa, poz_precizie_m, poz_la, poz_km_m, poz_traseu_versiune,
      temperatura_c, temperatura_sursa, meteo, vreme, constructor, utilaje, pig_metalic_buc, piston_pu_buc, bureti_buc, cantariri, punct_roua_c,
      punct_roua_loc, presiune_bar, timp_deplasare_min, piston_final_rezultat, poze_justificare, observatii, concluzie, semn_constructor_nume,
      semn_constructor_functie, semn_beneficiar_nume, semn_beneficiar_functie)
    VALUES (p_proiect, n.proba_id, n.tronson, n.km_de_la_m, n.km_pana_la_m, n.lungime_m, n.inceput_planificat, n.notificare_la,
      n.notificare_ref, n.data_operatie, n.ora_inceput, n.ora_final, n.poz_lat, n.poz_lng, n.poz_sursa, n.poz_precizie_m, n.poz_la, n.poz_km_m,
      n.poz_traseu_versiune, n.temperatura_c, n.temperatura_sursa, n.meteo, n.vreme, n.constructor, n.utilaje, n.pig_metalic_buc, n.piston_pu_buc,
      n.bureti_buc, n.cantariri, n.punct_roua_c, n.punct_roua_loc, n.presiune_bar, n.timp_deplasare_min, n.piston_final_rezultat,
      n.poze_justificare, n.observatii, n.concluzie, n.semn_constructor_nume, n.semn_constructor_functie, n.semn_beneficiar_nume,
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
      data_operatie = n.data_operatie, ora_inceput = n.ora_inceput, ora_final = n.ora_final, poz_lat = n.poz_lat, poz_lng = n.poz_lng,
      poz_sursa = n.poz_sursa, poz_precizie_m = n.poz_precizie_m, poz_la = n.poz_la, poz_km_m = n.poz_km_m,
      poz_traseu_versiune = n.poz_traseu_versiune, temperatura_c = n.temperatura_c, temperatura_sursa = n.temperatura_sursa, meteo = n.meteo,
      vreme = n.vreme, constructor = n.constructor, utilaje = n.utilaje, pig_metalic_buc = n.pig_metalic_buc, piston_pu_buc = n.piston_pu_buc,
      bureti_buc = n.bureti_buc, cantariri = n.cantariri, punct_roua_c = n.punct_roua_c, punct_roua_loc = n.punct_roua_loc,
      presiune_bar = n.presiune_bar, timp_deplasare_min = n.timp_deplasare_min, piston_final_rezultat = n.piston_final_rezultat,
      poze_justificare = n.poze_justificare, observatii = n.observatii, concluzie = n.concluzie,
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
-- Ordinea: identitate -> cheia revendicată -> rândul FOR UPDATE -> drept (scriere pe proiect; redeschiderea: admin Execuție / owner cu acces la
--   proiect) -> idempotență -> CAS -> tranziție (lista albă) -> motiv -> completitudine (închidere) -> UPDATE + jurnal cu conținutul complet.
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
  PERFORM pg_advisory_xact_lock(20261225, hashtext(p_cheie::text));
  SELECT * INTO r FROM public.executie_uscari WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.fn_executie_nod_drept(r.proiect_id, true) THEN
    RAISE EXCEPTION 'uscare: raportul nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  IF p_actiune = 'redeschide' AND NOT public.fn_executie_contract_drept(r.proiect_id, true) THEN
    RAISE EXCEPTION 'uscare: redeschiderea unui raport închis cere drept de administrator pe Execuție' USING ERRCODE = '42501';
  END IF;
  v_amprenta := md5(jsonb_build_object('op', 'stare', 'id', p_id, 'versiune', p_versiune, 'actiune', p_actiune, 'motiv', v_motiv)::text);
  SELECT uscare_id, actiune, amprenta INTO j FROM public.executie_uscare_jurnal WHERE cheie = p_cheie;
  IF FOUND THEN
    IF j.actiune = 'cheie_retrasa' THEN
      RAISE EXCEPTION 'uscare: cererea a fost retrasă (Renunț) și nu se mai aplică' USING ERRCODE = '22023';
    END IF;
    IF j.amprenta = v_amprenta AND j.uscare_id = p_id THEN RETURN jsonb_build_object('ok', true, 'duplicat', true, 'uscare', to_jsonb(r)); END IF;
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
    v_lipsa := public.fn_executie_uscare_lipsa_raport(r);
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

-- ── RPC 3: fotografiile (L02, L04, L05, L07, L09) ──
-- rezerva:  ÎNAINTE de urcare: calea <proiect>/<uscare>/<uuid>.jpg + categoria, buretele (doar la cântăriri), legenda. Storage acceptă
--           fișierul doar pe o cale rezervată, neînregistrată, nerenunțată, a unui raport deschis.
-- adauga:   după urcare: calea rezervată (doar ea; categoria / buretele / legenda vin din rezervare); serverul verifică fișierul și înregistrează.
-- scoate:   rândul pozei se șterge (fișierul și rezervarea rămân, ca dovadă; jurnalul păstrează rândul).
-- renunta:  o rezervare neînregistrată (urcare eșuată / poză refăcută) se închide cu motiv (p_legenda = motivul); fișierul, dacă există, rămâne.
-- Nu schimbă versiunea raportului (formularul deschis nu intră în conflict cu pozele); închiderea blochează același rând.
-- Ordinea: identitate -> cheia revendicată -> raportul FOR UPDATE -> drept -> idempotență -> stare -> rezervarea FOR UPDATE -> poza -> jurnal.
CREATE FUNCTION public.fn_executie_uscare_poza(p_uscare bigint, p_actiune text, p_poza bigint, p_cale text, p_categorie text, p_burete_nr integer,
  p_legenda text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  u public.executie_uscari;
  p public.executie_uscare_poze;
  i public.executie_uscare_incarcari;
  v_leg text := nullif(btrim(coalesce(p_legenda, '')), '');
  v_amprenta text;
  j record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'uscare: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_uscare IS NULL OR p_cheie IS NULL OR p_actiune IS NULL OR p_actiune NOT IN ('rezerva', 'adauga', 'scoate', 'renunta')
     OR (p_actiune = 'rezerva' AND (p_poza IS NOT NULL OR p_cale IS NULL OR p_categorie IS NULL))
     OR (p_actiune = 'adauga' AND (p_poza IS NOT NULL OR p_cale IS NULL OR p_categorie IS NOT NULL OR p_burete_nr IS NOT NULL OR p_legenda IS NOT NULL))
     OR (p_actiune = 'scoate' AND (p_poza IS NULL OR p_cale IS NOT NULL OR p_categorie IS NOT NULL OR p_burete_nr IS NOT NULL OR p_legenda IS NOT NULL))
     OR (p_actiune = 'renunta' AND (p_poza IS NOT NULL OR p_cale IS NULL OR p_categorie IS NOT NULL OR p_burete_nr IS NOT NULL OR v_leg IS NULL)) THEN
    RAISE EXCEPTION 'uscare: parametri lipsă sau în plus' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(20261225, hashtext(p_cheie::text));
  SELECT * INTO u FROM public.executie_uscari WHERE id = p_uscare FOR UPDATE;
  IF NOT FOUND OR NOT public.fn_executie_nod_drept(u.proiect_id, true) THEN
    RAISE EXCEPTION 'uscare: raportul nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  v_amprenta := md5(jsonb_build_object('op', 'poza', 'uscare', p_uscare, 'actiune', p_actiune, 'poza', p_poza, 'cale', p_cale,
                                       'categorie', p_categorie, 'burete', p_burete_nr, 'legenda', v_leg)::text);
  SELECT uscare_id, actiune, amprenta INTO j FROM public.executie_uscare_jurnal WHERE cheie = p_cheie;
  IF FOUND THEN
    IF j.actiune = 'cheie_retrasa' THEN
      RAISE EXCEPTION 'uscare: cererea a fost retrasă (Renunț) și nu se mai aplică' USING ERRCODE = '22023';
    END IF;
    IF j.amprenta = v_amprenta AND j.uscare_id = p_uscare THEN
      RETURN jsonb_build_object('ok', true, 'duplicat', true,
                                'poza', (SELECT to_jsonb(x) FROM public.executie_uscare_poze x WHERE x.cale = p_cale AND x.uscare_id = p_uscare));
    END IF;
    RAISE EXCEPTION 'uscare: cheia apăsării a fost folosită pentru altă operație' USING ERRCODE = '22023';
  END IF;
  IF u.stare <> 'deschisa' THEN RAISE EXCEPTION 'uscare: raportul e % și pozele nu se mai schimbă', u.stare USING ERRCODE = '22023'; END IF;
  IF p_actiune IN ('rezerva', 'adauga', 'renunta')
     AND (p_cale !~ '^[0-9]{1,18}/[0-9]{1,18}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
          OR split_part(p_cale, '/', 1) <> u.proiect_id::text OR split_part(p_cale, '/', 2) <> u.id::text) THEN
    RAISE EXCEPTION 'uscare: calea pozei nu e a acestui raport' USING ERRCODE = '22023';
  END IF;
  IF p_actiune = 'rezerva' THEN
    IF p_categorie NOT IN ('manometru', 'temperatura', 'pistoane', 'cantar_intrare', 'cantar_iesire', 'piston_final', 'punct_roua', 'utilaje', 'altele') THEN
      RAISE EXCEPTION 'uscare: categoria pozei e necunoscută' USING ERRCODE = '22023';
    END IF;
    IF (p_burete_nr IS NOT NULL) <> (p_categorie IN ('cantar_intrare', 'cantar_iesire')) OR p_burete_nr NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'uscare: numărul buretelui (1–20) e obligatoriu la cântăriri și doar acolo' USING ERRCODE = '22023';
    END IF;
    IF length(coalesce(v_leg, '')) > 300 OR v_leg ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'uscare: legenda: cel mult 300 de caractere, un rând' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.executie_uscare_incarcari x WHERE x.cale = p_cale) THEN
      RAISE EXCEPTION 'uscare: calea e deja rezervată' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.executie_uscare_incarcari x WHERE x.uscare_id = u.id) >= 400 THEN
      RAISE EXCEPTION 'uscare: cel mult 400 de încărcări pe raport' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.executie_uscare_incarcari (uscare_id, proiect_id, cale, categorie, burete_nr, legenda)
    VALUES (u.id, u.proiect_id, p_cale, p_categorie, p_burete_nr, v_leg)
    RETURNING * INTO i;
    INSERT INTO public.executie_uscare_jurnal (uscare_id, proiect_id, actiune, valori, cheie, amprenta)
    VALUES (u.id, u.proiect_id, 'poza_rezervata', jsonb_strip_nulls(to_jsonb(i)), p_cheie, v_amprenta);
    RETURN jsonb_build_object('ok', true, 'duplicat', false, 'incarcare', to_jsonb(i));
  ELSIF p_actiune IN ('adauga', 'renunta') THEN
    SELECT * INTO i FROM public.executie_uscare_incarcari x WHERE x.cale = p_cale AND x.uscare_id = u.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'uscare: calea nu e rezervată pentru acest raport' USING ERRCODE = '22023'; END IF;
    IF i.renuntat_la IS NOT NULL THEN RAISE EXCEPTION 'uscare: s-a renunțat deja la această încărcare' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.executie_uscare_poze x WHERE x.cale = p_cale) THEN
      RAISE EXCEPTION 'uscare: poza e deja înregistrată' USING ERRCODE = '22023';
    END IF;
    IF p_actiune = 'renunta' THEN
      IF length(v_leg) > 300 OR v_leg ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'uscare: motivul: cel mult 300 de caractere, un rând' USING ERRCODE = '22023'; END IF;
      UPDATE public.executie_uscare_incarcari SET renuntat_motiv = v_leg WHERE id = i.id RETURNING * INTO i;
      INSERT INTO public.executie_uscare_jurnal (uscare_id, proiect_id, actiune, valori, motiv, cheie, amprenta)
      VALUES (u.id, u.proiect_id, 'poza_renuntata', jsonb_strip_nulls(to_jsonb(i)), v_leg, p_cheie, v_amprenta);
      RETURN jsonb_build_object('ok', true, 'duplicat', false, 'incarcare', to_jsonb(i));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'executie-uscare' AND o.name = p_cale) THEN
      RAISE EXCEPTION 'uscare: fișierul pozei nu e încărcat' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.executie_uscare_poze x WHERE x.uscare_id = u.id) >= 200 THEN
      RAISE EXCEPTION 'uscare: cel mult 200 de poze pe raport' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.executie_uscare_poze (uscare_id, proiect_id, categorie, burete_nr, cale, legenda)
    VALUES (u.id, u.proiect_id, i.categorie, i.burete_nr, i.cale, i.legenda)
    RETURNING * INTO p;
    INSERT INTO public.executie_uscare_jurnal (uscare_id, proiect_id, actiune, valori, cheie, amprenta)
    VALUES (u.id, u.proiect_id, 'poza_adaugata', jsonb_strip_nulls(to_jsonb(p)), p_cheie, v_amprenta);
    RETURN jsonb_build_object('ok', true, 'duplicat', false, 'poza', to_jsonb(p));
  END IF;
  -- scoate: ordinea copiilor (L06) = rezervarea FOR UPDATE, apoi poza FOR UPDATE (ca la adauga / renunta). Poza se caută întâi fără lock (doar
  -- calea ei; raportul e deja blocat FOR UPDATE, deci pozele lui nu se pot schimba între timp pe nicio cale), apoi se blochează în ordine.
  SELECT * INTO p FROM public.executie_uscare_poze x WHERE x.id = p_poza AND x.uscare_id = u.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'uscare: poza nu (mai) e în acest raport' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.executie_uscare_incarcari x WHERE x.cale = p.cale FOR UPDATE;
  SELECT * INTO p FROM public.executie_uscare_poze x WHERE x.id = p.id AND x.uscare_id = u.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'uscare: poza nu (mai) e în acest raport' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.executie_uscare_poze WHERE id = p.id;
  -- rezervarea pozei scoase se închide (renunțare consemnată): calea nu mai primește alt fișier și nu rămâne „nelămurită”
  UPDATE public.executie_uscare_incarcari SET renuntat_motiv = 'poză scoasă din raport' WHERE cale = p.cale AND renuntat_la IS NULL;
  INSERT INTO public.executie_uscare_jurnal (uscare_id, proiect_id, actiune, valori, cheie, amprenta)
  VALUES (u.id, u.proiect_id, 'poza_scoasa', jsonb_strip_nulls(to_jsonb(p)), p_cheie, v_amprenta);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'poza', NULL);
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_poza(bigint, text, bigint, text, text, integer, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_uscare_poza(bigint, text, bigint, text, text, integer, text, uuid) TO authenticated;

-- ── RPC 4: retragerea unei cereri nelămurite („Renunț” în ecran; L04, L05; runda 3) ──
-- O cerere al cărei rezultat e necunoscut (rețea) NU se uită pe baza markerului local: ecranul întreabă serverul DUPĂ CHEIE, sub același lock
-- consultativ ca RPC-urile (o cerere în curs cu aceeași cheie se termină întâi):
--   * cheia e în jurnal = cererea S-A APLICAT: {ok, aplicat: true, actiune, uscare_id}, nimic scris (ecranul o tratează ca reușită);
--   * cheia lipsește = se scrie în jurnal RETRAGEREA (actiune 'cheie_retrasa', fără raport): de acum orice cerere cu această cheie (inclusiv
--     cea pierdută, dacă ajunge mai târziu) e refuzată — „nu există” devine sigur și definitiv: {ok, aplicat: false, retrasa: true};
--   * cheia deja retrasă (reluarea retragerii) = același răspuns, duplicat.
-- Drept: retragerea cere scriere pe proiect (scrie în jurnalul lui); răspunsul pe o cheie existentă cere citire pe proiectul ei, iar cheia
-- trebuie să fie a ACELUIAȘI proiect (altfel 22023). Ordinea lock-urilor (L06): cheia -> jurnal (INSERT); niciun rând de raport.
CREATE FUNCTION public.fn_executie_uscare_retrage(p_proiect bigint, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  j record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'uscare: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_proiect IS NULL OR p_cheie IS NULL THEN RAISE EXCEPTION 'uscare: parametri lipsă' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(20261225, hashtext(p_cheie::text));
  SELECT uscare_id, proiect_id, actiune INTO j FROM public.executie_uscare_jurnal WHERE cheie = p_cheie;
  IF FOUND THEN
    IF NOT public.fn_executie_nod_drept(j.proiect_id, false) THEN
      RAISE EXCEPTION 'uscare: nu ai drept pe proiectul acestei cereri' USING ERRCODE = '42501';
    END IF;
    IF j.proiect_id IS DISTINCT FROM p_proiect THEN RAISE EXCEPTION 'uscare: cheia nu e a acestui proiect' USING ERRCODE = '22023'; END IF;
    IF j.actiune = 'cheie_retrasa' THEN
      RETURN jsonb_build_object('ok', true, 'duplicat', true, 'aplicat', false, 'retrasa', true);
    END IF;
    RETURN jsonb_build_object('ok', true, 'duplicat', true, 'aplicat', true, 'retrasa', false, 'actiune', j.actiune, 'uscare_id', j.uscare_id);
  END IF;
  IF NOT public.fn_executie_nod_drept(p_proiect, true) THEN
    RAISE EXCEPTION 'uscare: nu ai drept de scriere pe Execuție pentru acest proiect' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.executie_uscare_jurnal (uscare_id, proiect_id, actiune, valori, cheie, amprenta)
  VALUES (NULL, p_proiect, 'cheie_retrasa', '{}'::jsonb, p_cheie, md5(jsonb_build_object('op', 'retrage', 'proiect', p_proiect)::text));
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'aplicat', false, 'retrasa', true);
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_uscare_retrage(bigint, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_uscare_retrage(bigint, uuid) TO authenticated;

-- ── RLS + privilegii: doar citire pentru aplicație (L07); scrierea trece numai prin RPC-uri ──
ALTER TABLE public.executie_uscari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_uscare_incarcari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_uscare_poze ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_uscare_jurnal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_uscari, public.executie_uscare_incarcari, public.executie_uscare_poze, public.executie_uscare_jurnal
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_uscari, public.executie_uscare_incarcari, public.executie_uscare_poze, public.executie_uscare_jurnal
  TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.executie_uscari_id_seq, public.executie_uscare_incarcari_id_seq, public.executie_uscare_poze_id_seq,
  public.executie_uscare_jurnal_id_seq FROM PUBLIC, anon, authenticated, service_role;
-- runda 3: drepturile rămase ALTOR roluri (ex. privilegii implicite ale platformei pe obiectele noi) se retrag, ca starea să fie EXACT cea
-- declarată: pe tabele doar proprietarul + SELECT pentru authenticated / service_role; pe secvențe doar proprietarul (verificat în post și
-- în revenire). Doar pe obiectele create aici.
DO $acl$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT c.oid::regclass::text AS rel, c.relkind, e.grantee
             FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) e
            WHERE c.oid IN ('public.executie_uscari'::regclass, 'public.executie_uscare_incarcari'::regclass, 'public.executie_uscare_poze'::regclass,
                            'public.executie_uscare_jurnal'::regclass, 'public.executie_uscari_id_seq'::regclass, 'public.executie_uscare_incarcari_id_seq'::regclass,
                            'public.executie_uscare_poze_id_seq'::regclass, 'public.executie_uscare_jurnal_id_seq'::regclass)
              AND e.grantee <> c.relowner
              AND NOT (c.relkind = 'r' AND e.grantee IN ('authenticated'::regrole::oid, 'service_role'::regrole::oid)) LOOP
    EXECUTE format('REVOKE ALL ON %s %s FROM %s', CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.rel,
                   CASE WHEN r.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(r.grantee)) END);
  END LOOP;
END $acl$;
CREATE POLICY executie_uscari_citire ON public.executie_uscari FOR SELECT TO authenticated
  USING (public.fn_executie_nod_drept(proiect_id, false));
CREATE POLICY executie_uscare_incarcari_citire ON public.executie_uscare_incarcari FOR SELECT TO authenticated
  USING (public.fn_executie_nod_drept(proiect_id, false));
CREATE POLICY executie_uscare_poze_citire ON public.executie_uscare_poze FOR SELECT TO authenticated
  USING (public.fn_executie_nod_drept(proiect_id, false));
CREATE POLICY executie_uscare_jurnal_citire ON public.executie_uscare_jurnal FOR SELECT TO authenticated
  USING (public.fn_executie_nod_drept(proiect_id, false));

-- ── Storage: bucket privat, doar JPEG (clientul comprimă), 10 MB ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('executie-uscare', 'executie-uscare', false, 10485760, ARRAY['image/jpeg']);
-- cale: <proiect_id>/<uscare_id>/<uuid>.jpg; alt bucket sau altă formă = fals (CASE: conversia la bigint doar după verificarea formei).
-- Citire: dreptul de citire pe proiect + o uscare a ACELUI proiect; încărcare: dreptul de scriere + uscarea DESCHISĂ + rezervarea deschisă a căii.
-- Întoarce doar adevărat / fals despre apelant: pentru un proiect pe care apelantul nu-l vede răspunsul e fals indiferent ce există (fără oracol);
-- în proiectele pe care le vede, uscările și rezervările îi sunt oricum vizibile prin RLS.
CREATE FUNCTION public.fn_executie_uscare_obiect(p_bucket text, p_name text, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN p_bucket IS DISTINCT FROM 'executie-uscare' OR p_scriere IS NULL THEN false
    WHEN p_name ~ '^[0-9]{1,18}/[0-9]{1,18}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$' THEN
      public.fn_executie_nod_drept(split_part(p_name, '/', 1)::bigint, p_scriere)
      AND EXISTS (SELECT 1 FROM public.executie_uscari u
                   WHERE u.id = split_part(p_name, '/', 2)::bigint AND u.proiect_id = split_part(p_name, '/', 1)::bigint
                     AND (p_scriere IS FALSE OR u.stare = 'deschisa'))
      AND (p_scriere IS FALSE
           OR EXISTS (SELECT 1 FROM public.executie_uscare_incarcari i
                       WHERE i.cale = p_name AND i.renuntat_la IS NULL
                         AND NOT EXISTS (SELECT 1 FROM public.executie_uscare_poze x WHERE x.cale = p_name)))
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
DECLARE v_rel oid; v_tab text; r record;
BEGIN
  FOREACH v_tab IN ARRAY ARRAY['executie_uscari', 'executie_uscare_incarcari', 'executie_uscare_poze', 'executie_uscare_jurnal'] LOOP
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
    -- ACL-ul EXACT (runda 3): pe tabel doar proprietarul + SELECT (fără GRANT OPTION) pentru authenticated / service_role — niciun alt rol,
    -- nici PUBLIC; pe secvența de identitate doar proprietarul
    IF EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e
                WHERE c.oid = v_rel AND e.grantee <> c.relowner
                  AND NOT (e.grantee IN ('authenticated'::regrole::oid, 'service_role'::regrole::oid) AND e.privilege_type = 'SELECT' AND NOT e.is_grantable))
       OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND attacl IS NOT NULL)
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) rol, unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) drept
                   WHERE has_sequence_privilege(rol, pg_get_serial_sequence('public.' || v_tab, 'id'), drept))
       OR EXISTS (SELECT 1 FROM pg_class s CROSS JOIN LATERAL aclexplode(coalesce(s.relacl, acldefault('s', s.relowner))) e
                   WHERE s.oid = pg_get_serial_sequence('public.' || v_tab, 'id')::regclass AND e.grantee <> s.relowner)
       OR pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = pg_get_serial_sequence('public.' || v_tab, 'id')::regclass)) IS DISTINCT FROM 'postgres'
       OR pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = v_rel)) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION '20261225a post: privilegii (alte roluri / PUBLIC / coloane / secventa / proprietar) pe %', v_tab;
    END IF;
  END LOOP;
  -- funcțiile: limbaj, DEFINER, search_path fix, proprietar, EXECUTE exact (RPC-urile + predicatul Storage: doar authenticated; restul: nimeni)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_executie_uscare_utilaje_ok(jsonb)', 'sql', false, false),
      ('public.fn_executie_uscare_cantariri_ok(jsonb)', 'sql', false, false),
      ('public.fn_executie_uscare_meteo_ok(jsonb)', 'sql', false, false),
      ('public.fn_executie_uscare_poze_lipsa(public.executie_uscari, jsonb)', 'sql', false, false),
      ('public.fn_executie_uscare_lipsa(public.executie_uscari, jsonb, integer)', 'sql', false, false),
      ('public.fn_executie_uscare_lipsa_raport(public.executie_uscari)', 'sql', false, false),
      ('public.fn_executie_uscare_tranzitie(text, text)', 'sql', false, false),
      ('public.fn_executie_uscare_garda()', 'plpgsql', false, false),
      ('public.fn_executie_uscare_poza_garda()', 'plpgsql', false, false),
      ('public.fn_executie_uscare_incarcare_garda()', 'plpgsql', false, false),
      ('public.fn_executie_uscare_jurnal_garda()', 'plpgsql', false, false),
      ('public.fn_executie_uscare_fara_golire()', 'plpgsql', false, false),
      ('public.fn_executie_uscare_salveaza(bigint, bigint, integer, jsonb, uuid)', 'plpgsql', true, true),
      ('public.fn_executie_uscare_stare(bigint, integer, text, text, uuid)', 'plpgsql', true, true),
      ('public.fn_executie_uscare_poza(bigint, text, bigint, text, text, integer, text, uuid)', 'plpgsql', true, true),
      ('public.fn_executie_uscare_obiect(text, text, boolean)', 'sql', true, true),
      ('public.fn_executie_uscare_retrage(bigint, uuid)', 'plpgsql', true, true)
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
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_uscare\_%') <> 17 THEN
    RAISE EXCEPTION '20261225a post: numarul functiilor fn_executie_uscare_* difera de 17';
  END IF;
  -- trigger-ele: forma exactă (funcția, evenimentele, fără WHEN / argumente / coloane), active, singurele ne-interne de pe tabele
  IF (SELECT count(*) FROM pg_trigger tg JOIN (VALUES
        ('public.executie_uscari'::regclass, 'trg_executie_uscare_garda', 'public.fn_executie_uscare_garda()'::regprocedure, 1 | 2 | 4 | 8 | 16),
        ('public.executie_uscare_poze'::regclass, 'trg_executie_uscare_poza_garda', 'public.fn_executie_uscare_poza_garda()'::regprocedure, 1 | 2 | 4 | 8 | 16),
        ('public.executie_uscare_incarcari'::regclass, 'trg_executie_uscare_incarcare_garda', 'public.fn_executie_uscare_incarcare_garda()'::regprocedure, 1 | 2 | 4 | 8 | 16),
        ('public.executie_uscare_jurnal'::regclass, 'trg_executie_uscare_jurnal_garda', 'public.fn_executie_uscare_jurnal_garda()'::regprocedure, 1 | 2 | 4 | 8 | 16),
        ('public.executie_uscari'::regclass, 'trg_executie_uscare_fara_golire', 'public.fn_executie_uscare_fara_golire()'::regprocedure, 2 | 32),
        ('public.executie_uscare_incarcari'::regclass, 'trg_executie_uscare_incarcari_fara_golire', 'public.fn_executie_uscare_fara_golire()'::regprocedure, 2 | 32),
        ('public.executie_uscare_poze'::regclass, 'trg_executie_uscare_poze_fara_golire', 'public.fn_executie_uscare_fara_golire()'::regprocedure, 2 | 32),
        ('public.executie_uscare_jurnal'::regclass, 'trg_executie_uscare_jurnal_fara_golire', 'public.fn_executie_uscare_fara_golire()'::regprocedure, 2 | 32)
      ) a(rel, nume, fn, tip) ON tg.tgrelid = a.rel AND tg.tgname = a.nume
     WHERE NOT tg.tgisinternal AND tg.tgfoid = a.fn AND tg.tgtype = a.tip AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0
       AND coalesce(array_length(tg.tgattr::int2[], 1), 0) = 0) <> 8
     OR (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
          AND tgrelid IN ('public.executie_uscari'::regclass, 'public.executie_uscare_incarcari'::regclass, 'public.executie_uscare_poze'::regclass,
                          'public.executie_uscare_jurnal'::regclass)) <> 8 THEN
    RAISE EXCEPTION '20261225a post: trigger-ele';
  END IF;
  -- Storage: bucket privat, doar JPEG; cele două politici ale lui, în forma exactă
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'executie-uscare' AND public IS FALSE AND file_size_limit = 10485760
                   AND allowed_mime_types = ARRAY['image/jpeg'])
     OR NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = 'storage.objects'::regclass AND pol.polname = 'executie_uscare_citire'
                      AND pol.polcmd = 'r' AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid] AND pol.polwithcheck IS NULL
                      AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%fn_executie_uscare_obiect(bucket_id, name, false)%')
     OR NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = 'storage.objects'::regclass AND pol.polname = 'executie_uscare_adauga'
                      AND pol.polcmd = 'a' AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid] AND pol.polqual IS NULL
                      AND pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%fn_executie_uscare_obiect(bucket_id, name, true)%') THEN
    RAISE EXCEPTION '20261225a post: bucket privat / politicile storage';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_uscari) OR EXISTS (SELECT 1 FROM public.executie_uscare_poze) OR EXISTS (SELECT 1 FROM public.executie_uscare_incarcari)
     OR EXISTS (SELECT 1 FROM public.executie_uscare_jurnal) OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'executie-uscare') THEN
    RAISE EXCEPTION '20261225a post: migrarea nu scrie date';
  END IF;
END $post$;

-- ── postcondiția Storage pe politicile EFECTIVE (TOATE politicile de pe storage.objects, oricum ar fi scrise): o SONDĂ, anulată integral ──
-- O copie TEMPORARĂ a lui storage.objects (aceleași coloane, inclusiv cele generate, ex. path_tokens) primește EXACT politicile de pe
-- storage.objects (citite din catalog: comanda, permisivă / restrictivă, rolurile, expresiile — deci și ale noastre și orice politică generică
-- ce nu numește bucket-ul) și EXACT drepturile pe tabel ale rolurilor anon / authenticated (fiecare drept pe rând: o copie cu drepturi pe care
-- tabelul real nu le dă ar produce refuzuri false). Runda 3 (verdict P1-2): identități și rânduri REPREZENTATIVE —
--   * identitățile: anonim; un cont sintetic fără niciun drept; conturi REALE citite din profiles / user_module_access / executie_acces_proiect
--     (doar citire; câte primul după id): owner, admin / editor / viewer pe Execuție, cont restrâns pe proiect (executie_acces_proiect);
--   * pentru fiecare identitate, fișiere în bucket ALE EI (owner = owner_id = identitatea, cu metadate ca la o încărcare reală), pe două căi de
--     formă validă: proiectul 0 (inexistent) și un proiect pe care identitatea ÎL VEDE (fn_executie_nod_drept), cu uscarea 0 (inexistentă);
--   * ca fiecare identitate (rolul ei + JWT-ul ei): citirea trebuie să vadă 0 rânduri; modificarea și ștergerea FĂRĂ filtru (cu filtru,
--     PostgreSQL aplică și politicile SELECT și ar ascunde o politică generică) nu trebuie să atingă niciun rând; încărcarea în bucket — cu
--     owner / owner_id = identitatea și metadate, și fără proprietar, pe ambele căi — trebuie refuzată.
-- La aplicare nu există nicio uscare / rezervare, deci politicile modulului nu deschid NIMIC nimănui: orice deschidere vine din altă politică
-- (ex. contraexemplul din review: FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid()::text)) și oprește migrarea, nimic comis.
-- Drepturi pe COLOANE pe storage.objects pentru anon / authenticated (fără dreptul pe tabel) = refuz explicit: sonda nu le reproduce, se
-- revizuiesc de om. Costul nu depinde de mărimea lui storage.objects (copia are câteva rânduri; identitățile = cel mult 7). Totul într-un
-- sub-bloc anulat la final prin excepția proprie (prinsă): copia, funcția ajutătoare, rolul și JWT-ul dispar. Ce NU acoperă: politici care se
-- deschid doar pentru o uscare / rezervare EXISTENTĂ (la aplicare nu există) și trigger-ele lui storage.objects — acelea sunt în amprenta
-- globală L15 v2 (familiile politica / trigger), revizuite în PR-ul de baseline; pe clonă se probează și cu date (spec §11).
DO $sonda$
DECLARE
  v_fara constant uuid := '00000000-0000-4000-8000-00000000c0de';
  v_rau text := '';
  v_n bigint;
  v_proiect bigint;
  v_cols text[];
  v_ids jsonb := '[]'::jsonb;
  v_inainte jsonb;
  v_dupa jsonb;
  v_k text;
  v_nume text;
  v_i integer := 0;
  v_probate text := '';
  p record;
  x record;
  v_nr integer := 0;
BEGIN
  BEGIN
    -- drepturile pe coloane fără dreptul pe tabel nu se reproduc: refuz explicit (revizuire de om)
    FOR x IN SELECT r.rol, d.drept FROM unnest(ARRAY['anon', 'authenticated']) r(rol), unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']) d(drept)
              WHERE NOT has_table_privilege(r.rol, 'storage.objects', d.drept) AND has_any_column_privilege(r.rol, 'storage.objects', d.drept) LOOP
      v_rau := v_rau || x.rol || ' are drept ' || x.drept || ' doar pe coloane (sonda nu il reproduce: revizuire manuala); ';
    END LOOP;
    CREATE TEMP TABLE sonda_obiecte_20261225a (LIKE storage.objects INCLUDING GENERATED) ON COMMIT DROP;
    -- copia ține doar coloanele (fără NOT NULL: rândurile sondei au doar ce citesc politicile)
    FOR p IN SELECT attname FROM pg_attribute WHERE attrelid = 'pg_temp.sonda_obiecte_20261225a'::regclass AND attnum > 0 AND NOT attisdropped AND attnotnull LOOP
      EXECUTE format('ALTER TABLE pg_temp.sonda_obiecte_20261225a ALTER COLUMN %I DROP NOT NULL', p.attname);
    END LOOP;
    SELECT array_agg(attname::text) INTO v_cols FROM pg_attribute
     WHERE attrelid = 'pg_temp.sonda_obiecte_20261225a'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '';
    -- un fișier ca la o încărcare reală: coloanele existente din (id, bucket_id, name, owner, owner_id, metadata, user_metadata, version);
    -- rulează cu drepturile APELANTULUI (rolul probat), deci politicile INSERT se aplică
    CREATE FUNCTION pg_temp.sonda_rand_20261225a(p_cols text[], p_nume text, p_uid uuid, p_meta boolean) RETURNS void
    LANGUAGE plpgsql AS $r$
    DECLARE v_c text[] := ARRAY['bucket_id', 'name']; v_v text[] := ARRAY[quote_literal('executie-uscare'), quote_literal(p_nume)];
    BEGIN
      IF 'id' = ANY (p_cols) THEN v_c := v_c || 'id'::text; v_v := v_v || quote_literal(md5(p_nume)::uuid::text); END IF;
      IF 'owner' = ANY (p_cols) THEN v_c := v_c || 'owner'::text; v_v := v_v || quote_nullable(p_uid::text); END IF;
      IF 'owner_id' = ANY (p_cols) THEN v_c := v_c || 'owner_id'::text; v_v := v_v || quote_nullable(p_uid::text); END IF;
      IF p_meta AND 'metadata' = ANY (p_cols) THEN
        v_c := v_c || 'metadata'::text;
        v_v := v_v || quote_literal('{"eTag": "0", "size": 123456, "mimetype": "image/jpeg", "cacheControl": "max-age=3600", "contentLength": 123456, "httpStatusCode": 200}');
      END IF;
      IF p_meta AND 'user_metadata' = ANY (p_cols) THEN v_c := v_c || 'user_metadata'::text; v_v := v_v || quote_literal('{}'); END IF;
      IF p_meta AND 'version' = ANY (p_cols) THEN v_c := v_c || 'version'::text; v_v := v_v || quote_literal(md5('v' || p_nume)); END IF;
      EXECUTE format('INSERT INTO pg_temp.sonda_obiecte_20261225a (%s) VALUES (%s)',
                     (SELECT string_agg(quote_ident(c), ', ') FROM unnest(v_c) c), array_to_string(v_v, ', '));
    END $r$;
    ALTER TABLE pg_temp.sonda_obiecte_20261225a ENABLE ROW LEVEL SECURITY;
    -- drepturile EXACTE ale rolurilor aplicației pe storage.objects, fiecare pe rând
    FOR x IN SELECT r.rol, d.drept FROM unnest(ARRAY['anon', 'authenticated']) r(rol), unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) d(drept)
              WHERE has_table_privilege(r.rol, 'storage.objects', d.drept) LOOP
      EXECUTE format('GRANT %s ON pg_temp.sonda_obiecte_20261225a TO %I', x.drept, x.rol);
    END LOOP;
    FOR p IN SELECT pol.polname, pol.polcmd, pol.polpermissive, pg_get_expr(pol.polqual, pol.polrelid) AS q, pg_get_expr(pol.polwithcheck, pol.polrelid) AS c,
                    (SELECT string_agg(CASE WHEN r.oid = 0 THEN 'public' ELSE quote_ident(pg_get_userbyid(r.oid)) END, ', ')
                       FROM unnest(pol.polroles) r(oid)) AS roluri
               FROM pg_policy pol WHERE pol.polrelid = 'storage.objects'::regclass ORDER BY pol.polname LOOP
      v_nr := v_nr + 1;
      EXECUTE format('CREATE POLICY %I ON pg_temp.sonda_obiecte_20261225a AS %s FOR %s TO %s%s%s', 'sonda_' || v_nr,
        CASE WHEN p.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
        p.roluri, CASE WHEN p.q IS NULL THEN '' ELSE ' USING (' || p.q || ')' END, CASE WHEN p.c IS NULL THEN '' ELSE ' WITH CHECK (' || p.c || ')' END);
    END LOOP;
    IF v_nr <> (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass)
       OR v_nr <> (SELECT count(*) FROM pg_policy WHERE polrelid = 'pg_temp.sonda_obiecte_20261225a'::regclass) THEN
      RAISE EXCEPTION '20261225a post: sonda storage: politicile nu s-au copiat toate';
    END IF;
    -- identitățile (doar citite): eticheta, rolul, contul; proiectul văzut se calculează mai jos, cu JWT-ul fiecăreia
    v_proiect := (SELECT min(e.id) FROM public.executie_proiecte e);
    v_ids := jsonb_build_array(jsonb_build_object('e', 'anonim', 'rol', 'anon', 'uid', NULL),
                               jsonb_build_object('e', 'cont fara drept', 'rol', 'authenticated', 'uid', v_fara));
    FOR x IN
      SELECT 'owner' AS e, (SELECT pr.id FROM public.profiles pr WHERE pr.is_owner IS TRUE ORDER BY pr.id LIMIT 1) AS uid
      UNION ALL SELECT 'admin Executie', (SELECT u.profile_id FROM public.user_module_access u WHERE u.module = 'executie' AND u.access_level = 'admin' ORDER BY u.profile_id LIMIT 1)
      UNION ALL SELECT 'editor Executie', (SELECT u.profile_id FROM public.user_module_access u WHERE u.module = 'executie' AND u.access_level = 'editor' ORDER BY u.profile_id LIMIT 1)
      UNION ALL SELECT 'viewer Executie', (SELECT u.profile_id FROM public.user_module_access u WHERE u.module = 'executie' AND u.access_level = 'viewer' ORDER BY u.profile_id LIMIT 1)
      UNION ALL SELECT 'cont restrans pe proiect', (SELECT a.profile_id FROM public.executie_acces_proiect a ORDER BY a.profile_id, a.proiect_id LIMIT 1)
    LOOP
      IF x.uid IS NOT NULL THEN
        v_ids := v_ids || jsonb_build_array(jsonb_build_object('e', x.e, 'rol', 'authenticated', 'uid', x.uid));
      END IF;
    END LOOP;
    -- fișierele fiecărei identități, scrise ca postgres: proiectul 0 + un proiect pe care identitatea îl vede
    FOR x IN SELECT o.ord, o.v ->> 'e' AS e, o.v ->> 'rol' AS rol, (o.v ->> 'uid')::uuid AS uid FROM jsonb_array_elements(v_ids) WITH ORDINALITY o(v, ord) LOOP
      PERFORM set_config('request.jwt.claim.sub', coalesce(x.uid::text, ''), true);
      PERFORM set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', x.uid, 'role', x.rol))::text, true);
      v_k := coalesce((SELECT min(e.id) FROM public.executie_proiecte e WHERE x.uid IS NOT NULL AND public.fn_executie_nod_drept(e.id, false))::text,
                      coalesce(v_proiect::text, '0'));
      v_ids := jsonb_set(v_ids, ARRAY[(x.ord - 1)::text, 'p'], to_jsonb(v_k));
      v_probate := v_probate || x.e || '; ';
      FOREACH v_nume IN ARRAY ARRAY['0', v_k] LOOP
        v_i := v_i + 1;
        PERFORM pg_temp.sonda_rand_20261225a(v_cols, format('%s/0/00000000-0000-4000-8000-%s.jpg', v_nume, lpad(to_hex(v_i), 12, '0')), x.uid, true);
      END LOOP;
    END LOOP;
    -- ca fiecare identitate: citire, modificare și ștergere FĂRĂ filtru, încărcare (cu și fără proprietar, pe ambele căi)
    FOR x IN SELECT o.v ->> 'e' AS e, o.v ->> 'rol' AS rol, (o.v ->> 'uid')::uuid AS uid, o.v ->> 'p' AS p FROM jsonb_array_elements(v_ids) o(v) LOOP
      PERFORM set_config('request.jwt.claim.sub', coalesce(x.uid::text, ''), true);
      PERFORM set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', x.uid, 'role', x.rol))::text, true);
      SELECT coalesce(jsonb_object_agg(name, ctid::text), '{}'::jsonb) INTO v_inainte FROM pg_temp.sonda_obiecte_20261225a;
      IF x.rol = 'authenticated' THEN SET LOCAL ROLE authenticated; ELSE SET LOCAL ROLE anon; END IF;
      BEGIN
        SELECT count(*) INTO v_n FROM pg_temp.sonda_obiecte_20261225a WHERE bucket_id = 'executie-uscare';
        IF v_n <> 0 THEN v_rau := v_rau || x.e || ' vede ' || v_n || '; '; END IF;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
      BEGIN
        UPDATE pg_temp.sonda_obiecte_20261225a SET owner = x.uid;     -- valoare constantă (proprietarul = apelantul): nu citește coloane
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
      BEGIN
        DELETE FROM pg_temp.sonda_obiecte_20261225a;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
      FOREACH v_nume IN ARRAY ARRAY['0', x.p] LOOP
        FOREACH v_k IN ARRAY ARRAY['proprietar', 'fara proprietar'] LOOP
          v_i := v_i + 1;
          BEGIN
            PERFORM pg_temp.sonda_rand_20261225a(v_cols, format('%s/0/00000000-0000-4000-8000-%s.jpg', v_nume, lpad(to_hex(v_i), 12, '0')),
                                                 CASE WHEN v_k = 'proprietar' THEN x.uid END, v_k = 'proprietar');
            v_rau := v_rau || x.e || ' incarca (' || CASE WHEN v_nume = '0' THEN 'proiect inexistent' ELSE 'proiect vazut' END || ', ' || v_k || '); ';
          EXCEPTION WHEN insufficient_privilege THEN NULL;
          END;
        END LOOP;
      END LOOP;
      RESET ROLE;
      -- efectul, constatat ca postgres: un rând dispărut = șters; altă versiune a rândului (ctid) = modificat
      SELECT coalesce(jsonb_object_agg(name, ctid::text), '{}'::jsonb) INTO v_dupa FROM pg_temp.sonda_obiecte_20261225a;
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_inainte) k WHERE NOT v_dupa ? k) THEN v_rau := v_rau || x.e || ' sterge; '; END IF;
      IF EXISTS (SELECT 1 FROM jsonb_each_text(v_inainte) a WHERE v_dupa ? a.key AND v_dupa ->> a.key IS DISTINCT FROM a.value) THEN
        v_rau := v_rau || x.e || ' modifica; ';
      END IF;
    END LOOP;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'sonda:' || v_probate || '|' || v_rau;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    v_probate := split_part(substr(SQLERRM, length('sonda:') + 1), '|', 1);
    v_rau := substr(SQLERRM, length('sonda:') + 1 + length(v_probate) + 1);
  END;
  IF current_user IS DISTINCT FROM 'postgres' OR to_regclass('pg_temp.sonda_obiecte_20261225a') IS NOT NULL
     OR to_regprocedure('pg_temp.sonda_rand_20261225a(text[], text, uuid, boolean)') IS NOT NULL THEN
    RAISE EXCEPTION '20261225a post: sonda storage nu s-a anulat';
  END IF;
  IF v_rau <> '' THEN
    RAISE EXCEPTION '20261225a post: politicile EFECTIVE de pe storage.objects deschid bucket-ul executie-uscare: %', v_rau;
  END IF;
  RAISE NOTICE '20261225a: sonda storage: identitati probate: %', v_probate;
END $sonda$;

-- L15: același lanț DUPĂ schimbare, garda finală, timpul, apoi funcția pg_temp se șterge
DO $l15_dupa$ BEGIN
  PERFORM pg_temp.lant_20261225a('dupa');
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261225a_executie_uscare:' || txid_current() OR current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION '20261225a: garda final invalida';
  END IF;
  RAISE NOTICE '20261225a: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $l15_dupa$;
DROP FUNCTION pg_temp.lant_20261225a(text);
