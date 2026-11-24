-- Version 20270108120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 15000 --plafon-extins --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270108a_executie_dcc_registru.l15.tsv (DOAR cu plafonul EXTINS, în fereastra orară din docs/LIVRARE_L15_V2.md §9, ȘI cu
--   amprenta globală L15 v2: fără pasul „înainte” al runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- 20270108a_executie_dcc_registru — Execuție: registrul DCC (PR1, baza de date). Specificația: docs/superpowers/specs/2026-11-23-registru-dcc-design.md
--   (v2.3); planul: docs/superpowers/plans/2026-11-24-registru-dcc-pr1.md (runda 4). DOAR obiecte noi: tabelele dcc_*, funcțiile fn_dcc_*, triggerele
--   trg_dcc_*, vederea v_dcc_registru, cheile străine spre executie_proiecte. Nicio dată, niciun drept pe module (sub-modulul executie_dcc se
--   înscrie printr-un script separat, scripts/executie_dcc_modul_catalog.sql, rulat de coordonator cu „da”-ul proprietarului), nicio trimitere.
-- Secțiunile (markerii de mai jos; proba de concurență extrage 1–6 exact):
--   0 gărzile $pre$ + punctul unic de blocare $lock$; 1 funcțiile pure (formatorul = oglinda src/dcc/dccCod.js, intervalul canonic, tranzițiile,
--   hash-ul intențiilor); 2 TOATE tabelele (RLS activ, nimic acordat); 3 dreptul, intențiile, ajutătoarele interne, politicile, GRANT SELECT,
--   vederea; 4 triggerele; 5 RPC-urile de configurare (5a) și ale registrului (5b); 6 importul istoric, „copiat”, „confirm că am trimis”;
--   7 postcondițiile (structura, drepturile, amprentele, lock-urile).
-- Codurile de eroare (stabile, la începutul mesajului; mesajele nu deosebesc „nu există” de „nu ai drept” și nu conțin date ale altor proiecte):
--   42501 DCC_NEAUTENTIFICAT, DCC_FARA_DREPT; 22023 parametri invalizi (DCC_INTERVAL_INVALID, DCC_CHEIE_ALTI_PARAMETRI, DCC_CHEI_NECUNOSCUTE,
--   DCC_LISTA_GOALA / _INVALIDA / _DUBLURI / _PREA_LUNGA, DCC_PROIECTE_AMESTECATE, DCC_MOTIV_LIPSA, DCC_EMITENT_STRAIN, DCC_LOT_DUBLURI,
--   DCC_SNAPSHOT_ALTE_REVIZII, DCC_TO_DIFERIT, DCC_CC_NEPERMIS, erorile formatorului DCC_FORMAT_INVALID / DCC_CAMP_LIPSA / DCC_VALOARE_INVALIDA /
--   DCC_LIMBA_LIPSA / DCC_TITLU_SCURT_GOL / DCC_EXTENSIE_INVALIDA); P0001 DCC_SERIE_ABSENTA, DCC_INTERVAL_EPUIZAT, DCC_INTERVAL_NECUNOSCUT,
--   DCC_GHID_INCOMPATIBIL, DCC_DOCUMENT_ANULAT (RPC), DCC_GARDA_DOCUMENT_ANULAT (trigger), DCC_MOD_MANUAL / DCC_MOD_AUTOMAT, DCC_SERIE_AUTOMATA,
--   DCC_PRAG_SUB_DOCUMENTE / DCC_PRAG_SUB_ISTORIC, DCC_TRANZITIE_NEPERMISA, DCC_GHID_IMUABIL, DCC_CONTRACT_IMUABIL, DCC_PROIECT_IMUABIL,
--   DCC_SERIE_IMUABILA, DCC_DOCUMENT_IMUABIL, DCC_REVIZIE_IMUABILA, DCC_ISTORIC_IMUABIL, DCC_MESAJ_IMUABIL, DCC_SNAPSHOT_IMUABIL,
--   DCC_INTENTIE_IMUABILA, DCC_STERGERE_INTERZISA; 23505 DCC_SERIE_EXISTA, DCC_COD_OCUPAT, DCC_FILA_EXISTA; 23P01 DCC_INTERVALE_SUPRAPUSE (RPC-ul
--   de inițializare și intervalele aceluiași ghid), DCC_GARDA_INTERVALE_SUPRAPUSE (triggerul dcc_serii); 40001 DCC_CONFLICT_VERSIUNE;
--   55P03 lock ocupat la aplicare.
-- Ordinea globală a lock-urilor (L06), aceeași pe toate căile (detaliile în comentariul fiecărui RPC):
--   1 rândul cheii în dcc_intentii (index unic, la INSERT) -> 2 advisory pe contract (fn_dcc_lock_contract; EXCLUSIV la setarea proiectului,
--   PARTAJAT la inițializare / alocare manuală) -> 3 dcc_proiecte FOR SHARE (FOR UPDATE doar la setarea proiectului) -> 4 advisory pe cheia
--   seriei FĂRĂ interval (fn_dcc_lock_cheie_serie) -> 5 dcc_serii FOR UPDATE (alocarea) -> 6 dcc_documente FOR UPDATE ORDER BY id -> 7 scrierile
--   registrului -> 8 snapshot / mesaj / legături -> 9 rezultatul intenției. Cheile străine iau FOR KEY SHARE (compatibile).
-- Lock-urile la aplicare: punctul unic $lock$ (NOWAIT, bugetul 1 s) = executie_proiecte în SHARE ROW EXCLUSIVE (cheia străină a dcc_proiecte);
--   setul COMPLET e verificat în $post$ pe pg_locks (clasele M1 / M2 / R1 / R2 / C / E din plan). Funcțiile care citesc tabele existente
--   (profiles, user_module_access, executie_proiecte) sunt plpgsql: corpul nu se analizează la creare, deci nu iau lock-uri pe ele.
-- Revenire: supabase/revenire/20270108a_executie_dcc_registru_ROLLBACK.sql (prin runner, plafonul 2000, fără amprentă globală; refuză cu orice rând
--   în tabelele dcc_*). Probe: scripts/pglite/test_executie_dcc_registru_local.mjs (PGlite), supabase/tests/20270108a_executie_dcc_registru_dryrun.sql
--   (clona), supabase/tests/20270108a_executie_dcc_registru_concurenta.sh (cluster dispensabil, două sesiuni).

-- ─── 0. gărzile de start și punctul unic de blocare
DO $pre$
DECLARE v_plafon text; r record; v_tip text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270108a_executie_dcc_registru:' || txid_current() THEN
    RAISE EXCEPTION '20270108a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270108a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270108a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270108a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '15000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '15000:' || txid_current() THEN
    RAISE EXCEPTION '20270108a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 15000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 15000 --plafon-extins)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tabela lui temporară, creată de tranzacția curentă și blocată de ea)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_catalog.pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270108a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz (orice obiect cu numele migrării)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND (c.relname LIKE 'dcc\_%' OR c.relname = 'v_dcc_registru'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_dcc\_%')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgname LIKE 'trg\_dcc\_%') THEN
    RAISE EXCEPTION '20270108a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele tabelelor EXISTENTE citite de funcțiile noi, cu tipurile acceptate — din pg_attribute + format_type (NU din information_schema:
  -- vederea ar fi o citire în afara catalogului, deci un lock nedeclarat)
  FOR r IN SELECT * FROM (VALUES
      ('executie_proiecte', 'id', '^bigint$'),
      ('profiles', 'id', '^uuid$'), ('profiles', 'is_owner', '^boolean$'),
      ('user_module_access', 'profile_id', '^uuid$'), ('user_module_access', 'module', '^(text|character varying(\(\d+\))?)$'),
      ('user_module_access', 'access_level', '^(text|character varying(\(\d+\))?)$')
    ) v(t, c, tip) LOOP
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_tip
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = to_regclass('public.' || r.t) AND a.attname = r.c AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_tip IS NULL OR v_tip !~ r.tip THEN
      RAISE EXCEPTION '20270108a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tip;
    END IF;
  END LOOP;
  IF to_regprocedure('auth.uid()') IS NULL
     OR (SELECT prorettype FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid
     OR to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)') IS NULL
     OR NOT pg_has_role('postgres', 'authenticated', 'USAGE') OR NOT pg_has_role('postgres', 'anon', 'USAGE')
     OR NOT pg_has_role('postgres', 'service_role', 'USAGE') THEN
    RAISE EXCEPTION '20270108a: dependentele (auth.uid, fn_executie_proiect_permis din 20261209a, rolurile aplicatiei) lipsesc sau difera';
  END IF;
  IF NOT has_table_privilege('postgres', 'public.executie_proiecte', 'REFERENCES') THEN
    RAISE EXCEPTION '20270108a: postgres nu poate referi executie_proiecte (cheia straina a dcc_proiecte)';
  END IF;
END $pre$;

-- ── lanțul funcției de drept pe proiect chemate DIRECT (fn_executie_proiect_permis) și al celor chemate de ea (listă revizuită pe corpurile din
-- 20261209a, aceleași amprente ca în 20270105a / 20270106a), cu amprenta corpului (fără CR) + proprietățile, ÎNAINTE și DUPĂ. Garanția completă
-- (orice altă funcție / politică / drept) e amprenta globală L15 v2 a runnerului.
CREATE FUNCTION pg_temp.lant_20270108a(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $lant$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      ('public.fn_executie_proiect_permis(bigint, boolean)', 'bd4320f76e9f36f492c7186c0a982155', true, true),
      ('public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1', true, true),
      ('public.fn_executie_acces_nerestrans_cont(uuid)', '9a07e0089139e54ba5c6a0cfaaf093cc', false, false),
      ('public.fn_executie_acces_lista(boolean)', 'd9e123a46b83530a7203d4a24da5cf9b', true, false),
      ('public.fn_executie_acces_lista_cont(uuid, boolean)', 'e7cf9b852002a1c1cbe781772c33bf0c', false, false)
    ) a(semnatura, amprenta, definer, cu_auth)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'sql')
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR p.prorettype IS DISTINCT FROM (CASE WHEN a.semnatura LIKE '%lista%' THEN 'bigint[]'::regtype ELSE 'boolean'::regtype END)::oid
      OR p.provolatile IS DISTINCT FROM 's'
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_auth;
  IF v_rau IS NOT NULL THEN
    RAISE EXCEPTION '%: lantul de drept (%) difera de amprenta revizuita: %', CASE WHEN p_moment = 'dupa' THEN 'L15_POST_AMPRENTA' ELSE '20270108a' END,
      p_moment, v_rau;
  END IF;
END $lant$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.lant_20270108a('inainte'); END $l15_inainte$;

-- ── punctul UNIC de blocare (L06), după verificările de catalog, înaintea oricărui DDL: executie_proiecte în SHARE ROW EXCLUSIVE (modul pe care
-- îl ia oricum ADD FOREIGN KEY; singurul tabel EXISTENT blocat explicit). Bugetul = 1 s cu ceasul pornit IMEDIAT ÎNAINTEA PRIMEI ÎNCERCĂRI,
-- verificat înaintea fiecărei încercări și DUPĂ obținere; fiecare încercare = subtranzacție. Momentul obținerii (gazpet.lock_puternic_la) îl
-- citește garda finală a runnerului (LOCK_TINUT).
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20270108a: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul lock-urilor e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000)
        USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.executie_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20270108a: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000)
      USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20270108a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. ajutătoarele pure (IMMUTABLE, SECURITY INVOKER, EXECUTE pentru authenticated: CHECK-urile și triggerele le cheamă cu drepturile apelantului)
-- Formatorul e oglinda EXACTĂ a src/dcc/dccCod.js (L19); paritatea e testată pe src/dcc/dccCodCazuri.json + 500 de combinații generate.

