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
TESTE_DRY=15
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
[ "$("${PS[@]}" -d dry -Atc "SELECT count(*) FROM pg_proc WHERE proname IN ('fn_polite_norm_nr','fn_polite_text','fn_polite_data','fn_polite_suma','fn_polite_e_owner','fn_polite_provenienta','fn_polite_garantii_legat','fn_polite_scadente','fn_polite_dest_normalizeaza','fn_polite_alerte_calculeaza','fn_polite_alerte_proba','fn_polite_alerte_porneste','fn_polite_alerte_rezerva','fn_polite_alerte_marcheaza','fn_polite_alerte_reconciliaza','fn_polite_propunere_rezerva','fn_polite_propunere_completeaza','fn_polite_propunere_esec','fn_polite_propunere_json','fn_polita_salveaza','fn_polita_propunere_respinge','fn_polite_alerte_opreste_vechi','fn_poate_scrie_polite')")" = 0 ] || fail "DRY a lasat functii dupa ROLLBACK"
ok "DRY $N/$TESTE_DRY, nimic ramas dupa ROLLBACK"

echo "== aplicare reala (COMMIT) + poarta 0e"
aplica app "$MIG" || { grep -o "ERROR:.*" "$L/a.log"; fail "aplicarea"; }
grep -o "NOTICE:  20261205a.*" "$L/a.log"
ok "MIGRARE aplicata"
"${PS[@]}" -d app -At -f "$(m "$R/scripts/control_0e.sql")" > "$L/0e.log" 2>&1 || fail "0e nu a rulat"
[ "$(grep -c . "$L/0e.log")" -eq 0 ] || { cat "$L/0e.log"; fail "0e are randuri"; }
ok "0e: 0 randuri"
"${PS[@]}" -d app -Atc "SELECT p.proname || '=' || md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.proname IN ('fn_polite_norm_nr','fn_polite_text','fn_polite_data','fn_polite_suma','fn_polite_e_owner','fn_polite_provenienta','fn_polite_garantii_legat','fn_polite_scadente','fn_polite_dest_normalizeaza','fn_polite_alerte_calculeaza','fn_polite_alerte_proba','fn_polite_alerte_porneste','fn_polite_alerte_rezerva','fn_polite_alerte_marcheaza','fn_polite_alerte_reconciliaza','fn_polite_propunere_rezerva','fn_polite_propunere_completeaza','fn_polite_propunere_esec','fn_polite_propunere_json','fn_polita_salveaza','fn_polita_propunere_respinge','fn_polite_alerte_opreste_vechi','fn_poate_scrie_polite') ORDER BY 1"

echo "== a doua aplicare refuzata"
aplica app "$MIG" && fail "a doua aplicare a trecut"
ok "a doua aplicare refuzata: $(grep -o 'ERROR:.*' "$L/a.log" | head -1)"

echo "== r8b: preluarea alertelor vechi cu jobul blocat de alta sesiune (doua sesiuni reale)"
# A: tine randul jobului vechi cu un UPDATE necomis pana primeste semnalul (rand in zz_semnal, pus DUPA verificarea lui B; plafon 60 s),
# apoi ROLLBACK. B: owner-ul apasa butonul => 55P03 imediat (NOWAIT), nimic scris. Fara ferestre de timp fixe (Jakarinos r8b P3).
"${PS[@]}" -d app -c "CREATE TABLE public.zz_semnal (x integer)" >/dev/null || fail "tabela de semnal"
printf "BEGIN;\nUPDATE cron.job SET command = command WHERE jobname = 'polite_alerte_zilnic';\nDO \$a\$ BEGIN FOR i IN 1..600 LOOP EXIT WHEN EXISTS (SELECT 1 FROM public.zz_semnal); PERFORM pg_sleep(0.1); END LOOP; IF NOT EXISTS (SELECT 1 FROM public.zz_semnal) THEN RAISE EXCEPTION 'A: semnal lipsa'; END IF; END \$a\$;\nROLLBACK;\n" > "$L/ja.sql"
printf "\\\\set VERBOSITY verbose\nBEGIN;\nUPDATE public.polite_alerte_config SET activ = true;\nSELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true), set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-00000000000a\",\"role\":\"authenticated\"}', true);\nSET LOCAL ROLE authenticated;\nSELECT public.fn_polite_alerte_opreste_vechi();\nROLLBACK;\n" > "$L/jb.sql"
"${PS[@]}" -d app -f "$L/ja.sql" > "$L/ja.log" 2>&1 &
PA=$!
for k in $(seq 1 50); do
  [ "$("${PS[@]}" -d app -Atc "SELECT count(*) FROM pg_stat_activity WHERE datname = 'app' AND state = 'active' AND query LIKE 'DO \$a\$%'")" = 1 ] && break
  sleep 0.2
