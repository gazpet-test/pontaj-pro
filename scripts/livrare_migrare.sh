#!/usr/bin/env bash
# ============================================================================
# Traseul OFICIAL de livrare pentru migrările cu gardă de livrare — runda 6 (verdict Copilot R5,
# docs/LIVRARE_MIGRARE_VERDICT_COPILOT_R5.md; arhitectura rundei 5 păstrată). Domeniu: DOAR operațiile care participă
# la tranzacția PostgreSQL.
#
# UN SINGUR gestionar de tranzacție = psql --single-transaction, pe O COPIE locală protejată a artefactului APROBAT:
#   0. înainte de conexiune: argumente pe listă albă, copie unică (mktemp, dir 700, fișier 400), sha256(copie) ==
#      sha256 APROBAT (--sha256 sau --aprobare), validatorul (scripts/livrare_validator.py) pe ACEEAȘI copie
#   P. PRE-VERIFICARE read-only (aceeași interogare ca reconcilierea): ținta (db + system_identifier [+ proiect]) și
#      istoricul (relevante / exacte) ⇒ ținta greșită = 22, pereche exactă existentă = 11, altceva relevant = 21 —
#      în toate trei cazurile livrarea NU se trimite.
#   Tranzacția (fișiere generate de runner, niciunul din artefact):
#   0_prolog: SET TRANSACTION ISOLATION LEVEL READ COMMITTED (PRIMA), SET LOCAL standard_conforming_strings = on,
#             SET LOCAL client_encoding = 'UTF8' (+ PGCLIENTENCODING=UTF8 la conexiune) și verificarea lor
#   1_pre:    pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare')) — instrucțiune SEPARATĂ, înaintea istoricului;
#             ținta: current_database() == --tinta-db, system_identifier == --tinta-sistem (OBLIGATORIU)
#             [+ current_setting('gazpet.proiect_aprobat') == --tinta-proiect, opțional];
#             istoricul: nici numele, nici versiunea în supabase_migrations.schema_migrations (snapshot nou după lock);
#             marcajul set_config('gazpet.livrare_migrare', '<nume>:' || txid_current(), true)
#   COPIA (corpul migrării; gărzile ei de start/final)
#   3_inreg:  INSERT în schema_migrations (statements = COPIA) + verificare sha256(statements[1]) == sha256 aprobat
#   Orice eroare ⇒ ROLLBACK la tot.
#
# Rezultat (cod de ieșire), stabilit după o RECONCILIERE read-only pe o conexiune nouă (READ COMMITTED explicit,
# așteaptă întâi lock-ul consultativ ⇒ tranzacția livrării s-a terminat; aceeași verificare a țintei ca livrarea):
#   0  APLICAT + ÎNREGISTRAT     exact 1 rând relevant și el e perechea exactă (nume + versiune + sha256 aprobat)
#   10 NEAPLICAT confirmat       0 rânduri relevante (nume SAU versiune) pe ținta confirmată, iar psql a raportat eroare
#   11 DEJA ÎNREGISTRAT          (pre-verificare) perechea exactă exista deja: „nu s-a reaplicat”
#   12 NEPORNIT                  pre-verificarea n-a putut rula ⇒ livrarea nu s-a trimis
#   20 NECUNOSCUT                reconcilierea n-a putut stabili starea ⇒ NU se reia, NU se face rollback automat
#   21 CONFLICT                  rânduri relevante care nu sunt exact perechea aprobată (alt nume/versiune/sha, dubluri)
#                                ⇒ reconciliere manuală necesară, FĂRĂ retry automat
#   22 ȚINTĂ NECONFIRMATĂ        pre-verificarea sau reconcilierea a ajuns pe altă țintă (db/system_identifier/proiect)
#   30 GATE 0e: livrarea e COMISĂ și înregistrată, dar controlul permanent 0e (scripts/control_0e.sql, read-only) a găsit
#      ≥1 funcție expusă (public/graphql_public, EXECUTE pentru anon/authenticated) care poate scrie GUC-uri de identitate sau
#      interpretează SQL primit ca argument (interpretor SQL: query_to_xml, ts_stat, crosstab, dblink, …)
#      ⇒ livrarea NU e considerată încheiată. NU e rollback (migrarea rămâne comisă) — analiză înainte de a continua.
#   31 GATE 0e NERULAT: livrarea e comisă, dar controlul 0e n-a putut rula ⇒ la fel, NU e considerată încheiată.
#      Gate-ul 0e rulează DOAR după APLICAT + ÎNREGISTRAT confirmat, pe aceeași țintă/conexiune (-h/-p/-U/-d), într-o
#      tranzacție READ ONLY separată. Nu există opțiune de a-l sări (cerință Copilot PR #551 F2).
#   2  refuz la argumente, 3 refuz la artefact/validator — ambele ÎNAINTE de orice conexiune (neaplicat).
#
# Utilizare (parola NU pe linia de comandă și nici în chat: ~/.pgpass / PGPASSFILE):
#   bash scripts/livrare_migrare.sh --migrare supabase/migrations/<nume>.sql --sha256 <hex64> \
#        --versiune <AAAALLZZHHMMSS> --tinta-db <baza> --tinta-sistem <system_identifier> \
#        --tinta-host <H> --tinta-port <P> [--tinta-proiect <marcaj>] [--user U]
#   Runda 7: aprobarea țintei = db + system_identifier + ENDPOINTUL DE SCRIERE (host:port) [+ proiect]. Pre-verificarea,
#   tranzacția principală și reconcilierea cer în plus pg_is_in_recovery() = false (o replică fizică are același
#   system_identifier) ⇒ altfel 22 / refuz. (Runda 9: servicii libpq refuzate, vezi mai jos.)
#   Runda 9: suportul --service e RETRAS (verificarea noastră nu reproducea selecția libpq a secțiunii) ⇒ --service = refuz 2;
#   PGSERVICE/PGSERVICEFILE/PGSYSCONFDIR din mediu ⇒ refuz; pre-verificarea cere drept de apel pe pg_control_system().
#   În loc de --sha256: --aprobare <fișier> cu un rând „<hex64>  <nume>.sql” (formatul sha256sum).
# Orice altă opțiune (-v, -f, -c, --set, -d URI, …) ⇒ refuz înainte de conexiune. Nu se acceptă URI-uri de conexiune.
# Variabile respinse (pot schimba execuția/ținta pe ascuns): PGPASSWORD, PGOPTIONS, PGDATABASE, PSQLRC, PGHOSTADDR,
# PGTARGETSESSIONATTRS, PGLOADBALANCEHOSTS, PGSERVICE, PGSERVICEFILE, PGSYSCONFDIR. PGHOST/PGPORT: eliminate explicit (unset)
# — endpointul vine DOAR din --tinta-host/--tinta-port.
# PSQL_BIN (implicit psql) — binarul clientului; doar operatorul local îl setează (teste).
#
# Limită de încredere declarată: marcajul și garda sunt o gardă de PROTOCOL, nu o autorizație. Un operator
# privilegiat care le ocolește deliberat (set_config manual, psql direct) nu e oprit de runner.
# ============================================================================
set -Eeuo pipefail
umask 077

