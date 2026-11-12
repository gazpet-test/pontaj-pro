#!/usr/bin/env bash
# Proba de CONCURENȚĂ pentru 20261217a (liniile raportului pe proiectul șantierului citit sub lock) — DOAR pe CLONĂ, cu sesiuni psql reale
# (L25). Tiparul: scripts/raport_rezumat_concurenta.sh; barierele: scripts/portal/concurrency_lock.sh (lock + așteptare observată).
# Rulare din Git Bash, cu psql de Windows; conexiunea după `--` (parola din pgpass, niciodată pe linia de comandă):
#   PSQL=/c/Users/Public/pgsql/bin/psql.exe bash scripts/raport_linii_proiect_concurenta.sh --sistem <system_identifier al clonei> \
#        [--verifica-bariera | --asteptat defect|inchis | --mutant fara_comparatie|fara_verificare|fara_for_share] -- -h <host clonă> -p <port> -U postgres -d postgres
#   --verifica-bariera = DOAR bariera (fără mutare, salvarea anulată cu ROLLBACK): arată că salvarea stă la lock-ul activității ținut de
#     control; merge în ambele stări ale migrării. Ieșire 0 = bariera ține, 26 = nu ține (proba de concurență n-ar avea ce dovedi);
#   --asteptat defect = ÎNAINTE de 20261217a pe clonă: L1–L3 trebuie să arate defectul (dovada că există azi);
#   --asteptat inchis (implicit) = DUPĂ 20261217a: fereastra închisă.
# Garda țintei: system_identifier al bazei (pg_control_system()) trebuie să fie EXACT --sistem, altfel refuz (cod 22) înainte de orice scriere.
# Datele: pe PRIMUL șantier cu proiect (P0) fără rezumate corectate de om: o activitate SINTETICĂ a lui P0 și rapoarte SINTETICE în zilele
#   2001-02-01 … 06, COMISE pe clonă (sesiunile trebuie să le vadă) și șterse la final (trap), oricare ar fi rezultatul; șantierul e mutat în
#   alt proiect (P1) în scenarii și pus la loc în P0 după fiecare și în trap. Identitatea salvărilor: owner-ul sintetic al clonei
#   (00000000-0000-4000-8000-000000000001, schimbabil cu OWNER=<uuid>), rolul authenticated, JWT-ul în ambele surse.
# Fereastra (r2, sincronizare doar pe lock-uri, fără sleep ca mecanism; așteptările sunt OBSERVATE în pg_stat_activity / pg_locks):
#   1. CONTROLUL ține activitatea sintetică FOR UPDATE, apoi ia bariera consultativă C;
#   2. SALVAREA (RPC-ul real, 20261208a) pornește după C: citește proiectul la pasul 1, apoi stă la pasul 5 (activitățile FOR SHARE);
#   3. MUTAREA pornește DOAR când vede salvarea (application_name) în așteptare de lock BLOCATĂ DE pid-ul controlului (pg_blocking_pids) —
#      marcajul „BARIERA tine”; nu-l vede în 20 s = PROBA_NEFUNCTIONALA; mută șantierul și COMITE, apoi ia bariera M;
#   4. controlul COMITE (eliberează activitatea) DOAR după M, deci salvarea continuă garantat DUPĂ mutarea comisă; mutarea ține M până
#      când controlul a eliberat C (fără pg_sleep de ținere).
#   r1 cerea ca salvarea să fi așteptat ≥ 1 s și arunca eroare în tranzacția ei altfel: pe PostgreSQL real fereastra se deschidea (mutarea
#   pornea doar după ce vedea salvarea blocată), dar ținea ~0,1 s (nimic nu ține controlul după mutare), iar eroarea anula salvarea —
#   de aici „liniile pe P-” și FAIL pe un defect de fapt reprodus. Acum durata NU mai e criteriu, iar tranzacția salvării nu e anulată de probă.
#   r3: buclele de observare rulează într-o singură tranzacție, iar PostgreSQL ține LISTA sesiunilor din pg_stat_activity fixă pe toată
#   tranzacția (instantaneul se ia la prima citire; doar starea de așteptare se citește din nou). Când sesiunea salvării se conecta DUPĂ prima
#   citire a observatorului (cele trei psql pornesc în paralel), observatorul n-o vedea niciodată: L4 „bariera nu a aparut”, deși salvarea
#   stătea 20 s chiar la lock-ul controlului (55P03 la 20 s). Acum fiecare pas de sondare începe cu pg_stat_clear_snapshot(), iar la
#   expirare observatorul tipărește sesiunile rlp17_* cu așteptarea și blocanții lor.
# Scenarii:
#   L0 salvare normală (raport nou, fără mutare): trece, fără așteptare (L20: calea legitimă nu începe să pice);
#   L1 raport NOU, mutarea comisă în fereastră -> inchis: refuz 22023 („șantierul raportului e acum în alt proiect”), nimic scris;
#      defect: salvarea trece cu liniile pe P0, șantierul în P1;
#   L2 raport EXISTENT fără rezumat valabil ('de_recompus', ca rapoartele de dinainte de 20261216a) -> la fel ca L1;
#   L3 calea directă (INSERT ca postgres) în timpul unei mutări în zbor (mutarea nu comite până nu vede scrierea fie blocată de ea, fie
#      terminată) -> inchis: scrierea e văzută blocată de mutare, apoi refuz 22023; defect: trece fără să aștepte, cu proiectul vechi;
#   L4 raport existent CU rezumat automat ținut de o salvare în fereastră + mutarea -> mutarea refuză IMEDIAT (55P03, NOWAIT din 20261216a),
#      fără deadlock, iar salvarea trece pe P0 (șantierul rămas în P0) — la fel înainte și după 20261217a (după: trece și prin gardă,
#      proiectul liniei = proiectul șantierului citit sub lock; calea legitimă sub concurență, L20);
#   L5 (r3) calea directă cu o linie FĂRĂ activitate (proiect P0; dacă schema cere activitate: cu o activitate SINTETICĂ a lui P1) în
#      timpul unei mutări în zbor -> inchis: scrierea așteaptă mutarea, apoi
#      refuz 22023 („șantierul raportului e acum în alt proiect”); defect: linia rămâne pe P0, șantierul în P1. Singurul scenariu în care
#      DOAR comparația proiectului închide fereastra (fără activitate, verificarea activității nu are ce compara).
# Ce închide fereastra, pe fiecare cale (r3; dovada: mutanții de mai jos + harness-ul SQL T2 / T4 + mutanții PGlite M1 / M1b / M3 / M11):
#   * RPC, raport nou sau existent fără rezumat (L1, L2): liniile au MEREU activitate (RPC-ul o cere), validată la pasul 5 pe proiectul citit
#     la pasul 1 și ținută FOR SHARE până la COMMIT. După mutare, garda citește proiectul nou sub lock și DOUĂ verificări refuză, fiecare
#     singură: comparația (proiectul liniei = cel vechi) și verificarea activității (activitatea e a proiectului vechi). Redundanță voită.
#   * scriere directă (L3, L5): rândul vine de la cel care scrie, deci proiectul și activitatea pot fi oricum. Comparația e SINGURA care
#     vede o linie fără activitate (L5) sau cu proiect greșit și activitate corectă (T4: proiect NULL, UPDATE proiect_id); verificarea
#     activității e SINGURA care vede proiectul corect cu activitatea altui proiect (T4). Lock-ul (FOR SHARE pe șantier) face ca ambele să
#     citească proiectul DUPĂ mutarea în zbor (L3, mutantul fara_for_share).
# Fiecare scenariu primește UNA din trei stări (r2): OK (rezultatul cerut de --asteptat), CONTRAR (fereastra s-a deschis, dar rezultatul
#   e celălalt: DEFECT reprodus / FEREASTRA INCHISA / neclasificat), PROBA_NEFUNCTIONALA (bariera nu a ținut, mutarea nu a trecut,
#   o sesiune a picat, date de plecare greșite) — atunci rezultatul salvării NU se judecă.
# Mutanți (--mutant <nume>, cu 20261217a aplicată): funcția gărzii e stricată pe clonă (CREATE OR REPLACE din pg_get_functiondef), rulează
#   DOAR scenariile lui, apoi se pune la loc în trap (amprenta corpului verificată). Ieșire 0 = mutantul a fost PRINS (scenariul-țintă a
#   arătat DEFECTUL, cu fereastra deschisă, și niciun scenariu nu e CONTRAR):
#   fara_comparatie = linia nu se mai compară cu proiectul șantierului: L1 trebuie să rămână ÎNCHIS, refuzat de verificarea activității
#     (redundanța de pe calea RPC, dovedită), iar L5 (linia fără activitate) trebuie să arate DEFECTUL (r2 rula doar L1 => „SCAPAT”);
#   fara_verificare (r3) = fără comparație ȘI fără verificarea activității / obiectului (rămâne doar lock-ul): L1 trebuie să arate DEFECTUL;
#   fara_for_share = șantierul citit fără lock (L3).
# Ieșire: 0 = toate scenariile OK (cu --mutant: mutantul prins; cu --verifica-bariera: bariera ține); 1 = un scenariu CONTRAR (cu --mutant:
#   mutantul a scăpat); 26 = PROBA NEFUNCȚIONALĂ (are prioritate: nimic din rulare nu se citește ca dovadă); 2 = argumente; 22 = altă țintă;
#   23 = starea migrării nu e cea cerută de --asteptat; 24 = date de test lipsă / ocupate; 25 = funcția nu s-a putut pune la loc.
set -euo pipefail
PSQL="${PSQL:-psql}"
export PGCLIENTENCODING=UTF8
SISTEM=""; MUTANT=""; ASTEPTAT="inchis"; VERIFICA=0
while [ $# -gt 0 ]; do
  case "$1" in
    --sistem) SISTEM="${2:-}"; shift 2 ;;
    --mutant) MUTANT="${2:-}"; shift 2 ;;
    --asteptat) ASTEPTAT="${2:-}"; shift 2 ;;
    --verifica-bariera) VERIFICA=1; shift ;;
    --) shift; break ;;
    *) echo "argument necunoscut: $1 (conexiunea vine după --)" >&2; exit 2 ;;
  esac
