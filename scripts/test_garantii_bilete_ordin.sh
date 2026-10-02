#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261003a_garantii_bilete_ordin (bilete la ordin pe polițe, #1544). EXCLUSIV pe un PostgreSQL local
# dedicat (implicit /tmp/pg_garantii_bo, 127.0.0.1:5974). Nu atinge producția.
#   0. schelet (supabase/tests/garantii_bilete_ordin_schelet.sql) = starea live din 02.10 (md5-uri: garantii 0cd06900…,
#      fn_poate_scrie_garantii e8ee20a0…, set_updated_at 1c4318be…, garantii_alerte fd35c645…)
#   1. fișierul fără runner → garda refuză, nimic schimbat
#   2. precondiție negativă (supraîncărcare garantii_alerte) → refuz
#   3. livrare prin scripts/livrare_migrare.sh (sha256 + validator + gate 0e) → cod 0; tabela, politicile, ACL-ul, md5 nou
#   4. matricea de acces RLS (owner/contabilitate scriu; viewer/oarecine doar citesc; anon nimic) + constrângerile + trigger
#   5. alertele BO: bo_scadent / bo_expirat o singură dată per set, modul = Financiar, amprente; restituirea oprește alerta
#   6. reaplicare cu marcaj → refuz; revenire: nearmată → refuz; cu rânduri → refuz; armată, fără rânduri → starea live
#   7. (informativ) bugul latent preexistent: blocul vechi inserează modul = 'financiar' ⇒ pică pe notifications_modul_check,
#      identic ÎNAINTE și DUPĂ migrare (nu e introdus de 20261003a; decizie separată)
# Utilizare: bash scripts/test_garantii_bilete_ordin.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-$( [ -x /usr/lib/postgresql/17/bin/initdb ] && echo /usr/lib/postgresql/17/bin || echo /usr/lib/postgresql/16/bin )}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_garantii_bo}"
PORT="${PGPORT_TEST:-5974}"
BAZA=garantii_bo_test
NUME=20261003a_garantii_bilete_ordin
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/garantii_bilete_ordin_schelet.sql"
MD5_VECHI=fd35c645075cfb6ba7956529e0d85486
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PostgreSQL lipsă ($PG_BIN)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_garantii_bo.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
md5_alerte() { q "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.garantii_alerte()'::regprocedure"; }
exista_tabela() { q "SELECT (to_regclass('public.garantii_bilete_ordin') IS NOT NULL)::text"; }
gate_0e() { local n; n="$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql" | grep -c . || true)"; [ "$n" = 0 ] || esec "gate 0e: $n rânduri"; ok "gate 0e = 0 ($1)"; }
# ca_user <sufix uid> <sql> → ieșirea instrucțiunii rulate ca authenticated cu uid-ul dat (tranzacție anulată la final); „EROARE:<mesaj>” la eșec
ca_user() {
  local uid="00000000-0000-0000-0000-00000000000$1" out rc=0
  out="$("${PSQL[@]}" -d "$BAZA" -At 2>&1 <<SQL
BEGIN;
SELECT set_config('request.jwt.claim.sub', '$uid', true);
SET LOCAL ROLE authenticated;
$2;
ROLLBACK;
SQL
)" || rc=$?
  if [ $rc -ne 0 ]; then echo "EROARE:$(echo "$out" | grep -m1 'ERROR' | sed 's/^.*ERROR:  //')"; else echo "$out"; fi
}
# poate <uid> <sql cu RETURNING> → da/nu (≥1 rând afectat)
poate() { local o; o="$(ca_user "$1" "WITH x AS ($2 RETURNING 1) SELECT 'R' || count(*) FROM x")"; case "$o" in *R[1-9]*) echo da ;; *) echo nu ;; esac; }

"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
"${PSQL[@]}" -d "$BAZA" -c "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);" >/dev/null
[ "$(q "SELECT md5(string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) FROM pg_attribute WHERE attrelid = 'public.garantii'::regclass AND attnum > 0 AND NOT attisdropped")" = 0cd06900cf48a7501cc00a57f9a24264 ] || esec "0 garantii ≠ md5 live"
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_poate_scrie_garantii()'::regprocedure")" = e8ee20a08440f3c93c763e4bff0670cf ] || esec "0 fn_poate_scrie_garantii ≠ md5 live"
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.set_updated_at()'::regprocedure")" = 1c4318bee4240d4113d86fad7eb15623 ] || esec "0 set_updated_at ≠ md5 live"
[ "$(md5_alerte)" = "$MD5_VECHI" ] || esec "0 garantii_alerte ≠ md5 live"
[ "$(q "SELECT has_function_privilege('authenticated', 'public.garantii_alerte()', 'EXECUTE')")" = f ] || esec "0 ACL garantii_alerte"
ok "0 schelet = starea live (md5-uri: garantii, fn_poate_scrie_garantii, set_updated_at, garantii_alerte)"

