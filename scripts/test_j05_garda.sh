#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Test PG16 LOCAL pentru garda J05 (supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql)
# și pentru rollback-ul ei tehnic (supabase/revenire/…_ROLLBACK.sql). Nu atinge Supabase / producția.
#   bash scripts/test_j05_garda.sh            # rulează tot și oprește clusterul la final
#   KEEP=1 bash scripts/test_j05_garda.sh     # lasă clusterul pornit (depanare)
#   VECHI=<dir> …                             # dir cu varianta anterioară (migrare + _ROLLBACK) → faza 8
# Cluster dedicat: PGDATA ${PGBASE:-/tmp/pg_j05garda}/data, doar 127.0.0.1:${PGPORT:-5481}, baza j05_garda_test.
#
# Faze (fiecare scenariu pe o bază NOUĂ: schelet cu definițiile live 30.09, md5 = live):
#   1. LIVE          fără patch: fiecare caz P/H TREBUIE să pice; R/A/D/L trec.
#   2. PATCH         migrarea × 2 → toate aserțiunile trec.
#   S. STATIC        migrarea fără BEGIN/COMMIT (runda 4); garda de livrare prima și ultima; postcondiția înainte.
#   3. LIVRARE       traseul EFECTIV (runda 4): scripts/livrare_migrare.sh = psql --single-transaction
#                    [marcaj + migrare + INSERT în supabase_migrations.schema_migrations]: aplicare; reluare după
#                    succes ⇒ refuz, fără dublare; eroare după PRIMA schimbare, în POSTCONDIȚIE și CHIAR la INSERT-ul
#                    înregistrării ⇒ stare inițială (pg_dump identic), neînregistrată; reluare permisă după eșec;
#                    fișierul rulat singur (psql -f, psql -c, -1 fără marcaj, marcaj de sesiune) ⇒ refuzat;
#                    fișier cu COMMIT ⇒ runnerul refuză; „END;” la nivel de instrucțiune ⇒ garda de final.
#   4. PRECONDIȚII   stări necunoscute / NULL / privilegii moștenite ⇒ migrarea refuză, fără urme.
#   5. ROLLBACK      o singură sesiune psql: armări vechi / de sesiune / persistente / după eșec ⇒ refuz;
#                    armat corect ⇒ schema = cea dinainte (pg_dump), dezarmat, gaura reapare; reluare = no-op.
#   6. REAPLICARE    migrare → rollback → migrare ⇒ toate aserțiunile trec.
#   7. MUTANȚI       fiecare protecție scoasă din fișierele noi (inclusiv garda de livrare și runnerul) ⇒ prinsă.
#   8. DISCRIMINARE  (opțional, VECHI=…) testele noi pică pe varianta anterioară acolo unde e slabă.
# Coduri: 0 = PASS · 1 = eșec · 2 = mediu
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT:-5481}"
BASE="${PGBASE:-/tmp/pg_j05garda}"
PGDATA_DIR="$BASE/data"
LOG="$BASE/server.log"
DB=j05_garda_test
MIG="$ROOT/supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql"
RB="$ROOT/supabase/revenire/20261001a_ofertare_derogare_garda_j05_ROLLBACK.sql"
TEST="$ROOT/supabase/tests/j05_garda.test.sql"
ARM="SELECT set_config('gazpet.rollback_20261001a', 'SCOATE_GARDA_J05:' || txid_current(), true);"
# Runda 4: gestionarul unic e scripts/livrare_migrare.sh; marcajul lui (aceeași tranzacție, legat de txid).
NUME_MIG="20261001a_ofertare_derogare_garda_j05"
LIV="${LIVRARE_FISIER:-$ROOT/scripts/livrare_migrare.sh}"
MARCAJ="SELECT set_config('gazpet.livrare_migrare', '$NUME_MIG:' || txid_current(), true);"

mediu() { printf '\nMEDIU: %s\n' "$*" >&2; exit 2; }
esec()  { printf '\n\033[31mEȘEC: %s\033[0m\n' "$*" >&2; exit 1; }
pas()   { printf '\n\033[1m── %s\033[0m\n' "$*"; }
ok()    { printf '  OK  %s\n' "$*"; VERIF=$((VERIF + 1)); }
VERIF=0

