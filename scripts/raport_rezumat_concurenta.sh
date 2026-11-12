#!/usr/bin/env bash
# Proba de CONCURENȚĂ pentru 20261216a (r3, Jakarinos P2: „Revino la automat” ocolea detectarea conflictului) — DOAR pe CLONĂ, cu două
# sesiuni psql reale (L25). Tiparul: scripts/izometrie_muta_pozitie_concurenta.sh.
# Rulare din Git Bash, cu psql de Windows (fără WSL, fără \!); conexiunea după `--` (parola din pgpass, niciodată pe linia de comandă):
#   PSQL=/c/Users/Public/pgsql/bin/psql.exe bash scripts/raport_rezumat_concurenta.sh --sistem <system_identifier al clonei> \
#        -- -h <host clonă> -p <port> -U postgres -d postgres
# Garda țintei: system_identifier al bazei (pg_control_system()) trebuie să fie EXACT --sistem, altfel refuz (cod 22) înainte de orice scriere.
# Datele: UN raport SINTETIC (primul șantier, ziua 2001-01-05, scris direct ca postgres), COMIS pe clonă pentru că sesiunile trebuie să-l
#   vadă, și șters la final (trap), indiferent de rezultat. Dacă ziua e deja ocupată pe acel șantier: refuz (cod 24), nimic șters.
#   Identitatea sesiunilor: owner-ul sintetic al clonei (00000000-0000-4000-8000-000000000001, schimbabil cu OWNER=<uuid>), cu rolul
#   authenticated și JWT-ul aplicației în ambele surse.
# Scenarii (cele „două telefoane care au citit aceeași versiune”; bariera = un lock consultativ ținut de sesiunea care „ține”):
#   S1 telefonul 1 face „Revino la automat” (CAS = V, tranzacție deschisă), telefonul 2 trimite corectura veche cu CAS = V peste el
#      → al doilea AȘTEAPTĂ rândul, apoi 0 rânduri (versiunea a crescut la V+1): conflict, nimic scris de el; rezumatul = automat, V+1;
#   S2 ordinea inversă: telefonul 1 salvează o corectură (CAS = V, deschisă), telefonul 2 face „Revino la automat” cu CAS = V
#      → al doilea așteaptă, apoi 0 rânduri; rămâne corectura telefonului 1, V+1;
#   S3 una după alta (fără suprapunere): „Revino la automat” comis, apoi corectura veche cu CAS = V → 0 rânduri.
#   La fiecare: codul de ieșire al fiecărei sesiuni se păstrează (wait PID), starea finală e citită din BD.
# Ieșire: 0 = toate scenariile OK; 1 = un scenariu a picat; 2 = argumente; 22 = altă țintă; 23 = 20261216a neaplicată;
#   24 = owner-ul sintetic lipsește / ziua de test e ocupată.
set -euo pipefail
PSQL="${PSQL:-psql}"
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
cd "$(dirname "$0")/.."
TMP="$(mktemp -d ./.concurenta_20261216a.XXXXXX)"   # în repo: căi relative, fără conversia /tmp pentru psql de Windows
q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" "$@"; }
RAPORT=""
curata() {
  if [ -n "$RAPORT" ]; then
    if ! q -c "DELETE FROM public.rapoarte_zilnice WHERE id = $RAPORT AND data = DATE '2001-01-05';" >/dev/null; then
      echo "ATENTIE: curatenia a picat; de sters manual pe clona: raportul $RAPORT (ziua 2001-01-05)" >&2
    else echo "curatenie: raportul sintetic $RAPORT sters"; fi
  fi
  rm -rf "$TMP"
}
trap curata EXIT

REAL="$(q -c "SELECT system_identifier FROM pg_control_system()")"
if [ "$REAL" != "$SISTEM" ]; then echo "REFUZ: system_identifier al bazei ($REAL) <> --sistem ($SISTEM)" >&2; exit 22; fi
if [ "$(q -c "SELECT to_regprocedure('public.fn_raport_rezumat_garda()') IS NOT NULL")" != "t" ]; then
  echo "REFUZ: 20261216a nu e aplicata pe clona" >&2; exit 23
fi
if [ "$(q -c "SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = '$OWNER' AND is_owner IS TRUE)")" != "t" ]; then
  echo "REFUZ: owner-ul sintetic $OWNER lipseste de pe clona (sau nu e owner)" >&2; exit 24
