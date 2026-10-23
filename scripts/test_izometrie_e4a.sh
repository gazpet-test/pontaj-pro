#!/usr/bin/env bash
# Local PG16 harness; all cluster/log files stay inside this worktree.
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
SLOT="${IZO_E4A_SLOT:-0}"
[[ "$SLOT" =~ ^[0-9]$ ]] || exit 2
PORT=$((6400 + SLOT)); BAZA=izo_e4a_test
TMP="$RADACINA/.tmp/izo_e4a_slot$SLOT"; DATE_DIR="$TMP/pg"
[[ -x "$PG_BIN/initdb" ]] || { echo 'MEDIU: PostgreSQL 16 lipsa'; exit 2; }
[[ ! -e "$DATE_DIR" ]] || { echo 'MEDIU: slot existent; alege alt slot'; exit 2; }
mkdir -p "$TMP"
export TMPDIR="$TMP"
[[ "$(id -u)" != 0 ]] || { echo 'MEDIU: ruleaza ca utilizator PG local, fara root'; exit 2; }
"$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >"$TMP/init.log"
"$PG_BIN/pg_ctl" -D "$DATE_DIR" -l "$TMP/pg.log" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='$TMP'"
trap '"$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true' EXIT
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
esec() { echo "ESEC: $*" >&2; exit 1; }
livreaza() {
  local sha sis
  sha="$(sha256sum "$2" | cut -d' ' -f1)"
  sis="$(q 'SELECT system_identifier FROM pg_control_system()')"
  PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$2" --sha256 "$sha" --versiune "$1" \
    --tinta-db "$BAZA" --tinta-sistem "$sis" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >"$TMP/runner.log" 2>&1 \
    || { cat "$TMP/runner.log"; esec runner; }
}
rev() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_$1','$2:' || txid_current(),true)" -f "$3"; }
baseline() { q "SELECT jsonb_build_array(obj_description('public.magazie_bucati_evenimente'::regclass,'pg_class'),
  public.fn_izo_porti_definitii(),public.fn_izo_porti_e3_definitii(),public.fn_izo_porti_e3b_definitii(),
  obj_description('public.fn_izo_porti_definitii()'::regprocedure,'pg_proc'),
  obj_description('public.fn_izo_porti_e3_definitii()'::regprocedure,'pg_proc'),
  obj_description('public.fn_izo_porti_e3b_definitii()'::regprocedure,'pg_proc'))"; }
M="$RADACINA/supabase/migrations"; V="$RADACINA/supabase/revenire"
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA"
for f in izometrie_e2a_schelet.sql izometrie_e3_schelet.sql izometrie_e4a_schelet.sql; do
  "${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/$f" >/dev/null
done
q 'CREATE SCHEMA net; CREATE SEQUENCE net.http_request_queue_id_seq; GRANT USAGE, SELECT, UPDATE ON SEQUENCE net.http_request_queue_id_seq TO PUBLIC' >/dev/null
livreaza 20261102120000 "$M/20261102a_izometrie_e2a_registru.sql"
livreaza 20261102140000 "$M/20261102c_izometrie_cai_vechi_stoc.sql"
livreaza 20261103120000 "$M/20261103b_izometrie_e3_documente.sql"
livreaza 20261106120000 "$M/20261106a_izometrie_e3b_corectii.sql"
INAINTE="$(baseline)"
livreaza 20261109120000 "$M/20261109a_izometrie_e4a_flux.sql"
[[ "$(q 'SELECT public.fn_izo_porti_lipsa()')" == '{}' ]] || esec poarta
[[ -z "$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql")" ]] || esec control_0e
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e4a.test.sql"
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e4a_pachet.test.sql" >"$TMP/pachet.log"
grep -q 'E4A2_PACHET_END' "$TMP/pachet.log" || esec 'pachet end marker'
# Reapply through the runner with conflicting version must be refused before DDL.
sha="$(sha256sum "$M/20261109a_izometrie_e4a_flux.sql" | cut -d' ' -f1)"
sis="$(q 'SELECT system_identifier FROM pg_control_system()')"
if PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$M/20261109a_izometrie_e4a_flux.sql" \
  --sha256 "$sha" --versiune 20261109120001 --tinta-db "$BAZA" --tinta-sistem "$sis" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >"$TMP/reapply.log" 2>&1; then esec reaplicare; fi
grep -q 'CONFLICT' "$TMP/reapply.log" || { cat "$TMP/reapply.log"; esec 'alt motiv reaplicare'; }
rev 20261109a IZO_E4A_SCOATE "$V/20261109a_izometrie_e4a_flux_ROLLBACK.sql"
[[ "$(baseline)" == "$INAINTE" ]] || esec 'rollback E4a inexact'
rev 20261106a IZO_E3B_SCOATE "$V/20261106a_izometrie_e3b_corectii_ROLLBACK.sql"
[[ "$(q 'SELECT public.fn_izo_porti_lipsa()')" == '{}' ]] || esec 'rollback E3b'
echo 'PASS E4a: gate/control/catalog/guards/reapply/rollback exact/E3b rollback'
