#!/usr/bin/env bash
# ============================================================================
# Harness SQL LOCAL — SEC F1 (20260930i_sec_f1_truncate_revoke) + SEC F2 (20260930j_sec_f2_profiles_uid_null), runda 6.
# Testul end-to-end cu PostgREST real (opțional): scripts/test_sec_f2_postgrest.sh.
#
# Rulează EXCLUSIV pe un cluster PostgreSQL 17 local, creat de script (initdb într-un director temporar, doar socket unix,
# fără TCP). Nu citește .env, nu folosește chei Supabase, nu atinge producția. Refuză dacă PGHOST indică o gazdă nelocală.
# Simulează runnerul (scripts/livrare_migrare.sh): marcajul gazpet.livrare_migrare + fișierul, psql --single-transaction.
#
# Utilizare:  bash scripts/test_sec_f1_f2.sh        (PGBIN=/usr/lib/postgresql/17/bin, PORT=5499 implicit)
# Ieșire: 0 dacă toate cazurile trec, 1 altfel. Rezumatul: linii „PASS/FAIL <caz>”.
# ============================================================================
set -u
case "${PGHOST:-}" in
  ""|localhost|127.0.0.1|::1|/*) ;;
  *) echo "REFUZ: PGHOST=$PGHOST nu e local — harness-ul rulează doar pe clustere locale"; exit 2 ;;
esac
unset PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGPASSWORD PGSERVICE PGSERVICEFILE PGPASSFILE DATABASE_URL
ROOT=$(cd "$(dirname "$0")/.." && pwd)
M=$ROOT/supabase/migrations; T=$ROOT/supabase/tests
PGB=${PGBIN:-/usr/lib/postgresql/17/bin}; PORT=${PORT:-5499}
D=$(mktemp -d "${TMPDIR:-/tmp}/sec_f1_f2.XXXXXX"); chmod 777 "$D"
AS=""; if [ "$(id -u)" = 0 ]; then AS="su nobody -s /bin/bash -c"; chown nobody "$D"; fi
pgctl() { if [ -n "$AS" ]; then $AS "$*"; else bash -c "$*"; fi; }
pgctl "$PGB/initdb -D $D/data -U postgres -A trust >/dev/null && $PGB/pg_ctl -D $D/data -o '-k $D -p $PORT -c listen_addresses=' -l $D/log start >/dev/null" || { echo "initdb/pg_ctl a eșuat"; exit 2; }
trap 'pgctl "$PGB/pg_ctl -D $D/data stop -m fast >/dev/null"; rm -rf "$D"' EXIT
Q() { local u=$1; shift; "$PGB/psql" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -h "$D" -p "$PORT" -U "$u" postgres "$@"; }
P() { Q postgres "$@"; }
NFAIL=0
ok()  { echo "PASS $1"; }
bad() { echo "FAIL $1 — $2"; NFAIL=$((NFAIL+1)); }

# --- fixture: schelet + corpurile LIVE ale celor 3 funcții (extrase din ROLLBACK) + S-A + triggere
P -f "$T/sec_f1_f2_fixture.sql" >/dev/null || { echo "fixture 1 a eșuat"; exit 2; }
python3 - "$M/20260930j_sec_f2_profiles_uid_null_ROLLBACK.sql" > "$D/live_fns.sql" <<'PY'
import re,sys
t=open(sys.argv[1]).read()
# a 4-a funcție (fn_profiles_campuri_owner_only) o creează fixture-ul de triggere (corp live c06d7ce0…); aici doar cele 3
print("\n".join(f for f in re.findall(r"(CREATE OR REPLACE FUNCTION public\.\w+\(\).*?\$function\$;)", t, re.S) if "fn_profiles_campuri_owner_only" not in f))
PY
P -f "$D/live_fns.sql" >/dev/null && P -f "$T/sec_f1_f2_fixture_triggers.sql" >/dev/null || { echo "fixture 2 a eșuat"; exit 2; }

# run <fișier.sql> [<nume marcaj>] — ca runnerul: marcaj + fișier într-o singură tranzacție
run() { local f=$1 n=${2:-$(basename "$1" .sql)}
  { echo "SELECT set_config('gazpet.livrare_migrare', '$n:' || txid_current(), true);"; cat "$f"; } > "$D/run.sql"
  P --single-transaction -f "$D/run.sql" 2>&1; }

# ================================ F1 =========================================
F1=$M/20260930i_sec_f1_truncate_revoke.sql
# F1-a: postcondiția 3c cade dacă service_role PIERDE TRUNCATE pe un tabel (−1)
sed 's/^REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;/&\nREVOKE TRUNCATE ON public.t_a FROM service_role;/' "$F1" > "$D/f1_minus.sql"
o=$(run "$D/f1_minus.sql" 20260930i_sec_f1_truncate_revoke); echo "$o" | grep -q "Postcondiție 3c" && ok "F1-a service_role −1 ⇒ 3c refuză" || bad "F1-a" "$o"
# F1-b: ... sau CÂȘTIGĂ TRUNCATE pe un tabel (+1, app_secrets)
sed 's/^REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;/&\nGRANT TRUNCATE ON public.app_secrets TO service_role;/' "$F1" > "$D/f1_plus.sql"
o=$(run "$D/f1_plus.sql" 20260930i_sec_f1_truncate_revoke); echo "$o" | grep -q "Postcondiție 3c" && ok "F1-b service_role +1 ⇒ 3c refuză" || bad "F1-b" "$o"
# F1-c: sonda prinde o setare implicită GLOBALĂ a lui postgres (neacoperită de 3b, care citește doar schema public)
sed 's/^ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;/&\nALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT TRUNCATE ON TABLES TO authenticated;/' "$F1" > "$D/f1_global.sql"
o=$(run "$D/f1_global.sql" 20260930i_sec_f1_truncate_revoke); echo "$o" | grep -q "Postcondiție 3d" && ok "F1-c default ACL global cu TRUNCATE ⇒ sonda 3d refuză" || bad "F1-c" "$o"
# F1-d: sonda prinde setarea implicită pe public dacă pasul 2 lipsește (3b cade primul — oricare dintre ele e refuz)
sed '/^ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE/d' "$F1" > "$D/f1_nodef.sql"
o=$(run "$D/f1_nodef.sql" 20260930i_sec_f1_truncate_revoke); echo "$o" | grep -Eq "Postcondiție 3[bd]" && ok "F1-d fără pasul 2 ⇒ 3b/3d refuză" || bad "F1-d" "$o"
# F1-e: variantele eșuate nu lasă urme (tranzacție unică)
n=$(P -tA -c "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND has_table_privilege('anon',oid,'TRUNCATE')")
[ "$n" -gt 0 ] && [ -z "$(P -tA -c "SELECT 1 FROM pg_namespace WHERE nspname='_sec_f1_sonda_schema'")" ] && ok "F1-e eșecurile nu lasă urme (anon TRUNCATE încă pe $n relații, fără schemă-sondă)" || bad "F1-e" "n=$n"
# F1-f: garda de livrare refuză fără marcaj
o=$(P -f "$F1" 2>&1); echo "$o" | grep -q "garda de livrare (start)" && ok "F1-f fără runner ⇒ refuz" || bad "F1-f" "$o"
# F1-g: aplicarea reală trece; stare 0/0, service_role neschimbat, sonda ștearsă
sr0=$(P -tA -c "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') AND has_table_privilege('service_role',oid,'TRUNCATE')")
o=$(run "$F1"); r=$?
st=$(P -tA -c "SELECT sum(has_table_privilege('anon',oid,'TRUNCATE')::int)||'/'||sum(has_table_privilege('authenticated',oid,'TRUNCATE')::int)||'/'||sum((relkind IN ('r','p') AND has_table_privilege('service_role',oid,'TRUNCATE'))::int)||'/'||count(*) FILTER (WHERE relname LIKE '_sec_f1_sonda%') FROM pg_class WHERE relnamespace='public'::regnamespace")
[ $r = 0 ] && [ "$st" = "0/0/$sr0/0" ] && ok "F1-g aplicare: anon/auth/service_role/sonde = $st (service_role înainte $sr0)" || bad "F1-g" "rc=$r st=$st $o"
# F1-h: tabel nou creat de postgres după migrare ⇒ fără TRUNCATE pentru anon/authenticated
P -c "CREATE TABLE t_nou(id int)" && st=$(P -tA -c "SELECT has_table_privilege('anon','t_nou','TRUNCATE')||'/'||has_table_privilege('authenticated','t_nou','TRUNCATE')||'/'||has_table_privilege('service_role','t_nou','TRUNCATE')")
[ "$st" = "false/false/true" ] && ok "F1-h tabel nou postgres: anon/auth/sr = $st" || bad "F1-h" "$st"
# F1-i: reaplicare idempotentă
o=$(run "$F1"); [ $? = 0 ] && ok "F1-i reaplicare idempotentă" || bad "F1-i" "$o"

# ================================ F2 =========================================
F2=$M/20260930j_sec_f2_profiles_uid_null.sql
U2=22222222-2222-2222-2222-222222222222; U1=11111111-1111-1111-1111-111111111111
MDQ="SELECT string_agg(proname||'='||md5(prosrc), ' ' ORDER BY proname) FROM pg_proc WHERE proname IN ('prevent_role_escalation','enforce_owner_only_salary_flags','protect_can_access_pontaj_brut','fn_profiles_campuri_owner_only')"
RB0=$M/20260930j_sec_f2_profiles_uid_null_ROLLBACK.sql
MD_PATCH="enforce_owner_only_salary_flags=daaa561298c10c259944600e6c39467e fn_profiles_campuri_owner_only=9acc36a4067eddbdf29956220023ea92 prevent_role_escalation=cf75b37d522e2a6b0b9c9eabd72c27b4 protect_can_access_pontaj_brut=2eec050b53f37ec995da79e93a2a4686"
MD_LIVE="enforce_owner_only_salary_flags=0470660c0a819981ff914355c7f6d00a fn_profiles_campuri_owner_only=c06d7ce0f212c7bba2093c50614a88fc prevent_role_escalation=16112659be92143e6539ae0e54e47a06 protect_can_access_pontaj_brut=ff277c90e02ef03d1efb34cd7e87b1d4"
# Suita de comportament pentru utilizatori reali (cazul 7) — rulată cu corpurile LIVE și apoi cu cele din patch; ieșirile trebuie identice
suite7() {
  for c in \
    "$U2|UPDATE profiles SET role='owner' WHERE id='$U2'" \
    "$U2|UPDATE profiles SET is_owner=true WHERE id='$U2'" \
    "$U2|UPDATE profiles SET can_access_salarii=true, can_access_financiar=true WHERE id='$U2' RETURNING can_access_salarii, can_access_financiar" \
    "$U2|UPDATE profiles SET can_access_pontaj_brut=true WHERE id='$U2'" \
    "$U2|UPDATE profiles SET department='HR' WHERE id='$U2'" \
    "$U2|UPDATE profiles SET role=role WHERE id='$U2' RETURNING role" \
    "$U1|UPDATE profiles SET role='sef', is_owner=true WHERE id='$U2' RETURNING role, is_owner" \
    "$U1|UPDATE profiles SET can_access_salarii=true, can_access_pontaj_brut=true WHERE id='$U2' RETURNING can_access_salarii, can_access_pontaj_brut" \
    "$U1|UPDATE profiles SET department='HR' WHERE id='$U2' RETURNING department"; do
    sub=${c%%|*}; sql=${c#*|}
    echo "## $sub :: $sql"
    Q authenticator -tA -c "BEGIN" -c "SELECT set_config('request.jwt.claims','{\"role\":\"authenticated\",\"sub\":\"$sub\"}',true)" -c "SET LOCAL ROLE authenticated" -c "$sql" -c "ROLLBACK" 2>&1 | sed 's/^psql:[^ ]* //' | grep -Ev '^(CONTEXT|LOCATION):'
  done; }
[ "$(P -tA -c "$MDQ")" = "$MD_LIVE" ] && ok "F2-live fixture = corpurile live (4 md5 canonice)" || bad "F2-live" "$(P -tA -c "$MDQ")"
# r4 control: cu a 4-a funcție LIVE (nelegată), authenticator→authenticated + claims service_role schimbă department (gaura r4)
P -c "ALTER TABLE profiles DISABLE TRIGGER USER; ALTER TABLE profiles ENABLE TRIGGER trg_profiles_campuri_owner_only;" >/dev/null
o=$(Q authenticator -tA -c "BEGIN" -c "SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)" -c "SET LOCAL ROLE authenticated" -c "UPDATE profiles SET department='x' WHERE id='$U2' RETURNING 'UPD'" -c "ROLLBACK" 2>&1)
echo "$o" | grep -q "^UPD$" && ok "F2-r4-control corp live c06d7ce0…: authenticated + claims service_role ⇒ department TRECE (gaura reprodusă)" || bad "F2-r4-control" "$o"
P -c "ALTER TABLE profiles ENABLE TRIGGER USER;" >/dev/null
suite7 > "$D/s7_live.txt"
# 0e (r4–r6): INVARIANT DE CATALOG — funcții expuse (public/graphql_public, EXECUTE pentru anon/authenticated; INVOKER ȘI DEFINER)
# care pot scrie GUC-urile de identitate sau au EXECUTE nerevizuit ⇒ F2 refuză. Fiecare gadget e creat ÎNAINTE de apply (crearea
# e verificată — eșecul ei e FAIL, nu trecere tăcută), apoi șters.
# g0e <caz> <funcție> <SQL creare> [<motiv așteptat în mesaj>]
g0e() { local caz=$1 fn=$2 sql=$3 motiv=${4:-}
  if ! P -c "$sql" >/dev/null 2>"$D/g0e.err"; then bad "F2-0e $caz" "crearea gadgetului a eșuat: $(cat "$D/g0e.err")"; return; fi
  [ -n "$(P -tA -c "SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('$fn')")" ] || { bad "F2-0e $caz" "gadgetul $fn nu există după CREATE"; return; }
  o=$(run "$F2")
  if echo "$o" | grep -q "Precondiție 0e" && echo "$o" | grep -qF "${fn#public.} [" && { [ -z "$motiv" ] || echo "$o" | grep -qF "$motiv"; }; then
    ok "F2-0e $caz ⇒ refuz ($fn${motiv:+, motiv $motiv})"; else bad "F2-0e $caz" "$o"; fi
  P -c "DROP FUNCTION $fn" >/dev/null || bad "F2-0e $caz" "DROP a eșuat"; }
[ -z "$(P -tA -c "SELECT proname FROM pg_proc WHERE proname IN ('prevent_role_escalation','enforce_owner_only_salary_flags','protect_can_access_pontaj_brut','fn_profiles_campuri_owner_only') AND (has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE'))")" ] \
  && ok "F2-0e-pre cele 4 funcții trigger NU sunt executabile de anon/authenticated (nu intră în scanare)" || bad "F2-0e-pre" "funcții trigger expuse"
# r6 — Copilot: falsificarea identității fără SET ROLE (triggerele au încredere în sub din GUC-urile JWT)
g0e "A INVOKER + clauza SET \"request.jwt.claim.sub\"=owner + UPDATE employee_id" "public.g_a_sub()" \
  "CREATE FUNCTION public.g_a_sub() RETURNS void LANGUAGE sql SET \"request.jwt.claim.sub\" TO '$U1' AS \$f\$ UPDATE public.profiles SET employee_id = 1 WHERE id = '$U2' \$f\$" proconfig
g0e "B INVOKER + clauza SET \"request.jwt.claims\"={authenticated, sub owner} + UPDATE department" "public.g_b_claims()" \
  "CREATE FUNCTION public.g_b_claims() RETURNS void LANGUAGE sql SET \"request.jwt.claims\" TO '{\"role\":\"authenticated\",\"sub\":\"$U1\"}' AS \$f\$ UPDATE public.profiles SET department = 'x' WHERE id = '$U2' \$f\$" proconfig
g0e "C DEFINER expus + set_config('request.jwt.claims', sub owner) + UPDATE" "public.g_c_definer()" \
  "CREATE FUNCTION public.g_c_definer() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ BEGIN PERFORM set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"sub\":\"$U1\"}', true); UPDATE public.profiles SET employee_id = 2 WHERE id = '$U2'; END \$f\$" set_config
# r6 — Jakarinos: ocolirile regexului r5 (+ variante găsite la implementare)
g0e "D SET LOCAL \"role\" (ghilimele)"               "public.g_d_quoted()" \
  "CREATE FUNCTION public.g_d_quoted() RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN SET LOCAL \"role\" = 'service_role'; END \$f\$" "set/reset role"
g0e "E SET/*c*/LOCAL ROLE (comentariu între cuvinte)" "public.g_e_comment()" \
  "CREATE FUNCTION public.g_e_comment() RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN SET/*c*/LOCAL ROLE service_role; END \$f\$" "set/reset role"
