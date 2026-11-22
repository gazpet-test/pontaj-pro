#!/usr/bin/env bash
# Proba de CONCURENȚĂ a migrării 20270106a (Execuție „🔔 Semnale”): DOUĂ sesiuni psql REALE, cu barieră explicită, pe un cluster PostgreSQL ≥ 17
# COMPLET DISPENSABIL. PGlite (o singură conexiune) nu poate proba asta. Același model ca supabase/tests/20270105a_executie_rest_decontat_concurenta.sh.
#
# CE ATINGE (exact):
#   * BAZA: creează baza <nume_baza_noua> (refuză dacă există deja) și o ȘTERGE la final (DROP DATABASE … WITH (FORCE)), inclusiv la întrerupere
#     (trap EXIT / INT / TERM). Nu se conectează la nicio altă bază decât `postgres` (pentru CREATE / DROP / roluri) și baza nouă.
#   * ROLURI la nivel de CLUSTER: anon, authenticated (NOLOGIN NOINHERIT) și service_role (NOLOGIN NOINHERIT BYPASSRLS), ca în scheletul
#     supabase/tests/20270106a_executie_semnale_schelet.sql, create DOAR dacă lipsesc (scheletul se aplică FĂRĂ cele 3 rânduri CREATE ROLE) și
#     ȘTERSE la final doar cele create aici; rolurile preexistente nu sunt atinse, dar trebuie să aibă atributele scheletului (altfel refuz, ieșire 2).
#     De aceea rulează DOAR cu REST_CLUSTER_DISPENSABIL=da: NU pe clona de producție, NU pe un cluster folosit la altceva.
#   * FIȘIERE: un folder temporar (mktemp -d) cu SQL-ul extras și jurnalele sesiunilor; șters la final (la eșec, cozile jurnalelor se afișează înainte).
#   * REȚEA: doar conexiunile psql la cluster (PGHOST / PGPORT / PGUSER / PGPASSWORD sau pgpass).
# CE APLICĂ: scheletul (fără CREATE ROLE) + lanțul de drept pe proiect extras EXACT din 20261209a (cele 5 funcții + ACL-urile lor, amprentele md5 =
#   constantele din 20270106a, verificate; + politica RESTRICTIVĂ pe executie_proiecte, ca proba PGlite) + DDL-ul migrării 20270106a = textul EXACT
#   dintre marcajele „-- ── spațiul alb al unui text” și „-- ── postcondiții ──”, FĂRĂ gărzile runnerului ($pre$, lanțul L15, $lock$, $post$).
#   Aplicarea completă prin runner (L15 v2, aplicare → revenire → reaplicare) e pasul SEPARAT al coordonatorului, pe clonă.
#
# CUM SE RULEAZĂ (coordonatorul; cere bash ≥ 4 (coproc), psql ≥ 13 (\warn), python3, conectare ca superuser `postgres`):
#     REST_CLUSTER_DISPENSABIL=da PGHOST=… PGPORT=… PGUSER=postgres bash supabase/tests/20270106a_executie_semnale_concurenta.sh <nume_baza_noua>
#     … SEMNALE_MUTANT=fara_conflict bash …    → INSERT-ul agentului FĂRĂ „ON CONFLICT … DO NOTHING”: S1a așteaptă rezultatul OPUS (23505).
#     … SEMNALE_MUTANT=fara_for_update bash …  → citirea rândului în fn_executie_semnal_scrie FĂRĂ „FOR UPDATE”: S1b / S2a / S2b așteaptă OPUSUL.
#     … SEMNALE_MUTANT=fara_versiune bash …    → fn_executie_semnal_stare FĂRĂ verificarea versiunii (CAS): S3a / S3b așteaptă OPUSUL.
#   Fiecare mutant schimbă DOAR așteptările scenariilor lui; restul scenariilor rulează identic (și trebuie să treacă).
#   Ieșire: 0 = toate așteptările se țin și curățenia a reușit; 1 = cel puțin o așteptare nu se ține (sau curățenia a eșuat); 2 = refuz / folosire greșită.
#
# BARIERA (fără sleep orb): sesiunea A e un psql ținut deschis (coproc): BEGIN; <scrierea> (NECOMISĂ, ține lock-ul de rând / intrarea din indexul
#   unic); marcajul `\warn <PAS> :SQLSTATE :r` pe stderr confirmă pasul și dă rezultatul. Sesiunea B pornește în FUNDAL cu RPC-ul concurent; o a
#   treia conexiune întreabă pg_stat_activity până când backend-ul lui B e în wait_event_type = 'Lock' (stare observată, nu timp). Abia apoi A:
#   COMMIT. B se trezește și termină; SQLSTATE-ul și rezultatul RPC-ului (actiune / ok:motiv) se citesc din psql (:SQLSTATE, \gset), starea finală
#   din SELECT-uri ca postgres. Singurele timpuri: lock_timeout 10 s în B (plasă) și read -t 60 (dacă A moare).
#
# SCENARII (așteptările scrise de mână; agentul = service_role fără JWT, ca serverul AI; „MP” = contul b, employee 9201, managerul proiectului 9301;
#   owner-ul = contul a; responsabilii: 9202 / 9203). Fiecare scenariu are obiectul lui (conc:s1a, conc:s1b, …), deci sunt independente.
#   S1a  două sesiuni AGENT scriu SIMULTAN același semnal NOU: A creează (necomis, ține intrarea din UNIQUE); B (aceeași dovadă) așteaptă la
#        ON CONFLICT; A COMMIT → B: 00000 „neschimbat” (recitire FOR UPDATE, nimic diferit); 1 rând; jurnal = creat/agent; versiunea 2 (scrierea
#        lui B mișcă doar ultima_verificare). Mutant fara_conflict: B 23505 (agentul pică în loc să recunoască semnalul), versiunea 1.
#   S1b  două sesiuni AGENT actualizează SIMULTAN un semnal EXISTENT cu aceeași dovadă nouă (gravitate critic): A „actualizat” (necomis, rândul
#        blocat); B așteaptă la FOR UPDATE; A COMMIT → B: „neschimbat”; jurnal = creat, actualizat (O SINGURĂ actualizare). Mutant fara_for_update:
#        B citește rândul VECHI fără lock, apoi UPDATE-ul lui așteaptă și se aplică peste A → „actualizat” a doua oară, jurnal cu o actualizare în plus.
#   S2a  OM vs agent — respingere: A (MP) respinge semnalul, NECOMIS; B (agentul, aceeași dovadă) rescrie → așteaptă; A COMMIT → B: „neschimbat_inchis”;
#        starea rămâne respins cu motivul omului; jurnal = creat/agent, stare/om (agentul nu adaugă nimic). Mutant fara_for_update: B „actualizat”, jurnal
#        cu o intrare a agentului care îi atribuie respingerea (decizia omului rămâne, prin gardă + SET pe rândul curent, dar jurnalul minte).
#   S2b  OM vs agent — responsabilul: semnal cu responsabil PROPUS de agent (9203); A (owner) stabilește responsabilul 9202, NECOMIS; B (agentul,
#        propune din nou 9203) → așteaptă; A COMMIT → B: „neschimbat”; responsabil 9202 / sursa om; jurnal = creat/agent, responsabil/om. Mutant
#        fara_for_update: B „actualizat” + intrare de jurnal a agentului (9203 → 9202) pe o decizie a omului.
#   S3a  CAS om vs om: A (owner) trece semnalul în in_lucru cu versiunea 1, NECOMIS; B (MP) trimite asteapta_informatii cu ACEEAȘI versiune 1 →
#        așteaptă la FOR UPDATE; A COMMIT → B: 00000 „false:conflict”; starea in_lucru, versiunea 2; jurnal = creat/agent, stare/om. Apoi calea
#        legitimă (doar fără mutant): B reîncarcă (versiunea 2) și retrimite → „true:-”. Mutant fara_versiune: B „true:-”, starea asteapta_informatii
#        (decizia lui A suprascrisă fără ca B s-o fi văzut), jurnal cu două stări.
#   S3b  CAS agent → om: A (agentul) actualizează semnalul (gravitate critic, versiunea 1 → 2), NECOMIS; B (MP) trimite in_lucru cu versiunea 1 citită
#        ÎNAINTE → așteaptă; A COMMIT → B: „false:conflict” (ecranul reîncarcă, omul vede noua constatare); starea nou. Apoi calea legitimă (fără
#        mutant): versiunea 2 → „true:-”. Mutant fara_versiune: B „true:-” peste o constatare pe care nu a văzut-o.
set -u
set -o pipefail

