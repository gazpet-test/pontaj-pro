#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261026a_ofertare_rigoare_provenienta (PR-ul de rigoare: surse multiple pe cerință, garda de loturi
# în RPC-ul de aplicare, sursele clarificării automate scrise odată cu textul).
# PostgreSQL 16 local dedicat (/tmp/pg_rigoare, 127.0.0.1:5449), peste scheletul loturi + 20261024b + scheletul proveniență +
# 20261025a + scheletul rigoare (RPC-urile REALE, corpurile exacte din producție). Nu atinge producția.
# Rulează în GitHub Actions (ofertare-regresie, job „loturi-provenienta”) — nimic instalat pe server.
# Acoperă: garda de livrare · precondițiile md5 + atribute pe cele 3 funcții · aplicare + postcondiții · control 0e · validarea
# surselor pe cerințe · RPC-ul REAL fn_ofertare_raspuns_set_aplica (surse = operație ∪ răspuns ∪ versiunea veche, conflicte pe
# surse invalide / din altă licitație, garda de loturi în RPC chiar fără triggerul a03) · concurență cu sincronizare explicită
# (pg_stat_activity, nu doar sleep): setter-ul întâi → RPC-ul așteaptă și e refuzat, zero cerințe; RPC-ul întâi → setter-ul
# așteaptă commit-ul; aplicare parțială după trecerea pe loturi → aceeași gardă · RPC-ul REAL ofertare_clarificare_planse_auto
# (surse explicite cu documentul financiar citat, reuniune pe ciorna protejată) · revenire (nearmată / modificată / persistentă /
# armată, arhivă, md5 vechi) · dus-întors.
# Utilizare: bash scripts/test_ofertare_rigoare_provenienta.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR=/tmp/pg_rigoare; PORT=5449; BAZA=ofertare_loturi_test
NUME=20261026a_ofertare_rigoare_provenienta
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
NUME_LOTURI=20261024b_ofertare_loturi_mvp; NUME_PROV=20261025a_ofertare_provenienta_derivate
SCHELET_LOTURI="$RADACINA/supabase/tests/ofertare_loturi_mvp_schelet.sql"
SCHELET_PROV="$RADACINA/supabase/tests/ofertare_provenienta_schelet.sql"
SCHELET="$RADACINA/supabase/tests/ofertare_rigoare_schelet.sql"
CONTROL_0E="$RADACINA/scripts/control_0e.sql"
# corpurile din producție (12.10.2026) și cele puse de 20261026a — md5(replace(prosrc, chr(13), ''))
V_APLICA=2033717feec11bb1bdd2b7caf97ef807; V_PLANSE=2e0eaa89663d5f3f4d6d49aa8443fae2; V_VALID=a4e41e9e4e93d430386ae7f55c3be977
N_APLICA=0026d0f6420b6e20e8ce331ac65964f7; N_PLANSE=4dc464d871679ff9d0b596042fb5bf8a; N_VALID=03b3a62bf2b4bdce1378e75397179099
V_AMPRENTE=935951b073ece50e62c4a660357446a0
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_rigoare" ] || mediu "$DATE_DIR există și nu e fixture — nu îl șterg"
  [ -f "$DATE_DIR/postmaster.pid" ] && { ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; }
  rm -rf "$DATE_DIR"
fi
mkdir -p "$DATE_DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_rigoare"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_rigoare.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
livreaza_nume() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$1:' || txid_current(), true);" \
  -f "$RADACINA/supabase/migrations/$1.sql" 2>&1; }
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET_LOTURI" >/dev/null || esec "schelet loturi"
livreaza_nume "$NUME_LOTURI" >/dev/null || esec "livrare 20261024b (bază)"
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET_PROV" >/dev/null || esec "schelet proveniență"
livreaza_nume "$NUME_PROV" >/dev/null || esec "livrare 20261025a (bază)"
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null || esec "schelet rigoare"

OWNER=00000000-0000-4000-8000-000000000121; EDIT=00000000-0000-4000-8000-000000000007
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
ca() {
  local claims
  if [ "$2" = - ]; then claims="{\"role\":\"$1\"}"; else claims="{\"sub\":\"$2\",\"role\":\"$1\"}"; fi
  "${PSQL[@]}" -d "$BAZA" -At -c "SET SESSION AUTHORIZATION authenticator;" -c "BEGIN;" -c "SET LOCAL ROLE $1;" \
    -c "SELECT set_config('request.jwt.claims', '$claims', true);" -c "$3" -c "COMMIT;" 2>&1 | grep -v '^BEGIN$\|^SET$\|^COMMIT$' | tail -"${CA_LINII:-1}"
}
asteapta() { [ "$2" = "$3" ] || esec "$1: așteptat «$3», primit «$2»"; ok "$1"; }
refuz() { local o; o="$(CA_LINII=50 ca "$2" "$3" "$4" || true)"; grep -q "$5" <<<"$o" || esec "$1 trebuia refuzat ($5), primit: $o"; ok "refuz: $1"; }
livreaza() { livreaza_nume "$NUME"; }
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -v ON_ERROR_STOP=1 -c "SELECT set_config('gazpet.revenire_20261026a', 'OFERTARE_RIGOARE_REVENIRE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1; }
md5f() { q "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.$1')"; }
SIG_APLICA='fn_ofertare_raspuns_set_aplica(bigint,text[],uuid,boolean,text,text)'; SIG_PLANSE='ofertare_clarificare_planse_auto(bigint)'
SIG_VALID='fn_ofertare_surse_valideaza()'
trei() { echo "$(md5f "$SIG_APLICA")/$(md5f "$SIG_PLANSE")/$(md5f "$SIG_VALID")"; }
aplica() { ca service_role - "SELECT public.fn_ofertare_raspuns_set_aplica($1, ARRAY[$2]::text[], '$OWNER')::text"; }
# amprenta curentă a unei cerințe în propunerea setului (ca la generarea propunerii)
amprenta() { q "UPDATE public.ofertare_raspuns_set SET propunere = jsonb_set(propunere, ARRAY['amprente', '$2'],
  to_jsonb((SELECT amprenta FROM public.fn_ofertare_cerinte_amprente(licitatie_id, ARRAY[$2::bigint])))) WHERE id = $1" >/dev/null; }

