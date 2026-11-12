-- READ ONLY. Portal E1 r20: verificarea portilor 18a + citirile pentru decizia pe tabelele pg_net (doar catalog).
-- Rulare (coordonatorul, pe productie sau pe clona):  psql -X -v ON_ERROR_STOP=1 -f scripts/portal/porti_citire.sql
-- O singura tranzactie BEGIN READ ONLY ... ROLLBACK; nu scrie nimic, nu ia lock-uri pe tabele de aplicatie, nu
-- citeste randuri din tabele de date (nici din coada / raspunsurile pg_net, nici din cron.job: doar nume + adevarat/fals).
-- Iesirea are doar nume de obiecte, roluri, drepturi, numere si md5-uri de structura: fara date personale, fara secrete.
-- Rolul teren nu exista inca; el ajunge la obiecte DOAR prin PUBLIC (NOINHERIT, membru in nimic), deci se intreaba
-- pentru 'public', ca sectiunea 0 din scripts/portal/inventar_prod_e1.sql.
-- r20 fata de interogarile A-D din E1_RAPORT.md r19:
--   A: ORDER BY pe coloana (nu pe pozitie: `ORDER BY 1 COLLATE "C"` = literal intreg, eroare pe productie);
--   B / C: functiile has_*_privilege doar in CASE pe relkind (filtrul pe relkind nu are ordine garantata in WHERE:
--      has_sequence_privilege a primit un index, eroare "is not a sequence" pe productie);
--   D: semnatura construita explicit (nu ::regprocedure, care depinde de search_path), ordonare COLLATE "C".
-- Sectiunile E-L sunt noi (decizia a / b / c din E1_RAPORT.md r20).
-- r21: G = definitia unica a amprentei (aceeasi expresie ca fn_portal_net_rel_amprenta din 18a, intre marcajele
--   AMPRENTA_NET_REL); M = ce functii poate rula teren (doar adevarat / fals, fara corpuri).
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = pg_catalog, pg_temp;

-- A. Schemele la care ajunge teren (prin PUBLIC). Asteptat: exact information_schema, net, public; create_public = false.
SELECT 'A_scheme' AS sectiune, n.nspname::text AS schema, pg_get_userbyid(n.nspowner) AS proprietar,
       has_schema_privilege('public', n.oid, 'CREATE') AS create_public
  FROM pg_namespace n
 WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_' AND has_schema_privilege('public', n.oid, 'USAGE')
 ORDER BY n.nspname::text COLLATE "C";