done
CONN=("$@")
[[ "$SISTEM" =~ ^[0-9]+$ ]] || { echo "lipseste --sistem <system_identifier al clonei> (numar)" >&2; exit 2; }
case "$ASTEPTAT" in defect|inchis) ;; *) echo "--asteptat defect|inchis" >&2; exit 2 ;; esac
case "$MUTANT" in ""|fara_comparatie|fara_verificare|fara_for_share) ;; *) echo "mutant necunoscut: $MUTANT" >&2; exit 2 ;; esac
if [ -n "$MUTANT" ] && [ "$ASTEPTAT" != inchis ]; then echo "--mutant cere migrarea aplicata (--asteptat inchis)" >&2; exit 2; fi
if [ "$VERIFICA" = 1 ] && [ -n "$MUTANT" ]; then echo "--verifica-bariera nu se combina cu --mutant" >&2; exit 2; fi
OWNER="${OWNER:-00000000-0000-4000-8000-000000000001}"
[[ "$OWNER" =~ ^[0-9a-f-]{36}$ ]] || { echo "OWNER invalid" >&2; exit 2; }
cd "$(dirname "$0")/.."
TMP="$(mktemp -d ./.concurenta_20261217a.XXXXXX)"   # în repo: căi relative, fără conversia /tmp pentru psql de Windows
q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" "$@"; }

