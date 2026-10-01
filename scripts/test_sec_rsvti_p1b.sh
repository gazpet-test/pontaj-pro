#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — SEC RSVTI P1b + jurnal A (20261005a_sec_rsvti_p1b_jurnal_insert.sql).
# EXCLUSIV pe un PostgreSQL 17 local dedicat (implicit /tmp/pg_sec_rsvti_p1b, 127.0.0.1:5961). Nu atinge producția.
#
# Ciclul:
#   0. schelet (supabase/tests/sec_rsvti_schelet.sql) + fixture (triggerul live trg_hr_autorizatie_noua) + 20261003c
#      (= producția din 01.10) → suita în modul GAURA (atacurile P1b/jurnal reușesc); gate 0e = 0
#   1. fișierul fără runner (psql -f) → garda de livrare refuză, nimic schimbat
#   2. precondiții negative (RPC alterat, trigger în plus, trigger dezactivat, politică în plus pe jurnal,
#      funcție străină cu numele marcajului) → refuz, nimic schimbat
#   3. livrare prin scripts/livrare_migrare.sh (sha256 aprobat; include gate-ul 0e) → cod 0; suita PATCH; 0e = 0
#   4. reaplicare cu marcaj (idempotență) → PATCH
#   5. mutanți (aplicați peste patch, fiecare într-o bază clonată) → suita PATCH TREBUIE să cadă
#   6. rollback tehnic: nearmat → refuz; armat → starea 20261003c, suita GAURA trece; reaplicare → PATCH
# Utilizare: bash scripts/test_sec_rsvti_p1b.sh [--opreste]
# Ieșire: 0 = PASS · 1 = test eșuat · 2 = mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_sec_rsvti_p1b}"
PORT="${PGPORT_TEST:-5961}"
BAZA=sec_rsvti_p1b_test
JURNAL_PG=/tmp/pg_sec_rsvti_p1b.log
SCHELET="$RADACINA/supabase/tests/sec_rsvti_schelet.sql"
FIXTURE="$RADACINA/supabase/tests/sec_rsvti_p1b_fixture.sql"
TESTE="$RADACINA/supabase/tests/sec_rsvti_p1b.test.sql"
BAZA_C="$RADACINA/supabase/migrations/20261003c_sec_rsvti_poarta_jurnal.sql"
MIGRARE="${MIGRARE_FISIER:-$RADACINA/supabase/migrations/20261005a_sec_rsvti_p1b_jurnal_insert.sql}"
ROLLBACK="$RADACINA/supabase/revenire/20261005a_sec_rsvti_p1b_jurnal_insert_ROLLBACK.sql"
NUME=20261005a_sec_rsvti_p1b_jurnal_insert
MARCAJ="SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);"
ARMARE="SELECT set_config('gazpet.rollback_tehnic_20261005a', 'REDESCHIDE_P1B_RSVTI:' || txid_current(), true);"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1

esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)

[ -x "$PG_BIN/initdb" ] || mediu "PG17 lipsă ($PG_BIN)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l "$JURNAL_PG" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
"${PSQL[@]}" -d postgres -Atc 'SHOW server_version' | grep -q '^17' || mediu "serverul nu e PG17"

q()  { "${PSQL[@]}" -d "${DB:-$BAZA}" -Atc "$1"; }
stare() {  # amprenta schemei relevante (pentru „nimic schimbat”)
  q "SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
       SELECT p.proname || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text,'') AS x FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
       UNION ALL SELECT t.tgname || ':' || t.tgenabled::text FROM pg_trigger t WHERE t.tgrelid = 'public.hr_autorizatii'::regclass AND NOT t.tgisinternal
       UNION ALL SELECT 'acl:' || c.relacl::text FROM pg_class c WHERE c.oid = 'public.hr_autorizatii_rsvti_confirmari'::regclass
       UNION ALL SELECT policyname || ':' || coalesce(md5(with_check),'') FROM pg_policies WHERE tablename LIKE 'hr_autorizatii%') s"
}
suita() {  # suita <gaura true|false> → 0 dacă trece
  "${PSQL[@]}" -d "${DB:-$BAZA}" -v gaura="$1" -f "$TESTE" >/tmp/p1b_suita.out 2>&1
}
gate_0e() { local n; n="$("${PSQL[@]}" -d "${DB:-$BAZA}" -At -f "$RADACINA/scripts/control_0e.sql" | grep -c . || true)"; [ "$n" = 0 ] || { "${PSQL[@]}" -d "${DB:-$BAZA}" -At -f "$RADACINA/scripts/control_0e.sql" >&2; esec "gate 0e: $n rânduri"; }; ok "gate 0e = 0 rânduri ($1)"; }
aplica_marcaj() { "${PSQL[@]}" -d "${DB:-$BAZA}" --single-transaction -c "$MARCAJ" -f "${1:-$MIGRARE}" >/tmp/p1b_apl.out 2>&1; }

