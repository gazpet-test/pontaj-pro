#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261022a_sec_f4_advisors_revoke (advisors 08.10.2026, varianta A). EXCLUSIV pe un PostgreSQL 17 local
# dedicat (/tmp/pg_secf4, 127.0.0.1:5982). Nu atinge producția. PG17: amprenta conține MAINTAIN, ca pe live (PG 17.6).
#   0. schelet (supabase/tests/sec_f4_schelet.sql) — amprenta = EXACT cea de pe producție (c_live:15); corpurile celor 3
#      funcții = verbatim live (md5 = c_corpuri din revenire)
#   0b. expresia de amprentă e identică textual în cele 4 locuri (migrare 0c/3e, revenire 2/4)
#   1. fișierul fără runner → refuz, nimic schimbat (și cu psql -f simplu, autocommit)
#   2. precondiții negative: alt GRANT / politică / drept pe coloană (0c) · funcție, view, politică ce apelează funcțiile
#      vizate, inclusiv SQL standard (BEGIN ATOMIC), majuscule, default de coloană (0d) · cron ≠ postgres, și cu majuscule (0e) ·
#      view / funcție necunoscută / funcție BEGIN ATOMIC / politică pe alt tabel / default cu nextval peste tabele (0f) ·
#      funcție lipsă (0b) · alt utilizator decât postgres (0a) · anon/authenticated membri în roluri cu drepturi (3a/3c)
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + validator + gate 0e) → cod 0; amprenta = c_tinta:15
#   4. teste SQL (supabase/tests/sec_f4.test.sql): anon/authenticated refuzați, service_role/cron merg, RLS oprit ⇒ tot refuz;
#      numărul de verificări = numărul de apeluri teste.e/teste.eroare din fișier
#   5. reaplicare → refuz (deja aplicată)
#   6. revenire: nearmată → refuz · stare modificată → refuz · corp/setări de funcție schimbate → refuz · psql -f simplu →
#      nimic schimbat · armată → EXACT c_live:15;
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
[ "$(amprenta)" = "$C_LIVE:15" ] || esec "0 amprenta scheletului $(amprenta) ≠ producția $C_LIVE:15 (scheletul nu reproduce live-ul)"
# semnăturile fixate (migrarea: consumatorii cunoscuți, 0g; revenirea: cele 3 funcții vizate) = scheletul (verbatim de pe live)
semnatura() { q "SELECT md5(format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s', md5(p.prosrc), coalesce(p.proconfig::text, ''), p.prosecdef,
  pg_get_userbyid(p.proowner), p.provolatile, p.proisstrict, l.lanname, p.proparallel, pg_get_function_arguments(p.oid),
  pg_get_function_result(p.oid))) FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('$1')"; }
N_SEMN=0
while IFS='|' read -r f m; do
  [ "$(semnatura "$f")" = "$m" ] || esec "0 semnătura lui $f din schelet ($(semnatura "$f")) ≠ fixată ($m)"
  N_SEMN=$((N_SEMN + 1))
done < <(grep -ho "'public\.[a-z_]*([a-z,]*)|[0-9a-f]\{32\}'" "$MIGRARE" "$ROLLBACK" | tr -d "'")
[ "$N_SEMN" = 6 ] || esec "0 se așteptau 6 semnături fixate (3 în migrare, 3 în revenire), găsite $N_SEMN"
gate_0e inainte
ok "0 schelet = producția 08.10 (amprenta $C_LIVE:15; cele 6 funcții cu semnătura fixată = verbatim)"
[ "$(wc -l <<<"$AMPR_SQL")" -gt 20 ] || esec "0b blocul de amprentă nu a fost găsit"
[ "$(bloc "$MIGRARE" 2)" = "$AMPR_SQL" ] && [ "$(bloc "$ROLLBACK" 1)" = "$AMPR_SQL" ] && [ "$(bloc "$ROLLBACK" 2)" = "$AMPR_SQL" ] \
  || esec "0b cele 4 copii ale expresiei de amprentă nu sunt identice"
