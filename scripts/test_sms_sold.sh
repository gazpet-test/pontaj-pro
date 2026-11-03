#!/usr/bin/env bash
# Harness local 20261130d_sms_sold — EXCLUSIV pe un PostgreSQL 17 local de unica folosinta (port 5983, data dir temporar). Nu atinge productia.
# Pasi: scheletele 30a / 30b / 30d + migrarile 30a, 30b (copii LF: md5-urile din 30b sunt pe LF) -> DRY-ul 30d (tranzactie anulata, cu
# revenire + re-aplicare) -> aplicare reala + poarta 0e (scripts/control_0e.sql) -> a doua aplicare refuzata -> revenirea pe mutanti
# (fiecare trebuie refuzat) -> revenire reala -> re-aplicare -> garda fara GUC.
# r2 (#971, Jakarinos P2 + Copilot P2-06): orice rezultat neasteptat opreste scriptul cu exit 1 (verificari explicite, nu doar afisate);
# ultima linie: TEST_SMS_SOLD_GATA PASS (exit 0) sau TEST_SMS_SOLD_GATA FAIL <motiv> (exit 1). Mediu lipsa = exit 2.
# Utilizare (Git Bash pe Windows): PG_BIN=/c/Users/Public/pgsql/bin bash scripts/test_sms_sold.sh "$(pwd)"
set -uo pipefail
R0="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"   # radacina repo
B="${PG_BIN:-/c/Users/Public/pgsql/bin}"
L=$(mktemp -d)
D="$L/pg"; P=5983
export PGCLIENTENCODING=UTF8
TESTE_DRY=11
# copie LF (continutul canonic din git; checkout-ul Windows are CRLF, iar md5-urile 30b sunt pe LF)
R="$L/repo"
for f in supabase/migrations/20261130a_sms_mvp.sql supabase/migrations/20261130b_sms_acces_modul.sql supabase/migrations/20261130d_sms_sold.sql \
         supabase/tests/20261130a_sms_mvp_schelet.sql supabase/tests/20261130b_sms_acces_modul_schelet.sql supabase/tests/20261130d_sms_sold_schelet.sql \
         supabase/tests/20261130d_sms_sold_dryrun.sql supabase/revenire/20261130d_sms_sold_ROLLBACK.sql scripts/control_0e.sql; do
  mkdir -p "$R/$(dirname $f)"; sed 's/\x0d$//' "$R0/$f" > "$R/$f" || { echo "MEDIU copie $f"; exit 2; }
done
sha256sum "$R/supabase/migrations/20261130d_sms_sold.sql" "$R/supabase/revenire/20261130d_sms_sold_ROLLBACK.sql" "$R/supabase/tests/20261130d_sms_sold_dryrun.sql" | sed "s#$R/##"
PS=("$B/psql.exe" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $P -U postgres)
m() { cygpath -m "$1"; }
stop() { "$B/pg_ctl.exe" -D "$D" -m fast -w stop >/dev/null 2>&1; rm -rf "$L"; }
trap stop EXIT
fail() { echo "FAIL: $*"; echo "TEST_SMS_SOLD_GATA FAIL $*"; exit 1; }
ok() { echo "OK: $*"; }

