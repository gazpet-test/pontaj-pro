#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261031a_ofertare_cantitati_b (TKT-0329 B, PR2: schema de bază).
# PostgreSQL 16 local dedicat (/tmp/pg_cb, 127.0.0.1:5449). Nu atinge producția.
# Bază: scheletul loturi + migrarea 20261024b + ofertare_cantitati_b_schelet_extra.sql. Acoperă: garda de livrare · drepturi ·
# buget (owner) · cerere (owner / responsabil) · rezervare per apel (plafon comun, necunoscuta în consum, muncă unică, reluare doar
# umană) · decontare + depășire → buget blocat · proveniența textului pe document + sha (A confirmat ≠ B) · extragere (text valid,
# cache, muncă unică, „gata” doar cu toate feliile) · imuabilitate (și pentru postgres) · jurnal clarificări + înghețare D1
# (INSERT direct trimisa, text din jurnal, as-of termen, tardiv, idempotentă) · completări · audit (dovezi străine refuzate,
# automat de clasificare, decizie o singură dată) · termen (AI clar / neclar / om) · revenire (nearmată / armată / drift).
# Utilizare: bash scripts/test_ofertare_cantitati_b.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR=/tmp/pg_cb; PORT=5449; BAZA=ofertare_loturi_test
NUME=20261031a_ofertare_cantitati_b
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
LOTURI="$RADACINA/supabase/migrations/20261024b_ofertare_loturi_mvp.sql"
SCHELET="$RADACINA/supabase/tests/ofertare_loturi_mvp_schelet.sql"
EXTRA="$RADACINA/supabase/tests/ofertare_cantitati_b_schelet_extra.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_cb" ] || mediu "$DATE_DIR există și nu e fixture — nu îl șterg"
  [ -f "$DATE_DIR/postmaster.pid" ] && { ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; }
  rm -rf "$DATE_DIR"
fi
mkdir -p "$DATE_DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_cb"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_cb.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null || esec "schelet"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '20261024b_ofertare_loturi_mvp:' || txid_current(), true);" \
  -f "$LOTURI" >/dev/null || esec "migrarea de baza 20261024b"
"${PSQL[@]}" -d "$BAZA" -f "$EXTRA" >/dev/null || esec "schelet extra"

OWNER=00000000-0000-4000-8000-000000000121; RESP=00000000-0000-4000-8000-000000000043; EDIT=00000000-0000-4000-8000-000000000007
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
ca() {
  local claims
  if [ "$2" = - ]; then claims="{\"role\":\"$1\"}"; else claims="{\"sub\":\"$2\",\"role\":\"$1\"}"; fi
  "${PSQL[@]}" -d "$BAZA" -At -c "SET SESSION AUTHORIZATION authenticator;" -c "BEGIN;" -c "SET LOCAL ROLE $1;" \
    -c "SELECT set_config('request.jwt.claims', '$claims', true);" -c "$3" -c "COMMIT;" 2>&1 | grep -v '^BEGIN$\|^SET$\|^COMMIT$' | tail -"${CA_LINII:-1}"
}
asteapta() { [ "$2" = "$3" ] || esec "$1: așteptat «$3», primit «$2»"; ok "$1"; }
refuz() { local o; o="$(CA_LINII=50 ca "$2" "$3" "$4" || true)"; grep -q "$5" <<<"$o" || esec "$1 trebuia refuzat ($5), primit: $o"; ok "refuz: $1"; }
rq() { local o; o="$("${PSQL[@]}" -d "$BAZA" -Atc "$2" 2>&1 || true)"; grep -q "$3" <<<"$o" || esec "$1 trebuia refuzat ($3), primit: $o"; ok "refuz: $1"; }
livreaza() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1; }
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261031a', 'CANTITATI_B_REVENIRE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1; }
svc() { ca service_role - "$1"; }
j() { python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$1" "$2"; }

# ── livrare ──
o="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE" 2>&1 || true)"; grep -q 'garda start invalida' <<<"$o" || esec "fără gardă: $o"; ok "refuz: livrare fără gardă"
livreaza >/dev/null || esec "livrare: $(livreaza | tail -3)"
ok "livrare (18 tabele, 40 de funcții)"
o="$(livreaza || true)"; grep -q 'exista deja' <<<"$o" || esec "relivrare: $o"; ok "refuz: relivrare"

