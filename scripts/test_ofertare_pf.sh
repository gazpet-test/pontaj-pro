#!/usr/bin/env bash
# EXCLUSIV clustere PostgreSQL locale efemere. Nu folosește PGURI, git, Supabase sau date reale.
# După integrare: bash scripts/test_ofertare_pf.sh
# PG17 implicit (producția e PostgreSQL 17.6); PG_BIN=/usr/lib/postgresql/16/bin rulează și proba de compatibilitate PG16.
# Etape:
#   S. superuser local: logica completă (imuabilitate, filiație, manifest, RLS, mutanți, concurență, revenire, gate 0e).
#   P. prod-like (modelul scripts/test_powpatroll_registry.sh secțiunea A): cluster separat cu bootstrap supabase_admin,
#      postgres NOSUPERUSER CREATEROLE BYPASSRLS proprietarul bazei, default privileges Supabase (ALL pe tabele/secvențe/
#      funcții noi pentru anon/authenticated/service_role), sesiuni API prin authenticator. Fără GRANT OPTION pe auth ⇒
#      migrarea trebuie refuzată fail-closed; cu GRANT OPTION ⇒ aplicare, ACL efectiv, smoke, gate 0e, revenire, reaplicare.
#   PF_PRODLIKE=0 sare etapa P; PF_DOAR_PRODLIKE=1 sare etapa S (contra-probe rapide pe configurația live).
# r3: etapa P reproduce EXACT ACL-ul live pe schema auth (owner supabase_admin, PUBLIC fără USAGE, postgres=U FĂRĂ grant
#   option) și default privileges live; executorul PF nu primește nimic pe auth și citește uid-ul prin fn_ofertare_pf_uid().
set -Eeuo pipefail
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGSERVICE PGSERVICEFILE PGOPTIONS PGTARGETSESSIONATTRS PGLOADBALANCEHOSTS
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
PORT="${PGPORT_TEST:-5979}"
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] && (( PORT > 1023 && PORT < 65536 )) || { echo 'FAIL port local invalid' >&2; exit 2; }
DB=ofertare_pf_test
NAME=20261012a_ofertare_pf_pachete
MIG="$ROOT/supabase/migrations/$NAME.sql"
REV="$ROOT/supabase/revenire/${NAME}_ROLLBACK.sql"
FIX="$ROOT/supabase/tests/ofertare_pf_fixture.sql"
TMP="$(mktemp -d /tmp/ofertare_pf.XXXXXXXX)"
DATA="$TMP/data"
PDATA="$TMP/pl"
PPORT=$((PORT + 1))
STARTED=0
PSTARTED=0
GATE="$ROOT/scripts/control_0e.sql"
pass() { printf 'PASS %s\n' "$*"; }
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
cleanup() {
  if [ "$STARTED" = 1 ]; then as_pg "$PG_BIN/pg_ctl" -D "$DATA" -m immediate -w stop >/dev/null 2>&1 || true; fi
  if [ "$PSTARTED" = 1 ]; then as_pg "$PG_BIN/pg_ctl" -D "$PDATA" -m immediate -w stop >/dev/null 2>&1 || true; fi
  # Numai directorul unic creat mai sus. Nicio cale PGDATA furnizată de utilizator.
  case "$TMP" in /tmp/ofertare_pf.*) rm -rf -- "$TMP" ;; esac
}
trap cleanup EXIT
trap 'printf "FAIL linia %s\n" "$LINENO" >&2' ERR
[ -x "$PG_BIN/initdb" ] || fail "PG16/17 lipsă: $PG_BIN"
case "$("$PG_BIN/postgres" --version)" in *' 16.'*|*' 17.'*) ;; *) fail 'harness-ul cere PG16/17' ;; esac
if [ "$(id -u)" = 0 ]; then chown postgres:postgres "$TMP"; fi
as_pg "$PG_BIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >"$TMP/init.log"
as_pg "$PG_BIN/pg_ctl" -D "$DATA" -l "$TMP/server.log" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$TMP" >/dev/null
STARTED=1
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$FIX" >"$TMP/fixture.log"
q() { "${PSQL[@]}" -d "$DB" -Atc "$1"; }
apply() { "${PSQL[@]}" -d "$DB" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare','$NAME:' || txid_current(),true)" -f "$MIG"; }
ca() {
  local role=authenticated uid="00000000-0000-0000-0000-00000000000$1" fin="${3:-COMMIT}"
  if [ "$1" = anon ] || [ "$1" = service_role ]; then role="$1"; uid=''; fi
  "${PSQL[@]}" -d "$DB" -At <<SQL
BEGIN;
SELECT set_config('request.jwt.claim.sub','$uid',true) \g /dev/null
SET LOCAL ROLE $role;
$2;
$fin;
SQL
}
eq() { local label="$1" expected="$2" actual="$3"; [ "$actual" = "$expected" ] || fail "$label: așteptat [$expected], primit [$actual]"; pass "$label"; }
# Refuzul trebuie să vină din motivul așteptat (mesajul exact al erorii), nu din orice eroare.
deny() {
  local label="$1" who="$2" sql="$3" motiv="${4:-}"
  [ -n "$motiv" ] || fail "$label: deny fără mesajul așteptat"
  if ca "$who" "$sql" ROLLBACK >"$TMP/deny.log" 2>&1; then fail "$label: operație acceptată"; fi
  grep -qF -- "$motiv" "$TMP/deny.log" || fail "$label: refuz din alt motiv: $(grep -m1 -E 'ERROR|FATAL' "$TMP/deny.log")"
  pass "$label"
}
ARM1="SELECT set_config('gazpet.rollback_tehnic_20261012a','STERGE_PF_SCHEMA:' || txid_current(),true)"
ARM2="SELECT set_config('gazpet.rollback_tehnic_20261012a_date','STERGE_PF_DRAFTURI:' || txid_current(),true)"
rev() { "${PSQL[@]}" -d "$DB" --single-transaction -c "$ARM1" -f "$REV"; }
rev2() { "${PSQL[@]}" -d "$DB" --single-transaction -c "$ARM1" -c "$ARM2" -f "$REV"; }
refuz() {  # $1 eticheta, $2 fișier log, $3 mesaj așteptat
  grep -qF -- "$3" "$2" || { cat "$2" >&2; fail "$1: refuz din alt motiv"; }
  pass "$1"
}
gate0e() { "${PSQL[@]}" -d "$DB" -At -f "$GATE" >"$TMP/gate0e.log" 2>&1 || { cat "$TMP/gate0e.log" >&2; fail 'gate 0e nu a rulat'; }; grep -c . "$TMP/gate0e.log" || true; }

if [ "${PF_DOAR_PRODLIKE:-0}" != 1 ]; then
echo "== S. superuser local ($("$PG_BIN/postgres" --version)) =="
if "${PSQL[@]}" -d "$DB" --single-transaction -f "$MIG" >"$TMP/no-guard.log" 2>&1; then fail 'migrare fără gardă'; fi
refuz 'garda de livrare refuză rularea în afara runnerului' "$TMP/no-guard.log" 'REFUZ: folosiți scripts/livrare_migrare.sh'
eq 'garda nu lasă obiecte parțiale' '' "$(q "SELECT to_regclass('public.ofertare_pf_pachete')")"
q "ALTER FUNCTION public.fn_are_acces_ofertare() SECURITY INVOKER"
if apply >"$TMP/pre.log" 2>&1; then fail 'precondiție helper SECDEF'; fi
q "ALTER FUNCTION public.fn_are_acces_ofertare() SECURITY DEFINER"
refuz 'precondiție helper SECDEF fail-closed' "$TMP/pre.log" 'REFUZ: semnătura, owner, SECDEF, search_path sau ACL fn_are_acces_ofertare diferă'
q "ALTER TABLE public.ofertare_formulare_registru RENAME COLUMN fisier_path TO cale_schimbata"
if apply >"$TMP/pre.log" 2>&1; then fail 'precondiție coloană registru'; fi
q "ALTER TABLE public.ofertare_formulare_registru RENAME COLUMN cale_schimbata TO fisier_path"
refuz 'precondiție coloană registru fail-closed' "$TMP/pre.log" 'coloană părinte ofertare_formulare_registru.fisier_path'
q "ALTER TABLE public.user_module_access RENAME COLUMN access_level TO nivel_schimbat"
if apply >"$TMP/pre.log" 2>&1; then fail 'precondiție access_level'; fi
q "ALTER TABLE public.user_module_access RENAME COLUMN nivel_schimbat TO access_level"
refuz 'precondiție user_module_access.access_level fail-closed' "$TMP/pre.log" 'coloană părinte user_module_access.access_level'
q "ALTER FUNCTION auth.uid() RENAME TO uid_live; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid'"
if apply >"$TMP/pre.log" 2>&1; then fail 'precondiție auth.uid()'; fi
q "DROP FUNCTION auth.uid(); ALTER FUNCTION auth.uid_live() RENAME TO uid"
refuz 'precondiție auth.uid() = corpul live (md5) fail-closed' "$TMP/pre.log" 'REFUZ: auth.uid() lipsește sau diferă de cel live'
q "ALTER POLICY grafic_act_sel ON public.grafic_activitati USING (true)"
if apply >"$TMP/pre.log" 2>&1; then fail 'precondiție politica grafic_act_sel'; fi
q "ALTER POLICY grafic_act_sel ON public.grafic_activitati USING (auth.uid() IS NOT NULL)"
refuz 'precondiție politica grafic_act_sel = cea live fail-closed' "$TMP/pre.log" 'REFUZ: grafic_activitati'
q "CREATE POLICY pf_test_public ON public.ofertare_formulare_registru FOR SELECT USING (true)"
if apply >"$TMP/pre.log" 2>&1; then fail 'precondiție politici PUBLIC pe registru'; fi
q "DROP POLICY pf_test_public ON public.ofertare_formulare_registru"
refuz 'precondiție: fără politici PUBLIC pe registru' "$TMP/pre.log" 'are politici pentru PUBLIC'
if ! apply >"$TMP/migration.log" 2>&1; then cat "$TMP/migration.log" >&2; fail 'migrare prin garda runnerului și postcondiții'; fi
pass 'migrare prin garda legată de txid și toate postcondițiile'
if apply >"$TMP/reapply.log" 2>&1; then fail 'reaplicare'; fi
refuz 'reaplicare refuzată' "$TMP/reapply.log" 'REFUZ: obiect PF sau rol executor deja existent'
# Wrapper-ul uid: executorul nu are nimic pe auth, iar wrapper-ul întoarce sub-ul APELANTULUI (nu al ownerului postgres).
ca_exec() {  # $1 = setare JWT ('claim.sub' sau 'claims'), $2 = valoare, $3 = SQL; rulează ca executorul PF
  "${PSQL[@]}" -d "$DB" -At <<SQL
BEGIN;
SELECT set_config('request.jwt.$1','$2',true) \g /dev/null
SET LOCAL ROLE ofertare_pf_executor;
$3;
ROLLBACK;
SQL
}
eq 'executorul PF nu are USAGE pe schema auth' f "$(q "SELECT has_schema_privilege('ofertare_pf_executor','auth','USAGE')")"
eq 'wrapper ca executor: request.jwt.claim.sub → uid-ul apelantului' "00000000-0000-0000-0000-000000000002" "$(ca_exec claim.sub "00000000-0000-0000-0000-000000000002" 'SELECT public.fn_ofertare_pf_uid()')"
eq 'wrapper ca executor: request.jwt.claims (PostgREST) → uid-ul apelantului' "00000000-0000-0000-0000-000000000004" "$(ca_exec claims '{"sub":"'"00000000-0000-0000-0000-000000000004"'","role":"authenticated"}' 'SELECT public.fn_ofertare_pf_uid()')"
eq 'wrapper fără JWT întoarce NULL, nu identitatea ownerului' '' "$(ca_exec claims '' 'SELECT public.fn_ofertare_pf_uid()')"
if ca_exec claim.sub "00000000-0000-0000-0000-000000000002" 'SELECT auth.uid()' >"$TMP/exec-auth.log" 2>&1; then fail 'executorul a citit auth.uid() direct'; fi
refuz 'executorul nu poate apela auth.uid() direct' "$TMP/exec-auth.log" 'permission denied for schema auth'
eq 'gate 0e după migrare = 0 rânduri' 0 "$(gate0e)"

BASE="versiune,eticheta,rol_oferta,instrument"
VAL="1,'fixture','ofertant_unic','excel'"
deny 'XOR niciun părinte' 1 "INSERT INTO public.ofertare_pf_pachete($BASE) VALUES($VAL)" 'pf_parinte_xor'
deny 'XOR ambii părinți' 1 "INSERT INTO public.ofertare_pf_pachete(licitatie_id,proiect_id,$BASE) VALUES(1,1,$VAL)" 'pf_parinte_xor'
deny 'INSERT direct închis' 1 "INSERT INTO public.ofertare_pf_pachete(licitatie_id,$BASE,stare) VALUES(1,$VAL,'inchis')" 'PF: INSERT numai draft fără manifest'
deny 'INSERT direct cu manifest' 1 "INSERT INTO public.ofertare_pf_pachete(licitatie_id,$BASE,manifest) VALUES(1,$VAL,'[]')" 'PF: INSERT numai draft fără manifest'
P="$(ca 1 "INSERT INTO public.ofertare_pf_pachete(licitatie_id,$BASE,documente_selectate) VALUES(1,$VAL,'[{\"registru_id\":1,\"cod\":\"FALS\",\"fisier_path\":\"fals\"},{\"cheie\":\"seap\",\"denumire\":\"SEAP sintetic\",\"provenienta\":\"fixture\"}]') RETURNING id")"
pass 'owner creează draft'
deny 'draft unic' 1 "INSERT INTO public.ofertare_pf_pachete(licitatie_id,versiune,eticheta,rol_oferta,instrument) VALUES(1,2,'alt draft','ofertant_unic','excel')" 'pf_lic_draft'
deny 'tranziție lucru închis direct' 1 "UPDATE public.ofertare_pf_pachete SET stare='inchis' WHERE id=$P" 'PF: închiderea este permisă numai prin RPC'
deny 'manifest direct pe draft' 1 "UPDATE public.ofertare_pf_pachete SET manifest='[]' WHERE id=$P" 'PF: manifestul se scrie numai la închidere'
deny 'închidere fără total sau plătibil' 1 "SELECT public.fn_ofertare_pf_inchide($P)" 'PF: trebuie total_oferta sau platibil'
eq 'PF explicit citește' 2 "$(ca 2 "SELECT (public.fn_poate_citi_pf()::int + public.fn_poate_scrie_pf()::int)")"
eq 'Ofertare general nu primește PF' 0 "$(ca 3 "SELECT count(*) FROM public.ofertare_pf_pachete")"
eq 'fără drept nu citește valori' 0 "$(ca 4 "SELECT count(*) FROM public.ofertare_pf_valori")"
eq 'fără drept nu citește control' 0 "$(ca 4 "SELECT count(*) FROM public.v_ofertare_pf_control")"
deny 'fără PF nu scrie pachete' 3 "INSERT INTO public.ofertare_pf_pachete(proiect_id,$BASE) VALUES(1,$VAL)" 'row-level security policy for table "ofertare_pf_pachete"'
deny 'fără PF nu scrie valori' 4 "INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,valoare,localizare) VALUES($P,'total_oferta','gazpet',1,'p1')" 'PF: pachet inexistent sau fără drept de scriere PF'
deny 'fără PF nu închide prin RPC' 3 "SELECT public.fn_ofertare_pf_inchide($P)" 'PF: fără drept de scriere'
deny 'fără PF nu clonează prin RPC' 4 "SELECT public.fn_ofertare_pf_versiune_noua($P,'x')" 'PF: fără drept de scriere'
for object in ofertare_pf_pachete ofertare_pf_valori v_ofertare_pf_control; do deny "anon nu citește $object" anon "SELECT * FROM public.$object" 'permission denied for'; done
deny 'anon nu execută wrapper-ul uid' anon 'SELECT public.fn_ofertare_pf_uid()' 'permission denied for function fn_ofertare_pf_uid'
deny 'authenticated nu execută wrapper-ul uid' 1 'SELECT public.fn_ofertare_pf_uid()' 'permission denied for function fn_ofertare_pf_uid'
deny 'service_role nu execută wrapper-ul uid' service_role 'SELECT public.fn_ofertare_pf_uid()' 'permission denied for function fn_ofertare_pf_uid'
deny 'anon nu execută helper' anon 'SELECT public.fn_poate_citi_pf()' 'permission denied for function fn_poate_citi_pf'
deny 'anon nu execută închiderea' anon "SELECT public.fn_ofertare_pf_inchide($P)" 'permission denied for function fn_ofertare_pf_inchide'
deny 'anon nu consumă secvența' anon "SELECT nextval('public.ofertare_pf_pachete_id_seq')" 'permission denied for sequence ofertare_pf_pachete_id_seq'
deny 'authenticated nu consumă secvența identity' 1 "SELECT nextval('public.ofertare_pf_pachete_id_seq')" 'permission denied for sequence ofertare_pf_pachete_id_seq'
deny 'service_role nu citește pachete PF' service_role 'SELECT count(*) FROM public.ofertare_pf_pachete' 'permission denied for table ofertare_pf_pachete'
deny 'service_role nu citește valori PF' service_role 'SELECT count(*) FROM public.ofertare_pf_valori' 'permission denied for table ofertare_pf_valori'
deny 'service_role nu citește controlul PF' service_role 'SELECT count(*) FROM public.v_ofertare_pf_control' 'permission denied for view v_ofertare_pf_control'
deny 'service_role nu execută închiderea' service_role "SELECT public.fn_ofertare_pf_inchide($P)" 'permission denied for function fn_ofertare_pf_inchide'
# PF viewer (access_level viewer): citește, nu scrie (decizie 03.10, precedent 20261005b).
eq 'PF viewer: citire da, scriere nu' '1|0' "$(ca 5 "SELECT public.fn_poate_citi_pf()::int || '|' || public.fn_poate_scrie_pf()::int")"
deny 'PF viewer nu creează draft' 5 "INSERT INTO public.ofertare_pf_pachete(proiect_id,$BASE) VALUES(1,$VAL)" 'row-level security policy for table "ofertare_pf_pachete"'
deny 'PF viewer nu scrie valori' 5 "INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,valoare,localizare) VALUES($P,'total_oferta','gazpet',1,'p1')" 'PF: pachet inexistent sau fără drept de scriere PF'
eq 'PF viewer nu editează antetul (RLS: 0 rânduri)' '' "$(ca 5 "UPDATE public.ofertare_pf_pachete SET eticheta='viewer' WHERE id=$P RETURNING id")"
# SET ROLE se verifică față de session_user; harness-ul rulează ca superuser postgres, deci proba se face dintr-o
# sesiune authenticator (modelul PostgREST) — altfel ar fi acceptată vacuu. Control pozitiv: authenticator → authenticated.
q "CREATE ROLE authenticator NOLOGIN NOINHERIT; GRANT anon, authenticated, service_role TO authenticator"
ca 1 'SET LOCAL SESSION AUTHORIZATION authenticator; SET LOCAL ROLE authenticated' ROLLBACK >/dev/null || fail 'control pozitiv authenticator -> authenticated'
deny 'authenticated nu poate deveni executor' 1 'SET LOCAL SESSION AUTHORIZATION authenticator; SET LOCAL ROLE authenticated; SET LOCAL ROLE ofertare_pf_executor' 'permission denied to set role "ofertare_pf_executor"'
deny 'TRUNCATE interzis rolului API' 1 'TRUNCATE public.ofertare_pf_valori' 'permission denied for table ofertare_pf_valori'
eq 'grafic: licitație fără activități = false (informativ)' t "$(ca 2 "SELECT bool_and(grafic_are_activitati IS FALSE) FROM public.v_ofertare_pf_control WHERE pachet_id=$P")"

V="$(ca 1 "INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,valoare,sursa_registru_id,localizare) VALUES($P,'total_oferta','gazpet',100.01,1,'p1') RETURNING id")"
deny 'valori neconfirmate' 1 "SELECT public.fn_ofertare_pf_inchide($P)" 'toate valorile confirmate'
ca 1 "UPDATE public.ofertare_pf_valori SET confirmat_de=auth.uid(),confirmat_la=now() WHERE id=$V" >/dev/null
ca 1 "UPDATE public.ofertare_pf_pachete SET documente_selectate='[]' WHERE id=$P" >/dev/null
deny 'sursă în afara manifestului' 1 "SELECT public.fn_ofertare_pf_inchide($P)" 'PF: valoare cu sursă în afara manifestului'
ca 1 "UPDATE public.ofertare_pf_pachete SET documente_selectate='[{\"registru_id\":2}]' WHERE id=$P" >/dev/null
deny 'document din altă licitație' 1 "SELECT public.fn_ofertare_pf_inchide($P)" 'PF: document din altă licitație sau absent'
ca 1 "UPDATE public.ofertare_pf_pachete SET documente_selectate='[{\"registru_id\":1},{\"registru_id\":1}]' WHERE id=$P" >/dev/null
deny 'selecție duplicată' 1 "SELECT public.fn_ofertare_pf_inchide($P)" 'PF: document duplicat'
ca 1 "UPDATE public.ofertare_pf_pachete SET documente_selectate='[{\"registru_id\":1,\"cod\":\"FALS\",\"fisier_path\":\"fals\"},{\"cheie\":\"seap\",\"denumire\":\"SEAP sintetic\",\"provenienta\":\"fixture\"}]' WHERE id=$P" >/dev/null
ca 1 "INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,valoare,sursa_externa_cheie,localizare,confirmat_de,confirmat_la) VALUES($P,'total_oferta','gazpet',100.00,'seap','p1',auth.uid(),now()),($P,'ajustari','gazpet',-25.20,'seap','p2',auth.uid(),now())" >/dev/null
eq 'control diferență exactă la ban' 0.01 "$(ca 1 "SELECT diferenta FROM public.v_ofertare_pf_control WHERE pachet_id=$P AND valoare_a_id=$V AND valoare_b_id IS NOT NULL")"
eq 'termen absent = NULL neverificat' t "$(ca 1 "SELECT bool_and(diferenta IS NULL AND verdict='neverificat') FROM public.v_ofertare_pf_control WHERE pachet_id=$P AND valoare_b_id IS NULL")"
eq 'cu date: Ofertare general nu citește pachete/valori/control' '0|0|0' "$(ca 3 "SELECT (SELECT count(*) FROM public.ofertare_pf_pachete) || '|' || (SELECT count(*) FROM public.ofertare_pf_valori) || '|' || (SELECT count(*) FROM public.v_ofertare_pf_control)")"
eq 'cu date: fără niciun drept nu citește pachete/valori/control' '0|0|0' "$(ca 4 "SELECT (SELECT count(*) FROM public.ofertare_pf_pachete) || '|' || (SELECT count(*) FROM public.ofertare_pf_valori) || '|' || (SELECT count(*) FROM public.v_ofertare_pf_control)")"
eq 'cu date: owner, PF editor și PF viewer văd aceleași 3 valori' '3|3|3' "$(for u in 1 2 5; do ca $u "SELECT count(*) FROM public.ofertare_pf_valori WHERE pachet_id=$P"; done | paste -sd'|')"
eq 'negativ păstrat exact' -25.20 "$(ca 1 "SELECT valoare FROM public.ofertare_pf_valori WHERE pachet_id=$P AND rol_valoare='ajustari'")"
deny 'cota cere procent' 1 "INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,valoare,localizare) VALUES($P,'cota','gazpet',0,'p3')" 'pf_cota'
eq 'închidere V1' "$P" "$(ca 1 "SELECT public.fn_ofertare_pf_inchide($P)")"
eq 'manifest recitește cod/path din registru' 'F1|fixture/f1.pdf' "$(q "SELECT (manifest->0->>'cod') || '|' || (manifest->0->>'fisier_path') FROM public.ofertare_pf_pachete WHERE id=$P")"
eq 'hash SHA-256 server pe manifest::text' t "$(q "SELECT manifest_hash=encode(extensions.digest(manifest::text,'sha256'),'hex') FROM public.ofertare_pf_pachete WHERE id=$P")"
eq 'închis de apelant (wrapper în RPC), nu de owner' "00000000-0000-0000-0000-000000000001" "$(q "SELECT inchis_de FROM public.ofertare_pf_pachete WHERE id=$P")"
q "INSERT INTO public.grafic_activitati(licitatie_id,denumire,valoare_lei) VALUES (2,'Altă licitație',1)"
eq 'grafic: activitățile altei licitații nu contează' t "$(ca 2 "SELECT bool_and(grafic_are_activitati IS FALSE) FROM public.v_ofertare_pf_control WHERE pachet_id=$P")"
q "INSERT INTO public.grafic_activitati(licitatie_id,denumire,valoare_lei) VALUES (1,'Săpătură',10),(1,'Montaj',20)"
eq 'grafic: licitație cu activități = true; PF fără Ofertare vede; fără verdict pe sumă' t "$(ca 2 "SELECT bool_and(grafic_are_activitati AND grafic_pdf_in_manifest IS NULL AND grafic_verdict='neverificat') FROM public.v_ofertare_pf_control WHERE pachet_id=$P")"
deny 'UPDATE închis' 1 "UPDATE public.ofertare_pf_pachete SET eticheta='alterat' WHERE id=$P" 'PF: versiunea înghețată este imuabilă'
deny 'DELETE închis' 1 "DELETE FROM public.ofertare_pf_pachete WHERE id=$P" 'PF: versiunea înghețată nu se șterge'
deny 'închis înlocuit în afara RPC' 1 "UPDATE public.ofertare_pf_pachete SET stare='inlocuit' WHERE id=$P" 'PF: versiunea înghețată este imuabilă'
deny 'service_role nu poate înlocui direct' service_role "UPDATE public.ofertare_pf_pachete SET stare='inlocuit' WHERE id=$P" 'permission denied for table ofertare_pf_pachete'
deny 'GUC fals nu permite înlocuirea' 1 "SELECT set_config('gazpet.pf_rpc','1',true); UPDATE public.ofertare_pf_pachete SET stare='inlocuit' WHERE id=$P" 'PF: versiunea înghețată este imuabilă'
deny 'UPDATE valoare înghețată' 1 "UPDATE public.ofertare_pf_valori SET valoare=9 WHERE id=$V" 'PF: valorile versiunii înghețate sunt imuabile'
deny 'DELETE valoare înghețată' 1 "DELETE FROM public.ofertare_pf_valori WHERE id=$V" 'PF: valorile versiunii înghețate sunt imuabile'
deny 'INSERT valoare în pachet închis' 1 "INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,valoare,localizare) VALUES($P,'platibil','gazpet',1,'p1')" 'PF: valorile versiunii înghețate sunt imuabile'

