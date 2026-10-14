#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261030a_egress_contoare_oficiale.sql (contoare oficiale Supabase). DOAR PG17 local dedicat
# (implicit /tmp/pg_egress_oficial, 127.0.0.1:5973). Nu atinge producția.
#   0. schelet + 20260930e + 20261002a (= live, amprentele verificate)
#   1. fișierul fără marcaj de livrare → garda refuză
#  1b. cota_ciclu_bytes ≠ 268435456000 (valoarea live) → precondiția 0g refuză
#   2. aplicare cu marcaj (ca runnerul: --single-transaction) → suita oficial; suita veche monitor_egress_test.sql trece și ea
#  2b. „colector oprit” sub concurență reală (două sesiuni) → o singură alertă
#   3. reaplicare → refuz (precondiții: obiectele există / amprente schimbate)
#   4. rollback tehnic PESTE DATE (citiri + alerte pe toate tipurile noi + o alertă veche): nearmat → refuz; armat →
#      amprentele live, alertele noi și citirile scoase, alerta veche păstrată; reaplicare → suita oficial
#   5. validatorul runnerului acceptă migrarea
# Ieșire: 0 = PASS · 1 = eșec · 2 = mediu
# (Rulat în PR pe PGlite 16.4 cu același traseu — vezi descrierea PR-ului.)
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_egress_oficial}"
PORT="${PGPORT_TEST:-5973}"
BAZA=egress_oficial_test
NUME=20261030a_egress_contoare_oficiale
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
TESTE="$RADACINA/supabase/tests/monitor_egress_oficial.test.sql"
MARCAJ="SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);"
ARMARE="SELECT set_config('gazpet.rollback_tehnic_20261030a', 'SCOATE_CONTOARE_OFICIALE:' || txid_current(), true);"
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG17 lipsă ($PG_BIN)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_egress_oficial.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap 'ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
amprente() { q "SELECT string_agg(proname || '=' || md5(prosrc), ' ' ORDER BY proname) FROM pg_proc WHERE proname LIKE 'egress\_%'"; }
suita() { "${PSQL[@]}" -d "$BAZA" -f "$TESTE" >/tmp/egress_oficial_suita.out 2>&1 && grep -q SUITA_OK /tmp/egress_oficial_suita.out \
  || { cat /tmp/egress_oficial_suita.out; esec "suita oficial ($1)"; }; ok "suita oficial ($1)"; }
LIVE="egress_cheie_obiect=80cb4557c7020f51672f3dc7b62c8a91 egress_ciclu_start=2cc40273fe610ac844c17bb4508d6959 egress_deblocheaza=de5e29c4173761637b85021422fee119 egress_detector=2cc00f0d41b9900c568fc82d9f5aec22 egress_este_owner=25c9b49412f80567bdb0b2baec4cd2f3 egress_log_descarcare=ef4c8c01d648a4c6f029807c97a03a4b egress_notifica_owner=e4165baf10b67bc65ed0865d3f434778 egress_obiect_blocat=73cd68ed6bf1a07759c11ff2f73f9afb egress_statistici=dd67c392797115482c54387408d7bcf6"

# 0. baza = live (20260930e + 20261002a)
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA"
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/monitor_egress_schelet.sql" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '20260930e_monitor_egress:' || txid_current(), true);" \
  -f "$RADACINA/supabase/migrations/20260930e_monitor_egress.sql" >/dev/null 2>&1 || esec "20260930e nu se aplică"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '20261002a_monitor_egress_fix:' || txid_current(), true);" \
  -f "$RADACINA/supabase/migrations/20261002a_monitor_egress_fix.sql" >/dev/null 2>&1 || esec "20261002a nu se aplică"
[ "$(amprente)" = "$LIVE" ] || esec "baza ≠ amprentele live: $(amprente)"
ok "0 baza = 20260930e + 20261002a, amprentele = live"

# 1. fără marcaj
if "${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/tmp/egress_oficial_apl.out 2>&1; then esec "1 psql -f fără marcaj a trecut"; fi
grep -q 'garda de livrare (start)' /tmp/egress_oficial_apl.out || { cat /tmp/egress_oficial_apl.out; esec "1 refuz din alt motiv"; }
[ "$(amprente)" = "$LIVE" ] || esec "1 s-a schimbat ceva"; ok "1 fără marcaj → refuz (garda start), nimic schimbat"

# 1b. cota_ciclu_bytes diferită de valoarea live (268435456000) → precondiția 0g refuză (nu se rescrie tacit o cotă schimbată)
q "UPDATE storage_egress_config SET cota_ciclu_bytes = 300000000000" >/dev/null
if "${PSQL[@]}" -d "$BAZA" --single-transaction -c "$MARCAJ" -f "$MIGRARE" >/tmp/egress_oficial_apl.out 2>&1; then esec "1b cotă schimbată a trecut"; fi
grep -q 'Precondiție 0g' /tmp/egress_oficial_apl.out || { cat /tmp/egress_oficial_apl.out; esec "1b refuz din alt motiv"; }
q "UPDATE storage_egress_config SET cota_ciclu_bytes = 268435456000" >/dev/null
ok "1b cota_ciclu_bytes ≠ 268435456000 → refuz Precondiție 0g"

