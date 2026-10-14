#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261030b_executie_contract_id_unic (TKT-2026-0333, PR #709). DOAR PG17 local dedicat
# (implicit /tmp/pg_contract_unic, 127.0.0.1:5974). Nu atinge producția.
#   0. schelet (= structura live 14.10, fără index) → baza; suita pe baza fără index TREBUIE să cadă (discriminare)
#   1. precondiție negativă: un contract legat de două proiecte → migrarea refuză (PRECONDIȚIE), indexul nu apare
#   2. aplicare (ca runnerul: --single-transaction) → suita
#   3. reaplicare (idempotență) → suita
#   4. revenire → indexul dispare, aceeași dublare trece; reaplicare → suita
# Ieșire: 0 = PASS · 1 = eșec · 2 = mediu.  PG_BIN se poate suprascrie (ex. pe Windows: /c/Users/Public/pgsql/bin).
# ============================================================================
set -Eeuo pipefail
export PGCLIENTENCODING=UTF8
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_contract_unic}"
PORT="${PGPORT_TEST:-5974}"
BAZA=contract_unic_test
NUME=20261030b_executie_contract_id_unic
MIGRARE_SURSA="$RADACINA/supabase/migrations/$NUME.sql"
# migrarea are garda de livrare: aici se armează ca runnerul (marcaj local, aceeași tranzacție)
MIGRARE="$(mktemp)"
{ echo "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);"; cat "$MIGRARE_SURSA"; } > "$MIGRARE"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/executie_contract_id_unic_schelet.sql"
TESTE="$RADACINA/supabase/tests/executie_contract_id_unic.test.sql"
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
EXE=""; SOCKET=(-c unix_socket_directories=/tmp)
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) EXE=".exe"; SOCKET=() ;; esac
PSQL=("$PG_BIN/psql$EXE" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb$EXE" ] || mediu "PG17 lipsă ($PG_BIN)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"
ca_postgres "$PG_BIN/initdb$EXE" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --no-locale >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -l "$DATE_DIR.log" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 ${SOCKET[*]}" >/dev/null || mediu "pg_ctl start"
trap 'ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; rm -f "$MIGRARE"; true' EXIT
q() { "${PSQL[@]}" -d "$1" -Atc "$2"; }
index_exista() { [ "$(q "$1" "SELECT to_regclass('public.executie_proiecte_contract_id_unic') IS NOT NULL")" = t ]; }
OUT="$DATE_DIR.out"
suita() { "${PSQL[@]}" -d "$BAZA" -f "$TESTE" >"$OUT" 2>&1 && grep -q SUITA_OK "$OUT" || { cat "$OUT"; esec "suita ($1)"; }; grep -E 'OK T[0-9]' "$OUT" | sed "s/^.*NOTICE: *//; s/^/     [$1] /"; ok "suita ($1)"; }

# 0. baza
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA"
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
index_exista "$BAZA" && esec "0 indexul există înainte de migrare"
# discriminare: pe starea fără index suita TREBUIE să cadă
if "${PSQL[@]}" -d "$BAZA" -f "$TESTE" >"$OUT" 2>&1; then esec "0 suita trece și fără index (nu discriminează)"; fi
grep -q 'ESEC TEST: T1' "$OUT" || { cat "$OUT"; esec "0 suita a căzut din alt motiv"; }
ok "0 schelet (structura live 14.10, fără index); suita cade pe T1 fără migrare"

# 1. precondiție negativă: contractul 108 legat și de proiectul 6
"${PSQL[@]}" -d postgres -c "CREATE DATABASE contract_unic_neg_test TEMPLATE $BAZA"
q contract_unic_neg_test "UPDATE public.executie_proiecte SET contract_id = 108 WHERE id = 6" >/dev/null
if "${PSQL[@]}" -d contract_unic_neg_test --single-transaction -f "$MIGRARE" >"$OUT" 2>&1; then esec "1 migrarea a trecut peste duplicate"; fi
grep -q 'PRECONDIȚIE 20261030b' "$OUT" || { cat "$OUT"; esec "1 refuz din alt motiv"; }
grep -q 'contract 108 → proiectele 6,27' "$OUT" || { cat "$OUT"; esec "1 mesajul nu listează duplicatele"; }
index_exista contract_unic_neg_test && esec "1 indexul a apărut deși precondiția a refuzat"
ok "1 duplicat (108 → 6,27) → refuz PRECONDIȚIE, listat, fără index"

# 2. aplicare
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE" >"$OUT" 2>&1 || { cat "$OUT"; esec "2 aplicare"; }
index_exista "$BAZA" || esec "2 indexul lipsește după aplicare"
ok "2 aplicare (pre + post trecute)"
suita "după 20261030b"

# 3. reaplicare
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE" >"$OUT" 2>&1 || { cat "$OUT"; esec "3 reaplicare"; }
ok "3 reaplicare idempotentă"
suita "reaplicare"

# 4. revenire
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >"$OUT" 2>&1 || { cat "$OUT"; esec "4 revenire"; }
index_exista "$BAZA" && esec "4 indexul există după revenire"
q "$BAZA" "UPDATE public.executie_proiecte SET contract_id = 108 WHERE id = 6" >/dev/null || esec "4 după revenire dublarea ar trebui să treacă"
[ "$(q "$BAZA" "SELECT count(*) FROM public.executie_proiecte WHERE contract_id = 108")" = 2 ] || esec "4 dublarea nu s-a scris"
q "$BAZA" "UPDATE public.executie_proiecte SET contract_id = NULL WHERE id = 6" >/dev/null
ok "4 revenire: index scos, dublarea trece din nou (regula rămâne doar în UI; refăcut fixture-ul)"
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE" >"$OUT" 2>&1 || { cat "$OUT"; esec "4 reaplicare după revenire"; }
suita "reaplicare după revenire"

echo "PASS test_executie_contract_id_unic"
