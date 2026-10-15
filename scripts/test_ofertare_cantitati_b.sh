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
# r3: moment canonic (a doua trimitere → momentul primei) · fără așteptări în trigger (licitația FOR UPDATE) · eligibilitate marcată ·
# felie gata doar cu rezervare decontată · reluare prin redeschidere · text confirmat vechi materializat · simulare = exact snapshot-ul.
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
ok "livrare (20 de tabele, 48 de funcții)"
o="$(livreaza || true)"; grep -q 'exista deja' <<<"$o" || esec "relivrare: $o"; ok "refuz: relivrare"
# 20261031b (PR3): proveniența doar pentru textul CURENT al documentului
MIGRARE_B="$RADACINA/supabase/migrations/20261031b_ofertare_text_scrie_cas.sql"; ROLLBACK_B="$RADACINA/supabase/revenire/20261031b_ofertare_text_scrie_cas_ROLLBACK.sql"
livreaza_b() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '20261031b_ofertare_text_scrie_cas:' || txid_current(), true);" -f "$MIGRARE_B" 2>&1; }
revenire_b() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261031b', 'TEXT_SCRIE_CAS_REVENIRE:' || txid_current(), true);" -f "$ROLLBACK_B" 2>&1; }
o="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE_B" 2>&1 || true)"; grep -q 'garda start invalida' <<<"$o" || esec "31b fără gardă: $o"; ok "refuz: 20261031b fără gardă"
livreaza_b >/dev/null || esec "livrare 31b: $(livreaza_b | tail -3)"; ok "livrare 20261031b"
o="$(livreaza_b || true)"; grep -q 'deja aplicata' <<<"$o" || esec "relivrare 31b: $o"; ok "refuz: relivrare 20261031b"

# ── pregătire: loturi (102 / 3 / 5 / 6 fără loturi; 4 cu loturile 1 și 2), documente, texte ──
q "INSERT INTO public.ofertare_licitatii(id, nr_anunt) VALUES (5, 'X5'), (6, 'X6'), (7, 'X7'), (8, 'X8'), (9, 'X9'), (10, 'X10'), (11, 'X11'), (12, 'X12')" >/dev/null
for L in 102 3 5 6 7 8 9 10 11 12; do ca authenticated "$OWNER" "SELECT public.fn_ofertare_licitatie_loturi_seteaza($L, 'fara_loturi')" >/dev/null; done
# fixture: loturile setate „de mult” pe licitațiile fără termen trecut (marja de 10 s a înghețării tardive ar marca altfel eligibilitatea)
q "UPDATE public.ofertare_loturi_jurnal SET la = now() - interval '30 days' WHERE licitatie_id IN (5, 6, 7, 8, 9, 10, 11, 12)" >/dev/null
ca authenticated "$OWNER" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(4, 'are_loturi', '[{\"nr\":1,\"participam\":true},{\"nr\":2,\"participam\":true}]')" >/dev/null
q "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original, tip, text_extras, created_at) VALUES
   (901, 102, 'F3 lista.pdf', 'lista_cantitati', 'Strada A 100 m', now() - interval '20 days'),
   (902, 102, 'copie F3.pdf', 'lista_cantitati', 'Strada A 100 m', now() - interval '20 days'),
   (903, 102, 'ATR.pdf', 'alta', 'ATR Strada A 90 m', now() - interval '20 days'),
   (904, 102, 'CS.pdf', 'cs_volum', 'CS Strada A 90 m', now() - interval '20 days'),
   (905, 102, 'vechi.pdf', 'alta', 'text vechi fara text_scrie', now() - interval '20 days'),
   (921, 4, 'lot2.pdf', 'lista_cantitati', 'lot 2 text', now() - interval '20 days'),
   (922, 4, 'lot1.pdf', 'lista_cantitati', 'lot 1 text', now() - interval '20 days')" >/dev/null
ca authenticated "$OWNER" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[921]::bigint[], 'alocat', '{2}', 't')" >/dev/null
ca authenticated "$OWNER" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[922]::bigint[], 'alocat', '{1}', 't')" >/dev/null
asteapta "documentele noi sunt eligibile" "$(q "SELECT bool_and((public.fn_ofertare_document_eligibil(x)->>'eligibil')::boolean) FROM unnest(ARRAY[901,902,903,904,905,921,922]) x")" t
sha() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
SHA=$(sha 'Strada A 100 m'); SHA3=$(sha 'ATR Strada A 90 m'); SHA4=$(sha 'CS Strada A 90 m'); SHA21=$(sha 'lot 2 text'); SHA22=$(sha 'lot 1 text')

# ── drepturi ──
asteapta "anon nu citește observații" "$(q "SELECT has_table_privilege('anon','public.ofertare_cant_obs','SELECT')")" f
asteapta "authenticated nu citește direct textele" "$(q "SELECT has_table_privilege('authenticated','public.ofertare_doc_texte','SELECT')")" f
asteapta "service_role fără drept de tabel" "$(q "SELECT has_table_privilege('service_role','public.ofertare_cant_obs','INSERT') OR has_table_privilege('service_role','public.ofertare_ai_rezervari','UPDATE')")" f
asteapta "rezerva doar service_role" "$(q "SELECT has_function_privilege('service_role','public.fn_ofertare_cb_rezerva(bigint,numeric)','EXECUTE')::text || has_function_privilege('authenticated','public.fn_ofertare_cb_rezerva(bigint,numeric)','EXECUTE')::text")" truefalse
asteapta "consumul intern nu e executabil de nimeni" "$(q "SELECT has_function_privilege('authenticated','public.fn_ofertare_cb_consum(bigint,text)','EXECUTE') OR has_function_privilege('service_role','public.fn_ofertare_cb_consum(bigint,text)','EXECUTE')")" f
refuz "authenticated INSERT direct în buget" authenticated "$OWNER" "INSERT INTO public.ofertare_ai_buget VALUES (102,'cant_extragere',5)" 'permission denied'

# ── buget + cerere ──
refuz "responsabilul nu setează plafonul" authenticated "$RESP" "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',5)" 'Doar owner-ul'
ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',5)" >/dev/null
ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_buget_seteaza(4,'cant_extragere',5)" >/dev/null
asteapta "jurnalul plafonului" "$(q "SELECT count(*) FROM public.ofertare_ai_buget_jurnal WHERE licitatie_id=102 AND actiune='plafon'")" 1
refuz "editorul nu aprobă cheltuiala" authenticated "$EDIT" "SELECT public.fn_ofertare_cb_cerere(102,'cant_extragere','toate','{}',24)" 'Doar owner-ul'
refuz "cerere fără plafon (audit)" authenticated "$RESP" "SELECT public.fn_ofertare_cb_cerere(102,'audit_raspunsuri','toate','{}',24)" 'Nu există plafon'
C1=$(j "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_cerere(102,'cant_extragere','toate','{}',24)")" 'd["cerere_id"]')
C2=$(j "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_cerere(102,'cant_extragere','toate','{}',24)")" 'd["cerere_id"]')
asteapta "lotul cererii e canonizat ([2,1,2] → {1,2})" "$(j "$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_cerere(4,'cant_extragere','lista','{2,1,2}',24)")" 'd["cerere_id"]' >/dev/null; q "SELECT lot_nr FROM public.ofertare_ai_cereri WHERE licitatie_id=4 ORDER BY id DESC LIMIT 1")" '{1,2}'
asteapta "consumul vizibil doar cu acces Ofertare" "$(ca authenticated 00000000-0000-4000-8000-000000000999 "SELECT coalesce(public.fn_ofertare_cb_consum_vezi(102,'cant_extragere')::text,'ascuns')")" ascuns