-- forma canonică a intervalului: SINGURA definiție (expresia regulată apare doar aici). Nu aruncă, nu întoarce NULL (CHECK-urile o cheamă cu IS TRUE).
CREATE FUNCTION public.fn_dcc_interval_e_canonic(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT coalesce(p ~ '^(general|[A-Z]{1,4}[0-9]{1,3})$', false)
$f$;

-- reprezentarea UNICĂ a intervalului (ghid, hash, căutarea seriei): spațiul ASCII de la capete tăiat; gol -> NULL; doar [A-Za-z0-9]; „general”
-- în orice combinație de majuscule -> general, altfel majuscule; rezultatul trebuie să fie canonic. NU se folosește în CHECK-uri (aruncă / NULL).
CREATE FUNCTION public.fn_dcc_interval_canonic(p text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE v text;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  v := btrim(p, ' ' || chr(9) || chr(10) || chr(13));
  IF v = '' THEN RETURN NULL; END IF;
  IF v !~ '^[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'DCC_INTERVAL_INVALID: intervalul are caractere nepermise' USING ERRCODE = '22023';
  END IF;
  IF lower(v) = 'general' THEN v := 'general'; ELSE v := upper(v); END IF;
  IF public.fn_dcc_interval_e_canonic(v) IS NOT TRUE THEN
    RAISE EXCEPTION 'DCC_INTERVAL_INVALID: intervalul nu are forma general / SR1' USING ERRCODE = '22023';
  END IF;
  RETURN v;
END $f$;

-- formatul de cod / de fișier al unui ghid (regulile din src/dcc/dccCod.js -> formatValid). Întoarce false, NICIODATĂ NULL și niciodată excepție:
-- tipurile se verifică cu jsonb_typeof înaintea oricărei citiri; prefixul lipsă dă NULL în v, pe care coalesce de la final îl face false.
CREATE FUNCTION public.fn_dcc_format_valid(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE e jsonb; i bigint; v boolean := true; v_camp text; v_vazute text[] := '{}'; v_pf text; v_pa text; v_n numeric;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(p) = 0 THEN RETURN false; END IF;
  FOR e, i IN SELECT a.e, a.i FROM jsonb_array_elements(p) WITH ORDINALITY a(e, i) LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('camp', 'prefix', 'cifre')) THEN RETURN false; END IF;
    IF jsonb_typeof(e -> 'camp') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    v_camp := e ->> 'camp';
    IF v_camp NOT IN ('contract', 'emitent', 'tematica', 'tip', 'secventa', 'fila', 'anexa', 'revizie', 'limba') OR v_camp = ANY (v_vazute) THEN
      RETURN false;
    END IF;
    v_vazute := v_vazute || v_camp;
    v := v AND (jsonb_typeof(e -> 'prefix') = 'string') AND ((e ->> 'prefix') ~ '^[-._A-Za-z]{0,6}$') AND ((i = 1) = ((e ->> 'prefix') = ''));
    IF v_camp = 'fila' THEN v_pf := e ->> 'prefix'; ELSIF v_camp = 'anexa' THEN v_pa := e ->> 'prefix'; END IF;
    IF v_camp = 'secventa' THEN
      IF jsonb_typeof(e -> 'cifre') IS DISTINCT FROM 'number' OR (e -> 'cifre') <> '5'::jsonb THEN RETURN false; END IF;
    ELSIF v_camp IN ('fila', 'anexa') THEN
      IF jsonb_typeof(e -> 'cifre') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
      v_n := (e ->> 'cifre')::numeric;
      IF v_n <> trunc(v_n) OR v_n < 1 OR v_n > 3 THEN RETURN false; END IF;
    ELSIF jsonb_typeof(e -> 'cifre') IS DISTINCT FROM 'null' AND e ? 'cifre' THEN
      RETURN false;
    END IF;
  END LOOP;
  IF NOT (v_vazute @> ARRAY['contract', 'emitent', 'tematica', 'tip', 'secventa', 'fila', 'anexa', 'revizie']) THEN RETURN false; END IF;
  IF v_pf IS NOT DISTINCT FROM v_pa THEN RETURN false; END IF;
  RETURN coalesce(v, false);
END $f$;

-- codul complet al unei revizii (oglinda codDcc): validarea în ordinea fixă formatul -> câmpurile obligatorii -> valorile -> limba; un câmp
-- opțional NULL se omite împreună cu prefixul lui. Erorile: 22023 cu codul formatorului.
CREATE FUNCTION public.fn_dcc_cod_text(p_format jsonb, p_contract text, p_emitent text, p_tematica text, p_tip text, p_secventa integer,
                                       p_fila integer, p_anexa integer, p_revizie integer, p_limba text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE e jsonb; v_out text := ''; v_val text; v_cf integer; v_ca integer;
BEGIN
  IF public.fn_dcc_format_valid(p_format) IS NOT TRUE THEN
    RAISE EXCEPTION 'DCC_FORMAT_INVALID: formatul ghidului nu e valid' USING ERRCODE = '22023';
  END IF;
  IF p_contract IS NULL THEN RAISE EXCEPTION 'DCC_CAMP_LIPSA: lipseste contract' USING ERRCODE = '22023'; END IF;
  IF p_emitent IS NULL THEN RAISE EXCEPTION 'DCC_CAMP_LIPSA: lipseste emitent' USING ERRCODE = '22023'; END IF;
  IF p_tip IS NULL THEN RAISE EXCEPTION 'DCC_CAMP_LIPSA: lipseste tip' USING ERRCODE = '22023'; END IF;
  IF p_secventa IS NULL THEN RAISE EXCEPTION 'DCC_CAMP_LIPSA: lipseste secventa' USING ERRCODE = '22023'; END IF;
  IF p_revizie IS NULL THEN RAISE EXCEPTION 'DCC_CAMP_LIPSA: lipseste revizie' USING ERRCODE = '22023'; END IF;
  SELECT (x ->> 'cifre')::integer INTO v_cf FROM jsonb_array_elements(p_format) x WHERE x ->> 'camp' = 'fila';
  SELECT (x ->> 'cifre')::integer INTO v_ca FROM jsonb_array_elements(p_format) x WHERE x ->> 'camp' = 'anexa';
  IF p_contract !~ '^[0-9]{2}$' THEN RAISE EXCEPTION 'DCC_VALOARE_INVALIDA: valoare invalida pentru contract' USING ERRCODE = '22023'; END IF;
  IF p_emitent !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'DCC_VALOARE_INVALIDA: valoare invalida pentru emitent' USING ERRCODE = '22023'; END IF;
  IF p_tematica IS NOT NULL AND p_tematica !~ '^[A-Z0-9]{2,4}$' THEN
    RAISE EXCEPTION 'DCC_VALOARE_INVALIDA: valoare invalida pentru tematica' USING ERRCODE = '22023';
  END IF;
  IF p_tip !~ '^[A-Z]{2,4}$' THEN RAISE EXCEPTION 'DCC_VALOARE_INVALIDA: valoare invalida pentru tip' USING ERRCODE = '22023'; END IF;
  IF p_secventa < 1 OR p_secventa > 99999 THEN RAISE EXCEPTION 'DCC_VALOARE_INVALIDA: valoare invalida pentru secventa' USING ERRCODE = '22023'; END IF;
  IF p_fila IS NOT NULL AND (p_fila < 1 OR p_fila > (10 ^ v_cf)::integer - 1) THEN
    RAISE EXCEPTION 'DCC_VALOARE_INVALIDA: valoare invalida pentru fila' USING ERRCODE = '22023';
  END IF;
  IF p_anexa IS NOT NULL AND (p_anexa < 1 OR p_anexa > (10 ^ v_ca)::integer - 1) THEN
    RAISE EXCEPTION 'DCC_VALOARE_INVALIDA: valoare invalida pentru anexa' USING ERRCODE = '22023';
  END IF;
  IF p_fila IS NOT NULL AND p_anexa IS NOT NULL THEN
    RAISE EXCEPTION 'DCC_VALOARE_INVALIDA: valoare invalida pentru fila/anexa' USING ERRCODE = '22023';
  END IF;
  IF p_revizie < 0 THEN RAISE EXCEPTION 'DCC_VALOARE_INVALIDA: valoare invalida pentru revizie' USING ERRCODE = '22023'; END IF;
  IF p_limba IS NOT NULL AND p_limba !~ '^(RO|EN|BI)$' THEN
    RAISE EXCEPTION 'DCC_VALOARE_INVALIDA: valoare invalida pentru limba' USING ERRCODE = '22023';
  END IF;
  IF p_limba IS NULL AND p_format @> '[{"camp": "limba"}]'::jsonb THEN
    RAISE EXCEPTION 'DCC_LIMBA_LIPSA: ghidul cere limba' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_format) WITH ORDINALITY a(x, i) ORDER BY i LOOP
    v_val := CASE e ->> 'camp'
               WHEN 'contract' THEN p_contract WHEN 'emitent' THEN p_emitent WHEN 'tematica' THEN p_tematica WHEN 'tip' THEN p_tip
               WHEN 'secventa' THEN lpad(p_secventa::text, 5, '0')
               WHEN 'fila' THEN lpad(p_fila::text, v_cf, '0')
               WHEN 'anexa' THEN lpad(p_anexa::text, v_ca, '0')
               WHEN 'revizie' THEN p_revizie::text
               WHEN 'limba' THEN p_limba END;
    IF v_val IS NOT NULL THEN v_out := v_out || (e ->> 'prefix') || v_val; END IF;
  END LOOP;
  RETURN v_out;
END $f$;

-- titlul scurt din numele fișierului (oglinda titluScurtDcc): diacriticele românești (cu virgulă și cu sedilă, mici și mari) -> ASCII printr-o hartă
-- EXPLICITĂ (codurile scrise cu chr()), orice alt caracter din afara [A-Za-z0-9] -> _, _ repetate -> unul, fără _ la capete, 60 de caractere.
CREATE FUNCTION public.fn_dcc_titlu_scurt(p_titlu text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE v text;
BEGIN
  IF p_titlu IS NULL THEN RAISE EXCEPTION 'DCC_TITLU_SCURT_GOL: titlul scurt lipseste' USING ERRCODE = '22023'; END IF;
  -- ă â î ș ş ț ţ Ă Â Î Ș Ş Ț Ţ
  v := translate(p_titlu,
         chr(259) || chr(226) || chr(238) || chr(537) || chr(351) || chr(539) || chr(355)
         || chr(258) || chr(194) || chr(206) || chr(536) || chr(350) || chr(538) || chr(354),
         'aaisstt' || 'AAISSTT');
  v := regexp_replace(v, '[^A-Za-z0-9]', '_', 'g');
  v := regexp_replace(v, '_+', '_', 'g');
  v := regexp_replace(v, '^_+|_+$', '', 'g');
  v := regexp_replace(left(v, 60), '_+$', '');
  IF v = '' THEN RAISE EXCEPTION 'DCC_TITLU_SCURT_GOL: titlul scurt e gol dupa curatare' USING ERRCODE = '22023'; END IF;
  RETURN v;
END $f$;

-- numele complet al fișierului (oglinda numeFisierDcc): codul în formatul de FIȘIER + _<titlu scurt>.<ext>; extensia verificată ÎNAINTEA literelor mici
CREATE FUNCTION public.fn_dcc_nume_fisier(p_format jsonb, p_contract text, p_emitent text, p_tematica text, p_tip text, p_secventa integer,
                                          p_fila integer, p_anexa integer, p_revizie integer, p_limba text, p_titlu_scurt text, p_ext text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE v_cod text; v_titlu text;
BEGIN
  v_cod := public.fn_dcc_cod_text(p_format, p_contract, p_emitent, p_tematica, p_tip, p_secventa, p_fila, p_anexa, p_revizie, p_limba);
  v_titlu := public.fn_dcc_titlu_scurt(p_titlu_scurt);
  IF p_ext IS NULL OR p_ext !~ '^[A-Za-z0-9]{1,8}$' THEN
    RAISE EXCEPTION 'DCC_EXTENSIE_INVALIDA: extensia nu e [a-z0-9]{1,8}' USING ERRCODE = '22023';
  END IF;
  RETURN v_cod || '_' || v_titlu || '.' || lower(p_ext);
END $f$;

-- hash-ul unei intenții: sha256 pe {op, p} (jsonb are ordinea cheilor canonică; p_parametri vine deja normalizat de RPC)
CREATE FUNCTION public.fn_dcc_hash_parametri(p_operatie text, p_parametri jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT encode(sha256(convert_to(jsonb_build_object('op', p_operatie, 'p', p_parametri)::text, 'UTF8')), 'hex')
$f$;

-- tabelul TRANZIȚIILOR stării de transport (PR1): SINGURA definiție (L19, L20). false (nu NULL) pentru orice pereche din afara tabelului.
-- trimisa_erp / necunoscut nu sunt ținte în PR1 (PR4 schimbă funcția); neverificata -> confirmata cere dovada (triggerul dcc_revizii).
CREATE FUNCTION public.fn_dcc_tranzitie_permisa(p_vechi text, p_nou text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT EXISTS (SELECT 1 FROM (VALUES
    -- TRANZITII-START
    ('rezervata', 'pregatita'), ('rezervata', 'copiata_pentru_gmail'), ('rezervata', 'trimisa_manual_neverificata'), ('rezervata', 'anulata'),
    ('pregatita', 'copiata_pentru_gmail'), ('pregatita', 'trimisa_manual_neverificata'), ('pregatita', 'anulata'),
    ('copiata_pentru_gmail', 'copiata_pentru_gmail'), ('copiata_pentru_gmail', 'trimisa_manual_neverificata'), ('copiata_pentru_gmail', 'anulata'),
    ('trimisa_manual_neverificata', 'trimisa_manual_confirmata')
    -- TRANZITII-END
  ) t(vechi, nou) WHERE t.vechi = p_vechi AND t.nou = p_nou)
$f$;

-- amprenta conținutului unui rând de istoric (L16: toate câmpurile admise, cu valorile implicite completate; problemele sortate), pusă de server
-- (triggerul dcc_istoric_aparitii la INSERT) și folosită de import pentru a deosebi „identic” de „diferit”
CREATE FUNCTION public.fn_dcc_istoric_hash(p_sursa text, p_sursa_id text, p_pozitie integer, p_valori jsonb, p_cod_scris text, p_emitent text,
                                           p_tematica text, p_tip text, p_secventa integer, p_fila integer, p_anexa integer, p_revizie integer,
                                           p_limba text, p_probleme text[]) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT encode(sha256(convert_to(jsonb_build_object('sursa', p_sursa, 'sursa_id', p_sursa_id, 'pozitie', p_pozitie, 'valori_originale', p_valori,
    'cod_scris', p_cod_scris, 'emitent', p_emitent, 'tematica', p_tematica, 'tip', p_tip, 'secventa', p_secventa, 'fila', p_fila, 'anexa', p_anexa,
    'revizie', p_revizie, 'limba', p_limba,
    'probleme', coalesce((SELECT jsonb_agg(x ORDER BY x) FROM unnest(p_probleme) x), '[]'::jsonb))::text, 'UTF8')), 'hex')
$f$;

-- amprenta unui snapshot pe forma canonică documentată: sha256 pe textul jsonb al obiectului {tip, from, to, cc, subiect, corp, linkuri, manifest}
-- (ordinea cheilor = cea a jsonb: după lungime, apoi octeți). Doar identifică snapshotul; copia e chiar rândul.
CREATE FUNCTION public.fn_dcc_snapshot_hash(p_tip text, p_from text, p_to text[], p_cc text[], p_subiect text, p_corp text, p_linkuri text[],
                                            p_manifest jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT encode(sha256(convert_to(jsonb_build_object('tip', p_tip, 'from', p_from, 'to', to_jsonb(coalesce(p_to, '{}'::text[])),
    'cc', to_jsonb(coalesce(p_cc, '{}'::text[])), 'subiect', p_subiect, 'corp', p_corp, 'linkuri', to_jsonb(coalesce(p_linkuri, '{}'::text[])),
    'manifest', coalesce(p_manifest, '[]'::jsonb))::text, 'UTF8')), 'hex')
$f$;

REVOKE ALL ON FUNCTION public.fn_dcc_istoric_hash(text, text, integer, jsonb, text, text, text, text, integer, integer, integer, integer, text, text[]),
  public.fn_dcc_snapshot_hash(text, text, text[], text[], text, text, text[], jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_dcc_istoric_hash(text, text, integer, jsonb, text, text, text, text, integer, integer, integer, integer, text, text[]),
  public.fn_dcc_snapshot_hash(text, text, text[], text[], text, text, text[], jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_dcc_interval_e_canonic(text), public.fn_dcc_interval_canonic(text), public.fn_dcc_format_valid(jsonb),
  public.fn_dcc_cod_text(jsonb, text, text, text, text, integer, integer, integer, integer, text), public.fn_dcc_titlu_scurt(text),
  public.fn_dcc_nume_fisier(jsonb, text, text, text, text, integer, integer, integer, integer, text, text, text),
  public.fn_dcc_hash_parametri(text, jsonb), public.fn_dcc_tranzitie_permisa(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_dcc_interval_e_canonic(text), public.fn_dcc_interval_canonic(text), public.fn_dcc_format_valid(jsonb),
  public.fn_dcc_cod_text(jsonb, text, text, text, text, integer, integer, integer, integer, text), public.fn_dcc_titlu_scurt(text),
  public.fn_dcc_nume_fisier(jsonb, text, text, text, text, integer, integer, integer, integer, text, text, text),
  public.fn_dcc_hash_parametri(text, jsonb), public.fn_dcc_tranzitie_permisa(text, text) TO authenticated;

-- ─── 2. TOATE tabelele, în ordinea cheilor străine: coloane, CHECK-uri NUMITE (fiecare într-o clasă a inventarului față de NULL — planul, A3),
-- UNIQUE, chei străine, RLS ACTIV și nimic acordat. Politicile și GRANT SELECT vin în secțiunea 3, triggerele în 4: la orice commit intermediar
-- accesul e ÎNCHIS, nu deschis.

-- ─── 2a. configurarea și intențiile
-- căsuțele de trimitere: structura pentru PR4 / B, GOALĂ în PR1 (nicio politică, niciun GRANT, niciun RPC)
CREATE TABLE public.dcc_casute (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  adresa text NOT NULL,
  tip text NOT NULL,
  proprietar uuid,
  stare_conectare text NOT NULL DEFAULT 'neconectata',
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dcc_casute_adresa_ck CHECK (adresa = lower(adresa) AND adresa ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  CONSTRAINT dcc_casute_adresa_uq UNIQUE (adresa),
  CONSTRAINT dcc_casute_tip_ck CHECK (tip IN ('dedicata', 'personala')),
  CONSTRAINT dcc_casute_stare_ck CHECK (stare_conectare IN ('neconectata', 'conectata', 'revocata')),
  CONSTRAINT dcc_casute_proprietar_ck CHECK ((tip = 'personala') = (proprietar IS NOT NULL))
);

-- ghidurile de codificare (versionate, înghețate după creare: o schimbare = versiune nouă)
CREATE TABLE public.dcc_ghiduri (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  cod text NOT NULL,
  versiune integer NOT NULL,
  sursa text NOT NULL,
  format_cod jsonb NOT NULL,
  format_fisier jsonb NOT NULL,
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dcc_ghiduri_cod_ck CHECK (cod ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  CONSTRAINT dcc_ghiduri_versiune_ck CHECK (versiune >= 1),
  CONSTRAINT dcc_ghiduri_sursa_ck CHECK (sursa ~ '[^[:space:]]' AND length(sursa) <= 300),
  CONSTRAINT dcc_ghiduri_format_cod_ck CHECK (public.fn_dcc_format_valid(format_cod) IS TRUE),
  CONSTRAINT dcc_ghiduri_format_fisier_ck CHECK (public.fn_dcc_format_valid(format_fisier) IS TRUE),
  -- perechea: limba în cel puțin unul din formate (oglinda formatePereche; @> pe jsonb NOT NULL nu dă NULL)
  CONSTRAINT dcc_ghiduri_limba_ck CHECK (format_cod @> '[{"camp": "limba"}]'::jsonb OR format_fisier @> '[{"camp": "limba"}]'::jsonb),
  CONSTRAINT dcc_ghiduri_cod_versiune_uq UNIQUE (cod, versiune)
);

-- listele ghidului: emitenți, tematici, tipuri (fara_tematica = seria fără tematică, ex. minutele), limbi
CREATE TABLE public.dcc_ghid_valori (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  ghid_id bigint NOT NULL REFERENCES public.dcc_ghiduri(id),
  categorie text NOT NULL,
  cod text NOT NULL,
  descriere text,
  fara_tematica boolean NOT NULL DEFAULT false,
  activ boolean NOT NULL DEFAULT true,
  CONSTRAINT dcc_ghid_valori_categorie_ck CHECK (categorie IN ('emitent', 'tematica', 'tip', 'limba')),
  CONSTRAINT dcc_ghid_valori_forma_ck CHECK (CASE categorie WHEN 'emitent' THEN cod ~ '^[A-Z]{3}$' WHEN 'tematica' THEN cod ~ '^[A-Z0-9]{2,4}$'
                                                       WHEN 'tip' THEN cod ~ '^[A-Z]{2,4}$' WHEN 'limba' THEN cod ~ '^(RO|EN|BI)$' ELSE false END),
  CONSTRAINT dcc_ghid_valori_fara_tematica_ck CHECK (fara_tematica = false OR categorie = 'tip'),
  CONSTRAINT dcc_ghid_valori_uq UNIQUE (ghid_id, categorie, cod)
);

-- intervalele ghidului (general / SR1 …), disjuncte în același ghid (triggerul din secțiunea 4); disjuncția ÎNTRE ghiduri e pe seriile efective
CREATE TABLE public.dcc_ghid_intervale (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  ghid_id bigint NOT NULL REFERENCES public.dcc_ghiduri(id),
  interval text NOT NULL,
  limita_inf integer NOT NULL,
  limita_sup integer NOT NULL,
  CONSTRAINT dcc_ghid_intervale_interval_ck CHECK (public.fn_dcc_interval_e_canonic(interval) IS TRUE),
  CONSTRAINT dcc_ghid_intervale_limite_ck CHECK (1 <= limita_inf AND limita_inf <= limita_sup AND limita_sup <= 99999),
  CONSTRAINT dcc_ghid_intervale_uq UNIQUE (ghid_id, interval)
);

-- contractul = domeniul numerotării (beneficiar, cod 30 / 43 / 29); mod_alocare fixat la creare și IMUABIL ([D2])
CREATE TABLE public.dcc_contracte (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  beneficiar text NOT NULL,
  cod_contract text NOT NULL,
  mod_alocare text NOT NULL,
  descriere text,
  creat_de uuid,
  creat_prin text NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dcc_contracte_beneficiar_ck CHECK (beneficiar ~ '^[A-Z]{2,6}$'),
  CONSTRAINT dcc_contracte_cod_ck CHECK (cod_contract ~ '^[0-9]{2}$'),
  CONSTRAINT dcc_contracte_mod_ck CHECK (mod_alocare IN ('automat', 'manual')),
  CONSTRAINT dcc_contracte_creat_prin_ck CHECK (creat_prin IN ('om', 'server')),
  CONSTRAINT dcc_contracte_creat_ck CHECK ((creat_prin = 'server') = (creat_de IS NULL)),
  CONSTRAINT dcc_contracte_uq UNIQUE (beneficiar, cod_contract)
);

-- proiectul DCC: un proiect Execuție pe un contract; ghidul aplicat, emitentul nostru, setările de corespondență. NICIO trimitere în PR1:
-- casuta_id și trimitere_permisa sunt fixate prin CHECK (PR4 le relaxează printr-o migrare proprie).
CREATE TABLE public.dcc_proiecte (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  contract_id bigint NOT NULL REFERENCES public.dcc_contracte(id),
  executie_proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  ghid_id bigint NOT NULL REFERENCES public.dcc_ghiduri(id),
  emitent text NOT NULL,
  limba_implicita text,
  adresa_dcc text,
  cc_lista text[] NOT NULL DEFAULT '{}'::text[],
  cc_implicit jsonb NOT NULL DEFAULT '{}'::jsonb,
  antet_financiar text,
  plafon_atasamente_mb integer NOT NULL DEFAULT 15,
  casuta_id bigint REFERENCES public.dcc_casute(id),
  trimitere_permisa boolean NOT NULL DEFAULT false,
  versiune integer NOT NULL DEFAULT 1,
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  actualizat_de uuid,
  actualizat_la timestamptz,
  CONSTRAINT dcc_proiecte_emitent_ck CHECK (emitent ~ '^[A-Z]{3}$'),
  CONSTRAINT dcc_proiecte_limba_ck CHECK (limba_implicita IS NULL OR limba_implicita IN ('RO', 'EN', 'BI')),
  CONSTRAINT dcc_proiecte_adresa_ck CHECK (adresa_dcc IS NULL OR adresa_dcc ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  CONSTRAINT dcc_proiecte_cc_implicit_ck CHECK (jsonb_typeof(cc_implicit) = 'object'),
  CONSTRAINT dcc_proiecte_plafon_ck CHECK (plafon_atasamente_mb BETWEEN 1 AND 25),
  CONSTRAINT dcc_proiecte_casuta_ck CHECK (casuta_id IS NULL),
  CONSTRAINT dcc_proiecte_trimitere_ck CHECK (trimitere_permisa = false),
  CONSTRAINT dcc_proiecte_versiune_ck CHECK (versiune >= 1),
  CONSTRAINT dcc_proiecte_executie_contract_uq UNIQUE (executie_proiect_id, contract_id),
  CONSTRAINT dcc_proiecte_id_contract_uq UNIQUE (id, contract_id)
);

-- cheile de intenție (L04 / L05): o cheie UUID per intenție, cu hash-ul parametrilor normalizați + operația + autorul; rezultatul se scrie o dată
CREATE TABLE public.dcc_intentii (
  cheie uuid PRIMARY KEY,
  operatie text NOT NULL,
  parametri_hash text NOT NULL,
  autor uuid,
  actor text NOT NULL,
  rezultat jsonb,
  creat_la timestamptz NOT NULL DEFAULT now(),
  -- tranzacția (de nivel superior) care a revendicat cheia: rezultatul se scrie DOAR în ea (triggerul din secțiunea 4); xid8, nu xmin —
  -- xmin ar fi id-ul unei sub-tranzacții dacă apelul rulează sub un SAVEPOINT al clientului
  creat_tx xid8 NOT NULL DEFAULT pg_current_xact_id(),
  CONSTRAINT dcc_intentii_operatie_ck CHECK (operatie IN ('ghid_creeaza', 'contract_creeaza', 'proiect_seteaza', 'initializeaza_serie', 'aloca',
    'aloca_manual', 'revizie_noua', 'fila_noua', 'anexa_noua', 'anuleaza', 'marcheaza_copiat', 'confirma_trimis_manual', 'istoric_importa')),
  CONSTRAINT dcc_intentii_hash_ck CHECK (parametri_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT dcc_intentii_actor_ck CHECK (actor IN ('om', 'server')),
  CONSTRAINT dcc_intentii_autor_ck CHECK ((actor = 'server') = (autor IS NULL))
);

-- ─── 2b. registrul: serii, documente, file, anexe, revizii
-- seria = contorul pe (contract, emitent, tematica, tip, interval); domeniul = contractul. Nicio politică, niciun GRANT: se citește prin
-- fn_dcc_serii_proiect ([D1]). O serie neinițializată refuză alocarea (nu pornește singură de la 00001).
CREATE TABLE public.dcc_serii (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  contract_id bigint NOT NULL REFERENCES public.dcc_contracte(id),
  emitent text NOT NULL,
  tematica text,
  tip text NOT NULL,
  interval text NOT NULL,
  ghid_id bigint NOT NULL REFERENCES public.dcc_ghiduri(id),
  limita_inf integer NOT NULL,
  limita_sup integer NOT NULL,
  prag_initial integer NOT NULL,
  ultimul_ocupat integer NOT NULL,
  motiv_prag text NOT NULL,
  max_istoric_la_init integer,
  initializata_de uuid,
  initializata_prin text NOT NULL,
  initializata_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dcc_serii_interval_ck CHECK (public.fn_dcc_interval_e_canonic(interval) IS TRUE),
  CONSTRAINT dcc_serii_motiv_ck CHECK (motiv_prag ~ '[^[:space:]]' AND length(motiv_prag) <= 500),
  CONSTRAINT dcc_serii_initializata_prin_ck CHECK (initializata_prin IN ('om', 'server')),
  CONSTRAINT dcc_serii_initializata_ck CHECK ((initializata_prin = 'server') = (initializata_de IS NULL)),
  CONSTRAINT dcc_serii_limite_ck CHECK (1 <= limita_inf AND limita_inf <= limita_sup AND limita_sup <= 99999),
  CONSTRAINT dcc_serii_prag_ck CHECK (prag_initial BETWEEN limita_inf - 1 AND limita_sup),
  CONSTRAINT dcc_serii_ultimul_ck CHECK (ultimul_ocupat BETWEEN prag_initial AND limita_sup),
  CONSTRAINT dcc_serii_cheie_uq UNIQUE NULLS NOT DISTINCT (contract_id, emitent, tematica, tip, interval)
);

-- documentul: identitatea stabilă (contract, emitent, tematica, tip, secventa) UNICĂ pe contract, NEPARȚIALĂ (anularea nu eliberează numărul);
-- minutele (tematica NULL) prin NULLS NOT DISTINCT. proiect_dcc_id = asocierea și accesul (citirea strictă pe proiect, [D1]).
CREATE TABLE public.dcc_documente (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  contract_id bigint NOT NULL,
  proiect_dcc_id bigint NOT NULL,
  emitent text NOT NULL,
  tematica text,
  tip text NOT NULL,
  secventa integer NOT NULL,
  interval text,
  serie_id bigint REFERENCES public.dcc_serii(id),
  mod text NOT NULL,
  titlu text NOT NULL,
  are_file boolean NOT NULL,
  stare text NOT NULL DEFAULT 'activ',
  anulat_de uuid,
  anulat_la timestamptz,
  motiv_anulare text,
  creat_de uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dcc_documente_proiect_fk FOREIGN KEY (proiect_dcc_id, contract_id) REFERENCES public.dcc_proiecte (id, contract_id),
  CONSTRAINT dcc_documente_secventa_ck CHECK (secventa BETWEEN 1 AND 99999),
  CONSTRAINT dcc_documente_interval_ck CHECK (interval IS NULL OR public.fn_dcc_interval_e_canonic(interval) IS TRUE),
  CONSTRAINT dcc_documente_mod_ck CHECK (mod IN ('automat', 'manual')),
  CONSTRAINT dcc_documente_titlu_ck CHECK (titlu ~ '[^[:space:]]' AND length(titlu) <= 300),
  CONSTRAINT dcc_documente_stare_val_ck CHECK (stare IN ('activ', 'anulat')),
  CONSTRAINT dcc_documente_automat_ck CHECK ((mod = 'automat') = (serie_id IS NOT NULL AND interval IS NOT NULL)),
  CONSTRAINT dcc_documente_stare_ck CHECK ((stare = 'anulat') = (anulat_la IS NOT NULL)),
  -- motiv_anulare IS NOT NULL EXPLICIT: fără el, un motiv NULL face ramura NULL, iar UNKNOWN trece CHECK-ul (planul, runda 3)
  CONSTRAINT dcc_documente_anulare_ck CHECK (anulat_la IS NULL OR (anulat_de IS NOT NULL AND motiv_anulare IS NOT NULL AND motiv_anulare ~ '[^[:space:]]'
                                                                  AND length(motiv_anulare) <= 500)),
  CONSTRAINT dcc_documente_neanulat_ck CHECK (anulat_la IS NOT NULL OR (anulat_de IS NULL AND motiv_anulare IS NULL)),
  CONSTRAINT dcc_documente_cod_uq UNIQUE NULLS NOT DISTINCT (contract_id, emitent, tematica, tip, secventa),
  CONSTRAINT dcc_documente_id_contract_uq UNIQUE (id, contract_id),
  CONSTRAINT dcc_documente_id_proiect_uq UNIQUE (id, proiect_dcc_id)
);

-- filele (planșele) unui document declarat cu file la alocare ([D3]); imuabile
CREATE TABLE public.dcc_file (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES public.dcc_documente(id),
  fila integer NOT NULL,
  titlu text,
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dcc_file_fila_ck CHECK (fila BETWEEN 1 AND 999),
  CONSTRAINT dcc_file_uq UNIQUE (document_id, fila)
);

-- anexele unui document (codul de bază + numărul anexei, cu revizii proprii); imuabile
CREATE TABLE public.dcc_anexe (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES public.dcc_documente(id),
  numar integer NOT NULL,
  titlu text NOT NULL,
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dcc_anexe_numar_ck CHECK (numar BETWEEN 1 AND 999),
  CONSTRAINT dcc_anexe_titlu_ck CHECK (titlu ~ '[^[:space:]]' AND length(titlu) <= 300),
  CONSTRAINT dcc_anexe_uq UNIQUE (document_id, numar)
);

-- reviziile: pe document / filă / anexă, cu limba în identitate; codul și rădăcina numelui de fișier ÎNGHEȚATE (nu se reformatează la un ghid
-- nou); starea de transport (copierea nu dovedește expedierea); motivul anulării pe revizie; verdictul DCC doar confirmat de om (B).
-- contract_id denormalizat (legat de document prin cheia compusă) pentru unicitatea textului pe contract (Abaterea 6).
CREATE TABLE public.dcc_revizii (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  contract_id bigint NOT NULL,
  document_id bigint NOT NULL,
  fila_id bigint REFERENCES public.dcc_file(id),
  anexa_id bigint REFERENCES public.dcc_anexe(id),
  revizie integer NOT NULL,
  limba text,
  titlu text,
  ghid_id bigint NOT NULL REFERENCES public.dcc_ghiduri(id),
  cod_text text NOT NULL,
  nume_fisier_baza text NOT NULL,
  stare_transport text NOT NULL DEFAULT 'rezervata',
  anulata_de uuid,
  anulata_la timestamptz,
  anulata_prin text,
  motiv_anulare text,
  nr_adresa_interna text,
  verdict text,
  verdict_mesaj_id bigint,
  verdict_confirmat_de uuid,
  verdict_confirmat_la timestamptz,
  creat_de uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  actualizat_la timestamptz,
  CONSTRAINT dcc_revizii_document_fk FOREIGN KEY (document_id, contract_id) REFERENCES public.dcc_documente (id, contract_id),
  CONSTRAINT dcc_revizii_revizie_ck CHECK (revizie >= 0),
  CONSTRAINT dcc_revizii_limba_ck CHECK (limba IS NULL OR limba IN ('RO', 'EN', 'BI')),
  CONSTRAINT dcc_revizii_stare_val_ck CHECK (stare_transport IN ('rezervata', 'pregatita', 'copiata_pentru_gmail', 'trimisa_manual_neverificata',
                                                                 'trimisa_manual_confirmata', 'trimisa_erp', 'necunoscut', 'anulata')),
  CONSTRAINT dcc_revizii_anulata_prin_val_ck CHECK (anulata_prin IS NULL OR anulata_prin IN ('revizie', 'document')),
  CONSTRAINT dcc_revizii_verdict_val_ck CHECK (verdict IS NULL OR verdict IN ('validat', 'nevalidat', 'vizat', 'cod_respins', 'observatii',
                                                                              'A', 'B', 'C', 'D', 'E')),
  CONSTRAINT dcc_revizii_tinta_ck CHECK (num_nonnulls(fila_id, anexa_id) <= 1),
  CONSTRAINT dcc_revizii_stare_ck CHECK ((stare_transport = 'anulata') = (anulata_la IS NOT NULL)),
  CONSTRAINT dcc_revizii_anulare_ck CHECK (anulata_la IS NULL OR (anulata_de IS NOT NULL AND anulata_prin IS NOT NULL AND motiv_anulare IS NOT NULL
                                                                  AND motiv_anulare ~ '[^[:space:]]' AND length(motiv_anulare) <= 500)),
  CONSTRAINT dcc_revizii_neanulata_ck CHECK (anulata_la IS NOT NULL OR (anulata_de IS NULL AND anulata_prin IS NULL AND motiv_anulare IS NULL)),
  CONSTRAINT dcc_revizii_verdict_ck CHECK (verdict IS NULL OR (verdict_mesaj_id IS NOT NULL AND verdict_confirmat_de IS NOT NULL
                                                               AND verdict_confirmat_la IS NOT NULL)),
  CONSTRAINT dcc_revizii_uq UNIQUE NULLS NOT DISTINCT (document_id, fila_id, anexa_id, revizie, limba),
  CONSTRAINT dcc_revizii_cod_uq UNIQUE NULLS NOT DISTINCT (contract_id, cod_text, limba)
);

-- ─── 2c. istoricul brut (imuabil; identitatea sursei unică pe PROIECT; revizia absentă = NULL, niciodată 0)
CREATE TABLE public.dcc_istoric_aparitii (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  contract_id bigint NOT NULL,
  proiect_dcc_id bigint NOT NULL,
  sursa text NOT NULL,
  sursa_id text NOT NULL,
  pozitie integer NOT NULL DEFAULT 1,
  lot_import text NOT NULL,
  valori_originale jsonb NOT NULL,
  cod_scris text,
  emitent text,
  tematica text,
  tip text,
  secventa integer,
  fila integer,
  anexa integer,
  revizie integer,
  limba text,
  probleme text[] NOT NULL DEFAULT '{}'::text[],
  continut_hash text NOT NULL,
  document_id bigint,
  revizie_id bigint REFERENCES public.dcc_revizii(id),
  legat_de uuid,
  legat_la timestamptz,
  importat_de uuid,
  importat_prin text NOT NULL,
  importat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dcc_istoric_aparitii_proiect_fk FOREIGN KEY (proiect_dcc_id, contract_id) REFERENCES public.dcc_proiecte (id, contract_id),
  CONSTRAINT dcc_istoric_aparitii_document_fk FOREIGN KEY (document_id, proiect_dcc_id) REFERENCES public.dcc_documente (id, proiect_dcc_id),
  CONSTRAINT dcc_istoric_aparitii_sursa_ck CHECK (sursa IN ('excel_registru', 'mail_trimis', 'mail_primit')),
  CONSTRAINT dcc_istoric_aparitii_sursa_id_ck CHECK (sursa_id ~ '[^[:space:]]' AND length(sursa_id) <= 300),
  CONSTRAINT dcc_istoric_aparitii_pozitie_ck CHECK (pozitie >= 1),
  CONSTRAINT dcc_istoric_aparitii_lot_ck CHECK (lot_import ~ '^[A-Za-z0-9_.-]{1,60}$'),
  CONSTRAINT dcc_istoric_aparitii_valori_ck CHECK (jsonb_typeof(valori_originale) = 'object'),
  -- codul așa cum a fost scris: ORICE șir de cel mult 200 de caractere (inclusiv gol sau doar spații — e dată brută, nu se curăță)
  CONSTRAINT dcc_istoric_aparitii_cod_scris_ck CHECK (cod_scris IS NULL OR length(cod_scris) <= 200),
  CONSTRAINT dcc_istoric_aparitii_secventa_ck CHECK (secventa IS NULL OR secventa BETWEEN 1 AND 99999),
  CONSTRAINT dcc_istoric_aparitii_fila_ck CHECK (fila IS NULL OR fila BETWEEN 1 AND 999),
  CONSTRAINT dcc_istoric_aparitii_anexa_ck CHECK (anexa IS NULL OR anexa BETWEEN 1 AND 999),
  CONSTRAINT dcc_istoric_aparitii_revizie_ck CHECK (revizie IS NULL OR revizie >= 0),
  CONSTRAINT dcc_istoric_aparitii_limba_ck CHECK (limba IS NULL OR limba IN ('RO', 'EN', 'BI')),
  -- <@ pe o coloană NOT NULL: un element NULL în stânga dă false (nu NULL), deci CHECK-ul respinge (dovedit în p_check_inventar, nu presupus)
  CONSTRAINT dcc_istoric_aparitii_probleme_ck CHECK (probleme <@ ARRAY['dublura', 'forma_nestandard', 'revizie_necunoscuta', 'tematica_gresita',
                                                                       'cod_nerecunoscut', 'conflict']::text[]),
  CONSTRAINT dcc_istoric_aparitii_hash_ck CHECK (continut_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT dcc_istoric_aparitii_importat_prin_ck CHECK (importat_prin IN ('om', 'server')),
  CONSTRAINT dcc_istoric_aparitii_importat_ck CHECK ((importat_prin = 'server') = (importat_de IS NULL)),
  CONSTRAINT dcc_istoric_aparitii_revizie_problema_ck CHECK (cod_scris IS NULL
                                                             OR (((revizie IS NULL) = ('revizie_necunoscuta' = ANY (probleme))) IS TRUE)),
  CONSTRAINT dcc_istoric_sursa_uq UNIQUE (proiect_dcc_id, sursa, sursa_id, pozitie)
);

-- ─── 2d. snapshoturi, mesaje, legături (structura pentru B; în PR1 doar „copiat” și „confirm că am trimis”)
-- snapshotul = copia IMUABILĂ a ce a aprobat / copiat omul (fără BCC: nicio coloană); hash-ul îl calculează serverul pe forma canonică
CREATE TABLE public.dcc_snapshoturi (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  contract_id bigint NOT NULL,
  proiect_dcc_id bigint NOT NULL,
  tip text NOT NULL,
  from_adresa text,
  to_lista text[] NOT NULL,
  cc_lista text[] NOT NULL DEFAULT '{}'::text[],
  subiect text NOT NULL,
  corp text NOT NULL,
  linkuri text[] NOT NULL DEFAULT '{}'::text[],
  manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  hash text NOT NULL,
  aprobat_de uuid NOT NULL,
  aprobat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dcc_snapshoturi_proiect_fk FOREIGN KEY (proiect_dcc_id, contract_id) REFERENCES public.dcc_proiecte (id, contract_id),
  CONSTRAINT dcc_snapshoturi_tip_ck CHECK (tip IN ('copiat_gmail', 'aprobat_trimitere')),
  CONSTRAINT dcc_snapshoturi_subiect_ck CHECK (subiect ~ '[^[:space:]]'),
  CONSTRAINT dcc_snapshoturi_manifest_ck CHECK (jsonb_typeof(manifest) = 'array'),
  CONSTRAINT dcc_snapshoturi_hash_ck CHECK (hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT dcc_snapshoturi_id_proiect_uq UNIQUE (id, proiect_dcc_id)
);

CREATE TABLE public.dcc_snapshot_revizii (
  snapshot_id bigint NOT NULL REFERENCES public.dcc_snapshoturi(id),
  revizie_id bigint NOT NULL REFERENCES public.dcc_revizii(id),
  PRIMARY KEY (snapshot_id, revizie_id)
);

-- mesajul: trimis / primit; la trimiterile manuale (PR1) FĂRĂ ID-uri inventate (Message-ID, Gmail id, thread, căsuță = NULL; dovezi incomplete)
CREATE TABLE public.dcc_mesaje (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  contract_id bigint NOT NULL,
  proiect_dcc_id bigint NOT NULL,
  directie text NOT NULL,
  sursa text NOT NULL,
  casuta_id bigint REFERENCES public.dcc_casute(id),
  casuta_declarata text,
  rfc_message_id text,
  gmail_message_id text,
  gmail_thread_id text,
  in_reply_to text,
  references_lista text[],
  subiect_original text,
  subiect_normalizat text,
  from_adresa text,
  sender text,
  reply_to text,
  to_lista text[],
  cc_lista text[],
  data_mesaj timestamptz NOT NULL,
  manifest jsonb,
  snapshot_id bigint,
  dovezi_complete boolean NOT NULL,
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dcc_mesaje_proiect_fk FOREIGN KEY (proiect_dcc_id, contract_id) REFERENCES public.dcc_proiecte (id, contract_id),
  CONSTRAINT dcc_mesaje_snapshot_fk FOREIGN KEY (snapshot_id, proiect_dcc_id) REFERENCES public.dcc_snapshoturi (id, proiect_dcc_id),
  CONSTRAINT dcc_mesaje_directie_ck CHECK (directie IN ('trimis', 'primit')),
  CONSTRAINT dcc_mesaje_sursa_ck CHECK (sursa IN ('manual_declarat', 'erp', 'import_istoric', 'citire_casuta')),
  CONSTRAINT dcc_mesaje_thread_ck CHECK (gmail_thread_id IS NULL OR casuta_id IS NOT NULL),
  -- casuta_declarata IS NOT NULL EXPLICIT (aceeași clasă ca motivul anulării)
  CONSTRAINT dcc_mesaje_manual_ck CHECK (sursa <> 'manual_declarat' OR (rfc_message_id IS NULL AND gmail_message_id IS NULL AND gmail_thread_id IS NULL
                                         AND casuta_id IS NULL AND dovezi_complete = false AND casuta_declarata IS NOT NULL
                                         AND casuta_declarata ~ '[^[:space:]]')),
  CONSTRAINT dcc_mesaje_rfc_uq UNIQUE (directie, rfc_message_id),
  CONSTRAINT dcc_mesaje_gmail_uq UNIQUE (casuta_id, gmail_message_id)
);

-- legătura mesaj <-> revizie (m:n): metoda, dovada, starea; verdictul DCC propus stă aici până îl confirmă un om (B)
CREATE TABLE public.dcc_legaturi (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  mesaj_id bigint NOT NULL REFERENCES public.dcc_mesaje(id),
  revizie_id bigint NOT NULL REFERENCES public.dcc_revizii(id),
  metoda text NOT NULL,
  dovada jsonb NOT NULL DEFAULT '{}'::jsonb,
  stare text NOT NULL,
  verdict_propus text,
  autor uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  confirmat_de uuid,
  confirmat_la timestamptz,
  CONSTRAINT dcc_legaturi_metoda_ck CHECK (metoda IN ('antet_rfc', 'thread', 'cod_subiect', 'cod_corp', 'tipar_re', 'manual', 'emitere_erp')),
  CONSTRAINT dcc_legaturi_dovada_ck CHECK (jsonb_typeof(dovada) = 'object'),
  CONSTRAINT dcc_legaturi_stare_ck CHECK (stare IN ('propusa', 'confirmata', 'respinsa')),
  CONSTRAINT dcc_legaturi_verdict_ck CHECK (verdict_propus IS NULL OR verdict_propus IN ('validat', 'nevalidat', 'vizat', 'cod_respins', 'observatii',
                                                                                        'A', 'B', 'C', 'D', 'E')),
  CONSTRAINT dcc_legaturi_confirmare_ck CHECK (stare = 'propusa' OR confirmat_la IS NOT NULL),
  CONSTRAINT dcc_legaturi_uq UNIQUE (mesaj_id, revizie_id)
);

-- RLS ACTIV pe toate și NIMIC acordat (politicile și GRANT SELECT în secțiunea 3); secvențele de identitate fără drepturi pentru rolurile API
ALTER TABLE public.dcc_casute ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_ghiduri ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_ghid_valori ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_ghid_intervale ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_contracte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_proiecte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_intentii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_serii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_documente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_anexe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_revizii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_istoric_aparitii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_snapshoturi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_snapshot_revizii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_mesaje ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcc_legaturi ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dcc_casute, public.dcc_ghiduri, public.dcc_ghid_valori, public.dcc_ghid_intervale, public.dcc_contracte, public.dcc_proiecte,
  public.dcc_intentii, public.dcc_serii, public.dcc_documente, public.dcc_file, public.dcc_anexe, public.dcc_revizii, public.dcc_istoric_aparitii,
  public.dcc_snapshoturi, public.dcc_snapshot_revizii, public.dcc_mesaje, public.dcc_legaturi FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.dcc_casute_id_seq, public.dcc_ghiduri_id_seq, public.dcc_ghid_valori_id_seq, public.dcc_ghid_intervale_id_seq,
  public.dcc_contracte_id_seq, public.dcc_proiecte_id_seq, public.dcc_serii_id_seq, public.dcc_documente_id_seq, public.dcc_file_id_seq,
  public.dcc_anexe_id_seq, public.dcc_revizii_id_seq, public.dcc_istoric_aparitii_id_seq, public.dcc_snapshoturi_id_seq, public.dcc_mesaje_id_seq,
  public.dcc_legaturi_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- ─── 3. dreptul, intențiile, ajutătoarele interne, politicile, GRANT SELECT, vederea (toate funcțiile plpgsql: corpul nu e analizat la creare,
-- deci crearea nu ia lock-uri pe profiles / user_module_access / executie_proiecte)

-- calea serverului ([D5]): sesiune postgres FĂRĂ JWT. Un apel API intră ca authenticator (session_user) și schimbă rolul; într-un RPC DEFINER
-- current_user devine postgres, dar session_user rămâne authenticator -> NU e calea serverului. INVOKER (ca fn_rest_decontat_server).
CREATE FUNCTION public.fn_dcc_server() RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
BEGIN
  RETURN auth.uid() IS NULL AND session_user = 'postgres' AND current_user = 'postgres';
END $f$;

CREATE FUNCTION public.fn_dcc_e_owner() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid();
BEGIN
  RETURN v_uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.is_owner IS TRUE);
END $f$;

-- SINGURA definiție a dreptului (L19): apelantul autentificat + proiectul DCC există + restricția pe proiect (20261209a; scrierea cere lista de
-- scriere) + (owner SAU sub-modulul executie_dcc la nivelul cerut). Accesul general „executie” NU dă nimic. Niciodată NULL.
CREATE FUNCTION public.fn_dcc_drept(p_proiect_dcc bigint, p_nivel text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_exec bigint; v_acces text;
BEGIN
  IF v_uid IS NULL OR p_proiect_dcc IS NULL OR p_nivel IS NULL OR p_nivel NOT IN ('citire', 'scriere', 'admin') THEN RETURN false; END IF;
  SELECT d.executie_proiect_id INTO v_exec FROM public.dcc_proiecte d WHERE d.id = p_proiect_dcc;
  IF NOT FOUND THEN RETURN false; END IF;
  IF public.fn_executie_proiect_permis(v_exec, p_nivel <> 'citire') IS NOT TRUE THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.is_owner IS TRUE) THEN RETURN true; END IF;
  SELECT u.access_level INTO v_acces FROM public.user_module_access u WHERE u.profile_id = v_uid AND u.module = 'executie_dcc';
  RETURN coalesce(CASE p_nivel WHEN 'citire' THEN v_acces IN ('viewer', 'editor', 'admin')
                               WHEN 'scriere' THEN v_acces IN ('editor', 'admin')
                               WHEN 'admin' THEN v_acces = 'admin' END, false);
END $f$;

-- [D1] DOAR pentru politica dcc_contracte: contractul se vede dacă apelantul citește un proiect DCC al lui
CREATE FUNCTION public.fn_dcc_contract_vizibil(p_contract bigint) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.dcc_proiecte d WHERE d.contract_id = p_contract AND public.fn_dcc_drept(d.id, 'citire'));
END $f$;

-- configurația comună de codificare (ghiduri, valori, intervale): owner sau orice nivel pe executie_dcc
CREATE FUNCTION public.fn_dcc_are_modul() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid();
BEGIN
  RETURN v_uid IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = v_uid AND u.module = 'executie_dcc'
                       AND u.access_level IN ('viewer', 'editor', 'admin')));
END $f$;

-- ── cheile de intenție (interne, fără EXECUTE). Reluarea: aceeași operație + același hash + același autor (auth.uid(), NULL pe calea serverului)
-- = rezultatul comis cu reluat: true; orice diferență = DCC_CHEIE_ALTI_PARAMETRI (același mesaj pentru operație / hash / autor). ──
CREATE FUNCTION public.fn_dcc_intentie_reia(p_cheie uuid, p_operatie text, p_hash text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE r public.dcc_intentii;
BEGIN
  SELECT * INTO r FROM public.dcc_intentii i WHERE i.cheie = p_cheie;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF r.operatie IS DISTINCT FROM p_operatie OR r.parametri_hash IS DISTINCT FROM p_hash OR r.autor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'DCC_CHEIE_ALTI_PARAMETRI: cheia de intentie a fost folosita pentru alta cerere' USING ERRCODE = '22023';
  END IF;
  IF r.rezultat IS NULL THEN
    RAISE EXCEPTION 'DCC_INTENTIE_NEINCHEIATA: cheia de intentie nu are rezultat' USING ERRCODE = 'P0001';
  END IF;
  RETURN r.rezultat || '{"reluat": true}'::jsonb;
END $f$;

-- claim-ul: INSERT … ON CONFLICT DO NOTHING (L04). Dacă o cerere concurentă cu aceeași cheie a comis între timp (INSERT-ul a așteptat pe indexul
-- unic), reluarea ei; dacă ea a fost anulată, cheia devine a apelului curent. NULL = apelul curent deține cheia.
CREATE FUNCTION public.fn_dcc_intentie_revendica(p_cheie uuid, p_operatie text, p_hash text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v uuid; v_uid uuid := auth.uid();
BEGIN
  INSERT INTO public.dcc_intentii (cheie, operatie, parametri_hash, autor, actor)
  VALUES (p_cheie, p_operatie, p_hash, v_uid, CASE WHEN v_uid IS NULL THEN 'server' ELSE 'om' END)
  ON CONFLICT (cheie) DO NOTHING
  RETURNING cheie INTO v;
  IF v IS NULL THEN RETURN public.fn_dcc_intentie_reia(p_cheie, p_operatie, p_hash); END IF;
  RETURN NULL;
END $f$;

CREATE FUNCTION public.fn_dcc_intentie_incheie(p_cheie uuid, p_rezultat jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  UPDATE public.dcc_intentii i SET rezultat = p_rezultat WHERE i.cheie = p_cheie AND i.rezultat IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'DCC_INTENTIE_NEINCHEIATA: cheia de intentie nu e a apelului curent' USING ERRCODE = 'P0001'; END IF;
END $f$;

-- regula 2 a seriilor efective (L19: aceeași funcție în triggerul dcc_proiecte și în RPC): ghidul e compatibil cu contractul dacă, pentru FIECARE
-- serie a contractului, intervalul cu același nume din ghid lipsește sau are exact aceleași limite. NULL = compatibil; altfel numele intervalului.
CREATE FUNCTION public.fn_dcc_ghid_compatibil_intern(p_contract bigint, p_ghid bigint) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE v text;
BEGIN
  SELECT s.interval INTO v
    FROM public.dcc_serii s JOIN public.dcc_ghid_intervale gi ON gi.ghid_id = p_ghid AND gi.interval = s.interval
   WHERE s.contract_id = p_contract AND (gi.limita_inf <> s.limita_inf OR gi.limita_sup <> s.limita_sup)
   ORDER BY s.interval LIMIT 1;
  RETURN v;
END $f$;

-- SINGURELE locuri care calculează cheile advisory ale pașilor 2 și 4 (L06, L19). fn_dcc_lock_cheie_serie primește identitatea COMPLETĂ a
-- seriei, inclusiv intervalul canonic, și îl IGNORĂ DELIBERAT în cheie: disjuncția intervalelor e pe cheia fără interval (două inițializări
-- concurente pe intervale diferite ale aceleiași chei se serializează).
CREATE FUNCTION public.fn_dcc_lock_contract(p_contract bigint, p_exclusiv boolean) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_k bigint;
BEGIN
  v_k := hashtextextended('dcc_contract:' || p_contract::text, 0);
  IF p_exclusiv THEN PERFORM pg_advisory_xact_lock(v_k); ELSE PERFORM pg_advisory_xact_lock_shared(v_k); END IF;
END $f$;
CREATE FUNCTION public.fn_dcc_lock_cheie_serie(p_contract bigint, p_emitent text, p_tematica text, p_tip text, p_interval text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_k bigint;
BEGIN
  -- p_interval NU intră în cheie
  v_k := hashtextextended('dcc_cheie:' || p_contract::text || '|' || p_emitent || '|' || coalesce(p_tematica, '-') || '|' || p_tip, 0);
  PERFORM pg_advisory_xact_lock(v_k);
END $f$;

REVOKE ALL ON FUNCTION public.fn_dcc_server(), public.fn_dcc_e_owner(), public.fn_dcc_drept(bigint, text), public.fn_dcc_contract_vizibil(bigint),
  public.fn_dcc_are_modul(), public.fn_dcc_intentie_reia(uuid, text, text), public.fn_dcc_intentie_revendica(uuid, text, text),
  public.fn_dcc_intentie_incheie(uuid, jsonb), public.fn_dcc_ghid_compatibil_intern(bigint, bigint), public.fn_dcc_lock_contract(bigint, boolean),
  public.fn_dcc_lock_cheie_serie(bigint, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
-- predicatele din politici se evaluează cu drepturile apelantului: EXECUTE pentru authenticated; internele fără niciun EXECUTE
GRANT EXECUTE ON FUNCTION public.fn_dcc_server(), public.fn_dcc_e_owner(), public.fn_dcc_drept(bigint, text), public.fn_dcc_contract_vizibil(bigint),
  public.fn_dcc_are_modul() TO authenticated;

-- ── politicile [D1]: DOAR FOR SELECT TO authenticated. Conținutul se citește STRICT pe proiectul DCC al rândului; contractul doar prin
-- fn_dcc_contract_vizibil; configurația comună prin fn_dcc_are_modul. Nicio politică de scriere (scrierile = RPC-urile DEFINER). ──
CREATE POLICY dcc_ghiduri_citire ON public.dcc_ghiduri FOR SELECT TO authenticated USING (public.fn_dcc_are_modul());
CREATE POLICY dcc_ghid_valori_citire ON public.dcc_ghid_valori FOR SELECT TO authenticated USING (public.fn_dcc_are_modul());
CREATE POLICY dcc_ghid_intervale_citire ON public.dcc_ghid_intervale FOR SELECT TO authenticated USING (public.fn_dcc_are_modul());
CREATE POLICY dcc_contracte_citire ON public.dcc_contracte FOR SELECT TO authenticated USING (public.fn_dcc_contract_vizibil(id));
CREATE POLICY dcc_proiecte_citire ON public.dcc_proiecte FOR SELECT TO authenticated USING (public.fn_dcc_drept(id, 'citire'));
CREATE POLICY dcc_documente_citire ON public.dcc_documente FOR SELECT TO authenticated USING (public.fn_dcc_drept(proiect_dcc_id, 'citire'));
CREATE POLICY dcc_file_citire ON public.dcc_file FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.dcc_documente d WHERE d.id = document_id AND public.fn_dcc_drept(d.proiect_dcc_id, 'citire')));
CREATE POLICY dcc_anexe_citire ON public.dcc_anexe FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.dcc_documente d WHERE d.id = document_id AND public.fn_dcc_drept(d.proiect_dcc_id, 'citire')));
CREATE POLICY dcc_revizii_citire ON public.dcc_revizii FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.dcc_documente d WHERE d.id = document_id AND public.fn_dcc_drept(d.proiect_dcc_id, 'citire')));
CREATE POLICY dcc_istoric_aparitii_citire ON public.dcc_istoric_aparitii FOR SELECT TO authenticated USING (public.fn_dcc_drept(proiect_dcc_id, 'citire'));
CREATE POLICY dcc_snapshoturi_citire ON public.dcc_snapshoturi FOR SELECT TO authenticated USING (public.fn_dcc_drept(proiect_dcc_id, 'citire'));
-- legătura snapshot <-> revizie: drept pe proiectul snapshotului ȘI pe proiectul documentului reviziei (L09)
CREATE POLICY dcc_snapshot_revizii_citire ON public.dcc_snapshot_revizii FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.dcc_snapshoturi s WHERE s.id = snapshot_id AND public.fn_dcc_drept(s.proiect_dcc_id, 'citire'))
         AND EXISTS (SELECT 1 FROM public.dcc_revizii r JOIN public.dcc_documente d ON d.id = r.document_id
                      WHERE r.id = revizie_id AND public.fn_dcc_drept(d.proiect_dcc_id, 'citire')));
CREATE POLICY dcc_mesaje_citire ON public.dcc_mesaje FOR SELECT TO authenticated USING (public.fn_dcc_drept(proiect_dcc_id, 'citire'));
-- legătura mesaj <-> revizie: drept pe proiectul mesajului ȘI pe proiectul documentului reviziei (L09)
CREATE POLICY dcc_legaturi_citire ON public.dcc_legaturi FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.dcc_mesaje m WHERE m.id = mesaj_id AND public.fn_dcc_drept(m.proiect_dcc_id, 'citire'))
         AND EXISTS (SELECT 1 FROM public.dcc_revizii r JOIN public.dcc_documente d ON d.id = r.document_id
                      WHERE r.id = revizie_id AND public.fn_dcc_drept(d.proiect_dcc_id, 'citire')));
-- SELECT pentru authenticated pe 14 tabele (NU pe dcc_intentii / dcc_casute / dcc_serii: seria se citește prin fn_dcc_serii_proiect)
GRANT SELECT ON public.dcc_ghiduri, public.dcc_ghid_valori, public.dcc_ghid_intervale, public.dcc_contracte, public.dcc_proiecte, public.dcc_documente,
  public.dcc_file, public.dcc_anexe, public.dcc_revizii, public.dcc_istoric_aparitii, public.dcc_snapshoturi, public.dcc_snapshot_revizii,
  public.dcc_mesaje, public.dcc_legaturi TO authenticated;

-- ── vederea registrului (security_invoker: RLS-ul tabelelor de bază o limitează la proiectele apelantului): documentul + contractul + ținta
-- (document / filă / anexă) + ULTIMA revizie pe țintă și limbă + numărul aparițiilor istorice legate. Fără coloane din alte module. ──
CREATE VIEW public.v_dcc_registru WITH (security_invoker = on) AS
  SELECT d.id AS document_id, d.proiect_dcc_id, d.contract_id, c.beneficiar, c.cod_contract, d.emitent, d.tematica, d.tip, d.secventa, d.interval,
         d.mod, d.titlu, d.are_file, d.stare,
         CASE WHEN r.fila_id IS NOT NULL THEN 'fila' WHEN r.anexa_id IS NOT NULL THEN 'anexa' ELSE 'document' END AS tinta,
         f.fila, a.numar AS anexa, r.id AS revizie_id, r.revizie, r.limba, r.cod_text, r.nume_fisier_baza, r.stare_transport, r.verdict,
         (SELECT count(*) FROM public.dcc_istoric_aparitii h WHERE h.document_id = d.id) AS aparitii_istorice
    FROM public.dcc_documente d
    JOIN public.dcc_contracte c ON c.id = d.contract_id
    JOIN LATERAL (SELECT DISTINCT ON (x.fila_id, x.anexa_id, x.limba) x.*
                    FROM public.dcc_revizii x WHERE x.document_id = d.id
                   ORDER BY x.fila_id, x.anexa_id, x.limba, x.revizie DESC, x.id DESC) r ON true
    LEFT JOIN public.dcc_file f ON f.id = r.fila_id
    LEFT JOIN public.dcc_anexe a ON a.id = r.anexa_id;
REVOKE ALL ON public.v_dcc_registru FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_dcc_registru TO authenticated;

-- ─── 4. triggerele: invariantele pe ORICE cale (L07), inclusiv pentru postgres — imuabilitatea configurației și a textului înghețat, disjuncția
-- seriilor, contorul strict crescător, gărzile documentului anulat (codul PLASEI: DCC_GARDA_DOCUMENT_ANULAT, diferit de al RPC-ului), tranzițiile
-- de transport, provenienţa pusă de server, interdicția de ștergere și de golire. Funcțiile de trigger: INVOKER, fără EXECUTE pentru nimeni.

-- ghidul și listele lui sunt ÎNGHEȚATE; singura excepție: o valoare poate fi dezactivată (activ true -> false). O schimbare = versiune nouă.
CREATE FUNCTION public.fn_dcc_ghid_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'dcc_ghid_valori' THEN
    -- (IF separat: câmpul activ există doar în dcc_ghid_valori)
    IF (to_jsonb(OLD) -> 'activ') = 'true'::jsonb AND (to_jsonb(NEW) -> 'activ') = 'false'::jsonb
       AND (to_jsonb(NEW) - 'activ') = (to_jsonb(OLD) - 'activ') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'DCC_GHID_IMUABIL: ghidul de codificare nu se modifica dupa creare (o schimbare = versiune noua)' USING ERRCODE = 'P0001';
END $f$;
CREATE TRIGGER trg_dcc_ghiduri_imuabil BEFORE UPDATE OR DELETE ON public.dcc_ghiduri FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_ghid_garda();
CREATE TRIGGER trg_dcc_ghid_valori_imuabil BEFORE UPDATE OR DELETE ON public.dcc_ghid_valori FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_ghid_garda();
CREATE TRIGGER trg_dcc_ghid_intervale_imuabil BEFORE UPDATE OR DELETE ON public.dcc_ghid_intervale FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_ghid_garda();

-- intervalele ACELUIAȘI ghid sunt disjuncte: rândul ghidului FOR UPDATE (L01), apoi verificarea; 23P01 DCC_INTERVALE_SUPRAPUSE
CREATE FUNCTION public.fn_dcc_ghid_intervale_disjuncte() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  PERFORM 1 FROM public.dcc_ghiduri g WHERE g.id = NEW.ghid_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.dcc_ghid_intervale gi WHERE gi.ghid_id = NEW.ghid_id
                AND gi.limita_inf <= NEW.limita_sup AND NEW.limita_inf <= gi.limita_sup) THEN
    RAISE EXCEPTION 'DCC_INTERVALE_SUPRAPUSE: intervalul % se suprapune cu alt interval al ghidului', NEW.interval USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_dcc_ghid_intervale_disjuncte BEFORE INSERT ON public.dcc_ghid_intervale FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_ghid_intervale_disjuncte();

-- [D2] contractul: beneficiarul, codul și modul de alocare IMUABILE pe orice cale (și pentru postgres); doar descrierea se poate schimba
CREATE FUNCTION public.fn_dcc_contracte_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'DCC_STERGERE_INTERZISA: contractele nu se sterg' USING ERRCODE = 'P0001'; END IF;
  IF (to_jsonb(NEW) - 'descriere') IS DISTINCT FROM (to_jsonb(OLD) - 'descriere') THEN
    RAISE EXCEPTION 'DCC_CONTRACT_IMUABIL: beneficiarul, codul si modul de alocare ale contractului nu se schimba' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_dcc_contracte_imuabil BEFORE UPDATE OR DELETE ON public.dcc_contracte FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_contracte_garda();

-- proiectul DCC: advisory-ul EXCLUSIV al contractului (reintrant în fn_dcc_proiect_seteaza) înaintea verificării compatibilității ghidului cu
-- seriile contractului (regula 2, aceeași funcție ca RPC-ul); emitentul = o valoare ACTIVĂ a ghidului; contractul / proiectul Execuție / emitentul
-- imuabile după primul document; versiunea crește la ORICE scriere (CAS-ul RPC-ului). Ordinea lock-urilor: pasul 2 -> pasul 3 (rândul însuși).
CREATE FUNCTION public.fn_dcc_proiecte_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_incomp text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'DCC_STERGERE_INTERZISA: proiectele DCC nu se sterg' USING ERRCODE = 'P0001'; END IF;
  PERFORM public.fn_dcc_lock_contract(NEW.contract_id, true);
  IF NOT EXISTS (SELECT 1 FROM public.dcc_ghid_valori v WHERE v.ghid_id = NEW.ghid_id AND v.categorie = 'emitent' AND v.cod = NEW.emitent AND v.activ) THEN
    RAISE EXCEPTION 'DCC_EMITENT_STRAIN: emitentul nu e o valoare activa a ghidului' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.ghid_id IS DISTINCT FROM OLD.ghid_id OR NEW.contract_id IS DISTINCT FROM OLD.contract_id THEN
    v_incomp := public.fn_dcc_ghid_compatibil_intern(NEW.contract_id, NEW.ghid_id);
    IF v_incomp IS NOT NULL THEN
      RAISE EXCEPTION 'DCC_GHID_INCOMPATIBIL: intervalul % al ghidului are alte limite decat seria contractului', v_incomp USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.versiune := 1;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.contract_id, NEW.executie_proiect_id, NEW.emitent, NEW.creat_de, NEW.creat_la)
       IS DISTINCT FROM (OLD.id, OLD.contract_id, OLD.executie_proiect_id, OLD.emitent, OLD.creat_de, OLD.creat_la)
     AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.creat_de IS DISTINCT FROM OLD.creat_de OR NEW.creat_la IS DISTINCT FROM OLD.creat_la
          OR EXISTS (SELECT 1 FROM public.dcc_documente d WHERE d.proiect_dcc_id = OLD.id)) THEN
    RAISE EXCEPTION 'DCC_PROIECT_IMUABIL: contractul, proiectul Executie si emitentul nu se schimba dupa primul document' USING ERRCODE = 'P0001';
  END IF;
  NEW.versiune := OLD.versiune + 1;
  NEW.actualizat_la := now();
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_dcc_proiecte_garda BEFORE INSERT OR UPDATE OR DELETE ON public.dcc_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_proiecte_garda();

-- cheile de intenție: tranzacția care revendică e pusă de server; rezultatul se scrie O DATĂ (NULL -> valoare), DOAR în tranzacția care a
-- revendicat cheia; nimic altceva nu se schimbă; nicio ștergere
CREATE FUNCTION public.fn_dcc_intentii_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'DCC_STERGERE_INTERZISA: cheile de intentie nu se sterg' USING ERRCODE = 'P0001'; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.creat_tx := pg_current_xact_id();
    NEW.creat_la := now();
    RETURN NEW;
  END IF;
  IF OLD.rezultat IS NOT NULL OR NEW.rezultat IS NULL OR OLD.creat_tx IS DISTINCT FROM pg_current_xact_id()
     OR (to_jsonb(NEW) - 'rezultat') IS DISTINCT FROM (to_jsonb(OLD) - 'rezultat') THEN
    RAISE EXCEPTION 'DCC_INTENTIE_IMUABILA: rezultatul unei intentii se scrie o data, in tranzactia care a revendicat cheia' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_dcc_intentii_garda BEFORE INSERT OR UPDATE OR DELETE ON public.dcc_intentii FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_intentii_garda();

-- seriile: la INSERT, advisory-ul cheii FĂRĂ interval (pasul 4, reintrant în RPC) și disjuncția față de TOATE seriile cheii, din orice ghid —
-- codul PLASEI (23P01 DCC_GARDA_INTERVALE_SUPRAPUSE), diferit de al RPC-ului. La UPDATE: doar contorul, STRICT crescător (egal = refuz).
CREATE FUNCTION public.fn_dcc_serii_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'DCC_STERGERE_INTERZISA: seriile nu se sterg' USING ERRCODE = 'P0001'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_dcc_lock_cheie_serie(NEW.contract_id, NEW.emitent, NEW.tematica, NEW.tip, NEW.interval);
    IF EXISTS (SELECT 1 FROM public.dcc_serii s WHERE s.contract_id = NEW.contract_id AND s.emitent = NEW.emitent
                  AND s.tematica IS NOT DISTINCT FROM NEW.tematica AND s.tip = NEW.tip
                  AND s.limita_inf <= NEW.limita_sup AND NEW.limita_inf <= s.limita_sup) THEN
      RAISE EXCEPTION 'DCC_GARDA_INTERVALE_SUPRAPUSE: intervalul % se suprapune cu o serie existenta a aceleiasi chei', NEW.interval USING ERRCODE = '23P01';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'ultimul_ocupat') IS DISTINCT FROM (to_jsonb(OLD) - 'ultimul_ocupat')
     OR (NEW.ultimul_ocupat > OLD.ultimul_ocupat) IS NOT TRUE THEN
    RAISE EXCEPTION 'DCC_SERIE_IMUABILA: doar contorul seriei se schimba, strict crescator' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_dcc_serii_garda BEFORE INSERT OR UPDATE OR DELETE ON public.dcc_serii FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_serii_garda();

-- documentele: la INSERT, seria (când există) are ACEEAȘI cheie și secvența e în limitele ei; la UPDATE, singura schimbare = anularea
-- (activ -> anulat + câmpurile anulării); tot restul imuabil; nicio ștergere (numărul rămâne ocupat)
CREATE FUNCTION public.fn_dcc_documente_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE s public.dcc_serii;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'DCC_STERGERE_INTERZISA: documentele nu se sterg (numarul ramane ocupat)' USING ERRCODE = 'P0001'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.serie_id IS NOT NULL THEN
      SELECT * INTO s FROM public.dcc_serii x WHERE x.id = NEW.serie_id;
      IF NOT FOUND OR s.contract_id IS DISTINCT FROM NEW.contract_id OR s.emitent IS DISTINCT FROM NEW.emitent
         OR s.tematica IS DISTINCT FROM NEW.tematica OR s.tip IS DISTINCT FROM NEW.tip OR s.interval IS DISTINCT FROM NEW.interval
         OR (NEW.secventa BETWEEN s.limita_inf AND s.limita_sup) IS NOT TRUE THEN
        RAISE EXCEPTION 'DCC_SERIE_NEPOTRIVITA: seria documentului are alta cheie sau secventa e in afara limitelor ei' USING ERRCODE = '22023';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['stare', 'anulat_de', 'anulat_la', 'motiv_anulare']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['stare', 'anulat_de', 'anulat_la', 'motiv_anulare'])
     OR NOT (OLD.stare = 'activ' AND NEW.stare = 'anulat') THEN
    RAISE EXCEPTION 'DCC_DOCUMENT_IMUABIL: documentul nu se modifica; singura schimbare permisa e anularea' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_dcc_documente_garda BEFORE INSERT OR UPDATE OR DELETE ON public.dcc_documente FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_documente_garda();

-- filele: plasa documentului anulat (orice cale) + doar pe un document declarat cu file; imuabile
CREATE FUNCTION public.fn_dcc_file_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE d public.dcc_documente;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'DCC_FILA_IMUABILA: filele nu se modifica si nu se sterg' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = NEW.document_id;
  IF d.stare = 'anulat' THEN
    RAISE EXCEPTION 'DCC_GARDA_DOCUMENT_ANULAT: documentul e anulat (fila)' USING ERRCODE = 'P0001';
  END IF;
  IF d.are_file IS NOT TRUE THEN
    RAISE EXCEPTION 'DCC_FARA_FILE: documentul nu a fost declarat cu file' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_dcc_file_garda BEFORE INSERT OR UPDATE OR DELETE ON public.dcc_file FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_file_garda();

-- anexele: plasa documentului anulat (orice cale); imuabile
CREATE FUNCTION public.fn_dcc_anexe_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE d public.dcc_documente;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'DCC_ANEXA_IMUABILA: anexele nu se modifica si nu se sterg' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = NEW.document_id;
  IF d.stare = 'anulat' THEN
    RAISE EXCEPTION 'DCC_GARDA_DOCUMENT_ANULAT: documentul e anulat (anexa)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_dcc_anexe_garda BEFORE INSERT OR UPDATE OR DELETE ON public.dcc_anexe FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_anexe_garda();

-- reviziile: la INSERT, plasa documentului anulat + ținta (filă / anexă) e a documentului și compatibilă cu are_file; la UPDATE, identitatea și
-- textul înghețat imuabile, starea de transport DOAR prin tabelul tranzițiilor (IS NOT TRUE -> refuz), plasa documentului anulat pe tranzițiile
-- de emisie, neverificata -> confirmata doar cu dovadă (legătură confirmată a unui mesaj cu Message-ID / Gmail id), câmpurile anulării doar odată
-- cu tranziția spre anulata, verdictul doar NULL -> valoare (B); nicio ștergere
CREATE FUNCTION public.fn_dcc_revizii_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE d public.dcc_documente;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'DCC_STERGERE_INTERZISA: reviziile nu se sterg' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = NEW.document_id;
  IF TG_OP = 'INSERT' THEN
    IF d.stare = 'anulat' THEN
      RAISE EXCEPTION 'DCC_GARDA_DOCUMENT_ANULAT: documentul e anulat (revizie)' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.fila_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.dcc_file f WHERE f.id = NEW.fila_id AND f.document_id = NEW.document_id) THEN
      RAISE EXCEPTION 'DCC_TINTA_STRAINA: fila nu e a documentului' USING ERRCODE = '22023';
    END IF;
    IF NEW.anexa_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.dcc_anexe a WHERE a.id = NEW.anexa_id AND a.document_id = NEW.document_id) THEN
      RAISE EXCEPTION 'DCC_TINTA_STRAINA: anexa nu e a documentului' USING ERRCODE = '22023';
    END IF;
    IF (d.are_file IS TRUE AND NEW.fila_id IS NULL AND NEW.anexa_id IS NULL) OR (d.are_file IS NOT TRUE AND NEW.fila_id IS NOT NULL) THEN
      RAISE EXCEPTION 'DCC_TINTA_NEPOTRIVITA: revizia unui document cu file sta pe o fila sau anexa; fara file, nu are fila' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.contract_id, NEW.document_id, NEW.fila_id, NEW.anexa_id, NEW.revizie, NEW.limba, NEW.ghid_id, NEW.cod_text, NEW.nume_fisier_baza, NEW.titlu, NEW.creat_de, NEW.creat_la)
     IS DISTINCT FROM
     (OLD.id, OLD.contract_id, OLD.document_id, OLD.fila_id, OLD.anexa_id, OLD.revizie, OLD.limba, OLD.ghid_id, OLD.cod_text, OLD.nume_fisier_baza, OLD.titlu, OLD.creat_de, OLD.creat_la) THEN
    RAISE EXCEPTION 'DCC_REVIZIE_IMUABILA: identitatea si codul inghetat al reviziei nu se schimba' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.stare_transport IS DISTINCT FROM OLD.stare_transport THEN
    IF public.fn_dcc_tranzitie_permisa(OLD.stare_transport, NEW.stare_transport) IS NOT TRUE THEN
      RAISE EXCEPTION 'DCC_TRANZITIE_NEPERMISA: % -> %', OLD.stare_transport, NEW.stare_transport USING ERRCODE = 'P0001';
    END IF;
    IF NEW.stare_transport IN ('pregatita', 'copiata_pentru_gmail', 'trimisa_manual_neverificata') AND d.stare = 'anulat' THEN
      RAISE EXCEPTION 'DCC_GARDA_DOCUMENT_ANULAT: documentul e anulat (emisie)' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.stare_transport = 'trimisa_manual_confirmata'
       AND NOT EXISTS (SELECT 1 FROM public.dcc_legaturi l JOIN public.dcc_mesaje m ON m.id = l.mesaj_id
                        WHERE l.revizie_id = NEW.id AND l.stare = 'confirmata' AND (m.rfc_message_id IS NOT NULL OR m.gmail_message_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'DCC_TRANZITIE_NEPERMISA: confirmarea cere un mesaj gasit (Message-ID / Gmail id) legat de revizie' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF (NEW.anulata_de, NEW.anulata_la, NEW.anulata_prin, NEW.motiv_anulare) IS DISTINCT FROM (OLD.anulata_de, OLD.anulata_la, OLD.anulata_prin, OLD.motiv_anulare)
     AND NOT (OLD.stare_transport <> 'anulata' AND NEW.stare_transport = 'anulata') THEN
    RAISE EXCEPTION 'DCC_REVIZIE_IMUABILA: campurile anularii se scriu doar odata cu anularea' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.verdict IS NOT NULL
     AND (NEW.verdict, NEW.verdict_mesaj_id, NEW.verdict_confirmat_de, NEW.verdict_confirmat_la)
         IS DISTINCT FROM (OLD.verdict, OLD.verdict_mesaj_id, OLD.verdict_confirmat_de, OLD.verdict_confirmat_la) THEN
    RAISE EXCEPTION 'DCC_REVIZIE_IMUABILA: verdictul confirmat nu se rescrie' USING ERRCODE = 'P0001';
  END IF;
  NEW.actualizat_la := now();
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_dcc_revizii_garda BEFORE INSERT OR UPDATE OR DELETE ON public.dcc_revizii FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_revizii_garda();

-- istoricul: la INSERT serverul pune proveniența și amprenta conținutului, iar legarea pornește goală; la UPDATE doar legarea (document /
-- revizie / legat_*) din NULL — documentul aceluiași proiect îl impune cheia străină compusă, revizia trebuie să fie a documentului; nicio ștergere
CREATE FUNCTION public.fn_dcc_istoric_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'DCC_STERGERE_INTERZISA: istoricul nu se sterge' USING ERRCODE = 'P0001'; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.importat_de := v_uid;
    NEW.importat_prin := CASE WHEN v_uid IS NULL THEN 'server' ELSE 'om' END;
    NEW.importat_la := now();
    NEW.document_id := NULL; NEW.revizie_id := NULL; NEW.legat_de := NULL; NEW.legat_la := NULL;
    NEW.continut_hash := public.fn_dcc_istoric_hash(NEW.sursa, NEW.sursa_id, NEW.pozitie, NEW.valori_originale, NEW.cod_scris, NEW.emitent, NEW.tematica,
                                                    NEW.tip, NEW.secventa, NEW.fila, NEW.anexa, NEW.revizie, NEW.limba, NEW.probleme);
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['document_id', 'revizie_id', 'legat_de', 'legat_la']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['document_id', 'revizie_id', 'legat_de', 'legat_la'])
     OR OLD.document_id IS NOT NULL OR OLD.revizie_id IS NOT NULL OR OLD.legat_la IS NOT NULL
     OR NEW.document_id IS NULL OR NEW.legat_la IS NULL
     OR (NEW.revizie_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.dcc_revizii r WHERE r.id = NEW.revizie_id AND r.document_id = NEW.document_id)) THEN
    RAISE EXCEPTION 'DCC_ISTORIC_IMUABIL: istoricul brut nu se modifica; doar legarea unei aparitii, o data' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_dcc_istoric_garda BEFORE INSERT OR UPDATE OR DELETE ON public.dcc_istoric_aparitii FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_istoric_garda();

