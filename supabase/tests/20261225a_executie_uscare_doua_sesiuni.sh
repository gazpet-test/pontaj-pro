#!/usr/bin/env bash
# Proba de CONCURENȚĂ pentru 20261225a (raportul de uscare, review #1112 P1) — DOAR pe CLONĂ, cu DOUĂ sesiuni psql reale (L25).
# Tiparul: scripts/raport_rezumat_concurenta.sh. PGlite are o singură conexiune, deci aceste scenarii NU sunt probate local.
# Rulare din Git Bash, cu psql de Windows; conexiunea după `--` (parola din pgpass, niciodată pe linia de comandă):
#   PSQL=/c/Users/Public/pgsql/bin/psql.exe bash supabase/tests/20261225a_executie_uscare_doua_sesiuni.sh --sistem <system_identifier clonă> \
#        -- -h <host clonă> -p <port> -U postgres -d postgres
# Garda țintei: system_identifier = --sistem, altfel refuz (22) înainte de orice scriere. 20261225a aplicată (23). Owner-ul sintetic al clonei
#   (OWNER=<uuid>, implicit 00000000-0000-4000-8000-000000000001, is_owner) există (24). Proiectul: primul din executie_proiecte (PROIECT=<id>).
# Datele: rapoarte SINTETICE pe tronsonul „PROBA-CONCURENTA-<pid>”, comise (sesiunile trebuie să le vadă) și șterse la final (trap): ca
#   postgres, într-o tranzacție, cu trigger-ele de gardă ale celor 4 tabele dezactivate DOAR în acea tranzacție (ALTER TABLE ... DISABLE
#   TRIGGER USER, apoi ENABLE), plus obiectele Storage false (storage.allow_delete_query). Revenirea 20261225a cere tabele goale: rulează
#   proba ÎNAINTEA revenirii sau după curățenie.
# Identitatea sesiunilor: OWNER, rolul authenticated + JWT-ul în ambele surse. Bariera: un lock consultativ (cheie bigint) luat de sesiunea
#   care „ține” DUPĂ apelul ei; a doua sesiune pornește abia când bariera e ținută.
# SCENARIILE și REZULTATELE AȘTEPTATE (codul de ieșire al fiecărei sesiuni se păstrează: wait PID):
#   C1 creare + reîncercare cu ACEEAȘI cheie, concurent: A creează (tranzacție deschisă 3 s); B trimite aceeași cerere
#      → B AȘTEAPTĂ (≥ 1 s, cheia e revendicată de A), apoi întoarce {ok: true, duplicat: true} cu ACELAȘI id; în BD un singur raport.
#   C2 aceeași, dar A anulează (ROLLBACK): B așteaptă, apoi creează el ({duplicat: false}); în BD un singur raport.
#   E1 salvare (A, versiunea V, deschisă) + închidere (B, versiunea V): B așteaptă rândul, apoi {ok: false, motiv: 'conflict'}; final:
#      deschis, V+1, observațiile lui A.
#   E2 închidere (A, V, deschisă) + salvare (B, V): B așteaptă, apoi {ok: false, motiv: 'conflict'}; final: închis, V+1, nimic de la B.
#   P1 înregistrarea unei poze (A, deschisă) + închidere (B): B așteaptă rândul raportului, apoi închide; jurnalul închiderii conține poza.
#   P2 închidere (A, deschisă) + o rezervare de poză NOUĂ (B): B așteaptă, apoi refuz 22023 („raportul e inchisa”); nicio rezervare nouă.
#   R1 (runda 3) creare (A, deschisă) + „Renunț” = fn_executie_uscare_retrage pe ACEEAȘI cheie (B): B așteaptă cheia, apoi {aplicat: true}
#      cu id-ul lui A; nicio retragere scrisă (un singur rând în jurnal, „creare”).
#   R2 (runda 3) retragerea (A, deschisă) + crearea întârziată cu aceeași cheie (B): B așteaptă, apoi refuz 22023 („retrasă”); niciun
#      raport cu cheia; în jurnal doar retragerea.
#   H1 (runda 3) două chei DIFERITE cu același hashtext (coliziune căutată pe clonă): A creează cu K1 (deschisă), B creează cu K2 → B
#      așteaptă (lock-ul consultativ e pe hash), apoi creează ALT raport (duplicat: false); intențiile nu se confundă.
# Ieșire: 0 = toate OK; 1 = un scenariu a picat; 2 = argumente; 22 = altă țintă; 23 = 20261225a neaplicată; 24 = owner / proiect lipsă.
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
OWNER="${OWNER:-00000000-0000-4000-8000-000000000001}"
[[ "$OWNER" =~ ^[0-9a-f-]{36}$ ]] || { echo "OWNER invalid" >&2; exit 2; }
cd "$(dirname "$0")/../.."
TMP="$(mktemp -d ./.concurenta_20261225a.XXXXXX)"
q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" "$@"; }
ETICHETA="PROBA-CONCURENTA-$$"
curata() {
  cat > "$TMP/curata.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN;
ALTER TABLE public.executie_uscare_jurnal DISABLE TRIGGER USER; ALTER TABLE public.executie_uscare_poze DISABLE TRIGGER USER;
ALTER TABLE public.executie_uscare_incarcari DISABLE TRIGGER USER; ALTER TABLE public.executie_uscari DISABLE TRIGGER USER;
CREATE TEMP TABLE z_ids ON COMMIT DROP AS SELECT id FROM public.executie_uscari WHERE tronson = '$ETICHETA';
DELETE FROM public.executie_uscare_jurnal WHERE actiune = 'cheie_retrasa' AND cheie::text IN (SELECT unnest(string_to_array('$(cat "$TMP/chei_retrase" 2>/dev/null | tr '\n' ',' )', ',')));
SELECT set_config('storage.allow_delete_query', 'true', true);
DELETE FROM storage.objects WHERE bucket_id = 'executie-uscare' AND split_part(name, '/', 2)::bigint IN (SELECT id FROM z_ids);
DELETE FROM public.executie_uscare_jurnal WHERE uscare_id IN (SELECT id FROM z_ids);
DELETE FROM public.executie_uscare_poze WHERE uscare_id IN (SELECT id FROM z_ids);
DELETE FROM public.executie_uscare_incarcari WHERE uscare_id IN (SELECT id FROM z_ids);
DELETE FROM public.executie_uscari WHERE id IN (SELECT id FROM z_ids);
ALTER TABLE public.executie_uscari ENABLE TRIGGER USER; ALTER TABLE public.executie_uscare_incarcari ENABLE TRIGGER USER;
ALTER TABLE public.executie_uscare_poze ENABLE TRIGGER USER; ALTER TABLE public.executie_uscare_jurnal ENABLE TRIGGER USER;
COMMIT;
SQL
  if ! q -f "$TMP/curata.sql" >/dev/null; then echo "ATENTIE: curatenia a picat; de sters manual pe clona rapoartele cu tronson = $ETICHETA" >&2
  else echo "curatenie: rapoartele sintetice $ETICHETA sterse"; fi
  rm -rf "$TMP"
}
REAL="$(q -c "SELECT system_identifier FROM pg_control_system()")"
if [ "$REAL" != "$SISTEM" ]; then echo "REFUZ: system_identifier al bazei ($REAL) <> --sistem ($SISTEM)" >&2; exit 22; fi
if [ "$(q -c "SELECT to_regprocedure('public.fn_executie_uscare_salveaza(bigint, bigint, integer, jsonb, uuid)') IS NOT NULL")" != "t" ]; then
  echo "REFUZ: 20261225a nu e aplicata pe clona" >&2; exit 23
