#!/usr/bin/env bash
# Inclus EXCLUSIV de harness-ul efemer (scripts/test_portal_e1.sh). r9 (al doilea recenzent r8, P1-01): bugetul de lock.
# r10 (al doilea recenzent r9 P1-01, Jakarinos r9 P2): plafonul de BLOCARE, nu doar al asteptarii. Probe, cu sesiuni
# reale si bariere pe fisiere / pg_stat_activity (fara curse pe sleep lung):
#  lock_pre_observe    prefixul livrarii (tot ce e inainte de DO $locks$) ruleaza si se opreste intr-o bariera; in
#                      pg_locks sesiunea NU are niciun lock pe tabelele existente (nici ACCESS SHARE implicit, de la
#                      crearea unei functii sql); apoi bariera e anulata => ROLLBACK.
#  lock_observe        tranzactia de livrare (sau de revenire) ruleaza complet si se opreste intr-o bariera INAINTE de
#                      commit; se citesc din pg_locks modurile tinute pe tabelele utilizatorilor si se ruleaza probe de
#                      utilizator (lock_timeout 200 ms); apoi bariera e anulata => ROLLBACK la tot. Bariera NU se poate
#                      incheia cu succes: daca expira, ridica PORTAL_BARIERA_EXPIRATA => ROLLBACK, iar starea se
#                      verifica dupa (Jakarinos r9 P2). Plafonul de 2 s se ridica intentionat aici (citirea + 8 probe
#                      dureaza mai mult); plafonul il dovedeste lock_cap_refusal.
#  lock_budget_refusal o tranzactie lunga tine un tabel; livrarea prin runner trebuie sa refuze cu PORTAL_LOCK_BUDGET
#                      (55P03) in ~3 s, cod 10, fara obiecte ramase; CAT TIMP incearca utilizatorii nu sunt blocati si
#                      livrarea nu tine continuu niciun lock pe tabelele utilizatorilor (10 esantioane pg_locks).
#  masurat             aplicarea / revenirea REALA prin runner, cu trafic continuu (citiri / scrieri profiles si employees,
#                      login simulat = UPDATE pe auth.users) si un observator pg_locks la 2 ms: FEREASTRA = cel mai lung
#                      interval continuu in care livrarea tine un lock >= SHARE pe tabelele utilizatorilor (de la primul
#                      lock la COMMIT); BLOCARE = cea mai lunga asteptare a unei operatii de utilizator. Ambele cu prag
#                      care pica testul.
#  lock_cap_refusal    livrarea completa, apoi clientul sta 3 s INTRE instructiuni (ca o retea blocata), cu lock-urile
#                      tinute: serverul inchide sesiunea la 2 s (transaction_timeout) => ROLLBACK, nimic ramas,
#                      fereastra si blocarea traficului <= 2 s + marja.
PORTAL_BUDGET_MS="${PORTAL_BUDGET_MS:-3000}"
PORTAL_FEREASTRA_MS="${PORTAL_FEREASTRA_MS:-1000}"
PORTAL_BLOCARE_MS="${PORTAL_BLOCARE_MS:-1000}"
PORTAL_PLAFON_MS=2000   # transaction_timeout din SQL ($locks$); nu se configureaza din harness
LOCK_TABLES=(auth.users public.employees public.profiles public.user_module_access)
BARIERA="DO \$b\$ BEGIN PERFORM pg_sleep(60); RAISE EXCEPTION 'PORTAL_BARIERA_EXPIRATA'; END \$b\$"

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