for f in "$MIG" "$RB" "$TEST" "$LIV"; do [ -f "$f" ] || mediu "lipsește $f"; done
[ -e "$ROOT/supabase/migrations/20261001a_ofertare_derogare_garda_j05_ROLLBACK.sql" ] && esec "rollback-ul nu are voie să stea în supabase/migrations (runnerul l-ar lua drept migrare)"
[ -x "$PGBIN/postgres" ] || mediu "PostgreSQL 16 lipsește în $PGBIN"
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] || mediu "PGPORT invalid: $PORT"
[[ "$BASE" == /* && "$BASE" != "/" ]] || mediu "PGBASE trebuie să fie cale absolută"
unset PGHOST PGHOSTADDR PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE PGOPTIONS PGSSLMODE PGDATA
export PGCONNECT_TIMEOUT=5 PGCLIENTENCODING=UTF8 PGAPPNAME=test_j05_garda

ca_pg() {  # initdb / pg_ctl refuză root
  if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi
}
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)

# ── Cluster dedicat ────────────────────────────────────────────────────────────
pas "Cluster PG16 dedicat pe 127.0.0.1:$PORT ($PGDATA_DIR)"
PORNIT_DE_NOI=0
if ! "$PGBIN/pg_isready" -q -h 127.0.0.1 -p "$PORT" -t 2; then
  if [ ! -f "$PGDATA_DIR/PG_VERSION" ]; then
    mkdir -p "$BASE"
    [ "$(id -u)" = 0 ] && chown postgres:postgres "$BASE"
    chmod 700 "$BASE"
    ca_pg "'$PGBIN/initdb' -D '$PGDATA_DIR' -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null" || mediu "initdb a eșuat"
  fi
  ca_pg "'$PGBIN/pg_ctl' -D '$PGDATA_DIR' -l '$LOG' -w -t 30 -o \"-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$BASE -c timezone=UTC\" start >/dev/null" \
    || mediu "pg_ctl start a eșuat (vezi $LOG)"
  PORNIT_DE_NOI=1
fi
oprire() { if [ "${KEEP:-0}" != 1 ] && [ "$PORNIT_DE_NOI" = 1 ]; then ca_pg "'$PGBIN/pg_ctl' -D '$PGDATA_DIR' -m fast -w stop >/dev/null" || true; fi; }
trap oprire EXIT
# Serverul de pe port TREBUIE să fie clusterul nostru — altfel refuz (nu dăm DROP DATABASE pe altceva).
DIR_SERVER="$("${PSQL[@]}" -d postgres -Atc 'SHOW data_directory')" || mediu "nu mă pot conecta la 127.0.0.1:$PORT"
[ "$(realpath "$DIR_SERVER")" = "$(realpath "$PGDATA_DIR")" ] || mediu "pe portul $PORT rulează alt cluster ($DIR_SERVER), nu $PGDATA_DIR"
[ "$("${PSQL[@]}" -d postgres -Atc "SELECT current_setting('server_version_num')::int / 10000")" = 16 ] || mediu "serverul nu e PostgreSQL 16"
mkdir -p "$BASE/iesiri"; [ "$(id -u)" = 0 ] && chown postgres:postgres "$BASE/iesiri" || true
OUT="$BASE/iesiri"
mkdir -p "$OUT/mut"

baza_noua() {
  # Rolurile sunt globale: anulăm orice urmă a scenariului „privilegiu moștenit” (dacă un mutant a comis-o).
  "${PSQL[@]}" -d postgres -c "SET client_min_messages = error" -c "ALTER ROLE anon NOINHERIT" -c "REVOKE service_role FROM anon" >/dev/null 2>&1 || true
  "${PSQL[@]}" -d postgres -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB" >/dev/null
  "${PSQL[@]}" -d "$DB" -o /dev/null -v faza=setup -f "$TEST" >"$OUT/setup.out" 2>&1 || { tail -20 "$OUT/setup.out" >&2; esec "setup (schelet live)"; }
  grep -q 'SETUP OK' "$OUT/setup.out" || esec "setup incomplet"
  # Tabela de înregistrare, cu coloanele reale din producție (information_schema, citit read-only 30.09).
  "${PSQL[@]}" -d "$DB" -c "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[])" >/dev/null
}
# Tranzacția runnerului de livrare, cu perturbare opțională în ACEEAȘI tranzacție (pentru precondiții / mutanți):
# psql --single-transaction [marcaj + perturbare + migrare + înregistrare]. Traseul real (scripts/livrare_migrare.sh)
# e testat separat în faza 3; aici e aceeași ordine, plus perturbarea.
INREG="INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261001000000', '$NUME_MIG');"
runner() {  # $1 = a (păstrat pentru compatibilitate), $2 = fișier migrare, [$3 = SQL de perturbare]
  local pert="${3:-}" f="$2"
  "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" --single-transaction \
    -c "$MARCAJ" ${pert:+-c "$pert"} -f "$f" -c "$INREG"
}
aplica_migrare() { runner a "$MIG" >"$OUT/mig.out" 2>&1 || { cat "$OUT/mig.out" >&2; esec "migrarea 20261001a"; }; "${PSQL[@]}" -d "$DB" -c "DELETE FROM supabase_migrations.schema_migrations" >/dev/null; }
inregistrata() { [ "$("${PSQL[@]}" -d "$DB" -Atc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name = '$NUME_MIG'")" != 0 ]; }
nr_inreg() { "${PSQL[@]}" -d "$DB" -Atc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name = '$NUME_MIG'"; }
teste() {  # $1 = live|patch, $2 = fișier de ieșire
  "${PSQL[@]}" -d "$DB" -o /dev/null -v faza="$1" -f "$TEST" >"$2" 2>&1 || { tail -20 "$2" >&2; esec "teste faza $1 (eroare de infrastructură)"; }
  grep -q 'TESTE_COMPLETE' "$2" || esec "testele faza $1 nu au rulat până la capăt"
  grep -o 'REZ|.*' "$2" > "$2.rez"
}
# Verifică tiparul așteptat al unei faze. live: fiecare caz P/H are ≥1 aserțiune picată; restul trec.
verifica() {  # $1 = live|patch, $2 = fișier .rez
  awk -F'|' -v faza="$1" '
    { grup = $4; sub(/\..*/, "", grup); n++; cat[grup] = $5
      if ($6 == "FAIL") { fail[grup]++; nf++ } else no++ }
    faza == "patch" && $6 != "OK"  { printf "  PICĂ PE PATCH: %s %s — %s\n", $4, $7, $8; rau++ }
    faza == "patch" && $5 == "L"   { printf "  aserțiune L în faza patch: %s\n", $4; rau++ }
    faza == "live"  && $5 == "K"   { printf "  aserțiune K în faza live: %s\n", $4; rau++ }
    faza == "live"  && $5 !~ /^[PH]$/ && $6 != "OK" { printf "  REGRESIE PE LIVE (cat %s): %s %s — %s\n", $5, $4, $7, $8; rau++ }
    END {
      if (faza == "live") for (g in cat) if (cat[g] ~ /^[PH]$/) { ng++; if (!fail[g]) { printf "  NU DISCRIMINEAZĂ (trece pe live): %s\n", g; rau++ } }
      printf "  %d aserțiuni: %d OK, %d picate", n, no, nf
      if (faza == "live") printf " (toate în cele %d cazuri P/H, cum trebuie)", ng
      printf "\n"
      exit (rau > 0)
    }' "$2"
}
fara_garda() {
  [ "$("${PSQL[@]}" -d "$DB" -Atc "SELECT (to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'a00_ofertare_derogare_garda_j05')
      AND NOT EXISTS (SELECT 1 FROM t.diferente_live()))::text")" = true ]
}
cu_garda() {
  [ "$("${PSQL[@]}" -d "$DB" -Atc "SELECT (SELECT md5(prosrc) = 'f84c9aeeb80fd990ee6f5110865a1aac' FROM pg_proc
      WHERE oid = to_regprocedure('public.fn_ofertare_derogare_garda_j05()'))
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'a00_ofertare_derogare_garda_j05' AND tgenabled = 'O')")" = t ]
}
schema_snapshot() {  # schema fără date, cu ACL-uri (prinde GRANT-uri / obiecte rămase după rollback)
  "$PGBIN/pg_dump" -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" --schema-only \
    | grep -vE '^(--|SET |SELECT pg_catalog\.set_config|\\(un)?restrict )' | sed '/^$/d'
}


# Mutanții de atomicitate: eroare după PRIMA schimbare (crearea funcției gărzii) și în POSTCONDIȚIE.
python3 - "$MIG" "$OUT/mut" <<'PY'
import sys
m = open(sys.argv[1], encoding='utf-8').read()
anc1 = "END $function$;\n"
assert m.count(anc1) == 1
open(sys.argv[2] + '/eroare_dupa_prima_schimbare.sql', 'w', encoding='utf-8').write(m.replace(anc1, anc1 + "SELECT 1/0;  -- MUTANT\n"))
post = m.index('DO $post$')
anc2 = "  EXECUTE v_q INTO r;\n"
i = m.index(anc2, post) + len(anc2)
open(sys.argv[2] + '/eroare_in_postconditie.sql', 'w', encoding='utf-8').write(m[:i] + "  PERFORM 1/0;  -- MUTANT\n" + m[i:])
PY

# ── S. STATIC ──────────────────────────────────────────────────────────────────
pas "S. Static: tranzacția o deține runnerul de livrare"
static_mig() {  # $1 = fișier → 0 dacă e conform
  ! sed 's/--.*$//' "$1" | grep -qiE '\b(COMMIT|ROLLBACK|ABORT|START\s+TRANSACTION|PREPARE\s+TRANSACTION)\b|\bBEGIN\s*(TRANSACTION|WORK)?\s*;' \
  && [ "$(grep -v '^--' "$1" | grep -v '^\s*$' | head -1)" = 'DO $livrare_start$' ] \
  && [ "$(grep -v '^\s*$' "$1" | tail -1)" = 'END $livrare_final$;' ] \
  && [ "$(grep -n -x 'END \$post\$;' "$1" | tail -1 | cut -d: -f1)" -lt "$(grep -n -x 'DO \$livrare_final\$' "$1" | cut -d: -f1)" ]
}
static_mig "$MIG" || esec "S: migrarea trebuie să fie fără BEGIN/COMMIT, cu garda de livrare prima și ultima și postcondiția înaintea gărzii de final"
ok "S migrarea: fără BEGIN/COMMIT (gestionar = runnerul), garda de livrare prima + ultima, postcondiția înainte de final"

