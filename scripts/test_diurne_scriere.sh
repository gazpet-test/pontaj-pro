#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261023b_diurne_scriere_acces_diurne (diurne: scriere pentru bifa „acces diurne”). PostgreSQL 17 local
# dedicat (/tmp/pg_diurne, 127.0.0.1:5984). Nu atinge producția. Verifică: refuzuri (gardă, utilizator, politică modificată, reaplicare,
# revenire nearmată/persistentă) · runner · matrice INSERT/UPDATE/DELETE pe 2 tabele × 4 profile (owner/salarii/diurne/nimic) ·
# SELECT neschimbat · revenire = exact inițial · dus-întors.
# Utilizare: bash scripts/test_diurne_scriere.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR=/tmp/pg_diurne; PORT=5984; BAZA=diurne_test
NUME=20261023b_diurne_scriere_acces_diurne
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/diurne_scriere_schelet.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_diurne" ] || mediu "$DATE_DIR există și nu e fixture — nu îl șterg"
  [ -f "$DATE_DIR/postmaster.pid" ] && { ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; }
  rm -rf "$DATE_DIR"
fi
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_diurne"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_diurne.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null || esec "schelet"
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
pol() { q "SELECT md5(string_agg(polname::text||polcmd::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''), '|' ORDER BY polname)) FROM pg_policy WHERE polrelid IN ('public.diurna_payments'::regclass,'public.diurna_payment_details'::regclass)"; }
# matrice: pentru fiecare profil, în tranzacții anulate: INSERT plată+detaliu, UPDATE, DELETE (pe un rând seed), SELECT count
matrice() {
  local out=""
  for p in a b d f; do
    local uid="00000000-0000-0000-0000-00000000000$p" r=""
    for op in ins upd del sel; do
      case $op in
        ins) sql="WITH x AS (INSERT INTO public.diurna_payments(period_from) VALUES ('2026-10-01') RETURNING id) INSERT INTO public.diurna_payment_details(payment_id, days) SELECT id, 1 FROM x RETURNING 1;";;
        upd) sql="WITH a AS (UPDATE public.diurna_payments SET notes='x' RETURNING 1), b AS (UPDATE public.diurna_payment_details SET days=2 RETURNING 1) SELECT (SELECT count(*) FROM a)||'.'||(SELECT count(*) FROM b);";;
        del) sql="WITH b AS (DELETE FROM public.diurna_payment_details RETURNING 1), a AS (DELETE FROM public.diurna_payments RETURNING 1) SELECT (SELECT count(*) FROM a)||'.'||(SELECT count(*) FROM b);";;
        sel) sql="SELECT (SELECT count(*) FROM public.diurna_payments)||'.'||(SELECT count(*) FROM public.diurna_payment_details);";;
      esac
      v="$("${PSQL[@]}" -d "$BAZA" -At -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('test.uid','$uid',true);" -c "$sql" -c "ROLLBACK;" 2>&1 | grep -v '^\(BEGIN\|SET\|ROLLBACK\)$' | tail -1)"
      grep -q 'row-level security' <<<"$v" && v=REFUZ
      r+="$op=$v "
    done
    out+="$p: $r"$'\n'
  done
  printf '%s' "$out"
}
livreaza() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1; }
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261023b', 'DIURNE_SCRIERE_REVENIRE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1; }
refuz() { local o; if o="$(eval "$2")"; then esec "$1 a trecut"; fi; grep -q "$3" <<<"$o" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$o")"; [ "$(pol)" = "$4" ] || esec "$1 a schimbat politicile"; ok "refuz: $1"; }

q "INSERT INTO public.diurna_payments(period_from) VALUES ('2026-09-01'); INSERT INTO public.diurna_payment_details(payment_id, days) VALUES (1, 3);" >/dev/null
P0="$(pol)"; M0="$(matrice)"
echo "$M0"
grep -q '^d: ins=REFUZ upd=0.0 del=0.0 sel=1.1' <<<"$M0" && grep -q '^a: ins=1 upd=1.1 del=1.1' <<<"$M0" || esec "înainte: diurne ≠ doar citire"; ok "înainte: diurne = doar citire"

refuz "fără gardă" "\"\${PSQL[@]}\" -d $BAZA -f \"$MIGRARE\" 2>&1" "garda start invalida" "$P0"
q "CREATE ROLE altul SUPERUSER LOGIN" >/dev/null
refuz "alt utilizator" "\"$PG_BIN/psql\" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $PORT -U altul -d $BAZA --single-transaction -c \"SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);\" -f \"$MIGRARE\" 2>&1" "necesita postgres" "$P0"
q "ALTER POLICY diurna_payments_delete_owner ON public.diurna_payments USING (true)" >/dev/null; PX="$(pol)"
refuz "politică modificată" livreaza "preconditie politica diurna_payments.diurna_payments_delete_owner" "$PX"
q "ALTER POLICY diurna_payments_delete_owner ON public.diurna_payments USING ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true)))))" >/dev/null
[ "$(pol)" = "$P0" ] || esec "politică nerefăcută"


# P23-1: bariera owner-only pe can_access_diurne — comportament + refuz dacă lipsește
v="$("${PSQL[@]}" -d "$BAZA" -At -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-00000000000f',true);" \
  -c "UPDATE public.profiles SET can_access_diurne = true, can_access_salarii = true WHERE id = auth.uid();" -c "SELECT 'flag='||can_access_diurne||can_access_salarii FROM public.profiles WHERE id = auth.uid();" -c "ROLLBACK;" 2>&1 | grep '^flag=')"
