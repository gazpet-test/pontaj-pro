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
"${ADMIN[@]}" -d "$DB" -f "$ROOT/supabase/tests/portal_e1_1b_fixture.sql"
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
  # Schema/ACL separat; datele sunt citite explicit in ordinea cheii primare.
  # Stub-ul este singurul obiect pastrat intentionat dupa revenirea 18a; testat separat.
  "$PG_BIN/pg_dump" -h 127.0.0.1 -p "$PORT" -U supabase_admin -d "$DB" --schema=public --schema=auth --schema-only \
    --exclude-table='public.conturi_*' --exclude-table='public.portal_*' \
    | python3 "$ROOT/scripts/portal/snapshot_schema.py" "${2:-full}" >"$1"
  local snapshot_sql
  q "SELECT format('SELECT %L, coalesce(jsonb_agg(to_jsonb(t) ORDER BY %s), ''[]''::jsonb) FROM %I.%I t;',
    n.nspname||'.'||c.relname,
    coalesce((SELECT string_agg(format('t.%I',a.attname),',' ORDER BY k.ord)
      FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
      WHERE i.indrelid=c.oid AND i.indisprimary), 'to_jsonb(t)::text'),n.nspname,c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p')
      AND c.relname NOT LIKE 'conturi_%' AND c.relname NOT LIKE 'portal_%'
    ORDER BY n.nspname,c.relname" >"$TMP/snapshot_queries.sql" || return 1
  while IFS= read -r snapshot_sql; do
    q "$snapshot_sql" >>"$1" || return 1
  done <"$TMP/snapshot_queries.sql"
  q "SELECT format('SELECT %L,last_value,is_called FROM %I.%I ORDER BY last_value;',n.nspname||'.'||c.relname,n.nspname,c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth') AND c.relkind='S'
      AND c.relname NOT LIKE 'conturi_%' AND c.relname NOT LIKE 'portal_%'
    ORDER BY n.nspname,c.relname" >"$TMP/snapshot_sequences.sql" || return 1
  while IFS= read -r snapshot_sql; do
    q "$snapshot_sql" >>"$1" || return 1
  done <"$TMP/snapshot_sequences.sql"
}

roles() {
  q "SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM pg_roles r),
    'membership',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m))" >"$1"
}
baseline "$TMP/before.sql" omit-stub
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
MIG_1B="$ROOT/supabase/migrations/20261119a_portal_teren_provisioning.sql"
REV_1B="$ROOT/supabase/revenire/20261119a_portal_teren_provisioning_ROLLBACK.sql"
baseline "$TMP/before_1b.sql"
runner 20261119120000 "$MIG_1B" >"$TMP/apply_1b.log" 2>&1 || { cat "$TMP/apply_1b.log"; fail 'apply E1-1b'; }
[[ "$(q 'SELECT public.fn_portal_porti_lipsa_1b()')" == '{}' ]] || fail 'gate E1-1b'
[[ -z "$("${PSQL[@]}" -At -f "$ROOT/scripts/control_0e.sql")" ]] || fail 'E1-1b control 0e'
"${PSQL[@]}" -f "$ROOT/supabase/tests/portal_e1_1b.test.sql" >"$TMP/tests_1b.log" 2>&1 || { cat "$TMP/tests_1b.log"; fail 'tests E1-1b'; }
grep -q PORTAL_E1_1B_TEST_END "$TMP/tests_1b.log" || fail 'test end E1-1b'
# Regresiile E1-1a raman active si dupa schimbarea provisioning-ului.
"${PSQL[@]}" -f "$ROOT/supabase/tests/portal_e1_1a.test.sql" >"$TMP/regression_1a.log" 2>&1 || { cat "$TMP/regression_1a.log"; fail 'regression E1-1a'; }
source "$ROOT/scripts/portal/concurrency_1b.sh"
if "${PSQL[@]}" --single-transaction \
 -c "SELECT set_config('gazpet.livrare_migrare','20261119a_portal_teren_provisioning_ROLLBACK:'||txid_current(),true)" \
 -c "INSERT INTO public.portal_provisioning(provisioning_id,employee_id,email_calculat,stare,cerut_de,payload_sha256) VALUES ('10000000-0000-0000-0000-000000000077',55,'new.fixture@teren.gazpet.ro','rezervat','00000000-0000-0000-0000-000000000001',sha256('fixture'::bytea))" \
 -f "$REV_1B" >"$TMP/rollback_1b_data_refused.log" 2>&1; then fail 'E1-1b rollback accepted new history'; fi
grep -q PORTAL_1B_ROLLBACK_NEW_DATA_OR_CONFIG "$TMP/rollback_1b_data_refused.log" || fail 'wrong E1-1b rollback data refusal'
if "${PSQL[@]}" --single-transaction \
 -c "SELECT set_config('gazpet.livrare_migrare','20261119a_portal_teren_provisioning_ROLLBACK:'||txid_current(),true)" \
 -c 'ALTER TABLE public.portal_provisioning DISABLE ROW LEVEL SECURITY' \
 -f "$REV_1B" >"$TMP/rollback_1b_config_refused.log" 2>&1; then fail 'E1-1b rollback accepted RLS drift'; fi
