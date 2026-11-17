#!/usr/bin/env bash
# Proba de CONCURENTA LA APLICARE pentru migrarile L15 v2 cu buget de lock (runda 17, verdictul Jakarinos pe PR #1115: P2 + lista
# coordonatorului, punctele 4-7) - DOAR pe CLONA, cu migrarea NEAPLICATA. Fiecare aplicare e PROBA cu ROLLBACK a generatorului de manifest
# (scripts/livrare_l15_manifest.sh --compara-cu, forma livrarii, plafonul L15) => NIMIC comis (DDL, istoric, bucket); doar valorile de
# secventa consumate nu se anuleaza. NETESTAT local (serverul de cod nu are PostgreSQL): il ruleaza coordonatorul.
# Rulare (Git Bash sau WSL; parola din pgpass, niciodata pe linia de comanda):
#   PSQL=/c/Users/Public/pgsql/bin/psql.exe bash supabase/tests/l15_aplicare_concurenta.sh --migrare uscare --sistem <SIS clona> \
#     --host <H> --port <P> --user postgres --db postgres \
#     --manifest <dosar regenerat>/20261225a_executie_uscare.l15.tsv --amprenta-globala <GLOBAL al clonei>
#   (--migrare meteo: 20261221a, relatia blocata = public.sites, manifestul 20261221a_meteo_xweather_zilnic.l15.tsv)
#   (--migrare fan: 20261212a, PR #1118 runda 4; setul blocat = red_proiecte -> red_loturi_plicuire -> red_plicuri, SHARE ROW EXCLUSIVE NOWAIT;
#    manifestul 20261212a_redari_fan_awb.l15.tsv; H = o SCRIERE in curs pe red_plicuri (ROW EXCLUSIVE). Profil ADITIV: uscare / meteo neschimbate.)
# Sesiunea H tine lock-ul intr-o tranzactie (application_name tine_l15_conc) si face ROLLBACK; proba are application_name proba_l15_conc;
# bariera = lock-ul lui H acordat (pg_locks); PID-urile se asteapta cu wait, codurile de iesire se pastreaza (L25).
# SCENARII si REZULTATE ASTEPTATE:
#   I   inventarul (doar citire, tiparit pentru revizuire): triggerele non-interne, constrangerile si politicile de pe storage.buckets /
#       storage.objects (uscare) sau public.sites (meteo) - lock-urile IMPLICITE ale corpului (INSERT INTO storage.buckets dupa
#       ACCESS EXCLUSIVE pe storage.objects; verificarea de unicitate; triggerele platformei) sunt in docs/LIVRARE_L15_V2.md §9.
#   L0  control, fara concurenta: cod 0, IDENTIC; „lock la … (1 incercari, Y ms de la prima incercare)” cu Y < 100.
#   L1  relatia principala tinuta permanent (ACCESS SHARE, 6 s; incompatibil cu ACCESS EXCLUSIVE / SHARE ROW EXCLUSIVE): cod 1, BUGET_LOCK
#       la 900..1500 ms de la prima incercare, proba terminata INAINTE ca H sa elibereze (fara asteptare pana la eliberare), nimic comis.
#       Uscare: un observator doar-citire (alta sesiune, la ~30 ms) NU vede proba tinand SHARE ROW EXCLUSIVE pe executie_proiecte /
#       executie_probe_tronsoane in mai mult de 2 esantioane (lock-urile partiale se elibereaza intre incercari) si vede proba activa in
#       cel putin 10 esantioane (observatorul chiar a prins intervalul).
#   L2  relatia principala tinuta pana la ~400 ms dupa sfarsitul pasului „inainte” al probei (momentul din L0), apoi eliberata: cod 0,
#       IDENTIC; „lock la …” cu k >= 2 incercari si Y < 1000 ms de la prima incercare.
#   B1  (uscare) storage.buckets tinut SHARE 6 s (incompatibil cu ROW EXCLUSIVE al INSERT-ului din corp): cod 1, „lock timeout” (lock_timeout
#       = 100 ms al migrarii), NU BUGET_LOCK (setul explicit a fost obtinut), proba terminata inainte ca H sa elibereze, nimic comis.
#   B2  (uscare, runda 18) coliziunea de UNICITATE pe bucket: H are un INSERT INTO storage.buckets NECOMIS cu acelasi id ('executie-uscare'),
#       fara LOCK pe relatie (H tine pe storage.buckets doar ROW EXCLUSIVE, compatibil cu INSERT-ul migrarii; verificat la bariera) => INSERT-ul migrarii asteapta
#       tranzactia lui H la verificarea cheii unice: cod 1, „lock timeout” (100 ms), NU BUGET_LOCK, fara asteptare pana la ROLLBACK-ul lui H,
#       nimic comis. Distinct de B1 (acolo asteptarea e pe RELATIE; aici pe TRANZACTIA concurenta). H scrie ca postgres, cu coloanele din
#       INSERT-ul migrarii, si face ROLLBACK.
#   FAN (--migrare fan, 20261212a; H tine red_plicuri in ROW EXCLUSIVE = o scriere Redari in curs; SHARE ROW EXCLUSIVE al migrarii o asteapta):
#     L0  ca mai sus: cod 0, IDENTIC, 1 incercare, Y < 100 ms.
#     L1  red_plicuri tinut 6 s: cod 1, BUGET_LOCK la 900..1500 ms, H inca activ, nimic comis. CAT APLICAREA ASTEAPTA (doi observatori, ~30 ms):
#         (a) doar-citire: proba tine SHARE ROW EXCLUSIVE pe red_proiecte / red_loturi_plicuire in cel mult 2 esantioane (lock-urile partiale se
#         elibereaza intre incercari), proba activa in >= 10 esantioane; (b) L1b: un SCRIITOR pe red_proiecte + red_loturi_plicuire (LOCK ROW
#         EXCLUSIVE, lock_timeout 50 ms, ROLLBACK la fiecare esantion) blocat in cel mult 2 din 80 de esantioane, iar citirea lui red_plicuri
#         (tabelul tinut de H) reuseste in toate cele 80 => aplicarea care asteapta nu opreste nici citirile, nici scrierile Redari.
#     L2  red_plicuri eliberat la ~400 ms dupa pasul „inainte”: cod 0, IDENTIC, k >= 2 incercari, Y < 1000 ms.
#     F1  CAT APLICAREA TINE LOCK-UL (fara H): un cititor si un scriitor pornesc INAINTEA probei si asteapta (bariera din pg_locks) momentul in
#         care proba tine SHARE ROW EXCLUSIVE pe red_plicuri; atunci: cititorul citeste red_proiecte / red_loturi_plicuire / red_plicuri in
#         < 200 ms, cu lock-ul inca tinut de proba (tinut=t) => citirile nu sunt oprite; scriitorul (LOCK red_plicuri ROW EXCLUSIVE,
#         lock_timeout 6 s) primeste lock-ul abia DUPA ce proba l-a eliberat (tinut_dupa=f), in < 5500 ms (plafonul 5000 + marja) => scrierile
#         Redari asteapta cel mult cat tine aplicarea; proba: cod 0, IDENTIC (ROLLBACK). Ambele procese: cod 0.
#     (B1 / B2 sunt doar pentru uscare.)
#   Dupa fiecare scenariu: migrarea tot neaplicata (tabel / bucket / politici absente), H iesit cu 0, niciun backend al probei ramas.
# LIMITA OBSERVATORULUI (L1): esantionarea la ~30 ms (80 de esantioane) e o DOVADA, nu o demonstratie: un lock partial tinut mai putin decat
#   intervalul dintre doua esantioane poate scapa; pragul „cel mult 2 esantioane cu lock partial” arata ca lock-urile partiale nu raman tinute
#   intre incercari, nu ca nu exista niciodata. Absenta lor rezulta din constructie (subtranzactia fiecarei incercari, anulata la esec).
# MESAJELE BUGET_LOCK (runda 18): formele asteptate sunt cele din migrarea aleasa (uscare: „BUGET_LOCK: N incercari, …”, meteo:
#   „BUGET_LOCK: sites ocupat; N incercari, …”, plus forma „… abia la X ms …”); scriptul verifica la pornire ca ambele sunt in fisierul
#   migrarii (altfel refuz 2: proba nu ar mai recunoaste refuzul corect).
# CURATENIA (runda 18): la orice iesire (eroare la bariera, set -e, semnal) trap-ul opreste procesele pornite de script (H, observatorul),
#   inchide pe tinta backend-urile lor si ale probei (pg_terminate_backend pe application_name) si le asteapta (wait); codul de iesire se
#   pastreaza (L25).
# Iesire: 0 = toate OK; 1 = un scenariu a picat; 2 = argumente; 22 = alta tinta; 23 = migrarea pare aplicata.
set -euo pipefail
PSQL="${PSQL:-psql}"
export PGCLIENTENCODING=UTF8
TIP="" SISTEM="" H="" P="" U="" D="" MAN="" AG=""
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || { echo "optiunea $1 fara valoare" >&2; exit 2; }
  case "$1" in
    --migrare) TIP="$2" ;; --sistem) SISTEM="$2" ;; --host) H="$2" ;; --port) P="$2" ;; --user) U="$2" ;; --db) D="$2" ;;
    --manifest) MAN="$2" ;; --amprenta-globala) AG="$2" ;;
    *) echo "argument necunoscut: $1" >&2; exit 2 ;;
  esac
  shift 2
