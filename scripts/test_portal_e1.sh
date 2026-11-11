#!/usr/bin/env bash
# PG17 PRODLIKE; NUMAI cluster nou efemer. Nu accepta conexiuni externe.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_MAJOR="${PORTAL_PG_MAJOR:-17}"
# r10: migrarile cer PostgreSQL 17 (transaction_timeout = plafonul); PG16 nu mai e acceptat.
# r12: plafonul = transaction_timeout pornit la BEGIN din CONEXIUNEA runnerului (--plafon-tranzactie-ms 2000, PR #1054);
# fisierele il verifica (2000/client) si nu-l schimba. Livrarile simulate direct se conecteaza la fel (PSQL_LIV).
[[ "$PG_MAJOR" == 17 ]] || { echo 'MEDIU: migrarile cer PG17 (transaction_timeout)'; exit 2; }
SLOT="${PORTAL_E1_SLOT:-0}"
[[ "$SLOT" =~ ^[0-9]$ ]] || exit 2
[[ "$(id -u)" != 0 ]] || { echo 'MEDIU: ruleaza ca postgres, nu root'; exit 2; }
for v in PGPASSWORD PGOPTIONS PGDATABASE PGSERVICE PGSERVICEFILE PGHOSTADDR PGTARGETSESSIONATTRS PGLOADBALANCEHOSTS PGSYSCONFDIR PSQLRC; do
  [[ -z "${!v+x}" ]] || { echo "MEDIU: variabila $v nepermisa"; exit 2; }
