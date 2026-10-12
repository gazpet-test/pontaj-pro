#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261025a_ofertare_provenienta_derivate (surse_* pe clarificări / cantități + validare + transfer planșă).
# PostgreSQL 16 local dedicat (/tmp/pg_provenienta, 127.0.0.1:5448), peste scheletul loturi + 20261024b. Nu atinge producția.
# Rulează în GitHub Actions (ofertare-regresie, job „provenienta”, decizia B Răzvan 12.10.2026) — nimic instalat pe server.
# Acoperă: garda de livrare · precondiția md5 pe RPC-ul de transfer · aplicare + postcondiții · control 0e · validarea la scriere
# (authenticated / service_role, aceeași licitație, NULL, normalizare, listă goală) · derivarea surselor pe clarificarea automată ·
# RPC-ul de transfer (update ∪ planșă, insert = {planșă}, drepturi) · revenire (nearmată / persistentă / armată, arhivă, md5 RPC) ·
# dus-întors.
# Utilizare: bash scripts/test_ofertare_provenienta_derivate.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR=/tmp/pg_provenienta; PORT=5448; BAZA=ofertare_loturi_test
NUME=20261025a_ofertare_provenienta_derivate
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
NUME_LOTURI=20261024b_ofertare_loturi_mvp
MIGRARE_LOTURI="$RADACINA/supabase/migrations/$NUME_LOTURI.sql"
SCHELET_LOTURI="$RADACINA/supabase/tests/ofertare_loturi_mvp_schelet.sql"
SCHELET="$RADACINA/supabase/tests/ofertare_provenienta_schelet.sql"
CONTROL_0E="$RADACINA/scripts/control_0e.sql"
MD5_RPC=c00ba5566c7d231ef7eefe926a8ed56a; MD5_RPC_NOU=c85560253e98dad428ca19ff147ac4b1
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_provenienta" ] || mediu "$DATE_DIR există și nu e fixture — nu îl șterg"
  [ -f "$DATE_DIR/postmaster.pid" ] && { ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; }
  rm -rf "$DATE_DIR"
fi
mkdir -p "$DATE_DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_provenienta"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_provenienta.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET_LOTURI" >/dev/null || esec "schelet loturi"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME_LOTURI:' || txid_current(), true);" \
  -f "$MIGRARE_LOTURI" >/dev/null || esec "livrare 20261024b (bază)"
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null || esec "schelet proveniență"

OWNER=00000000-0000-4000-8000-000000000121; EDIT=00000000-0000-4000-8000-000000000007; FARA=00000000-0000-4000-8000-000000000099
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
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -v ON_ERROR_STOP=1 -c "SELECT set_config('gazpet.revenire_20261025a', 'OFERTARE_PROVENIENTA_REVENIRE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1; }
md5rpc() { q "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)')"; }