-- snapshoturile: amprenta o pune serverul la INSERT (forma canonică), autorul = apelantul când are JWT; imuabile
CREATE FUNCTION public.fn_dcc_snapshoturi_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'DCC_SNAPSHOT_IMUABIL: snapshotul e copia imuabila a ce a aprobat omul' USING ERRCODE = 'P0001'; END IF;
  IF auth.uid() IS NOT NULL THEN NEW.aprobat_de := auth.uid(); END IF;
  NEW.aprobat_la := now();
  NEW.hash := public.fn_dcc_snapshot_hash(NEW.tip, NEW.from_adresa, NEW.to_lista, NEW.cc_lista, NEW.subiect, NEW.corp, NEW.linkuri, NEW.manifest);
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_dcc_snapshoturi_garda BEFORE INSERT OR UPDATE OR DELETE ON public.dcc_snapshoturi FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_snapshoturi_garda();

-- snapshot <-> revizie: revizia e a ACELUIAȘI proiect DCC ca snapshotul și documentul ei nu e anulat; imuabile
CREATE FUNCTION public.fn_dcc_snapshot_revizii_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE d public.dcc_documente;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'DCC_SNAPSHOT_IMUABIL: legatura snapshotului nu se modifica' USING ERRCODE = 'P0001'; END IF;
  SELECT x.* INTO d FROM public.dcc_documente x JOIN public.dcc_revizii r ON r.document_id = x.id WHERE r.id = NEW.revizie_id;
  IF NOT EXISTS (SELECT 1 FROM public.dcc_snapshoturi s WHERE s.id = NEW.snapshot_id AND s.proiect_dcc_id = d.proiect_dcc_id) THEN
    RAISE EXCEPTION 'DCC_PROIECTE_AMESTECATE: revizia si snapshotul sunt din proiecte diferite' USING ERRCODE = '22023';
  END IF;
  IF d.stare = 'anulat' THEN
    RAISE EXCEPTION 'DCC_GARDA_DOCUMENT_ANULAT: documentul e anulat (snapshot)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_dcc_snapshot_revizii_garda BEFORE INSERT OR UPDATE OR DELETE ON public.dcc_snapshot_revizii FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_snapshot_revizii_garda();