"${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/dev/null 2>&1 && esec "1 fără runner a trecut"
[ "$(exista_tabela)" = false ] && [ "$(md5_alerte)" = "$MD5_VECHI" ] || esec "1 stare schimbată"
ok "1 fără runner → refuz"

q "CREATE FUNCTION public.garantii_alerte(p int) RETURNS int LANGUAGE sql AS 'SELECT 1'" >/dev/null
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null 2>&1 && esec "2 precondiție negativă a trecut"
q "DROP FUNCTION public.garantii_alerte(int)" >/dev/null
[ "$(exista_tabela)" = false ] || esec "2 stare schimbată"
ok "2 supraîncărcare garantii_alerte → refuz"

SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261003000001 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/garantii_bo_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/garantii_bo_runner.out >&2; esec "3 runner cod $RC"; }
MD5_NOU="$(md5_alerte)"
[ "$(exista_tabela)" = true ] && [ "$MD5_NOU" != "$MD5_VECHI" ] || esec "3 tabela/md5 după runner"
[ "$(q "SELECT count(*) FROM pg_policies WHERE tablename = 'garantii_bilete_ordin'")" = 4 ] || esec "3 politici"
[ "$(q "SELECT has_table_privilege('anon', 'public.garantii_bilete_ordin', 'SELECT')")" = f ] || esec "3 anon are SELECT"
[ "$(q "SELECT has_table_privilege('authenticated', 'public.garantii_bilete_ordin', 'INSERT')")" = t ] || esec "3 authenticated fără INSERT"
[ "$(q "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name = '$NUME'")" = 1 ] || esec "3 neînregistrată"
ok "3 runner: APLICAT + ÎNREGISTRAT + gate 0e (cod 0), sha256 $SHA, garantii_alerte md5 $MD5_NOU"
gate_0e patch