# ── drepturi ──
asteapta "anon nu citește observații" "$(q "SELECT has_table_privilege('anon','public.ofertare_cant_obs','SELECT')")" f
asteapta "authenticated nu citește direct textele" "$(q "SELECT has_table_privilege('authenticated','public.ofertare_doc_texte','SELECT')")" f
asteapta "service_role fără drept de tabel" "$(q "SELECT has_table_privilege('service_role','public.ofertare_cant_obs','INSERT') OR has_table_privilege('service_role','public.ofertare_ai_rezervari','UPDATE')")" f
asteapta "rezerva doar service_role" "$(q "SELECT has_function_privilege('service_role','public.fn_ofertare_cb_rezerva(bigint,text,integer,numeric)','EXECUTE')::text || has_function_privilege('authenticated','public.fn_ofertare_cb_rezerva(bigint,text,integer,numeric)','EXECUTE')::text")" truefalse
refuz "authenticated INSERT direct în observații" authenticated "$OWNER" "INSERT INTO public.ofertare_ai_buget VALUES (102,'cant_extragere',5)" 'permission denied'

# ── buget + cerere ──
refuz "responsabilul nu setează plafonul" authenticated "$RESP" "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',5)" 'Doar owner-ul'
ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',5)" >/dev/null
refuz "editorul nu aprobă cheltuiala" authenticated "$EDIT" "SELECT public.fn_ofertare_cb_cerere(102,'cant_extragere','toate','{}',24)" 'Doar owner-ul'
refuz "cerere fără plafon (audit)" authenticated "$RESP" "SELECT public.fn_ofertare_cb_cerere(102,'audit_raspunsuri','toate','{}',24)" 'Nu există plafon'
C1=$(j "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_cerere(102,'cant_extragere','toate','{}',24)")" 'd["cerere_id"]')
C2=$(j "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_cerere(102,'cant_extragere','toate','{}',24)")" 'd["cerere_id"]')
ok "două cereri pe aceeași licitație ($C1, $C2)"

# ── rezervări: plafon COMUN, necunoscuta în consum, muncă unică ──
R1=$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($C1,'munca-test-0001',1,2.0000)")" 'd["rezervare_id"]')
R2=$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($C2,'munca-test-0002',1,2.0000)")" 'd["rezervare_id"]')
asteapta "a treia rezervare de 2 USD pe altă cerere depășește plafonul comun de 5" "$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($C2,'munca-test-0003',1,2.0000)")" 'd.get("refuz")')" plafon
asteapta "aceeași muncă nu se rezervă a doua oară" "$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($C1,'munca-test-0001',1,0.5000)")" 'd.get("refuz")')" munca_deja_rezervata
svc "SELECT public.fn_ofertare_cb_rezervare_necunoscuta($R2)" >/dev/null
asteapta "rezervarea necunoscută rămâne în consum" "$(q "SELECT public.fn_ofertare_cb_consum(102,'cant_extragere')")" 4.0000
asteapta "munca necunoscută nu primește a doua rezervare" "$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($C2,'munca-test-0002',1,0.5000)")" 'd.get("refuz")')" munca_deja_rezervata
asteapta "reluare (incercare 2) fără felie creată de om" "$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($C2,'munca-test-0002',2,0.5000)")" 'd.get("refuz")')" reluare_neautorizata
rq "postgres nu modifică o rezervare decontată / suma" "UPDATE public.ofertare_ai_rezervari SET suma_rezervata = 0.0001 WHERE id = $R1" 'imuabile'
rq "tranziție nepermisă necunoscuta → decontata" "UPDATE public.ofertare_ai_rezervari SET stare='decontata', cost_real=0 WHERE id = $R2" 'tranziție'

