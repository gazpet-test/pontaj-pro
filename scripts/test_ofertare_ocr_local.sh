#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261029a_ofertare_ocr_local (pilot OCR local: rulări, pagini, arbitraje, verificări, jurnal PDF).
# PostgreSQL 16 local dedicat (/tmp/pg_ocr, 127.0.0.1:5448). Nu atinge producția.
# Bază: scheletul loturi (ofertare_loturi_mvp_schelet.sql) + migrarea 20261024b (poarta „document eligibil”) + completarea
# ofertare_ocr_local_schelet_extra.sql. Acoperă: garda de livrare · drepturi (anon / authenticated / service_role pe tabele,
# secvențe și RPC) · poarta pe cheltuială (rol, eligibilitate, licitație, plafon, o rulare activă) · preluare · jurnal + limită PDF ·
# pagini (doar înghețate, sha, idempotent, append-only) · tranziții · cost rezervat sub plafon · arbitraj + ai_usage_log ·
# eșantion + verificare · anulare · heartbeat · control 0e · revenire (nearmată / armată).
# Utilizare: bash scripts/test_ofertare_ocr_local.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR=/tmp/pg_ocr; PORT=5448; BAZA=ofertare_ocr_test
NUME=20261029a_ofertare_ocr_local
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
LOTURI="$RADACINA/supabase/migrations/20261024b_ofertare_loturi_mvp.sql"
SCHELET="$RADACINA/supabase/tests/ofertare_loturi_mvp_schelet.sql"
EXTRA="$RADACINA/supabase/tests/ofertare_ocr_local_schelet_extra.sql"
CONTROL_0E="$RADACINA/scripts/control_0e.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_ocr" ] || mediu "$DATE_DIR există și nu e fixture — nu îl șterg"
  [ -f "$DATE_DIR/postmaster.pid" ] && { ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; }
  rm -rf "$DATE_DIR"
fi
mkdir -p "$DATE_DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_ocr"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_ocr.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null || esec "schelet"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '20261024b_ofertare_loturi_mvp:' || txid_current(), true);" \
  -f "$LOTURI" >/dev/null || esec "migrarea de baza 20261024b"
"${PSQL[@]}" -d "$BAZA" -f "$EXTRA" >/dev/null || esec "schelet extra"

OWNER=00000000-0000-4000-8000-000000000121; RESP=00000000-0000-4000-8000-000000000043
EDIT=00000000-0000-4000-8000-000000000007
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
ca() {
  local claims
  if [ "$2" = - ]; then claims="{\"role\":\"$1\"}"; else claims="{\"sub\":\"$2\",\"role\":\"$1\"}"; fi
  "${PSQL[@]}" -d "$BAZA" -At -c "SET SESSION AUTHORIZATION authenticator;" -c "BEGIN;" -c "SET LOCAL ROLE $1;" \
    -c "SELECT set_config('request.jwt.claims', '$claims', true);" -c "$3" -c "COMMIT;" 2>&1 | grep -v '^BEGIN$\|^SET$\|^COMMIT$' | tail -"${CA_LINII:-1}"
}
asteapta() { [ "$2" = "$3" ] || esec "$1: așteptat «$3», primit «$2»"; ok "$1"; }
refuz() { local o; o="$(CA_LINII=50 ca "$2" "$3" "$4" || true)"; grep -q "$5" <<<"$o" || esec "$1 trebuia refuzat ($5), primit: $o"; ok "refuz: $1"; }
livreaza() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1; }
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261029a', 'OCR_LOCAL_REVENIRE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1; }
sha() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

# ── pregătire: loturi + triere (1247 comun = eligibil, 527 lot 1 neparticipant = neeligibil) ─────────────
L='[{"nr":1,"denumire":"Cosula-Saveni"},{"nr":2,"denumire":"Saveni-Darabani","participam":true},{"nr":3,"denumire":"Stauceni-Stefanesti","participam":true}]'
ca authenticated "$RESP" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '$L')" >/dev/null
ca authenticated "$RESP" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[1247,1302]::bigint[], 'comun', '{}', 'test')" >/dev/null
ca authenticated "$RESP" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[527]::bigint[], 'alocat', '{1}', 'test')" >/dev/null
asteapta "1247 eligibil" "$(q "SELECT public.fn_ofertare_document_eligibil(1247)->>'eligibil'")" true