# Mutant 1: aceeași probă UPDATE trebuie să detecteze absența triggerului.
q 'ALTER TABLE public.ofertare_pf_pachete DISABLE TRIGGER pf_pachet_garda'
if ! ca 1 "UPDATE public.ofertare_pf_pachete SET eticheta='mutant' WHERE id=$P" ROLLBACK >"$TMP/mutant1.log" 2>&1; then fail 'mutant fără trigger nu este detectat de proba UPDATE'; fi
q 'ALTER TABLE public.ofertare_pf_pachete ENABLE TRIGGER pf_pachet_garda'
deny 'mutant 1 ucis: proba UPDATE refuză numai cu trigger activ' 1 "UPDATE public.ofertare_pf_pachete SET eticheta='mutant' WHERE id=$P" 'PF: versiunea înghețată este imuabilă'
# Mutant 2: indexul greșit unește draftul și curentul și împiedică versiunea nouă.
q "DROP INDEX public.pf_lic_draft; CREATE UNIQUE INDEX pf_lic_draft ON public.ofertare_pf_pachete(licitatie_id,rol_oferta) WHERE stare <> 'inlocuit'"
if ca 1 "SELECT public.fn_ofertare_pf_versiune_noua($P,'mutant')" ROLLBACK >"$TMP/mutant2.log" 2>&1; then fail 'mutant index <> inlocuit supraviețuiește'; fi
grep -q 'pf_lic_draft' "$TMP/mutant2.log" || fail 'mutant index a eșuat din alt motiv'
q "DROP INDEX public.pf_lic_draft; CREATE UNIQUE INDEX pf_lic_draft ON public.ofertare_pf_pachete(licitatie_id,rol_oferta) WHERE stare = 'lucru'"
P2="$(ca 2 "SELECT public.fn_ofertare_pf_versiune_noua($P,'V2 sintetic')")"
eq 'versiune nouă: created_by/updated_by = apelantul (trigger ca executor, prin wrapper)' "00000000-0000-0000-0000-000000000002|00000000-0000-0000-0000-000000000002" "$(q "SELECT created_by || '|' || updated_by FROM public.ofertare_pf_pachete WHERE id=$P2")"
pass 'mutant 2 ucis: indexul corect permite draft lângă curent'
eq 'curentul V1 rămâne închis în timpul draftului' inchis "$(q "SELECT stare FROM public.ofertare_pf_pachete WHERE id=$P")"
eq 'clonare cu confirmările șterse' t "$(q "SELECT count(*)=3 AND bool_and(confirmat_de IS NULL AND confirmat_la IS NULL) FROM public.ofertare_pf_valori WHERE pachet_id=$P2")"
deny 'al doilea draft prin RPC' 1 "SELECT public.fn_ofertare_pf_versiune_noua($P,'V3 prematur')" 'pf_lic_draft'
deny 'valoare nu se mută din închis în draft' 1 "UPDATE public.ofertare_pf_valori SET pachet_id=$P2 WHERE id=$V" 'PF: valoarea nu se mută între versiuni'
deny 'filiație către alt părinte' 1 "INSERT INTO public.ofertare_pf_pachete(proiect_id,versiune,eticheta,rol_oferta,instrument,inlocuieste_id) VALUES(1,3,'fals','ofertant_unic','excel',$P)" 'PF: versiunea sursă nu este curentul aceluiași scope'
ca 1 "UPDATE public.ofertare_pf_valori SET confirmat_de=auth.uid(),confirmat_la=now() WHERE pachet_id=$P2" >/dev/null
ca 1 "UPDATE public.ofertare_pf_pachete SET documente_selectate=(SELECT jsonb_agg(x ORDER BY n DESC) FROM jsonb_array_elements(documente_selectate) WITH ORDINALITY t(x,n)) WHERE id=$P2" >/dev/null

