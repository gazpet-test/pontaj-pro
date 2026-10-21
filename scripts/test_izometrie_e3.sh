#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261103b_izometrie_e3_documente (Izometrie E3). EXCLUSIV pe un PostgreSQL local dedicat (PG16,
# /tmp/pg_izo_e2a_e3, 127.0.0.1:5983). Nu atinge producția.
#   1. baza principală: schelet E2a + extensia E3 → 20261102a → 20261102c → (poarta E2a veche salvată ca teste.porti_e2a_vechi)
#      → 20261103b prin runner (fără runner → refuz) + gate 0e; teste SQL (supabase/tests/izometrie_e3.test.sql)
#   2. diferențial: poarta nouă (închiderea rapidă) = poarta veche pe fiecare mutație (DEFINER direct / view / lanț de view-uri /
#      INVOKER chemat de DEFINER / citat / overload)
#   3. curse cu barieră: lock-ul „schemă” (operație E3 ↔ runner + DDL), în ambele ordini
#   4. reaplicare → refuz; revenire nearmată → refuz; cu fapte E3 → refuz
#   5. baza curată: E2a + 2c + E3 → revenirea E3 reface amprenta exactă → revenirile 2c și E2a trec
#   6. regresia E2a: E2a + E3 (fără 2c) → suita E2a (izometrie_e2a.test.sql) nemodificată
# Utilizare: bash scripts/test_izometrie_e3.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR=/tmp/pg_izo_e2a_e3
PORT=5983
BAZA=izo_e3_test; BAZA2=izo_e3_curata_test; BAZA3=izo_e3_regresie_test
MIG_A="$RADACINA/supabase/migrations/20261102a_izometrie_e2a_registru.sql"
MIG_C="$RADACINA/supabase/migrations/20261102c_izometrie_cai_vechi_stoc.sql"
MIG_E3="$RADACINA/supabase/migrations/20261103b_izometrie_e3_documente.sql"
REV_A="$RADACINA/supabase/revenire/20261102a_izometrie_e2a_registru_ROLLBACK.sql"
REV_C="$RADACINA/supabase/revenire/20261102c_izometrie_cai_vechi_stoc_ROLLBACK.sql"
REV_E3="$RADACINA/supabase/revenire/20261103b_izometrie_e3_documente_ROLLBACK.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_izo_e2a" ] || mediu "$DATE_DIR există și nu e marcat ca fixture — nu îl șterg"
  if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; fi
  rm -rf "$DATE_DIR"
fi
mkdir -p "$DATE_DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_izo_e2a"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_izo_e3.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q()  { "${PSQL[@]}" -d "${2:-$BAZA}" -Atc "$1"; }
gate_0e() { local o; o="$("${PSQL[@]}" -d "${2:-$BAZA}" -At -f "$RADACINA/scripts/control_0e.sql")" || esec "gate 0e: psql a eșuat"; [ -z "$o" ] || esec "gate 0e: $o"; ok "gate 0e = 0 ($1)"; }
livreaza() { local sha sis rc=0
  sha="$(sha256sum "$3" | cut -d' ' -f1)"
  sis="$("${PSQL[@]}" -d "$1" -Atc "SELECT system_identifier FROM pg_control_system()")"
  PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$3" --sha256 "$sha" --versiune "$2" \
    --tinta-db "$1" --tinta-sistem "$sis" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/izo_e3_runner.out 2>&1 || rc=$?
  [ "$rc" = 0 ] || { cat /tmp/izo_e3_runner.out >&2; esec "runner cod $rc pe $1 ($3)"; }; }
