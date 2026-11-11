#!/usr/bin/env bash
# ============================================================================
# Concurență în DOUĂ sesiuni reale pentru fn_raport_zilnic_salveaza (20261208a) — DOAR pe clona schemei de producție, cu 20261201a +
# 20261208a APLICATE pe clonă (harness-ul cu o singură sesiune e scripts/test_executie_devize_tinte.sql). NICIODATĂ pe producție.
# Rulare (conexiunea din mediul psql: PGHOST / PGPORT / PGUSER / PGDATABASE + pgpass; nicio parolă aici):
#   PSQL=<cale psql> bash scripts/test_executie_devize_tinte_concurenta.sh --sistem <system_identifier al CLONEI>
# Coregrafia: sesiunea A salvează și ține tranzacția deschisă (pg_sleep); B pornește abia după ce A doarme și trebuie să AȘTEPTE un lock ținut
# de A (pg_blocking_pids). Intercalarea neobținută = NEEXECUTAT, nu OK.
#   S1 CAS: același raport, aceeași versiune, chei diferite -> A ok, B conflict (după ce A comite)
#   S2 aceeași cheie, același conținut -> A ok, B duplicat (aceeași versiune), un singur rând de jurnal
#   S3 același raport NOU (încă inexistent), două creări cu versiunea 0 -> A ok (raportul creat), B conflict (advisory pe șantier + zi)
#   S4 o creare DIRECTĂ (în afara RPC-ului, ca alt modul / telefonul vechi) ține tranzacția deschisă; RPC-ul cu versiunea 0 așteaptă la
#      ON CONFLICT, apoi primește conflict și NU suprascrie antetul scris direct (review r3 P1-1)
# Date FICTIVE: rapoarte doar-antet (fără linii) pe primul șantier, în zile din 2000 (verificate libere). Identitatea = owner-ul (JWT în
# sesiune, SET LOCAL ROLE authenticated). La final (și la întrerupere) sesiunile se opresc, rapoartele de test se șterg (jurnalul și liniile
# lor cad în cascadă) și curățarea se VERIFICĂ. Cod de ieșire: 0 = OK; 1 = vreun FAIL; 2 = vreun NEEXECUTAT; 3 = garda / pregătirea a refuzat.
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
[ "$(q "SELECT to_regprocedure('public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, jsonb, integer, uuid)') IS NOT NULL")" = "t" ] \
  || { echo "REFUZ: 20261208a nu e aplicată pe clonă" >&2; exit 3; }
[ "$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'devize\_test\_%'")" = "0" ] \
  || { echo "REFUZ: există deja sesiuni devize_test_* (altă rulare în curs?)" >&2; exit 3; }
OWNER=$(q "SELECT id FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1")
S=$(q "SELECT id FROM public.sites ORDER BY id LIMIT 1")
[ -n "$OWNER" ] && [ -n "$S" ] || { echo "REFUZ: lipsește owner-ul sau șantierul" >&2; exit 3; }
ZILE="'2000-01-03','2000-01-04','2000-01-05','2000-01-06'"
[ "$(q "SELECT count(*) FROM public.rapoarte_zilnice WHERE site_id = $S AND data IN ($ZILE)")" = "0" ] \
  || { echo "REFUZ: zilele de test (2000-01-03…06) nu sunt libere pe șantierul $S" >&2; exit 3; }

