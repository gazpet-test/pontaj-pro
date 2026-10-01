#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261005b_rls_garantii_scriere. EXCLUSIV pe un PostgreSQL 17 local dedicat
# (implicit /tmp/pg_rls_garantii, 127.0.0.1:5972). Nu atinge producția.
#   0. schelet (supabase/tests/rls_garantii_schelet.sql) = politicile live din 01.10 (md5 62f69c59…) → atacul reușește
#   1. fișierul fără runner → garda refuză, nimic schimbat
#   2. precondiție negativă (politică în plus) → refuz
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + gate 0e) → cod 0; matricea de acces PATCH
#   4. reaplicare cu marcaj → refuz (helper există)
#   5. revenire: nearmată → refuz; armată → starea live (md5 62f69c59…), atacul reușește din nou
# Utilizare: bash scripts/test_rls_garantii.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_rls_garantii}"
PORT="${PGPORT_TEST:-5972}"
BAZA=rls_garantii_test
NUME=20261005b_rls_garantii_scriere
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/rls_garantii_schelet.sql"
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
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_rls_garantii.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
MD5_POL="SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')), E'\n' ORDER BY tablename, policyname),'')) FROM pg_policies WHERE schemaname='public' AND tablename = ANY(ARRAY['contracte_terti','garantii','gbe_polite','gbe_restituiri'])"
gate_0e() { local n; n="$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql" | grep -c . || true)"; [ "$n" = 0 ] || esec "gate 0e: $n rânduri"; ok "gate 0e = 0 ($1)"; }

# poate <uid-sufix> <sql> → „da” dacă instrucțiunea a afectat ≥1 rând ca authenticated cu uid-ul dat (anulat la final)
poate() {
  local uid="00000000-0000-0000-0000-00000000000$1" out
  out="$("${PSQL[@]}" -d "$BAZA" -At 2>/dev/null <<SQL || true
BEGIN;
SELECT set_config('request.jwt.claim.sub', '$uid', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE IF NOT EXISTS _n (n int) ON COMMIT DROP;
WITH x AS ($2 RETURNING 1) SELECT 'R' || count(*) FROM x;
ROLLBACK;
SQL
)"
  case "$out" in *R0*|"") echo nu ;; *R[1-9]*) echo da ;; *) echo nu ;; esac
}
# matrice <mod: gaura|patch>
matrice() {
  local mod=$1 u t a e
  # cine: 1 owner 2 superadmin 3 contabilitate 4 financiar:editor 5 financiar.garantii:editor 6 garantii:viewer 7 can_manage_contracts 8 oarecine 9 admin_logistica
  for t in "garantii|INSERT INTO public.garantii (tip, beneficiar) VALUES ('participare','X')" \
           "garantii|UPDATE public.garantii SET beneficiar='Y'" \
           "garantii|DELETE FROM public.garantii" \
           "gbe_polite|INSERT INTO public.gbe_polite (contract_id, valoare) VALUES (1, 1)" \
           "gbe_polite|UPDATE public.gbe_polite SET valoare=2" \
           "gbe_polite|DELETE FROM public.gbe_polite" \
           "gbe_restituiri|INSERT INTO public.gbe_restituiri (contract_id, valoare_lei) VALUES (1, 1)" \
           "gbe_restituiri|UPDATE public.gbe_restituiri SET valoare_lei=2" \
           "gbe_restituiri|DELETE FROM public.gbe_restituiri" \
           "ct_ins|INSERT INTO public.contracte_terti (denumire) VALUES ('N')" \
           "ct_upd|UPDATE public.contracte_terti SET gbe_procent=5" \
           "ct_del|DELETE FROM public.contracte_terti"; do
    local tab="${t%%|*}" sql="${t#*|}"
    for u in 1 2 3 4 5 6 7 8 9; do
      a="$(poate "$u" "$sql")"
      if [ "$mod" = gaura ]; then e=da; else
        case "$tab" in
          garantii|gbe_polite|gbe_restituiri) case $u in 1|2|3|4|5) e=da ;; *) e=nu ;; esac ;;
          ct_ins) case $u in 1|7) e=da ;; *) e=nu ;; esac ;;
          ct_upd) case $u in 1|2|3|4|5|7) e=da ;; *) e=nu ;; esac ;;
          ct_del) case $u in 1) e=da ;; *) e=nu ;; esac ;;
        esac
      fi
      [ "$a" = "$e" ] || esec "matrice $mod: user $u pe «$sql» → $a (așteptat $e)"
    done
  done
  # citirea: identică pentru toți (inclusiv 8, 9)
  for u in 1 6 8 9; do
    local r; r="$("${PSQL[@]}" -d "$BAZA" -At -c "BEGIN; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000$u',true); SET LOCAL ROLE authenticated; SELECT (SELECT count(*) FROM garantii)||'/'||(SELECT count(*) FROM gbe_polite)||'/'||(SELECT count(*) FROM gbe_restituiri)||'/'||(SELECT count(*) FROM contracte_terti); ROLLBACK;" | grep /)"
    [ "$r" = "1/1/1/1" ] || esec "citire $mod user $u: $r"
  done
  ok "matrice de acces $mod (9 identități × 12 operații + citire)"
}

"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
"${PSQL[@]}" -d "$BAZA" -c "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);" >/dev/null
[ "$(q "$MD5_POL")" = 62f69c5942960f9e30c0a3c3c04d5e26 ] || esec "0 scheletul nu reproduce md5-ul live"
ok "0 schelet = politicile live (md5 62f69c59…)"
matrice gaura

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
[ "$(q "$MD5_POL")" = 62f69c5942960f9e30c0a3c3c04d5e26 ] || esec "1 stare schimbată"
ok "1 fără runner → refuz"

q "CREATE POLICY extra ON public.garantii FOR SELECT TO authenticated USING (true)" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null 2>&1 && esec "2 precondiție negativă a trecut"
q "DROP POLICY extra ON public.garantii" >/dev/null
ok "2 politică în plus → refuz"

SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261005000002 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/rls_gar_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/rls_gar_runner.out >&2; esec "3 runner cod $RC"; }
[ "$(q "$MD5_POL")" = baf4acedb64d79573a83804196d6b156 ] || esec "3 md5 post"
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA"
gate_0e patch
matrice patch
[ "$(q "SELECT has_function_privilege('anon','public.fn_poate_scrie_garantii()','EXECUTE')")" = f ] || esec "anon are EXECUTE pe helper"

"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null 2>&1 && esec "4 reaplicare a trecut"
ok "4 reaplicare → refuz"

"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >/dev/null 2>&1 && esec "5 revenire nearmată a trecut"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261005b', 'REDESCHIDE_GARANTII:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null || esec "5 revenire armată"
[ "$(q "$MD5_POL")" = 62f69c5942960f9e30c0a3c3c04d5e26 ] || esec "5 md5 după revenire"
matrice gaura
ok "5 revenire: nearmată refuz; armată → starea live"
echo "PASS test_rls_garantii (sha256 $SHA)"
