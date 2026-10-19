#!/usr/bin/env bash
# ============================================================================
# Harness local — 20261030c_bmw_cardata (BMW CarData append-only) + scriptul scripts/bmw_cardata. DOAR PG17 local dedicat,
# într-un director NOU creat de harness (mktemp sub $TMPDIR, prefix bmw_cardata_harness.*, cu fișier-marker), 127.0.0.1:5976.
# Nu atinge producția și nu face nicio cerere la BMW. Oprirea serverului și ștergerea se fac DOAR pe directorul creat aici
# (cale canonică sub prefixul dedicat + marker cu PID-ul harness-ului); PGDATA_TEST nu mai e acceptat (Jakarinos r1 P1-3).
#   0. schelet (= structura live 14.10 folosită de migrare) → suita TREBUIE să cadă pe T1 (discriminare)
#   1. fără marcaj de livrare → garda refuză, nimic creat
#  1b. mutant cu brutul vizibil modulului logistica → suita TREBUIE să cadă pe T5 (Copilot r1 P1-1)
#   2. aplicare (ca runnerul: marcaj + --single-transaction) → suita SQL; gate-ul permanent 0e (control_0e.sql) = 0 rânduri
#   3. reaplicare → refuz (Precondiție 0b), nimic dublat
#   4. capăt-la-capăt Python → psql → BD: citire simulată (cu text ostil în răspunsul brut) scrisă de `python -m bmw_cardata scrie`;
#      citiri = doar coloane normalizate, locația și brutul în tabelele lor (doar owner); reluarea aceleiași citiri (confirmare
#      pierdută) → „deja”, nimic dublat. Suita SQL (T5b) verifică: un user logistica nu vede nicio coordonată pe nicio relație.
#   5. revenire: nearmat → refuz; armat simplu peste date → refuz; CU_DATE → obiectele dispar; reaplicare → suita;
#      CURSA (două sesiuni): un INSERT concurent necomis + revenirea armată simplu → revenirea așteaptă lock-ul și refuză
#      (rândul rămâne); mutantul FĂRĂ LOCK pierde rândul (dovada că testul discriminează);
#      5d aceeași cursă la REPEATABLE READ (și SERIALIZABLE) → refuz explicit de izolare, rândul rămâne; mutantul fără garda
#      de izolare pierde rândul la RR (snapshot fixat la armare); armat simplu pe tabele goale → OK
#   Ca root (Linux): pgdata + pglog sunt chown postgres, $LUCRU 711 (doar traversare), markerul rămâne al lui root.
#   6. validatorul runnerului acceptă migrarea; testele Python (unittest) trec
# Ieșire: 0 = PASS · 1 = eșec · 2 = mediu.  PG_BIN / PYTHON / PGPORT_TEST se pot suprascrie (Windows: PG_BIN=/c/Users/Public/pgsql/bin).
# ============================================================================
set -Eeuo pipefail
export PGCLIENTENCODING=UTF8
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
PORT="${PGPORT_TEST:-5976}"
BAZA=bmw_cardata_test
NUME=20261030c_bmw_cardata
MIGRARE_SURSA="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/bmw_cardata_schelet.sql"
TESTE="$RADACINA/supabase/tests/bmw_cardata.test.sql"
MARCAJ="SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);"
ARMARE="SELECT set_config('gazpet.rollback_tehnic_20261030c', 'SCOATE_BMW_CARDATA:' || txid_current(), true);"
ARMARE_DATE="SELECT set_config('gazpet.rollback_tehnic_20261030c', 'SCOATE_BMW_CARDATA_CU_DATE:' || txid_current(), true);"
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
EXE=""; SOCKET=(-c unix_socket_directories=/tmp); PY="${PYTHON:-python3}"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) EXE=".exe"; SOCKET=(); PY="${PYTHON:-python}" ;; esac
PSQL=("$PG_BIN/psql$EXE" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -z "${PGDATA_TEST+x}" ] || mediu "PGDATA_TEST nu mai e acceptat: harness-ul își creează singur directorul (mktemp + marker)"
[ -x "$PG_BIN/initdb$EXE" ] || mediu "PG17 lipsă ($PG_BIN)"
command -v "$PY" >/dev/null || mediu "python lipsă ($PY)"

