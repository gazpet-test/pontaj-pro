#!/usr/bin/env bash
# ============================================================================
# Proba CONCURENTĂ pentru 20261213a_executie_acces_proiect_perf (r2: bugetul de blocare și plafonul total) — DOAR pe clona schemei de
# producție, cu 20261209a APLICATĂ și 20261213a NEAPLICATĂ (starea de pe producție). NICIODATĂ pe producție. Harness-ul de echivalență
# (o singură sesiune, tranzacție anulată) e scripts/test_executie_acces_proiect.sql; aici, sesiuni reale în paralel.
#
# Rulare (conexiunea din mediul psql obișnuit: PGHOST / PGPORT / PGUSER=postgres / PGDATABASE + pgpass; nicio parolă aici):
#   Git Bash:  PSQL=<cale psql 17> bash scripts/test_executie_acces_perf_concurenta.sh --sistem <system_identifier al CLONEI>
#   WSL:       wsl -d Ubuntu-24.04 -u root -- env PGHOST=… PGPORT=… PGUSER=postgres PGDATABASE=… \
#                bash /mnt/c/Users/Gazpet-Ai/rdr-wt/<worktree>/scripts/test_executie_acces_perf_concurenta.sh --sistem <id>
# Scriptul refuză dacă system_identifier-ul bazei nu e cel dat (garda anti-producție) sau dacă starea nu e „20261209a fără 20261213a”.
# La final starea e din nou EXACT cea de la început (amprenta politicilor executie_acces_* + numărul funcțiilor), verificat; o aplicare
# rămasă după o întrerupere e scoasă cu revenirea armată (cu plafon) și verificată.
#
# Aplicarea și revenirea rulează EXACT în forma de livrare: o conexiune, „SET transaction_timeout = 3000” de SESIUNE, BEGIN, prologul
# runnerului (scripts/livrare_migrare.sh --plafon-tranzactie-ms 3000, PR #1054: READ COMMITTED, 3000/session citit din pg_catalog,
# marcajul gazpet.plafon_tranzactie, marcajul de livrare), fișierul, garda finală a runnerului (9_fin), COMMIT. Revenirea: șirul din
# antetul ei (SET de sesiune, BEGIN READ COMMITTED, armarea, fișierul, COMMIT).
# Traficul (sesiune separată, buclă continuă, timp măsurat pe server pe fiecare operație): citire + scriere fără efect („WHERE false”, ia
# lock-ul de scriere) pe 4 tabele acoperite (executie_proiecte, executie_tevi, documente_proiect, rapoarte_zilnice) și pe storage.objects,
# plus CONTROLUL: tabelul de acces și șantierele (ținute de migrare doar ACCESS SHARE: nu trebuie să aștepte deloc).
# Observatorul (altă sesiune, la 2 ms): FEREASTRA = cel mai lung interval continuu în care o sesiune ține un lock ≥ SHARE pe tabelele
# acoperite / storage.objects (traficul și probele nu iau niciodată așa ceva, deci e migrarea: de la lock-uri la COMMIT).
# Probele (fiecare verifică la final starea și că nu a rămas nicio sesiune exacc_*):
#   A  fără plafon (fără SET înainte de BEGIN): aplicarea și revenirea refuză (PLAFON_TRANZACTIE lipsa), nimic schimbat
#   B  un tabel ținut ocupat de o citire lungă (tranzacție deschisă): aplicarea refuză 55P03 BUGET_LOCK la [1 s, 3 s) de la BEGIN, nimic
#      schimbat; CÂT TIMP reîncearcă, celelalte tabele acoperite sunt libere (probe cu lock_timeout 200 ms) și migrarea nu ține continuu
#      niciun lock pe ele (6 eșantioane pg_locks); la fel pe storage.objects; la revenire, pe documente_proiect
#   E  clientul întârzie COMMIT-ul (pauză 5 s după fișier): serverul închide sesiunea la ~3 s de la BEGIN (transaction timeout), nimic
#      schimbat, niciun lock rămas. CAUZA se dovedește pe server, nu din textul clientului (psql de Windows nu scrie în log mesajul FATAL,
#      vede doar conexiunea închisă): martorul vede backend-ul dispărut la ~3 s de la BEGIN, iar abia DUPĂ aceea verifică fanionul pe care
#      clientul îl pune înainte să trimită garda finală și COMMIT-ul → lipsă = clientul nu trimisese nimic după fișier, deci doar serverul
#      o putea închide; idle_in_transaction_session_timeout al rolului trebuie să fie 0 sau ≥ 5 s (altfel cauza nu e sigur plafonul).
#      În logul clientului se acceptă oricare: „transaction timeout” SAU conexiunea pierdută (psql iese cu 2 / mesajul libpq); un COMMIT
#      reușit (marcajul de după COMMIT) = FAIL.
#      În pauză se citesc lock-urile ținute (cel mai tare mod pe fiecare relație, orice schemă în afară de pg_catalog / information_schema /
#      pg_toast* / pg_temp_*, fără indexuri): EXACT ACCESS EXCLUSIVE pe tabelele acoperite + storage.objects, EXACT ACCESS SHARE pe tabelul
#      de acces + sites; pe orice altă relație cel mult ACCESS SHARE (lista lor se tipărește informativ, nu se fixează literal; orice mod
#      ≥ ROW SHARE pe o relație neașteptată = FAIL). De unde vin cele în plus (pe clonă: izo_avize_iesire, profiles,
#      red_corespondenta_fisiere): amprenta „celorlalte politici” (cele care nu sunt executie_acces_*) de pe tabelele acoperite și de pe
#      storage.objects — migrarea §3 (v_alte0, pg_get_expr), revenirea înainte și după ALTER POLICY (pg_get_expr) — deparsează expresiile
#      acelor politici, iar deparsarea deschide cu ACCESS SHARE fiecare tabel citat în ele. ACCESS SHARE intră în conflict doar cu
#      ACCESS EXCLUSIVE: poate aștepta doar un DDL concurent pe acele tabele, nu citiri sau scrieri.
#      Probele în pauză: acoperitele blocate, controlul liber.
#   C  aplicarea REALĂ măsurată (trafic + observator): fereastra și blocarea maximă sub prag, controlul fără așteptare; starea = forma nouă
#   D  revenirea REALĂ măsurată, la fel; starea = exact cea de la început
# Praguri (ms, se pot da din mediu): EXACC_FEREASTRA_MS (1000), EXACC_BLOCARE_MS (1000), EXACC_CONTROL_MS (200). Plafonul (3000) și
# bugetul de lock (1000) sunt literalii din migrare / revenire, nu se configurează.
# Cod de ieșire: 0 = toate OK; 1 = vreun FAIL; 3 = garda / pregătirea a refuzat (nimic atins).
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
FEREASTRA_MS="${EXACC_FEREASTRA_MS:-1000}"
BLOCARE_MS="${EXACC_BLOCARE_MS:-1000}"
CONTROL_MS="${EXACC_CONTROL_MS:-200}"
PLAFON_MS=3000   # literalul '3000/session' din migrare și revenire
BUGET_MS=1000    # reîncercarea NOWAIT: până la 1 s de la BEGIN

