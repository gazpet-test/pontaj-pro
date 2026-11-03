#!/usr/bin/env bash
# Harness local 20261130d_sms_sold — EXCLUSIV pe un PostgreSQL 17 local de unica folosinta (port 5983, data dir temporar). Nu atinge productia.
# Pasi: scheletele 30a / 30b / 30d + migrarile 30a, 30b (copii LF: md5-urile din 30b sunt pe LF) -> DRY-ul 30d (tranzactie anulata, cu
# revenire + re-aplicare) -> aplicare reala + poarta 0e (scripts/control_0e.sql) + md5-uri -> a doua aplicare refuzata -> revenirea pe
# 3 mutanti (trebuie sa refuze) -> revenire reala -> re-aplicare -> garda fara GUC.
# Utilizare (Git Bash pe Windows): PG_BIN=/c/Users/Public/pgsql/bin bash scripts/test_sms_sold.sh "$(pwd)"
set -uo pipefail
R0="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"   # radacina repo
B="${PG_BIN:-/c/Users/Public/pgsql/bin}"
L=$(mktemp -d)
D="$L/pg"; P=5983
export PGCLIENTENCODING=UTF8
# copie LF (continutul canonic din git; checkout-ul Windows are CRLF, iar md5-urile 30b sunt pe LF)
R="$L/repo"
for f in supabase/migrations/20261130a_sms_mvp.sql supabase/migrations/20261130b_sms_acces_modul.sql supabase/migrations/20261130d_sms_sold.sql          supabase/tests/20261130a_sms_mvp_schelet.sql supabase/tests/20261130b_sms_acces_modul_schelet.sql supabase/tests/20261130d_sms_sold_schelet.sql          supabase/tests/20261130d_sms_sold_dryrun.sql supabase/revenire/20261130d_sms_sold_ROLLBACK.sql scripts/control_0e.sql; do
  mkdir -p "$R/$(dirname $f)"; sed 's/\x0d$//' "$R0/$f" > "$R/$f"
done
sha256sum "$R/supabase/migrations/20261130d_sms_sold.sql" "$R/supabase/revenire/20261130d_sms_sold_ROLLBACK.sql" "$R/supabase/tests/20261130d_sms_sold_dryrun.sql" | sed "s#$R/##"
PS=("$B/psql.exe" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $P -U postgres)
m() { cygpath -m "$1"; }
stop() { "$B/pg_ctl.exe" -D "$D" -m fast -w stop >/dev/null 2>&1; rm -rf "$L"; }
trap stop EXIT
"$B/initdb.exe" -D "$D" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null 2>&1 || { echo MEDIU initdb; exit 2; }
"$B/pg_ctl.exe" -D "$D" -l "$L/pg.log" -w -t 30 start -o "-p $P -c listen_addresses=127.0.0.1" >/dev/null || { echo MEDIU start; exit 2; }
"${PS[@]}" -d postgres -Atc "SELECT version()" | cut -d, -f1
"${PS[@]}" -d postgres -c "CREATE DATABASE baza" >/dev/null
aplica() { # db fisier nume
  printf "BEGIN;\nSET TRANSACTION ISOLATION LEVEL READ COMMITTED;\nSELECT set_config('gazpet.livrare_migrare', '%s:' || txid_current(), true) IS NOT NULL;\n\\\\i %s\nCOMMIT;\n" "$3" "$(m "$2")" > "$L/a.sql"
  "${PS[@]}" -d "$1" -f "$L/a.sql" > "$L/a.log" 2>&1 || { tail -5 "$L/a.log"; return 1; }
}
"${PS[@]}" -d baza -f "$(m "$R/supabase/tests/20261130a_sms_mvp_schelet.sql")" >/dev/null || { echo MEDIU schelet a; exit 2; }
aplica baza "$R/supabase/migrations/20261130a_sms_mvp.sql" 20261130a_sms_mvp || { echo "MEDIU 30a"; exit 2; }
"${PS[@]}" -d baza -f "$(m "$R/supabase/tests/20261130b_sms_acces_modul_schelet.sql")" >/dev/null || { echo MEDIU schelet b; exit 2; }
aplica baza "$R/supabase/migrations/20261130b_sms_acces_modul.sql" 20261130b_sms_acces_modul || { echo "MEDIU 30b"; exit 2; }
"${PS[@]}" -d baza -f "$(m "$R/supabase/tests/20261130d_sms_sold_schelet.sql")" >/dev/null || { echo MEDIU schelet d; exit 2; }
"${PS[@]}" -d postgres -c "CREATE DATABASE dry TEMPLATE baza" -c "CREATE DATABASE app TEMPLATE baza" -c "ALTER DATABASE dry SET cron.timezone = 'GMT'" -c "ALTER DATABASE app SET cron.timezone = 'GMT'" >/dev/null
echo "== 30a + 30b aplicate local, schelet 30d"

