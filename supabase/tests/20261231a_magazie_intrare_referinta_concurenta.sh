#!/usr/bin/env bash
# Proba de CONCURENȚĂ a migrării 20261231a (Magazie: aceeași intrare nu se salvează de două ori; PR #1150 r5): DOUĂ sesiuni psql REALE, cu barieră
# explicită, pe un cluster PostgreSQL ≥ 17 COMPLET DISPENSABIL. PGlite (o singură conexiune) nu poate proba asta: aici a doua inserare cu ACEEAȘI
# referinta_intentie vine cât prima e încă necomisă (cererea „în zbor”), exact cazul din verdictul r4.
#
# CE ATINGE (exact):
#   * BAZA: creează baza <nume_baza_noua> (refuză dacă există deja) și o ȘTERGE la final (DROP DATABASE … WITH (FORCE)), inclusiv la întrerupere
#     (trap EXIT / INT / TERM). Nu se conectează la nicio altă bază decât `postgres` (pentru CREATE / DROP) și baza nouă.
#   * ROLURI la nivel de CLUSTER: scheletul (supabase/tests/20261231a_magazie_intrare_referinta_schelet.sql) creează, DOAR dacă lipsesc, rolurile anon,
#     authenticated, service_role (BYPASSRLS), supabase_auth_admin. Scriptul notează ÎNAINTE care lipsesc și le ȘTERGE la final pe cele create de el;
#     rolurile preexistente nu sunt atinse. De aceea rulează DOAR cu MAGREF_CLUSTER_DISPENSABIL=da: NU pe clona de producție, NU pe un cluster folosit
#     la altceva.
#   * FIȘIERE: un folder temporar (mktemp -d) cu DDL-ul extras și jurnalele sesiunilor; șters la final (la eșec, cozile jurnalelor se afișează înainte).
#   * REȚEA: doar conexiunile psql la cluster (PGHOST / PGPORT / PGUSER / PGPASSWORD sau pgpass).
# CE APLICĂ: scheletul + secțiunile 1–2 ale migrării (coloana, UNIQUE, funcția și triggerul: textul EXACT dintre marcajele „-- ─── 1.” și „-- ─── 3.”),
#   fără gărzile runnerului. Aplicarea completă prin runner (manifestul L15, aplicare → revenire → reaplicare) e pasul SEPARAT al coordonatorului,
#   pe clonă, ca la celelalte migrări (docs/LIVRARE_L15_V2.md §7).
#
# CUM SE RULEAZĂ (coordonatorul; cere bash ≥ 4 (coproc), psql ≥ 13 (\warn), conectare ca superuser `postgres`):
#     MAGREF_CLUSTER_DISPENSABIL=da PGHOST=… PGPORT=… PGUSER=postgres PGPASSWORD=… bash supabase/tests/20261231a_magazie_intrare_referinta_concurenta.sh <nume_baza_noua>
#   Ieșire: 0 = toate așteptările se țin și curățenia a reușit; 1 = cel puțin o așteptare nu se ține (sau curățenia a eșuat); 2 = refuz / folosire greșită.
#
# BARIERA (fără sleep): sesiunea A e un psql ținut deschis (coproc); după fiecare instrucțiune A scrie pe stderr marcajul `\warn <PAS> :SQLSTATE`, iar
#   scriptul BLOCHEAZĂ până îl primește: inserarea lui A s-a terminat și e NECOMISĂ (rândul ei ține cheia). Abia apoi pornește sesiunea B (psql separat,
#   sincron) cu lock_timeout = 1 s: B găsește conflictul cu rândul necomis al lui A și AȘTEAPTĂ tranzacția lui A → 55P03 (singura altă sesiune e A).
#   Apoi A COMMIT / ROLLBACK (marcaj) și B se repetă fără concurent. SQLSTATE-urile se citesc din psql (:SQLSTATE), numerele de rânduri din SELECT.
#   Singurele timpuri: lock_timeout 1 s (mecanismul așteptat) și plasa read -t 60 (dacă A moare).
#
# SCENARII (așteptările scrise de mână):
#   C1  cererea întârziată se comite: A: BEGIN; INSERT … ON CONFLICT (referinta_intentie) DO NOTHING (cheia K1) → 00000, necomis.
#       B: aceeași inserare (retrimiterea) → 55P03 (a așteptat A; nimic scris).  A: COMMIT.  B din nou → 00000, 0 rânduri inserate.  Total K1 = 1.
#   C2  cererea întârziată eșuează: A: BEGIN; inserare K2 → necomis.  B → 55P03.  A: ROLLBACK.  B din nou → 00000, 1 rând.  Total K2 = 1 (calea legitimă:
#       prima cerere n-a ajuns, retrimiterea scrie).
#   C3  clientul cu INSERT simplu (fără ON CONFLICT): A ține K3 necomis.  B: INSERT simplu K3 → 55P03.  A: COMMIT.  B din nou → 23505.  Total K3 = 1.
#   C4  ordinea inversă: B (retrimiterea) scrie ÎNTÂI K4 și comite; A (cererea întârziată) sosește după → 00000, 0 rânduri.  Total K4 = 1.
set -u
set -o pipefail

