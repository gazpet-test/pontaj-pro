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
#   6. traseul EFECTIV de livrare (runda 5, verdict Copilot R4, bază auxiliară): scripts/livrare_migrare.sh +
#      scripts/livrare_validator.py — 6.0 validatorul (cazuri unitare + migrările PR-urilor paralele); 6.1–6.4 succes,
#      reluare, erori injectate (inclusiv la INSERT-ul înregistrării) + reluare; 6.5 fișierul fără runner; 6.6 control de
#      tranzacție / \i / :var / fișier lung ⇒ refuz ÎNAINTE de conexiune; 6.7 sha aprobat + TOCTOU; 6.8 lista albă de
#      argumente + ținta; 6.9 cele 3 stări (confirmare pierdută după COMMIT); 6.10 două procese concurente; 6.11 mutanți
#   6.12–6.16 (runda 6, verdict Copilot R5): lexic (CR, standard_conforming_strings/client_encoding din configurația
#      conexiunii, starea finală), izolare (default_transaction_isolation=repeatable read pe cluster), ținta (2 clustere,
#      aceeași bază, identități diferite; schimbarea țintei între execuție și reconciliere), clasificarea istoricului
#      (relevante/exacte/conflicte: 0/10/11/21/22), mutanți noi pe fiecare punct
#   6.17–6.20 (runda 7, verdict Copilot R6): COPY … FROM STDIN refuzat înainte de psql + control dinamic pe stare finală
#      (validator slăbit ⇒ tabela comisă); set_config/SET normalizate (formele citate/calificate, argument complet);
#      instanța autoritativă (replică fizică locală pg_basebackup -R, replay pus pe pauză ⇒ 22, niciodată 10); mutanți
#   6.21–6.23 (runda 8, verdict Copilot R7): identificatori/literali Unicode U&"…"/U&'…' (și UESCAPE) refuzați înainte de
#      psql + control dinamic direct pe PG (U&"set\005Fconfig" chiar schimbă setarea) + validator slăbit ⇒ atac aplicat;
#      PGSERVICE/PGSERVICEFILE/PGSYSCONFDIR/PGHOSTADDR/… moștenite ⇒ refuz, --service RETRAS (R9) ⇒ refuz; drept pe
#      pg_control_system() lipsă ⇒ NEPORNIT (12) fără relaxare
#   7. ceas fix (libfaketime, repornirea serverului) 2026-09-29 23:30 UTC: data omisă / NULL = 30.09
#
# Utilizare (din rădăcina repo-ului; ca root, comenzile de server trec pe utilizatorul postgres prin su):
#   bash scripts/test_sec_rsvti.sh             # ciclul complet
#   bash scripts/test_sec_rsvti.sh --opreste   # + oprește serverul la final
# Variabile opționale: PG_BIN=/usr/lib/postgresql/16/bin PGDATA_TEST=/tmp/pg_sec_rsvti_r7 PGPORT_TEST=5901 (+ clusterul B: …_b, port+1;
#   replica fizică a lui A: …_replica, port+2)
#   PGDB_TEST=sec_rsvti_test PGLOG_TEST=/tmp/pg_sec_rsvti.log FAKETIME_LIB=…/libfaketime.so.1
#   Doar pentru mutanți/discriminare: MIGRARE_FISIER=… ROLLBACK_FISIER=… LIVRARE_FISIER=… (fișiere alternative)
# Coduri de ieșire: 0 = PASS · 1 = migrare/test eșuat · 2 = mediu (PG indisponibil, gardă refuzată)
# ============================================================================
set -Eeuo pipefail

RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_sec_rsvti_r7}"
PORT="${PGPORT_TEST:-5901}"
# Runda 6: al doilea cluster (aceeași bază, altă identitate) pentru testele de țintă — port = PORT+1.
DATE_DIR_B="${DATE_DIR}_b"
PORT_B=$((PORT + 1))
# Runda 7: replica fizică a clusterului A (pg_basebackup -R) pentru instanța autoritativă — port = PORT+2.
DATE_DIR_R="${DATE_DIR}_replica"
PORT_R=$((PORT + 2))
BAZA="${PGDB_TEST:-sec_rsvti_test}"
JURNAL_PG="${PGLOG_TEST:-/tmp/pg_sec_rsvti_r7.log}"
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
# Runda 6: o rulare întreruptă în 6.13 ar lăsa izolarea implicită schimbată pe cluster — o readuc la valoarea standard.
"${PSQL[@]}" -d postgres -c "ALTER SYSTEM RESET default_transaction_isolation" -c "SELECT pg_reload_conf()" >/dev/null || mediu "ALTER SYSTEM RESET"
SIS_A="$("${PSQL[@]}" -d postgres -Atc 'SELECT system_identifier FROM pg_control_system()')"

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

