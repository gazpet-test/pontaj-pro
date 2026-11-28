-- Version 20270115130000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 15000 --plafon-extins --amprenta-globala <md5> --diferente-globale
--   PLAFONUL EXTINS (15000 ms, doar în fereastra 21:00–06:00 Europe/Bucharest, docs/LIVRARE_L15_V2.md §9): aceeași amprentă globală L15 v2 ca la
--   20270114a, a cărei probă cu ROLLBACK pe producție a depășit plafonul standard de 5000 ms (decizia proprietarului 27.11.2026).
--   supabase/migrations/20270115b_izometrie_ndt_citiri.l15.tsv (manifestul îl generează coordonatorul pe clonă, docs/LIVRARE_L15_V2.md §5).
--   Numărul: 20270115a e deja folosit pe branch-ul ofertare/clarificari-puncte-citire (versiunea 20270115120000) → 20270115b.
-- 20270115b_izometrie_ndt_citiri — Izometrie, buletine NDT: (A) citirile AI păstrate pe server, cu cheie de cerere; (B) amprenta pachetului
--   calculată de server și verificată la înregistrarea exportului. Aprobat de proprietar 28.11.2026; review-urile care le-au cerut:
--   PR #1217 r1 (citirea plătită fără idempotență), PR #1218 r1 (citirea doar în ecran), PR #1219 r1–r2 (pachetul neverificat de server).
-- Ce face:
--   * Tabel NOU public.sud_citiri (prefix sud_, NICIUN FK spre executie_* / izo_*, niciun ALTER pe ele): o cerere de citire AI a unui buletin
--     ciornă = un rând, cu cheia de cerere (UUID generat de ecran, refolosit la reluare, L04) unică. Stările: in_curs (rezervată înaintea
--     apelului plătit) → gata (citirea validată) | esuat (cod de eroare + costul). Clienții au DOAR SELECT (RLS: fn_sud_drept 'citire').
--   * fn_sud_citire_rezerva(buletin, tip, model, cheie) (DEFINER, drept 'scriere'): cheia existentă = aceeași cerere → întoarce starea ei
--     (citirea salvată, fără al doilea apel AI și fără a doua rezervare de plafon); cheie nouă → rând in_curs, doar pe un buletin ciornă,
--     fără altă cerere in_curs proaspătă pe același buletin, cel mult 5 cereri care costă pe buletin. Totul sub lock pe buletin (L01).
--   * fn_sud_citire_salveaza(cheie, citire, cost, cost_cunoscut, eroare) (DEFINER): închide cererea proprie in_curs: gata (citirea trece
--     fn_sud_citire_valida, buletinul încă ciornă) sau esuat (codul de eroare). Repetarea identică = același id (reluare după rețea, L05).
--   * fn_sud_citire_valida(citire) (IMMUTABLE, pură): forma exactă scoasă de valideazaCitireNdt din funcția edge (paritate: cazurile din
--     supabase/tests/20270115b_citiri_cazuri.json, rulate pe ambele părți). NULL = validă, altfel motivul.
--   * fn_sud_amprenta_pachet(pachet) (STABLE, DEFINER, drept 'export'): md5 canonic pe pachet (id, proiect, tronson, updated_at ca epoch,
--     km_start_m, revizie, cod_document_full) + rândurile lui din executie_tevi (aceleași câmpuri ca amprentaRanduri din src/lib/izoExportIzo.js).
--   * fn_sud_export_inregistreaza: CREATE OR REPLACE, aceeași semnătură și același corp ca 20270114a, plus: fotografia trebuie să aibă
--     amprenta_pachet (32 hex), iar serverul o recalculează sub lock-ul pachetului; diferită = 40001 („pachet” în lista surselor schimbate).
-- Identitate: auth.uid() obligatoriu în fiecare funcție; autorul, momentele, starea le pune serverul. Funcția edge cheamă rezervarea și
--   salvarea cu JWT-ul apelantului (nu service_role). Limită declarată: citirea salvată e declarată de apelant (MP-ul o poate oricum înlocui
--   cu rânduri manuale la confirmare); serverul îi verifică forma și legătura cu buletinul, nu proveniența de la modelul AI.
-- Concurență (L06): rezervarea și salvarea iau ÎNTÂI buletinul FOR UPDATE, apoi rândul cererii; înregistrarea exportului: pachetul FOR UPDATE
--   → deblocarea FOR UPDATE; sursele (buletine, eliminate, metode, pachet + rânduri) doar citite — o schimbare după verificare = „export depășit”.
-- Revenire: supabase/revenire/20270115b_izometrie_ndt_citiri_ROLLBACK.sql (refuză dacă sud_citiri are rânduri; repune corpul 20270114a).
-- Probe: scripts/pglite/test_izometrie_ndt_citiri_local.mjs (pe 20270114a aplicată).
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270115b_izometrie_ndt_citiri:' || txid_current() THEN
    RAISE EXCEPTION '20270115b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270115b: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270115b: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270115b: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '15000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '15000:' || txid_current() THEN
    RAISE EXCEPTION '20270115b: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 15000/session pus de runner inainte de BEGIN: livrare_migrare.sh --plafon-tranzactie-ms 15000 --plafon-extins)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270115b: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.executie_pachete_lansare') IS NULL OR to_regclass('public.executie_tevi') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION '20270115b: dependente lipsa (executie_pachete_lansare, executie_tevi, profiles, auth.uid)';
  END IF;
  -- 20270114a aplicată EXACT: cele 6 tabele și 11 funcții sud_, nimic în plus, iar corpurile pe care se sprijină această migrare (dreptul,
  -- înregistrarea exportului care se înlocuiește) = cele din 20270114a (md5 pe prosrc fără CR) + DEFINER, calea, proprietarul, EXECUTE-ul clienților
  IF (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname IN
        ('sud_metode_proiect', 'sud_buletine', 'sud_buletin_randuri', 'sud_suduri_eliminate', 'sud_export_deblocari', 'sud_exporturi')) <> 6
     OR (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'sud\_%' AND c.relkind = 'r') <> 6
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_sud\_%') <> 11 THEN
    RAISE EXCEPTION '20270115b: starea 20270114a lipseste sau are obiecte sud_ in plus (reaplicare?)';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES
          ('public.fn_sud_drept(bigint, text)', 'b95f48de906c9d0047579ca69e961349'),
          ('public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text)', '6ed3ac6e346c9d9e53fd8b3178874a4a')) a(semnatura, amprenta)
        LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
        WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
           OR p.prosecdef IS NOT TRUE OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
           OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
           OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
           OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '20270115b: fn_sud_drept / fn_sud_export_inregistreaza nu sunt cele din 20270114a';
  END IF;
  -- lanțul de drept chemat de fn_sud_drept (L15: callee tranzitive) = constantele revizuite din 20270114a
  IF EXISTS (SELECT 1 FROM (VALUES
          ('public.fn_executie_proiect_permis(bigint, boolean)', 'bd4320f76e9f36f492c7186c0a982155', true, true, 'boolean'),
          ('public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1', true, true, 'boolean'),
          ('public.fn_executie_acces_nerestrans_cont(uuid)', '9a07e0089139e54ba5c6a0cfaaf093cc', false, false, 'boolean'),
          ('public.fn_executie_acces_lista(boolean)', 'd9e123a46b83530a7203d4a24da5cf9b', true, false, 'bigint[]'),
          ('public.fn_executie_acces_lista_cont(uuid, boolean)', 'e7cf9b852002a1c1cbe781772c33bf0c', false, false, 'bigint[]'),
          ('public.fn_executie_pachete_acces(boolean)', 'c7ea33f39d888cb40d065ff4d02dd7b1', true, true, 'boolean')) a(semnatura, amprenta, definer, cu_auth, tip)
        LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
        WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
           OR p.prolang IS DISTINCT FROM (SELECT l.oid FROM pg_language l WHERE l.lanname = 'sql')
           OR p.prosecdef IS DISTINCT FROM a.definer OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
           OR p.provolatile IS DISTINCT FROM 's' OR p.prorettype IS DISTINCT FROM to_regtype(a.tip)::oid
           OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
           OR has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_auth) THEN
    RAISE EXCEPTION '20270115b: lantul de drept (fn_executie_proiect_permis + callee 20261209a, fn_executie_pachete_acces 20261029a) lipseste sau nu e cel revizuit';
  END IF;
  -- coloanele citite de amprenta pachetului (existența; valorile intră în md5 prin to_jsonb, oricare ar fi tipul) + updated_at = timestamp
  IF EXISTS (SELECT 1 FROM (VALUES ('executie_pachete_lansare', 'id'), ('executie_pachete_lansare', 'proiect_id'), ('executie_pachete_lansare', 'tronson_id'),
                                   ('executie_pachete_lansare', 'updated_at'), ('executie_pachete_lansare', 'km_start_m'), ('executie_pachete_lansare', 'revizie'),
                                   ('executie_pachete_lansare', 'cod_document_full'), ('executie_tevi', 'id'), ('executie_tevi', 'pachet_id'),
                                   ('executie_tevi', 'poz_in_pachet'), ('executie_tevi', 'tip_rand'), ('executie_tevi', 'serie_unica'), ('executie_tevi', 'sudura_cod'),
                                   ('executie_tevi', 'sudura_refacuta'), ('executie_tevi', 'lungime_m'), ('executie_tevi', 'tip'), ('executie_tevi', 'dimensiune'),
                                   ('executie_tevi', 'sarja'), ('executie_tevi', 'unghi_curba'), ('executie_tevi', 'lot'), ('executie_tevi', 'observatii'),
                                   ('executie_tevi', 'pm_cod'), ('executie_tevi', 'pa_ut_cod'), ('executie_tevi', 'ut_cod')) c(t, col)
              WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns i WHERE i.table_schema = 'public' AND i.table_name = c.t AND i.column_name = c.col))
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns i WHERE i.table_schema = 'public' AND i.table_name = 'executie_pachete_lansare'
                      AND i.column_name = 'updated_at' AND i.data_type IN ('timestamp with time zone', 'timestamp without time zone')) THEN
    RAISE EXCEPTION '20270115b: coloanele citite de amprenta pachetului lipsesc (executie_pachete_lansare / executie_tevi)';
  END IF;
  IF to_regprocedure('public.fn_izo_porti_lipsa()') IS NULL THEN RAISE EXCEPTION '20270115b: portile Izometrie (fn_izo_porti_lipsa) lipsesc'; END IF;
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270115b: portile Izometrie nu sunt verzi inainte: %', public.fn_izo_porti_lipsa();
  END IF;
