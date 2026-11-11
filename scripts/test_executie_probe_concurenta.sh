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
# unde trebuie să refuze fără așteptare, se verifică că PROCESUL ei s-a terminat cât timp cealaltă încă dormea. Erorile se verifică după
# SQLSTATE (psql cu VERBOSITY verbose), nu doar după text. Intercalarea neobținută = NEEXECUTAT, nu OK.
#   S0 revenirea armată, cât o scriere e deschisă: refuz imediat (55P03, NOWAIT), nimic scos
#   S1 suprapunere: a doua creare așteaptă (advisory) și e refuzată (22023)
#   S2 aceeași cheie: a doua creare așteaptă și primește duplicat (același id), un singur rând de jurnal
#   S3 CAS: a doua schimbare a aceleiași etape așteaptă și primește conflict
#   S4a Probe șterge CB (doarme) apoi CA (legat); A schimbă legătura CA -> CB: A refuză imediat (55P03), fără deadlock
#   S4b Probe șterge CA (legat; golește legătura și ține etapa) (doarme) apoi CB; A schimbă CA -> CB: A așteaptă etapa (blocant B), apoi conflict
#   S5 A păstrează legătura CA de DOUĂ ori în aceeași tranzacție, cu o ștergere a lui CA din Probe între ele: primul apel ține deja CA,
#      deci ștergerea așteaptă după A (blocant A); ambele apeluri ale lui A reușesc, apoi ștergerea golește legătura; fără deadlock
#   S6 A păstrează legătura CA (tranzacție deschisă); Probe mută CA pe alt proiect: B așteaptă (blocant A), apoi FK-ul compus refuză (23503)
# Date FICTIVE (codurile P95x, km 950+000…; calcule Probe create și șterse aici), pe proiectul cu id-ul cel mai mic; identitatea =
# owner-ul (JWT în sesiune, SET LOCAL ROLE authenticated). La final — și la orice întrerupere — sesiunile lansate se opresc și se
# așteaptă, backend-urile lor se închid, apoi se șterge tot ce s-a creat și se VERIFICĂ: o curățare eșuată = FAIL.
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
[ "$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'probe\_test\_%'")" = "0" ] \
  || { echo "REFUZ: există deja sesiuni probe_test_* (altă rulare în curs?)" >&2; exit 3; }

OWNER=$(q "SELECT id FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1")
P=$(q "SELECT id FROM public.executie_proiecte ORDER BY id LIMIT 1")
P2=$(q "SELECT id FROM public.executie_proiecte WHERE id <> $P ORDER BY id LIMIT 1")
[ -n "$OWNER" ] && [ -n "$P" ] || { echo "REFUZ: lipsește owner-ul sau proiectul" >&2; exit 3; }
[ "$(q "SELECT count(*) FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND (cod LIKE 'P95_' OR km_pana_la_m > 950000)")" = "0" ] \
  || { echo "REFUZ: zona de test (P95x / km > 950+000) nu e liberă pe proiectul $P" >&2; exit 3; }
# calculele fictive: coloanele minime ale creatorului din modulul Probe; creat_din_teren = true când există (CHECK probe_planificare_nn)
if [ "$(q "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'probe_calcule' AND column_name = 'creat_din_teren')")" = "t" ]; then
  INS_CALC="INSERT INTO public.probe_calcule (proiect_id, tip_fluid, status, creat_din_teren) VALUES ($P, 'aer', 'planificata', true) RETURNING id"
else
  INS_CALC="INSERT INTO public.probe_calcule (proiect_id, tip_fluid, status) VALUES ($P, 'aer', 'planificata') RETURNING id"
fi

