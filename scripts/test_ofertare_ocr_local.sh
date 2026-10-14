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
DATE_DIR=/tmp/pg_ocr; PORT=5448; BAZA=ofertare_loturi_test  # scheletul loturi admite doar acest nume de bază (local)
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

# ── pagini ───────────────────────────────────────────────────────────────────────────────────────────────
T1='Conductă DN 250 — 0,056'; H1=$(sha "$T1"); T2='Conductă DN 250 — 0.056'; H2=$(sha "$T2")
T3='<p>Cantitate 10.5 m și 5 buc, x<5 si z>3, 10**2 mc, 1e3 kg, m<sup>2</sup>, **Teava** **PEHD**</p>
<table>
  <tr><td>&#53;</td></tr>
  <tr>
    <td>Țeavă</td><td></td><td>m</td><td>5</td>
  </tr>
  <tr><td>Robinet</td><td>buc</td><td>10</td></tr>
</table>'; H3=$(sha "$T3")
T4='Banda doi: 7 mc'; H4=$(sha "$T4")
IA=$(sha imagineA); IB=$(sha imagineB); H0=$(sha '')
# SP <rulare> <pagina> <cititor> <text> <sha> [model] [stare] [imagine|NULL] [garda] [banda]
SP() { local img="'${8:-$IA}'" g="${9:-}" b="${10:-0}"; [ "${8:-}" = NULL ] && img=NULL; [ -z "$g" ] && g='{}'; [ "$3" = reconciliat ] && b=NULL
  echo "SELECT public.fn_ofertare_ocr_scrie_pagina($1, 1247, $2, $b::smallint, '$3', '$4', '${7:-citit}', '${6:-LightOnOCR-2-1B}', '$5', $img, '$g')"; }
EXCL='{"motiv_excludere":"plansa"}'
umple() {  # citiri complete pentru rularea $1: 325 și 326 ambele pe aceeași imagine, 327 exclus la ambele
  for c in lighton mineru; do
    ca service_role - "$(SP "$1" 325 $c "$T1" "$H1")" >/dev/null
    ca service_role - "$(SP "$1" 326 $c "$T3" "$H3")" >/dev/null
    ca service_role - "$(SP "$1" 327 $c '' "$H0" x exclus NULL "$EXCL")" >/dev/null
  done; }
