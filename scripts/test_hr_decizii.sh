#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261018a_hr_decizii_registru (generator decizii, PR1). EXCLUSIV pe un PostgreSQL local dedicat
# (implicit PG16, /tmp/pg_hr_dec, 127.0.0.1:5979). Nu atinge producția.
#   0. schelet (supabase/tests/hr_decizii_schelet.sql) + fn_completare_aplica revizuită 47a75428 (docs/sec_f2_whitelist)
#   1. fișierul fără runner → garda refuză, nimic creat
#   2. precondiții negative: fn_completare_aplica alt md5 · completari_ins altă condiție · hr.decizii în app_modules
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + gate 0e) → cod 0
#   4. teste SQL (supabase/tests/hr_decizii.test.sql) — testele de acceptare §10 acoperite în PR1
#   5. reaplicare → refuz
#   6. revenire: nearmată → refuz; armată pe starea curată → obiectele dispar, fn_completare_aplica și completari_ins revin
#      la forma revizuită (md5 47a75428), gate 0e = 0
# Utilizare: bash scripts/test_hr_decizii.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_hr_dec}"
PORT="${PGPORT_TEST:-5979}"
BAZA=hrdec_test
NUME=20261018a_hr_decizii_registru
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/hr_decizii_schelet.sql"
TESTE="$RADACINA/supabase/tests/hr_decizii.test.sql"
FN_REV="$RADACINA/docs/sec_f2_whitelist/fn_completare_aplica_47a75428.sql"
# fn_completare_aplica ca pe live (citit 06.10): owner postgres, definer, EXECUTE doar authenticated + service_role
fn_rev() { "${PSQL[@]}" -d "$BAZA" -f "$FN_REV" -c "REVOKE ALL ON FUNCTION public.fn_completare_aplica(bigint, boolean) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.fn_completare_aplica(bigint, boolean) TO authenticated, service_role" >/dev/null; }
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
case "$DATE_DIR" in /tmp/pg_hr_dec*) ;; *) mediu "PGDATA_TEST trebuie să fie sub /tmp/pg_hr_dec* (primit: $DATE_DIR)";; esac
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_hr_dec" ] || mediu "$DATE_DIR există și nu e marcat ca fixture (.fixture_hr_dec) — nu îl șterg"
  if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || mediu "nu pot opri clusterul din $DATE_DIR"; fi
  rm -rf "$DATE_DIR"
fi
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_hr_dec"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_hr_dec.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
gate_0e() { local o; o="$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql")" || esec "gate 0e: psql a eșuat"; [ -z "$o" ] || esec "gate 0e: $o"; ok "gate 0e = 0 ($1)"; }
STARE="SELECT md5(prosrc) || '|' || (SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polname = 'completari_ins') FROM pg_proc WHERE proname = 'fn_completare_aplica'"

"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
fn_rev
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE proname = 'fn_completare_aplica'")" = 47a7542895c0ce71cb0e44d2c26d0609 ] || esec "0 fn_completare_aplica din schelet ≠ 47a75428"
STARE0="$(q "$STARE")"
gate_0e inainte
ok "0 schelet + fn_completare_aplica revizuită (47a75428)"

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
[ "$(q "SELECT count(*) FROM pg_class WHERE relname LIKE 'hr_decizii%'")" = 0 ] || esec "1 ceva s-a creat"
ok "1 fără runner → refuz, nimic creat"

refuza_cu() { local out; if out="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1)"; then esec "$1 a trecut"; fi
  grep -q "$2" <<<"$out" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$out")"; }
q "CREATE OR REPLACE FUNCTION public.fn_completare_aplica(p_id bigint, p_accepta boolean) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS \$x\$ SELECT '{}'::jsonb \$x\$" >/dev/null
refuza_cu "2a fn_completare_aplica alt corp" "Precondiție 0c"
fn_rev
q "ALTER POLICY completari_ins ON public.executie_completari_propuse WITH CHECK (auth.uid() IS NOT NULL)" >/dev/null
refuza_cu "2b completari_ins altă condiție" "Precondiție 0d"
q "ALTER POLICY completari_ins ON public.executie_completari_propuse WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (p.is_owner OR p.can_manage_contracts)))" >/dev/null
q "INSERT INTO app_modules (key, name) VALUES ('hr.decizii', 'x')" >/dev/null
refuza_cu "2c hr.decizii în app_modules" "Precondiție 0f"
q "DELETE FROM app_modules WHERE key = 'hr.decizii'" >/dev/null
q "CREATE FUNCTION public._hr_strain() RETURNS int LANGUAGE sql AS 'SELECT 1'" >/dev/null
refuza_cu "2d funcție preexistentă cu prefixul migrării" "Precondiție 0h"
q "DROP FUNCTION public._hr_strain()" >/dev/null
[ "$(q "$STARE")" = "$STARE0" ] || esec "2 starea nerefăcută"
ok "2 refuz la: fn_completare_aplica alt corp · completari_ins altă condiție · hr.decizii existent"

SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261007090000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/hr_dec_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/hr_dec_runner.out >&2; esec "3 runner cod $RC"; }
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA"
gate_0e dupa

OUT="$("${PSQL[@]}" -d "$BAZA" -f "$TESTE" 2>&1)" || { echo "$OUT" | grep -v 'NOTICE:  OK' | grep -E 'ERROR|TEST' >&2; esec "4 teste SQL"; }
N="$(grep -c 'NOTICE:  OK' <<<"$OUT")"
grep -q 'TESTE SQL: TOATE OK' <<<"$OUT" || esec "4 testele nu au ajuns la final"
ok "4 teste SQL: $N verificări OK"
# 4b. concurență cu două sesiuni, cu BARIERĂ (J6-2): A face operația și ține lock-ul în pg_sleep; B pornește abia după ce
#     A e în pg_sleep, iar testul cere ca B să fie văzut BLOCAT (pg_blocking_pids) înainte ca A să comită.
NAT=00000000-0000-0000-0000-000000000126; RAZ=00000000-0000-0000-0000-000000000121
SEMN="(SELECT id FROM hr_decizii_semnatari WHERE employee_id = 121)"
AN="$(q "SELECT extract(year FROM public._hr_azi())::int")"
mk() { "${PSQL[@]}" -d "$BAZA" -At -c "SELECT teste.ca('$NAT')" -c "$1" | tail -1; }
# $1 app, $2 '' (admin) sau uuid, $3 sql, $4 secunde de ținut, $5 fișier ieșire
tx() { PGAPPNAME="$1" "${PSQL[@]}" -d "$BAZA" -At -v ON_ERROR_STOP=1 -c "BEGIN" ${2:+-c "SELECT teste.ca('$2')"} -c "$3" -c "SELECT pg_sleep($4)" -c "COMMIT" >"$5" 2>&1 || true; }
asteapta() { local i; for i in $(seq 150); do [ "$(q "$2")" = 1 ] && return 0; sleep 0.1; done; esec "barieră $1"; }
# pereche: A (app hrA) ține 3 s; B (hrB) trebuie să aștepte un lock al lui A
pereche() { # $1 eticheta, $2 userA, $3 sqlA, $4 userB, $5 sqlB
  tx hrA "$2" "$3" 3 /tmp/hr_pa.out & local PA=$!
  asteapta "$1: A n-a ajuns în pg_sleep ($(cat /tmp/hr_pa.out))" "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'hrA' AND state = 'active' AND query LIKE 'SELECT pg_sleep%'"
  tx hrB "$4" "$5" 0 /tmp/hr_pb.out & local PB=$!
  asteapta "$1: B nu a fost blocat de A" "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'hrB' AND cardinality(pg_blocking_pids(pid)) > 0"
  wait $PA; wait $PB; }
VERIF_IMP='{"nr":true,"persoana":true,"semnatar":true,"semnatura":true,"stampila":true,"lizibil":true,"sursa":"pdf","pagini":1,"pagini_sursa":"detectat","generat":false}'
VERIF_GEN='{"nr":true,"persoana":true,"semnatura":true,"stampila":true,"cod":true,"lizibil":true,"sursa":"foto","pagini":1,"pagini_sursa":"detectat","generat":true}'
import_semnat() {  # $1 numar, $2 employee, $3 proiect, $4 tip, $5 eticheta → id
  local id; id="$(mk "SELECT (public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'an', $AN, 'numar',$1,'tip_cod','$4','eticheta_functie','$5','nivel','proiect','proiect_id',$3,'employee_id',$2,'titlu','Dl.','data_emitere', public._hr_azi(),'propune_efect',true)))->>'id'")"
  [ -n "$id" ] || esec "import_semnat $1: importul a eșuat"
  "${PSQL[@]}" -d "$BAZA" -At -c "SELECT teste.ca('$NAT')" -c "SELECT teste.urca('HR/$AN/$id/semnat_1.pdf')" \
    -c "SELECT public.fn_hr_decizie_ataseaza_scan($id, 'HR/$AN/$id/semnat_1.pdf', repeat('a',64), '$VERIF_IMP')" >/dev/null
  echo "$id"; }
