#!/usr/bin/env bash
# L15 v2: linia de comanda peste scripts/livrare_amprenta.sh (aceleasi functii ca runnerul; pentru teste si pentru review-ul
# textului). Nu se conecteaza nicaieri; scrie SQL pe stdout.
#   bash scripts/livrare_amprenta_gen.sh inainte <T 16 hex> <md5_aprobat|->
#   bash scripts/livrare_amprenta_gen.sh dupa <T 16 hex> <md5_aprobat|-> <manifest|->
#   bash scripts/livrare_amprenta_gen.sh bloc 'AG_CATALOG v2' | bloc 'AG_SESIUNE v2'
#   bash scripts/livrare_amprenta_gen.sh global <relatie> | familii <relatie> | guc_local
#   bash scripts/livrare_amprenta_gen.sh manifest_valid <fisier>
set -Eeuo pipefail
# shellcheck source=livrare_amprenta.sh
. "$(dirname "${BASH_SOURCE[0]}")/livrare_amprenta.sh"
op="${1:-}"; shift || true
case "$op" in
  inainte) [ $# = 2 ] || exit 2; ag_inainte "$1" "$2" ;;
  dupa) [ $# = 3 ] || exit 2; ag_dupa "$1" "$2" "$3" ;;
  bloc) [ $# = 1 ] || exit 2; ag_bloc "$1" ;;
  global) [ $# = 1 ] || exit 2; ag_sql_global "$1"; echo ;;
  familii) [ $# = 1 ] || exit 2; ag_sql_familii "$1"; echo ;;
  guc_local) ag_guc_local ;;
  manifest_valid) [ $# = 1 ] || exit 2; ag_manifest_valid "$1" ;;
  *) echo "utilizare: inainte | dupa | bloc | global | familii | guc_local | manifest_valid" >&2; exit 2 ;;
esac