done
# REL = relatia blocata de migrare in blocul de lock; HMOD / HLOCK = modul in care o tine H (un cititor pe storage.objects, care opreste
# ACCESS EXCLUSIVE; o scriere in curs pe sites, care opreste SHARE ROW EXCLUSIVE - ACCESS SHARE NU l-ar opri)
case "$TIP" in
  uscare) NUME=20261225a_executie_uscare; VERS=20261225120000; REL=storage.objects; HMOD='ACCESS SHARE'; HLOCK=AccessShareLock
          ABSENT="to_regclass('public.executie_uscari') IS NULL AND NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'executie-uscare')
                  AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'executie\\_uscare\\_%')"
          # mesajele BUGET_LOCK ale migrarii (textul exact din RAISE, verificat mai jos in fisier) si regex-urile de extragere (ms de la prima incercare)
          BL_FMT_A='BUGET_LOCK: % incercari, % ms de la prima incercare'
          BL_FMT_B='BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari;'
          BL_RX_A='BUGET_LOCK: ([0-9]+) incercari, ([0-9]+) ms de la prima incercare'
          BL_RX_B='BUGET_LOCK: lock-urile obtinute abia la ([0-9]+) ms de la prima incercare \(([0-9]+) incercari;' ;;
  meteo)  NUME=20261221a_meteo_xweather_zilnic; VERS=20261221120000; REL=public.sites; HMOD='ROW EXCLUSIVE'; HLOCK=RowExclusiveLock
          ABSENT="to_regclass('public.meteo_zilnic_xweather') IS NULL"
          BL_FMT_A='BUGET_LOCK: sites ocupat; % incercari, % ms de la prima incercare'
          BL_FMT_B='BUGET_LOCK: lock-ul pe sites obtinut abia la % ms de la prima incercare (% incercari;'
          BL_RX_A='BUGET_LOCK: sites ocupat; ([0-9]+) incercari, ([0-9]+) ms de la prima incercare'
          BL_RX_B='BUGET_LOCK: lock-ul pe sites obtinut abia la ([0-9]+) ms de la prima incercare \(([0-9]+) incercari;' ;;
  # runda 4 a PR #1118 (aditiv): FAN Courier pe Redari; mesajele BUGET_LOCK au aceeasi forma ca la uscare (verificate mai jos in fisier)
  fan)    NUME=20261212a_redari_fan_awb; VERS=20261212120000; REL=public.red_plicuri; HMOD='ROW EXCLUSIVE'; HLOCK=RowExclusiveLock
          ABSENT="to_regclass('public.red_fan_awb') IS NULL AND to_regclass('public.red_fan_loturi') IS NULL AND to_regclass('public.red_fan_setari') IS NULL
                  AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'fn\\_red\\_fan\\_%')"
          BL_FMT_A='BUGET_LOCK: % incercari, % ms de la prima incercare'
          BL_FMT_B='BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari;'
          BL_RX_A='BUGET_LOCK: ([0-9]+) incercari, ([0-9]+) ms de la prima incercare'
          BL_RX_B='BUGET_LOCK: lock-urile obtinute abia la ([0-9]+) ms de la prima incercare \(([0-9]+) incercari;' ;;
  *) echo "--migrare uscare|meteo|fan" >&2; exit 2 ;;
