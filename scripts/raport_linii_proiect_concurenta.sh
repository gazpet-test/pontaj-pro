#!/usr/bin/env bash
# Proba de CONCURENȚĂ pentru 20261217a (liniile raportului și distribuția pe proiectul șantierului citit sub lock) — DOAR pe CLONĂ, cu sesiuni
# psql reale (L25). Tiparul: scripts/raport_rezumat_concurenta.sh; barierele: scripts/portal/concurrency_lock.sh (lock + așteptare observată).
# Rulare din Git Bash, cu psql de Windows; conexiunea după `--` (parola din pgpass, niciodată pe linia de comandă):
#   PSQL=/c/Users/Public/pgsql/bin/psql.exe bash scripts/raport_linii_proiect_concurenta.sh --sistem <system_identifier al clonei> \
#        [--verifica-bariera | --asteptat defect|inchis | --mutant fara_comparatie|fara_verificare|fara_for_share|cu_asteptare|distributie_fara_lock] \
#        -- -h <host clonă> -p <port> -U postgres -d postgres
#   --verifica-bariera = DOAR bariera (fără mutare, salvarea anulată cu ROLLBACK): arată că salvarea stă la lock-ul activității ținut de
#     control; merge în ambele stări ale migrării. Ieșire 0 = bariera ține, 26 = nu ține (proba de concurență n-ar avea ce dovedi);
#   --asteptat defect = ÎNAINTE de 20261217a pe clonă: L1–L3, L5, L5c, L7 trebuie să arate defectul (dovada că există azi); L6 / L8 (gărzile
#     noi față de salvare) nu au ce proba fără migrare și sunt sărite;
#   --asteptat inchis (implicit) = DUPĂ 20261217a: fereastra închisă, fără deadlock.
# Garda țintei: system_identifier al bazei (pg_control_system()) trebuie să fie EXACT --sistem, altfel refuz (cod 22) înainte de orice scriere.
# Datele: pe PRIMUL șantier cu proiect (P0) fără rezumate corectate de om: o activitate SINTETICĂ a lui P0, două tronsoane SINTETICE ale lui P0
#   (TLPC1 / TLPC2) și rapoarte SINTETICE în zilele 2001-02-01 … 12, COMISE pe clonă (sesiunile trebuie să le vadă) și șterse la final (trap),
#   oricare ar fi rezultatul; șantierul e mutat în alt proiect (P1) în scenarii și pus la loc în P0 după fiecare și în trap. Identitatea
#   salvărilor: owner-ul sintetic al clonei (00000000-0000-4000-8000-000000000001, schimbabil cu OWNER=<uuid>), rolul authenticated, JWT-ul în
#   ambele surse. Scrierile directe: ca postgres (calea server / scripturi), fără JWT.
# Fereastra RPC (r2, sincronizare doar pe lock-uri, fără sleep ca mecanism; așteptările sunt OBSERVATE în pg_stat_activity / pg_locks):
#   1. CONTROLUL ține activitatea sintetică FOR UPDATE, apoi ia bariera consultativă C;
#   2. SALVAREA (RPC-ul real, 20261208a) pornește după C: ia rândul raportului (pasul 1), citește proiectul, apoi stă la pasul 5 (activitățile
#      FOR SHARE);
#   3. MUTAREA (L1, L2, L4) / SCRIEREA DIRECTĂ (L6, L8) pornește DOAR când vede salvarea (application_name) în așteptare de lock BLOCATĂ DE pid-ul
#      controlului (pg_blocking_pids) — marcajul „BARIERA tine”; nu-l vede în 20 s = PROBA_NEFUNCTIONALA;
#   4. controlul COMITE (eliberează activitatea) DOAR după bariera M (mutarea / scrierea a terminat) sau — L6 / L8 — după ce vede scrierea
#      directă blocată de salvare (mutantul cu_asteptare), deci salvarea continuă garantat DUPĂ pasul celuilalt.
#   r3: fiecare pas de sondare începe cu pg_stat_clear_snapshot() (lista sesiunilor e fixată pe tranzacție la prima citire).
# Scenarii:
#   L0 salvare normală (raport nou, fără mutare): trece, fără așteptare (L20: calea legitimă nu începe să pice);
#   L1 raport NOU, mutarea comisă în fereastră -> inchis: refuz 22023 („șantierul raportului e acum în alt proiect”), nimic scris;
#      defect: salvarea trece cu liniile pe P0, șantierul în P1;
#   L2 raport EXISTENT fără rezumat valabil ('de_recompus', ca rapoartele de dinainte de 20261216a) -> la fel ca L1;
#   L3 calea directă (INSERT ca postgres) în timpul unei mutări în zbor -> inchis (r4): refuz IMEDIAT 55P03 „reîncearcă” (garda nu așteaptă
#      șantierul ocupat: SKIP LOCKED), nimic scris; defect: trece cu proiectul vechi;
#   L4 raport existent CU rezumat automat ținut de o salvare în fereastră + mutarea -> mutarea refuză IMEDIAT (55P03, NOWAIT din 20261216a),
#      fără deadlock, iar salvarea trece pe P0 — la fel înainte și după 20261217a (calea legitimă sub concurență, L20);
#   L5 (r3) calea directă cu o linie FĂRĂ activitate (dacă schema cere activitate: cu o activitate SINTETICĂ a lui P1) în timpul unei mutări
#      în zbor -> inchis: refuz imediat 55P03 (ca L3); defect: linia rămâne pe P0, șantierul în P1;
#   L5c (r4) aceeași linie, scrisă DUPĂ ce mutarea a comis -> inchis: refuz 22023 („șantierul raportului e acum în alt proiect”). Singurul
#      scenariu în care DOAR comparația proiectului închide fereastra (fără activitate, verificarea activității nu are ce compara);
#   L6u / L6i / L6d (r4, review P1-1) salvarea RPC în curs (ține raportul, stă la bariera controlului) + o scriere directă pe ACELAȘI raport:
#      UPDATE proiect_id pe linia lui (L6u), INSERT al unei linii (L6i), DELETE al liniei (L6d) -> inchis: salvarea trece, UPDATE-ul / INSERT-ul
#      direct primesc IMEDIAT refuzul 55P03 „reîncearcă” (DELETE-ul trece: niciun trigger nou), NICIUN 40P01. Mutantul cu_asteptare (garda
#      așteaptă rândul raportului) reproduce deadlock-ul pe L6u: UPDATE-ul ține linia și așteaptă raportul, salvarea ajunge la DELETE și
#      așteaptă linia — 40P01, victima poate fi salvarea;
#   L7 (r4, review P1-2) distribuția pe calea directă (INSERT ca postgres, rând cu tronsonul TLPC1 al lui P0) în timpul unei mutări în zbor ->
#      inchis: refuz imediat 55P03; defect (azi și cu mutantul distributie_fara_lock): rândul trece cu tronsonul lui P0, șantierul în P1;
#   L8 (r4) salvarea RPC cu distribuție în curs + UPDATE direct al tronsonului unui rând de distribuție al aceluiași raport -> ca L6u
#      (mutantul cu_asteptare: 40P01 între UPDATE-ul direct și DELETE-ul distribuției din salvare).
# Ce închide fereastra, pe fiecare cale (dovada: mutanții de mai jos + harness-ul SQL T2 / T4 / T4d + mutanții PGlite):
#   * RPC, raport nou sau existent fără rezumat (L1, L2): DOUĂ verificări, fiecare singură — comparația (proiectul liniei = cel vechi) și
#     verificarea activității (activitatea e a proiectului vechi). Redundanță voită.
#   * scriere directă în timpul mutării (L3, L5, L7): lock-ul — șantierul ocupat = refuz fără așteptare (mutantul fara_for_share / fara_lock
#     citește proiectul vechi și trece); după mutare (L5c): comparația (mutantul fara_comparatie).
#   * scriere directă cât o salvare ține raportul (L6, L8): fără așteptare = fără ciclu (mutantul cu_asteptare = deadlock).
# Fiecare scenariu primește UNA din trei stări (r2): OK (rezultatul cerut de --asteptat), CONTRAR (fereastra s-a deschis, dar rezultatul
#   e celălalt: DEFECT reprodus / FEREASTRA INCHISA / neclasificat), PROBA_NEFUNCTIONALA (bariera nu a ținut, mutarea nu a trecut,
#   o sesiune a picat, date de plecare greșite) — atunci rezultatul NU se judecă.
# Mutanți (--mutant <nume>, cu 20261217a aplicată): funcția gărzii e stricată pe clonă (CREATE OR REPLACE din pg_get_functiondef), rulează
#   DOAR scenariile lui, apoi se pune la loc în trap (amprenta corpului verificată). Ieșire 0 = mutantul a fost PRINS (scenariul-țintă a
#   arătat DEFECTUL, cu fereastra deschisă, și niciun scenariu nu e CONTRAR):
#   fara_comparatie = linia nu se mai compară cu proiectul șantierului: L1 trebuie să rămână ÎNCHIS, refuzat de verificarea activității
#     (redundanța de pe calea RPC, dovedită), iar L5c (linia fără activitate, după mutare) trebuie să arate DEFECTUL;
#   fara_verificare (r3) = fără comparație ȘI fără verificarea activității / obiectului (rămâne doar lock-ul): L1 trebuie să arate DEFECTUL;
#   fara_for_share = șantierul citit fără lock (L3);
#   cu_asteptare (r4) = gărzile AȘTEAPTĂ rândurile (fără SKIP LOCKED), ca în r3: L6u și L8 trebuie să arate DEADLOCK-ul (40P01);
#   distributie_fara_lock (r4) = garda distribuției citește proiectul fără lock: L7 trebuie să arate DEFECTUL.
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
case "$MUTANT" in ""|fara_comparatie|fara_verificare|fara_for_share|cu_asteptare|distributie_fara_lock) ;; *) echo "mutant necunoscut: $MUTANT" >&2; exit 2 ;; esac
if [ -n "$MUTANT" ] && [ "$ASTEPTAT" != inchis ]; then echo "--mutant cere migrarea aplicata (--asteptat inchis)" >&2; exit 2; fi
if [ "$VERIFICA" = 1 ] && [ -n "$MUTANT" ]; then echo "--verifica-bariera nu se combina cu --mutant" >&2; exit 2; fi
OWNER="${OWNER:-00000000-0000-4000-8000-000000000001}"
[[ "$OWNER" =~ ^[0-9a-f-]{36}$ ]] || { echo "OWNER invalid" >&2; exit 2; }
cd "$(dirname "$0")/.."
TMP="$(mktemp -d ./.concurenta_20261217a.XXXXXX)"   # în repo: căi relative, fără conversia /tmp pentru psql de Windows
q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" "$@"; }

