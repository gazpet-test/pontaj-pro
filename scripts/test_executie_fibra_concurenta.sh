#!/usr/bin/env bash
# ============================================================================
# Concurență în DOUĂ sesiuni reale pentru 20261211a_executie_fibra_optica — DOAR pe clona schemei de producție, cu 20261201a și
# 20261211a APLICATE pe clonă (harness-ul cu o singură sesiune e scripts/test_executie_fibra_optica.sql). NICIODATĂ pe producție.
#
# Rulare (conexiunea din mediul psql obișnuit: PGHOST / PGPORT / PGUSER / PGDATABASE + pgpass; nicio parolă aici):
#   PSQL=<cale psql> bash scripts/test_executie_fibra_concurenta.sh --sistem <system_identifier al CLONEI>
# Scriptul refuză dacă system_identifier-ul bazei nu e cel dat (garda anti-producție).
#
# Coregrafia (ca la scripts/test_executie_probe_concurenta.sh): o sesiune își face operația și ține tranzacția deschisă (pg_sleep);
# cealaltă pornește abia după ce prima doarme. Unde trebuie să aștepte, se verifică în pg_stat_activity că AȘTEAPTĂ un lock ținut chiar
# de cealaltă sesiune (pg_blocking_pids); unde trebuie să refuze fără așteptare, că PROCESUL ei s-a terminat cât cealaltă încă dormea.
# Erorile se verifică după SQLSTATE (VERBOSITY verbose) și după fragmentul de mesaj. Intercalarea neobținută = NEEXECUTAT, nu OK.
#   S0 revenirea armată cât o raportare e deschisă: refuz imediat (55P03, NOWAIT), nimic scos
#   S1 suprapunere: a doua raportare pe același tronson așteaptă lock-ul tronsonului și e refuzată cu mesajul clar (23514)
#   S2 aceeași cheie: a doua raportare așteaptă și primește duplicat (același id), un singur rând de jurnal
#   S3 anulare vs raportare dependentă: A anulează monotubul (deschis); B raportează „validat” peste el: așteaptă, apoi refuz (23514)
#   S4 raportare vs strângerea km-ilor tronsonului: B (UPDATE pe executie_tronsoane) așteaptă după A, apoi garda refuză (23514)
# Date FICTIVE: tronsonul FO-CONC (km 950+000–952+000) creat aici pe proiectul cu id-ul cel mai mic; identitatea = owner-ul (JWT în
# sesiune, SET LOCAL ROLE authenticated). La final — și la orice întrerupere — sesiunile se opresc, backend-urile lor se închid, apoi se
# șterge tot ce s-a creat și se VERIFICĂ: o curățare eșuată = FAIL.
# Cod de ieșire: 0 = toate OK; 1 = vreun FAIL (inclusiv curățarea); 2 = niciun FAIL, dar vreun NEEXECUTAT; 3 = garda / pregătirea a refuzat.
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
[ "$(q "SELECT to_regprocedure('public.fn_executie_fibra_raporteaza(bigint, bigint, text, integer, integer, date, text, uuid)') IS NOT NULL")" = "t" ] \
  || { echo "REFUZ: 20261211a nu e aplicată pe clonă" >&2; exit 3; }
[ "$(q "SELECT count(*) FROM pg_stat_activity WHERE starts_with(application_name, 'fibra_test_')")" = "0" ] \
  || { echo "REFUZ: există deja sesiuni fibra_test_* (altă rulare în curs?)" >&2; exit 3; }

OWNER=$(q "SELECT id FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1")
P=$(q "SELECT id FROM public.executie_proiecte ORDER BY id LIMIT 1")
[ -n "$OWNER" ] && [ -n "$P" ] || { echo "REFUZ: lipsește owner-ul sau proiectul" >&2; exit 3; }
[ "$(q "SELECT count(*) FROM public.executie_tronsoane WHERE proiect_id = $P AND cod = 'FO-CONC'")" = "0" ] \
  || { echo "REFUZ: tronsonul de test FO-CONC există deja pe proiectul $P" >&2; exit 3; }
TR=$(q "INSERT INTO public.executie_tronsoane (proiect_id, cod, km_start_m, km_end_m) VALUES ($P, 'FO-CONC', 950000, 952000) RETURNING id") \
  || { echo "REFUZ: nu pot crea tronsonul de test" >&2; exit 3; }

