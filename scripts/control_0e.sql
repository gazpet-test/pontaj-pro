-- Control 0e (SEC F2) — gate PERMANENT, read-only. Trebuie să întoarcă 0 rânduri după ORICE livrare care creează/modifică
-- funcții, ACL-uri sau obiecte expuse în public/graphql_public (docs/SEC_F1_F2_PATCH.md §8.8). Identic cu precondiția/postcondiția
-- 0e din supabase/migrations/20260930j_sec_f2_profiles_uid_null.sql (harness-ul verifică egalitatea).
-- SEC F2 0e (r8) — invariant de catalog: nicio funcție expusă (public/graphql_public, EXECUTE pentru anon/authenticated) nu poate scrie GUC-urile de identitate și nu interpretează SQL primit ca argument
WITH f AS (
  SELECT p.oid, p.oid::regprocedure::text AS functie, p.prosecdef, md5(p.prosrc) AS md5_src,
         EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c ~* '^(role|session_authorization|request\.jwt[^=]*)=') AS cfg,
         CASE WHEN p.prosqlbody IS NULL THEN p.prosrc ELSE pg_get_function_sqlbody(p.oid) END
           || E'\n ; ' || pg_get_function_arguments(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'graphql_public') AND p.prokind IN ('f', 'p', 'w')
     AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))
), t AS (
  SELECT f.*,
         lower(replace(regexp_replace(regexp_replace(regexp_replace(f.def, '/\*.*?\*/', ' ', 'g'), '/\*.*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g'), '"', ''))
           || ' ; ' || lower(replace(f.def, '"', '')) AS txt
    FROM f
), m AS (
  SELECT t.functie, t.prosecdef, array_remove(ARRAY[
           CASE WHEN t.def IS NULL THEN 'corp necitibil' END,
           CASE WHEN t.cfg THEN 'proconfig' END,
           CASE WHEN t.txt ~ 'set_config' THEN 'set_config' END,
           CASE WHEN t.txt ~ 'request(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*\.(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*jwt' THEN 'request.jwt' END,
           CASE WHEN t.txt ~ 'session(_|\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)+authorization' THEN 'session_authorization' END,
           CASE WHEN t.txt ~ '(^|;|>>|\m(begin|then|else|loop|atomic)\M)(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*(set|reset)\M(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*((session|local)\M(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*)?role\M' THEN 'set/reset role' END,
           CASE WHEN t.txt ~ '\mu&' THEN 'u&' END,
           CASE WHEN t.txt ~ '/\*([^*]|\*+[^*/])*/\*' THEN 'comentariu imbricat' END,
           CASE WHEN t.txt ~ '\m(query_to_xml|query_to_xmlschema|query_to_xml_and_xmlschema|cursor_to_xml|cursor_to_xmlschema|table_to_xml|table_to_xmlschema|table_to_xml_and_xmlschema|schema_to_xml|schema_to_xmlschema|schema_to_xml_and_xmlschema|database_to_xml|database_to_xmlschema|database_to_xml_and_xmlschema|ts_stat|ts_rewrite|crosstab|crosstab2|crosstab3|crosstab4|connectby|dblink|dblink_exec|dblink_open|dblink_send_query|xpath_table)\M' THEN 'interpretor SQL' END,
           CASE WHEN t.txt ~ '\mexecute\M' AND NOT EXISTS (
                  SELECT 1 FROM (VALUES ('public.fn_completare_aplica(bigint,boolean)', '47a7542895c0ce71cb0e44d2c26d0609')) AS w(semnatura, md5_prosrc)
                   WHERE t.prosecdef AND t.oid = to_regprocedure(w.semnatura) AND t.md5_src = w.md5_prosrc) THEN 'execute' END
         ], NULL) AS motive
    FROM t
)
SELECT m.functie, m.prosecdef, array_to_string(m.motive, ',') AS motive
  FROM m
 WHERE cardinality(m.motive) > 0
 ORDER BY 1;