REAL="$(q -c "SELECT system_identifier FROM pg_control_system()")"
if [ "$REAL" != "$SISTEM" ]; then echo "REFUZ: system_identifier al bazei ($REAL) <> --sistem ($SISTEM)" >&2; rm -rf "$TMP"; exit 22; fi
APLICATA="$(q -c "SELECT to_regprocedure('public.fn_raport_lucrari_proiect_garda()') IS NOT NULL AND to_regprocedure('public.fn_raport_distributie_proiect_garda()') IS NOT NULL")"
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
if [ "$(q -c "SELECT EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data BETWEEN DATE '2001-02-01' AND DATE '2001-02-12')")" != f ]; then
  echo "REFUZ: zilele de test 2001-02-01 ... 12 sunt ocupate pe santierul $SITE (nu sterg nimic)" >&2; rm -rf "$TMP"; exit 24
fi
if [ "$(q -c "SELECT EXISTS (SELECT 1 FROM public.proiect_unitati WHERE proiect_id = $P0 AND cod IN ('TLPC1', 'TLPC2'))")" != f ]; then
  echo "REFUZ: tronsoanele de test TLPC1 / TLPC2 exista deja in proiectul $P0 (nu sterg nimic)" >&2; rm -rf "$TMP"; exit 24
fi
if [ "$(q -c "SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'rlp17\\_%'")" != 0 ]; then
  echo "REFUZ: exista deja sesiuni rlp17_* pe clona (alta rulare a probei?)" >&2; rm -rf "$TMP"; exit 24
