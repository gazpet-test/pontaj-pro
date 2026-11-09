#!/usr/bin/env bash
# Harness local 20261205a_polite_alerte — EXCLUSIV pe un PostgreSQL 17 local de unica folosinta (port 5984, data dir temporar). Nu atinge productia.
# Il ruleaza chat-ul (redari@ nu are Postgres local). Pasi: scheletul -> DRY (migrare + teste in tranzactie anulata) -> aplicare reala +
# poarta 0e (scripts/control_0e.sql) -> a doua aplicare refuzata -> revenirea pe mutanti (fiecare trebuie refuzat) -> revenirea refuza
# date noi -> revenire reala -> re-aplicare -> garda fara GUC.
# Ultima linie: TEST_POLITE_ALERTE_GATA PASS (exit 0) sau TEST_POLITE_ALERTE_GATA FAIL <motiv> (exit 1). Mediu lipsa = exit 2.
# Utilizare (Git Bash pe Windows): PG_BIN=/c/Users/Public/pgsql/bin bash scripts/test_polite_alerte.sh "$(pwd)"
set -uo pipefail
R0="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
B="${PG_BIN:-/c/Users/Public/pgsql/bin}"
L=$(mktemp -d)
D="$L/pg"; P=5984
export PGCLIENTENCODING=UTF8
TESTE_DRY=14
R="$L/repo"
for f in supabase/migrations/20261205a_polite_alerte.sql supabase/revenire/20261205a_polite_alerte_ROLLBACK.sql \
         supabase/tests/20261205a_polite_alerte_schelet.sql supabase/tests/20261205a_polite_alerte_dryrun.sql scripts/control_0e.sql; do
  mkdir -p "$R/$(dirname $f)"; sed 's/\x0d$//' "$R0/$f" > "$R/$f" || { echo "MEDIU copie $f"; exit 2; }
done
sha256sum "$R/supabase/migrations/20261205a_polite_alerte.sql" "$R/supabase/revenire/20261205a_polite_alerte_ROLLBACK.sql" | sed "s#$R/##"
PS=("$B/psql.exe" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $P -U postgres)
m() { cygpath -m "$1"; }
stop() { "$B/pg_ctl.exe" -D "$D" -m fast -w stop >/dev/null 2>&1; rm -rf "$L"; }
trap stop EXIT
fail() { echo "FAIL: $*"; echo "TEST_POLITE_ALERTE_GATA FAIL $*"; exit 1; }
ok() { echo "OK: $*"; }
MIG="$R/supabase/migrations/20261205a_polite_alerte.sql"
REV="$R/supabase/revenire/20261205a_polite_alerte_ROLLBACK.sql"

"$B/initdb.exe" -D "$D" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null 2>&1 || { echo MEDIU initdb; exit 2; }
"$B/pg_ctl.exe" -D "$D" -l "$L/pg.log" -w -t 30 start -o "-p $P -c listen_addresses=127.0.0.1" >/dev/null || { echo MEDIU start; exit 2; }
"${PS[@]}" -d postgres -Atc "SELECT version()" | cut -d, -f1
"${PS[@]}" -d postgres -c "CREATE DATABASE baza" >/dev/null || { echo MEDIU db; exit 2; }
"${PS[@]}" -d baza -f "$(m "$R/supabase/tests/20261205a_polite_alerte_schelet.sql")" >/dev/null || { echo MEDIU schelet; exit 2; }
"${PS[@]}" -d postgres -c "CREATE DATABASE dry TEMPLATE baza" -c "CREATE DATABASE app TEMPLATE baza" \
  -c "ALTER DATABASE dry SET cron.timezone = 'GMT'" -c "ALTER DATABASE app SET cron.timezone = 'GMT'" >/dev/null || { echo MEDIU db; exit 2; }