# O eroare DUPĂ înlocuirea curentului trebuie să readucă ambele stări.
q "CREATE FUNCTION public.pf_test_fail() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''fixture atomicitate''; END'; CREATE TRIGGER zz_pf_test_fail BEFORE UPDATE ON public.ofertare_pf_pachete FOR EACH ROW WHEN (NEW.stare='inchis') EXECUTE FUNCTION public.pf_test_fail()"
deny 'închidere eșuată după înlocuire = rollback atomic' 1 "SELECT public.fn_ofertare_pf_inchide($P2)" 'fixture atomicitate'
eq 'atomicitate păstrează V1 închis și V2 lucru' 'inchis,lucru' "$(q "SELECT string_agg(stare,',' ORDER BY versiune) FROM public.ofertare_pf_pachete WHERE id IN ($P,$P2)")"
q 'DROP TRIGGER zz_pf_test_fail ON public.ofertare_pf_pachete; DROP FUNCTION public.pf_test_fail()'

# Scrierea ține lock-ul pachetului. Închiderea așteaptă și vede confirmarea ștearsă.
"${PSQL[@]}" -d "$DB" -At >"$TMP/writer.log" 2>&1 <<SQL &
BEGIN;
SET application_name='pf_fixture_writer';
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
UPDATE public.ofertare_pf_valori SET confirmat_de=NULL,confirmat_la=NULL WHERE pachet_id=$P2;
SELECT pg_sleep(2);
COMMIT;
SQL
WRITER=$!
READY=0
for _ in $(seq 1 40); do
  if [ "$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name='pf_fixture_writer' AND wait_event='PgSleep'")" = 1 ]; then READY=1; break; fi
  sleep 0.05
