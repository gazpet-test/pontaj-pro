# shellcheck shell=bash
# ============================================================================
# L15 v2 (13.11.2026, docs/LIVRARE_L15_V2.md): pasii AMPRENTA_GLOBALA ai livrarii. Doar functii (nimic nu ruleaza la
# `source`); folosite de scripts/livrare_migrare.sh (doar cu --amprenta-globala + --diferente-globale), de
# scripts/livrare_l15_manifest.sh (generarea manifestului pe clona, ROLLBACK), de scripts/amprenta_globala_citire.sh
# (citirea coordonatorului) si de scripts/portal/dry_prod_e1.sh (proba cu ROLLBACK). Textul SQL vine DOAR din
# scripts/amprenta_globala_v2.sql (blocurile AG_SESIUNE v2 / AG_CATALOG v2, L19) + fragmentele de mai jos.
#
# Pasii generati (fara backslash, ASCII; in forma "un mesaj" intra in mesajul verificat prin current_query()):
#   2_ag_inainte.sql  (dupa 1_pre = lock consultativ + tinta + istoric + marcaj; INAINTEA artefactului)
#     pg_temp.ag_cat_<T>()      functia SQL STABLE cu blocul AG_CATALOG v2 si GUC-urile canonice pe functie (SET ... la
#                               iesire valorile apelantului revin singure: artefactul nu vede nicio schimbare de sesiune);
#     pg_temp.ag_ses_<T>        tabel temporar: profilul sesiunii (AG_SESIUNE v2), citit in contextul livrarii;
#     pg_temp.ag_inainte_<T>()  calculeaza setul O DATA (CREATE TEMP TABLE ... AS: o singura fotografie), il valideaza
#                               (randuri valide, etichete unice) si compara GLOBAL cu valoarea APROBATA; diferit = refuz cu
#                               md5-ul pe familii in mesaj, inaintea artefactului, nimic schimbat.
#   4_ag_dupa.sql     (dupa 3_inreg; inaintea timpului si a garzii finale)
#     pg_temp.ag_dupa_<T>(manifest)  fotografia de dinainte e intacta (GLOBAL ei = aprobat); recalculeaza setul O DATA;
#                               diferenta rand cu rand (FULL JOIN pe familie + eticheta, IS DISTINCT FROM) trebuie sa fie
#                               EXACT manifestul (familie, eticheta, operatie creat / schimbat / sters, amprenta finala);
#                               orice rand in plus / in minus / cu alta amprenta = refuz, nimic comis. Fara wildcard-uri.
#     DROP pe functiile si tabelele temporare ale pasului (nimic ramas in sesiune).
# <T> = 16 hex aleatoare per livrare (artefactul, fixat inainte, nu poate numi obiectele pasului).
# Familia "sesiune" se citeste O DATA (inainte) si se copiaza in setul de dupa: SET LOCAL-urile artefactului dispar la
# COMMIT (nu sunt stare persistenta); ce persista (ALTER ROLE / DATABASE ... SET) e in familiile rol / setare_rol.
# Modul "-" (generatorul de manifest): fara valoare aprobata, pasii TIPARESC (NOTICE) GLOBAL, contextul (server_version_num,
# rolul), diferenta (L15_DIF) si detaliul canonic al fiecarui rand din ea (L15_DET; la "sters" detaliul de dinainte).
# ============================================================================

AG_V2_FISIER="$(dirname "${BASH_SOURCE[0]}")/amprenta_globala_v2.sql"

# GUC-urile contextului canonic (aceleasi verificate de garda ag_garda din blocul AG_CATALOG v2).
ag_guc_functie() {
  printf "SET quote_all_identifiers = off SET search_path = pg_catalog, pg_temp SET TimeZone = 'UTC' SET DateStyle = 'ISO, YMD'"
  printf " SET IntervalStyle = 'postgres' SET extra_float_digits = 1 SET bytea_output = 'hex' SET standard_conforming_strings = on"
  printf " SET lc_monetary = 'C'"
}
ag_guc_local() {
  printf '%s\n' "SET LOCAL quote_all_identifiers = off;" "SET LOCAL search_path = pg_catalog, pg_temp;" "SET LOCAL TimeZone = 'UTC';" \
    "SET LOCAL DateStyle = 'ISO, YMD';" "SET LOCAL IntervalStyle = 'postgres';" "SET LOCAL extra_float_digits = 1;" \
    "SET LOCAL bytea_output = 'hex';" "SET LOCAL standard_conforming_strings = on;" "SET LOCAL lc_monetary = 'C';"
}