refuz "pagină neînghețată" service_role - "$(SP $R 400 lighton "$T1" "$H1")" "nu e în rulare"
refuz "sha greșit" service_role - "$(SP $R 325 lighton "$T1" "$(sha altceva)")" "raw_sha256"
refuz "cititor fără imagine" service_role - "$(SP $R 325 lighton "$T1" "$H1" m citit NULL)" "check constraint"
refuz "exclus fără motiv" service_role - "$(SP $R 327 lighton '' "$H0" m exclus NULL)" "check constraint"
refuz "exclus cu motiv null" service_role - "$(SP $R 327 lighton '' "$H0" m exclus NULL '{"motiv_excludere":null}')" "check constraint"
refuz "exclus cu motiv gol" service_role - "$(SP $R 327 lighton '' "$H0" m exclus NULL '{"motiv_excludere":"   "}')" "check constraint"
refuz "exclus cu motiv doar tab/newline" service_role - "$(SP $R 327 lighton '' "$H0" m exclus NULL '{"motiv_excludere":"\n\t"}')" "check constraint"
refuz "exclus pe altă bandă decât 0" service_role - "$(SP $R 327 lighton '' "$H0" m exclus NULL "$EXCL" 1)" "check constraint"
refuz "cititor cu stare «reconciliat»" service_role - "$(SP $R 325 lighton "$T1" "$H1" m reconciliat)" "check constraint"
asteapta "pagină scrisă" "$(ca service_role - "$(SP $R 325 lighton "$T1" "$H1")->>'deja'")" false
asteapta "aceeași pagină: idempotent" "$(ca service_role - "$(SP $R 325 lighton "$T1" "$H1")->>'deja'")" true
refuz "aceeași cheie, alt text (append-only)" service_role - "$(SP $R 325 lighton "x" "$(sha x)")" "alt conținut"
refuz "aceeași cheie, alt model_rev (nu e «deja»)" service_role - "$(SP $R 325 lighton "$T1" "$H1" alt-model)" "alt conținut"
refuz "reconciliat în preluata" service_role - "$(SP $R 325 reconciliat "$T1" "$H1" m reconciliat)" "reconciliat doar"
asteapta "pagina MinerU 325 (aceeași imagine)" "$(ca service_role - "$(SP $R 325 mineru "$T2" "$H2" MinerU2.5-Pro)->>'deja'")" false
ca service_role - "$(SP $R 326 lighton "$T3" "$H3")" >/dev/null
refuz "preluata → citita cu pagini lipsă" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'citita')" "pereche comparabilă"
ca service_role - "$(SP $R 326 mineru "$T3" "$H3" MinerU2.5-Pro)" >/dev/null
ca service_role - "$(SP $R 326 lighton "$T4" "$H4" LightOnOCR-2-1B citit "$IB" '{}' 1)" >/dev/null
refuz "citita cu banda 1 doar la un cititor" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'citita')" "pereche comparabilă"
ca service_role - "$(SP $R 326 mineru "$T4" "$H4" MinerU2.5-Pro citit "$IB" '{}' 1)" >/dev/null
ca service_role - "$(SP $R 327 lighton '' "$H0" x exclus NULL "$EXCL")" >/dev/null
refuz "327 exclus doar la un cititor" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'citita')" "pereche comparabilă"
ca service_role - "$(SP $R 327 mineru '' "$H0" x exclus NULL "$EXCL")" >/dev/null
refuz "preluata → finalizata" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'finalizata')" "nepermisă"
DZ() { echo "{\"document_id\":1247,\"pagina\":$1,\"item_id\":\"$2\",\"item_sha256\":\"$3\",\"tip\":\"${6:-text}\",\"citire_lighton\":\"${4:-0,056}\",\"citire_mineru\":\"${5:-0.056}\",\"e_cantitate\":true,\"anomalie_separator\":true}"; }
refuz "dezacord în preluata" service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 325 p0325_b0_r1 "$(sha i1)")')" "doar în citita"
asteapta "preluata → citita (perechi comparabile)" "$(ca service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'citita')->>'stare'")" citita
refuz "pagină de cititor după citita" service_role - "$(SP $R 325 mineru "$T1" "$H1" z)" "doar în preluata"