# director de lucru DEDICAT: prefix fix sub $TMPDIR, cale canonică (pwd -P), marker cu PID-ul acestui harness
PREFIX_TMP="$(cd "${TMPDIR:-/tmp}" && pwd -P)" || mediu "TMPDIR inaccesibil"
LUCRU="$(mktemp -d "$PREFIX_TMP/bmw_cardata_harness.XXXXXXXX")" || mediu "mktemp"
LUCRU="$(cd "$LUCRU" && pwd -P)"
MARKER="$LUCRU/.marker_bmw_cardata_harness"
printf 'bmw_cardata_harness %s\n' "$$" > "$MARKER"
DATE_DIR="$LUCRU/pgdata"; JURNAL_PG="$LUCRU/pglog/pg.log"; TMP="$LUCRU/lucru"
mkdir "$TMP" "$DATE_DIR" "$LUCRU/pglog"; chmod 700 "$DATE_DIR" "$LUCRU/pglog"
if [ "$(id -u)" = 0 ]; then
  # ca root (Linux): mktemp e root:700 ⇒ postgres trebuie doar să TRAVERSEZE $LUCRU (711) și să DEȚINĂ pgdata + pglog;
  # markerul și lucru/ rămân ale lui root (postgres nu le poate schimba), curățarea rămâne la root, după verificarea markerului
  id postgres >/dev/null 2>&1 || mediu "utilizatorul postgres lipsește (ramura root)"
  chmod 711 "$LUCRU"
  chown postgres: "$DATE_DIR" "$LUCRU/pglog" || mediu "chown postgres pe directorul temporar"
fi
director_al_meu() {   # doar directorul creat aici: sub prefixul dedicat, fără „..”, canonic, cu markerul acestui proces
  case "$LUCRU" in "$PREFIX_TMP"/bmw_cardata_harness.*) ;; *) return 1 ;; esac
  case "$LUCRU" in *..*) return 1 ;; esac
  [ "$(cd "$LUCRU" 2>/dev/null && pwd -P)" = "$LUCRU" ] && [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "bmw_cardata_harness $$" ]
}
curata() {
  if ! director_al_meu; then echo "REFUZ curățare: $LUCRU nu e directorul creat de acest harness — nu opresc și nu șterg nimic" >&2; return 0; fi
  if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; fi
  rm -rf -- "$LUCRU"
}
trap 'curata; true' EXIT
director_al_meu || esec "directorul de lucru nu trece propria verificare"
ca_postgres "$PG_BIN/initdb$EXE" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --no-locale >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -l "$JURNAL_PG" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c timezone=UTC ${SOCKET[*]}" >/dev/null || mediu "pg_ctl start (portul $PORT ocupat?)"
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
obiecte() { q "SELECT count(*) FROM pg_class WHERE relname IN ('bmw_cardata_citiri','bmw_cardata_locatii','bmw_cardata_brut','v_bmw_cardata_vs_evogps')"; }
OUT="$TMP/out"
suita() { "${PSQL[@]}" -d "$BAZA" -f "$TESTE" >"$OUT" 2>&1 && grep -q SUITA_OK "$OUT" || { cat "$OUT"; esec "suita ($1)"; }
  echo "     [$1] $(grep -c 'OK T[0-9]' "$OUT") aserțiuni OK"; ok "suita ($1)"; }
aplica() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "$MARCAJ" -f "$MIGRARE_SURSA" >"$OUT" 2>&1; }
revino() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "$1" -f "$2" >"$OUT" 2>&1; }   # $1 = armarea, $2 = fișierul

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

