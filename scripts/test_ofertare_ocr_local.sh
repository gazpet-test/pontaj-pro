#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261029b_ofertare_ocr_local (pilot OCR local: rulări, pagini, arbitraje, verificări, jurnal PDF).
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
DATE_DIR=/tmp/pg_ocr; PORT=5448; BAZA=ofertare_loturi_test  # scheletul loturi admite doar acest nume de bază (local)
NUME=20261029b_ofertare_ocr_local
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
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261029b', 'OCR_LOCAL_REVENIRE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1; }
NUMEC=20261029c_ofertare_ocr_arbitraj_rezerva
MIGC="$RADACINA/supabase/migrations/$NUMEC.sql"; ROLLC="$RADACINA/supabase/revenire/${NUMEC}_ROLLBACK.sql"
livreaza_c() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUMEC:' || txid_current(), true);" -f "$MIGC" 2>&1; }
revenire_c() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261029c', 'OCR_LOCAL_C_REVENIRE:' || txid_current(), true);" -f "$ROLLC" 2>&1; }
sha() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
FX="$RADACINA/supabase/tests/ofertare_ocr_local_fixtures.py"
fx() { python3 "$FX" "$@"; }                       # segmente / dezacorduri reale / granițe, din scripts/ocr_local/compare.py
sq() { printf '%s' "$1" | sed "s/'/''/g"; }         # literal SQL

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
fx granita > /tmp/ocr_granita.tsv
q "CREATE TABLE zz_granita (s text, i int, e boolean)" >/dev/null; "${PSQL[@]}" -d "$BAZA" -c "\copy zz_granita FROM '/tmp/ocr_granita.tsv'" >/dev/null
asteapta "granița de token SQL = TOKEN-ul Python ($(q "SELECT count(*) FROM zz_granita") poziții)" \
  "$(q "SELECT coalesce(string_agg(s || '@' || i, ' '), '') FROM zz_granita WHERE public.fn_ofertare_ocr_granita(s, i) IS DISTINCT FROM e")" ""
q "DROP TABLE zz_granita" >/dev/null
asteapta "«m» tăiat din «m²» refuzat (review Jakarinos r8)" "$(q "SELECT public.fn_ofertare_ocr_literal('[[\"text\",\"m² ½\"]]', '{\"seg\":[0,0],\"start\":0,\"end\":1}') IS NULL")" t

# ── drepturi directe ─────────────────────────────────────────────────────────────────────────────────────
refuz "anon SELECT rulari" anon - "SELECT count(*) FROM public.ofertare_ocr_rulari" "permission denied"
refuz "authenticated INSERT rulari" authenticated "$OWNER" "INSERT INTO public.ofertare_ocr_rulari(licitatie_id, documente, plafon_usd, pornit_de) VALUES (102, '[{}]', 1, '$OWNER')" "permission denied"
refuz "service_role INSERT pagini" service_role - "INSERT INTO public.ofertare_ocr_pagini(rulare_id) VALUES (1)" "permission denied"
refuz "service_role UPDATE rulari" service_role - "UPDATE public.ofertare_ocr_rulari SET plafon_usd = 15" "permission denied"
refuz "authenticated SELECT jurnal pdf" authenticated "$OWNER" "SELECT count(*) FROM public.ofertare_ocr_pdf_jurnal" "permission denied"
refuz "authenticated apelează preia" authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_preia('lighton-mineru-v2')" "permission denied"
refuz "authenticated apelează plan" authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_plan(1, '[]')" "permission denied"
refuz "service_role apelează funcția internă literal" service_role - "SELECT public.fn_ofertare_ocr_literal('[]', '{}')" "permission denied"
refuz "authenticated apelează cost_rezerva" authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_cost_rezerva(1, 0.1)" "permission denied"
refuz "service_role apelează cererea UI" service_role - "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 1)" "permission denied"
refuz "service_role SELECT direct" service_role - "SELECT count(*) FROM public.ofertare_ocr_rulari" "permission denied"

# ── poarta pe cheltuială ─────────────────────────────────────────────────────────────────────────────────
refuz "cerere: editor fără responsabilitate" authenticated "$EDIT" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 15)" "Doar owner-ul"
refuz "cerere: plafon 20" authenticated "$RESP" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 20)" "între 0 și 15"
refuz "cerere: document neeligibil (lot neparticipant)" authenticated "$RESP" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[527]::bigint[], 15)" "nu e eligibil"
refuz "cerere: document din altă licitație" authenticated "$RESP" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[31]::bigint[], 15)" "nu aparține"
refuz "cerere: document fără pagini necitite" authenticated "$RESP" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1302]::bigint[], 15)" "nu are pagini"
refuz "cerere: duplicate" authenticated "$RESP" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247,1247]::bigint[], 15)" "duplicate"
refuz "cerere: plafon cu 3 zecimale" authenticated "$RESP" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 1.005)" "2 zecimale"
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

# ── plan + pagini ────────────────────────────────────────────────────────────────────────────────────────
T1='Conductă DN 250 — 0,056'; H1=$(sha "$T1"); T2='Conductă DN 250 — 0.056'; H2=$(sha "$T2")
# 326 / banda 0: HTML ca la LightOn (indentare, <br> în celulă, celulă goală, colspan, <sup> separate prin spațiu, &times;, bold)
T3='<p>Cantitate 10.5 m și 5 buc, x<5 si z>3, 10**2 mc, 1e3 kg, m<sup>2</sup>, **Teava** **PEHD**, Dimensiune 10&times;2</p>
<table>
  <tr>
    <td>Țeavă<br>PEHD</td><td></td><td>m</td><td>5</td>
  </tr>
  <tr><td><sup>2</sup> <sup>3</sup></td><td>buc</td><td>10</td></tr>
  <tr><td colspan="2">Robinet</td><td>buc</td><td>7</td></tr>
</table>'; H3=$(sha "$T3")
T3M=$(printf '%s' "$T3" | sed -e 's/10\.5 m/10,5 m/' -e 's/10&times;2/10×3/' -e 's#<td>5</td>#<td>6</td>#' -e 's#<td>10</td>#<td>11</td>#' -e 's#<td>7</td>#<td>8</td>#'); H3M=$(sha "$T3M")
# 326 / banda 1: text la LightOn, tabel markdown la MinerU (structură diferită → segmente aplatizate)
T4='Banda doi: 7 mc'; H4=$(sha "$T4"); T4M='| Banda doi: 8 | mc |'; H4M=$(sha "$T4M")
IA=$(sha imagineA); IB=$(sha imagineB); IC=$(sha imagineC); H0=$(sha '')
# SP <rulare> <pagina> <cititor> <text> <sha> [model] [stare] [imagine|NULL] [garda] [banda] [segmente SQL]
# segmentele implicite = compare.segmente(text) pentru o citire completă (citit), NULL altfel
SP() { local img="'${8:-$IA}'" g="${9:-}" b="${10:-0}" st="${7:-citit}" sg; [ "${8:-}" = NULL ] && img=NULL; [ -z "$g" ] && g='{}'; [ "$3" = reconciliat ] && b=NULL
  if [ -n "${11:-}" ]; then sg="${11}"; elif [ "$3" != reconciliat ] && [ "$st" = citit ]; then sg="'$(sq "$(fx seg "$4")")'"; else sg=NULL; fi
  echo "SELECT public.fn_ofertare_ocr_scrie_pagina($1, 1247, $2, $b::smallint, '$3', '$(sq "$4")', '$st', '${6:-LightOnOCR-2-1B}', '$5', $img, '$g', $sg)"; }