aplica() { # db fisier -> 0 = aplicata
  printf "BEGIN;\nSET TRANSACTION ISOLATION LEVEL READ COMMITTED;\nSELECT set_config('gazpet.livrare_migrare', '20261205a_polite_alerte:' || txid_current(), true) IS NOT NULL;\n\\\\i %s\nCOMMIT;\n" "$(m "$2")" > "$L/a.sql"
  "${PS[@]}" -d "$1" -f "$L/a.sql" > "$L/a.log" 2>&1
}
rev() { # db sql_inainte final(COMMIT|ROLLBACK) -> 0 = revenirea a trecut
  printf "BEGIN;\nSELECT set_config('gazpet.revenire_20261205a', 'POLITE_SCOASE:' || txid_current(), true) IS NOT NULL;\n%s\n\\\\i %s\n%s;\n" "$2" "$(m "$REV")" "$3" > "$L/r.sql"
  "${PS[@]}" -d "$1" -f "$L/r.sql" > "$L/r.log" 2>&1; }

echo "== DRY (migrare + teste, tranzactie anulata)"
printf "BEGIN;\nSET TRANSACTION ISOLATION LEVEL READ COMMITTED;\nSELECT set_config('gazpet.livrare_migrare', '20261205a_polite_alerte:' || txid_current(), true) IS NOT NULL;\n\\\\i %s\n\\\\i %s\nROLLBACK;\n" \
  "$(m "$MIG")" "$(m "$R/supabase/tests/20261205a_polite_alerte_dryrun.sql")" > "$L/d.sql"
"${PS[@]}" -d dry -f "$L/d.sql" > "$L/d.log" 2>&1; E=$?
grep -oE "NOTICE:  (TEST[0-9]+ OK.*|20261205a.*)|ERROR:.*|DRY_COMPLET" "$L/d.log"
[ $E -eq 0 ] || fail "DRY exit $E"
grep -q "DRY_COMPLET" "$L/d.log" || fail "DRY incomplet"
N=$(grep -oE "NOTICE:  TEST[0-9]+ OK" "$L/d.log" | sort -u | wc -l); [ "$N" -eq $TESTE_DRY ] || fail "DRY: $N/$TESTE_DRY teste OK"
[ "$("${PS[@]}" -d dry -Atc "SELECT count(*) FROM pg_proc WHERE proname LIKE 'fn_polite%' OR proname LIKE 'fn_polita%'")" = 0 ] || fail "DRY a lasat functii dupa ROLLBACK"
ok "DRY $N/$TESTE_DRY, nimic ramas dupa ROLLBACK"

echo "== aplicare reala (COMMIT) + poarta 0e"
aplica app "$MIG" || { grep -o "ERROR:.*" "$L/a.log"; fail "aplicarea"; }
grep -o "NOTICE:  20261205a.*" "$L/a.log"
ok "MIGRARE aplicata"
"${PS[@]}" -d app -At -f "$(m "$R/scripts/control_0e.sql")" > "$L/0e.log" 2>&1 || fail "0e nu a rulat"
[ "$(grep -c . "$L/0e.log")" -eq 0 ] || { cat "$L/0e.log"; fail "0e are randuri"; }
ok "0e: 0 randuri"
"${PS[@]}" -d app -Atc "SELECT p.proname || '=' || md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.proname LIKE 'fn_polit%' OR p.proname = 'fn_poate_scrie_polite' ORDER BY 1"

echo "== concurenta (r2, Jakarinos r1 P1-3): legarea Registrului vs. modificarea politei / a actului, doua sesiuni reale"
"${PS[@]}" -d postgres -c "CREATE DATABASE conc TEMPLATE baza" -c "ALTER DATABASE conc SET cron.timezone = 'GMT'" >/dev/null || { echo MEDIU db conc; exit 2; }
aplica conc "$MIG" || { grep -o "ERROR:.*" "$L/a.log"; fail "aplicarea pe baza de concurenta"; }
"${PS[@]}" -d conc -c "INSERT INTO public.contracte_polite (id, contract_id, tip, asigurator, nr_polita, valoare_lei, data_expirare) VALUES
  (961, 17, 'GBE', 'VECHI', 'C-961', 100, '2027-01-01'), (962, 17, 'CAR', 'ASIG', 'C-962', 100, '2027-01-01'), (963, 17, 'GBE', 'VECHI', 'C-963', 100, '2027-01-01');
  INSERT INTO public.garantii (id, forma, tip, beneficiar, valoare, moneda, stare) VALUES
  (861, 'polita_asigurare', 'buna_executie', 'B', 1, 'RON', 'activa'), (862, 'polita_asigurare', 'car', 'B', 1, 'RON', 'activa'), (863, 'polita_asigurare', 'buna_executie', 'B', 1, 'RON', 'activa');" >/dev/null || fail "fixture concurenta"
