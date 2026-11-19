#!/usr/bin/env bash
# Proba pe CLONĂ a migrării 20261131j (Redări, verificarea AI a importului TGZ; r3, verdictul Jakarinos #1141 r2) — partea cu MAI MULTE sesiuni reale.
# Partea cu o sesiune (drept, rezervare, închidere ok / incomplet, RLS ca non-owner / anon / scrieri directe) = 20261131j_redari_import_ai_clona.sql
#   (rulată aici la pasul 1). Ordinea pe clonă: migrarea aplicată prin runner (manifestul L15) → ACEST script → revenirea reală prin runner
#   (--plafon-tranzactie-ms 2000) → reaplicarea → din nou acest script (regresiile) — pașii coordonatorului, vezi raportul r3.
#
# CE ATINGE (exact), DOAR PE CLONĂ (PostgreSQL 17, 20261131j aplicată), cu IMPORT_AI_CLONA=da:
#   * pasul 1: o tranzacție cu date sintetice, terminată cu ROLLBACK (nimic nu rămâne).
#   * pasul 2 (concurența): rânduri SINTETICE în red_import_ai_jurnal, COMISE, pe proiectul de TEST dat (implicit TEST-RAZVAN; codul trebuie să înceapă
#     cu TEST-), cu amprenta de fișier MARCAJ (c1c1…); apelantul = primul profil owner al clonei (doar citit). La final (și la întrerupere: trap) se
#     șterg EXACT rândurile cu MARCAJ de pe proiectul de test (postgres; jurnalul nu are trigger de ștergere) și se verifică numărul de dinainte.
#     Niciun drept nu se acordă cu COMMIT (istoricul drepturilor e append-only: o acordare comisă ar rămâne pentru totdeauna și ar bloca revenirea).
#   * pasul 3 (revenirea refuzată): procese separate, prologul runnerului (plafon 2000 ms + marcajele), un fixture în ACEEAȘI tranzacție (acordare +
#     retragere / o rezervare), revenirea → refuz ISTORIC_NOU; tranzacția nu se comite (nimic nu rămâne).
#   * pasul 4 (doar dacă cele trei tabele noi erau GOALE la pornire): revenirea REUȘITĂ sub plafonul de 2000 ms, apoi ROLLBACK (obiectele rămân) și proba
#     de blocare: o sesiune ține revenirea deschisă (ACCESS EXCLUSIVE pe red_proiecte / profiles), alta citește profiles → așteaptă și e eliberată de
#     plafonul de 2000 ms (prima sesiune e terminată cu 25P04 de PostgreSQL). Cât ține (≤ 2 s), citirile din profiles / red_proiecte ale clonei așteaptă.
#   * REȚEA: doar psql la clonă. NICIUN apel către Anthropic, Supabase, mail.
# Rulare (din rădăcina repo-ului; bash ≥ 4 pentru coproc, psql ≥ 13; conectare ca postgres prin PGHOST / PGPORT / PGUSER / PGDATABASE / pgpass):
#   IMPORT_AI_CLONA=da [IMPORT_AI_CLONA_PROIECT=TEST-RAZVAN] bash supabase/tests/20261131j_redari_import_ai_clona.sh
#   Ieșire: 0 = toate așteptările se țin și curățenia a reușit; 1 = cel puțin una nu se ține; 2 = refuz (variabila lipsă, versiuni, migrarea neaplicată,
#   proiectul de test lipsă / inactiv / cu apeluri AI azi, marcajul deja prezent).
# BARIERA (fără sleep, tiparul din 20261131h_redari_mail_f2b_concurenta.sh): sesiunea A = psql ținut deschis (coproc); după fiecare pas A scrie pe stderr
#   „\warn <PAS> :SQLSTATE”, iar scriptul blochează până la marcaj (lock-urile lui A sunt ținute — verificat și în pg_locks). Abia apoi pornește B (psql
#   separat, sincron, lock_timeout 1 s): B trebuie să se termine cu 55P03 (a așteptat lock-ul lui A), fără să scrie nimic; A COMMIT; B din nou, fără
#   concurent → refuzul plafonului / nou:false. Singurele timpuri: lock_timeout 1 s, plafonul de 2000 ms al revenirii și plasa read -t 60.
set -u
set -o pipefail
trap '' PIPE   # o scriere spre sesiunea A deja terminată (pasul 4: 25P04) = eroare de scriere, nu oprirea scriptului
if [ "${IMPORT_AI_CLONA:-}" != "da" ]; then echo "refuz: doar pe clona (IMPORT_AI_CLONA=da)" >&2; exit 2; fi
command -v psql >/dev/null || { echo "refuz: psql lipseste" >&2; exit 2; }
RADACINA="$(cd "$(dirname "$0")/../.." && { pwd -W 2>/dev/null || pwd; })"   # pwd -W (Git Bash): cale Windows, ca psql.exe sa poata deschide fisierele
SQL1="$RADACINA/supabase/tests/20261131j_redari_import_ai_clona.sql"
REV="$RADACINA/supabase/revenire/20261131j_redari_import_verificare_ai_ROLLBACK.sql"
[ -r "$SQL1" ] && [ -r "$REV" ] || { echo "refuz: lipsesc $SQL1 / $REV" >&2; exit 2; }
COD_TEST="${IMPORT_AI_CLONA_PROIECT:-TEST-RAZVAN}"
[[ "$COD_TEST" =~ ^TEST-[A-Za-z0-9_-]{1,40}$ ]] || { echo "refuz: proiectul de test trebuie sa aiba codul TEST-… (dat: $COD_TEST)" >&2; exit 2; }
MARCAJ=c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1
VERS_CLIENT="$(psql --version 2>/dev/null | sed -n 's/^psql (PostgreSQL) \([0-9]*\).*/\1/p')"
if [ -z "$VERS_CLIENT" ] || [ "$VERS_CLIENT" -lt 13 ]; then echo "refuz: psql >= 13 (\\warn); gasit: $(psql --version 2>&1)" >&2; exit 2; fi
PS=(psql -X -q -w -v ON_ERROR_STOP=1)
q() { "${PS[@]}" -tAc "$1" | tr -d '\r'; }   # tr: psql.exe (Windows) scrie CRLF

