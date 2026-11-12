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
-- r23: N rescrisa (modelul precis): stare = obiect + rol efectiv + operatie, radacinile = ce poate APELA teren (fara
--   functiile de trigger), muchii numai unde PostgreSQL chiar executa (EXECUTE / drept / operatie / RLS / FK cu CASCADE),
--   fara limita de adancime. D_numar: dupa 18a cu varianta (d) public_prin_public = 0 (inainte: 21).
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
-- explicit), net_executabile_public = 12, net_security_definer = 0. r23: dupa 18a (varianta d) public_prin_public = 0.
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
    -- r25 (Jakarinos r24 P1): mostenire / partitionare. Un copil atasat (INHERITS / ATTACH PARTITION) se citeste PRIN
    -- obiect fara alt drept: forma partitionarii, parintii directi si TOTI urmasii (orice adancime) cu proprietarul,
    -- drepturile si RLS-ul lor. relhassubclass ramane adevarat dupa stergerea copilului pana la primul ANALYZE (zgomot
    -- trecator, spre rosu).
    jsonb_build_array(c.relispartition, c.relhassubclass, pg_get_partkeydef(c.oid), pg_get_expr(c.relpartbound, c.oid)),
    (SELECT jsonb_agg(jsonb_build_array(ih.inhparent::regclass::text, ih.inhseqno) ORDER BY ih.inhseqno)
       FROM pg_inherits ih WHERE ih.inhrelid = c.oid),
    (SELECT jsonb_agg(jsonb_build_array(uc.oid::regclass::text, uc.relkind::text, pg_get_userbyid(uc.relowner), uc.relacl::text,
                                        uc.relispartition, uc.relrowsecurity, uc.relforcerowsecurity)
                      ORDER BY uc.oid::regclass::text COLLATE "C")
       FROM (WITH RECURSIVE urmas(oid) AS (SELECT ih.inhrelid FROM pg_inherits ih WHERE ih.inhparent = c.oid
                                           UNION
                                           SELECT ih.inhrelid FROM urmas u JOIN pg_inherits ih ON ih.inhparent = u.oid)
             SELECT u.oid FROM urmas u) uu JOIN pg_class uc ON uc.oid = uu.oid),
    -- functiile de care depind triggerele / politicile / DEFAULT-urile / constrangerile / regulile / indecsii obiectului
    -- (pg_depend) + r25 INCHIDEREA TRANZITIVA: functiile apelate pe nume din corpul lor (REZOLVARE_APEL, aceeasi ca in
    -- auditul N) si din corpurile BEGIN ATOMIC (pg_depend), pana la capat; fiecare cu definitia, DEFINER, proprietarul,
    -- configuratia si drepturile. Functiile din nucleu (oid < 16384) nu se parcurg.
    (SELECT jsonb_agg(DISTINCT jsonb_build_array(fp.oid::regprocedure::text, fp.prosecdef, pg_get_userbyid(fp.proowner),
                                                 fp.proconfig::text, fp.proacl::text,
                                                 CASE WHEN fp.prokind = 'a' THEN (SELECT md5(ag::text) FROM pg_aggregate ag
                                                                                   WHERE ag.aggfnoid = fp.oid)
                                                      ELSE md5(pg_get_functiondef(fp.oid)) END))
       FROM (WITH RECURSIVE inchidere(oid) AS (
               SELECT fd.refobjid FROM pg_depend fd
                WHERE fd.refclassid = 'pg_proc'::regclass
                  AND ((fd.classid = 'pg_trigger'::regclass AND fd.objid IN (SELECT tg.oid FROM pg_trigger tg WHERE tg.tgrelid = c.oid))
                    OR (fd.classid = 'pg_policy'::regclass AND fd.objid IN (SELECT po.oid FROM pg_policy po WHERE po.polrelid = c.oid))
                    OR (fd.classid = 'pg_attrdef'::regclass AND fd.objid IN (SELECT ad.oid FROM pg_attrdef ad WHERE ad.adrelid = c.oid))
                    OR (fd.classid = 'pg_constraint'::regclass AND fd.objid IN (SELECT co.oid FROM pg_constraint co
                                                                                 WHERE co.conrelid = c.oid))
                    OR (fd.classid = 'pg_rewrite'::regclass AND fd.objid IN (SELECT ru.oid FROM pg_rewrite ru WHERE ru.ev_class = c.oid))
                    OR (fd.classid = 'pg_class'::regclass AND fd.objid IN (SELECT ix.indexrelid FROM pg_index ix
                                                                            WHERE ix.indrelid = c.oid)))
               UNION
               SELECT x.la FROM inchidere i JOIN pg_proc p ON p.oid = i.oid
                      CROSS JOIN LATERAL (
                        SELECT rz.la FROM (
                          -- REZOLVARE_APEL inceput
                          SELECT DISTINCT m.q, m.nume, g.oid AS la
                            FROM (SELECT CASE WHEN r.t[1] IS NULL THEN NULL WHEN left(r.t[1], 1) = '"' THEN btrim(r.t[1], '"')
                                              ELSE lower(r.t[1]) END AS q,
                                         CASE WHEN left(r.t[2], 1) = '"' THEN btrim(r.t[2], '"') ELSE lower(r.t[2]) END AS nume
                                    FROM regexp_matches(p.prosrc, '(?:([A-Za-z_][A-Za-z0-9_$]*|"[^"]+")[[:space:]]*[.][[:space:]]*)?([A-Za-z_][A-Za-z0-9_$]*|"[^"]+")[[:space:]]*[(]', 'g') AS r(t)) m
                                 LEFT JOIN LATERAL (
                                   SELECT pg.oid FROM pg_proc pg JOIN pg_namespace gn ON gn.oid = pg.pronamespace
                                    WHERE pg.proname = m.nume
                                      AND ((m.q IS NOT NULL AND gn.nspname = m.q)
                                        OR (m.q IS NULL AND (gn.nspname = 'pg_catalog'
                                              OR NOT EXISTS (SELECT FROM unnest(p.proconfig) AS sc(v) WHERE sc.v LIKE 'search_path=%')
                                              OR EXISTS (SELECT FROM unnest(p.proconfig) AS sc(v)
                                                           CROSS JOIN LATERAL unnest(string_to_array(replace(replace(substr(sc.v, 13), ' ', ''), '"', ''), ',')) AS ss(s)
                                                          WHERE sc.v LIKE 'search_path=%'
                                                            AND (ss.s = gn.nspname
                                                              OR (ss.s = '$user' AND EXISTS (SELECT FROM pg_roles ro WHERE ro.rolname = gn.nspname)))))))) g
                                   ON true
                          -- REZOLVARE_APEL sfarsit
                          ) rz
                        UNION
                        SELECT dd.refobjid FROM pg_depend dd
                         WHERE dd.classid = 'pg_proc'::regclass AND dd.objid = p.oid AND dd.refclassid = 'pg_proc'::regclass
                           AND dd.deptype = 'n') x
                WHERE i.oid >= 16384 AND x.la IS NOT NULL)
             SELECT i.oid FROM inchidere i) ii JOIN pg_proc fp ON fp.oid = ii.oid
      WHERE fp.oid >= 16384))::text
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