RAD="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"
DIR=$(mktemp -d)
PIDS=()
FAIL=0; NEEX=0
rezultat() { echo "$1 $2"; case "$1" in FAIL) FAIL=1 ;; NEEXECUTAT) NEEX=1 ;; esac; }
asteapta() { local i; for i in $(seq 1 "$2"); do [ "$(q "SELECT ($1)")" = "t" ] && return 0; sleep 0.1; done; return 1; }
opreste_sesiunile() {
  local p
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done
  for p in "${PIDS[@]}"; do wait "$p" 2>/dev/null; done
  q "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE starts_with(application_name, 'fibra_test_') AND pid <> pg_backend_pid()" >/dev/null 2>&1
  asteapta "NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE starts_with(application_name, 'fibra_test_'))" 100
}
# curățarea: ștergeri explicite (ca postgres, mentenanță de test), apoi VERIFICAREA că nu a rămas nimic (L18). Garda de ștergere
# (trg_executie_fibra_fara_stergere_*) refuză DELETE și pentru postgres, deci curățarea se face în tranzacția armată (marcajul
# revenirii, legat de txid), doar pe rândurile tronsonului de test FO-CONC.
curata() {
  opreste_sesiunile || { echo "FAIL curățarea: sesiunile fibra_test_* nu s-au închis"; return 1; }
  q "BEGIN;
     SELECT set_config('gazpet.revenire_20261211a', 'SCOATE_FIBRA_OPTICA:' || txid_current(), true);
     DELETE FROM public.executie_fibra_jurnal WHERE tronson_id = $TR;
     DELETE FROM public.executie_fibra_intervale WHERE tronson_id = $TR;
     DELETE FROM public.executie_fibra_camerete WHERE tronson_id = $TR;
     DELETE FROM public.executie_tronsoane WHERE id = $TR;
     COMMIT;" > "$DIR/curata.out" 2>&1
  local cod=$?
  local ramase; ramase=$(q "SELECT (SELECT count(*) FROM public.executie_tronsoane WHERE id = $TR) + (SELECT count(*) FROM public.executie_fibra_intervale WHERE tronson_id = $TR)
                                  + (SELECT count(*) FROM public.executie_fibra_jurnal WHERE tronson_id = $TR)" 2>&1)
  if [ $cod -ne 0 ] || [ "$ramase" != "0" ]; then echo "FAIL curățarea: cod $cod, rămase: $ramase, $(tr '\n' ' ' < "$DIR/curata.out" | cut -c1-200)"; return 1; fi
  echo "OK curățarea (sesiuni oprite, nimic rămas)"; return 0
}
la_iesire() { local c=$?; if [ -z "${CURAT:-}" ]; then curata || c=1; fi; rm -rf "$DIR"; exit $c; }
trap la_iesire EXIT
trap 'exit 130' INT TERM

doarme() { asteapta "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'fibra_test_$1' AND wait_event = 'PgSleep')" "$2"; }
blocat_de() {
  asteapta "EXISTS (SELECT 1 FROM pg_stat_activity a JOIN pg_stat_activity b ON b.pid = ANY (pg_blocking_pids(a.pid))
                     WHERE a.application_name = 'fibra_test_$1' AND a.wait_event_type = 'Lock' AND b.application_name = 'fibra_test_$2')" "$3"
}
terminat() { local i; for i in $(seq 1 "$2"); do kill -0 "$1" 2>/dev/null || return 0; sleep 0.1; done; return 1; }
ID_SQL="SELECT set_config('request.jwt.claim.sub', :'owner', true), set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;"
AZI="(now() AT TIME ZONE 'Europe/Bucharest')::date"
ULTIM=0
sesiune() { # nume, fișier sql -> în fundal (PID în ULTIM și PIDS), ieșirea în $DIR/<nume>.out
  local extra=(); [ "${DORM:-0}" = "1" ] && extra=(-v dorm=1)
  PGAPPNAME="fibra_test_$1" "$PSQL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -v owner="$OWNER" -v p="$P" -v tr="$TR" \
    -v k="${K:-00000000-0000-0000-0000-000000000000}" -v iv="${IV:-0}" "${extra[@]}" -f "$2" > "$DIR/$1.out" 2>&1 &
  ULTIM=$!; PIDS+=("$ULTIM")
}
iesire() { tr '\n' ' ' < "$DIR/$1.out" | cut -c1-300; }
are_cod() { grep -q "ERROR:  $2:" "$DIR/$1.out"; }
raporteaza() { # etapa, de la, până la (prin RPC, ca owner, comis); id-ul în RAP_ID
  cat > "$DIR/rap.sql" <<EOF
BEGIN;
$ID_SQL
SELECT (public.fn_executie_fibra_raporteaza(:p, :tr, '$1', $2, $3, $AZI, NULL, gen_random_uuid()))->'interval'->>'id' AS id;
COMMIT;
EOF
  sesiune C "$DIR/rap.sql"; wait $ULTIM || return 1
  RAP_ID=$(grep -Eo '^ *[0-9]+ *$' "$DIR/C.out" | tr -d ' ' | head -1); [ -n "$RAP_ID" ]
}

