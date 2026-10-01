#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261006b_sec_garantii_iban. EXCLUSIV pe un PostgreSQL 17 local dedicat
# (implicit /tmp/pg_garantii_iban, 127.0.0.1:5974). Nu atinge producția.
# Bază: scheletul + migrarea 20261005b (#561) — din fișierele locale sau, dacă lipsesc pe branch, din
#   origin/claude/garantii-rls (git show) — + supabase/tests/garantii_iban_fixture.sql (tabela/view/RPC live).
#   0. gaura: „oarecine” (8) citește IBAN-ul din tabel, view și RPC
#   1. fișierul fără runner → refuz
#   2. precondiție negativă (coloană nouă în garantii) → refuz
#   3. runner (sha256 + gate 0e) → cod 0; matricea IBAN pe 9 identități × 3 căi; fluxurile UI (select explicit, insert,
#      update recepție, view select *) merg
#   4. reaplicare → refuz
#   5. revenire: nearmată → refuz; armată → starea live (8 citește iar IBAN-ul)
# Utilizare: bash scripts/test_sec_garantii_iban.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_garantii_iban}"
PORT="${PGPORT_TEST:-5974}"
BAZA=garantii_iban_test
NUME=20261006b_sec_garantii_iban
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
FIXTURE="$RADACINA/supabase/tests/garantii_iban_fixture.sql"
TMP="$(mktemp -d)"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
# dependența #561: fișierul local dacă există, altfel din branch-ul lui
dep() { if [ -f "$RADACINA/$1" ]; then cp "$RADACINA/$1" "$TMP/$(basename "$1")"; else git -C "$RADACINA" show "origin/claude/garantii-rls:$1" > "$TMP/$(basename "$1")" || mediu "lipsește $1 (#561)"; fi; }
dep supabase/tests/rls_garantii_schelet.sql
dep supabase/migrations/20261005b_rls_garantii_scriere.sql
chmod -R a+rX "$TMP"
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG17 lipsă ($PG_BIN)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_garantii_iban.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap 'rm -rf "$TMP"; [ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
# ca <uid-sufix|anon> <sql> → rezultatul (o linie) sau ERR
ca() {
  local rol=authenticated sub="00000000-0000-0000-0000-00000000000$1"; [ "$1" = anon ] && { rol=anon; sub=; }
  "${PSQL[@]}" -d "$BAZA" -At 2>/dev/null <<SQL | tail -1 || echo ERR
BEGIN;
SELECT set_config('request.jwt.claim.sub', '$sub', true) \g /dev/null
SET LOCAL ROLE $rol;
$2;
ROLLBACK;
SQL
}
IBAN=RO49AAAA1B31007593840000
T_TAB="SELECT coalesce(iban,'NULL') FROM public.garantii WHERE id = 1"
T_VIEW="SELECT coalesce(iban,'NULL') FROM public.v_garantii_situatie WHERE id = 1"
T_RPC="SELECT CASE WHEN corp LIKE '%$IBAN%' THEN 'IBAN' ELSE 'fara' END FROM public.garantii_adresa_eliberare(1)"
matrice() {  # <gaura|patch>
  local u e
  for u in 1 2 3 4 5 6 7 8 9; do
    if [ "$1" = gaura ]; then
      [ "$(ca $u "$T_TAB")" = "$IBAN" ] && [ "$(ca $u "$T_VIEW")" = "$IBAN" ] && [ "$(ca $u "$T_RPC")" = IBAN ] || esec "gaura: user $u nu citește IBAN-ul"
    else
      case $u in 1|2|3|4|5|9) e=1 ;; *) e=0 ;; esac
      [ "$(ca $u "$T_TAB")" = ERR ] || esec "patch: user $u citește garantii.iban direct din tabel"
      if [ $e = 1 ]; then
        [ "$(ca $u "$T_VIEW")" = "$IBAN" ] || esec "patch: scriitorul $u nu vede IBAN-ul în view"
        [ "$(ca $u "$T_RPC")" = IBAN ] || esec "patch: scriitorul $u nu are IBAN în adresă"
      else
        [ "$(ca $u "$T_VIEW")" = NULL ] || esec "patch: user $u vede IBAN-ul în view"
        [ "$(ca $u "$T_RPC")" = fara ] || esec "patch: user $u are IBAN în adresă"
      fi
      # fluxurile UI: GarantiiRegistru (view select *), OfertareGarantieRegistru (select explicit)
      [ "$(ca $u "SELECT count(*) FROM (SELECT * FROM public.v_garantii_situatie) x")" = 1 ] || esec "patch: user $u — view select * cade"
      [ "$(ca $u "SELECT count(*) FROM (SELECT id, stare, valoare, moneda, data_emitere, data_expirare, numar_document, emitent, forma FROM public.garantii) x")" = 1 ] || esec "patch: user $u — select explicit cade"
    fi
  done
  ok "matrice $1 (9 identități × tabel/view/RPC)"
}