RAD="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"
DIR=$(mktemp -d)
CALCULE="0"
PIDS=()
FAIL=0; NEEX=0
rezultat() { echo "$1 $2"; case "$1" in FAIL) FAIL=1 ;; NEEXECUTAT) NEEX=1 ;; esac; }
# oprirea sesiunilor lansate: procesele psql, apoi backend-urile lor (o tranzacție necomisă se anulează), apoi așteptarea închiderii
opreste_sesiunile() {
  local p
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done
  for p in "${PIDS[@]}"; do wait "$p" 2>/dev/null; done
  q "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE application_name LIKE 'probe\_test\_%' AND pid <> pg_backend_pid()" >/dev/null 2>&1
  asteapta "NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name LIKE 'probe\_test\_%')" 100
}
# curățarea: ștergeri explicite, apoi VERIFICAREA că nu a rămas nimic (L18: o curățare eșuată nu trece tacit)
curata() {
  opreste_sesiunile || { echo "FAIL curățarea: sesiunile probe_test_* nu s-au închis"; return 1; }
  q "DELETE FROM public.executie_probe_jurnal WHERE proba_id IN (SELECT id FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod LIKE 'P95_');
     DELETE FROM public.executie_probe_etape WHERE proba_id IN (SELECT id FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod LIKE 'P95_');
     DELETE FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod LIKE 'P95_';
     DELETE FROM public.probe_calcule WHERE id IN ($CALCULE);" > "$DIR/curata.out" 2>&1
  local cod=$?
  local ramase; ramase=$(q "SELECT (SELECT count(*) FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod LIKE 'P95_')
                                  + (SELECT count(*) FROM public.probe_calcule WHERE id IN ($CALCULE))" 2>&1)
  if [ $cod -ne 0 ] || [ "$ramase" != "0" ]; then echo "FAIL curățarea: cod $cod, rămase: $ramase, $(tr '\n' ' ' < "$DIR/curata.out" | cut -c1-200)"; return 1; fi
  echo "OK curățarea (sesiuni oprite, nimic rămas)"; return 0
}
la_iesire() { local c=$?; if [ -z "${CURAT:-}" ]; then curata || c=1; fi; rm -rf "$DIR"; exit $c; }
trap la_iesire EXIT
trap 'exit 130' INT TERM

# așteaptă până când condiția SQL e adevărată (zecimi de secundă)
asteapta() { local i; for i in $(seq 1 "$2"); do [ "$(q "SELECT ($1)")" = "t" ] && return 0; sleep 0.1; done; return 1; }
doarme() { asteapta "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'probe_test_$1' AND wait_event = 'PgSleep')" "$2"; }
# $1 așteaptă un lock ȚINUT de $2 (blocantul identificat prin pg_blocking_pids)
blocat_de() {
  asteapta "EXISTS (SELECT 1 FROM pg_stat_activity a JOIN pg_stat_activity b ON b.pid = ANY (pg_blocking_pids(a.pid))
                     WHERE a.application_name = 'probe_test_$1' AND a.wait_event_type = 'Lock' AND b.application_name = 'probe_test_$2')" "$3"
}
# procesul psql lansat s-a terminat (în cel mult $2 zecimi de secundă)
terminat() { local i; for i in $(seq 1 "$2"); do kill -0 "$1" 2>/dev/null || return 0; sleep 0.1; done; return 1; }
# identitatea owner-ului în sesiune (ambele surse JWT), apoi rolul aplicației
ID_SQL="SELECT set_config('request.jwt.claim.sub', :'owner', true), set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;"
AZI="(now() AT TIME ZONE 'Europe/Bucharest')::date"
ULTIM=0
sesiune() { # nume, fișier sql -> în fundal (PID în ULTIM și PIDS), ieșirea în $DIR/<nume>.out; VERBOSITY verbose = SQLSTATE în ieșire
  local extra=(); [ "${DORM:-0}" = "1" ] && extra=(-v dorm=1)
  PGAPPNAME="probe_test_$1" "$PSQL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -v owner="$OWNER" -v p="$P" -v p2="${P2:-0}" -v e="${E:-0}" \
    -v ca="${CA:-0}" -v cb="${CB:-0}" -v k="${K:-00000000-0000-0000-0000-000000000000}" "${extra[@]}" -f "$2" > "$DIR/$1.out" 2>&1 &
  ULTIM=$!; PIDS+=("$ULTIM")
}
iesire() { tr '\n' ' ' < "$DIR/$1.out" | cut -c1-300; }
are_cod() { grep -q "ERROR:  $2:" "$DIR/$1.out"; }      # SQLSTATE exact în ieșirea sesiunii
fara_deadlock() { ! grep -qi "40P01\|deadlock" "$DIR/A.out" "$DIR/B.out"; }
# creează un calcul fictiv și îl pune în variabila numită ($1) și în lista de curățare (fără subshell, ca lista să rămână la zi)
calcul_nou() { local id; id=$(q "$INS_CALC") || return 1; [ -n "$id" ] || return 1; CALCULE="$CALCULE,$id"; printf -v "$1" '%s' "$id"; }
etapa_id() { q "SELECT e.id FROM public.executie_probe_etape e JOIN public.executie_probe_tronsoane t ON t.id = e.proba_id WHERE t.proiect_id = $P AND t.cod = '$1' AND t.stare = 'activ' AND e.etapa = '$2'"; }
creeaza_proba() { # cod, km de la, km până la (direct prin RPC, ca owner, comis)
  cat > "$DIR/creeaza.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_proba_salveaza(:p, NULL, NULL, '$1', $2, $3, NULL, NULL, gen_random_uuid());
COMMIT;
EOF
  sesiune C "$DIR/creeaza.sql"; wait $ULTIM; grep -q '"ok": true' "$DIR/C.out"
}

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
sesiune A "$DIR/s0a.sql"; PA=$ULTIM
if doarme A 30; then
  sesiune B "$DIR/s0b.sql"; PB=$ULTIM
  if terminat $PB 30 && doarme A 1; then I=1; else I=0; fi
  wait $PB; wait $PA
  if [ $I = 0 ]; then rezultat NEEXECUTAT "S0 (revenirea nu s-a terminat cât scrierea era deschisă)"
  elif are_cod B 55P03 && grep -q "folosite chiar acum" "$DIR/B.out" \
       && [ "$(q "SELECT to_regclass('public.executie_probe_tronsoane') IS NOT NULL AND to_regprocedure('public.fn_executie_proba_tranzitie(text, text)') IS NOT NULL")" = "t" ]; then
    rezultat OK "S0 revenirea a refuzat imediat (55P03) cât o scriere era deschisă; nimic scos"
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
sesiune A "$DIR/s1a.sql"; PA=$ULTIM
if doarme A 30; then
  sesiune B "$DIR/s1b.sql"; PB=$ULTIM
  if blocat_de B A 30; then I=1; else I=0; fi
  wait $PA; RA=$?; wait $PB
  if [ $I = 0 ]; then rezultat NEEXECUTAT "S1 (B nu a fost văzută așteptând după A)"
  elif [ $RA = 0 ] && are_cod B 22023 && grep -q "se suprapune cu P951" "$DIR/B.out" \
       && [ "$(q "SELECT count(*) FROM public.executie_probe_tronsoane WHERE proiect_id = $P AND cod IN ('P951', 'P952')")" = "1" ]; then rezultat OK "S1 suprapunerea concurentă refuzată (22023)"
  else rezultat FAIL "S1: A=$RA B: $(iesire B)"; fi
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
DORM=1 sesiune A "$DIR/s2.sql"; PA=$ULTIM
if doarme A 30; then
  sesiune B "$DIR/s2.sql"; PB=$ULTIM
  if blocat_de B A 30; then I=1; else I=0; fi
  wait $PA; RA=$?; wait $PB; RB=$?
  ID_A=$(grep -o '"id": [0-9]*' "$DIR/A.out" | head -1); ID_B=$(grep -o '"id": [0-9]*' "$DIR/B.out" | head -1)
  if [ $I = 0 ]; then rezultat NEEXECUTAT "S2 (B nu a fost văzută așteptând după A)"
  elif [ $RA = 0 ] && [ $RB = 0 ] && grep -q '"duplicat": true' "$DIR/B.out" && [ -n "$ID_A" ] && [ "$ID_A" = "$ID_B" ] \
       && [ "$(q "SELECT count(*) FROM public.executie_probe_jurnal WHERE cheie = '$K'")" = "1" ]; then rezultat OK "S2 aceeași cheie = duplicat, o singură scriere"
  else rezultat FAIL "S2: A=$RA/[$ID_A] B=$RB $(iesire B)"; fi
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
  DORM=1 sesiune A "$DIR/s3.sql"; PA=$ULTIM
  if doarme A 30; then
    sesiune B "$DIR/s3.sql"; PB=$ULTIM
    if blocat_de B A 30; then I=1; else I=0; fi
    wait $PA; RA=$?; wait $PB; RB=$?
    if [ $I = 0 ]; then rezultat NEEXECUTAT "S3 (B nu a fost văzută așteptând după A)"
    elif [ $RA = 0 ] && [ $RB = 0 ] && grep -q '"ok": true' "$DIR/A.out" && grep -q '"motiv": "conflict"' "$DIR/B.out" \
         && [ "$(q "SELECT versiune FROM public.executie_probe_etape WHERE id = $E")" = "2" ]; then rezultat OK "S3 CAS concurent: a doua schimbare primește conflict"
    else rezultat FAIL "S3: A=$RA B=$RB $(iesire B)"; fi
  else wait $PA; rezultat FAIL "S3 pregătire: $(iesire A)"; fi
