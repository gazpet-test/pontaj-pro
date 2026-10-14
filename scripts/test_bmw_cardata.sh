#!/usr/bin/env bash
# ============================================================================
# Harness local — 20261030c_bmw_cardata (BMW CarData append-only) + scriptul scripts/bmw_cardata. DOAR PG17 local dedicat
# (implicit /tmp/pg_bmw_cardata, 127.0.0.1:5976). Nu atinge producția și nu face nicio cerere la BMW.
#   0. schelet (= structura live 14.10 folosită de migrare) → suita TREBUIE să cadă pe T1 (discriminare)
#   1. fără marcaj de livrare → garda refuză, nimic creat
#   2. aplicare (ca runnerul: marcaj + --single-transaction) → suita SQL; gate-ul permanent 0e (control_0e.sql) = 0 rânduri
#   3. reaplicare → refuz (Precondiție 0b), nimic dublat
#   4. capăt-la-capăt Python → psql → BD: citire simulată (cu text ostil în raspuns_brut) scrisă de `python -m bmw_cardata scrie`;
#      reluarea aceleiași citiri (confirmare pierdută) → „deja”, nimic dublat; locația în tabelul separat, nu în raspuns_brut
#   5. revenire: nearmat → refuz; armat fără date → refuz (are date); armat CU_DATE → obiectele dispar; reaplicare → suita
#   6. validatorul runnerului acceptă migrarea; testele Python (unittest) trec
# Ieșire: 0 = PASS · 1 = eșec · 2 = mediu.  PG_BIN / PYTHON se pot suprascrie (Windows: PG_BIN=/c/Users/Public/pgsql/bin).
# ============================================================================
set -Eeuo pipefail
export PGCLIENTENCODING=UTF8
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_bmw_cardata}"
PORT="${PGPORT_TEST:-5976}"
BAZA=bmw_cardata_test
NUME=20261030c_bmw_cardata
MIGRARE_SURSA="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/bmw_cardata_schelet.sql"
TESTE="$RADACINA/supabase/tests/bmw_cardata.test.sql"
MARCAJ="SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);"
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
EXE=""; SOCKET=(-c unix_socket_directories=/tmp); PY="${PYTHON:-python3}"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) EXE=".exe"; SOCKET=(); PY="${PYTHON:-python}" ;; esac
PSQL=("$PG_BIN/psql$EXE" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb$EXE" ] || mediu "PG17 lipsă ($PG_BIN)"
command -v "$PY" >/dev/null || mediu "python lipsă ($PY)"
TMP="$(mktemp -d)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"
ca_postgres "$PG_BIN/initdb$EXE" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --no-locale >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -l "$DATE_DIR.log" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c timezone=UTC ${SOCKET[*]}" >/dev/null || mediu "pg_ctl start"
trap 'ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; rm -rf "$TMP"; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
obiecte() { q "SELECT count(*) FROM pg_class WHERE relname IN ('bmw_cardata_citiri','bmw_cardata_locatii','v_bmw_cardata_vs_evogps')"; }
OUT="$TMP/out"
suita() { "${PSQL[@]}" -d "$BAZA" -f "$TESTE" >"$OUT" 2>&1 && grep -q SUITA_OK "$OUT" || { cat "$OUT"; esec "suita ($1)"; }
  echo "     [$1] $(grep -c 'OK T[0-9]' "$OUT") aserțiuni OK"; ok "suita ($1)"; }
aplica() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "$MARCAJ" -f "$MIGRARE_SURSA" >"$OUT" 2>&1; }

# 0. schelet + discriminare
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
if "${PSQL[@]}" -d "$BAZA" -f "$TESTE" >"$OUT" 2>&1; then esec "0 suita trece fără migrare (nu discriminează)"; fi
grep -q 'ESEC TEST: T1' "$OUT" || { cat "$OUT"; esec "0 suita a căzut din alt motiv"; }
ok "0 schelet; suita cade pe T1 fără migrare"

# 1. fără marcaj
if "${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE_SURSA" >"$OUT" 2>&1; then esec "1 migrarea a trecut fără marcaj"; fi
grep -q 'garda de livrare (start)' "$OUT" || { cat "$OUT"; esec "1 refuz din alt motiv"; }
[ "$(obiecte)" = 0 ] || esec "1 au apărut obiecte"
ok "1 fără marcaj → refuz (garda start), nimic creat"