RAD="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$(mktemp -d)"
# psql nativ de Windows (Git Bash) nu citește căile /tmp/… → căile date lui psql trec prin cygpath când există
cale() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
MIG="$(cale "$RAD/supabase/migrations/20261213a_executie_acces_proiect_perf.sql")"
REV="$(cale "$RAD/supabase/revenire/20261213a_executie_acces_proiect_perf_ROLLBACK.sql")"
[ -f "$RAD/supabase/migrations/20261213a_executie_acces_proiect_perf.sql" ] && [ -f "$RAD/supabase/revenire/20261213a_executie_acces_proiect_perf_ROLLBACK.sql" ] \
  || { echo "REFUZ: lipsesc fișierele 20261213a" >&2; exit 3; }

# conexiunile de serviciu ale probei: fără plafon (un rol / o bază cu plafon nu le poate opri)
q() { PGAPPNAME=exacc_q "$PSQL" -X -A -t -q -v ON_ERROR_STOP=1 -c 'SET transaction_timeout = 0' -c "$1"; }
FAIL=0
PIDS=()
TRAFIC_N="" TRAFIC_MAX="" CONTROL_MAX="" TRAFIC_TOP="" FER_N="" FER_MAX="" TRAFIC_PID="" FER_PID=""
rezultat() { echo "$1 $2"; [ "$1" = FAIL ] && FAIL=1; return 0; }

ACTUAL="$(q "SELECT system_identifier FROM pg_control_system()")" || { echo "nu pot citi system_identifier" >&2; exit 3; }
[ "$ACTUAL" = "$SISTEM" ] || { echo "REFUZ: baza are system_identifier $ACTUAL, nu $SISTEM (nu e clona dată)" >&2; exit 3; }
[ "$(q "SELECT current_setting('server_version_num')::int >= 170000")" = t ] || { echo "REFUZ: cere PostgreSQL 17 (plafonul tranzacției)" >&2; exit 3; }
[ "$(q "SELECT current_user")" = postgres ] || { echo "REFUZ: conectat ca $(q 'SELECT current_user'), nu ca postgres (ca runnerul)" >&2; exit 3; }
[ "$(q "SELECT to_regclass('public.executie_acces_proiect') IS NOT NULL AND to_regprocedure('public.fn_executie_acces_politici()') IS NULL")" = t ] \
  || { echo "REFUZ: starea clonei nu e „20261209a aplicată, 20261213a neaplicată”" >&2; exit 3; }
[ "$(q "SELECT count(*) FROM pg_stat_activity WHERE starts_with(application_name, 'exacc_') AND pid <> pg_backend_pid()")" = 0 ] \
  || { echo "REFUZ: există deja sesiuni exacc_* (altă rulare în curs?)" >&2; exit 3; }

# amprenta stării: politicile executie_acces_* (tabel, nume, comandă, tip, roluri, expresii) + numărul funcțiilor fn_executie_acces_*
STARE_SQL="SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', polrelid::regclass, polname, polcmd, polpermissive, polroles,
  coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), '')), ';' ORDER BY polrelid::regclass::text, polname), ''))
  || '|' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_acces\_%')
  FROM pg_policy WHERE polname LIKE 'executie\_acces\_%'"
stare() { q "$STARE_SQL"; }
S0="$(stare)" || { echo "REFUZ: nu pot citi starea" >&2; exit 3; }
echo "start: clona $SISTEM, starea 20261209a = $S0"

