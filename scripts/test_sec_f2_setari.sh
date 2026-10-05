#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261015b_sec_f2_setari_rag_maigov. EXCLUSIV pe un PostgreSQL local dedicat
# (implicit PG16, /tmp/pg_sec_f2, 127.0.0.1:5977). Nu atinge producția.
#   0. schelet (supabase/tests/sec_f2_setari_schelet.sql) = politicile + joburile live (comenzi mascate, md5 normalizat egal)
#   1. fișierul fără runner → garda refuză, nimic schimbat
#   2. precondiții negative: Vault (intern lipsă / alt format, anon lipsă) · job schimbat · JWT din job ≠ Vault ·
#      politică în plus pe logistica_setari
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + gate 0e) → cod 0
#   4. comportament pe roluri: coleg fără modul · logistica viewer / editor / admin · administrativ.upa editor · owner ·
#      anon · mutarea unui rând pe o cheie nepermisă · necesar_setari · jurnalul MAI
#   5. joburile: fără secret/JWT în clar, antetele din Vault la rulare
#   6. reaplicare → refuz
#   7. revenire: nearmată → refuz; armată → politicile vechi
# Utilizare: bash scripts/test_sec_f2_setari.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_sec_f2}"
PORT="${PGPORT_TEST:-5977}"
BAZA=sec_f2_test
NUME=20261015b_sec_f2_setari_rag_maigov
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/sec_f2_setari_schelet.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_sec_f2.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
gate_0e() { local o; o="$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql")" || esec "gate 0e: psql a eșuat"; [ -z "$o" ] || esec "gate 0e: $(grep -c . <<<"$o") rânduri"; ok "gate 0e = 0 ($1)"; }
OWNER=00000000-0000-0000-0000-0000000000a1
COLEG=00000000-0000-0000-0000-0000000000b2
LOG_ED=00000000-0000-0000-0000-0000000000c3
LOG_ADM=00000000-0000-0000-0000-0000000000d4
UPA_ED=00000000-0000-0000-0000-0000000000e5
LOG_VIEW=00000000-0000-0000-0000-0000000000f6
# ca <uid> <sql>: rulează ca authenticated cu auth.uid() = uid; întoarce numărul de rânduri atinse (RETURNING) sau eroarea
ca() { { q "BEGIN; SELECT set_config('request.jwt.claim.sub', '$1', true) IS NULL; SET LOCAL ROLE authenticated; $2; COMMIT;" 2>&1 || true; } | tail -n 1; }
# scrie <uid> <cheie>: UPDATE pe cheie → 1 dacă a trecut, 0 dacă RLS l-a filtrat
scrie() { ca "$1" "WITH x AS (UPDATE public.logistica_setari SET value = value WHERE key = '$2' RETURNING 1) SELECT count(*) FROM x"; }
# insereaza <uid> <cheie>: INSERT → ok / RLS
insereaza() { local out; out="$(ca "$1" "INSERT INTO public.logistica_setari (key, value) VALUES ('$2', 'v') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value RETURNING 1")"
  if [ "$out" = 1 ]; then echo ok; elif grep -q "row-level security" <<<"$out"; then echo RLS; else echo "ALTCEVA: $out"; fi; }
# ca_anon <sql>: rulează ca anon (fără auth.uid)
ca_anon() { { q "BEGIN; SET LOCAL ROLE anon; $1; COMMIT;" 2>&1 || true; } | tail -n 1; }
ca_srv() { { q "BEGIN; SET LOCAL ROLE service_role; $1; COMMIT;" 2>&1 || true; } | tail -n 1; }
POLITICI="SELECT string_agg(c.relname || '.' || p.polname, ',' ORDER BY c.relname, p.polname) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relname IN ('logistica_setari','necesar_setari','mai_gov_redirect_log')"
JOBURI="SELECT string_agg(md5(command), ',' ORDER BY jobid) FROM cron.job"

"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
"${PSQL[@]}" -d "$BAZA" -c "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);" >/dev/null
NORM="SELECT string_agg(md5(regexp_replace(regexp_replace(command, 'eyJ[A-Za-z0-9_.-]+', '<JWT>', 'g'), '(x-internal-secret|x-ingest-secret)''[[:space:]]*,[[:space:]]*''[^'']*''', E'\\\\1'',''<S>''', 'g')), ',' ORDER BY jobid) FROM cron.job"
[ "$(q "$NORM")" = "d5a9c2e77f45f30a777ed7a7ad6674a2,5595149af4543bf67e078e6a3b9b8bcc,000dc9b944a2cd2abb473da66b9e446a" ] || esec "0 joburile din schelet ≠ live: $(q "$NORM")"
POL0="$(q "$POLITICI")"; JOB0="$(q "$JOBURI")"
ok "0 schelet: 3 joburi cu md5 normalizat = live, politicile live pe cele 3 tabele"

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
[ "$(q "$POLITICI")" = "$POL0" ] && [ "$(q "$JOBURI")" = "$JOB0" ] || esec "1 ceva s-a schimbat"
ok "1 fără runner → refuz, nimic schimbat"