EXCL='{"motiv_excludere":"plansa"}'
PLAN_STD='[{"document_id":1247,"pagina":325,"benzi":[{"banda":0,"image_sha256":"'$IA'"}]},{"document_id":1247,"pagina":326,"benzi":[{"banda":0,"image_sha256":"'$IA'"},{"banda":1,"image_sha256":"'$IB'"}]},{"document_id":1247,"pagina":327,"exclus":"plansa"}]'
PL() { echo "SELECT public.fn_ofertare_ocr_plan($1, '$2')"; }
umple() {  # citiri complete pentru rularea $1 (planul pus deja): 325, 326 benzile 0 și 1, 327 exclus la ambele
  for c in lighton mineru; do
    ca service_role - "$(SP "$1" 325 $c "$T1" "$H1")" >/dev/null
    ca service_role - "$(SP "$1" 326 $c "$T3" "$H3")" >/dev/null
    ca service_role - "$(SP "$1" 326 $c "$T4" "$H4" m citit "$IB" '{}' 1)" >/dev/null
    ca service_role - "$(SP "$1" 327 $c '' "$H0" x exclus NULL "$EXCL")" >/dev/null
  done; }
refuz "citire înainte de plan" service_role - "$(SP $R 325 lighton "$T1" "$H1")" "Lipsește planul"
refuz "plan: pagină neînghețată" service_role - "$(PL $R '[{"document_id":1247,"pagina":400,"exclus":"x"}]')" "nu e înghețată"
refuz "plan: lipsește pagina 327" service_role - "$(PL $R "$(sed 's/,{"document_id":1247,"pagina":327,"exclus":"plansa"}//' <<<"$PLAN_STD")")" "exact paginile"
refuz "plan: pagina 325 de două ori" service_role - "$(PL $R "$(sed 's/"pagina":327,"exclus":"plansa"/"pagina":325,"exclus":"plansa"/' <<<"$PLAN_STD")")" "exact paginile"
refuz "plan: bandă dublă" service_role - "$(PL $R "$(sed 's/"banda":1,/"banda":0,/' <<<"$PLAN_STD")")" "dublă"
refuz "plan: imagine invalidă" service_role - "$(PL $R "$(sed "s/$IB/xyz/" <<<"$PLAN_STD")")" "Bandă invalidă"
refuz "plan: pagină exclusă cu benzi" service_role - "$(PL $R "$(sed 's/"exclus":"plansa"/"exclus":"plansa","benzi":[]/' <<<"$PLAN_STD")")" "motiv nevid"
refuz "plan: motiv de excludere gol" service_role - "$(PL $R "$(sed 's/"exclus":"plansa"/"exclus":"  "/' <<<"$PLAN_STD")")" "motiv nevid"
asteapta "plan pus (3 pagini)" "$(ca service_role - "$(PL $R "$PLAN_STD")->>'pagini'")" 3
refuz "plan a doua oară" service_role - "$(PL $R "$PLAN_STD")" "o singură dată"
refuz "pagină neînghețată" service_role - "$(SP $R 400 lighton "$T1" "$H1")" "nu e în rulare"
refuz "sha greșit" service_role - "$(SP $R 325 lighton "$T1" "$(sha altceva)")" "raw_sha256"
refuz "cititor fără imagine" service_role - "$(SP $R 325 lighton "$T1" "$H1" m citit NULL)" "nu e în plan"
refuz "bandă neplanificată" service_role - "$(SP $R 325 lighton "$T1" "$H1" m citit "$IA" '{}' 1)" "nu e în plan"
refuz "imagine diferită de cea din plan" service_role - "$(SP $R 325 lighton "$T1" "$H1" m citit "$IB")" "nu e în plan"
refuz "exclus pe o pagină citită în plan" service_role - "$(SP $R 325 lighton '' "$H0" m exclus NULL "$EXCL")" "nu e în plan"
refuz "citire pe pagina exclusă în plan" service_role - "$(SP $R 327 lighton "$T1" "$H1")" "Planul exclude"
refuz "exclus fără motiv" service_role - "$(SP $R 327 lighton '' "$H0" m exclus NULL)" "Planul exclude"
refuz "exclus cu alt motiv decât planul" service_role - "$(SP $R 327 lighton '' "$H0" m exclus NULL '{"motiv_excludere":"formular"}')" "Planul exclude"
refuz "exclus pe altă bandă decât 0" service_role - "$(SP $R 327 lighton '' "$H0" m exclus NULL "$EXCL" 1)" "Planul exclude"
refuz "citit fără segmente" service_role - "$(SP $R 325 lighton "$T1" "$H1" m citit "$IA" '{}' 0 NULL)" "check constraint"
refuz "segmente invalide" service_role - "$(SP $R 325 lighton "$T1" "$H1" m citit "$IA" '{}' 0 "'[[\"text\", 5]]'")" "Segmente invalide"
refuz "segmente: tabel cu celulă numerică" service_role - "$(SP $R 325 lighton "$T1" "$H1" m citit "$IA" '{}' 0 "'[[\"table\", [[\"a\", 1]]]]'")" "Segmente invalide"
refuz "segmente: obiect în loc de listă" service_role - "$(SP $R 325 lighton "$T1" "$H1" m citit "$IA" '{}' 0 "'[{\"text\": \"a\"}]'")" "Segmente invalide"
refuz "cititor cu stare «reconciliat»" service_role - "$(SP $R 325 lighton "$T1" "$H1" m reconciliat)" "check constraint"
asteapta "pagină scrisă" "$(ca service_role - "$(SP $R 325 lighton "$T1" "$H1")->>'deja'")" false
asteapta "aceeași pagină: idempotent" "$(ca service_role - "$(SP $R 325 lighton "$T1" "$H1")->>'deja'")" true
refuz "aceeași cheie, alt text (append-only)" service_role - "$(SP $R 325 lighton "x" "$(sha x)")" "alt conținut"
refuz "aceeași cheie, alt model_rev (nu e «deja»)" service_role - "$(SP $R 325 lighton "$T1" "$H1" alt-model)" "alt conținut"
refuz "aceeași cheie, alte segmente (nu e «deja»)" service_role - "$(SP $R 325 lighton "$T1" "$H1" m citit "$IA" '{}' 0 "'[[\"text\", \"altceva\"]]'")" "alt conținut"
refuz "reconciliat în preluata" service_role - "$(SP $R 325 reconciliat "$T1" "$H1" m reconciliat)" "reconciliat doar"
asteapta "pagina MinerU 325 (aceeași imagine)" "$(ca service_role - "$(SP $R 325 mineru "$T2" "$H2" MinerU2.5-Pro)->>'deja'")" false
ca service_role - "$(SP $R 326 lighton "$T3" "$H3")" >/dev/null
refuz "preluata → citita cu pagini lipsă" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'citita')" "toate benzile"
ca service_role - "$(SP $R 326 mineru "$T3M" "$H3M" MinerU2.5-Pro)" >/dev/null
ca service_role - "$(SP $R 326 lighton "$T4" "$H4" LightOnOCR-2-1B citit "$IB" '{}' 1)" >/dev/null
refuz "citita cu banda 1 doar la un cititor" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'citita')" "toate benzile"
ca service_role - "$(SP $R 326 mineru "$T4M" "$H4M" MinerU2.5-Pro citit "$IB" '{}' 1)" >/dev/null
ca service_role - "$(SP $R 327 lighton '' "$H0" x exclus NULL "$EXCL")" >/dev/null
refuz "327 exclus doar la un cititor" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'citita')" "toate benzile"
ca service_role - "$(SP $R 327 mineru '' "$H0" x exclus NULL "$EXCL")" >/dev/null
refuz "preluata → finalizata" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'finalizata')" "nepermisă"
# dezacordurile REALE produse de compare.py pentru citirile de mai sus (forma încărcată de pipeline: item_id, document_id, pagina)
DZ325=$(fx dez 325 0 "$T1" "$T2"); DZ326=$(fx dez 326 0 "$T3" "$T3M"); DZ326B=$(fx dez 326 1 "$T4" "$T4M")
it() { grep "\"item_id\": \"$2\"" <<<"$1"; }
mut() { local j="$1"; shift; printf '%s' "$j" | fx set "$@"; }
SD() { echo "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(sq "$1")')"; }
DZ() { echo "{\"document_id\":1247,\"pagina\":$1,\"item_id\":\"$2\",\"item_sha256\":\"$3\",\"tip\":\"${6:-text}\",\"citire_lighton\":\"${4:-0,056}\",\"citire_mineru\":\"${5:-0.056}\",\"e_cantitate\":true,\"anomalie_separator\":true}"; }
asteapta "compare.py: dezacordurile paginii 326 (2 text + 3 rânduri; banda 1: structură + text)" \
  "$(printf '%s\n' "$DZ326" | grep -o '"tip": "[a-z_]*"' | sort | uniq -c | tr -s ' ' | tr '\n' ';')|$(printf '%s\n' "$DZ326B" | grep -o '"tip": "[a-z_]*"' | sort | uniq -c | tr -s ' ' | tr '\n' ';')" \
  ' 3 "tip": "rand_tabel"; 2 "tip": "text";| 1 "tip": "structura_tabele"; 1 "tip": "text";'
