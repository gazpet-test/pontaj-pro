#!/usr/bin/env bash
# Harness PG16 local E3b-A. Nu se rulează pe o bază externă.
# Ieșire: 0 PASS, 1 eșec, 2 mediu. --opreste oprește clusterul la ieșire.
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR="${IZO_E3B_DATE_DIR:-/tmp/pg_izo_e3b_slot0}"
PORT="${IZO_E3B_PORT:-6000}"
BAZA=izo_e3b_test
MIG_A="$RADACINA/supabase/migrations/20261102a_izometrie_e2a_registru.sql"
MIG_C="$RADACINA/supabase/migrations/20261102c_izometrie_cai_vechi_stoc.sql"
MIG_E3="$RADACINA/supabase/migrations/20261103b_izometrie_e3_documente.sql"
MIG_E3B="$RADACINA/supabase/migrations/20261106a_izometrie_e3b_corectii.sql"
REV_A="$RADACINA/supabase/revenire/20261102a_izometrie_e2a_registru_ROLLBACK.sql"
REV_C="$RADACINA/supabase/revenire/20261102c_izometrie_cai_vechi_stoc_ROLLBACK.sql"
REV_E3="$RADACINA/supabase/revenire/20261103b_izometrie_e3_documente_ROLLBACK.sql"
REV_E3B="$RADACINA/supabase/revenire/20261106a_izometrie_e3b_corectii_ROLLBACK.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec() { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok() { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG16 lipsă ($PG_BIN)"
[[ "$DATE_DIR" =~ ^/tmp/pg_izo_e3b_slot[0-9]$ ]] || mediu "director de cluster în afara sloturilor E3b: $DATE_DIR"
[[ "$PORT" =~ ^600[0-9]$ ]] || mediu "port în afara sloturilor E3b: $PORT"
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_izo_e3b" ] || mediu "$DATE_DIR există fără marcaj fixture"
  if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null; fi
  rm -rf "$DATE_DIR"
fi
mkdir -p "$DATE_DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_izo_e3b"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l "/tmp/pg_izo_e3b_${PORT}.log" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
livreaza() { local sha sis rc=0
  sha="$(sha256sum "$2" | cut -d' ' -f1)"
  sis="$("${PSQL[@]}" -d "$BAZA" -Atc "SELECT system_identifier FROM pg_control_system()")"
  PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$2" --sha256 "$sha" --versiune "$1" \
    --tinta-db "$BAZA" --tinta-sistem "$sis" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >"/tmp/izo_e3b_${PORT}_runner.out" 2>&1 || rc=$?
  [ "$rc" = 0 ] || { cat "/tmp/izo_e3b_${PORT}_runner.out" >&2; esec "runner $rc ($2)"; }
}
refuza() { local tipar="$1"; shift; local out
  out="$("$@" 2>&1)" && esec "refuz așteptat: $tipar"
  grep -qF "$tipar" <<<"$out" || esec "refuz din alt motiv, așteptat $tipar: $out"
}
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_$1','$2:' || txid_current(),true)" -f "$3" >/dev/null; }
asteapta() { local i; for i in $(seq 1 150); do [ "$(q "$1")" = "${2:-1}" ] && return 0; sleep 0.1; done; return 1; }
# cursa cu barieră (advisory 99 ținut de un controlor): A rulează $2 și se oprește la barieră ținând ce a luat; B rulează $3 și
# trebuie să AȘTEPTE un lock; controlorul eliberează bariera; $4 ok|err, $5 tiparul în ieșirea lui B;
# $6 (opțional, r5f) felul lock-ului pe care trebuie să aștepte B (wait_event: advisory / relation)
cursa() { local et="$1" pa pb pc rc_b=0 ob
  PGAPPNAME=izo_ctrl "${PSQL[@]}" -d "$BAZA" -Atc "SELECT pg_advisory_lock(99); SELECT pg_sleep(300);" >/dev/null 2>&1 & pc=$!
  asteapta "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = 'izo_ctrl' AND l.locktype = 'advisory' AND l.objid = 99 AND l.granted" || esec "$et: controlor"
  PGAPPNAME=izo_A "${PSQL[@]}" -d "$BAZA" -Atc "BEGIN; $2; SELECT pg_advisory_xact_lock_shared(99); COMMIT;" >/tmp/izo_e3b_${PORT}_a.out 2>&1 & pa=$!
  asteapta "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = 'izo_A' AND l.locktype = 'advisory' AND l.objid = 99 AND NOT l.granted" \
    || { kill "$pc" 2>/dev/null; cat /tmp/izo_e3b_${PORT}_a.out >&2; esec "$et: A n-a ajuns la barieră"; }
  PGAPPNAME=izo_B "${PSQL[@]}" -d "$BAZA" -Atc "$3" >/tmp/izo_e3b_${PORT}_b.out 2>&1 & pb=$!
  asteapta "SELECT count(DISTINCT a.pid) FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid AND NOT l.granted WHERE application_name = 'izo_B' AND wait_event_type = 'Lock'${6:+ AND wait_event = '$6'}" \
    || { q "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'izo_ctrl'" >/dev/null; wait "$pa" "$pb" 2>/dev/null || true; cat /tmp/izo_e3b_${PORT}_b.out >&2; esec "$et: B nu a așteptat${6:+ un lock $6}"; }
  q "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'izo_ctrl'" >/dev/null
  wait "$pc" 2>/dev/null || true
  wait "$pa" || { cat /tmp/izo_e3b_${PORT}_a.out >&2; esec "$et: A a eșuat"; }
  wait "$pb" || rc_b=$?
  ob="$(cat /tmp/izo_e3b_${PORT}_b.out)"
  if [ "$4" = ok ]; then [ "$rc_b" = 0 ] || { echo "$ob" >&2; esec "$et: B a eșuat"; }; else [ "$rc_b" != 0 ] || { echo "$ob" >&2; esec "$et: B a trecut"; }; fi
  grep -q -- "$5" <<<"$ob" || { echo "$ob" >&2; esec "$et: ieșirea lui B nu conține „$5”"; }; }
