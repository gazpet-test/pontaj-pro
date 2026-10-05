#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261014a_api_consum_extern. EXCLUSIV pe un PostgreSQL 17 local dedicat
# (implicit /tmp/pg_api_consum, 127.0.0.1:5976). Nu atinge producția.
#   0. schelet (supabase/tests/api_consum_extern_schelet.sql) = fn_is_app_owner exact ca live + machete vault/net/cron/auth
#   1. fișierul fără runner → garda refuză, nimic creat
#   2. precondiții negative: secret intern lipsă/greșit · fn_is_app_owner schimbată / EXECUTE anon / alt proprietar ·
#      cron.timezone ≠ GMT · job existent · tabel existent
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + gate 0e) → cod 0
#   4. comportament: anon nimic · coleg (authenticated) 0 rânduri, nu scrie · owner citește, nu scrie · service_role
#      scrie cu upsert PARȚIAL ca PostgREST (succes = doar citirea bună, eroare = doar eroare + eroare_la): o eroare după
#      o citire bună în aceeași zi nu o șterge și nici invers (P0 r1) · CHECK-uri · view: ultima citire bună + ultima
#      eroare + eroare_dupa_citire + ritm + epuizare · cronul trimite x-intern-secret = Vault către api-consum-extern
#   5. reaplicare → refuz
#   6. revenire: nearmată / armare persistentă / istoric fără a doua armare / 6 tipuri de deviere de structură (amprenta)
#      → refuz, nimic șters; armată + istoric armat → tabel, view, job scoase
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
FN_LIVE="SELECT md5(prosrc) || '|' || prosecdef::text || '|' || provolatile::text || '|' || array_to_string(proconfig, ',') || '|' || pg_get_userbyid(proowner) || '|' || (SELECT lanname FROM pg_language WHERE oid = prolang) || '|' || (SELECT string_agg(a::text, ' ' ORDER BY a::text) FROM unnest(proacl) a) FROM pg_proc WHERE proname='fn_is_app_owner'"
FN_ASTEPTAT="8d335ed3fe345d3bf95ef0f1b2f8850a|true|s|search_path=public, pg_temp|postgres|sql|authenticated=X/postgres postgres=X/postgres service_role=X/postgres"
[ "$(q "$FN_LIVE")" = "$FN_ASTEPTAT" ] || esec "0 fn_is_app_owner din schelet ≠ live: $(q "$FN_LIVE")"
[ "$(q "SELECT current_setting('cron.timezone', true)")" = GMT ] || esec "0 cron.timezone ≠ GMT în schelet"
[ "$(q "$NIMIC")" = true ] || esec "0 obiectele există deja"
ok "0 schelet: fn_is_app_owner = live (8d335ed3, SECDEF, STABLE, postgres, sql, ACL exact), cron.timezone GMT, secret intern 64 hex, privilegii implicite Supabase"

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
q "GRANT EXECUTE ON FUNCTION public.fn_is_app_owner(uuid) TO anon" >/dev/null
refuza_cu "2c2 fn_is_app_owner cu EXECUTE pentru anon" "Precondiție 0e"
q "REVOKE EXECUTE ON FUNCTION public.fn_is_app_owner(uuid) FROM anon" >/dev/null
q "ALTER FUNCTION public.fn_is_app_owner(uuid) OWNER TO service_role" >/dev/null
refuza_cu "2c3 fn_is_app_owner cu alt proprietar" "Precondiție 0e"
q "ALTER FUNCTION public.fn_is_app_owner(uuid) OWNER TO postgres" >/dev/null
q "GRANT EXECUTE ON FUNCTION public.fn_is_app_owner(uuid) TO service_role" >/dev/null   # schimbarea de proprietar a contopit grantul lui service_role
[ "$(q "$FN_LIVE")" = "$FN_ASTEPTAT" ] || esec "2c fn_is_app_owner nerefăcută exact: $(q "$FN_LIVE")"
q "ALTER DATABASE $BAZA SET cron.timezone = 'Europe/Bucharest'" >/dev/null
refuza_cu "2f cron.timezone ≠ GMT" "Precondiție 0f"
q "ALTER DATABASE $BAZA SET cron.timezone = 'GMT'" >/dev/null
q "SELECT cron.schedule('api_consum_extern_zilnic', '* * * * *', 'SELECT 1')" >/dev/null
refuza_cu "2d job existent" "Precondiție 0c"
q "SELECT cron.unschedule('api_consum_extern_zilnic')" >/dev/null
q "CREATE TABLE public.api_consum_extern (id int)" >/dev/null
refuza_cu "2e tabel existent" "Precondiție 0b"
q "DROP TABLE public.api_consum_extern" >/dev/null
[ "$(q "$NIMIC")" = true ] || esec "2 ceva a rămas creat"
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE proname='fn_is_app_owner'")" = 8d335ed3fe345d3bf95ef0f1b2f8850a ] || esec "2 fn_is_app_owner nerefăcută"
ok "2 refuz la: secret intern lipsă / alt format · fn_is_app_owner ≠ live (corp, EXECUTE anon, proprietar) · cron.timezone ≠ GMT · job existent · tabel existent"

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
# service_role scrie EXACT cum scrie PostgREST un upsert (Prefer: resolution=merge-duplicates, on_conflict=furnizor,zi):
# INSERT … ON CONFLICT (furnizor, zi) DO UPDATE SET <doar coloanele din obiect> = EXCLUDED.<…>. payloadUpsert (edge) dă
# obiectul de succes (citirea bună) SAU de eroare (eroare + eroare_la) — niciodată amândouă.
ZI="$(q "SELECT (now() AT TIME ZONE 'Europe/Bucharest')::date")"
succes() {  # <furnizor> <zi sql> <rămase> <consumate> <citit_la sql>
  ca_rol service_role - "INSERT INTO public.api_consum_extern (furnizor, sursa, unitate, zi, citit_la, credite_plan, credite_ramase, credite_consumate, perioada_start, perioada_sfarsit, raspuns_brut)
    VALUES ('$1', 'api', 'credite', $2, $5, 3000, $3, $4, '$ZI'::date - 9, '$ZI'::date + 20, '{\"success\":true}')
    ON CONFLICT (furnizor, zi) DO UPDATE SET furnizor = EXCLUDED.furnizor, sursa = EXCLUDED.sursa, unitate = EXCLUDED.unitate, zi = EXCLUDED.zi,
      citit_la = EXCLUDED.citit_la, credite_plan = EXCLUDED.credite_plan, credite_ramase = EXCLUDED.credite_ramase, credite_consumate = EXCLUDED.credite_consumate,
      perioada_start = EXCLUDED.perioada_start, perioada_sfarsit = EXCLUDED.perioada_sfarsit, raspuns_brut = EXCLUDED.raspuns_brut" >/dev/null
}
eroare() {  # <furnizor> <zi sql> <text> <eroare_la sql>
  ca_rol service_role - "INSERT INTO public.api_consum_extern (furnizor, sursa, unitate, zi, eroare, eroare_la) VALUES ('$1', 'api', 'credite', $2, '$3', $4)
    ON CONFLICT (furnizor, zi) DO UPDATE SET furnizor = EXCLUDED.furnizor, sursa = EXCLUDED.sursa, unitate = EXCLUDED.unitate, zi = EXCLUDED.zi,
      eroare = EXCLUDED.eroare, eroare_la = EXCLUDED.eroare_la" >/dev/null
}
ZIUA="SELECT coalesce(credite_ramase::text, '-') || '|' || coalesce(eroare, '-') || '|' || (citit_la IS NOT NULL)::text || '|' || coalesce((eroare_la > citit_la)::text, '-') FROM public.api_consum_extern WHERE furnizor = 'firecrawl' AND zi = '$ZI'"
succes firecrawl "'$ZI'::date - 1" 2500 500 "now() - interval '1 day'"
succes firecrawl "'$ZI'" 2000 1000 "now() - interval '5 hours'"
succes firecrawl "'$ZI'" 2400 600 "now() - interval '4 hours'"
[ "$(q "SELECT count(*) || '|' || max(credite_ramase) FILTER (WHERE zi = '$ZI') FROM public.api_consum_extern")" = "2|2400" ] || esec "4e upsert pe (furnizor, zi) greșit"
# P0 r1: cronul citește bine dimineața, „Citește acum” primește 500 după-amiaza → citirea bună rămâne, eroarea se adaugă
BUN_INAINTE="$(q "SELECT citit_la || '|' || credite_plan || '|' || credite_consumate || '|' || perioada_start || '|' || raspuns_brut::text FROM public.api_consum_extern WHERE furnizor = 'firecrawl' AND zi = '$ZI'")"
eroare firecrawl "'$ZI'" "HTTP 500: x" "now() - interval '2 hours'"
[ "$(q "$ZIUA")" = "2400|HTTP 500: x|true|true" ] || esec "4e2 eroarea de după-amiază a atins citirea bună: $(q "$ZIUA")"
[ "$(q "SELECT citit_la || '|' || credite_plan || '|' || credite_consumate || '|' || perioada_start || '|' || raspuns_brut::text FROM public.api_consum_extern WHERE furnizor = 'firecrawl' AND zi = '$ZI'")" = "$BUN_INAINTE" ] \
  || esec "4e2 coloanele citirii bune s-au schimbat la eroare"
