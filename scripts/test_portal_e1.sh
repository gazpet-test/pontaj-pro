#!/usr/bin/env bash
# PG17 PRODLIKE; NUMAI cluster nou efemer. Nu accepta conexiuni externe.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_MAJOR="${PORTAL_PG_MAJOR:-17}"; [[ "$PG_MAJOR" =~ ^1[67]$ ]] || exit 2
PG_BIN="${PG_BIN:-/usr/lib/postgresql/$PG_MAJOR/bin}"
SLOT="${PORTAL_E1_SLOT:-0}"
[[ "$SLOT" =~ ^[0-9]$ ]] || exit 2
[[ "$(id -u)" != 0 ]] || { echo 'MEDIU: ruleaza ca postgres, nu root'; exit 2; }
[[ -x "$PG_BIN/initdb" ]] || { echo "MEDIU: PG$PG_MAJOR lipsa"; exit 2; }
[[ "$("$PG_BIN/postgres" --version)" == *" $PG_MAJOR."* ]] || { echo "MEDIU: este necesar PG$PG_MAJOR"; exit 2; }
# PG16 e acceptat doar explicit (PORTAL_PG_MAJOR=16) pentru iteratie locala; dovada pentru review / DRY = PG17 (L25).
[[ "$PG_MAJOR" == 17 ]] || echo "AVERTISMENT: rulare PG$PG_MAJOR, nu PG17 prodlike"
for v in PGPASSWORD PGOPTIONS PGDATABASE PGSERVICE PGSERVICEFILE PGHOSTADDR PGTARGETSESSIONATTRS PGLOADBALANCEHOSTS PGSYSCONFDIR PSQLRC; do
  [[ -z "${!v+x}" ]] || { echo "MEDIU: variabila $v nepermisa"; exit 2; }
done
PORT=$((6700+SLOT)); DB=portal_e1_test
TMP="$ROOT/.tmp/portal_e1_$SLOT"; DATA="$TMP/pg"
[[ ! -e "$TMP" ]] || { echo 'MEDIU: slot existent, alege altul'; exit 2; }
mkdir -p "$TMP"
export TMPDIR="$TMP"
"$PG_BIN/initdb" -D "$DATA" -U supabase_admin --auth=trust --encoding=UTF8 --locale=C.UTF-8 >"$TMP/init.log"
"$PG_BIN/pg_ctl" -D "$DATA" -l "$TMP/pg.log" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='$TMP'"
trap '"$PG_BIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null 2>&1 || true' EXIT
ADMIN=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U supabase_admin)
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB")
fail() { echo "ESEC: $*" >&2; exit 1; }
"${ADMIN[@]}" -d postgres -f "$ROOT/supabase/tests/portal_e1_prodlike_bootstrap.sql"
"${ADMIN[@]}" -d "$DB" -f "$ROOT/supabase/tests/portal_e1_schelet.sql"
q() { "${PSQL[@]}" -Atc "$1"; }
[[ "$(q "SELECT rolsuper::text||'|'||rolcreaterole::text||'|'||rolbypassrls::text FROM pg_roles WHERE rolname=current_user")" == 'false|true|true' ]] || fail 'postgres non-superuser'
SIS="$(q 'SELECT system_identifier FROM pg_control_system()')"
runner() {
  local sha
  sha="$(sha256sum "$2" | cut -d' ' -f1)"
  PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$2" --sha256 "$sha" --versiune "$1" \
    --tinta-db "$DB" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres
}
baseline() {
  # Corpus complet al tabelelor vechi + schema, ACL, politici si functii.
  # Registrul de livrare e exclus intentionat: istoricul NU se sterge la revenire.
  "$PG_BIN/pg_dump" -h 127.0.0.1 -p "$PORT" -U supabase_admin -d "$DB" --schema=public --schema=auth \
    --exclude-table='public.conturi_*' --exclude-table='public.portal_*' \
    | sed '/^\\restrict /d; /^\\unrestrict /d' >"$1"
}
roles() {
  q "SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM pg_roles r),
    'membership',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m))" >"$1"
}
baseline "$TMP/before.sql"
roles "$TMP/roles_before.json"
ORIGINAL="$ROOT/supabase/migrations/20261118a_portal_teren_identitate.sql"
MIG="$TMP/20261118a_portal_teren_identitate.sql"
REV="$ROOT/supabase/revenire/20261118a_portal_teren_identitate_ROLLBACK.sql"
# Mai intai dovada ca artefactul nerevizuit refuza ATOMIC, fara obiecte ramase.
rc=0
runner 20261118120000 "$ORIGINAL" >"$TMP/hold.log" 2>&1 || rc=$?
[[ "$rc" == 10 ]] && grep -q PORTAL_PUBLIC_BASELINE_UNREVIEWED_OR_CHANGED "$TMP/hold.log" || { cat "$TMP/hold.log"; fail 'expected baseline HOLD'; }
[[ "$(q "SELECT count(*) FROM pg_roles WHERE rolname='teren'")" == 0 ]] || fail 'partial role after HOLD'
[[ "$(q "SELECT to_regclass('public.conturi_tip') IS NULL")" == t ]] || fail 'partial table after HOLD'
python3 "$ROOT/scripts/portal/prepare_fixture.py" "$ORIGINAL" "$MIG"
runner 20261118120000 "$MIG" >"$TMP/apply.log" 2>&1 || { cat "$TMP/apply.log"; fail apply; }
# PG17 creator has ADMIN but not necessarily SET on a newly created role.
# Harness-only role switch; never inherited by DEFINER functions.
q 'GRANT teren TO postgres WITH INHERIT FALSE, SET TRUE' >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/tests/portal_e1_1a.test.sql" >"$TMP/tests.log" 2>&1 || { cat "$TMP/tests.log"; fail tests; }
grep -q PORTAL_E1_1A_TEST_END "$TMP/tests.log" || fail 'test end marker'
[[ "$(q 'SELECT public.fn_portal_porti_lipsa()')" == '{}' ]] || fail gate
[[ -z "$("${PSQL[@]}" -At -f "$ROOT/scripts/control_0e.sql")" ]] || fail 'control 0e'
rc=0
runner 20261118120000 "$MIG" >"$TMP/reapply.log" 2>&1 || rc=$?
[[ "$rc" == 11 ]] || fail "reapply expected 11, got $rc"
# Refuzul revenirii cu istoric nou; test in tranzactie anulata integral.
if "${PSQL[@]}" --single-transaction \
  -c "SELECT set_config('gazpet.livrare_migrare','20261118a_portal_teren_identitate_ROLLBACK:'||txid_current(),true)" \
  -c "UPDATE public.conturi_tip SET sursa='fixture_new' WHERE auth_user_id='44387376-e48c-44d5-a88b-752c653c5639'" \
  -f "$REV" >"$TMP/rollback_refused.log" 2>&1; then fail 'rollback accepted changed inventory'; fi