revocare_semnata() { # $1 tinta → id revocare (emisă, PDF, scanul NU e atașat)
  local rv hr; rv="$(mk "INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, revoca_id, data_emitere, data_efect, semnatar_id) VALUES ('REVOCARE','Revocare','firma',$1, public._hr_azi(), public._hr_azi(), $SEMN) RETURNING id")"
  hr="$(mk "SELECT public.fn_hr_decizie_previzualizeaza($rv)->>'hash_previzualizare'")"
  "${PSQL[@]}" -d "$BAZA" -At -c "SELECT teste.ca('$NAT')" -c "SELECT public.fn_hr_decizie_emite($rv, '$hr', gen_random_uuid(), 12, NULL, '[\"R5\"]')" \
    -c "SELECT teste.urca('HR/$AN/$rv/generat_1.pdf')" -c "SELECT teste.urca('HR/$AN/$rv/semnat_2.pdf')" \
    -c "SELECT public.fn_hr_decizie_seteaza_pdf($rv, 'HR/$AN/$rv/generat_1.pdf', repeat('b',64))" >/dev/null
  echo "$rv"; }
q "INSERT INTO executie_proiecte (id, nume, activ, nr_contract) VALUES (40,'Proiect C4',true,NULL), (41,'Proiect C8',true,NULL), (42,'Proiect C3',true,'1'), (43,'Proiect C3b',true,'1')" >/dev/null

# C1 (Vf9/T49): același cerere_id → un rând, același număr
C="$(q "SELECT gen_random_uuid()")"
P1="SELECT public.fn_hr_decizie_rezerva(jsonb_build_object('cerere_id','$C','tip_cod','ALTA_DECIZIE','descriere','concurent','nivel','firma','data_emitere', public._hr_azi()))->>'numar'"
pereche C1 $NAT "$P1" $NAT "$P1"
A="$(grep -E '^[0-9]+$' /tmp/hr_pa.out | head -1)"; B="$(grep -E '^[0-9]+$' /tmp/hr_pb.out | head -1)"
[ -n "$A" ] && [ "$A" = "$B" ] && [ "$(q "SELECT count(*) FROM hr_decizii WHERE cerere_id = '$C'")" = 1 ] || esec "C1: A=$A B=$B ($(cat /tmp/hr_pb.out))"
ok "C1 rezervare cu același cerere_id (B blocat pe A) → un rând, numărul $A"

# C2 (T43): înlocuire vs revocare pe aceeași țintă
IMP="$(import_semnat 3960 203 42 RTE RTE)"
DI="$(mk "INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, employee_id, proiect_id, proiect_denumire, titlu, data_emitere, data_efect, semnatar_id, inlocuieste_id, autorizatie_id, domenii_isc) VALUES ('RTE','RTE','proiect',200,42,'Sonda','Dl.', public._hr_azi(), public._hr_azi(), $SEMN, $IMP, 1, ARRAY['1.1']) RETURNING id")"
DR="$(mk "INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, revoca_id, data_emitere, data_efect, semnatar_id) VALUES ('REVOCARE','Revocare','firma',$IMP, public._hr_azi(), public._hr_azi(), $SEMN) RETURNING id")"
HI="$(mk "SELECT public.fn_hr_decizie_previzualizeaza($DI)->>'hash_previzualizare'")"; HR_="$(mk "SELECT public.fn_hr_decizie_previzualizeaza($DR)->>'hash_previzualizare'")"
pereche C2 $NAT "SELECT public.fn_hr_decizie_emite($DI, '$HI', gen_random_uuid(), 12, NULL, '[\"R5\"]')->>'numar'" $NAT "SELECT public.fn_hr_decizie_emite($DR, '$HR_', gen_random_uuid(), 12, NULL, '[\"R5\"]')->>'numar'"
grep -q ERROR /tmp/hr_pa.out && esec "C2 prima emitere a eșuat: $(cat /tmp/hr_pa.out)"
grep -Eq 'B9|schimbat' /tmp/hr_pb.out || esec "C2 a doua emitere nu a fost refuzată: $(cat /tmp/hr_pb.out)"
[ "$(q "SELECT count(*) FROM hr_decizii WHERE coalesce(inlocuieste_id, revoca_id) = $IMP AND stare = 'emisa'")" = 1 ] || esec "C2 nu e exact o relație vie"
ok "C2 înlocuire vs revocare (B blocat pe ținta lui A) → exact una emisă, cealaltă refuzată"