# ── 1. LIVE ────────────────────────────────────────────────────────────────────
pas "1. LIVE (definițiile din 30.09, fără patch): cazurile P/H trebuie să pice"
baza_noua
ok "schelet = copia live ($(grep -o 'SETUP: [0-9]* obiecte cu md5 = live, [0-9]* ACL-uri' "$OUT/setup.out"))"
teste live "$OUT/live.out"
verifica live "$OUT/live.out.rez" || esec "tiparul fazei LIVE"
ok "faza LIVE: gaura J05 reprodusă, testele discriminează"

# ── 2. PATCH ───────────────────────────────────────────────────────────────────
pas "2. PATCH: migrare × 2 (idempotență) → toate aserțiunile trec"
baza_noua
aplica_migrare; cu_garda || esec "garda lipsește după prima aplicare"
aplica_migrare; cu_garda || esec "garda lipsește după reaplicare"
ok "migrarea aplicată de 2 ori (a doua = no-op)"
teste patch "$OUT/patch.out"
verifica patch "$OUT/patch.out.rez" || esec "faza PATCH"
ok "faza PATCH: toate aserțiunile trec"

# ── 3. LIVRARE ─────────────────────────────────────────────────────────────────
# Traseul EFECTIV (runda 4, verdict Copilot #538 r3): scripts/livrare_migrare.sh = gestionarul unic.
# faza_livrare MIG LIV — esec la prima abatere (folosită și de mutanții din faza 7, într-un subshell).
livreaza() {  # $1 = fișier (copiat sub numele real: runnerul derivă numele din fișier), $2 = versiune, $3 = runner
  mkdir -p "$OUT/livrare"; cp "$1" "$OUT/livrare/$NUME_MIG.sql"
  # Runner comun ed7ecb0 (GO Copilot R9): sha256 aprobat + țintă explicită (db, system_identifier, host, port).
  local sis; sis="$("$PGBIN/psql" -X -Atq -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -c "SELECT system_identifier FROM pg_control_system()")"
  set +e; PSQL_BIN="$PGBIN/psql" bash "${3:-$LIV}" --migrare "$OUT/livrare/$NUME_MIG.sql" \
    --sha256 "$(sha256sum "$OUT/livrare/$NUME_MIG.sql" | cut -d' ' -f1)" --versiune "$2" --tinta-db "$DB" --tinta-sistem "$sis" \
    --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >"$OUT/liv.out" 2>&1; RC=$?; set -e
}
psql_db() { set +e; "$PGBIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" "$@" >"$OUT/liv.out" 2>&1; RC=$?; set -e; }
INJ_REG="CREATE FUNCTION supabase_migrations.adv_injectie() RETURNS trigger LANGUAGE plpgsql AS \$i\$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.fn_ofertare_derogare_garda_j05()')) IS DISTINCT FROM 'f84c9aeeb80fd990ee6f5110865a1aac'
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'a00_ofertare_derogare_garda_j05') THEN
    RAISE EXCEPTION 'injecție: garda NU e instalată la momentul înregistrării';
  END IF;
  RAISE EXCEPTION 'EROARE INJECTATĂ la INSERT în schema_migrations (garda instalată, postcondiții trecute)';
