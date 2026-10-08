#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261021a_conturi_registru_v1 (Administrativ → 🔐 Conturi). EXCLUSIV pe un PostgreSQL local dedicat
# (implicit PG16, /tmp/pg_conturi, 127.0.0.1:5981). Nu atinge producția.
#   0. schelet (supabase/tests/conturi_registru_schelet.sql) — default privileges + set_updated_at ca pe live
#   1. fișierul fără runner → garda refuză, nimic creat
#   2. precondiții negative: set_updated_at alt corp · tabel preexistent · CREATE pe public pentru authenticated
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + validator + gate 0e) → cod 0
#   4. teste SQL (supabase/tests/conturi_registru.test.sql): RLS owner/non-owner/fără profil/anon, CHECK-uri, trigger
#   5. reaplicare → refuz
#   6. revenire: nearmată → refuz; cu rânduri → refuz (date reale); goală + armată → tabelul dispare, set_updated_at
#      neatinsă, gate 0e = 0
# Utilizare: bash scripts/test_conturi_registru.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_conturi}"
PORT="${PGPORT_TEST:-5981}"
BAZA=conturi_test
NUME=20261021a_conturi_registru_v1
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/conturi_registru_schelet.sql"
TESTE="$RADACINA/supabase/tests/conturi_registru.test.sql"
MD5_SUA=1c4318bee4240d4113d86fad7eb15623
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
case "$DATE_DIR" in /tmp/pg_conturi*) ;; *) mediu "PGDATA_TEST trebuie să fie sub /tmp/pg_conturi* (primit: $DATE_DIR)";; esac
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_conturi" ] || mediu "$DATE_DIR există și nu e marcat ca fixture (.fixture_conturi) — nu îl șterg"
  if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; fi
  rm -rf "$DATE_DIR"
fi
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_conturi"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_conturi.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
gate_0e() { local o; o="$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql")" || esec "gate 0e: psql a eșuat"; [ -z "$o" ] || esec "gate 0e: $o"; ok "gate 0e = 0 ($1)"; }
refuza_cu() { local out; if out="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1)"; then esec "$1 a trecut"; fi
  grep -q "$2" <<<"$out" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$out")"; }
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261021a', 'CONTURI_REGISTRU_SCOATE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1; }

"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.set_updated_at()'::regprocedure")" = $MD5_SUA ] || esec "0 set_updated_at din schelet ≠ live ($MD5_SUA)"
gate_0e inainte
ok "0 schelet (default privileges + set_updated_at ca pe live)"

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
[ "$(q "SELECT count(*) FROM pg_class WHERE relname LIKE 'conturi_registru%'")" = 0 ] || esec "1 ceva s-a creat"
# 1b (r2, J16-1): rulare GREȘITĂ cu psql -f simplu — autocommit, fără ON_ERROR_STOP, fără -1: nimic creat
"$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 || true
[ "$(q "SELECT count(*) FROM pg_class WHERE relname LIKE 'conturi_registru%'")" = 0 ] || esec "1b psql -f simplu a creat obiecte"
ok "1 fără runner → refuz, nimic creat (și cu psql -f simplu, autocommit)"

q "CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS \$f\$ begin return new; end; \$f\$" >/dev/null
refuza_cu "2a set_updated_at alt corp" "Precondiție 0d"
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/conturi_registru_set_updated_at.sql" >/dev/null
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.set_updated_at()'::regprocedure")" = $MD5_SUA ] || esec "2a set_updated_at nerefăcută"
q "CREATE TABLE public.conturi_registru (id int)" >/dev/null
refuza_cu "2b tabel preexistent" "Precondiție 0b"
q "DROP TABLE public.conturi_registru" >/dev/null
q "GRANT CREATE ON SCHEMA public TO authenticated" >/dev/null
refuza_cu "2c CREATE pe public pentru authenticated" "Precondiție 0f"
q "REVOKE CREATE ON SCHEMA public FROM authenticated" >/dev/null
[ "$(q "SELECT count(*) FROM pg_class WHERE relname LIKE 'conturi_registru%'")" = 0 ] || esec "2 ceva a rămas"
ok "2 refuz la: set_updated_at alt corp · tabel preexistent · CREATE pe public"

SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261008120000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/conturi_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/conturi_runner.out >&2; esec "3 runner cod $RC"; }
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA"
gate_0e dupa

OUT="$("${PSQL[@]}" -d "$BAZA" -f "$TESTE" 2>&1)" || { echo "$OUT" | grep -v 'NOTICE:  OK' | grep -E 'ERROR|TEST' >&2; esec "4 teste SQL"; }
N="$(grep -c 'NOTICE:  OK' <<<"$OUT")"
grep -q 'TESTE SQL: TOATE OK' <<<"$OUT" || esec "4 testele nu au ajuns la final"
ok "4 teste SQL: $N verificări OK"

refuza_cu "5 reaplicare" "Precondiție 0b"
ok "5 reaplicare → refuz"

OUT="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" 2>&1)" && esec "6a revenire nearmată a trecut"
grep -q "nearmată" <<<"$OUT" || esec "6a refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
OUT="$(revenire)" && esec "6b revenire cu rânduri a trecut"
grep -q "date reale" <<<"$OUT" || esec "6b refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
[ "$(q "SELECT count(*) FROM public.conturi_registru")" = 5 ] || esec "6b rândurile au dispărut"
# 6f (review intern P1): rulare GREȘITĂ cu psql -f simplu — autocommit, fără ON_ERROR_STOP, fără -1, nearmată și armată
#    pe sesiune (fără tranzacție): nimic nu se pierde, tabelul și rândurile rămân
"$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -f "$ROLLBACK" >/dev/null 2>&1 || true
"$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -c "SELECT set_config('gazpet.revenire_20261021a', 'CONTURI_REGISTRU_SCOATE:' || txid_current(), false)" -f "$ROLLBACK" >/dev/null 2>&1 || true
[ "$(q "SELECT count(*) FROM public.conturi_registru")" = 5 ] || esec "6f psql -f simplu a șters date"
q "CREATE VIEW public.v_conturi_test AS SELECT id FROM public.conturi_registru" >/dev/null
q "DELETE FROM public.conturi_registru" >/dev/null
OUT="$(revenire)" && esec "6c revenire cu view dependent a trecut"
grep -q "view-uri" <<<"$OUT" || esec "6c refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
q "DROP VIEW public.v_conturi_test" >/dev/null
q "ALTER TABLE public.conturi_registru ADD COLUMN extra text" >/dev/null
OUT="$(revenire)" && esec "6d revenire pe tabel modificat a trecut"
grep -q "amprenta tabelului diferă" <<<"$OUT" || esec "6d refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
q "ALTER TABLE public.conturi_registru DROP COLUMN extra" >/dev/null
# 6g (r2, P15-3/J16-4): aceleași nume, altă definiție → amprenta prinde (politică slăbită, default nou)
q "ALTER POLICY conturi_registru_upd ON public.conturi_registru USING (true)" >/dev/null
OUT="$(revenire)" && esec "6g revenire după ALTER POLICY a trecut"
grep -q "amprenta tabelului diferă" <<<"$OUT" || esec "6g refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
q "ALTER POLICY conturi_registru_upd ON public.conturi_registru USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner))" >/dev/null
q "ALTER TABLE public.conturi_registru ALTER COLUMN observatii SET DEFAULT 'x'" >/dev/null
OUT="$(revenire)" && esec "6h revenire după default nou a trecut"
grep -q "amprenta tabelului diferă" <<<"$OUT" || esec "6h refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
q "ALTER TABLE public.conturi_registru ALTER COLUMN observatii DROP DEFAULT" >/dev/null
OUT="$(revenire)" || { echo "$OUT" >&2; esec "6e revenirea armată pe tabel gol a eșuat"; }
[ "$(q "SELECT count(*) FROM pg_class WHERE relname LIKE 'conturi_registru%'")" = 0 ] || esec "6e obiecte rămase"
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.set_updated_at()'::regprocedure")" = $MD5_SUA ] || esec "6e set_updated_at atinsă"
ok "6 revenire: nearmată → refuz · cu rânduri → refuz · psql -f simplu (autocommit) → nimic pierdut · cu view dependent → refuz · tabel modificat / politică slăbită / default nou (amprentă) → refuz · goală + armată → scoasă, set_updated_at neatinsă"
gate_0e final
echo "PASS test_conturi_registru"
