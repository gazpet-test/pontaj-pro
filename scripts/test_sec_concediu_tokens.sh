#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Test PG16 LOCAL pentru patch-ul 20261003d (hr_concediu_tokens). NU atinge Supabase.
#   bash scripts/test_sec_concediu_tokens.sh           # tot; oprește clusterul la final
#   KEEP=1 bash scripts/test_sec_concediu_tokens.sh    # lasă clusterul pornit
#   PGPORT=5483 PGBASE=/tmp/pg_sec_concediu (implicite)
# Cluster DEDICAT (autovacuum=off, ca txid-urile să fie deterministe în testul de armare persistentă).
# Dacă pe port răspunde alt cluster decât cel din $PGBASE, scriptul refuză (nu atinge clusterele altora).
# Tokenurile din teste sunt FICTIVE.
#
# Ordinea:
#   0. listele albe din fișiere = amprentele de producție (29.09, read-only) + textul amprentei identic în 3 copii
#   1. setup (starea LIVE) → gaura există; suita patch PICĂ pe live (test cu test)
#   2. cele 3 emulări de runner, drum fericit (+ reaplicare)
#   3. eroare injectată (după prima schimbare / în postcondiție / înainte de COMMIT) × emulări → starea
#      rămâne inițială, migrarea NU e înregistrată; mutantul fără BEGIN/COMMIT e prins
#   4. precondiții negative (stări necunoscute/mixte → refuz, fără urme)
#   5. revenirea (rollback tehnic): armări greșite/persistente/rămase → refuz; armată → live exact
#   6. mutanți pe patch (fiecare protecție scoasă) și pe revenire → prinși
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGPORT="${PGPORT:-5483}"
BASE="${PGBASE:-/tmp/pg_sec_concediu}"
PGDATA="$BASE/data"
LOG="$BASE/server.log"
MIG="$ROOT/supabase/migrations/20261003d_sec_concediu_tokens.sql"
RB="$ROOT/supabase/revenire/20261003d_sec_concediu_tokens_ROLLBACK.sql"
SCHELET="$ROOT/supabase/tests/sec_concediu_tokens_schelet.sql"
TESTE="$ROOT/supabase/tests/sec_concediu_tokens.test.sql"
TPL=sc_tpl
DB=sc_test
GUC=gazpet.rollback_tehnic_20261003d
ARM="SELECT set_config('$GUC', 'REDESCHIDE_CITIRE_TOKENURI:' || txid_current(), true);"
# Amprentele de PRODUCȚIE, citite read-only pe 29.09 cu aceeași interogare (PG 17.6):
PROD_TABEL='kind=r rls=t force=f owner=postgres mosteniri=0 col_acl=0'
PROD_POL='hr_tokens_sel|r|permissive|authenticated|dc71e447411e7aaf354179a11ad2e2ae|<NULL>'
PROD_PRIV='anon=SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN col=SELECT,INSERT,UPDATE,REFERENCES go= ; authenticated=SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN col=SELECT,INSERT,UPDATE,REFERENCES go= ; public= col= go= ; service_role=SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN col=SELECT,INSERT,UPDATE,REFERENCES go='
# md5 al politicii noi: identic pe PG16 (aici) și PG18 (PGlite 0.5.8), verificat la pregătire.
PATCH_POL_MD5=ab5d2578ccdd006d09e5691066ea094b

for f in "$MIG" "$RB" "$SCHELET" "$TESTE"; do [ -f "$f" ] || { echo "Lipsește $f" >&2; exit 2; }; done
[ -x "$PGBIN/postgres" ] || { echo "PostgreSQL 16 lipsește în $PGBIN" >&2; exit 2; }

NV=0
PSQL=("$PGBIN/psql" -X -q -h 127.0.0.1 -p "$PGPORT" -U postgres)
pas() { printf '\n\033[1m── %s\033[0m\n' "$*"; }
esec() { printf '\n\033[31mEȘEC: %s\033[0m\n' "$*" >&2; exit 1; }
ok() { NV=$((NV + 1)); echo "  OK  $*"; }
ca_pg() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
sql() { "${PSQL[@]}" -v ON_ERROR_STOP=1 -d "${2:-$DB}" -Atc "$1"; }
sql_pg() { "${PSQL[@]}" -v ON_ERROR_STOP=1 -d postgres -Atc "$1" >/dev/null; }
proaspat() { sql_pg "DROP DATABASE IF EXISTS $DB"; sql_pg "CREATE DATABASE $DB TEMPLATE $TPL"; }
AMP_SQL="$BASE/amprenta.sql"
amprenta() { "${PSQL[@]}" -v ON_ERROR_STOP=1 -d "${1:-$DB}" -At -F ' || ' -f "$AMP_SQL"; }
inregistrat() { sql "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261003d'"; }
curata_persistente() {
  sql_pg "DO \$c\$ DECLARE r record; BEGIN
    FOR r IN SELECT d.datname, ro.rolname, split_part(c, '=', 1) AS nume
               FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) c
               LEFT JOIN pg_database d ON d.oid = s.setdatabase LEFT JOIN pg_roles ro ON ro.oid = s.setrole
              WHERE lower(split_part(c, '=', 1)) = '$GUC' LOOP
      IF r.datname IS NULL THEN EXECUTE format('ALTER ROLE %I RESET %I', r.rolname, r.nume);
      ELSIF r.rolname IS NULL THEN EXECUTE format('ALTER DATABASE %I RESET %I', r.datname, r.nume);
      ELSE EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET %I', r.rolname, r.datname, r.nume); END IF;
    END LOOP; END \$c\$"
}

