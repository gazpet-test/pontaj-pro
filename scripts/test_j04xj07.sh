#!/usr/bin/env bash
# ============================================================================
# Suita EXTINSĂ J04×J07 (COPILOT_REVIEW_PLAN_A_2026-09-29 §2) — O SINGURĂ COMANDĂ, PostgreSQL 16 LOCAL.
#
# Rulează EXCLUSIV pe un cluster PG16 local dedicat testelor (implicit /tmp/pg_j0407/data_jx, port 5440,
# doar 127.0.0.1, auth trust local). Nu citește .env, nu folosește chei Supabase, nu atinge producția.
#
# Pași: pornește/verifică clusterul → scripts/pg/test_j04xj07.mjs (creează baza jakv0407_test_jx, încarcă schema +
#       migrările J04→J07 ×2 + helper-ele jx + starea de bază, rulează supabase/tests/j04xj07/NN_*.sql, fiecare test
#       în BEGIN…ROLLBACK; testele cu două sesiuni pe o clonă de unică folosință; pașii @edge rulează handler-ele REALE
#       ale edge-urilor) → șterge bazele → exit ≠ 0 la eșec.
#
# Utilizare (din rădăcina repo-ului; ca root, serverul rulează automat ca utilizatorul postgres):
#   bash scripts/test_j04xj07.sh                 # suita extinsă (teste JX-*)
#   bash scripts/test_j04xj07.sh --mutanti       # + verificarea prin mutații (scripts/pg/test_j04xj07_mutanti.mjs): fiecare
#                                                #   implementare stricată din catalog (SQL + edge, M1…M19 + X*) trebuie UCISĂ
#                                                #   de cel puțin un test funcțional; controlul negativ M00_noop trebuie să
#                                                #   supraviețuiască. În paralel: JX_PARALEL (implicit 4).
#   bash scripts/test_j04xj07.sh --si-vechi      # + harness-urile PG existente (R9b, R5-F, R4, J01, J07-RLS, J03, J05,
#                                                #   J07-P3, J04, integrarea J04×J07) pe același cluster, baze proprii
#   bash scripts/test_j04xj07.sh --si-edge       # + testele edge/UI din CI: Deno (handler J07, hash J04: poarta de rol,
#                                                #   body falsificat, parser) și node --test (paritate UI/Edge, ordinea UI J04×J07)
#   bash scripts/test_j04xj07.sh --tot           # = --mutanti --si-vechi --si-edge (comanda pentru GO)
#   bash scripts/test_j04xj07.sh --opreste       # oprește serverul la final
#   bash scripts/test_j04xj07.sh -- '^0[45]'     # doar fișierele de test care se potrivesc regex-ului
#
# Variabile (opționale): PG_BIN=/usr/lib/postgresql/16/bin  PGDATA_TEST=/tmp/pg_j0407/data_jx  PGPORT_TEST=5440
#   PGLOG_TEST=/tmp/pg_j0407/jx.log  JX_PARALEL=4
# Cerințe: PostgreSQL 16, Node ≥ 22.18 (runner-ul importă handler-ele .ts reale); pentru --si-edge și deno 2.x.
# Coduri de ieșire: 0 = PASS · 1 = test eșuat / mutant supraviețuitor · 2 = mediu (PG/Node/Deno indisponibil, gardă refuzată)
# ============================================================================
set -Eeuo pipefail

RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_j0407/data_jx}"
PORT="${PGPORT_TEST:-5440}"
JURNAL_PG="${PGLOG_TEST:-/tmp/pg_j0407/jx.log}"
JURNALE="$(dirname "$JURNAL_PG")"   # jurnalele mutanților / harness-urilor vechi

MUTANTI=0; VECHI=0; EDGE=0; OPRESTE=0; FILTRU=""
while [ $# -gt 0 ]; do
  case "$1" in
    --mutanti)  MUTANTI=1 ;;
    --si-vechi) VECHI=1 ;;
    --si-edge)  EDGE=1 ;;
    --tot)      MUTANTI=1; VECHI=1; EDGE=1 ;;
    --opreste)  OPRESTE=1 ;;
    --) shift; FILTRU="${1:-}"; break ;;
    -h|--help) sed -n '2,31p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument necunoscut: $1 (vezi --help)" >&2; exit 2 ;;
  esac
  shift
