#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261006a_sec_f1b_maintain_revoke. EXCLUSIV pe un PostgreSQL 17 local dedicat
# (implicit /tmp/pg_sec_f1b, 127.0.0.1:5973). Nu atinge producția.
#   0. fixture (supabase/tests/sec_f1b_maintain_fixture.sql) = lista live 01.10 (477 relații, md5 41e9610b…); REINDEX ca
#      authenticated reușește (gaura)
#   1. fișierul fără runner → garda refuză, nimic schimbat
#   2. relație nouă cu MAINTAIN (lista s-a schimbat) → precondiția 0d refuză
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + gate 0e) → cod 0; 0 relații cu MAINTAIN; REINDEX/VACUUM refuzate; LOCK rămâne prin UPDATE/DELETE;
#      tabel nou fără MAINTAIN; service_role neatins
#   4. reaplicare directă cu marcaj → trece (idempotent)
#   5. revenire: nearmată → refuz; armată → exact lista din 01.10 (md5 41e9610b…)
# Utilizare: bash scripts/test_sec_f1b_maintain.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_sec_f1b}"
PORT="${PGPORT_TEST:-5973}"
BAZA=sec_f1b_test
NUME=20261006a_sec_f1b_maintain_revoke
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
FIXTURE="$RADACINA/supabase/tests/sec_f1b_maintain_fixture.sql"
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
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_sec_f1b.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
FP="SELECT count(*) || '/' || coalesce(md5(string_agg(x.k||':'||x.relname||':'||x.a::text||':'||x.u::text, ',' ORDER BY x.relname)),'-') FROM (SELECT c.relkind::text k, c.relname::text relname, has_table_privilege('anon',c.oid,'MAINTAIN') a, has_table_privilege('authenticated',c.oid,'MAINTAIN') u FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')) x WHERE x.a OR x.u"
LIVE=477/41e9610b39f6609d9f34a21d302360d2
SR="SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND has_table_privilege('service_role',c.oid,'MAINTAIN')"
ca_auth() { "${PSQL[@]}" -d "$BAZA" -Atc "BEGIN; SET LOCAL ROLE authenticated; $1; ROLLBACK;" >/dev/null 2>&1 && echo da || echo nu; }
marcaj() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE"; }

"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$FIXTURE" >/dev/null
"${PSQL[@]}" -d "$BAZA" -c "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);" >/dev/null
[ "$(q "$FP")" = "$LIVE" ] || esec "0 fixture ≠ lista live: $(q "$FP")"
[ "$(ca_auth 'REINDEX TABLE public.garantii')" = da ] || esec "0 REINDEX ca authenticated ar trebui să reușească (gaura)"
SR0="$(q "$SR")"
ok "0 fixture = lista live ($LIVE); REINDEX ca authenticated reușește (gaura)"

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
[ "$(q "$FP")" = "$LIVE" ] || esec "1 stare schimbată"
ok "1 fără runner → refuz"

q "CREATE TABLE public.tabel_nou_dupa_0110 (id int)" >/dev/null
marcaj >/dev/null 2>&1 && esec "2 precondiția 0d a trecut cu o relație în plus"
q "DROP TABLE public.tabel_nou_dupa_0110" >/dev/null
[ "$(q "$FP")" = "$LIVE" ] || esec "2 stare schimbată"
ok "2 listă schimbată (relație nouă) → precondiția 0d refuză"

SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261006000001 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/sec_f1b_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/sec_f1b_runner.out >&2; esec "3 runner cod $RC"; }
[ "$(q "$FP")" = "0/-" ] || esec "3 mai sunt relații cu MAINTAIN: $(q "$FP")"
[ "$(q "$SR")" = "$SR0" ] || esec "3 service_role schimbat"
[ "$(ca_auth 'REINDEX TABLE public.garantii')" = nu ] || esec "3 REINDEX ca authenticated încă reușește"
# LOCK TABLE rămâne posibil prin UPDATE/DELETE (PG: ACCESS EXCLUSIVE cere MAINTAIN, UPDATE, DELETE sau TRUNCATE) — limită documentată
[ "$(ca_auth 'LOCK TABLE public.garantii IN ACCESS EXCLUSIVE MODE')" = da ] || esec "3 LOCK: comportament neașteptat (documentația spune că rămâne prin UPDATE/DELETE)"
"${PSQL[@]}" -d "$BAZA" -c "SET ROLE authenticated" -c "VACUUM public.garantii" 2>&1 | grep -q -i "permission denied\|skipping" || esec "3 VACUUM nu e refuzat"
q "CREATE TABLE public.tabel_nou (id int)" >/dev/null
[ "$(q "SELECT format('%s%s%s', has_table_privilege('authenticated','public.tabel_nou','MAINTAIN'), has_table_privilege('anon','public.tabel_nou','MAINTAIN'), has_table_privilege('authenticated','public.tabel_nou','SELECT'))")" = fft ] || esec "3 tabel nou: setarea implicită"
q "DROP TABLE public.tabel_nou" >/dev/null
[ "$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql" | grep -c . || true)" = 0 ] || esec "gate 0e"
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0); 0 MAINTAIN; REINDEX/VACUUM refuzate; LOCK rămâne prin UPDATE/DELETE; tabel nou fără MAINTAIN, SELECT păstrat; service_role=$SR0"

marcaj >/dev/null 2>&1 || esec "4 reaplicare idempotentă a eșuat"
ok "4 reaplicare cu marcaj → trece (idempotent, 0 relații)"

"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >/dev/null 2>&1 && esec "5 revenire nearmată a trecut"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.rollback_tehnic_20261006a', 'REDESCHIDE_MAINTAIN:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null || esec "5 revenire armată"
[ "$(q "$FP")" = "$LIVE" ] || esec "5 după revenire: $(q "$FP")"
ok "5 revenire: nearmată refuz; armată → exact lista din 01.10 ($LIVE)"
echo "PASS test_sec_f1b_maintain (sha256 $SHA)"
