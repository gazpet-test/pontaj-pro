#!/usr/bin/env bash
# PG17 izolat. Nu foloseste PGURI, credentiale, dump-uri sau conexiuni externe.
set -Eeuo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
PORT="${PROBE_TEREN_TEST_PORT:-5994}"
NAME=20261114a_probe_teren
MIG="$ROOT/supabase/migrations/$NAME.sql"
REV="$ROOT/supabase/revenire/${NAME}_ROLLBACK.sql"
fail() { echo "FAIL: $*" >&2; exit 1; }
[[ "$PORT" =~ ^[0-9]+$ ]] || fail 'port numeric necesar'
[[ -x "$PG_BIN/initdb" ]] || { echo 'ENV: PostgreSQL 17 unavailable' >&2; exit 2; }
[[ "$(id -u)" != 0 ]] || { echo 'ENV: use unprivileged local OS user' >&2; exit 2; }
"$PG_BIN/postgres" --version | grep -Eq 'PostgreSQL\) 17\.' || fail 'requires PG17'
# Neutralizam orice configuratie libpq mostenita; fixture-ul foloseste exclusiv localhost.
unset PGURI PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE PGSYSCONFDIR PGOPTIONS PSQLRC PGTARGETSESSIONATTRS PGLOADBALANCEHOSTS
DIR="$(mktemp -d "$ROOT/.probe-teren-test.XXXXXXXX")"
export TMPDIR="$DIR" PGPASSFILE="$DIR/no-password-file"
cleanup() {
  if [[ -f "$DIR/data/postmaster.pid" ]]; then "$PG_BIN/pg_ctl" -D "$DIR/data" -m fast -w stop >"$DIR/stop.log" 2>&1 || true; fi
  echo "Artifacts: $DIR"
}
trap cleanup EXIT
"$PG_BIN/initdb" -D "$DIR/data" -U probe_bootstrap --auth=trust --encoding=UTF8 --locale=C.UTF-8 >"$DIR/init.log"
"$PG_BIN/pg_ctl" -D "$DIR/data" -l "$DIR/postgres.log" -w -t 30 start -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" >"$DIR/start.log"
ADMIN=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U probe_bootstrap -d postgres)
"${ADMIN[@]}" -c 'CREATE ROLE postgres LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
"${ADMIN[@]}" -c 'CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT authenticated,anon,service_role TO postgres'
"${ADMIN[@]}" -c 'CREATE DATABASE probe_teren_test OWNER postgres'
"${ADMIN[@]}" -d probe_teren_test -c 'GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO postgres'
P=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d probe_teren_test)
q() { "${P[@]}" -Atc "$1"; }
"${P[@]}" -f "$ROOT/scripts/test_probe_teren_fixture.sql" >"$DIR/fixture.log"
fingerprint() { q "SELECT md5(string_agg(row_to_json(c)::text,',' ORDER BY id)) FROM public.probe_calcule c"; }
BEFORE="$(fingerprint)"
if "${P[@]}" -f "$MIG" >"$DIR/guard.log" 2>&1; then fail 'unguarded migration accepted'; fi
grep -q 'pt_garda' "$DIR/guard.log" || fail 'wrong guard failure'
for OBJ in probe_exec_utilaje probe_log_utilaje probe_teren_operatii probe_teren_poze v_probe_raport probe_teren_drept probe_teren_norma probe_teren_bazin probe_teren_statii_externe probe_teren_oferta_guard probe_teren_referinta_exista probe_teren_poza probe_teren_bord probe_teren_scrie probe_teren_protejeaza fn_probe_porneste fn_probe_citire fn_probe_opreste_utilaj fn_probe_inchide fn_probe_completeaza_executie; do
  case "$OBJ" in
    probe_exec_utilaje|probe_log_utilaje|probe_teren_operatii|probe_teren_poze|v_probe_raport) PREP="CREATE TABLE public.$OBJ(sentinel integer)" ;;
    *) PREP="CREATE FUNCTION public.$OBJ(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'" ;;
  esac
  if "${P[@]}" --single-transaction -c 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED' -c "SELECT set_config('gazpet.livrare_migrare','20261114a_probe_teren:' || txid_current(),true)" -c "$PREP" -f "$MIG" >"$DIR/preflight-$OBJ.log" 2>&1; then fail "preflight accepted $OBJ"; fi
  grep -q 'pt_preflight' "$DIR/preflight-$OBJ.log" || fail "wrong preflight refusal $OBJ"
