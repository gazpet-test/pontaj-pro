#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261011a_sec_edge_poarta_intern. EXCLUSIV pe un PostgreSQL 17 local dedicat
# (implicit /tmp/pg_sec_edge_poarta, 127.0.0.1:5975). Nu atinge producția.
#   0. schelet (supabase/tests/sec_edge_poarta_schelet.sql) = amprentele live (md5) + machete vault/net/cron
#   1. fișierul fără runner → garda refuză, nimic schimbat
#   2. precondiții negative: secret existent → refuz; cheia anon din funcție ≠ Vault → refuz
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + gate 0e) → cod 0
#   4. comportament: triggerele și cronul trimit x-intern-secret = Vault (64 hex); inbox cheia anon din Vault;
#      fn_verifica_secret acceptă doar valoarea corectă; documentele care nu seamănă a ordin nu pornesc nimic
#   5. reaplicare cu marcaj → refuz
#   6. revenire: nearmată → refuz; armată → fără antet, detect + cron exact ca înainte (md5)
# Utilizare: bash scripts/test_sec_edge_poarta.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_sec_edge_poarta}"
PORT="${PGPORT_TEST:-5975}"
BAZA=sec_edge_poarta_test
NUME=20261011a_sec_edge_poarta_intern
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/sec_edge_poarta_schelet.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG17 lipsă ($PG_BIN)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_sec_edge_poarta.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
gate_0e() { local n; n="$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql" | grep -c . || true)"; [ "$n" = 0 ] || esec "gate 0e: $n rânduri"; ok "gate 0e = 0 ($1)"; }
STARE="SELECT md5(prosrc) FROM pg_proc WHERE proname='fn_detect_ordine_trigger' UNION ALL SELECT md5(regexp_replace(prosrc, 'eyJ[A-Za-z0-9_\\-\\.]+', '<JWT>', 'g')) FROM pg_proc WHERE proname='fn_ai_inbox_trigger_clasificare' UNION ALL SELECT md5(command) FROM cron.job WHERE jobname='recycle_bin_cleanup_zilnic' UNION ALL SELECT count(*)::text FROM vault.secrets WHERE name='INTERN_EDGE_SECRET'"
INITIAL=$'f726b68fc75833429780a546a4d4f654\n4e1dd9f786eafc208bb33e9437a72e2b\n0bd8aadf5dbb6966ec074bfda39a59a7\n0'

"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
"${PSQL[@]}" -d "$BAZA" -c "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);" >/dev/null
[ "$(q "$STARE")" = "$INITIAL" ] || esec "0 scheletul nu reproduce amprentele live: $(q "$STARE" | tr '\n' ' ')"
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE proname='fn_verifica_secret'")" = dbd1439c7c2102841c7c457f4a7e95f9 ] || esec "0 fn_verifica_secret diferă"
ok "0 schelet = amprentele live (detect f726b68f, inbox 4e1dd9f7, cron 0bd8aadf, verificator dbd1439c)"

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
[ "$(q "$STARE")" = "$INITIAL" ] || esec "1 stare schimbată"
ok "1 fără runner → refuz"

aplica_manual() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null 2>&1; }
q "SELECT vault.create_secret('x', 'INTERN_EDGE_SECRET')" >/dev/null
aplica_manual && esec "2a secret existent a trecut"
q "DELETE FROM vault.secrets WHERE name='INTERN_EDGE_SECRET'" >/dev/null
q "UPDATE vault.secrets SET secret='eyJalta.cheie.anon' WHERE name='SUPABASE_ANON_JWT'" >/dev/null
aplica_manual && esec "2b cheie anon diferită a trecut"
q "UPDATE vault.secrets SET secret='eyJfals.cheie.anon' WHERE name='SUPABASE_ANON_JWT'" >/dev/null
[ "$(q "$STARE")" = "$INITIAL" ] || esec "2 stare schimbată"
ok "2 secret existent → refuz · cheie anon ≠ Vault → refuz"

SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261011000001 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/sec_edge_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/sec_edge_runner.out >&2; esec "3 runner cod $RC"; }
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA"
gate_0e dupa