esac
[[ "$SISTEM" =~ ^[0-9]+$ ]] && [ -n "$H" ] && [[ "$P" =~ ^[0-9]+$ ]] && [ -n "$U" ] && [ -n "$D" ] && [ -f "$MAN" ] && [[ "$AG" =~ ^[0-9a-f]{32}$ ]] \
  || { echo "argumente: --migrare uscare|meteo|fan --sistem --host --port --user --db --manifest <fisier> --amprenta-globala <md5>" >&2; exit 2; }
[ "$(basename "$MAN")" = "$NUME.l15.tsv" ] || { echo "--manifest: fisierul $NUME.l15.tsv" >&2; exit 2; }
MAN="$(cd "$(dirname "$MAN")" && pwd)/$(basename "$MAN")"
cd "$(dirname "$0")/../.."
MIG="supabase/migrations/$NUME.sql"
# runda 18: mesajele BUGET_LOCK pe care le recunoaste proba = textul din RAISE-urile migrarii (altfel L1 ar pica si la refuzul corect)
for f in "$BL_FMT_A" "$BL_FMT_B"; do
  [ "$(grep -cF "'${NUME:0:9}: $f" "$MIG")" = 1 ] || { echo "REFUZ: mesajul „${NUME:0:9}: $f” nu apare exact o data in $MIG - actualizati proba" >&2; exit 2; }
done
CONN=(-h "$H" -p "$P" -U "$U" -d "$D")
APP=proba_l15_conc; APP_H=tine_l15_conc; APP_O=obs_l15_conc
PIDS=(); TINTA_OK=0
TMP="$(mktemp -d ./.l15_aplicare_concurenta.XXXXXX)"
# runda 18 (P2-2): la ORICE iesire - procesele pornite de script (H, observatorul) oprite si asteptate, backend-urile lor si ale probei
# inchise pe tinta (doar dupa ce tinta a fost verificata: system_identifier), fara tranzactii lasate deschise; codul de iesire pastrat.
curatenie() {
  local rc=$? p
  trap - EXIT INT TERM
  for p in "${PIDS[@]+"${PIDS[@]}"}"; do kill "$p" 2>/dev/null || true; done
  if [ "$TINTA_OK" = 1 ]; then
    "$PSQL" -X -q -At "${CONN[@]}" -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity
        WHERE application_name IN ('$APP_H', '$APP_O', '$APP') AND pid <> pg_backend_pid()" >/dev/null 2>&1 \
      || echo "AVERTISMENT curatenie: backend-urile $APP_H / $APP_O / $APP nu au putut fi inchise pe tinta - verificati pg_stat_activity" >&2
  fi
  for p in "${PIDS[@]+"${PIDS[@]}"}"; do wait "$p" 2>/dev/null || true; done
  rm -rf "$TMP"
  exit "$rc"
}
trap curatenie EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# un proces asteptat iese din lista (fara kill pe un PID refolosit)
gata_pid() { local p r=(); for p in "${PIDS[@]+"${PIDS[@]}"}"; do [ "$p" = "$1" ] || r+=("$p"); done; PIDS=("${r[@]+"${r[@]}"}"); }
q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -c "$1"; }
REAL="$(q "SELECT system_identifier FROM pg_control_system()")"
[ "$REAL" = "$SISTEM" ] || { echo "REFUZ: system_identifier al bazei ($REAL) <> --sistem ($SISTEM)" >&2; exit 22; }
TINTA_OK=1
[ "$(q "SELECT $ABSENT")" = t ] || { echo "REFUZ: $NUME pare aplicata - proba cere migrarea NEAPLICATA" >&2; exit 23; }
ESEC=0
verdict() { if [ "$1" = 0 ]; then echo "OK   $2"; else echo "FAIL $2"; ESEC=1; fi; }
ms() { date +%s%3N; }
# proba cu ROLLBACK (forma livrarii L15 v2, plafonul AG_PLAFON_MS); $1 = jurnal; seteaza RC_P si MS_P (durata, ms)
proba() {
  local t0 t1; RC_P=0; t0="$(ms)"
  PGAPPNAME="$APP" PSQL_BIN="$PSQL" bash scripts/livrare_l15_manifest.sh --migrare "$MIG" --versiune "$VERS" \
    --tinta-host "$H" --tinta-port "$P" --tinta-db "$D" --tinta-sistem "$SISTEM" --user "$U" --plafon-tranzactie-ms 5000 \
    --compara-cu "$MAN" --amprenta-globala "$AG" >"$1" 2>&1 || RC_P=$?
  t1="$(ms)"; MS_P=$((t1 - t0))
}
# dupa fiecare scenariu: nimic comis, niciun backend al probei ramas
curat() { [ "$(q "SELECT ($ABSENT) AND NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '$APP')")" = t ]; }
# sesiunea H: $1 relatia, $2 modul SQL, $3 corpul de dupa LOCK (asteptarea), in fundal; bariera: lock-ul lui H acordat ($4 = modul din pg_locks)
tine() {
  printf '%s\n' "\\set ON_ERROR_STOP 1" "BEGIN;" "SET LOCAL application_name = '$APP_H';" "LOCK TABLE $1 IN $2 MODE;" "$3" "ROLLBACK;" >"$TMP/tine.sql"
  "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/tine.sql" >"$TMP/tine.log" 2>&1 &
  PID_H=$!; PIDS+=("$PID_H")
  q "DO \$b\$ DECLARE i int := 0; BEGIN
       LOOP
         PERFORM pg_stat_clear_snapshot();
         EXIT WHEN EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = '$APP_H'
                             AND l.relation = '$1'::regclass AND l.mode = '$4' AND l.granted);
         PERFORM pg_sleep(0.02); i := i + 1;
         IF i > 500 THEN RAISE EXCEPTION 'bariera: lock-ul lui H pe $1 nu a aparut'; END IF;
       END LOOP; END \$b\$;" >/dev/null
}
h_activ() { [ "$(q "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '$APP_H')")" = t ]; }
# RC_H = codul de iesire al lui H (wait; fara iesire din script la set -e)
astept_h() { RC_H=0; wait "$PID_H" || RC_H=$?; gata_pid "$PID_H"; [ "$RC_H" = 0 ] || cat "$TMP/tine.log"; }
# extragerea timpului din refuzul BUGET_LOCK al migrarii alese (ambele forme ale mesajului ei): ms de la prima incercare
bl_ms() { sed -nE -e "s/.*${BL_RX_A}.*/\\2/p" -e "s/.*${BL_RX_B}.*/\\1/p" "$1" | head -n 1; }
# verifica <eticheta> <conditie...>: conditia rulata ca o comanda (fara efectul set -e), apoi verdictul
verifica() { local et="$1"; shift; if "$@"; then verdict 0 "$et"; else verdict 1 "$et"; fi; }
lock_linie() { grep -E "^$(echo "$NUME" | cut -c1-9): lock la [0-9]+ ms de la BEGIN \([0-9]+ incercari, [0-9]+ ms de la prima incercare\)" "$1" | head -n 1; }

