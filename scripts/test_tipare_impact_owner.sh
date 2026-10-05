#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261015a_clarificari_tipare_impact_owner. EXCLUSIV pe un PostgreSQL 17 local dedicat
# (implicit /tmp/pg_tipare_impact, 127.0.0.1:5977). Nu atinge producția.
#   0. schelet (supabase/tests/tipare_impact_owner_schelet.sql) = drepturile live + 3 tipare (2 cu impact) ·
#      starea de azi: colegul citește impact_intern (bug-ul)
#   1. fișierul fără runner → garda refuză, nimic schimbat
#   2. precondiții negative: coloană nouă · drept pe coloană existent · policy schimbat · fn_is_app_owner ≠ live ·
#      funcția există deja
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + gate 0e) → cod 0; și pe o bază cu EXECUTE implicit pentru
#      PUBLIC/anon (REVOKE-ul din migrare chiar contează)
#   4. comportament: coleg/owner nu mai citesc impact_intern prin tabel (nici select *) · listele de coloane din UI și
#      interogarea din fn_temei_citat_verifica merg · funcția: owner 2 rânduri ordonate, coleg / fără JWT 0, anon refuzat ·
#      service_role citește tot · owner mai poate scrie (UPDATE), colegul nu
#   5. reaplicare → refuz
#   6. revenire: nearmată / armare persistentă / deviere (drept pe impact_intern, corp, search_path, volatilitate) → refuz;
#      armată → drepturile exact ca în 20261007a, funcția scoasă, colegul citește din nou (starea de dinainte)
# Utilizare: bash scripts/test_tipare_impact_owner.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_tipare_impact}"
PORT="${PGPORT_TEST:-5977}"
BAZA=tipare_impact_test
NUME=20261015a_clarificari_tipare_impact_owner
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/tipare_impact_owner_schelet.sql"
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
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_tipare_impact.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "${DB:-$BAZA}" -Atc "$1"; }
gate_0e() { local n; n="$("${PSQL[@]}" -d "${DB:-$BAZA}" -At -f "$RADACINA/scripts/control_0e.sql" | grep -c . || true)"; [ "$n" = 0 ] || esec "gate 0e: $n rânduri"; ok "gate 0e = 0 ($1)"; }
OWNER=00000000-0000-0000-0000-0000000000a1
COLEG=00000000-0000-0000-0000-0000000000b2
# ca_rol <rol> <uid|-> <sql>: rulează sql ca rolul dat, cu auth.uid() = uid (- = fără)
ca_rol() { local sub=""; [ "$2" != - ] && sub="SELECT set_config('request.jwt.claim.sub', '$2', true) IS NULL;"; q "BEGIN; $sub SET LOCAL ROLE $1; $3; COMMIT;" | tail -n 1; }
refuzat() { local out; if out="$(q "$2" 2>&1)"; then esec "$1 a trecut: $out"; fi; grep -q "$3" <<<"$out" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$out")"; }
STARE="SELECT (SELECT relacl::text FROM pg_class WHERE oid = 'public.clarificari_tipare'::regclass) || '|' || (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.clarificari_tipare'::regclass AND attacl IS NOT NULL) || '|' || (to_regprocedure('public.fn_tipare_impact_intern()') IS NULL)::text"
STARE_INITIALA="{postgres=arwdDxtm/postgres,authenticated=arwdxt/postgres,service_role=arwdDxtm/postgres}|0|true"
STARE_PATCH="{postgres=arwdDxtm/postgres,authenticated=awdxt/postgres,service_role=arwdDxtm/postgres}|15|false"
COL_BIBLIOTECA="pattern_id, tip_problema, titlu, trigger, documente_de_verificat, normative_refs, precedente_cnsc, intrebare_propusa, confidence, requires_human_legal_review, note"
COL_TEMEIURI_1="pattern_id, titlu, tip_problema, trigger, precedente_cnsc, normative_refs, intrebare_propusa, confidence, requires_human_legal_review"
COL_TEMEIURI_2="pattern_id, titlu, tip_problema, confidence, requires_human_legal_review, precedente_cnsc"
COL_DECLANSATE="pattern_id, titlu, trigger, precedente_cnsc, intrebare_propusa, confidence, requires_human_legal_review"
FN_ASTEPTAT="8d335ed3fe345d3bf95ef0f1b2f8850a|true|s|search_path=public, pg_temp|postgres|sql|authenticated=X/postgres postgres=X/postgres service_role=X/postgres"
FN_LIVE="SELECT md5(prosrc) || '|' || prosecdef::text || '|' || provolatile::text || '|' || array_to_string(proconfig, ',') || '|' || pg_get_userbyid(proowner) || '|' || (SELECT lanname FROM pg_language WHERE oid = prolang) || '|' || (SELECT string_agg(a::text, ' ' ORDER BY a::text) FROM unnest(proacl) a) FROM pg_proc WHERE proname='fn_is_app_owner'"

