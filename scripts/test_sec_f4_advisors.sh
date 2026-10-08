#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261022a_sec_f4_advisors_revoke (advisors 08.10.2026, varianta A). EXCLUSIV pe un PostgreSQL 17 local
# dedicat (/tmp/pg_secf4, 127.0.0.1:5982). Nu atinge producția. PG17: amprenta conține MAINTAIN, ca pe live (PG 17.6).
#   0. schelet (supabase/tests/sec_f4_schelet.sql) — amprenta = EXACT cea de pe producție (c_live:12)
#   0b. expresia de amprentă e identică textual în cele 4 locuri (migrare 0c/3e, revenire 2/4)
#   1. fișierul fără runner → refuz, nimic schimbat (și cu psql -f simplu, autocommit)
#   2. precondiții negative: alt GRANT / politică / drept pe coloană (0c) · funcție, view, politică ce apelează funcțiile
#      vizate (0d) · cron care nu rulează ca postgres (0e) · view / funcție necunoscută peste tabele (0f) · funcție lipsă (0b)
#      · alt utilizator decât postgres (0a)
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + validator + gate 0e) → cod 0; amprenta = c_tinta:12
#   4. teste SQL (supabase/tests/sec_f4.test.sql): anon/authenticated refuzați, service_role/cron merg, RLS oprit ⇒ tot refuz
#   5. reaplicare → refuz (deja aplicată)
#   6. revenire: nearmată → refuz · stare modificată → refuz · psql -f simplu → nimic schimbat · armată → EXACT c_live:12;
#      apoi migrarea se poate reaplica (dus-întors)
# Utilizare: bash scripts/test_sec_f4_advisors.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_secf4}"
PORT="${PGPORT_TEST:-5982}"
BAZA=secf4_test
NUME=20261022a_sec_f4_advisors_revoke
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/sec_f4_schelet.sql"
TESTE="$RADACINA/supabase/tests/sec_f4.test.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
"$PG_BIN/postgres" --version | grep -q ' 17\.' || mediu "e nevoie de PostgreSQL 17 (MAINTAIN, ca pe live)"
case "$DATE_DIR" in /tmp/pg_secf4*) ;; *) mediu "PGDATA_TEST trebuie să fie sub /tmp/pg_secf4* (primit: $DATE_DIR)";; esac
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_secf4" ] || mediu "$DATE_DIR există și nu e marcat ca fixture (.fixture_secf4) — nu îl șterg"
  if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; fi
  rm -rf "$DATE_DIR"
fi
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_secf4"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_secf4.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
gate_0e() { local o; o="$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql")" || esec "gate 0e: psql a eșuat"; [ -z "$o" ] || esec "gate 0e: $o"; ok "gate 0e = 0 ($1)"; }
refuza_cu() { local out; if out="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1)"; then esec "$1 a trecut"; fi
  grep -q "$2" <<<"$out" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$out")"; }
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261022a', 'SEC_F4_REDESCHIDE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1; }
# blocul de amprentă nr. $2 din fișierul $1: de la „SELECT md5(string_agg(o.k” până la „) o;”, fără linia INTO
bloc() { awk -v vrut="$2" '/SELECT md5\(string_agg\(o\.k/{n++; b=(n==vrut)} b && $0 !~ /^ *INTO v_/{print} b && /^    \) o;$/{b=0}' "$1"; }
C_LIVE="$(sed -n "s/^ *c_live  CONSTANT text := '\([0-9a-f]\{32\}\)'.*/\1/p" "$MIGRARE")"
C_TINTA="$(sed -n "s/^ *c_tinta CONSTANT text := '\([0-9a-f]\{32\}\)'.*/\1/p" "$MIGRARE")"
[ -n "$C_LIVE" ] && [ -n "$C_TINTA" ] || esec "c_live/c_tinta lipsesc din migrare"
grep -q "c_live  CONSTANT text := '$C_LIVE'" "$ROLLBACK" && grep -q "c_tinta CONSTANT text := '$C_TINTA'" "$ROLLBACK" \
  || esec "c_live/c_tinta diferă între migrare și revenire"
AMPR_SQL="$(bloc "$MIGRARE" 1)"
amprenta() { q "$AMPR_SQL"; }

