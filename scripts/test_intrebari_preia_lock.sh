#!/usr/bin/env bash
# ============================================================================
# Concurență în DOUĂ sesiuni reale pentru 20261131e (runda 3, review #1012 r2 P2-5): expirarea din fn_intrebari_preia contra unui
# răspuns întârziat (fn_intrebari_raspunde: întrebarea → jurnalul). DOAR pe CLONĂ, cu 20261131e APLICATĂ. NICIODATĂ pe producție.
# Harness-ul pe o sesiune: supabase/tests/20261131e_intrebari_cercetare_surse_dryrun.sql (T3 = ordinea din corp + efectul expirării).
#
# Rulare (conexiunea din mediul psql obișnuit: PGHOST / PGPORT / PGUSER / PGDATABASE + pgpass; nicio parolă aici):
#   PSQL=<cale psql> bash scripts/test_intrebari_preia_lock.sh --sistem <system_identifier al CLONEI> [--mutant-r2]
# Scriptul refuză dacă system_identifier-ul bazei nu e cel dat (garda anti-producție).
#
# Coregrafia (pașii lui fn_intrebari_raspunde, despărțiți ca să se poată intercala):
#   A: BEGIN; UPDATE intrebari_tehnice (rândul întrebării expirate) → pg_sleep(4) → UPDATE intrebari_preluari (rândul ei) → ROLLBACK
#   B (pornește la ~1 s după A): BEGIN; SELECT fn_intrebari_preia(); ROLLBACK
#   Se verifică în pg_stat_activity că B AȘTEAPTĂ un lock cu blocantul A (altfel intercalarea nu s-a obținut = NEEXECUTAT).
#   Așteptat (r3): A își termină pasul 2, B continuă după A; ambele ies cu 0, niciuna cu 40P01 (deadlock).
#   --mutant-r2: B rulează ordinea din r2 (jurnalul ÎNAINTEA întrebării), dintr-o funcție pg_temp → așteptat 40P01 la una dintre ele
#   (dovada că testul prinde regresia).
# Date FICTIVE: o întrebare „TEST-LOCK 20261131e” a ownerului (autorul din JWT, ca în UI) + rândul ei de jurnal. La final — și la orice
# întrerupere — sesiunile se opresc, backend-urile lor se închid, rândurile se șterg și se VERIFICĂ: o curățare eșuată = FAIL.
# Cod de ieșire: 0 = OK; 1 = FAIL (inclusiv curățarea); 2 = NEEXECUTAT (intercalarea neobținută); 3 = garda / pregătirea a refuzat.
# ============================================================================
set -u
PSQL="${PSQL:-psql}"
SISTEM=""
MUTANT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --sistem) SISTEM="${2:-}"; shift 2 ;;
    --mutant-r2) MUTANT=1; shift ;;
    *) echo "argument necunoscut: $1" >&2; exit 3 ;;
  esac
done
[ -n "$SISTEM" ] || { echo "lipsește --sistem <system_identifier al clonei>" >&2; exit 3; }
q() { "$PSQL" -X -A -t -q -v ON_ERROR_STOP=1 -c "$1"; }

ACTUAL=$(q "SELECT system_identifier FROM pg_control_system()") || { echo "nu pot citi system_identifier" >&2; exit 3; }
[ "$ACTUAL" = "$SISTEM" ] || { echo "REFUZ: baza are system_identifier $ACTUAL, nu $SISTEM (nu e clona dată)" >&2; exit 3; }
[ "$(q "SELECT to_regclass('public.intrebari_preluari') IS NOT NULL AND to_regprocedure('public.fn_intrebari_preia()') IS NOT NULL")" = "t" ] \
  || { echo "REFUZ: 20261131e nu e aplicată pe clonă" >&2; exit 3; }
[ "$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'intrebari\_lock\_%'")" = "0" ] \
  || { echo "REFUZ: există deja sesiuni intrebari_lock_* (altă rulare în curs?)" >&2; exit 3; }
[ "$(q "SELECT count(*) FROM public.intrebari_tehnice WHERE titlu = 'TEST-LOCK 20261131e'")" = "0" ] \
  || { echo "REFUZ: există deja o întrebare TEST-LOCK 20261131e (rulare veche necurățată?)" >&2; exit 3; }
OWNER=$(q "SELECT id FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1")
[ -n "$OWNER" ] || { echo "REFUZ: lipsește ownerul" >&2; exit 3; }

TMP=$(mktemp -d)
QID=""; PA=""; PB=""; REZ=0
curata() {
  for p in $PA $PB; do kill "$p" 2>/dev/null; done
  wait 2>/dev/null
  q "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE application_name LIKE 'intrebari\_lock\_%'" >/dev/null
  if [ -n "$QID" ]; then
    q "DELETE FROM public.notifications WHERE link_to = '/intrebari?id=$QID'" >/dev/null
    q "DELETE FROM public.intrebari_preluari WHERE intrebare_id = $QID" >/dev/null
    q "DELETE FROM public.intrebari_tehnice WHERE id = $QID" >/dev/null
    if [ "$(q "SELECT (SELECT count(*) FROM public.intrebari_tehnice WHERE id = $QID) + (SELECT count(*) FROM public.intrebari_preluari WHERE intrebare_id = $QID)")" != "0" ]; then
      echo "FAIL: curățarea datelor fictive (întrebarea $QID)"; REZ=1
    fi
  fi
  rm -rf "$TMP"
}
trap 'curata; exit 1' INT TERM

