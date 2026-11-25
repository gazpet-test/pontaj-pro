#!/usr/bin/env bash
# Proba de CONCURENȚĂ a migrării 20270110a (Achiziții: retur la furnizor, PR1): sesiuni psql REALE, cu barieră explicită, pe un cluster PostgreSQL ≥ 17
# COMPLET DISPENSABIL. PGlite (o singură conexiune) nu poate proba asta: aici a doua operație vine cât prima e încă necomisă și ține lock-urile.
#
# CE ATINGE (exact):
#   * BAZE: creează <nume_baza_noua> (refuză dacă există) și câte o bază <nume_baza_noua>_mN pentru fiecare mutant; le ȘTERGE pe toate la final
#     (DROP DATABASE … WITH (FORCE)), inclusiv la întrerupere (trap EXIT / INT / TERM). Nu se conectează la altă bază decât `postgres` (CREATE / DROP)
#     și bazele create de el.
#   * ROLURI la nivel de CLUSTER: scheletul (supabase/tests/20270110a_achizitii_retur_furnizor_schelet.sql) creează, DOAR dacă lipsesc, rolurile anon,
#     authenticated, service_role (BYPASSRLS), supabase_auth_admin. Scriptul notează ÎNAINTE care lipsesc și le ȘTERGE la final pe cele create de el;
#     rolurile preexistente nu sunt atinse. De aceea rulează DOAR cu RETUR_CLUSTER_DISPENSABIL=da: NU pe clona de producție, NU pe un cluster folosit
#     la altceva.
#   * FIȘIERE: un folder temporar (mktemp -d) cu DDL-ul extras și jurnalele sesiunilor; șters la final (la eșec, cozile jurnalelor se afișează înainte).
#   * REȚEA: doar conexiunile psql la cluster (PGHOST / PGPORT / PGUSER / PGPASSWORD sau pgpass).
# CE APLICĂ: scheletul + secțiunile 2–6 ale migrării (textul EXACT dintre marcajele „-- ─── 2.” și „-- ─── 7.”), fără gărzile runnerului; la mutanți,
#   același text cu O schimbare. Aplicarea completă prin runner (manifestul L15, aplicare → revenire → reaplicare) e pasul SEPARAT al coordonatorului, pe
#   clonă (docs/LIVRARE_L15_V2.md §7), împreună cu dry-run-ul (supabase/tests/20270110a_achizitii_retur_furnizor_dryrun.sql).
#
# CUM SE RULEAZĂ (coordonatorul; cere bash ≥ 4 (coproc), psql ≥ 13 (\warn, :LAST_ERROR_MESSAGE), conectare ca superuser `postgres`):
#     RETUR_CLUSTER_DISPENSABIL=da PGHOST=… PGPORT=… PGUSER=postgres PGPASSWORD=… bash supabase/tests/20270110a_achizitii_retur_furnizor_concurenta.sh <nume_baza_noua>
#   Ieșire: 0 = toate așteptările se țin, toți mutanții sunt PRINȘI și curățenia a reușit; 1 = altfel; 2 = refuz / folosire greșită.
#
# BARIERA (fără sleep în script): sesiunea A e un psql ținut deschis (coproc); după fiecare pas A scrie pe stderr `\warn <PAS> :SQLSTATE`, iar scriptul
#   BLOCHEAZĂ până primește marcajul (lock-urile lui A sunt luate și necomise). Sesiunea B pornește în fundal (PGAPPNAME=retur_B); OBSERVATORUL (un al
#   treilea psql) așteaptă pe server până când B apare în pg_stat_activity cu wait_event_type = 'Lock' (pg_sleep(0.02) în buclă, plafon 10 s = eșec
#   vizibil): abia atunci A comite. B își scrie rezultatul (`B_REZ :SQLSTATE`, `B_MSG :LAST_ERROR_MESSAGE`) și scriptul îl culege cu `wait $PID`.
#   Singurele timpuri: lock_timeout 20 s în B (plasa), plafonul observatorului și `read -t 60` (dacă A moare).
#
# SCENARII (așteptările scrise de mână; spec §5.2–§5.4, planul Task 5):
#   C1 c_doua_retururi_aceeasi_linie   linie 50 primite / 50 intrate / stoc 50. A: retur 30. B: retur 30 → așteaptă linia; după COMMIT → CF_PESTE_PRIMIT.
#   C2 c_doua_linii_aceeasi_cheie      două linii (40 + 40 intrate), aceeași denumire și locație, stoc 50. A: retur 40 din L1. B: retur 40 din L2 →
#                                      așteaptă cheia de stoc; după COMMIT → CF_STOC_INSUFICIENT; stocul final 10 (nu -30).
#   C3 c_retur_vs_ajustare_minus       stoc 50. A: fn_stoc_ajustare -30 (ieșire manuală). B: retur 30 → așteaptă; după COMMIT → CF_STOC_INSUFICIENT.
#   C4 c_receptie_veche_vs_retur       linie 50 primite. A: retur 10. B: recepția din formular (+5, primita citită 50) → așteaptă; după COMMIT →
#                                      CF_VALOARE_SCHIMBATA (nu suprascrie returul).
#   C5 c_retur_vs_stergere_pozitie     marfa pe proiect venită prin transport direct (transfer_in, neprotejat). A (owner): fn_stoc_sterge_pozitie pe
#                                      poziția proiectului. B: retur 5 din proiect → așteaptă; după COMMIT → CF_STOC_INSUFICIENT (poziția nu mai există).
#   C6 c_drept_retras_in_asteptare     pentru fiecare RPC de scriere (recepție, predare, retur, anulare, închidere): A (owner) ține linia; B (achiziții)
#                                      așteaptă; dreptul lui B e retras și comis cât așteaptă; după COMMIT-ul lui A → 42501, nimic scris de B.
#   C7 c_reluare_cheie                 A: retur cu cheia K. B: aceeași cheie, același payload → așteaptă cheia; după COMMIT → rezultatul comis (reluat),
#                                      un singur retur cu K.
#   C8 c_drept_retras_bariera_stoc     (r2) A (postgres) ține RÂNDUL din stocuri al sediului (FOR UPDATE). B (achiziții): predarea în stoc → așteaptă
#                                      rândul; dreptul lui B e retras și comis cât așteaptă; după COMMIT-ul lui A → 42501, linia și stocul neschimbate.
#   C9 c_drept_retras_bariera_fk       (r2) A (postgres) ține o RECEPȚIE a liniei (FOR UPDATE). B: corectura -3 → verifică dreptul, apoi FK-ul corecturii
#                                      pe recepție așteaptă (ultima așteptare, după verificarea de după lock-uri); dreptul retras și comis; după ROLLBACK-ul
#                                      lui A → 42501 (reverificarea finală), linia neschimbată.
#   C10 c_transport_vs_retur           (r2) același material la sediu. A ține lock-ul consultativ 4242010 (bariera de probă: un trigger de probă AFTER INSERT
#                                      pe stocuri_miscari îl cere după intrarea la sediu a transportului). B: transport direct pe L1 → se oprește în
#                                      barieră. B2: retur 10 din sediu pe L2 → așteaptă (cheia sediului). A COMMIT → ambele termină (00000), fără deadlock;
#                                      stocul sediului 0, al proiectului 8.
# MUTANȚI (fiecare TREBUIE să pice scenariul lui): M1 fără FOR UPDATE pe linie (C1); M2 fără lock de stoc la retur (C2, C3, C5); M3 fără CAS pe
#   p_primita_citita (C4); M4 dreptul citit înaintea lock-urilor, fără reverificarea finală (C6, returul); M5 fără lock pe cheia de idempotență (C7);
#   M6 starea r1 a predării: cheile de stoc după prima mișcare + fără reverificarea finală (C8); M7 fără reverificarea finală (C9); M8 cheile de stoc
#   după prima mișcare (C10: deadlock detectat, 40P01).
set -u
set -o pipefail

