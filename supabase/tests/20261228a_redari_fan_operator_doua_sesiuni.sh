#!/usr/bin/env bash
# Proba de CONCURENȚĂ pentru 20261228a (Redări FAN, felia F1: butonul unic al operatorului) — DOAR pe o CLONĂ DE ARUNCAT, cu DOUĂ (la E22 trei)
# sesiuni psql reale (L25). Tiparul: supabase/tests/20261212a_redari_fan_doua_sesiuni.sh. PGlite are o singură conexiune: scenariile de aici NU
# sunt probate local; scriptul e NETESTAT pe PostgreSQL de autor (serverul de cod nu are psql) — îl rulează coordonatorul pe clonă, cu 20261212a
# ȘI 20261228a aplicate acolo. Scriptul cere o clonă FĂRĂ date Redări: fixture-ul sintetic 20261212a (--cu-fixture, obligatoriu) + extensia lui de
# aici (al doilea operator, 10 loturi, 19 plicuri sintetice), create la început și șterse la final (trap EXIT), cu verificarea dispariției.
# Rulare din Git Bash, cu psql de Windows; conexiunea după `--` (parola din pgpass, niciodată pe linia de comandă):
#   PSQL=/c/Users/Public/pgsql/bin/psql.exe bash supabase/tests/20261228a_redari_fan_operator_doua_sesiuni.sh --sistem <system_identifier clonă> --cu-fixture \
#     -- -h <host clonă> -p <port> -U postgres -d postgres
# Garda țintei: system_identifier = --sistem, altfel refuz (22) înainte de orice scriere. 20261228a aplicată (23). Starea de pornire: red_fan_zi fără
#   rândul zilei de azi (Europe/Bucharest), red_fan_operatori / red_fan_intentii / red_fan_cereri_aprobare goale (24) — revenirea 20261228a le cere
#   goale, iar curățenia de aici le readuce așa (rândul zilei se șterge DOAR pentru că nu exista la început).
# Identitatea sesiunilor: auth.uid() din ambele surse JWT + rolul authenticated (OP1 = editorul fixture-ului, OP2 = al doilea editor, numiți operatori
#   de owner prin fn_red_fan_operator_seteaza). Barierele (P5, I5, E15): lock consultativ cu cheie UNICĂ pe rulare, luat de sesiunea A DUPĂ apelul ei;
#   B pornește abia când bariera e ținută. La E22: harness-ul H ține red_fan_setari FOR UPDATE (poziția 5) și eliberează DOAR când pg_stat_activity
#   arată ambele sesiuni în așteptare de lock; ordinea S1 / S2 se fixează din bash, pe pg_stat_activity (sesiunea următoare pornește abia când cea
#   dinainte așteaptă). Codul FIECĂRUI proces psql se păstrează (wait PID, fără `|| true`) și intră în verdict; sesiunea care poate pica scrie R= / E=
#   (SQLSTATE, 00000 = fără eroare) / M= pe linii separate; T0 / T1 se citesc ÎN AFARA tranzacției (așteptarea ≥ 1 s = a stat pe lock).
# SCENARIILE și REZULTATELE AȘTEPTATE (spec docs/redari/FAN_FLUX_OPERATOR_SPEC.md §7.2, §8.3, Anexa A E15 / E22):
#   P5  doi operatori pe muchie: zi absentă, limita_zi = 5; A (OP1, lotul LA, 3 plicuri, deschisă 3 s) și B (OP2, lotul LB, 3 plicuri) → B așteaptă la
#       poziția 5 (red_fan_setari), apoi primește {aprobate: [], numarate: 0, de_aprobat: 3}; rândul zilei = 3, consum 3, LB are 3 de_aprobat + o
#       cerere deschisă; exact unul a trecut.
#   I5  două intenții pe același lot: K1 aprobă 2 plicuri pe L5, arenda ei e expirată (mentenanță); A (OP1, K2, preluare, deschisă 3 s), B (OP1, K3) →
#       B așteaptă la poziția 1 (lotul), apoi RD030 (K2 e in_curs cu arenda în viitor); final: K1 neincheiata (comanda_noua), K2 in_curs, K3 absentă,
#       cele 2 rânduri cu intentie_cheie = K2, preluate o singură dată (A: preluate 2).
#   E15 tiraj ∥ comandă pe L4 (un rând generat sintetic + plicul nou P24): A (OP1) comanda P24 (deschisă), B (OP1) fn_red_fan_tiraj → B așteaptă la 1,
#       apoi RD031 (lotul nu e încheiat: P24 aprobat). Invers (P24 retras de operator, K4 expirată): A tirajul (deschisă, „inceput”), B comanda P24 cu
#       hash nou → B așteaptă la 1, apoi {incheiata: true, excluse: [lot_tiparit], de_trimis: []}, niciun rând viu nou pe P24.
#   E22a două loturi, un plic mutat (P propus în LV — rândul R —, mutat în LN), coregrafia S1 → S2 cu H pe 5: S1 (OP1, LV, Q1 + Q2) ține R și așteaptă la
#       5; S2 (OP2, LN, P) așteaptă la 3 pe un TUPLU din red_fan_awb (pg_locks), nu pe red_fan_setari; H eliberează → fără 40P01: R retras (plic_mutat),
#       Q1 / Q2 aprobat pe LV, rând nou R2 aprobat pe LN, un singur rând viu pe P.
#   E22b coregrafia S2 → S1: S2 ține R, așteaptă la 5; S1 așteaptă la 3 pe R; H eliberează → fără 40P01: R REFOLOSIT (lot_id = LN, aprobat, cheia KN),
#       Q1 / Q2 aprobat, R neretras; un singur rând viu pe P.
#   E22c MUTANTUL fazei L (poziția 3 doar cu rândurile lotului, fără rândurile vii ale plicurilor cerute), aceeași coregrafie ca E22b → S2 nu ține R,
#       așteaptă la 5; S1 ține R, așteaptă la 5 (coada S2, S1); H eliberează → S2 ajunge în faza M la UPDATE R (ținut de S1), S1 așteaptă 5 (ținut de
#       S2) → ciclu → EXACT una dintre sesiuni primește 40P01 (deadlock_timeout 300 ms, pus ca superuser înaintea rolului). Mutantul se pune cu
#       CREATE OR REPLACE din textul migrării (verificat: un singur loc) și se SCOATE la final (și în curățenie), cu amprenta corpului verificată =
#       cea de la început.
# Ieșire: 0 = toate OK; 1 = un scenariu a picat; 2 = argumente; 3 = curățenia a picat (VIZIBIL; fișierele de diagnostic rămân); 22 = altă țintă;
#   23 = 20261228a neaplicată; 24 = starea de pornire nu e curată; 25 = fixture-ul nu s-a putut crea; 26 / 27 / 28 = precondițiile FX001 / FX002 /
#   FX003 ale fixture-ului 20261212a (antetul lui). Durata: ~40 s (fiecare scenariu cu barieră ~3–4 s).
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
[ "$CU_FIXTURE" = 1 ] || { echo "F1: proba cere --cu-fixture (clona fara date Redari; fixture-ul sintetic + extensia lui)" >&2; exit 2; }
FIXTURE_SQL=supabase/tests/20261212a_redari_fan_fixture.sql
MIG=supabase/migrations/20261228a_redari_fan_operator.sql
# identificatorii fixture-ului 20261212a (o singură definiție: fișierul .sql îi verifică) + extensia F1 (prefix f128…, generați din numere)
OWNER=f12a0000-0000-4000-8000-0000000000a1; OP1=f12a0000-0000-4000-8000-0000000000a2; VIEWER=f12a0000-0000-4000-8000-0000000000a3
PROIECT=f12a0000-0000-4000-8000-0000000000b1; UAT=f12a0000-0000-4000-8000-0000000000c1; PARCELA=f12a0000-0000-4000-8000-0000000000d1
OP2=f1280000-0000-4000-8000-0000000000a4
fid() { printf 'f1280000-0000-4000-8000-%012x' "$1"; }
plic() { fid $((200 + $1)); }; lot() { fid $((400 + $1)); }
LA=$(lot 1); LB=$(lot 2); L5=$(lot 3); L4=$(lot 4); LV1=$(lot 5); LN1=$(lot 6); LV2=$(lot 7); LN2=$(lot 8); LV3=$(lot 9); LN3=$(lot 10)
kid() { printf 'f128ffff-0000-4000-8000-%012x' "$1"; }
cd "$(dirname "$0")/../.."
TMP="$(mktemp -d ./.concurenta_20261228a.XXXXXX)"
q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" "$@" | tr -d '\r'; }
BAZA=$(( ($$ % 30000) * 65536 + (RANDOM % 4096) * 16 ))
MARCAJ_LA='2001-01-01 00:00:00+00'
H="$(printf 'a%.0s' $(seq 64))"; H2="$(printf 'b%.0s' $(seq 64))"; HC="$(printf 'c%.0s' $(seq 64))"; KT="$(printf 'd%.0s' $(seq 64))"
ESEC=0; FIXTURE_CREAT=0; EXT_CREATA=0; JURNAL0=""; LIMITA0=""; MUTANT_ACTIV=0; MD5_COMANDA=""
LOTURI="'$LA','$LB','$L5','$L4','$LV1','$LN1','$LV2','$LN2','$LV3','$LN3'"
PLICURI="$(for i in $(seq 1 19); do printf "'%s'," "$(plic "$i")"; done | sed 's/,$//')"
IDS_EXT="$(for n in $(seq 101 119) $(seq 201 219) $(seq 301 319) $(seq 401 410); do printf "'%s'," "$(fid "$n")"; done)'$OP2'"
AZI="(now() AT TIME ZONE 'Europe/Bucharest')::date"