# ── I: inventarul lock-urilor implicite (doar citire) ──
echo "--- inventar: triggere / constrangeri / politici pe relatiile atinse implicit de corp ---"
INV_REL="public.sites"
[ "$TIP" = uscare ] && INV_REL="storage.buckets storage.objects"
[ "$TIP" = fan ] && INV_REL="public.red_proiecte public.red_loturi_plicuire public.red_plicuri"
for r in $INV_REL; do
  # runda 18 (P2-1): "char" convertit explicit la text (text || "char" = „operator is not unique” pe PostgreSQL real)
  q "SELECT '$r trigger ' || tgname || ' ' || pg_get_triggerdef(oid) || ' enabled=' || tgenabled::text FROM pg_trigger WHERE tgrelid = '$r'::regclass AND NOT tgisinternal ORDER BY tgname"
  q "SELECT '$r constrangere ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = '$r'::regclass ORDER BY conname"
  q "SELECT '$r politica ' || polname || ' ' || polcmd::text FROM pg_policy WHERE polrelid = '$r'::regclass ORDER BY polname"
done

# ── L0: control fara concurenta ──
proba "$TMP/l0.log"
L0="$(lock_linie "$TMP/l0.log")"
Y0="$(echo "$L0" | sed -nE 's/.*\(([0-9]+) incercari, ([0-9]+) ms de la prima incercare\).*/\1 \2/p')"
# proba tipareste (tiparire, nu verificare) „AMPRENTA_GLOBALA_CITITA inainte: … calcul N ms, la M ms de la BEGIN; familii: …”
INA="$(sed -nE 's/.*AMPRENTA_GLOBALA(_CITITA)? inainte: .* la ([0-9]+) ms de la BEGIN.*/\2/p' "$TMP/l0.log" | head -n 1)"
c_l0() { [ "$RC_P" = 0 ] && grep -q '\[ok\] IDENTIC' "$TMP/l0.log" && [ -n "$Y0" ] && [ "${Y0% *}" = 1 ] && [ "${Y0#* }" -lt 100 ] \
           && [[ "$INA" =~ ^[0-9]+$ ]] && curat; }
