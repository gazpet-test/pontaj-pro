#!/usr/bin/env bash
# Proba E3b (20261106a) pe un BRANCH Supabase de probă NOU (PG17, postgres NESUPERUSER, PostgREST / GoTrue reale) — NU prod.
# Adaptată din scripts/izometrie/e3_gen/proba_pg17/proba_e3.sh (rămâne neschimbată; scheletul și baseline-ul Storage de acolo se
# refolosesc). Diferența r5h (E3_CONFIRMA_DESIGN §17.2 / §18.4): poarta E3 amprentează CORPURILE funcțiilor de platformă de pe
# lista albă, iar un branch nou are alte versiuni (pg_net 0.20.4 față de 0.20.0 pe prod) → pasul 0b pune replicile EXACTE de prod
# (baseline_pre_e3.json, cheia „implicite”) ÎNAINTEA oricărei migrări.
# Rulează din WSL, pe o copie LF a worktree-ului (/tmp/izo_src_br_e3b). Parola: pgpass-ul Windows copiat temporar (600), niciodată
# afișat; linia branch-ului o adaugă / o scoate sesiunea care creează / șterge branch-ul. Cere un branch PROASPĂT (fără E3b).
# Utilizare (din Windows):
#   wsl -d Ubuntu-24.04 -- bash -lc "BR_REF=<ref> BR_ANON_FILE=/mnt/c/<cale>/anon.txt bash /mnt/c/Users/Gazpet-Ai/wt-e3b/scripts/izometrie/e3b_gen/proba_pg17/proba_e3b.sh"
# Pași: 0 schelet + baseline-ul Storage / profiles (ca E3) + 0b replicile de platformă (md5 tipărit) · 1 2a → 2c → E3 → E3b prin
# runner, poarta = {}, control 0e = 0 · 2 revenirea E3b → baseline exact, relivrare · 3 date + GoTrue (Janeta gestionar 3/11,
# Toma manager_aprobator 3, Razvan owner) · 4 API real E3b (PostgREST): propune / aproba (patru ochi) / verifica / camp / retrage,
# refuzurile (anon, gestionar la aprobare, propunătorul la propria propunere, identitatea prin camp, storno_import din API) +
# timeout-urile efective măsurate într-o cerere reală (§9.2 r5)
set -Eeuo pipefail
REF="${BR_REF:?BR_REF = ref-ul branch-ului}"; ANON="$(tr -d '\r\n' < "${BR_ANON_FILE:?BR_ANON_FILE = fișierul cu cheia anon a branch-ului}")"
[ "$REF" != dxczwkbciseqniprspcu ] || { echo "REFUZ: ăsta e ref-ul de PRODUCȚIE" >&2; exit 2; }
HOST=aws-1-eu-central-1.pooler.supabase.com; PORT=5432; U="postgres.$REF"; URL="https://$REF.supabase.co"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; RAD="$(cd "$DIR/../../../.." && pwd)"
SRC=/tmp/izo_src_br_e3b; rm -rf "$SRC" && mkdir -p "$SRC/supabase"
cp -r "$RAD/scripts" "$SRC/" && cp -r "$RAD/supabase/migrations" "$RAD/supabase/revenire" "$RAD/supabase/tests" "$SRC/supabase/"
find "$SRC" -type f \( -name '*.sh' -o -name '*.sql' -o -name '*.py' -o -name '*.tsv' \) -exec sed -i 's/\r$//' {} +
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
    --tinta-db postgres --tinta-sistem "$SIS" --tinta-host "$HOST" --tinta-port "$PORT" --user "$U" >/tmp/izo_br_e3b_runner.out 2>&1 \
    || { tail -15 /tmp/izo_br_e3b_runner.out >&2; esec "runner $(basename "$1")"; } }
