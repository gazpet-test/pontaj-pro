#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Test PG16 LOCAL pentru patch-ul 20261003b (Ofertare (2)+(3)), runda 4. Nu atinge Supabase.
# Runda 4 (verdict Copilot r3, docs §12): migrarea pornește doar din live|patch (8-R4-1); privilegii efective în
# starea completă (0g, 8-R4-2, 9 R4-2); eroare după primul REVOKE/GRANT (7-R4-5, 8-R4-5); pas 14: conexiuni
# existente, apel în curs suspendat determinist, protecțiile patch-ului după repornire.
#   bash scripts/test_sec_ofertare.sh              # rulează tot și oprește clusterul la final
#   KEEP=1 bash scripts/test_sec_ofertare.sh       # lasă clusterul pornit (depanare)
#   PGPORT=5491 PGBASE=/tmp/pg_x bash …            # alt port / alt cluster (implicit 5441, /tmp/pg_sec_ofertare)
#   MIG=… RB=… OPR=… TEST=… bash …                 # alte fișiere (analiza de mutanți pe fișiere)
#   PATCH_H="<alege> <pereche>" bash …             # alt md5(prosrc) al patch-ului (doar mutanți pe corpuri)
#   STATIC=0 bash …                                # sare pasul 0 (static), ca un mutant să fie prins de testul dinamic
# Cluster dedicat: PGDATA $PGBASE/data, doar 127.0.0.1, baza sec_ofertare_test.
#
# Ce demonstrează (răspunsul la NO-GO-ul Copilot pe 94909d6, docs §11):
#   • stări COMPLETE (helper + alege + pereche, md5(prosrc) + atribute + ACL): migrarea pornește din
#     live | patch (runda 4: NU din oprire); rollback-ul din patch | oprire | live; oprirea doar din patch. Orice stare
#     mixtă sau atribut schimbat → refuz, fără urme (pas 9);
#   • postcondiția înainte de COMMIT în fiecare fișier (pas 6, 7, 8, 11, 12);
#   • UN SINGUR gestionar al tranzacției = runner-ul, pentru toate fișierele (niciunul n-are BEGIN/COMMIT;
#     fiecare e un singur bloc DO). Migrarea se livrează DOAR prin scripts/livrare_migrare.sh (traseul
#     comun cu #538: psql --single-transaction = marcaj de livrare legat de txid + migrare + INSERT în
#     supabase_migrations.schema_migrations); gărzile din migrare refuză orice alt runner (psql -f simplu,
#     simple query, BEGIN;…;COMMIT; ca execute_sql/apply_migration). Revenirile: stringul documentat
#     BEGIN; set_config(comutator, VALOARE:txid, true); fișier; COMMIT;
#   • T1 (Copilot): eroare injectată după prima înlocuire de funcție → definițiile inițiale rămân, nimic
#     înregistrat (pas 3 din live, pas 8 din oprire);
#   • T3 (Copilot, #538 r3): eroare injectată CHIAR la INSERT-ul în schema_migrations, după postcondiții
#     și garda de final → starea inițială + nicio înregistrare; reluarea după succes e refuzată;
#   • T2 (Copilot): armare + eroare + ROLLBACK → reluarea fără armare nouă e refuzată (pas 7, 11), plus
#     variantele: set_config(…, false) în tranzacția eșuată, armare de sesiune rămasă (alt txid), SET vechi.
# Nicio listă de amprente nu se actualizează automat: harness-ul doar VERIFICĂ listele din fișiere.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGPORT="${PGPORT:-5441}"
BASE="${PGBASE:-/tmp/pg_sec_ofertare}"
PGDATA="$BASE/data"
LOG="$BASE/server.log"
DB=sec_ofertare_test
MIG="${MIG:-$ROOT/supabase/migrations/20261003b_sec_ofertare_porti_alege_inventar.sql}"
RB="${RB:-$ROOT/supabase/revenire/20261003b_sec_ofertare_porti_alege_inventar_ROLLBACK.sql}"
OPR="${OPR:-$ROOT/supabase/revenire/20261003b_sec_ofertare_porti_alege_inventar_OPRIRE_CONTROLATA.sql}"
REP="${REP:-$ROOT/supabase/revenire/20261003b_sec_ofertare_porti_alege_inventar_REPORNIRE.sql}"
LIVRARE="${LIVRARE:-$ROOT/scripts/livrare_migrare.sh}"
TEST="${TEST:-$ROOT/supabase/tests/sec_ofertare_porti.test.sql}"
# Comutatoarele revenirilor; valoarea cerută de fișier = '<VALOARE>:' || txid_current()
C_RB=gazpet.rollback_tehnic_20261003b;   V_RB=REDESCHIDE_BYPASS
C_OP=gazpet.oprire_controlata_20261003b; V_OP=OPRESTE_ALEGE_SI_PERECHE
C_RP=gazpet.repornire_20261003b;         V_RP=REPORNESTE_ALEGE_SI_PERECHE
# md5(prosrc) = md5 al textului literal al corpului. Live: citit read-only de coordonator (PG 17.6).
H_ACCES=429d28e2a61fb24c8009d67050c16c85
LIVE_H="56a7c6ddd1e342c77e7b34f4e08ecab1 edd4819c81844baafc7eeade838cbcff"
PATCH_H="${PATCH_H:-51865b69766f6baa53def9a6e6c6232b 4d90bf90b4bbfd6aea944e734f6c9ed9}"
ACL_DESCHIS='{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'
ACL_OPRIT='{postgres=X/postgres}'
# Privilegii EFECTIVE (runda 4): has_function_privilege, cu moștenirea prin roluri
EF_DESCHIS='anon=f public=f authenticated=t service_role=t'
EF_OPRIT='anon=f public=f authenticated=f service_role=f'
NUME_MIG=20261003b_sec_ofertare_porti_alege_inventar

for f in "$MIG" "$RB" "$OPR" "$REP" "$LIVRARE" "$TEST"; do [ -f "$f" ] || { echo "Lipsește $f" >&2; exit 2; }; done
[ -x "$PGBIN/postgres" ] || { echo "PostgreSQL 16 lipsește în $PGBIN" >&2; exit 2; }

ca_pg() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U postgres)
PSQL0=("$PGBIN/psql" -X -h 127.0.0.1 -p "$PGPORT" -U postgres -d "$DB")   # „runner”: fără -q, fără ON_ERROR_STOP implicit
N_OK=0
pas() { printf '\n\033[1m── %s\033[0m\n' "$*"; }
esec() { printf '\n\033[31mEȘEC: %s\033[0m\n' "$*" >&2; exit 1; }
ok() { N_OK=$((N_OK + 1)); echo "  OK  $*"; }
primul_esec() { sed -n 's/.*TEST EȘUAT: //p' "$1" | sed 's/ — .*//' | head -1; }
faza() {  # faza <nume> [doar]: fază din fișierul de test; numără verificările OK
  local rc=0
  "${PSQL[@]}" -d "$DB" -o /dev/null -v faza="$1" ${2:+-v doar="$2"} -f "$TEST" >"$BASE/faza.out" 2>&1 || rc=$?
  sed 's/^psql:[^ ]* NOTICE:  /  /; s/^NOTICE:  /  /' "$BASE/faza.out"
  [ "$rc" = 0 ] && N_OK=$((N_OK + $(grep -c 'NOTICE:  OK ' "$BASE/faza.out" || true)))
  return "$rc"
}
faza_pica() {  # faza_pica <nume> [doar] → 0 dacă faza CADE pe o aserțiune (TEST EȘUAT), 1 dacă trece
  if "${PSQL[@]}" -d "$DB" -o /dev/null -v faza="$1" ${2:+-v doar="$2"} -f "$TEST" >"$BASE/vacuu.out" 2>&1; then return 1; fi
  grep -q "TEST EȘUAT" "$BASE/vacuu.out" || { cat "$BASE/vacuu.out" >&2; esec "faza $1 ${2:-} a căzut din alt motiv decât o aserțiune"; }
}
sql() { "${PSQL[@]}" -d "$DB" -Atc "$1"; }
sql_pg() { "${PSQL[@]}" -d postgres -c "$1" >/dev/null; }

# Amprenta harness-ului (independentă de interogarea din fișiere): pentru fiecare funcție md5(prosrc),
# md5(pg_get_functiondef), toate atributele, ACL-ul sortat, câte funcții cu același nume.
AMPRENTA_SQL="SELECT string_agg(format('%s prosrc=%s def=%s secdef=%s lang=%s vol=%s strict=%s leak=%s par=%s cost=%s rows=%s owner=%s cfg=%s args=(%s) rez=%s acl=%s n=%s',
   f.fn, md5(p.prosrc), md5(pg_get_functiondef(p.oid)), p.prosecdef, l.lanname, p.provolatile, p.proisstrict, p.proleakproof, p.proparallel,
   p.procost, p.prorows, pg_get_userbyid(p.proowner), p.proconfig, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
   (SELECT array_agg(a::text ORDER BY a::text COLLATE \"C\") FROM unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a),
   (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = f.nume))
   || format(' efectiv=anon:%s,public:%s,authenticated:%s,service_role:%s', has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('public', p.oid, 'EXECUTE'),
             has_function_privilege('authenticated', p.oid, 'EXECUTE'), has_function_privilege('service_role', p.oid, 'EXECUTE')), E'\n' ORDER BY f.ord)
 FROM (VALUES (1, 'acces', 'fn_are_acces_ofertare', 'public.fn_are_acces_ofertare()'),
              (2, 'alege', 'fn_ofertare_alege_acoperire', 'public.fn_ofertare_alege_acoperire(bigint)'),
              (3, 'pereche', 'ofertare_inventar_pereche', 'public.ofertare_inventar_pereche(bigint,text,integer,real)')) f(ord, fn, nume, sig)
 LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.sig) LEFT JOIN pg_language l ON l.oid = p.prolang"
