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
#                      dureaza mai mult; r12: copie_obs, plafon 120 s din conexiune); plafonul il dovedeste lock_cap_refusal.
#  lock_budget_refusal o tranzactie lunga tine un tabel; livrarea prin runner trebuie sa refuze cu PORTAL_LOCK_BUDGET
#                      (55P03) la ~1 s de la BEGIN (r12; inainte 3 s), cod 10, fara obiecte ramase; CAT TIMP incearca
#                      utilizatorii nu sunt blocati si livrarea nu tine continuu niciun lock (6 esantioane pg_locks).
#  masurat             aplicarea / revenirea REALA prin runner, cu trafic continuu (citiri / scrieri profiles si employees,
#                      login simulat = UPDATE pe auth.users) si un observator pg_locks la 2 ms: FEREASTRA = cel mai lung
#                      interval continuu in care livrarea tine un lock >= SHARE pe tabelele utilizatorilor (de la primul
#                      lock la COMMIT); BLOCARE = cea mai lunga asteptare a unei operatii de utilizator. Ambele cu prag
#                      care pica testul.
#  lock_cap_refusal    r11 pe TOATE cele 4 fluxuri; r12: 4 moduri, vezi mai jos (proba r11 "mostenit" a infirmat
#                      plafonul pornit din SQL: harness-ul PG17 real, 11.11.2026). Verificat din a doua sesiune:
#                      fereastra masurata, sesiunea disparuta, probele de utilizator libere, starea neschimbata.
#  lock_commit_lent    r11 (Jakarinos r10 P2): LIMITA, aratata, nu presupusa. Pe un cluster nou, replicare sincrona spre
#                      un standby inexistent: COMMIT-ul 18a (r12: conectat ca runnerul, plafon 2 s din conexiune)
#                      asteapta standby-ul cu lock-urile tinute; dupa 3 s (> plafon)
#                      sesiunea e tot in COMMIT (SyncRep), cu lock-urile, iar transaction_timeout NU intervine; la
#                      eliberarea asteptarii tranzactia se COMITE. Deci plafonul acopera doar pana la intrarea in COMMIT.
# r11: fara meta-comenzi psql (\!) si fara FIFO: pauzele / barierele clientului = SQL pe stdin (producator), portabil
# Linux si Git Bash pe Windows (unde \! ruleaza in cmd.exe).
# r12 (harness-ul PG17 real a infirmat proba "mostenit" r11): plafonul NU mai e pornit din SQL. E ceasul pornit de
# PostgreSQL la BEGIN cu transaction_timeout din CONEXIUNE (runnerul: --plafon-tranzactie-ms 2000 => PGOPTIONS, sursa
# 'client'); fisierele il verifica in $pre$ (2000/client) si nu-l schimba. In harness:
#  semantica_tt       sonda PG17: ce face transaction_timeout schimbat in mijlocul tranzactiei (7 cazuri, timpi reali);
#                     designul r12 cere DOAR cazul "armat la BEGIN" (verificat cu prag), restul e documentatie aratata;
#  PSQL_LIV           o livrare simulata direct (fara runner) se conecteaza exact ca runnerul (plafonul in conexiune);
#                     [r14: inlocuit de liv / obs, vezi mai jos]
#  copie_obs          LOCK_PRE / LOCK_OBS tin intentionat tranzactia deschisa (bariera): ruleaza pe o COPIE in care
#                     plafonul cerut e ridicat la 120 s si cu acelasi plafon in conexiune (nu sunt probe de plafon);
#  lock_cap_refusal   4 moduri pe fiecare flux, toate cu plafonul din conexiune: critic / commit (fara timeout prealabil),
#                     mostenit (rolul are 10 s) si mic (rolul are 500 ms), ultimele doua cu 0,8 s de lucru INAINTE de
#                     $locks$. Asteptat in toate: sesiunea inchisa la ~2 s de la BEGIN (deci <= 2 s de la lock-uri);
#  plafon_refuz       fara plafon in conexiune / ceas schimbat in tranzactie (alta valoare sau aceeasi) => refuz in $pre$.
# r13 (harness-ul PG17 real, 11.11.2026: „plafon rev18a/mostenit: inchis la 3204 ms de la BEGIN”): CAUZA = ceasul de
# perete al WSL2, nu migrarea si nu PostgreSQL. WSL2 isi potriveste ceasul cu gazda Windows in SALTURI (syslog-ul WSL:
# „Clock change detected” la ~30-60 s; unul la 16:46:41.139, in fereastra probei 16:46:39.031-16:46:42.232). Toate
# duratele probei se citesc pe ceasul de perete (xact_start, clock_timestamp, jurnalul serverului, date +%s) => un salt
# inainte de ~1,2 s le umfla pe TOATE cu aceeasi marime: inchis 3201 ms (jurnal) / 3204 ms (fereastra), FEREASTRA 2348 ms
# (= 2000 - 856 + 1204), TRAFIC 2344 ms. Ceasul transaction_timeout (setitimer ITIMER_REAL = ceas monoton) a inchis la
# 2 s reali; un salt INAPOI ar fi micsorat masuratorile (ar fi putut ascunde o inchidere tarzie). Reparatia, in proba:
#  ceas_*             abaterea ceasului de perete fata de cel MONOTON (/proc/uptime, neatins de potrivire) pe durata
#                     fiecarei probe LOCK_CAP (si a cazului semantica armat_la_begin); |abatere| >= PORTAL_SALT_MS =>
#                     masuratoarea e NEVALIDA in ambele sensuri (si cand ar fi trecut) si proba se repeta (cel mult
#                     PORTAL_CAP_INCERCARI); ramasa nevalida = esec.
#  CAP_ESECURI        un esec de plafon NU mai opreste harness-ul: se noteaza, se ruleaza toate cele 16 probe, volumul si
#                     commit-ul lent, iar la final PLAFON_ESECURI = lista completa (harness-ul pica). Esecurile de
#                     integritate (stare schimbata, sesiune ramasa, lock ramas) raman fatale pe loc.
# r14 (productia: pooler-ul Supabase NU transmite optiunile de conectare => designul r12-r13 ar fi refuzat mereu): runnerul
# pune plafonul ca SET de SESIUNE pe aceeasi conexiune, INAINTE de BEGIN; prologul lui (primul dupa BEGIN) cere N/session din
# pg_catalog.pg_settings si pune marcajul gazpet.plafon_tranzactie = 'N:<txid>'; fisierele cer 2000/session + marcajul.
#  liv / obs          o livrare simulata direct se conecteaza EXACT ca runnerul: SET de sesiune, BEGIN, prologul runnerului
#                     (prolog_plafon), argumentele, COMMIT (fara optiuni de conectare, fara --single-transaction);
#  semantica_tt       cazul de design = sesiune_inainte_de_begin (SET 1500, 1 s pauza, BEGIN): inchis la ~1,5 s de la BEGIN,
#                     nu de la SET (prag care pica testul); armat_la_begin (optiunea de conectare r12-r13) ramane documentatie;
#  plafon_refuz       6 cazuri: fara plafon (0/default), optiunea de conectare singura (2000/client: ce vede o livrare r13
#                     fara pooler; prin pooler 0/default), valoarea rolului (2000/user), alta valoare de sesiune
#                     (10000/session), SET LOCAL in tranzactie fara marcaj (2000/session marcaj lipsa) si UMBRIRE: un
#                     pg_temp.pg_settings fals (2000/session, vazut de o citire necalificata) + marcaj falsificat => fisierul
#                     citeste pg_catalog (0/default) => refuz;
#  lock_commit_lent   proba de activare a replicarii sincrone scrie WAL (CREATE TEMP TABLE; txid_current() singur nu scrie
#                     WAL, deci commit-ul lui nu asteapta standby-ul: cauza „replicarea sincrona nu s-a activat” din r13); daca
#                     mediul tot nu o activeaza => LOCK_COMMIT_LENT NEEXECUTAT, fara sa pice rularea (proba e optionala).
PORTAL_BUDGET_MS="${PORTAL_BUDGET_MS:-1000}"
PORTAL_FEREASTRA_MS="${PORTAL_FEREASTRA_MS:-1000}"
PORTAL_BLOCARE_MS="${PORTAL_BLOCARE_MS:-1000}"
PORTAL_PLAFON_MS=2000       # = --plafon-tranzactie-ms al runnerului = literalul '2000/session' din $pre$; nu se configureaza
PORTAL_PLAFON_OBS_MS=120000 # DOAR copiile de observatie (copie_obs)
PORTAL_LUCRU_MS=800         # lucrul de dinaintea lui $locks$ in modurile mostenit / mic
COMMIT_LENT_STARE=''        # r14: rezultatul probei optionale de COMMIT intarziat (EXECUTAT / NEEXECUTAT: motiv)
# r14: prologul runnerului cu plafon (scripts/livrare_migrare.sh, 0_prolog): N/session din pg_catalog, apoi marcajul.
prolog_plafon() { # $1 = plafonul in ms
  printf "DO \$p\$ BEGIN IF (SELECT setting || '/' || source FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout') IS DISTINCT FROM '%s/session' THEN RAISE EXCEPTION 'PORTAL_HARNESS_PROLOG: %%', (SELECT setting || '/' || source FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout'); END IF; PERFORM set_config('gazpet.plafon_tranzactie', '%s:' || txid_current(), true); END \$p\$" "$1" "$1"
}
# r14: livrarea simulata direct, conectata EXACT ca runnerul: SET de sesiune + BEGIN + prolog, argumentele, COMMIT.
# Cu ON_ERROR_STOP, la prima eroare psql se opreste (COMMIT-ul nu se mai trimite) => serverul anuleaza tranzactia.
liv() { "${PSQL[@]}" -c "SET transaction_timeout = $PORTAL_PLAFON_MS" -c BEGIN -c "$(prolog_plafon "$PORTAL_PLAFON_MS")" "$@" -c COMMIT; }
obs() { "${PSQL[@]}" -c "SET transaction_timeout = $PORTAL_PLAFON_OBS_MS" -c BEGIN -c "$(prolog_plafon "$PORTAL_PLAFON_OBS_MS")" "$@" -c COMMIT; }
# Traficul si observatorul pg_locks: neatinse de setarile de rol puse intentionat in probele mostenit / mic.
PSQL_FARA=(env "PGOPTIONS=-c transaction_timeout=0" "${PSQL[@]}")
LOCK_TABLES=(auth.users public.employees public.profiles public.user_module_access)
BARIERA="DO \$b\$ BEGIN PERFORM pg_sleep(60); RAISE EXCEPTION 'PORTAL_BARIERA_EXPIRATA'; END \$b\$"
PROBE_LIBER='citire auth.users=ok,scriere auth.users=ok,citire employees=ok,scriere employees=ok,citire profiles=ok,scriere profiles=ok,citire user_module_access=ok,scriere user_module_access=ok'
PORTAL_SALT_MS=100       # r13: abaterea ceas de perete / ceas monoton peste care o masuratoare nu e valida (/proc/uptime = 10 ms)
PORTAL_CAP_INCERCARI=3   # r13: incercari ale unei probe de plafon cand ceasul de perete a sarit in timpul ei
CAP_ESECURI=(); CAP_PROBE=0; CAP_REPETARI=0; PRAG_DEPASIT=''