if [ "${RETUR_CLUSTER_DISPENSABIL:-}" != "da" ]; then
  echo "refuz: scriptul creeaza / sterge baze si poate crea roluri la nivel de CLUSTER; ruleaza-l DOAR pe un cluster complet dispensabil, cu RETUR_CLUSTER_DISPENSABIL=da" >&2
  exit 2
fi
if [ $# -ne 1 ] || ! [[ "$1" =~ ^[a-z][a-z0-9_]{2,40}$ ]]; then echo "folosire: RETUR_CLUSTER_DISPENSABIL=da $0 <nume_baza_noua (a-z0-9_)>" >&2; exit 2; fi
BAZA="$1"
RADACINA="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$RADACINA/supabase/migrations/20270110a_achizitii_retur_furnizor.sql"
SCHELET="$RADACINA/supabase/tests/20270110a_achizitii_retur_furnizor_schelet.sql"
[ -r "$MIG" ] && [ -r "$SCHELET" ] || { echo "lipsesc migrarea / scheletul" >&2; exit 2; }

PSM=(psql -X -q -w -v ON_ERROR_STOP=1 -d postgres)
VERS_CLIENT="$(psql --version 2>/dev/null | sed -n 's/^psql (PostgreSQL) \([0-9]*\).*/\1/p')"
if [ -z "$VERS_CLIENT" ] || [ "$VERS_CLIENT" -lt 13 ]; then echo "refuz: psql >= 13; gasit: $(psql --version 2>&1)" >&2; exit 2; fi
PRE="$("${PSM[@]}" -tAc "SELECT current_setting('server_version_num')::int >= 170000, current_user = 'postgres', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), EXISTS (SELECT 1 FROM pg_database WHERE datname LIKE '${BAZA}%')")" || { echo "refuz: nu ma pot conecta la baza postgres" >&2; exit 2; }
case "$PRE" in
  t\|t\|t\|f) ;;
  t\|t\|t\|t) echo "refuz: exista deja o baza $BAZA* (aleg alt nume; nu sterg nimic existent)" >&2; exit 2;;
  *) echo "refuz: cere PostgreSQL >= 17, current_user = postgres, superuser (primit: $PRE)" >&2; exit 2;;
esac