# ── dezacorduri: proveniență pe forma canonică ───────────────────────────────────────────────────────────
DZT() { echo "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 326 "$1" "$(sha "$1")" "$2" "$3" text)')"; }
refuz "dezacord pe pagină exclusă" service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 327 p0327_b0_r1 "$(sha i5)")')" "ambilor cititori"
refuz "dezacord: item_id de pe altă pagină" service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 325 p0999_b0_r1 "$(sha i3)")')" "check constraint"
refuz "proveniență: 56 din 0.056" service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 325 p0325_b0_r2 "$(sha i4)" "0,056" "56")')" "Numărul 56"
refuz "proveniență: cuvânt inventat" service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 325 p0325_b0_r2 "$(sha i4)" "Țeavă 0,056" "0.056")')" "nu apare"
refuz "proveniență: .5 din 10.5" service_role - "$(DZT p0326_b0_t1 ".5 m" ".5 m")" "nu apare\|Numărul"
refuz "proveniență: -5 din 5" service_role - "$(DZT p0326_b0_t2 "-5 buc" "-5 buc")" "nu apare\|Numărul"
refuz "proveniență: «- 5» din 5" service_role - "$(DZT p0326_b0_t3 "și - 5 buc" "și - 5 buc")" "nu apare"
refuz "proveniență: 5% din 5" service_role - "$(DZT p0326_b0_t4 "5% buc" "5% buc")" "nu apare\|Numărul"
refuz "proveniență: «x 3» din «x<5 si z>3»" service_role - "$(DZT p0326_b0_t6 "x 3" "x 3")" "nu apare"
refuz "proveniență: 102 din 10**2" service_role - "$(DZT p0326_b0_t7 "102 mc" "102 mc")" "nu apare"
refuz "proveniență: 1 din 1e3" service_role - "$(DZT p0326_b0_t8 "1" "1")" "Numărul 1"
refuz "proveniență: rând din celule ale unor rânduri diferite" service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 326 p0326_b0_rr1 "$(sha i7)" "Țeavă | m | 10" "Țeavă | m | 10" rand_tabel)')" "Rândul"
refuz "banda_intreaga diferită de citirea brută" service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 326 p0326_b0_banda "$(sha i8)" "5 m" "5 m" banda_intreaga)')" "exact citirile brute"
refuz "banda_intreaga pe b1 cu textul paginii (b0)" service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 326 p0326_b1_banda "$(sha i11)" "Banda doi: 8 mc" "Banda doi: 8 mc" banda_intreaga)')" "exact citirile brute"
D6=$(ca service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 326 p0326_b1_banda "$(sha i11)" "$T4" "$T4" banda_intreaga)')->>'id'")
[ -n "$D6" ] || esec "banda_intreaga pe b1 cu citirile exacte ale benzii respinsă"; ok "banda_intreaga pe b1 = citirile exacte ale benzii (id $D6)"
refuz "rând din două rânduri vecine (5 | Robinet)" service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 326 p0326_b0_rr3 "$(sha i12)" "5 | Robinet" "5 | Robinet" rand_tabel)')" "Rândul"
D7=$(ca service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 326 p0326_b0_rr4 "$(sha i13)" "Țeavă |  | m | 5" "Țeavă |  | m | 5" rand_tabel)')->>'id'")
[ -n "$D7" ] || esec "rând cu celulă goală respins"; ok "rând cu celulă goală acceptat (id $D7)"
D8=$(ca service_role - "$(DZT p0326_b0_t10 "Teava PEHD" "Teava PEHD")->>'id'")
[ -n "$D8" ] || esec "bold consecutiv respins"; ok "bold consecutiv «**Teava** **PEHD**» canonic «Teava PEHD» (id $D8)"
D4=$(ca service_role - "$(DZT p0326_b0_t9 "m^{2}" "m^{2}")->>'id'")
[ -n "$D4" ] || esec "proveniență: exponent m^{2} respins"; ok "proveniență: <sup> canonic «m^{2}» acceptat (id $D4)"
D5=$(ca service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 326 p0326_b0_rr2 "$(sha i10)" "Țeavă | m | 5" "Țeavă | m | 5" rand_tabel)')->>'id'")
[ -n "$D5" ] || esec "proveniență: rând întreg respins"; ok "proveniență: rând întreg «Țeavă | m | 5» acceptat (id $D5)"
D2=$(ca service_role - "$(DZT p0326_b0_t5 "10.5 m" "10.5")->>'id'")
[ -n "$D2" ] || esec "proveniență: fragment legitim respins"; ok "proveniență: «10.5 m» / «10.5» acceptate (id $D2)"
D3=$(ca service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 326 p0326_b0_rr0 "$(sha i6)" "5" "5" rand_tabel)')->>'id'")
[ -n "$D3" ] || esec "proveniență: celula &#53; decodată respinsă"; ok "proveniență: celula &#53; decodată ca «5» (id $D3)"
D1=$(ca service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 325 p0325_b0_r1 "$(sha i1)")')->>'id'")
[ -n "$D1" ] || esec "dezacord valid"; ok "dezacord valid (id $D1)"
asteapta "dezacord: idempotent" "$(ca service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 325 p0325_b0_r1 "$(sha i1)")')->>'deja'")" true
refuz "dezacord: același item_id, alt sha" service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 325 p0325_b0_r1 "$(sha alt)")')" "alt conținut"

