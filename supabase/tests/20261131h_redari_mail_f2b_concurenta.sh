#!/usr/bin/env bash
# Proba de CONCURENȚĂ a migrării 20261131h (Redări e-mail F2b, runda 2 — Jakarinos #1134 P1): două sesiuni psql REALE pe o bază PostgreSQL ≥ 17
# DE UNICĂ FOLOSINȚĂ (NU producție, NU clona de producție): redenumirea proiectului (schimbarea categoriei TEST- ↔ real) în paralel cu rezervarea /
# autorizarea trimiterii. PGlite (o conexiune) nu poate proba asta; aici se vede lock-ul FOR SHARE al proiectului din fn_red_mail_rezerva /
# fn_red_mail_apel_incepe față de UPDATE-ul lui red_proiecte.cod, și triggerul trg_red_proiect_cod_test după COMMIT.
#
# Rulare (coordonatorul, pe un server PostgreSQL de probă; cere node + bash + psql în PATH, PGlite instalat la rădăcină):
#   PGHOST=... PGPORT=... PGUSER=postgres PGPASSWORD=... bash supabase/tests/20261131h_redari_mail_f2b_concurenta.sh <nume_baza_noua>
# Scriptul: creează baza <nume_baza_noua> (refuză dacă există), scrie fixture-ul (schelet + funcțiile reale + date + loturi) cu
#   node scripts/pglite/test_redari_mail_f2b_local.mjs --scrie-fixture, îl încarcă, aplică migrarea 20261131h cu marcajele runnerului (plafon 5000,
#   tabelul temporar L15 „ag_ina_*” pus de mână — amprenta globală L15 v2 e verificată pe PGlite și pe clonă, nu aici), conectează + pornește
#   trimiterea, apoi rulează cele 3 scenarii și la final șterge baza. Codul de ieșire = 0 doar dacă TOATE așteptările se țin; psql rulează cu
#   ON_ERROR_STOP acolo unde o eroare e neașteptată, iar codul de ieșire al fiecărui psql e păstrat (fără „|| true”).
#
# Scenarii (așteptările, scrise de mână):
#   S1  A: BEGIN; rezerva(lot TEST) (ține proiectul FOR SHARE); pg_sleep(3)                 B (după 0,5 s): UPDATE cod → real cu lock_timeout 1 s
#       → B primește 55P03 (lock_not_available): redenumirea NU poate trece peste o autorizare în curs.   A: COMMIT (mesaj rezervat).
#       Apoi B din nou (fără lock concurent): P0001 — triggerul refuză (lotul e in_trimitere) → categoria rămâne TEST- și după COMMIT-ul lui A.
#   S2  Invers: B schimbă categoria ÎNAINTE de orice rezervare (pe un proiect fără loturi în lucru: LOT1-REAL → TEST-REAL e refuzat de trigger
#       pentru că LOT.REAL e aprobat; deci S2 folosește TEST-MAIL → LOT-MAIL după ce lotul TEST e încheiat în S3; vezi mai jos) — ordinea se vede în S3.
#   S3  A: BEGIN; UPDATE red_proiecte SET denumire (ține rândul proiectului FOR NO KEY UPDATE); pg_sleep(3)      B (după 0,5 s): rezerva(lot TEST)
#       cu lock_timeout 1 s → B primește 55P03 (așteaptă proiectul: decizia „doar TEST” nu se ia cu proiectul în schimbare).  A: COMMIT.
#       B din nou: rezervă (NULL de la f2_poate, mesajul rezervat) — redenumirea comisă înainte e văzută (codul e tot TEST-).
#   S4  Lotul TEST încheiat (UPDATE direct, mesajele rămase anulate), apoi A: UPDATE cod TEST-MAIL → LOT-MAIL ca owner (JWT) → trece (fără loturi în
#       lucru); B: rezerva pe lotul MIC / REAL → f2_poate = doar_proiecte_test (0 rânduri).  Adminul (JWT) nu poate schimba categoria înapoi: 42501.
set -u
if [ $# -ne 1 ] || ! [[ "$1" =~ ^[a-z][a-z0-9_]{2,40}$ ]]; then echo "folosire: $0 <nume_baza_noua (a-z0-9_)>" >&2; exit 2; fi
BAZA="$1"
RADACINA="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$RADACINA/supabase/migrations/20261131h_redari_mail_f2b_trimitere.sql"
FIX="$(mktemp -t f2b_fixture_XXXXXX.sql)"
JURNAL="$(mktemp -t f2b_concurenta_XXXXXX.log)"
trap 'rm -f "$FIX"' EXIT
esec=0
ok() { if [ "$1" = 0 ]; then echo "  OK  $2"; else echo "  NU  $2"; esec=$((esec + 1)); fi; }          # $1 = cod de ieșire (0 = bine)
okt() { if [ "$1" = 1 ]; then echo "  OK  $2"; else echo "  NU  $2 (valoare: $1)"; esec=$((esec + 1)); fi; }   # $1 = rezultatul unui SELECT boolean::int (1 = adevărat)
PS="psql -X -q -w -v ON_ERROR_STOP=1 -d $BAZA"
PS0="psql -X -q -w -v ON_ERROR_STOP=0 -d $BAZA"   # DOAR pentru instrucțiunile a căror eroare e așteptată (una pe proces, ca mesajul să fie al ei)

# conturile / id-urile din fixture (aceleași ca în proba PGlite)
OWNER=00000000-0000-0000-0000-0000000000a1; ADMIN=00000000-0000-0000-0000-0000000000a2
P_TEST=00000000-0000-0000-0000-00000000b001; LOT_TEST=00000000-0000-0000-0000-0000000a0001; LOT_MIC=00000000-0000-0000-0000-0000000a0003
# un apel ca utilizator cu JWT (SET LOCAL ROLE authenticated + claims), în tranzacția curentă
jwt() { printf "SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true); SELECT set_config('request.jwt.claim.sub', '%s', true);" "$1" "$1"; }
SVC="SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true);"

echo "0. baza de unică folosință + fixture-ul (schelet + funcțiile reale + date)"
if psql -X -q -w -tAc "SELECT 1 FROM pg_database WHERE datname = '$BAZA'" -d postgres | grep -q 1; then echo "baza $BAZA exista deja: refuz (aleg alt nume)" >&2; exit 2; fi
psql -X -q -w -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE \"$BAZA\"" || exit 1
node "$RADACINA/scripts/pglite/test_redari_mail_f2b_local.mjs" --scrie-fixture "$FIX" > "$JURNAL" 2>&1; ok $? "fixture-ul scris de proba PGlite (jurnal: $JURNAL)"
$PS -f "$FIX" > /dev/null; ok $? "fixture-ul încărcat"
okt "$($PS -tAc "SELECT (current_setting('server_version_num')::int >= 170000)::int")" "PostgreSQL ≥ 17: $($PS -tAc 'SHOW server_version')"

echo "1. aplicarea migrării cu marcajele runnerului (plafon 5000; tabelul temporar L15 pus de mână — amprenta globală e proba PGlite / clonei)"
$PS <<EOF > /dev/null
SET transaction_timeout = 5000;
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.livrare_migrare', '20261131h_redari_mail_f2b_trimitere:' || txid_current(), true);
SELECT set_config('gazpet.plafon_tranzactie', '5000:' || txid_current(), true);
CREATE TEMP TABLE ag_ina_0123456789abcdef (familie text, eticheta text, amprenta text, detaliu text) ON COMMIT PRESERVE ROWS;
\i $MIG
COMMIT;
EOF
ok $? "migrarea 20261131h aplicată"
okt "$($PS -tAc "SELECT (count(*) = 1)::int FROM pg_trigger WHERE tgrelid = 'public.red_proiecte'::regclass AND tgname = 'trg_red_proiect_cod_test'")" "triggerul trg_red_proiect_cod_test există"

echo "2. conectarea căsuței (RPC service_role) + pornirea trimiterii (owner)"
$PS -c "BEGIN; $SVC SELECT public.fn_red_mail_secret_seteaza('REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN', 'rt-proba', '$OWNER', 'redari@gazpet.ro'); COMMIT;" > /dev/null; ok $? "căsuța conectată"
$PS -c "BEGIN; $(jwt $OWNER) SELECT public.fn_red_mail_f2_setari(false, false, (SELECT versiune FROM public.red_mail_setari WHERE id = 1)); COMMIT;" > /dev/null; ok $? "trimiterea pornită"
okt "$($PS -tAc "SELECT (public.fn_red_mail_f2_poate(l) IS NULL)::int FROM public.red_mail_loturi l WHERE l.id = '$LOT_TEST'")" "lotul TEST poate trimite (f2_poate = NULL)"

echo "S1. A rezervă (proiectul FOR SHARE) și ține tranzacția 3 s; B încearcă redenumirea TEST- → real cu lock_timeout 1 s → 55P03; după COMMIT-ul lui A → P0001 (trigger)"
$PS -c "BEGIN; $(jwt $OWNER) SELECT id FROM public.fn_red_mail_rezerva('$LOT_TEST'); SELECT pg_sleep(3); COMMIT;" > /dev/null &
PID_A=$!
sleep 0.5
B1="$($PS0 -c "SET lock_timeout = '1s'; UPDATE public.red_proiecte SET cod = 'LOT-MAIL' WHERE id = '$P_TEST';" 2>&1)"; COD_B1=$?
wait $PID_A; COD_A=$?
ok $COD_A "A: rezervarea a reușit și s-a comis (exit $COD_A)"
echo "$B1" | grep -q "lock timeout" ; ok $? "B în timpul lui A: redenumirea a așteptat lock-ul proiectului și a picat la lock_timeout (55P03), exit $COD_B1: $(echo "$B1" | head -1)"
okt "$($PS -tAc "SELECT (cod = 'TEST-MAIL')::int FROM public.red_proiecte WHERE id = '$P_TEST'")" "codul a rămas TEST-MAIL"
okt "$($PS -tAc "SELECT (count(*) = 1)::int FROM public.red_mail_mesaje WHERE lot_id = '$LOT_TEST' AND stare = 'rezervat'")" "un mesaj rezervat"
B2="$($PS0 -c "UPDATE public.red_proiecte SET cod = 'LOT-MAIL' WHERE id = '$P_TEST';" 2>&1)"
echo "$B2" | grep -q "loturi de e-mail neincheiate sau mesaje rezervate" ; ok $? "B după COMMIT-ul lui A: triggerul refuză schimbarea categoriei (lot in_trimitere / mesaj rezervat): $(echo "$B2" | head -1)"
B3="$($PS0 -c "BEGIN; $(jwt $ADMIN) UPDATE public.red_proiecte SET cod = 'LOT-MAIL' WHERE id = '$P_TEST'; COMMIT;" 2>&1)"
echo "$B3" | grep -q "doar owner-ul" ; ok $? "adminul (JWT) nu poate schimba categoria: 42501: $(echo "$B3" | grep -m1 ERROR)"
$PS -c "BEGIN; $(jwt $OWNER) UPDATE public.red_proiecte SET cod = 'TEST-MAIL-2' WHERE id = '$P_TEST'; UPDATE public.red_proiecte SET cod = 'TEST-MAIL' WHERE id = '$P_TEST'; COMMIT;" > /dev/null; ok $? "owner: redenumirea în aceeași categorie trece și în timpul trimiterii"

echo "S3. A ține rândul proiectului (UPDATE denumire) 3 s; B încearcă rezervarea cu lock_timeout 1 s → 55P03 (așteaptă proiectul); după COMMIT-ul lui A rezervarea reușește"
TOKEN="$($PS -tAc "SELECT lease_token FROM public.red_mail_mesaje WHERE lot_id = '$LOT_TEST' AND stare = 'rezervat'")"
MESAJ="$($PS -tAc "SELECT id FROM public.red_mail_mesaje WHERE lot_id = '$LOT_TEST' AND stare = 'rezervat'")"
$PS -c "BEGIN; UPDATE public.red_proiecte SET denumire = 'tinut 3 s' WHERE id = '$P_TEST'; SELECT pg_sleep(3); COMMIT;" > /dev/null &
PID_A=$!
sleep 0.5
B4="$($PS0 -c "SET lock_timeout = '1s'; BEGIN; $(jwt $OWNER) SELECT public.fn_red_mail_apel_incepe('$MESAJ', '$TOKEN'); COMMIT;" 2>&1)"
wait $PID_A; COD_A=$?
ok $COD_A "A: UPDATE-ul proiectului s-a comis"
echo "$B4" | grep -q "lock timeout" ; ok $? "B în timpul lui A: apel_incepe a așteptat proiectul (FOR SHARE vs UPDATE) și a picat la lock_timeout: $(echo "$B4" | grep -m1 ERROR)"
okt "$($PS -tAc "SELECT (stare = 'rezervat')::int FROM public.red_mail_mesaje WHERE id = '$MESAJ'")" "mesajul a rămas rezervat (nicio autorizare dată sub lock)"
okt "$($PS -tAc "BEGIN; $(jwt $OWNER) SELECT public.fn_red_mail_apel_incepe('$MESAJ', '$TOKEN')::int; COMMIT;" | tail -1)" "B după COMMIT-ul lui A: apel_incepe = true"
B5="$($PS0 -c "UPDATE public.red_proiecte SET cod = 'LOT-MAIL' WHERE id = '$P_TEST';" 2>&1)"
echo "$B5" | grep -q "neincheiate sau mesaje rezervate" ; ok $? "cu mesajul in_apel (intervalul HTTP): categoria rămâne blocată"
$PS -c "BEGIN; $(jwt $OWNER) SELECT public.fn_red_mail_rezultat('$MESAJ', '$TOKEN', 'trimis', 'gm1', 'th1'); COMMIT;" > /dev/null; ok $? "rezultatul trimis persistat"

echo "S4. lotul încheiat → owner-ul poate schimba categoria; lotul MIC („test-mic”) nu poate trimite; adminul nu poate schimba categoria înapoi"
$PS -c "UPDATE public.red_mail_mesaje SET stare = 'anulat', eroare_cod = 'lot_incheiat' WHERE lot_id = '$LOT_TEST' AND stare = 'in_coada'; UPDATE public.red_mail_loturi SET stare = 'incheiat', incheiat_la = now() WHERE id = '$LOT_TEST';" > /dev/null; ok $? "lotul TEST încheiat"
$PS -c "BEGIN; $(jwt $OWNER) UPDATE public.red_proiecte SET cod = 'LOT-MAIL' WHERE id = '$P_TEST'; COMMIT;" > /dev/null; ok $? "owner: TEST-MAIL → LOT-MAIL după încheierea lotului"
N_MIC="$($PS -tAc "BEGIN; $(jwt $OWNER) SELECT count(*)::int FROM public.fn_red_mail_rezerva('$LOT_MIC'); COMMIT;" | tail -1)"
[ "$N_MIC" = 0 ]; ok $? "rezerva pe lotul „test-mic” (minuscule = proiect real): 0 rânduri (doar_proiecte_test), a întors: $N_MIC"
B6="$($PS0 -c "BEGIN; $(jwt $ADMIN) UPDATE public.red_proiecte SET cod = 'TEST-MAIL' WHERE id = '$P_TEST'; COMMIT;" 2>&1)"
echo "$B6" | grep -q "doar owner-ul" ; ok $? "adminul nu poate readuce proiectul la TEST-: 42501"
$PS -c "BEGIN; $(jwt $OWNER) UPDATE public.red_proiecte SET cod = 'TEST-MAIL' WHERE id = '$P_TEST'; COMMIT;" > /dev/null; ok $? "owner-ul poate (lotul e încheiat, fără mesaje în zbor)"

echo "9. curățenie: baza de probă ștearsă"
psql -X -q -w -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE \"$BAZA\"" ; ok $? "DROP DATABASE $BAZA"
if [ $esec = 0 ]; then echo "PASS: toate așteptările se țin"; else echo "ESEC: $esec așteptări nu se țin"; fi
exit $(( esec > 0 ))