D="$(mktemp -d -t retur_concurenta_XXXXXX)"
DDL="$D/ddl.sql"; A_OUT="$D/A.stdout.log"; A_ERR="$D/A.stderr.log"; B_LOG="$D/B.log"; B_TOT="$D/B.toate.log"
: > "$A_ERR"; : > "$B_TOT"
BAZE_CREATE=(); A_DESCHIS=0; esec=0; B_PID=''; B2_PID=''; B2_LOG="$D/B2.log"
ROLURI=(anon authenticated service_role supabase_auth_admin)
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
  if [ -n "$B2_PID" ]; then kill "$B2_PID" 2>/dev/null || true; wait "$B2_PID" 2>/dev/null || true; fi
  local b r
  for b in ${BAZE_CREATE[@]+"${BAZE_CREATE[@]}"}; do
    if "${PSM[@]}" -c "DROP DATABASE \"$b\" WITH (FORCE)" > /dev/null; then echo "  OK  curatenie: DROP DATABASE $b"; else echo "  NU  curatenie: DROP DATABASE $b a esuat (de sters manual)"; cod=1; fi
  done
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
# așteptările unui scenariu se numără LOCAL (nesec): scenariul corect cere 0, mutantul cere > 0
astept() { if [ "$2" = "$1" ]; then echo "      ok  $3 → $2"; else echo "      ABATERE  $3 → $2 (astepta $1)"; nesec=$((nesec + 1)); fi; }
q() { psql -X -q -w -v ON_ERROR_STOP=1 -d "$CUR" -tAc "$1"; }
UID_OWN=00000000-0000-4000-8000-000000000001
UID_ACH=00000000-0000-4000-8000-000000000002
ca() { printf "SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '%s', true);" "$1"; }

A_IN=''; A_FD_OUT=''; A_PID_C=''
deschideA() {
  coproc A { PGAPPNAME=retur_A psql -X -q -w -v ON_ERROR_STOP=0 -d "$CUR" -f - 2>&1 1>"$A_OUT"; }
  A_IN="${A[1]}"; A_FD_OUT="${A[0]}"; A_PID_C="$A_PID"; A_DESCHIS=1
}
asteaptaA() {
  local marcaj="$1" linie
  A_STARE=''
  while IFS= read -r -t 60 -u "$A_FD_OUT" linie; do
    printf '%s\n' "$linie" >> "$A_ERR"
    case "$linie" in "$marcaj "*) A_STARE="${linie#"$marcaj" }"; return 0;; esac
  done
  A_STARE='FARA_RASPUNS'; return 1
}
pasA() { local marcaj="$1"; shift; printf '%s\n' "$@" "\\warn $marcaj :SQLSTATE" >&"$A_IN"; asteaptaA "$marcaj"; }
inchideA() {
  local linie
  { printf '%s\n' '\q' >&"$A_IN"; } 2>/dev/null || true
  while IFS= read -r -t 60 -u "$A_FD_OUT" linie 2>/dev/null; do printf '%s\n' "$linie" >> "$A_ERR"; done
  wait "$A_PID_C" 2>/dev/null || true
  A_DESCHIS=0
}
# B: o singură operație, ca un cont, în fundal; rezultatul în B_STARE (SQLSTATE), B_COD (codul CF_* din mesaj), B_R (jsonb-ul la reușită)
pornesteB() {   # <uid> <instructiunea SELECT … AS r>
  printf '%s\n' "SET lock_timeout = '20s';" "BEGIN;" "$(ca "$1")" "$2 \\gset" "\\echo B_REZ :SQLSTATE" "\\echo B_MSG :LAST_ERROR_MESSAGE" "\\echo B_R :r" "COMMIT;" > "$D/B.sql"
  PGAPPNAME=retur_B psql -X -q -w -v ON_ERROR_STOP=0 -d "$CUR" -f "$D/B.sql" > "$B_LOG" 2>&1 &
  B_PID=$!
}
asteaptaB() {
  wait "$B_PID" 2>/dev/null; B_PID=''
  { echo "── B ($CUR) ──"; cat "$B_LOG"; } >> "$B_TOT"
  B_STARE="$(sed -n 's/^B_REZ //p' "$B_LOG" | tail -n 1)"; [ -n "$B_STARE" ] || B_STARE='FARA_MARCAJ'
  B_COD="$(sed -n 's/^B_MSG \(CF_[A-Z_]*\):.*/\1/p' "$B_LOG" | tail -n 1)"; [ -n "$B_COD" ] || B_COD='-'
  B_R="$(sed -n 's/^B_R //p' "$B_LOG" | tail -n 1)"
}
# a doua sesiune în fundal (C10), aceeași formă: rezultatul în B2_STARE / B2_COD
pornesteB2() {   # <uid> <instructiunea SELECT … AS r>
  printf '%s\n' "SET lock_timeout = '20s';" "BEGIN;" "$(ca "$1")" "$2 \\gset" "\\echo B_REZ :SQLSTATE" "\\echo B_MSG :LAST_ERROR_MESSAGE" "\\echo B_R :r" "COMMIT;" > "$D/B2.sql"
  PGAPPNAME=retur_B2 psql -X -q -w -v ON_ERROR_STOP=0 -d "$CUR" -f "$D/B2.sql" > "$B2_LOG" 2>&1 &
  B2_PID=$!
}
asteaptaB2() {
  wait "$B2_PID" 2>/dev/null; B2_PID=''
  { echo "── B2 ($CUR) ──"; cat "$B2_LOG"; } >> "$B_TOT"
  B2_STARE="$(sed -n 's/^B_REZ //p' "$B2_LOG" | tail -n 1)"; [ -n "$B2_STARE" ] || B2_STARE='FARA_MARCAJ'
  B2_COD="$(sed -n 's/^B_MSG \(CF_[A-Z_]*\):.*/\1/p' "$B2_LOG" | tail -n 1)"; [ -n "$B2_COD" ] || B2_COD='-'
}
# observatorul: sesiunea cu application_name dat (implicit retur_B) e blocată pe un lock (pg_stat_activity), plafon 10 s
bariera() {
  local r app="${1:-retur_B}"
  r="$(psql -X -q -w -d "$CUR" -tAc "DO \$o\$ DECLARE i int := 0; BEGIN LOOP EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND application_name = '$app' AND wait_event_type = 'Lock'); i := i + 1; IF i > 500 THEN RAISE EXCEPTION '$app nu asteapta pe niciun lock'; END IF; PERFORM pg_sleep(0.02); END LOOP; END \$o\$; SELECT 'BARIERA_OK';" 2>&1)"
  astept BARIERA_OK "$r" "observatorul: $app asteapta pe un lock (wait_event_type = Lock)"
}
retur_sql() { printf "SELECT public.fn_cf_retur_inregistreaza('%s', %s, %s, %s, '%s', %s, 'reper neconform', NULL, %s) AS r" "$1" "$2" "$3" "$4" "$5" "$6" "$7"; }
cheie() { q "SELECT gen_random_uuid()"; }

