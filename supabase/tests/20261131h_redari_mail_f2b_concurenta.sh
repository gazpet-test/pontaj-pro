#!/usr/bin/env bash
# Proba de CONCURENȚĂ a migrării 20261131h (Redări e-mail F2b; Jakarinos #1134 r1 P1 / r2 P2): DOUĂ sesiuni psql REALE, cu barieră explicită,
# pe un cluster PostgreSQL ≥ 17 COMPLET DISPENSABIL. PGlite (o singură conexiune) nu poate proba asta; aici se vede lock-ul FOR SHARE al proiectului
# din fn_red_mail_rezerva / fn_red_mail_apel_incepe față de UPDATE-ul lui red_proiecte.cod (ambele sensuri: TEST → real și real → TEST), și triggerul
# trg_red_proiect_cod_test după COMMIT. Nu probează lanțul FAN (contractul FAN al migrării e parțial — antetul migrării).
#
# CE ATINGE (exact):
#   * BAZA: creează baza <nume_baza_noua> (refuză dacă există deja) și o ȘTERGE la final (DROP DATABASE … WITH (FORCE)), inclusiv la întrerupere
#     (trap EXIT / INT / TERM). Nu se conectează la nicio altă bază decât `postgres` (pentru CREATE / DROP) și baza nouă.
#   * ROLURI la nivel de CLUSTER: fixture-ul (supabase/tests/20261131h_redari_mail_f2b_schelet.sql, prin --scrie-fixture) creează, DOAR dacă lipsesc,
#     rolurile anon, authenticated, service_role (BYPASSRLS), supabase_auth_admin, supabase_storage_admin. Scriptul notează ÎNAINTE care lipsesc și
#     le ȘTERGE la final (DROP ROLE) pe cele create de el; rolurile preexistente nu sunt atinse. De aceea rulează DOAR cu F2B_CLUSTER_DISPENSABIL=da:
#     NU pe clona de producție, NU pe un cluster folosit la altceva.
#   * FIȘIERE: un folder temporar (mktemp -d) cu fixture-ul generat și jurnalele sesiunilor; șters la final (la eșec, cozile jurnalelor se afișează
#     înainte de ștergere).
#   * REȚEA: doar conexiunile psql la cluster (PGHOST / PGPORT / PGUSER / PGPASSWORD sau pgpass). NICIUN apel către Google, FAN, Supabase.
# CE NU FACE: nu testează clona completă (schema de producție). Regresiile pe clonă — manifestul L15, aplicare → revenire → reaplicare, suitele F1 / F2 /
#   FAN existente rulate după migrare, interacțiunea cu triggerele de pe live care lipsesc din fixture (trg_red_autorizare_tgz, 20261130m) — sunt pașii
#   SEPARAȚI ai coordonatorului (docs/redari/MAIL_PROBA_PASI.md §3, pasul 1b), nu ai acestui script.
#
# CUM SE RULEAZĂ (coordonatorul; cere: bash ≥ 4 (coproc), psql ≥ 13 (\warn există din psql 13; recomandat clientul 17, ca serverul) în PATH, conectare ca superuser `postgres` (migrarea cere
#   current_user = postgres; rolurile BYPASSRLS cer superuser), node cu PGlite instalat la rădăcina repo-ului + python3 (pașii 0 / 0b ai probei PGlite,
#   care generează fixture-ul)):
#     F2B_CLUSTER_DISPENSABIL=da PGHOST=… PGPORT=… PGUSER=postgres PGPASSWORD=… bash supabase/tests/20261131h_redari_mail_f2b_concurenta.sh <nume_baza_noua>
#   Ieșire: 0 = TOATE așteptările se țin și curățenia a reușit; 1 = cel puțin o așteptare nu se ține (sau curățenia a eșuat); 2 = refuz / folosire greșită
#   (variabila lipsă, baza există, versiune de server / client prea veche, nu e postgres superuser).
#
# BARIERA între sesiuni (fără sleep): sesiunea A este un psql ținut deschis (coproc) căruia scriptul îi trimite instrucțiunile una câte una; după fiecare
#   instrucțiune, A scrie pe stderr (nebufferizat) un marcaj `\warn <PAS> :SQLSTATE`, iar scriptul BLOCHEAZĂ (read) până îl primește: marcajul dovedește
#   că instrucțiunea s-a terminat, deci lock-urile ei sunt ținute (se verifică și în pg_locks: RowShareLock pe red_proiecte al backend-ului A). Abia apoi
#   pornește sesiunea B (un psql separat, sincron), care încearcă operația concurentă cu lock_timeout = 1 s: B se termină cu SQLSTATE 55P03
#   (lock_not_available — a așteptat lock-ul lui A, singura altă sesiune), scriptul așteaptă terminarea procesului B, îi spune lui A COMMIT (marcaj),
#   apoi repetă încercarea lui B fără concurent. SQLSTATE-urile promise se citesc din psql (:SQLSTATE), NU din textele erorilor; la P0001 (RAISE EXCEPTION
#   generic) se verifică ÎN PLUS mesajul triggerului, pentru că P0001 singur nu deosebește refuzul triggerului de alt RAISE din plpgsql.
#   Singurele timpuri din script: lock_timeout 1 s (mecanismul așteptat al refuzului sub lock) și plasa de siguranță read -t 60 (dacă A moare).
#
# SCENARII (așteptările scrise de mână, independent de cod; conturile și id-urile = cele din fixture-ul probei PGlite):
#   S0  ÎNAINTE de migrare: owner-ul poate redenumi TEST-MAIL → LOT-MAIL și înapoi cu lotul aprobat (00000) — gaura pe care o închide migrarea.
#   S1  TEST → real concurent cu rezervarea: A: BEGIN; rezerva(lot TEST) — ține proiectul FOR SHARE.  B (owner, JWT): UPDATE cod TEST-MAIL → LOT-MAIL,
#       lock_timeout 1 s → 55P03.  A: COMMIT (00000; un mesaj rezervat, lotul in_trimitere).  B din nou, fără concurent → P0001 + mesajul triggerului
#       (lot neîncheiat / mesaj rezervat); codul rămâne TEST-MAIL. Admin (JWT) → 42501. Redenumirea în aceeași categorie (TEST-MAIL → TEST-MAIL-2 →
#       TEST-MAIL) trece în timpul trimiterii (00000).
#   S2  real → TEST concurent cu rezervarea (sensul invers): A: BEGIN; rezerva(lot LOT1-REAL) — întoarce 0 rânduri (doar_proiecte_test) DAR ține
#       proiectul FOR SHARE până la COMMIT.  B (owner): UPDATE cod LOT1-REAL → TEST-REAL, lock_timeout 1 s → 55P03.  A: COMMIT.  B din nou → P0001 +
#       mesajul triggerului (lotul aprobat = neîncheiat); codul rămâne LOT1-REAL. Admin → 42501.
#   S3  UPDATE pe rândul proiectului concurent cu autorizarea apelului: A: BEGIN; UPDATE red_proiecte SET denumire (ține rândul).  B (owner):
#       apel_incepe(mesaj, token) cu lock_timeout 1 s → 55P03 (FOR SHARE așteaptă UPDATE-ul); mesajul rămâne `rezervat` (nicio autorizare sub lock).
#       A: COMMIT.  B din nou → true (mesajul in_apel); cu mesajul in_apel, TEST → real → P0001. Rezultatul `trimis` persistat (fn_red_mail_rezultat → true).
#   S4  Lotul TEST încheiat (mesajele rămase anulate): owner TEST-MAIL → LOT-MAIL trece (00000); rezerva pe lotul „test-mic” (minuscule = real) → 0 rânduri;
#       admin LOT-MAIL → TEST-MAIL → 42501; owner → trece.
set -u
set -o pipefail

