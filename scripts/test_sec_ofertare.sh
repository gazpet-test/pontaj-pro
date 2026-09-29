#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Test PG16 LOCAL pentru patch-ul 20261003b (Ofertare (2)+(3)). Nu atinge Supabase.
#   bash scripts/test_sec_ofertare.sh            # rulează tot și oprește clusterul la final
#   KEEP=1 bash scripts/test_sec_ofertare.sh     # lasă clusterul pornit (depanare)
#   PGPORT=5461 PGBASE=/tmp/pg_x bash …          # alt port / alt cluster (implicit 5441, /tmp/pg_sec_ofertare)
#   MIG=… RB=… OP=… TEST=… bash …                # alte fișiere (analiza de mutanți pe fișiere)
# Cluster dedicat: PGDATA $PGBASE/data, doar 127.0.0.1, baza sec_ofertare_test.
# Ca root, initdb/pg_ctl rulează prin „su postgres”; psql e client TCP (-U postgres, trust local).
#
# Ordinea (cerută de Copilot, extinsă în runda 2 cu testele verificatorului VG1–VG3):
#   setup (copia LIVE) → gaura pe copia live → migrare (md5 = lista albă) → teste + runda 2 →
#   rollback tehnic NEARMAT (refuzat) → VG1 armare persistentă (refuzată) → rollback tehnic armat →
#   gaura + suitele patch/runda 2 CAD pe live (test cu test) → precondiții negative + VG3 din live →
#   reaplicare → teste → VG2 versiune ulterioară cu marker (refuzată) + VG3 peste ea →
#   revenire operațională nearmată / armată greșit (refuzate) → armată → teste poartă →
#   VG3 din starea operațională (refuzată) → reaplicare → teste → urma din jurnalul Postgres.
# Aplicările „ca apply_migration” trimit linia de armare + fișierul într-un SINGUR query (o
# tranzacție implicită pe care BEGIN-ul din fișier o preia). Așa presupunem că le trimite Supabase;
# neobservat direct — dacă nu, SET LOCAL rămâne în afara tranzacției și revenirea refuză (fail-closed).
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
RB="${RB:-$ROOT/supabase/migrations/20261003b_sec_ofertare_porti_alege_inventar_ROLLBACK.sql}"
OP="${OP:-$ROOT/supabase/migrations/20261003b_sec_ofertare_porti_alege_inventar_REVENIRE_OPERATIONALA.sql}"
TEST="${TEST:-$ROOT/supabase/tests/sec_ofertare_porti.test.sql}"
ARM="SET gazpet.rollback_tehnic_20261003b = 'REDESCHIDE_BYPASS';"
ARM_OP="SET LOCAL gazpet.revenire_operationala_20261003b = 'PASTREAZA_POARTA';"
# md5(pg_get_functiondef) „alege pereche”, PG16. Aceleași valori stau în listele albe din fișiere.
LIVE_MD5="6c9995646a6dbe6da995e48a3a885fc9 500263dacba2b44e0caa1cb07db88d6e"
PATCH_MD5="1da7260d85e2441d93876c1c590d9f99 9cf65390fb07c4f84e508a511f8dbd9f"
OP_MD5="d1a1a2a45cf57046cf7c26dc981c310f 770c29d8066d3003fc0355fc93e7f3fb"

for f in "$MIG" "$RB" "$OP" "$TEST"; do [ -f "$f" ] || { echo "Lipsește $f" >&2; exit 2; }; done
[ -x "$PGBIN/postgres" ] || { echo "PostgreSQL 16 lipsește în $PGBIN" >&2; exit 2; }

