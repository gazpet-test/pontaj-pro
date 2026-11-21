#!/usr/bin/env bash
# Proba de CONCURENȚĂ a migrărilor 20270105a / 20270105b (Rest de decontat, PR #1158 r2, review Jakarinos P1-7): DOUĂ sesiuni psql REALE, cu
# barieră explicită, pe un cluster PostgreSQL ≥ 17 COMPLET DISPENSABIL. PGlite (o singură conexiune) nu poate proba asta: aici DREPTUL se schimbă
# (owner-ul mută managerul proiectului) cât RPC-ul vechiului MP AȘTEAPTĂ lock-ul pe proiect; după lock, RPC-ul trebuie să REVERIFICE dreptul și să
# refuze (42501), fără să scrie nimic. Cu mutantul (reverificarea scoasă: REST_MUTANT=da) RPC-ul vechiului MP SCRIE — proba e discriminatorie.
#
# CE ATINGE (exact):
#   * BAZA: creează baza <nume_baza_noua> (refuză dacă există deja) și o ȘTERGE la final (DROP DATABASE … WITH (FORCE)), inclusiv la întrerupere
#     (trap EXIT / INT / TERM). Nu se conectează la nicio altă bază decât `postgres` (pentru CREATE / DROP) și baza nouă.
#   * ROLURI la nivel de CLUSTER: scheletul (supabase/tests/20270105a_executie_rest_decontat_schelet.sql) creează, DOAR dacă lipsesc, rolurile anon,
#     authenticated, service_role (BYPASSRLS), authenticator. Scriptul notează ÎNAINTE care lipsesc și le ȘTERGE la final pe cele create de el;
#     rolurile preexistente nu sunt atinse. De aceea rulează DOAR cu REST_CLUSTER_DISPENSABIL=da: NU pe clona de producție, NU pe un cluster folosit la altceva.
#   * FIȘIERE: un folder temporar (mktemp -d) cu DDL-ul extras și jurnalele sesiunilor; șters la final (la eșec, cozile jurnalelor se afișează înainte).
#   * REȚEA: doar conexiunile psql la cluster (PGHOST / PGPORT / PGUSER / PGPASSWORD sau pgpass).
# CE APLICĂ: scheletul + secțiunile 1–11 ale migrării A și 1–3 ale migrării B (textul EXACT dintre marcajele „-- ─── 1.” și „-- ─── 12.” / „-- ─── 4.”),
#   FĂRĂ gărzile runnerului ($pre$ / $lock$ / $post$). Aplicarea completă prin runner (manifestul L15, aplicare → revenire → reaplicare) e pasul SEPARAT
#   al coordonatorului, pe clonă (docs/LIVRARE_L15_V2.md §7).
#
# CUM SE RULEAZĂ (coordonatorul; cere bash ≥ 4 (coproc), psql ≥ 13 (\warn), conectare ca superuser `postgres`):
#     REST_CLUSTER_DISPENSABIL=da PGHOST=… PGPORT=… PGUSER=postgres PGPASSWORD=… bash supabase/tests/20270105a_executie_rest_decontat_concurenta.sh <nume_baza_noua>
#     … REST_MUTANT=da bash …   → aplică migrarea cu reverificarea SCOASĂ (mutantul) și așteaptă rezultatul OPUS (vechiul MP scrie): dovada că proba discriminează.
#     … REST_MUTANT=lock_garda bash …   → garda proiect_articole FĂRĂ advisory-ul proiectului (mutantul r4): C5 / C6 așteaptă rezultatul OPUS (cumulare).
#   Ieșire: 0 = toate așteptările se țin și curățenia a reușit; 1 = cel puțin o așteptare nu se ține (sau curățenia a eșuat); 2 = refuz / folosire greșită.
#
# BARIERA (fără sleep orb): sesiunea A (owner-ul) e un psql ținut deschis (coproc): BEGIN; UPDATE executie_proiecte SET mp_employee_id = <alt MP> WHERE id = P
#   (ține lock-ul de rând pe proiect, NECOMIS); marcajul `\warn <PAS> :SQLSTATE` pe stderr confirmă pasul. Sesiunea B (vechiul MP, authenticated) pornește
#   în FUNDAL cu RPC-ul: trece prima verificare a dreptului (snapshot vechi), ia advisory-ul, apoi AȘTEAPTĂ la `FOR SHARE` pe rândul proiectului.
#   Bariera a doua: o a treia conexiune întreabă pg_stat_activity până când backend-ul lui B e în wait_event_type = 'Lock' (stare observată, nu timp).
#   Abia apoi A: COMMIT. B se trezește, instrucțiunea următoare vede noul MP → reverificarea refuză cu 42501. SQLSTATE-urile se citesc din psql
#   (:SQLSTATE), numerele de rânduri din SELECT. Singurele timpuri: lock_timeout 10 s în B (plasă) și read -t 60 (dacă A moare).
#
# SCENARII (așteptările scrise de mână; „MP vechi” = contul b, employee 9101, MP-ul inițial al proiectului; „MP nou” = employee 9102):
#   C1  confirma_baza (oferta): A ține schimbarea MP necomisă; B (MP vechi) cheamă fn_rest_decontat_confirma_baza → așteaptă; A COMMIT → B: 42501,
#       0 rânduri contract_initial pe proiect. Cu mutantul: B: 00000, N rânduri scrise.
#   C2  confirma_situatie: proiect cu ofertă (scrisă ÎNAINTE de owner); A ține schimbarea MP; B (MP vechi) confirmă situația „1” → 42501, 0 situații.
#   C3  configurare_completa (20270105b): proiect cu ofertă; A ține schimbarea MP; B (MP vechi) declară configurarea → 42501, configurare_completa_la NULL,
#       jurnal gol.
#   C4  calea legitimă: după ce A a comis schimbarea, NOUL MP (contul n) cheamă același RPC fără concurent → 00000 (nimic nu e blocat în plus).
#   r4 (review #1158, P1 r3 — stările ofertei; „acces general” = contul x, user_module_access 'executie', scrie proiect_articole pe calea veche):
#   C5  import vechi vs RPC: A (acces general) INSERT 2 rânduri contract_initial pe C5, NECOMIS — garda a luat advisory-ul proiectului (try) și îl ține;
#       B (MP vechi) cheamă fn_rest_decontat_confirma_baza(C5) → așteaptă la advisory (pg_stat_activity: Lock); A COMMIT → B: 00000, inlocuite = 2:
#       0 rânduri vechi active, 2 vechi retrase, 1 confirmat (fără cumulare). Cu REST_MUTANT=lock_garda (advisory-ul scos din gardă): B NU așteaptă,
#       confirmă peste rândurile necomise ale lui A → după COMMIT-ul lui A rămân 2 rânduri vechi ACTIVE pe un proiect confirmat (cumulare în tabel).
#   C6  RPC în curs vs import vechi: A (MP vechi) confirmă oferta C6, NECOMIS (ține advisory-ul); B (acces general) INSERT contract_initial pe C6 →
#       55P03 imediat (try-lock ocupat, nimic scris); A COMMIT; B din nou → 42501 (oferta confirmată), nimic scris. Cu mutantul lock_garda: primul B scrie
#       (00000: starea (a) văzută fără lock) → după COMMIT 1 rând vechi activ pe proiectul confirmat.
#   REST_MUTANT=da (reverificarea dreptului scoasă) schimbă doar așteptările C1–C3 (+ C4 sărit); REST_MUTANT=lock_garda doar C5 / C6.
set -u
set -o pipefail