# ── proveniența textului: pe document + sha; text vechi confirmat de om → extragere permisă ──
svc "SELECT public.fn_ofertare_cb_text_scrie(901, 'Strada A 100 m', 'sinteza_ai', 'document-nou-citeste', 'integral', '{}')" >/dev/null
asteapta "sinteza_ai nu e text valid" "$(svc "SELECT public.fn_ofertare_cb_text_valid(102, 901, '$SHA')")" '{}'
asteapta "extragere pe text sinteză (fără decizie) refuzată" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($C1, 901, '$SHA', '901', 'gpt-5-mini@p1@n1@f1', 1)")" 'd.get("refuz")')" text_nevalid
ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_decizie(901, '$SHA', 'f3', '*', 'text_confirmat', 'verificat pe PDF')" >/dev/null
asteapta "text_confirmat ignoră rolul / secțiunea primite (normalizat)" "$(q "SELECT coalesce(rol,'-') || coalesce(sectiune,'-') FROM public.ofertare_cant_doc_decizii WHERE document_id=901 AND decizie='text_confirmat'")" '--'
ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_decizie(901, '$SHA', 'atr', '1-2', 'text_confirmat', 'a doua oară')" >/dev/null
asteapta "o singură confirmare activă pe document + sha" "$(q "SELECT count(*) FROM public.ofertare_cant_doc_decizii d WHERE d.document_id=901 AND d.decizie='text_confirmat' AND NOT EXISTS (SELECT 1 FROM public.ofertare_cant_doc_decizii r WHERE r.revoca_id=d.id)")" 1
asteapta "A confirmat de om → valid (decizie)" "$(j "$(svc "SELECT public.fn_ofertare_cb_text_valid(102, 901, '$SHA')")" 'd["tip"]')" decizie
asteapta "B cu același sha NU e validat de confirmarea lui A" "$(svc "SELECT public.fn_ofertare_cb_text_valid(102, 902, '$SHA')")" '{}'
X1=$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($C1, 901, '$SHA', '901', 'gpt-5-mini@p1@n1@f1', 1)")" 'd["extragere_id"]')
asteapta "extragerea pe textul vechi confirmat păstrează decizia ca dovadă" "$(q "SELECT (prov_id IS NULL)::text || (dovada_decizie_id IS NOT NULL)::text FROM public.ofertare_cant_extrageri WHERE id=$X1")" truetrue
# text confirmat de om pe un document vechi, fără text_scrie: extragerea îl materializează (doar pe sha-ul textului curent)
SHA5=$(sha 'text vechi fara text_scrie'); SHAX=$(sha altceva)
ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_decizie(905, '$SHAX', 'alt', '*', 'text_confirmat', 'alt sha')" >/dev/null
asteapta "text confirmat pe alt sha decât textul curent → versiune veche" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($C1, 905, '$SHAX', '905', 'gpt-5-mini@p1@n1@f1', 1)")" 'd.get("refuz")')" versiune_veche
ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_decizie(905, '$SHA5', 'alt', '*', 'text_confirmat', 'verificat pe PDF')" >/dev/null
X905=$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($C1, 905, '$SHA5', '905', 'gpt-5-mini@p1@n1@f1', 1)")" 'd["extragere_id"]')
asteapta "text confirmat vechi (fără text_scrie) → extragere pornită, text materializat" "$(q "SELECT count(*) FROM public.ofertare_doc_texte WHERE sha256='$SHA5'")" 1
# felie_incepe concurentă cu închiderea extragerii: așteaptă lock-ul și vede starea terminală → refuz (nu felie în zbor pe extragere închisă)
"${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "SELECT public.fn_ofertare_cb_extragere_inchide($X905, 'esuat');" -c "SELECT pg_sleep(2);" -c "COMMIT;" >/dev/null 2>&1 &
sleep 0.7
asteapta "felie_incepe concurentă cu închiderea → refuzată după lock" "$(j "$(svc "SELECT public.fn_ofertare_cb_felie_incepe($X905, 0, 0, 5, '$(sha f905)')")" 'd.get("refuz")')|$(q "SELECT count(*) FROM public.ofertare_cant_felii WHERE extragere_id=$X905")" "extragere|0"
wait
# text_extras actualizat concurent: extragerea așteaptă rândul documentului și vede versiunea nouă → versiune_veche
"${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "UPDATE public.ofertare_documente_atribuire SET text_extras = 'text nou 905' WHERE id = 905;" -c "SELECT pg_sleep(2);" -c "COMMIT;" >/dev/null 2>&1 &
sleep 0.7
asteapta "text_extras schimbat concurent → extragerea pe sha-ul vechi refuzată" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($C1, 905, '$SHA5', '905', 'gpt-5-mini@p9@n1@f1', 1)")" 'd.get("refuz")')" versiune_veche
wait
q "UPDATE public.ofertare_documente_atribuire SET text_extras = 'text vechi fara text_scrie' WHERE id = 905" >/dev/null
q "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original, tip, text_extras, created_at) VALUES (907, 102, 'scanat.pdf', 'alta', 'scan A', now() - interval '20 days')" >/dev/null
svc "SELECT public.fn_ofertare_cb_text_scrie(907, 'scan A', 'transcriere', 'ocr-local', 'integral', '{}')" >/dev/null
X907=$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($C1, 907, '$(sha 'scan A')', '907', 'gpt-5-mini@p1@n1@f1', 1)")" 'd["extragere_id"]')
svc "SELECT public.fn_ofertare_cb_extragere_inchide($X907, 'esuat')" >/dev/null
C4=$(j "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_cerere(102,'cant_extragere','toate','{}',24)")" 'd["cerere_id"]')
"${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "UPDATE public.ofertare_documente_atribuire SET text_extras = 'scan B' WHERE id = 907;" -c "SELECT public.fn_ofertare_cb_text_scrie(907, 'scan B', 'transcriere', 'ocr-local', 'integral', '{}');" -c "SELECT pg_sleep(2);" -c "COMMIT;" >/dev/null 2>&1 &
sleep 0.7
refuz "producător concurent (text + proveniență în aceeași tranzacție) → redeschiderea pe versiunea veche refuzată" authenticated "$RESP" "SELECT public.fn_ofertare_cb_extragere_redeschide($X907, $C4, 'reiau scanul')" 'nu mai e cea curentă'
wait
"${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "UPDATE public.ofertare_documente_atribuire SET text_extras = 'scan C' WHERE id = 907;" -c "SELECT public.fn_ofertare_cb_text_scrie(907, 'scan C', 'transcriere', 'ocr-local', 'integral', '{}');" -c "SELECT pg_sleep(2);" -c "COMMIT;" >/dev/null 2>&1 &
sleep 0.7
asteapta "producător concurent (text + proveniență) → extragerea pe versiunea B refuzată" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($C1, 907, '$(sha 'scan B')', '907', 'gpt-5-mini@p1@n1@f1', 1)")" 'd.get("refuz")')" versiune_veche
wait
ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_decizie(901, '$SHA', 'f3', '*', 'rol_confirmat', 'este F3')" >/dev/null
ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_decizie(901, '$SHA', 'f3', '*', 'nu_e_sursa_cantitativa', 'răzgândit')" >/dev/null
asteapta "clasa „rol”: o singură decizie activă (rol_confirmat revocat)" "$(q "SELECT string_agg(decizie, ',') FROM public.ofertare_cant_doc_decizii d WHERE d.document_id=901 AND d.decizie IN ('rol_confirmat','nu_e_sursa_cantitativa') AND NOT EXISTS (SELECT 1 FROM public.ofertare_cant_doc_decizii r WHERE r.revoca_id=d.id)")" nu_e_sursa_cantitativa