verifica "L0 control: cod $RC_P, IDENTIC, $L0; pasul inainte terminat la ${INA:-?} ms de la BEGIN; $MS_P ms in total" c_l0
[ "$ESEC" = 0 ] || { cat "$TMP/l0.log"; echo "L0 a picat: restul scenariilor nu au referinta" >&2; exit 1; }

# ── L1: relatia principala tinuta permanent => BUGET_LOCK, fara asteptare pana la eliberare; observatorul lock-urilor partiale ──
tine "$REL" "$HMOD" 'SELECT pg_sleep(6);' "$HLOCK"
OBS_PID=""
if [ "$TIP" = uscare ]; then
  PGAPPNAME="$APP_O" "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -c "SET default_transaction_read_only = on" -c "DO \$o\$
    DECLARE v_partial int := 0; v_activ int := 0; BEGIN
      FOR i IN 1..80 LOOP
        PERFORM pg_stat_clear_snapshot();
        IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '$APP' AND xact_start IS NOT NULL) THEN v_activ := v_activ + 1; END IF;
        IF EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                    WHERE a.application_name = '$APP' AND l.granted AND l.mode = 'ShareRowExclusiveLock'
                      AND l.relation IN ('public.executie_proiecte'::regclass, 'public.executie_probe_tronsoane'::regclass)) THEN
          v_partial := v_partial + 1; END IF;
        PERFORM pg_sleep(0.03);
      END LOOP;
      RAISE NOTICE 'OBS partial=% activ=%', v_partial, v_activ; END \$o\$" >"$TMP/obs.log" 2>&1 &
  OBS_PID=$!; PIDS+=("$OBS_PID")