done
[ "$READY" = 1 ] || fail 'writer concurent nu a luat lock-ul'
deny 'concurență: închiderea vede modificarea confirmărilor' 1 "SELECT public.fn_ofertare_pf_inchide($P2)" 'toate valorile confirmate'
wait "$WRITER" || fail 'writer concurent'
ca 1 "UPDATE public.ofertare_pf_valori SET confirmat_de=auth.uid(),confirmat_la=now() WHERE pachet_id=$P2" >/dev/null
eq 'închidere V2' "$P2" "$(ca 2 "SELECT public.fn_ofertare_pf_inchide($P2)")"
eq 'V2 închis de apelantul V2 (alt user decât V1)' "00000000-0000-0000-0000-000000000002" "$(q "SELECT inchis_de FROM public.ofertare_pf_pachete WHERE id=$P2")"
eq 'tranziție atomică V1 înlocuit V2 închis' 'inlocuit,inchis' "$(q "SELECT string_agg(stare,',' ORDER BY versiune) FROM public.ofertare_pf_pachete WHERE id IN ($P,$P2)")"
eq 'manifest_hash stabil independent de ordinea selecției' t "$(q "SELECT a.manifest_hash=b.manifest_hash FROM public.ofertare_pf_pachete a, public.ofertare_pf_pachete b WHERE a.id=$P AND b.id=$P2")"
deny 'UPDATE înlocuit' 1 "UPDATE public.ofertare_pf_pachete SET eticheta='alterat' WHERE id=$P" 'PF: versiunea înghețată este imuabilă'
deny 'DELETE înlocuit' 1 "DELETE FROM public.ofertare_pf_pachete WHERE id=$P" 'PF: versiunea înghețată nu se șterge'
deny 'versiune nouă din înlocuit' 1 "SELECT public.fn_ofertare_pf_versiune_noua($P,'invalid')" 'PF: versiunea nouă pornește din curentul închis'
if q 'DELETE FROM public.ofertare_licitatii WHERE id=1' >"$TMP/parent.log" 2>&1; then fail 'părinte cu PF închis șters'; fi
grep -q 'foreign key constraint' "$TMP/parent.log" || fail 'ștergerea părintelui a eșuat din alt motiv'
pass 'părinte cu PF închis protejat de FK RESTRICT'
eq 'exact un curent închis' 1 "$(q "SELECT count(*) FROM public.ofertare_pf_pachete WHERE licitatie_id=1 AND rol_oferta='ofertant_unic' AND stare='inchis'")"
# Filiație exactă (decizie 03.10): un draft inserat direct, fără inlocuieste_id, nu poate înlocui versiunea închisă curentă.
DX="$(ca 1 "INSERT INTO public.ofertare_pf_pachete(licitatie_id,versiune,eticheta,rol_oferta,instrument,documente_selectate) VALUES(1,9,'fără filiație','ofertant_unic','excel','[{\"cheie\":\"x\",\"denumire\":\"Doc\",\"provenienta\":\"fixture\"}]') RETURNING id")"
ca 1 "INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,valoare,sursa_externa_cheie,localizare,confirmat_de,confirmat_la) VALUES($DX,'total_oferta','gazpet',1,'x','p1',auth.uid(),now())" >/dev/null
deny 'draft direct fără filiație nu înlocuiește curentul' 1 "SELECT public.fn_ofertare_pf_inchide($DX)" 'PF: filiație invalidă'
eq 'după refuzul filiației V2 rămâne curentul închis' 'inchis|lucru' "$(q "SELECT (SELECT stare FROM public.ofertare_pf_pachete WHERE id=$P2) || '|' || (SELECT stare FROM public.ofertare_pf_pachete WHERE id=$DX)")"
ca 1 "DELETE FROM public.ofertare_pf_pachete WHERE id=$DX" >/dev/null
if rev2 >"$TMP/rev-real.log" 2>&1; then fail 'revenire cu date înghețate'; fi
refuz 'revenire refuzată când există închis/înlocuit (chiar cu ambele armări)' "$TMP/rev-real.log" 'REFUZ: există versiuni închise sau înlocuite'