pregateste_baza() {  # <nume bază>
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE $1" >/dev/null
  "${PSQL[@]}" -d "$1" -f "$SCHELET" >/dev/null
  "${PSQL[@]}" -d "$1" -c "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);" >/dev/null
}
aplica() {  # <nume bază> <versiune> → cod runner
  local sha sis rc=0
  sha="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
  sis="$(DB=$1 q "SELECT system_identifier FROM pg_control_system()")"
  PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$sha" --versiune "$2" \
    --tinta-db "$1" --tinta-sistem "$sis" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/tipare_impact_runner.out 2>&1 || rc=$?
  echo "$rc"
}

# 0. schelet
pregateste_baza "$BAZA"
[ "$(q "$FN_LIVE")" = "$FN_ASTEPTAT" ] || esec "0 fn_is_app_owner din schelet ≠ live: $(q "$FN_LIVE")"
[ "$(q "$STARE")" = "$STARE_INITIALA" ] || esec "0 drepturile din schelet ≠ live: $(q "$STARE")"
[ "$(ca_rol authenticated "$COLEG" "SELECT count(impact_intern) FROM public.clarificari_tipare")" = 2 ] || esec "0 colegul nu citește impact_intern înainte (schelet greșit)"
ok "0 schelet = live (relacl, fără drepturi pe coloane, fn_is_app_owner 8d335ed3) · BUG reprodus: colegul citește impact_intern (2 rânduri)"

# 1. fără runner
"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
[ "$(q "$STARE")" = "$STARE_INITIALA" ] || esec "1 ceva s-a schimbat"
ok "1 fără runner → refuz, nimic schimbat"

# 2. precondiții negative
refuza_cu() { local out; if out="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1)"; then esec "$1 a trecut"; fi
  grep -q "$2" <<<"$out" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$out")"; }