# ── fișierele livrării (generate aici; prologul și garda finală = cele ale runnerului cu --plafon-tranzactie-ms 3000) ─────────────────
cat >"$DIR/prolog.sql" <<'SQL'
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
DO $p$ BEGIN
  IF (SELECT setting || '/' || source FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout') IS DISTINCT FROM '3000/session' THEN
    RAISE EXCEPTION 'EXACC_PROLOG: plafonul nu e 3000/session (%)', (SELECT setting || '/' || source FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout');
  END IF;
  PERFORM set_config('gazpet.plafon_tranzactie', '3000:' || txid_current(), true);
END $p$;
SELECT set_config('gazpet.livrare_migrare', '20261213a_executie_acces_proiect_perf:' || txid_current(), true) IS NOT NULL AS marcaj;
SQL
# fără plafon (proba A): doar izolarea și marcajul de livrare, ca migrarea să-și facă singură refuzul
cat >"$DIR/prolog_fara.sql" <<'SQL'
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.livrare_migrare', '20261213a_executie_acces_proiect_perf:' || txid_current(), true) IS NOT NULL AS marcaj;
SQL
cat >"$DIR/fin.sql" <<'SQL'
DO $plafon_fin$ BEGIN
  IF (SELECT setting || '/' || source FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout') IS DISTINCT FROM '3000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '3000:' || txid_current() THEN
    RAISE EXCEPTION 'EXACC_FIN: PLAFON_SCHIMBAT in tranzactie'; END IF;
  IF clock_timestamp() - transaction_timestamp() > interval '3000 milliseconds' THEN
    RAISE EXCEPTION 'EXACC_FIN: PLAFON_DEPASIT: % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - transaction_timestamp()) * 1000); END IF;
END $plafon_fin$;
SQL
cat >"$DIR/arm.sql" <<'SQL'
SELECT set_config('gazpet.revenire_20261213a', 'REDA_POLITICILE_20261209A:' || txid_current(), true) IS NOT NULL AS armat;
SQL
PROLOG="$(cale "$DIR/prolog.sql")"; PROLOG_FARA="$(cale "$DIR/prolog_fara.sql")"; FIN="$(cale "$DIR/fin.sql")"; ARM="$(cale "$DIR/arm.sql")"
P=("$PSQL" -X -q -v ON_ERROR_STOP=1)
# aplicarea / revenirea în forma de livrare ($1 = application_name)
liv() { PGAPPNAME="$1" "${P[@]}" -c "SET transaction_timeout = $PLAFON_MS" -c BEGIN -f "$PROLOG" -f "$MIG" -f "$FIN" -c COMMIT -c 'RESET transaction_timeout'; }
rev() { PGAPPNAME="$1" "${P[@]}" -c "SET transaction_timeout = $PLAFON_MS" -c 'BEGIN ISOLATION LEVEL READ COMMITTED' -f "$ARM" -f "$REV" -c COMMIT -c 'RESET transaction_timeout'; }
liv_fara() { PGAPPNAME="$1" "${P[@]}" -c 'SET transaction_timeout = 0' -c BEGIN -f "$PROLOG_FARA" -f "$MIG" -c COMMIT; }
rev_fara() { PGAPPNAME="$1" "${P[@]}" -c 'SET transaction_timeout = 0' -c 'BEGIN ISOLATION LEVEL READ COMMITTED' -f "$ARM" -f "$REV" -c COMMIT; }
# aceleași, ca text pe stdin (proba E: pauza clientului între fișier și COMMIT)
text_liv() { printf 'SET transaction_timeout = %s;\nBEGIN;\n' "$PLAFON_MS"; cat "$DIR/prolog.sql"; cat "$RAD/supabase/migrations/20261213a_executie_acces_proiect_perf.sql"; printf '\n'; }
text_rev() { printf 'SET transaction_timeout = %s;\nBEGIN ISOLATION LEVEL READ COMMITTED;\n' "$PLAFON_MS"; cat "$DIR/arm.sql"; cat "$RAD/supabase/revenire/20261213a_executie_acces_proiect_perf_ROLLBACK.sql"; printf '\n'; }

opreste_tot() {
  local p
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done
  for p in "${PIDS[@]}"; do wait "$p" 2>/dev/null; done
  PIDS=()
  q "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE starts_with(application_name, 'exacc_') AND application_name <> 'exacc_q' AND pid <> pg_backend_pid()" >/dev/null 2>&1
  local i
  for i in $(seq 1 100); do
    [ "$(q "SELECT count(*) FROM pg_stat_activity WHERE starts_with(application_name, 'exacc_') AND application_name <> 'exacc_q' AND pid <> pg_backend_pid()")" = 0 ] && return 0
    sleep 0.1
  done
  return 1
}
# la final (și la orice întrerupere): sesiunile oprite, starea = cea de la început (o aplicare rămasă = revenirea armată, verificată)
final() {
  opreste_tot || rezultat FAIL "curățarea: au rămas sesiuni exacc_*"
  local s; s="$(stare)"
  if [ "$s" != "$S0" ] && [ "$(q "SELECT to_regprocedure('public.fn_executie_acces_politici()') IS NOT NULL")" = t ]; then
    echo "curățare: 20261213a a rămas aplicată → revenirea armată"
    rev exacc_curata >"$DIR/curata.log" 2>&1 || { cat "$DIR/curata.log"; }
    s="$(stare)"
  fi
  if [ "$s" = "$S0" ]; then echo "OK curățarea (starea = cea de la început: $S0)"; else rezultat FAIL "curățarea: starea $s ≠ cea de la început $S0"; fi
  rm -rf "$DIR"
  if [ "$FAIL" = 0 ]; then echo "REZULTAT: toate probele OK"; exit 0; fi
  echo "REZULTAT: vreun FAIL (vezi mai sus)"; exit 1
}
trap final EXIT
trap 'exit 1' INT TERM
fara_sesiuni() { [ "$(q "SELECT count(*) FROM pg_stat_activity WHERE starts_with(application_name, 'exacc_') AND application_name <> 'exacc_q' AND pid <> pg_backend_pid()")" = 0 ]; }
asteapta_pid() { # $1 application_name, $2 condiție SQL, $3 PID-ul clientului → tipărește pid-ul backend-ului
  local i be
  for i in $(seq 1 300); do
    be="$(q "SELECT pid FROM pg_stat_activity WHERE application_name = '$1' AND $2 LIMIT 1")"
    [ -n "$be" ] && { echo "$be"; return 0; }
    kill -0 "$3" 2>/dev/null || return 1
    sleep 0.02
  done
  return 1
}

# ── probele de utilizator: lock_timeout 200 ms (ok / blocat / eroare), toate într-O sesiune (o conexiune nouă pe probă ar fi prea lentă
# pentru fereastra de reîncercare de 1 s); scrierile = UPDATE fără efect („WHERE false”) pe o coloană sigură a tabelului ─────────────────
col_scriere() {
  case "$1" in
    storage.objects) echo name ;; public.executie_tevi) echo pachet_id ;; public.documente_proiect) echo proiect_id ;;
    public.rapoarte_zilnice) echo site_id ;; public.executie_acces_proiect) echo nivel ;; *) echo id ;;
  esac
}
proba_sql() {
  case "$1" in
    citire:*) echo "SELECT 1 FROM ${1#citire:} LIMIT 1" ;;
    scriere:*) local t="${1#scriere:}" c; c="$(col_scriere "$t")"; echo "UPDATE $t SET $c = $c WHERE false" ;;
  esac
}
# corpul plpgsql al probelor: rezultatul în r ('nume=ok|blocat|eroare(SQLSTATE)', separate prin virgulă)
probe_plpgsql() { # $1 = lista "proba=asteptat,..."
  local item nume rest="$1,"
  while [ -n "$rest" ]; do
    item="${rest%%,*}"; rest="${rest#*,}"; nume="${item%=*}"
    printf "  BEGIN EXECUTE '%s'; r := r || '%s=ok,'; EXCEPTION WHEN lock_not_available THEN r := r || '%s=blocat,';\n    WHEN OTHERS THEN r := r || '%s=eroare(' || SQLSTATE || '),'; END;\n" \
      "$(proba_sql "$nume")" "$nume" "$nume" "$nume"
  done
}
probe() { # $1 = lista "proba=asteptat,..." → tipărește rezultatele în aceeași ordine
  q "CREATE FUNCTION pg_temp.exacc_probe() RETURNS text LANGUAGE plpgsql AS \$f\$
DECLARE r text := '';
BEGIN
  PERFORM set_config('lock_timeout', '200ms', true);
$(probe_plpgsql "$1")
  RETURN rtrim(r, ',');
END \$f\$;
SELECT pg_temp.exacc_probe();"
}
# proba B: probele + 6 eșantioane pg_locks ale livrării (la 10 ms) + „încă reîncearcă”, în aceeași sesiune
probe_si_esantioane() { # $1 pid-ul livrării, $2 lista probelor → 'PROBE=…|PERSIST=…|INCA=t/f'
  q "CREATE FUNCTION pg_temp.exacc_b(p_be integer) RETURNS text LANGUAGE plpgsql AS \$f\$
DECLARE r text := ''; v jsonb := '{}'; t text; i integer; v_inca boolean;
BEGIN
  PERFORM set_config('lock_timeout', '200ms', true);
$(probe_plpgsql "$2")
  FOR i IN 1..6 LOOP
    FOR t IN SELECT DISTINCT l.relation::regclass::text FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE l.pid = p_be AND l.locktype = 'relation' AND l.granted AND n.nspname IN ('public', 'storage', 'auth') LOOP
      v := v || jsonb_build_object(t, coalesce((v->>t)::integer, 0) + 1);
    END LOOP;
    PERFORM pg_sleep(0.01);
  END LOOP;
  PERFORM pg_stat_clear_snapshot();
  v_inca := EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = p_be AND state = 'active');
  RETURN 'PROBE=' || rtrim(r, ',') || '|PERSIST=' || coalesce((SELECT string_agg(k, ' ' ORDER BY k) FROM jsonb_each_text(v) e(k, x) WHERE x::integer >= 6), '')
         || '|INCA=' || v_inca::text;