fi
if [ "$(q -c "SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = '$OWNER' AND is_owner IS TRUE)")" != "t" ]; then
  echo "REFUZ: owner-ul sintetic $OWNER lipseste de pe clona (sau nu e owner)" >&2; exit 24
fi
PROIECT="${PROIECT:-$(q -c "SELECT id FROM public.executie_proiecte ORDER BY id LIMIT 1")}"
[[ "$PROIECT" =~ ^[0-9]+$ ]] || { echo "nu gasesc un proiect pe clona" >&2; exit 24; }
trap curata EXIT

JWT="SELECT set_config('request.jwt.claim.sub', '$OWNER', true), set_config('request.jwt.claims', json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;"
ZI="$(q -c "SELECT (now() AT TIME ZONE 'Europe/Bucharest')::date")"
INC="$(q -c "SELECT to_char((now() - interval '5 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")"
FIN="$(q -c "SELECT to_char((now() - interval '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")"
# formularul (40 de chei); COMPLET = închidibil ca NECONFORM fără poze (0 bureți, ultimul piston umed, justificarea pozelor)
plan() { echo "{\"proba_id\":null,\"tronson\":\"$ETICHETA\",\"km_de_la_m\":0,\"km_pana_la_m\":1000,\"lungime_m\":null,\"inceput_planificat\":null,\"notificare_la\":null,\"notificare_ref\":null,\"data_operatie\":null,\"ora_inceput\":null,\"ora_final\":null,\"poz_lat\":null,\"poz_lng\":null,\"poz_sursa\":null,\"poz_precizie_m\":null,\"poz_la\":null,\"poz_km_m\":null,\"poz_traseu_versiune\":null,\"temperatura_c\":null,\"temperatura_sursa\":null,\"meteo\":null,\"vreme\":null,\"constructor\":\"Constructor proba\",\"utilaje\":[],\"pig_metalic_buc\":null,\"piston_pu_buc\":null,\"bureti_buc\":null,\"cantariri\":[],\"punct_roua_c\":null,\"punct_roua_loc\":null,\"presiune_bar\":null,\"timp_deplasare_min\":null,\"piston_final_rezultat\":null,\"poze_justificare\":null,\"observatii\":${1:-null},\"concluzie\":null,\"semn_constructor_nume\":null,\"semn_constructor_functie\":null,\"semn_beneficiar_nume\":null,\"semn_beneficiar_functie\":null}"; }
complet() { echo "{\"proba_id\":null,\"tronson\":\"$ETICHETA\",\"km_de_la_m\":0,\"km_pana_la_m\":1000,\"lungime_m\":1000,\"inceput_planificat\":null,\"notificare_la\":null,\"notificare_ref\":null,\"data_operatie\":\"$ZI\",\"ora_inceput\":\"$INC\",\"ora_final\":\"$FIN\",\"poz_lat\":null,\"poz_lng\":null,\"poz_sursa\":null,\"poz_precizie_m\":null,\"poz_la\":null,\"poz_km_m\":null,\"poz_traseu_versiune\":null,\"temperatura_c\":5,\"temperatura_sursa\":\"manual\",\"meteo\":null,\"vreme\":null,\"constructor\":\"Constructor proba\",\"utilaje\":[{\"denumire\":\"Compresor\",\"buc\":1}],\"pig_metalic_buc\":0,\"piston_pu_buc\":0,\"bureti_buc\":0,\"cantariri\":[],\"punct_roua_c\":null,\"punct_roua_loc\":null,\"presiune_bar\":1.5,\"timp_deplasare_min\":30,\"piston_final_rezultat\":\"umed\",\"poze_justificare\":\"proba de concurenta\",\"observatii\":${1:-null},\"concluzie\":\"neconform\",\"semn_constructor_nume\":null,\"semn_constructor_functie\":null,\"semn_beneficiar_nume\":null,\"semn_beneficiar_functie\":null}"; }
uuid() { q -c "SELECT gen_random_uuid()"; }
# un apel ca owner (comis), întoarce rezultatul JSON
apel() { printf '%s\n' "\\set ON_ERROR_STOP 1" "BEGIN; $JWT" "SELECT $1;" "COMMIT;" > "$TMP/apel.sql"; q -f "$TMP/apel.sql" | grep -v '^$' | tail -1; }
asteapta() {
  echo "DO \$b\$ DECLARE i int := 0; BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND objsubid = 1 AND granted) LOOP
      PERFORM pg_sleep(0.05); i := i + 1; IF i > 400 THEN RAISE EXCEPTION 'bariera $1 nu a aparut'; END IF; END LOOP; END \$b\$;"
}
# sesiunea A: apelul, apoi bariera, 3 s, apoi $3 (COMMIT / ROLLBACK)
sesiune_a() { printf '%s\n' "\\set ON_ERROR_STOP 1" "BEGIN; $JWT" "SELECT $2;" "SELECT pg_advisory_xact_lock($1);" "SELECT pg_sleep(3);" "${3:-COMMIT};"; }
# sesiunea B: așteaptă bariera, apoi apelul; tipărește rezultatul și timpul așteptat (secunde)
sesiune_b() {
  printf '%s\n' "\\set ON_ERROR_STOP 1" "$(asteapta "$1")" "BEGIN; $JWT" "SET LOCAL lock_timeout = '20s';" \
    "SELECT 'T0=' || extract(epoch FROM clock_timestamp());" "SELECT 'R=' || ($2)::text;" "SELECT 'T1=' || extract(epoch FROM clock_timestamp());" "COMMIT;"
}
ESEC=0
verdict() { if [ "$1" = "0" ]; then echo "OK   $2"; else echo "FAIL $2"; ESEC=1; fi; }
ruleaza_doua() {
  "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_a.sql" > "$TMP/$1_a.log" 2>&1 & PID_A=$!
  "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_b.sql" > "$TMP/$1_b.log" 2>&1 & PID_B=$!
  set +e; wait $PID_A; RC_A=$?; wait $PID_B; RC_B=$?; set -e
  R_B="$(grep '^R=' "$TMP/$1_b.log" | cut -c3- || true)"
  T0="$(grep '^T0=' "$TMP/$1_b.log" | cut -c4- || true)"; T1="$(grep '^T1=' "$TMP/$1_b.log" | cut -c4- || true)"
  ASTEPTAT_S="$(awk -v a="${T0:-0}" -v b="${T1:-0}" 'BEGIN { printf "%.2f", b - a }')"
}
a_asteptat() { awk -v s="$ASTEPTAT_S" 'BEGIN { exit !(s >= 1.0) }'; }
salv() { echo "public.fn_executie_uscare_salveaza($PROIECT, $1, $2, '$3'::jsonb, '$4'::uuid)"; }
stare_rpc() { echo "public.fn_executie_uscare_stare($1, $2, '$3', NULL, '$(uuid)'::uuid)"; }
camp() { q -c "SELECT $2 FROM public.executie_uscari WHERE id = $1"; }

# ── C1: creare + reîncercare cu aceeași cheie, concurent (A comite) ──
K="$(uuid)"
sesiune_a 202612251 "$(salv NULL NULL "$(plan)" "$K")" COMMIT > "$TMP/c1_a.sql"
sesiune_b 202612251 "$(salv NULL NULL "$(plan)" "$K")" > "$TMP/c1_b.sql"
ruleaza_doua c1
N="$(q -c "SELECT count(*) FROM public.executie_uscare_jurnal WHERE cheie = '$K'")"
ID_A="$(q -c "SELECT uscare_id FROM public.executie_uscare_jurnal WHERE cheie = '$K'")"
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && [ "$N" = 1 ] && a_asteptat && [[ "$R_B" == *'"duplicat": true'* ]] && [[ "$R_B" == *"\"id\": $ID_A,"* ]]; then R=0; else R=1; fi
verdict "$R" "C1 creare + reincercare concurenta (aceeasi cheie): B a asteptat ${ASTEPTAT_S}s, duplicat cu acelasi id $ID_A; un singur rand in jurnal ($N); iesiri $RC_A/$RC_B"

# ── C2: aceeași, A anulează: B creează el ──
K="$(uuid)"
sesiune_a 202612252 "$(salv NULL NULL "$(plan)" "$K")" ROLLBACK > "$TMP/c2_a.sql"
sesiune_b 202612252 "$(salv NULL NULL "$(plan)" "$K")" > "$TMP/c2_b.sql"
ruleaza_doua c2
N="$(q -c "SELECT count(*) FROM public.executie_uscare_jurnal WHERE cheie = '$K'")"
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && [ "$N" = 1 ] && a_asteptat && [[ "$R_B" == *'"duplicat": false'* ]]; then R=0; else R=1; fi
verdict "$R" "C2 creare A anulata + B cu aceeasi cheie: B a asteptat ${ASTEPTAT_S}s si a creat (duplicat false); $N rand in jurnal; iesiri $RC_A/$RC_B"

# rapoarte complete (închidibile ca NECONFORM fără poze) pentru E1 / E2 / P1 / P2
nou_complet() { apel "$(salv NULL NULL "$(complet)" "$(uuid)")" | sed -E 's/.*"id": ([0-9]+),.*/\1/'; }
# ── E1: salvare (A, deschisă) + închidere (B) pe aceeași versiune ──
ID="$(nou_complet)"; V="$(camp "$ID" versiune)"
sesiune_a 202612253 "$(salv "$ID" "$V" "$(complet '"scris de A"')" "$(uuid)")" COMMIT > "$TMP/e1_a.sql"
sesiune_b 202612253 "$(stare_rpc "$ID" "$V" inchide)" > "$TMP/e1_b.sql"
ruleaza_doua e1
F="$(camp "$ID" "stare || '|' || versiune || '|' || coalesce(observatii, '')")"
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && a_asteptat && [[ "$R_B" == *'"motiv": "conflict"'* ]] && [ "$F" = "deschisa|$((V + 1))|scris de A" ]; then R=0; else R=1; fi
verdict "$R" "E1 salvare in curs + inchidere (v$V): B a asteptat ${ASTEPTAT_S}s, conflict; final '$F' (asteptat 'deschisa|$((V + 1))|scris de A'); iesiri $RC_A/$RC_B"

# ── E2: închidere (A, deschisă) + salvare (B) pe aceeași versiune ──
ID="$(nou_complet)"; V="$(camp "$ID" versiune)"
sesiune_a 202612254 "$(stare_rpc "$ID" "$V" inchide)" COMMIT > "$TMP/e2_a.sql"
sesiune_b 202612254 "$(salv "$ID" "$V" "$(complet '"scris de B"')" "$(uuid)")" > "$TMP/e2_b.sql"
ruleaza_doua e2
F="$(camp "$ID" "stare || '|' || versiune || '|' || coalesce(observatii, '')")"
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && a_asteptat && [[ "$R_B" == *'"motiv": "conflict"'* ]] && [ "$F" = "inchisa|$((V + 1))|" ]; then R=0; else R=1; fi
verdict "$R" "E2 inchidere in curs + salvare (v$V): B a asteptat ${ASTEPTAT_S}s, conflict; final '$F' (asteptat 'inchisa|$((V + 1))|'); iesiri $RC_A/$RC_B"

# poza: rezervare comisă + fișier fals în bucket (ca postgres), apoi înregistrarea în sesiunea care ține
pregateste_poza() {   # $1 = id raport; tipărește calea
  local c="$PROIECT/$1/$(uuid).jpg"
  apel "public.fn_executie_uscare_poza($1, 'rezerva', NULL, '$c', 'altele', NULL, NULL, '$(uuid)'::uuid)" >/dev/null
  q -c "INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('executie-uscare', '$c', '$OWNER')" >/dev/null
  echo "$c"
}
adauga_rpc() { echo "public.fn_executie_uscare_poza($1, 'adauga', NULL, '$2', NULL, NULL, NULL, '$(uuid)'::uuid)"; }
# ── P1: înregistrarea pozei (A, deschisă) + închidere (B) ──
ID="$(nou_complet)"; C="$(pregateste_poza "$ID")"; V="$(camp "$ID" versiune)"
sesiune_a 202612255 "$(adauga_rpc "$ID" "$C")" COMMIT > "$TMP/p1_a.sql"
sesiune_b 202612255 "$(stare_rpc "$ID" "$V" inchide)" > "$TMP/p1_b.sql"
ruleaza_doua p1
F="$(camp "$ID" stare)"
NP="$(q -c "SELECT jsonb_array_length(valori -> 'poze') FROM public.executie_uscare_jurnal WHERE uscare_id = $ID AND actiune = 'inchidere'")"
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && a_asteptat && [[ "$R_B" == *'"ok": true'* ]] && [ "$F" = inchisa ] && [ "$NP" = 1 ]; then R=0; else R=1; fi
verdict "$R" "P1 poza in curs + inchidere: B a asteptat ${ASTEPTAT_S}s si a inchis; jurnalul inchiderii are $NP poza (asteptat 1); iesiri $RC_A/$RC_B"

# ── P2: închidere (A, deschisă) + înregistrarea pozei (B) ──
ID="$(nou_complet)"; C="$(pregateste_poza "$ID")"
apel "$(adauga_rpc "$ID" "$C")" >/dev/null          # o poză înregistrată, zero rezervări deschise: raportul se poate închide
V="$(camp "$ID" versiune)"
C3="$PROIECT/$ID/$(uuid).jpg"                         # B încearcă o rezervare NOUĂ cât A ține închiderea
sesiune_a 202612256 "$(stare_rpc "$ID" "$V" inchide)" COMMIT > "$TMP/p2_a.sql"
printf '%s\n' "\\set ON_ERROR_STOP 0" "$(asteapta 202612256)" "BEGIN; $JWT" "SET LOCAL lock_timeout = '20s';" \
  "SELECT 'T0=' || extract(epoch FROM clock_timestamp());" "SELECT public.fn_executie_uscare_poza($ID, 'rezerva', NULL, '$C3', 'altele', NULL, NULL, '$(uuid)'::uuid);" \
  "\\echo 'R='':LAST_ERROR_SQLSTATE'" "ROLLBACK;" "SELECT 'T1=' || extract(epoch FROM clock_timestamp());" > "$TMP/p2_b.sql"
ruleaza_doua p2
F="$(camp "$ID" stare)"
NP="$(q -c "SELECT count(*) FROM public.executie_uscare_poze WHERE uscare_id = $ID")"
if [ "$RC_A" = 0 ] && a_asteptat && [ "$R_B" = 22023 ] && [ "$F" = inchisa ] && [ "$NP" = 1 ]; then R=0; else R=1; fi
verdict "$R" "P2 inchidere in curs + inregistrarea unei poze: B a asteptat ${ASTEPTAT_S}s, refuz $R_B (asteptat 22023); poze $NP (asteptat 1); iesire A $RC_A"

retrage_rpc() { echo "public.fn_executie_uscare_retrage($PROIECT, '$1'::uuid)"; }
# ── R1: creare în curs (A) + „Renunț” pe aceeași cheie (B): B vede crearea ca APLICATĂ, nu o retrage ──
K="$(uuid)"
sesiune_a 202612257 "$(salv NULL NULL "$(plan)" "$K")" COMMIT > "$TMP/r1_a.sql"
sesiune_b 202612257 "$(retrage_rpc "$K")" > "$TMP/r1_b.sql"
ruleaza_doua r1
J="$(q -c "SELECT string_agg(actiune, ',') FROM public.executie_uscare_jurnal WHERE cheie = '$K'")"
ID_A="$(q -c "SELECT uscare_id FROM public.executie_uscare_jurnal WHERE cheie = '$K'")"
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && a_asteptat && [[ "$R_B" == *'"aplicat": true'* ]] && [[ "$R_B" == *"\"uscare_id\": $ID_A"* ]] && [ "$J" = creare ]; then R=0; else R=1; fi
verdict "$R" "R1 creare in curs + Renunt pe aceeasi cheie: B a asteptat ${ASTEPTAT_S}s, aplicat cu id $ID_A; jurnalul cheii '$J' (asteptat 'creare'); iesiri $RC_A/$RC_B"

# ── R2: retragere în curs (A) + crearea întârziată cu aceeași cheie (B): refuz, niciun raport ──
K="$(uuid)"; echo "$K" >> "$TMP/chei_retrase"
sesiune_a 202612258 "$(retrage_rpc "$K")" COMMIT > "$TMP/r2_a.sql"
printf '%s\n' "\\set ON_ERROR_STOP 0" "$(asteapta 202612258)" "BEGIN; $JWT" "SET LOCAL lock_timeout = '20s';" \
  "SELECT 'T0=' || extract(epoch FROM clock_timestamp());" "SELECT $(salv NULL NULL "$(plan)" "$K");" \
  "\\echo 'R='':LAST_ERROR_SQLSTATE'" "ROLLBACK;" "SELECT 'T1=' || extract(epoch FROM clock_timestamp());" > "$TMP/r2_b.sql"
ruleaza_doua r2
J="$(q -c "SELECT string_agg(actiune || ':' || coalesce(uscare_id::text, '-'), ',') FROM public.executie_uscare_jurnal WHERE cheie = '$K'")"
if [ "$RC_A" = 0 ] && a_asteptat && [ "$R_B" = 22023 ] && [ "$J" = "cheie_retrasa:-" ]; then R=0; else R=1; fi
verdict "$R" "R2 retragere in curs + creare intarziata cu aceeasi cheie: B a asteptat ${ASTEPTAT_S}s, refuz $R_B (asteptat 22023); jurnalul cheii '$J'; iesire A $RC_A"

# ── H1: coliziune de hashtext între două chei diferite: se serializează, dar NU se confundă ──
PERECHE="$(q -c "WITH u AS (SELECT gen_random_uuid() AS k FROM generate_series(1, 300000)), h AS (SELECT k, hashtext(k::text) AS x FROM u)
  SELECT a.k || ' ' || b.k FROM h a JOIN h b ON a.x = b.x AND a.k < b.k LIMIT 1")"
K1="${PERECHE%% *}"; K2="${PERECHE##* }"
if [[ "$K1" =~ ^[0-9a-f-]{36}$ ]] && [[ "$K2" =~ ^[0-9a-f-]{36}$ ]] && [ "$K1" != "$K2" ]; then
  sesiune_a 202612259 "$(salv NULL NULL "$(plan)" "$K1")" COMMIT > "$TMP/h1_a.sql"
  sesiune_b 202612259 "$(salv NULL NULL "$(plan)" "$K2")" > "$TMP/h1_b.sql"
  ruleaza_doua h1
  N="$(q -c "SELECT count(DISTINCT uscare_id) FROM public.executie_uscare_jurnal WHERE cheie IN ('$K1', '$K2') AND actiune = 'creare'")"
  if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && a_asteptat && [[ "$R_B" == *'"duplicat": false'* ]] && [ "$N" = 2 ]; then R=0; else R=1; fi
  verdict "$R" "H1 doua chei cu acelasi hashtext: B a asteptat ${ASTEPTAT_S}s si a creat ALT raport (duplicat false); rapoarte distincte $N (asteptat 2); iesiri $RC_A/$RC_B"
else
  verdict 1 "H1 nu am gasit o coliziune de hashtext in 300000 de chei (reia proba)"
fi

[ "$ESEC" = 0 ] && echo "TOTUL OK" || echo "EȘEC"
exit "$ESEC"
