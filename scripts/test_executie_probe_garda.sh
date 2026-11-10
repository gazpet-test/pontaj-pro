#!/usr/bin/env bash
# ============================================================================
# Garda de dependențe a migrării 20261202a (L15) — DOAR pe clona schemei de producție, NICIODATĂ pe producție.
# O funcție de drept folosită de migrare e MODIFICATĂ în tranzacție (aceeași semnătură, DEFINER, search_path, ACL; alt corp / alt ACL),
# apoi se rulează migrarea cu ON_ERROR_STOP=1: psql trebuie să se oprească la PRIMA eroare, în preflight, cu mesajul gărzii.
# Conexiunea se închide fără COMMIT (tranzacția se anulează): pe clonă nu rămâne nimic.
# Precondiție: 20261202a NEAPLICATĂ pe clonă (altfel preflight-ul refuză mai devreme, „reaplicare”: scriptul o spune, nu „OK”).
# Rulare: PSQL=<cale psql> bash scripts/test_executie_probe_garda.sh --sistem <system_identifier al CLONEI>
# Cod de ieșire: 0 = toate mutațiile refuzate de gardă; 1 = vreo mutație a trecut sau a picat din alt motiv; 3 = garda anti-producție.
# ============================================================================
set -u
PSQL="${PSQL:-psql}"
SISTEM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sistem) SISTEM="${2:-}"; shift 2 ;;
    *) echo "argument necunoscut: $1" >&2; exit 3 ;;
  esac
done
[ -n "$SISTEM" ] || { echo "lipsește --sistem <system_identifier al clonei>" >&2; exit 3; }
ACTUAL=$("$PSQL" -X -A -t -q -c "SELECT system_identifier FROM pg_control_system()") || { echo "nu pot citi system_identifier" >&2; exit 3; }
[ "$ACTUAL" = "$SISTEM" ] || { echo "REFUZ: baza are system_identifier $ACTUAL, nu $SISTEM (nu e clona dată)" >&2; exit 3; }

RAD="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"
DIR=$(mktemp -d); trap 'rm -rf "$DIR"' EXIT
FAIL=0
# mutație: SQL-ul care strică dependența, în aceeași tranzacție cu migrarea
ruleaza() { # nume, sql-mutație
  cat > "$DIR/m.sql" <<EOF
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT to_regprocedure('public.fn_executie_nod_drept(bigint, boolean)') IS NULL AS lipseste_1201a \gset
\if :lipseste_1201a
SELECT set_config('gazpet.livrare_migrare', '20261201a_executie_noduri_suduri:' || txid_current(), true);
\i '$RAD/supabase/migrations/20261201a_executie_noduri_suduri.sql'
\endif
$2
SELECT set_config('gazpet.livrare_migrare', '20261202a_executie_probe_tronsoane:' || txid_current(), true);
\i '$RAD/supabase/migrations/20261202a_executie_probe_tronsoane.sql'
SELECT 'MIGRAREA A TRECUT DE GARDA' AS rezultat;
ROLLBACK;
EOF
  "$PSQL" -X -q -f "$DIR/m.sql" > "$DIR/o.txt" 2>&1; local cod=$?
  local prima; prima=$(grep -m1 "ERROR" "$DIR/o.txt")
  if [ $cod -eq 3 ] && echo "$prima" | grep -q "amprenta revizuita"; then echo "OK   $1: refuzat de gardă ($prima)"
  elif echo "$prima" | grep -q "reaplicare"; then echo "FAIL $1: 20261202a pare deja aplicată pe clonă — garda nu s-a putut proba ($prima)"; FAIL=1
  else echo "FAIL $1: cod $cod, prima eroare: ${prima:-niciuna}"; FAIL=1; fi
}
ruleaza "fn_executie_nod_drept cu corp „mereu true”" "CREATE OR REPLACE FUNCTION public.fn_executie_nod_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ SELECT true \$f\$;"
ruleaza "probe_teren_drept cu corp „mereu true”" "CREATE OR REPLACE FUNCTION public.probe_teren_drept(p_scriere boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS \$f\$ SELECT true \$f\$;"
ruleaza "fn_executie_nod_drept fără SECURITY DEFINER" "ALTER FUNCTION public.fn_executie_nod_drept(bigint, boolean) SECURITY INVOKER;"
ruleaza "probe_teren_drept cu EXECUTE pentru anon" "GRANT EXECUTE ON FUNCTION public.probe_teren_drept(boolean) TO anon;"
[ $FAIL = 0 ] && echo "TOATE OK" || exit 1