refuz() { echo "REFUZ (neaplicat, fără conexiune): $2" >&2; exit "$1"; }

MIG="" SHA="" APROBARE="" VERSIUNE="" TINTA_DB="" TINTA_SIS="" TINTA_PROI="" C_HOST="" C_PORT="" C_USER=""
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || refuz 2 "opțiunea $1 fără valoare"
  case "$1" in
    --migrare) MIG="$2" ;;          --sha256) SHA="$2" ;;          --aprobare) APROBARE="$2" ;;
    --versiune) VERSIUNE="$2" ;;    --tinta-db) TINTA_DB="$2" ;;   --tinta-sistem) TINTA_SIS="$2" ;;
    --tinta-proiect) TINTA_PROI="$2" ;;
    --tinta-host) C_HOST="$2" ;;    --tinta-port) C_PORT="$2" ;;   --user) C_USER="$2" ;;
    --service) refuz 2 "--service nu mai e acceptat (Runda 9: suport retras — endpoint explicit --tinta-host/--tinta-port + ~/.pgpass/PGPASSFILE)" ;;
    *) refuz 2 "opțiune nepermisă: $1 (doar --migrare --sha256|--aprobare --versiune --tinta-db --tinta-sistem --tinta-host --tinta-port [--tinta-proiect --user])" ;;
  esac
  shift 2