baseline() { q "SELECT jsonb_build_array(obj_description('public.magazie_bucati_evenimente'::regclass,'pg_class'),
  obj_description('public.fn_izo_porti_definitii()'::regprocedure,'pg_proc'),
  obj_description('public.fn_izo_porti_e3_definitii()'::regprocedure,'pg_proc'),
  public.fn_izo_porti_definitii(),public.fn_izo_porti_e3_definitii())"; }
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e2a_schelet.sql" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e3_schelet.sql" >/dev/null
livreaza 20261102120000 "$MIG_A"
livreaza 20261102140000 "$MIG_C"
livreaza 20261103120000 "$MIG_E3"
INAINTE="$(baseline)"
refuza 'numai postgres' "${PSQL[@]}" -d "$BAZA" -f "$MIG_E3B"
livreaza 20261106120000 "$MIG_E3B"
[ "$(q 'SELECT public.fn_izo_porti_lipsa()')" = '{}' ] || esec 'poarta după E3b'
CONTROL_0E="$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql")" || esec 'control 0e: psql'
[ -z "$CONTROL_0E" ] || esec "control 0e: $CONTROL_0E"
ok '20261102a -> 2c -> E3 -> E3b prin runner; gate = {}; control 0e = 0'
OUT="$("${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e3b.test.sql" 2>&1)" || { echo "$OUT" >&2; esec 'catalog E3b'; }
for sectiune in A B C1 C2 D1 D2; do
  grep -qF "TESTE E3b-$sectiune: TOATE OK" <<<"$OUT" || esec "sec?iunea $sectiune nu a ajuns la final"
done
ok 'catalog, matrice, roluri, RLS, PUBLIC EXECUTE și mutații'
# Reaplicare direct sub gardă, ca să dovedim refuzul migrării, nu numai al metadata runner-ului.
refuza 'există deja' "${PSQL[@]}" -d "$BAZA" --single-transaction \
  -c "SELECT set_config('gazpet.livrare_migrare','20261106a_izometrie_e3b_corectii:' || txid_current(),true)" -f "$MIG_E3B"
refuza 'nearmată' "${PSQL[@]}" -d "$BAZA" -f "$REV_E3B"
refuza 'READ COMMITTED' "${PSQL[@]}" -d "$BAZA" --single-transaction -c 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ' \
  -c "SELECT set_config('gazpet.revenire_20261106a','IZO_E3B_SCOATE:' || txid_current(),true)" -f "$REV_E3B"
# Fiecare predicat de refuz este singurul fapt E3b din tranzactia sa.
# Orfanii relationale de mai jos sunt intentionati: izolam predicatul copil/istoric,
# altfel un parinte izo_corectii ar putea masca lipsa verificarii copilului.
FIXTURI=(
 "ALTER TABLE public.izo_corectii DISABLE TRIGGER trg_izo_cor_garda;
  INSERT INTO public.izo_corectii(proiect_id,tip,import_id,inainte,motiv,cale,propus_de)
  VALUES(3,'storno_import','fixture-e3b','{}','fixture revenire','direct','00000000-0000-0000-0000-000000000121');
  ALTER TABLE public.izo_corectii ENABLE ALWAYS TRIGGER trg_izo_cor_garda"
 "ALTER TABLE public.izo_corectii_bucati DISABLE TRIGGER trg_izo_cor_garda;
  SET LOCAL session_replication_role=replica;
  INSERT INTO public.izo_corectii_bucati(corectie_id,bucata_id) VALUES(-999,(SELECT id FROM public.magazie_bucati WHERE serie='GZP1'));
  SET LOCAL session_replication_role=origin;
  ALTER TABLE public.izo_corectii_bucati ENABLE ALWAYS TRIGGER trg_izo_cor_garda"
 "ALTER TABLE public.izo_documente_istoric DISABLE TRIGGER trg_izo_doc_ist_garda;
  SET LOCAL session_replication_role=replica;
  INSERT INTO public.izo_documente_istoric(document_id,versiune,salvat_de,continut,hash,diff,baza)
  VALUES(-999,1,'00000000-0000-0000-0000-000000000121','{}','e3-doc-v1:'||repeat('a',64),'{}',true);
  SET LOCAL session_replication_role=origin;
  ALTER TABLE public.izo_documente_istoric ENABLE ALWAYS TRIGGER trg_izo_doc_ist_garda"
 "ALTER TABLE public.magazie_bucati_evenimente DISABLE TRIGGER trg_izo_ev_garda;
  INSERT INTO public.magazie_bucati_evenimente(tip,proiect_id,document_tip,document_id,motiv,server_ver)
  VALUES('corectie',3,'izo_corectie','fixture','fixture revenire',nextval('public.izo_server_ver_seq'));
  ALTER TABLE public.magazie_bucati_evenimente ENABLE ALWAYS TRIGGER trg_izo_ev_garda"
 "ALTER TABLE public.magazie_bucati DISABLE TRIGGER trg_magbuc_izo_garda;
  UPDATE public.magazie_bucati SET atribute=jsonb_build_object('sursa','e3b') WHERE serie='GZP1';
  ALTER TABLE public.magazie_bucati ENABLE ALWAYS TRIGGER trg_magbuc_izo_garda"
)
for tip in carantina_intrare carantina_iesire storno_partial; do
  FIXTURI+=("ALTER TABLE public.magazie_bucati_evenimente DISABLE TRIGGER trg_izo_ev_garda;
    INSERT INTO public.magazie_bucati_evenimente(tip,proiect_id,motiv,server_ver)
    VALUES('$tip',3,'fixture revenire',nextval('public.izo_server_ver_seq'));
    ALTER TABLE public.magazie_bucati_evenimente ENABLE ALWAYS TRIGGER trg_izo_ev_garda")
done
FAPTE_E3B="SELECT (EXISTS(SELECT 1 FROM public.izo_corectii))::int
  + (EXISTS(SELECT 1 FROM public.izo_corectii_bucati))::int
  + (EXISTS(SELECT 1 FROM public.izo_documente_istoric))::int
  + (EXISTS(SELECT 1 FROM public.magazie_bucati_evenimente WHERE document_tip='izo_corectie'))::int
  + (EXISTS(SELECT 1 FROM public.magazie_bucati_evenimente WHERE tip IN ('carantina_intrare','carantina_iesire','storno_partial')))::int
  + (EXISTS(SELECT 1 FROM public.magazie_bucati WHERE atribute->>'sursa'='e3b'))::int"
for fixture in "${FIXTURI[@]}"; do
  refuza 'există fapte E3b' "${PSQL[@]}" -d "$BAZA" --single-transaction -c "$fixture; DO \$isolation\$ BEGIN IF ($FAPTE_E3B) <> 1 THEN RAISE EXCEPTION 'fixture neizolata'; END IF; END \$isolation\$" \
    -c "SELECT set_config('gazpet.revenire_20261106a','IZO_E3B_SCOATE:' || txid_current(),true)" -f "$REV_E3B"
  [ "$(q "$FAPTE_E3B")" = 0 ] || esec 'fixture de rollback ramasa comisa'
done
ok 'rollback: cele 6 feluri de fapte refuzate separat (8 cazuri), toate anulate'
revenire 20261106a IZO_E3B_SCOATE "$REV_E3B"
[ "$(baseline)" = "$INAINTE" ] || esec 'amprenta sau ștampilele diferă după revenire E3b'
[ "$(q 'SELECT public.fn_izo_porti_lipsa()')" = '{}' ] || esec 'porți E3 după revenire E3b'
ok 'reaplicare refuzată; revenire E3b: COMMENT/amprenta/ștampile EXACT egale cu baseline'
revenire 20261103b IZO_E3_SCOATE "$REV_E3"
ok 'revenirea E3 trece după revenirea E3b'
q "DELETE FROM supabase_migrations.schema_migrations WHERE name IN ('20261106a_izometrie_e3b_corectii','20261103b_izometrie_e3_documente')" >/dev/null
revenire 20261102c IZO_CAI_STOC_SCOATE "$REV_C"
revenire 20261102a IZO_E2A_SCOATE "$REV_A"
ok 'baza principala: verificarile E3b si lantul revenirilor au trecut'

# New databases always start from their own skeleton. Roles are cluster-global;
# drop a finished fixture database before reusing the fixed migration role names.
baza_noua() {
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
  "${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e2a_schelet.sql" >/dev/null
  "${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e3_schelet.sql" >/dev/null
}
baza_scoate() {
  [[ "$BAZA" =~ ^izo_e3b_[a-z0-9_]+_test$ ]] || esec 'baza nu este fixture E3b'
  "${PSQL[@]}" -d postgres -c "DROP DATABASE $BAZA" >/dev/null
  "${PSQL[@]}" -d postgres -c 'DROP ROLE IF EXISTS izo_corectie_writer, izo_cor_editor, izo_doc_editor, izo_receptie_writer, izo_registru_writer' >/dev/null
}
lant_apply() {
  livreaza 20261102120000 "$MIG_A"
  livreaza 20261102140000 "$MIG_C"
  livreaza 20261103120000 "$MIG_E3"
  livreaza 20261106120000 "$MIG_E3B"
}
# Main database has already completed all rollbacks and contains no writer roles.
BAZA=izo_e3b_curata_test
baza_noua
livreaza 20261102120000 "$MIG_A"
livreaza 20261102140000 "$MIG_C"
PRE_E3="$(q "SELECT jsonb_build_array(obj_description('public.magazie_bucati_evenimente'::regclass,'pg_class'),
  obj_description('public.fn_izo_porti_definitii()'::regprocedure,'pg_proc'),public.fn_izo_porti_definitii())")"
STORAGE_AMPR="SELECT md5(concat_ws(' | ',
  (SELECT string_agg(format('%s.%s:%s:%s:%s:%s:%s', c.relname, p.polname, p.polcmd, p.polpermissive, p.polroles::regrole[]::text,
                            coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')), ',' ORDER BY c.relname, p.polname)
     FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relnamespace = 'storage'::regnamespace),
  (SELECT string_agg(format('%s:%s:%s:%s:%s', c.relname, pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity, c.relacl), ',' ORDER BY c.relname)
     FROM pg_class c WHERE c.relnamespace = 'storage'::regnamespace AND c.relkind = 'r'),
  (SELECT string_agg(format('%s:%s:%s', b.id, b.public, b.file_size_limit), ',' ORDER BY b.id) FROM storage.buckets b)))"
STORAGE_INAINTE="$(q "$STORAGE_AMPR")"
livreaza 20261103120000 "$MIG_E3"
PRE_E3B="$(baseline)"
livreaza 20261106120000 "$MIG_E3B"
revenire 20261106a IZO_E3B_SCOATE "$REV_E3B"
[ "$(baseline)" = "$PRE_E3B" ] || esec 'curata: amprenta/stampile E3b diferite'
revenire 20261103b IZO_E3_SCOATE "$REV_E3"
[ "$(q "SELECT jsonb_build_array(obj_description('public.magazie_bucati_evenimente'::regclass,'pg_class'),
  obj_description('public.fn_izo_porti_definitii()'::regprocedure,'pg_proc'),public.fn_izo_porti_definitii())")" = "$PRE_E3" ] || esec 'curata: amprenta/stampile E3 diferite'
[ "$(q "$STORAGE_AMPR")" = "$STORAGE_INAINTE" ] || esec 'curata: Storage diferit dupa rollback E3'
q "DELETE FROM supabase_migrations.schema_migrations WHERE name IN ('20261106a_izometrie_e3b_corectii','20261103b_izometrie_e3_documente')" >/dev/null
revenire 20261102c IZO_CAI_STOC_SCOATE "$REV_C"
revenire 20261102a IZO_E2A_SCOATE "$REV_A"
ok 'baza separata curata: E3b -> E3 -> 2c -> E2a; egalitati exacte dupa E3b si E3'
baza_scoate

# The adapted file contains both complete LIVE suites with explicit expectation deltas.
for suita in e2a e3; do
  BAZA="izo_e3b_regresie_${suita}_test"
  baza_noua
  lant_apply
  E2A=false; [ "$suita" = e2a ] && E2A=true
  OUT="$("${PSQL[@]}" -d "$BAZA" -v e2a="$E2A" -f "$RADACINA/supabase/tests/izometrie_e3b_regresie.sql" 2>&1)" || { echo "$OUT" >&2; esec "regresie $suita peste E3b"; }
  if [ "$suita" = e2a ]; then MARKER='TESTE SQL: TOATE OK'; else MARKER='TESTE E3: TOATE OK'; fi
  grep -qF "$MARKER" <<<"$OUT" || esec "regresie $suita incompleta"
  ok "regresie $suita peste E2a -> 2c -> E3 -> E3b"
  baza_scoate
done

# Same closure differential as E3 step 2, this time with E3b already applied.
BAZA=izo_e3b_inchidere_test
baza_noua
lant_apply
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e3_inchidere.sql" >/dev/null
INCH="SELECT array_to_string(ARRAY(SELECT x::regclass::text FROM unnest(o_rel) x ORDER BY 1), ',') || ' / ' || array_to_string(ARRAY(SELECT x::regprocedure::text FROM unnest(o_fn) x ORDER BY 1), ',')
  || ' / ' || array_to_string(ARRAY(SELECT x::regprocedure::text FROM unnest(o_mut) x ORDER BY 1), ',') || ' / ' || array_to_string(o_mesaje, ',') FROM"
# r5f (#825): teste.inchidere_noua = textul din migrare FĂRĂ sămânța E3 (aceeași sămânță ca E2a: veche = nouă compară algoritmul);
# teste.inchidere_noua_e3 = textul EXACT din migrare (sămânța E2a + tabelele documentelor E3). INCH_E3 = INCH fără cele 3 tabele
# (și marcat dacă lipsesc): pe orice mutație care nu atinge documentele, sămânța E3 trebuie să adauge EXACT cele 3 tabele, nimic
# altceva (funcțiile E3 legitime sunt fn_izo_*, în afara închiderii)
DOC="ARRAY['public.izo_documente_intrare'::regclass, 'public.izo_documente_intrare_randuri'::regclass, 'public.izo_documente_scanuri'::regclass]::oid[]"
INCH_E3="SELECT CASE WHEN $DOC <@ o_rel THEN '' ELSE 'FĂRĂ TABELELE DOCUMENTELOR: ' END
  || array_to_string(ARRAY(SELECT x::regclass::text FROM unnest(o_rel) x WHERE x <> ALL ($DOC) ORDER BY 1), ',') || ' / ' || array_to_string(ARRAY(SELECT x::regprocedure::text FROM unnest(o_fn) x ORDER BY 1), ',')
  || ' / ' || array_to_string(ARRAY(SELECT x::regprocedure::text FROM unnest(o_mut) x ORDER BY 1), ',') || ' / ' || array_to_string(o_mesaje, ',') FROM"
V0="$(q "$INCH teste.inchidere_noua()")" || esec "2 starea curată: închiderea nouă a dat eroare"
N0="$(q "$INCH_E3 teste.inchidere_noua_e3()")" || esec "2 starea curată: închiderea din migrare (sămânța E3) a dat eroare"
[ "$V0" = "$N0" ] || esec "2 starea curată: sămânța E3 aduce altceva decât cele 3 tabele ale documentelor [${N0:0:3000}] ≠ [${V0:0:3000}]"
# dif <etichetă> <creează> <șterge> [1 = mutația trebuie să aducă un DEFINER în închidere | 0] [verificare SQL booleană, rulată cât
# mutația e în bază — r5f (#825 NO-GO): ce probează mutația (membrii ciclului în închidere, mesajul de neconvergență în poartă…)]
# r5f: o eroare a uneia dintre închideri (ex. regex prea mare) e eșec explicit, nu ieșire mută din set -e
dif() { local et="$1" crea="$2" sterge="$3" v n n3 d c=t
  q "$crea" >/dev/null || esec "2 $et: mutația nu s-a putut crea"
  v="$(q "$INCH teste.inchidere_veche()")" || esec "2 $et: închiderea veche a dat eroare"
  n="$(q "$INCH teste.inchidere_noua()")" || esec "2 $et: închiderea nouă a dat eroare (poarta s-ar bloca în loc să răspundă)"
  n3="$(q "$INCH_E3 teste.inchidere_noua_e3()")" || esec "2 $et: închiderea din migrare (sămânța E3) a dat eroare"
  d="$(q "SELECT count(*) FROM pg_proc p WHERE p.oid = ANY ((teste.inchidere_noua()).o_fn) AND p.prosecdef")"
  [ -z "${5:-}" ] || c="$(q "SELECT coalesce(($5), false)")" || esec "2 $et: verificarea a dat eroare"
  q "$sterge" >/dev/null || esec "2 $et: mutația nu s-a putut șterge"
  [ "$v" = "$n" ] || esec "2 $et: închiderea veche [${v:0:3000}] ≠ cea nouă [${n:0:3000}]"
  [ "$n3" = "$n" ] || esec "2 $et: închiderea din migrare fără documente [${n3:0:3000}] ≠ cea pe sămânța E2a [${n:0:3000}]"
  [ "${4:-1}" = 0 ] || [ "$d" -gt 0 ] || esec "2 $et: mutația nu aduce niciun DEFINER în închidere (testul nu probează nimic)"
  [ "$c" = t ] || esec "2 $et: verificarea mutației nu ține: $5"; }
# r5f (#825 NO-GO, P1): dif_strict <etichetă> <creează> <șterge> <err|ok> <verificare SQL> — mutațiile pe care poarta nouă e
# INTENȚIONAT mai strictă decât E2a, deci „nouă = veche” nu se aplică: err = închiderea E2a dă eroare de regex (schemă cu
# caractere speciale — E2a rămâne închisă prin eroare, poarta nouă trebuie să refuze, nu să dea verde); ok = E2a răspunde, cu
# alt rezultat (fals-pozitive la „|” în schemă, sau verde fals: ghilimele în nume, SQL fără EXECUTE, comentariu în numele calificat).
# Cerințe: închiderea nouă răspunde, poarta REALĂ (public.fn_izo_porti_lipsa) nu e goală, verificarea ține
dif_strict() { local et="$1" crea="$2" sterge="$3" rv=0 c g
  q "$crea" >/dev/null || esec "2 $et: mutația nu s-a putut crea"
  q "$INCH teste.inchidere_veche()" >/dev/null 2>/tmp/izo_e3b_${PORT}_dif.err || rv=$?
  q "$INCH teste.inchidere_noua()" >/dev/null || esec "2 $et: închiderea nouă a dat eroare"
  g="$(q "SELECT cardinality(public.fn_izo_porti_lipsa())")" || esec "2 $et: poarta reală a dat eroare"
  c="$(q "SELECT coalesce(($5), false)")" || esec "2 $et: verificarea a dat eroare"
  q "$sterge" >/dev/null || esec "2 $et: mutația nu s-a putut șterge"
  if [ "$4" = err ]; then { [ "$rv" != 0 ] && grep -q 'invalid regular expression' /tmp/izo_e3b_${PORT}_dif.err; } || esec "2 $et: închiderea E2a trebuia să dea eroare de regex"
  else [ "$rv" = 0 ] || { cat /tmp/izo_e3b_${PORT}_dif.err >&2; esec "2 $et: închiderea E2a a dat eroare"; }; fi
  [ "$g" -gt 0 ] || esec "2 $et: poarta nouă e goală (verde) pe o mutație pe care trebuie să refuze"
  [ "$c" = t ] || esec "2 $et: verificarea mutației nu ține: $5"; }
# r5f (#825 NO-GO): membrii închiderii noi, ca text (regprocedure), pentru verificări; ::text[] — altfel „= ANY ((SELECT …))” e forma cu subinterogare
FN_NOU="(SELECT array_agg(x::regprocedure::text) FROM unnest((teste.inchidere_noua()).o_fn) x)::text[]"
FN_VECHI="(SELECT array_agg(x::regprocedure::text) FROM unnest((teste.inchidere_veche()).o_fn) x)::text[]"
SPEC="un nume din închiderea citirilor nu se poate căuta sigur în corpuri (schemă cu caractere speciale de regex / nume cu ghilimele) (citire nerevizuită)"
MUT_NOU="(SELECT array_agg(x::regprocedure::text) FROM unnest((teste.inchidere_noua()).o_mut) x)::text[]"
NECONV="închiderea citirilor nu converge (citire nerevizuită)"; NECONV_MUT="propagarea mutatorilor de cale nu converge (citire nerevizuită)"
# lanț de $1 view-uri lv_1 (citește registrul) ← lv_2 ← … ← lv_$1 ← DEFINER lv_def: lv_k intră la iterația k a închiderii
lant_view() { cat <<SQL
DO \$m\$ BEGIN
  CREATE VIEW teste.lv_1 WITH (security_invoker = on) AS SELECT id FROM public.magazie_bucati;
  FOR i IN 2..$1 LOOP
    EXECUTE format('CREATE VIEW teste.lv_%s WITH (security_invoker = on) AS SELECT id FROM teste.lv_%s', i, i - 1);
  END LOOP;
  CREATE FUNCTION teste.lv_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM teste.lv_$1';
END \$m\$
SQL
}
STERGE_LV="SET client_min_messages = warning; DROP FUNCTION teste.lv_def(); DROP VIEW teste.lv_1 CASCADE"
# lanț de $1 mutatori: lm_1 (set_config, sămânța) ← lm_2 ← … ← lm_$1: lm_k intră la iterația k-1 a propagării
lant_mut() { cat <<SQL
DO \$m\$ BEGIN
  CREATE FUNCTION teste.lm_1() RETURNS void LANGUAGE plpgsql AS 'BEGIN PERFORM set_config(''search_path'', ''public'', true); END';
  FOR i IN 2..$1 LOOP
    EXECUTE format('CREATE FUNCTION teste.lm_%s() RETURNS void LANGUAGE plpgsql AS ''BEGIN PERFORM teste.lm_%s(); END''', i, i - 1);
  END LOOP;
END \$m\$
SQL
}
sterge_lm() { echo "DO \$m\$ BEGIN FOR i IN 1..$1 LOOP EXECUTE format('DROP FUNCTION teste.lm_%s()', i); END LOOP; END \$m\$"; }
# frontieră largă: 1200 de obiecte cu nume de 62 de octeți (limita PG: 63) într-o singură iterație — o alternanță unică de ~120 000
# de caractere depășește motorul de regex („invalid memory alloc request size”); $1 = view | mutator
LUNG="frontiera_larga_cu_nume_lung_pentru_regex_poarta_rapida_"
frontiera_larga() { if [ "$1" = view ]; then cat <<SQL
DO \$m\$ BEGIN
  FOR i IN 1..1200 LOOP
    EXECUTE format('CREATE VIEW teste.%I WITH (security_invoker = on) AS SELECT id FROM public.magazie_bucati', 'v_${LUNG}' || lpad(i::text, 4, '0'));
  END LOOP;
  CREATE FUNCTION teste.fl_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM teste.v_${LUNG}0777';
END \$m\$
SQL
else cat <<SQL
DO \$m\$ BEGIN
  CREATE FUNCTION storage.izo_cit_fl() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.magazie_bucati';
  FOR i IN 1..1200 LOOP
    EXECUTE format('CREATE FUNCTION teste.%I() RETURNS void LANGUAGE plpgsql AS ''BEGIN PERFORM set_config(''''search_path'''', ''''storage'''', true); END''',
                   'm_${LUNG}' || lpad(i::text, 4, '0'));
  END LOOP;
  -- DEFINER cu cale fixă (teste): ajunge la registru DOAR ca mutator (cheamă un mutator din frontiera largă) → calea necunoscută
  CREATE FUNCTION teste.fm_def() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = teste
    AS 'BEGIN PERFORM teste.m_${LUNG}0777(); RETURN izo_cit_fl(); END';
END \$m\$
SQL
fi; }
sterge_frontiera() { if [ "$1" = view ]; then
  echo "DROP FUNCTION teste.fl_def(); DO \$m\$ BEGIN FOR i IN 1..1200 LOOP EXECUTE format('DROP VIEW teste.%I', 'v_${LUNG}' || lpad(i::text, 4, '0')); END LOOP; END \$m\$"
else
  echo "DROP FUNCTION teste.fm_def(); DROP FUNCTION storage.izo_cit_fl(); DO \$m\$ BEGIN FOR i IN 1..1200 LOOP EXECUTE format('DROP FUNCTION teste.%I()', 'm_${LUNG}' || lpad(i::text, 4, '0')); END LOOP; END \$m\$"
fi; }
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
# ── r5f (#825 NO-GO, Jak): cicluri, pragul de 100 de iterații, neconvergență, frontiere largi ──
# cicluri de funcții: frontiera semi-naivă trebuie să excludă tot ce e deja în închidere (nu doar frontiera), altfel ciclul
# reintră la nesfârșit și se oprește în prag cu alt rezultat decât E2a
dif "ciclu DEFINER ↔ INVOKER (citește INVOKER-ul)" \
  "CREATE FUNCTION teste.cy_inv() RETURNS bigint LANGUAGE plpgsql AS 'BEGIN IF random() < 0 THEN RETURN teste.cy_def(); END IF; RETURN (SELECT count(*) FROM public.izo_atribuiri); END';
  CREATE FUNCTION teste.cy_def() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS 'BEGIN RETURN teste.cy_inv(); END'" \
  "DROP FUNCTION teste.cy_def(); DROP FUNCTION teste.cy_inv()" 1 "ARRAY['teste.cy_inv()', 'teste.cy_def()'] <@ $FN_NOU"
dif "ciclu DEFINER ↔ INVOKER (citește DEFINER-ul)" \
  "CREATE FUNCTION teste.cy_inv2() RETURNS bigint LANGUAGE plpgsql AS 'BEGIN RETURN teste.cy_def2(); END';
  CREATE FUNCTION teste.cy_def2() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS 'BEGIN IF random() < 0 THEN RETURN teste.cy_inv2(); END IF; RETURN (SELECT count(*) FROM public.izo_importuri); END'" \
  "DROP FUNCTION teste.cy_def2(); DROP FUNCTION teste.cy_inv2()" 1 "ARRAY['teste.cy_inv2()', 'teste.cy_def2()'] <@ $FN_NOU"
dif "ciclu DEFINER ↔ INVOKER fără registru (rămâne în afara închiderii)" \
  "CREATE FUNCTION teste.cy_x() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS 'BEGIN RETURN teste.cy_y(); END';
  CREATE FUNCTION teste.cy_y() RETURNS bigint LANGUAGE plpgsql AS 'BEGIN RETURN teste.cy_x(); END'" \
  "DROP FUNCTION teste.cy_x(); DROP FUNCTION teste.cy_y()" 0 "NOT (ARRAY['teste.cy_x()', 'teste.cy_y()'] && $FN_NOU)"
# ciclu de mutatori: DEFINER-ul are cale fixă (teste) și cheamă necalificat o funcție de platformă (storage) care citește
# registrul — intră în închidere DOAR dacă ciclul mu_a ↔ mu_b îl face mutator (calea devine necunoscută)
dif "ciclu de mutatori A ↔ B + DEFINER cu cale fixă (platformă necalificat)" \
  "CREATE FUNCTION storage.izo_cit() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.magazie_bucati';
  CREATE FUNCTION teste.mu_a() RETURNS void LANGUAGE plpgsql AS 'BEGIN PERFORM set_config(''search_path'', ''storage'', true); PERFORM teste.mu_b(); END';
  CREATE FUNCTION teste.mu_b() RETURNS void LANGUAGE plpgsql AS 'BEGIN PERFORM teste.mu_a(); END';
  CREATE FUNCTION teste.mu_d() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = teste AS 'BEGIN PERFORM teste.mu_b(); RETURN izo_cit(); END'" \
  "DROP FUNCTION teste.mu_d(); DROP FUNCTION teste.mu_b(); DROP FUNCTION teste.mu_a(); DROP FUNCTION storage.izo_cit()" 1 \
  "ARRAY['teste.mu_a()', 'teste.mu_b()', 'teste.mu_d()'] <@ $MUT_NOU AND 'teste.mu_d()' = ANY ($FN_NOU)"
# cicluri prin view-uri (PG16 le permite prin CREATE OR REPLACE VIEW; eroarea de recursie apare abia la interogare)
dif "ciclu view ↔ view" \
  "CREATE VIEW teste.cy_va WITH (security_invoker = on) AS SELECT 1::bigint AS id;
  CREATE VIEW teste.cy_vb WITH (security_invoker = on) AS SELECT id FROM teste.cy_va;
  CREATE OR REPLACE VIEW teste.cy_va WITH (security_invoker = on) AS SELECT id FROM public.magazie_bucati UNION ALL SELECT id FROM teste.cy_vb;
  CREATE FUNCTION teste.cy_vdef() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS 'BEGIN RETURN (SELECT count(*) FROM teste.cy_vb); END'" \
  "DROP FUNCTION teste.cy_vdef(); DROP VIEW teste.cy_va, teste.cy_vb" 1 \
  "ARRAY['teste.cy_va'::regclass::oid, 'teste.cy_vb'::regclass::oid] <@ (teste.inchidere_noua()).o_rel AND 'teste.cy_vdef()' = ANY ($FN_NOU)"
dif "ciclu view ↔ funcție (numele în corp)" \
  "CREATE FUNCTION teste.cv_f() RETURNS bigint LANGUAGE plpgsql AS 'BEGIN RETURN (SELECT count(*) FROM public.magazie_bucati_miscari) + (SELECT count(*) FROM teste.cv_v); END';
  CREATE VIEW teste.cv_v WITH (security_invoker = on) AS SELECT teste.cv_f() AS n;
  CREATE FUNCTION teste.cv_def() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS 'BEGIN RETURN (SELECT n FROM teste.cv_v); END'" \
  "DROP FUNCTION teste.cv_def(); DROP VIEW teste.cv_v; DROP FUNCTION teste.cv_f()" 1 \
  "'teste.cv_v'::regclass::oid = ANY ((teste.inchidere_noua()).o_rel) AND ARRAY['teste.cv_f()', 'teste.cv_def()'] <@ $FN_NOU"
dif "ciclu view ↔ funcție BEGIN ATOMIC (dependențe de catalog în ambele sensuri)" \
  "CREATE VIEW teste.ca_v WITH (security_invoker = on) AS SELECT 1::bigint AS id;
  CREATE FUNCTION teste.ca_f() RETURNS bigint LANGUAGE sql BEGIN ATOMIC SELECT (SELECT count(*) FROM public.izo_proiect_config) + (SELECT count(*) FROM teste.ca_v); END;
  CREATE OR REPLACE VIEW teste.ca_v WITH (security_invoker = on) AS SELECT teste.ca_f() AS id;
  CREATE FUNCTION teste.ca_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER BEGIN ATOMIC SELECT count(*) FROM teste.ca_v; END" \
  "SET client_min_messages = warning; DROP FUNCTION teste.ca_def(); DROP VIEW teste.ca_v CASCADE" 1 \
  "'teste.ca_v'::regclass::oid = ANY ((teste.inchidere_noua()).o_rel) AND ARRAY['teste.ca_f()', 'teste.ca_def()'] <@ $FN_NOU"
# pragul de 100 de iterații, bucla închiderii: E2a se oprește după iterația 100 și refuză dacă a ajuns la ea — un lanț care converge
# exact la iterația 100 e refuzat conservator; peste prag, DEFINER-ul din capăt nu e atins și refuzul vine DOAR din mesaj (fail-closed).
# Adâncimea bazei (fără mutație) trebuie să fie < 99 pe ambele bucle — altfel 98 / 99 n-ar mai fi „sub prag”; o verifică chiar
# testele „fără mesaj” (98 de view-uri, 99 de mutatori): pe o bază mai adâncă ar vedea mesajul de neconvergență și ar pica
dif "lanț de 98 de view-uri (sub prag: converge, fără mesaj)" "$(lant_view 98)" "$STERGE_LV" 1 \
  "cardinality((teste.inchidere_noua()).o_mesaje) = 0 AND 'teste.lv_def()' = ANY ($FN_NOU)"
dif "lanț de 99 de view-uri (converge la iterația 100: refuz conservator)" "$(lant_view 99)" "$STERGE_LV" 1 \
  "'$NECONV' = ANY ((teste.inchidere_noua()).o_mesaje) AND '$NECONV' = ANY (public.fn_izo_porti_lipsa())"
dif "lanț de 101 view-uri (peste prag: DEFINER neatins, poarta refuză din mesaj)" "$(lant_view 101)" "$STERGE_LV" 0 \
  "NOT ('teste.lv_def()' = ANY ($FN_NOU)) AND '$NECONV' = ANY (public.fn_izo_porti_lipsa())"
# pragul, bucla mutatorilor
dif "lanț de 99 de mutatori (converge, fără mesaj)" "$(lant_mut 99)" "$(sterge_lm 99)" 0 \
  "cardinality((teste.inchidere_noua()).o_mesaje) = 0 AND 'teste.lm_99()' = ANY ($MUT_NOU)"
dif "lanț de 100 de mutatori (converge la iterația 100: refuz conservator)" "$(lant_mut 100)" "$(sterge_lm 100)" 0 \
  "'teste.lm_100()' = ANY ($MUT_NOU) AND '$NECONV_MUT' = ANY (public.fn_izo_porti_lipsa())"
dif "lanț de 102 mutatori (peste prag: capătul neatins, poarta refuză din mesaj)" "$(lant_mut 102)" "$(sterge_lm 102)" 0 \
  "NOT ('teste.lm_102()' = ANY ($MUT_NOU)) AND '$NECONV_MUT' = ANY (public.fn_izo_porti_lipsa())"
# frontiere largi: 1200 de nume lungi într-o singură iterație (bucla închiderii / bucla mutatorilor)
dif "frontieră largă: 1200 de view-uri cu nume de 62 de octeți" "$(frontiera_larga view)" "$(sterge_frontiera view)" 1 \
  "'teste.fl_def()' = ANY ($FN_NOU)"
dif "frontieră largă: 1200 de mutatori cu nume de 62 de octeți + DEFINER mutator (platformă necalificat)" "$(frontiera_larga mutator)" "$(sterge_frontiera mutator)" 1 \
  "'teste.fm_def()' = ANY ($MUT_NOU) AND 'teste.fm_def()' = ANY ($FN_NOU)"
# ── r5f (#825 NO-GO, P1): numele care intră în tiparele închiderii — schema escapată ca numele; ce nu se poate căuta sigur → refuz ──
# martorii (nouă = E2a): DEFINER cu cale fixă → INVOKER din schema noastră / → funcție de platformă chemată calificat
dif "martor: DEFINER (cale teste) → INVOKER teste" \
  "CREATE FUNCTION teste.p_inv() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.magazie_bucati';
  CREATE FUNCTION teste.p_def() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = teste AS 'BEGIN RETURN teste.p_inv(); END'" \
  "DROP FUNCTION teste.p_def(); DROP FUNCTION teste.p_inv()" 1 "'teste.p_def()' = ANY ($FN_NOU)"
dif "martor: DEFINER (cale teste) → funcție de platformă chemată calificat" \
  "CREATE FUNCTION storage.izo_cit2() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.magazie_bucati';
  CREATE FUNCTION teste.s_def() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = teste AS 'BEGIN RETURN storage.izo_cit2(); END'" \
  "DROP FUNCTION teste.s_def(); DROP FUNCTION storage.izo_cit2()" 1 "'teste.s_def()' = ANY ($FN_NOU)"
# schema construită „x)(?=x)y(x”: neescapată, închidea grupul alternanței comune și făcea bucata imposibil de potrivit — toate numele
# din aceeași frontieră scăpau (verde fals); E2a dă eroare de regex pe ea. Acum: schema escapată (primele două: DEFINER-ul e găsit)
# + refuz din mesaj (a treia: fără niciun DEFINER, doar mesajul ține poarta închisă, cum o ține eroarea în E2a)
EVIL="$(cat <<'SQL'
CREATE SCHEMA "x)(?=x)y(x";
CREATE FUNCTION "x)(?=x)y(x".f() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.magazie_bucati';
SQL
)"
STERGE_EVIL='SET client_min_messages = warning; DROP SCHEMA "x)(?=x)y(x" CASCADE'
dif_strict "schemă construită + DEFINER (cale teste) → INVOKER teste" \
  "$EVIL CREATE FUNCTION teste.p_inv() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.magazie_bucati';
  CREATE FUNCTION teste.p_def() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = teste AS 'BEGIN RETURN teste.p_inv(); END'" \
  "DROP FUNCTION teste.p_def(); DROP FUNCTION teste.p_inv(); $STERGE_EVIL" err "'teste.p_def()' = ANY ($FN_NOU)"
dif_strict "schemă construită + DEFINER (cale teste) → funcție de platformă chemată calificat" \
  "$EVIL CREATE FUNCTION storage.izo_cit2() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.magazie_bucati';
  CREATE FUNCTION teste.s_def() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = teste AS 'BEGIN RETURN storage.izo_cit2(); END'" \
  "DROP FUNCTION teste.s_def(); DROP FUNCTION storage.izo_cit2(); $STERGE_EVIL" err "'teste.s_def()' = ANY ($FN_NOU)"
dif_strict "schemă construită, fără niciun DEFINER (refuzul vine doar din mesaj, ca eroarea din E2a)" "$EVIL" "$STERGE_EVIL" err \
  "'$SPEC' = ANY (public.fn_izo_porti_lipsa()) AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = ANY ((teste.inchidere_noua()).o_fn) AND p.prosecdef)"
# „|” în schemă: în E2a e alternanță de nivel superior (fals-pozitive: q_def intră pentru „ qwerty”), în cea nouă e escapat — diferă
# doar fals-pozitivele E2a; poarta nouă refuză oricum din mesaj (P2)
dif_strict "schemă cu „|” (q|zz): fals-pozitive în E2a, refuz din mesaj în cea nouă" \
  "CREATE SCHEMA \"q|zz\"; CREATE FUNCTION \"q|zz\".f() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.magazie_bucati';
  CREATE FUNCTION teste.q_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT 1::bigint AS qwerty'" \
  "SET client_min_messages = warning; DROP FUNCTION teste.q_def(); DROP SCHEMA \"q|zz\" CASCADE" ok \
  "'teste.q_def()' = ANY ($FN_VECHI) AND NOT ('teste.q_def()' = ANY ($FN_NOU)) AND '$SPEC' = ANY (public.fn_izo_porti_lipsa())"
# ghilimele în nume: în corp apar dublate („teste.\"x\"\"y\"()”) — nicio expresie nu le găsește; E2a: verde fals
dif_strict "ghilimele în nume: INVOKER teste.\"x\"\"y\" citește registrul, DEFINER îl cheamă (E2a: verde fals)" \
  "CREATE FUNCTION teste.\"x\"\"y\"() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.magazie_bucati';
  CREATE FUNCTION teste.g_def() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS 'BEGIN RETURN teste.\"x\"\"y\"(); END'" \
  "DROP FUNCTION teste.g_def(); DROP FUNCTION teste.\"x\"\"y\"()" ok \
  "NOT ('teste.g_def()' = ANY ($FN_VECHI)) AND '$SPEC' = ANY (public.fn_izo_porti_lipsa())"
# citire FĂRĂ numele scris și fără EXECUTE: identificator U&"…", SQL dat ca text, fișierele / paginile tabelului — fiecare DEFINER (și
# cel care cheamă un INVOKER de felul ăsta) e în închiderea nouă, niciunul în E2a (verde fals)
SFE="$(cat <<'SQL'
DO $m$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('u',  $c$RETURN (SELECT count(*) FROM public.U&"m\0061gazie_bucati");$c$),
      ('qx', $c$PERFORM query_to_xml('select count(*) from public.m' || 'agazie_bucati', true, false, '');$c$),
      ('tx', $c$PERFORM table_to_xml(('public.m' || 'agazie_bucati')::regclass, true, false, '');$c$),
      ('sx', $c$PERFORM schema_to_xml('public', true, false, '');$c$),
      ('dx', $c$PERFORM database_to_xml(true, false, '');$c$),
      ('ts', $c$PERFORM ts_stat('select to_tsvector(id::text) from public.m' || 'agazie_bucati');$c$),
      ('tr', $c$PERFORM ts_rewrite('a'::tsquery, 'select ''a''::tsquery, ''b''::tsquery from public.m' || 'agazie_bucati');$c$),
      ('ct', $c$PERFORM crosstab('select 1, 2, 3 from public.m' || 'agazie_bucati');$c$),
      ('cb', $c$PERFORM connectby('public.m' || 'agazie_bucati', 'id', 'id', '1', 0);$c$),
      ('db', $c$PERFORM dblink('dbname=x', 'select 1 from public.m' || 'agazie_bucati');$c$),
      ('rf', $c$PERFORM pg_read_file(pg_relation_filepath('public.m' || 'agazie_bucati'));$c$),
      ('rb', $c$PERFORM pg_read_binary_file(pg_relation_filepath('public.m' || 'agazie_bucati'));$c$),
      ('lo', $c$PERFORM lo_import('/tmp/x');$c$),
      ('rp', $c$PERFORM get_raw_page('public.m' || 'agazie_bucati', 0);$c$)) v(k, corp)
  LOOP
    EXECUTE format('CREATE FUNCTION teste.%I() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS %L', 'sfe_' || r.k, 'BEGIN ' || r.corp || ' RETURN 0; END');
  END LOOP;
