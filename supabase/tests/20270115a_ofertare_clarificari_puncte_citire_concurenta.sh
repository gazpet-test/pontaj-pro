#!/usr/bin/env bash
# Proba de CONCURENȚĂ a migrării 20270115a (Ofertare: punctele clarificărilor doar pentru owner / responsabili; garda părintelui): sesiuni psql REALE,
# cu barieră explicită, pe un cluster PostgreSQL ≥ 17 COMPLET DISPENSABIL. PGlite (o singură conexiune) nu poate proba asta: aici a doua operație vine cât
# prima e încă necomisă și ține lock-urile (KEY SHARE al FK-ului pe părinte / lock-ul exclusiv al DELETE-ului). Același tipar ca
# supabase/tests/20270112a_ofertare_cantitati_masuratori_concurenta.sh (coproc + \warn + observator pe pg_stat_activity, fără sleep orb).
#
# CE ATINGE (exact):
#   * BAZA: creează <nume_baza_noua> (refuză dacă există) și o ȘTERGE la final (DROP DATABASE … WITH (FORCE)), inclusiv la întrerupere (trap).
#   * ROLURI la nivel de CLUSTER: anon, authenticated (NOLOGIN NOINHERIT), service_role (NOLOGIN NOINHERIT BYPASSRLS), authenticator (NOINHERIT), create
#     DOAR dacă lipsesc și ȘTERSE la final doar cele create aici → rulează DOAR cu CP_CLUSTER_DISPENSABIL=da (NU pe clona de producție).
#   * FIȘIERE: un folder temporar (mktemp -d) cu SQL-ul extras și jurnalele; șters la final. REȚEA: doar psql la cluster. DATE: doar sintetice.
# CE APLICĂ: scheletul 20270112a (fără CREATE ROLE) + scheletul aditiv 20270115a + secțiunea 2 a migrării (de la „-- ─── 2.” la (fără) „-- ─── 3.”),
#   extrasă EXACT, FĂRĂ $pre$ / $lock$ / $stare$ / $post$ (gărzile runnerului). Aplicarea completă prin runner e pasul SEPARAT al coordonatorului.
#
# CUM SE RULEAZĂ (coordonatorul; cere bash ≥ 4 (coproc), psql ≥ 13, python3, conectare ca superuser `postgres`):
#     CP_CLUSTER_DISPENSABIL=da PGHOST=… PGPORT=… PGUSER=postgres bash supabase/tests/20270115a_ofertare_clarificari_puncte_citire_concurenta.sh <nume_baza_noua>
#   Ieșire: 0 = toate așteptările se țin (ultima linie TOTUL OK) și curățenia a reușit; 1 = cel puțin o așteptare nu se ține; 2 = refuz / folosire greșită.
#
# SCENARII (așteptările scrise de mână; review Jakarinos #1210 r2 P1 — cursa „primul punct” vs. părinte):
#   c_sterge_vs_primul_punct   A (RESP, poarta pe L1): inserează PRIMUL punct în C (fără puncte), NECOMIS — ține KEY SHARE pe C prin FK.
#                              B (OF, fără poartă): DELETE C → așteaptă lock-ul rândului (BEFORE ROW se cheamă DUPĂ lock, GetTupleForTrigger).
#                              A COMMIT → B: 42501 (garda vede punctul comis: are_puncte VOLATILE, instantaneu nou); C și punctul rămân.
#   c_primul_punct_vs_sterge   A (OF): DELETE C (fără puncte), NECOMIS — garda a trecut (nu erau puncte), rândul e blocat.
#                              B (RESP): INSERT primul punct → FK așteaptă DELETE-ul necomis. A COMMIT → B: 23503 (părintele nu mai există); niciun orfan.
#   c_muta_vs_primul_punct     A (RESP): inserează primul punct în C, NECOMIS. B (OF): UPDATE licitatie_id → 42501 IMEDIAT (mutarea e refuzată din
#                              aplicație și fără puncte — nu mai există cursa din r2); A COMMIT → punctul e pe C, C pe L1.
#   c_sterge_vs_primul_punct_rollback  ca primul, dar A face ROLLBACK → B șterge (nu erau puncte comise).
#   c_resp_muta_fara_puncte    secvențial: nici responsabilul nu mută o clarificare fără puncte (42501, mesajul exact); editarea textului trece.
#   c_export                   secvențial (varianta B, 20270115a): RESP (poarta pe L1) primește OBIECTUL {clarificari, temeiuri} cu temeiul de pe
#                              punctul lui C9; ADM (admin Ofertare, drept de decizie, fără poartă) → 42501 cu mesajul exact al porții.
#   c_service_liber            service_role mută și șterge o clarificare cu puncte fără gardă (porțile serverului sunt în edge / RPC).
#   Bariera verifică și că B e blocat CHIAR de A (pg_blocking_pids), cu pg_stat_clear_snapshot() la fiecare iterație.
set -u
set -o pipefail