# ── precondiții (doar citiri) ──
PRE="$(q "SELECT current_setting('server_version_num')::int >= 170000, current_user = 'postgres', to_regclass('public.red_import_ai_jurnal') IS NOT NULL AND to_regclass('public.red_proiect_drepturi_istoric') IS NOT NULL")" \
  || { echo "refuz: nu ma pot conecta (PGHOST / PGPORT / PGUSER / PGDATABASE / pgpass)" >&2; exit 2; }
case "$PRE" in
  't|t|t') ;;
  f\|*) echo "refuz: serverul nu e PostgreSQL >= 17" >&2; exit 2;;
  t\|f\|*) echo "refuz: ruleaza ca postgres" >&2; exit 2;;
  *) echo "refuz: 20261131j nu e aplicata ($PRE)" >&2; exit 2;;
esac
P="$(q "SELECT id FROM public.red_proiecte WHERE cod = '$COD_TEST' AND activ IS TRUE")"
OWNER="$(q "SELECT id FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1")"
[[ "$P" =~ ^[0-9a-f-]{36}$ ]] || { echo "refuz: proiectul $COD_TEST lipseste sau e inactiv pe clona" >&2; exit 2; }
[[ "$OWNER" =~ ^[0-9a-f-]{36}$ ]] || { echo "refuz: niciun profil owner pe clona" >&2; exit 2; }
AZI="$(q "SELECT count(*) FROM public.red_import_ai_jurnal WHERE proiect_id = '$P' AND ziua = (clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date")"
[ "$AZI" = 0 ] || { echo "refuz: proiectul $COD_TEST are deja $AZI apeluri AI azi (plafoanele ar iesi altfel); reia maine sau alt proiect TEST-" >&2; exit 2; }
CU_MARCAJ="$(q "SELECT count(*) FROM public.red_import_ai_jurnal WHERE fisier_sha256 = '$MARCAJ'")"
[ "$CU_MARCAJ" = 0 ] || { echo "refuz: exista deja $CU_MARCAJ randuri cu marcajul probei (rulare neterminata?)" >&2; exit 2; }
GOALE="$(q "SELECT (NOT EXISTS (SELECT 1 FROM public.red_proiect_drepturi) AND NOT EXISTS (SELECT 1 FROM public.red_proiect_drepturi_istoric) AND NOT EXISTS (SELECT 1 FROM public.red_import_ai_jurnal))::int")"
N_JURNAL0="$(q "SELECT count(*) FROM public.red_import_ai_jurnal")"; N_IST0="$(q "SELECT count(*) FROM public.red_proiect_drepturi_istoric")"

# ── curățenia (trap: și la întrerupere) ──
D="$(mktemp -d -t importai_clona_XXXXXX)"
A_OUT="$D/A.stdout.log"; A_ERR="$D/A.stderr.log"; B_LOG="$D/B.log"; : > "$A_ERR"; : > "$B_LOG"
A_DESCHIS=0; esec=0; A_FD_IN=''; A_FD_OUT=''; A_PID_C=''
curatenie() {
  local cod=$?
  trap - EXIT INT TERM
  if [ "$cod" != 0 ] || [ "$esec" != 0 ]; then
    echo "── sesiunea A (stderr, ultimele 30) ──"; tail -n 30 "$A_ERR" 2>/dev/null
    echo "── sesiunile B (ultimele 30) ──"; tail -n 30 "$B_LOG" 2>/dev/null
  fi
  if [ "$A_DESCHIS" = 1 ]; then { printf '%s\n' 'ROLLBACK;' '\q' >&"$A_FD_IN"; } 2>/dev/null || true; wait "$A_PID_C" 2>/dev/null || true; fi
  if "${PS[@]}" -c "DELETE FROM public.red_import_ai_jurnal WHERE proiect_id = '$P' AND fisier_sha256 = '$MARCAJ'" > /dev/null \
     && [ "$(q "SELECT count(*) FROM public.red_import_ai_jurnal")" = "$N_JURNAL0" ] && [ "$(q "SELECT count(*) FROM public.red_proiect_drepturi_istoric")" = "$N_IST0" ]; then
    echo "  OK  curatenie: randurile sintetice (marcaj) sterse; jurnalul si istoricul au numarul de la pornire ($N_JURNAL0 / $N_IST0)"
  else echo "  NU  curatenie: verifica manual red_import_ai_jurnal (fisier_sha256 = marcajul) si istoricul drepturilor"; cod=1; fi
  rm -rf "$D"
  if [ "$cod" = 0 ] && [ "$esec" != 0 ]; then cod=1; fi
  exit "$cod"
}
trap curatenie EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ok() { if [ "$1" = 0 ]; then echo "  OK  $2"; else echo "  NU  $2"; esec=$((esec + 1)); fi; }
egal() { if [ "$1" = "$2" ]; then echo "  OK  $3 → $1"; else echo "  NU  $3 → $1 (astepta $2)"; esec=$((esec + 1)); fi; }
JWT="SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{\"sub\":\"$OWNER\",\"role\":\"authenticated\"}', true); SELECT set_config('request.jwt.claim.sub', '$OWNER', true);"
ZI="(clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date"
# rezervarea ca owner: o valoare jsonb (text); conținutul / cheia date
rz() { printf "SELECT public.fn_red_import_ai_rezerva('%s'::uuid, '%s'::uuid, '%s', '%s', 1, 1, 50, 10000, 8000)::text" "$1" "$P" "$MARCAJ" "$2"; }
umple() {   # umple <n> <stare: rezervat|necunoscut> <cost_rezervat> <continut> — rânduri sintetice COMISE (postgres), azi
  "${PS[@]}" -c "INSERT INTO public.red_import_ai_jurnal (cheie, proiect_id, user_id, ziua, fisier_sha256, continut_sha256, bucata, bucati, randuri, octeti_intrare, max_iesire, model,
    cost_rezervat_usd, lease_token, stare, inchis_la, eroare_cod)
    SELECT gen_random_uuid(), '$P', '$OWNER', $ZI, '$MARCAJ', CASE WHEN '$4' = '' THEN md5(g::text) || md5(g::text) ELSE '$4' END, 1, 1, 1, 1, 1, 'claude-sonnet-5-5', $3, gen_random_uuid(),
           '$2', CASE WHEN '$2' = 'rezervat' THEN NULL ELSE clock_timestamp() END, CASE WHEN '$2' = 'rezervat' THEN NULL ELSE 'proba_clona' END
      FROM generate_series(1, $1) g" > /dev/null
}
sterge_marcaj() { "${PS[@]}" -c "DELETE FROM public.red_import_ai_jurnal WHERE proiect_id = '$P' AND fisier_sha256 = '$MARCAJ'" > /dev/null; }
nr_azi() { q "SELECT count(*) FROM public.red_import_ai_jurnal WHERE proiect_id = '$P' AND ziua = $ZI"; }
uuid() { q "SELECT gen_random_uuid()"; }

