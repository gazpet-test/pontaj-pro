#!/usr/bin/env bash
# Rulare manuala: copie /tmp in afara NTFS, cluster efemer.
# Din Windows: wsl -d Ubuntu-24.04 -u root -- bash <worktree>/scripts/portal/harness_wsl.sh 0
set -Eeuo pipefail
SLOT="${1:?slot 0-9}"; [[ "$SLOT" =~ ^[0-9]$ ]] || exit 2
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# r13: inceputul rularii, in formatul syslog-ului (ora locala), pentru CEAS_WSL de la final.
T0="$(date '+%Y-%m-%dT%H:%M:%S')"
# Fara stergeri recursive si fara suprascrierea unui slot existent.
DST="$(mktemp -d "/tmp/portal_e1_${SLOT}_XXXXXXXX")"
mkdir -p "$DST/supabase"
cp -r "$SRC/scripts" "$DST/"
cp -r "$SRC/supabase/migrations" "$SRC/supabase/revenire" "$SRC/supabase/tests" "$DST/supabase/"
find "$DST" -type f \( -name '*.sh' -o -name '*.sql' -o -name '*.py' \) -exec sed -i 's/\r$//' {} +
if [[ "$(id -u)" == 0 ]]; then
  chown -R postgres "$DST"
  su postgres -s /bin/bash -c "cd '$DST' && PORTAL_PG_MAJOR=${PORTAL_PG_MAJOR:-17} PORTAL_E1_SLOT=$SLOT bash scripts/test_portal_e1.sh" >"$DST/harness.log" 2>&1 && RC=0 || RC=$?
else
  (cd "$DST" && PORTAL_PG_MAJOR="${PORTAL_PG_MAJOR:-17}" PORTAL_E1_SLOT="$SLOT" bash scripts/test_portal_e1.sh) >"$DST/harness.log" 2>&1 && RC=0 || RC=$?
fi
tail -n "${2:-35}" "$DST/harness.log"
# r13: potrivirile ceasului de perete facute de WSL in timpul rularii (dovada independenta pentru liniile CEAS_SALT).
if [[ -r /var/log/syslog ]]; then
  N_CEAS="$(awk -v t0="$T0" 'substr($1,1,19) >= t0 && /Clock change detected/' /var/log/syslog | wc -l)" || N_CEAS='?'
  echo "CEAS_WSL: $N_CEAS linii 'Clock change detected' in /var/log/syslog de la $T0 (WSL isi potriveste ceasul de perete in salturi)"
  awk -v t0="$T0" 'substr($1,1,19) >= t0 && /Clock change detected/ {print "CEAS_WSL   " $1}' /var/log/syslog | tail -n 20 || true
fi
echo "portal E1-1a+1b slot=$SLOT cod=$RC; copie/log: $DST"
exit "$RC"
