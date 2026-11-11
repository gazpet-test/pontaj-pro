#!/usr/bin/env bash
# Runda 10/11 a runnerului (PR #892 r12/r14, PR #1054): proba lui scripts/livrare_migrare.sh --plafon-tranzactie-ms pe
# un cluster PostgreSQL 17 NOU, efemer: doar 127.0.0.1, port 6790 + slot (verificat liber), director nou in /tmp. Nu
# atinge nicio alta baza si nu sterge nimic in afara directorului propriu.
#   Linux / WSL, ca utilizatorul postgres (initdb refuza root):
#     wsl -d Ubuntu-24.04 -u postgres -- bash /mnt/c/.../scripts/test_livrare_plafon.sh <slot 0-9>
#   PG_BIN = binarele PG17 (implicit /usr/lib/postgresql/17/bin).
# Runda 11: plafonul = SET transaction_timeout DE SESIUNE inainte de BEGIN, pe aceeasi conexiune (pooler-ul Supabase nu
# transmite optiunile de conectare). Ce dovedeste (fiecare caz cu prag care pica testul):
#   argumente:  valori invalide / PGOPTIONS din mediu => refuz 2, fara conexiune;
#   ok:         cu --plafon-tranzactie-ms 1500, in tranzactie transaction_timeout = 1500/session + marcajul plafonului
#               => aplicat (0);
#   rol:        ALTER ROLE ... SET transaction_timeout = '10s' nu schimba nimic: tot 1500/session => aplicat (0);
#   lent:       migrare de 3 s cu plafon 1000 => serverul inchide sesiunea la ~1 s de la BEGIN, NEAPLICAT (10), nimic
#               creat / inregistrat, linie noua „transaction timeout” in jurnalul serverului;
#   pooler:     un client care PIERDE optiunile de conectare (ca pooler-ul) nu schimba nimic: SET-ul e instructiune
#               => aplicat (0), 1500/session (designul runda 10 ar fi refuzat aici: 0/default);
#   umbrire:    SET-ul pierdut + un pg_temp.pg_settings fals (1500/session) in aceeasi sesiune => prologul citeste
#               pg_catalog.pg_settings (0/default) => refuz, NEAPLICAT (10); citirea necalificata ar fi vazut falsul;
#   validator:  mutantul Jakarinos r13 (SET LOCAL transaction_timeout = 0; SELECT pg_sleep(3)) cu plafon => refuz 3,
#               fara conexiune; FARA plafon acelasi artefact => aplicat (0), ca inainte;
#   garda:      ceasul oprit prin SQL dinamic (invizibil static) => garda finala: valoare schimbata (PLAFON_SCHIMBAT) sau
#               timp > plafon de la BEGIN (PLAFON_DEPASIT) => NEAPLICAT (10), nimic creat;
#   fara:       fara optiune => comportamentul vechi (psql --single-transaction, 0/default) => aplicat (0).
# Runda 12 (Jakarinos r14 P2): termenul tine pana la COMMIT. Garda finala si COMMIT-ul sunt UN mesaj; fiecare caz are si
# un CONTROL (forma r11 / fara golirea triggerelor amanate / fara optiune) care arata ca scenariul chiar comitea dupa termen:
#   rearmare:   N=2000, ceas oprit prin SQL dinamic si repornit la ~1,5 s + pauza client 1 s chiar inaintea liniei COMMIT
#               => control (garda si COMMIT separate) COMITE (0); forma livrata => pauza cade inaintea garzii =>
#               PLAFON_DEPASIT, NEAPLICAT (10), fara inchidere de catre server;
#   functie:    la fel, cu o functie EXISTENTA cu SET transaction_timeout = 0 apelata de artefact (validatorul n-o vede);
#   amanat:     trigger DEFERRABLE INITIALLY DEFERRED (ceas oprit, 1,5 s, repornit; N=1000) => control fara
#               SET CONSTRAINTS ALL IMMEDIATE il ruleaza in COMMIT, dupa garda, si COMITE (0); forma livrata il ruleaza
#               inaintea garzii => PLAFON_DEPASIT (10);
#   cursor:     cursor WITH HOLD deschis => fara optiune se executa la COMMIT (>= 1,5 s, control 0); cu plafon
#               PLAFON_CURSOR (10).
# Forma mesajelor (fara PostgreSQL): scripts/test_livrare_forma_fin.sh.
# Runda 13 (harness r15): cazurile cu timpi (lent, garda timp, 8b-8e) ruleaza prin asteapta_ceas: un salt al ceasului de
# perete >= 100 ms in timpul cazului il face NEVALID (in ambele sensuri), se curata si se repeta (cel mult 3 ori).
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

