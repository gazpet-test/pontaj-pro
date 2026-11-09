#!/usr/bin/env bash
# ============================================================================
# Concurență în DOUĂ sesiuni reale pentru 20261202a_executie_probe_tronsoane — DOAR pe clona schemei de producție, cu 20261201a și
# 20261202a APLICATE pe clonă (harness-ul cu o singură sesiune e scripts/test_executie_probe_tronsoane.sql). NICIODATĂ pe producție.
#
# Rulare (conexiunea din mediul psql obișnuit: PGHOST / PGPORT / PGUSER / PGDATABASE + pgpass; nicio parolă aici):
#   PSQL=<cale psql> bash scripts/test_executie_probe_concurenta.sh --sistem <system_identifier al CLONEI>
# Scriptul refuză dacă system_identifier-ul bazei nu e cel dat (garda anti-producție).
#
# Fiecare scenariu: sesiunea A își face operația și ține tranzacția deschisă (pg_sleep); B pornește abia după ce A doarme și TREBUIE
# observată în așteptare pe un lock (pg_stat_activity), altfel scenariul e NEEXECUTAT (intercalarea nu s-a obținut), nu „OK”.
#   S0 revenirea armată concurentă cu o scriere: revenirea așteaptă lock-urile, apoi vede rândul și refuză („tabelele au randuri”)
#   S1 suprapunere: două creări pe intervale care se suprapun -> a doua așteaptă și e refuzată
#   S2 aceeași cheie: două creări identice cu aceeași cheie -> a doua așteaptă și primește duplicat (același id)
#   S3 CAS: două schimbări ale aceleiași etape, de pe aceeași versiune -> a doua primește conflict
#   S4 legătura Probe vs ștergeri din Probe: B șterge CB, doarme, apoi CA (legat de etapă); A schimbă legătura CA -> CB
#      -> fără deadlock (40P01); A primește conflict, B se termină; legătura etapei e golită
# Date FICTIVE (codurile P95x, km 950+000…; calcule Probe create și șterse aici), pe proiectul cu id-ul cel mai mic; identitatea =
# owner-ul (JWT în sesiune, SET LOCAL ROLE authenticated). La final (și la întrerupere) se șterge tot ce s-a creat.
# Cod de ieșire: 0 = toate OK; 1 = vreun FAIL; 2 = niciun FAIL, dar vreun NEEXECUTAT; 3 = garda / pregătirea a refuzat.
# ============================================================================
set -u
PSQL="${PSQL:-psql}"
SISTEM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sistem) SISTEM="${2:-}"; shift 2 ;;
    *) echo "argument necunoscut: $1" >&2; exit 3 ;;
  esac
done
[ -n "$SISTEM" ] || { echo "lipsește --sistem <system_identifier al clonei>" >&2; exit 3; }
q() { "$PSQL" -X -A -t -q -v ON_ERROR_STOP=1 -c "$1"; }

ACTUAL=$(q "SELECT system_identifier FROM pg_control_system()") || { echo "nu pot citi system_identifier" >&2; exit 3; }
[ "$ACTUAL" = "$SISTEM" ] || { echo "REFUZ: baza are system_identifier $ACTUAL, nu $SISTEM (nu e clona dată)" >&2; exit 3; }
[ "$(q "SELECT to_regprocedure('public.fn_executie_proba_etapa(bigint, text, integer, text, date, integer, numeric, text, text, numeric, numeric, numeric, bigint, text, text, text, uuid)') IS NOT NULL")" = "t" ] \
  || { echo "REFUZ: 20261202a nu e aplicată pe clonă" >&2; exit 3; }

OWNER=$(q "SELECT id FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1")
P=$(q "SELECT id FROM public.executie_proiecte ORDER BY id LIMIT 1")
[ -n "$OWNER" ] && [ -n "$P" ] || { echo "REFUZ: lipsește owner-ul sau proiectul" >&2; exit 3; }
[ "$(q "SELECT count(*) FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND (cod LIKE 'P95_' OR km_pana_la_m > 950000)")" = "0" ] \
  || { echo "REFUZ: zona de test (P95x / km > 950+000) nu e liberă pe proiectul $P" >&2; exit 3; }