if [ "${MAGREF_CLUSTER_DISPENSABIL:-}" != "da" ]; then
  echo "refuz: scriptul creeaza / sterge o baza si poate crea roluri la nivel de CLUSTER; ruleaza-l DOAR pe un cluster complet dispensabil, cu MAGREF_CLUSTER_DISPENSABIL=da" >&2
  exit 2
fi
if [ $# -ne 1 ] || ! [[ "$1" =~ ^[a-z][a-z0-9_]{2,40}$ ]]; then echo "folosire: MAGREF_CLUSTER_DISPENSABIL=da $0 <nume_baza_noua (a-z0-9_)>" >&2; exit 2; fi
BAZA="$1"
RADACINA="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$RADACINA/supabase/migrations/20261231a_magazie_intrare_referinta.sql"
SCHELET="$RADACINA/supabase/tests/20261231a_magazie_intrare_referinta_schelet.sql"
[ -r "$MIG" ] && [ -r "$SCHELET" ] || { echo "lipsesc migrarea / scheletul" >&2; exit 2; }

PSM=(psql -X -q -w -v ON_ERROR_STOP=1 -d postgres)
VERS_CLIENT="$(psql --version 2>/dev/null | sed -n 's/^psql (PostgreSQL) \([0-9]*\).*/\1/p')"
if [ -z "$VERS_CLIENT" ] || [ "$VERS_CLIENT" -lt 13 ]; then echo "refuz: psql >= 13 (\\warn exista din psql 13); gasit: $(psql --version 2>&1)" >&2; exit 2; fi
PRE="$("${PSM[@]}" -tAc "SELECT current_setting('server_version_num')::int >= 170000, current_user = 'postgres', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), EXISTS (SELECT 1 FROM pg_database WHERE datname = '$BAZA')")" || { echo "refuz: nu ma pot conecta la baza postgres" >&2; exit 2; }
case "$PRE" in
  t\|t\|t\|f) ;;
  t\|t\|t\|t) echo "refuz: baza $BAZA exista deja (aleg alt nume; nu sterg nimic existent)" >&2; exit 2;;
  *) echo "refuz: cere PostgreSQL >= 17, current_user = postgres, superuser (primit: $PRE)" >&2; exit 2;;
esac

D="$(mktemp -d -t magref_concurenta_XXXXXX)"
DDL="$D/ddl.sql"; A_OUT="$D/A.stdout.log"; A_ERR="$D/A.stderr.log"; B_LOG="$D/B.log"
: > "$A_ERR"; : > "$B_LOG"
BAZA_CREATA=0; A_DESCHIS=0; esec=0
ROLURI=(anon authenticated service_role supabase_auth_admin)
ROLURI_CREATE=()
curatenie() {
  local cod=$?
  trap - EXIT INT TERM
  if [ "$cod" != 0 ] || [ "$esec" != 0 ]; then
    echo "── sesiunea A (stderr, ultimele 40) ──"; tail -n 40 "$A_ERR" 2>/dev/null
    echo "── sesiunile B (ultimele 40) ──"; tail -n 40 "$B_LOG" 2>/dev/null
  fi
  if [ "$A_DESCHIS" = 1 ]; then
    { printf '%s\n' 'ROLLBACK;' '\q' >&"$A_FD_IN"; } 2>/dev/null || true
    wait "$A_PID_C" 2>/dev/null || true
  fi
  if [ "$BAZA_CREATA" = 1 ]; then
    if "${PSM[@]}" -c "DROP DATABASE \"$BAZA\" WITH (FORCE)" > /dev/null; then echo "  OK  curatenie: DROP DATABASE $BAZA"; else echo "  NU  curatenie: DROP DATABASE $BAZA a esuat (de sters manual)"; cod=1; fi
  fi
  local r
  for r in ${ROLURI_CREATE[@]+"${ROLURI_CREATE[@]}"}; do
    if "${PSM[@]}" -c "DROP ROLE IF EXISTS \"$r\"" > /dev/null; then echo "  OK  curatenie: DROP ROLE IF EXISTS $r (lipsea inainte)"; else echo "  NU  curatenie: DROP ROLE $r a esuat (de sters manual)"; cod=1; fi
  done
  rm -rf "$D"
  if [ "$cod" = 0 ] && [ "$esec" != 0 ]; then cod=1; fi
  exit "$cod"
}
trap curatenie EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ok() { if [ "$1" = 0 ]; then echo "  OK  $2"; else echo "  NU  $2"; esec=$((esec + 1)); fi; }
astept() { if [ "$2" = "$1" ]; then echo "  OK  $3 → $2"; else echo "  NU  $3 → $2 (astepta $1)"; esec=$((esec + 1)); fi; }
q() { psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tAc "$1"; }
UID_ED=00000000-0000-0000-0000-0000000b0001
CA_ED="SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '$UID_ED', true);"
# inserarea ecranului (forma PostgREST: o instrucțiune, rolul authenticated + claim-ul); $1 = cheia, $2 = sufixul (ON CONFLICT … sau gol)
ins() { printf "INSERT INTO public.magazie_echipamente (denumire, categorie, um, cantitate_total, stare, observatii, referinta_intentie, created_by) VALUES ('Cheie', 'scule', 'buc', 5, 'functional', 'Intrare initiala 5 buc · ref %s', '%s', auth.uid()) %s" "${1:0:8}" "$1" "$2"; }
OC='ON CONFLICT (referinta_intentie) DO NOTHING'
nr() { q "SELECT count(*) FROM public.magazie_echipamente WHERE referinta_intentie = '$1'"; }