[ "$(ca_rol authenticated "$COLEG" "SELECT count(*) FROM public.api_consum_extern")" = 0 ] || esec "4f colegul vede rânduri"
[ "$(ca_rol authenticated "$COLEG" "SELECT count(*) FROM public.v_api_consum_curent")" = 0 ] || esec "4f colegul vede view-ul"
[ "$(ca_rol authenticated "$OWNER" "SELECT count(*) FROM public.api_consum_extern")" = 2 ] || esec "4g owner-ul nu vede rândurile"
refuzat "4h owner modifică" "BEGIN; SELECT set_config('request.jwt.claim.sub', '$OWNER', true); SET LOCAL ROLE authenticated; UPDATE public.api_consum_extern SET credite_ramase = 0; COMMIT;" "permission denied"
refuzat "4i sursa manual" "INSERT INTO public.api_consum_extern (furnizor, sursa, eroare, eroare_la) VALUES ('chatgpt', 'manual', 'x', now())" "api_consum_extern_sursa_check"
refuzat "4j furnizor invalid" "INSERT INTO public.api_consum_extern (furnizor, eroare, eroare_la) VALUES ('Fire Crawl', 'x', now())" "api_consum_extern_furnizor_check"
refuzat "4j2 rând fără niciun eveniment" "INSERT INTO public.api_consum_extern (furnizor) VALUES ('vercel')" "api_consum_extern_are_eveniment"
refuzat "4j3 citire fără credite rămase" "INSERT INTO public.api_consum_extern (furnizor, citit_la) VALUES ('vercel', now())" "api_consum_extern_citire_completa"
refuzat "4j4 credite fără ora citirii" "INSERT INTO public.api_consum_extern (furnizor, credite_ramase, eroare, eroare_la) VALUES ('vercel', 5, 'x', now())" "api_consum_extern_citire_completa"
refuzat "4j5 eroare fără ora ei" "INSERT INTO public.api_consum_extern (furnizor, eroare, citit_la, credite_ramase) VALUES ('vercel', 'x', now(), 5)" "api_consum_extern_eroare_completa"
ok "4 drepturi + upsert parțial: anon nimic · coleg 0 rânduri și nu scrie · owner citește, nu scrie · eroarea de după-amiază NU șterge citirea bună (2400 rămâne) · CHECK sursa/furnizor/eveniment/citire/eroare"