DIR=$(mktemp -d)
CALCULE=""
curata() {
  q "DELETE FROM public.executie_probe_jurnal WHERE proba_id IN (SELECT id FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod LIKE 'P95_');
     DELETE FROM public.executie_probe_etape WHERE proba_id IN (SELECT id FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod LIKE 'P95_');
     DELETE FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod LIKE 'P95_';" >/dev/null 2>&1
  [ -n "$CALCULE" ] && q "DELETE FROM public.probe_calcule WHERE id IN ($CALCULE)" >/dev/null 2>&1
  rm -rf "$DIR"
}
trap curata EXIT

FAIL=0; NEEX=0
rezultat() { echo "$1 $2"; case "$1" in FAIL) FAIL=1 ;; NEEXECUTAT) NEEX=1 ;; esac; }
# așteaptă până când condiția SQL e adevărată (zecimi de secundă)
asteapta() { local i; for i in $(seq 1 "$2"); do [ "$(q "SELECT ($1)")" = "t" ] && return 0; sleep 0.1; done; return 1; }
doarme() { asteapta "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'probe_test_$1' AND wait_event = 'PgSleep')" "$2"; }
blocat() { asteapta "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'probe_test_$1' AND wait_event_type = 'Lock')" "$2"; }
# identitatea owner-ului în sesiune (ambele surse JWT), apoi rolul aplicației
ID_SQL="SELECT set_config('request.jwt.claim.sub', :'owner', true), set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;"
AZI="(now() AT TIME ZONE 'Europe/Bucharest')::date"
sesiune() { # nume, fișier sql -> rulează în fundal, ieșirea în $DIR/<nume>.out
  PGAPPNAME="probe_test_$1" "$PSQL" -X -q -v ON_ERROR_STOP=1 -v owner="$OWNER" -v p="$P" -v e="${E:-0}" -v ca="${CA:-0}" -v cb="${CB:-0}" \
    -v k="${K:-00000000-0000-0000-0000-000000000000}" -f "$2" > "$DIR/$1.out" 2>&1 &
}

# ── S0: revenirea armată vs o creare neconfirmată (tabelele trebuie să fie goale la început) ──
if [ "$(q "SELECT NOT EXISTS (SELECT 1 FROM public.executie_probe_tronsoane) AND NOT EXISTS (SELECT 1 FROM public.executie_probe_jurnal)")" = "t" ]; then
  cat > "$DIR/s0a.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_proba_salveaza(:p, NULL, NULL, 'P959', 959000, 959500, NULL, NULL, gen_random_uuid());
SELECT pg_sleep(4);
COMMIT;
EOF
  # calea absolută a fișierului de revenire, în forma pe care o înțelege psql (pe Windows / Git Bash: C:/..., nu /c/...)
  REVENIRE="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))/supabase/revenire/20261202a_executie_probe_tronsoane_ROLLBACK.sql"
  cat > "$DIR/s0b.sql" <<EOF
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.revenire_20261202a', 'SCOATE_PROBE_TRONSOANE:' || txid_current(), true);
\i '$REVENIRE'
ROLLBACK;
EOF
  sesiune A "$DIR/s0a.sql"; PA=$!
  if doarme A 30; then
    sesiune B "$DIR/s0b.sql"; PB=$!
    if blocat B 30; then I=1; else I=0; fi
    wait $PA; wait $PB
    if [ $I = 0 ]; then rezultat NEEXECUTAT "S0 (revenirea nu a fost văzută așteptând)"
    elif grep -q "tabelele au randuri" "$DIR/B.out" && [ "$(q "SELECT to_regclass('public.executie_probe_tronsoane') IS NOT NULL")" = "t" ]; then rezultat OK "S0 revenirea a așteptat scrierea și a refuzat"
    else rezultat FAIL "S0: $(tr '\n' ' ' < "$DIR/B.out" | cut -c1-300)"; fi
  else wait $PA; rezultat NEEXECUTAT "S0 (A nu a ajuns la pg_sleep: $(tr '\n' ' ' < "$DIR/A.out" | cut -c1-200))"; fi
  q "DELETE FROM public.executie_probe_jurnal WHERE proba_id IN (SELECT id FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod = 'P959');
     DELETE FROM public.executie_probe_etape WHERE proba_id IN (SELECT id FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod = 'P959');
     DELETE FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod = 'P959';" >/dev/null
else
  rezultat NEEXECUTAT "S0 (tabelele au deja rânduri pe clonă: refuzul revenirii nu ar dovedi ordinea lock-urilor)"
fi

