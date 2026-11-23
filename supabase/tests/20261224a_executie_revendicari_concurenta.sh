#!/usr/bin/env bash
# Proba de CONCURENȚĂ a migrării 20261224a (Execuție → dosarul de revendicare): DOUĂ sesiuni psql REALE, cu barieră explicită, pe un cluster
# PostgreSQL ≥ 17 COMPLET DISPENSABIL. PGlite (o singură conexiune) nu poate proba asta. Același model ca
# supabase/tests/20270106a_executie_semnale_concurenta.sh (înlocuiește scripts/executie_revendicari_concurenta.sh din runda 2, care cerea o clonă
# cu date și o barieră prin lock consultativ ținut de o a treia sesiune).
# NETESTAT de autor (serverul de cod nu are PostgreSQL); îl rulează coordonatorul.
#
# CE ATINGE (exact):
#   * BAZA: creează baza <nume_baza_noua> (refuză dacă există deja) și o ȘTERGE la final (DROP DATABASE … WITH (FORCE)), inclusiv la întrerupere
#     (trap EXIT / INT / TERM). Nu se conectează la nicio altă bază decât `postgres` (pentru CREATE / DROP / roluri) și baza nouă.
#   * ROLURI la nivel de CLUSTER: anon, authenticated (NOLOGIN NOINHERIT) și service_role (NOLOGIN NOINHERIT BYPASSRLS), ca în scheletul
#     supabase/tests/20261224a_executie_revendicari_schelet.sql, create DOAR dacă lipsesc (scheletul se aplică FĂRĂ cele 3 rânduri CREATE ROLE) și
#     ȘTERSE la final doar cele create aici; rolurile preexistente nu sunt atinse, dar trebuie să aibă atributele scheletului (altfel refuz, ieșire 2).
#     De aceea rulează DOAR cu REV_CLUSTER_DISPENSABIL=da: NU pe clona de producție, NU pe un cluster folosit la altceva.
#   * FIȘIERE: un folder temporar (mktemp -d) cu SQL-ul extras și jurnalele sesiunilor; șters la final (la eșec, cozile jurnalelor se afișează înainte).
#   * REȚEA: doar conexiunile psql la cluster (PGHOST / PGPORT / PGUSER / PGPASSWORD sau pgpass).
# CE APLICĂ (aceeași bază ca proba PGlite, scripts/pglite/test_executie_revendicari_local.mjs): scheletul (fără CREATE ROLE) + cele 5 funcții ale
#   restricției pe proiect extrase EXACT din 20261209a (amprentele md5 = constantele din $pre$-ul lui 20261224a, verificate) + 20261203a întreagă
#   (fișa contractului, cu marcajul ei de livrare) + fn_executie_contract_drept din 20261209a + DDL-ul migrării 20261224a = textul EXACT dintre
#   marcajele „-- ── 0. funcții fără tabele” și „-- ── 9. postcondiții”, FĂRĂ gărzile runnerului ($pre$, $lock$, $post$). Aplicarea completă prin
#   runner (L15 v2, plafonul extins, aplicare → revenire → reaplicare) e pasul SEPARAT al coordonatorului, pe clonă.
#
# CUM SE RULEAZĂ (coordonatorul; cere bash ≥ 4 (coproc), psql ≥ 13 (\warn), python3, conectare ca superuser `postgres`):
#     REV_CLUSTER_DISPENSABIL=da PGHOST=… PGPORT=… PGUSER=postgres bash supabase/tests/20261224a_executie_revendicari_concurenta.sh <nume_baza_noua>
#     … REV_MUTANT=fara_for_update bash …     → fn_executie_revendicare_dosar_blocheaza FĂRĂ „FOR UPDATE”: K1 așteaptă rezultatul OPUS.
#     … REV_MUTANT=fara_advisory bash …       → fn_executie_revendicare_cheie_blocheaza FĂRĂ lock-ul consultativ: K2 / K3 așteaptă OPUSUL (23505).
#     … REV_MUTANT=fara_reverificare bash …   → dosar_blocheaza FĂRĂ reverificarea dreptului după lock: K4 așteaptă OPUSUL (B scrie).
#   Fiecare mutant schimbă DOAR așteptările scenariilor lui; restul scenariilor rulează identic (și trebuie să treacă).
#   Ieșire: 0 = toate așteptările se țin și curățenia a reușit; 1 = cel puțin o așteptare nu se ține (sau curățenia a eșuat); 2 = refuz / folosire greșită.
#
# BARIERA (fără sleep orb): sesiunea A e un psql ținut deschis (coproc): BEGIN; <RPC-ul> (NECOMIS: ține lock-ul consultativ al cheii și / sau
#   rândul dosarului FOR UPDATE); marcajul `\warn <PAS> :SQLSTATE :r` pe stderr confirmă pasul și dă rezultatul. Sesiunea B pornește în FUNDAL cu
#   RPC-ul concurent; o a treia conexiune întreabă pg_stat_activity până când backend-ul lui B e în wait_event_type = 'Lock' (stare observată, nu
#   timp). (K4) Cât B așteaptă, scriptul COMITE schimbarea concurentă (dreptul retras), ca postgres. Abia apoi A: COMMIT. B se trezește și
#   termină; SQLSTATE-ul și rezultatul RPC-ului se citesc din psql (:SQLSTATE, \gset), starea finală din SELECT-uri ca postgres. Singurele
#   timpuri: lock_timeout 10 s în B (plasă) și read -t 60 (dacă A moare).
#
# SCENARII (așteptările scrise de mână; owner = contul a; „MP” = contul b, angajatul 9201, managerul proiectului 9301, cu Execuție „editor”,
#   NERESTRÂNS — fără rânduri în executie_acces_proiect —, deci cu drept de scriere pe dosarele proiectului lui). Rezultatul unui RPC de scriere:
#   <ok>:<duplicat|motiv>:<id-ul rândului>. Fiecare scenariu are dosarul / cheia lui, deci sunt independente.
#   K1  CAS pe dosar: două salvări ale ACELUIAȘI dosar cu ACEEAȘI versiune văzută, chei diferite. A (owner) salvează titlul „K1 A”, NECOMIS
#       (dosarul FOR UPDATE); B (MP) salvează „K1 T” → așteaptă rândul dosarului; A COMMIT → B: 00000 „false:conflict” (versiunea s-a schimbat),
#       nimic scris de B (titlul A, versiunea v+1, niciun rând de jurnal cu titlul lui B, nicio cheie a lui B). Mutant fara_for_update: B citește
#       versiunea VECHE fără lock, trece de CAS, UPDATE-ul lui așteaptă și se aplică PESTE A → „true:false”, titlul lui B.
#   K2  aceeași cheie de intenție (crearea unui dosar), același conținut, trimisă de două ori în paralel (același cont): A creează, NECOMIS (ține
#       lock-ul consultativ al cheii); B așteaptă lock-ul; A COMMIT → B: 00000 „true:true:<același id>” (duplicat recunoscut); un singur dosar.
#       Mutant fara_advisory: B nu așteaptă cheia, creează alt dosar, apoi INSERT-ul cheii așteaptă intrarea necomisă din cheia primară →
#       23505 după COMMIT-ul lui A (tranzacția lui B anulată: tot un singur dosar, dar reluarea pică în loc să fie recunoscută).
#   K3  aceeași cheie, ALT conținut, în paralel: B așteaptă; A COMMIT → B: 22023 („cheia intentiei a fost folosita pentru alta operatie”); niciun
#       dosar cu titlul lui B. Mutant fara_advisory: 23505 (ca la K2).
#   K4  dreptul RETRAS cât apelul așteaptă lock-ul (runda 2, P2-4; L01): A (owner) adaugă un termen pe dosar, NECOMIS (dosarul FOR UPDATE, dosarul
#       însuși nemodificat); B (MP) salvează dosarul cu versiunea curentă → trece de verificarea dreptului DINAINTEA lock-ului, așteaptă rândul;
#       cât așteaptă, scriptul COMITE restricția MP-ului pe proiect la „viewer” (fără scriere; 20261209a); A COMMIT → B: 42501 (reverificarea
#       dreptului DUPĂ lock, instantaneu nou), titlul dosarului NESCHIMBAT, niciun rând de jurnal cu titlul lui B; termenul lui A scris. Mutant
#       fara_reverificare: B „true:false” și titlul lui B (scrie fără drept).
set -u
set -o pipefail