amprenta() { sql "$AMPRENTA_SQL"; }
urme() { amprenta; sql "SELECT 'schema_migrations: ' || count(*) || ' ' || coalesce(string_agg(version, ',' ORDER BY version), '') FROM supabase_migrations.schema_migrations"; }
# Scurt: md5(prosrc) alege pereche | ACL alege | ACL pereche | md5(prosrc) helper
scurt() { sql "SELECT string_agg(md5(p.prosrc), ' ' ORDER BY f.o) FILTER (WHERE f.o > 1) || ' | ' || string_agg((SELECT array_agg(a::text ORDER BY a::text COLLATE \"C\") FROM unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a)::text, ' | ' ORDER BY f.o) FILTER (WHERE f.o > 1) || ' | ' || max(md5(p.prosrc)) FILTER (WHERE f.o = 1)
  FROM (VALUES (1, 'public.fn_are_acces_ofertare()'), (2, 'public.fn_ofertare_alege_acoperire(bigint)'), (3, 'public.ofertare_inventar_pereche(bigint,text,integer,real)')) f(o, sig)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.sig)"; }
salveaza_stare() { amprenta >"$BASE/amp_$1"; }
e_stare() {  # e_stare <live|patch|oprire> <eticheta>: amprenta completă = cea salvată când starea a fost validată
  local x; x=$(amprenta)
  [ "$x" = "$(cat "$BASE/amp_$1")" ] || { diff <(cat "$BASE/amp_$1") <(echo "$x") >&2 || true; esec "$2: starea nu e exact „$1”"; }
  ok "$2: starea = „$1” (amprentă completă)"
}
n_migrari() { sql "SELECT count(*) FROM supabase_migrations.schema_migrations"; }

# ── Runner-e ─────────────────────────────────────────────────────────────────
livrare() {  # livrare <fișier> <versiune>: traseul OFICIAL (scripts/livrare_migrare.sh), cu fișierul copiat sub numele migrării
  mkdir -p "$BASE/livr"; cp "$1" "$BASE/livr/$NUME_MIG.sql"
  # Runner comun ed7ecb0 (GO Copilot R9): sha256 aprobat + țintă explicită (db, system_identifier, host, port).
  local sis; sis="$("$PGBIN/psql" -X -Atq -h 127.0.0.1 -p "$PGPORT" -U postgres -d "$DB" -c "SELECT system_identifier FROM pg_control_system()")"
  PSQL_BIN="$PGBIN/psql" bash "$LIVRARE" --migrare "$BASE/livr/$NUME_MIG.sql" --sha256 "$(sha256sum "$BASE/livr/$NUME_MIG.sql" | cut -d' ' -f1)" \
    --versiune "$2" --tinta-db "$DB" --tinta-sistem "$sis" --tinta-host 127.0.0.1 --tinta-port "$PGPORT" --user postgres
}
# Runner comun ed7ecb0: pre-verificarea refuză (CONFLICT) orice livrare când migrarea e deja înregistrată, ÎNAINTE de a trimite
# fișierul. Ca postcondiția să fie exercitată pe o variantă (faza 6), rândul din istoric e scos temporar și pus la loc identic.
livrare_fara_inreg() {
  sql "CREATE TABLE t.bk_inreg AS SELECT * FROM supabase_migrations.schema_migrations WHERE name = '$NUME_MIG'; DELETE FROM supabase_migrations.schema_migrations WHERE name = '$NUME_MIG'" >/dev/null
  local rc=0; livrare "$@" || rc=$?
  sql "INSERT INTO supabase_migrations.schema_migrations SELECT * FROM t.bk_inreg; DROP TABLE t.bk_inreg" >/dev/null
  return $rc
}
ins_sql() { printf "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('%s', '%s', ARRAY[%s]);" \
  "$2" "$NUME_MIG" "\$stmt_20261003b\$$(cat "$1")\$stmt_20261003b\$"; }
# Runner-e NEOFICIALE (trebuie refuzate de garda de livrare): psql -f simplu; simple query; BEGIN;…;COMMIT; cu INSERT (ca execute_sql/apply_migration)
runner_psql_f() { "${PSQL0[@]}" -v ON_ERROR_STOP=1 -f "$1"; }
runner_query()  { "${PSQL0[@]}" -v ON_ERROR_STOP=1 -c "$(cat "$1")"; }
runner_string() { "${PSQL0[@]}" -v ON_ERROR_STOP=1 -c "$(printf 'BEGIN;\n%s\n%s\nCOMMIT;' "$(cat "$1")" "$(ins_sql "$1" 20261003999997)")"; }
sir_revenire() {  # sir_revenire <fișier> <comutator> <valoare> [is_local]: stringul documentat pentru reveniri
  printf "BEGIN;\nSELECT set_config('%s', '%s:' || txid_current(), %s);\n%s\nCOMMIT;" "$2" "$3" "${4:-true}" "$(cat "$1")"
}
revenire() { "${PSQL0[@]}" -v ON_ERROR_STOP=1 -c "$(sir_revenire "$@")"; }
fara_armare() { "${PSQL0[@]}" -v ON_ERROR_STOP=1 -c "$(printf 'BEGIN;\n%s\nCOMMIT;' "$(cat "$1")")"; }
armare_separata() {  # armarea corectă, dar în ALTĂ tranzacție (două -c pe aceeași conexiune)
  "${PSQL0[@]}" -v ON_ERROR_STOP=1 -c "SELECT set_config('$2', '$3:' || txid_current(), true)" -c "$(printf 'BEGIN;\n%s\nCOMMIT;' "$(cat "$1")")"
}
armare_fara_txid() { "${PSQL0[@]}" -v ON_ERROR_STOP=1 -c "$(printf "BEGIN;\nSELECT set_config('%s', '%s', true);\n%s\nCOMMIT;" "$2" "$3" "$(cat "$1")")"; }

refuzat() {  # refuzat <eticheta> <fragment> <comanda…>: TREBUIE să cadă, cu mesajul dat, fără urme
  local et="$1" frag="$2"; shift 2
  local inainte; inainte=$(urme)
  if "$@" >"$BASE/ref.out" 2>&1; then cat "$BASE/ref.out" >&2; esec "$et: a trecut, trebuia refuzat"; fi
  grep -q -- "$frag" "$BASE/ref.out" || { cat "$BASE/ref.out" >&2; esec "$et: refuzat, dar fără mesajul „$frag”"; }
  [ "$(urme)" = "$inainte" ] || { diff <(echo "$inainte") <(urme) >&2 || true; esec "$et: refuzul a lăsat urme"; }
  ok "$et [$(grep -m1 -o -- "$frag" "$BASE/ref.out")…]"
}
injecteaza() {  # injecteaza <fișier> <regex linie> <text> <ieșire>: text inserat după PRIMA linie potrivită
  awk -v re="$2" -v txt="$3" '{ print } !gata && $0 ~ re { print txt; gata = 1 }' "$1" >"$4"
  [ "$(grep -cxF -- "$3" "$4")" = 1 ] || esec "mutant neinjectat în $4 ($2)"
}
mutant_t1() {  # PERFORM 1/0 imediat după PRIMA înlocuire de funcție (EXECUTE $def_alege$ … $def_alege$;) — T1
  injecteaza "$1" '^\$def_alege\$;$' '  PERFORM 1/0;  -- EROARE INJECTATĂ (T1)' "$2"
  local l; l=$(grep -n 'EROARE INJECTATĂ (T1)' "$2" | cut -d: -f1)
  [ "$(head -n "$l" "$2" | grep -c 'EXECUTE \$def_')" = 1 ] && [ "$(grep -c 'EXECUTE \$def_' "$2")" = 2 ] \
    || esec "T1: eroarea nu e între prima și a doua înlocuire de funcție"
}
curata_persistente() {  # ALTER ROLE e la nivel de cluster: supraviețuiește recreării bazei
  # runda 4: și apartenențele la roluri create de testele de moștenire (tot la nivel de cluster)
  sql_pg "DO \$m\$ DECLARE r record; BEGIN
    FOR r IN SELECT g.rolname AS grup, m.rolname AS membru FROM pg_auth_members am JOIN pg_roles g ON g.oid = am.roleid JOIN pg_roles m ON m.oid = am.member
              WHERE m.rolname IN ('anon', 'authenticated', 'service_role') LOOP
      EXECUTE format('REVOKE %I FROM %I', r.grup, r.membru);
    END LOOP; END \$m\$"
  sql_pg "DO \$c\$ DECLARE r record; BEGIN
    FOR r IN SELECT d.datname, ro.rolname, split_part(c, '=', 1) AS nume
               FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) c
               LEFT JOIN pg_database d ON d.oid = s.setdatabase LEFT JOIN pg_roles ro ON ro.oid = s.setrole
              WHERE lower(split_part(c, '=', 1)) LIKE 'gazpet.%' LOOP
      IF r.datname IS NULL THEN EXECUTE format('ALTER ROLE %I RESET %I', r.rolname, r.nume);
      ELSIF r.rolname IS NULL THEN EXECUTE format('ALTER DATABASE %I RESET %I', r.datname, r.nume);
      ELSE EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET %I', r.rolname, r.datname, r.nume); END IF;
    END LOOP; END \$c\$"
}