refuz "dezacord în preluata" service_role - "$(SD "$DZ325")" "doar în citita"
asteapta "preluata → citita (toate benzile planului)" "$(ca service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'citita')->>'stare'")" citita
refuz "pagină de cititor după citita" service_role - "$(SP $R 325 mineru "$T1" "$H1" z)" "doar în preluata"

# ── dezacorduri: proveniență EXACTĂ pe segmente (sursă + granițe de token; rândul întreg, cu celulele goale) ──
T0=$(it "$DZ326" p0326_b0_t0); R0=$(it "$DZ326" p0326_b0_r0); R1=$(it "$DZ326" p0326_b0_r1)
refuz "dezacord pe pagină exclusă" service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 327 p0327_b0_r1 "$(sha i5)")')" "ambilor cititori"
refuz "dezacord: item_id de pe altă pagină" service_role - "$(SD "$(mut "$DZ325" item_id '"p0999_b0_t0"')")" "check constraint"
refuz "«5 m» din «10.5 m» (începe în mijlocul numărului)" service_role - "$(SD "$(mut "$T0" citire_lighton '"5 m"' sursa.lighton "$(fx src "$T3" 0 '10.5 m' 3 3)")")" "nu e exact"
refuz "«56» din «0.056»" service_role - "$(SD "$(mut "$DZ325" citire_mineru '"56"' sursa.mineru "$(fx src "$T2" 0 '0.056' 3 2)")")" "nu e exact"
refuz "«1» din «1e3»" service_role - "$(SD "$(mut "$T0" citire_lighton '"1"' sursa.lighton "$(fx src "$T3" 0 '1e3' 0 1)")")" "nu e exact"
refuz "fragment care se termină cu spațiu" service_role - "$(SD "$(mut "$T0" citire_lighton '"Cantitate "' sursa.lighton "$(fx src "$T3" 0 'Cantitate' 0 10)")")" "nu e exact"
refuz "fragment care nu e textul de la sursă" service_role - "$(SD "$(mut "$T0" citire_lighton '"10.6"')")" "nu e exact"
refuz "fragment fără sursă" service_role - "$(SD "$(mut "$T0" sursa.lighton null)")" "nu e exact"
refuz "sursă în afara segmentului" service_role - "$(SD "$(mut "$T0" sursa.lighton '{"seg":[0,0],"start":500,"end":504}')")" "nu e exact"
refuz "sursă pe segmentul de tabel" service_role - "$(SD "$(mut "$T0" sursa.lighton '{"seg":[1,1],"start":0,"end":4}')")" "nu e exact"
refuz "sursă cu poziție zecimală" service_role - "$(SD "$(mut "$T0" sursa.lighton '{"seg":[0,0],"start":10.0,"end":14}')")" "nu e exact"
refuz "rând fără celula goală (A | B | 5 față de A |  | B | 5)" service_role - "$(SD "$(mut "$R0" citire_lighton '"Țeavă PEHD | m | 5"')")" "Rândul"
refuz "rând cu celulă goală inventată" service_role - "$(SD "$(mut "$R1" citire_lighton '"^{2} ^{3} |  | buc | 10"')")" "Rândul"
refuz "rând cu poziția altui rând" service_role - "$(SD "$(mut "$R0" pozitie.lighton '[1, 1]')")" "Rândul"
refuz "rând cu poziție pe un segment text" service_role - "$(SD "$(mut "$R0" pozitie.lighton '[0, 0]')")" "Rândul"
refuz "rând lipsă care are totuși text" service_role - "$(SD "$(mut "$R0" tip '"rand_lipsa_lighton"')")" "Rândul lipsă"
refuz "banda_intreaga diferită de citirea brută" service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 326 p0326_b0_banda "$(sha i8)" "5 m" "5 m" banda_intreaga)')" "exact citirile brute"
refuz "banda_intreaga pe b1 cu textul benzii 0" service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 326 p0326_b1_banda "$(sha i11)" "$T4M" "$T4M" banda_intreaga)')" "exact citirile brute"
D6=$(ca service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 326 p0326_b1_banda "$(sha i11)" "$T4" "$T4M" banda_intreaga)')->>'id'")
[ -n "$D6" ] || esec "banda_intreaga pe b1 cu citirile exacte ale benzii respinsă"; ok "banda_intreaga pe b1 = citirile exacte ale benzii (id $D6)"
n=0; while IFS= read -r j; do
  [ -n "$j" ] || continue; id=$(ca service_role - "$(SD "$j")->>'id'")
  [ -n "$id" ] || esec "dezacord real respins: $(ca service_role - "$(SD "$j")")"; n=$((n + 1))
