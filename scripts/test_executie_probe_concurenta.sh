#!/usr/bin/env bash
# ============================================================================
# Concurență în DOUĂ sesiuni reale pentru 20261202a_executie_probe_tronsoane — DOAR pe clona schemei de producție, cu 20261201a și
# 20261202a APLICATE pe clonă (harness-ul cu o singură sesiune e scripts/test_executie_probe_tronsoane.sql). NICIODATĂ pe producție.
#
# Rulare (conexiunea din mediul psql obișnuit: PGHOST / PGPORT / PGUSER / PGDATABASE + pgpass; nicio parolă aici):
#   PSQL=<cale psql> bash scripts/test_executie_probe_concurenta.sh --sistem <system_identifier al CLONEI>
# Scriptul refuză dacă system_identifier-ul bazei nu e cel dat (garda anti-producție).
#
# Coregrafia: o sesiune își face operația și ține tranzacția deschisă (pg_sleep); cealaltă pornește abia după ce prima doarme. Unde
# trebuie să aștepte, se verifică în pg_stat_activity că AȘTEAPTĂ un lock și că blocantul (pg_blocking_pids) e chiar cealaltă sesiune;
# unde trebuie să refuze fără așteptare, se verifică că a terminat cât timp cealaltă încă dormea. Intercalarea neobținută = NEEXECUTAT.
#   S0 revenirea armată, cât o scriere e deschisă: refuz imediat („folosite chiar acum”, NOWAIT), nimic scos
#   S1 suprapunere: două creări pe intervale care se suprapun -> a doua așteaptă (advisory) și e refuzată
#   S2 aceeași cheie: două creări identice cu aceeași cheie -> a doua așteaptă și primește duplicat (același id), un singur rând de jurnal
#   S3 CAS: două schimbări ale aceleiași etape, de pe aceeași versiune -> a doua așteaptă și primește conflict
#   S4a Probe șterge CB (doarme) apoi CA (legat de etapă); A schimbă legătura CA -> CB: A refuză imediat (55P03), fără deadlock
#   S4b Probe șterge CA (legat; golește legătura și ține etapa) (doarme) apoi CB; A schimbă legătura CA -> CB: A așteaptă etapa,
#       blocată de B; B se termină; A primește conflict (versiunea a crescut la golirea legăturii); fără deadlock
# Date FICTIVE (codurile P95x, km 950+000…; calcule Probe create și șterse aici), pe proiectul cu id-ul cel mai mic; identitatea =
# owner-ul (JWT în sesiune, SET LOCAL ROLE authenticated). La final se șterge tot ce s-a creat și se VERIFICĂ: o curățare eșuată = FAIL.
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
[ "$(q "SELECT to_regprocedure('public.fn_executie_proba_etapa(bigint, text, integer, text, date, integer, numeric, text, text, numeric, numeric, numeric, bigint, text, text, text, uuid)') IS NOT NULL")" = "t" ] \
  || { echo "REFUZ: 20261202a nu e aplicată pe clonă" >&2; exit 3; }

OWNER=$(q "SELECT id FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1")
P=$(q "SELECT id FROM public.executie_proiecte ORDER BY id LIMIT 1")
[ -n "$OWNER" ] && [ -n "$P" ] || { echo "REFUZ: lipsește owner-ul sau proiectul" >&2; exit 3; }
[ "$(q "SELECT count(*) FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND (cod LIKE 'P95_' OR km_pana_la_m > 950000)")" = "0" ] \
  || { echo "REFUZ: zona de test (P95x / km > 950+000) nu e liberă pe proiectul $P" >&2; exit 3; }