fi
# fan (runda 4, aditiv): (a) acelasi observator doar-citire, pe relatiile partiale ale setului fan; (b) un SCRIITOR pe red_proiecte +
# red_loturi_plicuire si un cititor al lui red_plicuri (tabelul tinut de H), 80 de esantioane, fiecare intr-o subtranzactie anulata
OBSW_PID=""
if [ "$TIP" = fan ]; then
  PGAPPNAME="$APP_O" "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -c "SET default_transaction_read_only = on" -c "DO \$o\$
    DECLARE v_partial int := 0; v_activ int := 0; BEGIN
      FOR i IN 1..80 LOOP
        PERFORM pg_stat_clear_snapshot();
        IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '$APP' AND xact_start IS NOT NULL) THEN v_activ := v_activ + 1; END IF;
        IF EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                    WHERE a.application_name = '$APP' AND l.granted AND l.mode = 'ShareRowExclusiveLock'
                      AND l.relation IN ('public.red_proiecte'::regclass, 'public.red_loturi_plicuire'::regclass)) THEN
          v_partial := v_partial + 1; END IF;
        PERFORM pg_sleep(0.03);
      END LOOP;
      RAISE NOTICE 'OBS partial=% activ=%', v_partial, v_activ; END \$o\$" >"$TMP/obs.log" 2>&1 &
  OBS_PID=$!; PIDS+=("$OBS_PID")
  PGAPPNAME="$APP_O" "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -c "DO \$w\$
    DECLARE v_blocat int := 0; v_liber int := 0; v_cit int := 0; BEGIN
      PERFORM set_config('lock_timeout', '50ms', true);
      FOR i IN 1..80 LOOP
        BEGIN
          PERFORM count(*) FROM (SELECT 1 FROM public.red_plicuri LIMIT 1) x;
          v_cit := v_cit + 1;
          LOCK TABLE public.red_proiecte IN ROW EXCLUSIVE MODE;
          LOCK TABLE public.red_loturi_plicuire IN ROW EXCLUSIVE MODE;
          RAISE EXCEPTION 'liber' USING ERRCODE = 'P0001';
        EXCEPTION WHEN lock_not_available THEN v_blocat := v_blocat + 1;
                  WHEN raise_exception THEN v_liber := v_liber + 1;
        END;
        PERFORM pg_sleep(0.03);
      END LOOP;
      RAISE NOTICE 'OBSW blocat=% liber=% citiri=%', v_blocat, v_liber, v_cit; END \$w\$" >"$TMP/obsw.log" 2>&1 &
  OBSW_PID=$!; PIDS+=("$OBSW_PID")
fi
proba "$TMP/l1.log"
H_INCA=1; h_activ || H_INCA=0
X1="$(bl_ms "$TMP/l1.log")"   # runda 18 (P2-2): mesajul real al migrarii alese (meteo: „BUGET_LOCK: sites ocupat; …”)
astept_h
OK_OBS=0 PART=""
if [ -n "$OBS_PID" ]; then
  wait "$OBS_PID" || OK_OBS=1
  gata_pid "$OBS_PID"
  PART="$(sed -nE 's/.*OBS partial=([0-9]+) activ=([0-9]+).*/\1 \2/p' "$TMP/obs.log")"
  if ! { [ -n "$PART" ] && [ "${PART% *}" -le 2 ] && [ "${PART#* }" -ge 10 ]; }; then OK_OBS=1; fi
fi
c_l1() { [ "$RC_P" = 1 ] && [[ "$X1" =~ ^[0-9]+$ ]] && [ "$X1" -ge 900 ] && [ "$X1" -le 1500 ] && [ "$H_INCA" = 1 ] && [ "$RC_H" = 0 ] \
           && [ "$OK_OBS" = 0 ] && curat; }
verifica "L1 $REL tinut ($HMOD): cod $RC_P, BUGET_LOCK la ${X1:-?} ms de la prima incercare, H inca activ la final ($H_INCA), $MS_P ms; observator (partial activ): ${PART:-n/a}" c_l1
[ "$ESEC" = 0 ] || { cat "$TMP/l1.log" "$TMP/obs.log" 2>/dev/null || true; }
# L1b (fan): scrierile pe red_proiecte / red_loturi_plicuire si citirile lui red_plicuri NU sunt oprite cat aplicarea asteapta
if [ -n "$OBSW_PID" ]; then
  RC_W=0; wait "$OBSW_PID" || RC_W=$?
  gata_pid "$OBSW_PID"
  OBSW="$(sed -nE 's/.*OBSW blocat=([0-9]+) liber=([0-9]+) citiri=([0-9]+).*/\1 \2 \3/p' "$TMP/obsw.log")"
  c_l1b() { [ "$RC_W" = 0 ] && [ -n "$OBSW" ] && read -r b l c <<< "$OBSW" && [ "$b" -le 2 ] && [ "$c" = 80 ] && [ $((b + l)) = 80 ]; }
  verifica "L1b (fan) cat aplicarea asteapta: scriitor pe red_proiecte + red_loturi_plicuire blocat / liber / citiri red_plicuri = ${OBSW:-?} (cerut: blocat <= 2, citiri 80)" c_l1b
  [ "$ESEC" = 0 ] || cat "$TMP/obsw.log"
fi