# ── sesiunea A (coproc) și B (sincron) — ca în 20261131h ──
deschideA() {
  coproc A { psql -X -q -w -v ON_ERROR_STOP=0 -v VERBOSITY=verbose -f - 2>&1 1>"$A_OUT"; }
  A_FD_IN="${A[1]}"; A_FD_OUT="${A[0]}"; A_PID_C="$A_PID"; A_DESCHIS=1
}
asteaptaA() {
  local marcaj="$1" linie
  A_STARE=''
  while IFS= read -r -t 60 -u "$A_FD_OUT" linie 2>/dev/null; do   # 2>/dev/null: descriptorul închis de bash după terminarea lui A (pasul 4)
    linie="${linie%$'\r'}"
    printf '%s\n' "$linie" >> "$A_ERR"
    case "$linie" in "$marcaj "*) A_STARE="${linie#"$marcaj" }"; return 0;; esac
  done
  A_STARE='FARA_RASPUNS'; return 1
}
pasA() { local marcaj="$1"; shift; printf '%s\n' "$@" "\\warn $marcaj :SQLSTATE" >&"$A_FD_IN"; asteaptaA "$marcaj"; }
pasAval() { local marcaj="$1" sql="$2"; printf '%s\n' "$sql \\gset v_" "\\warn $marcaj :SQLSTATE :v_val" >&"$A_FD_IN"; asteaptaA "$marcaj"; A_VAL="${A_STARE#* }"; A_STARE="${A_STARE%% *}"; }
inchideA() {
  local linie c
  { printf '%s\n' '\q' >&"$A_FD_IN"; } 2>/dev/null || true
  while IFS= read -r -t 60 -u "$A_FD_OUT" linie 2>/dev/null; do linie="${linie%$'\r'}"; printf '%s\n' "$linie" >> "$A_ERR"; done
  wait "$A_PID_C" 2>/dev/null; c=$?; [ "$c" = 127 ] && c=0
  A_DESCHIS=0; return "$c"
}
ruleazaB() {
  local marcaj="$1"
  B_IESIRE="$(psql -X -q -w -v ON_ERROR_STOP=0 -f - 2>&1 | tr -d '\r')"
  printf '── B %s ──\n%s\n' "$marcaj" "$B_IESIRE" >> "$B_LOG"
  B_STARE="$(printf '%s\n' "$B_IESIRE" | sed -n "s/^$marcaj //p" | tail -n 1)"; [ -n "$B_STARE" ] || B_STARE='FARA_MARCAJ'
}
# B rezervă (owner), cu sau fără lock_timeout; B_STARE = „<SQLSTATE> <jsonb>”
rezervaB() {   # rezervaB <marcaj> <cheie> <continut> [lock_timeout]
  ruleazaB "$1" <<EOF
${4:+SET lock_timeout = '$4';}
BEGIN;
$JWT
$(rz "$2" "$3") AS r \gset
\echo $1 :SQLSTATE :r
COMMIT;
EOF
}
tine_advisory() { q "SELECT (count(*) = 1)::int FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND granted"; }