# r13: ceasul monoton (ms). /proc/uptime (Linux, Git Bash) nu se schimba cand sistemul isi potriveste ceasul de perete;
# altfel time.monotonic() din Python.
ceas_mono_ms() {
  local u=''
  if [[ -r /proc/uptime ]] && read -r u _ </proc/uptime && [[ "$u" =~ ^[0-9]+\.[0-9]{2}$ ]]; then
    echo $(( 10#${u/./} * 10 )); return 0
  fi
  python3 -c 'import time; print(int(time.monotonic() * 1000))'
}
ceas_start() { CEAS_R0="$(date +%s%3N)"; CEAS_M0="$(ceas_mono_ms)" || fail "ceas: niciun ceas monoton"; CEAS_SALT=0; }
ceas_salt() { # CEAS_SALT = durata pe ceasul de perete - durata pe ceasul monoton (ms), de la ceas_start
  local r1 m1
  r1="$(date +%s%3N)"; m1="$(ceas_mono_ms)" || fail "ceas: niciun ceas monoton"
  [[ "$r1" =~ ^[0-9]+$ && "$m1" =~ ^[0-9]+$ && "$CEAS_R0" =~ ^[0-9]+$ && "$CEAS_M0" =~ ^[0-9]+$ ]] || fail "ceas: valori invalide"
  CEAS_SALT=$(( (r1 - CEAS_R0) - (m1 - CEAS_M0) ))
}
ceas_stabil() { (( CEAS_SALT < PORTAL_SALT_MS && CEAS_SALT > -PORTAL_SALT_MS )); }
plafon_rezumat() { # r13: lista esecurilor de plafon (tiparita la final si la orice oprire)
  local x
  (( ${#CAP_ESECURI[@]} > 0 )) || return 0
  echo "PLAFON_ESECURI: ${#CAP_ESECURI[@]} din $CAP_PROBE probe LOCK_CAP rulate (din 16) au picat:"
  for x in "${CAP_ESECURI[@]}"; do echo "  ESEC_PLAFON $x"; done
}

# r11: clientul tine tranzactia deschisa intre doua parti, fara \! si fara FIFO. Iesirea producatorului = stdin-ul
# clientului (psql -f -). Trimite partea 1 + un marcaj, asteapta ca SERVERUL sa fi terminat partea 1 (sesiunea
# 'idle in transaction' cu marcajul ca ultima instructiune), noteaza in $TMP/pauza_<app>.t momentul si inceputul
# tranzactiei (epoch ms, ceasul serverului), ruleaza comanda de pauza, apoi trimite partea 2. Marcajul neatins in 30 s
# = trimite o eroare => ROLLBACK (nimic comis din greseala).
producator() { # $1 application_name, $2 partea 1, $3 partea 2, restul = comanda de pauza
  local app="$1" p1="$2" p2="$3" i x
  shift 3
  cat "$p1"; printf "\nSELECT 'PORTAL_MARCAJ_%s';\n" "$app"
  for ((i=0;i<600;i++)); do
    x="$(q "SELECT round(extract(epoch FROM clock_timestamp())*1000)::bigint||' '||round(extract(epoch FROM xact_start)*1000)::bigint
      FROM pg_stat_activity WHERE application_name='$app' AND state='idle in transaction' AND query LIKE '%PORTAL_MARCAJ_$app%'")" || x=""
    [[ -n "$x" ]] && break
    sleep 0.05
  done
  if [[ -z "$x" ]]; then printf "DO \$e\$ BEGIN RAISE EXCEPTION 'PORTAL_MARCAJ_NEATINS'; END \$e\$;\n"; return 0; fi
  printf '%s\n' "$x" >"$TMP/pauza_$app.t"
  "$@"
  cat "$p2"
}
asteapta_fisier() { # $1 = fisierul; cel mult 120 s
  local i
  for ((i=0;i<2400;i++)); do [[ -e "$1" ]] && return 0; sleep 0.05; done
  return 0
}
asteapta_pauza() { # $1 application_name, $2 PID-ul clientului; 0 = producatorul a ajuns la pauza
  local i
  for ((i=0;i<600;i++)); do [[ -e "$TMP/pauza_$1.t" ]] && return 0; kill -0 "$2" 2>/dev/null || return 1; sleep 0.05; done
  return 1
}

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

# r12: copia de observatie = artefactul cu plafonul cerut in $pre$ ridicat la PORTAL_PLAFON_OBS_MS (exact o inlocuire);
# r14: si valoarea din marcaj ('2000:' => '120000:').
copie_obs() { # $1 artefactul, $2 copia
  [[ "$(grep -c "'$PORTAL_PLAFON_MS/session'" "$1") $(grep -c "'$PORTAL_PLAFON_MS:'" "$1")" == '1 1' ]] \
    || fail "copie_obs: $1 trebuie sa ceara exact o data $PORTAL_PLAFON_MS/session si marcajul '$PORTAL_PLAFON_MS:'"
  sed -e "s#'$PORTAL_PLAFON_MS/session'#'$PORTAL_PLAFON_OBS_MS/session'#" -e "s#'$PORTAL_PLAFON_MS:'#'$PORTAL_PLAFON_OBS_MS:'#" "$1" >"$2"
  [[ "$(grep -c "'$PORTAL_PLAFON_OBS_MS/session'" "$2") $(grep -c "'$PORTAL_PLAFON_OBS_MS:'" "$2")" == '1 1' ]] || fail "copie_obs: inlocuirea in $2"
}

lock_pre_observe() { # $1 eticheta, $2 artefactul, $3 tabelele existente (separate prin spatiu), restul = argumente psql (marcaj)
  local label="$1" art="$2" tabele="$3" log="$TMP/pre_$1.log" pre="$TMP/pre_$1.sql" obs="$TMP/pre_obs_$1.sql" rc=0 be held
  shift 3
  copie_obs "$art" "$obs"
  # Prefixul = tot ce precede linia „DO $locks$” (o singura aparitie, verificata static de buget_lock.py).
  awk '/^DO \$locks\$/{exit} {print}' "$obs" >"$pre"
  grep -q '^DO \$locks\$' "$obs" && grep -q 'DO \$priv\$' "$pre" || fail "pre $label: prefixul nu a putut fi separat"
  PGAPPNAME="portal_pre_$label" obs "$@" -f "$pre" -c "$BARIERA" >"$log" 2>&1 &
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
  local label="$1" exp_modes="$2" exp_probes="$3" stare="$4" log="$TMP/obs_$1.log" rc=0 be modes got x prev="" k=0 c
  local -a a=()
  shift 4
  [[ "$(q "$stare")" == t ]] || fail "observatie $label: starea initiala nu e cea asteptata"
  # r12: fiecare fisier (-f) ruleaza din copia de observatie (plafon 120 s, cu acelasi plafon in conexiune); tranzactia nu
  # mai schimba transaction_timeout (doar statement_timeout, ca bariera sa nu fie oprita de cel de 15 s al fisierului).
  for x in "$@"; do
    if [[ "$prev" == -f ]]; then k=$((k + 1)); c="$TMP/obs_${label}_$k.sql"; copie_obs "$x" "$c"; a+=("$c"); else a+=("$x"); fi
    prev="$x"
  done
  (( k >= 1 )) || fail "observatie $label: niciun fisier"
  PGAPPNAME="portal_obs_$label" obs "${a[@]}" \
    -c 'SET LOCAL statement_timeout = 0' -c "$BARIERA" >"$log" 2>&1 &
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
  local label="$1" log="$TMP/budget_$1.log" release="$TMP/budget_$1.release" app="portal_hold_$1" rc=0 hrc=0 be got t0 t1 ms s t srv persist=""
  local -A vazut=()
  # r18: in forma „un singur mesaj” pg_stat_activity.query arata doar inceputul mesajului (track_activity_query_size), deci
  # „DO $locks$” nu mai apare in text. Acolo, „a ajuns la $locks$” = backend activ, in tranzactie, cu advisory lock-ul runnerului
  # luat (runnerul il ia chiar inaintea blocului de lock-uri, iar serverul nu mai asteapta nimic de la client intre ele).
  local la_locks="state='active' AND (query LIKE '%DO \$locks\$%' OR (xact_start IS NOT NULL AND EXISTS (SELECT 1 FROM pg_locks al WHERE al.pid = pg_stat_activity.pid AND al.locktype = 'advisory' AND al.granted)))"
  # r11: tranzactia lunga fara \! / FIFO: partea 1 (BEGIN + instructiunea) pe stdin, COMMIT abia dupa fisierul release.
  printf 'BEGIN;\n%s;\n' "$4" >"$TMP/budget_${label}_1.sql"
  printf 'COMMIT;\n' >"$TMP/budget_${label}_2.sql"
  producator "$app" "$TMP/budget_${label}_1.sql" "$TMP/budget_${label}_2.sql" asteapta_fisier "$release" \
    | PGAPPNAME="$app" "${PSQL[@]}" -f - >"$TMP/budget_${label}_holder.log" 2>&1 &
  local holder=$!
  asteapta_pauza "$app" "$holder" || { touch "$release"; cat "$TMP/budget_${label}_holder.log"; fail "buget $label: tranzactia lunga nu a pornit"; }
  t0="$(date +%s%N)"
  ( export PGAPPNAME="portal_apply_$label"; runner "$2" "$3" ) >"$log" 2>&1 &
  local apply=$!
  # psql poate trimite si comentariile dinaintea instructiunii => LIKE pe '%DO $locks$%'.
  be="$(wait_pid_query "portal_apply_$label" "$la_locks" "$apply")" \
    || { wait "$apply" || true; touch "$release"; wait "$holder" || true; cat "$log"; fail "buget $label: livrarea nu a ajuns la \$locks\$"; }
  got="$(probes "$5")"
  # r10 (Jakarinos r9 P2): in timpul reincercarilor livrarea nu tine CONTINUU niciun lock pe tabelele utilizatorilor
  # (o incercare NOWAIT ratata tine cateva microsecunde; un lock luat inainte de $locks$ ar aparea in toate esantioanele).
  # r12: reincercarea dureaza acum pana la 1 s de la BEGIN => 6 esantioane la ~10 ms.
  for ((s=0;s<6;s++)); do
    while read -r t; do [[ -n "$t" ]] && vazut[$t]=$(( ${vazut[$t]:-0} + 1 )); done < <(q "SELECT DISTINCT l.relation::regclass::text
      FROM pg_locks l WHERE l.pid=$be AND l.locktype='relation' AND l.granted
       AND l.relation IN ('auth.users'::regclass,'public.employees'::regclass,'public.profiles'::regclass,'public.user_module_access'::regclass)")
    sleep 0.01
  done
  for t in "${!vazut[@]}"; do (( ${vazut[$t]} < 6 )) || persist+="$t "; done
  # Probele si esantioanele au rulat CAT TIMP livrarea inca incerca (nu dupa refuz).
  [[ "$(q "SELECT count(*) FROM pg_stat_activity WHERE pid=$be AND $la_locks")" == 1 ]] \
    || fail "buget $label: probele nu au prins fereastra de incercare"
  wait "$apply" || rc=$?
  t1="$(date +%s%N)"; ms=$(( (t1 - t0) / 1000000 ))
  touch "$release"
  wait "$holder" || hrc=$?
  [[ "$hrc" == 0 ]] || { cat "$TMP/budget_${label}_holder.log"; fail "buget $label: tranzactia lunga a esuat"; }
  [[ "$rc" == 10 ]] && grep -q 'PORTAL_LOCK_BUDGET' "$log" || { cat "$log"; fail "buget $label: asteptat refuz PORTAL_LOCK_BUDGET cu cod 10, primit $rc"; }
  [[ "$got" == "$5" ]] || fail "buget $label: probe '$got', asteptat '$5'"
  [[ -z "$persist" ]] || fail "buget $label: lock-uri tinute continuu in timpul reincercarilor: $persist"
  # r12: bugetul de asteptare se socoteste de la BEGIN (ceasul serverului, din mesajul refuzului): >= 1 s si sub plafon.
  srv="$(grep -o 'incercari, [0-9]* ms de la BEGIN' "$log" | head -n 1 | awk '{print $2}')" || srv=""
  [[ "$srv" =~ ^[0-9]+$ ]] || { cat "$log"; fail "buget $label: refuzul nu spune cat a asteptat de la BEGIN"; }
  (( srv >= PORTAL_BUDGET_MS && srv < PORTAL_PLAFON_MS )) || fail "buget $label: refuz la $srv ms de la BEGIN (asteptat [${PORTAL_BUDGET_MS}, ${PORTAL_PLAFON_MS}) ms)"
  (( ms >= PORTAL_BUDGET_MS - 100 && ms <= 20000 )) || fail "buget $label: refuzul a venit dupa $ms ms (asteptat ~1 s + runner)"
  ! grep -q 'transaction timeout' "$log" || fail "buget $label: refuzul trebuia sa vina din bucla (55P03), nu din plafon"
  echo "LOCK_BUDGET $label: refuz 55P03 la $srv ms de la BEGIN ($ms ms cu runnerul); utilizatori in timpul incercarii: $got; lock tinut continuu: niciunul"
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
  # r16: bucla se opreste si cand harness-ul care a pornit-o nu mai exista ($$ = shell-ul principal). In r15 o bucla
  # ramasa dintr-o rulare oprita pe acelasi slot a lovit clusterul NOU de pe acelasi port (vezi trafic_strain).
  local parinte=$$
  ( while [[ ! -e "$TMP/traffic_stop" ]] && kill -0 "$parinte" 2>/dev/null; do
      "${PSQL_FARA[@]}" -f "$TMP/traffic.sql" >>"$TMP/traffic_$1.log" 2>&1 || echo 'PORTAL_TRAFIC_EROARE' >>"$TMP/traffic_$1.log"
    done ) &
  TRAFFIC_PID=$!
  for ((i=0;i<200;i++)); do grep -q 'PORTAL_TRAFIC ' "$TMP/traffic_$1.log" && return 0; sleep 0.05; done
  fail "trafic $1: nu a pornit"
}
traffic_stop() { # $1 eticheta, $2 plafonul in ms (0 = doar opreste), $3 = moale: depasirea se noteaza in PRAG_DEPASIT (r13)
  local log="$TMP/traffic_$1.log" n max slow
  touch "$TMP/traffic_stop"; wait "$TRAFFIC_PID" || true
  [[ "$2" != 0 ]] || return 0
  if grep -q 'PORTAL_TRAFIC_EROARE\|ERROR' "$log"; then cat "$log"; fail "trafic $1: erori in sesiunea concurenta"; fi
  n="$(grep -c 'PORTAL_TRAFIC ' "$log" || true)"
  max="$(grep -o 'PORTAL_TRAFIC [a-z_]* [0-9]*' "$log" | awk '{print $3}' | sort -n | tail -n 1 || true)"
  slow="$(grep -o 'PORTAL_TRAFIC [a-z_]* [0-9]*' "$log" | awk '$3 >= 5' | wc -l || true)"
  [[ "$n" =~ ^[0-9]+$ && "$n" -gt 0 && "$max" =~ ^[0-9]+$ ]] || fail "trafic $1: nicio operatie masurata"
  if (( max > $2 )); then
    grep -o 'PORTAL_TRAFIC [a-z_]* [0-9]*' "$log" | sort -k3 -n | tail -n 5
    [[ "${3:-}" == moale ]] || fail "trafic $1: asteptare $max ms > plafon $2 ms"
    PRAG_DEPASIT+="trafic: asteptare $max ms > prag $2 ms; "
  fi
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
      -- r11: al treilea camp = sfarsitul segmentului (epoch ms, ceasul serverului), pentru timpul de la inceputul tranzactiei.
      RAISE NOTICE 'PORTAL_FEREASTRA_SEGMENT % % %', n, round(extract(epoch FROM clock_timestamp() - seg) * 1000),
        round(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
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
  PGAPPNAME="portal_fer_$1" "${PSQL_FARA[@]}" -f "$TMP/fereastra.sql" >"$TMP/fer_$1.log" 2>&1 &
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
fereastra_stop() { # $1 eticheta, $2 pragul in ms, $3 = moale (r13, ca la traffic_stop); FER_MAX = cel mai lung segment, FER_FIN = sfarsitul lui (epoch ms)
  local log="$TMP/fer_$1.log" n max fin
  fereastra_opreste "$1"
  n="$(grep -c 'PORTAL_FEREASTRA_SEGMENT ' "$log" || true)"
  read -r max fin < <(grep -o 'PORTAL_FEREASTRA_SEGMENT [0-9]* [0-9]* [0-9]*' "$log" | awk '{print $3, $4}' | sort -n | tail -n 1 || true) || true
  FER_FIN="${fin:-}"
  [[ "$n" =~ ^[0-9]+$ && "$n" -gt 0 && "$max" =~ ^[0-9]+$ ]] || { cat "$log"; fail "fereastra $1: observatorul nu a vazut lock-urile livrarii"; }
  if (( max > $2 )); then
    [[ "${3:-}" == moale ]] || fail "fereastra $1: lock-uri tinute $max ms (de la primul lock la COMMIT) > prag $2 ms"
    PRAG_DEPASIT+="fereastra: lock-uri tinute $max ms > prag $2 ms; "
  fi
  FER_MAX="$max"
  echo "FEREASTRA $1: $n segment(e), cel mai lung $max ms (prag $2 ms; plafonul din SQL ${PORTAL_PLAFON_MS} ms)"
}
masurat() { # $1 eticheta, $2 jurnalul, restul = comanda (runner ...); trafic + fereastra, praguri care pica testul
  local label="$1" log="$2"
  shift 2
  PRAG_DEPASIT=''
  ceas_start
  traffic_start "$label"
  fereastra_start "$label"
  "$@" >"$log" 2>&1 || { fereastra_opreste "$label"; traffic_stop "$label" 0 || true; cat "$log"; fail "livrare masurata $label"; }
  fereastra_stop "$label" "$PORTAL_FEREASTRA_MS" moale
  traffic_stop "$label" "$PORTAL_BLOCARE_MS" moale
  ceas_salt
  # r13: livrarea reala nu se poate repeta in aceeasi rulare => cu ceasul de perete sarit masuratoarea e NEVALIDA in
  # ambele sensuri (si sub prag: un salt inapoi micsoreaza timpii) si harness-ul pica cu motivul exact (de rerulat).
  ceas_stabil || fail "masurat $label: ceasul de perete a sarit cu $CEAS_SALT ms in timpul masuratorii (${PRAG_DEPASIT:-sub prag}) => NEVALIDA, de rerulat"
  [[ -z "$PRAG_DEPASIT" ]] || fail "masurat $label: ${PRAG_DEPASIT%; } (ceas stabil, abatere $CEAS_SALT ms)"
  echo "MASURAT $label: fereastra de lock $FER_MAX ms, blocare maxima a utilizatorilor $TRAFIC_MAX ms; ceas stabil (abatere $CEAS_SALT ms)"
}

cap_parti() { # $1 artefactul, $2 marcajul runnerului (SQL), $3 modul, $4 partea 1, $5 partea 2
  local art="$1" marcaj="$2" mod="$3"
  # r14: inceputul ca la runner: SET de sesiune INAINTE de BEGIN (ceasul porneste la BEGIN), BEGIN, prologul runnerului.
  { echo "SET transaction_timeout = $PORTAL_PLAFON_MS;"
    echo 'BEGIN;'
    printf '%s;\n' "$(prolog_plafon "$PORTAL_PLAFON_MS")"
    printf '%s;\n' "$marcaj"
    case "$mod" in
      critic) awk '/^DO \$critic\$/{exit} {print}' "$art" ;;
      commit) cat "$art" ;;
      # r12: 0,8 s de lucru pe server INAINTE de $locks$ (nu tine nimic al utilizatorilor: LOCK_PRE), apoi restul fisierului:
      # daca plafonul s-ar socoti de la lock-uri, inchiderea ar veni la ~2,8 s de la BEGIN, nu la 2 s.
      mostenit|mic) awk '/^DO \$locks\$/{exit} {print}' "$art"
        echo "SELECT pg_sleep($((PORTAL_LUCRU_MS / 1000)).$(printf '%03d' $((PORTAL_LUCRU_MS % 1000))));"
        awk '/^DO \$locks\$/{f=1} f' "$art" ;;
      *) fail "plafon: mod necunoscut $mod" ;;
    esac
  } >"$4"
  if [[ "$mod" == critic ]]; then awk '/^DO \$critic\$/{f=1} f' "$art" >"$5"; else : >"$5"; fi
  # Daca sesiunea NU ar fi inchisa, tranzactia nu se comite: eroare explicita => ROLLBACK, testul pica pe mesaj.
  printf "SELECT 1;\nDO \$e\$ BEGIN RAISE EXCEPTION 'PORTAL_PLAFON_NEDECLANSAT'; END \$e\$;\n" >>"$5"
  [[ "$(grep -c '^DO \$locks\$' "$4")" == 1 ]] || fail "plafon: partea 1 trebuie sa contina exact un \$locks\$ ($mod)"
  [[ "$mod" != critic ]] || [[ "$(grep -c '^DO \$critic\$' "$4") $(grep -c '^DO \$critic\$' "$5")" == '0 1' ]] \
    || fail "plafon: \$critic\$ trebuie sa fie doar in partea 2 (critic)"
}
# r13: O INCERCARE. Esecurile de plafon (neinchis, inchis tarziu, praguri) se strang in CAP_MOTIV, nu opresc harness-ul;
# cele de integritate (stare schimbata, sesiune ramasa, lock ramas, proba nefunctionala) raman fatale pe loc. CEAS_SALT =
# abaterea ceasului de perete fata de cel monoton pe toata proba (de la pornirea traficului la oprirea observatorilor).
lock_cap_incercare() { # $1 eticheta, $2 artefactul, $3 SQL de stare (t = starea dinainte), $4 marcajul, $5 critic|commit|mostenit|mic, $6 incercarea
  local label="$1" art="$2" stare="$3" marcaj="$4" mod="$5" et="cap_$1_$5" rc=0 n0 n1 tp xs got seg0 dela lucru rol="" vr="" vl
  [[ "$6" == 1 ]] || et+="_i$6"
  local app="portal_$et" log="$TMP/$et.log" p1="$TMP/${et}_1.sql" p2="$TMP/${et}_2.sql"
  CAP_MOTIV=''; CAP_LINIE=''; PRAG_DEPASIT=''
  rm -f "$TMP/pauza_$app.t"
  [[ "$(q "$stare")" == t ]] || fail "plafon $label/$mod: starea initiala nu e cea asteptata"
  cap_parti "$art" "$marcaj" "$mod" "$p1" "$p2"
  case "$mod" in mostenit) rol='10s'; vr='10000/user' ;; mic) rol='500ms'; vr='500/user' ;; esac
  if [[ -n "$rol" ]]; then
    "${ADMIN[@]}" -d "$DB" -c "ALTER ROLE postgres SET transaction_timeout = '$rol'" >/dev/null
    # Dovada ca valoarea rolului e reala pentru o conexiune obisnuita (sursa 'user')...
    [[ "$(q "SELECT setting||'/'||source FROM pg_catalog.pg_settings WHERE name='transaction_timeout'")" == "$vr" ]] \
      || fail "plafon $label/$mod: setarea rolului ($rol) nu se vede intr-o conexiune obisnuita"
  fi
  # ... si ca, in livrare, SET-ul de sesiune dinaintea lui BEGIN o inlocuieste (r14: sursa 'session').
  vl="$("${PSQL[@]}" -At -c "SET transaction_timeout = $PORTAL_PLAFON_MS" -c BEGIN \
    -c "SELECT setting||'/'||source FROM pg_catalog.pg_settings WHERE name='transaction_timeout'" -c ROLLBACK)"
  [[ "$vl" == "$PORTAL_PLAFON_MS/session" ]] || fail "plafon $label/$mod: tranzactia livrarii vede '$vl'"
  n0="$(grep -c 'terminating connection due to transaction timeout' "$PG_LOG" || true)"
  local l0; l0="$(wc -l <"$PG_LOG")"
  ceas_start
  traffic_start "$et"
  fereastra_start "$et"
  # Clientul: partea 1, apoi 3 s fara nicio instructiune (stdin deschis, sesiunea 'idle in transaction'), apoi partea 2.
  producator "$app" "$p1" "$p2" sleep 3 | PGAPPNAME="$app" "${PSQL[@]}" -f - >"$log" 2>&1 || rc=$?
  fereastra_stop "$et" $((PORTAL_PLAFON_MS + 500)) moale
  traffic_stop "$et" $((PORTAL_PLAFON_MS + 500)) moale
  ceas_salt
  [[ -z "$rol" ]] || "${ADMIN[@]}" -d "$DB" -c 'ALTER ROLE postgres RESET transaction_timeout' >/dev/null
  n1="$(grep -c 'terminating connection due to transaction timeout' "$PG_LOG" || true)"
  ! grep -q 'PORTAL_MARCAJ_NEATINS' "$log" || { cat "$log"; fail "plafon $label/$mod: clientul nu a ajuns la pauza (proba nefunctionala)"; }
  if grep -q 'PORTAL_PLAFON_NEDECLANSAT' "$log"; then
    CAP_MOTIV+="sesiunea NU a fost inchisa de plafon (a ajuns la partea 2, ROLLBACK prin eroare explicita); "
  elif ! [[ "$rc" != 0 ]] || ! (( n1 == n0 + 1 )); then
    CAP_MOTIV+="sesiunea trebuia inchisa de transaction_timeout (rc=$rc, jurnal $n0 -> $n1); "
    # r16: verdictul ramane acelasi (exact O inchidere in fereastra, a clientului); se arata CE s-a inchis in plus.
    # Traficul si observatorul harness-ului au transaction_timeout = 0 (PSQL_FARA) => o inchidere a unei instructiuni de
    # trafic vine de la un client STRAIN (r15: bucla ramasa dintr-o rulare veche pe acelasi slot / port).
    local inch
    inch="$(tail -n "+$((l0 + 1))" "$PG_LOG" | grep -A 3 'terminating connection due to transaction timeout' || true)"
    echo "INCHIDERI_IN_FEREASTRA $label/$mod (jurnalul serverului de la linia $((l0 + 1))):"
    printf '%s\n' "$inch" | grep 'FATAL\|STATEMENT\|QUERY' | sed 's/^/  /' | head -n 30 || true
    if [[ "$inch" == *PORTAL_TRAFIC* ]]; then
      CAP_MOTIV+="CLIENT STRAIN: instructiuni de trafic inchise de plafon (traficul harness-ului are 0) => mediu contaminat, vezi harness_wsl.sh; "
    fi
  fi
  [[ -z "$CAP_MOTIV" ]] || cat "$log"
  # Din a doua sesiune: sesiunea disparuta, niciun lock ramas (probele de utilizator trec toate), starea neschimbata.
  [[ "$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name='$app'")" == 0 ]] || fail "plafon $label/$mod: sesiunea a ramas"
  got="$(probes "$PROBE_LIBER")"
  [[ "$got" == "$PROBE_LIBER" ]] || fail "plafon $label/$mod: dupa inchidere, probe '$got'"
  [[ "$(q "$stare")" == t ]] || fail "plafon $label/$mod: au ramas efecte dupa inchiderea sesiunii"
  CAP_MOTIV+="$PRAG_DEPASIT"
  [[ -z "$CAP_MOTIV" ]] || return 0
  # Timpii (ceasul serverului, xs = inceputul tranzactiei): pauza a inceput DUPA lock-uri si INAINTE de inchidere;
  # inchiderea la ~2 s de la BEGIN in TOATE modurile (nu la 2 s de la lock-uri, nu la valoarea rolului: 10 s / 0,5 s).
  # r13: valabili doar cu ceasul de perete stabil pe durata probei (vezi lock_cap_refusal).
  read -r tp xs <"$TMP/pauza_$app.t"
  [[ "$tp" =~ ^[0-9]+$ && "$xs" =~ ^[0-9]+$ && "$FER_FIN" =~ ^[0-9]+$ ]] || fail "plafon $label/$mod: timpi lipsa"
  seg0=$(( FER_FIN - FER_MAX )); dela=$(( FER_FIN - xs )); lucru=$(( seg0 - xs ))
  (( tp >= seg0 - 50 && tp < FER_FIN )) || CAP_MOTIV+="pauza ($tp) nu e intre lock-uri ($seg0) si inchidere ($FER_FIN); "
  (( dela >= PORTAL_PLAFON_MS - 50 && dela <= PORTAL_PLAFON_MS + 400 )) \
    || CAP_MOTIV+="inchis la $dela ms de la BEGIN (asteptat ~${PORTAL_PLAFON_MS} ms; lock-urile la $lucru ms); "
  (( FER_MAX <= dela )) || CAP_MOTIV+="lock-uri tinute $FER_MAX ms > $dela ms de la BEGIN; "
  if [[ "$mod" == mostenit || "$mod" == mic ]]; then
    (( lucru >= PORTAL_LUCRU_MS - 50 )) || CAP_MOTIV+="lock-urile la $lucru ms de la BEGIN (asteptat >= ${PORTAL_LUCRU_MS} ms de lucru inainte); "
  fi
  CAP_LINIE="LOCK_CAP $label $mod: $(case "$mod" in critic) echo 'fara timeout prealabil, pauza 3 s intre $locks$ si $critic$' ;; commit) echo 'fara timeout prealabil, pauza 3 s dupa $critic$' ;; *) echo "rolul are $rol ($vr), ${PORTAL_LUCRU_MS} ms de lucru inainte de \$locks\$, pauza 3 s dupa \$critic\$" ;; esac); SET de sesiune inainte de BEGIN, tranzactia vede $vl; lock-uri la $lucru ms de la BEGIN, sesiunea inchisa de server la $dela ms de la BEGIN (plafon ${PORTAL_PLAFON_MS} ms), lock-uri tinute $FER_MAX ms; ROLLBACK, sesiune disparuta, utilizatori liberi, nimic ramas; blocare maxima a traficului $TRAFIC_MAX ms; ceas stabil (abatere $CEAS_SALT ms)"
}
# r12: plafonul = ceasul pornit la BEGIN; r14: pus de runner ca SET de sesiune inainte de BEGIN. Clientul incepe EXACT ca
# runnerul (cap_parti: SET, BEGIN, prolog); modurile mostenit / mic pun o valoare pe ROL (ca un ALTER ROLE ... SET de pe
# productie), pe care SET-ul de sesiune o inlocuieste.
# Asteptat in toate modurile: sesiunea inchisa de server la ~2 s de la BEGIN => lock-urile tinute <= 2 s pana la inchidere.
# r13: o proba in timpul careia ceasul de perete a sarit (|CEAS_SALT| >= PORTAL_SALT_MS) e NEVALIDA in ambele sensuri
# (un salt inainte umfla timpii, unul inapoi i-ar micsora) => se repeta, cel mult PORTAL_CAP_INCERCARI ori. O proba
# valida care pica se noteaza in CAP_ESECURI (harness-ul continua si pica la final, cu lista completa).
lock_cap_refusal() { # $1 eticheta, $2 artefactul, $3 SQL de stare (t = starea dinainte), $4 marcajul, $5 critic|commit|mostenit|mic
  local k
  CAP_PROBE=$((CAP_PROBE + 1))
  for ((k=1;k<=PORTAL_CAP_INCERCARI;k++)); do
    lock_cap_incercare "$@" "$k"
    if ! ceas_stabil; then
      CAP_REPETARI=$((CAP_REPETARI + 1))
      echo "CEAS_SALT $1/$5 incercarea $k: ceasul de perete s-a abatut cu $CEAS_SALT ms fata de cel monoton in timpul probei => masuratoare NEVALIDA ($([[ -n "$CAP_MOTIV" ]] && echo "ar fi picat: ${CAP_MOTIV%; }" || echo 'ar fi trecut')); se repeta"
      continue
    fi
    if [[ -z "$CAP_MOTIV" ]]; then
      echo "$CAP_LINIE$( (( k == 1 )) || echo "; incercarea $k")"
    else
      CAP_ESECURI+=("$1/$5: ${CAP_MOTIV%; } (ceas stabil, abatere $CEAS_SALT ms; incercarea $k)")
      echo "ESEC_PLAFON $1/$5: ${CAP_MOTIV%; } (ceas stabil, abatere $CEAS_SALT ms; incercarea $k) - harness-ul continua"
    fi
    return 0
  done
  CAP_ESECURI+=("$1/$5: NEVALID de $PORTAL_CAP_INCERCARI ori (ceasul de perete a sarit in fiecare incercare)")
  echo "ESEC_PLAFON $1/$5: NEVALID de $PORTAL_CAP_INCERCARI ori (ceasul de perete a sarit in fiecare incercare) - harness-ul continua"
}
# r12/r14: orice alta forma decat SET-ul de sesiune al runnerului inainte de BEGIN + marcajul prologului => refuz in $pre$,
# nimic schimbat. r14: si umbrirea (al doilea recenzent r13 P1): un pg_temp.pg_settings fals, vazut de o citire
# NECALIFICATA (dovedit in aceeasi tranzactie), + marcaj falsificat => fisierul citeste pg_catalog => 0/default => refuz.
plafon_refuz() { # $1 eticheta, $2 artefactul, $3 SQL de stare, $4 marcajul
  local label="$1" art="$2" stare="$3" marcaj="$4" caz log rc exp rol
  local -a cmd
  local FALS="CREATE TEMP TABLE pg_settings AS SELECT 'transaction_timeout'::text AS name, '$PORTAL_PLAFON_MS'::text AS setting, 'session'::text AS source"
  local DOVADA="DO \$u\$ BEGIN IF (SELECT setting || '/' || source FROM pg_settings WHERE name = 'transaction_timeout') IS DISTINCT FROM '$PORTAL_PLAFON_MS/session' THEN RAISE EXCEPTION 'PORTAL_UMBRIRE_NEFUNCTIONALA'; END IF; END \$u\$"
  local MARCAJ_FALS="SELECT set_config('gazpet.plafon_tranzactie', '$PORTAL_PLAFON_MS:' || txid_current(), true)"
  for caz in fara_runner optiune_conexiune rol alta_valoare set_local_in_tranzactie umbrire; do
    log="$TMP/refuz_${label}_$caz.log"; rc=0; rol=''
    case "$caz" in
      fara_runner) cmd=("${PSQL[@]}" --single-transaction -c "$marcaj" -f "$art"); exp='0/default' ;;
      # designul r12-r13 (parametru de pornire): fara pooler serverul vede 2000/client; prin pooler, 0/default.
      optiune_conexiune) cmd=(env "PGOPTIONS=-c transaction_timeout=$PORTAL_PLAFON_MS" "${PSQL[@]}" --single-transaction -c "$marcaj" -f "$art")
        exp="$PORTAL_PLAFON_MS/client" ;;
      rol) rol=1; cmd=("${PSQL[@]}" --single-transaction -c "$marcaj" -f "$art"); exp="$PORTAL_PLAFON_MS/user" ;;
      alta_valoare) cmd=("${PSQL[@]}" -c 'SET transaction_timeout = 10000' -c BEGIN -c "$(prolog_plafon 10000)" -c "$marcaj" -f "$art")
        exp='10000/session' ;;
      set_local_in_tranzactie) cmd=("${PSQL[@]}" --single-transaction -c "SET LOCAL transaction_timeout = $PORTAL_PLAFON_MS" -c "$marcaj" -f "$art")
        exp="$PORTAL_PLAFON_MS/session marcaj lipsa" ;;
      umbrire) cmd=("${PSQL[@]}" --single-transaction -c "$FALS" -c "$DOVADA" -c "$MARCAJ_FALS" -c "$marcaj" -f "$art")
        exp='0/default' ;;
    esac
    [[ "$(q "$stare")" == t ]] || fail "refuz plafon $label/$caz: starea initiala"
    [[ -z "$rol" ]] || "${ADMIN[@]}" -d "$DB" -c "ALTER ROLE postgres SET transaction_timeout = '$PORTAL_PLAFON_MS'" >/dev/null
    "${cmd[@]}" >"$log" 2>&1 || rc=$?
    [[ -z "$rol" ]] || "${ADMIN[@]}" -d "$DB" -c 'ALTER ROLE postgres RESET transaction_timeout' >/dev/null
    ! grep -q PORTAL_UMBRIRE_NEFUNCTIONALA "$log" || { cat "$log"; fail "refuz plafon $label/$caz: tabelul temporar nu umbreste citirea necalificata (proba nefunctionala)"; }
    [[ "$rc" != 0 ]] && grep -q "PORTAL_PLAFON_TRANZACTIE_REQUIRED: $exp " "$log" || { cat "$log"; fail "refuz plafon $label/$caz: asteptat PORTAL_PLAFON_TRANZACTIE_REQUIRED: $exp"; }
    [[ "$(q "$stare")" == t ]] || fail "refuz plafon $label/$caz: au ramas efecte"
  done
  echo "PLAFON_REFUZ $label: fara plafon (0/default), optiunea de conectare r13 ($PORTAL_PLAFON_MS/client), valoarea rolului ($PORTAL_PLAFON_MS/user), alta valoare de sesiune (10000/session), SET LOCAL in tranzactie fara marcaj ($PORTAL_PLAFON_MS/session marcaj lipsa), umbrire prin pg_temp.pg_settings + marcaj falsificat (citirea calificata vede 0/default) => refuz in \$pre\$, nimic schimbat"
}
lock_cap_toate() { # $1 eticheta, $2 artefactul, $3 SQL de stare, $4 marcajul: cele 4 moduri + refuzurile, pe acelasi flux
  local m
  for m in critic commit mostenit mic; do lock_cap_refusal "$1" "$2" "$3" "$4" "$m"; done
  plafon_refuz "$1" "$2" "$3" "$4"
}