# ---------------------------------------------------------------- 0. baza = producția 01.10
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA"
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$FIXTURE" >/dev/null
"${PSQL[@]}" -d "$BAZA" -c "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '20261003c_sec_rsvti_poarta_jurnal:' || txid_current(), true);" -f "$BAZA_C" >/dev/null
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE proname='confirm_hr_autorizatie_rsvti'")" = 6185a9ddf13a9e666368858decfa9611 ] || esec "baza nu e 20261003c"
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE proname='fn_trg_hr_autorizatie_noua'")" = eafcc43100ab13e9df6f948be740d441 ] || esec "fixture ≠ live"
ok "0 baza = 20261003c (RPC 6185a9dd…) + trigger live eafcc431…"
suita true || { cat /tmp/p1b_suita.out; esec "suita GAURA pe baza 20261003c"; }; ok "0 suita GAURA trece (atacurile P1b/jurnal reproduse)"
gate_0e "baza"
S0="$(stare)"

# ---------------------------------------------------------------- 1. fără runner
if "${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/tmp/p1b_apl.out 2>&1; then esec "1 psql -f fără marcaj a trecut"; fi
grep -q "garda de livrare (start)" /tmp/p1b_apl.out || esec "1 refuz fără mesajul gărzii"
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE" >/tmp/p1b_apl.out 2>&1 && esec "1 single-transaction fără marcaj a trecut"
"${PSQL[@]}" -d "$BAZA" -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:1', false)" -f "$MIGRARE" >/tmp/p1b_apl.out 2>&1 && esec "1 marcaj de sesiune (alt txid) a trecut"
[ "$(stare)" = "$S0" ] || esec "1 starea s-a schimbat"
ok "1 fără runner / marcaj greșit → refuz, nimic schimbat"

# ---------------------------------------------------------------- 2. precondiții negative
pre_neg() {  # pre_neg <eticheta> <SQL alterare> <fragment>
  "${PSQL[@]}" -d "$BAZA" --single-transaction -c "$2" -c "$MARCAJ" -f "$MIGRARE" >/tmp/p1b_apl.out 2>&1 && esec "2 $1: migrarea a trecut"
  grep -q "$3" /tmp/p1b_apl.out || { cat /tmp/p1b_apl.out; esec "2 $1: alt refuz decât $3"; }
  [ "$(stare)" = "$S0" ] || esec "2 $1: starea s-a schimbat"
  ok "2 $1 → refuz ($3), nimic schimbat"
}
pre_neg "helper alterat"      "COMMENT ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint,date,text) IS 'x'; CREATE OR REPLACE FUNCTION public.fn_poate_scrie_hr_autorizatii() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT true'" "Precondiție 0b"
pre_neg "trigger în plus"  "CREATE FUNCTION public.x_trg() RETURNS trigger LANGUAGE plpgsql AS 'begin return new; end'; CREATE TRIGGER x_trg BEFORE UPDATE ON public.hr_autorizatii FOR EACH ROW EXECUTE FUNCTION public.x_trg()" "Precondiție 0e"
pre_neg "trigger dezactivat" "ALTER TABLE public.hr_autorizatii DISABLE TRIGGER trg_hr_autorizatie_noua" "Precondiție 0e"
pre_neg "politică în plus pe jurnal" "CREATE POLICY x ON public.hr_autorizatii_rsvti_confirmari FOR INSERT TO authenticated WITH CHECK (true)" "Precondiție 0c"
pre_neg "politică în plus pe sursă" "CREATE POLICY x ON public.hr_autorizatii FOR UPDATE TO authenticated USING (true)" "Precondiție 0c"
pre_neg "funcție străină = numele marcajului" "CREATE FUNCTION public.fn_hr_autorizatii_rsvti_marcaj(p bigint) RETURNS void LANGUAGE sql AS 'SELECT 1'" "Precondiție 0d"
pre_neg "RPC cu alt corp" "$(python3 - "$BAZA_C" <<'EOF'
import sys
s=open(sys.argv[1],encoding='utf8').read(); i=s.index('CREATE OR REPLACE FUNCTION public.confirm_hr'); j=s.index('-- ACL neschimbat',i)
print(s[i:j].replace("raise exception 'Autorizatia nu exista","raise exception 'Autorizatia  nu exista"))
EOF
)" "Precondiție 0a"