g0e "E2 desincronizare: '/*' în șir + SET /*;*/ LOCAL ROLE" "public.g_e2_desync()" \
  "CREATE FUNCTION public.g_e2_desync() RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN PERFORM '/*'; SET /*;*/ LOCAL ROLE service_role; END \$f\$" "set/reset role"
g0e "E3 SET LOCAL request /*x*/ . jwt.claims (comentariu între componentele numelui)" "public.g_e3_dots()" \
  "CREATE FUNCTION public.g_e3_dots() RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN SET LOCAL request /* x */ . jwt.claims = '{}'; END \$f\$" "request.jwt"
g0e "E4 SET LOCAL U&\"rol\\0065\" (identificator unicode)" "public.g_e4_uni()" \
  "CREATE FUNCTION public.g_e4_uni() RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN SET LOCAL U&\"rol\\0065\" = 'service_role'; END \$f\$" "u&"
g0e "E5 comentariu imbricat"                         "public.g_e5_nested()" \
  "CREATE FUNCTION public.g_e5_nested() RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN RETURN; /* a /* b */ c */ END \$f\$" "comentariu imbricat"
g0e "F DEFINER cu EXECUTE nelistat"                  "public.g_f_defexec(text)" \
  "CREATE FUNCTION public.g_f_defexec(q text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ BEGIN EXECUTE q; END \$f\$" execute