REAL="$(q -c "SELECT system_identifier FROM pg_control_system()")"
if [ "$REAL" != "$SISTEM" ]; then echo "REFUZ: system_identifier al bazei ($REAL) <> --sistem ($SISTEM)" >&2; rm -rf "$TMP"; exit 22; fi
APLICATA="$(q -c "SELECT to_regprocedure('public.fn_raport_lucrari_proiect_garda()') IS NOT NULL")"
if [ "$VERIFICA" = 1 ]; then
  echo "verifica-bariera: 20261217a aplicata pe clona = $APLICATA (bariera nu depinde de ea)"
elif { [ "$ASTEPTAT" = inchis ] && [ "$APLICATA" != t ]; } || { [ "$ASTEPTAT" = defect ] && [ "$APLICATA" != f ]; }; then
  echo "REFUZ: 20261217a aplicata pe clona = $APLICATA, dar --asteptat $ASTEPTAT" >&2; rm -rf "$TMP"; exit 23
fi
if [ "$(q -c "SELECT to_regprocedure('public.fn_raport_rezumat_garda()') IS NOT NULL")" != t ]; then
  echo "REFUZ: 20261216a nu e aplicata pe clona (starea productiei)" >&2; rm -rf "$TMP"; exit 23
fi
if [ "$(q -c "SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = '$OWNER' AND is_owner IS TRUE)")" != t ]; then
  echo "REFUZ: owner-ul sintetic $OWNER lipseste de pe clona (sau nu e owner)" >&2; rm -rf "$TMP"; exit 24
fi
SITE="$(q -c "SELECT s.id FROM public.sites s WHERE s.proiect_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.rapoarte_zilnice r WHERE r.site_id = s.id AND r.rezumat_sursa = 'editat') ORDER BY s.id LIMIT 1")"
[[ "$SITE" =~ ^[0-9]+$ ]] || { echo "nu gasesc un santier cu proiect, fara rezumate corectate, pe clona" >&2; rm -rf "$TMP"; exit 24; }
P0="$(q -c "SELECT proiect_id FROM public.sites WHERE id = $SITE")"
P1="$(q -c "SELECT id FROM public.executie_proiecte WHERE id <> $P0 ORDER BY id LIMIT 1")"
[[ "$P1" =~ ^[0-9]+$ ]] || { echo "nu gasesc un al doilea proiect pe clona" >&2; rm -rf "$TMP"; exit 24; }
if [ "$(q -c "SELECT EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data BETWEEN DATE '2001-02-01' AND DATE '2001-02-06')")" != f ]; then
  echo "REFUZ: zilele de test 2001-02-01 ... 06 sunt ocupate pe santierul $SITE (nu sterg nimic)" >&2; rm -rf "$TMP"; exit 24
fi
if [ "$(q -c "SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'rlp17\\_%'")" != 0 ]; then
  echo "REFUZ: exista deja sesiuni rlp17_* pe clona (alta rulare a probei?)" >&2; rm -rf "$TMP"; exit 24
fi