RAD="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"
DIR=$(mktemp -d)
CALCULE="0"
FAIL=0; NEEX=0
rezultat() { echo "$1 $2"; case "$1" in FAIL) FAIL=1 ;; NEEXECUTAT) NEEX=1 ;; esac; }
# curățarea: ștergeri explicite, apoi VERIFICAREA că nu a rămas nimic (L18: o curățare eșuată nu trece tacit)
curata() {
  q "DELETE FROM public.executie_probe_jurnal WHERE proba_id IN (SELECT id FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod LIKE 'P95_');
     DELETE FROM public.executie_probe_etape WHERE proba_id IN (SELECT id FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod LIKE 'P95_');
     DELETE FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod LIKE 'P95_';
     DELETE FROM public.probe_calcule WHERE id IN ($CALCULE);" > "$DIR/curata.out" 2>&1
  local cod=$?
  local ramase; ramase=$(q "SELECT (SELECT count(*) FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod LIKE 'P95_')
                                  + (SELECT count(*) FROM public.probe_calcule WHERE id IN ($CALCULE))" 2>&1)
  if [ $cod -ne 0 ] || [ "$ramase" != "0" ]; then echo "FAIL curățarea: cod $cod, rămase: $ramase, $(tr '\n' ' ' < "$DIR/curata.out" | cut -c1-200)"; return 1; fi
  echo "OK curățarea (nimic rămas)"; return 0
}
la_iesire() { local c=$?; if [ -z "${CURAT:-}" ]; then curata || c=1; fi; rm -rf "$DIR"; exit $c; }
trap la_iesire EXIT

# așteaptă până când condiția SQL e adevărată (zecimi de secundă)
asteapta() { local i; for i in $(seq 1 "$2"); do [ "$(q "SELECT ($1)")" = "t" ] && return 0; sleep 0.1; done; return 1; }
doarme() { asteapta "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'probe_test_$1' AND wait_event = 'PgSleep')" "$2"; }
# $1 așteaptă un lock ȚINUT de $2 (blocantul identificat prin pg_blocking_pids)
blocat_de() {
  asteapta "EXISTS (SELECT 1 FROM pg_stat_activity a JOIN pg_stat_activity b ON b.pid = ANY (pg_blocking_pids(a.pid))
                     WHERE a.application_name = 'probe_test_$1' AND a.wait_event_type = 'Lock' AND b.application_name = 'probe_test_$2')" "$3"
}
terminat() { ! kill -0 "$1" 2>/dev/null; }
# identitatea owner-ului în sesiune (ambele surse JWT), apoi rolul aplicației
ID_SQL="SELECT set_config('request.jwt.claim.sub', :'owner', true), set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;"
AZI="(now() AT TIME ZONE 'Europe/Bucharest')::date"
sesiune() { # nume, fișier sql -> în fundal, ieșirea în $DIR/<nume>.out; variabile: owner, p, e, ca, cb, k, dorm (dacă DORM=1)
  local extra=(); [ "${DORM:-0}" = "1" ] && extra=(-v dorm=1)
  PGAPPNAME="probe_test_$1" "$PSQL" -X -q -v ON_ERROR_STOP=1 -v owner="$OWNER" -v p="$P" -v e="${E:-0}" -v ca="${CA:-0}" -v cb="${CB:-0}" \
    -v k="${K:-00000000-0000-0000-0000-000000000000}" "${extra[@]}" -f "$2" > "$DIR/$1.out" 2>&1 &
}
iesire() { tr '\n' ' ' < "$DIR/$1.out" | cut -c1-300; }
calcul_nou() { q "INSERT INTO public.probe_calcule (proiect_id, tip_fluid, status) VALUES ($P, 'aer', 'planificata') RETURNING id"; }
etapa_id() { q "SELECT e.id FROM public.executie_probe_etape e JOIN public.executie_probe_tronsoane t ON t.id = e.proba_id WHERE t.proiect_id = $P AND t.cod = '$1' AND t.stare = 'activ' AND e.etapa = '$2'"; }

# ── S0: revenirea armată cât o creare e deschisă: refuz IMEDIAT, nimic scos ──
cat > "$DIR/s0a.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_proba_salveaza(:p, NULL, NULL, 'P959', 959000, 959500, NULL, NULL, gen_random_uuid());
SELECT pg_sleep(5);
ROLLBACK;
EOF
cat > "$DIR/s0b.sql" <<EOF
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.revenire_20261202a', 'SCOATE_PROBE_TRONSOANE:' || txid_current(), true);
\i '$RAD/supabase/revenire/20261202a_executie_probe_tronsoane_ROLLBACK.sql'
ROLLBACK;
EOF
sesiune A "$DIR/s0a.sql"; PA=$!
if doarme A 30; then
  sesiune B "$DIR/s0b.sql"; PB=$!
  if asteapta "NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'probe_test_B')" 30 && doarme A 1; then I=1; else I=0; fi
  wait $PB; wait $PA
  if [ $I = 0 ]; then rezultat NEEXECUTAT "S0 (revenirea nu s-a terminat cât scrierea era deschisă)"
  elif grep -q "folosite chiar acum" "$DIR/B.out" && [ "$(q "SELECT to_regclass('public.executie_probe_tronsoane') IS NOT NULL AND to_regprocedure('public.fn_executie_proba_tranzitie(text, text)') IS NOT NULL")" = "t" ]; then
    rezultat OK "S0 revenirea a refuzat imediat cât o scriere era deschisă; nimic scos"
  else rezultat FAIL "S0: $(iesire B)"; fi