echo "1. sesiunea unica: $SQL1 (date sintetice, ROLLBACK)"
"${PS[@]}" -v clona=da -f "$SQL1" 2>&1 | tr -d '\r' > "$D/s1.log"; c1=$?; ok $c1 "proba intr-o sesiune a rulat fara eroare"; [ "$c1" = 0 ] || grep -E "ERROR|NOTICE|eroare" | head -n 8 | sed "s/^/     s1: /"
LINIE="$(grep -E 'CLONA 20261131j: verificari=' "$D/s1.log" | tail -n 1)"
case "$LINIE" in *"verdict=OK"*) ok 0 "${LINIE#*NOTICE:  }";; *) ok 1 "verdict: ${LINIE:-lipsa}"; grep -E 'NU  ' "$D/s1.log" | head -n 20;; esac

echo "2. concurenta (doua sesiuni reale, bariera): aceeasi cheie + cele trei plafoane, pe $COD_TEST, randuri sintetice comise si sterse la final"
deschideA
pasAval A_PID 'SELECT pg_backend_pid() AS val'; egal "$A_STARE" 00000 "A: sesiune deschisa (backend $A_VAL)"; A_BACKEND="$A_VAL"
# K: aceeași cheie de intenție în două sesiuni = cel mult UN apel plătit (nou:true o singură dată)
K="$(uuid)"
pasA A_K_BEGIN 'BEGIN;' "$JWT"; egal "$A_STARE" 00000 "A: BEGIN + JWT owner"
pasAval A_K_REZ "SELECT (($(rz "$K" "$(printf 'a%.0s' {1..64})"))::jsonb ->> 'nou') AS val"; egal "$A_STARE $A_VAL" '00000 true' "A: rezerva(K) = nou:true (tranzactia ramane deschisa)"
egal "$(tine_advisory "$A_BACKEND")" 1 "A tine lock-ul consultativ al proiectului la bariera"
rezervaB B_K1 "$K" "$(printf 'a%.0s' {1..64})" 1s; egal "${B_STARE%% *}" 55P03 "B in timpul lui A: aceeasi cheie a asteptat lock-ul lui A si a picat la lock_timeout"
egal "$(q "SELECT count(*) FROM public.red_import_ai_jurnal WHERE cheie = '$K'")" 0 "B n-a scris nimic (randul lui A e inca necomis)"
pasA A_K_COMMIT 'COMMIT;'; egal "$A_STARE" 00000 "A: COMMIT"
rezervaB B_K2 "$K" "$(printf 'a%.0s' {1..64})"
egal "$(printf '%s' "$B_STARE" | sed -n 's/^00000 .*"nou": \([a-z]*\).*/\1/p')" false "B dupa COMMIT, aceeasi cheie: nou:false (FARA al doilea apel platit)"
egal "$(q "SELECT count(*) FROM public.red_import_ai_jurnal WHERE cheie = '$K'")" 1 "un singur rand pe cheie"
sterge_marcaj
# C1: plafonul de APELURI (60 / zi): 59 comise; A ia al 60-lea; B (alt apel) așteaptă, apoi vede 60 → refuz
umple 59 rezervat 0.00001 ''; egal "$(nr_azi)" 59 "C1: 59 de apeluri azi (sintetice)"
pasA A_C1_BEGIN 'BEGIN;' "$JWT"
pasAval A_C1_REZ "SELECT (($(rz "$(uuid)" "$(printf 'b%.0s' {1..64})"))::jsonb ->> 'nou') AS val"; egal "$A_STARE $A_VAL" '00000 true' "A: al 60-lea apel = nou:true"
rezervaB B_C1a "$(uuid)" "$(printf 'd%.0s' {1..64})" 1s; egal "${B_STARE%% *}" 55P03 "B in timpul lui A (al 61-lea): a asteptat lock-ul lui A"
pasA A_C1_COMMIT 'COMMIT;'
rezervaB B_C1b "$(uuid)" "$(printf 'd%.0s' {1..64})"
case "$B_STARE" in "00000 "*'"cod": "plafon_apeluri_zi"'*) ok 0 "B dupa COMMIT: plafon_apeluri_zi";; *) ok 1 "B dupa COMMIT: $B_STARE (astepta plafon_apeluri_zi)";; esac
egal "$(nr_azi)" 60 "C1: exact 60 de apeluri azi (niciunul in plus)"
sterge_marcaj
# C2: plafonul de COST (10 USD / zi): 9,80 rezervați (necunoscut); A: + 0,104 = 9,904; B: + 0,104 = 10,008 > 10 → refuz
umple 1 necunoscut 9.80 ''
pasA A_C2_BEGIN 'BEGIN;' "$JWT"
pasAval A_C2_REZ "SELECT (($(rz "$(uuid)" "$(printf 'b%.0s' {1..64})"))::jsonb ->> 'nou') AS val"; egal "$A_STARE $A_VAL" '00000 true' "A: 9,80 + 0,104 <= 10 = nou:true"
rezervaB B_C2a "$(uuid)" "$(printf 'd%.0s' {1..64})" 1s; egal "${B_STARE%% *}" 55P03 "B in timpul lui A: a asteptat lock-ul lui A"
pasA A_C2_COMMIT 'COMMIT;'
rezervaB B_C2b "$(uuid)" "$(printf 'd%.0s' {1..64})"
case "$B_STARE" in "00000 "*'"cod": "plafon_cost_zi"'*) ok 0 "B dupa COMMIT: plafon_cost_zi (9,904 + 0,104 > 10)";; *) ok 1 "B dupa COMMIT: $B_STARE (astepta plafon_cost_zi)";; esac
egal "$(nr_azi)" 2 "C2: doar 2 randuri azi (cel umplut + al lui A)"
sterge_marcaj
# C3: plafonul pe CONȚINUT (2 / zi): unul comis cu conținutul E; A ia al doilea; B (același conținut, alt fișier / cheie) → refuz
E="$(printf 'e%.0s' {1..64})"
umple 1 rezervat 0.00001 "$E"
pasA A_C3_BEGIN 'BEGIN;' "$JWT"
pasAval A_C3_REZ "SELECT (($(rz "$(uuid)" "$E"))::jsonb ->> 'nou') AS val"; egal "$A_STARE $A_VAL" '00000 true' "A: al doilea apel pe continutul E = nou:true"
rezervaB B_C3a "$(uuid)" "$E" 1s; egal "${B_STARE%% *}" 55P03 "B in timpul lui A (al treilea pe E): a asteptat lock-ul lui A"
pasA A_C3_COMMIT 'COMMIT;'
rezervaB B_C3b "$(uuid)" "$E"
case "$B_STARE" in "00000 "*'"cod": "plafon_bucata_zi"'*) ok 0 "B dupa COMMIT: plafon_bucata_zi";; *) ok 1 "B dupa COMMIT: $B_STARE (astepta plafon_bucata_zi)";; esac
egal "$(q "SELECT count(*) FROM public.red_import_ai_jurnal WHERE proiect_id = '$P' AND continut_sha256 = '$E'")" 2 "C3: exact 2 apeluri pe continutul E"
inchideA; ok $? "sesiunea A inchisa curat"
sterge_marcaj; egal "$(q "SELECT count(*) FROM public.red_import_ai_jurnal WHERE fisier_sha256 = '$MARCAJ'")" 0 "randurile sintetice ale pasului 2 sterse"