# din r5 (rămân)
g0e "plpgsql set_config('role')"                    "public.gadget_x()" \
  "CREATE FUNCTION public.gadget_x() RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN PERFORM set_config('role','service_role',true); END \$f\$" set_config
g0e "SQL-standard BEGIN ATOMIC set_config('role') (prosrc gol)" "public.gadget_atomic()" \
  "CREATE FUNCTION public.gadget_atomic() RETURNS text LANGUAGE sql BEGIN ATOMIC SELECT set_config('role','service_role',true); END" set_config
g0e "SQL-standard BEGIN ATOMIC set_config(claims)"  "public.gadget_atomic_claims()" \
  "CREATE FUNCTION public.gadget_atomic_claims() RETURNS text LANGUAGE sql BEGIN ATOMIC SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true); END" set_config
g0e "plpgsql SET SESSION ROLE"                      "public.gadget_session()" \
  "CREATE FUNCTION public.gadget_session() RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN SET SESSION ROLE service_role; END \$f\$" "set/reset role"
g0e "plpgsql SET LOCAL ROLE"                        "public.gadget_local()" \
  "CREATE FUNCTION public.gadget_local() RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN SET LOCAL ROLE service_role; END \$f\$" "set/reset role"
g0e "plpgsql SET SESSION AUTHORIZATION"             "public.gadget_sessauth()" \
  "CREATE FUNCTION public.gadget_sessauth() RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN SET SESSION AUTHORIZATION DEFAULT; END \$f\$" session_authorization
