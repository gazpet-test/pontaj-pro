#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261024b_ofertare_loturi_mvp (loturi licitație + stare document + poarta unică „document eligibil”).
# PostgreSQL 16 local dedicat (/tmp/pg_loturi, 127.0.0.1:5447). Nu atinge producția.
# Acoperă: garda de livrare · aplicare + postcondiții · fail-closed (neinițializat) · gărzi pe scriere directă (authenticated,
# service_role, INSERT) · drepturi RPC (anon / service_role / editor fără responsabilitate) · responsabil / owner / admin ·
# triere + poarta pe toate motivele · integritate (lot inexistent, documente din licitații diferite, FK RESTRICT, are_loturi→
# fara_loturi cu alocări) · jurnal · parse_lot · view · control 0e · revenire (nearmată / persistentă / armată, arhivă) · dus-întors.
# Utilizare: bash scripts/test_ofertare_loturi_mvp.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR=/tmp/pg_loturi; PORT=5447; BAZA=ofertare_loturi_test
NUME=20261024b_ofertare_loturi_mvp
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/ofertare_loturi_mvp_schelet.sql"
CONTROL_0E="$RADACINA/scripts/control_0e.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_loturi" ] || mediu "$DATE_DIR există și nu e fixture — nu îl șterg"
  [ -f "$DATE_DIR/postmaster.pid" ] && { ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; }
  rm -rf "$DATE_DIR"
fi
mkdir -p "$DATE_DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_loturi"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_loturi.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null || esec "schelet"

OWNER=00000000-0000-4000-8000-000000000121; RESP=00000000-0000-4000-8000-000000000043
EDIT=00000000-0000-4000-8000-000000000007;  ADMIN=00000000-0000-4000-8000-000000000008
FARA=00000000-0000-4000-8000-000000000099

q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
# ca <rol> <uid|-> <sql> : rulează ca PostgREST (session_user = authenticator, SET LOCAL ROLE + request.jwt.claims), întoarce ultima linie
ca() {
  local claims
  if [ "$2" = - ]; then claims="{\"role\":\"$1\"}"; else claims="{\"sub\":\"$2\",\"role\":\"$1\"}"; fi
  "${PSQL[@]}" -d "$BAZA" -At -c "SET SESSION AUTHORIZATION authenticator;" -c "BEGIN;" -c "SET LOCAL ROLE $1;" \
    -c "SELECT set_config('request.jwt.claims', '$claims', true);" -c "$3" -c "COMMIT;" 2>&1 | grep -v '^BEGIN$\|^SET$\|^COMMIT$' | tail -"${CA_LINII:-1}"
}
asteapta() { [ "$2" = "$3" ] || esec "$1: așteptat «$3», primit «$2»"; ok "$1"; }
refuz() { local o; o="$(CA_LINII=50 ca "$2" "$3" "$4" || true)"; grep -q "$5" <<<"$o" || esec "$1 trebuia refuzat ($5), primit: $o"; ok "refuz: $1"; }
elig() { q "SELECT string_agg(document_id||':'||motiv, ' ' ORDER BY document_id) FROM public.fn_ofertare_eligibilitate($1)"; }
livreaza() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1; }
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261024b', 'OFERTARE_LOTURI_REVENIRE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1; }

