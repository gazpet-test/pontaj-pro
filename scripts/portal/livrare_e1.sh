#!/usr/bin/env bash
# ============================================================================
# Portal E1 r22 (Jakarinos r21 P2): PASUL DE PRE-LIVRARE pentru 18a / 19a (si revenirile lor). Pentru coordonator.
# Livrarea 18a / 19a se porneste DOAR prin acest script, nu direct prin runner:
#   1. argumentele runnerului se citesc (fara sa fie schimbate): --migrare trebuie sa fie una dintre migrarile / revenirile
#      portalului E1; --tinta-host si --user sunt obligatorii;
#   2. scripts/portal/scheme_expuse.sh pe API-ul proiectului tintei (--api-url, legat de --user / --tinta-host; cheia publica
#      in SUPABASE_ANON_KEY, niciodata tiparita): 0 = net nu e expusa => continua; 1 (net expusa) / 2 (necunoscut) /
#      3 (API nelegat de tinta / parametri) = REFUZ 23, runnerul NU porneste, nicio conexiune la baza;
#   3. exec scripts/livrare_migrare.sh cu EXACT argumentele primite (runnerul oficial, neschimbat: aceleasi garzi, acelasi
#      plafon, aceleasi coduri de iesire).
# Utilizare:
#   SUPABASE_ANON_KEY=<cheia publica> PSQL_BIN=<psql> bash scripts/portal/livrare_e1.sh --api-url https://<ref>.supabase.co \
#     -- --migrare supabase/migrations/20261118a_portal_teren_identitate.sql --sha256 <hex64> --versiune <...> \
#        --tinta-db postgres --tinta-sistem <...> --tinta-host <...> --tinta-port <...> --user <...> --plafon-tranzactie-ms 2000
# Cod: 23 = refuzul API (nimic trimis); 2 = argumente; altfel codul runnerului (vezi scripts/livrare_migrare.sh).
# Ce NU acopera: runnerul pornit direct (fara acest pas) si o expunere a lui net facuta DUPA livrare din panoul proiectului
# (vezi E1_RAPORT.md r22: verificarea periodica propusa pentru rutina zilnica).
# ============================================================================
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
refuz() { echo "REFUZ (nimic trimis): $2" >&2; exit "$1"; }
API_URL=""
while [ $# -gt 0 ] && [ "$1" != -- ]; do
  case "$1" in
    --api-url) [ $# -ge 2 ] || refuz 2 "--api-url fara valoare"; API_URL="$2"; shift 2 ;;
    *) refuz 2 "optiune nepermisa inainte de --: $1 (doar --api-url)" ;;
  esac
done
[ "${1:-}" = -- ] || refuz 2 "lipseste -- inaintea argumentelor runnerului"
shift
[ -n "$API_URL" ] || refuz 2 "--api-url obligatoriu"
[ -n "${SUPABASE_ANON_KEY:-}" ] || refuz 2 "SUPABASE_ANON_KEY lipsa din mediu"
MIG="" H="" U="" args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  case "${args[$i]}" in
    --migrare) MIG="${args[$((i + 1))]:-}" ;;
    --tinta-host) H="${args[$((i + 1))]:-}" ;;
    --user) U="${args[$((i + 1))]:-}" ;;
  esac
  i=$((i + 1))
done
case "$(basename -- "$MIG")" in
  20261118a_portal_teren_identitate.sql|20261119a_portal_teren_provisioning.sql|\
  20261118a_portal_teren_identitate_ROLLBACK.sql|20261119a_portal_teren_provisioning_ROLLBACK.sql) ;;
  *) refuz 2 "--migrare nu e o migrare / revenire a portalului E1 (18a / 19a): $(basename -- "$MIG")" ;;
esac
[ -n "$H" ] && [ -n "$U" ] || refuz 2 "--tinta-host si --user sunt obligatorii (legarea API-ului de tinta)"
API_RC=0; API_OUT="$(mktemp)"
SUPABASE_URL="$API_URL" bash "$ROOT/scripts/portal/scheme_expuse.sh" --tinta-host "$H" --user "$U" >"$API_OUT" 2>&1 || API_RC=$?
sed 's/^/API: /' "$API_OUT"; rm -f -- "$API_OUT"
[ "$API_RC" = 0 ] || refuz 23 "verificarea schemelor expuse prin API: cod $API_RC (1 = net expusa, 2 = necunoscut, 3 = API nelegat de tinta / parametri) — runnerul NU porneste"
echo "✓ API: net nu e expusa; pornesc runnerul oficial ($(basename -- "$MIG"))"
exec bash "$ROOT/scripts/livrare_migrare.sh" "$@"