if [ "${CP_CLUSTER_DISPENSABIL:-}" != "da" ]; then
  echo "refuz: scriptul creeaza / sterge o baza si poate crea roluri la nivel de CLUSTER; ruleaza-l DOAR pe un cluster complet dispensabil, cu CP_CLUSTER_DISPENSABIL=da" >&2
  exit 2
fi
if [ $# -ne 1 ] || ! [[ "$1" =~ ^[a-z][a-z0-9_]{2,40}$ ]]; then echo "folosire: CP_CLUSTER_DISPENSABIL=da $0 <nume_baza_noua (a-z0-9_)>" >&2; exit 2; fi
BAZA="$1"
RADACINA="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$RADACINA/supabase/migrations/20270115a_ofertare_clarificari_puncte_citire.sql"
SCHELET="$RADACINA/supabase/tests/20270112a_ofertare_cantitati_masuratori_schelet.sql"
SCHELET_P="$RADACINA/supabase/tests/20270115a_ofertare_clarificari_puncte_citire_schelet.sql"
[ -r "$MIG" ] && [ -r "$SCHELET" ] && [ -r "$SCHELET_P" ] || { echo "lipsesc migrarea / scheletele" >&2; exit 2; }
command -v python3 > /dev/null || { echo "refuz: python3 lipseste (extragerea SQL-ului)" >&2; exit 2; }
export PGCLIENTENCODING=UTF8

PSM=(psql -X -q -w -v ON_ERROR_STOP=1 -d postgres)
VERS_CLIENT="$(psql --version 2>/dev/null | sed -n 's/^psql (PostgreSQL) \([0-9]*\).*/\1/p')"
if [ -z "$VERS_CLIENT" ] || [ "$VERS_CLIENT" -lt 13 ]; then echo "refuz: psql >= 13; gasit: $(psql --version 2>&1)" >&2; exit 2; fi
PRE="$("${PSM[@]}" -tAc "SELECT current_setting('server_version_num')::int >= 170000, current_user = 'postgres', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), EXISTS (SELECT 1 FROM pg_database WHERE datname = '$BAZA')")" || { echo "refuz: nu ma pot conecta la baza postgres" >&2; exit 2; }
case "$PRE" in
  t\|t\|t\|f) ;;
  t\|t\|t\|t) echo "refuz: baza $BAZA exista deja (aleg alt nume; nu sterg nimic existent)" >&2; exit 2;;
  *) echo "refuz: cere PostgreSQL >= 17, current_user = postgres, superuser (primit: $PRE)" >&2; exit 2;;
esac
ROL_ALTFEL="$("${PSM[@]}" -tAc "SELECT coalesce(string_agg(rolname, ' ' ORDER BY rolname), '') FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator') AND (rolsuper OR rolinherit OR rolbypassrls IS DISTINCT FROM (rolname = 'service_role'))")" || exit 2
if [ -n "$ROL_ALTFEL" ]; then echo "refuz: rolurile existente $ROL_ALTFEL au alte atribute decat scheletul (superuser / INHERIT / BYPASSRLS); nu le ating" >&2; exit 2; fi