SEC="$(q "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='INTERN_EDGE_SECRET'")"
[[ "$SEC" =~ ^[0-9a-f]{64}$ ]] || esec "4 secretul nu are 64 hex"
q "INSERT INTO public.documente_proiect (nume_fisier, subiect) VALUES ('Ordin de incepere nr 12.pdf', NULL), ('Factura 5.pdf', 'oferta')" >/dev/null
[ "$(q "SELECT count(*) FROM net._apeluri WHERE url LIKE '%detect-ordine'")" = 1 ] || esec "4 detect: număr de apeluri greșit"
[ "$(q "SELECT headers->>'x-intern-secret' = '$SEC' FROM net._apeluri WHERE url LIKE '%detect-ordine'")" = t ] || esec "4 detect: antet lipsă/greșit"
q "INSERT INTO public.ai_documente_inbox (status) VALUES ('in_asteptare'), ('confirmat')" >/dev/null
[ "$(q "SELECT count(*) FROM net._apeluri WHERE url LIKE '%citeste-orice'")" = 1 ] || esec "4 inbox: număr de apeluri greșit"
[ "$(q "SELECT (headers->>'x-intern-secret' = '$SEC') AND headers->>'Authorization' = 'Bearer eyJfals.cheie.anon' AND headers->>'apikey' = 'eyJfals.cheie.anon' FROM net._apeluri WHERE url LIKE '%citeste-orice'")" = t ] || esec "4 inbox: antete greșite"
q "DO \$x\$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname='recycle_bin_cleanup_zilnic'); END \$x\$" >/dev/null
[ "$(q "SELECT headers->>'x-intern-secret' = '$SEC' FROM net._apeluri WHERE url LIKE '%cleanup-recycle-bin'")" = t ] || esec "4 cron: antet lipsă/greșit"
[ "$(q "SELECT schedule||'|'||username||'|'||active FROM cron.job WHERE jobname='recycle_bin_cleanup_zilnic'")" = "0 7 * * *|postgres|true" ] || esec "4 cron: program schimbat"
[ "$(q "SET ROLE service_role; SELECT public.fn_verifica_secret('INTERN_EDGE_SECRET', '$SEC')")" = t ] || esec "4 verificator respinge secretul bun"
[ "$(q "SET ROLE service_role; SELECT public.fn_verifica_secret('INTERN_EDGE_SECRET', 'gresit')")" = f ] || esec "4 verificator acceptă secret greșit"
[ "$(q "SET ROLE service_role; SELECT public.fn_verifica_secret('INTERN_EDGE_SECRET', NULL)")" = f ] || esec "4 verificator acceptă NULL"
[ "$(q "SELECT count(*) FROM pg_proc WHERE proname='fn_ai_inbox_trigger_clasificare' AND prosrc ~ 'eyJ'")" = 0 ] || esec "4 JWT literal rămas în inbox"
ok "4 triggere + cron trimit x-intern-secret = Vault (64 hex) · inbox anon din Vault · verificator ok/greșit/NULL · nepotrivitele nu pornesc nimic"

aplica_manual && esec "5 reaplicare a trecut"
ok "5 reaplicare → refuz"

"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >/dev/null 2>&1 && esec "6 revenire nearmată a trecut"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261011a', 'SCOATE_POARTA_INTERN:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null || esec "6 revenire armată"
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE proname='fn_detect_ordine_trigger'")" = f726b68fc75833429780a546a4d4f654 ] || esec "6 detect nu e exact cel vechi"
[ "$(q "SELECT md5(command) FROM cron.job WHERE jobname='recycle_bin_cleanup_zilnic'")" = 0bd8aadf5dbb6966ec074bfda39a59a7 ] || esec "6 cron nu e exact cel vechi"
q "TRUNCATE net._apeluri; INSERT INTO public.ai_documente_inbox (status) VALUES ('in_asteptare')" >/dev/null
[ "$(q "SELECT (headers ? 'x-intern-secret') FROM net._apeluri WHERE url LIKE '%citeste-orice'")" = f ] || esec "6 inbox încă trimite antetul"
ok "6 revenire: nearmată refuz · armată → detect + cron exact ca înainte (md5), inbox fără antet"
echo "PASS test_sec_edge_poarta (sha256 $SHA)"