aplicata() { [ "$(q "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name = '$1'")" = 1 ]; }
MIG_A=$SRC/supabase/migrations/20261102a_izometrie_e2a_registru.sql
MIG_C=$SRC/supabase/migrations/20261102c_izometrie_cai_vechi_stoc.sql
MIG_E3=$SRC/supabase/migrations/20261103b_izometrie_e3_documente.sql
MIG_E3B=$SRC/supabase/migrations/20261106a_izometrie_e3b_corectii.sql
REV_E3B=$SRC/supabase/revenire/20261106a_izometrie_e3b_corectii_ROLLBACK.sql
P3=$SRC/scripts/izometrie/e3_gen/proba_pg17          # scheletul și baseline-ul Storage ale probei E3 (refolosite neschimbate)
P3B=$SRC/scripts/izometrie/e3b_gen/proba_pg17
# baseline-ul porților + ștampilelor (identic cu scripts/test_izometrie_e3b.sh)
baseline() { q "SELECT jsonb_build_array(obj_description('public.magazie_bucati_evenimente'::regclass,'pg_class'),
  obj_description('public.fn_izo_porti_definitii()'::regprocedure,'pg_proc'),
  obj_description('public.fn_izo_porti_e3_definitii()'::regprocedure,'pg_proc'),
  public.fn_izo_porti_definitii(),public.fn_izo_porti_e3_definitii())"; }
control_0e() { local o; o="$("${PSQL[@]}" -At -f "$SRC/scripts/control_0e.sql")" || esec "$1 control 0e: psql"; [ -z "$o" ] || esec "$1 control 0e: $o"; }
! aplicata 20261106a_izometrie_e3b_corectii || esec "branch-ul are deja E3b (20261106a): proba cere un branch proaspăt"

# 0. scheletul (dacă lipsește) + baseline-ul de prod pre-E3 (politicile Storage exacte + stub-uri, trigger-ele profiles exacte) — ca E3
if [ "$(q "SELECT to_regclass('public.magazie_bucati') IS NULL")" = t ]; then
  "${PSQL[@]}" --single-transaction -f "$P3/branch_schelet.sql" >/tmp/br_e3b_schelet.out 2>&1 || { tail -5 /tmp/br_e3b_schelet.out; esec "schelet"; }
  "${PSQL[@]}" -c "REVOKE TRUNCATE, MAINTAIN ON public.magazie_bucati, public.executie_bonuri_consum, public.executie_bonuri_consum_linii FROM anon, authenticated" >/dev/null
  q "CREATE UNIQUE INDEX IF NOT EXISTS user_module_access_profile_id_module_key ON public.user_module_access (profile_id, module)" >/dev/null
fi
# helper-ele de test ale scheletului nu există pe prod (fals-pozitiv E2a pe corpurile exacte profiles) — se scot, ca la E3
q "DROP SCHEMA IF EXISTS teste CASCADE" >/dev/null 2>&1 || true
if [ "$(q "SELECT to_regclass('public.izo_documente_intrare') IS NULL")" = t ]; then
  python3 "$P3/baseline_branch.py" "$SRC/supabase/tests/izometrie_e3_schelet_baseline.sql" /tmp/br_e3b_baseline.sql
  "${PSQL[@]}" --single-transaction -f /tmp/br_e3b_baseline.sql >/tmp/br_e3b_baseline.out 2>&1 || { tail -8 /tmp/br_e3b_baseline.out; esec "0 baseline-ul de prod pe branch"; }