if [ "${REST_CLUSTER_DISPENSABIL:-}" != "da" ]; then
  echo "refuz: scriptul creeaza / sterge o baza si poate crea roluri la nivel de CLUSTER; ruleaza-l DOAR pe un cluster complet dispensabil, cu REST_CLUSTER_DISPENSABIL=da" >&2
  exit 2
fi
if [ $# -ne 1 ] || ! [[ "$1" =~ ^[a-z][a-z0-9_]{2,40}$ ]]; then echo "folosire: REST_CLUSTER_DISPENSABIL=da [SEMNALE_MUTANT=fara_conflict|fara_for_update|fara_versiune] $0 <nume_baza_noua (a-z0-9_)>" >&2; exit 2; fi
BAZA="$1"
MUTANT="${SEMNALE_MUTANT:-nu}"
case "$MUTANT" in nu|fara_conflict|fara_for_update|fara_versiune) ;; *) echo "refuz: SEMNALE_MUTANT necunoscut: $MUTANT (nu | fara_conflict | fara_for_update | fara_versiune)" >&2; exit 2;; esac
RADACINA="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$RADACINA/supabase/migrations/20270106a_executie_semnale.sql"
M09="$RADACINA/supabase/migrations/20261209a_executie_acces_proiect.sql"
SCHELET="$RADACINA/supabase/tests/20270106a_executie_semnale_schelet.sql"
[ -r "$MIG" ] && [ -r "$M09" ] && [ -r "$SCHELET" ] || { echo "lipsesc migrarile / scheletul" >&2; exit 2; }
command -v python3 > /dev/null || { echo "refuz: python3 lipseste (extragerea SQL-ului)" >&2; exit 2; }

