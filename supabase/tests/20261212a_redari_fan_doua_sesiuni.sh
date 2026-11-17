#!/usr/bin/env bash
# Proba de CONCURENȚĂ, ROLURI și RLS pentru 20261212a (FAN Courier, runda 2 a PR #1118) — DOAR pe CLONĂ, cu DOUĂ sesiuni psql reale (L25).
# Tiparul: supabase/tests/20261225a_executie_uscare_doua_sesiuni.sh. PGlite are o singură conexiune: aceste scenarii NU sunt probate local;
# scriptul e NETESTAT pe PostgreSQL (serverul de cod nu are psql) — îl rulează coordonatorul pe clonă, cu 20261212a aplicată acolo.
# Rulare din Git Bash, cu psql de Windows; conexiunea după `--` (parola din pgpass, niciodată pe linia de comandă):
#   PSQL=/c/Users/Public/pgsql/bin/psql.exe LOT=<uuid lot de test> OWNER=<uuid owner> EDITOR=<uuid editor Redări, ne-owner> VIEWER=<uuid viewer Redări> \
#     bash supabase/tests/20261212a_redari_fan_doua_sesiuni.sh --sistem <system_identifier clonă> -- -h <host clonă> -p <port> -U postgres -d postgres
# Garda țintei: system_identifier = --sistem, altfel refuz (22) înainte de orice scriere. 20261212a aplicată (23). LOT = un lot al proiectului de
#   TEST (ex. TEST-RAZVAN) cu cel puțin 3 plicuri active, neexpediate, fără rânduri FAN (24); OWNER / EDITOR / VIEWER există cu rolul cerut (24).
# Datele: rânduri SINTETICE în red_fan_loturi / red_fan_awb pe LOT (marcaj TEST, hash 'a'×64, AWB-uri 999…), comise (sesiunile trebuie să le
#   vadă) și șterse la final (trap): ca postgres, într-o tranzacție, cu trigger-ul gărzii marcajului dezactivat DOAR în acea tranzacție.
#   Contactele NU se modifică persistent (S1 rulează într-o tranzacție anulată). Revenirea 20261212a cere tabele goale: rulează proba înaintea ei.
# Identitatea sesiunilor: auth.uid() din ambele surse JWT, rolul authenticated. Bariera: un lock consultativ (cheie bigint) luat de sesiunea care
#   „ține” DUPĂ apelul ei; a doua sesiune pornește abia când bariera e ținută. Codul fiecărei sesiuni se păstrează (wait PID, fără `|| true`).
# SCENARIILE și REZULTATELE AȘTEPTATE:
#   K1 claim concurent pe ACELEAȘI rânduri: A rezervă (tranzacție deschisă 3 s), B trimite aceeași rezervare → B AȘTEAPTĂ (≥ 1 s, lock-ul
#      lotului), apoi refuz P0001 („nu mai sunt aprobate”); în BD rândurile sunt in_curs cu O SINGURĂ cheie (a lui A).
#   K2 la fel, dar A anulează (ROLLBACK) → B așteaptă, apoi rezervă el (o cheie, a lui B).
#   S1 amprenta surselor în tranzacția rezervării: contactul unui deținător al plicului schimbat (necomis, aceeași tranzacție) înaintea claim-ului
#      cu amprenta veche → P0001 („datele de contact … s-au schimbat”); ROLLBACK (nimic persistent).
#   S2 contact schimbat de ALTĂ sesiune și ținut necomis în timpul claim-ului → claim-ul NU așteaptă (citire fără lock) și reușește: schimbarea
#      comisă după rezervare e „după rezervare” (documentat în migrare); A face ROLLBACK (contactul rămâne neschimbat).
#   U1 urmărire concurentă, aceeași versiune citită: A scrie (deschisă), B scrie → B așteaptă rândul, apoi {scrise: 0, depasite: 1}; final:
#      datele lui A, versiunea +1.
#   M1 aprobare (A, deschisă; prima aprobare a lotului) + schimbarea marcajului (B) → B așteaptă lock-ul lotului, apoi P0001.
#   R1 roluri reale: EDITOR (ne-owner) → claim / aprobare / urmărire = 42501; propunerea editorului pe un plic al lotului = OK (anulată);
#      VIEWER → SELECT pe red_fan_awb = 0 rânduri (RLS); anon → EXECUTE pe fn_red_fan_claim_lot = 42501; UPDATE direct pe red_fan_awb ca
#      authenticated owner = 42501 (fără drept de scriere).
# Ieșire: 0 = toate OK; 1 = un scenariu a picat; 2 = argumente; 22 = altă țintă; 23 = 20261212a neaplicată; 24 = lot / conturi nepotrivite.
set -euo pipefail
PSQL="${PSQL:-psql}"
export PGCLIENTENCODING=UTF8
SISTEM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sistem) SISTEM="${2:-}"; shift 2 ;;
    --) shift; break ;;
    *) echo "argument necunoscut: $1 (conexiunea vine după --)" >&2; exit 2 ;;
  esac
