#!/usr/bin/env bash
# Harness PG16 local E3b-A. Nu se rulează pe o bază externă.
# Ieșire: 0 PASS, 1 eșec, 2 mediu. --opreste oprește clusterul la ieșire.
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR="${IZO_E3B_DATE_DIR:-/tmp/pg_izo_e3b_slot0}"
PORT="${IZO_E3B_PORT:-6000}"
BAZA=izo_e3b_test
MIG_A="$RADACINA/supabase/migrations/20261102a_izometrie_e2a_registru.sql"
MIG_C="$RADACINA/supabase/migrations/20261102c_izometrie_cai_vechi_stoc.sql"
MIG_E3="$RADACINA/supabase/migrations/20261103b_izometrie_e3_documente.sql"
MIG_E3B="$RADACINA/supabase/migrations/20261105a_izometrie_e3b_corectii.sql"
REV_A="$RADACINA/supabase/revenire/20261102a_izometrie_e2a_registru_ROLLBACK.sql"
REV_C="$RADACINA/supabase/revenire/20261102c_izometrie_cai_vechi_stoc_ROLLBACK.sql"
REV_E3="$RADACINA/supabase/revenire/20261103b_izometrie_e3_documente_ROLLBACK.sql"
REV_E3B="$RADACINA/supabase/revenire/20261105a_izometrie_e3b_corectii_ROLLBACK.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec() { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok() { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG16 lipsă ($PG_BIN)"
[[ "$DATE_DIR" =~ ^/tmp/pg_izo_e3b_slot[0-9]$ ]] || mediu "director de cluster în afara sloturilor E3b: $DATE_DIR"
[[ "$PORT" =~ ^600[0-9]$ ]] || mediu "port în afara sloturilor E3b: $PORT"
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_izo_e3b" ] || mediu "$DATE_DIR există fără marcaj fixture"
  if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null; fi
  rm -rf "$DATE_DIR"
fi
mkdir -p "$DATE_DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_izo_e3b"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l "/tmp/pg_izo_e3b_${PORT}.log" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
livreaza() { local sha sis rc=0
  sha="$(sha256sum "$2" | cut -d' ' -f1)"
  sis="$("${PSQL[@]}" -d "$BAZA" -Atc "SELECT system_identifier FROM pg_control_system()")"
  PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$2" --sha256 "$sha" --versiune "$1" \
    --tinta-db "$BAZA" --tinta-sistem "$sis" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >"/tmp/izo_e3b_${PORT}_runner.out" 2>&1 || rc=$?
  [ "$rc" = 0 ] || { cat "/tmp/izo_e3b_${PORT}_runner.out" >&2; esec "runner $rc ($2)"; }
}
refuza() { local tipar="$1"; shift; local out
  out="$("$@" 2>&1)" && esec "refuz așteptat: $tipar"
  grep -qF "$tipar" <<<"$out" || esec "refuz din alt motiv, așteptat $tipar: $out"
}
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_$1','$2:' || txid_current(),true)" -f "$3" >/dev/null; }
baseline() { q "SELECT jsonb_build_array(obj_description('public.magazie_bucati_evenimente'::regclass,'pg_class'),
  obj_description('public.fn_izo_porti_definitii()'::regprocedure,'pg_proc'),
  obj_description('public.fn_izo_porti_e3_definitii()'::regprocedure,'pg_proc'),
  public.fn_izo_porti_definitii(),public.fn_izo_porti_e3_definitii())"; }
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e2a_schelet.sql" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e3_schelet.sql" >/dev/null
livreaza 20261102120000 "$MIG_A"
livreaza 20261102140000 "$MIG_C"
livreaza 20261103120000 "$MIG_E3"
INAINTE="$(baseline)"
refuza 'numai postgres' "${PSQL[@]}" -d "$BAZA" -f "$MIG_E3B"
livreaza 20261105120000 "$MIG_E3B"
[ "$(q 'SELECT public.fn_izo_porti_lipsa()')" = '{}' ] || esec 'poarta după E3b'
ok '20261102a -> 2c -> E3 -> E3b prin runner; gate = {}'
OUT="$("${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/izometrie_e3b.test.sql" 2>&1)" || { echo "$OUT" >&2; esec 'catalog E3b'; }
grep -q 'TESTE E3b-A: TOATE OK' <<<"$OUT" || esec 'testele nu au ajuns la final'
grep -q 'TESTE E3b-B: TOATE OK' <<<"$OUT" || esec 'testele B nu au ajuns la final'
ok 'catalog, matrice, roluri, RLS, PUBLIC EXECUTE și mutații'
# Reaplicare direct sub gardă, ca să dovedim refuzul migrării, nu numai al metadata runner-ului.
refuza 'există deja' "${PSQL[@]}" -d "$BAZA" --single-transaction \
  -c "SELECT set_config('gazpet.livrare_migrare','20261105a_izometrie_e3b_corectii:' || txid_current(),true)" -f "$MIG_E3B"
refuza 'nearmată' "${PSQL[@]}" -d "$BAZA" -f "$REV_E3B"
refuza 'READ COMMITTED' "${PSQL[@]}" -d "$BAZA" --single-transaction -c 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ' \
  -c "SELECT set_config('gazpet.revenire_20261105a','IZO_E3B_SCOATE:' || txid_current(),true)" -f "$REV_E3B"
# Fapt necomis numai în fixture: eroarea revenirii anulează și INSERT-ul.
refuza 'există fapte E3b' "${PSQL[@]}" -d "$BAZA" --single-transaction \
  -c "ALTER TABLE public.izo_corectii DISABLE TRIGGER trg_izo_cor_garda;
      INSERT INTO public.izo_corectii(proiect_id,tip,import_id,inainte,motiv,cale,propus_de)
      VALUES(3,'storno_import','fixture-e3b','{}','fixture revenire','direct','00000000-0000-0000-0000-000000000121');
      ALTER TABLE public.izo_corectii ENABLE ALWAYS TRIGGER trg_izo_cor_garda" \
  -c "SELECT set_config('gazpet.revenire_20261105a','IZO_E3B_SCOATE:' || txid_current(),true)" -f "$REV_E3B"
revenire 20261105a IZO_E3B_SCOATE "$REV_E3B"
[ "$(baseline)" = "$INAINTE" ] || esec 'amprenta sau ștampilele diferă după revenire E3b'
[ "$(q 'SELECT public.fn_izo_porti_lipsa()')" = '{}' ] || esec 'porți E3 după revenire E3b'
ok 'reaplicare refuzată; revenire E3b: COMMENT/amprenta/ștampile EXACT egale cu baseline'
revenire 20261103b IZO_E3_SCOATE "$REV_E3"
ok 'revenirea E3 trece după revenirea E3b'
q "DELETE FROM supabase_migrations.schema_migrations WHERE name IN ('20261105a_izometrie_e3b_corectii','20261103b_izometrie_e3_documente')" >/dev/null
revenire 20261102c IZO_CAI_STOC_SCOATE "$REV_C"
revenire 20261102a IZO_E2A_SCOATE "$REV_A"
echo 'PASS E3b-A: schelet -> apply -> catalog -> refuz reaplicare -> revenire E3b -> E3 -> 2c -> E2a'