g0e "INVOKER EXECUTE dinamic"                       "public.gadget_exec(text)" \
  "CREATE FUNCTION public.gadget_exec(q text) RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN EXECUTE q; END \$f\$" execute
g0e "clauză SET role în antet (proconfig)"          "public.gadget_cfg()" \
  "CREATE FUNCTION public.gadget_cfg() RETURNS int LANGUAGE sql SET role = 'service_role' AS 'SELECT 1'" proconfig
P -c "CREATE SCHEMA IF NOT EXISTS graphql_public; GRANT USAGE ON SCHEMA graphql_public TO anon, authenticated;" >/dev/null || bad "F2-0e graphql_public" "schema"
g0e "funcție în graphql_public (EXECUTE)"           "graphql_public.gadget_gql(text)" \
  "CREATE FUNCTION graphql_public.gadget_gql(q text) RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN EXECUTE q; END \$f\$" execute
g0e "fals-pozitiv intenționat: comentariu cu execute" "public.fp_comentariu()" \
  "CREATE FUNCTION public.fp_comentariu() RETURNS int LANGUAGE plpgsql AS \$f\$ BEGIN RETURN 1; /* nu face execute */ END \$f\$" execute
# r8 — interpretori SQL (Jakarinos r6): RPC care execută SQL primit ca argument fără niciun tipar interzis în propria definiție
g0e "I1 INVOKER query_to_xml(q) + UPDATE employee_id" "public.g_i_inv(text)" \
  "CREATE FUNCTION public.g_i_inv(q text) RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN PERFORM query_to_xml(q, false, false, ''); UPDATE public.profiles SET employee_id = 2 WHERE id = '$U2'; END \$f\$" "interpretor SQL"
g0e "I2 DEFINER query_to_xml(q) + UPDATE employee_id" "public.g_i_def(text)" \
  "CREATE FUNCTION public.g_i_def(q text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ BEGIN PERFORM query_to_xml(q, false, false, ''); UPDATE public.profiles SET employee_id = 2 WHERE id = '$U2'; END \$f\$" "interpretor SQL"
g0e "I3 BEGIN ATOMIC cursor_to_xml / query_to_xml(q)" "public.g_i_atomic(text)" \
  "CREATE FUNCTION public.g_i_atomic(q text) RETURNS xml LANGUAGE sql BEGIN ATOMIC SELECT query_to_xml(q, false, false, ''); END" "interpretor SQL"
g0e "I4 sql INVOKER ts_stat(q)" "public.g_i_tsstat(text)" \
  "CREATE FUNCTION public.g_i_tsstat(q text) RETURNS bigint LANGUAGE sql AS \$f\$ SELECT count(*) FROM ts_stat(q) \$f\$" "interpretor SQL"
# r8 — fals pozitiv RSVTI (#538): regula set/reset role se aplică pe CORP (nu pe antetul pg_get_functiondef) și doar la început de instrucțiune
# fn_poate_scrie_hr_autorizatii: definiția exactă din 20261003c_sec_rsvti_poarta_jurnal.sql (branch claude/erp-continuare-x4p5a7-sec-rsvti)
if P -c "CREATE OR REPLACE FUNCTION public.fn_poate_scrie_hr_autorizatii()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS \$fn\$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = auth.uid()
       AND (p.is_owner = true
            OR p.can_modify_employees = true
            OR p.role = 'superadmin'
            OR p.department = ANY (ARRAY['HR', 'Administrativ']))
  )