# ── Emulările de runner ─────────────────────────────────────────────────────────
# e1s: psql -v ON_ERROR_STOP=1 -f FIȘIER; runner-ul înregistrează doar la ieșire 0
# e1n: psql -f FIȘIER fără ON_ERROR_STOP (ieșire 0 și la eroare SQL!) — doar pentru atomicitatea stării
# e2 : un singur simple query: psql -c "$(cat FIȘIER)"; înregistrare doar la ieșire 0
# e3 : runner cu tranzacție proprie: UN string = BEGIN; FIȘIER; INSERT în schema_migrations; COMMIT;
INS="INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261003d', 'sec_concediu_tokens', ARRAY['<fisier>']) ON CONFLICT (version) DO NOTHING;"
aplica() {  # aplica <emulare> <fișier>  → codul de ieșire al runner-ului
  local e="$1" f="$2" rc=0
  case "$e" in
    e1s) "${PSQL[@]}" -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >"$BASE/out" 2>&1 || rc=$?
         [ $rc = 0 ] && sql "$INS" >/dev/null ;;
    e1n) "${PSQL[@]}" -d "$DB" -f "$f" >"$BASE/out" 2>&1 || rc=$? ;;
    e2)  "${PSQL[@]}" -d "$DB" -c "$(cat "$f")" >"$BASE/out" 2>&1 || rc=$?
         [ $rc = 0 ] && sql "$INS" >/dev/null ;;
    e3)  "${PSQL[@]}" -d "$DB" -c "BEGIN;
$(cat "$f")
$INS
COMMIT;" >"$BASE/out" 2>&1 || rc=$? ;;
  esac
  return $rc
}
rollback() {  # rollback <prefix SQL> [fișier]: un singur string ca operatorul: BEGIN; prefix; fișier; COMMIT;
  "${PSQL[@]}" -d "$DB" -c "BEGIN; $1
$(cat "${2:-$RB}")
COMMIT;" >"$BASE/out" 2>&1
}
refuzat() {  # refuzat <etichetă> <fragment> <comandă…>: TREBUIE să cadă cu mesajul dat, fără urme
  local et="$1" frag="$2"; shift 2; local inainte; inainte=$(amprenta)
  if "$@"; then grep -q "EROARE\|ERROR" "$BASE/out" || { cat "$BASE/out" >&2; esec "$et: a trecut, trebuia refuzat"; }; fi
  grep -q -- "$frag" "$BASE/out" || { cat "$BASE/out" >&2; esec "$et: fără mesajul „$frag”"; }
  [ "$(amprenta)" = "$inainte" ] || esec "$et: refuzul a lăsat urme"
  ok "$et [refuz: $frag]"
}
suita() {  # suita <patch|gaura> → trece / pica (pica = o aserțiune TEST EȘUAT, nu altă eroare)
  if "${PSQL[@]}" -v ON_ERROR_STOP=1 -d "$DB" -Atc "SELECT t.suita_$1()" >"$BASE/suita.out" 2>&1; then
    tail -1 "$BASE/suita.out" >"$BASE/suita.n"; echo trece
  else grep -q "TEST EȘUAT" "$BASE/suita.out" || { cat "$BASE/suita.out" >&2; esec "suita $1 a căzut din alt motiv"; }; echo pica; fi
}
prima() { sed -n 's/.*TEST EȘUAT: //p' "$BASE/suita.out" | sed 's/ — .*//' | head -1; }

# ── Cluster dedicat ──────────────────────────────────────────────────────────────
pas "Cluster PG16 dedicat pe 127.0.0.1:$PGPORT ($PGDATA)"
PORNIT_DE_NOI=0
if "$PGBIN/pg_isready" -q -h 127.0.0.1 -p "$PGPORT"; then
  DD=$("${PSQL[@]}" -d postgres -Atc "SHOW data_directory" 2>/dev/null || true)
  [ "$DD" = "$PGDATA" ] || esec "pe portul $PGPORT răspunde alt cluster ($DD) — nu-l ating"
else
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$BASE"; [ "$(id -u)" = 0 ] && chown postgres:postgres "$BASE"; chmod 700 "$BASE"
    ca_pg "'$PGBIN/initdb' -D '$PGDATA' -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null"
  fi
  ca_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -l '$LOG' -w -o \"-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$BASE -c timezone=UTC -c autovacuum=off\" start >/dev/null"
  PORNIT_DE_NOI=1
