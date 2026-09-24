#!/usr/bin/env bash
# Rulează migrarea + testele pe un Postgres LOCAL (bază proaspătă `z1_subiect_test`), niciodată pe producție.
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL="${PSQL:-su postgres -c}"
$PSQL "dropdb --if-exists z1_subiect_test" >/dev/null
$PSQL "createdb z1_subiect_test"
$PSQL "psql -v ON_ERROR_STOP=1 -q -d z1_subiect_test -f $PWD/test-fixtures/cerinte_subiect/stub_schema.sql"
$PSQL "psql -v ON_ERROR_STOP=1 -q -d z1_subiect_test -f $PWD/supabase/migrations/20260924_z1_cerinte_subiect.sql"
$PSQL "psql -v ON_ERROR_STOP=1 -q -d z1_subiect_test -f $PWD/supabase/migrations/20260924_z1_cerinte_subiect.sql"   # idempotență
$PSQL "psql -d z1_subiect_test -f $PWD/test-fixtures/cerinte_subiect/test_local.sql" | grep -E 'PASS|FAIL|TOTAL|ERROR'