# ── S0: revenirea armată cât o raportare e deschisă: refuz IMEDIAT, nimic scos ──
cat > "$DIR/s0a.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_fibra_raporteaza(:p, :tr, 'monotub', 951800, 951900, $AZI, NULL, gen_random_uuid());
SELECT pg_sleep(5);
ROLLBACK;
EOF
cat > "$DIR/s0b.sql" <<EOF
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.revenire_20261211a', 'SCOATE_FIBRA_OPTICA:' || txid_current(), true);
\i '$RAD/supabase/revenire/20261211a_executie_fibra_optica_ROLLBACK.sql'
ROLLBACK;
EOF
sesiune A "$DIR/s0a.sql"; PA=$ULTIM
if doarme A 30; then
  sesiune B "$DIR/s0b.sql"; PB=$ULTIM
  if terminat $PB 30 && doarme A 1; then I=1; else I=0; fi
  wait $PB; wait $PA
  if [ $I = 0 ]; then rezultat NEEXECUTAT "S0 (revenirea nu s-a terminat cât raportarea era deschisă)"
  elif are_cod B 55P03 && grep -q "folosite chiar acum" "$DIR/B.out" \
       && [ "$(q "SELECT to_regclass('public.executie_fibra_intervale') IS NOT NULL")" = "t" ]; then
    rezultat OK "S0 revenirea a refuzat imediat (55P03) cât o raportare era deschisă; nimic scos"
  else rezultat FAIL "S0: $(iesire B)"; fi
else wait $PA; rezultat FAIL "S0 pregătire: $(iesire A)"; fi

# ── S1: suprapunere concurentă pe același tronson ──
cat > "$DIR/s1a.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_fibra_raporteaza(:p, :tr, 'monotub', 950000, 950500, $AZI, NULL, gen_random_uuid());
SELECT pg_sleep(4);
COMMIT;
EOF
cat > "$DIR/s1b.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_fibra_raporteaza(:p, :tr, 'monotub', 950400, 950600, $AZI, NULL, gen_random_uuid());
COMMIT;
EOF
sesiune A "$DIR/s1a.sql"; PA=$ULTIM
if doarme A 30; then
  sesiune B "$DIR/s1b.sql"; PB=$ULTIM
  if blocat_de B A 30; then I=1; else I=0; fi
  wait $PA; RA=$?; wait $PB
  if [ $I = 0 ]; then rezultat NEEXECUTAT "S1 (B nu a fost văzută așteptând după A)"
  elif [ $RA = 0 ] && are_cod B 23514 && grep -q "porțiunea km 950+400–950+500 e deja raportată" "$DIR/B.out" \
       && [ "$(q "SELECT count(*) FROM public.executie_fibra_intervale WHERE tronson_id = $TR AND etapa = 'monotub'")" = "1" ]; then
    rezultat OK "S1 suprapunerea concurentă: B a așteptat lock-ul tronsonului, apoi refuz cu mesaj clar (23514)"
  else rezultat FAIL "S1: A=$RA B: $(iesire B)"; fi
else wait $PA; rezultat FAIL "S1 pregătire: $(iesire A)"; fi

