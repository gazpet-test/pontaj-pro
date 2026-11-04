#!/usr/bin/env bash
# Teste CONCURENTE (două sesiuni reale) pentru 20261130j / 20261130k și revenirile lor — Jak #987 r1 P1-2 / P1-3, r2 P1 / P2. NU pe producție.
# Rulează pe un PG17 local de unică folosință, cu scheletul 20261130j_redari_mail_f1_schelet.sql.
# Uz: PSQL=<psql> PGPORT=<port> bash supabase/tests/20261130j_redari_mail_f1_concurenta_local.sh
# Fără timpi ficși: BARIERE explicite pe starea celeilalte sesiuni (pg_stat_activity), nu sleep:
#   1. sesiunea B (proces psql separat, application_name = scriitor_B) începe o tranzacție și scrie (necomis), apoi intră într-o buclă
#      „bariera_B” care așteaptă până când sesiunea A (application_name = migrare_A) e blocată pe un lock (wait_event_type = 'Lock'), apoi comite;
#   2. scriptul pornește A abia după ce B e în bucla „bariera_B” (deci scrierea lui B e făcută);
#   3. ambele procese sunt capturate (pid, cod de ieșire, ieșire), iar condiția de succes include codurile, MESAJUL EXACT al refuzului
#      și datele comise de B. Fiecare buclă are o limită (30 s) care o face să pice explicit, nu să atârne.
# Controalele (mutație) rulează aceeași cursă cu copii fără blocări / cu ordinea veche și arată că testul ar prinde bug-ul.
set -uo pipefail
export PGCLIENTENCODING=UTF8
PSQL=${PSQL:-psql}; PORT=${PGPORT:-55432}
R=$(cd "$(dirname "$0")/../.." && (pwd -W 2>/dev/null || pwd))
TMP=$(cd "$(mktemp -d)" && (pwd -W 2>/dev/null || pwd)); trap 'rm -rf "$TMP"' EXIT
ESEC=0
q() { "$PSQL" -X -q -At -h localhost -p "$PORT" -U postgres -d "$1" -c "$2"; }
BUCLA="t0 timestamptz := clock_timestamp(); BEGIN WHILE NOT (%s) LOOP PERFORM pg_sleep(0.02); PERFORM pg_stat_clear_snapshot(); IF clock_timestamp() > t0 + interval '30 seconds' THEN RAISE EXCEPTION 'bariera %s depasita'; END IF; END LOOP; END"
bariera() { # $1 = db, $2 = condiție SQL, $3 = eticheta (sesiunea scriptului)
  q "$1" "DO \$w\$ DECLARE $(printf "$BUCLA" "$2" "$3") \$w\$;" > /dev/null || { echo "  FAIL  bariera $3"; ESEC=1; }
}
baza() { # $1 = db, $2 = - | j | jk
  "$PSQL" -X -q -h localhost -p "$PORT" -U postgres -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1" > /dev/null 2>&1
  "$PSQL" -X -q -v ON_ERROR_STOP=1 -h localhost -p "$PORT" -U postgres -d "$1" -f "$R/supabase/tests/20261130j_redari_mail_f1_schelet.sql" > /dev/null
  [ "$2" = "-" ] && return
  APP_A=pregatire aplica "$1" j "$R/supabase/migrations/20261130j_redari_mail_f1_schema.sql" > /dev/null 2>&1
  [ "$2" = "jk" ] && APP_A=pregatire aplica "$1" k "$R/supabase/migrations/20261130k_redari_mail_f1_reguli.sql" > /dev/null 2>&1
}
aplica() { # $1 = db, $2 = j | k | rj | rk, $3 = fișier — o tranzacție, cu marcajul runnerului
  local m
  case "$2" in
    j) m="SELECT set_config('gazpet.livrare_migrare', '20261130j_redari_mail_f1_schema:' || txid_current(), true);" ;;
    k) m="SELECT set_config('gazpet.livrare_migrare', '20261130k_redari_mail_f1_reguli:' || txid_current(), true);" ;;
    rj) m="SELECT set_config('gazpet.revenire_20261130j', 'REDARI_MAIL_F1_SCHEMA_SCOS:' || txid_current(), true);" ;;
    rk) m="SELECT set_config('gazpet.revenire_20261130k', 'REDARI_MAIL_F1_REGULI_SCOS:' || txid_current(), true);" ;;
  esac
  printf "SET application_name = '%s';\nBEGIN;\n%s\n\\\\i %s\nCOMMIT;\n" "${APP_A:-migrare_A}" "$m" "$3" > "$TMP/tx_$1_$2.sql"
  "$PSQL" -X -q -v ON_ERROR_STOP=1 -h localhost -p "$PORT" -U postgres -d "$1" -f "$TMP/tx_$1_$2.sql" 2>&1
}
# în baza() aplicările de pregătire nu se numesc migrare_A (nu sunt în cursă)
# cursa: $1 = db, $2 = SQL-ul lui B (scrierea necomisă), $3 = pas A (j|k|rj|rk), $4 = fișierul lui A. Rezultate în RC_A, RC_B, OUT_A, OUT_B.
cursa() {
  local db=$1
  # RESET ROLE înaintea barierei: doar un superuser vede wait_event-ul altei sesiuni în pg_stat_activity (scrierea s-a făcut cu rolul cerut)
  printf "SET application_name = 'scriitor_B';\nBEGIN;\n%s;\nRESET ROLE;\nDO \$w\$ DECLARE %s \$w\$;\nCOMMIT;\n" "$2" \
    "$(printf "$BUCLA" "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'migrare_A' AND wait_event_type = 'Lock')" "bariera_B")" > "$TMP/b_$db.sql"
  "$PSQL" -X -q -v ON_ERROR_STOP=1 -h localhost -p "$PORT" -U postgres -d "$db" -f "$TMP/b_$db.sql" > "$TMP/b_$db.out" 2>&1 &
  local pb=$!
  # barieră 1: B e în bucla „bariera_B” => scrierea lui necomisă e făcută
  bariera "$db" "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'scriitor_B' AND state = 'active' AND query LIKE '%bariera_B%')" "B_a_scris"
  aplica "$db" "$3" "$4" > "$TMP/a_$db.out" 2>&1 &
  local pa=$!
  wait $pa; RC_A=$?; wait $pb; RC_B=$?
  OUT_A=$(cat "$TMP/a_$db.out"); OUT_B=$(cat "$TMP/b_$db.out")
}
verifica() { # $1 = eticheta, $2 = rezultatul (t = OK)
  if [ "$2" = "t" ]; then echo "  OK    $1"; else echo "  FAIL  $1"; echo "        A(rc=$RC_A): $(echo "$OUT_A" | grep -E 'ERROR|FATAL' | head -2)"; echo "        B(rc=$RC_B): $(echo "$OUT_B" | grep -E 'ERROR|FATAL' | head -2)"; ESEC=1; fi
}
are() { echo "$1" | grep -qF -- "$2" && echo t || echo f; }
si() { for x in "$@"; do [ "$x" = "t" ] || { echo f; return; }; done; echo t; }
fara_lock() { grep -v -E '^  LOCK TABLE|^             public[.]red_mail_obiecte' "$1"; }
EMAIL="INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune) VALUES ('00000000-0000-0000-0000-00000000e001', 'email', 'nu_particip_fara_obiectii')"
MAIL_SR="SET LOCAL ROLE service_role; INSERT INTO storage.objects (bucket_id, name) VALUES ('redari', 'mail/redari/carantina/' || repeat('a', 64) || '.eml')"

