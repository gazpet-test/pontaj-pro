#!/usr/bin/env bash
# ============================================================================
# Harness local — SEC trezorerie (20261003e_sec_trezorerie.sql). NIMIC în producție.
# PostgreSQL 16 local dedicat: /tmp/pg_sec_trezorerie, 127.0.0.1:5484, superuser supabase_admin,
# postgres = NON-superuser cu BYPASSRLS (ca în producție). Date FICTIVE. Nu citește .env.
#
#  A. fidelitate: suita „initial” TRECE pe starea de azi; suita „patch” CADE (discriminare)
#  B. precondiții negative (fail-closed, NULL-safe) → refuz, stare neatinsă, migrare neînregistrată
#  C. runda 4 — tiparul de livrare (livrare emulată; runnerul = runda 5): eroare injectată după prima schimbare / în
#     postcondiție / CHIAR la INSERT-ul în schema_migrations → stare inițială + 0 înregistrări; fișierul fără runner
#     (5 variante) refuzat; COMMIT/END în fișier; reluare după succes refuzată
#  D. aplicare prin runner (+ tranzacția runnerului fără înregistrare) → suita „patch” trece, „initial” cade; reaplicare
#  E. revenire: refuzuri (nearmat, token greșit, altă tranzacție, sesiune rămasă, persistentă,
#     armare+eroare+reluare, stare de pornire greșită) → apoi armată: suita „revenire”, dezarmată
#  F. reaplicare după revenire
#  G. mutanți pe migrare și pe revenire → toți prinși
#  H. revenirea nu e descoperită ca migrare forward
#  I. runda 2 (verdict §2/§4): perechea completă de privilegii (DELETE retras, ACL străin pe helper, derivă de
#     structură/secvență), invarianții sursei drepturilor, autoatribuire, retragerea flagului în sesiune, efectele DELETE
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
TST2="$RAD/supabase/tests/sec_trezorerie_runda2.test.sql"
NUME_MIG=20261003e_sec_trezorerie
MARCAJ="SELECT set_config('gazpet.livrare_migrare', '$NUME_MIG:' || txid_current(), true);"
for f in "$MIG" "$RBK" "$SCH" "$TST" "$TST2"; do [ -f "$f" ] || mediu "lipsă $f"; done
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