done
# Runda 9: niciun serviciu libpq (nici --service, nici din mediu) și nicio variabilă care redirecționează/schimbă conexiunea.
for v in PGPASSWORD PGOPTIONS PGDATABASE PSQLRC PGHOSTADDR PGTARGETSESSIONATTRS PGLOADBALANCEHOSTS PGSERVICE PGSERVICEFILE PGSYSCONFDIR; do
  [ -z "${!v+x}" ] || refuz 2 "variabila $v e setată (parola: ~/.pgpass / PGPASSFILE; fără servicii libpq; nimic care schimbă execuția/ținta)"
done
unset PGHOST PGPORT   # suprascrise oricum de -h/-p explicite; eliminate ca endpointul să nu depindă de mediu
[ -n "$MIG" ] && [ -f "$MIG" ] || refuz 2 "--migrare lipsă sau fișier inexistent: $MIG"
NUME="$(basename "$MIG" .sql)"
[[ "$NUME" =~ ^[0-9]{8}[a-z]?_[A-Za-z0-9_]+$ ]] || refuz 2 "nume de migrare invalid: $NUME"
[[ "$VERSIUNE" =~ ^[0-9]{14}$ ]] || refuz 2 "--versiune obligatorie, 14 cifre (AAAALLZZHHMMSS): '$VERSIUNE'"
[[ "$TINTA_DB" =~ ^[A-Za-z0-9_]{1,63}$ ]] || refuz 2 "--tinta-db obligatorie ([A-Za-z0-9_]): '$TINTA_DB'"
[[ "$TINTA_SIS" =~ ^[0-9]{1,20}$ ]] || refuz 2 "--tinta-sistem OBLIGATORIU (system_identifier din pg_control_system(), cifre): '$TINTA_SIS'"
[ -z "$TINTA_PROI" ] || [[ "$TINTA_PROI" =~ ^[A-Za-z0-9_.-]{1,63}$ ]] || refuz 2 "--tinta-proiect invalid"
# Runda 7: endpointul de SCRIERE aprobat (host + port) face parte din aprobare, ca --tinta-db/--tinta-sistem — obligatoriu.
[[ "$C_HOST" =~ ^[A-Za-z0-9._/-]{1,253}$ ]] || refuz 2 "--tinta-host OBLIGATORIU (endpointul de scriere aprobat): '$C_HOST'"
[[ "$C_PORT" =~ ^[0-9]{1,5}$ ]] || refuz 2 "--tinta-port OBLIGATORIU (portul endpointului de scriere aprobat): '$C_PORT'"
[ -z "$C_USER" ] || [[ "$C_USER" =~ ^[A-Za-z0-9_.-]{1,63}$ ]] || refuz 2 "--user invalid"
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
CONTROL_0E="$(dirname "${BASH_SOURCE[0]}")/control_0e.sql"
[ -f "$CONTROL_0E" ] || refuz 3 "gate-ul permanent 0e lipsește: $CONTROL_0E"
VAL_OUT="$(python3 "$(dirname "${BASH_SOURCE[0]}")/livrare_validator.py" "$COPIE" "$TAG")" || refuz 3 "validatorul a refuzat $NUME (vezi mai sus)"
echo "→ $NUME: sha256 $SHA_COPIE = aprobat; validator: $VAL_OUT"