# 2. aplicare + suite
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "$MARCAJ" -f "$MIGRARE" >/tmp/egress_oficial_apl.out 2>&1 || { cat /tmp/egress_oficial_apl.out; esec "2 aplicare"; }
ok "2 aplicare cu marcaj (pre + post trecute)"
suita "după 20261030a"
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$RADACINA/supabase/tests/monitor_egress_test.sql" >/tmp/egress_oficial_vechi.out 2>&1 \
  || { cat /tmp/egress_oficial_vechi.out; esec "2 suita veche monitor_egress_test.sql pe 20261030a"; }
ok "2 suita veche monitor_egress_test.sql trece pe detectorul nou"
q "TRUNCATE storage_descarcari_jurnal, storage_obiecte_blocate, storage_egress_alerte, notifications; UPDATE storage_egress_config SET prag_zilnic_bytes = DEFAULT, cota_ciclu_bytes = DEFAULT" >/dev/null

# 2b. „colector oprit” atomic între rulări concurente. Sesiunea A simulează o rulare care tocmai a emis alerta (cu altă
#     cheie de zi, ca peste miezul nopții UTC) și ține lock-ul consultativ până la COMMIT; sesiunea B rulează detectorul
#     între timp. Cu lock: B așteaptă, apoi vede alerta lui A ⇒ 1 alertă. Fără lock: B n-ar vedea rândul necomis ⇒ 2.
q "INSERT INTO supabase_usage_oficial (citit_la, ciclu_start, ciclu_sfarsit, egress_bytes, cached_egress_bytes, sursa)
   SELECT now() - interval '30 hours', (d - interval '1 month')::date, d, 1, 1, 'dashboard'
     FROM (SELECT (egress_ciclu_start(now()) AT TIME ZONE 'UTC')::date AS d) x" >/dev/null
"${PSQL[@]}" -d "$BAZA" -c "BEGIN; SELECT pg_advisory_xact_lock(hashtext('egress_colector_oprit'));
  INSERT INTO storage_egress_alerte (tip, cheie, detalii) VALUES ('colector_oprit', '2000-01-01', '{\"sesiune\":\"A\"}');
  SELECT pg_sleep(3); COMMIT;" >/tmp/egress_oficial_a.out 2>&1 &
PID_A=$!
sleep 1
T0=$(date +%s)
q "SELECT egress_detector()" >/dev/null || esec "2b detectorul (sesiunea B)"
T1=$(date +%s)
wait "$PID_A" || { cat /tmp/egress_oficial_a.out; esec "2b sesiunea A"; }
[ "$(q "SELECT count(*) FROM storage_egress_alerte WHERE tip = 'colector_oprit'")" = 1 ] || esec "2b două alerte colector_oprit la rulări concurente"
[ $((T1 - T0)) -ge 1 ] || esec "2b sesiunea B nu a așteptat lock-ul"
ok "2b colector_oprit: rularea concurentă așteaptă lock-ul și nu dublează alerta"
q "TRUNCATE storage_egress_alerte, notifications, supabase_usage_oficial" >/dev/null

# 3. reaplicare
if "${PSQL[@]}" -d "$BAZA" --single-transaction -c "$MARCAJ" -f "$MIGRARE" >/tmp/egress_oficial_apl.out 2>&1; then esec "3 reaplicarea a trecut"; fi
grep -q 'Precondiție 0' /tmp/egress_oficial_apl.out || { cat /tmp/egress_oficial_apl.out; esec "3 refuz din alt motiv"; }
ok "3 reaplicare → refuz (precondiții)"

# 4. rollback — CU DATE: citiri + alerte pe toate cele 3 tipuri noi + o alertă veche care trebuie să rămână
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/monitor_egress_oficial_rollback_date.sql" >/tmp/egress_oficial_date.out 2>&1 \
  && grep -q DATE_ROLLBACK_OK /tmp/egress_oficial_date.out || { cat /tmp/egress_oficial_date.out; esec "4 date pentru rollback"; }
ok "4 date comise: 1 citire, 5 alerte noi (3 tipuri), 1 alertă veche"
if "${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >/tmp/egress_oficial_apl.out 2>&1; then esec "4 rollback nearmat a trecut"; fi
ok "4 rollback nearmat → refuz"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "$ARMARE" -f "$ROLLBACK" >/tmp/egress_oficial_apl.out 2>&1 || { cat /tmp/egress_oficial_apl.out; esec "4 rollback armat"; }
[ "$(amprente)" = "$LIVE" ] || esec "4 rollback ≠ live"; ok "4 rollback armat (peste date) → amprentele live"
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/monitor_egress_oficial_rollback_verif.sql" >/tmp/egress_oficial_verif.out 2>&1 \
  && grep -q VERIF_ROLLBACK_OK /tmp/egress_oficial_verif.out || { cat /tmp/egress_oficial_verif.out; esec "4 verificare după rollback"; }
ok "4 după rollback: citiri + alerte noi scoase, alerta veche păstrată, CHECK vechi repus"
q "TRUNCATE storage_egress_alerte" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "$MARCAJ" -f "$MIGRARE" >/tmp/egress_oficial_apl.out 2>&1 || esec "4 reaplicare după rollback"
suita "reaplicat după rollback"

# 5. validator
python3 "$RADACINA/scripts/livrare_validator.py" "$MIGRARE" >/dev/null || esec "validatorul runnerului refuză migrarea"; ok "5 validator runner: OK"
echo "PASS"