ca_pg() {  # rulează ca utilizatorul postgres (initdb/pg_ctl refuză root)
  if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi
}
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U postgres)
pas() { printf '\n\033[1m── %s\033[0m\n' "$*"; }
esec() { printf '\n\033[31mEȘEC: %s\033[0m\n' "$*" >&2; exit 1; }
ok() { echo "  OK  $*"; }
primul_esec() { sed -n 's/.*TEST EȘUAT: //p' "$1" | sed 's/ — .*//' | head -1; }
faza() { "${PSQL[@]}" -d "$DB" -o /dev/null -v faza="$1" ${2:+-v doar="$2"} -f "$TEST" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /; s/^NOTICE:  /  /'; return "${PIPESTATUS[0]}"; }
aplica() { "${PSQL[@]}" -d "$DB" -f "$1"; }   # fișierele au BEGIN/COMMIT proprii
ca_apply() { "${PSQL[@]}" -d "$DB" -Atc "$1
$(cat "$2")
${3:-}"; }                                    # ca apply_migration: armare + fișier (+ SQL de control) într-un singur query
sql() { "${PSQL[@]}" -d "$DB" -Atc "$1"; }
sql_pg() { "${PSQL[@]}" -d postgres -c "$1" >/dev/null; }
stare() {  # md5-urile curente „alege pereche”
  sql "SELECT md5(pg_get_functiondef('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure)) || ' ' || md5(pg_get_functiondef('public.ofertare_inventar_pereche(bigint,text,integer,real)'::regprocedure))"
}
refuzat() {  # refuzat <eticheta> <fragment-mesaj> <comanda…>: comanda TREBUIE să cadă, cu mesajul dat, fără urme
  local et="$1" frag="$2"; shift 2
  local inainte; inainte=$(stare)
  if "$@" >"$BASE/ref.out" 2>&1; then cat "$BASE/ref.out" >&2; esec "$et: a trecut, trebuia refuzat"; fi
  grep -q -- "$frag" "$BASE/ref.out" || { cat "$BASE/ref.out" >&2; esec "$et: refuzat, dar fără mesajul „$frag”"; }
  [ "$(stare)" = "$inainte" ] || esec "$et: refuzul a lăsat urme ($(stare))"
  ok "$et [$(grep -o -- "$frag" "$BASE/ref.out" | head -1)…]"
}
# Versiune ulterioară simulată (VG2): o linie în plus în corp, markerul SEC-20261003b rămâne.
HOT_ALEGE="SELECT replace(pg_get_functiondef('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure), '  -- Poarta verifică înainte de orice citire', E'  -- HOTFIX_ULTERIOR (SEC-20261003b v3): îngheț pe status, adăugat după patch\n  -- Poarta verifică înainte de orice citire')"
HOT_PERECHE="SELECT replace(pg_get_functiondef('public.ofertare_inventar_pereche(bigint,text,integer,real)'::regprocedure), '  -- implicit: cea mai recenta rulare', E'  -- HOTFIX_ULTERIOR (SEC-20261003b v3): alt criteriu de rulare, adăugat după patch\n  -- implicit: cea mai recenta rulare')"
hotfix() { sql "DO \$h\$ DECLARE d text := ($1); BEGIN IF position('HOTFIX_ULTERIOR' IN d) = 0 THEN RAISE EXCEPTION 'hotfix neinjectat'; END IF; EXECUTE d; END \$h\$" >/dev/null; }
anuleaza_hotfix() { sql "DO \$h\$ BEGIN EXECUTE regexp_replace(pg_get_functiondef('$1'::regprocedure), E'  -- HOTFIX_ULTERIOR[^\\n]*\\n', ''); END \$h\$" >/dev/null; }
curata_persistente() {  # ALTER ROLE e la nivel de cluster: supraviețuiește recreării bazei; ștergem exact ce am pus
  sql_pg "DO \$c\$ DECLARE r record; BEGIN
    FOR r IN SELECT d.datname, ro.rolname, split_part(c, '=', 1) AS nume
               FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) c
               LEFT JOIN pg_database d ON d.oid = s.setdatabase LEFT JOIN pg_roles ro ON ro.oid = s.setrole
              WHERE lower(split_part(c, '=', 1)) IN ('gazpet.rollback_tehnic_20261003b', 'gazpet.revenire_operationala_20261003b') LOOP
      IF r.datname IS NULL THEN EXECUTE format('ALTER ROLE %I RESET %I', r.rolname, r.nume);
      ELSIF r.rolname IS NULL THEN EXECUTE format('ALTER DATABASE %I RESET %I', r.datname, r.nume);
      ELSE EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET %I', r.rolname, r.datname, r.nume); END IF;
    END LOOP; END \$c\$"
}

# ── Cluster dedicat ────────────────────────────────────────────────────────────
pas "Cluster PG16 dedicat pe 127.0.0.1:$PGPORT ($PGDATA)"
if ! "$PGBIN/pg_isready" -q -h 127.0.0.1 -p "$PGPORT"; then
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$BASE"
    [ "$(id -u)" = 0 ] && chown postgres:postgres "$BASE"
    chmod 700 "$BASE"
    ca_pg "'$PGBIN/initdb' -D '$PGDATA' -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null"
  fi
  ca_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -l '$LOG' -w -o \"-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$BASE -c timezone=UTC\" start >/dev/null"
  PORNIT_DE_NOI=1
else
  PORNIT_DE_NOI=0
fi
oprire() {
  curata_persistente 2>/dev/null || true   # și la eșec: nicio armare persistentă nu rămâne în cluster
  if [ "${KEEP:-0}" != 1 ] && [ "$PORNIT_DE_NOI" = 1 ]; then ca_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -m fast -w stop >/dev/null" || true; fi
}
trap oprire EXIT
V=$("${PSQL[@]}" -d postgres -Atc "SELECT current_setting('server_version_num')::int / 10000")
[ "$V" = 16 ] || esec "Pe portul $PGPORT răspunde PG $V, nu 16"
LOG_START=$( [ -f "$LOG" ] && stat -c %s "$LOG" || echo 0 )

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
curata_persistente

pas "0. Listele albe md5 din fișiere = valorile verificate aici (PG16)"
for h in $LIVE_MD5 $PATCH_MD5 $OP_MD5; do grep -q "'$h'" "$MIG" || esec "lista albă a migrării nu conține $h"; done
for h in $PATCH_MD5; do grep -q "'$h'" "$OP" || esec "precondiția revenirii nu conține $h"; done
for h in $LIVE_MD5 $PATCH_MD5 $OP_MD5; do grep -q "'$h'" "$RB" || esec "precondiția rollback-ului nu conține $h"; done
ok "migrare: live + patch + revenire; revenire: patch; rollback: patch + revenire + live"

pas "1. Setup: schelet + funcțiile LIVE din 29.09 (md5 = live) + ACL live"
faza setup || esec "setup"

pas "2. GAURA pe copia live (înainte de patch)"
faza gaura || esec "gaura pe starea live"

pas "3. Migrare 20261003b (din starea live)"
aplica "$MIG" || esec "migrarea"
[ "$(stare)" = "$PATCH_MD5" ] || esec "md5 după migrare ($(stare)) ≠ PATCH_MD5: listele albe din fișiere trebuie recalculate"
ok "md5 după migrare = PATCH_MD5 (cel din listele albe)"
pas "3b. Migrare aplicată a doua oară (idempotentă, din starea patch-ului)"
aplica "$MIG" || esec "reaplicarea migrării"
[ "$(stare)" = "$PATCH_MD5" ] || esec "reaplicarea a schimbat md5"
ok "reaplicare idempotentă"

pas "4. Teste obligatorii pe patch + runda 2"
faza patched || esec "teste patched"
faza runda2 || esec "teste runda 2"

pas "5. ROLLBACK TEHNIC nearmat → trebuie refuzat, fără efect"
refuzat "rollback tehnic nearmat" "ROLLBACK TEHNIC 20261003b blocat: redeschide bypass-ul" aplica "$RB"
[ "$(stare)" = "$PATCH_MD5" ] || esec "patch-ul nu mai e activ după refuz"
ok "patch-ul a rămas activ"

pas "5b. VG1 — armare PERSISTENTĂ (ALTER DATABASE/ROLE … SET) → rollback-ul și revenirea refuză"
sql_pg "ALTER DATABASE $DB SET gazpet.rollback_tehnic_20261003b = 'REDESCHIDE_BYPASS'"
[ "$(sql "SELECT current_setting('gazpet.rollback_tehnic_20261003b', true)")" = REDESCHIDE_BYPASS ] || esec "VG1: armarea persistentă nu s-a văzut într-o sesiune nouă"
ok "VG1 sesiune nouă: comutatorul vine armat din pg_db_role_setting (scenariul verificatorului)"
refuzat "VG1 ALTER DATABASE SET, fișierul rulat FĂRĂ linia SET" "armat PERSISTENT" aplica "$RB"
refuzat "VG1 ALTER DATABASE SET + linia SET în apply" "armat PERSISTENT" ca_apply "$ARM" "$RB"
sql_pg "ALTER DATABASE $DB RESET gazpet.rollback_tehnic_20261003b"
sql_pg "ALTER ROLE postgres SET \"GAZPET.Rollback_Tehnic_20261003b\" = 'REDESCHIDE_BYPASS'"
refuzat "VG1 ALTER ROLE SET (nume cu majuscule, între ghilimele)" "armat PERSISTENT" ca_apply "$ARM" "$RB"
curata_persistente
sql_pg "ALTER DATABASE $DB SET gazpet.revenire_operationala_20261003b = 'PASTREAZA_POARTA'"
refuzat "VG1 revenirea: ALTER DATABASE SET + SET LOCAL în apply" "armat PERSISTENT" ca_apply "$ARM_OP" "$OP"
sql_pg "ALTER DATABASE $DB RESET gazpet.revenire_operationala_20261003b"
[ "$(sql "SELECT count(*) FROM pg_db_role_setting, unnest(setconfig) c WHERE lower(c) LIKE 'gazpet.%'")" = 0 ] || esec "VG1: au rămas setări persistente"
[ "$(stare)" = "$PATCH_MD5" ] || esec "VG1: starea s-a schimbat"
ok "VG1 setările persistente șterse, patch-ul neatins"

pas "6. ROLLBACK TEHNIC armat (ca apply_migration) → reproduce gaura"
REZ=$(ca_apply "$ARM" "$RB" "SELECT 'armare_ramasa=[' || coalesce(current_setting('gazpet.rollback_tehnic_20261003b', true), '') || ']'" 2>"$BASE/rb.err") || { cat "$BASE/rb.err" >&2; esec "rollback-ul tehnic armat"; }
sed 's/^/  /' "$BASE/rb.err"
[ "$(stare)" = "$LIVE_MD5" ] || esec "după rollback md5 ≠ live ($(stare))"
ok "md5 după rollback = starea live din 29.09"
[ "$(tail -1 <<<"$REZ")" = "armare_ramasa=[]" ] || esec "comutatorul rollback-ului a rămas armat în sesiune: $REZ"
ok "comutatorul s-a dezarmat în sesiunea apply-ului"
faza gaura || esec "gaura după rollback tehnic"
# Testele nu sunt „vacuu adevărate”: pe starea live, suitele patched și runda 2 TREBUIE să cadă.
if faza patched >"$BASE/vacuu.out" 2>&1; then esec "suita patched a trecut pe starea live (testele nu prind gaura)"; fi
grep -q "TEST EȘUAT" "$BASE/vacuu.out" || { cat "$BASE/vacuu.out" >&2; esec "suita patched a căzut din alt motiv decât o aserțiune"; }
ok "suita patched CADE pe starea live: $(primul_esec "$BASE/vacuu.out")"
# Runda 2, test cu test. Pe live, VD4 și VD5 TREBUIE să cadă (gaura e acolo); VD6, VE1, VE2 trec și pe
# live (live-ul nu atingea confirmat_de_om și recalcula rândurile cu verdict de mașină) — pe acelea le
# discriminează v1 și mutanții (docs §10).
for t in VD4:pica VD5:pica VD6:trece VE1:trece VE2:trece; do
  id=${t%%:*}; astept=${t##*:}
  if faza runda2 "$id" >"$BASE/r2_$id.out" 2>&1; then rez=trece; else rez=pica
    grep -q "TEST EȘUAT" "$BASE/r2_$id.out" || { cat "$BASE/r2_$id.out" >&2; esec "$id pe live a căzut din alt motiv decât o aserțiune"; }
  fi
  [ "$rez" = "$astept" ] || { cat "$BASE/r2_$id.out" >&2; esec "$id pe live: $rez, așteptat $astept"; }
  ok "$id pe starea live: $rez$( [ "$rez" = pica ] && printf ' la „%s”' "$(primul_esec "$BASE/r2_$id.out")")"
done

pas "7. Precondiții negative: o versiune live neauditată NU se suprascrie (totul într-o tranzacție, anulată)"
if "${PSQL[@]}" -d "$DB" -1 -c "ALTER FUNCTION public.fn_ofertare_alege_acoperire(bigint) COST 101" -f "$MIG" 2>"$BASE/pre.err"; then
  esec "migrarea a suprascris o fn_ofertare_alege_acoperire neauditată"; fi
grep -q "Precondiție 20261003b: fn_ofertare_alege_acoperire" "$BASE/pre.err" || { cat "$BASE/pre.err" >&2; esec "precondiția alege"; }
ok "alege_acoperire schimbată între timp → migrarea refuză"
if "${PSQL[@]}" -d "$DB" -1 -c "ALTER FUNCTION public.ofertare_inventar_pereche(bigint,text,integer,real) COST 101" -f "$MIG" 2>"$BASE/pre.err"; then
  esec "migrarea a suprascris o ofertare_inventar_pereche neauditată"; fi
grep -q "Precondiție 20261003b: ofertare_inventar_pereche" "$BASE/pre.err" || { cat "$BASE/pre.err" >&2; esec "precondiția pereche"; }
ok "inventar_pereche schimbată între timp → migrarea refuză"
if "${PSQL[@]}" -d "$DB" -1 -c "ALTER FUNCTION public.fn_are_acces_ofertare() COST 101" -f "$MIG" 2>"$BASE/pre.err"; then
  esec "migrarea a mers peste o fn_are_acces_ofertare schimbată"; fi
grep -q "Precondiție 20261003b: fn_are_acces_ofertare" "$BASE/pre.err" || { cat "$BASE/pre.err" >&2; esec "precondiția acces"; }
ok "fn_are_acces_ofertare schimbată → migrarea refuză"
[ "$(stare)" = "$LIVE_MD5" ] || esec "o precondiție refuzată a lăsat urme"
ok "tranzacțiile refuzate n-au lăsat nimic"
refuzat "VG3 revenirea operațională armată, din starea LIVE" "doar din starea patch-ului" ca_apply "$ARM_OP" "$OP"

pas "8. Reaplicare migrare → teste"
aplica "$MIG" || esec "reaplicarea după rollback"
[ "$(stare)" = "$PATCH_MD5" ] || esec "md5 după reaplicare ≠ PATCH_MD5"
faza patched || esec "teste patched după reaplicare"
faza runda2 || esec "teste runda 2 după reaplicare"

pas "8b. VG2 — o versiune ULTERIOARĂ care poartă markerul SEC-20261003b NU se suprascrie"
hotfix "$HOT_ALEGE"
[ "$(stare)" != "$PATCH_MD5" ] && [ "$(sql "SELECT position('SEC-20261003b' IN pg_get_functiondef('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure)) > 0 AND position('HOTFIX_ULTERIOR' IN pg_get_functiondef('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure)) > 0")" = t ] || esec "VG2: hotfix-ul alege nu s-a aplicat"
ok "VG2 hotfix ulterior pe alege aplicat (markerul rămâne în corp)"
refuzat "VG2 migrarea peste alege ulterioară" "Precondiție 20261003b: fn_ofertare_alege_acoperire nu e în nicio stare cunoscută" aplica "$MIG"
refuzat "VG3 revenirea operațională armată, peste alege ulterioară" "doar din starea patch-ului" ca_apply "$ARM_OP" "$OP"
refuzat "VG2 rollback-ul tehnic armat, peste alege ulterioară" "starea curentă nu e nici patch-ul" ca_apply "$ARM" "$RB"
anuleaza_hotfix "public.fn_ofertare_alege_acoperire(bigint)"
hotfix "$HOT_PERECHE"
refuzat "VG2 migrarea peste pereche ulterioară" "Precondiție 20261003b: ofertare_inventar_pereche nu e în nicio stare cunoscută" aplica "$MIG"
refuzat "VG3 revenirea operațională armată, peste pereche ulterioară" "doar din starea patch-ului" ca_apply "$ARM_OP" "$OP"
anuleaza_hotfix "public.ofertare_inventar_pereche(bigint,text,integer,real)"
[ "$(stare)" = "$PATCH_MD5" ] || esec "VG2: după anularea hotfix-urilor md5 ≠ PATCH_MD5 ($(stare))"
ok "VG2 hotfix-urile anulate: md5 = PATCH_MD5"

pas "9. REVENIRE OPERAȚIONALĂ: nearmată / armată greșit → refuzată; armată → poarta rămâne închisă"
refuzat "VG3 revenirea NEARMATĂ" "Revenire operațională 20261003b nearmată" aplica "$OP"
# Linia SET LOCAL rătăcită în afara tranzacției (psql fără -1, înainte de BEGIN) nu armează nimic.
printf '%s\n' "$ARM_OP" | cat - "$OP" > "$BASE/op_armare_in_afara.sql"
refuzat "VG3 SET LOCAL în afara tranzacției (psql -f, înainte de BEGIN) → fail-closed" "Revenire operațională 20261003b nearmată" aplica "$BASE/op_armare_in_afara.sql"
refuzat "VG3 armare cu altă valoare" "Revenire operațională 20261003b nearmată" ca_apply "SET LOCAL gazpet.revenire_operationala_20261003b = 'da';" "$OP"
REZ=$(ca_apply "$ARM_OP" "$OP" "SELECT 'armare_ramasa=[' || coalesce(current_setting('gazpet.revenire_operationala_20261003b', true), '') || ']'") || esec "revenirea operațională armată"
[ "$(stare)" = "$OP_MD5" ] || esec "md5 după revenire ($(stare)) ≠ OP_MD5: listele albe trebuie recalculate"
ok "revenirea armată aplicată: md5 = OP_MD5 (cel din listele albe)"
[ "$(tail -1 <<<"$REZ")" = "armare_ramasa=[]" ] || esec "VG3: armarea revenirii a rămas în sesiune: $REZ"
ok "armarea revenirii (SET LOCAL) nu supraviețuiește COMMIT-ului"
faza operational || esec "teste revenire operațională"
refuzat "VG3 revenirea armată a doua oară (din starea operațională)" "doar din starea patch-ului" ca_apply "$ARM_OP" "$OP"

pas "10. Reaplicare migrare peste starea operațională → teste"
aplica "$MIG" || esec "reaplicarea după revenirea operațională"
[ "$(stare)" = "$PATCH_MD5" ] || esec "md5 după reaplicare ≠ PATCH_MD5"
faza patched || esec "teste patched finale"
faza runda2 || esec "teste runda 2 finale"

pas "11. Urma în jurnalul Postgres (RAISE LOG)"
NOU=$(tail -c +"$((LOG_START + 1))" "$LOG")
N_ALEGE=$(grep -c "SEC-20261003b alege_acoperire: cerinta=101 pozitie=<NULL> ales=1002 inlocuit=1001 inlocuit_ales_de=00000000-0000-4000-8000-000000000007 de=00000000-0000-4000-8000-000000000007" <<<"$NOU" || true)
N_PERECHE=$(grep -c "SEC-20261003b inventar_pereche: lic=10 furnizor=gemini versiune=1 prag_cerut=0 prag_aplicat=0.45 " <<<"$NOU" || true)
N_PERECHE40=$(grep -c "SEC-20261003b inventar_pereche: lic=40 furnizor=gemini versiune=1 prag_cerut=0.3 prag_aplicat=0.45 " <<<"$NOU" || true)
[ "$N_ALEGE" -ge 1 ] || esec "lipsește urma alegerii înlocuite din jurnal"
[ "$N_PERECHE" -ge 1 ] || esec "lipsește urma împerecherii (prag cerut 0 → aplicat 0.45) din jurnal"
[ "$N_PERECHE40" -ge 1 ] || esec "lipsește urma împerecherii pe licitația 40 (prag cerut 0.3 → aplicat 0.45) din jurnal"
ok "jurnal: alegere înlocuită (1001 → 1002, cine o făcuse + cine a schimbat) ×$N_ALEGE"
ok "jurnal: împerechere cu prag cerut 0 → aplicat 0.45 ×$N_PERECHE; cerut 0.3 → aplicat 0.45 ×$N_PERECHE40"
curata_persistente

printf '\n\033[32mTOATE TESTELE AU TRECUT\033[0m (migrare → teste → VG1 → rollback tehnic → gaura → reaplicare → VG2/VG3 → revenire operațională → teste → reaplicare → teste)\n'
