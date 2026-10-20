#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261102a_izometrie_e2a_registru (registrul de țeavă Transgaz, E2a). EXCLUSIV pe un PostgreSQL local
# dedicat (implicit PG16, /tmp/pg_izo_e2a, 127.0.0.1:5982). Nu atinge producția.
#   0. schelet (supabase/tests/izometrie_e2a_schelet.sql) + gate 0e; blocul <amprenta> identic în migrare și revenire
#   1. migrarea fără runner → garda refuză, nimic creat (și cu psql -f simplu, autocommit)
#   2. precondiții negative: CHECK stare diferit de live · rol preexistent · CREATE pe public pentru authenticated
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + validator + gate 0e) → cod 0; amprenta fixată în revenire
#   4. teste SQL (supabase/tests/izometrie_e2a.test.sql): garda (authenticated / service_role / DEFINER postgres / writer fără
#      marcaj), registrul doar-adaug, importul (idempotent, conflict, R1, perete, sursă, depozit, curbe), storno fail-closed,
#      căile 3 și 9, regresia pozitivă (producție gazpet, recepție LOT 1), citirea pe proiect
#   4b. import concurent cu același import_id din două sesiuni → un singur efect
#   4c. conexiune proaspătă: writer fără marcaj → garda · REPEATABLE READ → refuz
#   4d. curse cu două conexiuni: activare ↔ recepție, dezactivare ↔ import (lock-ul pe proiect)
#   5. reaplicare → refuz
#   6. revenire: nearmată → refuz · cu date → refuz · pe o bază curată (migrare fără date): amprentă modificată → refuz;
#      armată → totul scos, CHECK-urile revin la forma live, rândurile gazpet neatinse, gate 0e = 0
# Utilizare: bash scripts/test_izometrie_e2a.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_izo_e2a}"
PORT="${PGPORT_TEST:-5982}"
BAZA=izo_e2a_test
BAZA2=izo_e2a_curata_test
NUME=20261102a_izometrie_e2a_registru
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/izometrie_e2a_schelet.sql"
TESTE="$RADACINA/supabase/tests/izometrie_e2a.test.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
case "$DATE_DIR" in /tmp/pg_izo_e2a*) ;; *) mediu "PGDATA_TEST trebuie să fie sub /tmp/pg_izo_e2a* (primit: $DATE_DIR)";; esac
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_izo_e2a" ] || mediu "$DATE_DIR există și nu e marcat ca fixture (.fixture_izo_e2a) — nu îl șterg"
  if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; fi
  rm -rf "$DATE_DIR"