# ── livrare ────────────────────────────────────────────────────────────────────────────────────────────
python3 "$RADACINA/scripts/livrare_validator.py" "$MIGRARE" >/dev/null || esec "validatorul de livrare refuză migrarea"; ok "validator livrare"
o="$("${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" 2>&1 || true)"; grep -q "garda de livrare (start)" <<<"$o" || esec "fără gardă: $o"
[ "$(q "SELECT to_regclass('public.ofertare_licitatie_loturi') IS NULL")" = t ] || esec "fără gardă a lăsat urme"; ok "refuz: migrare fără gardă"
livreaza >/dev/null || { livreaza; esec "livrare"; }; ok "livrare cu gardă"
o="$(livreaza || true)"; grep -q "Precondiție 20261024b" <<<"$o" || esec "reaplicare: $o"; ok "refuz: reaplicare"
asteapta "control 0e (0 funcții expuse cu set_config/execute/…)" "$(q "$(cat "$CONTROL_0E")" | wc -l | tr -d ' ')" 0

# ── fail-closed implicit ───────────────────────────────────────────────────────────────────────────────
asteapta "neinițializat: TOTUL blocat, inclusiv fișa de date" "$(elig 102)" \
  "527:loturi_neinitializate 528:loturi_neinitializate 532:loturi_neinitializate 1247:loturi_neinitializate 1302:loturi_neinitializate"
ca authenticated "$EDIT" "UPDATE public.ofertare_documente_atribuire SET tip='fisa_date' WHERE id=1302" >/dev/null
asteapta "tip schimbat în fisa_date NU ocolește poarta (Copilot r1)" "$(q "SELECT motiv FROM public.fn_ofertare_eligibilitate(102, 1302)")" loturi_neinitializate
asteapta "document inexistent = neeligibil" "$(q "SELECT public.fn_ofertare_document_eligibil(999999)->>'motiv'")" document_inexistent

# ── gărzi pe scriere directă ───────────────────────────────────────────────────────────────────────────
refuz "UPDATE lot_stare (editor Ofertare)" authenticated "$EDIT" "UPDATE public.ofertare_documente_atribuire SET lot_stare='comun' WHERE id=1247" "doar din trierea"
refuz "UPDATE lot_stare (service_role)" service_role - "UPDATE public.ofertare_documente_atribuire SET lot_stare='comun' WHERE id=1247" "doar din trierea"
refuz "INSERT document deja comun (service_role)" service_role - "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, lot_stare) VALUES (7001, 102, 'comun')" "doar din trierea"
asteapta "INSERT document normal (service_role) pornește necunoscut" \
  "$(ca service_role - "INSERT INTO public.ofertare_documente_atribuire(id, licitatie_id, nume_original) VALUES (7002, 102, 'nou.pdf') RETURNING lot_stare")" necunoscut
refuz "UPDATE stare_loturi (owner direct)" authenticated "$OWNER" "UPDATE public.ofertare_licitatii SET stare_loturi='fara_loturi' WHERE id=102" "doar din RPC"
refuz "INSERT direct în ofertare_document_loturi (owner)" authenticated "$OWNER" "INSERT INTO public.ofertare_document_loturi VALUES (1247, 102, 2)" "permission denied"
asteapta "service_role: termen_depunere tot merge (trigger a00 neatins)" \
  "$(ca service_role - "UPDATE public.ofertare_licitatii SET termen_depunere='2026-10-30 13:00+00' WHERE id=102 RETURNING id")" 102

# ── drepturi pe RPC ────────────────────────────────────────────────────────────────────────────────────
L='[{"nr":1,"denumire":"Cosula-Saveni"},{"nr":2,"denumire":"Saveni-Darabani","participam":true},{"nr":3,"denumire":"Stauceni-Stefanesti","participam":true,"valoare":1000.5},{"nr":4,"denumire":"Dorohoi-Darabani","participam":false}]'
refuz "RPC loturi: anon" anon - "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '$L')" "permission denied"
refuz "RPC loturi: service_role" service_role - "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '$L')" "permission denied"
refuz "RPC loturi: editor Ofertare nerespons." authenticated "$EDIT" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '$L')" "Doar owner-ul"
refuz "RPC loturi: fără modul" authenticated "$FARA" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '$L')" "Doar owner-ul"
refuz "RPC triere: editor Ofertare nerespons." authenticated "$EDIT" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[1247]::bigint[], 'comun')" "Doar owner-ul"
refuz "RPC loturi: are_loturi fără listă" authenticated "$RESP" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '[]')" "cel puțin un lot"
refuz "RPC loturi: lot dublat" authenticated "$RESP" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '[{\"nr\":2},{\"nr\":2}]')" "de două ori"
refuz "RPC loturi: nr 0" authenticated "$RESP" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '[{\"nr\":0}]')" "invalid"
refuz "RPC loturi: valoare nenumerică (Copilot r1)" authenticated "$RESP" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '[{\"nr\":2,\"valoare\":\"abc\"}]')" "valoare trebuie"
refuz "RPC loturi: valoare negativă" authenticated "$RESP" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '[{\"nr\":2,\"valoare\":-5}]')" "negativă"
refuz "RPC loturi: nr text" authenticated "$RESP" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '[{\"nr\":\"2\"}]')" "numeric"
refuz "RPC triere: comun pe licitație neinițializată" authenticated "$RESP" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[1247]::bigint[], 'comun')" "are loturi"

# ── responsabilul setează loturile ─────────────────────────────────────────────────────────────────────
asteapta "responsabil: are_loturi 1-4, participăm 2+3" \
  "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '$L')->>'loturi'")" 4
asteapta "stare + audit pe licitație" "$(q "SELECT stare_loturi||'|'||stare_loturi_setat_de FROM public.ofertare_licitatii WHERE id=102")" "are_loturi|$RESP"
asteapta "loturi salvate" "$(q "SELECT string_agg(nr||':'||participam||':'||coalesce(valoare::text,'-'), ' ' ORDER BY nr) FROM public.ofertare_licitatie_loturi WHERE licitatie_id=102")" \
  "1:false:- 2:true:- 3:true:1000.5 4:false:-"
