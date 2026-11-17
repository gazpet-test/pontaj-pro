#!/usr/bin/env bash
# Runda 17 (verdictul Jakarinos pe PR #1115): TOATE regresiile LOCALE ale livrarii L15 v2 / plafonului (fara PostgreSQL), cu O SINGURA
# comanda, pentru coordonator (sesiunea de cod nu poate rula bash):
#   bash scripts/test_livrare_l15_local_toate.sh [<ref pentru paritate, implicit origin/main>]
# Cere: python3, node (cu node_modules: @electric-sql/pglite), git, tar. Ruleaza in ordine, pastreaza codul FIECARUI pas (nu se opreste la
# primul esec) si cere si ultima linie asteptata (un cod 0 fara linia de PASS = ESEC). Rezultatul asteptat pe head-ul rundei 17:
#   PASS validator_plafon: PASS test_livrare_validator_plafon: 30 artefacte + argumente
#   PASS l15_forma: PASS test_livrare_l15_forma
#   PASS l15_paritate: PASS test_livrare_l15_paritate
#   PASS forma_fin: PASS test_livrare_forma_fin: …
#   PASS pglite_uscare: TOTUL OK
#   PASS pglite_meteo: TOTUL OK
#   PASS test_livrare_l15_local_toate (6/6)      => cod 0; altfel ESEC cu ultimele 20 de linii ale pasului si cod 1.
# Probele pe PostgreSQL 17 real (test_livrare_l15_v2.sh <slot>, test_livrare_plafon.sh <slot>, test_portal_e1.sh) si cele pe clona
# (supabase/tests/l15_aplicare_concurenta.sh, 20261225a_executie_uscare_doua_sesiuni.sh) NU sunt aici: cer un cluster / clona.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
REF="${1:-origin/main}"
J="$(mktemp -d)"; trap 'rm -rf "$J"' EXIT
N=0 OK=0
pas() { # $1 eticheta, $2 fragmentul cerut in ultima linie nevida, restul = comanda
  local et="$1" cerut="$2" rc=0 u
  shift 2
  N=$((N + 1))
  "$@" >"$J/$et.log" 2>&1 || rc=$?
  u="$(grep -v '^[[:space:]]*$' "$J/$et.log" | tail -n 1 | cut -c1-200)"
  if [ "$rc" = 0 ] && case "$u" in *"$cerut"*) true ;; *) false ;; esac; then
    OK=$((OK + 1)); echo "PASS $et: $u"
  else
    echo "ESEC $et (cod $rc): $u"; tail -n 20 "$J/$et.log" | sed 's/^/    /'
  fi
}
pas validator_plafon 'PASS test_livrare_validator_plafon' python3 scripts/test_livrare_validator_plafon.py
pas l15_forma 'PASS test_livrare_l15_forma' bash scripts/test_livrare_l15_forma.sh
pas l15_paritate 'PASS test_livrare_l15_paritate' bash scripts/test_livrare_l15_paritate.sh "$REF"
pas forma_fin 'PASS test_livrare_forma_fin' bash scripts/test_livrare_forma_fin.sh
pas pglite_uscare 'TOTUL OK' node scripts/pglite/test_executie_uscare_local.mjs
pas pglite_meteo 'TOTUL OK' node scripts/pglite/test_meteo_xweather_local.mjs
if [ "$OK" = "$N" ]; then echo "PASS test_livrare_l15_local_toate ($OK/$N)"; exit 0; fi
echo "ESEC test_livrare_l15_local_toate ($OK/$N)"; exit 1
