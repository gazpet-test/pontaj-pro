#!/usr/bin/env bash
# ============================================================================
# PROBA PE PRODUCTIE (dry run, ROLLBACK) a livrarii E1: 20261118a apoi 20261119a, IN FORMA EXACTA DE LIVRARE CU PLAFON
# 2000 (runda 14 a runnerului, forma „un mesaj”), intr-O tranzactie care se termina cu ROLLBACK. Pentru coordonator, cu
# owner-ul pe manual. NU comite nimic; nu atinge drepturi / secrete; nu trimite nimic in afara bazei.
#
# Ce face:
#   0. refuz local (fara conexiune): argumente pe lista alba, variabilele de mediu respinse ca la runner, parola DOAR din
#      ~/.pgpass / PGPASSFILE;
#   1. GENERARE cu runnerul oficial (scripts/livrare_migrare.sh --genereaza-in, cod 40, FARA conexiune): pentru fiecare
#      migrare copia protejata + sha256 + validatorul cu plafon + fisierele runnerului (0_prolog, 1_pre, 3_inreg) — exact
#      textul livrarii;
#   2. MESAJUL: aceeasi biblioteca (scripts/livrare_mesaj.sh) ca livrarea: BEGIN; prolog; verificarea un mesaj (cu AMBELE
#      copii); [1_pre 18a; copia 18a; ;; 3_inreg 18a; LIVRARE_TIMP]; [la fel 19a]; garda finala; ROLLBACK — verificat
#      independent (scripts/test_livrare_mesaj_unic.py) inainte de conexiune. Singura diferenta fata de doua livrari:
#      ambele migrari sunt in ACEEASI tranzactie (19a are nevoie de 18a), deci impart acelasi plafon de 2000 ms — mai
#      strict decat livrarea reala (fiecare cu 2000 ms ai ei). Cu --doar-18a: doar 18a (exact livrarea 18a, cu ROLLBACK);
#   3. INAINTE: conexiune read-only: db, system_identifier (REFUZ daca nu e cel dat), in_recovery = false, versiunea,
#      drumul client-server (10 x „SELECT 1;”), AMPRENTA schemei (relatii, coloane, constrangeri, functii, triggere,
#      politici, roluri, membri, istoricul migrarilor; fara date, fara valori de secvente);
#   4. PROBA: aceeasi conexiune ca livrarea: SET transaction_timeout = 2000; mesajul (\gexec); RESET. Jurnalul (NOTICE)
#      se pastreaza; se tiparesc timpii: lock-uri (PORTAL_LOCKS), sfarsitul fiecarei migrari (LIVRARE_TIMP), garda
#      (PLAFON_TIMP), total;
#   5. DUPA: aceeasi amprenta (TREBUIE identica) + istoricul fara 18a / 19a.
# Cod de iesire: 0 PROBA OK (garda trecuta, ROLLBACK, amprenta identica) | 1 PROBA PICATA (refuz / timeout / garda;
#   amprenta identica, nimic schimbat) | 2 argumente | 3 generare / verificare locala | 22 tinta neconfirmata (inainte de
#   proba, nimic trimis) | 5 AMPRENTA DIFERITA dupa proba (se analizeaza manual; o alta sesiune poate fi schimbat schema
#   intre timp) | 6 conexiunea de amprenta a esuat.
#
# Utilizare (Git Bash pe serverul de livrare; PSQL_BIN = psql-ul folosit la livrare):
#   PSQL_BIN=<psql-ul folosit la livrare> bash scripts/portal/dry_prod_e1.sh \
#     --tinta-host <endpointul de scriere aprobat> --tinta-port <portul lui> --tinta-db postgres \
#     --tinta-sistem <system_identifier> --user <utilizatorul de livrare> \
#     [--versiune-18a AAAALLZZHHMMSS] [--versiune-19a AAAALLZZHHMMSS] [--doar-18a] [--jurnal <dosar_nou>]
#   Versiunile implicite (20261118120000 / 20261119120000) trebuie sa fie LIBERE in istoric (1_pre refuza altfel).
# ============================================================================
set -Eeuo pipefail
umask 077
refuz() { echo "REFUZ (nimic trimis): $2" >&2; exit "$1"; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLAFON_MS=2000
M18="$ROOT/supabase/migrations/20261118a_portal_teren_identitate.sql"
M19="$ROOT/supabase/migrations/20261119a_portal_teren_provisioning.sql"
H="" P="" D="" SIS="" U="" V18=20261118120000 V19=20261119120000 DOAR18=0 JURNAL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --doar-18a) DOAR18=1; shift; continue ;;
  esac
  [ $# -ge 2 ] || refuz 2 "optiunea $1 fara valoare"
  case "$1" in
    --tinta-host) H="$2" ;; --tinta-port) P="$2" ;; --tinta-db) D="$2" ;; --tinta-sistem) SIS="$2" ;; --user) U="$2" ;;
    --versiune-18a) V18="$2" ;; --versiune-19a) V19="$2" ;; --jurnal) JURNAL="$2" ;;
    *) refuz 2 "optiune nepermisa: $1" ;;
  esac
  shift 2