# ── extragere + felii + rezervări: plafon COMUN, necunoscuta în consum, rezervarea legată de felie ──
svc "SELECT public.fn_ofertare_cb_text_scrie(903, 'ATR Strada A 90 m', 'transcriere', 'ofertare-ingest-doc', 'integral', '{}')" >/dev/null
svc "SELECT public.fn_ofertare_cb_text_scrie(904, 'CS Strada A 90 m', 'transcriere', 'ofertare-ingest-doc', 'integral', '{}')" >/dev/null
X=$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($C1, 903, '$SHA3', '903', 'gpt-5-mini@p1@n1@f1', 2)")" 'd["extragere_id"]')
asteapta "a doua extragere în lucru pe aceeași muncă" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($C1, 903, '$SHA3', '903', 'gpt-5-mini@p1@n1@f1', 2)")" 'd.get("refuz")')" extragere_in_lucru
F0=$(j "$(svc "SELECT public.fn_ofertare_cb_felie_incepe($X, 0, 0, 10, '$SHA3')")" 'd["felie_id"]')
asteapta "aceeași felie (muncă) a doua oară" "$(j "$(svc "SELECT public.fn_ofertare_cb_felie_incepe($X, 0, 0, 10, '$SHA3')")" 'd.get("refuz")')" munca_existenta
R1=$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($F0, 2.0000)")" 'd["rezervare_id"]')
asteapta "a doua rezervare pe aceeași felie" "$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($F0, 0.5000)")" 'd.get("refuz")')" felie
X4=$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($C2, 904, '$SHA4', '904', 'gpt-5-mini@p1@n1@f1', 2)")" 'd["extragere_id"]')
G0=$(j "$(svc "SELECT public.fn_ofertare_cb_felie_incepe($X4, 0, 0, 8, '$SHA4')")" 'd["felie_id"]')
G1=$(j "$(svc "SELECT public.fn_ofertare_cb_felie_incepe($X4, 1, 8, 16, '$(sha g1)')")" 'd["felie_id"]')
R2=$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($G0, 2.0000)")" 'd["rezervare_id"]')
asteapta "a treia rezervare de 2 USD (altă cerere) depășește plafonul COMUN de 5" "$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($G1, 2.0000)")" 'd.get("refuz")')" plafon
asteapta "felie „necunoscut” fără rezervare (apelul n-a plecat) refuzată" "$(j "$(svc "SELECT public.fn_ofertare_cb_felie_inchide($G1, 'necunoscut')")" 'd.get("refuz")')" fara_rezervare
asteapta "felie „gata” cu rezervarea încă deschisă refuzată" "$(j "$(svc "SELECT public.fn_ofertare_cb_felie_inchide($G0, 'gata')")" 'd.get("refuz")')" rezervare_nedecontata
svc "SELECT public.fn_ofertare_cb_felie_inchide($G0, 'necunoscut')" >/dev/null
asteapta "felia „necunoscut” trece rezervarea deschisă în „necunoscuta”" "$(q "SELECT stare FROM public.ofertare_ai_rezervari WHERE id=$R2")" necunoscuta
asteapta "rezervarea necunoscută rămâne în consum" "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_consum_vezi(102,'cant_extragere')")" 4.0000
rq "postgres nu modifică suma unei rezervări" "UPDATE public.ofertare_ai_rezervari SET suma_rezervata = 0.0001 WHERE id = $R1" 'imuabile'
rq "tranziție nepermisă necunoscuta → decontata" "UPDATE public.ofertare_ai_rezervari SET stare='decontata', cost_real=0 WHERE id = $R2" 'tranziție'
refuz "reluarea feliei de către editor" authenticated "$EDIT" "SELECT public.fn_ofertare_cb_felie_reia($G0, 'reîncerc')" 'Fără drept'
asteapta "reluarea de către responsabil = încercarea 2" "$(j "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_felie_reia($G0, 'transport căzut')")" 'd["incercare"]')" 2

# ── decontare peste rezervare → buget blocat ──
asteapta "decontare peste rezervare" "$(j "$(svc "SELECT public.fn_ofertare_cb_deconteaza($R1, 2.5, 1000, 100, 'gpt-5-mini')")" 'd["peste_rezervare"]')" True
asteapta "bugetul e blocat" "$(q "SELECT blocat FROM public.ofertare_ai_buget WHERE licitatie_id=102 AND scop='cant_extragere'")" t
asteapta "rezervare refuzată pe buget blocat" "$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($G1, 0.1000)")" 'd.get("refuz")')" buget_blocat
asteapta "a doua decontare a aceleiași rezervări" "$(j "$(svc "SELECT public.fn_ofertare_cb_deconteaza($R1, 0.1, 1, 1, 'x')")" 'd.get("refuz")')" deja_inchisa
refuz "responsabilul nu deblochează" authenticated "$RESP" "SELECT public.fn_ofertare_cb_buget_deblocheaza(102,'cant_extragere')" 'Doar owner-ul'
ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',20)" >/dev/null
ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_buget_deblocheaza(102,'cant_extragere')" >/dev/null
asteapta "jurnalul plafonului: plafon + plafon + deblocare" "$(q "SELECT string_agg(actiune, ',' ORDER BY id) FROM public.ofertare_ai_buget_jurnal WHERE licitatie_id=102")" plafon,plafon,deblocare

# ── concurență: setarea plafonului așteaptă rezervarea în curs (același lock) ──
G2=$(j "$(svc "SELECT public.fn_ofertare_cb_felie_incepe($X4, 1, 16, 24, '$(sha g2)')")" 'd.get("felie_id")')
[ "$G2" = None ] && G2=$(q "SELECT id FROM public.ofertare_cant_felii WHERE extragere_id=$X4 AND felie_nr=1 AND rezervare_id IS NULL AND stare='in_zbor' ORDER BY id LIMIT 1")
"${PSQL[@]}" -d "$BAZA" -At -c "SET SESSION AUTHORIZATION authenticator;" -c "BEGIN;" -c "SET LOCAL ROLE service_role;" \
  -c "SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);" -c "SELECT public.fn_ofertare_cb_rezerva($G2, 2.0000);" \
  -c "SELECT pg_sleep(3);" -c "COMMIT;" >/tmp/cb_conc.out 2>&1 &
sleep 1
o="$(CA_LINII=20 ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',6)" || true)"
wait
grep -q 'sub consumul' <<<"$o" || esec "plafonul concurent: $o / $(cat /tmp/cb_conc.out)"; ok "refuz: plafon 6 sub consumul apărut concurent (6.5 = 2.5 + 2 + 2; fără lock ar fi trecut pe 4.5)"

# ── cererea anulată nu mai autorizează; lotul cererii limitează documentele ──
ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_cerere_anuleaza($C2)" >/dev/null
G3=$(j "$(svc "SELECT public.fn_ofertare_cb_felie_incepe($X4, 1, 24, 32, '$(sha g3)')")" 'd.get("felie_id")')
asteapta "rezervare refuzată după anularea cererii" "$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($G3, 0.1000)")" 'd.get("refuz")')" cerere

# ── calea de reluare: extragere partial → rezervarea refuzată → redeschidere de om, cu cerere activă → rezervare + decontare + gata ──
asteapta "închiderea partial refuzată cu felii în zbor" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_inchide($X4, 'partial')")" 'd.get("refuz")')" felii_in_zbor
for FZ in $(q "SELECT id || ':' || (rezervare_id IS NOT NULL) FROM public.ofertare_cant_felii WHERE extragere_id=$X4 AND stare='in_zbor'"); do
  if [ "${FZ#*:}" = true ]; then svc "SELECT public.fn_ofertare_cb_felie_inchide(${FZ%%:*}, 'necunoscut')" >/dev/null; else svc "SELECT public.fn_ofertare_cb_felie_inchide(${FZ%%:*}, 'esuat')" >/dev/null; fi