asteapta() { local i; for i in $(seq 1 150); do [ "$(q "$1")" = "${2:-1}" ] && return 0; sleep 0.1; done; return 1; }
# cursa cu barieră (advisory 99 ținut de un controlor): A rulează $2 și se oprește la barieră ținând ce a luat; B rulează $3 și
# trebuie să AȘTEPTE un lock; controlorul eliberează bariera; $4 ok|err, $5 tiparul în ieșirea lui B
cursa() { local et="$1" pa pb pc rc_b=0 ob
  PGAPPNAME=izo_ctrl "${PSQL[@]}" -d "$BAZA" -Atc "SELECT pg_advisory_lock(99); SELECT pg_sleep(300);" >/dev/null 2>&1 & pc=$!
  asteapta "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = 'izo_ctrl' AND l.locktype = 'advisory' AND l.objid = 99 AND l.granted" || esec "$et: controlor"
  PGAPPNAME=izo_A "${PSQL[@]}" -d "$BAZA" -Atc "BEGIN; $2; SELECT pg_advisory_xact_lock_shared(99); COMMIT;" >/tmp/izo_e3_a.out 2>&1 & pa=$!
  asteapta "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = 'izo_A' AND l.locktype = 'advisory' AND l.objid = 99 AND NOT l.granted" \
    || { kill "$pc" 2>/dev/null; cat /tmp/izo_e3_a.out >&2; esec "$et: A n-a ajuns la barieră"; }
  PGAPPNAME=izo_B "${PSQL[@]}" -d "$BAZA" -Atc "$3" >/tmp/izo_e3_b.out 2>&1 & pb=$!
  asteapta "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'izo_B' AND wait_event_type = 'Lock'" \
    || { q "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'izo_ctrl'" >/dev/null; wait "$pa" "$pb" 2>/dev/null; cat /tmp/izo_e3_b.out >&2; esec "$et: B nu a așteptat"; }
  q "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'izo_ctrl'" >/dev/null
  wait "$pc" 2>/dev/null || true
  wait "$pa" || { cat /tmp/izo_e3_a.out >&2; esec "$et: A a eșuat"; }
  wait "$pb" || rc_b=$?
  ob="$(cat /tmp/izo_e3_b.out)"
  if [ "$4" = ok ]; then [ "$rc_b" = 0 ] || { echo "$ob" >&2; esec "$et: B a eșuat"; }; else [ "$rc_b" != 0 ] || { echo "$ob" >&2; esec "$et: B a trecut"; }; fi
  grep -q -- "$5" <<<"$ob" || { echo "$ob" >&2; esec "$et: ieșirea lui B nu conține „$5”"; }; }
baza_noua() { "${PSQL[@]}" -d postgres -c "CREATE DATABASE $1" >/dev/null
  "${PSQL[@]}" -d "$1" -f "$RADACINA/supabase/tests/izometrie_e2a_schelet.sql" >/dev/null
  "${PSQL[@]}" -d "$1" -f "$RADACINA/supabase/tests/izometrie_e3_schelet.sql" >/dev/null; }

