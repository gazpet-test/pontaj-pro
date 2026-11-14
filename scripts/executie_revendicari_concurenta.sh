# shellcheck shell=bash
# Proba de CONCURENȚĂ pentru 20261224a (dosarul de revendicare) — DOAR pe CLONĂ, cu sesiuni psql reale (L25), DUPĂ aplicarea migrării acolo.
# NETESTAT de autor (contul de dezvoltare nu are psql / Postgres); îl rulează coordonatorul pe clonă. Tiparul: scripts/raport_linii_proiect_concurenta.sh.
# Rulare din Git Bash, cu psql de Windows; conexiunea după `--` (parola din pgpass, niciodată pe linia de comandă):
#   PSQL=/c/Users/Public/pgsql/bin/psql.exe bash scripts/executie_revendicari_concurenta.sh --sistem <system_identifier al clonei> \
#        -- -h <host clonă> -p <port> -U postgres -d postgres
# Garda țintei: system_identifier (pg_control_system()) trebuie să fie EXACT --sistem, altfel refuz (22) înainte de orice scriere.
# Identitatea: owner-ul sintetic al clonei (OWNER=<uuid>, implicit 00000000-0000-4000-8000-000000000001; trebuie să fie is_owner), rolul
#   authenticated, JWT-ul în ambele surse. Datele: dosare SINTETICE cu titlul „CONCURENTA-REV …” pe cel mai mic executie_proiecte.id, COMISE
#   (sesiunile trebuie să le vadă) și șterse la final (trap), oricare ar fi rezultatul: cheile, jurnalul și dosarele lor (trigger-ele jurnalului
#   oprite DOAR în tranzacția de curățenie, ca postgres).
# Sincronizarea: DOAR pe lock-uri (sleep doar la sondare). Bariera = lock consultativ B ținut de sesiunea de control C:
#   1. C ia B și rămâne deschisă;
#   2. A (BEGIN; RPC-ul real; apoi cere B) — rămâne în tranzacție, cu lock-urile RPC-ului ținute, așteptând B;
#   3. scriptul vede A în așteptare pe advisory, pornește B-ul de test (aceeași țintă);
#   4. scriptul vede sesiunea de test BLOCATĂ DE A (pg_blocking_pids) — marcajul „BARIERA tine”; nu-l vede în 20 s = PROBA_NEFUNCTIONALA;
#   5. C e oprită (pg_terminate_backend) -> A comite -> sesiunea de test continuă DUPĂ A.
# Scenarii:
#   K1 două salvări ale ACELUIAȘI dosar cu aceeași versiune văzută, chei diferite: a doua așteaptă rândul dosarului (FOR UPDATE), apoi
#      primește {ok:false, motiv:'conflict'} (CAS), nimic scris de ea; versiunea finală = v+1;
#   K2 aceeași cheie de intenție (crearea unui dosar), trimisă de două ori în paralel: a doua așteaptă lock-ul consultativ al cheii, apoi
#      primește {duplicat:true} cu ACELAȘI id; un singur dosar creat;
#   K3 aceeași cheie, alt conținut, în paralel: a doua așteaptă, apoi refuz 22023 („cheia intentiei”).
# Ieșire: 0 = toate OK; 1 = CONTRAR (rezultat greșit); 26 = PROBA_NEFUNCTIONALA (bariera nu a ținut / sesiune picată); 22 = țintă greșită;
#   2 = argumente.
set -u
PSQL="${PSQL:-psql}"
OWNER="${OWNER:-00000000-0000-4000-8000-000000000001}"
SISTEM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sistem) SISTEM="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "argument necunoscut: $1" >&2; exit 2 ;;
  esac