# runda 4 — tiparul de livrare. L = livrarea EMULATĂ în harness (NU scripts/livrare_migrare.sh: runnerul comun e NO-GO
#   la Copilot r4 și se reface în runda 5): --single-transaction [marcaj + fișier + verificare + INSERT schema_migrations];
# T = tranzacția runnerului FĂRĂ înregistrare (reaplicări interne); f/c/st/sm/sx = fișierul SINGUR (trebuie refuzat)
emul() {  # $1 mod, $2 fișier, [$3 versiune] → exit status
  case "$1" in
    L) { printf 'DO $inreg$ BEGIN
  IF current_setting(%s, true) IS DISTINCT FROM %s || txid_current() THEN RAISE EXCEPTION %s; END IF;
'            "'gazpet.livrare_migrare'" "'$NUME_MIG:'" "'Înregistrare: marcajul de livrare lipsește'"
         printf "  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '%s') THEN RAISE EXCEPTION 'Înregistrare %s: migrarea e deja înregistrată — reluare refuzată'; END IF;
END \$inreg\$;
" "$NUME_MIG" "$NUME_MIG"
         printf "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('%s', '%s', ARRAY[\$reg_x9\$" "${3:-20261003000000}" "$NUME_MIG"
         cat "$2"; printf '$reg_x9$]);
'; } > "$TMP/inreg.sql"
       "${PGR[@]}" --single-transaction -c "$MARCAJ" -f "$2" -f "$TMP/inreg.sql" ;;
    T)  "${PGR[@]}" --single-transaction -c "$MARCAJ" -f "$2" ;;
    f)  "${PGR[@]}" -f "$2" ;;
    c)  "${PGR0[@]}" -c "$(cat "$2")" ;;
    st) "${PGR[@]}" --single-transaction -f "$2" ;;
    sm) "${PGR[@]}" -c "SELECT set_config('gazpet.livrare_migrare', '$NUME_MIG:' || txid_current(), false)" -f "$2" ;;
    sx) "${PGR[@]}" -c "SET gazpet.livrare_migrare = '$NUME_MIG'" -f "$2" ;;
  esac
}
inreg_nume() { "${ADM[@]}" -Atc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name = '$NUME_MIG'"; }
verif_static() {  # fără control de tranzacție; garda de start prima, garda de final ultima; postcondiția înainte
  ! sed 's/--.*$//' "$1" | grep -qiE '^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|ABORT)\s*(TRANSACTION|WORK)?\s*;|\bcommit\s*;' \
  && [ "$(grep -v '^--' "$1" | grep -v '^\s*$' | head -1)" = 'DO $livrare_start$' ] \
  && [ "$(grep -v '^\s*$' "$1" | tail -1)" = 'END $livrare_final$;' ] \
  && [ "$(grep -n -x '\$post\$;' "$1" | cut -d: -f1)" -lt "$(grep -n -x 'DO \$livrare_final\$' "$1" | cut -d: -f1)" ] 2>/dev/null
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

echo "== 0. statice (runda 4 + runda 2)"
verif_static "$MIG" || esec "migrarea: fără BEGIN/COMMIT, garda de livrare prima și ultima, postcondiția înaintea gărzii de final"
ok "migrarea: fără BEGIN/COMMIT (gestionar = runnerul de livrare, runda 5), garda de livrare prima + ultima, postcondiția înainte"
python3 - "$MIG" <<'PY' || esec "blocul <amprenta-20261003e> nu e identic în precondiție și postcondiție"
import sys, re
b = [re.sub(r'^\s+', '', x, flags=re.M) for x in re.findall(r'<amprenta-20261003e>.*?</amprenta-20261003e>', open(sys.argv[1]).read(), re.S)]
sys.exit(0 if len(b) == 2 and len(set(b)) == 1 else 1)
PY
ok "amprenta completă (obiecte, secvențe, privilegii efective, helperi): text identic în precondiție și postcondiție"

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
  for e in L T; do refuz "$k livrare-$e" "emul $e '$MIG'" "PRECONDITIE"; done
done
# N7: pereche mixtă — helperii exacți ai patch-ului + politicile de azi
baza_noua; emul T "$MIG" >/dev/null 2>&1
"${ADM[@]}" -v ON_ERROR_STOP=1 -c "DO \$d\$ DECLARE p record; BEGIN FOR p IN SELECT polname, polrelid::regclass t FROM pg_policy WHERE polname LIKE 'trez_%' LOOP EXECUTE format('DROP POLICY %I ON %s', p.polname, p.t); END LOOP; END \$d\$;
 CREATE POLICY trez_conturi_rw ON public.trezorerie_conturi FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
 CREATE POLICY trez_linii_rw ON public.trezorerie_extras_linii FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);" >/dev/null
refuz "N7_pereche_mixta" "emul L '$MIG'" "PRECONDITIE"
# N8: starea patch + o politică în plus → reaplicarea refuzată
baza_noua; emul T "$MIG" >/dev/null 2>&1
"${ADM[@]}" -c "CREATE POLICY x ON public.trezorerie_conturi FOR SELECT TO authenticated USING (true)" >/dev/null
refuz "N8_reaplicare_cu_politica_in_plus" "emul L '$MIG'" "PRECONDITIE"

echo "== C. runda 4 — traseul de livrare: eroare oriunde ⇒ stare inițială + 0 înregistrări"
I1="$(injectie 1)"; I2="$(injectie 2)"
for e in L T; do
  baza_noua; [ "$(snap)" = "$BAZ0" ] || esec "baza nouă diferă de referință"
  refuz "injectie_dupa_prima_schimbare livrare-$e" "emul $e '$I1'" "INJECTAT_1"
  refuz "injectie_in_postconditie livrare-$e" "emul $e '$I2'" "INJECTAT_2"
  [ "$(snap)" = "$BAZ0" ] || esec "stare ≠ inițială"
  suita initial trece
done
# eroare injectată CHIAR la INSERT-ul în schema_migrations: triggerul verifică întâi că patch-ul E instalat în tranzacție
baza_noua
"${ADM[@]}" -v ON_ERROR_STOP=1 -c "CREATE FUNCTION supabase_migrations.adv_injectie() RETURNS trigger LANGUAGE plpgsql AS \$i\$ BEGIN
  IF (SELECT count(*) FROM pg_policy WHERE polname LIKE 'trez_%_delete') IS DISTINCT FROM 2::bigint
     OR (SELECT count(*) FROM pg_proc WHERE proname IN ('fn_trezorerie_poate_citi', 'fn_trezorerie_poate_scrie')) IS DISTINCT FROM 2::bigint THEN
    RAISE EXCEPTION 'injecție: patch-ul NU e instalat la momentul înregistrării';
  END IF;
  RAISE EXCEPTION 'EROARE INJECTATĂ la INSERT în schema_migrations (patch instalat, postcondiții trecute)';
END \$i\$;
CREATE TRIGGER adv_injectie BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION supabase_migrations.adv_injectie();" >/dev/null
refuz "eroare CHIAR la INSERT-ul în schema_migrations (după postcondiție și garda de final)" "emul L '$MIG'" "EROARE INJECTATĂ la INSERT în schema_migrations"
suita initial trece
"${ADM[@]}" -c "DROP TRIGGER adv_injectie ON supabase_migrations.schema_migrations; DROP FUNCTION supabase_migrations.adv_injectie();" >/dev/null
emul L "$MIG" 20261003000002 >"$TMP/ap.out" 2>&1 || { cat "$TMP/ap.out" >&2; esec "reluarea permisă după eșec"; }
[ "$(inreg_nume)" = 1 ] || esec "reluare după eșec: înregistrări ≠ 1"
ok "reluare permisă după înregistrarea eșuată: patch + exact o înregistrare"
refuz "reluare după succes (altă versiune)" "emul L '$MIG' 20261003000003" "migrarea e deja înregistrată"
[ "$(inreg_nume)" = 1 ] || esec "dublare"
# fișierul SINGUR, fără runner ⇒ garda de start refuză
baza_noua
for e in f c st sm sx; do refuz "fișier fără marcajul livrării [$e]" "emul $e '$MIG'" "Livrare 20261003e: garda de livrare (start)"; done
# control de tranzacție în fișier ⇒ runnerul refuză înainte de conexiune; END; ⇒ garda de final, neînregistrat
python3 - "$MIG" "$TMP" <<'PY'
import sys; s = open(sys.argv[1]).read(); d = sys.argv[2]
a = 'DROP POLICY IF EXISTS trez_conturi_rw ON public.trezorerie_conturi;\n'; assert s.count(a) == 1
open(f'{d}/g_commit.sql', 'w').write(s.replace(a, a + 'COMMIT;  -- MUTANT\n'))
open(f'{d}/g_commit2.sql', 'w').write(s.replace(a, a + 'select 1; commit ;  -- MUTANT\n'))
open(f'{d}/g_end.sql', 'w').write(s.replace(a, a + 'END;  -- MUTANT\n'))
import re
open(f'{d}/g_fara_start.sql', 'w').write(re.sub(r'DO \$livrare_start\$.*?END \$livrare_start\$;\n', '', s, flags=re.S))
open(f'{d}/g_fara_final.sql', 'w').write(re.sub(r'DO \$livrare_final\$.*?END \$livrare_final\$;\n?', '', s, flags=re.S))
g = "IS DISTINCT FROM '20261003e_sec_trezorerie:' || txid_current()"; assert s.count(g) == 2
open(f'{d}/g_fara_txid.sql', 'w').write(s.replace(g, "NOT LIKE '20261003e_sec_trezorerie%'"))
PY
# COMMIT / END în fișier: prinse DOAR static; prin livrare rup tranzacția ⇒ eșuat + neînregistrat, dar parțial comis.
# Criteriul general de atomicitate = OPEN (verdict Copilot r4) — NU se numără ca mutant prins.
for m in g_commit g_commit2 g_end; do
  [ $m = g_end ] || { verif_static "$TMP/$m.sql" && esec "static: $m neprins"; }
  baza_noua; emul L "$TMP/$m.sql" >"$TMP/end.out" 2>&1 && esec "$m trebuia să eșueze"
  [ "$(inreg_nume)" = 0 ] || esec "$m: înregistrat"
  if [ "$(snap)" = "$BAZ0" ]; then ok "$m: eșuat, neînregistrat, stare inițială"
  else echo "  --  LIMITĂ OPEN $m: eșuat și neînregistrat, DAR prima parte a rămas comisă — se închide doar prin validatorul runnerului (runda 5)"; fi
done
N_MUT_G=0
baza_noua; emul f "$TMP/g_fara_start.sql" >/dev/null 2>&1 || true
[ "$(snap)" != "$BAZ0" ] || esec "mutant fără garda de start neprins"
ok "mutant G_fara_garda_start PRINS (psql -f: instrucțiunile rulează în autocommit și LASĂ URME)"; N_MUT_G=$((N_MUT_G+1))
baza_noua; emul sm "$TMP/g_fara_txid.sql" >"$TMP/tx.out" 2>&1 || true
grep -q "garda de livrare (start)" "$TMP/tx.out" && esec "mutant garda fără txid neprins"
ok "mutant G_fara_txid PRINS (marcaj de sesiune rămas acceptat)"; N_MUT_G=$((N_MUT_G+1))
for m in g_fara_start g_fara_final g_commit g_commit2; do verif_static "$TMP/$m.sql" && esec "static: $m neprins"; done
ok "mutanții fără gardă start / fără gardă final / COMMIT în fișier PRINȘI și static"; N_MUT_G=$((N_MUT_G+1))

echo "== D. aplicare prin livrarea emulată"
baza_noua; emul L "$MIG" >"$TMP/ap.out" 2>&1 || { cat "$TMP/ap.out" >&2; esec "aplicare prin runner"; }
[ "$(inreg_nume)" = 1 ] || esec "runnerul nu a înregistrat migrarea"
"${ADM[@]}" -Atc "SELECT statements[1] FROM supabase_migrations.schema_migrations WHERE name = '$NUME_MIG'" | cmp -s - <(cat "$MIG"; echo) || esec "statements[1] ≠ fișierul"
ok "aplicare prin livrarea emulată: patch + O înregistrare (statements = fișierul, octet cu octet)"
suita patch trece
suita initial cade
S_PATCH="$(snap)"
emul T "$MIG" >"$TMP/ap.out" 2>&1 || { cat "$TMP/ap.out" >&2; esec "reaplicare"; }
grep -q "reaplic idempotent" "$TMP/ap.out" || esec "reaplicarea nu s-a recunoscut"
[ "$(snap)" = "$S_PATCH" ] && ok "reaplicare idempotentă (tranzacția runnerului): stare identică" || esec "reaplicarea a schimbat starea"
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
emul L "$MIG" >/dev/null 2>&1
OUT="$("${PGR[@]}" -At -c "BEGIN; $ARM $R SELECT 'ARM=' || coalesce(current_setting('gazpet.rollback_tehnic_20261003e', true), 'NULL'); COMMIT;" 2>&1)" || { echo "$OUT" >&2; esec "revenirea armată"; }
echo "$OUT" | grep -qx 'ARM=' && ok "revenire armată: postcondiție OK, dezarmată în aceeași tranzacție" || esec "comutatorul nu s-a dezarmat ($OUT)"
suita revenire trece
suita patch cade

echo "== F. reaplicare după revenire"
emul T "$MIG" >"$TMP/rr.out" 2>&1 || { cat "$TMP/rr.out" >&2; esec "reaplicare după revenire"; }
grep -q "starea de după revenirea tehnică recunoscută" "$TMP/rr.out" || esec "reaplicarea după revenire nu a recunoscut starea"
ok "reaplicare după revenire (starea revenirii = a treia stare cunoscută: politici deschise, ACL strâns, fără helperi)"
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
  if emul L "$f" >/dev/null 2>&1; then
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
  if emul L "$f.fp" >/dev/null 2>&1 && "${ADM[@]}" -v stare=patch -f "$TST" >/dev/null 2>&1; then
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
prins_mig M12_helper_EXECUTE_rol_in_plus "s = s.replace('GRANT EXECUTE ON FUNCTION public.fn_trezorerie_poate_citi()  TO authenticated;', 'GRANT EXECUTE ON FUNCTION public.fn_trezorerie_poate_citi()  TO authenticated, pg_monitor;', 1)"
prins_mig M13_grant_option_authenticated "s = s.replace('GRANT SELECT, INSERT, UPDATE, DELETE ON public.trezorerie_conturi, public.trezorerie_extras_linii TO authenticated;', 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.trezorerie_conturi, public.trezorerie_extras_linii TO authenticated WITH GRANT OPTION;', 1)"
prins_mig M14_service_role_pierde_TRUNCATE "s = s.replace('GRANT USAGE, SELECT ON SEQUENCE', 'REVOKE TRUNCATE ON public.trezorerie_conturi FROM service_role;\nGRANT USAGE, SELECT ON SEQUENCE', 1)"
prins_mig M15_secventa_modificata "s = s.replace('GRANT USAGE, SELECT ON SEQUENCE', 'ALTER SEQUENCE public.trezorerie_conturi_id_seq CACHE 5;\nGRANT USAGE, SELECT ON SEQUENCE', 1)"
prins_mig M16_grant_rol_suplimentar_tabel "s = s.replace('GRANT USAGE, SELECT ON SEQUENCE', 'GRANT SELECT ON public.trezorerie_conturi TO pg_monitor;\nGRANT USAGE, SELECT ON SEQUENCE', 1)"
# M11: fără precondiții → scenariul N4 (helper cu alt corp, suprascris tacit) trebuie să fie refuzat
F="$(mutant M11_fara_preconditii mig "import re; s = re.sub(r'DO \\\$pre\\\$.*?\\\$pre\\\$;', '', s, flags=re.S)")"
baza_noua; "${ADM[@]}" -c "${NEG[N4_helper_alt_corp]}" >/dev/null
emul L "$F" >"$TMP/m11.out" 2>&1 || true
grep -q "PRECONDITIE" "$TMP/m11.out" && esec "M11: nu discriminează"
ok "mutant M11_fara_preconditii prins: pe N4 lipsește refuzul PRECONDITIE (helperul străin e suprascris; oprește abia postcondiția)"
N_MUT=$((N_MUT+1))
rev_mutant() {  # $1 nume, $2 cod, $3 scenariu (bash) care trebuie să REUȘEASCĂ cu mutantul (deci refuzul original lipsește)
  local f; f="$(mutant "$1" rbk "$2")"; baza_noua; emul L "$MIG" >/dev/null 2>&1
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

echo "== I. runda 2 (verdict §2/§4)"
"${ADM[@]}" -c "DO \$r\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trez_strain') THEN CREATE ROLE trez_strain NOLOGIN; END IF; END \$r\$" >/dev/null
# I1. reaplicare după restrângere intenționată: DELETE retras de la authenticated ⇒ refuz înainte de modificări, NU se reacordă
baza_noua; emul L "$MIG" >/dev/null 2>&1 || esec "I1 aplicare"
"${ADM[@]}" -v ON_ERROR_STOP=1 -c "REVOKE DELETE ON public.trezorerie_conturi, public.trezorerie_extras_linii FROM authenticated" >/dev/null
for e in L T; do refuz "I1 reaplicare după DELETE retras intenționat, livrare-$e" "emul $e '$MIG'" "PRECONDITIE"; done
[ "$("${ADM[@]}" -Atc "SELECT has_table_privilege('authenticated','public.trezorerie_conturi','DELETE') OR has_table_privilege('authenticated','public.trezorerie_extras_linii','DELETE')")" = f ] || esec "I1: DELETE reacordat"
ok "I1: DELETE rămâne retras (nimic reacordat)"
# I2. ACL străin pe helper (corp și atribute neschimbate) ⇒ stare necunoscută, refuz
declare -A ACLH=(
 [I2a_EXECUTE_rol_suplimentar]="GRANT EXECUTE ON FUNCTION public.fn_trezorerie_poate_citi() TO trez_strain"
 [I2b_EXECUTE_PUBLIC]="GRANT EXECUTE ON FUNCTION public.fn_trezorerie_poate_scrie() TO PUBLIC"
 [I2c_EXECUTE_cu_grant_option]="GRANT EXECUTE ON FUNCTION public.fn_trezorerie_poate_citi() TO authenticated WITH GRANT OPTION"
 [I2d_EXECUTE_service_role]="GRANT EXECUTE ON FUNCTION public.fn_trezorerie_poate_scrie() TO service_role"
)
for k in $(printf '%s\n' "${!ACLH[@]}" | sort); do
  baza_noua; emul L "$MIG" >/dev/null 2>&1 || esec "$k aplicare"
  "${ADM[@]}" -v ON_ERROR_STOP=1 -c "SET ROLE postgres; ${ACLH[$k]}" >/dev/null || esec "pregătire $k"
  refuz "$k (helper pe patch)" "emul T '$MIG'" "PRECONDITIE"
done
# I3. derivă de structură / privilegii pe starea INIȚIALĂ (politici și helperi neschimbați) ⇒ refuz, nu granturi pe obiecte presupuse
declare -A DERIVA=(
 [I3a_owner_tabel]="ALTER TABLE public.trezorerie_conturi OWNER TO service_role"
 [I3b_FORCE_RLS]="ALTER TABLE public.trezorerie_extras_linii FORCE ROW LEVEL SECURITY"
 [I3c_mostenire]="CREATE TABLE public.trezorerie_conturi_copil () INHERITS (public.trezorerie_conturi)"
 [I3d_secventa_dezlegata]="ALTER SEQUENCE public.trezorerie_conturi_id_seq OWNED BY NONE"
 [I3e_secventa_inlocuita_acelasi_nume]="SET ROLE postgres; ALTER SEQUENCE public.trezorerie_conturi_id_seq RENAME TO trezorerie_conturi_id_seq_vechi; CREATE SEQUENCE public.trezorerie_conturi_id_seq"
 [I3f_proprietate_secventa]="ALTER SEQUENCE public.trezorerie_extras_linii_id_seq INCREMENT BY 2"
 [I3g_grant_pe_coloana]="GRANT UPDATE (iban) ON public.trezorerie_conturi TO trez_strain"
 [I3h_rol_suplimentar_tabel]="GRANT SELECT ON public.trezorerie_extras_linii TO trez_strain"
 [I3i_grant_option]="SET ROLE postgres; GRANT SELECT ON public.trezorerie_conturi TO authenticated WITH GRANT OPTION"
 [I3j_anon_mosteneste_rol]="GRANT SELECT ON public.trezorerie_conturi TO trez_strain; GRANT trez_strain TO anon"
 [I3k_trigger_adaugat]="CREATE FUNCTION public.x_trg() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'; CREATE TRIGGER x BEFORE UPDATE ON public.trezorerie_conturi FOR EACH ROW EXECUTE FUNCTION public.x_trg()"
 [I3l_tip_secventa]="ALTER SEQUENCE public.trezorerie_extras_linii_id_seq AS integer"
)
for k in $(printf '%s\n' "${!DERIVA[@]}" | sort); do
  baza_noua; "${ADM[@]}" -v ON_ERROR_STOP=1 -c "${DERIVA[$k]}" >/dev/null || esec "pregătire $k"
  refuz "$k (pe starea inițială)" "emul L '$MIG'" "PRECONDITIE"
done
"${ADM[@]}" -c "REVOKE trez_strain FROM anon" >/dev/null 2>&1 || true
baza_noua; emul L "$MIG" >/dev/null 2>&1; "${ADM[@]}" -v ON_ERROR_STOP=1 -c "ALTER TABLE public.trezorerie_extras_linii OWNER TO service_role" >/dev/null
refuz "I3m owner schimbat pe starea PATCH" "emul T '$MIG'" "PRECONDITIE"
# I4. invarianții sursei drepturilor (profiles.is_owner / can_access_financiar)
declare -A INV=(
 [I4a_trigger_prevent_dezactivat]="ALTER TABLE public.profiles DISABLE TRIGGER prevent_role_escalation_trigger"
 [I4b_trigger_enforce_sters]="DROP TRIGGER trg_enforce_owner_only_salary_flags ON public.profiles"
 [I4c_corp_enforce_fara_financiar]="SET ROLE postgres; CREATE OR REPLACE FUNCTION public.enforce_owner_only_salary_flags() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS \$x\$ BEGIN IF auth.uid() IS NULL THEN RETURN NEW; END IF; NEW.is_owner := OLD.is_owner; RETURN NEW; END \$x\$"
 [I4d_politica_insert_profil_propriu]="CREATE POLICY profiles_insert_self ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid())"
 [I4e_update_owner_largita]="ALTER POLICY profiles_update_owner ON public.profiles USING (true) WITH CHECK (true)"
 [I4f_RLS_oprit_profiles]="ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY"
 [I4g_flag_tip_text]="ALTER TABLE public.profiles ALTER COLUMN can_access_financiar TYPE text"
 [I4h_trigger_enforce_invoker]="ALTER FUNCTION public.enforce_owner_only_salary_flags() SECURITY INVOKER"
)
for k in $(printf '%s\n' "${!INV[@]}" | sort); do
  baza_noua; "${ADM[@]}" -v ON_ERROR_STOP=1 -c "${INV[$k]}" >/dev/null || esec "pregătire $k"
  refuz "$k" "emul L '$MIG'" "sursa drepturilor"
done
"${ADM[@]}" -c "ALTER ROLE authenticated BYPASSRLS" >/dev/null; baza_noua
refuz "I4i authenticated BYPASSRLS" "emul L '$MIG'" "sursa drepturilor"
"${ADM[@]}" -c "ALTER ROLE authenticated NOBYPASSRLS" >/dev/null
# I5. autoatribuire + efectele DELETE (suita runda2): PICĂ pe starea inițială, TRECE pe patch
suita2() {  # $1 stare, $2 trece|cade
  local o="$TMP/s2.out"
  if "${ADM[@]}" -v stare="$1" -f "$TST2" >"$o" 2>&1; then
    [ "$2" = trece ] || esec "suita runda2 [$1] a trecut, trebuia să cadă"
    local n; n=$(grep -c 'NOTICE:  OK ' "$o"); ok "suita runda2 [$1] trece ($n aserțiuni: X1–X7 autoatribuire + control, D0–D5 efectele DELETE)"; N_OK=$((N_OK+n))
  else
    [ "$2" = cade ] || { grep -m3 -E 'ESEC|ERROR' "$o" >&2; esec "suita runda2 [$1] a căzut"; }
    grep -q 'ESEC TEST' "$o" || { tail -3 "$o" >&2; esec "suita runda2 [$1]: alt motiv"; }
    ok "suita runda2 [$1] CADE cum trebuie: $(grep -m1 -o 'ESEC TEST: [^[]*' "$o")"
  fi
}
baza_noua; suita2 initial cade
emul L "$MIG" >/dev/null 2>&1 || esec "I5 aplicare"; suita2 patch trece
grep 'NOTICE:  OK X' "$TMP/s2.out" | sed 's/.*NOTICE:  OK /        /; s/ \[.*//'
# de ce contează invarianții: cu triggerele de pe profiles oprite, autoatribuirea reușește PESTE patch
"${ADM[@]}" -c "ALTER TABLE public.profiles DISABLE TRIGGER prevent_role_escalation_trigger; ALTER TABLE public.profiles DISABLE TRIGGER trg_enforce_owner_only_salary_flags" >/dev/null
R="$("${ADM[@]}" -At -c "BEGIN; SELECT set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-00000000000d\",\"role\":\"authenticated\"}', true); SET LOCAL ROLE authenticated;
UPDATE public.profiles SET can_access_financiar = true WHERE id = auth.uid(); SELECT 'vede=' || count(*) FROM public.trezorerie_conturi; ROLLBACK;" 2>&1 | grep vede=)"
[ "$R" = "vede=3" ] || esec "demonstrația invariantului rupt: $R"
ok "invariant rupt (triggere profiles oprite) + patch: contul fără drept își pune flagul și vede 3/3 → de aceea [pre:invarianti]"
# I6. retragerea flagului într-o sesiune existentă: același JWT (claims de sesiune identice), tranzacții noi
baza_noua; emul L "$MIG" >/dev/null 2>&1 || esec "I6 aplicare"
JWT_F='{"sub":"00000000-0000-0000-0000-00000000000f","role":"authenticated"}'
JWT_O='{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}'
OUT="$("${PGR0[@]}" -At \
  -c "SELECT set_config('request.jwt.claims', '$JWT_F', false)" \
  -c "SET ROLE authenticated" -c "SELECT 'T1 vede=' || count(*) FROM public.trezorerie_conturi" -c "RESET ROLE" \
  -c "BEGIN" -c "SELECT set_config('request.jwt.claims', '$JWT_O', true)" -c "UPDATE public.profiles SET can_access_financiar = false WHERE id = '00000000-0000-0000-0000-00000000000f'" -c "COMMIT" \
  -c "SELECT 'JWT_identic=' || (current_setting('request.jwt.claims') = '$JWT_F')" \
  -c "SET ROLE authenticated" \
  -c "SELECT 'T2 vede=' || count(*) FROM public.trezorerie_conturi" \
  -c "WITH u AS (UPDATE public.trezorerie_conturi SET observatii = 'dupa_retragere' RETURNING 1) SELECT 'T3 update=' || count(*) FROM u" \
  -c "WITH d AS (DELETE FROM public.trezorerie_extras_linii RETURNING 1) SELECT 'T4 delete=' || count(*) FROM d" \
  -c "INSERT INTO public.trezorerie_conturi (iban, cont_intern) VALUES ('RO00TEST7777', 'X')" 2>&1 || true)"
echo "$OUT" | grep -qx 'T1 vede=3' && echo "$OUT" | grep -qx 'JWT_identic=true' && echo "$OUT" | grep -qx 'T2 vede=0' \
  && echo "$OUT" | grep -qx 'T3 update=0' && echo "$OUT" | grep -qx 'T4 delete=0' && echo "$OUT" | grep -q 'new row violates row-level security' \
  || { echo "$OUT" >&2; esec "I6 retragerea flagului în sesiune"; }
[ "$("${ADM[@]}" -Atc "SELECT count(*) FROM public.trezorerie_conturi WHERE observatii = 'dupa_retragere' OR iban = 'RO00TEST7777'")" = 0 ] || esec "I6: scriere după retragere"
ok "I6 retragere can_access_financiar: aceeași sesiune, același JWT, tranzacție nouă → vede 0, UPDATE 0, DELETE 0, INSERT refuzat (RLS)"
# I7. mutanți pe precondiția rundei 2
python3 - "$MIG" "$TMP" <<'PY'
import sys; s = open(sys.argv[1]).read(); d = sys.argv[2]
def linie(tag, nou, nume):
    ls = s.split('\n'); i = [k for k, l in enumerate(ls) if tag in l]; assert len(i) == 1, tag
    ls[i[0]] = nou; open(f'{d}/{nume}.sql', 'w').write('\n'.join(ls))
a = "RAISE EXCEPTION 'PRECONDITIE: sursa drepturilor (profiles.is_owner / can_access_financiar) nu e în starea verificată — autoatribuirea nu mai e exclusă demonstrat'"; assert s.count(a) == 1
open(f'{d}/PRE_fara_invarianti.sql', 'w').write(s.replace(a, "RAISE NOTICE 'MUTANT: invarianti ignorati'"))
linie('[pre:secvente]', '  IF false THEN', 'PRE_fara_secvente')
a = "AND v_ob IS NOT DISTINCT FROM c_ob_patch AND v_ef IS NOT DISTINCT FROM c_ef_patch AND v_h IS NOT DISTINCT FROM c_h_patch THEN"; assert s.count(a) == 1
open(f'{d}/PRE_patch_doar_politici.sql', 'w').write(s.replace(a, "THEN"))
PY
baza_noua; "${ADM[@]}" -c "${INV[I4a_trigger_prevent_dezactivat]}" >/dev/null; emul L "$TMP/PRE_fara_invarianti.sql" >"$TMP/m.out" 2>&1 || true
grep -q "sursa drepturilor" "$TMP/m.out" && esec "PRE_fara_invarianti neprins"
ok "mutant PRE_fara_invarianti PRINS de I4a (patch aplicat peste o sursă de drepturi ruptă)"; N_MUT_G=$((N_MUT_G+1))
baza_noua; "${ADM[@]}" -c "${DERIVA[I3e_secventa_inlocuita_acelasi_nume]}" >/dev/null; emul L "$TMP/PRE_fara_secvente.sql" >"$TMP/m.out" 2>&1 || true
grep -q "PRECONDITIE" "$TMP/m.out" && esec "PRE_fara_secvente neprins"
ok "mutant PRE_fara_secvente PRINS de I3e (secvența cu același nume, dar nelegată de id, trece: ACL identic)"; N_MUT_G=$((N_MUT_G+1))
baza_noua; emul L "$MIG" >/dev/null 2>&1; "${ADM[@]}" -c "REVOKE DELETE ON public.trezorerie_conturi, public.trezorerie_extras_linii FROM authenticated" >/dev/null
emul T "$TMP/PRE_patch_doar_politici.sql" >/dev/null 2>&1 || true
[ "$("${ADM[@]}" -Atc "SELECT has_table_privilege('authenticated','public.trezorerie_conturi','DELETE')")" = t ] || esec "PRE_patch_doar_politici neprins"
ok "mutant PRE_patch_doar_politici (precondiția r1) PRINS de I1: DELETE retras e REACORDAT tacit"; N_MUT_G=$((N_MUT_G+1))
N_MUT=$((N_MUT + N_MUT_G))
"${ADM[@]}" -c "DROP ROLE IF EXISTS trez_strain" >/dev/null 2>&1 || true

"${Q[@]}" -U supabase_admin -d postgres -c "DROP DATABASE IF EXISTS $BAZA WITH (FORCE)" >/dev/null 2>&1 || true
[ "$OPRESTE" = 1 ] && ca_pg "$PG_BIN/pg_ctl" -D "$DIR" -w stop >/dev/null
echo "PASS: $N_OK verificări OK, $N_MUT mutanți prinși"
