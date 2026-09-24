#!/usr/bin/env bash
# Rulează migrarea + testele pe un Postgres LOCAL (bază proaspătă `p0c_dovezi_test`), niciodată pe producție.
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL="${PSQL:-su postgres -c}"
$PSQL "dropdb --if-exists p0c_dovezi_test" >/dev/null
$PSQL "createdb p0c_dovezi_test"
$PSQL "psql -v ON_ERROR_STOP=1 -q -d p0c_dovezi_test -f $PWD/test-fixtures/cerinte_dovezi/stub_schema.sql"
$PSQL "psql -v ON_ERROR_STOP=1 -q -d p0c_dovezi_test -f $PWD/supabase/migrations/20260924_p0c_cerinte_dovezi.sql"
$PSQL "psql -d p0c_dovezi_test -f $PWD/test-fixtures/cerinte_dovezi/test_local.sql" | grep -E 'PASS|FAIL|TOTAL'
