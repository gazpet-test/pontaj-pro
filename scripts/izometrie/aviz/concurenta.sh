#!/usr/bin/env bash
# Sourced by the local harness. Two psql processes, barrier, wait and assertions.
emit_session() {
 local key="$1" piece="$2" app="$3"
 "${ADMIN[@]}" -d "$BAZA" >"$TMP/$app.log" 2>&1 <<SQL
SET SESSION AUTHORIZATION authenticator;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL application_name='$app';
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
-- Both sessions queue behind the coordinator's exclusive barrier.
SELECT pg_advisory_xact_lock_shared(20261120,6600);
SELECT public.fn_izo_iesire_cu_aviz('$key',9,19,ARRAY[(SELECT id FROM public.magazie_bucati WHERE serie='$piece')],
(now() AT TIME ZONE 'Europe/Bucharest')::date,121,NULL,false,NULL,'PH01ABC','{"tip":"intern"}');
COMMIT;
SQL
}
race() {
 local k1="$1" p1="$2" k2="$3" p2="$4"
 # Coordinator holds a session lock until both workers are observed waiting.
 mkfifo "$TMP/barrier.in"
 "${PSQL[@]}" -d "$BAZA" <"$TMP/barrier.in" >"$TMP/barrier.log" 2>&1 & local coord=$!
 exec 8>"$TMP/barrier.in"
 printf '%s\n' 'SELECT pg_advisory_lock(20261120,6600);' >&8
 local ready=0
 for ((i=0;i<100;i++)); do
  if [[ "$(q "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=20261120 AND objid=6600 AND granted")" == 1 ]]; then ready=1; break; fi
  sleep 0.1
 done
 [[ "$ready" == 1 ]] || esec 'coordinator barrier not acquired'
 emit_session "$k1" "$p1" izo_aviz_a & local a=$!
 emit_session "$k2" "$p2" izo_aviz_b & local b=$!
 ready=0
 for ((i=0;i<100;i++)); do
  # postgres NOSUPERUSER nu vede wait_event-ul sesiunilor altor roluri: citirea o face adminul local.
  if [[ "$("${ADMIN[@]}" -d "$BAZA" -Atc "SELECT count(*) FROM pg_stat_activity WHERE application_name IN ('izo_aviz_a','izo_aviz_b') AND wait_event='advisory'")" == 2 ]]; then ready=1; break; fi
  sleep 0.1
 done
 printf '%s\n' 'SELECT pg_advisory_unlock(20261120,6600);' '\q' >&8
 exec 8>&-
 wait "$coord" || esec coordinator
 wait "$a" || { cat "$TMP/izo_aviz_a.log"; esec session_a; }
 wait "$b" || { cat "$TMP/izo_aviz_b.log"; esec session_b; }
 rm "$TMP/barrier.in"
 [[ "$ready" == 1 ]] || esec 'both workers did not reach barrier'
}
before="$(q 'SELECT ultim_nr FROM public.izo_avize_serii WHERE depozit_id=9')"
race 00000000-0000-0000-0000-00000000a001 AVIZ-6 00000000-0000-0000-0000-00000000a001 AVIZ-6
[[ "$(q "SELECT count(*) FROM public.izo_avize_iesire WHERE op_cheie='00000000-0000-0000-0000-00000000a001'")" == 1 ]] || esec 'same key duplicate'
[[ "$(q 'SELECT ultim_nr FROM public.izo_avize_serii WHERE depozit_id=9')" == "$((before+1))" ]] || esec 'same key counter'
[[ "$(q "SELECT count(*) FROM public.izo_operatii WHERE op_id='00000000-0000-0000-0000-00000000a001' AND tip_op='iesire'")" == 1 ]] || esec 'same key duplicate exit'
race 00000000-0000-0000-0000-00000000a002 AVIZ-7 00000000-0000-0000-0000-00000000a003 AVIZ-8
[[ "$(q "SELECT count(*)=2 AND min(numar)=$((before+2)) AND max(numar)=$((before+3)) FROM public.izo_avize_iesire WHERE op_cheie IN ('00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-00000000a003')")" == t ]] || esec 'different keys not consecutive'
# Jakarinos r4 P1: ieșire manuală B cu aceeași cheie K și EXACT numărul pe care îl va primi avizul A (același hash LIVE),
# neconfirmată cât timp A trece de verificarea cheii și așteaptă lock-ul LIVE; B confirmă → LIVE îi dă lui A răspunsul reluat.
# Avizul trebuie refuzat (iesire_nu_e_din_aceasta_cerere), fără număr consumat și fără aviz pe ieșirea lui B.
wait_app() { local app="$1" cond="${2:-wait_event='advisory'}"; for ((i=0;i<100;i++)); do
  [[ "$("${ADMIN[@]}" -d "$BAZA" -Atc "SELECT count(*) FROM pg_stat_activity WHERE application_name='$app' AND $cond")" == 1 ]] && return 0; sleep 0.1; done; return 1; }
