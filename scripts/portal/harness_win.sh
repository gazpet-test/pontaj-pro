#!/usr/bin/env bash
# r11: rulare din Git Bash pe Windows cu binarele native PostgreSQL 17 (fara WSL, fara instalare, fara su / chown).
#   bash scripts/portal/harness_win.sh <slot 0-9> [linii de afisat] [dosarul cu binare]
# Binarele: al treilea argument, altfel PORTAL_PG_BIN, altfel /c/Users/Public/pgsql/bin (initdb, pg_ctl, postgres, psql,
# pg_dump, pg_isready). Copie LF NOUA in /c/Users/Public/paw-data/tmp_portal_<slot>_XXXXXXXX (PORTAL_TMP_BAZA o poate
# schimba): nimic suprascris, nimic sters. Cluster efemer in copie, doar 127.0.0.1, port 6700 + slot (verificat liber),
# fara socket unix; NU atinge clona / baza chat-ului (5433) si nicio baza reala. Jurnalul complet ramane in copie.
set -Eeuo pipefail
SLOT="${1:?slot 0-9}"; [[ "$SLOT" =~ ^[0-9]$ ]] || exit 2
BIN="${3:-${PORTAL_PG_BIN:-/c/Users/Public/pgsql/bin}}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BAZA="${PORTAL_TMP_BAZA:-/c/Users/Public/paw-data}"
[[ -d "$BAZA" ]] || { echo "MEDIU: $BAZA lipsa"; exit 2; }
DST="$(mktemp -d "$BAZA/tmp_portal_${SLOT}_XXXXXXXX")"
mkdir -p "$DST/supabase"
cp -r "$SRC/scripts" "$DST/"
cp -r "$SRC/supabase/migrations" "$SRC/supabase/revenire" "$SRC/supabase/tests" "$DST/supabase/"
# Checkout-ul Windows are CRLF (core.autocrlf): copia e LF, ca in git si ca in WSL.
find "$DST" -type f \( -name '*.sh' -o -name '*.sql' -o -name '*.py' \) -exec sed -i 's/\r$//' {} +
(cd "$DST" && PORTAL_PG_BIN="$BIN" PORTAL_PG_MAJOR=17 PORTAL_E1_SLOT="$SLOT" bash scripts/test_portal_e1.sh) >"$DST/harness.log" 2>&1 && RC=0 || RC=$?
tail -n "${2:-45}" "$DST/harness.log"
echo "portal E1-1a+1b (Windows, binare native) slot=$SLOT cod=$RC; copie/log: $DST"
exit "$RC"