PSM=(psql -X -q -w -v ON_ERROR_STOP=1 -d postgres)
VERS_CLIENT="$(psql --version 2>/dev/null | sed -n 's/^psql (PostgreSQL) \([0-9]*\).*/\1/p')"
if [ -z "$VERS_CLIENT" ] || [ "$VERS_CLIENT" -lt 13 ]; then echo "refuz: psql >= 13 (\\warn exista din psql 13); gasit: $(psql --version 2>&1)" >&2; exit 2; fi
PRE="$("${PSM[@]}" -tAc "SELECT current_setting('server_version_num')::int >= 170000, current_user = 'postgres', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), EXISTS (SELECT 1 FROM pg_database WHERE datname = '$BAZA')")" || { echo "refuz: nu ma pot conecta la baza postgres" >&2; exit 2; }
case "$PRE" in
  t\|t\|t\|f) ;;
  t\|t\|t\|t) echo "refuz: baza $BAZA exista deja (aleg alt nume; nu sterg nimic existent)" >&2; exit 2;;
  *) echo "refuz: cere PostgreSQL >= 17, current_user = postgres, superuser (primit: $PRE)" >&2; exit 2;;
esac
# rolurile preexistente trebuie să fie ca în schelet (fără superuser; BYPASSRLS doar service_role), altfel proba ar măsura altceva
ROL_ALTFEL="$("${PSM[@]}" -tAc "SELECT coalesce(string_agg(rolname, ' ' ORDER BY rolname), '') FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') AND (rolsuper OR rolbypassrls IS DISTINCT FROM (rolname = 'service_role'))")" || exit 2
if [ -n "$ROL_ALTFEL" ]; then echo "refuz: rolurile existente $ROL_ALTFEL au alte atribute decat scheletul (superuser / BYPASSRLS); nu le ating" >&2; exit 2; fi

D="$(mktemp -d -t semnale_concurenta_XXXXXX)"
A_OUT="$D/A.stdout.log"; A_ERR="$D/A.stderr.log"; B_LOG="$D/B.log"
: > "$A_ERR"; : > "$B_LOG"
BAZA_CREATA=0; A_DESCHIS=0; esec=0; B_PID=''
ROLURI=(anon authenticated service_role)
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
UID_OWNER=f0000000-0000-4000-8000-00000000a0a1
UID_MP=f0000000-0000-4000-8000-00000000a0b2
ca() { printf "SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '%s', true), set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true);" "$1" "$1"; }
CA_AGENT='SET LOCAL ROLE service_role;'