# 1b. mutant (Copilot r1 P1-1): brutul vizibil modulului logistica ⇒ suita TREBUIE să cadă pe T5 (nu vede coordonate / brut)
"${PSQL[@]}" -d postgres -c "CREATE DATABASE bmw_cardata_mut_test TEMPLATE $BAZA" >/dev/null
MUT_BRUT="$TMP/migrare_brut_vizibil.sql"
sed '/CREATE POLICY bmw_cardata_brut_select_owner/{n;s/bmw_cardata_este_owner()/bmw_cardata_poate_citi()/;}' "$MIGRARE_SURSA" > "$MUT_BRUT"
[ "$(diff "$MIGRARE_SURSA" "$MUT_BRUT" | grep -c '^[<>]')" = 2 ] || esec "1b mutantul brut-vizibil nu a putut fi construit"
"${PSQL[@]}" -d bmw_cardata_mut_test --single-transaction -c "$MARCAJ" -f "$MUT_BRUT" >"$OUT" 2>&1 || { cat "$OUT"; esec "1b aplicarea mutantului"; }
if "${PSQL[@]}" -d bmw_cardata_mut_test -f "$TESTE" >"$OUT" 2>&1; then esec "1b suita trece cu brutul vizibil logistica (nu discriminează)"; fi
grep -q 'ESEC TEST: T5' "$OUT" || { cat "$OUT"; esec "1b suita a căzut din alt motiv"; }
"${PSQL[@]}" -d postgres -c "DROP DATABASE bmw_cardata_mut_test" >/dev/null
ok "1b mutant cu brutul vizibil modulului logistica → suita cade pe T5"

# 2. aplicare + suita
aplica || { cat "$OUT"; esec "2 aplicare"; }
[ "$(obiecte)" = 4 ] || esec "2 obiectele lipsesc"
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
nr3() { echo "$(q "SELECT count(*) FROM bmw_cardata_citiri")|$(q "SELECT count(*) FROM bmw_cardata_locatii")|$(q "SELECT count(*) FROM bmw_cardata_brut")"; }
[ "$(nr3)" = "1|1|1" ] || esec "4 rânduri citiri|locatii|brut = $(nr3) ≠ 1|1|1"
[ "$(q "SELECT odometru_km || '|' || combustibil_litri || '|' || soc_pct || '|' || (combustibil_pct IS NULL) FROM bmw_cardata_citiri")" = "48213.0|41.50|87.0|true" ] \
  || esec "4 valori greșite: $(q "SELECT odometru_km, combustibil_litri, soc_pct, combustibil_pct FROM bmw_cardata_citiri")"
[ "$(q "SELECT b.raspuns_brut->'vehicle.drivetrain.fuelSystem.level'->>'unit' FROM bmw_cardata_brut b JOIN bmw_cardata_citiri c ON c.id = b.citire_id AND c.citit_la = b.citit_la")" = "x\$\$;DROP--'" ] \
  || esec "4 textul ostil nu s-a păstrat ca dată (în bmw_cardata_brut)"
[ "$(q "SELECT lat || '|' || lon || '|' || heading FROM bmw_cardata_locatii")" = "44.936667|26.012345|181.0" ] || esec "4 locația"
[ "$(q "SELECT count(*) FROM bmw_cardata_brut WHERE raspuns_brut::text ~* 'latitude|longitude|heading'")" = 0 ] || esec "4 scriptul a pus locație în brut"
[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name = 'bmw_cardata_citiri' AND data_type IN ('json','jsonb')")" = 0 ] \
  || esec "4 citiri are o coloană json"
ok "4 scrie: 1 citire (doar coloane normalizate) + 1 locație + 1 brut (ambele doar owner); textul ostil păstrat ca dată în brut"
F="$(ls "$D/bmw_cardata_citiri/scrise/"*.json)"
PYTHONPATH="$RADACINA/scripts" "$PY" -B - "$F" "$D/bmw_cardata_citiri" <<'PY' || esec "4 refacerea fișierului"
import json, os, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
json.dump(d['citire'], open(os.path.join(sys.argv[2], os.path.basename(sys.argv[1])), 'w', encoding='utf-8'))
PY
scrie || { cat "$OUT"; esec "4 a doua scriere"; }
grep -q 'deja in BD' "$OUT" || { cat "$OUT"; esec "4 reluarea nu a fost recunoscută"; }
[ "$(nr3)" = "1|1|1" ] || esec "4 reluarea a dublat: $(nr3)"
ok "4 reluare (confirmare pierdută) → „deja”, nimic dublat"