done
PORT=$((6700+SLOT)); DB=portal_e1_test
TMP="$ROOT/.tmp/portal_e1_$SLOT"; DATA="$TMP/pg"
[[ ! -e "$TMP" ]] || { echo 'MEDIU: slot existent, alege altul'; exit 2; }
# r11: PORTAL_PG_BIN = binare native (ex. PostgreSQL 17 pentru Windows, rulat din Git Bash; scripts/portal/harness_win.sh),
# fara su / chown. Prin adaptoare in $TMP/bin: psql / pg_dump fara CR la capat de linie (iesirea Windows), restul direct.
NATIV=0
if [[ -n "${PORTAL_PG_BIN:-}" ]]; then
  NATIV=1
  ! command -v cygpath >/dev/null 2>&1 || PORTAL_PG_BIN="$(cygpath -u "$PORTAL_PG_BIN")"
  EXE=''; [[ ! -e "$PORTAL_PG_BIN/initdb.exe" ]] || EXE=.exe
  [[ -x "$PORTAL_PG_BIN/initdb$EXE" && -x "$PORTAL_PG_BIN/psql$EXE" ]] || { echo "MEDIU: PORTAL_PG_BIN fara initdb / psql"; exit 2; }
  mkdir -p "$TMP/bin"
  for b in initdb pg_ctl postgres pg_isready; do
    printf '#!/usr/bin/env bash\nexec "%s/%s%s" "$@"\n' "$PORTAL_PG_BIN" "$b" "$EXE" >"$TMP/bin/$b"
  done
  for b in psql pg_dump; do
    printf '#!/usr/bin/env bash\nset -o pipefail\n"%s/%s%s" "$@" | tr -d %s\n' "$PORTAL_PG_BIN" "$b" "$EXE" "'\\r'" >"$TMP/bin/$b"
  done
  chmod +x "$TMP/bin"/*
  PG_BIN="$TMP/bin"
  export PGCLIENTENCODING=UTF8 LC_MESSAGES=C PYTHONUTF8=1
else
  PG_BIN="${PG_BIN:-/usr/lib/postgresql/$PG_MAJOR/bin}"
  [[ -x "$PG_BIN/initdb" ]] || { echo "MEDIU: PG$PG_MAJOR lipsa"; exit 2; }
fi
[[ "$("$PG_BIN/postgres" --version)" == *" $PG_MAJOR."* ]] || { echo "MEDIU: este necesar PG$PG_MAJOR"; exit 2; }
# r11: portul trebuie sa fie liber (alt cluster local poate rula pe aceeasi masina; harness-ul foloseste 6700 + slot).
PORT_RC=0; "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT" -t 2 || PORT_RC=$?
[[ "$PORT_RC" == 2 ]] || { echo "MEDIU: portul $PORT e ocupat (pg_isready=$PORT_RC), alege alt slot"; exit 2; }
mkdir -p "$TMP"
export TMPDIR="$TMP"
PG_LOG="$TMP/pg.log"
trap '"$PG_BIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null 2>&1 || true' EXIT
ADMIN=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U supabase_admin)
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB")
# r13: orice oprire tipareste si lista esecurilor de plafon strinse pana atunci (imaginea completa a rularii).
fail() { echo "ESEC: $*" >&2; ! declare -F plafon_rezumat >/dev/null || plafon_rezumat >&2 || true; exit 1; }
q() { "${PSQL[@]}" -Atc "$1"; }
cluster_nou() { # r10: cluster efemer NOU in $DATA (jurnal $PG_LOG), aceeasi configuratie si fixture; seteaza SIS
  if [[ "$NATIV" == 1 ]]; then
    # r11: Windows nu are localul C.UTF-8 => providerul builtin C.UTF-8 al PG17 (Unicode, ca pe Linux); fara socket unix,
    # doar 127.0.0.1; setarile in postgresql.conf (ghilimelele simple din -o nu trec prin linia de comanda Windows).
    "$PG_BIN/initdb" -D "$DATA" -U supabase_admin --auth=trust --encoding=UTF8 --locale=C \
      --locale-provider=builtin --builtin-locale=C.UTF-8 >>"$TMP/init.log"
    printf "port = %s\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = ''\n" "$PORT" >>"$DATA/postgresql.conf"
    "$PG_BIN/pg_ctl" -D "$DATA" -l "$PG_LOG" -w -t 30 start
  else
    "$PG_BIN/initdb" -D "$DATA" -U supabase_admin --auth=trust --encoding=UTF8 --locale=C.UTF-8 >>"$TMP/init.log"
    "$PG_BIN/pg_ctl" -D "$DATA" -l "$PG_LOG" -w -t 30 start \
      -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='$TMP'"
  fi
  "${ADMIN[@]}" -d postgres -f "$ROOT/supabase/tests/portal_e1_prodlike_bootstrap.sql"
  "${ADMIN[@]}" -d "$DB" -f "$ROOT/supabase/tests/portal_e1_schelet.sql"
  "${ADMIN[@]}" -d "$DB" -f "$ROOT/supabase/tests/portal_e1_1b_fixture.sql"
  [[ "$(q "SELECT rolsuper::text||'|'||rolcreaterole::text||'|'||rolbypassrls::text FROM pg_roles WHERE rolname=current_user")" == 'false|true|true' ]] || fail 'postgres non-superuser'
  [[ "$(q 'SHOW check_function_bodies')" == on ]] || fail 'check_function_bodies trebuie sa fie on (ca in productie)'
  SIS="$(q 'SELECT system_identifier FROM pg_control_system()')"
}
cluster_nou
runner() {
  local sha
  sha="$(sha256sum "$2" | cut -d' ' -f1)"
  PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$2" --sha256 "$sha" --versiune "$1" \
    --tinta-db "$DB" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres \
    --plafon-tranzactie-ms 2000
}
# r12: acelasi runner FARA plafon (ca un runner vechi / o comanda fara optiune): migrarile trebuie sa refuze.
runner_fara_plafon() {
  local sha
  sha="$(sha256sum "$2" | cut -d' ' -f1)"
  PSQL_BIN="$PG_BIN/psql" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$2" --sha256 "$sha" --versiune "$1" \
    --tinta-db "$DB" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres
}
baseline() {
  # Schema/ACL separat; datele sunt citite explicit in ordinea cheii primare.
  # Stub-ul este singurul obiect pastrat intentionat dupa revenirea 18a; testat separat.
  "$PG_BIN/pg_dump" -h 127.0.0.1 -p "$PORT" -U supabase_admin -d "$DB" --schema=public --schema=auth --schema-only \
    --exclude-table='public.conturi_*' --exclude-table='public.portal_*' \
    | python3 "$ROOT/scripts/portal/snapshot_schema.py" "${2:-full}" >"$1"
  local snapshot_sql
  q "SELECT format('SELECT %L, coalesce(jsonb_agg(to_jsonb(t) ORDER BY %s), ''[]''::jsonb) FROM %I.%I t;',
    n.nspname||'.'||c.relname,
    coalesce((SELECT string_agg(format('t.%I',a.attname),',' ORDER BY k.ord)
      FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
      WHERE i.indrelid=c.oid AND i.indisprimary), 'to_jsonb(t)::text'),n.nspname,c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p')
      AND c.relname NOT LIKE 'conturi_%' AND c.relname NOT LIKE 'portal_%'
    ORDER BY n.nspname,c.relname" >"$TMP/snapshot_queries.sql" || return 1
  while IFS= read -r snapshot_sql; do
    q "$snapshot_sql" >>"$1" || return 1
  done <"$TMP/snapshot_queries.sql"
  q "SELECT format('SELECT %L,last_value,is_called FROM %I.%I ORDER BY last_value;',n.nspname||'.'||c.relname,n.nspname,c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth') AND c.relkind='S'
      AND c.relname NOT LIKE 'conturi_%' AND c.relname NOT LIKE 'portal_%'
    ORDER BY n.nspname,c.relname" >"$TMP/snapshot_sequences.sql" || return 1
  while IFS= read -r snapshot_sql; do
    q "$snapshot_sql" >>"$1" || return 1
  done <"$TMP/snapshot_sequences.sql"
}

roles() {
  q "SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM pg_roles r),
    'membership',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m))" >"$1"
}
baseline "$TMP/before.sql" omit-stub
roles "$TMP/roles_before.json"
ORIGINAL="$ROOT/supabase/migrations/20261118a_portal_teren_identitate.sql"
REV="$ROOT/supabase/revenire/20261118a_portal_teren_identitate_ROLLBACK.sql"
# r3: amprentele fixture-ului (21 public + 12 net) se citesc din clusterul efemer INAINTE de apply si intra in copie
# ca literali, exact ca lista revizuita din productie (nu se invata la apply).
AMPRENTE="$TMP/amprente.json"
q "SELECT jsonb_build_object(
  'public',(SELECT jsonb_object_agg('public.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')',md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname ~ '^portal_fixture_public_[0-9]{2}\$'),
  'net',(SELECT jsonb_object_agg('net.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')',md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='net'))" >"$AMPRENTE"
# r9: conturile teren ale fixture-ului (sintetice) -> hash-uri in copie; artefactul de productie are hash-urile reale.
TEREN_FIXTURE=(e1000000-0000-0000-0000-000000000055=55 e1000000-0000-0000-0000-000000000070=70 e1000000-0000-0000-0000-0000000000ff=)
fixture() { # $1 = varianta (director nou in TMP), restul = argumentele --erp
  mkdir "$TMP/$1"
  python3 "$ROOT/scripts/portal/prepare_fixture.py" "$ORIGINAL" "$TMP/$1/20261118a_portal_teren_identitate.sql" \
    --amprente "$AMPRENTE" --teren "${TEREN_FIXTURE[@]}" "${@:2}" >/dev/null
}
source "$ROOT/scripts/portal/concurrency_lock.sh"
# r12: ce face PG17 cu transaction_timeout schimbat in mijlocul tranzactiei (timpi reali; prag doar pe cazul folosit).
semantica_tt
hold_18a() { # $1 = artefactul, $2 = motivul exact, $3 = eticheta; refuz ATOMIC, fara obiecte ramase
  local rc=0 log="$TMP/hold_$3.log"
  runner 20261118120000 "$1" >"$log" 2>&1 || rc=$?
  [[ "$rc" == 10 ]] && grep -q "$2" "$log" || { cat "$log"; fail "expected HOLD $2 ($3)"; }
  [[ "$(q "SELECT count(*) FROM pg_roles WHERE rolname='teren'")" == 0 ]] || fail "partial role after HOLD $3"
  [[ "$(q "SELECT to_regclass('public.conturi_tip') IS NULL")" == t ]] || fail "partial table after HOLD $3"
}
# Mai intai dovada ca artefactul nerevizuit refuza ATOMIC, fara obiecte ramase.
hold_18a "$ORIGINAL" PORTAL_PUBLIC_BASELINE_UNREVIEWED_OR_CHANGED original
# Copilot r2 P1-01: 'erp' numai din lista aprobata explicit; orice abatere refuza atomic.
fixture v_fara_erp
hold_18a "$TMP/v_fara_erp/20261118a_portal_teren_identitate.sql" PORTAL_ERP_APPROVAL_LIST_MISSING fara_erp
fixture v_erp_vechi --erp 00000000-0000-0000-0000-000000000001 00000000-0000-0000-0000-0000000000aa
hold_18a "$TMP/v_erp_vechi/20261118a_portal_teren_identitate.sql" PORTAL_ERP_APPROVAL_LIST_CHANGED erp_vechi
fixture v_fara_owner --erp 00000000-0000-0000-0000-000000000002
hold_18a "$TMP/v_fara_owner/20261118a_portal_teren_identitate.sql" PORTAL_ERP_APPROVAL_OWNER_MISSING fara_owner
fixture v_erp_teren --erp 00000000-0000-0000-0000-000000000001 e1000000-0000-0000-0000-000000000055
hold_18a "$TMP/v_erp_teren/20261118a_portal_teren_identitate.sql" PORTAL_ERP_APPROVAL_LIST_INVALID erp_teren
# r9: hash-urile conturilor teren de productie nu se potrivesc cu fixture-ul = refuz atomic (inventarul teren e verificat).
mkdir "$TMP/v_teren_prod"
python3 "$ROOT/scripts/portal/prepare_fixture.py" "$ORIGINAL" "$TMP/v_teren_prod/20261118a_portal_teren_identitate.sql" \
  --amprente "$AMPRENTE" --erp 00000000-0000-0000-0000-000000000001 >/dev/null
hold_18a "$TMP/v_teren_prod/20261118a_portal_teren_identitate.sql" PORTAL_TERRAIN_INVENTORY_CHANGED teren_prod
fixture v_ok --erp 00000000-0000-0000-0000-000000000001
MIG="$TMP/v_ok/20261118a_portal_teren_identitate.sql"
# r12: runnerul fara --plafon-tranzactie-ms (ca unul vechi) => 18a refuza in $pre$, atomic, nimic ramas.
rc=0; runner_fara_plafon 20261118120000 "$MIG" >"$TMP/fara_plafon_18a.log" 2>&1 || rc=$?
[[ "$rc" == 10 ]] && grep -q 'PORTAL_PLAFON_TRANZACTIE_REQUIRED: 0/default' "$TMP/fara_plafon_18a.log" \
  || { cat "$TMP/fara_plafon_18a.log"; fail "runner fara plafon: asteptat refuz PORTAL_PLAFON_TRANZACTIE_REQUIRED cu cod 10, primit $rc"; }
[[ "$(q "SELECT count(*) FROM pg_roles WHERE rolname='teren'") $(q "SELECT to_regclass('public.conturi_tip') IS NULL")" == '0 t' ]] \
  || fail 'runner fara plafon: au ramas obiecte'
echo 'PLAFON_RUNNER 18a: runner fara --plafon-tranzactie-ms => refuz in $pre$ (0/default), NEAPLICAT (10), nimic ramas'
# r9 (P2-03): drepturile lipsa = refuz cu mesaj clar inainte de orice schimbare (CREATEROLE, REFERENCES pe auth.users).
"${ADMIN[@]}" -d "$DB" -c 'ALTER ROLE postgres NOCREATEROLE' >/dev/null
hold_18a "$MIG" 'PORTAL_PRIVILEGES_MISSING: CREATEROLE' priv_createrole
"${ADMIN[@]}" -d "$DB" -c 'ALTER ROLE postgres CREATEROLE' >/dev/null
"${ADMIN[@]}" -d "$DB" -c 'REVOKE REFERENCES ON auth.users FROM postgres' >/dev/null
hold_18a "$MIG" 'PORTAL_PRIVILEGES_MISSING: REFERENCES pe auth.users' priv_references
"${ADMIN[@]}" -d "$DB" -c 'GRANT REFERENCES ON auth.users TO postgres' >/dev/null
# Copilot r2 P1-02: corp schimbat inainte de apply (aceeasi semnatura, acelasi numar) = refuz, pe net si pe public.
q "CREATE OR REPLACE FUNCTION net.portal_fixture_net_01() RETURNS integer LANGUAGE sql AS 'SELECT 2'" >/dev/null
hold_18a "$MIG" PORTAL_NET_BASELINE_UNREVIEWED_OR_CHANGED net_corp
q "CREATE OR REPLACE FUNCTION net.portal_fixture_net_01() RETURNS integer LANGUAGE sql AS 'SELECT 1'" >/dev/null
q "CREATE OR REPLACE FUNCTION public.portal_fixture_public_01() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 2'" >/dev/null
hold_18a "$MIG" PORTAL_PUBLIC_BASELINE_UNREVIEWED_OR_CHANGED public_corp
q "CREATE OR REPLACE FUNCTION public.portal_fixture_public_01() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1'" >/dev/null
# Jakarinos r6 P2: owner-ul unei functii net schimbat inainte de apply (definitie si set neschimbate) = refuz.
"${ADMIN[@]}" -d "$DB" -c 'ALTER FUNCTION net.portal_fixture_net_02() OWNER TO supabase_auth_admin' >/dev/null
hold_18a "$MIG" PORTAL_NET_BASELINE_UNREVIEWED_OR_CHANGED net_owner
"${ADMIN[@]}" -d "$DB" -c 'ALTER FUNCTION net.portal_fixture_net_02() OWNER TO postgres' >/dev/null
# r10 (Jakarinos r9 P2): tot ce precede $locks$ ruleaza fara niciun lock pe tabelele utilizatorilor (pg_locks, bariera).
TAB_UTIL='auth.users public.employees public.profiles public.user_module_access'
TAB_18A='public.conturi_tip public.conturi_teren public.conturi_tip_jurnal public.portal_public_baseline'
TAB_19A='public.portal_provisioning public.portal_provisioning_jurnal public.portal_e1_1b_manifest'
STARE_18A_NEAPLICAT="SELECT to_regclass('public.conturi_tip') IS NULL AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname='teren')"
lock_pre_observe 18a "$MIG" "$TAB_UTIL" \
  -c "SELECT set_config('gazpet.livrare_migrare','20261118a_portal_teren_identitate:'||txid_current(),true)"
# r9 (P1-01): nivelul lock-urilor tinute de 18a la final (pg_locks) si ce simte un utilizator (probe cu lock_timeout scurt),
# intr-o tranzactie oprita intentionat inainte de commit; apoi refuzul 55P03 cand auth.users e tinut de o tranzactie lunga.
lock_observe 18a 'auth.users=ShareRowExclusiveLock,public.employees=ShareRowExclusiveLock,public.profiles=ShareLock,public.user_module_access=-' \
  'citire auth.users=ok,scriere auth.users=blocat,citire employees=ok,scriere employees=blocat,citire profiles=ok,scriere profiles=blocat,citire user_module_access=ok,scriere user_module_access=ok' \
  "$STARE_18A_NEAPLICAT" \
  -c "SELECT set_config('gazpet.livrare_migrare','20261118a_portal_teren_identitate:'||txid_current(),true)" -f "$MIG"
lock_budget_refusal 18a 20261118120000 "$MIG" \
  "UPDATE auth.users SET email=email WHERE id='00000000-0000-0000-0000-000000000002'" \
  'citire auth.users=ok,scriere auth.users=ok,scriere employees=ok,citire profiles=ok,scriere profiles=ok'
[[ "$(q "$STARE_18A_NEAPLICAT")" == t ]] || fail 'partial 18a after lock budget refusal'
# r11 (al doilea recenzent r10 P1-01): plafonul pe 18a, in cele 3 moduri (pauza intre $locks$ si $critic$, dupa $critic$,
# ceas mostenit de 10 s + 3 s inainte de $locks$): sesiunea inchisa la ~2 s de la lock-uri, ROLLBACK, nimic ramas.
MARCAJ_18A="SELECT set_config('gazpet.livrare_migrare','20261118a_portal_teren_identitate:'||txid_current(),true)"
lock_cap_toate 18a "$MIG" "$STARE_18A_NEAPLICAT" "$MARCAJ_18A"
# r10: aplicarea reala prin runner cu trafic concurent (citiri / scrieri profiles si employees, login simulat pe auth.users)
# si observatorul pg_locks: fereastra de lock (primul lock -> COMMIT) si blocarea maxima a utilizatorilor, cu praguri.
masurat 18a "$TMP/apply.log" runner 20261118120000 "$MIG"
grep -q 'PORTAL_LOCKS 18a' "$TMP/apply.log" || { cat "$TMP/apply.log"; fail 'apply 18a fara PORTAL_LOCKS'; }
# Inventar: owner-ul aprobat = erp; pending + contul legat de fisa cu drept pe modul (neaprobat) = neaprobat.
[[ "$(q "SELECT string_agg(tip||':'||n,',' ORDER BY tip) FROM (SELECT tip,count(*) n FROM public.conturi_tip GROUP BY tip) x")" == 'erp:1,neaprobat:2,teren:3' ]] \
  || fail 'ERP inventory counts'
# PG17 creator has ADMIN but not necessarily SET on a newly created role.
# Harness-only role switch; never inherited by DEFINER functions.
q 'GRANT teren TO postgres WITH INHERIT FALSE, SET TRUE' >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/tests/portal_e1_1a.test.sql" >"$TMP/tests.log" 2>&1 || { cat "$TMP/tests.log"; fail tests; }
grep -q PORTAL_E1_1A_TEST_END "$TMP/tests.log" || fail 'test end marker'
[[ "$(q 'SELECT public.fn_portal_porti_lipsa()')" == '{}' ]] || fail gate
MIG_1B_SRC="$ROOT/supabase/migrations/20261119a_portal_teren_provisioning.sql"
REV_1B="$ROOT/supabase/revenire/20261119a_portal_teren_provisioning_ROLLBACK.sql"
baseline "$TMP/before_1b.sql"
# r7 (Jakarinos r6 P1): ancorele obiectelor externe se citesc din clusterul efemer INAINTE de apply (aceeasi interogare
# ca inventarul de pe prod) si intra in copia 19a ca literal; artefactul de productie are ancorele revizuite din prod.
ANCORE="$TMP/ancore_1b.json"
"${PSQL[@]}" -At -f "$ROOT/scripts/portal/ancore_1b.sql" >"$ANCORE" || fail 'ancore 1b'
mkdir "$TMP/v1b"
MIG_1B="$TMP/v1b/20261119a_portal_teren_provisioning.sql"
python3 "$ROOT/scripts/portal/prepare_fixture_1b.py" "$MIG_1B_SRC" "$MIG_1B" --ancore "$ANCORE" >/dev/null || fail 'fixture 1b'
hold_1b() { # $1 = artefactul, $2 = motivul exact, $3 = eticheta; refuz ATOMIC, fara obiecte 1b ramase
  local rc=0 log="$TMP/hold1b_$3.log"
  runner 20261119120000 "$1" >"$log" 2>&1 || rc=$?
  [[ "$rc" == 10 ]] && grep -q "$2" "$log" || { cat "$log"; fail "expected HOLD 1b $2 ($3)"; }
  [[ "$(q "SELECT to_regclass('public.portal_provisioning') IS NULL AND to_regclass('public.portal_e1_1b_manifest') IS NULL")" == t ]] \
    || fail "partial E1-1b after HOLD $3"
}
# Artefactul cu ancorele productiei nu se potriveste cu clusterul efemer = refuz.
hold_1b "$MIG_1B_SRC" PORTAL_1B_ANCHOR_CHANGED original
# Functia triggerului de pe notifications schimbata inainte de apply (semnatura si ACL pastrate) = refuz atomic.
"${PSQL[@]}" -At -c "SELECT pg_get_functiondef('public.fn_notificari_ruteaza_ofertare()'::regprocedure)" >"$TMP/notif_def.sql"
printf ';\n' >>"$TMP/notif_def.sql"
q "CREATE OR REPLACE FUNCTION public.fn_notificari_ruteaza_ofertare() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS \$f\$ BEGIN PERFORM public.fn_identitate_claims(); RETURN NEW; END \$f\$" >/dev/null
hold_1b "$MIG_1B" PORTAL_1B_ANCHOR_CHANGED notif_corp
"${PSQL[@]}" -f "$TMP/notif_def.sql" >/dev/null
# Un trigger de pe profiles dezactivat inainte de apply = refuz atomic.
q 'ALTER TABLE public.profiles DISABLE TRIGGER trg_profiles_protectie_legatura' >/dev/null
hold_1b "$MIG_1B" PORTAL_1B_ANCHOR_CHANGED profiles_trigger_off
q 'ALTER TABLE public.profiles ENABLE TRIGGER trg_profiles_protectie_legatura' >/dev/null
[[ "$("${PSQL[@]}" -At -f "$ROOT/scripts/portal/ancore_1b.sql")" == "$(cat "$ANCORE")" ]] || fail 'fixture anchors not restored'
MARCAJ_19A="SELECT set_config('gazpet.livrare_migrare','20261119a_portal_teren_provisioning:'||txid_current(),true)"
STARE_19A_NEAPLICAT="SELECT to_regclass('public.portal_provisioning') IS NULL AND to_regclass('public.portal_e1_1b_manifest') IS NULL"
# r10 (Jakarinos r9 P2): prefixul 19a nu tine niciun lock pe tabelele utilizatorilor si nici pe cele din 18a.
lock_pre_observe 19a "$MIG_1B" "$TAB_UTIL $TAB_18A" -c "$MARCAJ_19A"
# r10 (al doilea recenzent r9 P2-01): fereastra 18a -> 19a. Un cont creat dupa COMMIT-ul 18a (handle_new_user vechi, fara
# rand in conturi_tip) e clasificat 'neaprobat' de 19a, sub lock-ul pe auth.users; tranzactie de test anulata integral.
if "${PSQL_LIV[@]}" --single-transaction -c 'SET LOCAL ROLE supabase_auth_admin' \
  -c "INSERT INTO auth.users(id,email) VALUES ('32000000-0000-0000-0000-000000000001','intre.livrari@example.invalid')" \
  -c 'RESET ROLE' \
  -c "DO \$v\$ BEGIN IF EXISTS (SELECT FROM public.conturi_tip WHERE auth_user_id='32000000-0000-0000-0000-000000000001') OR public.fn_portal_porti_lipsa() = '{}' THEN RAISE EXCEPTION 'premisa: contul trebuia sa fie neclasificat'; END IF; END \$v\$" \
  -c "$MARCAJ_19A" -f "$MIG_1B" \
  -c "DO \$v\$ BEGIN IF (SELECT tip||'/'||sursa FROM public.conturi_tip WHERE auth_user_id='32000000-0000-0000-0000-000000000001') IS DISTINCT FROM 'neaprobat/reconciliere_e1_1b' OR (SELECT role FROM public.profiles WHERE id='32000000-0000-0000-0000-000000000001') IS DISTINCT FROM 'manager_santier' OR public.fn_portal_porti_lipsa_1b() <> '{}' THEN RAISE EXCEPTION 'reconcilierea a esuat'; END IF; RAISE EXCEPTION 'PORTAL_RECONCILIERE_OK'; END \$v\$" \
  >"$TMP/reconciliere.log" 2>&1; then fail 'reconcilierea: tranzactia de test nu trebuia comisa'; fi
grep -q PORTAL_RECONCILIERE_OK "$TMP/reconciliere.log" && grep -q 'PORTAL_1B_RECONCILIATE: 1 ' "$TMP/reconciliere.log" \
  || { cat "$TMP/reconciliere.log"; fail 'reconcilierea 18a -> 19a'; }
# Un cont teren (domeniu sau tip_cont) aparut intre livrari nu are o cale legitima => 19a refuza, nimic schimbat.
if "${PSQL_LIV[@]}" --single-transaction -c 'SET LOCAL ROLE supabase_auth_admin' \
  -c "INSERT INTO auth.users(id,email) VALUES ('32000000-0000-0000-0000-000000000002','strecurat@teren.gazpet.ro')" \
  -c 'RESET ROLE' -c "$MARCAJ_19A" -f "$MIG_1B" >"$TMP/reconciliere_teren.log" 2>&1; then fail 'reconcilierea a acceptat un cont teren neclasificat'; fi
grep -q PORTAL_1B_TERRAIN_UNCLASSIFIED "$TMP/reconciliere_teren.log" || { cat "$TMP/reconciliere_teren.log"; fail 'refuz cont teren intre livrari'; }
[[ "$(q "$STARE_19A_NEAPLICAT") $(q "SELECT count(*) FROM auth.users WHERE id::text LIKE '32000000-%'")" == 't 0' ]] || fail 'reconciliere: au ramas efecte'
# r9 (P1-01): 19a — profiles ACCESS EXCLUSIVE doar pe coada, employees fara ACCESS EXCLUSIVE (citirile HR libere).
lock_observe 19a 'auth.users=ShareRowExclusiveLock,public.employees=ShareRowExclusiveLock,public.profiles=AccessExclusiveLock,public.user_module_access=ShareLock' \
  'citire auth.users=ok,scriere auth.users=blocat,citire employees=ok,scriere employees=blocat,citire profiles=blocat,scriere profiles=blocat,citire user_module_access=ok,scriere user_module_access=blocat' \
  "$STARE_19A_NEAPLICAT" -c "$MARCAJ_19A" -f "$MIG_1B"
# O citire lunga pe profiles: 19a refuza in ~3 s cu 55P03, iar citirile / scrierile ERP NU se aseaza in spatele ei.
lock_budget_refusal 19a 20261119120000 "$MIG_1B" 'SELECT count(*) FROM public.profiles' \
  'citire auth.users=ok,scriere auth.users=ok,scriere employees=ok,citire profiles=ok,scriere profiles=ok'
[[ "$(q "$STARE_19A_NEAPLICAT")" == t ]] || fail 'partial E1-1b after lock budget refusal'
# r10 / r11 (P1-01): plafonul de BLOCARE pe 19a (profiles ACCESS EXCLUSIVE = cazul cel mai rau), in cele 3 moduri:
# serverul inchide sesiunea la ~2 s de la obtinerea lock-urilor, ROLLBACK, lock-uri eliberate, nimic ramas.
lock_cap_toate 19a "$MIG_1B" "$STARE_19A_NEAPLICAT" "$MARCAJ_19A"
masurat 19a "$TMP/apply_1b.log" runner 20261119120000 "$MIG_1B"
grep -q 'PORTAL_LOCKS 19a' "$TMP/apply_1b.log" || { cat "$TMP/apply_1b.log"; fail 'apply 19a fara PORTAL_LOCKS'; }
grep -q 'PORTAL_1B_RECONCILIATE: 0 ' "$TMP/apply_1b.log" || { cat "$TMP/apply_1b.log"; fail 'apply 19a: reconcilierea trebuia sa gaseasca 0 conturi'; }
[[ "$(q 'SELECT public.fn_portal_porti_lipsa_1b()')" == '{}' ]] || fail 'gate E1-1b'
[[ -z "$("${PSQL[@]}" -At -f "$ROOT/scripts/control_0e.sql")" ]] || fail 'E1-1b control 0e'
"${PSQL[@]}" -f "$ROOT/supabase/tests/portal_e1_1b.test.sql" >"$TMP/tests_1b.log" 2>&1 || { cat "$TMP/tests_1b.log"; fail 'tests E1-1b'; }
grep -q PORTAL_E1_1B_TEST_END "$TMP/tests_1b.log" || fail 'test end E1-1b'
# Regresiile E1-1a raman active si dupa schimbarea provisioning-ului.
"${PSQL[@]}" -f "$ROOT/supabase/tests/portal_e1_1a.test.sql" >"$TMP/regression_1a.log" 2>&1 || { cat "$TMP/regression_1a.log"; fail 'regression E1-1a'; }
source "$ROOT/scripts/portal/concurrency_1b.sh"
if "${PSQL_LIV[@]}" --single-transaction \
 -c "SELECT set_config('gazpet.livrare_migrare','20261119a_portal_teren_provisioning_ROLLBACK:'||txid_current(),true)" \
 -c "INSERT INTO public.portal_provisioning(provisioning_id,employee_id,email_calculat,stare,cerut_de,payload_sha256) VALUES ('10000000-0000-0000-0000-000000000077',55,'new.fixture@teren.gazpet.ro','rezervat','00000000-0000-0000-0000-000000000001',sha256('fixture'::bytea))" \
 -f "$REV_1B" >"$TMP/rollback_1b_data_refused.log" 2>&1; then fail 'E1-1b rollback accepted new history'; fi
grep -q PORTAL_1B_ROLLBACK_NEW_DATA_OR_CONFIG "$TMP/rollback_1b_data_refused.log" || fail 'wrong E1-1b rollback data refusal'
if "${PSQL_LIV[@]}" --single-transaction \
 -c "SELECT set_config('gazpet.livrare_migrare','20261119a_portal_teren_provisioning_ROLLBACK:'||txid_current(),true)" \
 -c 'ALTER TABLE public.portal_provisioning DISABLE ROW LEVEL SECURITY' \
 -f "$REV_1B" >"$TMP/rollback_1b_config_refused.log" 2>&1; then fail 'E1-1b rollback accepted RLS drift'; fi
grep -q PORTAL_1B_ROLLBACK_NEW_DATA_OR_CONFIG "$TMP/rollback_1b_config_refused.log" || fail 'wrong E1-1b rollback config refusal'
# r3: un cont ERP nou (in_asteptare) creat dupa 19a face imposibila restaurarea CHECK-ului vechi = refuz explicit.
if "${PSQL_LIV[@]}" --single-transaction \
 -c "SELECT set_config('gazpet.livrare_migrare','20261119a_portal_teren_provisioning_ROLLBACK:'||txid_current(),true)" \
 -c 'SET LOCAL ROLE supabase_auth_admin' \
 -c "INSERT INTO auth.users(id,email) VALUES ('30000000-0000-0000-0000-000000000001','nou.erp@example.invalid')" \
 -c 'RESET ROLE' \
 -f "$REV_1B" >"$TMP/rollback_1b_pending_refused.log" 2>&1; then fail 'E1-1b rollback accepted new pending account'; fi
grep -q PORTAL_1B_ROLLBACK_NEW_DATA_OR_CONFIG "$TMP/rollback_1b_pending_refused.log" || { cat "$TMP/rollback_1b_pending_refused.log"; fail 'wrong E1-1b rollback pending refusal'; }
# Jakarinos r3 P1: un helper de nivel 2 din lantul triggerului de pe profiles schimbat dupa 19a = revenire refuzata.
if "${PSQL_LIV[@]}" --single-transaction \
 -c "SELECT set_config('gazpet.livrare_migrare','20261119a_portal_teren_provisioning_ROLLBACK:'||txid_current(),true)" \
 -c "CREATE OR REPLACE FUNCTION public.fn_identitate_privilegiata() RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS 'SELECT NULL::boolean'" \
 -f "$REV_1B" >"$TMP/rollback_1b_helper_refused.log" 2>&1; then fail 'E1-1b rollback accepted level-2 helper drift'; fi
grep -q PORTAL_1B_ROLLBACK_NEW_DATA_OR_CONFIG "$TMP/rollback_1b_helper_refused.log" || { cat "$TMP/rollback_1b_helper_refused.log"; fail 'wrong E1-1b rollback helper refusal'; }
# Jakarinos r4 P2: parametrii secventei jurnalului de provisioning schimbati dupa 19a = revenire refuzata.
if "${PSQL_LIV[@]}" --single-transaction \
 -c "SELECT set_config('gazpet.livrare_migrare','20261119a_portal_teren_provisioning_ROLLBACK:'||txid_current(),true)" \
 -c 'ALTER TABLE public.portal_provisioning_jurnal ALTER COLUMN id SET INCREMENT BY 2' \
 -f "$REV_1B" >"$TMP/rollback_1b_sequence_refused.log" 2>&1; then fail 'E1-1b rollback accepted sequence drift'; fi
grep -q PORTAL_1B_ROLLBACK_NEW_DATA_OR_CONFIG "$TMP/rollback_1b_sequence_refused.log" || { cat "$TMP/rollback_1b_sequence_refused.log"; fail 'wrong E1-1b rollback sequence refusal'; }
# Apply -> rollback -> re-apply direct, tranzactional, pentru DDL. Runnerul refuza intentionat relivrarea aceluiasi nume.
"${PSQL_LIV[@]}" --single-transaction \
 -c "SELECT set_config('gazpet.livrare_migrare','20261119a_portal_teren_provisioning_ROLLBACK:'||txid_current(),true)" \
 -f "$REV_1B" \
 -c "SELECT set_config('gazpet.livrare_migrare','20261119a_portal_teren_provisioning:'||txid_current(),true)" \
 -f "$MIG_1B" >"$TMP/roundtrip_1b.log" 2>&1 || { cat "$TMP/roundtrip_1b.log"; fail 'E1-1b DDL roundtrip'; }
# r3: o schimbare fara legatura cu portalul (alt modul: functie fara PUBLIC, tabel nou, date in alt tabel)
# nu inroseste poarta 1b si nu blocheaza revenirea. Se curata dupa revenire, inaintea comparatiei finale.
q "CREATE FUNCTION public.alt_modul_fixture() RETURNS integer LANGUAGE sql AS 'SELECT 1';
 REVOKE ALL ON FUNCTION public.alt_modul_fixture() FROM PUBLIC;
 CREATE TABLE public.alt_modul_fixture_tabel(id integer);
 UPDATE public.facturi SET suma=suma+1 WHERE id=1" >/dev/null
[[ "$(q 'SELECT public.fn_portal_porti_lipsa_1b()')" == '{}' ]] || fail 'unrelated change reddened gate E1-1b'
# r10 (punctul 7): revenirile urmeaza aceleasi reguli: prefix fara lock-uri, fereastra si blocarea masurate cu trafic.
MARCAJ_REV19A="SELECT set_config('gazpet.livrare_migrare','20261119a_portal_teren_provisioning_ROLLBACK:'||txid_current(),true)"
lock_pre_observe rev19a "$REV_1B" "$TAB_UTIL $TAB_18A $TAB_19A" -c "$MARCAJ_REV19A"
# r9 (P1-01): revenirea 19a tine ACCESS EXCLUSIVE pe auth.users / employees / profiles (DROP FK / TRIGGER, CHECK).
lock_observe rev19a 'auth.users=AccessExclusiveLock,public.employees=AccessExclusiveLock,public.profiles=AccessExclusiveLock,public.user_module_access=ShareLock' \
  'citire auth.users=blocat,scriere auth.users=blocat,citire employees=blocat,scriere employees=blocat,citire profiles=blocat,scriere profiles=blocat,citire user_module_access=ok,scriere user_module_access=blocat' \
  "SELECT to_regclass('public.portal_provisioning') IS NOT NULL" -c "$MARCAJ_REV19A" -f "$REV_1B"
# r11: plafonul pe revenirea 19a (ACCESS EXCLUSIVE pe auth.users / employees / profiles), cele 3 moduri; 19a ramane aplicat.
lock_cap_toate rev19a "$REV_1B" "SELECT to_regclass('public.portal_provisioning') IS NOT NULL" "$MARCAJ_REV19A"
masurat rev19a "$TMP/rollback_1b.log" runner 20261119120001 "$REV_1B"
q "DROP FUNCTION public.alt_modul_fixture(); DROP TABLE public.alt_modul_fixture_tabel;
 UPDATE public.facturi SET suma=suma-1 WHERE id=1" >/dev/null
# Regresie pentru ordinea fizica: UPDATE fara schimbare semantica, snapshot identic.
baseline "$TMP/order_before.sql"
q "UPDATE public.profiles SET email=email WHERE id='00000000-0000-0000-0000-000000000002'" >/dev/null
baseline "$TMP/order_after.sql"
diff -u "$TMP/order_before.sql" "$TMP/order_after.sql" || fail 'snapshot depends on physical row order'
baseline "$TMP/after_1b.sql"
diff -u "$TMP/before_1b.sql" "$TMP/after_1b.sql" || fail 'E1-1b changed original handle/ACL/schema/data'
[[ "$(q "SELECT to_regclass('public.portal_provisioning') IS NULL AND to_regprocedure('public.fn_portal_cont_finalizeaza(uuid)') IS NULL")" == t ]] || fail 'E1-1b objects left'
[[ -z "$("${PSQL[@]}" -At -f "$ROOT/scripts/control_0e.sql")" ]] || fail 'control 0e'
rc=0
runner 20261118120000 "$MIG" >"$TMP/reapply.log" 2>&1 || rc=$?
[[ "$rc" == 11 ]] || fail "reapply expected 11, got $rc"
# Refuzul revenirii cu istoric nou; test in tranzactie anulata integral.
# r9: atestarea se verifica acum INAINTEA lock-urilor => refuzurile pe date / configuratie se testeaza cu atestare.
if "${PSQL_LIV[@]}" --single-transaction \
  -c "SELECT set_config('gazpet.livrare_migrare','20261118a_portal_teren_identitate_ROLLBACK:'||txid_current(),true)" \
  -c "SELECT set_config('gazpet.hook_auth_dezactivat','ATEST:'||txid_current(),true)" \
  -c "UPDATE public.conturi_tip SET sursa='fixture_new' WHERE auth_user_id='e1000000-0000-0000-0000-000000000055'" \
  -f "$REV" >"$TMP/rollback_refused.log" 2>&1; then fail 'rollback accepted changed inventory'; fi
grep -q PORTAL_ROLLBACK_NEW_DATA_OR_CONFIG "$TMP/rollback_refused.log" || { cat "$TMP/rollback_refused.log"; fail 'wrong rollback refusal'; }
# r9 (P2-02): un cont nou aparut dupa apply = revenirea 18a refuza (documentat in fisierul de revenire), nimic schimbat.
if "${PSQL_LIV[@]}" --single-transaction \
  -c "SELECT set_config('gazpet.livrare_migrare','20261118a_portal_teren_identitate_ROLLBACK:'||txid_current(),true)" \
  -c "SELECT set_config('gazpet.hook_auth_dezactivat','ATEST:'||txid_current(),true)" \
  -c 'SET LOCAL ROLE supabase_auth_admin' \
  -c "INSERT INTO auth.users(id,email) VALUES ('30000000-0000-0000-0000-000000000002','nou2.erp@example.invalid')" \
  -c 'RESET ROLE' \
  -f "$REV" >"$TMP/rollback_new_account_refused.log" 2>&1; then fail 'rollback 18a accepted new account'; fi
grep -q PORTAL_ROLLBACK_NEW_DATA_OR_CONFIG "$TMP/rollback_new_account_refused.log" || { cat "$TMP/rollback_new_account_refused.log"; fail 'wrong rollback 18a new account refusal'; }
if "${PSQL_LIV[@]}" --single-transaction \
  -c "SELECT set_config('gazpet.livrare_migrare','20261118a_portal_teren_identitate_ROLLBACK:'||txid_current(),true)" \
  -c "SELECT set_config('gazpet.hook_auth_dezactivat','ATEST:'||txid_current(),true)" \
  -c 'ALTER TABLE public.conturi_tip DISABLE ROW LEVEL SECURITY' \
  -f "$REV" >"$TMP/rollback_config_refused.log" 2>&1; then fail 'rollback accepted changed RLS'; fi
grep -q PORTAL_ROLLBACK_NEW_DATA_OR_CONFIG "$TMP/rollback_config_refused.log" || { cat "$TMP/rollback_config_refused.log"; fail 'wrong config refusal'; }
if runner 20261118120001 "$REV" >"$TMP/no_attestation.log" 2>&1; then fail 'rollback accepted missing Auth attestation'; fi
grep -q PORTAL_AUTH_HOOK_ATTESTATION_REQUIRED "$TMP/no_attestation.log" || { cat "$TMP/no_attestation.log"; fail 'wrong Auth attestation refusal'; }
# Atestare simulata EXCLUSIV in copia harness; SQL-ul de productie continua sa o ceara operatorului.
ATTESTED_REV="$TMP/20261118a_portal_teren_identitate_ROLLBACK.sql"
python3 - "$REV" "$ATTESTED_REV" <<'PY'
from pathlib import Path
import sys
source, target = map(Path, sys.argv[1:])
target.write_text("SELECT set_config('gazpet.hook_auth_dezactivat','ATEST:'||txid_current(),true);\n" + source.read_text(encoding='utf-8').replace('\r\n', '\n'), encoding='utf-8', newline='\n')
PY
MARCAJ_REV18A="SELECT set_config('gazpet.livrare_migrare','20261118a_portal_teren_identitate_ROLLBACK:'||txid_current(),true)"
lock_pre_observe rev18a "$ATTESTED_REV" "$TAB_UTIL $TAB_18A" -c "$MARCAJ_REV18A"
# r9 (P1-01): revenirea 18a tine ACCESS EXCLUSIVE pe auth.users / employees (DROP FK); profiles neatins.
lock_observe rev18a 'auth.users=AccessExclusiveLock,public.employees=AccessExclusiveLock,public.profiles=-,public.user_module_access=-' \
  'citire auth.users=blocat,scriere auth.users=blocat,citire employees=blocat,scriere employees=blocat,citire profiles=ok,scriere profiles=ok,citire user_module_access=ok,scriere user_module_access=ok' \
  "SELECT to_regclass('public.conturi_tip') IS NOT NULL" -c "$MARCAJ_REV18A" -f "$ATTESTED_REV"
# r11: plafonul pe revenirea 18a (ACCESS EXCLUSIVE pe auth.users / employees), cele 3 moduri; 18a ramane aplicat.
lock_cap_toate rev18a "$ATTESTED_REV" "SELECT to_regclass('public.conturi_tip') IS NOT NULL" "$MARCAJ_REV18A"
masurat rev18a "$TMP/rollback.log" runner 20261118120001 "$ATTESTED_REV"
[[ "$(q "SELECT count(*) FROM pg_roles WHERE rolname='teren'")" == 0 ]] || fail 'role left'
[[ "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('conturi_tip','conturi_teren','conturi_tip_jurnal','conturi_tip_jurnal_id_seq')")" == 0 ]] || fail 'tables left'
[[ "$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('fn_portal_public_md5','fn_portal_net_md5','fn_portal_catalog_amprenta','fn_teren_eligibil','fn_portal_porti_lipsa','fn_portal_public_aprobat','fn_conturi_tip_audit','fn_conturi_jurnal_imuabil')")" == 0 ]] || fail 'functions left'
"${PSQL[@]}" -f "$ROOT/supabase/tests/portal_e1_stub.test.sql" >"$TMP/stub.log" 2>&1 || { cat "$TMP/stub.log"; fail stub; }
baseline "$TMP/after.sql" omit-stub
roles "$TMP/roles_after.json"
diff -u "$TMP/before.sql" "$TMP/after.sql" || fail 'existing schema/data/ACL changed'
diff -u "$TMP/roles_before.json" "$TMP/roles_after.json" || fail 'existing roles/membership changed'
rc=0
runner 20261118120000 "$MIG" >"$TMP/reapply_after_rollback.log" 2>&1 || rc=$?
[[ "$rc" == 11 ]] || fail 'history allows reapply after rollback'
[[ -z "$("${PSQL[@]}" -At -f "$ROOT/scripts/control_0e.sql")" ]] || fail 'rollback control 0e'
# r10 (al doilea recenzent r9 P1-01): aceeasi masurare pe un cluster NOU cu volum ~2x productia
# (supabase/tests/portal_e1_volum.sql: 400 de conturi / profiluri / angajati, 1.600 de drepturi pe module, 600 de tabele
# x 20 de coloane si 1.500 de functii in public) = estimarea ferestrei de lock pe volumele reale. Aceleasi copii ale
# artefactelor (amprentele si ancorele fixture-ului nu depind de cluster), acelasi runner, trafic si praguri.
"$PG_BIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null
DATA="$TMP/pg_volum"; PG_LOG="$TMP/pg_volum.log"
cluster_nou
"${ADMIN[@]}" -d "$DB" -f "$ROOT/supabase/tests/portal_e1_volum.sql" >/dev/null
# r12: verificarea numara DOAR tabelele (relkind 'r'); in r10 numara si indexurile volum_tN_pkey (1.200 <> 600) =>
# „volum: fixture incomplet” (harness-ul PG17, 11.11.2026). Numele exacte (regex), nu LIKE ('_' = orice caracter).
VOLUM="$(q "SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'volum.%@example.invalid')||'|'||
  (SELECT count(*) FROM public.profiles WHERE email LIKE 'volum.%@example.invalid' AND employee_id BETWEEN 1001 AND 1400)||'|'||
  (SELECT count(*) FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id WHERE p.email LIKE 'volum.%@example.invalid')||'|'||
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname ~ '^volum_t[0-9]+\$')||'|'||
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname ~ '^volum_f[0-9]+\$')")"
[[ "$VOLUM" == '400|400|1600|600|1500' ]] \
  || fail "volum: fixture incomplet (conturi|profiluri legate|drepturi|tabele|functii = $VOLUM, asteptat 400|400|1600|600|1500)"
echo "VOLUM: $VOLUM (conturi | profiluri legate de fise | drepturi pe module | tabele x 20 coloane | functii)"
masurat vol_18a "$TMP/vol_18a.log" runner 20261118120000 "$MIG"
masurat vol_19a "$TMP/vol_19a.log" runner 20261119120000 "$MIG_1B"
[[ "$(q 'SELECT public.fn_portal_porti_lipsa_1b()')" == '{}' ]] || fail 'volum: poarta 1b'
masurat vol_rev19a "$TMP/vol_rev19a.log" runner 20261119120001 "$REV_1B"
masurat vol_rev18a "$TMP/vol_rev18a.log" runner 20261118120001 "$ATTESTED_REV"
[[ "$(q "SELECT to_regclass('public.conturi_tip') IS NULL AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname='teren')")" == t ]] || fail 'volum: revenirea incompleta'
# r11 (Jakarinos r10 P2): LIMITA plafonului, aratata: COMMIT intarziat (replicare sincrona spre un standby inexistent),
# pe un cluster nou dedicat (fixture-ul de baza), fiindca proba lasa 18a COMIS.
"$PG_BIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null
DATA="$TMP/pg_commit"; PG_LOG="$TMP/pg_commit.log"
cluster_nou
lock_commit_lent 18a "$MIG" "$STARE_18A_NEAPLICAT" "$MARCAJ_18A" \
  'auth.users=ShareRowExclusiveLock,public.employees=ShareRowExclusiveLock,public.profiles=ShareLock,public.user_module_access=-'
# r13: un esec de plafon nu opreste harness-ul; aici, dupa volum si commit-ul lent, lista completa => cod 1.
if (( ${#CAP_ESECURI[@]} > 0 )); then
  fail "plafon: ${#CAP_ESECURI[@]} din $CAP_PROBE probe LOCK_CAP picate (lista PLAFON_ESECURI); restul harness-ului (volum, commit lent) a rulat si a trecut"
fi
(( CAP_PROBE == 16 )) || fail "plafon: $CAP_PROBE probe LOCK_CAP rulate, asteptat 16"
echo "PLAFON_TOATE: 16/16 probe LOCK_CAP trecute cu ceasul de perete stabil (abatere < ${PORTAL_SALT_MS} ms fata de ceasul monoton); probe repetate dupa un salt de ceas: $CAP_REPETARI"
echo "PASS PORTAL_E1_1A+1B r13 PRODLIKE PG$PG_MAJOR (postgres NOSUPERUSER$([[ "$NATIV" == 1 ]] && echo ', binare native PORTAL_PG_BIN')); public/net/ERP sintetice in harness, listele revizuite in migrare; fereastra <= ${PORTAL_FEREASTRA_MS} ms si blocare <= ${PORTAL_BLOCARE_MS} ms pe fixture si pe volum; plafon ${PORTAL_PLAFON_MS} ms de la BEGIN pana la intrarea in COMMIT (ceasul din conexiunea runnerului) dovedit pe 18a / 19a / rev19a / rev18a (4 moduri: fara timeout prealabil x2, rol 10 s, rol 500 ms) + refuzurile fara plafon / ceas schimbat; COMMIT-ul intarziat NU e plafonat (LOCK_COMMIT_LENT)"