if [ "${REST_CLUSTER_DISPENSABIL:-}" != "da" ]; then
  echo "refuz: scriptul creeaza / sterge o baza si poate crea roluri la nivel de CLUSTER; ruleaza-l DOAR pe un cluster complet dispensabil, cu REST_CLUSTER_DISPENSABIL=da" >&2
  exit 2
fi
if [ $# -ne 1 ] || ! [[ "$1" =~ ^[a-z][a-z0-9_]{2,40}$ ]]; then echo "folosire: REST_CLUSTER_DISPENSABIL=da [REST_MUTANT=da] $0 <nume_baza_noua (a-z0-9_)>" >&2; exit 2; fi
BAZA="$1"
MUTANT="${REST_MUTANT:-nu}"
RADACINA="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_A="$RADACINA/supabase/migrations/20270105a_executie_rest_decontat.sql"
MIG_B="$RADACINA/supabase/migrations/20270105b_executie_proiect_configurare.sql"
SCHELET="$RADACINA/supabase/tests/20270105a_executie_rest_decontat_schelet.sql"
[ -r "$MIG_A" ] && [ -r "$MIG_B" ] && [ -r "$SCHELET" ] || { echo "lipsesc migrarile / scheletul" >&2; exit 2; }

PSM=(psql -X -q -w -v ON_ERROR_STOP=1 -d postgres)
VERS_CLIENT="$(psql --version 2>/dev/null | sed -n 's/^psql (PostgreSQL) \([0-9]*\).*/\1/p')"
if [ -z "$VERS_CLIENT" ] || [ "$VERS_CLIENT" -lt 13 ]; then echo "refuz: psql >= 13 (\\warn exista din psql 13); gasit: $(psql --version 2>&1)" >&2; exit 2; fi
PRE="$("${PSM[@]}" -tAc "SELECT current_setting('server_version_num')::int >= 170000, current_user = 'postgres', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), EXISTS (SELECT 1 FROM pg_database WHERE datname = '$BAZA')")" || { echo "refuz: nu ma pot conecta la baza postgres" >&2; exit 2; }
case "$PRE" in
  t\|t\|t\|f) ;;
  t\|t\|t\|t) echo "refuz: baza $BAZA exista deja (aleg alt nume; nu sterg nimic existent)" >&2; exit 2;;
  *) echo "refuz: cere PostgreSQL >= 17, current_user = postgres, superuser (primit: $PRE)" >&2; exit 2;;