# ── livrare ──────────────────────────────────────────────────────────────────────────────────────────────
python3 "$RADACINA/scripts/livrare_validator.py" "$MIGRARE" >/dev/null || esec "validatorul de livrare refuză migrarea"; ok "validator livrare"
o="$("${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" 2>&1 || true)"; grep -q "garda start invalida" <<<"$o" || esec "fără gardă: $o"
[ "$(q "SELECT to_regclass('public.ofertare_ocr_rulari') IS NULL")" = t ] || esec "fără gardă a lăsat urme"; ok "refuz: migrare fără gardă"
livreaza >/dev/null || { livreaza; esec "livrare"; }; ok "livrare cu gardă"
o="$(livreaza || true)"; grep -q "obiectele exista deja" <<<"$o" || esec "reaplicare: $o"; ok "refuz: reaplicare"
asteapta "control 0e" "$(q "$(cat "$CONTROL_0E")" | wc -l | tr -d ' ')" 0

# ── drepturi directe ─────────────────────────────────────────────────────────────────────────────────────
refuz "anon SELECT rulari" anon - "SELECT count(*) FROM public.ofertare_ocr_rulari" "permission denied"
refuz "authenticated INSERT rulari" authenticated "$OWNER" "INSERT INTO public.ofertare_ocr_rulari(licitatie_id, documente, plafon_usd, pornit_de) VALUES (102, '[{}]', 1, '$OWNER')" "permission denied"
refuz "service_role INSERT pagini" service_role - "INSERT INTO public.ofertare_ocr_pagini(rulare_id) VALUES (1)" "permission denied"
refuz "service_role UPDATE rulari" service_role - "UPDATE public.ofertare_ocr_rulari SET plafon_usd = 15" "permission denied"
refuz "authenticated SELECT jurnal pdf" authenticated "$OWNER" "SELECT count(*) FROM public.ofertare_ocr_pdf_jurnal" "permission denied"
refuz "authenticated apelează preia" authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_preia('lighton-mineru-v2')" "permission denied"
refuz "authenticated apelează cost_rezerva" authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_cost_rezerva(1, 0.1)" "permission denied"

# ── poarta pe cheltuială ─────────────────────────────────────────────────────────────────────────────────
refuz "cerere: editor fără responsabilitate" authenticated "$EDIT" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 15)" "Doar owner-ul"
refuz "cerere: plafon 20" authenticated "$RESP" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 20)" "între 0 și 15"
refuz "cerere: document neeligibil (lot neparticipant)" authenticated "$RESP" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[527]::bigint[], 15)" "nu e eligibil"
refuz "cerere: document din altă licitație" authenticated "$RESP" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[31]::bigint[], 15)" "nu aparține"
refuz "cerere: document fără pagini necitite" authenticated "$RESP" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1302]::bigint[], 15)" "nu are pagini"
refuz "cerere: duplicate" authenticated "$RESP" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247,1247]::bigint[], 15)" "duplicate"
R=$(ca authenticated "$RESP" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 1)->>'rulare_id'")
[ -n "$R" ] || esec "cererea responsabilului"; ok "cerere responsabil (rulare $R, plafon 1)"
asteapta "pagini înghețate" "$(q "SELECT documente->0->'pagini' FROM public.ofertare_ocr_rulari WHERE id=$R")" "[325, 326, 327]"
refuz "cerere: a doua rulare activă" authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 15)" "rulare activă"
asteapta "editor citește rulările (acces Ofertare)" "$(ca authenticated "$EDIT" "SELECT count(*) FROM public.ofertare_ocr_rulari")" 1

# ── server: preluare + PDF ───────────────────────────────────────────────────────────────────────────────
refuz "preia: protocol invalid" service_role - "SELECT public.fn_ofertare_ocr_preia('Rau;protocol')" "protocol invalid"
asteapta "preia" "$(ca service_role - "SELECT public.fn_ofertare_ocr_preia('lighton-mineru-v2')->'rulare'->>'id'")" "$R"
asteapta "preia: nimic de preluat" "$(ca service_role - "SELECT public.fn_ofertare_ocr_preia('lighton-mineru-v2')->>'rulare'")" ""
asteapta "pdf: document în afara rulării" "$(ca service_role - "SELECT public.fn_ofertare_ocr_pdf_rezerva($R, 527)->>'rezultat'")" respins
J=$(ca service_role - "SELECT public.fn_ofertare_ocr_pdf_rezerva($R, 1247)->>'jurnal_id'")
asteapta "pdf: cale" "$(q "SELECT fisier_path FROM public.ofertare_documente_atribuire WHERE id=1247")" "102/atribuire/pt_fv.pdf"
asteapta "pdf: final emis" "$(ca service_role - "SELECT public.fn_ofertare_ocr_pdf_final($J, 'emis')")" t
asteapta "pdf: final repetat refuzat" "$(ca service_role - "SELECT public.fn_ofertare_ocr_pdf_final($J, 'emis')")" f

# ── pagini ───────────────────────────────────────────────────────────────────────────────────────────────
T1='Conductă DN 250 — 0,056'; H1=$(sha "$T1")
SP() { echo "SELECT public.fn_ofertare_ocr_scrie_pagina($R, 1247, $1, '$2', '$3', 'citit', 'LightOnOCR-2-1B', '$4', NULL, '{}')"; }
refuz "pagină neînghețată" service_role - "$(SP 400 lighton "$T1" "$H1")" "nu e în rulare"
refuz "sha greșit" service_role - "$(SP 325 lighton "$T1" "$(sha altceva)")" "raw_sha256"
asteapta "pagină scrisă" "$(ca service_role - "$(SP 325 lighton "$T1" "$H1")->>'deja'")" false
asteapta "aceeași pagină: idempotent" "$(ca service_role - "$(SP 325 lighton "$T1" "$H1")->>'deja'")" true
refuz "aceeași cheie, alt text (append-only)" service_role - "$(SP 325 lighton "x" "$(sha x)")" "alt conținut"
refuz "reconciliat în preluata" service_role - "$(SP 325 reconciliat "$T1" "$H1")" "reconcilierea doar"