else rezultat NEEXECUTAT "S3 (P951 lipsește: S1 a eșuat)"; fi

# ── S4–S6: legătura cu modulul Probe vs operații din Probe ──
cat > "$DIR/leaga.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_proba_etapa(:e, 'urmeaza', 1, 'in_curs', $AZI, NULL, NULL, NULL, NULL, 10, NULL, NULL, :ca, NULL, NULL, NULL, gen_random_uuid());
COMMIT;
EOF
# cod tronson de probă -> E (etapa de presiune), CA (legat), CB; V0 = versiunea după legare; la eșec MESAJ. Se apelează DIRECT (nu în $(...)).
pregateste_legatura() {
  MESAJ=""; CA=""; CB=""
  E=$(etapa_id "$1" presiune)
  calcul_nou CA; calcul_nou CB
  if [ -z "$E" ] || [ -z "$CA" ] || [ -z "$CB" ]; then MESAJ="etapa sau calculele fictive lipsesc: e=$E ca=$CA cb=$CB"; return 1; fi
  sesiune P "$DIR/leaga.sql"; wait $ULTIM
  grep -q '"ok": true' "$DIR/P.out" || { MESAJ="legarea de CA: $(iesire P)"; return 1; }
  V0=$(q "SELECT versiune FROM public.executie_probe_etape WHERE id = $E")
}
etapa_acum() { q "SELECT coalesce(probe_calc_id::text, 'null') || ':' || versiune FROM public.executie_probe_etape WHERE id = $E"; }

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
s4() { # nume, cod tronson de probă, fișierul ștergerilor, imediat | blocat
  pregateste_legatura "$2" || { rezultat NEEXECUTAT "$1 ($MESAJ)"; return; }
  sesiune B "$3"; local pb=$ULTIM
  doarme B 30 || { wait $pb; rezultat FAIL "$1 pregătire B: $(iesire B)"; return; }
  sesiune A "$DIR/s4a.sql"; local pa=$ULTIM i=0
  if [ "$4" = "blocat" ]; then blocat_de A B 30 && i=1; else terminat $pa 30 && doarme B 1 && i=1; fi
  wait $pb; local rb=$?; wait $pa; local ra=$?
  [ $i = 1 ] || { rezultat NEEXECUTAT "$1 (intercalarea așteptată nu s-a observat)"; return; }
  fara_deadlock || { rezultat FAIL "$1: deadlock — A: $(iesire A) B: $(iesire B)"; return; }
  local acum; acum=$(etapa_acum)
  if [ "$4" = "blocat" ]; then
    if [ $rb = 0 ] && [ $ra = 0 ] && grep -q '"motiv": "conflict"' "$DIR/A.out" && [ "$acum" = "null:$((V0 + 1))" ]; then rezultat OK "$1 fără deadlock: A a așteptat etapa ținută de B, apoi conflict"
    else rezultat FAIL "$1: A=$ra B=$rb etapa=$acum (așteptat null:$((V0 + 1))) A: $(iesire A)"; fi
  else
    if [ $rb = 0 ] && are_cod A 55P03 && [ "$acum" = "null:$((V0 + 1))" ]; then rezultat OK "$1 fără deadlock: A a refuzat imediat (55P03), B s-a terminat"
    else rezultat FAIL "$1: A=$ra B=$rb etapa=$acum (așteptat null:$((V0 + 1))) A: $(iesire A)"; fi
  fi
}
s4 "S4a (ștergeri CB apoi CA)" P951 "$DIR/s4_cb_ca.sql" imediat
s4 "S4b (ștergeri CA apoi CB)" P953 "$DIR/s4_ca_cb.sql" blocat