# 6. Traseul EFECTIV de livrare (runda 5, verdict Copilot R4): scripts/livrare_migrare.sh, pe o bază auxiliară.
#    Gestionar unic = psql --single-transaction [lock + țintă + istoric + marcaj + COPIA aprobată + înregistrare].
echo "→ 6. traseul de livrare: scripts/livrare_migrare.sh (runda 5)"
# Coloanele reale din producție (information_schema, citit read-only 30.09).
REG_TABEL="CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);"
NUME_MIG="20261003c_sec_rsvti_poarta_jurnal"
CONN_AUX=(-h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA_AUX")
ERR_R="$(mktemp)"; OUT_R="$(mktemp)"
sha() { sha256sum "$1" | cut -d' ' -f1; }
SHA_MIG="$(sha "$MIGRARE")"
# PSQL_BIN de test: „santinela” înregistrează fiecare invocare (dovada că un refuz a venit ÎNAINTE de conexiune).
SANT_LOG="$VAR_DIR/santinela.log"
cat > "$VAR_DIR/psql_santinela" <<SH
#!/usr/bin/env bash
echo "\$*" >> "$SANT_LOG"
exec "$PG_BIN/psql" "\$@"
SH
chmod +x "$VAR_DIR/psql_santinela"
PSQL_T="$VAR_DIR/psql_santinela"
# Gate-ul permanent 0e: runnerul citește scripts/control_0e.sql de lângă el ⇒ copiat identic lângă runnerii mutanți.
cu_0e() { local d; d="$(dirname "$1")"; [ -f "$d/control_0e.sql" ] || cp "$RADACINA/scripts/control_0e.sql" "$d/control_0e.sql"; }
# livreaza <fișier> [versiune] [sha aprobat] [runner] [-- opțiuni în plus]: copiat sub numele real al migrării
livreaza() {
  local f="$1" v="${2:-20261003000000}" s="${3:-}" r="${4:-$LIVRARE}"; shift $(( $# < 4 ? $# : 4 ))
  [ "${1:-}" = -- ] && shift
  local nume="${NUME_T:-$NUME_MIG}"
  mkdir -p "$VAR_DIR/livrare"; [ "$f" = "$VAR_DIR/livrare/$nume.sql" ] || cp "$f" "$VAR_DIR/livrare/$nume.sql"
  [ -n "$s" ] || s="$(sha "$VAR_DIR/livrare/$nume.sql")"
  : > "$SANT_LOG"
  set +e
  cu_0e "$r"; PSQL_BIN="$PSQL_T" bash "$r" --migrare "$VAR_DIR/livrare/$nume.sql" --sha256 "$s" --versiune "$v" \
    --tinta-db "$BAZA_AUX" --tinta-sistem "$SIS_A" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres "$@" >"$OUT_R" 2>"$ERR_R"
  RC=$?; set -e
}
psql_aux() { set +e; "$PG_BIN/psql" -X -q "${CONN_AUX[@]}" "$@" >/dev/null 2>"$ERR_R"; RC=$?; set -e; }
inregistrata() { "${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name = '${1:-$NUME_MIG}'"; }
stare_patch() { "${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure"; }
MD5_PATCH="$(grep -m1 -oE "IS DISTINCT FROM '[0-9a-f]{32}'" <(sed -n '/^DO \$post\$$/,/^END \$post\$;$/p' "$MIGRARE") | grep -oE '[0-9a-f]{32}')"
aux_nou() { baza_noua "$BAZA_AUX"; "${PSQL[@]}" -d "$BAZA_AUX" -c "$REG_TABEL" >/dev/null; }
statements_egal() {  # $1 = fișierul care TREBUIE să fie în statements[1] (octet cu octet)
  "${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT statements[1] FROM supabase_migrations.schema_migrations WHERE name = '$NUME_MIG'" | cmp -s - <(cat "$1"; echo)
}
ok6() { echo "   OK   $*"; NEG_OK=$((NEG_OK + 1)); }
# Runda 6: pre-verificarea a rulat (o invocare psql, read-only), dar livrarea (--single-transaction) NU s-a trimis.
nu_s_a_livrat() {
  [ "$(wc -l < "$SANT_LOG")" = 1 ] && ! grep -q -- "--single-transaction" "$SANT_LOG" \
    || { cat "$SANT_LOG" >&2; esec "$1: livrarea a fost trimisă (trebuia oprită la pre-verificare)"; }
}
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
# $1 = eticheta, $2 = fragment așteptat, $3 = snapshot, $4 = înregistrări așteptate (implicit 0), $5 = cod așteptat (implicit 10)
esuat_fara_urme() {
  [ "$RC" = "${5:-10}" ] || { cat "$ERR_R" >&2; esec "$1: cod $RC, așteptat ${5:-10}"; }
  grep -qF -- "$2" "$ERR_R" || { cat "$ERR_R" >&2; esec "$1: a eșuat din alt motiv (lipsește „$2”)"; }
  [ "$(inregistrata)" = "${4:-0}" ] || esec "$1: înregistrări = $(inregistrata), așteptat ${4:-0}"
  fara_urme "$3" "$1 → cod ${5:-10}, definiții/politici/ACL neschimbate, înregistrări: ${4:-0}" "$BAZA_AUX"
}
# Refuz ÎNAINTE de conexiune: cod $2, fragment $3, clientul psql NU a fost pornit deloc.
refuz_preconex() {  # $1 = eticheta, $2 = cod, $3 = fragment, $4 = snapshot
  esuat_fara_urme "$1" "$3" "$4" 0 "$2"
  [ ! -s "$SANT_LOG" ] || esec "$1: psql a fost pornit ($(head -1 "$SANT_LOG")) — refuzul trebuia înainte de conexiune"
  ok6 "$1: refuz înainte de conexiune (psql nepornit)"
}

# 6.0 validatorul, pe cazuri unitare (fără BD): refuz = cod 1, acceptare = cod 0; orice alt cod ⇒ FAIL
VALIDATOR="${VALIDATOR_FISIER:-$RADACINA/scripts/livrare_validator.py}"
valideaza_caz() {  # $1 = așteptat (0 acceptat / 1 refuzat), $2 = SQL
  printf "%s\n-- garda (apel real):\nSELECT current_setting('gazpet.livrare_migrare', true);\n" "$2" > "$VAR_DIR/caz.sql"
  set +e; python3 "$VALIDATOR" "$VAR_DIR/caz.sql" >/dev/null 2>&1; local rc=$?; set -e
  [ "$rc" = "$1" ]
}
CAZURI_REFUZ=("END;" "end ;" "SELECT '--'; COMMIT;" "SELECT 1; commit ;" "COMMIT" "BEGIN;" "begin transaction;" "BEGIN ISOLATION LEVEL SERIALIZABLE;"
  "START TRANSACTION;" "ROLLBACK;" "ABORT;" "SAVEPOINT s;" "RELEASE SAVEPOINT s;" "RELEASE s;" "ROLLBACK TO SAVEPOINT s;"
  "PREPARE TRANSACTION 'x';" "COMMIT PREPARED 'x';" "ROLLBACK PREPARED 'x';" "/* c */ COMMIT;" "SELECT \$\$x\$\$; END;"
  "SELECT \"a;\"; COMMIT;" "SELECT E'\\\\'; COMMIT; --';" '\i alt_fisier.sql' '\ir alt.sql' '\c alta_baza' '\set ON_ERROR_STOP 0'
  '\! rm -rf /' "SELECT 1 \\g" "  \\include x.sql" "SELECT :var;" "SELECT :'var';" "SELECT 'neterminat" "SELECT \$t\$ neterminat"
  "/* neterminat" "CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END;"
  # runda 6 — lexic: CR termină comentariul „--” (ca PostgreSQL); literalii / parametrii lexicali; SET/RESET/set_config
  "SELECT 1; -- c"$'\r'"COMMIT;" "/* a */ -- x"$'\r'"END;" "SELECT 1; -- c"$'\r'"SELECT 2; -- d"$'\r'"ROLLBACK;"
  "SET standard_conforming_strings = off; SELECT '\\'; -- '; COMMIT; -- '" "SELECT '\\'; -- '; COMMIT; -- '"
  "SELECT 'a\\b';" "SELECT U&'\\0041';" "SET LOCAL standard_conforming_strings TO on;" "SELECT set_config('standard_conforming_strings', 'off', true);"
  "SET client_encoding = 'SQL_ASCII';" "SET NAMES 'LATIN1';" "-- escape_string_warning" "SELECT 'backslash_quote';"
  "DO \$\$ BEGIN PERFORM set_config('client_encoding', 'LATIN1', true); END \$\$;"
  "RESET ALL;" "RESET search_path;" "SET search_path = public;" "SET LOCAL search_path = pg_temp, public;" "SET SESSION search_path = public, pg_temp;"
  "SET SCHEMA 'x';" "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;" "SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ;"
  "SELECT set_config('search_path', 'x', true);" "SELECT set_config(v, 'x', true) FROM (SELECT 'search_path' AS v) s;"
  "SELECT pg_catalog.set_config('Search_Path', 'x', false);"
  # runda 7 — COPY (orice formă) și verificările de configurare (cele 3 exemple din verdictul R6 + variante)
  "COPY public.proba_livrare_copy(v) FROM STDIN;" "copy t from stdin;" "COPY t TO STDOUT;" "COPY t FROM PROGRAM 'id';"
  "COPY (SELECT 1) TO '/tmp/x';" "SELECT 1; COPY t FROM STDIN; SELECT 2;"
  "SELECT set_config('client_' || 'encoding', 'LATIN1', true);" "SET LOCAL \"SEARCH_PATH\" = public, pg_catalog;"
  "SELECT pg_catalog.\"set_config\"('search_path', 'public,pg_catalog', true);" "SELECT \"set_config\"('search_path', 'x', true);"
  "SELECT \"pg_catalog\".\"SET_CONFIG\"('search_path', 'x', true);" "SELECT set_config('gazpet.x' || '', 'y', true);"
  "SELECT set_config(E'search_path', 'x', true);" "SELECT set_config('search_path'::text, 'x', true);"
  "SELECT set_config('search_'"$'\n'"'path', 'x', true);" "SELECT set_config(\$s\$search_path\$s\$, 'x', true);" "SELECT set_config;"
  "SET LOCAL \"search_path\" = public, pg_temp;" "SET \"Search_Path\" TO public;" "SET LOCAL x.search_path = 'y';"
  "SET ROLE postgres;" "SET SESSION AUTHORIZATION postgres;" "SET TIME ZONE 'UTC';" "SET CONSTRAINTS ALL DEFERRED;" "SET LOCAL;"
  # runda 8 — escape-uri Unicode (probele din verdictul R7 + variante): orice U&"…"/U&'…'/UESCAPE la nivel superior
  "SELECT pg_catalog.U&\"set\\005Fconfig\"('search_path','public,pg_catalog',true);"
  "SELECT pg_catalog.U&\"set\\005Fconfig\"('client_' || 'encoding','LATIN1',true);"
  "SELECT pg_catalog.U&\"set!005Fconfig\" UESCAPE '!' ('search_path','public,pg_catalog',true);"
  "SELECT \"pg_catalog\".U&\"set\\005Fconfig\"('search_path','x',true);" "SELECT u&\"set\\005fconfig\"('search_path','x',true);"
  "SELECT U&\"set_config\"('gazpet.x','y',true);" "SELECT U& /* c */ \"x\";" "SELECT U&"$'\n'"\"x\";" "SELECT U&'x';"
  "SELECT set_config(U&'search\\005Fpath','x',true);" "SELECT set_config('gazpet.x', U&'y', true);" "SELECT 'x' UESCAPE '!';")
CAZURI_OK=("CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS \$f\$ BEGIN RETURN 1; END; \$f\$;"
  "DO \$\$ BEGIN PERFORM 1; END \$\$;" "SELECT 'COMMIT; END;';" "SELECT '--', 1; -- COMMIT;" "/* COMMIT; /* END; */ */ SELECT 1;"
  "SELECT \$a\$ \$b\$ COMMIT; \$b\$ \$a\$;" "SELECT E'\\\\'' ; COMMIT; ';" "SELECT 1::int, 'a'::text;" "PREPARE p AS SELECT 1;"
  "SELECT \"end\" FROM (SELECT 1 AS \"end\") s;" "COMMENT ON TABLE t IS 'END; COMMIT;';"
  # runda 6: forma verificată de search_path, alte SET LOCAL, set_config pe gazpet.*, E'…' cu backslash, CRLF,
  #          backslash într-un literal DIN corpul $$ (nu e nivel superior; PL/pgSQL rulează cu standard_conforming_strings=on)
  "SET LOCAL search_path = public, pg_temp;" "SET LOCAL lock_timeout = '5s';" "SELECT set_config('gazpet.x', 'y', true);"
  "SELECT E'a\\\\b', E'\\'';" "SELECT 1; -- COMMIT;"$'\r\n'"SELECT 2;" "DO \$\$ BEGIN PERFORM regexp_replace('a', '\\s', ''); END \$\$;"
  # runda 7: formele aprobate rămân acceptate (marcaje gazpet.* statice, apel calificat/citat cu nume static)
  "SELECT set_config('gazpet.livrare_x', 'y:' || txid_current(), true);" "SELECT pg_catalog.set_config('gazpet.x', 'v' || 'w', true);"
  "SELECT pg_catalog.\"set_config\"('gazpet.x', 'y', true);" "SELECT current_setting('gazpet.x', true);"
  "SET LOCAL lock_timeout TO '5s';" "SET LOCAL \"lock_timeout\" = '5s';" "UPDATE t SET copy_nr = 1;"
  "CREATE FUNCTION f() RETURNS void LANGUAGE sql SET search_path = public, pg_temp AS \$f\$ SELECT 1 \$f\$;"
  # runda 8: „&” obișnuit, identificatorul citat "U&", U& în corpul unei funcții (nu e nivel superior)
  "SELECT a & b FROM (SELECT 1 AS a, 3 AS b) s;" "SELECT \"U&\" FROM (SELECT 1 AS \"U&\") s;" "DO \$\$ BEGIN PERFORM U&'x'; END \$\$;")
for c in "${CAZURI_REFUZ[@]}"; do valideaza_caz 1 "$c" || esec "6.0 validator: trebuia REFUZAT: $c"; done
for c in "${CAZURI_OK[@]}"; do valideaza_caz 0 "$c" || esec "6.0 validator: trebuia ACCEPTAT: $c"; done
set +e; python3 "$VALIDATOR" "$MIGRARE" >/dev/null 2>&1; RCV=$?; set -e
[ "$RCV" = 0 ] || esec "6.0 validator: migrarea RSVTI (END-uri legitime în corpuri \$…\$) trebuia acceptată"
# Migrările legitime din PR-urile paralele (doar citire, dacă worktree-urile există lângă acesta) ⇒ ACCEPTATE
for f in "$RADACINA"/../wt-sec-trezorerie/supabase/migrations/20261003e_sec_trezorerie.sql \
         "$RADACINA"/../wt-sec-concediu/supabase/migrations/20261003d_sec_concediu_tokens.sql \
         "$RADACINA"/../wt-sec-ofertare/supabase/migrations/20261003b_sec_ofertare_porti_alege_inventar.sql \
         "$RADACINA"/../wt-j05garda/supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql; do
  [ -f "$f" ] || continue
  python3 "$VALIDATOR" "$f" >/dev/null 2>&1 || esec "6.0 validator: migrarea legitimă $(basename "$f") trebuia acceptată"
  ok6 "6.0 validator: $(basename "$f") (PR paralel) acceptată"
done
set +e; python3 "$VALIDATOR" "$VAR_DIR/nu_exista.sql" >/dev/null 2>&1; RCV=$?; set -e
[ "$RCV" != 0 ] || esec "6.0 validator: fișier inexistent trebuia refuzat (fail-closed)"
ok6 "6.0 validator: ${#CAZURI_REFUZ[@]} cazuri refuzate, ${#CAZURI_OK[@]} acceptate, migrarea RSVTI acceptată, eroare ⇒ refuz"
# 6.0g garda: trebuie să fie un APEL real current_setting('gazpet.livrare_migrare' …), nu comentariu / literal izolat
garda_caz() {  # $1 = așteptat, $2 = conținutul întreg
  printf '%s\n' "$2" > "$VAR_DIR/garda.sql"
  set +e; python3 "${VALIDATOR_G:-$VALIDATOR}" "$VAR_DIR/garda.sql" >/dev/null 2>&1; local rc=$?; set -e
  [ "$rc" = "$1" ]
}
GARDA_REFUZ=("-- current_setting('gazpet.livrare_migrare', true)"$'\n'"SELECT 1;"
  "/* SELECT current_setting('gazpet.livrare_migrare') */ SELECT 1;"
  "SELECT 'gazpet.livrare_migrare';"
  "DO \$\$ BEGIN -- current_setting('gazpet.livrare_migrare')"$'\n'"PERFORM 1; END \$\$;"
  "SELECT current_setting('gazpet.alt_marcaj', true); -- 'gazpet.livrare_migrare'")
GARDA_OK=("SELECT current_setting('gazpet.livrare_migrare', true);"
  "DO \$g\$ BEGIN IF current_setting('gazpet.livrare_migrare', true) IS NULL THEN RAISE EXCEPTION 'x'; END IF; END \$g\$;"
  "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN PERFORM pg_catalog.current_setting ( 'gazpet.livrare_migrare' , true ); END \$f\$;")
for c in "${GARDA_REFUZ[@]}"; do garda_caz 1 "$c" || esec "6.0g garda trebuia REFUZATĂ: $c"; done
for c in "${GARDA_OK[@]}"; do garda_caz 0 "$c" || esec "6.0g garda trebuia ACCEPTATĂ: $c"; done
ok6 "6.0g garda: ${#GARDA_REFUZ[@]} refuzate (comentariu, literal izolat, comentariu în corp, alt marcaj), ${#GARDA_OK[@]} acceptate (apel real, și în corp)"

# 6.1 succes: patch + O înregistrare (version, name, statements = fișierul întreg)
aux_nou; livreaza "$MIGRARE" 20261003000000
[ $RC = 0 ] || { cat "$ERR_R" >&2; esec "6.1 livrarea fără eroare a eșuat (cod $RC)"; }
grep -qF "APLICAT + ÎNREGISTRAT confirmat" "$OUT_R" || esec "6.1 lipsește starea APLICAT confirmat"
[ "$(stare_patch)" = "$MD5_PATCH" ] && [ "$(inregistrata)" = 1 ] || esec "6.1 patch neaplicat sau neînregistrat"
[ "$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT version FROM supabase_migrations.schema_migrations")" = 20261003000000 ] || esec "6.1 versiunea înregistrată"
statements_egal "$MIGRARE" || esec "6.1 statements[1] nu e fișierul migrării, octet cu octet"
ok6 "6.1 livrare: APLICAT confirmat (cod 0), patch + o înregistrare (version, name, statements = artefactul aprobat)"
# 6.2 reluare după succes (altă versiune) ⇒ NEAPLICAT confirmat, fără dublare
SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
livreaza "$MIGRARE" 20261003000001
esuat_fara_urme "6.2 reluare după succes (același nume, altă versiune)" "CONFLICT: istoricul are 1 rând(uri)" "$SNAP_E" 1 21
nu_s_a_livrat "6.2"
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
               ok6 "6.4 reluare după eroarea de înregistrare: APLICAT confirmat, exact o înregistrare" ;;
  esac
  rm -f "$SNAP_E"
done

# 6.5 fișierul rulat SINGUR, fără runner ⇒ garda de livrare (start) refuză, nimic comis
aux_nou; SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
START="Livrare 20261003c: garda de livrare (start)"
psql_aux -v ON_ERROR_STOP=1 -f "$MIGRARE";                      esuat_fara_urme "6.5 psql -f simplu (autocommit)" "$START" "$SNAP_E" 0 3
psql_aux -c "$(cat "$MIGRARE")";                                esuat_fara_urme "6.5 un singur query (psql -c, ca execute_sql)" "$START" "$SNAP_E" 0 1
psql_aux -v ON_ERROR_STOP=1 --single-transaction -f "$MIGRARE"; esuat_fara_urme "6.5 --single-transaction fără marcaj (fără înregistrare)" "$START" "$SNAP_E" 0 3
psql_aux -v ON_ERROR_STOP=1 -c "SELECT set_config('gazpet.livrare_migrare', '$NUME_MIG:' || txid_current(), false)" -f "$MIGRARE"
esuat_fara_urme "6.5 marcaj de SESIUNE dintr-o tranzacție anterioară + psql -f" "$START" "$SNAP_E" 0 3
psql_aux -v ON_ERROR_STOP=1 -c "SET gazpet.livrare_migrare = '$NUME_MIG'" -f "$MIGRARE"
esuat_fara_urme "6.5 marcaj de sesiune fără txid" "$START" "$SNAP_E" 0 3

# 6.6 control de tranzacție / meta-comenzi în fișier ⇒ validatorul refuză ÎNAINTE de conexiune (cod 3), stare inițială,
#     zero înregistrări — inclusiv END; (sinonim COMMIT), literal cu „--” urmat de COMMIT, fișier lung (fostul SIGPIPE), \i.
mutant_fisier() {  # $1 = linia inserată după prima funcție, $2 = ieșire
  L="$1" awk '{print} !d && /^\$fn\$;$/ {print ENVIRON["L"]; d=1}' "$MIGRARE" > "$2"
  [ "$(grep -cxF -- "$1" "$2")" = 1 ] || mediu "mutant: punctul de injecție lipsește"
}
i=0
for linie in "COMMIT;  -- MUTANT" "select 1; commit ;  -- MUTANT" "END;  -- MUTANT (sinonim COMMIT)" "SELECT '--'; COMMIT;" \
             '\i /tmp/alt_fisier.sql' 'ABORT;' 'SAVEPOINT s1;' 'RELEASE SAVEPOINT s1;' 'PREPARE TRANSACTION '"'"'x'"'"';' \
             'COMMIT PREPARED '"'"'x'"'"';' 'START TRANSACTION;' 'SELECT :var;' 'COPY public.t_copy FROM STDIN;' 'copy public.t_copy to stdout;' \
             "SELECT 1; -- c"$'\r'"COMMIT;  -- MUTANT CR" "SET standard_conforming_strings = off; SELECT '\\'; -- '; COMMIT; -- '" \
             "SELECT '\\'; -- '; COMMIT; -- '"; do
  i=$((i + 1)); mutant_fisier "$linie" "$VAR_DIR/mut_$i.sql"
  livreaza "$VAR_DIR/mut_$i.sql"; refuz_preconex "6.6 mutant «$linie»" 3 "REFUZ validator" "$SNAP_E"
done
# fișier lung: COMMIT; devreme + > 1 MB de comentarii după (reproducerea exit 141 din verdict)
mutant_fisier "COMMIT;  -- MUTANT (fișier lung)" "$VAR_DIR/mut_lung.sql"
for _ in $(seq 1 20000); do echo "-- umplutură ca fișierul să fie lung: 0123456789012345678901234567890123456789012345678901234567"; done >> "$VAR_DIR/mut_lung.sql"
livreaza "$VAR_DIR/mut_lung.sql"; refuz_preconex "6.6 mutant COMMIT; + fișier lung ($(du -k "$VAR_DIR/mut_lung.sql" | cut -f1) KB)" 3 "REFUZ validator" "$SNAP_E"

# 6.7 identitatea artefactului: sha greșit ⇒ refuz; --aprobare; sursa modificată DUPĂ pregătire, ÎNAINTE de psql
livreaza "$MIGRARE" 20261003000000 "$(printf '0%.0s' $(seq 1 64))"
refuz_preconex "6.7 sha256 aprobat ≠ artefact" 3 "≠ sha256 aprobat" "$SNAP_E"
cp "$MIGRARE" "$VAR_DIR/livrare/$NUME_MIG.sql"; echo "-- modificare după aprobare" >> "$VAR_DIR/livrare/$NUME_MIG.sql"
livreaza "$VAR_DIR/livrare/$NUME_MIG.sql" 20261003000000 "$SHA_MIG"
refuz_preconex "6.7 artefact modificat înainte de rulare (sha aprobat = originalul)" 3 "≠ sha256 aprobat" "$SNAP_E"
# TOCTOU: clientul psql (wrapper) modifică SURSA înainte de a se conecta ⇒ runnerul execută copia aprobată
cat > "$VAR_DIR/psql_toctou" <<SH
#!/usr/bin/env bash
[ -f "$VAR_DIR/toctou_facut" ] || { printf 'SELECT 1/0; -- INJECTAT TOCTOU\n' >> "$VAR_DIR/livrare/$NUME_MIG.sql"; touch "$VAR_DIR/toctou_facut"; }
exec "$PG_BIN/psql" "\$@"
SH
chmod +x "$VAR_DIR/psql_toctou"
toctou() {  # $1 = runner ⇒ 0 dacă s-a executat copia aprobată (patch + statements = originalul)
  aux_nou; rm -f "$VAR_DIR/toctou_facut"; cp "$MIGRARE" "$VAR_DIR/livrare/$NUME_MIG.sql"
  PSQL_T="$VAR_DIR/psql_toctou" livreaza "$VAR_DIR/livrare/$NUME_MIG.sql" 20261003000000 "$SHA_MIG" "$1"
  [ -f "$VAR_DIR/toctou_facut" ] && grep -q "INJECTAT TOCTOU" "$VAR_DIR/livrare/$NUME_MIG.sql" || mediu "6.7 TOCTOU: sursa nu a fost modificată"
  [ $RC = 0 ] && [ "$(stare_patch)" = "$MD5_PATCH" ] && [ "$(inregistrata)" = 1 ] && statements_egal "$MIGRARE"
}
toctou "$LIVRARE" || { cat "$ERR_R" >&2; esec "6.7 TOCTOU: nu s-a executat copia aprobată"; }
ok6 "6.7 TOCTOU: sursa modificată după pregătire ⇒ executată + înregistrată copia aprobată (statements == copia executată)"
aux_nou; printf '%s  %s.sql\n' "$SHA_MIG" "$NUME_MIG" > "$VAR_DIR/aprobare.sha256"
cp "$MIGRARE" "$VAR_DIR/livrare/$NUME_MIG.sql"; : > "$SANT_LOG"
set +e; PSQL_BIN="$PSQL_T" bash "$LIVRARE" --migrare "$VAR_DIR/livrare/$NUME_MIG.sql" --aprobare "$VAR_DIR/aprobare.sha256" --versiune 20261003000000 \
  --tinta-db "$BAZA_AUX" --tinta-sistem "$SIS_A" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >"$OUT_R" 2>"$ERR_R"; RC=$?; set -e
[ $RC = 0 ] && [ "$(inregistrata)" = 1 ] || { cat "$ERR_R" >&2; esec "6.7 --aprobare (format sha256sum)"; }
ok6 "6.7 --aprobare <fișier sha256sum>: APLICAT confirmat"

# 6.8 argumente: doar lista albă de conexiune; orice opțiune psql / variabilă periculoasă ⇒ refuz înainte de conexiune
aux_nou; SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
for extra in "-v ON_ERROR_STOP=0" "-f /tmp/x.sql" "-c SELECT_1" "--set ON_ERROR_STOP=0" "-d postgresql://postgres@127.0.0.1/postgres" "-- -v" "--variable x=y"; do
  # shellcheck disable=SC2086
  livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- $extra
  refuz_preconex "6.8 opțiune nepermisă «$extra»" 2 "opțiune nepermisă" "$SNAP_E"
done
livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- --tinta-host "127.0.0.1 options=-c"
refuz_preconex "6.8 --tinta-host cu conninfo injectat" 2 "--tinta-host OBLIGATORIU" "$SNAP_E"
for v in "PGPASSWORD=x" "PGOPTIONS=-c default_transaction_read_only=on" "PGDATABASE=postgres" "PSQLRC=/tmp/x"; do
  export "${v%%=*}=${v#*=}"; livreaza "$MIGRARE"; unset "${v%%=*}"
  refuz_preconex "6.8 variabila ${v%%=*} setată" 2 "variabila ${v%%=*}" "$SNAP_E"
done
livreaza "$MIGRARE" 2026100300; refuz_preconex "6.8 versiune invalidă" 2 "--versiune" "$SNAP_E"
livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- --tinta-sistem ""
refuz_preconex "6.8 --tinta-sistem lipsă (obligatoriu)" 2 "--tinta-sistem OBLIGATORIU" "$SNAP_E"
# runda 7: endpointul de scriere (host + port) e parte din aprobare ⇒ obligatoriu; PGHOSTADDR ar redirecționa pe ascuns
livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- --tinta-host ""
refuz_preconex "6.8 --tinta-host lipsă (obligatoriu)" 2 "--tinta-host OBLIGATORIU" "$SNAP_E"
livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- --tinta-port ""
refuz_preconex "6.8 --tinta-port lipsă (obligatoriu)" 2 "--tinta-port OBLIGATORIU" "$SNAP_E"
export PGHOSTADDR=127.0.0.1; livreaza "$MIGRARE"; unset PGHOSTADDR
refuz_preconex "6.8 variabila PGHOSTADDR setată" 2 "variabila PGHOSTADDR" "$SNAP_E"
# ținta: system_identifier greșit ⇒ pre-verificarea refuză (22), livrarea nu se trimite
livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- --tinta-sistem 1
esuat_fara_urme "6.8 ținta: system_identifier ≠ cel aprobat" "ȚINTĂ NECONFIRMATĂ la pre-verificare" "$SNAP_E" 0 22
nu_s_a_livrat "6.8 ținta greșită"
SIS="$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT system_identifier FROM pg_control_system()")"
livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- --tinta-sistem "$SIS"
[ $RC = 0 ] && [ "$(inregistrata)" = 1 ] || { cat "$ERR_R" >&2; esec "6.8 ținta corectă (system_identifier)"; }
ok6 "6.8 ținta confirmată (current_database + system_identifier) ⇒ APLICAT"
rm -f "$SNAP_E"

# 6.9 cele 3 stări ale rezultatului (client care pierde confirmarea în jurul COMMIT-ului)
cat > "$VAR_DIR/psql_pierdut" <<SH
#!/usr/bin/env bash
# Invocarea 0 = pre-verificarea (reală); invocarea 1 = livrarea:
# MOD=dupa_commit: livrarea rulează REAL, apoi raportează conexiune pierdută (2);
# MOD=inainte:     livrarea nu ajunge la server, raportează 2;
# MOD=tot:         ca dupa_commit, iar și reconcilierea pierde conexiunea (2).
N="\$(cat "$VAR_DIR/pierdut_n" 2>/dev/null || echo 0)"; echo \$((N + 1)) > "$VAR_DIR/pierdut_n"
if [ "\$N" = 1 ]; then
  [ "\$MOD" = inainte ] || "$PG_BIN/psql" "\$@" >/dev/null 2>&1
  echo "psql: server closed the connection unexpectedly (simulat)" >&2; exit 2
fi
[ "\$MOD" = tot ] && [ "\$N" -ge 2 ] && { echo "psql: connection lost (simulat)" >&2; exit 2; }
exec "$PG_BIN/psql" "\$@"
SH
chmod +x "$VAR_DIR/psql_pierdut"
pierdut() { rm -f "$VAR_DIR/pierdut_n"; export MOD="$1"; PSQL_T="$VAR_DIR/psql_pierdut" livreaza "$MIGRARE" "${2:-20261003000000}"; }
aux_nou; pierdut dupa_commit
[ $RC = 0 ] && grep -qF "APLICAT + ÎNREGISTRAT confirmat" "$OUT_R" && grep -qF "nu exista la pre-verificare" "$ERR_R" \
  && [ "$(inregistrata)" = 1 ] && [ "$(stare_patch)" = "$MD5_PATCH" ] || { cat "$ERR_R" >&2; esec "6.9 COMMIT reușit + confirmare pierdută ⇒ trebuia APLICAT (reconciliat)"; }
ok6 "6.9 COMMIT reușit, confirmarea pierdută spre client ⇒ reconcilierea: APLICAT confirmat (nu „nimic comis”)"
aux_nou; SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"; pierdut inainte
esuat_fara_urme "6.9 conexiune pierdută înainte de server ⇒ NEAPLICAT confirmat (reconciliat)" "NEAPLICAT confirmat" "$SNAP_E"
pierdut tot
[ $RC = 20 ] && grep -qF "NECUNOSCUT" "$ERR_R" && ! grep -qF "NEAPLICAT" "$ERR_R" && [ "$(inregistrata)" = 1 ] \
  || { cat "$ERR_R" >&2; esec "6.9 COMMIT reușit + reconcilierea imposibilă ⇒ trebuia NECUNOSCUT (20)"; }
livreaza "$MIGRARE" 20261003000009
[ $RC = 21 ] && grep -qF "CONFLICT" "$ERR_R" && [ "$(inregistrata)" = 1 ] || { cat "$ERR_R" >&2; esec "6.9 reluare după NECUNOSCUT"; }
nu_s_a_livrat "6.9 reluare după NECUNOSCUT"
ok6 "6.9 COMMIT reușit + reconciliere imposibilă ⇒ NECUNOSCUT (20), nu „neaplicat”; o reluare cu altă versiune ⇒ CONFLICT (21), fără livrare"
rm -f "$SNAP_E"

# 6.10 serializare: două procese REALE ale runnerului, același nume, versiuni diferite ⇒ exact un succes, o înregistrare
NUME_C="20261003z_test_concurenta"
cat > "$VAR_DIR/concurenta.sql" <<SQL
DO \$s\$ BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '$NUME_C:' || txid_current() THEN RAISE EXCEPTION 'garda de livrare'; END IF;
END \$s\$;
INSERT INTO public.t_concurenta VALUES (txid_current());
SELECT pg_sleep(2);
SQL
concurenta() {  # $1 = runner ⇒ 0 dacă: exact un cod 0, celălalt 21 CONFLICT, o înregistrare, un rând
  aux_nou; "${PSQL[@]}" -d "$BAZA_AUX" -c "CREATE TABLE public.t_concurenta (x bigint)" >/dev/null
  local s; s="$(sha "$VAR_DIR/concurenta.sql")"; mkdir -p "$VAR_DIR/c1" "$VAR_DIR/c2"
  cp "$VAR_DIR/concurenta.sql" "$VAR_DIR/c1/$NUME_C.sql"; cp "$VAR_DIR/concurenta.sql" "$VAR_DIR/c2/$NUME_C.sql"
  local a=(--sha256 "$s" --tinta-db "$BAZA_AUX" --tinta-sistem "$SIS_A" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres)
  cu_0e "$1"; PSQL_BIN="$PG_BIN/psql" bash "$1" --migrare "$VAR_DIR/c1/$NUME_C.sql" --versiune 20261003100001 "${a[@]}" >/dev/null 2>"$VAR_DIR/c1.err" & local p1=$!
  cu_0e "$1"; PSQL_BIN="$PG_BIN/psql" bash "$1" --migrare "$VAR_DIR/c2/$NUME_C.sql" --versiune 20261003100002 "${a[@]}" >/dev/null 2>"$VAR_DIR/c2.err" & local p2=$!
  set +e; wait $p1; local r1=$?; wait $p2; local r2=$?; set -e
  local rows; rows="$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT count(*) FROM public.t_concurenta")"
  local reg; reg="$(inregistrata "$NUME_C")"
  echo "      (concurență: coduri $r1/$r2, înregistrări $reg, rânduri $rows)"
  [ "$reg" = 1 ] && [ "$rows" = 1 ] || return 1
  { [ $r1 = 0 ] && [ $r2 = 21 ] && grep -qF "CONFLICT" "$VAR_DIR/c2.err"; } \
    || { [ $r2 = 0 ] && [ $r1 = 21 ] && grep -qF "CONFLICT" "$VAR_DIR/c1.err"; }
}
concurenta "$LIVRARE" || esec "6.10 două livrări concurente: nu exact una reușită"
ok6 "6.10 două procese concurente (același nume, versiuni diferite): exact unul APLICAT, celălalt CONFLICT (21) fără efecte, o înregistrare"
# versiune deja folosită (sub alt nume) ⇒ refuz, fără urme
V_C="$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "UPDATE supabase_migrations.schema_migrations SET name = 'alt_nume' WHERE name = '$NUME_C' RETURNING version")"
SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
NUME_T="$NUME_C" livreaza "$VAR_DIR/concurenta.sql" "$V_C"
[ $RC = 21 ] && grep -qF "CONFLICT" "$ERR_R" && [ "$(inregistrata "$NUME_C")" = 0 ] || { cat "$ERR_R" >&2; esec "6.10 versiune refolosită"; }
nu_s_a_livrat "6.10 versiune refolosită"
fara_urme "$SNAP_E" "6.10 versiune deja folosită (alt nume) ⇒ CONFLICT (21), fără livrare, fără urme" "$BAZA_AUX"; rm -f "$SNAP_E"

# 6.11 MUTANȚI pe runner/validator: fiecare TREBUIE prins de testele de mai sus
MUT="$VAR_DIR/mutanti"; mkdir -p "$MUT"
mutant_runner() {  # $1 = nume, $2 = expresie sed ⇒ $MUT/$1/livrare_migrare.sh (+ validatorul, eventual mutat)
  mkdir -p "$MUT/$1"; cp "$VALIDATOR" "$MUT/$1/livrare_validator.py"
  sed "$2" "$LIVRARE" > "$MUT/$1/livrare_migrare.sh"
  cmp -s "$LIVRARE" "$MUT/$1/livrare_migrare.sh" && mediu "mutantul $1 nu a schimbat nimic"; true
}
mutant_runner fara_lock '0,/^SELECT pg_advisory_xact_lock(\$CHEIE);$/s//SELECT 1;/'
if concurenta "$MUT/fara_lock/livrare_migrare.sh"; then esec "6.11 mutant fără advisory lock: NEPRINS"; fi
ok6 "6.11 mutant fără pg_advisory_xact_lock ⇒ prins (dublă livrare concurentă)"
mutant_runner fara_sha 's/^\[ "\$SHA_COPIE" = "\$SHA" \] || refuz 3/true || refuz 3/'
livreaza "$MIGRARE" 20261003000000 "$(printf '0%.0s' $(seq 1 64))" "$MUT/fara_sha/livrare_migrare.sh"
[ $RC != 3 ] || esec "6.11 mutant fără comparația sha: NEPRINS"
ok6 "6.11 mutant fără comparația sha256 ⇒ prins (sha greșit nu mai e refuzat, cod $RC)"
mutant_runner sursa_nu_copia 's/-f "\$COPIE" -f "\$DIR\/3_inreg.sql"/-f "$MIG" -f "$DIR\/3_inreg.sql"/'
if toctou "$MUT/sursa_nu_copia/livrare_migrare.sh"; then esec "6.11 mutant care execută sursa (nu copia): NEPRINS"; fi
ok6 "6.11 mutant care execută sursa în loc de copie ⇒ prins (TOCTOU)"
mutant_runner fara_validator 's/^VAL_OUT="\$(python3 .*$/VAL_OUT=mutant/'
aux_nou; SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
livreaza "$VAR_DIR/mut_3.sql" 20261003000000 "" "$MUT/fara_validator/livrare_migrare.sh"
[ $RC != 3 ] || esec "6.11 mutant fără validator: NEPRINS"
ok6 "6.11 mutant fără validator ⇒ prins (END; nu mai e refuzat înainte de conexiune, cod $RC)"
mutant_runner argumente_libere 's/^    \*) refuz 2 "opțiune nepermisă.*$/    *) break ;;/'
livreaza "$MIGRARE" 20261003000000 "" "$MUT/argumente_libere/livrare_migrare.sh" -- -v ON_ERROR_STOP=0
{ [ $RC = 2 ] && grep -qF "opțiune nepermisă" "$ERR_R"; } && esec "6.11 mutant cu argumente libere: NEPRINS"
ok6 "6.11 mutant fără lista albă de argumente ⇒ prins"
# validator mutat: END scos din lista interzisă / tratarea literalilor stricată (sed confundă '--' cu comentariu)
mkdir -p "$MUT/v_end" "$MUT/v_lit"
sed 's/"COMMIT", "END", /"COMMIT", /' "$VALIDATOR" > "$MUT/v_end/v.py"
sed "s/if c in \"'\\\\\"\":/if False:/" "$VALIDATOR" > "$MUT/v_lit/v.py"
cmp -s "$VALIDATOR" "$MUT/v_end/v.py" && mediu "mutant v_end identic"; cmp -s "$VALIDATOR" "$MUT/v_lit/v.py" && mediu "mutant v_lit identic"
for m in v_end v_lit; do
  prins=0
  for c in "${CAZURI_REFUZ[@]}"; do VALIDATOR="$MUT/$m/v.py" valideaza_caz 1 "$c" || { prins=1; break; }; done
  for c in "${CAZURI_OK[@]}"; do VALIDATOR="$MUT/$m/v.py" valideaza_caz 0 "$c" || { prins=1; break; }; done
  [ $prins = 1 ] || esec "6.11 mutant de validator $m: NEPRINS"
  ok6 "6.11 mutant de validator $m ⇒ prins de cazurile 6.0"
done
# ============================================================================
# 6.12–6.16 — RUNDA 6 (verdict Copilot R5, docs/LIVRARE_MIGRARE_VERDICT_COPILOT_R5.md)
# ============================================================================
rulare() {  # $1 = runner, $2 = fișier (copiat ca $NUME_T/$NUME_MIG), $3 = versiune, [$4… = opțiuni] ⇒ RC, OUT_R, ERR_R
  local r="$1" f="$2" v="$3"; shift 3
  NUME_T="${NUME_T:-}" livreaza "$f" "$v" "" "$r" -- "$@"
}
exista() { "${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT to_regclass('$1') IS NOT NULL"; }
garda_sql() {  # $1 = numele migrării ⇒ garda de start (apel real, legat de txid)
  printf "DO \$g\$ BEGIN\n  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '%s:' || txid_current() THEN RAISE EXCEPTION 'garda de livrare'; END IF;\nEND \$g\$;\n" "$1"
}
# Mutanți de runner din runda 6 (python: înlocuire exactă, verificată)
mutant_py() {  # $1 = nume, $2 = text căutat, $3 = înlocuire (o singură apariție) ⇒ $MUT/$1/livrare_migrare.sh
  mkdir -p "$MUT/$1"; cp "$VALIDATOR" "$MUT/$1/livrare_validator.py"
  A="$2" B="$3" python3 - "$LIVRARE" "$MUT/$1/livrare_migrare.sh" <<'PY' || mediu "mutantul $1: textul căutat nu apare exact o dată"
import os, sys
s = open(sys.argv[1]).read(); a, b = os.environ["A"], os.environ["B"]
assert s.count(a) == 1, s.count(a)
open(sys.argv[2], "w").write(s.replace(a, b))
PY
}

# ---- 6.12 LEXIC: standard_conforming_strings / client_encoding din configurația conexiunii; starea finală ----------
echo "→ 6.12 lexic: setări lexicale venite din configurația conexiunii (ALTER DATABASE … SET), starea finală"
conexiune_ostila() {  # baza auxiliară cu setări „ostile” la nivel de bază (se aplică la orice conexiune nouă)
  "${PSQL[@]}" -d postgres -c "ALTER DATABASE \"$BAZA_AUX\" SET standard_conforming_strings = off" \
    -c "ALTER DATABASE \"$BAZA_AUX\" SET client_encoding = 'LATIN1'" \
    -c "ALTER DATABASE \"$BAZA_AUX\" SET default_transaction_isolation = 'repeatable read'" >/dev/null
  [ "$(env -u PGCLIENTENCODING "$PG_BIN/psql" -X -At -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA_AUX" \
      -c "SELECT current_setting('standard_conforming_strings') || '|' || current_setting('client_encoding') || '|' || current_setting('transaction_isolation')")" \
    = "off|LATIN1|repeatable read" ] || mediu "6.12: setările ostile nu s-au aplicat conexiunii"
}
aux_nou; conexiune_ostila
SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
# a) probele din verdict: cu SET în fișier și FĂRĂ SET (standard_conforming_strings=off vine din conexiune) ⇒ refuz
#    ÎNAINTE de conexiune (cod 3), iar starea finală e cea inițială
for linie in "SET standard_conforming_strings = off; SELECT '\\'; -- '; COMMIT; -- '" "SELECT '\\'; -- '; COMMIT; -- '" "SELECT 1; -- c"$'\r'"COMMIT;"; do
  { garda_sql "$NUME_MIG"; echo "CREATE TABLE public.t_atac (x int);"; printf '%s\n' "$linie"; echo "SELECT 1/0;"; } > "$VAR_DIR/atac.sql"
  livreaza "$VAR_DIR/atac.sql"; refuz_preconex "6.12 probă «$(printf '%s' "$linie" | tr '\r' '~')» (conexiune cu scs=off)" 3 "REFUZ validator" "$SNAP_E"
  [ "$(exista public.t_atac)" = f ] || esec "6.12 starea finală: t_atac există"
done
# b) sonda: ce vede CHIAR migrarea în tranzacția runnerului, pe conexiunea ostilă (nume dinamice: validatorul
#    refuză orice mențiune literală a parametrilor lexicali — de aceea concatenare)
NUME_S="20261003y_test_sesiune"
{ garda_sql "$NUME_S"
  echo "CREATE TABLE public.t_sesiune AS SELECT current_setting('standard_' || 'conforming_strings') AS scs,"
  echo "  current_setting('client_' || 'encoding') AS ce, current_setting('transaction_isolation') AS iso, E'a\\\\b' AS lit_e, 'x''y' AS lit;"
} > "$VAR_DIR/sonda.sql"
NUME_T="$NUME_S" livreaza "$VAR_DIR/sonda.sql" 20261003200000
[ $RC = 0 ] || { cat "$ERR_R" >&2; esec "6.12 sonda: livrarea a eșuat (cod $RC)"; }
SONDA="$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT scs || '|' || ce || '|' || iso || '|' || lit_e || '|' || lit FROM public.t_sesiune")"
[ "$SONDA" = 'on|UTF8|read committed|a\b|x'"'"'y' ] || esec "6.12 sonda: sesiunea migrării = '$SONDA' (așteptat on|UTF8|read committed|a\\b|x'y)"
ok6 "6.12 conexiune cu scs=off, client_encoding=LATIN1, izolare RR (ALTER DATABASE): migrarea rulează cu on|UTF8|read committed — prologul le forțează"
# c) migrarea reală RSVTI pe conexiunea ostilă ⇒ APLICAT, statements = artefactul octet cu octet
aux_nou; conexiune_ostila; livreaza "$MIGRARE" 20261003000000
[ $RC = 0 ] && [ "$(stare_patch)" = "$MD5_PATCH" ] && [ "$(inregistrata)" = 1 ] && statements_egal "$MIGRARE" \
  || { cat "$ERR_R" >&2; esec "6.12 migrarea RSVTI pe conexiunea ostilă"; }