grep -q PORTAL_ROLLBACK_NEW_DATA_OR_CONFIG "$TMP/rollback_refused.log" || { cat "$TMP/rollback_refused.log"; fail 'wrong rollback refusal'; }
if "${PSQL[@]}" --single-transaction \
  -c "SELECT set_config('gazpet.livrare_migrare','20261118a_portal_teren_identitate_ROLLBACK:'||txid_current(),true)" \
  -c 'ALTER TABLE public.conturi_tip DISABLE ROW LEVEL SECURITY' \
  -f "$REV" >"$TMP/rollback_config_refused.log" 2>&1; then fail 'rollback accepted changed RLS'; fi
grep -q PORTAL_ROLLBACK_NEW_DATA_OR_CONFIG "$TMP/rollback_config_refused.log" || { cat "$TMP/rollback_config_refused.log"; fail 'wrong config refusal'; }
runner 20261118120001 "$REV" >"$TMP/rollback.log" 2>&1 || { cat "$TMP/rollback.log"; fail rollback; }
[[ "$(q "SELECT count(*) FROM pg_roles WHERE rolname='teren'")" == 0 ]] || fail 'role left'
[[ "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('conturi_tip','conturi_teren','conturi_tip_jurnal','conturi_tip_jurnal_id_seq')")" == 0 ]] || fail 'tables left'
[[ "$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('fn_auth_token_hook','fn_teren_eligibil','fn_portal_porti_lipsa','fn_portal_public_aprobat','fn_conturi_tip_audit','fn_conturi_jurnal_imuabil')")" == 0 ]] || fail 'functions left'
baseline "$TMP/after.sql"
roles "$TMP/roles_after.json"
diff -u "$TMP/before.sql" "$TMP/after.sql" || fail 'existing schema/data/ACL changed'
diff -u "$TMP/roles_before.json" "$TMP/roles_after.json" || fail 'existing roles/membership changed'
rc=0
runner 20261118120000 "$MIG" >"$TMP/reapply_after_rollback.log" 2>&1 || rc=$?
[[ "$rc" == 11 ]] || fail 'history allows reapply after rollback'
[[ -z "$("${PSQL[@]}" -At -f "$ROOT/scripts/control_0e.sql")" ]] || fail 'rollback control 0e'
echo "PASS PORTAL_E1_1A PRODLIKE PG$PG_MAJOR (postgres NOSUPERUSER); lista PUBLIC sintetica in harness, lista revizuita (21) in migrare"
