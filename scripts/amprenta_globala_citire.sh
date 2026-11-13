#!/usr/bin/env bash
# ============================================================================
# L15 v2 (docs/LIVRARE_L15_V2.md): CITIREA coordonatorului — DOAR CITIRE, pe productie (si pe clona). Intr-O SINGURA
# tranzactie REPEATABLE READ READ ONLY (aceeasi fotografie MVCC pentru tot):
#   1. profilul sesiunii (AG_SESIUNE v1) + verificarea tintei (db, system_identifier, in_recovery = false);
#   2. [--amprente-migrare scripts/<x>_amprente.sql] scriptul de amprente EXISTENT al migrarii, nemodificat in repo:
#      se ruleaza o COPIE din care se scot exact linia „BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;” si
#      linia „ROLLBACK;” (fiecare trebuie sa apara EXACT o data, altfel refuz) => ruleaza in tranzactia de aici;
#   3. contextul canonic (SET LOCAL, ca functia runnerului), apoi GLOBAL + numarul de randuri + md5 pe familii + validarea
#      (etichete unice, randuri valide) [+ --lista: toate randurile familie / eticheta / amprenta, pentru comparatia
#      clona <-> productie];
#   4. [--radacina <functie(argumente)> ...] SEMNALELE pentru review pe lantul portilor (cel mai bun efort, lexical +
#      pg_depend, prin vederi): functii cu EXECUTE dinamic, vederi citite, functii in alt limbaj decat sql / plpgsql,
#      functii SECURITY DEFINER fara search_path propriu (acestea din urma = REFUZ: cod 4);
#   5. verificarea ca 1-4 au rulat in ACEEASI tranzactie (acelasi transaction_timestamp, acelasi backend, RR, READ ONLY);
#      ROLLBACK.
# Limita: functiile de deparsare (pg_get_viewdef / indexdef / ...) citesc cache-ul de catalog (ultima stare comisa), nu
# fotografia MVCC; un DDL comis in timpul citirii poate amesteca stari => GLOBAL nu se va potrivi la livrare (refuz,
# recitire), nu o acceptare gresita. Citirea se face cand nu ruleaza alte DDL.
#
# Utilizare (parola DOAR din ~/.pgpass / PGPASSFILE; PSQL_BIN = psql-ul folosit la livrare):
#   bash scripts/amprenta_globala_citire.sh --tinta-host <H> --tinta-port <P> --tinta-db <D> --tinta-sistem <system_identifier> \
#        --user <U> [--amprente-migrare scripts/<x>_amprente.sql] [--radacina 'public.fn(bigint)' ...] [--lista] \
#        [--doar-genereaza <dosar_nou>] > citire.txt
# Iesire (stdout): liniile scriptului migrarii (daca e dat), apoi, separate prin TAB:
#   GLOBAL - - <md5> <randuri> | FAMILIE <familie> - <md5> <randuri> | VALIDARE - - ok|<problema> <n>
#   [RAND <familie> <eticheta> <amprenta> -] | LANT <tip> <obiect> <detalii> | SEMNALE <executie_dinamica> <vederi> <limbaj_altul>
#   <definer_fara_search_path> | FOTOGRAFIE - - aceeasi -
# Coduri: 0 citit | 1 psql / interogare esuata | 2 argumente | 3 local (fisier, generare) | 4 REFUZ: DEFINER fara
#   search_path in lant | 5 validare esuata (dubluri / randuri invalide) | 22 tinta neconfirmata | 40 doar generat.
# ============================================================================
set -Eeuo pipefail
umask 077
refuz() { echo "REFUZ (nimic citit): $2" >&2; exit "$1"; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=livrare_amprenta.sh
. "$ROOT/scripts/livrare_amprenta.sh"

H="" P="" D="" SIS="" U="" AMP_MIG="" LISTA=0 GEN="" RAD=()
while [ $# -gt 0 ]; do
  case "$1" in --lista) LISTA=1; shift; continue ;; esac
  [ $# -ge 2 ] || refuz 2 "optiunea $1 fara valoare"
  case "$1" in
    --tinta-host) H="$2" ;; --tinta-port) P="$2" ;; --tinta-db) D="$2" ;; --tinta-sistem) SIS="$2" ;; --user) U="$2" ;;
    --amprente-migrare) AMP_MIG="$2" ;; --radacina) RAD+=("$2") ;; --doar-genereaza) GEN="$2" ;;
    *) refuz 2 "optiune nepermisa: $1" ;;
  esac
  shift 2
