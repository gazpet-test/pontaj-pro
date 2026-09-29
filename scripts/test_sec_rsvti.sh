#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — SEC RSVTI (20261003c_sec_rsvti_poarta_jurnal.sql).
#
# Rulează EXCLUSIV pe un PostgreSQL 16 local dedicat (implicit /tmp/pg_sec_rsvti, 127.0.0.1:5442).
# Nu citește .env, nu folosește chei Supabase, nu atinge producția.
#
# Ciclul complet (Copilot: migrare → teste → rollback tehnic → teste care dovedesc gaura → reaplicare → teste):
#   0. schelet (= producția de azi) → teste GAURA (fidelitatea: atacurile reușesc pe varianta live)
#   1. migrare                      → teste PATCH
#   2. reaplicare (idempotență)     → teste PATCH
#   3. rollback tehnic              → schema identică cu cea de la pasul 0 + teste GAURA
#   4. reaplicare                   → teste PATCH
#
# Utilizare (din rădăcina repo-ului; ca root, comenzile de server trec pe utilizatorul postgres prin su):
#   bash scripts/test_sec_rsvti.sh             # ciclul complet
#   bash scripts/test_sec_rsvti.sh --opreste   # + oprește serverul la final
# Variabile opționale: PG_BIN=/usr/lib/postgresql/16/bin PGDATA_TEST=/tmp/pg_sec_rsvti PGPORT_TEST=5442
#   PGDB_TEST=sec_rsvti_test PGLOG_TEST=/tmp/pg_sec_rsvti.log
# Coduri de ieșire: 0 = PASS · 1 = migrare/test eșuat · 2 = mediu (PG indisponibil, gardă refuzată)
# ============================================================================
set -Eeuo pipefail

RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_sec_rsvti}"
PORT="${PGPORT_TEST:-5442}"
BAZA="${PGDB_TEST:-sec_rsvti_test}"
JURNAL_PG="${PGLOG_TEST:-/tmp/pg_sec_rsvti.log}"
SCHELET="$RADACINA/supabase/tests/sec_rsvti_schelet.sql"
TESTE="$RADACINA/supabase/tests/sec_rsvti.test.sql"
MIGRARE="$RADACINA/supabase/migrations/20261003c_sec_rsvti_poarta_jurnal.sql"
ROLLBACK="$RADACINA/supabase/migrations/20261003c_sec_rsvti_poarta_jurnal_ROLLBACK.sql"

OPRESTE=0
for a in "$@"; do
  case "$a" in
    --opreste) OPRESTE=1 ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument necunoscut: $a (vezi --help)" >&2; exit 2 ;;
  esac
done

mediu() { echo "MEDIU: $*" >&2; exit 2; }
esec()  { echo "FAIL: $*" >&2; exit 1; }