D="$(mktemp -d -t cp_concurenta_XXXXXX)"
A_OUT="$D/A.stdout.log"; A_ERR="$D/A.stderr.log"; B_LOG="$D/B.log"; B_TOT="$D/B.toate.log"
: > "$A_ERR"; : > "$B_TOT"
BAZA_CREATA=0; A_DESCHIS=0; esec=0; B_PID=''
ROLURI_CREATE=()
curatenie() {
  local cod=$?
  trap - EXIT INT TERM
  if [ "$cod" != 0 ] || [ "$esec" != 0 ]; then
    echo "── sesiunea A (stderr, ultimele 40) ──"; tail -n 40 "$A_ERR" 2>/dev/null
    echo "── sesiunile B (ultimele 60) ──"; tail -n 60 "$B_TOT" 2>/dev/null
  fi
  if [ "$A_DESCHIS" = 1 ]; then { printf '%s\n' 'ROLLBACK;' '\q' >&"$A_IN"; } 2>/dev/null || true; wait "$A_PID_C" 2>/dev/null || true; fi
  if [ -n "$B_PID" ]; then kill "$B_PID" 2>/dev/null || true; wait "$B_PID" 2>/dev/null || true; fi
  if [ "$BAZA_CREATA" = 1 ]; then
    if "${PSM[@]}" -c "DROP DATABASE \"$BAZA\" WITH (FORCE)" > /dev/null; then echo "  OK  curatenie: DROP DATABASE $BAZA"; else echo "  NU  curatenie: DROP DATABASE $BAZA a esuat (de sters manual)"; cod=1; fi
  fi
  local r i
  for ((i = ${#ROLURI_CREATE[@]} - 1; i >= 0; i--)); do
    r="${ROLURI_CREATE[$i]}"
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
astept() { if [ "$2" = "$1" ]; then echo "      ok  $3 → $2"; else echo "      ABATERE  $3 → $2 (astepta $1)"; esec=$((esec + 1)); fi; }
q() { psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tAc "$1"; }
U_OWNER=00000000-0000-4000-8000-0000000000d1; U_OF=00000000-0000-4000-8000-0000000000d2; U_RESP=00000000-0000-4000-8000-0000000000d3; U_ADM=00000000-0000-4000-8000-0000000000d4
# JWT ca PostgREST: AMBELE surse (request.jwt.claim.sub și request.jwt.claims cu rolul)
ca() { printf "SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '%s', true); SELECT set_config('request.jwt.claims', '{\"sub\": \"%s\", \"role\": \"authenticated\"}', true);" "$1" "$1"; }
caService() { printf "SET LOCAL ROLE service_role;"; }

# ── 0. rolurile (doar cele care lipsesc), baza, scheletele, secțiunea 2 a migrării ──
echo "0. baza de unica folosinta: scheletele + sectiunea 2 a migrarii 20270115a"
EXISTENTE=" $("${PSM[@]}" -tAc "SELECT coalesce(string_agg(rolname, ' '), '') FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator')") "
for r in anon authenticated service_role authenticator; do
  case "$EXISTENTE" in *" $r "*) continue;; esac
  case "$r" in service_role) atr='NOLOGIN NOINHERIT BYPASSRLS';; authenticator) atr='NOINHERIT';; *) atr='NOLOGIN NOINHERIT';; esac
  if "${PSM[@]}" -c "CREATE ROLE \"$r\" $atr" > /dev/null; then ROLURI_CREATE+=("$r"); else echo "refuz: CREATE ROLE $r a esuat" >&2; exit 2; fi