done
svc "SELECT public.fn_ofertare_cb_extragere_inchide($X4, 'partial')" >/dev/null
refuz "reluarea unei felii pe extragere închisă" authenticated "$RESP" "SELECT public.fn_ofertare_cb_felie_reia($G3, 'reiau')" 'nu e în lucru' 
asteapta "o nouă extragere pe aceeași muncă partial → de redeschis" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($C1, 904, '$SHA4', '904', 'gpt-5-mini@p1@n1@f1', 2)")" 'd.get("refuz")')" de_redeschis
refuz "editorul nu redeschide" authenticated "$EDIT" "SELECT public.fn_ofertare_cb_extragere_redeschide($X4, $C1, 'reiau')" 'fără drept'
refuz "redeschidere cu aceeași cerere" authenticated "$RESP" "SELECT public.fn_ofertare_cb_extragere_redeschide($X4, $C2, 'reiau')" 'cerere NOUĂ'
C3=$(j "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_cerere(102,'cant_extragere','toate','{}',24)")" 'd["cerere_id"]')
ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_cerere_anuleaza($C3)" >/dev/null
refuz "redeschidere cu o cerere anulată" authenticated "$RESP" "SELECT public.fn_ofertare_cb_extragere_redeschide($X4, $C3, 'reiau')" 'Cerere invalidă'
ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_extragere_redeschide($X4, $C1, 'reiau feliile căzute')" >/dev/null
asteapta "redeschisă: în lucru, pe cererea nouă, cu istoricul reluării" "$(q "SELECT stare || '|' || (cerere_id=$C1) || '|' || jsonb_array_length(reluari) FROM public.ofertare_cant_extrageri WHERE id=$X4")" "in_lucru|true|1"
G3B=$(j "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_felie_reia($G3, 'transport căzut')")" 'd["felie_id"]')
R3=$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($G3B, 0.1000)")" 'd["rezervare_id"]')
svc "SELECT public.fn_ofertare_cb_deconteaza($R3, 0.05, 10, 10, 'gpt-5-mini')" >/dev/null
asteapta "după decontare felia se închide „gata”" "$(j "$(svc "SELECT public.fn_ofertare_cb_felie_inchide($G3B, 'gata')")" 'd.get("ok")')" True
svc "SELECT public.fn_ofertare_cb_extragere_inchide($X4, 'partial')" >/dev/null
refuz "redeschidere cu o cerere dintr-un ciclu anterior" authenticated "$RESP" "SELECT public.fn_ofertare_cb_extragere_redeschide($X4, $C2, 'reiau iar')" 'cerere NOUĂ'
svc "SELECT public.fn_ofertare_cb_text_scrie(921, 'lot 2 text', 'transcriere', 'ofertare-ingest-doc', 'integral', '{}')" >/dev/null
CL1L=$(j "$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_cerere(4,'cant_extragere','lista','{1}',24)")" 'd["cerere_id"]')
asteapta "documentul din lotul 2 refuzat pe o cerere pentru lotul 1" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($CL1L, 921, '$SHA21', '921', 'gpt-5-mini@p1@n1@f1', 1)")" 'd.get("refuz")')" lot

# ── extragere: „gata” doar cu toate feliile; cache; imuabilitate ──
svc "SELECT public.fn_ofertare_cb_obs_scrie($F0, '[{\"lot_domeniu\":\"toate\",\"lot_nr\":[],\"rol_sursa\":\"atr\",\"rol_decis_de\":\"marcaj\",\"pagina\":1,\"denumire\":\"Conducta PE Dn90\",\"rand_interval\":\"[0,17)\",\"citat_interval\":\"[0,17)\",\"cantitate_offset\":13,\"pozitie_dovedita\":true,\"tip_lucrare\":\"conducta\",\"masura\":\"lungime\",\"obiect_cheie\":\"a\",\"material\":\"PE100\",\"dn_mm\":[90],\"um_norm\":\"m\",\"cantitate\":90,\"citat\":\"ATR Strada A 90 m\",\"hash_rand\":\"$(sha x)\"}]')" >/dev/null
asteapta "felia cu rezervarea decontată se închide „gata”" "$(j "$(svc "SELECT public.fn_ofertare_cb_felie_inchide($F0, 'gata')")" 'd.get("ok")')" True
asteapta "„gata” refuzat cu o felie lipsă" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_inchide($X, 'gata')")" 'd.get("refuz")')" felii_negata
F1=$(j "$(svc "SELECT public.fn_ofertare_cb_felie_incepe($X, 1, 8, 17, '$(sha y)')")" 'd["felie_id"]')
asteapta "felie „gata” fără rezervare refuzată" "$(j "$(svc "SELECT public.fn_ofertare_cb_felie_inchide($F1, 'gata')")" 'd.get("refuz")')" rezervare_nedecontata
R4=$(j "$(svc "SELECT public.fn_ofertare_cb_rezerva($F1, 0.1000)")" 'd["rezervare_id"]')
svc "SELECT public.fn_ofertare_cb_deconteaza($R4, 0.02, 10, 10, 'gpt-5-mini')" >/dev/null
svc "SELECT public.fn_ofertare_cb_felie_inchide($F1, 'gata')" >/dev/null
asteapta "extragere gata cu toate feliile; 1 observație relevantă" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_inchide($X, 'gata')")" 'd["obs_relevante"]')" 1
asteapta "cache: aceeași versiune nu mai pornește extragere" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($C1, 903, '$SHA3', '903', 'gpt-5-mini@p1@n1@f1', 2)")" 'd["cache"]')" True
q "UPDATE public.ofertare_documente_atribuire SET text_extras = 'sinteza noua' WHERE id = 901" >/dev/null
asteapta "sha vechi materializat + text curent schimbat → extragere refuzată (versiune veche)" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe($C1, 901, '$SHA', '901', 'gpt-5-mini@p2@n1@f1', 1)")" 'd.get("refuz")')" versiune_veche
q "UPDATE public.ofertare_documente_atribuire SET text_extras = 'Strada A 100 m' WHERE id = 901" >/dev/null
rq "postgres nu modifică o observație" "UPDATE public.ofertare_cant_obs SET cantitate = 100" 'imuabile'
rq "postgres nu șterge o observație" "DELETE FROM public.ofertare_cant_obs" 'nu se șterg'

# ── calcul: validarea apartenenței ──
o="$(CA_LINII=20 svc "SELECT public.fn_ofertare_cb_calcul_scrie('{\"licitatie_id\":102,\"lot_domeniu\":\"toate\",\"lot_nr\":[],\"tip\":\"curent\",\"algoritm_versiune\":\"c1\",\"praguri\":{},\"extractor_id\":\"x\",\"doc_manifest\":[{\"document_id\":921}],\"obs_manifest\":[],\"alias_manifest\":[],\"decizii_manifest\":[],\"acoperire\":{},\"stare\":\"incomplet\",\"amprenta\":\"$(sha c)\"}', '[]')" || true)"
grep -q 'Document străin' <<<"$o" || esec "calcul cu document străin: $o"; ok "refuz: calcul cu document al altei licitații"
OB=$(q "SELECT id FROM public.ofertare_cant_obs LIMIT 1")
o="$(CA_LINII=20 svc "SELECT public.fn_ofertare_cb_calcul_scrie('{\"licitatie_id\":102,\"lot_domeniu\":\"toate\",\"lot_nr\":[],\"tip\":\"curent\",\"algoritm_versiune\":\"c1\",\"praguri\":{},\"extractor_id\":\"x\",\"doc_manifest\":[],\"obs_manifest\":[],\"alias_manifest\":[],\"decizii_manifest\":[],\"acoperire\":{},\"stare\":\"incomplet\",\"amprenta\":\"$(sha c)\"}', '[{\"cheie\":\"k1\",\"rol_a\":\"f3\",\"rol_b\":\"atr\",\"obs_a\":[$OB],\"verdict\":\"lipsa_b\"}]')" || true)"
grep -q 'afara manifestului\|afara manifestului\|afara\|afară manifestului' <<<"$o" || esec "comparație din afara manifestului: $o"; ok "refuz: comparație cu observație din afara manifestului"

# ── termenul de clarificări ──
svc "SELECT public.fn_ofertare_cb_termen_propune(3, false, NULL, '{\"candidati\":[\"2026-01-10\",\"2026-01-12\"]}')" >/dev/null
asteapta "neclar → fără termen, la om" "$(q "SELECT coalesce(termen::text,'-') || '|' || neclar FROM public.ofertare_termen_clarificari WHERE licitatie_id=3")" "-|true"
ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_termen_seteaza(3, now() - interval '2 days', 'confirmat_om')" >/dev/null
svc "SELECT public.fn_ofertare_cb_termen_propune(3, true, now() + interval '9 days', '{}')" >/dev/null
asteapta "propunerea AI nu suprascrie decizia omului" "$(q "SELECT sursa FROM public.ofertare_termen_clarificari WHERE licitatie_id=3")" confirmat_om

