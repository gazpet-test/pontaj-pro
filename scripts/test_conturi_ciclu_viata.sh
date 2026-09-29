#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — „ciclul de viață al conturilor” (R1 legare automată cont↔angajat,
# R2 contract închis → cont închis, R3 fost angajat ca colaborator extern).
#
# Rulează EXCLUSIV pe un PostgreSQL 16 local dedicat testelor (implicit /tmp/pg_conturi,
# port 5434, doar 127.0.0.1). Nu citește .env, nu folosește chei Supabase, nu atinge producția.
#
# Pași: pornește/verifică PG → recreează baza <..>_test → încarcă scheletul Supabase →
#       aplică PRECONDIȚIILE LIVE (linii „live: <cale>” din listă = migrări deja aplicate în producție,
#       ex. S-A 20260929g; fac parte din „starea dinainte”: nu se reaplică, nu se fac rollback) →
#       aplică migrările din listă → rulează testele SQL (ASSERT) → exit ≠ 0 la eșec.
#
# Utilizare (din rădăcina repo-ului; ca root se trece automat pe utilizatorul postgres):
#   bash scripts/test_conturi_ciclu_viata.sh                  # schelet + migrări din listă + teste
#   bash scripts/test_conturi_ciclu_viata.sh --reaplica       # + migrările a 2-a oară (idempotență) + teste
#   bash scripts/test_conturi_ciclu_viata.sh --rollback       # + ROLLBACK-uri în ordine inversă, schema
#                                                             #   comparată PAS CU PAS (după rollback-ul lui X =
#                                                             #   schema de după migrarea dinaintea lui X) și cu
#                                                             #   cea dinainte, gărzile rollback-urilor, teste
#                                                             #   BAZĂ, reaplicare + teste complete
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
    -h|--help) sed -n '2,32p' "${BASH_SOURCE[0]}"; exit 0 ;;
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
[ "$(cat "$DATE_DIR/PG_VERSION")" = 16 ] || mediu "$DATE_DIR nu este un cluster PostgreSQL 16"

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
[ "${VER:0:2}" = 16 ] || mediu "server_version_num=$VER, se cere 16"

# --- 2. bază nouă + schelet ----------------------------------------------------
echo "→ recreez baza $BAZA"
"${PSQL[@]}" -d postgres -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS \"$BAZA\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$BAZA\" TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US' LOCALE 'C.UTF-8'" \
  || mediu "nu pot recrea baza $BAZA"
echo "→ schelet: ${SCHELET#$RADACINA/}"
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" || esec "scheletul nu s-a încărcat"