done
echo "     roluri de cluster create (si sterse la final): ${ROLURI_CREATE[*]:-niciunul}"
if "${PSM[@]}" -c "CREATE DATABASE \"$BAZA\"" > /dev/null; then BAZA_CREATA=1; ok 0 "CREATE DATABASE $BAZA"; else echo "refuz: CREATE DATABASE $BAZA a esuat" >&2; exit 2; fi
python3 - "$SCHELET" "$SCHELET_P" "$MIG" "$D" <<'PY'
import re, sys
schelet_p, schelet_pp, mig_p, d = sys.argv[1:5]
citeste = lambda p: open(p, encoding='utf-8').read().replace('\r', '')
SCH, SCHP, MIG = citeste(schelet_p), citeste(schelet_pp), citeste(mig_p)
roluri = re.compile(r'^CREATE ROLE (anon|authenticated|service_role|authenticator)\b[^;\n]*;\n', re.M)
sch2, n = roluri.subn('', SCH)
if n != 4 or 'CREATE ROLE' in sch2: sys.exit('scheletul: astept exact 4 randuri CREATE ROLE, gasit %d' % n)
sch2 = sch2.replace('GRANT anon, authenticated, service_role TO authenticator;\n', '')
open(d + '/schelet.sql', 'w', encoding='utf-8').write(sch2 + '\n' + SCHP)
marcaje = re.findall(r'^-- ─── ([0-9]+)\. ', MIG, re.M)
if marcaje != ['0', '1', '2', '3']: sys.exit('migrarea: marcajele sectiunilor nu sunt 0..3 (o data fiecare): %r' % marcaje)
inc, sf = '\n-- ─── 2. ', '\n-- ─── 3. '
ddl = MIG[MIG.index(inc) + 1:MIG.index(sf) + 1]
for interzis in ('DO $pre$', 'END $pre$', 'DO $lock$', 'END $lock$', 'DO $stare$', 'END $stare$', 'DO $post$', 'END $post$',
                 'gazpet.livrare_migrare', 'gazpet.plafon_tranzactie', 'gazpet.lock_puternic_la'):
    if interzis in ddl: sys.exit('sectiunea extrasa contine o garda a runnerului: ' + interzis)
