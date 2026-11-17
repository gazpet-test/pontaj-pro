#!/usr/bin/env bash
# Proba de CONCURENȚĂ, ROLURI și RLS pentru 20261212a (FAN Courier, PR #1118, runda 3) — DOAR pe CLONĂ, cu DOUĂ sesiuni psql reale (L25).
# Tiparul: supabase/tests/20261225a_executie_uscare_doua_sesiuni.sh. PGlite are o singură conexiune: aceste scenarii NU sunt probate local;
# scriptul e NETESTAT pe PostgreSQL de autor (serverul de cod nu are psql) — îl rulează coordonatorul pe clonă, cu 20261212a aplicată acolo.
# Rulare din Git Bash, cu psql de Windows; conexiunea după `--` (parola din pgpass, niciodată pe linia de comandă):
#   (A) clonă FĂRĂ date Redări — fixture-ul sintetic (supabase/tests/20261212a_redari_fan_fixture.sql), creat la început și șters la final:
#   PSQL=/c/Users/Public/pgsql/bin/psql.exe bash supabase/tests/20261212a_redari_fan_doua_sesiuni.sh --sistem <system_identifier clonă> --cu-fixture \
#     -- -h <host clonă> -p <port> -U postgres -d postgres
#   (B) un lot existent al unui proiect de TEST (cod TEST-…): LOT=<uuid> OWNER=<uuid> EDITOR=<uuid Redări ne-owner> VIEWER=<uuid Redări ne-owner>
#     în mediu, fără --cu-fixture.
# Garda țintei: system_identifier = --sistem, altfel refuz (22) înainte de orice scriere. 20261212a aplicată (23). LOT = lot al unui proiect
#   TEST-… cu cel puțin 3 plicuri active, neexpediate, fără AWB și fără NICIUN rând FAN; OWNER / EDITOR / VIEWER cu rolurile cerute (24).
# Datele probei: rânduri SINTETICE în red_fan_loturi (marcajul probei: marcat_la = 2001-01-01, unic) / red_fan_awb (identificatorii lor se
#   notează la inserare: RETURNING id), comise (sesiunile trebuie să le vadă). Curățenia (trap EXIT) șterge DOAR aceste rânduri, după
#   identificatori, cu garda marcajului oprită DOAR în acea tranzacție; apoi verifică dispariția. Contactul schimbat în S2b / S2c se
#   restaurează la valoarea citită la început (și în curățenie); la final se verifică valoarea. Revenirea 20261212a cere tabele goale:
#   rulează proba înaintea ei.
# Curățenia eșuată = cod 3 (VIZIBIL), iar fișierele de diagnostic rămân (calea e tipărită); la orice eșec de scenariu (cod 1) rămân și ele.
# Identitatea sesiunilor: auth.uid() din ambele surse JWT, rolul authenticated. Barierele: lock-uri consultative cu chei UNICE PE RULARE
#   (baza din pid + aleator), luate de sesiunea care „ține” DUPĂ apelul ei; a doua sesiune pornește abia când bariera e ținută. Codul FIECĂREI
#   sesiuni se păstrează (wait PID) și intră în verdict. Sesiunea B scrie: R= rezultatul apelului, E= SQLSTATE-ul (00000 = fără eroare),
#   M= mesajul erorii (prefixe SEPARATE); timpul T0 / T1 se citește ÎN AFARA tranzacției (după ROLLBACK-ul celei abortate).
# SCENARIILE și REZULTATELE AȘTEPTATE (toate cer codul 0 al ambelor procese psql):
#   K1 claim concurent pe ACELEAȘI rânduri: A rezervă (deschisă 3 s), B la fel → B AȘTEAPTĂ (≥ 1 s), apoi E=P0001 cu motivul exact
#      „nu mai sunt aprobate cu aceleasi date”; în BD rândurile sunt in_curs cu O SINGURĂ cheie (a lui A).
#   K2 la fel, A face ROLLBACK → B așteaptă, apoi rezervă el (E=00000, R=cheia lui); o singură cheie.
#   S1 contactul unui deținător al plicului schimbat (necomis, ACEEAȘI tranzacție) înaintea claim-ului cu amprenta veche → E=P0001
#      „datele de contact / plicul s-au schimbat”; ROLLBACK; rândurile rămân aprobate, contactul neschimbat.
#   S2a contact schimbat de ALTĂ sesiune, ținut NECOMIS în timpul claim-ului, apoi ROLLBACK → claim-ul NU așteaptă și rezervă.
#   S2b la fel, dar A face COMMIT DUPĂ verificarea claim-ului (contactele nu se blochează) → claim-ul NU așteaptă și rezervă (corpul aprobat,
#      verificat pe datele comise la momentul lui); după COMMIT contactul e cel nou, amprenta surselor de acum DIFERĂ de cea rezervată
#      (diferența apare la următoarea propunere). Garanția declarată: rezervarea fixează corpul aprobat verificat la claim, NU „datele actuale
#      la COMMIT / la POST” (migrarea, la fn_red_fan_claim_lot). Contactul se restaurează.
#   S2c contactul schimbat și COMIS înaintea claim-ului (după citirea amprentei) → E=P0001 „datele de contact …”, nimic rezervat; restaurat.
#   U1 urmărire concurentă, aceeași versiune citită: A scrie (deschisă), B scrie → B așteaptă, apoi {scrise 0, depasite 1}; final: A, versiunea 1.
#   U2 (runda 3, P2) urmărire „fără evenimente” (ultim_eveniment_la NULL) pe un rând cu C0 cunoscut → {scrise 0, pastrate 1}; evenimentul și
#      ridicarea propusă rămân, versiunea + 1.
#   M1 aprobare (A, deschisă; prima aprobare a lotului) + schimbarea marcajului (B) → B așteaptă, apoi E=P0001 „lotul a fost aprobat o data”.
#   T1 (runda 3, P1) tirajul: A începe tirajul cu cheia K1 (deschisă), B (editor) cere tirajul cu K2 → B așteaptă lock-ul lotului, apoi
#      E=RD020 „tirajul s-a schimbat”; final: tiraj_cheie = K1, nr. 1.
#   R1 roluri reale + RLS: EDITOR → claim / aprobare / urmărire = 42501; EDITOR → propunerea pe un plic al lotului = OK (rândul devine
#      „propus”, propus_de = EDITOR; anulată) și începerea tirajului = OK (anulată); EDITOR → înlocuirea tirajului = 42501; VIEWER → SELECT pe
#      red_fan_awb = 0 rânduri, tirajul = 42501; anon → claim = 42501; UPDATE direct pe red_fan_awb ca owner (instrucțiune proprie) = 42501.
# Ieșire: 0 = toate OK; 1 = un scenariu a picat; 2 = argumente; 3 = curățenia a picat; 22 = altă țintă; 23 = 20261212a neaplicată;
#   24 = lot / conturi nepotrivite; 25 = fixture-ul nu s-a putut crea.
set -euo pipefail
PSQL="${PSQL:-psql}"
export PGCLIENTENCODING=UTF8
SISTEM=""; CU_FIXTURE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --sistem) SISTEM="${2:-}"; shift 2 ;;
    --cu-fixture) CU_FIXTURE=1; shift ;;
    --) shift; break ;;
    *) echo "argument necunoscut: $1 (conexiunea vine după --)" >&2; exit 2 ;;
  esac