END $pre$;

-- ─────────── A. citirile AI păstrate pe server ───────────
CREATE TABLE public.sud_citiri (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  buletin_id bigint NOT NULL REFERENCES public.sud_buletine(id),
  proiect_id bigint NOT NULL,
  cheie_idempotenta uuid NOT NULL,
  tip text NOT NULL CHECK (tip IN ('principal', 'alternativ')),
  model text NOT NULL CHECK (model ~ '^claude-[a-z0-9.-]{1,60}$'),
  stare text NOT NULL DEFAULT 'in_curs' CHECK (stare IN ('in_curs', 'gata', 'esuat')),
  citire jsonb,
  nr_randuri integer,
  cost_usd numeric CHECK (cost_usd >= 0 AND cost_usd <= 1000),
  cost_cunoscut boolean,
  eroare_cod text CHECK (eroare_cod ~ '^[a-z_]{1,60}$'),
  creat_de uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  incheiat_la timestamptz,
  CONSTRAINT sud_citiri_cheie_uq UNIQUE (cheie_idempotenta),
  CONSTRAINT sud_citiri_stare_ck CHECK (
    (stare = 'in_curs' AND citire IS NULL AND nr_randuri IS NULL AND cost_usd IS NULL AND cost_cunoscut IS NULL AND eroare_cod IS NULL AND incheiat_la IS NULL)
    OR (stare = 'gata' AND citire IS NOT NULL AND nr_randuri BETWEEN 1 AND 2000 AND cost_usd IS NOT NULL AND cost_cunoscut IS NOT NULL
        AND eroare_cod IS NULL AND incheiat_la IS NOT NULL)
    OR (stare = 'esuat' AND citire IS NULL AND nr_randuri IS NULL AND cost_usd IS NOT NULL AND cost_cunoscut IS NOT NULL
        AND eroare_cod IS NOT NULL AND incheiat_la IS NOT NULL))
);
CREATE INDEX sud_citiri_buletin_ix ON public.sud_citiri (buletin_id, id);