fi
oprire() {
  curata_persistente 2>/dev/null || true
  if [ "${KEEP:-0}" != 1 ] && [ "$PORNIT_DE_NOI" = 1 ]; then ca_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -m fast -w stop >/dev/null" || true; fi
}
trap oprire EXIT
[ "$("${PSQL[@]}" -d postgres -Atc "SELECT current_setting('server_version_num')::int / 10000")" = 16 ] || esec "nu e PG16"
[ "$("${PSQL[@]}" -d postgres -Atc "SHOW autovacuum")" = off ] || esec "autovacuum trebuie oprit în clusterul dedicat"
curata_persistente
sql_pg "DO \$d\$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sc_citire') AND pg_has_role('anon', 'sc_citire', 'MEMBER') THEN REVOKE sc_citire FROM anon; END IF; END \$d\$"
mkdir -p "$BASE/mut"

pas "0. Listele albe și amprenta: aceleași în toate fișierele, egale cu producția"
sed -n '/<amprenta-20261003d>/,/<\/amprenta-20261003d>/p' "$RB" | sed 's/^  //' > "$AMP_SQL"; echo ';' >> "$AMP_SQL"
N_COPII=$(cat "$MIG" "$RB" | grep -c '<amprenta-20261003d>')
[ "$N_COPII" = 3 ] || esec "amprenta trebuie să apară de 3 ori (pre, post, revenire), apare de $N_COPII"
python3 - "$MIG" "$RB" <<'PY' || esec "copiile amprentei diferă între fișiere"
import sys, re
blocks = []
for f in sys.argv[1:]:
    s = open(f).read()
    blocks += [re.sub(r'^\s+', '', b, flags=re.M) for b in re.findall(r'<amprenta-20261003d>.*?</amprenta-20261003d>', s, re.S)]
sys.exit(0 if len(set(blocks)) == 1 and len(blocks) == 3 else 1)
PY
ok "textul amprentei identic în cele 3 copii (precondiție, postcondiție, revenire)"
for f in "$MIG" "$RB"; do
  grep -q "dc71e447411e7aaf354179a11ad2e2ae" "$f" && grep -q "$PATCH_POL_MD5" "$f" && grep -q "'$PROD_TABEL'" "$f" || esec "listele albe din $(basename "$f") nu conțin amprentele așteptate"
done
ok "listele albe (live dc71e447…, patch $PATCH_POL_MD5, tabel) prezente în migrare și revenire"
grep -qiE '^\s*(BEGIN|COMMIT)\s*;' "$RB" && esec "revenirea NU are voie să conțină BEGIN/COMMIT"
[ "$(grep -cE '^(BEGIN|COMMIT);$' "$MIG")" = 2 ] || esec "migrarea trebuie să aibă exact un BEGIN; și un COMMIT; proprii"
grep -q '^\\' "$MIG" "$RB" && esec "fișierele nu au voie să conțină meta-comenzi psql"
ok "migrarea: BEGIN/COMMIT proprii, fără meta-comenzi; revenirea: fără BEGIN/COMMIT"