# ── jurnal + înghețare D1 (lic. 102: termen în viitor) ──
svc "SELECT public.fn_ofertare_cb_termen_propune(102, true, now() + interval '5 days', '{}')" >/dev/null
CL1=$(ca authenticated "$RESP" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, status, origine) VALUES (102, 'Text A: lungimea pe strada A?', 'trimisa', 'manual') RETURNING id")
asteapta "INSERT direct „trimisa” → eveniment în jurnal" "$(q "SELECT count(*) FROM public.ofertare_clarificari_jurnal WHERE clarificare_id=$CL1 AND eveniment='trimisa'")" 1
asteapta "… și înghețarea inițială (clarificare_trimisa)" "$(q "SELECT declansator || '|' || inghetat_tardiv FROM public.ofertare_analiza_versiuni WHERE licitatie_id=102 AND tip='initiala'")" "clarificare_trimisa|false"
asteapta "snapshot-ul conține clarificarea declanșatoare cu textul A" "$(q "SELECT clarificari->0->>'text' FROM public.ofertare_analiza_versiuni WHERE licitatie_id=102")" 'Text A: lungimea pe strada A?'
asteapta "manifestul: 901 cu dovadă (decizie), 902 fără, 903 cu proveniență" "$(q "SELECT string_agg((e->>'document_id') || ':' || coalesce(e->'text_dovada'->>'tip','-'), ',' ORDER BY (e->>'document_id')::int) FROM public.ofertare_analiza_versiuni v, jsonb_array_elements(v.doc_manifest) e WHERE v.licitatie_id=102 AND (e->>'document_id')::int IN (901,902,903)")" "901:decizie,902:-,903:prov"
SNAP=$(q "SELECT id FROM public.ofertare_analiza_versiuni WHERE licitatie_id=102")
asteapta "completarea NU e în tranzacția clarificării" "$(q "SELECT count(*) FROM public.ofertare_analiza_completari WHERE snapshot_id=$SNAP")" 0
svc "SELECT public.fn_ofertare_cb_restante()" >/dev/null
asteapta "restanțele adaugă completarea; vederea efectivă pe document + sha" "$(j "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_snapshot_efectiv($SNAP)")" 'len(d["completari"]) > 0 and d["calcul_id"] is None')" True
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
asteapta "după termen: moment = termenul, tardiv, declanșator = termenul" "$(q "SELECT inghetat_tardiv || '|' || (moment_referinta < inghetata_la - interval '1 day') || '|' || declansator FROM public.ofertare_analiza_versiuni WHERE licitatie_id=3")" "true|true|termen_clarificari"
asteapta "documentul apărut după termen NU e în manifest" "$(q "SELECT count(*) FROM public.ofertare_analiza_versiuni v, jsonb_array_elements(v.doc_manifest) e WHERE v.licitatie_id=3 AND (e->>'document_id')::int=912")" 0
asteapta "tardiv fără proveniență ≤ termen → text_indisponibil (nu textul curent)" "$(q "SELECT e->>'text_indisponibil' FROM public.ofertare_analiza_versiuni v, jsonb_array_elements(v.doc_manifest) e WHERE v.licitatie_id=3 AND (e->>'document_id')::int=911")" true
asteapta "clarificarea trimisă după termen NU e conținut" "$(q "SELECT jsonb_array_length(clarificari) || '|' || coalesce(clarificare_declansatoare_id::text, '-') FROM public.ofertare_analiza_versiuni WHERE licitatie_id=3")" "0|-"
asteapta "loturile setate după moment → eligibilitate marcată (fără istoric as-of)" "$(q "SELECT eligibilitate FROM public.ofertare_analiza_versiuni WHERE licitatie_id=3")" modificata_dupa_moment

# ── jurnalizare eșuată → FĂRĂ înghețare; clarificarea rămâne ──
q "ALTER TABLE public.ofertare_clarificari_jurnal ADD CONSTRAINT x_test_pica CHECK (licitatie_id <> 5) NOT VALID" >/dev/null
CL5=$(ca authenticated "$OWNER" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, status) VALUES (5, 'q5', 'trimisa') RETURNING id")
asteapta "clarificarea s-a scris deși jurnalul a eșuat" "$(q "SELECT status FROM public.ofertare_clarificari WHERE id=$CL5")" trimisa
asteapta "fără inițială când jurnalul a eșuat; eroarea „jurnal” notată" "$(q "SELECT (SELECT count(*) FROM public.ofertare_analiza_versiuni WHERE licitatie_id=5) || '|' || (SELECT faza FROM public.ofertare_analiza_erori WHERE clarificare_id=$CL5)")" "0|jurnal"
q "ALTER TABLE public.ofertare_clarificari_jurnal DROP CONSTRAINT x_test_pica" >/dev/null
ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_ingheata_manual(5,'toate','{}')" >/dev/null
asteapta "înghețarea după un jurnal eșuat e marcată incertă (jurnal_esuat)" "$(q "SELECT public.fn_ofertare_cb_snapshot_incert(id) FROM public.ofertare_analiza_versiuni WHERE licitatie_id=5")" '["jurnal_esuat"]'

# ── lock ocupat → înghețare amânată; restanțele o fac as-of momentul trimiterii ──
K=$(q "SELECT hashtext('ofertare_cb_ingheata:6:toate:{}')")
"${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "SELECT pg_advisory_xact_lock($K);" -c "SELECT pg_sleep(3);" -c "COMMIT;" >/dev/null 2>&1 &
sleep 1
CL6=$(ca authenticated "$OWNER" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, status) VALUES (6, 'q6', 'trimisa') RETURNING id")
asteapta "lock ocupat: clarificarea scrisă, înghețarea amânată (fără așteptare)" "$(q "SELECT (SELECT count(*) FROM public.ofertare_analiza_versiuni WHERE licitatie_id=6) || '|' || (SELECT eroare FROM public.ofertare_analiza_erori WHERE clarificare_id=$CL6)")" "0|amânat (lock ocupat)"
wait
# a DOUA trimitere (lock liber) îngheață pe momentul PRIMEI (canonic), nu pe al ei
CL6B=$(ca authenticated "$OWNER" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, status) VALUES (6, 'q6b', 'trimisa') RETURNING id")
asteapta "a doua trimitere: inițiala pe momentul primei, declanșată de prima, doar ea în conținut" "$(q "SELECT (v.moment_referinta = (SELECT la FROM public.ofertare_clarificari_jurnal WHERE clarificare_id=$CL6))::text || '|' || (v.clarificare_declansatoare_id=$CL6) || '|' || v.inghetat_tardiv || '|' || jsonb_array_length(v.clarificari) || '|' || v.eligibilitate FROM public.ofertare_analiza_versiuni v WHERE v.licitatie_id=6")" "true|true|true|1|exacta"
asteapta "restanțele nu mai fac nimic pe licitația înghețată" "$(j "$(svc "SELECT public.fn_ofertare_cb_restante()")" 'd["inghetate"]')" 0

# ── fără așteptări în trigger: rândul licitației ținut FOR UPDATE (ca de cerere / termen) nu blochează înghețarea ──
CL7=$(ca authenticated "$OWNER" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, status) VALUES (7, 'q7', 'de_trimis') RETURNING id")
"${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "SELECT 1 FROM public.ofertare_licitatii WHERE id=7 FOR UPDATE;" -c "SELECT pg_sleep(4);" -c "COMMIT;" >/dev/null 2>&1 &
sleep 1
T0=$(date +%s%N)
ca authenticated "$OWNER" "UPDATE public.ofertare_clarificari SET status='trimisa' WHERE id=$CL7" >/dev/null
T1=$(date +%s%N)
wait
asteapta "licitația blocată FOR UPDATE: trimiterea nu așteaptă (< 2 s), înghețarea amânată" "$(( (T1 - T0) / 1000000 < 2000 ))|$(q "SELECT count(*) FROM public.ofertare_analiza_versiuni WHERE licitatie_id=7")|$(q "SELECT eroare FROM public.ofertare_analiza_erori WHERE clarificare_id=$CL7")" "1|0|amânat (lock ocupat)"
q "INSERT INTO public.ofertare_loturi_jurnal (licitatie_id, actiune, vechi, nou) VALUES (7, 'licitatie_loturi', '{}', '{}')" >/dev/null
svc "SELECT public.fn_ofertare_cb_restante()" >/dev/null
asteapta "lock ocupat la trimitere → fără observație; înghețarea tardivă cu eligibilitate incertă" "$(q "SELECT (SELECT count(*) FROM public.ofertare_loturi_observatii WHERE licitatie_id=7) || '|' || eligibilitate FROM public.ofertare_analiza_versiuni WHERE licitatie_id=7")" "0|modificata_dupa_moment"
asteapta "restanțele îngheață lic. 7 pe momentul trimiterii" "$(q "SELECT (v.moment_referinta = (SELECT la FROM public.ofertare_clarificari_jurnal WHERE clarificare_id=$CL7))::text FROM public.ofertare_analiza_versiuni v WHERE v.licitatie_id=7")" true