END $m$;
CREATE FUNCTION teste.sfe_inv() RETURNS bigint LANGUAGE plpgsql AS $c$BEGIN PERFORM query_to_xml('select 1', true, false, ''); RETURN 0; END$c$;
CREATE FUNCTION teste.sfe_def() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $c$BEGIN RETURN teste.sfe_inv(); END$c$;
SQL
)"
SFE_NUME="ARRAY['teste.sfe_u()','teste.sfe_qx()','teste.sfe_tx()','teste.sfe_sx()','teste.sfe_dx()','teste.sfe_ts()','teste.sfe_tr()','teste.sfe_ct()','teste.sfe_cb()','teste.sfe_db()','teste.sfe_rf()','teste.sfe_rb()','teste.sfe_lo()','teste.sfe_rp()','teste.sfe_inv()','teste.sfe_def()']"
dif_strict "citire fără nume scris și fără EXECUTE (U&, *_to_xml, ts_stat / ts_rewrite, crosstab / connectby, dblink, pg_read_*file, lo_import, get_raw_page)" \
  "$SFE" "DO \$m\$ DECLARE r record; BEGIN FOR r IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'teste'::regnamespace AND p.proname LIKE 'sfe\_%' LOOP EXECUTE format('DROP FUNCTION %s', r.oid::regprocedure); END LOOP; END \$m\$" ok \
  "$SFE_NUME <@ $FN_NOU AND NOT ($SFE_NUME && $FN_VECHI)"