echo "== DRY (tranzactie anulata, cu revenire + re-aplicare)"
printf "BEGIN;\nSET TRANSACTION ISOLATION LEVEL READ COMMITTED;\nSELECT set_config('gazpet.livrare_migrare', '20261130d_sms_sold:' || txid_current(), true) IS NOT NULL;\n\\\\i %s\n\\\\i %s\nSELECT 'DRY_COMPLET';\nROLLBACK;\n" \
  "$(m "$R/supabase/migrations/20261130d_sms_sold.sql")" "$(m "$R/supabase/tests/20261130d_sms_sold_dryrun.sql")" > "$L/d.sql"
"${PS[@]}" -d dry -f "$L/d.sql" > "$L/d.log" 2>&1; echo "exit=$?"
grep -E "NOTICE:  (TEST[0-9]+ OK|20261130d revenire)|ERROR|DRY_COMPLET" "$L/d.log"
"${PS[@]}" -d dry -Atc "SELECT count(*) FROM pg_proc WHERE proname LIKE 'fn_sold_sms%'" | sed 's/^/dupa ROLLBACK, functii fn_sold_sms: /'

echo "== aplicare reala (COMMIT) + poarta 0e + md5"
aplica app "$R/supabase/migrations/20261130d_sms_sold.sql" 20261130d_sms_sold && echo "MIGRARE_OK"
"${PS[@]}" -d app -At -f "$(m "$R/scripts/control_0e.sql")" > "$L/0e.log" 2>&1; echo "0e randuri: $(grep -c . "$L/0e.log")"; grep -i "sold" "$L/0e.log"
"${PS[@]}" -d app -Atc "SELECT p.proname || '=' || md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.proname LIKE 'fn_sold_sms%' ORDER BY 1"
"${PS[@]}" -d app -Atc "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_sms_e_owner()'::regprocedure" | sed 's/^/fn_sms_e_owner md5 local: /'
"${PS[@]}" -d app -Atc "SELECT md5(command) FROM cron.job WHERE jobname='sms_sold_zilnic'" | sed 's/^/md5 comanda job: /'
"${PS[@]}" -d app -At -c "SET search_path = public, pg_temp" -c "SELECT md5(replace(pg_get_viewdef('public.v_sms_sold'::regclass), chr(13), ''))" | sed 's/^/md5 vedere: /'

echo "== a doua aplicare refuzata"
aplica app "$R/supabase/migrations/20261130d_sms_sold.sql" 20261130d_sms_sold && echo "FAIL: a doua aplicare a trecut" || echo "OK refuzata"

rev() { printf "BEGIN;\nSELECT set_config('gazpet.revenire_20261130d', 'SMS_SOLD_SCOS:' || txid_current(), true) IS NOT NULL;\n%s\n\\\\i %s\n%s;\n" "${2:-}" "$(m "$R/supabase/revenire/20261130d_sms_sold_ROLLBACK.sql")" "$3" > "$L/r.sql"
  "${PS[@]}" -d "$1" -f "$L/r.sql" > "$L/r.log" 2>&1; }
echo "== revenire fail-closed (mutanti: functie schimbata / job schimbat / politica adaugata)"
rev app "CREATE OR REPLACE FUNCTION public.fn_sold_sms_prag() RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS \$x\$ SELECT 151 \$x\$;" ROLLBACK && echo "FAIL mutant 1" || grep -o "ERROR:.*" "$L/r.log" | head -1
rev app "UPDATE cron.job SET schedule = '0 * * * *' WHERE jobname = 'sms_sold_zilnic';" ROLLBACK && echo "FAIL mutant 2" || grep -o "ERROR:.*" "$L/r.log" | head -1
rev app "CREATE POLICY p ON public.sms_sold FOR SELECT TO authenticated USING (true);" ROLLBACK && echo "FAIL mutant 3" || grep -o "ERROR:.*" "$L/r.log" | head -1
echo "== revenire reala (COMMIT) + re-aplicare"
rev app "" COMMIT && echo "REVENIRE_OK" || { tail -3 "$L/r.log"; }
grep -o "NOTICE:.*" "$L/r.log"
"${PS[@]}" -d app -Atc "SELECT (to_regclass('public.sms_sold') IS NULL) AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='sms_sold_zilnic') AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'fn_sold_sms%')" | sed 's/^/curat dupa revenire: /'
aplica app "$R/supabase/migrations/20261130d_sms_sold.sql" 20261130d_sms_sold && echo "RE-APLICARE_OK"
echo "== garda: fara GUC de livrare migrarea e refuzata"
"${PS[@]}" -d dry -c "BEGIN" -f "$(m "$R/supabase/migrations/20261130d_sms_sold.sql")" 2>&1 | grep -o "ERROR:.*" | head -1