"$B/initdb.exe" -D "$D" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null 2>&1 || { echo MEDIU initdb; exit 2; }
"$B/pg_ctl.exe" -D "$D" -l "$L/pg.log" -w -t 30 start -o "-p $P -c listen_addresses=127.0.0.1" >/dev/null || { echo MEDIU start; exit 2; }
"${PS[@]}" -d postgres -Atc "SELECT version()" | cut -d, -f1
"${PS[@]}" -d postgres -c "CREATE DATABASE baza" >/dev/null || { echo MEDIU db; exit 2; }
aplica() { # db fisier nume -> 0 = aplicata
  printf "BEGIN;\nSET TRANSACTION ISOLATION LEVEL READ COMMITTED;\nSELECT set_config('gazpet.livrare_migrare', '%s:' || txid_current(), true) IS NOT NULL;\n\\\\i %s\nCOMMIT;\n" "$3" "$(m "$2")" > "$L/a.sql"
  "${PS[@]}" -d "$1" -f "$L/a.sql" > "$L/a.log" 2>&1
}
"${PS[@]}" -d baza -f "$(m "$R/supabase/tests/20261130a_sms_mvp_schelet.sql")" >/dev/null || { echo MEDIU schelet a; exit 2; }
aplica baza "$R/supabase/migrations/20261130a_sms_mvp.sql" 20261130a_sms_mvp || { tail -3 "$L/a.log"; echo "MEDIU 30a"; exit 2; }
"${PS[@]}" -d baza -f "$(m "$R/supabase/tests/20261130b_sms_acces_modul_schelet.sql")" >/dev/null || { echo MEDIU schelet b; exit 2; }
aplica baza "$R/supabase/migrations/20261130b_sms_acces_modul.sql" 20261130b_sms_acces_modul || { tail -3 "$L/a.log"; echo "MEDIU 30b"; exit 2; }
"${PS[@]}" -d baza -f "$(m "$R/supabase/tests/20261130d_sms_sold_schelet.sql")" >/dev/null || { echo MEDIU schelet d; exit 2; }
"${PS[@]}" -d postgres -c "CREATE DATABASE dry TEMPLATE baza" -c "CREATE DATABASE app TEMPLATE baza" \
  -c "ALTER DATABASE dry SET cron.timezone = 'GMT'" -c "ALTER DATABASE app SET cron.timezone = 'GMT'" >/dev/null || { echo MEDIU db; exit 2; }
echo "== 30a + 30b aplicate local, schelet 30d"

echo "== DRY (tranzactie anulata, cu revenire + re-aplicare)"
printf "BEGIN;\nSET TRANSACTION ISOLATION LEVEL READ COMMITTED;\nSELECT set_config('gazpet.livrare_migrare', '20261130d_sms_sold:' || txid_current(), true) IS NOT NULL;\n\\\\i %s\n\\\\i %s\nSELECT 'DRY_COMPLET';\nROLLBACK;\n" \
  "$(m "$R/supabase/migrations/20261130d_sms_sold.sql")" "$(m "$R/supabase/tests/20261130d_sms_sold_dryrun.sql")" > "$L/d.sql"
"${PS[@]}" -d dry -f "$L/d.sql" > "$L/d.log" 2>&1; E=$?
grep -oE "NOTICE:  (TEST[0-9]+ OK.*|20261130d revenire.*)|ERROR:.*|DRY_COMPLET" "$L/d.log"
[ $E -eq 0 ] || fail "DRY exit $E"
grep -q "DRY_COMPLET" "$L/d.log" || fail "DRY incomplet"
N=$(grep -oE "NOTICE:  TEST[0-9]+ OK" "$L/d.log" | sort -u | wc -l); [ "$N" -eq $TESTE_DRY ] || fail "DRY: $N/$TESTE_DRY teste OK"
[ "$("${PS[@]}" -d dry -Atc "SELECT count(*) FROM pg_proc WHERE proname LIKE 'fn_sold_sms%'")" = 0 ] || fail "DRY a lasat functii dupa ROLLBACK"
ok "DRY $N/$TESTE_DRY, nimic ramas dupa ROLLBACK"

echo "== aplicare reala (COMMIT) + poarta 0e"
aplica app "$R/supabase/migrations/20261130d_sms_sold.sql" 20261130d_sms_sold || { grep -o "ERROR:.*" "$L/a.log"; fail "aplicarea"; }
ok "MIGRARE aplicata"
"${PS[@]}" -d app -At -f "$(m "$R/scripts/control_0e.sql")" > "$L/0e.log" 2>&1 || fail "0e nu a rulat"
[ "$(grep -c . "$L/0e.log")" -eq 0 ] || { cat "$L/0e.log"; fail "0e are randuri"; }
ok "0e: 0 randuri"
"${PS[@]}" -d app -Atc "SELECT p.proname || '=' || md5(replace(p.prosrc, chr(13), '')) || ' vol=' || p.provolatile::text FROM pg_proc p WHERE p.proname LIKE 'fn_sold_sms%' ORDER BY 1"

echo "== a doua aplicare refuzata"
aplica app "$R/supabase/migrations/20261130d_sms_sold.sql" 20261130d_sms_sold && fail "a doua aplicare a trecut"
ok "a doua aplicare refuzata: $(grep -o 'ERROR:.*' "$L/a.log" | head -1)"

