#!/usr/bin/env bash
# Proba de CONCURENȚĂ pentru 20261217a (liniile raportului pe proiectul șantierului citit sub lock) — DOAR pe CLONĂ, cu sesiuni psql reale
# (L25). Tiparul: scripts/raport_rezumat_concurenta.sh.
# Rulare din Git Bash, cu psql de Windows; conexiunea după `--` (parola din pgpass, niciodată pe linia de comandă):
#   PSQL=/c/Users/Public/pgsql/bin/psql.exe bash scripts/raport_linii_proiect_concurenta.sh --sistem <system_identifier al clonei> \
#        [--asteptat defect|inchis] [--mutant fara_comparatie|fara_for_share] -- -h <host clonă> -p <port> -U postgres -d postgres
#   --asteptat defect = ÎNAINTE de 20261217a pe clonă: scenariile L1–L3 trebuie să arate defectul (dovada că există azi);
#   --asteptat inchis (implicit) = DUPĂ 20261217a: fereastra închisă.
# Garda țintei: system_identifier al bazei (pg_control_system()) trebuie să fie EXACT --sistem, altfel refuz (cod 22) înainte de orice scriere.
# Datele: pe PRIMUL șantier cu proiect (P0) fără rezumate corectate de om: o activitate SINTETICĂ a lui P0 și rapoarte SINTETICE în zilele
#   2001-02-01 … 05, COMISE pe clonă (sesiunile trebuie să le vadă) și șterse la final (trap), oricare ar fi rezultatul; șantierul e mutat în
#   alt proiect (P1) în scenarii și pus la loc în P0 după fiecare și în trap. Identitatea salvărilor: owner-ul sintetic al clonei
#   (00000000-0000-4000-8000-000000000001, schimbabil cu OWNER=<uuid>), rolul authenticated, JWT-ul în ambele surse.
# Fereastra se deschide cu o sesiune de CONTROL care ține activitatea sintetică FOR UPDATE: salvarea (RPC-ul real) citește proiectul la pasul 1,
#   apoi se oprește la pasul 5 (activitățile FOR SHARE); abia când salvarea e văzută în așteptare (pg_stat_activity), a doua sesiune mută
#   șantierul și COMITE; apoi controlul eliberează activitatea și salvarea continuă.
# Scenarii:
#   L0 salvare normală (raport nou, fără mutare): trece, fără așteptare (L20: calea legitimă nu începe să pice);
#   L1 raport NOU, mutarea comisă în fereastră -> inchis: refuz 22023 („șantierul raportului e acum în alt proiect”), nimic scris;
#      defect: salvarea trece cu liniile pe P0, șantierul în P1;
#   L2 raport EXISTENT fără rezumat valabil ('de_recompus', ca rapoartele de dinainte de 20261216a) -> la fel ca L1;
#   L3 calea directă (INSERT ca postgres) în timpul unei mutări în zbor -> inchis: AȘTEAPTĂ mutarea (≥ 1 s), apoi refuz 22023;
#      defect: trece imediat, cu proiectul vechi;
#   L4 raport existent CU rezumat automat ținut de o salvare în fereastră + mutarea -> mutarea refuză IMEDIAT (55P03, NOWAIT din 20261216a),
#      fără deadlock, iar salvarea trece pe P0 (șantierul rămas în P0) — la fel înainte și după 20261217a.
# Mutanți (--mutant <nume>, cu 20261217a aplicată): funcția gărzii e stricată pe clonă (CREATE OR REPLACE din pg_get_functiondef), rulează
#   DOAR scenariul care trebuie s-o prindă, apoi se pune la loc în trap (amprenta corpului verificată). Ieșire 0 = mutantul a fost PRINS.
#   fara_comparatie = linia nu se mai compară cu proiectul șantierului (L1 trebuie să pice); fara_for_share = șantierul citit fără lock (L3).
# Ieșire: 0 = toate scenariile cum trebuie (cu --mutant: mutantul prins); 1 = un scenariu a picat (cu --mutant: mutantul a scăpat); 2 = argumente;
#   22 = altă țintă; 23 = starea migrării nu e cea cerută de --asteptat; 24 = date de test lipsă / ocupate; 25 = funcția nu s-a putut pune la loc.
set -euo pipefail
PSQL="${PSQL:-psql}"
export PGCLIENTENCODING=UTF8
SISTEM=""; MUTANT=""; ASTEPTAT="inchis"
while [ $# -gt 0 ]; do
  case "$1" in
    --sistem) SISTEM="${2:-}"; shift 2 ;;
    --mutant) MUTANT="${2:-}"; shift 2 ;;
    --asteptat) ASTEPTAT="${2:-}"; shift 2 ;;
    --) shift; break ;;
    *) echo "argument necunoscut: $1 (conexiunea vine după --)" >&2; exit 2 ;;
  esac