fi
echo "     versiuni platformă: $(q "SELECT coalesce(string_agg(extname || ' ' || extversion, ', ' ORDER BY extname), '-') FROM pg_extension WHERE extname IN ('pg_net','pg_graphql','supabase_vault','pgsodium')")"
echo "     search_path postgres: $(q "SELECT coalesce(array_to_string(rolconfig, ' '), '-') FROM pg_roles WHERE rolname = 'postgres'")"
ok "0 țintă: branch $REF, PG17, postgres nesuperuser, schelet + baseline-ul de prod ($(q "SELECT count(*) FROM pg_policies WHERE schemaname = 'storage'") politici Storage); schema teste scoasă"
# 0b. replicile EXACTE de prod ale funcțiilor de platformă de pe lista albă r5h, ÎNAINTEA oricărei migrări
python3 "$P3B/replici_branch.py" "$SRC/scripts/izometrie/e3_gen/gen_e3.py" "$SRC/scripts/izometrie/e3_gen/baseline_pre_e3.json" /tmp/br_e3b_replici
# shellcheck source=replici_pas0.sh
. "$P3B/replici_pas0.sh"
pas0_replici /tmp/br_e3b_replici

# 1. 2a → 2c → E3 → E3b prin runner, ca NESUPERUSER; poarta completă verde, control 0e = 0
aplicata 20261102a_izometrie_e2a_registru || livreaza "$MIG_A" 20261102120000
aplicata 20261102c_izometrie_cai_vechi_stoc || livreaza "$MIG_C" 20261102140000
aplicata 20261103b_izometrie_e3_documente || livreaza "$MIG_E3" 20261103120000
[ "$(q "SELECT cardinality(public.fn_izo_porti_lipsa())")" = 0 ] || esec "1 porți lipsă după E3: $(q "SELECT public.fn_izo_porti_lipsa()")"
INAINTE="$(baseline)"
livreaza "$MIG_E3B" 20261106120000
grep -E 'E3b timeout-uri de rol' /tmp/izo_br_e3b_runner.out | sed 's/^.*NOTICE: */     /' || true
[ "$(q "SELECT public.fn_izo_porti_lipsa()")" = '{}' ] || esec "1 porți lipsă după E3b: $(q "SELECT public.fn_izo_porti_lipsa()")"
control_0e 1
T_PORTI="$(q "SELECT round(extract(epoch FROM clock_timestamp() - t) * 1000) FROM (SELECT clock_timestamp() t) a, LATERAL (SELECT public.fn_izo_porti_lipsa()) b")"
ok "1 20261102a → 2c → E3 → E3b prin runner pe PG17 ca nesuperuser; fn_izo_porti_lipsa() = {} (${T_PORTI} ms); control 0e = 0 rânduri"

# 2. revenirea E3b (fără fapte E3b) → baseline exact (ștampile, COMMENT-uri, porți), roluri / tabele scoase; relivrare
"${PSQL[@]}" --single-transaction -c "SELECT set_config('gazpet.revenire_20261106a', 'IZO_E3B_SCOATE:' || txid_current(), true);" -f "$REV_E3B" >/tmp/br_e3b_rev.out 2>&1 \
  || { tail -5 /tmp/br_e3b_rev.out >&2; esec "2 revenirea E3b pe PG17"; }