# 4. matricea RLS: 1 owner, 3 contabilitate → scriu; 6 viewer, 8 oarecine → doar citesc; anon → nimic
INS="INSERT INTO public.garantii_bilete_ordin (garantie_id, serie, numar, suma, data_emitere, data_scadenta) VALUES (1, 'BO', 'M-' || clock_timestamp()::text, 1000, current_date, current_date + 30)"
for u in 1 3; do [ "$(poate $u "$INS")" = da ] || esec "4 user $u nu poate insera"; done
for u in 6 8; do [ "$(poate $u "$INS")" = nu ] || esec "4 user $u poate insera"; done
q "INSERT INTO public.garantii_bilete_ordin (garantie_id, serie, numar, suma, data_emitere, data_scadenta) VALUES (1, 'BO', 'M-1', 1000, current_date, current_date + 30)" >/dev/null
for u in 1 3; do [ "$(poate $u "UPDATE public.garantii_bilete_ordin SET observatii = 'x'")" = da ] || esec "4 user $u nu poate modifica"; done
for u in 6 8; do [ "$(poate $u "UPDATE public.garantii_bilete_ordin SET observatii = 'x'")" = nu ] || esec "4 user $u poate modifica"; done
for u in 6 8; do [ "$(poate $u "DELETE FROM public.garantii_bilete_ordin")" = nu ] || esec "4 user $u poate șterge"; done
for u in 1 3 6 8; do [ "$(ca_user $u "SELECT count(*) FROM public.garantii_bilete_ordin" | tail -n1)" = 1 ] || esec "4 user $u nu citește"; done
A="$("${PSQL[@]}" -d "$BAZA" -At 2>&1 -c "BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.garantii_bilete_ordin; ROLLBACK;" || true)"
echo "$A" | grep -q "permission denied" || esec "4 anon poate citi: $A"
A="$("${PSQL[@]}" -d "$BAZA" -At 2>&1 -c "BEGIN; SET LOCAL ROLE anon; SELECT nextval('public.garantii_bilete_ordin_id_seq'); ROLLBACK;" || true)"
echo "$A" | grep -q "permission denied" || esec "4 anon are drepturi pe secvență: $A"
# constrângerile (ca owner)
for c in "suma, '0 → refuz'|INSERT INTO public.garantii_bilete_ordin (garantie_id, numar, suma, data_emitere) VALUES (1, 'C1', 0, current_date)" \
         "stare necunoscută|INSERT INTO public.garantii_bilete_ordin (garantie_id, numar, suma, data_emitere, stare) VALUES (1, 'C2', 1, current_date, 'pierdut')" \
         "scadență < emitere|INSERT INTO public.garantii_bilete_ordin (garantie_id, numar, suma, data_emitere, data_scadenta) VALUES (1, 'C3', 1, current_date, current_date - 1)" \
         "restituit fără dată|INSERT INTO public.garantii_bilete_ordin (garantie_id, numar, suma, data_emitere, stare) VALUES (1, 'C4', 1, current_date, 'restituit')" \
         "număr gol|INSERT INTO public.garantii_bilete_ordin (garantie_id, numar, suma, data_emitere) VALUES (1, '  ', 1, current_date)" \
         "serie+număr dublate|INSERT INTO public.garantii_bilete_ordin (garantie_id, serie, numar, suma, data_emitere) VALUES (1, 'BO', 'M-1', 1, current_date)" \
         "garanție inexistentă|INSERT INTO public.garantii_bilete_ordin (garantie_id, numar, suma, data_emitere) VALUES (999, 'C5', 1, current_date)"; do
  [[ "$(ca_user 1 "${c#*|}")" == EROARE:* ]] || esec "4 constrângere neaplicată: ${c%%|*}"
done
[ "$(poate 1 "INSERT INTO public.garantii_bilete_ordin (garantie_id, numar, suma, data_emitere) VALUES (1, 'M-1', 1, current_date)")" = da ] || esec "4 serie NULL + număr existent trebuie permis (serie diferită)"
[ "$(poate 1 "INSERT INTO public.garantii_bilete_ordin (garantie_id, numar, suma, data_emitere, stare, restituit_la) VALUES (1, 'C6', 1, current_date, 'restituit', current_date)")" = da ] || esec "4 restituit cu dată trebuie permis"
A="$(ca_user 1 "WITH d AS (DELETE FROM public.garantii WHERE id = 1 RETURNING 1) SELECT count(*) FROM d" 2>/dev/null || true)"; [[ "$A" == EROARE:* ]] || esec "4 ștergerea garanției cu BO trebuie refuzată (ON DELETE RESTRICT)"
# trigger updated_at
T0="$(q "SELECT updated_at FROM public.garantii_bilete_ordin WHERE numar = 'M-1'")"; sleep 1
q "UPDATE public.garantii_bilete_ordin SET observatii = 'y' WHERE numar = 'M-1'" >/dev/null
[ "$(q "SELECT updated_at > '$T0'::timestamptz FROM public.garantii_bilete_ordin WHERE numar = 'M-1'")" = t ] || esec "4 updated_at neschimbat de trigger"
ok "4 matrice RLS (owner/contabilitate scriu; viewer/oarecine citesc; anon nimic), constrângeri, FK RESTRICT, trigger updated_at"

# 5. alertele BO (ca postgres, cum rulează cronul)
q "DELETE FROM public.garantii_bilete_ordin" >/dev/null
q "INSERT INTO public.garantii_bilete_ordin (garantie_id, serie, numar, suma, data_emitere, data_scadenta, stare, restituit_la) VALUES
   (1, 'BO', 'A-5',  10000, current_date - 60, current_date + 5,  'emis', NULL),
   (1, 'BO', 'A-14', 20000, current_date - 60, current_date + 14, 'emis', NULL),
   (1, 'BO', 'B-3',  30000, current_date - 90, current_date - 3,  'emis', NULL),
   (1, 'BO', 'R-1',  40000, current_date - 90, current_date - 10, 'restituit', current_date - 5),
   (1, 'BO', 'X-1',  50000, current_date - 90, current_date - 10, 'executat', NULL),
   (1, 'BO', 'L-30', 60000, current_date - 10, current_date + 30, 'emis', NULL),
   (1, 'BO', 'F-N',  70000, current_date - 10, NULL,              'emis', NULL)" >/dev/null
R="$(q "SELECT string_agg(fel || ':' || garantie_id, ',' ORDER BY fel) FROM public.garantii_alerte()")"
[ "$R" = "bo_expirat:1,bo_scadent:1" ] || esec "5 prima rulare: $R"
[ "$(q "SELECT count(*) || '/' || count(DISTINCT modul) || '/' || min(modul) FROM public.notifications")" = "2/1/Financiar" ] || esec "5 notificări (2 către owner, modul Financiar): $(q "SELECT count(*), string_agg(DISTINCT modul, ',') FROM public.notifications")"
[ "$(q "SELECT count(*) FROM public.notifications n JOIN public.profiles p ON p.id = n.profile_id WHERE p.is_owner")" = 2 ] || esec "5 notificările nu merg doar la owneri"
M="$(q "SELECT message FROM public.notifications WHERE title LIKE 'Bilet la ordin scadent în 5 zile%'")"
echo "$M" | grep -q "2 bilet(e) la ordin" && echo "$M" | grep -q "BO A-5 (10.000,00 RON, scadent" && echo "$M" | grep -q "POL-100 (Asigurătorul Z)" || esec "5 textul alertei scadente: $M"
M="$(q "SELECT message FROM public.notifications WHERE title LIKE 'Bilet la ordin nerestituit%'")"
echo "$M" | grep -q "1 bilet(e) la ordin" && echo "$M" | grep -q "BO B-3 (30.000,00 RON" || esec "5 textul alertei depășite: $M"
[ "$(q "SELECT string_agg(fel, ',' ORDER BY fel) FROM public.garantii_alerte_amprenta WHERE garantie_id = 1")" = "bo_expirat,bo_scadent" ] || esec "5 amprente"
[ "$(q "SELECT count(*) FROM public.garantii_alerte()")" = 0 ] || esec "5 a doua rulare retrimite"
q "UPDATE public.garantii_bilete_ordin SET stare = 'restituit', restituit_la = current_date WHERE numar = 'B-3'" >/dev/null
[ "$(q "SELECT count(*) FROM public.garantii_alerte()")" = 0 ] || esec "5 restituirea BO-ului depășit a produs alertă"
q "INSERT INTO public.garantii_bilete_ordin (garantie_id, serie, numar, suma, data_emitere, data_scadenta) VALUES (1, 'BO', 'A-2', 80000, current_date - 10, current_date + 2)" >/dev/null
R="$(q "SELECT string_agg(fel, ',') FROM public.garantii_alerte()")"
[ "$R" = bo_scadent ] || esec "5 BO nou în fereastră nu a produs bo_scadent: $R"
[ "$(q "SELECT count(*) FROM public.notifications")" = 3 ] || esec "5 numărul notificărilor după BO nou"
ok "5 alerte BO: bo_scadent + bo_expirat o dată per set (modul Financiar, doar owneri), fără retrimitere, restituirea oprește alerta, BO nou re-alertează"

# 6. reaplicare → refuz; revenire
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null 2>&1 && esec "6 reaplicare a trecut"
ok "6 reaplicare → refuz"
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" >/dev/null 2>&1 && esec "6 revenire nearmată a trecut"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.rollback_tehnic_20261003a', 'SCOATE_BILETE_ORDIN:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null 2>&1 && esec "6 revenire cu rânduri a trecut"
[ "$(exista_tabela)" = true ] || esec "6 revenirea refuzată a schimbat starea"
q "DELETE FROM public.garantii_bilete_ordin" >/dev/null   # date de test
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.rollback_tehnic_20261003a', 'SCOATE_BILETE_ORDIN:' || txid_current(), true);" -f "$ROLLBACK" >/dev/null || esec "6 revenire armată"
[ "$(exista_tabela)" = false ] && [ "$(md5_alerte)" = "$MD5_VECHI" ] || esec "6 starea după revenire"
[ "$(q "SELECT count(*) FROM public.garantii_alerte_amprenta WHERE fel LIKE 'bo_%'")" = 0 ] || esec "6 amprente bo_* rămase"
[ "$(q "SELECT has_function_privilege('authenticated', 'public.garantii_alerte()', 'EXECUTE')")" = f ] || esec "6 ACL după revenire"
gate_0e "după revenire"
ok "6 revenire: nearmată refuz; cu rânduri refuz; armată → starea live (md5 $MD5_VECHI, fără tabelă, fără amprente bo_*)"

# 7. informativ — bugul latent preexistent (modul = 'financiar' în blocul vechi), identic înainte și după migrare
q "INSERT INTO public.garantii (forma, tip, beneficiar, lucrare, stare, lucrare_receptionata, valoare, moneda) VALUES ('depozit_bancar', 'buna_executie', 'B7', 'L7', 'activa', true, 100, 'RON')" >/dev/null
A="$(q "SELECT count(*) FROM public.garantii_alerte()" 2>&1 || true)"
echo "$A" | grep -q notifications_modul_check || esec "7 blocul vechi (ÎNAINTE de migrare) nu pică pe CHECK: $A"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "DELETE FROM supabase_migrations.schema_migrations WHERE name = '$NUME'; SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" >/dev/null 2>&1 || esec "7 reaplicare pentru test"
A="$(q "SELECT count(*) FROM public.garantii_alerte()" 2>&1 || true)"
echo "$A" | grep -q notifications_modul_check || esec "7 blocul vechi (DUPĂ migrare) nu pică pe CHECK: $A"
ok "7 (informativ) bug latent PREEXISTENT: garanție cu lucrare recepționată ⇒ blocul vechi pică pe notifications_modul_check (modul 'financiar'), identic înainte și după 20261003a"
echo "PASS test_garantii_bilete_ordin (sha256 $SHA, garantii_alerte md5 nou $MD5_NOU)"
