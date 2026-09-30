#!/usr/bin/env bash
# ============================================================================
# Test OPȚIONAL end-to-end cu un PostgREST REAL — SEC F2 (20260930j_sec_f2_profiles_uid_null), runda 3.
#
# EXCLUSIV local: cluster PostgreSQL 17 creat de script (initdb în director temporar, doar socket unix) + binarul PostgREST
# (POSTGREST=/cale/postgrest, ex. release-ul oficial postgrest-v13.0.4-linux-static-x86-64) ascultând DOAR pe 127.0.0.1.
# Nu citește .env, nu folosește chei Supabase (jwt-secret generat aleator), nu atinge producția. Refuză PGHOST nelocal.
#
# 1. Sonda: ce valori vede efectiv o funcție apelată prin PostgREST (session_user, current_user, role, claim.role, claims,
#    auth.uid()) pentru JWT anon / authenticated cu sub / service_role fără sub — în SECURITY INVOKER și SECURITY DEFINER.
# 2. F2 aplicat (ca runnerul): PATCH pe profiles cu service_role ⇒ permis; authenticated non-owner pe câmp protejat ⇒ refuz;
#    RPC care își pune singur claim-urile service_role (set_config) apoi UPDATE ca authenticated ⇒ 42501.
# Utilizare: POSTGREST=/cale/postgrest bash scripts/test_sec_f2_postgrest.sh   (F2_FILE=<alt fișier F2> opțional)
# Ieșire: 0 toate trec, 1 eșecuri, 2 mediu, 3 PostgREST lipsă (SKIP).
# ============================================================================
set -u
case "${PGHOST:-}" in
  ""|localhost|127.0.0.1|::1|/*) ;;
  *) echo "REFUZ: PGHOST=$PGHOST nu e local"; exit 2 ;;
esac
unset PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGPASSWORD PGSERVICE PGSERVICEFILE PGPASSFILE DATABASE_URL PGRST_DB_URI
PGRST=${POSTGREST:-$(command -v postgrest || true)}
[ -x "$PGRST" ] || { echo "SKIP: binarul PostgREST lipsește (setează POSTGREST=/cale/postgrest)"; exit 3; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
M=$ROOT/supabase/migrations; T=$ROOT/supabase/tests
F2=${F2_FILE:-$M/20260930j_sec_f2_profiles_uid_null.sql}
PGB=${PGBIN:-/usr/lib/postgresql/17/bin}; PORT=${PORT:-5498}; HPORT=${HTTP_PORT:-3998}
D=$(mktemp -d "${TMPDIR:-/tmp}/sec_f2_pgrst.XXXXXX"); chmod 777 "$D"
AS=""; if [ "$(id -u)" = 0 ]; then AS="su nobody -s /bin/bash -c"; chown nobody "$D"; fi
pgctl() { if [ -n "$AS" ]; then $AS "$*"; else bash -c "$*"; fi; }
pgctl "$PGB/initdb -D $D/data -U postgres -A trust >/dev/null && $PGB/pg_ctl -D $D/data -o '-k $D -p $PORT -c listen_addresses=' -l $D/log start >/dev/null" || { echo "initdb/pg_ctl a eșuat"; exit 2; }
PID=""
trap '[ -n "$PID" ] && kill $PID 2>/dev/null; pgctl "$PGB/pg_ctl -D $D/data stop -m fast >/dev/null"; rm -rf "$D"' EXIT
P() { "$PGB/psql" -X -q -v ON_ERROR_STOP=1 -h "$D" -p "$PORT" -U postgres postgres "$@"; }
NFAIL=0; ok() { echo "PASS $1"; }; bad() { echo "FAIL $1 — $2"; NFAIL=$((NFAIL+1)); }

# --- fixture comună cu harness-ul SQL + corpurile live + triggere; authenticator NOINHERIT (ca în Supabase)
P -f "$T/sec_f1_f2_fixture.sql" >/dev/null || exit 2
python3 - "$M/20260930j_sec_f2_profiles_uid_null_ROLLBACK.sql" > "$D/live_fns.sql" <<'PY'
import re,sys
print("\n".join(re.findall(r"(CREATE OR REPLACE FUNCTION public\.\w+\(\).*?\$function\$;)", open(sys.argv[1]).read(), re.S)))
PY
P -f "$D/live_fns.sql" >/dev/null && P -f "$T/sec_f1_f2_fixture_triggers.sql" >/dev/null || exit 2
P <<'SQL' >/dev/null || exit 2
ALTER ROLE authenticator NOINHERIT;
CREATE FUNCTION public.sonda() RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
  SELECT jsonb_build_object('session_user', session_user::text, 'current_user', current_user::text,
    'role', current_setting('role', true), 'claim_role', current_setting('request.jwt.claim.role', true),
    'claim_sub', current_setting('request.jwt.claim.sub', true), 'claims', current_setting('request.jwt.claims', true),
    'uid', auth.uid()) $$;
CREATE FUNCTION public.sonda_definer() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT public.sonda() $$;
CREATE FUNCTION public.sonda_definer_plpgsql() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN RETURN jsonb_build_object('session_user', session_user::text, 'current_user', current_user::text, 'role', current_setting('role', true)); END $$;
-- atacul: RPC SECURITY INVOKER care își pune singur rolul JWT service_role, apoi UPDATE pe profiles (JWT authenticated fără sub)
CREATE FUNCTION public.escaladare_claim() RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.profiles SET role = 'owner' WHERE id = '22222222-2222-2222-2222-222222222222'; RETURN 'UPD'; END $$;
CREATE FUNCTION public.escaladare_claims() RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.profiles SET role = 'owner' WHERE id = '22222222-2222-2222-2222-222222222222'; RETURN 'UPD'; END $$;
GRANT EXECUTE ON FUNCTION public.sonda(), public.sonda_definer(), public.sonda_definer_plpgsql(), public.escaladare_claim(), public.escaladare_claims() TO anon, authenticated, service_role;
SQL
# --- F2 aplicat ca runnerul (marcaj + fișier, o singură tranzacție)
{ echo "SELECT set_config('gazpet.livrare_migrare', '20260930j_sec_f2_profiles_uid_null:' || txid_current(), true);"; cat "$F2"; } > "$D/run.sql"
o=$(P --single-transaction -f "$D/run.sql" 2>&1) && ok "F2 aplicat ($(basename "$F2"))" || { bad "F2 apply" "$o"; exit 1; }

# --- PostgREST real
SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 48)
cat > "$D/pgrst.conf" <<CONF
db-uri = "postgres://authenticator@/postgres?host=$D&port=$PORT"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = $HPORT
log-level = "error"
CONF
"$PGRST" "$D/pgrst.conf" > "$D/pgrst.log" 2>&1 & PID=$!
for i in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$HPORT/" && break; sleep 0.2; done
curl -s -o /dev/null "http://127.0.0.1:$HPORT/" || { echo "PostgREST nu pornește: $(cat "$D/pgrst.log")"; exit 2; }
echo "INFO $("$PGRST" --version 2>&1 | head -1)"
jwt() { SECRET=$SECRET python3 -c '
import sys,os,json,hmac,hashlib,base64,time
b=lambda x: base64.urlsafe_b64encode(x).rstrip(b"=").decode()
p=json.loads(sys.argv[1]); p["exp"]=int(time.time())+600
h=b(json.dumps({"alg":"HS256","typ":"JWT"}).encode())+"."+b(json.dumps(p).encode())
print(h+"."+b(hmac.new(os.environ["SECRET"].encode(),h.encode(),hashlib.sha256).digest()))' "$1"; }
U1=11111111-1111-1111-1111-111111111111; U2=22222222-2222-2222-2222-222222222222
J_ANON=$(jwt '{"role":"anon"}'); J_AUTH=$(jwt "{\"role\":\"authenticated\",\"sub\":\"$U2\"}")
J_AUTH_NOSUB=$(jwt '{"role":"authenticated"}'); J_SR=$(jwt '{"role":"service_role"}')
H() { curl -s -H "Authorization: Bearer $1" -H 'Content-Type: application/json' "${@:2}"; }

echo "=== SONDA (valori observate prin PostgREST real) ==="
for pair in "anon:$J_ANON" "authenticated+sub:$J_AUTH" "service_role:$J_SR"; do
  n=${pair%%:*}; j=${pair#*:}
  for f in sonda sonda_definer sonda_definer_plpgsql; do echo "$n | $f | $(H "$j" -X POST "http://127.0.0.1:$HPORT/rpc/$f" -d '{}')"; done
done
# verificarea valorilor pe care se bazează ramura (a) a patch-ului
v=$(H "$J_SR" -X POST "http://127.0.0.1:$HPORT/rpc/sonda_definer_plpgsql" -d '{}')
echo "$v" | grep -q '"role": "service_role"' && echo "$v" | grep -q '"session_user": "authenticator"' && echo "$v" | grep -q '"current_user": "postgres"' \
  && ok "SONDA service_role în SECURITY DEFINER: session_user=authenticator, current_user=postgres, role=service_role" || bad "SONDA sr" "$v"
v=$(H "$J_AUTH" -X POST "http://127.0.0.1:$HPORT/rpc/sonda_definer_plpgsql" -d '{}')
echo "$v" | grep -q '"role": "authenticated"' && ok "SONDA authenticated în SECURITY DEFINER: role=authenticated" || bad "SONDA auth" "$v"

echo "=== PATCH / RPC pe profiles ==="
r=$(H "$J_SR" -X PATCH "http://127.0.0.1:$HPORT/profiles?id=eq.$U2" -H 'Prefer: return=representation' -d '{"role":"sef_sr"}')
echo "$r" | grep -q '"role":"sef_sr"' && ok "E2E-1 service_role JWT: PATCH role ⇒ permis" || bad "E2E-1" "$r"
r=$(H "$J_SR" -X PATCH "http://127.0.0.1:$HPORT/profiles?id=eq.$U2" -H 'Prefer: return=representation' -d '{"can_access_pontaj_brut":true,"can_access_salarii":true}')
echo "$r" | grep -q '"can_access_salarii":true' && echo "$r" | grep -q '"can_access_pontaj_brut":true' && ok "E2E-1b service_role JWT: PATCH can_* ⇒ permis (fără resetare)" || bad "E2E-1b" "$r"
r=$(H "$J_AUTH" -X PATCH "http://127.0.0.1:$HPORT/profiles?id=eq.$U2" -d '{"role":"owner"}')
echo "$r" | grep -q "Doar owners pot schimba rolul" && ok "E2E-2 authenticated non-owner (sub): PATCH role ⇒ refuzat" || bad "E2E-2" "$r"
r=$(H "$J_AUTH_NOSUB" -X PATCH "http://127.0.0.1:$HPORT/profiles?id=eq.$U2" -d '{"role":"owner"}')
echo "$r" | grep -q '"code":"42501"' && ok "E2E-3 authenticated fără sub: PATCH role ⇒ 42501" || bad "E2E-3" "$r"
r=$(H "$J_ANON" -X PATCH "http://127.0.0.1:$HPORT/profiles?id=eq.$U2" -d '{"role":"owner"}')
echo "$r" | grep -q '"code":"42501"' && ok "E2E-4 anon JWT: PATCH role ⇒ 42501" || bad "E2E-4" "$r"
r=$(H "$J_AUTH_NOSUB" -X POST "http://127.0.0.1:$HPORT/rpc/escaladare_claim" -d '{}')
echo "$r" | grep -q '"code":"42501"' && ok "E2E-5 RPC set_config(claim.role=service_role) + UPDATE ca authenticated ⇒ 42501" || bad "E2E-5" "$r"
r=$(H "$J_AUTH_NOSUB" -X POST "http://127.0.0.1:$HPORT/rpc/escaladare_claims" -d '{}')
echo "$r" | grep -q '"code":"42501"' && ok "E2E-6 RPC set_config(claims+claim.role=service_role, consistente) + UPDATE ca authenticated ⇒ 42501 (doar legarea de rolul efectiv oprește)" || bad "E2E-6" "$r"
st=$(P -tA -c "SELECT role FROM profiles WHERE id='$U2'")
[ "$st" = "sef_sr" ] && ok "E2E-7 starea finală: role=$st (nicio escaladare n-a trecut)" || bad "E2E-7" "role=$st"
echo "=== TOTAL: $NFAIL eșecuri ==="
[ $NFAIL = 0 ]