done
for COL in beneficiar_tip tert_ref_tip tert_ref_id tert_ref_text tert_client poza_manometru_path intarziata cheie creat_de; do
  case "$COL" in beneficiar_tip|tert_ref_tip|tert_ref_id|tert_ref_text|tert_client) TAB=probe_calcule ;; *) TAB=probe_log_executie ;; esac
  if "${P[@]}" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare','20261114a_probe_teren:' || txid_current(),true)" -c "ALTER TABLE public.$TAB ADD COLUMN $COL text" -f "$MIG" >"$DIR/preflight-$COL.log" 2>&1; then fail "preflight accepted $COL"; fi
  grep -q 'pt_preflight' "$DIR/preflight-$COL.log" || fail "wrong column preflight $COL"
done
SHA="$(sha256sum "$MIG" | cut -d' ' -f1)"
SYSTEM="$(q 'SELECT system_identifier FROM pg_control_system()')"
PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$MIG" --sha256 "$SHA" --versiune 20261114120000 --tinta-db probe_teren_test --tinta-sistem "$SYSTEM" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >"$DIR/runner.log" 2>&1 || { cat "$DIR/runner.log"; fail 'official runner'; }
"${P[@]}" -f "$ROOT/scripts/test_probe_teren.sql" >"$DIR/tests.log" 2>&1 || { cat "$DIR/tests.log"; fail 'SQL tests'; }
grep -q 'PASS probe_teren SQL' "$DIR/tests.log" || fail 'SQL end marker missing'
# E2a foloseste o clona locala; testele E1, concurenta si rollback-ul lor raman intacte.
"${ADMIN[@]}" -c 'CREATE DATABASE probe_teren_faze TEMPLATE probe_teren_test OWNER postgres'
F=("${P[@]}" -d probe_teren_faze)
MIG2="$ROOT/supabase/migrations/20261115a_probe_teren_faze.sql"
REV2="$ROOT/supabase/revenire/20261115a_probe_teren_faze_ROLLBACK.sql"
"${F[@]}" -c "INSERT INTO probe_calcule(id,proiect_id) VALUES(880,1); INSERT INTO storage.objects VALUES('probe-citiri','teren/880/start'),('probe-citiri','teren/880/utilaj'),('probe-citiri','teren/880/final'),('probe-citiri','teren/880/stop'); SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false); SELECT fn_probe_porneste(880,'[{\"active_id\":12,\"rol\":\"compresor\",\"ore_bord\":100,\"poza_path\":\"teren/880/utilaj\"}]',1,'teren/880/start','legacy-start')" >"$DIR/faze-legacy.log"
BEFORE2="$("${F[@]}" -Atc "SELECT md5(string_agg(to_jsonb(c)::text,',' ORDER BY id)) FROM probe_calcule c")"
if "${F[@]}" -f "$MIG2" >"$DIR/faze-guard.log" 2>&1; then fail 'E2a unguarded apply accepted'; fi
grep -q 'pt_garda' "$DIR/faze-guard.log" || fail 'E2a wrong guard refusal'
for OBJ in probe_teren_scrie_e1 probe_teren_faze_guard fn_probe_schimba_faza fn_probe_creeaza_teren; do
  if "${F[@]}" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare','20261115a_probe_teren_faze:' || txid_current(),true)" -c "CREATE FUNCTION public.$OBJ(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'" -f "$MIG2" >"$DIR/faze-preflight-$OBJ.log" 2>&1; then fail "E2a preflight accepted $OBJ"; fi
  grep -q pt_preflight "$DIR/faze-preflight-$OBJ.log" || fail "E2a wrong preflight $OBJ"
done
for COL in faza_curenta creat_din_teren faza limita_faza faza_start faza_stop; do
  case "$COL" in faza_curenta|creat_din_teren) TAB=probe_calcule ;; faza|limita_faza) TAB=probe_log_executie ;; *) TAB=probe_exec_utilaje ;; esac
  if "${F[@]}" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare','20261115a_probe_teren_faze:' || txid_current(),true)" -c "ALTER TABLE public.$TAB ADD COLUMN $COL text" -f "$MIG2" >"$DIR/faze-preflight-$COL.log" 2>&1; then fail "E2a preflight accepted $COL"; fi
  grep -q pt_preflight "$DIR/faze-preflight-$COL.log" || fail "E2a wrong preflight $COL"