DIR=$(mktemp -d)
PIDS=()
FAIL=0; NEEX=0
rezultat() { echo "$1 $2"; case "$1" in FAIL) FAIL=1 ;; NEEXECUTAT) NEEX=1 ;; esac; }
asteapta() { local i; for i in $(seq 1 "$2"); do [ "$(q "SELECT ($1)")" = "t" ] && return 0; sleep 0.1; done; return 1; }
opreste_sesiunile() {
  local p
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done
  for p in "${PIDS[@]}"; do wait "$p" 2>/dev/null; done
  q "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE application_name LIKE 'devize\_test\_%' AND pid <> pg_backend_pid()" >/dev/null 2>&1
  asteapta "NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name LIKE 'devize\_test\_%')" 100
}
curata() {
  opreste_sesiunile || { echo "FAIL curățarea: sesiunile devize_test_* nu s-au închis"; return 1; }
  q "DELETE FROM public.rapoarte_zilnice WHERE site_id = $S AND data IN ($ZILE)" > "$DIR/curata.out" 2>&1
  local cod=$? ramase
  ramase=$(q "SELECT count(*) FROM public.rapoarte_zilnice WHERE site_id = $S AND data IN ($ZILE)" 2>&1)
  if [ $cod -ne 0 ] || [ "$ramase" != "0" ]; then echo "FAIL curățarea: cod $cod, rămase: $ramase, $(tr '\n' ' ' < "$DIR/curata.out" | cut -c1-200)"; return 1; fi
  echo "OK curățarea (sesiuni oprite, nimic rămas)"; return 0
}
la_iesire() { local c=$?; curata || c=1; rm -rf "$DIR"; exit $c; }
trap la_iesire EXIT
trap 'exit 130' INT TERM

# fișierul unei sesiuni: identitatea owner-ului (ambele surse JWT) -> salvarea (doar antet) -> [somn] -> COMMIT
fisier() { # nume, dorm (0/1)
  cat > "$DIR/$1.sql" <<'EOF'
BEGIN;
SELECT set_config('request.jwt.claim.sub', :'owner', true), set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT 'REZ ' || public.fn_raport_zilnic_salveaza(:s, :'zi'::date, '{"lucrari_efectuate": "concurenta"}'::jsonb, NULL, NULL, :v, :'k'::uuid)::text;
EOF
  [ "$2" = "1" ] && echo "SELECT pg_sleep(4);" >> "$DIR/$1.sql"
  echo "COMMIT;" >> "$DIR/$1.sql"
}
sesiune() { # nume, zi, versiune, cheie -> în fundal (PID în ULTIM și PIDS)
  PGAPPNAME="devize_test_$1" "$PSQL" -X -A -t -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -v owner="$OWNER" -v s="$S" -v zi="$2" -v v="$3" -v k="$4" \
    -f "$DIR/$1.sql" > "$DIR/$1.out" 2>&1 &
  ULTIM=$!; PIDS+=("$ULTIM")
}
doarme() { asteapta "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'devize_test_$1' AND wait_event = 'PgSleep')" 50; }
blocat_de() {
  asteapta "EXISTS (SELECT 1 FROM pg_stat_activity a JOIN pg_stat_activity b ON b.pid = ANY (pg_blocking_pids(a.pid))
                     WHERE a.application_name = 'devize_test_$1' AND a.wait_event_type = 'Lock' AND b.application_name = 'devize_test_$2')" 30
}
iesire() { tr '\n' ' ' < "$DIR/$1.out" | cut -c1-300; }
uuid() { q "SELECT gen_random_uuid()"; }
# o salvare simplă, comisă (pregătirea unui raport existent, versiunea 1)
pregateste() { fisier P 0; sesiune P "$1" 0 "$(uuid)"; wait "$ULTIM"; grep -q '"ok": true' "$DIR/P.out"; }
# A doarme cu salvarea ținută; B trebuie să aștepte după A; apoi se verifică rezultatele
scenariu() { # nume, zi, vA, kA, vB, kB, așteptat_B (text în rezultatul lui B)
  fisier A 1; fisier B 0
  sesiune A "$2" "$3" "$4"; local pa=$ULTIM
  if ! doarme A; then rezultat NEEXECUTAT "$1: A n-a ajuns în somn ($(iesire A))"; opreste_sesiunile; PIDS=(); return; fi
  sesiune B "$2" "$5" "$6"; local pb=$ULTIM
  local astepta=0; blocat_de B A && astepta=1
  wait "$pa"; wait "$pb"; PIDS=()
  if [ $astepta -ne 1 ]; then rezultat NEEXECUTAT "$1: B n-a așteptat după A (A: $(iesire A) | B: $(iesire B))"; return; fi
  if grep -q '"ok": true' "$DIR/A.out" && grep -q "$7" "$DIR/B.out" && ! grep -qi "40P01\|deadlock" "$DIR/A.out" "$DIR/B.out"; then
    rezultat OK "$1 (B a așteptat după A, apoi: $7)"
  else
    rezultat FAIL "$1: A: $(iesire A) | B: $(iesire B)"
  fi
}