echo "S1 (r1 P1-2): k aplicată separat de j, cu un răspuns email inserat concurent și necomis"
baza s1 j; cursa s1 "$EMAIL" k "$R/supabase/migrations/20261130k_redari_mail_f1_reguli.sql"
verifica "B comis (rc=0), A refuzată cu motivul exact, rândul lui B prezent, k neaplicată" "$(si "$([ $RC_B = 0 ] && echo t)" "$([ $RC_A != 0 ] && echo t)" \
  "$(are "$OUT_A" '20261130k: exista raspunsuri canal = email preexistente (1)')" \
  "$(q s1 "SELECT (SELECT count(*) FROM public.red_raspunsuri WHERE canal = 'email') = 1 AND to_regprocedure('public.fn_red_mail_are_legatura_juridica(uuid)') IS NULL")")"
echo "S1-control (mutație): k fără blocări și fără re-verificarea din postcondiție"
fara_lock "$R/supabase/migrations/20261130k_redari_mail_f1_reguli.sql" \
  | sed "s/RAISE EXCEPTION '20261130k post: au aparut date/RAISE NOTICE '20261130k post (MUTATIE): au aparut date/" > "$TMP/k_fara_lock.sql"
baza s1m j; cursa s1m "$EMAIL" k "$TMP/k_fara_lock.sql"
verifica "bug reprodus: ambele rc=0, k aplicată, răspuns email FĂRĂ sursă" "$(si "$([ $RC_B = 0 ] && [ $RC_A = 0 ] && echo t)" \
  "$(q s1m "SELECT to_regprocedure('public.fn_red_mail_are_legatura_juridica(uuid)') IS NOT NULL AND (SELECT count(*) FROM public.red_raspunsuri r WHERE canal = 'email' AND NOT EXISTS (SELECT 1 FROM public.red_mail_raspuns_sursa s WHERE s.raspuns_id = r.id)) = 1")")"

