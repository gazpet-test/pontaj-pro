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
  (961, 17, 'GBE', 'VECHI', 'C-961', 100, '2027-01-01'), (962, 17, 'CAR', 'ASIG', 'C-962', 100, '2027-01-01'), (963, 17, 'GBE', 'VECHI', 'C-963', 100, '2027-01-01'),
  (964, 17, 'CAR', 'ASIG', 'C-964', 100, '2027-01-01'), (965, 17, 'GBE', 'ASIG', 'C-965', 100, '2027-01-01'), (966, 17, 'GBE', 'ASIG', 'C-966', 100, '2027-01-01'),
  (967, 18, 'GPL', 'ASIG', 'C-967', 100, '2027-01-01');
  INSERT INTO public.garantii (id, forma, tip, beneficiar, valoare, moneda, stare) VALUES
  (861, 'polita_asigurare', 'buna_executie', 'B', 1, 'RON', 'activa'), (862, 'polita_asigurare', 'car', 'B', 1, 'RON', 'activa'), (863, 'polita_asigurare', 'buna_executie', 'B', 1, 'RON', 'activa'),
  (864, 'polita_asigurare', 'car', 'B', 1, 'RON', 'activa'), (865, 'polita_asigurare', 'buna_executie', 'B', 1, 'RON', 'activa'), (866, 'polita_asigurare', 'buna_executie', 'B', 1, 'RON', 'activa');
  UPDATE public.garantii SET contract_polita_id = id + 100 WHERE id IN (864, 865, 866);
  INSERT INTO public.contracte_polite_acte (id, polita_id, nr_act, data_expirare_noua) VALUES (7001, 965, 1, '2028-01-01'), (7002, 966, 1, '2029-01-01'), (7003, 967, 1, '2028-06-30');" >/dev/null || fail "fixture concurenta"
# r3 (Jakarinos r2): bariera verifica starea REALA a sesiunilor, nu textul interogarii: A e in pg_sleep (wait_event PgSleep) si tine
# lock-urile; B asteapta efectiv un lock (wait_event_type Lock). Fara pauze fixe pentru sincronizare.
asteapta() { # $1 = conditia SQL pe pg_stat_activity (alta sesiune decat cea de control), max 10 s
  for _ in $(seq 1 100); do
    [ "$("${PS[@]}" -d conc -Atc "SELECT count(*) FROM pg_stat_activity WHERE datname = 'conc' AND pid <> pg_backend_pid() AND $1")" -ge 1 ] && return 0
    "${PS[@]}" -d conc -Atc "SELECT pg_sleep(0.1)" >/dev/null
  done; return 1; }