# ── tranziții + cost ─────────────────────────────────────────────────────────────────────────────────────
refuz "preluata → finalizata" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'finalizata')" "nepermisă"
asteapta "preluata → citita" "$(ca service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'citita')->>'stare'")" citita
refuz "pagina de cititor după citita" service_role - "$(SP 326 mineru "$T1" "$H1")" "doar în preluata"
asteapta "rezervă 0,6" "$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.6)")" t
asteapta "rezervă încă 0,6 peste plafonul 1" "$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.6)")" f
asteapta "rezervă peste 1 USD pe apel" "$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 2)")" f
A="{\"document_id\":1247,\"pagina\":325,\"item_id\":\"p0325_b0_r1\",\"item_sha256\":\"$(sha item1)\",\"tip\":\"rand_tabel\",\"citire_lighton\":\"0,056\",\"citire_mineru\":\"0.056\",\"decizie\":\"ales_mineru\",\"text_ales\":\"0.056\",\"motiv\":\"imaginea arata punct\",\"e_cantitate\":true,\"anomalie_separator\":true,\"arbitru_model\":\"claude-sonnet-5\",\"prompt_versiune\":\"arb-v1\",\"cost_usd\":%s,\"tokens_in\":3000,\"tokens_out\":300}"
refuz "arbitraj: cost peste rezervare" service_role - "SELECT public.fn_ofertare_ocr_scrie_arbitraj($R, 0.6, '$(printf "$A" 0.7)')" "peste rezervare"
asteapta "arbitraj scris" "$(ca service_role - "SELECT public.fn_ofertare_ocr_scrie_arbitraj($R, 0.6, '$(printf "$A" 0.015)')->>'ok'")" true
asteapta "cost și rezervare după arbitraj" "$(q "SELECT cost_usd||'|'||cost_rezervat FROM public.ofertare_ocr_rulari WHERE id=$R")" "0.0150|0.0000"
asteapta "ai_usage_log" "$(q "SELECT count(*) FROM public.ai_usage_log WHERE function_name='ofertare-ocr-arbitreaza' AND ref_table='ofertare_ocr_arbitraje'")" 1
ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.1)" >/dev/null
refuz "arbitraj: același item_sha256 de două ori" service_role - "SELECT public.fn_ofertare_ocr_scrie_arbitraj($R, 0.1, '$(printf "$A" 0.01)')" "duplicate key"

# ── eșantion + verificare ────────────────────────────────────────────────────────────────────────────────
AID=$(q "SELECT id FROM public.ofertare_ocr_arbitraje WHERE rulare_id=$R")
asteapta "eșantion: anomalia de separator intră 100%" "$(ca authenticated "$EDIT" "SELECT motiv_esantion FROM public.fn_ofertare_ocr_esantion($R) WHERE arbitraj_id=$AID")" anomalie_separator
refuz "verificare: editor" authenticated "$EDIT" "SELECT public.fn_ofertare_ocr_verifica($AID, 'corect')" "Doar owner-ul"
asteapta "verificare: responsabil" "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_ocr_verifica($AID, 'corect', 'vazut pe imagine')->>'ok'")" true
refuz "verificare: al doilea verdict" authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_verifica($AID, 'gresit')" "deja un verdict"

# ── închidere, anulare, heartbeat ────────────────────────────────────────────────────────────────────────
refuz "oprire fără motiv" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'oprita')" "obligatoriu"
asteapta "oprire cu motiv" "$(ca service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'oprita', 'test')->>'stare'")" oprita
asteapta "rezervarea anulată la oprire" "$(q "SELECT cost_rezervat FROM public.ofertare_ocr_rulari WHERE id=$R")" 0.0000
R2=$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 15)->>'rulare_id'")
refuz "anulare: editor" authenticated "$EDIT" "SELECT public.fn_ofertare_ocr_anuleaza($R2)" "Doar owner-ul"
asteapta "anulare: responsabil" "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_ocr_anuleaza($R2)->>'ok'")" true
asteapta "heartbeat" "$(ca service_role - "SELECT public.fn_ofertare_ocr_heartbeat(true, 'test')")" t
asteapta "heartbeat scris" "$(q "SELECT ultim_ok||'|'||ultim_mesaj FROM public.procese_heartbeat WHERE cheie='ocr_local_ofertare'")" "true|test"

# ── revenire ─────────────────────────────────────────────────────────────────────────────────────────────
o="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" 2>&1 || true)"; grep -q "garda start invalida" <<<"$o" || esec "revenire nearmată: $o"; ok "refuz: revenire nearmată"
revenire >/dev/null || { revenire; esec "revenire armată"; }; ok "revenire armată"
asteapta "după revenire: niciun obiect" "$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%'")|$(q "SELECT to_regclass('public.ofertare_ocr_rulari') IS NULL")" "0|t"
livreaza >/dev/null || esec "reaplicare după revenire"; ok "dus-întors: reaplicare după revenire"
echo "PASS"