# r12: SONDA de semantica PG17 (documentatie aratata, nu presupusa). Fiecare caz: o sesiune noua, timpul de la pornirea
# clientului pana la iesire (include conectarea, ~zeci de ms) si daca serverul a inchis-o prin transaction timeout.
# Designul r12 se bazeaza DOAR pe cazul armat_la_begin (prag care pica testul); celelalte arata de ce SQL-ul nu mai
# schimba timeout-ul in mijlocul tranzactiei.
semantica_caz() { # $1 eticheta, $2 valoarea transaction_timeout din conexiune ('' = niciuna), restul = instructiunile (-c ...)
  local et="$1" opt="$2" log="$TMP/sem_$1.log" t0 rc=0 x d=""
  shift 2
  for x in "$@"; do [[ "$x" == -c ]] || d+="$x; "; done
  t0="$(date +%s%N)"
  if [[ -n "$opt" ]]; then env "PGOPTIONS=-c transaction_timeout=$opt" "${PSQL[@]}" "$@" >"$log" 2>&1 || rc=$?
  else "${PSQL[@]}" "$@" >"$log" 2>&1 || rc=$?; fi
  SEM_MS=$(( ($(date +%s%N) - t0) / 1000000 ))
  if grep -q 'terminating connection due to transaction timeout' "$log"; then SEM_REZ=inchis
  elif [[ "$rc" == 0 ]]; then SEM_REZ=neinchis
  else cat "$log"; fail "semantica $et: eroare neasteptata (rc=$rc)"; fi
  echo "SEMANTICA_TT $et: ${SEM_REZ} la ${SEM_MS} ms de la pornirea clientului ($([[ -n "$opt" ]] && echo "conexiune $opt ms" || echo 'fara valoare in conexiune'): ${d%; })"
}
semantica_tt() {
  local DO0="DO \$s\$ BEGIN PERFORM set_config('transaction_timeout', '0', true); PERFORM set_config('transaction_timeout', '1s', true); END \$s\$"
  local k
  # r14: cazul de DESIGN (singurul verificat cu prag) = SET de sesiune, 1 s de pauza IN AFARA tranzactiei, BEGIN: sesiunea
  # se inchide la ~1,5 s de la BEGIN, deci la ~2,5 s de la pornirea clientului (nu la ~1,5 s: ceasul NU porneste la SET).
  # Valabil doar cu ceasul de perete stabil (r13: altfel se repeta, ca LOCK_CAP).
  for ((k=1;k<=PORTAL_CAP_INCERCARI;k++)); do
    ceas_start
    semantica_caz sesiune_inainte_de_begin '' -c 'SET transaction_timeout = 1500' -c 'SELECT pg_sleep(1)' -c 'BEGIN' \
      -c 'SELECT pg_sleep(0.5)' -c 'SELECT pg_sleep(4)' -c 'ROLLBACK'
    ceas_salt
    ceas_stabil && break
    echo "CEAS_SALT semantica/sesiune_inainte_de_begin incercarea $k: ceasul de perete s-a abatut cu $CEAS_SALT ms => masuratoare NEVALIDA; se repeta"
  done
  ceas_stabil || fail "semantica: ceasul de perete a sarit in toate cele $PORTAL_CAP_INCERCARI incercari ale cazului sesiune_inainte_de_begin"
  [[ "$SEM_REZ" == inchis ]] && (( SEM_MS >= 2450 && SEM_MS <= 3100 )) \
    || fail "semantica: SET-ul de sesiune (1500 ms) + 1 s + BEGIN nu a inchis sesiunea la ~1,5 s de la BEGIN (~2,5 s de la pornire; $SEM_REZ, $SEM_MS ms) - designul r14 se bazeaza pe asta"
  # Documentatie (fara prag): optiunea de conectare r12-r13 (merge doar fara pooler) si ce face ceasul schimbat in tranzactie.
  semantica_caz armat_la_begin 1500 -c 'BEGIN' -c 'SELECT pg_sleep(0.5)' -c 'SELECT pg_sleep(4)' -c 'ROLLBACK'
  semantica_caz setat_din_zero '' -c 'BEGIN' -c 'SELECT pg_sleep(0.5)' -c "SET LOCAL transaction_timeout = '1s'" -c 'SELECT pg_sleep(4)' -c 'ROLLBACK'
  semantica_caz armat_0_apoi_1s_in_DO 4000 -c 'BEGIN' -c 'SELECT pg_sleep(0.5)' -c "$DO0" -c 'SELECT pg_sleep(5)' -c 'ROLLBACK'
  semantica_caz armat_set_local_0 3000 -c 'BEGIN' -c 'SELECT pg_sleep(0.5)' -c 'SET LOCAL transaction_timeout = 0' -c 'SELECT pg_sleep(3.5)' -c 'ROLLBACK'
  semantica_caz armat_mai_mic 4000 -c 'BEGIN' -c 'SELECT pg_sleep(0.5)' -c "SET LOCAL transaction_timeout = '1s'" -c 'SELECT pg_sleep(5)' -c 'ROLLBACK'
  semantica_caz armat_mai_mare 1500 -c 'BEGIN' -c 'SELECT pg_sleep(0.5)' -c "SET LOCAL transaction_timeout = '10s'" -c 'SELECT pg_sleep(2)' -c 'ROLLBACK'
  semantica_caz r11_mostenit '' -c 'BEGIN' -c "SET LOCAL transaction_timeout = '4s'" -c 'SELECT pg_sleep(0.5)' -c "$DO0" -c 'SELECT pg_sleep(5)' -c 'ROLLBACK'
  echo "SEMANTICA_TT: cititi timpii fata de: sesiune_inainte_de_begin ~2500 inchis = DESIGNUL r14 (1 s inainte de BEGIN + 1,5 s); armat la BEGIN din conexiune (1500) ~1500 inchis = designul r12-r13 (nu trece prin pooler); un caz 'armat_*' inchis la valoarea de la BEGIN (4000 / 3000 / 1500) = schimbarea din mijlocul tranzactiei NU repune ceasul; ~1500 = il repune de la setare; neinchis = l-a oprit"
}