fi
mkdir -p "$DATE_DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_izo_e2a"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_izo_e2a.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q()  { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
q2() { "${PSQL[@]}" -d "$BAZA2" -Atc "$1"; }
gate_0e() { local o; o="$("${PSQL[@]}" -d "${2:-$BAZA}" -At -f "$RADACINA/scripts/control_0e.sql")" || esec "gate 0e: psql a eșuat"; [ -z "$o" ] || esec "gate 0e: $o"; ok "gate 0e = 0 ($1)"; }
refuza_cu() { local out; if out="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1)"; then esec "$1 a trecut"; fi
  grep -q "$2" <<<"$out" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$out")"; }
revenire() { "${PSQL[@]}" -d "${1:-$BAZA}" --single-transaction -c "SELECT set_config('gazpet.revenire_20261102a', 'IZO_E2A_SCOATE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1; }
livreaza() { local sha sis rc=0
  sha="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
  sis="$("${PSQL[@]}" -d "$1" -Atc "SELECT system_identifier FROM pg_control_system()")"
  PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$sha" --versiune "$2" \
    --tinta-db "$1" --tinta-sistem "$sis" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/izo_e2a_runner.out 2>&1 || rc=$?
  [ "$rc" = 0 ] || { cat /tmp/izo_e2a_runner.out >&2; esec "runner cod $rc pe $1"; }
  echo "$sha"; }
obiecte_izo() { "${PSQL[@]}" -d "${1:-$BAZA}" -Atc "SELECT (SELECT count(*) FROM pg_roles WHERE rolname = 'izo_registru_writer')
  + (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\_izo\_%')
  + (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND (relname LIKE 'izo\_%' OR relname LIKE 'magazie\_bucati\_evenimente%'))
  + (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'magazie_bucati' AND column_name = 'tip_cod')"; }

for B in "$BAZA" "$BAZA2"; do
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE $B" >/dev/null
  "${PSQL[@]}" -d "$B" -f "$SCHELET" >/dev/null
done
gate_0e inainte
bloc_amprenta() { sed -n '/-- <amprenta>/,/-- <\/amprenta>/p' "$1" | grep -v ' INTO v_' | sed 's/^[[:space:]]*//'; }
[ -n "$(bloc_amprenta "$MIGRARE")" ] && [ "$(bloc_amprenta "$MIGRARE")" = "$(bloc_amprenta "$ROLLBACK")" ] || esec "0b expresia <amprenta> diferă între migrare și revenire"
ok "0 schelet (default privileges ca pe live) · 0b expresia de amprentă identică textual în migrare și revenire"

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
[ "$(obiecte_izo)" = 0 ] || esec "1 ceva s-a creat"
"$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 || true
[ "$(obiecte_izo)" = 0 ] || esec "1b psql -f simplu a creat obiecte"
ok "1 fără runner → refuz, nimic creat (și cu psql -f simplu, autocommit)"

q "ALTER TABLE public.magazie_bucati DROP CONSTRAINT magazie_bucati_stare_check, ADD CONSTRAINT magazie_bucati_stare_check CHECK (stare IN ('sosit','receptionat','rezervata','montata','consumata','retur','altceva'))" >/dev/null
refuza_cu "2a CHECK stare diferit de live" "Precondiție 0c"
q "ALTER TABLE public.magazie_bucati DROP CONSTRAINT magazie_bucati_stare_check, ADD CONSTRAINT magazie_bucati_stare_check CHECK (stare = ANY (ARRAY['sosit'::text, 'receptionat'::text, 'rezervata'::text, 'montata'::text, 'consumata'::text, 'retur'::text]))" >/dev/null
q "CREATE ROLE izo_registru_writer NOLOGIN" >/dev/null
refuza_cu "2b rol preexistent" "Precondiție 0b"
q "DROP ROLE izo_registru_writer" >/dev/null
q "GRANT CREATE ON SCHEMA public TO authenticated" >/dev/null
refuza_cu "2c CREATE pe public pentru authenticated" "Precondiție 0e"
q "REVOKE CREATE ON SCHEMA public FROM authenticated" >/dev/null
[ "$(obiecte_izo)" = 0 ] || esec "2 ceva a rămas"
ok "2 refuz la: CHECK stare diferit de live · rol preexistent · CREATE pe public"

SHA="$(livreaza "$BAZA" 20261102120000)"
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA"
gate_0e dupa
AMPR="$(q "SELECT substring(obj_description('public.magazie_bucati_evenimente'::regclass, 'pg_class') FROM 'amprenta=([0-9a-f]{32})')")"
grep -q "'$AMPR'" "$ROLLBACK" || esec "3b amprenta harness-ului ($AMPR) nu e fixată în revenire (c_amprente)"
ok "3b amprenta harness-ului $AMPR e fixată în revenire"

OUT="$("${PSQL[@]}" -d "$BAZA" -f "$TESTE" 2>&1)" || { echo "$OUT" | grep -v 'NOTICE:  OK' | grep -E 'ERROR|TEST' >&2; esec "4 teste SQL"; }
N="$(grep -c 'NOTICE:  OK' <<<"$OUT")"
grep -q 'TESTE SQL: TOATE OK' <<<"$OUT" || esec "4 testele nu au ajuns la final"
ok "4 teste SQL: $N verificări OK"

# 4b. import concurent: două sesiuni, același import_id, același payload → un singur efect, a doua întoarce „duplicat”
PAY='{"surse":[{"fisier":"C.xlsx","sha256":"4444444444444444444444444444444444444444444444444444444444444444"}],"bucati":[{"tip":"teava","serie":"299CC00001","sarja":"SA1","lungime_mm":12000,"perete_mm":7.1,"stare":"sosit","depozit_id":9,"sursa":{"fisier":"C.xlsx","foaie":"F","rand":1}}]}'
INAINTE="$(q "SELECT count(*) FROM public.magazie_bucati WHERE tip_cod IS NOT NULL")"
( "${PSQL[@]}" -d "$BAZA" -Atc "BEGIN; SELECT public.fn_izo_import_sold_initial(3, 'conc-1', '$PAY'::jsonb)->>'duplicat'; SELECT pg_sleep(2); COMMIT;" >/tmp/izo_conc_a.out 2>&1 ) &
PID_A=$!
sleep 0.7
"${PSQL[@]}" -d "$BAZA" -Atc "SELECT public.fn_izo_import_sold_initial(3, 'conc-1', '$PAY'::jsonb)->>'duplicat'" >/tmp/izo_conc_b.out 2>&1 || { cat /tmp/izo_conc_b.out >&2; esec "4b sesiunea B a eșuat"; }
wait "$PID_A" || { cat /tmp/izo_conc_a.out >&2; esec "4b sesiunea A a eșuat"; }
grep -qx false /tmp/izo_conc_a.out || esec "4b sesiunea A nu a aplicat: $(cat /tmp/izo_conc_a.out)"
grep -qx true /tmp/izo_conc_b.out || esec "4b sesiunea B nu a întors duplicat: $(cat /tmp/izo_conc_b.out)"
[ "$(q "SELECT count(*) FROM public.magazie_bucati WHERE tip_cod IS NOT NULL")" = "$((INAINTE + 1))" ] || esec "4b efect dublu"
[ "$(q "SELECT count(*) FROM public.izo_importuri WHERE import_id = 'conc-1'")" = 1 ] || esec "4b două rânduri de import"
ok "4b import concurent cu același import_id: A aplică, B așteaptă și întoarce duplicat, un singur efect"

# 4c. conexiuni proaspete (GUC-ul marcajului nedefinit) și izolarea: writer fără marcaj → garda; REPEATABLE READ → refuz
nu_merge() { local out; if out="$("${PSQL[@]}" -d "$BAZA" -Atc "$2" 2>&1)"; then esec "$1 a trecut"; fi
  grep -q "$3" <<<"$out" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$out")"; }
nu_merge "4c1 writer fără marcaj, conexiune nouă: UPDATE bucată" \
  "SET ROLE izo_registru_writer; UPDATE public.magazie_bucati SET observatii = 'x' WHERE serie = '254CA09771'" "doar prin funcțiile registrului"
nu_merge "4c2 writer fără marcaj, conexiune nouă: INSERT în registru" \
  "SET ROLE izo_registru_writer; INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, motiv, server_ver) VALUES ('gasit', 3, 'x', 1)" "doar prin funcțiile registrului"
nu_merge "4c3 recepție beneficiar în REPEATABLE READ" \
  "BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-000000000030\"}', true); SET LOCAL ROLE authenticated; INSERT INTO public.magazie_bucati (proiect_id, tip_material_id, serie, provenienta) VALUES (1, 1, 'RR1', 'beneficiar'); COMMIT;" "READ COMMITTED"
nu_merge "4c4 funcție a registrului în REPEATABLE READ" \
  "BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test'); COMMIT;" "READ COMMITTED"
ok "4c conexiune proaspătă: writer fără marcaj → garda (UPDATE + INSERT) · REPEATABLE READ → refuz (recepție + funcție registru)"

# 4d. cursa activare ↔ recepție pe proiectul 2: recepția (lock partajat) ține pe loc activarea (lock exclusiv), care
#     apoi vede bucata comisă și refuză. Fără lock, activarea n-ar vedea bucata necomisă → bucată neurmărită sub stoc.
( "${PSQL[@]}" -d "$BAZA" -Atc "BEGIN; SELECT set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-000000000030\"}', true); SET LOCAL ROLE authenticated; INSERT INTO public.magazie_bucati (proiect_id, tip_material_id, serie, provenienta) VALUES (2, 1, 'CURSA1', 'beneficiar'); SELECT pg_sleep(2); COMMIT;" >/tmp/izo_cursa_a.out 2>&1 ) &
PID_A=$!
sleep 0.7
nu_merge "4d1 activare în timpul unei recepții beneficiar necomise" "SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'cursa')" "în afara registrului"
wait "$PID_A" || { cat /tmp/izo_cursa_a.out >&2; esec "4d1 recepția a eșuat"; }
[ "$(q "SELECT public.fn_izo_nivel(2) || ':' || count(*) FROM public.magazie_bucati WHERE serie = 'CURSA1'")" = "off:1" ] || esec "4d1 stare finală greșită"
q "DELETE FROM public.magazie_bucati WHERE serie = 'CURSA1'" >/dev/null
# cursa dezactivare ↔ import: importul (lock exclusiv) ține pe loc „off”, care apoi vede faptele și refuză
q "SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'cursa b')" >/dev/null
PAY2='{"surse":[{"fisier":"C.xlsx","sha256":"5555555555555555555555555555555555555555555555555555555555555555"}],"bucati":[{"tip":"teava","serie":"299CC00002","sarja":"SA2","lungime_mm":12000,"perete_mm":7.1,"stare":"sosit","depozit_id":4,"sursa":{"fisier":"C.xlsx","foaie":"F","rand":1}}]}'
( "${PSQL[@]}" -d "$BAZA" -Atc "BEGIN; SELECT public.fn_izo_import_sold_initial(2, 'cursa-b', '$PAY2'::jsonb)->>'duplicat'; SELECT pg_sleep(2); COMMIT;" >/tmp/izo_cursa_b.out 2>&1 ) &
PID_A=$!
sleep 0.7
nu_merge "4d2 dezactivare în timpul unui import necomis" "SELECT public.fn_izo_seteaza_nivel(2, 'off', 'cursa')" "fapte în registru"
wait "$PID_A" || { cat /tmp/izo_cursa_b.out >&2; esec "4d2 importul a eșuat"; }
grep -qx false /tmp/izo_cursa_b.out || esec "4d2 importul nu a aplicat: $(cat /tmp/izo_cursa_b.out)"
[ "$(q "SELECT public.fn_izo_nivel(2) || ':' || count(*) FROM public.magazie_bucati WHERE serie = '299CC00002' AND tip_cod = 'teava'")" = "stoc:1" ] || esec "4d2 stare finală greșită"
ok "4d curse pe proiectul 2: activare ↔ recepție → activarea așteaptă și refuză · dezactivare ↔ import → „off” așteaptă și refuză"

refuza_cu "5 reaplicare" "Precondiție 0b"
ok "5 reaplicare → refuz"

OUT="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" 2>&1)" && esec "6a revenire nearmată a trecut"
grep -q "nearmată" <<<"$OUT" || esec "6a refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
OUT="$(revenire)" && esec "6b revenire cu date a trecut"
grep -q "date reale" <<<"$OUT" || esec "6b refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
"$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -f "$ROLLBACK" >/dev/null 2>&1 || true
[ "$(q "SELECT count(*) FROM public.magazie_bucati_evenimente")" -gt 0 ] || esec "6c psql -f simplu a șters registrul"
ok "6a–c revenire: nearmată → refuz · cu date → refuz · psql -f simplu → nimic pierdut"

# 6d–f pe baza curată (migrare fără date). Rolul e la nivel de cluster: prima bază (cu registru plin) se șterge,
# împreună cu rolul rămas fără obiecte, ca baza curată să pornească de la starea de dinainte de migrare.
"${PSQL[@]}" -d postgres -c "DROP DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d postgres -c "DROP ROLE izo_registru_writer" >/dev/null
livreaza "$BAZA2" 20261102120000 >/dev/null
q2 "ALTER TABLE public.izo_atribuiri ADD COLUMN extra text" >/dev/null
OUT="$(revenire "$BAZA2")" && esec "6d revenire pe obiecte modificate a trecut"
grep -q "amprenta obiectelor izo diferă" <<<"$OUT" || esec "6d refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
q2 "ALTER TABLE public.izo_atribuiri DROP COLUMN extra" >/dev/null
q2 "ALTER POLICY magbuc_izo_client_upd ON public.magazie_bucati USING (true)" >/dev/null
OUT="$(revenire "$BAZA2")" && esec "6e revenire după ALTER POLICY a trecut"
grep -q "amprenta obiectelor izo diferă" <<<"$OUT" || esec "6e refuzat din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
q2 "ALTER POLICY magbuc_izo_client_upd ON public.magazie_bucati USING (NOT ((provenienta = 'beneficiar'::text) AND (public.fn_izo_nivel(proiect_id) <> 'off'::text)))" >/dev/null
GAZ_INAINTE="$(q2 "SELECT md5(string_agg(id || serie || stare || coalesce(proiect_id::text,''), ',' ORDER BY id)) FROM public.magazie_bucati")"
OUT="$(revenire "$BAZA2")" || { echo "$OUT" >&2; esec "6f revenirea armată pe baza curată a eșuat"; }
[ "$(obiecte_izo "$BAZA2")" = 0 ] || esec "6f obiecte izo rămase"
[ "$(q2 "SELECT md5(string_agg(id || serie || stare || coalesce(proiect_id::text,''), ',' ORDER BY id)) FROM public.magazie_bucati")" = "$GAZ_INAINTE" ] || esec "6f rândurile existente s-au schimbat"
[ "$(q2 "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'magazie_bucati_stare_check'")" = "CHECK ((stare = ANY (ARRAY['sosit'::text, 'receptionat'::text, 'rezervata'::text, 'montata'::text, 'consumata'::text, 'retur'::text])))" ] || esec "6f CHECK stare nerefăcut"
gate_0e "revenire" "$BAZA2"
ok "6d–f revenire: amprentă modificată / politică slăbită → refuz · armată pe bază curată → totul scos, CHECK-urile ca pe live, rândurile existente neatinse"
echo "PASS test_izometrie_e2a"