ACT=""; ACT1=""; FN_ORIG=""
muta() { q -c "UPDATE public.sites SET proiect_id = $1 WHERE id = $SITE AND proiect_id IS DISTINCT FROM $1;" >/dev/null; }
curata() {
  local rc=0
  if [ -n "$FN_ORIG" ]; then
    if ! q -f "$TMP/garda_orig.sql" >/dev/null || [ "$(q -c "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_raport_lucrari_proiect_garda()'::regprocedure")" != "$FN_ORIG" ]; then
      echo "ATENTIE: fn_raport_lucrari_proiect_garda NU s-a putut pune la loc pe clona (definitia originala ramane in garda_orig_20261217a.sql)" >&2
      cp "$TMP/garda_orig.sql" ./garda_orig_20261217a.sql 2>/dev/null || true; rc=25
    else echo "mutant: functia garzii pusa la loc (amprenta $FN_ORIG)"; fi
  fi
  q -c "DELETE FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data BETWEEN DATE '2001-02-01' AND DATE '2001-02-06' AND probleme LIKE 'Proba linii proiect%';" >/dev/null \
    || echo "ATENTIE: de sters manual pe clona: rapoartele 2001-02-01 ... 06 ale santierului $SITE" >&2
  [ -z "$ACT" ] || q -c "DELETE FROM public.proiect_activitati WHERE id = $ACT AND nume = 'Activitate proba linii proiect';" >/dev/null \
    || echo "ATENTIE: de sters manual pe clona: activitatea $ACT" >&2
  [ -z "$ACT1" ] || q -c "DELETE FROM public.proiect_activitati WHERE id = $ACT1 AND nume = 'Activitate proba linii proiect (P1)';" >/dev/null \
    || echo "ATENTIE: de sters manual pe clona: activitatea $ACT1" >&2
  muta "$P0" || echo "ATENTIE: de pus la loc manual pe clona: santierul $SITE in proiectul $P0" >&2
  rm -rf "$TMP"
  return "$rc"
}
trap 'curata || exit 25' EXIT

ACT="$(q -c "INSERT INTO public.proiect_activitati (proiect_id, nume, um, tip_raportare, ordine, activ)
             VALUES ($P0, 'Activitate proba linii proiect', 'm', 'cantitate', 999, true) RETURNING id" | head -1)"
[[ "$ACT" =~ ^[0-9]+$ ]] || { echo "activitatea sintetica: iesire neasteptata: $ACT" >&2; ACT=""; exit 1; }
# L5 (r3): linia FĂRĂ activitate, dacă schema o permite; altfel cu o activitate SINTETICĂ a lui P1 (proiectul în care se mută șantierul).
#   În ambele forme, după mutare verificarea activității nu are ce refuza: doar comparația proiectului închide fereastra.
if [ "$(q -c "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'raport_lucrari' AND column_name = 'activitate_id'")" = YES ]; then
  ACT_L5=NULL
else
  ACT1="$(q -c "INSERT INTO public.proiect_activitati (proiect_id, nume, um, tip_raportare, ordine, activ)
                VALUES ($P1, 'Activitate proba linii proiect (P1)', 'm', 'cantitate', 999, true) RETURNING id" | head -1)"
  [[ "$ACT1" =~ ^[0-9]+$ ]] || { echo "activitatea sintetica P1: iesire neasteptata: $ACT1" >&2; ACT1=""; exit 1; }
  ACT_L5="$ACT1"
fi
# liniile salvării folosesc EXACT activitatea ținută de control (pasul 5 al RPC-ului o blochează FOR SHARE)
LINII="'[{\"activitate_id\": $ACT, \"unitate_id\": null, \"cantitate\": 2}]'::jsonb"
JWT="SELECT set_config('request.jwt.claim.sub', '$OWNER', true), set_config('request.jwt.claims', json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;"
FRAG='șantierul raportului e acum în alt proiect'

case "$MUTANT" in
  fara_comparatie|fara_verificare|fara_for_share)
    q -c "SELECT pg_get_functiondef('public.fn_raport_lucrari_proiect_garda()'::regprocedure) || ';'" > "$TMP/garda_orig.sql"
    FN_ORIG="$(q -c "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_raport_lucrari_proiect_garda()'::regprocedure")"
    # DIN2 / IN2: a doua înlocuire (fara_verificare: ambele IF-uri ale activității / obiectului; replace() le ia pe toate)
    DIN2='IF NEW.proiect_id IS DISTINCT FROM v_proiect THEN'; IN2="$DIN2"
    case "$MUTANT" in
      fara_comparatie) DIN='IF NEW.proiect_id IS DISTINCT FROM v_proiect THEN'; IN='IF false THEN' ;;
      fara_verificare) DIN='IF NEW.proiect_id IS DISTINCT FROM v_proiect THEN'; IN='IF false THEN'
                       DIN2='IF FOUND AND v_p IS DISTINCT FROM v_proiect THEN'; IN2='IF false THEN' ;;
      *) DIN='WHERE s.id = v_site FOR SHARE OF s;'; IN='WHERE s.id = v_site;' ;;
    esac
    q -c "DO \$m\$ DECLARE d text := pg_get_functiondef('public.fn_raport_lucrari_proiect_garda()'::regprocedure); BEGIN
            IF position('$DIN' IN d) = 0 OR position('$DIN2' IN d) = 0 THEN RAISE EXCEPTION 'mutantul nu gaseste textul de inlocuit'; END IF;
            EXECUTE replace(replace(d, '$DIN', '$IN'), '$DIN2', '$IN2'); END \$m\$;" >/dev/null
    echo "mutant $MUTANT aplicat pe clona" ;;
esac