done

mediu() { echo "MEDIU: $*" >&2; exit 2; }
esec()  { echo "FAIL: $*" >&2; exit 1; }

[[ "$PORT" =~ ^[0-9]{4,5}$ ]] || mediu "PGPORT_TEST invalid: $PORT"
[[ "$DATE_DIR" == /* && "$DATE_DIR" != "/" ]] || mediu "PGDATA_TEST trebuie să fie cale absolută"
[ -x "$PG_BIN/postgres" ] || mediu "PostgreSQL lipsește în $PG_BIN"
command -v node >/dev/null || mediu "node lipsește"
node -e 'process.exit(process.features && process.features.typescript ? 0 : 1)' \
  || mediu "Node $(node --version) nu elimină tipurile TypeScript: e nevoie de Node ≥ 22.18 (runner-ul importă handler-ele .ts reale)"
if [ "$EDGE" = 1 ]; then command -v deno >/dev/null || mediu "deno lipsește (necesar pentru --si-edge / --tot)"; fi

# Nicio variabilă libpq moștenită nu poate redirecționa conexiunea spre alt server.
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE \
      PGOPTIONS PGSSLMODE PGREQUIRESSL PGTARGETSESSIONATTRS PGAPPNAME PGCLIENTENCODING PGDATA PGURI
export PGCONNECT_TIMEOUT=5 PGCLIENTENCODING=UTF8

ca_postgres() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)

# --- 1. cluster local: initdb la nevoie, pornire, verificare identitate ----------
if [ ! -f "$DATE_DIR/PG_VERSION" ]; then
  echo "→ initdb $DATE_DIR (UTF8, auth trust doar local)"
  mkdir -p "$DATE_DIR"
  [ "$(id -u)" = 0 ] && chown postgres:postgres "$DATE_DIR"
  chmod 700 "$DATE_DIR"
  ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu "initdb a eșuat"
fi
[ "$(cat "$DATE_DIR/PG_VERSION")" = 16 ] || mediu "$DATE_DIR nu este un cluster PostgreSQL 16"
if ! "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT" -t 2; then
  echo "→ pornesc PostgreSQL pe 127.0.0.1:$PORT ($DATE_DIR)"
  if [ "$(id -u)" = 0 ]; then touch "$JURNAL_PG"; chown postgres:postgres "$JURNAL_PG"; fi
  ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l "$JURNAL_PG" -w -t 30 start \
    -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c timezone=UTC" >/dev/null \
    || { tail -20 "$JURNAL_PG" >&2 || true; mediu "pg_ctl start a eșuat (alt proces pe port?)"; }
fi
# Serverul de pe port TREBUIE să fie clusterul nostru — altfel refuz (runner-ul dă DROP DATABASE pe bazele lui).
DIR_SERVER="$("${PSQL[@]}" -d postgres -Atc 'SHOW data_directory')" || mediu "nu mă pot conecta la 127.0.0.1:$PORT"
[ "$(realpath "$DIR_SERVER")" = "$(realpath "$DATE_DIR")" ] || mediu "pe portul $PORT rulează alt cluster ($DIR_SERVER), nu $DATE_DIR"
VER="$("${PSQL[@]}" -d postgres -Atc 'SHOW server_version_num')"
[ "${VER:0:2}" = 16 ] || mediu "server_version_num=$VER, se cere 16"

export PGURI_ADMIN="postgres://postgres@127.0.0.1:$PORT/postgres"
mkdir -p "$JURNALE"
cd "$RADACINA"
REZ=0

# --- 2. suita extinsă ------------------------------------------------------------
echo "→ suita extinsă J04×J07 (scripts/pg/test_j04xj07.mjs)"
node scripts/pg/test_j04xj07.mjs "$FILTRU" || REZ=1

# --- 3. mutanți: fiecare trebuie UCIS (în paralel, câte o bază de unică folosință per mutant) ----------------
if [ "$MUTANTI" = 1 ]; then
  echo "→ verificarea prin mutații (scripts/pg/test_j04xj07_mutanti.mjs, JX_PARALEL=${JX_PARALEL:-4})"
  JX_JURNALE="$JURNALE/mutanti" JX_REZUMAT="$JURNALE/mutanti_rezumat.json" JX_FILTRU_FISIERE="$FILTRU" \
    node scripts/pg/test_j04xj07_mutanti.mjs || REZ=1
fi

# --- 4. harness-urile existente, fiecare pe baza lui ------------------------------
if [ "$VECHI" = 1 ]; then
  ruleaza_vechi() {  # $1 = script, $2 = baza, $3 = 1 dacă baza trebuie creată goală de noi
    if [ "$3" = 1 ]; then
      "${PSQL[@]}" -d postgres -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS \"$2\" WITH (FORCE)" -c "CREATE DATABASE \"$2\"" >/dev/null
    fi
    if PGURI="postgres://postgres@127.0.0.1:$PORT/$2" node "$1" > "$JURNALE/vechi_$2.log" 2>&1; then
      local ultim; ultim="$(grep -E '^PASS' "$JURNALE/vechi_$2.log" | tail -1 || true)"; [ -n "$ultim" ] || ultim="$(tail -1 "$JURNALE/vechi_$2.log")"
      echo "PASS $1 — ${ultim:0:150}"
    else
      tail -5 "$JURNALE/vechi_$2.log" >&2; echo "FAIL $1" >&2; REZ=1
    fi
    if [ "$3" = 1 ]; then "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$2\" WITH (FORCE)" >/dev/null; fi
  }
  echo "→ harness-urile PG existente"
  ruleaza_vechi scripts/pg/test_r9b_probe23.mjs r9b 0
  ruleaza_vechi scripts/pg/test_r5_review_f.mjs r9b_test_review_f 0
  ruleaza_vechi scripts/pg/test_r4_coada_plansa.mjs r9b_test_coada_plansa 0
  ruleaza_vechi scripts/pg/test_jakv201_tranzitie.mjs r9b_test_jakv201 0
  ruleaza_vechi scripts/pg/test_jakv207_rls.mjs jakv207_test_local 1
  ruleaza_vechi scripts/pg/test_jakv203_gate_depusa.mjs jakv203_test_local 1
  ruleaza_vechi scripts/pg/test_jakv205_derogare_audit.mjs jakv205_test_local 1
  ruleaza_vechi scripts/pg/test_jakv2p3_poarta_server.mjs jakv2p3_test_local 1
  ruleaza_vechi scripts/pg/test_jakv202_hash_server.mjs jakv202_test_local 1
  ruleaza_vechi scripts/pg/test_j04_j07_integrare.mjs jakv0407_test_local 1
  for b in r9b r9b_test_review_f r9b_test_coada_plansa r9b_test_jakv201; do
    "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"$b\" WITH (FORCE)" >/dev/null 2>&1 || true
  done
fi

# --- 5. testele edge / UI din CI (fără PG): Deno + node --test --------------------------------------------
if [ "$EDGE" = 1 ]; then
  echo "→ testele edge (Deno) și UI (node --test)"
  ruleaza_edge() {  # $1 = eticheta, restul = comanda
    local et="$1"; shift
    if "$@" > "$JURNALE/edge_$et.log" 2>&1; then
      echo "PASS $et — $(grep -E '^# (pass|fail) |passed|failed' "$JURNALE/edge_$et.log" | tail -2 | tr '\n' ' ' | cut -c1-150)"
    else
      tail -15 "$JURNALE/edge_$et.log" >&2; echo "FAIL $et" >&2; REZ=1
    fi
  }
  ruleaza_edge deno_poarta_text env NO_COLOR=1 deno test -A --node-modules-dir=none supabase/functions/ofertare-poarta-text
  ruleaza_edge deno_hash_j04 env NO_COLOR=1 deno test -A --node-modules-dir=none scripts/test-jakv202-hash-server.mjs
  ruleaza_edge node_ui_j04_j07 node --test scripts/test-jakv2p3.mjs scripts/test-j04-j07-integrare.mjs
fi

if [ "$OPRESTE" = 1 ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null && echo "→ server oprit"; fi
[ "$REZ" = 0 ] && echo "PASS test_j04xj07.sh" || echo "FAIL test_j04xj07.sh" >&2
exit "$REZ"