# ---------------------------------------------------------------- 3. livrare prin runner
SIS="$("${PSQL[@]}" -d postgres -Atc 'SELECT system_identifier FROM pg_control_system()')"
SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
set +e
PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261005000000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/p1b_runner.out 2>&1; RC=$?
set -e
[ "$RC" = 0 ] || { cat /tmp/p1b_runner.out; esec "3 runner cod $RC"; }
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA"
suita false || { cat /tmp/p1b_suita.out; esec "3 suita PATCH"; }; ok "3 suita PATCH trece ($(grep -c '^psql:.*OK\|NOTICE:  OK' /tmp/p1b_suita.out) aserțiuni)"
suita true >/dev/null && esec "3 suita GAURA trece pe patch (nu discriminează)"; ok "3 suita GAURA cade pe patch"
gate_0e "după patch"
S1="$(stare)"

# ---------------------------------------------------------------- 4. reaplicare
aplica_marcaj || { cat /tmp/p1b_apl.out; esec "4 reaplicare"; }
[ "$(stare)" = "$S1" ] || esec "4 reaplicarea a schimbat starea"
suita false || esec "4 suita PATCH după reaplicare"; ok "4 reaplicare idempotentă"

# ---------------------------------------------------------------- 5. mutanți (fiecare pe o clonă a bazei patch-uite)
mutant() {  # mutant <eticheta> <SQL>
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS mut_test" -c "CREATE DATABASE mut_test TEMPLATE $BAZA"
  DB=mut_test q "$2" >/dev/null
  if DB=mut_test suita false; then esec "5 mutant „$1” NU e prins de suită"; fi
  ok "5 mutant „$1” prins: $(grep -o 'ESEC TEST: [^—]*' /tmp/p1b_suita.out | head -1)"
}
# variantă de corp: replace() pe prosrc, pe server; refuză dacă textul de înlocuit nu există (mutant nul)
var_sql() {  # var_sql <trg|rpc> <vechi> <nou>
  local antet
  if [ "$1" = trg ]; then antet='CREATE OR REPLACE FUNCTION public.fn_trg_hr_autorizatii_rsvti_doar_rpc() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS '
  else antet='CREATE OR REPLACE FUNCTION public.confirm_hr_autorizatie_rsvti(p_autorizatie_id bigint, p_data_confirmare date DEFAULT NULL::date, p_observatii text DEFAULT NULL::text) RETURNS hr_autorizatii_rsvti_confirmari LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS '; fi
  local fn; [ "$1" = trg ] && fn=fn_trg_hr_autorizatii_rsvti_doar_rpc || fn=confirm_hr_autorizatie_rsvti
  printf "DO \$m\$ DECLARE s text; BEGIN SELECT prosrc INTO s FROM pg_proc WHERE proname = '%s'; IF position(%s IN s) = 0 THEN RAISE EXCEPTION 'mutant nul'; END IF; EXECUTE %s || quote_literal(replace(s, %s, %s)); END \$m\$" \
    "$fn" "\$v\$$2\$v\$" "\$h\$$antet\$h\$" "\$v\$$2\$v\$" "\$n\$$3\$n\$"
}
mutant "fără verificarea current_user" "$(var_sql trg "and current_user::text is not distinct from" "and true or current_user::text is not distinct from")"
mutant "marcaj fără id"                "$(var_sql trg "|| ':' || new.id::text)" "|| ':' || split_part(current_setting('gazpet.rsvti_rpc', true), ':', 2))")"
mutant "marcaj fără txid"              "$(var_sql trg "(pg_catalog.txid_current()::text || ':'" "(split_part(current_setting('gazpet.rsvti_rpc', true), ':', 1) || ':'")"
mutant "trigger doar pe UPDATE"        "DROP TRIGGER trg_hr_autorizatii_rsvti_doar_rpc ON public.hr_autorizatii; CREATE TRIGGER trg_hr_autorizatii_rsvti_doar_rpc BEFORE UPDATE ON public.hr_autorizatii FOR EACH ROW EXECUTE FUNCTION public.fn_trg_hr_autorizatii_rsvti_doar_rpc()"
mutant "INSERT: o coloană omisă"       "$(var_sql trg "or new.rsvti_observatii is not null" "")"
mutant "UPDATE: o coloană omisă"       "$(var_sql trg "new.rsvti_confirmat_la, new.rsvti_observatii)" "new.rsvti_confirmat_la, old.rsvti_observatii)")"
mutant "RPC fără marcaj"               "$(var_sql rpc "perform public.fn_hr_autorizatii_rsvti_marcaj(p_autorizatie_id);" "")"
mutant "RPC nu golește marcajul"       "$(var_sql rpc "perform public.fn_hr_autorizatii_rsvti_marcaj(null);" "")"
mutant "trigger SECURITY DEFINER"      "ALTER FUNCTION public.fn_trg_hr_autorizatii_rsvti_doar_rpc() SECURITY DEFINER"
mutant "trigger dezactivat"            "ALTER TABLE public.hr_autorizatii DISABLE TRIGGER trg_hr_autorizatii_rsvti_doar_rpc"
mutant "INSERT jurnal re-acordat"      "GRANT INSERT ON public.hr_autorizatii_rsvti_confirmari TO authenticated"
mutant "marcaj apelabil de authenticated" "GRANT EXECUTE ON FUNCTION public.fn_hr_autorizatii_rsvti_marcaj(bigint) TO authenticated"
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS mut_test" >/dev/null