# ── S2: aceeași cheie, concurent ──
K=$(q "SELECT gen_random_uuid()")
cat > "$DIR/s2.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_fibra_raporteaza(:p, :tr, 'monotub', 950500, 951000, $AZI, NULL, :'k'::uuid);
\if :{?dorm}
SELECT pg_sleep(4);
\endif
COMMIT;
EOF
DORM=1 sesiune A "$DIR/s2.sql"; PA=$ULTIM
if doarme A 30; then
  sesiune B "$DIR/s2.sql"; PB=$ULTIM
  if blocat_de B A 30; then I=1; else I=0; fi
  wait $PA; RA=$?; wait $PB; RB=$?
  ID_A=$(grep -o '"id": [0-9]*' "$DIR/A.out" | head -1); ID_B=$(grep -o '"id": [0-9]*' "$DIR/B.out" | head -1)
  if [ $I = 0 ]; then rezultat NEEXECUTAT "S2 (B nu a fost văzută așteptând după A)"
  elif [ $RA = 0 ] && [ $RB = 0 ] && grep -q '"duplicat": true' "$DIR/B.out" && [ -n "$ID_A" ] && [ "$ID_A" = "$ID_B" ] \
       && [ "$(q "SELECT count(*) FROM public.executie_fibra_jurnal WHERE cheie = '$K'")" = "1" ]; then rezultat OK "S2 aceeași cheie = duplicat, o singură scriere"
  else rezultat FAIL "S2: A=$RA/[$ID_A] B=$RB $(iesire B)"; fi
else wait $PA; rezultat FAIL "S2 pregătire: $(iesire A)"; fi

# ── S3: anularea monotubului (deschisă) vs „validat” peste el ──
if raporteaza monotub 951000 951500; then
  IV=$RAP_ID
  cat > "$DIR/s3a.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_fibra_anuleaza(:iv, 'test concurență', gen_random_uuid());
SELECT pg_sleep(4);
COMMIT;
EOF
  cat > "$DIR/s3b.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_fibra_raporteaza(:p, :tr, 'validat', 951000, 951400, $AZI, NULL, gen_random_uuid());
COMMIT;
EOF
  sesiune A "$DIR/s3a.sql"; PA=$ULTIM
  if doarme A 30; then
    sesiune B "$DIR/s3b.sql"; PB=$ULTIM
    if blocat_de B A 30; then I=1; else I=0; fi
    wait $PA; RA=$?; wait $PB
    if [ $I = 0 ]; then rezultat NEEXECUTAT "S3 (B nu a fost văzută așteptând după A)"
    elif [ $RA = 0 ] && are_cod B 23514 && grep -q "nu are „monotub montat” raportat" "$DIR/B.out" \
         && [ "$(q "SELECT count(*) FROM public.executie_fibra_intervale WHERE tronson_id = $TR AND etapa = 'validat'")" = "0" ]; then
      rezultat OK "S3 validat peste un monotub anulat concurent: a așteptat, apoi refuz (23514)"
    else rezultat FAIL "S3: A=$RA B: $(iesire B)"; fi
  else wait $PA; rezultat FAIL "S3 pregătire: $(iesire A)"; fi
else rezultat FAIL "S3 pregătire (monotub 951+000–951+500): $(iesire C)"; fi

# ── S4: raportare (deschisă) vs strângerea km-ilor tronsonului ──
cat > "$DIR/s4a.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_fibra_raporteaza(:p, :tr, 'monotub', 951500, 952000, $AZI, NULL, gen_random_uuid());
SELECT pg_sleep(4);
COMMIT;
EOF
cat > "$DIR/s4b.sql" <<EOF
BEGIN;
UPDATE public.executie_tronsoane SET km_end_m = 951600 WHERE id = :tr;
COMMIT;
EOF
sesiune A "$DIR/s4a.sql"; PA=$ULTIM
if doarme A 30; then
  sesiune B "$DIR/s4b.sql"; PB=$ULTIM
  if blocat_de B A 30; then I=1; else I=0; fi
  wait $PA; RA=$?; wait $PB
  if [ $I = 0 ]; then rezultat NEEXECUTAT "S4 (B nu a fost văzută așteptând după A)"
  elif [ $RA = 0 ] && are_cod B 23514 && grep -q "iese din noile limite ale tronsonului FO-CONC" "$DIR/B.out" \
       && [ "$(q "SELECT km_end_m FROM public.executie_tronsoane WHERE id = $TR")" = "952000" ]; then
    rezultat OK "S4 strângerea km-ilor: a așteptat raportarea, apoi garda a refuzat (23514)"
  else rezultat FAIL "S4: A=$RA B: $(iesire B)"; fi
else wait $PA; rezultat FAIL "S4 pregătire: $(iesire A)"; fi

CURAT=1
curata || FAIL=1
[ $FAIL = 1 ] && exit 1
[ $NEEX = 1 ] && exit 2
echo "TOATE OK"
exit 0