open(d + '/ddl.sql', 'w', encoding='utf-8').write(ddl)
print('     extras: scheletele (-4 CREATE ROLE), sectiunea 2: %d caractere' % len(ddl))
PY
ok $? "SQL-ul extras (schelete, sectiunea 2 a migrarii)"
[ "$esec" = 0 ] || exit 1
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f "$D/schelet.sql" > /dev/null; ok $? "scheletele"
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 -f "$D/ddl.sql" > /dev/null; ok $? "sectiunea 2 a migrarii 20270115a (o tranzactie)"
astept '4|t|1|2' "$(q "SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('fn_ofertare_clar_are_puncte', 'fn_ofertare_lic_puncte_poarta', 'fn_ofertare_clar_puncte_poarta', 'fn_ofertare_clar_parinte_puncte_garda')) || '|' || (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.ofertare_clarificari_export(bigint)')) || '|' || (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.ofertare_clarificari'::regclass AND tgname = 'trg_ofertare_clar_parinte_puncte') || '|' || (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.ofertare_clarificari_puncte'::regclass AND pg_get_expr(polqual, polrelid) = 'fn_ofertare_clar_puncte_poarta(clarificare_id)')")" "obiectele: functii noi | exportul DEFINER | trigger | politici pe poarta"
[ "$esec" = 0 ] || exit 1

# ── fixturile (ca postgres): conturi (+ ADM = admin Ofertare, fără rol pe licitație), licitațiile L1 (RESP responsabil, regula A) și L2, clarificările
#    C1..C4 pe L1 fără puncte, C9 pe L1 „de_trimis” cu un punct + un temei CNSC bifat „include în adresă” pe punct (20261014b) ──
psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -1 <<'SQL' > /dev/null
INSERT INTO auth.users (id) VALUES ('00000000-0000-4000-8000-0000000000d1'), ('00000000-0000-4000-8000-0000000000d2'), ('00000000-0000-4000-8000-0000000000d3'), ('00000000-0000-4000-8000-0000000000d4');
INSERT INTO public.profiles (id, name, is_owner) VALUES ('00000000-0000-4000-8000-0000000000d1', 'OWNER', true), ('00000000-0000-4000-8000-0000000000d2', 'OF', false), ('00000000-0000-4000-8000-0000000000d3', 'RESP', false), ('00000000-0000-4000-8000-0000000000d4', 'ADM', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('00000000-0000-4000-8000-0000000000d2', 'ofertare', 'editor'), ('00000000-0000-4000-8000-0000000000d3', 'ofertare', 'editor'), ('00000000-0000-4000-8000-0000000000d4', 'ofertare', 'admin');
INSERT INTO public.ofertare_licitatii (id, nr_anunt, autoritate, obiect, responsabil_id, stare_loturi) VALUES
  (900201, 'T-1', 'AUTORITATE PROBA', 'licitatie de proba', '00000000-0000-4000-8000-0000000000d3', 'fara_loturi'),
  (900202, 'T-2', 'AUTORITATE PROBA', 'alta licitatie', NULL, 'fara_loturi');
INSERT INTO public.ofertare_clarificari (id, licitatie_id, nr, intrebare, status) VALUES (9101, 900201, 1, 'C1', 'propunere'), (9102, 900201, 2, 'C2', 'propunere'),
  (9103, 900201, 3, 'C3', 'propunere'), (9109, 900201, 9, 'C9 cu puncte', 'de_trimis');
INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (9109, 1, 'punct C9');
INSERT INTO public.cnsc_decizii (id, nr_decizie, data, regula, link_sursa, citate_cheie, verificat, versiune_import)
  VALUES ('CP-CNSC-1', '1/C1/1', DATE '2026-01-15', 'regula de proba', 'https://portal.cnsc.ro/proba', '[{"loc": "p. 3", "text": "citat de proba"}]'::jsonb, true, 'proba');
INSERT INTO public.ofertare_clarificari_temeiuri (punct_id, cnsc_decizie_id, citat_idx, citat_text, include_in_adresa, confirmat)
  SELECT p.id, 'CP-CNSC-1', 0, 'citat de proba', true, true FROM public.ofertare_clarificari_puncte p WHERE p.clarificare_id = 9109 AND p.nr = 1;
SQL
ok $? "fixturile"
[ "$esec" = 0 ] || exit 1

# ── sesiunea A (coproc), sesiunea B (fundal), observatorul ──
A_IN=''; A_FD_OUT=''; A_PID_C=''
deschideA() { coproc A { PGAPPNAME=cp_A psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f - 2>&1 1>"$A_OUT"; }; A_IN="${A[1]}"; A_FD_OUT="${A[0]}"; A_PID_C="$A_PID"; A_DESCHIS=1; }
asteaptaA() {
  local marcaj="$1" linie; A_STARE=''
  while IFS= read -r -t 60 -u "$A_FD_OUT" linie; do printf '%s\n' "$linie" >> "$A_ERR"; case "$linie" in "$marcaj "*) A_STARE="${linie#"$marcaj" }"; return 0;; esac; done
  A_STARE='FARA_RASPUNS'; return 1
}
pasA() { local marcaj="$1"; shift; printf '%s\n' "$@" "\\warn $marcaj :SQLSTATE" >&"$A_IN"; asteaptaA "$marcaj"; }
inchideA() { local linie; { printf '%s\n' '\q' >&"$A_IN"; } 2>/dev/null || true; while IFS= read -r -t 60 -u "$A_FD_OUT" linie 2>/dev/null; do printf '%s\n' "$linie" >> "$A_ERR"; done; wait "$A_PID_C" 2>/dev/null; A_DESCHIS=0; }
pornesteB() {   # <prolog rol> <instructiune>
  printf '%s\n' "SET lock_timeout = '20s';" "BEGIN;" "$1" "$2" "\\echo B_REZ :SQLSTATE" "\\echo B_MSG :LAST_ERROR_MESSAGE" "COMMIT;" "\\echo B_COMMIT :SQLSTATE" > "$D/B.sql"
  PGAPPNAME=cp_B psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f "$D/B.sql" > "$B_LOG" 2>&1 &
  B_PID=$!
}
asteaptaB() {
  wait "$B_PID" 2>/dev/null; B_PID=''
  { echo "── B ──"; cat "$B_LOG"; } >> "$B_TOT"
  B_STARE="$(sed -n 's/^B_REZ //p' "$B_LOG" | tail -n 1)"; [ -n "$B_STARE" ] || B_STARE='FARA_MARCAJ'
  B_MSG="$(sed -n 's/^B_MSG //p' "$B_LOG" | tail -n 1)"
}
# observatorul: B așteaptă pe un lock ȘI e blocat chiar de A (pg_blocking_pids). pg_stat_activity e un instantaneu pe tranzacție → pg_stat_clear_snapshot()
# la fiecare iterație (review Jakarinos r3 P2: fără el, un B apărut după prima citire n-ar mai fi văzut în aceeași tranzacție DO).
bariera() {
  local r
  r="$(psql -X -q -w -d "$BAZA" -tAc "DO \$o\$ DECLARE i int := 0; BEGIN LOOP PERFORM pg_stat_clear_snapshot(); EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity b WHERE b.datname = current_database() AND b.application_name = 'cp_B' AND b.wait_event_type = 'Lock' AND EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.application_name = 'cp_A' AND a.pid = ANY (pg_blocking_pids(b.pid)))); i := i + 1; IF i > 1500 THEN RAISE EXCEPTION 'cp_B nu asteapta pe un lock tinut de cp_A (30 s)'; END IF; PERFORM pg_sleep(0.02); END LOOP; END \$o\$; SELECT 'BARIERA_OK';" 2>&1)"
  astept BARIERA_OK "$r" "observatorul: B asteapta pe un lock tinut de A (wait_event_type = Lock, pg_blocking_pids)"
}
contine() { case "$2" in *"$1"*) echo "      ok  $3 → contine «$1»";; *) echo "      ABATERE  $3 → «$2» (astepta sa contina «$1»)"; esec=$((esec + 1));; esac; }
stare_c() { q "SELECT coalesce((SELECT licitatie_id::text FROM public.ofertare_clarificari WHERE id = $1), 'LIPSA') || '|' || (SELECT count(*) FROM public.ofertare_clarificari_puncte WHERE clarificare_id = $1)"; }