END \$f\$;
SELECT pg_temp.exacc_b($1);"
}

# ── traficul și observatorul ───────────────────────────────────────────────────────────────────────────────────────────────────────────
: >"$DIR/trafic.sql"
echo "SET transaction_timeout = 0;" >>"$DIR/trafic.sql"
for i in 1 2 3 4 5; do
  for t in public.executie_proiecte public.executie_tevi public.documente_proiect public.rapoarte_zilnice storage.objects public.executie_acces_proiect public.sites; do
    case "$t" in public.executie_acces_proiect|public.sites) cls=control ;; *) cls=acoperit ;; esac
    scr="$(proba_sql "scriere:$t")"
    cat >>"$DIR/trafic.sql" <<SQL
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN PERFORM 1 FROM $t LIMIT 1;
 RAISE NOTICE 'EXACC_TRAFIC $cls citire_$t %', round(extract(epoch FROM clock_timestamp() - t0) * 1000); END \$t\$;
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN $scr;
 RAISE NOTICE 'EXACC_TRAFIC $cls scriere_$t %', round(extract(epoch FROM clock_timestamp() - t0) * 1000); END \$t\$;
SQL
  done
  echo "DO \$s\$ BEGIN PERFORM pg_sleep(0.01); END \$s\$;" >>"$DIR/trafic.sql"