done
CONN=("$@")
[[ "$SISTEM" =~ ^[0-9]+$ ]] || { echo "lipseste --sistem <system_identifier al clonei> (numar)" >&2; exit 2; }
for v in LOT OWNER EDITOR VIEWER; do
  [[ "${!v:-}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "$v lipsa sau invalid (uuid)" >&2; exit 2; }
done
cd "$(dirname "$0")/../.."
TMP="$(mktemp -d ./.concurenta_20261212a.XXXXXX)"
q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" "$@"; }
SUF="$(printf '%06d' $(( $$ % 1000000 )))"
curata() {
  cat > "$TMP/curata.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN;
ALTER TABLE public.red_fan_loturi DISABLE TRIGGER USER;
DELETE FROM public.red_fan_awb WHERE lot_id = '$LOT';
DELETE FROM public.red_fan_loturi WHERE lot_id = '$LOT';
ALTER TABLE public.red_fan_loturi ENABLE TRIGGER USER;
COMMIT;
SQL
  if ! q -f "$TMP/curata.sql" >/dev/null; then echo "ATENTIE: curatenia a picat; de sters manual pe clona randurile FAN ale lotului $LOT" >&2
  else echo "curatenie: randurile FAN sintetice ale lotului $LOT sterse"; fi
  rm -rf "$TMP"
}
REAL="$(q -c "SELECT system_identifier FROM pg_control_system()")"
if [ "$REAL" != "$SISTEM" ]; then echo "REFUZ: system_identifier al bazei ($REAL) <> --sistem ($SISTEM)" >&2; exit 22; fi
if [ "$(q -c "SELECT to_regprocedure('public.fn_red_fan_claim_lot(uuid, uuid[], text[], text[])') IS NOT NULL")" != "t" ]; then
  echo "REFUZ: 20261212a nu e aplicata pe clona" >&2; exit 23
fi
if [ "$(q -c "SELECT (SELECT count(*) FROM public.red_plicuri WHERE lot_id = '$LOT' AND stare = 'activ' AND awb IS NULL AND data_expediere IS NULL) >= 3
            AND NOT EXISTS (SELECT 1 FROM public.red_fan_awb WHERE lot_id = '$LOT') AND NOT EXISTS (SELECT 1 FROM public.red_fan_loturi WHERE lot_id = '$LOT')
            AND EXISTS (SELECT 1 FROM public.profiles WHERE id = '$OWNER' AND is_owner IS TRUE)
            AND EXISTS (SELECT 1 FROM public.profiles WHERE id = '$EDITOR' AND is_owner IS NOT TRUE)
            AND EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = '$EDITOR' AND module = 'redari' AND access_level IN ('admin', 'editor'))
            AND EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = '$VIEWER' AND module = 'redari' AND access_level = 'viewer')")" != "t" ]; then
  echo "REFUZ: LOT fara 3 plicuri active neexpediate / cu randuri FAN, sau OWNER / EDITOR / VIEWER nepotriviti" >&2; exit 24