done
CONN=("$@")
[[ "$SISTEM" =~ ^[0-9]+$ ]] || { echo "lipseste --sistem <system_identifier al clonei> (numar)" >&2; exit 2; }
case "$ASTEPTAT" in defect|inchis) ;; *) echo "--asteptat defect|inchis" >&2; exit 2 ;; esac
case "$MUTANT" in ""|fara_comparatie|fara_for_share) ;; *) echo "mutant necunoscut: $MUTANT" >&2; exit 2 ;; esac
if [ -n "$MUTANT" ] && [ "$ASTEPTAT" != inchis ]; then echo "--mutant cere migrarea aplicata (--asteptat inchis)" >&2; exit 2; fi
OWNER="${OWNER:-00000000-0000-4000-8000-000000000001}"
[[ "$OWNER" =~ ^[0-9a-f-]{36}$ ]] || { echo "OWNER invalid" >&2; exit 2; }
cd "$(dirname "$0")/.."
TMP="$(mktemp -d ./.concurenta_20261217a.XXXXXX)"   # în repo: căi relative, fără conversia /tmp pentru psql de Windows
q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" "$@"; }

REAL="$(q -c "SELECT system_identifier FROM pg_control_system()")"
if [ "$REAL" != "$SISTEM" ]; then echo "REFUZ: system_identifier al bazei ($REAL) <> --sistem ($SISTEM)" >&2; rm -rf "$TMP"; exit 22; fi
APLICATA="$(q -c "SELECT to_regprocedure('public.fn_raport_lucrari_proiect_garda()') IS NOT NULL")"
if { [ "$ASTEPTAT" = inchis ] && [ "$APLICATA" != t ]; } || { [ "$ASTEPTAT" = defect ] && [ "$APLICATA" != f ]; }; then
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
if [ "$(q -c "SELECT EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data BETWEEN DATE '2001-02-01' AND DATE '2001-02-05')")" != f ]; then
  echo "REFUZ: zilele de test 2001-02-01 ... 05 sunt ocupate pe santierul $SITE (nu sterg nimic)" >&2; rm -rf "$TMP"; exit 24
fi

ACT=""; FN_ORIG=""
muta() { q -c "UPDATE public.sites SET proiect_id = $1 WHERE id = $SITE AND proiect_id IS DISTINCT FROM $1;" >/dev/null; }
curata() {
  local rc=0
  if [ -n "$FN_ORIG" ]; then
    if ! q -f "$TMP/garda_orig.sql" >/dev/null || [ "$(q -c "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_raport_lucrari_proiect_garda()'::regprocedure")" != "$FN_ORIG" ]; then
      echo "ATENTIE: fn_raport_lucrari_proiect_garda NU s-a putut pune la loc pe clona (definitia originala ramane in garda_orig_20261217a.sql)" >&2
      cp "$TMP/garda_orig.sql" ./garda_orig_20261217a.sql 2>/dev/null || true; rc=25
    else echo "mutant: functia garzii pusa la loc (amprenta $FN_ORIG)"; fi
  fi
  q -c "DELETE FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data BETWEEN DATE '2001-02-01' AND DATE '2001-02-05' AND probleme LIKE 'Proba linii proiect%';" >/dev/null \
    || echo "ATENTIE: de sters manual pe clona: rapoartele 2001-02-01 ... 05 ale santierului $SITE" >&2
  [ -z "$ACT" ] || q -c "DELETE FROM public.proiect_activitati WHERE id = $ACT AND nume = 'Activitate proba linii proiect';" >/dev/null \
    || echo "ATENTIE: de sters manual pe clona: activitatea $ACT" >&2
  muta "$P0" || echo "ATENTIE: de pus la loc manual pe clona: santierul $SITE in proiectul $P0" >&2
  rm -rf "$TMP"
  return "$rc"
}
trap 'curata || exit 25' EXIT

ACT="$(q -c "INSERT INTO public.proiect_activitati (proiect_id, nume, um, tip_raportare, ordine, activ)
             VALUES ($P0, 'Activitate proba linii proiect', 'm', 'cantitate', 999, true) RETURNING id" | head -1)"
[[ "$ACT" =~ ^[0-9]+$ ]] || { echo "activitatea sintetica: iesire neasteptata: $ACT" >&2; ACT=""; exit 1; }
LINII="'[{\"activitate_id\": $ACT, \"unitate_id\": null, \"cantitate\": 2}]'::jsonb"
JWT="SELECT set_config('request.jwt.claim.sub', '$OWNER', true), set_config('request.jwt.claims', json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;"
FRAG='șantierul raportului e acum în alt proiect'

case "$MUTANT" in
  fara_comparatie|fara_for_share)
    q -c "SELECT pg_get_functiondef('public.fn_raport_lucrari_proiect_garda()'::regprocedure) || ';'" > "$TMP/garda_orig.sql"
    FN_ORIG="$(q -c "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.fn_raport_lucrari_proiect_garda()'::regprocedure")"
    if [ "$MUTANT" = fara_comparatie ]; then DIN='IF NEW.proiect_id IS DISTINCT FROM v_proiect THEN'; IN='IF false THEN'
    else DIN='WHERE s.id = v_site FOR SHARE OF s;'; IN='WHERE s.id = v_site;'; fi
    q -c "DO \$m\$ DECLARE d text := pg_get_functiondef('public.fn_raport_lucrari_proiect_garda()'::regprocedure); BEGIN
            IF position('$DIN' IN d) = 0 THEN RAISE EXCEPTION 'mutantul nu gaseste textul de inlocuit'; END IF;
            EXECUTE replace(d, '$DIN', '$IN'); END \$m\$;" >/dev/null
    echo "mutant $MUTANT aplicat pe clona" ;;