lock_pre_observe() { # $1 eticheta, $2 artefactul, $3 tabelele existente (separate prin spatiu), restul = argumente psql (marcaj)
  local label="$1" art="$2" tabele="$3" log="$TMP/pre_$1.log" pre="$TMP/pre_$1.sql" rc=0 be held
  shift 3
  # Prefixul = tot ce precede linia „DO $locks$” (o singura aparitie, verificata static de buget_lock.py).
  awk '/^DO \$locks\$/{exit} {print}' "$art" >"$pre"
  grep -q '^DO \$locks\$' "$art" && grep -q 'DO \$priv\$' "$pre" || fail "pre $label: prefixul nu a putut fi separat"
  PGAPPNAME="portal_pre_$label" "${PSQL[@]}" --single-transaction "$@" -f "$pre" -c "$BARIERA" >"$log" 2>&1 &
  local client=$!
  be="$(wait_pid_query "portal_pre_$label" "wait_event='PgSleep' AND query LIKE '%PORTAL_BARIERA_EXPIRATA%'" "$client")" \
    || { wait "$client" || true; cat "$log"; fail "pre $label: prefixul nu a ajuns la bariera"; }
  held="$(q "SELECT coalesce(string_agg(DISTINCT l.relation::regclass::text||'='||l.mode, ', '),'') FROM pg_locks l
    WHERE l.pid=$be AND l.locktype='relation' AND l.granted
      AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
      AND l.relation IN (SELECT to_regclass(x) FROM unnest(string_to_array('$tabele',' ')) x WHERE to_regclass(x) IS NOT NULL)")"
  q "SELECT pg_cancel_backend($be)" >/dev/null
  wait "$client" || rc=$?
  [[ "$rc" != 0 ]] && grep -q 'canceling statement due to user request' "$log" || { cat "$log"; fail "pre $label: bariera nu s-a anulat"; }
  [[ -z "$held" ]] || fail "pre $label: lock-uri tinute INAINTE de \$locks\$: $held"
  echo "LOCK_PRE $label: niciun lock pe tabelele existente inainte de \$locks\$ ($tabele)"
}

lock_observe() { # $1 eticheta, $2 moduri asteptate, $3 probe asteptate, $4 SQL de stare (t inainte si dupa), restul = argumentele psql
  local label="$1" exp_modes="$2" exp_probes="$3" stare="$4" log="$TMP/obs_$1.log" rc=0 be modes got
  shift 4
  [[ "$(q "$stare")" == t ]] || fail "observatie $label: starea initiala nu e cea asteptata"
  PGAPPNAME="portal_obs_$label" "${PSQL[@]}" --single-transaction "$@" \
    -c 'SET LOCAL transaction_timeout = 0' -c 'SET LOCAL statement_timeout = 0' -c "$BARIERA" >"$log" 2>&1 &
  local client=$!
  be="$(wait_pid_query "portal_obs_$label" "wait_event='PgSleep' AND query LIKE '%PORTAL_BARIERA_EXPIRATA%'" "$client")" \
    || { wait "$client" || true; cat "$log"; fail "observatie $label: tranzactia nu a ajuns la bariera"; }
  modes="$(lock_modes "$be")"
  got="$(probes "$exp_probes")"
  q "SELECT pg_cancel_backend($be)" >/dev/null
  wait "$client" || rc=$?
  [[ "$rc" != 0 ]] && grep -q 'canceling statement due to user request' "$log" || { cat "$log"; fail "observatie $label: bariera nu s-a anulat"; }
  # Bariera expirata sau anulata = ROLLBACK: starea trebuie sa fie exact cea dinainte (fara efecte persistente).
  [[ "$(q "$stare")" == t ]] || fail "observatie $label: starea s-a schimbat dupa anulare"
  [[ "$modes" == "$exp_modes" ]] || fail "observatie $label: moduri '$modes', asteptat '$exp_modes'"
  [[ "$got" == "$exp_probes" ]] || fail "observatie $label: probe '$got', asteptat '$exp_probes'"
  echo "LOCK_OBS $label: $modes | $got"
}