# ── L2: relatia principala eliberata la ~400 ms dupa pasul „inainte” => aplicat (ROLLBACK), k >= 2, Y < 1000 ──
tine "$REL" "$HMOD" "DO \$w\$ DECLARE i int := 0; v_start timestamptz; BEGIN
  LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT xact_start INTO v_start FROM pg_stat_activity WHERE application_name = '$APP' AND xact_start IS NOT NULL LIMIT 1;
    EXIT WHEN v_start IS NOT NULL;
    PERFORM pg_sleep(0.01); i := i + 1; IF i > 3000 THEN RAISE EXCEPTION 'proba nu a pornit'; END IF;
  END LOOP;
  PERFORM pg_sleep(greatest(0, extract(epoch FROM v_start + make_interval(secs => ($INA + 400) / 1000.0) - clock_timestamp())));
END \$w\$;" "$HLOCK"
proba "$TMP/l2.log"
astept_h
L2="$(lock_linie "$TMP/l2.log")"
Y2="$(echo "$L2" | sed -nE 's/.*\(([0-9]+) incercari, ([0-9]+) ms de la prima incercare\).*/\1 \2/p')"
c_l2() { [ "$RC_P" = 0 ] && grep -q '\[ok\] IDENTIC' "$TMP/l2.log" && [ -n "$Y2" ] && [ "${Y2% *}" -ge 2 ] && [ "${Y2#* }" -lt 1000 ] \
           && [ "$RC_H" = 0 ] && curat; }
verifica "L2 $REL eliberat inainte de termen: cod $RC_P, IDENTIC, $L2; $MS_P ms" c_l2
[ "$ESEC" = 0 ] || cat "$TMP/l2.log"

# ── F1 (fan, runda 4): CAT APLICAREA TINE setul — cititorul trece imediat, scriitorul pe red_plicuri asteapta eliberarea (cel mult plafonul) ──
if [ "$TIP" = fan ]; then
  TINE_SRX="EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = '$APP'
              AND l.relation = 'public.red_plicuri'::regclass AND l.mode = 'ShareRowExclusiveLock' AND l.granted)"
  BARIERA="LOOP PERFORM pg_stat_clear_snapshot(); EXIT WHEN $TINE_SRX; PERFORM pg_sleep(0.005); i := i + 1;
             IF i > 4000 THEN RAISE EXCEPTION 'bariera F1: proba nu a tinut red_plicuri'; END IF; END LOOP;"
  PGAPPNAME="$APP_O" "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -c "SET default_transaction_read_only = on" -c "DO \$r\$
    DECLARE i int := 0; t0 timestamptz; v boolean; BEGIN
      $BARIERA
      t0 := clock_timestamp();
      PERFORM count(*) FROM (SELECT 1 FROM public.red_proiecte LIMIT 1) x;
      PERFORM count(*) FROM (SELECT 1 FROM public.red_loturi_plicuire LIMIT 1) x;
      PERFORM count(*) FROM (SELECT 1 FROM public.red_plicuri LIMIT 1) x;
      PERFORM pg_stat_clear_snapshot(); v := $TINE_SRX;
      RAISE NOTICE 'CIT ms=% tinut=%', round(extract(epoch FROM clock_timestamp() - t0) * 1000), v; END \$r\$" >"$TMP/f1r.log" 2>&1 &
  PID_R=$!; PIDS+=("$PID_R")
  PGAPPNAME="$APP_O" "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -c "DO \$w\$
    DECLARE i int := 0; t0 timestamptz; v boolean; BEGIN
      PERFORM set_config('lock_timeout', '6s', true);
      $BARIERA
      t0 := clock_timestamp();
      LOCK TABLE public.red_plicuri IN ROW EXCLUSIVE MODE;
      PERFORM pg_stat_clear_snapshot(); v := $TINE_SRX;
      RAISE NOTICE 'SCR ms=% tinut_dupa=%', round(extract(epoch FROM clock_timestamp() - t0) * 1000), v; END \$w\$" >"$TMP/f1w.log" 2>&1 &
  PID_W=$!; PIDS+=("$PID_W")
  proba "$TMP/f1.log"
  RC_R=0; wait "$PID_R" || RC_R=$?; gata_pid "$PID_R"
  RC_W=0; wait "$PID_W" || RC_W=$?; gata_pid "$PID_W"
  CIT="$(sed -nE 's/.*CIT ms=([0-9]+) tinut=(t|f|true|false).*/\1 \2/p' "$TMP/f1r.log")"
  SCR="$(sed -nE 's/.*SCR ms=([0-9]+) tinut_dupa=(t|f|true|false).*/\1 \2/p' "$TMP/f1w.log")"
  c_f1() { [ "$RC_P" = 0 ] && grep -q '\[ok\] IDENTIC' "$TMP/f1.log" && [ "$RC_R" = 0 ] && [ "$RC_W" = 0 ] && [ -n "$CIT" ] && [ -n "$SCR" ] \
             && [ "${CIT% *}" -lt 200 ] && [[ "${CIT#* }" =~ ^t ]] && [[ "${SCR#* }" =~ ^f ]] && [ "${SCR% *}" -lt 5500 ] && curat; }
  verifica "F1 (fan) cat aplicarea tine lock-ul: proba cod $RC_P; cititor (ms tinut) = ${CIT:-?}; scriitor red_plicuri (ms tinut_dupa) = ${SCR:-?}; $MS_P ms" c_f1
  [ "$ESEC" = 0 ] || cat "$TMP/f1.log" "$TMP/f1r.log" "$TMP/f1w.log" 2>/dev/null || true