done
TRAFIC_SQL="$(cale "$DIR/trafic.sql")"
trafic_start() { # $1 eticheta
  rm -f "$DIR/trafic_stop"; : >"$DIR/trafic_$1.log"
  ( while [ ! -e "$DIR/trafic_stop" ]; do
      PGAPPNAME=exacc_trafic "$PSQL" -X -q -f "$TRAFIC_SQL" >>"$DIR/trafic_$1.log" 2>&1 || echo 'EXACC_TRAFIC_EROARE' >>"$DIR/trafic_$1.log"
    done ) &
  TRAFIC_PID=$!; PIDS+=("$TRAFIC_PID")
  local i
  for i in $(seq 1 200); do grep -q 'EXACC_TRAFIC ' "$DIR/trafic_$1.log" && return 0; sleep 0.05; done
  return 1
}
trafic_stop() { # $1 eticheta → TRAFIC_MAX (acoperite), CONTROL_MAX (control), TRAFIC_N; 1 = erori în trafic
  touch "$DIR/trafic_stop"; wait "$TRAFIC_PID" 2>/dev/null
  local log="$DIR/trafic_$1.log"
  if grep -q 'EXACC_TRAFIC_EROARE\|ERROR' "$log"; then grep 'ERROR' "$log" | head -n 5; return 1; fi
  TRAFIC_N="$(grep -c 'EXACC_TRAFIC ' "$log")"
  TRAFIC_MAX="$(grep -o 'EXACC_TRAFIC acoperit [a-z_.]* [0-9]*' "$log" | awk '{print $4}' | sort -n | tail -n 1)"
  CONTROL_MAX="$(grep -o 'EXACC_TRAFIC control [a-z_.]* [0-9]*' "$log" | awk '{print $4}' | sort -n | tail -n 1)"
  TRAFIC_TOP="$(grep -o 'EXACC_TRAFIC [a-z]* [a-z_.]* [0-9]*' "$log" | sort -k4 -n | tail -n 3 | awk '{print $3 "=" $4}' | tr '\n' ' ')"
  return 0
}
cat >"$DIR/fereastra.sql" <<'SQL'
SET transaction_timeout = 0;
DO $f$
DECLARE t0 timestamptz := clock_timestamp(); seg timestamptz; v boolean; n integer := 0;
  v_rel oid[] := ARRAY(SELECT to_regclass('public.' || quote_ident(obiect))::oid FROM public.fn_executie_acces_inventar()
                        WHERE tip = 'tabel' AND clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox')) || 'storage.objects'::regclass::oid;
BEGIN
  RAISE NOTICE 'EXACC_FEREASTRA_GATA %', cardinality(v_rel);
  LOOP
    SELECT EXISTS (SELECT FROM pg_locks l WHERE l.pid <> pg_backend_pid() AND l.granted AND l.locktype = 'relation'
      AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database()) AND l.relation = ANY (v_rel)
      AND l.mode IN ('ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock')) INTO v;
    IF v AND seg IS NULL THEN seg := clock_timestamp(); END IF;
    IF NOT v AND seg IS NOT NULL THEN
      n := n + 1;
      RAISE NOTICE 'EXACC_FEREASTRA_SEGMENT % %', n, round(extract(epoch FROM clock_timestamp() - seg) * 1000);
      seg := NULL;
    END IF;
    EXIT WHEN clock_timestamp() - t0 > interval '120 seconds';
    PERFORM pg_sleep(0.002);
  END LOOP;
END $f$;
SQL
FEREASTRA_SQL="$(cale "$DIR/fereastra.sql")"
fereastra_start() { # $1 eticheta
  PGAPPNAME=exacc_fereastra "$PSQL" -X -q -f "$FEREASTRA_SQL" >"$DIR/fer_$1.log" 2>&1 &
  FER_PID=$!; PIDS+=("$FER_PID")
  local i
  for i in $(seq 1 200); do grep -q 'EXACC_FEREASTRA_GATA' "$DIR/fer_$1.log" && return 0; kill -0 "$FER_PID" 2>/dev/null || break; sleep 0.05; done
  return 1
}
fereastra_stop() { # $1 eticheta → FER_MAX, FER_N
  sleep 0.3
  q "SELECT count(pg_cancel_backend(pid)) FROM pg_stat_activity WHERE application_name = 'exacc_fereastra'" >/dev/null
  wait "$FER_PID" 2>/dev/null
  FER_N="$(grep -c 'EXACC_FEREASTRA_SEGMENT ' "$DIR/fer_$1.log")"
  FER_MAX="$(grep -o 'EXACC_FEREASTRA_SEGMENT [0-9]* [0-9]*' "$DIR/fer_$1.log" | awk '{print $3}' | sort -n | tail -n 1)"
}

# ── A: fără plafon = refuz ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
proba_A() { # $1 aplicare|revenire, $2 starea așteptată
  local log="$DIR/A_$1.log" rc=0
  if [ "$1" = aplicare ]; then liv_fara exacc_A >"$log" 2>&1 || rc=$?; else rev_fara exacc_A >"$log" 2>&1 || rc=$?; fi
  if [ "$rc" != 0 ] && grep -q 'PLAFON_TRANZACTIE lipsa' "$log" && [ "$(stare)" = "$2" ] && fara_sesiuni; then
    rezultat OK "A $1 fără plafon: refuz ($(grep -o 'PLAFON_TRANZACTIE lipsa: [^ ]*' "$log" | head -n 1)), nimic schimbat"
  else rezultat FAIL "A $1 fără plafon: cod $rc, $(tr '\n' ' ' <"$log" | cut -c1-300)"; fi
}