# ── fidelitatea scheletului ──────────────────────────────────────────────────────────────────────────
asteapta "scheletul are corpurile din producție (aplica / planse_auto / validare)" "$(trei)" "$V_APLICA/$V_PLANSE/$V_VALID"
asteapta "scheletul: fn_ofertare_cerinte_amprente = producția" "$(md5f 'fn_ofertare_cerinte_amprente(bigint,bigint[])')" "$V_AMPRENTE"

# ── livrare ────────────────────────────────────────────────────────────────────────────────────────────
python3 "$RADACINA/scripts/livrare_validator.py" "$MIGRARE" >/dev/null || esec "validatorul de livrare refuză migrarea"; ok "validator livrare"
o="$("${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" 2>&1 || true)"; grep -q "garda de livrare (start)" <<<"$o" || esec "fără gardă: $o"
asteapta "fără gardă: nicio urmă" "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='ofertare_cerinte' AND column_name='surse_document_ids'")/$(trei)" "0/$V_APLICA/$V_PLANSE/$V_VALID"
ok "refuz: migrare fără gardă"
# precondițiile pe corpuri + atribute: o versiune schimbată nu e suprascrisă
q "ALTER FUNCTION public.$SIG_APLICA SECURITY DEFINER" >/dev/null
o="$(livreaza || true)"; grep -q "fn_ofertare_raspuns_set_aplica diferă" <<<"$o" || esec "aplica SECURITY DEFINER: $o"; ok "refuz: RPC-ul de aplicare cu alt atribut (SECURITY DEFINER)"
q "ALTER FUNCTION public.$SIG_APLICA SECURITY INVOKER" >/dev/null
q "GRANT EXECUTE ON FUNCTION public.$SIG_PLANSE TO authenticated" >/dev/null
o="$(livreaza || true)"; grep -q "ofertare_clarificare_planse_auto diferă" <<<"$o" || esec "planse_auto cu ACL lărgit: $o"; ok "refuz: clarificarea automată cu ACL lărgit"
q "REVOKE EXECUTE ON FUNCTION public.$SIG_PLANSE FROM authenticated" >/dev/null
q "ALTER FUNCTION public.$SIG_VALID RENAME TO fn_ofertare_surse_valideaza_orig" >/dev/null
q "CREATE FUNCTION public.fn_ofertare_surse_valideaza() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS 'BEGIN RETURN NEW; END'" >/dev/null
q "REVOKE ALL ON FUNCTION public.fn_ofertare_surse_valideaza() FROM PUBLIC, anon, authenticated, service_role" >/dev/null
o="$(livreaza || true)"; grep -q "fn_ofertare_surse_valideaza diferă" <<<"$o" || esec "validare cu alt corp: $o"; ok "refuz: funcția de validare cu alt corp"
q "DROP FUNCTION public.fn_ofertare_surse_valideaza()" >/dev/null
q "ALTER FUNCTION public.fn_ofertare_surse_valideaza_orig() RENAME TO fn_ofertare_surse_valideaza" >/dev/null
asteapta "funcțiile originale restaurate" "$(trei)" "$V_APLICA/$V_PLANSE/$V_VALID"
# garda a03 verificată EXACT (Copilot r1 P1): dezactivată sau cu alt atribut → refuz
q "ALTER TABLE public.ofertare_raspuns_set DISABLE TRIGGER a03_ofertare_raspuns_set_garda_loturi" >/dev/null
o="$(livreaza || true)"; grep -q "garda a03 (20261025a) lipsește sau diferă" <<<"$o" || esec "a03 dezactivată: $o"; ok "refuz: livrare cu garda a03 dezactivată"
q "ALTER TABLE public.ofertare_raspuns_set ENABLE TRIGGER a03_ofertare_raspuns_set_garda_loturi" >/dev/null
q "GRANT EXECUTE ON FUNCTION public.fn_ofertare_raspuns_set_garda_loturi() TO service_role" >/dev/null
o="$(livreaza || true)"; grep -q "garda a03 (20261025a) lipsește sau diferă" <<<"$o" || esec "a03 cu ACL lărgit: $o"; ok "refuz: livrare cu funcția gărzii a03 cu ACL lărgit"
q "REVOKE EXECUTE ON FUNCTION public.fn_ofertare_raspuns_set_garda_loturi() FROM service_role" >/dev/null
livreaza >/dev/null || { livreaza; esec "livrare"; }; ok "livrare cu gardă"
o="$(livreaza || true)"; grep -q "Precondiție 20261026a" <<<"$o" || esec "reaplicare: $o"; ok "refuz: reaplicare"
asteapta "control 0e (0 funcții expuse cu set_config/execute/…)" "$(q "$(cat "$CONTROL_0E")" | wc -l | tr -d ' ')" 0
asteapta "corpurile noi (aplica / planse_auto / validare)" "$(trei)" "$N_APLICA/$N_PLANSE/$N_VALID"
asteapta "cerințele existente rămân fără surse" "$(q "SELECT count(*) FROM public.ofertare_cerinte WHERE surse_document_ids IS NOT NULL")" 0
asteapta "drepturi neschimbate: aplica / planse_auto (authenticated, service_role)" \
  "$(q "SELECT has_function_privilege('authenticated','public.$SIG_APLICA','EXECUTE')::text||has_function_privilege('service_role','public.$SIG_APLICA','EXECUTE')::text||has_function_privilege('authenticated','public.$SIG_PLANSE','EXECUTE')::text||has_function_privilege('service_role','public.$SIG_PLANSE','EXECUTE')::text")" falsetruefalsetrue

