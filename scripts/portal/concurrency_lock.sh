#!/usr/bin/env bash
# Inclus EXCLUSIV de harness-ul efemer (scripts/test_portal_e1.sh). r9 (al doilea recenzent r8, P1-01): bugetul de lock.
# Trei probe, cu sesiuni reale si bariere pe fisiere / pg_stat_activity (fara curse pe sleep lung):
#  lock_observe        tranzactia de livrare (sau de revenire) ruleaza complet si se opreste intr-o pauza INAINTE de
#                      commit; se citesc din pg_locks modurile tinute pe tabelele utilizatorilor si se ruleaza probe de
#                      utilizator (citire / scriere, lock_timeout 200 ms); apoi pauza e anulata => ROLLBACK la tot.
#  lock_budget_refusal o tranzactie lunga tine un tabel; livrarea prin runner trebuie sa refuze cu PORTAL_LOCK_BUDGET
#                      (55P03) in ~3 s, cod 10, fara obiecte ramase, iar CAT TIMP incearca utilizatorii nu sunt blocati.
#  traffic_start/stop  trafic continuu (citiri / scrieri profiles si employees, login simulat = UPDATE pe auth.users) pe
#                      toata durata livrarii reale; nicio eroare si asteptarea maxima <= PORTAL_BUDGET_MS.
PORTAL_BUDGET_MS="${PORTAL_BUDGET_MS:-3000}"
LOCK_TABLES=(auth.users public.employees public.profiles public.user_module_access)

probe_sql() {
  case "$1" in
    'citire auth.users') echo 'SELECT count(*) FROM auth.users' ;;
    'scriere auth.users') echo 'UPDATE auth.users SET email=email WHERE false' ;;
    'citire employees') echo 'SELECT count(*) FROM public.employees' ;;
    'scriere employees') echo 'UPDATE public.employees SET name=name WHERE false' ;;
    'citire profiles') echo 'SELECT count(*) FROM public.profiles' ;;
    'scriere profiles') echo 'UPDATE public.profiles SET email=email WHERE false' ;;
    'citire user_module_access') echo 'SELECT count(*) FROM public.user_module_access' ;;
    'scriere user_module_access') echo 'UPDATE public.user_module_access SET module=module WHERE false' ;;
    *) fail "proba necunoscuta: $1" ;;
  esac
}
probe_one() { # ok = a trecut; blocat = lock timeout (200 ms); altceva = eroare
  local out rc=0
  out="$("${PSQL[@]}" -Atc "SET lock_timeout='200ms'; $(probe_sql "$1")" 2>&1)" || rc=$?
  if [[ "$rc" == 0 ]]; then echo ok
  elif grep -q 'lock timeout' <<<"$out"; then echo blocat
  else echo "eroare($out)"; fi
}
probes() { # $1 = lista asteptata "nume=rezultat,..."; tipareste rezultatele obtinute, in aceeasi ordine
  local item name res=() rest="$1,"
  while [[ -n "$rest" ]]; do
    item="${rest%%,*}"; rest="${rest#*,}"; name="${item%=*}"
    res+=("$name=$(probe_one "$name")")
  done
  local IFS=,; echo "${res[*]}"
}
lock_modes() { # $1 = pid; cel mai tare mod DETINUT pe fiecare tabel al utilizatorilor ('-' = niciunul)
  local t out=() m
  for t in "${LOCK_TABLES[@]}"; do
    m="$(q "SELECT l.mode FROM pg_locks l WHERE l.pid=$1 AND l.granted AND l.locktype='relation'
      AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND l.relation='$t'::regclass
      ORDER BY array_position(ARRAY['AccessShareLock','RowShareLock','RowExclusiveLock','ShareUpdateExclusiveLock',
        'ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock'],l.mode::text) DESC LIMIT 1")"
    out+=("$t=${m:--}")
  done
  local IFS=,; echo "${out[*]}"
}
wait_pid_query() { # $1 = application_name, $2 = conditie SQL suplimentara, $3 = PID-ul procesului client; tipareste pid-ul
  local be="" i
  for ((i=0;i<300;i++)); do
    be="$(q "SELECT pid FROM pg_stat_activity WHERE application_name='$1' AND $2 LIMIT 1")"
    [[ -n "$be" ]] && { echo "$be"; return 0; }
    kill -0 "$3" 2>/dev/null || return 1
    sleep 0.05
  done
  return 1
}