done <<<"$(printf '%s\n%s\n' "$DZ326" "$DZ326B")"
ok "toate dezacordurile reale ale paginii 326 acceptate ($n: <br> în celulă, celulă goală, colspan, <sup> separate, &times;, structură diferită)"
# fragmente care încep / se termină la un TABEL (sursa cu poziție null la capătul-tabel) — review Jakarinos r7
TB1='<table><tr><td>1.</td><td>A</td></tr></table>'; TB2='<table><tr><td>2</td></tr></table>'
nl=0; for pereche in "Titlu${TB1}Final|Titlu${TB1}${TB2}Final" "${TB1}Titlu Final|Titlu ${TB1} Final" "Valoare 1e3.5 m|Valoare 1e3.6 m"; do
  xa=${pereche%%|*}; xb=${pereche#*|}
  while IFS= read -r j; do
    [ -n "$j" ] || continue; [ "$(printf '%s' "$j" | fx get tip)" = text ] || continue
    for c in lighton mineru; do
      exp=$(printf '%s' "$j" | fx get "citire_$c"); [ -n "$exp" ] || continue
      raw=$([ $c = lighton ] && printf '%s' "$xa" || printf '%s' "$xb")
      got=$(q "SELECT coalesce(public.fn_ofertare_ocr_literal('$(sq "$(fx seg "$raw")")', '$(sq "$(printf '%s' "$j" | fx get "sursa.$c")")'), '<NULL>')")
      [ "$got" = "$exp" ] || esec "literal($c) pentru «$raw»: așteptat «$exp», primit «$got»"; nl=$((nl + 1))
    done
  done <<<"$(fx dez 330 0 "$xa" "$xb")"
done
[ "$nl" -ge 4 ] || esec "prea puține fragmente verificate ($nl)"; ok "fragmente la marginea unui tabel / după exponent refăcute exact ($nl)"
D1=$(ca service_role - "$(SD "$DZ325")->>'id'"); HS1=$(q "SELECT item_sha256 FROM public.ofertare_ocr_dezacorduri WHERE id=$D1")
[ -n "$D1" ] || esec "dezacord valid"; ok "dezacord valid 325 (id $D1)"
asteapta "dezacord: idempotent" "$(ca service_role - "$(SD "$DZ325")->>'deja'")" true
refuz "dezacord: același item_id, alt sha" service_role - "$(SD "$(mut "$DZ325" item_sha256 "\"$(sha alt)\"")")" "alt conținut"

# ── rezervări + arbitraj (decontarea rămâne și când decizia e respinsă) ──────────────────────────────────
asteapta "rezervare sub precizie (0,00004) refuzată" "$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.00004)")" ""
asteapta "rezervare peste 1 USD refuzată" "$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 2)")" ""
Z1=$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.6)"); [ -n "$Z1" ] || esec "rezervare 0,6"; ok "rezervare 0,6 (id $Z1)"
asteapta "a doua rezervare de 0,6 peste plafonul 1" "$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.6)")" ""
Z2=$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.3)"); [ -n "$Z2" ] || esec "rezervare 0,3"; ok "rezervare 0,3 (id $Z2)"
AR() { echo "{\"dezacord_id\":$1,\"item_sha256\":\"$2\",\"decizie\":\"$3\",\"text\":\"$4\",\"motiv\":\"imaginea arata punct\",\"e_cantitate\":true,\"anomalie_separator\":true,\"arbitru_model\":\"claude-sonnet-5\",\"prompt_versiune\":\"arb-v1\",\"cost_usd\":\"$5\",\"tokens_in\":\"${6:-3000}\",\"tokens_out\":300}"; }
refuz "arbitraj: cost peste rezervarea proprie" service_role - "SELECT public.fn_ofertare_ocr_scrie_arbitraj($Z2, '$(AR "$D1" "$HS1" ales_mineru "" 0.5)')" "peste rezervare"
asteapta "amprentă diferită: decontat, decizie respinsă" "$(ca service_role - "SELECT (x->>'decontat')||'|'||(x->>'arbitraj_inregistrat') FROM public.fn_ofertare_ocr_scrie_arbitraj($Z2, '$(AR "$D1" "$(sha alt)" ales_mineru "" 0.01 abc)') x")" "true|false"
Z3=$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.1)")
asteapta "text_propus doar whitespace: decontat, decizie respinsă" "$(ca service_role - "SELECT x->>'arbitraj_inregistrat' FROM public.fn_ofertare_ocr_scrie_arbitraj($Z3, '$(AR "$D1" "$HS1" text_propus '\n\t ' 0.01)') x")" false
refuz "citita → arbitrata fără marcajul comparației" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'arbitrata')" "nu e marcată"
asteapta "arbitraj ales_mineru: text derivat" "$(ca service_role - "SELECT public.fn_ofertare_ocr_scrie_arbitraj($Z1, '$(AR "$D1" "$HS1" ales_mineru 56 0.015)')->>'arbitraj_inregistrat'")" true
asteapta "textul ales = citirea MinerU (nu «56» trimis)" "$(q "SELECT text_ales FROM public.ofertare_ocr_arbitraje WHERE dezacord_id=$D1")" "0.056"
refuz "rezervare decontată de două ori" service_role - "SELECT public.fn_ofertare_ocr_scrie_arbitraj($Z1, '$(AR "$D1" "$HS1" ales_mineru "" 0.01)')" "deja închisă"
Z4=$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.1)")
asteapta "al doilea apel pe același dezacord: costul rămâne, decizia nu" "$(ca service_role - "SELECT x->>'arbitraj_inregistrat' FROM public.fn_ofertare_ocr_scrie_arbitraj($Z4, '$(AR "$D1" "$HS1" ales_lighton "" 0.01)') x")" false
for D in $(q "SELECT id||':'||item_id FROM public.ofertare_ocr_dezacorduri WHERE rulare_id=$R AND id<>$D1 ORDER BY id"); do
  Zx=$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.05)")
  id=${D%%:*}; it=${D#*:}; hs=$(q "SELECT item_sha256 FROM public.ofertare_ocr_dezacorduri WHERE id=$id")
  asteapta "arbitraj pe $it" "$(ca service_role - "SELECT public.fn_ofertare_ocr_scrie_arbitraj($Zx, '$(AR "$id" "$hs" ales_lighton "" 0.01)')->>'arbitraj_inregistrat'")" true
done
NDZ=$(q "SELECT count(*) FROM public.ofertare_ocr_dezacorduri WHERE rulare_id=$R"); NL=$((NDZ - 1))
MAN=$(q "SELECT document_id||'|'||pagina||'|'||item_id||'|'||item_sha256 FROM public.ofertare_ocr_dezacorduri WHERE rulare_id=$R" | LC_ALL=C sort | awk '{printf "%s\n", $0}' | sha256sum | cut -d' ' -f1)
refuz "marcaj cu număr greșit" service_role - "SELECT public.fn_ofertare_ocr_comparatie_gata($R, 2, '$MAN')" "Declarate 2"
refuz "marcaj cu număr corect și amprentă greșită" service_role - "SELECT public.fn_ofertare_ocr_comparatie_gata($R, $NDZ, '$(sha lista)')" "Amprenta manifestului"
asteapta "marcaj comparație încheiată (amprenta calculată ca pipeline-ul)" "$(ca service_role - "SELECT public.fn_ofertare_ocr_comparatie_gata($R, $NDZ, '$MAN')->>'nr'")" "$NDZ"
refuz "marcaj a doua oară" service_role - "SELECT public.fn_ofertare_ocr_comparatie_gata($R, $NDZ, '$MAN')" "o singură dată"
refuz "dezacord după marcaj" service_role - "$(SD "$(mut "$DZ325" item_id '"p0325_b0_t9"' item_sha256 "\"$(sha i9)\"")")" "încheierea comparației"
Z5=$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.05)")
refuz "citita → arbitrata cu rezervare deschisă" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'arbitrata')" "rezervări deschise"
asteapta "abandon înainte de 15 min refuzat" "$(ca service_role - "SELECT public.fn_ofertare_ocr_rezervare_abandon($Z5)")" f
q "UPDATE public.ofertare_ocr_rezervari SET creat_la = now() - interval '20 minutes' WHERE id=$Z5" >/dev/null
asteapta "abandon după 15 min" "$(ca service_role - "SELECT public.fn_ofertare_ocr_rezervare_abandon($Z5)")" t
asteapta "cost / rezervat / abandonat" "$(q "SELECT cost_usd||'|'||cost_rezervat||'|'||cost_abandonat FROM public.ofertare_ocr_rulari WHERE id=$R")" "$(awk -v n="$NL" 'BEGIN { printf "%.4f", 0.045 + 0.01 * n }')|0.0000|0.0500"
asteapta "ai_usage_log: fiecare apel decontat" "$(q "SELECT count(*) FROM public.ai_usage_log WHERE function_name='ofertare-ocr-arbitreaza'")" "$((4 + NL))"

