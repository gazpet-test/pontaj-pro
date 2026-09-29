#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — SEC RSVTI (20261003c_sec_rsvti_poarta_jurnal.sql), runda 2.
#
# Rulează EXCLUSIV pe un PostgreSQL 16 local dedicat (implicit /tmp/pg_sec_rsvti, 127.0.0.1:5442).
# Nu citește .env, nu folosește chei Supabase, nu atinge producția.
#
# Ciclul complet (Copilot: migrare → teste → rollback tehnic → teste care dovedesc gaura → reaplicare → teste):
#   0. schelet (= producția de azi)       → teste GAURA (fidelitatea: atacurile reușesc pe varianta live)
#   0b. precondiții negative pe starea live (S1 politică în plus pe jurnal, RLS oprit, S2 trigger în plus /
#       dezactivat / alt corp / alt tip, RPC necunoscut) → migrarea REFUZATĂ, fără urme
#   1. migrare                             → teste PATCH
#   2. reaplicare (idempotență)            → teste PATCH; reaplicare peste o politică în plus → REFUZATĂ
#   3a. rollback tehnic: nearmat / armat greșit / armat în altă tranzacție / peste un RPC modificat ulterior
#       (S3) / helper sau politică schimbate / politică în plus / dependență nouă (S4) → REFUZAT, fără urme
#   3. rollback tehnic ARMAT               → dezarmat la final; schema identică cu pasul 0; teste GAURA;
#                                            suita PATCH CADE pe starea live (nu e „vacuu adevărată”)
#   4. reaplicare                          → teste PATCH; suita GAURA CADE pe starea patch
#   5. rollback armat GREȘIT (SET de sesiune) → comutatorul e dezarmat după rulare; reaplicare = schema de la 4
#
# Utilizare (din rădăcina repo-ului; ca root, comenzile de server trec pe utilizatorul postgres prin su):
#   bash scripts/test_sec_rsvti.sh             # ciclul complet
#   bash scripts/test_sec_rsvti.sh --opreste   # + oprește serverul la final
# Variabile opționale: PG_BIN=/usr/lib/postgresql/16/bin PGDATA_TEST=/tmp/pg_sec_rsvti PGPORT_TEST=5442
#   PGDB_TEST=sec_rsvti_test PGLOG_TEST=/tmp/pg_sec_rsvti.log
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
MIGRARE="$RADACINA/supabase/migrations/20261003c_sec_rsvti_poarta_jurnal.sql"
ROLLBACK="$RADACINA/supabase/migrations/20261003c_sec_rsvti_poarta_jurnal_ROLLBACK.sql"
ARMARE="SET LOCAL gazpet.rollback_tehnic_20261003c = 'REDESCHIDE_GAURA_RSVTI';"

OPRESTE=0
for a in "$@"; do
  case "$a" in
    --opreste) OPRESTE=1 ;;
    -h|--help) sed -n '2,26p' "${BASH_SOURCE[0]}"; exit 0 ;;
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
for f in "$SCHELET" "$TESTE" "$MIGRARE" "$ROLLBACK"; do [ -f "$f" ] || mediu "Fișier lipsă: $f"; done

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

if ! "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT" -t 2; then
  echo "→ pornesc PostgreSQL pe 127.0.0.1:$PORT ($DATE_DIR, jurnal $JURNAL_PG)"
  if [ "$(id -u)" = 0 ]; then touch "$JURNAL_PG"; chown postgres:postgres "$JURNAL_PG"; fi
  ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l "$JURNAL_PG" -w -t 30 start \
    -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c timezone=UTC" >/dev/null \
    || { tail -20 "$JURNAL_PG" >&2 || true; mediu "pg_ctl start a eșuat"; }