q "ALTER TABLE public.clarificari_tipare ADD COLUMN extra text" >/dev/null
refuza_cu "2a coloană nouă" "Precondiție 0b"
q "ALTER TABLE public.clarificari_tipare DROP COLUMN extra" >/dev/null
q "ALTER TABLE public.clarificari_tipare RENAME TO clarificari_tipare_x; CREATE TABLE public.clarificari_tipare (LIKE public.clarificari_tipare_x INCLUDING ALL)" >/dev/null
refuza_cu "2a2 alt tabel cu aceleași coloane (alt owner/RLS)" "Precondiție 0b"
q "DROP TABLE public.clarificari_tipare; ALTER TABLE public.clarificari_tipare_x RENAME TO clarificari_tipare" >/dev/null
q "GRANT SELECT (titlu) ON public.clarificari_tipare TO anon" >/dev/null
refuza_cu "2b drept pe coloană existent" "Precondiție 0c"
q "REVOKE SELECT (titlu) ON public.clarificari_tipare FROM anon" >/dev/null
q "GRANT SELECT ON public.clarificari_tipare TO anon" >/dev/null
refuza_cu "2b2 anon cu SELECT pe tabel" "Precondiție 0c"
q "REVOKE SELECT ON public.clarificari_tipare FROM anon" >/dev/null
q "DROP POLICY clarificari_tipare_select ON public.clarificari_tipare; CREATE POLICY clarificari_tipare_select ON public.clarificari_tipare FOR SELECT TO authenticated USING (true)" >/dev/null
refuza_cu "2c policy de citire schimbat" "Precondiție 0d"
q "DROP POLICY clarificari_tipare_select ON public.clarificari_tipare; CREATE POLICY clarificari_tipare_select ON public.clarificari_tipare FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL)" >/dev/null
q "CREATE OR REPLACE FUNCTION public.fn_is_app_owner(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS 'SELECT true'" >/dev/null
refuza_cu "2d fn_is_app_owner schimbată" "Precondiție 0e"
q "CREATE OR REPLACE FUNCTION public.fn_is_app_owner(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS \$function\$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_owner = true);
\$function\$" >/dev/null
[ "$(q "$FN_LIVE")" = "$FN_ASTEPTAT" ] || esec "2d fn_is_app_owner nerefăcută exact: $(q "$FN_LIVE")"
q "CREATE FUNCTION public.fn_tipare_impact_intern(x int) RETURNS int LANGUAGE sql AS 'SELECT 1'" >/dev/null
refuza_cu "2e funcția există deja (altă semnătură)" "Precondiție 0f"
q "DROP FUNCTION public.fn_tipare_impact_intern(int)" >/dev/null
[ "$(q "$STARE")" = "$STARE_INITIALA" ] || esec "2 starea nu s-a refăcut: $(q "$STARE")"
ok "2 refuz la: coloană nouă · alt tabel · drept pe coloană / anon pe tabel · policy de citire schimbat · fn_is_app_owner ≠ live · funcția există"