# --- fișierele runnerului (generate, nu provin din artefact) -----------------
CHEIE="hashtext('gazpet.livrare_migrare')"
PROI_EXPR="coalesce(current_setting('gazpet.proiect_aprobat', true), '')"
cat > "$DIR/0_prolog.sql" <<SQL
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL standard_conforming_strings = on;
SET LOCAL client_encoding = 'UTF8';
DO \$prolog\$ BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION 'Livrare $NUME: izolarea nu e READ COMMITTED'; END IF;
  IF current_setting('standard_conforming_strings') IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Livrare $NUME: standard_conforming_strings nu e on'; END IF;
  IF current_setting('client_encoding') IS DISTINCT FROM 'UTF8' THEN RAISE EXCEPTION 'Livrare $NUME: client_encoding nu e UTF8'; END IF;
END \$prolog\$;
SQL
PROI_CHECK=""
[ -n "$TINTA_PROI" ] && PROI_CHECK="  IF $PROI_EXPR IS DISTINCT FROM '$TINTA_PROI' THEN
    RAISE EXCEPTION 'Livrare $NUME: marcajul de proiect ≠ ținta aprobată $TINTA_PROI'; END IF;"
cat > "$DIR/1_pre.sql" <<SQL
SELECT pg_advisory_xact_lock($CHEIE);
DO \$pre\$ BEGIN
  IF current_database() IS DISTINCT FROM '$TINTA_DB' THEN
    RAISE EXCEPTION 'Livrare $NUME: baza conectată (%) ≠ ținta aprobată $TINTA_DB', current_database(); END IF;
  IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '$TINTA_SIS' THEN
    RAISE EXCEPTION 'Livrare $NUME: system_identifier ≠ ținta aprobată $TINTA_SIS'; END IF;
  IF pg_is_in_recovery() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Livrare $NUME: instanța e în recovery (replică) — nu e endpointul de scriere aprobat'; END IF;
$PROI_CHECK
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
# Reconcilierea (și pre-verificarea): read-only, READ COMMITTED explicit PRIMUL, lock-ul într-o instrucțiune separată
# ÎNAINTEA SELECT-ului pe istoric ⇒ SELECT-ul primește un snapshot luat după eliberarea lock-ului.
# Rezultat: db|system_identifier|proiect|in_recovery|relevante (nume SAU versiune)|exacte (nume+versiune+sha)
cat > "$DIR/reconc.sql" <<SQL
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY;
SET LOCAL lock_timeout = '120s';
DO \$drept\$ BEGIN
  IF NOT has_function_privilege('pg_catalog.pg_control_system()', 'EXECUTE') THEN
    RAISE EXCEPTION 'LIVRARE_FARA_DREPT_PG_CONTROL_SYSTEM: rolul % nu poate apela pg_control_system() — ținta (system_identifier) nu se poate verifica', current_user; END IF;
