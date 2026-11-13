-- AMPRENTA_GLOBALA v2 (L15 v2, docs/LIVRARE_L15_V2.md). SINGURA definitie (L19): o folosesc runnerul (scripts/livrare_migrare.sh
-- prin scripts/livrare_amprenta.sh), citirea coordonatorului (scripts/amprenta_globala_citire.sh), generatorul de manifest
-- (scripts/livrare_l15_manifest.sh) si testele. Nu se ruleaza direct: blocurile dintre marcaje se extrag exact.
-- Ce aduce v2 (istoria versiunilor: docs/LIVRARE_L15_V2.md, "Versionare"): grantorul in fiecare ACL; dependentele OWNED BY /
-- identity ale secventelor; schemele de sistem (obiectele create dupa initdb prin ACELEASI familii, plasa sistem_initdb pe
-- functiile de la initdb, acl_sistem); server_version_num in baza; obiectele mari cate un rand pe obiect.
--
-- Doua blocuri, fiecare = O interogare (fara ";"), coloanele (familie, eticheta, amprenta, detaliu):
--   AG_SESIUNE v2  profilul scurt al sesiunii de livrare; se evalueaza in contextul APELANTULUI (inaintea fixarii GUC-urilor),
--                  scris fara operatori si cu nume calificate, deci nu depinde de search_path. NU dovedeste configuratia
--                  sesiunilor PostgREST (aceea e in familiile setare_rol + rol.rolconfig).
--   AG_CATALOG v2  toate obiectele cu cod executabil sau drepturi din perimetru (mai jos) + plasa pe functiile de la initdb +
--                  ACL-urile explicite din schemele de sistem; se evalueaza DOAR in
--                  contextul canonic (garda ag_garda refuza altfel): search_path = pg_catalog, pg_temp; TimeZone UTC;
--                  DateStyle ISO, YMD; IntervalStyle postgres; extra_float_digits 1; bytea_output hex;
--                  quote_all_identifiers off; standard_conforming_strings on; lc_monetary C.
--                  Cu search_path fixat, numele din pg_catalog apar NECALIFICATE, toate celelalte CALIFICATE cu schema
--                  (reg*::text, format_type, pg_get_*def); constantele deparsate (date, intervale, numere) nu depind de sesiune.
-- Canonicalizare: detaliu = jsonb_build_array(...)::text (JSON: fara separatori ambigui, NULL = null distinct de ""),
--   listele ordonate COLLATE "C"; amprenta = md5(detaliu); fara OID-uri (singura exceptie: identificatorul obiectelor
--   mari, numele lor public), numere de coloana, relfilenode, statistici, valori de secvente sau date din tabele.
--   Fiecare ACL = [beneficiar | null pentru PUBLIC, privilegiu, delegabil, grantor]. Optiunile care pot contine secrete
--   (FDW, servere, mapari, setarile de rol / baza) intra doar ca md5.
-- Perimetru, definit O DATA (CTE-ul ag_per + CTE-urile de perimetru pe catalog, ag_rel ... ag_tsc; familiile nu au
--   predicate proprii): un obiect intra daca schema lui e in perimetru SAU schema e de sistem (pg_catalog,
--   information_schema) SI obiectul e creat dupa initdb (oid >= 16384 = FirstNormalObjectId; OID-ul doar filtreaza, nu se
--   serializeaza) - acesta trece prin ACELEASI familii si ACELEASI expresii ca obiectele aplicatiei. Schemele din perimetru:
--   toate in afara pg_catalog, information_schema, pg_toast, pg_temp_N, pg_toast_temp_N (nicio schema de platforma
--   exclusa); obiectele temporare (relpersistence t, schemele temporare) nu intra. Cataloagele fara schema (roluri, membri,
--   limbaje, cast-uri, metode de acces, extensii, triggere de eveniment, publicatii, acl implicite, tablespace-uri,
--   parametri) intra INTREGI; baza = doar baza curenta.
--   Obiectele de la initdb din schemele de sistem (oid < 16384) NU sunt in perimetru: din ele intra doar functiile, AGREGAT
--   (sistem_initdb: un rand, md5 peste campurile brute din pg_proc), ACL-urile explicite (acl_sistem, si pg_toast), proprietarul
--   celor trei scheme si server_version_num (baza). Definitiile lor de relatii, coloane, tipuri, operatori, clase,
--   colatii etc. nu intra (un ALTER facut pe ele de superuserul platformei nu se vede; limita declarata in document).
-- Familii (v2): schema relatie coloana constrangere trigger regula politica functie tip operator familie_operatori
--   clasa_operatori amop amproc metoda_acces cast limbaj transformare conversie colatie ts_parser ts_sablon ts_dictionar
--   ts_config extensie trigger_eveniment mostenire acl_implicit baza parametru_acl tablespace rol membru setare_rol fdw
--   server_extern mapare_utilizator publicatie publicatie_tabel publicatie_schema obiect_mare eticheta_securitate
--   sistem_initdb acl_sistem sesiune
-- Orice schimbare a listei, a campurilor sau a perimetrului DUPA ce forma a intrat pe main = alta versiune (v3: alt fisier,
--   alt marcaj), cu motiv. Rundele de review dinaintea intrarii pe main nu sunt versiuni (docs/LIVRARE_L15_V2.md, "Versionare").

-- >>> AG_SESIUNE v2
SELECT 'sesiune'::pg_catalog.text AS familie,
       pg_catalog.concat('sesiune ', g.n) AS eticheta,
       pg_catalog.md5(pg_catalog.jsonb_build_array(pg_catalog.current_setting(g.n))::pg_catalog.text) AS amprenta,
       pg_catalog.jsonb_build_array(pg_catalog.current_setting(g.n))::pg_catalog.text AS detaliu
  FROM pg_catalog.unnest(ARRAY['DateStyle', 'TimeZone', 'row_security', 'search_path', 'session_replication_role']::pg_catalog.text[]) AS g(n)