esac

D="$(mktemp -d -t restdec_concurenta_XXXXXX)"
DDL_A="$D/ddl_a.sql"; DDL_B="$D/ddl_b.sql"; A_OUT="$D/A.stdout.log"; A_ERR="$D/A.stderr.log"; B_LOG="$D/B.log"
: > "$A_ERR"; : > "$B_LOG"
BAZA_CREATA=0; A_DESCHIS=0; esec=0; B_PID=''
ROLURI=(anon authenticated service_role authenticator)
ROLURI_CREATE=()
curatenie() {
  local cod=$?
  trap - EXIT INT TERM
  if [ "$cod" != 0 ] || [ "$esec" != 0 ]; then
    echo "── sesiunea A (stderr, ultimele 40) ──"; tail -n 40 "$A_ERR" 2>/dev/null
    echo "── sesiunile B (ultimele 60) ──"; tail -n 60 "$B_LOG" 2>/dev/null
  fi
  if [ -n "$B_PID" ]; then kill "$B_PID" 2>/dev/null || true; wait "$B_PID" 2>/dev/null || true; fi
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
UID_OWNER=f0000000-0000-4000-8000-0000000000aa
UID_MP_VECHI=f0000000-0000-4000-8000-0000000000bb
UID_MP_NOU=f0000000-0000-4000-8000-0000000000cc
UID_EXEC=f0000000-0000-4000-8000-0000000000dd   # r4: acces general Execuție (calea veche a catalogului), fără sub-modulul nou
ca() { printf "SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '%s', true), set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true);" "$1" "$1"; }

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
# B în FUNDAL: psql separat cu application_name distinct; rezultatul (SQLSTATE) în fișierul marcajului
porniB() {   # <marcaj> <uid> <sql fara ;>
  local marcaj="$1" uid="$2" sql="$3"
  B_FIS="$D/B_$marcaj.out"
  PGAPPNAME="restdec_B_$marcaj" psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f - > "$B_FIS" 2>&1 <<EOF &
SET lock_timeout = '10s';
BEGIN;
$(ca "$uid")
$sql;
\echo $marcaj :SQLSTATE
COMMIT;
EOF
  B_PID=$!
}
# bariera a doua: backend-ul lui B așteaptă un LOCK (stare observată în pg_stat_activity), nu un timp
asteaptaBlocatB() {   # <marcaj>
  local i=0 s
  while [ $i -lt 600 ]; do
    s="$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'restdec_B_$1' AND wait_event_type = 'Lock'")"
    [ "$s" = 1 ] && return 0
    if ! kill -0 "$B_PID" 2>/dev/null; then echo "  NU  B ($1) s-a terminat fara sa astepte lock-ul"; esec=$((esec + 1)); return 1; fi
    i=$((i + 1)); sleep 0.05
  done
  echo "  NU  B ($1) nu a ajuns sa astepte lock-ul in 30 s"; esec=$((esec + 1)); return 1
}
terminaB() {   # <marcaj> → B_STARE
  wait "$B_PID" 2>/dev/null || true; B_PID=''
  printf '── B %s ──\n' "$1" >> "$B_LOG"; cat "$B_FIS" >> "$B_LOG"
  B_STARE="$(sed -n "s/^$1 //p" "$B_FIS" | tail -n 1)"; [ -n "$B_STARE" ] || B_STARE='FARA_MARCAJ'
}
ruleazaSincron() {   # <marcaj> <uid> <sql fara ;> → B_STARE (fără concurent)
  porniB "$1" "$2" "$3"; terminaB "$1"
}

