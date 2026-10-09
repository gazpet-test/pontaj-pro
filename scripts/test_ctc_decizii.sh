#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261023a_ctc_citire_decizii (CTC citește deciziile HR pe proiect). EXCLUSIV pe un PostgreSQL 17 local
# dedicat (/tmp/pg_ctcdec, 127.0.0.1:5983). Nu atinge producția.
#   0. schelet (supabase/tests/ctc_decizii_schelet.sql): corpurile = verbatim live ⇒ md5 = v_live din migrare
#   1. fără gardă / gardă din altă tranzacție / alt utilizator / corp live modificat / ACL modificat → refuz, nimic schimbat
#   2. livrare prin scripts/livrare_migrare.sh → cod 0; md5 = v_nou; ACL/atribute neschimbate
#   3. matrice drepturi: c1 ('ctc') și c2 ('ctc.carti') citesc doc+scan pe decizii eligibile din ORICE proiect (1,2,6),
#      nu pe draft/ALTA_DECIZIE/firma/NULL/inexistent; 'ctcX' nimic; scrierea neschimbată; celelalte profile = identic cu înainte
#   4. reaplicare → refuz · revenire nearmată / armare persistentă → refuz · armată → md5 + matrice = EXACT cele inițiale
#   5. dus-întors: migrarea se reaplică
# Utilizare: bash scripts/test_ctc_decizii.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR=/tmp/pg_ctcdec; PORT=5983; BAZA=ctcdec_test
NUME=20261023a_ctc_citire_decizii
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/ctc_decizii_schelet.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_ctcdec" ] || mediu "$DATE_DIR există și nu e fixture — nu îl șterg"
  [ -f "$DATE_DIR/postmaster.pid" ] && { ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; }
  rm -rf "$DATE_DIR"
fi
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_ctcdec"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_ctcdec.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null || esec "schelet"
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
V_LIVE=(d307b73b1d22bc750ca41fb249afa6cf 23fbcb51b62c65ce20ec04ecb8395107)
V_NOU=(1d4dcdc7c59ef1da385cec87335fb02b ce7f8fabc2d74fbd8237ea0a5e6c3748)
md5s() { q "SELECT string_agg(md5(prosrc), ' ' ORDER BY proname <> '_hr_decizii_termeni') FROM pg_proc WHERE oid IN ('public._hr_decizii_termeni(uuid)'::regprocedure,'public.fn_hr_decizii_poate(text,bigint)'::regprocedure)"; }
meta() { q "SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (SELECT proname||coalesce(proacl::text,'')||prosecdef::text||provolatile::text||coalesce(proconfig::text,'')||pg_get_userbyid(proowner)||pg_get_function_identity_arguments(oid) x FROM pg_proc WHERE proname IN ('_hr_decizii_termeni','fn_hr_decizii_poate')) s"; }
# matrice: pentru fiecare profil × acțiune × decizie (inclusiv NULL și 99 inexistent) + rânduri vizibile prin RLS ca authenticated
matrice() {
  local out=""
  for p in c1 c2 cf aa bb ee ff; do
    local uid="00000000-0000-0000-0000-0000000000$p"
    out+="$p:$("${PSQL[@]}" -d "$BAZA" -At -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('test.uid','$uid',true);" \
      -c "SELECT string_agg(a||coalesce(i::text,'N')||'='||fn_hr_decizii_poate(a,i)::int, ',' ORDER BY a,i NULLS FIRST)
          FROM unnest(ARRAY['citire','citire_doc','citire_scan','redactare','emitere','scan','anulare','owner','necunoscut']) a,
               unnest(ARRAY[NULL,1,2,3,4,5,6,99]::bigint[]) i;" \
      -c "SELECT 'rls='||coalesce(string_agg(id::text, '.' ORDER BY id),'-') FROM public.hr_decizii;" -c "ROLLBACK;" | tr '\n' ' ')"$'\n'
  done
  printf '%s' "$out"
}
livreaza() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);" -f "$MIGRARE" 2>&1; }
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261023a', 'CTC_CITIRE_DECIZII_REVENIRE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1; }
refuz() { local o; if o="$(eval "$2")"; then esec "$1 a trecut"; fi; grep -q "$3" <<<"$o" || esec "$1 refuzat din alt motiv: $(grep -m1 ERROR <<<"$o")"; [ "$(md5s)" = "$4" ] || esec "$1 a schimbat corpurile"; ok "refuz: $1"; }

# 0. schelet = live
[ "$(md5s)" = "${V_LIVE[*]}" ] || esec "schelet ≠ live: $(md5s)"; ok "schelet: md5 = live"
META0="$(meta)"; M0="$(matrice)"
grep -q '^c1:.*citire_doc1=0' <<<"$M0" || esec "c1 citea înainte"; ok "înainte: c1 nu citește"

