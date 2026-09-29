#!/usr/bin/env bash
# ============================================================================
# Harness local — SEC trezorerie (20261003e_sec_trezorerie.sql). NIMIC în producție.
# PostgreSQL 16 local dedicat: /tmp/pg_sec_trezorerie, 127.0.0.1:5484, superuser supabase_admin,
# postgres = NON-superuser cu BYPASSRLS (ca în producție). Date FICTIVE. Nu citește .env.
#
#  A. fidelitate: suita „initial” TRECE pe starea de azi; suita „patch” CADE (discriminare)
#  B. precondiții negative (fail-closed, NULL-safe) → refuz, stare neatinsă, migrare neînregistrată
#  C. eroare injectată după prima schimbare / în postcondiție × 3 emulări de runner → stare inițială
#  D. aplicare prin fiecare emulare → suita „patch” trece, suita „initial” cade; reaplicare idempotentă
#  E. revenire: refuzuri (nearmat, token greșit, altă tranzacție, sesiune rămasă, persistentă,
#     armare+eroare+reluare, stare de pornire greșită) → apoi armată: suita „revenire”, dezarmată
#  F. reaplicare după revenire
#  G. mutanți pe migrare și pe revenire → toți prinși
#  H. revenirea nu e descoperită ca migrare forward
# Utilizare: bash scripts/test_sec_trezorerie.sh [--opreste]   · exit 0 = PASS, 1 = FAIL, 2 = mediu
# ============================================================================
set -Eeuo pipefail
RAD="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DIR="${PGDATA_TEST:-/tmp/pg_sec_trezorerie}"
PORT="${PGPORT_TEST:-5484}"
BAZA="sec_trezorerie_test"
MIG="$RAD/supabase/migrations/20261003e_sec_trezorerie.sql"
RBK="$RAD/supabase/revenire/20261003e_sec_trezorerie_ROLLBACK.sql"
SCH="$RAD/supabase/tests/sec_trezorerie_schelet.sql"
TST="$RAD/supabase/tests/sec_trezorerie.test.sql"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ARM="SELECT set_config('gazpet.rollback_tehnic_20261003e', 'REDESCHIDE_TREZORERIE:' || txid_current(), true);"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1