if [ "${F2B_CLUSTER_DISPENSABIL:-}" != "da" ]; then
  echo "refuz: scriptul creeaza / sterge o baza si poate crea roluri la nivel de CLUSTER; ruleaza-l DOAR pe un cluster complet dispensabil, cu F2B_CLUSTER_DISPENSABIL=da" >&2
  exit 2
fi
if [ $# -ne 1 ] || ! [[ "$1" =~ ^[a-z][a-z0-9_]{2,40}$ ]]; then echo "folosire: F2B_CLUSTER_DISPENSABIL=da $0 <nume_baza_noua (a-z0-9_)>" >&2; exit 2; fi
BAZA="$1"
RADACINA="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$RADACINA/supabase/migrations/20261131h_redari_mail_f2b_trimitere.sql"
[ -r "$MIG" ] || { echo "migrarea lipseste: $MIG" >&2; exit 2; }

# ── precondiții pe cluster (nimic creat încă) ──
PSM=(psql -X -q -w -v ON_ERROR_STOP=1 -d postgres)
VERS_CLIENT="$(psql --version 2>/dev/null | sed -n 's/^psql (PostgreSQL) \([0-9]*\).*/\1/p')"
if [ -z "$VERS_CLIENT" ] || [ "$VERS_CLIENT" -lt 13 ]; then echo "refuz: psql >= 13 (\\warn exista din psql 13); gasit: $(psql --version 2>&1)" >&2; exit 2; fi
PRE="$("${PSM[@]}" -tAc "SELECT current_setting('server_version_num')::int >= 170000, current_user = 'postgres', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), EXISTS (SELECT 1 FROM pg_database WHERE datname = '$BAZA')")" || { echo "refuz: nu ma pot conecta la baza postgres (PGHOST / PGPORT / PGUSER / PGPASSWORD)" >&2; exit 2; }
case "$PRE" in
  t\|t\|t\|f) ;;
  f\|*) echo "refuz: serverul nu e PostgreSQL >= 17 (migrarea cere transaction_timeout): $("${PSM[@]}" -tAc 'SHOW server_version')" >&2; exit 2;;
  t\|f\|*) echo "refuz: migrarea cere current_user = postgres (acum: $("${PSM[@]}" -tAc 'SELECT current_user'))" >&2; exit 2;;
  t\|t\|f\|*) echo "refuz: rolul postgres nu e superuser aici (rolurile BYPASSRLS ale fixture-ului cer superuser)" >&2; exit 2;;
  t\|t\|t\|t) echo "refuz: baza $BAZA exista deja (aleg alt nume; nu sterg nimic existent)" >&2; exit 2;;
  *) echo "refuz: raspuns neasteptat la preconditii: $PRE" >&2; exit 2;;
