#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Test PG16 LOCAL pentru patch-ul 20261003b (Ofertare (2)+(3)). Nu atinge Supabase.
#   bash scripts/test_sec_ofertare.sh            # rulează tot și oprește clusterul la final
#   KEEP=1 bash scripts/test_sec_ofertare.sh     # lasă clusterul pornit (depanare)
# Cluster dedicat: PGDATA /tmp/pg_sec_ofertare/data, doar 127.0.0.1:5441, baza sec_ofertare_test.
# Ca root, initdb/pg_ctl rulează prin „su postgres”; psql e client TCP (-U postgres, trust local).
#
# Ordinea (cerută de Copilot): setup (copia LIVE) → gaura pe copia live → migrare → teste →
#   rollback tehnic NEARMAT (trebuie refuzat) → rollback tehnic armat → teste care dovedesc gaura →
#   precondiții negative → reaplicare → teste → revenire operațională → teste poartă →
#   reaplicare → teste → urma din jurnalul Postgres.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGPORT="${PGPORT:-5441}"
BASE="${PGBASE:-/tmp/pg_sec_ofertare}"
PGDATA="$BASE/data"
LOG="$BASE/server.log"
DB=sec_ofertare_test
MIG="$ROOT/supabase/migrations/20261003b_sec_ofertare_porti_alege_inventar.sql"
RB="$ROOT/supabase/migrations/20261003b_sec_ofertare_porti_alege_inventar_ROLLBACK.sql"
OP="$ROOT/supabase/migrations/20261003b_sec_ofertare_porti_alege_inventar_REVENIRE_OPERATIONALA.sql"
TEST="$ROOT/supabase/tests/sec_ofertare_porti.test.sql"
ARM="SET gazpet.rollback_tehnic_20261003b = 'REDESCHIDE_BYPASS';"

for f in "$MIG" "$RB" "$OP" "$TEST"; do [ -f "$f" ] || { echo "Lipsește $f" >&2; exit 2; }; done
[ -x "$PGBIN/postgres" ] || { echo "PostgreSQL 16 lipsește în $PGBIN" >&2; exit 2; }

