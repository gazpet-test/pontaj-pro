#!/usr/bin/env bash
# PG17 exclusiv local, fara credentiale/dump/BD externa. Scrierile raman in worktree.
set -Eeuo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
PORT="${EMPLOYEES_PII_TEST_PORT:-5997}"
LOCALE="${LOCALE:-C.UTF-8}"
UNIX_SOCKET_DIRECTORIES="${UNIX_SOCKET_DIRECTORIES-}"
MIG="$ROOT/supabase/migrations/20261117a_employees_pii.sql"
REV="$ROOT/supabase/revenire/20261117a_employees_pii_ROLLBACK.sql"
fail() { echo "FAIL: $*" >&2; exit 1; }
[[ "$PORT" =~ ^[0-9]+$ ]] || fail 'port numeric necesar'
[[ -x "$PG_BIN/initdb" ]] || { echo 'ENV: PostgreSQL 17 unavailable' >&2; exit 2; }
[[ "$(id -u)" != 0 ]] || { echo 'ENV: use unprivileged local OS user' >&2; exit 2; }
"$PG_BIN/postgres" --version | grep -Eq 'PostgreSQL\) 17\.' || fail 'requires PG17'
unset PGURI PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE PGSYSCONFDIR PGOPTIONS PSQLRC PGTARGETSESSIONATTRS PGLOADBALANCEHOSTS
DIR="$(mktemp -d "$ROOT/.employees-pii-test.XXXXXXXX")"
export TMPDIR="$DIR" PGPASSFILE="$DIR/no-password-file"
cleanup() {
  if [[ -f "$DIR/data/postmaster.pid" ]]; then "$PG_BIN/pg_ctl" -D "$DIR/data" -m fast -w stop >"$DIR/stop.log" 2>&1 || true; fi
  echo "Artifacts: $DIR"
}
trap cleanup EXIT
"$PG_BIN/initdb" -D "$DIR/data" -U pii_bootstrap --auth=trust --encoding=UTF8 --locale="$LOCALE" >"$DIR/init.log"
SERVER_OPTIONS="-p $PORT -c listen_addresses=127.0.0.1"
if [[ -n "$UNIX_SOCKET_DIRECTORIES" ]]; then
  SERVER_OPTIONS+=" -c unix_socket_directories='$UNIX_SOCKET_DIRECTORIES'"
fi
"$PG_BIN/pg_ctl" -D "$DIR/data" -l "$DIR/postgres.log" -w -t 30 start -o "$SERVER_OPTIONS" >"$DIR/start.log"
ADMIN=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U pii_bootstrap -d postgres)
"${ADMIN[@]}" -c 'CREATE ROLE postgres LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT authenticated,anon,service_role TO postgres'
"${ADMIN[@]}" -c 'CREATE DATABASE employees_pii_test OWNER postgres'
"${ADMIN[@]}" -d employees_pii_test -c 'GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO postgres'
P=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d employees_pii_test)
q() { "${P[@]}" -Atc "$1"; }
"${P[@]}" -f "$ROOT/scripts/test_employees_pii_fixture.sql" >"$DIR/fixture.log"
# Toate ACL-urile, inclusiv grantor, grant option si coloane; nu comparam doar SELECT(cnp).
ACL="SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY col,grantor,grantee,privilege_type,is_grantable),'[]'::jsonb) FROM (SELECT ''::text col,x.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x WHERE c.oid='public.employees'::regclass UNION ALL SELECT attname::text,x.* FROM pg_attribute CROSS JOIN LATERAL aclexplode(attacl) x WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped) a"
BEFORE="$(q "$ACL")"
DATA="$(q "SELECT md5(string_agg(to_jsonb(e)::text,',' ORDER BY id)) FROM employees e")"
if "${P[@]}" -f "$MIG" >"$DIR/guard.log" 2>&1; then fail 'unguarded apply accepted'; fi
grep -q epi_garda "$DIR/guard.log" || fail 'wrong apply guard error'
FOST_BEFORE="$(q "SELECT pg_get_functiondef('public.fn_fost_angajat_leaga_extern(integer,bigint)'::regprocedure)")"
for CASE in column inherited view function marimi fost_drift; do
  case "$CASE" in
    fost_drift) PREP="CREATE OR REPLACE FUNCTION public.fn_fost_angajat_leaga_extern(p_employee_id integer, p_extern_id bigint DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS 'BEGIN RETURN 0; END'" ;;
    column) PREP='ALTER TABLE public.employees ADD COLUMN personal_nou text' ;;
    inherited) PREP='GRANT SELECT(cnp) ON public.employees TO PUBLIC' ;;
    view) PREP='CREATE VIEW public.pii_leak AS SELECT cnp FROM employees; GRANT SELECT ON public.pii_leak TO authenticated' ;;
    marimi) PREP="CREATE FUNCTION public.fn_employees_marimi(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'" ;;
    function) PREP="CREATE FUNCTION public.fn_employees_personal(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'" ;;
  esac
  if "${P[@]}" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare','20261117a_employees_pii:' || txid_current(),true)" -c "$PREP" -f "$MIG" >"$DIR/preflight-$CASE.log" 2>&1; then fail "preflight accepted $CASE"; fi
  grep -q epi_preflight "$DIR/preflight-$CASE.log" || fail "wrong preflight error $CASE"