echo "S2 (r1 P1-3): revenirea j cu un upload mail/ concurent ca service_role (ocolește RLS)"
baza s2 j; cursa s2 "$MAIL_SR" rj "$R/supabase/revenire/20261130j_redari_mail_f1_schema_ROLLBACK.sql"
verifica "B comis, A refuzată (REFUZATA), obiectul lui B prezent, schema și politicile mail/ rămân" "$(si "$([ $RC_B = 0 ] && [ $RC_A != 0 ] && echo t)" \
  "$(are "$OUT_A" '20261130j revenire REFUZATA: exista date red_mail_* / obiecte mail/')" \
  "$(q s2 "SELECT EXISTS (SELECT 1 FROM storage.objects WHERE left(name, 5) = 'mail/') AND to_regclass('public.red_mail_primite') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'red_storage_sel' AND qual LIKE '%mail/%')")")"
echo "S2-control (mutație): revenirea j fără blocări"
fara_lock "$R/supabase/revenire/20261130j_redari_mail_f1_schema_ROLLBACK.sql" > "$TMP/rj_fara_lock.sql"
baza s2m j; cursa s2m "$MAIL_SR" rj "$TMP/rj_fara_lock.sql"
verifica "bug reprodus: ambele rc=0, schema scoasă, obiectul mail/ rămas sub politicile vechi" "$(si "$([ $RC_B = 0 ] && [ $RC_A = 0 ] && echo t)" \
  "$(q s2m "SELECT to_regclass('public.red_mail_primite') IS NULL AND EXISTS (SELECT 1 FROM storage.objects WHERE left(name, 5) = 'mail/')")")"

echo "S3 (r1 P1-3): revenirea k cu un eveniment red_mail_* inserat concurent"
baza s3 jk; cursa s3 "INSERT INTO public.red_mail_evenimente (tip, casuta, numar) VALUES ('spam_numarat', 'redari@gazpet.ro', 1)" rk "$R/supabase/revenire/20261130k_redari_mail_f1_reguli_ROLLBACK.sql"
verifica "B comis, A refuzată (REFUZATA), evenimentul lui B prezent, regulile rămân" "$(si "$([ $RC_B = 0 ] && [ $RC_A != 0 ] && echo t)" \
  "$(are "$OUT_A" '20261130k revenire REFUZATA: regulile protejeaza deja date')" \
  "$(q s3 "SELECT (SELECT count(*) FROM public.red_mail_evenimente) = 1 AND to_regprocedure('public.fn_red_mail_are_legatura_juridica(uuid)') IS NOT NULL")")"

echo "S4 (L01 pe apply j): un obiect mail/ urcat concurent de un editor (politica veche încă permite)"
baza s4 -; cursa s4 "SELECT set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-0000000000a3\",\"role\":\"authenticated\"}', true); SET LOCAL ROLE authenticated; INSERT INTO storage.objects (bucket_id, name) VALUES ('redari', 'mail/redari/x')" \
  j "$R/supabase/migrations/20261130j_redari_mail_f1_schema.sql"
verifica "B comis, A refuzată cu motivul exact, obiectul prezent, j neaplicată" "$(si "$([ $RC_B = 0 ] && [ $RC_A != 0 ] && echo t)" \
  "$(are "$OUT_A" '20261130j: exista deja obiecte sub redari/mail/ (asteptat 0)')" \
  "$(q s4 "SELECT to_regclass('public.red_mail_primite') IS NULL AND EXISTS (SELECT 1 FROM storage.objects WHERE name = 'mail/redari/x')")")"