# 1. refuzuri
refuz "fără gardă" "\"\${PSQL[@]}\" -d $BAZA -f \"$MIGRARE\" 2>&1" "garda start invalida" "${V_LIVE[*]}"
refuz "gardă din altă tranzacție" "\"\${PSQL[@]}\" -d $BAZA -c \"SELECT set_config('gazpet.livrare_migrare', '$NUME:1', false);\" -f \"$MIGRARE\" 2>&1" "garda start invalida" "${V_LIVE[*]}"
q "CREATE ROLE altul SUPERUSER LOGIN" >/dev/null
refuz "alt utilizator" "\"$PG_BIN/psql\" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $PORT -U altul -d $BAZA --single-transaction -c \"SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);\" -f \"$MIGRARE\" 2>&1" "necesita postgres" "${V_LIVE[*]}"
q "GRANT EXECUTE ON FUNCTION public._hr_decizii_termeni(uuid) TO authenticated" >/dev/null
refuz "ACL modificat" livreaza "preconditie corp/ACL/atribute (1)" "${V_LIVE[*]}"
q "REVOKE EXECUTE ON FUNCTION public._hr_decizii_termeni(uuid) FROM authenticated" >/dev/null
q "ALTER FUNCTION public.fn_hr_decizii_poate(text,bigint) VOLATILE" >/dev/null
refuz "atribut modificat" livreaza "preconditie corp/ACL/atribute (2)" "${V_LIVE[*]}"
q "ALTER FUNCTION public.fn_hr_decizii_poate(text,bigint) STABLE" >/dev/null
[ "$(meta)" = "$META0" ] || esec "meta nerefăcut după refuzuri"

# 2. livrare prin runner
SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261009120000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/ctcdec_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { cat /tmp/ctcdec_runner.out >&2; esec "runner cod $RC"; }; ok "runner: cod 0 (sha256 $SHA)"
[ "$(md5s)" = "${V_NOU[*]}" ] || esec "după migrare md5 = $(md5s)"; ok "după migrare: md5 = v_nou"
[ "$(meta)" = "$META0" ] || esec "ACL/atribute schimbate"; ok "ACL/atribute neschimbate"

# 3. matrice
M1="$(matrice)"
for p in c1 c2; do
  l="$(grep "^$p:" <<<"$M1")"
  for i in 1 2 6; do for a in citire_doc citire_scan; do grep -q "$a$i=1" <<<"$l" || esec "$p $a$i ≠ 1"; done; done
  for i in N 3 4 5 99; do for a in citire_doc citire_scan; do grep -q "$a$i=0" <<<"$l" || esec "$p $a$i ≠ 0"; done; done
  for a in citire redactare emitere scan anulare owner necunoscut; do grep -Eq "(^|[ ,:])$a[N0-9]+=1" <<<"$l" && esec "$p $a = 1"; done
  grep -q "rls=1.2.6" <<<"$l" || esec "$p RLS: $l"
  ok "$p: doc+scan pe 1,2,6 (2 proiecte, inclusiv anulată) · nu pe draft/ALTA/firmă/NULL/99 · fără scriere · RLS = 1,2,6"
done
[ "$(grep -v '^c[12]:' <<<"$M1")" = "$(grep -v '^c[12]:' <<<"$M0")" ] || esec "alte profile s-au schimbat"; ok "ctcX/owner/HR/execuție/fără drepturi: identic cu înainte"
# scriere directă ca c1: 0 rânduri afectate
n="$("${PSQL[@]}" -d "$BAZA" -At -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000c1',true);" \
  -c "WITH u AS (UPDATE public.hr_decizii SET stare='x' RETURNING 1), d AS (DELETE FROM public.hr_decizii RETURNING 1) SELECT (SELECT count(*) FROM u)+(SELECT count(*) FROM d);" -c "ROLLBACK;" | tail -1)"
[ "$n" = 0 ] || esec "c1 a scris $n rânduri"; ok "c1: UPDATE/DELETE = 0 rânduri"

# 4. reaplicare + revenire
refuz "reaplicare" livreaza "preconditie corp/ACL/atribute (1)" "${V_NOU[*]}"
refuz "revenire nearmată" "\"\${PSQL[@]}\" -d $BAZA -f \"$ROLLBACK\" 2>&1" "garda start invalida" "${V_NOU[*]}"
q "ALTER DATABASE $BAZA SET gazpet.revenire_20261023a = 'x'" >/dev/null
refuz "armare persistentă" revenire "armare persistenta interzisa" "${V_NOU[*]}"
q "ALTER DATABASE $BAZA RESET gazpet.revenire_20261023a" >/dev/null
revenire >/dev/null || esec "revenire armată"
[ "$(md5s)" = "${V_LIVE[*]}" ] || esec "după revenire md5 = $(md5s)"
[ "$(meta)" = "$META0" ] && [ "$(matrice)" = "$M0" ] || esec "revenire: meta/matrice ≠ inițial"; ok "revenire: md5 + ACL + matrice = EXACT inițial"

# 5. dus-întors
livreaza >/dev/null || esec "reaplicare după revenire"; [ "$(md5s)" = "${V_NOU[*]}" ] || esec "dus-întors"; ok "dus-întors: migrarea se reaplică"
echo PASS
