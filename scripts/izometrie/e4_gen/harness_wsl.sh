#!/usr/bin/env bash
# No copies outside the worktree; 6400+slot, PG16 only.
set -Eeuo pipefail
SLOT="${1:?slot 0-9}"
[[ "$SLOT" =~ ^[0-9]$ ]] || exit 2
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
IZO_E4A_SLOT="$SLOT" bash scripts/test_izometrie_e4a.sh