# semnalul agentului: toate cheile obligatorii + dovada „constatat”, valori scrise de mână (ASCII); <extra> = câmpuri JSON care le suprascriu
# (jsonb păstrează ULTIMA valoare la chei duble). Rezultatul: actiune (creat / actualizat / neschimbat / redeschis / neschimbat_inchis).
P_BAZA='"proiect_id":9301,"flux":"lipsuri","tip":"termen_apropiat","gravitate":"atentie","titlu":"Termenul contractului se apropie","constatare":"constatat","surse_consultate":["ERP: executie_proiecte.data_termen"],"dovada_sursa":"camp_erp","dovada_data":"2026-11-21","dovada_fragment":"data_termen = 2026-12-11","dovada_ref":"executie_proiecte.data_termen","termen":"2026-12-11","termen_baza":"campul data_termen","termen_confirmat":true,"regula_versiune":"lipsuri-v1"'
agent() {   # <obiect> [campuri json suplimentare, fara acolade] → SQL fara ;
  local extra="${2:-}"
  printf "SELECT coalesce(public.fn_executie_semnal_scrie('{%s,\"obiect\":\"%s\"%s}'::jsonb) ->> 'actiune', '-') AS r" "$P_BAZA" "$1" "${extra:+,$extra}"
}
# RPC-ul omului; rezultatul: <ok>:<motiv> (true:- = aplicat; false:conflict = CAS). CTE MATERIALIZED = RPC-ul se cheamă O SINGURĂ dată.
om() {   # <id> <versiune> <stare SQL|NULL> <motiv SQL|NULL> <responsabil|NULL> <schimba_responsabil true|false> → SQL fara ;
  printf "WITH s AS MATERIALIZED (SELECT public.fn_executie_semnal_stare(%s, %s, %s, %s, NULL, NULL, %s, %s) AS x) SELECT coalesce(x ->> 'ok', '-') || ':' || coalesce(x ->> 'motiv', '-') AS r FROM s" "$@"
}
idS() { q "SELECT id FROM public.executie_semnale WHERE proiect_id = 9301 AND tip = 'termen_apropiat' AND obiect = '$1'"; }
randuri() { q "SELECT count(*) FROM public.executie_semnale WHERE proiect_id = 9301 AND tip = 'termen_apropiat' AND obiect = '$1'"; }
jur() { q "SELECT coalesce(string_agg(j.actiune || '/' || j.actor, ',' ORDER BY j.id), '-') FROM public.executie_semnale_jurnal j JOIN public.executie_semnale s ON s.id = j.semnal_id WHERE s.proiect_id = 9301 AND s.obiect = '$1'"; }
stareS() { q "SELECT stare || '|' || coalesce(stare_motiv, '-') || '|' || coalesce(responsabil_employee_id::text, '-') || '|' || coalesce(responsabil_sursa, '-') || '|' || versiune FROM public.executie_semnale WHERE proiect_id = 9301 AND obiect = '$1'"; }

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
# pas cu rezultat: BEGIN + rolul + RPC-ul (necomis); A_STARE = „<SQLSTATE> <rezultat>”
pasAr() {   # <marcaj> <prolog rol> <sql fara ;>
  printf '%s\n' "BEGIN;" "$2" '\set r -' "$3 \\gset" "\\warn $1 :SQLSTATE :r" >&"$A_FD_IN"; asteaptaA "$1"
}
inchideA() {
  local linie c=1
  { printf '%s\n' '\q' >&"$A_FD_IN"; } 2>/dev/null || true
  while IFS= read -r -t 60 -u "$A_FD_OUT" linie 2>/dev/null; do printf '%s\n' "$linie" >> "$A_ERR"; done
  wait "$A_PID_C" 2>/dev/null; c=$?
  [ "$c" = 127 ] && c=0
  A_DESCHIS=0
  return "$c"
}
# B în FUNDAL: psql separat cu application_name distinct; „<SQLSTATE> <rezultat>” în fișierul marcajului
porniB() {   # <marcaj> <prolog rol> <sql fara ;>
  local marcaj="$1" prolog="$2" sql="$3"
  B_FIS="$D/B_$marcaj.out"
  PGAPPNAME="sem_B_$marcaj" psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f - > "$B_FIS" 2>&1 <<EOF &
SET lock_timeout = '10s';
BEGIN;
$prolog
\set r -
$sql \gset
\echo $marcaj :SQLSTATE :r
COMMIT;
EOF
  B_PID=$!
}
# bariera a doua: backend-ul lui B așteaptă un LOCK (stare observată în pg_stat_activity), nu un timp
asteaptaBlocatB() {   # <marcaj>
  local i=0 s
  while [ $i -lt 600 ]; do
    s="$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'sem_B_$1' AND wait_event_type = 'Lock'")"
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
ruleazaSincron() {   # <marcaj> <prolog rol> <sql fara ;> → B_STARE (fără concurent)
  porniB "$1" "$2" "$3"; terminaB "$1"
}
# un scenariu cu barieră: A ține scrierea necomisă, B pornește, B ajunge la lock, A COMMIT, B termină
concurent() {   # <S> <prolog A> <sql A> <astept A> <prolog B> <sql B> → B_STARE
  pasAr "$1a" "$2" "$3"; astept "$4" "$A_STARE" "A: scrierea $1, NECOMISA"
  porniB "$1b" "$5" "$6"
  asteaptaBlocatB "$1b"; ok $? "B ($1): asteapta lock-ul tinut de A (pg_stat_activity: Lock)"
  pasA "$1c" "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  terminaB "$1b"
}

