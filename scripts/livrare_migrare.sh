#!/usr/bin/env bash
# ============================================================================
# Traseul OFICIAL de livrare pentru migrările cu gardă de livrare — runda 5 (verdict Copilot R4,
# docs/LIVRARE_MIGRARE_VERDICT_COPILOT_R4.md). Domeniu: DOAR operațiile care participă la tranzacția PostgreSQL.
#
# UN SINGUR gestionar de tranzacție = psql --single-transaction, pe O COPIE locală protejată a artefactului APROBAT:
#   0. înainte de conexiune: argumente pe listă albă, copie unică (mktemp, dir 700, fișier 400), sha256(copie) ==
#      sha256 APROBAT (--sha256 sau --aprobare), validatorul (scripts/livrare_validator.py) pe ACEEAȘI copie
#   1. pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'))   — PRIMA instrucțiune: serializează livrările
#   2. ținta: current_database() == --tinta-db (+ opțional system_identifier == --tinta-sistem)
#   3. istoricul: nici numele, nici versiunea nu sunt în supabase_migrations.schema_migrations  (înainte de DDL)
#   4. marcajul de livrare set_config('gazpet.livrare_migrare', '<nume>:' || txid_current(), true)
#   5. COPIA (corpul migrării; gărzile ei de start/final)
#   6. INSERT în schema_migrations (statements = COPIA) + verificare sha256(statements[1]) == sha256 aprobat
#   Orice eroare ⇒ ROLLBACK la tot.
#
# Rezultat (cod de ieșire) — trei stări, stabilite după o RECONCILIERE read-only pe o conexiune nouă (care așteaptă
# întâi lock-ul consultativ, deci tranzacția livrării s-a terminat, comisă sau anulată):
#   0  APLICAT + ÎNREGISTRAT confirmat  (rândul name+version există și sha256(statements[1]) == aprobat)
#   10 NEAPLICAT confirmat              (rândul name+version nu există ⇒ nimic comis: înregistrarea e în aceeași tranzacție)
#   20 NECUNOSCUT                       (reconcilierea n-a putut stabili starea) ⇒ NU se reia, NU se face rollback
#                                         automat; se rulează manual interogarea read-only tipărită.
#   2  refuz la argumente, 3 refuz la artefact/validator — ambele ÎNAINTE de orice conexiune (neaplicat).
#
# Utilizare (parola NU pe linia de comandă și nici în chat: ~/.pgpass / PGPASSFILE sau PGSERVICE + pg_service.conf):
#   bash scripts/livrare_migrare.sh --migrare supabase/migrations/<nume>.sql --sha256 <hex64> \
#        --versiune <AAAALLZZHHMMSS> --tinta-db <baza> [--host H] [--port P] [--user U] [--service S] [--tinta-sistem ID]
#   În loc de --sha256: --aprobare <fișier> cu un rând „<hex64>  <nume>.sql” (formatul sha256sum).
# Orice altă opțiune (-v, -f, -c, --set, -d URI, …) ⇒ refuz înainte de conexiune. Nu se acceptă URI-uri de conexiune.
# Variabile respinse (pot schimba execuția/ținta pe ascuns): PGPASSWORD, PGOPTIONS, PGDATABASE, PSQLRC.
# PSQL_BIN (implicit psql) — binarul clientului; doar operatorul local îl setează (teste).
#
# Limită de încredere declarată: marcajul și garda sunt o gardă de PROTOCOL, nu o autorizație. Un operator
# privilegiat care le ocolește deliberat (set_config manual, psql direct) nu e oprit de runner.
# ============================================================================
set -Eeuo pipefail
umask 077

refuz() { echo "REFUZ (neaplicat, fără conexiune): $2" >&2; exit "$1"; }

MIG="" SHA="" APROBARE="" VERSIUNE="" TINTA_DB="" TINTA_SIS="" C_HOST="" C_PORT="" C_USER="" C_SERVICE=""
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || refuz 2 "opțiunea $1 fără valoare"
  case "$1" in
    --migrare) MIG="$2" ;;          --sha256) SHA="$2" ;;          --aprobare) APROBARE="$2" ;;
    --versiune) VERSIUNE="$2" ;;    --tinta-db) TINTA_DB="$2" ;;   --tinta-sistem) TINTA_SIS="$2" ;;
    --host) C_HOST="$2" ;;          --port) C_PORT="$2" ;;         --user) C_USER="$2" ;;
    --service) C_SERVICE="$2" ;;
    *) refuz 2 "opțiune nepermisă: $1 (doar --migrare --sha256|--aprobare --versiune --tinta-db [--tinta-sistem --host --port --user --service])" ;;
  esac
  shift 2