esac

# ── curățenia (în trap: și la întrerupere) ──
D="$(mktemp -d -t f2b_concurenta_XXXXXX)"
FIX="$D/fixture.sql"; A_OUT="$D/A.stdout.log"; A_ERR="$D/A.stderr.log"; B_LOG="$D/B.log"
: > "$A_ERR"; : > "$B_LOG"
BAZA_CREATA=0; A_DESCHIS=0; esec=0
ROLURI=(anon authenticated service_role supabase_auth_admin supabase_storage_admin)
ROLURI_CREATE=()
curatenie() {
  local cod=$?
  trap - EXIT INT TERM
  if [ "$cod" != 0 ] || [ "$esec" != 0 ]; then
    echo "── jurnalul sesiunii A (stderr, ultimele 40 de linii) ──"; tail -n 40 "$A_ERR" 2>/dev/null
    echo "── jurnalul sesiunii A (stdout, ultimele 20 de linii) ──"; tail -n 20 "$A_OUT" 2>/dev/null
    echo "── jurnalul sesiunilor B (ultimele 40 de linii) ──"; tail -n 40 "$B_LOG" 2>/dev/null
  fi
  if [ "$A_DESCHIS" = 1 ]; then
    { printf '%s\n' 'ROLLBACK;' '\q' >&"$A_FD_IN"; } 2>/dev/null || true
    wait "$A_PID_C" 2>/dev/null || true
    A_DESCHIS=0
  fi
  if [ "$BAZA_CREATA" = 1 ]; then
    if "${PSM[@]}" -c "DROP DATABASE \"$BAZA\" WITH (FORCE)" > /dev/null; then echo "  OK  curatenie: DROP DATABASE $BAZA"; else echo "  NU  curatenie: DROP DATABASE $BAZA a esuat (de sters manual)"; cod=1; fi
  fi
  local r
  for r in ${ROLURI_CREATE[@]+"${ROLURI_CREATE[@]}"}; do
    if "${PSM[@]}" -c "DROP ROLE IF EXISTS \"$r\"" > /dev/null; then echo "  OK  curatenie: DROP ROLE IF EXISTS $r (lipsea inainte; creat de fixture)"; else echo "  NU  curatenie: DROP ROLE $r a esuat (de sters manual)"; cod=1; fi
  done
  rm -rf "$D"
  if [ "$cod" = 0 ] && [ "$esec" != 0 ]; then cod=1; fi
  exit "$cod"
}
trap curatenie EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ok() { if [ "$1" = 0 ]; then echo "  OK  $2"; else echo "  NU  $2"; esec=$((esec + 1)); fi; }          # $1 = cod de ieșire (0 = bine)
okt() { if [ "$1" = 1 ]; then echo "  OK  $2"; else echo "  NU  $2 (valoare: $1)"; esec=$((esec + 1)); fi; }   # $1 = rezultatul unui SELECT boolean::int
# aștept <SQLSTATE_asteptat> <SQLSTATE_primit> <descriere>
astept() { if [ "$2" = "$1" ]; then echo "  OK  $3 → $2"; else echo "  NU  $3 → $2 (astepta $1)"; esec=$((esec + 1)); fi; }
PS="psql -X -q -w -v ON_ERROR_STOP=1 -d $BAZA"
q() { $PS -tAc "$1"; }   # o interogare, valoarea brută