refuza_cu() { local out; if out="$("${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1)"; then esec "$1 a trecut"; fi
  grep -q "$2" <<<"$out" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$out")"; }
q "UPDATE vault.secrets SET name='X' WHERE name='INTERN_EDGE_SECRET'" >/dev/null
refuza_cu "2a secret intern lipsă" "Precondiție 0b"
q "UPDATE vault.secrets SET name='INTERN_EDGE_SECRET', secret='scurt' WHERE name='X'" >/dev/null
refuza_cu "2b secret intern cu alt format" "Precondiție 0b"
q "UPDATE vault.secrets SET secret=repeat('a1', 32) WHERE name='INTERN_EDGE_SECRET'" >/dev/null
q "UPDATE vault.secrets SET name='Y' WHERE name='SUPABASE_ANON_JWT'" >/dev/null
refuza_cu "2c anon JWT lipsă din Vault" "Precondiție 0b"
q "UPDATE vault.secrets SET name='SUPABASE_ANON_JWT' WHERE name='Y'" >/dev/null
q "UPDATE cron.job SET schedule='*/10 * * * *' WHERE jobid=17" >/dev/null
refuza_cu "2d job cu alt program" "Precondiție 0c"
q "UPDATE cron.job SET schedule='*/5 * * * *' WHERE jobid=17" >/dev/null
q "UPDATE cron.job SET command=replace(command, 'polls=8', 'polls=9') WHERE jobid=30" >/dev/null
refuza_cu "2e job cu altă comandă" "Precondiție 0c"
q "UPDATE cron.job SET command=replace(command, 'polls=9', 'polls=8') WHERE jobid=30" >/dev/null
q "UPDATE vault.secrets SET secret='eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.alta' WHERE name='SUPABASE_ANON_JWT'" >/dev/null
refuza_cu "2f JWT din job ≠ Vault" "Precondiție 0c"
q "UPDATE vault.secrets SET secret='eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.test-semnatura' WHERE name='SUPABASE_ANON_JWT'" >/dev/null
q "UPDATE vault.secrets SET secret='eyJ' WHERE name='SUPABASE_ANON_JWT'" >/dev/null
refuza_cu "2f2 JWT din Vault = prefix (eyJ)" "Precondiție 0b"
q "UPDATE vault.secrets SET secret='' WHERE name='SUPABASE_ANON_JWT'" >/dev/null
refuza_cu "2f3 JWT din Vault gol" "Precondiție 0b"
q "UPDATE vault.secrets SET secret='eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.test-semnatura' WHERE name='SUPABASE_ANON_JWT'" >/dev/null
q "CREATE TABLE public.rag_ask_log (id int)" >/dev/null
refuza_cu "2h rag_ask_log există" "Precondiție 0f"
q "DROP TABLE public.rag_ask_log" >/dev/null
q "CREATE POLICY in_plus_public ON public.logistica_setari FOR UPDATE TO PUBLIC USING (true)" >/dev/null
refuza_cu "2i politică în plus TO PUBLIC" "Precondiție 0d"
q "DROP POLICY in_plus_public ON public.logistica_setari" >/dev/null
q "CREATE POLICY in_plus ON public.logistica_setari FOR UPDATE TO authenticated USING (true)" >/dev/null
refuza_cu "2g politică în plus" "Precondiție 0d"
q "DROP POLICY in_plus ON public.logistica_setari" >/dev/null
[ "$(q "$POLITICI")" = "$POL0" ] && [ "$(q "$JOBURI")" = "$JOB0" ] || esec "2 starea nerefăcută"
ok "2 refuz la: secret intern lipsă / alt format · anon JWT lipsă / prefix / gol · job cu alt program / altă comandă · JWT din job ≠ Vault · rag_ask_log existent · politică în plus (authenticated și TO PUBLIC)"

