#!/usr/bin/env bash
# PG17 izolat, fara retea externa; owner postgres NOSUPERUSER. Ruleaza operatorul.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
PORT="${LUMINI_TEST_PORT:-5991}"
NAME=20261113a_iot_programe_lumini
MIG="$ROOT/supabase/migrations/$NAME.sql"
REV="$ROOT/supabase/revenire/${NAME}_ROLLBACK.sql"
fail() { echo "FAIL: $*" >&2; exit 1; }
[[ -x "$PG_BIN/initdb" ]] || { echo 'ENV: PostgreSQL 17 unavailable' >&2; exit 2; }
[[ "$(id -u)" != 0 ]] || { echo 'ENV: use unprivileged local OS user' >&2; exit 2; }
"$PG_BIN/postgres" --version | grep -Eq 'PostgreSQL\) 17\.' || fail 'requires PG17'
DIR="$(mktemp -d "$ROOT/.iot-lumini-test.XXXXXXXX")"
cleanup() {
  if [[ -f "$DIR/data/postmaster.pid" ]]; then "$PG_BIN/pg_ctl" -D "$DIR/data" -m fast -w stop >"$DIR/stop.log" 2>&1 || true; fi
  echo "Artifacts: $DIR"
}
trap cleanup EXIT
"$PG_BIN/initdb" -D "$DIR/data" -U lumini_bootstrap --auth=trust --encoding=UTF8 --locale=C.UTF-8 >"$DIR/init.log"
"$PG_BIN/pg_ctl" -D "$DIR/data" -l "$DIR/postgres.log" -w -t 30 start -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" >"$DIR/start.log"
ADMIN=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U lumini_bootstrap -d postgres)
"${ADMIN[@]}" -c 'CREATE ROLE postgres LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
"${ADMIN[@]}" -c 'CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT authenticated,anon,service_role TO postgres'
"${ADMIN[@]}" -c 'CREATE DATABASE iot_lumini_test OWNER postgres'
"${ADMIN[@]}" -d iot_lumini_test -c 'GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO postgres'
P=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d iot_lumini_test)
q() { "${P[@]}" -Atc "$1"; }
"${P[@]}" -f "$ROOT/scripts/test_iot_programe_lumini_fixture.sql"
fingerprint() { q "SELECT md5(string_agg(id::text||sursa||meta::text,',' ORDER BY id))||'|'||(SELECT md5(prosrc) FROM pg_proc WHERE oid='public.iot_cron_tick()'::regprocedure) FROM public.iot_dispozitive"; }
BEFORE="$(fingerprint)"
if "${P[@]}" -f "$MIG" >"$DIR/guard.log" 2>&1; then fail 'unguarded migration accepted'; fi
grep -q 'garda start invalida' "$DIR/guard.log" || fail 'wrong guard failure'
# r6: fiecare obiect preexistent este refuzat, inclusiv alta semnatura.
for OBJ in iot_lumini iot_program_lumini iot_lumini_jurnal iot_lumini_setari iot_lumini_drept iot_lumini_valideaza iot_lumini_salveaza iot_lumini_runtime iot_lumini_cron_tick; do
  case "$OBJ" in
    iot_lumini|iot_program_lumini|iot_lumini_jurnal|iot_lumini_setari) PREP="CREATE TABLE public.$OBJ(sentinel integer)" ;;
    *) PREP="CREATE FUNCTION public.$OBJ(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'" ;;
  esac
  if "${P[@]}" --single-transaction -c 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED' -c "SELECT set_config('gazpet.livrare_migrare','20261113a_iot_programe_lumini:' || txid_current(),true)" -c "$PREP" -f "$MIG" >"$DIR/preflight-$OBJ.log" 2>&1; then fail "preflight accepted $OBJ"; fi
  grep -q 'Obiecte deja existente: tabele/functii lumini; apply refuzat' "$DIR/preflight-$OBJ.log" || fail "wrong preflight refusal $OBJ"
done
SHA="$(sha256sum "$MIG" | cut -d' ' -f1)"
SYSTEM="$(q 'SELECT system_identifier FROM pg_control_system()')"
TMPDIR="$DIR" PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$MIG" --sha256 "$SHA" --versiune 20261113120000 --tinta-db iot_lumini_test --tinta-sistem "$SYSTEM" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >"$DIR/runner.log" 2>&1 || { cat "$DIR/runner.log"; fail 'official runner'; }
"${P[@]}" -v lumini_cases="$(cat "$ROOT/test-fixtures/lumini_parametri.json")" -v lumini_settings_cases="$(cat "$ROOT/test-fixtures/lumini_setari.json")" -f "$ROOT/scripts/test_iot_programe_lumini.sql" >"$DIR/tests.log" 2>&1 || { cat "$DIR/tests.log"; fail 'SQL tests'; }
# P2-E/G: doua sesiuni reale. A tine randul runtime, B asteapta apoi vede lease activ.
# Markerul din pg_stat_activity confirma ca A a ajuns la asteptare cu lock-ul luat.
"${P[@]}" -c "BEGIN; SELECT public.iot_lumini_runtime('acquire','session-a'); SELECT pg_sleep(4) /* lumini_r3_session_a */; COMMIT" >"$DIR/session-a.log" 2>&1 &
SESSION_A=$!
READY=false
for i in {1..60}; do
  if [[ "$(q "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE '%lumini_r3_session_a%' AND wait_event='PgSleep')")" = t ]]; then READY=true; break; fi
  sleep 0.05