# view: zile scurse 10 (perioada_start = azi-9), ritm 600/10 = 60, epuizare 2400/60 = 40; eroarea (azi-2h) e mai nouă decât citirea (azi-4h)
VFC="SELECT credite_ramase || '|' || zile_scurse || '|' || ritm_zilnic || '|' || zile_pana_la_epuizare || '|' || coalesce(ultima_eroare, '-') || '|' || eroare_dupa_citire || '|' || (ultima_incercare_la = ultima_eroare_la)::text FROM public.v_api_consum_curent WHERE furnizor = 'firecrawl'"
[ "$(ca_rol authenticated "$OWNER" "$VFC")" = "2400|10|60.00|40|HTTP 500: x|true|true" ] \
  || esec "4k view după eroare: $(ca_rol authenticated "$OWNER" "SELECT row_to_json(v) FROM public.v_api_consum_curent v")"
# invers: o citire bună după eroare (azi-1h) NU șterge eroarea; view-ul o arată ca mai veche decât citirea
succes firecrawl "'$ZI'" 2300 700 "now() - interval '1 hour'"
[ "$(q "$ZIUA")" = "2300|HTTP 500: x|true|false" ] || esec "4k2 citirea bună a șters eroarea: $(q "$ZIUA")"
[ "$(ca_rol authenticated "$OWNER" "$VFC")" = "2300|10|70.00|32|HTTP 500: x|false|false" ] \
  || esec "4k3 view după citire bună: $(ca_rol authenticated "$OWNER" "SELECT row_to_json(v) FROM public.v_api_consum_curent v")"