K=00000000-0000-0000-0000-00000000a004; NR="CJPJ $(printf '%04d' $((before+4)))"
mkfifo "$TMP/barrier2.in"
"${PSQL[@]}" -d "$BAZA" <"$TMP/barrier2.in" >"$TMP/barrier2.log" 2>&1 & coord2=$!
exec 9>"$TMP/barrier2.in"
printf '%s\n' 'SELECT pg_advisory_lock(20261120,6601);' >&9
for ((i=0;i<100;i++)); do [[ "$(q "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=20261120 AND objid=6601 AND granted")" == 1 ]] && break; sleep 0.1; done
"${ADMIN[@]}" -d "$BAZA" >"$TMP/izo_aviz_m.log" 2>&1 <<SQL &
SET SESSION AUTHORIZATION authenticator;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL application_name='izo_aviz_m';
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
SELECT public.fn_izo_iesire_tronson('$K',9,19,ARRAY[(SELECT id FROM public.magazie_bucati WHERE serie='AVIZ-9')],'$NR',(now() AT TIME ZONE 'Europe/Bucharest')::date);
SELECT pg_advisory_xact_lock_shared(20261120,6601);
COMMIT;
SQL
m=$!
wait_app izo_aviz_m || esec 'manual exit did not reach barrier'
emit_session "$K" AVIZ-9 izo_aviz_r & r=$!
# Cu fix-ul r5, A se oprește pe lock-ul căii manuale (izo.iesire|autor|K, ținut de B) ÎNAINTE de verificarea cheii și de alocare.
wait_app izo_aviz_r || esec 'aviz did not wait on the manual exit key lock'
[[ "$(q 'SELECT ultim_nr FROM public.izo_avize_serii WHERE depozit_id=9')" == "$((before+3))" ]] || esec 'aviz allocated before the exit key lock'
printf '%s\n' 'SELECT pg_advisory_unlock(20261120,6601);' '\q' >&9
exec 9>&-
wait "$coord2" || esec coordinator2
wait "$m" || { cat "$TMP/izo_aviz_m.log"; esec manual_exit; }
if wait "$r"; then cat "$TMP/izo_aviz_r.log"; esec 'aviz accepted on replayed manual exit'; fi
rm "$TMP/barrier2.in"
grep -q 'cheie_operatie_existenta' "$TMP/izo_aviz_r.log" || { cat "$TMP/izo_aviz_r.log"; esec 'wrong refusal for manual exit with same key'; }
[[ "$(q "SELECT count(*) FROM public.izo_avize_iesire WHERE op_cheie='$K'")" == 0 ]] || esec 'aviz created on manual exit'
[[ "$(q 'SELECT ultim_nr FROM public.izo_avize_serii WHERE depozit_id=9')" == "$((before+3))" ]] || esec 'replay consumed number'
[[ "$(q "SELECT count(*) FROM public.izo_operatii WHERE op_id='$K' AND tip_op='iesire'")" == 1 ]] || esec 'manual exit missing'
# Varianta „pornire simultană” (Jakarinos r5): manual C și aviz D cu aceeași cheie L și același număr, eliberate de aceeași barieră.
# Orice ordine e acceptată (manual întâi → aviz refuzat; aviz întâi → manualul primește operația existentă; sau 40P01), dar
# invariantul e strict: cel mult un aviz pe L, contorul = baza + avize create, o singură operație pe L, iar avizul (dacă există)
# are exact evenimentele operației.
L=00000000-0000-0000-0000-00000000a005; base="$(q 'SELECT ultim_nr FROM public.izo_avize_serii WHERE depozit_id=9')"; NR2="CJPJ $(printf '%04d' $((base+1)))"
mkfifo "$TMP/barrier3.in"
"${PSQL[@]}" -d "$BAZA" <"$TMP/barrier3.in" >"$TMP/barrier3.log" 2>&1 & coord3=$!
exec 7>"$TMP/barrier3.in"
printf '%s\n' 'SELECT pg_advisory_lock(20261120,6600);' >&7
for ((i=0;i<100;i++)); do [[ "$(q "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=20261120 AND objid=6600 AND granted")" == 1 ]] && break; sleep 0.1; done
"${ADMIN[@]}" -d "$BAZA" >"$TMP/izo_aviz_c.log" 2>&1 <<SQL &
SET SESSION AUTHORIZATION authenticator;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL application_name='izo_aviz_c';
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
SELECT pg_advisory_xact_lock_shared(20261120,6600);
SELECT public.fn_izo_iesire_tronson('$L',9,19,ARRAY[(SELECT id FROM public.magazie_bucati WHERE serie='AVIZ-10')],'$NR2',(now() AT TIME ZONE 'Europe/Bucharest')::date);
COMMIT;
SQL
c=$!
emit_session "$L" AVIZ-10 izo_aviz_d & d=$!
wait_app izo_aviz_c || esec 'simultaneous manual did not reach barrier'
wait_app izo_aviz_d || esec 'simultaneous aviz did not reach barrier'
printf '%s\n' 'SELECT pg_advisory_unlock(20261120,6600);' '\q' >&7
exec 7>&-
wait "$coord3" || esec coordinator3
rc_c=0; wait "$c" || rc_c=$?; rc_d=0; wait "$d" || rc_d=$?
rm "$TMP/barrier3.in"
navize="$(q "SELECT count(*) FROM public.izo_avize_iesire WHERE op_cheie='$L'")"
[[ "$navize" == 0 || "$navize" == 1 ]] || esec 'simultaneous: more than one aviz'
[[ "$(q 'SELECT ultim_nr FROM public.izo_avize_serii WHERE depozit_id=9')" == "$((base+navize))" ]] || esec 'simultaneous: counter mismatch'
[[ "$(q "SELECT count(*) FROM public.izo_operatii WHERE op_id='$L'")" == 1 ]] || esec 'simultaneous: operation count'
[[ "$(q "SELECT count(*) FROM public.izo_avize_iesire a JOIN public.izo_operatii o ON o.op_id=a.op_cheie WHERE a.op_cheie='$L' AND to_jsonb(a.eveniment_ids) IS DISTINCT FROM o.raspuns->'eveniment_ids'")" == 0 ]] || esec 'simultaneous: aviz events differ from operation'
echo "PASS AVIZ simultaneous same key: avize=$navize rc_manual=$rc_c rc_aviz=$rc_d (invariants hold)"
echo 'PASS AVIZ concurrency: same key one aviz/exit/number; distinct keys consecutive; replayed manual exit refused without number'