# ag_bloc <MARCAJ> - textul dintre "-- >>> MARCAJ" si "-- <<< MARCAJ" (fiecare EXACT o data, linie intreaga), fara CR.
ag_bloc() {
  local m="$1" a b
  [ -f "$AG_V2_FISIER" ] || { echo "ag_bloc: lipseste $AG_V2_FISIER" >&2; return 3; }
  a="$(tr -d '\r' <"$AG_V2_FISIER" | grep -cxF -- "-- >>> $m" || true)"
  b="$(tr -d '\r' <"$AG_V2_FISIER" | grep -cxF -- "-- <<< $m" || true)"
  [ "$a" = 1 ] && [ "$b" = 1 ] || { echo "ag_bloc: marcajele $m nu apar exact o data ($a / $b)" >&2; return 3; }
  tr -d '\r' <"$AG_V2_FISIER" | awk -v a="-- >>> $m" -v b="-- <<< $m" '$0 == b { p = 0 } p { print } $0 == a { p = 1 }'
}

# ag_sql_global <relatie> - O interogare: global_md5, randuri. Codificare fara ambiguitati: pentru fiecare rand, in ordinea
# (familie, eticheta) COLLATE "C": lungime(familie) ":" familie lungime(eticheta) ":" eticheta amprenta (32 hex).
# Fara operatori (functii calificate), deci nu depinde de search_path. Set gol => global_md5 NULL (refuz la apelant).
ag_sql_global() {
  printf '%s' "SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat(pg_catalog.length(a.familie), ':', a.familie, pg_catalog.length(a.eticheta), ':', a.eticheta, a.amprenta), '' ORDER BY a.familie COLLATE \"C\", a.eticheta COLLATE \"C\")) AS global_md5, pg_catalog.count(*) AS randuri FROM $1 a"
}
# ag_sql_familii <relatie> - md5 pe familie (aceeasi codificare, fara familie), pentru diagnostic: CE familie difera.
ag_sql_familii() {
  printf '%s' "SELECT a.familie, pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat(pg_catalog.length(a.eticheta), ':', a.eticheta, a.amprenta), '' ORDER BY a.eticheta COLLATE \"C\")) AS md5, pg_catalog.count(*) AS randuri FROM $1 a GROUP BY a.familie"
}

# ag_sql_valid <tabel> <moment> - instructiuni plpgsql: randuri valide + etichete unice (altfel FULL JOIN-ul ar fi ambiguu).
ag_sql_valid() {
  local t="$1" mo="$2"
  cat <<SQL
  IF EXISTS (SELECT 1 FROM $t a WHERE a.familie IS NULL OR a.eticheta IS NULL OR a.amprenta IS NULL
               OR a.familie !~ '^[a-z_]+\$' OR a.amprenta !~ '^[0-9a-f]{32}\$') THEN
    RAISE EXCEPTION 'AMPRENTA_GLOBALA_INVALIDA ($mo): rand fara familie / eticheta / amprenta valida - refuz, nimic comis'; END IF;
  SELECT string_agg(z.k, '; ' ORDER BY z.k COLLATE "C") INTO v_f FROM (
    SELECT a.familie || ' / ' || a.eticheta AS k FROM $t a GROUP BY a.familie, a.eticheta HAVING count(*) > 1) z;
  IF v_f IS NOT NULL THEN
    RAISE EXCEPTION 'AMPRENTA_GLOBALA_DUBLURA ($mo): etichete duble (%) - refuz, nimic comis', v_f; END IF;
SQL
}

# ag_tag - 16 hex aleatoare
ag_tag() { od -An -N8 -tx1 /dev/urandom | tr -d ' \n'; }

# ag_inainte <T> <md5_aprobat|-> - fisierul 2_ag_inainte.sql (stdout).
ag_inainte() {
  local T="$1" A="$2" cat_sql ses_sql cmp
  [[ "$T" =~ ^[0-9a-f]{16}$ ]] || { echo "ag_inainte: tag invalid" >&2; return 2; }
  [[ "$A" =~ ^([0-9a-f]{32}|-)$ ]] || { echo "ag_inainte: md5 aprobat invalid" >&2; return 2; }
  cat_sql="$(ag_bloc 'AG_CATALOG v2')" || return 3
  ses_sql="$(ag_bloc 'AG_SESIUNE v2')" || return 3
  if [ "$A" = - ]; then
    cmp="  RAISE NOTICE 'AMPRENTA_GLOBALA_CITITA inainte: % (% randuri), calcul % ms, la % ms de la BEGIN; familii: %', v_g, v_n,
    round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - transaction_timestamp()) * 1000), v_f;
  RAISE NOTICE 'AMPRENTA_GLOBALA_CONTEXT server_version_num % rol %', current_setting('server_version_num'), current_user;"
  else
    cmp="  IF v_g IS DISTINCT FROM '$A' THEN
    RAISE EXCEPTION 'AMPRENTA_GLOBALA_INAINTE: GLOBAL % (% randuri) diferit de cel aprobat $A - catalogul nu mai e cel citit si revizuit (recitire baseline); familii acum: % - refuz inaintea artefactului, nimic comis', coalesce(v_g, 'NULL'), v_n, v_f;
  END IF;
  RAISE NOTICE 'AMPRENTA_GLOBALA inainte: % = aprobat (% randuri), calcul % ms, la % ms de la BEGIN', v_g, v_n,
    round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - transaction_timestamp()) * 1000);"
  fi
  cat <<SQL