done
for v in PGPASSWORD PGOPTIONS PGDATABASE PSQLRC PGHOSTADDR PGTARGETSESSIONATTRS PGLOADBALANCEHOSTS PGSERVICE PGSERVICEFILE PGSYSCONFDIR; do
  [ -z "${!v+x}" ] || refuz 2 "variabila $v e setata (parola: ~/.pgpass / PGPASSFILE)"
done
unset PGHOST PGPORT
[[ "$H" =~ ^[A-Za-z0-9._-]{1,253}$ ]] || refuz 2 "--tinta-host obligatoriu"
[[ "$P" =~ ^[0-9]{1,5}$ ]] || refuz 2 "--tinta-port obligatoriu"
[[ "$D" =~ ^[A-Za-z0-9_]{1,63}$ ]] || refuz 2 "--tinta-db obligatoriu"
[[ "$SIS" =~ ^[0-9]{1,20}$ ]] || refuz 2 "--tinta-sistem obligatoriu (system_identifier)"
[[ "$U" =~ ^[A-Za-z0-9_.-]{1,63}$ ]] || refuz 2 "--user obligatoriu"
[[ "$V18" =~ ^[0-9]{14}$ && "$V19" =~ ^[0-9]{14}$ && "$V18" != "$V19" ]] || refuz 2 "versiuni invalide"
[ -f "$M18" ] && [ -f "$M19" ] || refuz 3 "migrarile lipsesc din $ROOT/supabase/migrations"
PSQL="${PSQL_BIN:-psql}"
export PGCLIENTENCODING=UTF8
W="$(mktemp -d)"; trap 'chmod -R u+w "$W" 2>/dev/null; rm -rf "$W"' EXIT
if [ -n "$JURNAL" ]; then
  [ ! -e "$JURNAL" ] && [ -d "$(dirname "$JURNAL")" ] || refuz 2 "--jurnal: dosarul trebuie sa fie NOU: $JURNAL"
  mkdir -- "$JURNAL"
else
  JURNAL="$W/jurnal"; mkdir -- "$JURNAL"
fi
SHA18="$(sha256sum "$M18" | cut -d' ' -f1)"; SHA19="$(sha256sum "$M19" | cut -d' ' -f1)"
echo "→ artefacte: 20261118a sha256 $SHA18; 20261119a sha256 $SHA19 (compara-le cu cele aprobate)"