"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$TMP/rls_garantii_schelet.sql" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$FIXTURE" >/dev/null
"${PSQL[@]}" -d "$BAZA" -c "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '20261005b_rls_garantii_scriere:' || txid_current(), true);" -f "$TMP/20261005b_rls_garantii_scriere.sql" >/dev/null || esec "baza: 20261005b nu s-a aplicat"
matrice gaura
ok "0 bază = live (20261005b + garantii/view/RPC live); oarecine citește IBAN-ul pe 3 căi"

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
ok "1 fără runner → refuz"

q "ALTER TABLE public.garantii ADD COLUMN extra text" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null 2>&1 && esec "2 precondiție negativă a trecut"
q "ALTER TABLE public.garantii DROP COLUMN extra" >/dev/null
ok "2 coloană nouă în garantii → precondiția 0c refuză"

SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261006000002 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >"$TMP/runner.out" 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat "$TMP/runner.out" >&2; esec "3 runner cod $RC"; }
[ "$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql" | grep -c . || true)" = 0 ] || esec "gate 0e"
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA"
matrice patch
[ "$(ca 5 "WITH x AS (INSERT INTO public.garantii (tip, beneficiar, licitatie_id) VALUES ('participare','X',7) RETURNING 1) SELECT count(*) FROM x")" = 1 ] || esec "3 insert scriitor (OfertareGarantieRegistru)"
[ "$(ca 3 "WITH x AS (UPDATE public.garantii SET lucrare_receptionata = true, data_receptie = current_date, document_receptie = 'PV' WHERE id = 1 RETURNING 1) SELECT count(*) FROM x")" = 1 ] || esec "3 update recepție (GarantiiRegistru)"
[ "$(ca 3 "WITH x AS (UPDATE public.garantii SET iban = 'RO00' WHERE id = 1 RETURNING 1) SELECT count(*) FROM x")" = 1 ] || esec "3 scriitorul nu mai poate modifica iban"
[ "$(ca 8 "WITH x AS (UPDATE public.garantii SET lucrare_receptionata = true WHERE id = 1 RETURNING 1) SELECT count(*) FROM x")" = 0 ] || esec "3 oarecine scrie (RLS 20261005b)"
[ "$(ca 8 "SELECT coalesce(public.fn_garantie_iban(1),'NULL')")" = NULL ] || esec "3 fn_garantie_iban direct pentru oarecine"
[ "$(ca anon "SELECT public.fn_garantie_iban(1)")" = ERR ] || esec "3 anon execută fn_garantie_iban"
ok "3 fluxuri UI: insert/update scriitor ok; oarecine nu scrie; fn_garantie_iban → NULL pentru oarecine, refuz pentru anon"

"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null 2>&1 && esec "4 reaplicare a trecut"
ok "4 reaplicare → refuz"

"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >/dev/null 2>&1 && esec "5 revenire nearmată a trecut"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.rollback_tehnic_20261006b', 'REDESCHIDE_IBAN_GARANTII:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null || esec "5 revenire armată"
q "UPDATE public.garantii SET iban = '$IBAN' WHERE id = 1" >/dev/null
matrice gaura
ok "5 revenire: nearmată refuz; armată → starea live"
echo "PASS test_sec_garantii_iban (sha256 $SHA)"