# 5. revenire
if "${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >"$OUT" 2>&1; then esec "5 rollback nearmat a trecut"; fi
grep -q 'fără GO de execuție' "$OUT" || { cat "$OUT"; esec "5 refuz din alt motiv"; }
if revino "$ARMARE" "$ROLLBACK"; then esec "5 rollback fără CU_DATE a trecut peste date"; fi
grep -q 'date de audit' "$OUT" || { cat "$OUT"; esec "5 refuz (date) din alt motiv"; }
[ "$(obiecte)" = 4 ] || esec "5 obiectele au dispărut la un refuz"
ok "5 rollback nearmat → refuz; armat fără CU_DATE peste date → refuz"
revino "$ARMARE_DATE" "$ROLLBACK" || { cat "$OUT"; esec "5 rollback armat CU_DATE"; }
[ "$(obiecte)" = 0 ] || esec "5 au rămas obiecte"
[ "$(q "SELECT count(*) FROM logistica_telemetrie_zilnica")|$(q "SELECT count(*) FROM logistica_active")" = "6|2" ] || esec "5 rollback a atins logistica_*"
ok "5 rollback CU_DATE → obiectele bmw_cardata_* scoase, logistica_* neatinse"
aplica || { cat "$OUT"; esec "5 reaplicare după rollback"; }
suita "reaplicat după rollback"

# 5c. CURSA (Jakarinos r1 P1-2): sesiunea A inserează o citire și ține tranzacția deschisă 3 s; sesiunea B (revenirea armată
#     simplu, „doar tabele goale”) pornește la +1 s. Cu LOCK înaintea count(*): B așteaptă, vede rândul comis și refuză.
INSERT_A="INSERT INTO public.bmw_cardata_citiri (id_citire, citit_la, vin, odometru_km, sursa) VALUES (gen_random_uuid(), now(), 'WBATEST0000000001', 1, 'bmw_cardata_rest');"
cursa() {   # $1 = fișierul de revenire, $2 = armarea (implicit $ARMARE); întoarce codul lui B; B_SEC = cât a durat B
  "${PSQL[@]}" -d "$BAZA" -c "BEGIN; $INSERT_A SELECT pg_sleep(3); COMMIT;" >"$TMP/a.out" 2>&1 &
  local pid_a=$! t0 t1 rc
  sleep 1
  t0=$(date +%s); set +e; revino "${2:-$ARMARE}" "$1"; rc=$?; set -e; t1=$(date +%s)
  wait "$pid_a" || { cat "$TMP/a.out"; esec "5c sesiunea A"; }
  B_SEC=$((t1 - t0)); return "$rc"
}
[ "$(q "SELECT count(*) FROM bmw_cardata_citiri")" = 0 ] || esec "5c tabelele nu sunt goale înainte de cursă"
if cursa "$ROLLBACK"; then esec "5c revenirea a trecut cu un INSERT concurent (cursă)"; fi
grep -q 'date de audit' "$OUT" || { cat "$OUT"; esec "5c refuz din alt motiv"; }
[ "$B_SEC" -ge 1 ] || esec "5c revenirea nu a așteptat lock-ul (${B_SEC}s)"
[ "$(obiecte)" = 4 ] && [ "$(q "SELECT count(*) FROM bmw_cardata_citiri")" = 1 ] || esec "5c rândul concurent s-a pierdut"
ok "5c cursă: revenirea a așteptat lock-ul (${B_SEC}s), a văzut INSERT-ul comis și a refuzat; rândul rămâne"
revino "$ARMARE_DATE" "$ROLLBACK" || { cat "$OUT"; esec "5c curățare CU_DATE"; }
aplica || { cat "$OUT"; esec "5c reaplicare"; }
# mutantul fără LOCK pe același scenariu TREBUIE să piardă rândul — altfel testul de mai sus nu discriminează
MUTANT="$TMP/rollback_fara_lock.sql"
grep -v 'LOCK TABLE public.bmw_cardata_citiri, public.bmw_cardata_locatii, public.bmw_cardata_brut' "$ROLLBACK" > "$MUTANT"
[ "$(grep -c 'LOCK TABLE' "$MUTANT" || true)" = 0 ] && [ "$(grep -c 'LOCK TABLE' "$ROLLBACK")" = 1 ] || esec "5c mutantul nu a putut fi construit"
cursa "$MUTANT" || { cat "$OUT"; esec "5c mutantul fără LOCK a refuzat — scenariul nu reproduce cursa"; }
[ "$(obiecte)" = 0 ] || esec "5c mutantul nu a scos obiectele"
ok "5c mutant fără LOCK: count(*) a văzut 0, DROP a așteptat INSERT-ul și a șters rândul comis ⇒ cursa e reală, testul discriminează"
aplica || { cat "$OUT"; esec "5c reaplicare după mutant"; }