fi

ACT=""; ACT1=""; U0=""; U0B=""; MUT_FN=()
muta() { q -c "UPDATE public.sites SET proiect_id = $1 WHERE id = $SITE AND proiect_id IS DISTINCT FROM $1;" >/dev/null; }
amprenta_fn() { q -c "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.$1()'::regprocedure"; }
curata() {
  local rc=0 fn
  for fn in ${MUT_FN[@]+"${MUT_FN[@]}"}; do   # lista goală sub set -u (bash vechi)
    if ! q -f "$TMP/orig_$fn.sql" >/dev/null || [ "$(amprenta_fn "$fn")" != "$(cat "$TMP/orig_$fn.md5")" ]; then
      echo "ATENTIE: $fn NU s-a putut pune la loc pe clona (definitia originala ramane in orig_${fn}_20261217a.sql)" >&2
      cp "$TMP/orig_$fn.sql" "./orig_${fn}_20261217a.sql" 2>/dev/null || true; rc=25
    else echo "mutant: $fn pusa la loc (amprenta $(cat "$TMP/orig_$fn.md5"))"; fi
  done
  q -c "DELETE FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data BETWEEN DATE '2001-02-01' AND DATE '2001-02-12' AND probleme LIKE 'Proba linii proiect%';" >/dev/null \
    || echo "ATENTIE: de sters manual pe clona: rapoartele 2001-02-01 ... 12 ale santierului $SITE" >&2
  [ -z "$ACT" ] || q -c "DELETE FROM public.proiect_activitati WHERE id = $ACT AND nume = 'Activitate proba linii proiect';" >/dev/null \
    || echo "ATENTIE: de sters manual pe clona: activitatea $ACT" >&2
  [ -z "$ACT1" ] || q -c "DELETE FROM public.proiect_activitati WHERE id = $ACT1 AND nume = 'Activitate proba linii proiect (P1)';" >/dev/null \
    || echo "ATENTIE: de sters manual pe clona: activitatea $ACT1" >&2
  [ -z "$U0$U0B" ] || q -c "DELETE FROM public.proiect_unitati WHERE id IN (${U0:-0}, ${U0B:-0}) AND cod IN ('TLPC1', 'TLPC2');" >/dev/null \
    || echo "ATENTIE: de sters manual pe clona: tronsoanele $U0 $U0B" >&2
  muta "$P0" || echo "ATENTIE: de pus la loc manual pe clona: santierul $SITE in proiectul $P0" >&2
  rm -rf "$TMP"
  return "$rc"
}
trap 'curata || exit 25' EXIT

ACT="$(q -c "INSERT INTO public.proiect_activitati (proiect_id, nume, um, tip_raportare, ordine, activ)
             VALUES ($P0, 'Activitate proba linii proiect', 'm', 'cantitate', 999, true) RETURNING id" | head -1)"
