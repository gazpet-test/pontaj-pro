#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261014a_api_consum_extern. EXCLUSIV pe un PostgreSQL 17 local dedicat
# (implicit /tmp/pg_api_consum, 127.0.0.1:5976). Nu atinge producția.
#   0. schelet (supabase/tests/api_consum_extern_schelet.sql) = fn_is_app_owner exact ca live + machete vault/net/cron/auth
#   1. fișierul fără runner → garda refuză, nimic creat
#   2. precondiții negative: secret intern lipsă/greșit · fn_is_app_owner schimbată · job existent · tabel existent
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + gate 0e) → cod 0
#   4. comportament: anon nimic · coleg (authenticated) 0 rânduri, nu scrie · owner citește, nu scrie · service_role
#      scrie + upsert pe (furnizor, zi) · CHECK-uri · view: ultima citire bună + ultima eroare + ritm + epuizare ·
#      cronul trimite x-intern-secret = Vault către api-consum-extern
#   5. reaplicare → refuz
#   6. revenire: nearmată → refuz; armată → tabel, view, job scoase
# Utilizare: bash scripts/test_api_consum_extern.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_api_consum}"
PORT="${PGPORT_TEST:-5976}"
BAZA=api_consum_test
NUME=20261014a_api_consum_extern
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/api_consum_extern_schelet.sql"
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
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_api_consum.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
gate_0e() { local n; n="$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql" | grep -c . || true)"; [ "$n" = 0 ] || esec "gate 0e: $n rânduri"; ok "gate 0e = 0 ($1)"; }
OWNER=00000000-0000-0000-0000-0000000000a1
COLEG=00000000-0000-0000-0000-0000000000b2
# ca_rol <rol> <uid|-> <sql>: rulează sql ca rolul dat, cu auth.uid() = uid (- = fără)
ca_rol() { local sub=""; [ "$2" != - ] && sub="SELECT set_config('request.jwt.claim.sub', '$2', true) IS NULL;"; q "BEGIN; $sub SET LOCAL ROLE $1; $3; COMMIT;" | tail -n 1; }
refuzat() { local out; if out="$(q "$2" 2>&1)"; then esec "$1 a trecut: $out"; fi; grep -q "$3" <<<"$out" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$out")"; }
NIMIC="SELECT (to_regclass('public.api_consum_extern') IS NULL AND to_regclass('public.v_api_consum_curent') IS NULL AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='api_consum_extern_zilnic'))::text"

"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
"${PSQL[@]}" -d "$BAZA" -c "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);" >/dev/null
[ "$(q "SELECT md5(prosrc) || '|' || prosecdef::text || '|' || provolatile::text || '|' || array_to_string(proconfig, ',') FROM pg_proc WHERE proname='fn_is_app_owner'")" = "8d335ed3fe345d3bf95ef0f1b2f8850a|true|s|search_path=public, pg_temp" ] \
  || esec "0 fn_is_app_owner din schelet ≠ live: $(q "SELECT md5(prosrc) FROM pg_proc WHERE proname='fn_is_app_owner'")"
[ "$(q "$NIMIC")" = true ] || esec "0 obiectele există deja"
ok "0 schelet: fn_is_app_owner = live (8d335ed3, SECDEF, STABLE), secret intern 64 hex, privilegii implicite Supabase"

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
[ "$(q "$NIMIC")" = true ] || esec "1 ceva a fost creat"
ok "1 fără runner → refuz, nimic creat"

refuza_cu() { local out; if out="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1)"; then esec "$1 a trecut"; fi
  grep -q "$2" <<<"$out" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$out")"; }