done
[[ "$READY" = true ]] || fail 'session A did not acquire runtime row'
if "${P[@]}" --single-transaction -c 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED' -c "SELECT set_config('gazpet.revenire_20261113a','IOT_LUMINI_SCOATE:' || txid_current(),true)" -f "$REV" >"$DIR/rollback-lease.log" 2>&1; then fail 'rollback accepted active concurrent lease'; fi
wait "$SESSION_A" || fail 'session A failed'
grep -q 'Comanda/tick in curs; rollback refuzat' "$DIR/rollback-lease.log" || fail 'wrong concurrent rollback refusal'
[[ "$(q "SELECT to_regclass('public.iot_lumini') IS NOT NULL AND runtime->>'token'='session-a' FROM public.iot_lumini_setari WHERE id=true")" = t ]] || fail 'rollback touched active runtime'
[[ "$(q "SELECT (public.iot_lumini_runtime('acquire','session-b')->>'ok')::boolean")" = f ]] || fail 'concurrent worker acquired active lease'
q "SELECT public.iot_lumini_runtime('release','session-a')" >"$DIR/release-a.log"
q "UPDATE public.iot_lumini_setari SET runtime='{}' WHERE id=true" >"$DIR/reset-runtime.log"
if "${P[@]}" -f "$REV" >"$DIR/rollback-guard.log" 2>&1; then fail 'unguarded rollback accepted'; fi
grep -q 'garda start invalida' "$DIR/rollback-guard.log" || fail 'wrong rollback guard'
if "${P[@]}" --single-transaction -c 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED' -c "SELECT set_config('gazpet.revenire_20261113a','IOT_LUMINI_SCOATE:' || txid_current(),true)" -c "UPDATE public.iot_lumini_setari SET runtime='{\"motor\":{\"pauze\":{\"85462\":123456789}}}'::jsonb WHERE id=true" -f "$REV" >"$DIR/rollback-pauza.log" 2>&1; then fail 'rollback erased pre-POST pause'; fi
grep -q 'Export runtime operational necesar' "$DIR/rollback-pauza.log" || fail 'wrong runtime rollback guard'
# Refuz operational si pentru audit, configuratie si rezervari, fara lease activ.
for CASE in jurnal program rezervari off pauza_ore lat lon vacanta simulare rol inactiv lipsa; do
  case "$CASE" in
    pauza_ore) PREP="UPDATE public.iot_lumini_setari SET pauza_ore=4 WHERE id=true"; EXPECT='Configuratie modificata dupa apply; export separat necesar' ;;
    lat) PREP="UPDATE public.iot_lumini_setari SET lat=45 WHERE id=true"; EXPECT='Configuratie modificata dupa apply; export separat necesar' ;;
    lon) PREP="UPDATE public.iot_lumini_setari SET lon=27 WHERE id=true"; EXPECT='Configuratie modificata dupa apply; export separat necesar' ;;
    vacanta) PREP="UPDATE public.iot_lumini_setari SET vacanta_de='2026-12-24',vacanta_pana='2026-12-31' WHERE id=true"; EXPECT='Configuratie modificata dupa apply; export separat necesar' ;;
    simulare) PREP="UPDATE public.iot_lumini_setari SET simulare_pana_la='22:00' WHERE id=true"; EXPECT='Configuratie modificata dupa apply; export separat necesar' ;;
    rol) PREP="UPDATE public.iot_lumini SET rol='interior' WHERE dispozitiv_id=85462"; EXPECT='Configuratie modificata dupa apply; export separat necesar' ;;
    inactiv) PREP="UPDATE public.iot_lumini SET activ=false WHERE dispozitiv_id=85462"; EXPECT='Configuratie modificata dupa apply; export separat necesar' ;;
    lipsa) PREP="DELETE FROM public.iot_lumini WHERE dispozitiv_id=85462"; EXPECT='Configuratie modificata dupa apply; export separat necesar' ;;
    jurnal) PREP="INSERT INTO public.iot_lumini_jurnal(dispozitiv_id,comanda,sursa,ok) VALUES(85462,true,'manual',false)"; EXPECT='Export si plan separat' ;;
    program) PREP="INSERT INTO public.iot_program_lumini(nume,tip,dispozitive,creat_de) VALUES('Rollback test','solar',ARRAY[85462],'00000000-0000-0000-0000-000000000001')"; EXPECT='Export si plan separat' ;;
    rezervari) PREP="UPDATE public.iot_lumini_setari SET runtime=jsonb_build_object('rezervari',jsonb_build_array(clock_timestamp())) WHERE id=true"; EXPECT='Export runtime operational necesar' ;;
    off) PREP="UPDATE public.iot_lumini_setari SET runtime=jsonb_build_object('off_n',1) WHERE id=true"; EXPECT='Export runtime operational necesar' ;;
  esac
  if "${P[@]}" --single-transaction -c 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED' -c "SELECT set_config('gazpet.revenire_20261113a','IOT_LUMINI_SCOATE:' || txid_current(),true)" -c "$PREP" -f "$REV" >"$DIR/rollback-$CASE.log" 2>&1; then fail "rollback erased $CASE"; fi
  grep -q "$EXPECT" "$DIR/rollback-$CASE.log" || fail "wrong $CASE rollback guard"
done
"${P[@]}" --single-transaction -c 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED' -c "SELECT set_config('gazpet.revenire_20261113a','IOT_LUMINI_SCOATE:' || txid_current(),true)" -f "$REV" >"$DIR/rollback.log"
[[ "$(q "SELECT to_regclass('public.iot_lumini') IS NULL AND NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='iot_lumini_tick_5min')")" = t ]] || fail 'rollback incomplete'
[[ "$(fingerprint)" = "$BEFORE" ]] || fail 'existing data/function changed'
echo 'PASS: official runner, NOSUPERUSER, RLS, rights, approval, conflicts, append-only UI, caps, dedup, rollback'