fi
# Serverul de pe port TREBUIE să fie clusterul nostru — altfel refuz (nu dăm DROP DATABASE pe altceva).
DIR_SERVER="$("${PSQL[@]}" -d postgres -Atc 'SHOW data_directory')" || mediu "nu mă pot conecta la 127.0.0.1:$PORT"
[ "$(realpath "$DIR_SERVER")" = "$(realpath "$DATE_DIR")" ] || mediu "pe portul $PORT rulează alt cluster ($DIR_SERVER)"
VER="$("${PSQL[@]}" -d postgres -Atc 'SHOW server_version_num')"
[ "${VER:0:2}" = 16 ] || mediu "server_version_num=$VER, se cere 16"

# --- 2. bază nouă + schelet ----------------------------------------------------
echo "→ recreez baza $BAZA"
"${PSQL[@]}" -d postgres -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS \"$BAZA\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$BAZA\" TEMPLATE template0 ENCODING 'UTF8'" || mediu "nu pot recrea baza $BAZA"
echo "→ schelet: ${SCHELET#$RADACINA/}"
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" || esec "scheletul nu s-a încărcat (fidelitate?)"

aplica() {  # ca apply_migration: o singură tranzacție
  echo "→ aplic ${1#$RADACINA/}"
  "${PSQL[@]}" -d "$BAZA" --single-transaction -f "$1" || esec "${1#$RADACINA/} a eșuat"
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
  local args=(-d "$BAZA" --single-transaction)
  [ -n "$4" ] && args+=(-c "$4")
  [ "${5:-}" = armat ] && args+=(-c "$ARMARE")
  args+=(-f "$2")
  if "${PSQL[@]}" "${args[@]}" >/dev/null 2>"$err"; then rm -f "$err"; esec "$1: trebuia REFUZAT, dar a trecut"; fi
  grep -qF -- "$3" "$err" || { cat "$err" >&2; rm -f "$err"; esec "$1: refuzat din alt motiv (lipsește „$3”)"; }
  echo "   OK   $1 → refuzat: $(grep -m1 -o 'ERROR: .*' "$err" | cut -c8-170)"
  rm -f "$err"; NEG_OK=$((NEG_OK + 1))
}

