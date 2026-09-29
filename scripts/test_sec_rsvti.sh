#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — SEC RSVTI (20261003c_sec_rsvti_poarta_jurnal.sql), runda 3.
#
# Rulează EXCLUSIV pe un PostgreSQL 16 local dedicat (implicit /tmp/pg_sec_rsvti, 127.0.0.1:5442).
# Nu citește .env, nu folosește chei Supabase, nu atinge producția.
#
# Ciclul complet (runda 3 = răspunsul la NO-GO Copilot pe r2, docs/SECURITATE_PATCH_RSVTI.md §12):
#   S. statice: rollback-ul NU e în supabase/migrations; CI referă doar fișiere anume; migrarea NU are BEGIN/COMMIT
#      (runda 4: gestionarul unic e scripts/livrare_migrare.sh), garda de livrare e prima și ultima, postcondiția
#      între ele; rollback-ul nu are BEGIN/COMMIT; nicio comparație „<>”/„NOT IN” (NULL-safe)
#   0. schelet (= producția de azi)       → teste GAURA
#   0b. precondiții/postcondiții negative pe starea live (politica sursă fără USING/WITH CHECK, RLS oprit pe sursă,
#       helper existent străin, granturi rămase prin PUBLIC / pe coloană / prin rol moștenit, proprietar schimbat, S1,
#       S2, RPC necunoscut) → migrarea REFUZATĂ, fără urme
#   1. migrare (runner a)                  → teste PATCH
#   2. reaplicare (idempotență)            → teste PATCH; 2b reaplicare peste stare schimbată → REFUZATĂ
#   3a. rollback tehnic: armare lipsă/greșită/de altă tranzacție/persistentă, precondiții → REFUZAT, fără urme
#   3s. o singură sesiune psql: setare de sesiune rămasă; armare validă + eroare + ROLLBACK, apoi reluare → REFUZAT
#   3. rollback tehnic ARMAT (string-ul documentat) → dezarmat; schema = pasul 0; GAURA; suita PATCH CADE
#   4. reaplicare                          → teste PATCH; suita GAURA CADE
#   5. rollback armat local + de sesiune în aceeași tranzacție → trece, sesiunea e dezarmată; reaplicare = schema 4
#   6. traseul EFECTIV de livrare (runda 4, bază auxiliară): scripts/livrare_migrare.sh (psql --single-transaction:
#      marcaj + migrare + INSERT schema_migrations) × {fără eroare, 1/0 după prima funcție, 1/0 în postcondiție,
#      eroare CHIAR la INSERT-ul în schema_migrations}; reluare permisă după eșec; reluare după succes ⇒ refuz,
#      fără dublare; fișierul rulat singur (psql -f, psql -c, --single-transaction fără marcaj, marcaj de sesiune)
#      ⇒ refuzat de garda de livrare, fără urme; runnerul refuză un fișier cu COMMIT; (mutant)
#   7. ceas fix (libfaketime, repornirea serverului) 2026-09-29 23:30 UTC: data omisă / NULL = 30.09
#
# Utilizare (din rădăcina repo-ului; ca root, comenzile de server trec pe utilizatorul postgres prin su):
#   bash scripts/test_sec_rsvti.sh             # ciclul complet
#   bash scripts/test_sec_rsvti.sh --opreste   # + oprește serverul la final
# Variabile opționale: PG_BIN=/usr/lib/postgresql/16/bin PGDATA_TEST=/tmp/pg_sec_rsvti PGPORT_TEST=5442
#   PGDB_TEST=sec_rsvti_test PGLOG_TEST=/tmp/pg_sec_rsvti.log FAKETIME_LIB=…/libfaketime.so.1
#   Doar pentru mutanți/discriminare: MIGRARE_FISIER=… ROLLBACK_FISIER=… LIVRARE_FISIER=… (fișiere alternative)
# Coduri de ieșire: 0 = PASS · 1 = migrare/test eșuat · 2 = mediu (PG indisponibil, gardă refuzată)
# ============================================================================
set -Eeuo pipefail

RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_sec_rsvti}"
PORT="${PGPORT_TEST:-5442}"
BAZA="${PGDB_TEST:-sec_rsvti_test}"
JURNAL_PG="${PGLOG_TEST:-/tmp/pg_sec_rsvti.log}"
SCHELET="$RADACINA/supabase/tests/sec_rsvti_schelet.sql"
TESTE="$RADACINA/supabase/tests/sec_rsvti.test.sql"
TESTE_CEAS="$RADACINA/supabase/tests/sec_rsvti_ceas.test.sql"
MIGRARE="${MIGRARE_FISIER:-$RADACINA/supabase/migrations/20261003c_sec_rsvti_poarta_jurnal.sql}"
ROLLBACK="${ROLLBACK_FISIER:-$RADACINA/supabase/revenire/20261003c_sec_rsvti_poarta_jurnal_ROLLBACK.sql}"
FAKETIME_LIB="${FAKETIME_LIB:-/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1}"
CEAS_FIX="2026-09-29 23:30:00"
# Armarea documentată (runda 3): în aceeași tranzacție, legată de txid-ul ei.
ARMARE="SELECT set_config('gazpet.rollback_tehnic_20261003c', 'REDESCHIDE_GAURA_RSVTI:' || txid_current(), true);"
# Runda 4: marcajul de livrare pus de scripts/livrare_migrare.sh (aceeași tranzacție, legat de txid).
MARCAJ="SELECT set_config('gazpet.livrare_migrare', '20261003c_sec_rsvti_poarta_jurnal:' || txid_current(), true);"
LIVRARE="${LIVRARE_FISIER:-$RADACINA/scripts/livrare_migrare.sh}"

OPRESTE=0
for a in "$@"; do
  case "$a" in
    --opreste) OPRESTE=1 ;;
    -h|--help) sed -n '2,34p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument necunoscut: $a (vezi --help)" >&2; exit 2 ;;
  esac
done

mediu() { echo "MEDIU: $*" >&2; exit 2; }
esec()  { echo "FAIL: $*" >&2; exit 1; }