# ── S1: suprapunere concurentă ──
cat > "$DIR/s1a.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_proba_salveaza(:p, NULL, NULL, 'P951', 950000, 952000, NULL, NULL, gen_random_uuid());
SELECT pg_sleep(4);
COMMIT;
EOF
cat > "$DIR/s1b.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_proba_salveaza(:p, NULL, NULL, 'P952', 951000, 953000, NULL, NULL, gen_random_uuid());
COMMIT;
EOF
sesiune A "$DIR/s1a.sql"; PA=$!
if doarme A 30; then
  sesiune B "$DIR/s1b.sql"; PB=$!
  if blocat B 30; then I=1; else I=0; fi
  wait $PA; wait $PB
  if [ $I = 0 ]; then rezultat NEEXECUTAT "S1 (B nu a fost văzută așteptând)"
  elif grep -q "se suprapune cu P951" "$DIR/B.out" && [ "$(q "SELECT count(*) FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod IN ('P951', 'P952')")" = "1" ]; then rezultat OK "S1 suprapunerea concurentă refuzată"
  else rezultat FAIL "S1: $(tr '\n' ' ' < "$DIR/B.out" | cut -c1-300)"; fi
else wait $PA; rezultat FAIL "S1 pregătire: $(tr '\n' ' ' < "$DIR/A.out" | cut -c1-200)"; fi

# ── S2: aceeași cheie, concurent ──
K=$(q "SELECT gen_random_uuid()")
cat > "$DIR/s2.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_proba_salveaza(:p, NULL, NULL, 'P953', 960000, 961000, NULL, NULL, :'k'::uuid);
\if :{?dorm}
SELECT pg_sleep(4);
\endif
COMMIT;
EOF
PGAPPNAME=probe_test_A "$PSQL" -X -q -v ON_ERROR_STOP=1 -v owner="$OWNER" -v p="$P" -v k="$K" -v dorm=1 -f "$DIR/s2.sql" > "$DIR/A.out" 2>&1 & PA=$!
if doarme A 30; then
  sesiune B "$DIR/s2.sql"; PB=$!
  if blocat B 30; then I=1; else I=0; fi
  wait $PA; wait $PB
  ID_A=$(grep -o '"id": [0-9]*' "$DIR/A.out" | head -1); ID_B=$(grep -o '"id": [0-9]*' "$DIR/B.out" | head -1)
  if [ $I = 0 ]; then rezultat NEEXECUTAT "S2 (B nu a fost văzută așteptând)"
  elif grep -q '"duplicat": true' "$DIR/B.out" && [ -n "$ID_A" ] && [ "$ID_A" = "$ID_B" ] \
       && [ "$(q "SELECT count(*) FROM public.executie_probe_jurnal WHERE cheie = '$K'")" = "1" ]; then rezultat OK "S2 aceeași cheie = duplicat, o singură scriere"
  else rezultat FAIL "S2: A=[$ID_A] B=$(tr '\n' ' ' < "$DIR/B.out" | cut -c1-300)"; fi
else wait $PA; rezultat FAIL "S2 pregătire: $(tr '\n' ' ' < "$DIR/A.out" | cut -c1-200)"; fi

# ── S3: CAS pe aceeași etapă ──
E=$(q "SELECT e.id FROM public.executie_probe_etape e JOIN public.executie_probe_tronsoane t ON t.id = e.proba_id WHERE t.proiect_id = $P AND t.cod = 'P951' AND t.stare = 'activ' AND e.etapa = 'pistonare'")
if [ -n "$E" ]; then
  cat > "$DIR/s3.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_proba_etapa(:e, 'urmeaza', 1, 'in_curs', $AZI, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, gen_random_uuid());
\if :{?dorm}
SELECT pg_sleep(4);
\endif
COMMIT;
EOF
  PGAPPNAME=probe_test_A "$PSQL" -X -q -v ON_ERROR_STOP=1 -v owner="$OWNER" -v e="$E" -v dorm=1 -f "$DIR/s3.sql" > "$DIR/A.out" 2>&1 & PA=$!
  if doarme A 30; then
    sesiune B "$DIR/s3.sql"; PB=$!
    if blocat B 30; then I=1; else I=0; fi
    wait $PA; wait $PB
    if [ $I = 0 ]; then rezultat NEEXECUTAT "S3 (B nu a fost văzută așteptând)"
    elif grep -q '"ok": true' "$DIR/A.out" && grep -q '"motiv": "conflict"' "$DIR/B.out" \
         && [ "$(q "SELECT versiune FROM public.executie_probe_etape WHERE id = $E")" = "2" ]; then rezultat OK "S3 CAS concurent: a doua schimbare primește conflict"
    else rezultat FAIL "S3: $(tr '\n' ' ' < "$DIR/B.out" | cut -c1-300)"; fi
  else wait $PA; rezultat FAIL "S3 pregătire: $(tr '\n' ' ' < "$DIR/A.out" | cut -c1-200)"; fi
