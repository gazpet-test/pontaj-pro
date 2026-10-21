#!/usr/bin/env bash
# Proba E3 (20261103b) pe un BRANCH Supabase de probă (PG17, postgres NESUPERUSER, PostgREST / GoTrue / Storage reale) — NU prod.
# Rulează din WSL, pe o copie LF a worktree-ului în care stă (/tmp/izo_src_br). Parola: pgpass-ul Windows copiat temporar (600),
# niciodată afișat; linia branch-ului o adaugă / o scoate sesiunea care creează / șterge branch-ul.
# Utilizare (din Windows):
#   wsl -d Ubuntu-24.04 -- bash -lc "BR_REF=<ref> BR_ANON_FILE=/mnt/c/<cale>/anon.txt bash /mnt/c/<worktree>/scripts/izometrie/e3_gen/proba_pg17/proba_e3.sh"
# Pași: 0 schelet + baseline-ul de prod pre-E3 (politicile Storage, trigger-ele profiles) · 1 E2a + 2c + E3 prin runner (preflight 0l,
# bucket-ul prin trigger-ele platformei, politici pe storage.buckets ca postgres) · 2 revenirea E3 + relivrare · 3 date + GoTrue ·
# 4 API real (PostgREST + Storage) · 5 stratul RESTRICTIV prin API-ul Storage real (permisivă generală, alt bucket)
set -Eeuo pipefail
REF="${BR_REF:?BR_REF = ref-ul branch-ului}"; ANON="$(tr -d '\r\n' < "${BR_ANON_FILE:?BR_ANON_FILE = fișierul cu cheia anon a branch-ului}")"
[ "$REF" != dxczwkbciseqniprspcu ] || { echo "REFUZ: ăsta e ref-ul de PRODUCȚIE" >&2; exit 2; }
HOST=aws-1-eu-central-1.pooler.supabase.com; PORT=5432; U="postgres.$REF"; URL="https://$REF.supabase.co"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; RAD="$(cd "$DIR/../../../.." && pwd)"
SRC=/tmp/izo_src_br; rm -rf "$SRC" && mkdir -p "$SRC/supabase"
cp -r "$RAD/scripts" "$SRC/" && cp -r "$RAD/supabase/migrations" "$RAD/supabase/revenire" "$RAD/supabase/tests" "$SRC/supabase/"
find "$SRC" -type f \( -name '*.sh' -o -name '*.sql' -o -name '*.py' \) -exec sed -i 's/\r$//' {} +
PGP="$(mktemp /tmp/izo_pgpass.XXXXXX)"; trap 'rm -f "$PGP"' EXIT
tr -d '\r' < /mnt/c/Users/Gazpet-Ai/AppData/Roaming/postgresql/pgpass.conf > "$PGP"; chmod 600 "$PGP"
export PGPASSFILE="$PGP" PGSSLMODE=require
PSQL=(psql -X -q -w -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U "$U" -d postgres)
esec() { echo "ESEC: $*" >&2; exit 1; }
ok()   { echo "OK   $*"; }
q()    { "${PSQL[@]}" -Atc "$1"; }
[ "$(q "SELECT current_setting('server_version_num')::int >= 170000 AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)")" = t ] || esec "ținta nu e PG17 cu postgres nesuperuser"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
livreaza() { PSQL_BIN=psql bash $SRC/scripts/livrare_migrare.sh --migrare "$1" --sha256 "$(sha256sum "$1" | cut -d' ' -f1)" --versiune "$2" \
    --tinta-db postgres --tinta-sistem "$SIS" --tinta-host "$HOST" --tinta-port "$PORT" --user "$U" >/tmp/izo_br_runner.out 2>&1 \
    || { tail -15 /tmp/izo_br_runner.out >&2; esec "runner $(basename "$1")"; } }
MIG_A=$SRC/supabase/migrations/20261102a_izometrie_e2a_registru.sql
MIG_C=$SRC/supabase/migrations/20261102c_izometrie_cai_vechi_stoc.sql
MIG_E3=$SRC/supabase/migrations/20261103b_izometrie_e3_documente.sql
REV_E3=$SRC/supabase/revenire/20261103b_izometrie_e3_documente_ROLLBACK.sql