# --- 3. lista de migrări -------------------------------------------------------
# „live: <cale>” = precondiție (migrare deja aplicată în producție): se aplică o singură dată, înaintea
# instantaneului de schemă „dinainte”, și NU intră în reaplicare / rollback (rollback-ul pachetului nu o atinge).
MIGRARI=(); PRECONDITII=()
if [ ${#MIGRARI_ARG[@]} -gt 0 ]; then
  MIGRARI=("${MIGRARI_ARG[@]}")
elif [ -f "$LISTA" ]; then
  while IFS= read -r linie || [ -n "$linie" ]; do
    linie="${linie%%#*}"; linie="$(echo "$linie" | xargs)"
    case "$linie" in
      "") ;;
      live:*) PRECONDITII+=("$(echo "${linie#live:}" | xargs)") ;;
      *) MIGRARI+=("$linie") ;;
    esac
  done < "$LISTA"
fi
for m in ${PRECONDITII[@]+"${PRECONDITII[@]}"} ${MIGRARI[@]+"${MIGRARI[@]}"}; do [ -f "$(cale_abs "$m")" ] || mediu "migrare lipsă: $m"; done

aplica_fisier() {  # ca apply_migration: o singură tranzacție, cu excepția fișierelor cu BEGIN/COMMIT proprii
  local f; f="$(cale_abs "$1")"
  local opt=(--single-transaction)
  grep -qiE '^[[:space:]]*(BEGIN|COMMIT)[[:space:]]*;' "$f" && opt=()
  echo "→ aplic ${f#$RADACINA/}"
  "${PSQL[@]}" -d "$BAZA" ${opt[@]+"${opt[@]}"} -f "$f" || esec "migrarea ${f#$RADACINA/} a eșuat"
}
schema_snapshot() {  # schema fără date, cu ACL-uri, ca să prindă GRANT-uri/obiecte rămase după rollback
  "$PG_BIN/pg_dump" -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" --schema-only --no-owner \
    | grep -vE '^(--|SET |SELECT pg_catalog\.set_config|\\(un)?restrict )' | sed '/^$/d'
}

# $1 = 1 → instantaneu de schemă după FIECARE migrare (prima aplicare, --rollback): rollback-ul fiecărei migrări trebuie
# să readucă exact schema de după migrarea dinaintea ei (ex. rollback d = schema de după c, cu fn_admin_conturi_alerte din c).
SNAP_PAS=()
aplica_migrari() {
  local i=0
  for m in ${MIGRARI[@]+"${MIGRARI[@]}"}; do
    aplica_fisier "$m"
    if [ "${1:-0}" = 1 ]; then SNAP_PAS[$i]="$(mktemp)"; schema_snapshot > "${SNAP_PAS[$i]}"; fi
    i=$((i + 1))
  done
}

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


# --- 4. rulare -----------------------------------------------------------------
for m in ${PRECONDITII[@]+"${PRECONDITII[@]}"}; do
  echo "→ precondiție live (starea producției, fără rollback): $m"
  aplica_fisier "$m"
done
echo "→ migrări în listă: ${#MIGRARI[@]} (+ ${#PRECONDITII[@]} precondiții live)"
SNAP_INAINTE=""
if [ "$ROLLBACK" = 1 ]; then SNAP_INAINTE="$(mktemp)"; schema_snapshot > "$SNAP_INAINTE"; fi

aplica_migrari "$ROLLBACK"
ruleaza_teste "după migrare" false

if [ "$REAPLICA" = 1 ] && [ ${#MIGRARI[@]} -gt 0 ]; then
  echo "→ reaplic migrările (idempotență)"
  aplica_migrari
  ruleaza_teste "după reaplicare" false
fi

if [ "$ROLLBACK" = 1 ] && [ ${#MIGRARI[@]} -gt 0 ]; then
  # Gardă de ordine: rollback-ul PRIMEI migrări rulat înaintea celorlalte trebuie refuzat și fără efect
  # (doar dacă fișierul are o gardă declarată: „Gardă de ordine”).
  RB0="$(cale_abs "${MIGRARI[0]%.sql}_ROLLBACK.sql")"
  if [ ${#MIGRARI[@]} -gt 1 ] && [ -f "$RB0" ] && grep -q 'Gardă de ordine' "$RB0"; then
    SNAP_G="$(mktemp)"; schema_snapshot > "$SNAP_G"
    if "${PSQL[@]}" -d "$BAZA" --single-transaction -f "$RB0" >/dev/null 2>&1; then
      esec "rollback-ul ${RB0#$RADACINA/} a rulat în ordine greșită (înaintea celorlalte) fără să fie refuzat"
    fi
    schema_snapshot | diff -q "$SNAP_G" - >/dev/null || esec "rollback-ul refuzat a lăsat totuși urme în schemă"
    rm -f "$SNAP_G"
    echo "   gardă de ordine: ${RB0#$RADACINA/} înaintea celorlalte → refuzat, schema neschimbată"
    TOTAL_OK=$((TOTAL_OK + 1))
  fi
  # Gardă coadă flaguri (runda 3, P9c): cu o intrare „flaguri” deschisă în coadă (cont închis pe calea HR cu flagurile
  # încă TRUE), rollback-ul care o declară trebuie refuzat (55000) și fără efect; intrarea de test se șterge apoi.
  for (( i=0; i<${#MIGRARI[@]}; i++ )); do
    RBQ="$(cale_abs "${MIGRARI[$i]%.sql}_ROLLBACK.sql")"
    if [ -f "$RBQ" ] && grep -q 'Gardă coadă flaguri' "$RBQ"; then
      "${PSQL[@]}" -d "$BAZA" -c "INSERT INTO public.conturi_inchideri_coada (profile_id, tip, motiv) VALUES (gen_random_uuid(), 'flaguri', 'harness: gardă rollback coadă')" >/dev/null \
        || esec "nu pot pune intrarea de test în coadă"
      SNAP_Q="$(mktemp)"; schema_snapshot > "$SNAP_Q"
      if ERR_Q="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$RBQ" 2>&1 >/dev/null)"; then
        esec "rollback-ul ${RBQ#$RADACINA/} a rulat cu o intrare „flaguri” deschisă în coadă (trebuia refuzat)"
      fi
      echo "$ERR_Q" | grep -q 'intrări „flaguri” deschise' || { echo "$ERR_Q" >&2; esec "rollback-ul ${RBQ#$RADACINA/} a fost refuzat din alt motiv decât garda cozii"; }
      schema_snapshot | diff -q "$SNAP_Q" - >/dev/null || esec "rollback-ul refuzat (gardă coadă) a lăsat totuși urme în schemă"
      "${PSQL[@]}" -d "$BAZA" -c "DELETE FROM public.conturi_inchideri_coada WHERE motiv = 'harness: gardă rollback coadă'" >/dev/null
      rm -f "$SNAP_Q"
      echo "   gardă coadă flaguri: ${RBQ#$RADACINA/} cu o intrare „flaguri” deschisă → refuzat (55000), schema neschimbată"
      TOTAL_OK=$((TOTAL_OK + 1))
    fi
  done
  for (( i=${#MIGRARI[@]}-1; i>=0; i-- )); do
    rb="${MIGRARI[$i]%.sql}_ROLLBACK.sql"
    [ -f "$(cale_abs "$rb")" ] || esec "lipsește rollback-ul pentru ${MIGRARI[$i]}"
    aplica_fisier "$rb"
    if [ "$i" -gt 0 ] && [ -n "${SNAP_PAS[$((i - 1))]:-}" ]; then
      SNAP_RB="$(mktemp)"; schema_snapshot > "$SNAP_RB"
      if ! diff -u "${SNAP_PAS[$((i - 1))]}" "$SNAP_RB" > "$SNAP_RB.diff"; then
        echo "!! după ${rb##*/} schema diferă de cea de după ${MIGRARI[$((i - 1))]##*/}:" >&2
        head -80 "$SNAP_RB.diff" >&2
        [ "${ROLLBACK_DIFF_TOLERAT:-0}" = 1 ] || esec "rollback pas cu pas incomplet: ${rb##*/}"
      else
        echo "   rollback pas cu pas: după ${rb##*/} schema = cea de după ${MIGRARI[$((i - 1))]##*/}"
        TOTAL_OK=$((TOTAL_OK + 1))
      fi
      rm -f "$SNAP_RB" "$SNAP_RB.diff"
    fi
  done
  rm -f ${SNAP_PAS[@]+"${SNAP_PAS[@]}"}
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
echo "PASS test_conturi_ciclu_viata: $TOTAL_OK aserțiuni OK, ${#MIGRARI[@]} migrări + ${#PRECONDITII[@]} precondiții live (bază $BAZA @ 127.0.0.1:$PORT)"