# ── decontare peste rezervare → buget blocat ──
asteapta "decontare peste rezervare" "$(j "$(svc "SELECT public.fn_ofertare_cb_deconteaza($R1, 2.5, 1000, 100, 'gpt-5-mini')")" 'd["peste_rezervare"]')" True
asteapta "bugetul e blocat" "$(q "SELECT blocat FROM public.ofertare_ai_buget WHERE licitatie_id=102 AND scop='cant_extragere'")" t
asteapta "rezervare refuzată pe buget blocat" "$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($C1,'munca-test-0004',1,0.1000)")" 'd.get("refuz")')" buget_blocat
asteapta "a doua decontare a aceleiași rezervări" "$(j "$(svc "SELECT public.fn_ofertare_cb_deconteaza($R1, 0.1, 1, 1, 'x')")" 'd.get("refuz")')" deja_inchisa
asteapta "ai_usage_log are costul real" "$(q "SELECT cost_usd FROM public.ai_usage_log WHERE ref_id=102 ORDER BY id DESC LIMIT 1")" 2.5000
refuz "responsabilul nu deblochează" authenticated "$RESP" "SELECT public.fn_ofertare_cb_buget_deblocheaza(102,'cant_extragere')" 'Doar owner-ul'
ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',20)" >/dev/null
ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_buget_deblocheaza(102,'cant_extragere')" >/dev/null
ok "owner-ul ridică plafonul la 20 și deblochează"

# ── proveniența textului: pe document + sha (A confirmat nu validează B) ──
q "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original, tip, text_extras, created_at) VALUES
   (901, 102, 'F3 lista.pdf', 'lista_cantitati', 'Strada A 100 m', now() - interval '20 days'),
   (902, 102, 'copie F3.pdf', 'lista_cantitati', 'Strada A 100 m', now() - interval '20 days'),
   (903, 102, 'ATR.pdf', 'alta', 'ATR Strada A 90 m', now() - interval '20 days')" >/dev/null
q "INSERT INTO public.ofertare_licitatii(id, nr_anunt) VALUES (5, 'X5')" >/dev/null
for L in 102 3 5; do ca authenticated "$OWNER" "SELECT public.fn_ofertare_licitatie_loturi_seteaza($L, 'fara_loturi')" >/dev/null; done
asteapta "documentele noi sunt eligibile (licitație fără loturi)" "$(q "SELECT bool_and((public.fn_ofertare_document_eligibil(x)->>'eligibil')::boolean) FROM unnest(ARRAY[901,902,903]) x")" t
SHA=$(printf '%s' 'Strada A 100 m' | sha256sum | cut -d' ' -f1)
P901=$(j "$(svc "SELECT public.fn_ofertare_cb_text_scrie(901, 'Strada A 100 m', 'sinteza_ai', 'document-nou-citeste', 'integral', '{}')")" 'd["prov_id"]')
asteapta "sinteza_ai nu e text valid" "$(svc "SELECT public.fn_ofertare_cb_text_valid(102, 901, '$SHA')")" '{}'
ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_decizie(901, '$SHA', NULL, NULL, 'text_confirmat', 'verificat pe PDF')" >/dev/null
asteapta "A confirmat de om → valid" "$(j "$(svc "SELECT public.fn_ofertare_cb_text_valid(102, 901, '$SHA')")" '"decizie_id" in d')" True
asteapta "B cu același sha NU e validat de confirmarea lui A" "$(svc "SELECT public.fn_ofertare_cb_text_valid(102, 902, '$SHA')")" '{}'
refuz "text_confirmat cu rol / secțiune" authenticated "$RESP" "INSERT INTO public.ofertare_cant_doc_decizii(licitatie_id,document_id,doc_sha256,rol,sectiune,decizie,motiv,decis_de) VALUES (102,901,'$SHA','f3','*','text_confirmat','x','$RESP')" 'permission denied'