# T2 și variantele: o SINGURĂ sesiune psql (mai multe -c pe aceeași conexiune), ca starea de sesiune să persiste.
t2_familie() {  # t2_familie <eticheta> <fișier> <mutant cu eroare> <comutator> <valoare> <fragment refuz armare>
  local et="$1" f="$2" m="$3" c="$4" v="$5" frag="$6" inainte lerr lref
  inainte=$(urme)
  # T2 (Copilot): armare după BEGIN (set_config local) + eroare + ROLLBACK → reluare fără armare nouă
  "${PSQL0[@]}" -q -At -c "$(sir_revenire "$m" "$c" "$v")" -c "ROLLBACK" \
     -c "SELECT 'dupa_rollback=[' || coalesce(current_setting('$c', true), '') || ']'" \
     -c "$(printf 'BEGIN;\n%s\nCOMMIT;' "$(cat "$f")")" -c "ROLLBACK" >"$BASE/t2.out" 2>"$BASE/t2.err" || true
  lerr=$(grep -m1 -n "division by zero" "$BASE/t2.err" | cut -d: -f1); lref=$(grep -m1 -n -- "$frag" "$BASE/t2.err" | cut -d: -f1)
  { [ -n "$lerr" ] && [ -n "$lref" ] && [ "$lerr" -lt "$lref" ]; } || { cat "$BASE/t2.err" >&2; esec "$et T2: armare+eroare+ROLLBACK, apoi reluarea fără armare nouă NU a fost refuzată"; }
  grep -qx 'dupa_rollback=\[\]' "$BASE/t2.out" || { cat "$BASE/t2.out" >&2; esec "$et T2: comutatorul a rămas armat după ROLLBACK"; }
  [ "$(urme)" = "$inainte" ] || esec "$et T2: eroarea sau reluarea au lăsat urme"
  ok "$et T2 (Copilot): armare după BEGIN + eroare injectată + ROLLBACK → nimic schimbat; reluarea fără armare nouă → refuz"
  # T2b: armare de SESIUNE (set_config(…, false)) în tranzacția eșuată → reluare → refuz
  "${PSQL0[@]}" -q -At -c "$(sir_revenire "$m" "$c" "$v" false)" -c "ROLLBACK" \
     -c "$(printf 'BEGIN;\n%s\nCOMMIT;' "$(cat "$f")")" -c "ROLLBACK" >"$BASE/t2.out" 2>"$BASE/t2.err" || true
  { grep -q 'division by zero' "$BASE/t2.err" && grep -q -- "$frag" "$BASE/t2.err"; } || { cat "$BASE/t2.err" >&2; esec "$et T2b: reluarea după armare de sesiune într-o tranzacție eșuată NU a fost refuzată"; }
  [ "$(urme)" = "$inainte" ] || esec "$et T2b: urme"
  ok "$et T2b: set_config(…, false) într-o tranzacție eșuată + reluare fără armare nouă → refuz"
  # T2c: armare de sesiune rămasă (comisă ÎNAINTEA tranzacției, alt txid) → refuz, deși valoarea e în sesiune
  "${PSQL0[@]}" -q -At -c "SELECT set_config('$c', '$v:' || txid_current(), false)" \
     -c "SELECT 'in_sesiune=' || current_setting('$c', true)" \
     -c "$(printf 'BEGIN;\n%s\nCOMMIT;' "$(cat "$f")")" -c "ROLLBACK" >"$BASE/t2.out" 2>"$BASE/t2.err" || true
  grep -q "^in_sesiune=$v:[0-9]" "$BASE/t2.out" || { cat "$BASE/t2.out" >&2; esec "$et T2c: armarea de sesiune nu s-a văzut"; }
  grep -q -- "$frag" "$BASE/t2.err" || { cat "$BASE/t2.err" >&2; esec "$et T2c: armarea de sesiune rămasă (alt txid) NU a fost refuzată"; }
  [ "$(urme)" = "$inainte" ] || esec "$et T2c: urme"
  ok "$et T2c: armare de sesiune rămasă în conexiune ($(grep '^in_sesiune=' "$BASE/t2.out" | cut -d= -f2), alt txid) → refuz"
  # T2d: SET de sesiune în stilul rundei 2 (fără txid), comandă separată înaintea tranzacției → refuz
  "${PSQL0[@]}" -q -At -c "SET $c = '$v'" -c "$(printf 'BEGIN;\n%s\nCOMMIT;' "$(cat "$f")")" >"$BASE/t2.out" 2>"$BASE/t2.err" || true
  grep -q -- "$frag" "$BASE/t2.err" || { cat "$BASE/t2.err" >&2; esec "$et T2d: SET de sesiune fără txid NU a fost refuzat"; }
  [ "$(urme)" = "$inainte" ] || esec "$et T2d: urme"
  ok "$et T2d: SET de sesiune înaintea tranzacției (stilul rundei 2) → refuz"
}
vg1() {  # vg1 <eticheta> <fișier> <comutator> <valoare>: armare PERSISTENTĂ → refuz, chiar cu armarea corectă în tranzacție
  sql_pg "ALTER DATABASE $DB SET $3 = '$4:1'"
  [ "$(sql "SELECT current_setting('$3', true)")" = "$4:1" ] || esec "$1 VG1: armarea persistentă nu s-a văzut într-o sesiune nouă"
  refuzat "$1 VG1 ALTER DATABASE SET + armarea corectă în tranzacție" "armat PERSISTENT" revenire "$2" "$3" "$4"
  sql_pg "ALTER DATABASE $DB RESET $3"
  local mare; mare=$(echo "$3" | sed 's/^gazpet\./GAZPET./; s/_\([a-z]\)/_\U\1/')
  sql_pg "ALTER ROLE postgres SET \"$mare\" = '$4:1'"
  refuzat "$1 VG1 ALTER ROLE SET \"$mare\" (majuscule)" "armat PERSISTENT" revenire "$2" "$3" "$4"
  curata_persistente
  [ "$(sql "SELECT count(*) FROM pg_db_role_setting, unnest(setconfig) c WHERE lower(c) LIKE 'gazpet.%'")" = 0 ] || esec "$1 VG1: au rămas setări persistente"
}
armare_ramasa_dupa() {  # rulează revenirea în sesiune și întoarce valoarea comutatorului după COMMIT
  "${PSQL0[@]}" -q -At -v ON_ERROR_STOP=1 -c "$(sir_revenire "$1" "$2" "$3" "${4:-true}")" \
     -c "SELECT 'armare_ramasa=[' || coalesce(current_setting('$2', true), '') || ']'" 2>"$BASE/rev.err" | tail -1
}

ALEGE='public.fn_ofertare_alege_acoperire(bigint)'; PERECHE='public.ofertare_inventar_pereche(bigint,text,integer,real)'
trei_refuza() {  # trei_refuza <eticheta>
  refuzat "$1 → migrarea (livrare)" "Precondiție 20261003b: starea curentă nu e o stare completă" livrare_fara_inreg "$MIG" 20261003999000
  refuzat "$1 → rollback-ul armat" "ROLLBACK TEHNIC 20261003b blocat: starea curentă" revenire "$RB" "$C_RB" "$V_RB"
  refuzat "$1 → oprirea armată" "se aplică doar din starea completă a patch-ului" revenire "$OPR" "$C_OP" "$V_OP"
  refuzat "$1 → repornirea armată" "doar din starea completă „oprire”" revenire "$REP" "$C_RP" "$V_RP"
}


# ── Runda 4: sesiuni psql PERSISTENTE (conexiuni existente, apel în curs) ──────────────────────────────
# ses_start <n>: psql în fundal, citește dintr-un FIFO (fd salvat în FD_<n>), scrie în $BASE/ses_<n>.out
declare -A SES_FD=() SES_PID=(); SES_K=0
ses_start() {
  rm -f "$BASE/ses_$1.in"; mkfifo "$BASE/ses_$1.in"; : >"$BASE/ses_$1.out"
  "$PGBIN/psql" -X -At -h 127.0.0.1 -p "$PGPORT" -U postgres -d "$DB" -v ON_ERROR_STOP=0 <"$BASE/ses_$1.in" >>"$BASE/ses_$1.out" 2>&1 &
  SES_PID[$1]=$!
  local fd; exec {fd}>"$BASE/ses_$1.in"; SES_FD[$1]=$fd
  ses "$1" "SELECT 'pid=' || pg_backend_pid();"
}
ses_trimite() { printf '%s\n' "$2" >&"${SES_FD[$1]}"; }                       # fără așteptare
ses_asteapta() {  # ses_asteapta <n> <marcaj>: până apare marcajul în ieșire (max 30 s)
  local i; for i in $(seq 1 300); do grep -qx -- "$2" "$BASE/ses_$1.out" && return 0; sleep 0.1; done
  cat "$BASE/ses_$1.out" >&2; esec "sesiunea $1: marcajul $2 n-a apărut"
}
ses() {  # ses <n> <sql>: trimite și așteaptă terminarea; ieșirea comenzii rămâne în $BASE/ses_<n>.out
  SES_K=$((SES_K + 1)); ses_trimite "$1" "$2"; ses_trimite "$1" "\\echo __GATA_$SES_K"; ses_asteapta "$1" "__GATA_$SES_K"
}
ses_de_la() { wc -l <"$BASE/ses_$1.out"; }                                     # poziția curentă în ieșire
ses_dupa() { tail -n +"$(($2 + 1))" "$BASE/ses_$1.out"; }                       # ieșirea de după poziție
ses_stop() { ses_trimite "$1" '\q'; eval "exec ${SES_FD[$1]}>&-"; wait "${SES_PID[$1]}" 2>/dev/null || true; }
CA_ID() {  # CA_ID <uid|-> : rolul authenticated cu claims (ca PostgREST); '-' = fără sub
  if [ "$1" = - ]; then echo "RESET ROLE; SET request.jwt.claims TO '{\"role\":\"authenticated\"}'; SET ROLE authenticated;"
  else echo "RESET ROLE; SET request.jwt.claims TO '{\"sub\":\"$1\",\"role\":\"authenticated\"}'; SET ROLE authenticated;"; fi
}
U_OWNER=00000000-0000-4000-8000-000000000121; U_MOD=00000000-0000-4000-8000-000000000007; U_NOMOD=00000000-0000-4000-8000-000000000099
# Scenariul protecțiilor patch-ului (Copilot r3 §5, ultimul rând): fixture curat, apoi utilizatorul CU modul rulează
# „Compară cu registrul” cu p_prag = 0 pe lic. 10 (respins_de_om 3/6, confirmat_de_om 4) și pe lic. 40 (goluri reale
# 41–43, confirmat_de_om 44). Întoarce instantaneul inventarului (determinist: funcția nu atinge verdict_la).
scenariu_protectii() {
  sql "SELECT t.reset_fixture(); $(CA_ID $U_MOD) SELECT * FROM public.ofertare_inventar_pereche(10, 'gemini', 1, 0); SELECT * FROM public.ofertare_inventar_pereche(40, 'gemini', 1, 0); RESET ROLE; RESET request.jwt.claims; SELECT t.inv_snapshot()"
}

