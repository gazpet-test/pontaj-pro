#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — monitor egress follow-up (20261002a_monitor_egress_fix.sql). DOAR PG17 local dedicat
# (implicit /tmp/pg_egress_fix, 127.0.0.1:5972). Nu atinge producția.
#   0. schelet + 20260930e (= live 01.10, amprentele verificate) → suita în faza „vechi” reproduce gaurile; gate 0e = 0
#   1. fișierul fără marcaj de livrare → garda refuză
#   2. precondiție negativă (egress_detector alterat) → refuz
#   3. aplicare cu marcaj (ca runnerul: --single-transaction) → suita „fix”; gate 0e = 0
#   4. reaplicare (idempotență) → suita „fix”
#   5. rollback tehnic: nearmat → refuz; armat → amprentele 20260930e; reaplicare patch → suita „fix”
# Ieșire: 0 = PASS · 1 = eșec · 2 = mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_egress_fix}"
PORT="${PGPORT_TEST:-5972}"
BAZA=egress_fix_test
NUME=20261002a_monitor_egress_fix
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
BAZA_E="$RADACINA/supabase/migrations/20260930e_monitor_egress.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
TESTE="$RADACINA/supabase/tests/monitor_egress_fix.test.sql"
MARCAJ="SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);"
ARMARE="SELECT set_config('gazpet.rollback_tehnic_20261002a', 'REDESCHIDE_EGRESS_FIX:' || txid_current(), true);"
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG17 lipsă ($PG_BIN)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_egress_fix.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap 'ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
amprente() { q "SELECT string_agg(proname || '=' || md5(prosrc), ' ' ORDER BY proname) FROM pg_proc WHERE proname LIKE 'egress\_%'"; }
gate_0e() { local n; n="$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql" | grep -c . || true)"; [ "$n" = 0 ] || esec "gate 0e: $n rânduri"; ok "gate 0e = 0 rânduri ($1)"; }
suita() { "${PSQL[@]}" -d "$BAZA" -v faza="$1" -f "$TESTE" >/tmp/egress_fix_suita.out 2>&1 && grep -q SUITA_OK /tmp/egress_fix_suita.out || { cat /tmp/egress_fix_suita.out; esec "suita $1 ($2)"; }; grep -E '^(OK|GAURA|INFO)' /tmp/egress_fix_suita.out | sed "s/^/     [$2] /"; ok "suita $1 ($2)"; }
LIVE="egress_ciclu_start=2cc40273fe610ac844c17bb4508d6959 egress_deblocheaza=8e59b353863755dab7654d898c1806f1 egress_detector=2db8766e07f60c779aa4fd0dd6c06ef4 egress_este_owner=25c9b49412f80567bdb0b2baec4cd2f3 egress_log_descarcare=b376e5f08c48a3dbf48d0a0a1d9d1a45 egress_notifica_owner=e4165baf10b67bc65ed0865d3f434778 egress_obiect_blocat=db91e3dc3d3eee63f82324bda3f9fd5b egress_statistici=dd67c392797115482c54387408d7bcf6"

# 0. baza = live 01.10
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA"
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/monitor_egress_schelet.sql" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '20260930e_monitor_egress:' || txid_current(), true);" -f "$BAZA_E" >/dev/null 2>&1 || esec "20260930e nu se aplică"
[ "$(amprente)" = "$LIVE" ] || esec "baza ≠ amprentele live: $(amprente)"
ok "0 baza = 20260930e, amprentele = live dxczwkbciseqniprspcu (01.10)"
gate_0e "baza 20260930e"
suita vechi "20260930e"

# 1. fără marcaj
if "${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/tmp/egress_fix_apl.out 2>&1; then esec "1 psql -f fără marcaj a trecut"; fi
grep -q 'garda de livrare (start)' /tmp/egress_fix_apl.out || { cat /tmp/egress_fix_apl.out; esec "1 refuz din alt motiv"; }
[ "$(amprente)" = "$LIVE" ] || esec "1 s-a schimbat ceva"; ok "1 fără marcaj → refuz (garda start), nimic schimbat"

# 2. precondiție negativă
q "CREATE DATABASE egress_fix_neg TEMPLATE $BAZA" 2>/dev/null || "${PSQL[@]}" -d postgres -c "CREATE DATABASE egress_fix_neg TEMPLATE $BAZA"
"${PSQL[@]}" -d egress_fix_neg -c "CREATE OR REPLACE FUNCTION public.egress_detector() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ SELECT '{}'::jsonb \$f\$"
if "${PSQL[@]}" -d egress_fix_neg --single-transaction -c "$MARCAJ" -f "$MIGRARE" >/tmp/egress_fix_apl.out 2>&1; then esec "2 precondiție alterată a trecut"; fi
grep -q 'Precondiție 0b' /tmp/egress_fix_apl.out || { cat /tmp/egress_fix_apl.out; esec "2 refuz din alt motiv"; }
ok "2 egress_detector alterat → refuz Precondiție 0b"

# 3. aplicare
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "$MARCAJ" -f "$MIGRARE" >/tmp/egress_fix_apl.out 2>&1 || { cat /tmp/egress_fix_apl.out; esec "3 aplicare"; }
ok "3 aplicare cu marcaj (pre + post trecute)"
gate_0e "după 20261002a"
suita fix "20261002a"
A_FIX="$(amprente)"

# 4. reaplicare
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "$MARCAJ" -f "$MIGRARE" >/tmp/egress_fix_apl.out 2>&1 || { cat /tmp/egress_fix_apl.out; esec "4 reaplicare"; }
[ "$(amprente)" = "$A_FIX" ] || esec "4 amprente schimbate"; ok "4 reaplicare idempotentă"

# 5. rollback
if "${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >/tmp/egress_fix_apl.out 2>&1; then esec "5 rollback nearmat a trecut"; fi
ok "5 rollback nearmat → refuz"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "$ARMARE" -f "$ROLLBACK" >/tmp/egress_fix_apl.out 2>&1 || { cat /tmp/egress_fix_apl.out; esec "5 rollback armat"; }
[ "$(amprente)" = "$LIVE" ] || esec "5 rollback ≠ live"; ok "5 rollback armat → amprentele 20260930e"
gate_0e "după rollback"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "$MARCAJ" -f "$MIGRARE" >/tmp/egress_fix_apl.out 2>&1 || esec "5 reaplicare după rollback"
suita fix "reaplicat după rollback"
python3 "$RADACINA/scripts/livrare_validator.py" "$MIGRARE" >/dev/null || esec "validatorul runnerului refuză migrarea"; ok "validator runner: OK"
echo "PASS"