END \$i\$;
CREATE TRIGGER adv_injectie BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION supabase_migrations.adv_injectie();"
refuz_fara_urme() {  # $1 = eticheta, $2 = fragment, $3 = snapshot, $4 = înregistrări așteptate
  [ $RC != 0 ] || esec "$1: trebuia să eșueze"
  grep -qF -- "$2" "$OUT/liv.out" || { cat "$OUT/liv.out" >&2; esec "$1: a eșuat din alt motiv (lipsește „$2”)"; }
  [ "$(nr_inreg)" = "$4" ] || esec "$1: înregistrări = $(nr_inreg), așteptat $4"
  schema_snapshot > "$OUT/snap_acum.sql"
  diff -u "$3" "$OUT/snap_acum.sql" > "$OUT/snap.diff" || { head -40 "$OUT/snap.diff" >&2; esec "$1: a rămas o urmă în schemă"; }
  ok "$1 → refuzat, pg_dump identic (funcții/triggere/ACL inițiale), înregistrări: $4"
}
faza_livrare() {
  local MIGF="$1" LIVF="$2" START="Livrare 20261001a: garda de livrare (start)"
  # 3.1 succes: garda + O înregistrare (version, name, statements = fișierul întreg)
  baza_noua; livreaza "$MIGF" 20261001000000 "$LIVF"
  [ $RC = 0 ] || { cat "$OUT/liv.out" >&2; esec "3.1 livrarea fără eroare"; }
  cu_garda && [ "$(nr_inreg)" = 1 ] || esec "3.1 garda / înregistrarea lipsesc"
  [ "$("${PSQL[@]}" -d "$DB" -Atc "SELECT version FROM supabase_migrations.schema_migrations")" = 20261001000000 ] || esec "3.1 versiunea"
  "${PSQL[@]}" -d "$DB" -Atc "SELECT statements[1] FROM supabase_migrations.schema_migrations" | cmp -s - <(cat "$MIGF"; echo) || esec "3.1 statements[1] ≠ fișierul"
  ok "3.1 livrare: garda aplicată + înregistrată o dată (version, name $NUME_MIG, statements = fișierul octet cu octet)"
  # 3.2 reluare după succes ⇒ refuz, anulat tot, fără dublare
  schema_snapshot > "$OUT/snap_e.sql"; livreaza "$MIGF" 20261001000001 "$LIVF"
  refuz_fara_urme "3.2 reluare după succes" "CONFLICT: istoricul are 1 rând" "$OUT/snap_e.sql" 1
  # 3.3 erori injectate
  for mut in eroare_dupa_prima_schimbare eroare_in_postconditie; do
    baza_noua; schema_snapshot > "$OUT/snap_e.sql"; livreaza "$OUT/mut/$mut.sql" 20261001000000 "$LIVF"
    refuz_fara_urme "3.3 $mut" "division by zero" "$OUT/snap_e.sql" 0
    fara_garda || esec "3.3 $mut: a rămas ceva din migrare"
  done
  baza_noua; "${PSQL[@]}" -d "$DB" -c "$INJ_REG" >/dev/null; schema_snapshot > "$OUT/snap_e.sql"
  livreaza "$MIGF" 20261001000000 "$LIVF"
  refuz_fara_urme "3.3 eroare CHIAR la INSERT-ul în schema_migrations, după postcondiții și garda de final" \
    "EROARE INJECTATĂ la INSERT în schema_migrations (garda instalată, postcondiții trecute)" "$OUT/snap_e.sql" 0
  fara_garda || esec "3.3 eroare la înregistrare: garda a rămas"
  # 3.4 reluarea PERMISĂ după eșec
  "${PSQL[@]}" -d "$DB" -c "DROP TRIGGER adv_injectie ON supabase_migrations.schema_migrations; DROP FUNCTION supabase_migrations.adv_injectie();" >/dev/null
  livreaza "$MIGF" 20261001000002 "$LIVF"
  [ $RC = 0 ] && cu_garda && [ "$(nr_inreg)" = 1 ] || { cat "$OUT/liv.out" >&2; esec "3.4 reluarea permisă după eșec"; }
  ok "3.4 reluare permisă după înregistrarea eșuată: garda + exact o înregistrare"
  # 3.5 fișierul rulat SINGUR ⇒ garda de livrare (start) refuză
  baza_noua; schema_snapshot > "$OUT/snap_e.sql"
  psql_db -v ON_ERROR_STOP=1 -f "$MIGF";                      refuz_fara_urme "3.5 psql -f simplu (autocommit)" "$START" "$OUT/snap_e.sql" 0
  psql_db -c "$(cat "$MIGF")";                                refuz_fara_urme "3.5 un singur query (psql -c, ca execute_sql)" "$START" "$OUT/snap_e.sql" 0
  psql_db -v ON_ERROR_STOP=1 --single-transaction -f "$MIGF"; refuz_fara_urme "3.5 --single-transaction fără marcaj" "$START" "$OUT/snap_e.sql" 0
  psql_db -v ON_ERROR_STOP=1 -c "SELECT set_config('gazpet.livrare_migrare', '$NUME_MIG:' || txid_current(), false)" -f "$MIGF"
  refuz_fara_urme "3.5 marcaj de SESIUNE dintr-o tranzacție anterioară + psql -f" "$START" "$OUT/snap_e.sql" 0
  psql_db -v ON_ERROR_STOP=1 -c "SET gazpet.livrare_migrare = '$NUME_MIG'" -f "$MIGF"
  refuz_fara_urme "3.5 marcaj de sesiune fără txid" "$START" "$OUT/snap_e.sql" 0
  # 3.6 control de tranzacție în fișier
  awk '{print} !d && /^END \$function\$;$/ {print "COMMIT;  -- MUTANT"; d=1}' "$MIGF" > "$OUT/mut/liv_commit.sql"
  livreaza "$OUT/mut/liv_commit.sql" 20261001000000 "$LIVF"; refuz_fara_urme "3.6 fișier cu COMMIT; (runnerul refuză)" "control de tranzacție la nivel superior" "$OUT/snap_e.sql" 0
  awk '{print} !d && /^END \$function\$;$/ {print "select 1; commit ;  -- MUTANT"; d=1}' "$MIGF" > "$OUT/mut/liv_commit2.sql"
  livreaza "$OUT/mut/liv_commit2.sql" 20261001000000 "$LIVF"; refuz_fara_urme "3.6 „select 1; commit ;” pe aceeași linie" "control de tranzacție la nivel superior" "$OUT/snap_e.sql" 0
  awk '{print} !d && /^END \$function\$;$/ {print "END;  -- MUTANT (sinonim COMMIT)"; d=1}' "$MIGF" > "$OUT/mut/liv_end.sql"
  livreaza "$OUT/mut/liv_end.sql" 20261001000000 "$LIVF"
  # Runner comun ed7ecb0: validatorul refuză END la nivel superior ÎNAINTE de conexiune (exit 3) — mai strict decât garda de final.
  [ $RC = 3 ] && grep -qF "control de tranzacție la nivel superior" "$OUT/liv.out" && [ "$(nr_inreg)" = 0 ] \
    || { cat "$OUT/liv.out" >&2; esec "3.6 „END;”: validatorul nu l-a refuzat"; }
  ok "3.6 „END;” la nivel de instrucțiune: refuzat de validator înainte de conexiune (exit 3), NEÎNREGISTRAT"
}
pas "3. Traseul de livrare: scripts/livrare_migrare.sh (marcaj + migrare + înregistrare într-o singură tranzacție)"
faza_livrare "$MIG" "$LIV"