done
CONN=("$@")
[[ "$SISTEM" =~ ^[0-9]+$ ]] || { echo "lipseste --sistem <system_identifier al clonei> (numar)" >&2; exit 2; }
FIXTURE_SQL=supabase/tests/20261212a_redari_fan_fixture.sql
if [ "$CU_FIXTURE" = 1 ]; then   # identificatorii fixați din fixture (o singură definiție: fișierul .sql îi verifică)
  LOT=f12a0000-0000-4000-8000-0000000000f1; OWNER=f12a0000-0000-4000-8000-0000000000a1
  EDITOR=f12a0000-0000-4000-8000-0000000000a2; VIEWER=f12a0000-0000-4000-8000-0000000000a3
fi
for v in LOT OWNER EDITOR VIEWER; do
  [[ "${!v:-}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "$v lipsa sau invalid (uuid)" >&2; exit 2; }
done
cd "$(dirname "$0")/../.."
TMP="$(mktemp -d ./.concurenta_20261212a.XXXXXX)"
# psql de Windows poate scrie CRLF: \r se scoate din tot ce se compară (pipefail păstrează codul lui psql)
q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" "$@" | tr -d '\r'; }
# barierele: chei consultative unice pe rulare (< 2^31; objid = cheia, classid = 0)
BAZA=$(( ($$ % 30000) * 65536 + (RANDOM % 4096) * 16 ))
MARCAJ_LA='2001-01-01 00:00:00+00'
AWB3="9$(printf '%05d' $(( RANDOM % 100000 )))$(printf '%04d' $(( $$ % 10000 )))"
ESEC=0; FIXTURE_CREAT=0; DET=""; TEL_ORIG=""; TEL_ATINS=0
touch "$TMP/ids_awb"
lista_ids() { tr -d '\r' < "$TMP/ids_awb" | tr -s '\n' ',' | sed 's/^,//; s/,$//'; }

restaureaza_contact() {   # contactul deținătorului din S2b / S2c, la valoarea citită la început (ca postgres, fără JWT); doar dacă a fost atins
  [ -n "$DET" ] && [ "$TEL_ATINS" = 1 ] || return 0
  q -c "UPDATE public.red_detinatori_contact SET telefon = $TEL_ORIG WHERE detinator_id = '$DET'" >/dev/null
  [ "$(q -c "SELECT telefon IS NOT DISTINCT FROM $TEL_ORIG FROM public.red_detinatori_contact WHERE detinator_id = '$DET'")" = t ]
}
curata() {
  local rc=$? ok=1
  set +e
  restaureaza_contact || { echo "ATENTIE: contactul $DET nu s-a restaurat" >&2; ok=0; }
  cat > "$TMP/curata.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN;
ALTER TABLE public.red_fan_loturi DISABLE TRIGGER trg_red_fan_loturi_garda;
DELETE FROM public.red_fan_awb WHERE id = ANY('{$(lista_ids)}'::uuid[]);
DELETE FROM public.red_fan_loturi WHERE lot_id = '$LOT' AND marcat_la = '$MARCAJ_LA';
ALTER TABLE public.red_fan_loturi ENABLE TRIGGER trg_red_fan_loturi_garda;
COMMIT;
SQL
  q -f "$TMP/curata.sql" > "$TMP/curata.out" 2>&1 || ok=0
  local rest; rest="$(q -c "SELECT (SELECT count(*) FROM public.red_fan_awb WHERE id = ANY('{$(lista_ids)}'::uuid[]))
    + (SELECT count(*) FROM public.red_fan_loturi WHERE lot_id = '$LOT' AND marcat_la = '$MARCAJ_LA')" 2>>"$TMP/curata.out")" || ok=0
  [ "$rest" = 0 ] || { echo "ATENTIE: au ramas randuri FAN ale probei ($rest)" >&2; ok=0; }
  if [ "$FIXTURE_CREAT" = 1 ]; then
    q -v sistem="$SISTEM" -v actiune=sterge -f "$FIXTURE_SQL" > "$TMP/fixture_sterge.out" 2>&1 || { echo "ATENTIE: stergerea fixture-ului a picat" >&2; ok=0; }
  fi
  if [ "$ok" = 1 ]; then echo "curatenie: randurile probei sterse dupa identificatori$( [ "$FIXTURE_CREAT" = 1 ] && echo '; fixture-ul sters si verificat')"; fi
  if [ "$ok" = 1 ] && [ "$rc" = 0 ] && [ "$ESEC" = 0 ]; then rm -rf "$TMP"
  else echo "fisierele de diagnostic raman in $TMP" >&2; fi
  if [ "$ok" = 0 ]; then echo "ATENTIE: CURATENIA A PICAT (cod 3); de verificat manual pe clona lotul $LOT" >&2; exit 3; fi
  exit "$rc"
}
REAL="$(q -c "SELECT system_identifier FROM pg_control_system()")"
if [ "$REAL" != "$SISTEM" ]; then echo "REFUZ: system_identifier al bazei ($REAL) <> --sistem ($SISTEM)" >&2; rm -rf "$TMP"; exit 22; fi
if [ "$(q -c "SELECT to_regprocedure('public.fn_red_fan_claim_lot(uuid, uuid[], text[], text[])') IS NOT NULL AND to_regprocedure('public.fn_red_fan_tiraj(uuid, text, text)') IS NOT NULL")" != "t" ]; then
  echo "REFUZ: 20261212a (forma rundei 3) nu e aplicata pe clona" >&2; rm -rf "$TMP"; exit 23
fi
trap curata EXIT
if [ "$CU_FIXTURE" = 1 ]; then
  if ! q -v sistem="$SISTEM" -v actiune=creeaza -f "$FIXTURE_SQL" > "$TMP/fixture_creeaza.out" 2>&1; then
    echo "REFUZ: fixture-ul nu s-a putut crea: $(tr '\n' ' ' < "$TMP/fixture_creeaza.out")" >&2; exit 25
  fi
  FIXTURE_CREAT=1; echo "fixture: $(grep '^FIXTURE_CREAT' "$TMP/fixture_creeaza.out")"
fi
if [ "$(q -c "SELECT (SELECT count(*) FROM public.red_plicuri WHERE lot_id = '$LOT' AND stare = 'activ' AND awb IS NULL AND data_expediere IS NULL) >= 3
            AND EXISTS (SELECT 1 FROM public.red_loturi_plicuire l JOIN public.red_proiecte p ON p.id = l.proiect_id WHERE l.id = '$LOT' AND p.cod LIKE 'TEST-%')
            AND NOT EXISTS (SELECT 1 FROM public.red_fan_awb WHERE lot_id = '$LOT') AND NOT EXISTS (SELECT 1 FROM public.red_fan_loturi WHERE lot_id = '$LOT')
            AND EXISTS (SELECT 1 FROM public.profiles WHERE id = '$OWNER' AND is_owner IS TRUE)
            AND EXISTS (SELECT 1 FROM public.profiles WHERE id = '$EDITOR' AND is_owner IS NOT TRUE)
            AND EXISTS (SELECT 1 FROM public.profiles WHERE id = '$VIEWER' AND is_owner IS NOT TRUE)
            AND EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = '$EDITOR' AND module = 'redari' AND access_level IN ('admin', 'editor'))
            AND EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = '$VIEWER' AND module = 'redari' AND access_level = 'viewer')")" != "t" ]; then
  echo "REFUZ: LOT (proiect TEST-…) fara 3 plicuri active neexpediate / cu randuri FAN, sau OWNER / EDITOR / VIEWER nepotriviti" >&2; exit 24