# 3. runner
RC="$(aplica "$BAZA" 20261005230000)"
[ "$RC" = 0 ] || { cat /tmp/tipare_impact_runner.out >&2; esec "3 runner cod $RC"; }
[ "$(q "$STARE")" = "$STARE_PATCH" ] || esec "3 starea după patch: $(q "$STARE")"
gate_0e dupa
ok "3 runner: APLICAT + ÎNREGISTRAT (cod 0), sha256 $(sha256sum "$MIGRARE" | cut -d' ' -f1)"
# 3b. baza cu EXECUTE implicit pentru PUBLIC/anon/authenticated pe funcții noi (cum ar fi sub supabase_admin): ACL-ul tot exact
pregateste_baza tipare_impact_b_test
DB=tipare_impact_b_test q "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon, authenticated" >/dev/null
RC="$(aplica tipare_impact_b_test 20261005230000)"
[ "$RC" = 0 ] || { cat /tmp/tipare_impact_runner.out >&2; esec "3b runner cod $RC"; }
[ "$(DB=tipare_impact_b_test q "SELECT has_function_privilege('anon', 'public.fn_tipare_impact_intern()', 'EXECUTE')::text || '|' || (SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.fn_tipare_impact_intern()'::regprocedure AND a.grantee = 0)")" = "false|0" ] \
  || esec "3b anon/PUBLIC au EXECUTE pe fn_tipare_impact_intern"
ok "3b cu EXECUTE implicit pentru PUBLIC/anon: REVOKE-ul îi scoate, postcondiția trece"

# 4. comportament
refuzat "4a colegul citește impact_intern" "BEGIN; SELECT set_config('request.jwt.claim.sub', '$COLEG', true); SET LOCAL ROLE authenticated; SELECT impact_intern FROM public.clarificari_tipare; COMMIT;" "permission denied"
refuzat "4b colegul face select *" "BEGIN; SELECT set_config('request.jwt.claim.sub', '$COLEG', true); SET LOCAL ROLE authenticated; SELECT * FROM public.clarificari_tipare; COMMIT;" "permission denied"
refuzat "4c owner-ul citește impact_intern prin tabel" "BEGIN; SELECT set_config('request.jwt.claim.sub', '$OWNER', true); SET LOCAL ROLE authenticated; SELECT impact_intern FROM public.clarificari_tipare; COMMIT;" "permission denied"
refuzat "4d colegul filtrează pe impact_intern" "BEGIN; SELECT set_config('request.jwt.claim.sub', '$COLEG', true); SET LOCAL ROLE authenticated; SELECT pattern_id FROM public.clarificari_tipare WHERE impact_intern->>'cost' = 'mare'; COMMIT;" "permission denied"
for L in "$COL_BIBLIOTECA" "$COL_TEMEIURI_1" "$COL_TEMEIURI_2" "$COL_DECLANSATE"; do
  [ "$(ca_rol authenticated "$COLEG" "SELECT count(*) FROM (SELECT $L FROM public.clarificari_tipare ORDER BY pattern_id) x")" = 3 ] || esec "4e lista de coloane din UI pică: $L"
done
[ "$(ca_rol authenticated "$COLEG" "SELECT EXISTS (SELECT 1 FROM public.clarificari_tipare c WHERE c.requires_human_legal_review AND c.pattern_id IN ('PAT-A-01', 'PAT-X'))::text")" = true ] \
  || esec "4f interogarea din fn_temei_citat_verifica pică"
[ "$(ca_rol authenticated "$COLEG" "SELECT count(*) FROM public.fn_tipare_impact_intern()")" = 0 ] || esec "4g colegul primește rânduri din funcție"
[ "$(ca_rol authenticated - "SELECT count(*) FROM public.fn_tipare_impact_intern()")" = 0 ] || esec "4h fără JWT primește rânduri"
[ "$(ca_rol authenticated "$OWNER" "SELECT string_agg(pattern_id || ':' || (impact_intern->>'cost'), ',') FROM public.fn_tipare_impact_intern()")" = "PAT-A-01:mare,PAT-B-02:mic" ] \
  || esec "4i owner-ul nu primește exact cele 2 impacturi, în ordine"
refuzat "4j anon apelează funcția" "BEGIN; SET LOCAL ROLE anon; SELECT * FROM public.fn_tipare_impact_intern(); COMMIT;" "permission denied"
refuzat "4k anon citește tabelul" "BEGIN; SET LOCAL ROLE anon; SELECT pattern_id FROM public.clarificari_tipare; COMMIT;" "permission denied"
[ "$(ca_rol service_role - "SELECT count(impact_intern) FROM public.clarificari_tipare")" = 2 ] || esec "4l service_role nu mai citește impact_intern"
[ "$(ca_rol authenticated "$OWNER" "WITH u AS (UPDATE public.clarificari_tipare SET note = 'owner' WHERE pattern_id = 'PAT-C-03' RETURNING pattern_id) SELECT count(*) FROM u")" = 1 ] || esec "4m owner-ul nu mai poate actualiza"
[ "$(ca_rol authenticated "$COLEG" "WITH u AS (UPDATE public.clarificari_tipare SET note = 'coleg' WHERE pattern_id = 'PAT-C-03' RETURNING pattern_id) SELECT count(*) FROM u")" = 0 ] || esec "4n colegul a actualizat"
ok "4 coleg/owner fără impact_intern prin tabel (nici *, nici filtru) · listele UI + fn_temei_citat_verifica merg · funcția: owner 2 în ordine, coleg/fără JWT 0, anon refuzat · service_role citește · owner scrie, colegul nu"

# 5. reaplicare
RC="$(aplica "$BAZA" 20261005230001)"
[ "$RC" != 0 ] || esec "5 reaplicarea a trecut"
[ "$(q "$STARE")" = "$STARE_PATCH" ] || esec "5 reaplicarea a schimbat starea"
ok "5 reaplicare → refuz (cod $RC), nimic schimbat"

# 6. revenire
REV() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261015a', '$1' || txid_current(), true);" -f "$ROLLBACK" 2>&1; }
STARE_FN="$STARE || '|' || coalesce((SELECT md5(prosrc) FROM pg_proc WHERE proname = 'fn_tipare_impact_intern'), '-')"
refuza_rev() { local out ina; ina="$(q "$STARE_FN")"
  if out="$(REV "$2")"; then esec "$1 a trecut"; fi; grep -q "$3" <<<"$out" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$out")"
  [ "$(q "$STARE_FN")" = "$ina" ] || esec "$1 a schimbat starea"; }
refuza_rev "6a nearmată" "ALTA_ARMARE:" "nearmată"
q "ALTER DATABASE $BAZA SET gazpet.revenire_20261015a = 'x'" >/dev/null
refuza_rev "6b armare persistentă" "IMPACT_INTERN_PENTRU_TOTI:" "armare persistentă"
q "ALTER DATABASE $BAZA RESET gazpet.revenire_20261015a" >/dev/null
q "GRANT SELECT (impact_intern) ON public.clarificari_tipare TO authenticated" >/dev/null
refuza_rev "6c drept adăugat pe impact_intern" "IMPACT_INTERN_PENTRU_TOTI:" "drepturile pe clarificari_tipare"
q "REVOKE SELECT (impact_intern) ON public.clarificari_tipare FROM authenticated" >/dev/null
q "CREATE OR REPLACE FUNCTION public.fn_tipare_impact_intern() RETURNS TABLE (pattern_id text, impact_intern jsonb) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS \$fn\$ SELECT t.pattern_id, t.impact_intern FROM public.clarificari_tipare t \$fn\$" >/dev/null
refuza_rev "6d corpul funcției schimbat" "IMPACT_INTERN_PENTRU_TOTI:" "fn_tipare_impact_intern nu e exact"
"${PSQL[@]}" -d "$BAZA" -c "$(sed -n '/^CREATE FUNCTION public.fn_tipare_impact_intern/,/^\$fn\$;/p' "$MIGRARE" | sed 's/^CREATE FUNCTION/CREATE OR REPLACE FUNCTION/')" >/dev/null
q "ALTER FUNCTION public.fn_tipare_impact_intern() SET search_path = public" >/dev/null
refuza_rev "6d2 search_path schimbat (Copilot P2 pe #620)" "IMPACT_INTERN_PENTRU_TOTI:" "fn_tipare_impact_intern nu e exact"
q "ALTER FUNCTION public.fn_tipare_impact_intern() SET search_path = public, pg_temp" >/dev/null
q "ALTER FUNCTION public.fn_tipare_impact_intern() VOLATILE" >/dev/null
refuza_rev "6d3 volatilitate schimbată (Copilot P2 pe #620)" "IMPACT_INTERN_PENTRU_TOTI:" "fn_tipare_impact_intern nu e exact"
q "ALTER FUNCTION public.fn_tipare_impact_intern() STABLE" >/dev/null
q "CREATE VIEW public.v_dep AS SELECT * FROM public.fn_tipare_impact_intern()" >/dev/null
refuza_rev "6e funcția are dependențe" "IMPACT_INTERN_PENTRU_TOTI:" "fn_tipare_impact_intern nu e exact"
q "DROP VIEW public.v_dep" >/dev/null
OUT="$(REV "IMPACT_INTERN_PENTRU_TOTI:")" || { echo "$OUT" >&2; esec "6f revenirea armată a picat"; }
[ "$(q "$STARE")" = "$STARE_INITIALA" ] || esec "6f starea după revenire ≠ 20261007a: $(q "$STARE")"
[ "$(ca_rol authenticated "$COLEG" "SELECT count(impact_intern) FROM public.clarificari_tipare")" = 2 ] || esec "6f colegul nu citește din nou (revenire incompletă)"
gate_0e "dupa revenire"
ok "6 revenire: nearmată / persistentă / drept pe impact_intern / corp / search_path / volatilitate schimbate / dependență → refuz, nimic schimbat · armată → drepturile exact ca 20261007a, funcția scoasă"
echo "PASS  $NUME  sha256 $(sha256sum "$MIGRARE" | cut -d' ' -f1)  md5 corp fn: $(DB=tipare_impact_b_test q "SELECT md5(prosrc) FROM pg_proc WHERE proname = 'fn_tipare_impact_intern'")"