if [ "${REV_CLUSTER_DISPENSABIL:-}" != "da" ]; then
  echo "refuz: scriptul creeaza / sterge o baza si poate crea roluri la nivel de CLUSTER; ruleaza-l DOAR pe un cluster complet dispensabil, cu REV_CLUSTER_DISPENSABIL=da" >&2
  exit 2
fi
if [ $# -ne 1 ] || ! [[ "$1" =~ ^[a-z][a-z0-9_]{2,40}$ ]]; then echo "folosire: REV_CLUSTER_DISPENSABIL=da [REV_MUTANT=fara_for_update|fara_advisory|fara_reverificare] $0 <nume_baza_noua (a-z0-9_)>" >&2; exit 2; fi
BAZA="$1"
MUTANT="${REV_MUTANT:-nu}"
case "$MUTANT" in nu|fara_for_update|fara_advisory|fara_reverificare) ;; *) echo "refuz: REV_MUTANT necunoscut: $MUTANT (nu | fara_for_update | fara_advisory | fara_reverificare)" >&2; exit 2;; esac
RADACINA="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$RADACINA/supabase/migrations/20261224a_executie_revendicari.sql"
M09="$RADACINA/supabase/migrations/20261209a_executie_acces_proiect.sql"
M03="$RADACINA/supabase/migrations/20261203a_executie_contract_repere.sql"
SCHELET="$RADACINA/supabase/tests/20261224a_executie_revendicari_schelet.sql"
[ -r "$MIG" ] && [ -r "$M09" ] && [ -r "$M03" ] && [ -r "$SCHELET" ] || { echo "lipsesc migrarile / scheletul" >&2; exit 2; }
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

