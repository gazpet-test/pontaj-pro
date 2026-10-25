#!/usr/bin/env bash
# Local PostgreSQL 17 only. All generated files remain inside the worktree.
# Usage: bash scripts/test_iot_ups_alerte.sh
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
PORT="${UPS_TEST_PORT:-5987}"
NAME=20261112a_iot_ups_alerte
MIG="$ROOT/supabase/migrations/$NAME.sql"
REV="$ROOT/supabase/revenire/${NAME}_ROLLBACK.sql"
fail() { echo "FAIL: $*" >&2; exit 1; }
[[ -x "$PG_BIN/initdb" ]] || { echo "ENV: PostgreSQL 17 unavailable ($PG_BIN)" >&2; exit 2; }
[[ "$(id -u)" != 0 ]] || { echo 'ENV: run as unprivileged local OS user' >&2; exit 2; }
"$PG_BIN/postgres" --version | grep -Eq 'PostgreSQL\) 17\.' || fail 'requires PostgreSQL 17'
DIR="$(mktemp -d "$ROOT/.iot-ups-test.XXXXXXXX")"
cleanup() {
  if [[ -f "$DIR/data/postmaster.pid" ]]; then "$PG_BIN/pg_ctl" -D "$DIR/data" -m fast -w stop >"$DIR/stop.log" 2>&1 || true; fi
  echo "Artifacts: $DIR"
}
trap cleanup EXIT
node "$ROOT/scripts/test_iot_ups_alerte.mjs" "$DIR"
"$PG_BIN/initdb" -D "$DIR/data" -U ups_bootstrap --auth=trust --encoding=UTF8 --locale=C.UTF-8 >"$DIR/init.log"
"$PG_BIN/pg_ctl" -D "$DIR/data" -l "$DIR/postgres.log" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" >"$DIR/start.log"
ADMIN=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U ups_bootstrap -d postgres)
"${ADMIN[@]}" -c 'CREATE ROLE postgres LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
"${ADMIN[@]}" -c 'CREATE ROLE service_role NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN'
"${ADMIN[@]}" -c 'CREATE DATABASE iot_ups_test OWNER postgres'
# Minimal permission needed by the official runner, granted only in this isolated cluster.
"${ADMIN[@]}" -d iot_ups_test -c 'GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO postgres'
P=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d iot_ups_test)
q() { "${P[@]}" -Atc "$1"; }
"${P[@]}" -f "$DIR/fixture.sql"
q "CREATE SCHEMA cron; CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text, command text, nodename text DEFAULT 'localhost', nodeport integer DEFAULT 5432, database text DEFAULT current_database(), username text DEFAULT current_user, active boolean DEFAULT true, jobname text);
CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);" >"$DIR/schema.log"
fingerprint() { q "SELECT md5(prosrc)||'|'||proacl::text FROM pg_proc WHERE oid='public.iot_verifica_retea()'::regprocedure"; }
BEFORE="$(fingerprint)"
[[ "$BEFORE" = d6e0db3c7c2f6b49497b267e1bf06ac5\|* ]] || fail 'old body mismatch'
if "${P[@]}" -f "$MIG" >"$DIR/guard.log" 2>&1; then fail 'unguarded migration accepted'; fi
grep -q 'garda start invalida' "$DIR/guard.log" || fail 'wrong guard failure'
[[ "$(fingerprint)" = "$BEFORE" ]] || fail 'guard changed function'
# Snapshot old behavior, then restore normal sensor data before applying migration.
q "UPDATE public.iot_dispozitive SET ultima_citire='{\"online\":true,\"cpu_temp\":90,\"hdd_max\":55,\"gpu_temp\":81,\"disk_pct\":95,\"ai_gemini_ramas_pct\":12}' WHERE id=1;
SELECT public.iot_verifica_retea(); CREATE TABLE public.baseline AS SELECT * FROM public.notifications;
DELETE FROM public.notifications WHERE true; UPDATE public.iot_dispozitive SET ultima_citire='{\"online\":true}' WHERE id=1;" >"$DIR/baseline.log"
SHA="$(sha256sum "$MIG" | cut -d' ' -f1)"
SYSTEM="$(q 'SELECT system_identifier FROM pg_control_system()')"
TMPDIR="$DIR" PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/livrare_migrare.sh" \
  --migrare "$MIG" --sha256 "$SHA" --versiune 20261112120000 \
  --tinta-db iot_ups_test --tinta-sistem "$SYSTEM" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres \
  >"$DIR/runner.log" 2>&1 || { cat "$DIR/runner.log"; fail 'official runner'; }
AFTER="$(fingerprint)"
[[ "$AFTER" != "$BEFORE" && "${AFTER#*|}" = "${BEFORE#*|}" ]] || fail 'body/ACL after migration'
[[ "$(q "SELECT rolsuper FROM pg_roles WHERE rolname=current_user")" = f ]] || fail 'owner is superuser'
"${P[@]}" -f "$ROOT/supabase/tests/iot_ups_alerte.sql"
if "${P[@]}" -f "$REV" >"$DIR/rollback-guard.log" 2>&1; then fail 'unguarded rollback accepted'; fi
grep -q 'garda start invalida' "$DIR/rollback-guard.log" || fail 'wrong rollback guard failure'
[[ "$(fingerprint)" = "$AFTER" ]] || fail 'rollback guard changed body'
"${P[@]}" --single-transaction \
  -c 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED' \
  -c "SELECT set_config('gazpet.revenire_20261112a','IOT_UPS_SCOATE:' || txid_current(),true)" \
  -f "$REV" >"$DIR/rollback.log"
[[ "$(fingerprint)" = "$BEFORE" ]] || fail 'rollback did not restore exact prosrc/ACL'
echo 'PASS: official runner, nonsuperuser owner, UPS cases, existing alerts, dedup, guard, exact MD5 rollback'