# ── rezervări + arbitraj (decontarea rămâne și când decizia e respinsă) ──────────────────────────────────
asteapta "rezervare sub precizie (0,00004) refuzată" "$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.00004)")" ""
asteapta "rezervare peste 1 USD refuzată" "$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 2)")" ""
Z1=$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.6)"); [ -n "$Z1" ] || esec "rezervare 0,6"; ok "rezervare 0,6 (id $Z1)"
asteapta "a doua rezervare de 0,6 peste plafonul 1" "$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.6)")" ""
Z2=$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.3)"); [ -n "$Z2" ] || esec "rezervare 0,3"; ok "rezervare 0,3 (id $Z2)"
AR() { echo "{\"dezacord_id\":$1,\"item_sha256\":\"$2\",\"decizie\":\"$3\",\"text\":\"$4\",\"motiv\":\"imaginea arata punct\",\"e_cantitate\":true,\"anomalie_separator\":true,\"arbitru_model\":\"claude-sonnet-5\",\"prompt_versiune\":\"arb-v1\",\"cost_usd\":\"$5\",\"tokens_in\":\"${6:-3000}\",\"tokens_out\":300}"; }
refuz "arbitraj: cost peste rezervarea proprie" service_role - "SELECT public.fn_ofertare_ocr_scrie_arbitraj($Z2, '$(AR "$D1" "$(sha i1)" ales_mineru "" 0.5)')" "peste rezervare"
asteapta "amprentă diferită: decontat, decizie respinsă" "$(ca service_role - "SELECT (x->>'decontat')||'|'||(x->>'arbitraj_inregistrat') FROM public.fn_ofertare_ocr_scrie_arbitraj($Z2, '$(AR "$D1" "$(sha alt)" ales_mineru "" 0.01 abc)') x")" "true|false"
Z3=$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.1)")
asteapta "text_propus doar whitespace: decontat, decizie respinsă" "$(ca service_role - "SELECT x->>'arbitraj_inregistrat' FROM public.fn_ofertare_ocr_scrie_arbitraj($Z3, '$(AR "$D1" "$(sha i1)" text_propus '\n\t ' 0.01)') x")" false
refuz "citita → arbitrata fără marcajul comparației" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'arbitrata')" "nu e marcată"
asteapta "arbitraj ales_mineru: text derivat" "$(ca service_role - "SELECT public.fn_ofertare_ocr_scrie_arbitraj($Z1, '$(AR "$D1" "$(sha i1)" ales_mineru 56 0.015)')->>'arbitraj_inregistrat'")" true
asteapta "textul ales = citirea MinerU (nu «56» trimis)" "$(q "SELECT text_ales FROM public.ofertare_ocr_arbitraje WHERE dezacord_id=$D1")" "0.056"
refuz "rezervare decontată de două ori" service_role - "SELECT public.fn_ofertare_ocr_scrie_arbitraj($Z1, '$(AR "$D1" "$(sha i1)" ales_mineru "" 0.01)')" "deja închisă"
Z4=$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.1)")
asteapta "al doilea apel pe același dezacord: costul rămâne, decizia nu" "$(ca service_role - "SELECT x->>'arbitraj_inregistrat' FROM public.fn_ofertare_ocr_scrie_arbitraj($Z4, '$(AR "$D1" "$(sha i1)" ales_lighton "" 0.01)') x")" false
for D in "$D2:p0326_b0_t5" "$D3:p0326_b0_rr0" "$D4:p0326_b0_t9" "$D5:p0326_b0_rr2" "$D6:p0326_b1_banda" "$D7:p0326_b0_rr4" "$D8:p0326_b0_t10"; do
  Zx=$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.05)")
  id=${D%%:*}; it=${D#*:}; hs=$(q "SELECT item_sha256 FROM public.ofertare_ocr_dezacorduri WHERE id=$id")
  asteapta "arbitraj pe $it" "$(ca service_role - "SELECT public.fn_ofertare_ocr_scrie_arbitraj($Zx, '$(AR "$id" "$hs" ales_lighton "" 0.01)')->>'arbitraj_inregistrat'")" true
done
MAN=$(q "SELECT document_id||'|'||pagina||'|'||item_id||'|'||item_sha256 FROM public.ofertare_ocr_dezacorduri WHERE rulare_id=$R" | LC_ALL=C sort | awk '{printf "%s\n", $0}' | sha256sum | cut -d' ' -f1)
refuz "marcaj cu număr greșit" service_role - "SELECT public.fn_ofertare_ocr_comparatie_gata($R, 2, '$MAN')" "Declarate 2"
refuz "marcaj cu număr corect și amprentă greșită" service_role - "SELECT public.fn_ofertare_ocr_comparatie_gata($R, 8, '$(sha lista)')" "Amprenta manifestului"
asteapta "marcaj comparație încheiată (amprenta calculată ca pipeline-ul)" "$(ca service_role - "SELECT public.fn_ofertare_ocr_comparatie_gata($R, 8, '$MAN')->>'nr'")" 8
refuz "marcaj a doua oară" service_role - "SELECT public.fn_ofertare_ocr_comparatie_gata($R, 8, '$MAN')" "o singură dată"
refuz "dezacord după marcaj" service_role - "SELECT public.fn_ofertare_ocr_scrie_dezacord($R, '$(DZ 325 p0325_b1_r1 "$(sha i9)")')" "încheierea comparației"
Z5=$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R, 0.05)")
refuz "citita → arbitrata cu rezervare deschisă" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'arbitrata')" "rezervări deschise"
asteapta "abandon înainte de 15 min refuzat" "$(ca service_role - "SELECT public.fn_ofertare_ocr_rezervare_abandon($Z5)")" f
q "UPDATE public.ofertare_ocr_rezervari SET creat_la = now() - interval '20 minutes' WHERE id=$Z5" >/dev/null
asteapta "abandon după 15 min" "$(ca service_role - "SELECT public.fn_ofertare_ocr_rezervare_abandon($Z5)")" t
asteapta "cost / rezervat / abandonat" "$(q "SELECT cost_usd||'|'||cost_rezervat||'|'||cost_abandonat FROM public.ofertare_ocr_rulari WHERE id=$R")" "0.1150|0.0000|0.0500"
asteapta "ai_usage_log: fiecare apel decontat" "$(q "SELECT count(*) FROM public.ai_usage_log WHERE function_name='ofertare-ocr-arbitreaza'")" 11

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
refuz "reconciliat cu stare de cititor" service_role - "$(SP $R 325 reconciliat "$T2" "$H2" reconciliere citit NULL)" "check constraint"
asteapta "text reconciliat 325" "$(ca service_role - "$(SP $R 325 reconciliat "$T2" "$H2" reconciliere reconciliat NULL)->>'deja'")" false
refuz "finalizata fără reconcilierea paginii 326" service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'finalizata')" "fără rezultat reconciliat"
ca service_role - "$(SP $R 326 reconciliat "$T3" "$H3" reconciliere needs_human NULL)" >/dev/null
asteapta "arbitrata → finalizata (327 exclusă nu cere reconciliere)" "$(ca service_role - "SELECT public.fn_ofertare_ocr_stare($R, 'finalizata')->>'stare'")" finalizata