# Istoric pe proiect și cascade numai pentru draft.
H="$(ca 2 "INSERT INTO public.ofertare_pf_pachete(proiect_id,$BASE) VALUES(1,$VAL) RETURNING id")"
ca 2 "INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,valoare,localizare) VALUES($H,'act_aditional','gazpet',-1.01,'p1')" >/dev/null
ca 2 "INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,valoare,cota_pct,sursa_externa_cheie,localizare,confirmat_de,confirmat_la)
  SELECT $H,r,d,CASE WHEN s='a' THEN 99999999999999.99 ELSE 99999999999999.98 END,
    CASE WHEN r='cota' THEN 12.3456 END,s,'fixture',auth.uid(),now()
  FROM unnest(ARRAY['total_oferta','platibil','materiale_beneficiar','contract_initial','act_aditional','ajustari','grafic_valoric','cota']) r
  CROSS JOIN unnest(ARRAY['asociere_total','gazpet','subcontract','beneficiar','lider','asociat']) d CROSS JOIN unnest(ARRAY['a','b']) s" >/dev/null
eq 'grafic: proiect fără activități = false' t "$(ca 2 "SELECT bool_and(grafic_are_activitati IS FALSE) FROM public.v_ofertare_pf_control WHERE pachet_id=$H")"
q "INSERT INTO public.grafic_activitati(proiect_id,denumire,valoare_lei) VALUES (1,'Execuție',5)"
eq 'grafic: proiect cu activități = true (după proiect_id)' t "$(ca 2 "SELECT bool_and(grafic_are_activitati) FROM public.v_ofertare_pf_control WHERE pachet_id=$H")"
eq 'SQL 48 roluri × domenii, precizie maximă și excludere cotă/grafic' t "$(ca 2 "SELECT count(*)=48 AND bool_and(CASE WHEN rol_valoare IN ('cota','grafic_valoric') THEN diferenta IS NULL AND verdict='neverificat' ELSE diferenta=0.01 AND verdict='diferenta' END) FROM public.v_ofertare_pf_control WHERE pachet_id=$H AND valoare_b_id IS NOT NULL")"

# Paritate JS/SQL exportată pentru vitest: exact aceleași rânduri ale pachetului.
if [ -n "${PF_PARITY_DIR:-}" ]; then
  mkdir -p "$PF_PARITY_DIR"
  ca 2 "SELECT jsonb_build_object('valori',(SELECT jsonb_agg(to_jsonb(v) || jsonb_build_object('valoare',v.valoare::text,'cota_pct',v.cota_pct::text)) FROM public.ofertare_pf_valori v WHERE pachet_id=$H),'control',(SELECT jsonb_agg(to_jsonb(c) || jsonb_build_object('diferenta',c.diferenta::text)) FROM public.v_ofertare_pf_control c WHERE pachet_id=$H))" >"$PF_PARITY_DIR/pf-parity.json"
  pass 'export paritate SQL/JS'
fi
ca 2 "DELETE FROM public.ofertare_pf_pachete WHERE id=$H" >/dev/null
eq 'ștergere draft cascada valori' 0 "$(q "SELECT count(*) FROM public.ofertare_pf_valori WHERE pachet_id=$H")"
eq 'Execuție valoare contractuală neatinsă' 123.45 "$(q 'SELECT valoare_lei FROM public.executie_proiecte WHERE id=1')"