done
[ -n "$SISTEM" ] && [ $# -gt 0 ] || { echo "utilizare: --sistem <id> -- <conexiune psql>" >&2; exit 2; }
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

curata() {
  q "BEGIN;
     ALTER TABLE public.executie_revendicari DISABLE TRIGGER trg_z_executie_revendicare_jurnal;
     ALTER TABLE public.executie_revendicare_jurnal DISABLE TRIGGER trg_executie_revendicare_jurnal_imuabil;
     DELETE FROM public.executie_revendicare_chei WHERE dosar_id IN (SELECT id FROM public.executie_revendicari WHERE titlu LIKE 'CONCURENTA-REV%');
     DELETE FROM public.executie_revendicare_jurnal WHERE dosar_id IN (SELECT id FROM public.executie_revendicari WHERE titlu LIKE 'CONCURENTA-REV%');
     DELETE FROM public.executie_revendicari WHERE titlu LIKE 'CONCURENTA-REV%';
     ALTER TABLE public.executie_revendicari ENABLE TRIGGER trg_z_executie_revendicare_jurnal;
     ALTER TABLE public.executie_revendicare_jurnal ENABLE TRIGGER trg_executie_revendicare_jurnal_imuabil;
     COMMIT;" >/dev/null || echo "ATENTIE: curatenia a esuat; date CONCURENTA-REV raman pe clona" >&2
  q "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name LIKE 'rev_conc_%'" >/dev/null 2>&1
  rm -rf "$DIR"
}
trap curata EXIT

ca_owner="SELECT set_config('request.jwt.claim.sub', '$OWNER', true), set_config('request.jwt.claims', json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;"
asteapta() {  # asteapta <conditie SQL> <secunde>
  local i=0
  while [ $i -lt $(( $2 * 5 )) ]; do
    [ "$(q "SELECT pg_stat_clear_snapshot(); SELECT ($1)::text" | tail -n 1)" = "true" ] && return 0
    sleep 0.2; i=$((i + 1))
  done
  return 1
}
pid_de() { q "SELECT pid FROM pg_stat_activity WHERE application_name = '$1' LIMIT 1"; }

# un scenariu: $1 nume, $2 apelul RPC al sesiunii A, $3 apelul sesiunii de test T, $4 verificarea SQL a rezultatului (true = OK)
scenariu() {
  local nume="$1"
  PGAPPNAME=rev_conc_C "$PSQL" "${CONN[@]}" -X -q -t -A -c "SELECT pg_advisory_lock($BARIERA); SELECT pg_sleep(120);" >"$DIR/C.out" 2>&1 &
  asteapta "EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = 'rev_conc_C' AND l.locktype = 'advisory' AND l.granted)" 20 \
    || { echo "$nume: PROBA_NEFUNCTIONALA (controlul nu a luat bariera)"; return 26; }
  PGAPPNAME=rev_conc_A "$PSQL" "${CONN[@]}" -X -q -t -A -v ON_ERROR_STOP=1 \
    -c "BEGIN; $ca_owner SELECT 'A=' || ($2)::text; RESET ROLE; SELECT pg_advisory_lock($BARIERA); COMMIT;" >"$DIR/A.out" 2>&1 &
  local PA=$!
  asteapta "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'rev_conc_A' AND wait_event_type = 'Lock' AND wait_event = 'advisory')" 20 \
    || { echo "$nume: PROBA_NEFUNCTIONALA (A nu a ajuns la bariera): $(cat "$DIR/A.out")"; return 26; }
  local pidA; pidA="$(pid_de rev_conc_A)"
  PGAPPNAME=rev_conc_T "$PSQL" "${CONN[@]}" -X -q -t -A -v ON_ERROR_STOP=1 \
    -c "BEGIN; $ca_owner SELECT 'T=' || ($3)::text; COMMIT;" >"$DIR/T.out" 2>&1 &
  local PT=$!
  asteapta "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'rev_conc_T' AND $pidA = ANY (pg_blocking_pids(pid)))" 20 \
    || { echo "$nume: PROBA_NEFUNCTIONALA (testul nu a asteptat dupa A): $(cat "$DIR/T.out")"; return 26; }
  echo "$nume: BARIERA tine (testul asteapta dupa A)"
  q "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'rev_conc_C'" >/dev/null
  wait $PA; local ea=$?
  wait $PT; local et=$?
  local ra rt
  ra="$(grep '^A=' "$DIR/A.out" | sed 's/^A=//')"; rt="$(grep '^T=' "$DIR/T.out" | sed 's/^T=//')"
  [ $ea -eq 0 ] && [ -n "$ra" ] || { echo "$nume: PROBA_NEFUNCTIONALA (A a picat): $(cat "$DIR/A.out")"; return 26; }
  local erT=""; [ $et -ne 0 ] && erT="$(tr '\n' ' ' <"$DIR/T.out")"
  if [ "$(q "SELECT ($4)::text" 2>/dev/null | tail -n 1)" = "true" ] || { [ -n "$5" ] && echo "$erT" | grep -q "$5"; }; then
    echo "$nume: OK — A=$ra | T=${rt:-$erT}"; return 0
  fi
  echo "$nume: CONTRAR — A=$ra | T=${rt:-$erT}"; return 1
}

rez=0
# dosarul comun pentru K1 (comis)
D="$(q "BEGIN; $ca_owner SELECT (public.fn_executie_revendicare_salveaza_dosar($PROIECT, NULL, NULL, '{\"titlu\":\"CONCURENTA-REV K1\"}'::jsonb, gen_random_uuid())->'rand'->>'id'); COMMIT;" | grep -E '^[0-9]+$')"
[ -n "$D" ] || { echo "PROBA_NEFUNCTIONALA: dosarul K1 nu s-a creat"; exit 26; }
V="$(q "SELECT versiune FROM public.executie_revendicari WHERE id = $D")"
K1A="public.fn_executie_revendicare_salveaza_dosar($PROIECT, $D, $V, '{\"titlu\":\"CONCURENTA-REV K1 A\"}'::jsonb, gen_random_uuid())"
K1T="public.fn_executie_revendicare_salveaza_dosar($PROIECT, $D, $V, '{\"titlu\":\"CONCURENTA-REV K1 T\"}'::jsonb, gen_random_uuid())"
scenariu K1 "$K1A" "$K1T" "(SELECT titlu = 'CONCURENTA-REV K1 A' AND versiune = $V + 1 FROM public.executie_revendicari WHERE id = $D)
  AND (SELECT count(*) FROM public.executie_revendicare_jurnal WHERE dosar_id = $D AND dupa->>'titlu' = 'CONCURENTA-REV K1 T') = 0" "" || rez=$?
# K1: rezultatul sesiunii de test trebuie să fie conflictul (citit din fișier)
if [ $rez -eq 0 ] && ! grep -q '"motiv": "conflict"' "$DIR/T.out" 2>/dev/null; then echo "K1: CONTRAR (testul nu a primit conflict): $(cat "$DIR/T.out" 2>/dev/null)"; rez=1; fi

K="$(q "SELECT gen_random_uuid()")"
K2="public.fn_executie_revendicare_salveaza_dosar($PROIECT, NULL, NULL, '{\"titlu\":\"CONCURENTA-REV K2\"}'::jsonb, '$K')"
r2=0; scenariu K2 "$K2" "$K2" "(SELECT count(*) = 1 FROM public.executie_revendicari WHERE titlu = 'CONCURENTA-REV K2')" "" || r2=$?
if [ $r2 -eq 0 ] && ! grep -q '"duplicat": true' "$DIR/T.out" 2>/dev/null; then echo "K2: CONTRAR (testul nu a primit duplicat): $(cat "$DIR/T.out" 2>/dev/null)"; r2=1; fi
[ $r2 -ne 0 ] && [ $rez -eq 0 ] && rez=$r2

K="$(q "SELECT gen_random_uuid()")"
K3A="public.fn_executie_revendicare_salveaza_dosar($PROIECT, NULL, NULL, '{\"titlu\":\"CONCURENTA-REV K3 A\"}'::jsonb, '$K')"
K3T="public.fn_executie_revendicare_salveaza_dosar($PROIECT, NULL, NULL, '{\"titlu\":\"CONCURENTA-REV K3 T\"}'::jsonb, '$K')"
r3=0; scenariu K3 "$K3A" "$K3T" "false" "cheia intentiei" || r3=$?
[ $r3 -ne 0 ] && [ $rez -eq 0 ] && rez=$r3
echo "REZULTAT: $rez"
exit $rez
