#!/usr/bin/env bash
# Proba de CONCURENȚĂ pentru 20261215c (mutarea unei piese vs. ↑ / ↓) — DOAR pe CLONĂ, cu două sesiuni psql reale (L25).
# Rulare din Git Bash, cu psql de Windows (fără WSL, fără \!); conexiunea după `--` (parola din pgpass, niciodată pe linia de comandă):
#   PSQL=/c/Users/Public/pgsql/bin/psql.exe bash scripts/izometrie_muta_pozitie_concurenta.sh --sistem <system_identifier al clonei> \
#        -- -h <host clonă> -p <port> -U postgres -d postgres
# Garda țintei: system_identifier al bazei (pg_control_system()) trebuie să fie EXACT --sistem, altfel refuz (cod 22) înainte de orice scriere.
# Datele: trei pachete SINTETICE (supabase/tests/20261215c_izometrie_date_sintetice.sql), COMISE pe clonă pentru că sesiunile trebuie să
#   le vadă, și șterse la final (trap), indiferent de rezultat. Identitatea sesiunilor: owner-ul sintetic al clonei
#   (00000000-0000-4000-8000-000000000001, schimbabil cu OWNER=<uuid>), cu rolul authenticated și JWT-ul aplicației.
# Scenarii (fiecare pe pachetul lui; bariera = un lock consultativ ținut de sesiunea care „ține”, urmărit în pg_locks):
#   S1 un ↑ / ↓ ține două țevi (tranzacție deschisă), mutarea vine peste el      → mutarea refuză IMEDIAT 55P03 (< 2 s), nimic scris;
#   S2 mutarea ține pachetul (tranzacție deschisă), un ↑ / ↓ vine peste ea       → schimbul AȘTEAPTĂ și reușește după COMMIT, fără 40P01;
#   S3 două mutări pe același pachet                                               → a doua refuză IMEDIAT 55P03;
#   la fiecare: ordinea finală = exact efectul tranzacțiilor reușite. Codul de ieșire al fiecărei sesiuni se păstrează (wait PID).
# Ieșire: 0 = toate scenariile OK; 1 = un scenariu a picat; 2 = argumente; 22 = altă țintă; 23 = 20261215c neaplicată.
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
TMP="$(mktemp -d ./.concurenta_20261215c.XXXXXX)"   # în repo: căi relative, fără conversia /tmp pentru psql de Windows
q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" "$@"; }
PROIECTE=(); PACHETE=(); TEVI=()
curata() {
  if [ ${#PACHETE[@]} -gt 0 ]; then
    local p="${PACHETE[*]}" r="${PROIECTE[*]}"
    if ! q -c "BEGIN; DELETE FROM public.executie_tevi WHERE pachet_id IN (${p// /,}); DELETE FROM public.executie_pachete_lansare WHERE id IN (${p// /,});
               DELETE FROM public.executie_proiecte WHERE id IN (${r// /,}); COMMIT;" >/dev/null; then
      echo "ATENTIE: curatenia a picat; de sters manual pe clona: pachetele ${p}, proiectele ${r}" >&2
    else echo "curatenie: pachetele ${p} si proiectele ${r} sterse"; fi
  fi
  rm -rf "$TMP"
}
trap curata EXIT

REAL="$(q -c "SELECT system_identifier FROM pg_control_system()")"
if [ "$REAL" != "$SISTEM" ]; then echo "REFUZ: system_identifier al bazei ($REAL) <> --sistem ($SISTEM)" >&2; exit 22; fi
if [ "$(q -c "SELECT to_regprocedure('public.fn_executie_tevi_muta_pozitie(bigint, integer)') IS NOT NULL")" != "t" ]; then
  echo "REFUZ: 20261215c nu e aplicata pe clona" >&2; exit 23
fi

# ── date sintetice: trei pachete, comise; id-urile pentru curățenie ──
for i in 1 2 3; do
  # \i e relativ la directorul curent (rădăcina repo-ului, cd mai sus)
  cat > "$TMP/setup.sql" <<'SQL'
\set ON_ERROR_STOP 1
BEGIN;
\i supabase/tests/20261215c_izometrie_date_sintetice.sql
SELECT current_setting('t.proiect') || ' ' || current_setting('t.pachet') || ' ' || current_setting('t.tevi');
COMMIT;
SQL
  LINIE="$(q -f "$TMP/setup.sql" | tail -1)"
  read -r PR PA TV <<< "$LINIE"
  [[ "$PR" =~ ^[0-9]+$ && "$PA" =~ ^[0-9]+$ && "$TV" =~ ^[0-9,]+$ ]] || { echo "date sintetice: iesire neasteptata: $LINIE" >&2; exit 1; }
  PROIECTE+=("$PR"); PACHETE+=("$PA"); TEVI+=("$TV")
done

JWT="SELECT set_config('request.jwt.claim.sub', '$OWNER', true), set_config('request.jwt.claims', json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;"
# așteaptă până când lock-ul consultativ $1 (bariera) e ținut de altă sesiune, cel mult 20 s
asteapta() {
  echo "DO \$b\$ DECLARE i int := 0; BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND objsubid = 1 AND granted) LOOP
      PERFORM pg_sleep(0.05); i := i + 1; IF i > 400 THEN RAISE EXCEPTION 'bariera $1 nu a aparut'; END IF; END LOOP; END \$b\$;"
}
ordine() { q -c "SELECT string_agg(id::text, ',' ORDER BY poz_in_pachet, id) FROM public.executie_tevi WHERE pachet_id = $1"; }
ESEC=0
verdict() { if [ "$1" = "0" ]; then echo "OK   $2"; else echo "FAIL $2"; ESEC=1; fi; }

# ── S1: ↑ / ↓ ține două țevi, mutarea vine peste el → 55P03 imediat ──
IFS=, read -r -a T <<< "${TEVI[0]}"; P="${PACHETE[0]}"
cat > "$TMP/s1_tine.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN; $JWT
SELECT public.fn_executie_swap_tevi_pozitie(${T[4]}, ${T[3]});
SELECT pg_advisory_xact_lock(151215001);
SELECT pg_sleep(4);
COMMIT;
SQL
cat > "$TMP/s1_muta.sql" <<SQL
\set ON_ERROR_STOP 1
$(asteapta 151215001)
BEGIN; $JWT
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp(); v_st text;
BEGIN
  BEGIN PERFORM public.fn_executie_tevi_muta_pozitie(${T[4]}, 1); RAISE EXCEPTION 'FAIL S1: mutarea a trecut peste un schimb in curs';
  EXCEPTION WHEN lock_not_available THEN GET STACKED DIAGNOSTICS v_st = RETURNED_SQLSTATE; END;
  IF clock_timestamp() - t0 > interval '2 seconds' THEN RAISE EXCEPTION 'FAIL S1: mutarea a asteptat % (trebuia refuz imediat)', clock_timestamp() - t0; END IF;
  RAISE NOTICE 'S1 mutarea: % dupa %', v_st, clock_timestamp() - t0;
END \$t\$;
ROLLBACK;
SQL
"$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/s1_tine.sql" > "$TMP/s1_tine.log" 2>&1 & PID_T=$!
"$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/s1_muta.sql" > "$TMP/s1_muta.log" 2>&1 & PID_M=$!
set +e; wait $PID_T; RC_T=$?; wait $PID_M; RC_M=$?; set -e
cat "$TMP/s1_tine.log" "$TMP/s1_muta.log"
ASTEPTAT="${T[0]},${T[1]},${T[2]},${T[4]},${T[3]}"; FINAL="$(ordine "$P")"
if [ "$RC_T" = 0 ] && [ "$RC_M" = 0 ] && [ "$FINAL" = "$ASTEPTAT" ]; then R=0; else R=1; fi
verdict "$R" "S1 schimb in curs + mutare: refuz imediat 55P03; ordinea $FINAL (asteptat $ASTEPTAT); iesiri $RC_T/$RC_M"

# ── S2: mutarea ține pachetul, ↑ / ↓ vine peste ea → așteaptă și reușește, fără 40P01 ──
IFS=, read -r -a T <<< "${TEVI[1]}"; P="${PACHETE[1]}"
cat > "$TMP/s2_tine.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN; $JWT
SELECT public.fn_executie_tevi_muta_pozitie(${T[4]}, 1);
SELECT pg_advisory_xact_lock(151215002);
SELECT pg_sleep(4);
COMMIT;
SQL
cat > "$TMP/s2_schimb.sql" <<SQL
\set ON_ERROR_STOP 1
$(asteapta 151215002)
BEGIN; $JWT
SET LOCAL lock_timeout = '20s';
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM public.fn_executie_swap_tevi_pozitie(${T[3]}, ${T[2]});   -- ↑ pe penultima piesă din ecranul vechi
  IF clock_timestamp() - t0 < interval '1 second' THEN RAISE EXCEPTION 'FAIL S2: schimbul nu a asteptat mutarea (% )', clock_timestamp() - t0; END IF;
  RAISE NOTICE 'S2 schimbul a asteptat % si a trecut', clock_timestamp() - t0;
END \$t\$;
COMMIT;
SQL
"$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/s2_tine.sql" > "$TMP/s2_tine.log" 2>&1 & PID_T=$!
"$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/s2_schimb.sql" > "$TMP/s2_schimb.log" 2>&1 & PID_S=$!
set +e; wait $PID_T; RC_T=$?; wait $PID_S; RC_S=$?; set -e
cat "$TMP/s2_tine.log" "$TMP/s2_schimb.log"
ASTEPTAT="${T[4]},${T[0]},${T[1]},${T[3]},${T[2]}"; FINAL="$(ordine "$P")"
if grep -q -E "40P01|deadlock" "$TMP/s2_tine.log" "$TMP/s2_schimb.log"; then FARA_DL=1; else FARA_DL=0; fi
if [ "$RC_T" = 0 ] && [ "$RC_S" = 0 ] && [ "$FARA_DL" = 0 ] && [ "$FINAL" = "$ASTEPTAT" ]; then R=0; else R=1; fi
verdict "$R" "S2 mutare in curs + schimb: schimbul asteapta, fara deadlock; ordinea $FINAL (asteptat $ASTEPTAT); iesiri $RC_T/$RC_S"

# ── S3: două mutări pe același pachet → a doua refuză imediat ──
IFS=, read -r -a T <<< "${TEVI[2]}"; P="${PACHETE[2]}"
cat > "$TMP/s3_tine.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN; $JWT
SELECT public.fn_executie_tevi_muta_pozitie(${T[4]}, 1);
SELECT pg_advisory_xact_lock(151215003);
SELECT pg_sleep(4);
COMMIT;
SQL
cat > "$TMP/s3_muta.sql" <<SQL
\set ON_ERROR_STOP 1
$(asteapta 151215003)
BEGIN; $JWT
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp(); v_st text;
BEGIN
  BEGIN PERFORM public.fn_executie_tevi_muta_pozitie(${T[0]}, 5); RAISE EXCEPTION 'FAIL S3: a doua mutare a trecut';
  EXCEPTION WHEN lock_not_available THEN GET STACKED DIAGNOSTICS v_st = RETURNED_SQLSTATE; END;
  IF clock_timestamp() - t0 > interval '2 seconds' THEN RAISE EXCEPTION 'FAIL S3: a doua mutare a asteptat %', clock_timestamp() - t0; END IF;
  RAISE NOTICE 'S3 a doua mutare: % dupa %', v_st, clock_timestamp() - t0;
END \$t\$;
ROLLBACK;
SQL
"$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/s3_tine.sql" > "$TMP/s3_tine.log" 2>&1 & PID_T=$!
"$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/s3_muta.sql" > "$TMP/s3_muta.log" 2>&1 & PID_M=$!
set +e; wait $PID_T; RC_T=$?; wait $PID_M; RC_M=$?; set -e
cat "$TMP/s3_tine.log" "$TMP/s3_muta.log"
ASTEPTAT="${T[4]},${T[0]},${T[1]},${T[2]},${T[3]}"; FINAL="$(ordine "$P")"
if [ "$RC_T" = 0 ] && [ "$RC_M" = 0 ] && [ "$FINAL" = "$ASTEPTAT" ]; then R=0; else R=1; fi
verdict "$R" "S3 doua mutari: a doua refuza imediat; ordinea $FINAL (asteptat $ASTEPTAT); iesiri $RC_T/$RC_M"

if [ "$ESEC" = 0 ]; then echo "Toate scenariile de concurenta 20261215c au trecut"; else echo "Cel putin un scenariu de concurenta a picat"; fi
exit "$ESEC"