-- mesajele: imuabile în PR1 (B adaugă căile lui); autorul = apelantul când are JWT
CREATE FUNCTION public.fn_dcc_mesaje_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'DCC_MESAJ_IMUABIL: mesajul nu se modifica si nu se sterge' USING ERRCODE = 'P0001'; END IF;
  IF auth.uid() IS NOT NULL THEN NEW.creat_de := auth.uid(); END IF;
  NEW.creat_la := now();
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_dcc_mesaje_garda BEFORE INSERT OR UPDATE OR DELETE ON public.dcc_mesaje FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_mesaje_garda();

-- legăturile: mesajul și documentul reviziei sunt ale ACELUIAȘI proiect DCC; o legătură manuală nouă pe o revizie a unui document anulat =
-- refuz; UPDATE doar starea propusa -> confirmata | respinsa + confirmat_* (B); nicio ștergere
CREATE FUNCTION public.fn_dcc_legaturi_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE d public.dcc_documente;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'DCC_STERGERE_INTERZISA: legaturile nu se sterg' USING ERRCODE = 'P0001'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT x.* INTO d FROM public.dcc_documente x JOIN public.dcc_revizii r ON r.document_id = x.id WHERE r.id = NEW.revizie_id;
    IF NOT EXISTS (SELECT 1 FROM public.dcc_mesaje m WHERE m.id = NEW.mesaj_id AND m.proiect_dcc_id = d.proiect_dcc_id) THEN
      RAISE EXCEPTION 'DCC_PROIECTE_AMESTECATE: mesajul si revizia sunt din proiecte diferite' USING ERRCODE = '22023';
    END IF;
    IF NEW.metoda = 'manual' AND d.stare = 'anulat' THEN
      RAISE EXCEPTION 'DCC_GARDA_DOCUMENT_ANULAT: documentul e anulat (legatura)' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['stare', 'confirmat_de', 'confirmat_la']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['stare', 'confirmat_de', 'confirmat_la'])
     OR OLD.stare IS DISTINCT FROM 'propusa' OR NEW.stare NOT IN ('confirmata', 'respinsa') THEN
    RAISE EXCEPTION 'DCC_LEGATURA_IMUABILA: legatura se confirma sau se respinge o data, din propusa' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_dcc_legaturi_garda BEFORE INSERT OR UPDATE OR DELETE ON public.dcc_legaturi FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_legaturi_garda();

-- căsuțele (goale în PR1): nicio ștergere
CREATE FUNCTION public.fn_dcc_fara_stergere() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  RAISE EXCEPTION 'DCC_STERGERE_INTERZISA: % nu se sterge', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $f$;
CREATE TRIGGER trg_dcc_casute_fara_stergere BEFORE DELETE ON public.dcc_casute FOR EACH ROW EXECUTE FUNCTION public.fn_dcc_fara_stergere();

-- nicio golire, pe niciun tabel (și pentru postgres; revenirea folosește DROP, nu TRUNCATE)
CREATE FUNCTION public.fn_dcc_fara_golire() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  RAISE EXCEPTION 'DCC_STERGERE_INTERZISA: % nu se goleste', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $f$;
CREATE TRIGGER trg_dcc_casute_fara_golire BEFORE TRUNCATE ON public.dcc_casute FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_ghiduri_fara_golire BEFORE TRUNCATE ON public.dcc_ghiduri FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_ghid_valori_fara_golire BEFORE TRUNCATE ON public.dcc_ghid_valori FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_ghid_intervale_fara_golire BEFORE TRUNCATE ON public.dcc_ghid_intervale FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_contracte_fara_golire BEFORE TRUNCATE ON public.dcc_contracte FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_proiecte_fara_golire BEFORE TRUNCATE ON public.dcc_proiecte FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_intentii_fara_golire BEFORE TRUNCATE ON public.dcc_intentii FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_serii_fara_golire BEFORE TRUNCATE ON public.dcc_serii FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_documente_fara_golire BEFORE TRUNCATE ON public.dcc_documente FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_file_fara_golire BEFORE TRUNCATE ON public.dcc_file FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_anexe_fara_golire BEFORE TRUNCATE ON public.dcc_anexe FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_revizii_fara_golire BEFORE TRUNCATE ON public.dcc_revizii FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_istoric_aparitii_fara_golire BEFORE TRUNCATE ON public.dcc_istoric_aparitii FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_snapshoturi_fara_golire BEFORE TRUNCATE ON public.dcc_snapshoturi FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_snapshot_revizii_fara_golire BEFORE TRUNCATE ON public.dcc_snapshot_revizii FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_mesaje_fara_golire BEFORE TRUNCATE ON public.dcc_mesaje FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();
CREATE TRIGGER trg_dcc_legaturi_fara_golire BEFORE TRUNCATE ON public.dcc_legaturi FOR EACH STATEMENT EXECUTE FUNCTION public.fn_dcc_fara_golire();

REVOKE ALL ON FUNCTION public.fn_dcc_ghid_garda(), public.fn_dcc_ghid_intervale_disjuncte(), public.fn_dcc_contracte_garda(), public.fn_dcc_proiecte_garda(),
  public.fn_dcc_intentii_garda(), public.fn_dcc_serii_garda(), public.fn_dcc_documente_garda(), public.fn_dcc_file_garda(), public.fn_dcc_anexe_garda(),
  public.fn_dcc_revizii_garda(), public.fn_dcc_istoric_garda(), public.fn_dcc_snapshoturi_garda(), public.fn_dcc_snapshot_revizii_garda(),
  public.fn_dcc_mesaje_garda(), public.fn_dcc_legaturi_garda(), public.fn_dcc_fara_stergere(), public.fn_dcc_fara_golire()
  FROM PUBLIC, anon, authenticated, service_role;

-- ─── 5. RPC-urile. Ordinea în FIECARE RPC de scriere (L01 / L04 / L05 / L06): (1) auth.uid() nenul sau calea serverului unde e permisă ([D5]);
-- (2) normalizarea parametrilor și validarea formei, fără citiri de date; (3) hash-ul pe parametrii NORMALIZAȚI; (4) reluarea unei chei deja
-- comise, ÎNAINTEA dreptului (un retry după timeout află rezultatul chiar dacă dreptul s-a schimbat; rezultatul e doar al autorului cheii; nimic
-- nou scris); (5) dreptul; (6) claim-ul; (7) lock-urile, în ordinea globală; (8) REVERIFICAREA dreptului și a stării după lock; (9) scrierile;
-- (10) rezultatul în intenție; (11) RETURN. O excepție după (6) anulează tot, inclusiv claim-ul (o singură tranzacție).

-- ─── 5a. RPC-urile de configurare (owner sau calea serverului)

-- ajutătoare interne (fără EXECUTE): identitatea apelului de configurare și valorile ghidului
CREATE FUNCTION public.fn_dcc_config_permisa_intern() RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF auth.uid() IS NULL AND NOT public.fn_dcc_server() THEN
    RAISE EXCEPTION 'DCC_NEAUTENTIFICAT: autentificare necesara' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.fn_dcc_e_owner() THEN
    RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501';
  END IF;
END $f$;

-- tematica / tipul trebuie să fie valori ACTIVE ale ghidului; tipul fără tematică (minutele) cere tematica NULL și invers
CREATE FUNCTION public.fn_dcc_valori_ghid_intern(p_ghid bigint, p_tematica text, p_tip text) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE v_fara boolean;
BEGIN
  SELECT v.fara_tematica INTO v_fara FROM public.dcc_ghid_valori v WHERE v.ghid_id = p_ghid AND v.categorie = 'tip' AND v.cod = p_tip AND v.activ;
  IF NOT FOUND THEN RAISE EXCEPTION 'DCC_VALOARE_GHID: tipul nu e o valoare activa a ghidului' USING ERRCODE = '22023'; END IF;
  IF v_fara IS TRUE AND p_tematica IS NOT NULL THEN
    RAISE EXCEPTION 'DCC_VALOARE_GHID: tipul se emite fara tematica' USING ERRCODE = '22023';
  END IF;
  IF v_fara IS NOT TRUE AND (p_tematica IS NULL OR NOT EXISTS (SELECT 1 FROM public.dcc_ghid_valori v WHERE v.ghid_id = p_ghid AND v.categorie = 'tematica'
                                                                  AND v.cod = p_tematica AND v.activ)) THEN
    RAISE EXCEPTION 'DCC_VALOARE_GHID: tematica nu e o valoare activa a ghidului' USING ERRCODE = '22023';
  END IF;
END $f$;

-- codul și rădăcina numelui de fișier ale unei revizii, cu formatele ghidului dat: [cod_text, nume_fisier_baza]
CREATE FUNCTION public.fn_dcc_coduri_intern(p_ghid bigint, p_cod_contract text, p_emitent text, p_tematica text, p_tip text, p_secventa integer,
                                            p_fila integer, p_anexa integer, p_revizie integer, p_limba text) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE g public.dcc_ghiduri;
BEGIN
  SELECT * INTO g FROM public.dcc_ghiduri x WHERE x.id = p_ghid;
  RETURN ARRAY[public.fn_dcc_cod_text(g.format_cod, p_cod_contract, p_emitent, p_tematica, p_tip, p_secventa, p_fila, p_anexa, p_revizie, p_limba),
               public.fn_dcc_cod_text(g.format_fisier, p_cod_contract, p_emitent, p_tematica, p_tip, p_secventa, p_fila, p_anexa, p_revizie, p_limba)];
END $f$;