# conturile / id-urile din fixture (aceleași ca în proba PGlite)
OWNER=00000000-0000-0000-0000-0000000000a1; ADMIN=00000000-0000-0000-0000-0000000000a2
P_TEST=00000000-0000-0000-0000-00000000b001; P_REAL=00000000-0000-0000-0000-00000000b002
LOT_TEST=00000000-0000-0000-0000-0000000a0001; LOT_REAL=00000000-0000-0000-0000-0000000a0002; LOT_MIC=00000000-0000-0000-0000-0000000a0003
# contextul unui apel ca utilizator cu JWT (în tranzacția curentă): SET LOCAL ROLE authenticated + ambele surse ale lui auth.uid()
jwt() { printf "SET LOCAL ROLE authenticated;\nSELECT set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true);\nSELECT set_config('request.jwt.claim.sub', '%s', true);" "$1" "$1"; }
SVC="SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);"
MESAJ_TRIGGER_MAIL='categoria codului (TEST- / real) nu se schimba cat proiectul are loturi de e-mail neincheiate sau mesaje rezervate / in apel'
MESAJ_TRIGGER_OWNER='categoria codului (TEST- / real) o schimba doar owner-ul'

# ── sesiunea A: psql ținut deschis (coproc); stdout → fișier, stderr (marcaje + erori) → pipe-ul coproc-ului. Descriptorii și pid-ul se copiază
#    imediat: bash dezalocă variabilele coproc-ului (A, A_PID) când procesul se termină, iar set -u ar opri scriptul la o referință ulterioară ──
A_FD_IN=''; A_FD_OUT=''; A_PID_C=''
deschideA() {
  coproc A { psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f - 2>&1 1>"$A_OUT"; }
  A_FD_IN="${A[1]}"; A_FD_OUT="${A[0]}"; A_PID_C="$A_PID"; A_DESCHIS=1
}
# asteaptaA <marcaj>: blochează până când A scrie linia „<marcaj> <SQLSTATE>”; A_STARE = SQLSTATE-ul; tot ce vine între timp se scrie în jurnal
asteaptaA() {
  local marcaj="$1" linie
  A_STARE=''
  while IFS= read -r -t 60 -u "$A_FD_OUT" linie; do
    printf '%s\n' "$linie" >> "$A_ERR"
    case "$linie" in "$marcaj "*) A_STARE="${linie#"$marcaj" }"; return 0;; esac
  done
  echo "  NU  sesiunea A nu a confirmat pasul $marcaj (60 s sau sesiune inchisa)"; esec=$((esec + 1)); A_STARE='FARA_RASPUNS'; return 1
}
# pasA <marcaj> <linie SQL>...: trimite liniile, apoi marcajul; așteaptă confirmarea; A_STARE = SQLSTATE-ul ULTIMEI instrucțiuni trimise
pasA() {
  local marcaj="$1"; shift
  printf '%s\n' "$@" "\\warn $marcaj :SQLSTATE" >&"$A_FD_IN"
  asteaptaA "$marcaj"
}
# pasAval <marcaj> <SQL cu o singură coloană `val`, FĂRĂ `;`>: ca pasA, dar A_VAL = valoarea (prin \gset, care ține locul terminatorului)
pasAval() {
  local marcaj="$1" sql="$2"
  printf '%s\n' "$sql \\gset v_" "\\warn $marcaj :SQLSTATE :v_val" >&"$A_FD_IN"
  asteaptaA "$marcaj"
  A_VAL="${A_STARE#* }"; A_STARE="${A_STARE%% *}"
}
# inchideA: \q, apoi se citește ce a mai rămas până la EOF (0 = sesiunea s-a închis singură, fără erori de protocol)
inchideA() {
  local linie c=1
  { printf '%s\n' '\q' >&"$A_FD_IN"; } 2>/dev/null || true
  while IFS= read -r -t 60 -u "$A_FD_OUT" linie 2>/dev/null; do printf '%s\n' "$linie" >> "$A_ERR"; done
  wait "$A_PID_C" 2>/dev/null; c=$?
  [ "$c" = 127 ] && c=0   # bash a cules deja procesul (coproc terminat): nu mai avem codul lui; EOF-ul de mai sus dovedește închiderea
  A_DESCHIS=0
  return "$c"
}