fi
trap curata EXIT
# trei plicuri ale lotului (ordinea după număr): P1, P2 pentru claim, P3 pentru urmărire
mapfile -t PL < <(q -c "SELECT id FROM public.red_plicuri WHERE lot_id = '$LOT' AND stare = 'activ' AND awb IS NULL AND data_expediere IS NULL ORDER BY nr_plic LIMIT 3")
H="$(printf 'a%.0s' $(seq 64))"
pregateste() {   # $1 = starea rândurilor P1/P2 (aprobat); rândul P3 = generat cu AWB sintetic, versiunea 0
  cat > "$TMP/prep.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN;
ALTER TABLE public.red_fan_loturi DISABLE TRIGGER USER;
DELETE FROM public.red_fan_awb WHERE lot_id = '$LOT';
DELETE FROM public.red_fan_loturi WHERE lot_id = '$LOT';
ALTER TABLE public.red_fan_loturi ENABLE TRIGGER USER;
INSERT INTO public.red_fan_loturi (lot_id, proiect_id, test, marcat_de, prima_aprobare_la, prima_aprobare_de)
  SELECT id, proiect_id, true, '$OWNER', ${2:-now()}, ${3:-"'$OWNER'"} FROM public.red_loturi_plicuire WHERE id = '$LOT';
INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, stare, hash_date, propus_de, aprobat_de, aprobat_la)
  SELECT proiect_id, lot_id, id, nr_plic, '$1', '$H', '$OWNER', CASE WHEN '$1' = 'propus' THEN NULL ELSE '$OWNER'::uuid END, CASE WHEN '$1' = 'propus' THEN NULL ELSE now() END
    FROM public.red_plicuri WHERE id IN ('${PL[0]}', '${PL[1]}');
INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, stare, hash_date, propus_de, aprobat_de, aprobat_la, cerere_id, awb, generat_la)
  SELECT proiect_id, lot_id, id, nr_plic, 'generat', '$H', '$OWNER', '$OWNER', now(), gen_random_uuid(), '999$SUF' || '0003', now() FROM public.red_plicuri WHERE id = '${PL[2]}';
COMMIT;
SQL
  q -f "$TMP/prep.sql" >/dev/null
}
JWT() { echo "SELECT set_config('request.jwt.claim.sub', '$1', true), set_config('request.jwt.claims', json_build_object('sub', '$1', 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;"; }
ECHO_SQLSTATE='\echo R=:LAST_ERROR_SQLSTATE'
asteapta() {
  echo "DO \$b\$ DECLARE i int := 0; BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND objsubid = 1 AND granted) LOOP
      PERFORM pg_sleep(0.05); i := i + 1; IF i > 400 THEN RAISE EXCEPTION 'bariera $1 nu a aparut'; END IF; END LOOP; END \$b\$;"
}
# sesiunea A: apelul (ca $3), apoi bariera, 3 s, apoi $4 (COMMIT / ROLLBACK)
sesiune_a() { printf '%s\n' "\\set ON_ERROR_STOP 1" "BEGIN; $(JWT "${3:-$OWNER}")" "SELECT $2;" "SELECT pg_advisory_xact_lock($1);" "SELECT pg_sleep(3);" "${4:-COMMIT};"; }
# sesiunea B: așteaptă bariera, apoi apelul; tipărește T0 / R / T1 (secunde) și SQLSTATE-ul unei erori (ON_ERROR_STOP 0, \echo imediat după)
sesiune_b() {
  printf '%s\n' "\\set ON_ERROR_STOP 1" "$(asteapta "$1")" "\\set ON_ERROR_STOP 0" "BEGIN; $(JWT "${3:-$OWNER}")" "SET LOCAL lock_timeout = '20s';" \
    "SELECT 'T0=' || extract(epoch FROM clock_timestamp());" "SELECT 'R=' || ($2)::text;" "$ECHO_SQLSTATE" "SELECT 'T1=' || extract(epoch FROM clock_timestamp());" "COMMIT;"
}
ESEC=0
rez() { if [ "$1" = ok ]; then echo "OK   $2"; else echo "ESEC $2" >&2; ESEC=1; fi; }
doua() {   # $1 bariera, $2 apel A, $3 apel B, $4 final A, $5 rol B → ieșirea lui B în $TMP/b.out; codurile păstrate
  sesiune_a "$1" "$2" "$OWNER" "${4:-COMMIT}" > "$TMP/a.sql"; sesiune_b "$1" "$3" "${5:-$OWNER}" > "$TMP/b.sql"
  q -f "$TMP/a.sql" > "$TMP/a.out" 2>&1 & local pa=$!
  "$PSQL" -X -q -At "${CONN[@]}" -f "$TMP/b.sql" > "$TMP/b.out" 2>&1 & local pb=$!
  local ca=0 cb=0; wait "$pa" || ca=$?; wait "$pb" || cb=$?
  echo "$ca $cb"
}
asteptat() { awk -F= '/^T0=/{a=$2} /^T1=/{b=$2} END{ if (b - a >= 1) print "da"; else print "nu" }' "$TMP/b.out"; }
# fn_red_fan_surse e internă (fără EXECUTE pentru authenticated): amprenta se calculează ÎNAINTE, ca postgres (cum o calculează funcția edge din citiri)
SURSE() { q -c "SELECT string_agg(quote_literal(public.fn_red_fan_surse(plic_id)), ',' ORDER BY id) FROM public.red_fan_awb WHERE plic_id IN ('${PL[0]}', '${PL[1]}')"; }
CLAIM_CU() { echo "public.fn_red_fan_claim_lot('$LOT', ARRAY(SELECT id FROM public.red_fan_awb WHERE plic_id IN ('${PL[0]}', '${PL[1]}') ORDER BY id), ARRAY['$H', '$H'], ARRAY[$1])"; }