# ── 4. PRECONDIȚII ─────────────────────────────────────────────────────────────
pas "4. Precondiții: stare necunoscută / NULL / privilegii ⇒ refuz, fără urme (perturbare + migrare într-o tranzacție)"
negativ() {  # $1 = fișierul migrării, $2 = SQL de perturbare, $3 = fragment așteptat, $4 = descriere  → 0 = refuzat curat
  baza_noua
  if runner a "$1" "$2" >"$OUT/pre.out" 2>&1; then return 1; fi
  grep -qF "$3" "$OUT/pre.out" || { echo "  (refuz cu alt mesaj decât „$3” pentru: $4)" >&2; return 2; }
  fara_garda || esec "a rămas ceva după refuz: $4"
  inregistrata && esec "migrare înregistrată după refuz: $4"
  return 0
}
CAZURI_PRE=(
  "ALTER FUNCTION public.fn_gate_depunere() COST 101|Precondiție 20261001a: funcțiile|poarta cu alt atribut (COST)"
  "CREATE OR REPLACE FUNCTION public.fn_gate_depunere_derogare_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS \$f\$ SELECT true \$f\$|Precondiție 20261001a: funcțiile|helperul owner cu alt corp (prosrc)"
  "ALTER FUNCTION public.fn_gate_depunere() OWNER TO supabase_admin|Precondiție 20261001a: funcțiile|poarta cu alt proprietar"
  "GRANT EXECUTE ON FUNCTION public.fn_gate_depunere() TO anon|Precondiție 20261001a: funcțiile|poarta cu ACL lărgit (anon)"
  "ALTER FUNCTION public.ofertare_derogare_depunere(bigint,text,boolean) SECURITY INVOKER|Precondiție 20261001a: funcțiile|RPC-ul fără SECURITY DEFINER"
  "ALTER FUNCTION public.fn_are_acces_ofertare() RESET search_path|Precondiție 20261001a: funcțiile|acces fără search_path fixat"
  "ALTER FUNCTION public.fn_gate_depunere_derogare_owner() RENAME TO fn_x_j05|Precondiție 20261001a: funcțiile|funcție lipsă (amprentă NULL)"
  "CREATE FUNCTION public.fn_gate_depunere_derogare_owner(int) RETURNS boolean LANGUAGE sql AS 'SELECT true'|Precondiție 20261001a: funcțiile|supraîncărcare nouă a helperului"
  "CREATE TRIGGER zz_j05_extra BEFORE UPDATE ON public.ofertare_licitatii FOR EACH ROW EXECUTE FUNCTION public.fn_gate_depunere()|nici live 30.09, nici patch|un trigger nou"
  "DROP TRIGGER a00_ofertare_licitatii_scriere ON public.ofertare_licitatii; DROP TRIGGER trg_gate_depunere ON public.ofertare_licitatii|nici live 30.09, nici patch|niciun trigger (amprentă NULL)"
  "ALTER TABLE public.ofertare_licitatii DISABLE TRIGGER a00_ofertare_licitatii_scriere|nici live 30.09, nici patch|a00 dezactivat"
  "DROP TRIGGER trg_gate_depunere ON public.ofertare_licitatii; CREATE TRIGGER trg_gate_depunere BEFORE INSERT OR UPDATE ON public.ofertare_licitatii FOR EACH ROW WHEN (true) EXECUTE FUNCTION public.fn_gate_depunere()|nici live 30.09, nici patch|poarta cu clauză WHEN"
  "ALTER TABLE public.ofertare_derogari_audit DISABLE TRIGGER trg_ofertare_derogari_audit_imuabil|auditul|auditul fără append-only"
  "ALTER TABLE public.ofertare_derogari_audit DROP CONSTRAINT ofertare_derogari_audit_actiune_check|auditul|CHECK-ul auditului lipsă (amprentă NULL)"
  "ALTER TABLE public.ofertare_derogari_audit DROP CONSTRAINT ofertare_derogari_audit_actiune_check, ADD CONSTRAINT ofertare_derogari_audit_actiune_check CHECK (actiune IN ('derogare_acordata','derogare_retrasa','depusa_pe_derogare','motiv_modificat'))|auditul|CHECK-ul auditului extins"
  "CREATE FUNCTION public.fn_ofertare_derogare_garda_j05() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$BEGIN RETURN NEW; END\$f\$; REVOKE ALL ON FUNCTION public.fn_ofertare_derogare_garda_j05() FROM PUBLIC|nici live 30.09, nici patch|altă versiune a gărzii"
  "@GARDA_FARA_TRIGGER|nici live 30.09, nici patch|stare mixtă: funcția gărzii (patch) fără trigger"
  "ALTER ROLE anon INHERIT; GRANT service_role TO anon|Postcondiție 20261001a: o funcție de trigger|privilegiu MOȘTENIT: anon ajunge să execute poarta"
  "CREATE FUNCTION public.fn_ofertare_derogare_garda_j05() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$BEGIN RETURN NEW; END\$f\$; REVOKE ALL ON FUNCTION public.fn_ofertare_derogare_garda_j05() FROM PUBLIC; CREATE TRIGGER a00_ofertare_derogare_garda_j05 BEFORE UPDATE ON public.ofertare_licitatii FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_derogare_garda_j05()|nici live 30.09, nici patch|altă versiune a gărzii, cu trigger"
)
extinde_pert() {  # @GARDA_FARA_TRIGGER = aplică funcția gărzii exact ca în patch, fără trigger
  if [ "$1" = "@GARDA_FARA_TRIGGER" ]; then
    awk '/^CREATE OR REPLACE FUNCTION public.fn_ofertare_derogare_garda_j05/,/^END \$function\$;/' "$MIG"
    echo "REVOKE ALL ON FUNCTION public.fn_ofertare_derogare_garda_j05() FROM PUBLIC, anon, authenticated, service_role;"
  else printf '%s' "$1"; fi
}
for c in "${CAZURI_PRE[@]}"; do
  IFS='|' read -r pert frag desc <<<"$c"
  negativ "$MIG" "$(extinde_pert "$pert")" "$frag" "$desc" || { cat "$OUT/pre.out" >&2; esec "precondiția nu a refuzat corect: $desc"; }
  ok "$desc → refuz, nimic aplicat"
done

# ── 5. ROLLBACK ────────────────────────────────────────────────────────────────
pas "5. ROLLBACK (supabase/revenire): armare legată de txid, testată într-o singură sesiune psql"
sesiune_rollback() {  # $1 = fișierul rollback  → scrie $OUT/rb_sesiune.out
  cat > "$OUT/rb_sesiune.sql" <<SQL
\set ON_ERROR_STOP 0
\set QUIET 1
\pset tuples_only on
\echo PAS R4 armare persistentă (pg_db_role_setting, nume cu majuscule, înainte ca GUC-ul să existe în sesiune) + armare corectă
ALTER ROLE postgres IN DATABASE $DB SET "GAZPET.Rollback_20261001a" = 'x';
BEGIN;
$ARM
\i $1
COMMIT;
SELECT 'STARE|R4|' || (to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NOT NULL);
ALTER ROLE postgres IN DATABASE $DB RESET ALL;
\echo PAS R1 nearmat
BEGIN;
\i $1
COMMIT;
SELECT 'STARE|R1|' || (to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NOT NULL);
\echo PAS R2 SET de sesiune cu valoarea veche
SET gazpet.rollback_20261001a = 'SCOATE_GARDA_J05';
BEGIN;
\i $1
COMMIT;
SELECT 'STARE|R2|' || (to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NOT NULL);
RESET gazpet.rollback_20261001a;
\echo PAS R3 set_config de sesiune dintr-o tranzacție anterioară
SELECT set_config('gazpet.rollback_20261001a', 'SCOATE_GARDA_J05:' || txid_current(), false);
BEGIN;
\i $1
COMMIT;
SELECT 'STARE|R3|' || (to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NOT NULL);
RESET gazpet.rollback_20261001a;
\echo PAS R5 armare + eroare + rollback, apoi reluare fără armare nouă
BEGIN;
$ARM
\i $1
SELECT 1/0;
COMMIT;
SELECT 'STARE|R5a|' || (to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NOT NULL);
BEGIN;
\i $1
COMMIT;
SELECT 'STARE|R5b|' || (to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NOT NULL);
\echo PAS R6 armat corect
BEGIN;
$ARM
\i $1
SELECT 'DEZARMAT|' || (coalesce(current_setting('gazpet.rollback_20261001a', true), '') = '');
COMMIT;
SELECT 'STARE|R6|' || (to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NOT NULL);
\echo PAS R7 a doua rulare armată
BEGIN;
$ARM
\i $1
COMMIT;
SELECT 'STARE|R7|' || (to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NOT NULL);
SQL
  "$PGBIN/psql" -X -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -f "$OUT/rb_sesiune.sql" >"$OUT/rb_sesiune.out" 2>&1 || true
}
stare_rb() { grep -o "STARE|$1|[a-z]*" "$OUT/rb_sesiune.out" | cut -d'|' -f3; }
verif_rollback() {  # → 0 dacă toate așteptările sunt îndeplinite; afișează ce pică
  local r=0
  for p in R1 R2 R3 R4 R5a R5b; do [ "$(stare_rb $p)" = true ] || { echo "  rollback: pasul $p a scos garda (trebuia refuz)"; r=1; }; done
  for p in R6 R7; do [ "$(stare_rb $p)" = false ] || { echo "  rollback: pasul $p nu a scos garda"; r=1; }; done
  grep -q 'DEZARMAT|true' "$OUT/rb_sesiune.out" || { echo "  rollback: comutatorul nu e dezarmat după aplicare"; r=1; }
  [ "$(grep -c 'nearmat în tranzacția curentă' "$OUT/rb_sesiune.out")" -ge 4 ] || { echo "  rollback: refuzurile de armare (R1/R2/R3/R5b) lipsesc"; r=1; }
  grep -q 'armat PERSISTENT' "$OUT/rb_sesiune.out" || { echo "  rollback: refuzul armării persistente lipsește"; r=1; }
  grep -q 'nimic de retras' "$OUT/rb_sesiune.out" || { echo "  rollback: a doua rulare nu e no-op"; r=1; }
  return $r
}
baza_noua
SNAP_INAINTE="$OUT/schema_inainte.sql"; schema_snapshot > "$SNAP_INAINTE"
aplica_migrare
sesiune_rollback "$RB"
verif_rollback || { cat "$OUT/rb_sesiune.out" >&2; esec "rollback-ul"; }
ok "R1 nearmat, R2 SET de sesiune vechi, R3 set_config de sesiune, R4 armare persistentă, R5 reluare după eșec → refuz; R6 armat → aplicat și dezarmat; R7 → no-op"
fara_garda || esec "după rollback: definițiile live s-au schimbat"
schema_snapshot > "$OUT/schema_dupa.sql"
diff -u "$SNAP_INAINTE" "$OUT/schema_dupa.sql" > "$OUT/schema.diff" || { head -40 "$OUT/schema.diff" >&2; esec "schema după rollback ≠ schema dinainte"; }
ok "pg_dump --schema-only după rollback = identic cu cel dinainte de migrare"
teste live "$OUT/live_dupa_rb.out"
verifica live "$OUT/live_dupa_rb.out.rez" || esec "tiparul LIVE după rollback"
ok "după rollback: gaura J05 reapare exact ca pe live"
baza_noua; aplica_migrare
"$PGBIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -c "BEGIN; CREATE OR REPLACE FUNCTION public.fn_ofertare_derogare_garda_j05() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$\$BEGIN RETURN NEW; END\$\$; $ARM $(cat "$RB") COMMIT;" >"$OUT/rb.out" 2>&1 || true
grep -q 'nu sunt exact versiunea patch-ului' "$OUT/rb.out" || { cat "$OUT/rb.out" >&2; esec "rollback-ul pe o gardă modificată"; }
cu_garda || esec "garda patch-ului nu mai e intactă după refuzul rollback-ului"
ok "rollback armat pe o gardă modificată → refuz (amprentă), nimic schimbat"

