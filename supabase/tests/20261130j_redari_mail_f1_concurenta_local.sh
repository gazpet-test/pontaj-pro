#!/usr/bin/env bash
# Teste CONCURENTE (două sesiuni, dblink) pentru 20261130j / 20261130k și revenirile lor — Jak #987 P1-2 / P1-3. NU pe producție.
# Rulează pe un PG17 local de unică folosință (cu extensia dblink), cu scheletul 20261130j_redari_mail_f1_schelet.sql.
# Uz: PSQL=<psql> PGPORT=<port> bash supabase/tests/20261130j_redari_mail_f1_concurenta_local.sh
# Fiecare scenariu: sesiunea B (dblink) începe o tranzacție, scrie „date” necomise, apoi comite după 2 s (dblink_send_query asincron);
# sesiunea A rulează migrarea / revenirea (marcajul de livrare ca runnerul oficial). Cu blocările ÎNAINTEA verificărilor, A așteaptă commit-ul
# lui B, VEDE datele și refuză. Pentru control, scenariul S1 rulează și o copie a lui k FĂRĂ blocări: aceea trece (bug-ul reprodus).
set -uo pipefail
export PGCLIENTENCODING=UTF8
PSQL=${PSQL:-psql}; PORT=${PGPORT:-55432}
R=$(cd "$(dirname "$0")/../.." && (pwd -W 2>/dev/null || pwd))
TMP=$(cd "$(mktemp -d)" && (pwd -W 2>/dev/null || pwd)); trap 'rm -rf "$TMP"' EXIT
ESEC=0
q() { "$PSQL" -X -q -At -h localhost -p "$PORT" -U postgres -d "$1" -c "$2"; }
baza() { # $1 = db, $2 = pași: j | jk
  "$PSQL" -X -q -h localhost -p "$PORT" -U postgres -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1" > /dev/null
  "$PSQL" -X -q -v ON_ERROR_STOP=1 -h localhost -p "$PORT" -U postgres -d "$1" -f "$R/supabase/tests/20261130j_redari_mail_f1_schelet.sql" > /dev/null
  q "$1" "CREATE SCHEMA dbl; CREATE EXTENSION dblink SCHEMA dbl;" > /dev/null
  [ "$2" = "-" ] && return
  aplica "$1" j "$R/supabase/migrations/20261130j_redari_mail_f1_schema.sql" > /dev/null 2>&1
  [ "$2" = "jk" ] && aplica "$1" k "$R/supabase/migrations/20261130k_redari_mail_f1_reguli.sql" > /dev/null 2>&1
}
aplica() { # $1 = db, $2 = j | k | rj | rk, $3 = fișier; o tranzacție, ca runnerul
  local m
  case "$2" in
    j) m="SELECT set_config('gazpet.livrare_migrare', '20261130j_redari_mail_f1_schema:' || txid_current(), true);" ;;
    k) m="SELECT set_config('gazpet.livrare_migrare', '20261130k_redari_mail_f1_reguli:' || txid_current(), true);" ;;
    rj) m="SELECT set_config('gazpet.revenire_20261130j', 'REDARI_MAIL_F1_SCHEMA_SCOS:' || txid_current(), true);" ;;
    rk) m="SELECT set_config('gazpet.revenire_20261130k', 'REDARI_MAIL_F1_REGULI_SCOS:' || txid_current(), true);" ;;
  esac
  printf 'BEGIN;\n%s\n\\i %s\nCOMMIT;\n' "$m" "$3" > "$TMP/tx.sql"
  "$PSQL" -X -q -v ON_ERROR_STOP=1 -h localhost -p "$PORT" -U postgres -d "$1" -f "$TMP/tx.sql" 2>&1
}
# B rulează pe o conexiune dblink ținută de o sesiune psql separată, în fundal (altfel conexiunea s-ar închide la ieșirea lui q)
b_fundal() { # $1 = db, $2 = SQL B
  "$PSQL" -X -q -At -h localhost -p "$PORT" -U postgres -d "$1" -c "SELECT dbl.dblink_connect('b', 'host=localhost port=$PORT dbname=$1 user=postgres');
     SELECT dbl.dblink_exec('b', 'BEGIN'); SELECT dbl.dblink_exec('b', \$b\$$2\$b\$); SELECT pg_sleep(3); SELECT dbl.dblink_exec('b', 'COMMIT');" > /dev/null 2>&1 &
  sleep 1.5
}
verifica() { # $1 = eticheta, $2 = condiție adevărată = OK
  if [ "$2" = "t" ]; then echo "  OK    $1"; else echo "  FAIL  $1"; ESEC=1; fi
}

echo "S1 (P1-2): k aplicată separat de j, cu un răspuns email inserat concurent și necomis"
baza s1 j
b_fundal s1 "INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune) VALUES ('00000000-0000-0000-0000-00000000e001', 'email', 'nu_particip_fara_obiectii')"
out=$(aplica s1 k "$R/supabase/migrations/20261130k_redari_mail_f1_reguli.sql"); wait
verifica "k refuzată după commit-ul lui B ($(echo "$out" | grep -o 'exista raspunsuri canal = email[^;]*' | head -1))" \
  "$(q s1 "SELECT to_regprocedure('public.fn_red_mail_are_legatura_juridica(uuid)') IS NULL AND (SELECT count(*) FROM public.red_raspunsuri WHERE canal = 'email') = 1")"