[ "$(baseline)" = "$INAINTE" ] || esec "2 COMMENT-urile / ștampilele / porțile diferă de baseline-ul de dinainte de E3b"
[ "$(q "SELECT public.fn_izo_porti_lipsa()")" = '{}' ] || esec "2 porți după revenirea E3b: $(q "SELECT public.fn_izo_porti_lipsa()")"
[ "$(q "SELECT (SELECT count(*) FROM pg_roles WHERE rolname IN ('izo_cor_editor','izo_corectie_writer')) || ':' || (to_regclass('public.izo_corectii') IS NULL)::text || ':' ||
        (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\_izo\_cor\_%')")" = "0:true:0" ] || esec "2 obiecte E3b rămase"
q "DELETE FROM supabase_migrations.schema_migrations WHERE name = '20261106a_izometrie_e3b_corectii'" >/dev/null
livreaza "$MIG_E3B" 20261106120001
[ "$(q "SELECT public.fn_izo_porti_lipsa()")" = '{}' ] || esec "2 porți după relivrarea E3b"
control_0e 2
ok "2 revenirea E3b pe PG17 (nesuperuser): baseline exact, roluri / tabele / funcții scoase; relivrare OK, poarta {}, control 0e = 0"

# 3. date: LOT 2 la stoc; Janeta gestionar (3, 11); Toma manager_aprobator pe 3 (+ magazie editor); Razvan owner; utilizatori GoTrue
[ "$(q "SELECT coalesce((SELECT nivel_izo FROM public.izo_proiect_config WHERE proiect_id = 3), 'off')")" = stoc ] \
  || q "SELECT public.fn_izo_seteaza_nivel(3, 'stoc', 'proba E3b PG17')" >/dev/null
q "INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('00000000-0000-0000-0000-000000000117', 'magazie', 'editor')
   ON CONFLICT (profile_id, module) DO UPDATE SET access_level = 'editor'" >/dev/null
q "INSERT INTO public.izo_atribuiri (proiect_id, profile_id, rol, depozit_id, acordat_de, motiv) SELECT 3, '00000000-0000-0000-0000-000000000030', 'gestionar', 11, 'test', 'proba E3b'
   WHERE NOT EXISTS (SELECT 1 FROM public.izo_atribuiri WHERE proiect_id = 3 AND profile_id = '00000000-0000-0000-0000-000000000030' AND rol = 'gestionar' AND activ)" >/dev/null
q "INSERT INTO public.izo_atribuiri (proiect_id, profile_id, rol, depozit_id, acordat_de, motiv) SELECT 3, '00000000-0000-0000-0000-000000000117', 'manager_aprobator', NULL, 'test', 'proba E3b'
   WHERE NOT EXISTS (SELECT 1 FROM public.izo_atribuiri WHERE proiect_id = 3 AND profile_id = '00000000-0000-0000-0000-000000000117' AND rol = 'manager_aprobator' AND activ)" >/dev/null
PAROLA="$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 20)"
for x in "00000000-0000-0000-0000-000000000030 janeta" "00000000-0000-0000-0000-000000000117 toma" "00000000-0000-0000-0000-000000000121 razvan"; do set -- $x
  q "INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, email_change, email_change_token_new, recovery_token)
     VALUES ('00000000-0000-0000-0000-000000000000', '$1', 'authenticated', 'authenticated', '$2.e3b@test.local', crypt('$PAROLA', gen_salt('bf')), now(),
       '{\"provider\":\"email\",\"providers\":[\"email\"]}', '{}', now(), now(), '', '', '', '')
     ON CONFLICT (id) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password, email = EXCLUDED.email" >/dev/null
  q "INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     VALUES ('$1', '$1', jsonb_build_object('sub', '$1', 'email', '$2.e3b@test.local'), 'email', now(), now(), now())
     ON CONFLICT (provider_id, provider) DO UPDATE SET identity_data = EXCLUDED.identity_data" >/dev/null
done
jwt() { curl -s "$URL/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' \
          -d "{\"email\":\"$1.e3b@test.local\",\"password\":\"$PAROLA\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
TJ="$(jwt janeta)"; TT="$(jwt toma)"; TR="$(jwt razvan)"
[ -n "$TJ" ] && [ -n "$TT" ] && [ -n "$TR" ] || esec "3 GoTrue nu a dat JWT (login cu parola)"
q "NOTIFY pgrst, 'reload schema'" >/dev/null; sleep 4
ok "3 date: LOT 2 la stoc, Janeta gestionar (3, 11), Toma manager_aprobator (3), Razvan owner; utilizatori GoTrue reali (JWT prin login)"

# 4. API real (PostgREST: session_user = authenticator)
rpc() { curl -s -o /tmp/br_e3b_rpc.out -w '%{http_code}' -X POST "$URL/rest/v1/rpc/$2" -H "apikey: $ANON" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
camp() { python3 -c "import sys,json; v=json.load(open('/tmp/br_e3b_rpc.out')).get('$1',''); print(v if not isinstance(v,(dict,list)) else json.dumps(v))"; }
corp() { head -c "${1:-300}" /tmp/br_e3b_rpc.out; }
st() { curl -s -o /tmp/br_e3b_st.out -w '%{http_code}' "$@"; }
# 4.0 două bucăți recepționate, cu PV, prin fluxul E3 real (salvare → scan → manifest → verificare → confirmare → PV)
SUF="$(date +%s | tail -c 7)"; S1="401BB${SUF}1"; S2="401BB${SUF}2"
ANTET="{\"proiect_id\":3,\"depozit_id\":11,\"sablon\":\"aviz_teava\",\"furnizor\":\"Arcelor\",\"nr_document\":\"PG17B-$SUF\",\"data_document\":\"2026-10-22\",\"total_m\":24.2}"
RAND="[{\"nr_crt\":1,\"serie\":\"$S1\",\"lungime_doc_mm\":12100,\"perete_mm\":7.1,\"diametru_mm\":610},{\"nr_crt\":2,\"serie\":\"$S2\",\"lungime_doc_mm\":12100,\"perete_mm\":7.1,\"diametru_mm\":610}]"
c="$(rpc "$TJ" fn_izo_doc_salveaza "{\"p_doc_id\":null,\"p_versiune\":null,\"p_antet\":$ANTET,\"p_randuri\":$RAND,\"p_scanuri\":null}")"
[ "$c" = 200 ] || esec "4.0a salvarea documentului → HTTP $c $(corp)"
DOC="$(camp document_id)"
printf '%%PDF-1.4\n%%proba E3b\n' > /tmp/br_e3b_scan.pdf
CALE="$DOC/$(python3 -c 'import uuid; print(uuid.uuid4())').pdf"
c="$(st -X POST "$URL/storage/v1/object/izo-documente/$CALE" -H "apikey: $ANON" -H "Authorization: Bearer $TJ" -H 'Content-Type: application/pdf' --data-binary @/tmp/br_e3b_scan.pdf)"
[ "$c" = 200 ] || esec "4.0b încărcarea scanului → HTTP $c $(head -c 200 /tmp/br_e3b_st.out)"
SHA="$(sha256sum /tmp/br_e3b_scan.pdf | cut -d' ' -f1)"; MAR="$(stat -c %s /tmp/br_e3b_scan.pdf)"
c="$(rpc "$TJ" fn_izo_doc_salveaza "{\"p_doc_id\":$DOC,\"p_versiune\":1,\"p_antet\":$ANTET,\"p_randuri\":$RAND,\"p_scanuri\":[{\"cale\":\"$CALE\",\"sha256_original\":\"$SHA\",\"sha256_pdf\":\"$SHA\",\"marime\":$MAR,\"mime\":\"application/pdf\"}]}")"
[ "$c" = 200 ] || esec "4.0c manifestul → HTTP $c $(corp)"
c="$(rpc "$TJ" fn_izo_doc_verifica "{\"p_doc_id\":$DOC}")"; [ "$c" = 200 ] || esec "4.0d verifica → $c $(corp)"
HASH="$(camp hash)"; VER="$(camp versiune)"
c="$(rpc "$TJ" fn_izo_doc_confirma "{\"p_doc_id\":$DOC,\"p_versiune\":$VER,\"p_hash\":\"$HASH\"}")"; [ "$c" = 200 ] || esec "4.0e confirma → HTTP $c $(corp 400)"
c="$(rpc "$TJ" fn_izo_doc_pv "{\"p_doc_id\":$DOC,\"p_versiune\":$((VER + 1)),\"p_pv_nr\":\"PV $SUF\",\"p_pv_data\":\"2026-10-22\"}")"; [ "$c" = 200 ] || esec "4.0f PV → HTTP $c $(corp)"
B1="$(q "SELECT id FROM public.magazie_bucati WHERE aviz_intrare_id = $DOC AND serie = '$S1'")"; B2="$(q "SELECT id FROM public.magazie_bucati WHERE aviz_intrare_id = $DOC AND serie = '$S2'")"
[ -n "$B1" ] && [ -n "$B2" ] && [ "$(q "SELECT string_agg(stare, ',') FROM public.magazie_bucati WHERE id IN ($B1, $B2)")" = "receptionat,receptionat" ] || esec "4.0g bucățile recepționate"
echo "     document $DOC confirmat cu PV; bucăți $B1 ($S1), $B2 ($S2) recepționate în depozitul 11"
N_COR() { q "SELECT count(*) FROM public.izo_corectii"; }
PROP() { echo "{\"p_tip\":\"$1\",\"p_proiect\":3,\"p_bucata_id\":$2,\"p_detalii\":$3,\"p_motiv\":\"$4\"}"; }
# 4a anon refuzat
c="$(rpc "$ANON" fn_izo_cor_propune "$(PROP carantina_intrare "$B1" '{"ncr_ref":"NCR-PG17-0"}' 'proba anon')")"
[ "$c" != 200 ] && [ "$(N_COR)" = 0 ] || esec "4a anon a putut propune (HTTP $c)"; echo "     anon propune → HTTP $c"
# 4b Janeta (gestionar pe depozitul bucății) propune intrarea în carantină
c="$(rpc "$TJ" fn_izo_cor_propune "$(PROP carantina_intrare "$B1" '{"ncr_ref":"NCR-PG17-1"}' 'proba E3b carantina')")"
[ "$c" = 200 ] && [ "$(camp stare)" = propusa ] || esec "4b Janeta propune → HTTP $c $(corp)"
C1="$(camp corectie_id)"; V1="$(camp versiune)"
# 4c gestionarul nu aprobă (nu e responsabil)
c="$(rpc "$TJ" fn_izo_cor_aproba "{\"p_corectie_id\":$C1,\"p_versiune\":$V1}")"
[ "$c" != 200 ] && grep -q "patru ochi" /tmp/br_e3b_rpc.out || esec "4c Janeta (gestionar) a aprobat / alt refuz: HTTP $c $(corp 200)"
echo "     Janeta aprobă propria propunere → HTTP $c (patru ochi / nu e responsabil)"
# 4d verificarea (doar citire) de către responsabil
c="$(rpc "$TT" fn_izo_cor_verifica "{\"p_corectie_id\":$C1,\"p_tip\":null,\"p_proiect\":null,\"p_bucata_id\":null,\"p_detalii\":null}")"
[ "$c" = 200 ] && [ "$(camp ok)" = True ] || esec "4d verifica → HTTP $c $(corp 400)"
# 4e Toma (alt responsabil decât propunătorul) aprobă; retry idempotent
c="$(rpc "$TT" fn_izo_cor_aproba "{\"p_corectie_id\":$C1,\"p_versiune\":$V1}")"
[ "$c" = 200 ] || esec "4e Toma aprobă → HTTP $c $(corp 400)"
c="$(rpc "$TT" fn_izo_cor_aproba "{\"p_corectie_id\":$C1,\"p_versiune\":$V1}")"
[ "$c" = 200 ] && [ "$(camp idempotent)" = True ] || esec "4e2 retry aprobare nu e idempotent: HTTP $c $(corp)"
[ "$(q "SELECT b.stare || ':' || c.stare || ':' || c.propus_de || ':' || c.decis_de || ':' || c.propus_rol || ':' || c.decis_rol || ':' || e.tip || ':' || e.aplicat_rol
        FROM public.izo_corectii c JOIN public.magazie_bucati b ON b.id = c.bucata_id JOIN public.magazie_bucati_evenimente e ON e.id = c.eveniment_id WHERE c.id = $C1")" \
  = "carantina:aplicata:00000000-0000-0000-0000-000000000030:00000000-0000-0000-0000-000000000117:authenticator:authenticator:carantina_intrare:authenticator" ] \
  || esec "4e3 starea după aprobare: $(q "SELECT row_to_json(c) FROM public.izo_corectii c WHERE id = $C1")"
# 4f owner-ul propune pe B2 și nu-și poate aproba propria propunere (patru ochi și pentru owner); retrage
c="$(rpc "$TR" fn_izo_cor_propune "$(PROP carantina_intrare "$B2" '{"ncr_ref":"NCR-PG17-2"}' 'proba owner propune')")"
[ "$c" = 200 ] || esec "4f owner propune → HTTP $c $(corp)"
C2="$(camp corectie_id)"; V2="$(camp versiune)"
c="$(rpc "$TR" fn_izo_cor_aproba "{\"p_corectie_id\":$C2,\"p_versiune\":$V2}")"
[ "$c" != 200 ] && grep -q "patru ochi" /tmp/br_e3b_rpc.out || esec "4f2 propunătorul (owner) și-a aprobat propunerea: HTTP $c $(corp)"
echo "     owner aprobă propria propunere → HTTP $c (patru ochi)"
c="$(rpc "$TR" fn_izo_cor_retrage "{\"p_corectie_id\":$C2,\"p_versiune\":$V2,\"p_motiv\":\"proba retragere\"}")"
[ "$c" = 200 ] && [ "$(camp stare)" = retrasa ] || esec "4f3 retragerea → HTTP $c $(corp)"
[ "$(q "SELECT stare FROM public.magazie_bucati WHERE id = $B2")" = receptionat ] || esec "4f4 B2 atinsă de propunerea retrasă"
# 4g corecția directă de câmp (responsabil): perete_mm; identitatea prin camp refuzată; gestionarul refuzat
SV="$(q "SELECT server_ver FROM public.magazie_bucati WHERE id = $B2")"
c="$(rpc "$TJ" fn_izo_cor_camp "{\"p_bucata_id\":$B2,\"p_server_ver\":$SV,\"p_dupa\":{\"perete_mm\":7.3},\"p_motiv\":\"proba gestionar camp\"}")"
[ "$c" != 200 ] || esec "4g Janeta (gestionar) a corectat direct"; echo "     Janeta camp → HTTP $c"
c="$(rpc "$TT" fn_izo_cor_camp "{\"p_bucata_id\":$B2,\"p_server_ver\":$SV,\"p_dupa\":{\"serie\":\"${S2}X\"},\"p_motiv\":\"proba identitate\"}")"
[ "$c" != 200 ] && grep -q "propunere" /tmp/br_e3b_rpc.out || esec "4g2 seria prin camp direct: HTTP $c $(corp)"
echo "     Toma camp pe serie → HTTP $c (cere propunere + aprobare)"
c="$(rpc "$TT" fn_izo_cor_camp "{\"p_bucata_id\":$B2,\"p_server_ver\":$SV,\"p_dupa\":{\"perete_mm\":7.3},\"p_motiv\":\"proba camp PG17\"}")"
[ "$c" = 200 ] || esec "4g3 Toma camp → HTTP $c $(corp 400)"
[ "$(q "SELECT perete_mm::text || ':' || (server_ver > $SV)::text FROM public.magazie_bucati WHERE id = $B2")" = "7.3:true" ] || esec "4g4 bucata după camp"
c="$(rpc "$TT" fn_izo_cor_camp "{\"p_bucata_id\":$B2,\"p_server_ver\":$SV,\"p_dupa\":{\"perete_mm\":7.4},\"p_motiv\":\"proba server_ver vechi\"}")"
[ "$c" != 200 ] && grep -q "reincarca" /tmp/br_e3b_rpc.out || esec "4g5 server_ver vechi acceptat: HTTP $c $(corp)"
# 4h storno-ul parțial NU e în API (EXECUTE doar postgres), nici pentru owner
N0="$(N_COR)"
c="$(rpc "$TR" fn_izo_cor_storno_import "{\"p_proiect\":3,\"p_import_id\":\"x\",\"p_bucati\":[$B1],\"p_motiv\":\"proba API\",\"p_cerut_de\":\"00000000-0000-0000-0000-000000000121\"}")"
[ "$c" != 200 ] && [ "$(N_COR)" = "$N0" ] || esec "4h storno_import din API: HTTP $c $(corp)"; echo "     owner storno_import din API → HTTP $c ($(corp 120))"
# 4t timeout-urile EFECTIVE într-o cerere reală (§9.2 r5). current_setting() nu se poate citi din cerere fără un obiect nou în
# schema expusă (interzis) → se MĂSOARĂ: o tranzacție de test ține rândul profilului lui Janeta FOR UPDATE; propunerea ei așteaptă
# în fn_izo_cor_autorizare_lock (profiles FOR SHARE) până la primul timeout efectiv: 55P03 = lock_timeout, 57014 = statement_timeout
echo "     rolconfig authenticator: $(q "SELECT coalesce(array_to_string(rolconfig, ' '), '-') FROM pg_roles WHERE rolname = 'authenticator'")"
echo "     rolconfig authenticated: $(q "SELECT coalesce(array_to_string(rolconfig, ' '), '-') FROM pg_roles WHERE rolname = 'authenticated'")"
echo "     rolconfig anon: $(q "SELECT coalesce(array_to_string(rolconfig, ' '), '-') FROM pg_roles WHERE rolname = 'anon'")"
BLOC=25; N0="$(N_COR)"
"${PSQL[@]}" -c "/* izo_blocaj_e3b */ BEGIN; SELECT 1 FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000030' FOR UPDATE; SELECT pg_sleep($BLOC); ROLLBACK;" >/dev/null 2>&1 & PB=$!
for i in $(seq 1 50); do
  [ "$(q "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '/* izo_blocaj_e3b */%' AND state = 'active' AND pid <> pg_backend_pid()")" = 1 ] && break; sleep 0.2
done
sleep 1
R="$(curl -s -o /tmp/br_e3b_rpc.out -w '%{http_code} %{time_total}' -X POST "$URL/rest/v1/rpc/fn_izo_cor_propune" -H "apikey: $ANON" -H "Authorization: Bearer $TJ" \
      -H 'Content-Type: application/json' -d "$(PROP carantina_intrare "$B2" '{"ncr_ref":"NCR-PG17-T"}' 'proba timeout')")"
wait "$PB" 2>/dev/null || true
COD="$(python3 -c "import json; print(json.load(open('/tmp/br_e3b_rpc.out')).get('code',''))" 2>/dev/null || echo '?')"
echo "     propunere sub blocaj (rândul profilului ținut ${BLOC}s): HTTP ${R% *}, SQLSTATE $COD, durata ${R#* }s — $(corp 160)"
[ "${R% *}" != 200 ] || esec "4t propunerea a trecut după ${BLOC}s de așteptare: timeout-urile efective sunt ≥ ${BLOC}s (rolconfig spune altceva?)"
[ "$(N_COR)" = "$N0" ] || esec "4t efecte parțiale după timeout"
case "$COD" in 55P03) echo "     → primul timeout efectiv în cerere: lock_timeout ≈ ${R#* }s" ;; 57014) echo "     → primul timeout efectiv în cerere: statement_timeout ≈ ${R#* }s" ;;
               *) echo "     → refuz cu alt cod ($COD): de citit mesajul de mai sus" ;; esac
ok "4 API real E3b pe PG17: anon refuzat; Janeta propune, nu aprobă; Toma verifică + aprobă (patru ochi, retry idempotent, rol authenticator); owner nu-și aprobă propunerea, o retrage; camp perete (responsabil) OK, serie prin camp / gestionar / server_ver vechi refuzate; storno_import din API refuzat; timeout efectiv: $COD după ${R#* }s, fără efecte"
echo "PASS proba E3b pe branch PG17 ($REF)"