# 0. scheletul (dacă lipsește) + baseline-ul de prod pre-E3 (politicile Storage exacte + stub-uri, trigger-ele profiles exacte)
if [ "$(q "SELECT to_regclass('public.magazie_bucati') IS NULL")" = t ]; then
  "${PSQL[@]}" --single-transaction -f "$SRC/scripts/izometrie/e3_gen/proba_pg17/branch_schelet.sql" >/tmp/br_schelet.out 2>&1 || { tail -5 /tmp/br_schelet.out; esec "schelet"; }
  "${PSQL[@]}" -c "REVOKE TRUNCATE, MAINTAIN ON public.magazie_bucati, public.executie_bonuri_consum, public.executie_bonuri_consum_linii FROM anon, authenticated" >/dev/null
  q "CREATE UNIQUE INDEX IF NOT EXISTS user_module_access_profile_id_module_key ON public.user_module_access (profile_id, module)" >/dev/null
fi
if [ "$(q "SELECT to_regclass('public.izo_documente_intrare') IS NULL")" = t ]; then
  python3 "$SRC/scripts/izometrie/e3_gen/proba_pg17/baseline_branch.py" "$SRC/supabase/tests/izometrie_e3_schelet_baseline.sql" /tmp/br_baseline.sql
  "${PSQL[@]}" --single-transaction -f /tmp/br_baseline.sql >/tmp/br_baseline.out 2>&1 || { tail -8 /tmp/br_baseline.out; esec "0 baseline-ul de prod pe branch"; }
fi
echo "     (a) trigger-ele platformei pe storage.buckets: $(q "SELECT coalesce(string_agg(tgname, ', ' ORDER BY tgname), '-') FROM pg_trigger WHERE tgrelid = 'storage.buckets'::regclass AND NOT tgisinternal")"
echo "     search_path postgres: $(q "SELECT coalesce(array_to_string(rolconfig, ' '), '-') FROM pg_roles WHERE rolname = 'postgres'")"
ok "0 țintă: branch $REF, PG17, postgres nesuperuser, schelet + baseline-ul de prod ($(q "SELECT count(*) FROM pg_policies WHERE schemaname = 'storage'") politici Storage)"