# --- gărzi: numai țintă locală, bază *_test ---------------------------------
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] || mediu "PGPORT_TEST invalid: $PORT"
[[ "$BAZA" =~ ^[a-z0-9_]+_test$ ]] || mediu "PGDB_TEST trebuie să se termine în _test (acum: $BAZA)"
[[ "$DATE_DIR" == /tmp/* ]] || mediu "PGDATA_TEST trebuie să fie sub /tmp (acum: $DATE_DIR)"
[ -x "$PG_BIN/postgres" ] || mediu "PostgreSQL lipsește în $PG_BIN"
for f in "$SCHELET" "$TESTE" "$TESTE_CEAS" "$MIGRARE" "$ROLLBACK" "$LIVRARE"; do [ -f "$f" ] || mediu "Fișier lipsă: $f"; done

# Nicio variabilă libpq moștenită nu poate redirecționa conexiunea spre alt server.
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE \
      PGOPTIONS PGSSLMODE PGREQUIRESSL PGTARGETSESSIONATTRS PGAPPNAME PGCLIENTENCODING PGDATA
export PGCONNECT_TIMEOUT=5 PGCLIENTENCODING=UTF8 PGAPPNAME=test_sec_rsvti

ca_postgres() {  # serverul nu rulează ca root: „su postgres -c …”
  if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi
}
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)

# --- 1. cluster local dedicat ------------------------------------------------
if [ ! -f "$DATE_DIR/PG_VERSION" ]; then
  echo "→ initdb $DATE_DIR (UTF8, auth trust doar local)"
  mkdir -p "$DATE_DIR"
  [ "$(id -u)" = 0 ] && chown postgres:postgres "$DATE_DIR"
  chmod 700 "$DATE_DIR"
  ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null \
    || mediu "initdb a eșuat"
fi
[ "$(cat "$DATE_DIR/PG_VERSION")" = 16 ] || mediu "$DATE_DIR nu este un cluster PostgreSQL 16"

porneste() {  # $1 = '' (ceas real) sau momentul UTC simulat (libfaketime, „@…”: pornește de acolo și curge)
  if [ "$(id -u)" = 0 ]; then touch "$JURNAL_PG"; chown postgres:postgres "$JURNAL_PG"; fi
  local pre=()
  [ -n "${1:-}" ] && pre=(env TZ=UTC LD_PRELOAD="$FAKETIME_LIB" FAKETIME="@$1")
  ca_postgres "${pre[@]}" "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l "$JURNAL_PG" -w -t 30 start \
    -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c timezone=UTC" >/dev/null \
    || { tail -20 "$JURNAL_PG" >&2 || true; mediu "pg_ctl start a eșuat"; }
}
opreste() { ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || mediu "pg_ctl stop a eșuat"; }
CEAS_SIMULAT=0
readuce_ceasul() { if [ "$CEAS_SIMULAT" = 1 ]; then CEAS_SIMULAT=0; opreste; porneste ""; fi; }
trap readuce_ceasul EXIT
if ! "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT" -t 2; then
  echo "→ pornesc PostgreSQL pe 127.0.0.1:$PORT ($DATE_DIR, jurnal $JURNAL_PG)"
  porneste ""
fi
# Serverul de pe port TREBUIE să fie clusterul nostru — altfel refuz (nu dăm DROP DATABASE pe altceva).
DIR_SERVER="$("${PSQL[@]}" -d postgres -Atc 'SHOW data_directory')" || mediu "nu mă pot conecta la 127.0.0.1:$PORT"
[ "$(realpath "$DIR_SERVER")" = "$(realpath "$DATE_DIR")" ] || mediu "pe portul $PORT rulează alt cluster ($DIR_SERVER)"
VER="$("${PSQL[@]}" -d postgres -Atc 'SHOW server_version_num')"
[ "${VER:0:2}" = 16 ] || mediu "server_version_num=$VER, se cere 16"

# --- 2. bază nouă + schelet ----------------------------------------------------
echo "→ recreez baza $BAZA"
BAZA_AUX="${BAZA%_test}_aux_test"
# Roluri de test (globale în cluster) rămase dintr-o rulare întreruptă: le șterg după bazele de test.
curata_roluri() {
  "${PSQL[@]}" -d postgres -c "SET client_min_messages = warning" \
    -c "DROP DATABASE IF EXISTS \"$BAZA_AUX\" WITH (FORCE)" \
    -c "DROP ROLE IF EXISTS sec_rsvti_r_mostenit, sec_rsvti_r_exec, sec_rsvti_r_alt" \
    -c "DO \$c\$ DECLARE x record; BEGIN  -- armări persistente rămase dintr-o rulare întreruptă (doar comutatoarele gazpet.*)
          FOR x IN SELECT s.setrole, s.setdatabase, split_part(c, '=', 1) AS n FROM pg_db_role_setting s, unnest(s.setconfig) c
                    WHERE lower(c) LIKE 'gazpet.%' LOOP
            IF x.setrole = 0 THEN EXECUTE format('ALTER DATABASE %I RESET %I', (SELECT datname FROM pg_database WHERE oid = x.setdatabase), x.n);
            ELSE EXECUTE format('ALTER ROLE %I RESET %I', pg_get_userbyid(x.setrole), x.n); END IF;
          END LOOP; END \$c\$" >/dev/null || mediu "nu pot curăța rolurile/setările de test"
}
baza_noua() {  # $1 = baza (*_test): recreată + schelet
  "${PSQL[@]}" -d postgres -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)" \
    -c "CREATE DATABASE \"$1\" TEMPLATE template0 ENCODING 'UTF8'" >/dev/null || mediu "nu pot recrea baza $1"
  "${PSQL[@]}" -d "$1" -f "$SCHELET" >/dev/null || esec "scheletul nu s-a încărcat în $1 (fidelitate?)"
}
"${PSQL[@]}" -d postgres -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS \"$BAZA\" WITH (FORCE)" >/dev/null || mediu "nu pot șterge baza $BAZA"
curata_roluri
echo "→ schelet: ${SCHELET#$RADACINA/}"
baza_noua "$BAZA"

aplica() {  # tranzacția runnerului de livrare (--single-transaction + marcaj), fără tabelul de înregistrare (vezi §6)
  echo "→ aplic ${1#$RADACINA/} (tranzacția runnerului de livrare, fără înregistrare)"
  "${PSQL[@]}" -d "${2:-$BAZA}" --single-transaction -c "$MARCAJ" -f "$1" >/dev/null || esec "${1#$RADACINA/} a eșuat"
}

TOTAL_OK=0
ruleaza_teste() {  # $1 = eticheta, $2 = gaura (true/false)
  local iesire; iesire="$(mktemp)"
  echo "→ teste [$1] (gaura=$2)"
  set +e
  "${PSQL[@]}" -d "$BAZA" -o /dev/null -v gaura="$2" -f "$TESTE" 2>&1 | tee "$iesire" | sed 's/^psql:[^ ]* NOTICE:  /  /'
  local st=${PIPESTATUS[0]}
  set -e
  local n; n="$(grep -c 'NOTICE:  OK ' "$iesire" || true)"
  rm -f "$iesire"
  [ "$st" = 0 ] || esec "teste [$1] — psql a ieșit cu $st"
  TOTAL_OK=$((TOTAL_OK + n))
  echo "   [$1] $n aserțiuni OK"
}

NEG_OK=0
# Suita trebuie să CADĂ pe o aserțiune (ESEC TEST), nu din alt motiv: testele nu trec „în gol”.
teste_cad() {  # $1 = eticheta, $2 = gaura (true/false), $3 = fragment așteptat din prima aserțiune picată
  local iesire; iesire="$(mktemp)"
  if "${PSQL[@]}" -d "$BAZA" -o /dev/null -v gaura="$2" -f "$TESTE" >"$iesire" 2>&1; then
    rm -f "$iesire"; esec "$1: suita (gaura=$2) a TRECUT pe o stare pe care trebuia să cadă"
  fi
  grep -q "ESEC TEST: $3" "$iesire" || { tail -5 "$iesire" >&2; rm -f "$iesire"; esec "$1: suita a căzut din alt motiv decât aserțiunea „$3”"; }
  echo "   OK   $1: $(grep -m1 -o 'ESEC TEST: [^(]*' "$iesire" | cut -c1-120)"
  rm -f "$iesire"; NEG_OK=$((NEG_OK + 1))
}

# Un scenariu negativ: pregătire (DDL) + fișierul, TOTUL într-o singură tranzacție care TREBUIE să eșueze.
refuzat() {  # $1 = eticheta, $2 = fișier, $3 = fragment așteptat în eroare, $4 = SQL de pregătire ('' = nimic), $5 = 'armat' opțional
  local err; err="$(mktemp)"
  local args=(-d "$BAZA" --single-transaction -c "$MARCAJ")
  [ -n "$4" ] && args+=(-c "$4")
  [ "${5:-}" = armat ] && args+=(-c "$ARMARE")
  args+=(-f "$2")
  if "${PSQL[@]}" "${args[@]}" >/dev/null 2>"$err"; then rm -f "$err"; esec "$1: trebuia REFUZAT, dar a trecut"; fi
  grep -qF -- "$3" "$err" || { cat "$err" >&2; rm -f "$err"; esec "$1: refuzat din alt motiv (lipsește „$3”)"; }
  echo "   OK   $1 → refuzat: $(grep -m1 -o 'ERROR: .*' "$err" | cut -c8-170)"
  rm -f "$err"; NEG_OK=$((NEG_OK + 1))
}

schema_snapshot() {  # schema fără date, cu ACL-uri și comentarii ($1 = baza, implicit $BAZA)
  "$PG_BIN/pg_dump" -h 127.0.0.1 -p "$PORT" -U postgres -d "${1:-$BAZA}" --schema-only \
    | grep -vE '^(--|SET |SELECT pg_catalog\.set_config|\\(un)?restrict )' | sed '/^$/d'
}
fara_urme() {  # $1 = snapshot de referință, $2 = eticheta, $3 = baza (implicit $BAZA)
  local acum; acum="$(mktemp)"; schema_snapshot "${3:-}" > "$acum"
  if ! diff -u "$1" "$acum" > "$acum.diff"; then head -60 "$acum.diff" >&2; esec "$2: a rămas o urmă în schemă"; fi
  rm -f "$acum" "$acum.diff"; echo "   OK   $2: pg_dump identic (nicio urmă)"; NEG_OK=$((NEG_OK + 1))
}

# Pregătiri reutilizate de scenariile negative (rulează în aceeași tranzacție cu fișierul testat).
INJECTEAZA_RPC="DO \$d\$ DECLARE v text; BEGIN
  v := pg_get_functiondef('public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure);
  EXECUTE replace(v, E'\nbegin\n', E'\nbegin\n  -- corecție ulterioară simulată (S3)\n'); END \$d\$;"
TRIGGER_IN_PLUS="CREATE FUNCTION public.adv_sync_dept() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp AS \$f\$ BEGIN IF NEW.name LIKE '%[hr]%' THEN NEW.department := 'HR'; END IF; RETURN NEW; END \$f\$;
  CREATE TRIGGER zz_adv_sync_dept BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.adv_sync_dept();"
CORP_TRIGGER_SCHIMBAT="DO \$d\$ DECLARE v text; BEGIN
  v := pg_get_functiondef('public.enforce_owner_only_salary_flags()'::regprocedure);
  EXECUTE replace(v, E'\nBEGIN\n', E'\nBEGIN\n  -- modificat\n'); END \$d\$;"
POLITICA_SURSA="DROP POLICY hr_autorizatii_write_authorized ON public.hr_autorizatii; CREATE POLICY hr_autorizatii_write_authorized ON public.hr_autorizatii FOR ALL TO authenticated"
HELPER_STRAIN="CREATE FUNCTION public.fn_poate_scrie_hr_autorizatii() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS \$fn\$ SELECT true \$fn\$;"
# Helperul aprobat, extras din migrare (fidel), pentru scenariile „corp aprobat, dar atribute/ACL diferite”.
HELPER_APROBAT="$(awk '/^CREATE OR REPLACE FUNCTION public.fn_poate_scrie_hr_autorizatii/{f=1} f{print} f && /^\$fn\$;$/{exit}' "$MIGRARE")"
[ -n "$HELPER_APROBAT" ] || mediu "nu găsesc definiția helperului în migrare"

# Variante ale fișierului de migrare (erori injectate); verifică că injecția s-a făcut exact o dată.
varianta() {  # $1 = tip, $2 = ieșire
  case "$1" in
    dupa_prima_functie) awk '{print} !d && /^\$fn\$;$/ {print "SELECT 1/0;  -- EROARE INJECTATĂ: după prima înlocuire de funcție"; d=1}' "$MIGRARE" > "$2" ;;
    in_postconditie)    awk '!d && /^END \$post\$;$/ {print "  SELECT 1/0;  -- EROARE INJECTATĂ: în postcondiție"; d=1} {print}' "$MIGRARE" > "$2" ;;
    grant_coloana)      awk '!d && /^DO \$post\$$/ {print "GRANT UPDATE (observatii) ON public.hr_autorizatii_rsvti_confirmari TO authenticated;  -- rămas după REVOKE"; d=1} {print}' "$MIGRARE" > "$2" ;;
  esac
  [ "$(grep -c 'EROARE INJECTATĂ\|rămas după REVOKE' "$2")" = 1 ] || mediu "varianta $1: punctul de injecție nu există exact o dată în $MIGRARE"
}
VAR_DIR="$(mktemp -d)"
varianta dupa_prima_functie "$VAR_DIR/err_prima.sql"
varianta in_postconditie    "$VAR_DIR/err_post.sql"
varianta grant_coloana      "$VAR_DIR/grant_coloana.sql"

# --- 3. ciclul -----------------------------------------------------------------
echo "→ S. verificări statice"
STATIC_OK=0
static() { echo "   OK   S $1"; STATIC_OK=$((STATIC_OK + 1)); NEG_OK=$((NEG_OK + 1)); }
! ls "$RADACINA"/supabase/migrations/ | grep -qi 'rollback.*20261003c\|20261003c.*rollback' \
  || esec "S: un rollback 20261003c a rămas în supabase/migrations (runner-ele l-ar descoperi ca migrare forward)"
[ -f "$RADACINA/supabase/revenire/README.md" ] || esec "S: lipsește supabase/revenire/README.md"
static "rollback-ul tehnic 20261003c e în supabase/revenire/, nu în supabase/migrations/"
REFS="$(grep -ohE "supabase/(migrations|revenire)[^'\" ]*" "$RADACINA"/.github/workflows/* || true)"
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  [[ "$ref" =~ ^supabase/migrations/[0-9]{8}[a-z]?_[A-Za-z0-9_]+ ]] || esec "S: CI referă „$ref” (nu un fișier anume din supabase/migrations)"
done <<< "$REFS"
static "CI (.github/workflows) referă doar fișiere anume din supabase/migrations; nimic din supabase/revenire"
! grep -qiE '^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|ABORT)\s*(TRANSACTION|WORK)?\s*;' "$MIGRARE" \
  && [ "$(grep -v '^--' "$MIGRARE" | grep -v '^\s*$' | head -1)" = 'DO $livrare_start$' ] \
  && [ "$(grep -v '^\s*$' "$MIGRARE" | tail -1)" = 'END $livrare_final$;' ] \
  && [ "$(grep -n -x 'END \$post\$;' "$MIGRARE" | cut -d: -f1)" -lt "$(grep -n -x 'DO \$livrare_final\$' "$MIGRARE" | cut -d: -f1)" ] \
  || esec "S: migrarea: fără BEGIN/COMMIT, garda de livrare prima și ultima, postcondiția înaintea gărzii de final"
static "migrarea: fără BEGIN/COMMIT (gestionar = runnerul de livrare), garda de livrare prima + ultima, postcondiția (§4) înainte de final"
! grep -qiE '^\s*(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\s*;' "$ROLLBACK" || esec "S: rollback-ul nu trebuie să conțină BEGIN/COMMIT (gestionarul e operatorul)"
static "rollback-ul: fără BEGIN/COMMIT (gestionarul e operatorul)"
! grep -nE '<>|NOT IN \(' "$MIGRARE" "$ROLLBACK" || esec "S: comparație „<>”/„NOT IN” în fișiere (nu e NULL-safe)"
static "nicio comparație „<>” / „NOT IN (” în migrare și rollback (NULL-safe: IS [NOT] DISTINCT FROM)"

SNAP_INAINTE="$(mktemp)"; schema_snapshot > "$SNAP_INAINTE"
ruleaza_teste "0 schelet = producția de azi" true

echo "→ 0b. precondiții/postcondiții negative pe starea live (fiecare într-o tranzacție anulată)"
refuzat "0a politica sursă ALL TO authenticated FĂRĂ USING/WITH CHECK (md5 NULL)" "$MIGRARE" "Precondiție 0a: hr_autorizatii_write_authorized s-a schimbat" \
  "$POLITICA_SURSA;"
refuzat "0a politica sursă doar cu USING (WITH CHECK NULL)" "$MIGRARE" "WITH CHECK absent" \
  "$POLITICA_SURSA USING ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND ((p.is_owner = true) OR (p.can_modify_employees = true) OR (p.role = 'superadmin'::text) OR (p.department = ANY (ARRAY['HR'::text, 'Administrativ'::text])))))));"
refuzat "0a politica sursă USING (true) WITH CHECK (true) (control)" "$MIGRARE" "Precondiție 0a: hr_autorizatii_write_authorized s-a schimbat" \
  "$POLITICA_SURSA USING (true) WITH CHECK (true);"
refuzat "0a RLS dezactivat pe hr_autorizatii (tabelul sursă)" "$MIGRARE" "Precondiție 0a: RLS nu e activ pe hr_autorizatii" \
  "ALTER TABLE public.hr_autorizatii DISABLE ROW LEVEL SECURITY;"
refuzat "S1 politică INSERT permisivă în plus pe jurnal" "$MIGRARE" "Precondiție 0e: jurnalul are 2 politici de scriere" \
  "CREATE POLICY adv_jurnal_insert_extra ON public.hr_autorizatii_rsvti_confirmari FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL));"
refuzat "S1 politica de azi relaxată (același nume, WITH CHECK true)" "$MIGRARE" "Precondiție 0e: jurnalul are 1 politici de scriere (0 recunoscute)" \
  "ALTER POLICY hr_autorizatii_rsvti_confirmari_insert_authenticated ON public.hr_autorizatii_rsvti_confirmari WITH CHECK (true);"
refuzat "S1 RLS oprit pe jurnal" "$MIGRARE" "Precondiție 0e: RLS nu e activ pe hr_autorizatii_rsvti_confirmari" \
  "ALTER TABLE public.hr_autorizatii_rsvti_confirmari DISABLE ROW LEVEL SECURITY;"
refuzat "S2 al 5-lea trigger pe profiles (scrie department, sortat după S-A)" "$MIGRARE" "Precondiție 0c: triggerele de pe profiles nu sunt exact cele 4 analizate (5 triggere, 4 conforme" \
  "$TRIGGER_IN_PLUS"
refuzat "S2 S-A dezactivat (DISABLE TRIGGER)" "$MIGRARE" "(4 triggere, 3 conforme" \
  "ALTER TABLE public.profiles DISABLE TRIGGER trg_profiles_campuri_owner_only;"
refuzat "S2 corpul unui trigger schimbat" "$MIGRARE" "(4 triggere, 3 conforme" \
  "$CORP_TRIGGER_SCHIMBAT"
refuzat "S2 trigger cu același nume, dar AFTER UPDATE" "$MIGRARE" "(4 triggere, 3 conforme" \
  "DROP TRIGGER trg_protect_can_access_pontaj_brut ON public.profiles; CREATE TRIGGER trg_protect_can_access_pontaj_brut AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION protect_can_access_pontaj_brut();"
refuzat "0d RPC live modificat între timp (necunoscut)" "$MIGRARE" "Precondiție 0d: confirm_hr_autorizatie_rsvti nu e nici versiunea live" \
  "$INJECTEAZA_RPC"
refuzat "0d RPC cu corpul live, dar altă semnătură (DEFAULT NULL::date)" "$MIGRARE" "Precondiție 0d: confirm_hr_autorizatie_rsvti nu e nici versiunea live" \
  "DO \$d\$ BEGIN EXECUTE replace(pg_get_functiondef('public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure), 'DEFAULT CURRENT_DATE', 'DEFAULT NULL::date'); END \$d\$;"
refuzat "0f helper existent cu ALT corp (înainte de orice modificare)" "$MIGRARE" "Precondiție 0f: fn_poate_scrie_hr_autorizatii există deja, dar nu e definiția aprobată (funcții cu acest nume: 1, corp md5: false" \
  "$HELPER_STRAIN"
refuzat "0f supraîncărcare fn_poate_scrie_hr_autorizatii(integer)" "$MIGRARE" "(funcții cu acest nume: 1, corp md5: absent" \
  "CREATE FUNCTION public.fn_poate_scrie_hr_autorizatii(p integer) RETURNS boolean LANGUAGE sql AS \$fn\$ SELECT true \$fn\$;"
refuzat "4d grant UPDATE pe coloană către PUBLIC, rămas după migrare" "$MIGRARE" "Postcondiție 4d: privilegiul efectiv UPDATE pentru public pe hr_autorizatii_rsvti_confirmari = true" \
  "GRANT UPDATE (observatii) ON public.hr_autorizatii_rsvti_confirmari TO PUBLIC;"
refuzat "4d grant UPDATE pe coloană către authenticated rămas după REVOKE (variantă a fișierului)" "$VAR_DIR/grant_coloana.sql" "Postcondiție 4d: privilegiul efectiv UPDATE pentru authenticated pe hr_autorizatii_rsvti_confirmari = true" ""
refuzat "4d UPDATE pe jurnal printr-un rol moștenit de authenticated (WITH INHERIT TRUE)" "$MIGRARE" "Postcondiție 4d: privilegiul efectiv UPDATE pentru authenticated" \
  "CREATE ROLE sec_rsvti_r_mostenit NOLOGIN; GRANT UPDATE ON public.hr_autorizatii_rsvti_confirmari TO sec_rsvti_r_mostenit; GRANT sec_rsvti_r_mostenit TO authenticated WITH INHERIT TRUE;"
refuzat "4d EXECUTE pe RPC printr-un rol moștenit de anon (WITH INHERIT TRUE)" "$MIGRARE" "Postcondiție 4d: privilegiul efectiv EXECUTE pentru anon pe public.confirm_hr_autorizatie_rsvti" \
  "CREATE ROLE sec_rsvti_r_exec NOLOGIN; GRANT EXECUTE ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint,date,text) TO sec_rsvti_r_exec; GRANT sec_rsvti_r_exec TO anon WITH INHERIT TRUE;"
refuzat "4b RPC cu alt proprietar (CREATE OR REPLACE îl păstrează)" "$MIGRARE" "Postcondiție 4b: atributele funcțiilor" \
  "CREATE ROLE sec_rsvti_r_alt NOLOGIN; ALTER FUNCTION public.confirm_hr_autorizatie_rsvti(bigint,date,text) OWNER TO sec_rsvti_r_alt;"
fara_urme "$SNAP_INAINTE" "0b refuzurile pe starea live"

aplica "$MIGRARE";  ruleaza_teste "1 după migrare" false
aplica "$MIGRARE";  ruleaza_teste "2 după reaplicare (idempotență)" false

SNAP_PATCH="$(mktemp)"; schema_snapshot > "$SNAP_PATCH"
echo "→ 2b. reaplicare peste o stare schimbată (tranzacții anulate)"
refuzat "S1 reaplicare peste o politică ALL în plus pe jurnal" "$MIGRARE" "Precondiție 0e: jurnalul are 2 politici de scriere" \
  "CREATE POLICY adv_jurnal_all_extra ON public.hr_autorizatii_rsvti_confirmari FOR ALL TO authenticated USING (true) WITH CHECK (true);"
refuzat "0d reaplicare peste un RPC corectat ulterior" "$MIGRARE" "Precondiție 0d: confirm_hr_autorizatie_rsvti nu e nici versiunea live" \
  "$INJECTEAZA_RPC"
refuzat "0f reaplicare peste un helper cu alt corp" "$MIGRARE" "corp md5: false" \
  "CREATE OR REPLACE FUNCTION public.fn_poate_scrie_hr_autorizatii() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS \$fn\$ SELECT true \$fn\$;"
refuzat "0f reaplicare peste helperul aprobat devenit SECURITY INVOKER" "$MIGRARE" "corp md5: true, atribute: false, ACL: true" \
  "ALTER FUNCTION public.fn_poate_scrie_hr_autorizatii() SECURITY INVOKER;"
refuzat "0f reaplicare peste helperul aprobat cu EXECUTE în plus pentru anon" "$MIGRARE" "corp md5: true, atribute: true, ACL: false" \
  "GRANT EXECUTE ON FUNCTION public.fn_poate_scrie_hr_autorizatii() TO anon;"
fara_urme "$SNAP_PATCH" "2b refuzurile pe starea patch"

echo "→ 3a. rollback tehnic: armare și precondiții (tranzacții anulate)"
BLOCAT="ROLLBACK TEHNIC 20261003c blocat: redeschide gaura RSVTI"
refuzat "rollback NEARMAT" "$ROLLBACK" "$BLOCAT" ""
refuzat "rollback armat cu altă valoare" "$ROLLBACK" "$BLOCAT" "SELECT set_config('gazpet.rollback_tehnic_20261003c', 'da', true);"
refuzat "rollback armat în stilul r2 (SET LOCAL fără txid)" "$ROLLBACK" "$BLOCAT" "SET LOCAL gazpet.rollback_tehnic_20261003c = 'REDESCHIDE_GAURA_RSVTI';"
refuzat "rollback armat cu txid-ul altei tranzacții" "$ROLLBACK" "$BLOCAT" \
  "SELECT set_config('gazpet.rollback_tehnic_20261003c', 'REDESCHIDE_GAURA_RSVTI:' || (txid_current() - 1), true);"
refuzat "rollback cu comutatorul Ofertare (20261003b)" "$ROLLBACK" "$BLOCAT" "SET LOCAL gazpet.rollback_tehnic_20261003b = 'REDESCHIDE_BYPASS';"
refuzat "armare PERSISTENTĂ (ALTER DATABASE SET), chiar cu armarea tranzacției validă" "$ROLLBACK" "comutatorul e armat PERSISTENT" \
  "ALTER DATABASE \"$BAZA\" SET gazpet.rollback_tehnic_20261003c = 'REDESCHIDE_GAURA_RSVTI';" armat
refuzat "armare PERSISTENTĂ pe rol, nume cu majuscule (ALTER ROLE … SET \"Gazpet.ROLLBACK…\")" "$ROLLBACK" "comutatorul e armat PERSISTENT" \
  "ALTER ROLE postgres SET \"Gazpet.ROLLBACK_tehnic_20261003c\" = 'x';" armat
refuzat "S3 rollback armat peste un RPC corectat ulterior" "$ROLLBACK" "Precondiție rollback 20261003c: confirm_hr_autorizatie_rsvti nu e versiunea patch-ului" \
  "$INJECTEAZA_RPC" armat
refuzat "rollback armat peste RPC-ul patch-ului cu semnătura schimbată (DEFAULT CURRENT_DATE)" "$ROLLBACK" "Precondiție rollback 20261003c: confirm_hr_autorizatie_rsvti nu e versiunea patch-ului" \
  "DO \$d\$ BEGIN EXECUTE replace(pg_get_functiondef('public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure), 'DEFAULT NULL::date', 'DEFAULT CURRENT_DATE'); END \$d\$;" armat
refuzat "rollback armat peste un helper schimbat" "$ROLLBACK" "Precondiție rollback 20261003c: fn_poate_scrie_hr_autorizatii lipsește sau nu e versiunea patch-ului" \
  "CREATE OR REPLACE FUNCTION public.fn_poate_scrie_hr_autorizatii() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS \$fn\$ SELECT true \$fn\$;" armat
refuzat "rollback armat peste politica patch-ului relaxată" "$ROLLBACK" "Precondiție rollback 20261003c: jurnalul are 1 politici de scriere (0 = cea din patch)" \
  "ALTER POLICY hr_autorizatii_rsvti_confirmari_insert_autorizat ON public.hr_autorizatii_rsvti_confirmari WITH CHECK (true);" armat
refuzat "rollback armat peste o politică de scriere în plus" "$ROLLBACK" "Precondiție rollback 20261003c: jurnalul are 2 politici de scriere (1 = cea din patch)" \
  "CREATE POLICY adv_jurnal_insert_extra ON public.hr_autorizatii_rsvti_confirmari FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL));" armat
refuzat "S4 rollback armat cu o dependență nouă de helper" "$ROLLBACK" "other objects depend on it" \
  "CREATE TABLE public.adv_dep (id int); ALTER TABLE public.adv_dep ENABLE ROW LEVEL SECURITY; CREATE POLICY adv_dep_p ON public.adv_dep FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_poate_scrie_hr_autorizatii()));" armat
[ "$("${PSQL[@]}" -d postgres -Atc "SELECT count(*) FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.%'")" = 0 ] || esec "a rămas o setare persistentă după scenariile 3a"

echo "→ 3s. o singură sesiune psql, mai multe tranzacții (starea de sesiune persistă între ele)"
SES="$(mktemp)"
cat > "$SES" <<SQL
\set ON_ERROR_STOP 1
SELECT md5(pg_get_functiondef('public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure)) AS rpc0 \gset
-- (1) setare PREEXISTENTĂ de sesiune (valoarea din r2), fără armare nouă
SET gazpet.rollback_tehnic_20261003c = 'REDESCHIDE_GAURA_RSVTI';
\set ON_ERROR_STOP 0
BEGIN;
\i $ROLLBACK
COMMIT;
\set ON_ERROR_STOP 1
SELECT teste.assert(:'LAST_ERROR_MESSAGE' LIKE '$BLOCAT%', 'RB-S1 setare de sesiune preexistentă (fără txid), fără armare nouă → REFUZAT: ' || left(:'LAST_ERROR_MESSAGE', 60));
\set LAST_ERROR_MESSAGE ''
-- (2) setare de sesiune legată de o tranzacție ANTERIOARĂ (txid vechi), fără armare nouă
SELECT set_config('gazpet.rollback_tehnic_20261003c', 'REDESCHIDE_GAURA_RSVTI:' || txid_current(), false);
\set ON_ERROR_STOP 0
BEGIN;
\i $ROLLBACK
COMMIT;
\set ON_ERROR_STOP 1
SELECT teste.assert(:'LAST_ERROR_MESSAGE' LIKE '$BLOCAT%', 'RB-S2 setare de sesiune cu txid-ul unei tranzacții anterioare → REFUZAT');
\set LAST_ERROR_MESSAGE ''
RESET gazpet.rollback_tehnic_20261003c;
-- (3) armare VALIDĂ (locală + greșit și de sesiune, același txid) + eroare în fișier (precondiție) + ROLLBACK, apoi reluare
\set ON_ERROR_STOP 0
BEGIN;
SELECT set_config('gazpet.rollback_tehnic_20261003c', 'REDESCHIDE_GAURA_RSVTI:' || txid_current(), true);
SELECT set_config('gazpet.rollback_tehnic_20261003c', 'REDESCHIDE_GAURA_RSVTI:' || txid_current(), false);
CREATE POLICY adv_jurnal_insert_extra ON public.hr_autorizatii_rsvti_confirmari FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL));
\i $ROLLBACK
ROLLBACK;
\set ON_ERROR_STOP 1
SELECT teste.assert(:'LAST_ERROR_MESSAGE' LIKE 'Precondiție rollback 20261003c: jurnalul are 2 politici%', 'RB-S3 tranzacția armată valid a eșuat în precondiție și s-a anulat');
SELECT teste.assert(coalesce(current_setting('gazpet.rollback_tehnic_20261003c', true), '') = '', 'RB-S3 după ROLLBACK armarea (inclusiv cea de sesiune din tranzacția eșuată) a dispărut');
\set LAST_ERROR_MESSAGE ''
\set ON_ERROR_STOP 0
BEGIN;
\i $ROLLBACK
COMMIT;
\set ON_ERROR_STOP 1
SELECT teste.assert(:'LAST_ERROR_MESSAGE' LIKE '$BLOCAT%', 'RB-S3 reluare fără armare nouă, în aceeași sesiune → REFUZAT');
SELECT teste.assert(md5(pg_get_functiondef('public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure)) = :'rpc0', 'RB-S RPC-ul patch-ului neschimbat după toate încercările');
SQL
IES="$(mktemp)"
"${PSQL[@]}" -d "$BAZA" -f "$SES" >"$IES" 2>&1 || { cat "$IES" >&2; esec "3s: sesiunea unică a eșuat"; }
N3S="$(grep -c 'NOTICE:  OK ' "$IES" || true)"
[ "$N3S" = 6 ] || { cat "$IES" >&2; esec "3s: $N3S/6 aserțiuni"; }
grep 'NOTICE:  OK ' "$IES" | sed 's/.*NOTICE:  /   /'
NEG_OK=$((NEG_OK + 3)); TOTAL_OK=$((TOTAL_OK + N3S)); rm -f "$SES" "$IES"
fara_urme "$SNAP_PATCH" "3a/3s refuzurile pe starea patch"

echo "→ 3. rollback tehnic ARMAT: string-ul documentat (BEGIN; armare; fișier; COMMIT;) ca un singur query"
DEZ="$("${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;
$ARMARE
$(cat "$ROLLBACK")
COMMIT;" -c "SELECT 'dezarmat=' || (coalesce(current_setting('gazpet.rollback_tehnic_20261003c', true), '') = '')::text" 2>/dev/null | tail -1)" \
  || esec "rollback-ul tehnic armat a eșuat"
[ "$DEZ" = "dezarmat=true" ] || esec "rollback-ul tehnic n-a dezarmat comutatorul ($DEZ)"
echo "   OK   rollback aplicat; comutatorul e dezarmat în sesiune după COMMIT"; NEG_OK=$((NEG_OK + 1))
SNAP_DUPA="$(mktemp)"; schema_snapshot > "$SNAP_DUPA"
if ! diff -u "$SNAP_INAINTE" "$SNAP_DUPA" > "$SNAP_DUPA.diff"; then
  echo "!! schema după rollback diferă de cea dinainte de migrare:" >&2
  head -80 "$SNAP_DUPA.diff" >&2
  esec "rollback tehnic incomplet"
fi
echo "   schema după rollback = schema dinainte de migrare (pg_dump identic)"
rm -f "$SNAP_INAINTE" "$SNAP_DUPA" "$SNAP_DUPA.diff" "$SNAP_PATCH"
ruleaza_teste "3 după rollback tehnic: gaura redeschisă" true
teste_cad "suita PATCH pe starea live (după rollback)" false "P1 helperul"

aplica "$MIGRARE";  ruleaza_teste "4 după reaplicare: gaura închisă" false
teste_cad "suita GAURA pe starea patch" true "G1 RPC-ul este exact cel LIVE"

# 5. Operator care armează și local, și de sesiune (set_config(…, false)), în aceeași tranzacție: rollback-ul trece
#    (txid-ul e al tranzacției), iar la final dezarmează și sesiunea. Apoi reaplicare ⇒ schema de la pasul 4.
SNAP_4="$(mktemp)"; schema_snapshot > "$SNAP_4"
echo "→ 5. rollback armat local + de sesiune în aceeași tranzacție → sesiunea e dezarmată după COMMIT; reaplicare"
DEZ="$("${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;
$ARMARE
SELECT set_config('gazpet.rollback_tehnic_20261003c', 'REDESCHIDE_GAURA_RSVTI:' || txid_current(), false);
$(cat "$ROLLBACK")
COMMIT;" -c "SELECT 'dezarmat=' || (coalesce(current_setting('gazpet.rollback_tehnic_20261003c', true), '') = '')::text" 2>/dev/null | tail -1)" \
  || esec "rollback-ul armat local + de sesiune a eșuat"
[ "$DEZ" = "dezarmat=true" ] || esec "după rollback, armarea de sesiune a rămas ($DEZ)"
echo "   OK   armare și de sesiune: comutatorul e dezarmat după COMMIT (fișierul dezarmează și sesiunea)"; NEG_OK=$((NEG_OK + 1))
aplica "$MIGRARE"
fara_urme "$SNAP_4" "5 rollback + reaplicare ⇒ aceeași schemă ca la pasul 4"
rm -f "$SNAP_4"

# 6. Traseul EFECTIV de livrare (runda 4, verdict Copilot r3): scripts/livrare_migrare.sh, pe o bază auxiliară.
#    Gestionar unic = psql --single-transaction [marcaj + migrare + INSERT în schema_migrations].
echo "→ 6. traseul de livrare: scripts/livrare_migrare.sh (marcaj + migrare + înregistrare într-o singură tranzacție)"
# Coloanele reale din producție (information_schema, citit read-only 30.09).
REG_TABEL="CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);"
NUME_MIG="20261003c_sec_rsvti_poarta_jurnal"
CONN_AUX=(-h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA_AUX")
ERR_R="$(mktemp)"
livreaza() {  # $1 = fișier (copiat sub numele real al migrării: runnerul derivă numele din fișier), $2 = versiune
  mkdir -p "$VAR_DIR/livrare"; cp "$1" "$VAR_DIR/livrare/$NUME_MIG.sql"
  set +e; PSQL_BIN="$PG_BIN/psql" VERSIUNE_MIGRARE="${2:-20261003000000}" bash "$LIVRARE" "$VAR_DIR/livrare/$NUME_MIG.sql" -- "${CONN_AUX[@]}" >/dev/null 2>"$ERR_R"; RC=$?; set -e
}
psql_aux() { set +e; "$PG_BIN/psql" -X -q "${CONN_AUX[@]}" "$@" >/dev/null 2>"$ERR_R"; RC=$?; set -e; }
inregistrata() { "${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name = '$NUME_MIG'"; }
stare_patch() { "${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure"; }
MD5_PATCH="$(grep -m1 -oE "IS DISTINCT FROM '[0-9a-f]{32}'" <(sed -n '/^DO \$post\$$/,/^END \$post\$;$/p' "$MIGRARE") | grep -oE '[0-9a-f]{32}')"
aux_nou() { baza_noua "$BAZA_AUX"; "${PSQL[@]}" -d "$BAZA_AUX" -c "$REG_TABEL" >/dev/null; }
# Eroare injectată CHIAR la INSERT-ul în schema_migrations; triggerul verifică întâi că patch-ul e deja instalat
# în tranzacție (deci TOATE postcondițiile și garda de final au trecut) — altfel eroarea ar fi alta.
INJ_REG="CREATE FUNCTION supabase_migrations.adv_injectie() RETURNS trigger LANGUAGE plpgsql AS \$i\$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure) IS DISTINCT FROM '$MD5_PATCH'
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_poate_scrie_hr_autorizatii') THEN
    RAISE EXCEPTION 'injecție: patch-ul NU e instalat la momentul înregistrării';
  END IF;
  RAISE EXCEPTION 'EROARE INJECTATĂ la INSERT în schema_migrations (patch instalat, postcondiții trecute)';
END \$i\$;
CREATE TRIGGER adv_injectie BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION supabase_migrations.adv_injectie();"
esuat_fara_urme() {  # $1 = eticheta, $2 = fragment așteptat, $3 = snapshot, $4 = înregistrări așteptate (implicit 0)
  [ $RC != 0 ] || esec "$1: trebuia să eșueze"
  grep -qF -- "$2" "$ERR_R" || { cat "$ERR_R" >&2; esec "$1: a eșuat din alt motiv (lipsește „$2”)"; }
  [ "$(inregistrata)" = "${4:-0}" ] || esec "$1: înregistrări = $(inregistrata), așteptat ${4:-0}"
  fara_urme "$3" "$1 → refuzat, definiții/politici/ACL neschimbate, înregistrări: ${4:-0}" "$BAZA_AUX"
}

# 6.1 succes: patch + O înregistrare (version, name, statements = fișierul întreg)
aux_nou; livreaza "$MIGRARE" 20261003000000
[ $RC = 0 ] || { cat "$ERR_R" >&2; esec "6.1 livrarea fără eroare a eșuat"; }
[ "$(stare_patch)" = "$MD5_PATCH" ] && [ "$(inregistrata)" = 1 ] || esec "6.1 patch neaplicat sau neînregistrat"
[ "$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT version FROM supabase_migrations.schema_migrations")" = 20261003000000 ] \
  || esec "6.1 versiunea înregistrată"
"${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT statements[1] FROM supabase_migrations.schema_migrations WHERE name = '$NUME_MIG'" | cmp -s - <(cat "$MIGRARE"; echo) \
  || esec "6.1 statements[1] nu e fișierul migrării, octet cu octet"
echo "   OK   6.1 livrare: patch aplicat + înregistrat o dată (version 20261003000000, name $NUME_MIG, statements = fișierul)"; NEG_OK=$((NEG_OK + 1))
# 6.2 reluare după succes (altă versiune) ⇒ refuz la înregistrare, anulat tot, fără dublare
SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
livreaza "$MIGRARE" 20261003000001
esuat_fara_urme "6.2 reluare după succes" "migrarea e deja înregistrată" "$SNAP_E" 1
rm -f "$SNAP_E"

# 6.3 erori injectate: după prima funcție, în postcondiție, CHIAR la INSERT-ul în schema_migrations
for var in err_prima err_post err_reg; do
  aux_nou
  [ $var = err_reg ] && "${PSQL[@]}" -d "$BAZA_AUX" -c "$INJ_REG" >/dev/null
  SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
  case $var in
    err_prima) livreaza "$VAR_DIR/err_prima.sql"; esuat_fara_urme "6.3 1/0 după prima funcție" "division by zero" "$SNAP_E" ;;
    err_post)  livreaza "$VAR_DIR/err_post.sql";  esuat_fara_urme "6.3 1/0 în postcondiție" "division by zero" "$SNAP_E" ;;
    err_reg)   livreaza "$MIGRARE"; esuat_fara_urme "6.3 eroare CHIAR la INSERT-ul în schema_migrations, după postcondiții și garda de final" \
                 "EROARE INJECTATĂ la INSERT în schema_migrations (patch instalat, postcondiții trecute)" "$SNAP_E"
               [ "$(stare_patch)" != "$MD5_PATCH" ] || esec "6.3 err_reg: RPC-ul patch-ului a rămas"
               # 6.4 reluarea PERMISĂ (după eșec): fără injecție ⇒ patch + o înregistrare
               "${PSQL[@]}" -d "$BAZA_AUX" -c "DROP TRIGGER adv_injectie ON supabase_migrations.schema_migrations; DROP FUNCTION supabase_migrations.adv_injectie();" >/dev/null
               livreaza "$MIGRARE" 20261003000002
               [ $RC = 0 ] && [ "$(stare_patch)" = "$MD5_PATCH" ] && [ "$(inregistrata)" = 1 ] || { cat "$ERR_R" >&2; esec "6.4 reluarea permisă după eșec"; }
               echo "   OK   6.4 reluare permisă după înregistrarea eșuată: patch + exact o înregistrare"; NEG_OK=$((NEG_OK + 1)) ;;
  esac
  rm -f "$SNAP_E"
done

# 6.5 fișierul rulat SINGUR, fără runner ⇒ garda de livrare (start) refuză, nimic comis
aux_nou; SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
START="Livrare 20261003c: garda de livrare (start)"
psql_aux -v ON_ERROR_STOP=1 -f "$MIGRARE";                      esuat_fara_urme "6.5 psql -f simplu (autocommit)" "$START" "$SNAP_E"
psql_aux -c "$(cat "$MIGRARE")";                                esuat_fara_urme "6.5 un singur query (psql -c, ca execute_sql)" "$START" "$SNAP_E"
psql_aux -v ON_ERROR_STOP=1 --single-transaction -f "$MIGRARE"; esuat_fara_urme "6.5 --single-transaction fără marcaj (fără înregistrare)" "$START" "$SNAP_E"
psql_aux -v ON_ERROR_STOP=1 -c "SELECT set_config('gazpet.livrare_migrare', '$NUME_MIG:' || txid_current(), false)" -f "$MIGRARE"
esuat_fara_urme "6.5 marcaj de SESIUNE dintr-o tranzacție anterioară + psql -f" "$START" "$SNAP_E"
psql_aux -v ON_ERROR_STOP=1 -c "SET gazpet.livrare_migrare = '$NUME_MIG'" -f "$MIGRARE"
esuat_fara_urme "6.5 marcaj de sesiune fără txid" "$START" "$SNAP_E"
# 6.6 control de tranzacție în fișier ⇒ runnerul refuză înainte de conexiune; „END;” la nivel de instrucțiune
#     (nedetectabil textual) ⇒ garda de final eșuează, NEÎNREGISTRAT (limită documentată: ce era înainte de END; e comis)
awk '{print} !d && /^\$fn\$;$/ {print "COMMIT;  -- MUTANT"; d=1}' "$MIGRARE" > "$VAR_DIR/mut_commit.sql"
livreaza "$VAR_DIR/mut_commit.sql"; esuat_fara_urme "6.6 mutant cu COMMIT; în fișier (runnerul refuză)" "conține control de tranzacție" "$SNAP_E"
awk '{print} !d && /^\$fn\$;$/ {print "select 1; commit ;  -- MUTANT"; d=1}' "$MIGRARE" > "$VAR_DIR/mut_commit2.sql"
livreaza "$VAR_DIR/mut_commit2.sql"; esuat_fara_urme "6.6 mutant „select 1; commit ;” pe aceeași linie" "conține control de tranzacție" "$SNAP_E"
awk '{print} !d && /^\$fn\$;$/ {print "END;  -- MUTANT (sinonim COMMIT)"; d=1}' "$MIGRARE" > "$VAR_DIR/mut_end.sql"
livreaza "$VAR_DIR/mut_end.sql"
[ $RC != 0 ] && grep -qF "Livrare 20261003c: garda de livrare (final" "$ERR_R" && [ "$(inregistrata)" = 0 ] \
  || { cat "$ERR_R" >&2; esec "6.6 mutant END;: garda de final nu l-a prins"; }
echo "   OK   6.6 mutant „END;” la nivel de instrucțiune: garda de final eșuează, NEÎNREGISTRAT (prima parte comisă — limită documentată)"
NEG_OK=$((NEG_OK + 1)); rm -f "$SNAP_E" "$ERR_R"

# 7. Ceas fix: repornesc serverul cu libfaketime (@2026-09-29 23:30 UTC), apoi înapoi la ceasul real.
echo "→ 7. ceas fix $CEAS_FIX UTC (libfaketime): data omisă și NULL ⇒ 30.09 (azi București) în UTC și Etc/GMT+12"
[ -f "$FAKETIME_LIB" ] || mediu "libfaketime lipsește ($FAKETIME_LIB)"
opreste; CEAS_SIMULAT=1; porneste "$CEAS_FIX"
CEAS="$("${PSQL[@]}" -d postgres -Atc "SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC / București ' || to_char(now() AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI')")"
echo "   ceasul serverului: $CEAS"
baza_noua "$BAZA_AUX"; aplica "$MIGRARE" "$BAZA_AUX"
IES="$(mktemp)"
"${PSQL[@]}" -d "$BAZA_AUX" -o /dev/null -f "$TESTE_CEAS" >"$IES" 2>&1 || { sed 's/^psql:[^ ]* //' "$IES" >&2; esec "7 ceas fix: $(grep -m1 -o 'ESEC TEST: .*' "$IES")"; }
NC="$(grep -c 'NOTICE:  OK ' "$IES" || true)"; grep 'NOTICE:  OK ' "$IES" | sed 's/.*NOTICE:  /   /'
TOTAL_OK=$((TOTAL_OK + NC)); rm -f "$IES"
readuce_ceasul
"${PSQL[@]}" -d postgres -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS \"$BAZA_AUX\" WITH (FORCE)" >/dev/null
rm -rf "$VAR_DIR"

if [ "$OPRESTE" = 1 ]; then opreste && echo "→ server oprit"; fi
echo "PASS test_sec_rsvti: $TOTAL_OK aserțiuni OK + $NEG_OK verificări negative/fără urme/statice OK (bază $BAZA @ 127.0.0.1:$PORT)"