# ── commit-uri în ordine inversă: A (trimitere T1, înghețare amânată) comite DUPĂ ce B a înghețat pe T2 → snapshot incert ──
"${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "SELECT 1 FROM public.ofertare_licitatii WHERE id=8 FOR SHARE;" -c "SELECT pg_sleep(2);" -c "COMMIT;" >/dev/null 2>&1 &
sleep 0.5
"${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, status) VALUES (8, 'A', 'trimisa');" -c "SELECT pg_sleep(4);" -c "COMMIT;" >/dev/null 2>&1 &
sleep 3
ca authenticated "$OWNER" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, status) VALUES (8, 'B', 'trimisa')" >/dev/null
wait
asteapta "ordine inversă: snapshot-ul pe T2 e marcat incert (eveniment_tarziu)" "$(q "SELECT public.fn_ofertare_cb_snapshot_incert(id) FROM public.ofertare_analiza_versiuni WHERE licitatie_id=8")" '["eveniment_tarziu"]'

# ── audit: dovezi străine, invariant per cauză, inlocuieste_id, decizia o singură dată ──
H=$(sha a)
AUD="{\"versiune_analiza_id\":$SNAP,\"document_id\":903,\"doc_sha256\":\"$SHA3\",\"citire_id\":\"903:$SHA3:t1\",\"citire_sursa_tip\":\"text\",\"citire_sursa_sha\":\"$SHA3\",\"citire_completa\":true,\"executie_id\":\"$H\",\"pereche_id\":\"$H\",\"intrebare_text\":\"q\",\"raspuns_text\":\"r\",\"text_verificat\":true,\"asociere_dovedita\":true,\"efect\":\"confirmare\",\"regula\":\"reguli@1\""
o="$(CA_LINII=20 svc "SELECT public.fn_ofertare_cb_audit_scrie('$AUD,\"clasificare\":\"deja_observat\",\"cauza\":\"intrebat_de_noi\",\"dovezi_istoric\":{\"cmp_ids\":[999]}}')" || true)"
grep -q 'străină snapshot' <<<"$o" || esec "dovadă străină: $o"; ok "refuz: dovadă istorică străină snapshot-ului"
o="$(CA_LINII=20 svc "SELECT public.fn_ofertare_cb_audit_scrie('$AUD,\"clasificare\":\"deja_observat\",\"cauza\":\"intrebat_de_noi\",\"dovezi_istoric\":{\"clarificare_ids\":[$CL2]}}')" || true)"
grep -q 'străină snapshot' <<<"$o" || esec "clarificare din afara snapshot-ului: $o"; ok "refuz: clarificare care nu era în snapshot"
o="$(CA_LINII=20 svc "SELECT public.fn_ofertare_cb_audit_scrie('$AUD,\"clasificare\":\"modificare_ulterioara\",\"cauza\":\"document_nou\",\"dovezi_istoric\":{\"document_ids\":[905]}}')" || true)"
grep -q 'nu e permisă înainte de PR6' <<<"$o" || esec "document_nou: $o"; ok "refuz: cauza document_nou (până la PR6)"
o="$(CA_LINII=20 svc "SELECT public.fn_ofertare_cb_audit_scrie('$AUD,\"clasificare\":\"nedeterminabil\",\"dovezi_istoric\":{\"obs_ids\":[$OB]}}')" || true)"
grep -q 'afara calculului' <<<"$o" || esec "obs fără calcul: $o"; ok "refuz: observație istorică fără calculul snapshot-ului"
SNAP3=$(q "SELECT id FROM public.ofertare_analiza_versiuni WHERE licitatie_id=3")
o="$(CA_LINII=20 svc "SELECT public.fn_ofertare_cb_audit_scrie('{\"versiune_analiza_id\":$SNAP3,\"document_id\":911,\"doc_sha256\":\"$H\",\"citire_id\":\"911:$H:t1\",\"citire_sursa_tip\":\"text\",\"citire_sursa_sha\":\"$H\",\"citire_completa\":true,\"executie_id\":\"$H\",\"pereche_id\":\"$H\",\"intrebare_text\":\"q\",\"raspuns_text\":\"r\",\"text_verificat\":true,\"asociere_dovedita\":true,\"efect\":\"confirmare\",\"regula\":\"reguli@1\",\"clasificare\":\"omisiune\",\"cauza\":\"detectat_neintrebat\",\"dovezi_istoric\":{}}')" || true)"
grep -q 'Snapshot incert' <<<"$o" || esec "eligibilitate: $o"; ok "refuz: clasificare automată pe snapshot incert (eligibilitate modificată după moment)"
# simularea: același lot + exact manifestul snapshot-ului
o="$("${PSQL[@]}" -d "$BAZA" -Atc "SELECT public.fn_ofertare_cb_calcul_scrie(jsonb_build_object('licitatie_id',102,'lot_domeniu','toate','lot_nr','[]'::jsonb,'tip','simulare','pe_snapshot_id',$SNAP,'algoritm_versiune','c1','praguri','{}'::jsonb,'extractor_id','x','doc_manifest',(SELECT doc_manifest FROM public.ofertare_analiza_versiuni WHERE id=$SNAP) || jsonb_build_array(jsonb_build_object('document_id',904,'sha256','$H')),'obs_manifest','[]'::jsonb,'alias_manifest','[]'::jsonb,'decizii_manifest','[]'::jsonb,'acoperire','{}'::jsonb,'stare','gata','amprenta','$H'), '[]')" 2>&1 || true)"
grep -q 'exact manifestul' <<<"$o" || esec "simulare cu document în plus: $o"; ok "refuz: simulare cu alt manifest decât snapshot-ul"
o="$("${PSQL[@]}" -d "$BAZA" -Atc "SELECT public.fn_ofertare_cb_calcul_scrie(jsonb_build_object('licitatie_id',102,'lot_domeniu','toate','lot_nr','[]'::jsonb,'tip','simulare','pe_snapshot_id',$SNAP,'algoritm_versiune','c1','praguri','{}'::jsonb,'extractor_id','x','doc_manifest',(SELECT jsonb_agg(e) FROM public.ofertare_analiza_versiuni v, jsonb_array_elements(v.doc_manifest) e WHERE v.id=$SNAP AND NOT (e->>'text_indisponibil')::boolean),'obs_manifest','[]'::jsonb,'alias_manifest','[]'::jsonb,'decizii_manifest','[]'::jsonb,'acoperire','{}'::jsonb,'stare','gata','amprenta','$H'), '[]')" 2>&1 || true)"
grep -q 'exact manifestul' <<<"$o" || esec "simulare fără documentele indisponibile: $o"; ok "refuz: simulare care omite documentele text_indisponibil ale snapshot-ului"
SIM=$(q "SELECT public.fn_ofertare_cb_calcul_scrie(jsonb_build_object('licitatie_id',102,'lot_domeniu','toate','lot_nr','[]'::jsonb,'tip','simulare','pe_snapshot_id',$SNAP,'algoritm_versiune','c1','praguri','{}'::jsonb,'extractor_id','x','doc_manifest',(SELECT doc_manifest FROM public.ofertare_analiza_versiuni WHERE id=$SNAP),'obs_manifest',jsonb_build_array(jsonb_build_object('id',$OB)),'alias_manifest','[]'::jsonb,'decizii_manifest','[]'::jsonb,'acoperire','{}'::jsonb,'stare','gata','amprenta','$H'), jsonb_build_array(jsonb_build_object('cheie','k1-dn90','rol_a','f3','rol_b','atr','obs_b',jsonb_build_array($OB),'verdict','diferenta')))->>'calcul_id'")
CMPS=$(q "SELECT id FROM public.ofertare_cant_cmp WHERE calcul_id=$SIM")
HS=$(sha s)
o="$(CA_LINII=20 svc "SELECT public.fn_ofertare_cb_audit_scrie('${AUD/\"pereche_id\":\"$H\"/\"pereche_id\":\"$HS\"},\"clasificare\":\"omisiune\",\"cauza\":\"analiza_incompleta\",\"dovezi_istoric\":{},\"dovezi_simulare\":{\"calcul_id\":$SIM,\"cmp_ids\":[$CMPS]}}')" || true)"
grep -q 'Simulare incompletă' <<<"$o" || esec "simulare pe snapshot cu text indisponibil: $o"; ok "refuz: analiza_incompleta pe un snapshot cu text_indisponibil (simulare exactă, dar incompletă)"
q "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original, tip, text_extras, created_at) VALUES (931, 9, 'F3 9.pdf', 'lista_cantitati', 'lic9 text', now() - interval '20 days')" >/dev/null
SHA9=$(sha 'lic9 text')
svc "SELECT public.fn_ofertare_cb_text_scrie(931, 'lic9 text', 'transcriere', 'ofertare-ingest-doc', 'integral', '{}')" >/dev/null
S9=$(j "$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_ingheata_manual(9,'toate','{}')")" 'd["snapshot_id"]')
SIM9=$(q "SELECT public.fn_ofertare_cb_calcul_scrie(jsonb_build_object('licitatie_id',9,'lot_domeniu','toate','lot_nr','[]'::jsonb,'tip','simulare','pe_snapshot_id',$S9,'algoritm_versiune','c1','praguri','{}'::jsonb,'extractor_id','x','doc_manifest',(SELECT doc_manifest FROM public.ofertare_analiza_versiuni WHERE id=$S9),'obs_manifest','[]'::jsonb,'alias_manifest','[]'::jsonb,'decizii_manifest','[]'::jsonb,'acoperire','{}'::jsonb,'stare','gata','amprenta','$H'), jsonb_build_array(jsonb_build_object('cheie','k9-dn110','rol_a','f3','rol_b','atr','verdict','diferenta')))->>'calcul_id'")
CMP9=$(q "SELECT id FROM public.ofertare_cant_cmp WHERE calcul_id=$SIM9")
A2=$(j "$(svc "SELECT public.fn_ofertare_cb_audit_scrie('{\"versiune_analiza_id\":$S9,\"document_id\":931,\"doc_sha256\":\"$SHA9\",\"citire_id\":\"931:$SHA9:t1\",\"citire_sursa_tip\":\"text\",\"citire_sursa_sha\":\"$SHA9\",\"citire_completa\":true,\"executie_id\":\"$H\",\"pereche_id\":\"$H\",\"intrebare_text\":\"q\",\"raspuns_text\":\"r\",\"text_verificat\":true,\"asociere_dovedita\":true,\"efect\":\"cantitati\",\"regula\":\"reguli@1\",\"clasificare\":\"omisiune\",\"cauza\":\"analiza_incompleta\",\"dovezi_istoric\":{},\"dovezi_simulare\":{\"calcul_id\":$SIM9,\"cmp_ids\":[$CMP9]}}')")" 'd["audit_id"]')
ok "audit analiza_incompleta pe snapshot complet, cu simulare gata și exactă ($A2)"
o="$(CA_LINII=20 svc "SELECT public.fn_ofertare_cb_audit_scrie('$AUD,\"clasificare\":\"omisiune\",\"cauza\":\"detectat_neintrebat\",\"dovezi_istoric\":{}}')" || true)"
grep -q 'fără dovada minimă' <<<"$o" || esec "omisiune fără comparație: $o"; ok "refuz: detectat_neintrebat fără comparație diferenta / conflict_sursa"
AUDX=${AUD/\"text_verificat\":true/\"text_verificat\":false}
o="$(CA_LINII=20 svc "SELECT public.fn_ofertare_cb_audit_scrie('$AUDX,\"clasificare\":\"deja_observat\",\"cauza\":\"intrebat_de_noi\",\"dovezi_istoric\":{\"clarificare_ids\":[$CL1]}}')" || true)"
grep -q 'violates check' <<<"$o" || esec "fără text verificat: $o"; ok "refuz: clasificare automată fără text verificat"
A1=$(j "$(svc "SELECT public.fn_ofertare_cb_audit_scrie('$AUD,\"clasificare\":\"deja_observat\",\"cauza\":\"intrebat_de_noi\",\"dovezi_istoric\":{\"clarificare_ids\":[$CL1]}}')")" 'd["audit_id"]')
ok "audit deja_observat cu clarificarea din snapshot ($A1)"
H2=$(sha b)
o="$(CA_LINII=20 svc "SELECT public.fn_ofertare_cb_audit_scrie('${AUD/\"pereche_id\":\"$H\"/\"pereche_id\":\"$H2\"},\"inlocuieste_id\":$A1,\"clasificare\":\"nedeterminabil\",\"dovezi_istoric\":{}}')" || true)"
grep -q 'inlocuieste_id străin' <<<"$o" || esec "inlocuieste_id pe altă pereche: $o"; ok "refuz: inlocuieste_id al altei perechi"
refuz "editorul nu decide" authenticated "$EDIT" "SELECT public.fn_ofertare_cb_audit_decide($A1,'confirmat')" 'fără drept'
ca authenticated "$RESP" "SELECT public.fn_ofertare_cb_audit_decide($A1,'confirmat','ok')" >/dev/null
refuz "a doua decizie" authenticated "$RESP" "SELECT public.fn_ofertare_cb_audit_decide($A1,'respins')" 'deja înregistrată'
rq "clasificarea e imuabilă" "UPDATE public.ofertare_audit_raspunsuri SET clasificare='omisiune', cauza='detectat_neintrebat'" 'imuabile'

# ── retrasa → trimisa pe o clarificare DEJA cunoscută, comisă după înghețare → eveniment_tarziu (lic. 10) ──
K10=$(ca authenticated "$OWNER" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, status) VALUES (10, 'K', 'retrasa') RETURNING id")
"${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "SELECT 1 FROM public.ofertare_licitatii WHERE id=10 FOR SHARE;" -c "SELECT pg_sleep(2);" -c "COMMIT;" >/dev/null 2>&1 &
sleep 0.5
"${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "UPDATE public.ofertare_clarificari SET status='trimisa' WHERE id=$K10;" -c "SELECT pg_sleep(4);" -c "COMMIT;" >/dev/null 2>&1 &
sleep 3
ca authenticated "$OWNER" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, status) VALUES (10, 'B2', 'trimisa')" >/dev/null
wait
asteapta "retrasa → trimisa pe clarificare cunoscută, comisă după înghețare → eveniment_tarziu" "$(q "SELECT (clarificari::text LIKE '%\"clarificare_id\": $K10%')::text || '|' || public.fn_ofertare_cb_snapshot_incert(id) FROM public.ofertare_analiza_versiuni WHERE licitatie_id=10")" 'true|["eveniment_tarziu"]'