else wait $PA; rezultat FAIL "S0 pregătire: $(iesire A)"; fi

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
  if blocat_de B A 30; then I=1; else I=0; fi
  wait $PA; wait $PB
  if [ $I = 0 ]; then rezultat NEEXECUTAT "S1 (B nu a fost văzută așteptând după A)"
  elif grep -q "se suprapune cu P951" "$DIR/B.out" && [ "$(q "SELECT count(*) FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod IN ('P951', 'P952')")" = "1" ]; then rezultat OK "S1 suprapunerea concurentă refuzată"
  else rezultat FAIL "S1: $(iesire B)"; fi
else wait $PA; rezultat FAIL "S1 pregătire: $(iesire A)"; fi

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
DORM=1 sesiune A "$DIR/s2.sql"; PA=$!
if doarme A 30; then
  sesiune B "$DIR/s2.sql"; PB=$!
  if blocat_de B A 30; then I=1; else I=0; fi
  wait $PA; wait $PB
  ID_A=$(grep -o '"id": [0-9]*' "$DIR/A.out" | head -1); ID_B=$(grep -o '"id": [0-9]*' "$DIR/B.out" | head -1)
  if [ $I = 0 ]; then rezultat NEEXECUTAT "S2 (B nu a fost văzută așteptând după A)"
  elif grep -q '"duplicat": true' "$DIR/B.out" && [ -n "$ID_A" ] && [ "$ID_A" = "$ID_B" ] \
       && [ "$(q "SELECT count(*) FROM public.executie_probe_jurnal WHERE cheie = '$K'")" = "1" ]; then rezultat OK "S2 aceeași cheie = duplicat, o singură scriere"
  else rezultat FAIL "S2: A=[$ID_A] B=$(iesire B)"; fi
else wait $PA; rezultat FAIL "S2 pregătire: $(iesire A)"; fi

# ── S3: CAS pe aceeași etapă ──
E=$(etapa_id P951 pistonare)
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
  DORM=1 sesiune A "$DIR/s3.sql"; PA=$!
  if doarme A 30; then
    sesiune B "$DIR/s3.sql"; PB=$!
    if blocat_de B A 30; then I=1; else I=0; fi
    wait $PA; wait $PB
    if [ $I = 0 ]; then rezultat NEEXECUTAT "S3 (B nu a fost văzută așteptând după A)"
    elif grep -q '"ok": true' "$DIR/A.out" && grep -q '"motiv": "conflict"' "$DIR/B.out" \
         && [ "$(q "SELECT versiune FROM public.executie_probe_etape WHERE id = $E")" = "2" ]; then rezultat OK "S3 CAS concurent: a doua schimbare primește conflict"
    else rezultat FAIL "S3: $(iesire B)"; fi
  else wait $PA; rezultat FAIL "S3 pregătire: $(iesire A)"; fi
else rezultat NEEXECUTAT "S3 (P951 lipsește: S1 a eșuat)"; fi