CREATE FUNCTION pg_temp.ag_cat_$T() RETURNS TABLE (familie pg_catalog.text, eticheta pg_catalog.text, amprenta pg_catalog.text, detaliu pg_catalog.text)
LANGUAGE sql STABLE $(ag_guc_functie) AS \$ag_cat_$T\$
$cat_sql
\$ag_cat_$T\$;
CREATE TEMP TABLE ag_ses_$T AS
$ses_sql;
CREATE FUNCTION pg_temp.ag_inainte_$T() RETURNS void LANGUAGE plpgsql $(ag_guc_functie) AS \$ag_inainte_$T\$
DECLARE v_g text; v_n bigint; v_f text; v_t0 timestamptz := clock_timestamp();
BEGIN
  CREATE TEMP TABLE ag_ina_$T AS
    SELECT s.familie, s.eticheta, s.amprenta, s.detaliu FROM pg_temp.ag_ses_$T s
    UNION ALL SELECT c.familie, c.eticheta, c.amprenta, c.detaliu FROM pg_temp.ag_cat_$T() c;
$(ag_sql_valid "pg_temp.ag_ina_$T" inainte)
  SELECT g.global_md5, g.randuri INTO v_g, v_n FROM ($(ag_sql_global "pg_temp.ag_ina_$T")) g;
  SELECT string_agg(f.familie || '=' || f.md5 || '/' || f.randuri, ', ' ORDER BY f.familie COLLATE "C") INTO v_f
    FROM ($(ag_sql_familii "pg_temp.ag_ina_$T")) f;
$cmp
END \$ag_inainte_$T\$;
DO \$ag_pas_$T\$ BEGIN PERFORM pg_temp.ag_inainte_$T(); END \$ag_pas_$T\$;
SQL
}

# ag_manifest_valid <fisier> - formatul manifestului, verificat local (inainte de orice conexiune). O linie pe obiect:
#   familie TAB eticheta TAB operatie TAB amprenta   (operatie: creat | schimbat | sters; amprenta: 32 hex, "-" la sters)
# Linii goale si comentarii "#" ignorate; CR final tolerat (checkout Windows). Refuz: alt format, backslash (textul
# runnerului din mesaj nu are backslash-uri), perechi familie + eticheta duble.
ag_manifest_valid() {
  local f="$1" l nr=0 re t=$'\t'
  re="^([a-z_]+)${t}(.+)${t}(creat|schimbat|sters)${t}([0-9a-f]{32}|-)\$"
  [ -f "$f" ] || { echo "manifest: lipseste $f" >&2; return 3; }
  if grep -q '\\' "$f"; then echo "manifest: contine backslash (nepermis)" >&2; return 3; fi
  if LC_ALL=C grep -q $'[\x01-\x08\x0b\x0c\x0e-\x1f]' "$f"; then echo "manifest: caractere de control (in afara de TAB / LF / CR)" >&2; return 3; fi
  while IFS= read -r l || [ -n "$l" ]; do
    nr=$((nr + 1)); l="${l%$'\r'}"
    [ -z "$l" ] || [ "${l:0:1}" = '#' ] && continue
    [[ "$l" =~ $re ]] || { echo "manifest: linia $nr nu are formatul familie TAB eticheta TAB operatie TAB amprenta" >&2; return 3; }
    if [ "${BASH_REMATCH[3]}" = sters ]; then [ "${BASH_REMATCH[4]}" = - ] || { echo "manifest: linia $nr: sters cere amprenta -" >&2; return 3; }
    else [ "${BASH_REMATCH[4]}" != - ] || { echo "manifest: linia $nr: ${BASH_REMATCH[3]} cere amprenta finala" >&2; return 3; }; fi
  done <"$f"
  if [ -n "$(tr -d '\r' <"$f" | grep -v '^#' | grep -v '^$' | awk -F'\t' '{ k = $1; for (i = 2; i <= NF - 2; i++) k = k FS $i; print k }' | sort | uniq -d)" ]; then
    echo "manifest: perechi familie + eticheta duble" >&2; return 3
  fi
}