in_somn() { asteapta "wait_event = 'PgSleep'"; }
blocat() { asteapta "wait_event_type = 'Lock' AND query NOT LIKE '%pg_sleep%'"; }
# scenariu: A (tranzactie deschisa, apoi pg_sleep) in fundal; B in fundal trebuie sa ajunga BLOCAT pe lock; apoi ambele se termina fara eroare
doua() { # $1 nume, $2 SQL A (fara BEGIN/COMMIT), $3 SQL B
  "${PS[@]}" -d conc -c "BEGIN; $2 SELECT pg_sleep(4); COMMIT;" > "$L/$1a.log" 2>&1 & local PA=$!
  in_somn || fail "$1: A n-a ajuns in pg_sleep"
  "${PS[@]}" -d conc -c "$3" > "$L/$1b.log" 2>&1 & local PB=$!
  blocat || fail "$1: B nu a asteptat lock-ul (serializarea lipseste)"
  wait $PA || { cat "$L/$1a.log"; fail "$1: A"; }
  wait $PB || { cat "$L/$1b.log"; fail "$1: B"; }
}
# 1) A schimba polita; B leaga in timpul ei => B asteapta, apoi copiaza versiunea NOUA
doua c1 "UPDATE public.contracte_polite SET asigurator = 'NOU' WHERE id = 961;" "UPDATE public.garantii SET contract_polita_id = 961 WHERE id = 861;"
[ "$("${PS[@]}" -d conc -Atc "SELECT emitent FROM public.garantii WHERE id = 861")" = NOU ] || fail "concurenta 1: legarea a pastrat polita veche"
# 2) A adauga un act (prelungire); B leaga in timpul lui => expirarea efectiva = cea din act
doua c2 "INSERT INTO public.contracte_polite_acte (polita_id, nr_act, data_expirare_noua) VALUES (962, 1, '2028-12-31');" "UPDATE public.garantii SET contract_polita_id = 962 WHERE id = 862;"
[ "$("${PS[@]}" -d conc -Atc "SELECT data_expirare FROM public.garantii WHERE id = 862")" = 2028-12-31 ] || fail "concurenta 2: legarea a pierdut actul aditional"
# 3) ordinea inversa: B leaga primul (tranzactie deschisa); A schimba polita in timpul ei => A asteapta, apoi reimprospateaza randul legat
doua c3 "UPDATE public.garantii SET contract_polita_id = 963 WHERE id = 863;" "UPDATE public.contracte_polite SET asigurator = 'NOU3' WHERE id = 963;"
[ "$("${PS[@]}" -d conc -Atc "SELECT emitent FROM public.garantii WHERE id = 863")" = NOU3 ] || fail "concurenta 3: randul legat nu s-a reimprospatat"
# 4) (r2 P1) doua acte noi pe aceeasi polita legata, in paralel => fara deadlock, Registrul are expirarea celui mai tarziu act
doua c4 "INSERT INTO public.contracte_polite_acte (polita_id, nr_act, data_expirare_noua) VALUES (964, 1, '2029-01-01');" "INSERT INTO public.contracte_polite_acte (polita_id, nr_act, data_expirare_noua) VALUES (964, 2, '2030-01-01');"
[ "$("${PS[@]}" -d conc -Atc "SELECT data_expirare FROM public.garantii WHERE id = 864")" = 2030-01-01 ] || fail "concurenta 4: doua acte in paralel"
# 5) (r2 P1) mutari opuse de acte intre doua polite legate => fara deadlock, fiecare rand din Registru are expirarea actelor ramase
doua c5 "UPDATE public.contracte_polite_acte SET polita_id = 966 WHERE id = 7001;" "UPDATE public.contracte_polite_acte SET polita_id = 965 WHERE id = 7002;"
[ "$("${PS[@]}" -d conc -Atc "SELECT string_agg(id || ':' || data_expirare, ',' ORDER BY id) FROM public.garantii WHERE id IN (865, 866)")" = "865:2029-01-01,866:2028-01-01" ] || fail "concurenta 5: mutari opuse"
# 6) (r2 P1) UPDATE pe act vs DELETE al politei cu CASCADE => fara deadlock, polita si actul sterse
doua c6 "UPDATE public.contracte_polite_acte SET descriere = 'x' WHERE id = 7003;" "DELETE FROM public.contracte_polite WHERE id = 967;"
[ "$("${PS[@]}" -d conc -Atc "SELECT count(*) FROM public.contracte_polite_acte WHERE id = 7003")" = 0 ] || fail "concurenta 6: CASCADE"
grep -l "deadlock" "$L"/c*.log && fail "deadlock in testul de concurenta"
ok "concurenta: 6/6 (polita, act, ordinea inversa, doua acte, mutari opuse, CASCADE), fiecare cu B blocat efectiv pe lock, fara deadlock"

