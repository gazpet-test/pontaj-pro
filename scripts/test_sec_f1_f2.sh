#!/usr/bin/env bash
# ============================================================================
# Harness SQL LOCAL — SEC F1 (20260930i_sec_f1_truncate_revoke) + SEC F2 (20260930j_sec_f2_profiles_uid_null), runda 2.
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
print("\n".join(re.findall(r"(CREATE OR REPLACE FUNCTION public\.\w+\(\).*?\$function\$;)", t, re.S)))
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
suite7 > "$D/s7_live.txt"
o=$(run "$F2"); [ $? = 0 ] && ok "F2-apply aplicare" || bad "F2-apply" "$o"
md=$(P -tA -c "SELECT string_agg(proname||'='||md5(prosrc), ' ' ORDER BY proname) FROM pg_proc WHERE proname IN ('prevent_role_escalation','enforce_owner_only_salary_flags','protect_can_access_pontaj_brut')")
echo "INFO md5 după F2: $md"
suite7 > "$D/s7_patch.txt"
if diff "$D/s7_live.txt" "$D/s7_patch.txt" >/dev/null; then ok "F2-7 utilizatori reali (sub): comportament IDENTIC live vs patch ($(grep -c '^##' "$D/s7_live.txt") scenarii)"; else bad "F2-7" "$(diff "$D/s7_live.txt" "$D/s7_patch.txt")"; fi
grep -q "Doar owners pot schimba rolul" "$D/s7_patch.txt" && grep -q "^sef|t$" "$D/s7_patch.txt" && grep -q "^f|f$" "$D/s7_patch.txt" && grep -q "^t|t$" "$D/s7_patch.txt" \
  && ok "F2-7b non-owner refuzat/resetat, owner poate (rol, is_owner, can_*)" || bad "F2-7b" "$(cat "$D/s7_patch.txt")"

# Matricea de discriminare pe fiecare funcție în parte: doar triggerul ei activ (mesajul de eroare poartă numele funcției)
# x <caz> <așteptat: ok|42501|22P02> <utilizator conexiune> <SQL înainte de UPDATE, separat prin ;;>
x() { local caz=$1 exp=$2 u=$3 pre=$4 args=() IFS=$'\n'
  for s in $(echo "$pre" | sed 's/;;/\n/g'); do args+=(-c "$s"); done
  o=$(Q "$u" -tA -c "BEGIN" "${args[@]}" -c "UPDATE profiles SET role='x_$RANDOM' WHERE id='$U2' RETURNING 'UPD'" -c "ROLLBACK" 2>&1)
  case $exp in
    ok)    echo "$o" | grep -q "^UPD$" && ! echo "$o" | grep -q ERROR && ok "$FN $caz ⇒ trece" || bad "$FN $caz" "așteptat trece: $o" ;;
    42501) echo "$o" | grep -q "ERROR:  42501" && echo "$o" | grep -q "$FN" && ok "$FN $caz ⇒ 42501" || bad "$FN $caz" "așteptat 42501 din $FN: $o" ;;
    *)     echo "$o" | grep -q "ERROR:  $exp" && ok "$FN $caz ⇒ $exp" || bad "$FN $caz" "așteptat $exp: $o" ;;
  esac; }
C="SELECT set_config('request.jwt.claims','"; E="',true)"
R="SELECT set_config('request.jwt.claim.role','"
for FN in prevent_role_escalation enforce_owner_only_salary_flags protect_can_access_pontaj_brut; do
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
  P -c "ALTER TABLE profiles ENABLE TRIGGER USER;"
done
# Precondiția F2 refuză un corp live modificat; md5 pre-check-urile rămân pe corpurile live
P -c "BEGIN; CREATE OR REPLACE FUNCTION public.protect_can_access_pontaj_brut() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS \$f\$ BEGIN RETURN NEW; END \$f\$; COMMIT;" >/dev/null
o=$(run "$F2"); echo "$o" | grep -q "Precondiție 0b" && ok "F2-pre corp modificat ⇒ refuz" || bad "F2-pre" "$o"
echo "=== TOTAL: $NFAIL eșecuri ==="
[ $NFAIL = 0 ]