pregateste 2000-01-03 || { echo "REFUZ: pregătirea raportului 2000-01-03 a eșuat: $(iesire P)" >&2; exit 3; }
scenariu S1 2000-01-03 1 "$(uuid)" 1 "$(uuid)" '"motiv": "conflict"'
pregateste 2000-01-04 || { echo "REFUZ: pregătirea raportului 2000-01-04 a eșuat: $(iesire P)" >&2; exit 3; }
K=$(uuid)
scenariu S2 2000-01-04 1 "$K" 1 "$K" '"duplicat": true'
J=$(q "SELECT count(*) FROM public.raport_zilnic_salvari j JOIN public.rapoarte_zilnice r ON r.id = j.raport_id WHERE r.site_id = $S AND r.data = '2000-01-04' AND j.cheie = '$K'")
[ "$J" = "1" ] && rezultat OK "S2 un singur rând de jurnal pentru cheie" || rezultat FAIL "S2 jurnal: $J rânduri pentru cheie"
scenariu S3 2000-01-05 0 "$(uuid)" 0 "$(uuid)" '"motiv": "conflict"'
V=$(q "SELECT versiune_salvare FROM public.rapoarte_zilnice WHERE site_id = $S AND data = '2000-01-05'")
[ "$V" = "1" ] && rezultat OK "S3 raportul nou creat o singură dată (versiunea 1)" || rezultat FAIL "S3 versiunea raportului nou: $V"

# S4: B scrie DIRECT raportul zilei 2000-01-06 (conexiunea scriptului, fără RPC) și doarme; A (RPC, versiunea 0) trebuie să aștepte după B
cat > "$DIR/B4.sql" <<EOF
BEGIN;
INSERT INTO public.rapoarte_zilnice (site_id, data, lucrari_efectuate) VALUES ($S, DATE '2000-01-06', 'scris direct');
SELECT pg_sleep(4);
COMMIT;
EOF
PGAPPNAME="devize_test_B4" "$PSQL" -X -A -t -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "$DIR/B4.sql" > "$DIR/B4.out" 2>&1 &
PB4=$!; PIDS+=("$PB4")
if doarme B4; then
  fisier A4 0; sesiune A4 2000-01-06 0 "$(uuid)"; PA4=$ULTIM
  ASTEPTA4=0; blocat_de A4 B4 && ASTEPTA4=1
  wait "$PB4"; wait "$PA4"; PIDS=()
  TEXT4=$(q "SELECT lucrari_efectuate FROM public.rapoarte_zilnice WHERE site_id = $S AND data = '2000-01-06'")
  if [ $ASTEPTA4 -ne 1 ]; then
    rezultat NEEXECUTAT "S4: RPC-ul n-a așteptat după scrierea directă (A: $(iesire A4) | B: $(iesire B4))"
  elif grep -q '"motiv": "conflict"' "$DIR/A4.out" && [ "$TEXT4" = "scris direct" ] && ! grep -qi "40P01\|deadlock" "$DIR/A4.out" "$DIR/B4.out"; then
    rezultat OK "S4 (RPC-ul a așteptat după scrierea directă, apoi conflict; antetul scris direct a rămas)"
  else
    rezultat FAIL "S4: A: $(iesire A4) | B: $(iesire B4) | antet: $TEXT4"
  fi
else
  rezultat NEEXECUTAT "S4: scrierea directă n-a ajuns în somn ($(iesire B4))"; opreste_sesiunile; PIDS=()
fi

if [ $FAIL -ne 0 ]; then exit 1; fi
if [ $NEEX -ne 0 ]; then exit 2; fi
echo "TOATE OK"
exit 0
