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
#   amanat:     trigger DEFERRABLE INITIALLY DEFERRED PREEXISTENT (ceas oprit, 1,5 s, repornit; N=1000) => control fara
#               SET CONSTRAINTS ALL IMMEDIATE il ruleaza in COMMIT, dupa garda, si COMITE (0); forma livrata il ruleaza
#               inaintea garzii => PLAFON_DEPASIT (10);
#   cursor:     cursor WITH HOLD deschis => fara optiune se executa la COMMIT (>= 1,5 s, control 0); cu plafon
#               PLAFON_CURSOR (10).
# Runda 13 / r5 (Jakarinos r16 P2): inchiderea prin catalog (PLAFON_AMANABIL), cu control pe forma r4c:
#   reamanat:   A amanat reamana (SET CONSTRAINTS ALL DEFERRED) si pune B amanat in coada; B opreste ceasul si doarme
#               1,5 s in COMMIT => forma r4c COMITE dupa termen (control 0, >= 1,5 s); forma r13 => PLAFON_AMANABIL (10);
#   fk:         FK DEFERRABLE creat de artefact intr-o subtranzactie (xmin != xid-ul de varf) => PLAFON_AMANABIL (10);
#               fara optiune => 0;
#   functie amanata: functia unui trigger amanabil EXISTENT inlocuita => PLAFON_AMANABIL (10); fara optiune => 0;
#   fara amanabile: FK / UNIQUE / trigger amanabile EXISTENTE folosite, FK / trigger ne-amanabile noi => 0.
# Runda 14 (portal r18, proba pe productie 12.11): TOATA tranzactia (BEGIN ... garda, COMMIT) e UN mesaj (\gexec), cu
# verificarea in server (DO $mesaj_unic$: lungimea + sha256 ale mesajului curent). Controalele de mai sus modifica acum
# mesajul prin scripts/test_livrare_psql_control.sh (nu 9_fin.sql, care nu mai exista):
#   rearmare / functie: control despartit_pauza (instructiune cu instructiune + pauza 1 s inaintea COMMIT) COMITE dupa
#               termen (0); forma livrata nu are drum client-server intre BEGIN si COMMIT => comite in < N (PLAFON_TIMP
#               masurat); o pauza inserata in mesaj (pauza_in_mesaj) => MESAJ_UNIC, NEAPLICAT (10);
#   mesaj unic: acelasi mesaj trimis instructiune cu instructiune (instructiuni_verif) => MESAJ_UNIC (10), nimic;
#   notice:     NOTICE-urile migrarii ajung in jurnalul livrarii; o copie care se termina fara „;” si cu un comentariu
#               fara LF => aplicata (despartitorul).
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
    rm -f "$TMP"/control_*
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
M_OK="$(migrare 20990101a_plafon_ok '1500/session' "DO \$n\$ BEGIN RAISE NOTICE 'PLAFON_NOTICE_DIN_MIGRARE'; END \$n\$;")"
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
# r14: NOTICE-urile migrarii ajung in jurnalul livrarii si in forma un mesaj; garda raporteaza timpul de la BEGIN.
grep -q 'PLAFON_NOTICE_DIN_MIGRARE' "$TMP/ok.log" || { cat "$TMP/ok.log"; fail 'ok: NOTICE-ul migrarii lipseste din jurnalul livrarii'; }
grep -q 'LIVRARE_TIMP 20990101a_plafon_ok: corp + inregistrare terminate la [0-9]* ms' "$TMP/ok.log" || { cat "$TMP/ok.log"; fail 'ok: LIVRARE_TIMP'; }
T_OK="$(sed -n 's/.*PLAFON_TIMP 20990101a_plafon_ok: garda trecuta la \([0-9]*\) ms de la BEGIN.*/\1/p' "$TMP/ok.log")"
[[ "$T_OK" =~ ^[0-9]+$ ]] && (( T_OK < 1500 )) || { cat "$TMP/ok.log"; fail "ok: PLAFON_TIMP lipsa / >= plafon ($T_OK)"; }
echo "PLAFON_OK: in tranzactie transaction_timeout = 1500/session + marcajul plafonului; APLICAT + INREGISTRAT (0); un mesaj, garda la $T_OK ms de la BEGIN; NOTICE-ul migrarii in jurnal"

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
# Inlocuieste DOAR fisierul 00_sesiune.sql (SET-ul de sesiune; r14: BEGIN e in mesajul tranzactiei) cu: tabel temporar
# fals pg_settings (1500/session) + dovada ca o citire NECALIFICATA vede falsul (ambele inainte de BEGIN, in aceeasi
# sesiune). Restul apelurilor (pre-verificare, mesajul tranzactiei, reconciliere) trec neschimbate.
a=()
while [ \$# -gt 0 ]; do
  if [ "\$1" = -f ] && [[ "\${2:-}" == */00_sesiune.sql ]]; then
    a+=(-c "CREATE TEMP TABLE pg_settings AS SELECT 'transaction_timeout'::text AS name, '1500'::text AS setting, 'session'::text AS source"
        -c "DO \\\$u\\\$ BEGIN IF (SELECT setting || '/' || source FROM pg_settings WHERE name = 'transaction_timeout') IS DISTINCT FROM '1500/session' THEN RAISE EXCEPTION 'UMBRIRE_NEFUNCTIONALA'; END IF; END \\\$u\\\$")
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

# 8b-8e. Runda 12 (Jakarinos r14 P2): termenul trebuie sa tina pana la COMMIT. Runda 14: clientul de CONTROL
# scripts/test_livrare_psql_control.sh (PSQL_BIN) schimba doar mesajul tranzactiei (5_mesaj.sql):
#   despartit_pauza = forma r11 (instructiune cu instructiune) + pauza client 1 s chiar inaintea lui COMMIT — arata ca
#                     scenariul chiar comitea dupa termen;
#   pauza_in_mesaj  = o pauza de 1 s INSERATA in mesaj inaintea lui COMMIT => textul nu mai e cel generat => MESAJ_UNIC.
# Forma livrata (fara client de control) nu are niciun drum client-server intre BEGIN si COMMIT: nu exista loc pentru o
# pauza a clientului / retelei; comite in < N, cu timpul masurat de garda (PLAFON_TIMP).
printf '#!/usr/bin/env bash\nexec bash "%s" "$@"\n' "$ROOT/scripts/test_livrare_psql_control.sh" >"$TMP/psql_control"
chmod +x "$TMP/psql_control"
control() { # $1 modul, restul = argumentele runner()
  local mod="$1"; shift
  CONTROL_DIR="$TMP" CONTROL_PG_BIN="$PG_BIN" CONTROL_MOD="$mod" PSQL_BIN_TEST="$TMP/psql_control" runner "$@"
}
timp_garda() { sed -n "s/.*PLAFON_TIMP $1: garda trecuta la \([0-9]*\) ms de la BEGIN.*/\1/p" "$2"; }
# 8b. Mutantul din verdict: N=2000, artefactul opreste ceasul prin SQL dinamic si il reporneste la ~1,5 s (ceas NOU de
#     2 s, expira la ~3,5 s), garda la ~1,6 s, pauza 1 s, COMMIT.
REARM="DO \$d\$ BEGIN EXECUTE format('SET LOCAL %s = 0', $DIN); PERFORM pg_sleep(1.5);
  EXECUTE format('SET LOCAL %s = %s', $DIN, '2000'); END \$d\$;"
M_RC="$(migrare 20990101j_plafon_rearm_ctl '2000/session' "$REARM")"
asteapta_ceas 'rearmare control' 0 "$TMP/rearm_ctl.log" "$(curata 20990101j_plafon_rearm_ctl)" -- control despartit_pauza 20990101000011 "$M_RC" --plafon-tranzactie-ms 2000
ms="$CAZ_MS"
[[ -e "$TMP/control_despartit_pauza" && "$(stare 20990101j_plafon_rearm_ctl)" == 'true|true' ]] \
  || { cat "$TMP/rearm_ctl.log"; fail 'rearmare control: forma r11 + pauza trebuia sa comita dupa termen (proba nefunctionala)'; }
(( ms >= 2500 )) || fail "rearmare control: livrarea a durat $ms ms (1,5 s + pauza 1 s: COMMIT-ul trebuia sa vina dupa termen)"
M_RP="$(migrare 20990101y_plafon_rearm_pauza '2000/session' "$REARM")"
asteapta 'rearmare pauza in mesaj' 10 "$TMP/rearm_pauza.log" control pauza_in_mesaj 20990101000026 "$M_RP" --plafon-tranzactie-ms 2000
[[ -e "$TMP/control_pauza_in_mesaj" ]] || fail 'rearmare pauza in mesaj: transformarea nu s-a aplicat (proba nefunctionala)'
grep -q 'MESAJ_UNIC' "$TMP/rearm_pauza.log" || { cat "$TMP/rearm_pauza.log"; fail 'rearmare pauza in mesaj: trebuia refuz MESAJ_UNIC'; }
[[ "$(stare 20990101y_plafon_rearm_pauza)" == 'false|false' ]] || fail 'rearmare pauza in mesaj: au ramas efecte'
M_RM="$(migrare 20990101k_plafon_rearm '2000/session' "$REARM")"
asteapta_ceas rearmare 0 "$TMP/rearm.log" "$(curata 20990101k_plafon_rearm)" -- runner 20990101000012 "$M_RM" --plafon-tranzactie-ms 2000
T_RM="$(timp_garda 20990101k_plafon_rearm "$TMP/rearm.log")"
[[ "$T_RM" =~ ^[0-9]+$ ]] && (( T_RM >= 1500 && T_RM < 2000 )) || { cat "$TMP/rearm.log"; fail "rearmare: garda trebuia sa treaca intre 1500 si 2000 ms de la BEGIN ($T_RM)"; }
[[ "$(stare 20990101k_plafon_rearm)" == 'true|true' ]] || fail 'rearmare: forma livrata trebuia sa comita in termen'
echo "PLAFON_REARMARE: ceas oprit prin SQL dinamic si repornit la ~1,5 s (N=2000) + pauza client 1 s inaintea COMMIT => forma r11 (instructiune cu instructiune) COMITEA dupa termen ($ms ms, control 0); pauza inserata in mesaj => MESAJ_UNIC, NEAPLICAT (10); forma livrata (un mesaj, 0 drumuri intre BEGIN si COMMIT) => garda la $T_RM ms < 2000, COMITE in termen (0)"

# 8c. Functie EXISTENTA cu SET transaction_timeout = 0 (la iesire valoarea restaurata porneste un ceas nou), apelata de
#     artefact (validatorul nu o vede); aceeasi pauza.
q "CREATE FUNCTION public.f_dormi_plafon() RETURNS void LANGUAGE plpgsql SET transaction_timeout = 0 AS \$f\$ BEGIN PERFORM pg_sleep(1.5); END \$f\$" >/dev/null
M_FC="$(migrare 20990101l_plafon_functie_ctl '2000/session' 'SELECT public.f_dormi_plafon();')"
asteapta_ceas 'functie control' 0 "$TMP/functie_ctl.log" "$(curata 20990101l_plafon_functie_ctl)" -- control despartit_pauza 20990101000013 "$M_FC" --plafon-tranzactie-ms 2000
ms="$CAZ_MS"
[[ "$(stare 20990101l_plafon_functie_ctl)" == 'true|true' ]] \
  || { cat "$TMP/functie_ctl.log"; fail 'functie control: forma r11 + pauza trebuia sa comita dupa termen (proba nefunctionala)'; }
(( ms >= 2500 )) || fail "functie control: livrarea a durat $ms ms (COMMIT-ul trebuia sa vina dupa termen)"
M_FN="$(migrare 20990101m_plafon_functie '2000/session' 'SELECT public.f_dormi_plafon();')"
asteapta_ceas functie 0 "$TMP/functie.log" "$(curata 20990101m_plafon_functie)" -- runner 20990101000014 "$M_FN" --plafon-tranzactie-ms 2000
T_FN="$(timp_garda 20990101m_plafon_functie "$TMP/functie.log")"
[[ "$T_FN" =~ ^[0-9]+$ ]] && (( T_FN >= 1500 && T_FN < 2000 )) || { cat "$TMP/functie.log"; fail "functie: garda trebuia sa treaca intre 1500 si 2000 ms ($T_FN)"; }
[[ "$(stare 20990101m_plafon_functie)" == 'true|true' ]] || fail 'functie: forma livrata trebuia sa comita in termen'
echo "PLAFON_FUNCTIE: functie existenta cu SET transaction_timeout = 0 (1,5 s) + pauza 1 s => forma r11 COMITEA dupa termen ($ms ms, control 0); forma livrata => garda la $T_FN ms < 2000, COMITE in termen (0)"

# r16b: functia de trigger a probei scrie un GUC prin SQL dinamic; fara REVOKE FROM PUBLIC, gate-ul 0e al runnerului o
#     semnaleaza (cod 30) dupa comitere si controlul pica din alt motiv decat cel probat.
# 8d. Trigger AMANAT (DEFERRABLE INITIALLY DEFERRED) PREEXISTENT (creat inaintea livrarii, nu de artefact), care opreste
#     ceasul, doarme 1,5 s si il reporneste; artefactul doar insereaza in tabelul lui (pune evenimentul in coada). Fara
#     SET CONSTRAINTS ALL IMMEDIATE ar rula IN COMMIT, dupa garda (control, fara pauza); cu el ruleaza inaintea garzii.
#     r5 (Jakarinos r16): triggerul e preexistent, ca sa nu-l refuze inchiderea prin catalog (PLAFON_AMANABIL, 8f-8h) —
#     aici se proba doar ca SET CONSTRAINTS ALL IMMEDIATE numara timpul triggerelor existente.
q "CREATE TABLE public.a_pre (id integer);
CREATE FUNCTION public.fa_pre() RETURNS trigger LANGUAGE plpgsql AS \$f\$ BEGIN EXECUTE format('SET LOCAL %s = 0', $DIN); PERFORM pg_sleep(1.5); EXECUTE format('SET LOCAL %s = %s', $DIN, '1000'); RETURN NULL; END \$f\$;
REVOKE EXECUTE ON FUNCTION public.fa_pre() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER ta_pre AFTER INSERT ON public.a_pre DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fa_pre();" >/dev/null
[[ "$(q "SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgname = 'ta_pre' AND tgdeferrable AND tginitdeferred")" == 1 ]] \
  || fail 'amanat: triggerul preexistent nu e DEFERRABLE INITIALLY DEFERRED (proba nefunctionala)'
# CONTROL (r14): mesajul tranzactiei fara SET CONSTRAINTS ALL IMMEDIATE (triggerele amanate raman pentru COMMIT).
M_AC="$(migrare 20990101n_plafon_amanat_ctl '1000/session' 'INSERT INTO public.a_pre VALUES (1);')"
asteapta_ceas 'amanat control' 0 "$TMP/amanat_ctl.log" \
  "$(curata 20990101n_plafon_amanat_ctl 'DELETE FROM public.a_pre;')" \
  -- control fara_amanate 20990101000015 "$M_AC" --plafon-tranzactie-ms 1000
ms="$CAZ_MS"
[[ -e "$TMP/control_fara_amanate" && "$(stare 20990101n_plafon_amanat_ctl)" == 'true|true' ]] \
  || { cat "$TMP/amanat_ctl.log"; fail 'amanat control: triggerul amanat din COMMIT trebuia sa treaca de garda (proba nefunctionala)'; }
[[ "$(q 'SELECT count(*) FROM public.a_pre')" == 1 ]] || fail 'amanat control: randul lipseste'
(( ms >= 1500 )) || fail "amanat control: livrarea a durat $ms ms (triggerul trebuia sa doarma 1,5 s in COMMIT)"
M_AM="$(migrare 20990101o_plafon_amanat '1000/session' 'INSERT INTO public.a_pre VALUES (2);')"
asteapta_ceas amanat 10 "$TMP/amanat.log" "$(curata 20990101o_plafon_amanat 'DELETE FROM public.a_pre WHERE id = 2;')" \
  -- runner 20990101000016 "$M_AM" --plafon-tranzactie-ms 1000
n0="$CAZ_N0"
grep -q 'PLAFON_DEPASIT: [0-9]* ms de la BEGIN > 1000 ms' "$TMP/amanat.log" || { cat "$TMP/amanat.log"; fail 'amanat: garda trebuia sa refuze (triggerul rulat inaintea ei)'; }
! grep -q PLAFON_AMANABIL "$TMP/amanat.log" || { cat "$TMP/amanat.log"; fail 'amanat: un trigger PREEXISTENT nu trebuie refuzat prin catalog'; }
(( "$(inchideri)" == n0 )) || fail 'amanat: trebuia refuzata de garda, nu inchisa de server'
[[ "$(stare 20990101o_plafon_amanat)" == 'false|false' && "$(q 'SELECT count(*) FROM public.a_pre')" == 1 ]] || fail 'amanat: au ramas efecte'
echo "PLAFON_AMANAT: trigger amanat PREEXISTENT (ceas oprit, 1,5 s, repornit; N=1000) => fara SET CONSTRAINTS ALL IMMEDIATE ruleaza in COMMIT, dupa garda, si COMITE ($ms ms, control 0); forma livrata il ruleaza inaintea garzii => PLAFON_DEPASIT (nu PLAFON_AMANABIL: e preexistent), NEAPLICAT (10)"

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

# 8f-8i. Runda 13 (r5, Jakarinos r16 P2): SET CONSTRAINTS ALL IMMEDIATE nu goleste coada pentru totdeauna (un trigger
# amanat A o poate reamana si pune B in coada pentru COMMIT). Inchiderea prin catalog: garda refuza (PLAFON_AMANABIL)
# orice obiect amanabil creat / modificat in tranzactie. CONTROL = forma r4c: clientul de control (r14:
# scripts/test_livrare_psql_control.sh, mod r4c) scoate din mesajul tranzactiei exact blocul PLAFON_AMANABIL (altfel
# proba e nefunctionala, cod 7 => psql nu porneste => controlul pica).
# Scenariul exact din verdict: A (amanat) ruleaza la SET CONSTRAINTS ALL IMMEDIATE, executa SET CONSTRAINTS ALL DEFERRED
# si insereaza in tabelul lui B (amanat); B opreste ceasul prin SQL dinamic si doarme 1,5 s. N=1000.
reamanare() { # $1 sufixul obiectelor
  printf '%s\n' "CREATE TABLE public.ra_$1 (id integer);" "CREATE TABLE public.rb_$1 (id integer);" \
    "CREATE FUNCTION public.fra_$1() RETURNS trigger LANGUAGE plpgsql AS \$f\$ BEGIN SET CONSTRAINTS ALL DEFERRED; INSERT INTO public.rb_$1 VALUES (1); RETURN NULL; END \$f\$;" \
    "CREATE FUNCTION public.frb_$1() RETURNS trigger LANGUAGE plpgsql AS \$f\$ BEGIN EXECUTE format('SET LOCAL %s = 0', $DIN); PERFORM pg_sleep(1.5); RETURN NULL; END \$f\$;" \
    "REVOKE EXECUTE ON FUNCTION public.fra_$1() FROM PUBLIC;" "REVOKE EXECUTE ON FUNCTION public.frb_$1() FROM PUBLIC;" \
    "CREATE CONSTRAINT TRIGGER tra_$1 AFTER INSERT ON public.ra_$1 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fra_$1();" \
    "CREATE CONSTRAINT TRIGGER trb_$1 AFTER INSERT ON public.rb_$1 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.frb_$1();" \
    "INSERT INTO public.ra_$1 VALUES (1);"
}
# 8f. Control (forma r4c): B ruleaza in COMMIT, dupa garda => COMITE dupa termen (>= 1,5 s, fara inchidere de server).
M_RAC="$(migrare 20990101r_plafon_reamanat_ctl '1000/session' "$(reamanare ctl)")"
asteapta_ceas 'reamanare control' 0 "$TMP/reamanat_ctl.log" \
  "$(curata 20990101r_plafon_reamanat_ctl 'DROP TABLE IF EXISTS public.ra_ctl, public.rb_ctl; DROP FUNCTION IF EXISTS public.fra_ctl(); DROP FUNCTION IF EXISTS public.frb_ctl();')" \
  -- control r4c 20990101000019 "$M_RAC" --plafon-tranzactie-ms 1000
ms="$CAZ_MS"; n0="$CAZ_N0"
[[ -e "$TMP/control_r4c" && "$(stare 20990101r_plafon_reamanat_ctl)" == 'true|true' ]] \
  || { cat "$TMP/reamanat_ctl.log"; fail 'reamanare control: forma r4c trebuia sa comita (proba nefunctionala)'; }
[[ "$(q 'SELECT count(*) FROM public.rb_ctl')" == 1 ]] || fail 'reamanare control: B nu a fost pus in coada'
(( ms >= 1500 )) || fail "reamanare control: livrarea a durat $ms ms (B trebuia sa doarma 1,5 s in COMMIT, dupa garda)"
(( "$(inchideri)" == n0 )) || fail 'reamanare control: serverul a inchis sesiunea (B trebuia sa ruleze fara ceas, in COMMIT)'
# 8f. Forma livrata: refuz prin catalog, nimic comis.
M_RA="$(migrare 20990101s_plafon_reamanat '1000/session' "$(reamanare liv)")"
asteapta reamanare 10 "$TMP/reamanat.log" runner 20990101000020 "$M_RA" --plafon-tranzactie-ms 1000
grep -q 'PLAFON_AMANABIL: obiecte amanabile create / modificate in tranzactie (.*trigger public\.rb_liv\.trb_liv' "$TMP/reamanat.log" \
  || { cat "$TMP/reamanat.log"; fail 'reamanare: garda trebuia sa refuze cu PLAFON_AMANABIL'; }
[[ "$(stare 20990101s_plafon_reamanat)" == 'false|false' && -z "$(q "SELECT to_regclass('public.ra_liv')")" ]] || fail 'reamanare: au ramas efecte'
echo "PLAFON_REAMANAT: A reamana si pune B in coada (B: ceas oprit, 1,5 s in COMMIT; N=1000) => forma r4c COMITE dupa termen ($ms ms, control 0); forma r13 => PLAFON_AMANABIL, NEAPLICAT (10), nimic comis"

# 8g. FK AMANABIL creat de artefact INTR-O SUBTRANZACTIE (bloc EXCEPTION, xid propriu — artefactul verifica singur ca
#     xmin-ul constrangerii NU e xid-ul de varf, altfel proba e nefunctionala) => refuz; fara optiune acelasi corp => 0.
fk_subtranzactie() { # $1 sufixul obiectelor
  printf '%s\n' "CREATE TABLE public.gp_$1 (id integer PRIMARY KEY);" "CREATE TABLE public.gc_$1 (id integer, p integer);" \
    "DO \$s\$ BEGIN" \
    "  BEGIN" \
    "    ALTER TABLE public.gc_$1 ADD CONSTRAINT gc_$1_fk FOREIGN KEY (p) REFERENCES public.gp_$1(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;" \
    "  EXCEPTION WHEN others THEN RAISE;" \
    "  END;" \
    "  IF (SELECT c.xmin::text FROM pg_catalog.pg_constraint c WHERE c.conname = 'gc_$1_fk') IS NOT DISTINCT FROM pg_catalog.xid(pg_catalog.pg_current_xact_id())::text THEN" \
    "    RAISE EXCEPTION 'PROBA_SUBTRANZACTIE_NEFUNCTIONALA: FK-ul are xmin-ul varfului'; END IF;" \
    "END \$s\$;"
}
M_FK="$(migrare 20990101t_plafon_fk_amanabil '1000/session' "$(fk_subtranzactie liv)")"
asteapta 'fk amanabil' 10 "$TMP/fk.log" runner 20990101000021 "$M_FK" --plafon-tranzactie-ms 1000
! grep -q PROBA_SUBTRANZACTIE_NEFUNCTIONALA "$TMP/fk.log" || { cat "$TMP/fk.log"; fail 'fk amanabil: constrangerea nu e din subtranzactie (proba nefunctionala)'; }
grep -q 'PLAFON_AMANABIL: obiecte amanabile create / modificate in tranzactie (constrangere gc_liv_fk' "$TMP/fk.log" \
  || { cat "$TMP/fk.log"; fail 'fk amanabil: garda trebuia sa refuze cu PLAFON_AMANABIL'; }
[[ "$(stare 20990101t_plafon_fk_amanabil)" == 'false|false' && -z "$(q "SELECT to_regclass('public.gc_liv')")" ]] || fail 'fk amanabil: au ramas efecte'
M_FKF="$(migrare 20990101u_plafon_fk_amanabil_fara '' "$(fk_subtranzactie fara)")"
asteapta 'fk amanabil fara optiune' 0 "$TMP/fk_fara.log" runner 20990101000022 "$M_FKF"
[[ "$(stare 20990101u_plafon_fk_amanabil_fara)" == 'true|true' ]] || { cat "$TMP/fk_fara.log"; fail 'fk amanabil fara optiune: neaplicat'; }
echo 'PLAFON_FK_AMANABIL: FK DEFERRABLE creat intr-o subtranzactie (xmin = xid-ul subtranzactiei, nu al varfului) => PLAFON_AMANABIL, NEAPLICAT (10); fara optiune acelasi corp => APLICAT (0)'

# 8h. Functia unui trigger amanabil EXISTENT inlocuita de artefact (CREATE OR REPLACE) => refuz; fara optiune => 0.
q "CREATE TABLE public.h_pre (id integer);
CREATE FUNCTION public.fh_pre() RETURNS trigger LANGUAGE plpgsql AS \$f\$ BEGIN RETURN NULL; END \$f\$;
REVOKE EXECUTE ON FUNCTION public.fh_pre() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER th_pre AFTER INSERT ON public.h_pre DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fh_pre();" >/dev/null
INLOC='CREATE OR REPLACE FUNCTION public.fh_pre() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM 1; RETURN NULL; END $f$;'
M_FH="$(migrare 20990101v_plafon_functie_amanata '1000/session' "$INLOC")"
asteapta 'functie amanata' 10 "$TMP/fh.log" runner 20990101000023 "$M_FH" --plafon-tranzactie-ms 1000
grep -q 'PLAFON_AMANABIL: obiecte amanabile create / modificate in tranzactie (functia public.fh_pre() a triggerului th_pre)' "$TMP/fh.log" \
  || { cat "$TMP/fh.log"; fail 'functie amanata: garda trebuia sa refuze cu PLAFON_AMANABIL (doar functia)'; }
[[ "$(stare 20990101v_plafon_functie_amanata)" == 'false|false' ]] || fail 'functie amanata: au ramas efecte'
[[ "$(q "SELECT position('PERFORM 1' IN prosrc) FROM pg_catalog.pg_proc WHERE oid = 'public.fh_pre()'::regprocedure")" == 0 ]] \
  || fail 'functie amanata: functia a ramas inlocuita'
M_FHF="$(migrare 20990101w_plafon_functie_amanata_fara '' "$INLOC")"
asteapta 'functie amanata fara optiune' 0 "$TMP/fh_fara.log" runner 20990101000024 "$M_FHF"
[[ "$(stare 20990101w_plafon_functie_amanata_fara)" == 'true|true' ]] || { cat "$TMP/fh_fara.log"; fail 'functie amanata fara optiune: neaplicat'; }
echo 'PLAFON_FUNCTIE_AMANATA: functia triggerului amanabil existent th_pre inlocuita => PLAFON_AMANABIL, NEAPLICAT (10); fara optiune => APLICAT (0)'

# 8i. Fara nimic amanabil CREAT: obiectele amanabile EXISTENTE (FK, UNIQUE, trigger — ca pe productie) folosite de
#     artefact (evenimente in coada, copilul inserat inaintea parintelui), plus FK / trigger NE-amanabile noi => APLICAT (0).
q "CREATE TABLE public.i_p (id integer PRIMARY KEY);
CREATE TABLE public.i_c (id integer, p integer CONSTRAINT i_c_fk REFERENCES public.i_p(id) DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE public.i_u (id integer CONSTRAINT i_u_uq UNIQUE DEFERRABLE INITIALLY DEFERRED);" >/dev/null
M_NIM="$(migrare 20990101x_plafon_fara_amanabile '1500/session' 'INSERT INTO public.i_c VALUES (1, 1);
INSERT INTO public.i_p VALUES (1);
INSERT INTO public.i_u VALUES (1);
INSERT INTO public.h_pre VALUES (1);
CREATE TABLE public.i_nou (id integer CONSTRAINT i_nou_fk REFERENCES public.i_p(id));
CREATE FUNCTION public.fi_normal() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$;
REVOKE EXECUTE ON FUNCTION public.fi_normal() FROM PUBLIC;
CREATE TRIGGER ti_normal AFTER INSERT ON public.i_nou FOR EACH ROW EXECUTE FUNCTION public.fi_normal();
INSERT INTO public.i_nou VALUES (1);')"
asteapta 'fara amanabile' 0 "$TMP/nimic.log" runner 20990101000025 "$M_NIM" --plafon-tranzactie-ms 1500
[[ "$(stare 20990101x_plafon_fara_amanabile)" == 'true|true' && "$(q 'SELECT count(*) FROM public.i_c')" == 1 ]] \
  || { cat "$TMP/nimic.log"; fail 'fara amanabile: neaplicat (fals pozitiv al inchiderii prin catalog?)'; }
echo 'PLAFON_FARA_AMANABILE: FK / UNIQUE / trigger amanabile EXISTENTE folosite + FK si trigger ne-amanabile noi, cu plafon 1500 => APLICAT (0)'

# 8j. Runda 14: verificarea „un mesaj” chiar prinde un mesaj despartit — ACELASI M, trimis instructiune cu instructiune
#     (psql -f) => DO $mesaj_unic$ vede doar instructiunea lui in current_query() => MESAJ_UNIC, refuz inaintea
#     lock-urilor, nimic comis.
M_MU="$(migrare 20990101z_plafon_mesaj_unic '1500/session' '')"
asteapta 'mesaj despartit' 10 "$TMP/mesaj_unic.log" control instructiuni_verif 20990101000027 "$M_MU" --plafon-tranzactie-ms 1500
[[ -e "$TMP/control_instructiuni_verif" ]] || fail 'mesaj despartit: transformarea nu s-a aplicat (proba nefunctionala)'
grep -q 'MESAJ_UNIC: tranzactia nu a ajuns la server intr-un singur mesaj' "$TMP/mesaj_unic.log" || { cat "$TMP/mesaj_unic.log"; fail 'mesaj despartit: trebuia refuz MESAJ_UNIC'; }
[[ "$(stare 20990101z_plafon_mesaj_unic)" == 'false|false' ]] || fail 'mesaj despartit: au ramas efecte'
# Aceeasi migrare, forma livrata => APLICAT (verificarea nu da fals pozitiv).
asteapta 'mesaj unic' 0 "$TMP/mesaj_unic_ok.log" runner 20990101000027 "$M_MU" --plafon-tranzactie-ms 1500
[[ "$(stare 20990101z_plafon_mesaj_unic)" == 'true|true' ]] || fail 'mesaj unic: neaplicat'
# 8k. Despartitorul: o copie a carei ultima instructiune nu are „;” si care se termina cu un comentariu „--” FARA LF.
M_SEP="$TMP/mig/20990102a_plafon_fara_final.sql"
{ printf "DO \$g\$ BEGIN\n  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20990102a_plafon_fara_final:' || txid_current() THEN\n    RAISE EXCEPTION 'PLAFON_RUNNER_REQUIRED'; END IF;\nEND \$g\$;\n"
  printf 'CREATE TABLE public.t_20990102a_plafon_fara_final (id integer)\n-- fara punct si virgula si fara LF la final'; } >"$M_SEP"
asteapta 'fara final' 0 "$TMP/fara_final.log" runner 20990101000028 "$M_SEP" --plafon-tranzactie-ms 1500
[[ "$(stare 20990102a_plafon_fara_final)" == 'true|true' ]] || { cat "$TMP/fara_final.log"; fail 'fara final: neaplicat'; }
echo 'PLAFON_MESAJ_UNIC: acelasi mesaj trimis instructiune cu instructiune => MESAJ_UNIC, NEAPLICAT (10), nimic; forma livrata => APLICAT (0); copie fara „;” final si cu comentariu fara LF => APLICAT (0)'

# 9. Fara optiune: neschimbat fata de runda 9 (psql --single-transaction, fara SET).
M_FARA="$(migrare 20990101e_plafon_fara '0/default' '')"
asteapta fara 0 "$TMP/fara.log" runner 20990101000005 "$M_FARA"
[[ "$(stare 20990101e_plafon_fara)" == 'true|true' ]] || fail 'fara: neaplicat'
! grep -q 'plafon ~' "$TMP/fara.log" || fail 'fara: runnerul anunta un plafon necerut'
grep -q 'psql --single-transaction \[prolog' "$TMP/fara.log" || { cat "$TMP/fara.log"; fail 'fara: forma veche a livrarii'; }
echo 'PLAFON_FARA: fara optiune => psql --single-transaction, transaction_timeout 0/default (ca inainte); APLICAT (0)'
echo "CEAS: $CEAS_REPETARI incercari NEVALIDE repetate (salt al ceasului de perete >= $SALT_MS ms in timpul cazului)"
echo "PASS LIVRARE_PLAFON runda 13 r5 PG17 (postgres NOSUPERUSER): plafonul = SET de sesiune inainte de BEGIN, verificat in prolog (pg_catalog, marcaj) si in garda finala, trimisa in ACELASI mesaj cu COMMIT-ul (rearmare / functie / amanat / cursor: nimic comis dupa termen, controalele r11 comiteau); obiectele amanabile create / modificate de artefact => PLAFON_AMANABIL (reamanare: controlul r4c comitea; fk in subtranzactie; functie inlocuita); obiectele amanabile existente nu dau fals pozitiv; validatorul refuza artefactele care ating vizibil ceasul; copie/log: $TMP"