done
[ "$k" -lt 50 ] || fail "sesiunea A nu a pornit"
"${PS[@]}" -d app -f "$L/jb.sql" > "$L/jb.log" 2>&1 && fail "preluarea a trecut cu jobul blocat de alta sesiune"
grep -q "55P03" "$L/jb.log" || { cat "$L/jb.log"; fail "preluarea a picat din alt motiv decat lock-ul pe job"; }
[ "$("${PS[@]}" -d app -Atc "SELECT count(*) FROM pg_stat_activity WHERE datname = 'app' AND state = 'active' AND query LIKE 'DO \$a\$%'")" = 1 ] || fail "B a asteptat lock-ul (trebuia NOWAIT)"
"${PS[@]}" -d app -c "INSERT INTO public.zz_semnal VALUES (1)" >/dev/null || fail "semnalul catre A"
wait $PA; EA=$?
[ $EA -eq 0 ] || { cat "$L/ja.log"; fail "sesiunea A exit $EA"; }
"${PS[@]}" -d app -c "DROP TABLE public.zz_semnal" >/dev/null || fail "stergerea tabelei de semnal"
[ "$("${PS[@]}" -d app -Atc "SELECT (SELECT count(*) FROM cron.job WHERE jobname = 'polite_alerte_zilnic' AND command = 'SELECT fn_polite_send_alerte();') || ':' || (SELECT (vechi_oprit_la IS NULL AND NOT activ)::text FROM public.polite_alerte_config)")" = "1:true" ] || fail "dupa cursa: jobul vechi sau config schimbate"
ok "jobul blocat de alta sesiune: 55P03 imediat, jobul vechi si config neschimbate"

echo "== revenire fail-closed pe mutanti (fiecare trebuie REFUZAT)"
MUTANTI=(
  "CREATE OR REPLACE FUNCTION public.fn_polite_e_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS \$x\$ SELECT true \$x\$;"
  "UPDATE cron.job SET schedule = '0 * * * *' WHERE jobname = 'polite_alerte_departamente';"
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
  # r2 (amprenta extinsa, Jakarinos r1 P2-11): drepturi pe tabele si dependenta fn_poate_scrie_garantii
  "REVOKE SELECT ON public.polite_propuneri FROM service_role;"
  "GRANT SELECT ON public.polite_alerte_jurnal TO anon;"
  # r7: o functie straina care foloseste o functie a migrarii (nume exact) => refuz
  "CREATE FUNCTION public.zz_straina() RETURNS jsonb LANGUAGE sql AS \$x\$ SELECT public.fn_polita_salveaza(NULL, NULL, NULL) \$x\$;"
  # r8: garda pe corpuri nu tine cont de majuscule (~*)
  "CREATE FUNCTION public.zz_majuscule() RETURNS jsonb LANGUAGE sql AS \$x\$ SELECT PUBLIC.FN_POLITA_SALVEAZA(NULL, NULL, NULL) \$x\$;"
  # r8: alertele vechi catre owneri au fost oprite din Administrator => revenirea refuza (nu le reprogrameaza)
  "UPDATE public.polite_alerte_config SET vechi_oprit_la = now(), vechi_oprit_de = '00000000-0000-0000-0000-00000000000a';"
  "CREATE OR REPLACE FUNCTION public.fn_poate_scrie_garantii() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ SELECT true \$f\$;"
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
# r7: o functie care cheama DOAR functia veche fn_polite_send_alerte (prefix comun, alt nume) NU blocheaza revenirea
"${PS[@]}" -d app -c "CREATE FUNCTION public.zz_cheama_vechi() RETURNS void LANGUAGE sql AS \$x\$ SELECT public.fn_polite_send_alerte() \$x\$;" >/dev/null || fail "functia de proba pentru garda pe nume"
rev app "" COMMIT || { grep -o "ERROR:.*" "$L/r.log"; fail "revenirea reala"; }
[ "$("${PS[@]}" -d app -Atc "SELECT to_regclass('public.polite_propuneri') IS NULL AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='polite_alerte_departamente') AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('fn_polite_norm_nr','fn_polite_text','fn_polite_data','fn_polite_suma','fn_polite_e_owner','fn_polite_provenienta','fn_polite_garantii_legat','fn_polite_scadente','fn_polite_dest_normalizeaza','fn_polite_alerte_calculeaza','fn_polite_alerte_proba','fn_polite_alerte_porneste','fn_polite_alerte_rezerva','fn_polite_alerte_marcheaza','fn_polite_alerte_reconciliaza','fn_polite_propunere_rezerva','fn_polite_propunere_completeaza','fn_polite_propunere_esec','fn_polite_propunere_json','fn_polita_salveaza','fn_polita_propunere_respinge','fn_polite_alerte_opreste_vechi','fn_poate_scrie_polite')) AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_polite_send_alerte') AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'polite_alerte_zilnic') AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.garantii'::regclass AND attname='contract_polita_id' AND NOT attisdropped) AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.contracte_polite'::regclass AND conname='contracte_polite_tip_check') LIKE '%altul%' AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.contracte_polite'::regclass AND conname='contracte_polite_tip_check') NOT LIKE '%avans%'")" = t ] || fail "revenirea a lasat obiecte / CHECK-ul vechi nerefacut"
ok "revenire reala, baza curata, CHECK-ul vechi refacut"
aplica app "$MIG" || { grep -o "ERROR:.*" "$L/a.log"; fail "re-aplicarea"; }
ok "re-aplicare"

echo "== garda: fara GUC de livrare migrarea e refuzata"
"${PS[@]}" -d dry -c "BEGIN" -f "$(m "$MIG")" > "$L/g.log" 2>&1 && fail "migrarea a trecut fara garda"
grep -q "garda start invalida" "$L/g.log" || fail "garda: alt motiv"
ok "garda"
echo "TEST_POLITE_ALERTE_GATA PASS"
