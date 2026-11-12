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
-- r22: G completata (triggere, politici, DEFAULT-uri, reguli, constrangeri, indecsi, secventa, functiile dependente) =>
--   md5-urile din 12.11 nu mai sunt valabile: lista din 18a e DE_COMPLETAT pana la recitirea G pe productie
--   (scripts/portal/net_rel_completeaza.py le lipeste). N = auditul tranzitiv al apelurilor (sectiune noua, mai jos).
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
--    18a, fn_portal_net_rel_aprobat). Structura = tip, proprietar, ACL, RLS, coloane (nume, tip, NOT NULL, ACL, DEFAULT,
--    IDENTITY, GENERATED), triggere, politici, reguli, constrangeri, indecsi, secventa (parametri + coloana-proprietar),
--    functiile dependente (md5 al definitiei); fara randuri si fara valoarea curenta a secventei.
--    r21: expresia dintre marcajele AMPRENTA_NET_REL e ACEEASI (text identic, testat static) cu corpul lui
--    public.fn_portal_net_rel_amprenta din 18a, rulata cu acelasi search_path (pg_catalog, pg_temp) => md5_amprenta de aici
--    = valoarea pe care o compara poarta. Lista din 18a se schimba DOAR prin review, cu valorile citite aici.
SELECT 'G_amprenta_net' AS sectiune, x.relatie, md5(x.amprenta) AS md5_amprenta, x.amprenta
  FROM (SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) AS relatie,
  -- AMPRENTA_NET_REL inceput
  jsonb_build_array(c.relkind::text, pg_get_userbyid(c.relowner), c.relacl::text, c.relrowsecurity,
    c.relforcerowsecurity,
    (SELECT jsonb_agg(jsonb_build_array(at.attnum, at.attname::text, format_type(at.atttypid, at.atttypmod),
                                        at.attnotnull, at.attacl::text, at.attidentity::text, at.attgenerated::text,
                                        (SELECT pg_get_expr(ad.adbin, ad.adrelid) FROM pg_attrdef ad
                                          WHERE ad.adrelid = at.attrelid AND ad.adnum = at.attnum)) ORDER BY at.attnum)
       FROM pg_attribute at WHERE at.attrelid = c.oid AND at.attnum > 0 AND NOT at.attisdropped),
    (SELECT jsonb_agg(jsonb_build_array(tg.tgname::text, tg.tgenabled::text, tg.tgisinternal, pg_get_triggerdef(tg.oid),
                                        md5(pg_get_functiondef(tg.tgfoid))) ORDER BY tg.tgname::text COLLATE "C")
       FROM pg_trigger tg WHERE tg.tgrelid = c.oid),
    (SELECT jsonb_agg(jsonb_build_array(po.polname::text, po.polcmd::text, po.polpermissive,
                                        (SELECT jsonb_agg(CASE WHEN pr.rol = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(pr.rol) END
                                                          ORDER BY pr.poz)
                                           FROM unnest(po.polroles) WITH ORDINALITY AS pr(rol, poz)),
                                        pg_get_expr(po.polqual, po.polrelid), pg_get_expr(po.polwithcheck, po.polrelid))
                      ORDER BY po.polname::text COLLATE "C")
       FROM pg_policy po WHERE po.polrelid = c.oid),
    (SELECT jsonb_agg(jsonb_build_array(ru.rulename::text, ru.ev_enabled::text, pg_get_ruledef(ru.oid))
                      ORDER BY ru.rulename::text COLLATE "C")
       FROM pg_rewrite ru WHERE ru.ev_class = c.oid),
    (SELECT jsonb_agg(jsonb_build_array(co.conname::text, co.conrelid::regclass::text, co.contype::text, co.condeferrable,
                                        co.condeferred, co.convalidated, pg_get_constraintdef(co.oid))
                      ORDER BY co.conrelid::regclass::text COLLATE "C", co.conname::text COLLATE "C")
       FROM pg_constraint co WHERE co.conrelid = c.oid OR co.confrelid = c.oid),
    (SELECT jsonb_agg(pg_get_indexdef(ix.indexrelid) ORDER BY pg_get_indexdef(ix.indexrelid) COLLATE "C")
       FROM pg_index ix WHERE ix.indrelid = c.oid),
    (SELECT jsonb_build_array(format_type(sq.seqtypid, NULL), sq.seqstart, sq.seqincrement, sq.seqmax, sq.seqmin,
                              sq.seqcache, sq.seqcycle)
       FROM pg_sequence sq WHERE sq.seqrelid = c.oid),
    (SELECT jsonb_agg(jsonb_build_array(dp.deptype::text, dp.refobjid::regclass::text, dp.refobjsubid)
                      ORDER BY dp.refobjid::regclass::text COLLATE "C", dp.refobjsubid)
       FROM pg_depend dp WHERE dp.classid = 'pg_class'::regclass AND dp.objid = c.oid
         AND dp.refclassid = 'pg_class'::regclass AND dp.deptype IN ('a', 'i')),
    (SELECT jsonb_agg(DISTINCT jsonb_build_array(fp.oid::regprocedure::text, fp.prosecdef, pg_get_userbyid(fp.proowner),
                                                 fp.proconfig::text,
                                                 CASE WHEN fp.prokind = 'a' THEN (SELECT md5(ag::text) FROM pg_aggregate ag
                                                                                   WHERE ag.aggfnoid = fp.oid)
                                                      ELSE md5(pg_get_functiondef(fp.oid)) END))
       FROM pg_depend fd JOIN pg_proc fp ON fp.oid = fd.refobjid
      WHERE fd.refclassid = 'pg_proc'::regclass AND fp.oid >= 16384
        AND ((fd.classid = 'pg_trigger'::regclass AND fd.objid IN (SELECT tg.oid FROM pg_trigger tg WHERE tg.tgrelid = c.oid))
          OR (fd.classid = 'pg_policy'::regclass AND fd.objid IN (SELECT po.oid FROM pg_policy po WHERE po.polrelid = c.oid))
          OR (fd.classid = 'pg_attrdef'::regclass AND fd.objid IN (SELECT ad.oid FROM pg_attrdef ad WHERE ad.adrelid = c.oid))
          OR (fd.classid = 'pg_constraint'::regclass AND fd.objid IN (SELECT co.oid FROM pg_constraint co
                                                                       WHERE co.conrelid = c.oid))
          OR (fd.classid = 'pg_rewrite'::regclass AND fd.objid IN (SELECT ru.oid FROM pg_rewrite ru WHERE ru.ev_class = c.oid))
          OR (fd.classid = 'pg_class'::regclass AND fd.objid IN (SELECT ix.indexrelid FROM pg_index ix
                                                                  WHERE ix.indrelid = c.oid)))))::text
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