mediu() { echo "MEDIU: $*" >&2; exit 2; }
esec()  { echo "FAIL: $*" >&2; exit 1; }
[[ "$DIR" == /tmp/* ]] || mediu "PGDATA_TEST trebuie sub /tmp"
for f in "$MIG" "$RBK" "$SCH" "$TST"; do [ -f "$f" ] || mediu "lipsă $f"; done
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGOPTIONS PGDATA
export PGCONNECT_TIMEOUT=5 PGCLIENTENCODING=UTF8
ca_pg() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
Q=("$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT")

# --- cluster dedicat ---------------------------------------------------------
if [ ! -f "$DIR/PG_VERSION" ]; then
  mkdir -p "$DIR"; [ "$(id -u)" = 0 ] && chown postgres:postgres "$DIR"; chmod 700 "$DIR"
  ca_pg "$PG_BIN/initdb" -D "$DIR" -U supabase_admin --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
fi
[ "$(cat "$DIR/PG_VERSION")" = 16 ] || mediu "$DIR nu e PG16"
if ! "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT" -t 2; then
  [ "$(id -u)" = 0 ] && { touch "$DIR.log"; chown postgres:postgres "$DIR.log"; }
  ca_pg "$PG_BIN/pg_ctl" -D "$DIR" -l "$DIR.log" -w -t 30 start \
    -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c timezone=UTC" >/dev/null || mediu "pg_ctl start"
fi
SRV="$("${Q[@]}" -U supabase_admin -d postgres -Atc 'SHOW data_directory')" || mediu "conexiune"
[ "$(realpath "$SRV")" = "$(realpath "$DIR")" ] || mediu "pe $PORT rulează alt cluster ($SRV)"

ADM=("${Q[@]}" -U supabase_admin -d "$BAZA")
PGR=("${Q[@]}" -U postgres -d "$BAZA" -v ON_ERROR_STOP=1)
PGR0=("${Q[@]}" -U postgres -d "$BAZA")   # fără ON_ERROR_STOP: continuă în aceeași sesiune după eroare
N_OK=0
ok() { N_OK=$((N_OK+1)); echo "  OK  $*"; }

baza_noua() {
  "${Q[@]}" -U supabase_admin -d postgres -c "DROP DATABASE IF EXISTS $BAZA WITH (FORCE)" -c "CREATE DATABASE $BAZA OWNER postgres" >/dev/null 2>&1 || mediu "recreare baza"
  "${ADM[@]}" -v ON_ERROR_STOP=1 -f "$SCH" >/dev/null 2>&1 || esec "schelet"
  "${ADM[@]}" -c "ALTER ROLE postgres RESET ALL" >/dev/null 2>&1 || true
}
SNAP_SQL="SELECT md5(concat_ws('#',
 (SELECT string_agg(polrelid::regclass::text||':'||polname||':'||polcmd::text||':'||coalesce(pg_get_expr(polqual,polrelid),'')||':'||coalesce(pg_get_expr(polwithcheck,polrelid),''),';' ORDER BY polrelid::regclass::text, polname) FROM pg_policy),
 (SELECT string_agg(oid::regclass::text||':'||coalesce(relacl::text,'')||':'||relrowsecurity::text,';' ORDER BY oid::regclass::text) FROM pg_class WHERE relnamespace='public'::regnamespace),
 (SELECT string_agg(oid::regprocedure::text||':'||md5(prosrc)||':'||prosecdef::text||':'||coalesce(proacl::text,''),';' ORDER BY oid::regprocedure::text) FROM pg_proc WHERE pronamespace='public'::regnamespace),
 (SELECT count(*)::text FROM supabase_migrations.schema_migrations),
 (SELECT string_agg(id::text||coalesce(observatii,''),',' ORDER BY id) FROM public.trezorerie_conturi),
 (SELECT count(*)::text FROM public.trezorerie_extras_linii)))"
snap() { "${ADM[@]}" -Atc "$SNAP_SQL"; }
inreg() { "${ADM[@]}" -Atc "SELECT count(*) FROM supabase_migrations.schema_migrations"; }

suita() {  # $1 stare, $2 asteptat (trece|cade)
  local o; o="$TMP/suita.out"
  if "${ADM[@]}" -v stare="$1" -f "$TST" >"$o" 2>&1; then
    [ "$2" = trece ] || esec "suita [$1] a TRECUT dar trebuia să cadă"
    local n; n=$(grep -c 'NOTICE:  OK ' "$o"); ok "suita [$1] trece ($n aserțiuni)"; N_OK=$((N_OK+n))
  else
    [ "$2" = cade ] || { grep -m3 -E 'ESEC|ERROR' "$o" >&2; esec "suita [$1] a căzut"; }
    grep -q 'ESEC TEST' "$o" || { tail -3 "$o" >&2; esec "suita [$1] a căzut din alt motiv decât o aserțiune"; }
    ok "suita [$1] CADE cum trebuie: $(grep -m1 -o 'ESEC TEST: [^[]*' "$o")"
  fi
}

# emulările de runner: 1 = psql -f; 2 = un singur simple query; 3 = runner cu tranzacție proprie + înregistrare
emul() {  # $1 nr, $2 fișier → exit status
  case "$1" in
    1) "${PGR[@]}" -v ON_ERROR_STOP=1 -f "$2" ;;
    2) "${PGR[@]}" -c "$(cat "$2")" ;;
    3) "${PGR[@]}" -c "BEGIN; $(cat "$2")
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261003e', 'sec_trezorerie'); COMMIT;" ;;
  esac
}
refuz() {  # $1 eticheta, $2 comanda (string eval), $3 fragment eroare; stare neschimbată + neînregistrată
  local s0 s1 i0 o="$TMP/ref.out"
  s0="$(snap)"; i0="$(inreg)"
  if eval "$2" >"$o" 2>&1; then esec "$1: a TRECUT, trebuia refuzat"; fi
  grep -q -- "$3" "$o" || { tail -4 "$o" >&2; esec "$1: eroare neașteptată (aștept „$3”)"; }
  s1="$(snap)"; [ "$s0" = "$s1" ] || esec "$1: starea s-a schimbat după refuz"
  [ "$(inreg)" = "$i0" ] || esec "$1: s-a înregistrat o migrare"
  ok "$1 → refuzat („$3”), stare identică, înregistrări neschimbate ($i0)"
}
injectie() {  # $1 marcaj → fișier modificat
  python3 - "$MIG" "$TMP/inj_$1.sql" "$1" <<'EOF'
import sys; src, dst, m = sys.argv[1:]
s = open(src).read()
rep = {'1': ("-- @@INJECTIE_1@@", "DO $i$ BEGIN RAISE EXCEPTION 'INJECTAT_1'; END $i$;"),
       '2': ("-- @@INJECTIE_2@@", "RAISE EXCEPTION 'INJECTAT_2';")}[m]
assert s.count(rep[0]) == 1; open(dst, 'w').write(s.replace(rep[0], rep[1]))
EOF
  echo "$TMP/inj_$1.sql"
}

echo "== A. fidelitate + discriminare pe starea de azi"
baza_noua
suita initial trece
suita patch cade
BAZ0="$(snap)"

echo "== B. precondiții negative"
declare -A NEG=(
 [N1_politica_in_plus]="CREATE POLICY x_anon ON public.trezorerie_conturi FOR SELECT TO anon USING (true)"
 [N2_RLS_oprit_linii]="ALTER TABLE public.trezorerie_extras_linii DISABLE ROW LEVEL SECURITY"
 [N3_politica_fara_expresii]="DROP POLICY trez_conturi_rw ON public.trezorerie_conturi; CREATE POLICY trez_conturi_rw ON public.trezorerie_conturi FOR ALL TO authenticated"
 [N4_helper_alt_corp]="SET ROLE postgres; CREATE FUNCTION public.fn_trezorerie_poate_citi() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT true'"
 [N5_helper_alta_semnatura]="SET ROLE postgres; CREATE FUNCTION public.fn_trezorerie_poate_scrie(int) RETURNS boolean LANGUAGE sql AS 'SELECT true'"
 [N6_roluri_public]="ALTER POLICY trez_linii_rw ON public.trezorerie_extras_linii TO public"
)
for k in $(printf '%s\n' "${!NEG[@]}" | sort); do
  baza_noua; "${ADM[@]}" -v ON_ERROR_STOP=1 -c "${NEG[$k]}" >/dev/null 2>&1 || esec "pregătire $k"
  for e in 1 2 3; do refuz "$k emulare $e" "emul $e '$MIG'" "PRECONDITIE"; done
done
# N7: pereche mixtă — helperii exacți ai patch-ului + politicile de azi
baza_noua; emul 1 "$MIG" >/dev/null 2>&1
"${ADM[@]}" -v ON_ERROR_STOP=1 -c "DO \$d\$ DECLARE p record; BEGIN FOR p IN SELECT polname, polrelid::regclass t FROM pg_policy WHERE polname LIKE 'trez_%' LOOP EXECUTE format('DROP POLICY %I ON %s', p.polname, p.t); END LOOP; END \$d\$;
 CREATE POLICY trez_conturi_rw ON public.trezorerie_conturi FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
 CREATE POLICY trez_linii_rw ON public.trezorerie_extras_linii FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);" >/dev/null
refuz "N7_pereche_mixta" "emul 1 '$MIG'" "PRECONDITIE"
# N8: starea patch + o politică în plus → reaplicarea refuzată
baza_noua; emul 1 "$MIG" >/dev/null 2>&1
"${ADM[@]}" -c "CREATE POLICY x ON public.trezorerie_conturi FOR SELECT TO authenticated USING (true)" >/dev/null
refuz "N8_reaplicare_cu_politica_in_plus" "emul 1 '$MIG'" "PRECONDITIE"

echo "== C. eroare injectată × 3 emulări"
I1="$(injectie 1)"; I2="$(injectie 2)"
for e in 1 2 3; do
  baza_noua; [ "$(snap)" = "$BAZ0" ] || esec "baza nouă diferă de referință"
  refuz "injectie_dupa_prima_schimbare emulare $e" "emul $e '$I1'" "INJECTAT_1"
  [ "$(snap)" = "$BAZ0" ] || esec "stare ≠ inițială"
  refuz "injectie_in_postconditie emulare $e" "emul $e '$I2'" "INJECTAT_2"
  [ "$(snap)" = "$BAZ0" ] || esec "stare ≠ inițială"
  suita initial trece
done

echo "== D. aplicare prin fiecare emulare"
for e in 1 2 3; do
  baza_noua; emul $e "$MIG" >"$TMP/ap.out" 2>&1 || { cat "$TMP/ap.out" >&2; esec "aplicare emulare $e"; }
  [ "$e" = 3 ] && { [ "$(inreg)" = 1 ] || esec "emularea 3 nu a înregistrat migrarea"; ok "emulare 3: migrare înregistrată o dată"; }
  ok "aplicare emulare $e"
  suita patch trece
  suita initial cade
done
S_PATCH="$(snap)"
emul 1 "$MIG" >/dev/null 2>&1 || esec "reaplicare"
[ "$(snap)" = "$S_PATCH" ] && ok "reaplicare idempotentă: stare identică" || esec "reaplicarea a schimbat starea"
suita patch trece

echo "== E. revenire"
R="$(cat "$RBK")"
refuz "revenire_nearmata"            "\"\${PGR[@]}\" -c \"BEGIN; \$R COMMIT;\""   "neînarmată"
refuz "revenire_token_gresit"        "\"\${PGR[@]}\" -c \"BEGIN; SELECT set_config('gazpet.rollback_tehnic_20261003e','REDESCHIDE_TREZORERIE:1',true); \$R COMMIT;\"" "neînarmată"
refuz "revenire_litere_mici"         "\"\${PGR[@]}\" -c \"BEGIN; SELECT set_config('gazpet.rollback_tehnic_20261003e','redeschide_trezorerie:'||txid_current(),true); \$R COMMIT;\"" "neînarmată"
refuz "revenire_armata_in_alta_tx"   "\"\${PGR[@]}\" -c \"SELECT set_config('gazpet.rollback_tehnic_20261003e','REDESCHIDE_TREZORERIE:'||txid_current(),false);\" -c \"BEGIN; \$R COMMIT;\"" "neînarmată"
refuz "revenire_setare_sesiune_ramasa" "\"\${PGR[@]}\" -c \"SET gazpet.rollback_tehnic_20261003e = 'REDESCHIDE_TREZORERIE:0'\" -c \"BEGIN; \$R COMMIT;\"" "neînarmată"
refuz "revenire_armare_eroare_reluare" "( \"\${PGR0[@]}\" -c \"BEGIN; $ARM \$R SELECT 1/0; COMMIT;\" -c ROLLBACK -c \"BEGIN; \$R COMMIT;\"; exit 1 )" "neînarmată"
"${ADM[@]}" -c "ALTER ROLE postgres SET gazpet.rollback_tehnic_20261003e = 'x'" >/dev/null
refuz "revenire_armare_persistenta_rol" "\"\${PGR[@]}\" -c \"BEGIN; $ARM \$R COMMIT;\"" "persistentă"
"${ADM[@]}" -c "ALTER ROLE postgres RESET ALL" -c "ALTER DATABASE $BAZA SET \"GAZPET.rollback_tehnic_20261003e\" = 'x'" >/dev/null
refuz "revenire_armare_persistenta_baza_MAJ" "\"\${PGR[@]}\" -c \"BEGIN; $ARM \$R COMMIT;\"" "persistentă"
"${ADM[@]}" -c "ALTER DATABASE $BAZA RESET ALL" >/dev/null
"${ADM[@]}" -c "SET ROLE postgres; CREATE OR REPLACE FUNCTION public.fn_trezorerie_poate_scrie() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT true'" >/dev/null
refuz "revenire_peste_helper_modificat" "\"\${PGR[@]}\" -c \"BEGIN; $ARM \$R COMMIT;\"" "nu e exact"
baza_noua
refuz "revenire_din_starea_initiala" "\"\${PGR[@]}\" -c \"BEGIN; $ARM \$R COMMIT;\"" "nu e exact"
emul 1 "$MIG" >/dev/null 2>&1
OUT="$("${PGR[@]}" -At -c "BEGIN; $ARM $R SELECT 'ARM=' || coalesce(current_setting('gazpet.rollback_tehnic_20261003e', true), 'NULL'); COMMIT;" 2>&1)" || { echo "$OUT" >&2; esec "revenirea armată"; }
echo "$OUT" | grep -qx 'ARM=' && ok "revenire armată: postcondiție OK, dezarmată în aceeași tranzacție" || esec "comutatorul nu s-a dezarmat ($OUT)"
suita revenire trece
suita patch cade

echo "== F. reaplicare după revenire"
emul 3 "$MIG" >/dev/null 2>&1 || esec "reaplicare după revenire"
ok "reaplicare după revenire"
suita patch trece

echo "== G. mutanți"
N_MUT=0
mutant() {  # $1 nume, $2 fișier țintă (mig|rbk), $3 python: s = s.replace(...)
  local src dst; [ "$2" = mig ] && src="$MIG" || src="$RBK"; dst="$TMP/mut_$1.sql"
  python3 - "$src" "$dst" "$3" <<'EOF'
import sys; src, dst, code = sys.argv[1:]
s = open(src).read(); o = s; exec(code)
assert s != o, 'mutantul nu schimbă nimic'; open(dst, 'w').write(s)
EOF
  echo "$dst"
}
prins_mig() {  # mutant de migrare: refuzat de postcondiție SAU prins de suită; plus varianta fără postcondiție
  local f; f="$(mutant "$1" mig "$2")"; baza_noua
  if emul 1 "$f" >/dev/null 2>&1; then
    "${ADM[@]}" -v stare=patch -f "$TST" >/dev/null 2>&1 && esec "MUTANT $1 SUPRAVIEȚUIEȘTE"
    ok "mutant $1 prins de suită"
  else ok "mutant $1 prins de postcondiție (refuzat, stare=$( [ "$(snap)" = "$BAZ0" ] && echo inițială || echo ALTA))"; [ "$(snap)" = "$BAZ0" ] || esec "mutant $1 a lăsat urme"; fi
  N_MUT=$((N_MUT+1))
  # aceeași greșeală fără postcondiție: o prinde comportamentul? (unele sunt vizibile doar în catalog)
  python3 - "$f" "$f.fp" <<'EOF'
import sys,re; s=open(sys.argv[1]).read()
s=re.sub(r"DO \$post\$.*?\$post\$;", "", s, flags=re.S); open(sys.argv[2],'w').write(s)
EOF
  baza_noua
  if emul 1 "$f.fp" >/dev/null 2>&1 && "${ADM[@]}" -v stare=patch -f "$TST" >/dev/null 2>&1; then
    echo "  --  mutant $1 fără postcondiție: invizibil în comportament (îl prinde DOAR postcondiția)"
  else echo "  --  mutant $1 fără postcondiție: prins și de suita de comportament"; fi
}
prins_mig M1_citire_extinsa_la_modul_financiar "s = s.replace('AND (p.is_owner IS TRUE OR p.can_access_financiar IS TRUE)', 'AND (p.is_owner IS TRUE OR p.can_access_financiar IS TRUE OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p.id AND u.module = \$\$financiar\$\$))', 1)"
prins_mig M2_scriere_dedusa_din_citire "s = s.replace('WITH CHECK ((SELECT public.fn_trezorerie_poate_scrie()));\nCREATE POLICY trez_conturi_update', 'WITH CHECK ((SELECT public.fn_trezorerie_poate_citi()));\nCREATE POLICY trez_conturi_update', 1)"
prins_mig M3_uid_null_trece "s = s.replace('WHERE p.id = auth.uid()', 'WHERE (p.id = auth.uid() OR auth.uid() IS NULL)')"
prins_mig M4_anon_pastreaza_granturi "s = s.replace('public.trezorerie_extras_linii FROM PUBLIC, anon, authenticated;', 'public.trezorerie_extras_linii FROM PUBLIC, authenticated;', 1)"
prins_mig M5_fara_execute_authenticated "s = s.replace('GRANT EXECUTE ON FUNCTION public.fn_trezorerie_poate_citi()  TO authenticated;', '', 1)"
prins_mig M6_security_invoker "s = s.replace('STABLE SECURITY DEFINER', 'STABLE SECURITY INVOKER')"
prins_mig M7_fara_owner "s = s.replace('(p.is_owner IS TRUE OR p.can_access_financiar IS TRUE)', '(p.can_access_financiar IS TRUE)')"
prins_mig M8_select_true "s = s.replace('USING ((SELECT public.fn_trezorerie_poate_citi()));\nCREATE POLICY trez_conturi_insert', 'USING (true);\nCREATE POLICY trez_conturi_insert', 1)"
prins_mig M9_authenticated_pastreaza_TRUNCATE "s = s.replace('public.trezorerie_extras_linii FROM PUBLIC, anon, authenticated;', 'public.trezorerie_extras_linii FROM PUBLIC, anon;', 1)"
prins_mig M10_flag_NULL_ca_adevarat "s = s.replace('p.can_access_financiar IS TRUE', 'p.can_access_financiar IS NOT FALSE')"
# M11: fără precondiții → scenariul N4 (helper cu alt corp, suprascris tacit) trebuie să fie refuzat
F="$(mutant M11_fara_preconditii mig "import re; s = re.sub(r'DO \\\$pre\\\$.*?\\\$pre\\\$;', '', s, flags=re.S)")"
baza_noua; "${ADM[@]}" -c "${NEG[N4_helper_alt_corp]}" >/dev/null
if emul 1 "$F" >/dev/null 2>&1; then ok "mutant M11_fara_preconditii prins: N4 trece fără precondiții (harness-ul cere refuz)"; else esec "M11: nu discriminează"; fi
N_MUT=$((N_MUT+1))
rev_mutant() {  # $1 nume, $2 cod, $3 scenariu (bash) care trebuie să REUȘEASCĂ cu mutantul (deci refuzul original lipsește)
  local f; f="$(mutant "$1" rbk "$2")"; baza_noua; emul 1 "$MIG" >/dev/null 2>&1
  local RM; RM="$(cat "$f")"
  if eval "$3" >/dev/null 2>&1; then ok "mutant $1 prins (scenariul refuzat de original trece cu mutantul)"; else esec "MUTANT $1 SUPRAVIEȚUIEȘTE"; fi
  N_MUT=$((N_MUT+1))
}
rev_mutant R1_fara_armare "import re; s = re.sub(r\"  IF current_setting\\('gazpet.rollback_tehnic_20261003e', true\\)\n.*?END IF;\n\", '', s, count=1, flags=re.S)" \
  "\"\${PGR[@]}\" -v ON_ERROR_STOP=1 -c \"BEGIN; \$RM COMMIT;\""
rev_mutant R2_fara_verificare_persistenta "import re; s = re.sub(r'  IF EXISTS \(SELECT 1 FROM pg_db_role_setting.*?END IF;\n', '', s, count=1, flags=re.S)" \
  "\"\${ADM[@]}\" -c \"ALTER ROLE postgres SET gazpet.rollback_tehnic_20261003e = 'x'\" && \"\${PGR[@]}\" -v ON_ERROR_STOP=1 -c \"BEGIN; $ARM \$RM COMMIT;\""
rev_mutant R3_fara_stare_de_pornire "s = s.replace('OR v_hok IS DISTINCT FROM 2 THEN', 'OR false THEN', 1)" \
  "\"\${ADM[@]}\" -c \"SET ROLE postgres; CREATE OR REPLACE FUNCTION public.fn_trezorerie_poate_scrie() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT true'\" && \"\${PGR[@]}\" -v ON_ERROR_STOP=1 -c \"BEGIN; $ARM \$RM COMMIT;\""
rev_mutant R4_fara_dezarmare "s = s.replace(\"PERFORM set_config('gazpet.rollback_tehnic_20261003e', '', true);\", '', 1)" \
  "\"\${PGR[@]}\" -At -v ON_ERROR_STOP=1 -c \"BEGIN; $ARM \$RM SELECT current_setting('gazpet.rollback_tehnic_20261003e'); COMMIT;\" | grep REDESCHIDE >/dev/null"

echo "== H. revenirea nu e descoperită ca migrare forward"
[ -z "$(ls "$RAD"/supabase/migrations/ | grep -i '20261003e.*\(ROLLBACK\|REVENIRE\)' || true)" ] || esec "revenire în supabase/migrations"
! grep -l "rollback_tehnic_20261003e" "$RAD"/supabase/migrations/*.sql >/dev/null 2>&1 || esec "comutatorul apare într-o migrare forward"
ok "supabase/migrations/*.sql nu conține revenirea 20261003e (convenția CLI descoperă doar acest director)"

"${Q[@]}" -U supabase_admin -d postgres -c "DROP DATABASE IF EXISTS $BAZA WITH (FORCE)" >/dev/null 2>&1 || true
[ "$OPRESTE" = 1 ] && ca_pg "$PG_BIN/pg_ctl" -D "$DIR" -w stop >/dev/null
echo "PASS: $N_OK verificări OK, $N_MUT mutanți prinși"