# ── sesiunea B: un psql SEPARAT, sincron (comanda se termină = B s-a terminat), ON_ERROR_STOP=0 (erorile sunt așteptate);
#    scriptul SQL vine pe stdin și raportează SQLSTATE-ul instrucțiunii marcate prin „\echo <MARCAJ> :SQLSTATE”; B_STARE = codul, B_IESIRE = tot ──
ruleazaB() {
  local marcaj="$1"
  B_IESIRE="$(psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f - 2>&1)"
  printf '── B %s ──\n%s\n' "$marcaj" "$B_IESIRE" >> "$B_LOG"
  B_STARE="$(printf '%s\n' "$B_IESIRE" | sed -n "s/^$marcaj //p" | tail -n 1)"
  [ -n "$B_STARE" ] || B_STARE='FARA_MARCAJ'
}
# redenumireB <cine: OWNER|ADMIN> <proiect> <cod nou> <marcaj> [lock_timeout]: UPDATE-ul codului ca utilizator cu JWT, într-o tranzacție proprie
redenumireB() {
  local cine="$1" proiect="$2" cod="$3" marcaj="$4" lt="${5:-}"
  ruleazaB "$marcaj" <<EOF
${lt:+SET lock_timeout = '$lt';}
BEGIN;
$(jwt "$cine")
UPDATE public.red_proiecte SET cod = '$cod' WHERE id = '$proiect';
\echo $marcaj :SQLSTATE
COMMIT;
EOF
}
mesajTrigger() { printf '%s\n' "$B_IESIRE" | grep -qF "$1"; }

echo "0. baza de unica folosinta + fixture-ul (schelet + functiile reale + date + loturi)"
EXISTENTE=" $("${PSM[@]}" -tAc "SELECT string_agg(rolname, ' ') FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'supabase_storage_admin')") "
for r in "${ROLURI[@]}"; do case "$EXISTENTE" in *" $r "*) ;; *) ROLURI_CREATE+=("$r");; esac; done
echo "     roluri de cluster pe care fixture-ul le va crea (si scriptul le va sterge): ${ROLURI_CREATE[*]:-niciunul (toate exista deja; nu vor fi atinse)}"
if "${PSM[@]}" -c "CREATE DATABASE \"$BAZA\"" > /dev/null; then BAZA_CREATA=1; ok 0 "CREATE DATABASE $BAZA"; else echo "refuz: CREATE DATABASE $BAZA a esuat (exista deja sau alta eroare); nu se continua si nu se sterge nimic" >&2; exit 2; fi
node "$RADACINA/scripts/pglite/test_redari_mail_f2b_local.mjs" --scrie-fixture "$FIX" > "$D/fixture.log" 2>&1; ok $? "fixture-ul scris de proba PGlite (--scrie-fixture: pasii 0 / 0b + scriere, fara proba in memorie)"
[ -s "$FIX" ] || { echo "fixture-ul lipseste: $(tail -n 5 "$D/fixture.log")" >&2; exit 1; }
$PS -f - < "$FIX" > /dev/null; ok $? "fixture-ul incarcat"
okt "$(q "SELECT (count(*) = 5)::int FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'supabase_storage_admin')")" "cele 5 roluri ale fixture-ului exista"

echo "S0. INAINTE de migrare: owner-ul poate schimba categoria cu lotul aprobat (gaura pe care o inchide migrarea)"
redenumireB "$OWNER" "$P_TEST" 'LOT-MAIL' S0A; astept 00000 "$B_STARE" "owner: TEST-MAIL → LOT-MAIL inainte de migrare"
okt "$(q "SELECT (cod = 'LOT-MAIL')::int FROM public.red_proiecte WHERE id = '$P_TEST'")" "codul s-a schimbat (fara trigger)"
redenumireB "$OWNER" "$P_TEST" 'TEST-MAIL' S0B; astept 00000 "$B_STARE" "owner: inapoi la TEST-MAIL"

echo "1. aplicarea migrarii cu marcajele runnerului (plafon 5000; tabelul temporar L15 pus de mana — amprenta globala e proba PGlite / clonei)"
{
  printf '%s\n' 'SET transaction_timeout = 5000;' 'BEGIN ISOLATION LEVEL READ COMMITTED;' \
    "SELECT set_config('gazpet.livrare_migrare', '20261131h_redari_mail_f2b_trimitere:' || txid_current(), true);" \
    "SELECT set_config('gazpet.plafon_tranzactie', '5000:' || txid_current(), true);" \
    'CREATE TEMP TABLE ag_ina_0123456789abcdef (familie text, eticheta text, amprenta text, detaliu text) ON COMMIT PRESERVE ROWS;'
  cat "$MIG"
  printf '\n%s\n' 'COMMIT;'
} | $PS -f - > "$D/migrare.log" 2>&1; ok $? "migrarea 20261131h aplicata (jurnal: migrare.log)"
okt "$(q "SELECT (count(*) = 1)::int FROM pg_trigger WHERE tgrelid = 'public.red_proiecte'::regclass AND tgname = 'trg_red_proiect_cod_test'")" "triggerul trg_red_proiect_cod_test exista"

