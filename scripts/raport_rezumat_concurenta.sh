#!/usr/bin/env bash
# Proba de CONCURENȚĂ pentru 20261216a (r3, Jakarinos P2: „Revino la automat” ocolea detectarea conflictului) — DOAR pe CLONĂ, cu două
# sesiuni psql reale (L25). Tiparul: scripts/izometrie_muta_pozitie_concurenta.sh.
# Rulare din Git Bash, cu psql de Windows (fără WSL, fără \!); conexiunea după `--` (parola din pgpass, niciodată pe linia de comandă):
#   PSQL=/c/Users/Public/pgsql/bin/psql.exe bash scripts/raport_rezumat_concurenta.sh --sistem <system_identifier al clonei> \
#        -- -h <host clonă> -p <port> -U postgres -d postgres
# Garda țintei: system_identifier al bazei (pg_control_system()) trebuie să fie EXACT --sistem, altfel refuz (cod 22) înainte de orice scriere.
# Datele: UN raport SINTETIC (primul șantier, ziua 2001-01-05, scris direct ca postgres), COMIS pe clonă pentru că sesiunile trebuie să-l
#   vadă, și șters la final (trap), indiferent de rezultat. Dacă ziua e deja ocupată pe acel șantier: refuz (cod 24), nimic șters.
#   Identitatea sesiunilor: owner-ul sintetic al clonei (00000000-0000-4000-8000-000000000001, schimbabil cu OWNER=<uuid>), cu rolul
#   authenticated și JWT-ul aplicației în ambele surse.
# Scenarii (cele „două telefoane care au citit aceeași versiune”; bariera = un lock consultativ ținut de sesiunea care „ține”):
#   S1 telefonul 1 face „Revino la automat” (CAS = V, tranzacție deschisă), telefonul 2 trimite corectura veche cu CAS = V peste el
#      → al doilea AȘTEAPTĂ rândul, apoi 0 rânduri (versiunea a crescut la V+1): conflict, nimic scris de el; rezumatul = automat, V+1;
#   S2 ordinea inversă: telefonul 1 salvează o corectură (CAS = V, deschisă), telefonul 2 face „Revino la automat” cu CAS = V
#      → al doilea așteaptă, apoi 0 rânduri; rămâne corectura telefonului 1, V+1;
#   S3 una după alta (fără suprapunere): „Revino la automat” comis, apoi corectura veche cu CAS = V → 0 rânduri.
#   r4 (mutarea șantierului în alt proiect, cu o salvare în zbor; șantierul e pus la loc în proiectul lui în trap):
#   S4 raport nou inserat (necomis) + mutarea → mutarea AȘTEAPTĂ, apoi raportul comis trece în 'de_recompus';
#   S5 mutarea înapoi (necomisă) + un raport nou → salvarea AȘTEAPTĂ și compune pe proiectul de după mutare.
#   r5 (Jakarinos r4 P1 / P2; protocolul pe rândul ȘANTIERULUI, nu pe tabel):
#   S6 un raport fără rezumat (vechi: NULL; sau 'de_recompus' după o mutare — aceeași ramură, mutarea nu-l atinge). Sesiunea 1 își ia
#      imaginea cu șantierul în proiectul A; sesiunea 2 mută șantierul în B și COMITE; sesiunea 1 cere „Generează” (rezumat_sursa = 'automat')
#      și comite. În REPEATABLE READ și SERIALIZABLE: eroare de serializare (40001), nimic scris; în READ COMMITTED: text compus pentru B.
#      Niciodată un rezumat compus pentru A pe un șantier aflat în B;
#   S7 mutarea în zbor (necomisă) pe șantierul 1 + o salvare pe ALT șantier → salvarea NU așteaptă (< 1 s): blocarea e doar pe șantierul mutat;
#   S8 o salvare ține rândul raportului (FOR UPDATE, ca pasul 1 al RPC-ului) + mutarea șantierului → mutarea refuză IMEDIAT (55P03, < 1 s),
#      fără deadlock; apoi salvarea trece și compune pe proiectul de acum.
#   La fiecare: codul de ieșire al fiecărei sesiuni se păstrează (wait PID), starea finală e citită din BD.
# Mutanți (--mutant <nume>, L25): funcția de pe clonă e stricată intenționat (CREATE OR REPLACE din pg_get_functiondef), rulează DOAR
#   scenariul care trebuie să o prindă, apoi se pune la loc în trap (amprenta corpului verificată). Ieșire 0 = mutantul a fost PRINS.
#   fara_for_share = garda citește proiectul fără lock (S6 trebuie să pice); fara_nowait = mutarea așteaptă rândurile rapoartelor (S8);
#   lock_tabel = mutarea blochează tot tabelul, ca în r4 (S7).
# Ieșire: 0 = toate scenariile OK (cu --mutant: mutantul prins); 1 = un scenariu a picat (cu --mutant: mutantul a scăpat); 2 = argumente;
#   22 = altă țintă; 23 = 20261216a neaplicată; 24 = owner-ul sintetic lipsește / ziua de test e ocupată; 25 = funcția nu s-a putut pune la loc.
set -euo pipefail
PSQL="${PSQL:-psql}"
# r5: textul care trece prin client (definiția funcției salvată pentru mutant, mesajele) rămâne UTF-8 oricare ar fi pagina de cod a consolei
export PGCLIENTENCODING=UTF8
SISTEM=""
MUTANT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sistem) SISTEM="${2:-}"; shift 2 ;;
    --mutant) MUTANT="${2:-}"; shift 2 ;;
    --) shift; break ;;
    *) echo "argument necunoscut: $1 (conexiunea vine după --)" >&2; exit 2 ;;
  esac