# 1. Generare cu runnerul oficial, fara conexiune (cod 40).
genereaza() { # $1 artefactul, $2 sha, $3 versiunea, $4 dosarul (nou)
  local rc=0
  PSQL_BIN=/nu/se/foloseste bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$1" --sha256 "$2" --versiune "$3" \
    --tinta-db "$D" --tinta-sistem "$SIS" --tinta-host "$H" --tinta-port "$P" --user "$U" \
    --plafon-tranzactie-ms "$PLAFON_MS" --genereaza-in "$4" >"$4.log" 2>&1 || rc=$?
  [ "$rc" = 40 ] || { cat "$4.log" >&2; refuz 3 "generarea cu runnerul a esuat pentru $(basename "$1") (cod $rc, asteptat 40)"; }
}
genereaza "$M18" "$SHA18" "$V18" "$W/g18"
[ "$DOAR18" = 1 ] || genereaza "$M19" "$SHA19" "$V19" "$W/g19"
N18="$(basename "$M18" .sql)"; N19="$(basename "$M19" .sql)"

# 2. Mesajul: aceeasi biblioteca ca livrarea; ROLLBACK in loc de COMMIT.
# shellcheck source=../livrare_mesaj.sh
. "$ROOT/scripts/livrare_mesaj.sh"
REST="$W/m_rest.sql"; FELII=()
adauga() { # $1 dosarul generat, $2 numele migrarii, $3 sha
  cat "$1/1_pre.sql" >>"$REST"
  FELII+=("$(lm_octeti "$REST"):$(lm_octeti "$1/$2.sql"):$3")
  { cat "$1/$2.sql"; lm_sep; cat "$1/3_inreg.sql"; lm_timp "$2"; } >>"$REST"
}
: >"$REST"
adauga "$W/g18" "$N18" "$SHA18"
[ "$DOAR18" = 1 ] || adauga "$W/g19" "$N19" "$SHA19"
lm_fin dry_prod_e1 "$PLAFON_MS" ROLLBACK >>"$REST" || refuz 3 "garda finala"
lm_mesaj "$W/g18/0_prolog.sql" "$REST" "$W/m_mesaj.sql" dry_prod_e1 "${FELII[@]}" || refuz 3 "construirea mesajului"
TAG_M="lm_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
lm_trimite "$W/m_mesaj.sql" "$TAG_M" "$W/5_mesaj.sql" || refuz 3 "fisierul de trimitere"
python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$W/5_mesaj.sql" "$W/g18/$N18.sql" "$SHA18" "$PLAFON_MS" ROLLBACK \
  || refuz 3 "verificarea locala a mesajului (18a)"
[ "$DOAR18" = 1 ] || python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$W/5_mesaj.sql" "$W/g19/$N19.sql" "$SHA19" "$PLAFON_MS" ROLLBACK \
  || refuz 3 "verificarea locala a mesajului (19a)"
cp -- "$W/g18/00_sesiune.sql" "$W/g18/9_reset.sql" "$W/"
cp -- "$W/m_mesaj.sql" "$JURNAL/mesaj_tranzactie.sql"
echo "→ mesajul tranzactiei: $(lm_octeti "$W/m_mesaj.sql") octeti, un singur mesaj de la BEGIN la ROLLBACK ($( [ "$DOAR18" = 1 ] && echo 18a || echo '18a + 19a'))"

