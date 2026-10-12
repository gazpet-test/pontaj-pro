#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261023d_iot_retea_limite_ai (iot_verifica_retea: + alertă ai_gemini_ramas_pct < 15). PostgreSQL 17
# local dedicat (/tmp/pg_iotai, 127.0.0.1:5985). Nu atinge producția. Refuzuri (gardă, utilizator, corp/ACL modificat, reaplicare,
# revenire nearmată/persistentă) · runner · comportament (titluri alerte înainte/după) · revenire = exact inițial · dus-întors.
# Utilizare: bash scripts/test_iot_retea_alerte.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR=/tmp/pg_iotai; PORT=5986; BAZA=iotai_test
NUME=20261023d_iot_retea_limite_ai
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/iot_retea_limite_ai_schelet.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_iotai" ] || mediu "$DATE_DIR există și nu e fixture — nu îl șterg"
  [ -f "$DATE_DIR/postmaster.pid" ] && { ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; }
  rm -rf "$DATE_DIR"
fi
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_iotai"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_iotai.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null || esec "schelet"
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
md5f() { q "SELECT md5(prosrc)||' '||proacl::text FROM pg_proc WHERE oid='public.iot_verifica_retea()'::regprocedure"; }
alerte() { "${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "SELECT public.iot_verifica_retea();" -c "SELECT string_agg(tip||':'||titlu, ' | ' ORDER BY titlu) FROM public.alerte_test;" -c "ROLLBACK;" | tail -1; }
livreaza() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1; }
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261023d', 'IOT_RETEA_AI_REVENIRE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1; }
refuz() { local o; if o="$(eval "$2")"; then esec "$1 a trecut"; fi; grep -q "$3" <<<"$o" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$o")"; [ "$(md5f)" = "$4" ] || esec "$1 a schimbat funcția"; ok "refuz: $1"; }
F0="$(md5f)"; [ "${F0%% *}" = 318f5ec25b0e4a3ffae091b29cf58916 ] || esec "schelet ≠ live: $F0"; ok "schelet: corp = live"
A0="$(alerte)"; echo "  înainte: $A0"
[ "$A0" = "error:QNAP: CPU > 85 °C | warning:QNAP: discuri > 50 °C | warning:Server AI: GPU > 80 °C | warning:Server AI: disc ocupat > 90 %" ] || esec "înainte neașteptat"
refuz "fără gardă" "\"\${PSQL[@]}\" -d $BAZA -f \"$MIGRARE\" 2>&1" "garda start invalida" "$F0"
q "CREATE ROLE altul SUPERUSER LOGIN" >/dev/null
refuz "alt utilizator" "\"$PG_BIN/psql\" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $PORT -U altul -d $BAZA --single-transaction -c \"SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);\" -f \"$MIGRARE\" 2>&1" "necesita postgres" "$F0"
q "GRANT EXECUTE ON FUNCTION public.iot_verifica_retea() TO authenticated" >/dev/null; FX="$(md5f)"
refuz "ACL modificat" livreaza "preconditie iot_verifica_retea" "$FX"
q "REVOKE EXECUTE ON FUNCTION public.iot_verifica_retea() FROM authenticated" >/dev/null; [ "$(md5f)" = "$F0" ] || esec "ACL nerefăcut"
SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"; SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261009230000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/iotai_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/iotai_runner.out >&2; esec "runner cod $RC"; }; ok "runner: cod 0 (sha256 $SHA)"
F1="$(md5f)"; [ "${F1%% *}" = d6e0db3c7c2f6b49497b267e1bf06ac5 ] && [ "${F1#* }" = "${F0#* }" ] || esec "după: $F1"; ok "după: corp nou, ACL neschimbat"
A1="$(alerte)"; echo "  după: $A1"
[ "$A1" = "warning:Limita Gemini (Antigravity) aproape consumată | error:QNAP: CPU > 85 °C | warning:QNAP: discuri > 50 °C | warning:Server AI: GPU > 80 °C | warning:Server AI: disc ocupat > 90 %" ] || esec "după neașteptat"
n="$("${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "SELECT public.iot_verifica_retea();" -c "SELECT count(*)||'|'||string_agg(mesaj, '') FROM public.alerte_test WHERE titlu LIKE 'Limita Gemini%';" -c "ROLLBACK;" | tail -1)"
grep -q '^1|Server AI 2: rămas 12 %. Reset: 2026-10-' <<<"$n" || esec "mesaj limită: $n"
ok "după: Gemini 12 % → 1 warning (cu reset); 15 % la limită / valoare text / Claude 3 % → nimic; restul alertelor identice"
refuz "reaplicare" livreaza "preconditie iot_verifica_retea" "$F1"
refuz "revenire nearmată" "\"\${PSQL[@]}\" -d $BAZA -f \"$ROLLBACK\" 2>&1" "garda start invalida" "$F1"
q "ALTER DATABASE $BAZA SET gazpet.revenire_20261023d = 'x'" >/dev/null
refuz "armare persistentă" revenire "armare persistenta interzisa" "$F1"
q "ALTER DATABASE $BAZA RESET gazpet.revenire_20261023d" >/dev/null
revenire >/dev/null || esec "revenire armată"
[ "$(md5f)" = "$F0" ] && [ "$(alerte)" = "$A0" ] || esec "revenire ≠ inițial"; ok "revenire: corp + ACL + alerte = EXACT inițial"
livreaza >/dev/null || esec "dus-întors"; [ "$(md5f)" = "$F1" ] || esec "dus-întors md5"; ok "dus-întors"
echo PASS