# ── extragere: text valid, cache, muncă unică, „gata” doar cu toate feliile ──
CE=$(j "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_cerere(102,'cant_extragere','toate','{}',24)")" 'd["cerere_id"]')
asteapta "extragere pe B (fără dovadă) refuzată" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($CE, 902, '$SHA', $P901, '902', 'gpt-5-mini@p1@n1@f1', 2)")" 'd.get("refuz")')" text_nevalid
P903=$(j "$(svc "SELECT public.fn_ofertare_cb_text_scrie(903, 'ATR Strada A 90 m', 'transcriere', 'ofertare-ingest-doc', 'integral', '{}')")" 'd["prov_id"]')
SHA3=$(printf '%s' 'ATR Strada A 90 m' | sha256sum | cut -d' ' -f1)
X=$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($CE, 903, '$SHA3', $P903, '903', 'gpt-5-mini@p1@n1@f1', 2)")" 'd["extragere_id"]')
asteapta "a doua extragere în lucru pe aceeași muncă" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($CE, 903, '$SHA3', $P903, '903', 'gpt-5-mini@p1@n1@f1', 2)")" 'd.get("refuz")')" extragere_in_lucru
F0=$(j "$(svc "SELECT public.fn_ofertare_cb_felie_incepe($X, 0, 0, 10, '$SHA3')")" 'd["felie_id"]')
asteapta "aceeași felie (muncă) a doua oară" "$(j "$(svc "SELECT public.fn_ofertare_cb_felie_incepe($X, 0, 0, 10, '$SHA3')")" 'd.get("refuz")')" munca_existenta
svc "SELECT public.fn_ofertare_cb_obs_scrie($F0, '[{\"lot_domeniu\":\"toate\",\"lot_nr\":[],\"rol_sursa\":\"atr\",\"rol_decis_de\":\"marcaj\",\"pagina\":1,\"denumire\":\"Conducta PE Dn90\",\"rand_interval\":\"[0,17)\",\"citat_interval\":\"[0,17)\",\"cantitate_offset\":13,\"pozitie_dovedita\":true,\"tip_lucrare\":\"conducta\",\"masura\":\"lungime\",\"obiect_cheie\":\"a\",\"material\":\"PE100\",\"dn_mm\":[90],\"um_norm\":\"m\",\"cantitate\":90,\"citat\":\"ATR Strada A 90 m\",\"hash_rand\":\"$(printf x | sha256sum | cut -d' ' -f1)\"}]')" >/dev/null
svc "SELECT public.fn_ofertare_cb_felie_inchide($F0, 'gata', NULL)" >/dev/null
asteapta "„gata” refuzat cu o felie lipsă" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_inchide($X, 'gata')")" 'd.get("refuz")')" felii_negata
F1=$(j "$(svc "SELECT public.fn_ofertare_cb_felie_incepe($X, 1, 8, 17, '$(printf y | sha256sum | cut -d' ' -f1)')")" 'd["felie_id"]')
svc "SELECT public.fn_ofertare_cb_felie_inchide($F1, 'necunoscut', NULL)" >/dev/null
refuz "reluarea felie de către editor" authenticated "$EDIT" "SELECT public.fn_ofertare_cb_felie_reia($F1, 'reîncerc')" 'Fără drept'
asteapta "reluarea de către responsabil = încercarea 2" "$(j "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_felie_reia($F1, 'transport căzut')")" 'd["incercare"]')" 2
F1B=$(q "SELECT id FROM public.ofertare_cant_felii WHERE extragere_id=$X AND felie_nr=1 AND incercare=2")
svc "SELECT public.fn_ofertare_cb_felie_inchide($F1B, 'gata', NULL)" >/dev/null
asteapta "extragere gata cu toate feliile; 1 observație relevantă" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_inchide($X, 'gata')")" 'd["obs_relevante"]')" 1
asteapta "cache: aceeași versiune nu mai pornește extragere" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($CE, 903, '$SHA3', $P903, '903', 'gpt-5-mini@p1@n1@f1', 2)")" 'd["cache"]')" True
rq "postgres nu modifică o observație" "UPDATE public.ofertare_cant_obs SET cantitate = 100" 'imuabile'
rq "postgres nu șterge o observație" "DELETE FROM public.ofertare_cant_obs" 'nu se șterg'