fi
SITE="$(q -c "SELECT id FROM public.sites ORDER BY id LIMIT 1")"
[[ "$SITE" =~ ^[0-9]+$ ]] || { echo "nu gasesc un santier pe clona" >&2; exit 24; }
if [ "$(q -c "SELECT EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data = DATE '2001-01-05')")" != "f" ]; then
  echo "REFUZ: ziua de test 2001-01-05 e ocupata pe santierul $SITE (nu sterg nimic)" >&2; exit 24
fi

# ── raportul sintetic (comis, șters în trap) ──
RAPORT="$(q -c "INSERT INTO public.rapoarte_zilnice (site_id, data, probleme, created_by, updated_at)
                VALUES ($SITE, DATE '2001-01-05', 'Proba concurenta rezumat', '$OWNER', now()) RETURNING id" | head -1)"
[[ "$RAPORT" =~ ^[0-9]+$ ]] || { echo "raportul sintetic: iesire neasteptata: $RAPORT" >&2; RAPORT=""; exit 1; }

JWT="SELECT set_config('request.jwt.claim.sub', '$OWNER', true), set_config('request.jwt.claims', json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;"
# corectura de plecare, ca owner-ul (CAS pe versiunea curentă); întoarce versiunea de după
corecteaza() {
  cat > "$TMP/corectura.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN; $JWT
UPDATE public.rapoarte_zilnice SET rezumat_text = '$1', rezumat_sursa = 'editat' WHERE id = $RAPORT;
COMMIT;
SQL
  q -f "$TMP/corectura.sql" >/dev/null
  q -c "SELECT versiune_salvare FROM public.rapoarte_zilnice WHERE id = $RAPORT"
}
stare() { q -c "SELECT rezumat_sursa || '|' || versiune_salvare || '|' || coalesce(rezumat_text, '') FROM public.rapoarte_zilnice WHERE id = $RAPORT"; }
# așteaptă până când lock-ul consultativ $1 (bariera) e ținut de altă sesiune, cel mult 20 s
asteapta() {
  echo "DO \$b\$ DECLARE i int := 0; BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND objsubid = 1 AND granted) LOOP
      PERFORM pg_sleep(0.05); i := i + 1; IF i > 400 THEN RAISE EXCEPTION 'bariera $1 nu a aparut'; END IF; END LOOP; END \$b\$;"
}
# a doua sesiune: UPDATE cu CAS pe versiunea veche; trebuie să aștepte (≥ 1 s, rândul e ținut) și să atingă 0 rânduri
al_doilea() {   # $1 = bariera, $2 = SET-ul UPDATE-ului, $3 = versiunea veche, $4 = eticheta
  cat <<SQL
\set ON_ERROR_STOP 1
$(asteapta "$1")
BEGIN; $JWT
SET LOCAL lock_timeout = '20s';
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp(); n integer;
BEGIN
  UPDATE public.rapoarte_zilnice SET $2 WHERE id = $RAPORT AND versiune_salvare = $3;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL $4: scrierea pe versiunea veche $3 a atins % randuri (conflict nedetectat)', n; END IF;
  IF clock_timestamp() - t0 < interval '1 second' THEN RAISE EXCEPTION 'FAIL $4: nu a asteptat randul tinut de prima sesiune (%)', clock_timestamp() - t0; END IF;
  RAISE NOTICE '$4 a doua sesiune: 0 randuri dupa % (conflict)', clock_timestamp() - t0;
END \$t\$;
COMMIT;
SQL
}
primul() {   # $1 = bariera, $2 = SET-ul UPDATE-ului, $3 = versiunea
  cat <<SQL
\set ON_ERROR_STOP 1
BEGIN; $JWT
DO \$t\$ DECLARE n integer; BEGIN
  UPDATE public.rapoarte_zilnice SET $2 WHERE id = $RAPORT AND versiune_salvare = $3;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: prima sesiune a atins % randuri', n; END IF;
END \$t\$;
SELECT pg_advisory_xact_lock($1);
SELECT pg_sleep(3);
COMMIT;
SQL
}
ESEC=0
verdict() { if [ "$1" = "0" ]; then echo "OK   $2"; else echo "FAIL $2"; ESEC=1; fi; }
ruleaza_doua() {   # $1 = scenariu; fișierele $TMP/$1_a.sql, $TMP/$1_b.sql
  "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_a.sql" > "$TMP/$1_a.log" 2>&1 & PID_A=$!
  "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_b.sql" > "$TMP/$1_b.log" 2>&1 & PID_B=$!
  set +e; wait $PID_A; RC_A=$?; wait $PID_B; RC_B=$?; set -e
  cat "$TMP/$1_a.log" "$TMP/$1_b.log"
}