done
SHA="$(sha256sum "$MIG" | cut -d' ' -f1)"
SYSTEM="$(q 'SELECT system_identifier FROM pg_control_system()')"
PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$MIG" --sha256 "$SHA" --versiune 20261117120000 --tinta-db employees_pii_test --tinta-sistem "$SYSTEM" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >"$DIR/runner.log" 2>&1 || { cat "$DIR/runner.log"; fail 'official runner'; }
[[ "$(q "SELECT md5(string_agg(to_jsonb(e)::text,',' ORDER BY id)) FROM employees e")" = "$DATA" ]] || fail 'apply changed HR data'
"${P[@]}" -f "$ROOT/scripts/test_employees_pii.sql" >"$DIR/tests.log" 2>&1 || { cat "$DIR/tests.log"; fail 'SQL rights tests'; }
grep -q 'PASS employees_pii SQL' "$DIR/tests.log" || fail 'SQL end marker missing'
if "${P[@]}" -f "$REV" >"$DIR/rollback-guard.log" 2>&1; then fail 'unguarded rollback accepted'; fi
grep -q epi_garda "$DIR/rollback-guard.log" || fail 'wrong rollback guard error'
if "${P[@]}" --single-transaction -c "SELECT set_config('gazpet.revenire_20261117a','EMPLOYEES_PII_RESTAUREAZA:' || txid_current(),true)" -c 'GRANT SELECT(cnp) ON employees TO authenticated' -f "$REV" >"$DIR/drift.log" 2>&1; then fail 'rollback erased new ACL'; fi
grep -q epi_rollback_drift "$DIR/drift.log" || fail 'wrong rollback drift error'
if "${P[@]}" --single-transaction -c "SELECT set_config('gazpet.revenire_20261117a','EMPLOYEES_PII_RESTAUREAZA:' || txid_current(),true)" -c "ALTER FUNCTION public.fn_fost_angajat_leaga_extern(integer,bigint) SET search_path TO public" -f "$REV" >"$DIR/function-drift.log" 2>&1; then fail 'rollback erased function drift'; fi
grep -q epi_rollback_drift "$DIR/function-drift.log" || fail 'wrong function drift error'
"${P[@]}" --single-transaction -c "SELECT set_config('gazpet.revenire_20261117a','EMPLOYEES_PII_RESTAUREAZA:' || txid_current(),true)" -f "$REV" >"$DIR/rollback.log"
[[ "$(q "SELECT pg_get_functiondef('public.fn_fost_angajat_leaga_extern(integer,bigint)'::regprocedure)")" = "$FOST_BEFORE" ]] || fail 'rollback function definition differs'
[[ "$(q "$ACL")" = "$BEFORE" ]] || fail 'rollback ACL differs'
[[ "$(q "SELECT md5(string_agg(to_jsonb(e)::text,',' ORDER BY id)) FROM employees e")" = "$DATA" ]] || fail 'rollback changed data'
[[ "$(q "SELECT to_regclass('public.employees_pii_acl_20261117a') IS NULL AND to_regprocedure('public.fn_employees_personal(bigint[])') IS NULL AND to_regprocedure('public.fn_employees_marimi(bigint[])') IS NULL")" = t ]] || fail 'rollback objects remain'
# Re-apply dupa rollback, apoi aceleasi teste, fara registrul runner-ului deja aplicat.
"${P[@]}" --single-transaction -c 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED' -c "SELECT set_config('gazpet.livrare_migrare','20261117a_employees_pii:' || txid_current(),true)" -f "$MIG" >"$DIR/reapply.log"
"${P[@]}" -f "$ROOT/scripts/test_employees_pii.sql" >"$DIR/reapply-tests.log" 2>&1 || { cat "$DIR/reapply-tests.log"; fail 'reapply SQL tests'; }
echo 'PASS: PG17 NOSUPERUSER, guards, preflight, SELECT/RPC/DML/RETURNING, service_role, exact ACL rollback, reapply'