# ── două restanțe concurente la pragul 23/24: o singură încercare (lic. 11) ──
q "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original, tip, text_extras, created_at) VALUES (941, 11, 'F3 11.pdf', 'lista_cantitati', 'lic11 text', now() - interval '20 days')" >/dev/null
ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_decizie(941, '$(sha 'lic11 text')', 'f3', '*', 'text_confirmat', 'verificat pe PDF')" >/dev/null
S11=$(j "$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_ingheata_manual(11,'toate','{}')")" 'd["snapshot_id"]')
q "INSERT INTO public.ofertare_analiza_erori (snapshot_id, faza, eroare, la) SELECT $S11, 'completare', 'test', now() - interval '2 hours' FROM generate_series(1, 23)" >/dev/null
"${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "SELECT public.fn_ofertare_cb_restante();" -c "SELECT pg_sleep(2);" -c "COMMIT;" >/dev/null 2>&1 &
sleep 0.7
svc "SELECT public.fn_ofertare_cb_restante()" >/dev/null
wait
svc "SELECT public.fn_ofertare_cb_restante()" >/dev/null
asteapta "restanțe concurente la 23/24: exact o completare" "$(q "SELECT count(*) FROM public.ofertare_analiza_completari WHERE snapshot_id=$S11")" 1
# plafonul izolat: snapshot încă recuperabil, 24 de încercări mai vechi de o oră → nicio încercare nouă
q "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original, tip, text_extras, created_at) VALUES (951, 12, 'F3 12.pdf', 'lista_cantitati', 'lic12 text', now() - interval '20 days')" >/dev/null
ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_decizie(951, '$(sha 'lic12 text')', 'f3', '*', 'text_confirmat', 'verificat pe PDF')" >/dev/null