# prologul runnerului pentru revenire (ca scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000): plafonul pe sesiune ÎNAINTE de BEGIN + marcajele
PROLOG_REV="SET transaction_timeout = 2000;
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.livrare_migrare', '20261131j_redari_import_verificare_ai_ROLLBACK:' || txid_current(), true);
SELECT set_config('gazpet.plafon_tranzactie', '2000:' || txid_current(), true);"
revenire_cu() {   # revenire_cu <eticheta> <fixture SQL> → R_COD (codul psql), R_IESIRE
  R_IESIRE="$({ printf '%s\n%s\n' "$PROLOG_REV" "$2"; printf '\\ir %s\n' "$REV"; printf '%s\n' 'ROLLBACK;'; } | psql -X -q -w -v ON_ERROR_STOP=1 -f - 2>&1)"; R_COD=$?
  printf '── revenire %s (exit %s) ──\n%s\n' "$1" "$R_COD" "$R_IESIRE" >> "$B_LOG"
}
obiecte() { q "SELECT ((to_regclass('public.red_import_ai_jurnal') IS NOT NULL)::int + (to_regclass('public.red_proiect_drepturi') IS NOT NULL)::int + (to_regclass('public.red_proiect_drepturi_istoric') IS NOT NULL)::int
  + (SELECT count(*)::int FROM pg_proc WHERE proname IN ('fn_red_import_ai_poate', 'fn_red_import_ai_rezerva', 'fn_red_import_ai_inchide', 'fn_red_proiect_drepturi_istoric')))"; }