"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
[ "$(amprenta)" = "$C_LIVE:12" ] || esec "0 amprenta scheletului $(amprenta) ≠ producția $C_LIVE:12 (scheletul nu reproduce live-ul)"
gate_0e inainte
ok "0 schelet = producția 08.10 (amprenta $C_LIVE:12)"
[ "$(wc -l <<<"$AMPR_SQL")" -gt 20 ] || esec "0b blocul de amprentă nu a fost găsit"
[ "$(bloc "$MIGRARE" 2)" = "$AMPR_SQL" ] && [ "$(bloc "$ROLLBACK" 1)" = "$AMPR_SQL" ] && [ "$(bloc "$ROLLBACK" 2)" = "$AMPR_SQL" ] \
  || esec "0b cele 4 copii ale expresiei de amprentă nu sunt identice"
[ -z "$(bloc "$MIGRARE" 3)" ] && [ -z "$(bloc "$ROLLBACK" 3)" ] || esec "0b se așteptau exact 2 copii în migrare și 2 în revenire"
ok "0b expresia de amprentă e identică textual în cele 4 locuri"

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
"$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 || true
[ "$(amprenta)" = "$C_LIVE:12" ] || esec "1 ceva s-a schimbat fără runner"
ok "1 fără runner → refuz, nimic schimbat (și cu psql -f simplu, autocommit)"

q "GRANT EXECUTE ON FUNCTION public.heartbeat_muti() TO anon" >/dev/null
refuza_cu "2a GRANT în plus" "Precondiție 0c"
q "REVOKE EXECUTE ON FUNCTION public.heartbeat_muti() FROM anon" >/dev/null
q "CREATE POLICY p_test ON public.olx_tokens FOR SELECT TO service_role USING (true)" >/dev/null
refuza_cu "2b politică nouă" "Precondiție 0c"
q "DROP POLICY p_test ON public.olx_tokens" >/dev/null
q "GRANT SELECT (scope) ON public.olx_tokens TO authenticated" >/dev/null
refuza_cu "2c drept pe coloană" "Precondiție 0c"
q "REVOKE SELECT (scope) ON public.olx_tokens FROM authenticated" >/dev/null
q "CREATE FUNCTION public.fn_test_apel() RETURNS bigint LANGUAGE sql AS \$f\$ SELECT count(*) FROM public.heartbeat_muti() \$f\$" >/dev/null
refuza_cu "2d funcție care apelează heartbeat_muti" "Precondiție 0d: alte funcții"
q "DROP FUNCTION public.fn_test_apel()" >/dev/null
q "CREATE VIEW public.v_test_aviz AS SELECT public.fn_get_next_nr_aviz('V') AS nr" >/dev/null
refuza_cu "2e view care apelează fn_get_next_nr_aviz" "Precondiție 0d: view-uri"
q "DROP VIEW public.v_test_aviz" >/dev/null
q "CREATE POLICY p_hb ON public.profiles FOR SELECT USING (EXISTS (SELECT 1 FROM public.heartbeat_muti()))" >/dev/null
refuza_cu "2f politică care apelează heartbeat_muti" "Precondiție 0d: politici"
q "DROP POLICY p_hb ON public.profiles" >/dev/null
q "INSERT INTO cron.job (schedule, command, username, jobname) VALUES ('0 * * * *', 'select heartbeat_alerta()', 'authenticated', 'job_test')" >/dev/null
refuza_cu "2g cron ca authenticated" "Precondiție 0e"
q "DELETE FROM cron.job WHERE jobname = 'job_test'" >/dev/null
q "CREATE VIEW public.v_test_olx AS SELECT id FROM public.olx_tokens" >/dev/null
refuza_cu "2h view peste olx_tokens" "Precondiție 0f: view-uri"
q "DROP VIEW public.v_test_olx" >/dev/null
q "CREATE FUNCTION public.fn_test_tabel() RETURNS bigint LANGUAGE sql AS \$f\$ SELECT count(*) FROM public.rag_qr_log \$f\$" >/dev/null
refuza_cu "2i funcție necunoscută peste rag_qr_log" "Precondiție 0f: funcții"
q "DROP FUNCTION public.fn_test_tabel()" >/dev/null
q "ALTER FUNCTION public.heartbeat_muti() RENAME TO heartbeat_muti_x" >/dev/null
refuza_cu "2j funcție lipsă" "Precondiție 0b"
q "ALTER FUNCTION public.heartbeat_muti_x() RENAME TO heartbeat_muti" >/dev/null
q "CREATE ROLE altul SUPERUSER LOGIN" >/dev/null
OUT="$("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U altul -d "$BAZA" --single-transaction \
  -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1)" && esec "2k alt utilizator a trecut"