lock_observe() { # $1 eticheta, $2 moduri asteptate, $3 probe asteptate, restul = argumentele psql ale tranzactiei observate
  local label="$1" exp_modes="$2" exp_probes="$3" log="$TMP/obs_$1.log" rc=0 be modes got
  shift 3
  PGAPPNAME="portal_obs_$label" "${PSQL[@]}" --single-transaction "$@" -c 'SELECT pg_sleep(10)' >"$log" 2>&1 &
  local client=$!
  be="$(wait_pid_query "portal_obs_$label" "wait_event='PgSleep' AND query LIKE '%pg_sleep(10)%'" "$client")" || { wait "$client" || true; cat "$log"; fail "observatie $label: tranzactia nu a ajuns la pauza"; }
  modes="$(lock_modes "$be")"
  got="$(probes "$exp_probes")"
  q "SELECT pg_cancel_backend($be)" >/dev/null
  wait "$client" || rc=$?
  [[ "$rc" != 0 ]] && grep -q 'canceling statement due to user request' "$log" || { cat "$log"; fail "observatie $label: pauza nu s-a anulat"; }
  [[ "$modes" == "$exp_modes" ]] || fail "observatie $label: moduri '$modes', asteptat '$exp_modes'"
  [[ "$got" == "$exp_probes" ]] || fail "observatie $label: probe '$got', asteptat '$exp_probes'"
  echo "LOCK_OBS $label: $modes | $got"
}

lock_budget_refusal() { # $1 eticheta, $2 versiunea runnerului, $3 artefactul, $4 SQL-ul tranzactiei lungi, $5 probe asteptate
  local label="$1" log="$TMP/budget_$1.log" fifo="$TMP/budget_$1.fifo" ready="$TMP/budget_$1.ready" rc=0 hrc=0 be got t0 t1 ms
  mkfifo "$fifo"
  cat >"$TMP/budget_$label.sql" <<SQL
BEGIN;
$4;
\! touch "$ready"
\! cat "$fifo" > /dev/null
COMMIT;
SQL
  "${PSQL[@]}" -f "$TMP/budget_$label.sql" >"$TMP/budget_${label}_holder.log" 2>&1 &
  local holder=$! i
  for ((i=0;i<200;i++)); do [[ -e "$ready" ]] && break; kill -0 "$holder" 2>/dev/null || break; sleep 0.05; done
  [[ -e "$ready" ]] || { cat "$TMP/budget_${label}_holder.log"; fail "buget $label: tranzactia lunga nu a pornit"; }
  t0="$(date +%s%N)"
  ( export PGAPPNAME="portal_apply_$label"; runner "$2" "$3" ) >"$log" 2>&1 &
  local apply=$!
  # psql poate trimite si comentariile dinaintea instructiunii => LIKE pe '%DO $locks$%'.
  be="$(wait_pid_query "portal_apply_$label" "query LIKE '%DO \$locks\$%' AND state='active'" "$apply")" \
    || { wait "$apply" || true; printf 'x\n' >"$fifo"; wait "$holder" || true; cat "$log"; fail "buget $label: livrarea nu a ajuns la \$locks\$"; }
  got="$(probes "$5")"
  # Probele au rulat CAT TIMP livrarea inca incerca (nu dupa refuz).
  [[ "$(q "SELECT count(*) FROM pg_stat_activity WHERE pid=$be AND query LIKE '%DO \$locks\$%' AND state='active'")" == 1 ]] \
    || fail "buget $label: probele nu au prins fereastra de incercare"
  wait "$apply" || rc=$?
  t1="$(date +%s%N)"; ms=$(( (t1 - t0) / 1000000 ))
  printf 'release\n' >"$fifo"
  wait "$holder" || hrc=$?
  [[ "$hrc" == 0 ]] || { cat "$TMP/budget_${label}_holder.log"; fail "buget $label: tranzactia lunga a esuat"; }
  [[ "$rc" == 10 ]] && grep -q 'PORTAL_LOCK_BUDGET' "$log" || { cat "$log"; fail "buget $label: asteptat refuz PORTAL_LOCK_BUDGET cu cod 10, primit $rc"; }
  [[ "$got" == "$5" ]] || fail "buget $label: probe '$got', asteptat '$5'"
  (( ms >= 2900 && ms <= 20000 )) || fail "buget $label: refuzul a venit dupa $ms ms (asteptat ~3 s + runner)"
  echo "LOCK_BUDGET $label: refuz 55P03 dupa $ms ms (runner inclus); utilizatori in timpul incercarii: $got"
}