echo "== intercalari fortate (r4, Jakarinos r3 P1 + P2): A se opreste EXACT intre verificarea FK si triggerul de reimprospatare"
# Triggere DOAR de test (baza conc, nu in migrare): numele „s_pauza_test” se ordoneaza dupa RI_ConstraintTrigger_* (FK) si inaintea
# trg_polite_* => pauza cade dupa lock-urile FK / de rand ale instructiunii si inaintea lock-ului consultativ. Activ doar cu test.pauza = da.
"${PS[@]}" -d conc -f - >/dev/null <<'SQL' || fail "triggerele de pauza"
CREATE FUNCTION public.zz_test_pauza() RETURNS trigger LANGUAGE plpgsql AS $p$
BEGIN IF current_setting('test.pauza', true) = 'da' THEN PERFORM pg_sleep(3); END IF; RETURN coalesce(NEW, OLD); END $p$;
CREATE TRIGGER s_pauza_test AFTER INSERT OR UPDATE OR DELETE ON public.contracte_polite_acte FOR EACH ROW EXECUTE FUNCTION public.zz_test_pauza();
CREATE TRIGGER s_pauza_test BEFORE UPDATE ON public.garantii FOR EACH ROW EXECUTE FUNCTION public.zz_test_pauza();
INSERT INTO public.contracte_polite (id, contract_id, tip, asigurator, nr_polita, valoare_lei, data_expirare) VALUES
  (968, 17, 'GBE', 'ASIG', 'C-968', 100, '2027-01-01'), (969, 17, 'GBE', 'ASIG', 'C-969', 100, '2027-01-01'), (970, 17, 'GBE', 'ASIG', 'C-970', 100, '2027-01-01'),
  (971, 17, 'CAR', 'ASIG', 'C-971', 100, '2027-01-01'), (972, 17, 'GBE', 'ASIG', 'C-972', 100, '2027-01-01'), (973, 17, 'GBE', 'ASIG', 'C-973', 100, '2027-01-01'),
  (974, 18, 'GPL', 'ASIG', 'C-974', 100, '2027-01-01');
INSERT INTO public.garantii (id, forma, tip, beneficiar, valoare, moneda, stare) VALUES
  (867, 'polita_asigurare', 'buna_executie', 'B', 1, 'RON', 'activa'), (868, 'polita_asigurare', 'buna_executie', 'B', 1, 'RON', 'activa'),
  (869, 'polita_asigurare', 'car', 'B', 1, 'RON', 'activa'), (870, 'polita_asigurare', 'buna_executie', 'B', 1, 'RON', 'activa'),
  (871, 'polita_asigurare', 'buna_executie', 'B', 1, 'RON', 'activa');
UPDATE public.garantii SET contract_polita_id = CASE id WHEN 868 THEN 969 WHEN 869 THEN 971 WHEN 870 THEN 972 WHEN 871 THEN 973 END WHERE id IN (868, 869, 870, 871);
INSERT INTO public.contracte_polite_acte (id, polita_id, nr_act, data_expirare_noua) VALUES
  (7004, 969, 1, '2031-06-30'), (7005, 972, 1, '2030-02-01'), (7006, 973, 1, '2030-03-01'), (7007, 974, 1, '2028-06-30');
