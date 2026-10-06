#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261016a_sec_f3_cron_ingest_vault. EXCLUSIV pe un PostgreSQL local dedicat
# (implicit PG16, /tmp/pg_sec_f3, 127.0.0.1:5978). Nu atinge producția.
#   0. schelet (supabase/tests/sec_f3_cron_schelet.sql) = cele 6 joburi live (comenzi mascate, md5 normalizat egal) + un job străin
#   1. fișierul fără runner → garda refuză, nimic schimbat
#   2. precondiții negative: Vault (intern lipsă / alt format, anon lipsă / prefix) · job lipsă · job cu alt program /
#      altă comandă / inactiv · JWT din job ≠ Vault
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + gate 0e) → cod 0
#   4. joburile: nimic în clar; la rulare x-intern-secret + JWT anon din Vault, aceeași țintă și corp; jobul străin neatins
#   5. reaplicare → refuz
#   6. revenire: nearmată → refuz; armată → cele 6 joburi oprite, jobul străin activ
# Utilizare: bash scripts/test_sec_f3_cron.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_sec_f3}"
PORT="${PGPORT_TEST:-5978}"
BAZA=sec_f3_test
NUME=20261016a_sec_f3_cron_ingest_vault
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/sec_f3_cron_schelet.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_sec_f3.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
gate_0e() { local o; o="$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql")" || esec "gate 0e: psql a eșuat"; [ -z "$o" ] || esec "gate 0e: $(grep -c . <<<"$o") rânduri"; ok "gate 0e = 0 ($1)"; }
JOBURI="SELECT string_agg(jobid || ':' || active || ':' || md5(command), ',' ORDER BY jobid) FROM cron.job"
ANON="eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.test-semnatura"

"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
"${PSQL[@]}" -d "$BAZA" -c "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);" >/dev/null
NORM="SELECT string_agg(md5(regexp_replace(regexp_replace(command, 'eyJ[A-Za-z0-9_.-]+', '<JWT>', 'g'), '(x-internal-secret|x-ingest-secret)''[[:space:]]*,[[:space:]]*''[^'']*''', E'\\\\1'',''<S>''', 'g')), ',' ORDER BY jobid) FROM cron.job WHERE jobid <> 99"
[ "$(q "$NORM")" = "224f93d71c807d03bd2d55f282609810,a0fce748d7e11aad230ed731b0608114,ebb7b6a59132d8b6ef49d3a2963c28f4,2f64e307b15ceceb4f77e1098b72e608,8de2c8b4bf8c1b3b8c7348397cbcd4a4,bb33b0b3ae9cb120d158d28c602bb792" ] \
  || esec "0 joburile din schelet ≠ live: $(q "$NORM")"
JOB0="$(q "$JOBURI")"
ok "0 schelet: 6 joburi cu md5 normalizat = live (06.10.2026) + un job străin"

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
[ "$(q "$JOBURI")" = "$JOB0" ] || esec "1 ceva s-a schimbat"
ok "1 fără runner → refuz, nimic schimbat"

refuza_cu() { local out; if out="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1)"; then esec "$1 a trecut"; fi
  grep -q "$2" <<<"$out" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$out")"; }
q "UPDATE vault.secrets SET name='X' WHERE name='INTERN_EDGE_SECRET'" >/dev/null
refuza_cu "2a secret intern lipsă" "Precondiție 0b"
q "UPDATE vault.secrets SET name='INTERN_EDGE_SECRET', secret='scurt' WHERE name='X'" >/dev/null
refuza_cu "2b secret intern cu alt format" "Precondiție 0b"
q "UPDATE vault.secrets SET secret=repeat('a1', 32) WHERE name='INTERN_EDGE_SECRET'" >/dev/null
q "UPDATE vault.secrets SET name='Y' WHERE name='SUPABASE_ANON_JWT'" >/dev/null
refuza_cu "2c anon JWT lipsă din Vault" "Precondiție 0b"
q "UPDATE vault.secrets SET name='SUPABASE_ANON_JWT', secret='eyJ' WHERE name='Y'" >/dev/null
refuza_cu "2d anon JWT = prefix" "Precondiție 0b"
q "UPDATE vault.secrets SET secret='$ANON' WHERE name='SUPABASE_ANON_JWT'" >/dev/null
q "UPDATE cron.job SET jobname='necesar-reminder-x' WHERE jobid=26" >/dev/null
refuza_cu "2e job lipsă" "Precondiție 0c"
q "UPDATE cron.job SET jobname='necesar-reminder' WHERE jobid=26" >/dev/null
q "UPDATE cron.job SET schedule='0 17 * * 1-6' WHERE jobid=21" >/dev/null
refuza_cu "2f job cu alt program" "Precondiție 0c"
q "UPDATE cron.job SET schedule='0 16 * * 1-6' WHERE jobid=21" >/dev/null
q "UPDATE cron.job SET command=replace(command, 'actiune=inchidere', 'actiune=altceva') WHERE jobid=27" >/dev/null
refuza_cu "2g job cu altă comandă" "Precondiție 0c"
q "UPDATE cron.job SET command=replace(command, 'actiune=altceva', 'actiune=inchidere') WHERE jobid=27" >/dev/null
q "UPDATE cron.job SET active=false WHERE jobid=29" >/dev/null
refuza_cu "2h job inactiv" "Precondiție 0c"
q "UPDATE cron.job SET active=true WHERE jobid=29" >/dev/null
q "UPDATE vault.secrets SET secret='eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.alta' WHERE name='SUPABASE_ANON_JWT'" >/dev/null
refuza_cu "2i JWT din job ≠ Vault" "Precondiție 0c"
q "UPDATE vault.secrets SET secret='$ANON' WHERE name='SUPABASE_ANON_JWT'" >/dev/null
[ "$(q "$JOBURI")" = "$JOB0" ] || esec "2 starea nerefăcută"
ok "2 refuz la: secret intern lipsă / alt format · anon JWT lipsă / prefix · job lipsă / alt program / altă comandă / inactiv · JWT din job ≠ Vault"

SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261006120000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/sec_f3_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/sec_f3_runner.out >&2; esec "3 runner cod $RC"; }
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA"
gate_0e dupa

# 4. joburile
[ "$(q "SELECT count(*) FROM cron.job WHERE command ~ 'eyJ|ingest-vechi|x-internal-secret|x-ingest-secret'")" = 0 ] || esec "4 a rămas ceva în clar"
[ "$(q "SELECT active || ':' || command FROM cron.job WHERE jobid = 99")" = "true:SELECT 1" ] || esec "4 jobul străin a fost atins"
[ "$(q "SELECT string_agg(jobid || ' ' || schedule, ',' ORDER BY jobid) FROM cron.job WHERE active")" = "21 0 16 * * 1-6,25 0 6 * * 1,26 0 3 * * 4,27 0 9 * * 4,28 0 16 * * 1-6,29 0 6 25 * *,99 0 1 * * *" ] || esec "4 programul s-a schimbat"
for j in 21 25 26 27 28 29; do q "DO \$\$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobid = $j); END \$\$" >/dev/null; done
[ "$(q "SELECT count(*) FROM net._apeluri WHERE headers->>'x-intern-secret' = repeat('a1', 32) AND headers->>'apikey' = '$ANON' AND headers->>'Authorization' = 'Bearer $ANON' AND headers->>'Content-Type' = 'application/json' AND NOT headers ? 'x-ingest-secret' AND body = '{}'::jsonb AND timeout_ms = 5000")" = 6 ] || esec "4 antetele / corpul la rulare"
B=https://dxczwkbciseqniprspcu.supabase.co/functions/v1
[ "$(q "SELECT string_agg(url, ' | ' ORDER BY id) FROM net._apeluri")" = \
  "$B/reminder-rapoarte | $B/necesar-notificari?actiune=deschidere | $B/necesar-notificari?actiune=reminder | $B/necesar-notificari?actiune=inchidere | $B/probleme-parc-reminder | $B/upa-plafon-alerta" ] \
  || esec "4 ținte: $(q "SELECT string_agg(url, ' | ' ORDER BY id) FROM net._apeluri")"
ok "4 joburi: nimic în clar; la rulare x-intern-secret + JWT anon din Vault, fără x-ingest-secret, aceeași țintă / corp / program; jobul străin neatins"

# 5. reaplicare
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261006120000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/dev/null 2>&1 || RC=$?
[ "$RC" = 11 ] || esec "5 reaplicarea a dat cod $RC (aștept 11)"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null 2>&1 && esec "5b a doua rulare directă a trecut de precondiții"
ok "5 reaplicare → 11 (deja înregistrat); rularea a doua oară e refuzată și de precondiția 0c"

# 6. revenire
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >/dev/null 2>&1 && esec "6a revenirea nearmată a trecut"
[ "$(q "SELECT count(*) FROM cron.job WHERE active")" = 7 ] || esec "6a nearmată a oprit ceva"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261016a', 'OPRESTE_JOBURI_SEC_F3:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null || esec "6b revenirea armată a eșuat"
[ "$(q "SELECT string_agg(jobid::text, ',' ORDER BY jobid) FROM cron.job WHERE active")" = 99 ] || esec "6b joburile active după revenire: $(q "SELECT string_agg(jobid::text, ',') FROM cron.job WHERE active")"
[ "$(q "SELECT count(*) FROM cron.job WHERE command ~ 'x-ingest-secret|eyJ'")" = 0 ] || esec "6b revenirea a readus ceva în clar"
ok "6 revenire: nearmată → refuz; armată → cele 6 joburi oprite (fără secret în clar), jobul străin activ"
echo "PASS"