echo "0. baza de unica folosinta: scheletul + lantul de drept (20261209a) + DDL-ul migrarii 20270106a, mutant=$MUTANT"
EXISTENTE=" $("${PSM[@]}" -tAc "SELECT string_agg(rolname, ' ') FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')") "
for r in "${ROLURI[@]}"; do
  case "$EXISTENTE" in *" $r "*) continue;; esac
  if [ "$r" = service_role ]; then atr='NOLOGIN NOINHERIT BYPASSRLS'; else atr='NOLOGIN NOINHERIT'; fi
  if "${PSM[@]}" -c "CREATE ROLE \"$r\" $atr" > /dev/null; then ROLURI_CREATE+=("$r"); else echo "refuz: CREATE ROLE $r a esuat" >&2; exit 2; fi
done
echo "     roluri de cluster create (si sterse la final): ${ROLURI_CREATE[*]:-niciunul}"
if "${PSM[@]}" -c "CREATE DATABASE \"$BAZA\"" > /dev/null; then BAZA_CREATA=1; ok 0 "CREATE DATABASE $BAZA"; else echo "refuz: CREATE DATABASE $BAZA a esuat" >&2; exit 2; fi

# extragerea (python3, fără CR): scheletul fără CREATE ROLE, lanțul de drept din 20261209a (amprente verificate), DDL-ul migrării (+ mutantul)
python3 - "$SCHELET" "$M09" "$MIG" "$D" "$MUTANT" <<'PY'
import hashlib, re, sys
schelet_p, m09_p, mig_p, d, mutant = sys.argv[1:6]
citeste = lambda p: open(p, encoding='utf-8').read().replace('\r', '')
SCH, M09, MIG = citeste(schelet_p), citeste(m09_p), citeste(mig_p)
def scrie(nume, text):
    open(d + '/' + nume, 'w', encoding='utf-8').write(text)
# 1. scheletul fără cele 3 CREATE ROLE (rolurile le-a creat scriptul, doar dacă lipseau)
roluri = re.compile(r'^CREATE ROLE (anon|authenticated|service_role) NOLOGIN NOINHERIT( BYPASSRLS)?;\n', re.M)
sch2, n = roluri.subn('', SCH)
if n != 3: sys.exit('scheletul: astept 3 randuri CREATE ROLE, gasit %d' % n)
scrie('schelet.sql', sch2)
# 2. lanțul de drept, EXACT ca în 20261209a (același algoritm ca scripts/pglite/test_executie_semnale_local.mjs)
LANT = [
    ('fn_executie_acces_nerestrans_cont', 'CREATE FUNCTION public.fn_executie_acces_nerestrans_cont(', '9a07e0089139e54ba5c6a0cfaaf093cc'),
    ('fn_executie_acces_lista_cont', 'CREATE FUNCTION public.fn_executie_acces_lista_cont(', 'e7cf9b852002a1c1cbe781772c33bf0c'),
    ('fn_executie_acces_nerestrans', 'CREATE FUNCTION public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1'),
    ('fn_executie_acces_lista', 'CREATE FUNCTION public.fn_executie_acces_lista(', 'd9e123a46b83530a7203d4a24da5cf9b'),
    ('fn_executie_proiect_permis', 'CREATE FUNCTION public.fn_executie_proiect_permis(', 'bd4320f76e9f36f492c7186c0a982155'),
]
lant = ''
for nume, cap, amp in LANT:
    if M09.count(cap) != 1: sys.exit('20261209a: %s apare de %d ori' % (cap, M09.count(cap)))
    i = M09.index(cap)
    a = re.search(r'\bAS\s+(\$[A-Za-z_]*\$)', M09[i:])
    tag = a.group(1); start = i + a.end()
    f = M09[i:M09.index(';', M09.index(tag, start) + len(tag)) + 1]
    corp = f[f.index('$f$') + 3:f.rindex('$f$')]
    if hashlib.md5(corp.encode('utf-8')).hexdigest() != amp or ("'%s'" % amp) not in MIG:
        sys.exit('lantul de drept: %s are alta amprenta decat cea revizuita in 20270106a' % nume)
    acl = [l for l in M09.split('\n') if re.match(r'^(REVOKE|GRANT) ', l) and ('ON FUNCTION public.' + nume + '(') in l]
    lant += f + '\n' + '\n'.join(acl) + '\n'