bariera() { # asteapta pana cand sesiunea din fundal e in pg_sleep (tine lock-urile), max 10 s
  for _ in $(seq 1 100); do
    [ "$("${PS[@]}" -d conc -Atc "SELECT count(*) FROM pg_stat_activity WHERE datname = 'conc' AND query LIKE '%pg_sleep(4)%' AND state = 'active' AND pid <> pg_backend_pid()")" = 1 ] && return 0
    "${PS[@]}" -d conc -Atc "SELECT pg_sleep(0.1)" >/dev/null
  done; return 1; }
# 1) A schimba polita (tranzactie deschisa); B leaga in timpul ei => B asteapta, apoi copiaza versiunea NOUA
"${PS[@]}" -d conc -c "BEGIN; UPDATE public.contracte_polite SET asigurator = 'NOU' WHERE id = 961; SELECT pg_sleep(4); COMMIT;" > "$L/c1a.log" 2>&1 & PA=$!
bariera || fail "bariera 1"
"${PS[@]}" -d conc -c "UPDATE public.garantii SET contract_polita_id = 961 WHERE id = 861;" > "$L/c1b.log" 2>&1 || { cat "$L/c1b.log"; fail "concurenta 1: legarea"; }
wait $PA || { cat "$L/c1a.log"; fail "concurenta 1: polita"; }
[ "$("${PS[@]}" -d conc -Atc "SELECT emitent FROM public.garantii WHERE id = 861")" = NOU ] || fail "concurenta 1: legarea a pastrat polita veche"
# 2) A adauga un act (prelungire) deschis; B leaga in timpul lui => expirarea efectiva = cea din act
"${PS[@]}" -d conc -c "BEGIN; INSERT INTO public.contracte_polite_acte (polita_id, nr_act, data_expirare_noua) VALUES (962, 1, '2028-12-31'); SELECT pg_sleep(4); COMMIT;" > "$L/c2a.log" 2>&1 & PA=$!
bariera || fail "bariera 2"
"${PS[@]}" -d conc -c "UPDATE public.garantii SET contract_polita_id = 962 WHERE id = 862;" > "$L/c2b.log" 2>&1 || { cat "$L/c2b.log"; fail "concurenta 2: legarea"; }
wait $PA || { cat "$L/c2a.log"; fail "concurenta 2: actul"; }
[ "$("${PS[@]}" -d conc -Atc "SELECT data_expirare FROM public.garantii WHERE id = 862")" = 2028-12-31 ] || fail "concurenta 2: legarea a pierdut actul aditional"
# 3) ordinea inversa: B leaga (tranzactie deschisa); A schimba polita in timpul ei => A asteapta, apoi reimprospateaza randul legat
"${PS[@]}" -d conc -c "BEGIN; UPDATE public.garantii SET contract_polita_id = 963 WHERE id = 863; SELECT pg_sleep(4); COMMIT;" > "$L/c3b.log" 2>&1 & PB=$!
bariera || fail "bariera 3"
"${PS[@]}" -d conc -c "UPDATE public.contracte_polite SET asigurator = 'NOU3' WHERE id = 963;" > "$L/c3a.log" 2>&1 || { cat "$L/c3a.log"; fail "concurenta 3: polita"; }
wait $PB || { cat "$L/c3b.log"; fail "concurenta 3: legarea"; }
[ "$("${PS[@]}" -d conc -Atc "SELECT emitent FROM public.garantii WHERE id = 863")" = NOU3 ] || fail "concurenta 3: randul legat nu s-a reimprospatat"
grep -l "deadlock" "$L"/c*.log && fail "deadlock in testul de concurenta"
ok "concurenta: 3/3 (polita, act, ordinea inversa), fara deadlock"

echo "== a doua aplicare refuzata"
aplica app "$MIG" && fail "a doua aplicare a trecut"
ok "a doua aplicare refuzata: $(grep -o 'ERROR:.*' "$L/a.log" | head -1)"

