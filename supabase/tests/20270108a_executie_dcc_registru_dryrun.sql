-- DRY 20270108a_executie_dcc_registru — DOAR pe clona 176 (PG17 local, rulat ca superutilizator), NICIODATĂ pe producție. Rulat DUPĂ aplicarea
-- migrării prin runner (comanda 4 din plan, Task 8), cu comanda 5:
--   "$PSQL_BIN" -X -w -v ON_ERROR_STOP=1 -v sis="$SYS" -h "$H" -p "$P" -U postgres -d postgres -f supabase/tests/20270108a_executie_dcc_registru_dryrun.sql
--   grep -c 'NOTICE:  t_.* ok$' dryrun.log      -> trebuie să fie EXACT numărul din linia BLOCURI de mai jos
-- BLOCURI: 20
-- NUME: t_p1_serie_b1 t_p1_serie_b2 t_p1_serie_b3 t_p1_serie_b4 t_p2_cheie_b1 t_p2_cheie_b2 t_p2_cheie_b3 t_p3_revizii t_p4_anulare_limite_b1 t_p4_anulare_limite_b2 t_p4_anulare_limite_b3 t_p4_anulare_limite_b4 t_p5_import t_p6_confirma t_p7_acces t_p7b_acelasi_contract t_p8_contract_comun_b1 t_p8_contract_comun_b2 t_d5_identitati t_regresie_rest_decontat
-- O singură tranzacție, ANULATĂ la final (ROLLBACK): nimic nu rămâne. Garda țintei = primele două instrucțiuni după BEGIN (set_config-ul variabilei
-- psql sis, inofensiv, apoi blocul DO care o compară cu system_identifier din pg_control_system() și cere pg_is_in_recovery() = false); fără
-- variabilă psql rămâne textul brut și psql se oprește la eroarea de sintaxă, înaintea oricărei scrieri. Variabilele trec în blocurile DO prin
-- set_config (psql nu înlocuiește variabilele în corpurile $$).
-- DOAR date sintetice create în tranzacție: profiluri 00000000-0000-4000-8000-0000000000d1 … da (auth.users dacă există), drepturi pe modul,
-- proiecte Execuție 990001 … 990008 (libere, verificat), restricții pe proiect (20261209a); ghiduri / contracte (beneficiari BEN / ALT, emitent
-- AAA, tematici TM1 / TM2 / TS) / proiecte DCC create PRIN RPC; adrese @exemplu.invalid; cheile de intenție 00000000-0000-4000-8000-0000010xxxxx.
-- Cheile de modul 'executie' / 'executie_dcc' se creează în app_modules doar dacă lipsesc (FK user_module_access -> app_modules), anulate la ROLLBACK.
-- Fiecare bloc = un DO cu RAISE NOTICE '<nume> ok' la succes; orice abatere = excepție (FAIL …) și rularea se oprește. SQLSTATE și codul DCC_
-- (începutul mesajului) verificate EXACT prin GET STACKED DIAGNOSTICS; constrângerile prin CONSTRAINT_NAME. Scrierile directe care testează
-- CHECK-uri rulează în sub-bloc cu SET LOCAL session_replication_role = replica (triggerele și cheile străine oprite, CHECK-urile lovesc), cu
-- contra-proba; sub-blocul se anulează mereu (și la succes, prin SQLSTATE DRY01), iar după el se verifică session_replication_role = origin.
-- Aceleași așteptări ca blocurile PGlite (scripts/pglite/dcc_registru/blocuri_t5.mjs, _t6, _t7, _t2, _t4), scrise de mână; codurile de text
-- poartă codul contractului fiecărui bloc (fiecare bloc are contractele lui: tranzacția e comună).
-- Ce probează fiecare bloc (tabelul „Review Focus” din plan, §10):
--   t_p1_serie_b1  proba 1: serie absentă -> DCC_SERIE_ABSENTA, intervalul invalid înaintea citirilor, nimic scris; prag 44 -> 45, 46 consecutive
--   t_p1_serie_b2  CE2: SR1 100–199 (G-A, P1) și SR2 150–249 (G-B, P2) pe aceeași cheie -> 23P01 DCC_INTERVALE_SUPRAPUSE (RPC) și
--                  DCC_GARDA_INTERVALE_SUPRAPUSE (trigger); ghidul incompatibil cu seria -> DCC_GHID_INCOMPATIBIL; contra-probele
--   t_p1_serie_b3  CE10: 'GENERAL' la inițializare și ' sr1' la alocare -> seriile 'general' / 'SR1'; 'sr1' și 'SR1' = aceeași intenție
--   t_p1_serie_b4  CE12: interval '' / spații / TAB scris direct (replica) pe ghid_intervale, serii, documente -> 23514 pe *_interval_ck, contra SR1;
--                  probleme = ARRAY[NULL] -> 23514 dcc_istoric_aparitii_probleme_ck (comportamentul <@ pe PG17 real)
--   t_p2_cheie_b1  proba 2 (alocare): aceeași cheie + aceiași parametri normalizați = același rezultat (reluat); alți parametri / alt autor / altă
--                  operație -> 22023 DCC_CHEIE_ALTI_PARAMETRI
--   t_p2_cheie_b2  proba 2 (revizie): aceeași Rev1 la reluare, alt titlu -> DCC_CHEIE_ALTI_PARAMETRI
--   t_p2_cheie_b3  CE6: reluarea unei intenții comise după retragerea dreptului = același rezultat, 0 rânduri noi; o cheie nouă -> DCC_FARA_DREPT
--   t_p3_revizii   proba 3: două revizii cu chei diferite = Rev1 + Rev2, aceeași cheie = aceeași Rev1; a doua Rev1 directă -> 23505 dcc_revizii_uq
--   t_p4_anulare_limite_b1  proba 4: anularea (admin), numărul nu se refolosește (automat 46, manual 7 -> DCC_COD_OCUPAT), tranzițiile anulării
--   t_p4_anulare_limite_b2  proba 4: limitele intervalului (SR1 199 -> epuizat, fără trecere în SR2; general 99999 -> epuizat), pragurile
--   t_p4_anulare_limite_b3  CE4: revizie / filă / anexă / copiat / confirmat pe document anulat -> DCC_DOCUMENT_ANULAT (RPC), 0 rânduri noi;
--                  plasa pe calea directă -> DCC_GARDA_DOCUMENT_ANULAT (filă, anexă, revizie, tranziție, snapshot, legătură), contra-probele
--   t_p4_anulare_limite_b4  CE9: anularea cu motiv NULL / gol / spații / 501 (replica) -> 23514 pe dcc_documente_anulare_ck / dcc_revizii_anulare_ck,
--                  mesajul manual fără căsuță -> dcc_mesaje_manual_ck; motivele invalide prin RPC -> DCC_MOTIV_LIPSA; motivele păstrate
--   t_p5_import    proba 5: importul de două ori = nicio dublură (identice / diferite listate), reluarea, imuabilitatea, pragul față de istoricul
--                  contractului, cheile refuzate, calea serverului
--   t_p6_confirma  proba 6: „confirm că am trimis” fără căsuță și fără Message-ID -> trimisa_manual_neverificata, nicio valoare inventată
--   t_p7_acces     proba 7: acces doar pe Lot 1 -> nici citire, nici scriere pe Lot 2 (RPC cu același mesaj ca un id inexistent, SELECT,
--                  INSERT / UPDATE / DELETE / TRUNCATE direct)
--   t_p7b_acelasi_contract  CE1: două proiecte ale aceluiași contract, contul restrâns pe unul vede EXACT rândurile lui; divulgarea declarată
--   t_p8_contract_comun_b1  proba 8: două proiecte pe același contract alocă din aceeași serie, documentul dublat direct -> dcc_documente_cod_uq
--   t_p8_contract_comun_b2  CE3: BEN/50 și ALT/50 produc același text de cod, fiecare contract cu documentul lui
--   t_d5_identitati  CE7: SET SESSION AUTHORIZATION authenticator + SET ROLE anon / authenticated / service_role; session_user / current_user /
--                  auth.uid() verificate la fiecare pas; apelul API fără JWT NU e calea serverului
--   t_regresie_rest_decontat  fn_executie_proiect_permis (și fn_rest_decontat_drept, dacă 20270105a e aplicată; altfel „n/a” explicit în
--                  NOTICE) dau valorile scrise de mână pe identitățile sintetice
-- Fără backslash-uri și fără literale Unicode escapate în tot fișierul; singura variabilă psql e sis (pe linia set_config de după BEGIN).
-- Validat local pe PGlite: scripts/pglite/dcc_registru/dryrun_pglite.mjs (aceeași migrare aplicată ca runnerul, variabila înlocuită textual).
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('dcc.sis', :'sis', true);
DO $garda$
DECLARE v_sis text := nullif(current_setting('dcc.sis', true), ''); v_real text; t text; v_n bigint;
BEGIN
  SELECT system_identifier::text INTO v_real FROM pg_control_system();
  IF v_sis IS NULL OR v_sis IS DISTINCT FROM v_real THEN
    RAISE EXCEPTION 'DRYRUN_REFUZ: system_identifier % <> variabila sis % (alta tinta); nimic rulat', v_real, coalesce(v_sis, 'lipsa');
  END IF;
  IF pg_is_in_recovery() THEN RAISE EXCEPTION 'DRYRUN_REFUZ: tinta e in recovery (replica); nimic rulat'; END IF;
  IF session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'DRYRUN_REFUZ: ruleaza ca postgres (session_user %, current_user %)', session_user, current_user;
  END IF;
  IF (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = session_user) IS NOT TRUE THEN
    RAISE EXCEPTION 'DRYRUN_REFUZ: clona se ruleaza ca superutilizator (SET SESSION AUTHORIZATION si session_replication_role)';
  END IF;
  IF to_regclass('public.dcc_documente') IS NULL OR to_regprocedure('public.fn_dcc_aloca(bigint, text, text, text, text, text, text, integer, uuid)') IS NULL THEN
    RAISE EXCEPTION 'DRYRUN_REFUZ: migrarea 20270108a nu e aplicata';
  END IF;
  FOREACH t IN ARRAY ARRAY['dcc_casute', 'dcc_ghiduri', 'dcc_ghid_valori', 'dcc_ghid_intervale', 'dcc_contracte', 'dcc_proiecte', 'dcc_intentii', 'dcc_serii',
                           'dcc_documente', 'dcc_file', 'dcc_anexe', 'dcc_revizii', 'dcc_istoric_aparitii', 'dcc_snapshoturi', 'dcc_snapshot_revizii',
                           'dcc_mesaje', 'dcc_legaturi'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_n;
    IF v_n <> 0 THEN RAISE EXCEPTION 'DRYRUN_REFUZ: %.% are % randuri (dry-run-ul cere tabelele DCC goale, imediat dupa aplicare)', 'public', t, v_n; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id::text BETWEEN '00000000-0000-4000-8000-0000000000d1' AND '00000000-0000-4000-8000-0000000000da')
     OR EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id BETWEEN 990001 AND 990008) THEN
    RAISE EXCEPTION 'DRYRUN_REFUZ: identitatile / proiectele sintetice (d1-da / 990001-990008) exista deja';
  END IF;
  RAISE NOTICE 'garda tintei trecuta: system_identifier %, %', v_real, current_setting('server_version');
END $garda$;

-- ── ajutătoarele (pg_temp, dispar odată cu sesiunea) ──────────────────────────────────────────────────────────────────────────────────
CREATE TEMP SEQUENCE t_chei START 1000000;
CREATE FUNCTION pg_temp.t_kn() RETURNS uuid LANGUAGE sql AS $h$
  SELECT ('00000000-0000-4000-8000-' || lpad(nextval('pg_temp.t_chei')::text, 12, '0'))::uuid
$h$;
CREATE FUNCTION pg_temp.t_u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $h$
  SELECT ('00000000-0000-4000-8000-0000000000' || CASE p WHEN 'OWNER' THEN 'd1' WHEN 'L1' THEN 'd2' WHEN 'ED' THEN 'd3' WHEN 'ED2' THEN 'd4' WHEN 'VIEW' THEN 'd5'
          WHEN 'ADM' THEN 'd6' WHEN 'EXEC' THEN 'd7' WHEN 'FARA' THEN 'd8' WHEN 'RET' THEN 'd9' WHEN 'L7' THEN 'da' END)::uuid
$h$;
CREATE FUNCTION pg_temp.t_e(n integer) RETURNS bigint LANGUAGE sql IMMUTABLE AS $h$ SELECT 990000::bigint + n $h$;
CREATE FUNCTION pg_temp.t_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('dcc.' || p, true), '') $h$;
CREATE FUNCTION pg_temp.t_s(p text, v text) RETURNS void LANGUAGE plpgsql AS $h$ BEGIN PERFORM set_config('dcc.' || p, v, true); END $h$;
-- rolul + JWT-ul unui cont (ambele surse din care citește auth.uid()); 'postgres' = înapoi la operator, fără JWT
CREATE FUNCTION pg_temp.t_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claims', (CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)
                                                 ELSE jsonb_build_object('sub', p_uid, 'role', p_rol) END)::text, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
