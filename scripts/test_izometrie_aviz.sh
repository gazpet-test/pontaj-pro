#!/usr/bin/env bash
# Fresh local PG16 only. No credentials, production connections or Git.
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
SLOT="${IZO_AVIZ_SLOT:-0}"; [[ "$SLOT" =~ ^[0-9]$ ]] || exit 2
PORT=$((6600 + SLOT)); BAZA=izo_aviz_test
TMP="$RADACINA/.tmp/izo_aviz_slot$SLOT"; DATE_DIR="$TMP/pg"
[[ -x "$PG_BIN/initdb" ]] || { echo 'MEDIU: PostgreSQL 16 lipsa'; exit 2; }
[[ ! -e "$DATE_DIR" ]] || { echo 'MEDIU: slot existent'; exit 2; }
[[ "$(id -u)" != 0 ]] || { echo 'MEDIU: foloseste utilizator PG local, fara root'; exit 2; }
mkdir -p "$TMP"; export TMPDIR="$TMP"
"$PG_BIN/initdb" -D "$DATE_DIR" -U supabase_admin --auth=trust --encoding=UTF8 --locale=C.UTF-8 >"$TMP/init.log"
"$PG_BIN/pg_ctl" -D "$DATE_DIR" -l "$TMP/pg.log" -w -t 30 start -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='$TMP'"
trap '"$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true' EXIT
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
ADMIN=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U supabase_admin)
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
esec() { echo "ESEC: $*" >&2; exit 1; }
runner() {
 local sha sis
 sha="$(sha256sum "$2" | cut -d' ' -f1)"; sis="$(q 'SELECT system_identifier FROM pg_control_system()')"
 PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$2" --sha256 "$sha" --versiune "$1" \
 --tinta-db "$BAZA" --tinta-sistem "$sis" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres
}
livreaza() { runner "$@" >"$TMP/runner.log" 2>&1 || { cat "$TMP/runner.log"; esec runner; }; }
teste_sql() {
 # Preserve \ir directory: assemble test with its fixture before copying.
 local copie="$TMP/run_$(basename "$1")"
 sed 's/\r$//; s/^RESET SESSION AUTHORIZATION;$/SET SESSION AUTHORIZATION postgres;/' "$1" >"$copie"
 "${ADMIN[@]}" -d "$BAZA" -c 'SET SESSION AUTHORIZATION postgres' -f "$copie"
}
baseline() { q "SELECT jsonb_build_array(
 public.fn_izo_porti_definitii(),public.fn_izo_porti_e3_definitii(),public.fn_izo_porti_e3b_definitii(),public.fn_izo_porti_e4_definitii(),public.fn_izo_porti_e4b_definitii(),
 obj_description('public.magazie_bucati_evenimente'::regclass,'pg_class'),
 (SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,md5(p.prosrc),p.proowner,p.proacl,p.proconfig,obj_description(p.oid,'pg_proc')) ORDER BY p.oid::regprocedure::text)
 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'fn\_izo\_%'),
 (SELECT jsonb_agg(jsonb_build_array(polname,polcmd,polroles,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) ORDER BY polname) FROM pg_policy WHERE polrelid='storage.objects'::regclass))"; }
M="$RADACINA/supabase/migrations"; V="$RADACINA/supabase/revenire"; T="$RADACINA/supabase/tests"
"${ADMIN[@]}" -d postgres -f "$T/izometrie_e4b_prodlike_bootstrap.sql"
"${ADMIN[@]}" -d postgres -c "CREATE DATABASE $BAZA OWNER postgres"
for f in izometrie_e2a_schelet.sql izometrie_e3_schelet.sql izometrie_e4a_schelet.sql izometrie_e4b_schelet.sql izometrie_aviz_schelet.sql; do
 "${ADMIN[@]}" -d "$BAZA" -f "$T/$f" >"$TMP/$f.log"