asteapta "după loturi: tot netriatul e blocat (de_triat)" "$(elig 102)" \
  "527:de_triat 528:de_triat 532:de_triat 1247:de_triat 1302:de_triat 7002:de_triat"

# ── trierea ────────────────────────────────────────────────────────────────────────────────────────────
asteapta "triere: 1247 + 1302 comune" "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[1247,1302]::bigint[], 'comun', '{}', 'PT FV comun tuturor')->>'documente'")" 2
asteapta "triere: 528 → lot 2" "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[528]::bigint[], 'alocat', '{2}')->>'documente'")" 1
asteapta "triere: 527 → lot 1" "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[527]::bigint[], 'alocat', '{1}')->>'documente'")" 1
asteapta "poarta pe toate motivele" "$(elig 102)" \
  "527:in_afara_loturilor 528:lot_participam 532:de_triat 1247:comun 1302:comun 7002:de_triat"
asteapta "proveniență pe document" "$(q "SELECT lot_stare||'|'||lot_sursa||'|'||lot_setat_de||'|'||lot_nota FROM public.ofertare_documente_atribuire WHERE id=1247")" \
  "comun|manual|$RESP|PT FV comun tuturor"
asteapta "view numărătoare" "$(q "SELECT documente||'/'||procesabile||'/'||in_afara_loturilor||'/'||de_triat||'/'||blocate_alt_motiv FROM public.v_ofertare_loturi_triere WHERE licitatie_id=102")" "6/3/1/2/0"
o="$(q "UPDATE public.ofertare_documente_atribuire SET licitatie_id=3 WHERE id=1247" 2>&1 || true)"; grep -q "e triat pe loturi" <<<"$o" || esec "mutare document triat: $o"; ok "refuz: document triat mutat în altă licitație (chiar și postgres, Copilot r1)"
refuz "triere: lot inexistent 7" authenticated "$RESP" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[7002]::bigint[], 'alocat', '{7}')" "inexistente"
refuz "triere: documente din licitații diferite" authenticated "$OWNER" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[7002,31]::bigint[], 'comun')" "aceeași licitație"
refuz "triere: document inexistent" authenticated "$RESP" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[424242]::bigint[], 'comun')" "nu există"
refuz "triere: alocat fără loturi" authenticated "$RESP" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[7002]::bigint[], 'alocat', '{}')" "cel puțin un lot"
refuz "triere: comun cu loturi" authenticated "$RESP" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[7002]::bigint[], 'comun', '{2}')" "doar cu alocat"
refuz "loturi: scoaterea lotului 1 cu document alocat (FK RESTRICT)" authenticated "$RESP" \
  "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '[{\"nr\":2,\"participam\":true},{\"nr\":3,\"participam\":true}]')" "foreign key"
refuz "loturi: are_loturi → fara_loturi cu alocări" authenticated "$RESP" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'fara_loturi')" "întâi se resetează"
asteapta "selecția se schimbă (doar lot 3): 528 iese din procesare" \
  "$(ca authenticated "$ADMIN" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '[{\"nr\":1},{\"nr\":2},{\"nr\":3,\"participam\":true},{\"nr\":4}]')->>'ok'")" true
asteapta "poarta după schimbare (admin Ofertare)" "$(q "SELECT motiv FROM public.fn_ofertare_eligibilitate(102, 528)")" in_afara_loturilor
asteapta "resetare 527 la necunoscut (owner)" "$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_documente_lot_seteaza(ARRAY[527]::bigint[], 'necunoscut')->>'stare'")" necunoscut
asteapta "resetarea curăță proveniența + legăturile" "$(q "SELECT lot_stare||'|'||coalesce(lot_sursa,'-')||'|'||(SELECT count(*) FROM public.ofertare_document_loturi WHERE document_id=527) FROM public.ofertare_documente_atribuire WHERE id=527")" "necunoscut|-|0"
asteapta "jurnal: 2 licitație + 5 document (1247, 1302, 528, 527, reset 527)" "$(q "SELECT count(*) FILTER (WHERE actiune='licitatie_loturi')||'+'||count(*) FILTER (WHERE actiune='document_lot') FROM public.ofertare_loturi_jurnal")" "2+5"
asteapta "jurnal păstrează vechiul" "$(q "SELECT vechi->>'stare'||'>'||(nou->>'stare') FROM public.ofertare_loturi_jurnal WHERE document_id=527 ORDER BY id DESC LIMIT 1")" "alocat>necunoscut"
asteapta "fără participare: totul blocat (nicio_participare)" \
  "$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '[{\"nr\":1},{\"nr\":2},{\"nr\":3},{\"nr\":4}]')->>'ok'")" true