# ── fixture-ul F1 (extensia): al doilea editor (trigger-ul real creează profilul), 19 deținători + contacte + convocări + plicuri, 10 loturi ──
ext_creeaza() {
  cat > "$TMP/ext_creeaza.sql" <<SQL
\\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', '$OP2', 'authenticated', 'authenticated', 'fixture-fan-f1-op2@exemplu.invalid', '{}', '{}', now(), now());
DO \$t\$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '$OP2') THEN RAISE EXCEPTION 'FIXTURE_PRECONDITIE FX003: trigger-ul de pe auth.users nu a creat profilul op2' USING ERRCODE = 'FX003'; END IF; END \$t\$;
UPDATE public.profiles SET name = 'FIXTURE FAN OP2', is_owner = false WHERE id = '$OP2';
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('$OP2', 'redari', 'editor');
INSERT INTO public.red_loturi_plicuire (id, proiect_id, nr_lot, data_plicuire)
SELECT ('f1280000-0000-4000-8000-' || lpad(to_hex(400 + j), 12, '0'))::uuid, '$PROIECT', 'PP-99' || (20 + j), current_date FROM generate_series(1, 10) j;
INSERT INTO public.red_detinatori (id, parcela_id, nume, nume_normalizat, calitate)
SELECT ('f1280000-0000-4000-8000-' || lpad(to_hex(100 + i), 12, '0'))::uuid, '$PARCELA', 'FIXTURE F1 ' || i, 'FIXTURE F1 ' || i, 'proprietar' FROM generate_series(1, 19) i;
INSERT INTO public.red_detinatori_contact (detinator_id, telefon, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal, adresa_cunoscuta)
SELECT ('f1280000-0000-4000-8000-' || lpad(to_hex(100 + i), 12, '0'))::uuid, '07000002' || lpad(i::text, 2, '0'), 'Strada Fictiva F1 nr. ' || i, 'Sat Fictiv', 'Comuna Fictiva', 'Prahova', '100100', true FROM generate_series(1, 19) i;
DO \$s\$ BEGIN IF EXISTS (SELECT 1 FROM generate_series(1, 19) i WHERE public.fn_red_cheie_persoana(('f1280000-0000-4000-8000-' || lpad(to_hex(100 + i), 12, '0'))::uuid) IS NULL) THEN
  RAISE EXCEPTION 'FIXTURE_PRECONDITIE FX002: fn_red_cheie_persoana intoarce NULL' USING ERRCODE = 'FX002'; END IF; END \$s\$;
-- plicurile: 1-3 LA, 4-6 LB, 7-8 L5, 9-10 L4, 11-13 LV1, 14-16 LV2, 17-19 LV3 (loturile LN* pornesc goale)
INSERT INTO public.red_plicuri (id, proiect_id, uat_id, nr_plic, cheie_persoana, destinatar_nume, lot_id)
SELECT ('f1280000-0000-4000-8000-' || lpad(to_hex(200 + i), 12, '0'))::uuid, '$PROIECT', '$UAT', 'PL-ZFX-F1' || lpad(i::text, 2, '0'),
       public.fn_red_cheie_persoana(('f1280000-0000-4000-8000-' || lpad(to_hex(100 + i), 12, '0'))::uuid), 'FIXTURE F1 ' || i,
       ('f1280000-0000-4000-8000-' || lpad(to_hex(400 + CASE WHEN i <= 3 THEN 1 WHEN i <= 6 THEN 2 WHEN i <= 8 THEN 3 WHEN i <= 10 THEN 4 WHEN i <= 13 THEN 5 WHEN i <= 16 THEN 7 ELSE 9 END), 12, '0'))::uuid
  FROM generate_series(1, 19) i;