echo "3. revenirea REFUZATA (prologul runnerului, plafon 2000 ms; fixture in aceeasi tranzactie, nimic comis)"
revenire_cu R1 "INSERT INTO public.red_proiect_drepturi (proiect_id, profile_id, drept) VALUES ('$P', '$OWNER', 'import_verificare_ai');
DELETE FROM public.red_proiect_drepturi WHERE proiect_id = '$P' AND profile_id = '$OWNER' AND drept = 'import_verificare_ai';"
[ "$R_COD" = 3 ] && printf '%s' "$R_IESIRE" | grep -q 'ISTORIC_NOU'; ok $? "R1 dupa acordare + retragere: revenirea refuza (ISTORIC_NOU, psql exit $R_COD)"
revenire_cu R2 "SELECT set_config('request.jwt.claim.sub', '$OWNER', true); SELECT public.fn_red_import_ai_rezerva(gen_random_uuid(), '$P'::uuid, '$MARCAJ', '$(printf 'f%.0s' {1..64})', 1, 1, 1, 1, 1);
SELECT set_config('request.jwt.claim.sub', '', true);"
[ "$R_COD" = 3 ] && printf '%s' "$R_IESIRE" | grep -q 'ISTORIC_NOU'; ok $? "R2 dupa o rezervare AI: revenirea refuza (ISTORIC_NOU, psql exit $R_COD)"
egal "$(obiecte)" 7 "obiectele 20261131j sunt toate la locul lor"
egal "$(q "SELECT count(*) FROM public.red_import_ai_jurnal")|$(q "SELECT count(*) FROM public.red_proiect_drepturi_istoric")" "$N_JURNAL0|$N_IST0" "nimic comis de fixture-urile revenirii"