-- <<< AG_SESIUNE v2

-- >>> AG_CATALOG v2
WITH
ag_garda AS (
  -- search_path: aceeasi cale si in forma cu ghilimele (o scrie SET-ul cand quote_all_identifiers era on la momentul lui)
  SELECT CAST(CASE WHEN pg_catalog.current_setting('search_path') OPERATOR(pg_catalog.=) ANY (ARRAY['pg_catalog, pg_temp', '"pg_catalog", "pg_temp"'])
                    AND pg_catalog.current_setting('TimeZone') OPERATOR(pg_catalog.=) 'UTC'
                    AND pg_catalog.current_setting('DateStyle') OPERATOR(pg_catalog.=) 'ISO, YMD'
                    AND pg_catalog.current_setting('IntervalStyle') OPERATOR(pg_catalog.=) 'postgres'
                    AND pg_catalog.current_setting('extra_float_digits') OPERATOR(pg_catalog.=) '1'
                    AND pg_catalog.current_setting('bytea_output') OPERATOR(pg_catalog.=) 'hex'
                    AND pg_catalog.current_setting('quote_all_identifiers') OPERATOR(pg_catalog.=) 'off'
                    AND pg_catalog.current_setting('standard_conforming_strings') OPERATOR(pg_catalog.=) 'on'
                    AND pg_catalog.current_setting('lc_monetary') OPERATOR(pg_catalog.=) 'C'
               THEN '1' ELSE 'AG_V2_CONTEXT_NECANONIC' END AS pg_catalog.int4) AS ok
),
-- PERIMETRUL (singura definitie): schema + pragul de OID al obiectelor ei care intra. Schemele aplicatiei / platformei:
-- prag 0 (tot); pg_catalog si information_schema: prag 16384 = FirstNormalObjectId (doar ce s-a creat dupa initdb).
-- pg_toast si schemele temporare nu sunt in perimetru. CTE-urile de perimetru de mai jos (ag_rel ... ag_tsc) aplica
-- TOATE aceeasi conditie (x.oid >= s.prag); familiile folosesc doar CTE-urile de perimetru.
ag_per AS (
  SELECT n.oid, quote_ident(n.nspname) AS q,
         CAST(CASE WHEN n.nspname IN ('pg_catalog', 'information_schema') THEN 16384 ELSE 0 END AS oid) AS prag
    FROM pg_namespace n CROSS JOIN ag_garda g
   WHERE g.ok = 1 AND n.nspname <> 'pg_toast' AND n.nspname !~ '^pg_(toast_)?temp_[0-9]+$'
),
-- schemele ca obiecte (familia schema): cele ale aplicatiei; cele trei de sistem sunt in acl_sistem
ag_ns AS (SELECT s.oid, s.q FROM ag_per s WHERE s.prag = 0),
-- schemele de sistem, pentru acl_sistem (+ pg_toast)
ag_sis3 AS (
  SELECT n.oid, n.nspname, quote_ident(n.nspname) AS q
    FROM pg_namespace n CROSS JOIN ag_garda g
   WHERE g.ok = 1 AND n.nspname IN ('pg_catalog', 'information_schema', 'pg_toast')
),
-- relatiile din schemele de sistem; cele TOAST etichetate dupa tabelul-parinte (numele lor contine un OID)
ag_rel_sis AS (
  SELECT c.oid, CASE WHEN s.nspname = 'pg_toast' THEN 'toast ' || coalesce(p.oid::regclass::text, '-') ELSE c.oid::regclass::text END AS et
    FROM pg_class c JOIN ag_sis3 s ON s.oid = c.relnamespace
    LEFT JOIN pg_class p ON s.nspname = 'pg_toast' AND p.reltoastrelid = c.oid
   WHERE c.relpersistence <> 't'
),
-- CTE-urile de perimetru, cate unul pe catalog cu schema; forma fixa: legatura cu ag_per pe schema si x.oid >= prag
ag_rel AS (SELECT c.oid, c.relkind FROM pg_class c JOIN ag_per s ON s.oid = c.relnamespace WHERE c.oid >= s.prag AND c.relpersistence <> 't'),
ag_typ AS (SELECT t.oid FROM pg_type t JOIN ag_per s ON s.oid = t.typnamespace WHERE t.oid >= s.prag),
ag_fn AS (SELECT p.oid FROM pg_proc p JOIN ag_per s ON s.oid = p.pronamespace WHERE p.oid >= s.prag),
ag_opr AS (SELECT o.oid FROM pg_operator o JOIN ag_per s ON s.oid = o.oprnamespace WHERE o.oid >= s.prag),
ag_opf_p AS (SELECT f.oid FROM pg_opfamily f JOIN ag_per s ON s.oid = f.opfnamespace WHERE f.oid >= s.prag),
ag_opc_p AS (SELECT c.oid FROM pg_opclass c JOIN ag_per s ON s.oid = c.opcnamespace WHERE c.oid >= s.prag),
ag_col AS (SELECT co.oid, s.q FROM pg_collation co JOIN ag_per s ON s.oid = co.collnamespace WHERE co.oid >= s.prag),
ag_conv AS (SELECT cv.oid, s.q FROM pg_conversion cv JOIN ag_per s ON s.oid = cv.connamespace WHERE cv.oid >= s.prag),
ag_tsp AS (SELECT pr.oid, s.q FROM pg_ts_parser pr JOIN ag_per s ON s.oid = pr.prsnamespace WHERE pr.oid >= s.prag),
ag_tst AS (SELECT tm.oid, s.q FROM pg_ts_template tm JOIN ag_per s ON s.oid = tm.tmplnamespace WHERE tm.oid >= s.prag),
ag_tsd AS (SELECT dc.oid, s.q FROM pg_ts_dict dc JOIN ag_per s ON s.oid = dc.dictnamespace WHERE dc.oid >= s.prag),
ag_tsc AS (SELECT cf.oid, s.q FROM pg_ts_config cf JOIN ag_per s ON s.oid = cf.cfgnamespace WHERE cf.oid >= s.prag),
-- etichetele familiilor / claselor de operatori (si din pg_catalog, pentru referinte)
ag_opf AS (
  SELECT f.oid, f.opfnamespace, quote_ident(n.nspname) || '.' || quote_ident(f.opfname) || ' ' || quote_ident(a.amname) AS et
    FROM pg_opfamily f JOIN pg_namespace n ON n.oid = f.opfnamespace JOIN pg_am a ON a.oid = f.opfmethod
),
ag_opc AS (
  SELECT c.oid, c.opcnamespace, quote_ident(n.nspname) || '.' || quote_ident(c.opcname) || ' ' || quote_ident(a.amname) AS et
    FROM pg_opclass c JOIN pg_namespace n ON n.oid = c.opcnamespace JOIN pg_am a ON a.oid = c.opcmethod
),
ag_rand(familie, eticheta, d) AS (
  -- schema: proprietar, ACL
  SELECT 'schema', 'schema ' || s.q,
         jsonb_build_array(n.nspowner::regrole::text,
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a) z))
    FROM ag_ns s JOIN pg_namespace n ON n.oid = s.oid
  UNION ALL
  -- relatie: tabele, partitii, vederi, vederi materializate, secvente, indecsi, tabele externe, tipuri compuse
  SELECT 'relatie', 'relatie ' || c.oid::regclass::text,
         jsonb_build_array(c.relkind::text, c.relowner::regrole::text,
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) a) z),
           c.relrowsecurity, c.relforcerowsecurity, c.relpersistence::text, am.amname::text,
           (SELECT jsonb_agg(o ORDER BY o COLLATE "C") FROM unnest(c.reloptions) o),
           c.relispartition, pg_get_expr(c.relpartbound, c.oid), c.relreplident::text, c.reltoastrelid <> 0, ts.spcname::text,
           CASE WHEN c.reloftype <> 0 THEN c.reloftype::regtype::text END,
           CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid) END,
           CASE WHEN c.relkind = 'p' THEN jsonb_build_array(pg_get_partkeydef(c.oid),
                  CASE WHEN pt.partdefid <> 0 THEN pt.partdefid::regclass::text END) END,
           CASE WHEN c.relkind IN ('i', 'I') THEN jsonb_build_array(pg_get_indexdef(c.oid), i.indisunique, i.indnullsnotdistinct,
                  i.indisprimary, i.indisexclusion, i.indimmediate, i.indisclustered, i.indisvalid, i.indisready, i.indislive,
                  i.indisreplident) END,
           -- secvente: parametrii + legatura cu coloana (pg_depend: a = OWNED BY, i = identity) [tip, tabel, coloana]
           CASE WHEN c.relkind = 'S' THEN jsonb_build_array(sq.seqtypid::regtype::text, sq.seqstart, sq.seqincrement, sq.seqmax,
                  sq.seqmin, sq.seqcache, sq.seqcycle,
                  (SELECT jsonb_agg(jsonb_build_array(d.deptype::text, d.refobjid::regclass::text,
                            (SELECT quote_ident(a2.attname) FROM pg_attribute a2 WHERE a2.attrelid = d.refobjid AND a2.attnum = d.refobjsubid))
                            ORDER BY d.deptype, d.refobjid::regclass::text COLLATE "C", d.refobjsubid)
                     FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.objsubid = 0
                      AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i'))) END,
           CASE WHEN c.relkind = 'f' THEN jsonb_build_array(fs.srvname::text,
                  (SELECT md5(jsonb_agg(o ORDER BY o COLLATE "C")::text) FROM unnest(ft.ftoptions) o)) END)
    FROM ag_rel r JOIN pg_class c ON c.oid = r.oid
    LEFT JOIN pg_am am ON am.oid = c.relam
    LEFT JOIN pg_tablespace ts ON ts.oid = c.reltablespace
    LEFT JOIN pg_index i ON i.indexrelid = c.oid
    LEFT JOIN pg_sequence sq ON sq.seqrelid = c.oid
    LEFT JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
    LEFT JOIN pg_foreign_table ft ON ft.ftrelid = c.oid
    LEFT JOIN pg_foreign_server fs ON fs.oid = ft.ftserver
  UNION ALL
  -- coloana (fara cele sterse): pozitia = rangul printre coloanele vii (invariant la dump / restore), tip, colatie,
  -- NOT NULL, identity, generata, valoarea implicita / expresia generata, ACL pe coloana, stocare, mostenire, optiuni FDW (md5)
  SELECT 'coloana', 'coloana ' || c.oid::regclass::text || '.' || quote_ident(a.attname),
         jsonb_build_array(row_number() OVER (PARTITION BY a.attrelid ORDER BY a.attnum), format_type(a.atttypid, a.atttypmod),
           CASE WHEN a.attcollation <> 0 THEN a.attcollation::regcollation::text END, a.attnotnull, a.attidentity::text,
           a.attgenerated::text, pg_get_expr(ad.adbin, ad.adrelid),
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN x.grantee = 0 THEN NULL ELSE x.grantee::regrole::text END, x.privilege_type, x.is_grantable, x.grantor::regrole::text) AS v
                FROM aclexplode(a.attacl) x) z),
           a.attstorage::text, a.attcompression::text, a.attislocal, a.attinhcount,
           (SELECT md5(jsonb_agg(o ORDER BY o COLLATE "C")::text) FROM unnest(a.attfdwoptions) o))
    FROM ag_rel r JOIN pg_class c ON c.oid = r.oid
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
   WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'c')
  UNION ALL
  -- constrangere: TOATE (CHECK, NOT NULL in PG18, PK, UNIQUE, FK, EXCLUDE, trigger) pe tabele si pe domenii
  SELECT 'constrangere', 'constrangere '
           || CASE WHEN co.conrelid <> 0 THEN 'tabel ' || co.conrelid::regclass::text ELSE 'domeniu ' || co.contypid::regtype::text END
           || '.' || quote_ident(co.conname),
         jsonb_build_array(co.contype::text, co.condeferrable, co.condeferred, co.convalidated, co.conislocal, co.coninhcount,
           co.connoinherit, pg_get_constraintdef(co.oid), CASE WHEN co.conindid <> 0 THEN co.conindid::regclass::text END)
    FROM pg_constraint co
   WHERE co.conrelid IN (SELECT r.oid FROM ag_rel r) OR co.contypid IN (SELECT t.oid FROM ag_typ t)
  UNION ALL
  -- trigger: TOATE, si cele interne (FK). Numele celor interne contine un OID => eticheta lor = constrangerea + functia + tipul.
  SELECT 'trigger', 'trigger ' || t.tgrelid::regclass::text
           || CASE WHEN t.tgisinternal THEN ' intern ' || coalesce(quote_ident(co.conname), '-') || ' ' || t.tgfoid::regprocedure::text
                                             || ' ' || t.tgtype
                   ELSE '.' || quote_ident(t.tgname) END,
         jsonb_build_array(t.tgisinternal, t.tgenabled::text, t.tgfoid::regprocedure::text, t.tgtype, t.tgdeferrable, t.tginitdeferred,
           CASE WHEN t.tgconstrrelid <> 0 THEN t.tgconstrrelid::regclass::text END, co.conname::text, t.tgnargs,
           CASE WHEN NOT t.tgisinternal THEN pg_get_triggerdef(t.oid) END)
    FROM pg_trigger t JOIN ag_rel r ON r.oid = t.tgrelid
    LEFT JOIN pg_constraint co ON co.oid = t.tgconstraint
  UNION ALL
  -- regula: tipul, ev_enabled, INSTEAD, definitia (regula _RETURN a unei vederi = definitia vederii, deja in relatie)
  SELECT 'regula', 'regula ' || rw.ev_class::regclass::text || '.' || quote_ident(rw.rulename),
         jsonb_build_array(rw.ev_type::text, rw.ev_enabled::text, rw.is_instead,
           CASE WHEN NOT (rw.rulename = '_RETURN' AND r.relkind IN ('v', 'm')) THEN pg_get_ruledef(rw.oid) END)
    FROM pg_rewrite rw JOIN ag_rel r ON r.oid = rw.ev_class
  UNION ALL
  -- politica: comanda, PERMISSIVE / RESTRICTIVE, rolurile (null = PUBLIC), USING, WITH CHECK (null = lipsa)
  SELECT 'politica', 'politica ' || p.polrelid::regclass::text || '.' || quote_ident(p.polname),
         jsonb_build_array(p.polcmd::text, p.polpermissive,
           (SELECT jsonb_agg(z.n ORDER BY z.n COLLATE "C" NULLS FIRST) FROM (
              SELECT CASE WHEN ro = 0 THEN NULL ELSE ro::regrole::text END AS n FROM unnest(p.polroles) ro) z),
           pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid))
    FROM pg_policy p JOIN ag_rel r ON r.oid = p.polrelid
  UNION ALL
  -- functie: tot ce schimba comportamentul sau dreptul (corpul ca md5, inclusiv probin = biblioteca C, BEGIN ATOMIC deparsat)
  SELECT 'functie', 'functie ' || p.oid::regprocedure::text,
         jsonb_build_array(p.prokind::text, l.lanname::text, p.proowner::regrole::text, p.prosecdef, p.provolatile::text, p.proisstrict,
           p.proleakproof, p.proparallel::text, p.proretset, p.procost, p.prorows,
           CASE WHEN p.provariadic <> 0 THEN p.provariadic::regtype::text END,
           CASE WHEN p.prosupport <> 0 THEN p.prosupport::oid::regprocedure::text END,
           pg_get_function_arguments(p.oid), pg_get_function_result(p.oid), to_jsonb(p.proconfig), p.probin, md5(p.prosrc),
           CASE WHEN p.prosqlbody IS NOT NULL THEN md5(pg_get_function_sqlbody(p.oid)) END,
           (SELECT jsonb_agg(u.x::regtype::text ORDER BY u.o) FROM unnest(p.protrftypes) WITH ORDINALITY u(x, o)),
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) z),
           (SELECT jsonb_build_array(g.aggkind::text, g.aggnumdirectargs, g.aggtransfn::oid::regprocedure::text,
                     g.aggfinalfn::oid::regprocedure::text, g.aggcombinefn::oid::regprocedure::text, g.aggserialfn::oid::regprocedure::text,
                     g.aggdeserialfn::oid::regprocedure::text, g.aggmtransfn::oid::regprocedure::text, g.aggminvtransfn::oid::regprocedure::text,
                     g.aggmfinalfn::oid::regprocedure::text, g.aggfinalextra, g.aggmfinalextra, g.aggfinalmodify::text, g.aggmfinalmodify::text,
                     CASE WHEN g.aggsortop <> 0 THEN g.aggsortop::regoperator::text END, g.aggtranstype::regtype::text, g.aggtransspace,
                     CASE WHEN g.aggmtranstype <> 0 THEN g.aggmtranstype::regtype::text END, g.aggmtransspace, g.agginitval, g.aggminitval)
              FROM pg_aggregate g WHERE g.aggfnoid = p.oid))
    FROM ag_fn x JOIN pg_proc p ON p.oid = x.oid JOIN pg_language l ON l.oid = p.prolang
  UNION ALL
  -- tip: TOATE tipurile din perimetru (de baza, compuse / randul tabelelor, domenii, enum, range, multirange, pseudo, tablouri)
  SELECT 'tip', 'tip ' || t.oid::regtype::text,
         jsonb_build_array(t.typtype::text, t.typcategory::text, t.typispreferred, t.typowner::regrole::text,
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(coalesce(t.typacl, acldefault('T', t.typowner))) a) z),
           t.typlen, t.typbyval, t.typalign::text, t.typstorage::text, t.typdelim::text, t.typnotnull,
           CASE WHEN t.typbasetype <> 0 THEN format_type(t.typbasetype, t.typtypmod) END,
           CASE WHEN t.typcollation <> 0 THEN t.typcollation::regcollation::text END, t.typdefault,
           jsonb_build_array(t.typinput::oid::regprocedure::text, t.typoutput::oid::regprocedure::text, t.typreceive::oid::regprocedure::text,
             t.typsend::oid::regprocedure::text, t.typmodin::oid::regprocedure::text, t.typmodout::oid::regprocedure::text,
             t.typanalyze::oid::regprocedure::text, t.typsubscript::oid::regprocedure::text),
           CASE WHEN t.typelem <> 0 THEN t.typelem::regtype::text END,
           CASE WHEN t.typrelid <> 0 THEN t.typrelid::regclass::text END,
           (SELECT jsonb_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid),
           (SELECT jsonb_build_array(rg.rngsubtype::regtype::text,
                     CASE WHEN rg.rngcollation <> 0 THEN rg.rngcollation::regcollation::text END,
                     (SELECT oc.et FROM ag_opc oc WHERE oc.oid = rg.rngsubopc),
                     rg.rngcanonical::oid::regprocedure::text, rg.rngsubdiff::oid::regprocedure::text, rg.rngmultitypid::regtype::text)
              FROM pg_range rg WHERE rg.rngtypid = t.oid))
    FROM pg_type t JOIN ag_typ x ON x.oid = t.oid
  UNION ALL
  -- operator
  SELECT 'operator', 'operator ' || o.oid::regoperator::text,
         jsonb_build_array(o.oprowner::regrole::text, o.oprkind::text, o.oprcanmerge, o.oprcanhash, o.oprresult::regtype::text,
           o.oprcode::oid::regprocedure::text, o.oprrest::oid::regprocedure::text, o.oprjoin::oid::regprocedure::text,
           CASE WHEN o.oprcom <> 0 THEN o.oprcom::regoperator::text END, CASE WHEN o.oprnegate <> 0 THEN o.oprnegate::regoperator::text END)
    FROM ag_opr x JOIN pg_operator o ON o.oid = x.oid
  UNION ALL
  SELECT 'familie_operatori', 'familie_operatori ' || f.et, jsonb_build_array(pf.opfowner::regrole::text)
    FROM ag_opf_p x JOIN ag_opf f ON f.oid = x.oid JOIN pg_opfamily pf ON pf.oid = f.oid
  UNION ALL
  SELECT 'clasa_operatori', 'clasa_operatori ' || c.et,
         jsonb_build_array(pc.opcowner::regrole::text, (SELECT f.et FROM ag_opf f WHERE f.oid = pc.opcfamily), pc.opcintype::regtype::text,
           pc.opcdefault, CASE WHEN pc.opckeytype <> 0 THEN pc.opckeytype::regtype::text END)
    FROM ag_opc_p x JOIN ag_opc c ON c.oid = x.oid JOIN pg_opclass pc ON pc.oid = c.oid
  UNION ALL
  -- membrii familiilor: ai familiilor din perimetru SI membrii (pg_amop / pg_amproc) adaugati dupa initdb la familiile de
  -- la initdb (de ex. de extensii; oid-ul randului de membru >= 16384)
  SELECT 'amop', 'amop ' || f.et || ' ' || ao.amoplefttype::regtype::text || ',' || ao.amoprighttype::regtype::text || ' ' || ao.amopstrategy,
         jsonb_build_array(ao.amoppurpose::text, ao.amopopr::regoperator::text,
           (SELECT f2.et FROM ag_opf f2 WHERE f2.oid = ao.amopsortfamily), (SELECT quote_ident(m.amname) FROM pg_am m WHERE m.oid = ao.amopmethod))
    FROM pg_amop ao JOIN ag_opf f ON f.oid = ao.amopfamily
   WHERE f.oid IN (SELECT x.oid FROM ag_opf_p x) OR ao.oid >= 16384
  UNION ALL
  SELECT 'amproc', 'amproc ' || f.et || ' ' || ap.amproclefttype::regtype::text || ',' || ap.amprocrighttype::regtype::text || ' ' || ap.amprocnum,
         jsonb_build_array(ap.amproc::oid::regprocedure::text)
    FROM pg_amproc ap JOIN ag_opf f ON f.oid = ap.amprocfamily
   WHERE f.oid IN (SELECT x.oid FROM ag_opf_p x) OR ap.oid >= 16384
  UNION ALL
  SELECT 'metoda_acces', 'metoda_acces ' || quote_ident(m.amname), jsonb_build_array(m.amtype::text, m.amhandler::oid::regprocedure::text)
    FROM pg_am m
  UNION ALL
  -- cast: TOATE (catalog fara schema)
  SELECT 'cast', 'cast ' || c.castsource::regtype::text || ' -> ' || c.casttarget::regtype::text,
         jsonb_build_array(CASE WHEN c.castfunc <> 0 THEN c.castfunc::regprocedure::text END, c.castcontext::text, c.castmethod::text)
    FROM pg_cast c
  UNION ALL
  SELECT 'limbaj', 'limbaj ' || quote_ident(l.lanname),
         jsonb_build_array(l.lanowner::regrole::text, l.lanispl, l.lanpltrusted, l.lanplcallfoid::regprocedure::text,
           l.laninline::regprocedure::text, l.lanvalidator::regprocedure::text,
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(coalesce(l.lanacl, acldefault('l', l.lanowner))) a) z))
    FROM pg_language l
  UNION ALL
  SELECT 'transformare', 'transformare ' || tr.trftype::regtype::text || ' ' || quote_ident(l.lanname),
         jsonb_build_array(tr.trffromsql::oid::regprocedure::text, tr.trftosql::oid::regprocedure::text)
    FROM pg_transform tr JOIN pg_language l ON l.oid = tr.trflang
  UNION ALL
  SELECT 'conversie', 'conversie ' || s.q || '.' || quote_ident(cv.conname),
         jsonb_build_array(cv.conowner::regrole::text, pg_encoding_to_char(cv.conforencoding), pg_encoding_to_char(cv.contoencoding),
           cv.conproc::oid::regprocedure::text, cv.condefault)
    FROM ag_conv s JOIN pg_conversion cv ON cv.oid = s.oid
  UNION ALL
  SELECT 'colatie', 'colatie ' || s.q || '.' || quote_ident(co.collname) || ' ' || co.collencoding,
         jsonb_build_array(co.collowner::regrole::text, co.collprovider::text, co.collisdeterministic, co.collcollate, co.collctype,
           co.colllocale, co.collicurules)
    FROM ag_col s JOIN pg_collation co ON co.oid = s.oid
  UNION ALL
  SELECT 'ts_parser', 'ts_parser ' || s.q || '.' || quote_ident(pr.prsname),
         jsonb_build_array(pr.prsstart::oid::regprocedure::text, pr.prstoken::oid::regprocedure::text, pr.prsend::oid::regprocedure::text,
           pr.prsheadline::oid::regprocedure::text, pr.prslextype::oid::regprocedure::text)
    FROM ag_tsp s JOIN pg_ts_parser pr ON pr.oid = s.oid
  UNION ALL
  SELECT 'ts_sablon', 'ts_sablon ' || s.q || '.' || quote_ident(tm.tmplname),
         jsonb_build_array(tm.tmplinit::oid::regprocedure::text, tm.tmpllexize::oid::regprocedure::text)
    FROM ag_tst s JOIN pg_ts_template tm ON tm.oid = s.oid
  UNION ALL
  SELECT 'ts_dictionar', 'ts_dictionar ' || s.q || '.' || quote_ident(dc.dictname),
         jsonb_build_array(dc.dictowner::regrole::text,
           (SELECT quote_ident(n2.nspname) || '.' || quote_ident(t2.tmplname) FROM pg_ts_template t2 JOIN pg_namespace n2 ON n2.oid = t2.tmplnamespace
             WHERE t2.oid = dc.dicttemplate), dc.dictinitoption)
    FROM ag_tsd s JOIN pg_ts_dict dc ON dc.oid = s.oid
  UNION ALL
  SELECT 'ts_config', 'ts_config ' || s.q || '.' || quote_ident(cf.cfgname),
         jsonb_build_array(cf.cfgowner::regrole::text,
           (SELECT quote_ident(n2.nspname) || '.' || quote_ident(p2.prsname) FROM pg_ts_parser p2 JOIN pg_namespace n2 ON n2.oid = p2.prsnamespace
             WHERE p2.oid = cf.cfgparser),
           (SELECT jsonb_agg(jsonb_build_array(m.maptokentype, m.mapseqno, m.mapdict::regdictionary::text) ORDER BY m.maptokentype, m.mapseqno)
              FROM pg_ts_config_map m WHERE m.mapcfg = cf.oid))
    FROM ag_tsc s JOIN pg_ts_config cf ON cf.oid = s.oid
  UNION ALL
  SELECT 'extensie', 'extensie ' || quote_ident(e.extname),
         jsonb_build_array(e.extowner::regrole::text, e.extnamespace::regnamespace::text, e.extrelocatable, e.extversion,
           (SELECT jsonb_agg(u.x::regclass::text ORDER BY u.o) FROM unnest(e.extconfig) WITH ORDINALITY u(x, o)), to_jsonb(e.extcondition))
    FROM pg_extension e
  UNION ALL
  SELECT 'trigger_eveniment', 'trigger_eveniment ' || quote_ident(et.evtname),
         jsonb_build_array(et.evtevent::text, et.evtowner::regrole::text, et.evtfoid::regprocedure::text, et.evtenabled::text,
           (SELECT jsonb_agg(x ORDER BY x COLLATE "C") FROM unnest(et.evttags) x))
    FROM pg_event_trigger et
  UNION ALL
  SELECT 'mostenire', 'mostenire ' || ih.inhrelid::regclass::text || ' <- ' || ih.inhparent::regclass::text,
         jsonb_build_array(ih.inhseqno, ih.inhdetachpending)
    FROM pg_inherits ih JOIN ag_rel r ON r.oid = ih.inhrelid
  UNION ALL
  SELECT 'acl_implicit', 'acl_implicit ' || da.defaclrole::regrole::text || ' '
           || CASE WHEN da.defaclnamespace = 0 THEN '*' ELSE da.defaclnamespace::regnamespace::text END || ' ' || da.defaclobjtype::text,
         jsonb_build_array((SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(da.defaclacl) a) z))
    FROM pg_default_acl da
  UNION ALL
  -- baza: doar baza curenta (numele ei = identitatea tintei, verificata de runner, nu intra aici); server_version_num: o
  -- versiune minora noua poate schimba deparsarea si codul sistemului => refuz conservator, recitire
  SELECT 'baza', 'baza curenta',
         jsonb_build_array(current_setting('server_version_num'),
           db.datdba::regrole::text, pg_encoding_to_char(db.encoding), db.datlocprovider::text, db.datcollate, db.datctype,
           db.datlocale, db.daticurules, db.datistemplate, db.datallowconn, db.datconnlimit,
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(coalesce(db.datacl, acldefault('d', db.datdba))) a) z))
    FROM pg_database db WHERE db.datname = current_database()
  UNION ALL
  SELECT 'parametru_acl', 'parametru_acl ' || pa.parname,
         jsonb_build_array((SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(pa.paracl) a) z))
    FROM pg_parameter_acl pa
  UNION ALL
  SELECT 'tablespace', 'tablespace ' || quote_ident(sp.spcname),
         jsonb_build_array(sp.spcowner::regrole::text,
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(coalesce(sp.spcacl, acldefault('t', sp.spcowner))) a) z),
           (SELECT jsonb_agg(o ORDER BY o COLLATE "C") FROM unnest(sp.spcoptions) o))
    FROM pg_tablespace sp
  UNION ALL
  -- rol: toate atributele (fara parola); valorile din rolconfig doar ca md5 (pot contine secrete)
  SELECT 'rol', 'rol ' || quote_ident(ro.rolname),
         jsonb_build_array(ro.rolsuper, ro.rolinherit, ro.rolcreaterole, ro.rolcreatedb, ro.rolcanlogin, ro.rolreplication, ro.rolbypassrls,
           ro.rolconnlimit, ro.rolvaliduntil::text,
           (SELECT jsonb_agg(jsonb_build_array(split_part(x, '=', 1), md5(substr(x, strpos(x, '=') + 1))) ORDER BY x COLLATE "C")
              FROM unnest(ro.rolconfig) x))
    FROM pg_roles ro
  UNION ALL
  SELECT 'membru', 'membru ' || am.roleid::regrole::text || ' <- ' || am.member::regrole::text || ' de ' || am.grantor::regrole::text,
         jsonb_build_array(am.admin_option, am.inherit_option, am.set_option)
    FROM pg_auth_members am
  UNION ALL
  SELECT 'setare_rol', 'setare_rol ' || CASE WHEN ds.setdatabase = 0 THEN '*' ELSE 'curenta' END || ' '
           || CASE WHEN ds.setrole = 0 THEN '*' ELSE ds.setrole::regrole::text END,
         jsonb_build_array((SELECT jsonb_agg(jsonb_build_array(split_part(x, '=', 1), md5(substr(x, strpos(x, '=') + 1))) ORDER BY x COLLATE "C")
              FROM unnest(ds.setconfig) x))
    FROM pg_db_role_setting ds
   WHERE ds.setdatabase = 0 OR ds.setdatabase = (SELECT db2.oid FROM pg_database db2 WHERE db2.datname = current_database())
  UNION ALL
  -- acces extern: optiunile doar ca md5
  SELECT 'fdw', 'fdw ' || quote_ident(w.fdwname),
         jsonb_build_array(w.fdwowner::regrole::text, w.fdwhandler::regprocedure::text, w.fdwvalidator::regprocedure::text,
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(coalesce(w.fdwacl, acldefault('F', w.fdwowner))) a) z),
           (SELECT md5(jsonb_agg(o ORDER BY o COLLATE "C")::text) FROM unnest(w.fdwoptions) o))
    FROM pg_foreign_data_wrapper w
  UNION ALL
  SELECT 'server_extern', 'server_extern ' || quote_ident(sv.srvname),
         jsonb_build_array(sv.srvowner::regrole::text, w.fdwname::text, sv.srvtype, sv.srvversion,
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(coalesce(sv.srvacl, acldefault('S', sv.srvowner))) a) z),
           (SELECT md5(jsonb_agg(o ORDER BY o COLLATE "C")::text) FROM unnest(sv.srvoptions) o))
    FROM pg_foreign_server sv JOIN pg_foreign_data_wrapper w ON w.oid = sv.srvfdw
  UNION ALL
  -- maparile: optiunile sunt vizibile doar proprietarului serverului (altfel null: schimbarea lor nu se vede, limita declarata)
  SELECT 'mapare_utilizator', 'mapare_utilizator ' || quote_ident(um.srvname::text) || ' '
           || CASE WHEN um.umuser = 0 THEN 'PUBLIC' ELSE quote_ident(um.usename::text) END,
         jsonb_build_array((SELECT md5(jsonb_agg(o ORDER BY o COLLATE "C")::text) FROM unnest(um.umoptions) o))
    FROM pg_user_mappings um
  UNION ALL
  SELECT 'publicatie', 'publicatie ' || quote_ident(pb.pubname),
         jsonb_build_array(pb.pubowner::regrole::text, pb.puballtables, pb.pubinsert, pb.pubupdate, pb.pubdelete, pb.pubtruncate, pb.pubviaroot)
    FROM pg_publication pb
  UNION ALL
  SELECT 'publicatie_tabel', 'publicatie_tabel ' || quote_ident(pb.pubname) || ' ' || pr.prrelid::regclass::text,
         jsonb_build_array(pg_get_expr(pr.prqual, pr.prrelid),
           (SELECT jsonb_agg(a.attname::text ORDER BY a.attnum) FROM pg_attribute a
             WHERE a.attrelid = pr.prrelid AND a.attnum = ANY (pr.prattrs::int2[])))
    FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid = pr.prpubid
  UNION ALL
  SELECT 'publicatie_schema', 'publicatie_schema ' || quote_ident(pb.pubname) || ' ' || pn.pnnspid::regnamespace::text, jsonb_build_array()
    FROM pg_publication_namespace pn JOIN pg_publication pb ON pb.oid = pn.pnpubid
  UNION ALL
  -- obiectele mari: un rand pe obiect, etichetat cu identificatorul lui (loid = numele public; exceptia declarata de la
  -- "fara OID-uri"): proprietar + ACL
  SELECT 'obiect_mare', 'obiect_mare ' || lo.oid::text,
         jsonb_build_array(lo.lomowner::regrole::text,
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(coalesce(lo.lomacl, acldefault('L', lo.lomowner))) a) z))
    FROM pg_largeobject_metadata lo
  UNION ALL
  SELECT 'eticheta_securitate', 'eticheta_securitate ' || quote_ident(sl.provider) || ' ' || sl.objtype || ' ' || sl.objname || ' ' || sl.objsubid,
         jsonb_build_array(sl.label)
    FROM pg_seclabels sl LEFT JOIN ag_per s ON s.oid = sl.objnamespace
   WHERE sl.objnamespace IS NULL OR sl.objoid >= s.prag
  UNION ALL
  -- sistem_initdb: PLASA pe functiile de la initdb din schemele de sistem (schema in ag_per, oid < prag = in afara
  -- perimetrului). UN rand [numar, md5] peste campurile BRUTE din pg_proc care le hotarasc comportamentul, fara functii de
  -- deparsare (cost fix, nu creste cu aplicatia). Identitatea = schema (oid) + nume + tipurile argumentelor (oidvector):
  -- pentru obiectele de la initdb OID-urile sunt fixate la initdb (server_version_num e in baza). Ordinea: schema, numele
  -- COLLATE "C", tipurile argumentelor (unica in pg_proc).
  SELECT 'sistem_initdb', 'sistem_initdb functii',
         jsonb_build_array(count(*), md5(string_agg(
           ROW(p.pronamespace, p.proname, p.proargtypes, p.prokind, p.prolang, p.proowner, p.prosecdef, p.proisstrict,
               p.provolatile, p.proleakproof, p.proparallel, p.proretset, p.prorettype, p.provariadic, p.proallargtypes,
               p.proargmodes, p.proargnames, p.proconfig, p.pronargdefaults, p.proargdefaults, md5(p.prosrc), p.probin,
               md5(p.prosqlbody::text), p.prosupport::oid)::text,
           chr(10) ORDER BY p.pronamespace, p.proname COLLATE "C", p.proargtypes)))
    FROM pg_proc p JOIN ag_per s ON s.oid = p.pronamespace
   WHERE p.oid < s.prag
  UNION ALL
  -- acl_sistem: proprietarul + ACL-ul celor trei scheme de sistem si fiecare obiect din ele cu ACL EXPLICIT (relacl / attacl /
  -- proacl / typacl nenul), cu grantor; relatiile TOAST etichetate dupa tabelul-parinte. Tinta: obiectele de la initdb si
  -- pg_toast (in afara perimetrului); un obiect creat dupa initdb cu ACL explicit apare aici SI in familia lui (redundant).
  SELECT 'acl_sistem', 'acl_sistem schema ' || s.q,
         jsonb_build_array(n.nspowner::regrole::text,
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a) z))
    FROM ag_sis3 s JOIN pg_namespace n ON n.oid = s.oid
  UNION ALL
  SELECT 'acl_sistem', 'acl_sistem relatie ' || r.et,
         jsonb_build_array(c.relkind::text, c.relowner::regrole::text,
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(c.relacl) a) z))
    FROM ag_rel_sis r JOIN pg_class c ON c.oid = r.oid
   WHERE c.relacl IS NOT NULL
  UNION ALL
  SELECT 'acl_sistem', 'acl_sistem coloana ' || r.et || '.' || quote_ident(at.attname),
         jsonb_build_array((SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(at.attacl) a) z))
    FROM ag_rel_sis r JOIN pg_attribute at ON at.attrelid = r.oid
   WHERE at.attacl IS NOT NULL AND NOT at.attisdropped
  UNION ALL
  SELECT 'acl_sistem', 'acl_sistem functie ' || p.oid::regprocedure::text,
         jsonb_build_array(p.proowner::regrole::text,
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(p.proacl) a) z))
    FROM pg_proc p JOIN ag_sis3 s ON s.oid = p.pronamespace
   WHERE p.proacl IS NOT NULL
  UNION ALL
  SELECT 'acl_sistem', 'acl_sistem tip ' || t.oid::regtype::text,
         jsonb_build_array(t.typowner::regrole::text,
           (SELECT jsonb_agg(z.v ORDER BY z.v::text COLLATE "C") FROM (
              SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN NULL ELSE a.grantee::regrole::text END, a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS v
                FROM aclexplode(t.typacl) a) z))
    FROM pg_type t JOIN ag_sis3 s ON s.oid = t.typnamespace
   WHERE t.typacl IS NOT NULL
)
SELECT r.familie, r.eticheta, md5(r.d::text) AS amprenta, r.d::text AS detaliu
  FROM ag_rand r CROSS JOIN ag_garda g
 WHERE g.ok = 1
-- <<< AG_CATALOG v2