done
CONN=("$@")
[[ "$SISTEM" =~ ^[0-9]+$ ]] || { echo "lipseste --sistem <system_identifier al clonei> (numar)" >&2; exit 2; }
case "$MUTANT" in ""|fara_for_share|fara_nowait|lock_tabel) ;; *) echo "mutant necunoscut: $MUTANT" >&2; exit 2 ;; esac
OWNER="${OWNER:-00000000-0000-4000-8000-000000000001}"
[[ "$OWNER" =~ ^[0-9a-f-]{36}$ ]] || { echo "OWNER invalid" >&2; exit 2; }
cd "$(dirname "$0")/.."
TMP="$(mktemp -d ./.concurenta_20261216a.XXXXXX)"   # în repo: căi relative, fără conversia /tmp pentru psql de Windows
q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" "$@"; }
RAPORT=""
curata() {
  if [ -n "$RAPORT" ]; then
    if ! q -c "DELETE FROM public.rapoarte_zilnice WHERE id = $RAPORT AND data = DATE '2001-01-05';" >/dev/null; then
      echo "ATENTIE: curatenia a picat; de sters manual pe clona: raportul $RAPORT (ziua 2001-01-05)" >&2
    else echo "curatenie: raportul sintetic $RAPORT sters"; fi
  fi
  rm -rf "$TMP"
}
trap curata EXIT

REAL="$(q -c "SELECT system_identifier FROM pg_control_system()")"
if [ "$REAL" != "$SISTEM" ]; then echo "REFUZ: system_identifier al bazei ($REAL) <> --sistem ($SISTEM)" >&2; exit 22; fi
if [ "$(q -c "SELECT to_regprocedure('public.fn_raport_rezumat_garda()') IS NOT NULL")" != "t" ]; then
  echo "REFUZ: 20261216a nu e aplicata pe clona" >&2; exit 23
fi
if [ "$(q -c "SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = '$OWNER' AND is_owner IS TRUE)")" != "t" ]; then
  echo "REFUZ: owner-ul sintetic $OWNER lipseste de pe clona (sau nu e owner)" >&2; exit 24
fi
SITE="$(q -c "SELECT id FROM public.sites ORDER BY id LIMIT 1")"
[[ "$SITE" =~ ^[0-9]+$ ]] || { echo "nu gasesc un santier pe clona" >&2; exit 24; }
if [ "$(q -c "SELECT EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data = DATE '2001-01-05')")" != "f" ]; then
  echo "REFUZ: ziua de test 2001-01-05 e ocupata pe santierul $SITE (nu sterg nimic)" >&2; exit 24
fi

# ── raportul sintetic (comis, șters în trap) ──
RAPORT="$(q -c "INSERT INTO public.rapoarte_zilnice (site_id, data, probleme, created_by, updated_at)
                VALUES ($SITE, DATE '2001-01-05', 'Proba concurenta rezumat', '$OWNER', now()) RETURNING id" | head -1)"
[[ "$RAPORT" =~ ^[0-9]+$ ]] || { echo "raportul sintetic: iesire neasteptata: $RAPORT" >&2; RAPORT=""; exit 1; }