CONN=(-h "$H" -p "$P" -U "$U" -d "$D")
# 3. / 5. Amprenta (read-only, fara plafon) + tinta. Rezultat pe o linie: db|system_identifier|in_recovery|versiune|md5|istoric
cat >"$W/amprenta.sql" <<'SQL'
SET transaction_timeout = 0;
BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
SELECT current_database() || '|' || (SELECT system_identifier::text FROM pg_control_system()) || '|' ||
       pg_is_in_recovery()::text || '|' || current_setting('server_version_num') || '|' ||
       md5(coalesce((SELECT string_agg(x, E'\n' ORDER BY x) FROM (
         SELECT 'n|' || n.nspname || '|' || pg_get_userbyid(n.nspowner) || '|' || coalesce(n.nspacl::text, '') AS x
           FROM pg_namespace n WHERE n.nspname !~ '^pg_(toast_)?temp_'
         UNION ALL
         SELECT 'c|' || c.oid::regclass::text || '|' || c.relkind::text || '|' || pg_get_userbyid(c.relowner) || '|' ||
                coalesce(c.relacl::text, '') || '|' || c.relrowsecurity::text || c.relforcerowsecurity::text
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname !~ '^pg_(toast_)?temp_' AND n.nspname <> 'pg_toast'
         UNION ALL
         SELECT 'a|' || a.attrelid::regclass::text || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' ||
                a.attnotnull::text || '|' || coalesce(a.attacl::text, '')
           FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE a.attnum > 0 AND NOT a.attisdropped AND n.nspname !~ '^pg_(toast_)?temp_' AND n.nspname <> 'pg_toast'
         UNION ALL
         SELECT 'k|' || co.conrelid::regclass::text || '|' || co.conname || '|' || pg_get_constraintdef(co.oid)
           FROM pg_constraint co JOIN pg_namespace n ON n.oid = co.connamespace WHERE n.nspname !~ '^pg_(toast_)?temp_'
         UNION ALL
         SELECT 'f|' || p.oid::regprocedure::text || '|' || md5(p.prosrc) || '|' || p.prosecdef::text || '|' ||
                pg_get_userbyid(p.proowner) || '|' || coalesce(p.proacl::text, '') || '|' || coalesce(p.proconfig::text, '')
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname !~ '^pg_(toast_)?temp_'
         UNION ALL
         SELECT 't|' || t.tgrelid::regclass::text || '|' || t.tgname || '|' || t.tgenabled::text || '|' || t.tgfoid::regprocedure::text
           FROM pg_trigger t
         UNION ALL
         SELECT 'p|' || pol.polrelid::regclass::text || '|' || pol.polname || '|' || pol.polcmd::text || '|' || pol.polroles::text || '|' ||
                coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
           FROM pg_policy pol
         UNION ALL
         SELECT 'r|' || r.rolname || '|' || r.rolsuper::text || r.rolinherit::text || r.rolcreaterole::text || r.rolcreatedb::text ||
                r.rolcanlogin::text || r.rolreplication::text || r.rolbypassrls::text
           FROM pg_roles r
         UNION ALL
         SELECT 'm|' || m.roleid::regrole::text || '|' || m.member::regrole::text FROM pg_auth_members m
         UNION ALL
         SELECT 's|' || s.version || '|' || coalesce(s.name, '') FROM supabase_migrations.schema_migrations s) z), '')) || '|' ||
       (SELECT count(*) FROM supabase_migrations.schema_migrations
         WHERE name IN ('20261118a_portal_teren_identitate', '20261119a_portal_teren_provisioning'));
COMMIT;
SQL
amprenta() { # $1 eticheta -> AMP (linia)
  "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -f "$W/amprenta.sql" "${CONN[@]}" >"$JURNAL/amprenta_$1.out" 2>&1 \
    || { cat "$JURNAL/amprenta_$1.out" >&2; echo "✗ amprenta $1: conexiunea / interogarea a esuat" >&2; exit 6; }
  # psql nativ pe Windows scrie CRLF: CR-ul se scoate inainte de comparare
  AMP="$(tr -d '\r' <"$JURNAL/amprenta_$1.out" | grep -E '^[A-Za-z0-9_]+\|[0-9]+\|(true|false)\|[0-9]+\|[0-9a-f]{32}\|[0-9]+$' | tail -n 1)" || true
  [ -n "$AMP" ] || { cat "$JURNAL/amprenta_$1.out" >&2; echo "✗ amprenta $1: rezultat nerecunoscut" >&2; exit 6; }
}
amprenta inainte
IFS='|' read -r A_DB A_SIS A_REC A_VER A_MD5 A_IST <<<"$AMP"
[ "$A_DB" = "$D" ] && [ "$A_SIS" = "$SIS" ] && [ "$A_REC" = false ] \
  || { echo "✗ TINTA NECONFIRMATA: db=$A_DB system_identifier=$A_SIS in_recovery=$A_REC (cerut $D / $SIS / false) — proba NU s-a trimis" >&2; exit 22; }