fi
# trei plicuri ale lotului (ordinea după număr): P1, P2 pentru claim, P3 pentru urmărire
mapfile -t PL < <(q -c "SELECT id FROM public.red_plicuri WHERE lot_id = '$LOT' AND stare = 'activ' AND awb IS NULL AND data_expediere IS NULL ORDER BY nr_plic LIMIT 3")
H="$(printf 'a%.0s' $(seq 64))"; K1="$(printf 'b%.0s' $(seq 64))"; K2="$(printf 'c%.0s' $(seq 64))"; K3="$(printf 'd%.0s' $(seq 64))"
# deținătorul cu contact al plicului P1 (S1 / S2*) și telefonul lui de la început (literal SQL, NULL inclus)
DET="$(q -c "SELECT c.detinator_id FROM public.red_convocari c JOIN public.red_detinatori_contact d ON d.detinator_id = c.detinator_id WHERE c.plic_id = '${PL[0]}' AND c.stare = 'activ' AND c.sters_la IS NULL ORDER BY c.detinator_id LIMIT 1")"
[ -n "$DET" ] || { echo "REFUZ: plicul P1 nu are un detinator cu rand de contact" >&2; exit 24; }
TEL_ORIG="$(q -c "SELECT coalesce(quote_literal(telefon), 'NULL') FROM public.red_detinatori_contact WHERE detinator_id = '$DET'")"
pregateste() {   # $1 = starea rândurilor P1/P2 (aprobat / propus); $2 = cu / fara prima aprobare; P3 = generat cu AWB sintetic, versiunea 0
  local pa="now()" pd="'$OWNER'"
  if [ "${2:-cu}" = fara ]; then pa=NULL; pd=NULL; fi
  cat > "$TMP/prep.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN;
ALTER TABLE public.red_fan_loturi DISABLE TRIGGER trg_red_fan_loturi_garda;
DELETE FROM public.red_fan_awb WHERE id = ANY('{$(lista_ids)}'::uuid[]);
DELETE FROM public.red_fan_loturi WHERE lot_id = '$LOT' AND marcat_la = '$MARCAJ_LA';
ALTER TABLE public.red_fan_loturi ENABLE TRIGGER trg_red_fan_loturi_garda;
INSERT INTO public.red_fan_loturi (lot_id, proiect_id, test, marcat_de, marcat_la, prima_aprobare_la, prima_aprobare_de)
  SELECT id, proiect_id, true, '$OWNER', '$MARCAJ_LA', $pa, $pd FROM public.red_loturi_plicuire WHERE id = '$LOT';
INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, stare, hash_date, propus_de, aprobat_de, aprobat_la)
  SELECT proiect_id, lot_id, id, nr_plic, '$1', '$H', '$OWNER', CASE WHEN '$1' = 'propus' THEN NULL ELSE '$OWNER'::uuid END, CASE WHEN '$1' = 'propus' THEN NULL ELSE now() END
    FROM public.red_plicuri WHERE id IN ('${PL[0]}', '${PL[1]}') RETURNING id;
INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, stare, hash_date, propus_de, aprobat_de, aprobat_la, cerere_id, awb, generat_la)
  SELECT proiect_id, lot_id, id, nr_plic, 'generat', '$H', '$OWNER', '$OWNER', now(), gen_random_uuid(), '$AWB3', now() FROM public.red_plicuri WHERE id = '${PL[2]}' RETURNING id;
COMMIT;
SQL
  q -f "$TMP/prep.sql" >> "$TMP/ids_awb"
}
JWT() { echo "SELECT set_config('request.jwt.claim.sub', '$1', true), set_config('request.jwt.claims', json_build_object('sub', '$1', 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;"; }
asteapta() {
  echo "DO \$b\$ DECLARE i int := 0; BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid::bigint = $1 AND objsubid = 1 AND granted) LOOP
      PERFORM pg_sleep(0.05); i := i + 1; IF i > 400 THEN RAISE EXCEPTION 'bariera $1 nu a aparut'; END IF; END LOOP; END \$b\$;"
}
# sesiunea A: [JWT $3 sau postgres fără JWT dacă $3 e gol], instrucțiunea $2, apoi bariera, 3 s, apoi $4 (COMMIT / ROLLBACK); ON_ERROR_STOP 1
sesiune_a() {
  printf '%s\n' "\\set ON_ERROR_STOP 1" "BEGIN;"
  if [ -n "$3" ]; then JWT "$3"; fi
  printf '%s\n' "$2;" "SELECT pg_advisory_xact_lock($1);" "SELECT pg_sleep(3);" "${4:-COMMIT};"
}
# sesiunea B: bariera (ON_ERROR_STOP 1), T0, apoi tranzacția cu JWT-ul $3: R= rezultatul expresiei $2, E= SQLSTATE, M= mesajul (ON_ERROR_STOP 0);
# COMMIT (pe o tranzacție abortată = ROLLBACK), apoi T1 ÎN AFARA tranzacției (ON_ERROR_STOP 1: un T1 lipsă = cod ≠ 0)
sesiune_b() {
  printf '%s\n' "\\set ON_ERROR_STOP 1" "$(asteapta "$1")" "SELECT 'T0=' || extract(epoch FROM clock_timestamp());" "\\set ON_ERROR_STOP 0" \
    "BEGIN;" "$(JWT "$3")" "SET LOCAL lock_timeout = '20s';" "SELECT 'R=' || ($2)::text;" '\echo E=:LAST_ERROR_SQLSTATE' '\echo M=:LAST_ERROR_MESSAGE' "COMMIT;" \
    "\\set ON_ERROR_STOP 1" "SELECT 'T1=' || extract(epoch FROM clock_timestamp());"
}
rez() { if [ "$1" = ok ]; then echo "OK   $2"; else echo "ESEC $2" >&2; ESEC=1; fi; }
doua() {   # $1 bariera (+BAZA), $2 instrucțiunea A, $3 expresia B, $4 final A, $5 uid A ('' = postgres fără JWT), $6 uid B → coduri „CA CB”
  local k=$(( BAZA + $1 ))
  sesiune_a "$k" "$2" "${5-$OWNER}" "${4:-COMMIT}" > "$TMP/a$1.sql"; sesiune_b "$k" "$3" "${6:-$OWNER}" > "$TMP/b$1.sql"
  q -f "$TMP/a$1.sql" > "$TMP/a$1.out" 2>&1 & local pa=$!
  "$PSQL" -X -q -At "${CONN[@]}" -f "$TMP/b$1.sql" > "$TMP/b$1.out" 2>&1 & local pb=$!
  local ca=0 cb=0; wait "$pa" || ca=$?; wait "$pb" || cb=$?
  echo "$ca $cb"
}
val() { tr -d '\r' < "$2" | grep -m1 "^$1=" | cut -d= -f2- || true; }   # prima linie cu prefixul (R / E / M / T0 / T1 / S / C)
asteptat() { tr -d '\r' < "$1" | awk -F= '/^T0=/{a=$2} /^T1=/{b=$2} END{ if (a == "" || b == "") print "lipsa"; else if (b - a >= 1) print "da"; else print "nu" }'; }
# sesiune unică, ON_ERROR_STOP 0: preambulul $2 (JWT / rol / UPDATE), corpul $3 (o instrucțiune; rezultate cu R= / S=), E= / M= imediat după,
# apoi ROLLBACK; codul procesului în ieșire („C=…”)
singur() {
  printf '%s\n' "\\set ON_ERROR_STOP 0" "BEGIN;" "$2" "$3" '\echo E=:LAST_ERROR_SQLSTATE' '\echo M=:LAST_ERROR_MESSAGE' "${4:-ROLLBACK};" > "$TMP/s_$1.sql"
  local c=0; "$PSQL" -X -q -At "${CONN[@]}" -f "$TMP/s_$1.sql" > "$TMP/s_$1.out" 2>&1 || c=$?
  echo "C=$c" >> "$TMP/s_$1.out"
}
# fn_red_fan_surse e internă (fără EXECUTE pentru authenticated): amprenta se calculează ÎNAINTE, ca postgres (cum o calculează funcția edge din citiri)
SURSE() { q -c "SELECT string_agg(quote_literal(public.fn_red_fan_surse(plic_id)), ',' ORDER BY id) FROM public.red_fan_awb WHERE plic_id IN ('${PL[0]}', '${PL[1]}') AND id = ANY('{$(lista_ids)}'::uuid[])"; }
CLAIM_CU() { echo "public.fn_red_fan_claim_lot('$LOT', ARRAY(SELECT id FROM public.red_fan_awb WHERE plic_id IN ('${PL[0]}', '${PL[1]}') AND stare NOT IN ('eroare', 'anulat') ORDER BY id), ARRAY['$H', '$H'], ARRAY[$1])"; }
CHEI() { q -c "SELECT count(DISTINCT cerere_id) || '/' || count(*) FILTER (WHERE stare = 'in_curs') FROM public.red_fan_awb WHERE id = ANY('{$(lista_ids)}'::uuid[]) AND plic_id IN ('${PL[0]}', '${PL[1]}')"; }
TEL() { q -c "SELECT coalesce(telefon, '<NULL>') FROM public.red_detinatori_contact WHERE detinator_id = '$DET'"; }
TEL0="$(TEL)"
SCHIMBA_TEL="UPDATE public.red_detinatori_contact SET telefon = coalesce(telefon, '') || '9' WHERE detinator_id = '$DET'"
MOTIV_CLAIM='nu mai sunt aprobate cu aceleasi date'; MOTIV_SURSE='datele de contact / plicul s-au schimbat'
MOTIV_MARCAJ='lotul a fost aprobat o data; marcajul de test nu se mai schimba'; MOTIV_TIRAJ='tirajul s-a schimbat'

