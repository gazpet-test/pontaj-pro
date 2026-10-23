#!/usr/bin/env bash
# Validarea LOCALĂ (PG16, cluster de unică folosință în /tmp, port 6100) a pașilor 0b–2 ai probei E3b pe branch — fără Supabase.
# Simulează „platforma altei versiuni”: replicile exacte de prod (supabase/tests/izometrie_e3_replici_platforma.sql), apoi o
# deriva ca pe un branch nou (alt corp la grant_pg_net_access, alt config la grant_pg_graphql_access); pasul 0b (replici_pas0.sh,
# același cod ca pe branch) trebuie să le readucă exact la prod; apoi 2a → 2c → E3 → E3b prin runner, poarta {}, control 0e = 0,
# revenirea E3b → baseline exact, relivrarea; la final martorul: o derivă după E3b înroșește poarta, iar 0b o face iar verde.
# Utilizare (din Windows):
#   wsl -d Ubuntu-24.04 -- bash -lc "bash /mnt/c/Users/Gazpet-Ai/wt-e3b/scripts/izometrie/e3b_gen/proba_pg17/valideaza_local_pg16.sh"
set -Eeuo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; RAD="$(cd "$DIR/../../../.." && pwd)"
SRC=/tmp/izo_src_e3b_proba_local; rm -rf "$SRC" && mkdir -p "$SRC/supabase"
cp -r "$RAD/scripts" "$SRC/" && cp -r "$RAD/supabase/migrations" "$RAD/supabase/revenire" "$RAD/supabase/tests" "$SRC/supabase/"
find "$SRC" -type f \( -name '*.sh' -o -name '*.sql' -o -name '*.py' \) -exec sed -i 's/\r$//' {} +
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"; DATE_DIR=/tmp/pg_izo_e3b_proba_6100; PORT=6100; BAZA=izo_e3b_proba_test
esec() { echo "ESEC: $*" >&2; exit 1; }
ok()   { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_izo_e3b_proba" ] || esec "$DATE_DIR există fără marcaj fixture"
  [ -f "$DATE_DIR/postmaster.pid" ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || true
  rm -rf "$DATE_DIR"
fi
mkdir -p "$DATE_DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
touch "$DATE_DIR/.fixture_izo_e3b_proba"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l "/tmp/pg_izo_e3b_proba_${PORT}.log" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null
trap 'ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA")
q() { "${PSQL[@]}" -Atc "$1"; }
"$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -f "$SRC/supabase/tests/izometrie_e2a_schelet.sql" >/dev/null
"${PSQL[@]}" -f "$SRC/supabase/tests/izometrie_e3_schelet.sql" >/dev/null
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
livreaza() { PSQL_BIN="$PG_BIN/psql" bash "$SRC/scripts/livrare_migrare.sh" --migrare "$1" --sha256 "$(sha256sum "$1" | cut -d' ' -f1)" --versiune "$2" \
    --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/izo_e3b_proba_runner.out 2>&1 \
    || { tail -15 /tmp/izo_e3b_proba_runner.out >&2; esec "runner $(basename "$1")"; } }
baseline() { q "SELECT jsonb_build_array(obj_description('public.magazie_bucati_evenimente'::regclass,'pg_class'),
  obj_description('public.fn_izo_porti_definitii()'::regprocedure,'pg_proc'),
  obj_description('public.fn_izo_porti_e3_definitii()'::regprocedure,'pg_proc'),
  public.fn_izo_porti_definitii(),public.fn_izo_porti_e3_definitii())"; }
control_0e() { local o; o="$("${PSQL[@]}" -At -f "$SRC/scripts/control_0e.sql")" || esec "$1 control 0e: psql"; [ -z "$o" ] || esec "$1 control 0e: $o"; }
deriva() {   # „branch nou”: alt corp la grant_pg_net_access, alt config la grant_pg_graphql_access (owner / trigger-e neatinse)
  "${PSQL[@]}" -c "DO \$d\$ DECLARE s text; BEGIN
      SELECT prosrc INTO s FROM pg_proc WHERE oid = 'extensions.grant_pg_net_access()'::regprocedure;
      EXECUTE format('CREATE OR REPLACE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger LANGUAGE plpgsql SET search_path = '''' AS %L', s || '-- pg_net 0.20.4');
      SELECT prosrc INTO s FROM pg_proc WHERE oid = 'extensions.grant_pg_graphql_access()'::regprocedure;
      EXECUTE format('CREATE OR REPLACE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger LANGUAGE plpgsql AS %L', s);
    END \$d\$" >/dev/null; }

# platforma: replicile exacte de prod (fișierul testelor r5h), apoi deriva unui branch nou
"${PSQL[@]}" --single-transaction -f "$SRC/supabase/tests/izometrie_e3_replici_platforma.sql" >/dev/null
PGOPTIONS='-c check_function_bodies=off' deriva
[ "$(q "SELECT md5(prosrc || '|') FROM pg_proc WHERE oid = 'extensions.grant_pg_net_access()'::regprocedure")" != edf73b0d77ee6bee3f1368990b20679d ] || esec "deriva nu s-a aplicat"
ok "local: schelet E2a + E3 (baseline Storage / profiles), platforma replicată apoi derivată (net: alt corp, graphql: fără config)"

# 0b, același cod ca pe branch (aici rolul e superuser, deci CREATE OR REPLACE trece; pe branch poate cere owner-ul funcției)
python3 "$SRC/scripts/izometrie/e3b_gen/proba_pg17/replici_branch.py" "$SRC/scripts/izometrie/e3_gen/gen_e3.py" \
  "$SRC/scripts/izometrie/e3_gen/baseline_pre_e3.json" /tmp/izo_e3b_proba_replici
. "$SRC/scripts/izometrie/e3b_gen/proba_pg17/replici_pas0.sh"
PGOPTIONS='-c check_function_bodies=off' pas0_replici /tmp/izo_e3b_proba_replici
[ "$(grep -c '^OK' /tmp/izo_e3b_verifica.out)" = 5 ] || esec "0b: așteptat 5 excepții OK local (3 platformă + 2 profiles)"

# 1. 2a → 2c → E3 → E3b prin runner, poarta {}, control 0e = 0
livreaza "$SRC/supabase/migrations/20261102a_izometrie_e2a_registru.sql" 20261102120000
livreaza "$SRC/supabase/migrations/20261102c_izometrie_cai_vechi_stoc.sql" 20261102140000
livreaza "$SRC/supabase/migrations/20261103b_izometrie_e3_documente.sql" 20261103120000
[ "$(q "SELECT public.fn_izo_porti_lipsa()")" = '{}' ] || esec "1 porți după E3: $(q "SELECT public.fn_izo_porti_lipsa()")"
INAINTE="$(baseline)"
livreaza "$SRC/supabase/migrations/20261106a_izometrie_e3b_corectii.sql" 20261106120000
[ "$(q "SELECT public.fn_izo_porti_lipsa()")" = '{}' ] || esec "1 porți după E3b: $(q "SELECT public.fn_izo_porti_lipsa()")"
control_0e 1
ok "1 local: 2a → 2c → E3 → E3b prin runner peste replicile exacte; poarta {}; control 0e = 0"

# 2. revenirea E3b → baseline exact; relivrare
"${PSQL[@]}" --single-transaction -c "SELECT set_config('gazpet.revenire_20261106a', 'IZO_E3B_SCOATE:' || txid_current(), true);" \
  -f "$SRC/supabase/revenire/20261106a_izometrie_e3b_corectii_ROLLBACK.sql" >/tmp/izo_e3b_proba_rev.out 2>&1 || { tail -5 /tmp/izo_e3b_proba_rev.out >&2; esec "2 revenirea E3b"; }
[ "$(baseline)" = "$INAINTE" ] || esec "2 baseline diferit după revenirea E3b"
[ "$(q "SELECT (SELECT count(*) FROM pg_roles WHERE rolname IN ('izo_cor_editor','izo_corectie_writer')) || ':' || (to_regclass('public.izo_corectii') IS NULL)::text || ':' ||
        (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\_izo\_cor\_%')")" = "0:true:0" ] || esec "2 obiecte E3b rămase"
q "DELETE FROM supabase_migrations.schema_migrations WHERE name = '20261106a_izometrie_e3b_corectii'" >/dev/null
livreaza "$SRC/supabase/migrations/20261106a_izometrie_e3b_corectii.sql" 20261106120001
[ "$(q "SELECT public.fn_izo_porti_lipsa()")" = '{}' ] || esec "2 porți după relivrare"
control_0e 2
ok "2 local: revenirea E3b → baseline exact, obiecte scoase; relivrare, poarta {}, control 0e = 0"

# martor: aceeași derivă DUPĂ E3b înroșește poarta (deci 0b e cel care o ține verde pe un branch nou); 0b o readuce verde
PGOPTIONS='-c check_function_bodies=off' deriva
L="$(q "SELECT public.fn_izo_porti_lipsa()")"
[ "$L" != '{}' ] || esec "martor: deriva corpului grant_pg_net_access nu înroșește poarta"
echo "     martor, poarta cu platforma derivată: $(echo "$L" | head -c 300)"
PGOPTIONS='-c check_function_bodies=off' pas0_replici /tmp/izo_e3b_proba_replici
[ "$(q "SELECT public.fn_izo_porti_lipsa()")" = '{}' ] || esec "martor: poarta nu revine verde după 0b"
ok "martor: deriva platformei înroșește poarta E3; replicile 0b o readuc verde"
echo "PASS validarea locală PG16 a pașilor 0b–2 ai probei E3b"