[ "$A_IST" = 0 ] || { echo "✗ 18a / 19a sunt deja in istoric ($A_IST randuri) — proba nu are sens, NU s-a trimis" >&2; exit 22; }
(( A_VER >= 170000 )) || { echo "✗ serverul nu e PostgreSQL 17 ($A_VER)" >&2; exit 22; }
for _ in 1 2 3 4 5 6 7 8 9 10; do echo 'SELECT 1;'; done >"$W/drum.sql"
t0="$(date +%s%3N)"; "$PSQL" -X -q -At -f "$W/drum.sql" "${CONN[@]}" >/dev/null 2>&1 || true; t1="$(date +%s%3N)"
echo "✓ tinta: db=$A_DB system_identifier=$A_SIS in_recovery=false PG $A_VER; amprenta inainte $A_MD5; 10 x SELECT 1 (cu conectarea) = $((t1 - t0)) ms"

# 4. Proba: exact forma livrarii (SET de sesiune; mesajul; RESET), cu ROLLBACK.
echo "→ proba: SET transaction_timeout = $PLAFON_MS; UN mesaj [BEGIN ... garda finala, ROLLBACK]; RESET"
t0="$(date +%s%3N)"; rc=0
"$PSQL" -X -q -v ON_ERROR_STOP=1 -f "$W/00_sesiune.sql" -f "$W/5_mesaj.sql" -f "$W/9_reset.sql" "${CONN[@]}" \
  >"$JURNAL/proba.out" 2>&1 || rc=$?
t1="$(date +%s%3N)"
echo "--- timpi (din jurnalul probei, ms de la BEGIN) ---"
grep -E 'PORTAL_LOCKS|LIVRARE_TIMP|PLAFON_TIMP|PORTAL_1B_RECONCILIATE' "$JURNAL/proba.out" | sed 's/^.*NOTICE: *//' || true
echo "total psql (conectare + SET + trimiterea mesajului + executie + RESET): $((t1 - t0)) ms; cod psql $rc"
REZ=0
if [ "$rc" != 0 ] || ! grep -q 'PLAFON_TIMP dry_prod_e1: garda trecuta' "$JURNAL/proba.out"; then
  REZ=1
  echo "✗ PROBA PICATA (cod psql $rc). Motivul (ultimele linii ale jurnalului):" >&2
  grep -E 'ERROR|FATAL|terminating|MESAJ_UNIC|PLAFON_|PORTAL_' "$JURNAL/proba.out" | tail -n 8 >&2 || tail -n 8 "$JURNAL/proba.out" >&2
fi

# 5. Dupa: amprenta identica, istoricul fara 18a / 19a.
amprenta dupa
IFS='|' read -r B_DB B_SIS B_REC B_VER B_MD5 B_IST <<<"$AMP"
if [ "$B_SIS" != "$SIS" ] || [ "$B_MD5" != "$A_MD5" ] || [ "$B_IST" != 0 ]; then
  echo "✗ AMPRENTA DIFERITA dupa proba: inainte $A_MD5, dupa $B_MD5 (istoric 18a/19a: $B_IST) — analiza manuala (o alta sesiune poate fi schimbat schema intre timp); jurnal: $JURNAL" >&2
  exit 5
fi
echo "✓ amprenta dupa = inainte ($B_MD5); istoricul fara 18a / 19a; nimic comis"
if [ "$REZ" = 0 ]; then
  echo "✓ PROBA OK: forma de livrare cu plafon $PLAFON_MS incape (garda trecuta, ROLLBACK); jurnal: $JURNAL"
else
  echo "✗ PROBA PICATA, nimic schimbat; jurnal: $JURNAL" >&2
fi
[ "$JURNAL" != "$W/jurnal" ] || { echo "--- jurnalul probei ---"; cat "$JURNAL/proba.out"; }
exit "$REZ"