JWT="SELECT set_config('request.jwt.claim.sub', '$OWNER', true), set_config('request.jwt.claims', json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;"
# corectura de plecare, ca owner-ul (CAS pe versiunea curentă); întoarce versiunea de după
corecteaza() {
  cat > "$TMP/corectura.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN; $JWT
UPDATE public.rapoarte_zilnice SET rezumat_text = '$1', rezumat_sursa = 'editat' WHERE id = $RAPORT;
COMMIT;
SQL
  q -f "$TMP/corectura.sql" >/dev/null
  q -c "SELECT versiune_salvare FROM public.rapoarte_zilnice WHERE id = $RAPORT"
}
stare() { q -c "SELECT rezumat_sursa || '|' || versiune_salvare || '|' || coalesce(rezumat_text, '') FROM public.rapoarte_zilnice WHERE id = $RAPORT"; }
# așteaptă până când lock-ul consultativ $1 (bariera) e ținut de altă sesiune, cel mult 20 s
asteapta() {
  echo "DO \$b\$ DECLARE i int := 0; BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND objsubid = 1 AND granted) LOOP
      PERFORM pg_sleep(0.05); i := i + 1; IF i > 400 THEN RAISE EXCEPTION 'bariera $1 nu a aparut'; END IF; END LOOP; END \$b\$;"
}
# a doua sesiune: UPDATE cu CAS pe versiunea veche; trebuie să aștepte (≥ 1 s, rândul e ținut) și să atingă 0 rânduri
al_doilea() {   # $1 = bariera, $2 = SET-ul UPDATE-ului, $3 = versiunea veche, $4 = eticheta
  cat <<SQL
\set ON_ERROR_STOP 1
$(asteapta "$1")
BEGIN; $JWT
SET LOCAL lock_timeout = '20s';
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp(); n integer;
BEGIN
  UPDATE public.rapoarte_zilnice SET $2 WHERE id = $RAPORT AND versiune_salvare = $3;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL $4: scrierea pe versiunea veche $3 a atins % randuri (conflict nedetectat)', n; END IF;
  IF clock_timestamp() - t0 < interval '1 second' THEN RAISE EXCEPTION 'FAIL $4: nu a asteptat randul tinut de prima sesiune (%)', clock_timestamp() - t0; END IF;
  RAISE NOTICE '$4 a doua sesiune: 0 randuri dupa % (conflict)', clock_timestamp() - t0;
END \$t\$;
COMMIT;
SQL
}
primul() {   # $1 = bariera, $2 = SET-ul UPDATE-ului, $3 = versiunea
  cat <<SQL
\set ON_ERROR_STOP 1
BEGIN; $JWT
DO \$t\$ DECLARE n integer; BEGIN
  UPDATE public.rapoarte_zilnice SET $2 WHERE id = $RAPORT AND versiune_salvare = $3;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: prima sesiune a atins % randuri', n; END IF;
END \$t\$;
SELECT pg_advisory_xact_lock($1);
SELECT pg_sleep(3);
COMMIT;
SQL
}
ESEC=0
verdict() { if [ "$1" = "0" ]; then echo "OK   $2"; else echo "FAIL $2"; ESEC=1; fi; }
ruleaza_doua() {   # $1 = scenariu; fișierele $TMP/$1_a.sql, $TMP/$1_b.sql
  "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_a.sql" > "$TMP/$1_a.log" 2>&1 & PID_A=$!
  "$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/$1_b.sql" > "$TMP/$1_b.log" 2>&1 & PID_B=$!
  set +e; wait $PID_A; RC_A=$?; wait $PID_B; RC_B=$?; set -e
  cat "$TMP/$1_a.log" "$TMP/$1_b.log"
}

if [ -z "$MUTANT" ]; then   # S1–S5 nu privesc mutanții r5
# ── S1: „Revino la automat” (deschis) + corectura veche peste el ──
V="$(corecteaza 'Corectura S1')"
primul 162160001 "rezumat_sursa = 'automat'" "$V" > "$TMP/s1_a.sql"
al_doilea 162160001 "rezumat_text = 'Corectura veche S1', rezumat_sursa = 'editat'" "$V" S1 > "$TMP/s1_b.sql"
ruleaza_doua s1
FINAL="$(stare)"; ASTEPTAT_PREFIX="automat|$((V + 1))|"
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && [[ "$FINAL" == "$ASTEPTAT_PREFIX"* ]] && [[ "$FINAL" != *"Corectura veche"* ]]; then R=0; else R=1; fi
verdict "$R" "S1 revino la automat in curs + corectura veche (CAS $V): conflict; final ${FINAL%%|*}|v${V}->$(echo "$FINAL" | cut -d'|' -f2) (asteptat automat, v$((V + 1))); iesiri $RC_A/$RC_B"

# ── S2: corectura (deschisă) + „Revino la automat” peste ea ──
V="$(corecteaza 'Corectura S2 de plecare')"
primul 162160002 "rezumat_text = 'Corectura S2 telefonul 1', rezumat_sursa = 'editat'" "$V" > "$TMP/s2_a.sql"
al_doilea 162160002 "rezumat_sursa = 'automat'" "$V" S2 > "$TMP/s2_b.sql"
ruleaza_doua s2
FINAL="$(stare)"; ASTEPTAT="editat|$((V + 1))|Corectura S2 telefonul 1"
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && [ "$FINAL" = "$ASTEPTAT" ]; then R=0; else R=1; fi
verdict "$R" "S2 corectura in curs + revino la automat (CAS $V): conflict; final '$FINAL' (asteptat '$ASTEPTAT'); iesiri $RC_A/$RC_B"