# ── livrare ────────────────────────────────────────────────────────────────────────────────────────────
asteapta "scheletul are RPC-ul de transfer identic cu producția (md5)" "$(md5rpc)" "$MD5_RPC"
python3 "$RADACINA/scripts/livrare_validator.py" "$MIGRARE" >/dev/null || esec "validatorul de livrare refuză migrarea"; ok "validator livrare"
o="$("${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" 2>&1 || true)"; grep -q "garda de livrare (start)" <<<"$o" || esec "fără gardă: $o"
asteapta "fără gardă: nicio urmă" "$(q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name LIKE 'surse\_%'")" 0
ok "refuz: migrare fără gardă"
# precondiția pe corpul RPC-ului: o versiune schimbată nu e suprascrisă
q "ALTER FUNCTION public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb) RENAME TO ofertare_transfer_plansa_cantitati_orig" >/dev/null
q "CREATE FUNCTION public.ofertare_transfer_plansa_cantitati(p_doc_id bigint, p_rulare text, p_randuri jsonb) RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb'" >/dev/null
o="$(livreaza || true)"; grep -q "diferă de versiunea citită" <<<"$o" || esec "md5 RPC schimbat: $o"; ok "refuz: RPC de transfer modificat față de versiunea citită"
q "DROP FUNCTION public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)" >/dev/null
q "ALTER FUNCTION public.ofertare_transfer_plansa_cantitati_orig(bigint,text,jsonb) RENAME TO ofertare_transfer_plansa_cantitati" >/dev/null
asteapta "RPC original restaurat" "$(md5rpc)" "$MD5_RPC"
# același corp, atribut schimbat (Copilot r1 P1 #2): SECURITY INVOKER nu trece de precondiție
q "ALTER FUNCTION public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb) SECURITY INVOKER" >/dev/null
o="$(livreaza || true)"; grep -q "diferă de versiunea citită" <<<"$o" || esec "RPC SECURITY INVOKER: $o"; ok "refuz: RPC cu același corp dar SECURITY INVOKER"
q "ALTER FUNCTION public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb) SECURITY DEFINER" >/dev/null
q "GRANT EXECUTE ON FUNCTION public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb) TO authenticated" >/dev/null
o="$(livreaza || true)"; grep -q "diferă de versiunea citită" <<<"$o" || esec "RPC cu ACL lărgit: $o"; ok "refuz: RPC cu același corp dar ACL lărgit"
q "REVOKE EXECUTE ON FUNCTION public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb) FROM authenticated" >/dev/null
livreaza >/dev/null || { livreaza; esec "livrare"; }; ok "livrare cu gardă"
o="$(livreaza || true)"; grep -q "Precondiție 20261025a" <<<"$o" || esec "reaplicare: $o"; ok "refuz: reaplicare"
asteapta "control 0e (0 funcții expuse cu set_config/execute/…)" "$(q "$(cat "$CONTROL_0E")" | wc -l | tr -d ' ')" 0
asteapta "datele existente rămân fără surse" "$(q "SELECT count(*) FROM public.ofertare_cantitati WHERE surse_document_ids IS NOT NULL")" 0
asteapta "RPC nou: corpul așteptat (md5 fără CR)" "$(md5rpc)" "$MD5_RPC_NOU"
asteapta "drepturi RPC transfer neschimbate (auth/anon/service)" \
  "$(q "SELECT has_function_privilege('authenticated','public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)','EXECUTE')::text||has_function_privilege('anon','public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)','EXECUTE')::text||has_function_privilege('service_role','public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)','EXECUTE')::text")" falsefalsetrue

# ── validarea la scriere: clarificări ─────────────────────────────────────────────────────────────────
asteapta "editor: surse din aceeași licitație, normalizate (sortate, fără duplicate), cerințe nevăzute prin RLS" \
  "$(ca authenticated "$EDIT" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, origine, surse_cerinte_ids, surse_document_ids) VALUES (102, 'Q1', 'platforma', '{2,1,2}', '{528,527}') RETURNING surse_cerinte_ids::text||'|'||surse_document_ids::text")" "{1,2}|{527,528}"
refuz "cerință din altă licitație" authenticated "$EDIT" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, origine, surse_cerinte_ids) VALUES (102, 'Q2', 'platforma', '{3}')" "nu există în licitația"
refuz "document din altă licitație" authenticated "$EDIT" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, origine, surse_document_ids) VALUES (102, 'Q3', 'platforma', '{31}')" "nu există în licitația"
refuz "cantitate inexistentă" authenticated "$EDIT" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, origine, surse_cantitati_ids) VALUES (102, 'Q4', 'platforma', '{424242}')" "nu există în licitația"
refuz "NULL în listă" authenticated "$EDIT" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, origine, surse_document_ids) VALUES (102, 'Q5', 'platforma', '{527,NULL}')" "fără NULL"
refuz "service_role: tot validat" service_role - "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, origine, surse_cerinte_ids) VALUES (102, 'Q6', 'platforma', '{3}')" "nu există în licitația"
asteapta "listă goală → NULL (= fără proveniență)" \
  "$(ca service_role - "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, origine, surse_document_ids) VALUES (102, 'Q7', 'platforma', '{}') RETURNING coalesce(surse_document_ids::text, 'NULL')")" NULL
refuz "mutarea clarificării cu surse în altă licitație" authenticated "$EDIT" "UPDATE public.ofertare_clarificari SET licitatie_id = 3 WHERE intrebare = 'Q1'" "nu există în licitația"
refuz "fără modul Ofertare: nimic (RLS)" authenticated "$FARA" "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, origine) VALUES (102, 'Q8', 'platforma')" "row-level security"
o="$(q "SELECT public.fn_ofertare_surse_valideaza()" 2>&1 || true)"; grep -q "trigger" <<<"$o" || esec "apel direct al funcției de trigger: $o"; ok "refuz: funcția de validare nu se poate chema direct"
refuz "funcția de validare nu e expusă (authenticated)" authenticated "$OWNER" "SELECT public.fn_ofertare_surse_valideaza()" "permission denied"

