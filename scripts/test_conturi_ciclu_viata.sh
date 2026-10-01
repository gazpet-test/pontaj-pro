#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — „ciclul de viață al conturilor” (R1 legare automată cont↔angajat,
# R2 contract închis → cont închis, R3 fost angajat ca colaborator extern).
#
# Rulează EXCLUSIV pe un PostgreSQL 16 local dedicat testelor (implicit /tmp/pg_conturi,
# port 5434, doar 127.0.0.1). Nu citește .env, nu folosește chei Supabase, nu atinge producția.
#
# Pași: pornește/verifică PG → recreează baza <..>_test → încarcă scheletul Supabase →
#       aplică migrările din listă → rulează testele SQL (ASSERT) → exit ≠ 0 la eșec.
#
# Utilizare (din rădăcina repo-ului; ca root se trece automat pe utilizatorul postgres):
#   bash scripts/test_conturi_ciclu_viata.sh                  # schelet + migrări din listă + teste
#   bash scripts/test_conturi_ciclu_viata.sh --reaplica       # + migrările a 2-a oară (idempotență) + teste
#   bash scripts/test_conturi_ciclu_viata.sh --rollback       # + ROLLBACK-uri în ordine inversă, schema
#                                                             #   comparată cu cea dinainte, teste BAZĂ,
#                                                             #   reaplicare + teste complete
#   bash scripts/test_conturi_ciclu_viata.sh --opreste        # oprește serverul la final
#   bash scripts/test_conturi_ciclu_viata.sh -- a.sql b.sql   # migrări explicite în loc de fișierul-listă
#
# Variabile (opționale): PG_BIN=/usr/lib/postgresql/16/bin  PGDATA_TEST=/tmp/pg_conturi
#   PGPORT_TEST=5434  PGDB_TEST=conturi_ciclu_test  PGLOG_TEST=/tmp/pg_conturi.log
#   SCHELET_SQL, TEST_SQL, LISTA_MIGRARI (căi relative la repo sau absolute)
#   ROLLBACK_DIFF_TOLERAT=1  → diferența de schemă după rollback devine avertisment, nu eșec
#
# Coduri de ieșire: 0 = PASS · 1 = migrare/test eșuat · 2 = mediu (PG indisponibil, gardă refuzată)
# ============================================================================
set -Eeuo pipefail

RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_conturi}"
PORT="${PGPORT_TEST:-5434}"
BAZA="${PGDB_TEST:-conturi_ciclu_test}"
JURNAL_PG="${PGLOG_TEST:-/tmp/pg_conturi.log}"
cale_abs() { case "$1" in /*) echo "$1" ;; *) echo "$RADACINA/$1" ;; esac; }
SCHELET="$(cale_abs "${SCHELET_SQL:-supabase/tests/conturi_schelet_supabase.sql}")"
TESTE="$(cale_abs "${TEST_SQL:-supabase/tests/conturi_ciclu_viata.test.sql}")"
LISTA="$(cale_abs "${LISTA_MIGRARI:-supabase/tests/conturi_ciclu_viata.migrari.txt}")"

REAPLICA=0; ROLLBACK=0; OPRESTE=0; MIGRARI_ARG=()
while [ $# -gt 0 ]; do
  case "$1" in
    --reaplica) REAPLICA=1 ;;
    --rollback) ROLLBACK=1 ;;
    --opreste)  OPRESTE=1 ;;
    --) shift; MIGRARI_ARG=("$@"); break ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument necunoscut: $1 (vezi --help)" >&2; exit 2 ;;
  esac
  shift
done

mediu() { echo "MEDIU: $*" >&2; exit 2; }
esec()  { echo "FAIL: $*" >&2; exit 1; }

# --- gărzi: numai țintă locală, bază *_test ---------------------------------
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] || mediu "PGPORT_TEST invalid: $PORT"
[[ "$BAZA" =~ ^[a-z0-9_]+_test$ ]] || mediu "PGDB_TEST trebuie să se termine în _test (acum: $BAZA)"
[[ "$DATE_DIR" == /* && "$DATE_DIR" != "/" ]] || mediu "PGDATA_TEST trebuie să fie cale absolută"
[ -x "$PG_BIN/postgres" ] || mediu "PostgreSQL lipsește în $PG_BIN"
for f in "$SCHELET" "$TESTE"; do [ -f "$f" ] || mediu "Fișier lipsă: $f"; done

# Nicio variabilă libpq moștenită nu poate redirecționa conexiunea (ex. PGHOSTADDR/PGSERVICE spre remote).
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE \
      PGOPTIONS PGSSLMODE PGREQUIRESSL PGTARGETSESSIONATTRS PGAPPNAME PGCLIENTENCODING PGDATA
export PGCONNECT_TIMEOUT=5 PGCLIENTENCODING=UTF8 PGAPPNAME=test_conturi_ciclu_viata

ca_postgres() {  # comenzile de server nu rulează ca root
  if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi
}
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)

# --- 1. cluster local: initdb la nevoie, pornire, verificare identitate ----------
if [ ! -f "$DATE_DIR/PG_VERSION" ]; then
  echo "→ initdb $DATE_DIR (ICU en-US, UTF8, auth trust doar local)"
  mkdir -p "$DATE_DIR"
  [ "$(id -u)" = 0 ] && chown postgres:postgres "$DATE_DIR"
  chmod 700 "$DATE_DIR"
  ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 \
    --locale-provider=icu --icu-locale=en-US --locale=C.UTF-8 >/dev/null || mediu "initdb a eșuat"
fi
PGVER_TEST="${PGVER_TEST:-16}"; [[ "$PGVER_TEST" =~ ^1[67]$ ]] || mediu "PGVER_TEST: doar 16 sau 17"
[ "$(cat "$DATE_DIR/PG_VERSION")" = "$PGVER_TEST" ] || mediu "$DATE_DIR nu este un cluster PostgreSQL $PGVER_TEST"

if ! "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT" -t 2; then
  echo "→ pornesc PostgreSQL pe 127.0.0.1:$PORT ($DATE_DIR, jurnal $JURNAL_PG)"
  if [ "$(id -u)" = 0 ]; then touch "$JURNAL_PG"; chown postgres:postgres "$JURNAL_PG"; fi
  ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l "$JURNAL_PG" -w -t 30 start \
    -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c timezone=UTC" >/dev/null \
    || { tail -20 "$JURNAL_PG" >&2 || true; mediu "pg_ctl start a eșuat (postmaster.pid rămas? alt proces pe port?)"; }
fi
# Serverul de pe port TREBUIE să fie clusterul nostru — altfel refuz (nu dăm DROP DATABASE pe altceva).
DIR_SERVER="$("${PSQL[@]}" -d postgres -Atc 'SHOW data_directory')" || mediu "nu mă pot conecta la 127.0.0.1:$PORT"
[ "$(realpath "$DIR_SERVER")" = "$(realpath "$DATE_DIR")" ] || mediu "pe portul $PORT rulează alt cluster ($DIR_SERVER), nu $DATE_DIR"
VER="$("${PSQL[@]}" -d postgres -Atc 'SHOW server_version_num')"
[ "${VER:0:2}" = "$PGVER_TEST" ] || mediu "server_version_num=$VER, se cere $PGVER_TEST"

# --- 2. bază nouă + schelet ----------------------------------------------------
echo "→ recreez baza $BAZA"
"${PSQL[@]}" -d postgres -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS \"$BAZA\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$BAZA\" TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US' LOCALE 'C.UTF-8'" \
  || mediu "nu pot recrea baza $BAZA"
echo "→ schelet: ${SCHELET#$RADACINA/}"
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" || esec "scheletul nu s-a încărcat"

# --- 3. lista de migrări -------------------------------------------------------
MIGRARI=()
if [ ${#MIGRARI_ARG[@]} -gt 0 ]; then
  MIGRARI=("${MIGRARI_ARG[@]}")
elif [ -f "$LISTA" ]; then
  while IFS= read -r linie || [ -n "$linie" ]; do
    linie="${linie%%#*}"; linie="$(echo "$linie" | xargs)"
    [ -n "$linie" ] && MIGRARI+=("$linie")
  done < "$LISTA"
fi
for m in ${MIGRARI[@]+"${MIGRARI[@]}"}; do [ -f "$(cale_abs "$m")" ] || mediu "migrare lipsă: $m"; done

aplica_fisier() {  # ca apply_migration: o singură tranzacție, cu excepția fișierelor cu BEGIN/COMMIT proprii
  local f; f="$(cale_abs "$1")"
  local opt=(--single-transaction)
  grep -qiE '^[[:space:]]*(BEGIN|COMMIT)[[:space:]]*;' "$f" && opt=()
  # 01.10.2026: migrările cu garda runner-ului cer marcajul scripts/livrare_migrare.sh în aceeași tranzacție (simulat local)
  if grep -q "gazpet.livrare_migrare" "$f"; then
    opt=(--single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$(basename "$f" .sql):' || txid_current(), true)")
  fi
  echo "→ aplic ${f#$RADACINA/}"
  "${PSQL[@]}" -d "$BAZA" ${opt[@]+"${opt[@]}"} -f "$f" || esec "migrarea ${f#$RADACINA/} a eșuat"
}
aplica_migrari() { for m in ${MIGRARI[@]+"${MIGRARI[@]}"}; do aplica_fisier "$m"; done; }

TOTAL_OK=0
ruleaza_teste() {  # $1 = eticheta, $2 = doar_baza (true/false)
  local iesire; iesire="$(mktemp)"
  echo "→ teste [$1]: ${TESTE#$RADACINA/}"
  set +e
  "${PSQL[@]}" -d "$BAZA" -o /dev/null -v doar_baza="$2" -f "$TESTE" 2>&1 | tee "$iesire" | sed 's/^psql:[^ ]* NOTICE:  /  /'
  local st=${PIPESTATUS[0]}
  set -e
  local n; n="$(grep -c 'NOTICE:  OK ' "$iesire" || true)"
  rm -f "$iesire"
  [ "$st" = 0 ] || esec "teste [$1] — psql a ieșit cu $st"
  TOTAL_OK=$((TOTAL_OK + n))
  echo "   [$1] $n aserțiuni OK"
}

schema_snapshot() {  # schema fără date, cu ACL-uri, ca să prindă GRANT-uri/obiecte rămase după rollback
  "$PG_BIN/pg_dump" -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" --schema-only --no-owner \
    | grep -vE '^(--|SET |SELECT pg_catalog\.set_config|\\(un)?restrict )' | sed '/^$/d'
}

# --- 4. rulare -----------------------------------------------------------------
echo "→ migrări în listă: ${#MIGRARI[@]}"
SNAP_INAINTE=""
if [ "$ROLLBACK" = 1 ]; then SNAP_INAINTE="$(mktemp)"; schema_snapshot > "$SNAP_INAINTE"; fi

aplica_migrari
ruleaza_teste "după migrare" false

if [ "$REAPLICA" = 1 ] && [ ${#MIGRARI[@]} -gt 0 ]; then
  echo "→ reaplic migrările (idempotență)"
  aplica_migrari
  ruleaza_teste "după reaplicare" false
fi

if [ "$ROLLBACK" = 1 ] && [ ${#MIGRARI[@]} -gt 0 ]; then
  for (( i=${#MIGRARI[@]}-1; i>=0; i-- )); do
    rb="${MIGRARI[$i]%.sql}_ROLLBACK.sql"
    [ -f "$(cale_abs "$rb")" ] || esec "lipsește rollback-ul pentru ${MIGRARI[$i]}"
    aplica_fisier "$rb"
  done
  SNAP_DUPA="$(mktemp)"; schema_snapshot > "$SNAP_DUPA"
  if ! diff -u "$SNAP_INAINTE" "$SNAP_DUPA" > "$SNAP_DUPA.diff"; then
    echo "!! schema după rollback diferă de cea dinainte de migrări:" >&2
    head -80 "$SNAP_DUPA.diff" >&2
    [ "${ROLLBACK_DIFF_TOLERAT:-0}" = 1 ] || esec "rollback incomplet (ROLLBACK_DIFF_TOLERAT=1 ca să treacă cu avertisment)"
  else
    echo "   schema după rollback = schema dinainte de migrări"
  fi
  rm -f "$SNAP_INAINTE" "$SNAP_DUPA" "$SNAP_DUPA.diff"
  ruleaza_teste "după rollback, doar BAZĂ" true
  echo "→ reaplic după rollback"
  aplica_migrari
  ruleaza_teste "după rollback + reaplicare" false
fi

if [ "$OPRESTE" = 1 ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null && echo "→ server oprit"; fi
echo "PASS test_conturi_ciclu_viata: $TOTAL_OK aserțiuni OK, ${#MIGRARI[@]} migrări (bază $BAZA @ 127.0.0.1:$PORT)"