done
for v in PGPASSWORD PGOPTIONS PGDATABASE PSQLRC; do
  [ -z "${!v+x}" ] || refuz 2 "variabila $v e setată (parola: ~/.pgpass / PGPASSFILE / PGSERVICE; nimic care schimbă execuția)"
done
[ -n "$MIG" ] && [ -f "$MIG" ] || refuz 2 "--migrare lipsă sau fișier inexistent: $MIG"
NUME="$(basename "$MIG" .sql)"
[[ "$NUME" =~ ^[0-9]{8}[a-z]?_[A-Za-z0-9_]+$ ]] || refuz 2 "nume de migrare invalid: $NUME"
[[ "$VERSIUNE" =~ ^[0-9]{14}$ ]] || refuz 2 "--versiune obligatorie, 14 cifre (AAAALLZZHHMMSS): '$VERSIUNE'"
[[ "$TINTA_DB" =~ ^[A-Za-z0-9_]{1,63}$ ]] || refuz 2 "--tinta-db obligatorie ([A-Za-z0-9_]): '$TINTA_DB'"
[ -z "$TINTA_SIS" ] || [[ "$TINTA_SIS" =~ ^[0-9]{1,20}$ ]] || refuz 2 "--tinta-sistem invalid"
[ -z "$C_HOST" ] || [[ "$C_HOST" =~ ^[A-Za-z0-9._/-]{1,253}$ ]] || refuz 2 "--host invalid"
[ -z "$C_PORT" ] || [[ "$C_PORT" =~ ^[0-9]{1,5}$ ]] || refuz 2 "--port invalid"
[ -z "$C_USER" ] || [[ "$C_USER" =~ ^[A-Za-z0-9_.-]{1,63}$ ]] || refuz 2 "--user invalid"
[ -z "$C_SERVICE" ] || [[ "$C_SERVICE" =~ ^[A-Za-z0-9_-]{1,63}$ ]] || refuz 2 "--service invalid"
if [ -n "$APROBARE" ]; then
  [ -z "$SHA" ] || refuz 2 "--sha256 și --aprobare se exclud"
  [ -f "$APROBARE" ] || refuz 2 "fișier de aprobare lipsă: $APROBARE"
  SHA="$(awk -v f="$NUME.sql" '$2 == f || $2 == "*" f {print $1}' "$APROBARE")"
  [ "$(printf '%s\n' "$SHA" | grep -c .)" = 1 ] || refuz 2 "fișierul de aprobare nu are exact un rând pentru $NUME.sql"
fi
[[ "$SHA" =~ ^[0-9a-f]{64}$ ]] || refuz 2 "sha256 aprobat lipsă/invalid (--sha256 <hex64> sau --aprobare)"

# --- copia unică, protejată; TOT ce urmează folosește DOAR copia -------------
DIR="$(mktemp -d)"; trap 'chmod -R u+w "$DIR" 2>/dev/null; rm -rf "$DIR"' EXIT
chmod 700 "$DIR"
COPIE="$DIR/$NUME.sql"
cp -- "$MIG" "$COPIE"; chmod 400 "$COPIE"
SHA_COPIE="$(sha256sum "$COPIE" | cut -d' ' -f1)"
[ "$SHA_COPIE" = "$SHA" ] || refuz 3 "sha256 al artefactului ($SHA_COPIE) ≠ sha256 aprobat ($SHA)"
TAG="reg_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
VAL_OUT="$(python3 "$(dirname "${BASH_SOURCE[0]}")/livrare_validator.py" "$COPIE" "$TAG")" || refuz 3 "validatorul a refuzat $NUME (vezi mai sus)"
echo "→ $NUME: sha256 $SHA_COPIE = aprobat; validator: $VAL_OUT"

# --- fișierele runnerului (generate, nu provin din artefact) -----------------
CHEIE="hashtext('gazpet.livrare_migrare')"
SIS_CHECK=""
[ -n "$TINTA_SIS" ] && SIS_CHECK="  IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '$TINTA_SIS' THEN
    RAISE EXCEPTION 'Livrare $NUME: system_identifier ≠ ținta aprobată $TINTA_SIS'; END IF;"
cat > "$DIR/1_pre.sql" <<SQL
SELECT pg_advisory_xact_lock($CHEIE);
DO \$pre\$ BEGIN
  IF current_database() IS DISTINCT FROM '$TINTA_DB' THEN
    RAISE EXCEPTION 'Livrare $NUME: baza conectată (%) ≠ ținta aprobată $TINTA_DB', current_database(); END IF;