D="$(mktemp -d -t revendicari_concurenta_XXXXXX)"
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
# mai multe instrucțiuni (BEGIN; rolul; SELECT; COMMIT): din stdin, ca psql să tipărească rezultatul FIECĂREIA (cu -c, psql < 15 îl arată doar pe ultimul)
qf() { psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tA -f - <<< "$1"; }
UID_OWNER=f0000000-0000-4000-8000-00000000c0a1
UID_MP=f0000000-0000-4000-8000-00000000c0b2
# contul: rolul authenticated + JWT-ul în AMBELE surse citite de auth.uid() (sub întâi), ca PostgREST
ca() { printf "SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '%s', true), set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true);" "$1" "$1"; }
# RPC de scriere → <ok>:<duplicat|motiv>:<id-ul rândului>. CTE MATERIALIZED = RPC-ul se cheamă O SINGURĂ dată.
rez() { printf "WITH s AS MATERIALIZED (SELECT %s AS x) SELECT coalesce(x ->> 'ok', '-') || ':' || coalesce(x ->> 'duplicat', x ->> 'motiv', '-') || ':' || coalesce(x -> 'rand' ->> 'id', '-') AS r FROM s" "$1"; }
dosar() {   # <id|NULL> <versiune|NULL> <titlu> <cheie> → apelul RPC (fără SELECT)
  printf "public.fn_executie_revendicare_salveaza_dosar(9301, %s, %s, '{\"titlu\":\"%s\"}'::jsonb, '%s'::uuid)" "$1" "$2" "$3" "$4"
}
termen() {  # <dosar> <cheie>
  printf "public.fn_executie_revendicare_termen(%s, NULL, NULL, '{\"tip_obligatie\":\"dezacord\",\"mod\":\"manual\",\"declansator_tip\":\"alt\"}'::jsonb, '%s'::uuid)" "$1" "$2"
}
stareD() { q "SELECT titlu || '|' || versiune FROM public.executie_revendicari WHERE id = $1"; }
jurTitlu() { q "SELECT count(*) FROM public.executie_revendicare_jurnal WHERE dosar_id = $1 AND dupa ->> 'titlu' = '$2'"; }
nrDosare() { q "SELECT count(*) FROM public.executie_revendicari WHERE titlu = '$1'"; }
cheie() { q "SELECT gen_random_uuid()"; }

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
  PGAPPNAME="rev_B_$marcaj" psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f - > "$B_FIS" 2>&1 <<EOF &
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
    s="$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'rev_B_$1' AND wait_event_type = 'Lock'")"
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
# un scenariu cu barieră: A ține scrierea necomisă, B pornește, B ajunge la lock, [schimbarea concurentă comisă], A COMMIT, B termină
concurent() {   # <K> <prolog A> <sql A> <astept A> <prolog B> <sql B> [<sql comis cat B asteapta>] → B_STARE
  pasAr "$1a" "$2" "$3"; astept "$4" "$(faraId "$A_STARE")" "A: scrierea $1, NECOMISA"
  porniB "$1b" "$5" "$6"
  asteaptaBlocatB "$1b"; ok $? "B ($1): asteapta lock-ul tinut de A (pg_stat_activity: Lock)"
  if [ -n "${7:-}" ]; then q "$7" > /dev/null; ok $? "schimbarea concurenta comisa cat B asteapta ($1)"; fi
  pasA "$1c" "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  terminaB "$1b"
}

