#!/usr/bin/env bash
# Runda 10 a runnerului (PR #892 r12): proba lui scripts/livrare_migrare.sh --plafon-tranzactie-ms pe un cluster
# PostgreSQL 17 NOU, efemer: doar 127.0.0.1, port 6790 + slot (verificat liber), director nou in /tmp. Nu atinge nicio
# alta baza si nu sterge nimic in afara directorului propriu.
#   Linux / WSL, ca utilizatorul postgres (initdb refuza root):
#     wsl -d Ubuntu-24.04 -u postgres -- bash /mnt/c/.../scripts/test_livrare_plafon.sh <slot 0-9>
#   PG_BIN = binarele PG17 (implicit /usr/lib/postgresql/17/bin).
# Ce dovedeste (fiecare caz cu prag care pica testul):
#   argumente: valori invalide / PGOPTIONS din mediu => refuz 2, fara conexiune;
#   ok:        cu --plafon-tranzactie-ms 1500, in tranzactie transaction_timeout = 1500, sursa 'client' => aplicat (0);
#   rol:       ALTER ROLE ... SET transaction_timeout = '10s' nu schimba nimic: tot 1500/client => aplicat (0);
#   lent:      o migrare care sta 3 s, cu plafon 1000 => serverul inchide sesiunea la ~1 s de la BEGIN, NEAPLICAT (10),
#              nimic creat, nimic inregistrat, linie noua „transaction timeout” in jurnalul serverului;
#   pooler:    un client care pierde parametrul de pornire (PGOPTIONS ignorat) => prologul refuza, NEAPLICAT (10);
#   fara:      fara optiune => comportamentul vechi (transaction_timeout 0, sursa default) => aplicat (0).
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SLOT="${1:-0}"; [[ "$SLOT" =~ ^[0-9]$ ]] || { echo 'MEDIU: slot 0-9'; exit 2; }
[[ "$(id -u)" != 0 ]] || { echo 'MEDIU: ruleaza ca postgres, nu root'; exit 2; }
for v in PGPASSWORD PGOPTIONS PGDATABASE PGSERVICE PGSERVICEFILE PGHOSTADDR PGTARGETSESSIONATTRS PGLOADBALANCEHOSTS PGSYSCONFDIR PSQLRC; do
  [[ -z "${!v+x}" ]] || { echo "MEDIU: variabila $v nepermisa"; exit 2; }