# S5: două păstrări ale legăturii CA în aceeași tranzacție, cu ștergerea lui CA din Probe între ele. Primul apel ține deja CA
# (FOR KEY SHARE NOWAIT pe legătura păstrată), deci ștergerea așteaptă după A (nu etapa) și al doilea apel nu are ce aștepta: ambele
# reușesc, apoi ștergerea golește legătura. Fără lock-ul pe legătura păstrată, al doilea apel ar aștepta CA ținând etapa = deadlock.
if creeaza_proba P954 962000 963000; then
  if pregateste_legatura P954; then
    cat > "$DIR/s5a.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_proba_etapa(:e, 'in_curs', 2, 'in_curs', $AZI, NULL, NULL, NULL, NULL, 10, 9.5, NULL, :ca, NULL, NULL, NULL, gen_random_uuid());
SELECT pg_sleep(4);
SELECT public.fn_executie_proba_etapa(:e, 'in_curs', 3, 'in_curs', $AZI, NULL, NULL, NULL, NULL, 10, 9.4, NULL, :ca, NULL, NULL, NULL, gen_random_uuid());
COMMIT;
EOF
    cat > "$DIR/s5b.sql" <<EOF
BEGIN;
DELETE FROM public.probe_calcule WHERE id = :ca;
COMMIT;
EOF
    sesiune A "$DIR/s5a.sql"; PA=$ULTIM
    if doarme A 30; then
      sesiune B "$DIR/s5b.sql"; PB=$ULTIM
      if blocat_de B A 30; then I=1; else I=0; fi
      wait $PA; RA=$?; wait $PB; RB=$?
      ACUM=$(etapa_acum)
      if [ $I = 0 ]; then rezultat NEEXECUTAT "S5 (B nu a fost văzută așteptând după A)"
      elif ! fara_deadlock; then rezultat FAIL "S5: deadlock — A: $(iesire A) B: $(iesire B)"
      elif [ $RA = 0 ] && [ $RB = 0 ] && [ "$(grep -c '"ok": true' "$DIR/A.out")" = "2" ] && [ "$ACUM" = "null:$((V0 + 3))" ]; then
        rezultat OK "S5 ștergerea din Probe a așteptat după A (blocant A), ambele păstrări au reușit, apoi legătura golită; fără deadlock"
      else rezultat FAIL "S5: A=$RA B=$RB etapa=$ACUM (așteptat null:$((V0 + 3))) A: $(iesire A) B: $(iesire B)"; fi
    else wait $PA; rezultat FAIL "S5 pregătire: $(iesire A)"; fi
  else rezultat NEEXECUTAT "S5 ($MESAJ)"; fi