traffic_sql() {
  local i
  : >"$TMP/traffic.sql"
  for ((i=0;i<10;i++)); do
    cat >>"$TMP/traffic.sql" <<'SQL'
DO $t$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN PERFORM count(*) FROM public.profiles;
 RAISE NOTICE 'PORTAL_TRAFIC citire_profiles %', round(extract(epoch FROM clock_timestamp()-t0)*1000); END $t$;
DO $t$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN
 UPDATE public.profiles SET email=email WHERE id='00000000-0000-0000-0000-000000000002';
 RAISE NOTICE 'PORTAL_TRAFIC scriere_profiles %', round(extract(epoch FROM clock_timestamp()-t0)*1000); END $t$;
DO $t$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN PERFORM count(*) FROM public.employees;
 RAISE NOTICE 'PORTAL_TRAFIC citire_employees %', round(extract(epoch FROM clock_timestamp()-t0)*1000); END $t$;
DO $t$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN UPDATE public.employees SET name=name WHERE id=80;
 RAISE NOTICE 'PORTAL_TRAFIC scriere_employees %', round(extract(epoch FROM clock_timestamp()-t0)*1000); END $t$;
DO $t$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN
 UPDATE auth.users SET email=email WHERE id='00000000-0000-0000-0000-000000000002';
 RAISE NOTICE 'PORTAL_TRAFIC login %', round(extract(epoch FROM clock_timestamp()-t0)*1000); END $t$;
DO $s$ BEGIN PERFORM pg_sleep(0.01); END $s$;
SQL
  done
}
traffic_start() { # $1 eticheta
  local i
  [[ -e "$TMP/traffic.sql" ]] || traffic_sql
  rm -f "$TMP/traffic_stop"; : >"$TMP/traffic_$1.log"
  ( while [[ ! -e "$TMP/traffic_stop" ]]; do
      "${PSQL[@]}" -f "$TMP/traffic.sql" >>"$TMP/traffic_$1.log" 2>&1 || echo 'PORTAL_TRAFIC_EROARE' >>"$TMP/traffic_$1.log"
    done ) &
  TRAFFIC_PID=$!
  for ((i=0;i<200;i++)); do grep -q 'PORTAL_TRAFIC ' "$TMP/traffic_$1.log" && return 0; sleep 0.05; done
  fail "trafic $1: nu a pornit"
}
traffic_stop() { # $1 eticheta, $2 plafonul in ms (0 = doar opreste)
  local log="$TMP/traffic_$1.log" n max slow
  touch "$TMP/traffic_stop"; wait "$TRAFFIC_PID" || true
  [[ "$2" != 0 ]] || return 0
  if grep -q 'PORTAL_TRAFIC_EROARE\|ERROR' "$log"; then cat "$log"; fail "trafic $1: erori in sesiunea concurenta"; fi
  n="$(grep -c 'PORTAL_TRAFIC ' "$log" || true)"
  max="$(grep -o 'PORTAL_TRAFIC [a-z_]* [0-9]*' "$log" | awk '{print $3}' | sort -n | tail -n 1 || true)"
  slow="$(grep -o 'PORTAL_TRAFIC [a-z_]* [0-9]*' "$log" | awk '$3 >= 5' | wc -l || true)"
  [[ "$n" =~ ^[0-9]+$ && "$n" -gt 0 && "$max" =~ ^[0-9]+$ ]] || fail "trafic $1: nicio operatie masurata"
  (( max <= $2 )) || { grep -o 'PORTAL_TRAFIC [a-z_]* [0-9]*' "$log" | sort -k3 -n | tail -n 5; fail "trafic $1: asteptare $max ms > plafon $2 ms"; }
  echo "TRAFIC $1: $n operatii concurente, $slow cu asteptare >= 5 ms, maxim $max ms (plafon $2 ms)"
}