asteapta "  … motive" "$(q "SELECT string_agg(DISTINCT motiv, ',') FROM public.fn_ofertare_eligibilitate(102)")" nicio_participare
asteapta "licitație fără loturi (owner): totul trece" "$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_licitatie_loturi_seteaza(3, 'fara_loturi')->>'stare'")" fara_loturi
asteapta "  … poarta" "$(q "SELECT eligibil||':'||motiv FROM public.fn_ofertare_eligibilitate(3)")" "true:fara_loturi"
asteapta "un document (jsonb, service_role)" "$(ca service_role - "SELECT public.fn_ofertare_document_eligibil(31)::text")" '{"motiv": "fara_loturi", "eligibil": true, "licitatie_id": 3}'
refuz "eligibilitate: anon" anon - "SELECT public.fn_ofertare_document_eligibil(31)" "permission denied"
refuz "marcajul RPC nu e expus (authenticated)" authenticated "$OWNER" "SELECT public.fn_ofertare_loturi_rpc_marcaj(true)" "permission denied"
asteapta "tabele noi: editorul vede, cel fără modul nu" \
  "$(ca authenticated "$EDIT" "SELECT count(*) FROM public.ofertare_licitatie_loturi")/$(ca authenticated "$FARA" "SELECT count(*) FROM public.ofertare_licitatie_loturi")" "4/0"

# ── parse_lot ──────────────────────────────────────────────────────────────────────────────────────────
pl() { q "SELECT public.fn_ofertare_parse_lot($1)::text"; }
asteapta "parse: Lot 12"          "$(pl "'Lot 12'")"          '{"loturi": [12], "domeniu": "lista"}'
asteapta "parse: LOT2"            "$(pl "'LOT2'")"            '{"loturi": [2], "domeniu": "lista"}'
asteapta "parse: Lot 1, Lot 2"    "$(pl "'Lot 1, Lot 2'")"    '{"loturi": [1, 2], "domeniu": "lista"}'
asteapta "parse: 1,2,3"           "$(pl "'1,2,3'")"           '{"loturi": [1, 2, 3], "domeniu": "lista"}'
asteapta "parse: loturile 1 și 3" "$(pl "'loturile 1 și 3'")" '{"loturi": [1, 3], "domeniu": "lista"}'
asteapta "parse: 1-3"             "$(pl "'1-3'")"             '{"loturi": [1, 2, 3], "domeniu": "lista"}'
asteapta "parse: toate"           "$(pl "'Toate'")"           '{"loturi": [], "domeniu": "toate"}'
asteapta "parse: NULL"            "$(pl NULL)"                '{"loturi": [], "domeniu": "necunoscut"}'
asteapta "parse: gol"             "$(pl "'  '")"              '{"loturi": [], "domeniu": "necunoscut"}'
asteapta "parse: text liber"      "$(pl "'tronsonul Saveni'")" '{"loturi": [], "domeniu": "necunoscut"}'
asteapta "parse: 3-1 (invers)"    "$(pl "'3-1'")"             '{"loturi": [], "domeniu": "necunoscut"}'
asteapta "parse: 0"               "$(pl "'0'")"               '{"loturi": [], "domeniu": "necunoscut"}'
asteapta "parse: 1-100 (prea mare)" "$(pl "'1-100'")"         '{"loturi": [], "domeniu": "necunoscut"}'
asteapta "parse: 1-50 (limita)" "$(pl "'1-50'" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["domeniu"],len(d["loturi"]))')" "lista 50"
asteapta "parse: 1-51 (peste limită)" "$(pl "'1-51'")" '{"loturi": [], "domeniu": "necunoscut"}'
q "UPDATE public.ofertare_cerinte SET lot_domeniu='lista', lot_nr='{}' WHERE id=1" >/dev/null
asteapta "lot canonic: listă goală → necunoscut explicit (trigger înaintea CHECK)" "$(q "SELECT lot_domeniu||'|'||lot_sursa FROM public.ofertare_cerinte WHERE id=1")" "necunoscut|invalidat_lot_inexistent"
o="$(q "UPDATE public.ofertare_cantitati SET lot_domeniu='toate', lot_nr='{1}' WHERE id=1" 2>&1 || true)"; grep -q ofertare_cantitati_lot_nr_coerent <<<"$o" || esec "CHECK lot canonic cantități: $o"; ok "refuz: CHECK lot canonic incoerent (toate + listă)"
q "UPDATE public.ofertare_cerinte SET lot_domeniu='lista', lot_nr='{2}', lot_sursa='test', lot_brut='2' WHERE id=2" >/dev/null; ok "lot canonic coerent pe cerință (postgres)"
q "UPDATE public.ofertare_cerinte SET lot_domeniu='lista', lot_nr='{3,2,3}', lot_sursa='test' WHERE id=1" >/dev/null
asteapta "lot canonic: listă normalizată (sortată, fără duplicate)" "$(q "SELECT lot_nr::text FROM public.ofertare_cerinte WHERE id=1")" "{2,3}"
q "UPDATE public.ofertare_cantitati SET lot_domeniu='lista', lot_nr='{7}', lot_sursa='model', lot_brut='Lot 7' WHERE id=1" >/dev/null
asteapta "lot canonic: lot inexistent → necunoscut explicit, brut păstrat" "$(q "SELECT lot_domeniu||'|'||coalesce(lot_nr::text,'-')||'|'||lot_sursa||'|'||lot_brut FROM public.ofertare_cantitati WHERE id=1")" "necunoscut|-|invalidat_lot_inexistent|Lot 7"
q "UPDATE public.ofertare_cantitati SET lot_domeniu='lista', lot_nr='{2,NULL}' WHERE id=1" >/dev/null
asteapta "lot canonic: element NULL → necunoscut" "$(q "SELECT lot_domeniu FROM public.ofertare_cantitati WHERE id=1")" necunoscut
o="$(q "UPDATE public.ofertare_cantitati SET lot_domeniu=NULL, lot_nr='{1}' WHERE id=1" 2>&1 || true)"; grep -q ofertare_cantitati_lot_nr_coerent <<<"$o" || esec "CHECK NULL+listă: $o"; ok "refuz: lot_domeniu NULL cu listă (Copilot r1)"
refuz "loturi: scoaterea loturilor 2/3 referite de cerințe (Copilot r1)" authenticated "$OWNER" \
  "SELECT public.fn_ofertare_licitatie_loturi_seteaza(102, 'are_loturi', '[{\"nr\":1},{\"nr\":4}]')" "referite de"