-- N (r22, Jakarinos r21 P1). AUDITUL TRANZITIV al apelurilor, doar din catalog (fara randuri din tabele de date).
--    Radacini: tot ce poate rula teren = functiile din M (prin PUBLIC; pe productie 21 din public + 12 din net) +
--    fn_teren_eligibil / fn_portal_uid (daca exista: dupa 18a) + relatiile pe care teren le poate scrie (triggerele,
--    DEFAULT-urile, CHECK-urile lor ruleaza la scriere). Graful (supra-aproximare: muchii in plus, niciuna in minus):
--      functie -> functie: fiecare nume urmat de "(" din corp (calificat schema.nume sau necalificat, rezolvat cu
--        search_path-ul functiei + pg_catalog; search_path mostenit = TOATE schemele), toate supraincarcarile; corpurile
--        BEGIN ATOMIC prin pg_depend (exact);
--      functie -> relatie: orice cuvant din corp egal cu numele unei relatii din schemele search_path-ului (sau din orice
--        schema numita in corp; mostenit = toate);
--      relatie -> functie: triggere, politici, DEFAULT, CHECK, indecsi, reguli (pg_depend); relatie -> relatie: vedere ->
--        tabelele citite, FK (stergerea se propaga), mostenire / partitii.
--    Corpurile NU sunt afisate; cuvintele din siruri si comentarii intra si ele (doar muchii in plus). Functiile din
--    pg_catalog sunt capete (incredere in nucleul PostgreSQL), cu exceptia celor care ruleaza / citesc SQL dat ca text sau
--    schimba rezolvarea numelor (query_to_xml, ts_stat, dblink, set_config ... = NEREZOLVAT). Tintele: orice functie /
--    relatie din schema net (net.http_*, coada, raspunsurile, secventa). Limita de adancime declarata: 8 muchii.
--    NEREZOLVAT (listat, nu ignorat): SQL dinamic (cuvantul EXECUTE in corp), corp opac (alt limbaj decat sql / plpgsql,
--    in afara net), apel la un executor de text, adancime depasita. NUME NECUNOSCUT (listat separat): nume urmat de "("
--    care nu e functie, tip, relatie sau cuvant SQL (de regula text din mesaje). Asteptat pe productie:
--    N_audit_cale = 0 randuri; N_audit_nerezolvat = 0 randuri sau lista revizuita. Ce dovedeste si ce NU: E1_RAPORT.md r22.
SET LOCAL statement_timeout = '120s';
WITH RECURSIVE
par AS (SELECT 8 AS adancime_max),
fn AS MATERIALIZED (
  SELECT p.oid, n.nspname::text AS schema, l.lanname::text AS limbaj, p.prosecdef AS definer,
         pg_get_userbyid(p.proowner) AS proprietar, p.proowner = n.nspowner AS proprietar_schema,
         p.prorettype = 'trigger'::regtype AS trigger_fn,
         (SELECT cf.v FROM unnest(p.proconfig) AS cf(v) WHERE cf.v LIKE 'search_path=%' LIMIT 1) AS sp,
         p.prosrc ~* '(^|[^a-z0-9_$])execute([^a-z0-9_$]|$)' AS sql_dinamic,
         EXISTS (SELECT FROM unnest(p.proargtypes::oid[]) AS ta(t)
                  WHERE ta.t IN ('text'::regtype, 'character varying'::regtype, 'bpchar'::regtype, 'name'::regtype,
                                 'json'::regtype, 'jsonb'::regtype, 'anyelement'::regtype, 'unknown'::regtype)) AS primeste_text,
         (SELECT e.extname::text FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
           WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.refclassid = 'pg_extension'::regclass
             AND d.deptype = 'e' LIMIT 1) AS extensie
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_'
),
cale AS MATERIALIZED (
  SELECT f.oid, u.schema
    FROM fn f CROSS JOIN LATERAL unnest(string_to_array(replace(replace(substr(f.sp, 13), ' ', ''), '"', ''), ',')) AS x(s)
         CROSS JOIN LATERAL unnest(CASE WHEN x.s = '$user' THEN ARRAY[f.proprietar, 'teren'] ELSE ARRAY[x.s] END) AS u(schema)
   WHERE f.sp IS NOT NULL
),
apel AS MATERIALIZED (
  SELECT DISTINCT f.oid,
         CASE WHEN m.t[1] IS NULL THEN NULL WHEN left(m.t[1], 1) = '"' THEN btrim(m.t[1], '"') ELSE lower(m.t[1]) END AS q,
         CASE WHEN left(m.t[2], 1) = '"' THEN btrim(m.t[2], '"') ELSE lower(m.t[2]) END AS nume
    FROM fn f JOIN pg_proc p ON p.oid = f.oid
         CROSS JOIN LATERAL regexp_matches(p.prosrc, '(?:([A-Za-z_][A-Za-z0-9_$]*|"[^"]+")[[:space:]]*[.][[:space:]]*)?([A-Za-z_][A-Za-z0-9_$]*|"[^"]+")[[:space:]]*[(]', 'g') AS m(t)
   WHERE f.limbaj IN ('sql', 'plpgsql')
),
cuvant AS MATERIALIZED (
  SELECT DISTINCT f.oid, CASE WHEN left(m.t[1], 1) = '"' THEN btrim(m.t[1], '"') ELSE lower(m.t[1]) END AS nume
    FROM fn f JOIN pg_proc p ON p.oid = f.oid
         CROSS JOIN LATERAL regexp_matches(p.prosrc, '([A-Za-z_][A-Za-z0-9_$]*|"[^"]+")', 'g') AS m(t)
   WHERE f.limbaj IN ('sql', 'plpgsql')
),
rel AS MATERIALIZED (
  SELECT c.oid, n.nspname::text AS schema, c.relname::text AS nume
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') AND n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_'
),
apel_tinta AS MATERIALIZED (
  SELECT a.oid, a.q, a.nume, g.oid AS la
    FROM apel a JOIN fn f ON f.oid = a.oid
         LEFT JOIN LATERAL (SELECT pg.oid FROM pg_proc pg JOIN pg_namespace gn ON gn.oid = pg.pronamespace
                             WHERE pg.proname = a.nume
                               AND ((a.q IS NOT NULL AND gn.nspname = a.q)
                                 OR (a.q IS NULL AND (gn.nspname = 'pg_catalog' OR f.sp IS NULL
                                       OR EXISTS (SELECT FROM cale k WHERE k.oid = a.oid AND k.schema = gn.nspname))))) g
           ON true
),
muchie AS MATERIALIZED (
  SELECT y.dk, y.de, y.lk, y.la, y.prin,
         coalesce((y.lk = 'f' AND EXISTS (SELECT FROM pg_proc pn WHERE pn.oid = y.la AND pn.pronamespace = to_regnamespace('net')))
           OR (y.lk = 'r' AND EXISTS (SELECT FROM pg_class cn WHERE cn.oid = y.la AND cn.relnamespace = to_regnamespace('net'))),
           false) AS lnet
    FROM (SELECT 'f'::text AS dk, t.oid AS de, 'f'::text AS lk, t.la, 'apel'::text AS prin FROM apel_tinta t WHERE t.la IS NOT NULL
          UNION
          SELECT 'f', w.oid, 'r', r.oid, 'relatie'
            FROM cuvant w JOIN fn f ON f.oid = w.oid JOIN rel r ON r.nume = w.nume
           WHERE f.sp IS NULL OR EXISTS (SELECT FROM cale k WHERE k.oid = w.oid AND k.schema = r.schema)
              OR EXISTS (SELECT FROM cuvant w2 WHERE w2.oid = w.oid AND w2.nume = r.schema)
          UNION
          SELECT 'f', d.objid, CASE WHEN d.refclassid = 'pg_proc'::regclass THEN 'f' ELSE 'r' END, d.refobjid, 'dependenta'
            FROM pg_depend d JOIN fn f ON f.oid = d.objid
           WHERE d.classid = 'pg_proc'::regclass AND d.refclassid IN ('pg_proc'::regclass, 'pg_class'::regclass)
             AND d.deptype = 'n'
          UNION
          SELECT 'r', o.relid, 'f', d.refobjid, o.prin
            FROM pg_depend d JOIN (
                   SELECT 'pg_trigger'::regclass AS cls, tg.oid AS obj, tg.tgrelid AS relid, 'trigger'::text AS prin FROM pg_trigger tg
                   UNION ALL SELECT 'pg_policy'::regclass, po.oid, po.polrelid, 'politica' FROM pg_policy po
                   UNION ALL SELECT 'pg_attrdef'::regclass, ad.oid, ad.adrelid, 'default' FROM pg_attrdef ad
                   UNION ALL SELECT 'pg_constraint'::regclass, co.oid, co.conrelid, 'constrangere' FROM pg_constraint co
                              WHERE co.conrelid <> 0
                   UNION ALL SELECT 'pg_rewrite'::regclass, ru.oid, ru.ev_class, 'regula' FROM pg_rewrite ru
                   UNION ALL SELECT 'pg_class'::regclass, ix.indexrelid, ix.indrelid, 'index' FROM pg_index ix) o
                 ON d.classid = o.cls AND d.objid = o.obj
           WHERE d.refclassid = 'pg_proc'::regclass
          UNION
          SELECT 'r', ru.ev_class, 'r', d.refobjid, 'vedere'
            FROM pg_rewrite ru JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = ru.oid
           WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid <> ru.ev_class
          UNION
          SELECT 'r', co.confrelid, 'r', co.conrelid, 'fk' FROM pg_constraint co WHERE co.contype = 'f'
          UNION
          SELECT 'r', ih.inhparent, 'r', ih.inhrelid, 'mostenire' FROM pg_inherits ih) y
),
radacina AS (
  SELECT 'f'::text AS k, f.oid AS id, 'executa'::text AS tip, f.schema = 'net' AS net
    FROM fn f JOIN pg_namespace n ON n.nspname = f.schema
   WHERE has_schema_privilege('public', n.oid, 'USAGE') AND has_function_privilege('public', f.oid, 'EXECUTE')
     AND NOT (f.schema = 'information_schema' AND f.oid < 16384 AND NOT f.definer AND f.proprietar_schema)
  UNION
  SELECT 'f', f.oid, 'portal', false FROM fn f
   WHERE f.oid IN (to_regprocedure('public.fn_teren_eligibil(uuid)'), to_regprocedure('public.fn_portal_uid()'))
  UNION
  SELECT 'r', c.oid, 'scrie', n.nspname = 'net'
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_' AND has_schema_privilege('public', n.oid, 'USAGE')
     AND NOT (n.nspname = 'information_schema' AND c.oid < 16384)
     AND CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
           has_table_privilege('public', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
           OR has_any_column_privilege('public', c.oid, 'INSERT,UPDATE') END
),
atins(k, id, adancime, net) AS (
  SELECT r.k, r.id, 0, r.net FROM radacina r WHERE NOT r.net
  UNION
  SELECT m.lk, m.la, a.adancime + 1, m.lnet
    FROM atins a JOIN muchie m ON m.dk = a.k AND m.de = a.id
   WHERE a.adancime < (SELECT adancime_max FROM par) AND NOT a.net
),
nod AS (
  SELECT a.k, a.id, min(a.adancime) AS adancime, bool_or(a.net) AS net FROM atins a GROUP BY a.k, a.id
  UNION ALL
  SELECT r.k, r.id, 0, true FROM radacina r WHERE r.net AND NOT EXISTS (SELECT FROM atins a WHERE a.k = r.k AND a.id = r.id)
),
eticheta AS (
  SELECT 'f'::text AS k, p.oid AS id,
         quote_ident(n.nspname) || '.' || quote_ident(p.proname) || '(' || oidvectortypes(p.proargtypes) || ')' AS eticheta
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.oid IN (SELECT d.id FROM nod d WHERE d.k = 'f')
  UNION ALL
  SELECT 'r', c.oid, quote_ident(n.nspname) || '.' || quote_ident(c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid IN (SELECT d.id FROM nod d WHERE d.k = 'r')
),
-- distanta pana la net (drum invers, doar prin noduri atinse din afara net)
spre(k, id, dist) AS (
  SELECT d.k, d.id, 0 FROM nod d WHERE d.net AND d.adancime > 0
  UNION
  SELECT m.dk, m.de, s.dist + 1
    FROM spre s JOIN muchie m ON m.lk = s.k AND m.la = s.id JOIN nod x ON x.k = m.dk AND x.id = m.de AND NOT x.net
   WHERE s.dist < (SELECT adancime_max FROM par)
),
dist_net AS (SELECT s.k, s.id, min(s.dist) AS dist FROM spre s GROUP BY s.k, s.id),
-- o cale martor pentru FIECARE radacina din afara net care ajunge la net (cel mai scurt drum, primul in ordine alfabetica)
inainte(rk, rid, k, id, rest, drum) AS (
  SELECT r.k, r.id, r.k, r.id, dn.dist, et.eticheta
    FROM (SELECT DISTINCT r0.k, r0.id FROM radacina r0 WHERE NOT r0.net) r
         JOIN dist_net dn ON dn.k = r.k AND dn.id = r.id JOIN eticheta et ON et.k = r.k AND et.id = r.id
   WHERE dn.dist > 0
  UNION ALL
  SELECT b.rk, b.rid, p.k, p.id, b.rest - 1, b.drum || ' -[' || p.prin || ']-> ' || p.eticheta
    FROM inainte b CROSS JOIN LATERAL (
           SELECT m.lk AS k, m.la AS id, m.prin, et.eticheta
             FROM muchie m JOIN dist_net x ON x.k = m.lk AND x.id = m.la AND x.dist = b.rest - 1
                  JOIN eticheta et ON et.k = m.lk AND et.id = m.la
            WHERE m.dk = b.k AND m.de = b.id
            ORDER BY et.eticheta COLLATE "C", m.prin COLLATE "C" LIMIT 1) p
   WHERE b.rest > 0
),
nerez AS (
  SELECT f.oid, 'SQL dinamic (cuvantul EXECUTE in corp): tinta nu se poate rezolva static' AS motiv
    FROM fn f JOIN nod d ON d.k = 'f' AND d.id = f.oid WHERE f.sql_dinamic AND NOT d.net
  UNION ALL
  SELECT f.oid, 'corp opac: limbaj ' || f.limbaj || coalesce(' (extensia ' || f.extensie || ')', '')
    FROM fn f JOIN nod d ON d.k = 'f' AND d.id = f.oid WHERE f.limbaj NOT IN ('sql', 'plpgsql') AND NOT d.net
  UNION ALL
  SELECT DISTINCT t.oid, 'executa / citeste SQL dat ca text sau schimba rezolvarea numelor: ' || t.nume
    FROM apel_tinta t JOIN nod d ON d.k = 'f' AND d.id = t.oid AND NOT d.net
   WHERE t.nume = ANY ('{query_to_xml,query_to_xmlschema,query_to_xml_and_xmlschema,cursor_to_xml,cursor_to_xmlschema,table_to_xml,table_to_xmlschema,table_to_xml_and_xmlschema,schema_to_xml,schema_to_xmlschema,schema_to_xml_and_xmlschema,database_to_xml,database_to_xmlschema,database_to_xml_and_xmlschema,ts_stat,dblink,dblink_exec,dblink_open,dblink_send_query,crosstab,crosstab2,crosstab3,crosstab4,connectby,xpath_table,set_config}'::text[])
  UNION ALL
  SELECT d.id, 'adancime depasita: are muchii spre noduri neexplorate (limita ' || (SELECT adancime_max FROM par) || ')'
    FROM nod d WHERE d.k = 'f' AND NOT d.net
     AND EXISTS (SELECT FROM muchie m WHERE m.dk = d.k AND m.de = d.id
                    AND NOT EXISTS (SELECT FROM nod d2 WHERE d2.k = m.lk AND d2.id = m.la))
),
necunoscut AS (
  SELECT DISTINCT t.oid, coalesce(t.q || '.', '') || t.nume AS nume
    FROM apel_tinta t JOIN nod d ON d.k = 'f' AND d.id = t.oid AND NOT d.net
   WHERE t.la IS NULL
     AND NOT EXISTS (SELECT FROM pg_type ty WHERE ty.typname = t.nume)
     AND NOT EXISTS (SELECT FROM pg_class cl WHERE cl.relname = t.nume)
     AND NOT (t.nume = ANY ('{if,elsif,in,exists,any,all,some,array,row,values,coalesce,nullif,greatest,least,cast,treat,filter,over,within,grouping,and,or,not,as,on,using,when,then,else,case,where,from,join,select,returning,into,with,union,except,intersect,lateral,table,returns,return,query,while,for,foreach,loop,exit,continue,perform,execute,raise,assert,is,like,ilike,similar,between,distinct,by,partition,order,group,having,limit,offset,window,rows,range,key,primary,unique,check,references,foreign,default,constraint,varying,precision,decimal,dec,float,double,char,character,nchar,national,varchar,numeric,interval,time,timestamp,bit,trim,extract,position,substring,overlay,normalize,xmlelement,xmlforest,xmlattributes,xmlconcat,xmlparse,xmlpi,xmlroot,xmlserialize,xmlexists,xmltable,json,json_object,json_array,json_objectagg,json_arrayagg,json_scalar,json_serialize,json_query,json_value,json_exists,json_table,collate,set,update,insert,delete,merge,do,begin,end,declare,language,function,procedure,trigger,each,statement,new,old,call,elseif,strict,format_type}'::text[]))
)
SELECT z.sectiune, z.obiect, z.adancime, z.security_definer, z.proprietar, z.detaliu
  FROM (
    SELECT 'N_audit_rezumat' AS sectiune, s.cheie AS obiect, NULL::integer AS adancime, NULL::boolean AS security_definer,
           NULL::text AS proprietar, s.valoare AS detaliu, s.ord AS o1, ''::text AS o2
      FROM (VALUES
        (1, 'adancime_max_declarata', (SELECT adancime_max FROM par)::text),
        (2, 'radacini_functii_in_afara_net', (SELECT count(*) FROM radacina r WHERE r.k = 'f' AND NOT r.net)::text),
        (3, 'radacini_functii_net', (SELECT count(*) FROM radacina r WHERE r.k = 'f' AND r.net)::text),
        (4, 'radacini_relatii_scriere', (SELECT count(*) FROM radacina r WHERE r.k = 'r')::text),
        (5, 'noduri_functii', (SELECT count(*) FROM nod d WHERE d.k = 'f')::text),
        (6, 'noduri_relatii', (SELECT count(*) FROM nod d WHERE d.k = 'r')::text),
        (7, 'adancime_atinsa', (SELECT coalesce(max(d.adancime), 0) FROM nod d)::text),
        (8, 'cai_spre_net', (SELECT count(*) FROM inainte b WHERE b.rest = 0)::text),
        (9, 'nerezolvate', (SELECT count(*) FROM nerez)::text),
        (10, 'nume_necunoscute', (SELECT count(*) FROM necunoscut)::text),
        (11, 'search_path_mostenit', (SELECT count(*) FROM fn f JOIN nod d ON d.k = 'f' AND d.id = f.oid
                                       WHERE f.sp IS NULL AND NOT d.net AND f.limbaj IN ('sql', 'plpgsql'))::text),
        (12, 'definer_atinse', (SELECT count(*) FROM fn f JOIN nod d ON d.k = 'f' AND d.id = f.oid WHERE f.definer)::text),
        (13, 'exec_text_apelant', (SELECT count(*) FROM fn f JOIN nod d ON d.k = 'f' AND d.id = f.oid
                                    WHERE f.sql_dinamic AND f.primeste_text AND NOT d.net)::text)) AS s(ord, cheie, valoare)
    UNION ALL
    SELECT 'N_audit_nod', et.eticheta, d.adancime, f.definer, coalesce(f.proprietar, pg_get_userbyid(cr.relowner)),
           CASE WHEN d.k = 'f' THEN
             'tip=functie; schema=' || coalesce(f.schema, 'pg_catalog') || '; limbaj=' || coalesce(f.limbaj, '-')
             || '; search_path=' || CASE WHEN f.oid IS NULL THEN '-' WHEN f.sp IS NULL THEN 'MOSTENIT' ELSE 'fixat' END
             || '; trigger=' || coalesce(f.trigger_fn::text, '-')
             || '; radacina=' || coalesce((SELECT string_agg(r.tip, ',' ORDER BY r.tip COLLATE "C") FROM radacina r
                                            WHERE r.k = d.k AND r.id = d.id), '-')
             || '; apeleaza_net=' || (EXISTS (SELECT FROM muchie m WHERE m.dk = d.k AND m.de = d.id AND m.lk = 'f' AND m.lnet))::text
             || '; atinge_obiect_net=' || coalesce((SELECT string_agg(e2.eticheta, ',' ORDER BY e2.eticheta COLLATE "C")
                                                    FROM muchie m JOIN eticheta e2 ON e2.k = m.lk AND e2.id = m.la
                                                   WHERE m.dk = d.k AND m.de = d.id AND m.lk = 'r' AND m.lnet), '-')
             || '; sql_dinamic=' || coalesce(f.sql_dinamic::text, '-') || '; primeste_text=' || coalesce(f.primeste_text::text, '-')
             || '; exec_text_apelant=' || coalesce((f.sql_dinamic AND f.primeste_text)::text, '-')
             || '; distanta_net=' || coalesce((SELECT dn.dist::text FROM dist_net dn WHERE dn.k = d.k AND dn.id = d.id), '-')
           ELSE 'tip=relatie; relkind=' || coalesce(cr.relkind::text, '-')
             || '; radacina=' || coalesce((SELECT string_agg(r.tip, ',' ORDER BY r.tip COLLATE "C") FROM radacina r
                                            WHERE r.k = d.k AND r.id = d.id), '-')
             || '; distanta_net=' || coalesce((SELECT dn.dist::text FROM dist_net dn WHERE dn.k = d.k AND dn.id = d.id), '-') END,
           100, et.eticheta
      FROM nod d JOIN eticheta et ON et.k = d.k AND et.id = d.id
           LEFT JOIN fn f ON d.k = 'f' AND f.oid = d.id LEFT JOIN pg_class cr ON d.k = 'r' AND cr.oid = d.id
    UNION ALL
    SELECT 'N_audit_cale', b.drum, (SELECT dn.dist FROM dist_net dn WHERE dn.k = b.rk AND dn.id = b.rid), NULL, NULL,
           'radacina=' || (SELECT et.eticheta FROM eticheta et WHERE et.k = b.rk AND et.id = b.rid)
           || '; tip_radacina=' || coalesce((SELECT string_agg(r.tip, ',' ORDER BY r.tip COLLATE "C") FROM radacina r
                                             WHERE r.k = b.rk AND r.id = b.rid), '-')
           || '; radacina_trigger=' || coalesce((SELECT f.trigger_fn::text FROM fn f WHERE b.rk = 'f' AND f.oid = b.rid), '-')
           || '; tinta=' || (SELECT et.eticheta FROM eticheta et WHERE et.k = b.k AND et.id = b.id),
           200, b.drum
      FROM inainte b WHERE b.rest = 0
    UNION ALL
    SELECT 'N_audit_nerezolvat', et.eticheta, d.adancime, f.definer, f.proprietar, x.motiv, 300, et.eticheta || x.motiv
      FROM nerez x JOIN fn f ON f.oid = x.oid JOIN nod d ON d.k = 'f' AND d.id = x.oid
           JOIN eticheta et ON et.k = 'f' AND et.id = x.oid
    UNION ALL
    SELECT 'N_audit_necunoscut', et.eticheta, d.adancime, f.definer, f.proprietar, 'nume urmat de ( fara functie: ' || u.nume,
           400, et.eticheta || u.nume
      FROM necunoscut u JOIN fn f ON f.oid = u.oid JOIN nod d ON d.k = 'f' AND d.id = u.oid
           JOIN eticheta et ON et.k = 'f' AND et.id = u.oid) z
 ORDER BY z.o1, z.o2 COLLATE "C";

ROLLBACK;