# ── c_sterge_vs_primul_punct ──
echo "c_sterge_vs_primul_punct (C1 = 9101): A (RESP) insereaza primul punct NECOMIS; B (OF) sterge → asteapta lock-ul randului; A COMMIT → B 42501"
{
  deschideA
  pasA S1a "BEGIN;" "$(ca $U_RESP)" "INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (9101, 1, 'primul punct');"; astept 00000 "$A_STARE" "A: INSERT primul punct, NECOMIS (KEY SHARE pe C1 prin FK)"
  pornesteB "$(ca $U_OF)" "DELETE FROM public.ofertare_clarificari WHERE id = 9101;"
  bariera
  pasA S1b "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  asteaptaB; astept 42501 "$B_STARE" "B: DELETE dupa commit-ul lui A → 42501 (garda vede punctul comis)"
  contine 'Clarificarea are puncte: o sterge doar ownerul sau un responsabil al licitatiei' "$B_MSG" "B: mesajul exact al garzii"
  inchideA
  astept '900201|1' "$(stare_c 9101)" "C1 ramane pe L1 cu punctul"
}

# ── c_sterge_vs_primul_punct_rollback (varianta cu ROLLBACK în A) ──
echo "c_sterge_vs_primul_punct_rollback (C1 = 9101, acum cu 1 punct → folosim C4 = 9104 noua): A insereaza primul punct NECOMIS, B sterge → asteapta; A ROLLBACK → B sterge (nu erau puncte)"
{
  q "INSERT INTO public.ofertare_clarificari (id, licitatie_id, nr, intrebare, status) VALUES (9104, 900201, 4, 'C4', 'propunere')" > /dev/null
  deschideA
  pasA S1Ra "BEGIN;" "$(ca $U_RESP)" "INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (9104, 1, 'primul punct');"; astept 00000 "$A_STARE" "A: INSERT primul punct, NECOMIS"
  pornesteB "$(ca $U_OF)" "DELETE FROM public.ofertare_clarificari WHERE id = 9104;"
  bariera
  pasA S1Rb "ROLLBACK;"; astept 00000 "$A_STARE" "A: ROLLBACK"
  asteaptaB; astept 00000 "$B_STARE" "B: DELETE dupa ROLLBACK-ul lui A → trece (clarificarea n-are puncte)"
  inchideA
  astept 'LIPSA|0' "$(stare_c 9104)" "C4 stearsa, fara puncte"
}