ca_pg() {  # rulează ca utilizatorul postgres (initdb/pg_ctl refuză root)
  if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi
}
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U postgres)
pas() { printf '\n\033[1m── %s\033[0m\n' "$*"; }
esec() { printf '\n\033[31mEȘEC: %s\033[0m\n' "$*" >&2; exit 1; }
faza() { "${PSQL[@]}" -d "$DB" -o /dev/null -v faza="$1" -f "$TEST" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /; s/^NOTICE:  /  /'; return "${PIPESTATUS[0]}"; }
aplica() { "${PSQL[@]}" -d "$DB" -1 -f "$1"; }
stare() {  # md5-urile curente, pentru mesaje
  "${PSQL[@]}" -d "$DB" -Atc "SELECT md5(pg_get_functiondef('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure)) || ' ' || md5(pg_get_functiondef('public.ofertare_inventar_pereche(bigint,text,integer,real)'::regprocedure))"
}
LIVE_MD5="6c9995646a6dbe6da995e48a3a885fc9 500263dacba2b44e0caa1cb07db88d6e"

# ── Cluster dedicat ────────────────────────────────────────────────────────────
pas "Cluster PG16 dedicat pe 127.0.0.1:$PGPORT ($PGDATA)"
if ! "$PGBIN/pg_isready" -q -h 127.0.0.1 -p "$PGPORT"; then
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$BASE"
    [ "$(id -u)" = 0 ] && chown postgres:postgres "$BASE"
    chmod 700 "$BASE"
    ca_pg "'$PGBIN/initdb' -D '$PGDATA' -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null"
  fi
  ca_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -l '$LOG' -w -o \"-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$BASE -c timezone=UTC\" start >/dev/null"
  PORNIT_DE_NOI=1
else
  PORNIT_DE_NOI=0
fi
oprire() { if [ "${KEEP:-0}" != 1 ] && [ "$PORNIT_DE_NOI" = 1 ]; then ca_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -m fast -w stop >/dev/null" || true; fi; }
trap oprire EXIT
V=$("${PSQL[@]}" -d postgres -Atc "SELECT current_setting('server_version_num')::int / 10000")
[ "$V" = 16 ] || esec "Pe portul $PGPORT răspunde PG $V, nu 16"
LOG_START=$( [ -f "$LOG" ] && stat -c %s "$LOG" || echo 0 )

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"

pas "1. Setup: schelet + funcțiile LIVE din 29.09 (md5 = live) + ACL live"
faza setup || esec "setup"

pas "2. GAURA pe copia live (înainte de patch)"
faza gaura || esec "gaura pe starea live"

pas "3. Migrare 20261003b"
aplica "$MIG" || esec "migrarea"
pas "3b. Migrare aplicată a doua oară (idempotentă)"
aplica "$MIG" || esec "reaplicarea migrării"

pas "4. Teste obligatorii pe patch"
faza patched || esec "teste patched"

pas "5. ROLLBACK TEHNIC nearmat → trebuie refuzat, fără efect"
if aplica "$RB" 2>"$BASE/rb.err"; then esec "rollback-ul tehnic a rulat fără armare"; fi
grep -q "ROLLBACK TEHNIC 20261003b blocat" "$BASE/rb.err" || { cat "$BASE/rb.err" >&2; esec "mesajul de blocare lipsește"; }
echo "  OK  refuzat: $(grep -o 'ROLLBACK TEHNIC 20261003b blocat[^.]*' "$BASE/rb.err" | head -1)"
[ "$(stare)" != "$LIVE_MD5" ] || esec "rollback-ul nearmat a schimbat totuși funcțiile"
"${PSQL[@]}" -d "$DB" -Atc "SELECT position('SEC-20261003b' IN pg_get_functiondef('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure)) > 0" | grep -qx t || esec "patch-ul nu mai e activ după refuz"
echo "  OK  patch-ul a rămas activ"

pas "6. ROLLBACK TEHNIC armat → reproduce gaura"
"${PSQL[@]}" -d "$DB" -1 -c "$ARM" -f "$RB" 2>&1 | sed 's/^/  /' || esec "rollback-ul tehnic armat"
[ "$(stare)" = "$LIVE_MD5" ] || esec "după rollback md5 ≠ live ($(stare))"
echo "  OK  md5 după rollback = starea live din 29.09"
faza gaura || esec "gaura după rollback tehnic"
# Testele nu sunt „vacuu adevărate”: pe starea live, suita patched TREBUIE să cadă.
if faza patched >"$BASE/vacuu.out" 2>&1; then esec "suita patched a trecut pe starea live (testele nu prind gaura)"; fi
grep -q "TEST EȘUAT" "$BASE/vacuu.out" || { cat "$BASE/vacuu.out" >&2; esec "suita patched a căzut din alt motiv decât o aserțiune"; }
echo "  OK  suita patched CADE pe starea live: $(grep -o 'TEST EȘUAT: [^—]*' "$BASE/vacuu.out" | head -1)"

pas "7. Precondiții negative: o versiune live neauditată NU se suprascrie (totul într-o tranzacție, anulată)"
if "${PSQL[@]}" -d "$DB" -1 -c "ALTER FUNCTION public.fn_ofertare_alege_acoperire(bigint) COST 101" -f "$MIG" 2>"$BASE/pre.err"; then
  esec "migrarea a suprascris o fn_ofertare_alege_acoperire neauditată"; fi
grep -q "Precondiție 20261003b: fn_ofertare_alege_acoperire" "$BASE/pre.err" || { cat "$BASE/pre.err" >&2; esec "precondiția alege"; }
echo "  OK  alege_acoperire schimbată între timp → migrarea refuză"
if "${PSQL[@]}" -d "$DB" -1 -c "ALTER FUNCTION public.ofertare_inventar_pereche(bigint,text,integer,real) COST 101" -f "$MIG" 2>"$BASE/pre.err"; then
  esec "migrarea a suprascris o ofertare_inventar_pereche neauditată"; fi
grep -q "Precondiție 20261003b: ofertare_inventar_pereche" "$BASE/pre.err" || { cat "$BASE/pre.err" >&2; esec "precondiția pereche"; }
echo "  OK  inventar_pereche schimbată între timp → migrarea refuză"
if "${PSQL[@]}" -d "$DB" -1 -c "ALTER FUNCTION public.fn_are_acces_ofertare() COST 101" -f "$MIG" 2>"$BASE/pre.err"; then
  esec "migrarea a mers peste o fn_are_acces_ofertare schimbată"; fi
grep -q "Precondiție 20261003b: fn_are_acces_ofertare" "$BASE/pre.err" || { cat "$BASE/pre.err" >&2; esec "precondiția acces"; }
echo "  OK  fn_are_acces_ofertare schimbată → migrarea refuză"
[ "$(stare)" = "$LIVE_MD5" ] || esec "o precondiție refuzată a lăsat urme"
echo "  OK  tranzacțiile refuzate n-au lăsat nimic"

pas "8. Reaplicare migrare → teste"
aplica "$MIG" || esec "reaplicarea după rollback"
faza patched || esec "teste patched după reaplicare"

pas "9. REVENIRE OPERAȚIONALĂ → poarta rămâne închisă"
aplica "$OP" || esec "revenirea operațională"
faza operational || esec "teste revenire operațională"

pas "10. Reaplicare migrare peste starea operațională → teste"
aplica "$MIG" || esec "reaplicarea după revenirea operațională"
faza patched || esec "teste patched finale"

pas "11. Urma în jurnalul Postgres (RAISE LOG)"
NOU=$(tail -c +"$((LOG_START + 1))" "$LOG")
N_ALEGE=$(grep -c "SEC-20261003b alege_acoperire: cerinta=101 pozitie=<NULL> ales=1002 inlocuit=1001 inlocuit_ales_de=00000000-0000-4000-8000-000000000007 de=00000000-0000-4000-8000-000000000007" <<<"$NOU" || true)
N_PERECHE=$(grep -c "SEC-20261003b inventar_pereche: lic=10 furnizor=gemini versiune=1 prag_cerut=0 prag_aplicat=0.3 " <<<"$NOU" || true)
[ "$N_ALEGE" -ge 1 ] || esec "lipsește urma alegerii înlocuite din jurnal"
[ "$N_PERECHE" -ge 1 ] || esec "lipsește urma împerecherii (prag cerut 0 → aplicat 0.3) din jurnal"
echo "  OK  jurnal: alegere înlocuită (1001 → 1002, cine o făcuse + cine a schimbat) ×$N_ALEGE"
echo "  OK  jurnal: împerechere cu prag cerut 0 → aplicat 0.3 ×$N_PERECHE"

printf '\n\033[32mTOATE TESTELE AU TRECUT\033[0m (migrare → teste → rollback tehnic → gaura → reaplicare → teste → revenire operațională → teste → reaplicare → teste)\n'