A_FD_IN=''; A_FD_OUT=''; A_PID_C=''
deschideA() {
  coproc A { psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f - 2>&1 1>"$A_OUT"; }
  A_FD_IN="${A[1]}"; A_FD_OUT="${A[0]}"; A_PID_C="$A_PID"; A_DESCHIS=1
}
asteaptaA() {
  local marcaj="$1" linie
  A_STARE=''
  while IFS= read -r -t 60 -u "$A_FD_OUT" linie; do
    printf '%s\n' "$linie" >> "$A_ERR"
    case "$linie" in "$marcaj "*) A_STARE="${linie#"$marcaj" }"; return 0;; esac
  done
  echo "  NU  sesiunea A nu a confirmat pasul $marcaj"; esec=$((esec + 1)); A_STARE='FARA_RASPUNS'; return 1
}
pasA() { local marcaj="$1"; shift; printf '%s\n' "$@" "\\warn $marcaj :SQLSTATE" >&"$A_FD_IN"; asteaptaA "$marcaj"; }
inchideA() {
  local linie c=1
  { printf '%s\n' '\q' >&"$A_FD_IN"; } 2>/dev/null || true
  while IFS= read -r -t 60 -u "$A_FD_OUT" linie 2>/dev/null; do printf '%s\n' "$linie" >> "$A_ERR"; done
  wait "$A_PID_C" 2>/dev/null; c=$?
  [ "$c" = 127 ] && c=0
  A_DESCHIS=0
  return "$c"
}
# B: psql separat, sincron; B_STARE = SQLSTATE-ul instrucțiunii marcate, B_RANDURI = rândurile inserate de ea (din RETURNING numărat)
ruleazaB() {
  local marcaj="$1"
  B_IESIRE="$(psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f - 2>&1)"
  printf '── B %s ──\n%s\n' "$marcaj" "$B_IESIRE" >> "$B_LOG"
  B_STARE="$(printf '%s\n' "$B_IESIRE" | sed -n "s/^$marcaj //p" | tail -n 1)"
  [ -n "$B_STARE" ] || B_STARE='FARA_MARCAJ'
}
inserareB() {   # <marcaj> <cheie> <sufix> [lock_timeout]
  ruleazaB "$1" <<EOF
${4:+SET lock_timeout = '$4';}
BEGIN;
$CA_ED
$(ins "$2" "$3");
\echo $1 :SQLSTATE :ROW_COUNT
COMMIT;
EOF
  B_RANDURI="${B_STARE#* }"; B_STARE="${B_STARE%% *}"
}