# ── fixtura, în fiecare bază: profilurile (owner, achiziții cu modulul) + o linie reconciliată cu primit / intrat / stoc dat ──
FIXTURA="$(cat <<'SQL'
INSERT INTO public.profiles (id, is_owner, can_process_achizitii) VALUES ('00000000-0000-4000-8000-000000000001', true, false), ('00000000-0000-4000-8000-000000000002', false, true);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('00000000-0000-4000-8000-000000000002', 'achizitii', 'editor');
CREATE FUNCTION public.t_linie(p_mat text, p_primita numeric, p_intrata numeric, p_stoc numeric, p_livrare text DEFAULT 'sediu', p_proiect bigint DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql AS $f$
DECLARE v_cf bigint; v_l bigint;
BEGIN
  INSERT INTO public.comenzi_furnizor (numar_comanda, livrare_tip, proiect_id, status) VALUES ('CMD_T_' || p_mat || '_' || substr(md5(random()::text), 1, 8), p_livrare, p_proiect, 'emisa') RETURNING id INTO v_cf;
  SET LOCAL app.cf_cantitati = '1';
  INSERT INTO public.comenzi_furnizor_linii (comanda_furnizor_id, denumire, um, cantitate, cantitate_primita, cantitate_intrata_stoc, intrare_reconciliata)
  VALUES (v_cf, p_mat, 'buc', p_primita, p_primita, p_intrata, true) RETURNING id INTO v_l;
  SET LOCAL app.cf_cantitati = '';
  IF p_stoc > 0 THEN
    INSERT INTO public.stocuri_miscari (locatie_tip, locatie_id, material_denumire, um, delta, tip, motiv, ref_tip)
    VALUES (CASE WHEN p_livrare = 'sediu' THEN 'sediu' ELSE 'proiect' END, CASE WHEN p_livrare = 'sediu' THEN NULL ELSE p_proiect END, p_mat, 'buc', p_stoc, 'ajustare_plus', 'fixtura', 'manual');
  END IF;
  RETURN v_l;
END $f$;
SQL
)"
creeaza_baza() {   # <nume> <fisier ddl>
  if "${PSM[@]}" -c "CREATE DATABASE \"$1\"" > /dev/null; then BAZE_CREATE+=("$1"); else echo "refuz: CREATE DATABASE $1 a esuat" >&2; exit 2; fi
  psql -X -q -w -v ON_ERROR_STOP=1 -d "$1" -1 -f <(tr -d '\r' < "$SCHELET") > /dev/null || return 1
  psql -X -q -w -v ON_ERROR_STOP=1 -d "$1" -1 -f "$2" > /dev/null || return 1
  psql -X -q -w -v ON_ERROR_STOP=1 -d "$1" -1 -c "$FIXTURA" > /dev/null || return 1
}