# ── clarificarea automată din planșe: sursele se derivă ─────────────────────────────────────────────────
q "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, origine, cheie, sursa, baza_generare) VALUES (102, 'AUTO', 'automat', 'auto_planse_x',
   'planse_auto:528,527,gen_0123456789ab,ev_0123456789ab', '{\"documente\":[{\"id\":1247},{\"id\":\"x\"}],\"randuri\":[{\"id\":1},{\"id\":99999}]}')" >/dev/null
asteapta "automat: documente = planșe ∪ baza.documente; cantități = baza.randuri (ID dispărut păstrat, fără refuz)" \
  "$(q "SELECT surse_document_ids::text||'|'||surse_cantitati_ids::text FROM public.ofertare_clarificari WHERE cheie='auto_planse_x'")" "{527,528,1247}|{1,99999}"
q "UPDATE public.ofertare_clarificari SET status='retrasa' WHERE cheie='auto_planse_x'" >/dev/null
asteapta "automat: schimbarea stării nu rederivă" "$(q "SELECT surse_document_ids::text FROM public.ofertare_clarificari WHERE cheie='auto_planse_x'")" "{527,528,1247}"
q "UPDATE public.ofertare_clarificari SET sursa='planse_auto:1302,gen_0123456789ab', baza_generare='{}' WHERE cheie='auto_planse_x'" >/dev/null
asteapta "automat: sursa nouă → surse rederivate" "$(q "SELECT surse_document_ids::text||'|'||coalesce(surse_cantitati_ids::text,'NULL') FROM public.ofertare_clarificari WHERE cheie='auto_planse_x'")" "{1302}|NULL"
o="$(q "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, origine, cheie, sursa, baza_generare) VALUES (102, 'AUTO2', 'automat', 'auto_planse_y', 'planse_auto:528', '{\"documente\":[{\"id\":31}]}')" 2>&1 || true)"
grep -q "nu există în licitația" <<<"$o" || esec "automat cu document din altă licitație: $o"; ok "refuz: automat — ID existent în ALTĂ licitație (Copilot r1 P1 #1), doar cel dispărut se păstrează"
asteapta "platformă: surse nederivate din text" \
  "$(q "INSERT INTO public.ofertare_clarificari(licitatie_id, intrebare, origine, sursa) VALUES (102, 'PF', 'platforma', 'planse_auto:527') RETURNING coalesce(surse_document_ids::text,'NULL')")" NULL

# ── cantități + RPC-ul de transfer ─────────────────────────────────────────────────────────────────────
refuz "cantitate: document din altă licitație (service_role)" service_role - "INSERT INTO public.ofertare_cantitati(licitatie_id, denumire, surse_document_ids) VALUES (102, 'x', '{31}')" "nu există în licitația"
asteapta "cantitate extrasă: surse proprii" "$(ca service_role - "INSERT INTO public.ofertare_cantitati(licitatie_id, denumire, surse_document_ids) VALUES (102, 'teava PE 63', '{1247}') RETURNING surse_document_ids::text")" "{1247}"
q "UPDATE public.ofertare_documente_atribuire SET analiza='{\"citire_ai\":{\"transfer\":{\"rulare\":\"r1\",\"stare\":\"in_curs\"}}}' WHERE id IN (528, 1302)" >/dev/null
ID63=$(q "SELECT id FROM public.ofertare_cantitati WHERE denumire='teava PE 63'")   # secvența a avansat la inserarea refuzată
OPS='[{"op":"update","id":1,"patch":{"cantitate_plansa":120,"diferenta_nota":"planșa 528"}},{"op":"update","id":'"$ID63"',"patch":{"cantitate_plansa":63}},{"op":"insert","row":{"denumire":"teava PE 90","um":"m","cantitate_plansa":90,"sursa":"Planșa 2"}}]'
refuz "transfer: authenticated nu are drept" authenticated "$OWNER" "SELECT public.ofertare_transfer_plansa_cantitati(528, 'r1', '$OPS')" "permission denied"
asteapta "transfer (service_role): 2 actualizate + 1 adăugată" "$(ca service_role - "SELECT (public.ofertare_transfer_plansa_cantitati(528, 'r1', '$OPS'))::text")" '{"ok": true, "adaugate": 1, "actualizate": 2, "sarite_existente": 0}'
asteapta "transfer: update fără surse → {planșa}; update cu surse → surse ∪ planșa; insert → {planșa}" \
  "$(q "SELECT string_agg(denumire||'='||surse_document_ids::text, ' ' ORDER BY id) FROM public.ofertare_cantitati")" "teava PE 110={528} teava PE 63={528,1247} teava PE 90={528}"