# ── B: un tabel ținut ocupat = refuz 55P03 BUGET_LOCK, fără să blocheze pe nimeni ──────────────────────────────────────────────────────
proba_B() { # $1 aplicare|revenire, $2 tabelul ținut, $3 starea așteptată, $4 probele (alte tabele acoperite, libere)
  local et="B $1 ($2 ocupat)" log="$DIR/B_$1_$2.log" rc=0 holder be got persist="" srv
  PGAPPNAME=exacc_tine "$PSQL" -X -q -c 'SET transaction_timeout = 0' -c BEGIN -c "SELECT 1 FROM $2 LIMIT 1" -c 'SELECT pg_sleep(8)' -c COMMIT >"$DIR/B_tine.log" 2>&1 &
  holder=$!; PIDS+=("$holder")
  asteapta_pid exacc_tine "wait_event = 'PgSleep'" "$holder" >/dev/null || { rezultat FAIL "$et: tranzacția care ține tabelul nu a pornit"; return; }
  if [ "$1" = aplicare ]; then liv exacc_B >"$log" 2>&1 & else rev exacc_B >"$log" 2>&1 & fi
  local cl=$!; PIDS+=("$cl")
  be="$(asteapta_pid exacc_B "state = 'active' AND (query LIKE '%DO \$m\$%' OR query LIKE '%DO \$revenire\$%')" "$cl")" \
    || { wait "$cl"; rezultat FAIL "$et: livrarea nu a ajuns la blocul migrării: $(tr '\n' ' ' <"$log" | cut -c1-300)"; return; }
  # cât reîncearcă: probele pe celelalte tabele + migrarea nu ține CONTINUU niciun lock (o încercare ratată ține microsecunde)
  local r inca
  r="$(probe_si_esantioane "$be" "$4")"
  got="$(printf '%s' "$r" | sed -n 's/^PROBE=\([^|]*\)|.*/\1/p')"
  persist="$(printf '%s' "$r" | sed -n 's/.*|PERSIST=\([^|]*\)|.*/\1/p')"
  inca="$(printf '%s' "$r" | sed -n 's/.*|INCA=\(.*\)$/\1/p')"
  wait "$cl" || rc=$?
  q "SELECT count(pg_cancel_backend(pid)) FROM pg_stat_activity WHERE application_name = 'exacc_tine'" >/dev/null
  wait "$holder" 2>/dev/null
  srv="$(grep -o 'incercari, [0-9]* ms de la BEGIN' "$log" | head -n 1 | awk '{print $2}')"
  local ok=1 motiv=""
  [ "$rc" != 0 ] && grep -q 'BUGET_LOCK' "$log" && grep -q '55P03\|ocupate' "$log" || { ok=0; motiv+="nu a refuzat cu BUGET_LOCK (cod $rc: $(tr '\n' ' ' <"$log" | cut -c1-200)); "; }
  printf '%s' "$srv" | grep -Eq '^[0-9]+$' && [ "$srv" -ge "$BUGET_MS" ] && [ "$srv" -lt "$PLAFON_MS" ] || { ok=0; motiv+="refuz la '$srv' ms de la BEGIN (așteptat [$BUGET_MS, $PLAFON_MS)); "; }
  ! grep -q 'transaction timeout' "$log" || { ok=0; motiv+="refuzul a venit din plafon, nu din bucla NOWAIT; "; }
  [ "$inca" = true ] || { ok=0; motiv+="probele nu au prins fereastra de reîncercare ($r); "; }
  [ "$got" = "$4" ] || { ok=0; motiv+="probe '$got' (așteptat '$4'); "; }
  [ -z "$persist" ] || { ok=0; motiv+="lock-uri ținute continuu în timpul reîncercărilor: $persist; "; }
  [ "$(stare)" = "$3" ] || { ok=0; motiv+="starea s-a schimbat; "; }
  fara_sesiuni || { ok=0; motiv+="au rămas sesiuni exacc_*; "; }
  if [ "$ok" = 1 ]; then rezultat OK "$et: refuz 55P03 BUGET_LOCK la $srv ms de la BEGIN; în timpul reîncercării: $got; lock ținut continuu: niciunul; nimic schimbat"
  else rezultat FAIL "$et: ${motiv%; }"; fi
}

