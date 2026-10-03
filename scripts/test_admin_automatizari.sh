#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261010a_admin_automatizari. EXCLUSIV pe un PostgreSQL 17 local dedicat
# (implicit /tmp/pg_admin_automatizari, 127.0.0.1:5974). Nu atinge producția.
#   0. schelet (supabase/tests/admin_automatizari_schelet.sql) = helperii live (md5) + default privileges live
#   1. fișierul fără runner → garda refuză, tabelul nu apare
#   2. precondiție negativă (tabel existent) → refuz
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + gate 0e) → cod 0
#   4. acces: owner vede rândurile, colegul 0, anon refuzat; authenticated nu scrie; service_role scrie; updated_at se atinge
#   5. reaplicare cu marcaj → refuz
#   6. revenire: nearmată → refuz; armată → tabelul dispare
# Utilizare: bash scripts/test_admin_automatizari.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_admin_automatizari}"
PORT="${PGPORT_TEST:-5974}"
BAZA=admin_automatizari_test
NUME=20261010a_admin_automatizari
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/admin_automatizari_schelet.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG17 lipsă ($PG_BIN)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_admin_automatizari.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
gate_0e() { local n; n="$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql" | grep -c . || true)"; [ "$n" = 0 ] || esec "gate 0e: $n rânduri"; ok "gate 0e = 0 ($1)"; }
# ca <rol> <uid-sufix|-> <sql> → ieșirea (sau ERR) rulată ca rolul dat, anulată la final
ca() {
  local rol=$1 uid=$2 sql=$3 set_uid=""
  [ "$uid" = - ] || set_uid="SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000$uid', true) IS NULL AS _ \\g /dev/null"
  local out
  out="$("${PSQL[@]}" -d "$BAZA" -At 2>/dev/null <<SQL
BEGIN;
$set_uid
SET LOCAL ROLE $rol;
$sql;
ROLLBACK;
SQL
)" || { echo ERR; return 0; }
  echo "$out"
}

"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
"${PSQL[@]}" -d "$BAZA" -c "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);" >/dev/null
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_is_app_owner(uuid)'::regprocedure")" = 8d335ed3fe345d3bf95ef0f1b2f8850a ] || esec "0 fn_is_app_owner diferă de live"
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_comercial_touch_updated_at()'::regprocedure")" = 5bdc21b8fa8fb1231bdb021e09a5bc8e ] || esec "0 touch diferă de live"
ok "0 schelet = helperii live (md5)"

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
[ -z "$(q "SELECT to_regclass('public.automatizari')")" ] || esec "1 tabelul a apărut"
ok "1 fără runner → refuz"

q "CREATE TABLE public.automatizari (id int)" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null 2>&1 && esec "2 precondiție negativă a trecut"
q "DROP TABLE public.automatizari" >/dev/null
ok "2 tabel existent → refuz"

SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261010000001 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/admin_autom_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/admin_autom_runner.out >&2; esec "3 runner cod $RC"; }
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA"
gate_0e dupa

q "INSERT INTO public.automatizari (cod, nume, tip, unde, ce_face, secrete_nume) VALUES ('test_unu','Test unu','cron_bd','Supabase pg_cron','x','X_SECRET'), ('test_doi','Test doi','script_pc','PC','y',NULL)" >/dev/null
[ "$(ca authenticated 1 "SELECT count(*) FROM public.automatizari")" = 2 ] || esec "4 ownerul nu vede 2 rânduri"
[ "$(ca authenticated 2 "SELECT count(*) FROM public.automatizari")" = 0 ] || esec "4 colegul vede rânduri"
[ "$(ca authenticated - "SELECT count(*) FROM public.automatizari")" = 0 ] || esec "4 fără uid vede rânduri"
[ "$(ca anon - "SELECT count(*) FROM public.automatizari")" = ERR ] || esec "4 anon poate citi"
for s in "INSERT INTO public.automatizari (cod, nume, tip, unde, ce_face) VALUES ('rau_x','Rau','extern','x','x')" \
         "UPDATE public.automatizari SET nume='Hack'" "DELETE FROM public.automatizari" "TRUNCATE public.automatizari"; do
  [ "$(ca authenticated 1 "$s")" = ERR ] || esec "4 ownerul poate scrie din API: $s"
  [ "$(ca anon - "$s")" = ERR ] || esec "4 anon poate scrie: $s"