echo "4. revenirea REUSITA sub plafonul de 2000 ms (apoi ROLLBACK) + proba de blocare a citirilor"
if [ "$GOALE" != 1 ]; then
  echo "  --  sarit: tabelele noi nu erau goale la pornire (revenirea ar refuza corect cu ISTORIC_NOU; proba asta cere o clona proaspat migrata)"
else
  revenire_cu R3 ""
  egal "$R_COD" 0 "R3 pe clona nefolosita: revenirea trece sub plafonul de 2000 ms (fara COMMIT: ROLLBACK)"
  egal "$(obiecte)" 7 "dupa ROLLBACK obiectele sunt la locul lor"
  # blocarea: A ține revenirea deschisă (ACCESS EXCLUSIVE pe red_proiecte / profiles); B citește profiles → așteaptă până la plafonul lui A
  deschideA
  pasAval A2_PID 'SELECT pg_backend_pid() AS val'; A_BACKEND="$A_VAL"
  pasA A2_REV "$PROLOG_REV" "\\ir $REV"; egal "$A_STARE" 00000 "A: revenirea a rulat in tranzactia deschisa (lock-urile tinute)"
  egal "$(q "SELECT count(*) FROM pg_locks WHERE pid = $A_BACKEND AND granted AND mode = 'AccessExclusiveLock' AND relation IN ('public.profiles'::regclass, 'public.red_proiecte'::regclass)")" 2 "A tine ACCESS EXCLUSIVE pe profiles si red_proiecte"
  T0="$(date +%s%3N)"
  "${PS[@]}" -c "SET statement_timeout = '10s'; SELECT count(*) FROM public.profiles" > /dev/null 2>> "$B_LOG"; B_COD=$?
  T1="$(date +%s%3N)"; ASTEPTARE=$((T1 - T0))
  egal "$B_COD" 0 "B: citirea din profiles a reusit dupa eliberare"
  [ "$ASTEPTARE" -ge 100 ] && [ "$ASTEPTARE" -le 3000 ]; ok $? "B a asteptat $ASTEPTARE ms (blocat de A, eliberat de plafonul de 2000 ms; interval acceptat 100..3000)"
  A_VIU=1; for _ in $(seq 1 20); do A_VIU="$(q "SELECT count(*) FROM pg_stat_activity WHERE pid = $A_BACKEND")"; [ "$A_VIU" = 0 ] && break; done
  egal "$A_VIU" 0 "backendul lui A ($A_BACKEND) nu mai exista pe server (terminat, nu doar eliberat)"
  pasA A2_DUPA 'SELECT 1;' || true
  if grep -q '25P04\|transaction timeout' "$A_ERR"; then ok 0 "A a fost terminata de PostgreSQL cu 25P04 (transaction_timeout)"
  elif [ -n "${MSYSTEM:-}${CYGWIN:-}" ] && grep -q 'connection to server was lost' "$A_ERR" && [ "$A_VIU" = 0 ] && [ "$ASTEPTARE" -ge 1500 ]; then
    # psql.exe (Windows): FATAL 25P04 sosește, dar socketul e resetat la următoarea scriere și Windows aruncă bufferul de primire (10053) — mesajul nu
    # ajunge la client. Dovada aici: backendul lui A dispărut + B eliberat după >= 1500 ms (plafonul de 2000 ms). Pe Linux rămâne verificarea strictă.
    ok 0 "A terminata de server la plafon (client Windows: mesajul 25P04 pierdut de socket; backend disparut, B eliberat la $ASTEPTARE ms)"
  else ok 1 "A a fost terminata de PostgreSQL cu 25P04 (transaction_timeout)"; fi
  inchideA || true
  egal "$(obiecte)" 7 "dupa terminarea lui A obiectele sunt la locul lor (revenirea anulata)"
fi

if [ "$esec" = 0 ]; then echo "PASS: toate asteptarile se tin (curatenia urmeaza)"; else echo "ESEC: $esec asteptari nu se tin"; fi
exit $(( esec > 0 ))