# ── înghețarea care așteaptă un setter de loturi: momentul e DUPĂ commit-ul lui, eligibilitate exactă (lic. 12) ──
"${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "SELECT 1 FROM public.ofertare_licitatii WHERE id=12 FOR UPDATE;" -c "INSERT INTO public.ofertare_loturi_jurnal (licitatie_id, actiune, vechi, nou) VALUES (12, 'licitatie_loturi', '{}', '{}');" -c "SELECT pg_sleep(2);" -c "COMMIT;" >/dev/null 2>&1 &
sleep 0.7
ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_ingheata_manual(12,'toate','{}')" >/dev/null
wait
S12=$(q "SELECT id FROM public.ofertare_analiza_versiuni WHERE licitatie_id=12")
q "INSERT INTO public.ofertare_analiza_erori (snapshot_id, faza, eroare, la) SELECT $S12, 'completare', 'test', now() - interval '2 hours' FROM generate_series(1, 24)" >/dev/null
svc "SELECT public.fn_ofertare_cb_restante()" >/dev/null
asteapta "plafon izolat: 24 de încercări vechi pe un snapshot recuperabil → nicio completare nouă" "$(q "SELECT (SELECT count(*) FROM public.ofertare_analiza_completari WHERE snapshot_id=$S12) || '|' || (SELECT (e->>'text_indisponibil') FROM public.ofertare_analiza_versiuni v, jsonb_array_elements(v.doc_manifest) e WHERE v.id=$S12 AND (e->>'document_id')::int=951)")" "0|false"
asteapta "înghețarea după așteptarea setterului: moment după commit, netardivă, exactă" "$(q "SELECT (v.moment_referinta > (SELECT max(la) FROM public.ofertare_loturi_jurnal WHERE licitatie_id=12) + interval '1 second')::text || '|' || v.inghetat_tardiv || '|' || v.eligibilitate FROM public.ofertare_analiza_versiuni v WHERE v.licitatie_id=12")" "true|false|exacta"

# ── 20261031b: proveniența unui text care NU mai e cel curent e refuzată (producător întârziat) ──
asteapta "text_scrie pe alt text decât text_extras-ul curent → text_depasit, nimic scris" "$(j "$(svc "SELECT public.fn_ofertare_cb_text_scrie(903, 'text vechi intarziat', 'transcriere', 'ofertare-ingest-doc', 'integral', '{}')")" 'd.get("refuz")')|$(q "SELECT count(*) FROM public.ofertare_doc_texte_prov WHERE document_id=903")" "text_depasit|1"
# ── 20261031b: pornirea extragerii cu contextul de GRUP verificat atomic (părțile p01 / p02 ale aceluiași PDF) ──
q "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original, tip, text_extras, created_at) VALUES
   (961, 102, 'Lista G — p01_pag1-10.pdf', 'lista_cantitati', 'grup p01 570.000 m', now() - interval '20 days'),
   (962, 102, 'Lista G — p02_pag11-20.pdf', 'lista_cantitati', 'grup p02 1160.000 m', now() - interval '20 days')" >/dev/null
svc "SELECT public.fn_ofertare_cb_text_scrie(961, 'grup p01 570.000 m', 'transcriere', 'ofertare-ingest-doc', 'integral', '{}')" >/dev/null
svc "SELECT public.fn_ofertare_cb_text_scrie(962, 'grup p02 1160.000 m', 'transcriere', 'ofertare-ingest-doc', 'integral', '{}')" >/dev/null
G1=$(sha 'grup p01 570.000 m'); G2=$(sha 'grup p02 1160.000 m')
asteapta "grup: manifest fără p02 (parte curentă validă lipsă) → grup_schimbat" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe_grup($C1, 961, '$G1', '961', 'gpt-5-mini@p1@n2@f1@c-en-x@d-y', 1, ARRAY['961:$G1'])")" 'd.get("refuz")')" grup_schimbat
asteapta "grup: manifestul exact → extragerea pornește" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe_grup($C1, 961, '$G1', '961', 'gpt-5-mini@p1@n2@f1@c-en-x@d-y', 1, ARRAY['962:$G2','961:$G1'])")" 'd.get("ok")')" True
q "UPDATE public.ofertare_documente_atribuire SET text_extras = 'grup p02 revizuit 1.160,00 m' WHERE id = 962" >/dev/null
asteapta "grup: p02 schimbat după manifest (sha diferit, fără proveniență) → grup_schimbat" "$(j "$(svc "SELECT public.fn_ofertare_cb_extragere_incepe_grup($C1, 961, '$G1', '961', 'gpt-5-mini@p1@n2@f1@c-en-z@d-y', 1, ARRAY['961:$G1','962:$G2'])")" 'd.get("refuz")')" grup_schimbat
asteapta "grup: RPC-ul doar pentru service_role" "$(q "SELECT has_function_privilege('authenticated','public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[])','EXECUTE')::text || has_function_privilege('service_role','public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[])','EXECUTE')::text")" falsetrue
o="$(revenire_b || true)"; [ -z "$(grep -i error <<<"$o")" ] || esec "revenire 31b: $o"
asteapta "revenirea 20261031b: corpul din 20261031a la loc (fără text_depasit), RPC-ul de grup scos" "$(q "SELECT (pg_get_functiondef('public.fn_ofertare_cb_text_scrie(bigint,text,text,text,text,integer[])'::regprocedure) LIKE '%text_depasit%')::text || (to_regprocedure('public.fn_ofertare_cb_extragere_incepe_grup(bigint,bigint,text,text,text,integer,text[])') IS NULL)::text")" falsetrue
livreaza_b >/dev/null || esec "reaplicare 31b: $(livreaza_b | tail -3)"; ok "reaplicare 20261031b după revenirea ei"

# ── revenire ──
o="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" 2>&1 || true)"; grep -q 'garda start invalida' <<<"$o" || esec "revenire nearmată: $o"; ok "refuz: revenire nearmată"
q "ALTER TABLE public.ofertare_clarificari DISABLE TRIGGER trg_ofertare_cb_clarificari_jurnal" >/dev/null
o="$(revenire || true)"; grep -q 'amprenta difera' <<<"$o" || esec "drift (trigger dezactivat): $o"; ok "refuz: revenire după dezactivarea triggerului (amprenta)"
q "ALTER TABLE public.ofertare_clarificari ENABLE TRIGGER trg_ofertare_cb_clarificari_jurnal" >/dev/null
q "ALTER POLICY ofertare_cant_obs_select ON public.ofertare_cant_obs TO authenticated, anon" >/dev/null
o="$(revenire || true)"; grep -q 'amprenta difera' <<<"$o" || esec "drift (rolurile politicii): $o"; ok "refuz: revenire după schimbarea rolurilor unei politici (amprenta)"
q "ALTER POLICY ofertare_cant_obs_select ON public.ofertare_cant_obs TO authenticated" >/dev/null
revenire >/dev/null || esec "revenire: $(revenire | tail -3)"
asteapta "după revenire: niciun obiect, triggerul scos, clarificările păstrate" "$(q "SELECT (to_regclass('public.ofertare_cant_obs') IS NULL)::text || (SELECT count(*) FROM pg_trigger WHERE tgname='trg_ofertare_cb_clarificari_jurnal') || (SELECT count(*) FROM public.ofertare_clarificari)")" "true011"
livreaza >/dev/null || esec "reaplicarea după revenire: $(livreaza | tail -3)"
asteapta "după revenire, migrarea se reaplică (20 de tabele, amprenta în comentariu)" "$(q "SELECT (to_regclass('public.ofertare_loturi_observatii') IS NOT NULL)::text || (obj_description('public.ofertare_analiza_versiuni'::regclass, 'pg_class') LIKE '%amprenta=' || public.fn_ofertare_cb_amprenta())::text")" truetrue
echo PASS