# Hash client: nu devine server, iar identitatea confirmatorului este dată de trigger.
HC="$(ca 2 "INSERT INTO public.ofertare_pf_pachete(proiect_id,$BASE) VALUES(2,$VAL) RETURNING id")"
ca 2 "INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,valoare,sursa_externa_cheie,localizare,confirmat_de,confirmat_la) VALUES($HC,'platibil','gazpet',-1.01,'h','p1',auth.uid(),now())" >/dev/null
HASH=ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
DOC="\"cheie\":\"h\",\"denumire\":\"Document sintetic\",\"provenienta\":\"fixture\",\"hash_algoritm\":\"sha256\",\"hash_valoare\":\"$HASH\""
ca 2 "UPDATE public.ofertare_pf_pachete SET documente_selectate='[{$DOC,\"hash_sursa\":\"client\"}]' WHERE id=$HC" >/dev/null
deny 'hash client fără confirmare umană' 2 "SELECT public.fn_ofertare_pf_inchide($HC)" 'PF: hash client SHA-256 fără confirmare umană validă'
CONF='"hash_confirmat_de":"00000000-0000-0000-0000-000000000001","hash_confirmat_la":"2026-01-01T00:00:00Z"'
ca 2 "UPDATE public.ofertare_pf_pachete SET documente_selectate='[{$DOC,\"hash_sursa\":\"server\",$CONF}]' WHERE id=$HC" >/dev/null
deny 'payload client nu poate declara hash server' 2 "SELECT public.fn_ofertare_pf_inchide($HC)" 'PF: hash client SHA-256 fără confirmare umană validă'
ca 2 "UPDATE public.ofertare_pf_pachete SET documente_selectate='[{$DOC,\"hash_sursa\":\"client\",$CONF}]' WHERE id=$HC" >/dev/null
eq 'confirmatorul hash nu se poate falsifica' 00000000-0000-0000-0000-000000000002 "$(q "SELECT documente_selectate->0->>'hash_confirmat_de' FROM public.ofertare_pf_pachete WHERE id=$HC")"
eq 'istoric închis cu hash client confirmat' "$HC" "$(ca 2 "SELECT public.fn_ofertare_pf_inchide($HC)")"
HC2="$(ca 2 "SELECT public.fn_ofertare_pf_versiune_noua($HC,'Alt fus orar')")"
ca 2 "UPDATE public.ofertare_pf_valori SET confirmat_de=auth.uid(),confirmat_la=now() WHERE pachet_id=$HC2" >/dev/null
ca 2 "UPDATE public.ofertare_pf_valori SET valoare=-1.02 WHERE pachet_id=$HC2" >/dev/null
eq 'editarea fără reconfirmare șterge confirmarea veche' t "$(q "SELECT bool_and(confirmat_de IS NULL AND confirmat_la IS NULL) FROM public.ofertare_pf_valori WHERE pachet_id=$HC2")"
ca 2 "UPDATE public.ofertare_pf_valori SET confirmat_de=auth.uid(),confirmat_la=now() WHERE pachet_id=$HC2" >/dev/null
eq 'închidere cu alt fus orar' "$HC2" "$(ca 2 "SET LOCAL TIME ZONE 'Europe/Bucharest'; SELECT public.fn_ofertare_pf_inchide($HC2)")"
eq 'hash manifest stabil inclusiv timestamp confirmare' t "$(q "SELECT a.manifest_hash=b.manifest_hash FROM public.ofertare_pf_pachete a,public.ofertare_pf_pachete b WHERE a.id=$HC AND b.id=$HC2")"

# Hash-ul legacy din registru e text liber: comparat doar când e SHA-256 hex, normalizat (lower/btrim).
ALT=$(printf 'alt document' | sha256sum | cut -d' ' -f1)
q "UPDATE public.ofertare_formulare_registru SET fisier_hash='$ALT' WHERE id=2"
RDOC="[{\"registru_id\":2,\"fisier_path\":\"fixture/f2.pdf\",\"hash_algoritm\":\"sha256\",\"hash_valoare\":\"$HASH\",\"hash_sursa\":\"client\",\"hash_confirmat_de\":\"x\",\"hash_confirmat_la\":\"x\"}]"
L="$(ca 1 "INSERT INTO public.ofertare_pf_pachete(licitatie_id,versiune,eticheta,rol_oferta,instrument,documente_selectate) VALUES(2,1,'legacy','asociat','excel','$RDOC') RETURNING id")"
ca 1 "INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,valoare,sursa_registru_id,localizare,confirmat_de,confirmat_la) VALUES($L,'total_oferta','gazpet',5,2,'p1',auth.uid(),now())" >/dev/null
deny 'hash legacy SHA-256 diferit blochează închiderea' 1 "SELECT public.fn_ofertare_pf_inchide($L)" 'PF: hash client diferă de fișierul selectat în registru'
q "UPDATE public.ofertare_formulare_registru SET fisier_hash='  ${HASH^^} ' WHERE id=2"
eq 'hash legacy cu majuscule și spații = același SHA-256' "$L" "$(ca 1 "SELECT public.fn_ofertare_pf_inchide($L)")"
L2="$(ca 1 "SELECT public.fn_ofertare_pf_versiune_noua($L,'legacy text liber')")"
ca 1 "UPDATE public.ofertare_pf_valori SET confirmat_de=auth.uid(),confirmat_la=now() WHERE pachet_id=$L2" >/dev/null
q "UPDATE public.ofertare_formulare_registru SET fisier_hash='semnat olograf' WHERE id=2"
eq 'hash legacy non-hex nu blochează (proveniență necunoscută)' "$L2" "$(ca 1 "SELECT public.fn_ofertare_pf_inchide($L2)")"
eq 'manifestul păstrează hash-ul client, nu textul legacy' "$HASH" "$(q "SELECT manifest->0->>'hash_valoare' FROM public.ofertare_pf_pachete WHERE id=$L2")"

# Revenire pozitivă pe aceeași bază, după golire EXCLUSIV a fixture-ului sintetic.
q 'ALTER TABLE public.ofertare_pf_pachete DISABLE TRIGGER pf_pachet_garda; ALTER TABLE public.ofertare_pf_valori DISABLE TRIGGER pf_valoare_garda; DELETE FROM public.ofertare_pf_valori; DELETE FROM public.ofertare_pf_pachete; ALTER TABLE public.ofertare_pf_pachete ENABLE TRIGGER pf_pachet_garda; ALTER TABLE public.ofertare_pf_valori ENABLE TRIGGER pf_valoare_garda'
if "${PSQL[@]}" -d "$DB" --single-transaction -f "$REV" >"$TMP/rev-unarmed.log" 2>&1; then fail 'revenire nearmată'; fi
refuz 'revenire nearmată refuzată' "$TMP/rev-unarmed.log" 'REFUZ: revenire PF nearmată'
DR="$(ca 1 "INSERT INTO public.ofertare_pf_pachete(licitatie_id,$BASE) VALUES(1,$VAL) RETURNING id")"
ca 1 "INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,valoare,localizare) VALUES($DR,'total_oferta','gazpet',7,'p1')" >/dev/null
if rev >"$TMP/rev-draft.log" 2>&1; then fail 'revenire cu drafturi fără a doua armare'; fi
refuz 'drafturile de lucru cer a doua armare, separată, pentru date' "$TMP/rev-draft.log" 'cere armarea separată gazpet.rollback_tehnic_20261012a_date'
eq 'refuzul păstrează draftul și valoarea' '1|1' "$(q "SELECT (SELECT count(*) FROM public.ofertare_pf_pachete) || '|' || (SELECT count(*) FROM public.ofertare_pf_valori)")"
rev2 >"$TMP/rev.log" 2>&1 || { cat "$TMP/rev.log" >&2; fail 'revenire cu ambele armări'; }
eq 'revenire (ambele armări) elimină obiectele și rolul' '|0' "$(q "SELECT coalesce(to_regclass('public.ofertare_pf_pachete')::text,'') || '|' || (SELECT count(*) FROM pg_roles WHERE rolname='ofertare_pf_executor')")"

fi  # etapa S

# ============================================================================
# P. prod-like (modelul scripts/test_powpatroll_registry.sh secțiunea A): postgres NOSUPERUSER, ca în Supabase.
# ============================================================================
if [ "${PF_PRODLIKE:-1}" = 1 ]; then
  echo "== P. prod-like (bootstrap supabase_admin, postgres NOSUPERUSER CREATEROLE BYPASSRLS, port $PPORT) =="
  as_pg "$PG_BIN/initdb" -D "$PDATA" -U supabase_admin --auth=trust --encoding=UTF8 --locale=C.UTF-8 >"$TMP/pl-init.log"
  as_pg "$PG_BIN/pg_ctl" -D "$PDATA" -l "$TMP/pl-server.log" -w -t 30 start \
    -o "-p $PPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$TMP" >/dev/null
  PSTARTED=1
  SA=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PPORT" -U supabase_admin)
  PGU=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PPORT" -U postgres -d "$DB")
  plq() { "${PGU[@]}" -Atc "$1"; }
  "${SA[@]}" -d postgres >/dev/null <<'SQL'