# ag_dupa <T> <md5_aprobat|-> <manifest|-> - fisierul 4_ag_dupa.sql (stdout). Cu "-" la manifest: TIPARESTE diferenta
# (NOTICE L15_DIF, generatorul de manifest), altfel o compara EXACT cu manifestul.
ag_dupa() {
  local T="$1" A="$2" M="$3" integ man_lit verif
  [[ "$T" =~ ^[0-9a-f]{16}$ ]] || { echo "ag_dupa: tag invalid" >&2; return 2; }
  [[ "$A" =~ ^([0-9a-f]{32}|-)$ ]] || { echo "ag_dupa: md5 aprobat invalid" >&2; return 2; }
  integ=""
  [ "$A" = - ] || integ="  SELECT g.global_md5 INTO v_g FROM ($(ag_sql_global "pg_temp.ag_ina_$T")) g;
  IF v_g IS DISTINCT FROM '$A' THEN
    RAISE EXCEPTION 'AMPRENTA_GLOBALA_DUPA: fotografia de dinainte s-a schimbat in tranzactie (% <> aprobat $A) - refuz, nimic comis', coalesce(v_g, 'NULL'); END IF;"
  if [ "$M" = - ]; then
    man_lit="NULL"
    verif="  IF EXISTS (SELECT 1 FROM pg_temp.ag_dif_$T d WHERE strpos(d.eticheta, chr(10)) > 0 OR strpos(d.eticheta, chr(13)) > 0) THEN
    RAISE EXCEPTION 'AMPRENTA_GLOBALA_DUPA: eticheta cu CR / LF in diferenta - nu se poate scrie in manifest'; END IF;
  FOR r IN SELECT d.familie, d.eticheta, d.operatie, d.amprenta FROM pg_temp.ag_dif_$T d ORDER BY d.familie COLLATE \"C\", d.eticheta COLLATE \"C\" LOOP
    RAISE NOTICE 'L15_DIF %', concat(r.familie, chr(9), r.eticheta, chr(9), r.operatie, chr(9), r.amprenta);
  END LOOP;
  FOR r IN SELECT d.familie, d.eticheta, d.operatie, coalesce(b.detaliu, a.detaliu) AS detaliu
             FROM pg_temp.ag_dif_$T d
             LEFT JOIN pg_temp.ag_dup_$T b ON b.familie = d.familie AND b.eticheta = d.eticheta
             LEFT JOIN pg_temp.ag_ina_$T a ON a.familie = d.familie AND a.eticheta = d.eticheta
            ORDER BY d.familie COLLATE \"C\", d.eticheta COLLATE \"C\" LOOP
    RAISE NOTICE 'L15_DET %', concat(r.familie, chr(9), r.eticheta, chr(9), r.operatie, chr(9), CASE WHEN r.operatie = 'sters' THEN 'inainte' ELSE 'dupa' END, chr(9), r.detaliu);
  END LOOP;
  RAISE NOTICE 'L15_DIF_TOTAL % GLOBAL_DUPA % (% randuri), calcul % ms, la % ms de la BEGIN', v_nd, v_g, v_n,
    round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - transaction_timestamp()) * 1000);"
  else
    ag_manifest_valid "$M" || return 3
    if grep -qF "\$ag_man_$T\$" "$M"; then echo "ag_dupa: tag-ul apare in manifest" >&2; return 3; fi
    man_lit="\$ag_man_$T\$$(cat "$M")\$ag_man_$T\$"
    verif="  CREATE TEMP TABLE ag_man_$T AS
    SELECT x.nr, x.linie, regexp_match(x.linie, concat('^([a-z_]+)', chr(9), '(.+)', chr(9), '(creat|schimbat|sters)', chr(9), '([0-9a-f]{32}|-)\$')) AS m
      FROM regexp_split_to_table(replace(p_manifest, chr(13), ''), chr(10)) WITH ORDINALITY AS x(linie, nr)
     WHERE x.linie <> '' AND left(x.linie, 1) <> '#';
  SELECT string_agg(a.nr::text, ', ' ORDER BY a.nr) INTO v_f FROM pg_temp.ag_man_$T a
   WHERE a.m IS NULL OR (a.m[3] = 'sters') IS DISTINCT FROM (a.m[4] = '-');
  IF v_f IS NOT NULL THEN
    RAISE EXCEPTION 'AMPRENTA_GLOBALA_MANIFEST: linii invalide (%) - refuz, nimic comis', v_f; END IF;
  SELECT string_agg(z.k, '; ' ORDER BY z.k COLLATE \"C\") INTO v_f FROM (
    SELECT a.m[1] || ' / ' || a.m[2] AS k FROM pg_temp.ag_man_$T a GROUP BY a.m[1], a.m[2] HAVING count(*) > 1) z;
  IF v_f IS NOT NULL THEN
    RAISE EXCEPTION 'AMPRENTA_GLOBALA_MANIFEST: perechi duble (%) - refuz, nimic comis', v_f; END IF;
  SELECT count(*), string_agg(z.t, '; ' ORDER BY z.t COLLATE \"C\") INTO v_ne, v_f FROM (
    SELECT CASE WHEN m.familie IS NULL THEN 'NEDECLARAT ' || d.operatie || ' ' || d.eticheta || ' = ' || d.amprenta
                WHEN d.familie IS NULL THEN 'ABSENT ' || m.operatie || ' ' || m.eticheta
                ELSE 'ALTFEL ' || m.eticheta || ' (manifest ' || m.operatie || ' ' || m.amprenta || ', real ' || d.operatie || ' ' || d.amprenta || ')' END AS t
      FROM pg_temp.ag_dif_$T d
      FULL JOIN (SELECT a.m[1] AS familie, a.m[2] AS eticheta, a.m[3] AS operatie, a.m[4] AS amprenta FROM pg_temp.ag_man_$T a) m
        ON m.familie = d.familie AND m.eticheta = d.eticheta
     WHERE d.operatie IS DISTINCT FROM m.operatie OR d.amprenta IS DISTINCT FROM m.amprenta) z;
  IF v_ne > 0 THEN
    RAISE EXCEPTION 'AMPRENTA_GLOBALA_DUPA: % diferente fata de manifest (diferenta reala % randuri) - refuz, nimic comis: %', v_ne, v_nd, v_f; END IF;
  RAISE NOTICE 'AMPRENTA_GLOBALA dupa: % diferente = manifestul; GLOBAL dupa % (% randuri), calcul % ms, la % ms de la BEGIN', v_nd, v_g, v_n,
    round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - transaction_timestamp()) * 1000);"
  fi
  cat <<SQL