END \$drept\$;
SELECT pg_advisory_xact_lock($CHEIE);
SELECT current_database() || '|' || (SELECT system_identifier::text FROM pg_control_system()) || '|' || $PROI_EXPR || '|' ||
       pg_is_in_recovery()::text || '|' ||
       count(*) || '|' ||
       count(*) FILTER (WHERE version = '$VERSIUNE' AND name = '$NUME' AND encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') = '$SHA')
  FROM supabase_migrations.schema_migrations WHERE version = '$VERSIUNE' OR name = '$NUME';
COMMIT;
SQL
# Gate-ul permanent 0e (după livrare): copie protejată a scripts/control_0e.sql, într-o tranzacție READ ONLY.
# Același prolog lexical ca livrarea (standard_conforming_strings/client_encoding pot veni ostile din ALTER DATABASE … SET):
# fără el, regex-urile cu „\” din control_0e.sql se parsează greșit ⇒ GATE 0e NERULAT (prins de 6.12).
{ cat <<'P0E'
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY;
SET LOCAL standard_conforming_strings = on;
SET LOCAL client_encoding = 'UTF8';
DO $p0e$ BEGIN
  IF current_setting('standard_conforming_strings') IS DISTINCT FROM 'on' OR current_setting('client_encoding') IS DISTINCT FROM 'UTF8'
    THEN RAISE EXCEPTION 'Gate 0e: prolog lexical neaplicat'; END IF;
END $p0e$;
P0E
  cat "$CONTROL_0E"; printf '\nCOMMIT;\n'; } > "$DIR/control_0e.sql"
chmod 400 "$DIR/0_prolog.sql" "$DIR/1_pre.sql" "$DIR/3_inreg.sql" "$DIR/reconc.sql" "$DIR/control_0e.sql"

CONN=(-h "$C_HOST" -p "$C_PORT"); [ -n "$C_USER" ] && CONN+=(-U "$C_USER")   # explicite ⇒ au prioritate față de mediu
CONN+=(-d "$TINTA_DB")   # validat [A-Za-z0-9_] ⇒ nu poate fi conninfo/URI
export PGCLIENTENCODING=UTF8   # parametru de pornire al conexiunii: are prioritate față de setările rolului/bazei
PSQL="${PSQL_BIN:-psql}"

# reconciliaza ⇒ RC_R, R, R_DB, R_SIS, R_PROI, R_REL, R_EX; întoarce 0 doar dacă rezultatul e complet și bine format
reconciliaza() {
  set +e
  "$PSQL" -X -q -At -v ON_ERROR_STOP=1 -f "$DIR/reconc.sql" "${CONN[@]}" >"$DIR/reconc.out" 2>&1
  RC_R=$?
  set -e
  R="$(tail -n 1 "$DIR/reconc.out")"
  IFS='|' read -r R_DB R_SIS R_PROI R_REC R_REL R_EX <<<"$R" || true
  [ "$RC_R" = 0 ] && [[ "${R_REL:-}" =~ ^[0-9]+$ ]] && [[ "${R_EX:-}" =~ ^[0-9]+$ ]] && [[ "${R_SIS:-}" =~ ^[0-9]+$ ]]
}
# Runda 7: instanța AUTORITATIVĂ — o replică fizică are același db + system_identifier, deci se cere și in_recovery = false.
tinta_ok() { [ "$R_DB" = "$TINTA_DB" ] && [ "$R_SIS" = "$TINTA_SIS" ] && [ "$R_REC" = false ] && { [ -z "$TINTA_PROI" ] || [ "$R_PROI" = "$TINTA_PROI" ]; }; }
manual() {
  echo "  Reconciliere manuală read-only (pe ținta aprobată; câmpuri: db|system_identifier|proiect|in_recovery|relevante|exacte):" >&2
  sed 's/^/    /' "$DIR/reconc.sql" >&2
  echo "  + starea obiectelor migrării (docs/SECURITATE_PATCH_RSVTI.md, Runda 5/6)." >&2
}

# Gate permanent 0e (cerință Copilot PR #551 F2): rulează DUPĂ COMMIT ⇒ nu face rollback; un eșec înseamnă „comis, dar
# livrarea NU e considerată încheiată” (cod 30/31), cu analiză manuală înainte de orice pas următor.
gate_0e() {
  set +e
  "$PSQL" -X -q -At -F ' | ' -v ON_ERROR_STOP=1 -f "$DIR/control_0e.sql" "${CONN[@]}" >"$DIR/0e.out" 2>&1
  local rc=$?
  set -e
  if [ "$rc" != 0 ]; then
    echo "✗ GATE 0e NERULAT (cod psql $rc): $NUME v$VERSIUNE e COMISĂ, dar controlul 0e n-a putut rula — livrarea NU e considerată încheiată; analizează înainte de a continua." >&2
    sed 's/^/    /' "$DIR/0e.out" >&2; exit 31
  fi
  if [ -s "$DIR/0e.out" ]; then
    echo "✗ GATE 0e: gadget(uri) expus(e): $(paste -sd ';' "$DIR/0e.out") — $NUME v$VERSIUNE e COMISĂ (fără rollback), dar livrarea NU e considerată încheiată; analizează înainte de a continua." >&2
    exit 30
  fi
  echo "✓ GATE 0e: 0 funcții expuse care pot scrie GUC-uri de identitate sau interpreta SQL (interpretor SQL) — livrare încheiată."
}

# --- P. pre-verificare (nimic trimis dacă nu trece) ----------------------------
if ! reconciliaza; then
  grep -qF LIVRARE_FARA_DREPT_PG_CONTROL_SYSTEM "$DIR/reconc.out" && \
    echo "✗ NEPORNIT: rolul de livrare nu are drept de apel pe pg_control_system() — verificarea țintei e obligatorie, nu se relaxează." >&2
  echo "✗ NEPORNIT: pre-verificarea n-a putut rula (cod $RC_R, rezultat '$R') — livrarea NU s-a trimis." >&2; exit 12
fi
if ! tinta_ok; then
  echo "✗ ȚINTĂ NECONFIRMATĂ la pre-verificare: conectat la db=$R_DB system_identifier=$R_SIS in_recovery=$R_REC proiect='$R_PROI', aprobat db=$TINTA_DB system_identifier=$TINTA_SIS proiect='$TINTA_PROI' — livrarea NU s-a trimis." >&2
  exit 22
fi
if [ "$R_REL" = 1 ] && [ "$R_EX" = 1 ]; then
  echo "✓ DEJA ÎNREGISTRATĂ: $NUME v$VERSIUNE e deja înregistrată cu artefactul aprobat (sha256 $SHA); nu s-a reaplicat." >&2; exit 11
fi
if [ "$R_REL" != 0 ]; then
  echo "✗ CONFLICT: istoricul are $R_REL rând(uri) cu numele $NUME sau versiunea $VERSIUNE, din care $R_EX perechea exactă aprobată — reconciliere manuală necesară, fără retry automat. Livrarea NU s-a trimis." >&2
  manual; exit 21
fi

echo "→ livrare $NUME (versiune $VERSIUNE) pe ținta $TINTA_DB/$TINTA_SIS @ $C_HOST:$C_PORT: psql --single-transaction [prolog + lock + țintă + istoric + marcaj + copie + înregistrare]"
set +e
"$PSQL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$DIR/0_prolog.sql" -f "$DIR/1_pre.sql" -f "$COPIE" -f "$DIR/3_inreg.sql" "${CONN[@]}"
RC_PSQL=$?
set -e

# --- reconciliere read-only (conexiune nouă; așteaptă lock-ul ⇒ tranzacția livrării s-a terminat) ------------
if ! reconciliaza; then
  echo "✗ NECUNOSCUT: $NUME v$VERSIUNE (psql $RC_PSQL, reconciliere: cod $RC_R, rezultat '$R'). NU reluați, NU faceți rollback." >&2
  manual; exit 20
fi
if ! tinta_ok; then
  echo "✗ ȚINTĂ NECONFIRMATĂ la reconciliere: conectat la db=$R_DB system_identifier=$R_SIS in_recovery=$R_REC proiect='$R_PROI' ≠ ținta aprobată — starea pe ținta aprobată e NECUNOSCUTĂ (psql $RC_PSQL). NU reluați." >&2
  manual; exit 22
fi
if [ "$R_REL" = 1 ] && [ "$R_EX" = 1 ]; then
  [ "$RC_PSQL" = 0 ] || echo "⚠ psql a raportat $RC_PSQL, dar înregistrarea exactă există acum (nu exista la pre-verificare): aplicat de această execuție (confirmare pierdută) sau de o livrare concurentă a aceluiași artefact." >&2
  echo "✓ APLICAT + ÎNREGISTRAT confirmat: $NUME v$VERSIUNE (sha256 $SHA)"
  gate_0e; exit 0
fi
if [ "$R_REL" = 0 ]; then
  [ "$RC_PSQL" != 0 ] || { echo "✗ NECUNOSCUT: psql a raportat succes, dar nu există nicio înregistrare relevantă — reconciliere manuală" >&2; manual; exit 20; }
  echo "✗ NEAPLICAT confirmat: $NUME v$VERSIUNE (psql $RC_PSQL; 0 rânduri relevante pe ținta confirmată ⇒ nimic comis)" >&2; exit 10
fi
echo "✗ CONFLICT: după livrare istoricul are $R_REL rând(uri) cu numele $NUME sau versiunea $VERSIUNE, din care $R_EX perechea exactă aprobată (psql $RC_PSQL) — reconciliere manuală necesară, fără retry automat." >&2
manual; exit 21