[ "$v" = "flag=falsefalse" ] || esec "non-owner și-a pus singur bifa: $v"; ok "non-owner nu-și poate pune singur bifa diurne/salarii (trigger)"
v="$("${PSQL[@]}" -d "$BAZA" -At -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-00000000000f',true);" \
  -c "INSERT INTO public.profiles(id, can_access_diurne) VALUES ('00000000-0000-0000-0000-0000000000ee', true);" -c "ROLLBACK;" 2>&1 | grep -c 'row-level security' || true)"
[ "$v" = 1 ] || esec "non-owner a inserat profil"; ok "non-owner nu poate insera profil cu bifa"
q "ALTER TABLE public.profiles DISABLE TRIGGER trg_enforce_owner_only_salary_flags" >/dev/null
refuz "trigger dezactivat" livreaza "bariera owner-only" "$P0"
q "ALTER TABLE public.profiles ENABLE TRIGGER trg_enforce_owner_only_salary_flags" >/dev/null
q "CREATE POLICY profiles_insert_x ON public.profiles FOR INSERT WITH CHECK (true)" >/dev/null
refuz "politică INSERT în plus pe profiles" livreaza "politica INSERT pe profiles" "$P0"
q "DROP POLICY profiles_insert_x ON public.profiles" >/dev/null
q "ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY" >/dev/null
refuz "RLS oprit pe profiles" livreaza "RLS oprit pe profiles" "$P0"
q "ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY" >/dev/null
q "CREATE OR REPLACE FUNCTION public.enforce_owner_only_salary_flags() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS \$f\$ BEGIN RETURN NEW; END \$f\$" >/dev/null
refuz "funcția trigger înlocuită" livreaza "bariera owner-only" "$P0"
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/diurne_scriere_bariera.sql" >/dev/null || esec "bariera nerefăcută"
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE proname='enforce_owner_only_salary_flags'")" = daaa561298c10c259944600e6c39467e ] || esec "md5 barieră schelet ≠ live"; ok "bariera refăcută = corp live"
SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"; SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261009130000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/diurne_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/diurne_runner.out >&2; esec "runner cod $RC"; }; ok "runner: cod 0 (sha256 $SHA)"
P1="$(pol)"; M1="$(matrice)"; echo "$M1"
grep -q '^d: ins=1 upd=1.1 del=1.1 sel=1.1' <<<"$M1" || esec "după: diurne nu scrie"; ok "după: diurne salvează / modifică / șterge pe ambele tabele"
grep -q '^a: ins=1 upd=1.1 del=1.1' <<<"$M1" && grep -q '^f: ins=REFUZ upd=0.0 del=0.0 sel=0.0' <<<"$M1" || esec "owner/nimic: $M1"
grep -q '^b: ins=1 upd=1.1 del=0.0' <<<"$M1" || esec "salarii: $M1"; ok "owner neschimbat · fără drept: tot refuz · acces Salarii: neschimbat (fără ștergere)"

# traseul real din UI: DELETE doar pe plată, detaliile pleacă prin ON DELETE CASCADE
for p in a d; do
  v="$("${PSQL[@]}" -d "$BAZA" -At -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-00000000000$p',true);" \
    -c "WITH x AS (DELETE FROM public.diurna_payments RETURNING id) SELECT count(*) FROM x;" -c "RESET ROLE;" \
    -c "SELECT 'rest='||(SELECT count(*) FROM public.diurna_payments)||'.'||(SELECT count(*) FROM public.diurna_payment_details);" -c "ROLLBACK;" | grep -v '^\(BEGIN\|SET\|RESET\|ROLLBACK\)$' | tr '\n' ' ')"
  grep -q ' 1 rest=0.0' <<<"$v" || esec "cascadă $p: $v"
done; ok "ștergere din UI (doar plata) ca owner și ca acces diurne: plata + detaliile dispar (cascadă)"
v="$("${PSQL[@]}" -d "$BAZA" -At -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-00000000000b',true);" \
  -c "WITH x AS (DELETE FROM public.diurna_payments RETURNING id) SELECT count(*) FROM x;" -c "ROLLBACK;" | grep -v '^\(BEGIN\|SET\|ROLLBACK\)$' | tail -1)"
[ "$v" = 0 ] || esec "salarii a șters $v"; ok "acces Salarii: ștergerea plății = 0 rânduri"
q "SELECT 1" >/dev/null
refuz "reaplicare" livreaza "preconditie politica" "$P1"
refuz "revenire nearmată" "\"\${PSQL[@]}\" -d $BAZA -f \"$ROLLBACK\" 2>&1" "garda start invalida" "$P1"
q "ALTER DATABASE $BAZA SET gazpet.revenire_20261023b = 'x'" >/dev/null
refuz "armare persistentă" revenire "armare persistenta interzisa" "$P1"
q "ALTER DATABASE $BAZA RESET gazpet.revenire_20261023b" >/dev/null
o="$("${PSQL[@]}" -d "$BAZA" -At --single-transaction -c "SELECT set_config('gazpet.revenire_20261023b', 'DIURNE_SCRIERE_REVENIRE:' || txid_current(), true);" -f "$ROLLBACK" -c "SELECT 'GUC=' || coalesce(current_setting('gazpet.revenire_20261023b', true), '');" 2>&1)" || esec "revenire armată"
grep -q '^GUC=$' <<<"$o" || esec "revenirea nu dezarmează: $o"; ok "revenire dezarmată la succes"
[ "$(pol)" = "$P0" ] && [ "$(matrice)" = "$M0" ] || esec "revenire ≠ inițial"; ok "revenire: politici + matrice = EXACT inițial"
livreaza >/dev/null || esec "reaplicare după revenire"; [ "$(pol)" = "$P1" ] || esec "dus-întors"; ok "dus-întors"
echo PASS