grep -q PORTAL_1B_ROLLBACK_NEW_DATA_OR_CONFIG "$TMP/rollback_1b_config_refused.log" || fail 'wrong E1-1b rollback config refusal'
# Apply -> rollback -> re-apply direct, tranzactional, pentru DDL. Runnerul refuza intentionat relivrarea aceluiasi nume.
"${PSQL[@]}" --single-transaction \
 -c "SELECT set_config('gazpet.livrare_migrare','20261119a_portal_teren_provisioning_ROLLBACK:'||txid_current(),true)" \
 -f "$REV_1B" \
 -c "SELECT set_config('gazpet.livrare_migrare','20261119a_portal_teren_provisioning:'||txid_current(),true)" \
 -f "$MIG_1B" >"$TMP/roundtrip_1b.log" 2>&1 || { cat "$TMP/roundtrip_1b.log"; fail 'E1-1b DDL roundtrip'; }
runner 20261119120001 "$REV_1B" >"$TMP/rollback_1b.log" 2>&1 || { cat "$TMP/rollback_1b.log"; fail 'rollback E1-1b'; }
# Regresie pentru ordinea fizica: UPDATE fara schimbare semantica, snapshot identic.
baseline "$TMP/order_before.sql"
q "UPDATE public.profiles SET email=email WHERE id='00000000-0000-0000-0000-000000000002'" >/dev/null
baseline "$TMP/order_after.sql"
diff -u "$TMP/order_before.sql" "$TMP/order_after.sql" || fail 'snapshot depends on physical row order'
baseline "$TMP/after_1b.sql"
diff -u "$TMP/before_1b.sql" "$TMP/after_1b.sql" || fail 'E1-1b changed original handle/ACL/schema/data'
[[ "$(q "SELECT to_regclass('public.portal_provisioning') IS NULL AND to_regprocedure('public.fn_portal_cont_finalizeaza(uuid)') IS NULL")" == t ]] || fail 'E1-1b objects left'
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
if runner 20261118120001 "$REV" >"$TMP/no_attestation.log" 2>&1; then fail 'rollback accepted missing Auth attestation'; fi
grep -q PORTAL_AUTH_HOOK_ATTESTATION_REQUIRED "$TMP/no_attestation.log" || { cat "$TMP/no_attestation.log"; fail 'wrong Auth attestation refusal'; }
# Atestare simulata EXCLUSIV in copia harness; SQL-ul de productie continua sa o ceara operatorului.
ATTESTED_REV="$TMP/20261118a_portal_teren_identitate_ROLLBACK.sql"
python3 - "$REV" "$ATTESTED_REV" <<'PY'
from pathlib import Path
import sys
source, target = map(Path, sys.argv[1:])
target.write_text("SELECT set_config('gazpet.hook_auth_dezactivat','ATEST:'||txid_current(),true);\n" + source.read_text(encoding='utf-8'), encoding='utf-8')
PY
runner 20261118120001 "$ATTESTED_REV" >"$TMP/rollback.log" 2>&1 || { cat "$TMP/rollback.log"; fail rollback; }
[[ "$(q "SELECT count(*) FROM pg_roles WHERE rolname='teren'")" == 0 ]] || fail 'role left'
[[ "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('conturi_tip','conturi_teren','conturi_tip_jurnal','conturi_tip_jurnal_id_seq')")" == 0 ]] || fail 'tables left'
[[ "$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('fn_portal_public_md5','fn_portal_catalog_amprenta','fn_teren_eligibil','fn_portal_porti_lipsa','fn_portal_public_aprobat','fn_conturi_tip_audit','fn_conturi_jurnal_imuabil')")" == 0 ]] || fail 'functions left'
"${PSQL[@]}" -f "$ROOT/supabase/tests/portal_e1_stub.test.sql" >"$TMP/stub.log" 2>&1 || { cat "$TMP/stub.log"; fail stub; }
baseline "$TMP/after.sql" omit-stub
roles "$TMP/roles_after.json"
diff -u "$TMP/before.sql" "$TMP/after.sql" || fail 'existing schema/data/ACL changed'
diff -u "$TMP/roles_before.json" "$TMP/roles_after.json" || fail 'existing roles/membership changed'
rc=0
runner 20261118120000 "$MIG" >"$TMP/reapply_after_rollback.log" 2>&1 || rc=$?
[[ "$rc" == 11 ]] || fail 'history allows reapply after rollback'
[[ -z "$("${PSQL[@]}" -At -f "$ROOT/scripts/control_0e.sql")" ]] || fail 'rollback control 0e'
echo "PASS PORTAL_E1_1A+1B PRODLIKE PG$PG_MAJOR (postgres NOSUPERUSER); lista PUBLIC sintetica in harness, lista revizuita (21) in migrare"
