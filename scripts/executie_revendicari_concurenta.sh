# shellcheck shell=bash
# Proba de CONCURENȚĂ pentru 20261224a (dosarul de revendicare) — DOAR pe CLONĂ, cu sesiuni psql reale (L25), DUPĂ aplicarea migrării acolo.
# NETESTAT de autor (contul de dezvoltare nu are psql / Postgres); îl rulează coordonatorul pe clonă. Tiparul: scripts/raport_linii_proiect_concurenta.sh.
# Rulare din Git Bash, cu psql de Windows; conexiunea după `--` (parola din pgpass, niciodată pe linia de comandă):
#   PSQL=/c/Users/Public/pgsql/bin/psql.exe bash scripts/executie_revendicari_concurenta.sh --sistem <system_identifier al clonei> \
#        --mp <uuid-ul unui MP sintetic al clonei> -- -h <host clonă> -p <port> -U postgres -d postgres
# Garda țintei: system_identifier (pg_control_system()) trebuie să fie EXACT --sistem, altfel refuz (22) înainte de orice scriere.
# Identitățile: owner-ul sintetic al clonei (OWNER=<uuid>, implicit 00000000-0000-4000-8000-000000000001; trebuie să fie is_owner) și, pentru
#   K4, --mp = un cont NON-owner, MP desemnat al unui proiect al clonei (profiles.employee_id = executie_proiecte.mp_employee_id), cu dreptul
#   de scriere pe dosarele lui și FĂRĂ rânduri în executie_acces_proiect (nerestrâns); rolul authenticated, JWT-ul în ambele surse.
#   Fără --mp, K4 = PROBA_NEFUNCTIONALA (26): reverificarea dreptului după lock rămâne neprobată.
# Datele: dosare SINTETICE cu titlul „CONCURENTA-REV …”, COMISE (sesiunile trebuie să le vadă) și șterse la final (trap), oricare ar fi
#   rezultatul: cheile, jurnalul, termenele și dosarele lor (trigger-ele jurnalului oprite DOAR în tranzacția de curățenie, ca postgres).
#   K4 adaugă, cât testul așteaptă, un rând de restricție (viewer) pentru contul --mp pe proiectul lui; trap-ul îl șterge ÎNTÂI.
# Sincronizarea: DOAR pe lock-uri (sleep doar la sondare). Bariera = lock consultativ B ținut de sesiunea de control C:
#   1. C ia B și rămâne deschisă;
#   2. A (BEGIN; RPC-ul real; apoi cere B) — rămâne în tranzacție, cu lock-urile RPC-ului ținute, așteptând B;
#   3. scriptul vede A în așteptare pe advisory, pornește sesiunea de test T (aceeași țintă);
#   4. scriptul vede T BLOCATĂ DE A (pg_blocking_pids) — marcajul „BARIERA tine”; nu-l vede în 20 s = PROBA_NEFUNCTIONALA;
#   4b. (K4) cât T așteaptă, scriptul face schimbarea concurentă (comisă, ca postgres);
#   5. C e oprită (pg_terminate_backend) -> A comite -> T continuă DUPĂ A.
# Scenarii:
#   K1 două salvări ale ACELUIAȘI dosar cu aceeași versiune văzută, chei diferite: a doua așteaptă rândul dosarului (FOR UPDATE), apoi
#      primește {ok:false, motiv:'conflict'} (CAS), nimic scris de ea; versiunea finală = v+1;
#   K2 aceeași cheie de intenție (crearea unui dosar), trimisă de două ori în paralel: a doua așteaptă lock-ul consultativ al cheii, apoi
#      primește {duplicat:true} cu ACELAȘI id; un singur dosar creat;
#   K3 aceeași cheie, alt conținut, în paralel: a doua așteaptă, apoi refuz cu SQLSTATE 22023 („cheia intentiei”; psql VERBOSITY=verbose
#      tipărește codul, deci se verifică CODUL, nu doar mesajul);
#   K4 (runda 2, P2-4) dreptul RETRAS cât apelul așteaptă lock-ul: A (owner) ține dosarul (adaugă un termen, dosarul nu se modifică); T (MP)
#      salvează dosarul cu versiunea curentă și așteaptă lock-ul; între timp contul MP e restrâns pe proiect la „viewer” (fără scriere).
#      Așteptat: T primește 42501 (reverificarea dreptului după lock), titlul dosarului NESCHIMBAT, niciun rând de jurnal cu titlul lui T.
#      Pe codul din runda 1 (fără reverificare) T ar fi scris.
# Ieșire: 0 = toate OK; 1 = CONTRAR (rezultat greșit); 26 = PROBA_NEFUNCTIONALA (bariera nu a ținut / sesiune picată / --mp lipsă sau
#   nepotrivit); 22 = țintă greșită; 2 = argumente.
set -u
PSQL="${PSQL:-psql}"
OWNER="${OWNER:-00000000-0000-4000-8000-000000000001}"
SISTEM=""
MP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sistem) SISTEM="$2"; shift 2 ;;
    --mp) MP="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "argument necunoscut: $1" >&2; exit 2 ;;
  esac