# înainte: gaura există (coleg fără modul scrie destinatarii)
[ "$(scrie $COLEG upa_alerta_emails)" = 1 ] || esec "0b gaura nu se reproduce pe schelet"
SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261005200000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/sec_f2_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/sec_f2_runner.out >&2; esec "3 runner cod $RC"; }
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA"
gate_0e dupa

# 4. comportament
for k in pret_motorina_ron aviz_email_destinatari upa_plafon_lunar upa_alerta_emails firma_nume probleme_reminder_emails; do
  [ "$(scrie $COLEG $k)" = 0 ] || esec "4a coleg fără modul scrie $k"
  [ "$(scrie $LOG_VIEW $k)" = 0 ] || esec "4a logistica viewer scrie $k"
  [ "$(scrie $OWNER $k)" = 1 ] || esec "4a owner nu scrie $k"
done
ok "4a coleg fără modul și logistica viewer: 0 rânduri pe toate cheile · owner: toate"
[ "$(scrie $LOG_ED pret_motorina_ron)" = 1 ] && [ "$(scrie $LOG_ED pret_motorina_actualizat)" = 1 ] || esec "4b logistica editor nu scrie prețul"
for k in aviz_email_destinatari upa_plafon_lunar upa_alerta_emails firma_nume; do [ "$(scrie $LOG_ED $k)" = 0 ] || esec "4b logistica editor scrie $k"; done
ok "4b logistica editor: doar prețul motorinei"
[ "$(scrie $LOG_ADM aviz_email_destinatari)" = 1 ] && [ "$(scrie $LOG_ADM pret_motorina_ron)" = 1 ] || esec "4c logistica admin"
for k in upa_plafon_lunar upa_alerta_emails firma_nume probleme_reminder_emails; do [ "$(scrie $LOG_ADM $k)" = 0 ] || esec "4c logistica admin scrie $k"; done
ok "4c logistica admin: prețul + destinatarii avizului, nimic altceva"
[ "$(scrie $UPA_ED upa_plafon_lunar)" = 1 ] || esec "4d UPA editor nu scrie plafonul"
for k in upa_alerta_emails pret_motorina_ron aviz_email_destinatari; do [ "$(scrie $UPA_ED $k)" = 0 ] || esec "4d UPA editor scrie $k"; done
ok "4d administrativ.upa editor: doar upa_plafon_lunar"
[ "$(insereaza $LOG_ED pret_motorina_ron)" = ok ] || esec "4e upsert preț de către editor refuzat"
[ "$(insereaza $LOG_ED cheie_noua)" = RLS ] || esec "4e editorul creează o cheie nouă"
[ "$(insereaza $COLEG upa_alerta_emails)" = RLS ] || esec "4e colegul face upsert pe destinatari"
[ "$(insereaza $OWNER cheie_noua)" = ok ] || esec "4e owner nu creează cheie"
ok "4e upsert (INSERT … ON CONFLICT): editor pe preț da, cheie nouă / destinatari de alții → RLS, owner da"
out="$(ca $LOG_ED "UPDATE public.logistica_setari SET key = 'upa_alerta_emails_2' WHERE key = 'pret_motorina_ron'")"
grep -q "row-level security" <<<"$out" || esec "4f editorul mută rândul prețului pe altă cheie: $out"
[ "$(ca $LOG_ADM "WITH x AS (DELETE FROM public.logistica_setari WHERE key = 'pret_motorina_actualizat' RETURNING 1) SELECT count(*) FROM x")" = 0 ] || esec "4g admin modul șterge"
ok "4f mutarea pe o cheie nepermisă → RLS · 4g DELETE doar owner"
[ "$(ca $COLEG "WITH x AS (UPDATE public.necesar_setari SET valoare = 'true' WHERE cheie = 'aprobare_activa' RETURNING 1) SELECT count(*) FROM x")" = 0 ] || esec "4h coleg schimbă aprobarea"
[ "$(ca $COLEG "SELECT count(*) FROM public.necesar_setari")" = 2 ] || esec "4h colegul nu mai citește necesar_setari"
[ "$(ca $OWNER "WITH x AS (UPDATE public.necesar_setari SET valoare = 'false' WHERE cheie = 'aprobare_activa' RETURNING 1) SELECT count(*) FROM x")" = 1 ] || esec "4h owner nu scrie"
ok "4h necesar_setari: toți citesc, doar owner scrie"
[ "$(ca $COLEG "SELECT count(*) FROM public.mai_gov_redirect_log")" = 0 ] || esec "4i colegul citește jurnalul MAI"
[ "$(ca $OWNER "SELECT count(*) FROM public.mai_gov_redirect_log")" = 1 ] || esec "4i owner nu citește jurnalul MAI"
[ "$(ca $COLEG "SELECT count(*) FROM public.logistica_setari")" -ge 7 ] || esec "4j citirea setărilor s-a schimbat"
ok "4i jurnalul MAI doar owner · 4j citirea setărilor neschimbată"
[ "$(ca_anon "UPDATE public.logistica_setari SET value = 'x' WHERE key = 'upa_alerta_emails'")" != "UPDATE 1" ] || esec "4k anon scrie setări"
[ "$(q "SELECT value FROM public.logistica_setari WHERE key = 'upa_alerta_emails'")" != x ] || esec "4k anon a schimbat destinatarii"
ok "4k anon nu scrie setări"

