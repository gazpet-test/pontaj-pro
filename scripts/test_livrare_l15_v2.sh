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
#      (NOTICE-urile AMPRENTA_GLOBALA, LIVRARE_TIMP, PLAFON_TIMP) cu cache RECE (server repornit) si CALD (a doua livrare).
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
  local n; n="$(basename "$1" .sql)"; mkdir -p "$TMP/man_$n"
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
  ( runner "$v" "$m" --amprenta-globala "$g" --diferente-globale "$man" "$@" >"$TMP/b_$et.log" 2>&1; echo $? >"$TMP/b_$et.rc" ) &
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
echo 'PASS test_livrare_l15_v2: a contraexemplul vederii (inainte), b DDL concurent cu bariera (dupa, cu si fara plafon), c manifest gresit, d drumul bun, e fara optiuni, f timpii (mai sus)'