echo "0. baza de unica folosinta: scheletul + restrictia pe proiect (20261209a) + fisa contractului (20261203a) + DDL-ul migrarii 20261224a, mutant=$MUTANT"
EXISTENTE=" $("${PSM[@]}" -tAc "SELECT string_agg(rolname, ' ') FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')") "
for r in "${ROLURI[@]}"; do
  case "$EXISTENTE" in *" $r "*) continue;; esac
  if [ "$r" = service_role ]; then atr='NOLOGIN NOINHERIT BYPASSRLS'; else atr='NOLOGIN NOINHERIT'; fi
  if "${PSM[@]}" -c "CREATE ROLE \"$r\" $atr" > /dev/null; then ROLURI_CREATE+=("$r"); else echo "refuz: CREATE ROLE $r a esuat" >&2; exit 2; fi
done
echo "     roluri de cluster create (si sterse la final): ${ROLURI_CREATE[*]:-niciunul}"
if "${PSM[@]}" -c "CREATE DATABASE \"$BAZA\"" > /dev/null; then BAZA_CREATA=1; ok 0 "CREATE DATABASE $BAZA"; else echo "refuz: CREATE DATABASE $BAZA a esuat" >&2; exit 2; fi

# extragerea (python3, fără CR): scheletul fără CREATE ROLE, restricția din 20261209a (amprente verificate), 20261203a + marcaj, DDL-ul (+ mutantul)
python3 - "$SCHELET" "$M09" "$M03" "$MIG" "$D" "$MUTANT" <<'PY'
import hashlib, re, sys
schelet_p, m09_p, m03_p, mig_p, d, mutant = sys.argv[1:7]
citeste = lambda p: open(p, encoding='utf-8').read().replace('\r', '')
SCH, M09, M03, MIG = citeste(schelet_p), citeste(m09_p), citeste(m03_p), citeste(mig_p)
def scrie(nume, text):
    open(d + '/' + nume, 'w', encoding='utf-8').write(text)
# 1. scheletul fără cele 3 CREATE ROLE (rolurile le-a creat scriptul, doar dacă lipseau)
roluri = re.compile(r'^CREATE ROLE (anon|authenticated|service_role) NOLOGIN NOINHERIT( BYPASSRLS)?;\n', re.M)
sch2, n = roluri.subn('', SCH)
if n != 3: sys.exit('scheletul: astept 3 randuri CREATE ROLE, gasit %d' % n)
scrie('schelet.sql', sch2)
# 2. funcțiile restricției pe proiect, EXACT ca în 20261209a (același algoritm ca proba PGlite: de la antet până la „;” de după al doilea $f$)
def functie(text, cap):
    if text.count(cap) != 1: sys.exit('20261209a: %s apare de %d ori' % (cap, text.count(cap)))
    i = text.index(cap); a = text.index('$f$', i); b = text.index('$f$', a + 3)
    return text[i:text.index(';', b) + 1], text[a + 3:b]