# K1
pregateste aprobat; S="$(SURSE)"
read -r CA CB < <(doua 1 "SELECT $(CLAIM_CU "$S")" "$(CLAIM_CU "$S")"); C="$(CHEI)"
[ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$(val E "$TMP/b1.out")" = P0001 ] && val M "$TMP/b1.out" | grep -qF "$MOTIV_CLAIM" && [ -z "$(val R "$TMP/b1.out")" ] \
  && [ "$(asteptat "$TMP/b1.out")" = da ] && [ "$C" = 1/2 ] \
  && rez ok "K1 claim concurent: B a asteptat, apoi P0001 ($MOTIV_CLAIM); o singura cheie ($C)" || rez esec "K1 (A=$CA B=$CB chei=$C): $(tr '\n' ' ' < "$TMP/b1.out")"
# K2
pregateste aprobat; S="$(SURSE)"
read -r CA CB < <(doua 2 "SELECT $(CLAIM_CU "$S")" "$(CLAIM_CU "$S")" ROLLBACK); C="$(CHEI)"
[ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$(val E "$TMP/b2.out")" = 00000 ] && [[ "$(val R "$TMP/b2.out")" =~ ^[0-9a-f-]{36}$ ]] && [ "$(asteptat "$TMP/b2.out")" = da ] && [ "$C" = 1/2 ] \
  && rez ok "K2 A anulat: B a asteptat, apoi a rezervat (o cheie)" || rez esec "K2 (A=$CA B=$CB chei=$C): $(tr '\n' ' ' < "$TMP/b2.out")"
# S1 (o sesiune, tranzacție anulată): contactul schimbat după calculul amprentei → refuz
pregateste aprobat; S="$(SURSE)"
singur s1 "$SCHIMBA_TEL; $(JWT "$OWNER")" "SELECT 'R=' || ($(CLAIM_CU "$S"))::text;"
[ "$(val C "$TMP/s_s1.out")" = 0 ] && [ "$(val E "$TMP/s_s1.out")" = P0001 ] && val M "$TMP/s_s1.out" | grep -qF "$MOTIV_SURSE" && [ -z "$(val R "$TMP/s_s1.out")" ] \
  && [ "$(CHEI)" = 0/0 ] && [ "$(TEL)" = "$TEL0" ] \
  && rez ok "S1 contact schimbat inainte de claim (aceeasi tranzactie): P0001, nimic rezervat, contact neschimbat" || rez esec "S1 (det=$DET): $(tr '\n' ' ' < "$TMP/s_s1.out")"
# S2a: contact ținut NECOMIS de A (postgres), apoi ROLLBACK; claim-ul lui B nu așteaptă și rezervă
pregateste aprobat; S="$(SURSE)"
read -r CA CB < <(doua 3 "$SCHIMBA_TEL" "$(CLAIM_CU "$S")" ROLLBACK ''); C="$(CHEI)"
[ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$(val E "$TMP/b3.out")" = 00000 ] && [[ "$(val R "$TMP/b3.out")" =~ ^[0-9a-f-]{36}$ ]] && [ "$(asteptat "$TMP/b3.out")" = nu ] \
  && [ "$C" = 1/2 ] && [ "$(TEL)" = "$TEL0" ] \
  && rez ok "S2a contact necomis in alta sesiune (ROLLBACK): claim-ul nu asteapta si rezerva; contactul neschimbat" || rez esec "S2a (A=$CA B=$CB chei=$C): $(tr '\n' ' ' < "$TMP/b3.out")"
# S2b: aceeași, dar A face COMMIT după verificarea claim-ului → claim-ul rezervă corpul aprobat; sursele de acum diferă (după rezervare)
pregateste aprobat; S="$(SURSE)"; TEL_ATINS=1
read -r CA CB < <(doua 4 "$SCHIMBA_TEL" "$(CLAIM_CU "$S")" COMMIT ''); C="$(CHEI)"; S_DUPA="$(SURSE)"; T_DUPA="$(TEL)"
restaureaza_contact || rez esec "S2b: contactul nu s-a restaurat"
[ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$(val E "$TMP/b4.out")" = 00000 ] && [[ "$(val R "$TMP/b4.out")" =~ ^[0-9a-f-]{36}$ ]] && [ "$(asteptat "$TMP/b4.out")" = nu ] \
  && [ "$C" = 1/2 ] && [ "$T_DUPA" != "$TEL0" ] && [ "$S_DUPA" != "$S" ] && [ "$(TEL)" = "$TEL0" ] \
  && rez ok "S2b contact COMIS dupa verificarea claim-ului: claim-ul rezerva corpul aprobat (fara asteptare); amprenta de acum difera (dupa rezervare); contact restaurat" \
  || rez esec "S2b (A=$CA B=$CB chei=$C tel=$T_DUPA): $(tr '\n' ' ' < "$TMP/b4.out")"
# S2c: contactul schimbat și COMIS înaintea claim-ului (după citirea amprentei) → refuz, nimic rezervat
pregateste aprobat; S="$(SURSE)"; TEL_ATINS=1
q -c "$SCHIMBA_TEL" >/dev/null
singur s2c "$(JWT "$OWNER")" "SELECT 'R=' || ($(CLAIM_CU "$S"))::text;"
C="$(CHEI)"; restaureaza_contact || rez esec "S2c: contactul nu s-a restaurat"
[ "$(val C "$TMP/s_s2c.out")" = 0 ] && [ "$(val E "$TMP/s_s2c.out")" = P0001 ] && val M "$TMP/s_s2c.out" | grep -qF "$MOTIV_SURSE" && [ "$C" = 0/0 ] && [ "$(TEL)" = "$TEL0" ] \
  && rez ok "S2c contact comis inaintea claim-ului: P0001, nimic rezervat; contact restaurat" || rez esec "S2c: $(tr '\n' ' ' < "$TMP/s_s2c.out")"
# U1
pregateste aprobat
R3="$(q -c "SELECT id FROM public.red_fan_awb WHERE plic_id = '${PL[2]}' AND id = ANY('{$(lista_ids)}'::uuid[])")"
URM() { echo "public.fn_red_fan_urmarire('$LOT', '[{\"id\":\"$R3\",\"awb\":\"$AWB3\",\"versiune\":$4,\"urmarire_stare\":\"$1\",\"ultim_eveniment\":$2,\"ultim_eveniment_la\":$3,\"ridicat_propus\":$5,\"livrat_la\":null,\"retur_propus\":null}]'::jsonb)"; }
read -r CA CB < <(doua 5 "SELECT $(URM ridicat '"C0"' '"2026-11-10 10:00:00"' 0 '"2026-11-10"')" "$(URM in_tranzit '"S1"' '"2026-11-11 10:00:00"' 0 null)")
FIN="$(q -c "SELECT urmarire_stare || '/' || versiune_urmarire FROM public.red_fan_awb WHERE id = '$R3'")"; RB="$(val R "$TMP/b5.out")"
[ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$(val E "$TMP/b5.out")" = 00000 ] && grep -q '"depasite": 1' <<< "$RB" && grep -q '"scrise": 0' <<< "$RB" && grep -q '"pastrate": 0' <<< "$RB" \
  && [ "$(asteptat "$TMP/b5.out")" = da ] && [ "$FIN" = "ridicat/1" ] \
  && rez ok "U1 urmarire concurenta: B depasit (nescris), final $FIN" || rez esec "U1 (A=$CA B=$CB final=$FIN): $(tr '\n' ' ' < "$TMP/b5.out")"
# U2 (o sesiune): pe rândul cu C0 cunoscut (versiunea 1, din U1), un răspuns fără evenimente NU șterge ce se știe
singur u2 "$(JWT "$OWNER")" "SELECT 'R=' || $(URM fara_evenimente null null 1 null)::text;" COMMIT
U2="$(q -c "SELECT coalesce(ultim_eveniment, '-') || '/' || coalesce(ridicat_propus::text, '-') || '/' || urmarire_stare || '/' || versiune_urmarire FROM public.red_fan_awb WHERE id = '$R3'")"
RU2="$(val R "$TMP/s_u2.out")"
[ "$(val C "$TMP/s_u2.out")" = 0 ] && [ "$(val E "$TMP/s_u2.out")" = 00000 ] && grep -q '"pastrate": 1' <<< "$RU2" && grep -q '"scrise": 0' <<< "$RU2" && [ "$U2" = "C0/2026-11-10/ridicat/2" ] \
  && rez ok "U2 urmarire fara evenimente pe un rand cu C0: pastrat (doar verificat), $U2" || rez esec "U2 (rand=$U2): $(tr '\n' ' ' < "$TMP/s_u2.out")"
# M1: lotul fără prima aprobare, rândurile propuse; A aprobă (deschisă), B schimbă marcajul → așteaptă, apoi P0001
pregateste propus fara
APR="public.fn_red_fan_aproba('$LOT', ARRAY(SELECT id FROM public.red_fan_awb WHERE plic_id IN ('${PL[0]}', '${PL[1]}') AND id = ANY('{$(lista_ids)}'::uuid[]) ORDER BY id), ARRAY['$H', '$H'])"
read -r CA CB < <(doua 6 "SELECT $APR" "public.fn_red_fan_lot_marcheaza('$LOT', false)")
[ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$(val E "$TMP/b6.out")" = P0001 ] && val M "$TMP/b6.out" | grep -qF "$MOTIV_MARCAJ" && [ "$(asteptat "$TMP/b6.out")" = da ] \
  && rez ok "M1 aprobare + schimbarea marcajului: B a asteptat, apoi P0001 ($MOTIV_MARCAJ)" || rez esec "M1 (A=$CA B=$CB): $(tr '\n' ' ' < "$TMP/b6.out")"
# T1: tirajul — A (owner) îl începe cu K1 (deschisă), B (editor) cere K2 → așteaptă lock-ul lotului, apoi RD020; final K1, nr. 1
pregateste aprobat
read -r CA CB < <(doua 7 "SELECT public.fn_red_fan_tiraj('$LOT', '$K1', NULL)" "public.fn_red_fan_tiraj('$LOT', '$K2', NULL)" COMMIT "$OWNER" "$EDITOR")
TF="$(q -c "SELECT tiraj_cheie = '$K1' AND tiraj_nr = 1 FROM public.red_fan_loturi WHERE lot_id = '$LOT' AND marcat_la = '$MARCAJ_LA'")"
[ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$(val E "$TMP/b7.out")" = RD020 ] && val M "$TMP/b7.out" | grep -qF "$MOTIV_TIRAJ" && [ "$(asteptat "$TMP/b7.out")" = da ] && [ "$TF" = t ] \
  && rez ok "T1 tiraj concurent: B a asteptat, apoi RD020 ($MOTIV_TIRAJ); tirajul ramas = K1, nr. 1" || rez esec "T1 (A=$CA B=$CB final=$TF): $(tr '\n' ' ' < "$TMP/b7.out")"
# R1: roluri reale + RLS (fiecare verificare = o instrucțiune, E= imediat după ea)
pregateste aprobat; S="$(SURSE)"
R1() {   # $1 eticheta, $2 preambul, $3 corpul, $4 E așteptat, $5 descriere, [$6 R așteptat (regex)], [$7 S așteptat (regex)]
  singur "r_$1" "$2" "$3"
  local c e r s; c="$(val C "$TMP/s_r_$1.out")"; e="$(val E "$TMP/s_r_$1.out")"; r="$(val R "$TMP/s_r_$1.out")"; s="$(val S "$TMP/s_r_$1.out")"
  [ "$c" = 0 ] && [ "$e" = "$4" ] && { [ -z "${6:-}" ] || [[ "$r" =~ $6 ]]; } && { [ -z "${7:-}" ] || [[ "$s" =~ $7 ]]; } \
    && rez ok "R1 $5 ($e)" || rez esec "R1 $5: C=$c E=$e R=$r S=$s $(tr '\n' ' ' < "$TMP/s_r_$1.out")"
}
R1 ec "$(JWT "$EDITOR")" "SELECT 'R=' || ($(CLAIM_CU "$S"))::text;" 42501 "editor: claim refuzat"
R1 ea "$(JWT "$EDITOR")" "SELECT 'R=' || ($APR)::text;" 42501 "editor: aprobare refuzata"
R1 eu "$(JWT "$EDITOR")" "SELECT 'R=' || ($(URM ridicat '"C0"' '"2026-11-10 10:00:00"' 0 null))::text;" 42501 "editor: urmarire refuzata"
# propunerea legitimă: două instrucțiuni (a doua citește efectul primei; dacă prima pică, a doua dă 25P02 și E ≠ 00000)
R1 ep "$(JWT "$EDITOR")" "SELECT 'R=' || public.fn_red_fan_propune('${PL[0]}', '$H', NULL)::text; SELECT 'S=' || stare || '/' || propus_de FROM public.red_fan_awb WHERE plic_id = '${PL[0]}' AND stare NOT IN ('eroare', 'anulat');" \
  00000 "editor: propunerea legitima executata (randul devine propus, propus_de = editor; anulata)" '^[0-9a-f-]{36}$' "^propus/$EDITOR\$"
R1 et "$(JWT "$EDITOR")" "SELECT 'R=' || (public.fn_red_fan_tiraj('$LOT', '$K3', NULL) ->> 'stare');" 00000 "editor: inceperea tirajului (legitima, anulata)" '^inceput$'
R1 ei "$(JWT "$EDITOR")" "SELECT 'R=' || public.fn_red_fan_tiraj('$LOT', '$K2', '$K1')::text;" 42501 "editor: inlocuirea tirajului refuzata (doar owner)"
R1 vs "$(JWT "$VIEWER")" "SELECT 'R=' || (SELECT count(*) FROM public.red_fan_awb)::text;" 00000 "viewer: RLS ascunde evidenta" '^0$'
R1 vt "$(JWT "$VIEWER")" "SELECT 'R=' || public.fn_red_fan_tiraj('$LOT', '$K3', NULL)::text;" 42501 "viewer: tirajul refuzat"
R1 an "SET LOCAL ROLE anon;" "SELECT 'R=' || ($(CLAIM_CU "$S"))::text;" 42501 "anon: claim refuzat (fara EXECUTE)"
R1 ou "$(JWT "$OWNER")" "UPDATE public.red_fan_awb SET motiv = 'x' WHERE id = ANY('{$(lista_ids)}'::uuid[]);" 42501 "owner: UPDATE direct (instructiune proprie) refuzat"
[ "$(TEL)" = "$TEL0" ] && rez ok "contactul deținătorului $DET are valoarea de la început" || rez esec "contactul $DET: $(TEL) <> $TEL0"
exit "$ESEC"
