#!/usr/bin/env bash
# ============================================================================
# L15 v2 (docs/LIVRARE_L15_V2.md): CITIREA coordonatorului - DOAR CITIRE, pe productie (si pe clona). Intr-O SINGURA
# tranzactie REPEATABLE READ READ ONLY (aceeasi fotografie MVCC pentru interogarile de aici):
#   1. profilul sesiunii (AG_SESIUNE v2) + verificarea tintei (db, system_identifier, in_recovery = false);
#   2. [--amprente-migrare scripts/<x>_amprente.sql] scriptul de amprente EXISTENT al migrarii, nemodificat in repo:
#      se ruleaza o COPIE din care se scot exact linia "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;" si
#      linia "ROLLBACK;" (fiecare trebuie sa apara EXACT o data, altfel refuz) => ruleaza in tranzactia de aici; iesirea lui
#      (format nealiniat, separator " | ") sta intre liniile "=== scriptul de amprente al migrarii ..." si
#      "=== sfarsit scriptul de amprente al migrarii ==="; momentul fotografiei (now(), randul MOMENT, tiparit o data) se
#      inlocuieste cu marcajul fix "<momentul fotografiei>" DOAR in campul identificat al ANTETULUI STANDARD: randul de date
#      de imediat dupa linia exacta "baza | sistem | versiune | la", ultimul camp, si numai daca e EXACT momentul. Orice alta
#      aparitie ramane cum e; antet absent / in alt format = nimic normalizat (--recitire arata diferenta);
#   3. contextul canonic (SET LOCAL, ca functia runnerului), apoi GLOBAL + numarul de randuri + md5 pe familii + validarea
#      (etichete unice, randuri valide) [+ --lista: toate randurile familie / eticheta / amprenta, pentru
#      scripts/l15_compara_liste.sh];
#   4. CONTEXT: server_version_num, current_user, session_user;
#      [--detalii-plasa <fisier nou>] (cere --lista): in ACEEASI fotografie, detaliul plasei sistem_initdb - cate un rand pe
#      obiect de la initdb: plasa TAB identitate TAB md5(campuri) TAB campuri (blocul AG_PLASA v2, aceeasi definitie ca
#      randurile plasei). Verificat inainte de scriere: forma, identitati unice, iar md5 peste campuri (in ordinea
#      identitatii, LC_ALL=C, unite cu LF) reproduce randul RAND sistem_initdb al plasei (altfel cod 1, fisier nescris);
#   5. [--radacina <functie(argumente)> ...] SEMNALELE pentru review pe lantul portilor (cel mai bun efort, lexical +
#      pg_depend, prin vederi): functii cu EXECUTE dinamic, vederi citite, functii in alt limbaj decat sql / plpgsql, si
#      calea (search_path) fiecarei functii SECURITY DEFINER din lant, clasificata "sigura" sau "nesigura: <motiv>".
#      "Are search_path propriu" NU ajunge: o cale fara pg_temp la final cauta INTAI in schema temporara (relatii, tipuri),
#      iar TEMP e acordat implicit lui PUBLIC; o schema in care altcineva are CREATE poate umbri un nume necalificat.
#      E "sigura" DOAR daca: (1) are search_path propriu; (2) fiecare element e un identificator simplu sau intre ghilimele,
#      fara virgule / ghilimele in nume (altfel "element neanalizabil", fail-closed); (3) nu contine "$user"; (4) pg_temp
#      apare explicit, o data, ULTIMUL (deci search_path="" e nesigura); (5) fiecare alta schema exista si niciun rol in
#      afara celor de incredere nu are CREATE pe ea (has_schema_privilege pe TOATE rolurile din pg_roles: apartenente +
#      PUBLIC). De incredere: superuserii, proprietarul schemei, rolul citirii (current_user) si --rol-de-incredere <rol>
#      (repetabila); fiecare rol de incredere cu CREATE apare ca INCREDERE <schema> <rol> <motiv>, pentru review.
#      "nesigura" = REFUZ (cod 4). Singura iesire: --definer-verificat '<functie(argumente)>=<md5>' (repetabila), md5 =
#      md5(jsonb [prosrc, proconfig]) tiparit pe randul LANT al fiecarei functii DEFINER: "un om a verificat ca toate
#      referintele din ACEST corp sunt calificate cu schema" (se consemneaza in PR-ul de baseline). Corp / cale schimbate =>
#      alt md5 => iar refuz. Acceptare pentru o functie inexistenta, din afara lantului, ne-DEFINER, deja sigura sau cu
#      alt md5 = REFUZ (cod 4: acceptarile vechi nu raman agatate);
#   6. verificarea ca 1-5 au rulat in ACEEASI tranzactie (acelasi transaction_timestamp, acelasi backend, RR, READ ONLY);
#      ROLLBACK.
# Limita: REPEATABLE READ da o fotografie interogarilor explicite, nu tuturor citirilor interne de catalog (deparsarea,
# cache-urile); citirea se face FARA DDL concurent (cerinta de procedura). Un amestec ar da cel mai probabil o valoare care
# nu se potriveste la livrare (refuz, recitire), dar asta nu e demonstrat.
#
# Utilizare (parola DOAR din ~/.pgpass / PGPASSFILE; PSQL_BIN = psql-ul folosit la livrare):
#   bash scripts/amprenta_globala_citire.sh --tinta-host <H> --tinta-port <P> --tinta-db <D> --tinta-sistem <system_identifier> \
#        --user <U> [--amprente-migrare scripts/<x>_amprente.sql] [--radacina 'public.fn(bigint)' ...] [--lista] \
#        [--detalii-plasa <fisier_nou>] [--rol-de-incredere <rol> ...] [--definer-verificat 'public.fn(bigint)=<md5>' ...] \
#        [--doar-genereaza <dosar_nou>] > citire.txt
# Iesire (stdout): sectiunea scriptului migrarii (daca e dat), apoi, separate prin TAB:
#   TINTA - - 1 - | MOMENT - - <now() al fotografiei> - | GLOBAL - - <md5> <randuri> | FAMILIE <familie> - <md5> <randuri> |
#   VALIDARE - - ok|<problema> <n>
#   [RAND <familie> <eticheta> <amprenta> -] | CONTEXT <nume> - <valoare> -
#   [LANT <tip> <obiect> <detalii> - - | INCREDERE <schema> <rol> <motiv> - - | SEMNALE <executie_dinamica> <vederi>
#    <limbaj_altul> <definer_nesigure> <definer_acceptate>] | FOTOGRAFIE - - aceeasi -
# Coduri: 0 citit | 1 psql / interogare esuata / detaliul plasei invalid sau nereproductibil | 2 argumente (si rol de incredere inexistent) | 3 local (fisier, generare) |
#   4 REFUZ: DEFINER cu cale nesigura in lant / acceptare invalida | 5 validare esuata (dubluri / randuri invalide) |
#   22 tinta neconfirmata | 40 doar generat.
# ============================================================================
set -Eeuo pipefail
umask 077
refuz() { echo "REFUZ (nimic citit): $2" >&2; exit "$1"; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=livrare_amprenta.sh
. "$ROOT/scripts/livrare_amprenta.sh"

H="" P="" D="" SIS="" U="" AMP_MIG="" LISTA=0 GEN="" DPL="" RAD=() INCR=() ACC=()
while [ $# -gt 0 ]; do
  case "$1" in --lista) LISTA=1; shift; continue ;; esac
  [ $# -ge 2 ] || refuz 2 "optiunea $1 fara valoare"
  case "$1" in
    --tinta-host) H="$2" ;; --tinta-port) P="$2" ;; --tinta-db) D="$2" ;; --tinta-sistem) SIS="$2" ;; --user) U="$2" ;;
    --amprente-migrare) AMP_MIG="$2" ;; --radacina) RAD+=("$2") ;; --doar-genereaza) GEN="$2" ;; --detalii-plasa) DPL="$2" ;;
    --rol-de-incredere) INCR+=("$2") ;; --definer-verificat) ACC+=("$2") ;;
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
RE_FN='^[A-Za-z0-9_."(), ]{1,250}$'
RE_ACC='^([A-Za-z0-9_."(), ]{1,250})=([0-9a-f]{32})$'
for r in ${RAD[@]+"${RAD[@]}"}; do
  [[ "$r" =~ $RE_FN ]] || refuz 2 "--radacina invalida (forma functie(argumente), fara apostrof): $r"