done
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
[[ -x "$PG_BIN/initdb" ]] || { echo "MEDIU: PG17 lipsa in $PG_BIN"; exit 2; }
[[ "$("$PG_BIN/postgres" --version)" == *" 17."* ]] || { echo 'MEDIU: este necesar PG17'; exit 2; }
PORT=$((6790+SLOT)); DB=plafon_test
PORT_RC=0; "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT" -t 2 || PORT_RC=$?
[[ "$PORT_RC" == 2 ]] || { echo "MEDIU: portul $PORT e ocupat, alege alt slot"; exit 2; }
TMP="$(mktemp -d "/tmp/livrare_plafon_${SLOT}_XXXXXXXX")"
export TMPDIR="$TMP"
DATA="$TMP/pg"; PG_LOG="$TMP/pg.log"
trap '"$PG_BIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null 2>&1 || true' EXIT
fail() { echo "ESEC: $*" >&2; echo "copie/log: $TMP" >&2; exit 1; }
ADMIN=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U supabase_admin)
q() { "$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -Atc "$1"; }
"$PG_BIN/initdb" -D "$DATA" -U supabase_admin --auth=trust --encoding=UTF8 --locale=C.UTF-8 >"$TMP/init.log"
"$PG_BIN/pg_ctl" -D "$DATA" -l "$PG_LOG" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='$TMP'" >/dev/null
# Ca in productie: postgres NOSUPERUSER, istoricul in supabase_migrations, rolurile API pentru gate-ul 0e.
"${ADMIN[@]}" -d postgres -c 'CREATE ROLE postgres LOGIN CREATEROLE NOSUPERUSER' \
  -c 'CREATE ROLE anon NOLOGIN' -c 'CREATE ROLE authenticated NOLOGIN' -c "CREATE DATABASE $DB OWNER postgres" >/dev/null
"${ADMIN[@]}" -d "$DB" -c 'CREATE SCHEMA supabase_migrations AUTHORIZATION postgres' \
  -c 'CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text)' \
  -c 'ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres' \
  -c 'GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO postgres' >/dev/null
SIS="$(q 'SELECT system_identifier FROM pg_control_system()')"
[[ "$(q 'SELECT rolsuper FROM pg_roles WHERE rolname=current_user')" == f ]] || fail 'postgres trebuie sa fie NOSUPERUSER'

mkdir "$TMP/mig"
migrare() { # $1 numele, $2 starea asteptata a transaction_timeout in tranzactie ('' = nu se verifica), $3 SQL suplimentar
  local f="$TMP/mig/$1.sql"
  {
    printf "DO \$g\$ BEGIN\n  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '%s:' || txid_current() THEN\n    RAISE EXCEPTION 'PLAFON_RUNNER_REQUIRED'; END IF;\n" "$1"
    [[ -z "$2" ]] || printf "  IF (SELECT setting || '/' || source FROM pg_settings WHERE name = 'transaction_timeout') IS DISTINCT FROM '%s' THEN\n    RAISE EXCEPTION 'PLAFON_STARE: %%', (SELECT setting || '/' || source FROM pg_settings WHERE name = 'transaction_timeout'); END IF;\n" "$2"
    printf "END \$g\$;\n%s\nCREATE TABLE public.t_%s (id integer);\n" "$3" "$1"
  } >"$f"
  echo "$f"
}
runner() { # $1 versiunea, $2 fisierul, restul = optiuni suplimentare
  local sha; sha="$(sha256sum "$2" | cut -d' ' -f1)"
  PSQL_BIN="${PSQL_BIN_TEST:-$PG_BIN/psql}" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$2" --sha256 "$sha" \
    --versiune "$1" --tinta-db "$DB" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres "${@:3}"
}
stare() { # tabelul creat? | inregistrat?
  q "SELECT (to_regclass('public.t_$1') IS NOT NULL)::text || '|' || EXISTS (SELECT FROM supabase_migrations.schema_migrations WHERE name = '$1')::text"
}
asteapta() { # $1 eticheta, $2 codul asteptat, $3 jurnalul, restul = comanda
  local et="$1" exp="$2" log="$3" rc=0
  shift 3
  "$@" >"$log" 2>&1 || rc=$?
  [[ "$rc" == "$exp" ]] || { cat "$log"; fail "$et: cod $rc, asteptat $exp"; }
}

# 1. Argumente: refuz inainte de orice conexiune (cod 2).
M_OK="$(migrare 20990101a_plafon_ok '1500/client' '')"
for v in abc 050 99 600001 1500ms; do
  asteapta "argument $v" 2 "$TMP/arg_$v.log" runner 20990101000001 "$M_OK" --plafon-tranzactie-ms "$v"
  grep -q 'plafon-tranzactie-ms invalid' "$TMP/arg_$v.log" || { cat "$TMP/arg_$v.log"; fail "argument $v: mesaj"; }
done
asteapta 'PGOPTIONS din mediu' 2 "$TMP/arg_env.log" env PGOPTIONS='-c transaction_timeout=1500' PSQL_BIN="$PG_BIN/psql" \
  bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$M_OK" --sha256 "$(sha256sum "$M_OK" | cut -d' ' -f1)" \
  --versiune 20990101000001 --tinta-db "$DB" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" \
  --user postgres --plafon-tranzactie-ms 1500
grep -q 'variabila PGOPTIONS e setată' "$TMP/arg_env.log" || { cat "$TMP/arg_env.log"; fail 'PGOPTIONS din mediu: mesaj'; }
[[ "$(stare 20990101a_plafon_ok)" == 'false|false' ]] || fail 'argumente: ceva a fost aplicat'
echo 'PLAFON_ARG: valori invalide (abc, 050, 99, 600001, 1500ms) si PGOPTIONS din mediu => refuz 2, fara conexiune'

# 2. Cu plafon: valoarea exacta din conexiune, sursa client, in tranzactia livrarii.
asteapta ok 0 "$TMP/ok.log" runner 20990101000001 "$M_OK" --plafon-tranzactie-ms 1500
[[ "$(stare 20990101a_plafon_ok)" == 'true|true' ]] || fail 'ok: neaplicat'
grep -q 'plafon 1500 ms de la BEGIN' "$TMP/ok.log" || { cat "$TMP/ok.log"; fail 'ok: runnerul nu anunta plafonul'; }
echo 'PLAFON_OK: in tranzactie transaction_timeout = 1500/client; APLICAT + INREGISTRAT (0)'

# 3. O setare a rolului (ca ALTER ROLE ... SET pe productie) nu poate schimba plafonul: parametrul de pornire are prioritate.
"${ADMIN[@]}" -d "$DB" -c "ALTER ROLE postgres SET transaction_timeout = '10s'" >/dev/null
[[ "$(q "SELECT setting || '/' || source FROM pg_settings WHERE name = 'transaction_timeout'")" == '10000/user' ]] || fail 'rol: setarea rolului nu s-a aplicat'
M_ROL="$(migrare 20990101b_plafon_rol '1500/client' '')"
asteapta rol 0 "$TMP/rol.log" runner 20990101000002 "$M_ROL" --plafon-tranzactie-ms 1500
"${ADMIN[@]}" -d "$DB" -c 'ALTER ROLE postgres RESET transaction_timeout' >/dev/null
[[ "$(stare 20990101b_plafon_rol)" == 'true|true' ]] || fail 'rol: neaplicat'
echo 'PLAFON_ROL: rolul are 10 s (10000/user); livrarea vede 1500/client; APLICAT (0)'

# 4. Migrare lenta: inchisa de server la ~1 s de la BEGIN, nimic ramas.
M_LENT="$(migrare 20990101c_plafon_lent '1000/client' 'SELECT pg_sleep(3);')"
n0="$(grep -c 'terminating connection due to transaction timeout' "$PG_LOG" || true)"
t0="$(date +%s%N)"
asteapta lent 10 "$TMP/lent.log" runner 20990101000003 "$M_LENT" --plafon-tranzactie-ms 1000
ms=$(( ($(date +%s%N) - t0) / 1000000 ))
n1="$(grep -c 'terminating connection due to transaction timeout' "$PG_LOG" || true)"
(( n1 == n0 + 1 )) || { cat "$TMP/lent.log"; fail "lent: jurnalul serverului nu arata inchiderea prin transaction timeout ($n0 -> $n1)"; }
[[ "$(stare 20990101c_plafon_lent)" == 'false|false' ]] || fail 'lent: au ramas efecte'
(( ms < 3000 )) || fail "lent: runnerul a durat $ms ms (migrarea trebuia oprita la ~1 s, nu dupa pg_sleep(3))"
grep -q 'NEAPLICAT confirmat' "$TMP/lent.log" || { cat "$TMP/lent.log"; fail 'lent: reconcilierea'; }
echo "PLAFON_LENT: migrare de 3 s cu plafon 1000 ms => sesiune inchisa de server (transaction timeout), NEAPLICAT confirmat (10), nimic creat / inregistrat; runner $ms ms in total"

# 5. Parametrul de pornire pierdut pe drum (ca un pooler care il ignora) => prologul refuza, nimic din migrare.
printf '#!/usr/bin/env bash\nunset PGOPTIONS\nexec "%s/psql" "$@"\n' "$PG_BIN" >"$TMP/psql_fara_optiuni"
chmod +x "$TMP/psql_fara_optiuni"
M_POOL="$(migrare 20990101d_plafon_pooler '' '')"
PSQL_BIN_TEST="$TMP/psql_fara_optiuni" asteapta pooler 10 "$TMP/pooler.log" runner 20990101000004 "$M_POOL" --plafon-tranzactie-ms 1500
grep -q 'plafonul tranzactiei nu e 1500 ms din conexiune (0/default)' "$TMP/pooler.log" || { cat "$TMP/pooler.log"; fail 'pooler: mesajul prologului'; }
[[ "$(stare 20990101d_plafon_pooler)" == 'false|false' ]] || fail 'pooler: au ramas efecte'
echo 'PLAFON_POOLER: parametrul de pornire pierdut => prologul refuza (0/default), NEAPLICAT (10), nimic creat'

# 6. Fara optiune: neschimbat fata de runda 9.
M_FARA="$(migrare 20990101e_plafon_fara '0/default' '')"
asteapta fara 0 "$TMP/fara.log" runner 20990101000005 "$M_FARA"
[[ "$(stare 20990101e_plafon_fara)" == 'true|true' ]] || fail 'fara: neaplicat'
! grep -q 'plafon .* ms de la BEGIN' "$TMP/fara.log" || fail 'fara: runnerul anunta un plafon necerut'
echo 'PLAFON_FARA: fara optiune => transaction_timeout 0/default (ca inainte); APLICAT (0)'
echo "PASS LIVRARE_PLAFON runda 10 PG17 (postgres NOSUPERUSER): plafonul din conexiune, de la BEGIN, verificat in prolog; copie/log: $TMP"