SELECT set_config('request.jwt.claim.sub', '$OWNER', true) IS NOT NULL AS ok \\gset
INSERT INTO public.red_convocari (id, detinator_id, canal, nr_document, calitate_document, plic_id)
SELECT ('f1280000-0000-4000-8000-' || lpad(to_hex(300 + i), 12, '0'))::uuid, ('f1280000-0000-4000-8000-' || lpad(to_hex(100 + i), 12, '0'))::uuid, 'posta', 'FIXTURE-FAN-F1-' || lpad(i::text, 2, '0'), 'proprietar',
       ('f1280000-0000-4000-8000-' || lpad(to_hex(200 + i), 12, '0'))::uuid FROM generate_series(1, 19) i;
SELECT set_config('request.jwt.claim.sub', '', true) IS NOT NULL AS ok \\gset
-- marcajul TEST al loturilor E15 / E22 (sintetic, marcat_la = marcajul probei); LA / LB / L5 primesc marcajul AUTOMAT din comandă
INSERT INTO public.red_fan_loturi (lot_id, proiect_id, test, marcat_de, marcat_la)
SELECT id, proiect_id, true, '$OWNER', '$MARCAJ_LA' FROM public.red_loturi_plicuire WHERE id IN ('$L4', '$LV1', '$LN1', '$LV2', '$LN2', '$LV3', '$LN3');
DO \$p\$ BEGIN
  IF (SELECT count(*) FROM public.red_plicuri WHERE id IN ($PLICURI) AND stare = 'activ' AND awb IS NULL AND data_expediere IS NULL) <> 19
     OR (SELECT count(*) FROM public.red_convocari WHERE plic_id IN ($PLICURI) AND stare = 'activ' AND sters_la IS NULL) <> 19
     OR (SELECT count(*) FROM public.red_loturi_plicuire WHERE id IN ($LOTURI)) <> 10 THEN RAISE EXCEPTION 'FIXTURE F1: postconditiile crearii nu sunt indeplinite'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '$OP2', true);
  IF coalesce(public.fn_red_nivel(), '-') <> 'editor' THEN RAISE EXCEPTION 'FIXTURE F1: op2 nu e editor Redari'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
