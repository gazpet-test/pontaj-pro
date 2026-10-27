#!/usr/bin/env bash
# Inclus exclusiv de harness-ul efemer. Doua sesiuni reale + FIFO + observarea blocarii in pg_stat_activity.
# A detine rezervarea pana cand B este efectiv blocat pe lock; apoi A confirma. Fara curse bazate pe sleep lung.
set -Eeuo pipefail
"${PSQL[@]}" --single-transaction -c "CREATE SCHEMA portal_race; CREATE TABLE portal_race.saved AS SELECT to_jsonb(p) AS saved_profile FROM public.profiles p WHERE id='00000000-0000-0000-0000-000000000001'; UPDATE public.profiles SET is_owner=true WHERE id='00000000-0000-0000-0000-000000000001'; INSERT INTO public.employees(id,name,active) VALUES (1901,'CONCURENT TEST',true)" >/dev/null
mkfifo "$TMP/race_release"
cat >"$TMP/race_a.sql" <<SQL
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.fn_portal_cont_pregateste(1901,'19000000-0000-0000-0000-000000000001');
\! touch "$TMP/race_ready"
\! cat "$TMP/race_release" > /dev/null
COMMIT;
SQL
"${PSQL[@]}" -f "$TMP/race_a.sql" >"$TMP/race_a.log" 2>&1 &
RACE_A=$!
RACE_READY=0
for ((i=0;i<200;i++)); do
 if [[ -e "$TMP/race_ready" ]]; then RACE_READY=1; break; fi
 kill -0 "$RACE_A" 2>/dev/null || break
 sleep 0.05
done
[[ "$RACE_READY" == 1 ]] || { cat "$TMP/race_a.log"; fail 'race A barrier'; }
cat >"$TMP/race_b.sql" <<SQL
BEGIN;
SET LOCAL application_name='portal_1b_race_b';
SET LOCAL lock_timeout='15s';
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.fn_portal_cont_pregateste(1901,'19000000-0000-0000-0000-000000000002');
COMMIT;
SQL
"${PSQL[@]}" -f "$TMP/race_b.sql" >"$TMP/race_b.log" 2>&1 &
RACE_B=$!
RACE_BLOCKED=0
for ((i=0;i<200;i++)); do
 if [[ "$(q "SELECT EXISTS (SELECT FROM pg_stat_activity WHERE application_name='portal_1b_race_b' AND wait_event_type='Lock')")" == t ]]; then
  RACE_BLOCKED=1; break
 fi
 kill -0 "$RACE_B" 2>/dev/null || break
 sleep 0.05
done
printf 'release\n' >"$TMP/race_release"
RACE_A_RC=0; wait "$RACE_A" || RACE_A_RC=$?
RACE_B_RC=0; wait "$RACE_B" || RACE_B_RC=$?
[[ "$RACE_BLOCKED" == 1 && "$RACE_A_RC" == 0 && "$RACE_B_RC" != 0 ]] || { cat "$TMP/race_a.log" "$TMP/race_b.log"; fail 'race did not serialize'; }
grep -q PORTAL_EMPLOYEE_UNAVAILABLE "$TMP/race_b.log" || { cat "$TMP/race_b.log"; fail 'wrong race refusal'; }
[[ "$(q 'SELECT count(*) FROM public.portal_provisioning WHERE employee_id=1901')" == 1 ]] || fail 'multiple reservations'
# NUMAI fixture-ul efemer: revenim inclusiv la jurnalul anterior, fara a sterge istoricul unui test real/prod.
# Curatare privilegiata, atomica, numai in clusterul efemer: fara granturi client sau schimbari de DDL persistente.
q "ALTER TABLE public.portal_provisioning_jurnal DISABLE TRIGGER portal_provisioning_jurnal_imuabil;
 DELETE FROM public.portal_provisioning WHERE employee_id=1901;
 DELETE FROM public.portal_provisioning_jurnal WHERE nou->>'employee_id'='1901' OR vechi->>'employee_id'='1901';
 ALTER TABLE public.portal_provisioning_jurnal ENABLE TRIGGER portal_provisioning_jurnal_imuabil;
 DELETE FROM public.employees WHERE id=1901;
 UPDATE public.profiles SET is_owner=(SELECT (saved_profile->>'is_owner')::boolean FROM portal_race.saved) WHERE id='00000000-0000-0000-0000-000000000001';
 DROP SCHEMA portal_race CASCADE" >/dev/null