# 5d. CURSA la REPEATABLE READ (Jakarinos r2 P1): snapshot-ul s-ar fixa la armare, înaintea LOCK-ului ⇒ INSERT-ul comis în
#     timpul așteptării ar fi invizibil pentru count(*). Revenirea TREBUIE să refuze izolarea (și SERIALIZABLE), rândul rămâne.
ARMARE_RR="SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; $ARMARE"
if cursa "$ROLLBACK" "$ARMARE_RR"; then esec "5d revenirea a trecut la REPEATABLE READ"; fi
grep -q 'DOAR la READ COMMITTED' "$OUT" || { cat "$OUT"; esec "5d refuz (RR) din alt motiv"; }
[ "$(obiecte)" = 4 ] && [ "$(q "SELECT count(*) FROM bmw_cardata_citiri")" = 1 ] || esec "5d rândul concurent s-a pierdut (RR)"
if revino "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE; $ARMARE_DATE" "$ROLLBACK"; then esec "5d revenirea a trecut la SERIALIZABLE"; fi
grep -q 'DOAR la READ COMMITTED' "$OUT" || { cat "$OUT"; esec "5d refuz (SERIALIZABLE) din alt motiv"; }
[ "$(obiecte)" = 4 ] || esec "5d obiectele au dispărut la refuzul SERIALIZABLE"
ok "5d REPEATABLE READ (cu INSERT concurent) și SERIALIZABLE → refuz explicit de izolare; rândul rămâne"
revino "$ARMARE_DATE" "$ROLLBACK" || { cat "$OUT"; esec "5d curățare CU_DATE"; }
aplica || { cat "$OUT"; esec "5d reaplicare"; }
# mutantul FĂRĂ garda de izolare (dar cu LOCK), la REPEATABLE READ, pierde rândul ⇒ garda e necesară, testul discriminează
MUTANT_RR="$TMP/rollback_fara_garda_izolare.sql"
sed '/^DO \$rollback_izolare\$/,/^END \$rollback_izolare\$;/d' "$ROLLBACK" > "$MUTANT_RR"
[ "$(grep -c 'rollback_izolare' "$MUTANT_RR" || true)" = 0 ] && [ "$(grep -c 'LOCK TABLE' "$MUTANT_RR")" = 1 ] \
  || esec "5d mutantul fără garda de izolare nu a putut fi construit"
cursa "$MUTANT_RR" "$ARMARE_RR" || { cat "$OUT"; esec "5d mutantul RR a refuzat — scenariul nu reproduce problema snapshot-ului"; }
[ "$(obiecte)" = 0 ] || esec "5d mutantul RR nu a scos obiectele"
ok "5d mutant fără garda de izolare la RR: LOCK-ul a așteptat, dar count(*) din snapshot-ul vechi a văzut 0 ⇒ rândul comis pierdut; garda e necesară"
aplica || { cat "$OUT"; esec "5d reaplicare după mutant"; }
suita "reaplicat după cursă"
revino "$ARMARE" "$ROLLBACK" || { cat "$OUT"; esec "5 rollback pe tabele goale"; }
[ "$(obiecte)" = 0 ] || esec "5 rollback pe tabele goale nu a scos obiectele"
ok "5 rollback armat simplu pe tabele goale → OK"

# 6. validator + unittest
PYTHONIOENCODING=utf-8 "$PY" "$RADACINA/scripts/livrare_validator.py" "$MIGRARE_SURSA" >/dev/null || esec "6 validatorul runnerului refuză migrarea"
ok "6 validator runner: OK"
PYTHONPATH="$RADACINA/scripts" "$PY" -B -m unittest bmw_cardata.test_bmw_cardata >"$OUT" 2>&1 || { cat "$OUT"; esec "6 unittest"; }
ok "6 unittest: $(grep -Eo 'Ran [0-9]+ tests' "$OUT")"
echo "PASS test_bmw_cardata"