lock_budget_refusal() { # $1 eticheta, $2 versiunea runnerului, $3 artefactul, $4 SQL-ul tranzactiei lungi, $5 probe asteptate
  local label="$1" log="$TMP/budget_$1.log" fifo="$TMP/budget_$1.fifo" ready="$TMP/budget_$1.ready" rc=0 hrc=0 be got t0 t1 ms s t persist=""
  local -A vazut=()
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
  # r10 (Jakarinos r9 P2): in timpul reincercarilor livrarea nu tine CONTINUU niciun lock pe tabelele utilizatorilor
  # (o incercare NOWAIT ratata tine cateva microsecunde; un lock luat inainte de $locks$ ar aparea in toate esantioanele).
  for ((s=0;s<10;s++)); do
    while read -r t; do [[ -n "$t" ]] && vazut[$t]=$(( ${vazut[$t]:-0} + 1 )); done < <(q "SELECT DISTINCT l.relation::regclass::text
      FROM pg_locks l WHERE l.pid=$be AND l.locktype='relation' AND l.granted
       AND l.relation IN ('auth.users'::regclass,'public.employees'::regclass,'public.profiles'::regclass,'public.user_module_access'::regclass)")
    sleep 0.02
  done
  for t in "${!vazut[@]}"; do (( ${vazut[$t]} < 10 )) || persist+="$t "; done
  # Probele si esantioanele au rulat CAT TIMP livrarea inca incerca (nu dupa refuz).
  [[ "$(q "SELECT count(*) FROM pg_stat_activity WHERE pid=$be AND query LIKE '%DO \$locks\$%' AND state='active'")" == 1 ]] \
    || fail "buget $label: probele nu au prins fereastra de incercare"
  wait "$apply" || rc=$?
  t1="$(date +%s%N)"; ms=$(( (t1 - t0) / 1000000 ))
  printf 'release\n' >"$fifo"
  wait "$holder" || hrc=$?
  [[ "$hrc" == 0 ]] || { cat "$TMP/budget_${label}_holder.log"; fail "buget $label: tranzactia lunga a esuat"; }
  [[ "$rc" == 10 ]] && grep -q 'PORTAL_LOCK_BUDGET' "$log" || { cat "$log"; fail "buget $label: asteptat refuz PORTAL_LOCK_BUDGET cu cod 10, primit $rc"; }
  [[ "$got" == "$5" ]] || fail "buget $label: probe '$got', asteptat '$5'"
  [[ -z "$persist" ]] || fail "buget $label: lock-uri tinute continuu in timpul reincercarilor: $persist"
  (( ms >= 2900 && ms <= 20000 )) || fail "buget $label: refuzul a venit dupa $ms ms (asteptat ~3 s + runner)"
  echo "LOCK_BUDGET $label: refuz 55P03 dupa $ms ms (runner inclus); utilizatori in timpul incercarii: $got; lock tinut continuu: niciunul"
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
  TRAFIC_MAX="$max"
  echo "TRAFIC $1: $n operatii concurente, $slow cu asteptare >= 5 ms, BLOCARE maxima $max ms (prag $2 ms)"
}

fereastra_sql() {
  cat >"$TMP/fereastra.sql" <<'SQL'
DO $f$
DECLARE t0 timestamptz := clock_timestamp(); seg timestamptz; v boolean; n integer := 0;
BEGIN
  RAISE NOTICE 'PORTAL_FEREASTRA_GATA';
  LOOP
    SELECT EXISTS (SELECT FROM pg_locks l WHERE l.pid <> pg_backend_pid() AND l.granted AND l.locktype = 'relation'
      AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND l.relation IN ('auth.users'::regclass, 'public.employees'::regclass, 'public.profiles'::regclass,
        'public.user_module_access'::regclass)
      AND l.mode IN ('ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock')) INTO v;
    IF v AND seg IS NULL THEN seg := clock_timestamp(); END IF;
    IF NOT v AND seg IS NOT NULL THEN
      n := n + 1;
      RAISE NOTICE 'PORTAL_FEREASTRA_SEGMENT % %', n, round(extract(epoch FROM clock_timestamp() - seg) * 1000);
      seg := NULL;
    END IF;
    EXIT WHEN clock_timestamp() - t0 > interval '120 seconds';
    PERFORM pg_sleep(0.002);
  END LOOP;
END $f$;
SQL
}
fereastra_start() { # $1 eticheta; observatorul pg_locks (alta sesiune), la 2 ms
  local i
  [[ -e "$TMP/fereastra.sql" ]] || fereastra_sql
  PGAPPNAME="portal_fer_$1" "${PSQL[@]}" -f "$TMP/fereastra.sql" >"$TMP/fer_$1.log" 2>&1 &
  FER_PID=$!
  for ((i=0;i<200;i++)); do grep -q PORTAL_FEREASTRA_GATA "$TMP/fer_$1.log" && return 0; kill -0 "$FER_PID" 2>/dev/null || break; sleep 0.05; done
  cat "$TMP/fer_$1.log"; fail "fereastra $1: observatorul nu a pornit"
}
fereastra_opreste() { # $1 eticheta
  local be
  sleep 0.3   # ultimul segment se inchide la <= 2 ms dupa COMMIT; runnerul a reconciliat deja
  be="$(q "SELECT pid FROM pg_stat_activity WHERE application_name='portal_fer_$1' LIMIT 1")"
  [[ -z "$be" ]] || q "SELECT pg_cancel_backend($be)" >/dev/null
  wait "$FER_PID" || true
}
fereastra_stop() { # $1 eticheta, $2 pragul in ms; FER_MAX = cel mai lung segment
  local log="$TMP/fer_$1.log" n max
  fereastra_opreste "$1"
  n="$(grep -c 'PORTAL_FEREASTRA_SEGMENT ' "$log" || true)"
  max="$(grep -o 'PORTAL_FEREASTRA_SEGMENT [0-9]* [0-9]*' "$log" | awk '{print $3}' | sort -n | tail -n 1 || true)"
  [[ "$n" =~ ^[0-9]+$ && "$n" -gt 0 && "$max" =~ ^[0-9]+$ ]] || { cat "$log"; fail "fereastra $1: observatorul nu a vazut lock-urile livrarii"; }
  (( max <= $2 )) || fail "fereastra $1: lock-uri tinute $max ms (de la primul lock la COMMIT) > prag $2 ms"
  FER_MAX="$max"
  echo "FEREASTRA $1: $n segment(e), cel mai lung $max ms (prag $2 ms; plafonul din SQL ${PORTAL_PLAFON_MS} ms)"
}
masurat() { # $1 eticheta, $2 jurnalul, restul = comanda (runner ...); trafic + fereastra, praguri care pica testul
  local label="$1" log="$2"
  shift 2
  traffic_start "$label"
  fereastra_start "$label"
  "$@" >"$log" 2>&1 || { fereastra_opreste "$label"; traffic_stop "$label" 0 || true; cat "$log"; fail "livrare masurata $label"; }
  fereastra_stop "$label" "$PORTAL_FEREASTRA_MS"
  traffic_stop "$label" "$PORTAL_BLOCARE_MS"
  echo "MASURAT $label: fereastra de lock $FER_MAX ms, blocare maxima a utilizatorilor $TRAFIC_MAX ms"
}

lock_cap_refusal() { # $1 eticheta, $2 artefactul, $3 SQL de stare (t = neaplicat), restul = argumente psql inaintea artefactului
  local label="$1" art="$2" stare="$3" log="$TMP/cap_$1.log" rc=0
  shift 3
  printf '%s\n' '\! sleep 3' >"$TMP/cap_pauza.sql"
  traffic_start "cap_$label"
  fereastra_start "cap_$label"
  PGAPPNAME="portal_cap_$label" "${PSQL[@]}" --single-transaction "$@" -f "$art" -f "$TMP/cap_pauza.sql" -c 'SELECT 1' >"$log" 2>&1 || rc=$?
  fereastra_stop "cap_$label" $((PORTAL_PLAFON_MS + 500))
  traffic_stop "cap_$label" $((PORTAL_PLAFON_MS + 500))
  [[ "$rc" != 0 ]] && grep -qs 'transaction timeout' "$log" "$PG_LOG" || { cat "$log"; fail "plafon $label: sesiunea trebuia inchisa de transaction_timeout"; }
  (( FER_MAX >= PORTAL_PLAFON_MS - 100 )) || fail "plafon $label: fereastra $FER_MAX ms, asteptat ~${PORTAL_PLAFON_MS} ms (clientul a stat 3 s)"
  [[ "$(q "$stare")" == t ]] || fail "plafon $label: au ramas obiecte dupa inchiderea sesiunii"
  echo "LOCK_CAP $label: clientul a stat 3 s intre instructiuni; serverul a inchis sesiunea dupa $FER_MAX ms de lock-uri (plafon ${PORTAL_PLAFON_MS} ms), ROLLBACK, nimic ramas; blocare maxima a traficului $TRAFIC_MAX ms"
}
