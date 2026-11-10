#!/usr/bin/env bash
# ============================================================================
# Test CONCURENT, cu DOUĂ SESIUNI REALE și BARIERĂ, pentru 20261207a_executie_noduri_constructii (review Jakarinos r1 P1, L06 / L25):
# importul (scripts/noduri_constructii_import_sql.mjs) și RPC-ul de bifare (fn_executie_constr_etapa) iau lock-urile în aceeași ordine
# (ÎNTÂI tabelul, APOI rândurile), deci nu se pot bloca reciproc.
# EXCLUSIV pe un PostgreSQL local de unică folosință (implicit PG 17, /tmp/pg_constr, 127.0.0.1:5981). Nu atinge producția și nici clona.
#   0. cluster nou + schelet tip Supabase (supabase/tests/20261207a_..._schelet.sql) + 20261201a + 20261207a, fiecare cu marcajul de livrare
#   1. importul sintetic 1 (comis): elementele nodului fictiv NOD-TEST-IMPORT
#   C1. importul (fixture 2, schimbă F6-2) ține lock-ul de tabel 3 s; RPC-ul (owner, bifează F6-2) pornit după: trebuie văzut BLOCAT pe
#       lock-ul de TABEL (RowExclusiveLock neacordat), fără niciun lock de rând sau RowShareLock luat; după COMMIT-ul importului, RPC-ul se
#       termină cu „conflict” (versiunea s-a schimbat), fără deadlock.
#   C2. RPC-ul (owner, bifează F6-1) în tranzacție, ține 3 s după bifare; importul (fixture 1) pornit după: BLOCAT pe lock-ul de tabel
#       (ShareRowExclusiveLock neacordat); după COMMIT-ul RPC-ului, importul trece (prefixul bifat e păstrat); bifarea rămâne; fără deadlock.
# Utilizare: bash scripts/test_executie_noduri_constructii_concurent.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "${PG_BIN:-}" ]; then for v in 17 16 18; do [ -x "/usr/lib/postgresql/$v/bin/initdb" ] && { PG_BIN="/usr/lib/postgresql/$v/bin"; break; }; done; fi
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_constr}"
PORT="${PGPORT_TEST:-5981}"
BAZA=constr_test
SCHELET="$RADACINA/supabase/tests/20261207a_executie_noduri_constructii_schelet.sql"
M1="$RADACINA/supabase/migrations/20261201a_executie_noduri_suduri.sql"
M2="$RADACINA/supabase/migrations/20261207a_executie_noduri_constructii.sql"
FIX="$RADACINA/scripts/fixtures/nod_constructii"
OWNER=00000000-0000-0000-0000-000000000001
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
case "$DATE_DIR" in /tmp/pg_constr*) ;; *) mediu "PGDATA_TEST trebuie să fie sub /tmp/pg_constr* (primit: $DATE_DIR)";; esac
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_constr" ] || mediu "$DATE_DIR există și nu e marcat ca fixture (.fixture_constr) — nu îl șterg"
  if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || mediu "nu pot opri clusterul din $DATE_DIR"; fi
  rm -rf "$DATE_DIR"
fi
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_constr"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_constr.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c deadlock_timeout=200ms" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }

# 0. schelet + cele două migrări, fiecare într-o tranzacție cu marcajul ei de livrare
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
for M in "$M1" "$M2"; do
  N="$(basename "$M" .sql)"
  "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$N:' || txid_current(), true)" -f "$M" >/dev/null || esec "0 aplicarea $N"
done
[ "$(q "SELECT to_regclass('public.executie_noduri_constructii') IS NOT NULL")" = t ] || esec "0 tabelul lipsește"
ok "0 schelet + 20261201a + 20261207a"