-- N (r23, auditul precis; inlocuieste modelul r22; r25: DOUA roluri pe stare). AUDITUL TRANZITIV al apelurilor, doar din
--    catalog (fara randuri din tabele de date, fara corpuri in iesire). Raspunde la: de la ce poate APELA efectiv teren,
--    exista un drum spre net?
--    STAREA (r25, Jakarinos r24 P1) = (obiect, rol, rx, operatia pe relatie): rol = rolul cu care PostgreSQL verifica
--    drepturile pe relatii si alege politicile RLS (checkAsUser); rx = rolul cu care RULEAZA functiile (current_user, cel
--    verificat la EXECUTE). In interiorul unei functii rol = rx. Ele difera dupa o VEDERE fara security_invoker (relatiile
--    ei se verifica ca proprietarul vederii, dar functiile din ea ruleaza tot ca executantul), dupa o REGULA (relatiile
--    actiunii ca proprietarul relatiei) si dupa o actiune FK in cascada. Tabelul complet (constructie -> rol functie ->
--    rol relatii -> sursa): E1_RAPORT.md r25. r23-r24 dadeau functiilor din vedere rolul proprietarului vederii: fals
--    "0 cai" pe un drum real (contraexemplul recenzentului, testat in audit_tranzitiv_pglite.mjs).
--    rol0 = teren (dupa 18a) sau PUBLIC (inainte: teren nu exista inca si ajunge la obiecte doar prin PUBLIC). Intrarea
--    intr-o functie SECURITY DEFINER schimba ambele roluri in proprietarul ei.
--    RADACINI: functiile pe care rol0 le poate executa (USAGE pe schema + EXECUTE), FARA functiile de trigger (o functie
--      care intoarce trigger nu se poate apela direct: "trigger functions can only be called as triggers"; la declansare
--      PostgreSQL nu verifica EXECUTE) + relatiile pe care rol0 are un drept (citire = politicile, scriere = triggerele).
--      Radacinile din net sunt riscul acceptat (varianta c): listate, nu explorate.
--    MUCHII (fiecare cu motivul ei; supra-aproximare doar unde e scris). Orice functie atinsa altfel decat ca trigger cere
--      EXECUTE pentru rx (PostgreSQL il verifica la fiecare apel, si in vederi, politici, reguli, DEFAULT-uri, GENERATED,
--      CHECK, expresii de index); la declansarea unui trigger NU se verifica EXECUTE:
--      apel: functie -> functie pentru fiecare nume urmat de "(" din corp (REZOLVARE_APEL: calificat sau rezolvat cu
--        search_path-ul functiei + pg_catalog; mostenit = toate schemele; "$user" = orice schema cu nume de rol; toate
--        supraincarcarile) + BEGIN ATOMIC prin pg_depend; tinta nu e de trigger;
--      citire / scriere: functie -> relatie numita in corp (schemele caii sau o schema numita in corp), pentru fiecare
--        operatie al carei cuvant apare in corp (INSERT / MERGE / COPY, UPDATE / MERGE, DELETE / MERGE, TRUNCATE; citirea
--        mereu) si NUMAI daca rolul functiei are dreptul pe relatie pentru acea operatie (altfel: permission denied);
--      trigger: relatie + operatie de scriere -> functia triggerelor ne-interne declansate de acea operatie (tgtype), ca rx
--        (sau proprietarul, daca e DEFINER); la fel triggerele INSTEAD OF ale vederilor;
--      when (r26, Jakarinos r25 P1): relatie + operatie de scriere -> functiile din conditia WHEN a acelorasi triggere
--        (pg_trigger.tgqual, prin pg_depend-ul triggerului, fara functia triggerului). WHEN se evalueaza SEPARAT, inaintea
--        functiei triggerului, ca rx (cine face scrierea), iar PostgreSQL CERE EXECUTE al lui rx pe fiecare functie din ea
--        (spre deosebire de functia triggerului); WHEN nu poate contine subinterogari => doar functii;
--      politica: relatie cu RLS, rol (de verificare) care NU ocoleste RLS (nu e superuser / BYPASSRLS / proprietar fara
--        FORCE), politica pentru PUBLIC sau un rol al lui -> functiile din expresie (ca rx) si relatiile din expresie (ca
--        rol; supra-aproximare: orice comanda, relatiile fara verificarea SELECT);
--      default / generat / constrangere / index: INSERT / UPDATE -> functiile (ca rx) si secventele / relatiile (ca rx,
--        supra-aproximare: fara verificarea dreptului) din DEFAULT, GENERATED, CHECK, expresii de index;
--      vedere: vedere + operatie -> functiile regulii _RETURN ca rx (si cu security_invoker) si relatiile ei ca
--        proprietarul vederii (fara security_invoker) sau ca rx (cu security_invoker, chiar citita dintr-o alta vedere);
--        vederile materializate NU (citirea nu ruleaza interogarea); relatiile fara verificarea dreptului (supra-aprox.);
--      regula: regula ne-SELECT a unei relatii, la operatia ei -> relatiile actiunii (orice operatie, ca proprietarul
--        relatiei) si functiile ei (ca rx) (supra-aproximare pe operatii);
--      fk: stergerea / modificarea parintelui -> scrierea in copil DOAR pentru ON DELETE / ON UPDATE CASCADE, SET NULL,
--        SET DEFAULT: interogarea RI ruleaza ca proprietarul copilului, deci triggerele BEFORE ale copilului ruleaza ca el,
--        iar cele AFTER (puse in coada instructiunii) ca rx => doua stari: (proprietar, proprietar) si (proprietar, rx);
--        TRUNCATE ... CASCADE -> TRUNCATE pe copil (rol, rx). NU sunt muchii (scris): verificarile RI la INSERT / UPDATE in
--        copil (citesc parintele ca proprietarul lui, fara RLS, fara triggere) si NO ACTION / RESTRICT (doar verifica);
--      mostenire: parinte (partitionat sau mostenit) -> copil, aceeasi operatie si aceleasi roluri (drepturile se verifica
--        doar pe parinte).
--    FARA LIMITA DE ADANCIME: inchiderea e completa (UNION pe stari; multimea starilor e finita, ciclurile se opresc
--    singure); distanta pana la net = parcurgere in latime inversa, un strat pe iteratie, pana la stratul gol.
--    TINTE: orice functie / relatie din schema net atinsa cu dreptul cerut. NEREZOLVAT (listat; ESEC al auditului daca nu
--    e gol): SQL dinamic (cuvantul EXECUTE in corp), corp opac (alt limbaj decat sql / plpgsql, in afara net), apel la un
--    executor de text din nucleu. NUME NECUNOSCUT (doar informativ): nume urmat de "(" fara functie, tip sau relatie.
--    Asteptat dupa 18a cu (d): cai_spre_net = 0, nerezolvate = 0, radacini in afara net = fn_teren_eligibil +
--    fn_portal_uid, radacinile net = cele 12 functii + coada, raspunsurile si secventa. Ce NU dovedeste: E1_RAPORT.md r23;
--    expresiile din catalog NEACOPERITE (domenii cu CHECK, operatori, cast-uri / I/O de tip in corpuri text, statistici
--    extinse): E1_RAPORT.md r26.
SET LOCAL statement_timeout = '120s';
WITH RECURSIVE
par AS (SELECT CASE WHEN to_regrole('teren') IS NOT NULL THEN 'teren' ELSE 'public' END AS rol0),
fn AS MATERIALIZED (
  SELECT p.oid, n.nspname::text AS schema, l.lanname::text AS limbaj, p.prosecdef AS definer,
         pg_get_userbyid(p.proowner) AS proprietar, p.proowner = n.nspowner AS proprietar_schema,
         p.prorettype IN ('trigger'::regtype, 'event_trigger'::regtype) AS trigger_fn,
         (SELECT cf.v FROM unnest(p.proconfig) AS cf(v) WHERE cf.v LIKE 'search_path=%' LIMIT 1) AS sp,
         p.prosrc ~* '(^|[^a-z0-9_$])execute([^a-z0-9_$]|$)' AS sql_dinamic,
         p.prosrc ~* '(^|[^a-z0-9_$])(insert|merge|copy)([^a-z0-9_$]|$)' AS cuv_i,
         p.prosrc ~* '(^|[^a-z0-9_$])(update|merge)([^a-z0-9_$]|$)' AS cuv_u,
         p.prosrc ~* '(^|[^a-z0-9_$])(delete|merge)([^a-z0-9_$]|$)' AS cuv_d,
         p.prosrc ~* '(^|[^a-z0-9_$])truncate([^a-z0-9_$]|$)' AS cuv_t,
         EXISTS (SELECT FROM unnest(p.proargtypes::oid[]) AS ta(t)
                  WHERE ta.t IN ('text'::regtype, 'character varying'::regtype, 'bpchar'::regtype, 'name'::regtype,
                                 'json'::regtype, 'jsonb'::regtype, 'anyelement'::regtype, 'unknown'::regtype)) AS primeste_text,
         (SELECT e.extname::text FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
           WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.refclassid = 'pg_extension'::regclass
             AND d.deptype = 'e' LIMIT 1) AS extensie
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_'
),
-- schemele caii unei functii; r25: "$user" = orice schema care poarta numele unui rol (rolul care ruleaza o functie
-- INVOKER poate fi oricare), aceeasi regula ca in REZOLVARE_APEL
cale AS MATERIALIZED (
  SELECT f.oid, u.schema
    FROM fn f CROSS JOIN LATERAL unnest(string_to_array(replace(replace(substr(f.sp, 13), ' ', ''), '"', ''), ',')) AS x(s)
         CROSS JOIN LATERAL (SELECT x.s WHERE x.s <> '$user'
                             UNION SELECT un.nspname::text FROM pg_namespace un JOIN pg_roles ur ON ur.rolname = un.nspname
                                    WHERE x.s = '$user') AS u(schema)
   WHERE f.sp IS NOT NULL
),
cuvant AS MATERIALIZED (
  SELECT DISTINCT f.oid, CASE WHEN left(m.t[1], 1) = '"' THEN btrim(m.t[1], '"') ELSE lower(m.t[1]) END AS nume
    FROM fn f JOIN pg_proc p ON p.oid = f.oid
         CROSS JOIN LATERAL regexp_matches(p.prosrc, '([A-Za-z_][A-Za-z0-9_$]*|"[^"]+")', 'g') AS m(t)
   WHERE f.limbaj IN ('sql', 'plpgsql')
),
rel AS MATERIALIZED (
  SELECT c.oid, n.nspname::text AS schema, c.relname::text AS nume, c.relkind, c.relowner, pg_get_userbyid(c.relowner) AS proprietar,
         c.relrowsecurity, c.relforcerowsecurity,
         EXISTS (SELECT FROM unnest(c.reloptions) AS ro(o)
                  WHERE lower(ro.o) IN ('security_invoker=true', 'security_invoker=on', 'security_invoker=1', 'security_invoker=yes')) AS invoker
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') AND n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_'
),
-- r25 (L19): rezolvarea apelurilor = blocul REZOLVARE_APEL, text IDENTIC cu cel din amprenta pg_net (sectiunea G aici si
-- fn_portal_net_rel_amprenta din 18a, inchiderea tranzitiva a functiilor dependente); testat static.
apel_tinta AS MATERIALIZED (
  SELECT f.oid, x.q, x.nume, x.la
    FROM fn f JOIN pg_proc p ON p.oid = f.oid
         CROSS JOIN LATERAL (
                          -- REZOLVARE_APEL inceput
                          SELECT DISTINCT m.q, m.nume, g.oid AS la
                            FROM (SELECT CASE WHEN r.t[1] IS NULL THEN NULL WHEN left(r.t[1], 1) = '"' THEN btrim(r.t[1], '"')
                                              ELSE lower(r.t[1]) END AS q,
                                         CASE WHEN left(r.t[2], 1) = '"' THEN btrim(r.t[2], '"') ELSE lower(r.t[2]) END AS nume
                                    FROM regexp_matches(p.prosrc, '(?:([A-Za-z_][A-Za-z0-9_$]*|"[^"]+")[[:space:]]*[.][[:space:]]*)?([A-Za-z_][A-Za-z0-9_$]*|"[^"]+")[[:space:]]*[(]', 'g') AS r(t)) m
                                 LEFT JOIN LATERAL (
                                   SELECT pg.oid FROM pg_proc pg JOIN pg_namespace gn ON gn.oid = pg.pronamespace
                                    WHERE pg.proname = m.nume
                                      AND ((m.q IS NOT NULL AND gn.nspname = m.q)
                                        OR (m.q IS NULL AND (gn.nspname = 'pg_catalog'
                                              OR NOT EXISTS (SELECT FROM unnest(p.proconfig) AS sc(v) WHERE sc.v LIKE 'search_path=%')
                                              OR EXISTS (SELECT FROM unnest(p.proconfig) AS sc(v)
                                                           CROSS JOIN LATERAL unnest(string_to_array(replace(replace(substr(sc.v, 13), ' ', ''), '"', ''), ',')) AS ss(s)
                                                          WHERE sc.v LIKE 'search_path=%'
                                                            AND (ss.s = gn.nspname
                                                              OR (ss.s = '$user' AND EXISTS (SELECT FROM pg_roles ro WHERE ro.rolname = gn.nspname)))))))) g
                                   ON true
                          -- REZOLVARE_APEL sfarsit
                          ) x
   WHERE f.limbaj IN ('sql', 'plpgsql')
),
-- rolurile posibile ale unei stari: rol0, proprietarii functiilor DEFINER, proprietarii relatiilor (vederi, actiuni RI)
rol_cand AS MATERIALIZED (
  SELECT x.rol, ro.oid AS roid, coalesce(ro.rolsuper OR ro.rolbypassrls, false) AS ocoleste_rls
    FROM (SELECT rol0 AS rol FROM par
          UNION SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.prosecdef
          UNION SELECT r0.proprietar FROM rel r0) x
         LEFT JOIN pg_roles ro ON ro.rolname = x.rol AND x.rol <> 'public'
),
operatie AS (SELECT o.op FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS o(op)),
-- dreptul unui rol pe o relatie, pe operatie (cele cu drept pe coloane: oricare coloana); secventa = USAGE / SELECT / UPDATE
drept AS MATERIALIZED (
  SELECT r.rol, c.oid, o.op
    FROM rol_cand r CROSS JOIN rel c CROSS JOIN operatie o
   WHERE CASE WHEN c.relkind = 'S' THEN o.op = 'SELECT' AND has_sequence_privilege(r.rol, c.oid, 'USAGE,SELECT,UPDATE')
              WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN has_table_privilege(r.rol, c.oid, o.op)
                OR (o.op IN ('SELECT', 'INSERT', 'UPDATE') AND has_any_column_privilege(r.rol, c.oid, o.op))
              ELSE false END
),
exec AS MATERIALIZED (
  SELECT r.rol, f.oid FROM rol_cand r CROSS JOIN fn f WHERE has_function_privilege(r.rol, f.oid, 'EXECUTE')
),
-- functiile din expresiile atasate relatiilor (politici separat): DEFAULT / GENERATED, CHECK / EXCLUDE, index
atasat AS MATERIALIZED (
  SELECT o.relid, d.refclassid, d.refobjid, o.prin
    FROM pg_depend d JOIN (
           SELECT 'pg_attrdef'::regclass AS cls, ad.oid AS obj, ad.adrelid AS relid, 'default'::text AS prin FROM pg_attrdef ad
           UNION ALL SELECT 'pg_constraint'::regclass, co.oid, co.conrelid, 'constrangere' FROM pg_constraint co
                      WHERE co.conrelid <> 0 AND co.contype IN ('c', 'x')
           UNION ALL SELECT 'pg_class'::regclass, ix.indexrelid, ix.indrelid, 'index' FROM pg_index ix) o
         ON d.classid = o.cls AND d.objid = o.obj
   WHERE d.refclassid IN ('pg_proc'::regclass, 'pg_class'::regclass) AND d.refobjid <> o.relid
),
regula AS MATERIALIZED (
  SELECT ru.ev_class AS relid, ru.ev_type, d.refclassid, d.refobjid
    FROM pg_rewrite ru JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = ru.oid
   WHERE d.refclassid IN ('pg_proc'::regclass, 'pg_class'::regclass) AND d.refobjid <> ru.ev_class AND d.deptype = 'n'
),
-- politicile care se aplica unui rol de verificare: rolul nu ocoleste RLS pe relatie (superuser / BYPASSRLS / proprietar
-- fara FORCE) si politica e pentru PUBLIC sau pentru un rol al lui
pol_rol AS MATERIALIZED (
  SELECT po.oid AS pol, r.rol
    FROM pg_policy po JOIN rel c ON c.oid = po.polrelid CROSS JOIN rol_cand r
   WHERE c.relrowsecurity
     -- PUBLIC nu are OID de rol: comparatia cu proprietarul ar fi NULL (L18) => coalesce la fals (nu ocoleste RLS)
     AND NOT (r.ocoleste_rls OR coalesce(r.roid = c.relowner AND NOT c.relforcerowsecurity, false))
     AND (0 = ANY (po.polroles) OR (r.roid IS NOT NULL AND EXISTS (SELECT FROM unnest(po.polroles) AS pr(x)
                                                                  WHERE pr.x <> 0 AND pg_has_role(r.roid, pr.x, 'MEMBER'))))
),
-- MUCHIILE (r25): sabloane fara roluri; rolurile tintei se calculeaza in recursie din rolurile sursei:
--   mr / mx = cum se obtine rol / rx al tintei: 'R' = rol-ul sursei, 'X' = rx-ul sursei, 'F' = rolul fix rf / xf
--   (proprietarul functiei DEFINER, al vederii, al relatiei cu regula, al copilului FK);
--   cexec = tinta (functie) cere EXECUTE pentru rx-ul sursei; cdrept = tinta (relatie) cere dreptul rol-ului sursei pe
--   operatia lop; cpol = politica trebuie sa se aplice rol-ului sursei (pol_rol). k = 'f' functie / 'r' relatie; op '' la
--   functii.
muchie AS MATERIALIZED (
  SELECT y.dk, y.de, y.dop, y.lk, y.la, y.lop, y.prin, y.mr, y.rf, y.mx, y.xf, y.cexec, y.cdrept, y.cpol,
         coalesce((y.lk = 'f' AND EXISTS (SELECT FROM fn g WHERE g.oid = y.la AND g.schema = 'net'))
           OR (y.lk = 'r' AND EXISTS (SELECT FROM rel cn WHERE cn.oid = y.la AND cn.schema = 'net')), false) AS lnet
    FROM (
      -- apel (corp, REZOLVARE_APEL) si dependenta (BEGIN ATOMIC): EXECUTE al rolului functiei; tinta nu e functie de trigger
      SELECT 'f'::text AS dk, t.oid AS de, ''::text AS dop, 'f'::text AS lk, g.oid AS la, ''::text AS lop, 'apel'::text AS prin,
             CASE WHEN g.definer THEN 'F' ELSE 'X' END AS mr, CASE WHEN g.definer THEN g.proprietar END AS rf,
             CASE WHEN g.definer THEN 'F' ELSE 'X' END AS mx, CASE WHEN g.definer THEN g.proprietar END AS xf,
             true AS cexec, false AS cdrept, NULL::oid AS cpol
        FROM apel_tinta t JOIN fn g ON g.oid = t.la
       WHERE NOT g.trigger_fn
      UNION
      SELECT 'f', d.objid, '', 'f', g.oid, '', 'dependenta',
             CASE WHEN g.definer THEN 'F' ELSE 'X' END, CASE WHEN g.definer THEN g.proprietar END,
             CASE WHEN g.definer THEN 'F' ELSE 'X' END, CASE WHEN g.definer THEN g.proprietar END, true, false, NULL::oid
        FROM pg_depend d JOIN fn f ON f.oid = d.objid JOIN fn g ON g.oid = d.refobjid
       WHERE d.classid = 'pg_proc'::regclass AND d.refclassid = 'pg_proc'::regclass AND d.deptype = 'n' AND NOT g.trigger_fn
      UNION
      -- citire / scriere din corp: relatia numita, operatia al carei cuvant apare, dreptul rolului functiei
      SELECT 'f', w.oid, '', 'r', c.oid, o.op, CASE WHEN o.op = 'SELECT' THEN 'citire' ELSE 'scriere ' || o.op END,
             'X', NULL::text, 'X', NULL::text, false, true, NULL::oid
        FROM cuvant w JOIN fn f ON f.oid = w.oid JOIN rel c ON c.nume = w.nume CROSS JOIN operatie o
       WHERE (f.sp IS NULL OR EXISTS (SELECT FROM cale k WHERE k.oid = w.oid AND k.schema = c.schema)
              OR EXISTS (SELECT FROM cuvant w2 WHERE w2.oid = w.oid AND w2.nume = c.schema))
         AND (o.op = 'SELECT' OR (o.op = 'INSERT' AND f.cuv_i) OR (o.op = 'UPDATE' AND f.cuv_u)
              OR (o.op = 'DELETE' AND f.cuv_d) OR (o.op = 'TRUNCATE' AND f.cuv_t))
      UNION
      SELECT 'f', d.objid, '', 'r', c.oid, o.op, CASE WHEN o.op = 'SELECT' THEN 'citire' ELSE 'scriere ' || o.op END,
             'X', NULL::text, 'X', NULL::text, false, true, NULL::oid
        FROM pg_depend d JOIN fn f ON f.oid = d.objid JOIN rel c ON c.oid = d.refobjid CROSS JOIN operatie o
       WHERE d.classid = 'pg_proc'::regclass AND d.refclassid = 'pg_class'::regclass AND d.deptype = 'n'
      UNION
      -- trigger (si INSTEAD OF pe vederi): operatia de scriere declanseaza triggerele ne-interne ale relatiei (bitii
      -- tgtype); functia ruleaza ca rx (cine face scrierea) sau ca proprietarul (DEFINER); fara EXECUTE la declansare
      SELECT 'r', tg.tgrelid, o.op, 'f', g.oid, '', 'trigger ' || o.op,
             CASE WHEN g.definer THEN 'F' ELSE 'X' END, CASE WHEN g.definer THEN g.proprietar END,
             CASE WHEN g.definer THEN 'F' ELSE 'X' END, CASE WHEN g.definer THEN g.proprietar END, false, false, NULL::oid
        FROM pg_trigger tg JOIN fn g ON g.oid = tg.tgfoid
             CROSS JOIN LATERAL (VALUES ('INSERT', 4), ('DELETE', 8), ('UPDATE', 16), ('TRUNCATE', 32)) AS o(op, bit)
       WHERE NOT tg.tgisinternal AND (tg.tgtype::integer & o.bit) <> 0
      UNION
      -- r26 (Jakarinos r25 P1): conditia WHEN a triggerului = functiile din tgqual (pg_depend al triggerului, fara tgfoid),
      -- la aceleasi operatii ca triggerul; ca rx (sau proprietarul, daca e DEFINER), cu EXECUTE al lui rx (verificat de
      -- PostgreSQL la evaluarea conditiei). Bitii scrisi in alta ordine decat la trigger (textul mutantului ramane unic).
      SELECT 'r', tg.tgrelid, o.op, 'f', g.oid, '', 'when ' || o.op,
             CASE WHEN g.definer THEN 'F' ELSE 'X' END, CASE WHEN g.definer THEN g.proprietar END,
             CASE WHEN g.definer THEN 'F' ELSE 'X' END, CASE WHEN g.definer THEN g.proprietar END, true, false, NULL::oid
        FROM pg_trigger tg
             JOIN pg_depend d ON d.classid = 'pg_trigger'::regclass AND d.objid = tg.oid
                             AND d.refclassid = 'pg_proc'::regclass AND d.refobjid <> tg.tgfoid
             JOIN fn g ON g.oid = d.refobjid
             CROSS JOIN LATERAL (VALUES ('INSERT', 4), ('DELETE', 8), ('UPDATE', 16), ('TRUNCATE', 32)) AS o(op, bit)
       WHERE NOT tg.tgisinternal AND tg.tgqual IS NOT NULL AND (o.bit & tg.tgtype::integer) <> 0
      UNION
      -- politica: aleasa dupa rol (cel de verificare); functiile din expresie ruleaza ca rx (EXECUTE al lui rx), relatiile
      -- din expresie se verifica tot ca rol
      SELECT 'r', po.polrelid, o.op, CASE WHEN d.refclassid = 'pg_proc'::regclass THEN 'f' ELSE 'r' END, d.refobjid,
             CASE WHEN d.refclassid = 'pg_proc'::regclass THEN '' ELSE 'SELECT' END, 'politica',
             CASE WHEN d.refclassid = 'pg_proc'::regclass AND g.definer THEN 'F'
                  WHEN d.refclassid = 'pg_proc'::regclass THEN 'X' ELSE 'R' END,
             CASE WHEN d.refclassid = 'pg_proc'::regclass AND g.definer THEN g.proprietar END,
             CASE WHEN d.refclassid = 'pg_proc'::regclass AND g.definer THEN 'F' ELSE 'X' END,
             CASE WHEN d.refclassid = 'pg_proc'::regclass AND g.definer THEN g.proprietar END,
             d.refclassid = 'pg_proc'::regclass, false, po.oid
        FROM pg_policy po JOIN rel c ON c.oid = po.polrelid
             JOIN pg_depend d ON d.classid = 'pg_policy'::regclass AND d.objid = po.oid
                             AND d.refclassid IN ('pg_proc'::regclass, 'pg_class'::regclass) AND d.refobjid <> po.polrelid
             LEFT JOIN fn g ON d.refclassid = 'pg_proc'::regclass AND g.oid = d.refobjid
             CROSS JOIN operatie o
       WHERE c.relrowsecurity AND o.op <> 'TRUNCATE'
         AND (d.refclassid = 'pg_class'::regclass OR g.oid IS NOT NULL)
      UNION
      -- default / generat / constrangere / index: la INSERT / UPDATE, functiile ca rx (EXECUTE al lui rx), secventele /
      -- relatiile ca rx
      SELECT 'r', a.relid, o.op, CASE WHEN a.refclassid = 'pg_proc'::regclass THEN 'f' ELSE 'r' END, a.refobjid,
             CASE WHEN a.refclassid = 'pg_proc'::regclass THEN '' ELSE 'SELECT' END, a.prin,
             CASE WHEN a.refclassid = 'pg_proc'::regclass AND g.definer THEN 'F' ELSE 'X' END,
             CASE WHEN a.refclassid = 'pg_proc'::regclass AND g.definer THEN g.proprietar END,
             CASE WHEN a.refclassid = 'pg_proc'::regclass AND g.definer THEN 'F' ELSE 'X' END,
             CASE WHEN a.refclassid = 'pg_proc'::regclass AND g.definer THEN g.proprietar END,
             a.refclassid = 'pg_proc'::regclass, false, NULL::oid
        FROM atasat a LEFT JOIN fn g ON a.refclassid = 'pg_proc'::regclass AND g.oid = a.refobjid
             CROSS JOIN operatie o
       WHERE o.op IN ('INSERT', 'UPDATE') AND (a.refclassid = 'pg_class'::regclass OR g.oid IS NOT NULL)
      UNION
      -- vedere (regula _RETURN): functiile ruleaza ca rx (si cu security_invoker; EXECUTE al lui rx); relatiile, aceeasi
      -- operatie, ca proprietarul vederii (fara security_invoker) sau ca rx (cu security_invoker)
      SELECT 'r', c.oid, o.op, CASE WHEN q.refclassid = 'pg_proc'::regclass THEN 'f' ELSE 'r' END, q.refobjid,
             CASE WHEN q.refclassid = 'pg_proc'::regclass THEN '' ELSE o.op END, 'vedere',
             CASE WHEN q.refclassid = 'pg_proc'::regclass AND g.definer THEN 'F'
                  WHEN q.refclassid = 'pg_proc'::regclass OR c.invoker THEN 'X' ELSE 'F' END,
             CASE WHEN q.refclassid = 'pg_proc'::regclass AND g.definer THEN g.proprietar
                  WHEN q.refclassid = 'pg_proc'::regclass OR c.invoker THEN NULL ELSE c.proprietar END,
             CASE WHEN q.refclassid = 'pg_proc'::regclass AND g.definer THEN 'F' ELSE 'X' END,
             CASE WHEN q.refclassid = 'pg_proc'::regclass AND g.definer THEN g.proprietar END,
             q.refclassid = 'pg_proc'::regclass, false, NULL::oid
        FROM rel c JOIN regula q ON q.relid = c.oid AND q.ev_type = '1'
             LEFT JOIN fn g ON q.refclassid = 'pg_proc'::regclass AND g.oid = q.refobjid
             CROSS JOIN operatie o
       WHERE c.relkind = 'v' AND (q.refclassid = 'pg_class'::regclass OR g.oid IS NOT NULL)
      UNION
      -- regula ne-SELECT (2 UPDATE, 3 INSERT, 4 DELETE): relatiile actiunii ca proprietarul relatiei (orice operatie),
      -- functiile actiunii ca rx (EXECUTE al lui rx)
      SELECT 'r', c.oid, o.op, CASE WHEN q.refclassid = 'pg_proc'::regclass THEN 'f' ELSE 'r' END, q.refobjid,
             CASE WHEN q.refclassid = 'pg_proc'::regclass THEN '' ELSE t.op END, 'regula',
             CASE WHEN q.refclassid = 'pg_proc'::regclass AND g.definer THEN 'F'
                  WHEN q.refclassid = 'pg_proc'::regclass THEN 'X' ELSE 'F' END,
             CASE WHEN q.refclassid = 'pg_proc'::regclass AND g.definer THEN g.proprietar
                  WHEN q.refclassid = 'pg_proc'::regclass THEN NULL ELSE c.proprietar END,
             CASE WHEN q.refclassid = 'pg_proc'::regclass AND g.definer THEN 'F' ELSE 'X' END,
             CASE WHEN q.refclassid = 'pg_proc'::regclass AND g.definer THEN g.proprietar END,
             q.refclassid = 'pg_proc'::regclass, false, NULL::oid
        FROM rel c JOIN regula q ON q.relid = c.oid AND q.ev_type IN ('2', '3', '4')
             LEFT JOIN fn g ON q.refclassid = 'pg_proc'::regclass AND g.oid = q.refobjid
             CROSS JOIN LATERAL (VALUES (CASE q.ev_type WHEN '2' THEN 'UPDATE' WHEN '3' THEN 'INSERT' ELSE 'DELETE' END)) AS o(op)
             CROSS JOIN LATERAL (SELECT op FROM operatie WHERE op <> 'TRUNCATE') AS t(op)
       WHERE q.refclassid = 'pg_class'::regclass OR g.oid IS NOT NULL
      UNION
      -- fk: actiunile RI care SCRIU in copil; interogarea RI ruleaza ca proprietarul copilului (triggerele BEFORE ale
      -- copilului ca el), triggerele AFTER ale copilului ruleaza la sfarsitul instructiunii, ca rx => doua stari tinta.
      -- TRUNCATE ... CASCADE: aceleasi roluri.
      SELECT 'r', co.confrelid, x.op, 'r', co.conrelid, x.op2, 'fk ' || x.actiune,
             CASE WHEN x.op = 'TRUNCATE' THEN 'R' ELSE 'F' END, CASE WHEN x.op = 'TRUNCATE' THEN NULL ELSE ch.proprietar END,
             CASE WHEN x.op = 'TRUNCATE' OR v.dupa THEN 'X' ELSE 'F' END,
             CASE WHEN x.op = 'TRUNCATE' OR v.dupa THEN NULL ELSE ch.proprietar END, false, false, NULL::oid
        FROM pg_constraint co JOIN rel ch ON ch.oid = co.conrelid
             CROSS JOIN LATERAL (VALUES
               ('DELETE', CASE co.confdeltype WHEN 'c' THEN 'DELETE' WHEN 'n' THEN 'UPDATE' WHEN 'd' THEN 'UPDATE' END,
                'la stergere ' || co.confdeltype::text),
               ('UPDATE', CASE WHEN co.confupdtype IN ('c', 'n', 'd') THEN 'UPDATE' END, 'la modificare ' || co.confupdtype::text),
               ('TRUNCATE', 'TRUNCATE', 'cascade')) AS x(op, op2, actiune)
             CROSS JOIN (VALUES (false), (true)) AS v(dupa)
       WHERE co.contype = 'f' AND x.op2 IS NOT NULL
      UNION
      -- mostenire / partitii: aceeasi operatie, aceleasi roluri
      SELECT 'r', ih.inhparent, o.op, 'r', ih.inhrelid, o.op, 'mostenire', 'R', NULL::text, 'X', NULL::text, false, false, NULL::oid
        FROM pg_inherits ih CROSS JOIN operatie o) y
),
radacina AS MATERIALIZED (
  SELECT 'f'::text AS k, f.oid AS id, CASE WHEN f.definer THEN f.proprietar ELSE (SELECT rol0 FROM par) END AS rol,
         ''::text AS op, f.schema = 'net' AS net
    FROM fn f JOIN pg_namespace n ON n.nspname = f.schema
   WHERE has_schema_privilege((SELECT rol0 FROM par), n.oid, 'USAGE')
     AND has_function_privilege((SELECT rol0 FROM par), f.oid, 'EXECUTE') AND NOT f.trigger_fn
     AND NOT (f.schema = 'information_schema' AND f.oid < 16384 AND NOT f.definer AND f.proprietar_schema)
  UNION
  SELECT 'r', c.oid, dr.rol, dr.op, c.schema = 'net'
    FROM rel c JOIN pg_namespace n ON n.nspname = c.schema JOIN drept dr ON dr.oid = c.oid AND dr.rol = (SELECT rol0 FROM par)
   WHERE has_schema_privilege((SELECT rol0 FROM par), n.oid, 'USAGE') AND NOT (c.schema = 'information_schema' AND c.oid < 16384)
),
-- functiile executabile de rol0 care NU sunt radacini (de trigger): numarate si listate, ca omul sa vada ce s-a exclus
trigger_exclus AS (
  SELECT f.oid FROM fn f JOIN pg_namespace n ON n.nspname = f.schema
   WHERE has_schema_privilege((SELECT rol0 FROM par), n.oid, 'USAGE')
     AND has_function_privilege((SELECT rol0 FROM par), f.oid, 'EXECUTE') AND f.trigger_fn
),
-- inchiderea completa (fara limita); nodurile din net sunt capete (tinte), nu se exploreaza mai departe. r25: fiecare rand
-- poarta si cheia starii din care s-a ajuns (de_cheie) + motivul muchiei; UNION pe tot randul => fiecare stare e extinsa o
-- data pentru fiecare muchie noua care ajunge la ea, multimea e finita, ciclurile se opresc singure.
atins(k, id, rol, rx, op, net, de_cheie, prin) AS (
  SELECT r.k, r.id, r.rol, r.rol, r.op, false, NULL::text, NULL::text FROM radacina r WHERE NOT r.net
  UNION
  SELECT m.lk, m.la, t.rol, t.rx, m.lop, m.lnet,
         (a.k || ':' || a.id::text || ':' || a.rol || ':' || a.rx || ':' || a.op) COLLATE "default", m.prin
    FROM atins a JOIN muchie m ON m.dk = a.k AND m.de = a.id AND m.dop = a.op
         CROSS JOIN LATERAL (SELECT CASE m.mr WHEN 'R' THEN a.rol WHEN 'X' THEN a.rx ELSE m.rf END AS rol,
                                    CASE m.mx WHEN 'R' THEN a.rol WHEN 'X' THEN a.rx ELSE m.xf END AS rx) t
   WHERE NOT a.net
     AND (NOT m.cexec OR EXISTS (SELECT FROM exec x WHERE x.oid = m.la AND x.rol = a.rx))
     AND (NOT m.cdrept OR EXISTS (SELECT FROM drept dr WHERE dr.oid = m.la AND dr.op = m.lop AND dr.rol = a.rol))
     AND (m.cpol IS NULL OR EXISTS (SELECT FROM pol_rol pr WHERE pr.pol = m.cpol AND pr.rol = a.rol))
),
stare AS MATERIALIZED (
  SELECT DISTINCT a.k, a.id, a.rol, a.rx, a.op, a.net,
         a.k || ':' || a.id::text || ':' || a.rol || ':' || a.rx || ':' || a.op AS cheie FROM atins a
),
eticheta AS MATERIALIZED (
  SELECT 'f'::text AS k, p.oid AS id,
         quote_ident(n.nspname) || '.' || quote_ident(p.proname) || '(' || oidvectortypes(p.proargtypes) || ')' AS eticheta
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.oid IN (SELECT s.id FROM stare s WHERE s.k = 'f' UNION SELECT r.id FROM radacina r WHERE r.k = 'f'
                   UNION SELECT t.oid FROM trigger_exclus t)
  UNION ALL
  SELECT 'r', c.oid, quote_ident(c.schema) || '.' || quote_ident(c.nume)
    FROM rel c WHERE c.oid IN (SELECT s.id FROM stare s WHERE s.k = 'r' UNION SELECT r.id FROM radacina r WHERE r.k = 'r')
),
-- muchiile dintre starile atinse: exact cele parcurse de recursie (de_cheie -> starea), cu motivul
mr AS MATERIALIZED (
  SELECT DISTINCT a.de_cheie, a.k || ':' || a.id::text || ':' || a.rol || ':' || a.rx || ':' || a.op AS la_cheie, a.prin
    FROM atins a WHERE a.de_cheie IS NOT NULL
),
-- distanta pana la net: parcurgere in latime INVERSA, un strat pe iteratie (vizitate + frontiera), pana la stratul gol
latime(vizitate, frontiera, pas) AS (
  SELECT coalesce(array_agg(s.cheie), '{}'::text[]), coalesce(array_agg(s.cheie), '{}'::text[]), 0 FROM stare s WHERE s.net
  UNION ALL
  SELECT l.vizitate || nou.chei, nou.chei, l.pas + 1
    FROM latime l CROSS JOIN LATERAL (SELECT array_agg(DISTINCT x.de_cheie) AS chei FROM mr x
                                       WHERE x.la_cheie = ANY (l.frontiera) AND x.de_cheie <> ALL (l.vizitate)) nou
   WHERE nou.chei IS NOT NULL
),
dist_net AS MATERIALIZED (
  SELECT u.cheie, min(l.pas) AS dist FROM latime l CROSS JOIN LATERAL unnest(l.frontiera) AS u(cheie) GROUP BY u.cheie
),
eticheta_stare AS MATERIALIZED (
  -- r25: {rol} cand rol = rx; {rol; exec rx} cand relatiile se verifica ca rol, iar functiile ruleaza ca rx
  SELECT s.cheie, s.k, s.id, s.rol, s.op,
         e.eticheta || CASE WHEN s.k = 'r' THEN ' [' || s.op || ']' ELSE '' END
         || ' {' || s.rol || CASE WHEN s.rx <> s.rol THEN '; exec ' || s.rx ELSE '' END || '}' AS et
    FROM stare s JOIN eticheta e ON e.k = s.k AND e.id = s.id
),
-- o cale martor pentru FIECARE radacina din afara net care ajunge la net (cel mai scurt drum, primul in ordine alfabetica)
inainte(rcheie, cheie, rest, drum) AS (
  SELECT es.cheie, es.cheie, dn.dist, es.et
    FROM (SELECT DISTINCT r.k || ':' || r.id::text || ':' || r.rol || ':' || r.rol || ':' || r.op AS cheie
            FROM radacina r WHERE NOT r.net) rc
         JOIN dist_net dn ON dn.cheie = rc.cheie JOIN eticheta_stare es ON es.cheie = rc.cheie
   WHERE dn.dist > 0
  UNION ALL
  SELECT b.rcheie, p.la_cheie, b.rest - 1, b.drum || ' -[' || p.prin || ']-> ' || p.et
    FROM inainte b CROSS JOIN LATERAL (
           SELECT x.la_cheie, x.prin, es.et
             FROM mr x JOIN dist_net dn ON dn.cheie = x.la_cheie AND dn.dist = b.rest - 1
                  JOIN eticheta_stare es ON es.cheie = x.la_cheie
            WHERE x.de_cheie = b.cheie
            ORDER BY es.et COLLATE "C", x.prin COLLATE "C" LIMIT 1) p
   WHERE b.rest > 0
),
nod AS MATERIALIZED (
  SELECT s.k, s.id, bool_or(s.net) AS net,
         string_agg(DISTINCT s.rol || CASE WHEN s.rx <> s.rol THEN '/exec ' || s.rx ELSE '' END, ','
                    ORDER BY s.rol || CASE WHEN s.rx <> s.rol THEN '/exec ' || s.rx ELSE '' END) AS roluri,
         string_agg(DISTINCT nullif(s.op, ''), ',' ORDER BY nullif(s.op, '')) AS operatii,
         min(dn.dist) AS dist
    FROM stare s LEFT JOIN dist_net dn ON dn.cheie = s.cheie GROUP BY s.k, s.id
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
        (1, 'model', 'r26: stare = obiect + rol de verificare + rol de executie + operatie; fara limita de adancime; + conditia WHEN a triggerelor'),
        (2, 'rol_radacina', (SELECT rol0 FROM par)),
        (3, 'radacini_functii_in_afara_net', (SELECT count(*) FROM radacina r WHERE r.k = 'f' AND NOT r.net)::text),
        (4, 'radacini_functii_net', (SELECT count(*) FROM radacina r WHERE r.k = 'f' AND r.net)::text),
        (5, 'radacini_relatii_in_afara_net', (SELECT count(DISTINCT r.id) FROM radacina r WHERE r.k = 'r' AND NOT r.net)::text),
        (6, 'radacini_relatii_net', (SELECT count(DISTINCT r.id) FROM radacina r WHERE r.k = 'r' AND r.net)::text),
        (7, 'functii_trigger_excluse', (SELECT count(*) FROM trigger_exclus)::text),
        (8, 'stari_atinse', (SELECT count(*) FROM stare)::text),
        (9, 'noduri_functii', (SELECT count(*) FROM nod d WHERE d.k = 'f')::text),
        (10, 'noduri_relatii', (SELECT count(*) FROM nod d WHERE d.k = 'r')::text),
        (11, 'pasi_maxim_spre_net', (SELECT coalesce(max(dn.dist), 0) FROM dist_net dn)::text),
        (12, 'cai_spre_net', (SELECT count(*) FROM inainte b WHERE b.rest = 0)::text),
        (13, 'nerezolvate', (SELECT count(*) FROM nerez)::text),
        (14, 'nume_necunoscute', (SELECT count(*) FROM necunoscut)::text),
        (15, 'search_path_mostenit', (SELECT count(*) FROM fn f JOIN nod d ON d.k = 'f' AND d.id = f.oid
                                       WHERE f.sp IS NULL AND NOT d.net AND f.limbaj IN ('sql', 'plpgsql'))::text),
        (16, 'definer_atinse', (SELECT count(*) FROM fn f JOIN nod d ON d.k = 'f' AND d.id = f.oid WHERE f.definer)::text),
        (17, 'exec_text_apelant', (SELECT count(*) FROM fn f JOIN nod d ON d.k = 'f' AND d.id = f.oid
                                    WHERE f.sql_dinamic AND f.primeste_text AND NOT d.net)::text)) AS s(ord, cheie, valoare)
    UNION ALL
    SELECT 'N_audit_radacina', et.eticheta, NULL, f.definer, coalesce(f.proprietar, c.proprietar),
           'tip=' || CASE WHEN r.k = 'f' THEN 'functie' ELSE 'relatie' END || '; net=' || bool_or(r.net)::text
           || '; ruleaza_ca=' || string_agg(DISTINCT r.rol, ',' ORDER BY r.rol)
           || '; operatii=' || coalesce(string_agg(DISTINCT nullif(r.op, ''), ',' ORDER BY nullif(r.op, '')), '-'),
           50, et.eticheta
      FROM radacina r JOIN eticheta et ON et.k = r.k AND et.id = r.id
           LEFT JOIN fn f ON r.k = 'f' AND f.oid = r.id LEFT JOIN rel c ON r.k = 'r' AND c.oid = r.id
     GROUP BY r.k, et.eticheta, f.definer, f.proprietar, c.proprietar
    UNION ALL
    SELECT 'N_audit_trigger_exclus', et.eticheta, NULL, f.definer, f.proprietar,
           'functie de trigger executabila de ' || (SELECT rol0 FROM par) || ': nu se poate apela direct, nu e radacina',
           60, et.eticheta
      FROM trigger_exclus t JOIN fn f ON f.oid = t.oid JOIN eticheta et ON et.k = 'f' AND et.id = t.oid
    UNION ALL
    SELECT 'N_audit_nod', et.eticheta, d.dist, f.definer, coalesce(f.proprietar, c.proprietar),
           CASE WHEN d.k = 'f' THEN
             'tip=functie; schema=' || f.schema || '; limbaj=' || f.limbaj
             || '; search_path=' || CASE WHEN f.sp IS NULL THEN 'MOSTENIT' ELSE 'fixat' END
             || '; trigger=' || f.trigger_fn::text || '; net=' || d.net::text || '; ruleaza_ca=' || d.roluri
             || '; sql_dinamic=' || f.sql_dinamic::text || '; primeste_text=' || f.primeste_text::text
             || '; distanta_net=' || coalesce(d.dist::text, '-')
           ELSE 'tip=relatie; relkind=' || c.relkind::text || '; net=' || d.net::text || '; ruleaza_ca=' || d.roluri
             || '; operatii=' || coalesce(d.operatii, '-') || '; distanta_net=' || coalesce(d.dist::text, '-') END,
           100, et.eticheta
      FROM nod d JOIN eticheta et ON et.k = d.k AND et.id = d.id
           LEFT JOIN fn f ON d.k = 'f' AND f.oid = d.id LEFT JOIN rel c ON d.k = 'r' AND c.oid = d.id
    UNION ALL
    SELECT 'N_audit_cale', b.drum, (SELECT dn.dist FROM dist_net dn WHERE dn.cheie = b.rcheie), NULL, NULL,
           'radacina=' || (SELECT es.et FROM eticheta_stare es WHERE es.cheie = b.rcheie)
           || '; tinta=' || (SELECT es.et FROM eticheta_stare es WHERE es.cheie = b.cheie),
           200, b.drum
      FROM inainte b WHERE b.rest = 0
    UNION ALL
    SELECT 'N_audit_nerezolvat', et.eticheta, d.dist, f.definer, f.proprietar, x.motiv, 300, et.eticheta || x.motiv
      FROM nerez x JOIN fn f ON f.oid = x.oid JOIN nod d ON d.k = 'f' AND d.id = x.oid
           JOIN eticheta et ON et.k = 'f' AND et.id = x.oid
    UNION ALL
    SELECT 'N_audit_necunoscut', et.eticheta, d.dist, f.definer, f.proprietar, 'nume urmat de ( fara functie: ' || u.nume,
           400, et.eticheta || u.nume
      FROM necunoscut u JOIN fn f ON f.oid = u.oid JOIN nod d ON d.k = 'f' AND d.id = u.oid
           JOIN eticheta et ON et.k = 'f' AND et.id = u.oid) z
 ORDER BY z.o1, z.o2 COLLATE "C";

ROLLBACK;