[ -z "$(bloc "$MIGRARE" 3)" ] && [ -z "$(bloc "$ROLLBACK" 3)" ] || esec "0b se așteptau exact 2 copii în migrare și 2 în revenire"
SM="$(sed -n '/-- <semnatura>/,/-- <\/semnatura>/p' "$MIGRARE")"; SR="$(sed -n '/-- <semnatura>/,/-- <\/semnatura>/p' "$ROLLBACK")"
[ "$(wc -l <<<"$SM")" -gt 8 ] && [ "$SM" = "$SR" ] || esec "0b expresia <semnatura> diferă între migrare și revenire"
grep -q "pg_get_function_result(p.oid)))" <<<"$SM" || esec "0b expresia <semnatura> nu e cea așteptată"
ok "0b expresia de amprentă e identică textual în cele 4 locuri; expresia de semnătură identică în migrare și revenire"

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
"$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 || true
[ "$(amprenta)" = "$C_LIVE:15" ] || esec "1 ceva s-a schimbat fără runner"
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
refuza_cu "2e view care apelează fn_get_next_nr_aviz" "Precondiție 0d"
q "DROP VIEW public.v_test_aviz" >/dev/null
q "CREATE POLICY p_hb ON public.profiles FOR SELECT USING (EXISTS (SELECT 1 FROM public.heartbeat_muti()))" >/dev/null
refuza_cu "2f politică care apelează heartbeat_muti" "Precondiție 0d"
q "DROP POLICY p_hb ON public.profiles" >/dev/null
q "INSERT INTO cron.job (schedule, command, username, jobname) VALUES ('0 * * * *', 'select heartbeat_alerta()', 'authenticated', 'job_test')" >/dev/null
refuza_cu "2g cron ca authenticated" "Precondiție 0e"
q "DELETE FROM cron.job WHERE jobname = 'job_test'" >/dev/null
q "CREATE VIEW public.v_test_olx AS SELECT id FROM public.olx_tokens" >/dev/null
refuza_cu "2h view peste olx_tokens" "Precondiție 0f: obiecte din afară"
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
# review intern r1: dependențe pe care căutarea în prosrc (case-sensitive) nu le vedea
q "CREATE FUNCTION public.fn_t_atomic_f() RETURNS bigint LANGUAGE sql BEGIN ATOMIC SELECT count(*) FROM public.heartbeat_muti(); END" >/dev/null
refuza_cu "2l funcție BEGIN ATOMIC care apelează heartbeat_muti" "Precondiție 0d: obiecte care depind"
q "DROP FUNCTION public.fn_t_atomic_f()" >/dev/null
q "CREATE FUNCTION public.fn_t_majuscule() RETURNS bigint LANGUAGE plpgsql AS \$f\$ BEGIN RETURN (SELECT count(*) FROM PUBLIC.HEARTBEAT_MUTI()); END \$f\$" >/dev/null
refuza_cu "2m plpgsql cu PUBLIC.HEARTBEAT_MUTI() (majuscule)" "Precondiție 0d: alte funcții"
q "DROP FUNCTION public.fn_t_majuscule()" >/dev/null
q "ALTER TABLE public.notifications ADD COLUMN nr_t integer DEFAULT public.fn_get_next_nr_aviz('Z')" >/dev/null
refuza_cu "2n default de coloană cu fn_get_next_nr_aviz" "Precondiție 0d: obiecte care depind"
q "ALTER TABLE public.notifications DROP COLUMN nr_t" >/dev/null
q "INSERT INTO cron.job (schedule, command, username, jobname) VALUES ('0 * * * *', 'SELECT PUBLIC.HEARTBEAT_ALERTA()', 'authenticated', 'job_t2')" >/dev/null
refuza_cu "2o cron cu majuscule, ca authenticated" "Precondiție 0e"
q "DELETE FROM cron.job WHERE jobname = 'job_t2'" >/dev/null
q "CREATE FUNCTION public.fn_t_atomic_t() RETURNS bigint LANGUAGE sql BEGIN ATOMIC SELECT count(*) FROM public.rag_qr_log; END" >/dev/null
refuza_cu "2p funcție BEGIN ATOMIC peste rag_qr_log" "Precondiție 0f: obiecte din afară"
q "DROP FUNCTION public.fn_t_atomic_t()" >/dev/null
q "CREATE POLICY p_t ON public.profiles FOR SELECT USING (EXISTS (SELECT 1 FROM public.olx_tokens))" >/dev/null
refuza_cu "2q politică pe alt tabel care citește olx_tokens" "Precondiție 0f: obiecte din afară"
q "DROP POLICY p_t ON public.profiles" >/dev/null
q "ALTER TABLE public.notifications ADD COLUMN nr_t bigint DEFAULT nextval('public.rag_qr_log_id_seq')" >/dev/null
refuza_cu "2r default pe alt tabel cu nextval pe rag_qr_log_id_seq" "Precondiție 0f: obiecte din afară"
q "ALTER TABLE public.notifications DROP COLUMN nr_t" >/dev/null
q "CREATE FUNCTION public.fn_t_maj_tab() RETURNS bigint LANGUAGE plpgsql AS \$f\$ BEGIN RETURN (SELECT count(*) FROM PUBLIC.OLX_TOKENS); END \$f\$" >/dev/null
refuza_cu "2s plpgsql cu PUBLIC.OLX_TOKENS (majuscule)" "Precondiție 0f: funcții necunoscute"
q "DROP FUNCTION public.fn_t_maj_tab()" >/dev/null
q "GRANT service_role TO anon" >/dev/null
refuza_cu "2t anon membru în service_role (moștenește EXECUTE)" "Postcondiție 3a"
q "REVOKE service_role FROM anon" >/dev/null
q "GRANT pg_read_all_data TO authenticated" >/dev/null
refuza_cu "2u authenticated membru în pg_read_all_data (moștenește SELECT)" "Postcondiție 3c"
q "REVOKE pg_read_all_data FROM authenticated" >/dev/null
# Jakarinos r1 J20-1: overload cu același nume / aceeași denumire în altă schemă care apelează funcția vizată
q "CREATE FUNCTION public.fn_get_next_nr_aviz() RETURNS integer LANGUAGE plpgsql AS \$f\$ BEGIN RETURN public.fn_get_next_nr_aviz('X'::text); END \$f\$" >/dev/null
refuza_cu "2v overload fn_get_next_nr_aviz() care apelează varianta (text)" "Precondiție 0d: alte funcții"
q "DROP FUNCTION public.fn_get_next_nr_aviz()" >/dev/null
q "CREATE SCHEMA alt_t; CREATE FUNCTION alt_t.heartbeat_muti() RETURNS bigint LANGUAGE plpgsql AS \$f\$ BEGIN RETURN (SELECT count(*) FROM public.heartbeat_muti()); END \$f\$" >/dev/null
refuza_cu "2w alt_t.heartbeat_muti() care apelează public.heartbeat_muti()" "Precondiție 0d: alte funcții"
q "SET client_min_messages = warning; DROP SCHEMA alt_t CASCADE" >/dev/null
# J20-2: cron care atinge tabelele/secvențele ca alt rol decât postgres
q "INSERT INTO cron.job (schedule, command, username, jobname) VALUES ('0 * * * *', 'SELECT count(*) FROM public.rag_qr_log', 'authenticated', 'job_t3')" >/dev/null
refuza_cu "2x cron ca authenticated peste rag_qr_log" "Precondiție 0e"
q "UPDATE cron.job SET command = 'SELECT nextval(''public.storage_rls_errors_id_seq'')' WHERE jobname = 'job_t3'" >/dev/null
refuza_cu "2y cron ca authenticated cu nextval pe storage_rls_errors_id_seq" "Precondiție 0e"
q "DELETE FROM cron.job WHERE jobname = 'job_t3'" >/dev/null
# Copilot r1 P19-1: consumatorii cunoscuți schimbați între audit și apply
q "ALTER FUNCTION public.log_storage_upload_error(text, text, text) SECURITY INVOKER" >/dev/null
refuza_cu "2z log_storage_upload_error devenită INVOKER" "Precondiție 0g: consumatorii"
q "ALTER FUNCTION public.log_storage_upload_error(text, text, text) SECURITY DEFINER" >/dev/null
q "CREATE ROLE rol_t NOLOGIN; ALTER FUNCTION public.fn_rag_qr_rezerva(integer, text) OWNER TO rol_t" >/dev/null
refuza_cu "2aa fn_rag_qr_rezerva cu alt owner" "Precondiție 0g: consumatorii"
q "ALTER FUNCTION public.fn_rag_qr_rezerva(integer, text) OWNER TO postgres; DROP ROLE rol_t" >/dev/null
q "ALTER FUNCTION public.fn_storage_rls_report(integer) SECURITY DEFINER" >/dev/null
refuza_cu "2ab fn_storage_rls_report devenită DEFINER" "Precondiție 0g: consumatorii"
q "ALTER FUNCTION public.fn_storage_rls_report(integer) SECURITY INVOKER" >/dev/null
q "REVOKE EXECUTE ON FUNCTION public.log_storage_upload_error(text, text, text) FROM authenticated" >/dev/null
refuza_cu "2ac UI-ul (authenticated) fără EXECUTE pe log_storage_upload_error" "Precondiție 0g: apelanții"
q "GRANT EXECUTE ON FUNCTION public.log_storage_upload_error(text, text, text) TO authenticated" >/dev/null
for f in 'public.fn_rag_qr_rezerva(integer,text)' 'public.log_storage_upload_error(text,text,text)' 'public.fn_storage_rls_report(integer)'; do
  [ "$(semnatura "$f")" = "$(grep -o "'$f|[0-9a-f]*'" "$MIGRARE" | tr -d "'" | cut -d'|' -f2)" ] || esec "2 semnătura lui $f nu a revenit"
done
[ "$(amprenta)" = "$C_LIVE:15" ] || esec "2 starea nu mai e cea live după testele negative"
[ "$(q "SELECT count(*) FROM pg_auth_members m WHERE m.member IN ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)")" = 0 ] \
  || esec "2 au rămas apartenențe de rol"