END \$p\$;
COMMIT;
SQL
  q -f "$TMP/ext_creeaza.sql" > "$TMP/ext_creeaza.out" 2>&1
}
ext_sterge() {   # tot ce a scris proba pe obiectele F1 + extensia; apoi verifică dispariția (întoarce ≠ 0 dacă a rămas ceva)
  cat > "$TMP/ext_sterge.sql" <<SQL
\\set ON_ERROR_STOP 1
BEGIN;
ALTER TABLE public.red_fan_loturi DISABLE TRIGGER trg_red_fan_loturi_garda;
ALTER TABLE public.red_fan_zi DISABLE TRIGGER trg_red_fan_zi_garda;
DELETE FROM public.red_fan_zi_consum WHERE awb_id IN (SELECT id FROM public.red_fan_awb WHERE lot_id IN ($LOTURI) OR plic_id IN ($PLICURI));
DELETE FROM public.red_fan_awb WHERE lot_id IN ($LOTURI) OR plic_id IN ($PLICURI);
DELETE FROM public.red_fan_cereri_aprobare WHERE lot_id IN ($LOTURI);
DELETE FROM public.red_fan_intentii WHERE lot_id IN ($LOTURI);
DELETE FROM public.red_fan_loturi WHERE lot_id IN ($LOTURI);
DELETE FROM public.red_fan_zi WHERE zi_ro = $AZI;
DELETE FROM public.red_fan_operatori WHERE profile_id IN ('$OP1', '$OP2');
UPDATE public.red_fan_setari SET limita_zi = ${LIMITA0:-limita_zi};
ALTER TABLE public.red_fan_zi ENABLE TRIGGER trg_red_fan_zi_garda;
ALTER TABLE public.red_fan_loturi ENABLE TRIGGER trg_red_fan_loturi_garda;
ALTER TABLE public.red_jurnal DISABLE TRIGGER trg_red_jurnal_imuabil;
DELETE FROM public.red_jurnal WHERE id > ${JURNAL0:-9223372036854775807} AND (tabela LIKE 'red_fan_%' OR inregistrare_id IN ($IDS_EXT));
ALTER TABLE public.red_jurnal ENABLE TRIGGER trg_red_jurnal_imuabil;
DELETE FROM public.red_convocari WHERE plic_id IN ($PLICURI) OR detinator_id IN ($IDS_EXT);
DELETE FROM public.red_plicuri WHERE id IN ($PLICURI);
DELETE FROM public.red_loturi_plicuire WHERE id IN ($LOTURI);
DELETE FROM public.red_detinatori_contact WHERE detinator_id IN ($IDS_EXT);
DELETE FROM public.red_detinatori_token WHERE detinator_id IN ($IDS_EXT);
DELETE FROM public.red_detinatori WHERE id IN ($IDS_EXT);
DELETE FROM public.user_module_access WHERE profile_id = '$OP2';
DELETE FROM auth.users WHERE id = '$OP2';
DELETE FROM public.conturi_tip WHERE auth_user_id = '$OP2';
ALTER TABLE public.conturi_tip_jurnal DISABLE TRIGGER ALL;
DELETE FROM public.conturi_tip_jurnal WHERE auth_user_id = '$OP2';
ALTER TABLE public.conturi_tip_jurnal ENABLE TRIGGER ALL;
DELETE FROM public.profiles WHERE id = '$OP2';
COMMIT;
SQL
  q -f "$TMP/ext_sterge.sql" > "$TMP/ext_sterge.out" 2>&1 || return 1
  local rest; rest="$(q -c "SELECT (SELECT count(*) FROM public.red_fan_awb WHERE lot_id IN ($LOTURI) OR plic_id IN ($PLICURI))
    + (SELECT count(*) FROM public.red_fan_loturi WHERE lot_id IN ($LOTURI)) + (SELECT count(*) FROM public.red_fan_intentii WHERE lot_id IN ($LOTURI))
    + (SELECT count(*) FROM public.red_fan_cereri_aprobare WHERE lot_id IN ($LOTURI)) + (SELECT count(*) FROM public.red_fan_zi WHERE zi_ro = $AZI)
    + (SELECT count(*) FROM public.red_fan_operatori WHERE profile_id IN ('$OP1', '$OP2')) + (SELECT count(*) FROM public.red_plicuri WHERE id IN ($PLICURI))
    + (SELECT count(*) FROM public.red_loturi_plicuire WHERE id IN ($LOTURI)) + (SELECT count(*) FROM public.red_detinatori WHERE id IN ($IDS_EXT))
    + (SELECT count(*) FROM public.profiles WHERE id = '$OP2') + (SELECT count(*) FROM auth.users WHERE id = '$OP2')
    + (SELECT count(*) FROM public.red_jurnal WHERE id > ${JURNAL0:-9223372036854775807} AND tabela LIKE 'red_fan_%')
    + (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_red_jurnal_imuabil', 'trg_red_fan_zi_garda', 'trg_red_fan_loturi_garda') AND tgenabled <> 'O')")" || return 1
  [ "$rest" = 0 ]
}
mutant_scoate() {   # repune textul ORIGINAL al comenzii și verifică amprenta corpului
  [ "$MUTANT_ACTIV" = 1 ] || return 0
  q -f "$TMP/comanda_orig.sql" > "$TMP/comanda_restaurare.out" 2>&1 || return 1
  [ "$(q -c "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_red_fan_comanda(uuid, uuid, jsonb, text)'::regprocedure")" = "$MD5_COMANDA" ] && MUTANT_ACTIV=0
}
curata() {
  local rc=$? ok=1
  set +e
  mutant_scoate || { echo "ATENTIE: mutantul fn_red_fan_comanda NU s-a scos (amprenta diferita)" >&2; ok=0; }
  if [ "$EXT_CREATA" = 1 ]; then ext_sterge || { echo "ATENTIE: extensia F1 a fixture-ului nu s-a sters complet" >&2; ok=0; }; fi
  if [ "$FIXTURE_CREAT" = 1 ]; then
    q -v sistem="$SISTEM" -v actiune=sterge -f "$FIXTURE_SQL" > "$TMP/fixture_sterge.out" 2>&1 || { echo "ATENTIE: stergerea fixture-ului 20261212a a picat" >&2; ok=0; }
  fi
  [ "$ok" = 1 ] && echo "curatenie: randurile probei sterse dupa identificatori; fixture-ul si extensia F1 sterse si verificate; mutantul scos"
  if [ "$ok" = 1 ] && [ "$rc" = 0 ] && [ "$ESEC" = 0 ]; then rm -rf "$TMP"; else echo "fisierele de diagnostic raman in $TMP" >&2; fi
  if [ "$ok" = 0 ]; then echo "ATENTIE: CURATENIA A PICAT (cod 3); de verificat manual pe clona" >&2; exit 3; fi
  exit "$rc"
}
REAL="$(q -c "SELECT system_identifier FROM pg_control_system()")"
if [ "$REAL" != "$SISTEM" ]; then echo "REFUZ: system_identifier al bazei ($REAL) <> --sistem ($SISTEM)" >&2; rm -rf "$TMP"; exit 22; fi
if [ "$(q -c "SELECT to_regprocedure('public.fn_red_fan_comanda(uuid, uuid, jsonb, text)') IS NOT NULL AND to_regprocedure('public.fn_red_fan_operator_seteaza(uuid, boolean, text)') IS NOT NULL
               AND to_regprocedure('public.fn_red_fan_retrage(uuid, text)') IS NOT NULL AND to_regprocedure('public.fn_red_fan_tiraj(uuid, text, text)') IS NOT NULL
               AND to_regclass('public.red_fan_intentii') IS NOT NULL AND to_regclass('public.red_fan_zi') IS NOT NULL")" != t ]; then
  echo "REFUZ: 20261228a nu e aplicata pe clona" >&2; rm -rf "$TMP"; exit 23
fi
if [ "$(q -c "SELECT NOT EXISTS (SELECT 1 FROM public.red_fan_zi WHERE zi_ro = $AZI) AND NOT EXISTS (SELECT 1 FROM public.red_fan_operatori)
               AND NOT EXISTS (SELECT 1 FROM public.red_fan_intentii) AND NOT EXISTS (SELECT 1 FROM public.red_fan_cereri_aprobare)
               AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '$OP2') AND (SELECT doar_proiecte_test FROM public.red_fan_setari)")" != t ]; then
  echo "REFUZ: starea de pornire nu e curata (rand al zilei de azi / operatori / intentii / cereri existente, op2 prezent sau garda doar TEST oprita)" >&2; rm -rf "$TMP"; exit 24
fi
JURNAL0="$(q -c "SELECT coalesce(max(id), 0) FROM public.red_jurnal")"; LIMITA0="$(q -c "SELECT limita_zi FROM public.red_fan_setari")"
[[ "$JURNAL0" =~ ^[0-9]+$ ]] && [[ "$LIMITA0" =~ ^[0-9]+$ ]] || { echo "REFUZ: maximul red_jurnal / limita zilei nu s-au putut citi" >&2; rm -rf "$TMP"; exit 23; }
MD5_COMANDA="$(q -c "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_red_fan_comanda(uuid, uuid, jsonb, text)'::regprocedure")"
# textul comenzii din migrare (pentru E22c): un singur CREATE FUNCTION … END $fn$; poziția 3 apare exact o dată
awk '/^CREATE FUNCTION public\.fn_red_fan_comanda\(/{p=1} p{print} p&&/^END \$fn\$;/{exit}' "$MIG" | tr -d '\r' | sed '1s/^CREATE FUNCTION/CREATE OR REPLACE FUNCTION/' > "$TMP/comanda_orig.sql"
POZ3='AND (lot_id = p_lot_id OR plic_id = ANY (v_ids)) ORDER BY id FOR UPDATE;'
[ "$(grep -cF "$POZ3" "$TMP/comanda_orig.sql")" = 1 ] && grep -q '^END \$fn\$;$' "$TMP/comanda_orig.sql" || { echo "REFUZ: textul fn_red_fan_comanda din migrare nu are forma asteptata" >&2; rm -rf "$TMP"; exit 23; }
sed "s/$(printf '%s' "$POZ3" | sed 's/[][\.*^$/]/\\&/g')/AND lot_id = p_lot_id ORDER BY id FOR UPDATE;/" "$TMP/comanda_orig.sql" > "$TMP/comanda_mutant.sql"
[ "$(grep -cF 'AND lot_id = p_lot_id ORDER BY id FOR UPDATE;' "$TMP/comanda_mutant.sql")" = 1 ] || { echo "REFUZ: mutantul nu s-a putut construi" >&2; rm -rf "$TMP"; exit 23; }
trap curata EXIT
if ! q -v sistem="$SISTEM" -v actiune=creeaza -f "$FIXTURE_SQL" > "$TMP/fixture_creeaza.out" 2>&1; then
  PRE="$(grep -o 'FIXTURE_PRECONDITIE FX00[1-3]' "$TMP/fixture_creeaza.out" | head -n 1 | cut -c 21- || true)"
  echo "REFUZ: fixture-ul 20261212a nu s-a putut crea${PRE:+ (preconditie $PRE)}: $(tr '\n' ' ' < "$TMP/fixture_creeaza.out")" >&2
  case "$PRE" in FX001) exit 26 ;; FX002) exit 27 ;; FX003) exit 28 ;; *) exit 25 ;; esac