ok6 "6.12 migrarea RSVTI pe conexiunea ostilă: APLICAT, patch instalat, statements == artefact (UTF-8 intact)"
# d) STAREA FINALĂ, cu validatorul SLĂBIT (fără regula backslash): runnerul real forțează scs=on ⇒ COMMIT-ul rămâne în
#    comentariu, 1/0 anulează tot; runnerul fără prolog scs ⇒ COMMIT executat, t_atac rămâne (mutant prins pe stare)
mkdir -p "$MUT/v_bslash_r"; A="if c == \"'\" and strict:" python3 - "$VALIDATOR" "$MUT/v_bslash_r/v.py" <<'PY'
import os, sys
s = open(sys.argv[1]).read(); a = os.environ["A"]; assert s.count(a) == 1
open(sys.argv[2], "w").write(s.replace(a, "if False:"))
PY
{ garda_sql "$NUME_MIG"; echo "CREATE TABLE public.t_atac (x int);"; echo "SELECT '\\'; -- '; COMMIT; -- '"; echo "SELECT 1/0;"; } > "$VAR_DIR/atac_d.sql"
python3 "$MUT/v_bslash_r/v.py" "$VAR_DIR/atac_d.sql" >/dev/null 2>&1 || mediu "6.12 d: validatorul slăbit trebuia să accepte proba"
stare_atac() {  # $1 = runner ⇒ ecou „cod|t_atac există”
  aux_nou; conexiune_ostila; livreaza "$VAR_DIR/atac_d.sql" 20261003000000 "" "$1"; echo "$RC|$(exista public.t_atac)"
}
mkdir -p "$MUT/real_vslab"; cp "$LIVRARE" "$MUT/real_vslab/livrare_migrare.sh"; cp "$MUT/v_bslash_r/v.py" "$MUT/real_vslab/livrare_validator.py"
ST="$(stare_atac "$MUT/real_vslab/livrare_migrare.sh")"
[ "$ST" = "10|f" ] || { cat "$ERR_R" >&2; esec "6.12 d: runnerul real (validator slăbit), conexiune scs=off: '$ST', așteptat 10|f"; }
ok6 "6.12 d: validator slăbit + conexiune scs=off ⇒ runnerul real: NEAPLICAT (10), t_atac absent — prologul aliniază serverul cu validatorul"
mutant_py fara_scs "SET LOCAL standard_conforming_strings = on;
" ""
A="  IF current_setting('standard_conforming_strings') IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Livrare \$NUME: standard_conforming_strings nu e on'; END IF;
" python3 - "$MUT/fara_scs/livrare_migrare.sh" <<'PY'
import os, sys
s = open(sys.argv[1]).read(); a = os.environ["A"]; assert s.count(a) == 1, s.count(a)
open(sys.argv[1], "w").write(s.replace(a, ""))
PY
cp "$MUT/v_bslash_r/v.py" "$MUT/fara_scs/livrare_validator.py"
ST="$(stare_atac "$MUT/fara_scs/livrare_migrare.sh")"
[ "${ST#*|}" = t ] || esec "6.12 d: mutantul fără prolog scs NU a fost prins pe starea finală ('$ST')"
ok6 "6.12 d: mutant fără SET LOCAL standard_conforming_strings ⇒ prins pe STAREA FINALĂ (t_atac comis, cod ${ST%|*})"
rm -f "$SNAP_E"