\$fn\$;
REVOKE ALL ON FUNCTION public.fn_poate_scrie_hr_autorizatii() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_poate_scrie_hr_autorizatii() TO authenticated;
CREATE FUNCTION public.neg_upd_role(p_id uuid, p_rol text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$
BEGIN IF p_rol IS NOT NULL THEN UPDATE public.profiles SET role = p_rol WHERE id = p_id; END IF; END \$f\$;
CREATE FUNCTION public.neg_upd_role_sql(p_id uuid) RETURNS void LANGUAGE sql SET search_path = public, pg_temp AS \$f\$
UPDATE public.profiles SET role = 'x' WHERE id = p_id; UPDATE public.profiles SET
  role = 'y' WHERE id = p_id \$f\$;
CREATE FUNCTION public.neg_where_role() RETURNS bigint LANGUAGE sql STABLE SET search_path = public, pg_temp AS \$f\$ SELECT count(*) FROM public.profiles p WHERE p.role = 'x' \$f\$;
CREATE FUNCTION public.neg_atomic_role(p_id uuid) RETURNS void LANGUAGE sql BEGIN ATOMIC UPDATE public.profiles SET role = 'x' WHERE id = p_id; END;" >/dev/null; then
  n=$(P -tA -c "SELECT count(*) FROM pg_proc WHERE has_function_privilege('authenticated', oid, 'EXECUTE') AND oid IN (to_regprocedure('public.fn_poate_scrie_hr_autorizatii()'), to_regprocedure('public.neg_upd_role(uuid,text)'), to_regprocedure('public.neg_upd_role_sql(uuid)'), to_regprocedure('public.neg_where_role()'), to_regprocedure('public.neg_atomic_role(uuid)'))")
  [ "$n" = 5 ] || bad "F2-0e-neg-r8" "expuse: $n/5"
  # control: vechea regulă (r6, pe pg_get_functiondef) chiar prindea funcția RSVTI
  c=$(P -tA -c "SELECT lower(pg_get_functiondef('public.fn_poate_scrie_hr_autorizatii()'::regprocedure)) ~ '\m(set|reset)\M[^;]*\mrole\M'")
  [ "$c" = t ] && ok "F2-0e-control-r8 regula r6 (antet + corp) prindea fn_poate_scrie_hr_autorizatii (fals pozitiv reprodus)" || bad "F2-0e-control-r8" "c=$c"
  o=$(P -tA -f "$ROOT/scripts/control_0e.sql" 2>&1); [ $? = 0 ] && [ -z "$o" ] && ok "F2-0e-neg-r8 control_0e.sql cu RSVTI + UPDATE … SET role (plpgsql/sql/BEGIN ATOMIC) + WHERE p.role ⇒ 0 rânduri" || bad "F2-0e-neg-r8 control" "$o"
  o=$(run "$F2"); [ $? = 0 ] && ok "F2-0e-neg-r8 F2 se aplică peste fn_poate_scrie_hr_autorizatii (RSVTI #538) + UPDATE … SET role + WHERE p.role" || bad "F2-0e-neg-r8" "$o"
  o=$(run "$RB0"); [ $? = 0 ] && [ "$(P -tA -c "$MDQ")" = "$MD_LIVE" ] || bad "F2-0e-neg-r8-rb" "$o"
  P -c "DROP FUNCTION public.neg_upd_role(uuid,text), public.neg_upd_role_sql(uuid), public.neg_where_role(), public.neg_atomic_role(uuid)" >/dev/null || bad "F2-0e-neg-r8" "DROP"
  # RSVTI rămâne pentru ultima verificare (interogarea finală pe o bază cu funcția RSVTI ⇒ 0 rânduri, după apply)
else bad "F2-0e-neg-r8" "crearea fixture-urilor negative r8 a eșuat"; fi
# o funcție trigger F2 devenită executabilă de authenticated ⇒ intră în scanare (corpul live c06d7ce0… citește request.jwt) ⇒ refuz
if P -c "GRANT EXECUTE ON FUNCTION public.fn_profiles_campuri_owner_only() TO authenticated" >/dev/null; then
  o=$(run "$F2"); echo "$o" | grep -q "Precondiție 0e" && echo "$o" | grep -qF "fn_profiles_campuri_owner_only() [" && ok "F2-0e funcție trigger F2 expusă (GRANT authenticated) ⇒ refuz" || bad "F2-0e trigger expus" "$o"
  P -c "REVOKE EXECUTE ON FUNCTION public.fn_profiles_campuri_owner_only() FROM authenticated" >/dev/null || bad "F2-0e trigger expus" "REVOKE a eșuat"
else bad "F2-0e trigger expus" "GRANT a eșuat"; fi
# G — lista revizuită (DEFINER cu EXECUTE, legat de md5(prosrc)). Corpul live al lui fn_completare_aplica NU e în repo, deci se
# folosește un substitut cu aceeași semnătură: (G1) migrarea reală, md5 substitut ≠ 47a75428… ⇒ refuz (md5 „alterat”);
# (G2) o COPIE a migrării cu md5-ul din listă înlocuit cu md5-ul substitutului ⇒ NU blochează (mecanismul listei, md5 exact);
# (G3) copia + corp modificat ⇒ refuz; (G4) copia + același corp dar INVOKER ⇒ refuz (lista e doar pentru DEFINER).
GSQL="CREATE FUNCTION public.fn_completare_aplica(p_id bigint, p_aplica boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ BEGIN IF p_aplica THEN EXECUTE format('UPDATE public.profiles SET %I = \$1 WHERE employee_id = \$2', 'department') USING 'x', p_id; END IF; END \$f\$"
if P -c "$GSQL" >/dev/null; then
  gm=$(P -tA -c "SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.fn_completare_aplica(bigint,boolean)')")
  o=$(run "$F2"); echo "$o" | grep -q "Precondiție 0e" && echo "$o" | grep -qF "fn_completare_aplica(bigint,boolean) [execute]" && ok "F2-0e G1 fn_completare_aplica cu md5 ≠ lista ($gm) ⇒ refuz" || bad "F2-0e G1" "$o"
  sed "s/47a7542895c0ce71cb0e44d2c26d0609/$gm/" "$F2" > "$D/f2_lista.sql"
  [ "$(grep -c "$gm" "$D/f2_lista.sql")" = 2 ] || bad "F2-0e G2" "substituția md5 în copie nu e exact 2 (pre + post 0e)"
  o=$(run "$D/f2_lista.sql" 20260930j_sec_f2_profiles_uid_null); r=$?
  [ $r = 0 ] && [ "$(P -tA -c "$MDQ")" = "$MD_PATCH" ] && ok "F2-0e G2 fn_completare_aplica DEFINER cu md5 exact din listă ⇒ NU blochează (aplicat)" || bad "F2-0e G2" "$o"
  o=$(run "$RB0"); [ $? = 0 ] && [ "$(P -tA -c "$MDQ")" = "$MD_LIVE" ] || bad "F2-0e G2-rb" "$o"
  P -c "CREATE OR REPLACE FUNCTION public.fn_completare_aplica(p_id bigint, p_aplica boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ BEGIN EXECUTE 'select 1'; END \$f\$" >/dev/null || bad "F2-0e G3" "CREATE"
  o=$(run "$D/f2_lista.sql" 20260930j_sec_f2_profiles_uid_null); echo "$o" | grep -qF "fn_completare_aplica(bigint,boolean) [execute]" && ok "F2-0e G3 listă + corp modificat (md5 alterat) ⇒ refuz" || bad "F2-0e G3" "$o"
  P -c "DROP FUNCTION public.fn_completare_aplica(bigint,boolean); ${GSQL/SECURITY DEFINER/SECURITY INVOKER}" >/dev/null || bad "F2-0e G4" "CREATE"
  [ "$(P -tA -c "SELECT md5(prosrc)||prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.fn_completare_aplica(bigint,boolean)')")" = "${gm}false" ] || bad "F2-0e G4" "substitutul INVOKER nu are același md5"
  o=$(run "$D/f2_lista.sql" 20260930j_sec_f2_profiles_uid_null); echo "$o" | grep -qF "fn_completare_aplica(bigint,boolean) [execute]" && ok "F2-0e G4 listă + md5 exact dar INVOKER ⇒ refuz" || bad "F2-0e G4" "$o"
  P -c "DROP FUNCTION public.fn_completare_aplica(bigint,boolean)" >/dev/null
else bad "F2-0e G" "crearea substitutului a eșuat"; fi
# control: vechea interogare r4 (doar prosrc) NU vede corpul BEGIN ATOMIC — motivul r5
if P -c "CREATE FUNCTION public.gadget_atomic() RETURNS text LANGUAGE sql BEGIN ATOMIC SELECT set_config('role','service_role',true); END" >/dev/null; then
  n=$(P -tA -c "SELECT count(*) FROM pg_proc p WHERE p.oid='public.gadget_atomic()'::regprocedure AND (p.prosrc ~* '\mexecute\M' OR p.prosrc ~* 'set_config' OR p.prosrc ~* 'set\s+(local\s+)?role')")
  [ "$n" = 0 ] && ok "F2-0e-control interogarea r4 (prosrc) ratează BEGIN ATOMIC (0 potriviri) — r5+ o prinde" || bad "F2-0e-control" "n=$n"
  P -c "DROP FUNCTION public.gadget_atomic()" >/dev/null
else bad "F2-0e-control" "CREATE"; fi
# negative: NU sunt gadgeturi ⇒ F2 se aplică (DEFINER fără tipare; EXECUTE revocat de la PUBLIC; schemă neexpusă; agregat; window)
if P -c "CREATE FUNCTION public.neg_secdef() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ BEGIN RETURN (SELECT count(*) FROM public.profiles WHERE is_owner); END \$f\$;
      CREATE FUNCTION public.neg_revocat() RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN EXECUTE 'select 1'; PERFORM set_config('request.jwt.claims','{}',true); END \$f\$; REVOKE EXECUTE ON FUNCTION public.neg_revocat() FROM PUBLIC;
      CREATE SCHEMA neexpusa; CREATE FUNCTION neexpusa.neg_schema() RETURNS void LANGUAGE plpgsql AS \$f\$ BEGIN SET LOCAL ROLE service_role; END \$f\$;
      CREATE AGGREGATE public.neg_agg(int) (sfunc = int4pl, stype = int);
      CREATE FUNCTION public.neg_window() RETURNS bigint LANGUAGE internal WINDOW AS 'window_row_number';" >/dev/null \
   && [ "$(P -tA -c "SELECT count(*) FROM pg_proc WHERE oid IN (to_regprocedure('public.neg_secdef()'), to_regprocedure('public.neg_revocat()'), to_regprocedure('neexpusa.neg_schema()'), to_regprocedure('public.neg_agg(int)'), to_regprocedure('public.neg_window()'))")" = 5 ]; then
  o=$(run "$F2"); [ $? = 0 ] && ok "F2-0e-neg DEFINER fără tipare / EXECUTE revocat / schemă neexpusă / agregat / window ⇒ nu blochează (aplicat)" || bad "F2-0e-neg" "$o"
  P -c "DROP FUNCTION public.neg_secdef(), public.neg_revocat(), public.neg_window(); DROP SCHEMA neexpusa CASCADE; DROP AGGREGATE public.neg_agg(int);" >/dev/null 2>&1 || bad "F2-0e-neg" "DROP"
  o=$(run "$RB0"); [ $? = 0 ] && [ "$(P -tA -c "$MDQ")" = "$MD_LIVE" ] || bad "F2-0e-neg-rb" "$o"
else bad "F2-0e-neg" "crearea fixture-urilor negative a eșuat (5 așteptate)"; fi
# interogarea 0e: pre + postcondiția din migrare = SQL-ul de control din doc = scripts/control_0e.sql (normalizat linie cu linie)
python3 - "$F2" "$ROOT/docs/SEC_F1_F2_PATCH.md" "$ROOT/scripts/control_0e.sql" > "$D/q0e.sql" <<'PY'
import re,sys
def qs(p):
    return ["\n".join(l.strip() for l in m.split("\n")) for m in re.findall(r"(-- SEC F2 0e \(r8\).*?ORDER BY 1)[;\n]", open(p).read(), re.S)]
a,b,c=qs(sys.argv[1]),qs(sys.argv[2]),qs(sys.argv[3])
if len(a)!=2 or len(b)!=1 or len(c)!=1 or len(set(a+b+c))!=1: print("diferă/lipsesc: migrare %d, doc %d, control %d, distincte %d"%(len(a),len(b),len(c),len(set(a+b+c)))); sys.exit(1)
print(b[0])
PY
[ $? = 0 ] && ok "F2-0e-doc precondiția 0e = postcondiția 0e = SQL-ul de control din doc = scripts/control_0e.sql" || bad "F2-0e-doc" "$(cat "$D/q0e.sql")"
# control_0e.sql rulează read-only (fără gadgeturi ⇒ 0 rânduri)
o=$(P -tA -c "SET default_transaction_read_only = on" -f "$ROOT/scripts/control_0e.sql" 2>&1); [ $? = 0 ] && [ -z "$o" ] && ok "F2-0e-control scripts/control_0e.sql read-only ⇒ 0 rânduri" || bad "F2-0e-control" "$o"
# arhiva excepției whitelist: md5 al corpului dintre $function$ = cel din listă
am=$(python3 -c 'import re,sys,hashlib;print(hashlib.md5(re.search(r"AS \$function\$(.*?)\$function\$",open(sys.argv[1]).read(),re.S).group(1).encode()).hexdigest())' "$ROOT/docs/sec_f2_whitelist/fn_completare_aplica_47a75428.sql")
[ "$am" = 47a7542895c0ce71cb0e44d2c26d0609 ] && grep -qF "'47a7542895c0ce71cb0e44d2c26d0609'" "$F2" && ok "F2-0e-arhivă md5 corp fn_completare_aplica arhivat = $am = lista din migrare" || bad "F2-0e-arhivă" "md5=$am"
# r7 — cursa precondiție→COMMIT: gadget creat „concurent” după pasul 1 (simulat în aceeași tranzacție, înaintea postcondiției 0e)
python3 - "$F2" > "$D/f2_cursa.sql" <<'PY'
import sys;s=open(sys.argv[1]).read();k="DO $post0e$"
assert s.count(k)==1
print(s.replace(k,"CREATE FUNCTION public.g_cursa() RETURNS void LANGUAGE sql SET \"request.jwt.claim.sub\" TO 'x' AS 'SELECT 1';\n"+k))
PY
if [ $? = 0 ]; then
  o=$(run "$D/f2_cursa.sql" 20260930j_sec_f2_profiles_uid_null)
  if echo "$o" | grep -q "Postcondiție 0e" && echo "$o" | grep -qF "g_cursa() [" && [ "$(P -tA -c "$MDQ")" = "$MD_LIVE" ] && [ -z "$(P -tA -c "SELECT to_regprocedure('public.g_cursa()')")" ]; then
    ok "F2-0e-post gadget apărut după precondiție ⇒ postcondiția 0e refuză, totul anulat (md5 live, gadget inexistent)"; else bad "F2-0e-post" "$o"; fi
else bad "F2-0e-post" "construcția copiei a eșuat"; fi
python3 - "$F2" > "$D/f2_cursa_i.sql" <<'PY'
import sys;s=open(sys.argv[1]).read();k="DO $post0e$"
assert s.count(k)==1
print(s.replace(k,"CREATE FUNCTION public.g_cursa_i(q text) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN PERFORM query_to_xml(q, false, false, ''); UPDATE public.profiles SET employee_id = 2; END $f$;\n"+k))
PY
if [ $? = 0 ]; then
  o=$(run "$D/f2_cursa_i.sql" 20260930j_sec_f2_profiles_uid_null)
  if echo "$o" | grep -q "Postcondiție 0e" && echo "$o" | grep -qF "g_cursa_i(text) [interpretor SQL]" && [ "$(P -tA -c "$MDQ")" = "$MD_LIVE" ] && [ -z "$(P -tA -c "SELECT to_regprocedure('public.g_cursa_i(text)')")" ]; then
    ok "F2-0e-post-r8 interpretor (query_to_xml) apărut după precondiție ⇒ postcondiția 0e refuză, totul anulat"; else bad "F2-0e-post-r8" "$o"; fi
else bad "F2-0e-post-r8" "construcția copiei a eșuat"; fi
o=$(run "$F2"); [ $? = 0 ] && ok "F2-apply aplicare" || bad "F2-apply" "$o"
# r8: interogarea finală 0e pe o bază care conține funcția RSVTI (fn_poate_scrie_hr_autorizatii, EXECUTE authenticated) ⇒ 0 rânduri
o=$(P -tA -c "SET default_transaction_read_only = on" -f "$ROOT/scripts/control_0e.sql" 2>&1)
[ $? = 0 ] && [ -z "$o" ] && [ "$(P -tA -c "SELECT has_function_privilege('authenticated', to_regprocedure('public.fn_poate_scrie_hr_autorizatii()'), 'EXECUTE')")" = t ] \
  && ok "F2-0e-final-r8 control_0e.sql după apply, cu RSVTI expusă ⇒ 0 rânduri" || bad "F2-0e-final-r8" "$o"

md=$(P -tA -c "$MDQ")
echo "INFO md5 după F2: $md"
[ "$md" = "$MD_PATCH" ] && ok "F2-md5 cele 4 funcții = variantele patch" || bad "F2-md5" "$md"
suite7 > "$D/s7_patch.txt"
if diff "$D/s7_live.txt" "$D/s7_patch.txt" >/dev/null; then ok "F2-7 utilizatori reali (sub): comportament IDENTIC live vs patch ($(grep -c '^##' "$D/s7_live.txt") scenarii)"; else bad "F2-7" "$(diff "$D/s7_live.txt" "$D/s7_patch.txt")"; fi
grep -q "Doar owners pot schimba rolul" "$D/s7_patch.txt" && grep -q "^sef|t$" "$D/s7_patch.txt" && grep -q "^f|f$" "$D/s7_patch.txt" && grep -q "^t|t$" "$D/s7_patch.txt" \
  && ok "F2-7b non-owner refuzat/resetat, owner poate (rol, is_owner, can_*)" || bad "F2-7b" "$(cat "$D/s7_patch.txt")"

# Matricea de discriminare pe fiecare funcție în parte: doar triggerul ei activ (mesajul de eroare poartă numele funcției)
# x <caz> <așteptat: ok|42501|22P02> <utilizator conexiune> <SQL înainte de UPDATE, separat prin ;;>
x() { local caz=$1 exp=$2 u=$3 pre=$4 args=() IFS=$'\n'
  for s in $(echo "$pre" | sed 's/;;/\n/g'); do args+=(-c "$s"); done
  o=$(Q "$u" -tA -c "BEGIN" "${args[@]}" -c "UPDATE profiles SET ${SETX//@R@/$RANDOM} WHERE id='$U2' RETURNING 'UPD'" -c "ROLLBACK" 2>&1)
  case $exp in
    ok)    echo "$o" | grep -q "^UPD$" && ! echo "$o" | grep -q ERROR && ok "$FN $caz ⇒ trece" || bad "$FN $caz" "așteptat trece: $o" ;;
    42501) echo "$o" | grep -q "ERROR:  42501" && echo "$o" | grep -q "$MSG" && ok "$FN $caz ⇒ 42501" || bad "$FN $caz" "așteptat 42501 din $FN: $o" ;;
    *)     echo "$o" | grep -q "ERROR:  $exp" && ok "$FN $caz ⇒ $exp" || bad "$FN $caz" "așteptat $exp: $o" ;;
  esac; }