# ── S3: una după alta: „Revino la automat” comis, apoi corectura veche cu CAS = V ──
V="$(corecteaza 'Corectura S3')"
cat > "$TMP/s3_a.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN; $JWT
UPDATE public.rapoarte_zilnice SET rezumat_sursa = 'automat' WHERE id = $RAPORT AND versiune_salvare = $V;
COMMIT;
SQL
cat > "$TMP/s3_b.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN; $JWT
DO \$t\$ DECLARE n integer; BEGIN
  UPDATE public.rapoarte_zilnice SET rezumat_text = 'Corectura veche S3', rezumat_sursa = 'editat' WHERE id = $RAPORT AND versiune_salvare = $V;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL S3: corectura veche a atins % randuri', n; END IF;
  RAISE NOTICE 'S3 a doua sesiune: 0 randuri (conflict)';
END \$t\$;
COMMIT;
SQL
set +e
"$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/s3_a.sql" > "$TMP/s3_a.log" 2>&1; RC_A=$?
"$PSQL" -X -q -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/s3_b.sql" > "$TMP/s3_b.log" 2>&1; RC_B=$?
set -e
cat "$TMP/s3_a.log" "$TMP/s3_b.log"
FINAL="$(stare)"; ASTEPTAT_PREFIX="automat|$((V + 1))|"
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && [[ "$FINAL" == "$ASTEPTAT_PREFIX"* ]] && [[ "$FINAL" != *"Corectura veche"* ]]; then R=0; else R=1; fi
verdict "$R" "S3 revino la automat comis, apoi corectura veche (CAS $V): conflict; final ${FINAL%%|*} v$(echo "$FINAL" | cut -d'|' -f2) (asteptat automat, v$((V + 1))); iesiri $RC_A/$RC_B"
fi

# ── r4 (Jakarinos r3 P1): mutarea șantierului în alt proiect cu o salvare în zbor. Șantierul își schimbă proiectul pe clonă (P0 -> P1 -> P0) și
#    e pus la loc în trap; rapoartele sintetice ale zilelor 2001-01-06 / 07 se șterg în trap.
#   S4 salvarea în zbor (raport NOU inserat, necomis, rezumat compus pe P0), apoi mutarea în P1: mutarea AȘTEAPTĂ (r5: rândul șantierului,
#      ținut FOR SHARE de gardă până la COMMIT-ul salvării; în r4 era lock-ul EXCLUSIVE pe tabel), apoi vede raportul comis și îl trece în 'de_recompus'. Fără lock, UPDATE-ul mutării nu vede rândul necomis și textul
#      compus pe P0 ar rămâne pe un raport din P1;
#   S5 mutarea în zbor (înapoi în P0, necomisă), apoi o salvare nouă: salvarea AȘTEAPTĂ mutarea și compune pe P0 (rezumat_proiect_id = P0).
P0="$(q -c "SELECT coalesce(proiect_id::text, '') FROM public.sites WHERE id = $SITE")"
P1="$(q -c "SELECT id FROM public.executie_proiecte WHERE id IS DISTINCT FROM nullif('$P0', '')::bigint ORDER BY id LIMIT 1")"
[[ "$P1" =~ ^[0-9]+$ ]] || { echo "nu gasesc un al doilea proiect pe clona" >&2; exit 24; }
# r5: al doilea șantier (S7) și zilele: S4 06, S5 07, S6 08–11 + 14, S7 15 (+ 12 pe al doilea șantier), S8 13 — toate libere înainte
SITE2="$(q -c "SELECT id FROM public.sites WHERE id <> $SITE ORDER BY id LIMIT 1")"
[[ "$SITE2" =~ ^[0-9]+$ ]] || { echo "nu gasesc un al doilea santier pe clona" >&2; exit 24; }
if [ "$(q -c "SELECT EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE (site_id = $SITE AND data BETWEEN DATE '2001-01-06' AND DATE '2001-01-15')
                                                                      OR (site_id = $SITE2 AND data = DATE '2001-01-12'))")" != "f" ]; then
  echo "REFUZ: zilele de test 2001-01-06 ... 15 sunt ocupate pe santierul $SITE (sau 2001-01-12 pe $SITE2); nu sterg nimic" >&2; exit 24