# ── Cluster dedicat ────────────────────────────────────────────────────────────
pas "Cluster PG16 dedicat pe 127.0.0.1:$PGPORT ($PGDATA)"
if ! "$PGBIN/pg_isready" -q -h 127.0.0.1 -p "$PGPORT"; then
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$BASE"; [ "$(id -u)" = 0 ] && chown postgres:postgres "$BASE"; chmod 700 "$BASE"
    ca_pg "'$PGBIN/initdb' -D '$PGDATA' -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null"
  fi
  rm -f "$PGDATA/postmaster.pid" 2>/dev/null || true   # după o repornire a containerului
  ca_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -l '$LOG' -w -o \"-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$BASE -c timezone=UTC\" start >/dev/null"
  PORNIT_DE_NOI=1
else
  PORNIT_DE_NOI=0
fi
oprire() {
  curata_persistente 2>/dev/null || true
  if [ "${KEEP:-0}" != 1 ] && [ "$PORNIT_DE_NOI" = 1 ]; then ca_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -m fast -w stop >/dev/null" || true; fi
}
trap oprire EXIT
V=$("${PSQL[@]}" -d postgres -Atc "SELECT current_setting('server_version_num')::int / 10000")
[ "$V" = 16 ] || esec "Pe portul $PGPORT răspunde PG $V, nu 16"
LOG_START=$( [ -f "$LOG" ] && stat -c %s "$LOG" || echo 0 )
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
curata_persistente