# C3 (T64): confirmarea efectului vs scanul înlocuirii, ambele ordini
PROP="$(q "SELECT id FROM executie_completari_propuse WHERE hr_decizie_id = $IMP AND status = 'propus'")"
"${PSQL[@]}" -d "$BAZA" -At -c "SELECT teste.ca('$NAT')" -c "SELECT teste.urca('HR/$AN/$DI/generat_1.pdf')" -c "SELECT teste.urca('HR/$AN/$DI/semnat_2.pdf')" \
  -c "SELECT public.fn_hr_decizie_seteaza_pdf($DI, 'HR/$AN/$DI/generat_1.pdf', repeat('b',64))" >/dev/null
pereche C3a $RAZ "SELECT public.fn_completare_aplica($PROP, true)" $NAT "SELECT public.fn_hr_decizie_ataseaza_scan($DI, 'HR/$AN/$DI/semnat_2.pdf', repeat('c',64), '$VERIF_GEN')"
grep -qi deadlock /tmp/hr_pa.out /tmp/hr_pb.out && esec "C3a deadlock"
grep -q ERROR /tmp/hr_pa.out /tmp/hr_pb.out && esec "C3a eroare: $(cat /tmp/hr_pa.out /tmp/hr_pb.out)"
[ "$(q "SELECT (SELECT status FROM executie_completari_propuse WHERE id = $PROP) || '|' || (SELECT stare FROM hr_decizii WHERE id = $IMP) || '|' || (SELECT rte_employee_id FROM executie_proiecte WHERE id = 42)")" = "confirmat|inlocuita|203" ] || esec "C3a stare finală"
IMP2="$(import_semnat 6000 203 43 RTE RTE)"; PROP2="$(q "SELECT id FROM executie_completari_propuse WHERE hr_decizie_id = $IMP2 AND status = 'propus'")"
RV2="$(revocare_semnata $IMP2)"
pereche C3b $NAT "SELECT public.fn_hr_decizie_ataseaza_scan($RV2, 'HR/$AN/$RV2/semnat_2.pdf', repeat('c',64), '$VERIF_GEN')" $RAZ "SELECT public.fn_completare_aplica($PROP2, true)"
grep -qi deadlock /tmp/hr_pa.out /tmp/hr_pb.out && esec "C3b deadlock"
grep -q ERROR /tmp/hr_pa.out && esec "C3b scanul revocării a eșuat: $(cat /tmp/hr_pa.out)"
grep -Eq 'deja decis|nu mai e in vigoare' /tmp/hr_pb.out || esec "C3b confirmarea nu a fost refuzată: $(cat /tmp/hr_pb.out)"
[ "$(q "SELECT (SELECT status FROM executie_completari_propuse WHERE id = $PROP2) || '|' || (SELECT stare FROM hr_decizii WHERE id = $IMP2) || '|' || coalesce((SELECT rte_employee_id::text FROM executie_proiecte WHERE id = 43), '-')")" = "expirat|revocata|-" ] || esec "C3b stare finală"
ok "C3 confirmare vs scan, ambele ordini: confirmarea întâi → confirmat + țintă înlocuită; revocarea întâi → propunere expirată, confirmarea refuzată, echipa neschimbată; fără deadlock"