echo "0. baza de unica folosinta: scheletul + DDL-ul migrarii (sectiunile 1-2)"
EXISTENTE=" $("${PSM[@]}" -tAc "SELECT string_agg(rolname, ' ') FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'supabase_auth_admin')") "
for r in "${ROLURI[@]}"; do case "$EXISTENTE" in *" $r "*) ;; *) ROLURI_CREATE+=("$r");; esac; done
echo "     roluri de cluster create (si sterse la final): ${ROLURI_CREATE[*]:-niciunul}"
if "${PSM[@]}" -c "CREATE DATABASE \"$BAZA\"" > /dev/null; then BAZA_CREATA=1; ok 0 "CREATE DATABASE $BAZA"; else echo "refuz: CREATE DATABASE $BAZA a esuat" >&2; exit 2; fi
tr -d '\r' < "$MIG" | sed -n '/^-- ─── 1\. /,/^-- ─── 3\. /p' > "$DDL"
grep -q 'ADD CONSTRAINT magazie_echipamente_referinta_intentie_key UNIQUE (referinta_intentie);' "$DDL" && grep -q '^CREATE TRIGGER trg_magazie_referinta_intentie' "$DDL"
ok $? "DDL-ul extras din migrare (UNIQUE + trigger prezente)"
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f <(tr -d '\r' < "$SCHELET") > /dev/null; ok $? "scheletul"
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f "$DDL" > /dev/null; ok $? "DDL-ul migrarii"

K1=11111111-1111-4111-8111-111111111111; K2=22222222-2222-4222-8222-222222222222; K3=33333333-3333-4333-8333-333333333333; K4=44444444-4444-4444-8444-444444444444
deschideA
pasA A0 "SET lock_timeout = '5s';"; astept 00000 "$A_STARE" "A: sesiunea deschisa"

echo "C1. cererea intarziata se comite; retrimiterea concurenta asteapta, apoi nu mai scrie nimic"
pasA C1a "BEGIN;" "$CA_ED" "$(ins "$K1" "$OC");"; astept 00000 "$A_STARE" "A: inserarea K1 (necomisa)"
inserareB C1b "$K1" "$OC" 1s; astept 55P03 "$B_STARE" "B: retrimiterea K1 cat A e deschisa (asteapta tranzactia lui A)"
pasA C1c "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
inserareB C1d "$K1" "$OC"; astept 00000 "$B_STARE" "B: retrimiterea K1 dupa COMMIT"; astept 0 "$B_RANDURI" "B: randuri inserate"
astept 1 "$(nr "$K1")" "randuri cu K1"

echo "C2. cererea intarziata esueaza (ROLLBACK); retrimiterea scrie"
pasA C2a "BEGIN;" "$CA_ED" "$(ins "$K2" "$OC");"; astept 00000 "$A_STARE" "A: inserarea K2 (necomisa)"
inserareB C2b "$K2" "$OC" 1s; astept 55P03 "$B_STARE" "B: retrimiterea K2 cat A e deschisa"
pasA C2c "ROLLBACK;"; astept 00000 "$A_STARE" "A: ROLLBACK"
inserareB C2d "$K2" "$OC"; astept 00000 "$B_STARE" "B: retrimiterea K2 dupa ROLLBACK"; astept 1 "$B_RANDURI" "B: randuri inserate"
astept 1 "$(nr "$K2")" "randuri cu K2"

echo "C3. clientul cu INSERT simplu: asteapta, apoi 23505"
pasA C3a "BEGIN;" "$CA_ED" "$(ins "$K3" "$OC");"; astept 00000 "$A_STARE" "A: inserarea K3 (necomisa)"
inserareB C3b "$K3" "" 1s; astept 55P03 "$B_STARE" "B: INSERT simplu K3 cat A e deschisa"
pasA C3c "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
inserareB C3d "$K3" ""; astept 23505 "$B_STARE" "B: INSERT simplu K3 dupa COMMIT"
astept 1 "$(nr "$K3")" "randuri cu K3"

echo "C4. ordinea inversa: retrimiterea comisa intai, cererea intarziata soseste dupa"
inserareB C4a "$K4" "$OC"; astept 00000 "$B_STARE" "B: retrimiterea K4"; astept 1 "$B_RANDURI" "B: randuri inserate"
# (\warn pe stderr, nebufferizat: linia ajunge în jurnalul A înaintea marcajului)
pasA C4b "BEGIN;" "$CA_ED" "$(ins "$K4" "$OC");" "\\warn A_RANDURI :ROW_COUNT"; astept 00000 "$A_STARE" "A: cererea intarziata K4"
grep -q '^A_RANDURI 0$' "$A_ERR"; ok $? "A: cererea intarziata K4 a inserat 0 randuri"
pasA C4c "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
astept 1 "$(nr "$K4")" "randuri cu K4"

inchideA; ok $? "sesiunea A inchisa curat"
astept 0 "$(q "SELECT count(*) FROM (SELECT referinta_intentie FROM public.magazie_echipamente WHERE referinta_intentie IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d")" "nicio referinta dublata in tabel"
[ "$esec" = 0 ] && echo "TOTUL OK" || echo "ESEC: $esec"