# S5 (r2 P1): scriitorul telefonic manual (editor) a atins deja red_raspunsuri (ROW EXCLUSIVE) când pornește j; apoi, cu j blocată, își face
# INSERT-ul, care are nevoie de red_jurnal (triggerul de jurnal). Cu ordinea j (red_raspunsuri înaintea red_jurnal): j așteaptă, B termină,
# apoi j termină. Controlul cu ordinea veche (red_jurnal blocat înainte, FK-ul pe red_raspunsuri luat implicit mai târziu) => deadlock.
TEL="LOCK TABLE public.red_raspunsuri IN ROW EXCLUSIVE MODE; SELECT set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-0000000000a3\",\"role\":\"authenticated\"}', true)"
TEL_PAS2="SET LOCAL ROLE authenticated; INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune) VALUES ('00000000-0000-0000-0000-00000000e002', 'telefon', 'nu_particip_fara_obiectii')"
cursa_tel() { # ca cursa(), dar B face al doilea pas (INSERT-ul) DUPĂ barieră
  local db=$1
  printf "SET application_name = 'scriitor_B';\nBEGIN;\n%s;\nDO \$w\$ DECLARE %s \$w\$;\n%s;\nCOMMIT;\n" "$TEL" \
    "$(printf "$BUCLA" "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'migrare_A' AND wait_event_type = 'Lock')" "bariera_B")" "$TEL_PAS2" > "$TMP/b_$db.sql"
  "$PSQL" -X -q -v ON_ERROR_STOP=1 -h localhost -p "$PORT" -U postgres -d "$db" -f "$TMP/b_$db.sql" > "$TMP/b_$db.out" 2>&1 &
  local pb=$!
  bariera "$db" "EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'scriitor_B' AND state = 'active' AND query LIKE '%bariera_B%')" "B_a_atins_red_raspunsuri"
  aplica "$db" j "$2" > "$TMP/a_$db.out" 2>&1 &
  local pa=$!
  wait $pa; RC_A=$?; wait $pb; RC_B=$?
  OUT_A=$(cat "$TMP/a_$db.out"); OUT_B=$(cat "$TMP/b_$db.out")
}
echo "S5 (r2 P1): scriitor telefonic manual concurent cu apply j — fără deadlock, ambele termină"
baza s5 -; cursa_tel s5 "$R/supabase/migrations/20261130j_redari_mail_f1_schema.sql"
verifica "ambele rc=0, fără deadlock, răspunsul telefonic al lui B comis, j aplicată" "$(si "$([ $RC_A = 0 ] && [ $RC_B = 0 ] && echo t)" \
  "$(are "$OUT_A$OUT_B" 'deadlock' | tr tf ft)" \
  "$(q s5 "SELECT EXISTS (SELECT 1 FROM public.red_raspunsuri WHERE canal = 'telefon' AND detinator_id = '00000000-0000-0000-0000-00000000e002') AND to_regclass('public.red_mail_primite') IS NOT NULL")")"
echo "S5-control (mutație): j cu ordinea veche (red_jurnal blocat înaintea tabelelor Redări, FK-urile luate implicit mai târziu)"
grep -v -E '^  LOCK TABLE public[.]red_(raspunsuri|detinatori|parcele|corespondenta) IN' "$R/supabase/migrations/20261130j_redari_mail_f1_schema.sql" > "$TMP/j_ordine_veche.sql"
baza s5m -; cursa_tel s5m "$TMP/j_ordine_veche.sql"
verifica "bug reprodus: deadlock detectat, una dintre tranzacții anulată" "$(si "$(are "$OUT_A$OUT_B" 'deadlock detected')" "$([ $RC_A != 0 ] || [ $RC_B != 0 ] && echo t)")"

for d in s1 s1m s2 s2m s3 s4 s5 s5m; do "$PSQL" -X -q -h localhost -p "$PORT" -U postgres -d postgres -c "DROP DATABASE IF EXISTS $d" > /dev/null 2>&1; done
[ $ESEC = 0 ] && echo "CONCURENȚĂ: TOATE OK" || { echo "CONCURENȚĂ: EȘEC"; exit 1; }