done
SHA2="$(sha256sum "$MIG2" | cut -d' ' -f1)"
PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$MIG2" --sha256 "$SHA2" --versiune 20261115120000 --tinta-db probe_teren_faze --tinta-sistem "$SYSTEM" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >"$DIR/faze-runner.log" 2>&1 || { cat "$DIR/faze-runner.log"; fail 'E2a official runner'; }
[[ "$("${F[@]}" -Atc "SELECT md5(string_agg((to_jsonb(c)-'faza_curenta'-'creat_din_teren')::text,',' ORDER BY id)) FROM probe_calcule c")" = "$BEFORE2" ]] || fail 'E2a changed existing calculations'
"${F[@]}" -v probe_e2a=1 -f "$ROOT/scripts/test_probe_teren.sql" >"$DIR/faze-tests.log" 2>&1 || { cat "$DIR/faze-tests.log"; fail 'E2a SQL'; }
grep -q 'PASS probe_teren E2a SQL' "$DIR/faze-tests.log" || fail 'E2a SQL end marker missing'
# Concurenta E2a pe alta clona: lockul nou serializeaza acelasi utilaj intre probe.
"${ADMIN[@]}" -c 'CREATE DATABASE probe_teren_faze_concurenta TEMPLATE probe_teren_faze OWNER postgres'
FC=("${P[@]}" -d probe_teren_faze_concurenta)
"${FC[@]}" -c "INSERT INTO probe_calcule(id,proiect_id) VALUES(200,1),(201,1); INSERT INTO storage.objects SELECT 'probe-citiri','teren/'||c||'/'||p FROM generate_series(200,201) c CROSS JOIN unnest(ARRAY['m','u']) p"
FAUTH="SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true); SET LOCAL ROLE authenticated"
FSTART="SELECT fn_probe_porneste(200,'[{\"active_id\":10,\"rol\":\"compresor\",\"ore_bord\":100,\"poza_path\":\"teren/200/u\"}]',1,'teren/200/m','faze-concurent-a')"
"${FC[@]}" -c "BEGIN; $FAUTH; $FSTART; SELECT pg_sleep(3) /* probe_faze_session_a */; COMMIT" >"$DIR/faze-session-a.log" 2>&1 &
FA_PID=$!
READY=false
for i in {1..80}; do
  if [[ "$(q "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE '%probe_faze_session_a%' AND wait_event='PgSleep')")" = t ]]; then READY=true; break; fi
  sleep 0.025
done
[[ "$READY" = true ]] || fail 'E2a session A did not acquire lock'
if "${FC[@]}" --single-transaction -c "$FAUTH" -c "SELECT fn_probe_porneste(201,'[{\"active_id\":10,\"rol\":\"compresor\",\"ore_bord\":100,\"poza_path\":\"teren/201/u\"}]',1,'teren/201/m','faze-concurent-b')" >"$DIR/faze-session-b.log" 2>&1; then fail 'E2a concurrent asset accepted'; fi
wait "$FA_PID" || fail 'E2a session A failed'
grep -q pt_utilaj_ocupat "$DIR/faze-session-b.log" || fail 'E2a wrong concurrent refusal'
"${FC[@]}" --single-transaction -c "$FAUTH" -c "$FSTART" >"$DIR/faze-session-retry.log"
[[ "$("${FC[@]}" -Atc "SELECT count(*)=1 FROM probe_exec_utilaje WHERE calc_id=200")" = t ]] || fail 'E2a retry duplicated interval'
if "${FC[@]}" --single-transaction -c "SELECT set_config('gazpet.revenire_20261115a','PROBE_FAZE_SCOATE:' || txid_current(),true)" -f "$REV2" >"$DIR/faze-rollback-committed.log" 2>&1; then fail 'E2a rollback erased committed RPC'; fi
grep -q pt_rollback_date "$DIR/faze-rollback-committed.log" || fail 'E2a wrong committed rollback refusal'
if "${F[@]}" -f "$REV2" >"$DIR/faze-rollback-guard.log" 2>&1; then fail 'E2a unguarded rollback accepted'; fi
grep -q pt_garda "$DIR/faze-rollback-guard.log" || fail 'E2a wrong rollback guard'
for CASE in faza citire creat interval limita operatie; do
  case "$CASE" in
    faza) PREP="UPDATE probe_calcule SET faza_curenta='pistonare' WHERE id=900" ;;
    citire) PREP="INSERT INTO probe_log_executie(calc_id,faza) VALUES(900,'pistonare')" ;;
    creat) PREP="UPDATE probe_calcule SET creat_din_teren=true WHERE id=900" ;;
    interval) PREP="INSERT INTO probe_exec_utilaje(calc_id,active_id,rol,ore_bord_start,poza_start_path,creat_de,faza_start) VALUES(900,1,'compresor',100,'fictiv','00000000-0000-0000-0000-000000000001','pistonare')" ;;
    limita) PREP="INSERT INTO probe_log_executie(calc_id,limita_faza) VALUES(900,true)" ;;
    operatie) PREP="SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true); SELECT fn_probe_creeaza_teren(1,NULL,'apa','gazpet',NULL,NULL,NULL,NULL,'rollback-create')" ;;
  esac
  if "${F[@]}" --single-transaction -c "SELECT set_config('gazpet.revenire_20261115a','PROBE_FAZE_SCOATE:' || txid_current(),true)" -c "$PREP" -f "$REV2" >"$DIR/faze-rollback-$CASE.log" 2>&1; then fail "E2a rollback erased $CASE"; fi
  grep -q pt_rollback_date "$DIR/faze-rollback-$CASE.log" || fail "E2a wrong rollback refusal $CASE"