# pregătirea: întrebarea fictivă (autorul = ownerul, din JWT), apoi „în lucru” de 31 de minute + rândul ei de jurnal
QID=$("$PSQL" -X -A -t -q -v ON_ERROR_STOP=1 -v owner="$OWNER" <<'SQL' | tail -n 1
BEGIN;
SELECT set_config('request.jwt.claim.sub', :'owner', true) IS NULL,
       set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true) IS NULL;
INSERT INTO public.intrebari_tehnice (titlu, intrebare) VALUES ('TEST-LOCK 20261131e', 'Întrebare fictivă pentru testul de concurență') RETURNING id;
COMMIT;
SQL
)
case "$QID" in ''|*[!0-9]*) echo "REFUZ: pregătirea întrebării fictive a eșuat ($QID)" >&2; QID=""; curata; exit 3 ;; esac
INC=$(q "SELECT gen_random_uuid()")
q "UPDATE public.intrebari_tehnice SET stare = 'in_lucru', preluat_la = now() - interval '31 minutes', incercari = 1, incercare_id = '$INC' WHERE id = $QID" \
  && q "INSERT INTO public.intrebari_preluari (intrebare_id, incercare_id, preluat_la) VALUES ($QID, '$INC', now() - interval '31 minutes')" \
  || { echo "REFUZ: pregătirea preluării fictive a eșuat" >&2; curata; exit 3; }

# sesiunea A: pașii răspunsului întârziat, cu o pauză între întrebare și jurnal
PGAPPNAME=intrebari_lock_A "$PSQL" -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >"$TMP/a.out" 2>&1 <<SQL &
BEGIN;
UPDATE public.intrebari_tehnice SET eroare = eroare WHERE id = $QID;
SELECT pg_sleep(4);
UPDATE public.intrebari_preluari SET inchis_la = inchis_la WHERE incercare_id = '$INC';
ROLLBACK;
SQL
PA=$!
sleep 1

# sesiunea B: preluarea (care expiră întrebarea) — r3 sau mutantul r2
if [ "$MUTANT" = "1" ]; then
  APEL="SELECT pg_temp.preia_r2();"
  DEF="CREATE FUNCTION pg_temp.preia_r2() RETURNS jsonb LANGUAGE plpgsql AS \$f\$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('intrebari_tehnice:preia'));
  UPDATE public.intrebari_preluari p SET inchis_la = now(), rezultat = 'expirat' FROM public.intrebari_tehnice t
   WHERE t.stare = 'in_lucru' AND t.preluat_la < now() - interval '30 minutes' AND p.incercare_id = t.incercare_id AND p.inchis_la IS NULL;
  UPDATE public.intrebari_tehnice SET stare = 'eroare', incercare_id = NULL WHERE stare = 'in_lucru' AND preluat_la < now() - interval '30 minutes';
  RETURN NULL;
END \$f\$;"
else
  APEL="SELECT public.fn_intrebari_preia() IS NOT NULL AS preluat;"
  DEF=""
fi
PGAPPNAME=intrebari_lock_B "$PSQL" -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >"$TMP/b.out" 2>&1 <<SQL &
$DEF
BEGIN;
$APEL
ROLLBACK;
SQL
PB=$!
sleep 1.5

ASTEAPTA=$(q "SELECT count(*) FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name = 'intrebari_lock_A'
               WHERE b.application_name = 'intrebari_lock_B' AND b.wait_event_type = 'Lock' AND a.pid = ANY (pg_blocking_pids(b.pid))")
wait "$PA"; EA=$?
wait "$PB"; EB=$?
PA=""; PB=""
DEADLOCK=0
grep -q '40P01' "$TMP/a.out" "$TMP/b.out" && DEADLOCK=1

if [ "$ASTEAPTA" != "1" ]; then
  echo "NEEXECUTAT: B nu aștepta după A (intercalarea nu s-a obținut)"; [ "$REZ" = "0" ] && REZ=2
elif [ "$MUTANT" = "1" ]; then
  if [ "$DEADLOCK" = "1" ]; then echo "OK (mutant r2): ordinea jurnal → întrebare produce deadlock (40P01) — testul prinde regresia"
  else echo "FAIL (mutant r2): nu s-a produs 40P01 — testul NU distinge ordinea greșită"; REZ=1; fi
else
  if [ "$EA" = "0" ] && [ "$EB" = "0" ] && [ "$DEADLOCK" = "0" ]; then echo "OK: B a așteptat după A, fără deadlock; ambele sesiuni au ieșit cu 0"
  else echo "FAIL: A=$EA B=$EB deadlock=$DEADLOCK"; sed 's/^/  A| /' "$TMP/a.out"; sed 's/^/  B| /' "$TMP/b.out"; REZ=1; fi
fi
curata
exit "$REZ"