SQL
pauza() { # $1 nume; $L/$1_a.sql (cu pauza) si $L/$1_b.sql; B porneste cand A e in pg_sleep; ambele trebuie sa se termine fara eroare
  "${PS[@]}" -d conc -f "$(m "$L/$1_a.sql")" > "$L/c$1a.log" 2>&1 & local PA=$!
  in_somn || fail "$1: A n-a ajuns in pauza"
  "${PS[@]}" -d conc -f "$(m "$L/$1_b.sql")" > "$L/c$1b.log" 2>&1 & local PB=$!
  wait $PA || { cat "$L/c$1a.log"; fail "$1: A"; }
  wait $PB || { cat "$L/c$1b.log"; fail "$1: B"; }
}
# p1) ciclul RPC din r3: A = fn_polita_salveaza(act pe 968) oprit dupa FK (KEY SHARE pe polita); B leaga 867 de 968 in timpul pauzei
cat > "$L/p1_a.sql" <<'SQL'
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
SET test.pauza = 'da';
SELECT public.fn_polita_salveaza(NULL, '{"tinta":"act","polita_id":968,"nr_act":1,"data_expirare_noua":"2031-01-01"}'::jsonb, NULL);
SQL
echo "UPDATE public.garantii SET contract_polita_id = 968 WHERE id = 867;" > "$L/p1_b.sql"
pauza p1
[ "$("${PS[@]}" -d conc -Atc "SELECT data_expirare FROM public.garantii WHERE id = 867")" = 2031-01-01 ] || fail "p1: Registrul nu are actul salvat prin RPC"
# p2) ciclul direct din r3: A re-leaga 868 de la 969 la 970 (oprit cu randul garantii blocat, inaintea consultativului); B muta actul 7004 969 -> 970
printf "SET test.pauza = 'da';\nUPDATE public.garantii SET contract_polita_id = 970 WHERE id = 868;\n" > "$L/p2_a.sql"
echo "UPDATE public.contracte_polite_acte SET polita_id = 970 WHERE id = 7004;" > "$L/p2_b.sql"
pauza p2
[ "$("${PS[@]}" -d conc -Atc "SELECT contract_polita_id || ':' || data_expirare FROM public.garantii WHERE id = 868")" = "970:2031-06-30" ] || fail "p2: re-legarea nu vede actul mutat"
# p3) doua acte noi pe aceeasi polita legata: A oprit dupa FK (KEY SHARE), B insereaza complet in timpul pauzei
printf "SET test.pauza = 'da';\nINSERT INTO public.contracte_polite_acte (polita_id, nr_act, data_expirare_noua) VALUES (971, 1, '2032-01-01');\n" > "$L/p3_a.sql"
echo "INSERT INTO public.contracte_polite_acte (polita_id, nr_act, data_expirare_noua) VALUES (971, 2, '2033-01-01');" > "$L/p3_b.sql"
pauza p3
[ "$("${PS[@]}" -d conc -Atc "SELECT data_expirare FROM public.garantii WHERE id = 869")" = 2033-01-01 ] || fail "p3: doua acte"
# p4) mutari opuse: A muta 7005 972 -> 973 (oprit dupa FK pe 973); B muta 7006 973 -> 972 in timpul pauzei
printf "SET test.pauza = 'da';\nUPDATE public.contracte_polite_acte SET polita_id = 973 WHERE id = 7005;\n" > "$L/p4_a.sql"
echo "UPDATE public.contracte_polite_acte SET polita_id = 972 WHERE id = 7006;" > "$L/p4_b.sql"
pauza p4
[ "$("${PS[@]}" -d conc -Atc "SELECT string_agg(id || ':' || data_expirare, ',' ORDER BY id) FROM public.garantii WHERE id IN (870, 871)")" = "870:2030-03-01,871:2030-02-01" ] || fail "p4: mutari opuse"
# p5) UPDATE pe act (oprit, cu randul actului blocat) vs DELETE al politei cu CASCADE
printf "SET test.pauza = 'da';\nUPDATE public.contracte_polite_acte SET descriere = 'x' WHERE id = 7007;\n" > "$L/p5_a.sql"
echo "DELETE FROM public.contracte_polite WHERE id = 974;" > "$L/p5_b.sql"
pauza p5
[ "$("${PS[@]}" -d conc -Atc "SELECT count(*) FROM public.contracte_polite WHERE id = 974")" = 0 ] || fail "p5: CASCADE"
grep -l "deadlock" "$L"/cp*.log && fail "deadlock in intercalarile fortate"
ok "intercalari fortate: 5/5 (RPC act + legare, re-legare + mutare act, doua acte, mutari opuse, act + CASCADE), fara deadlock"

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
  # r2 (amprenta extinsa, Jakarinos r1 P2-11): drepturi pe tabele si dependenta fn_poate_scrie_garantii
  "REVOKE SELECT ON public.polite_propuneri FROM service_role;"
  "GRANT SELECT ON public.polite_alerte_jurnal TO anon;"
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