REST = [('CREATE FUNCTION public.fn_executie_acces_nerestrans_cont(', '9a07e0089139e54ba5c6a0cfaaf093cc'),
        ('CREATE FUNCTION public.fn_executie_acces_lista_cont(', 'e7cf9b852002a1c1cbe781772c33bf0c'),
        ('CREATE FUNCTION public.fn_executie_acces_nerestrans(', 'b863c5324684dbf4eb9af81474fbc4e1'),
        ('CREATE FUNCTION public.fn_executie_acces_lista(', 'd9e123a46b83530a7203d4a24da5cf9b'),
        ('CREATE FUNCTION public.fn_executie_proiect_permis(', 'bd4320f76e9f36f492c7186c0a982155')]
rest = ''
for cap, amp in REST:
    sql, corp = functie(M09, cap)
    if hashlib.md5(corp.encode('utf-8')).hexdigest() != amp or ("'%s'" % amp) not in MIG:
        sys.exit('restrictia pe proiect: %s are alta amprenta decat cea revizuita in 20261224a' % cap)
    rest += sql + '\n'
scrie('restrictie.sql', rest)
# 3. fișa contractului (20261203a) întreagă, cu marcajul ei de livrare în aceeași tranzacție (psql -1), apoi dreptul ei din 20261209a
scrie('m03.sql', "SELECT set_config('gazpet.livrare_migrare', '20261203a_executie_contract_repere:' || txid_current(), true);\n" + M03 + '\n')
scrie('contract_drept.sql', functie(M09, 'CREATE OR REPLACE FUNCTION public.fn_executie_contract_drept(')[0] + '\n')
# 4. DDL-ul migrării: între marcaje, fără gărzile runnerului
inc, sf = '\n-- ── 0. funcții fără tabele', '\n-- ── 9. postcondiții'
if MIG.count(inc) != 1 or MIG.count(sf) != 1: sys.exit('migrarea: marcajele DDL-ului nu apar exact o data')
ddl = MIG[MIG.index(inc) + 1:MIG.index(sf) + 1]
for interzis in ('$pre$', '$lock$', '$post$', 'gazpet.livrare_migrare', 'gazpet.plafon_tranzactie', 'gazpet.lock_puternic_la'):
    if interzis in ddl: sys.exit('DDL-ul extras contine o garda a runnerului: ' + interzis)
# 5. mutantul: fiecare text EXACT o dată (altfel refuz: mutantul nu s-ar aplica)
MUTANTI = {
    'nu': [],
    'fara_for_update': [("  SELECT * INTO r FROM public.executie_revendicari d WHERE d.id = p_dosar FOR UPDATE;\n",
                         "  SELECT * INTO r FROM public.executie_revendicari d WHERE d.id = p_dosar;\n")],
    'fara_advisory': [("  SELECT pg_advisory_xact_lock(hashtextextended('executie_revendicare_cheie:' || p_cheie::text, 0))\n",
                       "  SELECT NULL::void\n")],
    'fara_reverificare': [("  IF NOT public.fn_executie_revendicare_drept(r.proiect_id, p_nivel) THEN\n    RAISE EXCEPTION 'revendicari: dosarul nu exista sau nu ai drept' USING ERRCODE = '42501';\n  END IF;\n  RETURN r;\n",
                           "  RETURN r;\n")],
}
for din, in_ in MUTANTI[mutant]:
    if ddl.count(din) != 1: sys.exit('mutantul %s: textul apare de %d ori: %r' % (mutant, ddl.count(din), din[:80]))
    ddl = ddl.replace(din, in_)
scrie('ddl.sql', ddl)
print('     extras: schelet (-3 CREATE ROLE), restrictia (5 functii, amprente verificate), 20261203a + marcaj, DDL %d caractere, mutant %s (%d inlocuiri)' % (len(ddl), mutant, len(MUTANTI[mutant])))
PY
rc=$?
ok "$rc" "SQL-ul extras (schelet, restrictia pe proiect cu amprentele revizuite, fisa contractului, DDL-ul migrarii; mutant: $MUTANT)"
[ "$rc" = 0 ] || exit 1
for f in schelet restrictie m03 contract_drept ddl; do
  psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f "$D/$f.sql" > /dev/null; ok $? "aplicat: $f.sql"