# ── S4: schimbarea legăturii Probe (CA -> CB) vs ștergeri din Probe, în AMBELE ordini ──
cat > "$DIR/s4leaga.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_proba_etapa(:e, 'urmeaza', 1, 'in_curs', $AZI, NULL, NULL, NULL, NULL, 10, NULL, NULL, :ca, NULL, NULL, NULL, gen_random_uuid());
COMMIT;
EOF
cat > "$DIR/s4a.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_proba_etapa(:e, 'in_curs', 2, 'in_curs', $AZI, NULL, NULL, NULL, NULL, 10, NULL, NULL, :cb, NULL, NULL, NULL, gen_random_uuid());
COMMIT;
EOF
cat > "$DIR/s4_cb_ca.sql" <<EOF
BEGIN;
DELETE FROM public.probe_calcule WHERE id = :cb;
SELECT pg_sleep(4);
DELETE FROM public.probe_calcule WHERE id = :ca;
COMMIT;
EOF
cat > "$DIR/s4_ca_cb.sql" <<EOF
BEGIN;
DELETE FROM public.probe_calcule WHERE id = :ca;
SELECT pg_sleep(4);
DELETE FROM public.probe_calcule WHERE id = :cb;
COMMIT;
EOF
s4() { # nume, cod tronson de probă, fișierul ștergerilor, așteptare A (blocat | imediat)
  E=$(etapa_id "$2" presiune); CA=$(calcul_nou); CB=$(calcul_nou)
  [ -n "$CA" ] && CALCULE="$CALCULE,$CA"; [ -n "$CB" ] && CALCULE="$CALCULE,$CB"
  if [ -z "$E" ] || [ -z "$CA" ] || [ -z "$CB" ]; then rezultat NEEXECUTAT "$1 (etapa sau calculele fictive lipsesc: e=$E ca=$CA cb=$CB)"; return; fi
  sesiune P "$DIR/s4leaga.sql"; wait $!
  if ! grep -q '"ok": true' "$DIR/P.out"; then rezultat FAIL "$1 pregătire (legarea de CA): $(iesire P)"; return; fi
  local v0; v0=$(q "SELECT versiune FROM public.executie_probe_etape WHERE id = $E")
  sesiune B "$3"; local pb=$!
  if ! doarme B 30; then wait $pb; rezultat FAIL "$1 pregătire B: $(iesire B)"; return; fi
  sesiune A "$DIR/s4a.sql"; local pa=$! i=0
  if [ "$4" = "blocat" ]; then blocat_de A B 30 && i=1
  else asteapta "NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'probe_test_A')" 30 && doarme B 1 && i=1; fi
  wait $pb; local rb=$?; wait $pa
  if [ $i = 0 ]; then rezultat NEEXECUTAT "$1 (intercalarea așteptată nu s-a observat)"; return; fi
  if grep -qi "deadlock" "$DIR/A.out" "$DIR/B.out"; then rezultat FAIL "$1: deadlock — A: $(iesire A) B: $(iesire B)"; return; fi
  local etapa; etapa=$(q "SELECT coalesce(probe_calc_id::text, 'null') || ':' || versiune FROM public.executie_probe_etape WHERE id = $E")
  if [ "$4" = "blocat" ]; then
    # B a golit legătura (versiunea +1, trigger) ținând etapa; A a așteptat-o, apoi CAS-ul a întors conflict
    if [ $rb = 0 ] && grep -q '"motiv": "conflict"' "$DIR/A.out" && [ "$etapa" = "null:$((v0 + 1))" ]; then rezultat OK "$1 fără deadlock: A a așteptat etapa ținută de B, apoi conflict"
    else rezultat FAIL "$1: B=$rb etapa=$etapa (așteptat null:$((v0 + 1))) A: $(iesire A)"; fi
  else
    # B ținea CB: A a refuzat imediat (55P03), fără să aștepte; apoi B a șters și CA (legătura golită, versiunea +1)
    if [ $rb = 0 ] && grep -q "se modifică chiar acum" "$DIR/A.out" && [ "$etapa" = "null:$((v0 + 1))" ]; then rezultat OK "$1 fără deadlock: A a refuzat imediat (calcul ocupat), B s-a terminat"
    else rezultat FAIL "$1: B=$rb etapa=$etapa (așteptat null:$((v0 + 1))) A: $(iesire A)"; fi
  fi
}
s4 "S4a (ștergeri CB apoi CA)" P951 "$DIR/s4_cb_ca.sql" imediat
s4 "S4b (ștergeri CA apoi CB)" P953 "$DIR/s4_ca_cb.sql" blocat

CURAT=1
curata || FAIL=1
[ $FAIL = 1 ] && exit 1
[ $NEEX = 1 ] && exit 2
echo "TOATE OK"
exit 0