# ── barierele: lock-uri consultative + așteptări OBSERVATE (pg_sleep doar ca pas de sondare, cel mult 20 s) ──
# așteaptă până când lock-ul consultativ $1 e ținut de altă sesiune
asteapta() {
  echo "DO \$b\$ DECLARE i int := 0; BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND objsubid = 1 AND granted) LOOP
      PERFORM pg_sleep(0.05); i := i + 1; IF i > 400 THEN RAISE EXCEPTION 'PROBA_NEFUNCTIONALA: bariera $1 nu a aparut in 20 s'; END IF; END LOOP; END \$b\$;"
}
# așteaptă până când lock-ul consultativ $1 nu mai e ținut de nimeni
asteapta_eliberarea() {
  echo "DO \$b\$ DECLARE i int := 0; BEGIN
    WHILE EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND objsubid = 1 AND granted) LOOP
      PERFORM pg_sleep(0.05); i := i + 1; IF i > 400 THEN RAISE EXCEPTION 'PROBA_NEFUNCTIONALA: bariera $1 nu s-a eliberat in 20 s'; END IF; END LOOP; END \$b\$;"
}
# așteaptă până când salvarea scenariului $1 (application_name rlp17_<scenariu>_s) stă într-o așteptare de LOCK al cărei blocant
#   e sesiunea care ține bariera controlului $2 (adică exact lock-ul activității ținut FOR UPDATE de control); tipărește marcajul „BARIERA tine”
asteapta_salvarea() {   # $1 = scenariu, $2 = bariera controlului
  echo "DO \$b\$ DECLARE i int := 0; v_c int; v_s int; v_l text; BEGIN
    LOOP
      v_c := NULL; v_s := NULL;
      -- r3: lista sesiunilor din pg_stat_activity e fixată la prima citire din tranzacție; o salvare conectată după ea n-ar apărea niciodată
      PERFORM pg_stat_clear_snapshot();
      SELECT l.pid INTO v_c FROM pg_locks l WHERE l.locktype = 'advisory' AND l.classid = 0 AND l.objid = $2 AND l.objsubid = 1 AND l.granted LIMIT 1;
      IF v_c IS NOT NULL THEN
        SELECT a.pid INTO v_s FROM pg_stat_activity a
         WHERE a.application_name = 'rlp17_$1_s' AND a.wait_event_type = 'Lock' AND v_c = ANY (pg_blocking_pids(a.pid)) LIMIT 1;
      END IF;
      EXIT WHEN v_s IS NOT NULL;
      i := i + 1;
      IF i > 400 THEN
        PERFORM pg_stat_clear_snapshot();
        SELECT string_agg(a.application_name || ' pid ' || a.pid || ' ' || coalesce(a.state, '-') || ' asteapta ' || coalesce(a.wait_event_type || ':' || a.wait_event, '-')
                          || ' blocata de ' || coalesce(nullif(array_to_string(pg_blocking_pids(a.pid), ','), ''), '-'), '; ' ORDER BY a.application_name)
          INTO v_l FROM pg_stat_activity a WHERE a.application_name LIKE 'rlp17\_$1\_%';
        RAISE EXCEPTION 'PROBA_NEFUNCTIONALA $1: in 20 s salvarea nu a fost vazuta asteptand lock-ul tinut de control (pid control %); sesiunile: %', v_c, coalesce(v_l, 'niciuna');
      END IF;
      PERFORM pg_sleep(0.05);
    END LOOP;
    SELECT string_agg(l.locktype || coalesce(' ' || l.relation::regclass::text, ''), ', ') INTO v_l FROM pg_locks l WHERE l.pid = v_s AND NOT l.granted;
    RAISE NOTICE '$1 BARIERA tine: salvarea (pid %) asteapta [%], blocata de control (pid %)', v_s, v_l, v_c;
  END \$b\$;"
}
NEFUNC=0; CONTRAR=0; DEFECT_VAZUT=0
verdict() {   # $1 = OK | CONTRAR | NEFUNCTIONAL, $2 = ce s-a văzut
  case "$1" in
    OK) echo "OK                  $2" ;;
    CONTRAR) echo "CONTRAR             $2"; CONTRAR=1 ;;
    *) echo "PROBA_NEFUNCTIONALA $2"; NEFUNC=1 ;;
  esac
}
# trei sesiuni: control (C), salvarea (S), mutarea / observatorul (M); codul de ieșire al fiecăreia se păstrează (wait PID)
ruleaza_trei() {   # $1 = scenariu; fișierele $TMP/$1_c.sql, $TMP/$1_s.sql, $TMP/$1_m.sql
  PGAPPNAME="rlp17_$1_c" "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_c.sql" > "$TMP/$1_c.log" 2>&1 & PID_C=$!
  PGAPPNAME="rlp17_$1_s" "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_s.sql" > "$TMP/$1_s.log" 2>&1 & PID_S=$!
  PGAPPNAME="rlp17_$1_m" "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_m.sql" > "$TMP/$1_m.log" 2>&1 & PID_M=$!
  set +e; wait $PID_C; RC_C=$?; wait $PID_S; RC_S=$?; wait $PID_M; RC_M=$?; set -e
  cat "$TMP/$1_c.log" "$TMP/$1_s.log" "$TMP/$1_m.log"
}
# controlul: ține activitatea FOR UPDATE, ia bariera C și eliberează activitatea DOAR după bariera M (luată de mutare după COMMIT)
control() {   # $1 = bariera controlului (C), $2 = bariera mutării (M)
  cat <<SQL
\set ON_ERROR_STOP 1
BEGIN;
SELECT 1 FROM public.proiect_activitati WHERE id = $ACT FOR UPDATE;
SELECT pg_advisory_lock($1);
$(asteapta "$2")
COMMIT;
SELECT pg_advisory_unlock($1);
SQL
}
# salvarea prin RPC-ul real; refuzul e prins și tipărit (sub-tranzacția salvării nu scrie nimic atunci). Proba NU anulează tranzacția
#   salvării (r1 o anula când „nu așteptase destul”): rezultatul se citește din NOTICE și din ce e comis.
salvare() {   # $1 = scenariu, $2 = bariera controlului, $3 = ziua, $4 = versiunea, $5 = COMMIT | ROLLBACK
  cat <<SQL
\set ON_ERROR_STOP 1
$(asteapta "$2")
BEGIN; $JWT
SET LOCAL lock_timeout = '20s';
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp(); r jsonb;
BEGIN
  BEGIN
    r := public.fn_raport_zilnic_salveaza($SITE, DATE '$3', '{"probleme": "Proba linii proiect $1"}'::jsonb, $LINII, NULL, $4, gen_random_uuid());
    RAISE NOTICE '$1 SALVARE rezultat % dupa %', r, clock_timestamp() - t0;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '$1 SALVARE refuz % (%) dupa %', SQLSTATE, SQLERRM, clock_timestamp() - t0;
  END;
END \$t\$;
$5;
SQL
}
# mutarea (sau doar observatorul, la --verifica-bariera): pornește când salvarea e văzută blocată de control; refuzul mutării (L4: 55P03)
#   e prins și tipărit; apoi bariera M pentru control, ținută până când controlul a eliberat bariera C
mutare() {   # $1 = scenariu, $2 = bariera controlului (C), $3 = bariera mutării (M), $4 = muta | fara_mutare
  local corp="-- fara mutare (doar bariera)"
  if [ "$4" = muta ]; then corp="BEGIN;
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp();
BEGIN
  BEGIN
    UPDATE public.sites SET proiect_id = $P1 WHERE id = $SITE;
    RAISE NOTICE '$1 MUTARE trecuta dupa %', clock_timestamp() - t0;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '$1 MUTARE refuz % (%) dupa %', SQLSTATE, SQLERRM, clock_timestamp() - t0;
  END;
END \$t\$;
COMMIT;"; fi
  cat <<SQL
\set ON_ERROR_STOP 1
$(asteapta_salvarea "$1" "$2")
$corp
SELECT pg_advisory_lock($3);
$(asteapta_eliberarea "$2")
SELECT pg_advisory_unlock($3);
SQL
}
zi_raport() { q -c "SELECT coalesce((SELECT id::text FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data = DATE '$1'), '-')"; }
proiecte_linii() { q -c "SELECT coalesce((SELECT string_agg(DISTINCT l.proiect_id::text, ',') FROM public.raport_lucrari l JOIN public.rapoarte_zilnice z ON z.id = l.raport_id
                                            WHERE z.site_id = $SITE AND z.data = DATE '$1'), '-')"; }