done
"${ADMIN[@]}" -d "$BAZA" -f "$T/izometrie_e4b_prodlike_owners.sql"
q 'CREATE SCHEMA net; CREATE SEQUENCE net.http_request_queue_id_seq; GRANT USAGE, SELECT, UPDATE ON SEQUENCE net.http_request_queue_id_seq TO PUBLIC' >/dev/null
livreaza 20261102120000 "$M/20261102a_izometrie_e2a_registru.sql"
livreaza 20261102140000 "$M/20261102c_izometrie_cai_vechi_stoc.sql"
livreaza 20261103120000 "$M/20261103b_izometrie_e3_documente.sql"
livreaza 20261106120000 "$M/20261106a_izometrie_e3b_corectii.sql"
livreaza 20261109120000 "$M/20261109a_izometrie_e4a_flux.sql"
"${ADMIN[@]}" -d "$BAZA" -c 'REVOKE supabase_storage_admin FROM postgres'
"${PSQL[@]}" -d "$BAZA" -f "$T/izometrie_e4b_prodlike_check.sql"
livreaza 20261109140000 "$M/20261109b_izometrie_e4b_teren.sql"
"${PSQL[@]}" -d "$BAZA" -f "$T/izometrie_e4c_gps_cron_schelet.sql"
livreaza 20261111120000 "$M/20261111a_izometrie_gps_curatare.sql"
INAINTE="$(baseline)"
# Pe prod, postgres a creat și a șters politici pe storage.objects la E3 / E4a (docs/izometrie/E4A_LIVRARE.md).
# Local, aceeași capacitate vine din apartenența la ownerul Storage, revocată mai sus doar pentru baseline-ul E4b.
"${ADMIN[@]}" -d "$BAZA" -c 'GRANT supabase_storage_admin TO postgres'
livreaza 20261120120000 "$M/20261120a_izometrie_aviz_iesire.sql"
rc=0; runner 20261120120000 "$M/20261120a_izometrie_aviz_iesire.sql" >"$TMP/reapply.log" 2>&1 || rc=$?
[[ "$rc" == 11 ]] || esec "reapply expected 11 got $rc"
poarta() {
 [[ "$(q 'SELECT public.fn_izo_porti_lipsa()')" == '{}' ]] || esec poarta
 [[ "$(q 'SELECT public.fn_izo_porti_e4_lipsa()')" == '{}' ]] || esec poarta_e4
 [[ -z "$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql")" ]] || esec control_0e
}
poarta
# Assemble fixture in the same transaction, without changing any existing skeleton.
{ echo BEGIN\;; cat "$T/izometrie_aviz_fixture.sql" "$T/izometrie_aviz.test.sql"; } >"$TMP/aviz_full.sql"
teste_sql "$TMP/aviz_full.sql" >"$TMP/tests.log"
grep -q IZO_AVIZ_TEST_END "$TMP/tests.log" || esec end_marker
for f in izometrie_e4b.test.sql izometrie_e4b_aprobare.test.sql izometrie_e4b_normalizare.test.sql izometrie_e4c_gps.test.sql; do teste_sql "$T/$f" >"$TMP/$f.log"; done
ARM="SELECT set_config('gazpet.revenire_20261120a','IZO_AVIZ_SCOATE:'||txid_current(),true)"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "$ARM" -f "$V/20261120a_izometrie_aviz_iesire_ROLLBACK.sql" >"$TMP/rollback.log"
[[ "$(baseline)" == "$INAINTE" ]] || esec 'revenire inexacta'
poarta
# Same transaction history stays in the local runner log: remove ONLY this local
# delivery marker so the exact artifact can be applied again through runner.
q "DELETE FROM supabase_migrations.schema_migrations WHERE version='20261120120000'" >/dev/null
livreaza 20261120120000 "$M/20261120a_izometrie_aviz_iesire.sql"
poarta
# Committed fixtures for genuine concurrent sessions, fresh isolated database only.
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$T/izometrie_aviz_fixture.sql" >"$TMP/concurrent_fixture.log"
source "$RADACINA/scripts/izometrie/aviz/concurenta.sh"
if "${PSQL[@]}" -d "$BAZA" --single-transaction -c "$ARM" -f "$V/20261120a_izometrie_aviz_iesire_ROLLBACK.sql" >"$TMP/refuz.log" 2>&1; then esec 'revenire cu date acceptata'; fi
grep -q 'date existente' "$TMP/refuz.log" || { cat "$TMP/refuz.log"; esec 'motiv revenire gresit'; }
poarta
echo 'PASS AVIZ: prodlike PG16, reapply=11, gates/0e, rollback exact, rollback data refusal, real concurrency'