echo "2. conectarea casutei (RPC service_role) + pornirea trimiterii (owner)"
$PS -c "BEGIN; $SVC SELECT public.fn_red_mail_secret_seteaza('REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN', 'rt-proba', '$OWNER', 'redari@gazpet.ro'); COMMIT;" > /dev/null; ok $? "casuta conectata"
$PS -c "BEGIN; $(jwt "$OWNER") SELECT public.fn_red_mail_f2_setari(false, false, (SELECT versiune FROM public.red_mail_setari WHERE id = 1)); COMMIT;" > /dev/null; ok $? "trimiterea pornita"
okt "$(q "SELECT (public.fn_red_mail_f2_poate(l) IS NULL)::int FROM public.red_mail_loturi l WHERE l.id = '$LOT_TEST'")" "lotul TEST poate trimite (f2_poate = NULL)"
okt "$(q "SELECT (public.fn_red_mail_f2_poate(l) = 'doar_proiecte_test')::int FROM public.red_mail_loturi l WHERE l.id = '$LOT_REAL'")" "lotul proiectului real nu poate (doar_proiecte_test)"

echo "S1. TEST → real concurent cu rezervarea: A tine proiectul FOR SHARE; B (owner) → 55P03; dupa COMMIT-ul lui A → P0001 (trigger)"
deschideA
pasAval A_PID 'SELECT pg_backend_pid() AS val'; astept 00000 "$A_STARE" "A: sesiune deschisa (backend $A_VAL)"; A_BACKEND="$A_VAL"
[[ "$A_BACKEND" =~ ^[0-9]+$ ]]; ok $? "pid-ul backend-ului A e numeric ($A_BACKEND)"
pasA A_S1_BEGIN 'BEGIN;' "$(jwt "$OWNER")"; astept 00000 "$A_STARE" "A: BEGIN + JWT owner"
pasA A_S1_REZERVA "SELECT id FROM public.fn_red_mail_rezerva('$LOT_TEST');"; astept 00000 "$A_STARE" "A: rezerva(lot TEST) a reusit; tranzactia ramane deschisa"
okt "$(q "SELECT (count(*) = 1)::int FROM pg_locks WHERE pid = $A_BACKEND AND relation = 'public.red_proiecte'::regclass AND mode = 'RowShareLock' AND granted")" "A tine RowShareLock pe red_proiecte (FOR SHARE pe proiect) la momentul barierei"
redenumireB "$OWNER" "$P_TEST" 'LOT-MAIL' S1B1 1s; astept 55P03 "$B_STARE" "B in timpul lui A: owner TEST-MAIL → LOT-MAIL a asteptat lock-ul proiectului si a picat la lock_timeout"
okt "$(q "SELECT (count(*) = 1)::int FROM pg_locks WHERE pid = $A_BACKEND AND relation = 'public.red_proiecte'::regclass AND mode = 'RowShareLock' AND granted")" "A tine inca lock-ul dupa esecul lui B"
pasA A_S1_COMMIT 'COMMIT;'; astept 00000 "$A_STARE" "A: COMMIT"
okt "$(q "SELECT (cod = 'TEST-MAIL')::int FROM public.red_proiecte WHERE id = '$P_TEST'")" "codul a ramas TEST-MAIL"
okt "$(q "SELECT (count(*) = 1)::int FROM public.red_mail_mesaje WHERE lot_id = '$LOT_TEST' AND stare = 'rezervat'")" "un mesaj rezervat"
okt "$(q "SELECT (stare = 'in_trimitere')::int FROM public.red_mail_loturi WHERE id = '$LOT_TEST'")" "lotul e in_trimitere"
redenumireB "$OWNER" "$P_TEST" 'LOT-MAIL' S1B2; astept P0001 "$B_STARE" "B dupa COMMIT-ul lui A, fara concurent: owner TEST-MAIL → LOT-MAIL refuzat de trigger"
mesajTrigger "$MESAJ_TRIGGER_MAIL"; ok $? "   … cu mesajul triggerului (lot neincheiat / mesaj rezervat), nu alt P0001"
okt "$(q "SELECT (cod = 'TEST-MAIL')::int FROM public.red_proiecte WHERE id = '$P_TEST'")" "codul a ramas TEST-MAIL"
redenumireB "$ADMIN" "$P_TEST" 'LOT-MAIL' S1B3; astept 42501 "$B_STARE" "admin (JWT): schimbarea categoriei refuzata (doar owner-ul)"
mesajTrigger "$MESAJ_TRIGGER_OWNER"; ok $? "   … cu mesajul triggerului (doar owner-ul)"
redenumireB "$OWNER" "$P_TEST" 'TEST-MAIL-2' S1B4; astept 00000 "$B_STARE" "owner: TEST-MAIL → TEST-MAIL-2 (aceeasi categorie) trece in timpul trimiterii"
redenumireB "$OWNER" "$P_TEST" 'TEST-MAIL' S1B5; astept 00000 "$B_STARE" "owner: inapoi la TEST-MAIL"