# ── termenul de clarificări ──
svc "SELECT public.fn_ofertare_cb_termen_propune(3, false, NULL, '{\"candidati\":[\"2026-01-10\",\"2026-01-12\"]}')" >/dev/null
asteapta "neclar → fără termen, la om" "$(q "SELECT coalesce(termen::text,'-') || '|' || neclar FROM public.ofertare_termen_clarificari WHERE licitatie_id=3")" "-|true"
ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_termen_seteaza(3, now() - interval '2 days', 'confirmat_om')" >/dev/null
svc "SELECT public.fn_ofertare_cb_termen_propune(3, true, now() + interval '9 days', '{}')" >/dev/null
asteapta "propunerea AI nu suprascrie decizia omului" "$(q "SELECT sursa FROM public.ofertare_termen_clarificari WHERE licitatie_id=3")" confirmat_om

# ── jurnal + înghețare D1 (lic. 102: termen în viitor) ──
q "SELECT public.fn_ofertare_cb_termen_propune(102, true, now() + interval '5 days', '{}')" >/dev/null
CL1=$(ca authenticated "$RESP" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, status, origine) VALUES (102, 'Text A: lungimea pe strada A?', 'trimisa', 'manual') RETURNING id")
asteapta "INSERT direct „trimisa” → eveniment în jurnal" "$(q "SELECT count(*) FROM public.ofertare_clarificari_jurnal WHERE clarificare_id=$CL1 AND eveniment='trimisa'")" 1
asteapta "… și înghețarea inițială (clarificare_trimisa)" "$(q "SELECT declansator || '|' || inghetat_tardiv FROM public.ofertare_analiza_versiuni WHERE licitatie_id=102 AND tip='initiala'")" "clarificare_trimisa|false"
asteapta "snapshot-ul conține clarificarea declanșatoare cu textul A" "$(q "SELECT clarificari->0->>'text' FROM public.ofertare_analiza_versiuni WHERE licitatie_id=102")" 'Text A: lungimea pe strada A?'
asteapta "documentele din manifest (901, 902, 903 + eligibile)" "$(q "SELECT count(*) FILTER (WHERE (e->>'document_id')::int IN (901,902,903)) FROM public.ofertare_analiza_versiuni v, jsonb_array_elements(v.doc_manifest) e WHERE v.licitatie_id=102")" 3
asteapta "manifestul reține dovada textului pe document (901 confirmat, 902 fără)" "$(q "SELECT string_agg((e->>'document_id') || ':' || (e->'text_dovada' ? 'decizie_id')::text, ',' ORDER BY (e->>'document_id')::int) FROM public.ofertare_analiza_versiuni v, jsonb_array_elements(v.doc_manifest) e WHERE v.licitatie_id=102 AND (e->>'document_id')::int IN (901,902)")" "901:true,902:false"
asteapta "completarea a materializat textele" "$(j "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_snapshot_efectiv((SELECT id FROM public.ofertare_analiza_versiuni WHERE licitatie_id=102))")" 'len(d["completari"]) > 0')" True
ca authenticated "$RESP" "UPDATE public.ofertare_clarificari SET intrebare = 'Text B editat' WHERE id = $CL1" >/dev/null
ca authenticated "$RESP" "UPDATE public.ofertare_clarificari SET status = 'raspunsa' WHERE id = $CL1" >/dev/null
asteapta "editarea + raspunsa nu schimbă versiunea trimisă din jurnal" "$(q "SELECT text FROM public.ofertare_clarificari_jurnal WHERE clarificare_id=$CL1 AND eveniment='trimisa'")" 'Text A: lungimea pe strada A?'
CL2=$(ca authenticated "$RESP" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, status) VALUES (102, 'a doua', 'trimisa') RETURNING id")
asteapta "a doua trimitere nu creează altă inițială (idempotent)" "$(q "SELECT count(*) FROM public.ofertare_analiza_versiuni WHERE licitatie_id=102 AND tip='initiala'")" 1
asteapta "manualul întoarce inițiala existentă" "$(j "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_ingheata_manual(102,'toate','{}')")" 'd["existent"]')" True
rq "snapshot-ul e imuabil (și pentru postgres)" "UPDATE public.ofertare_analiza_versiuni SET clarificari = '[]'" 'imuabile'