# ── S1: „Revino la automat” (deschis) + corectura veche peste el ──
V="$(corecteaza 'Corectura S1')"
primul 162160001 "rezumat_sursa = 'automat'" "$V" > "$TMP/s1_a.sql"
al_doilea 162160001 "rezumat_text = 'Corectura veche S1', rezumat_sursa = 'editat'" "$V" S1 > "$TMP/s1_b.sql"
ruleaza_doua s1
FINAL="$(stare)"; ASTEPTAT_PREFIX="automat|$((V + 1))|"
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && [[ "$FINAL" == "$ASTEPTAT_PREFIX"* ]] && [[ "$FINAL" != *"Corectura veche"* ]]; then R=0; else R=1; fi
verdict "$R" "S1 revino la automat in curs + corectura veche (CAS $V): conflict; final ${FINAL%%|*}|v${V}->$(echo "$FINAL" | cut -d'|' -f2) (asteptat automat, v$((V + 1))); iesiri $RC_A/$RC_B"

# ── S2: corectura (deschisă) + „Revino la automat” peste ea ──
V="$(corecteaza 'Corectura S2 de plecare')"
primul 162160002 "rezumat_text = 'Corectura S2 telefonul 1', rezumat_sursa = 'editat'" "$V" > "$TMP/s2_a.sql"
al_doilea 162160002 "rezumat_sursa = 'automat'" "$V" S2 > "$TMP/s2_b.sql"
ruleaza_doua s2
FINAL="$(stare)"; ASTEPTAT="editat|$((V + 1))|Corectura S2 telefonul 1"
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && [ "$FINAL" = "$ASTEPTAT" ]; then R=0; else R=1; fi
verdict "$R" "S2 corectura in curs + revino la automat (CAS $V): conflict; final '$FINAL' (asteptat '$ASTEPTAT'); iesiri $RC_A/$RC_B"

# ── S3: una după alta: „Revino la automat” comis, apoi corectura veche cu CAS = V ──
V="$(corecteaza 'Corectura S3')"
cat > "$TMP/s3_a.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN; $JWT
UPDATE public.rapoarte_zilnice SET rezumat_sursa = 'automat' WHERE id = $RAPORT AND versiune_salvare = $V;
COMMIT;
SQL
cat > "$TMP/s3_b.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN; $JWT
DO \$t\$ DECLARE n integer; BEGIN
  UPDATE public.rapoarte_zilnice SET rezumat_text = 'Corectura veche S3', rezumat_sursa = 'editat' WHERE id = $RAPORT AND versiune_salvare = $V;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL S3: corectura veche a atins % randuri', n; END IF;
  RAISE NOTICE 'S3 a doua sesiune: 0 randuri (conflict)';
END \$t\$;
COMMIT;
SQL
set +e
"$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/s3_a.sql" > "$TMP/s3_a.log" 2>&1; RC_A=$?
"$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/s3_b.sql" > "$TMP/s3_b.log" 2>&1; RC_B=$?
set -e
cat "$TMP/s3_a.log" "$TMP/s3_b.log"
FINAL="$(stare)"; ASTEPTAT_PREFIX="automat|$((V + 1))|"
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && [[ "$FINAL" == "$ASTEPTAT_PREFIX"* ]] && [[ "$FINAL" != *"Corectura veche"* ]]; then R=0; else R=1; fi
verdict "$R" "S3 revino la automat comis, apoi corectura veche (CAS $V): conflict; final ${FINAL%%|*} v$(echo "$FINAL" | cut -d'|' -f2) (asteptat automat, v$((V + 1))); iesiri $RC_A/$RC_B"

if [ "$ESEC" = 0 ]; then echo "Toate scenariile de concurenta 20261216a au trecut"; else echo "Cel putin un scenariu de concurenta a picat"; fi
exit "$ESEC"