else rezultat NEEXECUTAT "S3 (P951 lipsește: S1 a eșuat)"; fi

# ── S4: schimbarea legăturii Probe vs ștergeri din Probe în altă ordine (regresia de deadlock din review r1) ──
E=$(q "SELECT e.id FROM public.executie_probe_etape e JOIN public.executie_probe_tronsoane t ON t.id = e.proba_id WHERE t.proiect_id = $P AND t.cod = 'P951' AND t.stare = 'activ' AND e.etapa = 'presiune'")
CA=$(q "INSERT INTO public.probe_calcule (proiect_id, tip_fluid, status) VALUES ($P, 'aer', 'planificata') RETURNING id" 2>/dev/null)
CB=$(q "INSERT INTO public.probe_calcule (proiect_id, tip_fluid, status) VALUES ($P, 'aer', 'planificata') RETURNING id" 2>/dev/null)
CALCULE=$(echo "$CA,$CB" | sed 's/^,//; s/,$//')
if [ -n "$E" ] && [ -n "$CA" ] && [ -n "$CB" ]; then
  cat > "$DIR/s4leaga.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_proba_etapa(:e, 'urmeaza', 1, 'in_curs', $AZI, NULL, NULL, NULL, NULL, 10, NULL, NULL, :ca, NULL, NULL, NULL, gen_random_uuid());
COMMIT;
EOF
  PGAPPNAME=probe_test_P "$PSQL" -X -q -v ON_ERROR_STOP=1 -v owner="$OWNER" -v e="$E" -v ca="$CA" -f "$DIR/s4leaga.sql" > "$DIR/P.out" 2>&1
  cat > "$DIR/s4b.sql" <<EOF
BEGIN;
DELETE FROM public.probe_calcule WHERE id = :cb;
SELECT pg_sleep(4);
DELETE FROM public.probe_calcule WHERE id = :ca;
COMMIT;
EOF
  cat > "$DIR/s4a.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_proba_etapa(:e, 'in_curs', 2, 'in_curs', $AZI, NULL, NULL, NULL, NULL, 10, NULL, NULL, :cb, NULL, NULL, NULL, gen_random_uuid());
COMMIT;
EOF
  if grep -q '"ok": true' "$DIR/P.out"; then
    PGAPPNAME=probe_test_B "$PSQL" -X -q -v ON_ERROR_STOP=1 -v ca="$CA" -v cb="$CB" -f "$DIR/s4b.sql" > "$DIR/B.out" 2>&1 & PB=$!
    if doarme B 30; then
      sesiune A "$DIR/s4a.sql"; PA=$!
      if blocat A 30; then I=1; else I=0; fi
      wait $PB; RB=$?; wait $PA
      if [ $I = 0 ]; then rezultat NEEXECUTAT "S4 (A nu a fost văzută așteptând)"
      elif grep -qi "deadlock" "$DIR/A.out" "$DIR/B.out"; then rezultat FAIL "S4: deadlock — $(tr '\n' ' ' < "$DIR/A.out" | cut -c1-200)"
      elif [ $RB = 0 ] && grep -q '"motiv": "conflict"' "$DIR/A.out" \
           && [ "$(q "SELECT probe_calc_id IS NULL FROM public.executie_probe_etape WHERE id = $E")" = "t" ]; then rezultat OK "S4 fără deadlock: ștergerile din Probe trec, schimbarea legăturii primește conflict"
      else rezultat FAIL "S4: B=$RB A=$(tr '\n' ' ' < "$DIR/A.out" | cut -c1-300)"; fi
    else wait $PB; rezultat FAIL "S4 pregătire B: $(tr '\n' ' ' < "$DIR/B.out" | cut -c1-200)"; fi
  else rezultat FAIL "S4 pregătire (legarea de CA): $(tr '\n' ' ' < "$DIR/P.out" | cut -c1-200)"; fi
else rezultat NEEXECUTAT "S4 (etapa sau calculele fictive lipsesc: e=$E ca=$CA cb=$CB)"; fi

[ $FAIL = 1 ] && exit 1
[ $NEEX = 1 ] && exit 2
echo "TOATE OK"
exit 0