lant += ('CREATE POLICY executie_acces_proiect_citire ON public.executie_proiecte AS RESTRICTIVE FOR SELECT TO authenticated\n'
         '  USING ((SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_proiect_permis(id::bigint, false));\n')
scrie('lant.sql', lant)
# 3. DDL-ul migrării: între marcaje, fără gărzile runnerului
inc, sf = '\n-- ── spațiul alb al unui text', '\n-- ── postcondiții ──'
if MIG.count(inc) != 1 or MIG.count(sf) != 1: sys.exit('migrarea: marcajele DDL-ului nu apar exact o data')
ddl = MIG[MIG.index(inc) + 1:MIG.index(sf) + 1]
for interzis in ('$pre$', '$lock$', '$post$', 'pg_temp.lant_', 'gazpet.livrare_migrare'):
    if interzis in ddl: sys.exit('DDL-ul extras contine o garda a runnerului: ' + interzis)
# 4. mutantul: fiecare text EXACT o dată (altfel refuz: mutantul nu s-ar aplica)
MUTANTI = {
    'nu': [],
    'fara_conflict': [("    ON CONFLICT ON CONSTRAINT executie_semnale_cheie_uq DO NOTHING\n", "")],
    'fara_for_update': [("s.obiect = v_obiect FOR UPDATE;\n  IF NOT FOUND THEN\n", "s.obiect = v_obiect;\n  IF NOT FOUND THEN\n")],
    'fara_versiune': [("  IF r.versiune <> p_versiune THEN\n    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'semnal', to_jsonb(r));\n  END IF;\n", ""),
                      ("   WHERE s.id = r.id AND s.versiune = p_versiune\n", "   WHERE s.id = r.id\n")],
}
for din, in_ in MUTANTI[mutant]:
    if ddl.count(din) != 1: sys.exit('mutantul %s: textul apare de %d ori: %r' % (mutant, ddl.count(din), din[:80]))
    ddl = ddl.replace(din, in_)