grep -q "Precondiție 0a" <<<"$OUT" || esec "2k refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
q "DROP ROLE altul" >/dev/null
[ "$(amprenta)" = "$C_LIVE:12" ] || esec "2 starea nu mai e cea live după testele negative"
ok "2 refuz la: GRANT/politică/coloană în plus (0c) · funcție/view/politică apelantă (0d) · cron ≠ postgres (0e) · view/funcție peste tabele (0f) · funcție lipsă (0b) · alt utilizator (0a)"

SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261008180000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/secf4_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/secf4_runner.out >&2; esec "3 runner cod $RC"; }
[ "$(amprenta)" = "$C_TINTA:12" ] || esec "3 amprenta după aplicare $(amprenta) ≠ c_tinta $C_TINTA:12"
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA; amprenta = c_tinta"
gate_0e dupa

OUT="$("${PSQL[@]}" -d "$BAZA" -f "$TESTE" 2>&1)" || { echo "$OUT" | grep -v 'NOTICE:  OK' | grep -E 'ERROR|TEST' >&2; esec "4 teste SQL"; }
N="$(grep -c 'NOTICE:  OK' <<<"$OUT")"
grep -q 'TESTE SQL: TOATE OK' <<<"$OUT" || esec "4 testele nu au ajuns la final"
ok "4 teste SQL: $N verificări OK"

refuza_cu "5 reaplicare" "deja cea țintă"
ok "5 reaplicare → refuz"

OUT="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" 2>&1)" && esec "6a revenire nearmată a trecut"
grep -q "nearmată" <<<"$OUT" || esec "6a refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
q "GRANT SELECT ON public.olx_tokens TO service_role WITH GRANT OPTION" >/dev/null
OUT="$(revenire)" && esec "6b revenire pe stare modificată a trecut"
grep -q "nu sunt starea lăsată de 20261022a" <<<"$OUT" || esec "6b refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
q "REVOKE GRANT OPTION FOR SELECT ON public.olx_tokens FROM service_role" >/dev/null
[ "$(amprenta)" = "$C_TINTA:12" ] || esec "6b starea nu a revenit la c_tinta după curățare"
"$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -f "$ROLLBACK" >/dev/null 2>&1 || true
"$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -c "SELECT set_config('gazpet.revenire_20261022a', 'SEC_F4_REDESCHIDE:' || txid_current(), false)" -f "$ROLLBACK" >/dev/null 2>&1 || true
[ "$(amprenta)" = "$C_TINTA:12" ] || esec "6c psql -f simplu a schimbat drepturile"
OUT="$(revenire)" || { echo "$OUT" >&2; esec "6d revenirea armată a eșuat"; }
[ "$(amprenta)" = "$C_LIVE:12" ] || esec "6d după revenire amprenta $(amprenta) ≠ c_live $C_LIVE:12"
[ "$(q "SELECT has_function_privilege('anon', 'public.heartbeat_muti()', 'EXECUTE')")" = t ] || esec "6d anon fără EXECUTE după revenire"
[ -z "$(q "SELECT current_setting('gazpet.revenire_20261022a', true)")" ] || esec "6d armarea a rămas în sesiune"
q "DELETE FROM supabase_migrations.schema_migrations WHERE name = '$NUME'" >/dev/null
OUT="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1)" \
  || { echo "$OUT" >&2; esec "6e reaplicarea după revenire a eșuat"; }
[ "$(amprenta)" = "$C_TINTA:12" ] || esec "6e după reaplicare amprenta ≠ c_tinta"
ok "6 revenire: nearmată → refuz · stare modificată → refuz · psql -f simplu → nimic schimbat · armată → EXACT starea live; dus-întors OK"
gate_0e final
echo "PASS test_sec_f4_advisors"