-- Forma citirii salvate = ieșirea lui valideazaCitireNdt (supabase/functions/izo-ndt-citeste/handler.ts): toate cheile prezente, nicio cheie în plus,
-- tipurile și limitele de acolo (peste limită = invalid, nu tăiere, L21). NULL = validă; altfel motivul (pentru mesajul RPC-ului).
CREATE FUNCTION public.fn_sud_citire_valida(p_citire jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE a jsonb; r jsonb; x jsonb; v_i integer := 0; v_m text[]; v_n numeric;
BEGIN
  IF p_citire IS NULL OR jsonb_typeof(p_citire) IS DISTINCT FROM 'object' THEN RETURN 'citirea nu e obiect'; END IF;
  IF octet_length(p_citire::text) > 2000000 THEN RETURN 'citirea are peste 2 MB'; END IF;
  IF NOT (p_citire ?& ARRAY['antet', 'randuri', 'incerte', 'partial', 'pagini_necitite'])
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_citire) k WHERE k NOT IN ('antet', 'randuri', 'incerte', 'partial', 'pagini_necitite')) THEN
    RETURN 'cheile citirii';
  END IF;
  a := p_citire->'antet';
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' THEN RETURN 'antet'; END IF;
  IF NOT (a ?& ARRAY['firma', 'metoda', 'numar', 'data', 'tronson', 'nr_randuri_tiparit', 'partial', 'pagini_necitite'])
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(a) k WHERE k NOT IN ('firma', 'metoda', 'numar', 'data', 'tronson', 'nr_randuri_tiparit', 'partial', 'pagini_necitite')) THEN
    RETURN 'cheile antetului';
  END IF;
  -- textele opționale: null sau text nevid (tăiat de edge), cel mult N caractere
  IF EXISTS (SELECT 1 FROM (VALUES ('firma', 200), ('metoda', 40), ('numar', 60), ('tronson', 60)) t(k, n)
              WHERE jsonb_typeof(a->t.k) <> 'null' AND (jsonb_typeof(a->t.k) <> 'string' OR length(a->>t.k) > t.n OR a->>t.k !~ '[^[:space:]]')) THEN
    RETURN 'antet: text de alt tip sau prea lung';
  END IF;
  IF jsonb_typeof(a->'data') <> 'null' THEN
    IF jsonb_typeof(a->'data') <> 'string' THEN RETURN 'antet.data'; END IF;
    v_m := regexp_match(a->>'data', '^([0-9]{4})-([0-9]{2})-([0-9]{2})$');
    IF v_m IS NULL THEN RETURN 'antet.data'; END IF;
    IF v_m[1]::int < 1 OR v_m[2]::int NOT BETWEEN 1 AND 12 OR v_m[3]::int < 1 THEN RETURN 'antet.data'; END IF;
    IF v_m[3]::int > extract(day FROM make_date(v_m[1]::int, v_m[2]::int, 1) + interval '1 month - 1 day') THEN RETURN 'antet.data'; END IF;
  END IF;
  IF jsonb_typeof(a->'nr_randuri_tiparit') <> 'null' THEN
    IF jsonb_typeof(a->'nr_randuri_tiparit') <> 'number' THEN RETURN 'antet.nr_randuri_tiparit'; END IF;
    v_n := (a->>'nr_randuri_tiparit')::numeric;
    IF v_n <> trunc(v_n) OR v_n < 0 OR v_n > 100000 THEN RETURN 'antet.nr_randuri_tiparit'; END IF;
  END IF;
  IF jsonb_typeof(a->'partial') <> 'boolean' OR (p_citire->'partial') IS DISTINCT FROM (a->'partial') THEN RETURN 'partial'; END IF;
  IF jsonb_typeof(a->'pagini_necitite') <> 'array' OR jsonb_array_length(a->'pagini_necitite') > 1000
     OR (p_citire->'pagini_necitite') IS DISTINCT FROM (a->'pagini_necitite') THEN
    RETURN 'pagini_necitite';
  END IF;
  FOR x IN SELECT e FROM jsonb_array_elements(a->'pagini_necitite') e LOOP
    IF jsonb_typeof(x) <> 'number' THEN RETURN 'pagini_necitite'; END IF;
    v_n := (x #>> '{}')::numeric;
    IF v_n <> trunc(v_n) OR v_n < 1 OR v_n > 10000 THEN RETURN 'pagini_necitite'; END IF;
  END LOOP;
  IF jsonb_typeof(p_citire->'incerte') <> 'array' OR jsonb_array_length(p_citire->'incerte') > 2000
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_citire->'incerte') e
                 WHERE jsonb_typeof(e) <> 'string' OR length(e #>> '{}') > 500 OR (e #>> '{}') !~ '[^[:space:]]') THEN
    RETURN 'incerte';
  END IF;
  IF jsonb_typeof(p_citire->'randuri') <> 'array' OR jsonb_array_length(p_citire->'randuri') = 0 OR jsonb_array_length(p_citire->'randuri') > 2000 THEN
    RETURN 'randuri: lipsa sau peste 2000';
  END IF;
  FOR r IN SELECT e FROM jsonb_array_elements(p_citire->'randuri') e LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(r) <> 'object' THEN RETURN format('randul %s nu e obiect', v_i); END IF;
    IF NOT (r ?& ARRAY['cod_raw', 'rezultat', 'data_inspectie', 'start_mm', 'end_mm', 'lungime_mm', 'inaltime_mm', 'adancime_mm', 'observatii'])
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('cod_raw', 'rezultat', 'data_inspectie', 'start_mm', 'end_mm', 'lungime_mm',
                                                                       'inaltime_mm', 'adancime_mm', 'observatii')) THEN
      RETURN format('randul %s: chei', v_i);
    END IF;
    IF jsonb_typeof(r->'cod_raw') <> 'string' OR length(r->>'cod_raw') > 80 OR r->>'cod_raw' !~ '[^[:space:]]' THEN RETURN format('randul %s: cod_raw', v_i); END IF;
    IF jsonb_typeof(r->'rezultat') <> 'null' AND (jsonb_typeof(r->'rezultat') <> 'string' OR r->>'rezultat' NOT IN ('acceptat', 'respins')) THEN
      RETURN format('randul %s: rezultat', v_i);
    END IF;
    IF jsonb_typeof(r->'data_inspectie') <> 'null' THEN
      IF jsonb_typeof(r->'data_inspectie') <> 'string' THEN RETURN format('randul %s: data_inspectie', v_i); END IF;
      v_m := regexp_match(r->>'data_inspectie', '^([0-9]{4})-([0-9]{2})-([0-9]{2})$');
      IF v_m IS NULL THEN RETURN format('randul %s: data_inspectie', v_i); END IF;
      IF v_m[1]::int < 1 OR v_m[2]::int NOT BETWEEN 1 AND 12 OR v_m[3]::int < 1 THEN RETURN format('randul %s: data_inspectie', v_i); END IF;
      IF v_m[3]::int > extract(day FROM make_date(v_m[1]::int, v_m[2]::int, 1) + interval '1 month - 1 day') THEN
        RETURN format('randul %s: data_inspectie', v_i);
      END IF;
    END IF;
    -- CASE: ordinea evaluării e garantată (castul numai pe numere)
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['start_mm', 'end_mm', 'lungime_mm', 'inaltime_mm', 'adancime_mm']) k
                WHERE CASE WHEN jsonb_typeof(r->k) = 'null' THEN false WHEN jsonb_typeof(r->k) <> 'number' THEN true
                           ELSE (r->>k)::numeric < 0 OR (r->>k)::numeric > 1000000 END) THEN
      RETURN format('randul %s: indicatii', v_i);
    END IF;
    IF jsonb_typeof(r->'observatii') <> 'null' AND (jsonb_typeof(r->'observatii') <> 'string' OR length(r->>'observatii') > 500 OR r->>'observatii' !~ '[^[:space:]]') THEN
      RETURN format('randul %s: observatii', v_i);
    END IF;
  END LOOP;
  RETURN NULL;