# ── eșantion (doar după înghețare) + verificare + reconciliere obligatorie ───────────────────────────────
AID=$(q "SELECT id FROM public.ofertare_ocr_arbitraje WHERE dezacord_id=$D1")
asteapta "eșantion gol cât rularea e în citita" "$(ca authenticated "$EDIT" "SELECT count(*) FROM public.fn_ofertare_ocr_esantion($R)")" 0
refuz "verificare înainte de înghețare" authenticated "$RESP" "SELECT public.fn_ofertare_ocr_verifica($AID, 'corect')" "nu e în eșantionul"
asteapta "citita → arbitrata" "$(ca service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'arbitrata')->>'stare'")" arbitrata
asteapta "eșantion: anomalia de separator intră" "$(ca authenticated "$EDIT" "SELECT motiv_esantion FROM public.fn_ofertare_ocr_esantion($R) WHERE arbitraj_id=$AID")" anomalie_separator
refuz "verificare: editor" authenticated "$EDIT" "SELECT public.fn_ofertare_ocr_verifica($AID, 'corect')" "fără drept"
refuz "verificare: id inexistent = același mesaj" authenticated "$RESP" "SELECT public.fn_ofertare_ocr_verifica(999999, 'corect')" "fără drept"
asteapta "verificare: responsabil" "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_ocr_verifica($AID, 'corect', 'vazut pe imagine')->>'ok'")" true
refuz "verificare: al doilea verdict" authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_verifica($AID, 'gresit')" "deja un verdict"
refuz "reconciliat cu stare de cititor" service_role - "$(SP $R 325 reconciliat "$T2" "$H2" reconciliere citit NULL '{}' 0 NULL)" "check constraint"
asteapta "text reconciliat 325" "$(ca service_role - "$(SP $R 325 reconciliat "$T2" "$H2" reconciliere reconciliat NULL)->>'deja'")" false
refuz "finalizata fără reconcilierea paginii 326" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'finalizata')" "fără rezultat reconciliat"
ca service_role - "$(SP $R 326 reconciliat "$T3" "$H3" reconciliere needs_human NULL)" >/dev/null
asteapta "arbitrata → finalizata (327 exclusă nu cere reconciliere)" "$(ca service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'finalizata')->>'stare'")" finalizata

# ── apel plătit decontat după anulare ────────────────────────────────────────────────────────────────────
R2=$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 15)->>'rulare_id'")
ca service_role - "SELECT public.fn_ofertare_ocr_preia('lighton-mineru-v2')" >/dev/null; ca service_role - "$(PL "$R2" "$PLAN_STD")" >/dev/null; umple "$R2"
ca service_role - "SELECT public.fn_ofertare_ocr_stare($R2, 'citita')" >/dev/null
Z6=$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R2, 0.05)")
refuz "anulare: editor" authenticated "$EDIT" "SELECT public.fn_ofertare_ocr_anuleaza($R2)" "fără drept"
asteapta "anulare: responsabil (cu apel în zbor)" "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_ocr_anuleaza($R2)->>'ok'")" true
asteapta "apelul în zbor se decontează după anulare" "$(ca service_role - "SELECT public.fn_ofertare_ocr_scrie_arbitraj($Z6, '$(AR 0 x needs_human "" 0.02)')->>'arbitraj_inregistrat'")" false
asteapta "costul apelului rămâne în evidență" "$(q "SELECT cost_usd||'|'||cost_rezervat FROM public.ofertare_ocr_rulari WHERE id=$R2")" "0.0200|0.0000"

# ── concurență reală (două sesiuni simultane) ────────────────────────────────────────────────────────────
R3=$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 1)->>'rulare_id'")
ca service_role - "SELECT public.fn_ofertare_ocr_preia('lighton-mineru-v2')" >/dev/null; ca service_role - "$(PL "$R3" "$PLAN_STD")" >/dev/null
( ca service_role - "$(SP "$R3" 325 lighton "$T1" "$H1")->>'deja'" > /tmp/ocr_c1 & ca service_role - "$(SP "$R3" 325 lighton "$T1" "$H1")->>'deja'" > /tmp/ocr_c2 & wait )
asteapta "două scrieri identice simultane: una nouă, una «deja»" "$(cat /tmp/ocr_c1 /tmp/ocr_c2 | sort | tr '\n' ' ')" "false true "
umple "$R3"; ca service_role - "SELECT public.fn_ofertare_ocr_stare($R3, 'citita')" >/dev/null
( ca service_role - "SELECT coalesce(public.fn_ofertare_ocr_cost_rezerva($R3, 0.6)::text, 'refuz')" > /tmp/ocr_c1 &
  ca service_role - "SELECT coalesce(public.fn_ofertare_ocr_cost_rezerva($R3, 0.6)::text, 'refuz')" > /tmp/ocr_c2 & wait )
asteapta "două rezervări simultane de 0,6 sub plafonul 1: exact una trece" "$(grep -c refuz /tmp/ocr_c1 /tmp/ocr_c2 | awk -F: '{s+=$2} END {print s}')" 1
asteapta "plafonul respectat după cursă" "$(q "SELECT cost_rezervat FROM public.ofertare_ocr_rulari WHERE id=$R3")" 0.6000
ca service_role - "SELECT public.fn_ofertare_ocr_stare($R3, 'oprita', 'test concurenta')" >/dev/null

# ── completitudine față de PLAN (Copilot r6): plan {0,1,2} pe 326, cititori {0,1} ⇒ refuz; {0,1,2} ⇒ trece ─────────────
R4=$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 1)->>'rulare_id'")
ca service_role - "SELECT public.fn_ofertare_ocr_preia('lighton-mineru-v2')" >/dev/null
ca service_role - "$(PL "$R4" "$(sed 's/{"banda":1,"image_sha256":"'$IB'"}/{"banda":1,"image_sha256":"'$IB'"},{"banda":2,"image_sha256":"'$IC'"}/' <<<"$PLAN_STD")")" >/dev/null
umple "$R4"
refuz "citita: plan {0,1,2}, cititori {0,1}" service_role - "SELECT public.fn_ofertare_ocr_stare($R4, 'citita')" "toate benzile"
refuz "banda 2 cu imaginea benzii 1" service_role - "$(SP "$R4" 326 lighton "$T4" "$H4" m citit "$IB" '{}' 2)" "nu e în plan"
ca service_role - "$(SP "$R4" 326 lighton "$T4" "$H4" m citit "$IC" '{}' 2)" >/dev/null
refuz "citita: banda 2 doar la LightOn" service_role - "SELECT public.fn_ofertare_ocr_stare($R4, 'citita')" "toate benzile"
ca service_role - "$(SP "$R4" 326 mineru "$T4" "$H4" m citit "$IC" '{}' 2)" >/dev/null
asteapta "citita: plan {0,1,2}, cititori {0,1,2}" "$(ca service_role - "SELECT public.fn_ofertare_ocr_stare($R4, 'citita')->>'stare'")" citita
ca service_role - "SELECT public.fn_ofertare_ocr_stare($R4, 'oprita', 'test plan')" >/dev/null