# K1
pregateste aprobat; S="$(SURSE)"
read -r CA CB < <(doua 1212001 "$(CLAIM_CU "$S")" "$(CLAIM_CU "$S")")
CHEI="$(q -c "SELECT count(DISTINCT cerere_id) || '/' || count(*) FILTER (WHERE stare = 'in_curs') FROM public.red_fan_awb WHERE plic_id IN ('${PL[0]}', '${PL[1]}')")"
[ "$CA" = 0 ] && grep -q '^R=P0001$' "$TMP/b.out" && [ "$(asteptat)" = da ] && [ "$CHEI" = "1/2" ] && rez ok "K1 claim concurent: B a asteptat, apoi P0001; o singura cheie ($CHEI)" || rez esec "K1 (A=$CA B=$CB chei=$CHEI): $(tr '\n' ' ' < "$TMP/b.out")"
# K2
pregateste aprobat; S="$(SURSE)"
read -r CA CB < <(doua 1212002 "$(CLAIM_CU "$S")" "$(CLAIM_CU "$S")" ROLLBACK)
CHEI="$(q -c "SELECT count(DISTINCT cerere_id) || '/' || count(*) FILTER (WHERE stare = 'in_curs') FROM public.red_fan_awb WHERE plic_id IN ('${PL[0]}', '${PL[1]}')")"
grep -Eq '^R=[0-9a-f-]{36}$' "$TMP/b.out" && [ "$(asteptat)" = da ] && [ "$CHEI" = "1/2" ] && rez ok "K2 A anulat: B a asteptat, apoi a rezervat (o cheie)" || rez esec "K2 (A=$CA B=$CB chei=$CHEI): $(tr '\n' ' ' < "$TMP/b.out")"
# S1 (o sesiune, tranzacție anulată): contactul schimbat după calculul amprentei → refuz
pregateste aprobat; S="$(SURSE)"
DET="$(q -c "SELECT c.detinator_id FROM public.red_convocari c JOIN public.red_detinatori_contact d ON d.detinator_id = c.detinator_id WHERE c.plic_id = '${PL[0]}' AND c.stare = 'activ' AND c.sters_la IS NULL LIMIT 1")"
printf '%s\n' "\\set ON_ERROR_STOP 0" "BEGIN;" "UPDATE public.red_detinatori_contact SET telefon = coalesce(telefon, '') || '9' WHERE detinator_id = '$DET';" \
  "$(JWT "$OWNER")" "SELECT 'R=' || ($(CLAIM_CU "$S"))::text;" "$ECHO_SQLSTATE" "ROLLBACK;" > "$TMP/s1.sql"
