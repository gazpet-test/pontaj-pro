#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261002d_sec_gbe_iban. EXCLUSIV pe un PostgreSQL 17 local dedicat
# (implicit /tmp/pg_gbe_iban, 127.0.0.1:5975). Nu atinge producția.
# Bază: scheletul + migrarea 20261005b (#561) — din fișierele locale sau, dacă lipsesc pe branch, din
#   origin/claude/garantii-rls (git show) — + supabase/tests/sec_gbe_iban_fixture.sql (contracte_terti/view LIVE, autoverificat).
#   S. static: interogarea 0e din migrare = scripts/control_0e.sql (identic, normalizat); niciun workflow nu referă supabase/revenire/
#   0. gaura: toate cele 9 identități citesc IBAN-ul din tabel și din view
#   1. fișierul fără runner → refuz
#   2. precondiții negative: coloană nouă în contracte_terti (0c) → refuz; IBAN cu spațiu la margine (0i) → refuz
#   3. runner (sha256 + gate 0e) → cod 0; matricea IBAN pe 9 identități × tabel/view/RPC/tabela nouă; fluxurile UI
#      (select * pe tabel și view, UPDATE câmpuri GBE, set/ștergere IBAN, contract inexistent, cascade la ștergerea contractului)
#   4. reaplicare → refuz
#   5. revenire: nearmată → refuz; armată → starea live (8 citește iar IBAN-ul; view md5 live; coloana readăugată cu valorile)
# Utilizare: bash scripts/test_sec_gbe_iban.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_gbe_iban}"
PORT="${PGPORT_TEST:-5975}"
BAZA=gbe_iban_test
NUME=20261002d_sec_gbe_iban
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
FIXTURE="$RADACINA/supabase/tests/sec_gbe_iban_fixture.sql"
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

# S. static — interogarea 0e din migrare e IDENTICĂ cu scripts/control_0e.sql (normalizat linie cu linie, ca în test_conturi_ciclu_viata.sh)
n="$(python3 - "$MIGRARE" "$RADACINA/scripts/control_0e.sql" <<'PY'
import re, sys
def qs(p):
    return ["\n".join(l.strip() for l in m.split("\n")) for m in re.findall(r"(-- SEC F2 0e \(r8\).*?ORDER BY 1)[;\n]", open(p, encoding="utf-8").read(), re.S)]
a, c = qs(sys.argv[1]), qs(sys.argv[2])
if len(c) != 1 or not a or len(set(a + c)) != 1:
    print("diferă/lipsesc: fișier %d, control %d, distincte %d" % (len(a), len(c), len(set(a + c)))); sys.exit(1)
print(len(a))
PY
)" || esec "S interogarea 0e din migrare nu e identică cu scripts/control_0e.sql ($n)"
grep -rq "supabase/revenire" "$RADACINA/.github/workflows" 2>/dev/null && esec "S un workflow referă supabase/revenire/"
grep -v '^[[:space:]]*--' "$MIGRARE" | grep -qi '^[[:space:]]*\(BEGIN\|COMMIT\)[[:space:]]*;' && esec "S migrarea conține BEGIN/COMMIT la nivel superior"
grep -v '^[[:space:]]*--' "$ROLLBACK" | grep -qi '^[[:space:]]*\(BEGIN\|COMMIT\)[[:space:]]*;' && esec "S revenirea conține BEGIN/COMMIT la nivel superior"
ok "S static: gate 0e identic cu control_0e.sql (×$n); fără BEGIN/COMMIT; niciun workflow nu referă supabase/revenire/"

ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG17 lipsă ($PG_BIN)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_gbe_iban.log -w -t 30 start \
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
# ca_tine — la fel, dar cu COMMIT (pentru scrieri a căror urmare se verifică după)
ca_tine() {
  local rol=authenticated sub="00000000-0000-0000-0000-00000000000$1"; [ "$1" = anon ] && { rol=anon; sub=; }
  "${PSQL[@]}" -d "$BAZA" -At 2>/dev/null <<SQL | tail -1 || echo ERR
BEGIN;
SELECT set_config('request.jwt.claim.sub', '$sub', true) \g /dev/null
SET LOCAL ROLE $rol;
$2;
COMMIT;
SQL
}
IBAN='RO49AAAA1B31007593840000 Banca Transilvania'
IBAN3=RO15RNCB0000000000000003
T_TAB="SELECT coalesce(gbe_cont_iban,'NULL') FROM public.contracte_terti WHERE id = 1"
T_VIEW="SELECT coalesce(gbe_cont_iban,'NULL') FROM public.v_gbe_per_contract WHERE contract_id = 1"
T_RPC="SELECT coalesce(public.fn_gbe_cont_iban(1),'NULL')"
T_RPC3="SELECT coalesce(public.fn_gbe_cont_iban(3),'NULL')"
matrice() {  # <gaura|patch>
  local u e
  for u in 1 2 3 4 5 6 7 8 9; do
    if [ "$1" = gaura ]; then
      [ "$(ca $u "$T_TAB")" = "$IBAN" ] && [ "$(ca $u "$T_VIEW")" = "$IBAN" ] || esec "gaura: user $u nu citește IBAN-ul din tabel/view"
    else
      case $u in 1|2|3|4|5|9) e=1 ;; *) e=0 ;; esac
      [ "$(ca $u "$T_TAB")" = ERR ] || esec "patch: user $u mai citește contracte_terti.gbe_cont_iban"
      [ "$(ca $u "SELECT iban FROM public.contracte_terti_gbe_cont WHERE contract_id = 1")" = ERR ] || esec "patch: user $u citește contracte_terti_gbe_cont direct"
      if [ $e = 1 ]; then
        [ "$(ca $u "$T_VIEW")" = "$IBAN" ] || esec "patch: scriitorul $u nu vede IBAN-ul în view"
        [ "$(ca $u "$T_RPC")" = "$IBAN" ] || esec "patch: scriitorul $u nu primește IBAN-ul prin RPC"
        [ "$(ca $u "$T_RPC3")" = "$IBAN3" ] || esec "patch: scriitorul $u nu primește IBAN-ul C3 (în afara view-ului) prin RPC"
      else
        [ "$(ca $u "$T_VIEW")" = NULL ] || esec "patch: user $u vede IBAN-ul în view"
        [ "$(ca $u "$T_RPC")" = NULL ] || esec "patch: user $u primește IBAN-ul prin RPC"
        [ "$(ca $u "WITH x AS (SELECT public.fn_gbe_cont_iban_set(2, 'RO11') AS r) SELECT r FROM x")" = ERR ] || esec "patch: user $u scrie IBAN-ul"
      fi
      # fluxurile UI: select('*') pe contracte_terti (4 ecrane) și pe view (GbeEvidenta) merg pentru toți
      [ "$(ca $u "SELECT count(*) FROM (SELECT * FROM public.contracte_terti) x")" = 3 ] || esec "patch: user $u — select * pe contracte_terti cade"
      [ "$(ca $u "SELECT count(*) FROM (SELECT * FROM public.v_gbe_per_contract) x")" = 2 ] || esec "patch: user $u — select * pe v_gbe_per_contract cade"
    fi
  done
  ok "matrice $1 (9 identități × tabel/view/RPC/tabela nouă)"
}