echo "S2. real → TEST concurent cu rezervarea (sensul invers): A rezerva pe lotul proiectului real (0 randuri, dar proiectul FOR SHARE); B (owner) → 55P03; dupa COMMIT → P0001"
pasA A_S2_BEGIN 'BEGIN;' "$(jwt "$OWNER")"; astept 00000 "$A_STARE" "A: BEGIN + JWT owner"
pasAval A_S2_REZERVA "SELECT count(*) AS val FROM public.fn_red_mail_rezerva('$LOT_REAL')"; astept 00000 "$A_STARE" "A: rezerva(lot LOT1-REAL) a rulat"
[ "$A_VAL" = 0 ]; ok $? "A: rezerva a intors 0 randuri (doar_proiecte_test), a intors: $A_VAL"
okt "$(q "SELECT (count(*) = 1)::int FROM pg_locks WHERE pid = $A_BACKEND AND relation = 'public.red_proiecte'::regclass AND mode = 'RowShareLock' AND granted")" "A tine RowShareLock pe red_proiecte si cand refuza lotul (lock-ul e luat INAINTEA deciziei)"
redenumireB "$OWNER" "$P_REAL" 'TEST-REAL' S2B1 1s; astept 55P03 "$B_STARE" "B in timpul lui A: owner LOT1-REAL → TEST-REAL a asteptat lock-ul proiectului si a picat la lock_timeout"
pasA A_S2_COMMIT 'COMMIT;'; astept 00000 "$A_STARE" "A: COMMIT"
okt "$(q "SELECT (cod = 'LOT1-REAL')::int FROM public.red_proiecte WHERE id = '$P_REAL'")" "codul a ramas LOT1-REAL"
redenumireB "$OWNER" "$P_REAL" 'TEST-REAL' S2B2; astept P0001 "$B_STARE" "B dupa COMMIT, fara concurent: owner LOT1-REAL → TEST-REAL refuzat de trigger (lot aprobat = neincheiat)"
mesajTrigger "$MESAJ_TRIGGER_MAIL"; ok $? "   … cu mesajul triggerului"
redenumireB "$ADMIN" "$P_REAL" 'TEST-REAL' S2B3; astept 42501 "$B_STARE" "admin: real → TEST- refuzat (doar owner-ul)"
okt "$(q "SELECT (cod = 'LOT1-REAL')::int FROM public.red_proiecte WHERE id = '$P_REAL'")" "codul a ramas LOT1-REAL"