# ── as-of termen (lic. 3: termen confirmat acum 2 zile) ──
q "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original, tip, text_extras, created_at) VALUES
   (911, 3, 'CS vechi.pdf', 'cs_volum', 'vechi', now() - interval '10 days'), (912, 3, 'raspuns nou.pdf', 'raspuns_clarificare', 'nou', now())" >/dev/null
CL3=$(ca authenticated "$OWNER" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, status) VALUES (3, 'după termen', 'trimisa') RETURNING id")
asteapta "după termen: moment = termenul, tardiv" "$(q "SELECT inghetat_tardiv || '|' || (moment_referinta < inghetata_la - interval '1 day') FROM public.ofertare_analiza_versiuni WHERE licitatie_id=3")" "true|true"
asteapta "documentul apărut după termen NU e în manifest" "$(q "SELECT count(*) FROM public.ofertare_analiza_versiuni v, jsonb_array_elements(v.doc_manifest) e WHERE v.licitatie_id=3 AND (e->>'document_id')::int=912")" 0
asteapta "clarificarea trimisă după termen NU e conținut (doar metadată)" "$(q "SELECT jsonb_array_length(clarificari) || '|' || clarificare_declansatoare_id FROM public.ofertare_analiza_versiuni WHERE licitatie_id=3")" "0|$CL3"

