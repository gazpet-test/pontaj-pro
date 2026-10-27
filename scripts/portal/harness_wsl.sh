#!/usr/bin/env bash
# Rulare manuala: copie /tmp in afara NTFS, cluster efemer.
# Din Windows: wsl -d Ubuntu-24.04 -u root -- bash <worktree>/scripts/portal/harness_wsl.sh 0
set -Eeuo pipefail
SLOT="${1:?slot 0-9}"; [[ "$SLOT" =~ ^[0-9]$ ]] || exit 2
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Fara stergeri recursive si fara suprascrierea unui slot existent.
DST="$(mktemp -d "/tmp/portal_e1_${SLOT}_XXXXXXXX")"
mkdir -p "$DST/supabase"
cp -r "$SRC/scripts" "$DST/"
cp -r "$SRC/supabase/migrations" "$SRC/supabase/revenire" "$SRC/supabase/tests" "$DST/supabase/"
find "$DST" -type f \( -name '*.sh' -o -name '*.sql' -o -name '*.py' \) -exec sed -i 's/\r$//' {} +
if [[ "$(id -u)" == 0 ]]; then
  chown -R postgres "$DST"
  su postgres -s /bin/bash -c "cd '$DST' && PORTAL_E1_SLOT=$SLOT bash scripts/test_portal_e1.sh" >"$DST/harness.log" 2>&1 && RC=0 || RC=$?
else
  (cd "$DST" && PORTAL_E1_SLOT="$SLOT" bash scripts/test_portal_e1.sh) >"$DST/harness.log" 2>&1 && RC=0 || RC=$?
fi
tail -n "${2:-35}" "$DST/harness.log"
echo "portal E1-1a slot=$SLOT cod=$RC; copie/log: $DST"
exit "$RC"