echo "0. baza de unica folosinta: scheletul + DDL-ul migrarilor A (1-11) si B (1-3), mutant=$MUTANT"
EXISTENTE=" $("${PSM[@]}" -tAc "SELECT string_agg(rolname, ' ') FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator')") "
for r in "${ROLURI[@]}"; do case "$EXISTENTE" in *" $r "*) ;; *) ROLURI_CREATE+=("$r");; esac; done
echo "     roluri de cluster create (si sterse la final): ${ROLURI_CREATE[*]:-niciunul}"
if "${PSM[@]}" -c "CREATE DATABASE \"$BAZA\"" > /dev/null; then BAZA_CREATA=1; ok 0 "CREATE DATABASE $BAZA"; else echo "refuz: CREATE DATABASE $BAZA a esuat" >&2; exit 2; fi
tr -d '\r' < "$MIG_A" | sed -n '/^-- ─── 1\. /,/^-- ─── 12\. /p' | sed '$d' > "$DDL_A"
tr -d '\r' < "$MIG_B" | sed -n '/^-- ─── 1\. /,/^-- ─── 4\. /p' | sed '$d' > "$DDL_B"
grep -q '^CREATE FUNCTION public.fn_rest_decontat_confirma_baza(' "$DDL_A" && grep -q '^CREATE FUNCTION public.fn_rest_decontat_confirma_situatie(' "$DDL_A" && grep -q '^CREATE FUNCTION public.fn_executie_proiect_configurare_completa(' "$DDL_B"
ok $? "DDL-ul extras din migrari (cele 3 RPC-uri prezente)"
if [ "$MUTANT" = da ]; then
  # mutantul: reverificarea dreptului dupa lock SCOASA din cele 3 RPC-uri (blocul IF de 3 randuri care urmeaza comentariului L01)
  for f in "$DDL_A" "$DDL_B"; do
    python3 - "$f" <<'PY'
import re, sys
p = sys.argv[1]; t = open(p, encoding='utf-8').read()
t2, n = re.subn(r"  -- L01: dreptul se REVERIFIC[^\n]*\n  IF NOT public\.fn_rest_decontat_drept\(p_proiect, [^\n]*\n[^\n]*\n  END IF;\n", "", t)
open(p, 'w', encoding='utf-8').write(t2); print(n)
PY
  done
  n_rev="$(grep -c 'dreptul se REVERIFIC' "$DDL_A" "$DDL_B" | awk -F: '{s+=$2} END {print s+0}')"
  ok "$([ "$n_rev" = 0 ] && echo 0 || echo 1)" "mutantul: reverificarea scoasa din toate RPC-urile (ramase: $n_rev)"
fi
if [ "$MUTANT" = lock_garda ]; then
  # mutantul r4: advisory-ul proiectului SCOS din garda proiect_articole (blocul IF NOT pg_try_advisory_xact_lock … END IF;, 3 rânduri)
  python3 - "$DDL_A" <<'PY'
import re, sys
p = sys.argv[1]; t = open(p, encoding='utf-8').read()
t2, n = re.subn(r"\n[ \t]*IF NOT pg_try_advisory_xact_lock\([^\n]*\n[^\n]*\n[ \t]*END IF;", "", t)
open(p, 'w', encoding='utf-8').write(t2); print(n)
PY
  n_lock="$(grep -c 'pg_try_advisory_xact_lock' "$DDL_A")"
  ok "$([ "$n_lock" = 0 ] && echo 0 || echo 1)" "mutantul lock_garda: advisory-ul scos din garda proiect_articole (ramase: $n_lock)"
