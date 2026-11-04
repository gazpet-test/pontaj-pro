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
T=$RAD/supabase/tests/20261130l_redari_convocare_rezerva_dryrun_local.sql
for f in "$M" "$R" "$S" "$T"; do tr -d '\r' < "$f" > "$TMP/$(basename "$f")" || exit 90; done
curata() { [ "${PASTREAZA:-}" = 1 ] && { echo "CLUSTER PASTRAT: $DATA port $PORT"; return; }; "$BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1; rm -rf "$TMP"; }
trap curata EXIT
"$BIN/initdb" -D "$DATA" -U postgres -A trust -E UTF8 --locale=C >"$TMP/initdb.log" 2>&1 || { cat "$TMP/initdb.log"; exit 91; }
"$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$TW/pg.log" -w start >/dev/null || { cat "$TMP/pg.log"; exit 92; }
PSQL="$BIN/psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $PORT -U postgres -d postgres"
export PGCLIENTENCODING=UTF8
unset PGPASSWORD PGSERVICE PGDATABASE
REZ=0
$PSQL -f "$TW/$(basename "$S")" >"$TMP/schelet.out" 2>&1 || { echo "ESEC schelet"; cat "$TMP/schelet.out"; exit 1; }
echo "SCHELET_OK"
{ echo "BEGIN;"; echo "SELECT set_config('gazpet.livrare_migrare', '20261130l_redari_convocare_rezerva:' || txid_current(), true);"
  echo "\\i $TW/$(basename "$M")"; echo "COMMIT;"; } > "$TMP/mig.sql"
$PSQL -f "$TW/mig.sql" >"$TMP/mig.out" 2>&1 || { echo "ESEC migrare"; cat "$TMP/mig.out"; exit 1; }
echo "MIGRARE_OK"
# a doua aplicare trebuie refuzata (functia exista deja)
if $PSQL -f "$TW/mig.sql" >"$TMP/mig2.out" 2>&1; then echo "ESEC: a doua aplicare a trecut"; REZ=1
else grep -q "functia exista deja" "$TMP/mig2.out" && echo "REAPLICARE_REFUZATA_OK" || { echo "ESEC reaplicare"; cat "$TMP/mig2.out"; REZ=1; }; fi
PGOPTIONS="-c gazpet.dry_local=DA" $PSQL -v port="$PORT" -f "$TW/$(basename "$T")" >"$TMP/teste.out" 2>&1 || { echo "ESEC teste"; REZ=1; }
grep -E "TEST[0-9a-z]+ OK|FAIL|ERROR|TESTE_LOCAL_OK" "$TMP/teste.out" | sed 's/^.*NOTICE:  //' | sed "s|^psql:[^ ]*sql:[0-9]*: ||" | cut -c1-300
grep -q "TESTE_LOCAL_OK" "$TMP/teste.out" || REZ=1
{ echo "BEGIN;"; echo "SELECT set_config('gazpet.revenire_20261130l', 'REDARI_CONVOCARE_REZERVA_SCOS:' || txid_current(), true);"
  echo "\\i $TW/$(basename "$R")"
  echo "DO \$v\$ BEGIN IF to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean)') IS NOT NULL THEN RAISE EXCEPTION 'REVENIRE_INCOMPLETA'; END IF; END \$v\$;"
  echo "SELECT 'CONVOCARI_RAMASE=' || count(*) FROM public.red_convocari;"; echo "COMMIT;"; } > "$TMP/rev.sql"
if $PSQL -At -f "$TW/rev.sql" >"$TMP/rev.out" 2>&1; then echo "REVENIRE_OK"; grep CONVOCARI_RAMASE "$TMP/rev.out"; else echo "ESEC revenire"; cat "$TMP/rev.out"; REZ=1; fi
# DRY-ul de PRODUCTIE rulat si pe clusterul local (datele fictive de mai sus, functia scoasa de revenire): exact secventa runnerului de productie,
# intr-o tranzactie READ COMMITTED anulata (marcaj + migrare + DRY + RESET ROLE + revenire + verificare + ROLLBACK)
P=$RAD/supabase/tests/20261130l_redari_convocare_rezerva_dryrun.sql; tr -d '\r' < "$P" > "$TMP/$(basename "$P")"
{ echo "BEGIN ISOLATION LEVEL READ COMMITTED;"; echo "SELECT set_config('gazpet.livrare_migrare', '20261130l_redari_convocare_rezerva:' || txid_current(), true);"
  echo "\\i $TW/$(basename "$M")"; echo "\\i $TW/$(basename "$P")"; echo "RESET ROLE;"; echo "SELECT set_config('request.jwt.claims', '', true);"
  echo "SELECT set_config('gazpet.revenire_20261130l', 'REDARI_CONVOCARE_REZERVA_SCOS:' || txid_current(), true);"; echo "\\i $TW/$(basename "$R")"
  echo "ROLLBACK;"; echo "SELECT 'DUPA_ROLLBACK fn=' || (to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean)') IS NOT NULL)::text;"; } > "$TMP/prod.sql"
if $PSQL -f "$TW/prod.sql" >"$TMP/prod.out" 2>&1 && grep -q "DUPA_ROLLBACK fn=false" "$TMP/prod.out" && grep -q "DRY productie 20261130l: teste OK" "$TMP/prod.out"; then
  grep -E "TEST[0-9a-z]+ (OK|SARIT)" "$TMP/prod.out" | sed 's/^.*NOTICE:  /PROD_SIM /' | cut -c1-200; echo "DRY_PROD_PE_LOCAL_OK"
else echo "ESEC DRY productie pe local"; cat "$TMP/prod.out" | tail -20; REZ=1; fi
[ "$REZ" = "0" ] && echo "DRY_LOCAL=VERDE" || echo "DRY_LOCAL=ROSU"
exit $REZ