# ── scenariile; fiecare întoarce numărul de abateri în nesec ──
C1() {
  local L K; L="$(q "SELECT public.t_linie('MAT_C1', 50, 50, 50)")"; K="$(cheie)"
  deschideA
  pasA C1a "BEGIN;" "$(ca $UID_ACH)" "$(retur_sql "$K" "$L" 30 30 sediu NULL true);"; astept 00000 "$A_STARE" "A: retur 30 (necomis)"
  pornesteB $UID_ACH "$(retur_sql "$(cheie)" "$L" 30 30 sediu NULL true)"
  bariera
  pasA C1b "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  asteaptaB; astept P0001 "$B_STARE" "B: al doilea retur 30"; astept CF_PESTE_PRIMIT "$B_COD" "B: codul refuzului"
  inchideA
  astept "1|20" "$(q "SELECT count(*) || '|' || (SELECT cantitate_primita FROM public.comenzi_furnizor_linii WHERE id = $L) FROM public.comenzi_furnizor_retururi WHERE linie_id = $L")" "un retur, primita 20"
}
C2() {
  local L1 L2; L1="$(q "SELECT public.t_linie('MAT_C2', 40, 40, 50)")"; L2="$(q "SELECT public.t_linie('MAT_C2', 40, 40, 0)")"
  deschideA
  pasA C2a "BEGIN;" "$(ca $UID_ACH)" "$(retur_sql "$(cheie)" "$L1" 40 40 sediu NULL false);"; astept 00000 "$A_STARE" "A: retur 40 din L1 (necomis)"
  pornesteB $UID_ACH "$(retur_sql "$(cheie)" "$L2" 40 40 sediu NULL false)"
  bariera
  pasA C2b "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  asteaptaB; astept P0001 "$B_STARE" "B: retur 40 din L2"; astept CF_STOC_INSUFICIENT "$B_COD" "B: codul refuzului"
  inchideA
  astept 10.000 "$(q "SELECT cantitate FROM public.stocuri WHERE locatie_tip = 'sediu' AND material_denumire = 'MAT_C2'")" "stocul final (nu -30)"
}
C3() {
  local L; L="$(q "SELECT public.t_linie('MAT_C3', 50, 50, 50)")"
  deschideA
  pasA C3a "BEGIN;" "$(ca $UID_OWN)" "SELECT public.fn_stoc_ajustare('sediu', NULL, 'MAT_C3', 'buc', -30, 'iesire manuala de proba');"; astept 00000 "$A_STARE" "A: ajustare -30 (necomisa)"
  pornesteB $UID_ACH "$(retur_sql "$(cheie)" "$L" 30 30 sediu NULL false)"
  bariera
  pasA C3b "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  asteaptaB; astept P0001 "$B_STARE" "B: retur 30"; astept CF_STOC_INSUFICIENT "$B_COD" "B: codul refuzului"
  inchideA
  astept 20.000 "$(q "SELECT cantitate FROM public.stocuri WHERE locatie_tip = 'sediu' AND material_denumire = 'MAT_C3'")" "stocul final"
}
C4() {
  local L; L="$(q "SELECT public.t_linie('MAT_C4', 50, 0, 0)")"
  deschideA
  pasA C4a "BEGIN;" "$(ca $UID_ACH)" "$(retur_sql "$(cheie)" "$L" 10 0 sediu NULL false);"; astept 00000 "$A_STARE" "A: retur 10 (necomis)"
  pornesteB $UID_ACH "SELECT public.fn_cf_receptie_adauga('$(cheie)', $L, 5, 50) AS r"
  bariera
  pasA C4b "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  asteaptaB; astept P0001 "$B_STARE" "B: receptia din formularul vechi"; astept CF_VALOARE_SCHIMBATA "$B_COD" "B: codul refuzului"
  inchideA
  astept 40 "$(q "SELECT cantitate_primita FROM public.comenzi_furnizor_linii WHERE id = $L")" "primita = 40 (returul nesuprascris)"
}
C5() {
  local L SID R; L="$(q "SELECT public.t_linie('MAT_C5', 20, 0, 0, 'santier', 7)")"
  R="$(psql -X -q -w -d "$CUR" -tAc "BEGIN; $(ca $UID_ACH) SELECT public.fn_cf_intra_stoc('$(cheie)', $L, 20, true); COMMIT;" 2>&1 | tail -n 1)"
  SID="$(q "SELECT id FROM public.stocuri WHERE locatie_tip = 'proiect' AND locatie_id = 7 AND material_denumire = 'MAT_C5'")"
  astept 1 "$([ -n "$SID" ] && echo 1 || echo "0 ($R)")" "fixtura: transportul direct a pus marfa pe proiect"
  deschideA
  pasA C5a "BEGIN;" "$(ca $UID_OWN)" "SELECT public.fn_stoc_sterge_pozitie($SID);"; astept 00000 "$A_STARE" "A: stergerea pozitiei proiectului (necomisa)"
  pornesteB $UID_ACH "$(retur_sql "$(cheie)" "$L" 5 NULL proiect 7 false)"
  bariera
  pasA C5b "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  asteaptaB; astept P0001 "$B_STARE" "B: retur 5 din proiect"; astept CF_STOC_INSUFICIENT "$B_COD" "B: codul refuzului"
  inchideA
  astept 0 "$(q "SELECT count(*) FROM public.stocuri WHERE locatie_tip = 'proiect' AND locatie_id = 7 AND material_denumire = 'MAT_C5'")" "nicio pozitie recreata pe minus"
}
C6() {
  local L T op instr
  for op in receptie predare retur anulare inchidere; do
    q "UPDATE public.profiles SET can_process_achizitii = true WHERE id = '$UID_ACH'" > /dev/null
    L="$(q "SELECT public.t_linie('MAT_C6_$op', 50, 0, 0)")"; T=''
    if [ "$op" = anulare ] || [ "$op" = inchidere ]; then
      T="$(psql -X -q -w -d "$CUR" -tAc "BEGIN; $(ca $UID_OWN) $(retur_sql "$(cheie)" "$L" 5 0 sediu NULL true); COMMIT;" | sed -n 's/.*"retur_id": *\([0-9]*\).*/\1/p' | head -n 1)"
    fi
    case "$op" in
      receptie) instr="SELECT public.fn_cf_receptie_adauga('$(cheie)', $L, 1, 50) AS r";;
      predare) instr="SELECT public.fn_cf_intra_stoc('$(cheie)', $L, 1, false) AS r";;
      retur) instr="$(retur_sql "$(cheie)" "$L" 1 0 sediu NULL false)";;
      anulare) instr="SELECT public.fn_cf_retur_anuleaza('$(cheie)', ${T:-0}, 'retur gresit de proba') AS r";;
      inchidere) instr="SELECT public.fn_cf_retur_inchide_fara_inlocuire('$(cheie)', ${T:-0}, 'furnizorul nu livreaza') AS r";;
    esac
    local inainte; inainte="$(q "SELECT md5(row_to_json(l)::text) FROM public.comenzi_furnizor_linii l WHERE id = $L")"
    deschideA
    pasA "C6a_$op" "BEGIN;" "$(ca $UID_OWN)" "SELECT public.fn_cf_receptie_adauga('$(cheie)', $L, 2, $(q "SELECT coalesce(cantitate_primita::text, 'NULL') FROM public.comenzi_furnizor_linii WHERE id = $L")) IS NULL;" ; astept 00000 "$A_STARE" "A ($op): owner tine linia (receptie necomisa)"
    pornesteB $UID_ACH "$instr"
    bariera
    q "UPDATE public.profiles SET can_process_achizitii = false WHERE id = '$UID_ACH'" > /dev/null
    pasA "C6b_$op" "ROLLBACK;"; astept 00000 "$A_STARE" "A ($op): ROLLBACK (linia neschimbata de A)"
    asteaptaB; astept 42501 "$B_STARE" "B ($op): dreptul retras cat astepta"
    inchideA
    astept "$inainte" "$(q "SELECT md5(row_to_json(l)::text) FROM public.comenzi_furnizor_linii l WHERE id = $L")" "B ($op): linia neschimbata"
  done
  q "UPDATE public.profiles SET can_process_achizitii = true WHERE id = '$UID_ACH'" > /dev/null
}
C7() {
  local L K; L="$(q "SELECT public.t_linie('MAT_C7', 50, 50, 50)")"; K="$(cheie)"
  deschideA
  pasA C7a "BEGIN;" "$(ca $UID_ACH)" "$(retur_sql "$K" "$L" 10 10 sediu NULL false);"; astept 00000 "$A_STARE" "A: retur cu cheia K (necomis)"
  pornesteB $UID_ACH "$(retur_sql "$K" "$L" 10 10 sediu NULL false)"
  bariera
  pasA C7b "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT"
  asteaptaB; astept 00000 "$B_STARE" "B: aceeasi cheie, acelasi payload"
  astept true "$(printf '%s' "$B_R" | sed -n 's/.*"reluat": *\(true\|false\).*/\1/p')" "B: rezultatul comis (reluat)"
  inchideA
  astept "1|40.000" "$(q "SELECT count(*) || '|' || (SELECT cantitate FROM public.stocuri WHERE locatie_tip = 'sediu' AND material_denumire = 'MAT_C7') FROM public.comenzi_furnizor_retururi WHERE cheie = '$K'")" "un retur cu K, stocul scazut o data"
}
# starea liniei + a stocului ei (pentru „nimic scris de B”)
stare_l() { q "SELECT md5(row_to_json(l)::text) || '|' || coalesce((SELECT string_agg(s.locatie_tip || ':' || s.cantitate, ',' ORDER BY s.id) FROM public.stocuri s WHERE s.material_denumire = l.denumire), '-') || '|' || (SELECT count(*) FROM public.comenzi_furnizor_receptii r WHERE r.linie_id = l.id) FROM public.comenzi_furnizor_linii l WHERE l.id = $1"; }
C8() {
  local L inainte
  q "UPDATE public.profiles SET can_process_achizitii = true WHERE id = '$UID_ACH'" > /dev/null
  L="$(q "SELECT public.t_linie('MAT_C8', 50, 0, 50)")"; inainte="$(stare_l "$L")"
  deschideA
  pasA C8a "BEGIN;" "SELECT 1 FROM public.stocuri WHERE locatie_tip = 'sediu' AND locatie_id IS NULL AND material_denumire = 'MAT_C8' FOR UPDATE;"
  astept 00000 "$A_STARE" "A: tine randul din stocuri al sediului (FOR UPDATE, necomis)"
  pornesteB $UID_ACH "SELECT public.fn_cf_intra_stoc('$(cheie)', $L, 10, false) AS r"
  bariera
  q "UPDATE public.profiles SET can_process_achizitii = false WHERE id = '$UID_ACH'" > /dev/null
  pasA C8b "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT (randul eliberat)"
  asteaptaB; astept 42501 "$B_STARE" "B: predarea, dreptul retras cat astepta randul din stocuri"
  inchideA
  q "UPDATE public.profiles SET can_process_achizitii = true WHERE id = '$UID_ACH'" > /dev/null
  astept "$inainte" "$(stare_l "$L")" "B: linia si stocul neschimbate"
}
C9() {
  local L X R inainte
  q "UPDATE public.profiles SET can_process_achizitii = true WHERE id = '$UID_ACH'" > /dev/null
  L="$(q "SELECT public.t_linie('MAT_C9', 50, 0, 0)")"
  R="$(psql -X -q -w -d "$CUR" -tAc "BEGIN; $(ca $UID_OWN) SELECT public.fn_cf_receptie_adauga('$(cheie)', $L, 5, 50); COMMIT;" 2>&1 | tail -n 1)"
  X="$(q "SELECT max(id) FROM public.comenzi_furnizor_receptii WHERE linie_id = $L AND tip = 'receptie'")"
  astept 1 "$([ -n "$X" ] && echo 1 || echo "0 ($R)")" "fixtura: receptia +5 (primita 55)"
  inainte="$(stare_l "$L")"
  deschideA
  pasA C9a "BEGIN;" "SELECT 1 FROM public.comenzi_furnizor_receptii WHERE id = ${X:-0} FOR UPDATE;"
  astept 00000 "$A_STARE" "A: tine receptia +5 (FOR UPDATE, necomis)"
  pornesteB $UID_ACH "SELECT public.fn_cf_receptie_adauga('$(cheie)', $L, -3, 55) AS r"
  bariera
  q "UPDATE public.profiles SET can_process_achizitii = false WHERE id = '$UID_ACH'" > /dev/null
  pasA C9b "ROLLBACK;"; astept 00000 "$A_STARE" "A: ROLLBACK (receptia eliberata)"
  asteaptaB; astept 42501 "$B_STARE" "B: corectura, dreptul retras cat astepta FK-ul pe receptie (dupa verificarea de dupa lock-uri)"
  inchideA
  q "UPDATE public.profiles SET can_process_achizitii = true WHERE id = '$UID_ACH'" > /dev/null
  astept "$inainte" "$(stare_l "$L")" "B: linia si jurnalul neschimbate"
}
C10() {
  local L1 L2
  q "UPDATE public.profiles SET can_process_achizitii = true WHERE id = '$UID_ACH'" > /dev/null
  L1="$(q "SELECT public.t_linie('MAT_C10', 8, 0, 0, 'santier', 9)")"; L2="$(q "SELECT public.t_linie('MAT_C10', 10, 10, 10)")"
  # bariera de probă (doar în baza de unică folosință): după intrarea la sediu a transportului, trigger-ul cere lock-ul 4242010 ținut de A
  q "CREATE FUNCTION public.t_bariera_c10() RETURNS trigger LANGUAGE plpgsql AS \$f\$ BEGIN IF NEW.material_denumire = 'MAT_C10' AND NEW.tip = 'intrare_achizitie' THEN PERFORM pg_advisory_xact_lock(4242010); END IF; RETURN NEW; END \$f\$; CREATE TRIGGER zz_t_bariera_c10 AFTER INSERT ON public.stocuri_miscari FOR EACH ROW EXECUTE FUNCTION public.t_bariera_c10();" > /dev/null
  deschideA
  pasA C10a "BEGIN;" "SELECT pg_advisory_xact_lock(4242010);"; astept 00000 "$A_STARE" "A: tine bariera 4242010"
  pornesteB $UID_ACH "SELECT public.fn_cf_intra_stoc('$(cheie)', $L1, 8, true) AS r"
  bariera retur_B
  pornesteB2 $UID_ACH "$(retur_sql "$(cheie)" "$L2" 10 10 sediu NULL false)"
  bariera retur_B2
  pasA C10b "COMMIT;"; astept 00000 "$A_STARE" "A: COMMIT (bariera eliberata)"
  asteaptaB; asteaptaB2
  astept 00000 "$B_STARE" "B: transportul direct (fara deadlock)"; astept 00000 "$B2_STARE" "B2: returul din sediu (fara deadlock)"
  inchideA
  astept "0.000|8.000" "$(q "SELECT (SELECT cantitate FROM public.stocuri WHERE locatie_tip = 'sediu' AND material_denumire = 'MAT_C10') || '|' || (SELECT cantitate FROM public.stocuri WHERE locatie_tip = 'proiect' AND locatie_id = 9 AND material_denumire = 'MAT_C10')")" "stocul: sediu 10 + 8 - 8 - 10, proiect 8"
  q "DROP TRIGGER zz_t_bariera_c10 ON public.stocuri_miscari; DROP FUNCTION public.t_bariera_c10();" > /dev/null
}