# Desktop Commander (rutina Claude): citire bună ieri, eroare azi (rând doar cu eroare)
ca_rol service_role - "INSERT INTO public.api_consum_extern (furnizor, sursa, unitate, zi, citit_la, credite_plan, credite_ramase, credite_consumate) VALUES ('desktop_commander', 'rutina_claude', 'procent', '$ZI'::date - 1, now() - interval '1 day', 100, 83, 17)" >/dev/null
ca_rol service_role - "INSERT INTO public.api_consum_extern (furnizor, sursa, unitate, zi, eroare, eroare_la) VALUES ('desktop_commander', 'rutina_claude', 'procent', '$ZI', 'DC offline', now())" >/dev/null
[ "$(ca_rol authenticated "$OWNER" "SELECT credite_ramase || '|' || ultima_eroare || '|' || sursa || '|' || (zi < '$ZI')::text || '|' || eroare_dupa_citire FROM public.v_api_consum_curent WHERE furnizor = 'desktop_commander'")" = "83|DC offline|rutina_claude|true|true" ] \
  || esec "4l view: ultima eroare + ultima citire bună (DC)"
ok "4 view: citire bună + eroare mai nouă (2400, 60/zi, 40 zile, eroare_dupa_citire) · citire bună după eroare păstrează eroarea (2300, 70/zi, 32 zile) · DC: 83% de ieri lângă eroarea de azi"

# cronul
[ "$(q "SELECT schedule || '|' || username || '|' || active || '|' || md5(command) || '|' || current_setting('cron.timezone') FROM cron.job WHERE jobname = 'api_consum_extern_zilnic'")" = "5 4 * * *|postgres|true|308fba6229f57f26c20d6e26fddc1f94|GMT" ] || esec "4m program cron"
q "DO \$x\$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'api_consum_extern_zilnic'); END \$x\$" >/dev/null
[ "$(q "SELECT url || '|' || (headers->>'x-intern-secret' = repeat('a1', 32))::text || '|' || (body->>'furnizor') || '|' || timeout_ms FROM net._apeluri")" = "https://dxczwkbciseqniprspcu.supabase.co/functions/v1/api-consum-extern|true|toate|20000" ] \
  || esec "4n apelul cronului: $(q "SELECT row_to_json(a) FROM net._apeluri a")"
ok "4 cron '5 4 * * *' (07:05 ora de vară) → api-consum-extern cu x-intern-secret = Vault, furnizor toate, timeout 20 s"

refuza_cu "5 reaplicare" "Precondiție 0b"
ok "5 reaplicare → refuz"

# 6. revenirea: armare (txid) + istoric (a doua armare) + amprenta exactă (orice deviere de structură → refuz, nimic șters)
ARM="SELECT set_config('gazpet.revenire_20261014a', 'SCOATE_API_CONSUM:' || txid_current(), true);"
ARM_DATE="SELECT set_config('gazpet.revenire_20261014a_date', 'STERGE_ISTORIC_CONSUM:' || txid_current(), true);"
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "$1" -f "$ROLLBACK" 2>&1; }
refuz_rev() { local out; if out="$(revenire "$2")"; then esec "$1 a trecut"; fi; grep -q "$3" <<<"$out" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$out")"
  [ "$(q "$NIMIC")" = false ] || esec "$1 a scos ceva"; }