echo "S3. UPDATE pe randul proiectului concurent cu autorizarea apelului: A tine randul (UPDATE denumire); B apel_incepe → 55P03, nimic autorizat; dupa COMMIT → true"
TOKEN="$(q "SELECT lease_token FROM public.red_mail_mesaje WHERE lot_id = '$LOT_TEST' AND stare = 'rezervat'")"
MESAJ="$(q "SELECT id FROM public.red_mail_mesaje WHERE lot_id = '$LOT_TEST' AND stare = 'rezervat'")"
[ -n "$TOKEN" ] && [ -n "$MESAJ" ]; ok $? "mesajul rezervat si lease-ul lui sunt cunoscute"
pasA A_S3_BEGIN 'BEGIN;'; astept 00000 "$A_STARE" "A: BEGIN (mentenanta, fara JWT)"
pasA A_S3_UPDATE "UPDATE public.red_proiecte SET denumire = 'tinut de A' WHERE id = '$P_TEST';"; astept 00000 "$A_STARE" "A: UPDATE denumire (randul proiectului e tinut)"
ruleazaB S3B1 <<EOF
SET lock_timeout = '1s';
BEGIN;
$(jwt "$OWNER")
SELECT public.fn_red_mail_apel_incepe('$MESAJ', '$TOKEN');
\echo S3B1 :SQLSTATE
COMMIT;
EOF
astept 55P03 "$B_STARE" "B in timpul lui A: apel_incepe a asteptat proiectul (FOR SHARE vs UPDATE) si a picat la lock_timeout"
okt "$(q "SELECT (stare = 'rezervat')::int FROM public.red_mail_mesaje WHERE id = '$MESAJ'")" "mesajul a ramas rezervat (nicio autorizare data sub lock)"
pasA A_S3_COMMIT 'COMMIT;'; astept 00000 "$A_STARE" "A: COMMIT"
ruleazaB S3B2 <<EOF
BEGIN;
$(jwt "$OWNER")
SELECT public.fn_red_mail_apel_incepe('$MESAJ', '$TOKEN') AS r \gset
\echo S3B2 :SQLSTATE :r
COMMIT;
EOF
astept '00000 t' "$B_STARE" "B dupa COMMIT-ul lui A: apel_incepe = true"
okt "$(q "SELECT (stare = 'in_apel')::int FROM public.red_mail_mesaje WHERE id = '$MESAJ'")" "mesajul e in_apel"
redenumireB "$OWNER" "$P_TEST" 'LOT-MAIL' S3B3; astept P0001 "$B_STARE" "cu mesajul in_apel (intervalul HTTP): TEST-MAIL → LOT-MAIL refuzat de trigger"
mesajTrigger "$MESAJ_TRIGGER_MAIL"; ok $? "   … cu mesajul triggerului"
ruleazaB S3B4 <<EOF
BEGIN;
$(jwt "$OWNER")
SELECT public.fn_red_mail_rezultat('$MESAJ', '$TOKEN', 'trimis', 'gm1', 'th1') AS r \gset
\echo S3B4 :SQLSTATE :r
COMMIT;
EOF
astept '00000 t' "$B_STARE" "rezultatul trimis persistat (fn_red_mail_rezultat = true)"
okt "$(q "SELECT (stare = 'trimis' AND gmail_id = 'gm1')::int FROM public.red_mail_mesaje WHERE id = '$MESAJ'")" "mesajul e trimis"
inchideA; ok $? "sesiunea A inchisa curat"

echo "S4. lotul incheiat → owner-ul poate schimba categoria; lotul „test-mic” nu poate trimite; adminul nu poate schimba categoria inapoi"
$PS -c "UPDATE public.red_mail_mesaje SET stare = 'anulat', eroare_cod = 'lot_incheiat' WHERE lot_id = '$LOT_TEST' AND stare = 'in_coada'; UPDATE public.red_mail_loturi SET stare = 'incheiat', incheiat_la = now() WHERE id = '$LOT_TEST';" > /dev/null; ok $? "lotul TEST incheiat (mesajele ramase anulate)"
redenumireB "$OWNER" "$P_TEST" 'LOT-MAIL' S4B1; astept 00000 "$B_STARE" "owner: TEST-MAIL → LOT-MAIL dupa incheierea lotului (fara mesaje in zbor)"
okt "$(q "SELECT (public.fn_red_mail_f2_poate(l) = 'doar_proiecte_test')::int FROM public.red_mail_loturi l WHERE l.id = '$LOT_TEST'")" "lotul de pe proiectul devenit real e refuzat de f2_poate (doar_proiecte_test)"
ruleazaB S4B2 <<EOF
BEGIN;
$(jwt "$OWNER")
SELECT count(*) AS n FROM public.fn_red_mail_rezerva('$LOT_MIC') \gset
\echo S4B2 :SQLSTATE :n
COMMIT;
EOF
astept '00000 0' "$B_STARE" "rezerva pe lotul „test-mic” (minuscule = proiect real): 0 randuri"
redenumireB "$ADMIN" "$P_TEST" 'TEST-MAIL' S4B3; astept 42501 "$B_STARE" "admin: LOT-MAIL → TEST-MAIL refuzat (doar owner-ul)"
redenumireB "$OWNER" "$P_TEST" 'TEST-MAIL' S4B4; astept 00000 "$B_STARE" "owner: LOT-MAIL → TEST-MAIL (lotul e incheiat, fara mesaje in zbor)"

if [ "$esec" = 0 ]; then echo "PASS: toate asteptarile se tin (curatenia urmeaza)"; else echo "ESEC: $esec asteptari nu se tin"; fi
exit $(( esec > 0 ))