# ── apel plătit decontat după anulare ────────────────────────────────────────────────────────────────────
R2=$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 15)->>'rulare_id'")
ca service_role - "SELECT public.fn_ofertare_ocr_preia('lighton-mineru-v2')" >/dev/null; umple "$R2"
ca service_role - "SELECT public.fn_ofertare_ocr_stare($R2, 'citita')" >/dev/null
Z6=$(ca service_role - "SELECT public.fn_ofertare_ocr_cost_rezerva($R2, 0.05)")
refuz "anulare: editor" authenticated "$EDIT" "SELECT public.fn_ofertare_ocr_anuleaza($R2)" "fără drept"
asteapta "anulare: responsabil (cu apel în zbor)" "$(ca authenticated "$RESP" "SELECT public.fn_ofertare_ocr_anuleaza($R2)->>'ok'")" true
asteapta "apelul în zbor se decontează după anulare" "$(ca service_role - "SELECT public.fn_ofertare_ocr_scrie_arbitraj($Z6, '$(AR 0 x needs_human "" 0.02)')->>'arbitraj_inregistrat'")" false
asteapta "costul apelului rămâne în evidență" "$(q "SELECT cost_usd||'|'||cost_rezervat FROM public.ofertare_ocr_rulari WHERE id=$R2")" "0.0200|0.0000"