# ---- 6.13 IZOLARE: default_transaction_isolation = repeatable read pe TOT clusterul ---------------------------------
echo "→ 6.13 izolare: default_transaction_isolation = repeatable read (ALTER SYSTEM)"
"${PSQL[@]}" -d postgres -c "ALTER SYSTEM SET default_transaction_isolation = 'repeatable read'" -c "SELECT pg_reload_conf()" >/dev/null
for _ in $(seq 1 50); do [ "$("${PSQL[@]}" -d postgres -Atc 'SHOW default_transaction_isolation')" = "repeatable read" ] && break; sleep 0.1; done
[ "$("${PSQL[@]}" -d postgres -Atc 'SHOW default_transaction_isolation')" = "repeatable read" ] || mediu "6.13: izolarea implicită nu s-a schimbat"
POARTA="$VAR_DIR/poarta"
cat > "$VAR_DIR/psql_poarta" <<SH
#!/usr/bin/env bash
# invocarea 1 (livrarea) așteaptă fișierul go ⇒ pre-verificarea s-a terminat ÎNAINTE ca cealaltă livrare să ia lock-ul
N="\$(cat "$POARTA/n" 2>/dev/null || echo 0)"; echo \$((N + 1)) > "$POARTA/n"
if [ "\$N" = 1 ]; then for _ in \$(seq 1 300); do [ -f "$POARTA/go" ] && break; sleep 0.1; done; fi
exec "$PG_BIN/psql" "\$@"
SH
chmod +x "$VAR_DIR/psql_poarta"
asteapta() {  # $1 = descriere, $2 = comanda-condiție (max 15 s)
  for _ in $(seq 1 150); do eval "$2" && return 0; sleep 0.1; done; mediu "6.13: timeout la „$1”"
}
in_somn() { [ "$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(2)%' AND state = 'active'")" = 1 ]; }
C_ARGS() { echo --sha256 "$(sha "$VAR_DIR/concurenta.sql")" --tinta-db "$BAZA_AUX" --tinta-sistem "$SIS_A" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres; }
# T1: B face pre-verificarea (istoric gol), apoi A ia lock-ul și doarme; B intră în tranzacție și AȘTEAPTĂ lock-ul.
#     După COMMIT-ul lui A, istoricul lui B TREBUIE să vadă înregistrarea (snapshot nou) ⇒ B refuză: exact una.
izolare_principala() {  # $1 = runner ⇒ 0 dacă A=0, B=21, o înregistrare, un rând
  aux_nou; "${PSQL[@]}" -d "$BAZA_AUX" -c "CREATE TABLE public.t_concurenta (x bigint)" >/dev/null
  rm -rf "$POARTA"; mkdir -p "$POARTA" "$VAR_DIR/c1" "$VAR_DIR/c2"
  cp "$VAR_DIR/concurenta.sql" "$VAR_DIR/c1/$NUME_C.sql"; cp "$VAR_DIR/concurenta.sql" "$VAR_DIR/c2/$NUME_C.sql"
  # shellcheck disable=SC2046
  cu_0e "$1"; PSQL_BIN="$VAR_DIR/psql_poarta" bash "$1" --migrare "$VAR_DIR/c2/$NUME_C.sql" --versiune 20261003100002 $(C_ARGS) >/dev/null 2>"$VAR_DIR/c2.err" & local pb=$!
  asteapta "B a terminat pre-verificarea" '[ "$(cat "$POARTA/n" 2>/dev/null)" = 2 ]'
  # shellcheck disable=SC2046
  cu_0e "$1"; PSQL_BIN="$PG_BIN/psql" bash "$1" --migrare "$VAR_DIR/c1/$NUME_C.sql" --versiune 20261003100001 $(C_ARGS) >/dev/null 2>"$VAR_DIR/c1.err" & local pa=$!
  asteapta "A ține lock-ul (pg_sleep)" in_somn
  touch "$POARTA/go"
  set +e; wait $pa; local ra=$?; wait $pb; local rb=$?; set -e
  local reg rows; reg="$(inregistrata "$NUME_C")"; rows="$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT count(*) FROM public.t_concurenta")"
  echo "      (izolare RR, livrare: A=$ra B=$rb, înregistrări $reg, rânduri $rows)"
  [ "$ra" = 0 ] && [ "$rb" = 21 ] && [ "$reg" = 1 ] && [ "$rows" = 1 ] && grep -qF "CONFLICT" "$VAR_DIR/c2.err"
}
# T2: A ține lock-ul; B (același artefact, ACEEAȘI versiune) pornește acum ⇒ pre-verificarea lui B așteaptă lock-ul și,
#     după COMMIT, TREBUIE să vadă perechea exactă ⇒ 11 „deja înregistrată … nu s-a reaplicat”.
izolare_reconciliere() {  # $1 = runner ⇒ 0 dacă A=0, B=11, o înregistrare, un rând
  aux_nou; "${PSQL[@]}" -d "$BAZA_AUX" -c "CREATE TABLE public.t_concurenta (x bigint)" >/dev/null
  mkdir -p "$VAR_DIR/c1" "$VAR_DIR/c2"
  cp "$VAR_DIR/concurenta.sql" "$VAR_DIR/c1/$NUME_C.sql"; cp "$VAR_DIR/concurenta.sql" "$VAR_DIR/c2/$NUME_C.sql"
  # shellcheck disable=SC2046
  cu_0e "$1"; PSQL_BIN="$PG_BIN/psql" bash "$1" --migrare "$VAR_DIR/c1/$NUME_C.sql" --versiune 20261003100001 $(C_ARGS) >/dev/null 2>"$VAR_DIR/c1.err" & local pa=$!
  asteapta "A ține lock-ul (pg_sleep)" in_somn
  set +e
  # shellcheck disable=SC2046
  cu_0e "$1"; PSQL_BIN="$PG_BIN/psql" bash "$1" --migrare "$VAR_DIR/c2/$NUME_C.sql" --versiune 20261003100001 $(C_ARGS) >/dev/null 2>"$VAR_DIR/c2.err"; local rb=$?
  wait $pa; local ra=$?; set -e
  local reg rows; reg="$(inregistrata "$NUME_C")"; rows="$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT count(*) FROM public.t_concurenta")"
  echo "      (izolare RR, reconciliere: A=$ra B=$rb, înregistrări $reg, rânduri $rows)"
  [ "$ra" = 0 ] && [ "$rb" = 11 ] && [ "$reg" = 1 ] && [ "$rows" = 1 ] \
    && grep -qF "e deja înregistrată cu artefactul aprobat" "$VAR_DIR/c2.err" && grep -qF "nu s-a reaplicat" "$VAR_DIR/c2.err"
}
izolare_principala "$LIVRARE" || { cat "$VAR_DIR/c1.err" "$VAR_DIR/c2.err" >&2; esec "6.13 T1: livrarea care a așteptat lock-ul nu a văzut înregistrarea (RR)"; }
ok6 "6.13 T1 (RR pe cluster): livrarea care așteaptă lock-ul vede COMMIT-ul precedent ⇒ exact una aplicată, cealaltă CONFLICT, fără dublare"
izolare_reconciliere "$LIVRARE" || { cat "$VAR_DIR/c1.err" "$VAR_DIR/c2.err" >&2; esec "6.13 T2: reconcilierea pornită sub lock nu a clasificat corect"; }
ok6 "6.13 T2 (RR pe cluster): reconcilierea pornită cât livrarea ține lock-ul ⇒ după COMMIT vede înregistrarea: 11 „deja înregistrată … nu s-a reaplicat”"
concurenta "$LIVRARE" || esec "6.13 două procese concurente sub RR: nu exact una reușită"
ok6 "6.13 două procese concurente sub RR (pornite simultan): exact unul APLICAT, celălalt CONFLICT"
# mutanți de izolare (prinși DOAR pe clusterul RR)
mutant_py fara_rc_princ "SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
" ""
A="  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION 'Livrare \$NUME: izolarea nu e READ COMMITTED'; END IF;
" python3 - "$MUT/fara_rc_princ/livrare_migrare.sh" <<'PY'
import os, sys
s = open(sys.argv[1]).read(); a = os.environ["A"]; assert s.count(a) == 1, s.count(a)
open(sys.argv[1], "w").write(s.replace(a, ""))
PY
if izolare_principala "$MUT/fara_rc_princ/livrare_migrare.sh"; then esec "6.13 mutant fără READ COMMITTED în tranzacția principală: NEPRINS"; fi
ok6 "6.13 mutant fără READ COMMITTED în tranzacția principală ⇒ prins (dublare sub RR)"
mutant_py fara_rc_reconc "SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY;" "SET TRANSACTION READ ONLY;"
if izolare_reconciliere "$MUT/fara_rc_reconc/livrare_migrare.sh"; then esec "6.13 mutant fără READ COMMITTED în reconciliere: NEPRINS"; fi
ok6 "6.13 mutant fără READ COMMITTED în reconciliere ⇒ prins (clasificare greșită sub RR)"
mutant_py lock_in_select "SELECT pg_advisory_xact_lock(\$CHEIE);
SELECT current_database()" "SELECT current_database()"
A="  FROM supabase_migrations.schema_migrations WHERE version = '\$VERSIUNE' OR name = '\$NUME';
COMMIT;" B="  FROM supabase_migrations.schema_migrations, (SELECT pg_advisory_xact_lock(\$CHEIE)) l WHERE version = '\$VERSIUNE' OR name = '\$NUME';
COMMIT;" python3 - "$MUT/lock_in_select/livrare_migrare.sh" <<'PY'
import os, sys
s = open(sys.argv[1]).read(); a, b = os.environ["A"], os.environ["B"]; assert s.count(a) == 1, s.count(a)
open(sys.argv[1], "w").write(s.replace(a, b))
PY
if izolare_reconciliere "$MUT/lock_in_select/livrare_migrare.sh"; then esec "6.13 mutant cu lock-ul în SELECT-ul pe istoric (reconciliere): NEPRINS"; fi
ok6 "6.13 mutant cu lock-ul în ACEEAȘI instrucțiune cu SELECT-ul pe istoric (reconciliere) ⇒ prins (snapshot luat înainte de așteptare)"
"${PSQL[@]}" -d postgres -c "ALTER SYSTEM RESET default_transaction_isolation" -c "SELECT pg_reload_conf()" >/dev/null