-- B. Relatii (tabel, vedere, vedere materializata, tabel strain) cu orice drept pentru PUBLIC in acele scheme, fara
--    catalogul standard doar-citire din information_schema. Pe productie (12.11): exact net._http_response si
--    net.http_request_queue. Asteptat dupa decizie: 0 randuri (a / b) sau exact relatiile revizuite (c).
SELECT 'B_relatii' AS sectiune, x.schema, x.relatie, x.tip, x.din_initdb, x.proprietar, x.drepturi, x.drept_scriere
  FROM (SELECT n.nspname::text AS schema, c.relname::text AS relatie, c.relkind::text AS tip, c.oid < 16384 AS din_initdb,
               pg_get_userbyid(c.relowner) AS proprietar, coalesce(c.relacl::text, '(implicit)') AS drepturi,
               CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
                 has_table_privilege('public', c.oid, CASE WHEN current_setting('server_version_num')::int >= 170000
                   THEN 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
                   ELSE 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' END)
                 OR has_any_column_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') END AS orice_drept,
               CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
                 has_table_privilege('public', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                 OR has_any_column_privilege('public', c.oid, 'INSERT,UPDATE,REFERENCES') END AS drept_scriere
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_'
           AND has_schema_privilege('public', n.oid, 'USAGE') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')) x
 WHERE x.orice_drept IS TRUE
   AND NOT (x.schema = 'information_schema' AND x.din_initdb AND x.tip IN ('r', 'v') AND x.drept_scriere IS FALSE)
 ORDER BY x.schema COLLATE "C", x.relatie COLLATE "C";

-- C. Secvente cu drept pentru PUBLIC in acele scheme (+ tabelul care o detine, daca e o coloana serial / identity).
--    Asteptat dupa decizie: 0 randuri (a / b) sau exact secventele revizuite (c).
SELECT 'C_secvente' AS sectiune, x.schema, x.secventa, x.proprietar, x.drepturi, x.a_tabelului
  FROM (SELECT n.nspname::text AS schema, c.relname::text AS secventa, pg_get_userbyid(c.relowner) AS proprietar,
               coalesce(c.relacl::text, '(implicit)') AS drepturi,
               (SELECT string_agg(quote_ident(tn.nspname) || '.' || quote_ident(t.relname), ',')
                  FROM pg_depend d JOIN pg_class t ON t.oid = d.refobjid JOIN pg_namespace tn ON tn.oid = t.relnamespace
                 WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.refclassid = 'pg_class'::regclass
                   AND d.deptype IN ('a', 'i')) AS a_tabelului,
               CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('public', c.oid, 'USAGE,SELECT,UPDATE') END AS orice_drept
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'S' AND n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_'
           AND has_schema_privilege('public', n.oid, 'USAGE')) x
 WHERE x.orice_drept IS TRUE
 ORDER BY x.schema COLLATE "C", x.secventa COLLATE "C";

-- D. Functii executabile prin PUBLIC in afara listelor public (21) / net (12) si a catalogului standard.
--    Asteptat: 0 randuri.
SELECT 'D_functii' AS sectiune, x.schema, x.functie, x.security_definer, x.proprietar, x.din_initdb
  FROM (SELECT n.nspname::text AS schema,
               quote_ident(n.nspname) || '.' || quote_ident(p.proname) || '(' || oidvectortypes(p.proargtypes) || ')' AS functie,
               p.prosecdef AS security_definer, pg_get_userbyid(p.proowner) AS proprietar, p.oid < 16384 AS din_initdb
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_' AND n.nspname NOT IN ('public', 'net')
           AND has_schema_privilege('public', n.oid, 'USAGE') AND has_function_privilege('public', p.oid, 'EXECUTE')
           AND NOT (n.nspname = 'information_schema' AND p.oid < 16384 AND NOT p.prosecdef AND p.proowner = n.nspowner)) x
 ORDER BY x.schema COLLATE "C", x.functie COLLATE "C";

-- D (numar). Control pe listele revizuite in 18a: asteptat public_prin_public = 21 (ca $public_pre$: ACL cu PUBLIC
-- explicit), net_executabile_public = 12, net_security_definer = 0.
SELECT 'D_numar' AS sectiune,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND EXISTS (SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                                 WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS public_prin_public,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'net' AND has_function_privilege('public', p.oid, 'EXECUTE')) AS net_executabile_public,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'net' AND p.prosecdef AND has_function_privilege('public', p.oid, 'EXECUTE')) AS net_security_definer;

-- E. Schema net si extensia pg_net: cine e proprietarul, cine poate retrage drepturi (decizia a / b).
--    poate_* = rolul `postgres` are drept de redistribuire (WITH GRANT OPTION) sau e membru al proprietarului;
--    fals peste tot = un REVOKE dat de postgres nu are efect (PostgreSQL da doar WARNING), il poate face doar proprietarul.
SELECT 'E_net_schema' AS sectiune, n.nspname::text AS schema, pg_get_userbyid(n.nspowner) AS proprietar_schema,
       coalesce(n.nspacl::text, '(implicit)') AS drepturi_schema,
       (SELECT e.extversion FROM pg_extension e WHERE e.extname = 'pg_net') AS pg_net_versiune,
       (SELECT pg_get_userbyid(e.extowner) FROM pg_extension e WHERE e.extname = 'pg_net') AS pg_net_proprietar,
       CASE WHEN to_regrole('postgres') IS NOT NULL THEN pg_has_role('postgres', n.nspowner, 'USAGE') END AS postgres_membru_proprietar,
       CASE WHEN to_regrole('postgres') IS NOT NULL THEN has_schema_privilege('postgres', n.oid, 'USAGE WITH GRANT OPTION') END AS postgres_poate_reda_usage,
       (SELECT ip.initprivs::text FROM pg_init_privs ip
         WHERE ip.objoid = n.oid AND ip.classoid = 'pg_namespace'::regclass AND ip.objsubid = 0) AS drepturi_initiale_extensie,
       current_user::text AS sesiune_rol,
       (SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user) AS sesiune_superuser
  FROM pg_namespace n
 WHERE n.nspname = 'net';

-- F. Drepturile pe FIECARE relatie / secventa din schema net, pe beneficiar (PUBLIC inclus), cu acordantul si daca
--    vin din scriptul extensiei (pg_init_privs = drepturile pe care extensia le pune la creare / actualizare).
--    `*` dupa un drept = cu drept de redistribuire.
SELECT 'F_net_drepturi' AS sectiune, x.relatie, x.tip, x.proprietar, x.beneficiar, x.acordat_de, x.drepturi,
       x.din_extensie_pg_net, x.drepturi_initiale_extensie, x.coloane_cu_drepturi_proprii,
       x.postgres_poate_retrage
  FROM (SELECT c.relname::text AS relatie, c.relkind::text AS tip, pg_get_userbyid(c.relowner) AS proprietar,
               CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS beneficiar,
               pg_get_userbyid(a.grantor) AS acordat_de,
               string_agg(a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END, ',' ORDER BY a.privilege_type) AS drepturi,
               EXISTS (SELECT FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
                        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.refclassid = 'pg_extension'::regclass
                          AND d.deptype = 'e' AND e.extname = 'pg_net') AS din_extensie_pg_net,
               (SELECT ip.initprivs::text FROM pg_init_privs ip
                 WHERE ip.objoid = c.oid AND ip.classoid = 'pg_class'::regclass AND ip.objsubid = 0) AS drepturi_initiale_extensie,
               (SELECT count(*) FROM pg_attribute at
                 WHERE at.attrelid = c.oid AND at.attnum > 0 AND NOT at.attisdropped AND at.attacl IS NOT NULL) AS coloane_cu_drepturi_proprii,
               CASE WHEN to_regrole('postgres') IS NOT NULL THEN pg_has_role('postgres', c.relowner, 'USAGE') END AS postgres_poate_retrage
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault((CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a
         WHERE n.nspname = 'net' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
         GROUP BY c.oid, c.relname, c.relkind, c.relowner, a.grantee, a.grantor) x
 ORDER BY x.relatie COLLATE "C", x.beneficiar COLLATE "C", x.acordat_de COLLATE "C";

-- G. Amprenta de structura a relatiilor / secventelor din net la care ajunge PUBLIC (varianta c: literalii revizuiti din
--    18a, fn_portal_net_rel_aprobat). Structura = tip, proprietar, ACL, RLS, coloane (nume, tip, NOT NULL, ACL); fara
--    randuri. r21: expresia dintre marcajele AMPRENTA_NET_REL e ACEEASI (text identic, testat static) cu corpul lui
--    public.fn_portal_net_rel_amprenta din 18a, rulata cu acelasi search_path (pg_catalog, pg_temp) => md5_amprenta de aici
--    = valoarea pe care o compara poarta. Lista din 18a se schimba DOAR prin review, cu valorile citite aici.
SELECT 'G_amprenta_net' AS sectiune, x.relatie, md5(x.amprenta) AS md5_amprenta, x.amprenta
  FROM (SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) AS relatie,
  -- AMPRENTA_NET_REL inceput
  jsonb_build_array(c.relkind::text, pg_get_userbyid(c.relowner), c.relacl::text, c.relrowsecurity,
                 c.relforcerowsecurity,
                 (SELECT jsonb_agg(jsonb_build_array(at.attnum, at.attname::text, format_type(at.atttypid, at.atttypmod),
                                                     at.attnotnull, at.attacl::text) ORDER BY at.attnum)
                    FROM pg_attribute at WHERE at.attrelid = c.oid AND at.attnum > 0 AND NOT at.attisdropped))::text
  -- AMPRENTA_NET_REL sfarsit
               AS amprenta,
               CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('public', c.oid, 'USAGE,SELECT,UPDATE')
                    WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
                      has_table_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                      OR has_any_column_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') END AS orice_drept
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'net' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')) x
 WHERE x.orice_drept IS TRUE
 ORDER BY x.relatie COLLATE "C";

-- H. Functiile din afara net / catalog care folosesc pg_net (apel http_* sau citire din coada / raspunsuri) sau au net
--    in search_path: ca ce rol ruleaza (security_definer + proprietar) si cine le poate apela. Corpul NU se afiseaza
--    (doar adevarat / fals pe cuvintele cheie). Raspunde la "ce se strica" pentru a / b.
SELECT 'H_functii_net' AS sectiune, x.functie, x.security_definer, x.proprietar, x.trigger_fn, x.nr_triggere,
       x.apel_http, x.citeste_coada, x.citeste_raspunsuri, x.net_in_search_path,
       x.exec_public, x.exec_anon, x.exec_authenticated, x.exec_service_role
  FROM (SELECT quote_ident(n.nspname) || '.' || quote_ident(p.proname) || '(' || oidvectortypes(p.proargtypes) || ')' AS functie,
               p.prosecdef AS security_definer, pg_get_userbyid(p.proowner) AS proprietar,
               p.prorettype = 'trigger'::regtype AS trigger_fn,
               (SELECT count(*) FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS nr_triggere,
               p.prosrc ~ 'net[.]_?http_(get|post|delete)' AS apel_http,
               p.prosrc ~ 'http_request_queue' AS citeste_coada,
               p.prosrc ~ '_http_response|http_collect_response' AS citeste_raspunsuri,
               EXISTS (SELECT FROM unnest(p.proconfig) AS cf(v) WHERE cf.v LIKE 'search_path=%'
                         AND 'net' = ANY (string_to_array(replace(replace(substr(cf.v, 13), ' ', ''), '"', ''), ','))) AS net_in_search_path,
               EXISTS (SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS exec_public,
               CASE WHEN to_regrole('anon') IS NOT NULL THEN has_function_privilege('anon', p.oid, 'EXECUTE') END AS exec_anon,
               CASE WHEN to_regrole('authenticated') IS NOT NULL THEN has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS exec_authenticated,
               CASE WHEN to_regrole('service_role') IS NOT NULL THEN has_function_privilege('service_role', p.oid, 'EXECUTE') END AS exec_service_role
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname NOT IN ('net', 'pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)_'
           AND (p.prosrc ~ 'net[.]|http_request_queue|_http_response|http_collect_response'
                OR EXISTS (SELECT FROM unnest(p.proconfig) AS cf(v) WHERE cf.v LIKE 'search_path=%'
                             AND 'net' = ANY (string_to_array(replace(replace(substr(cf.v, 13), ' ', ''), '"', ''), ','))))) x
 ORDER BY x.functie COLLATE "C";

-- I. Joburile pg_cron vizibile sesiunii (cron.job are RLS: fiecare rol isi vede joburile proprii): rolul cu care
--    ruleaza (username) si daca apeleaza pg_net direct. Comanda NU se afiseaza (poate numi secrete din Vault);
--    doar numele functiilor public.* apelate.
SELECT 'I_cron' AS sectiune, j.jobid, j.jobname::text AS job, j.username::text AS ruleaza_ca, j.active AS activ,
       j.command ~ 'net[.]_?http_(get|post|delete)' AS apel_http_direct,
       j.command ~ 'http_request_queue|_http_response' AS citeste_net_direct,
       (SELECT string_agg(DISTINCT f.m[1], ',' ORDER BY f.m[1]) FROM regexp_matches(j.command, 'public[.]([a-z_][a-z0-9_]*)', 'g') AS f(m)) AS functii_public
  FROM cron.job j
 ORDER BY j.jobid;

-- J. Schemele expuse de PostgREST, daca sunt setate IN baza (setarea rolului authenticator). 0 randuri = setarea vine
--    din configurarea proiectului (panoul Supabase -> API -> Exposed schemas), nu din baza; se verifica separat.
SELECT 'J_postgrest' AS sectiune, r.rolname::text AS rol, coalesce(dbs.datname::text, '(toate bazele)') AS baza, s.cfg AS setare
  FROM pg_db_role_setting rs JOIN pg_roles r ON r.oid = rs.setrole
       LEFT JOIN pg_database dbs ON dbs.oid = rs.setdatabase
       CROSS JOIN LATERAL unnest(rs.setconfig) AS s(cfg)
 WHERE r.rolname = 'authenticator' AND (s.cfg LIKE 'pgrst.db_schemas=%' OR s.cfg LIKE 'pgrst.db_extra_search_path=%')
 ORDER BY s.cfg COLLATE "C";

-- K. Rolurile care se pot loga (deci ar putea rula SQL direct): ajung la coada / raspunsurile pg_net?
--    Raspunde la observatia 3 (expunere reala azi sau igiena). Doar numele rolurilor si adevarat / fals.
SELECT 'K_roluri_login' AS sectiune, r.rolname::text AS rol, r.rolsuper AS superuser, r.rolbypassrls AS bypassrls,
       CASE WHEN to_regclass('net.http_request_queue') IS NOT NULL
            THEN has_table_privilege(r.oid, to_regclass('net.http_request_queue'), 'SELECT') END AS citeste_coada,
       CASE WHEN to_regclass('net._http_response') IS NOT NULL
            THEN has_table_privilege(r.oid, to_regclass('net._http_response'), 'SELECT') END AS citeste_raspunsuri
  FROM pg_roles r
 WHERE r.rolcanlogin
 ORDER BY r.rolname::text COLLATE "C";

-- L. Triggerele (ne-interne) ale caror functie foloseste pg_net, plus webhook-urile bazei (supabase_functions):
--    tabelul pe care sunt, functia, ca ce rol ruleaza functia.
SELECT 'L_triggere_net' AS sectiune, x.tabel, x.trigger_nume, x.functie, x.security_definer, x.proprietar, x.activ
  FROM (SELECT quote_ident(tn.nspname) || '.' || quote_ident(tc.relname) AS tabel, t.tgname::text AS trigger_nume,
               quote_ident(n.nspname) || '.' || quote_ident(p.proname) || '(' || oidvectortypes(p.proargtypes) || ')' AS functie,
               p.prosecdef AS security_definer, pg_get_userbyid(p.proowner) AS proprietar, t.tgenabled::text AS activ
          FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace n ON n.oid = p.pronamespace
               JOIN pg_class tc ON tc.oid = t.tgrelid JOIN pg_namespace tn ON tn.oid = tc.relnamespace
         WHERE NOT t.tgisinternal
           AND (n.nspname = 'supabase_functions'
                OR p.prosrc ~ 'net[.]|http_request_queue|_http_response|http_collect_response')) x
 ORDER BY x.tabel COLLATE "C", x.trigger_nume COLLATE "C";

-- M (r21). Ce poate rula rolul teren: toate functiile executabile prin PUBLIC din schemele la care ajunge, fara catalogul
--    standard. teren nu se poate loga (NOLOGIN); ajunge la SQL doar prin PostgREST, care cheama numai functii din schemele
--    expuse (J + scripts/portal/scheme_expuse.sh). Asteptat: exact cele 21 din public + cele 12 din net (D_numar);
--    security_definer adevarat doar la functii de trigger (nu se pot apela direct); sql_dinamic (cuvantul EXECUTE in corp)
--    fals la toate functiile din public. Corpul NU se afiseaza: doar adevarat / fals.
SELECT 'M_teren_executa' AS sectiune, x.schema, x.functie, x.security_definer, x.trigger_fn, x.sql_dinamic, x.apel_net
  FROM (SELECT n.nspname::text AS schema,
               quote_ident(n.nspname) || '.' || quote_ident(p.proname) || '(' || oidvectortypes(p.proargtypes) || ')' AS functie,
               p.prosecdef AS security_definer, p.prorettype = 'trigger'::regtype AS trigger_fn,
               p.prosrc ~* '(^|[^a-z0-9_])execute([^a-z0-9_]|$)' AS sql_dinamic,
               p.prosrc ~ 'net[.]|http_request_queue|_http_response|http_collect_response' AS apel_net
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_'
           AND has_schema_privilege('public', n.oid, 'USAGE') AND has_function_privilege('public', p.oid, 'EXECUTE')
           AND NOT (n.nspname = 'information_schema' AND p.oid < 16384 AND NOT p.prosecdef AND p.proowner = n.nspowner)) x
 ORDER BY x.schema COLLATE "C", x.functie COLLATE "C";

ROLLBACK;