CREATE ROLE postgres LOGIN NOSUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS INHERIT;
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT;
CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT CREATEROLE;
CREATE ROLE dashboard_user NOLOGIN NOINHERIT CREATEDB CREATEROLE REPLICATION;
GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO postgres;
SQL
  eq 'prod-like: postgres nu este superuser' 'f|t|t' "$("${SA[@]}" -d postgres -Atc "SELECT rolsuper || '|' || rolcreaterole || '|' || rolbypassrls FROM pg_roles WHERE rolname='postgres'" | sed 's/false/f/g;s/true/t/g')"
  # Schema auth EXACT ca pe live (preflight 03.10): owner supabase_admin, PUBLIC fără USAGE, postgres=U FĂRĂ grant option.
  # $1 = live: extensions al lui postgres (grant option pe digest, ca pe live);
  #      ext_fara_go: extensions al lui supabase_admin, postgres=U fără grant option ⇒ migrarea trebuie să refuze.
  pl_baza() {
    "${SA[@]}" -d postgres -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER postgres" >/dev/null
    local ext_owner=postgres ext_go='GRANT EXECUTE ON FUNCTION extensions.digest(text,text) TO postgres WITH GRANT OPTION;'
    if [ "$1" = ext_fara_go ]; then ext_owner=supabase_admin; ext_go='GRANT USAGE ON SCHEMA extensions TO postgres;'; fi
    "${SA[@]}" -d "$DB" >/dev/null <<SQL
CREATE SCHEMA auth AUTHORIZATION supabase_admin;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE, CREATE ON SCHEMA auth TO supabase_auth_admin, dashboard_user;
GRANT USAGE ON SCHEMA auth TO postgres;
$(sed -n '/^-- Corp IDENTIC cu auth.uid()/,/^\$function\$;/p' "$FIX")
CREATE TABLE auth.users(id uuid PRIMARY KEY);
GRANT SELECT, REFERENCES ON auth.users TO postgres;
CREATE SCHEMA extensions AUTHORIZATION $ext_owner;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
$ext_go
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
-- default privileges ale lui postgres în public, exact ca pe live (preflight 03.10)
-- (implicitul global al funcțiilor — EXECUTE pentru PUBLIC — rămâne; migrarea trebuie să-l revoce explicit)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO postgres, service_role;
SQL
    sed -n '/^-- @@APLICATIE/,$p' "$FIX" | "${PGU[@]}" -f - >"$TMP/pl-fixture.log" || fail 'prod-like: fixture-ul aplicației ca postgres'
  }
  pl_apply() { "${PGU[@]}" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare','$NAME:' || txid_current(),true)" -f "$MIG"; }
  pl_rev() {  # $1 = 2: și armarea pentru date
    if [ "${1:-}" = 2 ]; then "${PGU[@]}" --single-transaction -c "$ARM1" -c "$ARM2" -f "$REV"; else "${PGU[@]}" --single-transaction -c "$ARM1" -f "$REV"; fi
  }
  api() {  # $1 = 1..5 | anon | service_role ; $2 = SQL ; $3 = COMMIT|ROLLBACK
    local role=authenticated claims="{\"sub\":\"00000000-0000-0000-0000-00000000000$1\",\"role\":\"authenticated\"}"
    if [ "$1" = anon ] || [ "$1" = service_role ]; then role="$1"; claims="{\"role\":\"$1\"}"; fi
    "$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PPORT" -U authenticator -d "$DB" -At <<SQL
BEGIN;
SELECT set_config('request.jwt.claims','$claims',true) \g /dev/null
SET LOCAL ROLE $role;
$2;
${3:-COMMIT};
SQL
  }
  pl_deny() {
    local label="$1" who="$2" sql="$3" motiv="$4"
    if api "$who" "$sql" ROLLBACK >"$TMP/pl-deny.log" 2>&1; then fail "prod-like: $label: operație acceptată"; fi
    grep -qF -- "$motiv" "$TMP/pl-deny.log" || fail "prod-like: $label: refuz din alt motiv: $(grep -m1 -E 'ERROR|FATAL' "$TMP/pl-deny.log")"
    pass "prod-like: $label"
  }
  pl_gate() { "${PGU[@]}" -At -f "$GATE" >"$TMP/pl-gate.log" 2>&1 || { cat "$TMP/pl-gate.log" >&2; fail 'prod-like: gate 0e nu a rulat'; }; grep -c . "$TMP/pl-gate.log" || true; }
  pl_stare() { plq "SELECT (SELECT count(*) FROM pg_roles WHERE rolname='ofertare_pf_executor') || '|' || coalesce(to_regclass('public.ofertare_pf_pachete')::text,'')"; }

  # P1. extensions fără GRANT OPTION: GRANT-ul către executor dă doar WARNING ⇒ postcondiția refuză tot (fail-closed).
  pl_baza ext_fara_go
  if pl_apply >"$TMP/pl-nogo.log" 2>&1; then fail 'prod-like: fără GRANT OPTION pe extensions migrarea trebuia refuzată'; fi
  refuz 'prod-like: fără GRANT OPTION pe extensions ⇒ refuz fail-closed' "$TMP/pl-nogo.log" 'REFUZ: executorul PF nu poate folosi'
  eq 'prod-like: refuzul nu lasă rol sau tabele' '0|' "$(pl_stare)"

  # P2. Configurația live: schema auth fără grant option pentru postgres.
  pl_baza live
  eq 'prod-like: ACL schema auth = live (PUBLIC fără USAGE, postgres=U fără grant option)' \
    'anon=USAGE,authenticated=USAGE,dashboard_user=CREATE,dashboard_user=USAGE,postgres=USAGE,service_role=USAGE,supabase_admin=CREATE,supabase_admin=USAGE,supabase_auth_admin=CREATE,supabase_auth_admin=USAGE|f' \
    "$(plq "SELECT (SELECT string_agg(coalesce(pg_get_userbyid(nullif(a.grantee,0)),'PUBLIC') || '=' || a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END, ',' ORDER BY coalesce(pg_get_userbyid(nullif(a.grantee,0)),'PUBLIC') COLLATE \"C\", a.privilege_type COLLATE \"C\") FROM pg_namespace n, aclexplode(n.nspacl) a WHERE n.nspname='auth') || '|' || has_schema_privilege('postgres','auth','USAGE WITH GRANT OPTION')" | sed 's/|false$/|f/;s/|true$/|t/')"
  eq 'prod-like: auth.uid() cu corpul live (md5) și EXECUTE pentru PUBLIC' 'cdef18c69c4f4cbbced2eaf81e628b49|t' "$(plq "SELECT md5(prosrc) || '|' || has_function_privilege('public', 'auth.uid()', 'EXECUTE') FROM pg_proc WHERE oid='auth.uid()'::regprocedure" | sed 's/|true$/|t/;s/|false$/|f/')"
  eq 'prod-like: default ACL postgres/public = live (S, f; r cu anon/authenticated arwdxt)' '{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}|{postgres=X/postgres,service_role=X/postgres}|t' \
    "$(plq "SELECT (SELECT defaclacl::text FROM pg_default_acl WHERE defaclrole='postgres'::regrole AND defaclnamespace='public'::regnamespace AND defaclobjtype='S') || '|' || (SELECT defaclacl::text FROM pg_default_acl WHERE defaclrole='postgres'::regrole AND defaclnamespace='public'::regnamespace AND defaclobjtype='f') || '|' || (SELECT defaclacl::text LIKE '{postgres=arwdDxt%/postgres,anon=arwdxt/postgres,authenticated=arwdxt/postgres,service_role=arwdDxt%/postgres}' FROM pg_default_acl WHERE defaclrole='postgres'::regrole AND defaclnamespace='public'::regnamespace AND defaclobjtype='r')" | sed 's/|true$/|t/;s/|false$/|f/')"
  pl_apply >"$TMP/pl-mig.log" 2>&1 || { cat "$TMP/pl-mig.log" >&2; fail 'prod-like: migrarea ca postgres NOSUPERUSER'; }
  pass 'prod-like: migrare aplicată ca postgres NOSUPERUSER pe ACL-ul live auth, toate postcondițiile (ACL exact) trec'
  eq 'prod-like: executorul nu are USAGE pe auth' f "$(plq "SELECT has_schema_privilege('ofertare_pf_executor','auth','USAGE')" | sed 's/^false$/f/;s/^true$/t/')"
  for w in anon:anon 1:authenticated service_role:service_role; do
    pl_deny "${w#*:} nu execută wrapper-ul uid" "${w%%:*}" 'SELECT public.fn_ofertare_pf_uid()' 'permission denied for function fn_ofertare_pf_uid'
  done
  if pl_apply >"$TMP/pl-reapply.log" 2>&1; then fail 'prod-like: reaplicare'; fi
  refuz 'prod-like: reaplicare refuzată' "$TMP/pl-reapply.log" 'REFUZ: obiect PF sau rol executor deja existent'
  eq 'prod-like: membership postgres→executor cu INHERIT și SET (acordat de postgres)' 1 "$(plq "SELECT count(*) FROM pg_auth_members WHERE roleid='ofertare_pf_executor'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole AND inherit_option AND set_option")"
  eq 'prod-like: anon/service_role fără drepturi pe tabele, view, secvențe, RPC (sub default privileges)' 'f|f|f|f|f|f|f|f' "$(plq "SELECT concat_ws('|', has_table_privilege('anon','public.ofertare_pf_pachete','SELECT'), has_table_privilege('service_role','public.ofertare_pf_pachete','SELECT'), has_table_privilege('service_role','public.ofertare_pf_valori','SELECT'), has_table_privilege('service_role','public.v_ofertare_pf_control','SELECT'), has_sequence_privilege('authenticated','public.ofertare_pf_pachete_id_seq','USAGE'), has_sequence_privilege('service_role','public.ofertare_pf_valori_id_seq','USAGE'), has_function_privilege('service_role','public.fn_ofertare_pf_inchide(bigint)','EXECUTE'), has_function_privilege('anon','public.fn_poate_citi_pf()','EXECUTE'))" | sed 's/false/f/g;s/true/t/g')"
  eq 'prod-like: gate 0e = 0 rânduri' 0 "$(pl_gate)"

  # P3. Smoke prin identitatea PostgREST (session_user = authenticator).
  PP="$(api 1 "INSERT INTO public.ofertare_pf_pachete(licitatie_id,versiune,eticheta,rol_oferta,instrument,documente_selectate) VALUES(1,1,'prod-like','ofertant_unic','excel','[{\"registru_id\":1}]') RETURNING id")"
  pass 'prod-like: owner creează draft'
  api 2 "INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,valoare,sursa_registru_id,localizare,confirmat_de,confirmat_la) VALUES($PP,'total_oferta','gazpet',100,1,'p1',auth.uid(),now())" >/dev/null
  pass 'prod-like: PF editor scrie valoare confirmată'
  pl_deny 'PF viewer nu scrie valori' 5 "INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,valoare,localizare) VALUES($PP,'platibil','gazpet',1,'p1')" 'PF: pachet inexistent sau fără drept de scriere PF'
  pl_deny 'anon nu citește' anon 'SELECT count(*) FROM public.ofertare_pf_pachete' 'permission denied for table ofertare_pf_pachete'
  pl_deny 'service_role nu citește valorile' service_role 'SELECT count(*) FROM public.ofertare_pf_valori' 'permission denied for table ofertare_pf_valori'
  pl_deny 'authenticated nu consumă secvența' 1 "SELECT nextval('public.ofertare_pf_valori_id_seq')" 'permission denied for sequence ofertare_pf_valori_id_seq'
  pl_deny 'authenticated nu poate deveni executor' 1 'SET LOCAL ROLE ofertare_pf_executor' 'permission denied to set role "ofertare_pf_executor"'
  eq 'prod-like: închidere prin RPC (executor: wrapper uid + digest)' "$PP" "$(api 2 "SELECT public.fn_ofertare_pf_inchide($PP)")"
  eq 'prod-like: inchis_de = sub-ul din request.jwt.claims al apelantului (nu ownerul)' "00000000-0000-0000-0000-000000000002" "$(plq "SELECT inchis_de FROM public.ofertare_pf_pachete WHERE id=$PP")"
  eq 'prod-like: manifest_hash SHA-256 server' t "$(plq "SELECT manifest_hash ~ '^[0-9a-f]{64}\$' AND manifest_hash=encode(extensions.digest(manifest::text,'sha256'),'hex') FROM public.ofertare_pf_pachete WHERE id=$PP")"
  PP2="$(api 1 "SELECT public.fn_ofertare_pf_versiune_noua($PP,'prod-like v2')")"
  eq 'prod-like: versiune nouă cu filiație' "$PP" "$(plq "SELECT inlocuieste_id FROM public.ofertare_pf_pachete WHERE id=$PP2")"
  eq 'prod-like: versiune nouă created_by/updated_by = apelantul (trigger ca executor)' "00000000-0000-0000-0000-000000000001|00000000-0000-0000-0000-000000000001" "$(plq "SELECT created_by || '|' || updated_by FROM public.ofertare_pf_pachete WHERE id=$PP2")"
  eq 'prod-like: grafic fără activități = false' t "$(api 2 "SELECT bool_and(grafic_are_activitati IS FALSE) FROM public.v_ofertare_pf_control WHERE pachet_id=$PP2")"
  plq "INSERT INTO public.grafic_activitati(licitatie_id,denumire,valoare_lei) VALUES (1,'Prod-like',1)" >/dev/null
  eq 'prod-like: grafic cu activități = true pentru PF fără Ofertare' t "$(api 2 "SELECT bool_and(grafic_are_activitati) FROM public.v_ofertare_pf_control WHERE pachet_id=$PP2")"
  eq 'prod-like: gate 0e după smoke = 0 rânduri' 0 "$(pl_gate)"

  # P4. Revenirea ca postgres nesuperuser: refuz cu date înghețate, a doua armare pentru drafturi, apoi reaplicare.
  if pl_rev 2 >"$TMP/pl-rev-inchis.log" 2>&1; then fail 'prod-like: revenire cu versiuni închise'; fi
  refuz 'prod-like: revenire refuzată cu versiuni închise' "$TMP/pl-rev-inchis.log" 'REFUZ: există versiuni închise sau înlocuite'
  plq 'ALTER TABLE public.ofertare_pf_pachete DISABLE TRIGGER pf_pachet_garda; ALTER TABLE public.ofertare_pf_valori DISABLE TRIGGER pf_valoare_garda; DELETE FROM public.ofertare_pf_valori; DELETE FROM public.ofertare_pf_pachete; ALTER TABLE public.ofertare_pf_pachete ENABLE TRIGGER pf_pachet_garda; ALTER TABLE public.ofertare_pf_valori ENABLE TRIGGER pf_valoare_garda' >/dev/null
  api 1 "INSERT INTO public.ofertare_pf_pachete(proiect_id,versiune,eticheta,rol_oferta,instrument) VALUES(1,1,'draft','asociat','excel')" >/dev/null
  if pl_rev >"$TMP/pl-rev-draft.log" 2>&1; then fail 'prod-like: revenire cu draft fără a doua armare'; fi
  refuz 'prod-like: draftul cere a doua armare' "$TMP/pl-rev-draft.log" 'cere armarea separată gazpet.rollback_tehnic_20261012a_date'
  pl_rev 2 >"$TMP/pl-rev.log" 2>&1 || { cat "$TMP/pl-rev.log" >&2; fail 'prod-like: revenire ca postgres NOSUPERUSER'; }
  eq 'prod-like: revenirea (ca postgres NOSUPERUSER) șterge rolul și tabelele' '0|' "$(pl_stare)"
  pl_apply >"$TMP/pl-mig2.log" 2>&1 || { cat "$TMP/pl-mig2.log" >&2; fail 'prod-like: reaplicare după revenire'; }
  pass 'prod-like: reaplicare după revenire'
  eq 'prod-like: gate 0e după reaplicare = 0 rânduri' 0 "$(pl_gate)"
fi
pass "test_ofertare_pf (sha256 $(sha256sum "$MIG" | cut -d' ' -f1))"