# ── E: clientul întârzie COMMIT-ul → serverul închide sesiunea la ~3 s de la BEGIN; în pauză, lock-urile ținute exact ─────────────────
proba_E() { # $1 aplicare|revenire, $2 starea așteptată
  local et="E $1 (clientul întârzie COMMIT-ul)" log="$DIR/E_$1.log" trimis="$DIR/E_trimis_$1" cl be x0 ms lk got i rc=0 iit
  local dif tari extra n_ael martor="" client=""
  rm -f "$trimis"
  # fanionul $trimis se pune ÎNAINTE de garda finală + COMMIT: cât lipsește, clientul nu a trimis nimic după fișier
  { if [ "$1" = aplicare ]; then text_liv; else text_rev; fi
    printf "SELECT 'EXACC_MARCAJ_E';\n"; sleep 5; : >"$trimis"; cat "$DIR/fin.sql"; printf "COMMIT;\nSELECT 'EXACC_DUPA_COMMIT';\n"; } 2>/dev/null \
    | PGAPPNAME=exacc_E "${P[@]}" -f - >"$log" 2>&1 &
  cl=$!; PIDS+=("$cl")
  be="$(asteapta_pid exacc_E "state = 'idle in transaction' AND query LIKE '%EXACC_MARCAJ_E%'" "$cl")" \
    || { wait "$cl"; rezultat FAIL "$et: tranzacția nu a ajuns la pauză: $(tr '\n' ' ' <"$log" | cut -c1-300)"; return; }
  x0="$(q "SELECT round(extract(epoch FROM xact_start) * 1000)::bigint FROM pg_stat_activity WHERE pid = $be")"
  # lock-urile ținute în pauză, comparate cu așteptarea într-o singură interogare → 'DIF=…|TARI=…|EXTRA=…|AEL=n'
  #   DIF   = relațiile așteptate cu alt mod (sau lipsă); TARI = relații neașteptate cu un mod > ACCESS SHARE (ambele = FAIL)
  #   EXTRA = relații neașteptate cu ACCESS SHARE (informativ); AEL = câte relații ACCESS EXCLUSIVE
  lk="$(q "WITH act AS (
      SELECT l.relation::regclass::text AS r,
        (array_agg(l.mode::text ORDER BY array_position(ARRAY['AccessShareLock','RowShareLock','RowExclusiveLock','ShareUpdateExclusiveLock',
          'ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock'], l.mode::text) DESC))[1] AS m
        FROM pg_locks l JOIN pg_class c ON c.oid = l.relation JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE l.pid = $be AND l.locktype = 'relation' AND l.granted AND c.relkind NOT IN ('i', 'I')
         AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp\_%'
       GROUP BY 1),
    ast AS (
      SELECT to_regclass('public.' || quote_ident(obiect))::text AS r, 'AccessExclusiveLock' AS m FROM public.fn_executie_acces_inventar()
       WHERE tip = 'tabel' AND clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox')
      UNION ALL SELECT 'storage.objects'::regclass::text, 'AccessExclusiveLock'
      UNION ALL SELECT 'public.executie_acces_proiect'::regclass::text, 'AccessShareLock'
      UNION ALL SELECT 'public.sites'::regclass::text, 'AccessShareLock')
    SELECT 'DIF=' || coalesce((SELECT string_agg(a.r || '=' || coalesce(x.m, 'lipsa') || '(asteptat ' || a.m || ')', ',' ORDER BY a.r)
                                 FROM ast a LEFT JOIN act x ON x.r = a.r WHERE x.m IS DISTINCT FROM a.m), '')
      || '|TARI=' || coalesce((SELECT string_agg(x.r || '=' || x.m, ',' ORDER BY x.r) FROM act x
                                WHERE x.r NOT IN (SELECT r FROM ast) AND x.m <> 'AccessShareLock'), '')
      || '|EXTRA=' || coalesce((SELECT string_agg(x.r, ' ' ORDER BY x.r) FROM act x
                                WHERE x.r NOT IN (SELECT r FROM ast) AND x.m = 'AccessShareLock'), '')
      || '|AEL=' || (SELECT count(*) FROM act WHERE m = 'AccessExclusiveLock')")"
  dif="$(printf '%s' "$lk" | sed -n 's/^DIF=\([^|]*\)|.*/\1/p')"
  tari="$(printf '%s' "$lk" | sed -n 's/.*|TARI=\([^|]*\)|.*/\1/p')"
  extra="$(printf '%s' "$lk" | sed -n 's/.*|EXTRA=\([^|]*\)|.*/\1/p')"
  n_ael="$(printf '%s' "$lk" | sed -n 's/.*|AEL=\([0-9]*\)$/\1/p')"
  got="$(probe 'citire:public.executie_tevi=blocat,scriere:storage.objects=blocat,citire:public.executie_acces_proiect=ok,scriere:public.sites=ok')"
  # martorul: backend-ul dispare la ~3 s de la BEGIN; fanionul se citește DUPĂ ce s-a văzut dispariția (lipsă = nimic trimis până atunci)
  ms=""
  for i in $(seq 1 200); do
    if [ "$(q "SELECT count(*) FROM pg_stat_activity WHERE pid = $be")" = 0 ]; then
      ms="$(( $(q "SELECT round(extract(epoch FROM clock_timestamp()) * 1000)::bigint") - x0 ))"
      if [ -e "$trimis" ]; then martor=dupa; else martor=inainte; fi
      break
    fi
    sleep 0.03
  done
  wait "$cl" || rc=$?
  # idle_in_transaction_session_timeout al rolului / bazei (sesiunea E nu-l schimbă): 0 sau ≥ 5 s, ca închiderea să nu poată veni din el
  iit="$(q "SELECT setting::bigint FROM pg_settings WHERE name = 'idle_in_transaction_session_timeout'")"
  # ce a văzut clientul: textul serverului sau conexiunea pierdută (psql iese cu 2 la conexiune pierdută, independent de limbă)
  if [ "$rc" != 0 ] && grep -q 'transaction timeout' "$log"; then client="mesajul „transaction timeout”, cod $rc"
  elif [ "$rc" = 2 ]; then client="conexiune închisă de server (cod 2)"
  elif [ "$rc" != 0 ] && grep -Eqi 'server closed the connection|connection to server was lost|no connection to the server|could not receive data from server' "$log"; then
    client="conexiune închisă de server (mesaj libpq, cod $rc)"
  fi
  local ok=1 motiv=""
  [ -n "$ms" ] || { ok=0; motiv+="sesiunea nu s-a închis; "; }
  [ -z "$ms" ] || { [ "$ms" -ge $(( PLAFON_MS - 100 )) ] && [ "$ms" -le $(( PLAFON_MS + 1000 )) ]; } || { ok=0; motiv+="închisă la $ms ms de la BEGIN (așteptat ~$PLAFON_MS); "; }
  [ -z "$ms" ] || [ "$martor" = inainte ] || { ok=0; motiv+="backend-ul a dispărut abia după ce clientul a trimis garda finală / COMMIT (nu e dovada plafonului); "; }
  printf '%s' "$iit" | grep -Eq '^[0-9]+$' && { [ "$iit" = 0 ] || [ "$iit" -ge 5000 ]; } \
    || { ok=0; motiv+="idle_in_transaction_session_timeout = '$iit' ms (trebuie 0 sau ≥ 5000, altfel cauza închiderii nu e dovedită); "; }
  [ "$rc" != 0 ] || { ok=0; motiv+="clientul a ieșit cu 0; "; }
  ! grep -q 'EXACC_DUPA_COMMIT' "$log" || { ok=0; motiv+="COMMIT-ul a reușit; "; }
  [ -n "$client" ] || { ok=0; motiv+="clientul nu arată nici „transaction timeout”, nici conexiune pierdută (cod $rc): $(tr '\n' ' ' <"$log" | tail -c 200); "; }
  [ -n "$lk" ] && [ -n "$n_ael" ] || { ok=0; motiv+="nu am putut citi lock-urile din pauză ('$lk'); "; }
  [ -z "$dif" ] || { ok=0; motiv+="lock-uri diferite de așteptare: $dif; "; }
  [ -z "$tari" ] || { ok=0; motiv+="mod mai tare decât ACCESS SHARE pe relații neașteptate: $tari; "; }
  [ "$got" = 'citire:public.executie_tevi=blocat,scriere:storage.objects=blocat,citire:public.executie_acces_proiect=ok,scriere:public.sites=ok' ] \
    || { ok=0; motiv+="probe în pauză: $got; "; }
  [ "$(stare)" = "$2" ] || { ok=0; motiv+="starea s-a schimbat (trebuia ROLLBACK la tot); "; }
  fara_sesiuni || { ok=0; motiv+="au rămas sesiuni exacc_*; "; }
  [ "$(q "SELECT count(*) FROM pg_locks WHERE pid = $be")" = 0 ] || { ok=0; motiv+="lock-uri rămase; "; }
  if [ "$ok" = 1 ]; then
    rezultat OK "$et: sesiunea închisă de server la $ms ms de la BEGIN, înainte ca clientul să trimită ceva după fișier (idle_in_transaction $iit ms); clientul: $client; nimic schimbat; în pauză: $n_ael relații ACCESS EXCLUSIVE (exact acoperitele + storage.objects), tabelul de acces + sites ACCESS SHARE, ACCESS SHARE în plus (informativ): ${extra:-niciuna}, nimic mai tare în altă parte; probe: $got"
  else rezultat FAIL "$et: ${motiv%; } [ACCESS SHARE în plus: ${extra:-niciuna}]"; fi
}