echo "== revenire fail-closed pe mutanti (fiecare trebuie REFUZAT)"
MUTANTI=(
  "CREATE OR REPLACE FUNCTION public.fn_polite_e_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS \$x\$ SELECT true \$x\$;"
  "UPDATE cron.job SET schedule = '0 * * * *' WHERE jobname = 'polite_alerte_zilnic';"
  "CREATE POLICY p ON public.polite_alerte_jurnal FOR SELECT TO authenticated USING (true);"
  "ALTER TABLE public.polite_alerte_destinatari DROP CONSTRAINT polite_dest_email_check;"
  "ALTER TABLE public.polite_propuneri DISABLE ROW LEVEL SECURITY;"
  "GRANT EXECUTE ON FUNCTION public.fn_polite_alerte_rezerva(date) TO authenticated;"
  "ALTER TABLE public.contracte_polite DISABLE TRIGGER trg_polite_provenienta;"
  "INSERT INTO public.polite_propuneri (stare, sursa, cititor, pdf_sha256, pdf_cale) VALUES ('propus', 'tura_noapte', 'local_dublu', repeat('ef', 32), 'polite/propuneri/' || repeat('ef', 32) || '.pdf');"
  "UPDATE public.polite_alerte_config SET schimbat_la = now();"
  "UPDATE public.polite_alerte_destinatari SET activ = false WHERE departament = 'ofertare';"
  "INSERT INTO public.contracte_polite (contract_id, tip, nr_polita) VALUES (17, 'avans', 'AVANS-1');"
  "INSERT INTO public.garantii (forma, tip, beneficiar, valoare, moneda, stare) VALUES ('polita_asigurare', 'car', 'B', 1, 'RON', 'activa'); INSERT INTO public.contracte_polite (id, contract_id, tip, nr_polita) VALUES (950, 17, 'CAR', 'L-1'); UPDATE public.garantii SET contract_polita_id = 950 WHERE beneficiar = 'B';"
  "CREATE VIEW public.v_alta AS SELECT * FROM public.v_polite_scadente;"
)
i=0
for mut in "${MUTANTI[@]}"; do
  i=$((i+1))
  rev app "$mut" ROLLBACK && fail "mutantul $i a fost acceptat de revenire: $mut"
  grep -q "20261205a revenire:" "$L/r.log" || { grep -o "ERROR:.*" "$L/r.log" | head -2; fail "mutantul $i a picat din alt motiv decat garda revenirii"; }
  echo "  mutant $i refuzat: $(grep -oE '20261205a revenire: [^(]*' "$L/r.log" | head -1)"
done
ok "${#MUTANTI[@]}/${#MUTANTI[@]} mutanti refuzati"

echo "== revenire reala (COMMIT) + re-aplicare"
rev app "" COMMIT || { grep -o "ERROR:.*" "$L/r.log"; fail "revenirea reala"; }
[ "$("${PS[@]}" -d app -Atc "SELECT to_regclass('public.polite_propuneri') IS NULL AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='polite_alerte_zilnic') AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'fn_polit%') AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.garantii'::regclass AND attname='contract_polita_id' AND NOT attisdropped) AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.contracte_polite'::regclass AND conname='contracte_polite_tip_check') LIKE '%altul%' AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.contracte_polite'::regclass AND conname='contracte_polite_tip_check') NOT LIKE '%avans%'")" = t ] || fail "revenirea a lasat obiecte / CHECK-ul vechi nerefacut"
ok "revenire reala, baza curata, CHECK-ul vechi refacut"
aplica app "$MIG" || { grep -o "ERROR:.*" "$L/a.log"; fail "re-aplicarea"; }
ok "re-aplicare"

echo "== garda: fara GUC de livrare migrarea e refuzata"
"${PS[@]}" -d dry -c "BEGIN" -f "$(m "$MIG")" > "$L/g.log" 2>&1 && fail "migrarea a trecut fara garda"
grep -q "garda start invalida" "$L/g.log" || fail "garda: alt motiv"
ok "garda"
echo "TEST_POLITE_ALERTE_GATA PASS"