# ── c_primul_punct_vs_sterge ──
echo "c_primul_punct_vs_sterge (C2 = 9102): A (OF) sterge C2 fara puncte, NECOMIS; B (RESP) insereaza primul punct → FK asteapta; A COMMIT → B 23503"
{
  deschideA
  pasA S2a "BEGIN;" "$(ca $U_OF)" "DELETE FROM public.ofertare_clarificari WHERE id = 9102;"; astept 00000 "$A_STARE" "A: DELETE C2 (fara puncte: garda trece), NECOMIS"
  pornesteB "$(ca $U_RESP)" "INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (9102, 1, 'primul punct');"
  bariera
  pasA S2b "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  asteaptaB; astept 23503 "$B_STARE" "B: INSERT dupa commit-ul lui A → 23503 (parintele nu mai exista; niciun orfan; mesaj: ${B_MSG:--})"
  inchideA
  astept 'LIPSA|0' "$(stare_c 9102)" "C2 stearsa, fara puncte orfane"
}

# ── c_resp_muta_fara_puncte (secvențial): nici responsabilul nu mută o clarificare fără puncte din aplicație ──
echo "c_resp_muta_fara_puncte (C3 = 9103, fara puncte): RESP → 42501 cu mesajul garzii; editarea textului trece"
{
  R="$(psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f - 2>&1 <<SQL | sed -n 's/^R_//p'
BEGIN;
$(ca $U_RESP)
UPDATE public.ofertare_clarificari SET licitatie_id = 900202 WHERE id = 9103;
\echo R_REZ :SQLSTATE
\echo R_MSG :LAST_ERROR_MESSAGE
ROLLBACK;
BEGIN;
$(ca $U_RESP)
UPDATE public.ofertare_clarificari SET intrebare = 'C3 editata' WHERE id = 9103;
\echo R_EDIT :SQLSTATE
COMMIT;
SQL
)"
  astept 42501 "$(printf '%s\n' "$R" | sed -n 's/^REZ //p')" "RESP: UPDATE licitatie_id pe o clarificare fara puncte → 42501"
  contine 'O clarificare nu se muta pe alta licitatie din aplicatie' "$(printf '%s\n' "$R" | sed -n 's/^MSG //p')" "RESP: mesajul exact al garzii"
  astept 00000 "$(printf '%s\n' "$R" | sed -n 's/^EDIT //p')" "RESP: editarea textului trece"
  astept '900201|0' "$(stare_c 9103)" "C3 ramane pe L1, fara puncte"
}