# ── heartbeat ────────────────────────────────────────────────────────────────────────────────────────────
asteapta "heartbeat" "$(ca service_role - "SELECT public.fn_ofertare_ocr_heartbeat(true, 'test')")" t
asteapta "heartbeat scris" "$(q "SELECT ultim_ok||'|'||ultim_mesaj||'|'||activ FROM public.procese_heartbeat WHERE cheie='ocr_local_ofertare'")" "true|test|true"

# ── 20261029c: rezervarea legată de dezacord (D3b, review Copilot r1 + Jakarinos r1) ─────────────────────
python3 "$RADACINA/scripts/livrare_validator.py" "$MIGC" >/dev/null || esec "validatorul refuză 20261029c"; ok "validator livrare 20261029c"
AMPB=$(q "SELECT public.fn_ofertare_ocr_amprenta()")
o="$("${PSQL[@]}" -d "$BAZA" -f "$MIGC" 2>&1 || true)"; grep -q "garda start invalida" <<<"$o" || esec "c fără gardă: $o"; ok "refuz: 20261029c fără gardă"
COMB=$(q "SELECT obj_description('public.ofertare_ocr_rulari'::regclass, 'pg_class')")
q "COMMENT ON TABLE public.ofertare_ocr_rulari IS NULL" >/dev/null
o="$(livreaza_c || true)"; grep -q "amprenta difera" <<<"$o" || esec "c fără comentariul amprentei trebuia refuzată: $o"
[ "$(q "SELECT to_regprocedure('public.fn_ofertare_ocr_arbitraj_rezerva(bigint,bigint,text,text,numeric)') IS NULL")" = t ] || esec "c refuzată a lăsat urme"
q "COMMENT ON TABLE public.ofertare_ocr_rulari IS '$COMB'" >/dev/null; ok "refuz: 20261029c fără comentariul amprentei (Jakarinos r2 P2)"
q "ALTER TABLE public.ofertare_ocr_rulari ALTER COLUMN stare SET DEFAULT 'preluata'" >/dev/null
o="$(livreaza_c || true)"; grep -q "amprenta difera" <<<"$o" || esec "c peste drift trebuia refuzată: $o"
q "ALTER TABLE public.ofertare_ocr_rulari ALTER COLUMN stare SET DEFAULT 'ceruta'" >/dev/null; ok "refuz: 20261029c peste drift în 20261029b"
livreaza_c >/dev/null || { livreaza_c; esec "livrare 20261029c"; }; ok "livrare 20261029c"
o="$(livreaza_c || true)"; grep -q "obiectele exista deja" <<<"$o" || esec "reaplicare c: $o"; ok "refuz: reaplicare 20261029c"
asteapta "control 0e după c" "$(q "$(cat "$CONTROL_0E")" | wc -l | tr -d ' ')" 0
o="$(revenire || true)"; grep -q "amprenta difera\|alt numar de obiecte" <<<"$o" || esec "revenirea b peste c trebuia refuzată: $o"; ok "refuz: revenirea 20261029b cât 20261029c e aplicată"
refuz "service_role: cost_rezerva fără dezacord nu mai e permis" service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva(1, 0.1)" "permission denied"
refuz "authenticated: arbitraj_rezerva" authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_arbitraj_rezerva(1, 1, 'x', 'y', 0.1)" "permission denied"
refuz "authenticated: dezacord_arbitraj" authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_dezacord_arbitraj(1, 1, 'x', 'y')" "permission denied"
refuz "authenticated: arbitraj_om" authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_arbitraj_om(1, 1, 'x', 'y')" "permission denied"
R6=$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 1)->>'rulare_id'")
ca service_role - "SELECT public.fn_ofertare_ocr_preia('lighton-mineru-v2')" >/dev/null; ca service_role - "$(PL "$R6" "$PLAN_STD")" >/dev/null
ca service_role - "$(SP "$R6" 325 lighton "$T1" "$H1")" >/dev/null; ca service_role - "$(SP "$R6" 325 mineru "$T2" "$H2" MinerU2.5-Pro)" >/dev/null
for c in lighton mineru; do
  ca service_role - "$(SP "$R6" 326 $c "$T3" "$H3")" >/dev/null
  ca service_role - "$(SP "$R6" 327 $c '' "$H0" x exclus NULL "$EXCL")" >/dev/null
done
ca service_role - "$(SP "$R6" 326 lighton "$T4" "$H4" m citit "$IB" '{}' 1)" >/dev/null; ca service_role - "$(SP "$R6" 326 mineru "$T4M" "$H4M" m citit "$IB" '{}' 1)" >/dev/null
ca service_role - "SELECT public.fn_ofertare_ocr_stare($R6, 'citita')" >/dev/null
SD6() { echo "SELECT public.fn_ofertare_ocr_scrie_dezacord($R6, '$(sq "$1")')"; }
X1=$(ca service_role - "$(SD6 "$DZ325")->>'id'"); S1=$(q "SELECT item_sha256 FROM public.ofertare_ocr_dezacorduri WHERE id=$X1")
XS=$(ca service_role - "$(SD6 "$(it "$DZ326B" p0326_b1_structura)")->>'id'"); SS=$(q "SELECT item_sha256 FROM public.ofertare_ocr_dezacorduri WHERE id=$XS")
XT=$(ca service_role - "$(SD6 "$(it "$DZ326B" p0326_b1_t0)")->>'id'"); ST=$(q "SELECT item_sha256 FROM public.ofertare_ocr_dezacorduri WHERE id=$XT")
[ -n "$X1" ] && [ -n "$XS" ] && [ -n "$XT" ] || esec "dezacorduri R6"; ok "rularea R6 în citita cu 3 dezacorduri ($X1 text, $XS structură, $XT text pe banda 1)"
DA() { echo "SELECT public.fn_ofertare_ocr_dezacord_arbitraj($R6, $1, '$2', '$3')"; }
asteapta "citire: amprentă greșită" "$(ca service_role - "$(DA "$X1" "$(sha alt)" "$IA")->>'refuz'")" dezacord
asteapta "citire: dezacord din altă rulare" "$(ca service_role - "SELECT public.fn_ofertare_ocr_dezacord_arbitraj($R, $X1, '$S1', '$IA')->>'refuz'")" stare
asteapta "citire: imaginea altei benzi" "$(ca service_role - "$(DA "$X1" "$S1" "$IB")->>'refuz'")" imagine
asteapta "citire: structura_tabele" "$(ca service_role - "$(DA "$XS" "$SS" "$IB")->>'refuz'")" tip
asteapta "citire: citirile vin DIN BD" "$(ca service_role - "SELECT x->>'item_id'||'|'||(x->>'citire_lighton')||'|'||(x->>'citire_mineru') FROM $(DA "$X1" "$S1" "$IA" | sed 's/^SELECT //') x")" "p0325_b0_t0|0,056|0.056"
AZ() { echo "SELECT public.fn_ofertare_ocr_arbitraj_rezerva($R6, $1, '$2', '$3', $4)"; }
asteapta "rezervare: amprentă greșită" "$(ca service_role - "$(AZ "$X1" "$(sha alt)" "$IA" 0.05)->>'refuz'")" dezacord
asteapta "rezervare: imaginea altei benzi" "$(ca service_role - "$(AZ "$X1" "$S1" "$IB" 0.05)->>'refuz'")" imagine
asteapta "rezervare: peste plafon" "$(ca service_role - "$(AZ "$X1" "$S1" "$IA" 1.0001)->>'refuz'")" suma
asteapta "rezervare de 0,99 sub plafonul 1: trece" "$(ca service_role - "$(AZ "$X1" "$S1" "$IA" 0.99)->>'refuz'")" ""
q "UPDATE public.ofertare_ocr_rezervari SET creat_la = now() - interval '20 minutes' WHERE rulare_id=$R6 AND stare='deschisa'" >/dev/null
ZA=$(q "SELECT id FROM public.ofertare_ocr_rezervari WHERE rulare_id=$R6 AND stare='deschisa'")
asteapta "abandonul rezervării de 0,99" "$(ca service_role - "SELECT public.fn_ofertare_ocr_rezervare_abandon($ZA)")" t
asteapta "rezervare: plafonul rămas (1 − 0,99 abandonat) nu ajunge" "$(ca service_role - "$(AZ "$X1" "$S1" "$IA" 0.05)->>'refuz'")" plafon
ca service_role - "SELECT public.fn_ofertare_ocr_stare($R6, 'oprita', 'test plafon c')" >/dev/null
R7=$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 1)->>'rulare_id'")
ca service_role - "SELECT public.fn_ofertare_ocr_preia('lighton-mineru-v2')" >/dev/null; ca service_role - "$(PL "$R7" "$PLAN_STD")" >/dev/null
ca service_role - "$(SP "$R7" 325 lighton "$T1" "$H1")" >/dev/null; ca service_role - "$(SP "$R7" 325 mineru "$T2" "$H2" MinerU2.5-Pro)" >/dev/null
for c in lighton mineru; do
  ca service_role - "$(SP "$R7" 326 $c "$T3" "$H3")" >/dev/null
  ca service_role - "$(SP "$R7" 327 $c '' "$H0" x exclus NULL "$EXCL")" >/dev/null