"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$TMP/rls_garantii_schelet.sql" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$FIXTURE" >/dev/null || esec "fixture: autoverificarea față de live a căzut"
"${PSQL[@]}" -d "$BAZA" -c "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '20261005b_rls_garantii_scriere:' || txid_current(), true);" -f "$TMP/20261005b_rls_garantii_scriere.sql" >/dev/null || esec "baza: 20261005b nu s-a aplicat"
matrice gaura
[ "$(ca anon "$T_TAB")" = NULL ] || true   # anon: RLS ⇒ 0 rânduri (tail -1 gol) sau NULL — nu e subiectul patch-ului
ok "0 bază = live (20261005b + contracte_terti/view live, fixture autoverificat); oricine citește IBAN-ul pe 2 căi"

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
ok "1 fără runner → refuz"

q "ALTER TABLE public.contracte_terti ADD COLUMN extra text" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null 2>&1 && esec "2a precondiție 0c negativă a trecut"
q "ALTER TABLE public.contracte_terti DROP COLUMN extra" >/dev/null
q "UPDATE public.contracte_terti SET gbe_cont_iban = gbe_cont_iban || ' ' WHERE id = 3" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null 2>&1 && esec "2b precondiție 0i negativă a trecut"
q "UPDATE public.contracte_terti SET gbe_cont_iban = btrim(gbe_cont_iban) WHERE id = 3" >/dev/null
[ "$(q "SELECT gbe_cont_iban FROM public.contracte_terti WHERE id = 3")" = "$IBAN3" ] || esec "2b restaurare"
ok "2 coloană nouă (0c) / IBAN cu spațiu la margine (0i) → precondițiile refuză; nimic schimbat"

SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261002000004 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >"$TMP/runner.out" 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat "$TMP/runner.out" >&2; esec "3 runner cod $RC"; }
[ "$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql" | grep -c . || true)" = 0 ] || esec "gate 0e"
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA"
[ "$(q "SELECT count(*) FROM public.contracte_terti_gbe_cont")" = 2 ] || esec "3 datele: tabela nouă trebuie să aibă 2 rânduri (C1, C3)"
[ "$(q "SELECT iban FROM public.contracte_terti_gbe_cont WHERE contract_id = 1")" = "$IBAN" ] || esec "3 datele: C1 nu e copiat verbatim"
[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='contracte_terti' AND column_name='gbe_cont_iban'")" = 0 ] || esec "3 coloana veche încă există"
matrice patch
# scriitorul (3 = contabilitate): scrie, citește înapoi, btrim, șterge cu gol, contract inexistent → eroare; celelalte câmpuri GBE prin UPDATE direct
[ "$(ca_tine 3 "SELECT public.fn_gbe_cont_iban_set(2, '  RO22BBBB0000000000000002  ')")" = t ] || esec "3 set scriitor"
[ "$(ca 3 "SELECT public.fn_gbe_cont_iban(2)")" = RO22BBBB0000000000000002 ] || esec "3 set: valoarea nu e btrim-uită / nu se citește înapoi"
[ "$(q "SELECT actualizat_de FROM public.contracte_terti_gbe_cont WHERE contract_id = 2")" = 00000000-0000-0000-0000-000000000003 ] || esec "3 set: actualizat_de ≠ auth.uid()"
[ "$(ca 8 "$T_VIEW")" = NULL ] && [ "$(ca 3 "SELECT coalesce(gbe_cont_iban,'NULL') FROM public.v_gbe_per_contract WHERE contract_id = 2")" = RO22BBBB0000000000000002 ] || esec "3 view după set"
[ "$(ca_tine 5 "SELECT public.fn_gbe_cont_iban_set(2, '')")" = t ] || esec "3 ștergere cu gol (scriitor financiar.garantii editor)"
[ "$(q "SELECT count(*) FROM public.contracte_terti_gbe_cont WHERE contract_id = 2")" = 0 ] || esec "3 ștergere: rândul a rămas"
[ "$(ca 3 "SELECT public.fn_gbe_cont_iban_set(999, 'RO99')")" = ERR ] || esec "3 contract inexistent acceptat"
[ "$(ca 3 "SELECT public.fn_gbe_cont_iban_set(2, repeat('X', 201))")" = ERR ] || esec "3 IBAN de 201 caractere acceptat"
[ "$(ca 6 "SELECT public.fn_gbe_cont_iban_set(2, 'RO66')")" = ERR ] || esec "3 viewer-ul de garanții scrie IBAN"
[ "$(ca anon "SELECT public.fn_gbe_cont_iban(1)")" = ERR ] && [ "$(ca anon "SELECT public.fn_gbe_cont_iban_set(1, 'RO00')")" = ERR ] || esec "3 anon execută funcțiile"
[ "$(ca 3 "WITH x AS (UPDATE public.contracte_terti SET gbe_cont_valabil_pana = current_date WHERE id = 1 RETURNING 1) SELECT count(*) FROM x")" = 1 ] || esec "3 UPDATE câmpuri GBE (scriitor) cade"
[ "$(ca 7 "WITH x AS (UPDATE public.contracte_terti SET denumire = 'C1 bis' WHERE id = 1 RETURNING 1) SELECT count(*) FROM x")" = 1 ] || esec "3 UPDATE contract (can_manage_contracts) cade"
[ "$(ca 8 "WITH x AS (UPDATE public.contracte_terti SET gbe_observatii = 'x' WHERE id = 1 RETURNING 1) SELECT count(*) FROM x")" = 0 ] || esec "3 oarecine scrie pe contracte_terti (RLS 20261005b)"
# cascade: owner-ul șterge contractul 3 ⇒ rândul din tabela nouă dispare (acțiunea referențială rulează cu drepturile proprietarului)
[ "$(ca_tine 1 "WITH x AS (DELETE FROM public.contracte_terti WHERE id = 3 RETURNING 1) SELECT count(*) FROM x")" = 1 ] || esec "3 owner-ul nu poate șterge contractul 3"
[ "$(q "SELECT count(*) FROM public.contracte_terti_gbe_cont WHERE contract_id = 3")" = 0 ] || esec "3 cascade: IBAN-ul C3 a rămas orfan"
q "INSERT INTO public.contracte_terti (id, beneficiar_id, numar_contract, denumire, status, gbe_tip) VALUES (3, 1, 'C3/2026', 'Contract 3', 'activ', 'polita'); INSERT INTO public.contracte_terti_gbe_cont (contract_id, iban) VALUES (3, '$IBAN3')" >/dev/null
ok "3 fluxuri UI: set/citire/btrim/ștergere scriitor; refuz pentru oarecine/viewer/anon/contract inexistent/201 caractere; UPDATE GBE și contract neschimbate; cascade"

"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null 2>&1 && esec "4 reaplicare a trecut"
ok "4 reaplicare → refuz"

"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >/dev/null 2>&1 && esec "5 revenire nearmată a trecut"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.rollback_tehnic_20261002d', 'REDESCHIDE_IBAN_GBE:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null || esec "5 revenire armată"
matrice gaura
[ "$(q "SELECT gbe_cont_iban FROM public.contracte_terti WHERE id = 3")" = "$IBAN3" ] || esec "5 revenire: C3 nu e înapoi în coloană"
[ "$(q "SELECT coalesce(gbe_cont_iban,'NULL') FROM public.contracte_terti WHERE id = 2")" = NULL ] || esec "5 revenire: C2 are IBAN"
[ "$(q "SELECT md5(pg_get_viewdef('public.v_gbe_per_contract'::regclass))")" = b9861ba0ac5ffe289fdc1f82a4c09f5c ] || esec "5 revenire: view ≠ live"
ok "5 revenire: nearmată refuz; armată → starea live (coloana cu valorile, view md5 live, funcții/tabelă scoase)"
echo "PASS test_sec_gbe_iban (sha256 $SHA)"