proiect_santier() { q -c "SELECT proiect_id FROM public.sites WHERE id = $SITE"; }
raport_sintetic() {   # $1 = ziua; raport cu rezumat automat pe proiectul de acum (garda), comis
  q -c "INSERT INTO public.rapoarte_zilnice (site_id, data, probleme, created_by, updated_at)
        VALUES ($SITE, DATE '$1', 'Proba linii proiect (existent)', '$OWNER', now());" >/dev/null
}
versiune() { q -c "SELECT versiune_salvare FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data = DATE '$1'"; }

# ── --verifica-bariera: doar bariera (control + salvarea anulată + observatorul), fără mutare, nimic comis ──
if [ "$VERIFICA" = 1 ]; then
  control 172170001 172170002 > "$TMP/B0_c.sql"
  salvare B0 172170001 2001-02-01 0 ROLLBACK > "$TMP/B0_s.sql"
  mutare B0 172170001 172170002 fara_mutare > "$TMP/B0_m.sql"
  ruleaza_trei B0
  Z="$(zi_raport 2001-02-01)"
  if [ "$RC_C$RC_S$RC_M" = 000 ] && grep -q "B0 BARIERA tine" "$TMP/B0_m.log" && grep -q "B0 SALVARE " "$TMP/B0_s.log" && [ "$Z" = "-" ]; then
    echo "BARIERA OK: salvarea a stat la lock-ul activitatii tinut de control (vezi marcajul 'B0 BARIERA tine'), apoi a continuat; nimic comis"
    exit 0
  fi
  echo "PROBA NEFUNCTIONALA: bariera nu a tinut (iesiri control $RC_C, salvare $RC_S, observator $RC_M; raport ramas '$Z')"
  exit 26
fi

# ── L0: salvare normală, fără mutare: trece, fără așteptare ──
if [ -z "$MUTANT" ]; then
cat > "$TMP/l0.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN; $JWT
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp(); r jsonb;
BEGIN
  r := public.fn_raport_zilnic_salveaza($SITE, DATE '2001-02-05', '{"probleme": "Proba linii proiect L0"}'::jsonb, $LINII, NULL, 0, gen_random_uuid());
  IF r ->> 'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FAIL L0: %', r; END IF;
  IF clock_timestamp() - t0 >= interval '1 second' THEN RAISE EXCEPTION 'FAIL L0: salvarea normala a asteptat (%)', clock_timestamp() - t0; END IF;
  RAISE NOTICE 'L0 salvare normala: % in %', r, clock_timestamp() - t0;
END \$t\$;
COMMIT;
SQL
set +e; "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/l0.sql" > "$TMP/l0.log" 2>&1; RC=$?; set -e
cat "$TMP/l0.log"
L="$(proiecte_linii 2001-02-05)"
if [ "$RC" = 0 ] && [ "$L" = "$P0" ]; then R=OK; else R=CONTRAR; fi
verdict "$R" "L0 salvare normala (fara mutare): iesire $RC, liniile pe '$L' (asteptat '$P0')"
fi

# ── L1 / L2: salvarea în fereastră, mutarea comisă între citirea proiectului și scrierea antetului ──
fereastra() {   # $1 = scenariu, $2 = ziua, $3 = versiunea, $4 $5 = barierele C / M, $6 = rezultatul cerut (implicit --asteptat)
  local ast="${6:-$ASTEPTAT}"
  control "$4" "$5" > "$TMP/$1_c.sql"
  salvare "$1" "$4" "$2" "$3" COMMIT > "$TMP/$1_s.sql"
  mutare "$1" "$4" "$5" muta > "$TMP/$1_m.sql"
  ruleaza_trei "$1"
  local santier linii zi fapt txt; santier="$(proiect_santier)"; linii="$(proiecte_linii "$2")"; zi="$(zi_raport "$2")"
  if [ "$RC_C$RC_S$RC_M" != 000 ] || ! grep -q "$1 BARIERA tine" "$TMP/$1_m.log" || ! grep -q "$1 MUTARE trecuta" "$TMP/$1_m.log" || [ "$santier" != "$P1" ]; then
    verdict NEFUNCTIONAL "$1: fereastra NU s-a deschis (bariera / mutarea; iesiri control $RC_C, salvare $RC_S, mutare $RC_M; santierul in P$santier) - rezultatul salvarii nu se judeca"
    muta "$P0"; return 0
  fi
  if grep -qF "$1 SALVARE rezultat {\"ok\": true" "$TMP/$1_s.log" && [ "$linii" = "$P0" ]; then
    fapt=defect; txt="DEFECT reprodus: salvarea a trecut cu liniile pe P$linii, santierul mutat in P$santier in fereastra"
  elif grep -q "$1 SALVARE refuz 22023" "$TMP/$1_s.log" && grep -qF "$FRAG" "$TMP/$1_s.log" && [ "$linii" = "-" ] && { [ "$1" != L1 ] || [ "$zi" = "-" ]; }; then
    fapt=inchis; txt="FEREASTRA INCHISA: salvarea refuzata 22023, nimic scris (raport '$zi', linii '$linii'), santierul in P$santier"
  elif grep -q "$1 SALVARE refuz 22023" "$TMP/$1_s.log" && grep -qF "nu e a proiectului șantierului raportului" "$TMP/$1_s.log" && [ "$linii" = "-" ] \
       && { [ "$1" != L1 ] || [ "$zi" = "-" ]; }; then
    # r3: refuzul vine din verificarea activității din gardă (proiectul citit sub lock), nu din comparație — așteptat DOAR cu fara_comparatie
    fapt=inchis_activitate; txt="FEREASTRA INCHISA de verificarea activitatii (garda, proiectul citit sub lock): refuz 22023, nimic scris (raport '$zi', linii '$linii'), santierul in P$santier"
  else
    fapt=altceva; txt="rezultat neclasificat (raport '$zi', linii '$linii', santierul in P$santier; vezi NOTICE-ul salvarii)"
  fi
  [ "$fapt" != defect ] || DEFECT_VAZUT=1
  if [ "$fapt" = "$ast" ]; then verdict OK "$1 $txt (asteptat: $ast)"; else verdict CONTRAR "$1 $txt (asteptat: $ast)"; fi
  muta "$P0"
}
case "$MUTANT" in
  "") fereastra L1 2001-02-01 0 172170011 172170012 ;;
  fara_comparatie) fereastra L1 2001-02-01 0 172170011 172170012 inchis_activitate ;;   # redundanța de pe calea RPC
  fara_verificare) fereastra L1 2001-02-01 0 172170011 172170012 defect ;;              # fără ambele verificări: defectul revine