# comentariu între schema platformei și nume (DEFINER cu cale fixă teste → storage.izo_c3 calificat): simplu, imbricat, de rând
# (cu ghilimele), și cu un „/*” într-un șir înainte — E2a: verde fals
COM="$(cat <<'SQL'
CREATE FUNCTION storage.izo_c3() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.magazie_bucati';
CREATE FUNCTION teste.com_1() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = teste AS $b$ BEGIN RETURN storage/**/.izo_c3(); END $b$;
CREATE FUNCTION teste.com_2() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = teste AS $b$ BEGIN RETURN storage /* a /* b */ c */ . /* d */ izo_c3(); END $b$;
CREATE FUNCTION teste.com_3() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = teste AS $b$ BEGIN RETURN "storage" -- x
  . -- y
  "izo_c3"(); END $b$;
CREATE FUNCTION teste.com_4() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = teste AS $b$ BEGIN PERFORM '/*'; RETURN storage /* q */ .izo_c3(); END $b$;
SQL
)"
COM_NUME="ARRAY['teste.com_1()','teste.com_2()','teste.com_3()','teste.com_4()']"
dif_strict "comentariu între schema platformei și nume (simplu / imbricat / de rând / după un „/*” dintr-un șir)" \
  "$COM" "DROP FUNCTION teste.com_1(), teste.com_2(), teste.com_3(), teste.com_4(); DROP FUNCTION storage.izo_c3()" ok \
  "$COM_NUME <@ $FN_NOU AND NOT ($COM_NUME && $FN_VECHI)"
