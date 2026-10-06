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
"${PSQL[@]}" -d "$BAZA" -f "$FN_REV" >/dev/null
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
"${PSQL[@]}" -d "$BAZA" -f "$FN_REV" >/dev/null
q "ALTER POLICY completari_ins ON public.executie_completari_propuse WITH CHECK (auth.uid() IS NOT NULL)" >/dev/null
refuza_cu "2b completari_ins altă condiție" "Precondiție 0d"
q "ALTER POLICY completari_ins ON public.executie_completari_propuse WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (p.is_owner OR p.can_manage_contracts)))" >/dev/null
q "INSERT INTO app_modules (key, name) VALUES ('hr.decizii', 'x')" >/dev/null
refuza_cu "2c hr.decizii în app_modules" "Precondiție 0f"
q "DELETE FROM app_modules WHERE key = 'hr.decizii'" >/dev/null
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
# 4b. concurență cu două sesiuni (pg_sleep între lock și COMMIT; ambele ordini acolo unde contează)
NAT=00000000-0000-0000-0000-000000000126; RAZ=00000000-0000-0000-0000-000000000121
sesiune() { "${PSQL[@]}" -d "$BAZA" -At -v ON_ERROR_STOP=1 -c "BEGIN" -c "SELECT teste.ca('$1')" -c "$2" -c "SELECT pg_sleep($3)" -c "COMMIT" 2>&1 | grep -v '^$' || true; }
# C1 (Vf9/T49): același cerere_id, simultan → un singur rând, același număr
C="$(q "SELECT gen_random_uuid()")"
P1="SELECT public.fn_hr_decizie_rezerva(jsonb_build_object('cerere_id','$C','tip_cod','ALTA_DECIZIE','descriere','concurent','nivel','firma','data_emitere', public._hr_azi()))->>'numar'"
sesiune $NAT "$P1" 2 >/tmp/hr_c1a.out & PA=$!; sleep 0.5; sesiune $NAT "$P1" 0 >/tmp/hr_c1b.out; wait $PA
A="$(grep -E '^[0-9]+$' /tmp/hr_c1a.out | head -1)"; B="$(grep -E '^[0-9]+$' /tmp/hr_c1b.out | head -1)"
[ -n "$A" ] && [ "$A" = "$B" ] && [ "$(q "SELECT count(*) FROM hr_decizii WHERE cerere_id = '$C'")" = 1 ] || esec "C1 rezervare concurentă: A=$A B=$B ($(cat /tmp/hr_c1b.out))"
ok "C1 rezervare concurentă cu același cerere_id → un rând, numărul $A"
# pregătire C2/C3: o numire RTE semnată (import + scan) pe proiectul 32, cu propunere de efect
IMP="$("${PSQL[@]}" -d "$BAZA" -At -c "SELECT teste.ca('$NAT')" -c "SELECT (public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'an',2026,'numar',960,'tip_cod','RTE','eticheta_functie','RTE','nivel','proiect','proiect_id',32,'employee_id',203,'titlu','D-na','data_emitere', public._hr_azi(),'propune_efect',true)))->>'id'" | tail -1)"
"${PSQL[@]}" -d "$BAZA" -At -c "SELECT teste.ca('$NAT')" -c "SELECT teste.urca('HR/2026/$IMP/semnat_1.pdf')" \
  -c "SELECT public.fn_hr_decizie_ataseaza_scan($IMP, 'HR/2026/$IMP/semnat_1.pdf', repeat('a',64), '{\"nr\":true,\"persoana\":true,\"semnatar\":true,\"semnatura\":true,\"stampila\":true,\"lizibil\":true,\"sursa\":\"pdf\",\"pagini\":1,\"pagini_sursa\":\"detectat\",\"generat\":false}')" >/dev/null