fi
FIXTURE_CREAT=1
if ! ext_creeaza; then echo "REFUZ: extensia F1 a fixture-ului nu s-a putut crea: $(tr '\n' ' ' < "$TMP/ext_creeaza.out")" >&2; EXT_CREATA=1; exit 25; fi
EXT_CREATA=1; echo "fixture: 20261212a + extensia F1 (op2, 10 loturi, 19 plicuri) create"

JWT() { echo "SELECT set_config('request.jwt.claim.sub', '$1', true), set_config('request.jwt.claims', json_build_object('sub', '$1', 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;"; }
asteapta() {
  echo "DO \$b\$ DECLARE i int := 0; BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid::bigint = $1 AND objsubid = 1 AND granted) LOOP
      PERFORM pg_sleep(0.05); i := i + 1; IF i > 400 THEN RAISE EXCEPTION 'bariera $1 nu a aparut'; END IF; END LOOP; END \$b\$;"
}
sesiune_a() {   # bariera $1, instrucțiunea $2, uid $3 ('' = postgres fără JWT), finalul $4
  printf '%s\n' "\\set ON_ERROR_STOP 1" "BEGIN;"
  if [ -n "$3" ]; then JWT "$3"; fi
  printf '%s\n' "$2;" "SELECT pg_advisory_xact_lock($1);" "SELECT pg_sleep(3);" "${4:-COMMIT};"
}
sesiune_b() {   # bariera $1, expresia $2, uid $3: T0, R= / E= / M=, COMMIT, T1 în afara tranzacției
  printf '%s\n' "\\set ON_ERROR_STOP 1" "$(asteapta "$1")" "SELECT 'T0=' || extract(epoch FROM clock_timestamp());" "\\set ON_ERROR_STOP 0" \
    "BEGIN;" "$(JWT "$3")" "SET LOCAL lock_timeout = '20s';" "SELECT 'R=' || ($2)::text;" '\echo E=:LAST_ERROR_SQLSTATE' '\echo M=:LAST_ERROR_MESSAGE' "COMMIT;" \
    "\\set ON_ERROR_STOP 1" "SELECT 'T1=' || extract(epoch FROM clock_timestamp());"
}
rez() { if [ "$1" = ok ]; then echo "OK   $2"; else echo "ESEC $2" >&2; ESEC=1; fi; }
doua() {   # $1 bariera (+BAZA), $2 instrucțiunea A, $3 expresia B, $4 final A, $5 uid A, $6 uid B → coduri „CA CB”
  local k=$(( BAZA + $1 ))
  sesiune_a "$k" "$2" "${5-$OWNER}" "${4:-COMMIT}" > "$TMP/a$1.sql"; sesiune_b "$k" "$3" "${6:-$OWNER}" > "$TMP/b$1.sql"
  q -f "$TMP/a$1.sql" > "$TMP/a$1.out" 2>&1 & local pa=$!
  "$PSQL" -X -q -At "${CONN[@]}" -f "$TMP/b$1.sql" > "$TMP/b$1.out" 2>&1 & local pb=$!
  local ca=0 cb=0; wait "$pa" || ca=$?; wait "$pb" || cb=$?
  echo "$ca $cb"
}
val() { tr -d '\r' < "$2" | grep -m1 "^$1=" | cut -d= -f2- || true; }
asteptat() { tr -d '\r' < "$1" | awk -F= '/^T0=/{a=$2} /^T1=/{b=$2} END{ if (a == "" || b == "") print "lipsa"; else if (b - a >= 1) print "da"; else print "nu" }'; }
singur() {   # $1 eticheta, $2 preambul, $3 corpul, $4 finalul (ROLLBACK implicit); „C=” = codul procesului
  printf '%s\n' "\\set ON_ERROR_STOP 0" "BEGIN;" "$2" "$3" '\echo E=:LAST_ERROR_SQLSTATE' '\echo M=:LAST_ERROR_MESSAGE' "${4:-ROLLBACK};" > "$TMP/s_$1.sql"
  local c=0; "$PSQL" -X -q -At "${CONN[@]}" -f "$TMP/s_$1.sql" > "$TMP/s_$1.out" 2>&1 || c=$?
  echo "C=$c" >> "$TMP/s_$1.out"
}
PJ() { local j="" i; for i in "$@"; do j="$j{\"plic_id\":\"$(plic "$i")\",\"hash\":\"$H\"},"; done; echo "[${j%,}]"; }   # payloadul comenzii
PJ2() { echo "[{\"plic_id\":\"$(plic "$1")\",\"hash\":\"$H2\"}]"; }
CMD() { echo "public.fn_red_fan_comanda('$1', '$2', '$3'::jsonb, '$HC')"; }
STARI() { q -c "SELECT string_agg(stare, ',' ORDER BY nr_plic) FROM public.red_fan_awb WHERE lot_id = '$1' AND stare NOT IN ('eroare', 'anulat', 'retras')"; }
ZI() { q -c "SELECT coalesce((SELECT aprobate::text FROM public.red_fan_zi WHERE zi_ro = $AZI), '-') || '/' || (SELECT count(*) FROM public.red_fan_zi_consum WHERE zi_ro = $AZI)"; }
INT() { q -c "SELECT coalesce(stare || '/' || coalesce(incheiata_de, '-'), 'absenta') FROM public.red_fan_intentii WHERE cheie = '$1'"; }
EXPIRA() { q -c "UPDATE public.red_fan_intentii SET lucru_pana_la = clock_timestamp() - interval '1 minute' WHERE cheie = '$1'" >/dev/null; }