# ── date: licitații pe stări de lot, documente, cerințe ───────────────────────────────────────────────────
q "INSERT INTO public.ofertare_licitatii(id, nr_anunt) VALUES (5, 'X5 concurență setter întâi'), (6, 'X6 concurență RPC întâi')" >/dev/null
q "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original, tip) VALUES
   (33, 3, 'Raspuns clarificari 1.pdf', 'clarificare'), (34, 3, 'Anexa raspuns.pdf', 'clarificare'), (35, 3, 'Raspuns clarificari 2.pdf', 'clarificare'),
   (51, 5, 'r5.pdf', 'clarificare'), (61, 6, 'r6.pdf', 'clarificare')" >/dev/null
L='[{"nr":1},{"nr":2,"participam":true},{"nr":3,"participam":true},{"nr":4}]'
asteapta "loturi: 102 are_loturi; 3, 5, 6 fara_loturi; 4 neinițializată (setter 20261024b)" \
  "$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '$L')->>'ok'")/$(for l in 3 5 6; do ca authenticated "$OWNER" "SELECT public.fn_ofertare_licitatie_loturi_seteaza($l, 'fara_loturi')->>'stare'"; done | tr '\n' ' ')" \
  "true/fara_loturi fara_loturi fara_loturi "
CA=$(q "INSERT INTO public.ofertare_cerinte(licitatie_id, sursa_document_id, text_cerinta, tip, versiune, stare, nr_ordine) VALUES (3, 31, 'C1 vechi', 'propunere', 1, 'de_analizat', 1) RETURNING id")
q "INSERT INTO public.ofertare_acoperire(cerinta_id) VALUES ($CA)" >/dev/null

# ── validarea surselor pe cerințe (aceeași funcție ca la clarificări / cantități) ────────────────────────
refuz "authenticated: INSERT cerință cu surse" authenticated "$EDIT" "INSERT INTO public.ofertare_cerinte(licitatie_id, text_cerinta, surse_document_ids) VALUES (3, 'u', '{31}')" "doar serverul"
refuz "authenticated: UPDATE surse pe cerință (forjare)" authenticated "$EDIT" "UPDATE public.ofertare_cerinte SET surse_document_ids = '{31}' WHERE id = $CA" "doar serverul"
asteapta "authenticated: textul cerinței se editează (surse neatinse)" \
  "$(ca authenticated "$EDIT" "UPDATE public.ofertare_cerinte SET stare_motiv = 'nota' WHERE id = $CA RETURNING coalesce(surse_document_ids::text, 'NULL')")" NULL
refuz "server: cerință cu document din altă licitație" service_role - "INSERT INTO public.ofertare_cerinte(licitatie_id, text_cerinta, surse_document_ids) VALUES (3, 's', '{1247}')" "nu există în licitația"
refuz "server: NULL în surse" service_role - "INSERT INTO public.ofertare_cerinte(licitatie_id, text_cerinta, surse_document_ids) VALUES (3, 's', '{31,NULL}')" "fără NULL"
q "UPDATE public.ofertare_cerinte SET stare_motiv = NULL WHERE id = $CA" >/dev/null