PROP="$(q "SELECT id FROM executie_completari_propuse WHERE hr_decizie_id = $IMP AND status = 'propus'")"
[ -n "$PROP" ] || esec "C pregătire: lipsește propunerea numirii $IMP"
# C2 (T43): înlocuire vs revocare emise simultan pe aceeași țintă → exact una reușește
mk() { "${PSQL[@]}" -d "$BAZA" -At -c "SELECT teste.ca('$NAT')" -c "$1" | tail -1; }
SEMN="(SELECT id FROM hr_decizii_semnatari WHERE employee_id = 121)"
DI="$(mk "INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, employee_id, proiect_id, proiect_denumire, titlu, data_emitere, data_efect, semnatar_id, inlocuieste_id, autorizatie_id, domenii_isc) VALUES ('RTE','RTE','proiect',200,32,'Sonda',  'Dl.', public._hr_azi(), public._hr_azi(), $SEMN, $IMP, 1, ARRAY['1.1']) RETURNING id")"
DR="$(mk "INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, revoca_id, data_emitere, data_efect, semnatar_id) VALUES ('REVOCARE','Revocare','firma',$IMP, public._hr_azi(), public._hr_azi(), $SEMN) RETURNING id")"
HI="$(mk "SELECT public.fn_hr_decizie_previzualizeaza($DI)->>'hash_previzualizare'")"; HR_="$(mk "SELECT public.fn_hr_decizie_previzualizeaza($DR)->>'hash_previzualizare'")"
sesiune $NAT "SELECT public.fn_hr_decizie_emite($DI, '$HI', gen_random_uuid(), 12, NULL, '[\"R5\"]')->>'numar'" 2 >/tmp/hr_c2a.out & PA=$!; sleep 0.5
sesiune $NAT "SELECT public.fn_hr_decizie_emite($DR, '$HR_', gen_random_uuid(), 12, NULL, '[\"R5\"]')->>'numar'" 0 >/tmp/hr_c2b.out; wait $PA
grep -q ERROR /tmp/hr_c2a.out && esec "C2 prima emitere a eșuat: $(cat /tmp/hr_c2a.out)"
grep -Eq 'B9|schimbat' /tmp/hr_c2b.out || esec "C2 a doua emitere nu a fost refuzată: $(cat /tmp/hr_c2b.out)"
[ "$(q "SELECT count(*) FROM hr_decizii WHERE coalesce(inlocuieste_id, revoca_id) = $IMP AND stare = 'emisa'")" = 1 ] || esec "C2 nu e exact o relație vie"
ok "C2 înlocuire vs revocare simultane → exact una emisă, cealaltă refuzată (B9 / draft schimbat)"
# C3 (T64, ordinea A): confirmarea efectului ține lock-ul; scanul înlocuirii așteaptă; fără deadlock
"${PSQL[@]}" -d "$BAZA" -At -c "SELECT teste.ca('$NAT')" -c "SELECT teste.urca('HR/2026/$DI/generat_1.pdf')" -c "SELECT teste.urca('HR/2026/$DI/semnat_2.pdf')" \
  -c "SELECT public.fn_hr_decizie_seteaza_pdf($DI, 'HR/2026/$DI/generat_1.pdf', repeat('b',64))" >/dev/null
sesiune $RAZ "SELECT public.fn_completare_aplica($PROP, true)" 2 >/tmp/hr_c3a.out & PA=$!; sleep 0.5
sesiune $NAT "SELECT public.fn_hr_decizie_ataseaza_scan($DI, 'HR/2026/$DI/semnat_2.pdf', repeat('c',64), '{\"nr\":true,\"persoana\":true,\"semnatura\":true,\"stampila\":true,\"cod\":true,\"lizibil\":true,\"sursa\":\"foto\",\"pagini\":1,\"pagini_sursa\":\"detectat\",\"generat\":true}')" 0 >/tmp/hr_c3b.out; wait $PA
grep -q -i deadlock /tmp/hr_c3a.out /tmp/hr_c3b.out && esec "C3 deadlock"
grep -q ERROR /tmp/hr_c3a.out && esec "C3 confirmarea a eșuat: $(cat /tmp/hr_c3a.out)"
grep -q ERROR /tmp/hr_c3b.out && esec "C3 scanul a eșuat: $(cat /tmp/hr_c3b.out)"
[ "$(q "SELECT (SELECT status FROM executie_completari_propuse WHERE id = $PROP) || '|' || (SELECT stare FROM hr_decizii WHERE id = $IMP) || '|' || (SELECT rte_employee_id FROM executie_proiecte WHERE id = 32)")" = "confirmat|inlocuita|203" ] \
  || esec "C3 stare finală: $(q "SELECT (SELECT status FROM executie_completari_propuse WHERE id = $PROP) || '|' || (SELECT stare FROM hr_decizii WHERE id = $IMP)")"
ok "C3 confirmare vs scan de înlocuire (confirmarea prima): fără deadlock, propunerea confirmată, ținta înlocuită"
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
"${PSQL[@]}" -d "$BAZA" -f "$FN_REV" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261018a', 'STERGE_REGISTRU_HR:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null \
  || esec "6c revenirea armată a eșuat"
[ "$(q "SELECT count(*) FROM pg_class WHERE relname LIKE 'hr_decizii%' OR relname = 'v_hr_decizii_curente'")" = 0 ] || esec "6c au rămas obiecte"
[ "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE '\_hr\_%' OR proname LIKE 'fn\_hr\_decizi%' OR proname LIKE '\_completare\_%'")" = 0 ] || esec "6c au rămas funcții"
[ "$(q "$STARE")" = "$STARE0" ] || esec "6c fn_completare_aplica / completari_ins nu au revenit: $(q "$STARE")"
[ "$(q "SELECT count(*) FROM storage.buckets WHERE id = 'hr-decizii'")" = 0 ] || esec "6c bucket-ul a rămas"
gate_0e "dupa revenire"
ok "6 revenire: nearmată → refuz; cu date → refuz; curată → totul retras, fn_completare_aplica și completari_ins = forma revizuită"
echo "PASS"