# ── 1. baza principală ──
baza_noua "$BAZA"
livreaza "$BAZA" 20261102120000 "$MIG_A"
livreaza "$BAZA" 20261102140000 "$MIG_C"
"${PSQL[@]}" -d "$BAZA" -f "$MIG_E3" >/dev/null 2>&1 && esec "1 E3 fără runner a trecut"
[ "$(q "SELECT count(*) FROM pg_roles WHERE rolname = 'izo_receptie_writer'")" = 0 ] || esec "1 ceva s-a creat fără runner"
livreaza "$BAZA" 20261103120000 "$MIG_E3"
gate_0e "după 20261103b"
OUT="$("${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e3.test.sql" 2>&1)" || { echo "$OUT" | grep -E 'ERROR|TEST|CONTEXT' >&2; esec "1 teste SQL E3"; }
grep -q 'TESTE E3: TOATE OK' <<<"$OUT" || esec "1 testele E3 nu au ajuns la final"
ok "1 E3 prin runner (fără runner → refuz), gate 0e, teste SQL: $(grep -c 'NOTICE:  OK' <<<"$OUT") verificări"

# ── 2. diferențial: închiderea nouă (rapidă, textul din migrare) = închiderea E2a (exact), pe fiecare mutație ──
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e3_inchidere.sql" >/dev/null
INCH="SELECT array_to_string(ARRAY(SELECT x::regclass::text FROM unnest(o_rel) x ORDER BY 1), ',') || ' / ' || array_to_string(ARRAY(SELECT x::regprocedure::text FROM unnest(o_fn) x ORDER BY 1), ',')
  || ' / ' || array_to_string(ARRAY(SELECT x::regprocedure::text FROM unnest(o_mut) x ORDER BY 1), ',') || ' / ' || array_to_string(o_mesaje, ',') FROM"
dif() { local et="$1" crea="$2" sterge="$3" v n d
  q "$crea" >/dev/null
  v="$(q "$INCH teste.inchidere_veche()")"; n="$(q "$INCH teste.inchidere_noua()")"
  d="$(q "SELECT count(*) FROM pg_proc p WHERE p.oid = ANY ((teste.inchidere_noua()).o_fn) AND p.prosecdef")"
  q "$sterge" >/dev/null
  [ "$v" = "$n" ] || esec "2 $et: închiderea veche [$v] ≠ cea nouă [$n]"
  [ "${4:-1}" = 0 ] || [ "$d" -gt 0 ] || esec "2 $et: mutația nu aduce niciun DEFINER în închidere (testul nu probează nimic)"; }
dif "DEFINER direct" "CREATE FUNCTION teste.leak1() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM public.magazie_bucati'" "DROP FUNCTION teste.leak1()"
dif "view fără security_invoker" "CREATE VIEW teste.v_reg AS SELECT id FROM public.magazie_bucati" "DROP VIEW teste.v_reg" 0
dif "lanț view → view → DEFINER" "CREATE VIEW teste.v1 WITH (security_invoker = on) AS SELECT id FROM public.magazie_bucati;
  CREATE VIEW teste.v2 WITH (security_invoker = on) AS SELECT id FROM teste.v1; CREATE VIEW teste.v3 WITH (security_invoker = on) AS SELECT id FROM teste.v2;
  CREATE FUNCTION teste.leak3() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM teste.v3'" "DROP FUNCTION teste.leak3(); DROP VIEW teste.v3; DROP VIEW teste.v2; DROP VIEW teste.v1"
dif "INVOKER chemat de DEFINER" "CREATE FUNCTION teste.f_inv() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.izo_atribuiri';
  CREATE FUNCTION teste.f_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT teste.f_inv()'" "DROP FUNCTION teste.f_def(); DROP FUNCTION teste.f_inv()"
dif "nume citat" "CREATE FUNCTION teste.leak4() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM \"public\".\"magazie_bucati_miscari\"'" "DROP FUNCTION teste.leak4()"
dif "overload" "CREATE FUNCTION teste.f_ov(integer) RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.izo_importuri';
  CREATE FUNCTION teste.f_ov(text) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
  CREATE FUNCTION teste.leak5() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT teste.f_ov(''x'')'" "DROP FUNCTION teste.leak5(); DROP FUNCTION teste.f_ov(integer); DROP FUNCTION teste.f_ov(text)"
dif "mutator de cale" "CREATE FUNCTION teste.f_mut() RETURNS void LANGUAGE plpgsql AS 'BEGIN PERFORM set_config(''search_path'', ''public'', true); END';
  CREATE FUNCTION teste.leak6() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = teste AS 'BEGIN PERFORM teste.f_mut(); RETURN (SELECT count(*) FROM public.magazie_bucati); END'" \
  "DROP FUNCTION teste.leak6(); DROP FUNCTION teste.f_mut()"
[ "$(q "SELECT cardinality(public.fn_izo_porti_lipsa())")" = 0 ] || esec "2 porțile nu au revenit complete"
ok "2 diferențial: poarta nouă (rapidă) = poarta E2a pe 7 mutații (DEFINER direct, view, lanț de 3 view-uri, INVOKER prin DEFINER, citat, overload, mutator)"

# ── 3. curse: lock-ul „schemă” ──
CA_J="SET SESSION AUTHORIZATION authenticator; SELECT teste.ca('00000000-0000-0000-0000-000000000030')"
ANTET="{\"proiect_id\":3,\"depozit_id\":11,\"sablon\":\"aviz_teava\",\"furnizor\":\"X\",\"nr_document\":\"CURSA\",\"data_document\":\"2026-10-21\"}"
cursa "3a operație E3 ținută → runner (cheia exclusivă) + DEFINER nou așteaptă" \
  "$CA_J; SELECT public.fn_izo_doc_salveaza(NULL, NULL, '$ANTET', '[]', NULL)" \
  "BEGIN; SELECT pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare')); CREATE FUNCTION teste.leak_c() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM public.magazie_bucati'; SELECT 'creat'; COMMIT;" ok "creat"
[ "$(q "SELECT count(*) FROM public.izo_documente_intrare WHERE nr_document = 'CURSA'")" = 1 ] || esec "3a operația E3 nu s-a aplicat"
q "DROP FUNCTION teste.leak_c()" >/dev/null
cursa "3b runner ținut (DEFINER nou creat) → operația E3 așteaptă, apoi poarta refuză" \
  "SELECT pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare')); CREATE FUNCTION teste.leak_d() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM public.magazie_bucati'" \
  "BEGIN; $CA_J; SELECT public.fn_izo_doc_salveaza(NULL, NULL, '$(sed 's/CURSA/CURSA2/' <<<"$ANTET")', '[]', NULL); COMMIT;" err "porțile registrului nu sunt complete"
q "DROP FUNCTION teste.leak_d()" >/dev/null
ok "3 curse cu barieră pe lock-ul „schemă” (pg_advisory_xact_lock pe aceeași cheie bigint ca runner-ul), ambele ordini"

# ── 4. reaplicare / revenire pe baza cu fapte ──
OUT="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '20261103b_izometrie_e3_documente:' || txid_current(), true);" -f "$MIG_E3" 2>&1)" && esec "4 reaplicare a trecut"
grep -q "Precondiție 0c" <<<"$OUT" || esec "4 reaplicare refuzată din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
OUT="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$REV_E3" 2>&1)" && esec "4 revenire nearmată a trecut"
grep -q "nearmată" <<<"$OUT" || esec "4 revenire nearmată refuzată din alt motiv"
OUT="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261103b', 'IZO_E3_SCOATE:' || txid_current(), true);" -f "$REV_E3" 2>&1)" && esec "4 revenire cu fapte a trecut"
grep -q "date reale E3" <<<"$OUT" || esec "4 revenire cu fapte refuzată din alt motiv: $(grep -m1 ERROR <<<"$OUT")"
ok "4 reaplicare → refuz · revenire nearmată → refuz · revenire cu fapte E3 → refuz"