# E. cota RAG atomică
grep -q "permission denied" <<<"$(ca_anon "SELECT public.fn_rag_qr_rezerva(1, 'x')")" || esec "4l anon cheamă fn_rag_qr_rezerva"
grep -q "permission denied" <<<"$(ca $COLEG "SELECT public.fn_rag_ask_rezerva('$COLEG')")" || esec "4l authenticated cheamă fn_rag_ask_rezerva"
for i in $(seq 1 30); do [ -n "$(ca_srv "SELECT public.fn_rag_qr_rezerva(1, 'q$i')")" ] || esec "4m rezervarea $i pe utilajul 1"; done
[ "$(ca_srv "SELECT public.fn_rag_qr_rezerva(1, 'q31') IS NULL")" = t ] || esec "4m a 31-a pe utilaj trece"
for i in $(seq 1 50); do ca_srv "SELECT public.fn_rag_qr_rezerva(1, 'peste')" >/dev/null; done
[ "$(q "SELECT count(*) FROM public.rag_qr_log WHERE active_id = 1")" = 30 ] || esec "4m cererile peste limită au scris în jurnal"
ok "4l funcțiile de cotă: doar service_role · 4m 30/utilaj, cererile refuzate NU scriu (zero DML peste limită)"
q "INSERT INTO public.rag_qr_log (active_id, question, answered) SELECT 100 + g, 'umplut', true FROM generate_series(1, 169) g" >/dev/null
[ "$(ca_srv "SELECT public.fn_rag_qr_rezerva(2, 'ultimul') IS NOT NULL")" = t ] || esec "4n a 200-a globală refuzată"
[ "$(ca_srv "SELECT public.fn_rag_qr_rezerva(3, 'peste global') IS NULL")" = t ] || esec "4n a 201-a globală trece"
[ "$(ca_srv "SELECT public.fn_rag_qr_rezerva(4, '   ') IS NULL")" = t ] || esec "4n întrebare goală acceptată"
ok "4n plafon global 200/zi, întrebare goală refuzată"
for i in $(seq 1 50); do [ "$(ca_srv "SELECT public.fn_rag_ask_rezerva('$LOG_ED')")" = t ] || esec "4o AI $i"; done
[ "$(ca_srv "SELECT public.fn_rag_ask_rezerva('$LOG_ED')")" = f ] || esec "4o al 51-lea răspuns AI trece"
[ "$(ca_srv "SELECT public.fn_rag_ask_rezerva('$LOG_ADM')")" = t ] || esec "4o cota e per utilizator"
[ "$(q "SELECT count(*) FROM public.rag_ask_log WHERE profile_id = '$LOG_ED'")" = 50 ] || esec "4o refuzul AI a scris în jurnal"
[ "$(ca $COLEG "SELECT count(*) FROM public.rag_ask_log")" = 0 ] && [ "$(ca $OWNER "SELECT count(*) FROM public.rag_ask_log")" = 51 ] || esec "4o rag_ask_log citit de coleg / necitit de owner"
ok "4o AI 50/zi per utilizator, refuzul nu scrie, jurnalul AI citit doar de owner"
# concurență: 40 de rezervări paralele pe un utilaj nou → exact 30 trec
for i in $(seq 1 40); do ( ca_srv "SELECT public.fn_rag_qr_rezerva(5, 'p$i')" >/dev/null ) & done; wait
[ "$(q "SELECT count(*) FROM public.rag_qr_log WHERE active_id = 5")" = 0 ] || esec "4p plafonul global era atins — paralelele trebuiau refuzate"
q "DELETE FROM public.rag_qr_log WHERE active_id > 100" >/dev/null
for i in $(seq 1 40); do ( ca_srv "SELECT public.fn_rag_qr_rezerva(6, 'p$i')" >/dev/null ) & done; wait
[ "$(q "SELECT count(*) FROM public.rag_qr_log WHERE active_id = 6")" = 30 ] || esec "4p paralel: $(q "SELECT count(*) FROM public.rag_qr_log WHERE active_id = 6") în loc de 30"
ok "4p 40 de cereri paralele pe același utilaj → exact 30 rezervate"