scrie('ddl.sql', ddl)
print('     extras: schelet (-3 CREATE ROLE), lant (5 functii, amprente verificate), DDL %d caractere, mutant %s (%d inlocuiri)' % (len(ddl), mutant, len(MUTANTI[mutant])))
PY
rc=$?
ok "$rc" "SQL-ul extras (schelet, lantul de drept cu amprentele revizuite, DDL-ul migrarii; mutant: $MUTANT)"
[ "$rc" = 0 ] || exit 1
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f "$D/schelet.sql" > /dev/null; ok $? "scheletul"
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f "$D/lant.sql" > /dev/null; ok $? "lantul de drept pe proiect (20261209a)"
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f "$D/ddl.sql" > /dev/null; ok $? "DDL-ul migrarii 20270106a"
astept "12|4|1" "$(q "SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\\_executie\\_semnal\\_%'),
  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.executie_semnale'::regclass, 'public.executie_semnale_jurnal'::regclass)),
  (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.executie_semnale'::regclass AND conname = 'executie_semnale_cheie_uq')")" "obiectele migrarii: functii | trigger-e | UNIQUE"
# fixturi: owner (a), MP (b, emp 9201) al proiectului 9301; responsabilii 9202 / 9203 (angajați activi, fără cont)
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 > /dev/null <<EOF
INSERT INTO public.employees (id, name, active) VALUES (9201, 'SEM MP', true), (9202, 'SEM RESPONSABIL', true), (9203, 'SEM ALT', true);
INSERT INTO public.profiles (id, name, is_owner, employee_id) VALUES ('$UID_OWNER', 'SEM OWNER', true, NULL), ('$UID_MP', 'SEM MP', false, 9201);
INSERT INTO public.executie_proiecte (id, cod_intern, nume, mp_employee_id) VALUES (9301, 'SEM-CONC', 'Semnale concurenta', 9201);
EOF
ok $? "fixturile (owner, MP-ul proiectului 9301, doi responsabili)"

# așteptările pe mutant (doar scenariile mutantului se schimbă)
if [ "$MUTANT" = fara_conflict ]; then AST_S1A_B='23505 -'; AST_S1A_ST='nou|-|-|-|1'; else AST_S1A_B='00000 neschimbat'; AST_S1A_ST='nou|-|-|-|2'; fi
if [ "$MUTANT" = fara_for_update ]; then
  AST_S1B_B='00000 actualizat'; AST_S1B_J='creat/agent,actualizat/agent,actualizat/agent'
  AST_S2A_B='00000 actualizat'; AST_S2A_J='creat/agent,stare/om,actualizat/agent'
  AST_S2B_B='00000 actualizat'; AST_S2B_J='creat/agent,responsabil/om,actualizat/agent'
else
  AST_S1B_B='00000 neschimbat'; AST_S1B_J='creat/agent,actualizat/agent'
  AST_S2A_B='00000 neschimbat_inchis'; AST_S2A_J='creat/agent,stare/om'
  AST_S2B_B='00000 neschimbat'; AST_S2B_J='creat/agent,responsabil/om'
fi
if [ "$MUTANT" = fara_versiune ]; then
  AST_S3A_B='00000 true:-'; AST_S3A_ST='asteapta_informatii|-|-|-|3'; AST_S3A_J='creat/agent,stare/om,stare/om'
  AST_S3B_B='00000 true:-'; AST_S3B_ST='in_lucru|-|-|-|3'; AST_S3B_J='creat/agent,actualizat/agent,stare/om'
else
  AST_S3A_B='00000 false:conflict'; AST_S3A_ST='in_lucru|-|-|-|2'; AST_S3A_J='creat/agent,stare/om'
  AST_S3B_B='00000 false:conflict'; AST_S3B_ST='nou|-|-|-|2'; AST_S3B_J='creat/agent,actualizat/agent'
fi
NOUA_DOVADA='"gravitate":"critic","titlu":"Termenul contractului a fost depasit"'

deschideA
pasA A0 "SET lock_timeout = '5s';"; astept 00000 "$A_STARE" "A: sesiunea deschisa"

echo "S1a. doi agenti scriu SIMULTAN acelasi semnal NOU (astept B: $AST_S1A_B)"
concurent S1a "$CA_AGENT" "$(agent conc:s1a)" '00000 creat' "$CA_AGENT" "$(agent conc:s1a)"
astept "$AST_S1A_B" "$B_STARE" "B (agent): al doilea apel, dupa COMMIT-ul primului"
astept 1 "$(randuri conc:s1a)" "un singur rand pe cheia (proiect, tip, obiect)"
astept 'creat/agent' "$(jur conc:s1a)" "jurnalul (o singura creare)"
astept "$AST_S1A_ST" "$(stareS conc:s1a)" "stare | motiv | responsabil | sursa | versiune"

echo "S1b. doi agenti actualizeaza SIMULTAN un semnal existent cu aceeasi dovada noua (astept B: $AST_S1B_B)"
ruleazaSincron S1b0 "$CA_AGENT" "$(agent conc:s1b)"; astept '00000 creat' "$B_STARE" "semnalul S1b creat (fara concurent)"
concurent S1b "$CA_AGENT" "$(agent conc:s1b "$NOUA_DOVADA")" '00000 actualizat' "$CA_AGENT" "$(agent conc:s1b "$NOUA_DOVADA")"
astept "$AST_S1B_B" "$B_STARE" "B (agent): aceeasi actualizare, dupa COMMIT-ul lui A"
astept 1 "$(randuri conc:s1b)" "un singur rand"
astept "$AST_S1B_J" "$(jur conc:s1b)" "jurnalul (o singura actualizare)"
astept 'critic' "$(q "SELECT gravitate FROM public.executie_semnale WHERE proiect_id = 9301 AND obiect = 'conc:s1b'")" "constatarea noua scrisa"

echo "S2a. omul RESPINGE cat agentul rescrie acelasi semnal (astept B: $AST_S2A_B)"
ruleazaSincron S2a0 "$CA_AGENT" "$(agent conc:s2a)"; astept '00000 creat' "$B_STARE" "semnalul S2a creat"
ID="$(idS conc:s2a)"
concurent S2a "$(ca "$UID_MP")" "$(om "$ID" 1 "'respins'" "'nu e o problema reala'" NULL false)" '00000 true:-' "$CA_AGENT" "$(agent conc:s2a)"
astept "$AST_S2A_B" "$B_STARE" "B (agent): rescrierea, dupa COMMIT-ul respingerii"
astept 'respins|nu e o problema reala|-|-|3' "$(stareS conc:s2a)" "decizia omului ramane (respins + motivul lui)"
astept "$AST_S2A_J" "$(jur conc:s2a)" "jurnalul"

echo "S2b. omul STABILESTE responsabilul cat agentul propune altul (astept B: $AST_S2B_B)"
ruleazaSincron S2b0 "$CA_AGENT" "$(agent conc:s2b '"responsabil_employee_id":9203')"; astept '00000 creat' "$B_STARE" "semnalul S2b creat (responsabil propus de agent: 9203)"
astept 'nou|-|9203|agent|1' "$(stareS conc:s2b)" "responsabilul propus (sursa agent)"
ID="$(idS conc:s2b)"
concurent S2b "$(ca "$UID_OWNER")" "$(om "$ID" 1 NULL NULL 9202 true)" '00000 true:-' "$CA_AGENT" "$(agent conc:s2b '"responsabil_employee_id":9203')"
astept "$AST_S2B_B" "$B_STARE" "B (agent): propunerea 9203, dupa COMMIT-ul omului"
astept 'nou|-|9202|om|3' "$(stareS conc:s2b)" "responsabilul omului ramane (9202, sursa om)"
astept "$AST_S2B_J" "$(jur conc:s2b)" "jurnalul"

echo "S3a. CAS: doi oameni cu ACEEASI versiune (astept B: $AST_S3A_B)"
ruleazaSincron S3a0 "$CA_AGENT" "$(agent conc:s3a)"; astept '00000 creat' "$B_STARE" "semnalul S3a creat (versiunea 1)"
ID="$(idS conc:s3a)"
concurent S3a "$(ca "$UID_OWNER")" "$(om "$ID" 1 "'in_lucru'" NULL NULL false)" '00000 true:-' "$(ca "$UID_MP")" "$(om "$ID" 1 "'asteapta_informatii'" NULL NULL false)"
astept "$AST_S3A_B" "$B_STARE" "B (MP): aceeasi versiune 1, dupa COMMIT-ul lui A"
astept "$AST_S3A_ST" "$(stareS conc:s3a)" "starea finala"
astept "$AST_S3A_J" "$(jur conc:s3a)" "jurnalul"
if [ "$MUTANT" = nu ]; then
  ruleazaSincron S3a9 "$(ca "$UID_MP")" "$(om "$ID" 2 "'asteapta_informatii'" NULL NULL false)"; astept '00000 true:-' "$B_STARE" "calea legitima: MP-ul reincarca (versiunea 2) si retrimite"
  astept 'asteapta_informatii|-|-|-|3' "$(stareS conc:s3a)" "starea dupa retrimitere"
fi

echo "S3b. CAS: agentul actualizeaza cat omul trimite cu versiunea citita inainte (astept B: $AST_S3B_B)"
ruleazaSincron S3b0 "$CA_AGENT" "$(agent conc:s3b)"; astept '00000 creat' "$B_STARE" "semnalul S3b creat (versiunea 1)"
ID="$(idS conc:s3b)"
concurent S3b "$CA_AGENT" "$(agent conc:s3b "$NOUA_DOVADA")" '00000 actualizat' "$(ca "$UID_MP")" "$(om "$ID" 1 "'in_lucru'" NULL NULL false)"
astept "$AST_S3B_B" "$B_STARE" "B (MP): versiunea 1, dupa COMMIT-ul agentului"
astept "$AST_S3B_ST" "$(stareS conc:s3b)" "starea finala"
astept "$AST_S3B_J" "$(jur conc:s3b)" "jurnalul"
if [ "$MUTANT" = nu ]; then
  ruleazaSincron S3b9 "$(ca "$UID_MP")" "$(om "$ID" 2 "'in_lucru'" NULL NULL false)"; astept '00000 true:-' "$B_STARE" "calea legitima: MP-ul reincarca (versiunea 2) si retrimite"
fi

astept 6 "$(q "SELECT count(*) FROM public.executie_semnale")" "semnale in total (cate unul pe scenariu)"
inchideA; ok $? "sesiunea A inchisa curat"
[ "$esec" = 0 ] && echo "TOTUL OK" || echo "ESEC: $esec"