else rezultat FAIL "S5 pregătire (P954): $(iesire C)"; fi

# S6: Probe mută un calcul legat pe alt proiect, cât A ține legătura (păstrată) într-o tranzacție deschisă
if [ -z "$P2" ]; then rezultat NEEXECUTAT "S6 (clona are un singur proiect de Execuție)"
elif creeaza_proba P955 964000 965000; then
  if pregateste_legatura P955; then
    cat > "$DIR/s6a.sql" <<EOF
BEGIN;
$ID_SQL
SELECT public.fn_executie_proba_etapa(:e, 'in_curs', 2, 'in_curs', $AZI, NULL, NULL, NULL, NULL, 10, 9.5, NULL, :ca, NULL, NULL, NULL, gen_random_uuid());
SELECT pg_sleep(4);
COMMIT;
EOF
    cat > "$DIR/s6b.sql" <<EOF
BEGIN;
UPDATE public.probe_calcule SET proiect_id = :p2 WHERE id = :ca;
COMMIT;
EOF
    sesiune A "$DIR/s6a.sql"; PA=$ULTIM
    if doarme A 30; then
      sesiune B "$DIR/s6b.sql"; PB=$ULTIM
      if blocat_de B A 30; then I=1; else I=0; fi
      wait $PA; RA=$?; wait $PB
      if [ $I = 0 ]; then rezultat NEEXECUTAT "S6 (B nu a fost văzută așteptând după A)"
      elif [ $RA = 0 ] && are_cod B 23503 && [ "$(q "SELECT proiect_id FROM public.probe_calcule WHERE id = $CA")" = "$P" ]; then rezultat OK "S6 mutarea calculului legat pe alt proiect: a așteptat, apoi refuzată de FK (23503)"
      else rezultat FAIL "S6: A=$RA B: $(iesire B)"; fi
    else wait $PA; rezultat FAIL "S6 pregătire: $(iesire A)"; fi
  else rezultat NEEXECUTAT "S6 ($MESAJ)"; fi
else rezultat FAIL "S6 pregătire (P955): $(iesire C)"; fi

CURAT=1
curata || FAIL=1
[ $FAIL = 1 ] && exit 1
[ $NEEX = 1 ] && exit 2
echo "TOATE OK"
exit 0
