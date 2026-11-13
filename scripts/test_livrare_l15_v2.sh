#!/usr/bin/env bash
# L15 v2 (13.11.2026, docs/LIVRARE_L15_V2.md): proba runnerului cu --amprenta-globala + --diferente-globale pe un cluster
# PostgreSQL 17 NOU, efemer (tiparul scripts/test_livrare_plafon.sh): doar 127.0.0.1, port 6800 + slot (verificat liber),
# director nou in /tmp. Nu atinge nicio alta baza si nu sterge nimic in afara directorului propriu.
#   Linux / WSL, ca utilizatorul postgres (initdb refuza root):
#     wsl -d Ubuntu-24.04 -u postgres -- bash /mnt/c/.../scripts/test_livrare_l15_v2.sh <slot 0-9>
#   PG_BIN = binarele PG17 (implicit /usr/lib/postgresql/17/bin). Cere python3 (validatorul runnerului).
# Fluxul real al coordonatorului: citirea (scripts/amprenta_globala_citire.sh) => GLOBAL; manifestul generat pe „clona”
# (scripts/livrare_l15_manifest.sh, ROLLBACK); livrarea cu runnerul. Ce dovedeste (fiecare caz cu prag care pica testul):
#   a  contraexemplul #1084 r3: poarta citeste o VEDERE care cheama un auxiliar; auxiliarul schimbat DUPA citirea
#      baseline-ului => refuz la „inainte” (AMPRENTA_GLOBALA_INAINTE), NEAPLICAT (10), nimic creat / inregistrat;
#   b  o ALTA sesiune comite un DDL intre „inainte” si „dupa” (bariera: migrarea asteapta un lock consultativ tinut de
#      test; testul vede livrarea blocata DUPA pasul inainte, comite DDL-ul, elibereaza bariera) => refuz la „dupa”
#      (NEDECLARAT), NEAPLICAT (10); control: aceeasi bariera FARA DDL => APLICAT (0); in forma fara plafon SI cu plafon;
#   c  manifest cu un rand lipsa / in plus / cu alta amprenta finala => NEAPLICAT (10) cu motivul exact;
#   d  drumul bun (cu plafon 2000, forma „un mesaj”) => APLICAT + INREGISTRAT (0), GLOBAL nou citit != cel vechi;
#   e  fara optiunile noi => aplicat (0), jurnalul fara nicio urma AMPRENTA_GLOBALA; o optiune fara cealalta => 2;
#   f  timpul: catalog sintetic (~1.500 functii, ~300 tabele, ~50 vederi), livrare cu plafon 2000 + L15: timpii pasilor
#      (NOTICE-urile AMPRENTA_GLOBALA, LIVRARE_TIMP, PLAFON_TIMP) cu cache RECE (server repornit) si CALD (a doua livrare);
#   g  proba cu ROLLBACK pe tinta (livrare_l15_manifest.sh --compara-cu): manifestul generat => IDENTIC (0), nimic comis;
#      manifest cu un rand diferit => 6 (ALTA_AMPRENTA); --amprenta-globala gresita => 6;
#   h  --detalii: fiecare rand din manifest are detaliul lui si md5(detaliu) = amprenta; --detalii in supabase/migrations => 2;
#   i  citirea cu o functie DEFINER cu search_path = pg_temp, public in lant => 4 (nesigura); cu --definer-verificat
#      '<functie>=<md5 tiparit>' => 0 (acceptata); cu alt md5 => 4;
#   j  contraexemplul grantorului pe PG17, prin runner: dreptul transferat de la g1 la g2 DUPA citire => refuz la „inainte”
#      (AMPRENTA_GLOBALA_INAINTE, familia relatie), NEAPLICAT (10);
#   k  (r3) doua citiri reale consecutive cu --amprente-migrare scripts/meteo_xweather_amprente.sql (tipareste now()), fara DDL
#      intre ele => l15_compara_liste.sh --recitire 0;
#   l  (r4) triggerul recenzentului pe un tabel de la initdb (information_schema.sql_features), creat intre doua citiri reale:
#      INSERT ... RETURNING intoarce 1, apoi 0 randuri; GLOBAL difera, familia trigger difera; apoi RLS pornit pe acelasi
#      tabel => GLOBAL difera (familia sistem_initdb, plasa relatiilor);
#   m  (r4) VACUUM + ANALYZE intre doua citiri, dupa un trigger creat si sters (steagul lenes relhastriggers ramas aprins,
#      stins de VACUUM) => GLOBAL identic;
#   n  (r4) --detalii-plasa pe doua citiri reale, inainte / dupa ALTER FUNCTION pg_catalog.quote_nullable(text) STRICT:
#      citirea reproduce randurile plasei din detaliu (cod 0), iar diferenta celor doua detalii arata exact acea functie;
#   o  (r5) contraexemplul recenzentului: information_schema.sql_features partitie a unui tabel al aplicatiei, reatasata cu alta
#      limita intre doua citiri reale (INSERT ... RETURNING: eroare -> succes) => GLOBAL difera, doar sistem_initdb, detaliul
#      plasei arata acel tabel; lista inchisa a coloanelor pg_class / pg_proc / pg_aggregate pe catalogul PG17.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SLOT="${1:-0}"; [[ "$SLOT" =~ ^[0-9]$ ]] || { echo 'MEDIU: slot 0-9'; exit 2; }
[[ "$(id -u)" != 0 ]] || { echo 'MEDIU: ruleaza ca postgres, nu root'; exit 2; }
for v in PGPASSWORD PGOPTIONS PGDATABASE PGSERVICE PGSERVICEFILE PGHOSTADDR PGTARGETSESSIONATTRS PGLOADBALANCEHOSTS PGSYSCONFDIR PSQLRC PGTZ PGDATESTYLE; do
  [[ -z "${!v+x}" ]] || { echo "MEDIU: variabila $v nepermisa"; exit 2; }