pas "1. Setup: schelet = starea LIVE 29.09 (șablon $TPL)"
sql_pg "DROP DATABASE IF EXISTS $DB"; sql_pg "DROP DATABASE IF EXISTS $TPL"; sql_pg "CREATE DATABASE $TPL"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -d $TPL -f "$SCHELET" >/dev/null
"${PSQL[@]}" -v ON_ERROR_STOP=1 -d $TPL -f "$TESTE" >/dev/null
sql "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);" $TPL >/dev/null
proaspat
LIVE=$(amprenta)
T=${LIVE%% || *}; REST=${LIVE#* || }; POL=${REST%% || *}; PRIV=${REST#* || }
[ "$T" = "$PROD_TABEL" ] || esec "tabelul local ≠ producție: $T"
[ "$POL" = "$PROD_POL" ] || esec "politicile locale ≠ producție: $POL"
[ "$PRIV" = "${PROD_PRIV//,MAINTAIN/}" ] || esec "privilegiile locale ≠ producție (fără MAINTAIN, care nu există pe PG16): $PRIV"
ok "amprenta locală = producția (tabel, politică md5, privilegii efective; MAINTAIN doar pe PG17)"
declare -A VEDE_AZI
for u in 121 126 201 202; do VEDE_AZI[$u]=$(sql "SELECT t.vede('authenticated', '00000000-0000-4000-8000-000000000$u')"); done

[ "$(suita gaura)" = trece ] || esec "gaura nu se reproduce pe starea live"
ok "GAURA pe live: $(cat "$BASE/suita.n") verificări (cont fără modul citește tot; anon/authenticated au TRUNCATE)"
[ "$(suita patch)" = pica ] || esec "suita patch TRECE pe starea live — testele nu discriminează"
ok "suita patch PICĂ pe live, la: $(prima)"
# discriminare test cu test: fiecare verificare din suita patch, rulată izolat pe live
PICA_LIVE=$(sql "SELECT count(*) FROM (VALUES
  (t.vede('authenticated','00000000-0000-4000-8000-000000000301') = 'OK:0:-'),
  (t.vede('authenticated','00000000-0000-4000-8000-000000000302') = 'OK:0:-'),
  (t.vede('authenticated','00000000-0000-4000-8000-000000000303') = 'OK:0:-'),
  (t.vede('authenticated','00000000-0000-4000-8000-000000000304') = 'OK:0:-'),
  (t.vede('authenticated','00000000-0000-4000-8000-000000000305') = 'OK:0:-'),
  (t.vede('authenticated','00000000-0000-4000-8000-000000000306') = 'OK:0:-'),
  (t.vede('authenticated','00000000-0000-4000-8000-000000000399') = 'OK:0:-'),
  (t.vede('anon', NULL) = 'ERR:42501'),
  (t.ca('anon', NULL, 'TRUNCATE public.hr_concediu_tokens') = 'ERR:42501'),
  (t.ca('authenticated','00000000-0000-4000-8000-000000000301','TRUNCATE public.hr_concediu_tokens') = 'ERR:42501'),
  (t.ca('authenticated','00000000-0000-4000-8000-000000000126','UPDATE public.hr_concediu_tokens SET activ = false') = 'ERR:42501'),
  (NOT has_any_column_privilege('anon','public.hr_concediu_tokens','SELECT'))) v(trece) WHERE NOT trece")
[ "$PICA_LIVE" = 12 ] || esec "pe live trebuiau să pice 12 verificări izolate (N1–N7, A1, A2, W-trunc, W5, P2), au picat $PICA_LIVE"
ok "pe live pică izolat 12/12 verificări-cheie (N1–N7 fără drept, N8 trece și pe live: fără sub în JWT, A1/A2 anon, W TRUNCATE, W5, P2)"

pas "2. Drumul fericit în cele 3 emulări de runner (+ reaplicare)"
for e in e1s e2 e3; do
  proaspat
  aplica $e "$MIG" || { cat "$BASE/out" >&2; esec "$e: migrarea a eșuat"; }
  A=$(amprenta); [[ "$A" == *"hr_tokens_sel_modul_hr|r|permissive|authenticated|$PATCH_POL_MD5|<NULL>"* ]] || esec "$e: amprenta după migrare: $A"
  [ "$(inregistrat)" = 1 ] || esec "$e: migrarea reușită nu e înregistrată"
  [ "$(suita patch)" = trece ] || esec "$e: suita patch pică după migrare: $(prima)"
  N_PATCH=$(cat "$BASE/suita.n")
  [ "$(suita gaura)" = pica ] || esec "$e: gaura încă există după migrare"
  ok "$e: patch aplicat + înregistrat; suita patch $N_PATCH verificări trec; gaura PICĂ la „$(prima)”"
done
PATCH_AMP=$(amprenta)
for u in 121 126 201 202; do
  [ "$(sql "SELECT t.vede('authenticated', '00000000-0000-4000-8000-000000000$u')")" = "${VEDE_AZI[$u]}" ] || esec "contul …$u nu mai vede ce vedea azi"
done
ok "owner / HR / Ofertare-cu-modul-hr / hr.concedii văd EXACT aceleași rânduri ca înainte (număr + md5)"
aplica e1s "$MIG" 2>/dev/null || true   # e1s înregistrează doar la succes; al doilea INSERT ar încălca PK-ul
"${PSQL[@]}" -v ON_ERROR_STOP=1 -d "$DB" -f "$MIG" >"$BASE/out" 2>&1 || esec "reaplicarea peste patch a eșuat"
grep -q "reaplicare fără efect net" "$BASE/out" || esec "reaplicarea nu s-a recunoscut ca atare"
[ "$(amprenta)" = "$PATCH_AMP" ] || esec "reaplicarea a schimbat starea"
[ "$(suita patch)" = trece ] || esec "suita patch după reaplicare"
ok "reaplicare din starea patch: acceptată ca reaplicare, stare identică"

pas "3. Eroare injectată × emulări: starea rămâne inițială, migrarea NU e înregistrată"
python3 - "$MIG" "$BASE/mut" <<'PY'
import sys
src = open(sys.argv[1]).read(); d = sys.argv[2]
def scrie(nume, s):
    assert s != src, nume; open(f'{d}/{nume}.sql', 'w').write(s)
a = '-- [schimbare-1]\n'; assert src.count(a) == 1
scrie('D1_dupa_prima_schimbare', src.replace(a, a + 'SELECT 1/0;\n'))
b = "  RAISE NOTICE '20261003d: postcondiție OK"; assert src.count(b) == 1
scrie('D2_in_postconditie', src.replace(b, '  PERFORM 1/0;\n' + b))
c = '\nCOMMIT;\n'; assert src.count(c) == 1
scrie('D3_inainte_de_COMMIT', src.replace(c, '\nSELECT 1/0;\nCOMMIT;\n'))
nb = src.replace('\nBEGIN;\n', '\n').replace(c, '\n')
scrie('D4_fara_BEGIN_COMMIT', nb.replace(a, a + 'SELECT 1/0;\n'))
PY
for m in D1_dupa_prima_schimbare D2_in_postconditie D3_inainte_de_COMMIT; do
  for e in e1s e1n e2 e3; do
    proaspat; rc=0; aplica $e "$BASE/mut/$m.sql" || rc=$?
    grep -q "division by zero" "$BASE/out" || { cat "$BASE/out" >&2; esec "$m/$e: eroarea injectată nu s-a produs"; }
    [ "$(amprenta)" = "$LIVE" ] || esec "$m/$e: starea NU a rămas inițială"
    [ "$(inregistrat)" = 0 ] || esec "$m/$e: migrarea apare înregistrată"
    [ "$(suita gaura)" = trece ] || esec "$m/$e: comportamentul nu mai e cel inițial"
    ok "$m / $e: stare inițială, neînregistrată (cod ieșire runner $rc)"
  done
done
proaspat; rc=0; aplica e1n "$BASE/mut/D4_fara_BEGIN_COMMIT.sql" || rc=$?
[ "$(amprenta)" != "$LIVE" ] || esec "D4: fără BEGIN/COMMIT starea a rămas inițială — testul e1n n-ar discrimina"
ok "D4 (mutant fără BEGIN/COMMIT) PRINS în e1n: prima schimbare rămâne (DROP POLICY) → de aceea tranzacția e în fișier (cod ieșire psql $rc — psql -f fără ON_ERROR_STOP întoarce 0 la eroare SQL)"

pas "4. Precondiții negative (o stare necunoscută sau mixtă NU se suprascrie)"
neg() {  # neg <etichetă> <SQL de pregătire> <fragment>
  proaspat; sql "$2" >/dev/null
  refuzat "$1" "$3" aplica e1s "$MIG"
  [ "$(inregistrat)" = 0 ] || esec "$1: înregistrată deși refuzată"
}
Q_PRE='Precondiție 20261003d: stare necunoscută'; Q_TAB='Precondiție 20261003d: tabelul nu e'
neg "politica live fără USING (qual NULL)" "DROP POLICY hr_tokens_sel ON public.hr_concediu_tokens; CREATE POLICY hr_tokens_sel ON public.hr_concediu_tokens FOR SELECT TO authenticated;" "$Q_PRE"
neg "politica live cu USING (true)" "DROP POLICY hr_tokens_sel ON public.hr_concediu_tokens; CREATE POLICY hr_tokens_sel ON public.hr_concediu_tokens FOR SELECT TO authenticated USING (true);" "$Q_PRE"
neg "politica live pe roluri public" "ALTER POLICY hr_tokens_sel ON public.hr_concediu_tokens TO public;" "$Q_PRE"
neg "politica live RESTRICTIVE" "DROP POLICY hr_tokens_sel ON public.hr_concediu_tokens; CREATE POLICY hr_tokens_sel ON public.hr_concediu_tokens AS RESTRICTIVE FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);" "$Q_PRE"
neg "politică permisivă în plus" "CREATE POLICY hr_tokens_extra ON public.hr_concediu_tokens FOR SELECT TO authenticated USING (true);" "$Q_PRE"
neg "politică de scriere în plus" "CREATE POLICY hr_tokens_upd ON public.hr_concediu_tokens FOR UPDATE TO authenticated USING (true) WITH CHECK (true);" "$Q_PRE"
neg "RLS dezactivat" "ALTER TABLE public.hr_concediu_tokens DISABLE ROW LEVEL SECURITY;" "$Q_TAB"
neg "FORCE RLS" "ALTER TABLE public.hr_concediu_tokens FORCE ROW LEVEL SECURITY;" "$Q_TAB"
neg "owner schimbat" "ALTER TABLE public.hr_concediu_tokens OWNER TO service_role;" "$Q_TAB"
neg "grant pe coloană" "GRANT UPDATE (activ) ON public.hr_concediu_tokens TO authenticated;" "$Q_TAB"
neg "ACL mixt (anon fără SELECT, restul live)" "REVOKE SELECT ON public.hr_concediu_tokens FROM anon;" "$Q_PRE"
neg "PUBLIC cu SELECT" "GRANT SELECT ON public.hr_concediu_tokens TO PUBLIC;" "$Q_PRE"
neg "anon moștenește SELECT prin alt rol (membership)" "DO \$d\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sc_citire') THEN CREATE ROLE sc_citire NOLOGIN; END IF; END \$d\$; GRANT sc_citire TO anon; GRANT SELECT ON public.hr_concediu_tokens TO sc_citire; REVOKE ALL ON public.hr_concediu_tokens FROM anon;" "$Q_PRE"
sql_pg "REVOKE sc_citire FROM anon" || true
neg "mixt: politica patch + ACL live" "DROP POLICY hr_tokens_sel ON public.hr_concediu_tokens; CREATE POLICY hr_tokens_sel_modul_hr ON public.hr_concediu_tokens AS PERMISSIVE FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true) OR EXISTS (SELECT 1 FROM public.user_module_access uma WHERE uma.profile_id = auth.uid() AND (uma.module = 'hr' OR left(uma.module, 3) = 'hr.')));" "$Q_PRE"
neg "mixt: politica live + ACL patch" "REVOKE ALL ON public.hr_concediu_tokens FROM anon, authenticated; GRANT SELECT ON public.hr_concediu_tokens TO authenticated;" "$Q_PRE"
neg "dependență lipsă (user_module_access.module redenumit)" "ALTER TABLE public.user_module_access RENAME COLUMN module TO modul;" "Precondiție 20261003d: lipsesc"

pas "5. Revenirea (rollback tehnic, supabase/revenire/)"
proaspat; aplica e1s "$MIG" || esec "migrarea înainte de rollback"
refuzat "nearmat" "nearmat în tranzacția curentă" rollback ""
refuzat "armare cu valoare greșită" "nearmat în tranzacția curentă" rollback "SELECT set_config('$GUC', 'REDESCHIDE_CITIRE_TOKENURI:1', true);"
refuzat "armare fără txid" "nearmat în tranzacția curentă" rollback "SELECT set_config('$GUC', 'REDESCHIDE_CITIRE_TOKENURI', true);"
sesiune_ramasa() { "${PSQL[@]}" -d "$DB" -c "SELECT set_config('$GUC', 'REDESCHIDE_CITIRE_TOKENURI:' || txid_current(), false);" -c "BEGIN;
$(cat "${1:-$RB}")
COMMIT;" >"$BASE/out" 2>&1; }
refuzat "setare de SESIUNE rămasă (armare din tranzacția anterioară)" "nearmat în tranzacția curentă" sesiune_ramasa
armare_eroare_reluare() { "${PSQL[@]}" -d "$DB" -c "BEGIN; $ARM SELECT set_config('$GUC', 'REDESCHIDE_CITIRE_TOKENURI:' || txid_current(), false); SELECT 1/0; COMMIT;" -c "ROLLBACK;" -c "BEGIN;
$(cat "${1:-$RB}")
COMMIT;" >"$BASE/out" 2>&1; }
refuzat "armare + eroare + reluare fără armare nouă" "nearmat în tranzacția curentă" armare_eroare_reluare
# armare + revenirea însăși eșuată (pornire din live) + reluare fără armare nouă, în aceeași sesiune
proaspat
dublu() { "${PSQL[@]}" -d "$DB" -c "BEGIN; $ARM SELECT set_config('$GUC', 'REDESCHIDE_CITIRE_TOKENURI:' || txid_current(), false);
$(cat "$RB")
COMMIT;" -c "ROLLBACK;" -c "BEGIN;
$(cat "$RB")
COMMIT;" >"$BASE/out" 2>&1; }
refuzat "armată din LIVE (refuz) + reluare fără armare nouă" "nearmat în tranzacția curentă" dublu
grep -q "doar din starea exactă a patch-ului" "$BASE/out" || esec "prima încercare din live trebuia refuzată pe pornire"
ok "  … prima încercare refuzată pe pornire („doar din starea exactă a patch-ului”)"
refuzat "armată din starea LIVE" "doar din starea exactă a patch-ului" rollback "$ARM"
proaspat; aplica e1s "$MIG" || esec "migrare"
sql_pg "ALTER DATABASE $DB SET $GUC = 'REDESCHIDE_CITIRE_TOKENURI:0'"
refuzat "armare PERSISTENTĂ (ALTER DATABASE SET) + armare corectă" "armat PERSISTENT" rollback "$ARM"
sql_pg "ALTER DATABASE $DB RESET $GUC"
sql_pg "ALTER ROLE postgres SET \"GAZPET.Rollback_Tehnic_20261003d\" = 'x'"
refuzat "armare PERSISTENTĂ (ALTER ROLE, nume cu majuscule)" "armat PERSISTENT" rollback "$ARM"
curata_persistente
# armare persistentă care NIMEREȘTE txid-ul viitor (cluster dedicat, autovacuum off): o prinde DOAR verificarea persistentă
arm_prezis() { local s; s=$(sql "SELECT txid_current()"); sql_pg "ALTER ROLE postgres SET $GUC = 'REDESCHIDE_CITIRE_TOKENURI:$((s + 2))'"; }
fisier_simplu() { "${PSQL[@]}" -d "$DB" -c "BEGIN;
$(cat "${1:-$RB}")
COMMIT;" >"$BASE/out" 2>&1; }
arm_prezis; refuzat "armare PERSISTENTĂ cu txid-ul exact prezis" "armat PERSISTENT" fisier_simplu; curata_persistente
python3 - "$RB" "$BASE/mut" <<'PY'
import sys, re
src = open(sys.argv[1]).read(); d = sys.argv[2]
def scrie(nume, s):
    assert s != src, nume; open(f'{d}/{nume}.sql', 'w').write(s)
def linie(tag, nou):
    ls = src.split('\n'); i = [k for k, l in enumerate(ls) if tag in l]; assert len(i) == 1, tag
    ls[i[0]] = nou; return '\n'.join(ls)
scrie('RB_fara_persistent', linie('[rb:persistent]', "              WHERE false) THEN"))
scrie('RB_fara_txid', linie('[rb:txid]', "  IF coalesce(current_setting('gazpet.rollback_tehnic_20261003d', true), '') = '' THEN"))
scrie('RB_fara_pornire', linie('[rb:pornire]', "  IF false THEN"))
scrie('RB_fara_dezarmare', linie('[rb:dezarmare]', ''))
x = "  -- 5. Dezarmare"; assert src.count(x) == 1
scrie('RB_eroare_in_postconditie', src.replace(x, '  PERFORM 1/0;\n' + x))
PY
arm_prezis
if fisier_simplu "$BASE/mut/RB_fara_persistent.sql" && ! grep -q "ERROR\|EROARE" "$BASE/out"; then
  ok "mutant RB_fara_persistent PRINS: armarea persistentă cu txid prezis ar fi redeschis gaura (testul de mai sus o refuză)"
else cat "$BASE/out" >&2; esec "testul txid-prezis nu discriminează (premisa txid n-a ținut)"; fi
curata_persistente; proaspat; aplica e1s "$MIG" || esec "migrare"
if sesiune_ramasa "$BASE/mut/RB_fara_txid.sql" && ! grep -q "ERROR" "$BASE/out"; then ok "mutant RB_fara_txid PRINS de „setare de sesiune rămasă”"; else cat "$BASE/out" >&2; esec "RB_fara_txid neprins"; fi
proaspat
rollback "$ARM" "$BASE/mut/RB_fara_pornire.sql" || true
grep -q "doar din starea exactă a patch-ului" "$BASE/out" && esec "RB_fara_pornire neprins"
[ "$(amprenta)" = "$LIVE" ] || esec "RB_fara_pornire a lăsat urme"
ok "mutant RB_fara_pornire PRINS (din live: altă eroare decât refuzul de pornire; testul cere mesajul exact)"
proaspat; aplica e1s "$MIG" || esec "migrare"
rollback "$ARM" "$BASE/mut/RB_eroare_in_postconditie.sql" || true
[ "$(amprenta)" = "$PATCH_AMP" ] || esec "eroare în postcondiția revenirii: starea nu a rămas patch"
ok "eroare injectată în revenire (după schimbări, înainte de COMMIT): starea rămâne patch-ul"
# revenirea armată corect (cu armare și de sesiune, ca să verificăm dezarmarea) → EXACT live
ok_rollback() { "${PSQL[@]}" -d "$DB" -Atc "BEGIN; $ARM SELECT set_config('$GUC', 'REDESCHIDE_CITIRE_TOKENURI:' || txid_current(), false);
$(cat "${1:-$RB}")
COMMIT; SELECT 'armare_ramasa=[' || coalesce(current_setting('$GUC', true), '') || ']';" >"$BASE/out" 2>&1; }
ok_rollback "$BASE/mut/RB_fara_dezarmare.sql" || { cat "$BASE/out" >&2; esec "RB_fara_dezarmare a eșuat"; }
grep -q "armare_ramasa=\[\]" "$BASE/out" && esec "RB_fara_dezarmare neprins"
ok "mutant RB_fara_dezarmare PRINS (comutatorul de sesiune rămâne armat)"
proaspat; aplica e1s "$MIG" || esec "migrare"
ok_rollback || { cat "$BASE/out" >&2; esec "revenirea armată a eșuat"; }
grep -q "armare_ramasa=\[\]" "$BASE/out" || esec "comutatorul a rămas armat după revenire"
[ "$(amprenta)" = "$LIVE" ] || esec "după revenire starea ≠ live 29.09"
[ "$(suita gaura)" = trece ] && [ "$(suita patch)" = pica ] || esec "după revenire comportamentul ≠ live"
ok "revenirea armată: EXACT live 29.09 (amprentă + gaura reprodusă), comutatorul dezarmat în sesiune"
refuzat "revenire a doua oară (din live)" "doar din starea exactă a patch-ului" rollback "$ARM"
aplica e1s "$MIG" || { cat "$BASE/out" >&2; esec "reaplicarea după revenire"; }
[ "$(amprenta)" = "$PATCH_AMP" ] && [ "$(suita patch)" = trece ] || esec "reaplicarea după revenire"
ok "reaplicare după revenire: patch + suita trece"

pas "6. Mutanți pe patch: fiecare protecție scoasă e prinsă (de postcondiție ȘI, fără ea, de comportament)"
python3 - "$MIG" "$BASE/mut" <<'PY'
import sys, re
src = open(sys.argv[1]).read(); d = sys.argv[2]
M = {
 'P_fara_drop_vechi': ("DROP POLICY IF EXISTS hr_tokens_sel ON public.hr_concediu_tokens;  -- [schimbare-1]", "-- [schimbare-1]"),
 'P_using_true': ("EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true)", "true"),
 'P_fara_owner': ("EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true)", "false"),
 'P_fara_submodul': (" OR left(uma.module, 3) = 'hr.'", ""),
 'P_prefix_larg': ("(uma.module = 'hr' OR left(uma.module, 3) = 'hr.')", "uma.module LIKE 'hr%'"),
 'P_orice_uid': ("WHERE uma.profile_id = auth.uid()", "WHERE uma.profile_id IS NOT NULL"),
 'P_roluri_public': ("FOR SELECT TO authenticated", "FOR SELECT TO public"),
 'P_for_all': ("AS PERMISSIVE FOR SELECT", "AS PERMISSIVE FOR ALL"),
 'P_anon_pastrat': ("FROM PUBLIC, anon, authenticated;", "FROM PUBLIC, authenticated;"),
 'P_auth_pastrat': ("FROM PUBLIC, anon, authenticated;", "FROM PUBLIC, anon;"),
 'P_fara_grant_select': ("GRANT SELECT ON TABLE public.hr_concediu_tokens TO authenticated;", ""),
}
post = re.compile(r'-- <postconditie>.*?-- </postconditie>\n', re.S)
assert len(post.findall(src)) == 1
for n, (a, b) in M.items():
    assert src.count(a) == 1, n
    s = src.replace(a, b)
    open(f'{d}/{n}.sql', 'w').write(s)
    open(f'{d}/{n}__fara_post.sql', 'w').write(post.sub('', s))
ls = src.split('\n'); i = [k for k, l in enumerate(ls) if '[pre:stare]' in l]; assert len(i) == 1
ls[i[0]] = "    v_stare := 'necunoscuta';"
open(f'{d}/PRE_accepta_orice.sql', 'w').write('\n'.join(ls))
ls = src.split('\n'); i = [k for k, l in enumerate(ls) if '[pre:tabel]' in l]; assert len(i) == 1
ls[i[0]] = "  IF false THEN"
open(f'{d}/PRE_fara_tabel.sql', 'w').write('\n'.join(ls))
PY
ECHIV="P_roluri_public P_for_all"   # echivalente comportamental datorită REVOKE (anon fără privilegii; authenticated fără I/U/D)
NM=0
for m in P_fara_drop_vechi P_using_true P_fara_owner P_fara_submodul P_prefix_larg P_orice_uid P_roluri_public P_for_all P_anon_pastrat P_auth_pastrat P_fara_grant_select; do
  proaspat; aplica e1s "$BASE/mut/$m.sql" && esec "$m: postcondiția NU l-a oprit"
  grep -q "Postcondiție 20261003d" "$BASE/out" || { cat "$BASE/out" >&2; esec "$m: căzut, dar nu în postcondiție"; }
  [ "$(amprenta)" = "$LIVE" ] && [ "$(inregistrat)" = 0 ] || esec "$m: a lăsat urme"
  proaspat; aplica e1s "$BASE/mut/${m}__fara_post.sql" || { cat "$BASE/out" >&2; esec "$m fără postcondiție: nu s-a aplicat"; }
  r=$(suita patch)
  if [ "$r" = pica ]; then ok "$m: prins de postcondiție (anulat, stare live) ȘI, fără ea, de „$(prima)”"; NM=$((NM + 1))
  elif [[ " $ECHIV " == *" $m "* ]]; then ok "$m: prins de postcondiție; fără ea echivalent comportamental (acoperit de REVOKE) — declarat"; NM=$((NM + 1))
  else esec "$m: fără postcondiție suita trece — protecție netestată comportamental"; fi
done
proaspat; sql "DROP POLICY hr_tokens_sel ON public.hr_concediu_tokens; CREATE POLICY hr_tokens_sel ON public.hr_concediu_tokens FOR SELECT TO authenticated;" >/dev/null
aplica e1s "$BASE/mut/PRE_accepta_orice.sql" || true
grep -q "stare necunoscută" "$BASE/out" && esec "PRE_accepta_orice neprins"
[ "$(amprenta)" != "$LIVE" ] || true
ok "PRE_accepta_orice PRINS de testul „qual NULL” (nu mai refuză cu mesajul de precondiție; suprascrie starea necunoscută)"; NM=$((NM + 1))
proaspat; sql "ALTER TABLE public.hr_concediu_tokens DISABLE ROW LEVEL SECURITY;" >/dev/null
aplica e1s "$BASE/mut/PRE_fara_tabel.sql" || true
grep -q "tabelul nu e" "$BASE/out" && esec "PRE_fara_tabel neprins"
ok "PRE_fara_tabel PRINS de testul „RLS dezactivat” (lipsește refuzul de precondiție; a oprit-o abia postcondiția)"; NM=$((NM + 1))
NM=$((NM + 5))   # D4 + cei 4 mutanți pe revenire, raportați mai sus

printf '\n\033[32mTOATE TESTELE AU TRECUT\033[0m — %s verificări în harness + %s în suita patch (rulată în fiecare scenariu) ; mutanți prinși: %s\n' "$NV" "$N_PATCH" "$NM"