# 5. joburile
[ "$(q "SELECT count(*) FROM cron.job WHERE command ~ 'eyJ|secret-vechi|x-internal-secret|x-ingest-secret'")" = 0 ] || esec "5 a rămas ceva în clar"
for j in 17 18 30; do q "DO \$\$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobid = $j); END \$\$" >/dev/null; done
[ "$(q "SELECT count(*) FROM net._apeluri WHERE headers->>'x-intern-secret' = repeat('a1', 32) AND headers->>'apikey' = (SELECT secret FROM vault.secrets WHERE name='SUPABASE_ANON_JWT') AND headers->>'Authorization' = 'Bearer ' || (SELECT secret FROM vault.secrets WHERE name='SUPABASE_ANON_JWT')")" = 3 ] || esec "5 antetele la rulare"
[ "$(q "SELECT string_agg(url || ' ' || coalesce(body->>'action', '-') || ' ' || timeout_ms, ' | ' ORDER BY id) FROM net._apeluri")" = \
  "https://dxczwkbciseqniprspcu.supabase.co/functions/v1/rag-utilaj process_queue 150000 | https://dxczwkbciseqniprspcu.supabase.co/functions/v1/rag-utilaj-embed - 120000 | https://dxczwkbciseqniprspcu.supabase.co/functions/v1/redirect-mai-gov?polls=8 - 80000" ] || esec "5 ținte/corp/timeout: $(q "SELECT string_agg(url, ' | ') FROM net._apeluri")"
ok "5 joburi: nimic în clar; la rulare x-intern-secret + JWT anon din Vault, aceeași țintă / corp / timeout"

# 6. reaplicare
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261005200000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/dev/null 2>&1 || RC=$?
[ "$RC" = 11 ] || esec "6 reaplicarea a dat cod $RC (aștept 11)"
ok "6 reaplicare → 11 (deja înregistrat)"

# 7. revenire — md5-ul definițiilor complete ale politicilor patch-ului trebuie să fie cel pinuit în fișier
MD5_POL="$(q "SELECT md5(string_agg(format('%s|%s|%s|%s|%s|%s', c.relname, p.polname, p.polcmd, p.polpermissive, coalesce(pg_get_expr(p.polqual, p.polrelid), '-'), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')) || '|' || (SELECT string_agg(coalesce(r.rolname, 'PUBLIC'), ',' ORDER BY coalesce(r.rolname, 'PUBLIC')) FROM unnest(p.polroles) AS o(oid) LEFT JOIN pg_roles r ON r.oid = o.oid), ' ; ' ORDER BY c.relname, p.polname)) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.oid IN ('public.logistica_setari'::regclass, 'public.necesar_setari'::regclass, 'public.mai_gov_redirect_log'::regclass)")"
grep -q "'$MD5_POL'" "$ROLLBACK" || esec "7 md5-ul politicilor ($MD5_POL) nu e cel pinuit în revenire"
q "ALTER POLICY logistica_setari_delete_owner ON public.logistica_setari USING (true)" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261015b', 'REDESCHIDE_SETARI_SEC_F2:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null 2>&1 && esec "7 revenirea a trecut peste o politică schimbată cu ALTER POLICY"
q "ALTER POLICY logistica_setari_delete_owner ON public.logistica_setari USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true))" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >/dev/null 2>&1 && esec "7a revenirea nearmată a trecut"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261015b', 'REDESCHIDE_SETARI_SEC_F2:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null || esec "7b revenirea armată a eșuat"
[ "$(q "$POLITICI")" = "$POL0" ] || esec "7b politicile nu sunt cele din 05.10: $(q "$POLITICI")"
[ "$(q "SELECT to_regprocedure('public.fn_rag_qr_rezerva(integer,text)') IS NULL AND to_regclass('public.rag_ask_log') IS NULL")" = t ] || esec "7b obiectele cotei au rămas"
ok "7 revenire: nearmată → refuz; politică schimbată (ALTER POLICY) → refuz; armată → politicile din 05.10, cota scoasă (joburile rămân pe Vault)"
echo "PASS"