# 1. importul sintetic 1, comis
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$FIX/import_exemplu_1.sql" >/dev/null 2>&1 || esec "1 importul 1"
[ "$(q "SELECT count(*) FROM executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-IMPORT'")" = 4 ] || esec "1 elementele importului"
ok "1 import sintetic: 4 elemente"

AZI="(now() AT TIME ZONE 'Europe/Bucharest')::date"
id_de() { q "SELECT id FROM executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-IMPORT' AND cod = '$1'"; }
ver_de() { q "SELECT versiune FROM executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-IMPORT' AND cod = '$1'"; }
urm_de() { q "SELECT etapa_curenta FROM executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-IMPORT' AND cod = '$1'"; }
# sesiunea de import: $1 aplicație, $2 fixture, $3 secunde ținute după import, $4 ieșire
imp() { PGAPPNAME="$1" "${PSQL[@]}" -d "$BAZA" -At -c "BEGIN" -f "$2" -c "SELECT pg_sleep($3)" -c "COMMIT" >"$4" 2>&1 || true; }
# sesiunea RPC (owner, rol authenticated): $1 aplicație, $2 cod, $3 secunde ținute după RPC, $4 ieșire
rpc() { local id v e; id="$(id_de "$2")"; v="$(ver_de "$2")"; e="$(urm_de "$2")"
  PGAPPNAME="$1" "${PSQL[@]}" -d "$BAZA" -At -c "BEGIN" -c "SELECT set_config('request.jwt.claim.sub', '$OWNER', true)" -c "SET LOCAL ROLE authenticated" \
    -c "SELECT public.fn_executie_constr_etapa($id, $v, 'bifeaza', '$e', $AZI, NULL, gen_random_uuid())" -c "SELECT pg_sleep($3)" -c "COMMIT" >"$4" 2>&1 || true; }
asteapta() { local i; for i in $(seq 150); do [ "$(q "$2")" = 1 ] && return 0; sleep 0.1; done; esec "barieră $1"; }
in_sleep() { echo "SELECT (count(*) = 1)::int FROM pg_stat_activity WHERE application_name = '$1' AND state = 'active' AND query LIKE 'SELECT pg_sleep%'"; }
blocat() { echo "SELECT (count(*) = 1)::int FROM pg_stat_activity WHERE application_name = '$1' AND cardinality(pg_blocking_pids(pid)) > 0"; }
# lock-ul NEacordat al sesiunii $1 pe tabel, în modul $2; și câte lock-uri ACORDATE are ea pe rânduri / pe tabel în modul RowShareLock
asteapta_lock() { q "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = '$1' AND NOT l.granted
  AND l.locktype = 'relation' AND l.relation = 'public.executie_noduri_constructii'::regclass AND l.mode = '$2'"; }
randuri_luate() { q "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = '$1' AND l.granted
  AND (l.locktype = 'tuple' OR (l.locktype = 'relation' AND l.relation = 'public.executie_noduri_constructii'::regclass AND l.mode = 'RowShareLock'))"; }
fara_deadlock() { ! grep -Eqi 'deadlock|40P01' "$1" || esec "$2: deadlock în $(basename "$1"): $(cat "$1")"; }

# C1: importul întâi, RPC-ul după
V2="$(ver_de F6-2)"
imp cI "$FIX/import_exemplu_2.sql" 3 /tmp/constr_c1_imp.out & PI=$!
asteapta "C1: importul n-a ajuns în pg_sleep ($(cat /tmp/constr_c1_imp.out 2>/dev/null))" "$(in_sleep cI)"
rpc cA F6-2 0 /tmp/constr_c1_rpc.out & PA=$!
asteapta "C1: RPC-ul nu a fost blocat de import" "$(blocat cA)"
[ "$(asteapta_lock cA RowExclusiveLock)" = 1 ] || esec "C1: RPC-ul nu așteaptă lock-ul de TABEL (RowExclusiveLock): $(q "SELECT string_agg(locktype || ':' || mode || ':' || granted, ' ') FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = 'cA'")"
[ "$(randuri_luate cA)" = 0 ] || esec "C1: RPC-ul ține deja lock-uri de rând înaintea tabelului"
wait $PI; wait $PA
fara_deadlock /tmp/constr_c1_imp.out C1; fara_deadlock /tmp/constr_c1_rpc.out C1
grep -q ERROR /tmp/constr_c1_imp.out && esec "C1: importul a eșuat: $(cat /tmp/constr_c1_imp.out)"
grep -q '"motiv": "conflict"' /tmp/constr_c1_rpc.out || esec "C1: RPC-ul trebuia să întoarcă conflict (versiunea schimbată de import): $(cat /tmp/constr_c1_rpc.out)"
[ "$(ver_de F6-2)" -gt "$V2" ] && [ "$(q "SELECT cardinality(etape_data) FROM executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-IMPORT' AND cod = 'F6-2'")" = 0 ] \
  || esec "C1: starea finală a lui F6-2"
ok "C1 import -> RPC: RPC-ul a așteptat la lock-ul de tabel (niciun rând luat), apoi conflict; fără deadlock"

# C2: RPC-ul întâi (ține tranzacția), importul după
rpc cA2 F6-1 3 /tmp/constr_c2_rpc.out & PA=$!
asteapta "C2: RPC-ul n-a ajuns în pg_sleep ($(cat /tmp/constr_c2_rpc.out 2>/dev/null))" "$(in_sleep cA2)"
imp cI2 "$FIX/import_exemplu_1.sql" 0 /tmp/constr_c2_imp.out & PI=$!
asteapta "C2: importul nu a fost blocat de RPC" "$(blocat cI2)"
[ "$(asteapta_lock cI2 ShareRowExclusiveLock)" = 1 ] || esec "C2: importul nu așteaptă lock-ul de TABEL (ShareRowExclusiveLock)"
wait $PA; wait $PI
fara_deadlock /tmp/constr_c2_imp.out C2; fara_deadlock /tmp/constr_c2_rpc.out C2
grep -q '"ok": true' /tmp/constr_c2_rpc.out || esec "C2: RPC-ul: $(cat /tmp/constr_c2_rpc.out)"
grep -q ERROR /tmp/constr_c2_imp.out && esec "C2: importul a eșuat după RPC: $(cat /tmp/constr_c2_imp.out)"
[ "$(q "SELECT cardinality(etape_data) || '|' || etapa_curenta FROM executie_noduri_constructii WHERE nod_cod = 'NOD-TEST-IMPORT' AND cod = 'F6-1'")" = '3|turnare' ] \
  || esec "C2: bifarea RPC-ului nu s-a păstrat după import"
ok "C2 RPC -> import: importul a așteptat la lock-ul de tabel, apoi a trecut; bifarea păstrată; fără deadlock"
echo "TEST CONCURENT: TOATE OK"
