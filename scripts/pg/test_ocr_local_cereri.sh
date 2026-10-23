#!/usr/bin/env bash
# PG16/17 LOCAL, clonă de test cu E3 + 20261105a deja aplicate.
# PGURI=postgresql://postgres@127.0.0.1/e9_b1_test_<sufix> bash scripts/pg/test_ocr_local_cereri.sh
set -euo pipefail
exec node "$(dirname "$0")/test_ocr_local_cereri.mjs"