# 40 000 de niveluri de comentarii imbricate între schemă și nume: copia fără comentarii se oprește la 20 de niveluri (fără plafon:
# o trecere pe nivel, ~zeci de secunde — aici statement_timeout de 10 s), iar corpul prea adânc intră în sămânță (DEFINER → refuz)
export PGOPTIONS="-c statement_timeout=10s"
dif_strict "40 000 de comentarii imbricate între schema platformei și nume (plafon de 20 de niveluri, apoi sămânță)" \
  "CREATE FUNCTION storage.izo_c3() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.magazie_bucati';
  DO \$m\$ BEGIN
    EXECUTE format('CREATE FUNCTION teste.com_5() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = teste AS %L',
                   'BEGIN RETURN storage ' || repeat('/* ', 40000) || repeat(' */', 40000) || ' .izo_c3(); END');
  END \$m\$" \
  "DROP FUNCTION teste.com_5(); DROP FUNCTION storage.izo_c3()" ok \
  "'teste.com_5()' = ANY ($FN_NOU) AND NOT ('teste.com_5()' = ANY ($FN_VECHI))"
unset PGOPTIONS
# ── r5g (#825, Copilot P1): copia fără comentarii nu înțelege literalii ⇒ un corp cu „/*” sau „--” are calea necunoscută ──
# DEFINER public (cale public, pg_temp) → storage.izo_c4 calificat, rupt de comentarii: (a) cazul Copilot — un literal '--'
# înaintea apelului pe aceeași linie (originalul n-are forma calificată, copia taie de la „--”-ul din literal); (b) inversul —
# un literal '/*' și un comentariu „--” care conține „*/” între schemă și punct (copia taie de la literal până la „*/”, cu tot
# cu schema). E2a și r5f: verde fals; r5g: ambii DEFINER intră în închidere (necalificatul izo_c4 se caută în corpul lor)
LIT="$(cat <<'SQL'
CREATE FUNCTION storage.izo_c4() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.magazie_bucati';
CREATE FUNCTION public.t_r5g_lit_a() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $b$DECLARE x text; BEGIN x := '--'; PERFORM storage /* ascuns */ . izo_c4(); RETURN 0; END$b$;
CREATE FUNCTION public.t_r5g_lit_b() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $b$BEGIN PERFORM '/*'; RETURN storage -- */ ascuns
  . izo_c4(); END$b$;