[[ "$ACT" =~ ^[0-9]+$ ]] || { echo "activitatea sintetica: iesire neasteptata: $ACT" >&2; ACT=""; exit 1; }
# r4: două tronsoane SINTETICE ale lui P0 (distribuția: L7 / L8)
U0="$(q -c "INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES ($P0, 'tronson', 'TLPC1', 'Tronson proba linii proiect 1', 999, true) RETURNING id" | head -1)"
[[ "$U0" =~ ^[0-9]+$ ]] || { echo "tronsonul sintetic 1: iesire neasteptata: $U0" >&2; U0=""; exit 1; }
U0B="$(q -c "INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES ($P0, 'tronson', 'TLPC2', 'Tronson proba linii proiect 2', 999, true) RETURNING id" | head -1)"
[[ "$U0B" =~ ^[0-9]+$ ]] || { echo "tronsonul sintetic 2: iesire neasteptata: $U0B" >&2; U0B=""; exit 1; }
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
DISTRIB="'[{\"tabel\": \"conducta\", \"nr_crt\": 1, \"unitate_id\": $U0}]'::jsonb"
JWT="SELECT set_config('request.jwt.claim.sub', '$OWNER', true), set_config('request.jwt.claims', json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;"
FRAG='șantierul raportului e acum în alt proiect'
FRAG_OCUPAT='reîncearcă peste câteva secunde'

# ── mutanții: funcția (funcțiile) gărzii stricate pe clonă, cu definiția originală păstrată pentru trap ──
strica() {   # $1 = funcția, apoi perechi „text de înlocuit” „înlocuitor” (fără apostrofuri); replace() le ia pe toate aparițiile din corp
  local fn="$1" expr="d" verif="true"; shift
  q -c "SELECT pg_get_functiondef('public.$fn()'::regprocedure) || ';'" > "$TMP/orig_$fn.sql"
  amprenta_fn "$fn" > "$TMP/orig_$fn.md5"
  MUT_FN+=("$fn")
  while [ $# -gt 1 ]; do expr="replace($expr, '$1', '$2')"; verif="$verif AND position('$1' IN d) > 0"; shift 2; done
  q -c "DO \$m\$ DECLARE d text := pg_get_functiondef('public.$fn()'::regprocedure); BEGIN
          IF NOT ($verif) THEN RAISE EXCEPTION 'mutantul nu gaseste textul de inlocuit in $fn'; END IF;
          EXECUTE $expr; END \$m\$;" >/dev/null
}
case "$MUTANT" in
  fara_comparatie) strica fn_raport_lucrari_proiect_garda 'IF NEW.proiect_id IS DISTINCT FROM v_proiect THEN' 'IF false THEN' ;;
  fara_verificare) strica fn_raport_lucrari_proiect_garda 'IF NEW.proiect_id IS DISTINCT FROM v_proiect THEN' 'IF false THEN' \
                     'IF v_are_act AND v_act IS DISTINCT FROM v_proiect THEN' 'IF false THEN' 'IF v_are_ob AND v_ob IS DISTINCT FROM v_proiect THEN' 'IF false THEN' ;;
  fara_for_share) strica fn_raport_lucrari_proiect_garda 'FOR SHARE OF r, s SKIP LOCKED;' 'FOR SHARE OF r SKIP LOCKED;' ;;
  cu_asteptare) strica fn_raport_lucrari_proiect_garda 'FOR SHARE OF r, s SKIP LOCKED;' 'FOR SHARE OF r, s;'
                strica fn_raport_distributie_proiect_garda 'FOR SHARE OF r, s SKIP LOCKED;' 'FOR SHARE OF r, s;' ;;
  distributie_fara_lock) strica fn_raport_distributie_proiect_garda 'FOR SHARE OF r, s SKIP LOCKED;' ';' ;;