"$PSQL" -X -q -At "${CONN[@]}" -f "$TMP/s1.sql" > "$TMP/s1.out" 2>&1 || true   # codul nu contează aici: rezultatul e linia R=
[ -n "$DET" ] && grep -q '^R=P0001$' "$TMP/s1.out" && grep -q 'datele de contact' "$TMP/s1.out" && rez ok "S1 contact schimbat inainte de claim: P0001, nimic rezervat" || rez esec "S1 (det=$DET): $(tr '\n' ' ' < "$TMP/s1.out")"
# S2: contact ținut necomis de A (ROLLBACK la final); claim-ul lui B nu așteaptă și reușește
pregateste aprobat; S="$(SURSE)"
read -r CA CB < <(doua 1212003 "1 FROM (SELECT 1) x; UPDATE public.red_detinatori_contact SET telefon = coalesce(telefon, '') || '9' WHERE detinator_id = '$DET'" "$(CLAIM_CU "$S")" ROLLBACK)
grep -Eq '^R=[0-9a-f-]{36}$' "$TMP/b.out" && [ "$(asteptat)" = nu ] && rez ok "S2 contact necomis in alta sesiune: claim-ul nu asteapta si rezerva (schimbarea ar fi dupa rezervare)" || rez esec "S2 (A=$CA B=$CB): $(tr '\n' ' ' < "$TMP/b.out")"
# U1
pregateste aprobat
R3="$(q -c "SELECT id FROM public.red_fan_awb WHERE plic_id = '${PL[2]}'")"; A3="999${SUF}0003"
URM() { echo "public.fn_red_fan_urmarire('$LOT', '[{\"id\":\"$R3\",\"awb\":\"$A3\",\"versiune\":0,\"urmarire_stare\":\"$1\",\"ultim_eveniment\":\"$2\",\"ultim_eveniment_la\":\"$3\",\"ridicat_propus\":null,\"livrat_la\":null,\"retur_propus\":null}]'::jsonb)"; }
read -r CA CB < <(doua 1212004 "$(URM ridicat C0 '2026-11-10 10:00:00')" "$(URM in_tranzit S1 '2026-11-11 10:00:00')")
FIN="$(q -c "SELECT urmarire_stare || '/' || versiune_urmarire FROM public.red_fan_awb WHERE id = '$R3'")"
[ "$CA" = 0 ] && grep -q '"depasite": 1' "$TMP/b.out" && grep -q '"scrise": 0' "$TMP/b.out" && [ "$(asteptat)" = da ] && [ "$FIN" = "ridicat/1" ] && rez ok "U1 urmarire concurenta: B depasit (nescris), final $FIN" || rez esec "U1 (A=$CA B=$CB final=$FIN): $(tr '\n' ' ' < "$TMP/b.out")"
# M1: lotul fără prima aprobare, rândurile propuse; A aprobă (deschisă), B schimbă marcajul → așteaptă, apoi P0001
pregateste propus NULL NULL
APR="public.fn_red_fan_aproba('$LOT', ARRAY(SELECT id FROM public.red_fan_awb WHERE plic_id IN ('${PL[0]}', '${PL[1]}') ORDER BY id), ARRAY['$H', '$H'])"
read -r CA CB < <(doua 1212005 "$APR" "public.fn_red_fan_lot_marcheaza('$LOT', false)")
[ "$CA" = 0 ] && grep -q '^R=P0001$' "$TMP/b.out" && [ "$(asteptat)" = da ] && rez ok "M1 aprobare + schimbarea marcajului: B a asteptat, apoi P0001" || rez esec "M1 (A=$CA B=$CB): $(tr '\n' ' ' < "$TMP/b.out")"
# R1: roluri reale + RLS
pregateste aprobat; S="$(SURSE)"
rol() { printf '%s\n' "\\set ON_ERROR_STOP 0" "BEGIN; $2" "SELECT 'R=' || ($3)::text;" "$ECHO_SQLSTATE" "ROLLBACK;" > "$TMP/r.sql"; "$PSQL" -X -q -At "${CONN[@]}" -f "$TMP/r.sql" 2>&1 | grep '^R=' | tail -1; }
[ "$(rol e "$(JWT "$EDITOR")" "$(CLAIM_CU "$S")")" = "R=42501" ] && rez ok "R1 editor: claim 42501" || rez esec "R1 editor claim"
[ "$(rol e "$(JWT "$EDITOR")" "$APR")" = "R=42501" ] && rez ok "R1 editor: aprobare 42501" || rez esec "R1 editor aprobare"
[ "$(rol e "$(JWT "$EDITOR")" "$(URM ridicat C0 '2026-11-10 10:00:00')")" = "R=42501" ] && rez ok "R1 editor: urmarire 42501" || rez esec "R1 editor urmarire"
[ "$(rol v "$(JWT "$VIEWER")" "(SELECT count(*) FROM public.red_fan_awb)")" = "R=0" ] && rez ok "R1 viewer: RLS ascunde evidenta (0)" || rez esec "R1 viewer RLS"
[ "$(rol a "SET LOCAL ROLE anon;" "$(CLAIM_CU "$S")")" = "R=42501" ] && rez ok "R1 anon: claim 42501" || rez esec "R1 anon"
[ "$(rol o "$(JWT "$OWNER")" "(WITH u AS (UPDATE public.red_fan_awb SET motiv = 'x' WHERE lot_id = '$LOT' RETURNING 1) SELECT count(*) FROM u)")" = "R=42501" ] && rez ok "R1 owner: UPDATE direct 42501" || rez esec "R1 owner UPDATE direct"
exit "$ESEC"