done
ca service_role - "$(SP "$R7" 326 lighton "$T4" "$H4" m citit "$IB" '{}' 1)" >/dev/null; ca service_role - "$(SP "$R7" 326 mineru "$T4M" "$H4M" m citit "$IB" '{}' 1)" >/dev/null
ca service_role - "SELECT public.fn_ofertare_ocr_stare($R7, 'citita')" >/dev/null
SD7() { echo "SELECT public.fn_ofertare_ocr_scrie_dezacord($R7, '$(sq "$1")')"; }
Y1=$(ca service_role - "$(SD7 "$DZ325")->>'id'"); YS=$(ca service_role - "$(SD7 "$(it "$DZ326B" p0326_b1_structura)")->>'id'"); YT=$(ca service_role - "$(SD7 "$(it "$DZ326B" p0326_b1_t0)")->>'id'")
AZ7() { echo "SELECT public.fn_ofertare_ocr_arbitraj_rezerva($R7, $1, '$2', '$3', $4)"; }
ZB=$(ca service_role - "$(AZ7 "$Y1" "$S1" "$IA" 0.05)->>'rezervare_id'"); [ -n "$ZB" ] || esec "rezervarea legată"; ok "rezervare legată de dezacordul $Y1 (id $ZB)"
asteapta "a doua rezervare pe același dezacord: în zbor" "$(ca service_role - "$(AZ7 "$Y1" "$S1" "$IA" 0.05)->>'refuz'")" in_zbor
( ca service_role - "$(AZ7 "$YT" "$ST" "$IB" 0.05)->>'rezervare_id'" > /tmp/ocr_c1 & ca service_role - "$(AZ7 "$YT" "$ST" "$IB" 0.05)->>'rezervare_id'" > /tmp/ocr_c2 & wait )
asteapta "două rezervări simultane pe același dezacord: exact una" "$(cat /tmp/ocr_c1 /tmp/ocr_c2 | grep -c '[0-9]')" 1
ZT=$(cat /tmp/ocr_c1 /tmp/ocr_c2 | grep '[0-9]')
asteapta "decontare cu decizia ALTUI dezacord: decontat, decizie respinsă" \
  "$(ca service_role - "SELECT (x->>'decontat')||'|'||(x->>'arbitraj_inregistrat') FROM public.fn_ofertare_ocr_scrie_arbitraj($ZB, '$(AR "$YT" "$ST" ales_lighton "" 0.01)') x")" "true|false"
ZB2=$(ca service_role - "$(AZ7 "$Y1" "$S1" "$IA" 0.05)->>'rezervare_id'"); [ -n "$ZB2" ] || esec "re-rezervare după decizie respinsă"; ok "dezacord nearbitrat după decizia respinsă: rezervabil din nou (id $ZB2)"
asteapta "decontare cu decizia dezacordului propriu" "$(ca service_role - "SELECT x->>'arbitraj_inregistrat' FROM public.fn_ofertare_ocr_scrie_arbitraj($ZB2, '$(AR "$Y1" "$S1" ales_mineru "" 0.012)') x")" true
asteapta "rezervare pe dezacord deja arbitrat" "$(ca service_role - "$(AZ7 "$Y1" "$S1" "$IA" 0.05)->>'refuz'")" arbitrat
asteapta "citire pe dezacord deja arbitrat" "$(ca service_role - "SELECT public.fn_ofertare_ocr_dezacord_arbitraj($R7, $Y1, '$S1', '$IA')->>'refuz'")" arbitrat
OM() { echo "SELECT public.fn_ofertare_ocr_arbitraj_om($R7, $1, '$2', '$3')"; }
refuz "om: motiv gol" service_role - "$(OM "$YS" "$SS" '  ')" "Motiv obligatoriu"
refuz "om: amprentă greșită" service_role - "$(OM "$YS" "$(sha alt)" 'structura')" "amprenta"
refuz "om: dezacord cu apel în zbor" service_role - "$(OM "$YT" "$ST" 'test')" "în zbor"
asteapta "om: structura_tabele → needs_human fără cost" "$(ca service_role - "$(OM "$YS" "$SS" 'structura diferita intre cititori')->>'ok'")" true
asteapta "om: arbitrajul (needs_human, cost 0, om / fara-ai)" "$(q "SELECT decizie||'|'||cost_usd||'|'||arbitru_model||'|'||prompt_versiune||'|'||(text_ales IS NULL) FROM public.ofertare_ocr_arbitraje WHERE dezacord_id=$YS")" "needs_human|0.0000|om|fara-ai|true"
refuz "om: a doua oară" service_role - "$(OM "$YS" "$SS" 'din nou')" "deja arbitrat"
asteapta "costul rulării: doar apelurile plătite" "$(q "SELECT cost_usd||'|'||cost_rezervat FROM public.ofertare_ocr_rulari WHERE id=$R7")" "0.0220|0.0500"
o="$(revenire_c || true)"; grep -q "rezervari deschise" <<<"$o" || esec "revenire c cu rezervare deschisă: $o"; ok "refuz: revenirea 20261029c cu rezervare deschisă"
q "UPDATE public.ofertare_ocr_rezervari SET creat_la = now() - interval '20 minutes' WHERE id=$ZT" >/dev/null
asteapta "abandonul rezervării în zbor" "$(ca service_role - "SELECT public.fn_ofertare_ocr_rezervare_abandon($ZT)")" t
# depășirea costului real: o singură tranzacție (Copilot r2 / Jakarinos r2 P1)
ZD=$(ca service_role - "$(AZ7 "$YT" "$ST" "$IB" 0.05)->>'rezervare_id'"); [ -n "$ZD" ] || esec "rezervare pentru depășire"
DP() { echo "SELECT public.fn_ofertare_ocr_arbitraj_depasire($1, $2, 400000, 1000, 'claude-sonnet-5')"; }
refuz "depășire: cost sub rezervare nu e depășire" service_role - "$(DP "$ZD" 0.04)" "Nu e o depășire"
refuz "authenticated: arbitraj_depasire" authenticated "$OWNER" "$(DP "$ZD" 0.07)" "permission denied"
asteapta "depășire: înregistrată și rularea oprită" "$(ca service_role - "SELECT (x->>'ok')||'|'||(x->>'oprita') FROM $(DP "$ZD" 0.0712 | sed 's/^SELECT //') x")" "true|true"
asteapta "depășire: rezervarea la toată suma, rularea oprită cu motiv, costul real în jurnal, needs_human"   "$(q "SELECT z.stare||'|'||z.cost_real||'|'||r.stare||'|'||(r.oprit_motiv LIKE 'cost real 0.0712 peste rezervarea 0.0500%')::text||'|'||r.cost_usd||'|'||r.cost_rezervat FROM public.ofertare_ocr_rezervari z JOIN public.ofertare_ocr_rulari r ON r.id=z.rulare_id WHERE z.id=$ZD")|$(q "SELECT cost_usd FROM public.ai_usage_log WHERE ref_table='ofertare_ocr_rezervari' AND ref_id=$ZD")|$(q "SELECT decizie||'/'||prompt_versiune FROM public.ofertare_ocr_arbitraje WHERE dezacord_id=$YT")"   "decontata|0.0500|oprita|true|0.0720|0.0000|0.0712|needs_human/depasire"
refuz "depășire a doua oară pe aceeași rezervare" service_role - "$(DP "$ZD" 0.08)" "închisă"
asteapta "după depășire: nicio rezervare nouă (rularea oprită)" "$(ca service_role - "$(AZ7 "$Y1" "$S1" "$IA" 0.05)->>'refuz'")" stare
o="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLC" 2>&1 || true)"; grep -q "garda start invalida" <<<"$o" || esec "revenire c nearmată: $o"; ok "refuz: revenire 20261029c nearmată"
revenire_c >/dev/null || { revenire_c; esec "revenire 20261029c"; }; ok "revenire 20261029c"
asteapta "după revenirea c: amprenta = cea a lui 20261029b, din nou ștampilată" \
  "$(q "SELECT public.fn_ofertare_ocr_amprenta() = '$AMPB' AND obj_description('public.ofertare_ocr_rulari'::regclass, 'pg_class') LIKE '%amprenta=$AMPB'")" t