done
for s in "SELECT count(*) FROM public.automatizari" "INSERT INTO public.automatizari (cod, nume, tip, unde, ce_face) VALUES ('svc_x','Svc','extern','x','x')" \
         "UPDATE public.automatizari SET nume='Svc'" "DELETE FROM public.automatizari" "TRUNCATE public.automatizari" \
         "SELECT nextval(pg_get_serial_sequence('public.automatizari','id'))"; do
  [ "$(ca service_role - "$s")" = ERR ] || esec "4 service_role are acces: $s"
done
[ "$(ca authenticated 1 "SELECT nextval(pg_get_serial_sequence('public.automatizari','id'))")" = ERR ] || esec "4 authenticated poate folosi secvența"
[ "$(q "SELECT count(*) FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = pg_get_serial_sequence('public.automatizari','id')::regclass AND a.grantee <> c.relowner")" = 0 ] || esec "4 secvența are drepturi în afara ownerului"
[ "$(q "SELECT string_agg(coalesce(pg_get_userbyid(nullif(a.grantee,0)),'PUBLIC')||'='||a.privilege_type, ',') FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.automatizari'::regclass AND a.grantee <> c.relowner")" = authenticated=SELECT ] || esec "4 ACL tabel nu e exact authenticated=SELECT"
[ "$(ca authenticated 1 "SELECT count(*) FROM public.automatizari WHERE tip='altceva'")" = 0 ] || esec "4 filtru"
q "INSERT INTO public.automatizari (cod, nume, tip, unde, ce_face) VALUES ('Rau cod','x','cron_bd','x','x')" >/dev/null 2>&1 && esec "4 CHECK cod a trecut"
q "INSERT INTO public.automatizari (cod, nume, tip, unde, ce_face) VALUES ('tip_rau','xyz','altceva','x','x')" >/dev/null 2>&1 && esec "4 CHECK tip a trecut"
q "UPDATE public.automatizari SET updated_at = now() - interval '1 day' WHERE cod='test_unu'" >/dev/null
q "UPDATE public.automatizari SET stare='oprit' WHERE cod='test_unu'" >/dev/null
[ "$(q "SELECT updated_at > now() - interval '1 minute' FROM public.automatizari WHERE cod='test_unu'")" = t ] || esec "4 updated_at nu s-a atins"
ok "4 acces: owner 2/coleg 0/anon refuz · scriere din API refuzată · service_role fără niciun drept · secvență închisă · ACL exact · CHECK-uri · updated_at"

"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null 2>&1 && esec "5 reaplicare a trecut"
ok "5 reaplicare → refuz"

"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >/dev/null 2>&1 && esec "6 revenire nearmată a trecut"
[ -n "$(q "SELECT to_regclass('public.automatizari')")" ] || esec "6 nearmată a șters tabelul"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261010a', 'STERGE_AUTOMATIZARI:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null 2>&1 && esec "6 armată fără armarea datelor a trecut cu rânduri în tabel"
[ "$(q "SELECT count(*) FROM public.automatizari")" = 2 ] || esec "6 rândurile s-au pierdut"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261010a', 'STERGE_AUTOMATIZARI:' || txid_current(), true); SELECT set_config('gazpet.revenire_20261010a_date', 'STERGE_SI_RANDURILE:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null || esec "6 revenire armată + date"
[ -z "$(q "SELECT to_regclass('public.automatizari')")" ] || esec "6 tabelul a rămas"
ok "6 revenire: nearmată refuz · armată cu rânduri fără armarea datelor refuz · dublu armată → tabelul dispare"
echo "PASS test_admin_automatizari (sha256 $SHA)"