fi
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f <(tr -d '\r' < "$SCHELET") > /dev/null; ok $? "scheletul"
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f "$DDL_A" > /dev/null; ok $? "DDL-ul migrarii A"
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f "$DDL_B" > /dev/null; ok $? "DDL-ul migrarii B"
# fixturi: owner (aa), MP vechi (bb, emp 9101), MP nou (cc, emp 9102); proiectele C1 (fara oferta), C2 si C3 (cu oferta scrisa de server)
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 > /dev/null <<EOF
INSERT INTO public.employees (id, name) VALUES (9101, 'CONC MP VECHI'), (9102, 'CONC MP NOU');
INSERT INTO public.profiles (id, is_owner, employee_id) VALUES ('$UID_OWNER', true, NULL), ('$UID_MP_VECHI', false, 9101), ('$UID_MP_NOU', false, 9102), ('$UID_EXEC', false, NULL);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('$UID_EXEC', 'executie', 'editor');
INSERT INTO public.executie_proiecte (id, cod_intern, nume, mp_employee_id) VALUES (9001, 'CONC-1', 'C1 confirma_baza', 9101), (9002, 'CONC-2', 'C2 confirma_situatie', 9101), (9003, 'CONC-3', 'C3 configurare', 9101),
  (9004, 'CONC-5', 'C5 import vechi vs RPC', 9101), (9005, 'CONC-6', 'C6 RPC in curs vs import vechi', 9101);
INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa, mod_import, fisier_amprenta, confirmat_de, confirmat_la)
VALUES (9002, '0001', 'D1', '1', 'A100', 'Conducta', 'M', 100, 10000, 'contract_initial', 'lista_completa', repeat('c2', 32), '$UID_OWNER', now()),
       (9003, '0001', 'D1', '1', 'A100', 'Conducta', 'M', 100, 10000, 'contract_initial', 'lista_completa', repeat('c3', 32), '$UID_OWNER', now());
EOF
ok $? "fixturile (5 proiecte ale MP-ului vechi, 2 cu oferta; contul cu acces general Executie)"

OFERTA_C1="SELECT public.fn_rest_decontat_confirma_baza(9001, 'contract_initial', NULL, NULL, NULL, 'o.xlsx', repeat('a1', 32), '[{\"obiect_cod\":\"0001\",\"deviz_cod\":\"D1\",\"cod\":\"A100\",\"denumire\":\"x\",\"um\":\"M\",\"cantitate\":1,\"valoare\":10}]'::jsonb)"
SITUATIE_C2="SELECT public.fn_rest_decontat_confirma_situatie(9002, '1', NULL, 's.xlsx', repeat('b1', 32), '[{\"cod\":\"A100\",\"um\":\"M\",\"cantitate_perioada\":1,\"valoare\":100,\"cheie\":\"0001|D1|A100\",\"tip_rand\":\"articol\",\"potrivire\":\"exact\"}]'::jsonb, false)"
CONFIG_C3="SELECT public.fn_executie_proiect_configurare_completa(9003, NULL)"
if [ "$MUTANT" = da ]; then ASTEPT=00000; else ASTEPT=42501; fi

deschideA
pasA A0 "SET lock_timeout = '5s';"; astept 00000 "$A_STARE" "A: sesiunea deschisa"

echo "C1. confirma_baza: MP-ul schimbat cat RPC-ul asteapta lock-ul pe proiect (astept $ASTEPT)"
pasA C1a "BEGIN;" "$(ca "$UID_OWNER")" "UPDATE public.executie_proiecte SET mp_employee_id = 9102 WHERE id = 9001;"; astept 00000 "$A_STARE" "A (owner): MP-ul schimbat, NECOMIS (lock de rand pe proiect)"
porniB C1b "$UID_MP_VECHI" "$OFERTA_C1"
asteaptaBlocatB C1b; ok $? "B (MP vechi): a trecut prima verificare si asteapta lock-ul pe proiect (pg_stat_activity: Lock)"
pasA C1c "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
terminaB C1b; astept "$ASTEPT" "$B_STARE" "B (MP vechi): RPC-ul dupa lock"
if [ "$MUTANT" = da ]; then astept 1 "$(q "SELECT count(*) FROM public.proiect_articole WHERE proiect_id = 9001")" "randuri scrise de MP-ul vechi (mutantul scrie)"
else astept 0 "$(q "SELECT count(*) FROM public.proiect_articole WHERE proiect_id = 9001")" "randuri scrise de MP-ul vechi (nimic)"; fi