# ---------------------------------------------------------------- 6. rollback tehnic
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >/tmp/p1b_rb.out 2>&1 && esec "6 rollback nearmat a trecut"
"${PSQL[@]}" -d "$BAZA" -c "SELECT set_config('gazpet.rollback_tehnic_20261005a', 'REDESCHIDE_P1B_RSVTI:1', false)" --single-transaction -f "$ROLLBACK" >/tmp/p1b_rb.out 2>&1 && esec "6 rollback cu armare de sesiune a trecut"
[ "$(stare)" = "$S1" ] || esec "6 rollback refuzat a schimbat starea"; ok "6 rollback nearmat / armare greșită → refuz, nimic schimbat"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "$ARMARE" -f "$ROLLBACK" >/tmp/p1b_rb.out 2>&1 || { cat /tmp/p1b_rb.out; esec "6 rollback armat"; }
[ "$(stare)" = "$S0" ] || esec "6 schema după rollback ≠ baza 20261003c"
suita true || esec "6 suita GAURA după rollback"; ok "6 rollback armat → schema = 20261003c, suita GAURA trece"
aplica_marcaj || esec "6 reaplicare după rollback"
[ "$(stare)" = "$S1" ] || esec "6 reaplicarea ≠ patch"
suita false || esec "6 suita PATCH după reaplicare"; gate_0e "după reaplicare"
ok "6 reaplicare după rollback = patch"
echo "PASS — SEC RSVTI P1b (20261005a) pe PG $("${PSQL[@]}" -d postgres -Atc 'SHOW server_version')"
