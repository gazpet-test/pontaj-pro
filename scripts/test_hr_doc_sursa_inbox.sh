#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261103a_hr_doc_sursa_inbox (HR «Citește orice»: proveniența structurală sursa_inbox_id).
# DOAR PG17 local dedicat (implicit /tmp/pg_hr_sursa_inbox, 127.0.0.1:5975). Nu atinge producția.
#   0. schelet (= structura din producție 21.10, fără coloană) → baza; suita pe baza fără migrare TREBUIE să cadă (discriminare)
#   1. gărzi: fără marcajul de livrare → refuz; coloana deja există → refuz PRECONDIȚIE (nimic adăugat)
#   2. aplicare (ca runnerul: marcaj + --single-transaction) → suita
#   3. reaplicare → refuz PRECONDIȚIE (migrarea nu e idempotentă, e exactă), starea intactă → suita
#   4. revenire: nearmată → refuz; REPEATABLE READ → refuz; armare persistentă → refuz; document cu sursa_inbox_id → refuz
#      (coloana rămâne); armată pe date curate → obiectele dispar, documentele rămân; reaplicare → suita
# Ieșire: 0 = PASS · 1 = eșec · 2 = mediu.  PG_BIN se poate suprascrie (ex. pe Windows: /c/Users/Public/pgsql/bin).
# ============================================================================
set -Eeuo pipefail
export PGCLIENTENCODING=UTF8
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_hr_sursa_inbox}"
PORT="${PGPORT_TEST:-5975}"
BAZA=hr_sursa_inbox_test
NUME=20261103a_hr_doc_sursa_inbox
MIGRARE_SURSA="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK_SURSA="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/hr_doc_sursa_inbox_schelet.sql"
TESTE="$RADACINA/supabase/tests/hr_doc_sursa_inbox.test.sql"
TMP="$(mktemp -d)"
# migrarea are garda de livrare: aici se armează ca runnerul (marcaj local, aceeași tranzacție)
MIGRARE="$TMP/migrare.sql"
{ echo "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);"; cat "$MIGRARE_SURSA"; } > "$MIGRARE"
# revenirea: un singur string, ca în antet (BEGIN ISOLATION LEVEL READ COMMITTED + armare + fișier + COMMIT)
GUC=gazpet.revenire_20261103a
TOKEN=SCOATE_SURSA_INBOX
grep -q "^-- harness-armare: $GUC $TOKEN\$" "$ROLLBACK_SURSA" || { echo "MEDIU: antetul harness-armare lipsește din revenire" >&2; exit 2; }
revenire() {   # $1 = izolare, $2 = armat (da/nu)
  { echo "BEGIN ISOLATION LEVEL $1;"
    [ "$2" = da ] && echo "SELECT set_config('$GUC', '$TOKEN:' || txid_current(), true);"
    cat "$ROLLBACK_SURSA"; echo "COMMIT;"; } > "$TMP/revenire.sql"
  "${PSQL[@]}" -d "$3" -f "$TMP/revenire.sql"
}
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
EXE=""; SOCKET=(-c unix_socket_directories=/tmp)
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) EXE=".exe"; SOCKET=() ;; esac
PSQL=("$PG_BIN/psql$EXE" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb$EXE" ] || mediu "PG17 lipsă ($PG_BIN)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"
ca_postgres "$PG_BIN/initdb$EXE" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --no-locale >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -l "$DATE_DIR.log" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 ${SOCKET[*]}" >/dev/null || mediu "pg_ctl start"
trap 'ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; rm -rf "$TMP"; true' EXIT
q() { "${PSQL[@]}" -d "$1" -Atc "$2"; }
coloana_exista() { [ "$(q "$1" "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_documente_personale' AND column_name='sursa_inbox_id'")" = 1 ]; }
obiecte() { q "$1" "SELECT (to_regclass('public.hr_documente_personale_sursa_inbox_unic') IS NOT NULL)::int + (to_regprocedure('public.hr_docp_sursa_inbox_imutabil()') IS NOT NULL)::int + (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_hr_docp_sursa_inbox_imutabil')"; }
OUT="$TMP/out.txt"
suita() { "${PSQL[@]}" -d "$BAZA" -f "$TESTE" >"$OUT" 2>&1 && grep -q SUITA_OK "$OUT" || { cat "$OUT"; esec "suita ($1)"; }; grep -E 'OK T[0-9]' "$OUT" | sed "s/^.*NOTICE: *//; s/^/     [$1] /"; ok "suita ($1)"; }
refuza() {   # $1 = descriere, $2 = text așteptat în eroare, restul = comanda
  local d="$1" t="$2"; shift 2
  if "$@" >"$OUT" 2>&1; then cat "$OUT"; esec "$d: a trecut, trebuia refuz"; fi
  grep -q -- "$t" "$OUT" || { cat "$OUT"; esec "$d: refuz din alt motiv (aștept „$t”)"; }
}

# 0. baza
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA"
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
coloana_exista "$BAZA" && esec "0 coloana există înainte de migrare"
if "${PSQL[@]}" -d "$BAZA" -f "$TESTE" >"$OUT" 2>&1; then esec "0 suita trece și fără migrare (nu discriminează)"; fi
grep -q 'ESEC TEST: T1' "$OUT" || { cat "$OUT"; esec "0 suita a căzut din alt motiv"; }
ok "0 schelet (structura din producție, fără sursa_inbox_id); suita cade pe T1 fără migrare"

# 1. gărzi
refuza "1a fără marcaj" 'garda de livrare (start)' "${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE_SURSA"
coloana_exista "$BAZA" && esec "1a coloana a apărut fără marcaj"
"${PSQL[@]}" -d postgres -c "CREATE DATABASE hr_sursa_neg_test TEMPLATE $BAZA"
q hr_sursa_neg_test "ALTER TABLE public.hr_documente_personale ADD COLUMN sursa_inbox_id bigint" >/dev/null
refuza "1b coloana există" 'PRECONDIȚIE 20261103a: coloana' "${PSQL[@]}" -d hr_sursa_neg_test --single-transaction -f "$MIGRARE"
[ "$(obiecte hr_sursa_neg_test)" = 0 ] || esec "1b au apărut obiecte deși precondiția a refuzat"
ok "1 fără marcaj → refuz (garda de livrare); coloana deja prezentă → refuz PRECONDIȚIE, fără index/trigger"

# 2. aplicare
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE" >"$OUT" 2>&1 || { cat "$OUT"; esec "2 aplicare"; }
coloana_exista "$BAZA" || esec "2 coloana lipsește după aplicare"
[ "$(obiecte "$BAZA")" = 3 ] || esec "2 index / funcție / trigger lipsă"
ok "2 aplicare (pre + post trecute)"
suita "după 20261103a"

# 3. reaplicare
refuza "3 reaplicare" 'PRECONDIȚIE 20261103a: coloana' "${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE"
ok "3 reaplicare → refuz PRECONDIȚIE (exactă, nu idempotentă)"
suita "după reaplicarea refuzată"

# 4. revenire
refuza "4a nearmată" 'fără GO de execuție' revenire "READ COMMITTED" nu "$BAZA"
refuza "4b REPEATABLE READ" 'DOAR la READ COMMITTED' revenire "REPEATABLE READ" da "$BAZA"
q postgres "ALTER DATABASE $BAZA SET $GUC = 'x'" >/dev/null
refuza "4c armare persistentă" 'armat PERSISTENT' revenire "READ COMMITTED" da "$BAZA"
q postgres "ALTER DATABASE $BAZA RESET $GUC" >/dev/null
q "$BAZA" "INSERT INTO public.hr_documente_personale (employee_id, fisier_nume, sursa_inbox_id) VALUES (7, 'CI.pdf', 777)" >/dev/null
refuza "4d document cu proveniență" '1 document(e) din dosarul HR au sursa_inbox_id' revenire "READ COMMITTED" da "$BAZA"
coloana_exista "$BAZA" || esec "4d coloana a dispărut deși revenirea a refuzat"
[ "$(obiecte "$BAZA")" = 3 ] || esec "4d obiectele au dispărut deși revenirea a refuzat"
q "$BAZA" "DELETE FROM public.hr_documente_personale WHERE sursa_inbox_id = 777" >/dev/null
ok "4 revenire: nearmată / REPEATABLE READ / armare persistentă / document cu sursa_inbox_id → refuz, nimic scos"
N0="$(q "$BAZA" "SELECT count(*) || ':' || string_agg(id::text, ',' ORDER BY id) FROM public.hr_documente_personale")"
revenire "READ COMMITTED" da "$BAZA" >"$OUT" 2>&1 || { cat "$OUT"; esec "4e revenire armată"; }
coloana_exista "$BAZA" && esec "4e coloana există după revenire"
[ "$(obiecte "$BAZA")" = 0 ] || esec "4e au rămas index / funcție / trigger"
[ "$(q "$BAZA" "SELECT count(*) || ':' || string_agg(id::text, ',' ORDER BY id) FROM public.hr_documente_personale")" = "$N0" ] || esec "4e documentele s-au schimbat"
[ "$(q "$BAZA" "SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_hr_docp_modificat_la'")" = 1 ] || esec "4e trg_hr_docp_modificat_la atins"
ok "4e revenire armată pe date curate: coloană / index / funcție / trigger scoase, documentele și trg_hr_docp_modificat_la neatinse"
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE" >"$OUT" 2>&1 || { cat "$OUT"; esec "4 reaplicare după revenire"; }
suita "reaplicare după revenire"

echo "PASS test_hr_doc_sursa_inbox"