# ── concurență reală (două sesiuni simultane) ────────────────────────────────────────────────────────────
R3=$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 1)->>'rulare_id'")
ca service_role - "SELECT public.fn_ofertare_ocr_preia('lighton-mineru-v2')" >/dev/null
( ca service_role - "$(SP "$R3" 325 lighton "$T1" "$H1")->>'deja'" > /tmp/ocr_c1 & ca service_role - "$(SP "$R3" 325 lighton "$T1" "$H1")->>'deja'" > /tmp/ocr_c2 & wait )
asteapta "două scrieri identice simultane: una nouă, una «deja»" "$(cat /tmp/ocr_c1 /tmp/ocr_c2 | sort | tr '\n' ' ')" "false true "
umple "$R3"; ca service_role - "SELECT public.fn_ofertare_ocr_stare($R3, 'citita')" >/dev/null
( ca service_role - "SELECT coalesce(public.fn_ofertare_ocr_cost_rezerva($R3, 0.6)::text, 'refuz')" > /tmp/ocr_c1 &
  ca service_role - "SELECT coalesce(public.fn_ofertare_ocr_cost_rezerva($R3, 0.6)::text, 'refuz')" > /tmp/ocr_c2 & wait )
asteapta "două rezervări simultane de 0,6 sub plafonul 1: exact una trece" "$(grep -c refuz /tmp/ocr_c1 /tmp/ocr_c2 | awk -F: '{s+=$2} END {print s}')" 1
asteapta "plafonul respectat după cursă" "$(q "SELECT cost_rezervat FROM public.ofertare_ocr_rulari WHERE id=$R3")" 0.6000
ca service_role - "SELECT public.fn_ofertare_ocr_stare($R3, 'oprita', 'test concurenta')" >/dev/null

# ── imagini diferite la aceeași pagină: rularea nu poate trece la citita ─────────────────────────────────
R4=$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 1)->>'rulare_id'")
ca service_role - "SELECT public.fn_ofertare_ocr_preia('lighton-mineru-v2')" >/dev/null
ca service_role - "$(SP "$R4" 325 lighton "$T1" "$H1")" >/dev/null; ca service_role - "$(SP "$R4" 325 mineru "$T2" "$H2" MinerU2.5-Pro citit "$IB")" >/dev/null
for c in lighton mineru; do ca service_role - "$(SP "$R4" 326 $c "$T3" "$H3")" >/dev/null; ca service_role - "$(SP "$R4" 327 $c '' "$H0" x exclus NULL "$EXCL")" >/dev/null; done
refuz "citita cu cititori pe imagini diferite" service_role - "SELECT public.fn_ofertare_ocr_stare($R4, 'citita')" "pereche comparabilă"
ca service_role - "SELECT public.fn_ofertare_ocr_stare($R4, 'oprita', 'test imagini')" >/dev/null
R5=$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_ocr_cerere(102, ARRAY[1247]::bigint[], 1)->>'rulare_id'")
ca service_role - "SELECT public.fn_ofertare_ocr_preia('lighton-mineru-v2')" >/dev/null
for c in lighton mineru; do ca service_role - "$(SP "$R5" 325 $c "$T1" "$H1")" >/dev/null; ca service_role - "$(SP "$R5" 326 $c "$T3" "$H3")" >/dev/null; done
ca service_role - "$(SP "$R5" 327 lighton '' "$H0" x exclus NULL "$EXCL")" >/dev/null
ca service_role - "$(SP "$R5" 327 mineru '' "$H0" x exclus NULL '{"motiv_excludere":"formular"}')" >/dev/null
refuz "citita cu motive de excludere diferite" service_role - "SELECT public.fn_ofertare_ocr_stare($R5, 'citita')" "pereche comparabilă"
ca service_role - "SELECT public.fn_ofertare_ocr_stare($R5, 'oprita', 'test motive')" >/dev/null

# ── heartbeat ────────────────────────────────────────────────────────────────────────────────────────────
asteapta "heartbeat" "$(ca service_role - "SELECT public.fn_ofertare_ocr_heartbeat(true, 'test')")" t
asteapta "heartbeat scris" "$(q "SELECT ultim_ok||'|'||ultim_mesaj||'|'||activ FROM public.procese_heartbeat WHERE cheie='ocr_local_ofertare'")" "true|test|true"

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