$SIS_CHECK
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '$NUME') THEN
    RAISE EXCEPTION 'Livrare $NUME: migrarea e deja înregistrată — refuz (fără dublare)'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '$VERSIUNE') THEN
    RAISE EXCEPTION 'Livrare $NUME: versiunea $VERSIUNE e deja folosită — refuz'; END IF;
END \$pre\$;
SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);
SQL
{
  printf 'DO $inreg$ BEGIN\n'
  printf "  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '%s:' || txid_current() THEN\n" "$NUME"
  printf "    RAISE EXCEPTION 'Înregistrare %s: marcajul de livrare lipsește — nu sunt în tranzacția runnerului'; END IF;\n" "$NUME"
  printf 'END $inreg$;\n'
  printf "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('%s', '%s', ARRAY[\$%s\$" "$VERSIUNE" "$NUME" "$TAG"
  cat "$COPIE"
  printf "\$%s\$]);\n" "$TAG"
  printf 'DO $verif$ BEGIN\n'
  printf "  IF (SELECT encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') FROM supabase_migrations.schema_migrations WHERE version = '%s' AND name = '%s') IS DISTINCT FROM '%s' THEN\n" "$VERSIUNE" "$NUME" "$SHA"
  printf "    RAISE EXCEPTION 'Înregistrare %s: statements ≠ artefactul aprobat'; END IF;\n" "$NUME"
  printf 'END $verif$;\n'
} > "$DIR/3_inreg.sql"
chmod 400 "$DIR/1_pre.sql" "$DIR/3_inreg.sql"

CONN=(); [ -n "$C_HOST" ] && CONN+=(-h "$C_HOST"); [ -n "$C_PORT" ] && CONN+=(-p "$C_PORT"); [ -n "$C_USER" ] && CONN+=(-U "$C_USER")
[ -n "$C_SERVICE" ] && export PGSERVICE="$C_SERVICE"
CONN+=(-d "$TINTA_DB")   # validat [A-Za-z0-9_] ⇒ nu poate fi conninfo/URI
PSQL="${PSQL_BIN:-psql}"

echo "→ livrare $NUME (versiune $VERSIUNE) pe ținta $TINTA_DB: psql --single-transaction [lock + țintă + istoric + marcaj + copie + înregistrare]"
set +e
"$PSQL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$DIR/1_pre.sql" -f "$COPIE" -f "$DIR/3_inreg.sql" "${CONN[@]}"
RC_PSQL=$?
set -e

# --- reconciliere read-only (conexiune nouă; așteaptă lock-ul ⇒ tranzacția livrării s-a terminat) ------------
RECONC="BEGIN READ ONLY; SET LOCAL lock_timeout = '120s'; SELECT pg_advisory_xact_lock($CHEIE);
SELECT count(*) FILTER (WHERE version = '$VERSIUNE' AND name = '$NUME') || '|' ||
       count(*) FILTER (WHERE version = '$VERSIUNE' AND name = '$NUME' AND encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') = '$SHA')
  FROM supabase_migrations.schema_migrations WHERE version = '$VERSIUNE' OR name = '$NUME'; COMMIT;"
set +e
"$PSQL" -X -q -At -v ON_ERROR_STOP=1 -c "$RECONC" "${CONN[@]}" >"$DIR/reconc.out" 2>&1
RC_R=$?
R="$(tail -n 1 "$DIR/reconc.out")"
set -e
if [ "$RC_R" = 0 ] && [ "$R" = "1|1" ]; then
  [ "$RC_PSQL" = 0 ] || echo "⚠ psql a raportat $RC_PSQL (confirmarea s-a pierdut), dar reconcilierea arată livrarea COMISĂ" >&2
  echo "✓ APLICAT + ÎNREGISTRAT confirmat: $NUME v$VERSIUNE (sha256 $SHA)"; exit 0
fi
if [ "$RC_R" = 0 ] && [ "$R" = "0|0" ]; then
  [ "$RC_PSQL" != 0 ] || { echo "✗ NECUNOSCUT: psql a raportat succes, dar înregistrarea lipsește — reconciliere manuală" >&2; exit 20; }
  echo "✗ NEAPLICAT confirmat: $NUME v$VERSIUNE (psql $RC_PSQL; nicio înregistrare ⇒ nimic comis)" >&2; exit 10
fi
echo "✗ NECUNOSCUT: $NUME v$VERSIUNE (psql $RC_PSQL, reconciliere: cod $RC_R, rezultat '$R'). NU reluați, NU faceți rollback." >&2
echo "  Reconciliere manuală read-only: $RECONC" >&2
echo "  + starea obiectelor migrării (docs/SECURITATE_PATCH_RSVTI.md, Runda 5)." >&2
exit 20