C="SELECT set_config('request.jwt.claims','"; E="',true)"
R="SELECT set_config('request.jwt.claim.role','"
for SPEC in "prevent_role_escalation|role='x_@R@'|" "enforce_owner_only_salary_flags|role='x_@R@'|" "protect_can_access_pontaj_brut|role='x_@R@'|" \
            "fn_profiles_campuri_owner_only|department='d_@R@'|Doar owner-ul poate modifica department" \
            "fn_profiles_campuri_owner_only|employee_id=@R@|Doar owner-ul poate modifica employee_id"; do
  FN=${SPEC%%|*}; r_=${SPEC#*|}; SETX=${r_%%|*}; MSG=${r_#*|}; MSG=${MSG:-$FN}
  TG=$(P -tA -c "SELECT tgname FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE tgrelid='profiles'::regclass AND proname='$FN'")
  P -c "ALTER TABLE profiles DISABLE TRIGGER USER; ALTER TABLE profiles ENABLE TRIGGER $TG;"
  x "1a  postgres→SET ROLE authenticated + claim.role=service_role, fără sub"  42501 postgres  "SET LOCAL ROLE authenticated;;$R""service_role$E"
  x "1b  rol SQL atacator (UPDATE pe profiles) + claim.role=service_role"       42501 atacator  "$R""service_role$E"
  x "1c  atacator + claims {role:service_role}"                                 42501 atacator  "$C{\"role\":\"service_role\"}$E"
  x "2   authenticator→anon + claims {role:anon}, fără sub"                     42501 authenticator "$C{\"role\":\"anon\"}$E;;SET LOCAL ROLE anon"
  x "3   authenticator→authenticated + claims {role:authenticated}, fără sub"   42501 authenticator "$C{\"role\":\"authenticated\"}$E;;SET LOCAL ROLE authenticated"
  x "4a  authenticator fără claims (fără SET ROLE)"                             42501 authenticator ""
  x "4b  authenticator→service_role fără claims"                                42501 authenticator "SET LOCAL ROLE service_role"
  x "5a  PostgREST simulat: authenticator→service_role + claims {role:service_role}" ok authenticator "$C{\"role\":\"service_role\"}$E;;SET LOCAL ROLE service_role"
  x "5b  authenticator→service_role + claim.role=service_role"                  ok authenticator "$R""service_role$E;;SET LOCAL ROLE service_role"
  x "5c  authenticator→service_role + ambele surse = service_role"              ok authenticator "$R""service_role$E;;$C{\"role\":\"service_role\"}$E;;SET LOCAL ROLE service_role"
  x "6a  postgres direct, fără claims"                                           ok postgres ""
  x "6b  supabase_admin direct, fără claims"                                     ok supabase_admin ""
  x "6c  postgres direct + claims {role:anon} (claim prezent ⇒ nu e ramura b)"   42501 postgres "$C{\"role\":\"anon\"}$E"
  x "6d  postgres direct + claims {role:service_role} (nu e authenticator)"     42501 postgres "$C{\"role\":\"service_role\"}$E"
  x "8a  contradictoriu: claims.role=anon, claim.role=service_role (authenticator→service_role)" 42501 authenticator "$C{\"role\":\"anon\"}$E;;$R""service_role$E;;SET LOCAL ROLE service_role"
  x "8b  contradictoriu: claims.role=service_role, claim.role=anon"            42501 authenticator "$C{\"role\":\"service_role\"}$E;;$R""anon$E;;SET LOCAL ROLE service_role"
  x "8c  contradictoriu ca postgres direct"                                     42501 postgres "$C{\"role\":\"anon\"}$E;;$R""service_role$E"
  x "9a  claims JSON invalid + claim.role=service_role (auth.uid() cade întâi)"  22P02 authenticator "$C{rupt$E;;$R""service_role$E;;SET LOCAL ROLE service_role"
  x "9b  claims golite ('') + claim.role gol, sesiune postgres→authenticated (ramura b: session_user postgres)" ok postgres "SET LOCAL ROLE authenticated;;$C$E;;$R$E"
  x "9c  claims golite ('') + claim.role gol, authenticator→authenticated"      42501 authenticator "$C$E;;$R$E;;SET LOCAL ROLE authenticated"
  x "9d  claims {role:''} + claim.role=service_role, authenticator→service_role (rol gol = absent)" ok authenticator "$C{\"role\":\"\"}$E;;$R""service_role$E;;SET LOCAL ROLE service_role"
  # r3: legarea de rolul SQL efectiv (current_setting('role')) pe ramura (a)
  x "10a authenticator + SET ROLE service_role + claims/claim.role service_role" ok authenticator "$C{\"role\":\"service_role\"}$E;;$R""service_role$E;;SET LOCAL ROLE service_role"
  x "10b authenticator + SET ROLE authenticated + claims/claim.role service_role" 42501 authenticator "$C{\"role\":\"service_role\"}$E;;$R""service_role$E;;SET LOCAL ROLE authenticated"
  x "10c authenticator fără SET ROLE + claims/claim.role service_role"          42501 authenticator "$C{\"role\":\"service_role\"}$E;;$R""service_role$E"
  x "10d authenticator + SET ROLE anon + claims service_role"                   42501 authenticator "$C{\"role\":\"service_role\"}$E;;SET LOCAL ROLE anon"
  if [ "$FN" = fn_profiles_campuri_owner_only ]; then   # r4: câmpurile S-A — utilizatori reali și anon
    x "11a [$SETX] owner real (authenticated, sub owner)"                       ok authenticator "$C{\"role\":\"authenticated\",\"sub\":\"$U1\"}$E;;SET LOCAL ROLE authenticated"
    x "11b [$SETX] non-owner real (authenticated, sub non-owner)"               42501 authenticator "$C{\"role\":\"authenticated\",\"sub\":\"$U2\"}$E;;SET LOCAL ROLE authenticated"
    x "11c [$SETX] anon (authenticator→anon + claims anon)"                     42501 authenticator "$C{\"role\":\"anon\"}$E;;SET LOCAL ROLE anon"
    x "11d [$SETX] authenticated + claims service_role + claim.role service_role, cu sub non-owner" 42501 authenticator "$C{\"role\":\"service_role\",\"sub\":\"$U2\"}$E;;$R""service_role$E;;SET LOCAL ROLE authenticated"
  fi
  P -c "ALTER TABLE profiles ENABLE TRIGGER USER;"
done
# Reaplicare + rollback + reaplicare (toate 4 funcțiile)
o=$(run "$F2"); [ $? = 0 ] && [ "$(P -tA -c "$MDQ")" = "$MD_PATCH" ] && ok "F2-reapply reaplicare idempotentă (md5 patch)" || bad "F2-reapply" "$o"
RB=$M/20260930j_sec_f2_profiles_uid_null_ROLLBACK.sql
o=$(run "$RB"); [ $? = 0 ] && [ "$(P -tA -c "$MDQ")" = "$MD_LIVE" ] && ok "F2-rollback readuce corpurile live (4 md5, inclusiv c06d7ce0…)" || bad "F2-rollback" "$o $(P -tA -c "$MDQ")"
suite7 > "$D/s7_rb.txt"; diff -q "$D/s7_live.txt" "$D/s7_rb.txt" >/dev/null && ok "F2-rollback comportament utilizatori reali = live" || bad "F2-rollback-7" "$(diff "$D/s7_live.txt" "$D/s7_rb.txt")"
o=$(run "$RB"); [ $? = 0 ] && ok "F2-rollback reaplicat (idempotent)" || bad "F2-rollback-2" "$o"
o=$(run "$F2"); [ $? = 0 ] && [ "$(P -tA -c "$MDQ")" = "$MD_PATCH" ] && ok "F2-reapply după rollback" || bad "F2-reapply-2" "$o"
# Precondiția refuză un corp modificat al celei de-a 4-a
P -c "BEGIN; CREATE OR REPLACE FUNCTION public.fn_profiles_campuri_owner_only() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS \$f\$ BEGIN RETURN NEW; END \$f\$; COMMIT;" >/dev/null
o=$(run "$F2"); echo "$o" | grep -q "Precondiție 0b: doar 3 din 4" && ok "F2-pre4 corp modificat al celei de-a 4-a ⇒ refuz" || bad "F2-pre4" "$o"
o=$(run "$RB"); echo "$o" | grep -q "Precondiție 0b: doar 3 din 4" && ok "F2-rb-pre4 rollback peste corp neanalizat ⇒ refuz" || bad "F2-rb-pre4" "$o"
# Precondiția F2 refuză un corp live modificat; md5 pre-check-urile rămân pe corpurile live
P -c "BEGIN; CREATE OR REPLACE FUNCTION public.protect_can_access_pontaj_brut() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS \$f\$ BEGIN RETURN NEW; END \$f\$; COMMIT;" >/dev/null
o=$(run "$F2"); echo "$o" | grep -q "Precondiție 0b" && ok "F2-pre corp modificat ⇒ refuz" || bad "F2-pre" "$o"
echo "=== TOTAL: $NFAIL eșecuri ==="
[ $NFAIL = 0 ]