echo "0. bazele de unica folosinta: scheletul + DDL-ul migrarii (sectiunile 2-6) + fixtura"
EXISTENTE=" $("${PSM[@]}" -tAc "SELECT string_agg(rolname, ' ') FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'supabase_auth_admin')") "
for r in "${ROLURI[@]}"; do case "$EXISTENTE" in *" $r "*) ;; *) ROLURI_CREATE+=("$r");; esac; done
echo "     roluri de cluster create (si sterse la final): ${ROLURI_CREATE[*]:-niciunul}"
tr -d '\r' < "$MIG" | sed -n '/^-- ─── 2\. /,/^-- ─── 7\. /p' > "$DDL"
grep -q '^CREATE TRIGGER trg_stoc_miscari_lock_iesire' "$DDL" && grep -q '^CREATE FUNCTION public.fn_cf_retur_inregistreaza' "$DDL"
ok $? "DDL-ul extras din migrare (trigger-ul de lock + RPC-ul de retur prezente)"
CUR="$BAZA"
creeaza_baza "$BAZA" "$DDL"; ok $? "baza $BAZA: schelet + DDL + fixtura"

echo "1. scenariile pe migrarea corecta (fiecare: 0 abateri)"
for s in C1 C2 C3 C4 C5 C6 C7 C8 C9 C10; do
  nesec=0; echo "   $s"; "$s"; ok "$nesec" "$s: toate asteptarile ($nesec abateri)"
