#!/usr/bin/env bash
# Harness E3b în WSL, slot 0-9; cluster separat pe 6000+slot.
# Utilizare: bash scripts/izometrie/e3b_gen/harness_wsl.sh <slot> [ultimele-linii]
set -uo pipefail
SLOT="${1:?slot 0-9}"; case "$SLOT" in [0-9]) ;; *) echo "slot invalid" >&2; exit 2 ;; esac
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DST="/tmp/izo_src_e3b_$SLOT"; LOG="/tmp/izo_e3b_harness_$SLOT.log"
rm -rf "$DST" && mkdir -p "$DST/supabase"
cp -r "$SRC/scripts" "$DST/" && cp -r "$SRC/supabase/migrations" "$SRC/supabase/revenire" "$SRC/supabase/tests" "$DST/supabase/"
find "$DST" -type f \( -name '*.sh' -o -name '*.sql' \) -exec sed -i 's/\r$//' {} +
cd "$DST"
IZO_E3B_PORT=$((6000 + SLOT)) IZO_E3B_DATE_DIR="/tmp/pg_izo_e3b_slot$SLOT" bash scripts/test_izometrie_e3b.sh > "$LOG" 2>&1
COD=$?
grep -E '^(OK|ESEC|MEDIU|PASS)|ERROR|EROARE' "$LOG" | tail -n "${2:-25}"
echo "harness slot $SLOT -> cod $COD (log complet: $LOG)"
exit "$COD"