# 1. E2a + 2c + E3 prin runner, ca NESUPERUSER: (d) preflight-ul 0l pe PG17; (a) INSERT-ul bucket-ului prin trigger-ele platformei;
#    (b) CREATE POLICY pe storage.objects / storage.buckets ca postgres
[ "$(q "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name = '20261102a_izometrie_e2a_registru'")" = 1 ] || livreaza "$MIG_A" 20261102120000
[ "$(q "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name = '20261102c_izometrie_cai_vechi_stoc'")" = 1 ] || livreaza "$MIG_C" 20261102140000
COM_INAINTE="$(q "SELECT md5(obj_description('public.magazie_bucati_evenimente'::regclass, 'pg_class') || '#' || obj_description('public.fn_izo_porti_definitii()'::regprocedure, 'pg_proc'))")"
POL_INAINTE="$(q "SELECT md5(string_agg(tablename || '.' || policyname || ':' || permissive || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' ORDER BY tablename, policyname)) FROM pg_policies WHERE schemaname = 'storage'")"
livreaza "$MIG_E3" 20261103120000
[ "$(q "SELECT cardinality(public.fn_izo_porti_lipsa())")" = 0 ] || esec "porți lipsă pe PG17: $(q "SELECT public.fn_izo_porti_lipsa()")"
[ "$(q "SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'izo\_doc\_%' AND permissive = 'RESTRICTIVE'")" = 8 ] || esec "1 straturile RESTRICTIVE (5 + 3) lipsesc"
T_PORTI="$(q "SELECT round(extract(epoch FROM clock_timestamp() - t) * 1000) FROM (SELECT clock_timestamp() t) a, LATERAL (SELECT public.fn_izo_porti_lipsa()) b")"
ok "1 E3 livrată prin runner pe PG17 ca nesuperuser: (d) preflight 0l trecut, (a) bucket creat, (b) 8 politici RESTRICTIVE; porți complete (${T_PORTI} ms)"

# 2. (c) revenirea E3 pe branch fără fapte E3 (DROP ROLE ca nesuperuser, DELETE-ul bucket-ului + IF NOT FOUND) → baseline exact; relivrare
"${PSQL[@]}" --single-transaction -c "SELECT set_config('gazpet.revenire_20261103b', 'IZO_E3_SCOATE:' || txid_current(), true);" -f "$REV_E3" >/tmp/br_rev.out 2>&1 \
  || { tail -5 /tmp/br_rev.out >&2; esec "2 revenirea E3 pe PG17"; }
[ "$(q "SELECT md5(obj_description('public.magazie_bucati_evenimente'::regclass, 'pg_class') || '#' || obj_description('public.fn_izo_porti_definitii()'::regprocedure, 'pg_proc'))")" = "$COM_INAINTE" ] \
  || esec "2 COMMENT-urile / ștampila nu sunt cele de dinainte"
[ "$(q "SELECT md5(string_agg(tablename || '.' || policyname || ':' || permissive || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' ORDER BY tablename, policyname)) FROM pg_policies WHERE schemaname = 'storage'")" = "$POL_INAINTE" ] \
  || esec "2 politicile Storage nu sunt cele de dinainte"
[ "$(q "SELECT (SELECT count(*) FROM pg_roles WHERE rolname IN ('izo_doc_editor','izo_receptie_writer')) || ':' || (SELECT count(*) FROM storage.buckets WHERE id = 'izo-documente') || ':' || cardinality(public.fn_izo_porti_lipsa())")" = "0:0:0" ] \
  || esec "2 obiecte E3 rămase"
q "DELETE FROM supabase_migrations.schema_migrations WHERE name = '20261103b_izometrie_e3_documente'" >/dev/null
livreaza "$MIG_E3" 20261103120001
ok "2 (c) revenirea E3 pe PG17 (nesuperuser): bucket șters (IF NOT FOUND neatins), baseline + politicile Storage exacte, roluri scoase; relivrare OK"

# 3. date: LOT 2 activ, Janeta gestionar (3, 11), utilizatori GoTrue reali (Janeta, Toma) pentru JWT
q "SELECT public.fn_izo_seteaza_nivel(3, 'stoc', 'proba E3 PG17')" >/dev/null
q "INSERT INTO public.izo_atribuiri (proiect_id, profile_id, rol, depozit_id, acordat_de, motiv) SELECT 3, '00000000-0000-0000-0000-000000000030', 'gestionar', 11, 'test', 'proba E3'
   WHERE NOT EXISTS (SELECT 1 FROM public.izo_atribuiri WHERE proiect_id = 3 AND profile_id = '00000000-0000-0000-0000-000000000030' AND activ)" >/dev/null
PAROLA="$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 20)"
for x in "00000000-0000-0000-0000-000000000030 janeta" "00000000-0000-0000-0000-000000000117 toma"; do set -- $x
  q "INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, email_change, email_change_token_new, recovery_token)
     VALUES ('00000000-0000-0000-0000-000000000000', '$1', 'authenticated', 'authenticated', '$2.e3@test.local', crypt('$PAROLA', gen_salt('bf')), now(),
       '{\"provider\":\"email\",\"providers\":[\"email\"]}', '{}', now(), now(), '', '', '', '')
     ON CONFLICT (id) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password" >/dev/null
  q "INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     VALUES ('$1', '$1', jsonb_build_object('sub', '$1', 'email', '$2.e3@test.local'), 'email', now(), now(), now()) ON CONFLICT DO NOTHING" >/dev/null
done
jwt() { curl -s "$URL/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' \
          -d "{\"email\":\"$1.e3@test.local\",\"password\":\"$PAROLA\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
TJ="$(jwt janeta)"; TT="$(jwt toma)"
[ -n "$TJ" ] && [ -n "$TT" ] || esec "3 GoTrue nu a dat JWT (login cu parola)"
q "NOTIFY pgrst, 'reload schema'" >/dev/null; sleep 4
ok "3 date + utilizatori GoTrue reali (JWT obținut prin login)"

# 4. API real: PostgREST (session_user = authenticator), Storage real
rpc() { curl -s -o /tmp/br_rpc.out -w '%{http_code}' -X POST "$URL/rest/v1/rpc/$2" -H "apikey: $ANON" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
camp() { python3 -c "import sys,json; print(json.load(open('/tmp/br_rpc.out')).get('$1',''))"; }
st() { curl -s -o /tmp/br_st.out -w '%{http_code}' "$@"; }
ANTET='{"proiect_id":3,"depozit_id":11,"sablon":"aviz_teava","furnizor":"Arcelor","nr_document":"PG17-1","data_document":"2026-10-21","total_m":24.2}'
RAND='[{"nr_crt":1,"serie":"401AA00001","lungime_doc_mm":12100,"perete_mm":7.1,"diametru_mm":610},{"nr_crt":2,"serie":"401AA00002","lungime_doc_mm":12100,"perete_mm":7.1,"diametru_mm":610}]'
c="$(rpc "$ANON" fn_izo_doc_salveaza "{\"p_doc_id\":null,\"p_versiune\":null,\"p_antet\":$ANTET,\"p_randuri\":$RAND,\"p_scanuri\":null}")"
[ "$c" != 200 ] || esec "4a anon a putut salva"; echo "     anon salveaza → HTTP $c"
c="$(rpc "$TT" fn_izo_doc_salveaza "{\"p_doc_id\":null,\"p_versiune\":null,\"p_antet\":$ANTET,\"p_randuri\":$RAND,\"p_scanuri\":null}")"
[ "$c" != 200 ] && grep -q "nu ești gestionar" /tmp/br_rpc.out || esec "4b Toma (fără drept) a putut salva / alt refuz: $(head -c 200 /tmp/br_rpc.out)"
c="$(rpc "$TJ" fn_izo_doc_salveaza "{\"p_doc_id\":null,\"p_versiune\":null,\"p_antet\":$ANTET,\"p_randuri\":[{\"nr_crt\":1,\"serie\":\"401AA00009\",\"lungime_doc_mm\":12100,\"cantitate\":2}],\"p_scanuri\":null}")"
[ "$c" != 200 ] && grep -q "un rând = o bucată" /tmp/br_rpc.out || esec "4b2 cantitate 2 nu e refuzată prin API: HTTP $c $(head -c 200 /tmp/br_rpc.out)"
echo "     cantitate 2 → HTTP $c (un rând = o bucată)"
c="$(rpc "$TJ" fn_izo_doc_salveaza "{\"p_doc_id\":null,\"p_versiune\":null,\"p_antet\":$ANTET,\"p_randuri\":$RAND,\"p_scanuri\":null}")"
[ "$c" = 200 ] || esec "4c Janeta salveaza → HTTP $c $(head -c 300 /tmp/br_rpc.out)"
DOC="$(camp document_id)"
printf '%%PDF-1.4\n%%proba E3\n' > /tmp/br_scan.pdf
CALE="$DOC/$(python3 -c 'import uuid; print(uuid.uuid4())').pdf"
c="$(st -X POST "$URL/storage/v1/object/izo-documente/$CALE" -H "apikey: $ANON" -H "Authorization: Bearer $TJ" -H 'Content-Type: application/pdf' --data-binary @/tmp/br_scan.pdf)"
[ "$c" = 200 ] || esec "4d încărcarea scanului → HTTP $c $(head -c 200 /tmp/br_st.out)"
SHA="$(sha256sum /tmp/br_scan.pdf | cut -d' ' -f1)"; MAR="$(stat -c %s /tmp/br_scan.pdf)"
c="$(rpc "$TJ" fn_izo_doc_salveaza "{\"p_doc_id\":$DOC,\"p_versiune\":1,\"p_antet\":$ANTET,\"p_randuri\":$RAND,\"p_scanuri\":[{\"cale\":\"$CALE\",\"sha256_original\":\"$SHA\",\"sha256_pdf\":\"$SHA\",\"marime\":$MAR,\"mime\":\"application/pdf\"}]}")"
[ "$c" = 200 ] || esec "4e manifestul → HTTP $c $(head -c 300 /tmp/br_rpc.out)"
c="$(st -X DELETE "$URL/storage/v1/object/izo-documente/$CALE" -H "apikey: $ANON" -H "Authorization: Bearer $TJ")"
[ "$(q "SELECT count(*) FROM storage.objects WHERE bucket_id = 'izo-documente' AND name = '$CALE'")" = 1 ] || esec "4f ștergerea unui obiect din manifest a trecut prin API-ul Storage"
echo "     DELETE obiect din manifest → HTTP $c (obiectul rămâne)"
c="$(st -X POST "$URL/storage/v1/object/izo-documente/$CALE" -H "apikey: $ANON" -H "Authorization: Bearer $TJ" -H 'x-upsert: true' -H 'Content-Type: application/pdf' --data-binary @/tmp/br_scan.pdf)"
[ "$c" != 200 ] || esec "4g upsert peste un scan a trecut"; echo "     upsert → HTTP $c"
c="$(rpc "$TJ" fn_izo_doc_verifica "{\"p_doc_id\":$DOC}")"; [ "$c" = 200 ] || esec "4h verifica → $c $(head -c 300 /tmp/br_rpc.out)"
HASH="$(camp hash)"; VER="$(camp versiune)"
c="$(rpc "$TJ" fn_izo_doc_confirma "{\"p_doc_id\":$DOC,\"p_versiune\":$VER,\"p_hash\":\"$HASH\"}")"
[ "$c" = 200 ] || esec "4i confirma → HTTP $c $(head -c 400 /tmp/br_rpc.out)"
c="$(rpc "$TJ" fn_izo_doc_confirma "{\"p_doc_id\":$DOC,\"p_versiune\":$VER,\"p_hash\":\"$HASH\"}")"
[ "$c" = 200 ] && [ "$(camp idempotent)" = True ] || esec "4j retry confirmare nu e idempotent"
c="$(rpc "$TJ" fn_izo_doc_pv "{\"p_doc_id\":$DOC,\"p_versiune\":$((VER + 1)),\"p_pv_nr\":\"PV 1\",\"p_pv_data\":\"2026-10-21\"}")"
[ "$c" = 200 ] || esec "4k PV → HTTP $c $(head -c 300 /tmp/br_rpc.out)"
c="$(st -X DELETE "$URL/storage/v1/object/izo-documente/$CALE" -H "apikey: $ANON" -H "Authorization: Bearer $TJ")"
[ "$(q "SELECT count(*) FROM storage.objects WHERE bucket_id = 'izo-documente' AND name = '$CALE'")" = 1 ] || esec "4l scanul unui document confirmat s-a șters"
[ "$(q "SELECT string_agg(stare, ',' ORDER BY serie) || ':' || (SELECT stare FROM public.izo_documente_intrare WHERE id = $DOC) FROM public.magazie_bucati WHERE aviz_intrare_id = $DOC")" = "receptionat,receptionat:confirmat" ] \
  || esec "4m starea finală"
[ "$(q "SELECT count(*) FROM public.magazie_bucati_evenimente WHERE document_id = '$DOC' AND aplicat_rol = 'authenticator'")" = 2 ] || esec "4n evenimentele nu au aplicat_rol = authenticator"
q "INSERT INTO public.executie_tevi (pachet_id, serie_unica, lungime_m) SELECT 2, 'PICK3', 12 WHERE NOT EXISTS (SELECT 1 FROM public.executie_tevi WHERE serie_unica = 'PICK3')" >/dev/null
c="$(curl -s -o /tmp/br_pk.out -w '%{http_code}' -X PATCH "$URL/rest/v1/executie_tevi?serie_unica=eq.PICK3&pachet_id=eq.2&select=id" -H "apikey: $ANON" -H "Authorization: Bearer $TJ" -H 'Content-Type: application/json' -H 'Prefer: return=representation' -d '{"lungime_m":12.5}')"
python3 -c "import json; d=json.load(open('/tmp/br_pk.out')); assert len(d)==1, d" || esec "4o #824: UPDATE ... select('id') cu rolul real nu întoarce exact un rând (HTTP $c)"
ok "4 API real pe PG17: anon / fără drept / cantitate 2 → refuz; salvare, manifest, verificare, confirmare (+ retry idempotent), PV; Storage: ștergere din manifest și după confirmare refuzate, upsert refuzat; aplicat_rol = authenticator; #824 = 1 rând"

# 5. stratul RESTRICTIV prin API-ul Storage REAL: o permisivă generală nouă (USING true) nu deschide izo-documente; alt bucket merge ca
#    înainte; poarta E3 rămâne verde (ștampila nu ia politicile altor module)
q "CREATE POLICY proba_permisiva_generala ON storage.objects FOR ALL TO public USING (true) WITH CHECK (true)" >/dev/null
q "INSERT INTO storage.buckets (id, name, public) VALUES ('proba-alt', 'proba-alt', false) ON CONFLICT (id) DO NOTHING" >/dev/null
[ "$(q "SELECT cardinality(public.fn_izo_porti_lipsa())")" = 0 ] || esec "5a o politică a altui modul înroșește poarta: $(q "SELECT public.fn_izo_porti_lipsa()")"
c="$(st "$URL/storage/v1/object/authenticated/izo-documente/$CALE" -H "apikey: $ANON" -H "Authorization: Bearer $TT")"
[ "$c" != 200 ] || esec "5b Toma (fără drept) descarcă scanul din izo-documente sub permisiva generală"; echo "     Toma descarcă scanul izo (permisivă generală) → HTTP $c"
c="$(st "$URL/storage/v1/object/authenticated/izo-documente/$CALE" -H "apikey: $ANON" -H "Authorization: Bearer $TJ")"
[ "$c" = 200 ] || esec "5c Janeta (gestionar) nu mai descarcă scanul: HTTP $c"
c="$(st -X POST "$URL/storage/v1/object/izo-documente/$DOC/$(python3 -c 'import uuid; print(uuid.uuid4())').pdf" -H "apikey: $ANON" -H "Authorization: Bearer $TT" -H 'Content-Type: application/pdf' --data-binary @/tmp/br_scan.pdf)"
[ "$c" != 200 ] || esec "5d Toma încarcă în izo-documente sub permisiva generală"; echo "     Toma încarcă în izo (permisivă generală) → HTTP $c"
c="$(st -X POST "$URL/storage/v1/object/izo-documente/proba-anon.pdf" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/pdf' --data-binary @/tmp/br_scan.pdf)"
[ "$c" != 200 ] || esec "5e anon încarcă în izo-documente sub permisiva generală"
c="$(st -X POST "$URL/storage/v1/object/proba-alt/r5f.pdf" -H "apikey: $ANON" -H "Authorization: Bearer $TT" -H 'Content-Type: application/pdf' --data-binary @/tmp/br_scan.pdf)"
[ "$c" = 200 ] || esec "5f alt bucket: încărcarea lui Toma sub permisivă → HTTP $c $(head -c 200 /tmp/br_st.out)"
c="$(st "$URL/storage/v1/object/authenticated/proba-alt/r5f.pdf" -H "apikey: $ANON" -H "Authorization: Bearer $TT")"
[ "$c" = 200 ] || esec "5g alt bucket: descărcarea → HTTP $c"
c="$(st -X DELETE "$URL/storage/v1/object/proba-alt/r5f.pdf" -H "apikey: $ANON" -H "Authorization: Bearer $TT")"
[ "$c" = 200 ] || esec "5h alt bucket: ștergerea → HTTP $c"
q "DROP POLICY proba_permisiva_generala ON storage.objects" >/dev/null
[ "$(q "SELECT cardinality(public.fn_izo_porti_lipsa())")" = 0 ] || esec "5i porți după scoaterea permisivei"
ok "5 strat RESTRICTIV prin Storage-ul real: sub o permisivă generală, Toma / anon nu citesc și nu încarcă în izo-documente, Janeta da; alt bucket: încărcare / citire / ștergere ca înainte; poarta verde"
echo "PASS proba E3 pe branch PG17 ($REF)"