# ── c_muta_vs_primul_punct ──
echo "c_muta_vs_primul_punct (C3 = 9103): A (RESP) insereaza primul punct NECOMIS; B (OF) muta C3 pe L2 → 42501 imediat (mutarea e refuzata si fara puncte)"
{
  deschideA
  pasA S3a "BEGIN;" "$(ca $U_RESP)" "INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (9103, 1, 'primul punct');"; astept 00000 "$A_STARE" "A: INSERT primul punct, NECOMIS"
  B_MUTA="$(psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f - 2>&1 <<SQL | sed -n 's/^B_//p'
SET lock_timeout = '20s';
BEGIN;
$(ca $U_OF)
UPDATE public.ofertare_clarificari SET licitatie_id = 900202 WHERE id = 9103;
\echo B_REZ :SQLSTATE
\echo B_MSG :LAST_ERROR_MESSAGE
ROLLBACK;
SQL
)"
  astept 42501 "$(printf '%s\n' "$B_MUTA" | sed -n 's/^REZ //p')" "B: UPDATE licitatie_id cat A e necomis → 42501 fara asteptare (nu exista cursa)"
  contine 'O clarificare nu se muta pe alta licitatie din aplicatie' "$(printf '%s\n' "$B_MUTA" | sed -n 's/^MSG //p')" "B: mesajul exact al garzii"
  pasA S3b "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  inchideA
  astept '900201|1' "$(stare_c 9103)" "C3 ramane pe L1, cu punctul lui A"
}

# ── c_export (secvențial): poarta punctelor pe exportul adresei + temeiul de pe punct în răspuns ──
echo "c_export (L1 = 900201, C9 de_trimis cu un punct + temei bifat): RESP → obiect {clarificari: 1, temeiuri: 1 pe punct}; ADM (decizie, fara poarta) → 42501 mesajul exact"
{
  R="$(psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tAc "BEGIN; $(ca $U_RESP) SELECT jsonb_typeof(r) || '|' || jsonb_array_length(r->'clarificari') || '|' || jsonb_array_length(r->'temeiuri') || '|' || (r->'temeiuri'->0->>'tinta') || '|' || (r->'temeiuri'->0->>'punct_nr') || '|' || (r->'temeiuri'->0->>'nr') || '|' || (r->'temeiuri'->0->'decizie'->>'id') FROM public.ofertare_clarificari_export(900201) r; ROLLBACK;" | head -n 1)"
  astept 'object|1|1|punct|1|9|CP-CNSC-1' "$R" "RESP: raspunsul e OBIECT (nu tablou: UI-ul vechi refuza), C9 + temeiul de pe punctul 1 cu decizia"
  R="$(psql -X -q -w -v ON_ERROR_STOP=0 -d "$BAZA" -f - 2>&1 <<SQL | sed -n 's/^E_//p'
BEGIN;
$(ca $U_ADM)
SELECT public.ofertare_clarificari_export(900201);
\echo E_REZ :SQLSTATE
\echo E_MSG :LAST_ERROR_MESSAGE
ROLLBACK;
SQL
)"
  astept 42501 "$(printf '%s\n' "$R" | sed -n 's/^REZ //p')" "ADM (admin Ofertare, drept de decizie, fara poarta): export → 42501"
  contine 'Export blocat: adresa o genereaza doar ownerul sau un responsabil al licitatiei' "$(printf '%s\n' "$R" | sed -n 's/^MSG //p')" "ADM: mesajul exact al portii"
}

# ── c_service_liber ──
echo "c_service_liber (C9 = 9109, cu puncte): service_role muta si sterge fara garda"
{
  R="$(psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tAc "BEGIN; $(caService) UPDATE public.ofertare_clarificari SET licitatie_id = 900202 WHERE id = 9109; SELECT licitatie_id FROM public.ofertare_clarificari WHERE id = 9109; COMMIT;" | head -n 1)"
  astept 900202 "$R" "service_role: mutarea trece"
  R="$(psql -X -q -w -v ON_ERROR_STOP=1 -d "$BAZA" -tAc "BEGIN; $(caService) DELETE FROM public.ofertare_clarificari WHERE id = 9109; SELECT count(*) FROM public.ofertare_clarificari_puncte WHERE clarificare_id = 9109; COMMIT;" | head -n 1)"
  astept 0 "$R" "service_role: stergerea trece (cascada sterge punctul)"
}
astept "0" "$(q "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND application_name IN ('cp_A', 'cp_B') AND state <> 'idle'")" "nicio sesiune ramasa"

[ "$esec" = 0 ] && echo "TOTUL OK" || echo "ESEC: $esec"