# ── 5. baza curată: revenirea E3 reface baseline-ul exact; apoi revenirile 2c și E2a trec ──
# rolurile sunt la nivel de cluster: baza 1 (cu date) se șterge, cu rolurile rămase fără obiecte
"${PSQL[@]}" -d postgres -c "DROP DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d postgres -c "DROP ROLE izo_doc_editor; DROP ROLE izo_receptie_writer; DROP ROLE izo_registru_writer" >/dev/null
baza_noua "$BAZA2"
livreaza "$BAZA2" 20261102120000 "$MIG_A"
livreaza "$BAZA2" 20261102140000 "$MIG_C"
AMPR_INAINTE="$(q "SELECT obj_description('public.magazie_bucati_evenimente'::regclass, 'pg_class') || '#' || obj_description('public.fn_izo_porti_definitii()'::regprocedure, 'pg_proc')" "$BAZA2")"
livreaza "$BAZA2" 20261103120000 "$MIG_E3"
"${PSQL[@]}" -d "$BAZA2" --single-transaction -c "SELECT set_config('gazpet.revenire_20261103b', 'IZO_E3_SCOATE:' || txid_current(), true);" -f "$REV_E3" >/dev/null 2>/tmp/izo_e3_rev.err \
  || { cat /tmp/izo_e3_rev.err >&2; esec "5 revenirea E3 pe baza curată a eșuat"; }
[ "$(q "SELECT obj_description('public.magazie_bucati_evenimente'::regclass, 'pg_class') || '#' || obj_description('public.fn_izo_porti_definitii()'::regprocedure, 'pg_proc')" "$BAZA2")" = "$AMPR_INAINTE" ] \
  || esec "5 COMMENT-urile / ștampilele nu sunt cele de dinainte de E3"
[ "$(q "SELECT (SELECT count(*) FROM pg_roles WHERE rolname IN ('izo_doc_editor','izo_receptie_writer')) || ':' || (SELECT count(*) FROM pg_proc WHERE proname LIKE 'fn\_izo\_doc\_%') || ':' || cardinality(public.fn_izo_porti_lipsa())" "$BAZA2")" = "0:0:0" ] \
  || esec "5 obiecte E3 rămase sau porți incomplete"
q "DELETE FROM supabase_migrations.schema_migrations WHERE name = '20261103b_izometrie_e3_documente'" "$BAZA2" >/dev/null
"${PSQL[@]}" -d "$BAZA2" --single-transaction -c "SELECT set_config('gazpet.revenire_20261102c', 'IZO_CAI_STOC_SCOATE:' || txid_current(), true);" -f "$REV_C" >/dev/null 2>&1 || esec "5 revenirea 2c după revenirea E3 a eșuat"
"${PSQL[@]}" -d "$BAZA2" --single-transaction -c "SELECT set_config('gazpet.revenire_20261102a', 'IZO_E2A_SCOATE:' || txid_current(), true);" -f "$REV_A" >/dev/null 2>&1 || esec "5 revenirea E2a după revenirile E3 + 2c a eșuat"
gate_0e "baza curată, după toate revenirile" "$BAZA2"
ok "5 baza curată: revenirea E3 reface exact COMMENT-ul de revenire și ștampila porților, scoate tot; apoi revenirile 2c și E2a trec"

# ── 6. regresia E2a: suita E2a nemodificată peste E2a + E3 (fără 2c, care schimbă intenționat calea 3) ──
[ "$(q "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'izo\_%'" postgres)" = 0 ] || esec "6 rolurile izo au rămas după revenirile din baza curată"
baza_noua "$BAZA3"
livreaza "$BAZA3" 20261102120000 "$MIG_A"
livreaza "$BAZA3" 20261103120000 "$MIG_E3"
OUT="$("${PSQL[@]}" -d "$BAZA3" -f "$RADACINA/supabase/tests/izometrie_e2a.test.sql" 2>&1)" || { echo "$OUT" | grep -E 'ERROR|TEST' >&2; esec "6 suita E2a peste E3"; }
grep -q 'TESTE SQL: TOATE OK' <<<"$OUT" || esec "6 suita E2a nu a ajuns la final"
ok "6 regresia E2a: suita E2a nemodificată trece peste E3 ($(grep -c 'NOTICE:  OK' <<<"$OUT") verificări)"
echo "PASS test_izometrie_e3"