# pregătirea comună: owner-ul numește operatorii și pune plafonul zilei pe 5 (P5 pe muchie)
singur preg "$(JWT "$OWNER")" "SELECT 'R=' || public.fn_red_fan_operator_seteaza('$OP1', true, 'proba F1')::text; SELECT 'S=' || public.fn_red_fan_operator_seteaza('$OP2', true, 'proba F1')::text; SELECT 'L=' || public.fn_red_fan_setari_limita_zi(5);" COMMIT
[ "$(val C "$TMP/s_preg.out")" = 0 ] && [ "$(val E "$TMP/s_preg.out")" = 00000 ] && [ "$(q -c "SELECT count(*) FROM public.red_fan_operatori WHERE retras_la IS NULL")" = 2 ] \
  && rez ok "pregatire: OP1 si OP2 numiti operatori de owner; limita_zi = 5" || { rez esec "pregatire: $(tr '\n' ' ' < "$TMP/s_preg.out")"; exit 1; }

# P5: zi absentă, limita 5; A = OP1 pe LA (3), B = OP2 pe LB (3) → B așteaptă la poziția 5, apoi de_aprobat 3; exact unul trece
K_A=$(kid 1); K_B=$(kid 2)
read -r CA CB < <(doua 1 "SELECT $(CMD "$LA" "$K_A" "$(PJ 1 2 3)")" "$(CMD "$LB" "$K_B" "$(PJ 4 5 6)")" COMMIT "$OP1" "$OP2")
RB="$(val R "$TMP/b1.out")"; Z="$(ZI)"; SA="$(STARI "$LA")"; SB="$(STARI "$LB")"
[ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$(val E "$TMP/b1.out")" = 00000 ] && grep -q '"de_aprobat": 3' <<< "$RB" && grep -q '"aprobate": \[\]' <<< "$RB" && grep -q '"numarate": 0' <<< "$RB" \
  && [ "$(asteptat "$TMP/b1.out")" = da ] && [ "$Z" = 3/3 ] && [ "$SA" = "aprobat,aprobat,aprobat" ] && [ "$SB" = "de_aprobat,de_aprobat,de_aprobat" ] \
  && [ "$(q -c "SELECT count(*) FROM public.red_fan_cereri_aprobare WHERE lot_id = '$LB' AND stare = 'deschisa' AND n = 3")" = 1 ] \
  && rez ok "P5 doi operatori pe muchie: B a asteptat la red_fan_setari, apoi de_aprobat 3 (aprobate [], numarate 0); zi $Z; LA $SA; LB $SB; o cerere deschisa" \
  || rez esec "P5 (A=$CA B=$CB zi=$Z LA=$SA LB=$SB): $(tr '\n' ' ' < "$TMP/b1.out")"
singur lim "$(JWT "$OWNER")" "SELECT 'L=' || public.fn_red_fan_setari_limita_zi(20);" COMMIT
[ "$(val E "$TMP/s_lim.out")" = 00000 ] || rez esec "limita_zi = 20: $(tr '\n' ' ' < "$TMP/s_lim.out")"

# I5: K1 aprobă 2 pe L5 (comisă), arenda expirată; A = K2 (preluare, deschisă), B = K3 → așteaptă la lot, apoi RD030
K1=$(kid 3); K2=$(kid 4); K3=$(kid 5)
singur i5p "$(JWT "$OP1")" "SELECT 'R=' || ($(CMD "$L5" "$K1" "$(PJ 7 8)") ->> 'incheiata');" COMMIT
EXPIRA "$K1"
read -r CA CB < <(doua 2 "SELECT $(CMD "$L5" "$K2" "$(PJ 7 8)")" "$(CMD "$L5" "$K3" "$(PJ 7 8)")" COMMIT "$OP1" "$OP1")
I1="$(INT "$K1")"; I2="$(INT "$K2")"; I3="$(INT "$K3")"; CH="$(q -c "SELECT count(*) FILTER (WHERE intentie_cheie = '$K2') || '/' || count(*) FROM public.red_fan_awb WHERE lot_id = '$L5'")"
[ "$(val E "$TMP/s_i5p.out")" = 00000 ] && [ "$(val R "$TMP/s_i5p.out")" = false ] && [ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$(val E "$TMP/b2.out")" = RD030 ] && [ -z "$(val R "$TMP/b2.out")" ] \
  && [ "$(asteptat "$TMP/b2.out")" = da ] && grep -q '"preluate": 2' "$TMP/a2.out" && grep -q '"mod": "preluare"' "$TMP/a2.out" && [ "$I1" = "neincheiata/comanda_noua" ] && [ "$I2" = "in_curs/-" ] && [ "$I3" = absenta ] && [ "$CH" = 2/2 ] \
  && rez ok "I5 doua intentii pe acelasi lot: B a asteptat lotul, apoi RD030; K1 $I1, K2 $I2, K3 $I3; randurile preluate o data ($CH cu K2)" \
  || rez esec "I5 (A=$CA B=$CB K1=$I1 K2=$I2 K3=$I3 chei=$CH): $(cat "$TMP/s_i5p.out" "$TMP/b2.out" | tr '\n' ' ')"

# E15: L4 are un rând generat sintetic (plicul 9) și plicul nou 10; A = comanda (deschisă), B = tirajul → așteaptă la lot, apoi RD031
AWB9="9$(printf '%05d' $(( RANDOM % 100000 )))$(printf '%04d' $(( $$ % 10000 )))"
q -c "INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, stare, hash_date, propus_de, aprobat_de, aprobat_la, cerere_id, awb, generat_la)
      SELECT proiect_id, lot_id, id, nr_plic, 'generat', '$H', '$OWNER', '$OWNER', now(), gen_random_uuid(), '$AWB9', now() FROM public.red_plicuri WHERE id = '$(plic 9)'" >/dev/null
K4=$(kid 6); K5=$(kid 7)
read -r CA CB < <(doua 3 "SELECT $(CMD "$L4" "$K4" "$(PJ 10)")" "public.fn_red_fan_tiraj('$L4', '$KT', NULL)::text" COMMIT "$OP1" "$OP1")
TF="$(q -c "SELECT coalesce(tiraj_cheie, '-') FROM public.red_fan_loturi WHERE lot_id = '$L4'")"; S4="$(STARI "$L4")"
[ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$(val E "$TMP/b3.out")" = RD031 ] && [ -z "$(val R "$TMP/b3.out")" ] && [ "$(asteptat "$TMP/b3.out")" = da ] && [ "$TF" = - ] && [ "$S4" = "generat,aprobat" ] \
  && rez ok "E15 comanda || tiraj: B a asteptat lotul, apoi RD031 (lot neincheiat: $S4); fara tiraj" || rez esec "E15 (A=$CA B=$CB tiraj=$TF L4=$S4): $(tr '\n' ' ' < "$TMP/b3.out")"
# invers: P24 retras de operator (lotul devine încheiat), K4 expirată; A = tirajul (deschisă), B = comanda P24 cu hash nou → lot_tiparit
R10="$(q -c "SELECT id FROM public.red_fan_awb WHERE plic_id = '$(plic 10)' AND stare = 'aprobat'")"
singur e15r "$(JWT "$OP1")" "SELECT 'R=' || public.fn_red_fan_retrage('$R10', 'operator');" COMMIT
EXPIRA "$K4"
read -r CA CB < <(doua 4 "SELECT public.fn_red_fan_tiraj('$L4', '$KT', NULL)" "$(CMD "$L4" "$K5" "$(PJ2 10)")" COMMIT "$OP1" "$OP1")
RB="$(val R "$TMP/b4.out")"; TF="$(q -c "SELECT coalesce(tiraj_cheie, '-') || '/' || coalesce(tiraj_nr::text, '-') FROM public.red_fan_loturi WHERE lot_id = '$L4'")"
V10="$(q -c "SELECT count(*) FROM public.red_fan_awb WHERE plic_id = '$(plic 10)' AND stare NOT IN ('eroare', 'anulat', 'retras')")"
[ "$(val E "$TMP/s_e15r.out")" = 00000 ] && [ "$(val R "$TMP/s_e15r.out")" = retras ] && [ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$(val E "$TMP/b4.out")" = 00000 ] && grep -q '"inceput"' "$TMP/a4.out" \
  && grep -q '"incheiata": true' <<< "$RB" && grep -q '"lot_tiparit"' <<< "$RB" && grep -q '"de_trimis": \[\]' <<< "$RB" && [ "$(asteptat "$TMP/b4.out")" = da ] && [ "$TF" = "$KT/1" ] && [ "$V10" = 0 ] \
  && rez ok "E15 invers (tiraj || comanda): B a asteptat lotul, apoi plicul exclus lot_tiparit, intentia incheiata, niciun rand viu nou; tiraj $TF" \
  || rez esec "E15 invers (A=$CA B=$CB tiraj=$TF vii=$V10): $(cat "$TMP/s_e15r.out" "$TMP/b4.out" | tr '\n' ' ')"

# ── E22: două loturi, un plic mutat; H ține red_fan_setari FOR UPDATE și eliberează când ambele sesiuni așteaptă un lock ──
pregateste_e22() {   # $1 LV, $2 LN, $3 plicul P: owner propune P în LV (rândul R), apoi P e mutat în LN (mentenanță; R rămâne cu lot_id = LV)
  singur "e22p$4" "$(JWT "$OWNER")" "SELECT 'R=' || public.fn_red_fan_propune('$(plic "$3")', '$H', NULL)::text;" COMMIT
  [ "$(val E "$TMP/s_e22p$4.out")" = 00000 ] || { rez esec "E22$4 pregatire (propunerea lui P): $(tr '\n' ' ' < "$TMP/s_e22p$4.out")"; return 1; }
  q -c "UPDATE public.red_plicuri SET lot_id = '$2' WHERE id = '$(plic "$3")'" >/dev/null
  [ "$(q -c "SELECT count(*) FROM public.red_fan_awb WHERE plic_id = '$(plic "$3")' AND stare = 'propus' AND lot_id = '$1'")" = 1 ]
}
sesiune_e22() {   # $1 fișier, $2 uid, $3 expresia: deadlock_timeout scurt (superuser, înaintea rolului), R= / E= / M=
  printf '%s\n' "\\set ON_ERROR_STOP 0" "BEGIN;" "SET LOCAL deadlock_timeout = '300ms';" "$(JWT "$2")" "SET LOCAL lock_timeout = '60s';" \
    "SELECT 'R=' || ($3)::text;" '\echo E=:LAST_ERROR_SQLSTATE' '\echo M=:LAST_ERROR_MESSAGE' "COMMIT;" > "$1"
}
asteapta_lock() {   # sesiunea cu application_name $1 așteaptă un lock (pg_stat_activity), ≤ 20 s
  local i; for i in $(seq 1 400); do
    [ "$(q -c "SELECT count(*) FROM pg_stat_activity WHERE application_name = '$1' AND wait_event_type = 'Lock'")" = 1 ] && return 0; sleep 0.05
  done; return 1
}
TUPLU() { q -c "SELECT coalesce(string_agg(DISTINCT l.relation::regclass::text, ','), '-') FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = '$1' AND l.locktype = 'tuple'"; }
e22() {   # $1 varianta (a/b/c), $2 LV, $3 LN, $4 P, $5 Q1, $6 Q2, $7 prima sesiune (s1/s2)
  local v=$1 LV=$2 LN=$3 P=$4 KV KN prima=$7 a doua h ca=0 cb=0 ch=0 T1 T2
  case $v in a) KV=$(kid 21); KN=$(kid 31) ;; b) KV=$(kid 22); KN=$(kid 32) ;; *) KV=$(kid 23); KN=$(kid 33) ;; esac   # chei distincte pe variantă
  printf '%s\n' "\\set ON_ERROR_STOP 1" "BEGIN;" "SELECT id FROM public.red_fan_setari WHERE id FOR UPDATE;" \
    "DO \$b\$ DECLARE i int := 0; BEGIN LOOP
       IF (SELECT count(*) FROM pg_stat_activity WHERE application_name IN ('e22_s1', 'e22_s2') AND wait_event_type = 'Lock') = 2 THEN EXIT; END IF;
       PERFORM pg_sleep(0.05); i := i + 1; IF i > 1200 THEN RAISE EXCEPTION 'E22: sesiunile nu au ajuns amandoua in asteptare'; END IF; END LOOP; END \$b\$;" \
    "SELECT 'H_ELIBERAT=' || clock_timestamp();" "COMMIT;" > "$TMP/h$v.sql"
  sesiune_e22 "$TMP/s1$v.sql" "$OP1" "$(CMD "$LV" "$KV" "$(PJ "$5" "$6")")"
  sesiune_e22 "$TMP/s2$v.sql" "$OP2" "$(CMD "$LN" "$KN" "$(PJ "$P")")"
  PGAPPNAME=e22_h "$PSQL" -X -q -At "${CONN[@]}" -f "$TMP/h$v.sql" > "$TMP/h$v.out" 2>&1 & h=$!
  local i; for i in $(seq 1 200); do [ "$(q -c "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = 'e22_h' AND l.relation = 'public.red_fan_setari'::regclass AND l.granted")" -ge 1 ] && break; sleep 0.05; done
  if [ "$prima" = s1 ]; then a=s1; doua=s2; else a=s2; doua=s1; fi
  PGAPPNAME=e22_$a "$PSQL" -X -q -At "${CONN[@]}" -f "$TMP/$a$v.sql" > "$TMP/$a$v.out" 2>&1 & local pa=$!
  asteapta_lock "e22_$a" || rez esec "E22$v: prima sesiune ($a) nu a ajuns in asteptare"
  T1="$(TUPLU "e22_$a")"
  PGAPPNAME=e22_$doua "$PSQL" -X -q -At "${CONN[@]}" -f "$TMP/$doua$v.sql" > "$TMP/$doua$v.out" 2>&1 & local pb=$!
  asteapta_lock "e22_$doua" || rez esec "E22$v: a doua sesiune ($doua) nu a ajuns in asteptare"
  T2="$(TUPLU "e22_$doua")"
  wait "$pa" || ca=$?; wait "$pb" || cb=$?; wait "$h" || ch=$?
  echo "$ca $cb $ch|$T1|$T2"
}
VIU() { q -c "SELECT count(*) FROM public.red_fan_awb WHERE plic_id = '$(plic "$1")' AND stare NOT IN ('eroare', 'anulat', 'retras')"; }
R_STARE() { q -c "SELECT string_agg(stare || '@' || CASE WHEN lot_id = '$2' THEN 'LV' WHEN lot_id = '$3' THEN 'LN' ELSE '?' END || coalesce('/' || motiv_retragere, ''), ' ' ORDER BY created_at) FROM public.red_fan_awb WHERE plic_id = '$(plic "$1")'"; }
# E22a: S1 întâi (ține R, așteaptă la 5), S2 așteaptă la 3 pe R (tuplu din red_fan_awb)
if pregateste_e22 "$LV1" "$LN1" 11 a; then
  IFS='|' read -r CODURI TA TB < <(e22 a "$LV1" "$LN1" 11 12 13 s1); read -r CA CB CH <<< "$CODURI"
  RS="$(R_STARE 11 "$LV1" "$LN1")"; SV="$(STARI "$LV1")"
  [ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$CH" = 0 ] && [ "$(val E "$TMP/s1a.out")" = 00000 ] && [ "$(val E "$TMP/s2a.out")" = 00000 ] && [ "$TA" = public.red_fan_setari ] && [ "$TB" = public.red_fan_awb ] \
    && [ "$RS" = "retras@LV/plic_mutat aprobat@LN" ] && [ "$SV" = "aprobat,aprobat" ] && [ "$(VIU 11)" = 1 ] && grep -q '"retrase": \[{' "$TMP/s1a.out" \
    && rez ok "E22a S1 -> S2: fara 40P01; S1 a asteptat pe red_fan_setari, S2 pe un tuplu din red_fan_awb; R retras (plic_mutat), R2 aprobat pe LN, Q1/Q2 aprobat, un rand viu pe P" \
    || rez esec "E22a (S1=$CA S2=$CB H=$CH tupluri=$TA/$TB R=$RS LV=$SV): $(cat "$TMP/s1a.out" "$TMP/s2a.out" "$TMP/ha.out" | tr '\n' ' ')"
else rez esec "E22a: pregatirea a picat"; fi
# E22b: S2 întâi (ține R, așteaptă la 5), S1 așteaptă la 3 pe R → R refolosit pe LN
if pregateste_e22 "$LV2" "$LN2" 14 b; then
  IFS='|' read -r CODURI TA TB < <(e22 b "$LV2" "$LN2" 14 15 16 s2); read -r CA CB CH <<< "$CODURI"
  RS="$(R_STARE 14 "$LV2" "$LN2")"; SV="$(STARI "$LV2")"
  [ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$CH" = 0 ] && [ "$(val E "$TMP/s1b.out")" = 00000 ] && [ "$(val E "$TMP/s2b.out")" = 00000 ] && [ "$TA" = public.red_fan_setari ] && [ "$TB" = public.red_fan_awb ] \
    && [ "$RS" = "aprobat@LN" ] && [ "$SV" = "aprobat,aprobat" ] && [ "$(VIU 14)" = 1 ] && grep -q '"retrase": \[\]' "$TMP/s1b.out" \
    && rez ok "E22b S2 -> S1: fara 40P01; R refolosit si realiniat (aprobat pe LN), Q1/Q2 aprobat fara sa atinga R, un rand viu pe P" \
    || rez esec "E22b (S2=$CA S1=$CB H=$CH tupluri=$TA/$TB R=$RS LV=$SV): $(cat "$TMP/s1b.out" "$TMP/s2b.out" "$TMP/hb.out" | tr '\n' ' ')"
else rez esec "E22b: pregatirea a picat"; fi
# E22c: mutantul fazei L (poziția 3 fără rândurile plicurilor cerute) cu coregrafia S2 -> S1 → ciclu → exact un 40P01
if q -f "$TMP/comanda_mutant.sql" > "$TMP/comanda_mutant.out" 2>&1; then
  MUTANT_ACTIV=1
  if pregateste_e22 "$LV3" "$LN3" 17 c; then
    IFS='|' read -r CODURI TA TB < <(e22 c "$LV3" "$LN3" 17 18 19 s2); read -r CA CB CH <<< "$CODURI"
    E1="$(val E "$TMP/s1c.out")"; E2="$(val E "$TMP/s2c.out")"; N40=0; [ "$E1" = 40P01 ] && N40=$((N40 + 1)); [ "$E2" = 40P01 ] && N40=$((N40 + 1))
    [ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$CH" = 0 ] && [ "$N40" = 1 ] && [ "$TA" = public.red_fan_setari ] && [ "$TB" = public.red_fan_setari ] \
      && rez ok "E22c mutantul fazei L: ambele au asteptat la red_fan_setari, apoi EXACT una a primit 40P01 (S1=$E1 S2=$E2) — proba prinde defectul" \
      || rez esec "E22c (S2=$CA S1=$CB H=$CH E1=$E1 E2=$E2 tupluri=$TA/$TB): $(cat "$TMP/s1c.out" "$TMP/s2c.out" "$TMP/hc.out" | tr '\n' ' ')"
  else rez esec "E22c: pregatirea a picat"; fi
  mutant_scoate && rez ok "E22c: mutantul scos, amprenta fn_red_fan_comanda = cea de la inceput" || rez esec "E22c: mutantul NU s-a scos / amprenta diferita"
else rez esec "E22c: mutantul nu s-a putut pune: $(tr '\n' ' ' < "$TMP/comanda_mutant.out")"; fi
exit "$ESEC"