done
for r in ${INCR[@]+"${INCR[@]}"}; do
  [[ "$r" =~ ^[A-Za-z0-9_.-]{1,63}$ ]] || refuz 2 "--rol-de-incredere invalid: $r"
done
for r in ${ACC[@]+"${ACC[@]}"}; do
  [[ "$r" =~ $RE_ACC ]] || refuz 2 "--definer-verificat invalid (forma 'functie(argumente)=<md5 32 hex>'): $r"
done
if [ ${#ACC[@]} -gt 0 ] && [ -n "$(printf '%s\n' "${ACC[@]}" | sed 's/=[0-9a-f]*$//' | sort | uniq -d)" ]; then
  refuz 2 "--definer-verificat: aceeasi functie de doua ori"
fi
[ ${#RAD[@]} -gt 0 ] || [ $((${#INCR[@]} + ${#ACC[@]})) = 0 ] || refuz 2 "--rol-de-incredere / --definer-verificat cer --radacina (se aplica lantului)"
if [ -n "$GEN" ]; then
  [ ! -e "$GEN" ] && [ -d "$(dirname "$GEN")" ] || refuz 2 "--doar-genereaza: dosarul trebuie sa fie NOU: $GEN"
fi
if [ -n "$DPL" ]; then
  [ "$LISTA" = 1 ] || refuz 2 "--detalii-plasa cere --lista (verificarea detaliului fata de randurile RAND sistem_initdb)"
  [ ! -e "$DPL" ] && [ -d "$(dirname "$DPL")" ] || refuz 2 "--detalii-plasa: fisierul trebuie sa fie NOU, intr-un dosar existent: $DPL"
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
SES="$(ag_bloc 'AG_SESIUNE v2')" || refuz 3 "blocul AG_SESIUNE v2"
CAT="$(ag_bloc 'AG_CATALOG v2')" || refuz 3 "blocul AG_CATALOG v2"
PLA="$(ag_bloc 'AG_PLASA v2')" || refuz 3 "blocul AG_PLASA v2"
RAND_SQL=""
[ "$LISTA" = 0 ] || RAND_SQL="  UNION ALL SELECT 3, 'RAND', a.familie, a.eticheta, a.amprenta, '-' FROM ag_tot a"
# listele VALUES (literal SQL; valorile sunt validate mai sus, fara apostrof)
valori() { local s="" x; for x in "$@"; do s="${s:+$s, }($x)"; done; printf '%s' "$s"; }
L_RAD=(); for r in ${RAD[@]+"${RAD[@]}"}; do L_RAD+=("'$r'"); done
L_INCR=(); for r in ${INCR[@]+"${INCR[@]}"}; do L_INCR+=("'$r'"); done
L_ACC=(); for r in ${ACC[@]+"${ACC[@]}"}; do [[ "$r" =~ $RE_ACC ]]; L_ACC+=("'${BASH_REMATCH[1]}', '${BASH_REMATCH[2]}'"); done
V_INCR="SELECT NULL::text WHERE false"; [ ${#L_INCR[@]} = 0 ] || V_INCR="VALUES $(valori "${L_INCR[@]}")"
V_ACC="SELECT NULL::text, NULL::text WHERE false"; [ ${#L_ACC[@]} = 0 ] || V_ACC="VALUES $(valori "${L_ACC[@]}")"

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
-- >>> AG_CITIRE moment
SELECT 'MOMENT', '-', '-', pg_catalog.now()::pg_catalog.text, '-'
-- <<< AG_CITIRE moment
;
SQL
  if [ -n "$AMP_MIG" ]; then
    # format NEALINIAT: in formatul aliniat latimea coloanelor depinde de lungimea momentului (zerourile de la final ale
    # fractiunii de secunda nu se tiparesc), deci si liniile de antet / separator s-ar schimba de la o citire la alta
    printf '%s\n' '\pset format unaligned' "\\pset fieldsep ' | '" '\pset tuples_only off' \
      "\\echo '=== scriptul de amprente al migrarii ($(basename "$AMP_MIG")), in aceeasi tranzactie ==='" \
      '\ir mig_amprente.sql' "\\echo '=== sfarsit scriptul de amprente al migrarii ==='" "\\pset fieldsep '\\t'" '\pset tuples_only on'
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
-- >>> AG_CITIRE context
SELECT 'CONTEXT', x.n, '-', x.v, '-'
  FROM (VALUES (1, 'server_version_num', current_setting('server_version_num')), (2, 'current_user', current_user::text),
               (3, 'session_user', session_user::text)) AS x(o, n, v)
 ORDER BY x.o
-- <<< AG_CITIRE context
;
SQL
  if [ -n "$DPL" ]; then
    # detaliul plasei: in fisierul plasa.txt din dosarul de lucru (verificat si copiat dupa citire), nu pe stdout
    printf '%s\n' '\o plasa.txt'
    cat <<SQL
-- >>> AG_CITIRE plasa
$PLA
SELECT x.plasa, x.identitate, md5(x.campuri) AS h, x.campuri FROM ag_plasa x ORDER BY x.plasa COLLATE "C", x.identitate COLLATE "C"
-- <<< AG_CITIRE plasa
;
SQL
    printf '%s\n' '\o'
  fi
  if [ ${#RAD[@]} -gt 0 ]; then
    cat <<SQL
-- >>> AG_CITIRE semnale
WITH RECURSIVE
ag_rad(nume, oid) AS (SELECT v.n, to_regprocedure(v.n)::oid FROM (VALUES $(valori "${L_RAD[@]}")) v(n)),
ag_incr(rol) AS ($V_INCR),
ag_acc0(nume, md5) AS ($V_ACC),
ag_acc AS (SELECT a.nume, a.md5, to_regprocedure(a.nume)::oid AS oid FROM ag_acc0 a),
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
-- functiile SECURITY DEFINER din lant: valoarea PROPRIE a caii (din proconfig) + md5-ul acceptarii [prosrc, proconfig]
ag_def AS (
  SELECT p.oid, (SELECT substr(c, 13) FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%' LIMIT 1) AS cale,
         md5(jsonb_build_array(p.prosrc, to_jsonb(p.proconfig))::text) AS md5_corp
    FROM (SELECT DISTINCT l.oid FROM ag_lant l WHERE l.tip = 'f') f JOIN pg_proc p ON p.oid = f.oid
   WHERE p.prosecdef
),
-- elementele caii; nume = identificatorul analizat (NULL = neanalizabil); search_path="" = lista goala
ag_el AS (
  SELECT d.oid, s.nr, e.x AS el,
         CASE WHEN e.x ~ '^[a-z_][a-z0-9_]*\$' THEN e.x WHEN e.x ~ '^"[^",]+"\$' THEN substr(e.x, 2, length(e.x) - 2) END AS nume,
         max(s.nr) OVER (PARTITION BY d.oid) AS ultim
    FROM ag_def d CROSS JOIN LATERAL regexp_split_to_table(d.cale, ',') WITH ORDINALITY AS s(x0, nr)
    CROSS JOIN LATERAL (SELECT btrim(s.x0, ' ') AS x) e
   WHERE d.cale IS NOT NULL AND d.cale <> '""'
),
-- schemele din cai (in afara de pg_temp si "\$user") si rolurile cu CREATE pe ele + motivul increderii (NULL = neincredere)
ag_sch AS (
  SELECT DISTINCT e.nume, n.oid AS nsp, n.nspowner FROM ag_el e LEFT JOIN pg_namespace n ON n.nspname = e.nume
   WHERE e.nume IS NOT NULL AND e.nume NOT IN ('pg_temp', '\$user')
),
ag_cr AS (
  SELECT s.nume, r.rolname::text AS rol,
         CASE WHEN r.rolsuper THEN 'super' WHEN r.oid = s.nspowner THEN 'proprietar' WHEN r.rolname = current_user THEN 'rolul citirii'
              WHEN r.rolname IN (SELECT i.rol FROM ag_incr i) THEN 'optiune' END AS motiv
    FROM ag_sch s CROSS JOIN pg_roles r
   WHERE s.nsp IS NOT NULL AND has_schema_privilege(r.oid, s.nsp, 'CREATE')
),
ag_motive AS (
  SELECT d.oid, array_remove(ARRAY[
           CASE WHEN d.cale IS NULL THEN 'fara search_path propriu' END,
           CASE WHEN EXISTS (SELECT 1 FROM ag_el e WHERE e.oid = d.oid AND e.nume IS NULL) THEN 'element neanalizabil' END,
           CASE WHEN EXISTS (SELECT 1 FROM ag_el e WHERE e.oid = d.oid AND e.nume = '\$user') THEN 'contine "\$user"' END,
           CASE WHEN d.cale IS NOT NULL AND NOT ((SELECT count(*) FROM ag_el e WHERE e.oid = d.oid AND e.nume = 'pg_temp') = 1
                  AND EXISTS (SELECT 1 FROM ag_el e WHERE e.oid = d.oid AND e.nr = e.ultim AND e.nume = 'pg_temp'))
                THEN 'pg_temp lipseste sau nu e ultimul' END]
         || ARRAY(SELECT 'schema inexistenta ' || quote_ident(e.nume) FROM ag_el e JOIN ag_sch s ON s.nume = e.nume
                   WHERE e.oid = d.oid AND s.nsp IS NULL ORDER BY e.nr)
         || ARRAY(SELECT q.t FROM (SELECT DISTINCT 'CREATE pe ' || quote_ident(c.nume) || ' pentru ' || quote_ident(c.rol) AS t
                                     FROM ag_el e JOIN ag_cr c ON c.nume = e.nume WHERE e.oid = d.oid AND c.motiv IS NULL) q
                   ORDER BY q.t COLLATE "C"), NULL) AS m
    FROM ag_def d
),
ag_det AS (
  SELECT l.tip, l.oid, CASE l.tip WHEN 'f' THEN 'functie ' || l.oid::regprocedure::text ELSE 'relatie ' || l.oid::regclass::text END AS obiect,
         lg.lanname::text AS limbaj, p.prosecdef AS definer,
         EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%') AS are_search_path,
         (lg.lanname IN ('sql', 'plpgsql') AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '[[:<:]]execute[[:>:]]') AS executie_dinamica,
         d.md5_corp,
         CASE WHEN NOT p.prosecdef THEN NULL WHEN cardinality(m.m) = 0 THEN 'sigura'
              WHEN EXISTS (SELECT 1 FROM ag_acc a WHERE a.oid = l.oid AND a.md5 = d.md5_corp) THEN 'acceptata'
              ELSE 'nesigura: ' || array_to_string(m.m, '; ') END AS cale
    FROM (SELECT DISTINCT tip, oid FROM ag_lant) l
    LEFT JOIN pg_proc p ON l.tip = 'f' AND p.oid = l.oid
    LEFT JOIN pg_language lg ON lg.oid = p.prolang
    LEFT JOIN ag_def d ON d.oid = l.oid
    LEFT JOIN ag_motive m ON m.oid = l.oid
),
ag_acc_rau AS (
  SELECT a.nume, CASE WHEN a.oid IS NULL THEN 'functie inexistenta'
                      WHEN NOT EXISTS (SELECT 1 FROM ag_det d WHERE d.tip = 'f' AND d.oid = a.oid) THEN 'nu e in lant'
                      WHEN NOT (SELECT d.definer FROM ag_det d WHERE d.tip = 'f' AND d.oid = a.oid) THEN 'nu e SECURITY DEFINER'
                      WHEN (SELECT d.cale FROM ag_det d WHERE d.tip = 'f' AND d.oid = a.oid) = 'sigura' THEN 'calea e deja sigura'
                      WHEN a.md5 IS DISTINCT FROM (SELECT d.md5_corp FROM ag_det d WHERE d.tip = 'f' AND d.oid = a.oid)
                        THEN 'md5 diferit (corp sau cale schimbate)' END AS motiv
    FROM ag_acc a
)
SELECT y.tip, y.a, y.b, y.c, y.d, y.e FROM (
  SELECT 0 AS o, 'RADACINA_LIPSA' AS tip, r.nume AS a, '-' AS b, '-' AS c, '-' AS d, '-' AS e FROM ag_rad r WHERE r.oid IS NULL
  UNION ALL
  SELECT 1, 'ROL_INCREDERE_LIPSA', i.rol, '-', '-', '-', '-' FROM ag_incr i WHERE NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = i.rol)
  UNION ALL
  SELECT 2, 'ACCEPTARE_INVALIDA', a.nume, '-', a.motiv, '-', '-' FROM ag_acc_rau a WHERE a.motiv IS NOT NULL
  UNION ALL
  SELECT 3, 'LANT', d.tip, d.obiect,
         CASE WHEN d.tip = 'f' THEN concat_ws(' ', 'limbaj=' || d.limbaj, CASE WHEN d.definer THEN 'DEFINER md5=' || d.md5_corp END,
                CASE WHEN NOT d.definer AND NOT d.are_search_path THEN 'search_path=mostenit' END,
                CASE WHEN d.executie_dinamica THEN 'EXECUTE_DINAMIC' END, CASE WHEN d.definer THEN 'cale=' || d.cale END)
              ELSE 'vedere' END, '-', '-'
    FROM ag_det d
  UNION ALL
  SELECT DISTINCT 4, 'INCREDERE', quote_ident(c.nume), quote_ident(c.rol), c.motiv, '-', '-' FROM ag_cr c WHERE c.motiv IS NOT NULL
  UNION ALL
  SELECT 5, 'SEMNALE',
         (SELECT count(*) FROM ag_det d WHERE d.executie_dinamica)::text,
         (SELECT count(*) FROM ag_det d WHERE d.tip = 'v')::text,
         (SELECT count(*) FROM ag_det d WHERE d.tip = 'f' AND d.limbaj NOT IN ('sql', 'plpgsql'))::text,
         (SELECT count(*) FROM ag_det d WHERE d.cale LIKE 'nesigura%')::text,
         (SELECT count(*) FROM ag_det d WHERE d.cale = 'acceptata')::text
) y ORDER BY y.o, y.a COLLATE "C", y.b COLLATE "C", y.c COLLATE "C"
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
  echo "[ok] GENERAT (fara conexiune): $GEN ($(cd "$GEN" && ls | tr '\n' ' '))"
  exit 40
fi

PSQL="${PSQL_BIN:-psql}"
export PGCLIENTENCODING=UTF8
RC=0
( cd "$W" && "$PSQL" -X -v ON_ERROR_STOP=1 -f citire.sql -h "$H" -p "$P" -U "$U" -d "$D" ) >"$W/iesire.txt" 2>"$W/erori.txt" || RC=$?
if [ "$RC" != 0 ]; then
  tr -d '\r' <"$W/iesire.txt"
  sed 's/^/  /' "$W/erori.txt" >&2
  if grep -q 'AG_CITIRE_TINTA_NECONFIRMATA' "$W/erori.txt"; then echo "[x] TINTA NECONFIRMATA (db / system_identifier / in_recovery)" >&2; exit 22; fi
  echo "[x] citirea a esuat (psql $RC), nimic schimbat (tranzactie READ ONLY)" >&2; exit 1
fi
# Momentul fotografiei (now() al tranzactiei unice, in forma text a sesiunii) se tipareste O DATA, pe randul MOMENT (in afara
# partii revizuite). In sectiunea scriptului migrarii se inlocuieste cu marcajul fix "<momentul fotografiei>" DOAR campul
# identificat al antetului standard (forma ceruta scripturilor de amprente: primul SELECT = current_database() AS baza,
# system_identifier AS sistem, version() AS versiune, now() AS la): randul de date de IMEDIAT dupa linia exacta
# "baza | sistem | versiune | la", ultimul camp (dupa ultimul separator " | "), numai daca e EXACT momentul. Orice alta
# aparitie a aceluiasi sir ramane (o valoare reala egala intamplator cu momentul nu devine marcaj); nimic altceva nu se
# normalizeaza (de ex. to_char(statement_timestamp(), ...) din scripturile mai vechi ramane cum e).
tr -d '\r' <"$W/iesire.txt" >"$W/iesire_lf.txt"
[ "$(grep -c $'^MOMENT\t' "$W/iesire_lf.txt" || true)" = 1 ] || { cat "$W/iesire_lf.txt"; echo "[x] randul MOMENT lipsa / repetat" >&2; exit 1; }
AG_MOMENT="$(awk -F'\t' '$1 == "MOMENT" { print $4 }' "$W/iesire_lf.txt")"
[ -n "$AG_MOMENT" ] || { cat "$W/iesire_lf.txt"; echo "[x] randul MOMENT gol" >&2; exit 1; }
AG_MOMENT="$AG_MOMENT" AG_NR="$W/nr_moment" awk '
  BEGIN { m = ENVIRON["AG_MOMENT"]; mk = "<momentul fotografiei>"; suf = " | " m; ls = length(suf); ant = "baza | sistem | versiune | la"; mig = 0; dupa = 0; n = 0 }
  index($0, "=== scriptul de amprente al migrarii ") == 1 { mig = 1; dupa = 0; print; next }
  $0 == "=== sfarsit scriptul de amprente al migrarii ===" { mig = 0; dupa = 0; print; next }
  mig && dupa && length($0) > ls && substr($0, length($0) - ls + 1) == suf { $0 = substr($0, 1, length($0) - ls) " | " mk; n++ }   # M_CIT_MOMENT
  mig { dupa = ($0 == ant) }
  { print }
  END { print n > ENVIRON["AG_NR"] }
' "$W/iesire_lf.txt" >"$W/iesire_norm.txt"
cat "$W/iesire_norm.txt"
OUT="$(cat "$W/iesire_norm.txt")"
grep -qx $'FOTOGRAFIE\t-\t-\taceeasi\t-' <<<"$OUT" || { echo "[x] verificarea fotografiei comune lipseste" >&2; exit 1; }
grep -qE $'^GLOBAL\t-\t-\t[0-9a-f]{32}\t[0-9]+$' <<<"$OUT" || { echo "[x] GLOBAL lipsa / nerecunoscut" >&2; exit 1; }
[ "$(grep -c $'^CONTEXT\t' <<<"$OUT" || true)" = 3 ] || { echo "[x] CONTEXT lipsa / incomplet" >&2; exit 1; }
grep -qx $'VALIDARE\t-\t-\tok\t0' <<<"$OUT" || { echo "[x] VALIDARE esuata (etichete duble / randuri invalide) - nu se foloseste ca baseline" >&2; exit 5; }
if [ ${#RAD[@]} -gt 0 ]; then
  ! grep -q $'^RADACINA_LIPSA\t' <<<"$OUT" || { echo "[x] radacina inexistenta in baza (vezi RADACINA_LIPSA)" >&2; exit 1; }
  ! grep -q $'^ROL_INCREDERE_LIPSA\t' <<<"$OUT" || { echo "[x] --rol-de-incredere: rol inexistent in baza (vezi ROL_INCREDERE_LIPSA)" >&2; exit 2; }
  S="$(grep -E $'^SEMNALE\t' <<<"$OUT")" || { echo "[x] SEMNALE lipsa" >&2; exit 1; }
  IFS=$'\t' read -r _ S_EX S_VED S_LIMB S_NES S_ACC <<<"$S"
  [[ "$S_EX$S_VED$S_LIMB$S_NES$S_ACC" =~ ^[0-9]+$ ]] || { echo "[x] SEMNALE nerecunoscut" >&2; exit 1; }
  N_INCR="$(grep -c $'^INCREDERE\t' <<<"$OUT" || true)"
  echo "SEMNALE (de examinat si acceptat explicit in PR-ul de baseline): EXECUTE dinamic $S_EX, vederi citite $S_VED, alt limbaj $S_LIMB, DEFINER cu cale nesigura $S_NES, DEFINER acceptate explicit $S_ACC; roluri de incredere cu CREATE pe caile DEFINER: $N_INCR (randurile INCREDERE)" >&2
  if grep -q $'^ACCEPTARE_INVALIDA\t' <<<"$OUT"; then
    grep $'^ACCEPTARE_INVALIDA\t' <<<"$OUT" | cut -f2,4 | sed 's/^/  /' >&2
    echo "[x] REFUZ: --definer-verificat invalid (functie inexistenta / din afara lantului / ne-DEFINER / deja sigura / alt md5) - nu se face baseline" >&2; exit 4
  fi
  if [ "$S_NES" != 0 ]; then
    grep $'^LANT\t' <<<"$OUT" | grep 'cale=nesigura' | cut -f3,4 | sed 's/^/  /' >&2
    echo "[x] REFUZ: $S_NES functie(i) SECURITY DEFINER din lant cu search_path nesigur (L15) - nu se face baseline (sau --definer-verificat dupa verificarea corpului)" >&2; exit 4
  fi
fi
if [ -n "$DPL" ]; then
  # detaliul plasei: forma, identitati unice, apoi recalcularea fiecarui rand RAND sistem_initdb din el (o implementare
  # separata a aceleiasi reguli: md5 peste campuri, in ordinea identitatii, unite cu LF; amprenta = md5 de [numar, "md5"])
  [ -f "$W/plasa.txt" ] || { echo "[x] --detalii-plasa: detaliul lipseste din iesirea citirii" >&2; exit 1; }
  tr -d '\r' <"$W/plasa.txt" >"$W/plasa_lf.txt"
  PROB="$(awk -F'\t' 'NF != 4 || $1 !~ /^(functii|relatii)$/ || $2 == "" || $3 !~ /^[0-9a-f]+$/ || length($3) != 32 { print NR; exit }' "$W/plasa_lf.txt")"
  [ -z "$PROB" ] || { echo "[x] --detalii-plasa: linia $PROB nu are forma plasa TAB identitate TAB md5 TAB campuri - fisier nescris" >&2; exit 1; }
  DUPL="$(cut -f1,2 "$W/plasa_lf.txt" | LC_ALL=C sort | uniq -d | head -n 1)"
  [ -z "$DUPL" ] || { echo "[x] --detalii-plasa: identitate dubla ($DUPL) - fisier nescris" >&2; exit 1; }
  REZ_PL=""
  for pl in functii relatii; do
    awk -F'\t' -v p="$pl" '$1 == p' "$W/plasa_lf.txt" | LC_ALL=C sort -t $'\t' -k2,2 >"$W/plasa_$pl.txt"
    N_PL="$(grep -c . "$W/plasa_$pl.txt" || true)"
    M_PL="$(awk -F'\t' 'NR > 1 { printf "\n" } { printf "%s", $4 }' "$W/plasa_$pl.txt" | md5sum | cut -d' ' -f1)"
    A_PL="$(printf '[%s, "%s"]' "$N_PL" "$M_PL" | md5sum | cut -d' ' -f1)"
    R_PL="$(awk -F'\t' -v e="sistem_initdb $pl" '$1 == "RAND" && $2 == "sistem_initdb" && $3 == e { print $4 }' <<<"$OUT")"
    if [ "$N_PL" -gt 0 ] && [ -n "$R_PL" ] && [ "$R_PL" = "$A_PL" ]; then :; else echo "[x] --detalii-plasa: detaliul plasei $pl ($N_PL obiecte) NU reproduce randul RAND sistem_initdb $pl (${R_PL:-lipsa} / $A_PL) - fisier nescris" >&2; exit 1; fi   # M_CIT_PLASA
    REZ_PL="$REZ_PL $pl=$N_PL"
  done
  cp -- "$W/plasa_lf.txt" "$DPL" && chmod 600 "$DPL" || { echo "[x] --detalii-plasa: scrierea $DPL" >&2; exit 3; }
  echo "[ok] detaliul plasei scris in $DPL (${REZ_PL# }); reproduce randurile RAND sistem_initdb" >&2
fi
echo "[ok] citit intr-o singura fotografie (REPEATABLE READ READ ONLY):$(grep -E $'^GLOBAL\t' <<<"$OUT" | cut -f4,5 | tr '\t' ' ') randuri; $(grep -E $'^CONTEXT\t' <<<"$OUT" | cut -f2,4 | tr '\t\n' '= ')MOMENT $AG_MOMENT (inlocuit in sectiunea scriptului migrarii de $(cat "$W/nr_moment" 2>/dev/null || echo '?') ori)" >&2
exit 0