# --- gărzi: numai țintă locală, bază *_test ---------------------------------
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] || mediu "PGPORT_TEST invalid: $PORT"
[[ "$BAZA" =~ ^[a-z0-9_]+_test$ ]] || mediu "PGDB_TEST trebuie să se termine în _test (acum: $BAZA)"
[[ "$DATE_DIR" == /tmp/* ]] || mediu "PGDATA_TEST trebuie să fie sub /tmp (acum: $DATE_DIR)"
[ -x "$PG_BIN/postgres" ] || mediu "PostgreSQL lipsește în $PG_BIN"
for f in "$SCHELET" "$TESTE" "$MIGRARE" "$ROLLBACK"; do [ -f "$f" ] || mediu "Fișier lipsă: $f"; done

# Nicio variabilă libpq moștenită nu poate redirecționa conexiunea spre alt server.
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE \
      PGOPTIONS PGSSLMODE PGREQUIRESSL PGTARGETSESSIONATTRS PGAPPNAME PGCLIENTENCODING PGDATA
export PGCONNECT_TIMEOUT=5 PGCLIENTENCODING=UTF8 PGAPPNAME=test_sec_rsvti

ca_postgres() {  # serverul nu rulează ca root: „su postgres -c …”
  if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi
}
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)

# --- 1. cluster local dedicat ------------------------------------------------
if [ ! -f "$DATE_DIR/PG_VERSION" ]; then
  echo "→ initdb $DATE_DIR (UTF8, auth trust doar local)"
  mkdir -p "$DATE_DIR"
  [ "$(id -u)" = 0 ] && chown postgres:postgres "$DATE_DIR"
  chmod 700 "$DATE_DIR"
  ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null \
    || mediu "initdb a eșuat"
fi
[ "$(cat "$DATE_DIR/PG_VERSION")" = 16 ] || mediu "$DATE_DIR nu este un cluster PostgreSQL 16"

if ! "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT" -t 2; then
  echo "→ pornesc PostgreSQL pe 127.0.0.1:$PORT ($DATE_DIR, jurnal $JURNAL_PG)"
  if [ "$(id -u)" = 0 ]; then touch "$JURNAL_PG"; chown postgres:postgres "$JURNAL_PG"; fi
  ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l "$JURNAL_PG" -w -t 30 start \
    -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c timezone=UTC" >/dev/null \
    || { tail -20 "$JURNAL_PG" >&2 || true; mediu "pg_ctl start a eșuat"; }
fi
# Serverul de pe port TREBUIE să fie clusterul nostru — altfel refuz (nu dăm DROP DATABASE pe altceva).
DIR_SERVER="$("${PSQL[@]}" -d postgres -Atc 'SHOW data_directory')" || mediu "nu mă pot conecta la 127.0.0.1:$PORT"
[ "$(realpath "$DIR_SERVER")" = "$(realpath "$DATE_DIR")" ] || mediu "pe portul $PORT rulează alt cluster ($DIR_SERVER)"
VER="$("${PSQL[@]}" -d postgres -Atc 'SHOW server_version_num')"
[ "${VER:0:2}" = 16 ] || mediu "server_version_num=$VER, se cere 16"

# --- 2. bază nouă + schelet ----------------------------------------------------
echo "→ recreez baza $BAZA"
"${PSQL[@]}" -d postgres -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS \"$BAZA\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$BAZA\" TEMPLATE template0 ENCODING 'UTF8'" || mediu "nu pot recrea baza $BAZA"
echo "→ schelet: ${SCHELET#$RADACINA/}"
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" || esec "scheletul nu s-a încărcat (fidelitate?)"

aplica() {  # ca apply_migration: o singură tranzacție
  echo "→ aplic ${1#$RADACINA/}"
  "${PSQL[@]}" -d "$BAZA" --single-transaction -f "$1" || esec "${1#$RADACINA/} a eșuat"
}

TOTAL_OK=0
ruleaza_teste() {  # $1 = eticheta, $2 = gaura (true/false)
  local iesire; iesire="$(mktemp)"
  echo "→ teste [$1] (gaura=$2)"
  set +e
  "${PSQL[@]}" -d "$BAZA" -o /dev/null -v gaura="$2" -f "$TESTE" 2>&1 | tee "$iesire" | sed 's/^psql:[^ ]* NOTICE:  /  /'
  local st=${PIPESTATUS[0]}
  set -e
  local n; n="$(grep -c 'NOTICE:  OK ' "$iesire" || true)"
  rm -f "$iesire"
  [ "$st" = 0 ] || esec "teste [$1] — psql a ieșit cu $st"
  TOTAL_OK=$((TOTAL_OK + n))
  echo "   [$1] $n aserțiuni OK"
}

schema_snapshot() {  # schema fără date, cu ACL-uri și comentarii
  "$PG_BIN/pg_dump" -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" --schema-only \
    | grep -vE '^(--|SET |SELECT pg_catalog\.set_config|\\(un)?restrict )' | sed '/^$/d'
}

# --- 3. ciclul -----------------------------------------------------------------
SNAP_INAINTE="$(mktemp)"; schema_snapshot > "$SNAP_INAINTE"
ruleaza_teste "0 schelet = producția de azi" true
aplica "$MIGRARE";  ruleaza_teste "1 după migrare" false
aplica "$MIGRARE";  ruleaza_teste "2 după reaplicare (idempotență)" false
aplica "$ROLLBACK"
SNAP_DUPA="$(mktemp)"; schema_snapshot > "$SNAP_DUPA"
if ! diff -u "$SNAP_INAINTE" "$SNAP_DUPA" > "$SNAP_DUPA.diff"; then
  echo "!! schema după rollback diferă de cea dinainte de migrare:" >&2
  head -80 "$SNAP_DUPA.diff" >&2
  esec "rollback tehnic incomplet"
fi
echo "   schema după rollback = schema dinainte de migrare (pg_dump identic)"
rm -f "$SNAP_INAINTE" "$SNAP_DUPA" "$SNAP_DUPA.diff"
ruleaza_teste "3 după rollback tehnic: gaura redeschisă" true
aplica "$MIGRARE";  ruleaza_teste "4 după reaplicare: gaura închisă" false

if [ "$OPRESTE" = 1 ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null && echo "→ server oprit"; fi
echo "PASS test_sec_rsvti: $TOTAL_OK aserțiuni OK (bază $BAZA @ 127.0.0.1:$PORT)"