q "UPDATE vault.secrets SET name='INTERN_EDGE_SECRET_X' WHERE name='INTERN_EDGE_SECRET'" >/dev/null
refuza_cu "2a secret intern lipsă" "Precondiție 0d"
q "UPDATE vault.secrets SET name='INTERN_EDGE_SECRET', secret='scurt' WHERE name='INTERN_EDGE_SECRET_X'" >/dev/null
refuza_cu "2b secret intern cu alt format" "Precondiție 0d"
q "UPDATE vault.secrets SET secret=repeat('a1', 32) WHERE name='INTERN_EDGE_SECRET'" >/dev/null
q "CREATE OR REPLACE FUNCTION public.fn_is_app_owner(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS 'SELECT true'" >/dev/null
refuza_cu "2c fn_is_app_owner schimbată" "Precondiție 0e"
q "CREATE OR REPLACE FUNCTION public.fn_is_app_owner(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS \$function\$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_owner = true);
\$function\$" >/dev/null
q "SELECT cron.schedule('api_consum_extern_zilnic', '* * * * *', 'SELECT 1')" >/dev/null
refuza_cu "2d job existent" "Precondiție 0c"
q "SELECT cron.unschedule('api_consum_extern_zilnic')" >/dev/null
q "CREATE TABLE public.api_consum_extern (id int)" >/dev/null
refuza_cu "2e tabel existent" "Precondiție 0b"
q "DROP TABLE public.api_consum_extern" >/dev/null
[ "$(q "$NIMIC")" = true ] || esec "2 ceva a rămas creat"
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE proname='fn_is_app_owner'")" = 8d335ed3fe345d3bf95ef0f1b2f8850a ] || esec "2 fn_is_app_owner nerefăcută"
ok "2 refuz la: secret intern lipsă / alt format · fn_is_app_owner ≠ live · job existent · tabel existent"

SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261005180000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/api_consum_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/api_consum_runner.out >&2; esec "3 runner cod $RC"; }
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA"
gate_0e dupa

# 4. drepturi
refuzat "4a anon citește tabelul" "BEGIN; SET LOCAL ROLE anon; SELECT * FROM public.api_consum_extern; COMMIT;" "permission denied"
refuzat "4b anon citește view-ul" "BEGIN; SET LOCAL ROLE anon; SELECT * FROM public.v_api_consum_curent; COMMIT;" "permission denied"
refuzat "4c coleg inserează" "BEGIN; SELECT set_config('request.jwt.claim.sub', '$COLEG', true); SET LOCAL ROLE authenticated; INSERT INTO public.api_consum_extern (furnizor) VALUES ('firecrawl'); COMMIT;" "permission denied"
refuzat "4d owner inserează" "BEGIN; SELECT set_config('request.jwt.claim.sub', '$OWNER', true); SET LOCAL ROLE authenticated; INSERT INTO public.api_consum_extern (furnizor) VALUES ('firecrawl'); COMMIT;" "permission denied"
# service_role scrie: o citire bună acum 9 zile în perioadă + una azi; apoi upsert pe aceeași zi
ZI="$(q "SELECT (now() AT TIME ZONE 'Europe/Bucharest')::date")"
ca_rol service_role - "INSERT INTO public.api_consum_extern (furnizor, zi, credite_plan, credite_ramase, credite_consumate, perioada_start, perioada_sfarsit, raspuns_brut)
  VALUES ('firecrawl', '$ZI'::date - 1, 3000, 2500, 500, '$ZI'::date - 9, '$ZI'::date + 20, '{\"success\":true}'),
         ('firecrawl', '$ZI', 3000, 2000, 900, '$ZI'::date - 9, '$ZI'::date + 20, '{\"success\":true}')" >/dev/null
ca_rol service_role - "INSERT INTO public.api_consum_extern (furnizor, zi, credite_plan, credite_ramase, credite_consumate, perioada_start, perioada_sfarsit)
  VALUES ('firecrawl', '$ZI', 3000, 2400, 600, '$ZI'::date - 9, '$ZI'::date + 20)
  ON CONFLICT (furnizor, zi) DO UPDATE SET credite_ramase = EXCLUDED.credite_ramase, credite_consumate = EXCLUDED.credite_consumate, citit_la = now()" >/dev/null
