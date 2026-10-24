#!/usr/bin/env bash
# Reuse E4b provisioning, runner and fixtures verbatim through its pre-rollback seam.
# No PG connections outside the fresh local cluster. All files remain in worktree.
set -Eeuo pipefail
export IZO_E4C_RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "${IZO_E4B_PROD_LIKE:-1}" == 1 ]] || { echo 'MEDIU: E4c necesita PRODLIKE=1'; exit 2; }
export IZO_E4B_PROD_LIKE=1
[[ "$(grep -c '^# A rollback with even a rate-counter row' "$IZO_E4C_RADACINA/scripts/test_izometrie_e4b.sh")" == 1 ]] || { echo 'ESEC: E4b seam schimbat'; exit 2; }
source <(sed -e 's/\r$//' -e '/^# A rollback with even a rate-counter row/,$d' \
 -e '/^RADACINA=/c\RADACINA="$IZO_E4C_RADACINA"' "$IZO_E4C_RADACINA/scripts/test_izometrie_e4b.sh")
# The inherited EXIT trap stops this same cluster. postgres stays NOSUPERUSER.
[[ "$(q 'SELECT rolsuper FROM pg_roles WHERE rolname=current_user')" == f ]] || esec superuser
# pg_cron is intentionally a local stub: production SQL always calls real cron.
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e4c_gps_cron_schelet.sql"
gps_baseline() { q "SELECT jsonb_build_array(
 public.fn_izo_porti_definitii(),public.fn_izo_porti_e3_definitii(),public.fn_izo_porti_e3b_definitii(),
 public.fn_izo_porti_e4_definitii(),public.fn_izo_porti_e4b_definitii(),
 obj_description('public.fn_izo_porti_definitii()'::regprocedure,'pg_proc'),
 obj_description('public.fn_izo_porti_e3_definitii()'::regprocedure,'pg_proc'),
 obj_description('public.fn_izo_porti_e3b_definitii()'::regprocedure,'pg_proc'),
 obj_description('public.fn_izo_porti_e4_definitii()'::regprocedure,'pg_proc'),
 obj_description('public.fn_izo_porti_e4b_definitii()'::regprocedure,'pg_proc'),
 obj_description('public.magazie_bucati_evenimente'::regclass,'pg_class'),
 (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_teren_imuabil()'::regprocedure))"; }
GPS_INAINTE="$(gps_baseline)"
livreaza 20261111120000 "$M/20261111a_izometrie_gps_curatare.sql"
[[ "$(q 'SELECT public.fn_izo_porti_lipsa()')" == '{}' ]] || esec 'E4c apply gate'
teste_sql "$RADACINA/supabase/tests/izometrie_e4c_gps.test.sql" >"$TMP/gps_tests.log"
grep -q E4C_GPS_TEST_END "$TMP/gps_tests.log" || esec 'E4c end marker'
[[ -z "$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql")" ]] || esec 'E4c control_0e'
# Delivery runner has no rollback flag: arm rollback inside a harness-only artifact.
REVENIRE="$TMP/20261111a_izometrie_gps_test_revenire.sql"
cat >"$REVENIRE" <<'SQL'
DO $arm$
BEGIN
 IF current_user<>'postgres' OR current_setting('gazpet.livrare_migrare',true)
  IS DISTINCT FROM '20261111a_izometrie_gps_test_revenire:'||txid_current() THEN RAISE EXCEPTION 'test rollback runner'; END IF;
 PERFORM set_config('gazpet.revenire_20261111a','IZO_E4C_GPS_SCOATE:'||txid_current(),true);
END $arm$;
SQL
cat "$V/20261111a_izometrie_gps_curatare_ROLLBACK.sql" >>"$REVENIRE"
livreaza 20261111120001 "$REVENIRE"
[[ "$(gps_baseline)" == "$GPS_INAINTE" ]] || esec 'E4c rollback fingerprint/stamps/body inexact'
[[ "$(q 'SELECT public.fn_izo_porti_lipsa()')" == '{}' ]] || esec 'E4c rollback gate'
[[ "$(q "SELECT count(*) FROM cron.job WHERE jobname='izo_gps_curatare_zilnic'")" == 0 ]] || esec 'E4c cron ramas'
[[ "$(q "SELECT to_regclass('public.izo_gps_stergeri') IS NULL AND to_regprocedure('public.fn_izo_gps_curata(integer)') IS NULL")" == t ]] || esec 'E4c obiecte ramase'
[[ -z "$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql")" ]] || esec 'E4c rollback control_0e'
echo 'PASS E4c GPS: retention/privacy/batch/idempotency/journal/rollback exact; PRODLIKE=1 postgres NOSUPERUSER'