# C4 (J5-5): proiect dezactivat în timpul confirmării, ambele ordini
D4="$(import_semnat 7000 201 40 MP 'Manager Proiect')"; P4="$(q "SELECT id FROM executie_completari_propuse WHERE hr_decizie_id = $D4")"
[ -n "$P4" ] || esec "C4 pregătire: fără propunere"
pereche C4a '' "UPDATE executie_proiecte SET activ = false WHERE id = 40" $RAZ "SELECT public.fn_completare_aplica($P4, true)"
grep -q "nu mai e in vigoare" /tmp/hr_pb.out || esec "C4a confirmarea a trecut pe un proiect devenit inactiv: $(cat /tmp/hr_pb.out)"
[ "$(q "SELECT coalesce(mp_employee_id::text,'-') || '|' || (SELECT status FROM executie_completari_propuse WHERE id = $P4) FROM executie_proiecte WHERE id = 40")" = "-|propus" ] || esec "C4a stare finală"
q "UPDATE executie_proiecte SET activ = true WHERE id = 40" >/dev/null
pereche C4b $RAZ "SELECT public.fn_completare_aplica($P4, true)" '' "UPDATE executie_proiecte SET activ = false WHERE id = 40"
grep -q ERROR /tmp/hr_pa.out && esec "C4b confirmarea a eșuat: $(cat /tmp/hr_pa.out)"
[ "$(q "SELECT mp_employee_id || '|' || activ FROM executie_proiecte WHERE id = 40")" = "201|false" ] || esec "C4b stare finală"
ok "C4 proiect dezactivat în timpul confirmării: dezactivarea întâi → refuz, echipa neschimbată; confirmarea întâi → confirmat, apoi dezactivat"

# C5 (T1): numere automate concurente = exact următoarele două, contorul fără salt
U0="$(q "SELECT ultimul FROM hr_decizii_contor WHERE an = $AN")"; E1=$((U0+1)); E2=$((U0+2))
[ "$(q "SELECT count(*) FROM hr_decizii WHERE serie = 'HR' AND an = $AN AND numar IN ($E1, $E2)")" = 0 ] || esec "C5 fixture: $E1/$E2 deja ocupate"
R5="SELECT public.fn_hr_decizie_rezerva(jsonb_build_object('cerere_id', gen_random_uuid(),'tip_cod','ALTA_DECIZIE','descriere','c5','nivel','firma','data_emitere', public._hr_azi()))->>'numar'"
pereche C5 $NAT "$R5" $NAT "$R5"
A="$(grep -E '^[0-9]+$' /tmp/hr_pa.out | head -1)"; B="$(grep -E '^[0-9]+$' /tmp/hr_pb.out | head -1)"
[ "$A" = "$E1" ] && [ "$B" = "$E2" ] && [ "$(q "SELECT ultimul FROM hr_decizii_contor WHERE an = $AN")" = "$E2" ] || esec "C5: A=$A B=$B (așteptat $E1, $E2)"
ok "C5 numere automate concurente: exact $E1 și $E2, contorul = $E2"

# C6 (T67): import concurent același număr
I6="SELECT public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(),'an',2024,'numar',555,'tip_cod','ALTA_DECIZIE','descriere','c6','nivel','firma','data_emitere','2024-05-05'))->>'numar'"
pereche C6 $NAT "$I6" $NAT "$I6"
grep -q '^555$' /tmp/hr_pa.out && grep -q 'folosit' /tmp/hr_pb.out && [ "$(q "SELECT count(*) FROM hr_decizii WHERE an = 2024 AND numar = 555")" = 1 ] || esec "C6: $(cat /tmp/hr_pa.out /tmp/hr_pb.out)"
ok "C6 import concurent 555/2024 → unul intră, celălalt „e folosit”"

# C7 (T61): contractul se schimbă în timpul emiterii, ambele ordini
q "UPDATE executie_proiecte SET nr_contract = '52675' WHERE id = 32" >/dev/null
D7="$(mk "INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, employee_id, proiect_id, proiect_denumire, titlu, data_emitere, data_efect, semnatar_id) VALUES ('MP','Manager Proiect','proiect',203,32,'Sonda','D-na', public._hr_azi(), public._hr_azi(), $SEMN) RETURNING id")"
H7="$(mk "SELECT public.fn_hr_decizie_previzualizeaza($D7)->>'hash_previzualizare'")"
pereche C7a '' "UPDATE executie_proiecte SET nr_contract = '99999' WHERE id = 32" $NAT "SELECT public.fn_hr_decizie_emite($D7, '$H7', gen_random_uuid(), 12)->>'numar'"
grep -q "s-a schimbat" /tmp/hr_pb.out || esec "C7a emiterea a trecut peste un contract schimbat: $(cat /tmp/hr_pb.out)"
q "UPDATE executie_proiecte SET nr_contract = '52675' WHERE id = 32" >/dev/null
H7="$(mk "SELECT public.fn_hr_decizie_previzualizeaza($D7)->>'hash_previzualizare'")"
pereche C7b $NAT "SELECT public.fn_hr_decizie_emite($D7, '$H7', gen_random_uuid(), 12)->>'numar'" '' "UPDATE executie_proiecte SET nr_contract = '88888' WHERE id = 32"
grep -q ERROR /tmp/hr_pa.out && esec "C7b emiterea a eșuat: $(cat /tmp/hr_pa.out)"
[ "$(q "SELECT (snapshot->'proiect'->>'nr_contract') || '|' || (continut->'articole'->0->>'text' LIKE '%nr. 52675/%') FROM hr_decizii WHERE id = $D7")" = "52675|true" ] || esec "C7b snapshot/continut incoerente"
[ "$(q "SELECT nr_contract FROM executie_proiecte WHERE id = 32")" = 88888 ] || esec "C7b UPDATE-ul nu a trecut după emitere"
q "UPDATE executie_proiecte SET nr_contract = '52675' WHERE id = 32" >/dev/null
ok "C7 contract schimbat în timpul emiterii: schimbarea întâi → „draftul s-a schimbat”; emiterea întâi → valori vechi coerente, apoi UPDATE-ul"