echo "S1-control (mutație): aceeași cursă cu o copie a lui k FĂRĂ blocările de la început și fără re-verificarea din postcondiție"
grep -v -E '^  LOCK TABLE|^             public[.]red_mail_obiecte' "$R/supabase/migrations/20261130k_redari_mail_f1_reguli.sql" \
  | sed "s/RAISE EXCEPTION '20261130k post: au aparut date/RAISE NOTICE '20261130k post (MUTATIE): au aparut date/" > "$TMP/k_fara_lock.sql"
baza s1m j
b_fundal s1m "INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune) VALUES ('00000000-0000-0000-0000-00000000e001', 'email', 'nu_particip_fara_obiectii')"
out=$(aplica s1m k "$TMP/k_fara_lock.sql"); wait; echo "$out" | grep -E "ERROR|MUTATIE" | head -2
verifica "fără blocări, k trece și rămâne un răspuns email FĂRĂ sursă (bug-ul reprodus => testul S1 îl prinde)" \
  "$(q s1m "SELECT to_regprocedure('public.fn_red_mail_are_legatura_juridica(uuid)') IS NOT NULL AND (SELECT count(*) FROM public.red_raspunsuri r WHERE canal = 'email' AND NOT EXISTS (SELECT 1 FROM public.red_mail_raspuns_sursa s WHERE s.raspuns_id = r.id)) = 1")"

echo "S2 (P1-3): revenirea j cu un upload mail/ concurent ca service_role (ocolește RLS)"
baza s2 j
b_fundal s2 "SET LOCAL ROLE service_role; INSERT INTO storage.objects (bucket_id, name) VALUES ('redari', 'mail/redari/carantina/' || repeat('a', 64) || '.eml')"
out=$(aplica s2 rj "$R/supabase/revenire/20261130j_redari_mail_f1_schema_ROLLBACK.sql"); wait
verifica "revenirea j refuzată (REFUZATA), politicile mail/ rămân" \
  "$(q s2 "SELECT to_regclass('public.red_mail_primite') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'red_storage_sel' AND qual LIKE '%mail/%')")"
echo "S2-control (mutație): aceeași cursă cu o copie a revenirii j FĂRĂ blocări"
grep -v -E '^  LOCK TABLE|^             public[.]red_mail_obiecte' "$R/supabase/revenire/20261130j_redari_mail_f1_schema_ROLLBACK.sql" > "$TMP/rj_fara_lock.sql"
baza s2m j
b_fundal s2m "SET LOCAL ROLE service_role; INSERT INTO storage.objects (bucket_id, name) VALUES ('redari', 'mail/redari/carantina/' || repeat('a', 64) || '.eml')"
aplica s2m rj "$TMP/rj_fara_lock.sql" > /dev/null 2>&1; wait
verifica "fără blocări, revenirea trece și obiectul mail/ rămâne sub politicile vechi (bug-ul reprodus => S2 îl prinde)" \
  "$(q s2m "SELECT to_regclass('public.red_mail_primite') IS NULL AND EXISTS (SELECT 1 FROM storage.objects WHERE left(name, 5) = 'mail/')")"
echo "S3 (P1-3): revenirea k cu un eveniment red_mail_* inserat concurent"
baza s3 jk
b_fundal s3 "INSERT INTO public.red_mail_evenimente (tip, casuta, numar) VALUES ('spam_numarat', 'redari@gazpet.ro', 1)"
out=$(aplica s3 rk "$R/supabase/revenire/20261130k_redari_mail_f1_reguli_ROLLBACK.sql"); wait
verifica "revenirea k refuzată, regulile rămân" "$(q s3 "SELECT to_regprocedure('public.fn_red_mail_are_legatura_juridica(uuid)') IS NOT NULL")"
echo "S4 (L01 pe apply j): un obiect mail/ urcat concurent de un editor (politica veche încă permite) înaintea lui j"
baza s4 -
b_fundal s4 "SELECT set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-0000000000a3\",\"role\":\"authenticated\"}', true); SET LOCAL ROLE authenticated; INSERT INTO storage.objects (bucket_id, name) VALUES ('redari', 'mail/redari/x')"
out=$(aplica s4 j "$R/supabase/migrations/20261130j_redari_mail_f1_schema.sql"); wait
verifica "j refuzată după commit-ul upload-ului ($(echo "$out" | grep -o 'exista deja obiecte sub redari/mail/' | head -1))" \
  "$(q s4 "SELECT to_regclass('public.red_mail_primite') IS NULL AND EXISTS (SELECT 1 FROM storage.objects WHERE name = 'mail/redari/x')")"

for d in s1 s1m s2 s2m s3 s4; do "$PSQL" -X -q -h localhost -p "$PORT" -U postgres -d postgres -c "DROP DATABASE IF EXISTS $d" > /dev/null; done
[ $ESEC = 0 ] && echo "CONCURENȚĂ: TOATE OK" || { echo "CONCURENȚĂ: ESEC"; exit 1; }
