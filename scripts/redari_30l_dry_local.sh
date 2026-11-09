#!/usr/bin/env bash
# DRY LOCAL 20261130l_redari_convocare_rezerva: cluster PG17 de unica folosinta (initdb in director temporar, port local, trust doar pe 127.0.0.1),
# schelet + migrare (COMISE, cu marcajul gazpet.livrare_migrare) + teste cu concurenta prin dblink + revenire (DROP FUNCTION) + verificare.
# Clusterul se opreste si se sterge la final (si la eroare). Nu atinge productia: nicio conexiune spre pooler.
# Utilizare: scripts/redari_30l_dry_local.sh [director_temporar] [port]   (implicit: mktemp -d, 55437)
# Fisierele SQL se citesc cu CR scos (checkout-ul Windows cu autocrlf adauga CR; corpul functiilor trebuie sa aiba md5-ul de pe live).
# Executabilele PostgreSQL sunt native Windows: caile li se dau in forma C:/... (cygpath -m).
set -u
BIN=${PGBIN:-/c/Users/Public/pgsql/bin}
RAD=$(cd "$(dirname "$0")/.." && pwd)
TMP=${1:-$(mktemp -d)}; PORT=${2:-55437}
mkdir -p "$TMP"
W() { cygpath -m "$1" 2>/dev/null || echo "$1"; }
TW=$(W "$TMP"); DATA=$TW/data
M=$RAD/supabase/migrations/20261130l_redari_convocare_rezerva.sql
R=$RAD/supabase/revenire/20261130l_redari_convocare_rezerva_ROLLBACK.sql
S=$RAD/supabase/tests/20261130l_redari_convocare_rezerva_schelet.sql
B=$RAD/supabase/tests/20261130l_redari_convocare_rezerva_schelet_bootstrap.sql
T=$RAD/supabase/tests/20261130l_redari_convocare_rezerva_dryrun_local.sql
for f in "$M" "$R" "$S" "$B" "$T"; do tr -d '\r' < "$f" > "$TMP/$(basename "$f")" || exit 90; done
curata() { [ "${PASTREAZA:-}" = 1 ] && { echo "CLUSTER PASTRAT: $DATA port $PORT"; return; }; "$BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1; rm -rf "$TMP"; }
trap curata EXIT
# r8: superuser-ul clusterului = supabase_admin (ca pe Supabase); `postgres` = NOSUPERUSER NOBYPASSRLS, creat de bootstrap
"$BIN/initdb" -D "$DATA" -U supabase_admin -A trust -E UTF8 --locale=C >"$TMP/initdb.log" 2>&1 || { cat "$TMP/initdb.log"; exit 91; }
"$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$TW/pg.log" -w start >/dev/null || { cat "$TMP/pg.log"; exit 92; }
PSQLA="$BIN/psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $PORT -U supabase_admin -d postgres"   # doar bootstrap + testele cu dblink
PSQL="$BIN/psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $PORT -U postgres -d postgres"          # schelet, migrare, mutanti, revenire (NOSUPERUSER)
export PGCLIENTENCODING=UTF8
unset PGPASSWORD PGSERVICE PGDATABASE
REZ=0
$PSQLA -f "$TW/$(basename "$B")" >"$TMP/boot.out" 2>&1 || { echo "ESEC bootstrap"; cat "$TMP/boot.out"; exit 1; }
[ "$($PSQL -At -c "SELECT rolsuper::text || rolbypassrls::text FROM pg_roles WHERE rolname = current_user")" = "falsefalse" ] || { echo "ESEC: postgres nu e NOSUPERUSER NOBYPASSRLS"; exit 1; }
echo "BOOTSTRAP_OK (postgres NOSUPERUSER NOBYPASSRLS, ca pe Supabase)"
$PSQL -f "$TW/$(basename "$S")" >"$TMP/schelet.out" 2>&1 || { echo "ESEC schelet"; cat "$TMP/schelet.out"; exit 1; }
echo "SCHELET_OK"
{ echo "BEGIN;"; echo "SELECT set_config('gazpet.livrare_migrare', '20261130l_redari_convocare_rezerva:' || txid_current(), true);"
  echo "\\i $TW/$(basename "$M")"; echo "COMMIT;"; } > "$TMP/mig.sql"
$PSQL -f "$TW/mig.sql" >"$TMP/mig.out" 2>&1 || { echo "ESEC migrare"; cat "$TMP/mig.out"; exit 1; }
echo "MIGRARE_OK"
# r6: poarta 0e (scripts/control_0e.sql, neschimbată) pe schelet + migrare, ÎNAINTE de funcțiile de test (care folosesc dblink / EXECUTE): 0 rânduri
tr -d '\r' < "$RAD/scripts/control_0e.sql" > "$TMP/control_0e.sql"
if $PSQL -At -f "$TW/control_0e.sql" >"$TMP/c0e.out" 2>&1; then
  N0E=$(grep -c . "$TMP/c0e.out" || true)
  if [ "$N0E" = "0" ]; then echo "C0E_LOCAL_OK (0 randuri)"; else echo "ESEC C0E local: $N0E randuri"; cat "$TMP/c0e.out"; REZ=1; fi
else echo "ESEC C0E local (eroare)"; cat "$TMP/c0e.out"; REZ=1; fi
# a doua aplicare trebuie refuzata (functia exista deja)
if $PSQL -f "$TW/mig.sql" >"$TMP/mig2.out" 2>&1; then echo "ESEC: a doua aplicare a trecut"; REZ=1
else grep -q "functia exista deja" "$TMP/mig2.out" && echo "REAPLICARE_REFUZATA_OK" || { echo "ESEC reaplicare"; cat "$TMP/mig2.out"; REZ=1; }; fi
PGOPTIONS="-c gazpet.dry_local=DA" $PSQLA -v port="$PORT" -f "$TW/$(basename "$T")" >"$TMP/teste.out" 2>&1 || { echo "ESEC teste"; REZ=1; }
grep -E "TEST[0-9a-z]+ OK|FAIL|ERROR|TESTE_LOCAL_OK" "$TMP/teste.out" | sed 's/^.*NOTICE:  //' | sed "s|^psql:[^ ]*sql:[0-9]*: ||" | cut -c1-300
grep -q "TESTE_LOCAL_OK" "$TMP/teste.out" || REZ=1
{ echo "BEGIN;"; echo "SELECT set_config('gazpet.revenire_20261130l', 'REDARI_CONVOCARE_REZERVA_SCOS:' || txid_current(), true);"
  echo "\\i $TW/$(basename "$R")"
  echo "DO \$v\$ BEGIN IF to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean,text)') IS NOT NULL THEN RAISE EXCEPTION 'REVENIRE_INCOMPLETA'; END IF; END \$v\$;"
  echo "SELECT 'CONVOCARI_RAMASE=' || count(*) FROM public.red_convocari;"; echo "COMMIT;"; } > "$TMP/rev.sql"
if $PSQL -At -f "$TW/rev.sql" >"$TMP/rev.out" 2>&1; then echo "REVENIRE_OK"; grep CONVOCARI_RAMASE "$TMP/rev.out"; else echo "ESEC revenire"; cat "$TMP/rev.out"; REZ=1; fi
# DRY-ul de PRODUCTIE rulat si pe clusterul local (datele fictive de mai sus, functia scoasa de revenire): exact secventa runnerului de productie,
# intr-o tranzactie READ COMMITTED anulata (marcaj + migrare + DRY + RESET ROLE + revenire + verificare + ROLLBACK)
P=$RAD/supabase/tests/20261130l_redari_convocare_rezerva_dryrun.sql; tr -d '\r' < "$P" > "$TMP/$(basename "$P")"
prod_sim() {   # $1 = eticheta, $2 = SQL de pregătire în aceeași tranzacție anulată (ex. ca pe prod: proiect fără telefon TGZ), $3 = textul TEST3 așteptat
  { echo "BEGIN ISOLATION LEVEL READ COMMITTED;"; echo "$2"; echo "SELECT set_config('gazpet.livrare_migrare', '20261130l_redari_convocare_rezerva:' || txid_current(), true);"
    echo "\\i $TW/$(basename "$M")"; echo "\\i $TW/$(basename "$P")"; echo "RESET ROLE;"; echo "SELECT set_config('request.jwt.claims', '', true);"
    echo "SELECT set_config('gazpet.revenire_20261130l', 'REDARI_CONVOCARE_REZERVA_SCOS:' || txid_current(), true);"; echo "\\i $TW/$(basename "$R")"
    echo "ROLLBACK;"; echo "SELECT 'DUPA_ROLLBACK fn=' || (to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean,text)') IS NOT NULL)::text;"; } > "$TMP/prod.sql"
  if $PSQL -f "$TW/prod.sql" >"$TMP/prod.out" 2>&1 && grep -q "DUPA_ROLLBACK fn=false" "$TMP/prod.out" && grep -q "DRY productie 20261130l: teste OK" "$TMP/prod.out" && grep -q "$3" "$TMP/prod.out"; then
    grep -E "TEST[0-9a-z]+ (OK|SARIT)" "$TMP/prod.out" | sed "s/^.*NOTICE:  /PROD_SIM_$1 /" | cut -c1-220; echo "DRY_PROD_PE_LOCAL_$1_OK"
  else echo "ESEC DRY productie pe local ($1)"; cat "$TMP/prod.out" | tail -20; REZ=1; fi
}
prod_sim GARZI_OK "SELECT 1;" "TEST3 OK (RD001 pe"
# ca pe producția de azi (05.11): TEST-RAZVAN fără telefonul reprezentantului TGZ → TEST3 trebuie să aștepte exact RD002 (gărzile înaintea RD001)
prod_sim FARA_TEL_TGZ "UPDATE public.red_proiecte SET reprezentant_tgz_telefon = NULL WHERE cod = 'TEST-RAZVAN';" "TEST3 OK (RD002 inaintea RD001 pe C-0001, garzi de continut neindeplinite pe datele reale: proiect fara telefonul reprezentantului TGZ)"
# mutanți de poartă L15 (r4): o schimbare de politică / drept / funcție din lanț → migrarea TREBUIE să refuze (tranzacție anulată)
mutant() {   # $1 = eticheta, $2 = SQL-ul mutației, $3 = textul de refuz așteptat
  { echo "BEGIN;"; echo "$2"; echo "SELECT set_config('gazpet.livrare_migrare', '20261130l_redari_convocare_rezerva:' || txid_current(), true);"
    echo "\\i $TW/$(basename "$M")"; echo "ROLLBACK;"; } > "$TMP/mut.sql"
  if $PSQL -f "$TW/mut.sql" >"$TMP/mut.out" 2>&1; then echo "ESEC MUTANT $1: migrarea a trecut"; REZ=1
  elif grep -q "$3" "$TMP/mut.out"; then echo "MUTANT_$1_REFUZAT_OK"; else echo "ESEC MUTANT $1: alt refuz"; tail -3 "$TMP/mut.out"; REZ=1; fi
}
mutant POLITICA_SELECT "ALTER POLICY red_convocari_sel ON public.red_convocari USING (true);" "politicile RLS"
mutant POLITICA_IN_PLUS "CREATE POLICY red_convocari_extra ON public.red_convocari AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (true);" "politicile RLS"
mutant DREPT_TABEL "GRANT DELETE ON public.red_convocari TO authenticated;" "drepturile pe tabelele"
mutant DREPT_COLOANA "REVOKE UPDATE (sters_la) ON public.red_parcele FROM authenticated;" "drepturile pe tabelele"
mutant TRIGGER_DEFINER "ALTER FUNCTION public.fn_red_convocari_posta_garda() SECURITY DEFINER;" "lantul de functii"
mutant A_DOUA_FUNCTIE_MARCAJ "CREATE FUNCTION public.mutant_marcaj() RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN SET LOCAL gazpet.convocare_rezerva = 'activ'; END \$f\$;" "e scris si de alte functii"
mutant LOCK_UAT "CREATE OR REPLACE FUNCTION public.fn_red_plic_incearca_lock(p_uat uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ BEGIN RETURN; END \$f\$;" "lantul de functii"
[ "$REZ" = "0" ] && echo "DRY_LOCAL=VERDE" || echo "DRY_LOCAL=ROSU"
exit $REZ
