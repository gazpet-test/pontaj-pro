#!/usr/bin/env bash
# Rulează harness-ul E4b din WSL pe o copie /tmp (fără CRLF; clusterul PG nu poate sta pe /mnt/c — NTFS fără chmod),
# ca utilizatorul postgres (harness-ul refuză root). Porturi 6500+slot.
# Utilizare (din Windows): wsl -d Ubuntu-24.04 -- bash -lc "bash /mnt/c/<worktree>/scripts/izometrie/e4_gen/harness_wsl.sh <slot 0-9> [linii]"
set -uo pipefail
SLOT="${1:?slot 0-9}"; [[ "$SLOT" =~ ^[0-9]$ ]] || exit 2
PROD_LIKE="${IZO_E4B_PROD_LIKE:-1}"
[[ "$PROD_LIKE" =~ ^[01]$ ]] || { echo 'MEDIU: IZO_E4B_PROD_LIKE trebuie 0 sau 1'; exit 2; }
# Default: non-superuser delivery/rollback. IZO_E4B_PROD_LIKE=0 keeps legacy mode.
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DST="/tmp/izo_src_e4b_$SLOT"; LOG="/tmp/izo_e4b_harness_$SLOT.log"
rm -rf "$DST" && mkdir -p "$DST/supabase"
cp -r "$SRC/scripts" "$DST/" && cp -r "$SRC/supabase/migrations" "$SRC/supabase/revenire" "$SRC/supabase/tests" "$DST/supabase/"
find "$DST" -type f \( -name '*.sh' -o -name '*.sql' \) -exec sed -i 's/\r$//' {} +
rm -rf "$DST/.tmp"
rm -f "$LOG"
# /tmp are sticky + protected_regular: log-ul îl scrie chiar postgres, nu root printr-o redirecționare
if [ "$(id -u)" = 0 ]; then chown -R postgres "$DST"
  su postgres -s /bin/bash -c "cd '$DST' && IZO_E4B_SLOT=$SLOT IZO_E4B_PROD_LIKE=$PROD_LIKE bash scripts/test_izometrie_e4b.sh > '$LOG' 2>&1"
else (cd "$DST" && IZO_E4B_SLOT="$SLOT" IZO_E4B_PROD_LIKE="$PROD_LIKE" bash scripts/test_izometrie_e4b.sh) > "$LOG" 2>&1; fi
COD=$?
grep -E '^(OK|ESEC|MEDIU|PASS)|ERROR|EROARE' "$LOG" | tail -n "${2:-25}"
echo "harness E4b slot $SLOT prodlike=$PROD_LIKE -> cod $COD (log complet: $LOG)"
exit $COD