asteapta "după revenirea c: cost_rezerva din nou pentru service_role, arbitrajele păstrate" "$(q "SELECT has_function_privilege('service_role', 'public.fn_ofertare_ocr_cost_rezerva(bigint,numeric)', 'EXECUTE')")|$(q "SELECT count(*) FROM public.ofertare_ocr_arbitraje WHERE dezacord_id IN ($Y1, $YS)")" "t|2"
livreaza_c >/dev/null || esec "dus-întors c"; revenire_c >/dev/null || esec "dus-întors c (revenire)"; ok "dus-întors 20261029c"

# ── revenire ─────────────────────────────────────────────────────────────────────────────────────────────
o="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" 2>&1 || true)"; grep -q "garda start invalida" <<<"$o" || esec "revenire nearmată: $o"; ok "refuz: revenire nearmată"
revenire >/dev/null || { revenire; esec "revenire armată"; }; ok "revenire armată"
asteapta "după revenire: niciun obiect, heartbeat dezactivat" \
  "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'ofertare\_ocr\_%'")|$(q "SELECT activ FROM public.procese_heartbeat WHERE cheie='ocr_local_ofertare'")" "0|f"
livreaza >/dev/null || esec "reaplicare după revenire"; ok "dus-întors: reaplicare după revenire"
asteapta "heartbeat reactivat după reaplicare" "$(ca service_role - "SELECT public.fn_ofertare_ocr_heartbeat(true, 'din nou')")|$(q "SELECT activ FROM public.procese_heartbeat WHERE cheie='ocr_local_ofertare'")" "t|t"
drift() {  # drift <descriere> <sql care strică> <sql care repară>
  q "$2" >/dev/null
  o="$(revenire || true)"; grep -q "amprenta difera" <<<"$o" || esec "revenire peste drift ($1): $o"
  [ "$(q "SELECT to_regclass('public.ofertare_ocr_rulari') IS NOT NULL")" = t ] || esec "revenirea refuzată a șters ceva ($1)"
  q "$3" >/dev/null; ok "refuz: revenire după drift — $1"; }
drift "index o_activa șters" "DROP INDEX public.ofertare_ocr_rulari_o_activa" \
  "CREATE UNIQUE INDEX ofertare_ocr_rulari_o_activa ON public.ofertare_ocr_rulari (licitatie_id) WHERE stare IN ('ceruta', 'preluata', 'citita', 'arbitrata')"
drift "RLS dezactivat" "ALTER TABLE public.ofertare_ocr_rulari DISABLE ROW LEVEL SECURITY" "ALTER TABLE public.ofertare_ocr_rulari ENABLE ROW LEVEL SECURITY"
drift "DEFAULT schimbat" "ALTER TABLE public.ofertare_ocr_rulari ALTER COLUMN stare SET DEFAULT 'preluata'" "ALTER TABLE public.ofertare_ocr_rulari ALTER COLUMN stare SET DEFAULT 'ceruta'"
drift "trigger adăugat" "CREATE TRIGGER t_x BEFORE INSERT ON public.ofertare_ocr_pagini FOR EACH ROW EXECUTE FUNCTION suppress_redundant_updates_trigger()" "DROP TRIGGER t_x ON public.ofertare_ocr_pagini"
drift "grant pe secvență" "GRANT USAGE ON SEQUENCE public.ofertare_ocr_rulari_id_seq TO authenticated" "REVOKE USAGE ON SEQUENCE public.ofertare_ocr_rulari_id_seq FROM authenticated"
drift "pas de secvență schimbat" "ALTER SEQUENCE public.ofertare_ocr_rulari_id_seq INCREMENT BY 2" "ALTER SEQUENCE public.ofertare_ocr_rulari_id_seq INCREMENT BY 1"
asteapta "după reparare: amprenta e iar cea aplicată" "$(q "SELECT obj_description('public.ofertare_ocr_rulari'::regclass, 'pg_class') LIKE '%amprenta=' || public.fn_ofertare_ocr_amprenta()")" t
q "CREATE OR REPLACE FUNCTION public.fn_ofertare_ocr_heartbeat(p_ok boolean, p_mesaj text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT true'" >/dev/null
o="$(revenire || true)"; grep -q "amprenta difera" <<<"$o" || esec "revenire peste funcție schimbată: $o"; ok "refuz: revenire după funcție schimbată"
q "COMMENT ON TABLE public.ofertare_ocr_rulari IS NULL" >/dev/null
o="$(revenire || true)"; grep -q "amprenta difera" <<<"$o" || esec "revenire fără amprentă: $o"; ok "refuz: revenire fără amprentă"
echo "PASS"