# C8 (64-bis): numire Y vs golire X confirmate simultan, ambele ordini
pregateste_c8() {
  q "UPDATE executie_proiecte SET rte_employee_id = NULL WHERE id = 41" >/dev/null
  local tx ty rv; tx="$(import_semnat $1 200 41 RTE RTE)"
  "${PSQL[@]}" -d "$BAZA" -At -c "SELECT teste.ca('$RAZ')" -c "SELECT public.fn_completare_aplica((SELECT id FROM executie_completari_propuse WHERE hr_decizie_id = $tx), true)" >/dev/null
  rv="$(revocare_semnata $tx)"
  "${PSQL[@]}" -d "$BAZA" -At -c "SELECT teste.ca('$NAT')" -c "SELECT public.fn_hr_decizie_ataseaza_scan($rv, 'HR/$AN/$rv/semnat_2.pdf', repeat('c',64), '$VERIF_GEN')" >/dev/null
  ty="$(import_semnat $2 201 41 RTE RTE)"
  echo "$(q "SELECT id FROM executie_completari_propuse WHERE hr_decizie_id = $ty AND status = 'propus'") $(q "SELECT id FROM executie_completari_propuse WHERE hr_decizie_id = $rv AND status = 'propus'")"; }
read PN PG <<<"$(pregateste_c8 8000 8050)"
[ -n "$PN" ] && [ -n "$PG" ] || esec "C8 pregătire: PN=$PN PG=$PG"
pereche C8a $RAZ "SELECT public.fn_completare_aplica($PN, true)" $RAZ "SELECT public.fn_completare_aplica($PG, true)"
grep -qi deadlock /tmp/hr_pa.out /tmp/hr_pb.out && esec "C8a deadlock"
[ "$(q "SELECT rte_employee_id || '|' || (SELECT status FROM executie_completari_propuse WHERE id = $PN) || '|' || (SELECT status FROM executie_completari_propuse WHERE id = $PG) FROM executie_proiecte WHERE id = 41")" = "201|confirmat|expirat" ] || esec "C8a stare"
grep -q 'deja decis' /tmp/hr_pb.out || esec "C8a golirea nu a fost refuzată ca „deja decisă”: $(cat /tmp/hr_pb.out)"
read PN PG <<<"$(pregateste_c8 9000 9050)"
pereche C8b $RAZ "SELECT public.fn_completare_aplica($PG, true)" $RAZ "SELECT public.fn_completare_aplica($PN, true)"
grep -qi deadlock /tmp/hr_pa.out /tmp/hr_pb.out && esec "C8b deadlock"
grep -q ERROR /tmp/hr_pa.out /tmp/hr_pb.out && esec "C8b eroare: $(cat /tmp/hr_pa.out /tmp/hr_pb.out)"
[ "$(q "SELECT rte_employee_id || '|' || (SELECT status FROM executie_completari_propuse WHERE id = $PN) || '|' || (SELECT status FROM executie_completari_propuse WHERE id = $PG) FROM executie_proiecte WHERE id = 41")" = "201|confirmat|confirmat" ] || esec "C8b stare"
ok "C8 numire vs golire, ambele ordini: numirea întâi → golirea expirată + refuz „deja decisă”; golirea întâi → NULL, apoi Y; fără deadlock"
gate_0e "dupa teste"

RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261007090000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/dev/null 2>&1 || RC=$?
[ "$RC" = 11 ] || esec "5 reaplicarea a dat cod $RC (aștept 11)"
ok "5 reaplicare → 11 (deja înregistrat)"

# 6. revenirea: pe o bază nouă, curată (fără decizii) — revenirea refuză dacă registrul are date
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >/dev/null 2>&1 && esec "6a revenirea nearmată a trecut"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261018a', 'STERGE_REGISTRU_HR:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null 2>&1 \
  && esec "6b revenirea a trecut peste un registru cu date"
"${PSQL[@]}" -d postgres -c "DROP DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
fn_rev
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null
ARM="SELECT set_config('gazpet.revenire_20261018a', 'STERGE_REGISTRU_HR:' || txid_current(), true);"
revenire_refuza() { local out; if out="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "$ARM" -f "$ROLLBACK" 2>&1)"; then esec "$1 revenirea a trecut"; fi
  grep -q "$2" <<<"$out" || esec "$1 revenirea refuzată din alt motiv: $(grep -m1 ERROR <<<"$out")"; }
FN_R2="$(q "SELECT pg_get_functiondef('public.fn_completare_aplica(bigint,boolean)'::regprocedure)")"
q "CREATE OR REPLACE FUNCTION public.fn_completare_aplica(p_id bigint, p_accepta boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS \$x\$ BEGIN RETURN jsonb_build_object('revizie_ulterioara', true); END \$x\$" >/dev/null
revenire_refuza "6b3 fn_completare_aplica schimbată ulterior" "fn_completare_aplica nu e exact"
[ "$(q "SELECT prosrc ~ 'revizie_ulterioara' FROM pg_proc WHERE proname = 'fn_completare_aplica'")" = t ] || esec "6b3 revizia ulterioară s-a pierdut"
"${PSQL[@]}" -d "$BAZA" -c "$FN_R2" >/dev/null
POL_R2="$(q "SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polname = 'completari_ins'")"
q "ALTER POLICY completari_ins ON public.executie_completari_propuse WITH CHECK (auth.uid() IS NOT NULL AND hr_decizie_id IS NULL)" >/dev/null
revenire_refuza "6b4 completari_ins schimbată ulterior" "completari_ins nu e exact"
q "ALTER POLICY completari_ins ON public.executie_completari_propuse WITH CHECK ($POL_R2)" >/dev/null
FN_X="$(q "SELECT pg_get_functiondef('public._hr_nume_afis(text)'::regprocedure)")"
q "CREATE OR REPLACE FUNCTION public._hr_nume_afis(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS 'SELECT upper(p)'" >/dev/null
revenire_refuza "6b5 corp schimbat într-o funcție din listă" "nu sunt exact cele ale PR1"
"${PSQL[@]}" -d "$BAZA" -c "$FN_X" -c "REVOKE ALL ON FUNCTION public._hr_nume_afis(text) FROM PUBLIC, anon, authenticated, service_role" >/dev/null
q "CREATE FUNCTION public._hr_ulterior() RETURNS int LANGUAGE sql AS 'SELECT 1'" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261018a', 'STERGE_REGISTRU_HR:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null 2>&1 \
  && esec "6b2 revenirea a trecut cu o funcție _hr_* în plus (P5-2)"
q "DROP FUNCTION public._hr_ulterior()" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261018a', 'STERGE_REGISTRU_HR:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null \
  || esec "6c revenirea armată a eșuat"
[ "$(q "SELECT count(*) FROM pg_class WHERE relname LIKE 'hr_decizii%' OR relname = 'v_hr_decizii_curente'")" = 0 ] || esec "6c au rămas obiecte"
[ "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE '\_hr\_%' OR proname LIKE 'fn\_hr\_decizi%' OR proname LIKE '\_completare\_%'")" = 0 ] || esec "6c au rămas funcții"
[ "$(q "$STARE")" = "$STARE0" ] || esec "6c fn_completare_aplica / completari_ins nu au revenit: $(q "$STARE")"
[ "$(q "SELECT count(*) FROM storage.buckets WHERE id = 'hr-decizii'")" = 0 ] || esec "6c bucket-ul a rămas"
gate_0e "dupa revenire"
ok "6 revenire: nearmată → refuz; cu date → refuz; fn_completare_aplica / completari_ins / corp din listă schimbate ulterior → refuz, starea păstrată; funcție în plus → refuz; curată → totul retras, fn_completare_aplica și completari_ins = forma revizuită"
echo "PASS"