esac
[ -z "$MUTANT" ] || echo "mutant $MUTANT aplicat pe clona (${MUT_FN[*]-})"

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
# trei sesiuni: control (C), salvarea (S), mutarea / observatorul / scrierea directă (M); codul de ieșire al fiecăreia se păstrează (wait PID)
ruleaza_trei() {   # $1 = scenariu; fișierele $TMP/$1_c.sql, $TMP/$1_s.sql, $TMP/$1_m.sql
  PGAPPNAME="rlp17_$1_c" "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_c.sql" > "$TMP/$1_c.log" 2>&1 & PID_C=$!
  PGAPPNAME="rlp17_$1_s" "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_s.sql" > "$TMP/$1_s.log" 2>&1 & PID_S=$!
  PGAPPNAME="rlp17_$1_m" "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_m.sql" > "$TMP/$1_m.log" 2>&1 & PID_M=$!
  set +e; wait $PID_C; RC_C=$?; wait $PID_S; RC_S=$?; wait $PID_M; RC_M=$?; set -e
  cat "$TMP/$1_c.log" "$TMP/$1_s.log" "$TMP/$1_m.log"
}
# controlul: ține activitatea FOR UPDATE, ia bariera C și eliberează activitatea DOAR după bariera M (luată de mutare / scriere după COMMIT)
#   sau (r4, $3 = scenariul L6 / L8) după ce vede scrierea directă (rlp17_<sc>_m) blocată de salvare (rlp17_<sc>_s): mutantul cu_asteptare
control() {   # $1 = bariera controlului (C), $2 = bariera mutării (M), $3 = scenariul cu scriere directă (opțional)
  if [ -z "${3:-}" ]; then
    cat <<SQL
\set ON_ERROR_STOP 1
BEGIN;
SELECT 1 FROM public.proiect_activitati WHERE id = $ACT FOR UPDATE;
SELECT pg_advisory_lock($1);
$(asteapta "$2")
COMMIT;
SELECT pg_advisory_unlock($1);
SQL
  else
    cat <<SQL
\set ON_ERROR_STOP 1
BEGIN;
SELECT 1 FROM public.proiect_activitati WHERE id = $ACT FOR UPDATE;
SELECT pg_advisory_lock($1);
DO \$b\$ DECLARE i int := 0; v_d int; BEGIN
  LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $2 AND objsubid = 1 AND granted);
    PERFORM pg_stat_clear_snapshot();   -- r3: lista sesiunilor reluată la fiecare pas
    SELECT d.pid INTO v_d FROM pg_stat_activity d JOIN pg_stat_activity s ON s.application_name = 'rlp17_$3_s'
     WHERE d.application_name = 'rlp17_$3_m' AND d.wait_event_type = 'Lock' AND s.pid = ANY (pg_blocking_pids(d.pid)) LIMIT 1;
    IF v_d IS NOT NULL THEN RAISE NOTICE '$3 CONTROL: scrierea directa (pid %) asteapta salvarea; eliberez activitatea', v_d; EXIT; END IF;
    i := i + 1;
    IF i > 400 THEN RAISE EXCEPTION 'PROBA_NEFUNCTIONALA $3: in 20 s scrierea directa nici n-a terminat, nici n-a fost vazuta asteptand salvarea'; END IF;
    PERFORM pg_sleep(0.05);
  END LOOP;
END \$b\$;
COMMIT;
SELECT pg_advisory_unlock($1);
SQL
  fi
}
# salvarea prin RPC-ul real; refuzul e prins și tipărit (sub-tranzacția salvării nu scrie nimic atunci). Proba NU anulează tranzacția
#   salvării (r1 o anula când „nu așteptase destul”): rezultatul se citește din NOTICE și din ce e comis.
salvare() {   # $1 = scenariu, $2 = bariera controlului, $3 = ziua, $4 = versiunea, $5 = COMMIT | ROLLBACK, $6 = distribuția (implicit NULL)
  cat <<SQL
\set ON_ERROR_STOP 1
$(asteapta "$2")
BEGIN; $JWT
SET LOCAL lock_timeout = '20s';
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp(); r jsonb;
BEGIN
  BEGIN
    r := public.fn_raport_zilnic_salveaza($SITE, DATE '$3', '{"probleme": "Proba linii proiect $1"}'::jsonb, $LINII, ${6:-NULL}, $4, gen_random_uuid());
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
# r4: proiectele tronsoanelor rândurilor de distribuție ale raportului zilei
proiecte_distributie() { q -c "SELECT coalesce((SELECT string_agg(DISTINCT u.proiect_id::text, ',') FROM public.raport_distributie_linii d
                                                  JOIN public.rapoarte_zilnice z ON z.id = d.raport_id JOIN public.proiect_unitati u ON u.id = d.unitate_id
                                                 WHERE z.site_id = $SITE AND z.data = DATE '$1'), '-')"; }
tronsoane_distributie() { q -c "SELECT coalesce((SELECT string_agg(d.unitate_id::text, ',' ORDER BY d.nr_crt) FROM public.raport_distributie_linii d
                                                   JOIN public.rapoarte_zilnice z ON z.id = d.raport_id WHERE z.site_id = $SITE AND z.data = DATE '$1'), '-')"; }