# ── RPC-ul REAL de aplicare pe fara_loturi: surse complete, conflicte fără scrieri ─────────────────────────
q "INSERT INTO public.ofertare_raspuns_set(id, licitatie_id, titlu, propunere) VALUES (10, 3, 'Raspuns 1', '{\"operatii\": [
   {\"op_id\": \"m1\", \"fel\": \"modifica\", \"cerinta_id\": $CA, \"text_nou\": \"C1 nou\", \"document_id\": 33, \"surse_doc_ids\": [33, 34]},
   {\"op_id\": \"n1\", \"fel\": \"noua\", \"text_cerinta\": \"N1\", \"document_id\": 33, \"surse_doc_ids\": [33]},
   {\"op_id\": \"n0\", \"fel\": \"noua\", \"text_cerinta\": \"N0 vechi\", \"document_id\": 35},
   {\"op_id\": \"x1\", \"fel\": \"noua\", \"text_cerinta\": \"X1\", \"document_id\": 33, \"surse_doc_ids\": [1247]},
   {\"op_id\": \"x2\", \"fel\": \"noua\", \"text_cerinta\": \"X2\", \"surse_doc_ids\": [\"abc\"]},
   {\"op_id\": \"x3\", \"fel\": \"noua\", \"text_cerinta\": \"X3\", \"document_id\": 424242},
   {\"op_id\": \"x4\", \"fel\": \"noua\", \"text_cerinta\": \"X4\", \"surse_doc_ids\": []}], \"amprente\": {}}')" >/dev/null
amprenta 10 "$CA"
R=$(aplica 10 "'m1','n1','n0','x1','x2','x3','x4'")
asteapta "aplica: 1 modificată + 2 noi + 4 conflicte (altă licitație, listă nevalidă, document inexistent, fără nicio sursă)" \
  "$(jq -r '"\(.modificate)/\(.noi)/\(.conflicte|length)/\(.conflicte|map(.op_id)|sort|join(","))"' <<<"$R")" "1/2/4/x1,x2,x3,x4"
asteapta "conflictele spun de ce (proveniență)" "$(jq -r '[.conflicte[].motiv|test("provenienta neverificabila")]|all' <<<"$R")" true
CB=$(jq -r '.aplicate[]|select(.op_id=="m1")|.cerinta_noua' <<<"$R")
asteapta "modifică: versiunea nouă = operație ∪ răspuns ∪ documentul versiunii vechi" "$(q "SELECT surse_document_ids::text||'|'||sursa_document_id FROM public.ofertare_cerinte WHERE id = $CB")" "{31,33,34}|33"
asteapta "noua cu surse_doc_ids: sursele operației" "$(q "SELECT surse_document_ids::text FROM public.ofertare_cerinte WHERE text_cerinta = 'N1'")" "{33}"
asteapta "noua veche (fără surse_doc_ids): documentul de răspuns" "$(q "SELECT surse_document_ids::text FROM public.ofertare_cerinte WHERE text_cerinta = 'N0 vechi'")" "{35}"
asteapta "conflictele n-au scris nimic" "$(q "SELECT count(*) FROM public.ofertare_cerinte WHERE text_cerinta IN ('X1','X2','X3','X4')")" 0
# peste limita validării (20000 surse): conflict în RPC, nu excepție din trigger care ar anula și operațiile valide (Copilot r1 P2)
q "INSERT INTO public.ofertare_licitatii(id, nr_anunt) VALUES (7, 'X7 limita surse')" >/dev/null
ca authenticated "$OWNER" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(7, 'fara_loturi')->>'stare'" >/dev/null
q "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original) SELECT 100000 + g, 7, 'd' || g FROM generate_series(0, 20000) g" >/dev/null
q "INSERT INTO public.ofertare_raspuns_set(id, licitatie_id, titlu, propunere) SELECT 16, 7, 'R7', jsonb_build_object('operatii', jsonb_build_array(
     jsonb_build_object('op_id', 'ok', 'fel', 'noua', 'text_cerinta', 'N7 ok', 'document_id', 100000),
     jsonb_build_object('op_id', 'mare', 'fel', 'noua', 'text_cerinta', 'N7 mare', 'surse_doc_ids', (SELECT jsonb_agg(100000 + g) FROM generate_series(0, 20000) g))))" >/dev/null
R16=$(aplica 16 "'ok','mare'")
asteapta "20001 surse: conflict pe operație, operația validă din același apel se aplică" \
  "$(jq -r '"\(.noi)/\(.conflicte[0].op_id)/\(.conflicte[0].motiv)"' <<<"$R16")" "1/mare/prea multe surse (peste 20000)"
# modifică / anulează FĂRĂ niciun document al operației (Jakarinos r1 P1 #1): nu moștenește doar sursele vechi — conflict
CM=$(q "INSERT INTO public.ofertare_cerinte(licitatie_id, sursa_document_id, text_cerinta, tip, versiune, stare, nr_ordine) VALUES (3, 31, 'M1', 'propunere', 1, 'de_analizat', 7) RETURNING id")
q "INSERT INTO public.ofertare_raspuns_set(id, licitatie_id, titlu, propunere) VALUES (15, 3, 'Raspuns 4', '{\"operatii\": [
   {\"op_id\": \"m\", \"fel\": \"modifica\", \"cerinta_id\": $CM, \"text_nou\": \"M1 nou\"},
   {\"op_id\": \"a\", \"fel\": \"anuleaza\", \"cerinta_id\": $CM, \"surse_doc_ids\": null}], \"amprente\": {}}')" >/dev/null
amprenta 15 "$CM"
R15=$(aplica 15 "'m','a'")
asteapta "modifică / anulează fără sursă proprie: 2 conflicte, cerința rămâne activă, fără fotografie de acoperire" \
  "$(jq -r '"\(.modificate)/\(.anulate)/\(.conflicte|length)"' <<<"$R15")/$(q "SELECT coalesce(inlocuita_de::text,'activa')||'/'||coalesce(acoperire_snapshot::text,'NULL') FROM public.ofertare_cerinte WHERE id = $CM")" "0/0/2/activa/NULL"
asteapta "rezultatul poartă sursele" "$(jq -c '.aplicate[]|select(.op_id=="m1")|.surse_document_ids' <<<"$R")" "[31,33,34]"
asteapta "setul: aplicat_partial (conflicte)" "$(q "SELECT stare FROM public.ofertare_raspuns_set WHERE id = 10")" aplicat_partial
asteapta "acoperirea mutată pe versiunea nouă" "$(q "SELECT cerinta_id FROM public.ofertare_acoperire")" "$CB"
# lanț: a doua modificare moștenește TOATE sursele versiunii precedente
q "INSERT INTO public.ofertare_raspuns_set(id, licitatie_id, titlu, propunere) VALUES (11, 3, 'Raspuns 2', '{\"operatii\": [
   {\"op_id\": \"m2\", \"fel\": \"modifica\", \"cerinta_id\": $CB, \"text_nou\": \"C1 v3\", \"document_id\": 35, \"surse_doc_ids\": [35]},
   {\"op_id\": \"a2\", \"fel\": \"anuleaza\", \"cerinta_id\": $CB, \"document_id\": 35}], \"amprente\": {}}')" >/dev/null
amprenta 11 "$CB"
R=$(aplica 11 "'m2'")
CC=$(jq -r '.aplicate[0].cerinta_noua' <<<"$R")
asteapta "lanț: versiunea 3 = sursele v2 ∪ noul răspuns" "$(q "SELECT surse_document_ids::text||'|'||versiune FROM public.ofertare_cerinte WHERE id = $CC")" "{31,33,34,35}|3"
# sursele moștenite care nu mai pot fi verificate (document șters) = conflict, nimic scris
q "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original) VALUES (39, 3, 'temporar.pdf')" >/dev/null
CT=$(q "INSERT INTO public.ofertare_cerinte(licitatie_id, text_cerinta, tip, versiune, stare, nr_ordine, surse_document_ids) VALUES (3, 'T1', 'propunere', 1, 'de_analizat', 9, '{39}') RETURNING id")
q "DELETE FROM public.ofertare_documente_atribuire WHERE id = 39" >/dev/null
q "INSERT INTO public.ofertare_raspuns_set(id, licitatie_id, titlu, propunere) VALUES (14, 3, 'Raspuns 3', '{\"operatii\": [
   {\"op_id\": \"m3\", \"fel\": \"modifica\", \"cerinta_id\": $CT, \"text_nou\": \"T1 nou\", \"document_id\": 35}], \"amprente\": {}}')" >/dev/null
amprenta 14 "$CT"
R=$(aplica 14 "'m3'")
asteapta "sursă moștenită dispărută: conflict, cerința rămâne neînlocuită" \
  "$(jq -r '.conflicte[0].motiv' <<<"$R" | grep -c 'sursa #39')/$(q "SELECT coalesce(inlocuita_de::text, 'activa') FROM public.ofertare_cerinte WHERE id = $CT")" "1/activa"
q "UPDATE public.ofertare_cerinte SET surse_document_ids = NULL WHERE id = $CT" >/dev/null   # (sursa dispărută nu se mai poate restaura după revenire)

# ── garda de loturi ÎN RPC (înaintea oricărei scrieri), cu și fără triggerul a03 ─────────────────────────
C102=$(q "INSERT INTO public.ofertare_cerinte(licitatie_id, sursa_document_id, text_cerinta, tip, versiune, stare, nr_ordine, lot_domeniu, lot_nr) VALUES (102, 528, 'C102', 'propunere', 1, 'de_analizat', 1, 'lista', '{2}') RETURNING id")
q "INSERT INTO public.ofertare_raspuns_set(id, licitatie_id, titlu, propunere) VALUES (20, 102, 'R102', '{\"operatii\": [
   {\"op_id\": \"m\", \"fel\": \"modifica\", \"cerinta_id\": $C102, \"text_nou\": \"C102 nou\", \"document_id\": 528, \"surse_doc_ids\": [528]},
   {\"op_id\": \"n\", \"fel\": \"noua\", \"text_cerinta\": \"N102\", \"document_id\": 528, \"surse_doc_ids\": [528]}], \"amprente\": {}}'),
   (21, 4, 'R4', '{\"operatii\": [{\"op_id\": \"n\", \"fel\": \"noua\", \"text_cerinta\": \"N4\"}]}')" >/dev/null
amprenta 20 "$C102"
refuz "are_loturi: RPC-ul refuză" service_role - "SELECT public.fn_ofertare_raspuns_set_aplica(20, ARRAY['m','n'], '$OWNER')" "aplicarea automată e blocată"
refuz "neinițializată: RPC-ul refuză" service_role - "SELECT public.fn_ofertare_raspuns_set_aplica(21, ARRAY['n'], '$OWNER')" "aplicarea automată e blocată"
q "ALTER TABLE public.ofertare_raspuns_set DISABLE TRIGGER a03_ofertare_raspuns_set_garda_loturi" >/dev/null
refuz "are_loturi FĂRĂ triggerul a03: garda din RPC refuză singură" service_role - "SELECT public.fn_ofertare_raspuns_set_aplica(20, ARRAY['m','n'], '$OWNER')" "aplicarea automată e blocată"
q "ALTER TABLE public.ofertare_raspuns_set ENABLE TRIGGER a03_ofertare_raspuns_set_garda_loturi" >/dev/null
asteapta "are_loturi: zero scrieri (cerințe, fotografie de acoperire, set)" \
  "$(q "SELECT (SELECT count(*) FROM public.ofertare_cerinte WHERE raspuns_set_id IN (20, 21))||'/'||(SELECT coalesce(acoperire_snapshot::text, 'NULL') FROM public.ofertare_cerinte WHERE id = $C102)||'/'||(SELECT coalesce(aplicat_la::text, 'NULL') FROM public.ofertare_raspuns_set WHERE id = 20)")" "0/NULL/NULL"

# ── concurență, cu sincronizare explicită pe pg_stat_activity ──────────────────────────────────────────
# asteapta_sesiune <application_name>: până când sesiunea din fundal execută pg_sleep (deci a trecut de pasul care ține lock-ul)
asteapta_sesiune() { local i; for i in $(seq 1 100); do
    [ "$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name = '$1' AND state = 'active' AND query LIKE '%pg_sleep%'")" = 1 ] && return 0
    sleep 0.1; done; esec "sesiunea $1 nu a ajuns la punctul de sincronizare"; }
claims_owner="{\"sub\":\"$OWNER\",\"role\":\"authenticated\"}"
# (a) setter-ul ÎNTÂI: trece licitația 5 pe are_loturi și ține tranzacția → RPC-ul așteaptă lock-ul și e refuzat, zero cerințe
q "INSERT INTO public.ofertare_raspuns_set(id, licitatie_id, titlu, propunere) VALUES (12, 5, 'R5', '{\"operatii\": [{\"op_id\": \"n\", \"fel\": \"noua\", \"text_cerinta\": \"N5\", \"document_id\": 51}]}')" >/dev/null
PGAPPNAME=rig_setter "${PSQL[@]}" -d "$BAZA" -At -c "SET SESSION AUTHORIZATION authenticator;" -c "BEGIN;" -c "SET LOCAL ROLE authenticated;" \
  -c "SELECT set_config('request.jwt.claims', '$claims_owner', true);" -c "SELECT public.fn_ofertare_licitatie_loturi_seteaza(5, 'are_loturi', '[{\"nr\":1,\"participam\":true}]');" \
  -c "SELECT pg_sleep(1.5);" -c "COMMIT;" >/tmp/rig_setter.out 2>&1 & BG=$!
asteapta_sesiune rig_setter; T0=$(date +%s%N)
o="$(CA_LINII=50 ca service_role - "SELECT public.fn_ofertare_raspuns_set_aplica(12, ARRAY['n'], '$OWNER')" || true)"
T1=$(date +%s%N); wait $BG || { cat /tmp/rig_setter.out; esec "setter în fundal"; }
[ $(( (T1 - T0) / 1000000 )) -ge 500 ] || esec "concurență (a): RPC-ul NU a așteptat lock-ul setter-ului ($(( (T1 - T0) / 1000000 )) ms)"
grep -q "aplicarea automată e blocată" <<<"$o" || esec "concurență (a): RPC-ul trebuia refuzat după trecerea pe are_loturi, primit: $o"
asteapta "concurență (a): setter-ul întâi → RPC-ul așteaptă, e refuzat, zero cerințe / acoperiri / set aplicat" \
  "$(q "SELECT (SELECT count(*) FROM public.ofertare_cerinte WHERE raspuns_set_id = 12)||'/'||(SELECT coalesce(aplicat_la::text, 'NULL') FROM public.ofertare_raspuns_set WHERE id = 12)")" "0/NULL"
# (b) RPC-ul ÎNTÂI (aplicare parțială, ține tranzacția) → setter-ul așteaptă commit-ul; după trecerea pe loturi restul e refuzat
q "INSERT INTO public.ofertare_raspuns_set(id, licitatie_id, titlu, propunere) VALUES (13, 6, 'R6', '{\"operatii\": [
   {\"op_id\": \"n1\", \"fel\": \"noua\", \"text_cerinta\": \"N6a\", \"document_id\": 61, \"surse_doc_ids\": [61]},
   {\"op_id\": \"n2\", \"fel\": \"noua\", \"text_cerinta\": \"N6b\", \"document_id\": 61, \"surse_doc_ids\": [61]}]}')" >/dev/null
PGAPPNAME=rig_rpc "${PSQL[@]}" -d "$BAZA" -At -c "SET SESSION AUTHORIZATION authenticator;" -c "BEGIN;" -c "SET LOCAL ROLE service_role;" \
  -c "SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);" -c "SELECT 'NOI=' || (public.fn_ofertare_raspuns_set_aplica(13, ARRAY['n1'], '$OWNER')->>'noi');" \
  -c "SELECT pg_sleep(1.5);" -c "COMMIT;" >/tmp/rig_rpc.out 2>&1 & BG=$!
asteapta_sesiune rig_rpc; T0=$(date +%s%N)
o="$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(6, 'are_loturi', '[{\"nr\":1,\"participam\":true}]')->>'ok'" || true)"
T1=$(date +%s%N); wait $BG || { cat /tmp/rig_rpc.out; esec "RPC în fundal"; }
[ $(( (T1 - T0) / 1000000 )) -ge 500 ] || esec "concurență (b): setter-ul NU a așteptat commit-ul RPC-ului ($(( (T1 - T0) / 1000000 )) ms)"
asteapta "concurență (b): RPC-ul întâi → setter-ul așteaptă commit-ul, apoi trece" "$o/$(grep -o '^NOI=.*' /tmp/rig_rpc.out)" "true/NOI=1"
asteapta "concurență (b): cerința din RPC e comisă, cu sursele ei" "$(q "SELECT surse_document_ids::text FROM public.ofertare_cerinte WHERE raspuns_set_id = 13")" "{61}"
refuz "aplicare parțială după trecerea pe loturi: restul setului refuzat" service_role - "SELECT public.fn_ofertare_raspuns_set_aplica(13, ARRAY['n2'], '$OWNER')" "aplicarea automată e blocată"
asteapta "aplicare parțială: nimic nou" "$(q "SELECT count(*) FROM public.ofertare_cerinte WHERE raspuns_set_id = 13")/$(q "SELECT stare FROM public.ofertare_raspuns_set WHERE id = 13")" "1/aplicat_partial"

# ── clarificarea automată REALĂ din planșe: sursele scrise odată cu textul ──────────────────────────────
q "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original, tip, analiza) VALUES
   (36, 3, 'P1 traseu.pdf', 'plansa', '{\"plansa\": {\"rezultat\": \"ilizibil\"}}'),
   (37, 3, 'F3 lista cantitati.xlsx', 'lista_cantitati', NULL)" >/dev/null
Q3=$(q "INSERT INTO public.ofertare_cantitati(licitatie_id, denumire) VALUES (3, 'teava PE 125') RETURNING id")
R=$(ca service_role - "SELECT public.ofertare_clarificare_planse_auto(3)::text")
asteapta "planse_auto: creată" "$(jq -r .actiune <<<"$R")" creat
asteapta "planse_auto: textul citează documentul financiar #37" "$(q "SELECT (intrebare LIKE '%documentul #37%')::text FROM public.ofertare_clarificari WHERE cheie = 'auto_planse_1'")" true
asteapta "planse_auto: surse = planșa ∪ documentul financiar citat (deși baza F3 nu-l listează), cantitățile din baza F3" \
  "$(q "SELECT surse_document_ids::text||'|'||surse_cantitati_ids::text FROM public.ofertare_clarificari WHERE cheie = 'auto_planse_1'")" "{36,37}|{$Q3}"
# ciorna protejată (editată de om): o planșă nouă schimbă doar `sursa`; sursele = reuniune, documentul financiar rămâne
q "UPDATE public.ofertare_clarificari SET baza_generare = baza_generare || '{\"text_editat_de\": \"om\"}' WHERE cheie = 'auto_planse_1'" >/dev/null
q "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original, tip, analiza) VALUES (38, 3, 'P2 detaliu.pdf', 'plansa', '{\"plansa\": {\"rezultat\": \"ilizibil\"}}')" >/dev/null
R=$(ca service_role - "SELECT public.ofertare_clarificare_planse_auto(3)::text")
asteapta "planse_auto protejată: de revizuit, surse = reuniune (planșa nouă + cele vechi + documentul financiar)" \
  "$(jq -r .actiune <<<"$R")/$(q "SELECT surse_document_ids::text FROM public.ofertare_clarificari WHERE cheie = 'auto_planse_1'")" "protejat_de_revizuit/{36,37,38}"
refuz "planse_auto: authenticated nu are drept" authenticated "$OWNER" "SELECT public.ofertare_clarificare_planse_auto(3)" "permission denied"

# ── revenire ───────────────────────────────────────────────────────────────────────────────────────────
o="$("${PSQL[@]}" -v ON_ERROR_STOP=0 -d "$BAZA" -f "$ROLLBACK" 2>&1 || true)"; grep -q "garda start invalida" <<<"$o" || esec "revenire nearmată fără ON_ERROR_STOP: $o"
asteapta "revenire nearmată, fără ON_ERROR_STOP / fără tranzacție: nimic schimbat" "$(trei)" "$N_APLICA/$N_PLANSE/$N_VALID"
# revenirea readuce RPC-ul vechi (fără garda internă): refuză dacă a03 nu e exact cea din 20261025a (Copilot r1 P1)
q "ALTER FUNCTION public.fn_ofertare_raspuns_set_garda_loturi() SECURITY INVOKER" >/dev/null
o="$(revenire || true)"; grep -q "garda a03 lipsește / e dezactivată / diferă" <<<"$o" || esec "revenire cu a03 modificată: $o"
asteapta "revenire cu garda a03 modificată: refuz, nimic schimbat" "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='ofertare_cerinte' AND column_name='surse_document_ids'")/$(trei)" "1/$N_APLICA/$N_PLANSE/$N_VALID"
q "ALTER FUNCTION public.fn_ofertare_raspuns_set_garda_loturi() SECURITY DEFINER" >/dev/null
q "ALTER TABLE public.ofertare_raspuns_set DISABLE TRIGGER a03_ofertare_raspuns_set_garda_loturi" >/dev/null
o="$(revenire || true)"; grep -q "garda a03 lipsește / e dezactivată / diferă" <<<"$o" || esec "revenire cu a03 dezactivată: $o"; ok "refuz: revenire cu garda a03 dezactivată"
q "ALTER TABLE public.ofertare_raspuns_set ENABLE TRIGGER a03_ofertare_raspuns_set_garda_loturi" >/dev/null
q "ALTER FUNCTION public.$SIG_PLANSE SECURITY INVOKER" >/dev/null
o="$(revenire || true)"; grep -q "revenire oprită" <<<"$o" || esec "revenire peste o funcție modificată: $o"
asteapta "revenire peste o funcție modificată ulterior: refuz, nimic schimbat" "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='ofertare_cerinte' AND column_name='surse_document_ids'")/$(md5f "$SIG_APLICA")" "1/$N_APLICA"
q "ALTER FUNCTION public.$SIG_PLANSE SECURITY DEFINER" >/dev/null
q "ALTER DATABASE $BAZA SET gazpet.revenire_20261026a = 'x'" >/dev/null
o="$(revenire || true)"; grep -q "armare persistenta interzisa" <<<"$o" || esec "armare persistentă: $o"; ok "refuz: armare persistentă"
q "ALTER DATABASE $BAZA RESET gazpet.revenire_20261026a" >/dev/null
SNAP=$(q "SELECT jsonb_agg(jsonb_build_object('id', id, 'surse_document_ids', surse_document_ids) ORDER BY id) FROM public.ofertare_cerinte WHERE surse_document_ids IS NOT NULL")
N_SURSE=$(q "SELECT count(*) FROM public.ofertare_cerinte WHERE surse_document_ids IS NOT NULL")
# o scriere de surse în curs (necomisă) când pornește revenirea: revenirea așteaptă, iar arhiva o conține (Jakarinos r1 P1 #3)
PGAPPNAME=rig_rev "${PSQL[@]}" -d "$BAZA" -At -c "BEGIN;" -c "UPDATE public.ofertare_cerinte SET surse_document_ids = '{31,34}' WHERE id = $CM;" \
  -c "SELECT pg_sleep(1.5);" -c "COMMIT;" >/tmp/rig_rev.out 2>&1 & BG=$!
asteapta_sesiune rig_rev; T0=$(date +%s%N)
revenire >/dev/null || { wait $BG; revenire; esec "revenire armată"; }
T1=$(date +%s%N); wait $BG || { cat /tmp/rig_rev.out; esec "scrierea concurentă"; }
[ $(( (T1 - T0) / 1000000 )) -ge 500 ] || esec "revenirea NU a așteptat scrierea concurentă ($(( (T1 - T0) / 1000000 )) ms)"
asteapta "revenire concurentă: arhiva = sursele de dinainte (per cerință) + scrierea comisă între timp" \
  "$(q "SELECT ((continut->'cerinte') @> '$SNAP'::jsonb)::text||'/'||((continut->'cerinte') @> '[{\"id\": $CM, \"surse_document_ids\": [31, 34]}]'::jsonb)::text||'/'||jsonb_array_length(continut->'cerinte') FROM public.ofertare_rigoare_arhiva_revenire")" "true/true/$((N_SURSE + 1))"
asteapta "revenire: coloana + triggerul scoase, garda a03 rămâne" \
  "$(q "SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name='ofertare_cerinte' AND column_name='surse_document_ids')||'|'||(SELECT count(*) FROM pg_trigger WHERE tgname='a02_ofertare_cerinte_surse')||'|'||(SELECT count(*) FROM pg_trigger WHERE tgname='a03_ofertare_raspuns_set_garda_loturi')")" "0|0|1"
asteapta "revenire: corpurile = versiunile de dinainte (md5)" "$(trei)" "$V_APLICA/$V_PLANSE/$V_VALID"
asteapta "revenire: arhiva fără drepturi API" "$(q "SELECT has_table_privilege('authenticated','public.ofertare_rigoare_arhiva_revenire','SELECT')::text||has_table_privilege('service_role','public.ofertare_rigoare_arhiva_revenire','SELECT')::text")" falsefalse
asteapta "revenire: drepturile funcțiilor păstrate" \
  "$(q "SELECT has_function_privilege('authenticated','public.$SIG_APLICA','EXECUTE')::text||has_function_privilege('service_role','public.$SIG_APLICA','EXECUTE')::text||has_function_privilege('service_role','public.$SIG_PLANSE','EXECUTE')::text")" falsetruetrue
o="$(livreaza || true)"; grep -q "nerestaurate" <<<"$o" || esec "re-livrare peste o arhivă nerestaurată: $o"
asteapta "dus-întors: re-livrarea refuză cât timp sursele arhivate nu sunt restaurate (Jakarinos r1 P1 #4)" "$(md5f "$SIG_APLICA")" "$V_APLICA"
# restaurarea controlată (în producție: preview + „da”) = O SINGURĂ tranzacție (Jakarinos r2 P2): marcajul arhivei, re-livrarea,
# punerea surselor înapoi și verificarea egalității cerință cu cerință — orice eșec anulează tot (arhiva rămâne nemarcată)
RESTAUREAZA="UPDATE public.ofertare_cerinte c SET surse_document_ids = ARRAY(SELECT jsonb_array_elements_text(e->'surse_document_ids')::bigint)
     FROM public.ofertare_rigoare_arhiva_revenire a, jsonb_array_elements(a.continut->'cerinte') e WHERE c.id = (e->>'id')::bigint;"
VERIFICA="DO \$v\$ BEGIN IF (SELECT jsonb_agg(jsonb_build_object('id', id, 'surse_document_ids', surse_document_ids) ORDER BY id) FROM public.ofertare_cerinte WHERE surse_document_ids IS NOT NULL)
  IS DISTINCT FROM (SELECT jsonb_agg(e ORDER BY (e->>'id')::bigint) FROM public.ofertare_rigoare_arhiva_revenire a, jsonb_array_elements(a.continut->'cerinte') e)
  THEN RAISE EXCEPTION 'restaurare: sursele diferă de arhivă'; END IF; END \$v\$;"
restaureaza() { "${PSQL[@]}" -d "$BAZA" --single-transaction \
  -c "UPDATE public.ofertare_rigoare_arhiva_revenire SET continut = continut || jsonb_build_object('restaurat_la', now());" \
  -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" -c "$1" -c "$VERIFICA" 2>&1; }
o="$(restaureaza "SELECT 1/0;" || true)"; grep -q "division by zero" <<<"$o" || esec "restaurare cu eșec: $o"
asteapta "restaurare cu eșec înainte de surse: tranzacția anulată integral (arhivă nemarcată, coloană absentă, corpuri vechi)" \
  "$(q "SELECT count(*) FROM public.ofertare_rigoare_arhiva_revenire WHERE continut ? 'restaurat_la'")/$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='ofertare_cerinte' AND column_name='surse_document_ids'")/$(md5f "$SIG_APLICA")" "0/0/$V_APLICA"
restaureaza "$RESTAUREAZA" >/dev/null || { restaureaza "$RESTAUREAZA"; esec "restaurare"; }
asteapta "dus-întors: restaurare atomică — arhivă marcată, sursele = arhiva cerință cu cerință (verificat în tranzacție)" \
  "$(q "SELECT count(*) FROM public.ofertare_rigoare_arhiva_revenire WHERE NOT (continut ? 'restaurat_la')")/$(q "SELECT count(*) FROM public.ofertare_cerinte WHERE surse_document_ids IS NOT NULL")" "0/$((N_SURSE + 1))"
asteapta "dus-întors: corpurile noi + control 0e" "$(trei)/$(q "$(cat "$CONTROL_0E")" | wc -l | tr -d ' ')" "$N_APLICA/$N_PLANSE/$N_VALID/0"
echo PASS