rev() { # db sql_mutant final(COMMIT|ROLLBACK) -> 0 = revenirea a trecut
  printf "BEGIN;\nSELECT set_config('gazpet.revenire_20261130d', 'SMS_SOLD_SCOS:' || txid_current(), true) IS NOT NULL;\n%s\n\\\\i %s\n%s;\n" "$2" "$(m "$R/supabase/revenire/20261130d_sms_sold_ROLLBACK.sql")" "$3" > "$L/r.sql"
  "${PS[@]}" -d "$1" -f "$L/r.sql" > "$L/r.log" 2>&1; }
echo "== revenire fail-closed pe mutanti (fiecare trebuie REFUZAT)"
MUTANTI=(
  "CREATE OR REPLACE FUNCTION public.fn_sold_sms_prag() RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS \$x\$ SELECT 151 \$x\$;"
  "UPDATE cron.job SET schedule = '0 * * * *' WHERE jobname = 'sms_sold_zilnic';"
  "CREATE POLICY p ON public.sms_sold FOR SELECT TO authenticated USING (true);"
  "ALTER TABLE public.sms_sold DROP CONSTRAINT sms_sold_eroare; ALTER TABLE public.sms_sold ADD CONSTRAINT sms_sold_eroare CHECK (true);"
  "ALTER TABLE public.sms_sold DISABLE ROW LEVEL SECURITY;"
  "GRANT SELECT ON public.sms_sold TO authenticated;"
  "GRANT EXECUTE ON FUNCTION public.fn_sold_sms_stare() TO authenticated;"
  "ALTER FUNCTION public.fn_sold_sms_citeste() STABLE;"
  "ALTER FUNCTION public.fn_sold_sms_inregistreaza(integer, text, timestamptz, text) SECURITY INVOKER;"
  "ALTER FUNCTION public.fn_sold_sms_stare() SET search_path = public;"
  "GRANT SELECT ON public.v_sms_sold TO anon;"
  "CREATE OR REPLACE VIEW public.v_sms_sold WITH (security_invoker = on) AS SELECT true AS id, 1 AS credit, now() AS citit_la, NULL::text AS eroare, now() AS eroare_la, 150 AS prag, false AS sub_prag, false AS citire_veche, false AS eroare_dupa_citire, false AS alerta, 'smslink'::text AS furnizor_ultim, now() AS furnizor_la, false AS simulator, false AS monitorizare_oprita, false AS furnizor_neconfigurat;"
  # r3 (Jakarinos P3): privilegiu pe coloana si STRICT (cu STRICT, orice apel cu un argument NULL nu mai executa corpul)
  "GRANT SELECT (credit) ON public.sms_sold TO authenticated;"
  "ALTER FUNCTION public.fn_sold_sms_inregistreaza(integer, text, timestamptz, text) STRICT;"
)
i=0
for mut in "${MUTANTI[@]}"; do
  i=$((i+1))
  rev app "$mut" ROLLBACK && fail "mutantul $i a fost acceptat de revenire: $mut"
  grep -q "20261130d revenire:" "$L/r.log" || { grep -o "ERROR:.*" "$L/r.log" | head -2; fail "mutantul $i a picat din alt motiv decat garda revenirii"; }
  echo "  mutant $i refuzat: $(grep -oE '20261130d revenire: [^(]*' "$L/r.log" | head -1)"
done
ok "${#MUTANTI[@]}/${#MUTANTI[@]} mutanti refuzati"

echo "== revenire reala (COMMIT) + re-aplicare"
rev app "" COMMIT || { grep -o "ERROR:.*" "$L/r.log"; fail "revenirea reala"; }
[ "$("${PS[@]}" -d app -Atc "SELECT (to_regclass('public.sms_sold') IS NULL) AND (to_regclass('public.v_sms_sold') IS NULL) AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='sms_sold_zilnic') AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'fn_sold_sms%')")" = t ] || fail "au ramas obiecte dupa revenire"
ok "revenire reala, baza curata"
aplica app "$R/supabase/migrations/20261130d_sms_sold.sql" 20261130d_sms_sold || { grep -o "ERROR:.*" "$L/a.log"; fail "re-aplicarea"; }
ok "re-aplicare"

echo "== garda: fara GUC de livrare migrarea e refuzata"
"${PS[@]}" -d dry -c "BEGIN" -f "$(m "$R/supabase/migrations/20261130d_sms_sold.sql")" > "$L/g.log" 2>&1 && fail "migrarea a trecut fara garda"
grep -q "garda start invalida" "$L/g.log" || fail "garda: alt motiv"
ok "garda"
echo "TEST_SMS_SOLD_GATA PASS"