# ---- 6.14 ȚINTA: două clustere locale, aceeași bază, identități diferite -------------------------------------------
echo "→ 6.14 ținta: al doilea cluster $DATE_DIR_B @ 127.0.0.1:$PORT_B"
[[ "$DATE_DIR_B" == /tmp/* ]] || mediu "clusterul B trebuie sub /tmp"
if [ ! -f "$DATE_DIR_B/PG_VERSION" ]; then
  mkdir -p "$DATE_DIR_B"; [ "$(id -u)" = 0 ] && chown postgres:postgres "$DATE_DIR_B"; chmod 700 "$DATE_DIR_B"
  ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR_B" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu "initdb B"
fi
PSQL_B=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT_B" -U postgres)
if ! "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT_B" -t 2; then
  ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR_B" -l "${JURNAL_PG%.log}_b.log" -w -t 30 start \
    -o "-p $PORT_B -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start B"
fi
opreste_b() { ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR_B" -m fast -w stop >/dev/null 2>&1 || true; }
trap 'readuce_ceasul; opreste_b' EXIT
[ "$(realpath "$("${PSQL_B[@]}" -d postgres -Atc 'SHOW data_directory')")" = "$(realpath "$DATE_DIR_B")" ] || mediu "pe portul $PORT_B rulează alt cluster"
SIS_B="$("${PSQL_B[@]}" -d postgres -Atc 'SELECT system_identifier FROM pg_control_system()')"
[ "$SIS_B" != "$SIS_A" ] || mediu "6.14: clusterele au același system_identifier"
"${PSQL_B[@]}" -d postgres -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS \"$BAZA_AUX\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$BAZA_AUX\" TEMPLATE template0 ENCODING 'UTF8'" >/dev/null
"${PSQL_B[@]}" -d "$BAZA_AUX" -c "$REG_TABEL" >/dev/null
inregistreaza() {  # $1 = psql (A|B), $2 = versiune, $3 = nume, $4 = fișierul pentru statements[1]
  local c=("${PSQL[@]}"); [ "$1" = B ] && c=("${PSQL_B[@]}")
  printf "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('%s', '%s', ARRAY[left(:'c', -1)]);\n" "$2" "$3" \
    | "${c[@]}" -d "$BAZA_AUX" -v c="$(cat "$4"; printf x)" >/dev/null  # „x” păstrează LF-ul final (îl scot mai jos)
}
# pe ținta GREȘITĂ (B) există deja înregistrarea EXACTĂ (nume + versiune + sha aprobat)
inregistreaza B 20261003000000 "$NUME_MIG" "$MIGRARE"
[ "$("${PSQL_B[@]}" -d "$BAZA_AUX" -Atc "SELECT encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') FROM supabase_migrations.schema_migrations")" = "$SHA_MIG" ] \
  || mediu "6.14: înregistrarea exactă pe B nu are sha-ul aprobat"
reg_b() { "${PSQL_B[@]}" -d "$BAZA_AUX" -Atc "SELECT count(*) FROM supabase_migrations.schema_migrations"; }
# W0 (control): aceeași rulare, cu identitatea LUI B aprobată ⇒ 11 — deci pe B „ar ieși succes” fără verificarea țintei
aux_nou; livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- --tinta-port "$PORT_B" --tinta-sistem "$SIS_B"
[ $RC = 11 ] || { cat "$ERR_R" >&2; esec "6.14 W0 control: pe B cu identitatea lui B trebuia 11 (cod $RC)"; }
tinta_gresita() {  # $1 = runner ⇒ ecou codul; conexiunea la B, identitatea aprobată = A
  aux_nou; livreaza "$MIGRARE" 20261003000000 "" "$1" -- --tinta-port "$PORT_B"; echo "$RC"
}
RCW="$(tinta_gresita "$LIVRARE")"
[ "$RCW" = 22 ] && grep -qF "ȚINTĂ NECONFIRMATĂ la pre-verificare" "$ERR_R" && [ "$(reg_b)" = 1 ] && [ "$(inregistrata)" = 0 ] \
  || { cat "$ERR_R" >&2; esec "6.14 W1: ținta greșită (B) cu înregistrarea exactă ⇒ trebuia 22 (cod $RCW)"; }
nu_s_a_livrat "6.14 W1"
ok6 "6.14 W1: conexiune la B (aceeași bază, alt system_identifier, înregistrare exactă existentă) ⇒ 22, nu 0/11; nimic trimis"
# W2: ținta se schimbă ÎNTRE execuție și reconciliere (invocarea 2 = reconcilierea finală redirecționată spre B)
cat > "$VAR_DIR/psql_muta" <<SH
#!/usr/bin/env bash
N="\$(cat "$VAR_DIR/muta_n" 2>/dev/null || echo 0)"; echo \$((N + 1)) > "$VAR_DIR/muta_n"
if [ "\$N" -ge 2 ]; then a=(); for x in "\$@"; do [ "\$x" = "$PORT" ] && x="$PORT_B"; a+=("\$x"); done; set -- "\${a[@]}"; fi
exec "$PG_BIN/psql" "\$@"
SH
chmod +x "$VAR_DIR/psql_muta"
tinta_mutata() { aux_nou; rm -f "$VAR_DIR/muta_n"; PSQL_T="$VAR_DIR/psql_muta" livreaza "$MIGRARE" 20261003000000 "" "$1"; echo "$RC"; }
RCW="$(tinta_mutata "$LIVRARE")"
[ "$RCW" = 22 ] && grep -qF "ȚINTĂ NECONFIRMATĂ la reconciliere" "$ERR_R" && ! grep -qF "APLICAT + ÎNREGISTRAT" "$OUT_R" \
  || { cat "$ERR_R" >&2; esec "6.14 W2: ținta schimbată la reconciliere ⇒ trebuia 22 (cod $RCW)"; }
[ "$(inregistrata)" = 1 ] || esec "6.14 W2: livrarea pe A trebuia să fi avut loc (starea reală)"
ok6 "6.14 W2: ținta schimbată între execuție și reconciliere (B are perechea exactă) ⇒ 22 NECONFIRMAT, nu 0"
# marcajul opțional de proiect (gazpet.proiect_aprobat, la nivel de bază)
aux_nou; "${PSQL[@]}" -d postgres -c "ALTER DATABASE \"$BAZA_AUX\" SET gazpet.proiect_aprobat = 'proiect_a'" >/dev/null
SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- --tinta-proiect proiect_b
esuat_fara_urme "6.14 marcaj de proiect ≠ cel aprobat" "ȚINTĂ NECONFIRMATĂ la pre-verificare" "$SNAP_E" 0 22; rm -f "$SNAP_E"
livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- --tinta-proiect proiect_a
[ $RC = 0 ] && [ "$(inregistrata)" = 1 ] || { cat "$ERR_R" >&2; esec "6.14 marcaj de proiect corect"; }
ok6 "6.14 --tinta-proiect (opțional): greșit ⇒ 22 fără urme; corect ⇒ APLICAT"
# mutanți de țintă
mutant_py fara_tinta_reconc 'tinta_ok() { [ "$R_DB" = "$TINTA_DB" ]' 'tinta_ok() { return 0; [ "$R_DB" = "$TINTA_DB" ]'
[ "$(tinta_gresita "$MUT/fara_tinta_reconc/livrare_migrare.sh")" != 22 ] || esec "6.14 mutant fără verificarea țintei (W1): NEPRINS"
[ "$(tinta_mutata "$MUT/fara_tinta_reconc/livrare_migrare.sh")" != 22 ] || esec "6.14 mutant fără verificarea țintei (W2): NEPRINS"
ok6 "6.14 mutant fără verificarea țintei la pre-verificare/reconciliere ⇒ prins (W1 și W2)"
mutant_py doar_db 'tinta_ok() { [ "$R_DB" = "$TINTA_DB" ] && [ "$R_SIS" = "$TINTA_SIS" ]' 'tinta_ok() { [ "$R_DB" = "$TINTA_DB" ]'
[ "$(tinta_gresita "$MUT/doar_db/livrare_migrare.sh")" != 22 ] || esec "6.14 mutant doar current_database(): NEPRINS"
ok6 "6.14 mutant care verifică doar current_database() ⇒ prins (același nume de bază pe alt cluster)"
mutant_py sis_optional '[[ "$TINTA_SIS" =~ ^[0-9]{1,20}$ ]] || refuz 2' '[ -z "$TINTA_SIS" ] || [[ "$TINTA_SIS" =~ ^[0-9]{1,20}$ ]] || refuz 2'
aux_nou; livreaza "$MIGRARE" 20261003000000 "" "$MUT/sis_optional/livrare_migrare.sh" -- --tinta-sistem ""
[ $RC != 2 ] || esec "6.14 mutant cu --tinta-sistem opțional: NEPRINS"
ok6 "6.14 mutant cu --tinta-sistem opțional ⇒ prins (cod $RC, nu refuz 2)"
opreste_b; trap readuce_ceasul EXIT

# ---- 6.15 CLASIFICAREA istoricului: relevante / exacte / conflicte ---------------------------------------------------
echo "→ 6.15 clasificare: relevante (nume SAU versiune), exacte (nume+versiune+sha), conflicte"
echo "-- alt conținut" > "$VAR_DIR/alt.sql"
clasifica() {  # $1 = eticheta, $2 = pregătire (funcție), $3 = cod așteptat, $4 = fragment, [$5 = runner]
  aux_nou; $2; local snap; snap="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$snap"
  local n0; n0="$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT count(*) FROM supabase_migrations.schema_migrations")"
  livreaza "$MIGRARE" 20261003000000 "" "${5:-$LIVRARE}"
  [ "$RC" = "$3" ] && grep -qF -- "$4" "$ERR_R" || { [ -n "${5:-}" ] && return 1; cat "$ERR_R" >&2; esec "$1: cod $RC, așteptat $3 („$4”)"; }
  [ -n "${5:-}" ] && return 0
  [ "$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT count(*) FROM supabase_migrations.schema_migrations")" = "$n0" ] || esec "$1: istoricul s-a schimbat"
  [ "$(stare_patch)" != "$MD5_PATCH" ] || esec "$1: patch-ul a fost aplicat"
  nu_s_a_livrat "$1"; fara_urme "$snap" "$1 ⇒ $3, fără livrare" "$BAZA_AUX"; rm -f "$snap"
}
p_nume_alta_v()  { inregistreaza A 20261002000000 "$NUME_MIG" "$MIGRARE"; }
p_v_alt_nume()   { inregistreaza A 20261003000000 "20261003x_alt_nume" "$MIGRARE"; }
p_exact_plus()   { inregistreaza A 20261003000000 "$NUME_MIG" "$MIGRARE"; inregistreaza A 20261002000000 "$NUME_MIG" "$MIGRARE"; }
p_exact_alt_sha(){ inregistreaza A 20261003000000 "$NUME_MIG" "$VAR_DIR/alt.sql"; }
p_exact()        { inregistreaza A 20261003000000 "$NUME_MIG" "$MIGRARE"; }
clasifica "6.15 același nume, altă versiune"                   p_nume_alta_v   21 "CONFLICT: istoricul are 1 rând(uri)"
clasifica "6.15 aceeași versiune, alt nume"                    p_v_alt_nume    21 "CONFLICT: istoricul are 1 rând(uri)"
clasifica "6.15 perechea exactă + alt rând cu același nume"    p_exact_plus    21 "CONFLICT: istoricul are 2 rând(uri) cu numele $NUME_MIG sau versiunea 20261003000000, din care 1 perechea exactă"
clasifica "6.15 nume+versiune cu alt sha (alt artefact)"       p_exact_alt_sha 21 "din care 0 perechea exactă"
clasifica "6.15 perechea exactă preexistentă"                  p_exact         11 "✓ DEJA ÎNREGISTRATĂ: $NUME_MIG v20261003000000 e deja înregistrată cu artefactul aprobat (sha256 $SHA_MIG); nu s-a reaplicat."
grep -qF "reconciliere manuală" "$ERR_R" && esec "6.15 11 nu trebuie să ceară reconciliere manuală"
# reluarea EXACTĂ după succes real ⇒ 11, mesajul exact, nimic reaplicat
aux_nou; livreaza "$MIGRARE" 20261003000000; [ $RC = 0 ] || { cat "$ERR_R" >&2; esec "6.15 livrarea inițială"; }
livreaza "$MIGRARE" 20261003000000
[ $RC = 11 ] && [ "$(inregistrata)" = 1 ] && grep -qxF "✓ DEJA ÎNREGISTRATĂ: $NUME_MIG v20261003000000 e deja înregistrată cu artefactul aprobat (sha256 $SHA_MIG); nu s-a reaplicat." "$ERR_R" \
  && ! grep -qF "APLICAT + ÎNREGISTRAT" "$OUT_R" || { cat "$ERR_R" >&2; esec "6.15 reluarea exactă după succes"; }
nu_s_a_livrat "6.15 reluarea exactă"
ok6 "6.15 reluarea exactă după succes ⇒ 11 „… deja înregistrată cu artefactul aprobat …; nu s-a reaplicat.”, nimic trimis"
# mutanți de clasificare
mutant_py relevante_doar_perechea "       count(*) || '|' ||" "       count(*) FILTER (WHERE version = '\$VERSIUNE' AND name = '\$NUME') || '|' ||"
if clasifica "m" p_nume_alta_v 21 "CONFLICT" "$MUT/relevante_doar_perechea/livrare_migrare.sh"; then esec "6.15 mutant (relevante = doar perechea): NEPRINS"; fi
ok6 "6.15 mutant care numără doar perechea exactă (formula r5) ⇒ prins (același nume, altă versiune nu mai e CONFLICT, cod $RC)"
mutant_py unsprezece_larg 'if [ "$R_REL" = 1 ] && [ "$R_EX" = 1 ]; then
  echo "✓ DEJA' 'if [ "$R_EX" -ge 1 ]; then
  echo "✓ DEJA'
if clasifica "m" p_exact_plus 21 "CONFLICT" "$MUT/unsprezece_larg/livrare_migrare.sh"; then esec "6.15 mutant 11 larg: NEPRINS"; fi
ok6 "6.15 mutant care declară „deja înregistrată” la ≥1 exactă (ignoră dublura) ⇒ prins (cod $RC)"
mutant_py zero_larg 'if [ "$R_REL" = 1 ] && [ "$R_EX" = 1 ]; then
  [ "$RC_PSQL" = 0 ]' 'if [ "$R_EX" -ge 1 ]; then
  [ "$RC_PSQL" = 0 ]'
mutant_py fara_pre '# --- P. pre-verificare (nimic trimis dacă nu trece) ----------------------------
if ! reconciliaza; then' '# --- P. pre-verificare ELIMINATĂ (mutant) ---
if false; then'
python3 - "$MUT/fara_pre/livrare_migrare.sh" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
for a in ('if ! tinta_ok; then\n  echo "✗ ȚINTĂ NECONFIRMATĂ la pre-verificare', 'if [ "$R_REL" = 1 ] && [ "$R_EX" = 1 ]; then\n  echo "✓ DEJA', 'if [ "$R_REL" != 0 ]; then\n  echo "✗ CONFLICT: istoricul'):
    assert s.count(a) == 1, a
    s = s.replace(a, a.replace("if ", "if false && ", 1))
open(p, "w").write(s)
PY
if clasifica "m" p_exact 11 "nu s-a reaplicat" "$MUT/fara_pre/livrare_migrare.sh"; then esec "6.15 mutant fără pre-verificare: NEPRINS"; fi
ok6 "6.15 mutant fără pre-verificare ⇒ prins (perechea preexistentă raportată cod $RC, nu 11 „nu s-a reaplicat”)"
# zero_larg: după livrare, perechea exactă + dublură ⇒ trebuie CONFLICT, nu 0. Dublura apare concurent: un wrapper
# inserează, după livrare și înainte de reconciliere, un al doilea rând cu același nume.
cat > "$VAR_DIR/psql_dublura" <<SH
#!/usr/bin/env bash
N="\$(cat "$VAR_DIR/dub_n" 2>/dev/null || echo 0)"; echo \$((N + 1)) > "$VAR_DIR/dub_n"
if [ "\$N" = 2 ]; then printf "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261002000000', '$NUME_MIG', ARRAY['x']);\n" \
  | "$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA_AUX" >/dev/null; fi
exec "$PG_BIN/psql" "\$@"
SH
chmod +x "$VAR_DIR/psql_dublura"
dublura_post() { aux_nou; rm -f "$VAR_DIR/dub_n"; PSQL_T="$VAR_DIR/psql_dublura" livreaza "$MIGRARE" 20261003000000 "" "$1"; }
dublura_post "$LIVRARE"
[ $RC = 21 ] && grep -qF "CONFLICT: după livrare istoricul are 2 rând(uri)" "$ERR_R" || { cat "$ERR_R" >&2; esec "6.15 dublură apărută după livrare ⇒ trebuia 21 (cod $RC)"; }
ok6 "6.15 perechea exactă + dublură apărută până la reconciliere ⇒ CONFLICT (21), nu APLICAT"
dublura_post "$MUT/zero_larg/livrare_migrare.sh"
[ $RC != 21 ] || esec "6.15 mutant 0 larg (ignoră dublura după livrare): NEPRINS"
ok6 "6.15 mutant care declară APLICAT la ≥1 exactă după livrare ⇒ prins (cod $RC)"

# ---- 6.16 MUTANȚI de validator (runda 6), prinși de cazurile 6.0 / 6.0g ------------------------------------------------
mv_py() {  # $1 = nume, $2 = căutat, $3 = înlocuire ⇒ $MUT/$1/v.py
  mkdir -p "$MUT/$1"; A="$2" B="$3" python3 - "$VALIDATOR" "$MUT/$1/v.py" <<'PY' || mediu "mutantul de validator: text absent"
import os, sys
s = open(sys.argv[1]).read(); a, b = os.environ["A"], os.environ["B"]; assert s.count(a) == 1, s.count(a)
open(sys.argv[2], "w").write(s.replace(a, b))
PY
}
mv_py v_cr 'text[j] not in "\n\r"' 'text[j] != "\n"'
mv_py v_bslash "if c == \"'\" and strict:" "if False:"
mv_py v_lexicale '        if p in mic:' '        if False:'
mv_py v_set '        verifica_set(ln, toks)' '        pass'
mv_py v_set_config '        verifica_set_config(ln, toks)' '        pass'
mv_py v_search_path '        if toks != SEARCH_PATH_OK:' '        if False:'
mv_py v_garda '    if not garda_in_cod(text):' '    if GARDA not in text:'
for m in v_cr v_bslash v_lexicale v_set v_set_config v_search_path v_garda; do
  prins=0
  for c in "${CAZURI_REFUZ[@]}"; do VALIDATOR="$MUT/$m/v.py" valideaza_caz 1 "$c" || { prins=1; break; }; done
  [ $prins = 1 ] || for c in "${CAZURI_OK[@]}"; do VALIDATOR="$MUT/$m/v.py" valideaza_caz 0 "$c" || { prins=1; break; }; done
  [ $prins = 1 ] || for c in "${GARDA_REFUZ[@]}"; do VALIDATOR_G="$MUT/$m/v.py" garda_caz 1 "$c" || { prins=1; break; }; done
  [ $prins = 1 ] || esec "6.16 mutant de validator $m: NEPRINS"
  ok6 "6.16 mutant de validator $m ⇒ prins"
done

# ============================================================================
# 6.17–6.20 — RUNDA 7 (verdict Copilot R6, docs/LIVRARE_MIGRARE_VERDICT_COPILOT_R6.md)
# ============================================================================
# ---- 6.17 COPY … FROM STDIN: fragmentul exact din verdict, între gărzi --------------------------------------------
echo "→ 6.17 COPY … FROM STDIN (fragmentul din verdictul R6), refuz înainte de psql + control dinamic pe starea finală"
{ garda_sql "$NUME_MIG"
  echo "CREATE TABLE public.proba_livrare_copy(v text);"
  echo "COPY public.proba_livrare_copy(v) FROM STDIN;"
  echo "\$date\$"
  echo "\\."
  echo "COMMIT;"
  echo "-- \$date\$"
  garda_sql "$NUME_MIG"; } > "$VAR_DIR/copy_atac.sql"
grep -qxF '\.' "$VAR_DIR/copy_atac.sql" || mediu "6.17: fragmentul nu conține linia \\."
aux_nou; SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
livreaza "$VAR_DIR/copy_atac.sql"; refuz_preconex "6.17 COPY FROM STDIN + \\. + COMMIT (fragmentul din verdict)" 3 "COPY la nivel superior" "$SNAP_E"
[ "$(exista public.proba_livrare_copy)" = f ] || esec "6.17 starea finală: proba_livrare_copy există"
ok6 "6.17 runnerul real: refuz 3 înainte de psql; stare finală: proba_livrare_copy ABSENTĂ, 0 înregistrări"
# control dinamic: validatorul SLĂBIT (fără regula COPY) + runnerul real ⇒ psql citește „\$date\$” ca rând COPY, „\.”
# încheie datele, COMMIT se execută ⇒ tabela rămâne COMISĂ (atacul real) — deci regula COPY e cea care îl oprește
mkdir -p "$MUT/v_copy_r"; A='        if "COPY" in toks:' python3 - "$VALIDATOR" "$MUT/v_copy_r/v.py" <<'PY'
import os, sys
s = open(sys.argv[1]).read(); a = os.environ["A"]; assert s.count(a) == 1
open(sys.argv[2], "w").write(s.replace(a, "        if False:"))
PY
python3 "$MUT/v_copy_r/v.py" "$VAR_DIR/copy_atac.sql" >/dev/null 2>&1 || mediu "6.17: validatorul slăbit trebuia să accepte fragmentul (reproducerea verdictului)"
mkdir -p "$MUT/copy_vslab"; cp "$LIVRARE" "$MUT/copy_vslab/livrare_migrare.sh"; cp "$MUT/v_copy_r/v.py" "$MUT/copy_vslab/livrare_validator.py"
aux_nou; livreaza "$VAR_DIR/copy_atac.sql" 20261003000000 "" "$MUT/copy_vslab/livrare_migrare.sh"
[ "$(exista public.proba_livrare_copy)" = t ] || { cat "$ERR_R" >&2; esec "6.17 control dinamic: cu validatorul slăbit tabela trebuia comisă (atacul reprodus)"; }
RAND="$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT string_agg(v, ',') FROM public.proba_livrare_copy")"
[ "$RAND" = '$date$' ] || esec "6.17 control dinamic: rândul COPY = '$RAND' (așteptat \$date\$)"
[ "$(inregistrata)" = 0 ] || esec "6.17 control dinamic: înregistrare neașteptată"
ok6 "6.17 control dinamic: validator fără regula COPY ⇒ COMMIT executat de psql, proba_livrare_copy COMISĂ (rând '\$date\$'), runner cod $RC — mutant prins pe STAREA FINALĂ"
rm -f "$SNAP_E"

# ---- 6.18 CONFIGURARE: exemplele din verdictul R6 livrate prin runner ⇒ refuz înainte de psql; forma aprobată ⇒ APLICAT
echo "→ 6.18 set_config / SET: formele citate/calificate/dinamice refuzate înainte de psql; formele aprobate acceptate"
aux_nou; SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
for linie in "SELECT set_config('client_' || 'encoding', 'LATIN1', true);" 'SET LOCAL "SEARCH_PATH" = public, pg_catalog;' \
             "SELECT pg_catalog.\"set_config\"('search_path', 'public,pg_catalog', true);"; do
  { garda_sql "$NUME_MIG"; echo "CREATE TABLE public.t_cfg (x int);"; printf '%s\n' "$linie"; } > "$VAR_DIR/cfg.sql"
  livreaza "$VAR_DIR/cfg.sql"; refuz_preconex "6.18 verdict R6: «$linie»" 3 "REFUZ validator" "$SNAP_E"
  [ "$(exista public.t_cfg)" = f ] || esec "6.18 starea finală: t_cfg există"
done
NUME_S="20261003z_test_config"
{ garda_sql "$NUME_S"; echo "SET LOCAL search_path = public, pg_temp;"
  echo "SELECT set_config('gazpet.marcaj_test', 'x:' || txid_current(), true);"
  echo "CREATE TABLE public.t_cfg AS SELECT current_setting('search_path') AS sp, current_setting('gazpet.marcaj_test', true) LIKE 'x:%' AS m;"
} > "$VAR_DIR/cfg_ok.sql"
NUME_T="$NUME_S" livreaza "$VAR_DIR/cfg_ok.sql" 20261003300000
[ $RC = 0 ] && [ "$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT sp || '|' || m FROM public.t_cfg")" = "public, pg_temp|true" ] \
  || { cat "$ERR_R" >&2; esec "6.18 forma aprobată SET LOCAL search_path + set_config('gazpet.…') trebuia APLICATĂ (cod $RC)"; }
ok6 "6.18 forma aprobată (SET LOCAL search_path = public, pg_temp + set_config/current_setting pe gazpet.*) ⇒ APLICAT"
rm -f "$SNAP_E"

# ---- 6.19 INSTANȚA AUTORITATIVĂ: replică fizică locală a lui A (același nume de bază, același system_identifier) -----
echo "→ 6.19 instanța autoritativă: replică fizică $DATE_DIR_R @ 127.0.0.1:$PORT_R (pg_basebackup -R, replay pe pauză)"
[[ "$DATE_DIR_R" == /tmp/* ]] || mediu "replica trebuie sub /tmp"
[ -x "$PG_BIN/pg_basebackup" ] || mediu "pg_basebackup lipsește"
opreste_r() { [ -f "$DATE_DIR_R/postmaster.pid" ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR_R" -m immediate -w stop >/dev/null 2>&1; true; }
opreste_r; rm -rf "$DATE_DIR_R"; mkdir -p "$DATE_DIR_R"; [ "$(id -u)" = 0 ] && chown postgres:postgres "$DATE_DIR_R"; chmod 700 "$DATE_DIR_R"
trap 'readuce_ceasul; opreste_r' EXIT
aux_nou
ca_postgres "$PG_BIN/pg_basebackup" -h 127.0.0.1 -p "$PORT" -U postgres -D "$DATE_DIR_R" -R -X stream -c fast >/dev/null 2>&1 \
  || mediu "pg_basebackup a eșuat (pg_hba replication?)"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR_R" -l "${JURNAL_PG%.log}_replica.log" -w -t 30 start \
  -o "-p $PORT_R -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c hot_standby=on" >/dev/null || mediu "pg_ctl start replica"
PSQL_R=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT_R" -U postgres)
[ "$(realpath "$("${PSQL_R[@]}" -d postgres -Atc 'SHOW data_directory')")" = "$(realpath "$DATE_DIR_R")" ] || mediu "pe portul $PORT_R rulează alt cluster"
[ "$("${PSQL_R[@]}" -d postgres -Atc 'SELECT pg_is_in_recovery()')" = t ] || mediu "6.19: replica nu e în recovery"
[ "$("${PSQL_R[@]}" -d postgres -Atc 'SELECT system_identifier FROM pg_control_system()')" = "$SIS_A" ] || mediu "6.19: replica are alt system_identifier"
# sincronizează replica cu A (baza auxiliară nouă inclusă), apoi pune replay-ul pe pauză ⇒ replica „întârziată”
replica_sincron_pauza() {
  "${PSQL_R[@]}" -d postgres -Atc "SELECT pg_wal_replay_resume()" >/dev/null 2>&1 || true
  local lsn; lsn="$("${PSQL[@]}" -d postgres -Atc "SELECT pg_current_wal_lsn()")"
  for _ in $(seq 1 150); do
    [ "$("${PSQL_R[@]}" -d postgres -Atc "SELECT pg_last_wal_replay_lsn() >= '$lsn'::pg_lsn")" = t ] && break; sleep 0.1; done
  [ "$("${PSQL_R[@]}" -d postgres -Atc "SELECT pg_last_wal_replay_lsn() >= '$lsn'::pg_lsn")" = t ] || mediu "6.19: replica nu a prins primarul"
  "${PSQL_R[@]}" -d postgres -Atc "SELECT pg_wal_replay_pause()" >/dev/null
  for _ in $(seq 1 100); do [ "$("${PSQL_R[@]}" -d postgres -Atc "SELECT pg_get_wal_replay_pause_state()")" = paused ] && break; sleep 0.1; done
  [ "$("${PSQL_R[@]}" -d postgres -Atc "SELECT pg_get_wal_replay_pause_state()")" = paused ] || mediu "6.19: replay-ul nu s-a oprit"
  [ "$("${PSQL_R[@]}" -d "$BAZA_AUX" -Atc "SELECT current_database() || '|' || (SELECT system_identifier FROM pg_control_system())")" = "$BAZA_AUX|$SIS_A" ] \
    || mediu "6.19: replica nu are aceeași bază + același system_identifier"
}
reg_r() { "${PSQL_R[@]}" -d "$BAZA_AUX" -Atc "SELECT count(*) FROM supabase_migrations.schema_migrations"; }
# wrapper: invocarea 1 (livrarea) rulează REAL pe primar; cu MOD_R=pierdut raportează apoi conexiune pierdută (2);
# invocările ≥ REDIR_DE sunt redirecționate spre replică (portul aprobat → PORT_R); fiecare invocare se loghează
cat > "$VAR_DIR/psql_replica" <<SH
#!/usr/bin/env bash
N="\$(cat "$VAR_DIR/rep_n" 2>/dev/null || echo 0)"; echo \$((N + 1)) > "$VAR_DIR/rep_n"
redir=0; [ "\$N" -ge "\$REDIR_DE" ] && [ "\$N" -le "\${REDIR_PANA:-99}" ] && redir=1
if [ \$redir = 1 ]; then a=(); for x in "\$@"; do [ "\$x" = "$PORT" ] && x="$PORT_R"; a+=("\$x"); done; set -- "\${a[@]}"; fi
echo "\$N redir=\$redir \$*" >> "$SANT_LOG"
if [ "\$N" = 1 ] && [ "\$MOD_R" = pierdut ]; then
  "$PG_BIN/psql" "\$@" >/dev/null 2>&1; echo "psql: server closed the connection unexpectedly (simulat)" >&2; exit 2
fi
exec "$PG_BIN/psql" "\$@"
SH
chmod +x "$VAR_DIR/psql_replica"
replica_scenariu() {  # $1 = runner, $2 = MOD_R (pierdut|normal), $3 = REDIR_DE, [$4 = REDIR_PANA] ⇒ RC
  aux_nou; replica_sincron_pauza; rm -f "$VAR_DIR/rep_n"
  MOD_R="$2" REDIR_DE="$3" REDIR_PANA="${4:-99}" PSQL_T="$VAR_DIR/psql_replica" livreaza "$MIGRARE" 20261003000000 "" "$1"
}
# R1: pre-verificarea DIRECT pe replică (portul replicii dat ca țintă) ⇒ 22, nimic trimis
aux_nou; replica_sincron_pauza
livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- --tinta-port "$PORT_R"
[ $RC = 22 ] && grep -qF "ȚINTĂ NECONFIRMATĂ la pre-verificare" "$ERR_R" && grep -qF "in_recovery=true" "$ERR_R" && [ "$(inregistrata)" = 0 ] \
  || { cat "$ERR_R" >&2; esec "6.19 R1: pre-verificarea pe replică ⇒ trebuia 22 (cod $RC)"; }
nu_s_a_livrat "6.19 R1"
ok6 "6.19 R1: endpoint = replica (același db + system_identifier, in_recovery) ⇒ 22 la pre-verificare, nimic trimis"
# R2: livrare pe PRIMAR, confirmarea pierdută, reconcilierea redirecționată spre replica întârziată (vede 0 rânduri)
replica_scenariu "$LIVRARE" pierdut 2
[ $RC = 22 ] && grep -qF "ȚINTĂ NECONFIRMATĂ la reconciliere" "$ERR_R" && grep -qF "in_recovery=true" "$ERR_R" \
  || { cat "$ERR_R" >&2; esec "6.19 R2: reconcilierea pe replica întârziată ⇒ trebuia 22 (cod $RC)"; }
[ "$(inregistrata)" = 1 ] && [ "$(stare_patch)" = "$MD5_PATCH" ] || esec "6.19 R2: livrarea trebuia comisă pe primar"
[ "$(reg_r)" = 0 ] || esec "6.19 R2: replica trebuia să fie întârziată (0 înregistrări), are $(reg_r)"
ok6 "6.19 R2: comis pe primar, confirmare pierdută, reconciliere pe replica întârziată (0 rânduri) ⇒ 22, NU 10"
replica_scenariu "$LIVRARE" normal 2
[ $RC = 22 ] && [ "$(inregistrata)" = 1 ] && [ "$(reg_r)" = 0 ] || { cat "$ERR_R" >&2; esec "6.19 R2b: psql 0 + reconciliere pe replică ⇒ trebuia 22 (cod $RC)"; }
ok6 "6.19 R2b: psql raportează succes, reconciliere pe replica întârziată ⇒ 22 (nu 0, nu 20 fals)"
# R3: tranzacția principală redirecționată spre replică (pre-verificarea și reconcilierea pe primar) ⇒ refuz explicit în
#     tranzacție („în recovery”), apoi reconcilierea pe primar confirmă 0 rânduri ⇒ 10 (corect: nimic pe primar)
replica_scenariu "$LIVRARE" normal 1 1
[ $RC = 10 ] && grep -qF "instanța e în recovery" "$ERR_R" && [ "$(inregistrata)" = 0 ] \
  || { cat "$ERR_R" >&2; esec "6.19 R3: tranzacția principală pe replică ⇒ trebuia refuzul „în recovery” + 10 (cod $RC)"; }
ok6 "6.19 R3: tranzacția principală pe replică ⇒ refuz explicit „instanța e în recovery”, primarul confirmă 0 ⇒ 10"
# mutanți de instanță autoritativă
mutant_py fara_rec_reconc 'tinta_ok() { [ "$R_DB" = "$TINTA_DB" ] && [ "$R_SIS" = "$TINTA_SIS" ] && [ "$R_REC" = false ]' \
                          'tinta_ok() { [ "$R_DB" = "$TINTA_DB" ] && [ "$R_SIS" = "$TINTA_SIS" ]'
replica_scenariu "$MUT/fara_rec_reconc/livrare_migrare.sh" pierdut 2
[ $RC != 22 ] || esec "6.19 mutant fără pg_is_in_recovery la reconciliere: NEPRINS"
[ $RC = 10 ] && echo "   (mutantul reproduce verdictul: NEAPLICAT confirmat fals, deși primarul are înregistrarea)"
ok6 "6.19 mutant fără in_recovery la pre-verificare/reconciliere ⇒ prins (cod $RC în loc de 22)"
mutant_py fara_rec_princ "  IF pg_is_in_recovery() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Livrare \$NUME: instanța e în recovery (replică) — nu e endpointul de scriere aprobat'; END IF;
" ""
replica_scenariu "$MUT/fara_rec_princ/livrare_migrare.sh" normal 1 1
grep -qF "instanța e în recovery" "$ERR_R" && esec "6.19 mutant fără verificarea din tranzacția principală: NEPRINS"
ok6 "6.19 mutant fără pg_is_in_recovery în tranzacția principală ⇒ prins (refuzul explicit lipsește)"
mutant_py host_optional '[[ "$C_HOST" =~ ^[A-Za-z0-9._/-]{1,253}$ ]] || refuz 2' '[ -z "$C_HOST" ] || [[ "$C_HOST" =~ ^[A-Za-z0-9._/-]{1,253}$ ]] || refuz 2'
aux_nou; livreaza "$MIGRARE" 20261003000000 "" "$MUT/host_optional/livrare_migrare.sh" -- --tinta-host ""
[ $RC != 2 ] || esec "6.19 mutant cu --tinta-host opțional: NEPRINS"
ok6 "6.19 mutant cu --tinta-host opțional ⇒ prins (cod $RC, nu refuz 2)"
opreste_r; rm -rf "$DATE_DIR_R"; trap readuce_ceasul EXIT

# ---- 6.20 MUTANȚI de validator (runda 7), prinși de cazurile 6.0 -------------------------------------------------------
mv_py v_copy '        if "COPY" in toks:' '        if False:'
mv_py v_sc_primul_token ' and toks[k + 2].startswith("'"'"'") and toks[k + 3] == ","):' ' and toks[k + 2].startswith("'"'"'")):'
mv_py v_sc_citat '    return tok == "SET_CONFIG" or (tok.startswith' '    return tok == "SET_CONFIG" and (tok.startswith'
mv_py v_guc_majuscule '    n = nume.strip().lower()' '    n = nume.strip()'
mv_py v_set_nerecunoscut "        raise Refuz(f\"SET cu sintaxă nerecunoscută (linia {ln}): {' '.join(toks[:5])}\")" '        return'
for m in v_copy v_sc_primul_token v_sc_citat v_guc_majuscule v_set_nerecunoscut; do
  prins=0
  for c in "${CAZURI_REFUZ[@]}"; do VALIDATOR="$MUT/$m/v.py" valideaza_caz 1 "$c" || { prins=1; break; }; done
  [ $prins = 1 ] || for c in "${CAZURI_OK[@]}"; do VALIDATOR="$MUT/$m/v.py" valideaza_caz 0 "$c" || { prins=1; break; }; done
  [ $prins = 1 ] || esec "6.20 mutant de validator $m: NEPRINS"
  ok6 "6.20 mutant de validator $m ⇒ prins"
done

# ---- 6.21 UNICODE: probele din verdictul R7 livrate prin runner ⇒ refuz înainte de psql, fără urme ------------------
echo "→ 6.21 identificatori Unicode U&\"…\": refuz înainte de psql; formele aprobate rămân acceptate"
aux_nou; SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
for linie in "SELECT pg_catalog.U&\"set\\005Fconfig\"('search_path','public,pg_catalog',true);" \
             "SELECT pg_catalog.U&\"set\\005Fconfig\"('client_' || 'encoding','LATIN1',true);" \
             "SELECT pg_catalog.U&\"set!005Fconfig\" UESCAPE '!' ('search_path','public,pg_catalog',true);" \
             "SELECT \"pg_catalog\".U&\"set\\005Fconfig\"('search_path','public,pg_catalog',true);"; do
  { garda_sql "$NUME_MIG"; echo "CREATE TABLE public.t_uni (x int);"; printf '%s\n' "$linie"; } > "$VAR_DIR/uni.sql"
  livreaza "$VAR_DIR/uni.sql"; refuz_preconex "6.21 verdict R7: «$linie»" 3 "REFUZ validator" "$SNAP_E"
  grep -qF "escape Unicode" "$ERR_R" || { cat "$ERR_R" >&2; esec "6.21 refuzat din alt motiv decât U&: $linie"; }
  [ "$(exista public.t_uni)" = f ] && [ "$(inregistrata)" = 0 ] || esec "6.21 starea finală: t_uni există sau înregistrare"
done
rm -f "$SNAP_E"
# formele aprobate (SET LOCAL search_path = public, pg_temp; set_config/current_setting statice pe gazpet.*) ⇒ APLICAT
aux_nou; NUME_S="20261003z_test_config"
{ garda_sql "$NUME_S"; echo "SET LOCAL search_path = public, pg_temp;"
  echo "SELECT set_config('gazpet.marcaj_test', 'x:' || txid_current(), true);"
  echo "CREATE TABLE public.t_uni AS SELECT current_setting('search_path') AS sp, current_setting('gazpet.marcaj_test', true) LIKE 'x:%' AS m;"
} > "$VAR_DIR/uni_ok.sql"
NUME_T="$NUME_S" livreaza "$VAR_DIR/uni_ok.sql" 20261003300000
[ $RC = 0 ] && [ "$(inregistrata "$NUME_S")" = 1 ] && [ "$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT sp || '|' || m FROM public.t_uni")" = "public, pg_temp|true" ] \
  || { cat "$ERR_R" >&2; esec "6.21 formele aprobate trebuiau APLICATE + înregistrate (cod $RC)"; }
ok6 "6.21 formele aprobate (SET LOCAL search_path = public, pg_temp + set_config('gazpet.…') static) ⇒ APLICAT + înregistrat"

# ---- 6.22 CONTROL DINAMIC direct pe PG local (FĂRĂ validator): U&"set\005Fconfig" chiar schimbă setarea -------------
echo "→ 6.22 control dinamic pe PG local: U&\"set\\005Fconfig\" = set_config (blocantul era real)"
for linie in "SELECT pg_catalog.U&\"set\\005Fconfig\"('search_path','public,pg_catalog',true);" \
             "SELECT pg_catalog.U&\"set!005Fconfig\" UESCAPE '!' ('search_path','public,pg_catalog',true);" \
             "SELECT \"pg_catalog\".U&\"set\\005Fconfig\"('search_path','public,pg_catalog',true);"; do
  SP="$(printf 'BEGIN;\nSET LOCAL search_path = public, pg_temp;\n%s\nSELECT current_setting('"'"'search_path'"'"');\nROLLBACK;\n' "$linie" \
        | "${PSQL[@]}" -d "$BAZA_AUX" -At 2>&1 | tail -n 1)"
  [ "$SP" = "public,pg_catalog" ] || esec "6.22 control dinamic: «$linie» ⇒ search_path='$SP' (așteptat public,pg_catalog)"
done
CE="$(printf 'BEGIN;\n%s\nSELECT current_setting('"'"'client_encoding'"'"');\nROLLBACK;\n' "SELECT pg_catalog.U&\"set\\005Fconfig\"('client_' || 'encoding','LATIN1',true);" \
      | "${PSQL[@]}" -d "$BAZA_AUX" -At 2>&1 | tail -n 1)"
[ "$CE" = "LATIN1" ] || esec "6.22 control dinamic: client_encoding='$CE' (așteptat LATIN1)"
ok6 "6.22 control dinamic (psql direct, fără validator): U&\"set\\005Fconfig\" (simplu, UESCAPE '!', \"pg_catalog\".) ⇒ search_path schimbat; concatenat ⇒ client_encoding=LATIN1"
# validator SLĂBIT (fără regula U&) + runnerul real ⇒ proba e acceptată și APLICATĂ cu search_path schimbat
mkdir -p "$MUT/uni_vslab"; cp "$LIVRARE" "$MUT/uni_vslab/livrare_migrare.sh"
A='            if strict and cur[-2:] == ["U", "&"]:' python3 - "$VALIDATOR" "$MUT/uni_vslab/livrare_validator.py" <<'PY'
import os, sys
s = open(sys.argv[1]).read(); a = os.environ["A"]; assert s.count(a) == 1
open(sys.argv[2], "w").write(s.replace(a, "            if False:"))
PY
aux_nou; NUME_S="20261003z_test_unicode"
{ garda_sql "$NUME_S"; echo "SELECT pg_catalog.U&\"set\\005Fconfig\"('search_path','public,pg_catalog',true);"
  echo "CREATE TABLE public.t_uni AS SELECT current_setting('search_path') AS sp;"; } > "$VAR_DIR/uni_atac.sql"
NUME_T="$NUME_S" livreaza "$VAR_DIR/uni_atac.sql" 20261003400000 "" "$MUT/uni_vslab/livrare_migrare.sh"
[ $RC = 0 ] && [ "$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT sp FROM public.t_uni")" = "public,pg_catalog" ] \
  || { cat "$ERR_R" >&2; esec "6.22 validator slăbit: atacul trebuia reprodus (cod $RC)"; }
ok6 "6.22 validator fără regula U& + runnerul real ⇒ migrarea APLICATĂ cu search_path='public,pg_catalog' (mutant prins pe starea finală)"
mv_py v_unicode '            if strict and cur[-2:] == ["U", "&"]:' '            if False:'
mv_py v_uescape '        if "UESCAPE" in toks:' '        if False:'
for m in v_unicode v_uescape; do
  prins=0
  for c in "${CAZURI_REFUZ[@]}"; do VALIDATOR="$MUT/$m/v.py" valideaza_caz 1 "$c" || { prins=1; break; }; done
  [ $prins = 1 ] || esec "6.22 mutant de validator $m: NEPRINS"
  ok6 "6.22 mutant de validator $m ⇒ prins"
done

# ---- 6.23 CONDIȚII OPERAȚIONALE (Runda 9): --service RETRAS, variabile libpq care redirecționează, pg_control_system() --
echo "→ 6.23 --service retras, variabile PG* din mediu, dreptul pe pg_control_system()"
aux_nou; SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
for v in "PGSERVICE=gazpet_live" "PGSERVICEFILE=/tmp/x.conf" "PGSYSCONFDIR=/tmp" "PGHOSTADDR=192.0.2.123" \
         "PGOPTIONS=-c search_path=pg_catalog" "PGTARGETSESSIONATTRS=any" "PGLOADBALANCEHOSTS=random"; do
  export "${v%%=*}=${v#*=}"; livreaza "$MIGRARE"; unset "${v%%=*}"
  refuz_preconex "6.23 variabila ${v%%=*} moștenită din mediu" 2 "variabila ${v%%=*}" "$SNAP_E"
done
HOME_V="$HOME"; export HOME="$VAR_DIR/home"; mkdir -p "$HOME"
# proba Copilot R8: două secțiuni cu același nume — libpq folosește PRIMA (hostaddr), verificarea veche vedea doar a doua
printf '[review_r8] # nota\nhostaddr=192.0.2.123\n[review_r8]\nhost=approved.example.invalid\n[review_opt] # nota\noptions=-c search_path=pg_catalog\n[review_opt]\nhost=127.0.0.1\n[svc_ok]\nhost=127.0.0.1\nport=%s\n' "$PORT" > "$HOME/.pg_service.conf"
livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- --service review_r8
refuz_preconex "6.23 --service cu secțiune dublă (hostaddr în prima, proba R8)" 2 "--service nu mai e acceptat" "$SNAP_E"
livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- --service review_opt
refuz_preconex "6.23 --service cu secțiune dublă (options în prima)" 2 "--service nu mai e acceptat" "$SNAP_E"
livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- --service svc_ok
refuz_preconex "6.23 --service valid, unic (suport retras)" 2 "--service nu mai e acceptat" "$SNAP_E"
# mutantul care reacceptă --service (îl exportă ca PGSERVICE) ⇒ refuzul dispare
mutant_py reaccepta_service '    --service) refuz 2 "--service nu mai e acceptat' '    --service) export PGSERVICE="$2" ;; --service-vechi) refuz 2 "x'
livreaza "$MIGRARE" 20261003000000 "" "$MUT/reaccepta_service/livrare_migrare.sh" -- --service svc_ok
{ [ $RC = 2 ] && grep -qF -- "--service nu mai e acceptat" "$ERR_R"; } && esec "6.23 mutant care reacceptă --service: NEPRINS"
ok6 "6.23 mutant care reacceptă --service ⇒ prins (refuzul lipsește, cod $RC)"
export HOME="$HOME_V"
# endpoint explicit + passfile ⇒ APLICAT; PGHOST/PGPORT ostile din mediu nu schimbă ținta (unset în runner)
aux_nou; SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
PF="$VAR_DIR/pgpass_r9"; printf '127.0.0.1:%s:*:postgres:nefolosit\n' "$PORT" > "$PF"; chmod 600 "$PF"
export PGPASSFILE="$PF" PGHOST=192.0.2.123 PGPORT="$PORT_B"
livreaza "$MIGRARE" 20261003000000
unset PGPASSFILE PGHOST PGPORT
[ $RC = 0 ] && [ "$(inregistrata)" = 1 ] || { cat "$ERR_R" >&2; esec "6.23 endpoint explicit + PGPASSFILE (+PGHOST/PGPORT ostile) trebuia APLICAT (cod $RC)"; }
ok6 "6.23 endpoint explicit + PGPASSFILE ⇒ APLICAT + înregistrat pe ținta aprobată (PGHOST/PGPORT ostile ignorate)"
# rol fără drept de apel pe pg_control_system() ⇒ pre-verificarea refuză explicit (12), nimic trimis
aux_nou; SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
"${PSQL[@]}" -d postgres -c "DROP ROLE IF EXISTS livr_fara_ctrl" -c "CREATE ROLE livr_fara_ctrl LOGIN" >/dev/null
"${PSQL[@]}" -d "$BAZA_AUX" -c "REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC" >/dev/null
SNAP_E="$(mktemp)"; schema_snapshot "$BAZA_AUX" > "$SNAP_E"
[ "$("${PSQL[@]}" -d "$BAZA_AUX" -Atc "SELECT has_function_privilege('livr_fara_ctrl', 'pg_catalog.pg_control_system()', 'EXECUTE')")" = f ] \
  || mediu "6.23: rolul de test are drept pe pg_control_system()"
livreaza "$MIGRARE" 20261003000000 "" "$LIVRARE" -- --user livr_fara_ctrl
[ $RC = 12 ] && grep -qF "nu are drept de apel pe pg_control_system()" "$ERR_R" && [ "$(inregistrata)" = 0 ] \
  || { cat "$ERR_R" >&2; esec "6.23 fără drept pe pg_control_system() ⇒ trebuia 12 explicit (cod $RC)"; }
nu_s_a_livrat "6.23 fără drept pg_control_system"
fara_urme "$SNAP_E" "6.23 fără drept pe pg_control_system() ⇒ NEPORNIT 12, mesaj explicit, fără urme" "$BAZA_AUX"
mutant_py fara_drept_ctrl "  IF NOT has_function_privilege('pg_catalog.pg_control_system()', 'EXECUTE') THEN" "  IF false THEN"
livreaza "$MIGRARE" 20261003000000 "" "$MUT/fara_drept_ctrl/livrare_migrare.sh" -- --user livr_fara_ctrl
grep -qF "nu are drept de apel pe pg_control_system()" "$ERR_R" && esec "6.23 mutant fără verificarea dreptului: NEPRINS"
ok6 "6.23 mutant fără verificarea dreptului pe pg_control_system() ⇒ prins (mesajul explicit lipsește, cod $RC)"
"${PSQL[@]}" -d postgres -c "DROP ROLE livr_fara_ctrl" >/dev/null 2>&1 || true
rm -f "$SNAP_E"

# 6.24 gate-ul permanent 0e (cerință Copilot PR #551 F2): după COMMIT, control_0e.sql read-only pe aceeași conexiune
aux_nou; livreaza "$MIGRARE" 20261003000000
[ $RC = 0 ] && grep -qF "GATE 0e: 0 funcții expuse" "$OUT_R" || { cat "$ERR_R" >&2; esec "6.24 fără gadget: trebuia 0 + GATE 0e curat (cod $RC)"; }
ok6 "6.24 fără gadget expus ⇒ APLICAT + GATE 0e curat, cod 0"
aux_nou
"${PSQL[@]}" -d "$BAZA_AUX" -c "CREATE FUNCTION public.gadget_0e(v text) RETURNS text LANGUAGE sql SECURITY INVOKER AS \$g\$ SELECT set_config('request.jwt.claims', v, true) \$g\$;
  REVOKE ALL ON FUNCTION public.gadget_0e(text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.gadget_0e(text) TO authenticated;" >/dev/null
livreaza "$MIGRARE" 20261003000000
[ $RC = 30 ] || { cat "$ERR_R" >&2; esec "6.24 gadget expus: cod $RC, așteptat 30"; }
grep -qF "GATE 0e: gadget(uri) expus(e): public.gadget_0e(text)" "$ERR_R" && grep -qF "livrarea NU e considerată încheiată" "$ERR_R" \
  || { cat "$ERR_R" >&2; esec "6.24 gadget expus: mesajul GATE 0e lipsește"; }
[ "$(inregistrata)" = 1 ] && [ "$(stare_patch)" = "$MD5_PATCH" ] || esec "6.24 gadget: migrarea trebuia să rămână comisă (gate de „livrat”, nu rollback)"
grep -qF "APLICAT + ÎNREGISTRAT confirmat" "$OUT_R" || esec "6.24 gadget: lipsește confirmarea aplicării înaintea gate-ului"
ok6 "6.24 gadget INVOKER expus (EXECUTE authenticated, set_config) ⇒ cod 30, mesaj GATE 0e, migrarea rămâne comisă (fără rollback)"

rm -f "$SNAP_E" "$ERR_R" "$OUT_R"

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