echo "C2. confirma_situatie: la fel, pe un proiect cu oferta"
pasA C2a "BEGIN;" "$(ca "$UID_OWNER")" "UPDATE public.executie_proiecte SET mp_employee_id = 9102 WHERE id = 9002;"; astept 00000 "$A_STARE" "A (owner): MP-ul schimbat, NECOMIS"
porniB C2b "$UID_MP_VECHI" "$SITUATIE_C2"
asteaptaBlocatB C2b; ok $? "B (MP vechi): asteapta lock-ul pe proiect"
pasA C2c "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
terminaB C2b; astept "$ASTEPT" "$B_STARE" "B (MP vechi): RPC-ul dupa lock"
if [ "$MUTANT" = da ]; then astept 1 "$(q "SELECT count(*) FROM public.executie_sl_detaliu WHERE proiect_id = 9002")" "situatii scrise de MP-ul vechi (mutantul scrie)"
else astept 0 "$(q "SELECT count(*) FROM public.executie_sl_detaliu WHERE proiect_id = 9002")" "situatii scrise de MP-ul vechi (nimic)"; fi

echo "C3. configurare_completa (20270105b): la fel"
pasA C3a "BEGIN;" "$(ca "$UID_OWNER")" "UPDATE public.executie_proiecte SET mp_employee_id = 9102 WHERE id = 9003;"; astept 00000 "$A_STARE" "A (owner): MP-ul schimbat, NECOMIS"
porniB C3b "$UID_MP_VECHI" "$CONFIG_C3"
asteaptaBlocatB C3b; ok $? "B (MP vechi): asteapta lock-ul pe proiect"
pasA C3c "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
terminaB C3b; astept "$ASTEPT" "$B_STARE" "B (MP vechi): RPC-ul dupa lock"
if [ "$MUTANT" = da ]; then astept 1 "$(q "SELECT count(*) FROM public.executie_proiect_configurare_jurnal WHERE proiect_id = 9003")" "jurnal scris de MP-ul vechi (mutantul scrie)"
else astept 0 "$(q "SELECT count(*) FROM public.executie_proiect_configurare_jurnal WHERE proiect_id = 9003")" "jurnal scris de MP-ul vechi (nimic)"
     astept t "$(q "SELECT configurare_completa_la IS NULL FROM public.executie_proiecte WHERE id = 9003")" "proiectul C3 ramane in configurare"; fi

echo "C4. calea legitima: NOUL MP, fara concurent"
if [ "$MUTANT" != da ]; then
  ruleazaSincron C4a "$UID_MP_NOU" "$OFERTA_C1"; astept 00000 "$B_STARE" "noul MP confirma oferta C1"
  ruleazaSincron C4b "$UID_MP_NOU" "$SITUATIE_C2"; astept 00000 "$B_STARE" "noul MP confirma situatia C2"
  ruleazaSincron C4c "$UID_MP_NOU" "$CONFIG_C3"; astept 00000 "$B_STARE" "noul MP declara configurarea C3"
  astept 1 "$(q "SELECT count(*) FROM public.proiect_articole WHERE proiect_id = 9001")" "randuri C1 (ale noului MP)"
  astept 1 "$(q "SELECT count(*) FROM public.executie_sl_detaliu WHERE proiect_id = 9002")" "situatii C2"
  astept 1 "$(q "SELECT count(*) FROM public.executie_proiect_configurare_jurnal WHERE proiect_id = 9003")" "jurnal C3"
else
  echo "     (sarit cu mutantul: datele au fost scrise deja de MP-ul vechi)"
fi

# r4: stările ofertei — importul vechi (calea veche, acces general) față de RPC-ul de confirmare, pe același proiect
OFERTA_C5="SELECT public.fn_rest_decontat_confirma_baza(9004, 'contract_initial', NULL, NULL, NULL, 'o5.xlsx', repeat('a5', 32), '[{\"obiect_cod\":\"0001\",\"deviz_cod\":\"D1\",\"nr\":\"1\",\"cod\":\"A100\",\"denumire\":\"x\",\"um\":\"M\",\"cantitate\":100,\"valoare\":10000}]'::jsonb)"
OFERTA_C6="SELECT public.fn_rest_decontat_confirma_baza(9005, 'contract_initial', NULL, NULL, NULL, 'o6.xlsx', repeat('a6', 32), '[{\"obiect_cod\":\"0001\",\"deviz_cod\":\"D1\",\"nr\":\"1\",\"cod\":\"A100\",\"denumire\":\"x\",\"um\":\"M\",\"cantitate\":100,\"valoare\":10000}]'::jsonb)"
IMPORT_C5="INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa) VALUES (9004, '0001', 'D1', '1', 'A100', 'vechi 1', 'M', 90, 9000, 'contract_initial'), (9004, '0001', 'D1', '2', 'B200', 'vechi 2', 'MC', 2, 2000, 'contract_initial')"
IMPORT_C6="INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa) VALUES (9005, '0001', 'D1', '1', 'A100', 'vechi 1', 'M', 90, 9000, 'contract_initial')"
NUMAR_VECHI_ACTIVE="SELECT count(*) FROM public.proiect_articole WHERE proiect_id = %s AND sursa = 'contract_initial' AND activ AND confirmat_la IS NULL"
if [ "$MUTANT" = lock_garda ]; then AST_C5_VECHI=2; AST_C6B=00000; AST_C6_VECHI=1; else AST_C5_VECHI=0; AST_C6B=55P03; AST_C6_VECHI=0; fi