[ "$(q "SELECT count(*) || '|' || max(credite_ramase) FILTER (WHERE zi = '$ZI') FROM public.api_consum_extern")" = "2|2400" ] || esec "4e upsert pe (furnizor, zi) greșit"
[ "$(ca_rol authenticated "$COLEG" "SELECT count(*) FROM public.api_consum_extern")" = 0 ] || esec "4f colegul vede rânduri"
[ "$(ca_rol authenticated "$COLEG" "SELECT count(*) FROM public.v_api_consum_curent")" = 0 ] || esec "4f colegul vede view-ul"
[ "$(ca_rol authenticated "$OWNER" "SELECT count(*) FROM public.api_consum_extern")" = 2 ] || esec "4g owner-ul nu vede rândurile"
refuzat "4h owner modifică" "BEGIN; SELECT set_config('request.jwt.claim.sub', '$OWNER', true); SET LOCAL ROLE authenticated; UPDATE public.api_consum_extern SET credite_ramase = 0; COMMIT;" "permission denied"
refuzat "4i sursa manual" "INSERT INTO public.api_consum_extern (furnizor, sursa) VALUES ('chatgpt', 'manual')" "api_consum_extern_sursa_check"
refuzat "4j furnizor invalid" "INSERT INTO public.api_consum_extern (furnizor) VALUES ('Fire Crawl')" "api_consum_extern_furnizor_check"
ok "4 drepturi: anon nimic · coleg 0 rânduri și nu scrie · owner citește, nu scrie · service_role scrie + upsert (furnizor, zi) · CHECK sursa/furnizor"

# view: zile scurse 10 (perioada_start = azi-9), ritm 600/10 = 60, epuizare 2400/60 = 40 zile; apoi o eroare azi pe alt furnizor
[ "$(ca_rol authenticated "$OWNER" "SELECT credite_ramase || '|' || zile_scurse || '|' || ritm_zilnic || '|' || zile_pana_la_epuizare || '|' || coalesce(ultima_eroare, '-') FROM public.v_api_consum_curent WHERE furnizor = 'firecrawl'")" = "2400|10|60.00|40|-" ] \
  || esec "4k view calc: $(ca_rol authenticated "$OWNER" "SELECT row_to_json(v) FROM public.v_api_consum_curent v")"
ca_rol service_role - "INSERT INTO public.api_consum_extern (furnizor, sursa, unitate, zi, credite_plan, credite_ramase, credite_consumate) VALUES ('desktop_commander', 'rutina_claude', 'procent', '$ZI'::date - 1, 100, 83, 17)" >/dev/null
ca_rol service_role - "INSERT INTO public.api_consum_extern (furnizor, sursa, unitate, zi, eroare) VALUES ('desktop_commander', 'rutina_claude', 'procent', '$ZI', 'DC offline')" >/dev/null
[ "$(ca_rol authenticated "$OWNER" "SELECT credite_ramase || '|' || ultima_eroare || '|' || sursa || '|' || (zi < '$ZI')::text FROM public.v_api_consum_curent WHERE furnizor = 'desktop_commander'")" = "83|DC offline|rutina_claude|true" ] \
  || esec "4l view: ultima eroare + ultima citire bună"
ok "4 view: ultima citire bună (2400, ritm 60/zi, 40 de zile) · eroarea de azi apare lângă ultima valoare bună (DC 83%)"

# cronul
[ "$(q "SELECT schedule || '|' || username || '|' || active FROM cron.job WHERE jobname = 'api_consum_extern_zilnic'")" = "5 4 * * *|postgres|true" ] || esec "4m program cron"
q "DO \$x\$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'api_consum_extern_zilnic'); END \$x\$" >/dev/null
[ "$(q "SELECT url || '|' || (headers->>'x-intern-secret' = repeat('a1', 32))::text || '|' || (body->>'furnizor') || '|' || timeout_ms FROM net._apeluri")" = "https://dxczwkbciseqniprspcu.supabase.co/functions/v1/api-consum-extern|true|toate|20000" ] \
  || esec "4n apelul cronului: $(q "SELECT row_to_json(a) FROM net._apeluri a")"
ok "4 cron '5 4 * * *' (07:05 ora de vară) → api-consum-extern cu x-intern-secret = Vault, furnizor toate, timeout 20 s"

refuza_cu "5 reaplicare" "Precondiție 0b"
ok "5 reaplicare → refuz"

"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >/dev/null 2>&1 && esec "6 revenire nearmată a trecut"
[ "$(q "$NIMIC")" = false ] || esec "6 revenirea nearmată a scos ceva"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261014a', 'SCOATE_API_CONSUM:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null || esec "6 revenire armată"
[ "$(q "$NIMIC")" = true ] || esec "6 obiectele încă există"
ok "6 revenire: nearmată refuz · armată → tabel, view, job scoase"
echo "PASS test_api_consum_extern (sha256 $SHA)"