COMENTARIU="$(q "SELECT obj_description('public.api_consum_extern'::regclass, 'pg_class')")"
grep -Eq 'amprenta_20261014a=[0-9a-f]{32}$' <<<"$COMENTARIU" || esec "6 migrarea n-a scris amprenta: $COMENTARIU"
refuz_rev "6a nearmată" "SELECT 1;" "nearmată"
q "ALTER DATABASE $BAZA SET gazpet.revenire_20261014a = 'x'" >/dev/null
refuz_rev "6b armare persistentă" "$ARM" "armare persistentă"
q "ALTER DATABASE $BAZA RESET gazpet.revenire_20261014a" >/dev/null
refuz_rev "6c istoric fără a doua armare" "$ARM" "armarea separată gazpet.revenire_20261014a_date"
deviere() {  # <nume> <sql care strică> <sql care repară>
  q "$2" >/dev/null; refuz_rev "6d $1" "$ARM $ARM_DATE" "structura s-a schimbat"; q "$3" >/dev/null; }
deviere "INSERT dat lui authenticated" "GRANT INSERT ON public.api_consum_extern TO authenticated" "REVOKE INSERT ON public.api_consum_extern FROM authenticated"
deviere "programul jobului" "UPDATE cron.job SET schedule = '0 5 * * *' WHERE jobname = 'api_consum_extern_zilnic'" "UPDATE cron.job SET schedule = '5 4 * * *' WHERE jobname = 'api_consum_extern_zilnic'"
deviere "comanda jobului" "UPDATE cron.job SET command = command || ' ' WHERE jobname = 'api_consum_extern_zilnic'" "UPDATE cron.job SET command = left(command, length(command) - 1) WHERE jobname = 'api_consum_extern_zilnic'"
deviere "security_invoker oprit" "ALTER VIEW public.v_api_consum_curent SET (security_invoker = off)" "ALTER VIEW public.v_api_consum_curent SET (security_invoker = on)"
deviere "coloană nouă" "ALTER TABLE public.api_consum_extern ADD COLUMN x int" "ALTER TABLE public.api_consum_extern DROP COLUMN x"
deviere "politica slăbită" "ALTER POLICY api_consum_extern_select_owner ON public.api_consum_extern USING (true)" "ALTER POLICY api_consum_extern_select_owner ON public.api_consum_extern USING (public.fn_is_app_owner(auth.uid()))"
deviere "a doua politică" "CREATE POLICY p2 ON public.api_consum_extern FOR SELECT TO anon USING (true)" "DROP POLICY p2 ON public.api_consum_extern"
q "COMMENT ON TABLE public.api_consum_extern IS 'fara amprenta'" >/dev/null
refuz_rev "6e amprenta ștearsă din comentariu" "$ARM $ARM_DATE" "amprenta de la aplicare lipsește"
q "COMMENT ON TABLE public.api_consum_extern IS \$c\$$COMENTARIU\$c\$" >/dev/null
[ "$(q "SELECT count(*) FROM public.api_consum_extern")" = 4 ] || esec "6 istoricul a fost atins de refuzuri"
revenire "$ARM $ARM_DATE" >/dev/null || esec "6f revenire armată + istoric armat: $(revenire "$ARM $ARM_DATE" | grep -m1 ERROR)"
[ "$(q "$NIMIC")" = true ] || esec "6f obiectele încă există"
ok "6 revenire: nearmată / armare persistentă / istoric fără a doua armare / 7 devieri (INSERT authenticated, program, comandă, security_invoker, coloană, politică slăbită, a doua politică) / amprentă ștearsă → refuz, nimic șters · armată + istoric armat → tabel, view, job scoase"
echo "PASS test_api_consum_extern (sha256 $SHA)"