# 2. aplicare + suita
aplica || { cat "$OUT"; esec "2 aplicare"; }
[ "$(obiecte)" = 3 ] || esec "2 obiectele lipsesc"
ok "2 aplicare cu marcaj (pre + post trecute)"
suita "după 20261030c"
N0E="$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql" 2>"$OUT" | grep -c . || true)"
[ "$N0E" = 0 ] && ! grep -q ERROR "$OUT" || { cat "$OUT"; esec "2 gate 0e: $N0E funcții expuse"; }
ok "2 gate 0e (scripts/control_0e.sql) = 0 rânduri"

# 3. reaplicare
if aplica; then esec "3 reaplicarea a trecut"; fi
grep -q 'Precondiție 0b' "$OUT" || { cat "$OUT"; esec "3 refuz din alt motiv"; }
ok "3 reaplicare → refuz (Precondiție 0b)"

# 4. capăt-la-capăt: scriptul Python scrie prin psql în baza de test
D="$TMP/bmw"; mkdir -p "$D"
PYTHONPATH="$RADACINA/scripts" "$PY" -B - "$D" <<'PY' || esec "4 pregătirea citirii simulate"
import sys
from datetime import datetime, timedelta, timezone
from bmw_cardata import client as C, valideaza as V
st = C.Stocare(sys.argv[1])
vin = 'WBATEST0000000001'
st.salveaza_setup({'vin': vin, 'container_id': 'abcDEF1234567', 'chei': V.CHEI_CONTAINER, 'setup_la': 'x', 'basic': {}})
acum = datetime.now(timezone.utc) - timedelta(minutes=2)
ts = (acum - timedelta(hours=3)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
td = {k: {'value': v, 'unit': u, 'timestamp': ts} for k, v, u in [
    ('vehicle.vehicle.travelledDistance', '48213', 'km'),
    ('vehicle.drivetrain.fuelSystem.level', '62', "x$$;DROP--'"),            # unitate ostilă: câmp respins, textul rămâne dată
    ('vehicle.drivetrain.fuelSystem.remainingFuel', '41.5', 'l'),
    ('vehicle.drivetrain.batteryManagement.header', '87', '%'),
    ('vehicle.cabin.infotainment.navigation.currentLocation.latitude', '44.936667', 'degrees'),
    ('vehicle.cabin.infotainment.navigation.currentLocation.longitude', '26.012345', 'degrees'),
    ('vehicle.cabin.infotainment.navigation.currentLocation.heading', '181', 'degrees')]}
rec = V.din_raspuns({'telematicData': td}, vin, acum)
assert rec['combustibil_pct'] is None and rec['locatie'] is not None
st.salveaza_citire(rec)
PY
scrie() { PYTHONPATH="$RADACINA/scripts" "$PY" -B -m bmw_cardata --dir "$D" scrie --psql "$PG_BIN/psql$EXE" --pg-host 127.0.0.1 \
  --pg-port "$PORT" --pg-user postgres --pg-db "$BAZA" --pg-sslmode disable >"$OUT" 2>&1; }
scrie || { cat "$OUT"; esec "4 scrie"; }
grep -q 'scrisa (id ' "$OUT" || { cat "$OUT"; esec "4 scrie fără confirmare"; }
[ "$(q "SELECT count(*) FROM bmw_cardata_citiri")|$(q "SELECT count(*) FROM bmw_cardata_locatii")" = "1|1" ] || esec "4 rânduri ≠ 1|1"
[ "$(q "SELECT odometru_km || '|' || combustibil_litri || '|' || soc_pct || '|' || (combustibil_pct IS NULL) FROM bmw_cardata_citiri")" = "48213.0|41.50|87.0|true" ] \
  || esec "4 valori greșite: $(q "SELECT odometru_km, combustibil_litri, soc_pct, combustibil_pct FROM bmw_cardata_citiri")"
[ "$(q "SELECT raspuns_brut->'vehicle.drivetrain.fuelSystem.level'->>'unit' FROM bmw_cardata_citiri")" = "x\$\$;DROP--'" ] \
  || esec "4 textul ostil nu s-a păstrat ca dată"
[ "$(q "SELECT lat || '|' || lon || '|' || heading FROM bmw_cardata_locatii")" = "44.936667|26.012345|181.0" ] || esec "4 locația"
[ "$(q "SELECT count(*) FROM bmw_cardata_citiri WHERE raspuns_brut::text ~* 'latitude|longitude|heading'")" = 0 ] || esec "4 locație în brut"
ok "4 scrie: 1 citire + 1 locație separată; textul ostil păstrat ca dată; fără locație în raspuns_brut"
F="$(ls "$D/bmw_cardata_citiri/scrise/"*.json)"
PYTHONPATH="$RADACINA/scripts" "$PY" -B - "$F" "$D/bmw_cardata_citiri" <<'PY' || esec "4 refacerea fișierului"
import json, os, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
json.dump(d['citire'], open(os.path.join(sys.argv[2], os.path.basename(sys.argv[1])), 'w', encoding='utf-8'))
PY
scrie || { cat "$OUT"; esec "4 a doua scriere"; }
grep -q 'deja in BD' "$OUT" || { cat "$OUT"; esec "4 reluarea nu a fost recunoscută"; }
[ "$(q "SELECT count(*) FROM bmw_cardata_citiri")|$(q "SELECT count(*) FROM bmw_cardata_locatii")" = "1|1" ] || esec "4 reluarea a dublat"
ok "4 reluare (confirmare pierdută) → „deja”, nimic dublat"

# 5. revenire
if "${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >"$OUT" 2>&1; then esec "5 rollback nearmat a trecut"; fi
grep -q 'fără GO de execuție' "$OUT" || { cat "$OUT"; esec "5 refuz din alt motiv"; }
if "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.rollback_tehnic_20261030c', 'SCOATE_BMW_CARDATA:' || txid_current(), true);" \
     -f "$ROLLBACK" >"$OUT" 2>&1; then esec "5 rollback fără CU_DATE a trecut peste date"; fi
grep -q 'date de audit' "$OUT" || { cat "$OUT"; esec "5 refuz (date) din alt motiv"; }
[ "$(obiecte)" = 3 ] || esec "5 obiectele au dispărut la un refuz"
ok "5 rollback nearmat → refuz; armat fără CU_DATE peste date → refuz"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.rollback_tehnic_20261030c', 'SCOATE_BMW_CARDATA_CU_DATE:' || txid_current(), true);" \
  -f "$ROLLBACK" >"$OUT" 2>&1 || { cat "$OUT"; esec "5 rollback armat CU_DATE"; }
[ "$(obiecte)" = 0 ] || esec "5 au rămas obiecte"
[ "$(q "SELECT count(*) FROM logistica_telemetrie_zilnica")|$(q "SELECT count(*) FROM logistica_active")" = "6|2" ] || esec "5 rollback a atins logistica_*"
ok "5 rollback CU_DATE → obiectele bmw_cardata_* scoase, logistica_* neatinse"
aplica || { cat "$OUT"; esec "5 reaplicare după rollback"; }
suita "reaplicat după rollback"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.rollback_tehnic_20261030c', 'SCOATE_BMW_CARDATA:' || txid_current(), true);" \
  -f "$ROLLBACK" >"$OUT" 2>&1 || { cat "$OUT"; esec "5 rollback pe tabele goale"; }
[ "$(obiecte)" = 0 ] || esec "5 rollback pe tabele goale nu a scos obiectele"
ok "5 rollback armat simplu pe tabele goale → OK"

# 6. validator + unittest
PYTHONIOENCODING=utf-8 "$PY" "$RADACINA/scripts/livrare_validator.py" "$MIGRARE_SURSA" >/dev/null || esec "6 validatorul runnerului refuză migrarea"
ok "6 validator runner: OK"
PYTHONPATH="$RADACINA/scripts" "$PY" -B -m unittest bmw_cardata.test_bmw_cardata >"$OUT" 2>&1 || { cat "$OUT"; esec "6 unittest"; }
ok "6 unittest: $(grep -Eo 'Ran [0-9]+ tests' "$OUT")"
echo "PASS test_bmw_cardata"