proiect_santier() { q -c "SELECT proiect_id FROM public.sites WHERE id = $SITE"; }
raport_sintetic() {   # $1 = ziua; raport cu rezumat automat pe proiectul de acum (garda), comis
  q -c "INSERT INTO public.rapoarte_zilnice (site_id, data, probleme, created_by, updated_at)
        VALUES ($SITE, DATE '$1', 'Proba linii proiect (existent)', '$OWNER', now());" >/dev/null
}
# r4: raport salvat prin RPC (comis), cu linia activității sintetice și, opțional, distribuția (L6 / L8: ținta scrierii directe)
raport_salvat() {   # $1 = ziua, $2 = distribuția (implicit NULL)
  q -c "BEGIN; $JWT
        SELECT public.fn_raport_zilnic_salveaza($SITE, DATE '$1', '{\"probleme\": \"Proba linii proiect (pregatire)\"}'::jsonb, $LINII, ${2:-NULL}, 0, gen_random_uuid())::text;
        COMMIT;" | grep -c '"ok": true' || true
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
  r := public.fn_raport_zilnic_salveaza($SITE, DATE '2001-02-05', '{"probleme": "Proba linii proiect L0"}'::jsonb, $LINII, $DISTRIB, 0, gen_random_uuid());
  IF r ->> 'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FAIL L0: %', r; END IF;
  IF clock_timestamp() - t0 >= interval '1 second' THEN RAISE EXCEPTION 'FAIL L0: salvarea normala a asteptat (%)', clock_timestamp() - t0; END IF;
  RAISE NOTICE 'L0 salvare normala: % in %', r, clock_timestamp() - t0;
END \$t\$;
COMMIT;
SQL
set +e; "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/l0.sql" > "$TMP/l0.log" 2>&1; RC=$?; set -e
cat "$TMP/l0.log"
L="$(proiecte_linii 2001-02-05)"; D="$(proiecte_distributie 2001-02-05)"
if [ "$RC" = 0 ] && [ "$L" = "$P0" ] && [ "$D" = "$P0" ]; then R=OK; else R=CONTRAR; fi
verdict "$R" "L0 salvare normala cu linii + distributie (fara mutare): iesire $RC, liniile pe '$L', tronsoanele pe '$D' (asteptat '$P0')"
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
  elif grep -q "$1 SALVARE refuz 22023" "$TMP/$1_s.log" && grep -qF "de pe linie e din alt proiect decât cel în care e acum șantierul raportului" "$TMP/$1_s.log" \
       && [ "$linii" = "-" ] && { [ "$1" != L1 ] || [ "$zi" = "-" ]; }; then
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

# ── L3 / L5 / L7: calea directă (INSERT ca postgres, fără RPC) în timpul unei mutări în zbor ──
# Mutarea ține rândul șantierului (UPDATE necomis) + bariera W; scrierea pornește după W. Mutarea COMITE abia când vede scrierea fie
#   blocată de ea (pg_blocking_pids), fie terminată (bariera D, luată de scriere după încercare): ordinea e garantată de lock-uri, nu de timp.
#   L3: linia cu activitatea sintetică (a lui P0); L5 (r3): linia FĂRĂ activitate; L7 (r4): rândul de distribuție cu tronsonul TLPC1 (al lui P0).
# Rezultatul (r4): DEFECT = scrierea a trecut și rândul e pe P0 cu șantierul în P1 (azi și cu mutanții fara_for_share / distributie_fara_lock:
#   fără să aștepte); INCHIS = refuz 55P03 „reîncearcă” fără așteptare (garda nu așteaptă șantierul ocupat), nimic scris.
directa() {   # $1 = scenariu, $2 = ziua, $3 = instrucțiunea (cu __Z__ = id-ul raportului), $4 = funcția care citește proiectele rândurilor zilei,
              # $5 $6 = barierele W / D, $7 = rezultatul cerut (implicit --asteptat)
  local sc="$1" zi="$2" instr="$3" citire="$4" bw="$5" bd="$6" ast="${7:-$ASTEPTAT}" z l s fapt txt astept
  raport_sintetic "$zi"; muta "$P1"; muta "$P0"   # raport 'de_recompus': mutarea nu-i ia rândul (doar șantierul o poate opri)
  z="$(zi_raport "$zi")"; instr="${instr//__Z__/$z}"
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
    $instr;
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
  l="$("$citire" "$zi")"; s="$(proiect_santier)"
  if [ "$RC_M$RC_W" != 00 ] || ! grep -q "$sc BARIERA" "$TMP/${sc}_m.log" || [ "$s" != "$P1" ]; then
    verdict NEFUNCTIONAL "$sc: mutarea in zbor nu s-a putut observa / comite (iesiri mutare $RC_M, scriere $RC_W; santierul in P$s) - rezultatul scrierii nu se judeca"
  elif grep -Eq "$sc DIRECT refuz (23502|23514|23505) " "$TMP/${sc}_w.log" && ! grep -q "$sc DIRECT refuz 23514 .*nu aparține proiectului raportului" "$TMP/${sc}_w.log"; then
    verdict NEFUNCTIONAL "$sc: schema clonei nu primeste randul de proba (NOT NULL / CHECK / UNIQUE; vezi NOTICE-ul scrierii) - rezultatul nu se judeca"
  else
    if grep -q "$sc BARIERA scrierea directa (pid" "$TMP/${sc}_m.log"; then astept="dupa ce a asteptat mutarea"; else astept="fara asteptare"; fi
    if grep -q "$sc DIRECT trecuta" "$TMP/${sc}_w.log" && [ "$l" = "$P0" ]; then
      fapt=defect; txt="DEFECT reprodus pe calea directa: randul pe P$l scris $astept, santierul mutat in P$s"
    elif [ "$astept" = "fara asteptare" ] && grep -q "$sc DIRECT refuz 55P03" "$TMP/${sc}_w.log" && grep -qF "$FRAG_OCUPAT" "$TMP/${sc}_w.log" && [ "$l" = "-" ]; then
      fapt=inchis; txt="FEREASTRA INCHISA pe calea directa: santierul ocupat de mutare = refuz 55P03 fara asteptare (randuri '$l')"
    else
      fapt=altceva; txt="rezultat neclasificat pe calea directa (randuri '$l', scrierea $astept; vezi NOTICE-urile)"
    fi
    [ "$fapt" != defect ] || DEFECT_VAZUT=1
    if [ "$fapt" = "$ast" ]; then verdict OK "$sc $txt (asteptat: $ast)"; else verdict CONTRAR "$sc $txt (asteptat: $ast)"; fi
  fi
  muta "$P0"
}
INS_L3="INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, cantitate) VALUES (__Z__, $P0, $ACT, 1)"
INS_L5="INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, cantitate) VALUES (__Z__, $P0, $ACT_L5, 1)"
INS_L7="INSERT INTO public.raport_distributie_linii (raport_id, tabel, nr_crt, unitate_id) VALUES (__Z__, 'conducta', 1, $U0)"
case "$MUTANT" in
  "") directa L3 2001-02-03 "$INS_L3" proiecte_linii 172170031 172170032
      directa L5 2001-02-06 "$INS_L5" proiecte_linii 172170051 172170052
      directa L7 2001-02-10 "$INS_L7" proiecte_distributie 172170071 172170072 ;;
  fara_for_share) directa L3 2001-02-03 "$INS_L3" proiecte_linii 172170031 172170032 defect ;;
  distributie_fara_lock) directa L7 2001-02-10 "$INS_L7" proiecte_distributie 172170071 172170072 defect ;;