ok "2 refuz la: GRANT/politică/coloană în plus (0c) · funcție/view/politică apelantă, BEGIN ATOMIC, majuscule, default de coloană (0d) · cron ≠ postgres, și cu majuscule (0e) · view/funcție/BEGIN ATOMIC/politică/default nextval peste tabele (0f) · funcție lipsă (0b) · alt utilizator (0a) · moștenire prin roluri (3a/3c) · overload/altă schemă (0d) · cron peste tabele/secvențe (0e) · consumatori cunoscuți schimbați sau fără EXECUTE (0g)"

SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261008180000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/secf4_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/secf4_runner.out >&2; esec "3 runner cod $RC"; }
[ "$(amprenta)" = "$C_TINTA:15" ] || esec "3 amprenta după aplicare $(amprenta) ≠ c_tinta $C_TINTA:15"
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA; amprenta = c_tinta"
gate_0e dupa

OUT="$("${PSQL[@]}" -d "$BAZA" -f "$TESTE" 2>&1)" || { echo "$OUT" | grep -v 'NOTICE:  OK' | grep -E 'ERROR|TEST' >&2; esec "4 teste SQL"; }
N="$(grep -c 'NOTICE:  OK' <<<"$OUT")"
grep -q 'TESTE SQL: TOATE OK' <<<"$OUT" || esec "4 testele nu au ajuns la final"
N_ASTEPTAT="$(grep -c '^SELECT teste\.\(e\|eroare\)(' "$TESTE")"
[ "$N" = "$N_ASTEPTAT" ] || esec "4 au rulat $N verificări, fișierul are $N_ASTEPTAT"
ok "4 teste SQL: $N verificări OK"