fi
GARDA_ORIG=""; MUTAT_ORIG=""
pune_la_loc() {   # $1 = semnătura funcției, $2 = fișierul cu definiția originală, $3 = amprenta originală a corpului
  if ! q -f "$2" >/dev/null || [ "$(q -c "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = '$1'::regprocedure")" != "$3" ]; then
    echo "ATENTIE: $1 NU s-a putut pune la loc pe clona (definitia originala: $2, amprenta $3)" >&2; return 1
  fi
  echo "mutant: $1 pusa la loc (amprenta $3)"
}
curata_r4() {
  q -c "DELETE FROM public.rapoarte_zilnice WHERE ((site_id = $SITE AND data BETWEEN DATE '2001-01-06' AND DATE '2001-01-15')
                                                OR (site_id = $SITE2 AND data = DATE '2001-01-12')) AND probleme LIKE 'Proba concurenta%';" >/dev/null \
    || echo "ATENTIE: de sters manual pe clona: rapoartele 2001-01-06 ... 15 ale santierului $SITE si 2001-01-12 al santierului $SITE2" >&2
  q -c "UPDATE public.sites SET proiect_id = nullif('$P0', '')::bigint WHERE id = $SITE AND proiect_id IS DISTINCT FROM nullif('$P0', '')::bigint;" >/dev/null \
    || echo "ATENTIE: de pus la loc manual pe clona: santierul $SITE in proiectul '${P0:-fara}'" >&2
}
curata_mutant() {
  local rc=0
  if [ -n "$GARDA_ORIG" ]; then pune_la_loc 'public.fn_raport_rezumat_garda()' "$TMP/garda_orig.sql" "$GARDA_ORIG" || rc=25; fi
  if [ -n "$MUTAT_ORIG" ]; then pune_la_loc 'public.fn_raport_rezumat_santier_mutat()' "$TMP/mutat_orig.sql" "$MUTAT_ORIG" || rc=25; fi
  if [ "$rc" != 0 ]; then cp "$TMP"/*_orig.sql . 2>/dev/null || true; fi   # definițiile rămân lângă repo pentru punerea manuală la loc
  return "$rc"
}
trap 'curata_mutant || RC_MUT=25; curata_r4; curata; [ "${RC_MUT:-0}" = 0 ] || exit 25' EXIT
stare_zi() { q -c "SELECT coalesce(rezumat_sursa, '-') || '|' || coalesce(rezumat_proiect_id::text, '-') FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data = DATE '$1'"; }

if [ -z "$MUTANT" ]; then
cat > "$TMP/s4_a.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN; $JWT
INSERT INTO public.rapoarte_zilnice (site_id, data, probleme, created_by, updated_at)
VALUES ($SITE, DATE '2001-01-06', 'Proba concurenta mutare S4', '$OWNER', now());
SELECT pg_advisory_xact_lock(162160004);
SELECT pg_sleep(2);
COMMIT;
SQL
cat > "$TMP/s4_b.sql" <<SQL
\set ON_ERROR_STOP 1
$(asteapta 162160004)
BEGIN;
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp(); n integer;
BEGIN
  UPDATE public.sites SET proiect_id = $P1 WHERE id = $SITE;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL S4: mutarea a atins % randuri', n; END IF;
  IF clock_timestamp() - t0 < interval '1 second' THEN RAISE EXCEPTION 'FAIL S4: mutarea nu a asteptat salvarea in zbor (%)', clock_timestamp() - t0; END IF;
  RAISE NOTICE 'S4 mutarea: a asteptat % (salvarea in zbor)', clock_timestamp() - t0;
END \$t\$;
COMMIT;
SQL
ruleaza_doua s4
FINAL="$(stare_zi 2001-01-06)"
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && [ "$FINAL" = "de_recompus|-" ]; then R=0; else R=1; fi
verdict "$R" "S4 salvare in zbor + mutare P${P0:-fara}->P$P1: raportul nou '$FINAL' (asteptat 'de_recompus|-'); iesiri $RC_A/$RC_B"

cat > "$TMP/s5_b.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN;
UPDATE public.sites SET proiect_id = nullif('$P0', '')::bigint WHERE id = $SITE;
SELECT pg_advisory_xact_lock(162160005);
SELECT pg_sleep(2);
COMMIT;
SQL
cat > "$TMP/s5_a.sql" <<SQL
\set ON_ERROR_STOP 1
$(asteapta 162160005)
BEGIN; $JWT
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp();
BEGIN
  INSERT INTO public.rapoarte_zilnice (site_id, data, probleme, created_by, updated_at)
  VALUES ($SITE, DATE '2001-01-07', 'Proba concurenta mutare S5', '$OWNER', now());
  IF clock_timestamp() - t0 < interval '1 second' THEN RAISE EXCEPTION 'FAIL S5: salvarea nu a asteptat mutarea in zbor (%)', clock_timestamp() - t0; END IF;
  RAISE NOTICE 'S5 salvarea: a asteptat % (mutarea in zbor)', clock_timestamp() - t0;
END \$t\$;
COMMIT;
SQL
ruleaza_doua s5
FINAL="$(stare_zi 2001-01-07)"; ASTEPTAT="automat|${P0:--}"
if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && [ "$FINAL" = "$ASTEPTAT" ]; then R=0; else R=1; fi
verdict "$R" "S5 mutare in zbor (inapoi in P${P0:-fara}) + salvare noua: '$FINAL' (asteptat '$ASTEPTAT'); iesiri $RC_A/$RC_B"
fi

# ── r5 (Jakarinos r4). Șantierul e în P0 aici (S5 l-a pus la loc; în modul mutant nu s-a mișcat). ──
muta() { q -c "UPDATE public.sites SET proiect_id = nullif('$1', '')::bigint WHERE id = $SITE;" >/dev/null; }
raport_sintetic() {   # $1 = ziua, $2 = 'replica' (fără trigger-e: raport vechi, rezumat NULL) sau gol (cu garda)
  if [ "$2" = replica ]; then
    q -c "BEGIN; SET LOCAL session_replication_role = replica;
          INSERT INTO public.rapoarte_zilnice (site_id, data, probleme, created_by, updated_at)
          VALUES ($SITE, DATE '$1', 'Proba concurenta r5', '$OWNER', now()); COMMIT;" >/dev/null 2>"$TMP/replica.err"
  else
    q -c "INSERT INTO public.rapoarte_zilnice (site_id, data, probleme, created_by, updated_at)
          VALUES ($SITE, DATE '$1', 'Proba concurenta r5', '$OWNER', now());" >/dev/null
  fi
}
# mutantul: definiția originală salvată, apoi funcția înlocuită pe clonă (pusă la loc în trap, cu amprenta verificată)
mutanteaza() {   # $1 = semnătura, $2 = fișierul original, $3 = textul de înlocuit, $4 = înlocuirea
  q -c "SELECT pg_get_functiondef('$1'::regprocedure) || ';'" > "$2"
  local amp; amp="$(q -c "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = '$1'::regprocedure")"
  q -c "DO \$m\$ DECLARE d text := pg_get_functiondef('$1'::regprocedure); BEGIN
          IF position('$3' IN d) = 0 THEN RAISE EXCEPTION 'mutantul nu gaseste textul de inlocuit in $1'; END IF;
          EXECUTE replace(d, '$3', '$4'); END \$m\$;" >/dev/null
  echo "$amp"
}
case "$MUTANT" in
  fara_for_share) GARDA_ORIG="$(mutanteaza 'public.fn_raport_rezumat_garda()' "$TMP/garda_orig.sql" \
                    'WHERE s.id = NEW.site_id FOR SHARE OF s;' 'WHERE s.id = NEW.site_id;' | tail -1)" ;;
  fara_nowait)    MUTAT_ORIG="$(mutanteaza 'public.fn_raport_rezumat_santier_mutat()' "$TMP/mutat_orig.sql" \
                    'ORDER BY r.id FOR NO KEY UPDATE OF r NOWAIT;' 'ORDER BY r.id FOR NO KEY UPDATE OF r;' | tail -1)" ;;
  lock_tabel)     MUTAT_ORIG="$(mutanteaza 'public.fn_raport_rezumat_santier_mutat()' "$TMP/mutat_orig.sql" \
                    'ORDER BY r.id FOR NO KEY UPDATE OF r NOWAIT;' \
                    'ORDER BY r.id FOR NO KEY UPDATE OF r NOWAIT; LOCK TABLE public.rapoarte_zilnice IN EXCLUSIVE MODE;' | tail -1)" ;;
esac
[ -z "$MUTANT" ] || echo "mutant $MUTANT aplicat pe clona"

# ── S6: „Generează” pe un raport fără rezumat, în imaginea de dinaintea mutării șantierului (A = P1 în imagine, B = P0 după mutare) ──
s6() {   # $1 = nivelul de izolare, $2 = starea raportului (null / de_recompus), $3 = ziua, $4 = bariera 1, $5 = bariera 2
  local nivel="$1" st="$2" zi="$3"
  if [ "$st" = null ]; then
    muta "$P1"
    if ! raport_sintetic "$zi" replica; then
      echo "S6 ($nivel, null): raportul vechi (fara rezumat) nu se poate crea pe clona ($(head -c 200 "$TMP/replica.err")); acopera varianta de_recompus"
      S6_SARIT=$((S6_SARIT + 1)); muta "$P0"; return 0
    fi
  else
    raport_sintetic "$zi"; muta "$P1"   # automat pe P0, apoi mutarea în P1 îl trece în de_recompus
  fi
  local plecare; plecare="$(stare_zi "$zi")"
  if [ "$plecare" != "${st/null/-}|-" ]; then echo "FAIL S6 ($nivel, $st): starea de plecare '$plecare'"; ESEC=1; muta "$P0"; return 0; fi
  cat > "$TMP/s6_a.sql" <<SQL
\set ON_ERROR_STOP 1
\set VERBOSITY verbose
BEGIN ISOLATION LEVEL $nivel; $JWT
SELECT 'imaginea S6: santierul in proiectul ' || coalesce(proiect_id::text, '-') FROM public.sites WHERE id = $SITE;
SELECT pg_advisory_xact_lock($4);
$(asteapta "$5")
UPDATE public.rapoarte_zilnice SET rezumat_sursa = 'automat' WHERE site_id = $SITE AND data = DATE '$zi';
COMMIT;
SQL
  cat > "$TMP/s6_b.sql" <<SQL
\set ON_ERROR_STOP 1
$(asteapta "$4")
BEGIN;
UPDATE public.sites SET proiect_id = nullif('$P0', '')::bigint WHERE id = $SITE;
COMMIT;
SELECT pg_advisory_lock($5);
SELECT pg_sleep(4);
SQL
  ruleaza_doua s6
  FINAL="$(stare_zi "$zi")"
  # acceptat: eroare de serializare (40001) și nimic scris, sau text compus pentru B (P0); niciodată pentru A (P1)
  if [ "$RC_B" = 0 ] && { { [ "$RC_A" != 0 ] && grep -q '40001' "$TMP/s6_a.log" && [ "$FINAL" = "$plecare" ]; } \
                          || { [ "$RC_A" = 0 ] && [ "$FINAL" = "automat|${P0:--}" ]; }; }; then R=0; else R=1; fi
  if [ "$nivel" != "READ COMMITTED" ] && [ "$RC_A" = 0 ]; then R=1; fi   # în imaginea veche nu există cale corectă de compunere
  verdict "$R" "S6 $nivel, raport $st: imaginea in P$P1, mutarea in P${P0:-fara} comisa, apoi Genereaza: final '$FINAL' (iesire $RC_A$(grep -q '40001' "$TMP/s6_a.log" && echo ', 40001'); asteptat: 40001 si '$plecare'$( [ "$nivel" = "READ COMMITTED" ] && echo " / automat|${P0:--}"))"
  [ "$(q -c "SELECT coalesce(proiect_id::text, '') FROM public.sites WHERE id = $SITE")" = "$P0" ] || muta "$P0"
}
S6_SARIT=0
if [ -z "$MUTANT" ] || [ "$MUTANT" = fara_for_share ]; then
  s6 "REPEATABLE READ" null 2001-01-08 162160061 162160062
  s6 "SERIALIZABLE" null 2001-01-09 162160063 162160064
  s6 "REPEATABLE READ" de_recompus 2001-01-10 162160065 162160066
  s6 "SERIALIZABLE" de_recompus 2001-01-11 162160067 162160068
  [ -n "$MUTANT" ] || s6 "READ COMMITTED" de_recompus 2001-01-14 162160069 162160070   # calea legitimă: compune pe B
fi

# ── S7: mutarea în zbor pe șantierul 1 + o salvare pe ALT șantier: salvarea nu așteaptă ──
if [ -z "$MUTANT" ] || [ "$MUTANT" = lock_tabel ]; then
  raport_sintetic 2001-01-15   # un raport cu rezumat automat pe șantier: mutarea are ce invalida
  cat > "$TMP/s7_b.sql" <<SQL
\set ON_ERROR_STOP 1
BEGIN;
UPDATE public.sites SET proiect_id = $P1 WHERE id = $SITE;
SELECT pg_advisory_xact_lock(162160071);
SELECT pg_sleep(3);
ROLLBACK;
SQL
  cat > "$TMP/s7_a.sql" <<SQL
\set ON_ERROR_STOP 1
$(asteapta 162160071)
BEGIN; $JWT
SET LOCAL lock_timeout = '10s';
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp();
BEGIN
  INSERT INTO public.rapoarte_zilnice (site_id, data, probleme, created_by, updated_at)
  VALUES ($SITE2, DATE '2001-01-12', 'Proba concurenta r5 S7', '$OWNER', now());
  IF clock_timestamp() - t0 >= interval '1 second' THEN RAISE EXCEPTION 'FAIL S7: salvarea pe alt santier a asteptat mutarea (%)', clock_timestamp() - t0; END IF;
  RAISE NOTICE 'S7 salvarea pe alt santier: % (fara asteptare)', clock_timestamp() - t0;
END \$t\$;
COMMIT;
SQL
  ruleaza_doua s7
  FINAL="$(q -c "SELECT coalesce(rezumat_sursa, '-') FROM public.rapoarte_zilnice WHERE site_id = $SITE2 AND data = DATE '2001-01-12'")"
  if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && [ "$FINAL" = automat ]; then R=0; else R=1; fi
  verdict "$R" "S7 mutare in zbor pe santierul $SITE + salvare pe santierul $SITE2: fara asteptare, rezumat '$FINAL'; iesiri $RC_A/$RC_B"
fi

# ── S8: o salvare ține rândul raportului, mutarea vine peste ea → mutarea refuză imediat, fără deadlock; salvarea trece ──
if [ -z "$MUTANT" ] || [ "$MUTANT" = fara_nowait ]; then
  raport_sintetic 2001-01-13   # automat pe P0
  cat > "$TMP/s8_a.sql" <<SQL
\set ON_ERROR_STOP 1
\set VERBOSITY verbose
BEGIN; $JWT
SELECT 1 FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data = DATE '2001-01-13' FOR UPDATE;
SELECT pg_advisory_xact_lock(162160081);
SELECT pg_sleep(2);
UPDATE public.rapoarte_zilnice SET probleme = 'Proba concurenta r5 S8 salvata' WHERE site_id = $SITE AND data = DATE '2001-01-13';
COMMIT;
SQL
  cat > "$TMP/s8_b.sql" <<SQL
\set ON_ERROR_STOP 1
\set VERBOSITY verbose
$(asteapta 162160081)
BEGIN;
SET LOCAL lock_timeout = '10s';
DO \$t\$ DECLARE t0 timestamptz := clock_timestamp();
BEGIN
  BEGIN
    UPDATE public.sites SET proiect_id = $P1 WHERE id = $SITE;
    RAISE EXCEPTION 'FAIL S8: mutarea a trecut peste salvarea in curs (%)', clock_timestamp() - t0;
  EXCEPTION WHEN lock_not_available THEN
    IF clock_timestamp() - t0 >= interval '1 second' THEN RAISE EXCEPTION 'FAIL S8: mutarea a asteptat inainte de refuz (%)', clock_timestamp() - t0; END IF;
    IF position('chiar acum' IN SQLERRM) = 0 THEN RAISE EXCEPTION 'FAIL S8: alt refuz: %', SQLERRM; END IF;
    RAISE NOTICE 'S8 mutarea: refuz imediat 55P03 dupa % (%)', clock_timestamp() - t0, SQLERRM;
  END;
END \$t\$;
ROLLBACK;
SQL
  ruleaza_doua s8
  FINAL="$(stare_zi 2001-01-13)|$(q -c "SELECT probleme FROM public.rapoarte_zilnice WHERE site_id = $SITE AND data = DATE '2001-01-13'")"
  if [ "$RC_A" = 0 ] && [ "$RC_B" = 0 ] && [ "$FINAL" = "automat|${P0:--}|Proba concurenta r5 S8 salvata" ] \
     && [ "$(q -c "SELECT coalesce(proiect_id::text, '') FROM public.sites WHERE id = $SITE")" = "$P0" ]; then R=0; else R=1; fi
  verdict "$R" "S8 salvare cu randul raportului tinut + mutare: refuz imediat al mutarii, salvarea trece; final '$FINAL' (asteptat 'automat|${P0:--}|Proba concurenta r5 S8 salvata'); iesiri $RC_A/$RC_B$(grep -q '40P01' "$TMP/s8_a.log" "$TMP/s8_b.log" && echo ', DEADLOCK 40P01')"
fi

if [ -n "$MUTANT" ]; then
  # cu mutant: scenariul lui TREBUIE să pice (altfel proba nu dovedește nimic); ieșirea 0 = mutantul prins
  if [ "$MUTANT" = fara_for_share ] && [ "$S6_SARIT" != 0 ]; then echo "(S6 null sarit $S6_SARIT ori: mutantul judecat doar pe variantele rulate)"; fi
  if [ "$ESEC" = 1 ]; then echo "MUTANT $MUTANT PRINS"; exit 0; else echo "MUTANT $MUTANT SCAPAT: proba nu-l vede"; exit 1; fi
fi
if [ "$S6_SARIT" != 0 ]; then echo "Atentie: S6 cu raport vechi (rezumat NULL) sarit de $S6_SARIT ori (session_replication_role refuzat pe clona); varianta de_recompus a rulat"; fi
if [ "$ESEC" = 0 ]; then echo "Toate scenariile de concurenta 20261216a au trecut"; else echo "Cel putin un scenariu de concurenta a picat"; fi
exit "$ESEC"