SQL
)"
LIT_NUME="ARRAY['t_r5g_lit_a()','t_r5g_lit_b()']"
dif_strict "literal „--” / „/*” + comentariu în apelul calificat al schemei platformei (cale fixă fără ea: public, pg_temp)" \
  "$LIT" "DROP FUNCTION public.t_r5g_lit_a(), public.t_r5g_lit_b(); DROP FUNCTION storage.izo_c4()" ok \
  "$LIT_NUME <@ $FN_NOU AND NOT ($LIT_NUME && $FN_VECHI)"
# ── r5g (#825, Jak P1): invocarea implicită — operator / cast / agregat cu funcția-suport în închidere (sau mutator) → refuz
# explicit din mesaj; DEFINER-ul care îi folosește nu-i scrie numele, deci nu e în nicio închidere (E2a: verde fals) ──
IMP_SUF=" (funcție-suport din închiderea citirilor sau mutator de cale) (citire nerevizuită)"
imp() { echo "'invocare implicită neanalizată: $1$IMP_SUF' = ANY ((teste.inchidere_noua()).o_mesaje) AND 'invocare implicită neanalizată: $1$IMP_SUF' = ANY (public.fn_izo_porti_lipsa())"; }
# operatorul: contraexemplul Jak (prefix, OPERATOR(audit.#!#)) + infix peste un mutator de cale (DEFINER cu cale fixă teste care,
# după operator, cheamă necalificat o funcție de platformă care citește registrul)
dif_strict "operator prefix peste o funcție din închidere (Jak) + operator infix peste un mutator" \
  "CREATE SCHEMA audit;
  CREATE FUNCTION audit.doc_count(bigint) RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.magazie_bucati';
  CREATE OPERATOR audit.#!# (RIGHTARG = bigint, FUNCTION = audit.doc_count);
  CREATE FUNCTION teste.imp_op() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT OPERATOR(audit.#!#) 0::bigint';
  CREATE FUNCTION storage.izo_c5() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.magazie_bucati';
  CREATE FUNCTION teste.imp_mut(bigint, bigint) RETURNS bigint LANGUAGE plpgsql AS 'BEGIN PERFORM set_config(''search_path'', ''storage'', true); RETURN \$1; END';
  CREATE OPERATOR teste.<~~> (LEFTARG = bigint, RIGHTARG = bigint, FUNCTION = teste.imp_mut);
  CREATE FUNCTION teste.imp_infix() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = teste AS 'BEGIN PERFORM 1::bigint <~~> 2::bigint; RETURN izo_c5(); END'" \
  "SET client_min_messages = warning; DROP FUNCTION teste.imp_infix(), teste.imp_op(), storage.izo_c5(); DROP OPERATOR teste.<~~> (bigint, bigint); DROP FUNCTION teste.imp_mut(bigint, bigint); DROP SCHEMA audit CASCADE" ok \
  "$(imp 'operator audit.#!#(NONE,bigint) → audit.doc_count(bigint)') AND $(imp 'operator teste.<~~>(bigint,bigint) → teste.imp_mut(bigint,bigint)')
   AND NOT (ARRAY['teste.imp_op()','teste.imp_infix()'] && coalesce($FN_NOU, '{}') OR ARRAY['teste.imp_op()','teste.imp_infix()'] && coalesce($FN_VECHI, '{}'))"
dif_strict "cast cu funcția în închidere" \
  "CREATE TYPE teste.t_imp AS (nr bigint);
  CREATE FUNCTION teste.imp_cast(integer) RETURNS teste.t_imp LANGUAGE sql AS 'SELECT ROW((SELECT count(*) FROM public.magazie_bucati))::teste.t_imp';
  CREATE CAST (integer AS teste.t_imp) WITH FUNCTION teste.imp_cast(integer);
  CREATE FUNCTION teste.imp_cast_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT (1::teste.t_imp).nr'" \
  "DROP FUNCTION teste.imp_cast_def(); DROP CAST (integer AS teste.t_imp); DROP FUNCTION teste.imp_cast(integer); DROP TYPE teste.t_imp" ok \
  "$(imp 'cast (integer AS teste.t_imp) → teste.imp_cast(integer)') AND NOT ('teste.imp_cast_def()' = ANY (coalesce($FN_NOU, '{}')))"
dif_strict "agregate cu funcția de tranziție / finală în închidere" \
  "CREATE FUNCTION teste.imp_sf(bigint, integer) RETURNS bigint LANGUAGE sql AS 'SELECT \$1 + (SELECT count(*) FROM public.magazie_bucati)';
  CREATE AGGREGATE teste.imp_agg(integer) (SFUNC = teste.imp_sf, STYPE = bigint, INITCOND = '0');
  CREATE FUNCTION teste.imp_sf2(bigint, integer) RETURNS bigint LANGUAGE sql AS 'SELECT \$1 + \$2';
  CREATE FUNCTION teste.imp_ff(bigint) RETURNS bigint LANGUAGE sql AS 'SELECT \$1 + (SELECT count(*) FROM public.izo_atribuiri)';
  CREATE AGGREGATE teste.imp_agg2(integer) (SFUNC = teste.imp_sf2, STYPE = bigint, FINALFUNC = teste.imp_ff, INITCOND = '0');
  CREATE FUNCTION teste.imp_agg_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT teste.imp_agg(1) + teste.imp_agg2(1)'" \
  "DROP FUNCTION teste.imp_agg_def(); DROP AGGREGATE teste.imp_agg(integer), teste.imp_agg2(integer); DROP FUNCTION teste.imp_sf(bigint, integer), teste.imp_sf2(bigint, integer), teste.imp_ff(bigint)" ok \
  "$(imp 'agregat teste.imp_agg(integer) → teste.imp_sf(bigint,integer)') AND $(imp 'agregat teste.imp_agg2(integer) → teste.imp_ff(bigint)')
   AND NOT ('teste.imp_agg_def()' = ANY (coalesce($FN_NOU, '{}')))"
# martorul (nouă = E2a): operator / cast / agregat peste funcții din afara închiderii, folosite de un DEFINER → poarta verde
dif "martor r5g: operator / cast / agregat nevinovate (funcții din afara închiderii)" \
  "CREATE FUNCTION teste.nev_f(bigint) RETURNS bigint LANGUAGE sql AS 'SELECT \$1 + 1';
  CREATE OPERATOR teste.#+# (RIGHTARG = bigint, FUNCTION = teste.nev_f);
  CREATE TYPE teste.t_nev AS (nr bigint);
  CREATE FUNCTION teste.nev_cast(integer) RETURNS teste.t_nev LANGUAGE sql AS 'SELECT ROW(\$1::bigint)::teste.t_nev';
  CREATE CAST (integer AS teste.t_nev) WITH FUNCTION teste.nev_cast(integer);
  CREATE FUNCTION teste.nev_sf(bigint, bigint) RETURNS bigint LANGUAGE sql AS 'SELECT \$1 + \$2';
  CREATE AGGREGATE teste.nev_agg(bigint) (SFUNC = teste.nev_sf, STYPE = bigint, INITCOND = '0');
  CREATE FUNCTION teste.nev_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT (OPERATOR(teste.#+#) 0::bigint) + (1::teste.t_nev).nr + teste.nev_agg(1::bigint)'" \
  "DROP FUNCTION teste.nev_def(); DROP AGGREGATE teste.nev_agg(bigint); DROP FUNCTION teste.nev_sf(bigint, bigint); DROP CAST (integer AS teste.t_nev);
  DROP FUNCTION teste.nev_cast(integer); DROP TYPE teste.t_nev; DROP OPERATOR teste.#+# (NONE, bigint); DROP FUNCTION teste.nev_f(bigint)" 0 \
  "cardinality(public.fn_izo_porti_lipsa()) = 0 AND cardinality((teste.inchidere_noua()).o_mesaje) = 0 AND teste.nev_def() = 3"
# ── r5f (#825): tabelele documentelor E3 în închiderea citirilor (design §13.2) ──
# dif_doc <etichetă> <creează> <șterge> <rosu|verde> <verificare SQL> — mutațiile pe documente: pe sămânța E2a închiderile rămân
# egale (veche = nouă; E2a nu vede documentele), închiderea exactă din migrare (inchidere_noua_e3) le prinde, iar poarta REALĂ e
# roșie (DEFINER / view fără security_invoker / lanț) sau verde (view security_invoker / INVOKER necitite de un DEFINER)
FN_E3="(SELECT array_agg(x::regprocedure::text) FROM unnest((teste.inchidere_noua_e3()).o_fn) x)::text[]"
dif_doc() { local et="$1" crea="$2" sterge="$3" v n g c
  q "$crea" >/dev/null || esec "2 $et: mutația nu s-a putut crea"
  v="$(q "$INCH teste.inchidere_veche()")" || esec "2 $et: închiderea veche a dat eroare"
  n="$(q "$INCH teste.inchidere_noua()")" || esec "2 $et: închiderea nouă a dat eroare"
  g="$(q "SELECT cardinality(public.fn_izo_porti_lipsa())")" || esec "2 $et: poarta reală a dat eroare"
  c="$(q "SELECT coalesce(($5), false)")" || esec "2 $et: verificarea a dat eroare"
  q "$sterge" >/dev/null || esec "2 $et: mutația nu s-a putut șterge"
  [ "$v" = "$n" ] || esec "2 $et: pe aceeași sămânță (E2a), închiderea veche [${v:0:3000}] ≠ cea nouă [${n:0:3000}]"
  if [ "$4" = rosu ]; then [ "$g" -gt 0 ] || esec "2 $et: poarta e verde pe o citire a documentelor E3 din afara fn_izo_*"
  else [ "$g" = 0 ] || esec "2 $et: poarta e roșie pe o mutație legitimă ($g lipsuri)"; fi
  [ "$c" = t ] || esec "2 $et: verificarea mutației nu ține: $5"; }
dif_doc "documente: DEFINER direct pe izo_documente_intrare" \
  "CREATE FUNCTION teste.dd_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM public.izo_documente_intrare'" \
  "DROP FUNCTION teste.dd_def()" rosu "'teste.dd_def()' = ANY ($FN_E3) AND NOT ('teste.dd_def()' = ANY (coalesce($FN_NOU, '{}')))"
dif_doc "documente: view fără security_invoker pe izo_documente_scanuri" \
  "CREATE VIEW teste.dd_v AS SELECT * FROM public.izo_documente_scanuri" "DROP VIEW teste.dd_v" rosu \
  "'teste.dd_v'::regclass::oid = ANY ((teste.inchidere_noua_e3()).o_rel) AND NOT ('teste.dd_v'::regclass::oid = ANY ((teste.inchidere_noua()).o_rel))"
dif_doc "documente: același view cu security_invoker = on (necitit de un DEFINER)" \
  "CREATE VIEW teste.dd_v WITH (security_invoker = on) AS SELECT * FROM public.izo_documente_scanuri" "DROP VIEW teste.dd_v" verde \
  "'teste.dd_v'::regclass::oid = ANY ((teste.inchidere_noua_e3()).o_rel)"
dif_doc "documente: INVOKER pe izo_documente_intrare_randuri, nechemat de un DEFINER" \
  "CREATE FUNCTION teste.dd_inv() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.izo_documente_intrare_randuri'" \
  "DROP FUNCTION teste.dd_inv()" verde "'teste.dd_inv()' = ANY ($FN_E3)"
dif_doc "documente: DEFINER → INVOKER pe izo_documente_intrare_randuri" \
  "CREATE FUNCTION teste.dd_inv() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.izo_documente_intrare_randuri';
  CREATE FUNCTION teste.dd_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT teste.dd_inv()'" \
  "DROP FUNCTION teste.dd_def(); DROP FUNCTION teste.dd_inv()" rosu "ARRAY['teste.dd_inv()', 'teste.dd_def()'] <@ $FN_E3"
dif_doc "documente: DEFINER cu nume citat (\"public\".\"izo_documente_scanuri\")" \
  "CREATE FUNCTION teste.dd_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM \"public\".\"izo_documente_scanuri\"'" \
  "DROP FUNCTION teste.dd_def()" rosu "'teste.dd_def()' = ANY ($FN_E3)"
# ── r5g (#825) NO-GO P1-C: funcțiile fn_izo_* sunt ȚINTE ale închiderii doar în sămânța E3 (inchidere_noua_e3); pe sămânța E2a
# închiderile rămân egale (veche = nouă), iar poarta REALĂ e roșie pe ce cheamă din afara fn_izo_* un cititor fn_izo_* (DEFINER,
# view fără security_invoker, operator) și pe invocările lor implicite din catalog (ștampila E3); verde pe un INVOKER nechemat ──
MSG_E3_DEF="definițiile E3 (indexuri / ACL pe tabele și coloane / politici / trigger-e / roluri / bucket / storage.objects / storage.buckets / invocările implicite ale fn_izo_*) diferă de amprenta de la migrare"
dif_doc "fn_izo_*: DEFINER (cale public, pg_temp) peste cititorul INVOKER al bucății așteptate, fără tabel numit" \
  "CREATE FUNCTION teste.fz_def(bigint) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT fn_izo_doc_bucata_asteptata(\$1, 1)'" \
  "DROP FUNCTION teste.fz_def(bigint)" rosu "'teste.fz_def(bigint)' = ANY ($FN_E3) AND NOT ('teste.fz_def(bigint)' = ANY (coalesce($FN_NOU, '{}')))"
dif_doc "fn_izo_*: DEFINER peste DEFINER-ul intern E2a fn_izo_bucata_proiect" \
  "CREATE FUNCTION teste.fz_bp(bigint) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT public.fn_izo_bucata_proiect(\$1)'" \
  "DROP FUNCTION teste.fz_bp(bigint)" rosu "'teste.fz_bp(bigint)' = ANY ($FN_E3) AND NOT ('teste.fz_bp(bigint)' = ANY (coalesce($FN_NOU, '{}')))"
dif_doc "fn_izo_*: INVOKER peste fn_izo_doc_hash, nechemat de un DEFINER" \
  "CREATE FUNCTION teste.fz_inv(bigint) RETURNS text LANGUAGE sql AS 'SELECT public.fn_izo_doc_hash(\$1)'" \
  "DROP FUNCTION teste.fz_inv(bigint)" verde "'teste.fz_inv(bigint)' = ANY ($FN_E3) AND NOT ('teste.fz_inv(bigint)' = ANY (coalesce($FN_NOU, '{}')))"
dif_doc "fn_izo_*: view fără security_invoker peste fn_izo_doc_hash" \
  "CREATE VIEW teste.fz_v AS SELECT public.fn_izo_doc_hash(1) AS h" "DROP VIEW teste.fz_v" rosu \
  "'teste.fz_v'::regclass::oid = ANY ((teste.inchidere_noua_e3()).o_rel) AND NOT ('teste.fz_v'::regclass::oid = ANY ((teste.inchidere_noua()).o_rel))"
dif_doc "fn_izo_*: operator peste fn_izo_doc_hash" \
  "CREATE OPERATOR teste.#~# (RIGHTARG = bigint, FUNCTION = public.fn_izo_doc_hash)" "DROP OPERATOR teste.#~# (NONE, bigint)" rosu \
  "'invocare implicită neanalizată: operator teste.#~#(NONE,bigint) → fn_izo_doc_hash(bigint)$IMP_SUF' = ANY ((teste.inchidere_noua_e3()).o_mesaje)"
dif_doc "fn_izo_*: DEFAULT al unui tabel oarecare peste fn_izo_doc_hash (ștampila E3)" \
  "CREATE TABLE teste.fz_t (h text DEFAULT public.fn_izo_doc_hash(1))" "DROP TABLE teste.fz_t" rosu "'$MSG_E3_DEF' = ANY (public.fn_izo_porti_e3_lipsa())"
# ── r5g (#825) NO-GO P1-D: invocarea implicită prin expresii din catalog peste funcții din închidere (aici: pe registru, deci și
# în închiderea E2a) — CHECK pe domeniu / tabel, DEFAULT, coloană generată, index pe expresie, trigger, politică; DEFINER-ul doar
# inserează, nu numește nimic (E2a: verde fals) → câte un refuz explicit, cu obiectul numit ──
IMP_CAT=" (obiect din catalog care cheamă o funcție din închiderea citirilor) (citire nerevizuită)"
impc() { echo "EXISTS (SELECT 1 FROM unnest((teste.inchidere_noua()).o_mesaje) m WHERE m LIKE 'invocare implicită neanalizată: $1' AND m LIKE '%$IMP_CAT')
  AND EXISTS (SELECT 1 FROM unnest(public.fn_izo_porti_lipsa()) m WHERE m LIKE 'invocare implicită neanalizată: $1' AND m LIKE '%$IMP_CAT')"; }
IMPC="$(cat <<'SQL'
CREATE SCHEMA audit;
CREATE FUNCTION audit.cit(int) RETURNS boolean LANGUAGE sql AS 'SELECT $1 > -1 - (SELECT count(*) FROM public.magazie_bucati)';
CREATE FUNCTION audit.cit_ix(int) RETURNS bigint LANGUAGE sql IMMUTABLE AS 'SELECT $1 + 0 * (SELECT count(*) FROM public.izo_atribuiri)';
CREATE FUNCTION audit.cit_txt() RETURNS text LANGUAGE sql AS 'SELECT count(*)::text FROM public.izo_importuri';
CREATE FUNCTION audit.cit_trg() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN NEW.x := (SELECT count(*) FROM public.magazie_bucati_miscari); RETURN NEW; END$f$;
CREATE DOMAIN audit.dom AS int CHECK (audit.cit(VALUE));
CREATE TABLE audit.t (x bigint CHECK (audit.cit(x::int)), d text DEFAULT audit.cit_txt(), g bigint GENERATED ALWAYS AS (audit.cit_ix(x::int)) STORED);
CREATE INDEX t_ix ON audit.t (audit.cit_ix(x::int));
CREATE TRIGGER t_bi BEFORE INSERT ON audit.t FOR EACH ROW EXECUTE FUNCTION audit.cit_trg();
ALTER TABLE audit.t ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_p ON audit.t USING (audit.cit(x::int));
CREATE FUNCTION teste.ic_def() RETURNS text LANGUAGE sql SECURITY DEFINER AS 'INSERT INTO audit.t (x) SELECT (1::audit.dom)::bigint RETURNING d';
SQL
)"
dif_strict "invocare implicită din catalog: CHECK pe domeniu / tabel, DEFAULT, coloană generată, index pe expresie, trigger, politică" \
  "$IMPC" "SET client_min_messages = warning; DROP FUNCTION teste.ic_def(); DROP SCHEMA audit CASCADE" ok \
  "$(impc 'constraint dom\_check% → audit.cit(integer)%') AND $(impc 'constraint t\_x\_check on table audit.t → audit.cit(integer)%')
   AND $(impc 'default value for column d of table audit.t → audit.cit\_txt()%') AND $(impc 'default value for column g of table audit.t → audit.cit\_ix(integer)%')
   AND $(impc 'index audit.t\_ix → audit.cit\_ix(integer)%') AND $(impc 'trigger t\_bi on table audit.t → audit.cit\_trg()%')
   AND $(impc 'policy t\_p on table audit.t → audit.cit(integer)%')
   AND NOT ('teste.ic_def()' = ANY (coalesce($FN_NOU, '{}')) OR 'teste.ic_def()' = ANY (coalesce($FN_VECHI, '{}')))"
# ── r5h (#825 r5g NO-GO, Jak P1): invocarea implicită a unui MUTATOR de cale — trigger INVOKER cu set_config('search_path',
# 'storage, public', true) pe un tabel auxiliar; DEFINER-ul (cale public, pg_temp) inserează acolo, apoi cheamă NECALIFICAT
# izo_c6() — storage.izo_c6, care citește registrul. Nimeni nu numește mutatorul ⇒ DEFINER-ul nu e mutator și nici în închidere
# (E2a și r5g: verde fals); r5h: refuz explicit pe trigger. Verificarea rulează și DEFINER-ul: ajunge la storage.izo_c6 (calea a
# fost schimbată de trigger — fără el, izo_c6() nu s-ar rezolva) ──
IMP_MUT=" (obiect din catalog care cheamă un mutator de cale) (citire nerevizuită)"
impm() { echo "EXISTS (SELECT 1 FROM unnest((teste.inchidere_noua()).o_mesaje) m WHERE m LIKE 'invocare implicită neanalizată: $1' AND m LIKE '%$IMP_MUT')
  AND EXISTS (SELECT 1 FROM unnest(public.fn_izo_porti_lipsa()) m WHERE m LIKE 'invocare implicită neanalizată: $1' AND m LIKE '%$IMP_MUT')"; }
IMPM="$(cat <<'SQL'
CREATE SCHEMA audit;
CREATE TABLE audit.aux (x int);
CREATE FUNCTION audit.cale_trg() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN PERFORM set_config('search_path', 'storage, public', true); RETURN NEW; END$f$;
CREATE TRIGGER aux_bi BEFORE INSERT ON audit.aux FOR EACH ROW EXECUTE FUNCTION audit.cale_trg();
CREATE FUNCTION storage.izo_c6() RETURNS text LANGUAGE sql AS $f$SELECT 'storage:' || count(*) FROM public.magazie_bucati$f$;
CREATE FUNCTION public.t_r5h_cale() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $b$BEGIN INSERT INTO audit.aux VALUES (1); RETURN izo_c6(); END$b$;
SQL
)"
dif_strict "invocare implicită a unui mutator de cale: trigger INVOKER cu set_config pe un tabel auxiliar + DEFINER (cale public, pg_temp) care inserează și cheamă necalificat cititorul din storage" \
  "$IMPM" "SET client_min_messages = warning; DROP FUNCTION public.t_r5h_cale(), storage.izo_c6(); DROP SCHEMA audit CASCADE" ok \
  "$(impm 'trigger aux\_bi on table audit.aux → audit.cale\_trg()%') AND 'audit.cale_trg()' = ANY ($MUT_NOU)
   AND NOT ('t_r5h_cale()' = ANY (coalesce($FN_NOU, '{}')) OR 't_r5h_cale()' = ANY (coalesce($FN_VECHI, '{}')) OR 't_r5h_cale()' = ANY (coalesce($MUT_NOU, '{}')))
   AND public.t_r5h_cale() LIKE 'storage:%'"
# ── r5g (#825) NO-GO P2: martorul (nouă = E2a, poarta verde) — forma de pe prod (DEFINER cu cale public, pg_temp, CAST() + un
# comentariu oarecare, cu realtime.cast în închidere ca INVOKER cu SQL dinamic); regula largă (orice „--” / „/*”) îl înroșea ──
P2W="$(cat <<'SQL'
CREATE SCHEMA realtime;
CREATE FUNCTION realtime."cast"(val text, type_ regtype) RETURNS jsonb LANGUAGE plpgsql
  AS $f$DECLARE r jsonb; BEGIN EXECUTE format('SELECT to_jsonb(%L::%s)', val, type_) INTO r; RETURN r; END$f$;
CREATE FUNCTION public.t_r5g_tichet() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $b$BEGIN -- numărul următor
  RETURN (SELECT coalesce(max(CAST(substring(x FROM '[0-9]+') AS integer)), 0) + 1 FROM (VALUES ('TKT-0007')) v(x)); END$b$;
SQL
)"
dif "martor r5g P2: DEFINER (cale public, pg_temp) cu un comentariu oarecare și CAST( — realtime.cast în închidere" "$P2W" \
  "SET client_min_messages = warning; DROP FUNCTION public.t_r5g_tichet(); DROP SCHEMA realtime CASCADE" 0 \
  "cardinality(public.fn_izo_porti_lipsa()) = 0 AND 'realtime.\"cast\"(text,regtype)' = ANY ($FN_NOU) AND NOT ('t_r5g_tichet()' = ANY ($FN_NOU))"
[ "$(q "SELECT cardinality(public.fn_izo_porti_lipsa())")" = 0 ] || esec "2 porțile nu au revenit complete"
ok "2 diferențial: poarta nouă (rapidă) = poarta E2a pe 24 de mutații (DEFINER direct, view, lanț de 3 view-uri, INVOKER prin DEFINER, citat, overload, mutator; r5f: 7 cicluri — DEFINER ↔ INVOKER ×3, mutatori, view ↔ view, view ↔ funcție, view ↔ ATOMIC; pragul de 100 pe ambele bucle — sub / la / peste, refuz la neconvergență; 2 frontiere largi; 2 martori cu cale fixă) + 12 mutații pe care e mai strictă (3 cu schemă construită — E2a: eroare; „|” în schemă; ghilimele în nume; 16 citiri fără nume scris / fără EXECUTE; 4 comentarii în numele calificat; 40 000 de comentarii imbricate; r5g: 2 literali „--” / „/*” care taie copia fără comentarii; operator prefix + infix peste mutator; cast; 2 agregate) + martorul r5g (operator / cast / agregat nevinovate: nouă = E2a, poarta verde); r5f #825: sămânța din migrare = E2a + exact cele 3 tabele ale documentelor (stare curată + toate cele 24) + 6 mutații pe documente (DEFINER, view fără / cu security_invoker, INVOKER singur, DEFINER → INVOKER, citat); r5g #825 NO-GO: 6 mutații pe țintele fn_izo_* (DEFINER peste cititorul INVOKER / peste DEFINER-ul intern E2a, view, operator, DEFAULT → ștampila E3: roșu; INVOKER nechemat: verde) + invocarea implicită din catalog (7 obiecte: CHECK pe domeniu / tabel, 2 DEFAULT / generată, index, trigger, politică — mai strictă) + martorul P2 (comentariu oarecare + CAST(, nouă = E2a, verde); r5h (#825 r5g NO-GO): invocarea implicită a unui mutator de cale (trigger INVOKER cu set_config pe un tabel auxiliar + DEFINER care inserează și cheamă necalificat cititorul din storage — mai strictă, refuz explicit pe trigger)"


ok 'diferentialul E3 pasul 2 complet, peste E3b'
baza_scoate

BAZA=izo_e3b_cursa_test
baza_noua
lant_apply
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e3b_cursa.sql" >/dev/null
COR="$(q "SELECT id FROM public.izo_corectii WHERE motiv='fixture cursa E1' AND stare='propusa'")"
[[ "$COR" =~ ^[0-9]+$ ]] || esec 'fixture cursa fara propunere'
CA_R="$(cat <<'SQL'
SET SESSION AUTHORIZATION authenticator; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true)
SQL
)"
cursa 'aproba x aproba aceeasi propunere'   "$CA_R; SELECT public.fn_izo_cor_aproba($COR,1)"   "BEGIN; $CA_R; DO \$race\$ DECLARE v_r jsonb; BEGIN
     BEGIN v_r:=public.fn_izo_cor_aproba($COR,1);
       IF v_r->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'retry ne-idempotent'; END IF;
       RAISE NOTICE '%',v_r;
     EXCEPTION WHEN SQLSTATE '40001' THEN RAISE NOTICE '40001'; END;
   END \$race\$; COMMIT;" ok 'idempotent.*true\|40001'
[ "$(q "SELECT count(*) FROM public.magazie_bucati_evenimente WHERE document_tip='izo_corectie' AND document_id='$COR'")" = 1 ] || esec 'cursa: eveniment duplicat'
[ "$(q "SELECT count(*) FROM public.magazie_bucati_miscari WHERE eveniment_id=(SELECT eveniment_id FROM public.izo_corectii WHERE id=$COR)")" = 1 ] || esec 'cursa: miscare duplicata'
ok 'bariera: A tine aprobarea; pg_locks confirma B in asteptare; retry idempotent/40001; un eveniment si o miscare'
baza_scoate
echo 'PASS E3b E1: M1-M4, regresii, rollback curat si cursa cu bariera'