# ── audit: dovezi străine refuzate, automatul de clasificare, decizia o singură dată ──
SNAP=$(q "SELECT id FROM public.ofertare_analiza_versiuni WHERE licitatie_id=102")
H=$(printf a | sha256sum | cut -d' ' -f1)
AUD="{\"versiune_analiza_id\":$SNAP,\"document_id\":903,\"doc_sha256\":\"$SHA3\",\"citire_id\":\"903:$SHA3:t1\",\"citire_sursa_tip\":\"text\",\"citire_sursa_sha\":\"$SHA3\",\"citire_completa\":true,\"executie_id\":\"$H\",\"pereche_id\":\"$H\",\"intrebare_text\":\"q\",\"raspuns_text\":\"r\",\"text_verificat\":true,\"asociere_dovedita\":true,\"efect\":\"confirmare\",\"regula\":\"reguli@1\""
o="$(CA_LINII=20 svc "SELECT public.fn_ofertare_cb_audit_scrie('$AUD,\"clasificare\":\"deja_observat\",\"cauza\":\"intrebat_de_noi\",\"dovezi_istoric\":{\"cmp_ids\":[999]}}')" || true)"
grep -q 'străină snapshot' <<<"$o" || esec "dovadă străină: $o"; ok "refuz: dovadă istorică străină snapshot-ului"
o="$(CA_LINII=20 svc "SELECT public.fn_ofertare_cb_audit_scrie('$AUD,\"clasificare\":\"deja_observat\",\"cauza\":\"intrebat_de_noi\",\"dovezi_istoric\":{\"clarificare_ids\":[$CL2]}}')" || true)"
grep -q 'străină snapshot' <<<"$o" || esec "clarificare din afara snapshot-ului: $o"; ok "refuz: clarificare care nu era în snapshot"
AUDX=${AUD/\"text_verificat\":true/\"text_verificat\":false}
o="$(CA_LINII=20 svc "SELECT public.fn_ofertare_cb_audit_scrie('$AUDX,\"clasificare\":\"omisiune\",\"cauza\":\"detectat_neintrebat\",\"dovezi_istoric\":{}}')" || true)"
grep -q 'violates check' <<<"$o" || esec "omisiune fără text verificat: $o"; ok "refuz: omisiune fără text verificat (automat)"
A1=$(j "$(svc "SELECT public.fn_ofertare_cb_audit_scrie('$AUD,\"clasificare\":\"deja_observat\",\"cauza\":\"intrebat_de_noi\",\"dovezi_istoric\":{\"clarificare_ids\":[$CL1]}}')")" 'd["audit_id"]')
ok "audit deja_observat cu clarificarea din snapshot ($A1)"
refuz "editorul nu decide" authenticated "$EDIT" "SELECT public.fn_ofertare_cb_audit_decide($A1,'confirmat')" 'fără drept'
ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_audit_decide($A1,'confirmat','ok')" >/dev/null
refuz "a doua decizie" authenticated "$RESP" "SELECT public.fn_ofertare_cb_audit_decide($A1,'respins')" 'deja înregistrată'
rq "clasificarea e imuabilă" "UPDATE public.ofertare_audit_raspunsuri SET clasificare='omisiune', cauza='detectat_neintrebat'" 'imuabile'

# ── erori: înghețarea nu blochează clarificarea ──
q "ALTER FUNCTION public.fn_ofertare_cb_ingheata(bigint,text,integer[],text,bigint,uuid) RENAME TO fn_ofertare_cb_ingheata_x" >/dev/null
CL5=$(ca authenticated "$OWNER" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, status) VALUES (5, 'q5', 'trimisa') RETURNING id")
asteapta "clarificarea s-a scris deși înghețarea a eșuat" "$(q "SELECT status FROM public.ofertare_clarificari WHERE id=$CL5")" trimisa
asteapta "eroarea e în ofertare_analiza_erori" "$(q "SELECT faza FROM public.ofertare_analiza_erori WHERE clarificare_id=$CL5")" ingheata
q "ALTER FUNCTION public.fn_ofertare_cb_ingheata_x(bigint,text,integer[],text,bigint,uuid) RENAME TO fn_ofertare_cb_ingheata" >/dev/null

# ── revenire ──
o="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" 2>&1 || true)"; grep -q 'garda start invalida' <<<"$o" || esec "revenire nearmată: $o"; ok "refuz: revenire nearmată"
q "COMMENT ON FUNCTION public.fn_ofertare_cb_consum(bigint,text) IS 'drift'" >/dev/null
q "ALTER FUNCTION public.fn_ofertare_cb_consum(bigint,text) SET work_mem = '4MB'" >/dev/null
o="$(revenire || true)"; grep -q 'amprenta difera' <<<"$o" || esec "drift: $o"; ok "refuz: revenire după drift (amprenta)"
q "ALTER FUNCTION public.fn_ofertare_cb_consum(bigint,text) RESET work_mem" >/dev/null
revenire >/dev/null || esec "revenire: $(revenire | tail -3)"
asteapta "după revenire: niciun obiect, triggerul scos, clarificările păstrate" "$(q "SELECT (to_regclass('public.ofertare_cant_obs') IS NULL)::text || (SELECT count(*) FROM pg_trigger WHERE tgname='trg_ofertare_cb_clarificari_jurnal') || (SELECT count(*) FROM public.ofertare_clarificari)")" "true04"
echo PASS