OPS2='[{"op":"update","id":1,"patch":{"cantitate_plansa":121}}]'
ca service_role - "SELECT public.ofertare_transfer_plansa_cantitati(1302, 'r1', '$OPS2')" >/dev/null
asteapta "transfer cu altă planșă: reuniune, fără duplicate" "$(q "SELECT surse_document_ids::text FROM public.ofertare_cantitati WHERE id=1")" "{528,1302}"
ca service_role - "SELECT public.ofertare_transfer_plansa_cantitati(1302, 'r1', '$OPS2')" >/dev/null
asteapta "lease consumat: a doua rulare nu scrie" "$(q "SELECT surse_document_ids::text FROM public.ofertare_cantitati WHERE id=1")" "{528,1302}"

# ── revenire ───────────────────────────────────────────────────────────────────────────────────────────
o="$("${PSQL[@]}" -v ON_ERROR_STOP=0 -d "$BAZA" -f "$ROLLBACK" 2>&1 || true)"; grep -q "garda start invalida" <<<"$o" || esec "revenire nearmată fără ON_ERROR_STOP: $o"
asteapta "revenire nearmată, fără ON_ERROR_STOP / fără tranzacție: RPC neatins (Copilot r1 P1 #3)" "$(md5rpc)" "$MD5_RPC_NOU"
q "ALTER FUNCTION public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb) SECURITY INVOKER" >/dev/null
o="$(revenire || true)"; grep -q "revenire oprita" <<<"$o" || esec "revenire peste RPC modificat: $o"
asteapta "revenire peste un RPC modificat ulterior: refuz, nimic schimbat" "$(q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name LIKE 'surse\_%'")" 4
q "ALTER FUNCTION public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb) SECURITY DEFINER" >/dev/null
o="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" 2>&1 || true)"; grep -q "garda start invalida" <<<"$o" || esec "revenire nearmată: $o"
asteapta "revenire nearmată: nimic schimbat" "$(q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name LIKE 'surse\_%'")" 4
ok "refuz: revenire nearmată"
q "ALTER DATABASE $BAZA SET gazpet.revenire_20261025a = 'x'" >/dev/null
o="$(revenire || true)"; grep -q "armare persistenta interzisa" <<<"$o" || esec "armare persistentă: $o"; ok "refuz: armare persistentă"
q "ALTER DATABASE $BAZA RESET gazpet.revenire_20261025a" >/dev/null
revenire >/dev/null || { revenire; esec "revenire armată"; }
asteapta "revenire: coloane + funcție + triggere scoase" \
  "$(q "SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name LIKE 'surse\_%')||'|'||(to_regprocedure('public.fn_ofertare_surse_valideaza()') IS NULL)::text||'|'||(SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'a02_ofertare_%_surse')")" "0|true|0"
asteapta "revenire: RPC-ul de transfer = corpul de dinainte (md5)" "$(md5rpc)" "$MD5_RPC"
asteapta "revenire: drepturile RPC păstrate" "$(q "SELECT has_function_privilege('authenticated','public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)','EXECUTE')::text||has_function_privilege('service_role','public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)','EXECUTE')::text")" falsetrue
asteapta "revenire: arhiva păstrează sursele" "$(q "SELECT jsonb_array_length(continut->'clarificari')||'/'||jsonb_array_length(continut->'cantitati') FROM public.ofertare_provenienta_arhiva_revenire")" "2/3"
asteapta "revenire: arhiva fără drepturi API" "$(q "SELECT has_table_privilege('authenticated','public.ofertare_provenienta_arhiva_revenire','SELECT')::text||has_table_privilege('service_role','public.ofertare_provenienta_arhiva_revenire','SELECT')::text")" falsefalse
livreaza >/dev/null || { livreaza; esec "dus-întors"; }; ok "dus-întors: re-livrare după revenire"
asteapta "dus-întors: control 0e" "$(q "$(cat "$CONTROL_0E")" | wc -l | tr -d ' ')" 0
echo PASS