done

echo "2. MUTANTII (fiecare TREBUIE sa pice scenariul lui)"
mutant() {   # <nr> <nume> <scenarii> <din> <in> [<din2> <in2>]
  local nr="$1" nume="$2" scen="$3" text; text="$(cat "$DDL")"
  shift 3
  while [ $# -ge 2 ]; do
    case "$text" in *"$1"*) ;; *) ok 1 "M$nr ($nume): textul mutantului nu se gaseste"; return;; esac
    text="${text/"$1"/"$2"}"; shift 2
  done
  printf '%s\n' "$text" > "$D/ddl_m$nr.sql"
  CUR="${BAZA}_m$nr"
  creeaza_baza "$CUR" "$D/ddl_m$nr.sql" || { ok 1 "M$nr ($nume): baza mutantului nu s-a creat"; CUR="$BAZA"; return; }
  local s
  for s in $scen; do
    nesec=0; echo "   M$nr $s"; "$s"
    if [ "$nesec" -gt 0 ]; then ok 0 "M$nr ($nume) PRINS de $s ($nesec abateri)"; else ok 1 "M$nr ($nume) NEPRINS de $s"; fi
  done
  CUR="$BAZA"
}
mutant 1 "fara FOR UPDATE pe linie" "C1" \
  'SELECT * INTO linie FROM public.comenzi_furnizor_linii l WHERE l.id = p_linie_id FOR UPDATE;' 'SELECT * INTO linie FROM public.comenzi_furnizor_linii l WHERE l.id = p_linie_id;'