esac

# așteaptă până când lock-ul consultativ $1 (bariera) e ținut de altă sesiune, cel mult 20 s
asteapta() {
  echo "DO \$b\$ DECLARE i int := 0; BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND objsubid = 1 AND granted) LOOP
      PERFORM pg_sleep(0.05); i := i + 1; IF i > 400 THEN RAISE EXCEPTION 'bariera $1 nu a aparut'; END IF; END LOOP; END \$b\$;"
}
# așteaptă până când o sesiune care salvează raportul stă la un lock (pasul 5 al RPC-ului), cel mult 20 s
asteapta_salvarea() {
  echo "DO \$b\$ DECLARE i int := 0; BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.pid <> pg_backend_pid() AND a.wait_event_type = 'Lock'
                        AND a.query LIKE '%fn_raport_zilnic_salveaza%' AND a.query LIKE '%Proba linii proiect%') LOOP
      PERFORM pg_sleep(0.05); i := i + 1; IF i > 400 THEN RAISE EXCEPTION 'salvarea nu a ajuns in asteptare la activitate'; END IF; END LOOP; END \$b\$;"
}
ESEC=0
verdict() { if [ "$1" = "0" ]; then echo "OK   $2"; else echo "FAIL $2"; ESEC=1; fi; }
# trei sesiuni: control (C), salvarea (S), mutarea (M); codul de ieșire al fiecăreia se păstrează (wait PID)
ruleaza_trei() {   # $1 = scenariu; fișierele $TMP/$1_c.sql, $TMP/$1_s.sql, $TMP/$1_m.sql
  "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_c.sql" > "$TMP/$1_c.log" 2>&1 & PID_C=$!
  "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_s.sql" > "$TMP/$1_s.log" 2>&1 & PID_S=$!
  "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_m.sql" > "$TMP/$1_m.log" 2>&1 & PID_M=$!
  set +e; wait $PID_C; RC_C=$?; wait $PID_S; RC_S=$?; wait $PID_M; RC_M=$?; set -e
  cat "$TMP/$1_c.log" "$TMP/$1_s.log" "$TMP/$1_m.log"
}
# controlul: ține activitatea FOR UPDATE până când mutarea a terminat (bariera $2 a mutării)
control() {   # $1 = bariera controlului, $2 = bariera mutării
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
# salvarea prin RPC-ul real; refuzul e prins și tipărit (tranzacția salvării nu scrie nimic atunci); trebuie să fi așteptat la activitate
salvare() {   # $1 = scenariu, $2 = bariera controlului, $3 = ziua, $4 = versiunea
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
  IF clock_timestamp() - t0 < interval '1 second' THEN RAISE EXCEPTION 'FAIL $1: salvarea nu a asteptat la activitate (fereastra nu s-a deschis)'; END IF;
END \$t\$;
COMMIT;
SQL
}
# mutarea, după ce salvarea stă la activitate; refuzul (L4: 55P03) e prins și tipărit; apoi bariera pentru control
mutare() {   # $1 = scenariu, $2 = bariera mutării
  cat <<SQL
\set ON_ERROR_STOP 1
$(asteapta_salvarea)
BEGIN;
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp();
BEGIN
  BEGIN
    UPDATE public.sites SET proiect_id = $P1 WHERE id = $SITE;
    RAISE NOTICE '$1 MUTARE trecuta dupa %', clock_timestamp() - t0;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '$1 MUTARE refuz % (%) dupa %', SQLSTATE, SQLERRM, clock_timestamp() - t0;
  END;
END \$t\$;
COMMIT;
SELECT pg_advisory_lock($2);
SELECT pg_sleep(3);
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
if [ "$RC" = 0 ] && [ "$L" = "$P0" ]; then R=0; else R=1; fi
verdict "$R" "L0 salvare normala (fara mutare): iesire $RC, liniile pe '$L' (asteptat '$P0')"
fi

# ── L1 / L2: salvarea în fereastră, mutarea comisă între citirea proiectului și scrierea antetului ──
fereastra() {   # $1 = scenariu, $2 = ziua, $3 = versiunea, $4 $5 = barierele
  control "$4" "$5" > "$TMP/$1_c.sql"
  salvare "$1" "$4" "$2" "$3" > "$TMP/$1_s.sql"
  mutare "$1" "$5" > "$TMP/$1_m.sql"
  ruleaza_trei "$1"
  local santier linii zi; santier="$(proiect_santier)"; linii="$(proiecte_linii "$2")"; zi="$(zi_raport "$2")"
  local mutat=1; grep -q "$1 MUTARE trecuta" "$TMP/$1_m.log" && mutat=0
  if [ "$ASTEPTAT" = inchis ]; then
    if [ "$RC_C$RC_S$RC_M" = 000 ] && [ "$mutat" = 0 ] && [ "$santier" = "$P1" ] && grep -q "$1 SALVARE refuz 22023" "$TMP/$1_s.log" && grep -qF "$FRAG" "$TMP/$1_s.log" \
       && [ "$linii" = "-" ] && { [ "$1" != L1 ] || [ "$zi" = "-" ]; }; then R=0; else R=1; fi
    verdict "$R" "$1 fereastra inchisa: salvarea refuzata 22023, nimic scris (raport '$zi', linii '$linii'), santierul in P$santier; iesiri $RC_C/$RC_S/$RC_M"
  else
    if [ "$RC_C$RC_S$RC_M" = 000 ] && [ "$mutat" = 0 ] && [ "$santier" = "$P1" ] && grep -q "$1 SALVARE rezultat" "$TMP/$1_s.log" && [ "$linii" = "$P0" ]; then R=0; else R=1; fi
    verdict "$R" "$1 DEFECT reprodus: liniile pe P$linii, santierul in P$santier (asteptat P$P0 / P$P1); iesiri $RC_C/$RC_S/$RC_M"
  fi
  muta "$P0"
}
if [ -z "$MUTANT" ] || [ "$MUTANT" = fara_comparatie ]; then
  fereastra L1 2001-02-01 0 172170011 172170012
fi
if [ -z "$MUTANT" ]; then
  raport_sintetic 2001-02-02; muta "$P1"; muta "$P0"   # automat pe P0 -> mutarea îl trece în 'de_recompus' -> înapoi în P0 (nu-l mai atinge)
  if [ "$(q -c "SELECT rezumat_sursa FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data = DATE '2001-02-02'")" != de_recompus ]; then
    echo "FAIL L2: raportul de plecare nu e 'de_recompus'"; ESEC=1
  else
    fereastra L2 2001-02-02 "$(versiune 2001-02-02)" 172170021 172170022
  fi
fi

# ── L3: calea directă (INSERT ca postgres, fără RPC) în timpul unei mutări în zbor ──
if [ -z "$MUTANT" ] || [ "$MUTANT" = fara_for_share ]; then
  raport_sintetic 2001-02-03; muta "$P1"; muta "$P0"   # raport 'de_recompus': mutarea nu-i ia rândul (doar șantierul o poate opri)
  Z3="$(zi_raport 2001-02-03)"
  cat > "$TMP/l3_m.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN;
UPDATE public.sites SET proiect_id = $P1 WHERE id = $SITE;
SELECT pg_advisory_xact_lock(172170031);
SELECT pg_sleep(3);
COMMIT;
SQL
  cat > "$TMP/l3_w.sql" <<SQL
\set ON_ERROR_STOP 1
$(asteapta 172170031)
BEGIN;
SET LOCAL lock_timeout = '20s';
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp();
BEGIN
  BEGIN
    INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, cantitate) VALUES ($Z3, $P0, $ACT, 1);
    RAISE NOTICE 'L3 DIRECT trecuta dupa %', clock_timestamp() - t0;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'L3 DIRECT refuz % (%) dupa %', SQLSTATE, SQLERRM, clock_timestamp() - t0;
  END;
  IF clock_timestamp() - t0 >= interval '1 second' THEN RAISE NOTICE 'L3 DIRECT a asteptat'; END IF;
END \$t\$;
COMMIT;
SQL
  "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/l3_m.sql" > "$TMP/l3_m.log" 2>&1 & PID_M=$!
  "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/l3_w.sql" > "$TMP/l3_w.log" 2>&1 & PID_W=$!
  set +e; wait $PID_M; RC_M=$?; wait $PID_W; RC_W=$?; set -e
  cat "$TMP/l3_m.log" "$TMP/l3_w.log"
  L="$(proiecte_linii 2001-02-03)"
  if [ "$ASTEPTAT" = inchis ]; then
    if [ "$RC_M$RC_W" = 00 ] && grep -q "L3 DIRECT refuz 22023" "$TMP/l3_w.log" && grep -qF "$FRAG" "$TMP/l3_w.log" && grep -q "L3 DIRECT a asteptat" "$TMP/l3_w.log" && [ "$L" = "-" ]; then R=0; else R=1; fi
    verdict "$R" "L3 calea directa in timpul mutarii: a asteptat mutarea, apoi refuz 22023 (linii '$L'); iesiri $RC_M/$RC_W"
  else
    if [ "$RC_M$RC_W" = 00 ] && grep -q "L3 DIRECT trecuta" "$TMP/l3_w.log" && [ "$L" = "$P0" ]; then R=0; else R=1; fi
    verdict "$R" "L3 DEFECT reprodus pe calea directa: linia pe P$L scrisa in timpul mutarii in P$P1; iesiri $RC_M/$RC_W"
  fi
  muta "$P0"
fi

# ── L4: raport existent CU rezumat automat, salvarea în fereastră + mutarea: mutarea refuză imediat (NOWAIT), salvarea trece ──
if [ -z "$MUTANT" ]; then
  raport_sintetic 2001-02-04
  control 172170041 172170042 > "$TMP/l4_c.sql"
  salvare L4 172170041 2001-02-04 "$(versiune 2001-02-04)" > "$TMP/l4_s.sql"
  mutare L4 172170042 > "$TMP/l4_m.sql"
  ruleaza_trei l4
  L="$(proiecte_linii 2001-02-04)"; S="$(proiect_santier)"
  if [ "$RC_C$RC_S$RC_M" = 000 ] && grep -q "L4 MUTARE refuz 55P03" "$TMP/l4_m.log" && grep -q "L4 SALVARE rezultat" "$TMP/l4_s.log" \
     && [ "$L" = "$P0" ] && [ "$S" = "$P0" ]; then R=0; else R=1; fi
  # mutarea trebuie să fi refuzat IMEDIAT (fără deadlock / fără așteptare)
  if grep -Eq "L4 MUTARE refuz 55P03 .* dupa 00:00:0[1-9]" "$TMP/l4_m.log"; then R=1; fi
  verdict "$R" "L4 salvare in fereastra pe raport cu rezumat + mutare: mutarea refuza imediat 55P03, salvarea trece (linii '$L', santierul P$S); iesiri $RC_C/$RC_S/$RC_M"
  muta "$P0"
fi

if [ -n "$MUTANT" ]; then
  if [ "$ESEC" = 1 ]; then echo "MUTANT $MUTANT PRINS"; exit 0; else echo "MUTANT $MUTANT SCAPAT (scenariul a trecut cu functia stricata)"; exit 1; fi
fi
[ "$ESEC" = 0 ] && echo "TOATE SCENARIILE OK (--asteptat $ASTEPTAT)"
exit "$ESEC"