echo "C5. import vechi vs RPC: importul vechi tine advisory-ul proiectului (necomis), RPC-ul asteapta si retrage randurile vechi (astept vechi active = $AST_C5_VECHI)"
pasA C5a "BEGIN;" "$(ca "$UID_EXEC")" "$IMPORT_C5;"; astept 00000 "$A_STARE" "A (acces general): 2 randuri vechi pe C5, NECOMISE (garda tine advisory-ul proiectului)"
porniB C5b "$UID_MP_VECHI" "$OFERTA_C5"
if [ "$MUTANT" = lock_garda ]; then
  terminaB C5b; astept 00000 "$B_STARE" "B (MP): RPC-ul NU a asteptat (mutantul: garda fara advisory) si a confirmat peste randurile necomise"
  pasA C5c "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
else
  asteaptaBlocatB C5b; ok $? "B (MP): RPC-ul asteapta la advisory-ul tinut de importul vechi (pg_stat_activity: Lock)"
  pasA C5c "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  terminaB C5b; astept 00000 "$B_STARE" "B (MP): RPC-ul dupa COMMIT-ul importului vechi"
  astept 2 "$(q "SELECT count(*) FROM public.proiect_articole WHERE proiect_id = 9004 AND sursa = 'contract_initial' AND NOT activ AND confirmat_la IS NULL")" "randurile vechi RETRASE de RPC (inlocuite)"
fi
astept 1 "$(q "SELECT count(*) FROM public.proiect_articole WHERE proiect_id = 9004 AND sursa = 'contract_initial' AND activ AND confirmat_la IS NOT NULL")" "randuri confirmate active pe C5"
astept "$AST_C5_VECHI" "$(q "$(printf "$NUMAR_VECHI_ACTIVE" 9004)")" "randuri vechi ACTIVE pe C5 (0 = fara cumulare; mutantul lasa 2)"

echo "C6. RPC in curs (advisory tinut, necomis) vs import vechi: 55P03 imediat, nimic scris; dupa COMMIT 42501 (astept $AST_C6B, vechi active = $AST_C6_VECHI)"
pasA C6a "BEGIN;" "$(ca "$UID_MP_VECHI")" "$OFERTA_C6;"; astept 00000 "$A_STARE" "A (MP): oferta C6 confirmata, NECOMISA (advisory-ul proiectului tinut)"
ruleazaSincron C6b "$UID_EXEC" "$IMPORT_C6"; astept "$AST_C6B" "$B_STARE" "B (acces general): importul vechi cat RPC-ul e in curs (try-lock ocupat = 55P03)"
pasA C6c "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
ruleazaSincron C6d "$UID_EXEC" "$IMPORT_C6"; astept 42501 "$B_STARE" "B (acces general): importul vechi dupa confirmare (oferta confirmata)"
astept 1 "$(q "SELECT count(*) FROM public.proiect_articole WHERE proiect_id = 9005 AND sursa = 'contract_initial' AND activ AND confirmat_la IS NOT NULL")" "randuri confirmate active pe C6"
astept "$AST_C6_VECHI" "$(q "$(printf "$NUMAR_VECHI_ACTIVE" 9005)")" "randuri vechi ACTIVE pe C6 (0 = nimic scris de import; mutantul lasa 1)"

inchideA; ok $? "sesiunea A inchisa curat"
[ "$esec" = 0 ] && echo "TOTUL OK" || echo "ESEC: $esec"
