#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — PowPatroll Context Registry, faza 1a (migrarea 20261008a).
#
# Rulează EXCLUSIV pe un PostgreSQL 16 local dedicat testelor (implicit /tmp/pg_registry, port 5437,
# doar 127.0.0.1). Nu citește .env, nu folosește chei Supabase, nu atinge producția.
#
# Faze:
#   A. prod-like: baza <..>_pl_test, migrarea aplicată (de 2 ori) ca rol NOSUPERUSER CREATEROLE BYPASSRLS
#      (ca postgres în Supabase) → teste de „frână” (ownership, INHERIT/SET) + testele complete → rollback
#      ca același rol → schema = cea dinainte, rolul powpatroll_owner șters → baza se șterge.
#   B. principal (ca test_conturi_ciclu_viata.sh): schelet + migrare + teste; --reaplica, --rollback.
#   C. concurență: 2 scrieri pe aceeași cheie de la aceeași versiune → una STALE_KEY (sesiuni psql reale);
#      2 scrieri pe chei diferite → ambele trec, serializate de advisory lock.
#   D. rollback refuzat când registry-ul are versiuni peste v1 (schema neschimbată).
#
# Utilizare (din rădăcina repo-ului; ca root se trece automat pe utilizatorul postgres pentru server):
#   bash scripts/test_powpatroll_registry.sh                     # A + B + C + D
#   bash scripts/test_powpatroll_registry.sh --reaplica --rollback
#   bash scripts/test_powpatroll_registry.sh --fara-prodlike     # sare faza A
#   bash scripts/test_powpatroll_registry.sh --opreste           # oprește serverul la final
#
# Variabile (opționale): PG_BIN=/usr/lib/postgresql/16/bin  PGDATA_TEST=/tmp/pg_registry  PGPORT_TEST=5437
#   PGDB_TEST=powpatroll_registry_test  PGLOG_TEST=/tmp/pg_registry.log
#   SCHELET_SQL, SCHELET_EXTRA_SQL, TEST_SQL, TEST_PRODLIKE_SQL, LISTA_MIGRARI (căi relative la repo sau absolute)
#
# Coduri de ieșire: 0 = PASS · 1 = migrare/test eșuat · 2 = mediu (PG indisponibil, gardă refuzată)
# ============================================================================
set -Eeuo pipefail

RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_registry}"
PORT="${PGPORT_TEST:-5437}"
BAZA="${PGDB_TEST:-powpatroll_registry_test}"
BAZA_PL="${BAZA%_test}_pl_test"
JURNAL_PG="${PGLOG_TEST:-/tmp/pg_registry.log}"
SIM=pp_sim_postgres        # rol de test care imită postgres din Supabase (NOSUPERUSER, CREATEROLE, BYPASSRLS)
cale_abs() { case "$1" in /*) echo "$1" ;; *) echo "$RADACINA/$1" ;; esac; }
SCHELET="$(cale_abs "${SCHELET_SQL:-supabase/tests/conturi_schelet_supabase.sql}")"
SCHELET_EXTRA="$(cale_abs "${SCHELET_EXTRA_SQL:-supabase/tests/powpatroll_schelet_extra.sql}")"
TESTE="$(cale_abs "${TEST_SQL:-supabase/tests/powpatroll_registry.test.sql}")"
TESTE_PL="$(cale_abs "${TEST_PRODLIKE_SQL:-supabase/tests/powpatroll_registry.prodlike.test.sql}")"
LISTA="$(cale_abs "${LISTA_MIGRARI:-supabase/tests/powpatroll_registry.migrari.txt}")"

REAPLICA=0; ROLLBACK=0; OPRESTE=0; PRODLIKE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --reaplica) REAPLICA=1 ;;
    --rollback) ROLLBACK=1 ;;
    --opreste)  OPRESTE=1 ;;
    --fara-prodlike) PRODLIKE=0 ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument necunoscut: $1 (vezi --help)" >&2; exit 2 ;;
  esac
  shift
done

mediu() { echo "MEDIU: $*" >&2; exit 2; }
esec()  { echo "FAIL: $*" >&2; exit 1; }

# --- gărzi: numai țintă locală, baze *_test ----------------------------------
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] || mediu "PGPORT_TEST invalid: $PORT"
[[ "$BAZA" =~ ^[a-z0-9_]+_test$ ]] || mediu "PGDB_TEST trebuie să se termine în _test (acum: $BAZA)"
[[ "$BAZA_PL" =~ ^[a-z0-9_]+_test$ ]] || mediu "baza prod-like invalidă: $BAZA_PL"
[[ "$DATE_DIR" == /* && "$DATE_DIR" != "/" ]] || mediu "PGDATA_TEST trebuie să fie cale absolută"
[ -x "$PG_BIN/postgres" ] || mediu "PostgreSQL lipsește în $PG_BIN"
for f in "$SCHELET" "$SCHELET_EXTRA" "$TESTE" "$TESTE_PL" "$LISTA"; do [ -f "$f" ] || mediu "Fișier lipsă: $f"; done

# Nicio variabilă libpq moștenită nu poate redirecționa conexiunea (ex. PGHOSTADDR/PGSERVICE spre remote).
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE \
      PGOPTIONS PGSSLMODE PGREQUIRESSL PGTARGETSESSIONATTRS PGAPPNAME PGCLIENTENCODING PGDATA
export PGCONNECT_TIMEOUT=5 PGCLIENTENCODING=UTF8 PGAPPNAME=test_powpatroll_registry

ca_postgres() {  # comenzile de server nu rulează ca root
  if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi
}
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)

# --- 1. cluster local dedicat: initdb la nevoie, pornire, verificare identitate ---
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
# Serverul de pe port TREBUIE să fie clusterul nostru — altfel refuz (nu dăm DROP DATABASE/ROLE pe altceva).
DIR_SERVER="$("${PSQL[@]}" -d postgres -Atc 'SHOW data_directory')" || mediu "nu mă pot conecta la 127.0.0.1:$PORT"
[ "$(realpath "$DIR_SERVER")" = "$(realpath "$DATE_DIR")" ] || mediu "pe portul $PORT rulează alt cluster ($DIR_SERVER), nu $DATE_DIR"
VER="$("${PSQL[@]}" -d postgres -Atc 'SHOW server_version_num')"
[ "${VER:0:2}" = 16 ] || mediu "server_version_num=$VER, se cere 16"
# Clusterul e dedicat: în afară de bazele noastre de test nu trebuie să existe altceva (rolul e global).
STRAINE="$("${PSQL[@]}" -d postgres -Atc "SELECT string_agg(datname, ',') FROM pg_database
  WHERE datname NOT IN ('postgres','template0','template1','$BAZA','$BAZA_PL')")"
[ -z "$STRAINE" ] || mediu "clusterul $DATE_DIR are și alte baze ($STRAINE) — folosește un PGDATA_TEST dedicat"

# --- 2. curățenie + rolul care imită postgres din Supabase ---------------------
"${PSQL[@]}" -d postgres -c "SET client_min_messages = warning" \
  -c "DROP DATABASE IF EXISTS \"$BAZA_PL\" WITH (FORCE)" -c "DROP DATABASE IF EXISTS \"$BAZA\" WITH (FORCE)" \
  -c "DROP ROLE IF EXISTS powpatroll_owner" || mediu "nu pot curăța bazele/rolul din rularea anterioară"
"${PSQL[@]}" -d postgres <<SQL || mediu "nu pot crea rolul $SIM"
SET client_min_messages = warning;
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$SIM') THEN
    CREATE ROLE $SIM NOLOGIN NOSUPERUSER CREATEROLE BYPASSRLS INHERIT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$SIM' AND (rolsuper OR NOT rolcreaterole OR NOT rolbypassrls)) THEN
    RAISE EXCEPTION 'rolul $SIM are atribute greșite';
  END IF;
END \$\$;
SQL

recreeaza_baza() {  # $1 = baza
  "${PSQL[@]}" -d postgres -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)" \
    -c "CREATE DATABASE \"$1\" TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US' LOCALE 'C.UTF-8'" \
    || mediu "nu pot recrea baza $1"
  "${PSQL[@]}" -d "$1" -f "$SCHELET" >/dev/null || esec "scheletul nu s-a încărcat în $1"
  "${PSQL[@]}" -d "$1" -f "$SCHELET_EXTRA" >/dev/null || esec "suplimentul de schelet nu s-a încărcat în $1"
  echo "→ baza $1: schelet ${SCHELET#$RADACINA/} + ${SCHELET_EXTRA#$RADACINA/}"
}

# --- 3. lista de migrări -------------------------------------------------------
MIGRARI=()
while IFS= read -r linie || [ -n "$linie" ]; do
  linie="${linie%%#*}"; linie="$(echo "$linie" | xargs)"
  [ -n "$linie" ] && MIGRARI+=("$linie")
done < "$LISTA"
[ ${#MIGRARI[@]} -gt 0 ] || mediu "lista de migrări e goală"
for m in "${MIGRARI[@]}"; do
  [ -f "$(cale_abs "$m")" ] || mediu "migrare lipsă: $m"
  [ -f "$(cale_abs "${m%.sql}_ROLLBACK.sql")" ] || mediu "rollback lipsă pentru: $m"
done

# $1 = baza, $2 = fișier, $3 = rol (gol = postgres superuser). O singură tranzacție, ca apply_migration.
aplica_fisier() {
  local f; f="$(cale_abs "$2")"
  local pre=()
  [ -n "${3:-}" ] && pre=(-c "SET SESSION AUTHORIZATION $3" -c "SET search_path = public, extensions, pg_catalog")
  echo "→ aplic ${f#$RADACINA/} în $1${3:+ ca $3}"
  "${PSQL[@]}" -d "$1" --single-transaction ${pre[@]+"${pre[@]}"} -f "$f" || esec "${f#$RADACINA/} a eșuat în $1${3:+ (ca $3)}"
}
aplica_migrari()   { for m in "${MIGRARI[@]}"; do aplica_fisier "$1" "$m" "${2:-}"; done; }
aplica_rollbackuri() { local i; for (( i=${#MIGRARI[@]}-1; i>=0; i-- )); do aplica_fisier "$1" "${MIGRARI[$i]%.sql}_ROLLBACK.sql" "${2:-}"; done; }

TOTAL_OK=0
# $1 = eticheta, $2 = baza, $3 = fișier teste, $4 = doar_baza (true/false), $5 = rol (opțional)
ruleaza_teste() {
  local iesire; iesire="$(mktemp)"
  local pre=()
  [ -n "${5:-}" ] && pre=(-c "SET SESSION AUTHORIZATION $5")
  echo "→ teste [$1]: ${3#$RADACINA/} (baza $2${5:+, ca $5})"
  set +e
  "${PSQL[@]}" -d "$2" -o /dev/null -v doar_baza="$4" ${pre[@]+"${pre[@]}"} -f "$3" 2>&1 | tee "$iesire" | sed 's/^psql:[^ ]* NOTICE:  /  /'
  local st=${PIPESTATUS[0]}
  set -e
  local n; n="$(grep -c 'NOTICE:  OK ' "$iesire" || true)"
  rm -f "$iesire"
  [ "$st" = 0 ] || esec "teste [$1] — psql a ieșit cu $st"
  TOTAL_OK=$((TOTAL_OK + n))
  echo "   [$1] $n aserțiuni OK"
}
ok() { TOTAL_OK=$((TOTAL_OK + 1)); echo "  OK   $*"; }

schema_snapshot() {  # $1 = baza; schema fără date, cu ACL-uri (prinde GRANT-uri/obiecte rămase după rollback)
  "$PG_BIN/pg_dump" -h 127.0.0.1 -p "$PORT" -U postgres -d "$1" --schema-only --no-owner \
    | grep -vE '^(--|SET |SELECT pg_catalog\.set_config|\\(un)?restrict )' | sed '/^$/d'
}
compara_schema() {  # $1 = fișier snapshot, $2 = baza, $3 = context
  local dupa; dupa="$(mktemp)"
  schema_snapshot "$2" > "$dupa"
  if ! diff -u "$1" "$dupa" > "$dupa.diff"; then
    echo "!! $3: schema diferă:" >&2; head -80 "$dupa.diff" >&2
    rm -f "$dupa" "$dupa.diff"; esec "$3"
  fi
  rm -f "$dupa" "$dupa.diff"
}
rol_exista() { "${PSQL[@]}" -d postgres -Atc "SELECT count(*) FROM pg_roles WHERE rolname = 'powpatroll_owner'"; }

# ============================================================================
# A. prod-like: migrarea aplicată ca rol NOSUPERUSER CREATEROLE BYPASSRLS (postgres din Supabase)
# ============================================================================
if [ "$PRODLIKE" = 1 ]; then
  echo "== A. prod-like ($SIM în $BAZA_PL) =="
  recreeaza_baza "$BAZA_PL"
  # Ca în Supabase: postgres deține baza (→ pg_database_owner → CREATE pe public), are USAGE pe auth,
  # EXECUTE pe fn_is_app_owner, iar obiectele create de el primesc default ACL spre anon/authenticated/service_role.
  "${PSQL[@]}" -d "$BAZA_PL" >/dev/null <<SQL || mediu "setup prod-like eșuat"
SET client_min_messages = warning;
ALTER DATABASE "$BAZA_PL" OWNER TO $SIM;
ALTER DEFAULT PRIVILEGES FOR ROLE $SIM IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE $SIM IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE $SIM IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth, teste TO $SIM;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO $SIM;
GRANT EXECUTE ON FUNCTION public.fn_is_app_owner(uuid) TO $SIM;
SQL
  SNAP_PL="$(mktemp)"; schema_snapshot "$BAZA_PL" > "$SNAP_PL"
  aplica_migrari "$BAZA_PL" "$SIM"
  echo "→ reaplic ca $SIM (idempotență fără superuser)"
  aplica_migrari "$BAZA_PL" "$SIM"
  ruleaza_teste "prod-like: frână/ownership" "$BAZA_PL" "$TESTE_PL" false "$SIM"
  ruleaza_teste "prod-like: teste complete" "$BAZA_PL" "$TESTE" false
  aplica_rollbackuri "$BAZA_PL" "$SIM"
  [ "$(rol_exista)" = 0 ] || esec "prod-like: rollback-ul (ca $SIM) nu a șters rolul powpatroll_owner"
  ok "prod-like: rollback ca $SIM a șters și rolul powpatroll_owner"
  compara_schema "$SNAP_PL" "$BAZA_PL" "prod-like: rollback incomplet"
  ok "prod-like: schema după rollback = schema dinainte de migrare"
  rm -f "$SNAP_PL"
  ruleaza_teste "prod-like: după rollback, doar BAZĂ" "$BAZA_PL" "$TESTE" true
  "${PSQL[@]}" -d postgres -c "DROP DATABASE \"$BAZA_PL\" WITH (FORCE)" || mediu "nu pot șterge $BAZA_PL"
fi

# ============================================================================
# B. principal (superuser local, ca harness-ul conturi)
# ============================================================================
echo "== B. principal ($BAZA) =="
recreeaza_baza "$BAZA"
SNAP="$(mktemp)"; schema_snapshot "$BAZA" > "$SNAP"
aplica_migrari "$BAZA"
ruleaza_teste "după migrare" "$BAZA" "$TESTE" false
if [ "$REAPLICA" = 1 ]; then
  echo "→ reaplic migrările (idempotență)"
  aplica_migrari "$BAZA"
  ruleaza_teste "după reaplicare" "$BAZA" "$TESTE" false
fi
if [ "$ROLLBACK" = 1 ]; then
  aplica_rollbackuri "$BAZA"
  compara_schema "$SNAP" "$BAZA" "rollback incomplet"
  ok "schema după rollback = schema dinainte de migrări"
  [ "$(rol_exista)" = 0 ] || esec "rollback-ul nu a șters rolul powpatroll_owner"
  ok "rollback-ul a șters rolul powpatroll_owner"
  echo "→ rollback a 2-a oară (idempotent)"
  aplica_rollbackuri "$BAZA"
  ok "rollback-ul rulat de 2 ori nu eșuează"
  ruleaza_teste "după rollback, doar BAZĂ" "$BAZA" "$TESTE" true
  echo "→ reaplic după rollback"
  aplica_migrari "$BAZA"
  ruleaza_teste "după rollback + reaplicare" "$BAZA" "$TESTE" false
fi

# ============================================================================
# C. concurență: sesiuni psql reale, date COMMIT-uite în $BAZA
# ============================================================================
echo "== C. concurență =="
rand() {  # $1 = cheie, $2 = status, $3 = titlu
  printf '[{"kind":"finding","item_key":"%s","status":"%s","actor":"claude","title":"%s","source":"harness concurenta 03.10","evidence":"dovada harness %s"}]' "$1" "$2" "$3" "$1"
}
scrie_sql() {  # $1 = p_known, $2 = sesiune, $3 = json
  echo "SELECT 'R=' || public.powpatroll_write($1, '$2', '$3'::jsonb)::text"
}
asteapta_lock() {  # până când o sesiune ține advisory lock-ul registry-ului (max. 5 s)
  local i
  for i in $(seq 1 50); do
    [ "$("${PSQL[@]}" -d "$BAZA" -Atc "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted")" -ge 1 ] && return 0
    sleep 0.1
  done
  esec "concurență: sesiunea A nu a luat advisory lock-ul"
}
TMPA="$(mktemp)"; TMPB="$(mktemp)"
V1="$("${PSQL[@]}" -d "$BAZA" -Atc "SELECT (public.powpatroll_write(0, 'sesiune_conc_seed', '$(rand CONC-01 OPEN 'Seed concurenta')'::jsonb))->>'version'")"
[ "$V1" = 1 ] || esec "concurență: seed-ul trebuia să dea v1 (a dat: $V1)"
# A: scrie pe CONC-01 de la v1 și ține tranzacția (deci lock-ul) deschisă 2 s
( "${PSQL[@]}" -d "$BAZA" -At -c "BEGIN" -c "$(scrie_sql 1 sesiune_conc_A "$(rand CONC-01 HOLD 'Scriere A')")" \
    -c "SELECT pg_sleep(2)" -c "COMMIT" > "$TMPA" 2>&1 ) &
PID_A=$!
asteapta_lock
T0=$(date +%s%N)
"${PSQL[@]}" -d "$BAZA" -At -c "$(scrie_sql 1 sesiune_conc_B "$(rand CONC-01 CLOSED 'Scriere B')")" > "$TMPB" 2>&1 || esec "concurență: B a eșuat: $(cat "$TMPB")"
T1=$(date +%s%N)
wait "$PID_A" || esec "concurență: A a eșuat: $(cat "$TMPA")"
RA="$(grep '^R=' "$TMPA" || true)"; RB="$(grep '^R=' "$TMPB" || true)"
echo "   A: ${RA:0:160}"; echo "   B: ${RB:0:160}"
echo "$RA" | grep -Eq '"ok": ?true' && echo "$RA" | grep -Eq '"version": ?2[,}]' || esec "concurență: A trebuia să scrie v2"
ok "concurență: A (prima) a scris v2 pe CONC-01"
echo "$RB" | grep -Eq '"cod": ?"STALE_KEY"' && echo "$RB" | grep -q 'CONC-01' || esec "concurență: B trebuia să primească STALE_KEY cu delta pe CONC-01"
ok "concurență: B (aceeași cheie, aceeași versiune de bază) → STALE_KEY cu delta, fără scriere"
MS=$(( (T1 - T0) / 1000000 ))
[ "$MS" -ge 800 ] || esec "concurență: B nu a așteptat lock-ul lui A (${MS} ms) — testul nu a fost concurent"
ok "concurență: B a așteptat advisory lock-ul lui A (${MS} ms), apoi a văzut commit-ul"
# C și D: chei diferite, aceeași versiune de bază → ambele trec, pe rând
( "${PSQL[@]}" -d "$BAZA" -At -c "BEGIN" -c "$(scrie_sql 2 sesiune_conc_C "$(rand CONC-02 OPEN 'Scriere C')")" \
    -c "SELECT pg_sleep(1)" -c "COMMIT" > "$TMPA" 2>&1 ) &
PID_C=$!
asteapta_lock
"${PSQL[@]}" -d "$BAZA" -At -c "$(scrie_sql 2 sesiune_conc_D "$(rand CONC-03 OPEN 'Scriere D')")" > "$TMPB" 2>&1 || esec "concurență: D a eșuat: $(cat "$TMPB")"
wait "$PID_C" || esec "concurență: C a eșuat: $(cat "$TMPA")"
grep -q '^R=.*"ok": true.*' "$TMPA" && grep -q '^R=.*"ok": true.*' "$TMPB" || esec "concurență: C și D (chei diferite) trebuiau să treacă amândouă"
ok "concurență: C și D pe chei diferite de la aceeași versiune → ambele scrise (serializate)"
STARE="$("${PSQL[@]}" -d "$BAZA" -Atc "SELECT (SELECT max(version) FROM public.powpatroll_versions) || '|' ||
  (SELECT count(*) FROM public.powpatroll_log WHERE item_key = 'CONC-01') || '|' ||
  (public.powpatroll_check(4, NULL)->>'status') || '|' || (public.powpatroll_check(4, NULL)->'lant'->>'ok')")"
[ "$STARE" = "4|2|OK|true" ] || esec "concurență: stare finală neașteptată ($STARE; aștept 4|2|OK|true)"
ok "concurență: head=v4, CONC-01 are 2 rânduri (seed + A), lanțul verificat OK"
rm -f "$TMPA" "$TMPB"

# ============================================================================
# D. rollback refuzat când registry-ul are istoric (versiuni > v1)
# ============================================================================
echo "== D. rollback cu istoric =="
SNAP_D="$(mktemp)"; schema_snapshot "$BAZA" > "$SNAP_D"
RB="$(cale_abs "${MIGRARI[0]%.sql}_ROLLBACK.sql")"
if "${PSQL[@]}" -d "$BAZA" --single-transaction -f "$RB" >/dev/null 2>"$SNAP_D.err"; then
  esec "rollback-ul a rulat deși registry-ul are v4"
fi
grep -q 'Rollback refuzat' "$SNAP_D.err" || esec "rollback-ul a eșuat din alt motiv: $(cat "$SNAP_D.err")"
ok "rollback refuzat cu registry la v4: „$(grep -o 'Rollback refuzat[^.]*' "$SNAP_D.err" | head -1)”"
compara_schema "$SNAP_D" "$BAZA" "rollback-ul refuzat a lăsat urme"
[ "$("${PSQL[@]}" -d "$BAZA" -Atc "SELECT count(*) FROM public.powpatroll_log")" = 4 ] || esec "rollback-ul refuzat a atins datele"
ok "rollback refuzat: schema și datele neschimbate"
rm -f "$SNAP_D" "$SNAP_D.err" "$SNAP"

if [ "$OPRESTE" = 1 ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null && echo "→ server oprit"; fi
BAZE="$BAZA"; [ "$PRODLIKE" = 1 ] && BAZE="$BAZA + $BAZA_PL (prod-like, ștearsă)"
echo "PASS test_powpatroll_registry: $TOTAL_OK aserțiuni OK, ${#MIGRARI[@]} migrare (baze $BAZE @ 127.0.0.1:$PORT)"