done
astept "43|15|8|9" "$(q "SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\\_executie\\_revendicare\\_%'),
  (SELECT count(*) FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid WHERE NOT g.tgisinternal AND c.relnamespace = 'public'::regnamespace AND c.relname ~ '^executie_revendicar'),
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename ~ '^executie_revendicar'),
  (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname ~ '^executie_revendicar' AND relrowsecurity)")" "obiectele migrarii: functii | trigger-e | politici | tabele cu RLS"
# fixturi: owner (a); MP (b, angajatul 9201) al proiectului 9301, Execuție „editor”, nerestrâns
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 > /dev/null <<EOF
INSERT INTO public.employees (id, name) OVERRIDING SYSTEM VALUE VALUES (9201, 'REV MP');
INSERT INTO public.profiles (id, name, is_owner, employee_id) VALUES ('$UID_OWNER', 'REV OWNER', true, NULL), ('$UID_MP', 'REV MP', false, 9201);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('$UID_MP', 'executie', 'editor');
INSERT INTO public.executie_proiecte (id, nume, mp_employee_id) OVERRIDING SYSTEM VALUE VALUES (9301, 'REV-CONC', 9201);
EOF
ok $? "fixturile (owner, MP-ul proiectului 9301 cu Executie editor, nerestrans)"
astept "true|true|0" "$(qf "BEGIN; $(ca "$UID_MP") SELECT public.fn_executie_revendicare_drept(9301, 'scriere')::text || '|' || public.fn_executie_revendicare_drept(9301, 'citire')::text
  || '|' || (SELECT count(*) FROM public.executie_acces_proiect)::text; COMMIT;" | grep -E '^(true|false)\|')" "MP-ul: scriere | citire | restrictii (inainte de scenarii)"

# așteptările pe mutant (doar scenariile mutantului se schimbă)
if [ "$MUTANT" = fara_for_update ]; then AST_K1_B='00000 true:false'; AST_K1_T='CONCURENTA-REV K1 T'; else AST_K1_B='00000 false:conflict'; AST_K1_T='CONCURENTA-REV K1 A'; fi
if [ "$MUTANT" = fara_advisory ]; then AST_K2_B='23505 -'; AST_K3_B='23505 -'; else AST_K2_B='00000 true:true'; AST_K3_B='22023 -'; fi
if [ "$MUTANT" = fara_reverificare ]; then AST_K4_B='00000 true:false'; AST_K4_T='CONCURENTA-REV K4 T'; AST_K4_J=1; else AST_K4_B='42501 -'; AST_K4_T='CONCURENTA-REV K4'; AST_K4_J=0; fi
# rezultatul lui B fără id (id-ul se compară separat): „<SQLSTATE> <ok>:<duplicat|motiv>”
faraId() { printf '%s' "${1%:*}"; }

deschideA
pasA A0 "SET lock_timeout = '5s';"; astept 00000 "$A_STARE" "A: sesiunea deschisa"