schema_snapshot() {  # schema fără date, cu ACL-uri și comentarii
  "$PG_BIN/pg_dump" -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" --schema-only \
    | grep -vE '^(--|SET |SELECT pg_catalog\.set_config|\\(un)?restrict )' | sed '/^$/d'
}
fara_urme() {  # $1 = snapshot de referință, $2 = eticheta
  local acum; acum="$(mktemp)"; schema_snapshot > "$acum"
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

# --- 3. ciclul -----------------------------------------------------------------
SNAP_INAINTE="$(mktemp)"; schema_snapshot > "$SNAP_INAINTE"
ruleaza_teste "0 schelet = producția de azi" true

echo "→ 0b. precondiții negative pe starea live (fiecare într-o tranzacție anulată)"
refuzat "S1 politică INSERT permisivă în plus pe jurnal" "$MIGRARE" "Precondiție: jurnalul are 2 politici de scriere" \
  "CREATE POLICY adv_jurnal_insert_extra ON public.hr_autorizatii_rsvti_confirmari FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL));"
refuzat "S1 politica de azi relaxată (același nume, WITH CHECK true)" "$MIGRARE" "Precondiție: jurnalul are 1 politici de scriere (0 recunoscute)" \
  "ALTER POLICY hr_autorizatii_rsvti_confirmari_insert_authenticated ON public.hr_autorizatii_rsvti_confirmari WITH CHECK (true);"
refuzat "S1 RLS oprit pe jurnal" "$MIGRARE" "Precondiție: RLS nu e activ pe hr_autorizatii_rsvti_confirmari" \
  "ALTER TABLE public.hr_autorizatii_rsvti_confirmari DISABLE ROW LEVEL SECURITY;"
refuzat "S2 al 5-lea trigger pe profiles (scrie department, sortat după S-A)" "$MIGRARE" "Precondiție: triggerele de pe profiles nu sunt exact cele 4 analizate (5 triggere, 4 conforme" \
  "$TRIGGER_IN_PLUS"
refuzat "S2 S-A dezactivat (DISABLE TRIGGER)" "$MIGRARE" "(4 triggere, 3 conforme" \
  "ALTER TABLE public.profiles DISABLE TRIGGER trg_profiles_campuri_owner_only;"
refuzat "S2 corpul unui trigger schimbat" "$MIGRARE" "(4 triggere, 3 conforme" \
  "$CORP_TRIGGER_SCHIMBAT"
refuzat "S2 trigger cu același nume, dar AFTER UPDATE" "$MIGRARE" "(4 triggere, 3 conforme" \
  "DROP TRIGGER trg_protect_can_access_pontaj_brut ON public.profiles; CREATE TRIGGER trg_protect_can_access_pontaj_brut AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION protect_can_access_pontaj_brut();"
refuzat "0d RPC live modificat între timp (necunoscut)" "$MIGRARE" "Precondiție: confirm_hr_autorizatie_rsvti diferă de versiunea analizată" \
  "$INJECTEAZA_RPC"
fara_urme "$SNAP_INAINTE" "0b refuzurile pe starea live"

aplica "$MIGRARE";  ruleaza_teste "1 după migrare" false
aplica "$MIGRARE";  ruleaza_teste "2 după reaplicare (idempotență)" false

SNAP_PATCH="$(mktemp)"; schema_snapshot > "$SNAP_PATCH"
echo "→ 2b. reaplicare peste o stare schimbată (tranzacții anulate)"
refuzat "S1 reaplicare peste o politică ALL în plus pe jurnal" "$MIGRARE" "Precondiție: jurnalul are 2 politici de scriere" \
  "CREATE POLICY adv_jurnal_all_extra ON public.hr_autorizatii_rsvti_confirmari FOR ALL TO authenticated USING (true) WITH CHECK (true);"
refuzat "0d reaplicare peste un RPC corectat ulterior" "$MIGRARE" "Precondiție: confirm_hr_autorizatie_rsvti diferă de versiunea analizată" \
  "$INJECTEAZA_RPC"

echo "→ 3a. rollback tehnic: armare și precondiții (tranzacții anulate)"
refuzat "rollback NEARMAT" "$ROLLBACK" "ROLLBACK TEHNIC 20261003c blocat" ""
refuzat "rollback armat cu altă valoare" "$ROLLBACK" "ROLLBACK TEHNIC 20261003c blocat" \
  "SET LOCAL gazpet.rollback_tehnic_20261003c = 'da';"
refuzat "rollback cu comutatorul Ofertare (20261003b)" "$ROLLBACK" "ROLLBACK TEHNIC 20261003c blocat" \
  "SET LOCAL gazpet.rollback_tehnic_20261003b = 'REDESCHIDE_BYPASS';"
# SET LOCAL într-o tranzacție ANTERIOARĂ a aceleiași sesiuni nu mai armează (a expirat la COMMIT).
ERR_EXP="$(mktemp)"
if "${PSQL[@]}" -d "$BAZA" -c "BEGIN" -c "$ARMARE" -c "COMMIT" -f "$ROLLBACK" >/dev/null 2>"$ERR_EXP"; then esec "rollback armat într-o tranzacție anterioară: trebuia REFUZAT"; fi
grep -qF "ROLLBACK TEHNIC 20261003c blocat" "$ERR_EXP" || { cat "$ERR_EXP" >&2; esec "rollback cu armare expirată: alt motiv"; }
rm -f "$ERR_EXP"; echo "   OK   rollback cu SET LOCAL expirat (tranzacție anterioară) → refuzat: blocat"; NEG_OK=$((NEG_OK + 1))
refuzat "S3 rollback armat peste un RPC corectat ulterior" "$ROLLBACK" "Precondiție rollback 20261003c: confirm_hr_autorizatie_rsvti nu e versiunea patch-ului" \
  "$INJECTEAZA_RPC" armat
refuzat "rollback armat peste un helper schimbat" "$ROLLBACK" "Precondiție rollback 20261003c: fn_poate_scrie_hr_autorizatii lipsește sau nu e versiunea patch-ului" \
  "CREATE OR REPLACE FUNCTION public.fn_poate_scrie_hr_autorizatii() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS \$fn\$ SELECT true \$fn\$;" armat
refuzat "rollback armat peste politica patch-ului relaxată" "$ROLLBACK" "Precondiție rollback 20261003c: jurnalul are 1 politici de scriere (0 = cea din patch)" \
  "ALTER POLICY hr_autorizatii_rsvti_confirmari_insert_autorizat ON public.hr_autorizatii_rsvti_confirmari WITH CHECK (true);" armat
refuzat "rollback armat peste o politică de scriere în plus" "$ROLLBACK" "Precondiție rollback 20261003c: jurnalul are 2 politici de scriere (1 = cea din patch)" \
  "CREATE POLICY adv_jurnal_insert_extra ON public.hr_autorizatii_rsvti_confirmari FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL));" armat
refuzat "S4 rollback armat cu o dependență nouă de helper" "$ROLLBACK" "other objects depend on it" \
  "CREATE TABLE public.adv_dep (id int); ALTER TABLE public.adv_dep ENABLE ROW LEVEL SECURITY; CREATE POLICY adv_dep_p ON public.adv_dep FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_poate_scrie_hr_autorizatii()));" armat
fara_urme "$SNAP_PATCH" "3a refuzurile pe starea patch"

echo "→ 3. rollback tehnic ARMAT (SET LOCAL în aceeași tranzacție)"
DEZ="$("${PSQL[@]}" -d "$BAZA" -At -c "BEGIN" -c "$ARMARE" -f "$ROLLBACK" -c "COMMIT" \
        -c "SELECT 'dezarmat=' || (coalesce(current_setting('gazpet.rollback_tehnic_20261003c', true), '') = '')::text")" \
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

# 5. Folosire greșită: armare cu SET de SESIUNE (nu SET LOCAL). Rollback-ul trece, dar la final dezarmează și
#    sesiunea (set_config(…, '', false)) — comutatorul nu rămâne armat pentru o rulare ulterioară. Apoi reaplicare.
SNAP_4="$(mktemp)"; schema_snapshot > "$SNAP_4"
echo "→ 5. rollback armat GREȘIT (SET de sesiune) → după rulare comutatorul e dezarmat; reaplicare"
DEZ="$("${PSQL[@]}" -d "$BAZA" -At -c "SET gazpet.rollback_tehnic_20261003c = 'REDESCHIDE_GAURA_RSVTI';" -f "$ROLLBACK" \
        -c "SELECT 'dezarmat=' || (coalesce(current_setting('gazpet.rollback_tehnic_20261003c', true), '') = '')::text")" \
  || esec "rollback-ul armat cu SET de sesiune a eșuat"
[ "$DEZ" = "dezarmat=true" ] || esec "după rollback, comutatorul setat la nivel de sesiune a rămas armat ($DEZ)"
echo "   OK   armare de sesiune: comutatorul e dezarmat după rulare (nu rămâne pentru o a doua rulare)"; NEG_OK=$((NEG_OK + 1))
aplica "$MIGRARE"
fara_urme "$SNAP_4" "5 rollback + reaplicare ⇒ aceeași schemă ca la pasul 4"
rm -f "$SNAP_4"

if [ "$OPRESTE" = 1 ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null && echo "→ server oprit"; fi
echo "PASS test_sec_rsvti: $TOTAL_OK aserțiuni OK + $NEG_OK verificări negative/fără urme OK (bază $BAZA @ 127.0.0.1:$PORT)"