esac
if [ -z "$MUTANT" ]; then
  raport_sintetic 2001-02-02; muta "$P1"; muta "$P0"   # automat pe P0 -> mutarea îl trece în 'de_recompus' -> înapoi în P0 (nu-l mai atinge)
  if [ "$(q -c "SELECT rezumat_sursa FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data = DATE '2001-02-02'")" != de_recompus ]; then
    verdict NEFUNCTIONAL "L2: raportul de plecare nu e 'de_recompus'"
  else
    fereastra L2 2001-02-02 "$(versiune 2001-02-02)" 172170021 172170022
  fi
fi

# ── L3 / L5: calea directă (INSERT ca postgres, fără RPC) în timpul unei mutări în zbor ──
# Mutarea ține rândul șantierului (UPDATE necomis) + bariera W; scrierea pornește după W. Mutarea COMITE abia când vede scrierea fie
#   blocată de ea (pg_blocking_pids; 20261217a: FOR SHARE pe șantier), fie terminată (bariera D, luată de scriere după încercare):
#   ordinea e garantată de lock-uri, nu de timp. L3: linia cu activitatea sintetică (a lui P0); L5 (r3): linia FĂRĂ activitate.
# Rezultatul (r3): DEFECT = scrierea a trecut și linia e pe P0 cu șantierul în P1 (cu sau fără așteptare: fara_comparatie așteaptă
#   mutarea, apoi trece; fara_for_share și starea de dinainte trec fără să aștepte); INCHIS = a așteptat mutarea, apoi refuz 22023.
directa() {   # $1 = scenariu, $2 = ziua, $3 = activitatea (id sau NULL), $4 $5 = barierele W / D, $6 = rezultatul cerut (implicit --asteptat)
  local sc="$1" zi="$2" act="$3" bw="$4" bd="$5" ast="${6:-$ASTEPTAT}" z l s fapt txt astept
  raport_sintetic "$zi"; muta "$P1"; muta "$P0"   # raport 'de_recompus': mutarea nu-i ia rândul (doar șantierul o poate opri)
  z="$(zi_raport "$zi")"
  cat > "$TMP/${sc}_m.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN;
UPDATE public.sites SET proiect_id = $P1 WHERE id = $SITE;
SELECT pg_advisory_xact_lock($bw);
DO \$b\$ DECLARE i int := 0; v_w int; BEGIN
  LOOP
    PERFORM pg_stat_clear_snapshot();   -- r3: lista sesiunilor reluată la fiecare pas (scrierea se poate conecta după prima citire)
    SELECT a.pid INTO v_w FROM pg_stat_activity a
     WHERE a.application_name = 'rlp17_${sc}_w' AND a.wait_event_type = 'Lock' AND pg_backend_pid() = ANY (pg_blocking_pids(a.pid)) LIMIT 1;
    IF v_w IS NOT NULL THEN RAISE NOTICE '$sc BARIERA scrierea directa (pid %) asteapta mutarea in zbor', v_w; EXIT; END IF;
    IF EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $bd AND objsubid = 1 AND granted) THEN
      RAISE NOTICE '$sc BARIERA scrierea directa a terminat fara sa astepte mutarea in zbor'; EXIT;
    END IF;
    i := i + 1;
    IF i > 400 THEN RAISE EXCEPTION 'PROBA_NEFUNCTIONALA $sc: in 20 s scrierea directa nici n-a asteptat mutarea, nici n-a terminat'; END IF;
    PERFORM pg_sleep(0.05);
  END LOOP;
END \$b\$;
COMMIT;
SQL
  cat > "$TMP/${sc}_w.sql" <<SQL
\set ON_ERROR_STOP 1
$(asteapta "$bw")
BEGIN;
SET LOCAL lock_timeout = '20s';
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp();
BEGIN
  BEGIN
    INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, cantitate) VALUES ($z, $P0, $act, 1);
    RAISE NOTICE '$sc DIRECT trecuta dupa %', clock_timestamp() - t0;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '$sc DIRECT refuz % (%) dupa %', SQLSTATE, SQLERRM, clock_timestamp() - t0;
  END;