echo "K1. CAS: doua salvari ale aceluiasi dosar cu aceeasi versiune (astept B: $AST_K1_B)"
ruleazaSincron K10 "$(ca "$UID_OWNER")" "$(rez "$(dosar NULL NULL 'CONCURENTA-REV K1' "$(cheie)")")"
D1="${B_STARE##*:}"; astept '00000 true:false' "$(faraId "$B_STARE")" "dosarul K1 creat (fara concurent), id $D1"
V1="$(q "SELECT versiune FROM public.executie_revendicari WHERE id = ${D1//[^0-9]/0}")"
concurent K1 "$(ca "$UID_OWNER")" "$(rez "$(dosar "$D1" "$V1" 'CONCURENTA-REV K1 A' "$(cheie)")")" '00000 true:false' \
  "$(ca "$UID_MP")" "$(rez "$(dosar "$D1" "$V1" 'CONCURENTA-REV K1 T' "$(cheie)")")"
astept "$AST_K1_B" "$(faraId "$B_STARE")" "B (MP): aceeasi versiune $V1, dupa COMMIT-ul lui A"
astept "$AST_K1_T" "$(q "SELECT titlu FROM public.executie_revendicari WHERE id = $D1")" "titlul final"
if [ "$MUTANT" = nu ]; then
  astept "CONCURENTA-REV K1 A|$((V1 + 1))" "$(stareD "$D1")" "titlul | versiunea (doar scrierea lui A)"
  astept 0 "$(jurTitlu "$D1" 'CONCURENTA-REV K1 T')" "niciun rand de jurnal cu titlul lui B"
  astept 2 "$(q "SELECT count(*) FROM public.executie_revendicare_chei WHERE dosar_id = $D1")" "cheile: crearea + salvarea lui A (nimic de la B)"
fi

echo "K2. aceeasi cheie, acelasi continut, in paralel (astept B: $AST_K2_B)"
K="$(cheie)"
concurent K2 "$(ca "$UID_OWNER")" "$(rez "$(dosar NULL NULL 'CONCURENTA-REV K2' "$K")")" '00000 true:false' \
  "$(ca "$UID_OWNER")" "$(rez "$(dosar NULL NULL 'CONCURENTA-REV K2' "$K")")"
astept "$AST_K2_B" "$(faraId "$B_STARE")" "B (aceeasi cheie): dupa COMMIT-ul lui A"
astept 1 "$(nrDosare 'CONCURENTA-REV K2')" "un singur dosar creat"
if [ "$MUTANT" = nu ]; then
  astept "$(q "SELECT id FROM public.executie_revendicari WHERE titlu = 'CONCURENTA-REV K2'")" "${B_STARE##*:}" "B primeste ACELASI id (duplicatul recunoscut)"
fi

echo "K3. aceeasi cheie, alt continut, in paralel (astept B: $AST_K3_B)"
K="$(cheie)"
concurent K3 "$(ca "$UID_OWNER")" "$(rez "$(dosar NULL NULL 'CONCURENTA-REV K3 A' "$K")")" '00000 true:false' \
  "$(ca "$UID_OWNER")" "$(rez "$(dosar NULL NULL 'CONCURENTA-REV K3 T' "$K")")"
astept "$AST_K3_B" "$(faraId "$B_STARE")" "B (aceeasi cheie, alt continut): dupa COMMIT-ul lui A"
astept 0 "$(nrDosare 'CONCURENTA-REV K3 T')" "niciun dosar cu titlul lui B"
astept 1 "$(nrDosare 'CONCURENTA-REV K3 A')" "dosarul lui A"

echo "K4. dreptul MP-ului RETRAS cat apelul lui asteapta lock-ul dosarului (astept B: $AST_K4_B)"
ruleazaSincron K40 "$(ca "$UID_OWNER")" "$(rez "$(dosar NULL NULL 'CONCURENTA-REV K4' "$(cheie)")")"
D4="${B_STARE##*:}"; astept '00000 true:false' "$(faraId "$B_STARE")" "dosarul K4 creat (fara concurent), id $D4"
V4="$(q "SELECT versiune FROM public.executie_revendicari WHERE id = ${D4//[^0-9]/0}")"
concurent K4 "$(ca "$UID_OWNER")" "$(rez "$(termen "$D4" "$(cheie)")")" '00000 true:false' \
  "$(ca "$UID_MP")" "$(rez "$(dosar "$D4" "$V4" 'CONCURENTA-REV K4 T' "$(cheie)")")" \
  "INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES ('$UID_MP', 9301, 'viewer')"
astept "$AST_K4_B" "$(faraId "$B_STARE")" "B (MP restrans intre timp): dupa COMMIT-ul lui A"
astept "$AST_K4_T" "$(q "SELECT titlu FROM public.executie_revendicari WHERE id = $D4")" "titlul dosarului"
astept "$AST_K4_J" "$(jurTitlu "$D4" 'CONCURENTA-REV K4 T')" "randuri de jurnal cu titlul lui B"
astept 1 "$(q "SELECT count(*) FROM public.executie_revendicare_termene WHERE dosar_id = $D4")" "termenul lui A scris"
astept "false|true" "$(qf "BEGIN; $(ca "$UID_MP") SELECT public.fn_executie_revendicare_drept(9301, 'scriere')::text || '|' || public.fn_executie_revendicare_drept(9301, 'citire')::text; COMMIT;" | grep -E '^(true|false)\|')" "MP-ul dupa restrictie: scriere | citire"

inchideA; ok $? "sesiunea A inchisa curat"
[ "$esec" = 0 ] && echo "TOTUL OK" || echo "ESEC: $esec"