CREATE FUNCTION pg_temp.t_eq(p_ce text, p_a jsonb, p_b jsonb) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_a IS DISTINCT FROM p_b THEN RAISE EXCEPTION 'FAIL %: % (astepta %)', p_ce, p_a, p_b; END IF;
END $h$;
CREATE FUNCTION pg_temp.t_da(p_ce text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', p_ce; END IF;
END $h$;
-- o instrucțiune care TREBUIE să reușească; rezultatul (jsonb) întors
CREATE FUNCTION pg_temp.t_ok(p_ce text, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $h$
DECLARE v jsonb; v_st text; v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_st = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RAISE EXCEPTION 'FAIL %: % %', p_ce, v_st, v_msg;
  END;
  RETURN v;
END $h$;
-- o instrucțiune care TREBUIE să pice: [SQLSTATE, mesaj, constrângere]
CREATE FUNCTION pg_temp.t_err(p_ce text, p_sql text) RETURNS text[] LANGUAGE plpgsql AS $h$
DECLARE v_st text; v_msg text; v_ck text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_st = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_ck = CONSTRAINT_NAME;
  END;
  IF v_st IS NULL THEN RAISE EXCEPTION 'FAIL %: a trecut fara eroare (%)', p_ce, left(p_sql, 200); END IF;
  RETURN ARRAY[v_st, v_msg, coalesce(v_ck, '')];
END $h$;
-- refuzul așteptat: SQLSTATE exact; p_cod = codul DCC_ de la începutul mesajului (sau un fragment, ex. 'permission denied'); p_ck = constrângerea;
-- p_frag = un fragment în plus al mesajului
CREATE FUNCTION pg_temp.t_refuz(p_ce text, p_sql text, p_stare text, p_cod text DEFAULT NULL, p_ck text DEFAULT NULL, p_frag text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE e text[] := pg_temp.t_err(p_ce, p_sql);
BEGIN
  IF e[1] IS DISTINCT FROM p_stare
     OR (p_cod IS NOT NULL AND left(p_cod, 4) = 'DCC_' AND left(e[2], length(p_cod) + 1) IS DISTINCT FROM p_cod || ':')
     OR (p_cod IS NOT NULL AND left(p_cod, 4) <> 'DCC_' AND position(p_cod IN e[2]) = 0)
     OR (p_ck IS NOT NULL AND e[3] IS DISTINCT FROM p_ck)
     OR (p_frag IS NOT NULL AND position(p_frag IN e[2]) = 0) THEN
    RAISE EXCEPTION 'FAIL %: % [%] %  (astepta % % % %)', p_ce, e[1], e[3], e[2], p_stare, coalesce(p_cod, ''), coalesce(p_ck, ''), coalesce(p_frag, '');
  END IF;
END $h$;
-- aceleași, ca un cont (rolul authenticated + JWT); p_uid NULL = calea serverului (postgres fără JWT)
CREATE FUNCTION pg_temp.t_ca_ok(p_uid uuid, p_ce text, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $h$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.t_ca(p_uid, CASE WHEN p_uid IS NULL THEN 'postgres' ELSE 'authenticated' END);
  v := pg_temp.t_ok(p_ce, p_sql);
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  RETURN v;
END $h$;
CREATE FUNCTION pg_temp.t_ca_err(p_uid uuid, p_ce text, p_sql text) RETURNS text[] LANGUAGE plpgsql AS $h$
DECLARE v text[];
BEGIN
  PERFORM pg_temp.t_ca(p_uid, CASE WHEN p_uid IS NULL THEN 'postgres' ELSE 'authenticated' END);
  v := pg_temp.t_err(p_ce, p_sql);
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  RETURN v;
END $h$;
CREATE FUNCTION pg_temp.t_ca_refuz(p_uid uuid, p_ce text, p_sql text, p_stare text, p_cod text DEFAULT NULL, p_ck text DEFAULT NULL, p_frag text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  PERFORM pg_temp.t_ca(p_uid, CASE WHEN p_uid IS NULL THEN 'postgres' ELSE 'authenticated' END);
  PERFORM pg_temp.t_refuz(p_ce, p_sql, p_stare, p_cod, p_ck, p_frag);
  PERFORM pg_temp.t_ca(NULL, 'postgres');
END $h$;
-- un număr (count) citit ca un cont, prin RLS
CREATE FUNCTION pg_temp.t_ca_n(p_uid uuid, p_sql text) RETURNS bigint LANGUAGE plpgsql AS $h$
DECLARE v bigint; v_st text; v_msg text;
BEGIN
  PERFORM pg_temp.t_ca(p_uid, 'authenticated');
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_st = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RAISE EXCEPTION 'FAIL citire ca %: % % (%)', p_uid, v_st, v_msg, left(p_sql, 200);
  END;
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  RETURN v;
END $h$;
CREATE FUNCTION pg_temp.t_n(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $h$
DECLARE v bigint;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN v;
END $h$;
-- numărul rândurilor din fiecare tabel DCC (ca postgres)
CREATE FUNCTION pg_temp.t_tot() RETURNS jsonb LANGUAGE plpgsql AS $h$
DECLARE t text; v bigint; r jsonb := '{}'::jsonb;
BEGIN
  FOREACH t IN ARRAY ARRAY['dcc_ghiduri', 'dcc_contracte', 'dcc_proiecte', 'dcc_intentii', 'dcc_serii', 'dcc_documente', 'dcc_file', 'dcc_anexe', 'dcc_revizii',
                           'dcc_istoric_aparitii', 'dcc_snapshoturi', 'dcc_snapshot_revizii', 'dcc_mesaje', 'dcc_legaturi'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v;
    r := r || jsonb_build_object(t, v);
  END LOOP;
  RETURN r;
END $h$;
-- sonda directă într-un sub-bloc ANULAT MEREU (la succes prin SQLSTATE DRY01); p_replica = triggerele și cheile străine oprite, CHECK-urile lovesc;
-- p_stare NULL = contra-proba (trebuie să treacă)
CREATE FUNCTION pg_temp.t_sonda(p_ce text, p_sql text[], p_replica boolean, p_stare text DEFAULT NULL, p_cod text DEFAULT NULL, p_ck text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE s text; v_st text; v_msg text; v_ck text;
BEGIN
  BEGIN
    IF p_replica THEN EXECUTE 'SET LOCAL session_replication_role = replica'; END IF;
    FOREACH s IN ARRAY p_sql LOOP EXECUTE s; END LOOP;
    RAISE EXCEPTION 'sonda trecuta' USING ERRCODE = 'DRY01';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_st = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_ck = CONSTRAINT_NAME;
  END;
  IF current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
    RAISE EXCEPTION 'FAIL %: session_replication_role a ramas %', p_ce, current_setting('session_replication_role');
  END IF;
  IF p_stare IS NULL THEN
    IF v_st IS DISTINCT FROM 'DRY01' THEN RAISE EXCEPTION 'FAIL % (contra-proba): % [%] %', p_ce, v_st, v_ck, v_msg; END IF;
  ELSIF v_st = 'DRY01' THEN
    RAISE EXCEPTION 'FAIL %: a trecut (astepta % % %)', p_ce, p_stare, coalesce(p_cod, ''), coalesce(p_ck, '');
  ELSIF v_st IS DISTINCT FROM p_stare
     OR (p_cod IS NOT NULL AND left(v_msg, length(p_cod) + 1) IS DISTINCT FROM p_cod || ':')
     OR (p_ck IS NOT NULL AND v_ck IS DISTINCT FROM p_ck) THEN
    RAISE EXCEPTION 'FAIL %: % [%] %  (astepta % % %)', p_ce, v_st, v_ck, v_msg, p_stare, coalesce(p_cod, ''), coalesce(p_ck, '');
  END IF;
END $h$;
-- formatele ghidurilor de test (src/dcc/dccCodCazuri.json: formate.lot1 / formate.dde)
CREATE FUNCTION pg_temp.t_f(p text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $h$
  SELECT CASE p
    WHEN 'lot1' THEN '[{"camp": "contract", "prefix": ""}, {"camp": "emitent", "prefix": "-"}, {"camp": "tematica", "prefix": "-"}, {"camp": "tip", "prefix": "-"},
      {"camp": "secventa", "prefix": "-", "cifre": 5}, {"camp": "fila", "prefix": "-", "cifre": 2}, {"camp": "anexa", "prefix": "-A", "cifre": 2},
      {"camp": "revizie", "prefix": ".Rev"}, {"camp": "limba", "prefix": "."}]'::jsonb
    WHEN 'dde' THEN '[{"camp": "contract", "prefix": ""}, {"camp": "emitent", "prefix": "-"}, {"camp": "tematica", "prefix": "-"}, {"camp": "tip", "prefix": "-"},
      {"camp": "secventa", "prefix": "-", "cifre": 5}, {"camp": "fila", "prefix": "-", "cifre": 3}, {"camp": "anexa", "prefix": "-AN", "cifre": 2},
      {"camp": "limba", "prefix": "-"}, {"camp": "revizie", "prefix": ".Rev"}]'::jsonb END
$h$;
-- ghidul sintetic (aceleași 12 valori ca rpc.mjs: emitent AAA / SUB, tematici TM1 / TM2 / TS, tipuri COR / RAP / DES / MOM fără tematică, limbi)
CREATE FUNCTION pg_temp.t_ghid(p_cod text, p_format text, p_intervale jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $h$
  SELECT jsonb_build_object('cod', p_cod, 'versiune', 1, 'sursa', 'ghid sintetic', 'format_cod', pg_temp.t_f(p_format), 'format_fisier', pg_temp.t_f(p_format),
    'valori', '[{"categorie": "emitent", "cod": "AAA", "descriere": null}, {"categorie": "emitent", "cod": "SUB", "descriere": null},
                {"categorie": "tematica", "cod": "TM1", "descriere": null}, {"categorie": "tematica", "cod": "TM2", "descriere": null},
                {"categorie": "tematica", "cod": "TS", "descriere": null}, {"categorie": "tip", "cod": "COR", "descriere": null},
                {"categorie": "tip", "cod": "RAP", "descriere": null}, {"categorie": "tip", "cod": "DES", "descriere": null},
                {"categorie": "tip", "cod": "MOM", "descriere": null, "fara_tematica": true}, {"categorie": "limba", "cod": "RO", "descriere": null},
                {"categorie": "limba", "cod": "EN", "descriere": null}, {"categorie": "limba", "cod": "BI", "descriere": null}]'::jsonb,
    'intervale', p_intervale)
$h$;
-- snapshotul „copiat” (ca SNAP din blocuri_t6.mjs), cu suprascrieri
CREATE FUNCTION pg_temp.t_snap(p_extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $h$
  SELECT jsonb_build_object('to', jsonb_build_array('dcc@exemplu.invalid'), 'cc', jsonb_build_array('cc@exemplu.invalid'),
    'subiect', 'Raport sintetic', 'corp', 'Corp sintetic', 'linkuri', jsonb_build_array('https://transfer.exemplu.invalid/x'),
    'manifest', jsonb_build_array(jsonb_build_object('nume', 'b.pdf', 'marime', 10, 'sha256', repeat('a', 64)),
                                  jsonb_build_object('nume', 'a.pdf', 'marime', 5, 'sha256', repeat('b', 64)))) || p_extra
$h$;
CREATE FUNCTION pg_temp.t_arr(p bigint[]) RETURNS text LANGUAGE sql IMMUTABLE AS $h$
  SELECT CASE WHEN p IS NULL THEN 'NULL::bigint[]' ELSE quote_literal(p::text) || '::bigint[]' END
$h$;
-- textele apelurilor RPC (cheia nouă dacă nu e dată)
CREATE FUNCTION pg_temp.q_ghid(p jsonb, k uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS $h$
  SELECT format('SELECT public.fn_dcc_ghid_creeaza(%L::jsonb, %L)', p::text, coalesce(k, pg_temp.t_kn()))
$h$;
CREATE FUNCTION pg_temp.q_contract(ben text, cod text, md text, k uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS $h$
  SELECT format('SELECT public.fn_dcc_contract_creeaza(%L, %L, %L, NULL, %L)', ben, cod, md, coalesce(k, pg_temp.t_kn()))
$h$;
CREATE FUNCTION pg_temp.q_proiect(e integer, c bigint, g bigint, vers integer DEFAULT NULL, k uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS $h$
  SELECT format('SELECT public.fn_dcc_proiect_seteaza(%L, %L, %L, %L, %L, %L, %L::text[], %L::jsonb, NULL, 15, %L, %L)', pg_temp.t_e(e), c, g, 'AAA', 'RO',
                'dcc@exemplu.invalid', ARRAY['cc@exemplu.invalid']::text, '{}', vers, coalesce(k, pg_temp.t_kn()))
$h$;
CREATE FUNCTION pg_temp.q_init(p bigint, tem text, tip text, iv text, prag integer, acc boolean DEFAULT false, k uuid DEFAULT NULL, em text DEFAULT 'AAA',
                               motiv text DEFAULT 'prag confirmat') RETURNS text LANGUAGE sql AS $h$
  SELECT format('SELECT public.fn_dcc_initializeaza_serie(%L, %L, %L, %L, %L, %L, %L, %L, %L)', p, em, tem, tip, iv, prag, motiv, acc, coalesce(k, pg_temp.t_kn()))
$h$;
CREATE FUNCTION pg_temp.q_aloca(p bigint, tem text, tip text, iv text, titlu text DEFAULT 'Raport sintetic', nrf integer DEFAULT NULL, k uuid DEFAULT NULL,
                                em text DEFAULT 'AAA') RETURNS text LANGUAGE sql AS $h$
  SELECT format('SELECT public.fn_dcc_aloca(%L, %L, %L, %L, %L, %L, NULL, %L, %L)', p, em, tem, tip, iv, titlu, nrf, coalesce(k, pg_temp.t_kn()))
$h$;
CREATE FUNCTION pg_temp.q_manual(p bigint, tem text, tip text, secv integer, titlu text DEFAULT 'Document manual', k uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS $h$
  SELECT format('SELECT public.fn_dcc_aloca_manual(%L, %L, %L, %L, %L, %L, NULL, NULL, %L)', p, 'AAA', tem, tip, secv, titlu, coalesce(k, pg_temp.t_kn()))
$h$;
CREATE FUNCTION pg_temp.q_rev(doc bigint, fila bigint DEFAULT NULL, anexa bigint DEFAULT NULL, titlu text DEFAULT NULL, k uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS $h$
  SELECT format('SELECT public.fn_dcc_revizie_noua(%L, %L, %L, %L, NULL, %L)', doc, fila, anexa, titlu, coalesce(k, pg_temp.t_kn()))
$h$;
CREATE FUNCTION pg_temp.q_fila(doc bigint, fila integer, k uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS $h$
  SELECT format('SELECT public.fn_dcc_fila_noua(%L, %L, NULL, NULL, %L)', doc, fila, coalesce(k, pg_temp.t_kn()))
$h$;
CREATE FUNCTION pg_temp.q_anexa(doc bigint, titlu text DEFAULT 'Anexa sintetica', k uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS $h$
  SELECT format('SELECT public.fn_dcc_anexa_noua(%L, %L, NULL, %L)', doc, titlu, coalesce(k, pg_temp.t_kn()))
$h$;
CREATE FUNCTION pg_temp.q_anul(doc bigint, rev bigint DEFAULT NULL, motiv text DEFAULT 'anulat in proba', k uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS $h$
  SELECT format('SELECT public.fn_dcc_anuleaza(%L, %L, %L, %L)', doc, rev, motiv, coalesce(k, pg_temp.t_kn()))
$h$;
CREATE FUNCTION pg_temp.q_import(p bigint, randuri jsonb, lot text DEFAULT 'lot1', k uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS $h$
  SELECT format('SELECT public.fn_dcc_istoric_importa(%L, %L, %L::jsonb, %L)', p, lot, randuri::text, coalesce(k, pg_temp.t_kn()))
$h$;
CREATE FUNCTION pg_temp.q_copiat(revs bigint[], snap jsonb DEFAULT NULL, k uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS $h$
  SELECT format('SELECT public.fn_dcc_marcheaza_copiat(%s, %L::jsonb, %L)', pg_temp.t_arr(revs), coalesce(snap, pg_temp.t_snap())::text, coalesce(k, pg_temp.t_kn()))
$h$;
CREATE FUNCTION pg_temp.q_confirma(revs bigint[], la text DEFAULT 'now()', casuta text DEFAULT 'eu@exemplu.invalid', subiect text DEFAULT NULL, snap bigint DEFAULT NULL,
                                   k uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS $h$
  SELECT format('SELECT public.fn_dcc_confirma_trimis_manual(%s, %s, %L, %L, %L, %L)', pg_temp.t_arr(revs), la, casuta, subiect, snap, coalesce(k, pg_temp.t_kn()))
$h$;
-- configurarea prin RPC, ca owner
CREATE FUNCTION pg_temp.t_contract(ben text, cod text, md text) RETURNS bigint LANGUAGE plpgsql AS $h$
BEGIN
  RETURN (pg_temp.t_ca_ok(pg_temp.t_u('OWNER'), 'contract ' || ben || '/' || cod, pg_temp.q_contract(ben, cod, md)) ->> 'contract_id')::bigint;
END $h$;
CREATE FUNCTION pg_temp.t_proiect(e integer, c bigint, g bigint) RETURNS bigint LANGUAGE plpgsql AS $h$
BEGIN
  RETURN (pg_temp.t_ca_ok(pg_temp.t_u('OWNER'), 'proiect DCC pe ' || pg_temp.t_e(e), pg_temp.q_proiect(e, c, g)) ->> 'proiect_dcc_id')::bigint;
END $h$;
-- apelurile din t_d5_identitati rulează ca authenticator / anon / service_role: drepturile pe ajutătoare (doar în această sesiune)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO anon, authenticated, service_role, authenticator;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA pg_temp TO anon, authenticated, service_role, authenticator;

-- ── fixturile sintetice (nu e un bloc t_*): identități, drepturi, proiecte Execuție, ghidurile comune ───────────────────────────────────
DO $fix$
DECLARE ids uuid[] := ARRAY[pg_temp.t_u('OWNER'), pg_temp.t_u('L1'), pg_temp.t_u('ED'), pg_temp.t_u('ED2'), pg_temp.t_u('VIEW'), pg_temp.t_u('ADM'),
                            pg_temp.t_u('EXEC'), pg_temp.t_u('FARA'), pg_temp.t_u('RET'), pg_temp.t_u('L7')];
  own uuid := pg_temp.t_u('OWNER'); r jsonb; n integer;
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO auth.users (id) SELECT x FROM unnest(ids) x;
  END IF;
  -- rolul explicit ('teren' nu dă niciun drept: dreptul vine din is_owner / user_module_access); fără fișă de angajat
  INSERT INTO public.profiles (id, is_owner, employee_id, role) SELECT x, x = own, NULL, 'teren' FROM unnest(ids) x;
  INSERT INTO public.app_modules (key, parent_key, name, is_active, show_on_homepage) VALUES ('executie', NULL, 'Executie', true, true) ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.app_modules (key, parent_key, name, is_active, show_on_homepage)
    VALUES ('executie_dcc', 'executie', 'Registru DCC (dry-run)', false, false) ON CONFLICT (key) DO NOTHING;
  -- L1 = editor restrâns pe E1; ED / ED2 / RET = editori nerestrânși; VIEW = viewer; ADM = admin; EXEC = doar executie admin; FARA = nimic;
  -- L7 = editor restrâns pe E7 (t_p7b)
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
    (pg_temp.t_u('L1'), 'executie_dcc', 'editor'), (pg_temp.t_u('L1'), 'executie', 'editor'), (pg_temp.t_u('ED'), 'executie_dcc', 'editor'),
    (pg_temp.t_u('ED2'), 'executie_dcc', 'editor'), (pg_temp.t_u('VIEW'), 'executie_dcc', 'viewer'), (pg_temp.t_u('ADM'), 'executie_dcc', 'admin'),
    (pg_temp.t_u('EXEC'), 'executie', 'admin'), (pg_temp.t_u('RET'), 'executie_dcc', 'editor'), (pg_temp.t_u('L7'), 'executie_dcc', 'editor');
  INSERT INTO public.executie_proiecte (id, cod_intern, nume) OVERRIDING SYSTEM VALUE
    SELECT pg_temp.t_e(i), 'DCC-DRY-' || i, 'Dry DCC proiect ' || i FROM generate_series(1, 8) i;
  INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES (pg_temp.t_u('L1'), pg_temp.t_e(1), 'editor'), (pg_temp.t_u('L7'), pg_temp.t_e(7), 'editor');
  -- ghidurile comune (configurația de codificare e globală; fiecare bloc are contractele lui)
  PERFORM pg_temp.t_s('g1', pg_temp.t_ca_ok(own, 'ghid G1', pg_temp.q_ghid(pg_temp.t_ghid('GL1', 'lot1', '[{"interval": "general", "limita_inf": 1, "limita_sup": 99999}]'))) ->> 'ghid_id');
  PERFORM pg_temp.t_s('gdde', pg_temp.t_ca_ok(own, 'ghid GDDE', pg_temp.q_ghid(pg_temp.t_ghid('GDDE', 'dde', '[{"interval": "SR1", "limita_inf": 100, "limita_sup": 199},
    {"interval": "SR2", "limita_inf": 200, "limita_sup": 299}, {"interval": "general", "limita_inf": 300, "limita_sup": 99999}]'))) ->> 'ghid_id');
  PERFORM pg_temp.t_s('ga', pg_temp.t_ca_ok(own, 'ghid GA', pg_temp.q_ghid(pg_temp.t_ghid('GA', 'dde', '[{"interval": "SR1", "limita_inf": 100, "limita_sup": 199}]'))) ->> 'ghid_id');
  PERFORM pg_temp.t_s('gb', pg_temp.t_ca_ok(own, 'ghid GB', pg_temp.q_ghid(pg_temp.t_ghid('GB', 'dde', '[{"interval": "SR2", "limita_inf": 150, "limita_sup": 249}]'))) ->> 'ghid_id');
  PERFORM pg_temp.t_s('g3', pg_temp.t_ca_ok(own, 'ghid G3', pg_temp.q_ghid(pg_temp.t_ghid('G3', 'dde', '[{"interval": "SR1", "limita_inf": 100, "limita_sup": 150}]'))) ->> 'ghid_id');
  PERFORM pg_temp.t_s('g4', pg_temp.t_ca_ok(own, 'ghid G4', pg_temp.q_ghid(pg_temp.t_ghid('G4', 'dde', '[{"interval": "SR2", "limita_inf": 200, "limita_sup": 299}]'))) ->> 'ghid_id');
  PERFORM pg_temp.t_s('g5', pg_temp.t_ca_ok(own, 'ghid G5', pg_temp.q_ghid(pg_temp.t_ghid('G5', 'dde', '[{"interval": "SR1", "limita_inf": 100, "limita_sup": 199},
    {"interval": "SR3", "limita_inf": 300, "limita_sup": 399}]'))) ->> 'ghid_id');
  SELECT count(*) INTO n FROM public.dcc_ghiduri;
  IF n <> 7 THEN RAISE EXCEPTION 'FAIL fixturi: % ghiduri (astepta 7)', n; END IF;
  RAISE NOTICE 'fixturi gata: 10 profiluri sintetice, proiectele Executie %-%, 7 ghiduri', pg_temp.t_e(1), pg_temp.t_e(8);
END $fix$;

-- ── t_p1_serie_b1 — proba 1 ───────────────────────────────────────────────────────────────────────────────────────────────────────
DO $t$
DECLARE ed uuid := pg_temp.t_u('ED'); adm uuid := pg_temp.t_u('ADM'); c bigint; p1 bigint; v0 jsonb; s jsonb; a jsonb; b jsonb;
BEGIN
  c := pg_temp.t_contract('BEN', '30', 'automat');
  p1 := pg_temp.t_proiect(1, c, pg_temp.t_g('g1')::bigint);
  v0 := pg_temp.t_tot();
  PERFORM pg_temp.t_ca_refuz(ed, 'serie neinitializata', pg_temp.q_aloca(p1, 'TM1', 'COR', 'general'), 'P0001', 'DCC_SERIE_ABSENTA');
  PERFORM pg_temp.t_ca_refuz(ed, 'serie neinitializata (forma necanonica)', pg_temp.q_aloca(p1, 'TM1', 'COR', ' General '), 'P0001', 'DCC_SERIE_ABSENTA');
  PERFORM pg_temp.t_ca_refuz(ed, 'interval invalid', pg_temp.q_aloca(p1, 'TM1', 'COR', 'GEN'), '22023', 'DCC_INTERVAL_INVALID');
  PERFORM pg_temp.t_ca_refuz(ed, 'interval gol', pg_temp.q_aloca(p1, 'TM1', 'COR', '  '), '22023', 'DCC_INTERVAL_INVALID');
  PERFORM pg_temp.t_eq('t_p1_serie_b1: nimic scris la refuzuri (niciun document, nicio intentie)', pg_temp.t_tot(), v0);
  s := pg_temp.t_ca_ok(adm, 'initializare prag 44', pg_temp.q_init(p1, 'TM1', 'COR', 'general', 44));
  PERFORM pg_temp.t_eq('rezultatul initializarii', s - 'serie_id',
    '{"prag": 44, "interval": "general", "reluat": false, "urmatorul": 45, "limita_inf": 1, "limita_sup": 99999, "max_istoric": null}');
  PERFORM pg_temp.t_da('serie_id numeric', jsonb_typeof(s -> 'serie_id') = 'number');
  a := pg_temp.t_ca_ok(ed, 'alocarea 1', pg_temp.q_aloca(p1, 'TM1', 'COR', 'general', 'Raport 1'));
  b := pg_temp.t_ca_ok(ed, 'alocarea 2', pg_temp.q_aloca(p1, 'TM1', 'COR', 'general', 'Raport 2'));
  PERFORM pg_temp.t_eq('secvente si coduri', jsonb_build_array(a -> 'secventa', b -> 'secventa', a #> '{revizii,0,cod_text}', b #> '{revizii,0,cod_text}'),
    '[45, 46, "30-AAA-TM1-COR-00045.Rev0.RO", "30-AAA-TM1-COR-00046.Rev0.RO"]');
  PERFORM pg_temp.t_eq('forma rezultatului', to_jsonb(ARRAY(SELECT k FROM jsonb_object_keys(a) k ORDER BY k)), '["document_id", "interval", "reluat", "revizii", "secventa"]');
  PERFORM pg_temp.t_eq('forma reviziei', to_jsonb(ARRAY(SELECT k FROM jsonb_object_keys(a #> '{revizii,0}') k ORDER BY k)),
    '["cod_text", "fila", "limba", "nume_fisier_baza", "revizie", "revizie_id"]');
  PERFORM pg_temp.t_eq('valorile reviziei', jsonb_build_array(a -> 'interval', a #> '{revizii,0,fila}', a #> '{revizii,0,revizie}', a #> '{revizii,0,limba}',
    a #> '{revizii,0,nume_fisier_baza}'), '["general", null, 0, "RO", "30-AAA-TM1-COR-00045.Rev0.RO"]');
  PERFORM pg_temp.t_eq('ultimul_ocupat', to_jsonb((SELECT ultimul_ocupat FROM public.dcc_serii WHERE id = (s ->> 'serie_id')::bigint)), '46');
  PERFORM pg_temp.t_ca_refuz(ed, 'emitent strain', pg_temp.q_aloca(p1, 'TM1', 'COR', 'general', em => 'SUB'), '22023', 'DCC_EMITENT_STRAIN');
  PERFORM pg_temp.t_ca_refuz(pg_temp.t_u('VIEW'), 'viewer nu aloca', pg_temp.q_aloca(p1, 'TM1', 'COR', 'general'), '42501', 'DCC_FARA_DREPT');
  PERFORM pg_temp.t_ca_refuz(ed, 'tematica din afara ghidului', pg_temp.q_aloca(p1, 'TM9', 'COR', 'general'), '22023', 'DCC_VALOARE_GHID');
  PERFORM pg_temp.t_eq('doua documente pe contract', to_jsonb(pg_temp.t_n(format('SELECT count(*) FROM public.dcc_documente WHERE contract_id = %s', c))), '2');
  RAISE NOTICE 't_p1_serie_b1 ok';
END $t$;

-- ── t_p1_serie_b2 — CE2: intervale suprapuse din ghiduri diferite pe aceeași cheie (RPC + plasa), ghidul incompatibil ─────────────────
DO $t$
DECLARE own uuid := pg_temp.t_u('OWNER'); ed uuid := pg_temp.t_u('ED'); c bigint; p1 bigint; p2 bigint; c2 bigint; q1 bigint; q2 bigint; a jsonb;
  ga bigint := pg_temp.t_g('ga')::bigint; gb bigint := pg_temp.t_g('gb')::bigint;
BEGIN
  c := pg_temp.t_contract('BEN', '31', 'automat');
  p1 := pg_temp.t_proiect(1, c, ga);
  p2 := pg_temp.t_proiect(2, c, gb);
  PERFORM pg_temp.t_ca_ok(own, 'SR1 (100-199) din P1', pg_temp.q_init(p1, 'TS', 'DES', 'SR1', 99));
  PERFORM pg_temp.t_ca_refuz(own, 'SR2 (150-249) din P2 pe aceeasi cheie', pg_temp.q_init(p2, 'TS', 'DES', 'SR2', 149), '23P01', 'DCC_INTERVALE_SUPRAPUSE');
  PERFORM pg_temp.t_eq('o singura serie', to_jsonb(pg_temp.t_n(format('SELECT count(*) FROM public.dcc_serii WHERE contract_id = %s', c))), '1');
  -- plasa: aceeași serie scrisă direct (triggerele active) -> codul triggerului; contra-proba pe altă cheie
  PERFORM pg_temp.t_sonda('serie suprapusa scrisa direct', ARRAY[format('INSERT INTO public.dcc_serii (contract_id, emitent, tematica, tip, interval, ghid_id, limita_inf,
    limita_sup, prag_initial, ultimul_ocupat, motiv_prag, initializata_prin) VALUES (%s, ''AAA'', ''TS'', ''DES'', ''SR2'', %s, 150, 249, 149, 149, ''proba'', ''server'')', c, gb)],
    false, '23P01', 'DCC_GARDA_INTERVALE_SUPRAPUSE');
  PERFORM pg_temp.t_sonda('aceeasi serie pe alta cheie, direct (contra-proba)', ARRAY[format('INSERT INTO public.dcc_serii (contract_id, emitent, tematica, tip, interval,
    ghid_id, limita_inf, limita_sup, prag_initial, ultimul_ocupat, motiv_prag, initializata_prin) VALUES (%s, ''AAA'', ''TM1'', ''DES'', ''SR2'', %s, 150, 249, 149, 149,
    ''proba'', ''server'')', c, gb)], false);
  PERFORM pg_temp.t_ca_ok(own, 'SR2 din P2 pe alta cheie (contra-proba)', pg_temp.q_init(p2, 'TM2', 'DES', 'SR2', 149));
  -- ghidul incompatibil cu seria contractului (regula 2): P2 pe G3 (SR1 100-150) refuzat; G4 (fără SR1) -> alocarea SR1 = interval necunoscut; G5 -> continuă
  c2 := pg_temp.t_contract('BEN', '32', 'automat');
  q1 := pg_temp.t_proiect(1, c2, ga);
  q2 := pg_temp.t_proiect(2, c2, ga);
  PERFORM pg_temp.t_ca_ok(own, 'SR1 din P1 (contractul 32)', pg_temp.q_init(q1, 'TS', 'DES', 'SR1', 99));
  PERFORM pg_temp.t_ca_refuz(own, 'P2 pe G3 (SR1 100-150)', pg_temp.q_proiect(2, c2, pg_temp.t_g('g3')::bigint, 1), 'P0001', 'DCC_GHID_INCOMPATIBIL');
  PERFORM pg_temp.t_eq('P2 neschimbat', to_jsonb((SELECT ghid_id FROM public.dcc_proiecte WHERE id = q2)), to_jsonb(ga));
  PERFORM pg_temp.t_ca_ok(own, 'P2 pe G4 (fara SR1)', pg_temp.q_proiect(2, c2, pg_temp.t_g('g4')::bigint, 1));
  PERFORM pg_temp.t_ca_refuz(ed, 'alocarea din P2 pe SR1 fara SR1 in ghid', pg_temp.q_aloca(q2, 'TS', 'DES', 'SR1'), 'P0001', 'DCC_INTERVAL_NECUNOSCUT');
  PERFORM pg_temp.t_ca_ok(own, 'P2 pe G5 (SR1 100-199)', pg_temp.q_proiect(2, c2, pg_temp.t_g('g5')::bigint, 2));
  a := pg_temp.t_ca_ok(ed, 'alocarea din P2 continua seria', pg_temp.q_aloca(q2, 'TS', 'DES', 'SR1'));
  PERFORM pg_temp.t_eq('secventa din P2', a -> 'secventa', '100');
  RAISE NOTICE 't_p1_serie_b2 ok';
END $t$;

-- ── t_p1_serie_b3 — CE10: forma canonică a intervalului la inițializare și la alocare ────────────────────────────────────────────────
DO $t$
DECLARE own uuid := pg_temp.t_u('OWNER'); ed uuid := pg_temp.t_u('ED'); c bigint; p bigint; a jsonb; sg jsonb; g jsonb; x jsonb; y jsonb; k uuid := pg_temp.t_kn();
BEGIN
  c := pg_temp.t_contract('BEN', '33', 'automat');
  p := pg_temp.t_proiect(6, c, pg_temp.t_g('gdde')::bigint);
  PERFORM pg_temp.t_ca_ok(own, 'SR1 prag 99', pg_temp.q_init(p, 'TS', 'DES', 'SR1', 99));
  a := pg_temp.t_ca_ok(ed, 'alocarea pe SR1 (forma necanonica)', pg_temp.q_aloca(p, 'TS', 'DES', ' sr1'));
  PERFORM pg_temp.t_eq('prima alocare SR1', jsonb_build_array(a -> 'secventa', a -> 'interval', a #> '{revizii,0,cod_text}'), '[100, "SR1", "33-AAA-TS-DES-00100-RO.Rev0"]');
  sg := pg_temp.t_ca_ok(own, 'general prag 299 (cerut GENERAL)', pg_temp.q_init(p, 'TM1', 'COR', 'GENERAL', 299));
  PERFORM pg_temp.t_eq('seria are intervalul general', sg -> 'interval', '"general"');
  g := pg_temp.t_ca_ok(ed, 'alocarea cu GENERAL', pg_temp.q_aloca(p, 'TM1', 'COR', 'GENERAL'));
  PERFORM pg_temp.t_eq('alocarea pe general', jsonb_build_array(g -> 'secventa', g -> 'interval'), '[300, "general"]');
  -- aceeași cheie de intenție cu 'sr1' și apoi 'SR1' = aceeași intenție (hash pe forma canonică)
  PERFORM pg_temp.t_ca_ok(own, 'SR1 pe TM2', pg_temp.q_init(p, 'TM2', 'COR', 'SR1', 99));
  x := pg_temp.t_ca_ok(ed, 'alocare cu sr1', pg_temp.q_aloca(p, 'TM2', 'COR', 'sr1', k => k));
  y := pg_temp.t_ca_ok(ed, 'aceeasi cheie cu SR1', pg_temp.q_aloca(p, 'TM2', 'COR', 'SR1', k => k));
  PERFORM pg_temp.t_da('aceeasi intentie (reluat, acelasi document)', y -> 'reluat' = 'true' AND y -> 'document_id' = x -> 'document_id');
  PERFORM pg_temp.t_eq('seriile stocate in forma canonica', to_jsonb(ARRAY(SELECT interval FROM public.dcc_serii WHERE contract_id = c ORDER BY interval COLLATE "C", tematica)),
    '["SR1", "SR1", "general"]');
  PERFORM pg_temp.t_eq('documentele in forma canonica', to_jsonb(ARRAY(SELECT interval FROM public.dcc_documente WHERE contract_id = c ORDER BY secventa)),
    '["SR1", "SR1", "general"]');
  RAISE NOTICE 't_p1_serie_b3 ok';
END $t$;

-- ── t_p1_serie_b4 — CE12: intervalul gol / spații / TAB scris direct (replica) -> 23514, contra-proba SR1; probleme ARRAY[NULL] ───────────
DO $t$
DECLARE v text; ins_gi text; ins_s text; ins_d text; ins_dm text; ins_h text;
BEGIN
  ins_gi := 'INSERT INTO public.dcc_ghid_intervale (ghid_id, interval, limita_inf, limita_sup) VALUES (999999999, %L, 900, 999)';
  ins_s := 'INSERT INTO public.dcc_serii (contract_id, emitent, tematica, tip, interval, ghid_id, limita_inf, limita_sup, prag_initial, ultimul_ocupat, motiv_prag,'
        || ' initializata_prin) VALUES (999999999, ''AAA'', ''TS'', ''RAP'', %L, 999999999, 1, 99999, 0, 0, ''proba'', ''server'')';
  ins_d := 'INSERT INTO public.dcc_documente (contract_id, proiect_dcc_id, emitent, tematica, tip, secventa, interval, serie_id, mod, titlu, are_file, creat_de)'
        || ' VALUES (999999999, 999999999, ''AAA'', ''TS'', ''RAP'', 500, %L, 999999999, ''automat'', ''Proba'', false, ' || quote_literal(pg_temp.t_u('ED')) || ')';
  ins_dm := 'INSERT INTO public.dcc_documente (contract_id, proiect_dcc_id, emitent, tematica, tip, secventa, interval, serie_id, mod, titlu, are_file, creat_de)'
         || ' VALUES (999999999, 999999999, ''AAA'', ''TS'', ''RAP'', 777, %L, NULL, ''manual'', ''Proba'', false, ' || quote_literal(pg_temp.t_u('ED')) || ')';
  FOREACH v IN ARRAY ARRAY['', '   ', chr(9)] LOOP
    PERFORM pg_temp.t_sonda('dcc_ghid_intervale interval ' || to_jsonb(v)::text, ARRAY[format(ins_gi, v)], true, '23514', NULL, 'dcc_ghid_intervale_interval_ck');
    PERFORM pg_temp.t_sonda('dcc_serii interval ' || to_jsonb(v)::text, ARRAY[format(ins_s, v)], true, '23514', NULL, 'dcc_serii_interval_ck');
    PERFORM pg_temp.t_sonda('dcc_documente interval ' || to_jsonb(v)::text, ARRAY[format(ins_d, v)], true, '23514', NULL, 'dcc_documente_interval_ck');
    PERFORM pg_temp.t_sonda('dcc_documente (manual) interval ' || to_jsonb(v)::text, ARRAY[format(ins_dm, v)], true, '23514', NULL, 'dcc_documente_interval_ck');
  END LOOP;
  PERFORM pg_temp.t_sonda('dcc_ghid_intervale SR1 (contra-proba)', ARRAY[format(ins_gi, 'SR1')], true);
  PERFORM pg_temp.t_sonda('dcc_serii SR1 (contra-proba)', ARRAY[format(ins_s, 'SR1')], true);
  PERFORM pg_temp.t_sonda('dcc_documente SR1 (contra-proba)', ARRAY[format(ins_d, 'SR1')], true);
  PERFORM pg_temp.t_sonda('dcc_documente manual fara interval (contra-proba)', ARRAY[replace(format(ins_dm, 'x'), '''x''', 'NULL')], true);
  -- un element NULL în probleme: <@ dă false (nu NULL) pe PG17, deci CHECK-ul respinge
  ins_h := 'INSERT INTO public.dcc_istoric_aparitii (contract_id, proiect_dcc_id, sursa, sursa_id, pozitie, lot_import, valori_originale, probleme, continut_hash,'
        || ' importat_prin) VALUES (999999999, 999999999, ''excel_registru'', ''proba-1'', 1, ''lot_proba'', ''{}''::jsonb, %s, repeat(''e'', 64), ''server'')';
  PERFORM pg_temp.t_sonda('probleme = ARRAY[NULL]', ARRAY[format(ins_h, 'ARRAY[NULL]::text[]')], true, '23514', NULL, 'dcc_istoric_aparitii_probleme_ck');
  PERFORM pg_temp.t_sonda('probleme = {forma_nestandard, NULL}', ARRAY[format(ins_h, 'ARRAY[''forma_nestandard'', NULL]::text[]')], true, '23514', NULL,
    'dcc_istoric_aparitii_probleme_ck');
  PERFORM pg_temp.t_sonda('probleme = {} (contra-proba)', ARRAY[format(ins_h, '''{}''::text[]')], true);
  RAISE NOTICE 't_p1_serie_b4 ok';
END $t$;

-- ── t_p2_cheie_b1 — proba 2 pe alocare ──────────────────────────────────────────────────────────────────────────────────────────
DO $t$
DECLARE ed uuid := pg_temp.t_u('ED'); c bigint; p bigint; k uuid := pg_temp.t_kn(); a jsonb; b jsonb;
BEGIN
  c := pg_temp.t_contract('BEN', '34', 'automat');
  p := pg_temp.t_proiect(1, c, pg_temp.t_g('g1')::bigint);
  PERFORM pg_temp.t_ca_ok(pg_temp.t_u('ADM'), 'initializare', pg_temp.q_init(p, 'TM1', 'COR', 'general', 44));
  a := pg_temp.t_ca_ok(ed, 'alocarea cu K', pg_temp.q_aloca(p, 'TM1', 'COR', 'general', k => k));
  b := pg_temp.t_ca_ok(ed, 'aceeasi cheie, aceiasi parametri (netrimati)', pg_temp.q_aloca(p, ' tm1 ', 'cor', 'GENERAL', k => k));
  PERFORM pg_temp.t_eq('acelasi obiect', b - 'reluat', a - 'reluat');
  PERFORM pg_temp.t_eq('reluat', jsonb_build_array(a -> 'reluat', b -> 'reluat'), '[false, true]');
  PERFORM pg_temp.t_eq('un singur document', to_jsonb(pg_temp.t_n(format('SELECT count(*) FROM public.dcc_documente WHERE contract_id = %s', c))), '1');
  PERFORM pg_temp.t_ca_refuz(ed, 'aceeasi cheie, alt titlu', pg_temp.q_aloca(p, 'TM1', 'COR', 'general', 'alt titlu', k => k), '22023', 'DCC_CHEIE_ALTI_PARAMETRI');
  PERFORM pg_temp.t_ca_refuz(pg_temp.t_u('ED2'), 'aceeasi cheie, alt utilizator', pg_temp.q_aloca(p, 'TM1', 'COR', 'general', k => k), '22023', 'DCC_CHEIE_ALTI_PARAMETRI');
  PERFORM pg_temp.t_ca_refuz(ed, 'aceeasi cheie, alta operatie', pg_temp.q_rev((a ->> 'document_id')::bigint, k => k), '22023', 'DCC_CHEIE_ALTI_PARAMETRI');
  PERFORM pg_temp.t_eq('nimic nou scris', jsonb_build_array(pg_temp.t_n(format('SELECT count(*) FROM public.dcc_documente WHERE contract_id = %s', c)),
    pg_temp.t_n(format('SELECT count(*) FROM public.dcc_revizii WHERE contract_id = %s', c))), '[1, 1]');
  RAISE NOTICE 't_p2_cheie_b1 ok';
END $t$;

-- ── t_p2_cheie_b2 — proba 2 pe revizie ──────────────────────────────────────────────────────────────────────────────────────────
DO $t$
DECLARE ed uuid := pg_temp.t_u('ED'); c bigint; p bigint; d jsonb; k uuid := pg_temp.t_kn(); r1 jsonb; r2 jsonb; doc bigint;
BEGIN
  c := pg_temp.t_contract('BEN', '35', 'automat');
  p := pg_temp.t_proiect(1, c, pg_temp.t_g('g1')::bigint);
  PERFORM pg_temp.t_ca_ok(pg_temp.t_u('ADM'), 'initializare', pg_temp.q_init(p, 'TM1', 'COR', 'general', 44));
  d := pg_temp.t_ca_ok(ed, 'alocare', pg_temp.q_aloca(p, 'TM1', 'COR', 'general'));
  doc := (d ->> 'document_id')::bigint;
  r1 := pg_temp.t_ca_ok(ed, 'Rev1 cu K', pg_temp.q_rev(doc, titlu => 'Revizia 1', k => k));
  r2 := pg_temp.t_ca_ok(ed, 'aceeasi cheie, acelasi titlu', pg_temp.q_rev(doc, titlu => ' Revizia 1 ', k => k));
  PERFORM pg_temp.t_eq('aceeasi Rev1', jsonb_build_array(r1 -> 'revizie', r1 -> 'cod_text', r2 -> 'revizie_id' = r1 -> 'revizie_id', r2 -> 'reluat'),
    '[1, "35-AAA-TM1-COR-00045.Rev1.RO", true, true]');
  PERFORM pg_temp.t_ca_refuz(ed, 'aceeasi cheie, alt titlu', pg_temp.q_rev(doc, titlu => 'alt titlu', k => k), '22023', 'DCC_CHEIE_ALTI_PARAMETRI');
  PERFORM pg_temp.t_eq('Rev0 + o singura Rev1', to_jsonb(pg_temp.t_n(format('SELECT count(*) FROM public.dcc_revizii WHERE document_id = %s', doc))), '2');
  PERFORM pg_temp.t_eq('forma rezultatului', to_jsonb(ARRAY(SELECT x FROM jsonb_object_keys(r1) x ORDER BY x)),
    '["cod_text", "document_id", "limba", "nume_fisier_baza", "reluat", "revizie", "revizie_id", "tinta", "ultima_netrimisa"]');
  PERFORM pg_temp.t_eq('tinta / ultima netrimisa / limba', jsonb_build_array(r1 -> 'tinta', r1 -> 'ultima_netrimisa', r1 -> 'limba'),
    '[{"tip": "document", "fila": null, "anexa": null}, true, "RO"]');
  RAISE NOTICE 't_p2_cheie_b2 ok';
END $t$;

-- ── t_p2_cheie_b3 — CE6: reluarea unei intenții comise după retragerea dreptului ──────────────────────────────────────────────────────
DO $t$
DECLARE ret uuid := pg_temp.t_u('RET'); c bigint; p bigint; k uuid := pg_temp.t_kn(); a jsonb; b jsonb; v0 jsonb;
BEGIN
  c := pg_temp.t_contract('BEN', '36', 'automat');
  p := pg_temp.t_proiect(1, c, pg_temp.t_g('g1')::bigint);
  PERFORM pg_temp.t_ca_ok(pg_temp.t_u('ADM'), 'initializare', pg_temp.q_init(p, 'TM1', 'COR', 'general', 44));
  a := pg_temp.t_ca_ok(ret, 'RET aloca cu K', pg_temp.q_aloca(p, 'TM1', 'COR', 'general', k => k));
  DELETE FROM public.user_module_access WHERE profile_id = ret AND module = 'executie_dcc';
  v0 := pg_temp.t_tot();
  b := pg_temp.t_ca_ok(ret, 'RET reia K dupa retragerea dreptului', pg_temp.q_aloca(p, 'TM1', 'COR', 'general', k => k));
  PERFORM pg_temp.t_eq('acelasi rezultat', b - 'reluat', a - 'reluat');
  PERFORM pg_temp.t_eq('reluat: true', b -> 'reluat', 'true');
  PERFORM pg_temp.t_eq('0 randuri noi in orice tabel dcc_*', pg_temp.t_tot(), v0);
  PERFORM pg_temp.t_ca_refuz(ret, 'RET cu K + alt titlu', pg_temp.q_aloca(p, 'TM1', 'COR', 'general', 'alt', k => k), '22023', 'DCC_CHEIE_ALTI_PARAMETRI');
  PERFORM pg_temp.t_ca_refuz(ret, 'RET cu o cheie noua', pg_temp.q_aloca(p, 'TM1', 'COR', 'general'), '42501', 'DCC_FARA_DREPT');
  PERFORM pg_temp.t_ca_refuz(pg_temp.t_u('ED2'), 'alt utilizator cu K', pg_temp.q_aloca(p, 'TM1', 'COR', 'general', k => k), '22023', 'DCC_CHEIE_ALTI_PARAMETRI');
  PERFORM pg_temp.t_eq('nimic scris la refuzuri', pg_temp.t_tot(), v0);
  RAISE NOTICE 't_p2_cheie_b3 ok';
END $t$;

-- ── t_p3_revizii — proba 3 ────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $t$
DECLARE ed uuid := pg_temp.t_u('ED'); c bigint; p bigint; d jsonb; doc bigint; k1 uuid := pg_temp.t_kn(); r1 jsonb; r2 jsonb; r1b jsonb;
BEGIN
  c := pg_temp.t_contract('BEN', '37', 'automat');
  p := pg_temp.t_proiect(1, c, pg_temp.t_g('g1')::bigint);
  PERFORM pg_temp.t_ca_ok(pg_temp.t_u('ADM'), 'initializare', pg_temp.q_init(p, 'TM1', 'COR', 'general', 44));
  d := pg_temp.t_ca_ok(ed, 'alocare', pg_temp.q_aloca(p, 'TM1', 'COR', 'general'));
  doc := (d ->> 'document_id')::bigint;
  r1 := pg_temp.t_ca_ok(ed, 'revizie cu K1', pg_temp.q_rev(doc, k => k1));
  r2 := pg_temp.t_ca_ok(pg_temp.t_u('ED2'), 'revizie cu K2', pg_temp.q_rev(doc));
  r1b := pg_temp.t_ca_ok(ed, 'revizie din nou cu K1', pg_temp.q_rev(doc, k => k1));
  PERFORM pg_temp.t_eq('Rev1 si Rev2', jsonb_build_array(r1 -> 'revizie', r2 -> 'revizie', r2 -> 'cod_text'), '[1, 2, "37-AAA-TM1-COR-00045.Rev2.RO"]');
  PERFORM pg_temp.t_eq('aceeasi cheie = aceeasi Rev1', jsonb_build_array(r1b -> 'revizie_id' = r1 -> 'revizie_id', r1b -> 'reluat'), '[true, true]');
  PERFORM pg_temp.t_sonda('a doua Rev1 scrisa direct', ARRAY[format('INSERT INTO public.dcc_revizii (contract_id, document_id, revizie, limba, ghid_id, cod_text,
    nume_fisier_baza, creat_de) VALUES (%s, %s, 1, ''RO'', %s, ''ALT-COD'', ''ALT-COD'', %L)', c, doc, pg_temp.t_g('g1'), ed)], false, '23505', NULL, 'dcc_revizii_uq');
  PERFORM pg_temp.t_eq('Rev0, Rev1, Rev2 (niciodata doua Rev1)', to_jsonb(ARRAY(SELECT revizie FROM public.dcc_revizii WHERE document_id = doc ORDER BY revizie)), '[0, 1, 2]');
  RAISE NOTICE 't_p3_revizii ok';
END $t$;

-- ── t_p4_anulare_limite_b1 — proba 4: anularea, numărul nu se refolosește ─────────────────────────────────────────────────────────
DO $t$
DECLARE ed uuid := pg_temp.t_u('ED'); adm uuid := pg_temp.t_u('ADM'); c bigint; p bigint; cm bigint; pm bigint; d jsonb; e jsonb; m jsonb; r jsonb; an jsonb; an2 jsonb;
  dd bigint; de bigint;
BEGIN
  c := pg_temp.t_contract('BEN', '38', 'automat');
  p := pg_temp.t_proiect(1, c, pg_temp.t_g('g1')::bigint);
  cm := pg_temp.t_contract('BEN', '39', 'manual');
  pm := pg_temp.t_proiect(4, cm, pg_temp.t_g('g1')::bigint);
  PERFORM pg_temp.t_ca_ok(adm, 'initializare', pg_temp.q_init(p, 'TM1', 'COR', 'general', 44));
  d := pg_temp.t_ca_ok(ed, 'alocarea 45', pg_temp.q_aloca(p, 'TM1', 'COR', 'general'));
  dd := (d ->> 'document_id')::bigint;
  PERFORM pg_temp.t_ca_refuz(ed, 'editorul nu anuleaza ([D7])', pg_temp.q_anul(dd), '42501', 'DCC_FARA_DREPT');
  an := pg_temp.t_ca_ok(adm, 'adminul anuleaza documentul 45', pg_temp.q_anul(dd));
  PERFORM pg_temp.t_eq('rezultatul anularii', an, jsonb_build_object('tinta', 'document', 'reluat', false, 'document_id', dd, 'revizie_id', NULL,
    'revizii_anulate', jsonb_build_array(d #> '{revizii,0,revizie_id}'), 'revizii_pastrate', '[]'::jsonb));
  PERFORM pg_temp.t_eq('starile dupa anulare', (SELECT jsonb_build_object('stare', x.stare, 'stare_transport', r0.stare_transport) FROM public.dcc_documente x
    JOIN public.dcc_revizii r0 ON r0.document_id = x.id WHERE x.id = dd), '{"stare": "anulat", "stare_transport": "anulata"}');
  e := pg_temp.t_ca_ok(ed, 'alocarea urmatoare', pg_temp.q_aloca(p, 'TM1', 'COR', 'general'));
  PERFORM pg_temp.t_eq('dupa anulare (numarul 45 nu se refoloseste)', e -> 'secventa', '46');
  de := (e ->> 'document_id')::bigint;
  -- contractul manual: numărul anulat rămâne ocupat
  m := pg_temp.t_ca_ok(ed, 'manual 7', pg_temp.q_manual(pm, 'TM1', 'COR', 7));
  PERFORM pg_temp.t_ca_ok(adm, 'anularea manualului 7', pg_temp.q_anul((m ->> 'document_id')::bigint));
  PERFORM pg_temp.t_ca_refuz(ed, 'manual pe un numar anulat', pg_temp.q_manual(pm, 'TM1', 'COR', 7), '23505', 'DCC_COD_OCUPAT');
  -- revizia trimisă nu se mai anulează; revizia unui document anulat -> EXACT DCC_DOCUMENT_ANULAT
  r := pg_temp.t_ca_ok(ed, 'Rev1 pe 46', pg_temp.q_rev(de));
  UPDATE public.dcc_revizii SET stare_transport = 'trimisa_manual_neverificata' WHERE id = (r ->> 'revizie_id')::bigint;
  PERFORM pg_temp.t_ca_refuz(adm, 'anularea unei revizii trimise', pg_temp.q_anul(NULL, (r ->> 'revizie_id')::bigint), 'P0001', 'DCC_TRANZITIE_NEPERMISA');
  PERFORM pg_temp.t_ca_refuz(adm, 'anularea unei revizii a unui document anulat', pg_temp.q_anul(NULL, (d #>> '{revizii,0,revizie_id}')::bigint), 'P0001', 'DCC_DOCUMENT_ANULAT');
  PERFORM pg_temp.t_ca_refuz(adm, 'a doua anulare a documentului', pg_temp.q_anul(dd), 'P0001', 'DCC_DOCUMENT_ANULAT');
  PERFORM pg_temp.t_ca_refuz(adm, 'document SI revizie', pg_temp.q_anul(de, (r ->> 'revizie_id')::bigint), '22023', 'DCC_PARAMETRU_INVALID');
  an2 := pg_temp.t_ca_ok(adm, 'anularea documentului 46', pg_temp.q_anul(de));
  PERFORM pg_temp.t_eq('reviziile anulate / pastrate', jsonb_build_array(an2 -> 'revizii_anulate', an2 -> 'revizii_pastrate'),
    jsonb_build_array(jsonb_build_array(e #> '{revizii,0,revizie_id}'), jsonb_build_array(jsonb_build_object('revizie_id', r -> 'revizie_id',
      'stare_transport', 'trimisa_manual_neverificata'))));
  PERFORM pg_temp.t_eq('seria nu scade', to_jsonb((SELECT ultimul_ocupat FROM public.dcc_serii WHERE contract_id = c)), '46');
  RAISE NOTICE 't_p4_anulare_limite_b1 ok';
END $t$;

-- ── t_p4_anulare_limite_b2 — proba 4: limitele intervalului, fără trecere în alt interval; pragurile ─────────────────────────────────
DO $t$
DECLARE own uuid := pg_temp.t_u('OWNER'); ed uuid := pg_temp.t_u('ED'); c bigint; p bigint; s2 jsonb; b jsonb; g jsonb;
BEGIN
  c := pg_temp.t_contract('BEN', '40', 'automat');
  p := pg_temp.t_proiect(6, c, pg_temp.t_g('gdde')::bigint);
  PERFORM pg_temp.t_ca_ok(own, 'SR1 prag 198 (tip RAP)', pg_temp.q_init(p, 'TS', 'RAP', 'SR1', 198));
  s2 := pg_temp.t_ca_ok(own, 'SR2 prag 210 (tip RAP)', pg_temp.q_init(p, 'TS', 'RAP', 'SR2', 210));
  b := pg_temp.t_ca_ok(ed, 'alocarea 199', pg_temp.q_aloca(p, 'TS', 'RAP', 'SR1'));
  PERFORM pg_temp.t_eq('SR1: 199', jsonb_build_array(b -> 'secventa', b #> '{revizii,0,cod_text}'), '[199, "40-AAA-TS-RAP-00199-RO.Rev0"]');
  PERFORM pg_temp.t_ca_refuz(ed, 'SR1 epuizat', pg_temp.q_aloca(p, 'TS', 'RAP', 'SR1'), 'P0001', 'DCC_INTERVAL_EPUIZAT');
  PERFORM pg_temp.t_eq('SR2 neatins (fara trecere in intervalul urmator)', to_jsonb((SELECT ultimul_ocupat FROM public.dcc_serii WHERE id = (s2 ->> 'serie_id')::bigint)), '210');
  PERFORM pg_temp.t_eq('niciun document 200', to_jsonb(pg_temp.t_n(format('SELECT count(*) FROM public.dcc_documente WHERE contract_id = %s AND secventa = 200', c))), '0');
  PERFORM pg_temp.t_ca_ok(own, 'general prag 99998', pg_temp.q_init(p, 'TM1', 'COR', 'general', 99998));
  g := pg_temp.t_ca_ok(ed, 'alocarea 99999', pg_temp.q_aloca(p, 'TM1', 'COR', 'general'));
  PERFORM pg_temp.t_eq('general: 99999', g -> 'secventa', '99999');
  PERFORM pg_temp.t_ca_refuz(ed, 'general epuizat', pg_temp.q_aloca(p, 'TM1', 'COR', 'general'), 'P0001', 'DCC_INTERVAL_EPUIZAT');
  -- pragul în afara intervalului / sub un document existent (scris direct, manual) / egal cu el
  PERFORM pg_temp.t_ca_refuz(own, 'prag 200 pe SR1', pg_temp.q_init(p, 'TM2', 'DES', 'SR1', 200), '22023', 'DCC_PARAMETRU_INVALID');
  INSERT INTO public.dcc_documente (contract_id, proiect_dcc_id, emitent, tematica, tip, secventa, interval, serie_id, mod, titlu, are_file, creat_de)
  VALUES (c, p, 'AAA', 'TM2', 'DES', 150, NULL, NULL, 'manual', 'Document scris direct', false, ed);
  PERFORM pg_temp.t_ca_refuz(own, 'prag sub un document existent', pg_temp.q_init(p, 'TM2', 'DES', 'SR1', 120), 'P0001', 'DCC_PRAG_SUB_DOCUMENTE', NULL, '150');
  PERFORM pg_temp.t_ca_ok(own, 'prag egal cu documentul existent (contra-proba)', pg_temp.q_init(p, 'TM2', 'DES', 'SR1', 150));
  RAISE NOTICE 't_p4_anulare_limite_b2 ok';
END $t$;

-- ── t_p4_anulare_limite_b3 — CE4: nimic nou pe un document anulat (RPC) + plasa pe calea directă ───────────────────────────────────
DO $t$
DECLARE ed uuid := pg_temp.t_u('ED'); adm uuid := pg_temp.t_u('ADM'); c bigint; p bigint; d jsonb; doc bigint; fila1 bigint; v0 jsonb; d2 jsonb; doc2 bigint;
  r0 bigint; r1 bigint; d3 jsonb; d4 jsonb; d5 jsonb; snap bigint; mesaj bigint; g1 bigint := pg_temp.t_g('g1')::bigint; st jsonb;
BEGIN
  c := pg_temp.t_contract('BEN', '41', 'automat');
  p := pg_temp.t_proiect(1, c, g1);
  PERFORM pg_temp.t_ca_ok(adm, 'initializare DES', pg_temp.q_init(p, 'TM1', 'DES', 'general', 44));
  PERFORM pg_temp.t_ca_ok(adm, 'initializare COR', pg_temp.q_init(p, 'TM1', 'COR', 'general', 44));
  -- (a) revizie / filă / anexă pe documentul anulat prin RPC
  d := pg_temp.t_ca_ok(ed, 'document cu 2 file', pg_temp.q_aloca(p, 'TM1', 'DES', 'general', nrf => 2));
  doc := (d ->> 'document_id')::bigint;
  SELECT id INTO fila1 FROM public.dcc_file WHERE document_id = doc AND fila = 1;
  PERFORM pg_temp.t_ca_ok(adm, 'anularea', pg_temp.q_anul(doc));
  v0 := pg_temp.t_tot();
  PERFORM pg_temp.t_ca_refuz(ed, 'revizie noua pe document anulat', pg_temp.q_rev(doc, fila1), 'P0001', 'DCC_DOCUMENT_ANULAT');
  PERFORM pg_temp.t_ca_refuz(ed, 'fila noua pe document anulat', pg_temp.q_fila(doc, 3), 'P0001', 'DCC_DOCUMENT_ANULAT');
  PERFORM pg_temp.t_ca_refuz(ed, 'anexa noua pe document anulat', pg_temp.q_anexa(doc), 'P0001', 'DCC_DOCUMENT_ANULAT');
  PERFORM pg_temp.t_eq('0 randuri noi (a)', pg_temp.t_tot(), v0);
  -- (b) copiat / confirmat pe reviziile documentului anulat (Rev0 trimisă rămâne trimisă, Rev1 anulată)
  d2 := pg_temp.t_ca_ok(ed, 'alocare COR', pg_temp.q_aloca(p, 'TM1', 'COR', 'general'));
  doc2 := (d2 ->> 'document_id')::bigint;
  r0 := (d2 #>> '{revizii,0,revizie_id}')::bigint;
  st := pg_temp.t_ca_ok(ed, 'Rev0 trimisa (neverificata)', pg_temp.q_confirma(ARRAY[r0]));
  mesaj := (st ->> 'mesaj_id')::bigint;
  r1 := (pg_temp.t_ca_ok(ed, 'Rev1', pg_temp.q_rev(doc2)) ->> 'revizie_id')::bigint;
  PERFORM pg_temp.t_ca_ok(adm, 'anularea documentului', pg_temp.q_anul(doc2));
  PERFORM pg_temp.t_eq('Rev0 ramane trimisa, Rev1 anulata', to_jsonb(ARRAY(SELECT stare_transport FROM public.dcc_revizii WHERE document_id = doc2 ORDER BY id)),
    '["trimisa_manual_neverificata", "anulata"]');
  v0 := pg_temp.t_tot();
  PERFORM pg_temp.t_ca_refuz(ed, 'copiat pe revizia trimisa a documentului anulat', pg_temp.q_copiat(ARRAY[r0]), 'P0001', 'DCC_DOCUMENT_ANULAT');
  PERFORM pg_temp.t_ca_refuz(ed, 'copiat pe revizia anulata', pg_temp.q_copiat(ARRAY[r1]), 'P0001', 'DCC_DOCUMENT_ANULAT');
  PERFORM pg_temp.t_ca_refuz(ed, 'confirmat pe documentul anulat', pg_temp.q_confirma(ARRAY[r1]), 'P0001', 'DCC_DOCUMENT_ANULAT');
  PERFORM pg_temp.t_eq('0 randuri noi (b)', pg_temp.t_tot(), v0);
  -- (c) plasa (triggerele) pe calea directă: d4 anulat DIRECT (fără cascada RPC-ului: revizia lui rămâne rezervata), d3 activ = contra-proba
  d3 := pg_temp.t_ca_ok(ed, 'document activ cu o fila', pg_temp.q_aloca(p, 'TM1', 'DES', 'general', nrf => 1));
  d4 := pg_temp.t_ca_ok(ed, 'document de anulat direct', pg_temp.q_aloca(p, 'TM1', 'DES', 'general', nrf => 1));
  d5 := pg_temp.t_ca_ok(ed, 'document pentru snapshot', pg_temp.q_aloca(p, 'TM1', 'COR', 'general'));
  snap := (pg_temp.t_ca_ok(ed, 'copiat d5', pg_temp.q_copiat(ARRAY[(d5 #>> '{revizii,0,revizie_id}')::bigint])) ->> 'snapshot_id')::bigint;
  UPDATE public.dcc_documente SET stare = 'anulat', anulat_la = now(), anulat_de = pg_temp.t_u('OWNER'), motiv_anulare = 'anulat direct in proba'
   WHERE id = (d4 ->> 'document_id')::bigint;
  PERFORM pg_temp.t_sonda('document ANULAT: fila', ARRAY[format('INSERT INTO public.dcc_file (document_id, fila) VALUES (%s, 2)', d4 -> 'document_id')], false,
    'P0001', 'DCC_GARDA_DOCUMENT_ANULAT');
  PERFORM pg_temp.t_sonda('document ACTIV: fila (contra-proba)', ARRAY[format('INSERT INTO public.dcc_file (document_id, fila) VALUES (%s, 2)', d3 -> 'document_id')], false);
  PERFORM pg_temp.t_sonda('document ANULAT: anexa', ARRAY[format('INSERT INTO public.dcc_anexe (document_id, numar, titlu) VALUES (%s, 1, ''Anexa'')', d4 -> 'document_id')],
    false, 'P0001', 'DCC_GARDA_DOCUMENT_ANULAT');
  PERFORM pg_temp.t_sonda('document ACTIV: anexa (contra-proba)', ARRAY[format('INSERT INTO public.dcc_anexe (document_id, numar, titlu) VALUES (%s, 1, ''Anexa'')',
    d3 -> 'document_id')], false);
  PERFORM pg_temp.t_sonda('document ANULAT: revizie', ARRAY[format('INSERT INTO public.dcc_revizii (contract_id, document_id, fila_id, revizie, limba, ghid_id, cod_text,
    nume_fisier_baza, creat_de) SELECT %s, f.document_id, f.id, 1, ''RO'', %s, ''P-ANULAT-01.Rev1.RO'', ''P-ANULAT-01.Rev1.RO'', %L FROM public.dcc_file f
    WHERE f.document_id = %s AND f.fila = 1', c, g1, ed, d4 -> 'document_id')], false, 'P0001', 'DCC_GARDA_DOCUMENT_ANULAT');
  PERFORM pg_temp.t_sonda('document ACTIV: revizie (contra-proba)', ARRAY[format('INSERT INTO public.dcc_revizii (contract_id, document_id, fila_id, revizie, limba, ghid_id,
    cod_text, nume_fisier_baza, creat_de) SELECT %s, f.document_id, f.id, 1, ''RO'', %s, ''P-ACTIV-01.Rev1.RO'', ''P-ACTIV-01.Rev1.RO'', %L FROM public.dcc_file f
    WHERE f.document_id = %s AND f.fila = 1', c, g1, ed, d3 -> 'document_id')], false);
  PERFORM pg_temp.t_sonda('document ANULAT: rezervata -> copiata', ARRAY[format('UPDATE public.dcc_revizii SET stare_transport = ''copiata_pentru_gmail'' WHERE id = %s',
    d4 #> '{revizii,0,revizie_id}')], false, 'P0001', 'DCC_GARDA_DOCUMENT_ANULAT');
  PERFORM pg_temp.t_sonda('document ACTIV: rezervata -> copiata (contra-proba)', ARRAY[format('UPDATE public.dcc_revizii SET stare_transport = ''copiata_pentru_gmail''
    WHERE id = %s', d3 #> '{revizii,0,revizie_id}')], false);
  PERFORM pg_temp.t_sonda('document ANULAT: snapshot <-> revizie', ARRAY[format('INSERT INTO public.dcc_snapshot_revizii (snapshot_id, revizie_id) VALUES (%s, %s)', snap,
    d4 #> '{revizii,0,revizie_id}')], false, 'P0001', 'DCC_GARDA_DOCUMENT_ANULAT');
  PERFORM pg_temp.t_sonda('document ACTIV: snapshot <-> revizie (contra-proba)', ARRAY[format('INSERT INTO public.dcc_snapshot_revizii (snapshot_id, revizie_id)
    VALUES (%s, %s)', snap, d3 #> '{revizii,0,revizie_id}')], false);
  PERFORM pg_temp.t_sonda('document ANULAT: legatura manuala', ARRAY[format('INSERT INTO public.dcc_legaturi (mesaj_id, revizie_id, metoda, stare)
    VALUES (%s, %s, ''manual'', ''propusa'')', mesaj, d4 #> '{revizii,0,revizie_id}')], false, 'P0001', 'DCC_GARDA_DOCUMENT_ANULAT');
  PERFORM pg_temp.t_sonda('document ACTIV: legatura manuala (contra-proba)', ARRAY[format('INSERT INTO public.dcc_legaturi (mesaj_id, revizie_id, metoda, stare)
    VALUES (%s, %s, ''manual'', ''propusa'')', mesaj, d3 #> '{revizii,0,revizie_id}')], false);
  RAISE NOTICE 't_p4_anulare_limite_b3 ok';
END $t$;

-- ── t_p4_anulare_limite_b4 — CE9: motivul anulării pe toate căile (RPC + CHECK-uri NULL / gol / spații / 501 în replica) ──────────────
DO $t$
DECLARE ed uuid := pg_temp.t_u('ED'); adm uuid := pg_temp.t_u('ADM'); own uuid := pg_temp.t_u('OWNER'); c bigint; p bigint; d jsonb; doc bigint; r1 jsonb;
  v0 jsonb; m text; d2 jsonb; doc2 bigint; rev2 bigint; upd_d text; upd_r text; ins_m text;
BEGIN
  c := pg_temp.t_contract('BEN', '42', 'automat');
  p := pg_temp.t_proiect(1, c, pg_temp.t_g('g1')::bigint);
  PERFORM pg_temp.t_ca_ok(adm, 'initializare', pg_temp.q_init(p, 'TM1', 'COR', 'general', 44));
  d := pg_temp.t_ca_ok(ed, 'alocare', pg_temp.q_aloca(p, 'TM1', 'COR', 'general'));
  doc := (d ->> 'document_id')::bigint;
  r1 := pg_temp.t_ca_ok(ed, 'Rev1', pg_temp.q_rev(doc));
  v0 := pg_temp.t_tot();
  PERFORM pg_temp.t_ca_refuz(adm, 'motiv NULL', pg_temp.q_anul(NULL, (r1 ->> 'revizie_id')::bigint, NULL), '22023', 'DCC_MOTIV_LIPSA');
  PERFORM pg_temp.t_ca_refuz(adm, 'motiv gol', pg_temp.q_anul(NULL, (r1 ->> 'revizie_id')::bigint, ''), '22023', 'DCC_MOTIV_LIPSA');
  PERFORM pg_temp.t_ca_refuz(adm, 'motiv spatii', pg_temp.q_anul(NULL, (r1 ->> 'revizie_id')::bigint, '   '), '22023', 'DCC_MOTIV_LIPSA');
  PERFORM pg_temp.t_ca_refuz(adm, 'motiv 501', pg_temp.q_anul(NULL, (r1 ->> 'revizie_id')::bigint, repeat('x', 501)), '22023', 'DCC_MOTIV_LIPSA');
  PERFORM pg_temp.t_eq('nimic scris la motivele invalide', pg_temp.t_tot(), v0);
  PERFORM pg_temp.t_ca_ok(adm, 'anularea Rev1 cu M1', pg_temp.q_anul(NULL, (r1 ->> 'revizie_id')::bigint, ' M1 '));
  PERFORM pg_temp.t_ca_ok(own, 'anularea documentului cu M2', pg_temp.q_anul(doc, NULL, 'M2'));
  PERFORM pg_temp.t_eq('motivele pe revizii', (SELECT jsonb_agg(jsonb_build_object('revizie', revizie, 'motiv_anulare', motiv_anulare, 'anulata_prin', anulata_prin,
    'anulata_de', anulata_de) ORDER BY revizie) FROM public.dcc_revizii WHERE document_id = doc),
    jsonb_build_array(jsonb_build_object('revizie', 0, 'motiv_anulare', 'M2', 'anulata_prin', 'document', 'anulata_de', own),
                      jsonb_build_object('revizie', 1, 'motiv_anulare', 'M1', 'anulata_prin', 'revizie', 'anulata_de', adm)));
  PERFORM pg_temp.t_eq('motivul pe document', (SELECT jsonb_build_object('motiv_anulare', motiv_anulare, 'anulat_de', anulat_de) FROM public.dcc_documente WHERE id = doc),
    jsonb_build_object('motiv_anulare', 'M2', 'anulat_de', own));
  -- CHECK-urile (triggerele oprite în replica): anularea cu motiv NULL / gol / spații / 501 -> 23514; contra-proba cu motiv valid
  d2 := pg_temp.t_ca_ok(ed, 'document activ pentru sonde', pg_temp.q_aloca(p, 'TM1', 'COR', 'general'));
  doc2 := (d2 ->> 'document_id')::bigint;
  rev2 := (d2 #>> '{revizii,0,revizie_id}')::bigint;
  upd_d := 'UPDATE public.dcc_documente SET stare = ''anulat'', anulat_la = now(), anulat_de = ' || quote_literal(own) || ', motiv_anulare = %s WHERE id = ' || doc2;
  FOREACH m IN ARRAY ARRAY['NULL', '''''', '''   ''', quote_literal(repeat('x', 501))] LOOP
    PERFORM pg_temp.t_sonda('document anulat cu motiv ' || left(m, 12), ARRAY[format(upd_d, m)], true, '23514', NULL, 'dcc_documente_anulare_ck');
  END LOOP;
  PERFORM pg_temp.t_sonda('document anulat cu motiv valid (contra-proba)', ARRAY[format(upd_d, '''motiv valid''')], true);
  upd_r := 'UPDATE public.dcc_revizii SET stare_transport = ''anulata'', anulata_la = now(), anulata_de = ' || quote_literal(own) || ', anulata_prin = %s, motiv_anulare = %s'
        || ' WHERE id = ' || rev2;
  PERFORM pg_temp.t_sonda('revizie anulata cu motiv NULL', ARRAY[format(upd_r, '''revizie''', 'NULL')], true, '23514', NULL, 'dcc_revizii_anulare_ck');
  PERFORM pg_temp.t_sonda('revizie anulata fara anulata_prin', ARRAY[format(upd_r, 'NULL', '''motiv''')], true, '23514', NULL, 'dcc_revizii_anulare_ck');
  PERFORM pg_temp.t_sonda('revizie anulata cu motiv + prin (contra-proba)', ARRAY[format(upd_r, '''revizie''', '''motiv''')], true);
  ins_m := 'INSERT INTO public.dcc_mesaje (contract_id, proiect_dcc_id, directie, sursa, casuta_declarata, data_mesaj, dovezi_complete)'
        || ' VALUES (999999999, 999999999, ''trimis'', ''manual_declarat'', %s, now(), false)';
  PERFORM pg_temp.t_sonda('mesaj manual fara casuta declarata', ARRAY[format(ins_m, 'NULL')], true, '23514', NULL, 'dcc_mesaje_manual_ck');
  PERFORM pg_temp.t_sonda('mesaj manual cu casuta declarata (contra-proba)', ARRAY[format(ins_m, '''eu@exemplu.invalid''')], true);
  RAISE NOTICE 't_p4_anulare_limite_b4 ok';
END $t$;

-- ── t_p5_import — proba 5 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $t$
DECLARE adm uuid := pg_temp.t_u('ADM'); c bigint; p1 bigint; p2 bigint; k1 uuid := pg_temp.t_kn(); a jsonb; b jsonb; d jsonb; r jsonb; s jsonb; ch text;
  ist jsonb := '[{"sursa": "excel_registru", "sursa_id": "R1", "valori_originale": {"titlu": "Raport A"}, "cod_scris": "43-AAA-TM1-COR-00050", "emitent": "AAA",
                  "tematica": "TM1", "tip": "COR", "secventa": 50, "revizie": 0},
                 {"sursa": "mail_trimis", "sursa_id": "M1", "valori_originale": {"subiect": "Raport B"}, "cod_scris": "43-AAA-TM1-COR-00050_rev.1", "emitent": "AAA",
                  "tematica": "TM1", "tip": "COR", "secventa": 50, "revizie": 1, "probleme": ["forma_nestandard", "dublura"]},
                 {"sursa": "excel_registru", "sursa_id": "R2", "valori_originale": {}, "cod_scris": "43-AAA-TM1-COR-00051", "emitent": "AAA", "tematica": "TM1",
                  "tip": "COR", "secventa": 51, "probleme": ["revizie_necunoscuta"]},
                 {"sursa": "excel_registru", "sursa_id": "R3", "valori_originale": {}, "cod_scris": "43-AAA-TM1-COR-00052_rev.2", "emitent": "AAA", "tematica": "TM1",
                  "tip": "COR", "secventa": 52, "revizie": 2, "probleme": ["forma_nestandard"]},
                 {"sursa": "mail_trimis", "sursa_id": "M2", "valori_originale": {"subiect": "fara cod"}},
                 {"sursa": "excel_registru", "sursa_id": "R1", "pozitie": 2, "valori_originale": {}, "cod_scris": "43-AAA-TM1-COR-00060", "emitent": "AAA",
                  "tematica": "TM1", "tip": "COR", "secventa": 60, "revizie": 0}]';
  baza jsonb := '{"sursa": "excel_registru", "sursa_id": "X1", "valori_originale": {}}';
BEGIN
  c := pg_temp.t_contract('BEN', '43', 'automat');
  p1 := pg_temp.t_proiect(1, c, pg_temp.t_g('g1')::bigint);
  p2 := pg_temp.t_proiect(2, c, pg_temp.t_g('g1')::bigint);
  a := pg_temp.t_ca_ok(adm, 'primul import', pg_temp.q_import(p1, ist, k => k1));
  PERFORM pg_temp.t_eq('primul import', a, '{"inserate": 6, "identice": 0, "diferite": [], "total": 6, "reluat": false}');
  b := pg_temp.t_ca_ok(adm, 'acelasi lot, alta cheie', pg_temp.q_import(p1, ist));
  PERFORM pg_temp.t_eq('al doilea import', b, '{"inserate": 0, "identice": 6, "diferite": [], "total": 6, "reluat": false}');
  PERFORM pg_temp.t_eq('tot 6 randuri (nicio dublura)', to_jsonb(pg_temp.t_n(format('SELECT count(*) FROM public.dcc_istoric_aparitii WHERE proiect_dcc_id = %s', p1))), '6');
  d := pg_temp.t_ca_ok(adm, 'un rand cu alt continut', pg_temp.q_import(p1, (SELECT jsonb_agg(CASE WHEN x ->> 'sursa_id' = 'R1' AND NOT x ? 'pozitie'
    THEN jsonb_set(x, '{valori_originale}', '{"titlu": "Raport A modificat"}') ELSE x END ORDER BY o) FROM jsonb_array_elements(ist) WITH ORDINALITY z(x, o))));
  PERFORM pg_temp.t_eq('randul diferit listat', d, '{"inserate": 0, "identice": 5, "diferite": [{"sursa": "excel_registru", "sursa_id": "R1", "pozitie": 1}], "total": 6, "reluat": false}');
  PERFORM pg_temp.t_eq('randul vechi neschimbat', (SELECT valori_originale FROM public.dcc_istoric_aparitii WHERE proiect_dcc_id = p1 AND sursa_id = 'R1' AND pozitie = 1),
    '{"titlu": "Raport A"}');
  PERFORM pg_temp.t_eq('revizia absenta = NULL', (SELECT jsonb_build_object('revizie', revizie, 'probleme', probleme) FROM public.dcc_istoric_aparitii
    WHERE proiect_dcc_id = p1 AND sursa_id = 'R2'), '{"revizie": null, "probleme": ["revizie_necunoscuta"]}');
  r := pg_temp.t_ca_ok(adm, 'aceeasi cheie, acelasi lot in alta ordine', pg_temp.q_import(p1, (SELECT jsonb_agg(x ORDER BY o DESC) FROM jsonb_array_elements(ist)
    WITH ORDINALITY z(x, o)), k => k1));
  PERFORM pg_temp.t_eq('reluat: true', r, a || '{"reluat": true}');
  PERFORM pg_temp.t_sonda('UPDATE direct pe cod_scris', ARRAY[format('UPDATE public.dcc_istoric_aparitii SET cod_scris = ''altul'' WHERE proiect_dcc_id = %s AND sursa_id = ''R2''',
    p1)], false, 'P0001', 'DCC_ISTORIC_IMUABIL');
  -- pragul seriei față de maximul istoric al CONTRACTULUI (60): refuz fără accept; cu accept, maximul salvat
  PERFORM pg_temp.t_ca_refuz(adm, 'prag sub maximul istoric', pg_temp.q_init(p1, 'TM1', 'COR', 'general', 44), 'P0001', 'DCC_PRAG_SUB_ISTORIC', NULL, '(60)');
  s := pg_temp.t_ca_ok(adm, 'prag sub istoric acceptat explicit', pg_temp.q_init(p1, 'TM1', 'COR', 'general', 44, true));
  PERFORM pg_temp.t_eq('max_istoric', s -> 'max_istoric', '60');
  PERFORM pg_temp.t_eq('max_istoric_la_init salvat', to_jsonb((SELECT max_istoric_la_init FROM public.dcc_serii WHERE id = (s ->> 'serie_id')::bigint)), '60');
  -- maximul unui ALT proiect al aceluiași contract contează, fără ca rândurile lui să fie vizibile
  PERFORM pg_temp.t_ca_ok(adm, 'import pe P2', pg_temp.q_import(p2, '[{"sursa": "excel_registru", "sursa_id": "P2-1", "valori_originale": {}, "cod_scris": "43-AAA-TM1-DES-00080",
    "emitent": "AAA", "tematica": "TM1", "tip": "DES", "secventa": 80, "revizie": 0}]'));
  PERFORM pg_temp.t_ca_refuz(adm, 'prag sub maximul istoric al altui proiect', pg_temp.q_init(p1, 'TM1', 'DES', 'general', 10), 'P0001', 'DCC_PRAG_SUB_ISTORIC', NULL, '(80)');
  PERFORM pg_temp.t_eq('L1 nu vede istoricul P2', to_jsonb(pg_temp.t_ca_n(pg_temp.t_u('L1'), format('SELECT count(*) FROM public.dcc_istoric_aparitii
    WHERE contract_id = %s AND proiect_dcc_id <> %s', c, p1))), '0');
  PERFORM pg_temp.t_eq('L1 vede istoricul P1 (contra-proba)', to_jsonb(pg_temp.t_ca_n(pg_temp.t_u('L1'), format('SELECT count(*) FROM public.dcc_istoric_aparitii
    WHERE proiect_dcc_id = %s', p1))), '6');
  PERFORM pg_temp.t_ca_refuz(pg_temp.t_u('ED'), 'editorul nu importa', pg_temp.q_import(p1, ist), '42501', 'DCC_FARA_DREPT');
  -- cheile de legare / proveniență / amprentă le pune serverul: refuz pe tot lotul, nimic scris
  FOREACH ch IN ARRAY ARRAY['document_id', 'revizie_id', 'continut_hash', 'importat_prin', 'lot_import', 'proiect_dcc_id', 'cheie_necunoscuta'] LOOP
    PERFORM pg_temp.t_ca_refuz(adm, 'cheia refuzata ' || ch, pg_temp.q_import(p1, jsonb_build_array(baza, baza || jsonb_build_object('sursa_id', 'X2', ch, 1))), '22023',
      'DCC_CHEI_NECUNOSCUTE');
  END LOOP;
  PERFORM pg_temp.t_ca_refuz(adm, 'aceeasi identitate in lot', pg_temp.q_import(p1, jsonb_build_array(baza, baza || '{"valori_originale": {"alt": 1}}')), '22023', 'DCC_LOT_DUBLURI');
  PERFORM pg_temp.t_eq('nimic scris la refuzuri', to_jsonb(pg_temp.t_n(format('SELECT count(*) FROM public.dcc_istoric_aparitii WHERE proiect_dcc_id = %s AND sursa_id LIKE ''X%%''',
    p1))), '0');
  -- calea serverului importă (proveniența: server, fără autor)
  PERFORM pg_temp.t_ca_ok(NULL, 'calea serverului importa', pg_temp.q_import(p1, '[{"sursa": "mail_primit", "sursa_id": "S1", "valori_originale": {}}]'));
  PERFORM pg_temp.t_eq('provenienta pe calea serverului', (SELECT jsonb_build_object('importat_prin', importat_prin, 'importat_de', importat_de) FROM public.dcc_istoric_aparitii
    WHERE proiect_dcc_id = p1 AND sursa_id = 'S1'), '{"importat_prin": "server", "importat_de": null}');
  RAISE NOTICE 't_p5_import ok';
END $t$;

-- ── t_p6_confirma — proba 6 ───────────────────────────────────────────────────────────────────────────────────────────────────────
DO $t$
DECLARE ed uuid := pg_temp.t_u('ED'); c bigint; p bigint; d jsonb; rev bigint; r jsonb; mid bigint;
BEGIN
  c := pg_temp.t_contract('BEN', '44', 'automat');
  p := pg_temp.t_proiect(1, c, pg_temp.t_g('g1')::bigint);
  PERFORM pg_temp.t_ca_ok(pg_temp.t_u('ADM'), 'initializare', pg_temp.q_init(p, 'TM1', 'COR', 'general', 44));
  d := pg_temp.t_ca_ok(ed, 'alocare', pg_temp.q_aloca(p, 'TM1', 'COR', 'general'));
  rev := (d #>> '{revizii,0,revizie_id}')::bigint;
  PERFORM pg_temp.t_eq('nicio casuta conectata', to_jsonb(pg_temp.t_n('SELECT count(*) FROM public.dcc_casute')), '0');
  PERFORM pg_temp.t_ca_refuz(ed, 'casuta declarata goala', pg_temp.q_confirma(ARRAY[rev], casuta => '  '), '22023', 'DCC_PARAMETRU_INVALID');
  PERFORM pg_temp.t_ca_refuz(ed, 'data in viitor', pg_temp.q_confirma(ARRAY[rev], la => 'now() + interval ''1 hour'''), '22023', 'DCC_PARAMETRU_INVALID');
  r := pg_temp.t_ca_ok(ed, 'confirm ca am trimis', pg_temp.q_confirma(ARRAY[rev], subiect => ' 44-AAA-TM1-COR-00045.Rev0.RO Raport '));
  mid := (r ->> 'mesaj_id')::bigint;
  PERFORM pg_temp.t_eq('rezultatul confirmarii', (r - 'mesaj_id' - 'legaturi') || jsonb_build_object('mesaj_id', jsonb_typeof(r -> 'mesaj_id'), 'legaturi',
    jsonb_array_length(r -> 'legaturi')), jsonb_build_object('mesaj_id', 'number', 'legaturi', 1, 'reluat', false, 'revizii',
    jsonb_build_array(jsonb_build_object('revizie_id', rev, 'stare_anterioara', 'rezervata', 'stare', 'trimisa_manual_neverificata'))));
  PERFORM pg_temp.t_eq('mesajul manual fara ID-uri inventate', (SELECT jsonb_build_object('rfc_message_id', rfc_message_id, 'gmail_message_id', gmail_message_id,
    'gmail_thread_id', gmail_thread_id, 'casuta_id', casuta_id, 'dovezi_complete', dovezi_complete, 'casuta_declarata', casuta_declarata, 'sursa', sursa,
    'directie', directie, 'subiect_original', subiect_original) FROM public.dcc_mesaje WHERE id = mid),
    '{"rfc_message_id": null, "gmail_message_id": null, "gmail_thread_id": null, "casuta_id": null, "dovezi_complete": false, "casuta_declarata": "eu@exemplu.invalid",
      "sursa": "manual_declarat", "directie": "trimis", "subiect_original": "44-AAA-TM1-COR-00045.Rev0.RO Raport"}');
  PERFORM pg_temp.t_eq('legatura manuala confirmata', (SELECT jsonb_agg(jsonb_build_object('metoda', metoda, 'stare', stare, 'confirmat_de', confirmat_de))
    FROM public.dcc_legaturi WHERE mesaj_id = mid), jsonb_build_array(jsonb_build_object('metoda', 'manual', 'stare', 'confirmata', 'confirmat_de', ed)));
  PERFORM pg_temp.t_eq('starea neverificat', to_jsonb((SELECT stare_transport FROM public.dcc_revizii WHERE id = rev)), '"trimisa_manual_neverificata"');
  PERFORM pg_temp.t_ca_refuz(ed, 'a doua confirmare (alta cheie)', pg_temp.q_confirma(ARRAY[rev]), 'P0001', 'DCC_TRANZITIE_NEPERMISA');
  PERFORM pg_temp.t_sonda('Message-ID pus direct pe mesajul manual', ARRAY[format('UPDATE public.dcc_mesaje SET rfc_message_id = ''<x@exemplu.invalid>'' WHERE id = %s', mid)],
    false, 'P0001', 'DCC_MESAJ_IMUABIL');
  PERFORM pg_temp.t_sonda('acelasi UPDATE fara triggere (CHECK-ul)', ARRAY[format('UPDATE public.dcc_mesaje SET rfc_message_id = ''<x@exemplu.invalid>'' WHERE id = %s', mid)],
    true, '23514', NULL, 'dcc_mesaje_manual_ck');
  PERFORM pg_temp.t_sonda('UPDATE pe subiect fara triggere (contra-proba)', ARRAY[format('UPDATE public.dcc_mesaje SET subiect_original = ''alt'' WHERE id = %s', mid)], true);
  PERFORM pg_temp.t_sonda('neverificata -> confirmata fara dovada', ARRAY[format('UPDATE public.dcc_revizii SET stare_transport = ''trimisa_manual_confirmata'' WHERE id = %s',
    rev)], false, 'P0001', 'DCC_TRANZITIE_NEPERMISA');
  PERFORM pg_temp.t_ca_refuz(pg_temp.t_u('VIEW'), 'viewer nu confirma', pg_temp.q_confirma(ARRAY[rev]), '42501', 'DCC_FARA_DREPT');
  RAISE NOTICE 't_p6_confirma ok';
END $t$;

-- ── t_p7_acces — proba 7: acces doar pe Lot 1 (P1, contractul 45) -> nimic pe Lot 2 (P3, contractul 46) ───────────────────────────────
DO $t$
DECLARE own uuid := pg_temp.t_u('OWNER'); ed uuid := pg_temp.t_u('ED'); l1 uuid := pg_temp.t_u('L1'); ex uuid := pg_temp.t_u('EXEC');
  c1 bigint; c3 bigint; p1 bigint; p3 bigint; p bigint; d jsonb; ax jsonb; s jsonb; v_doc bigint; v_fila bigint; v_rev bigint; v_snap bigint;
  t text; q text; col text; cont uuid; v_u uuid; v_c text; v_b boolean; inex text[]; e text[]; n bigint; apeluri text[]; directe text[];
  peproiect jsonb := '{"dcc_documente": "proiect_dcc_id", "dcc_istoric_aparitii": "proiect_dcc_id", "dcc_snapshoturi": "proiect_dcc_id", "dcc_mesaje": "proiect_dcc_id",
                       "dcc_proiecte": "id", "v_dcc_registru": "proiect_dcc_id"}';
  citite text[] := ARRAY['dcc_ghiduri', 'dcc_ghid_valori', 'dcc_ghid_intervale', 'dcc_contracte', 'dcc_proiecte', 'dcc_documente', 'dcc_file', 'dcc_anexe', 'dcc_revizii',
                         'dcc_istoric_aparitii', 'dcc_snapshoturi', 'dcc_snapshot_revizii', 'dcc_mesaje', 'dcc_legaturi', 'v_dcc_registru'];
BEGIN
  c1 := pg_temp.t_contract('BEN', '45', 'automat');
  c3 := pg_temp.t_contract('BEN', '46', 'automat');
  p1 := pg_temp.t_proiect(1, c1, pg_temp.t_g('g1')::bigint);
  p3 := pg_temp.t_proiect(3, c3, pg_temp.t_g('g1')::bigint);
  FOREACH p IN ARRAY ARRAY[p1, p3] LOOP
    PERFORM pg_temp.t_ca_ok(own, 'serie ' || p, pg_temp.q_init(p, 'TM1', 'DES', 'general', 0));
    d := pg_temp.t_ca_ok(ed, 'doc ' || p, pg_temp.q_aloca(p, 'TM1', 'DES', 'general', nrf => 1));
    ax := pg_temp.t_ca_ok(ed, 'anexa ' || p, pg_temp.q_anexa((d ->> 'document_id')::bigint));
    PERFORM pg_temp.t_ca_ok(pg_temp.t_u('ADM'), 'istoric ' || p, pg_temp.q_import(p, jsonb_build_array(jsonb_build_object('sursa', 'excel_registru', 'sursa_id', 'H' || p,
      'valori_originale', '{}'::jsonb))));
    s := pg_temp.t_ca_ok(ed, 'copiat ' || p, pg_temp.q_copiat(ARRAY[(ax ->> 'revizie_id')::bigint], pg_temp.t_snap('{"cc": []}')));
    PERFORM pg_temp.t_ca_ok(ed, 'confirmat ' || p, pg_temp.q_confirma(ARRAY[(ax ->> 'revizie_id')::bigint], snap => (s ->> 'snapshot_id')::bigint));
    IF p = p3 THEN
      v_doc := (d ->> 'document_id')::bigint; v_fila := (d #>> '{revizii,0,revizie_id}')::bigint; v_rev := (ax ->> 'revizie_id')::bigint; v_snap := (s ->> 'snapshot_id')::bigint;
    END IF;
  END LOOP;
  -- identitatea la fiecare cont: auth.uid() din ambele surse JWT, rolul authenticated, fără BYPASSRLS
  FOREACH cont IN ARRAY ARRAY[l1, ex, own] LOOP
    PERFORM pg_temp.t_ca(cont, 'authenticated');
    SELECT auth.uid(), current_user::text, (SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user) INTO v_u, v_c, v_b;
    PERFORM pg_temp.t_ca(NULL, 'postgres');
    PERFORM pg_temp.t_eq('identitatea ' || cont, jsonb_build_array(v_u, v_c, v_b), jsonb_build_array(cont, 'authenticated', false));
  END LOOP;
  FOREACH t IN ARRAY citite LOOP
    IF peproiect ? t THEN
      PERFORM pg_temp.t_eq('L1 nu vede P3 in ' || t, to_jsonb(pg_temp.t_ca_n(l1, format('SELECT count(*) FROM public.%I WHERE %I = %s', t, peproiect ->> t, p3))), '0');
    END IF;
    PERFORM pg_temp.t_eq('EXEC (doar executie admin) ' || t, to_jsonb(pg_temp.t_ca_n(ex, format('SELECT count(*) FROM public.%I', t))), '0');
  END LOOP;
  PERFORM pg_temp.t_eq('L1 nu vede contractul P3', to_jsonb(pg_temp.t_ca_n(l1, format('SELECT count(*) FROM public.dcc_contracte WHERE id = %s', c3))), '0');
  FOREACH t IN ARRAY ARRAY['dcc_file', 'dcc_anexe', 'dcc_revizii'] LOOP
    PERFORM pg_temp.t_eq('L1 nu vede P3 in ' || t, to_jsonb(pg_temp.t_ca_n(l1, format('SELECT count(*) FROM public.%I WHERE document_id = %s', t, v_doc))), '0');
  END LOOP;
  PERFORM pg_temp.t_eq('L1 nu vede legaturile P3', jsonb_build_array(pg_temp.t_ca_n(l1, format('SELECT count(*) FROM public.dcc_legaturi WHERE revizie_id = %s', v_rev)),
    pg_temp.t_ca_n(l1, format('SELECT count(*) FROM public.dcc_snapshot_revizii WHERE snapshot_id = %s', v_snap))), '[0, 0]');
  FOREACH t IN ARRAY ARRAY['dcc_documente', 'dcc_file', 'dcc_anexe', 'dcc_revizii', 'dcc_istoric_aparitii', 'dcc_snapshoturi', 'dcc_mesaje', 'dcc_legaturi',
                           'dcc_snapshot_revizii', 'v_dcc_registru'] LOOP
    PERFORM pg_temp.t_da('L1 vede randurile P1 in ' || t || ' (contra-proba)', pg_temp.t_ca_n(l1, format('SELECT count(*) FROM public.%I', t)) > 0);
    PERFORM pg_temp.t_da('owner vede ambele proiecte in ' || t, pg_temp.t_ca_n(own, format('SELECT count(*) FROM public.%I', t)) >= 2);
  END LOOP;
  -- RPC-urile pe P3: 42501 cu ACELAȘI mesaj ca pe un id inexistent; EXEC 42501; anon fără EXECUTE
  inex := pg_temp.t_ca_err(l1, 'revizie pe id inexistent', pg_temp.q_rev((SELECT max(id) FROM public.dcc_documente) + 1000000));
  apeluri := ARRAY[format('SELECT * FROM public.fn_dcc_serii_proiect(%s)', p3), pg_temp.q_aloca(p3, 'TM1', 'DES', 'general', 'x'), pg_temp.q_rev(v_doc),
    pg_temp.q_fila(v_doc, 5), pg_temp.q_anexa(v_doc, 'x'), pg_temp.q_anul(v_doc, NULL, 'x'), pg_temp.q_copiat(ARRAY[v_rev], pg_temp.t_snap('{"cc": []}')),
    pg_temp.q_confirma(ARRAY[v_fila]), pg_temp.q_import(p3, '[{"sursa": "mail_trimis", "sursa_id": "X", "valori_originale": {}}]', 'lot2')];
  FOREACH q IN ARRAY apeluri LOOP
    e := pg_temp.t_ca_err(l1, 'L1 pe P3', q);
    PERFORM pg_temp.t_eq('L1 pe P3: ' || left(q, 60), jsonb_build_array(e[1], e[2]), jsonb_build_array('42501', inex[2]));
    e := pg_temp.t_ca_err(ex, 'EXEC pe P3', q);
    PERFORM pg_temp.t_eq('EXEC pe P3: ' || left(q, 60), to_jsonb(e[1]), '"42501"');
    PERFORM pg_temp.t_ca(NULL, 'anon');
    PERFORM pg_temp.t_refuz('anon: ' || left(q, 60), q, '42501', 'permission denied');
    PERFORM pg_temp.t_ca(NULL, 'postgres');
  END LOOP;
  PERFORM pg_temp.t_eq('mesajul refuzului', to_jsonb(inex[2]), '"DCC_FARA_DREPT: operatia nu e permisa"');
  -- scrierile directe: INSERT / UPDATE / DELETE / TRUNCATE pe fiecare tabel -> 42501
  FOREACH t IN ARRAY ARRAY['dcc_casute', 'dcc_ghiduri', 'dcc_ghid_valori', 'dcc_ghid_intervale', 'dcc_contracte', 'dcc_proiecte', 'dcc_intentii', 'dcc_serii', 'dcc_documente',
                           'dcc_file', 'dcc_anexe', 'dcc_revizii', 'dcc_istoric_aparitii', 'dcc_snapshoturi', 'dcc_snapshot_revizii', 'dcc_mesaje', 'dcc_legaturi'] LOOP
    col := CASE t WHEN 'dcc_intentii' THEN 'cheie' WHEN 'dcc_snapshot_revizii' THEN 'snapshot_id' ELSE 'id' END;
    directe := ARRAY[format('INSERT INTO public.%I DEFAULT VALUES', t), format('UPDATE public.%I SET %I = %I', t, col, col), format('DELETE FROM public.%I', t),
                     format('TRUNCATE public.%I', t)];
    FOREACH q IN ARRAY directe LOOP
      PERFORM pg_temp.t_ca_refuz(l1, 'L1 direct: ' || q, q, '42501');
    END LOOP;
  END LOOP;
  RAISE NOTICE 't_p7_acces ok';
END $t$;

-- ── t_p7b_acelasi_contract — CE1: P1 (E7) și P2 (E8) pe același contract; L7 restrâns pe E7 ──────────────────────────────────────────
DO $t$
DECLARE own uuid := pg_temp.t_u('OWNER'); ed uuid := pg_temp.t_u('ED'); l7 uuid := pg_temp.t_u('L7'); adm uuid := pg_temp.t_u('ADM');
  c bigint; p1 bigint; p2 bigint; cm bigint; p6 bigint; p4 bigint; d1 jsonb; d2 jsonb; d3 jsonb; s jsonb; urm jsonb; im jsonb; e1 text[]; e2 text[]; m text[];
  x record; asteptat jsonb := '{"dcc_documente": 2, "dcc_file": 2, "dcc_anexe": 1, "dcc_revizii": 5, "dcc_istoric_aparitii": 2, "dcc_mesaje": 1, "dcc_snapshoturi": 1,
                                "dcc_snapshot_revizii": 1, "dcc_legaturi": 1, "v_dcc_registru": 4, "dcc_proiecte": 1, "dcc_contracte": 1}';
BEGIN
  c := pg_temp.t_contract('BEN', '47', 'automat');
  p1 := pg_temp.t_proiect(7, c, pg_temp.t_g('g1')::bigint);
  p2 := pg_temp.t_proiect(8, c, pg_temp.t_g('g1')::bigint);
  PERFORM pg_temp.t_ca_ok(own, 'serie COR', pg_temp.q_init(p1, 'TM1', 'COR', 'general', 44));
  PERFORM pg_temp.t_ca_ok(own, 'serie DES', pg_temp.q_init(p1, 'TM1', 'DES', 'general', 0));
  -- P1: D1 (COR, Rev0 + Rev1, anexă), D2 (DES cu 2 file); P2: D3 (COR)
  d1 := pg_temp.t_ca_ok(l7, 'D1', pg_temp.q_aloca(p1, 'TM1', 'COR', 'general', 'Raport P1'));
  d3 := pg_temp.t_ca_ok(ed, 'D3 pe P2', pg_temp.q_aloca(p2, 'TM1', 'COR', 'general', 'Raport secret P2'));
  d2 := pg_temp.t_ca_ok(l7, 'D2', pg_temp.q_aloca(p1, 'TM1', 'DES', 'general', nrf => 2));
  PERFORM pg_temp.t_ca_ok(l7, 'anexa D1', pg_temp.q_anexa((d1 ->> 'document_id')::bigint));
  PERFORM pg_temp.t_ca_ok(l7, 'Rev1 D1', pg_temp.q_rev((d1 ->> 'document_id')::bigint));
  s := pg_temp.t_ca_ok(l7, 'copiat P1', pg_temp.q_copiat(ARRAY[(d1 #>> '{revizii,0,revizie_id}')::bigint], pg_temp.t_snap('{"cc": []}')));
  PERFORM pg_temp.t_ca_ok(l7, 'confirmat P1', pg_temp.q_confirma(ARRAY[(d1 #>> '{revizii,0,revizie_id}')::bigint], snap => (s ->> 'snapshot_id')::bigint));
  s := pg_temp.t_ca_ok(ed, 'copiat P2', pg_temp.q_copiat(ARRAY[(d3 #>> '{revizii,0,revizie_id}')::bigint], pg_temp.t_snap('{"cc": []}')));
  PERFORM pg_temp.t_ca_ok(ed, 'confirmat P2', pg_temp.q_confirma(ARRAY[(d3 #>> '{revizii,0,revizie_id}')::bigint], snap => (s ->> 'snapshot_id')::bigint));
  PERFORM pg_temp.t_ca_ok(adm, 'istoric P1', pg_temp.q_import(p1, '[{"sursa": "excel_registru", "sursa_id": "H1", "valori_originale": {}},
    {"sursa": "excel_registru", "sursa_id": "H2", "valori_originale": {}}]'));
  PERFORM pg_temp.t_ca_ok(adm, 'istoric P2', pg_temp.q_import(p2, '[{"sursa": "excel_registru", "sursa_id": "H-P2", "valori_originale": {}}]'));
  -- ca L7 (doar P1): EXACT rândurile P1, numărate de mână
  FOR x IN SELECT key AS t, value AS n FROM jsonb_each(asteptat) LOOP
    PERFORM pg_temp.t_eq('L7 ' || x.t, to_jsonb(pg_temp.t_ca_n(l7, format('SELECT count(*) FROM public.%I', x.t))), x.n);
  END LOOP;
  PERFORM pg_temp.t_eq('L7 vede doar contractul propriu', to_jsonb(pg_temp.t_ca_ok(l7, 'contractele vizibile',
    'SELECT jsonb_agg(beneficiar || ''/'' || cod_contract) FROM public.dcc_contracte')), '["BEN/47"]');
  PERFORM pg_temp.t_eq('seria comuna include alocarea P2 (divulgarea declarata)', pg_temp.t_ca_ok(l7, 'seriile P1',
    format('SELECT jsonb_agg(jsonb_build_object(''tip'', tip, ''ultimul_ocupat'', ultimul_ocupat) ORDER BY tip) FROM public.fn_dcc_serii_proiect(%s)', p1)),
    '[{"tip": "COR", "ultimul_ocupat": 46}, {"tip": "DES", "ultimul_ocupat": 1}]');
  urm := pg_temp.t_ca_ok(l7, 'alocarea P1 dupa P2', pg_temp.q_aloca(p1, 'TM1', 'COR', 'general'));
  PERFORM pg_temp.t_eq('numarul urmator corect', urm -> 'secventa', '47');
  e1 := pg_temp.t_ca_err(l7, 'revizie pe id inexistent', pg_temp.q_rev((SELECT max(id) FROM public.dcc_documente) + 1000000));
  e2 := pg_temp.t_ca_err(l7, 'revizie pe documentul P2', pg_temp.q_rev((d3 ->> 'document_id')::bigint));
  PERFORM pg_temp.t_eq('revizie pe documentul P2 = inexistent', jsonb_build_array(e2[1], e2[2]), jsonb_build_array('42501', e1[2]));
  -- aceeași identitate de sursă ca un rând P2 -> inserat pe P1 (fără oracol pe istoricul P2)
  im := pg_temp.t_ca_ok(adm, 'import pe P1 cu identitatea unui rand P2', pg_temp.q_import(p1, '[{"sursa": "excel_registru", "sursa_id": "H-P2", "valori_originale": {}}]', 'lot2'));
  PERFORM pg_temp.t_eq('inserate 1, nu identice', jsonb_build_array(im -> 'inserate', im -> 'identice'), '[1, 0]');
  -- contractul manual paralel: P6 (E7, vizibil pentru L7) și P4 (E8); numărul ocupat de P4 -> DCC_COD_OCUPAT fără date ale ocupantului
  cm := pg_temp.t_contract('BEN', '48', 'manual');
  p6 := pg_temp.t_proiect(7, cm, pg_temp.t_g('g1')::bigint);
  p4 := pg_temp.t_proiect(8, cm, pg_temp.t_g('g1')::bigint);
  PERFORM pg_temp.t_ca_ok(ed, 'manual 7 pe P4', pg_temp.q_manual(p4, 'TM1', 'COR', 7, 'Titlu ocupant secret'));
  m := pg_temp.t_ca_err(l7, 'manual 7 pe P6', pg_temp.q_manual(p6, 'TM1', 'COR', 7));
  PERFORM pg_temp.t_eq('manual 7 pe P6 (ocupat de P4): mesajul fix', jsonb_build_array(m[1], m[2]), '["23505", "DCC_COD_OCUPAT: codul e deja folosit pe contract"]');
  PERFORM pg_temp.t_da('mesajul fara cifre si fara titlul ocupantului', m[2] !~ '[0-9]' AND position('Titlu ocupant' IN m[2]) = 0);
  RAISE NOTICE 't_p7b_acelasi_contract ok';
END $t$;

-- ── t_p8_contract_comun_b1 — proba 8 ──────────────────────────────────────────────────────────────────────────────────────────────
DO $t$
DECLARE ed uuid := pg_temp.t_u('ED'); c bigint; p1 bigint; p2 bigint; sv jsonb := '[]'::jsonb; p bigint;
BEGIN
  c := pg_temp.t_contract('BEN', '49', 'automat');
  p1 := pg_temp.t_proiect(1, c, pg_temp.t_g('g1')::bigint);
  p2 := pg_temp.t_proiect(2, c, pg_temp.t_g('g1')::bigint);
  PERFORM pg_temp.t_ca_ok(pg_temp.t_u('ADM'), 'initializare', pg_temp.q_init(p1, 'TM1', 'COR', 'general', 44));
  FOREACH p IN ARRAY ARRAY[p1, p2, p1] LOOP
    sv := sv || (pg_temp.t_ca_ok(ed, 'alocare din ' || p, pg_temp.q_aloca(p, 'TM1', 'COR', 'general')) -> 'secventa');
  END LOOP;
  PERFORM pg_temp.t_eq('secventele alternate', sv, '[45, 46, 47]');
  PERFORM pg_temp.t_sonda('documentul 46 scris direct pe P2', ARRAY[format('INSERT INTO public.dcc_documente (contract_id, proiect_dcc_id, emitent, tematica, tip, secventa,
    interval, serie_id, mod, titlu, are_file, creat_de) SELECT contract_id, %s, emitent, tematica, tip, 46, interval, serie_id, ''automat'', ''dublura'', false, %L
    FROM public.dcc_documente WHERE contract_id = %s AND secventa = 46', p2, ed, c)], false, '23505', NULL, 'dcc_documente_cod_uq');
  RAISE NOTICE 't_p8_contract_comun_b1 ok';
END $t$;

-- ── t_p8_contract_comun_b2 — CE3: BEN/50 și ALT/50 produc același text, fiecare contract cu documentul lui ─────────────────────────────
DO $t$
DECLARE ed uuid := pg_temp.t_u('ED'); adm uuid := pg_temp.t_u('ADM'); cb bigint; ca bigint; pb bigint; pa bigint; a jsonb; b jsonb;
BEGIN
  cb := pg_temp.t_contract('BEN', '50', 'automat');
  ca := pg_temp.t_contract('ALT', '50', 'automat');
  pb := pg_temp.t_proiect(1, cb, pg_temp.t_g('g1')::bigint);
  pa := pg_temp.t_proiect(5, ca, pg_temp.t_g('g1')::bigint);
  PERFORM pg_temp.t_ca_ok(adm, 'BEN/50', pg_temp.q_init(pb, 'TM1', 'COR', 'general', 44));
  PERFORM pg_temp.t_ca_ok(adm, 'ALT/50', pg_temp.q_init(pa, 'TM1', 'COR', 'general', 44));
  a := pg_temp.t_ca_ok(ed, 'alocarea BEN/50', pg_temp.q_aloca(pb, 'TM1', 'COR', 'general'));
  b := pg_temp.t_ca_ok(ed, 'alocarea ALT/50', pg_temp.q_aloca(pa, 'TM1', 'COR', 'general'));
  PERFORM pg_temp.t_eq('acelasi text pe contracte diferite', jsonb_build_array(a #> '{revizii,0,cod_text}', b #> '{revizii,0,cod_text}'),
    '["50-AAA-TM1-COR-00045.Rev0.RO", "50-AAA-TM1-COR-00045.Rev0.RO"]');
  PERFORM pg_temp.t_eq('un document pe contract', jsonb_build_array(pg_temp.t_n(format('SELECT count(*) FROM public.dcc_documente WHERE contract_id = %s', cb)),
    pg_temp.t_n(format('SELECT count(*) FROM public.dcc_documente WHERE contract_id = %s', ca))), '[1, 1]');
  RAISE NOTICE 't_p8_contract_comun_b2 ok';
END $t$;

-- ── t_d5_identitati — CE7: matricea [D5]; session_user / current_user / auth.uid() verificate la fiecare pas ──────────────────────────
DO $t$
DECLARE own uuid := pg_temp.t_u('OWNER'); ed uuid := pg_temp.t_u('ED'); k uuid := pg_temp.t_kn(); r jsonb; v jsonb; c1 bigint; n bigint; rol text;
BEGIN
  -- 1. psql ca postgres, fără JWT = calea serverului: configurarea merge (actor server), alocarea / anularea -> DCC_NEAUTENTIFICAT
  PERFORM pg_temp.t_eq('identitatea 1 (psql ca postgres)', jsonb_build_array(session_user, current_user, auth.uid()), '["postgres", "postgres", null]');
  r := pg_temp.t_ok('server: contract', pg_temp.q_contract('BEN', '60', 'automat', k));
  c1 := (r ->> 'contract_id')::bigint;
  PERFORM pg_temp.t_eq('provenienta pe calea serverului', jsonb_build_array(
    (SELECT jsonb_build_object('actor', actor, 'autor', autor) FROM public.dcc_intentii WHERE cheie = k),
    (SELECT jsonb_build_object('creat_prin', creat_prin, 'creat_de', creat_de) FROM public.dcc_contracte WHERE id = c1)),
    '[{"actor": "server", "autor": null}, {"creat_prin": "server", "creat_de": null}]');
  PERFORM pg_temp.t_refuz('server: alocare', pg_temp.q_aloca(999999999, 'TM1', 'COR', 'general', 'x'), '42501', 'DCC_NEAUTENTIFICAT');
  PERFORM pg_temp.t_refuz('server: anulare', pg_temp.q_anul(999999999, NULL, 'x'), '42501', 'DCC_NEAUTENTIFICAT');
  -- 2 / 4. API anon / service_role (session_user = authenticator): fără EXECUTE pe nicio funcție fn_dcc_*
  EXECUTE 'SET SESSION AUTHORIZATION authenticator';
  FOREACH rol IN ARRAY ARRAY['anon', 'service_role'] LOOP
    EXECUTE format('SET ROLE %I', rol);
    PERFORM pg_temp.t_eq('identitatea API ' || rol, jsonb_build_array(session_user, current_user, auth.uid()), jsonb_build_array('authenticator', rol, NULL::uuid));
    PERFORM pg_temp.t_refuz(rol || ': contract', pg_temp.q_contract('BEN', '61', 'automat'), '42501', 'permission denied');
    PERFORM pg_temp.t_refuz(rol || ': alocare', pg_temp.q_aloca(999999999, 'TM1', 'COR', 'general', 'x'), '42501', 'permission denied');
  END LOOP;
  -- 3. API authenticated FĂRĂ sub: NU e calea serverului (session_user = authenticator) -> DCC_NEAUTENTIFICAT pe orice RPC
  EXECUTE 'SET ROLE authenticated';
  PERFORM pg_temp.t_eq('identitatea 3 (API fara sub)', jsonb_build_array(session_user, current_user, auth.uid()), '["authenticator", "authenticated", null]');
  PERFORM pg_temp.t_refuz('authenticated fara sub: contract', pg_temp.q_contract('BEN', '62', 'automat'), '42501', 'DCC_NEAUTENTIFICAT');
  PERFORM pg_temp.t_refuz('authenticated fara sub: alocare', pg_temp.q_aloca(999999999, 'TM1', 'COR', 'general', 'x'), '42501', 'DCC_NEAUTENTIFICAT');
  PERFORM pg_temp.t_refuz('authenticated fara sub: initializare', pg_temp.q_init(999999999, 'TM1', 'COR', 'general', 0, motiv => 'm'), '42501', 'DCC_NEAUTENTIFICAT');
  PERFORM pg_temp.t_refuz('authenticated fara sub: import', pg_temp.q_import(999999999, '[{"sursa": "mail_primit", "sursa_id": "S", "valori_originale": {}}]'), '42501',
    'DCC_NEAUTENTIFICAT');
  -- 5. API authenticated cu JWT-ul owner-ului: merge
  PERFORM set_config('request.jwt.claim.sub', own::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', own, 'role', 'authenticated')::text, true);
  PERFORM pg_temp.t_eq('identitatea 5 (API cu JWT)', jsonb_build_array(session_user, current_user, auth.uid()), jsonb_build_array('authenticator', 'authenticated', own));
  v := pg_temp.t_ok('authenticated cu JWT owner: contract', pg_temp.q_contract('BEN', '63', 'automat'));
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET SESSION AUTHORIZATION postgres';
  PERFORM pg_temp.t_eq('inapoi la postgres', jsonb_build_array(session_user, current_user, auth.uid()), '["postgres", "postgres", null]');
  -- citit ca postgres (contractul fără proiecte nu e vizibil prin RLS nici pentru owner)
  PERFORM pg_temp.t_eq('contractul prin API e al omului', (SELECT jsonb_build_object('creat_prin', creat_prin, 'creat_de', creat_de) FROM public.dcc_contracte
    WHERE id = (v ->> 'contract_id')::bigint), jsonb_build_object('creat_prin', 'om', 'creat_de', own));
  -- 6. sesiune postgres cu sub-ul unui editor = omul (NU calea serverului): nu e owner -> DCC_FARA_DREPT
  PERFORM set_config('request.jwt.claim.sub', ed::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', ed, 'role', 'authenticated')::text, true);
  PERFORM pg_temp.t_eq('identitatea 6 (postgres cu sub)', jsonb_build_array(session_user, current_user, auth.uid()), jsonb_build_array('postgres', 'postgres', ed));
  PERFORM pg_temp.t_refuz('postgres cu sub de editor: contract', pg_temp.q_contract('BEN', '64', 'automat'), '42501', 'DCC_FARA_DREPT');
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  PERFORM pg_temp.t_eq('identitatea la final', jsonb_build_array(session_user, current_user, auth.uid()), '["postgres", "postgres", null]');
  SELECT count(*) INTO n FROM public.dcc_contracte WHERE beneficiar = 'BEN' AND cod_contract IN ('60', '61', '62', '63', '64');
  PERFORM pg_temp.t_eq('contractele create (60 server, 63 owner prin API)', to_jsonb(n), '2');
  RAISE NOTICE 't_d5_identitati ok';
END $t$;
-- PGlite nu revine singur din SET SESSION AUTHORIZATION; pe PG real e inofensiv
SET SESSION AUTHORIZATION postgres;

-- ── t_regresie_rest_decontat — lanțul de drept neschimbat pe identitățile sintetice (valori scrise de mână) ────────────────────────────
DO $t$
DECLARE x record; v jsonb; v_na boolean := to_regprocedure('public.fn_rest_decontat_drept(bigint, text)') IS NULL;
BEGIN
  -- fn_executie_proiect_permis (20261209a): owner tot; L1 doar E1 (citire + scriere); L7 doar E7; nerestrânșii (ED, FARA) tot; fără JWT nimic
  FOR x IN SELECT * FROM (VALUES ('OWNER', 1, false, true), ('OWNER', 2, true, true), ('L1', 1, false, true), ('L1', 1, true, true), ('L1', 2, false, false),
                                 ('L7', 7, true, true), ('L7', 1, false, false), ('ED', 2, true, true), ('FARA', 3, false, true)) z(cont, e, scr, asteptat) LOOP
    v := pg_temp.t_ca_ok(pg_temp.t_u(x.cont), 'permis ' || x.cont, format('SELECT to_jsonb(public.fn_executie_proiect_permis(%s, %L::boolean))', pg_temp.t_e(x.e), x.scr));
    PERFORM pg_temp.t_eq('fn_executie_proiect_permis ' || x.cont || ' E' || x.e || ' scriere ' || x.scr, v, to_jsonb(x.asteptat));
  END LOOP;
  PERFORM pg_temp.t_ca(NULL, 'authenticated');
  v := pg_temp.t_ok('permis fara JWT', format('SELECT to_jsonb(public.fn_executie_proiect_permis(%s, false))', pg_temp.t_e(1)));
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  PERFORM pg_temp.t_eq('fn_executie_proiect_permis fara JWT', v, 'false');
  IF v_na THEN
    RAISE NOTICE 't_regresie_rest_decontat (n/a: fn_rest_decontat_drept lipseste, 20270105a neaplicata; fn_executie_proiect_permis verificat) ok';
    RETURN;
  END IF;
  -- fn_rest_decontat_drept (20270105a): owner da; conturile sintetice fără sub-modulul executie_rest_decontat și fără fișă de angajat nu
  FOR x IN SELECT * FROM (VALUES ('OWNER', 1, 'citire', true), ('OWNER', 2, 'confirmare', true), ('L1', 1, 'citire', false), ('ED', 1, 'citire', false),
                                 ('FARA', 3, 'citire', false)) z(cont, e, niv, asteptat) LOOP
    v := pg_temp.t_ca_ok(pg_temp.t_u(x.cont), 'rest ' || x.cont, format('SELECT to_jsonb(public.fn_rest_decontat_drept(%s, %L))', pg_temp.t_e(x.e), x.niv));
    PERFORM pg_temp.t_eq('fn_rest_decontat_drept ' || x.cont || ' E' || x.e || ' ' || x.niv, v, to_jsonb(x.asteptat));
  END LOOP;
  PERFORM pg_temp.t_ca(NULL, 'authenticated');
  v := pg_temp.t_ok('rest fara JWT', format('SELECT to_jsonb(public.fn_rest_decontat_drept(%s, %L))', pg_temp.t_e(1), 'citire'));
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  PERFORM pg_temp.t_eq('fn_rest_decontat_drept fara JWT', v, 'false');
  RAISE NOTICE 't_regresie_rest_decontat ok';
END $t$;

-- starea sesiunii la final (nu e un bloc t_*)
DO $fin$
BEGIN
  IF session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres' OR auth.uid() IS NOT NULL
     OR current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
    RAISE EXCEPTION 'FAIL final: sesiunea nu e inapoi la postgres / origin (% / % / % / %)', session_user, current_user, auth.uid(), current_setting('session_replication_role');
  END IF;
  RAISE NOTICE 'dry-run terminat: toate blocurile au trecut, urmeaza ROLLBACK';
END $fin$;
ROLLBACK;
