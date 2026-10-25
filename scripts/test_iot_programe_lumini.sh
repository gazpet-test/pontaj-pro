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
SHA="$(sha256sum "$MIG" | cut -d' ' -f1)"
SYSTEM="$(q 'SELECT system_identifier FROM pg_control_system()')"
TMPDIR="$DIR" PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$MIG" --sha256 "$SHA" --versiune 20261113120000 --tinta-db iot_lumini_test --tinta-sistem "$SYSTEM" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >"$DIR/runner.log" 2>&1 || { cat "$DIR/runner.log"; fail 'official runner'; }
"${P[@]}" -v lumini_cases="$(cat "$ROOT/test-fixtures/lumini_parametri.json")" -f "$ROOT/scripts/test_iot_programe_lumini.sql" >"$DIR/tests.log" 2>&1 || { cat "$DIR/tests.log"; fail 'SQL tests'; }
if "${P[@]}" -f "$REV" >"$DIR/rollback-guard.log" 2>&1; then fail 'unguarded rollback accepted'; fi
grep -q 'garda start invalida' "$DIR/rollback-guard.log" || fail 'wrong rollback guard'
if "${P[@]}" --single-transaction -c 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED' -c "SELECT set_config('gazpet.revenire_20261113a','IOT_LUMINI_SCOATE:' || txid_current(),true)" -c "UPDATE public.iot_lumini_setari SET runtime='{\"programe\":{\"_intentii\":{\"test\":{\"stare\":\"in_curs\"}}}}'::jsonb WHERE id=true" -f "$REV" >"$DIR/rollback-intent.log" 2>&1; then fail 'rollback erased pre-POST intent'; fi
grep -q 'Export runtime/intentie necesar' "$DIR/rollback-intent.log" || fail 'wrong runtime rollback guard'
"${P[@]}" --single-transaction -c 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED' -c "SELECT set_config('gazpet.revenire_20261113a','IOT_LUMINI_SCOATE:' || txid_current(),true)" -f "$REV" >"$DIR/rollback.log"
[[ "$(q "SELECT to_regclass('public.iot_lumini') IS NULL AND NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='iot_lumini_tick_5min')")" = t ]] || fail 'rollback incomplete'
[[ "$(fingerprint)" = "$BEFORE" ]] || fail 'existing data/function changed'
echo 'PASS: official runner, NOSUPERUSER, RLS, rights, approval, conflicts, append-only UI, caps, dedup, rollback'