# ── revenire ───────────────────────────────────────────────────────────────────────────────────────────
o="$("${PSQL[@]}" -d "$BAZA" -f "$ROLLBACK" 2>&1 || true)"; grep -q "garda start invalida" <<<"$o" || esec "revenire nearmată: $o"; ok "refuz: revenire nearmată"
q "ALTER DATABASE $BAZA SET gazpet.revenire_20261024b = 'x'" >/dev/null
o="$(revenire || true)"; grep -q "armare persistenta interzisa" <<<"$o" || esec "armare persistentă: $o"; ok "refuz: armare persistentă"
q "ALTER DATABASE $BAZA RESET gazpet.revenire_20261024b" >/dev/null
revenire >/dev/null || { revenire; esec "revenire armată"; }
asteapta "revenire: obiecte + coloane scoase" "$(q "SELECT (to_regclass('public.ofertare_licitatie_loturi') IS NULL)::text || (to_regprocedure('public.fn_ofertare_eligibilitate(bigint,bigint)') IS NULL)::text || (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND (column_name LIKE 'lot\_%' OR column_name LIKE 'stare_loturi%'))")" truetrue0
asteapta "revenire: arhiva păstrează trierea" "$(q "SELECT jsonb_array_length(continut->'loturi')||'/'||jsonb_array_length(continut->'documente')||'/'||jsonb_array_length(continut->'document_loturi')||'/'||jsonb_array_length(continut->'jurnal')||'/'||jsonb_array_length(continut->'cerinte_lot') FROM public.ofertare_loturi_arhiva_revenire")" "4/3/1/9/2"
asteapta "revenire: arhiva fără drepturi API" "$(q "SELECT has_table_privilege('authenticated','public.ofertare_loturi_arhiva_revenire','SELECT')::text||has_table_privilege('service_role','public.ofertare_loturi_arhiva_revenire','SELECT')::text")" falsefalse
asteapta "revenire: trigger a00 de pe licitații rămas" "$(q "SELECT count(*) FROM pg_trigger WHERE tgrelid='public.ofertare_licitatii'::regclass AND NOT tgisinternal")" 1
livreaza >/dev/null || { livreaza; esec "dus-întors"; }; ok "dus-întors: re-livrare după revenire"
asteapta "dus-întors: control 0e" "$(q "$(cat "$CONTROL_0E")" | wc -l | tr -d ' ')" 0
echo PASS