# ── C / D: aplicarea / revenirea REALĂ, măsurată ──────────────────────────────────────────────────────────────────────────────────────
proba_masurat() { # $1 aplicare|revenire
  local et="$1 măsurată" log="$DIR/M_$1.log" rc=0 ok=1 motiv=""
  trafic_start "$1" || { rezultat FAIL "$et: traficul nu a pornit"; return; }
  fereastra_start "$1" || { rezultat FAIL "$et: observatorul nu a pornit"; return; }
  sleep 0.3
  if [ "$1" = aplicare ]; then liv exacc_M >"$log" 2>&1 || rc=$?; else rev exacc_M >"$log" 2>&1 || rc=$?; fi
  sleep 0.3
  fereastra_stop "$1"
  trafic_stop "$1" || { ok=0; motiv+="erori în trafic; "; }
  [ "$rc" = 0 ] || { ok=0; motiv+="livrarea a eșuat (cod $rc): $(tr '\n' ' ' <"$log" | cut -c1-300); "; }
  local linie; linie="$(grep -o '20261213a[a-z ]* LOCK: .*COMMIT)' "$log" | head -n 1)"
  printf '%s' "${FER_N:-}" | grep -Eq '^[1-9][0-9]*$' && [ -n "${FER_MAX:-}" ] || { ok=0; motiv+="observatorul nu a văzut lock-urile livrării; "; }
  [ -z "${FER_MAX:-}" ] || [ "$FER_MAX" -le "$FEREASTRA_MS" ] || { ok=0; motiv+="fereastra de lock $FER_MAX ms > prag $FEREASTRA_MS ms; "; }
  printf '%s' "${TRAFIC_N:-}" | grep -Eq '^[1-9][0-9]*$' || { ok=0; motiv+="nicio operație de trafic măsurată; "; }
  [ -z "${TRAFIC_MAX:-}" ] || [ "$TRAFIC_MAX" -le "$BLOCARE_MS" ] || { ok=0; motiv+="blocare maximă $TRAFIC_MAX ms > prag $BLOCARE_MS ms ($TRAFIC_TOP); "; }
  [ -n "${CONTROL_MAX:-}" ] || { ok=0; motiv+="nicio operație de control (tabelul de acces / sites) măsurată; "; }
  [ -z "${CONTROL_MAX:-}" ] || [ "$CONTROL_MAX" -le "$CONTROL_MS" ] || { ok=0; motiv+="tabelul de acces / sites au așteptat $CONTROL_MAX ms > $CONTROL_MS ms; "; }
  if [ "$1" = aplicare ]; then
    [ "$(q "SELECT public.fn_executie_acces_politici_verifica('nou') IS NULL")" = t ] || { ok=0; motiv+="după aplicare politicile nu au forma nouă; "; }
    S1="$(stare)"; [ "$S1" != "$S0" ] || { ok=0; motiv+="starea nu s-a schimbat; "; }
  else
    [ "$(stare)" = "$S0" ] || { ok=0; motiv+="după revenire starea ≠ cea de la început; "; }
  fi
  fara_sesiuni || { ok=0; motiv+="au rămas sesiuni exacc_*; "; }
  if [ "$ok" = 1 ]; then
    rezultat OK "$et: FEREASTRA de lock $FER_MAX ms (prag $FEREASTRA_MS), BLOCARE maximă $TRAFIC_MAX ms pe $TRAFIC_N operații (prag $BLOCARE_MS; cele mai lungi: $TRAFIC_TOP), control $CONTROL_MAX ms (prag $CONTROL_MS); ${linie:-fără linia LOCK}"
  else rezultat FAIL "$et: ${motiv%; }"; fi
}

LIBERE_APL='citire:public.executie_proiecte=ok,scriere:public.documente_proiect=ok,citire:storage.objects=ok,scriere:public.rapoarte_zilnice=ok'
LIBERE_STO='citire:public.executie_proiecte=ok,scriere:public.executie_tevi=ok,citire:public.documente_proiect=ok'
LIBERE_REV='citire:public.executie_tevi=ok,scriere:public.executie_proiecte=ok,citire:storage.objects=ok'
proba_A aplicare "$S0"
proba_B aplicare public.executie_tevi "$S0" "$LIBERE_APL"
proba_B aplicare storage.objects "$S0" "$LIBERE_STO"
proba_E aplicare "$S0"
S1=""
proba_masurat aplicare
if [ -n "$S1" ] && [ "$S1" != "$S0" ]; then
  proba_A revenire "$S1"
  proba_B revenire public.documente_proiect "$S1" "$LIBERE_REV"
  proba_E revenire "$S1"
  proba_masurat revenire
else
  rezultat FAIL "revenirea: neprobată (aplicarea măsurată nu a reușit)"
fi
# final() rulează la ieșire (trap): curățarea, starea de la început, codul
