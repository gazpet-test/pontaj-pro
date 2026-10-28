#!/usr/bin/env bash
# Rulează harness-ul AVIZ din WSL pe o copie /tmp (fără CRLF; clusterul PG nu poate sta pe /mnt/c — NTFS fără chmod),
# ca utilizatorul postgres (harness-ul refuză root). Porturi 6600+slot. Model: scripts/izometrie/e4_gen/harness_e4b_wsl.sh.
# Utilizare (din Windows): wsl -d Ubuntu-24.04 -u root -- bash /mnt/c/<worktree>/scripts/izometrie/aviz/harness_wsl.sh <slot 0-9> [linii]
set -uo pipefail
SLOT="${1:?slot 0-9}"; [[ "$SLOT" =~ ^[0-9]$ ]] || exit 2
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DST="/tmp/izo_src_aviz_$SLOT"; LOG="/tmp/izo_aviz_harness_$SLOT.log"
rm -rf "$DST" && mkdir -p "$DST/supabase"
cp -r "$SRC/scripts" "$DST/" && cp -r "$SRC/supabase/migrations" "$SRC/supabase/revenire" "$SRC/supabase/tests" "$DST/supabase/"
find "$DST" -type f \( -name '*.sh' -o -name '*.sql' \) -exec sed -i 's/\r$//' {} +
rm -rf "$DST/.tmp"; rm -f "$LOG"
if [ "$(id -u)" = 0 ]; then chown -R postgres "$DST"
  su postgres -s /bin/bash -c "cd '$DST' && IZO_AVIZ_SLOT=$SLOT bash scripts/test_izometrie_aviz.sh > '$LOG' 2>&1"
else (cd "$DST" && IZO_AVIZ_SLOT="$SLOT" bash scripts/test_izometrie_aviz.sh) > "$LOG" 2>&1; fi
COD=$?
grep -E '^(OK|ESEC|MEDIU|PASS)|ERROR|EROARE' "$LOG" | tail -n "${2:-25}"
echo "harness AVIZ slot $SLOT -> cod $COD (log complet: $LOG)"
exit $COD