fi

# ── B1 (uscare): storage.buckets tinut SHARE => lock timeout la INSERT (implicit), nu BUGET_LOCK, fara asteptare pana la eliberare ──
if [ "$TIP" = uscare ]; then
  tine storage.buckets SHARE 'SELECT pg_sleep(6);' ShareLock
  proba "$TMP/b1.log"
  H_INCA=1; h_activ || H_INCA=0
  astept_h
  c_b1() { [ "$RC_P" = 1 ] && grep -qi 'lock timeout' "$TMP/b1.log" && ! grep -q 'BUGET_LOCK' "$TMP/b1.log" && [ "$H_INCA" = 1 ] \
             && [ "$RC_H" = 0 ] && curat; }
  verifica "B1 storage.buckets tinut SHARE: cod $RC_P, lock timeout la lock-ul implicit (nu BUGET_LOCK), H inca activ la final ($H_INCA), $MS_P ms" c_b1
  [ "$ESEC" = 0 ] || cat "$TMP/b1.log"
fi

# ── B2 (uscare, runda 18): coliziunea de UNICITATE - INSERT necomis al lui H cu acelasi id, fara LOCK pe relatie => lock timeout ──
if [ "$TIP" = uscare ]; then
  # coloanele si valorile = INSERT-ul migrarii (verificat in fisier: aceeasi lista de coloane)
  COL_B='INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)'
  VAL_B="VALUES ('executie-uscare', 'executie-uscare', false, 10485760, ARRAY['image/jpeg']);"
  [ "$(grep -cF "$COL_B" "$MIG")" = 1 ] && [ "$(grep -cF "$VAL_B" "$MIG")" = 1 ] \
    || { echo "B2: INSERT-ul bucket-ului nu mai are forma asteptata in $MIG - actualizati proba" >&2; exit 2; }
  printf '%s\n' "\\set ON_ERROR_STOP 1" "BEGIN;" "SET LOCAL application_name = '$APP_H';" \
    "$COL_B $VAL_B" "SELECT pg_sleep(6);" "ROLLBACK;" >"$TMP/tine.sql"
  "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/tine.sql" >"$TMP/tine.log" 2>&1 &
  PID_H=$!; PIDS+=("$PID_H")
  # bariera: H a terminat INSERT-ul (doarme in pg_sleep) si nu tine pe storage.buckets niciun lock incompatibil cu ROW EXCLUSIVE (deci
  # nimic pe relatie nu opreste INSERT-ul migrarii: asteptarea, daca apare, e pe tranzactia lui H = verificarea cheii unice)
  q "DO \$b\$ DECLARE i int := 0; BEGIN
       LOOP
         PERFORM pg_stat_clear_snapshot();
         EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '$APP_H' AND wait_event = 'PgSleep');
         PERFORM pg_sleep(0.02); i := i + 1;
         IF i > 500 THEN RAISE EXCEPTION 'bariera B2: H nu a ajuns la pg_sleep dupa INSERT'; END IF;
       END LOOP;
       IF EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = '$APP_H'
                    AND l.relation = 'storage.buckets'::regclass
                    AND l.mode IN ('ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock')) THEN
         RAISE EXCEPTION 'bariera B2: H tine pe storage.buckets un lock incompatibil cu ROW EXCLUSIVE (scenariul nu mai e distinct de B1)';
       END IF; END \$b\$;" >/dev/null
  proba "$TMP/b2.log"
  H_INCA=1; h_activ || H_INCA=0
  astept_h
  c_b2() { [ "$RC_P" = 1 ] && grep -qi 'lock timeout' "$TMP/b2.log" && ! grep -q 'BUGET_LOCK' "$TMP/b2.log" && [ "$H_INCA" = 1 ] \
             && [ "$RC_H" = 0 ] && curat; }
  CTX_B2="$(grep -i -m 1 'uniqueness\|unicit' "$TMP/b2.log" || true)"
  verifica "B2 INSERT necomis al lui H cu acelasi id de bucket: cod $RC_P, lock timeout la verificarea unicitatii (nu BUGET_LOCK), H inca activ la final ($H_INCA), $MS_P ms; context: ${CTX_B2:-n/a}" c_b2
  [ "$ESEC" = 0 ] || cat "$TMP/b2.log"
fi

if [ "$ESEC" = 0 ]; then echo "PASS l15_aplicare_concurenta $TIP"; else echo "ESEC l15_aplicare_concurenta $TIP"; fi
exit "$ESEC"