# ── 6. REAPLICARE ──────────────────────────────────────────────────────────────
pas "6. Reaplicare după rollback → toate aserțiunile trec"
baza_noua; aplica_migrare
"$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -c "BEGIN; $ARM $(cat "$RB") COMMIT;" >"$OUT/rb.out" 2>&1 || { cat "$OUT/rb.out" >&2; esec "rollback (faza 6)"; }
fara_garda || esec "rollback incomplet (faza 6)"
aplica_migrare; cu_garda || esec "garda lipsește după reaplicare"
teste patch "$OUT/patch_reaplicat.out"
verifica patch "$OUT/patch_reaplicat.out.rez" || esec "faza PATCH după reaplicare"
ok "migrare → rollback → migrare: toate aserțiunile trec"

# ── 7. MUTANȚI ─────────────────────────────────────────────────────────────────
pas "7. Mutanți: fiecare protecție scoasă din fișierele noi trebuie prinsă"
mutant() {  # $1 = sursă, $2 = destinație, $3 = text vechi, $4 = text nou (trebuie să existe exact o dată)
  python3 - "$1" "$2" "$3" "$4" ${5:-} <<'PY'
import sys
s = open(sys.argv[1], encoding='utf-8').read()
n = s.count(sys.argv[3])
assert n == 1 or (len(sys.argv) > 5 and n >= 1), 'ancoră mutant: ' + sys.argv[3][:60]
open(sys.argv[2], 'w', encoding='utf-8').write(s.replace(sys.argv[3], sys.argv[4]))
PY
}
prins_migrare() {  # $1 = mutant, $2 = caz de precondiție (index în CAZURI_PRE), $3 = descriere
  IFS='|' read -r pert frag desc <<<"${CAZURI_PRE[$2]}"
  if negativ "$1" "$(extinde_pert "$pert")" "$frag" "$desc" 2>/dev/null; then esec "mutantul NU e prins: $3"; fi
  ok "mutant prins: $3 (cazul „$desc” nu mai e refuzat)"
}
M="$OUT/mut"
mutant "$MIG" "$M/fara_nullsafe_check.sql" "     OR r.chk IS DISTINCT FROM 'c|{3}|ccb3f643d993ae9d68284aca20a58366'
     OR r.coloane" "     OR r.chk <> 'c|{3}|ccb3f643d993ae9d68284aca20a58366'
     OR r.coloane"
