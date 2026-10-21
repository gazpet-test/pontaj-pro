#!/usr/bin/env bash
# Rulează harness-ul E3 (scripts/test_izometrie_e3.sh) din WSL, pe o copie /tmp a worktree-ului în care stă acest fișier
# (fără CRLF), cu un cluster PG local propriu per „slot” — mai multe worktree-uri pot rula în paralel fără să se calce.
# Utilizare (din Windows):  wsl -d Ubuntu-24.04 -- bash -lc "bash /mnt/c/<worktree>/scripts/izometrie/e3_gen/harness_wsl.sh <slot 0-9>"
# Ieșirea completă: /tmp/izo_e3_harness_<slot>.log ; pe ecran: ultimele linii + codul (0 PASS · 1 eșec · 2 mediu).
set -uo pipefail
SLOT="${1:?slot 0-9}"; case "$SLOT" in [0-9]) ;; *) echo "slot invalid" >&2; exit 2 ;; esac
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DST="/tmp/izo_src_e3_$SLOT"; LOG="/tmp/izo_e3_harness_$SLOT.log"
rm -rf "$DST" && mkdir -p "$DST/supabase"
cp -r "$SRC/scripts" "$DST/" && cp -r "$SRC/supabase/migrations" "$SRC/supabase/revenire" "$SRC/supabase/tests" "$DST/supabase/"
find "$DST" -type f \( -name '*.sh' -o -name '*.sql' \) -exec sed -i 's/\r$//' {} +
cd "$DST"
IZO_E3_PORT=$((5990 + SLOT)) IZO_E3_DATE_DIR="/tmp/pg_izo_e3_slot$SLOT" bash scripts/test_izometrie_e3.sh > "$LOG" 2>&1
COD=$?
grep -E '^(OK|ESEC|MEDIU|PASS)|ERROR|EROARE' "$LOG" | tail -n "${2:-25}"
echo "harness slot $SLOT -> cod $COD (log complet: $LOG)"
exit $COD