done
for v in PGPASSWORD PGOPTIONS PGDATABASE PSQLRC PGHOSTADDR PGTARGETSESSIONATTRS PGLOADBALANCEHOSTS PGSERVICE PGSERVICEFILE PGSYSCONFDIR PGTZ PGDATESTYLE; do
  [ -z "${!v+x}" ] || refuz 2 "variabila $v e setata (parola: ~/.pgpass / PGPASSFILE; profilul sesiunii trebuie sa fie al rolului, ca la livrare)"
done
unset PGHOST PGPORT
[[ "$H" =~ ^[A-Za-z0-9._/-]{1,253}$ ]] || refuz 2 "--tinta-host obligatoriu"
[[ "$P" =~ ^[0-9]{1,5}$ ]] || refuz 2 "--tinta-port obligatoriu"
[[ "$D" =~ ^[A-Za-z0-9_]{1,63}$ ]] || refuz 2 "--tinta-db obligatoriu"
[[ "$SIS" =~ ^[0-9]{1,20}$ ]] || refuz 2 "--tinta-sistem obligatoriu (system_identifier)"
[[ "$U" =~ ^[A-Za-z0-9_.-]{1,63}$ ]] || refuz 2 "--user obligatoriu"
for r in ${RAD[@]+"${RAD[@]}"}; do
  [[ "$r" =~ ^[A-Za-z0-9_.\"\(\),\ ]{1,250}$ ]] || refuz 2 "--radacina invalida (forma functie(argumente), fara apostrof): $r"
done
if [ -n "$GEN" ]; then
  [ ! -e "$GEN" ] && [ -d "$(dirname "$GEN")" ] || refuz 2 "--doar-genereaza: dosarul trebuie sa fie NOU: $GEN"
fi

W="$(mktemp -d)"; trap 'chmod -R u+w "$W" 2>/dev/null; rm -rf "$W"' EXIT
chmod 700 "$W"
if [ -n "$AMP_MIG" ]; then
  [ -f "$AMP_MIG" ] || refuz 2 "--amprente-migrare: fisier inexistent: $AMP_MIG"
  tr -d '\r' <"$AMP_MIG" >"$W/mig_original.sql"
  [ "$(grep -cxF 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;' "$W/mig_original.sql" || true)" = 1 ] \
    && [ "$(grep -cxF 'ROLLBACK;' "$W/mig_original.sql" || true)" = 1 ] \
    || refuz 3 "--amprente-migrare: liniile BEGIN ... READ ONLY; / ROLLBACK; trebuie sa apara exact o data (forma scripturilor *_amprente.sql)"
  grep -vxF -e 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;' -e 'ROLLBACK;' "$W/mig_original.sql" >"$W/mig_amprente.sql" || true
  # nimic altceva din script nu are voie sa inchida / deschida tranzactia de aici
  ! grep -qiE '^[[:space:]]*(BEGIN|COMMIT|ROLLBACK|END|ABORT|START)[[:space:]]*(TRANSACTION|WORK)?[[:space:]]*;' "$W/mig_amprente.sql" \
    || refuz 3 "--amprente-migrare: alt control de tranzactie in script"
fi
SES="$(ag_bloc 'AG_SESIUNE v1')" || refuz 3 "blocul AG_SESIUNE v1"
CAT="$(ag_bloc 'AG_CATALOG v1')" || refuz 3 "blocul AG_CATALOG v1"
RAND_SQL=""
[ "$LISTA" = 0 ] || RAND_SQL="  UNION ALL SELECT 3, 'RAND', a.familie, a.eticheta, a.amprenta, '-' FROM ag_tot a"

{
  cat <<SQL
\\set ON_ERROR_STOP 1
\\set QUIET 1
\\pset pager off
SET transaction_timeout = 0;
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
\\pset format unaligned
\\pset tuples_only on
\\pset fieldsep '\\t'
-- >>> AG_CITIRE sesiune
SELECT (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(s.familie, s.eticheta, s.amprenta, s.detaliu)) FROM (
$SES
) s)::pg_catalog.text AS ag_ses,
  (EXTRACT(epoch FROM pg_catalog.transaction_timestamp()))::pg_catalog.text AS ag_ts,
  pg_catalog.pg_backend_pid() AS ag_pid
-- <<< AG_CITIRE sesiune
\\gset
-- >>> AG_CITIRE tinta
SELECT 'TINTA', '-', '-', CAST(CASE WHEN pg_catalog.current_database() OPERATOR(pg_catalog.=) '$D'
         AND (SELECT s.system_identifier::pg_catalog.text FROM pg_catalog.pg_control_system() s) OPERATOR(pg_catalog.=) '$SIS'
         AND NOT pg_catalog.pg_is_in_recovery() THEN '1' ELSE 'AG_CITIRE_TINTA_NECONFIRMATA' END AS pg_catalog.int4)::pg_catalog.text, '-'
-- <<< AG_CITIRE tinta
;
SQL
  if [ -n "$AMP_MIG" ]; then
    printf '%s\n' '\pset format aligned' '\pset tuples_only off' "\\echo '=== scriptul de amprente al migrarii ($(basename "$AMP_MIG")), in aceeasi tranzactie ==='" \
      '\ir mig_amprente.sql' '\pset format unaligned' '\pset tuples_only on'
  fi
  ag_guc_local
  cat <<SQL
-- >>> AG_CITIRE global
WITH ag_ses AS (
  SELECT x.e ->> 0 AS familie, x.e ->> 1 AS eticheta, x.e ->> 2 AS amprenta, x.e ->> 3 AS detaliu
    FROM pg_catalog.jsonb_array_elements(:'ag_ses'::pg_catalog.jsonb) AS x(e)
),
ag_cat AS MATERIALIZED (
$CAT
),
ag_tot AS MATERIALIZED (SELECT * FROM ag_ses UNION ALL SELECT * FROM ag_cat),
ag_glob AS ($(ag_sql_global ag_tot)),
ag_fam AS ($(ag_sql_familii ag_tot)),
ag_val AS (
  SELECT (SELECT count(*) FROM (SELECT 1 FROM ag_tot a GROUP BY a.familie, a.eticheta HAVING count(*) > 1) d) AS dubluri,
         (SELECT count(*) FROM ag_tot a WHERE a.familie IS NULL OR a.eticheta IS NULL OR a.amprenta IS NULL
            OR a.familie !~ '^[a-z_]+\$' OR a.amprenta !~ '^[0-9a-f]{32}\$') AS invalide
)
SELECT x.tip, x.familie, x.eticheta, x.valoare, x.n FROM (
  SELECT 0 AS o, 'GLOBAL' AS tip, '-' AS familie, '-' AS eticheta, g.global_md5 AS valoare, g.randuri::text AS n FROM ag_glob g
  UNION ALL SELECT 1, 'FAMILIE', f.familie, '-', f.md5, f.randuri::text FROM ag_fam f
  UNION ALL SELECT 2, 'VALIDARE', '-', '-', CASE WHEN v.dubluri = 0 AND v.invalide = 0 THEN 'ok' ELSE 'dubluri=' || v.dubluri || ',invalide=' || v.invalide END,
                   (v.dubluri + v.invalide)::text FROM ag_val v
$RAND_SQL
) x ORDER BY x.o, x.familie COLLATE "C", x.eticheta COLLATE "C"
-- <<< AG_CITIRE global
;
SQL
  if [ ${#RAD[@]} -gt 0 ]; then
    VALORI=""
    for r in "${RAD[@]}"; do VALORI="${VALORI:+$VALORI, }('$r')"; done
    cat <<SQL
-- >>> AG_CITIRE semnale
WITH RECURSIVE
ag_rad(nume, oid) AS (SELECT v.n, to_regprocedure(v.n)::oid FROM (VALUES $VALORI) v(n)),
ag_sistem(oid) AS (SELECT n.oid FROM pg_namespace n WHERE n.nspname IN ('pg_catalog', 'information_schema')),
ag_lant(tip, oid) AS (
  SELECT 'f'::text, r.oid FROM ag_rad r WHERE r.oid IS NOT NULL
  UNION
  SELECT x.tip, x.oid FROM ag_lant l CROSS JOIN LATERAL (
    -- functii apelate dupa nume din corpurile sql / plpgsql (supra-aproximare, ca INCHIDERE_L15)
    SELECT 'f'::text AS tip, p2.oid FROM pg_proc p JOIN pg_language lg ON lg.oid = p.prolang AND lg.lanname IN ('sql', 'plpgsql')
      CROSS JOIN LATERAL regexp_matches(p.prosrc, '([[:alpha:]_][[:alnum:]_\$]*)"?[[:space:]]*[(]', 'g') w
      JOIN pg_proc p2 ON lower(p2.proname) = lower(w[1])
     WHERE l.tip = 'f' AND p.oid = l.oid AND p2.oid <> p.oid AND p2.pronamespace NOT IN (SELECT s.oid FROM ag_sistem s)
    UNION
    -- vederi citite dupa nume din corpurile sql / plpgsql
    SELECT 'v'::text, c.oid FROM pg_proc p JOIN pg_language lg ON lg.oid = p.prolang AND lg.lanname IN ('sql', 'plpgsql')
      CROSS JOIN LATERAL regexp_matches(p.prosrc, '([[:alpha:]_][[:alnum:]_\$]*)', 'g') w
      JOIN pg_class c ON c.relkind IN ('v', 'm') AND lower(c.relname) = lower(w[1])
     WHERE l.tip = 'f' AND p.oid = l.oid AND c.relnamespace NOT IN (SELECT s.oid FROM ag_sistem s)
    UNION
    -- dependentele inregistrate: corpuri BEGIN ATOMIC (functie -> functie)
    SELECT 'f'::text, d.refobjid FROM pg_depend d JOIN pg_proc p2 ON p2.oid = d.refobjid
     WHERE l.tip = 'f' AND d.classid = 'pg_proc'::regclass AND d.objid = l.oid AND d.refclassid = 'pg_proc'::regclass
       AND d.refobjid <> l.oid AND p2.pronamespace NOT IN (SELECT s.oid FROM ag_sistem s)
    UNION
    -- vederile: ce functii si ce alte vederi cheama regula lor (pg_depend)
    SELECT CASE WHEN d.refclassid = 'pg_proc'::regclass THEN 'f' ELSE 'v' END, d.refobjid
      FROM pg_rewrite rw JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = rw.oid
      LEFT JOIN pg_proc p2 ON d.refclassid = 'pg_proc'::regclass AND p2.oid = d.refobjid
      LEFT JOIN pg_class c2 ON d.refclassid = 'pg_class'::regclass AND c2.oid = d.refobjid
     WHERE l.tip = 'v' AND rw.ev_class = l.oid AND d.refobjid <> l.oid
       AND ((p2.oid IS NOT NULL AND p2.pronamespace NOT IN (SELECT s.oid FROM ag_sistem s))
         OR (c2.oid IS NOT NULL AND c2.relkind IN ('v', 'm') AND c2.relnamespace NOT IN (SELECT s.oid FROM ag_sistem s)))
  ) x
),
ag_det AS (
  SELECT l.tip, CASE l.tip WHEN 'f' THEN 'functie ' || l.oid::regprocedure::text ELSE 'relatie ' || l.oid::regclass::text END AS obiect,
         lg.lanname::text AS limbaj, p.prosecdef AS definer,
         EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%') AS are_search_path,
         (lg.lanname IN ('sql', 'plpgsql') AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '[[:<:]]execute[[:>:]]') AS executie_dinamica
    FROM (SELECT DISTINCT tip, oid FROM ag_lant) l
    LEFT JOIN pg_proc p ON l.tip = 'f' AND p.oid = l.oid
    LEFT JOIN pg_language lg ON lg.oid = p.prolang
)
SELECT 'RADACINA_LIPSA', r.nume, '-', '-', '-' FROM ag_rad r WHERE r.oid IS NULL
UNION ALL
SELECT 'LANT', d.tip, d.obiect,
       CASE WHEN d.tip = 'f' THEN concat_ws(' ', 'limbaj=' || d.limbaj, CASE WHEN d.definer THEN 'DEFINER' END,
              CASE WHEN NOT d.are_search_path THEN 'search_path=mostenit' END, CASE WHEN d.executie_dinamica THEN 'EXECUTE_DINAMIC' END)
            ELSE 'vedere' END, '-'
  FROM ag_det d
UNION ALL
SELECT 'SEMNALE',
       (SELECT count(*) FROM ag_det d WHERE d.executie_dinamica)::text,
       (SELECT count(*) FROM ag_det d WHERE d.tip = 'v')::text,
       (SELECT count(*) FROM ag_det d WHERE d.tip = 'f' AND d.limbaj NOT IN ('sql', 'plpgsql'))::text,
       (SELECT count(*) FROM ag_det d WHERE d.tip = 'f' AND d.definer AND NOT d.are_search_path)::text
-- <<< AG_CITIRE semnale
;
SQL
  fi
  cat <<SQL
-- >>> AG_CITIRE fotografie
SELECT 'FOTOGRAFIE', '-', '-', CASE WHEN CAST(CASE WHEN (EXTRACT(epoch FROM pg_catalog.transaction_timestamp()))::pg_catalog.text OPERATOR(pg_catalog.=) :'ag_ts'
         AND pg_catalog.pg_backend_pid() OPERATOR(pg_catalog.=) :ag_pid
         AND pg_catalog.current_setting('transaction_isolation') OPERATOR(pg_catalog.=) 'repeatable read'
         AND pg_catalog.current_setting('transaction_read_only') OPERATOR(pg_catalog.=) 'on'
       THEN '1' ELSE 'AG_CITIRE_ALTA_FOTOGRAFIE' END AS pg_catalog.int4) OPERATOR(pg_catalog.=) 1 THEN 'aceeasi' END, '-'
-- <<< AG_CITIRE fotografie
;
ROLLBACK;
SQL
} >"$W/citire.sql"

if [ -n "$GEN" ]; then
  mkdir -- "$GEN" && cp -- "$W"/*.sql "$GEN"/ || refuz 3 "--doar-genereaza: copierea"
  echo "✓ GENERAT (fara conexiune): $GEN ($(cd "$GEN" && ls | tr '\n' ' '))"
  exit 40
fi

PSQL="${PSQL_BIN:-psql}"
export PGCLIENTENCODING=UTF8
RC=0
( cd "$W" && "$PSQL" -X -v ON_ERROR_STOP=1 -f citire.sql -h "$H" -p "$P" -U "$U" -d "$D" ) >"$W/iesire.txt" 2>"$W/erori.txt" || RC=$?
tr -d '\r' <"$W/iesire.txt"
if [ "$RC" != 0 ]; then
  sed 's/^/  /' "$W/erori.txt" >&2
  if grep -q 'AG_CITIRE_TINTA_NECONFIRMATA' "$W/erori.txt"; then echo "✗ TINTA NECONFIRMATA (db / system_identifier / in_recovery)" >&2; exit 22; fi
  echo "✗ citirea a esuat (psql $RC), nimic schimbat (tranzactie READ ONLY)" >&2; exit 1
fi
OUT="$(tr -d '\r' <"$W/iesire.txt")"
grep -qx $'FOTOGRAFIE\t-\t-\taceeasi\t-' <<<"$OUT" || { echo "✗ verificarea fotografiei comune lipseste" >&2; exit 1; }
grep -qE $'^GLOBAL\t-\t-\t[0-9a-f]{32}\t[0-9]+$' <<<"$OUT" || { echo "✗ GLOBAL lipsa / nerecunoscut" >&2; exit 1; }
grep -qx $'VALIDARE\t-\t-\tok\t0' <<<"$OUT" || { echo "✗ VALIDARE esuata (etichete duble / randuri invalide) — nu se foloseste ca baseline" >&2; exit 5; }
if [ ${#RAD[@]} -gt 0 ]; then
  ! grep -q $'^RADACINA_LIPSA\t' <<<"$OUT" || { echo "✗ radacina inexistenta in baza (vezi RADACINA_LIPSA)" >&2; exit 1; }
  S="$(grep -E $'^SEMNALE\t' <<<"$OUT")" || { echo "✗ SEMNALE lipsa" >&2; exit 1; }
  IFS=$'\t' read -r _ S_EX S_VED S_LIMB S_DEF <<<"$S"
  echo "SEMNALE (de examinat si acceptat explicit in PR-ul de baseline): EXECUTE dinamic $S_EX, vederi citite $S_VED, alt limbaj $S_LIMB, DEFINER fara search_path $S_DEF" >&2
  [ "$S_DEF" = 0 ] || { echo "✗ REFUZ: $S_DEF functie(i) SECURITY DEFINER din lant fara search_path propriu (L15) — nu se face baseline" >&2; exit 4; }
fi
echo "✓ citit intr-o singura fotografie (REPEATABLE READ READ ONLY): $(grep -E $'^GLOBAL\t' <<<"$OUT" | cut -f4,5 | tr '\t' ' ') randuri" >&2
exit 0