mutant 2 "fara lock de stoc la retur" "C2 C3 C5" \
  '    v_stoc := public.fn_stoc_blocheaza(p_locatie_tip, p_locatie_id, v_l.denumire);' \
  '    SELECT coalesce(sum(s.cantitate), 0) INTO v_stoc FROM public.stocuri s WHERE s.locatie_tip = p_locatie_tip AND s.locatie_id IS NOT DISTINCT FROM p_locatie_id AND s.material_denumire = v_l.denumire;'
mutant 3 "fara CAS pe p_primita_citita" "C4" \
  '  IF v_p.primita_bruta IS DISTINCT FROM p_primita_citita THEN' '  IF false THEN'
# (r2) reverificarea finală (la închiderea intenției) o prinde și pe cea citită prea devreme: M4 le scoate pe amândouă (starea dinainte de r1)
FINAL_DIN=$'  IF NOT coalesce(v_ok, false) THEN RAISE EXCEPTION \'CF_DREPT: operatie nepermisa\' USING ERRCODE = \'42501\'; END IF;\n'
mutant 4 "dreptul citit inaintea lock-urilor, fara reverificarea finala (retur)" "C6" \
  '  v_loc_ok boolean; v_stoc numeric;' '  v_loc_ok boolean; v_drept boolean := public.fn_cf_drept_achizitii_intern(auth.uid()); v_stoc numeric;' \
  $'    v_stoc := public.fn_stoc_blocheaza(p_locatie_tip, p_locatie_id, v_l.denumire);\n  END IF;\n  IF NOT public.fn_cf_drept_achizitii_intern(v_uid) THEN' \
  $'    v_stoc := public.fn_stoc_blocheaza(p_locatie_tip, p_locatie_id, v_l.denumire);\n  END IF;\n  IF NOT v_drept THEN' \
  "$FINAL_DIN" ''
mutant 5 "fara lock pe cheia de idempotenta" "C7" \
  $'  PERFORM pg_advisory_xact_lock(hashtextextended(\'cf_intentie|\' || p_cheie::text, 0));\n' ''
mutant 6 "starea r1 a predarii: cheile de stoc dupa prima miscare + fara reverificarea finala" "C8" \
  $'  IF v_loc_err IS NULL THEN\n    FOR k IN' $'  IF false THEN\n    FOR k IN' \
  "$FINAL_DIN" ''
mutant 7 "fara reverificarea finala a dreptului" "C9" \
  "$FINAL_DIN" ''
mutant 8 "cheile de stoc luate dupa prima miscare (transportul direct)" "C10" \
  $'  IF v_loc_err IS NULL THEN\n    FOR k IN' $'  IF false THEN\n    FOR k IN'

[ "$esec" = 0 ] && echo "TOTUL OK" || echo "ESEC: $esec"