-- ghidul nou (versionat): cod, versiune, sursa, formatele, valorile, intervalele — totul într-o tranzacție (L02). Chei necunoscute la orice
-- nivel = refuz; liste nevide, fără dubluri pe identitate (refuz, nu deduplicare); intervalele prin forma canonică.
CREATE FUNCTION public.fn_dcc_ghid_creeaza(p_ghid jsonb, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_cod text; v_vers integer; v_sursa text; v_valori jsonb; v_intervale jsonb; v_p jsonb; v_hash text; v_r jsonb;
  v_id bigint; e jsonb; v_n integer;
BEGIN
  PERFORM public.fn_dcc_config_permisa_intern();
  IF p_cheie IS NULL THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: cheia de intentie lipseste' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_ghid) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: ghidul trebuie sa fie un obiect' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_ghid) k WHERE k NOT IN ('cod', 'versiune', 'sursa', 'format_cod', 'format_fisier', 'valori', 'intervale')) THEN
    RAISE EXCEPTION 'DCC_CHEI_NECUNOSCUTE: ghidul are chei necunoscute' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_ghid -> 'cod') IS DISTINCT FROM 'string' OR jsonb_typeof(p_ghid -> 'versiune') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_ghid -> 'sursa') IS DISTINCT FROM 'string' OR jsonb_typeof(p_ghid -> 'valori') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_ghid -> 'intervale') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: cod / versiune / sursa / valori / intervale lipsesc sau au alt tip' USING ERRCODE = '22023';
  END IF;
  v_cod := upper(btrim(p_ghid ->> 'cod'));
  IF (p_ghid ->> 'versiune')::numeric <> trunc((p_ghid ->> 'versiune')::numeric) OR (p_ghid ->> 'versiune')::numeric < 1 THEN
    RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: versiunea e un intreg >= 1' USING ERRCODE = '22023';
  END IF;
  v_vers := (p_ghid ->> 'versiune')::integer;
  v_sursa := nullif(btrim(p_ghid ->> 'sursa'), '');
  IF v_sursa IS NULL THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: sursa ghidului lipseste' USING ERRCODE = '22023'; END IF;
  IF public.fn_dcc_format_valid(p_ghid -> 'format_cod') IS NOT TRUE OR public.fn_dcc_format_valid(p_ghid -> 'format_fisier') IS NOT TRUE
     OR NOT ((p_ghid -> 'format_cod') @> '[{"camp": "limba"}]'::jsonb OR (p_ghid -> 'format_fisier') @> '[{"camp": "limba"}]'::jsonb) THEN
    RAISE EXCEPTION 'DCC_FORMAT_INVALID: formatele ghidului nu sunt valide' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_ghid -> 'valori') = 0 OR jsonb_array_length(p_ghid -> 'intervale') = 0 THEN
    RAISE EXCEPTION 'DCC_LISTA_GOALA: valorile si intervalele ghidului sunt obligatorii' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_ghid -> 'valori') x LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DCC_LISTA_INVALIDA: valoare invalida' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('categorie', 'cod', 'descriere', 'fara_tematica')) THEN
      RAISE EXCEPTION 'DCC_CHEI_NECUNOSCUTE: o valoare are chei necunoscute' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(e -> 'categorie') IS DISTINCT FROM 'string' OR jsonb_typeof(e -> 'cod') IS DISTINCT FROM 'string'
       OR coalesce(jsonb_typeof(e -> 'descriere'), 'null') NOT IN ('string', 'null') OR coalesce(jsonb_typeof(e -> 'fara_tematica'), 'boolean') <> 'boolean' THEN
      RAISE EXCEPTION 'DCC_LISTA_INVALIDA: valoare cu campuri de alt tip' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR e IN SELECT x FROM jsonb_array_elements(p_ghid -> 'intervale') x LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DCC_LISTA_INVALIDA: interval invalid' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('interval', 'limita_inf', 'limita_sup')) THEN
      RAISE EXCEPTION 'DCC_CHEI_NECUNOSCUTE: un interval are chei necunoscute' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(e -> 'interval') IS DISTINCT FROM 'string' OR jsonb_typeof(e -> 'limita_inf') IS DISTINCT FROM 'number'
       OR jsonb_typeof(e -> 'limita_sup') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'DCC_LISTA_INVALIDA: interval cu campuri de alt tip' USING ERRCODE = '22023';
    END IF;
    IF (e ->> 'limita_inf')::numeric <> trunc((e ->> 'limita_inf')::numeric) OR (e ->> 'limita_sup')::numeric <> trunc((e ->> 'limita_sup')::numeric)
       OR abs((e ->> 'limita_inf')::numeric) > 2147483647 OR abs((e ->> 'limita_sup')::numeric) > 2147483647 THEN
      RAISE EXCEPTION 'DCC_LISTA_INVALIDA: interval cu campuri de alt tip' USING ERRCODE = '22023';
    END IF;
    IF public.fn_dcc_interval_canonic(e ->> 'interval') IS NULL THEN
      RAISE EXCEPTION 'DCC_INTERVAL_INVALID: interval gol' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- forma normalizată (sortată după identitate): codurile cu majuscule, textele tăiate, intervalele canonice
  SELECT jsonb_agg(jsonb_build_object('categorie', c, 'cod', k, 'descriere', d, 'fara_tematica', f) ORDER BY c, k), count(*) - count(DISTINCT (c, k))
    INTO v_valori, v_n
    FROM (SELECT lower(btrim(x ->> 'categorie')) AS c, upper(btrim(x ->> 'cod')) AS k, nullif(btrim(x ->> 'descriere'), '') AS d,
                 coalesce((x ->> 'fara_tematica')::boolean, false) AS f
            FROM jsonb_array_elements(p_ghid -> 'valori') x) z;
  IF v_n > 0 THEN RAISE EXCEPTION 'DCC_LISTA_DUBLURI: valori dublate in ghid' USING ERRCODE = '22023'; END IF;
  SELECT jsonb_agg(jsonb_build_object('interval', i, 'limita_inf', a, 'limita_sup', b) ORDER BY i), count(*) - count(DISTINCT i)
    INTO v_intervale, v_n
    FROM (SELECT public.fn_dcc_interval_canonic(x ->> 'interval') AS i, (x ->> 'limita_inf')::integer AS a, (x ->> 'limita_sup')::integer AS b
            FROM jsonb_array_elements(p_ghid -> 'intervale') x) z;
  IF v_n > 0 THEN RAISE EXCEPTION 'DCC_LISTA_DUBLURI: intervale dublate in ghid' USING ERRCODE = '22023'; END IF;
  v_p := jsonb_build_object('cod', v_cod, 'versiune', v_vers, 'sursa', v_sursa, 'format_cod', p_ghid -> 'format_cod', 'format_fisier', p_ghid -> 'format_fisier',
                            'valori', v_valori, 'intervale', v_intervale);
  v_hash := public.fn_dcc_hash_parametri('ghid_creeaza', v_p);
  v_r := public.fn_dcc_intentie_reia(p_cheie, 'ghid_creeaza', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  v_r := public.fn_dcc_intentie_revendica(p_cheie, 'ghid_creeaza', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  INSERT INTO public.dcc_ghiduri (cod, versiune, sursa, format_cod, format_fisier, creat_de)
  VALUES (v_cod, v_vers, v_sursa, p_ghid -> 'format_cod', p_ghid -> 'format_fisier', v_uid) RETURNING id INTO v_id;
  INSERT INTO public.dcc_ghid_valori (ghid_id, categorie, cod, descriere, fara_tematica)
    SELECT v_id, x ->> 'categorie', x ->> 'cod', x ->> 'descriere', (x ->> 'fara_tematica')::boolean FROM jsonb_array_elements(v_valori) x;
  -- intervalele câte unul (triggerul de disjuncție vede intervalele deja inserate ale ghidului)
  FOR e IN SELECT x FROM jsonb_array_elements(v_intervale) x LOOP
    INSERT INTO public.dcc_ghid_intervale (ghid_id, interval, limita_inf, limita_sup) VALUES (v_id, e ->> 'interval', (e ->> 'limita_inf')::integer, (e ->> 'limita_sup')::integer);
  END LOOP;
  v_r := jsonb_build_object('ghid_id', v_id, 'cod', v_cod, 'versiune', v_vers, 'valori', jsonb_array_length(v_valori), 'intervale', jsonb_array_length(v_intervale));
  PERFORM public.fn_dcc_intentie_incheie(p_cheie, v_r);
  RETURN v_r || '{"reluat": false}'::jsonb;
END $f$;

-- contractul (domeniul numerotării): beneficiar, cod, mod de alocare FIXAT la creare ([D2])
CREATE FUNCTION public.fn_dcc_contract_creeaza(p_beneficiar text, p_cod_contract text, p_mod_alocare text, p_descriere text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_ben text := nullif(upper(btrim(p_beneficiar)), ''); v_cod text := nullif(btrim(p_cod_contract), '');
  v_mod text := nullif(lower(btrim(p_mod_alocare)), ''); v_desc text := nullif(btrim(p_descriere), ''); v_hash text; v_r jsonb; v_id bigint;
BEGIN
  PERFORM public.fn_dcc_config_permisa_intern();
  IF p_cheie IS NULL THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: cheia de intentie lipseste' USING ERRCODE = '22023'; END IF;
  IF v_ben IS NULL OR v_ben !~ '^[A-Z]{2,6}$' OR v_cod IS NULL OR v_cod !~ '^[0-9]{2}$' OR v_mod IS NULL OR v_mod NOT IN ('automat', 'manual') THEN
    RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: beneficiar (2-6 litere), cod (2 cifre), mod (automat / manual)' USING ERRCODE = '22023';
  END IF;
  v_hash := public.fn_dcc_hash_parametri('contract_creeaza', jsonb_build_object('beneficiar', v_ben, 'cod_contract', v_cod, 'mod_alocare', v_mod, 'descriere', v_desc));
  v_r := public.fn_dcc_intentie_reia(p_cheie, 'contract_creeaza', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  v_r := public.fn_dcc_intentie_revendica(p_cheie, 'contract_creeaza', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  INSERT INTO public.dcc_contracte (beneficiar, cod_contract, mod_alocare, descriere, creat_de, creat_prin)
  VALUES (v_ben, v_cod, v_mod, v_desc, v_uid, CASE WHEN v_uid IS NULL THEN 'server' ELSE 'om' END) RETURNING id INTO v_id;
  v_r := jsonb_build_object('contract_id', v_id, 'beneficiar', v_ben, 'cod_contract', v_cod, 'mod_alocare', v_mod);
  PERFORM public.fn_dcc_intentie_incheie(p_cheie, v_r);
  RETURN v_r || '{"reluat": false}'::jsonb;
END $f$;

-- proiectul DCC: creare (p_versiune NULL) sau UPDATE CAS pe versiune (0 rânduri = DCC_CONFLICT_VERSIUNE). Lock-urile: pasul 2 (advisory EXCLUSIV pe
-- contract, ÎNAINTEA verificării compatibilității ghidului — triggerul) -> pasul 3 (rândul proiectului FOR UPDATE). Nu atinge căsuța / trimiterea.
CREATE FUNCTION public.fn_dcc_proiect_seteaza(p_executie_proiect bigint, p_contract bigint, p_ghid bigint, p_emitent text, p_limba_implicita text,
                                              p_adresa_dcc text, p_cc text[], p_cc_implicit jsonb, p_antet_financiar text, p_plafon_mb integer,
                                              p_versiune integer, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_em text := nullif(upper(btrim(p_emitent)), ''); v_limba text := nullif(upper(btrim(p_limba_implicita)), '');
  v_adr text := nullif(lower(btrim(p_adresa_dcc)), ''); v_cc text[]; v_cci jsonb := coalesce(p_cc_implicit, '{}'::jsonb);
  v_antet text := nullif(btrim(p_antet_financiar), ''); v_plafon integer := coalesce(p_plafon_mb, 15); v_n integer; v_rele integer; v_hash text; v_r jsonb;
  v_id bigint; v_vers integer;
BEGIN
  PERFORM public.fn_dcc_config_permisa_intern();
  IF p_cheie IS NULL OR p_executie_proiect IS NULL OR p_contract IS NULL OR p_ghid IS NULL OR v_em IS NULL THEN
    RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: proiectul Executie, contractul, ghidul, emitentul si cheia sunt obligatorii' USING ERRCODE = '22023';
  END IF;
  IF v_limba IS NOT NULL AND v_limba NOT IN ('RO', 'EN', 'BI') OR v_adr IS NOT NULL AND v_adr !~ '^[^@[:space:]]+@[^@[:space:]]+$'
     OR jsonb_typeof(v_cci) IS DISTINCT FROM 'object' OR v_plafon NOT BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: limba / adresa DCC / CC implicit / plafon' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(c ORDER BY c), count(*) - count(DISTINCT c), count(*) FILTER (WHERE c IS NULL OR c !~ '^[^@[:space:]]+@[^@[:space:]]+$')
    INTO v_cc, v_n, v_rele
    FROM (SELECT nullif(lower(btrim(x)), '') AS c FROM unnest(coalesce(p_cc, '{}'::text[])) x) z;
  IF v_rele > 0 THEN RAISE EXCEPTION 'DCC_LISTA_INVALIDA: adresa CC invalida' USING ERRCODE = '22023'; END IF;
  IF v_n > 0 THEN RAISE EXCEPTION 'DCC_LISTA_DUBLURI: adrese CC dublate' USING ERRCODE = '22023'; END IF;
  v_cc := coalesce(v_cc, '{}'::text[]);
  v_hash := public.fn_dcc_hash_parametri('proiect_seteaza', jsonb_build_object('executie_proiect', p_executie_proiect, 'contract', p_contract, 'ghid', p_ghid,
    'emitent', v_em, 'limba_implicita', v_limba, 'adresa_dcc', v_adr, 'cc', to_jsonb(v_cc), 'cc_implicit', v_cci, 'antet_financiar', v_antet,
    'plafon_mb', v_plafon, 'versiune', p_versiune));
  v_r := public.fn_dcc_intentie_reia(p_cheie, 'proiect_seteaza', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  v_r := public.fn_dcc_intentie_revendica(p_cheie, 'proiect_seteaza', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  PERFORM public.fn_dcc_lock_contract(p_contract, true);
  IF p_versiune IS NULL THEN
    INSERT INTO public.dcc_proiecte (contract_id, executie_proiect_id, ghid_id, emitent, limba_implicita, adresa_dcc, cc_lista, cc_implicit, antet_financiar,
                                     plafon_atasamente_mb, creat_de)
    VALUES (p_contract, p_executie_proiect, p_ghid, v_em, v_limba, v_adr, v_cc, v_cci, v_antet, v_plafon, v_uid) RETURNING id, versiune INTO v_id, v_vers;
    v_r := jsonb_build_object('proiect_dcc_id', v_id, 'versiune', v_vers, 'creat', true);
  ELSE
    SELECT d.id INTO v_id FROM public.dcc_proiecte d WHERE d.executie_proiect_id = p_executie_proiect AND d.contract_id = p_contract FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: proiectul DCC nu exista' USING ERRCODE = '22023'; END IF;
    UPDATE public.dcc_proiecte d SET ghid_id = p_ghid, emitent = v_em, limba_implicita = v_limba, adresa_dcc = v_adr, cc_lista = v_cc, cc_implicit = v_cci,
                                     antet_financiar = v_antet, plafon_atasamente_mb = v_plafon, actualizat_de = v_uid
     WHERE d.id = v_id AND d.versiune = p_versiune
    RETURNING d.versiune INTO v_vers;
    IF v_vers IS NULL THEN
      RAISE EXCEPTION 'DCC_CONFLICT_VERSIUNE: proiectul DCC a fost schimbat intre timp; reincarca' USING ERRCODE = '40001';
    END IF;
    v_r := jsonb_build_object('proiect_dcc_id', v_id, 'versiune', v_vers, 'creat', false);
  END IF;
  PERFORM public.fn_dcc_intentie_incheie(p_cheie, v_r);
  RETURN v_r || '{"reluat": false}'::jsonb;
END $f$;

-- ─── 5b. RPC-urile registrului + citirea seriilor

-- inițializarea unei serii (admin pe proiect sau calea serverului): pragul = ultimul număr ocupat confirmat de om. Lock-urile: pasul 2 (advisory
-- PARTAJAT pe contract) -> pasul 3 (proiectul FOR SHARE) -> pasul 4 (advisory pe cheia seriei FĂRĂ interval); disjuncția față de TOATE seriile
-- cheii verificată după lock (codul RPC-ului DCC_INTERVALE_SUPRAPUSE; plasa e triggerul); limitele copiate din ghidul proiectului; pragul >= orice
-- document existent pe cheie în interval (tot contractul) și, fără accept explicit, >= maximul istoric.
CREATE FUNCTION public.fn_dcc_initializeaza_serie(p_proiect_dcc bigint, p_emitent text, p_tematica text, p_tip text, p_interval text, p_prag integer,
                                                  p_motiv text, p_accept_sub_istoric boolean, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_srv boolean := public.fn_dcc_server(); v_em text := nullif(upper(btrim(p_emitent)), '');
  v_tem text := nullif(upper(btrim(p_tematica)), ''); v_tip text := nullif(upper(btrim(p_tip)), ''); v_int text; v_motiv text := nullif(btrim(p_motiv), '');
  v_acc boolean := coalesce(p_accept_sub_istoric, false); v_hash text; v_r jsonb; v_contract bigint; p public.dcc_proiecte; c public.dcc_contracte;
  gi public.dcc_ghid_intervale; v_max_doc integer; v_max_ist integer; v_id bigint;
BEGIN
  IF v_uid IS NULL AND NOT v_srv THEN RAISE EXCEPTION 'DCC_NEAUTENTIFICAT: autentificare necesara' USING ERRCODE = '42501'; END IF;
  v_int := public.fn_dcc_interval_canonic(p_interval);
  IF p_cheie IS NULL OR p_proiect_dcc IS NULL OR v_em IS NULL OR v_tip IS NULL OR p_prag IS NULL THEN
    RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: proiect, emitent, tip, prag si cheie obligatorii' USING ERRCODE = '22023';
  END IF;
  IF v_int IS NULL THEN RAISE EXCEPTION 'DCC_INTERVAL_INVALID: intervalul lipseste' USING ERRCODE = '22023'; END IF;
  IF v_motiv IS NULL OR length(v_motiv) > 500 THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: motivul pragului e obligatoriu (max 500)' USING ERRCODE = '22023'; END IF;
  v_hash := public.fn_dcc_hash_parametri('initializeaza_serie', jsonb_build_object('proiect', p_proiect_dcc, 'emitent', v_em, 'tematica', v_tem, 'tip', v_tip,
    'interval', v_int, 'prag', p_prag, 'motiv', v_motiv, 'accept_sub_istoric', v_acc));
  v_r := public.fn_dcc_intentie_reia(p_cheie, 'initializeaza_serie', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  IF NOT v_srv AND NOT public.fn_dcc_drept(p_proiect_dcc, 'admin') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  v_r := public.fn_dcc_intentie_revendica(p_cheie, 'initializeaza_serie', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  -- lock-urile: 2 (partajat, contractul) -> 3 (proiectul) -> 4 (cheia seriei fără interval)
  SELECT d.contract_id INTO v_contract FROM public.dcc_proiecte d WHERE d.id = p_proiect_dcc;
  PERFORM public.fn_dcc_lock_contract(v_contract, false);
  SELECT * INTO p FROM public.dcc_proiecte d WHERE d.id = p_proiect_dcc FOR SHARE;
  IF p.contract_id IS DISTINCT FROM v_contract THEN RAISE EXCEPTION 'DCC_CONFLICT_VERSIUNE: proiectul s-a schimbat; reincearca' USING ERRCODE = '40001'; END IF;
  PERFORM public.fn_dcc_lock_cheie_serie(v_contract, v_em, v_tem, v_tip, v_int);
  -- reverificarea după lock
  IF NOT v_srv AND NOT public.fn_dcc_drept(p_proiect_dcc, 'admin') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.dcc_contracte x WHERE x.id = v_contract;
  IF c.mod_alocare <> 'automat' THEN RAISE EXCEPTION 'DCC_MOD_MANUAL: contractul aloca manual (fara serii)' USING ERRCODE = 'P0001'; END IF;
  IF v_em IS DISTINCT FROM p.emitent THEN RAISE EXCEPTION 'DCC_EMITENT_STRAIN: emitentul nu e al proiectului' USING ERRCODE = '22023'; END IF;
  PERFORM public.fn_dcc_valori_ghid_intern(p.ghid_id, v_tem, v_tip);
  SELECT * INTO gi FROM public.dcc_ghid_intervale x WHERE x.ghid_id = p.ghid_id AND x.interval = v_int;
  IF NOT FOUND THEN RAISE EXCEPTION 'DCC_INTERVAL_NECUNOSCUT: intervalul % nu e in ghidul proiectului', v_int USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.dcc_serii s WHERE s.contract_id = v_contract AND s.emitent = v_em AND s.tematica IS NOT DISTINCT FROM v_tem
                AND s.tip = v_tip AND s.interval = v_int) THEN
    RAISE EXCEPTION 'DCC_SERIE_EXISTA: seria % e deja initializata', v_int USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.dcc_serii s WHERE s.contract_id = v_contract AND s.emitent = v_em AND s.tematica IS NOT DISTINCT FROM v_tem
                AND s.tip = v_tip AND s.limita_inf <= gi.limita_sup AND gi.limita_inf <= s.limita_sup) THEN
    RAISE EXCEPTION 'DCC_INTERVALE_SUPRAPUSE: intervalul % se suprapune cu o serie existenta a aceleiasi chei', v_int USING ERRCODE = '23P01';
  END IF;
  IF p_prag < gi.limita_inf - 1 OR p_prag > gi.limita_sup THEN
    RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: pragul % e in afara intervalului % (% - %)', p_prag, v_int, gi.limita_inf, gi.limita_sup USING ERRCODE = '22023';
  END IF;
  SELECT max(d.secventa) INTO v_max_doc FROM public.dcc_documente d
   WHERE d.contract_id = v_contract AND d.emitent = v_em AND d.tematica IS NOT DISTINCT FROM v_tem AND d.tip = v_tip
     AND d.secventa BETWEEN gi.limita_inf AND gi.limita_sup;
  IF v_max_doc IS NOT NULL AND p_prag < v_max_doc THEN
    RAISE EXCEPTION 'DCC_PRAG_SUB_DOCUMENTE: pragul % e sub un numar deja alocat (%)', p_prag, v_max_doc USING ERRCODE = 'P0001';
  END IF;
  SELECT max(h.secventa) INTO v_max_ist FROM public.dcc_istoric_aparitii h
   WHERE h.contract_id = v_contract AND h.emitent IS NOT DISTINCT FROM v_em AND h.tematica IS NOT DISTINCT FROM v_tem AND h.tip IS NOT DISTINCT FROM v_tip
     AND h.secventa BETWEEN gi.limita_inf AND gi.limita_sup;
  IF v_max_ist IS NOT NULL AND p_prag < v_max_ist AND NOT v_acc THEN
    RAISE EXCEPTION 'DCC_PRAG_SUB_ISTORIC: pragul % e sub maximul istoric (%); confirmarea explicita e obligatorie', p_prag, v_max_ist USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.dcc_serii (contract_id, emitent, tematica, tip, interval, ghid_id, limita_inf, limita_sup, prag_initial, ultimul_ocupat, motiv_prag,
                                max_istoric_la_init, initializata_de, initializata_prin)
  VALUES (v_contract, v_em, v_tem, v_tip, v_int, p.ghid_id, gi.limita_inf, gi.limita_sup, p_prag, p_prag, v_motiv, v_max_ist, v_uid,
          CASE WHEN v_uid IS NULL THEN 'server' ELSE 'om' END)
  RETURNING id INTO v_id;
  v_r := jsonb_build_object('serie_id', v_id, 'interval', v_int, 'limita_inf', gi.limita_inf, 'limita_sup', gi.limita_sup, 'prag', p_prag,
                            'urmatorul', p_prag + 1, 'max_istoric', v_max_ist);
  PERFORM public.fn_dcc_intentie_incheie(p_cheie, v_r);
  RETURN v_r || '{"reluat": false}'::jsonb;
END $f$;

-- alocarea automată: documentul + Rev0 (sau filele 1..N cu Rev0 fiecare, [D3]) + contorul, într-o tranzacție (L02). Lock-urile: pasul 3 (proiectul
-- FOR SHARE) -> pasul 5 (rândul seriei FOR UPDATE: contorul, L01). Ordinea FIXĂ după lock (determinismul probei de concurență): citirea seriei ->
-- următorul = ultimul_ocupat + 1 -> UPDATE dcc_serii -> INSERT document + revizii. Nu ia pașii 2 și 4.
CREATE FUNCTION public.fn_dcc_aloca(p_proiect_dcc bigint, p_emitent text, p_tematica text, p_tip text, p_interval text, p_titlu text, p_limba text,
                                    p_nr_file integer, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_em text := nullif(upper(btrim(p_emitent)), ''); v_tem text := nullif(upper(btrim(p_tematica)), '');
  v_tip text := nullif(upper(btrim(p_tip)), ''); v_int text; v_titlu text := nullif(btrim(p_titlu), ''); v_limba text := nullif(upper(btrim(p_limba)), '');
  v_hash text; v_r jsonb; p public.dcc_proiecte; c public.dcc_contracte; s public.dcc_serii; gi public.dcc_ghid_intervale; v_urmator integer;
  v_doc bigint; v_fila bigint; v_rev bigint; v_coduri text[]; v_revizii jsonb := '[]'::jsonb; i integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DCC_NEAUTENTIFICAT: autentificare necesara' USING ERRCODE = '42501'; END IF;
  v_int := public.fn_dcc_interval_canonic(p_interval);
  IF p_cheie IS NULL OR p_proiect_dcc IS NULL OR v_em IS NULL OR v_tip IS NULL THEN
    RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: proiect, emitent, tip si cheie obligatorii' USING ERRCODE = '22023';
  END IF;
  IF v_int IS NULL THEN RAISE EXCEPTION 'DCC_INTERVAL_INVALID: intervalul lipseste' USING ERRCODE = '22023'; END IF;
  IF v_titlu IS NULL OR length(v_titlu) > 300 THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: titlul e obligatoriu (max 300)' USING ERRCODE = '22023'; END IF;
  IF p_nr_file IS NOT NULL AND p_nr_file NOT BETWEEN 1 AND 999 THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: numarul de file e 1..999' USING ERRCODE = '22023'; END IF;
  v_hash := public.fn_dcc_hash_parametri('aloca', jsonb_build_object('proiect', p_proiect_dcc, 'emitent', v_em, 'tematica', v_tem, 'tip', v_tip, 'interval', v_int,
    'titlu', v_titlu, 'limba', v_limba, 'nr_file', p_nr_file));
  v_r := public.fn_dcc_intentie_reia(p_cheie, 'aloca', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  IF NOT public.fn_dcc_drept(p_proiect_dcc, 'scriere') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  v_r := public.fn_dcc_intentie_revendica(p_cheie, 'aloca', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  -- lock-urile: 3 (proiectul) -> 5 (seria)
  SELECT * INTO p FROM public.dcc_proiecte d WHERE d.id = p_proiect_dcc FOR SHARE;
  SELECT * INTO s FROM public.dcc_serii x WHERE x.contract_id = p.contract_id AND x.emitent = v_em AND x.tematica IS NOT DISTINCT FROM v_tem AND x.tip = v_tip
     AND x.interval = v_int FOR UPDATE;
  -- reverificarea după lock (dreptul cu un instantaneu nou: o retragere comisă cât am așteptat se vede aici)
  IF NOT public.fn_dcc_drept(p_proiect_dcc, 'scriere') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.dcc_contracte x WHERE x.id = p.contract_id;
  IF c.mod_alocare <> 'automat' THEN RAISE EXCEPTION 'DCC_MOD_MANUAL: contractul aloca manual' USING ERRCODE = 'P0001'; END IF;
  IF v_em IS DISTINCT FROM p.emitent THEN RAISE EXCEPTION 'DCC_EMITENT_STRAIN: emitentul nu e al proiectului' USING ERRCODE = '22023'; END IF;
  PERFORM public.fn_dcc_valori_ghid_intern(p.ghid_id, v_tem, v_tip);
  IF s.id IS NULL THEN RAISE EXCEPTION 'DCC_SERIE_ABSENTA: seria nu e initializata (nu porneste singura de la 00001)' USING ERRCODE = 'P0001'; END IF;
  -- regula 3: ghidul CURENT al proiectului are intervalul seriei cu aceleași limite
  SELECT * INTO gi FROM public.dcc_ghid_intervale x WHERE x.ghid_id = p.ghid_id AND x.interval = s.interval;
  IF NOT FOUND THEN RAISE EXCEPTION 'DCC_INTERVAL_NECUNOSCUT: intervalul % nu e in ghidul proiectului', s.interval USING ERRCODE = 'P0001'; END IF;
  IF gi.limita_inf <> s.limita_inf OR gi.limita_sup <> s.limita_sup THEN
    RAISE EXCEPTION 'DCC_GHID_INCOMPATIBIL: intervalul % al ghidului are alte limite decat seria', s.interval USING ERRCODE = 'P0001';
  END IF;
  v_urmator := s.ultimul_ocupat + 1;
  IF v_urmator > s.limita_sup THEN RAISE EXCEPTION 'DCC_INTERVAL_EPUIZAT: intervalul % e epuizat', s.interval USING ERRCODE = 'P0001'; END IF;
  v_limba := coalesce(v_limba, p.limba_implicita);
  UPDATE public.dcc_serii x SET ultimul_ocupat = v_urmator WHERE x.id = s.id;
  BEGIN
    INSERT INTO public.dcc_documente (contract_id, proiect_dcc_id, emitent, tematica, tip, secventa, interval, serie_id, mod, titlu, are_file, creat_de)
    VALUES (p.contract_id, p.id, v_em, v_tem, v_tip, v_urmator, s.interval, s.id, 'automat', v_titlu, p_nr_file IS NOT NULL, v_uid) RETURNING id INTO v_doc;
    IF p_nr_file IS NULL THEN
      v_coduri := public.fn_dcc_coduri_intern(p.ghid_id, c.cod_contract, v_em, v_tem, v_tip, v_urmator, NULL, NULL, 0, v_limba);
      INSERT INTO public.dcc_revizii (contract_id, document_id, revizie, limba, titlu, ghid_id, cod_text, nume_fisier_baza, creat_de)
      VALUES (p.contract_id, v_doc, 0, v_limba, v_titlu, p.ghid_id, v_coduri[1], v_coduri[2], v_uid) RETURNING id INTO v_rev;
      v_revizii := v_revizii || jsonb_build_object('revizie_id', v_rev, 'fila', NULL, 'revizie', 0, 'limba', v_limba, 'cod_text', v_coduri[1], 'nume_fisier_baza', v_coduri[2]);
    ELSE
      FOR i IN 1 .. p_nr_file LOOP
        INSERT INTO public.dcc_file (document_id, fila, creat_de) VALUES (v_doc, i, v_uid) RETURNING id INTO v_fila;
        v_coduri := public.fn_dcc_coduri_intern(p.ghid_id, c.cod_contract, v_em, v_tem, v_tip, v_urmator, i, NULL, 0, v_limba);
        INSERT INTO public.dcc_revizii (contract_id, document_id, fila_id, revizie, limba, titlu, ghid_id, cod_text, nume_fisier_baza, creat_de)
        VALUES (p.contract_id, v_doc, v_fila, 0, v_limba, v_titlu, p.ghid_id, v_coduri[1], v_coduri[2], v_uid) RETURNING id INTO v_rev;
        v_revizii := v_revizii || jsonb_build_object('revizie_id', v_rev, 'fila', i, 'revizie', 0, 'limba', v_limba, 'cod_text', v_coduri[1], 'nume_fisier_baza', v_coduri[2]);
      END LOOP;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'DCC_COD_OCUPAT: codul e deja folosit pe contract' USING ERRCODE = '23505';
  END;
  v_r := jsonb_build_object('document_id', v_doc, 'secventa', v_urmator, 'interval', s.interval, 'revizii', v_revizii);
  PERFORM public.fn_dcc_intentie_incheie(p_cheie, v_r);
  RETURN v_r || '{"reluat": false}'::jsonb;
END $f$;

-- alocarea manuală (contract manual, ex. Lot 4): omul scrie secvența primită; BD verifică unicitatea pe contract. Lock-urile: pasul 2 (advisory
-- PARTAJAT pe contract) -> 3 (proiectul FOR SHARE) -> 4 (cheia seriei fără interval: o inițializare concurentă pe cheie se serializează).
CREATE FUNCTION public.fn_dcc_aloca_manual(p_proiect_dcc bigint, p_emitent text, p_tematica text, p_tip text, p_secventa integer, p_titlu text,
                                           p_limba text, p_nr_file integer, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_em text := nullif(upper(btrim(p_emitent)), ''); v_tem text := nullif(upper(btrim(p_tematica)), '');
  v_tip text := nullif(upper(btrim(p_tip)), ''); v_titlu text := nullif(btrim(p_titlu), ''); v_limba text := nullif(upper(btrim(p_limba)), '');
  v_hash text; v_r jsonb; v_contract bigint; p public.dcc_proiecte; c public.dcc_contracte; v_doc bigint; v_fila bigint; v_rev bigint; v_coduri text[];
  v_revizii jsonb := '[]'::jsonb; i integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DCC_NEAUTENTIFICAT: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_cheie IS NULL OR p_proiect_dcc IS NULL OR v_em IS NULL OR v_tip IS NULL OR p_secventa IS NULL OR p_secventa NOT BETWEEN 1 AND 99999 THEN
    RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: proiect, emitent, tip, secventa (1..99999) si cheie obligatorii' USING ERRCODE = '22023';
  END IF;
  IF v_titlu IS NULL OR length(v_titlu) > 300 THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: titlul e obligatoriu (max 300)' USING ERRCODE = '22023'; END IF;
  IF p_nr_file IS NOT NULL AND p_nr_file NOT BETWEEN 1 AND 999 THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: numarul de file e 1..999' USING ERRCODE = '22023'; END IF;
  v_hash := public.fn_dcc_hash_parametri('aloca_manual', jsonb_build_object('proiect', p_proiect_dcc, 'emitent', v_em, 'tematica', v_tem, 'tip', v_tip,
    'secventa', p_secventa, 'titlu', v_titlu, 'limba', v_limba, 'nr_file', p_nr_file));
  v_r := public.fn_dcc_intentie_reia(p_cheie, 'aloca_manual', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  IF NOT public.fn_dcc_drept(p_proiect_dcc, 'scriere') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  v_r := public.fn_dcc_intentie_revendica(p_cheie, 'aloca_manual', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  -- lock-urile: 2 (partajat) -> 3 -> 4
  SELECT d.contract_id INTO v_contract FROM public.dcc_proiecte d WHERE d.id = p_proiect_dcc;
  PERFORM public.fn_dcc_lock_contract(v_contract, false);
  SELECT * INTO p FROM public.dcc_proiecte d WHERE d.id = p_proiect_dcc FOR SHARE;
  IF p.contract_id IS DISTINCT FROM v_contract THEN RAISE EXCEPTION 'DCC_CONFLICT_VERSIUNE: proiectul s-a schimbat; reincearca' USING ERRCODE = '40001'; END IF;
  PERFORM public.fn_dcc_lock_cheie_serie(v_contract, v_em, v_tem, v_tip, NULL);
  -- reverificarea după lock
  IF NOT public.fn_dcc_drept(p_proiect_dcc, 'scriere') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.dcc_contracte x WHERE x.id = v_contract;
  IF c.mod_alocare <> 'manual' THEN RAISE EXCEPTION 'DCC_MOD_AUTOMAT: contractul aloca automat (din serie)' USING ERRCODE = 'P0001'; END IF;
  IF v_em IS DISTINCT FROM p.emitent THEN RAISE EXCEPTION 'DCC_EMITENT_STRAIN: emitentul nu e al proiectului' USING ERRCODE = '22023'; END IF;
  PERFORM public.fn_dcc_valori_ghid_intern(p.ghid_id, v_tem, v_tip);
  IF EXISTS (SELECT 1 FROM public.dcc_serii s WHERE s.contract_id = v_contract AND s.emitent = v_em AND s.tematica IS NOT DISTINCT FROM v_tem AND s.tip = v_tip) THEN
    RAISE EXCEPTION 'DCC_SERIE_AUTOMATA: cheia are o serie initializata (alocare automata)' USING ERRCODE = 'P0001';
  END IF;
  v_limba := coalesce(v_limba, p.limba_implicita);
  BEGIN
    INSERT INTO public.dcc_documente (contract_id, proiect_dcc_id, emitent, tematica, tip, secventa, interval, serie_id, mod, titlu, are_file, creat_de)
    VALUES (v_contract, p.id, v_em, v_tem, v_tip, p_secventa, NULL, NULL, 'manual', v_titlu, p_nr_file IS NOT NULL, v_uid) RETURNING id INTO v_doc;
    IF p_nr_file IS NULL THEN
      v_coduri := public.fn_dcc_coduri_intern(p.ghid_id, c.cod_contract, v_em, v_tem, v_tip, p_secventa, NULL, NULL, 0, v_limba);
      INSERT INTO public.dcc_revizii (contract_id, document_id, revizie, limba, titlu, ghid_id, cod_text, nume_fisier_baza, creat_de)
      VALUES (v_contract, v_doc, 0, v_limba, v_titlu, p.ghid_id, v_coduri[1], v_coduri[2], v_uid) RETURNING id INTO v_rev;
      v_revizii := v_revizii || jsonb_build_object('revizie_id', v_rev, 'fila', NULL, 'revizie', 0, 'limba', v_limba, 'cod_text', v_coduri[1], 'nume_fisier_baza', v_coduri[2]);
    ELSE
      FOR i IN 1 .. p_nr_file LOOP
        INSERT INTO public.dcc_file (document_id, fila, creat_de) VALUES (v_doc, i, v_uid) RETURNING id INTO v_fila;
        v_coduri := public.fn_dcc_coduri_intern(p.ghid_id, c.cod_contract, v_em, v_tem, v_tip, p_secventa, i, NULL, 0, v_limba);
        INSERT INTO public.dcc_revizii (contract_id, document_id, fila_id, revizie, limba, titlu, ghid_id, cod_text, nume_fisier_baza, creat_de)
        VALUES (v_contract, v_doc, v_fila, 0, v_limba, v_titlu, p.ghid_id, v_coduri[1], v_coduri[2], v_uid) RETURNING id INTO v_rev;
        v_revizii := v_revizii || jsonb_build_object('revizie_id', v_rev, 'fila', i, 'revizie', 0, 'limba', v_limba, 'cod_text', v_coduri[1], 'nume_fisier_baza', v_coduri[2]);
      END LOOP;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    -- fără detalii despre ocupant (id, titlu, proiect): mesajul e același pentru orice coliziune
    RAISE EXCEPTION 'DCC_COD_OCUPAT: codul e deja folosit pe contract' USING ERRCODE = '23505';
  END;
  v_r := jsonb_build_object('document_id', v_doc, 'secventa', p_secventa, 'interval', NULL, 'revizii', v_revizii);
  PERFORM public.fn_dcc_intentie_incheie(p_cheie, v_r);
  RETURN v_r || '{"reluat": false}'::jsonb;
END $f$;

-- revizia nouă pe document / filă / anexă: revizia = max(revizie) pe țintă (toate limbile, inclusiv anulate) + 1, sub lock-ul documentului.
-- Lock-urile: pasul 3 (proiectul FOR SHARE) -> pasul 6 (documentul FOR UPDATE). Codul cu formatele ghidului CURENT; textul vechi rămâne.
CREATE FUNCTION public.fn_dcc_revizie_noua(p_document bigint, p_fila bigint, p_anexa bigint, p_titlu text, p_limba text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_titlu text := nullif(btrim(p_titlu), ''); v_limba text := nullif(upper(btrim(p_limba)), ''); v_hash text; v_r jsonb;
  v_proiect bigint; p public.dcc_proiecte; d public.dcc_documente; c public.dcc_contracte; u public.dcc_revizii; v_nr_fila integer; v_nr_anexa integer;
  v_rev integer; v_id bigint; v_coduri text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DCC_NEAUTENTIFICAT: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_cheie IS NULL OR p_document IS NULL THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: documentul si cheia sunt obligatorii' USING ERRCODE = '22023'; END IF;
  IF p_fila IS NOT NULL AND p_anexa IS NOT NULL THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: cel mult una din fila / anexa' USING ERRCODE = '22023'; END IF;
  IF v_titlu IS NOT NULL AND length(v_titlu) > 300 THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: titlul are max 300 de caractere' USING ERRCODE = '22023'; END IF;
  v_hash := public.fn_dcc_hash_parametri('revizie_noua', jsonb_build_object('document', p_document, 'fila', p_fila, 'anexa', p_anexa, 'titlu', v_titlu, 'limba', v_limba));
  v_r := public.fn_dcc_intentie_reia(p_cheie, 'revizie_noua', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  SELECT x.proiect_dcc_id INTO v_proiect FROM public.dcc_documente x WHERE x.id = p_document;
  IF v_proiect IS NULL OR NOT public.fn_dcc_drept(v_proiect, 'scriere') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  v_r := public.fn_dcc_intentie_revendica(p_cheie, 'revizie_noua', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  -- lock-urile: 3 (proiectul) -> 6 (documentul)
  SELECT * INTO p FROM public.dcc_proiecte x WHERE x.id = v_proiect FOR SHARE;
  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = p_document FOR UPDATE;
  -- reverificarea după lock: dreptul, starea documentului, ținta
  IF NOT public.fn_dcc_drept(v_proiect, 'scriere') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  IF d.stare = 'anulat' THEN RAISE EXCEPTION 'DCC_DOCUMENT_ANULAT: documentul e anulat' USING ERRCODE = 'P0001'; END IF;
  IF p_fila IS NOT NULL THEN
    SELECT f.fila INTO v_nr_fila FROM public.dcc_file f WHERE f.id = p_fila AND f.document_id = d.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'DCC_TINTA_STRAINA: fila nu e a documentului' USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_anexa IS NOT NULL THEN
    SELECT a.numar INTO v_nr_anexa FROM public.dcc_anexe a WHERE a.id = p_anexa AND a.document_id = d.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'DCC_TINTA_STRAINA: anexa nu e a documentului' USING ERRCODE = '22023'; END IF;
  END IF;
  IF (d.are_file AND p_fila IS NULL AND p_anexa IS NULL) OR (NOT d.are_file AND p_fila IS NOT NULL) THEN
    RAISE EXCEPTION 'DCC_TINTA_NEPOTRIVITA: pe un document cu file revizia e pe o fila sau anexa; fara file, nu are fila' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO u FROM public.dcc_revizii r WHERE r.document_id = d.id AND r.fila_id IS NOT DISTINCT FROM p_fila AND r.anexa_id IS NOT DISTINCT FROM p_anexa
   ORDER BY r.revizie DESC, r.id DESC LIMIT 1;
  v_rev := coalesce(u.revizie, -1) + 1;
  v_limba := coalesce(v_limba, u.limba, p.limba_implicita);
  SELECT * INTO c FROM public.dcc_contracte x WHERE x.id = d.contract_id;
  v_coduri := public.fn_dcc_coduri_intern(p.ghid_id, c.cod_contract, d.emitent, d.tematica, d.tip, d.secventa, v_nr_fila, v_nr_anexa, v_rev, v_limba);
  BEGIN
    INSERT INTO public.dcc_revizii (contract_id, document_id, fila_id, anexa_id, revizie, limba, titlu, ghid_id, cod_text, nume_fisier_baza, creat_de)
    VALUES (d.contract_id, d.id, p_fila, p_anexa, v_rev, v_limba, v_titlu, p.ghid_id, v_coduri[1], v_coduri[2], v_uid) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'DCC_COD_OCUPAT: codul e deja folosit pe contract' USING ERRCODE = '23505';
  END;
  v_r := jsonb_build_object('document_id', d.id, 'revizie_id', v_id,
           'tinta', jsonb_build_object('tip', CASE WHEN p_fila IS NOT NULL THEN 'fila' WHEN p_anexa IS NOT NULL THEN 'anexa' ELSE 'document' END,
                                       'fila', v_nr_fila, 'anexa', v_nr_anexa),
           'revizie', v_rev, 'limba', v_limba, 'cod_text', v_coduri[1], 'nume_fisier_baza', v_coduri[2],
           'ultima_netrimisa', coalesce(u.stare_transport IN ('rezervata', 'pregatita', 'copiata_pentru_gmail'), false));
  PERFORM public.fn_dcc_intentie_incheie(p_cheie, v_r);
  RETURN v_r || '{"reluat": false}'::jsonb;
END $f$;

-- fila nouă (doar pe un document declarat cu file): fila + Rev0. Lock-urile: 3 -> 6.
CREATE FUNCTION public.fn_dcc_fila_noua(p_document bigint, p_fila integer, p_titlu text, p_limba text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_titlu text := nullif(btrim(p_titlu), ''); v_limba text := nullif(upper(btrim(p_limba)), ''); v_hash text; v_r jsonb;
  v_proiect bigint; p public.dcc_proiecte; d public.dcc_documente; c public.dcc_contracte; v_fila bigint; v_id bigint; v_coduri text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DCC_NEAUTENTIFICAT: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_cheie IS NULL OR p_document IS NULL OR p_fila IS NULL OR p_fila NOT BETWEEN 1 AND 999 THEN
    RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: documentul, fila (1..999) si cheia sunt obligatorii' USING ERRCODE = '22023';
  END IF;
  IF v_titlu IS NOT NULL AND length(v_titlu) > 300 THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: titlul are max 300 de caractere' USING ERRCODE = '22023'; END IF;
  v_hash := public.fn_dcc_hash_parametri('fila_noua', jsonb_build_object('document', p_document, 'fila', p_fila, 'titlu', v_titlu, 'limba', v_limba));
  v_r := public.fn_dcc_intentie_reia(p_cheie, 'fila_noua', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  SELECT x.proiect_dcc_id INTO v_proiect FROM public.dcc_documente x WHERE x.id = p_document;
  IF v_proiect IS NULL OR NOT public.fn_dcc_drept(v_proiect, 'scriere') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  v_r := public.fn_dcc_intentie_revendica(p_cheie, 'fila_noua', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  SELECT * INTO p FROM public.dcc_proiecte x WHERE x.id = v_proiect FOR SHARE;
  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = p_document FOR UPDATE;
  IF NOT public.fn_dcc_drept(v_proiect, 'scriere') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  IF d.stare = 'anulat' THEN RAISE EXCEPTION 'DCC_DOCUMENT_ANULAT: documentul e anulat' USING ERRCODE = 'P0001'; END IF;
  IF NOT d.are_file THEN RAISE EXCEPTION 'DCC_FARA_FILE: documentul nu a fost declarat cu file' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.dcc_file f WHERE f.document_id = d.id AND f.fila = p_fila) THEN
    RAISE EXCEPTION 'DCC_FILA_EXISTA: fila exista deja pe document' USING ERRCODE = '23505';
  END IF;
  v_limba := coalesce(v_limba, p.limba_implicita);
  SELECT * INTO c FROM public.dcc_contracte x WHERE x.id = d.contract_id;
  v_coduri := public.fn_dcc_coduri_intern(p.ghid_id, c.cod_contract, d.emitent, d.tematica, d.tip, d.secventa, p_fila, NULL, 0, v_limba);
  BEGIN
    INSERT INTO public.dcc_file (document_id, fila, titlu, creat_de) VALUES (d.id, p_fila, v_titlu, v_uid) RETURNING id INTO v_fila;
    INSERT INTO public.dcc_revizii (contract_id, document_id, fila_id, revizie, limba, titlu, ghid_id, cod_text, nume_fisier_baza, creat_de)
    VALUES (d.contract_id, d.id, v_fila, 0, v_limba, v_titlu, p.ghid_id, v_coduri[1], v_coduri[2], v_uid) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'DCC_COD_OCUPAT: codul e deja folosit pe contract' USING ERRCODE = '23505';
  END;
  v_r := jsonb_build_object('document_id', d.id, 'fila_id', v_fila, 'fila', p_fila, 'revizie_id', v_id, 'cod_text', v_coduri[1], 'nume_fisier_baza', v_coduri[2]);
  PERFORM public.fn_dcc_intentie_incheie(p_cheie, v_r);
  RETURN v_r || '{"reluat": false}'::jsonb;
END $f$;

-- anexa nouă: numărul = max + 1 sub lock-ul documentului; anexa + Rev0. Lock-urile: 3 -> 6.
CREATE FUNCTION public.fn_dcc_anexa_noua(p_document bigint, p_titlu text, p_limba text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_titlu text := nullif(btrim(p_titlu), ''); v_limba text := nullif(upper(btrim(p_limba)), ''); v_hash text; v_r jsonb;
  v_proiect bigint; p public.dcc_proiecte; d public.dcc_documente; c public.dcc_contracte; v_nr integer; v_anexa bigint; v_id bigint; v_coduri text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DCC_NEAUTENTIFICAT: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_cheie IS NULL OR p_document IS NULL THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: documentul si cheia sunt obligatorii' USING ERRCODE = '22023'; END IF;
  IF v_titlu IS NULL OR length(v_titlu) > 300 THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: titlul anexei e obligatoriu (max 300)' USING ERRCODE = '22023'; END IF;
  v_hash := public.fn_dcc_hash_parametri('anexa_noua', jsonb_build_object('document', p_document, 'titlu', v_titlu, 'limba', v_limba));
  v_r := public.fn_dcc_intentie_reia(p_cheie, 'anexa_noua', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  SELECT x.proiect_dcc_id INTO v_proiect FROM public.dcc_documente x WHERE x.id = p_document;
  IF v_proiect IS NULL OR NOT public.fn_dcc_drept(v_proiect, 'scriere') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  v_r := public.fn_dcc_intentie_revendica(p_cheie, 'anexa_noua', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  SELECT * INTO p FROM public.dcc_proiecte x WHERE x.id = v_proiect FOR SHARE;
  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = p_document FOR UPDATE;
  IF NOT public.fn_dcc_drept(v_proiect, 'scriere') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  IF d.stare = 'anulat' THEN RAISE EXCEPTION 'DCC_DOCUMENT_ANULAT: documentul e anulat' USING ERRCODE = 'P0001'; END IF;
  SELECT coalesce(max(a.numar), 0) + 1 INTO v_nr FROM public.dcc_anexe a WHERE a.document_id = d.id;
  v_limba := coalesce(v_limba, p.limba_implicita);
  SELECT * INTO c FROM public.dcc_contracte x WHERE x.id = d.contract_id;
  v_coduri := public.fn_dcc_coduri_intern(p.ghid_id, c.cod_contract, d.emitent, d.tematica, d.tip, d.secventa, NULL, v_nr, 0, v_limba);
  BEGIN
    INSERT INTO public.dcc_anexe (document_id, numar, titlu, creat_de) VALUES (d.id, v_nr, v_titlu, v_uid) RETURNING id INTO v_anexa;
    INSERT INTO public.dcc_revizii (contract_id, document_id, anexa_id, revizie, limba, titlu, ghid_id, cod_text, nume_fisier_baza, creat_de)
    VALUES (d.contract_id, d.id, v_anexa, 0, v_limba, v_titlu, p.ghid_id, v_coduri[1], v_coduri[2], v_uid) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'DCC_COD_OCUPAT: codul e deja folosit pe contract' USING ERRCODE = '23505';
  END;
  v_r := jsonb_build_object('document_id', d.id, 'anexa_id', v_anexa, 'anexa', v_nr, 'revizie_id', v_id, 'cod_text', v_coduri[1], 'nume_fisier_baza', v_coduri[2]);
  PERFORM public.fn_dcc_intentie_incheie(p_cheie, v_r);
  RETURN v_r || '{"reluat": false}'::jsonb;
END $f$;

-- anularea ([D7], admin): exact unul din document / revizie; motivul obligatoriu, păstrat pe document ȘI pe fiecare revizie anulată. Documentul:
-- reviziile netrimise -> anulata (prin 'document', același motiv); cele trimise rămân (istoric); seria NU scade. Revizia: doar din rezervata /
-- pregatita / copiata. Lock-urile: 3 -> 6.
CREATE FUNCTION public.fn_dcc_anuleaza(p_document bigint, p_revizie bigint, p_motiv text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_motiv text := nullif(btrim(p_motiv), ''); v_hash text; v_r jsonb; v_doc bigint; v_proiect bigint;
  d public.dcc_documente; rv public.dcc_revizii; v_anulate jsonb; v_pastrate jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DCC_NEAUTENTIFICAT: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_cheie IS NULL OR num_nonnulls(p_document, p_revizie) <> 1 THEN
    RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: exact unul din document / revizie, plus cheia' USING ERRCODE = '22023';
  END IF;
  IF v_motiv IS NULL OR length(v_motiv) > 500 THEN RAISE EXCEPTION 'DCC_MOTIV_LIPSA: motivul anularii e obligatoriu (max 500)' USING ERRCODE = '22023'; END IF;
  v_hash := public.fn_dcc_hash_parametri('anuleaza', jsonb_build_object('document', p_document, 'revizie', p_revizie, 'motiv', v_motiv));
  v_r := public.fn_dcc_intentie_reia(p_cheie, 'anuleaza', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  IF p_document IS NOT NULL THEN v_doc := p_document;
  ELSE SELECT r.document_id INTO v_doc FROM public.dcc_revizii r WHERE r.id = p_revizie; END IF;
  SELECT x.proiect_dcc_id INTO v_proiect FROM public.dcc_documente x WHERE x.id = v_doc;
  IF v_proiect IS NULL OR NOT public.fn_dcc_drept(v_proiect, 'admin') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  v_r := public.fn_dcc_intentie_revendica(p_cheie, 'anuleaza', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  PERFORM 1 FROM public.dcc_proiecte x WHERE x.id = v_proiect FOR SHARE;
  SELECT * INTO d FROM public.dcc_documente x WHERE x.id = v_doc FOR UPDATE;
  IF NOT public.fn_dcc_drept(v_proiect, 'admin') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  IF d.stare = 'anulat' THEN RAISE EXCEPTION 'DCC_DOCUMENT_ANULAT: documentul e deja anulat' USING ERRCODE = 'P0001'; END IF;
  IF p_document IS NOT NULL THEN
    UPDATE public.dcc_documente x SET stare = 'anulat', anulat_de = v_uid, anulat_la = now(), motiv_anulare = v_motiv WHERE x.id = d.id;
    WITH a AS (
      UPDATE public.dcc_revizii r SET stare_transport = 'anulata', anulata_de = v_uid, anulata_la = now(), anulata_prin = 'document', motiv_anulare = v_motiv
       WHERE r.document_id = d.id AND r.stare_transport IN ('rezervata', 'pregatita', 'copiata_pentru_gmail')
      RETURNING r.id)
    SELECT coalesce(jsonb_agg(a.id ORDER BY a.id), '[]'::jsonb) INTO v_anulate FROM a;
    SELECT coalesce(jsonb_agg(jsonb_build_object('revizie_id', r.id, 'stare_transport', r.stare_transport) ORDER BY r.id), '[]'::jsonb) INTO v_pastrate
      FROM public.dcc_revizii r WHERE r.document_id = d.id AND r.stare_transport NOT IN ('rezervata', 'pregatita', 'copiata_pentru_gmail', 'anulata');
    v_r := jsonb_build_object('tinta', 'document', 'document_id', d.id, 'revizie_id', NULL, 'revizii_anulate', v_anulate, 'revizii_pastrate', v_pastrate);
  ELSE
    SELECT * INTO rv FROM public.dcc_revizii r WHERE r.id = p_revizie;
    IF rv.stare_transport NOT IN ('rezervata', 'pregatita', 'copiata_pentru_gmail') THEN
      RAISE EXCEPTION 'DCC_TRANZITIE_NEPERMISA: revizia % nu se mai poate anula', rv.stare_transport USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.dcc_revizii r SET stare_transport = 'anulata', anulata_de = v_uid, anulata_la = now(), anulata_prin = 'revizie', motiv_anulare = v_motiv
     WHERE r.id = rv.id;
    v_r := jsonb_build_object('tinta', 'revizie', 'document_id', d.id, 'revizie_id', rv.id, 'revizii_anulate', jsonb_build_array(rv.id), 'revizii_pastrate', '[]'::jsonb);
  END IF;
  PERFORM public.fn_dcc_intentie_incheie(p_cheie, v_r);
  RETURN v_r || '{"reluat": false}'::jsonb;
END $f$;

-- citirea seriilor ([D1]): DOAR seriile contractului proiectului, pe emitentul proiectului; nicio coloană a altui proiect (seria nu are proiect)
CREATE FUNCTION public.fn_dcc_serii_proiect(p_proiect_dcc bigint)
  RETURNS TABLE (serie_id bigint, emitent text, tematica text, tip text, "interval" text, limita_inf integer, limita_sup integer, prag_initial integer,
                 ultimul_ocupat integer, urmatorul integer, epuizata boolean, initializata_la timestamptz, initializata_prin text, motiv_prag text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF NOT public.fn_dcc_drept(p_proiect_dcc, 'citire') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT s.id, s.emitent, s.tematica, s.tip, s.interval, s.limita_inf, s.limita_sup, s.prag_initial, s.ultimul_ocupat, s.ultimul_ocupat + 1,
           s.ultimul_ocupat >= s.limita_sup, s.initializata_la, s.initializata_prin, s.motiv_prag
      FROM public.dcc_serii s JOIN public.dcc_proiecte d ON d.contract_id = s.contract_id AND d.emitent = s.emitent
     WHERE d.id = p_proiect_dcc
     ORDER BY s.tematica NULLS FIRST, s.tip, s.interval, s.id;
END $f$;

REVOKE ALL ON FUNCTION public.fn_dcc_config_permisa_intern(), public.fn_dcc_valori_ghid_intern(bigint, text, text),
  public.fn_dcc_coduri_intern(bigint, text, text, text, text, integer, integer, integer, integer, text),
  public.fn_dcc_ghid_creeaza(jsonb, uuid), public.fn_dcc_contract_creeaza(text, text, text, text, uuid),
  public.fn_dcc_proiect_seteaza(bigint, bigint, bigint, text, text, text, text[], jsonb, text, integer, integer, uuid),
  public.fn_dcc_initializeaza_serie(bigint, text, text, text, text, integer, text, boolean, uuid),
  public.fn_dcc_aloca(bigint, text, text, text, text, text, text, integer, uuid), public.fn_dcc_aloca_manual(bigint, text, text, text, integer, text, text, integer, uuid),
  public.fn_dcc_revizie_noua(bigint, bigint, bigint, text, text, uuid), public.fn_dcc_fila_noua(bigint, integer, text, text, uuid),
  public.fn_dcc_anexa_noua(bigint, text, text, uuid), public.fn_dcc_anuleaza(bigint, bigint, text, uuid), public.fn_dcc_serii_proiect(bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_dcc_ghid_creeaza(jsonb, uuid), public.fn_dcc_contract_creeaza(text, text, text, text, uuid),
  public.fn_dcc_proiect_seteaza(bigint, bigint, bigint, text, text, text, text[], jsonb, text, integer, integer, uuid),
  public.fn_dcc_initializeaza_serie(bigint, text, text, text, text, integer, text, boolean, uuid),
  public.fn_dcc_aloca(bigint, text, text, text, text, text, text, integer, uuid), public.fn_dcc_aloca_manual(bigint, text, text, text, integer, text, text, integer, uuid),
  public.fn_dcc_revizie_noua(bigint, bigint, bigint, text, text, uuid), public.fn_dcc_fila_noua(bigint, integer, text, text, uuid),
  public.fn_dcc_anexa_noua(bigint, text, text, uuid), public.fn_dcc_anuleaza(bigint, bigint, text, uuid), public.fn_dcc_serii_proiect(bigint) TO authenticated;

-- ─── 6. importul istoric, „Copiază pentru Gmail” și „Confirm că am trimis”

-- forma listei de revizii a unui apel (copiat / confirmat), FĂRĂ citiri de date: nevidă, fără NULL, fără dubluri (refuz, nu deduplicare), cel
-- mult 50 (plafonul Transmittal); forma normalizată = sortată (aceeași mulțime în altă ordine = aceeași intenție). Internă, fără EXECUTE.
CREATE FUNCTION public.fn_dcc_lista_forma_intern(p_revizii bigint[]) RETURNS bigint[]
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
BEGIN
  IF p_revizii IS NULL OR cardinality(p_revizii) = 0 THEN RAISE EXCEPTION 'DCC_LISTA_GOALA: lista de revizii e goala' USING ERRCODE = '22023'; END IF;
  IF array_position(p_revizii, NULL) IS NOT NULL THEN RAISE EXCEPTION 'DCC_LISTA_INVALIDA: lista de revizii are elemente NULL' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_revizii) x) <> cardinality(p_revizii) THEN
    RAISE EXCEPTION 'DCC_LISTA_DUBLURI: lista de revizii are dubluri' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_revizii) > 50 THEN RAISE EXCEPTION 'DCC_LISTA_PREA_LUNGA: cel mult 50 de revizii pe un mesaj' USING ERRCODE = '22023'; END IF;
  RETURN (SELECT array_agg(x ORDER BY x) FROM unnest(p_revizii) x);
END $f$;

-- dreptul pe lista (L09): pe FIECARE id, inexistent sau fără drept de scriere = același 42501; toate pe drept, dar din proiecte DCC diferite =
-- DCC_PROIECTE_AMESTECATE. Întoarce proiectul DCC comun. Internă, fără EXECUTE.
CREATE FUNCTION public.fn_dcc_lista_drept_intern(p_lista bigint[]) RETURNS bigint
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE v_id bigint; v_p bigint; v_proiecte bigint[] := '{}';
BEGIN
  FOREACH v_id IN ARRAY p_lista LOOP
    v_p := NULL;
    SELECT d.proiect_dcc_id INTO v_p FROM public.dcc_revizii r JOIN public.dcc_documente d ON d.id = r.document_id WHERE r.id = v_id;
    IF v_p IS NULL OR NOT public.fn_dcc_drept(v_p, 'scriere') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
    IF NOT v_p = ANY (v_proiecte) THEN v_proiecte := v_proiecte || v_p; END IF;
  END LOOP;
  IF cardinality(v_proiecte) <> 1 THEN
    RAISE EXCEPTION 'DCC_PROIECTE_AMESTECATE: reviziile sunt din proiecte DCC diferite' USING ERRCODE = '22023';
  END IF;
  RETURN v_proiecte[1];
END $f$;

-- importul istoric (owner / admin pe proiect / calea serverului): rânduri brute, imuabile, idempotent pe identitatea sursei (proiect, sursa,
-- sursa_id, pozitie). Lista EXACTĂ de câmpuri admise (orice altă cheie = refuz pe tot lotul, nimic scris, L12); revizia absentă = NULL
-- (niciodată 0); dublurile din același lot = refuz (altfel ON CONFLICT le-ar înghiți tăcut); un rând existent cu alt conținut = „diferit”
-- (listat, NU suprascris). Invariantul inserate + identice + diferite = total verificat înaintea rezultatului. Lock-urile: pasul 3.
CREATE FUNCTION public.fn_dcc_istoric_importa(p_proiect_dcc bigint, p_lot text, p_randuri jsonb, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_srv boolean := public.fn_dcc_server(); v_lot text := btrim(p_lot); v_hash text; v_r jsonb; e jsonb; v_randuri jsonb;
  v_n integer; p public.dcc_proiecte; v_id bigint; v_hx text; v_inserate integer := 0; v_identice integer := 0; v_diferite jsonb := '[]'::jsonb;
  v_chei text[] := ARRAY['sursa', 'sursa_id', 'pozitie', 'valori_originale', 'cod_scris', 'emitent', 'tematica', 'tip', 'limba', 'secventa', 'fila', 'anexa',
                         'revizie', 'probleme'];
BEGIN
  IF v_uid IS NULL AND NOT v_srv THEN RAISE EXCEPTION 'DCC_NEAUTENTIFICAT: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_cheie IS NULL OR p_proiect_dcc IS NULL THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: proiectul si cheia sunt obligatorii' USING ERRCODE = '22023'; END IF;
  IF v_lot IS NULL OR v_lot !~ '^[A-Za-z0-9_.-]{1,60}$' THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: lotul are forma [A-Za-z0-9_.-]{1,60}' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_randuri) IS DISTINCT FROM 'array' OR jsonb_array_length(p_randuri) = 0 THEN
    RAISE EXCEPTION 'DCC_LISTA_GOALA: lotul nu are randuri' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_randuri) > 5000 THEN RAISE EXCEPTION 'DCC_LISTA_PREA_LUNGA: cel mult 5000 de randuri pe lot' USING ERRCODE = '22023'; END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_randuri) x LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DCC_LISTA_INVALIDA: rand invalid' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k <> ALL (v_chei)) THEN
      RAISE EXCEPTION 'DCC_CHEI_NECUNOSCUTE: un rand are chei nepermise (cheile de legare, provenienta si amprenta le pune serverul)' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(e -> 'sursa') IS DISTINCT FROM 'string' OR (e ->> 'sursa') NOT IN ('excel_registru', 'mail_trimis', 'mail_primit')
       OR jsonb_typeof(e -> 'sursa_id') IS DISTINCT FROM 'string' OR btrim(e ->> 'sursa_id') !~ '[^[:space:]]' OR length(btrim(e ->> 'sursa_id')) > 300
       OR jsonb_typeof(e -> 'valori_originale') IS DISTINCT FROM 'object'
       OR (e ? 'pozitie' AND CASE WHEN jsonb_typeof(e -> 'pozitie') IS DISTINCT FROM 'number' THEN true
                                  ELSE (e ->> 'pozitie')::numeric <> trunc((e ->> 'pozitie')::numeric) OR (e ->> 'pozitie')::numeric < 1
                                       OR (e ->> 'pozitie')::numeric > 2147483647 END)
       OR coalesce(jsonb_typeof(e -> 'cod_scris'), 'null') NOT IN ('string', 'null') OR length(e ->> 'cod_scris') > 200
       OR coalesce(jsonb_typeof(e -> 'emitent'), 'null') NOT IN ('string', 'null') OR (e ->> 'emitent') !~ '^[A-Z]{3}$'
       OR coalesce(jsonb_typeof(e -> 'tematica'), 'null') NOT IN ('string', 'null') OR (e ->> 'tematica') !~ '^[A-Z0-9]{2,4}$'
       OR coalesce(jsonb_typeof(e -> 'tip'), 'null') NOT IN ('string', 'null') OR (e ->> 'tip') !~ '^[A-Z]{2,4}$'
       OR coalesce(jsonb_typeof(e -> 'limba'), 'null') NOT IN ('string', 'null') OR (e ->> 'limba') !~ '^(RO|EN|BI)$' THEN
      RAISE EXCEPTION 'DCC_LISTA_INVALIDA: rand cu campuri lipsa sau de alt tip' USING ERRCODE = '22023';
    END IF;
    IF (SELECT bool_or(CASE WHEN jsonb_typeof(e -> k) = 'null' THEN false
                            WHEN jsonb_typeof(e -> k) <> 'number' THEN true
                            ELSE (e ->> k)::numeric <> trunc((e ->> k)::numeric)
                                 OR (e ->> k)::numeric < CASE WHEN k = 'revizie' THEN 0 ELSE 1 END
                                 OR (e ->> k)::numeric > CASE k WHEN 'secventa' THEN 99999 WHEN 'revizie' THEN 2147483647 ELSE 999 END END)
          FROM unnest(ARRAY['secventa', 'fila', 'anexa', 'revizie']) k WHERE e ? k) THEN
      RAISE EXCEPTION 'DCC_LISTA_INVALIDA: secventa / fila / anexa / revizie trebuie sa fie intregi in limite sau null' USING ERRCODE = '22023';
    END IF;
    IF e ? 'probleme' AND (jsonb_typeof(e -> 'probleme') IS DISTINCT FROM 'array'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(e -> 'probleme') q
                     WHERE jsonb_typeof(q) IS DISTINCT FROM 'string'
                        OR (q #>> '{}') NOT IN ('dublura', 'forma_nestandard', 'revizie_necunoscuta', 'tematica_gresita', 'cod_nerecunoscut', 'conflict'))
         OR (SELECT count(*) <> count(DISTINCT q) FROM jsonb_array_elements(e -> 'probleme') q)) THEN
      RAISE EXCEPTION 'DCC_LISTA_INVALIDA: problemele sunt din lista, fara dubluri' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- forma canonică a fiecărui rând (toate câmpurile, cu valorile implicite) și lotul sortat după identitate
  SELECT jsonb_agg(c ORDER BY c ->> 'sursa', c ->> 'sursa_id', (c ->> 'pozitie')::integer), count(*) - count(DISTINCT (c ->> 'sursa', c ->> 'sursa_id', c ->> 'pozitie'))
    INTO v_randuri, v_n
    FROM (SELECT jsonb_build_object(
                   'sursa', x ->> 'sursa', 'sursa_id', btrim(x ->> 'sursa_id'), 'pozitie', coalesce((x ->> 'pozitie')::integer, 1),
                   'valori_originale', x -> 'valori_originale', 'cod_scris', x ->> 'cod_scris', 'emitent', x ->> 'emitent', 'tematica', x ->> 'tematica',
                   'tip', x ->> 'tip', 'secventa', (x ->> 'secventa')::integer, 'fila', (x ->> 'fila')::integer, 'anexa', (x ->> 'anexa')::integer,
                   'revizie', (x ->> 'revizie')::integer, 'limba', x ->> 'limba',
                   'probleme', coalesce((SELECT jsonb_agg(q ORDER BY q) FROM jsonb_array_elements_text(x -> 'probleme') q), '[]'::jsonb)) AS c
            FROM jsonb_array_elements(p_randuri) x) z;
  IF v_n > 0 THEN RAISE EXCEPTION 'DCC_LOT_DUBLURI: doua randuri cu aceeasi identitate (sursa, sursa_id, pozitie) in lot' USING ERRCODE = '22023'; END IF;
  v_hash := public.fn_dcc_hash_parametri('istoric_importa', jsonb_build_object('proiect', p_proiect_dcc, 'lot', v_lot, 'randuri', v_randuri));
  v_r := public.fn_dcc_intentie_reia(p_cheie, 'istoric_importa', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  IF NOT v_srv AND NOT public.fn_dcc_drept(p_proiect_dcc, 'admin') THEN RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501'; END IF;
  v_r := public.fn_dcc_intentie_revendica(p_cheie, 'istoric_importa', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  SELECT * INTO p FROM public.dcc_proiecte x WHERE x.id = p_proiect_dcc FOR SHARE;
  IF NOT FOUND OR (NOT v_srv AND NOT public.fn_dcc_drept(p_proiect_dcc, 'admin')) THEN
    RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(v_randuri) x LOOP
    v_id := NULL;
    INSERT INTO public.dcc_istoric_aparitii (contract_id, proiect_dcc_id, sursa, sursa_id, pozitie, lot_import, valori_originale, cod_scris, emitent, tematica, tip,
                                             secventa, fila, anexa, revizie, limba, probleme, continut_hash, importat_prin)
    VALUES (p.contract_id, p.id, e ->> 'sursa', e ->> 'sursa_id', (e ->> 'pozitie')::integer, v_lot, e -> 'valori_originale', e ->> 'cod_scris', e ->> 'emitent',
            e ->> 'tematica', e ->> 'tip', (e ->> 'secventa')::integer, (e ->> 'fila')::integer, (e ->> 'anexa')::integer, (e ->> 'revizie')::integer, e ->> 'limba',
            ARRAY(SELECT jsonb_array_elements_text(e -> 'probleme')), repeat('0', 64), 'server')
    ON CONFLICT ON CONSTRAINT dcc_istoric_sursa_uq DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      v_inserate := v_inserate + 1;
    ELSE
      SELECT h.continut_hash INTO v_hx FROM public.dcc_istoric_aparitii h
       WHERE h.proiect_dcc_id = p.id AND h.sursa = e ->> 'sursa' AND h.sursa_id = e ->> 'sursa_id' AND h.pozitie = (e ->> 'pozitie')::integer;
      IF v_hx = public.fn_dcc_istoric_hash(e ->> 'sursa', e ->> 'sursa_id', (e ->> 'pozitie')::integer, e -> 'valori_originale', e ->> 'cod_scris', e ->> 'emitent',
                                           e ->> 'tematica', e ->> 'tip', (e ->> 'secventa')::integer, (e ->> 'fila')::integer, (e ->> 'anexa')::integer,
                                           (e ->> 'revizie')::integer, e ->> 'limba', ARRAY(SELECT jsonb_array_elements_text(e -> 'probleme'))) THEN
        v_identice := v_identice + 1;
      ELSE
        v_diferite := v_diferite || jsonb_build_object('sursa', e ->> 'sursa', 'sursa_id', e ->> 'sursa_id', 'pozitie', (e ->> 'pozitie')::integer);
      END IF;
    END IF;
  END LOOP;
  -- invariantul de contabilizare (L12): nimic nu dispare tăcut
  IF v_inserate + v_identice + jsonb_array_length(v_diferite) <> jsonb_array_length(v_randuri) THEN
    RAISE EXCEPTION 'DCC_IMPORT_NECONTABILIZAT: % + % + % <> %', v_inserate, v_identice, jsonb_array_length(v_diferite), jsonb_array_length(v_randuri) USING ERRCODE = 'P0001';
  END IF;
  v_r := jsonb_build_object('inserate', v_inserate, 'identice', v_identice, 'diferite', v_diferite, 'total', jsonb_array_length(v_randuri));
  PERFORM public.fn_dcc_intentie_incheie(p_cheie, v_r);
  RETURN v_r || '{"reluat": false}'::jsonb;
END $f$;

-- „Copiază pentru Gmail” (copierea NU dovedește expedierea): snapshotul exact copiat (fără BCC) + reviziile -> copiata_pentru_gmail. To = exact
-- adresa DCC a proiectului; fiecare CC din lista albă (cc_lista + valorile din cc_implicit). Lock-urile: 3 (proiectul FOR SHARE) -> 6 (documentele
-- reviziilor FOR UPDATE, ORDER BY id) -> 8 (snapshotul).
CREATE FUNCTION public.fn_dcc_marcheaza_copiat(p_revizii bigint[], p_snapshot jsonb, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_lista bigint[]; v_proiect bigint; v_to text[]; v_cc text[]; v_subiect text; v_corp text; v_linkuri text[]; v_manifest jsonb;
  v_n integer; v_hash text; v_r jsonb; p public.dcc_proiecte; d record; rv record; v_sid bigint; v_shash text; v_rev jsonb := '[]'::jsonb; v_alb text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DCC_NEAUTENTIFICAT: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_cheie IS NULL THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: cheia de intentie lipseste' USING ERRCODE = '22023'; END IF;
  v_lista := public.fn_dcc_lista_forma_intern(p_revizii);
  IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_snapshot) k) IS DISTINCT FROM ARRAY['cc', 'corp', 'linkuri', 'manifest', 'subiect', 'to'] THEN
    RAISE EXCEPTION 'DCC_CHEI_NECUNOSCUTE: snapshotul are exact cheile to, cc, subiect, corp, linkuri, manifest (fara bcc)' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_snapshot -> 'to') IS DISTINCT FROM 'array' OR jsonb_typeof(p_snapshot -> 'cc') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_snapshot -> 'linkuri') IS DISTINCT FROM 'array' OR jsonb_typeof(p_snapshot -> 'manifest') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_snapshot -> 'subiect') IS DISTINCT FROM 'string' OR jsonb_typeof(p_snapshot -> 'corp') IS DISTINCT FROM 'string'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot -> 'to') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot -> 'cc') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot -> 'linkuri') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot -> 'manifest') m
                 WHERE jsonb_typeof(m) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m) k) IS DISTINCT FROM ARRAY['marime', 'nume', 'sha256']
                    OR jsonb_typeof(m -> 'nume') IS DISTINCT FROM 'string' OR btrim(m ->> 'nume') = ''
                    OR CASE WHEN jsonb_typeof(m -> 'marime') IS DISTINCT FROM 'number' THEN true
                            ELSE (m ->> 'marime')::numeric <> trunc((m ->> 'marime')::numeric) OR (m ->> 'marime')::numeric < 0
                                 OR (m ->> 'marime')::numeric > 9223372036854775807 END
                    OR jsonb_typeof(m -> 'sha256') IS DISTINCT FROM 'string' OR (m ->> 'sha256') !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: snapshot cu campuri de alt tip (manifest = {nume, marime, sha256})' USING ERRCODE = '22023';
  END IF;
  -- normalizarea: to / cc cu litere mici, tăiate (cc sortat, dublurile refuzate), linkurile în ordinea dată, manifestul sortat după nume (nume unic)
  SELECT array_agg(lower(btrim(x)) ORDER BY o) INTO v_to FROM jsonb_array_elements_text(p_snapshot -> 'to') WITH ORDINALITY a(x, o);
  SELECT array_agg(c ORDER BY c), count(*) - count(DISTINCT c) INTO v_cc, v_n FROM (SELECT lower(btrim(x)) AS c FROM jsonb_array_elements_text(p_snapshot -> 'cc') x) z;
  IF v_n > 0 THEN RAISE EXCEPTION 'DCC_LISTA_DUBLURI: adrese CC dublate' USING ERRCODE = '22023'; END IF;
  v_cc := coalesce(v_cc, '{}'::text[]);
  v_subiect := nullif(btrim(p_snapshot ->> 'subiect'), '');
  IF v_subiect IS NULL THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: subiectul e obligatoriu' USING ERRCODE = '22023'; END IF;
  v_corp := p_snapshot ->> 'corp';
  SELECT coalesce(array_agg(x ORDER BY o), '{}'::text[]) INTO v_linkuri FROM jsonb_array_elements_text(p_snapshot -> 'linkuri') WITH ORDINALITY a(x, o);
  SELECT coalesce(jsonb_agg(jsonb_build_object('nume', btrim(m ->> 'nume'), 'marime', (m ->> 'marime')::bigint, 'sha256', m ->> 'sha256') ORDER BY btrim(m ->> 'nume')), '[]'::jsonb),
         count(*) - count(DISTINCT btrim(m ->> 'nume'))
    INTO v_manifest, v_n FROM jsonb_array_elements(p_snapshot -> 'manifest') m;
  IF v_n > 0 THEN RAISE EXCEPTION 'DCC_LISTA_DUBLURI: fisiere cu acelasi nume in manifest' USING ERRCODE = '22023'; END IF;
  v_hash := public.fn_dcc_hash_parametri('marcheaza_copiat', jsonb_build_object('revizii', to_jsonb(v_lista), 'to', to_jsonb(v_to), 'cc', to_jsonb(v_cc), 'subiect', v_subiect,
    'corp', v_corp, 'linkuri', to_jsonb(v_linkuri), 'manifest', v_manifest));
  v_r := public.fn_dcc_intentie_reia(p_cheie, 'marcheaza_copiat', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  v_proiect := public.fn_dcc_lista_drept_intern(v_lista);
  v_r := public.fn_dcc_intentie_revendica(p_cheie, 'marcheaza_copiat', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  -- lock-urile: 3 -> 6 (documentele, în ordinea id-urilor)
  SELECT * INTO p FROM public.dcc_proiecte x WHERE x.id = v_proiect FOR SHARE;
  FOR d IN SELECT x.id, x.stare FROM public.dcc_documente x WHERE x.id IN (SELECT r.document_id FROM public.dcc_revizii r WHERE r.id = ANY (v_lista))
            ORDER BY x.id FOR UPDATE LOOP
    -- reverificarea după lock: starea fiecărui document
    IF d.stare = 'anulat' THEN RAISE EXCEPTION 'DCC_DOCUMENT_ANULAT: o revizie e a unui document anulat' USING ERRCODE = 'P0001'; END IF;
  END LOOP;
  -- reverificarea dreptului după lock, pe fiecare revizie
  IF public.fn_dcc_lista_drept_intern(v_lista) IS DISTINCT FROM v_proiect THEN
    RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501';
  END IF;
  FOR rv IN SELECT r.id, r.stare_transport FROM public.dcc_revizii r WHERE r.id = ANY (v_lista) ORDER BY r.id LOOP
    IF public.fn_dcc_tranzitie_permisa(rv.stare_transport, 'copiata_pentru_gmail') IS NOT TRUE THEN
      RAISE EXCEPTION 'DCC_TRANZITIE_NEPERMISA: % -> copiata_pentru_gmail', rv.stare_transport USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF p.adresa_dcc IS NULL OR v_to IS DISTINCT FROM ARRAY[p.adresa_dcc] THEN
    RAISE EXCEPTION 'DCC_TO_DIFERIT: destinatarul e exact adresa DCC a proiectului' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(DISTINCT lower(btrim(x))), '{}'::text[]) INTO v_alb
    FROM (SELECT unnest(p.cc_lista) AS x
          UNION ALL SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(e.value) = 'array' THEN e.value ELSE '[]'::jsonb END) FROM jsonb_each(p.cc_implicit) e) z;
  IF NOT (v_cc <@ v_alb) THEN RAISE EXCEPTION 'DCC_CC_NEPERMIS: o adresa CC nu e in lista alba a proiectului' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.dcc_snapshoturi (contract_id, proiect_dcc_id, tip, from_adresa, to_lista, cc_lista, subiect, corp, linkuri, manifest, hash, aprobat_de)
  VALUES (p.contract_id, p.id, 'copiat_gmail', NULL, v_to, v_cc, v_subiect, v_corp, v_linkuri, v_manifest, repeat('0', 64), v_uid)
  RETURNING id, hash INTO v_sid, v_shash;
  FOR rv IN SELECT r.id, r.stare_transport FROM public.dcc_revizii r WHERE r.id = ANY (v_lista) ORDER BY r.id LOOP
    INSERT INTO public.dcc_snapshot_revizii (snapshot_id, revizie_id) VALUES (v_sid, rv.id);
    UPDATE public.dcc_revizii r SET stare_transport = 'copiata_pentru_gmail' WHERE r.id = rv.id;
    v_rev := v_rev || jsonb_build_object('revizie_id', rv.id, 'stare_anterioara', rv.stare_transport, 'stare', 'copiata_pentru_gmail');
  END LOOP;
  v_r := jsonb_build_object('snapshot_id', v_sid, 'hash', v_shash, 'revizii', v_rev);
  PERFORM public.fn_dcc_intentie_incheie(p_cheie, v_r);
  RETURN v_r || '{"reluat": false}'::jsonb;
END $f$;

-- „Confirm că am trimis” (fără căsuță conectată): UN mesaj manual (toate ID-urile NULL, dovezi incomplete — nicio valoare inventată) + câte o
-- legătură manuală confirmată + reviziile -> trimisa_manual_neverificata (devine „confirmată” doar cu o dovadă, în B). Lock-urile: 3 -> 6 -> 8.
CREATE FUNCTION public.fn_dcc_confirma_trimis_manual(p_revizii bigint[], p_trimis_la timestamptz, p_casuta_declarata text, p_subiect text, p_snapshot bigint,
                                                     p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_casuta text := nullif(btrim(p_casuta_declarata), ''); v_subiect text := nullif(btrim(p_subiect), ''); v_lista bigint[];
  v_proiect bigint; v_hash text; v_r jsonb; p public.dcc_proiecte; d record; rv record; v_snap public.dcc_snapshoturi; v_mid bigint; v_lid bigint;
  v_leg jsonb := '[]'::jsonb; v_rev jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'DCC_NEAUTENTIFICAT: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_cheie IS NULL OR p_trimis_la IS NULL THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: data trimiterii si cheia sunt obligatorii' USING ERRCODE = '22023'; END IF;
  IF v_casuta IS NULL OR length(v_casuta) > 300 THEN
    RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: casuta din care s-a trimis se declara (text, max 300)' USING ERRCODE = '22023';
  END IF;
  IF p_trimis_la > now() + interval '5 minutes' THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: data trimiterii e in viitor' USING ERRCODE = '22023'; END IF;
  v_lista := public.fn_dcc_lista_forma_intern(p_revizii);
  v_hash := public.fn_dcc_hash_parametri('confirma_trimis_manual', jsonb_build_object('revizii', to_jsonb(v_lista),
    'trimis_la', to_char(p_trimis_la AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'casuta', v_casuta, 'subiect', v_subiect, 'snapshot', p_snapshot));
  v_r := public.fn_dcc_intentie_reia(p_cheie, 'confirma_trimis_manual', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  v_proiect := public.fn_dcc_lista_drept_intern(v_lista);
  IF p_snapshot IS NOT NULL THEN
    SELECT * INTO v_snap FROM public.dcc_snapshoturi s WHERE s.id = p_snapshot;
    IF NOT FOUND OR v_snap.proiect_dcc_id IS DISTINCT FROM v_proiect OR NOT public.fn_dcc_drept(v_snap.proiect_dcc_id, 'scriere') THEN
      RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501';
    END IF;
    IF (SELECT array_agg(sr.revizie_id ORDER BY sr.revizie_id) FROM public.dcc_snapshot_revizii sr WHERE sr.snapshot_id = p_snapshot) IS DISTINCT FROM v_lista THEN
      RAISE EXCEPTION 'DCC_SNAPSHOT_ALTE_REVIZII: snapshotul are alte revizii decat confirmarea' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_r := public.fn_dcc_intentie_revendica(p_cheie, 'confirma_trimis_manual', v_hash);
  IF v_r IS NOT NULL THEN RETURN v_r; END IF;
  SELECT * INTO p FROM public.dcc_proiecte x WHERE x.id = v_proiect FOR SHARE;
  FOR d IN SELECT x.id, x.stare FROM public.dcc_documente x WHERE x.id IN (SELECT r.document_id FROM public.dcc_revizii r WHERE r.id = ANY (v_lista))
            ORDER BY x.id FOR UPDATE LOOP
    IF d.stare = 'anulat' THEN RAISE EXCEPTION 'DCC_DOCUMENT_ANULAT: o revizie e a unui document anulat' USING ERRCODE = 'P0001'; END IF;
  END LOOP;
  -- reverificarea dreptului după lock, pe fiecare revizie
  IF public.fn_dcc_lista_drept_intern(v_lista) IS DISTINCT FROM v_proiect THEN
    RAISE EXCEPTION 'DCC_FARA_DREPT: operatia nu e permisa' USING ERRCODE = '42501';
  END IF;
  FOR rv IN SELECT r.id, r.stare_transport, r.creat_la FROM public.dcc_revizii r WHERE r.id = ANY (v_lista) ORDER BY r.id LOOP
    IF public.fn_dcc_tranzitie_permisa(rv.stare_transport, 'trimisa_manual_neverificata') IS NOT TRUE THEN
      RAISE EXCEPTION 'DCC_TRANZITIE_NEPERMISA: % -> trimisa_manual_neverificata', rv.stare_transport USING ERRCODE = 'P0001';
    END IF;
    IF p_trimis_la < rv.creat_la THEN RAISE EXCEPTION 'DCC_PARAMETRU_INVALID: data trimiterii e inaintea alocarii reviziei' USING ERRCODE = '22023'; END IF;
  END LOOP;
  INSERT INTO public.dcc_mesaje (contract_id, proiect_dcc_id, directie, sursa, casuta_id, casuta_declarata, rfc_message_id, gmail_message_id, gmail_thread_id,
                                 subiect_original, data_mesaj, snapshot_id, dovezi_complete, creat_de)
  VALUES (p.contract_id, p.id, 'trimis', 'manual_declarat', NULL, v_casuta, NULL, NULL, NULL, v_subiect, p_trimis_la, p_snapshot, false, v_uid)
  RETURNING id INTO v_mid;
  FOR rv IN SELECT r.id, r.stare_transport FROM public.dcc_revizii r WHERE r.id = ANY (v_lista) ORDER BY r.id LOOP
    INSERT INTO public.dcc_legaturi (mesaj_id, revizie_id, metoda, dovada, stare, autor, confirmat_de, confirmat_la)
    VALUES (v_mid, rv.id, 'manual', jsonb_build_object('declarat_de_om', true), 'confirmata', v_uid, v_uid, now()) RETURNING id INTO v_lid;
    UPDATE public.dcc_revizii r SET stare_transport = 'trimisa_manual_neverificata' WHERE r.id = rv.id;
    v_leg := v_leg || to_jsonb(v_lid);
    v_rev := v_rev || jsonb_build_object('revizie_id', rv.id, 'stare_anterioara', rv.stare_transport, 'stare', 'trimisa_manual_neverificata');
  END LOOP;
  v_r := jsonb_build_object('mesaj_id', v_mid, 'legaturi', v_leg, 'revizii', v_rev);
  PERFORM public.fn_dcc_intentie_incheie(p_cheie, v_r);
  RETURN v_r || '{"reluat": false}'::jsonb;
END $f$;

REVOKE ALL ON FUNCTION public.fn_dcc_lista_forma_intern(bigint[]), public.fn_dcc_lista_drept_intern(bigint[]), public.fn_dcc_istoric_importa(bigint, text, jsonb, uuid),
  public.fn_dcc_marcheaza_copiat(bigint[], jsonb, uuid), public.fn_dcc_confirma_trimis_manual(bigint[], timestamptz, text, text, bigint, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_dcc_istoric_importa(bigint, text, jsonb, uuid), public.fn_dcc_marcheaza_copiat(bigint[], jsonb, uuid),
  public.fn_dcc_confirma_trimis_manual(bigint[], timestamptz, text, text, bigint, uuid) TO authenticated;

-- ─── 7. postcondițiile: fiecare verificare cu codul ei stabil (L15_POST_CONSTRANGERI, L15_POST_POLITICA, L15_POST_GRANT, L15_POST_FUNCTIE,
-- L15_POST_TRIGGER, L15_POST_NUMAR, L15_POST_DATE, L15_POST_AMPRENTA, L15_LOCK_LIPSA, L15_LOCK_NEDECLARAT). Postcondiția de lock-uri e ULTIMA, după
-- toate citirile de aici. NU citește app_modules / user_module_access (o citire ar fi ea însăși un lock nedeclarat).
DO $post$
DECLARE v_rau text; v_n integer; v_rel oid[]; v_cls text; v_baza oid[]; v_dep oid[]; v_set text;
  v_tab text[] := ARRAY['dcc_casute', 'dcc_ghiduri', 'dcc_ghid_valori', 'dcc_ghid_intervale', 'dcc_contracte', 'dcc_proiecte', 'dcc_intentii', 'dcc_serii',
    'dcc_documente', 'dcc_file', 'dcc_anexe', 'dcc_revizii', 'dcc_istoric_aparitii', 'dcc_snapshoturi', 'dcc_snapshot_revizii', 'dcc_mesaje', 'dcc_legaturi'];
  v_cit text[] := ARRAY['dcc_ghiduri', 'dcc_ghid_valori', 'dcc_ghid_intervale', 'dcc_contracte', 'dcc_proiecte', 'dcc_documente', 'dcc_file', 'dcc_anexe',
    'dcc_revizii', 'dcc_istoric_aparitii', 'dcc_snapshoturi', 'dcc_snapshot_revizii', 'dcc_mesaje', 'dcc_legaturi', 'v_dcc_registru'];
  v_b_m1 oid[]; v_b_m2 oid[]; v_b_r1 oid[]; v_b_r2 oid[]; v_b_c oid[]; v_b_e oid[]; v_m1 oid[]; v_m2 oid[]; v_r1 oid[]; v_r2 oid[]; v_c oid[]; v_e oid[];
  -- CLASA-E-START (precondiția P-E: relațiile non-catalog atinse de declanșatoarele de evenimente ACTIVE ale platformei, „schemă.relație:Mod”;
  -- goală până la citirea P-E pe clonă și pe producție — amendament revizuit dacă lista nu e goală)
  v_e_moduri text[] := ARRAY[]::text[];
  -- CLASA-E-END
BEGIN
  SELECT array_agg(('public.' || t)::regclass::oid ORDER BY t) INTO v_rel FROM unnest(v_tab) t;
  -- (a) constrângerile NUMITE: CHECK și UNIQUE = EXACT inventarul (planul, A3), validate; cheile străine pe tabel = numărul declarat
  -- INVENTAR-START
  WITH ast(t, n, cls) AS (VALUES
    ('dcc_casute', 'dcc_casute_adresa_ck', 'N1'), ('dcc_casute', 'dcc_casute_tip_ck', 'N1'), ('dcc_casute', 'dcc_casute_stare_ck', 'N1'),
    ('dcc_casute', 'dcc_casute_proprietar_ck', 'N3'), ('dcc_ghiduri', 'dcc_ghiduri_cod_ck', 'N1'), ('dcc_ghiduri', 'dcc_ghiduri_versiune_ck', 'N1'),
    ('dcc_ghiduri', 'dcc_ghiduri_sursa_ck', 'N1'), ('dcc_ghiduri', 'dcc_ghiduri_format_cod_ck', 'N4'),
    ('dcc_ghiduri', 'dcc_ghiduri_format_fisier_ck', 'N4'), ('dcc_ghiduri', 'dcc_ghiduri_limba_ck', 'N1'),
    ('dcc_ghid_valori', 'dcc_ghid_valori_categorie_ck', 'N1'), ('dcc_ghid_valori', 'dcc_ghid_valori_forma_ck', 'N1'),
    ('dcc_ghid_valori', 'dcc_ghid_valori_fara_tematica_ck', 'N1'), ('dcc_ghid_intervale', 'dcc_ghid_intervale_interval_ck', 'N4'),
    ('dcc_ghid_intervale', 'dcc_ghid_intervale_limite_ck', 'N1'), ('dcc_contracte', 'dcc_contracte_beneficiar_ck', 'N1'),
    ('dcc_contracte', 'dcc_contracte_cod_ck', 'N1'), ('dcc_contracte', 'dcc_contracte_mod_ck', 'N1'),
    ('dcc_contracte', 'dcc_contracte_creat_prin_ck', 'N1'), ('dcc_contracte', 'dcc_contracte_creat_ck', 'N3'),
    ('dcc_proiecte', 'dcc_proiecte_emitent_ck', 'N1'), ('dcc_proiecte', 'dcc_proiecte_limba_ck', 'N2'),
    ('dcc_proiecte', 'dcc_proiecte_adresa_ck', 'N2'), ('dcc_proiecte', 'dcc_proiecte_cc_implicit_ck', 'N1'),
    ('dcc_proiecte', 'dcc_proiecte_plafon_ck', 'N1'), ('dcc_proiecte', 'dcc_proiecte_casuta_ck', 'N2'),
    ('dcc_proiecte', 'dcc_proiecte_trimitere_ck', 'N1'), ('dcc_proiecte', 'dcc_proiecte_versiune_ck', 'N1'),
    ('dcc_intentii', 'dcc_intentii_operatie_ck', 'N1'), ('dcc_intentii', 'dcc_intentii_hash_ck', 'N1'),
    ('dcc_intentii', 'dcc_intentii_actor_ck', 'N1'), ('dcc_intentii', 'dcc_intentii_autor_ck', 'N3'), ('dcc_serii', 'dcc_serii_interval_ck', 'N4'),
    ('dcc_serii', 'dcc_serii_motiv_ck', 'N1'), ('dcc_serii', 'dcc_serii_initializata_prin_ck', 'N1'),
    ('dcc_serii', 'dcc_serii_initializata_ck', 'N3'), ('dcc_serii', 'dcc_serii_limite_ck', 'N1'), ('dcc_serii', 'dcc_serii_prag_ck', 'N1'),
    ('dcc_serii', 'dcc_serii_ultimul_ck', 'N1'), ('dcc_documente', 'dcc_documente_secventa_ck', 'N1'),
    ('dcc_documente', 'dcc_documente_interval_ck', 'N4'), ('dcc_documente', 'dcc_documente_mod_ck', 'N1'),
    ('dcc_documente', 'dcc_documente_titlu_ck', 'N1'), ('dcc_documente', 'dcc_documente_stare_val_ck', 'N1'),
    ('dcc_documente', 'dcc_documente_automat_ck', 'N3'), ('dcc_documente', 'dcc_documente_stare_ck', 'N3'),
    ('dcc_documente', 'dcc_documente_anulare_ck', 'N3'), ('dcc_documente', 'dcc_documente_neanulat_ck', 'N3'),
    ('dcc_file', 'dcc_file_fila_ck', 'N1'), ('dcc_anexe', 'dcc_anexe_numar_ck', 'N1'), ('dcc_anexe', 'dcc_anexe_titlu_ck', 'N1'),
    ('dcc_revizii', 'dcc_revizii_revizie_ck', 'N1'), ('dcc_revizii', 'dcc_revizii_limba_ck', 'N2'),
    ('dcc_revizii', 'dcc_revizii_stare_val_ck', 'N1'), ('dcc_revizii', 'dcc_revizii_anulata_prin_val_ck', 'N2'),
    ('dcc_revizii', 'dcc_revizii_verdict_val_ck', 'N2'), ('dcc_revizii', 'dcc_revizii_tinta_ck', 'N1'),
    ('dcc_revizii', 'dcc_revizii_stare_ck', 'N3'), ('dcc_revizii', 'dcc_revizii_anulare_ck', 'N3'),
    ('dcc_revizii', 'dcc_revizii_neanulata_ck', 'N3'), ('dcc_revizii', 'dcc_revizii_verdict_ck', 'N3'),
    ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_sursa_ck', 'N1'), ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_sursa_id_ck', 'N1'),
    ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_pozitie_ck', 'N1'), ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_lot_ck', 'N1'),
    ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_valori_ck', 'N1'), ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_cod_scris_ck', 'N2'),
    ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_secventa_ck', 'N2'), ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_fila_ck', 'N2'),
    ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_anexa_ck', 'N2'), ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_revizie_ck', 'N2'),
    ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_limba_ck', 'N2'), ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_probleme_ck', 'N5'),
    ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_hash_ck', 'N1'), ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_importat_prin_ck', 'N1'),
    ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_importat_ck', 'N3'), ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_revizie_problema_ck', 'N6'),
    ('dcc_snapshoturi', 'dcc_snapshoturi_tip_ck', 'N1'), ('dcc_snapshoturi', 'dcc_snapshoturi_subiect_ck', 'N1'),
    ('dcc_snapshoturi', 'dcc_snapshoturi_manifest_ck', 'N1'), ('dcc_snapshoturi', 'dcc_snapshoturi_hash_ck', 'N1'),
    ('dcc_mesaje', 'dcc_mesaje_directie_ck', 'N1'), ('dcc_mesaje', 'dcc_mesaje_sursa_ck', 'N1'), ('dcc_mesaje', 'dcc_mesaje_thread_ck', 'N3'),
    ('dcc_mesaje', 'dcc_mesaje_manual_ck', 'N3'), ('dcc_legaturi', 'dcc_legaturi_metoda_ck', 'N1'), ('dcc_legaturi', 'dcc_legaturi_dovada_ck', 'N1'),
    ('dcc_legaturi', 'dcc_legaturi_stare_ck', 'N1'), ('dcc_legaturi', 'dcc_legaturi_verdict_ck', 'N2'),
    ('dcc_legaturi', 'dcc_legaturi_confirmare_ck', 'N3')
  ), asu(t, n) AS (VALUES
    ('dcc_casute', 'dcc_casute_adresa_uq'), ('dcc_ghiduri', 'dcc_ghiduri_cod_versiune_uq'), ('dcc_ghid_valori', 'dcc_ghid_valori_uq'),
    ('dcc_ghid_intervale', 'dcc_ghid_intervale_uq'), ('dcc_contracte', 'dcc_contracte_uq'), ('dcc_proiecte', 'dcc_proiecte_executie_contract_uq'),
    ('dcc_proiecte', 'dcc_proiecte_id_contract_uq'), ('dcc_serii', 'dcc_serii_cheie_uq'), ('dcc_documente', 'dcc_documente_cod_uq'),
    ('dcc_documente', 'dcc_documente_id_contract_uq'), ('dcc_documente', 'dcc_documente_id_proiect_uq'), ('dcc_file', 'dcc_file_uq'),
    ('dcc_anexe', 'dcc_anexe_uq'), ('dcc_revizii', 'dcc_revizii_uq'), ('dcc_revizii', 'dcc_revizii_cod_uq'),
    ('dcc_istoric_aparitii', 'dcc_istoric_sursa_uq'), ('dcc_snapshoturi', 'dcc_snapshoturi_id_proiect_uq'), ('dcc_mesaje', 'dcc_mesaje_rfc_uq'),
    ('dcc_mesaje', 'dcc_mesaje_gmail_uq'), ('dcc_legaturi', 'dcc_legaturi_uq')
  -- INVENTAR-END
  ), asf(t, n) AS (VALUES ('dcc_anexe', 1), ('dcc_documente', 2), ('dcc_file', 1), ('dcc_ghid_intervale', 1), ('dcc_ghid_valori', 1), ('dcc_istoric_aparitii', 3),
    ('dcc_legaturi', 2), ('dcc_mesaje', 3), ('dcc_proiecte', 4), ('dcc_revizii', 4), ('dcc_serii', 2), ('dcc_snapshot_revizii', 2), ('dcc_snapshoturi', 1)
  ), act AS (
    SELECT c.conrelid::regclass::text AS t, c.conname AS n, c.contype AS tip, c.convalidated AS v FROM pg_catalog.pg_constraint c WHERE c.conrelid = ANY (v_rel))
  SELECT string_agg(x, '; ' ORDER BY x) INTO v_rau FROM (
    (SELECT 'lipsa ' || t || '.' || n AS x FROM (SELECT t, n FROM ast EXCEPT SELECT t, n FROM act WHERE tip = 'c' AND v) a)
    UNION ALL (SELECT 'in plus ' || t || '.' || n FROM (SELECT t, n FROM act WHERE tip = 'c' EXCEPT SELECT t, n FROM ast) b)
    UNION ALL (SELECT 'lipsa ' || t || '.' || n FROM (SELECT t, n FROM asu EXCEPT SELECT t, n FROM act WHERE tip = 'u') c)
    UNION ALL (SELECT 'in plus ' || t || '.' || n FROM (SELECT t, n FROM act WHERE tip = 'u' EXCEPT SELECT t, n FROM asu) d)
    UNION ALL (SELECT 'chei straine ' || x.t FROM (SELECT t, count(*) FILTER (WHERE tip = 'f' AND v) AS k FROM act GROUP BY t) x
                LEFT JOIN asf ON asf.t = x.t WHERE x.k IS DISTINCT FROM coalesce(asf.n, 0))
    UNION ALL (SELECT 'fara cheie primara ' || u.tt FROM unnest(v_tab) u(tt) WHERE NOT EXISTS (SELECT 1 FROM act WHERE act.t = u.tt AND act.tip = 'p'))) z;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'L15_POST_CONSTRANGERI: %', v_rau; END IF;

  -- (b) RLS activ pe toate cele 17 și EXACT politicile [D1] (numele + textul, fără spațiul alb al afișării); vederea security_invoker
  WITH asp(t, p, q) AS (VALUES
    ('dcc_anexe', 'dcc_anexe_citire', '(EXISTS ( SELECT 1 FROM dcc_documente d WHERE ((d.id = dcc_anexe.document_id) AND fn_dcc_drept(d.proiect_dcc_id, ''citire''::text))))'),
    ('dcc_contracte', 'dcc_contracte_citire', 'fn_dcc_contract_vizibil(id)'),
    ('dcc_documente', 'dcc_documente_citire', 'fn_dcc_drept(proiect_dcc_id, ''citire''::text)'),
    ('dcc_file', 'dcc_file_citire', '(EXISTS ( SELECT 1 FROM dcc_documente d WHERE ((d.id = dcc_file.document_id) AND fn_dcc_drept(d.proiect_dcc_id, ''citire''::text))))'),
    ('dcc_ghid_intervale', 'dcc_ghid_intervale_citire', 'fn_dcc_are_modul()'),
    ('dcc_ghid_valori', 'dcc_ghid_valori_citire', 'fn_dcc_are_modul()'),
    ('dcc_ghiduri', 'dcc_ghiduri_citire', 'fn_dcc_are_modul()'),
    ('dcc_istoric_aparitii', 'dcc_istoric_aparitii_citire', 'fn_dcc_drept(proiect_dcc_id, ''citire''::text)'),
    ('dcc_legaturi', 'dcc_legaturi_citire', '((EXISTS ( SELECT 1 FROM dcc_mesaje m WHERE ((m.id = dcc_legaturi.mesaj_id) AND fn_dcc_drept(m.proiect_dcc_id, ''citire''::text)))) AND (EXISTS ( SELECT 1 FROM (dcc_revizii r JOIN dcc_documente d ON ((d.id = r.document_id))) WHERE ((r.id = dcc_legaturi.revizie_id) AND fn_dcc_drept(d.proiect_dcc_id, ''citire''::text)))))'),
    ('dcc_mesaje', 'dcc_mesaje_citire', 'fn_dcc_drept(proiect_dcc_id, ''citire''::text)'),
    ('dcc_proiecte', 'dcc_proiecte_citire', 'fn_dcc_drept(id, ''citire''::text)'),
    ('dcc_revizii', 'dcc_revizii_citire', '(EXISTS ( SELECT 1 FROM dcc_documente d WHERE ((d.id = dcc_revizii.document_id) AND fn_dcc_drept(d.proiect_dcc_id, ''citire''::text))))'),
    ('dcc_snapshot_revizii', 'dcc_snapshot_revizii_citire', '((EXISTS ( SELECT 1 FROM dcc_snapshoturi s WHERE ((s.id = dcc_snapshot_revizii.snapshot_id) AND fn_dcc_drept(s.proiect_dcc_id, ''citire''::text)))) AND (EXISTS ( SELECT 1 FROM (dcc_revizii r JOIN dcc_documente d ON ((d.id = r.document_id))) WHERE ((r.id = dcc_snapshot_revizii.revizie_id) AND fn_dcc_drept(d.proiect_dcc_id, ''citire''::text)))))'),
    ('dcc_snapshoturi', 'dcc_snapshoturi_citire', 'fn_dcc_drept(proiect_dcc_id, ''citire''::text)')
  ), acp AS (
    SELECT p.tablename::text AS t, p.policyname::text AS p, regexp_replace(replace(p.qual, 'public.', ''), '[[:space:]]+', ' ', 'g') AS q,
           p.cmd = 'SELECT' AND p.roles = '{authenticated}'::name[] AND p.permissive = 'PERMISSIVE' AND p.with_check IS NULL AS forma
      FROM pg_catalog.pg_policies p WHERE p.schemaname = 'public' AND p.tablename = ANY (v_tab))
  SELECT string_agg(x, '; ' ORDER BY x) INTO v_rau FROM (
    (SELECT 'lipsa ' || p AS x FROM (SELECT t, p, q FROM asp EXCEPT SELECT t, p, q FROM acp WHERE forma) a)
    UNION ALL (SELECT 'in plus / alta forma ' || p FROM (SELECT t, p, q FROM acp EXCEPT SELECT t, p, q FROM asp) b)
    UNION ALL (SELECT 'forma ' || p FROM acp WHERE NOT forma)
    UNION ALL (SELECT 'RLS ' || c.relname FROM pg_catalog.pg_class c WHERE c.oid = ANY (v_rel) AND c.relrowsecurity IS NOT TRUE)
    UNION ALL (SELECT 'security_invoker v_dcc_registru' WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = 'public.v_dcc_registru'::regclass
                                                                              AND 'security_invoker=on' = ANY (c.reloptions)))) z;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'L15_POST_POLITICA: %', v_rau; END IF;

  -- (c) drepturile pe tabele / vedere, fiecare PE RÂND: doar SELECT pentru authenticated pe cele 14 + vedere; nimic pentru anon / service_role /
  -- PUBLIC, nimic pe coloane, nimic pe secvențe
  SELECT string_agg(DISTINCT x.t || '/' || y.rol || '/' || z.d, ', ') INTO v_rau
    FROM unnest(v_tab || ARRAY['v_dcc_registru']) x(t), unnest(ARRAY['anon', 'authenticated', 'service_role']) y(rol),
         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) z(d)
   WHERE has_table_privilege(y.rol, ('public.' || x.t)::regclass, z.d) IS DISTINCT FROM (y.rol = 'authenticated' AND z.d = 'SELECT' AND x.t = ANY (v_cit));
  IF v_rau IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e
                 WHERE (c.oid = ANY (v_rel) OR c.oid = 'public.v_dcc_registru'::regclass) AND e.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = ANY (v_rel) AND a.attnum > 0 AND a.attacl IS NOT NULL)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c, unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol), unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) d(dr)
                 WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'dcc\_%' AND has_sequence_privilege(r.rol, c.oid, d.dr)) THEN
    RAISE EXCEPTION 'L15_POST_GRANT: %', coalesce(v_rau, 'PUBLIC / coloane / secvente');
  END IF;

  -- (d) funcțiile: lista EXACTĂ (nu prefix): DEFINER așteptat, limbajul (plpgsql pentru tot ce citește tabele), search_path fix, proprietar
  -- postgres, EXECUTE exact (authenticated doar unde e declarat; anon / service_role / PUBLIC niciodată)
  WITH asd(s, def, lang, auth) AS (VALUES
    ('fn_dcc_interval_e_canonic(text)', false, 'sql', true), ('fn_dcc_interval_canonic(text)', false, 'plpgsql', true),
    ('fn_dcc_format_valid(jsonb)', false, 'plpgsql', true),
    ('fn_dcc_cod_text(jsonb, text, text, text, text, integer, integer, integer, integer, text)', false, 'plpgsql', true),
    ('fn_dcc_titlu_scurt(text)', false, 'plpgsql', true),
    ('fn_dcc_nume_fisier(jsonb, text, text, text, text, integer, integer, integer, integer, text, text, text)', false, 'plpgsql', true),
    ('fn_dcc_hash_parametri(text, jsonb)', false, 'sql', true), ('fn_dcc_tranzitie_permisa(text, text)', false, 'sql', true),
    ('fn_dcc_istoric_hash(text, text, integer, jsonb, text, text, text, text, integer, integer, integer, integer, text, text[])', false, 'sql', true),
    ('fn_dcc_snapshot_hash(text, text, text[], text[], text, text, text[], jsonb)', false, 'sql', true),
    ('fn_dcc_server()', false, 'plpgsql', true), ('fn_dcc_e_owner()', true, 'plpgsql', true), ('fn_dcc_drept(bigint, text)', true, 'plpgsql', true),
    ('fn_dcc_contract_vizibil(bigint)', true, 'plpgsql', true), ('fn_dcc_are_modul()', true, 'plpgsql', true),
    ('fn_dcc_intentie_reia(uuid, text, text)', false, 'plpgsql', false), ('fn_dcc_intentie_revendica(uuid, text, text)', false, 'plpgsql', false),
    ('fn_dcc_intentie_incheie(uuid, jsonb)', false, 'plpgsql', false), ('fn_dcc_ghid_compatibil_intern(bigint, bigint)', false, 'plpgsql', false),
    ('fn_dcc_lock_contract(bigint, boolean)', false, 'plpgsql', false), ('fn_dcc_lock_cheie_serie(bigint, text, text, text, text)', false, 'plpgsql', false),
    ('fn_dcc_ghid_garda()', false, 'plpgsql', false), ('fn_dcc_ghid_intervale_disjuncte()', false, 'plpgsql', false),
    ('fn_dcc_contracte_garda()', false, 'plpgsql', false), ('fn_dcc_proiecte_garda()', false, 'plpgsql', false),
    ('fn_dcc_intentii_garda()', false, 'plpgsql', false), ('fn_dcc_serii_garda()', false, 'plpgsql', false),
    ('fn_dcc_documente_garda()', false, 'plpgsql', false), ('fn_dcc_file_garda()', false, 'plpgsql', false), ('fn_dcc_anexe_garda()', false, 'plpgsql', false),
    ('fn_dcc_revizii_garda()', false, 'plpgsql', false), ('fn_dcc_istoric_garda()', false, 'plpgsql', false),
    ('fn_dcc_snapshoturi_garda()', false, 'plpgsql', false), ('fn_dcc_snapshot_revizii_garda()', false, 'plpgsql', false),
    ('fn_dcc_mesaje_garda()', false, 'plpgsql', false), ('fn_dcc_legaturi_garda()', false, 'plpgsql', false),
    ('fn_dcc_fara_stergere()', false, 'plpgsql', false), ('fn_dcc_fara_golire()', false, 'plpgsql', false),
    ('fn_dcc_config_permisa_intern()', false, 'plpgsql', false), ('fn_dcc_valori_ghid_intern(bigint, text, text)', false, 'plpgsql', false),
    ('fn_dcc_coduri_intern(bigint, text, text, text, text, integer, integer, integer, integer, text)', false, 'plpgsql', false),
    ('fn_dcc_ghid_creeaza(jsonb, uuid)', true, 'plpgsql', true), ('fn_dcc_contract_creeaza(text, text, text, text, uuid)', true, 'plpgsql', true),
    ('fn_dcc_proiect_seteaza(bigint, bigint, bigint, text, text, text, text[], jsonb, text, integer, integer, uuid)', true, 'plpgsql', true),
    ('fn_dcc_initializeaza_serie(bigint, text, text, text, text, integer, text, boolean, uuid)', true, 'plpgsql', true),
    ('fn_dcc_aloca(bigint, text, text, text, text, text, text, integer, uuid)', true, 'plpgsql', true),
    ('fn_dcc_aloca_manual(bigint, text, text, text, integer, text, text, integer, uuid)', true, 'plpgsql', true),
    ('fn_dcc_revizie_noua(bigint, bigint, bigint, text, text, uuid)', true, 'plpgsql', true),
    ('fn_dcc_fila_noua(bigint, integer, text, text, uuid)', true, 'plpgsql', true), ('fn_dcc_anexa_noua(bigint, text, text, uuid)', true, 'plpgsql', true),
    ('fn_dcc_anuleaza(bigint, bigint, text, uuid)', true, 'plpgsql', true), ('fn_dcc_serii_proiect(bigint)', true, 'plpgsql', true),
    ('fn_dcc_lista_forma_intern(bigint[])', false, 'plpgsql', false), ('fn_dcc_lista_drept_intern(bigint[])', false, 'plpgsql', false),
    ('fn_dcc_istoric_importa(bigint, text, jsonb, uuid)', true, 'plpgsql', true), ('fn_dcc_marcheaza_copiat(bigint[], jsonb, uuid)', true, 'plpgsql', true),
    ('fn_dcc_confirma_trimis_manual(bigint[], timestamptz, text, text, bigint, uuid)', true, 'plpgsql', true)
  )
  SELECT string_agg(a.s, ', ' ORDER BY a.s), count(*) INTO v_rau, v_n
    FROM asd a LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure('public.' || a.s)
   WHERE p.oid IS NULL OR p.prosecdef IS DISTINCT FROM a.def
      OR (SELECT l.lanname FROM pg_catalog.pg_language l WHERE l.oid = p.prolang) IS DISTINCT FROM a.lang
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
      OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.auth
      OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE e.grantee = 0);
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'L15_POST_FUNCTIE: %', v_rau; END IF;
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_dcc\_%';
  IF v_n <> 57 THEN RAISE EXCEPTION 'L15_POST_NUMAR: % functii fn_dcc_ (asteptat 57)', v_n; END IF;

  -- (e) triggerele: lista EXACTĂ (tabel, nume, funcție, tip), active, fără WHEN / argumente / coloane
  WITH ast(t, n, f, tip) AS (VALUES
    ('dcc_ghiduri', 'trg_dcc_ghiduri_imuabil', 'fn_dcc_ghid_garda()', 27), ('dcc_ghid_valori', 'trg_dcc_ghid_valori_imuabil', 'fn_dcc_ghid_garda()', 27),
    ('dcc_ghid_intervale', 'trg_dcc_ghid_intervale_imuabil', 'fn_dcc_ghid_garda()', 27),
    ('dcc_ghid_intervale', 'trg_dcc_ghid_intervale_disjuncte', 'fn_dcc_ghid_intervale_disjuncte()', 7),
    ('dcc_contracte', 'trg_dcc_contracte_imuabil', 'fn_dcc_contracte_garda()', 27), ('dcc_proiecte', 'trg_dcc_proiecte_garda', 'fn_dcc_proiecte_garda()', 31),
    ('dcc_intentii', 'trg_dcc_intentii_garda', 'fn_dcc_intentii_garda()', 31), ('dcc_serii', 'trg_dcc_serii_garda', 'fn_dcc_serii_garda()', 31),
    ('dcc_documente', 'trg_dcc_documente_garda', 'fn_dcc_documente_garda()', 31), ('dcc_file', 'trg_dcc_file_garda', 'fn_dcc_file_garda()', 31),
    ('dcc_anexe', 'trg_dcc_anexe_garda', 'fn_dcc_anexe_garda()', 31), ('dcc_revizii', 'trg_dcc_revizii_garda', 'fn_dcc_revizii_garda()', 31),
    ('dcc_istoric_aparitii', 'trg_dcc_istoric_garda', 'fn_dcc_istoric_garda()', 31), ('dcc_snapshoturi', 'trg_dcc_snapshoturi_garda', 'fn_dcc_snapshoturi_garda()', 31),
    ('dcc_snapshot_revizii', 'trg_dcc_snapshot_revizii_garda', 'fn_dcc_snapshot_revizii_garda()', 31),
    ('dcc_mesaje', 'trg_dcc_mesaje_garda', 'fn_dcc_mesaje_garda()', 31), ('dcc_legaturi', 'trg_dcc_legaturi_garda', 'fn_dcc_legaturi_garda()', 31),
    ('dcc_casute', 'trg_dcc_casute_fara_stergere', 'fn_dcc_fara_stergere()', 11)
  ), toate AS (
    SELECT * FROM ast UNION ALL SELECT t, 'trg_' || t || '_fara_golire', 'fn_dcc_fara_golire()', 34 FROM unnest(v_tab) t
  )
  SELECT string_agg(a.n, ', ' ORDER BY a.n) INTO v_rau FROM toate a
   WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger tg WHERE tg.tgrelid = ('public.' || a.t)::regclass AND tg.tgname = a.n
                        AND tg.tgfoid = to_regprocedure('public.' || a.f) AND tg.tgtype = a.tip::int2 AND tg.tgenabled = 'O' AND tg.tgqual IS NULL
                        AND tg.tgnargs = 0 AND tg.tgattr::text = '');
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'L15_POST_TRIGGER: %', v_rau; END IF;
  SELECT count(*) INTO v_n FROM pg_catalog.pg_trigger tg WHERE (tg.tgrelid = ANY (v_rel) AND NOT tg.tgisinternal) OR tg.tgname LIKE 'trg\_dcc\_%';
  IF v_n <> 35 THEN RAISE EXCEPTION 'L15_POST_NUMAR: % triggere (asteptat 35)', v_n; END IF;

  -- (f) migrarea nu scrie date
  FOR v_cls IN SELECT t FROM unnest(v_tab) t LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_cls) INTO v_n;
    IF v_n <> 0 THEN RAISE EXCEPTION 'L15_POST_DATE: % are % randuri', v_cls, v_n; END IF;
  END LOOP;

  -- (g) lanțul de drept neschimbat (amprentă după) și marcajul livrării
  PERFORM pg_temp.lant_20270108a('dupa');
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270108a_executie_dcc_registru:' || txid_current() THEN
    RAISE EXCEPTION '20270108a: garda final invalida';
  END IF;

  -- (h) POSTCONDIȚIA DE LOCK-URI (ultima): fiecare rând pg_locks al sesiunii (relație, acordat) intră într-o clasă declarată, altfel refuz cu
  -- TOATE rândurile nedeclarate. Clasele, pe dependențele unei relații X = X + indecșii ei (pg_index, toți) + TOAST-ul ei + indecșii TOAST-ului:
  --   M1 = cele 17 tabele + vederea + secvențele lor de identitate (orice mod);
  --   M2 = executie_proiecte: tabela ShareRowExclusiveLock (OBLIGATORIU) / AccessShareLock / RowShareLock, dependențele DOAR AccessShareLock;
  --   R1 = istoricul runnerului (supabase_migrations.schema_migrations), DOAR AccessShareLock;
  --   R2 = tabelele temporare ag_ses_<T> / ag_ina_<T> ale amprentei globale (același T, create în tranzacția curentă), orice mod;
  --   C  = relațiile schemei pg_catalog (definită pe SCHEMĂ, nu pe oid: vederile information_schema au și ele oid-uri mici), orice mod;
  --   E  = relațiile platformei din precondiția P-E (CLASA-E), cu modurile listate.
  v_b_m1 := v_rel || ARRAY['public.v_dcc_registru'::regclass::oid]
            || coalesce((SELECT array_agg(d.objid) FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class s ON s.oid = d.objid
                          WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = ANY (v_rel)
                            AND d.deptype IN ('a', 'i') AND s.relkind = 'S'), '{}'::oid[]);
  v_b_m2 := ARRAY['public.executie_proiecte'::regclass::oid];
  v_b_r1 := CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN '{}'::oid[]
                 ELSE ARRAY[to_regclass('supabase_migrations.schema_migrations')::oid] END;
  SELECT coalesce(array_agg(c.oid), '{}'::oid[]) INTO v_b_r2 FROM pg_catalog.pg_class c
   WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_(ses|ina)_[0-9a-f]{16}$'
     AND c.xmin::text = (txid_current() % 4294967296)::text
     AND (SELECT count(*) FROM pg_catalog.pg_class c2 WHERE c2.relnamespace = c.relnamespace AND c2.relkind = 'r'
             AND c2.xmin::text = (txid_current() % 4294967296)::text
             AND c2.relname IN ('ag_ses_' || right(c.relname, 16), 'ag_ina_' || right(c.relname, 16))) = 2;
  SELECT coalesce(array_agg(c.oid), '{}'::oid[]) INTO v_b_c FROM pg_catalog.pg_class c WHERE c.relnamespace = 'pg_catalog'::regnamespace;
  SELECT coalesce(array_agg(DISTINCT to_regclass(split_part(x, ':', 1))::oid), '{}'::oid[]) INTO v_b_e FROM unnest(v_e_moduri) x;
  FOR v_cls IN SELECT x FROM unnest(ARRAY['M1', 'M2', 'R1', 'R2', 'C', 'E']) x LOOP
    v_baza := CASE v_cls WHEN 'M1' THEN v_b_m1 WHEN 'M2' THEN v_b_m2 WHEN 'R1' THEN v_b_r1 WHEN 'R2' THEN v_b_r2 WHEN 'C' THEN v_b_c ELSE v_b_e END;
    SELECT coalesce(array_agg(DISTINCT z.o), '{}'::oid[]) INTO v_dep FROM (
      SELECT b AS o FROM unnest(v_baza) b
      UNION ALL SELECT i.indexrelid FROM pg_catalog.pg_index i WHERE i.indrelid = ANY (v_baza)
      UNION ALL SELECT c.reltoastrelid FROM pg_catalog.pg_class c WHERE c.oid = ANY (v_baza) AND c.reltoastrelid <> 0
      UNION ALL SELECT i.indexrelid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_index i ON i.indrelid = c.reltoastrelid WHERE c.oid = ANY (v_baza)) z;
    CASE v_cls
      WHEN 'M1' THEN v_m1 := v_dep;
      WHEN 'M2' THEN v_m2 := v_dep;
      WHEN 'R1' THEN v_r1 := v_dep;
      WHEN 'R2' THEN v_r2 := v_dep;
      WHEN 'C' THEN v_c := v_dep;
      ELSE v_e := v_dep;
    END CASE;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_locks l WHERE l.locktype = 'relation' AND l.relation = v_b_m2[1] AND l.pid = pg_backend_pid() AND l.granted
                    AND l.mode = 'ShareRowExclusiveLock') THEN
    RAISE EXCEPTION 'L15_LOCK_LIPSA: public.executie_proiecte ShareRowExclusiveLock (punctul unic de blocare) nu e tinut';
  END IF;
  WITH lk AS (
    SELECT l.relation AS o, l.mode,
           coalesce((SELECT n.nspname || '.' || c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = l.relation),
                    'oid ' || l.relation::text) AS nume,
           EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = l.relation) AS exista
      FROM pg_catalog.pg_locks l
     WHERE l.locktype = 'relation' AND l.pid = pg_backend_pid() AND l.granted
       AND (l.database = (SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname = current_database()) OR l.database = 0)
  ), cl AS (
    SELECT lk.*, CASE
        WHEN NOT lk.exista THEN NULL
        WHEN lk.o = ANY (v_m1) THEN 'M1'
        WHEN lk.o = v_b_m2[1] AND lk.mode IN ('ShareRowExclusiveLock', 'AccessShareLock', 'RowShareLock') THEN 'M2'
        WHEN lk.o = ANY (v_m2) AND lk.o <> v_b_m2[1] AND lk.mode = 'AccessShareLock' THEN 'M2'
        WHEN lk.o = ANY (v_r1) AND lk.mode = 'AccessShareLock' THEN 'R1'
        WHEN lk.o = ANY (v_r2) THEN 'R2'
        WHEN lk.o = ANY (v_c) THEN 'C'
        WHEN lk.o = ANY (v_e) AND (lk.nume || ':' || lk.mode) = ANY (v_e_moduri) THEN 'E'
      END AS clasa
      FROM lk)
  SELECT string_agg(nume || ' ' || mode, '; ' ORDER BY nume, mode) FILTER (WHERE clasa IS NULL),
         format('M1=%s M2=%s R1=%s R2=%s C=%s E=%s', count(*) FILTER (WHERE clasa = 'M1'),
                coalesce(string_agg(nume || ':' || mode, ',' ORDER BY nume, mode) FILTER (WHERE clasa = 'M2'), '-'),
                coalesce(string_agg(nume || ':' || mode, ',' ORDER BY nume, mode) FILTER (WHERE clasa = 'R1'), '-'),
                count(*) FILTER (WHERE clasa = 'R2'), count(*) FILTER (WHERE clasa = 'C'), count(*) FILTER (WHERE clasa = 'E'))
    INTO v_rau, v_set FROM cl;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'L15_LOCK_NEDECLARAT: %', v_rau; END IF;
  RAISE NOTICE 'L15_LOCK_SET %', v_set;
  RAISE NOTICE '20270108a: sfarsit la % ms de la BEGIN; lock-uri puternice tinute de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;

DROP FUNCTION pg_temp.lant_20270108a(text);