esac

# ── L5c (r4): linia FĂRĂ activitate scrisă direct DUPĂ ce mutarea a comis: doar comparația proiectului o vede ──
dupa_mutare() {   # $1 = scenariu, $2 = ziua, $3 = rezultatul cerut (implicit --asteptat)
  local sc="$1" zi="$2" ast="${3:-$ASTEPTAT}" z l s fapt txt
  raport_sintetic "$zi"; z="$(zi_raport "$zi")"; muta "$P1"
  cat > "$TMP/${sc}_w.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN;
DO \$t\$
BEGIN
  BEGIN
    ${INS_L5//__Z__/$z};
    RAISE NOTICE '$sc DIRECT trecuta';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '$sc DIRECT refuz % (%)', SQLSTATE, SQLERRM;
  END;
END \$t\$;
COMMIT;
SQL
  set +e; PGAPPNAME="rlp17_${sc}_w" "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/${sc}_w.sql" > "$TMP/${sc}_w.log" 2>&1; RC_W=$?; set -e
  cat "$TMP/${sc}_w.log"
  l="$(proiecte_linii "$zi")"; s="$(proiect_santier)"
  if [ "$RC_W" != 0 ] || [ "$s" != "$P1" ]; then
    verdict NEFUNCTIONAL "$sc: scrierea / mutarea nu au rulat (iesire $RC_W, santierul in P$s)"
  elif grep -Eq "$sc DIRECT refuz (23502|23514) " "$TMP/${sc}_w.log"; then
    verdict NEFUNCTIONAL "$sc: schema clonei nu primeste linia de proba (NOT NULL / CHECK) - rezultatul nu se judeca"
  else
    if grep -q "$sc DIRECT trecuta" "$TMP/${sc}_w.log" && [ "$l" = "$P0" ]; then
      fapt=defect; txt="DEFECT reprodus: linia pe P$l scrisa dupa mutarea comisa, santierul in P$s"
    elif grep -q "$sc DIRECT refuz 22023" "$TMP/${sc}_w.log" && grep -qF "$FRAG" "$TMP/${sc}_w.log" && [ "$l" = "-" ]; then
      fapt=inchis; txt="FEREASTRA INCHISA: dupa mutare, comparatia refuza 22023 (linii '$l')"
    else
      fapt=altceva; txt="rezultat neclasificat (linii '$l'; vezi NOTICE-ul)"
    fi
    [ "$fapt" != defect ] || DEFECT_VAZUT=1
    if [ "$fapt" = "$ast" ]; then verdict OK "$sc $txt (asteptat: $ast)"; else verdict CONTRAR "$sc $txt (asteptat: $ast)"; fi
  fi
  muta "$P0"
}
case "$MUTANT" in
  "") dupa_mutare L5c 2001-02-11 ;;
  fara_comparatie) dupa_mutare L5c 2001-02-11 defect ;;   # doar comparația vede linia L5c
esac

