#!/usr/bin/env bash
# Rulare manuala: copie /tmp in afara NTFS, cluster efemer.
# Din Windows: wsl -d Ubuntu-24.04 -u root -- bash <worktree>/scripts/portal/harness_wsl.sh 0
set -Eeuo pipefail
SLOT="${1:?slot 0-9}"; [[ "$SLOT" =~ ^[0-9]$ ]] || exit 2
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# r13: inceputul rularii, in formatul syslog-ului (ora locala), pentru CEAS_WSL de la final.
T0="$(date '+%Y-%m-%dT%H:%M:%S')"
# r16: procesele unei rulari = cele cu directorul de lucru sau linia de comanda in /tmp/portal_e1_<slot>_* (harness) sau
# /tmp/livrare_plafon_<slot>_* (proba runnerului). $1 = prefixul cautat. Tipareste PID-urile (fara procesul curent).
procese_rulare() {
  local p pid cwd cmd out=''
  for p in /proc/[0-9]*; do
    pid="${p#/proc/}"; [[ "$pid" != "$$" && "$pid" != "$BASHPID" ]] || continue
    cwd="$(readlink "$p/cwd" 2>/dev/null || true)"
    cmd="$(tr '\0' ' ' 2>/dev/null <"$p/cmdline" || true)"
    [[ "$cwd" == "$1"* || "$cmd" == *"$1"* ]] && out+="$pid "
  done
  echo "${out% }"
}
# r16 (harness r15): o bucla de trafic ramasa dintr-o rulare oprita pe ACELASI slot loveste clusterul nou de pe acelasi
# port (r15: 4 probe LOCK_CAP „mic” picate, instructiunile ei inchise de valoarea rolului). Refuz, nu oprire automata:
# coordonatorul vede ce a ramas si il opreste el.
RAMASE="$(procese_rulare "/tmp/portal_e1_${SLOT}_") $(procese_rulare "/tmp/livrare_plafon_${SLOT}_")"
RAMASE="$(echo $RAMASE)"
if [[ -n "$RAMASE" ]]; then
  echo "MEDIU: procese ramase din rulari anterioare pe slotul $SLOT (porturi $((6700+SLOT)) / $((6790+SLOT))): $RAMASE"
  ps -o pid,etime,args -p "${RAMASE// /,}" 2>/dev/null | cut -c1-200 || true
  echo "MEDIU: opriti-le (ex.: kill $RAMASE) si rerulati; harness-ul NU a pornit"
  exit 2
fi
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
# r14: in aceeasi rulare, testul validatorului (fara BD) si proba runnerului (PR #1054, cluster propriu pe 6790 + slot).
RC_VAL=0; python3 "$DST/scripts/test_livrare_validator_plafon.py" >"$DST/validator.log" 2>&1 || RC_VAL=$?
echo "=== VALIDATOR (scripts/test_livrare_validator_plafon.py) cod=$RC_VAL"; tail -n 6 "$DST/validator.log"
# r15: forma mesajelor runnerului (fara BD, psql fals): garda finala si COMMIT-ul intr-un singur mesaj.
RC_FORMA=0; (cd "$DST" && bash scripts/test_livrare_forma_fin.sh) >"$DST/forma.log" 2>&1 || RC_FORMA=$?
echo "=== FORMA (scripts/test_livrare_forma_fin.sh) cod=$RC_FORMA"; tail -n 3 "$DST/forma.log"
RC_RUN=0
if [[ "$(id -u)" == 0 ]]; then
  su postgres -s /bin/bash -c "cd '$DST' && bash scripts/test_livrare_plafon.sh $SLOT" >"$DST/runner.log" 2>&1 || RC_RUN=$?
else
  (cd "$DST" && bash scripts/test_livrare_plafon.sh "$SLOT") >"$DST/runner.log" 2>&1 || RC_RUN=$?
fi
echo "=== RUNNER (scripts/test_livrare_plafon.sh) cod=$RC_RUN"; tail -n 16 "$DST/runner.log"
echo "portal E1-1a+1b slot=$SLOT harness=$RC validator=$RC_VAL forma=$RC_FORMA runner=$RC_RUN"
(( RC != 0 )) || (( RC_VAL == 0 && RC_FORMA == 0 && RC_RUN == 0 )) || RC=1
# r13: potrivirile ceasului de perete facute de WSL in timpul rularii (dovada independenta pentru liniile CEAS_SALT).
if [[ -r /var/log/syslog ]]; then
  N_CEAS="$(awk -v t0="$T0" 'substr($1,1,19) >= t0 && /Clock change detected/' /var/log/syslog | wc -l)" || N_CEAS='?'
  echo "CEAS_WSL: $N_CEAS linii 'Clock change detected' in /var/log/syslog de la $T0 (WSL isi potriveste ceasul de perete in salturi)"
  awk -v t0="$T0" 'substr($1,1,19) >= t0 && /Clock change detected/ {print "CEAS_WSL   " $1}' /var/log/syslog | tail -n 20 || true
fi
# r16: fara procese ramase din ACEASTA rulare (bucle de trafic, observatori, clienti psql).
RAMASE="$(procese_rulare "$DST") $(procese_rulare "/tmp/livrare_plafon_${SLOT}_")"; RAMASE="$(echo $RAMASE)"
if [[ -n "$RAMASE" ]]; then
  echo "ESEC: procese ramase dupa rulare: $RAMASE (opriti-le: kill $RAMASE)"; RC=1
else
  echo "PROCESE: niciun proces ramas din rulare"
fi
echo "portal E1-1a+1b slot=$SLOT cod=$RC; copie/log: $DST"
exit "$RC"