# ── 0. Static ────────────────────────────────────────────────────────────────
corpuri() {  # "<nr delimitatori \$function\$> <md5 corp 1> <md5 corp 2>" — textul dintre „AS \$function\$” și următorul „\$function\$”
  "${PSQL[@]}" -d postgres -At -v f="$1" -f - <<'SQL'
\set src `cat :'f'`
SELECT ((length(:'src') - length(replace(:'src', '$function$', ''))) / length('$function$'))::text
       || ' ' || md5(split_part(split_part(:'src', 'AS $function$', 2), '$function$', 1))
       || ' ' || md5(split_part(split_part(:'src', 'AS $function$', 3), '$function$', 1));
SQL
}
blocuri_stari() {  # "<nr tag-uri \$stari\$> <md5 bloc 1> [<md5 bloc 2>]"
  "${PSQL[@]}" -d postgres -At -v f="$1" -f - <<'SQL'
\set src `cat :'f'`
SELECT n || ' ' || md5(split_part(:'src', '$stari$', 2)) || CASE WHEN n >= 4 THEN ' ' || md5(split_part(:'src', '$stari$', 4)) ELSE '' END
  FROM (SELECT (length(:'src') - length(replace(:'src', '$stari$', ''))) / length('$stari$') AS n) x;
SQL
}
prima_sql() { awk '!/^[[:space:]]*(--|$)/ { print; exit }' "$1"; }         # prima linie care nu e comentariu/goală
ultima_sql() { awk '!/^[[:space:]]*(--|$)/ { l = $0 } END { print l }' "$1"; }
if [ "${STATIC:-1}" = 1 ]; then
pas "0. Static: unde stau fișierele, cine gestionează tranzacția, amprentele scrise în fișiere"
MD="$ROOT/supabase/migrations"; RD="$ROOT/supabase/revenire"
[ "$(ls "$MD" | grep -c '^20261003b')" = 1 ] && [ -f "$MD/$NUME_MIG.sql" ] || esec "0a supabase/migrations trebuie să conțină DOAR migrarea forward 20261003b: $(ls "$MD" | grep '^20261003b' | tr '\n' ' ')"
ok "0a supabase/migrations conține doar migrarea forward 20261003b (revenirile nu mai sunt acolo)"
for f in "${NUME_MIG}_ROLLBACK.sql" "${NUME_MIG}_OPRIRE_CONTROLATA.sql" "${NUME_MIG}_REPORNIRE.sql" README.md; do [ -f "$RD/$f" ] || esec "0a lipsește supabase/revenire/$f"; done
ok "0a supabase/revenire: oprire controlată + repornire + rollback tehnic + README"
# (referințe în cod, nu în comentarii: o linie „-- …” sau „# …” doar descrie unde stau fișierele)
REFS=$(grep -rIn --exclude-dir=node_modules --exclude-dir=.git -e 'supabase/revenire' "$ROOT" | grep -v -e "^$ROOT/docs/" -e "^$RD/" -e "^$ROOT/scripts/test_sec_ofertare" | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(--|#|//)' || true)
[ -z "$REFS" ] || esec "0b supabase/revenire e referit din: $REFS"
WF="$ROOT/.github/workflows"
! grep -rnE "supabase/revenire|'supabase/\*\*'|supabase/migrations/\*|supabase/migrations/'|supabase +(db|migration)" "$WF" || esec "0b un workflow parcurge generic supabase/ sau rulează migrări"
[ ! -e "$ROOT/supabase/config.toml" ] || esec "0b există supabase/config.toml (CLI-ul ar descoperi migrările)"
ok "0b niciun runner nu parcurge supabase/revenire; workflow-urile referă doar fișiere anume din supabase/migrations: $(grep -rhoE "supabase/migrations/[^' ]+" "$WF" | sort -u | tr '\n' ' ')"
for f in "$MIG" "$RB" "$OPR" "$REP"; do
  n=$(grep -ciE '^[[:space:]]*(BEGIN|COMMIT|ROLLBACK|ABORT|START[[:space:]]+TRANSACTION|SAVEPOINT|RELEASE|END[[:space:]]+(TRANSACTION|WORK))[[:space:]]*;' "$f" || true)
  PRIMA=$(prima_sql "$f"); ULTIMA=$(ultima_sql "$f")
  { [ "$n" = 0 ] && [[ "$PRIMA" =~ ^DO\ \$[a-z_0-9]+\$$ ]] && [[ "$ULTIMA" =~ ^END\ \$[a-z_0-9]+\$\;$ ]] && [ "$(grep -c '^DO \$' "$f")" = 1 ]; } \
    || esec "0c $(basename "$f"): fără BEGIN/COMMIT, un singur bloc DO (tranzacții: $n, prima „$PRIMA”, ultima „$ULTIMA”)"
done
ok "0c migrarea și revenirile: fără BEGIN/COMMIT (gestionarul unic e runner-ul), fiecare = un singur bloc DO"
read -r n a p <<<"$(corpuri "$MIG")"; [ "$n $a $p" = "4 $PATCH_H" ] || esec "0d corpurile din migrare: $n delimitatori, md5 $a $p ≠ PATCH_H $PATCH_H"
ok "0d md5 al corpurilor scrise în migrare (text literal, fără PG) = PATCH_H: $a $p"
read -r n a p <<<"$(corpuri "$RB")"; [ "$n $a $p" = "4 $LIVE_H" ] || esec "0d corpurile din rollback: $n, $a $p ≠ LIVE_H"
ok "0d md5 al corpurilor scrise în rollback = starea live: $a $p"
[ "$(corpuri "$OPR" | cut -d' ' -f1) $(corpuri "$REP" | cut -d' ' -f1)" = "0 0" ] || esec "0d oprirea/repornirea nu trebuie să conțină corpuri de funcții"
ok "0d oprirea și repornirea nu conțin niciun corp de funcție (nu înlocuiesc nimic)"
read -r n b1 b2 <<<"$(blocuri_stari "$MIG")"; read -r n2 r1 <<<"$(blocuri_stari "$RB")"; read -r n3 o1 <<<"$(blocuri_stari "$OPR")"; read -r n4 p1 <<<"$(blocuri_stari "$REP")"
[ "$n $n2 $n3 $n4" = "2 2 2 2" ] && [ -z "${b2:-}" ] && [ "$b1" = "$r1" ] && [ "$b1" = "$o1" ] && [ "$b1" = "$p1" ] || esec "0e tabelul stărilor cunoscute nu e identic în toate fișierele ($n/$n2/$n3; $b1 ${b2:-} $r1 $o1)"
ok "0e tabelul stărilor cunoscute e identic, octet cu octet, în cele 4 fișiere (fiecare îl folosește pentru precondiție și postcondiție): md5 $b1"
BLOC=$(awk '/\$stari\$$/{f++; next} f==1' "$MIG" | tr -s ' ')
set -- $PATCH_H; P1=$1; P2=$2; set -- $LIVE_H; L1=$1; L2=$2
CFG="{\"search_path=public, pg_temp\"}"; CFGX="{\"search_path=public, extensions, pg_temp\"}"
# runda 4: fiecare rând poartă și privilegiile EFECTIVE cerute (matricea din verdictul r3)
for r in "'live', 'acces', '$H_ACCES', '$CFG', '$ACL_DESCHIS', '$EF_DESCHIS'" "'live', 'alege', '$L1', '$CFG', '$ACL_DESCHIS', '$EF_DESCHIS'" "'live', 'pereche', '$L2', '$CFGX', '$ACL_DESCHIS', '$EF_DESCHIS'" \
         "'patch', 'acces', '$H_ACCES', '$CFG', '$ACL_DESCHIS', '$EF_DESCHIS'" "'patch', 'alege', '$P1', '$CFG', '$ACL_DESCHIS', '$EF_DESCHIS'" "'patch', 'pereche', '$P2', '$CFG', '$ACL_DESCHIS', '$EF_DESCHIS'" \
         "'oprire', 'acces', '$H_ACCES', '$CFG', '$ACL_DESCHIS', '$EF_DESCHIS'" "'oprire', 'alege', '$P1', '$CFG', '$ACL_OPRIT', '$EF_OPRIT'" "'oprire', 'pereche', '$P2', '$CFG', '$ACL_OPRIT', '$EF_OPRIT'"; do
  grep -qF "($r)" <<<"$BLOC" || esec "0e rândul ($r) lipsește din tabelul stărilor"
done
grep -qF "AND c.efectiv = o.efectiv" <<<"$BLOC" || esec "0g tabelul stărilor nu compară privilegiile efective"
for rol in anon public authenticated service_role; do grep -qF "has_function_privilege('$rol', p.oid, 'EXECUTE')" <<<"$BLOC" || esec "0g lipsește has_function_privilege pentru $rol"; done
ok "0g (runda 4) starea completă include privilegiile efective (has_function_privilege: anon, PUBLIC, authenticated, service_role) în toate cele 4 fișiere"
grep -qF "IF coalesce(v_stare, '') NOT IN ('live', 'patch') THEN" "$MIG" && ! grep -qE "NOT IN \('live', 'patch', 'oprire'\)" "$MIG" || esec "0h migrarea trebuie să accepte ca stare de pornire DOAR live și patch"
ok "0h (runda 4) migrarea acceptă ca stare de pornire doar live și patch (oprire → patch doar prin REPORNIRE)"
[ "$(grep -cE "^ ?\('(live|patch|oprire)'," <<<"$BLOC")" = 9 ] || esec "0e tabelul stărilor are alte rânduri decât cele 9 așteptate"
[ "$(grep -c "current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '$NUME_MIG:' || txid_current()" "$MIG")" = 2 ] || esec "0f migrarea trebuie să aibă garda de livrare la început și la final"
ok "0f migrarea are garda de livrare (marcaj legat de txid) la început și după postcondiții"
ok "0e tabelul are exact cele 9 rânduri: live/patch/oprire × acces/alege/pereche (md5(prosrc), proconfig, ACL) = constantele verificate"
fi

# ── 1. Setup ─────────────────────────────────────────────────────────────────
pas "1. Setup: schelet + funcțiile LIVE din 29.09 + ACL live; emularea supabase_migrations"
faza setup || esec "setup"
[ "$(scurt)" = "$LIVE_H | $ACL_DESCHIS | $ACL_DESCHIS | $H_ACCES" ] || esec "starea live nu e cea așteptată: $(scurt)"
salveaza_stare live
ok "starea live: md5(prosrc) $LIVE_H, ACL ca în live, helper $H_ACCES (amprenta completă salvată)"
sql "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
CREATE FUNCTION supabase_migrations.t3_eroare() RETURNS trigger LANGUAGE plpgsql AS \$t\$ BEGIN
  IF NEW.version = '20261003999998' THEN RAISE EXCEPTION 'T3: EROARE INJECTATĂ la INSERT-ul în schema_migrations'; END IF; RETURN NEW; END \$t\$;
CREATE TRIGGER t3_eroare BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION supabase_migrations.t3_eroare()" >/dev/null
ok "supabase_migrations.schema_migrations creată (emulare), cu eroare injectabilă la INSERT pentru versiunea 20261003999998 (T3)"

pas "2. GAURA pe copia live (înainte de patch)"
faza gaura || esec "gaura pe starea live"

# ── 3. T1 / T3 ───────────────────────────────────────────────────────────────
t1() {  # t1 <stare>: mutantul cu eroare după prima înlocuire de funcție, livrat pe traseul oficial
  mutant_t1 "$MIG" "$BASE/mig_t1.sql"
  local inainte rc=0; inainte=$(urme)
  livrare "$BASE/mig_t1.sql" 20261003999999 >"$BASE/t1.out" 2>&1 || rc=$?
  grep -q 'division by zero' "$BASE/t1.out" && [ "$rc" != 0 ] || { cat "$BASE/t1.out" >&2; esec "T1 din $1: eroarea injectată nu s-a produs"; }
  [ "$(urme)" = "$inainte" ] || { diff <(echo "$inainte") <(urme) >&2 || true; esec "T1 din $1: definițiile inițiale NU au rămas (sau migrarea a fost înregistrată)"; }
  ok "T1 din $1 (livrare_migrare.sh): eroare după prima înlocuire de funcție → ambele definiții inițiale rămân (md5(prosrc) + ACL), nimic în schema_migrations"
}
pas "3. T1 (Copilot) din LIVE + runner-ele neoficiale refuzate de garda de livrare"
t1 live
refuzat "3a psql -f simplu (fără marcaj de livrare)" "garda de livrare (start)" runner_psql_f "$MIG"
refuzat "3a un singur simple query (fără marcaj)" "garda de livrare (start)" runner_query "$MIG"
refuzat "3a BEGIN; migrare; INSERT; COMMIT; într-un string (ca execute_sql / apply_migration)" "garda de livrare (start)" runner_string "$MIG"

pas "3b. T3 (Copilot) din LIVE: eroare CHIAR la INSERT-ul în schema_migrations, după postcondiții și garda de final"
rc=0; inainte=$(urme); livrare "$MIG" 20261003999998 >"$BASE/t3.out" 2>&1 || rc=$?
{ [ "$rc" != 0 ] && grep -q 'T3: EROARE INJECTATĂ la INSERT' "$BASE/t3.out" && ! grep -q 'Postcondiție\|garda de livrare' "$BASE/t3.out"; } || { cat "$BASE/t3.out" >&2; esec "T3: eroarea de la INSERT nu s-a produs după fișier"; }
[ "$(urme)" = "$inainte" ] || { diff <(echo "$inainte") <(urme) >&2 || true; esec "T3: patch-ul a rămas comis deși înregistrarea a eșuat"; }
ok "T3: fișierul trecut complet (precondiții, DDL, postcondiție, garda de final), eroare la INSERT → starea inițială + 0 înregistrări"

# ── 4. Migrare ───────────────────────────────────────────────────────────────
pas "4. Migrare 20261003b din LIVE prin scripts/livrare_migrare.sh (marcaj + migrare + înregistrare, o tranzacție)"
livrare "$MIG" 20261003000000 >"$BASE/c.out" 2>&1 || { cat "$BASE/c.out" >&2; esec "livrarea din live"; }
! grep -q 'transaction in progress' "$BASE/c.out" || { cat "$BASE/c.out" >&2; esec "livrare: WARNING de tranzacție imbricată — fișierul nu trebuie să aibă BEGIN/COMMIT"; }
[ "$(scurt)" = "$PATCH_H | $ACL_DESCHIS | $ACL_DESCHIS | $H_ACCES" ] || esec "md5(prosrc)/ACL după migrare ($(scurt)) ≠ PATCH_H + ACL: listele din fișiere trebuie recalculate (commit revizuit)"
salveaza_stare patch
ok "md5(prosrc) după livrare = PATCH_H ($PATCH_H) = valorile din fișiere; ACL neschimbat; fără WARNING de tranzacție"
[ "$(sql "SELECT count(*) || ' ' || max(version) || ' ' || max(name) FROM supabase_migrations.schema_migrations")" = "1 20261003000000 $NUME_MIG" ] || esec "livrare: înregistrare"
ok "livrare: patch + o înregistrare (20261003000000, $NUME_MIG) în aceeași tranzacție"
refuzat "4b livrarea a doua oară (altă versiune): refuzată, fără dublare" "CONFLICT: istoricul are 1 rând" livrare "$MIG" 20261003000001

pas "5. Teste pe PATCH: patched + runda 2 + runda 3 (VN1 poarta NULL-safe)"
faza patched || esec "teste patched"
faza runda2 || esec "teste runda 2"
faza runda3 || esec "teste runda 3"
sql "SELECT t.captureaza('patch')" >/dev/null
SCEN_PATCH=$(scenariu_protectii)
grep -q '|respins_de_om|' <<<"$SCEN_PATCH" || esec "scenariul protecțiilor pe patch: fără respins_de_om"
ok "R4-6 scenariul protecțiilor capturat pe PATCH, înainte de orice oprire (respins/confirmat_de_om, p_prag=0 pe lic. 10 și 40)"

pas "6. Postcondiția migrării (înainte de COMMIT): variante neauditate ale fișierului"
injecteaza "$MIG" '^-- SEC-20261003b \(constatarea 2\)' '-- VARIANTĂ NEAUDITATĂ (test postcondiție)' "$BASE/mig_corp.sql"
refuzat "6a migrare cu corp schimbat (o linie de comentariu)" "Postcondiție 20261003b" livrare_fara_inreg "$BASE/mig_corp.sql" 20261003000050
sed 's/$/\r/' "$MIG" >"$BASE/mig_crlf.sql"
refuzat "6b migrare cu CRLF (checkout Windows)" "Postcondiție 20261003b" livrare_fara_inreg "$BASE/mig_crlf.sql" 20261003000051

# ── 7. Oprire controlată ─────────────────────────────────────────────────────
pas "7. OPRIRE CONTROLATĂ din PATCH: armare (txid), T2, VG1, postcondiție, apoi aplicare"
refuzat "7a oprirea NEARMATĂ" "nearmată în tranzacția curentă" fara_armare "$OPR"
refuzat "7b armată fără txid (valoarea goală)" "nearmată în tranzacția curentă" armare_fara_txid "$OPR" "$C_OP" "$V_OP"
refuzat "7c armată cu comutatorul ROLLBACK-ului" "nearmată în tranzacția curentă" revenire "$OPR" "$C_RB" "$V_RB"
refuzat "7d comutatorul propriu, valoarea rollback-ului" "nearmată în tranzacția curentă" revenire "$OPR" "$C_OP" "$V_RB"
refuzat "7e armare corectă, dar în ALTĂ tranzacție (-c separat)" "nearmată în tranzacția curentă" armare_separata "$OPR" "$C_OP" "$V_OP"
vg1 "7f oprirea" "$OPR" "$C_OP" "$V_OP"
injecteaza "$OPR" '^  REVOKE EXECUTE ON FUNCTION public.fn_ofertare_alege_acoperire' '  PERFORM 1/0;  -- EROARE INJECTATĂ (după primul REVOKE)' "$BASE/opr_err.sql"
refuzat "7-R4-5 oprire armată cu eroare DUPĂ primul REVOKE → întreaga stare „patch” (ACL + privilegii efective), fără combinații" "division by zero" revenire "$BASE/opr_err.sql" "$C_OP" "$V_OP"
e_stare patch "7-R4-5 după eroarea din oprire"
injecteaza "$OPR" '^  REVOKE EXECUTE ON FUNCTION public.fn_ofertare_alege_acoperire' '  PERFORM 1/0;  -- EROARE INJECTATĂ (T2)' "$BASE/opr_t2.sql"
t2_familie "7g oprirea" "$OPR" "$BASE/opr_t2.sql" "$C_OP" "$V_OP" "nearmată în tranzacția curentă"
sed 's/^\(  REVOKE EXECUTE ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) FROM PUBLIC, anon, \)authenticated, \(service_role;\)$/\1\2/' "$OPR" >"$BASE/opr_post.sql"
refuzat "7h oprire care uită REVOKE de la authenticated pe alege → postcondiția" "Postcondiție OPRIRE CONTROLATĂ" revenire "$BASE/opr_post.sql" "$C_OP" "$V_OP"
R=$(armare_ramasa_dupa "$OPR" "$C_OP" "$V_OP") || { cat "$BASE/rev.err" >&2; esec "oprirea armată"; }
[ "$R" = "armare_ramasa=[]" ] || esec "oprire: comutatorul a rămas armat după COMMIT: $R"
[ "$(scurt)" = "$PATCH_H | $ACL_OPRIT | $ACL_OPRIT | $H_ACCES" ] || esec "după oprire: $(scurt)"
salveaza_stare oprire; sql "SELECT t.captureaza('oprire')" >/dev/null
ok "7i oprirea armată (procedura documentată): corpurile patch-ului rămân, EXECUTE doar postgres, comutatorul dezarmat"
faza oprire || esec "teste după oprire"
refuzat "7j oprirea a doua oară (din OPRIRE)" "se aplică doar din starea completă a patch-ului" revenire "$OPR" "$C_OP" "$V_OP"

# ── 8. Din oprire ────────────────────────────────────────────────────────────
pas "8. Din OPRIRE: migrarea NU repornește (runda 4); moștenire prin roluri; eroare după primul GRANT; apoi REPORNIRE"
# R4-1 (Copilot r3 §2, testul discriminatoriu): oprire, migrare NEÎNREGISTRATĂ, livrare normală → REFUZ, ACL-urile rămân de oprire.
sql "CREATE TABLE t.migr_salvate AS SELECT * FROM supabase_migrations.schema_migrations; DELETE FROM supabase_migrations.schema_migrations" >/dev/null
[ "$(n_migrari)" = 0 ] || esec "8-R4-1: înregistrarea nu a fost scoasă"
refuzat "8-R4-1 din OPRIRE, fără înregistrare în schema_migrations, livrarea normală a migrării → REFUZ (nu e a doua cale de repornire)" "funcțiile sunt în OPRIRE CONTROLATĂ" livrare "$MIG" 20261003000100
e_stare oprire "8-R4-1 după refuz: ACL-urile și privilegiile efective sunt tot ale opririi"
mutant_t1 "$MIG" "$BASE/mig_t1.sql"
refuzat "8-R4-1 T1 din OPRIRE neînregistrată: precondiția refuză înainte de orice înlocuire" "funcțiile sunt în OPRIRE CONTROLATĂ" livrare "$BASE/mig_t1.sql" 20261003999999
refuzat "8-R4-1 psql -f simplu din OPRIRE (fără marcaj)" "garda de livrare (start)" runner_psql_f "$MIG"
sql "INSERT INTO supabase_migrations.schema_migrations SELECT * FROM t.migr_salvate; DROP TABLE t.migr_salvate" >/dev/null
refuzat "8a livrarea migrării din OPRIRE, înregistrată → REFUZ (precondiția, înaintea verificării înregistrării)" "funcțiile sunt în OPRIRE CONTROLATĂ" livrare_fara_inreg "$MIG" 20261003000101
# R4-2 (Copilot r3 §3): EXECUTE primit prin MOȘTENIRE, fără schimbarea proacl → starea nu mai e „oprire”
[ "$(scurt)" = "$PATCH_H | $ACL_OPRIT | $ACL_OPRIT | $H_ACCES" ] || esec "8-R4-2: pornire"
sql "GRANT postgres TO service_role" >/dev/null
[ "$(scurt)" = "$PATCH_H | $ACL_OPRIT | $ACL_OPRIT | $H_ACCES" ] && [ "$(sql "SELECT has_function_privilege('service_role', '$ALEGE'::regprocedure, 'EXECUTE')")" = t ] \
  || esec "8-R4-2: moștenirea nu a dat EXECUTE sau a schimbat proacl"
ok "8-R4-2 service_role membru al proprietarului: proacl NESCHIMBAT ($ACL_OPRIT), dar has_function_privilege(service_role) = t"
trei_refuza "8-R4-2 oprire + EXECUTE moștenit de service_role"
sql "REVOKE postgres FROM service_role" >/dev/null
e_stare oprire "8-R4-2 apartenența retrasă"
refuzat "8c repornirea NEARMATĂ" "nearmată în tranzacția curentă" fara_armare "$REP"
refuzat "8c repornirea armată cu comutatorul opririi" "nearmată în tranzacția curentă" revenire "$REP" "$C_OP" "$V_OP"
grep -v '^  GRANT EXECUTE ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) TO authenticated, service_role;$' "$REP" >"$BASE/rep_fara_grant.sql"
refuzat "8d repornire fără GRANT pe alege → postcondiția" "Postcondiție REPORNIRE" revenire "$BASE/rep_fara_grant.sql" "$C_RP" "$V_RP"
injecteaza "$REP" '^  GRANT EXECUTE ON FUNCTION public.fn_ofertare_alege_acoperire' '  PERFORM 1/0;  -- EROARE INJECTATĂ (după primul GRANT)' "$BASE/rep_err.sql"
refuzat "8-R4-5 repornire armată cu eroare DUPĂ primul GRANT → întreaga stare „oprire” (ACL + privilegii efective), fără combinații" "division by zero" revenire "$BASE/rep_err.sql" "$C_RP" "$V_RP"
e_stare oprire "8-R4-5 după eroarea din repornire"
R=$(armare_ramasa_dupa "$REP" "$C_RP" "$V_RP") || { cat "$BASE/rev.err" >&2; esec "8e repornirea armată"; }
[ "$R" = "armare_ramasa=[]" ] || esec "repornire: comutatorul a rămas armat: $R"
e_stare patch "8e repornirea armată: exact starea patch-ului (GRANT-uri refăcute), comutatorul dezarmat"
refuzat "8f repornirea a doua oară (din PATCH)" "doar din starea completă „oprire”" revenire "$REP" "$C_RP" "$V_RP"
faza patched || esec "teste patched după repornire"
faza runda2 || esec "runda 2 după repornire"
faza runda3 || esec "runda 3 după repornire"

# ── 9. Stări mixte și atribute ───────────────────────────────────────────────
pas "9. Stări MIXTE și atribute schimbate → migrarea, rollback-ul, oprirea și repornirea refuză, fără urme"
for pr in "live patch" "patch live" "live oprire" "oprire live" "patch oprire" "oprire patch"; do
  set -- $pr
  sql "SELECT t.pune('alege', '$1'); SELECT t.pune('pereche', '$2')" >/dev/null
  trei_refuza "9 mixt alege=$1 pereche=$2"
  sql "SELECT t.pune('alege', 'patch'); SELECT t.pune('pereche', 'patch')" >/dev/null
done
e_stare patch "9 după stările mixte"
atribut() {  # atribut <eticheta> <SQL strică> <SQL repară>
  sql "$2" >/dev/null; trei_refuza "9 $1"; sql "$3" >/dev/null; e_stare patch "9 $1 reparat"
}
atribut "R4-2 moștenire: anon membru al authenticated (proacl neschimbat)" "GRANT authenticated TO anon" "REVOKE authenticated FROM anon"
atribut "ACL: anon primește EXECUTE pe alege" "GRANT EXECUTE ON FUNCTION $ALEGE TO anon" "REVOKE EXECUTE ON FUNCTION $ALEGE FROM anon"
atribut "ACL: service_role pierde EXECUTE pe pereche" "REVOKE EXECUTE ON FUNCTION $PERECHE FROM service_role" "GRANT EXECUTE ON FUNCTION $PERECHE TO service_role"
atribut "SECURITY INVOKER pe pereche" "ALTER FUNCTION $PERECHE SECURITY INVOKER" "ALTER FUNCTION $PERECHE SECURITY DEFINER"
atribut "proprietar schimbat pe alege" "ALTER FUNCTION $ALEGE OWNER TO proprietar_strain" "ALTER FUNCTION $ALEGE OWNER TO postgres; SELECT t.pune('alege', 'patch')"
atribut "search_path schimbat pe alege" "ALTER FUNCTION $ALEGE SET search_path = public, extensions, pg_temp" "ALTER FUNCTION $ALEGE SET search_path = public, pg_temp"
atribut "volatilitate STABLE pe alege" "ALTER FUNCTION $ALEGE STABLE" "ALTER FUNCTION $ALEGE VOLATILE"
atribut "COST 101 pe pereche" "ALTER FUNCTION $PERECHE COST 101" "ALTER FUNCTION $PERECHE COST 100"
atribut "helper cu COST 101" "ALTER FUNCTION public.fn_are_acces_ofertare() COST 101" "ALTER FUNCTION public.fn_are_acces_ofertare() COST 100"
atribut "supraîncărcare nouă fn_ofertare_alege_acoperire(integer)" \
  "CREATE FUNCTION public.fn_ofertare_alege_acoperire(p integer) RETURNS void LANGUAGE sql AS 'SELECT NULL'" \
  "DROP FUNCTION public.fn_ofertare_alege_acoperire(integer)"

# ── 10. VG2 ──────────────────────────────────────────────────────────────────
pas "10. VG2: o versiune ULTERIOARĂ care poartă markerul SEC-20261003b nu se suprascrie"
HOT_ALEGE="SELECT replace(pg_get_functiondef('$ALEGE'::regprocedure), '  -- Poarta verifică înainte de orice citire', E'  -- HOTFIX_ULTERIOR (SEC-20261003b v3)\n  -- Poarta verifică înainte de orice citire')"
HOT_PERECHE="SELECT replace(pg_get_functiondef('$PERECHE'::regprocedure), '  -- implicit: cea mai recenta rulare', E'  -- HOTFIX_ULTERIOR (SEC-20261003b v3)\n  -- implicit: cea mai recenta rulare')"
hotfix() { sql "DO \$h\$ DECLARE d text := ($1); BEGIN IF position('HOTFIX_ULTERIOR' IN d) = 0 THEN RAISE EXCEPTION 'hotfix neinjectat'; END IF; EXECUTE d; END \$h\$" >/dev/null; }
hotfix "$HOT_ALEGE"; trei_refuza "10 VG2 alege ulterioară"; sql "SELECT t.pune('alege', 'patch')" >/dev/null
hotfix "$HOT_PERECHE"; trei_refuza "10 VG2 pereche ulterioară"; sql "SELECT t.pune('pereche', 'patch')" >/dev/null
e_stare patch "10 hotfix-urile anulate"

# ── 11. Rollback tehnic ──────────────────────────────────────────────────────
pas "11. ROLLBACK TEHNIC din PATCH: armare (txid), VG1, T2, postcondiție, apoi aplicare"
refuzat "11a rollback-ul NEARMAT" "nearmat în tranzacția curentă" fara_armare "$RB"
refuzat "11b armat fără txid" "nearmat în tranzacția curentă" armare_fara_txid "$RB" "$C_RB" "$V_RB"
refuzat "11c armat cu comutatorul OPRIRII" "nearmat în tranzacția curentă" revenire "$RB" "$C_OP" "$V_OP"
refuzat "11d armare corectă, dar în ALTĂ tranzacție" "nearmat în tranzacția curentă" armare_separata "$RB" "$C_RB" "$V_RB"
vg1 "11e rollback-ul" "$RB" "$C_RB" "$V_RB"
injecteaza "$RB" '^\$def_alege\$;$' '  PERFORM 1/0;  -- EROARE INJECTATĂ (T2)' "$BASE/rb_t2.sql"
t2_familie "11f rollback-ul" "$RB" "$BASE/rb_t2.sql" "$C_RB" "$V_RB" "nearmat în tranzacția curentă"
injecteaza "$RB" '^  v_vechi   bigint;$' '  -- VARIANTĂ NEAUDITATĂ (test postcondiție)' "$BASE/rb_corp.sql"
refuzat "11g rollback cu corp live schimbat → postcondiția" "Postcondiție ROLLBACK TEHNIC" revenire "$BASE/rb_corp.sql" "$C_RB" "$V_RB"
R=$(armare_ramasa_dupa "$RB" "$C_RB" "$V_RB") || { cat "$BASE/rev.err" >&2; esec "rollback-ul armat"; }
[ "$R" = "armare_ramasa=[]" ] || esec "rollback: comutatorul a rămas armat: $R"
e_stare live "11h rollback-ul armat (procedura documentată) readuce exact starea live"
SCEN_LIVE=$(scenariu_protectii)
faza gaura || esec "gaura după rollback tehnic"
faza_pica patched || esec "suita patched a trecut pe starea live (testele nu prind gaura)"
ok "suita patched CADE pe starea live: $(primul_esec "$BASE/vacuu.out")"
for t in VD4:pica VD5:pica VD6:trece VE1:trece VE2:trece; do
  id=${t%%:*}; astept=${t##*:}
  if faza_pica runda2 "$id"; then rez=pica; else rez=trece; fi
  [ "$rez" = "$astept" ] || esec "$id pe live: $rez, așteptat $astept"
  ok "$id pe starea live: $rez"
done
faza_pica runda3 VN1 || esec "VN1 a trecut pe starea live"
ok "VN1 pe starea live: pica la „$(primul_esec "$BASE/vacuu.out")”"
R=$(armare_ramasa_dupa "$RB" "$C_RB" "$V_RB" false) || { cat "$BASE/rev.err" >&2; esec "11i reluarea din live"; }
[ "$R" = "armare_ramasa=[]" ] || esec "11i: după reluarea armată cu set_config(…, false), comutatorul a rămas în sesiune: $R"
e_stare live "11i reluare fără efect din LIVE (armată greșit cu set_config(…, false)): trece, iar comutatorul e dezarmat după COMMIT"
refuzat "11j oprirea din LIVE" "se aplică doar din starea completă a patch-ului" revenire "$OPR" "$C_OP" "$V_OP"
refuzat "11k livrarea migrării din LIVE după rollback: refuzată (deja înregistrată; un nou patch = migrare nouă)" "CONFLICT: istoricul are 1 rând" livrare "$MIG" 20261003000200
sql "SELECT t.pune('alege', 'patch'); SELECT t.pune('pereche', 'patch')" >/dev/null
e_stare patch "11l (infrastructura testului) readus în patch pentru pașii următori"

# ── 12. Oprire → rollback ────────────────────────────────────────────────────
pas "12. PATCH → oprire (armată greșit cu false) → rollback din OPRIRE (+ postcondiție GRANT)"
R=$(armare_ramasa_dupa "$OPR" "$C_OP" "$V_OP" false) || { cat "$BASE/rev.err" >&2; esec "12 oprirea"; }
[ "$R" = "armare_ramasa=[]" ] || esec "12: comutatorul opririi a rămas în sesiune: $R"
e_stare oprire "12a oprire armată cu set_config(…, false): aplicată, comutatorul dezarmat după COMMIT"
grep -v '^  GRANT EXECUTE ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) TO authenticated, service_role;$' "$RB" >"$BASE/rb_fara_grant.sql"
refuzat "12b rollback fără GRANT pe alege, din OPRIRE → postcondiția" "Postcondiție ROLLBACK TEHNIC" revenire "$BASE/rb_fara_grant.sql" "$C_RB" "$V_RB"
revenire "$RB" "$C_RB" "$V_RB" >/dev/null 2>&1 || esec "12c rollback-ul din oprire"
e_stare live "12c rollback-ul armat din OPRIRE"
sql "SELECT t.pune('alege', 'patch'); SELECT t.pune('pereche', 'patch')" >/dev/null
e_stare patch "12d (infrastructura testului) readus în patch pentru testele finale"

pas "13. Teste finale + urma în jurnalul Postgres + schema_migrations"
faza patched || esec "teste patched finale"
faza runda2 || esec "runda 2 finale"
faza runda3 || esec "runda 3 finale"
NOU=$(tail -c +"$((LOG_START + 1))" "$LOG")
N_ALEGE=$(grep -c "SEC-20261003b alege_acoperire: cerinta=101 pozitie=<NULL> ales=1002 inlocuit=1001 inlocuit_ales_de=00000000-0000-4000-8000-000000000007 de=00000000-0000-4000-8000-000000000007" <<<"$NOU" || true)
N_PERECHE=$(grep -c "SEC-20261003b inventar_pereche: lic=10 furnizor=gemini versiune=1 prag_cerut=0 prag_aplicat=0.45 " <<<"$NOU" || true)
N_PERECHE40=$(grep -c "SEC-20261003b inventar_pereche: lic=40 furnizor=gemini versiune=1 prag_cerut=0.3 prag_aplicat=0.45 " <<<"$NOU" || true)
[ "$N_ALEGE" -ge 1 ] && [ "$N_PERECHE" -ge 1 ] && [ "$N_PERECHE40" -ge 1 ] || esec "urmele RAISE LOG lipsesc ($N_ALEGE/$N_PERECHE/$N_PERECHE40)"
ok "jurnal: alegere înlocuită ×$N_ALEGE; prag cerut 0 → 0.45 ×$N_PERECHE; cerut 0.3 → 0.45 ×$N_PERECHE40"
[ "$(sql "SELECT string_agg(version, ',' ORDER BY version) FROM supabase_migrations.schema_migrations")" = "20261003000000" ] \
  || esec "schema_migrations: $(sql "SELECT string_agg(version, ',') FROM supabase_migrations.schema_migrations")"
ok "schema_migrations: exact livrarea reușită (20261003000000), o dată; nicio încercare eșuată, reluare sau revenire înregistrată"

# ── 14. Runda 4: patch → oprire → repornire, conexiuni existente, apel în curs, protecțiile după repornire ──
pas "14. Runda 4 (Copilot r3 §5): conexiuni EXISTENTE, apel ÎN CURS suspendat determinist, repornire cu protecțiile patch-ului"
e_stare patch "14 pornire"
sql "SELECT t.reset_fixture()" >/dev/null
ses_start A; ses_start B
# Conexiuni deschise ÎNAINTE de oprire, cu apeluri reușite (plan/cache încălzit): owner și utilizatorul cu modul.
ses A "$(CA_ID $U_OWNER) SELECT 'A_owner_patch=' || ales_id FROM public.fn_ofertare_alege_acoperire(1003);"
grep -qx 'A_owner_patch=1003' "$BASE/ses_A.out" || { cat "$BASE/ses_A.out" >&2; esec "14a owner pe patch, conexiunea A"; }
ses B "$(CA_ID $U_MOD) SELECT 'B_mod_patch=' || imperecheate FROM public.ofertare_inventar_pereche(10, 'gemini', 1);"
grep -q '^B_mod_patch=' "$BASE/ses_B.out" || { cat "$BASE/ses_B.out" >&2; esec "14a utilizator cu modul pe patch, conexiunea B"; }
ok "14a pe PATCH, în conexiunile A (owner) și B (cu modul), deschise înainte de oprire: apelurile trec"

# Apel ÎN CURS: C (cu modul) intră în pereche(40, p_prag=0) și e suspendat DETERMINIST înaintea UPDATE-ului:
# L ține LOCK EXCLUSIVE pe ofertare_inventar_ai (SELECT-ul funcției trece, UPDATE-ul așteaptă).
ses_start C; ses_start L
sql "UPDATE public.ofertare_inventar_ai SET verdict = NULL, pereche_cerinta_id = NULL WHERE id IN (41, 42, 43)" >/dev/null
INV0=$(sql "SELECT t.inv_row(41) || ';' || t.inv_row(42) || ';' || t.inv_row(43)")
ses L "BEGIN; LOCK TABLE public.ofertare_inventar_ai IN EXCLUSIVE MODE; SELECT 'L_lock';"
PC=$(sed -n 's/^pid=//p' "$BASE/ses_C.out" | head -1)
ses C "$(CA_ID $U_MOD)"
ses_trimite C "SELECT 'C_rezultat=' || imperecheate || '/' || ramase_fara_pereche FROM public.ofertare_inventar_pereche(40, 'gemini', 1, 0);"
ses_trimite C '\echo __C_GATA'
for i in $(seq 1 300); do
  [ "$(sql "SELECT count(*) FROM pg_stat_activity WHERE pid = $PC AND wait_event_type = 'Lock' AND query LIKE '%ofertare_inventar_pereche%'")" = 1 ] && break
  sleep 0.1; [ "$i" = 300 ] && esec "14b apelul C nu a ajuns să aștepte la UPDATE"
done
ok "14b apelul C (cu modul, pereche lic. 40, p_prag=0) a intrat în funcție și așteaptă înaintea scrierii (pg_stat_activity: wait_event_type=Lock)"

# OPRIREA, într-o conexiune nouă (procedura documentată), cât timp C e în curs.
R=$(armare_ramasa_dupa "$OPR" "$C_OP" "$V_OP") || { cat "$BASE/rev.err" >&2; esec "14c oprirea"; }
e_stare oprire "14c oprirea COMISĂ cu apelul C încă în curs; verificată separat, după COMMIT, într-o conexiune nouă"
# Conexiunile EXISTENTE (A, B) și identitățile: toate refuzate după COMMIT-ul opririi.
p=$(ses_de_la A); ses A "$(CA_ID $U_OWNER) SELECT * FROM public.fn_ofertare_alege_acoperire(1002);"
ses_dupa A "$p" | grep -q 'permission denied for function fn_ofertare_alege_acoperire' || { ses_dupa A "$p" >&2; esec "14d owner, conexiune existentă"; }
p=$(ses_de_la B); ses B "$(CA_ID $U_MOD) SELECT * FROM public.ofertare_inventar_pereche(10, 'gemini', 1, 0);"
ses_dupa B "$p" | grep -q 'permission denied for function ofertare_inventar_pereche' || { ses_dupa B "$p" >&2; esec "14d cu modul, conexiune existentă"; }
p=$(ses_de_la B); ses B "$(CA_ID $U_NOMOD) SELECT * FROM public.ofertare_inventar_pereche(10);"
ses_dupa B "$p" | grep -q 'permission denied' || esec "14d fără modul, conexiune existentă"
p=$(ses_de_la B); ses B "$(CA_ID -) SELECT * FROM public.fn_ofertare_alege_acoperire(1002);"
ses_dupa B "$p" | grep -q 'permission denied' || esec "14d fără uid, conexiune existentă"
p=$(ses_de_la A); ses A "RESET ROLE; SET request.jwt.claims TO '{\"role\":\"service_role\"}'; SET ROLE service_role; SELECT * FROM public.ofertare_inventar_pereche(10);"
ses_dupa A "$p" | grep -q 'permission denied' || esec "14d service_role, conexiune existentă"
ok "14d în OPRIRE, din conexiunile EXISTENTE (deschise pe patch): owner, cu modul, fără modul, fără uid, service_role → permission denied"
[ "$(sql "SELECT t.inv_row(41) || ';' || t.inv_row(42) || ';' || t.inv_row(43)")" = "$INV0" ] || esec "14e C a scris înainte de eliberarea blocării"
ok "14e până la eliberarea blocării, apelul C n-a scris nimic (rândurile 41–43 neschimbate)"
# Eliberăm blocarea: C își termină scrierea DUPĂ COMMIT-ul opririi (REVOKE nu anulează un apel început).
ses L "COMMIT;"; ses_asteapta C __C_GATA
grep -q '^C_rezultat=' "$BASE/ses_C.out" || { cat "$BASE/ses_C.out" >&2; esec "14f apelul C a căzut (așteptam să termine)"; }
INV1=$(sql "SELECT t.inv_row(41) || ';' || t.inv_row(42) || ';' || t.inv_row(43)")
[ "$INV1" != "$INV0" ] && [ "$INV1" = '-|lipsa_din_registru|-|-;-|lipsa_din_registru|-|-;-|lipsa_din_registru|-|-' ] || esec "14f scrierea lui C: $INV1"
ok "14f CONSTATARE: apelul început înainte de oprire și-a terminat scrierea DUPĂ COMMIT-ul opririi ($(grep '^C_rezultat=' "$BASE/ses_C.out")); cu protecțiile patch-ului (p_prag=0 → 0.45, golurile 41–43 = lipsă). Oprirea NU se declară efectivă înainte de încheierea și reconcilierea apelurilor în curs (docs §12.3)"
p=$(ses_de_la C); ses C "SELECT * FROM public.ofertare_inventar_pereche(40, 'gemini', 1, 0);"
ses_dupa C "$p" | grep -q 'permission denied' || esec "14g C, al doilea apel"
ok "14g aceeași conexiune C, apel NOU după oprire → permission denied"
e_stare oprire "14g starea tot „oprire”"

# Repornirea (conexiune nouă), apoi aceleași conexiuni existente.
R=$(armare_ramasa_dupa "$REP" "$C_RP" "$V_RP") || { cat "$BASE/rev.err" >&2; esec "14h repornirea"; }
e_stare patch "14h repornirea comisă; verificată separat"
sql "SELECT t.reset_fixture()" >/dev/null
p=$(ses_de_la A); ses A "$(CA_ID $U_OWNER) SELECT 'A_owner_rep=' || ales_id FROM public.fn_ofertare_alege_acoperire(1003);"
ses_dupa A "$p" | grep -qx 'A_owner_rep=1003' || { ses_dupa A "$p" >&2; esec "14i owner după repornire"; }
p=$(ses_de_la B); ses B "$(CA_ID $U_MOD) SELECT 'B_mod_rep=' || ales_id FROM public.fn_ofertare_alege_acoperire(1002);"
ses_dupa B "$p" | grep -qx 'B_mod_rep=1002' || { ses_dupa B "$p" >&2; esec "14i cu modul după repornire"; }
ok "14i după REPORNIRE, în conexiunile existente: owner și utilizatorul cu modul trec"
p=$(ses_de_la B); ses B "$(CA_ID $U_NOMOD) SELECT * FROM public.fn_ofertare_alege_acoperire(2001);"
ses_dupa B "$p" | grep -q 'modulul Ofertare' || { ses_dupa B "$p" >&2; esec "14j fără modul după repornire"; }
p=$(ses_de_la B); ses B "$(CA_ID -) SELECT * FROM public.ofertare_inventar_pereche(10);"
ses_dupa B "$p" | grep -q 'autentificat' || { ses_dupa B "$p" >&2; esec "14j fără uid după repornire"; }
ok "14j după REPORNIRE: fără modul → 42501 „modulul Ofertare”, fără uid → 42501 „autentificat” (poarta patch-ului)"
for n in A B C L; do ses_stop $n; done
# Protecțiile patch-ului identice după repornire (respins_de_om, confirmat_de_om, p_prag=0).
SCEN_REP=$(scenariu_protectii)
[ "$SCEN_REP" = "$SCEN_PATCH" ] || { diff <(tr ';' '\n' <<<"$SCEN_PATCH") <(tr ';' '\n' <<<"$SCEN_REP") >&2 || true; esec "14k scenariul protecțiilor după repornire ≠ patch"; }
UMANE="SELECT t.inv_row(3) || ';' || t.inv_row(6) || ';' || t.inv_row(4) || ';' || t.inv_row(44)"
DUPA=$(sql "$UMANE"); sql "SELECT t.reset_fixture()" >/dev/null; INITIAL=$(sql "$UMANE")
[ "$DUPA" = "$INITIAL" ] && grep -q 'respins_de_om' <<<"$DUPA" && grep -q 'confirmat_de_om' <<<"$DUPA" || esec "14k verdictele umane: $DUPA ≠ $INITIAL"
ok "14k după REPORNIRE, scenariul p_prag=0 cu respins_de_om/confirmat_de_om dă EXACT rezultatul de pe patch (instantaneu identic); verdictele umane neatinse"
[ -n "${SCEN_LIVE:-}" ] && [ "$SCEN_LIVE" != "$SCEN_PATCH" ] || esec "14k vacuitate: scenariul pe LIVE trebuia să difere"
ok "14k discriminare: același scenariu pe starea LIVE (pas 11) dă alt rezultat (rescrie respins_de_om / ascunde golurile)"
e_stare patch "14 final"
curata_persistente

printf '\n\033[32mTOATE TESTELE AU TRECUT\033[0m — %d verificări OK\n' "$N_OK"