done
[ -n "$SISTEM" ] && [ $# -gt 0 ] || { echo "utilizare: --sistem <id> [--mp <uuid>] -- <conexiune psql>" >&2; exit 2; }
if [ -n "$MP" ] && ! [[ "$MP" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then echo "--mp: uuid invalid" >&2; exit 2; fi
CONN=("$@")
DIR="$(mktemp -d)"
BARIERA=77224001
q() { "$PSQL" "${CONN[@]}" -X -q -t -A -v ON_ERROR_STOP=1 -c "$1"; }

[ "$(q "SELECT system_identifier::text FROM pg_control_system()")" = "$SISTEM" ] || { echo "REFUZ: system_identifier diferit de --sistem" >&2; exit 22; }
[ "$(q "SELECT to_regprocedure('public.fn_executie_revendicare_salveaza_dosar(bigint, bigint, integer, jsonb, uuid)') IS NOT NULL")" = "t" ] \
  || { echo "PROBA_NEFUNCTIONALA: migrarea 20261224a nu e aplicata pe clona" >&2; exit 26; }
[ "$(q "SELECT coalesce((SELECT is_owner FROM public.profiles WHERE id = '$OWNER'), false)")" = "t" ] \
  || { echo "PROBA_NEFUNCTIONALA: OWNER nu e owner pe clona" >&2; exit 26; }
PROIECT="$(q "SELECT min(id) FROM public.executie_proiecte")"
PROIECT_MP=""

curata() {
  # ÎNTÂI restricția pusă de K4 (un drept de acces schimbat pe clonă nu rămâne în urmă)
  if [ -f "$DIR/k4_restrictie" ]; then
    q "DELETE FROM public.executie_acces_proiect WHERE profile_id = '$MP' AND proiect_id = $PROIECT_MP AND nivel = 'viewer'" >/dev/null \
      || echo "ATENTIE: restrictia K4 a contului --mp pe proiectul $PROIECT_MP a ramas pe clona" >&2
  fi
  q "BEGIN;
     ALTER TABLE public.executie_revendicari DISABLE TRIGGER trg_z_executie_revendicare_jurnal;
     ALTER TABLE public.executie_revendicare_termene DISABLE TRIGGER trg_z_executie_revendicare_jurnal;
     ALTER TABLE public.executie_revendicare_jurnal DISABLE TRIGGER trg_executie_revendicare_jurnal_imuabil;
     CREATE TEMP TABLE rev_conc_d ON COMMIT DROP AS SELECT id FROM public.executie_revendicari WHERE titlu LIKE 'CONCURENTA-REV%';
     DELETE FROM public.executie_revendicare_chei WHERE dosar_id IN (SELECT id FROM rev_conc_d);
     DELETE FROM public.executie_revendicare_jurnal WHERE dosar_id IN (SELECT id FROM rev_conc_d);
     DELETE FROM public.executie_revendicare_termene WHERE dosar_id IN (SELECT id FROM rev_conc_d);
     DELETE FROM public.executie_revendicari WHERE id IN (SELECT id FROM rev_conc_d);
     ALTER TABLE public.executie_revendicari ENABLE TRIGGER trg_z_executie_revendicare_jurnal;
     ALTER TABLE public.executie_revendicare_termene ENABLE TRIGGER trg_z_executie_revendicare_jurnal;
     ALTER TABLE public.executie_revendicare_jurnal ENABLE TRIGGER trg_executie_revendicare_jurnal_imuabil;
     COMMIT;" >/dev/null || echo "ATENTIE: curatenia a esuat; date CONCURENTA-REV raman pe clona" >&2
  q "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name LIKE 'rev_conc_%'" >/dev/null 2>&1
  rm -rf "$DIR"
}
trap curata EXIT

ca_cont() { echo "SELECT set_config('request.jwt.claim.sub', '$1', true), set_config('request.jwt.claims', json_build_object('sub', '$1', 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;"; }
ca_owner="$(ca_cont "$OWNER")"
asteapta() {  # asteapta <conditie SQL> <secunde>
  local i=0
  while [ $i -lt $(( $2 * 5 )) ]; do
    [ "$(q "SELECT pg_stat_clear_snapshot(); SELECT ($1)::text" | tail -n 1)" = "true" ] && return 0
    sleep 0.2; i=$((i + 1))
  done
  return 1
}
pid_de() { q "SELECT pid FROM pg_stat_activity WHERE application_name = '$1' LIMIT 1"; }

# un scenariu: $1 nume, $2 apelul RPC al sesiunii A, $3 apelul sesiunii de test T, $4 verificarea SQL a rezultatului (true = OK),
#   $5 motivul de eroare așteptat de la T (cu SQLSTATE, VERBOSITY=verbose), $6 SQL comis cât T așteaptă (opțional), $7 identitatea lui T
#   (implicit owner-ul)
scenariu() {
  local nume="$1" actiune="${6:-}" caT="${7:-$ca_owner}"
  PGAPPNAME=rev_conc_C "$PSQL" "${CONN[@]}" -X -q -t -A -c "SELECT pg_advisory_lock($BARIERA); SELECT pg_sleep(120);" >"$DIR/C.out" 2>&1 &
  asteapta "EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = 'rev_conc_C' AND l.locktype = 'advisory' AND l.granted)" 20 \
    || { echo "$nume: PROBA_NEFUNCTIONALA (controlul nu a luat bariera)"; return 26; }
  PGAPPNAME=rev_conc_A "$PSQL" "${CONN[@]}" -X -q -t -A -v ON_ERROR_STOP=1 \
    -c "BEGIN; $ca_owner SELECT 'A=' || ($2)::text; RESET ROLE; SELECT pg_advisory_lock($BARIERA); COMMIT;" >"$DIR/A.out" 2>&1 &
  local PA=$!
  asteapta "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'rev_conc_A' AND wait_event_type = 'Lock' AND wait_event = 'advisory')" 20 \
    || { echo "$nume: PROBA_NEFUNCTIONALA (A nu a ajuns la bariera): $(cat "$DIR/A.out")"; return 26; }
  local pidA; pidA="$(pid_de rev_conc_A)"
  PGAPPNAME=rev_conc_T "$PSQL" "${CONN[@]}" -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
    -c "BEGIN; $caT SELECT 'T=' || ($3)::text; COMMIT;" >"$DIR/T.out" 2>&1 &
  local PT=$!
  asteapta "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'rev_conc_T' AND $pidA = ANY (pg_blocking_pids(pid)))" 20 \
    || { echo "$nume: PROBA_NEFUNCTIONALA (testul nu a asteptat dupa A): $(cat "$DIR/T.out")"; return 26; }
  echo "$nume: BARIERA tine (testul asteapta dupa A)"
  if [ -n "$actiune" ]; then
    q "$actiune" >/dev/null || { echo "$nume: PROBA_NEFUNCTIONALA (schimbarea concurenta a esuat)"; return 26; }
    echo "$nume: schimbarea concurenta comisa cat testul asteapta"
  fi
  q "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'rev_conc_C'" >/dev/null
  wait $PA; local ea=$?
  wait $PT; local et=$?
  local ra rt
  ra="$(grep '^A=' "$DIR/A.out" | sed 's/^A=//')"; rt="$(grep '^T=' "$DIR/T.out" | sed 's/^T=//')"
  [ $ea -eq 0 ] && [ -n "$ra" ] || { echo "$nume: PROBA_NEFUNCTIONALA (A a picat): $(cat "$DIR/A.out")"; return 26; }
  local erT=""; [ $et -ne 0 ] && erT="$(tr '\n' ' ' <"$DIR/T.out")"
  local verif; verif="$(q "SELECT ($4)::text" 2>/dev/null | tail -n 1)"
  if [ -n "$5" ]; then
    # eroare așteptată: T a picat, cu SQLSTATE-ul și mesajul cerute, ȘI verificarea SQL a stării e adevărată
    if [ $et -ne 0 ] && echo "$erT" | grep -q "$5" && [ "$verif" = "true" ]; then echo "$nume: OK — A=$ra | T=$erT"; return 0; fi
  elif [ $et -eq 0 ] && [ "$verif" = "true" ]; then
    echo "$nume: OK — A=$ra | T=$rt"; return 0
  fi
  echo "$nume: CONTRAR — A=$ra | T=${rt:-$erT} | verificare=$verif"; return 1
}

rez=0
# codul final: un CONTRAR (1) dovedit bate orice; altfel primul cod nenul (26 = neprobat)
noteaza() { if [ "$1" -eq 1 ]; then rez=1; elif [ "$1" -ne 0 ] && [ "$rez" -eq 0 ]; then rez=$1; fi; return 0; }
# dosarul comun pentru K1 (comis)
D="$(q "BEGIN; $ca_owner SELECT (public.fn_executie_revendicare_salveaza_dosar($PROIECT, NULL, NULL, '{\"titlu\":\"CONCURENTA-REV K1\"}'::jsonb, gen_random_uuid())->'rand'->>'id'); COMMIT;" | grep -E '^[0-9]+$')"
[ -n "$D" ] || { echo "PROBA_NEFUNCTIONALA: dosarul K1 nu s-a creat"; exit 26; }
V="$(q "SELECT versiune FROM public.executie_revendicari WHERE id = $D")"
K1A="public.fn_executie_revendicare_salveaza_dosar($PROIECT, $D, $V, '{\"titlu\":\"CONCURENTA-REV K1 A\"}'::jsonb, gen_random_uuid())"
K1T="public.fn_executie_revendicare_salveaza_dosar($PROIECT, $D, $V, '{\"titlu\":\"CONCURENTA-REV K1 T\"}'::jsonb, gen_random_uuid())"
r1=0; scenariu K1 "$K1A" "$K1T" "(SELECT titlu = 'CONCURENTA-REV K1 A' AND versiune = $V + 1 FROM public.executie_revendicari WHERE id = $D)
  AND (SELECT count(*) FROM public.executie_revendicare_jurnal WHERE dosar_id = $D AND dupa->>'titlu' = 'CONCURENTA-REV K1 T') = 0" "" || r1=$?
# K1: rezultatul sesiunii de test trebuie să fie conflictul (citit din fișier)
if [ $r1 -eq 0 ] && ! grep -q '"motiv": "conflict"' "$DIR/T.out" 2>/dev/null; then echo "K1: CONTRAR (testul nu a primit conflict): $(cat "$DIR/T.out" 2>/dev/null)"; r1=1; fi
noteaza $r1

K="$(q "SELECT gen_random_uuid()")"
K2="public.fn_executie_revendicare_salveaza_dosar($PROIECT, NULL, NULL, '{\"titlu\":\"CONCURENTA-REV K2\"}'::jsonb, '$K')"
r2=0; scenariu K2 "$K2" "$K2" "(SELECT count(*) = 1 FROM public.executie_revendicari WHERE titlu = 'CONCURENTA-REV K2')" "" || r2=$?
if [ $r2 -eq 0 ] && ! grep -q '"duplicat": true' "$DIR/T.out" 2>/dev/null; then echo "K2: CONTRAR (testul nu a primit duplicat): $(cat "$DIR/T.out" 2>/dev/null)"; r2=1; fi
noteaza $r2

K="$(q "SELECT gen_random_uuid()")"
K3A="public.fn_executie_revendicare_salveaza_dosar($PROIECT, NULL, NULL, '{\"titlu\":\"CONCURENTA-REV K3 A\"}'::jsonb, '$K')"
K3T="public.fn_executie_revendicare_salveaza_dosar($PROIECT, NULL, NULL, '{\"titlu\":\"CONCURENTA-REV K3 T\"}'::jsonb, '$K')"
r3=0; scenariu K3 "$K3A" "$K3T" "(SELECT count(*) = 0 FROM public.executie_revendicari WHERE titlu = 'CONCURENTA-REV K3 T')" "22023: revendicari: cheia intentiei" || r3=$?
noteaza $r3

# K4: dreptul retras cât T așteaptă lock-ul dosarului
r4=0
if [ -z "$MP" ]; then
  echo "K4: PROBA_NEFUNCTIONALA (--mp lipsa: reverificarea dreptului dupa lock ramane NEPROBATA)"; r4=26
else
  PROIECT_MP="$(q "SELECT min(e.id) FROM public.executie_proiecte e JOIN public.profiles p ON p.employee_id = e.mp_employee_id
                   WHERE p.id = '$MP' AND p.is_owner IS NOT TRUE")"
  ca_mp="$(ca_cont "$MP")"
  if [ -z "$PROIECT_MP" ] \
     || [ "$(q "SELECT count(*) FROM public.executie_acces_proiect WHERE profile_id = '$MP'")" != "0" ] \
     || [ "$(q "BEGIN; $ca_mp SELECT public.fn_executie_revendicare_drept($PROIECT_MP, 'scriere')::text; COMMIT;" | grep -E '^(true|false)$')" != "true" ]; then
    echo "K4: PROBA_NEFUNCTIONALA (--mp nu e un MP nerestrans cu drept de scriere pe proiectul lui)"; r4=26
  else
    DK="$(q "BEGIN; $ca_owner SELECT (public.fn_executie_revendicare_salveaza_dosar($PROIECT_MP, NULL, NULL, '{\"titlu\":\"CONCURENTA-REV K4\"}'::jsonb, gen_random_uuid())->'rand'->>'id'); COMMIT;" | grep -E '^[0-9]+$')"
    VK="$(q "SELECT versiune FROM public.executie_revendicari WHERE id = ${DK:-0}")"
    if [ -z "$DK" ] || [ -z "$VK" ]; then echo "K4: PROBA_NEFUNCTIONALA (dosarul K4 nu s-a creat)"; r4=26; else
      K4A="public.fn_executie_revendicare_termen($DK, NULL, NULL, '{\"tip_obligatie\":\"alt\",\"mod\":\"manual\",\"declansator_tip\":\"alt\"}'::jsonb, gen_random_uuid())"
      K4T="public.fn_executie_revendicare_salveaza_dosar($PROIECT_MP, $DK, $VK, '{\"titlu\":\"CONCURENTA-REV K4 T\"}'::jsonb, gen_random_uuid())"
      touch "$DIR/k4_restrictie"
      scenariu K4 "$K4A" "$K4T" \
        "(SELECT titlu = 'CONCURENTA-REV K4' AND versiune = $VK FROM public.executie_revendicari WHERE id = $DK)
         AND (SELECT count(*) FROM public.executie_revendicare_jurnal WHERE dosar_id = $DK AND dupa->>'titlu' = 'CONCURENTA-REV K4 T') = 0
         AND (SELECT count(*) = 1 FROM public.executie_revendicare_termene WHERE dosar_id = $DK)" \
        "42501: revendicari: dosarul nu exista sau nu ai drept" \
        "INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES ('$MP', $PROIECT_MP, 'viewer')" \
        "$ca_mp" || r4=$?
    fi
  fi
fi
noteaza $r4
echo "REZULTAT: $rez"
exit $rez
