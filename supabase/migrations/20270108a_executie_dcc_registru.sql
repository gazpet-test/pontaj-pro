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
    RAISE EXCEPTION '20270108a: lantul de drept (%) difera de amprenta revizuita: %', p_moment, v_rau;
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

DROP FUNCTION pg_temp.lant_20270108a(text);