# r11 (Jakarinos r10 P2): COMMIT-ul propriu-zis NU e plafonat. Cluster efemer dedicat (starea lui nu mai conteaza),
# replicare sincrona spre un standby inexistent => COMMIT-ul asteapta standby-ul cu lock-urile tinute.
lock_commit_lent() { # $1 eticheta, $2 artefactul, $3 SQL de stare (t = neaplicat), $4 marcajul, $5 modurile asteptate in COMMIT
  local label="$1" art="$2" stare="$3" marcaj="$4" app="portal_commit_$1" log="$TMP/commit_$1.log" rc=0 i proba="" be modes ev t0 t1 ms
  [[ "$(q "$stare")" == t ]] || fail "commit lent $label: starea initiala"
  # Fara autovacuum: un ANALYZE automat ar astepta si el standby-ul tinand lock pe tabelele fixture-ului.
  "${ADMIN[@]}" -d postgres -c 'ALTER SYSTEM SET autovacuum = off' -c 'SELECT pg_reload_conf()' >/dev/null
  for ((i=0;i<200;i++)); do
    [[ "$(q "SELECT count(*) FROM pg_stat_activity WHERE backend_type='autovacuum worker'")" == 0 ]] && break
    sleep 0.05
  done
  [[ "$(q "SELECT count(*) FROM pg_stat_activity WHERE backend_type='autovacuum worker'")" == 0 ]] || fail "commit lent $label: autovacuum activ"
  "${ADMIN[@]}" -d postgres -c "ALTER SYSTEM SET synchronous_standby_names = 'portal_standby_inexistent'" -c 'SELECT pg_reload_conf()' >/dev/null
  # Replicarea sincrona e activa abia cand o tranzactie cu xid asteapta standby-ul (wait_event SyncRep). r14: tranzactia
  # de proba trebuie sa SCRIE WAL inainte de commit (CREATE TEMP TABLE scrie in catalog): RecordTransactionCommit asteapta
  # standby-ul doar daca tranzactia a scris WAL, iar SELECT txid_current() singur nu scrie (cauza esecului din r13).
  for ((i=0;i<20;i++)); do
    PGAPPNAME=portal_sync_proba "${PSQL[@]}" -c 'CREATE TEMP TABLE portal_sync_proba (i integer)' >"$TMP/sync_proba.log" 2>&1 &
    proba=$!
    wait_pid_query portal_sync_proba "wait_event='SyncRep'" "$proba" >/dev/null && break
    wait "$proba" || true; proba=""; sleep 0.2
  done
  if [[ -z "$proba" ]]; then
    # r14: proba e optionala (limita documentata, nu poarta): mediul care nu activeaza replicarea sincrona => NEEXECUTAT.
    "${ADMIN[@]}" -d postgres -c 'ALTER SYSTEM RESET synchronous_standby_names' -c 'SELECT pg_reload_conf()' >/dev/null
    COMMIT_LENT_STARE="NEEXECUTAT: replicarea sincrona nu s-a activat in mediul de test (nicio tranzactie de proba in SyncRep)"
    echo "LOCK_COMMIT_LENT $label: $COMMIT_LENT_STARE - proba optionala, rularea continua"; return 0
  fi
  # r14: inceputul ca la runner (SET de sesiune + BEGIN + prolog); COMMIT-ul care asteapta > 3 s arata ca plafonul se
  # opreste la intrarea in COMMIT.
  { printf 'SET transaction_timeout = %s;\nBEGIN;\n%s;\n%s;\n' "$PORTAL_PLAFON_MS" "$(prolog_plafon "$PORTAL_PLAFON_MS")" "$marcaj"
    cat "$art"; printf 'COMMIT;\n'; } >"$TMP/commit_$label.sql"
  fereastra_start "commit_$label"
  PGAPPNAME="$app" "${PSQL[@]}" -f "$TMP/commit_$label.sql" >"$log" 2>&1 &
  local client=$!
  if ! be="$(wait_pid_query "$app" "wait_event='SyncRep'" "$client")"; then
    "${ADMIN[@]}" -d postgres -c 'ALTER SYSTEM RESET synchronous_standby_names' -c 'SELECT pg_reload_conf()' >/dev/null
    wait "$client" || true; wait "$proba" || true; fereastra_opreste "commit_$label"
    ! grep -q 'transaction timeout' "$log" || { cat "$log"; fail "commit lent $label: transaction_timeout a intervenit (inainte sau in COMMIT)"; }
    cat "$log"
    COMMIT_LENT_STARE="NEEXECUTAT: COMMIT-ul 18a nu a ajuns sa astepte standby-ul (vezi jurnalul de mai sus)"
    echo "LOCK_COMMIT_LENT $label: $COMMIT_LENT_STARE - proba optionala, rularea continua"; return 0
  fi
  t0="$(date +%s%N)"
  sleep 3   # > plafonul de 2 s
  ev="$(q "SELECT coalesce(wait_event,'-') FROM pg_stat_activity WHERE pid=$be")"
  modes="$(lock_modes "$be")"
  "${ADMIN[@]}" -d postgres -c 'ALTER SYSTEM RESET synchronous_standby_names' -c 'SELECT pg_reload_conf()' >/dev/null
  wait "$client" || rc=$?
  t1="$(date +%s%N)"; ms=$(( (t1 - t0) / 1000000 ))
  wait "$proba" || true
  fereastra_stop "commit_$label" 60000
  [[ "$ev" == SyncRep ]] || fail "commit lent $label: dupa 3 s sesiunea nu mai era in COMMIT ($ev)"
  [[ "$modes" == "$5" ]] || fail "commit lent $label: in COMMIT moduri '$modes', asteptat '$5'"
  [[ "$rc" == 0 ]] || { cat "$log"; fail "commit lent $label: COMMIT-ul trebuia sa se incheie dupa eliberarea asteptarii"; }
  ! grep -q 'transaction timeout' "$log" || fail "commit lent $label: transaction_timeout a intervenit in COMMIT"
  (( FER_MAX >= 3000 )) || fail "commit lent $label: fereastra $FER_MAX ms, asteptat > 3 s"
  [[ "$(q "$stare")" == f ]] || fail "commit lent $label: tranzactia trebuia COMISA"
  COMMIT_LENT_STARE="EXECUTAT"
  echo "LOCK_COMMIT_LENT $label: COMMIT intarziat (replicare sincrona fara standby): dupa 3 s tot in COMMIT ($ev), cu $modes; transaction_timeout NU a intervenit; lock-uri tinute $FER_MAX ms > plafon ${PORTAL_PLAFON_MS} ms; dupa eliberare ($ms ms) tranzactia s-a COMIS => plafonul acopera doar pana la intrarea in COMMIT (limita documentata)"
}
