#!/usr/bin/env bash
# r11: rulare din Git Bash pe Windows cu binarele native PostgreSQL 17 (fara WSL, fara instalare, fara su / chown).
#   PORTAL_PG_BIN=<dosarul cu binare> PORTAL_TMP_BAZA=<dosar de lucru> bash scripts/portal/harness_win.sh <slot 0-9> [linii]
# PORTAL_PG_BIN: initdb, pg_ctl, postgres, psql, pg_dump, pg_isready (PostgreSQL 17). PORTAL_TMP_BAZA: dosar existent in
# care se face o copie LF NOUA, <baza>/tmp_portal_<slot>_XXXXXXXX: nimic suprascris, nimic sters. Cluster efemer in copie,
# doar 127.0.0.1, port 6700 + slot (verificat liber), fara socket unix; nu atinge nicio alta baza. Jurnalul complet ramane
# in copie. Ambele cai sunt obligatorii (fara valori implicite).
set -Eeuo pipefail
SLOT="${1:?slot 0-9}"; [[ "$SLOT" =~ ^[0-9]$ ]] || exit 2
BIN="${PORTAL_PG_BIN:?PORTAL_PG_BIN = dosarul cu binarele PostgreSQL 17}"
BAZA="${PORTAL_TMP_BAZA:?PORTAL_TMP_BAZA = dosarul de lucru pentru copie}"
! command -v cygpath >/dev/null 2>&1 || BAZA="$(cygpath -u "$BAZA")"
[[ -d "$BAZA" ]] || { echo "MEDIU: $BAZA lipsa"; exit 2; }
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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