# ── L6u / L6i / L6d / L8 (r4): salvarea RPC în curs (ține raportul) + o scriere directă pe același raport, fără mutare ──
# Raportul e salvat întâi prin RPC (comis: linia activității sintetice; L8: și distribuția cu TLPC1). Apoi salvarea scenariului îl reia (ține
#   rândul raportului FOR UPDATE de la pasul 1 și stă la activitatea ținută de control), iar scrierea directă (sesiunea M) pornește când o
#   vede așa. Rezultatul: INCHIS = salvarea trece, scrierea directă e refuzată 55P03 „reîncearcă” IMEDIAT (sub 1 s), niciun 40P01;
#   TRECE (L6d) = DELETE-ul direct trece fără să aștepte, salvarea trece; DEFECT (mutantul cu_asteptare) = 40P01 în oricare sesiune.
cu_salvarea() {   # $1 = scenariu, $2 = ziua, $3 = instrucțiunea directă (cu __Z__), $4 = distribuția salvării, $5 $6 = barierele C / M, $7 = rezultatul cerut
  local sc="$1" zi="$2" instr="$3" distr="$4" bc="$5" bm="$6" ast="$7" z n l d fapt txt
  n="$(raport_salvat "$zi" "$distr")"; z="$(zi_raport "$zi")"
  if [ "$n" != 1 ] || [ "$z" = "-" ]; then verdict NEFUNCTIONAL "$sc: raportul de plecare nu s-a putut salva prin RPC"; return 0; fi
  instr="${instr//__Z__/$z}"
  control "$bc" "$bm" "$sc" > "$TMP/${sc}_c.sql"
  salvare "$sc" "$bc" "$zi" "$(versiune "$zi")" COMMIT "$distr" > "$TMP/${sc}_s.sql"
  cat > "$TMP/${sc}_m.sql" <<SQL
\set ON_ERROR_STOP 1
$(asteapta_salvarea "$sc" "$bc")
BEGIN;
SET LOCAL lock_timeout = '20s';
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp(); n int;
BEGIN
  BEGIN
    $instr;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '$sc DIRECT trecuta (% randuri) dupa %', n, clock_timestamp() - t0;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '$sc DIRECT refuz % (%) dupa %', SQLSTATE, SQLERRM, clock_timestamp() - t0;
  END;
END \$t\$;
COMMIT;
SELECT pg_advisory_lock($bm);
$(asteapta_eliberarea "$bc")
SELECT pg_advisory_unlock($bm);
SQL
  ruleaza_trei "$sc"
  l="$(proiecte_linii "$zi")"; d="$(tronsoane_distributie "$zi")"
  if [ "$RC_C$RC_S$RC_M" != 000 ] || ! grep -q "$sc BARIERA tine" "$TMP/${sc}_m.log"; then
    verdict NEFUNCTIONAL "$sc: salvarea nu a fost tinuta la bariera (iesiri control $RC_C, salvare $RC_S, directa $RC_M) - rezultatul nu se judeca"
    return 0
  fi
  if grep -q "40P01" "$TMP/${sc}_s.log" "$TMP/${sc}_m.log"; then
    fapt=defect; txt="DEADLOCK reprodus (40P01): $(grep -h -o "$sc [A-Z]* refuz 40P01" "$TMP/${sc}_s.log" "$TMP/${sc}_m.log" | head -1 || true)"
  elif grep -qF "$sc SALVARE rezultat {\"ok\": true" "$TMP/${sc}_s.log" && [ "$l" = "$P0" ] \
       && grep -Eq "$sc DIRECT refuz 55P03 .* dupa 00:00:00\." "$TMP/${sc}_m.log" && grep -qF "$FRAG_OCUPAT" "$TMP/${sc}_m.log"; then
    fapt=inchis; txt="FARA CICLU: scrierea directa refuzata imediat 55P03 (reincearca), salvarea trecuta (linii '$l', tronsoane '$d')"
  elif grep -qF "$sc SALVARE rezultat {\"ok\": true" "$TMP/${sc}_s.log" && [ "$l" = "$P0" ] \
       && grep -Eq "$sc DIRECT trecuta .* dupa 00:00:00\." "$TMP/${sc}_m.log"; then
    fapt=trece; txt="FARA CICLU: scrierea directa trecuta fara asteptare, salvarea trecuta dupa ea (linii '$l', tronsoane '$d')"
  else
    fapt=altceva; txt="rezultat neclasificat (linii '$l', tronsoane '$d'; vezi NOTICE-urile)"
  fi
  [ "$fapt" != defect ] || DEFECT_VAZUT=1
  if [ "$fapt" = "$ast" ]; then verdict OK "$sc $txt (asteptat: $ast)"; else verdict CONTRAR "$sc $txt (asteptat: $ast)"; fi
}
UPD_L6="UPDATE public.raport_lucrari SET proiect_id = $P1 WHERE raport_id = __Z__"
INS_L6="INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, cantitate) VALUES (__Z__, $P0, $ACT, 3)"
DEL_L6="DELETE FROM public.raport_lucrari WHERE raport_id = __Z__"
UPD_L8="UPDATE public.raport_distributie_linii SET unitate_id = $U0B WHERE raport_id = __Z__"
if [ "$ASTEPTAT" = defect ]; then
  echo "L6 / L8: sarite fara migrare (probeaza gardurile noi fata de salvare; azi scrierea directa nu ia niciun lock)"
else
  case "$MUTANT" in
    "") cu_salvarea L6u 2001-02-07 "$UPD_L6" NULL 172170061 172170062 inchis
        cu_salvarea L6i 2001-02-08 "$INS_L6" NULL 172170063 172170064 inchis
        cu_salvarea L6d 2001-02-09 "$DEL_L6" NULL 172170065 172170066 trece
        cu_salvarea L8 2001-02-12 "$UPD_L8" "$DISTRIB" 172170081 172170082 inchis ;;
    cu_asteptare) cu_salvarea L6u 2001-02-07 "$UPD_L6" NULL 172170061 172170062 defect
                  cu_salvarea L8 2001-02-12 "$UPD_L8" "$DISTRIB" 172170081 172170082 defect ;;
  esac
fi

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