done
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
[[ -x "$PG_BIN/initdb" ]] || { echo "MEDIU: PG17 lipsa in $PG_BIN"; exit 2; }
[[ "$("$PG_BIN/postgres" --version)" == *" 17."* ]] || { echo 'MEDIU: este necesar PG17'; exit 2; }
PORT=$((6800+SLOT)); DB=l15_test
PORT_RC=0; "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT" -t 2 || PORT_RC=$?
[[ "$PORT_RC" == 2 ]] || { echo "MEDIU: portul $PORT e ocupat, alege alt slot"; exit 2; }
TMP="$(mktemp -d "/tmp/livrare_l15_${SLOT}_XXXXXXXX")"
export TMPDIR="$TMP"
DATA="$TMP/pg"; PG_LOG="$TMP/pg.log"
PIDS=()
trap 'for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; "$PG_BIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null 2>&1 || true' EXIT
fail() { echo "ESEC: $*" >&2; echo "copie/log: $TMP" >&2; exit 1; }
ADMIN=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U supabase_admin)
q() { "$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -Atc "$1"; }
qa() { "${ADMIN[@]}" -d "$DB" -Atc "$1"; }
"$PG_BIN/initdb" -D "$DATA" -U supabase_admin --auth=trust --encoding=UTF8 --locale=C.UTF-8 >"$TMP/init.log"
porneste() { "$PG_BIN/pg_ctl" -D "$DATA" -l "$PG_LOG" -w -t 30 start -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='$TMP'" >/dev/null; }
porneste
# Ca in productie: postgres NOSUPERUSER (proprietarul obiectelor), istoricul in supabase_migrations, rolurile API.
"${ADMIN[@]}" -d postgres -c 'CREATE ROLE postgres LOGIN CREATEROLE NOSUPERUSER' \
  -c 'CREATE ROLE anon NOLOGIN' -c 'CREATE ROLE authenticated NOLOGIN' -c 'CREATE ROLE service_role NOLOGIN BYPASSRLS' \
  -c "CREATE DATABASE $DB OWNER postgres" >/dev/null
"${ADMIN[@]}" -d "$DB" -c 'CREATE SCHEMA supabase_migrations AUTHORIZATION postgres' \
  -c 'CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text)' \
  -c 'ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres' \
  -c 'GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO postgres' \
  -c 'CREATE SCHEMA auth AUTHORIZATION postgres' -c 'CREATE SCHEMA extensions AUTHORIZATION postgres' >/dev/null
SIS="$(q 'SELECT system_identifier FROM pg_control_system()')"
# Poarta prin vedere (contraexemplul recenzentului): poarta -> v_drept -> aux_drept().
q "$(cat <<'SQL'
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.sites (id bigint PRIMARY KEY);
CREATE FUNCTION public.aux_drept() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;
CREATE VIEW public.v_drept WITH (security_invoker = on) AS SELECT p.id, public.aux_drept() AS permis FROM public.profiles p;
CREATE FUNCTION public.poarta(p_site bigint) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ BEGIN RETURN EXISTS (SELECT 1 FROM public.v_drept v WHERE v.id = auth.uid() AND v.permis); END $f$;
REVOKE ALL ON FUNCTION public.poarta(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poarta(bigint) TO authenticated;
SQL
)" >/dev/null
CONN_OPT=(--tinta-host 127.0.0.1 --tinta-port "$PORT" --tinta-db "$DB" --tinta-sistem "$SIS" --user postgres)
citeste() { # => GLOBAL (md5) pe stdout
  local o="$TMP/citire_$1.txt"
  PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/amprenta_globala_citire.sh" "${CONN_OPT[@]}" >"$o" 2>"$o.err" || { cat "$o" "$o.err"; fail "citirea $1"; }
  awk -F'\t' '$1 == "GLOBAL" {print $4}' "$o"
}
mkdir "$TMP/mig"
migrare() { # $1 numele, $2 corpul (dupa garda de start) => calea
  local f="$TMP/mig/$1.sql"
  printf "DO \$g\$ BEGIN\n  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '%s:' || txid_current() THEN RAISE EXCEPTION 'RUNNER'; END IF;\nEND \$g\$;\n%s\n" "$1" "$2" >"$f"
  echo "$f"
}
manifest() { # $1 migrarea, $2 versiunea, restul = optiuni (ex. plafonul) => manifestul in $TMP/man_<nume>/
  local n; n="$(basename "$1" .sql)"; mkdir -p "$TMP/man_$n"; rm -f -- "$TMP/man_$n/$n.l15.tsv"   # generatorul cere fisier NOU (cazul d regenereaza)
  PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/livrare_l15_manifest.sh" --migrare "$1" --versiune "$2" "${CONN_OPT[@]}" "${@:3}" \
    --iesire "$TMP/man_$n/$n.l15.tsv" >"$TMP/man_$n.log" 2>&1 || { cat "$TMP/man_$n.log"; fail "generarea manifestului $n"; }
  echo "$TMP/man_$n/$n.l15.tsv"
}
runner() { # $1 versiunea, $2 fisierul, restul = optiuni suplimentare
  local sha; sha="$(sha256sum "$2" | cut -d' ' -f1)"
  PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$2" --sha256 "$sha" --versiune "$1" "${CONN_OPT[@]}" "${@:3}"
}
asteapta() { # $1 eticheta, $2 codul asteptat, $3 jurnalul, restul = comanda
  local et="$1" exp="$2" log="$3" rc=0; shift 3
  "$@" >"$log" 2>&1 || rc=$?
  [[ "$rc" == "$exp" ]] || { cat "$log"; fail "$et: cod $rc, asteptat $exp"; }
}
inregistrat() { q "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name = '$1'"; }

# Migrarea de lucru: tabel nou cu FK spre sites + politica pe poarta + functie (obiecte implicite incluse).
CORP_OK="CREATE TABLE public.nou_l15 (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, site_id bigint NOT NULL REFERENCES public.sites(id));
ALTER TABLE public.nou_l15 ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_nou ON public.nou_l15 FOR SELECT TO authenticated USING (public.poarta(site_id));
GRANT SELECT ON public.nou_l15 TO authenticated;"

# e. Argumente: o optiune fara cealalta => 2, fara conexiune.
M_E="$(migrare 20990201a_l15_fara "CREATE TABLE public.t_fara (id int);")"
asteapta 'o optiune' 2 "$TMP/e_arg.log" runner 20990201000001 "$M_E" --amprenta-globala "$(printf 0%.0s {1..32})"
asteapta 'fara optiuni' 0 "$TMP/e_fara.log" runner 20990201000001 "$M_E" --plafon-tranzactie-ms 2000
! grep -q 'AMPRENTA_GLOBALA\|L15' "$TMP/e_fara.log" || fail 'fara optiuni: jurnalul mentioneaza pasii L15'
echo 'L15_E: o optiune fara cealalta => 2; fara optiuni => APLICAT (0), nicio urma a pasilor'

# a. Contraexemplul: auxiliarul vederii schimbat dupa citirea baseline-ului => refuz la „inainte”.
M_A="$(migrare 20990202a_l15_a "$CORP_OK")"
G0="$(citeste a0)"; MAN_A="$(manifest "$M_A" 20990202000001 --plafon-tranzactie-ms 2000)"
q 'CREATE OR REPLACE FUNCTION public.aux_drept() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT now() IS NOT NULL $f$' >/dev/null
asteapta 'a contraexemplu' 10 "$TMP/a.log" runner 20990202000001 "$M_A" --plafon-tranzactie-ms 2000 --amprenta-globala "$G0" --diferente-globale "$MAN_A"
grep -q 'AMPRENTA_GLOBALA_INAINTE' "$TMP/a.log" || { cat "$TMP/a.log"; fail 'a: motivul nu e AMPRENTA_GLOBALA_INAINTE'; }
[[ "$(inregistrat 20990202a_l15_a)" == 0 && "$(q "SELECT to_regclass('public.nou_l15') IS NULL")" == t ]] || fail 'a: ceva aplicat'
q 'CREATE OR REPLACE FUNCTION public.aux_drept() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$' >/dev/null
[[ "$(citeste a1)" == "$G0" ]] || fail 'a: auxiliarul readus, dar GLOBAL nu revine'
echo 'L15_A: auxiliarul vederii citite de poarta schimbat dupa baseline => AMPRENTA_GLOBALA_INAINTE, NEAPLICAT (10)'

# c. Manifest gresit => refuz la „dupa” cu motivul exact.
L1="$(grep -v '^#' "$MAN_A" | head -n 1)"
mkdir -p "$TMP/c_lipsa" "$TMP/c_plus" "$TMP/c_alta"
grep -vxF "$L1" "$MAN_A" >"$TMP/c_lipsa/20990202a_l15_a.l15.tsv"
{ cat "$MAN_A"; printf 'functie\tfunctie public.inexistenta()\tcreat\t%s\n' "$(printf f%.0s {1..32})"; } >"$TMP/c_plus/20990202a_l15_a.l15.tsv"
awk -v l="$L1" -v f="$(printf f%.0s {1..32})" 'BEGIN {FS = OFS = "\t"} $0 == l {$NF = f} {print}' "$MAN_A" >"$TMP/c_alta/20990202a_l15_a.l15.tsv"
for c in lipsa:NEDECLARAT plus:ABSENT alta:ALTFEL; do
  asteapta "c $c" 10 "$TMP/c_${c%%:*}.log" runner 20990202000001 "$M_A" --plafon-tranzactie-ms 2000 --amprenta-globala "$G0" \
    --diferente-globale "$TMP/c_${c%%:*}/20990202a_l15_a.l15.tsv"
  grep -q "AMPRENTA_GLOBALA_DUPA: [0-9]* diferente fata de manifest.*${c##*:}" "$TMP/c_${c%%:*}.log" || { cat "$TMP/c_${c%%:*}.log"; fail "c $c: motivul"; }
  [[ "$(inregistrat 20990202a_l15_a)" == 0 ]] || fail "c $c: inregistrat"
done
echo 'L15_C: manifest cu rand lipsa / in plus / alta amprenta => NEAPLICAT (10): NEDECLARAT / ABSENT / ALTFEL'

# b. DDL comis de ALTA sesiune intre „inainte” si „dupa”, cu bariera (lock consultativ tinut de test).
BAR=7770001
BI=0; LIT=(x a b c d e f g h)
bariera() { # $1 eticheta, $2 cu_ddl|fara_ddl, $3 codul asteptat, restul = optiuni de forma (plafon)
  local et="$1" mod="$2" exp="$3" n v k rc h
  shift 3
  BI=$((BI + 1)); n="20990203${LIT[$BI]}_l15_bariera"; v="2099020300000$BI"
  local m; m="$(migrare "$n" "SELECT pg_advisory_xact_lock($BAR);
CREATE TABLE public.t_bariera_$BI (id int);")"
  local g; g="$(citeste "b_$et")"
  local man; man="$(manifest "$m" "$v" "$@")"
  # tinatorul barierei: lock de sesiune, apoi asteapta pana e oprit
  "$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -c "SELECT pg_advisory_lock($BAR), pg_sleep(120)" >/dev/null 2>&1 &
  h=$!; PIDS+=("$h")
  for k in $(seq 1 100); do [[ "$(q "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = $BAR AND granted")" == 1 ]] && break; sleep 0.1; done
  ( c=0; runner "$v" "$m" --amprenta-globala "$g" --diferente-globale "$man" "$@" >"$TMP/b_$et.log" 2>&1 || c=$?; echo "$c" >"$TMP/b_$et.rc" ) &
  PIDS+=("$!")
  # livrarea a trecut de pasul „inainte” si asteapta la bariera
  for k in $(seq 1 300); do [[ "$(q "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = $BAR AND NOT granted")" == 1 ]] && break; sleep 0.1; done
  [[ "$(q "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = $BAR AND NOT granted")" == 1 ]] || { cat "$TMP/b_$et.log"; fail "b $et: livrarea nu a ajuns la bariera"; }
  [ "$mod" != cu_ddl ] || q 'CREATE OR REPLACE FUNCTION public.aux_drept() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT 2 > 1 $f$' >/dev/null
  qa "SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND objid = $BAR AND granted" >/dev/null
  for k in $(seq 1 600); do [ -s "$TMP/b_$et.rc" ] && break; sleep 0.1; done
  rc="$(cat "$TMP/b_$et.rc" 2>/dev/null || echo NECUNOSCUT)"
  [[ "$rc" == "$exp" ]] || { cat "$TMP/b_$et.log"; fail "b $et: cod $rc, asteptat $exp"; }
  grep -q 'AMPRENTA_GLOBALA inainte: .* = aprobat' "$TMP/b_$et.log" || { cat "$TMP/b_$et.log"; fail "b $et: pasul inainte nu a trecut"; }
  if [ "$mod" = cu_ddl ]; then
    grep -q 'AMPRENTA_GLOBALA_DUPA: .*NEDECLARAT schimbat functie public.aux_drept()' "$TMP/b_$et.log" || { cat "$TMP/b_$et.log"; fail "b $et: motivul"; }
    [[ "$(inregistrat "$n")" == 0 ]] || fail "b $et: inregistrat"
    q 'CREATE OR REPLACE FUNCTION public.aux_drept() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$' >/dev/null
  else
    [[ "$(inregistrat "$n")" == 1 ]] || fail "b $et: neinregistrat"
  fi
}
bariera fara_plafon_ddl cu_ddl 10
bariera fara_plafon_control fara_ddl 0
bariera plafon_ddl cu_ddl 10 --plafon-tranzactie-ms 60000
bariera plafon_control fara_ddl 0 --plafon-tranzactie-ms 60000
echo 'L15_B: DDL comis de alta sesiune intre inainte si dupa (bariera) => NEDECLARAT, NEAPLICAT (10), cu si fara plafon; control fara DDL => APLICAT (0)'

# d. Drumul bun, cu plafon 2000 (forma „un mesaj”).
G1="$(citeste d0)"; MAN_D="$(manifest "$M_A" 20990202000001 --plafon-tranzactie-ms 2000)"
asteapta 'd drum bun' 0 "$TMP/d.log" runner 20990202000001 "$M_A" --plafon-tranzactie-ms 2000 --amprenta-globala "$G1" --diferente-globale "$MAN_D"
grep -q 'APLICAT + ÎNREGISTRAT confirmat' "$TMP/d.log" && grep -q 'AMPRENTA_GLOBALA dupa: [0-9]* diferente = manifestul' "$TMP/d.log" || { cat "$TMP/d.log"; fail 'd: mesajele'; }
[[ "$(citeste d1)" != "$G1" ]] || fail 'd: GLOBAL neschimbat dupa livrare'
echo "L15_D: drumul bun => APLICAT + INREGISTRAT (0); $(grep -o 'AMPRENTA_GLOBALA dupa: [0-9]* diferente' "$TMP/d.log")"

# g. Proba cu ROLLBACK pe tinta: diferenta obtinuta = manifestul => IDENTIC; nimic comis.
M_G="$(migrare 20990205a_l15_g "CREATE TABLE public.t_proba_g (id bigint PRIMARY KEY, x text);")"
G_G="$(citeste g0)"; MAN_G="$(manifest "$M_G" 20990205000001 --plafon-tranzactie-ms 2000)"
proba() { PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/livrare_l15_manifest.sh" --migrare "$M_G" --versiune 20990205000001 "${CONN_OPT[@]}" \
  --plafon-tranzactie-ms 2000 --compara-cu "$@"; }
asteapta 'g identic' 0 "$TMP/g_ok.log" proba "$MAN_G" --amprenta-globala "$G_G"
grep -q 'IDENTIC: diferenta pe tinta = manifestul' "$TMP/g_ok.log" || { cat "$TMP/g_ok.log"; fail 'g: mesajul IDENTIC'; }
mkdir -p "$TMP/g_alt"; L1="$(grep -v '^#' "$MAN_G" | head -n 1)"
awk -v l="$L1" -v f="$(printf f%.0s {1..32})" 'BEGIN {FS = OFS = "\t"} $0 == l {$NF = f} {print}' "$MAN_G" >"$TMP/g_alt/20990205a_l15_g.l15.tsv"
asteapta 'g rand diferit' 6 "$TMP/g_alt.log" proba "$TMP/g_alt/20990205a_l15_g.l15.tsv"
grep -q '^ALTA_AMPRENTA' "$TMP/g_alt.log" || { cat "$TMP/g_alt.log"; fail 'g: ALTA_AMPRENTA lipseste'; }
asteapta 'g global gresit' 6 "$TMP/g_glob.log" proba "$MAN_G" --amprenta-globala "$(printf 0%.0s {1..32})"
[[ "$(inregistrat 20990205a_l15_g)" == 0 && "$(q "SELECT to_regclass('public.t_proba_g') IS NULL")" == t ]] || fail 'g: proba a comis ceva'
echo 'L15_G: proba cu ROLLBACK pe tinta: IDENTIC (0); rand diferit / GLOBAL gresit => 6; nimic comis'

# h. --detalii: md5(detaliu) = amprenta pentru fiecare rand; refuz in supabase/migrations.
mkdir -p "$TMP/h"
PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/livrare_l15_manifest.sh" --migrare "$M_G" --versiune 20990205000001 "${CONN_OPT[@]}" \
  --plafon-tranzactie-ms 2000 --iesire "$TMP/h/20990205a_l15_g.l15.tsv" --detalii "$TMP/h/20990205a_l15_g.l15.detalii.txt" >"$TMP/h.log" 2>&1 \
  || { cat "$TMP/h.log"; fail 'h: generarea cu --detalii'; }
NH=0
while IFS=$'\t' read -r fam et op amp; do
  det="$(awk -F'\t' -v f="$fam" -v e="$et" '$1 == f && $2 == e { print $NF }' "$TMP/h/20990205a_l15_g.l15.detalii.txt")"
  [ -n "$det" ] && [ "$(printf '%s' "$det" | md5sum | cut -d' ' -f1)" = "$amp" ] || fail "h: detaliul randului $fam / $et lipseste sau md5 != $amp"
  NH=$((NH + 1))
done < <(grep -v '^#' "$TMP/h/20990205a_l15_g.l15.tsv")
[ "$NH" -gt 3 ] || fail "h: prea putine randuri ($NH)"
grep -q '^# clona: server_version_num 17[0-9]*, rol postgres$' "$TMP/h/20990205a_l15_g.l15.tsv" || fail 'h: antetul fara server_version_num / rol'
grep -q '(AMPRENTA_GLOBALA v2)' "$TMP/h/20990205a_l15_g.l15.tsv" || fail 'h: antetul fara versiunea amprentei'
mkdir -p "$TMP/h2/supabase/migrations"
asteapta 'h detalii in migrations' 2 "$TMP/h2.log" env PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/livrare_l15_manifest.sh" --migrare "$M_G" \
  --versiune 20990205000001 "${CONN_OPT[@]}" --iesire "$TMP/h2/20990205a_l15_g.l15.tsv" --detalii "$TMP/h2/supabase/migrations/x.l15.detalii.txt"
echo "L15_H: --detalii: $NH randuri, md5(detaliu) = amprenta; antetul v2 + server_version_num + rol; refuz in supabase/migrations"

# i. Citirea: DEFINER cu cale nesigura in lant => 4; acceptarea legata de md5 => 0; alt md5 => 4.
q 'CREATE FUNCTION public.d_nesigura() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_temp, public AS $f$ SELECT EXISTS (SELECT 1 FROM sites) $f$' >/dev/null
citeste_def() { PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/amprenta_globala_citire.sh" "${CONN_OPT[@]}" --radacina 'public.d_nesigura()' "$@"; }
asteapta 'i nesigura' 4 "$TMP/i_nes.log" citeste_def
grep -q 'cale=nesigura: pg_temp lipseste sau nu e ultimul' "$TMP/i_nes.log" || { cat "$TMP/i_nes.log"; fail 'i: motivul'; }
MD5_I="$(grep -o 'DEFINER md5=[0-9a-f]\{32\}' "$TMP/i_nes.log" | head -n 1 | cut -d= -f2)"
asteapta 'i acceptata' 0 "$TMP/i_acc.log" citeste_def --definer-verificat "public.d_nesigura()=$MD5_I"
grep -q $'^SEMNALE\t[0-9]*\t[0-9]*\t[0-9]*\t0\t1$' "$TMP/i_acc.log" || { cat "$TMP/i_acc.log"; fail 'i: SEMNALE cu acceptarea'; }
asteapta 'i alt md5' 4 "$TMP/i_rau.log" citeste_def --definer-verificat "public.d_nesigura()=$(printf 0%.0s {1..32})"
q 'DROP FUNCTION public.d_nesigura()' >/dev/null
echo 'L15_I: DEFINER cu search_path = pg_temp, public => 4; acceptat cu md5-ul tiparit => 0 (SEMNALE acceptate 1); alt md5 => 4'

# k. r3 (P2): doua citiri REALE consecutive cu scriptul de amprente al migrarii (tipareste now() in antet), fara DDL intre
#    ele => --recitire 0; momentul inlocuit in sectiune, randurile MOMENT diferite.
citeste_mig() { PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/amprenta_globala_citire.sh" "${CONN_OPT[@]}" --lista \
  --amprente-migrare "$ROOT/scripts/meteo_xweather_amprente.sql" >"$1" 2>"$1.err" || { cat "$1" "$1.err"; fail "k: citirea $1"; }; }
citeste_mig "$TMP/k1.txt"; sleep 1; citeste_mig "$TMP/k2.txt"
[[ "$(grep $'^MOMENT\t' "$TMP/k1.txt")" != "$(grep $'^MOMENT\t' "$TMP/k2.txt")" ]] || fail 'k: MOMENT identic in doua citiri'
grep -qF '<momentul fotografiei>' "$TMP/k1.txt" || { cat "$TMP/k1.txt"; fail 'k: momentul nu e inlocuit in sectiunea migrarii'; }
asteapta 'k recitire' 0 "$TMP/k.log" bash "$ROOT/scripts/l15_compara_liste.sh" --a "$TMP/k1.txt" --b "$TMP/k2.txt" --recitire
grep -qF '[ok] partea revizuita IDENTICA' "$TMP/k.log" || { cat "$TMP/k.log"; fail 'k: mesajul recitirii'; }
echo 'L15_K: doua citiri reale consecutive cu meteo_xweather_amprente.sql => --recitire 0 (momentul in afara partii revizuite)'

# l. r4 (P1): triggerul recenzentului pe un tabel de la initdb, creat intre doua citiri reale; apoi RLS pe acelasi tabel.
fam_md5() { awk -F'\t' -v f="$2" '$1 == "FAMILIE" && $2 == f { print $4 }' "$TMP/citire_$1.txt"; }
ins_l15() { qa "WITH i AS (INSERT INTO information_schema.sql_features (feature_id, feature_name, sub_feature_id, sub_feature_name, is_supported) VALUES ('$1', 'x', '', '', 'NO') RETURNING feature_id) SELECT count(*) FROM i"; }
q "CREATE FUNCTION public.l15_refuza_insert() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NULL; END'" >/dev/null
G_L0="$(citeste l0)"
[[ "$(ins_l15 L15A)" == 1 ]] || fail 'l: INSERT ... RETURNING inainte de trigger'
qa 'CREATE TRIGGER l15_refuza BEFORE INSERT ON information_schema.sql_features FOR EACH ROW EXECUTE FUNCTION public.l15_refuza_insert()' >/dev/null
[[ "$(ins_l15 L15B)" == 0 ]] || fail 'l: triggerul nu opreste INSERT-ul (proba nu dovedeste nimic)'
G_L1="$(citeste l1)"
[[ "$G_L1" != "$G_L0" ]] || fail 'l: GLOBAL identic dupa triggerul pe un tabel de la initdb (P1)'
[[ "$(fam_md5 l0 trigger)" != "$(fam_md5 l1 trigger)" ]] || fail 'l: familia trigger nu s-a schimbat'
qa 'ALTER TABLE information_schema.sql_features ENABLE ROW LEVEL SECURITY' >/dev/null
G_L2="$(citeste l2)"
[[ "$G_L2" != "$G_L1" && "$(fam_md5 l1 sistem_initdb)" != "$(fam_md5 l2 sistem_initdb)" ]] || fail 'l: RLS pe un tabel de la initdb nu se vede (plasa relatiilor)'
qa 'ALTER TABLE information_schema.sql_features DISABLE ROW LEVEL SECURITY' >/dev/null
qa 'DROP TRIGGER l15_refuza ON information_schema.sql_features' >/dev/null
echo 'L15_L: trigger pe information_schema.sql_features (INSERT RETURNING 1 -> 0) => GLOBAL difera (familia trigger); RLS pe acelasi tabel => GLOBAL difera (sistem_initdb)'

# m. r4: VACUUM / ANALYZE intre doua citiri nu schimba GLOBAL (steagurile lenese relhas* nu intra).
qa 'CREATE TRIGGER l15_tmp BEFORE UPDATE ON information_schema.sql_features FOR EACH ROW EXECUTE FUNCTION public.l15_refuza_insert()' >/dev/null
qa 'DROP TRIGGER l15_tmp ON information_schema.sql_features' >/dev/null
[[ "$(qa "SELECT relhastriggers FROM pg_class WHERE oid = 'information_schema.sql_features'::regclass")" == t ]] || fail 'm: steagul relhastriggers nu e aprins (proba nu dovedeste nimic)'
G_M0="$(citeste m0)"
qa 'VACUUM information_schema.sql_features' >/dev/null; qa 'ANALYZE information_schema.sql_features' >/dev/null; qa 'ANALYZE' >/dev/null
[[ "$(qa "SELECT relhastriggers FROM pg_class WHERE oid = 'information_schema.sql_features'::regclass")" == f ]] || fail 'm: VACUUM nu a stins steagul (proba nu dovedeste nimic)'
[[ "$(citeste m1)" == "$G_M0" ]] || fail 'm: GLOBAL schimbat de VACUUM / ANALYZE (refuz fals)'
echo 'L15_M: VACUUM + ANALYZE intre doua citiri (relhastriggers t -> f) => GLOBAL identic'

# n. r4: --detalii-plasa pe citiri reale: detaliul reproduce randurile plasei; diferenta a doua detalii = obiectul schimbat.
citeste_pl() { PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/amprenta_globala_citire.sh" "${CONN_OPT[@]}" --lista --detalii-plasa "$1" >"$1.out" 2>"$1.err" \
  || { cat "$1.out" "$1.err"; fail "n: citirea cu --detalii-plasa $1"; }; }
citeste_pl "$TMP/n1.tsv"
qa 'ALTER FUNCTION pg_catalog.quote_nullable(text) STRICT' >/dev/null
citeste_pl "$TMP/n2.tsv"
qa 'ALTER FUNCTION pg_catalog.quote_nullable(text) CALLED ON NULL INPUT' >/dev/null
grep -qF '[ok] detaliul plasei scris' "$TMP/n1.tsv.err" || { cat "$TMP/n1.tsv.err"; fail 'n: mesajul detaliului'; }
DIF_N="$(diff <(cut -f1-3 "$TMP/n1.tsv") <(cut -f1-3 "$TMP/n2.tsv") | grep '^[<>]' || true)"
[[ "$(printf '%s\n' "$DIF_N" | grep -c .)" == 2 && "$(printf '%s\n' "$DIF_N" | grep -c 'functii.pg_catalog.quote_nullable(25)')" == 2 ]] \
  || { printf '%s\n' "$DIF_N"; fail 'n: diferenta detaliilor trebuia sa arate exact pg_catalog.quote_nullable(25)'; }
echo "L15_N: --detalii-plasa: $(grep -c . "$TMP/n1.tsv") obiecte, reproduce randurile plasei; diferenta = pg_catalog.quote_nullable(25)"

# o. r5 (P1): contraexemplul recenzentului pe PG17 - o partitie de la initdb reatasata cu alta limita intre doua citiri reale;
#    apoi lista inchisa a coloanelor plasei pe catalogul PG17 (fiecare coloana a pg_class / pg_proc / pg_aggregate clasificata).
ins_o() { qa "BEGIN; INSERT INTO public.l15_partition_probe (feature_id) VALUES ('ZZZZ') RETURNING feature_id; ROLLBACK" 2>&1 || true; }
fam_o() { awk -F'\t' '$1 == "FAMILIE" { print $2 "\t" $4 }' "$1"; }
qa 'CREATE TABLE public.l15_partition_probe (LIKE information_schema.sql_features) PARTITION BY RANGE (feature_id)' >/dev/null
qa "ALTER TABLE public.l15_partition_probe ATTACH PARTITION information_schema.sql_features FOR VALUES FROM (MINVALUE) TO ('ZZZ')" >/dev/null
INS_O0="$(ins_o)"
grep -q 'no partition of relation' <<<"$INS_O0" || { printf '%s\n' "$INS_O0"; fail 'o: INSERT-ul trebuia sa pice inainte (23514)'; }
citeste_pl "$TMP/o1.tsv"
qa 'ALTER TABLE public.l15_partition_probe DETACH PARTITION information_schema.sql_features' >/dev/null
qa 'ALTER TABLE public.l15_partition_probe ATTACH PARTITION information_schema.sql_features FOR VALUES FROM (MINVALUE) TO (MAXVALUE)' >/dev/null
[[ "$(ins_o)" == ZZZZ ]] || { ins_o; fail 'o: INSERT ... RETURNING trebuia sa treaca dupa reatasare (proba nu dovedeste nimic)'; }
citeste_pl "$TMP/o2.tsv"
G_O1="$(awk -F'\t' '$1 == "GLOBAL" {print $4}' "$TMP/o1.tsv.out")"; G_O2="$(awk -F'\t' '$1 == "GLOBAL" {print $4}' "$TMP/o2.tsv.out")"
[[ -n "$G_O1" && "$G_O1" != "$G_O2" ]] || fail 'o: GLOBAL identic dupa reatasarea partitiei cu alta limita (P1 r4)'
FAM_O="$( { diff <(fam_o "$TMP/o1.tsv.out") <(fam_o "$TMP/o2.tsv.out") || true; } | { grep '^[<>]' || true; } | cut -c3- | cut -f1 | sort -u | tr '\n' ' ')"
[[ "$FAM_O" == 'sistem_initdb ' ]] || fail "o: familiile schimbate [$FAM_O] (asteptat doar sistem_initdb)"
DIF_O="$(diff <(cut -f1-3 "$TMP/o1.tsv") <(cut -f1-3 "$TMP/o2.tsv") | grep '^[<>]' || true)"
[[ "$(printf '%s\n' "$DIF_O" | grep -c .)" == 2 && "$(printf '%s\n' "$DIF_O" | grep -c 'relatii.information_schema.sql_features')" == 2 ]] \
  || { printf '%s\n' "$DIF_O"; fail 'o: diferenta detaliilor trebuia sa arate exact information_schema.sql_features'; }
grep -F "information_schema.sql_features" "$TMP/o1.tsv" | grep -qF "FOR VALUES FROM (MINVALUE) TO ('ZZZ')" || fail 'o: limita canonica lipseste din detaliul plasei'
qa 'ALTER TABLE public.l15_partition_probe DETACH PARTITION information_schema.sql_features' >/dev/null
qa 'DROP TABLE public.l15_partition_probe' >/dev/null
# lista inchisa pe PG17: fiecare coloana a catalogului e clasificata; in lista, in plus fata de PG17, doar coloanele PG18 numite
LST_O="$(tr -d '\r' <"$ROOT/scripts/amprenta_globala_v2.sql" | awk '$0 == "-- <<< AG_PLASA_COLOANE v2" { p = 0 } p && $2 ~ /^pg_(class|proc|aggregate)$/ { print $2 "." $3 } $0 == "-- >>> AG_PLASA_COLOANE v2" { p = 1 }' | sort)"
COL_O="$(qa "SELECT c.relname || '.' || a.attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.oid IN ('pg_catalog.pg_class'::regclass, 'pg_catalog.pg_proc'::regclass, 'pg_catalog.pg_aggregate'::regclass) AND a.attnum > 0 AND NOT a.attisdropped" | sort)"
REST_O="$(comm -23 <(printf '%s\n' "$COL_O") <(printf '%s\n' "$LST_O") | tr '\n' ' ')"
PLUS_O="$(comm -13 <(printf '%s\n' "$COL_O") <(printf '%s\n' "$LST_O") | tr '\n' ' ')"
DUBL_O="$(printf '%s\n' "$LST_O" | uniq -d | tr '\n' ' ')"
[[ -z "$REST_O" && -z "$DUBL_O" && "$PLUS_O" == 'pg_class.relallfrozen ' ]] || fail "o: lista inchisa pe PG17: neclasificate [$REST_O], dubluri [$DUBL_O], in plus [$PLUS_O] (asteptat doar pg_class.relallfrozen, PG18)"
echo "L15_O: partitia de la initdb reatasata cu alta limita (INSERT 23514 -> ZZZZ) => GLOBAL difera, doar sistem_initdb, detaliul = information_schema.sql_features; lista inchisa: $(printf '%s\n' "$COL_O" | grep -c .) coloane PG17 clasificate (in plus doar relallfrozen, PG18)"

# j. Contraexemplul grantorului pe PG17, prin runner: transferul g1 -> g2 dupa citire => refuz la „inainte”.
qa "CREATE ROLE g1; CREATE ROLE g2; CREATE ROLE r_gr; CREATE TABLE public.t_gr (id int); ALTER TABLE public.t_gr OWNER TO postgres;
GRANT SELECT ON public.t_gr TO g1, g2 WITH GRANT OPTION; SET ROLE g1; GRANT SELECT ON public.t_gr TO r_gr; RESET ROLE;" >/dev/null
M_J="$(migrare 20990206a_l15_j "CREATE TABLE public.t_j (id int);")"
G_J="$(citeste j0)"; MAN_J="$(manifest "$M_J" 20990206000001 --plafon-tranzactie-ms 2000)"
qa "SET ROLE g1; REVOKE SELECT ON public.t_gr FROM r_gr; RESET ROLE; SET ROLE g2; GRANT SELECT ON public.t_gr TO r_gr; RESET ROLE;" >/dev/null
[[ "$(qa "SELECT relacl::text FROM pg_class WHERE oid = 'public.t_gr'::regclass")" == *"r_gr=r/g2"* ]] || fail 'j: transferul nu s-a facut'
asteapta 'j grantor' 10 "$TMP/j.log" runner 20990206000001 "$M_J" --plafon-tranzactie-ms 2000 --amprenta-globala "$G_J" --diferente-globale "$MAN_J"
grep -q 'AMPRENTA_GLOBALA_INAINTE' "$TMP/j.log" || { cat "$TMP/j.log"; fail 'j: motivul nu e AMPRENTA_GLOBALA_INAINTE'; }
[[ "$(inregistrat 20990206a_l15_j)" == 0 ]] || fail 'j: inregistrat'
echo 'L15_J: grantorul transferat g1 -> g2 dupa citire => AMPRENTA_GLOBALA_INAINTE, NEAPLICAT (10)'

# f. Timpul pe un catalog sintetic.
{
  for i in $(seq 0 299); do
    printf 'CREATE TABLE public.t%s (id bigint PRIMARY KEY, a text, b int, c numeric, d timestamptz DEFAULT now(), e boolean DEFAULT false, f jsonb, g uuid);\n' "$i"
    printf 'CREATE INDEX t%s_b ON public.t%s (b); ALTER TABLE public.t%s ENABLE ROW LEVEL SECURITY;\n' "$i" "$i" "$i"
    printf 'CREATE POLICY p%s ON public.t%s FOR SELECT TO authenticated USING (public.poarta(id)); GRANT SELECT ON public.t%s TO authenticated;\n' "$i" "$i" "$i"
    (( i % 6 )) || printf 'CREATE VIEW public.v%s WITH (security_invoker = on) AS SELECT id, a, b FROM public.t%s WHERE b > 0;\n' "$i" "$i"
  done
  for i in $(seq 0 1499); do
    printf 'CREATE FUNCTION public.f%s(p bigint) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ DECLARE v int; BEGIN SELECT count(*) INTO v FROM public.t%s WHERE id = p; IF v > 0 THEN RETURN public.poarta(p); END IF; RETURN false; END $f$;\n' "$i" $(( i % 300 ))
  done
} >"$TMP/sintetic.sql"
"$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -f "$TMP/sintetic.sql" >/dev/null
timp() { # $1 eticheta, $2 numele migrarii, $3 versiunea
  local m v="$3"; m="$(migrare "$2" "CREATE TABLE public.timp_$1 (id int PRIMARY KEY);")"
  local g; g="$(citeste "f_$1")"; local man; man="$(manifest "$m" "$v" --plafon-tranzactie-ms 2000)"
  [ "$1" != rece ] || { "$PG_BIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null; porneste; }
  asteapta "f $1" 0 "$TMP/f_$1.log" runner "$v" "$m" --plafon-tranzactie-ms 2000 --amprenta-globala "$g" --diferente-globale "$man"
  echo "L15_F_TIMP $1 ($(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')") functii, $(q "SELECT count(*) FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace") tabele):"
  grep -E 'AMPRENTA_GLOBALA (inainte|dupa)|LIVRARE_TIMP|PLAFON_TIMP' "$TMP/f_$1.log" | sed 's/^.*NOTICE: */    /'
}
timp rece 20990204a_l15_timp_rece 20990204000001
timp cald 20990204b_l15_timp_cald 20990204000002
echo 'PASS test_livrare_l15_v2: a contraexemplul vederii (inainte), b DDL concurent cu bariera (dupa, cu si fara plafon), c manifest gresit, d drumul bun, e fara optiuni, g proba --compara-cu, h --detalii, i DEFINER nesigur / acceptat, j grantorul, k recitirea reala, l triggerul / RLS pe un tabel de la initdb, m VACUUM / ANALYZE, n detaliul plasei, o limita partitiei de la initdb + lista inchisa, f timpii (mai sus)'