# Citirea plafonului = forma exacta permisa de validator cu --plafon-tranzactie (schema calificata).
CIT="(SELECT setting || '/' || source FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout')"
mkdir "$TMP/mig"
migrare() { # $1 numele, $2 starea asteptata a transaction_timeout in tranzactie ('' = nu se verifica), $3 SQL suplimentar
  # Cu „N/session” se cere si marcajul plafonului pus de prologul runnerului ('N:' || txid), ca in migrarile portalului.
  local f="$TMP/mig/$1.sql"
  {
    printf "DO \$g\$ BEGIN\n  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '%s:' || txid_current() THEN\n    RAISE EXCEPTION 'PLAFON_RUNNER_REQUIRED'; END IF;\n" "$1"
    [[ -z "$2" ]] || printf "  IF %s IS DISTINCT FROM '%s' THEN\n    RAISE EXCEPTION 'PLAFON_STARE: %%', %s; END IF;\n" "$CIT" "$2" "$CIT"
    [[ "$2" != */session ]] || printf "  IF current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '%s:' || txid_current() THEN\n    RAISE EXCEPTION 'PLAFON_MARCAJ_LIPSA'; END IF;\n" "${2%/session}"
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
inchideri() { grep -c 'terminating connection due to transaction timeout' "$PG_LOG" || true; }

# Runda 13 (harness r15): ceasul de perete al WSL sare (syslog „Clock change detected”, ~1,2 s). Timeout-urile PostgreSQL
# si garda finala (clock_timestamp() - transaction_timestamp()) masoara pe ceasul de perete => un salt in timpul unui caz
# cu timpi il falsifica IN AMBELE SENSURI: un salt inainte inchide sesiunea mai devreme (r15: controlul de rearmare a fost
# inchis la 0,6 s dupa saltul de la 20:02:28) sau umfla timpul vazut de garda (refuz „corect” din motiv gresit).
# Regula (ca in harness, scripts/portal/concurrency_lock.sh r13): cazul cu |perete - monoton| >= 100 ms e NEVALID oricare
# i-ar fi rezultatul => se curata ce a lasat si se repeta, de cel mult 3 ori; altfel testul pica cu motivul exact.
SALT_MS=100; CAZ_INCERCARI=3; CEAS_REPETARI=0
ceas_mono_ms() {
  local u=''
  if [[ -r /proc/uptime ]] && read -r u _ </proc/uptime && [[ "$u" =~ ^[0-9]+\.[0-9]{2}$ ]]; then echo $(( 10#${u/./} * 10 )); return 0; fi
  python3 -c 'import time; print(int(time.monotonic() * 1000))'
}
# asteapta_ceas <eticheta> <cod> <jurnal> <SQL de curatare a unei incercari nevalide> -- comanda...
# Seteaza CAZ_N0 (inchiderile din jurnalul serverului la inceputul incercarii VALIDE), CAZ_MS (durata ei) si CAZ_SALT.
asteapta_ceas() {
  local et="$1" exp="$2" log="$3" cur="$4" k rc r0 m0 r1 m1
  shift 4; [[ "$1" == -- ]] && shift
  for ((k=1;k<=CAZ_INCERCARI;k++)); do
    rm -f "$TMP"/pauza_* "$TMP/fara_amanate_aplicat"
    CAZ_N0="$(inchideri)"; rc=0
    r0="$(date +%s%3N)"; m0="$(ceas_mono_ms)"
    "$@" >"$log" 2>&1 || rc=$?
    r1="$(date +%s%3N)"; m1="$(ceas_mono_ms)"
    CAZ_MS=$(( r1 - r0 )); CAZ_SALT=$(( (r1 - r0) - (m1 - m0) ))
    if (( CAZ_SALT < SALT_MS && CAZ_SALT > -SALT_MS )); then
      [[ "$rc" == "$exp" ]] || { cat "$log"; fail "$et: cod $rc, asteptat $exp (ceas stabil, abatere $CAZ_SALT ms; incercarea $k)"; }
      (( k == 1 )) || echo "CEAS_REPETAT $et: valid la incercarea $k (abatere $CAZ_SALT ms)"
      return 0
    fi
    CEAS_REPETARI=$((CEAS_REPETARI + 1))
    echo "CEAS_SALT $et incercarea $k: ceasul de perete s-a abatut cu $CAZ_SALT ms fata de cel monoton (cod $rc, asteptat $exp) => NEVALID, se curata si se repeta"
    [[ -z "$cur" ]] || "${ADMIN[@]}" -d "$DB" -c "$cur" >/dev/null
  done
  fail "$et: NEVALID de $CAZ_INCERCARI ori (ceasul de perete a sarit in fiecare incercare), de rerulat"
}
curata() { # SQL de curatare pentru migrarea de test $1 (tabelul ei + randul din istoric) + obiecte suplimentare ($2)
  printf "DROP TABLE IF EXISTS public.t_%s; DELETE FROM supabase_migrations.schema_migrations WHERE name = '%s'; %s" "$1" "$1" "${2:-}"
}

# 1. Argumente: refuz inainte de orice conexiune (cod 2).
M_OK="$(migrare 20990101a_plafon_ok '1500/session' '')"
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

# 2. Cu plafon: SET de sesiune inainte de BEGIN => in tranzactie 1500/session + marcajul plafonului.
asteapta ok 0 "$TMP/ok.log" runner 20990101000001 "$M_OK" --plafon-tranzactie-ms 1500
[[ "$(stare 20990101a_plafon_ok)" == 'true|true' ]] || fail 'ok: neaplicat'
grep -q 'plafon ~1500 ms de la BEGIN' "$TMP/ok.log" || { cat "$TMP/ok.log"; fail 'ok: runnerul nu anunta plafonul'; }
[[ "$(q "$CIT")" == '0/default' ]] || fail 'ok: o conexiune noua vede alt transaction_timeout (setarea runnerului a ramas?)'
echo 'PLAFON_OK: in tranzactie transaction_timeout = 1500/session + marcajul plafonului; APLICAT + INREGISTRAT (0)'

# 3. O setare a rolului (ca ALTER ROLE ... SET pe productie) nu poate schimba plafonul: SET-ul de sesiune are prioritate.
"${ADMIN[@]}" -d "$DB" -c "ALTER ROLE postgres SET transaction_timeout = '10s'" >/dev/null
[[ "$(q "$CIT")" == '10000/user' ]] || fail 'rol: setarea rolului nu s-a aplicat'
M_ROL="$(migrare 20990101b_plafon_rol '1500/session' '')"
asteapta rol 0 "$TMP/rol.log" runner 20990101000002 "$M_ROL" --plafon-tranzactie-ms 1500
"${ADMIN[@]}" -d "$DB" -c 'ALTER ROLE postgres RESET transaction_timeout' >/dev/null
[[ "$(stare 20990101b_plafon_rol)" == 'true|true' ]] || fail 'rol: neaplicat'
echo 'PLAFON_ROL: rolul are 10 s (10000/user); livrarea vede 1500/session; APLICAT (0)'

# 4. Migrare lenta: inchisa de server la ~1 s de la BEGIN, nimic ramas.
M_LENT="$(migrare 20990101c_plafon_lent '1000/session' 'SELECT pg_sleep(3);')"
asteapta_ceas lent 10 "$TMP/lent.log" "$(curata 20990101c_plafon_lent)" -- runner 20990101000003 "$M_LENT" --plafon-tranzactie-ms 1000
n0="$CAZ_N0"; ms="$CAZ_MS"; n1="$(inchideri)"
(( n1 == n0 + 1 )) || { cat "$TMP/lent.log"; fail "lent: jurnalul serverului nu arata inchiderea prin transaction timeout ($n0 -> $n1)"; }
[[ "$(stare 20990101c_plafon_lent)" == 'false|false' ]] || fail 'lent: au ramas efecte'
(( ms < 3000 )) || fail "lent: runnerul a durat $ms ms (migrarea trebuia oprita la ~1 s, nu dupa pg_sleep(3))"
grep -q 'NEAPLICAT confirmat' "$TMP/lent.log" || { cat "$TMP/lent.log"; fail 'lent: reconcilierea'; }
echo "PLAFON_LENT: migrare de 3 s cu plafon 1000 ms => sesiune inchisa de server (transaction timeout), NEAPLICAT confirmat (10), nimic creat / inregistrat; runner $ms ms in total"

# 5. Pooler simulat: clientul pierde optiunile de conectare (PGOPTIONS / options). Runnerul nu se bazeaza pe ele.
printf '#!/usr/bin/env bash\nunset PGOPTIONS\ntouch "%s/pooler_folosit"\nexec "%s/psql" "$@"\n' "$TMP" "$PG_BIN" >"$TMP/psql_fara_optiuni"
chmod +x "$TMP/psql_fara_optiuni"
M_POOL="$(migrare 20990101d_plafon_pooler '1500/session' '')"
PSQL_BIN_TEST="$TMP/psql_fara_optiuni" asteapta pooler 0 "$TMP/pooler.log" runner 20990101000004 "$M_POOL" --plafon-tranzactie-ms 1500
[[ -e "$TMP/pooler_folosit" && "$(stare 20990101d_plafon_pooler)" == 'true|true' ]] || fail 'pooler: neaplicat prin clientul fara optiuni'
echo 'PLAFON_POOLER: client care pierde optiunile de conectare => SET-ul de sesiune ajunge, 1500/session; APLICAT (0)'

# 6. Umbrire: SET-ul runnerului pierdut + pg_temp.pg_settings fals in aceeasi sesiune => prologul (calificat) refuza.
cat >"$TMP/psql_umbrire" <<EOF
#!/usr/bin/env bash
# Inlocuieste DOAR fisierul 00_sesiune.sql (SET + BEGIN) cu: tabel temporar fals pg_settings (1500/session) + dovada ca o
# citire NECALIFICATA vede falsul (ambele inainte de BEGIN, in aceeasi sesiune) + BEGIN. Restul apelurilor
# (pre-verificare, reconciliere) trec neschimbate.
a=()
while [ \$# -gt 0 ]; do
  if [ "\$1" = -f ] && [[ "\${2:-}" == */00_sesiune.sql ]]; then
    a+=(-c "CREATE TEMP TABLE pg_settings AS SELECT 'transaction_timeout'::text AS name, '1500'::text AS setting, 'session'::text AS source"
        -c "DO \\\$u\\\$ BEGIN IF (SELECT setting || '/' || source FROM pg_settings WHERE name = 'transaction_timeout') IS DISTINCT FROM '1500/session' THEN RAISE EXCEPTION 'UMBRIRE_NEFUNCTIONALA'; END IF; END \\\$u\\\$"
        -c BEGIN)
    touch "$TMP/umbrire_aplicata"; shift 2; continue
  fi
  a+=("\$1"); shift
done
exec "$PG_BIN/psql" "\${a[@]}"
EOF
chmod +x "$TMP/psql_umbrire"
M_UMB="$(migrare 20990101f_plafon_umbrire '1500/session' '')"
PSQL_BIN_TEST="$TMP/psql_umbrire" asteapta umbrire 10 "$TMP/umbrire.log" runner 20990101000006 "$M_UMB" --plafon-tranzactie-ms 1500
[[ -e "$TMP/umbrire_aplicata" ]] || fail 'umbrire: substitutia nu s-a aplicat (proba nefunctionala)'
! grep -q UMBRIRE_NEFUNCTIONALA "$TMP/umbrire.log" || { cat "$TMP/umbrire.log"; fail 'umbrire: tabelul temporar nu umbreste citirea necalificata (proba nefunctionala)'; }
grep -q 'plafonul tranzactiei nu e 1500 ms pus de runner inainte de BEGIN (0/default)' "$TMP/umbrire.log" \
  || { cat "$TMP/umbrire.log"; fail 'umbrire: prologul trebuia sa refuze cu 0/default (valoarea reala)'; }
[[ "$(stare 20990101f_plafon_umbrire)" == 'false|false' ]] || fail 'umbrire: au ramas efecte'
echo 'PLAFON_UMBRIRE: SET pierdut + pg_temp.pg_settings fals (1500/session, vazut de citirea necalificata) => prologul citeste pg_catalog.pg_settings (0/default) => refuz, NEAPLICAT (10)'

# 7. Validatorul (Jakarinos r13 P2): cu plafon, artefactul nu poate opri ceasul; fara plafon, regulile vechi.
M_MUT="$(migrare 20990101g_plafon_mutant '' 'SET LOCAL transaction_timeout = 0;
SELECT pg_sleep(3);')"
asteapta 'validator mutant' 3 "$TMP/mutant.log" runner 20990101000007 "$M_MUT" --plafon-tranzactie-ms 1000
grep -q 'validatorul a refuzat' "$TMP/mutant.log" && grep -q 'transaction_timeout' "$TMP/mutant.log" \
  || { cat "$TMP/mutant.log"; fail 'validator mutant: mesajul'; }
[[ "$(stare 20990101g_plafon_mutant)" == 'false|false' ]] || fail 'validator mutant: ceva a fost aplicat'
asteapta 'validator fara plafon' 0 "$TMP/mutant_fara.log" runner 20990101000008 "$M_MUT"
[[ "$(stare 20990101g_plafon_mutant)" == 'true|true' ]] || fail 'validator fara plafon: neaplicat (regulile vechi s-au schimbat)'
echo 'PLAFON_VALIDATOR: SET LOCAL transaction_timeout = 0 + pg_sleep(3) cu plafon => refuz 3, fara conexiune; fara plafon => APLICAT (0), ca inainte'

# 8. Garda finala: ceasul oprit prin SQL dinamic (numele construit cu chr(95) — validatorul nu-l poate vedea).
DIN="'transaction' || chr(95) || 'timeout'"
M_SCH="$(migrare 20990101h_plafon_schimbat '1000/session' "DO \$d\$ BEGIN EXECUTE format('SET LOCAL %s = 0', $DIN); END \$d\$;")"
asteapta 'garda valoare' 10 "$TMP/garda_val.log" runner 20990101000009 "$M_SCH" --plafon-tranzactie-ms 1000
grep -q 'PLAFON_SCHIMBAT in tranzactie (0/session' "$TMP/garda_val.log" || { cat "$TMP/garda_val.log"; fail 'garda valoare: mesajul'; }
[[ "$(stare 20990101h_plafon_schimbat)" == 'false|false' ]] || fail 'garda valoare: au ramas efecte'
M_DEP="$(migrare 20990101i_plafon_depasit '1000/session' "DO \$d\$ BEGIN EXECUTE format('SET LOCAL %s = 0', $DIN); PERFORM pg_sleep(1.5);
  EXECUTE format('SET LOCAL %s = %s', $DIN, '1000'); END \$d\$;")"
asteapta_ceas 'garda timp' 10 "$TMP/garda_timp.log" "$(curata 20990101i_plafon_depasit)" -- runner 20990101000010 "$M_DEP" --plafon-tranzactie-ms 1000
n0="$CAZ_N0"; ms="$CAZ_MS"; n1="$(inchideri)"
grep -q 'PLAFON_DEPASIT: [0-9]* ms de la BEGIN > 1000 ms' "$TMP/garda_timp.log" || { cat "$TMP/garda_timp.log"; fail 'garda timp: mesajul'; }
(( n1 == n0 )) || fail 'garda timp: sesiunea trebuia refuzata de garda, nu inchisa de server'
[[ "$(stare 20990101i_plafon_depasit)" == 'false|false' ]] || fail 'garda timp: au ramas efecte'
echo "PLAFON_GARDA: ceas oprit prin SQL dinamic => garda finala: 0/session (PLAFON_SCHIMBAT) / 1,5 s > 1000 ms de la BEGIN (PLAFON_DEPASIT) => NEAPLICAT (10), nimic creat; runner $ms ms"

# 8b-8e. Runda 12 (Jakarinos r14 P2): termenul trebuie sa tina pana la COMMIT. Clientul de test PSQL_PAUZA face o pauza de
# 1 s chiar inaintea liniei „COMMIT;” din 9_fin.sql (o pauza client / retea in cel mai rau loc). PAUZA_MOD=despartit =
# CONTROL: „\;” de la capat de rand devine „;” => garda si COMMIT-ul ajung mesaje separate (forma r11), ca proba sa arate
# ca scenariul chiar comitea dupa termen.
cat >"$TMP/psql_pauza" <<'EOF'
#!/usr/bin/env bash
# Inlocuieste DOAR -f .../9_fin.sql cu o copie: (optional) mesajul despartit, apoi „\! sleep 1” chiar inaintea liniei
# „COMMIT;” (exact o data, altfel nu scrie marcajul => proba nefunctionala). Restul apelurilor neschimbate.
set -euo pipefail
a=()
while [ $# -gt 0 ]; do
  if [ "$1" = -f ] && [[ "${2:-}" == */9_fin.sql ]]; then
    c="$PAUZA_DIR/9_fin_pauza_$$.sql"
    if [ "${PAUZA_MOD:-}" = despartit ]; then sed 's/ \\;$/;/' "$2"; else cat "$2"; fi | awk '/^COMMIT;$/ { print "\\! sleep 1"; n++ } { print } END { exit (n == 1 ? 0 : 7) }' >"$c"
    touch "$PAUZA_DIR/pauza_${PAUZA_MOD:-unic}"
    a+=(-f "$c"); shift 2; continue
  fi
  a+=("$1"); shift
done
exec "$PAUZA_PG_BIN/psql" "${a[@]}"
EOF
chmod +x "$TMP/psql_pauza"
pauza() { # $1 modul ('' = forma livrata), restul = argumentele runner()
  local mod="$1"; shift
  PAUZA_DIR="$TMP" PAUZA_PG_BIN="$PG_BIN" PAUZA_MOD="$mod" PSQL_BIN_TEST="$TMP/psql_pauza" runner "$@"
}
# 8b. Mutantul din verdict: N=2000, artefactul opreste ceasul prin SQL dinamic si il reporneste la ~1,5 s (ceas NOU de
#     2 s, expira la ~3,5 s), garda la ~1,6 s, pauza 1 s, COMMIT.
REARM="DO \$d\$ BEGIN EXECUTE format('SET LOCAL %s = 0', $DIN); PERFORM pg_sleep(1.5);
  EXECUTE format('SET LOCAL %s = %s', $DIN, '2000'); END \$d\$;"
M_RC="$(migrare 20990101j_plafon_rearm_ctl '2000/session' "$REARM")"
asteapta_ceas 'rearmare control' 0 "$TMP/rearm_ctl.log" "$(curata 20990101j_plafon_rearm_ctl)" -- pauza despartit 20990101000011 "$M_RC" --plafon-tranzactie-ms 2000
[[ -e "$TMP/pauza_despartit" && "$(stare 20990101j_plafon_rearm_ctl)" == 'true|true' ]] \
  || { cat "$TMP/rearm_ctl.log"; fail 'rearmare control: forma r11 + pauza trebuia sa comita dupa termen (proba nefunctionala)'; }
M_RM="$(migrare 20990101k_plafon_rearm '2000/session' "$REARM")"
asteapta_ceas rearmare 10 "$TMP/rearm.log" "$(curata 20990101k_plafon_rearm)" -- pauza '' 20990101000012 "$M_RM" --plafon-tranzactie-ms 2000
n0="$CAZ_N0"
[[ -e "$TMP/pauza_unic" ]] || fail 'rearmare: pauza nu s-a aplicat (proba nefunctionala)'
grep -q 'PLAFON_DEPASIT: [0-9]* ms de la BEGIN > 2000 ms' "$TMP/rearm.log" || { cat "$TMP/rearm.log"; fail 'rearmare: garda trebuia sa refuze (pauza inaintea mesajului final)'; }
(( "$(inchideri)" == n0 )) || fail 'rearmare: trebuia refuzata de garda, nu inchisa de server'
[[ "$(stare 20990101k_plafon_rearm)" == 'false|false' ]] || fail 'rearmare: au ramas efecte'
echo 'PLAFON_REARMARE: ceas oprit prin SQL dinamic si repornit la ~1,5 s (N=2000) + pauza client 1 s inaintea COMMIT => forma r11 (garda si COMMIT separate) COMITEA (control, 0); forma r12 (un mesaj) => pauza cade inaintea garzii => PLAFON_DEPASIT, NEAPLICAT (10), nimic comis'

# 8c. Functie EXISTENTA cu SET transaction_timeout = 0 (la iesire valoarea restaurata porneste un ceas nou), apelata de
#     artefact (validatorul nu o vede); aceeasi pauza.
q "CREATE FUNCTION public.f_dormi_plafon() RETURNS void LANGUAGE plpgsql SET transaction_timeout = 0 AS \$f\$ BEGIN PERFORM pg_sleep(1.5); END \$f\$" >/dev/null
M_FC="$(migrare 20990101l_plafon_functie_ctl '2000/session' 'SELECT public.f_dormi_plafon();')"
asteapta_ceas 'functie control' 0 "$TMP/functie_ctl.log" "$(curata 20990101l_plafon_functie_ctl)" -- pauza despartit 20990101000013 "$M_FC" --plafon-tranzactie-ms 2000
[[ "$(stare 20990101l_plafon_functie_ctl)" == 'true|true' ]] \
  || { cat "$TMP/functie_ctl.log"; fail 'functie control: forma r11 + pauza trebuia sa comita dupa termen (proba nefunctionala)'; }
M_FN="$(migrare 20990101m_plafon_functie '2000/session' 'SELECT public.f_dormi_plafon();')"
asteapta_ceas functie 10 "$TMP/functie.log" "$(curata 20990101m_plafon_functie)" -- pauza '' 20990101000014 "$M_FN" --plafon-tranzactie-ms 2000
n0="$CAZ_N0"
grep -q 'PLAFON_DEPASIT: [0-9]* ms de la BEGIN > 2000 ms' "$TMP/functie.log" || { cat "$TMP/functie.log"; fail 'functie: garda trebuia sa refuze'; }
(( "$(inchideri)" == n0 )) || fail 'functie: trebuia refuzata de garda, nu inchisa de server'
[[ "$(stare 20990101m_plafon_functie)" == 'false|false' ]] || fail 'functie: au ramas efecte'
echo 'PLAFON_FUNCTIE: functie existenta cu SET transaction_timeout = 0 (1,5 s) + pauza 1 s => forma r11 COMITEA (control, 0); forma r12 => PLAFON_DEPASIT, NEAPLICAT (10)'

# r16b: functia de trigger a probei scrie un GUC prin SQL dinamic; fara REVOKE FROM PUBLIC, gate-ul 0e al runnerului o
#     semnaleaza (cod 30) dupa comitere si controlul pica din alt motiv decat cel probat.
# 8d. Trigger AMANAT (DEFERRABLE INITIALLY DEFERRED) care opreste ceasul, doarme 1,5 s si il reporneste: fara
#     SET CONSTRAINTS ALL IMMEDIATE ar rula IN COMMIT, dupa garda (control, fara pauza); cu el ruleaza inaintea garzii.
amanat() { # $1 sufixul tabelului
  printf '%s\n' "CREATE TABLE public.a_$1 (id integer);" \
    "CREATE FUNCTION public.fa_$1() RETURNS trigger LANGUAGE plpgsql AS \$f\$ BEGIN EXECUTE format('SET LOCAL %s = 0', $DIN); PERFORM pg_sleep(1.5); EXECUTE format('SET LOCAL %s = %s', $DIN, '1000'); RETURN NULL; END \$f\$;" \
    "REVOKE EXECUTE ON FUNCTION public.fa_$1() FROM PUBLIC;" \
    "CREATE CONSTRAINT TRIGGER ta_$1 AFTER INSERT ON public.a_$1 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fa_$1();" \
    "INSERT INTO public.a_$1 VALUES (1);"
}
cat >"$TMP/psql_fara_amanate" <<'EOF'
#!/usr/bin/env bash
# CONTROL: 9_fin.sql fara SET CONSTRAINTS ALL IMMEDIATE (triggerele amanate raman pentru COMMIT). Restul neschimbat.
set -euo pipefail
a=()
while [ $# -gt 0 ]; do
  if [ "$1" = -f ] && [[ "${2:-}" == */9_fin.sql ]]; then
    c="$PAUZA_DIR/9_fin_fara_amanate_$$.sql"
    grep -v '^SET CONSTRAINTS ALL IMMEDIATE' "$2" >"$c"
    touch "$PAUZA_DIR/fara_amanate_aplicat"
    a+=(-f "$c"); shift 2; continue
  fi
  a+=("$1"); shift
done
exec "$PAUZA_PG_BIN/psql" "${a[@]}"
EOF
chmod +x "$TMP/psql_fara_amanate"
M_AC="$(migrare 20990101n_plafon_amanat_ctl '1000/session' "$(amanat ctl)")"
PAUZA_DIR="$TMP" PAUZA_PG_BIN="$PG_BIN" PSQL_BIN_TEST="$TMP/psql_fara_amanate" \
  asteapta_ceas 'amanat control' 0 "$TMP/amanat_ctl.log" \
  "$(curata 20990101n_plafon_amanat_ctl 'DROP TABLE IF EXISTS public.a_ctl; DROP FUNCTION IF EXISTS public.fa_ctl();')" \
  -- runner 20990101000015 "$M_AC" --plafon-tranzactie-ms 1000
ms="$CAZ_MS"
[[ -e "$TMP/fara_amanate_aplicat" && "$(stare 20990101n_plafon_amanat_ctl)" == 'true|true' ]] \
  || { cat "$TMP/amanat_ctl.log"; fail 'amanat control: triggerul amanat din COMMIT trebuia sa treaca de garda (proba nefunctionala)'; }
[[ "$(q 'SELECT count(*) FROM public.a_ctl')" == 1 ]] || fail 'amanat control: randul lipseste'
M_AM="$(migrare 20990101o_plafon_amanat '1000/session' "$(amanat liv)")"
asteapta_ceas amanat 10 "$TMP/amanat.log" \
  "$(curata 20990101o_plafon_amanat 'DROP TABLE IF EXISTS public.a_liv; DROP FUNCTION IF EXISTS public.fa_liv();')" \
  -- runner 20990101000016 "$M_AM" --plafon-tranzactie-ms 1000
n0="$CAZ_N0"
grep -q 'PLAFON_DEPASIT: [0-9]* ms de la BEGIN > 1000 ms' "$TMP/amanat.log" || { cat "$TMP/amanat.log"; fail 'amanat: garda trebuia sa refuze (triggerul rulat inaintea ei)'; }
(( "$(inchideri)" == n0 )) || fail 'amanat: trebuia refuzata de garda, nu inchisa de server'
[[ "$(stare 20990101o_plafon_amanat)" == 'false|false' && -z "$(q "SELECT to_regclass('public.a_liv')")" ]] || fail 'amanat: au ramas efecte'
echo "PLAFON_AMANAT: trigger amanat (ceas oprit, 1,5 s, repornit; N=1000) => fara SET CONSTRAINTS ALL IMMEDIATE ruleaza in COMMIT, dupa garda, si COMITE ($ms ms, control 0); forma r12 il ruleaza inaintea garzii => PLAFON_DEPASIT, NEAPLICAT (10)"

# 8e. Cursor WITH HOLD lasat deschis: s-ar materializa (executa) in COMMIT, dupa garda => refuz explicit. Control: fara
#     optiune acelasi artefact comite, iar livrarea dureaza >= 1,5 s (cursorul chiar ruleaza la COMMIT).
CUR="DECLARE c_plafon CURSOR WITH HOLD FOR SELECT pg_sleep(1.5);"
M_CC="$(migrare 20990101p_plafon_cursor_ctl '' "$CUR")"
asteapta_ceas 'cursor control' 0 "$TMP/cursor_ctl.log" "$(curata 20990101p_plafon_cursor_ctl)" -- runner 20990101000017 "$M_CC"
ms="$CAZ_MS"
[[ "$(stare 20990101p_plafon_cursor_ctl)" == 'true|true' ]] || { cat "$TMP/cursor_ctl.log"; fail 'cursor control: neaplicat'; }
(( ms >= 1500 )) || fail "cursor control: livrarea a durat $ms ms (cursorul WITH HOLD trebuia materializat la COMMIT, >= 1500 ms)"
M_CU="$(migrare 20990101q_plafon_cursor '1000/session' "$CUR")"
asteapta cursor 10 "$TMP/cursor.log" runner 20990101000018 "$M_CU" --plafon-tranzactie-ms 1000
grep -q 'PLAFON_CURSOR: cursor WITH HOLD deschis' "$TMP/cursor.log" || { cat "$TMP/cursor.log"; fail 'cursor: garda trebuia sa refuze'; }
[[ "$(stare 20990101q_plafon_cursor)" == 'false|false' ]] || fail 'cursor: au ramas efecte'
echo "PLAFON_CURSOR: cursor WITH HOLD deschis => fara optiune se executa in COMMIT ($ms ms, control 0); cu plafon garda refuza (PLAFON_CURSOR), NEAPLICAT (10)"

# 9. Fara optiune: neschimbat fata de runda 9 (psql --single-transaction, fara SET).
M_FARA="$(migrare 20990101e_plafon_fara '0/default' '')"
asteapta fara 0 "$TMP/fara.log" runner 20990101000005 "$M_FARA"
[[ "$(stare 20990101e_plafon_fara)" == 'true|true' ]] || fail 'fara: neaplicat'
! grep -q 'plafon ~' "$TMP/fara.log" || fail 'fara: runnerul anunta un plafon necerut'
grep -q 'psql --single-transaction \[prolog' "$TMP/fara.log" || { cat "$TMP/fara.log"; fail 'fara: forma veche a livrarii'; }
echo 'PLAFON_FARA: fara optiune => psql --single-transaction, transaction_timeout 0/default (ca inainte); APLICAT (0)'
echo "CEAS: $CEAS_REPETARI incercari NEVALIDE repetate (salt al ceasului de perete >= $SALT_MS ms in timpul cazului)"
echo "PASS LIVRARE_PLAFON runda 13 PG17 (postgres NOSUPERUSER): plafonul = SET de sesiune inainte de BEGIN, verificat in prolog (pg_catalog, marcaj) si in garda finala, trimisa in ACELASI mesaj cu COMMIT-ul (rearmare / functie / amanat / cursor: nimic comis dupa termen, controalele r11 comiteau); validatorul refuza artefactele care ating vizibil ceasul; copie/log: $TMP"