prins_migrare "$M/fara_nullsafe_check.sql" 13 "comparație CHECK ne-NULL-safe (<>)"
mutant "$MIG" "$M/fara_nullsafe_trg.sql" "  IF NOT ((NOT v_garda_exista AND r.trg_licitatii IS NOT DISTINCT FROM" "  IF NOT ((NOT v_garda_exista AND r.trg_licitatii =" 
prins_migrare "$M/fara_nullsafe_trg.sql" 9 "comparație triggere ne-NULL-safe (=)"
mutant "$MIG" "$M/fara_amprente_functii.sql" "  IF (r.fn_ok ->> 'gate') IS DISTINCT FROM 'true' OR" "  IF false AND (r.fn_ok ->> 'gate') IS DISTINCT FROM 'true' OR"
prins_migrare "$M/fara_amprente_functii.sql" 2 "fără verificarea amprentelor funcțiilor"
mutant "$MIG" "$M/fara_proprietar.sql" "format('src=%s secdef=%s cfg=%s owner=%s lang=%s" "format('src=%s secdef=%s cfg=%s owner=postgres%.0s lang=%s" toate
prins_migrare "$M/fara_proprietar.sql" 2 "amprenta fără proprietar"
python3 - "$MIG" "$M/fara_acl.sql" <<'PY2'
import sys, re
s = open(sys.argv[1], encoding='utf-8').read()
assert s.count("rez=%s acl=%s',") == 2
s = s.replace("rez=%s acl=%s',", "rez=%s%.0s',")
s = re.sub(r" acl=\{[^}]*\}'\)", "')", s)
open(sys.argv[2], 'w', encoding='utf-8').write(s)
PY2
prins_migrare "$M/fara_acl.sql" 3 "amprenta fără ACL"
mutant "$MIG" "$M/fara_stare_mixta.sql" "       OR (v_garda_exista AND (r.fn_ok ->> 'garda') IS NOT DISTINCT FROM 'true'" "       OR (v_garda_exista"
prins_migrare "$M/fara_stare_mixta.sql" 18 "fără verificarea versiunii gărzii existente"
mutant "$MIG" "$M/fara_privilegii.sql" "             WHERE has_function_privilege(ro.rol, f.sig, 'EXECUTE') IS DISTINCT FROM false) THEN" "             WHERE false) THEN"
prins_migrare "$M/fara_privilegii.sql" 17 "postcondiție fără privilegiile efective"
mutant "$MIG" "$M/fara_post_corp.sql" "  IF OLD.status = 'depusa' THEN" "  IF false THEN"
baza_noua
if runner a "$M/fara_post_corp.sql" >"$OUT/mut.out" 2>&1; then esec "mutant NU prins: corpul gărzii schimbat (înghețul scos) fără actualizarea amprentei"; fi
grep -q 'Postcondiție 20261001a: starea rezultată' "$OUT/mut.out" || { cat "$OUT/mut.out" >&2; esec "corp schimbat: refuzul nu vine din postcondiție"; }
fara_garda || esec "corp schimbat: au rămas urme"
ok "mutant prins: corpul gărzii schimbat (înghețul scos) → postcondiția refuză înainte de COMMIT"
mutant "$M/fara_post_corp.sql" "$M/fara_post_si_corp.sql" "     OR r.trg_licitatii IS DISTINCT FROM 'a00_ofertare_derogare_garda_j05" "     OR false AND r.trg_licitatii IS DISTINCT FROM 'a00_ofertare_derogare_garda_j05"
python3 - "$M/fara_post_si_corp.sql" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
a = "  IF (SELECT bool_and(v::boolean) FROM jsonb_each_text(r.fn_ok) AS e(k, v)) IS DISTINCT FROM true"
assert s.count(a) == 1
open(p, 'w', encoding='utf-8').write(s.replace(a, "  IF false AND (SELECT bool_and(v::boolean) FROM jsonb_each_text(r.fn_ok) AS e(k, v)) IS DISTINCT FROM true"))
PY
baza_noua
runner a "$M/fara_post_si_corp.sql" >"$OUT/mut.out" 2>&1 || { cat "$OUT/mut.out" >&2; esec "mutantul fără postcondiție ar fi trebuit să se aplice"; }
cu_garda && esec "mutant NU prins: postcondiția scoasă + corp schimbat"
ok "mutant prins: postcondiția de amprentă scoasă → corpul greșit ajunge aplicat, iar harness-ul (amprenta patch-ului) îl respinge"
mutant "$MIG" "$M/fara_revoke.sql" "REVOKE ALL ON FUNCTION public.fn_ofertare_derogare_garda_j05() FROM PUBLIC, anon, authenticated, service_role;" "-- REVOKE scos (MUTANT)"
baza_noua
if runner a "$M/fara_revoke.sql" >"$OUT/mut.out" 2>&1; then esec "mutant NU prins: REVOKE scos"; fi
grep -q 'Postcondiție 20261001a' "$OUT/mut.out" && fara_garda || { cat "$OUT/mut.out" >&2; esec "REVOKE scos: postcondiția nu a refuzat curat"; }
ok "mutant prins: REVOKE scos → postcondiția (ACL / privilegii) refuză înainte de COMMIT"
# Garda de livrare și runnerul (runda 4): fiecare mutant trebuie să pice static_mig sau faza de livrare.
livrare_mutant() {  # $1 = migrare, $2 = runner, $3 = descriere
  local st="static OK" fz
  static_mig "$1" || st="static PICĂ"
  local lo="$OUT/livm_$(basename "$2" .sh)_$(basename "$1" .sql).out"
  if ( faza_livrare "$1" "$2" ) >"$lo" 2>&1; then fz="faza 3 trece"; else fz="$(grep -m1 -o 'EȘEC: [^[]*' "$lo" | cut -c1-110)"; fi
  [ "$st" = "static OK" ] && [ "$fz" = "faza 3 trece" ] && esec "mutant livrare NU prins: $3"
  ok "mutant livrare prins: $3 ($st; $fz)"
}
# Validatorul e apelat relativ la runner ⇒ copie identică lângă mutanți (altfel „prinși” fals, la validator lipsă).
cp "$(dirname "$LIV")/livrare_validator.py" "$M/livrare_validator.py"
python3 - "$MIG" "$LIV" "$M" <<'PY'
import sys
m = open(sys.argv[1], encoding='utf-8').read(); l = open(sys.argv[2], encoding='utf-8').read(); d = sys.argv[3]
def bloc(tag):
    a = m.index(f"DO ${tag}$"); b = m.index(f"END ${tag}$;") + len(f"END ${tag}$;"); return a, b
a, b = bloc('livrare_start'); open(d + '/n_fara_start.sql', 'w').write(m[:a] + m[b:])
a, b = bloc('livrare_final'); open(d + '/n_fara_final.sql', 'w').write(m[:a] + m[b:])
x = m.replace("IS DISTINCT FROM '20261001a_ofertare_derogare_garda_j05:' || txid_current()", "IS NULL"); assert x.count('IS NULL') >= 2
open(d + '/n_fara_txid.sql', 'w').write(x)
# Runner comun ed7ecb0: mutanții w_* sunt generați pe textul runnerului ACTUAL (maparea: J05_GARDA_PATCH.md).
run = '"$PSQL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$DIR/0_prolog.sql" -f "$DIR/1_pre.sql" -f "$COPIE" -f "$DIR/3_inreg.sql" "${CONN[@]}"'
assert l.count(run) == 1
def scrie(nume, txt):
    assert txt != l, nume; open(d + '/' + nume, 'w').write(txt)
# 1. înregistrarea într-o tranzacție separată de migrare (atomicitate migrare+înregistrare)
scrie('w_inreg_separata.sh', l.replace(run, run.replace(' -f "$DIR/3_inreg.sql"', '') + '\n' +
      run.replace(' -f "$COPIE"', '')))
# 2. fără gestionarul unic de tranzacție (autocommit per instrucțiune)
scrie('w_fara_single.sh', l.replace(run, run.replace(' --single-transaction', '')))
# 3. fără refuzul „deja înregistrată”: ambele straturi — pre-verificarea (exit 11/21) și verificarea din 1_pre
x = l
for f in ('if [ "$R_REL" = 1 ] && [ "$R_EX" = 1 ]; then\n  echo "✓ DEJA', 'if [ "$R_REL" != 0 ]; then\n  echo "✗ CONFLICT: istoricul'):
    a = x.index(f); b = x.index('\nfi\n', a) + 4; x = x[:a] + x[b:]
for f in ("  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '$NUME')",
          "  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '$VERSIUNE')"):
    a = x.index(f); b = x.index('END IF;\n', a) + 8; x = x[:a] + x[b:]