refuza_cu "5 reaplicare" "deja cea țintă"
ok "5 reaplicare → refuz"

OUT="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" 2>&1)" && esec "6a revenire nearmată a trecut"
grep -q "nearmată" <<<"$OUT" || esec "6a refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
q "GRANT SELECT ON public.olx_tokens TO service_role WITH GRANT OPTION" >/dev/null
OUT="$(revenire)" && esec "6b revenire pe stare modificată a trecut"
grep -q "nu sunt starea lăsată de 20261022a" <<<"$OUT" || esec "6b refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
q "REVOKE GRANT OPTION FOR SELECT ON public.olx_tokens FROM service_role" >/dev/null
[ "$(amprenta)" = "$C_TINTA:15" ] || esec "6b starea nu a revenit la c_tinta după curățare"
# 6g/6h (review intern r1): corp sau setări de funcție schimbate după F4 → revenirea nu redă EXECUTE public; totul în aceeași
#   tranzacție, deci la refuz CREATE OR REPLACE / RESET se anulează și ele
OUT="$("${PSQL[@]}" -d "$BAZA" --single-transaction \
  -c "CREATE OR REPLACE FUNCTION public.heartbeat_muti() RETURNS TABLE(cheie text, descriere text, gazda text, tacut_de_minute integer, ultim_mesaj text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS \$f\$ SELECT cheie, descriere, gazda, 0, ultim_mesaj FROM public.procese_heartbeat \$f\$" \
  -c "SELECT set_config('gazpet.revenire_20261022a', 'SEC_F4_REDESCHIDE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1)" && esec "6g revenire după corp schimbat a trecut"
grep -q "corpul sau setările funcțiilor" <<<"$OUT" || esec "6g refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
OUT="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "ALTER FUNCTION public.heartbeat_alerta() RESET ALL" \
  -c "SELECT set_config('gazpet.revenire_20261022a', 'SEC_F4_REDESCHIDE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1)" && esec "6h revenire după RESET search_path a trecut"
grep -q "corpul sau setările funcțiilor" <<<"$OUT" || esec "6h refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
OUT="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "ALTER FUNCTION public.heartbeat_muti() VOLATILE" \
  -c "SELECT set_config('gazpet.revenire_20261022a', 'SEC_F4_REDESCHIDE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1)" && esec "6i revenire după VOLATILE a trecut"
grep -q "corpul sau setările funcțiilor" <<<"$OUT" || esec "6i refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
[ "$(amprenta)" = "$C_TINTA:15" ] || esec "6g/6h/6i starea s-a schimbat"
"$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -f "$ROLLBACK" >/dev/null 2>&1 || true
"$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -c "SELECT set_config('gazpet.revenire_20261022a', 'SEC_F4_REDESCHIDE:' || txid_current(), false)" -f "$ROLLBACK" >/dev/null 2>&1 || true
[ "$(amprenta)" = "$C_TINTA:15" ] || esec "6c psql -f simplu a schimbat drepturile"
OUT="$("${PSQL[@]}" -d "$BAZA" -At --single-transaction -c "SELECT set_config('gazpet.revenire_20261022a', 'SEC_F4_REDESCHIDE:' || txid_current(), true);" \
  -f "$ROLLBACK" -c "SELECT 'ARMARE_DUPA=[' || coalesce(current_setting('gazpet.revenire_20261022a', true), '<null>') || ']'" 2>&1)" \
  || { echo "$OUT" >&2; esec "6d revenirea armată a eșuat"; }
grep -q '^ARMARE_DUPA=\[\]$' <<<"$OUT" || esec "6d armarea nu e golită în sesiunea revenirii (J20-3): $(grep ARMARE_DUPA <<<"$OUT")"
[ "$(amprenta)" = "$C_LIVE:15" ] || esec "6d după revenire amprenta $(amprenta) ≠ c_live $C_LIVE:15"
[ "$(q "SELECT has_function_privilege('anon', 'public.heartbeat_muti()', 'EXECUTE')")" = t ] || esec "6d anon fără EXECUTE după revenire"
q "DELETE FROM supabase_migrations.schema_migrations WHERE name = '$NUME'" >/dev/null
OUT="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1)" \
  || { echo "$OUT" >&2; esec "6e reaplicarea după revenire a eșuat"; }
[ "$(amprenta)" = "$C_TINTA:15" ] || esec "6e după reaplicare amprenta ≠ c_tinta"
ok "6 revenire: nearmată → refuz · stare modificată → refuz · corp/setări/atribute de funcție schimbate → refuz · psql -f simplu → nimic schimbat · armată → EXACT starea live, dezarmată în aceeași sesiune; dus-întors OK"
gate_0e final
echo "PASS test_sec_f4_advisors"