done
"${F[@]}" --single-transaction -c "SELECT set_config('gazpet.revenire_20261115a','PROBE_FAZE_SCOATE:' || txid_current(),true)" -f "$REV2" >"$DIR/faze-rollback.log"
[[ "$("${F[@]}" -Atc "SELECT md5(string_agg(to_jsonb(c)::text,',' ORDER BY id)) FROM probe_calcule c")" = "$BEFORE2" ]] || fail 'E2a rollback changed existing rows'
[[ "$("${F[@]}" -Atc "SELECT count(*)=4 FROM pg_attribute WHERE attrelid='public.probe_calcule'::regclass AND attname IN ('dn_id','lungime_m','presiune_bar','config_id') AND attnotnull")" = t ]] || fail 'E2a NOT NULL restoration failed'
[[ "$("${F[@]}" -Atc "SELECT to_regclass('public.probe_teren_e2a_schema') IS NULL AND to_regprocedure('public.probe_teren_scrie_e1(text,bigint,jsonb,text)') IS NULL AND to_regprocedure('public.fn_probe_schimba_faza(bigint,text,numeric,text,jsonb,text,boolean,text,text)') IS NULL")" = t ]] || fail 'E2a rollback objects remain'
echo 'PASS: E2a guards, preflight, unchanged calculations, phases, hydraulic, create, rights, rollback'
# Doua sesiuni REALE: B asteapta commit-ul A, apoi refuza acelasi utilaj in alta proba.
# Clona separata pastreaza main curat pentru proba rollback fara stergere de date operative.
"${ADMIN[@]}" -c 'CREATE DATABASE probe_teren_concurenta TEMPLATE probe_teren_test OWNER postgres'
C=("${P[@]}" -d probe_teren_concurenta)
"${C[@]}" -c "INSERT INTO storage.objects SELECT 'probe-citiri','teren/'||c||'/'||p FROM generate_series(100,101) c CROSS JOIN unnest(ARRAY['utilaj','manometru']) p; INSERT INTO probe_calcule(id,proiect_id) VALUES(100,1),(101,1)"
START="SELECT fn_probe_porneste(100,'[{\"active_id\":6,\"rol\":\"compresor\",\"ore_bord\":100,\"poza_path\":\"teren/100/utilaj\"}]',1,'teren/100/manometru','concurent-a')"
AUTH="SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true); SET LOCAL ROLE authenticated"
"${C[@]}" -c "BEGIN; $AUTH; $START; SELECT pg_sleep(3) /* probe_teren_session_a */; COMMIT" >"$DIR/session-a.log" 2>&1 &
SESSION_A=$!
READY=false
for i in {1..80}; do
  if [[ "$(q "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE '%probe_teren_session_a%' AND wait_event='PgSleep')")" = t ]]; then READY=true; break; fi
  sleep 0.025