CREATE FUNCTION pg_temp.ag_dupa_$T(p_manifest pg_catalog.text) RETURNS void LANGUAGE plpgsql $(ag_guc_functie) AS \$ag_dupa_$T\$
DECLARE v_g text; v_n bigint; v_f text; v_nd bigint; v_ne bigint; v_t0 timestamptz := clock_timestamp(); r record;
BEGIN
$integ
  CREATE TEMP TABLE ag_dup_$T AS
    SELECT s.familie, s.eticheta, s.amprenta, s.detaliu FROM pg_temp.ag_ses_$T s
    UNION ALL SELECT c.familie, c.eticheta, c.amprenta, c.detaliu FROM pg_temp.ag_cat_$T() c;
$(ag_sql_valid "pg_temp.ag_dup_$T" dupa)
  SELECT g.global_md5, g.randuri INTO v_g, v_n FROM ($(ag_sql_global "pg_temp.ag_dup_$T")) g;
  CREATE TEMP TABLE ag_dif_$T AS
    SELECT coalesce(b.familie, a.familie) AS familie, coalesce(b.eticheta, a.eticheta) AS eticheta,
           CASE WHEN a.eticheta IS NULL THEN 'creat' WHEN b.eticheta IS NULL THEN 'sters' ELSE 'schimbat' END AS operatie,
           coalesce(b.amprenta, '-') AS amprenta
      FROM pg_temp.ag_ina_$T a FULL JOIN pg_temp.ag_dup_$T b ON b.familie = a.familie AND b.eticheta = a.eticheta
     WHERE a.amprenta IS DISTINCT FROM b.amprenta;
  SELECT count(*) INTO v_nd FROM pg_temp.ag_dif_$T;
$verif
END \$ag_dupa_$T\$;
DO \$ag_pas_$T\$ BEGIN PERFORM pg_temp.ag_dupa_$T($man_lit); END \$ag_pas_$T\$;
DROP FUNCTION pg_temp.ag_dupa_$T(pg_catalog.text), pg_temp.ag_inainte_$T(), pg_temp.ag_cat_$T();
DROP TABLE pg_temp.ag_ses_$T, pg_temp.ag_ina_$T, pg_temp.ag_dup_$T, pg_temp.ag_dif_$T;
SQL
  [ "$M" = - ] || printf 'DROP TABLE pg_temp.ag_man_%s;\n' "$T"
}