END $f$;

-- Rezervarea cererii, ÎNAINTEA rezervării de plafon și a apelului plătit (L04 / L22). Ordinea lock-urilor (L06): buletinul FOR UPDATE → rândul
-- cererii (INSERT / citire). Întoarce {rezultat: nou | gata | in_curs | necunoscut | esuat, id, ...}; „necunoscut” = cerere in_curs mai veche
-- de 5 minute (funcția edge se oprește la ~150 s): costul ei rămâne necunoscut, nu se reia automat (L05), o citire nouă cere o cheie nouă.
CREATE FUNCTION public.fn_sud_citire_rezerva(p_buletin bigint, p_tip text, p_model text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE b public.sud_buletine%ROWTYPE; c public.sud_citiri%ROWTYPE; v_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT * INTO b FROM public.sud_buletine WHERE id = p_buletin FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sud: buletin inexistent' USING ERRCODE = '22023'; END IF;
  IF public.fn_sud_drept(b.proiect_id, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  IF p_cheie IS NULL OR p_tip IS NULL OR p_tip NOT IN ('principal', 'alternativ') OR p_model IS NULL OR p_model !~ '^claude-[a-z0-9.-]{1,60}$' THEN
    RAISE EXCEPTION 'sud: cerere de citire invalida (cheie, tip, model)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.sud_citiri WHERE cheie_idempotenta = p_cheie;
  IF FOUND THEN
    -- aceeași cheie = aceeași intenție: alt buletin / tip / model / autor = altă cerere cu cheia refolosită (L04: refuz, nu răspunsul altuia)
    IF c.buletin_id <> p_buletin OR c.tip <> p_tip OR c.model <> p_model OR c.creat_de <> auth.uid() THEN
      RAISE EXCEPTION 'sud: cheie_alta_cerere' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('rezultat', CASE WHEN c.stare <> 'in_curs' THEN c.stare
                                               WHEN c.creat_la < now() - interval '5 minutes' THEN 'necunoscut' ELSE 'in_curs' END,
      'id', c.id, 'tip', c.tip, 'model', c.model, 'citire', c.citire, 'nr_randuri', c.nr_randuri, 'cost_usd', c.cost_usd,
      'cost_cunoscut', c.cost_cunoscut, 'eroare_cod', c.eroare_cod, 'creat_la', c.creat_la);
  END IF;
  IF b.stare <> 'ciorna' THEN RAISE EXCEPTION 'sud: buletinul nu e ciorna (%)', b.stare USING ERRCODE = '55000'; END IF;
  -- o singură cerere în lucru pe buletin (două taburi / două click-uri cu chei diferite nu plătesc de două ori)
  IF EXISTS (SELECT 1 FROM public.sud_citiri WHERE buletin_id = p_buletin AND stare = 'in_curs' AND creat_la >= now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'sud: alta citire a buletinului e in curs' USING ERRCODE = '55006';
  END IF;
  -- plafonul pe buletin: cererile care costă sau al căror cost e necunoscut (cele închise înaintea apelului, cu 0 cunoscut, nu se numără)
  IF (SELECT count(*) FROM public.sud_citiri WHERE buletin_id = p_buletin
        AND NOT (stare = 'esuat' AND cost_cunoscut IS TRUE AND cost_usd = 0)) >= 5 THEN
    RAISE EXCEPTION 'sud: limita de citiri AI pe buletin (5) e atinsa' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.sud_citiri (buletin_id, proiect_id, cheie_idempotenta, tip, model, creat_de)
  VALUES (b.id, b.proiect_id, p_cheie, p_tip, p_model, auth.uid())
  ON CONFLICT (cheie_idempotenta) DO NOTHING RETURNING id INTO v_id;
  -- conflict = aceeași cheie scrisă concurent pe ALT buletin (pe același buletin lock-ul serializează): refuz, nimic scris
  IF v_id IS NULL THEN RAISE EXCEPTION 'sud: cheie_alta_cerere' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('rezultat', 'nou', 'id', v_id);
END $f$;

-- Închiderea cererii proprii in_curs: gata (citirea validă, buletinul încă ciornă) sau esuat (cod de eroare). Costul: cunoscut (usage) sau
-- necunoscut (= rezerva). Repetarea identică după un răspuns pierdut = același id; altă închidere a unei cereri încheiate = 55000.
-- Ordinea lock-urilor (L06): buletinul FOR UPDATE → rândul cererii FOR UPDATE (ca la rezervare).
CREATE FUNCTION public.fn_sud_citire_salveaza(p_cheie uuid, p_citire jsonb, p_cost_usd numeric, p_cost_cunoscut boolean, p_eroare text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE c public.sud_citiri%ROWTYPE; b public.sud_buletine%ROWTYPE; v_buletin bigint; v_rau text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT buletin_id INTO v_buletin FROM public.sud_citiri WHERE cheie_idempotenta = p_cheie;
  IF v_buletin IS NULL THEN RAISE EXCEPTION 'sud: cerere de citire inexistenta' USING ERRCODE = '22023'; END IF;
  SELECT * INTO b FROM public.sud_buletine WHERE id = v_buletin FOR UPDATE;
  SELECT * INTO c FROM public.sud_citiri WHERE cheie_idempotenta = p_cheie FOR UPDATE;
  IF c.creat_de <> auth.uid() OR public.fn_sud_drept(b.proiect_id, 'scriere') IS NOT TRUE THEN
    RAISE EXCEPTION 'sud: doar cel care a pornit citirea o poate inchide' USING ERRCODE = '42501';
  END IF;
  IF p_cost_cunoscut IS NULL OR p_cost_usd IS NULL OR p_cost_usd < 0 OR p_cost_usd > 1000 THEN
    RAISE EXCEPTION 'sud: costul citirii lipseste sau e invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_citire IS NULL) = (p_eroare IS NULL) THEN RAISE EXCEPTION 'sud: fie citirea, fie codul de eroare' USING ERRCODE = '22023'; END IF;
  IF p_eroare IS NOT NULL AND p_eroare !~ '^[a-z_]{1,60}$' THEN RAISE EXCEPTION 'sud: cod de eroare invalid' USING ERRCODE = '22023'; END IF;
  IF c.stare <> 'in_curs' THEN
    IF (c.stare = 'gata' AND p_citire IS NOT NULL AND c.citire = p_citire AND c.cost_usd = p_cost_usd AND c.cost_cunoscut = p_cost_cunoscut)
       OR (c.stare = 'esuat' AND p_eroare IS NOT NULL AND c.eroare_cod = p_eroare AND c.cost_usd = p_cost_usd AND c.cost_cunoscut = p_cost_cunoscut) THEN
      RETURN c.id;
    END IF;
    RAISE EXCEPTION 'sud: cererea de citire e deja incheiata (%)', c.stare USING ERRCODE = '55000';
  END IF;
  IF p_eroare IS NOT NULL THEN
    UPDATE public.sud_citiri SET stare = 'esuat', eroare_cod = p_eroare, cost_usd = p_cost_usd, cost_cunoscut = p_cost_cunoscut, incheiat_la = now()
     WHERE id = c.id;
    RETURN c.id;
  END IF;
  IF b.stare <> 'ciorna' THEN RAISE EXCEPTION 'sud: buletinul nu e ciorna (%)', b.stare USING ERRCODE = '55000'; END IF;
  v_rau := public.fn_sud_citire_valida(p_citire);
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'sud: citirea are alta forma (%)', v_rau USING ERRCODE = '22023'; END IF;
  UPDATE public.sud_citiri SET stare = 'gata', citire = p_citire, nr_randuri = jsonb_array_length(p_citire->'randuri'), cost_usd = p_cost_usd,
         cost_cunoscut = p_cost_cunoscut, incheiat_la = now()
   WHERE id = c.id;
  RETURN c.id;
END $f$;

-- ─────────── B. amprenta pachetului, calculată de server ───────────
-- O SINGURĂ definiție (L19): ecranul o cere la deschiderea ferestrei de export și o pune în fotografie; fn_sud_export_inregistreaza o recalculează
-- sub lock-ul pachetului. Câmpurile = amprentaPachet + CAMPURI_RAND_AMPRENTA din src/lib/izoExportIzo.js (plus proiectul și tronsonul pachetului);
-- updated_at intră ca epoch (independent de fusul sesiunii). Rândurile ordonate după id; fără rânduri = '[]'. Lipsă = 22023, fără drept = 42501.
CREATE FUNCTION public.fn_sud_amprenta_pachet(p_pachet bigint) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_proiect bigint; v_cap text; v_randuri text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT p.proiect_id, jsonb_build_array(p.id, p.proiect_id, p.tronson_id, extract(epoch FROM p.updated_at), p.km_start_m, p.revizie, p.cod_document_full)::text
    INTO v_proiect, v_cap FROM public.executie_pachete_lansare p WHERE p.id = p_pachet;
  IF v_cap IS NULL THEN RAISE EXCEPTION 'sud: pachet inexistent' USING ERRCODE = '22023'; END IF;
  IF public.fn_sud_drept(v_proiect, 'export') IS NOT TRUE THEN RAISE EXCEPTION 'sud: fara drept de export pe proiect' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_array(t.id, t.poz_in_pachet, t.tip_rand, t.serie_unica, t.sudura_cod, t.sudura_refacuta, t.lungime_m, t.tip,
                                              t.dimensiune, t.sarja, t.unghi_curba, t.lot, t.observatii, t.pm_cod, t.pa_ut_cod, t.ut_cod) ORDER BY t.id), '[]'::jsonb)::text
    INTO v_randuri FROM public.executie_tevi t WHERE t.pachet_id = p_pachet;
  RETURN md5('sud_amprenta_pachet:v1|' || v_cap || '|' || v_randuri);
END $f$;

-- Corpul 20270114a + amprenta pachetului (fotografia.amprenta_pachet, recalculată aici, sub lock-ul pachetului). Fotografia fără amprentă = 22023
-- (ecran vechi: reîncarcă pagina); amprentă diferită = 40001 cu „pachet” în lista surselor schimbate, nimic scris.
-- Ordinea lock-urilor (L06): pachetul FOR UPDATE → deblocarea FOR UPDATE; sursele doar citite (o schimbare după verificare = „export depășit”, R6).
CREATE OR REPLACE FUNCTION public.fn_sud_export_inregistreaza(p_pachet bigint, p_tip text, p_fotografie jsonb, p_deblocare_id bigint, p_fisier_path text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_proiect bigint; v_tronson bigint; v_id bigint; d public.sud_export_deblocari%ROWTYPE; v_rau text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT proiect_id, tronson_id INTO v_proiect, v_tronson FROM public.executie_pachete_lansare WHERE id = p_pachet FOR UPDATE;
  IF v_proiect IS NULL THEN RAISE EXCEPTION 'sud: pachet inexistent' USING ERRCODE = '22023'; END IF;
  IF p_tip IS NULL OR p_tip NOT IN ('izo', 'inventar') THEN RAISE EXCEPTION 'sud: tip export invalid' USING ERRCODE = '22023'; END IF;
  IF p_fotografie IS NULL OR jsonb_typeof(p_fotografie) <> 'object' OR octet_length(p_fotografie::text) > 2000000
     OR jsonb_typeof(p_fotografie->'buletine') IS DISTINCT FROM 'array' OR jsonb_typeof(p_fotografie->'eliminate') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_fotografie->'metode') IS DISTINCT FROM 'array' OR jsonb_typeof(p_fotografie->'lipsuri_blocante') IS DISTINCT FROM 'array'
     OR coalesce(jsonb_typeof(p_fotografie->'avertismente'), 'array') <> 'array' OR length(p_fisier_path) > 500 THEN
    RAISE EXCEPTION 'sud: fotografia exportului e incompleta (buletine, eliminate, metode, lipsuri_blocante)' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_fotografie->'amprenta_pachet') IS DISTINCT FROM 'string' OR p_fotografie->>'amprenta_pachet' !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'sud: fotografia nu are amprenta pachetului de pe server (reincarca pagina si redeschide fereastra)' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_fotografie->'buletine') e
              WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e->'id') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'versiune') IS DISTINCT FROM 'number'
                 OR e->>'id' !~ '^[0-9]{1,18}$' OR e->>'versiune' !~ '^[0-9]{1,9}$')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_fotografie->'eliminate') e WHERE jsonb_typeof(e) <> 'string')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_fotografie->'metode') e WHERE jsonb_typeof(e) <> 'string') THEN
    RAISE EXCEPTION 'sud: elementele fotografiei au alt tip (buletine {id, versiune} intregi, eliminate / metode text)' USING ERRCODE = '22023';
  END IF;
  IF p_deblocare_id IS NULL THEN
    -- exportul complet: oricine are dreptul de export (ca exportul de azi), doar fără lipsuri blocante
    IF public.fn_sud_drept(v_proiect, 'export') IS NOT TRUE THEN RAISE EXCEPTION 'sud: fara drept de export pe proiect' USING ERRCODE = '42501'; END IF;
    IF jsonb_array_length(p_fotografie->'lipsuri_blocante') > 0 THEN
      RAISE EXCEPTION 'sud: exportul are lipsuri blocante; cere deblocarea managerului de proiect' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF public.fn_sud_drept(v_proiect, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
    SELECT * INTO d FROM public.sud_export_deblocari WHERE id = p_deblocare_id FOR UPDATE;
    IF NOT FOUND OR d.pachet_id <> p_pachet OR d.tip <> p_tip OR d.creat_de <> auth.uid() OR d.folosit_la IS NOT NULL
       OR d.creat_la < now() - interval '1 hour' OR d.lipsuri IS DISTINCT FROM p_fotografie->'lipsuri_blocante' THEN
      RAISE EXCEPTION 'sud: deblocarea nu e valabila pentru acest export' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- sursele: aceleași ca acum (mulțimi întregi, cu dublurile numărate) + pachetul și rândurile lui (amprenta serverului)
  SELECT string_agg(x, ', ' ORDER BY x) INTO v_rau FROM (
    SELECT 'buletine' AS x
     WHERE (SELECT coalesce(array_agg(k ORDER BY k), '{}') FROM (SELECT (e->>'id') || ':' || (e->>'versiune') AS k
                                                                    FROM jsonb_array_elements(p_fotografie->'buletine') e) fb)
           IS DISTINCT FROM
           (SELECT coalesce(array_agg(k ORDER BY k), '{}') FROM (SELECT b.id::text || ':' || b.versiune::text AS k FROM public.sud_buletine b
                                                                   WHERE b.tronson_id = v_tronson AND b.proiect_id = v_proiect AND b.stare = 'confirmat') sb)
    UNION ALL
    SELECT 'eliminate' WHERE (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM jsonb_array_elements_text(p_fotografie->'eliminate') x)
      IS DISTINCT FROM (SELECT coalesce(array_agg(cheie ORDER BY cheie), '{}') FROM public.sud_suduri_eliminate WHERE tronson_id = v_tronson AND activ)
    UNION ALL
    SELECT 'metode' WHERE (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM jsonb_array_elements_text(p_fotografie->'metode') x)
      IS DISTINCT FROM coalesce((SELECT metode FROM public.sud_metode_proiect WHERE proiect_id = v_proiect), '{}')
    UNION ALL
    SELECT 'pachet' WHERE public.fn_sud_amprenta_pachet(p_pachet) IS DISTINCT FROM p_fotografie->>'amprenta_pachet'
  ) z;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'sud: sursele s-au schimbat intre verificare si export (%); reincarca fereastra', v_rau USING ERRCODE = '40001'; END IF;
  IF p_deblocare_id IS NOT NULL THEN UPDATE public.sud_export_deblocari SET folosit_la = now() WHERE id = d.id; END IF;
  INSERT INTO public.sud_exporturi (proiect_id, pachet_id, tip, fotografie, incomplet, deblocare_id, fisier_path, creat_de)
  VALUES (v_proiect, p_pachet, p_tip, p_fotografie, p_deblocare_id IS NOT NULL, p_deblocare_id, p_fisier_path, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- ─────────── drepturi pe obiecte ───────────
ALTER TABLE public.sud_citiri ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sud_citiri FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.sud_citiri TO authenticated, service_role;
-- secvența de identitate primește ALL din privilegiile implicite: clienții nu o folosesc (scrierile sunt ale funcțiilor DEFINER)
REVOKE ALL ON SEQUENCE public.sud_citiri_id_seq FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY sud_citiri_citire ON public.sud_citiri FOR SELECT TO authenticated
  USING ((SELECT public.fn_sud_drept(proiect_id, 'citire')));

REVOKE ALL ON FUNCTION public.fn_sud_citire_valida(jsonb), public.fn_sud_citire_rezerva(bigint, text, text, uuid),
  public.fn_sud_citire_salveaza(uuid, jsonb, numeric, boolean, text), public.fn_sud_amprenta_pachet(bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sud_citire_valida(jsonb), public.fn_sud_citire_rezerva(bigint, text, text, uuid),
  public.fn_sud_citire_salveaza(uuid, jsonb, numeric, boolean, text), public.fn_sud_amprenta_pachet(bigint) TO authenticated;

-- ─────────── postcondiții ───────────
DO $post$
DECLARE v_rau text;
BEGIN
  -- tabelele sud_: RLS activ, nefortat, doar SELECT pentru authenticated / service_role (inclusiv cele 6 din 20270114a)
  SELECT string_agg(c.relname || ':' || coalesce(a.d, '-'), '; ') INTO v_rau
    FROM pg_class c LEFT JOIN LATERAL (
      SELECT string_agg(x.d, ',' ORDER BY x.d) d FROM (
        SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || '=' || e.privilege_type AS d
          FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE e.grantee <> c.relowner) x) a ON true
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'sud\_%'
     AND (NOT c.relrowsecurity OR c.relforcerowsecurity OR a.d IS DISTINCT FROM 'authenticated=SELECT,service_role=SELECT');
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270115b post: drepturile tabelelor sud_: %', v_rau; END IF;
  IF (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'sud\_%') <> 7 THEN
    RAISE EXCEPTION '20270115b post: numarul tabelelor sud_';
  END IF;
  -- politicile pe sud_citiri: EXACT una, permisivă, SELECT, authenticated
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.sud_citiri'::regclass) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.sud_citiri'::regclass AND polname = 'sud_citiri_citire' AND polcmd = 'r'
                      AND polpermissive AND polroles = ARRAY['authenticated'::regrole::oid]) THEN
    RAISE EXCEPTION '20270115b post: politicile sud_citiri';
  END IF;
  -- secvențele sud_: exact cele 6 de identitate, fără niciun drept în afara proprietarului
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_rau FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND c.relname LIKE 'sud\_%'
     AND EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) e WHERE e.grantee <> c.relowner);
  IF v_rau IS NOT NULL
     OR (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND c.relname LIKE 'sud\_%') <> 6 THEN
    RAISE EXCEPTION '20270115b post: secventele sud_ (numar sau drepturi): %', coalesce(v_rau, 'numar');
  END IF;
  -- funcțiile fn_sud_: 15; DEFINER toate în afara celor pure (normalizator, tronson, validarea citirii); cale sigură; proprietar postgres;
  -- fără EXECUTE pentru anon / PUBLIC / service_role; EXECUTE pentru authenticated pe toate
  SELECT string_agg(p.proname, ', ') INTO v_rau FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_sud\_%'
     AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] OR pg_get_userbyid(p.proowner) <> 'postgres'
          OR p.prosecdef <> (p.proname NOT IN ('fn_sud_cod_normalizeaza', 'fn_sud_tronson_nr', 'fn_sud_citire_valida'))
          OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
          OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
                      WHERE e.grantee = 0 OR e.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'service_role'))));
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270115b post: functiile fn_sud_: %', v_rau; END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_sud\_%') <> 15 THEN
    RAISE EXCEPTION '20270115b post: numarul functiilor fn_sud_';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.fn_sud_citire_valida(jsonb)'::regprocedure) <> 'i'
     OR (SELECT provolatile FROM pg_proc WHERE oid = 'public.fn_sud_amprenta_pachet(bigint)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION '20270115b post: volatilitatea functiilor noi';
  END IF;
  -- validarea citirii: un caz valid minim trece, cazurile de bază invalide nu (setul complet e în proba PGlite)
  IF public.fn_sud_citire_valida('{"antet": {"firma": null, "metoda": "PA-UT", "numar": "12", "data": "2026-11-20", "tronson": null, "nr_randuri_tiparit": 1,
        "partial": false, "pagini_necitite": []}, "randuri": [{"cod_raw": "T12S1", "rezultat": "acceptat", "data_inspectie": null, "start_mm": null,
        "end_mm": null, "lungime_mm": null, "inaltime_mm": null, "adancime_mm": null, "observatii": null}], "incerte": [], "partial": false,
        "pagini_necitite": []}'::jsonb) IS NOT NULL
     OR public.fn_sud_citire_valida('{"antet": {"firma": null, "metoda": null, "numar": null, "data": null, "tronson": null, "nr_randuri_tiparit": null,
        "partial": false, "pagini_necitite": []}, "randuri": [], "incerte": [], "partial": false, "pagini_necitite": []}'::jsonb) IS NULL
     OR public.fn_sud_citire_valida('[]'::jsonb) IS NULL THEN
    RAISE EXCEPTION '20270115b post: validarea citirii nu da rezultatele asteptate';
  END IF;
  -- ștampilele porților Izometrie, CALCULATE după ultima schimbare (docs/izometrie/PORTI_REGULA.md); amprentele nu se schimbă (nimic izo_),
  -- deci ștampilele recalculate ies identice
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L', 'porti_e3=' || public.fn_izo_porti_e3_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L', 'porti_e3b=' || public.fn_izo_porti_e3b_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS %L', 'porti_e4=' || public.fn_izo_porti_e4_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS %L', 'porti_e4b=' || public.fn_izo_porti_e4b_definitii());
  -- IZO POST
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270115b post: portile Izometrie nu sunt verzi dupa: %', public.fn_izo_porti_lipsa();
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270115b_izometrie_ndt_citiri:' || txid_current() THEN
    RAISE EXCEPTION '20270115b: garda final invalida';
  END IF;
  RAISE NOTICE '20270115b: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