done
[[ "$READY" = true ]] || fail 'session A did not acquire lock'
if "${C[@]}" --single-transaction -c "$AUTH" -c "SELECT fn_probe_porneste(101,'[{\"active_id\":6,\"rol\":\"compresor\",\"ore_bord\":100,\"poza_path\":\"teren/101/utilaj\"}]',1,'teren/101/manometru','concurent-b')" >"$DIR/session-b.log" 2>&1; then fail 'concurrent asset accepted'; fi
wait "$SESSION_A" || fail 'session A failed'
grep -q 'pt_utilaj_ocupat' "$DIR/session-b.log" || fail 'wrong concurrent refusal'
"${C[@]}" --single-transaction -c "$AUTH" -c "$START" >"$DIR/session-retry.log"
[[ "$("${C[@]}" -Atc 'SELECT count(*) FROM probe_exec_utilaje')" = 1 ]] || fail 'concurrent retry duplicated interval'
if "${C[@]}" --single-transaction -c "SELECT set_config('gazpet.revenire_20261114a','PROBE_TEREN_SCOATE:' || txid_current(),true)" -f "$REV" >"$DIR/rollback-real.log" 2>&1; then fail 'rollback erased committed RPC'; fi
grep -q 'pt_rollback_date' "$DIR/rollback-real.log" || fail 'wrong committed rollback refusal'
if "${P[@]}" -f "$REV" >"$DIR/rollback-guard.log" 2>&1; then fail 'unguarded rollback accepted'; fi
grep -q 'pt_garda' "$DIR/rollback-guard.log" || fail 'wrong rollback guard'
for CASE in asociere interval citire contor operatie completare poza intarziata cheie autor beneficiar tert comanda; do
  EXPECT=pt_rollback_date
  case "$CASE" in
    asociere) PREP="INSERT INTO probe_teren_poze VALUES(900,'teren/900/fictiv','k')" ;;
    interval) PREP="INSERT INTO probe_exec_utilaje(calc_id,active_id,rol,ore_bord_start,poza_start_path,creat_de) VALUES(900,1,'compresor',100,'fictiv','00000000-0000-0000-0000-000000000001')" ;;
    citire) PREP="INSERT INTO probe_log_executie(calc_id,poza_manometru_path) VALUES(900,'fictiv')" ;;
    contor) PREP="WITH l AS (INSERT INTO probe_log_executie(calc_id) VALUES(900) RETURNING id) INSERT INTO probe_log_utilaje(log_id,active_id,ore_bord,poza_path) SELECT id,1,100,'fictiv' FROM l" ;;
    operatie) PREP="INSERT INTO probe_teren_operatii VALUES('k',900,'porneste','{}','{}','00000000-0000-0000-0000-000000000001',now())" ;;
    completare) PREP="SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true); SELECT fn_probe_completeaza_executie(900,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'k')" ;;
    poza) PREP="INSERT INTO probe_log_executie(calc_id,poza_manometru_path) VALUES(900,'fictiv')" ;;
    intarziata) PREP="INSERT INTO probe_log_executie(calc_id,intarziata) VALUES(900,true)" ;;
    cheie) PREP="INSERT INTO probe_log_executie(calc_id,cheie) VALUES(900,'k')" ;;
    autor) PREP="INSERT INTO probe_log_executie(calc_id,creat_de) VALUES(900,'00000000-0000-0000-0000-000000000001')" ;;
    beneficiar) PREP="UPDATE probe_calcule SET beneficiar_tip=NULL WHERE id=900"; EXPECT=pt_rollback_beneficiar ;;
    tert) PREP="SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true); UPDATE probe_calcule SET beneficiar_tip='tert',tert_ref_tip='contract',tert_ref_id=1,tert_client='X' WHERE id=900"; EXPECT=pt_rollback_beneficiar ;;
    comanda) PREP="UPDATE probe_calcule SET beneficiar_tip='tert',tert_ref_tip='comanda',tert_ref_text='CMD-123',tert_client='X' WHERE id=900"; EXPECT=pt_rollback_beneficiar ;;
  esac
  if "${P[@]}" --single-transaction -c "SELECT set_config('gazpet.revenire_20261114a','PROBE_TEREN_SCOATE:' || txid_current(),true)" -c "$PREP" -f "$REV" >"$DIR/rollback-$CASE.log" 2>&1; then fail "rollback erased $CASE"; fi
  grep -q "$EXPECT" "$DIR/rollback-$CASE.log" || fail "wrong rollback refusal $CASE"
done
"${P[@]}" --single-transaction -c "SELECT set_config('gazpet.revenire_20261114a','PROBE_TEREN_SCOATE:' || txid_current(),true)" -f "$REV" >"$DIR/rollback.log"
[[ "$(q "SELECT to_regclass('public.probe_exec_utilaje') IS NULL AND to_regclass('public.v_probe_raport') IS NULL AND to_regprocedure('public.probe_teren_drept(boolean)') IS NULL AND to_regprocedure('public.probe_teren_statii_externe(bigint)') IS NULL AND to_regprocedure('public.probe_teren_oferta_guard()') IS NULL AND to_regprocedure('public.probe_teren_referinta_exista(text,bigint)') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.probe_oferte'::regclass AND tgname='probe_oferte_teren_guard')")" = t ]] || fail 'rollback incomplete'
[[ "$(fingerprint)" = "$BEFORE" ]] || fail 'legacy rows changed after rollback'
echo 'PASS: PG17 NOSUPERUSER, official runner, preflight, business rules, RLS, append-only, concurrency, rollback'