END \$t\$;
SELECT pg_advisory_lock($bd);
COMMIT;
$(asteapta_eliberarea "$bw")
SELECT pg_advisory_unlock($bd);
SQL
  PGAPPNAME="rlp17_${sc}_m" "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/${sc}_m.sql" > "$TMP/${sc}_m.log" 2>&1 & PID_M=$!
  PGAPPNAME="rlp17_${sc}_w" "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/${sc}_w.sql" > "$TMP/${sc}_w.log" 2>&1 & PID_W=$!
  set +e; wait $PID_M; RC_M=$?; wait $PID_W; RC_W=$?; set -e
  cat "$TMP/${sc}_m.log" "$TMP/${sc}_w.log"
  l="$(proiecte_linii "$zi")"; s="$(proiect_santier)"
  if [ "$RC_M$RC_W" != 00 ] || ! grep -q "$sc BARIERA" "$TMP/${sc}_m.log" || [ "$s" != "$P1" ]; then
    verdict NEFUNCTIONAL "$sc: mutarea in zbor nu s-a putut observa / comite (iesiri mutare $RC_M, scriere $RC_W; santierul in P$s) - rezultatul scrierii nu se judeca"
  elif grep -Eq "$sc DIRECT refuz (23502|23514) " "$TMP/${sc}_w.log"; then
    verdict NEFUNCTIONAL "$sc: schema clonei nu primeste linia de proba (NOT NULL / CHECK; vezi NOTICE-ul scrierii) - rezultatul nu se judeca"
  else
    if grep -q "$sc BARIERA scrierea directa (pid" "$TMP/${sc}_m.log"; then astept="dupa ce a asteptat mutarea"; else astept="fara asteptare"; fi
    if grep -q "$sc DIRECT trecuta" "$TMP/${sc}_w.log" && [ "$l" = "$P0" ]; then
      fapt=defect; txt="DEFECT reprodus pe calea directa: linia pe P$l scrisa $astept, santierul mutat in P$s"
    elif grep -q "$sc BARIERA scrierea directa (pid" "$TMP/${sc}_m.log" && grep -q "$sc DIRECT refuz 22023" "$TMP/${sc}_w.log" \
         && grep -qF "$FRAG" "$TMP/${sc}_w.log" && [ "$l" = "-" ]; then
      fapt=inchis; txt="FEREASTRA INCHISA pe calea directa: scrierea a asteptat mutarea, apoi refuz 22023 (linii '$l')"
    else
      fapt=altceva; txt="rezultat neclasificat pe calea directa (linii '$l', scrierea $astept; vezi NOTICE-urile)"
    fi
    [ "$fapt" != defect ] || DEFECT_VAZUT=1
    if [ "$fapt" = "$ast" ]; then verdict OK "$sc $txt (asteptat: $ast)"; else verdict CONTRAR "$sc $txt (asteptat: $ast)"; fi
  fi
  muta "$P0"
}
case "$MUTANT" in
  "") directa L3 2001-02-03 "$ACT" 172170031 172170032
      directa L5 2001-02-06 "$ACT_L5" 172170051 172170052 ;;
  fara_for_share) directa L3 2001-02-03 "$ACT" 172170031 172170032 defect ;;
  fara_comparatie) directa L5 2001-02-06 "$ACT_L5" 172170051 172170052 defect ;;   # doar comparația vede linia L5
esac

# ── L4: raport existent CU rezumat automat, salvarea în fereastră + mutarea: mutarea refuză imediat (NOWAIT), salvarea trece ──
if [ -z "$MUTANT" ]; then
  raport_sintetic 2001-02-04
  control 172170041 172170042 > "$TMP/L4_c.sql"
  salvare L4 172170041 2001-02-04 "$(versiune 2001-02-04)" COMMIT > "$TMP/L4_s.sql"
  mutare L4 172170041 172170042 muta > "$TMP/L4_m.sql"
  ruleaza_trei L4
  L="$(proiecte_linii 2001-02-04)"; S="$(proiect_santier)"
  if [ "$RC_C$RC_S$RC_M" != 000 ] || ! grep -q "L4 BARIERA tine" "$TMP/L4_m.log"; then
    verdict NEFUNCTIONAL "L4: fereastra NU s-a deschis (iesiri control $RC_C, salvare $RC_S, mutare $RC_M) - rezultatul nu se judeca"
  else
    if grep -q "L4 MUTARE refuz 55P03" "$TMP/L4_m.log" && grep -qF "L4 SALVARE rezultat {\"ok\": true" "$TMP/L4_s.log" \
       && [ "$L" = "$P0" ] && [ "$S" = "$P0" ]; then R=OK; else R=CONTRAR; fi
    # mutarea trebuie să fi refuzat IMEDIAT (fără deadlock / fără așteptare)
    if grep -Eq "L4 MUTARE refuz 55P03 .* dupa 00:00:0[1-9]" "$TMP/L4_m.log"; then R=CONTRAR; fi
    verdict "$R" "L4 salvare in fereastra pe raport cu rezumat + mutare: mutarea refuza imediat 55P03, salvarea trece (linii '$L', santierul P$S)"
  fi
  muta "$P0"
fi

if [ "$NEFUNC" = 1 ]; then
  echo "PROBA NEFUNCTIONALA: cel putin un scenariu nu a deschis fereastra; nimic din aceasta rulare nu e dovada (nici defect, nici fereastra inchisa)"
  exit 26
fi
if [ -n "$MUTANT" ]; then
  if [ "$DEFECT_VAZUT" = 1 ] && [ "$CONTRAR" = 0 ]; then echo "MUTANT $MUTANT PRINS"; exit 0; fi
  if [ "$DEFECT_VAZUT" = 1 ]; then echo "MUTANT $MUTANT: defectul aratat, dar un scenariu e CONTRAR asteptarii lui (vezi randurile CONTRAR)"; exit 1; fi
  echo "MUTANT $MUTANT SCAPAT (scenariul-tinta nu a aratat defectul cu functia stricata)"; exit 1
fi
if [ "$CONTRAR" = 0 ]; then echo "TOATE SCENARIILE OK (--asteptat $ASTEPTAT)"; exit 0; fi
echo "REZULTAT CONTRAR asteptarii (--asteptat $ASTEPTAT): vezi randurile CONTRAR"
exit 1