scrie('w_fara_deja.sh', x)
# 4. fără refuzul controlului de tranzacție: în ed7ecb0 îl face validatorul ⇒ runnerul nu-l mai apelează
v = 'VAL_OUT="$(python3 "$(dirname "${BASH_SOURCE[0]}")/livrare_validator.py" "$COPIE" "$TAG")" || refuz 3 "validatorul a refuzat $NUME (vezi mai sus)"'
assert l.count(v) == 1
scrie('w_fara_static.sh', l.replace(v, 'VAL_OUT="validator omis (MUTANT)"'))
PY
livrare_mutant "$M/n_fara_start.sql" "$LIV" "migrare fără garda de livrare de start"
livrare_mutant "$M/n_fara_final.sql" "$LIV" "migrare fără garda de livrare de final"
livrare_mutant "$M/n_fara_txid.sql" "$LIV" "garda de livrare nelegată de txid (orice marcaj)"
livrare_mutant "$MIG" "$M/w_inreg_separata.sh" "runner: înregistrarea într-o tranzacție separată"
livrare_mutant "$MIG" "$M/w_fara_single.sh" "runner: fără --single-transaction"
livrare_mutant "$MIG" "$M/w_fara_deja.sh" "runner: fără refuzul „deja înregistrată”"
livrare_mutant "$MIG" "$M/w_fara_static.sh" "runner: fără refuzul controlului de tranzacție"
# Rollback
rb_mutant() {  # $1 = mutant, $2 = descriere
  baza_noua; aplica_migrare
  sesiune_rollback "$1"
  if verif_rollback >/dev/null; then esec "mutant rollback NU prins: $2"; fi
  ok "mutant rollback prins: $2"
}
mutant "$RB" "$M/rb_fara_txid.sql" "  IF current_setting('gazpet.rollback_20261001a', true) IS DISTINCT FROM ('SCOATE_GARDA_J05:' || txid_current()::text) THEN" "  IF current_setting('gazpet.rollback_20261001a', true) NOT LIKE 'SCOATE_GARDA_J05%' THEN"
rb_mutant "$M/rb_fara_txid.sql" "armare nelegată de txid (orice valoare cu prefixul corect)"
mutant "$RB" "$M/rb_fara_persistenta.sql" "              WHERE lower(split_part(c.cfg, '=', 1)) = 'gazpet.rollback_20261001a') THEN" "              WHERE false) THEN"
rb_mutant "$M/rb_fara_persistenta.sql" "fără refuzul armării persistente"
mutant "$RB" "$M/rb_fara_lower.sql" "              WHERE lower(split_part(c.cfg, '=', 1)) = 'gazpet.rollback_20261001a') THEN" "              WHERE split_part(c.cfg, '=', 1) = 'gazpet.rollback_20261001a') THEN"
rb_mutant "$M/rb_fara_lower.sql" "armarea persistentă comparată fără lower()"
mutant "$RB" "$M/rb_fara_dezarmare.sql" "  -- 5. Dezarmare (și varianta de sesiune).
  PERFORM set_config('gazpet.rollback_20261001a', '', false);" "  -- 5. Dezarmare scoasă (MUTANT)"
rb_mutant "$M/rb_fara_dezarmare.sql" "fără dezarmare la final"
mutant "$RB" "$M/rb_fara_amprenta.sql" "  IF NOT (v_garda_exista AND (r.fn_ok ->> 'garda') IS NOT DISTINCT FROM 'true'" "  IF NOT (v_garda_exista"
baza_noua; aplica_migrare
"$PGBIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -c "BEGIN; CREATE OR REPLACE FUNCTION public.fn_ofertare_derogare_garda_j05() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$\$BEGIN RETURN NEW; END\$\$; $ARM $(cat "$M/rb_fara_amprenta.sql") COMMIT;" >"$OUT/rb.out" 2>&1 || true
[ "$("${PSQL[@]}" -d "$DB" -Atc "SELECT to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NULL")" = t ] || esec "mutant rollback NU prins: fără amprenta gărzii"
ok "mutant rollback prins: fără verificarea amprentei, o gardă modificată ar fi fost scoasă"

# ── 8. DISCRIMINARE pe varianta anterioară ──────────────────────────────────────
if [ -n "${VECHI:-}" ]; then
  pas "8. Discriminare: testele noi pe varianta anterioară ($VECHI)"
  VMIG="$VECHI/20261001a_ofertare_derogare_garda_j05.sql"; VRB="$VECHI/20261001a_ofertare_derogare_garda_j05_ROLLBACK.sql"
  NDISC=0
  for i in "${!CAZURI_PRE[@]}"; do
    IFS='|' read -r pert frag desc <<<"${CAZURI_PRE[$i]}"
    baza_noua
    if runner a "$VMIG" "$(extinde_pert "$pert")" >"$OUT/v.out" 2>&1; then
      echo "  varianta veche TRECE peste: $desc  (noua refuză)"; NDISC=$((NDISC + 1))
    fi
  done
  baza_noua
  "$PGBIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -f "$VMIG" >/dev/null 2>&1 || esec "varianta veche nu se aplică"
  "$PGBIN/psql" -X -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -c "SET gazpet.rollback_20261001a = 'SCOATE_GARDA_J05'" -c "BEGIN" -f "$VRB" -c "COMMIT" >"$OUT/v.out" 2>&1 || true
  if [ "$("${PSQL[@]}" -d "$DB" -Atc "SELECT to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NULL")" = t ]; then
    echo "  rollback-ul vechi ACCEPTĂ o armare de sesiune rămasă (SET fără tranzacție nouă) — cel nou refuză (R2)"; NDISC=$((NDISC + 1))
  fi
  [ "$NDISC" -gt 0 ] || esec "testele noi nu discriminează varianta anterioară"
  ok "varianta anterioară pică $NDISC teste noi"
fi
# ── Tabel live vs patch ─────────────────────────────────────────────────────────
awk -F'|' '
  FNR == 1 { fisier++ }
  { grup = $4; sub(/\..*/, "", grup) }
  fisier == 1 { if ($3 == "caz" || $3 == "conc") { ordine[++n] = $4; cat[$4] = $5; desc[$4] = $8; live[$4] = $7; lst[$4] = $6 }
                nl[grup]++; if ($6 == "FAIL") fl[grup]++ }
  fisier == 2 { if ($3 == "caz" || $3 == "conc") { patch[$4] = $7; pst[$4] = $6 }
                np[grup]++; if ($6 == "FAIL") fp[grup]++ }
  END {
    print "| Cod | Cat. | Test | Live (fără patch) | Cu patch |"
    print "|---|---|---|---|---|"
    for (i = 1; i <= n; i++) { c = ordine[i]; g = c; sub(/\..*/, "", g)
      l = live[c]; p = patch[c]; if (length(l) > 95) l = substr(l, 1, 92) "…"; if (length(p) > 95) p = substr(p, 1, 92) "…"
      printf "| %s | %s | %s | %s: %s (aserțiuni picate în caz %d/%d) | %s: %s (picate %d/%d) |\n", c, cat[c], desc[c],
        (lst[c] == "OK" ? "OK" : "PICĂ"), l, fl[g] + 0, nl[g], (pst[c] == "OK" ? "OK" : "PICĂ"), p, fp[g] + 0, np[g] }
  }' "$OUT/live.out.rez" "$OUT/patch.out.rez" > "$BASE/rezultate.md"
NL=$(wc -l < "$OUT/live.out.rez"); NP=$(wc -l < "$OUT/patch.out.rez")
FL=$(grep -c '|FAIL|' "$OUT/live.out.rez" || true); FP=$(grep -c '|FAIL|' "$OUT/patch.out.rez" || true)
printf '\n\033[32mPASS test_j05_garda\033[0m: live %s aserțiuni (%s picate, toate în cazurile P/H) · patch %s aserțiuni (%s picate) · %s verificări de harness (migrare, rollback, precondiții, reaplicare)\n' \
  "$NL" "$FL" "$NP" "$FP" "$VERIF"
echo "Tabel live vs patch: $BASE/rezultate.md"
