-- scripts/anon_drepturi_citire.sql — DOAR CITIRE (tranzacție READ ONLY, anulată la final). Pentru coordonator, pe producție sau pe clonă.
-- Drepturile rolului anon (cererile fără cont) în schema public: inventarul de azi, lista calculată pe trepte (T1 secvențe, T2 tabele și
-- vederi, T3 drepturile implicite), liniile BASELINE de lipit în migrările 20261218a / b / c, ce rămâne după fiecare treaptă și verificările
-- de dinainte (RPC-urile paginilor publice, funcțiile apelabile de anon fără DEFINER, politicile pentru anon / PUBLIC, ce vede anon azi,
-- ce interogări a rulat anon). Analiza și treptele: docs/SECURITATE_ANON_DREPTURI.md.
--
-- Rulare (ieșirea rămâne pe server, NU în repo: conține lista completă a obiectelor):
--   psql -X -v ON_ERROR_STOP=1 -P pager=off -A -F '<TAB>' -f scripts/anon_drepturi_citire.sql > <dosarul de rapoarte>/anon_drepturi_citire_<data>.tsv 2>&1
-- Secțiunile (prima coloană): CONTEXT, INVENTAR, OBIECT (un rând pe obiect: treapta, eticheta, amprenta, detaliu, motiv), BASELINE (rândul de
--   lipit în fiecare migrare), CONTROL (numărul + amprenta lui RAMANE și, r5, a politicilor pentru anon / PUBLIC pe relații fără niciun drept
--   pentru anon, pentru controlul periodic), RAMANE (ce mai are anon după fiecare treaptă), RPC_PUBLIC, FUNCTII_ANON, POLITICI_ANON,
--   CONTEXT_POSTGREST (r6: contextul cererii simulate); apoi NOTICE-urile SIMULARE (ce citește anon azi, ca anon, în contextul unei cereri
--   PostgREST fără sesiune; r6: întâi analiza din catalog cu lista albă de funcții, apoi execuția; ieșirea e o PROBĂ, nu o demonstrație) și
--   STATISTICI (interogările rulate ca anon, pe clase, cu queryid + stats_since, martorul PostgREST și linia-rezumat de comparat între două
--   citiri, dacă extensia de statistici e încărcată).
-- Lista revizuită = secțiunea OBIECT. Migrarea calculează aceeași listă (blocul REGULA_ANON v2, identic octet cu octet) și o compară cu
--   numărul + amprenta din BASELINE: orice diferență (obiect nou, șters, RECREAT, alte drepturi, alte politici / RLS / corp de vedere /
--   DEFAULT-uri) = refuz, iar migrarea își scrie lista în NOTICE. Amprenta conține oid-uri: BASELINE-ul se ia din ACEEAȘI bază pe care se
--   aplică (cel de pe clonă nu merge pe producție și invers).
-- Controlul periodic (după fiecare migrare și lunar): rândurile BASELINE (T1 / T2 / T3 = 0 obiecte după aplicare) și rândul CONTROL RAMANE
--   se compară cu ultima citire revizuită. Un CONTROL schimbat = ceva nou la „rămâne” (ex. un obiect creat de supabase_admin, cu drepturile
--   lui implicite pentru anon, sau o politică nouă pe un tabel rămas): se caută în OBIECT (treapta RAMANE) și se analizează.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '60s';

-- ── CONTEXT: versiunea, cine citește, apartenențele lui anon (dreptul efectiv = direct + PUBLIC), drepturi pentru PUBLIC în public ──
SELECT 'CONTEXT' AS sectiune, current_setting('server_version') AS versiune, current_user AS utilizator,
       current_setting('transaction_read_only') AS doar_citire,
       (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'anon') AS anon_membru_in_alte_roluri,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) e
         WHERE n.nspname = 'public' AND e.grantee = 0) AS drepturi_public_pe_relatii,
       pg_has_role(current_user, 'anon', 'MEMBER') AS pot_simula_anon;

-- ── INVENTAR: câte relații din public au vreun drept pentru anon, pe tip ──
SELECT 'INVENTAR' AS sectiune, c.relkind::text AS tip, count(*) AS obiecte,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM aclexplode(c.relacl) e WHERE e.grantee = 'anon'::regrole)
                           OR EXISTS (SELECT 1 FROM pg_attribute a, aclexplode(a.attacl) e
                                       WHERE a.attrelid = c.oid AND a.attnum > 0 AND e.grantee = 'anon'::regrole)) AS cu_drept_anon,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM aclexplode(c.relacl) e WHERE e.grantee = 0)) AS cu_drept_public,
       count(*) FILTER (WHERE c.relkind IN ('r', 'p') AND NOT c.relrowsecurity) AS tabele_fara_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
 GROUP BY c.relkind ORDER BY 2;

-- ── OBIECT + BASELINE + CONTROL + RAMANE: lista calculată (REGULA_ANON v2) și ce rezultă din ea ──
WITH RECURSIVE
-- >>> REGULA_ANON v2
-- (L19: O SINGURĂ definiție, copiată octet cu octet în scripts/anon_drepturi_citire.sql și în migrările 20261218a / b / c; testul
--  src/anonDrepturi.test.js verifică identitatea.) Rezultatul: anon_regula(treapta, oid, eticheta, detaliu, drepturi, coloane, motiv),
--  treapta = T1 (secvență de retras) | T2 (tabel / vedere de retras) | T3 (drept implicit de retras) | RAMANE (cu motivul) | LIPSA.
-- v2 (review #1081): detaliul (deci amprenta din BASELINE) cuprinde și IDENTITATEA obiectului (oid), RLS / FORCE, părinții (partiție /
--   moștenire), opțiunile, regulile (corpul vederii), TOATE politicile (nume, comandă, fel, roluri, expresiile USING / CHECK) și DEFAULT-urile
--   (la o secvență: DEFAULT-urile care o folosesc). Corpurile sunt arborii interni din catalog (pg_rewrite / pg_policy / pg_attrdef), care
--   conțin oid-urile obiectelor referite, citiți ca text FĂRĂ lock (pg_get_viewdef / pg_get_expr ar deparsa și ar lua lock-uri pe obiectele
--   referite). Deci un obiect șters și recreat cu același nume, o vedere / politică / DEFAULT rescrise schimbă amprenta. Coloanele (cu
--   sistemul inclus): „attnum:tip:typmod nume aclitem”: o coloană redenumită și alta nouă cu numele vechi nu se confundă la revenire.
-- pct. 1 (docs/SECURITATE_ANON_DREPTURI.md): obiectele din public folosite DIRECT de cererile fără cont, cu motivul (nume calificat,
--   ex. 'public.formular'). Azi NICIUNUL: paginile publice merg doar prin RPC SECURITY DEFINER și prin funcții edge. Rând nou = review nou.
anon_pastrate(obiect, motiv) AS (
  SELECT x.obiect, x.motiv FROM (VALUES (NULL::text, NULL::text)) x(obiect, motiv) WHERE x.obiect IS NOT NULL
),
anon_id(oid) AS (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = 'anon'),
-- „citește din”: o vedere -> relațiile din regula ei; un tabel -> relațiile din politicile lui (ambele evaluate cu drepturile celui care cere)
anon_muchii(de, la) AS (
  SELECT rw.ev_class, d.refobjid FROM pg_catalog.pg_rewrite rw
    JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = rw.oid
                               AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid <> rw.ev_class
  UNION
  SELECT pol.polrelid, d.refobjid FROM pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_policy'::regclass AND d.objid = pol.oid
                               AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid <> pol.polrelid
),
-- obiectele păstrate + tot ce citesc ele, tranzitiv
anon_pastrate_inchise(oid) AS (
  SELECT pg_catalog.to_regclass(p.obiect)::oid FROM anon_pastrate p WHERE pg_catalog.to_regclass(p.obiect) IS NOT NULL
  UNION
  SELECT m.la FROM anon_pastrate_inchise i JOIN anon_muchii m ON m.de = i.oid
),
-- tabelele în care anon POATE insera după politici: o politică PERMISSIVE pentru INSERT / ALL care include anon sau PUBLIC (expresia nu se
-- evaluează aici: prudent, secvențele lor rămân; dacă toate cer cont, se retrag odată cu tabelele, într-o treaptă ulterioară)
anon_insert_politici(oid) AS (
  SELECT pol.polrelid FROM pg_catalog.pg_policy pol, anon_id a
   WHERE pol.polpermissive AND pol.polcmd IN ('a', '*') AND (0::oid = ANY (pol.polroles) OR a.oid = ANY (pol.polroles))
),
-- secvențele din DEFAULT nextval(...) ale relațiilor păstrate și ale tabelelor de mai sus (INSERT-ul cere USAGE pe ele; coloanele IDENTITY
-- nu cer drept pe secvență, deci nu intră aici)
anon_secvente_pastrate(oid) AS (
  SELECT d.refobjid FROM (SELECT i.oid FROM anon_pastrate_inchise i UNION SELECT p.oid FROM anon_insert_politici p) i
    JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = i.oid
    JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_attrdef'::regclass AND d.objid = ad.oid
                               AND d.refclassid = 'pg_catalog.pg_class'::regclass
    JOIN pg_catalog.pg_class s ON s.oid = d.refobjid AND s.relkind = 'S'
),
-- relațiile din public și drepturile EXACTE ale lui anon pe ele (pe obiect și pe coloane, aclitem cu acordantul) + identitatea lor (v2)
anon_rel AS (
  SELECT c.oid, c.relkind::text AS tip, n.nspname::text AS nspname, c.relname::text AS relname,
         pg_catalog.pg_get_userbyid(c.relowner)::text AS proprietar,
         coalesce((SELECT array_agg(x.it::text ORDER BY x.it::text COLLATE "C") FROM unnest(c.relacl) x(it)
                    WHERE EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e, anon_id a WHERE e.grantee = a.oid)), '{}'::text[]) AS drepturi,
         coalesce((SELECT array_agg(att.attnum::text || ':' || att.atttypid::text || ':' || att.atttypmod::text || ' ' || quote_ident(att.attname)
                                    || ' ' || x.it::text ORDER BY att.attnum, x.it::text COLLATE "C")
                     FROM pg_catalog.pg_attribute att CROSS JOIN LATERAL unnest(att.attacl) x(it)
                    WHERE att.attrelid = c.oid AND NOT att.attisdropped
                      AND EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e, anon_id a WHERE e.grantee = a.oid)), '{}'::text[]) AS coloane,
         -- un drept al lui anon acordat de altcineva decât proprietarul: REVOKE-ul proprietarului nu l-ar scoate, revenirea nu l-ar reface exact
         (EXISTS (SELECT 1 FROM aclexplode(c.relacl) e, anon_id a WHERE e.grantee = a.oid AND e.grantor <> c.relowner)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute att CROSS JOIN LATERAL aclexplode(att.attacl) e, anon_id a
                      WHERE att.attrelid = c.oid AND NOT att.attisdropped AND e.grantee = a.oid AND e.grantor <> c.relowner)) AS alt_acordant,
         -- un drept pentru PUBLIC: anon îl are oricum (retragerea de la anon n-ar schimba dreptul efectiv), deci obiectul rămâne, cu motivul.
         -- (r4: blocarea din migrări nu mai folosește PUBLIC, ci un rol-santinelă creat în tranzacție.)
         (EXISTS (SELECT 1 FROM aclexplode(c.relacl) e WHERE e.grantee = 0)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute att CROSS JOIN LATERAL aclexplode(att.attacl) e
                      WHERE att.attrelid = c.oid AND NOT att.attisdropped AND e.grantee = 0)) AS are_public,
         (SELECT count(*) FROM pg_catalog.pg_policy pol, anon_id a
           WHERE pol.polrelid = c.oid AND (0::oid = ANY (pol.polroles) OR a.oid = ANY (pol.polroles)))::integer AS politici_anon,
         coalesce((SELECT o.option_value FROM pg_catalog.pg_options_to_table(c.reloptions) o WHERE o.option_name = 'security_invoker'), '-') AS invoker,
         c.relrowsecurity::text || '/' || c.relforcerowsecurity::text AS rls,
         coalesce((SELECT string_agg(i.inhparent::text, ',' ORDER BY i.inhseqno) FROM pg_catalog.pg_inherits i WHERE i.inhrelid = c.oid), '-') AS parinti,
         coalesce(array_to_string(c.reloptions, ','), '-') AS optiuni,
         coalesce((SELECT md5(string_agg(rw.rulename::text || ':' || rw.ev_type::text || ':' || rw.ev_enabled::text || ':' || rw.is_instead::text
                                         || ':' || rw.ev_qual::text || ':' || rw.ev_action::text, chr(10) ORDER BY rw.rulename COLLATE "C"))
                     FROM pg_catalog.pg_rewrite rw WHERE rw.ev_class = c.oid), '-') AS reguli,
         coalesce((SELECT md5(string_agg(pol.polname::text || ':' || pol.polcmd::text || ':' || pol.polpermissive::text || ':' || pol.polroles::text
                                         || ':' || coalesce(pol.polqual::text, '-') || ':' || coalesce(pol.polwithcheck::text, '-'),
                                         chr(10) ORDER BY pol.polname COLLATE "C"))
                     FROM pg_catalog.pg_policy pol WHERE pol.polrelid = c.oid), '-') AS politici,
         coalesce((SELECT md5(string_agg(y.l, chr(10) ORDER BY y.l COLLATE "C")) FROM (
                     SELECT ad.adrelid::text || '.' || ad.adnum::text || '=' || ad.adbin::text AS l FROM pg_catalog.pg_attrdef ad WHERE ad.adrelid = c.oid
                     UNION
                     SELECT ad.adrelid::text || '.' || ad.adnum::text || '=' || ad.adbin::text
                       FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_attrdef ad ON ad.oid = d.objid
                      WHERE d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = c.oid AND d.classid = 'pg_catalog.pg_attrdef'::regclass) y), '-') AS implicite
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
),
anon_regula(treapta, oid, eticheta, detaliu, drepturi, coloane, motiv) AS (
  SELECT x.treapta, x.oid, x.eticheta,
         'tip=' || x.tip || '; oid=' || x.oid::text || '; proprietar=' || x.proprietar || '; anon=' || array_to_string(x.drepturi, ',')
           || '; coloane=' || array_to_string(x.coloane, ';') || '; politici_anon=' || x.politici_anon::text || '; invoker=' || x.invoker
           || '; rls=' || x.rls || '; parinti=' || x.parinti || '; optiuni=' || x.optiuni || '; reguli=' || x.reguli
           || '; politici=' || x.politici || '; implicite=' || x.implicite,
         x.drepturi, x.coloane, x.motiv
    FROM (
      SELECT r.oid, r.tip, r.proprietar, r.drepturi, r.coloane, r.politici_anon, r.invoker, r.rls, r.parinti, r.optiuni, r.reguli, r.politici, r.implicite,
             CASE r.tip WHEN 'S' THEN 'secventa' WHEN 'v' THEN 'vedere' WHEN 'm' THEN 'vedere_materializata' WHEN 'f' THEN 'tabel_strain'
                        WHEN 'p' THEN 'tabel_partitionat' ELSE 'tabel' END || ' ' || quote_ident(r.nspname) || '.' || quote_ident(r.relname) AS eticheta,
             CASE WHEN r.proprietar <> 'postgres' OR r.alt_acordant OR r.are_public THEN 'RAMANE'
                  WHEN r.oid IN (SELECT i.oid FROM anon_pastrate_inchise i) THEN 'RAMANE'
                  WHEN r.tip = 'S' AND r.oid IN (SELECT s.oid FROM anon_secvente_pastrate s) THEN 'RAMANE'
                  WHEN r.tip = 'S' THEN 'T1'
                  WHEN r.politici_anon > 0 THEN 'RAMANE'
                  ELSE 'T2' END AS treapta,
             CASE WHEN r.proprietar <> 'postgres' THEN 'proprietar ' || r.proprietar || ': nu se poate retrage ca postgres'
                  WHEN r.alt_acordant THEN 'drept acordat de alt rol decat proprietarul'
                  WHEN r.are_public THEN 'drept pentru PUBLIC (reanaliza)'
                  WHEN r.oid IN (SELECT i.oid FROM anon_pastrate_inchise i) THEN 'folosit de o pagina publica (pct. 1) sau citit de un obiect folosit'
                  WHEN r.tip = 'S' AND r.oid IN (SELECT s.oid FROM anon_secvente_pastrate s) THEN 'secventa din DEFAULT-ul unui tabel in care anon poate insera (pagina publica / politica INSERT pentru anon sau PUBLIC)'
                  WHEN r.tip <> 'S' AND r.politici_anon > 0 THEN r.politici_anon::text || ' politici pentru anon / PUBLIC (in afara T2)'
             END AS motiv
        FROM anon_rel r
       WHERE cardinality(r.drepturi) > 0 OR cardinality(r.coloane) > 0
    ) x
  UNION ALL
  -- un obiect declarat la pct. 1 care nu există (nume greșit / șters): migrările refuză
  SELECT 'LIPSA', NULL::oid, 'pastrat ' || p.obiect, 'pastrat inexistent', '{}'::text[], '{}'::text[], p.motiv
    FROM anon_pastrate p WHERE pg_catalog.to_regclass(p.obiect) IS NULL
  UNION ALL
  -- drepturile implicite (obiectele NOI): T3 = cele ale lui postgres pe public, pentru tabele / vederi și secvențe
  SELECT CASE WHEN d.rol = 'postgres' AND d.schema = 'public' AND d.tip IN ('r', 'S') THEN 'T3' ELSE 'RAMANE' END,
         NULL::oid, 'implicit ' || d.rol || ' ' || d.schema || ' ' || d.tip, 'anon=' || array_to_string(d.drepturi, ','),
         d.drepturi, '{}'::text[],
         CASE WHEN d.rol = 'postgres' AND d.schema = 'public' AND d.tip IN ('r', 'S') THEN NULL
              WHEN d.rol <> 'postgres' THEN 'rolul ' || d.rol || ': nu se poate schimba ca postgres'
              WHEN d.schema <> 'public' THEN 'implicit global, pentru toate schemele (reanaliza)'
              ELSE 'tipul ' || d.tip || ' (in afara treptelor)' END
    FROM (
      SELECT pg_catalog.pg_get_userbyid(da.defaclrole)::text AS rol, coalesce(ns.nspname::text, '(global)') AS schema, da.defaclobjtype::text AS tip,
             (SELECT array_agg(x.it::text ORDER BY x.it::text COLLATE "C") FROM unnest(da.defaclacl) x(it)
               WHERE EXISTS (SELECT 1 FROM aclexplode(ARRAY[x.it]) e, anon_id a WHERE e.grantee = a.oid)) AS drepturi
        FROM pg_catalog.pg_default_acl da LEFT JOIN pg_catalog.pg_namespace ns ON ns.oid = da.defaclnamespace
       WHERE da.defaclnamespace = 0 OR ns.nspname = 'public'
    ) d
   WHERE d.drepturi IS NOT NULL
)
-- <<< REGULA_ANON v2
,
-- >>> AGREGAT_ANON v2
-- amprenta unei trepte = md5 pe liniile „eticheta = md5(detaliu)” sortate (colația C); numărul de obiecte alături. Treapta goală: 0 și md5('').
-- v2: și RAMANE (ce nu se retrage, cu motivul), pentru controlul periodic (secțiunea CONTROL a citirii): un obiect nou al lui supabase_admin,
--   o politică / un drept nou pe un obiect rămas îi schimbă amprenta.
anon_agregat(treapta, obiecte, amprenta) AS (
  SELECT t.treapta, count(g.eticheta)::integer,
         md5(coalesce(string_agg(g.eticheta || ' = ' || md5(g.detaliu), chr(10) ORDER BY g.eticheta COLLATE "C"), ''))
    FROM (VALUES ('T1'), ('T2'), ('T3'), ('RAMANE')) t(treapta)
    LEFT JOIN anon_regula g ON g.treapta = t.treapta
   GROUP BY t.treapta
)
-- <<< AGREGAT_ANON v2
,
anon_etape(etapa, ordine, aplicate) AS (VALUES ('dupa T1', 1, ARRAY['T1']), ('dupa T1+T2', 2, ARRAY['T1', 'T2']), ('dupa T1+T2+T3', 3, ARRAY['T1', 'T2', 'T3']))
SELECT y.sectiune, y.treapta, y.eticheta, y.amprenta, y.detaliu, y.motiv FROM (
  SELECT 'OBIECT' AS sectiune, 1 AS s, CASE g.treapta WHEN 'LIPSA' THEN 0 WHEN 'T1' THEN 1 WHEN 'T2' THEN 2 WHEN 'T3' THEN 3 ELSE 4 END AS o,
         g.treapta, g.eticheta, md5(g.detaliu) AS amprenta, g.detaliu, g.motiv
    FROM anon_regula g
  UNION ALL
  -- rândul de lipit, întreg, în blocul „>>> BASELINE” al migrării treptei (migrarea: coloana eticheta)
  SELECT 'BASELINE', 2, CASE a.treapta WHEN 'T1' THEN 1 WHEN 'T2' THEN 2 ELSE 3 END, a.treapta,
         CASE a.treapta WHEN 'T1' THEN '20261218a_securitate_anon_drepturi' WHEN 'T2' THEN '20261218b_securitate_anon_drepturi_tabele'
                        ELSE '20261218c_securitate_anon_drepturi_implicite' END,
         a.amprenta, format('    (%L, %s, %L)', a.treapta, a.obiecte, a.amprenta), a.obiecte::text || ' obiecte'
    FROM anon_agregat a WHERE a.treapta IN ('T1', 'T2', 'T3')
  UNION ALL
  -- controlul periodic: ce rămâne (nu se retrage), număr + amprentă
  SELECT 'CONTROL', 2, 4, a.treapta, 'ramane dupa toate treptele', a.amprenta, a.obiecte::text || ' obiecte', 'se compara cu ultima citire revizuita'
    FROM anon_agregat a WHERE a.treapta = 'RAMANE'
  UNION ALL
  -- r5 (review r4): politicile care numesc anon / PUBLIC pe relații din public unde anon NU are niciun drept efectiv (direct, prin PUBLIC
  -- sau prin apartenență; pe obiect sau pe coloane). Azi fără efect, dar un GRANT ulterior le-ar activa; RAMANE nu le vede (regula ia doar
  -- obiectele cu drepturi pentru anon). Număr + amprentă (oid, nume, comandă, fel, roluri, expresiile USING / CHECK din catalog); lista:
  -- secțiunea POLITICI_ANON, coloana anon_are_drept = false. Un rând mereu (0 politici = md5('')).
  SELECT 'CONTROL', 2, 5, 'POLITICI_ANON', 'politici anon / PUBLIC pe relatii fara drept anon', md5(coalesce(string_agg(p.l, chr(10) ORDER BY p.l COLLATE "C"), '')),
         count(p.l)::text || ' politici', 'se compara cu ultima citire revizuita'
    FROM (SELECT c.oid::text || ' ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ' ' || quote_ident(pol.polname) || ':' || pol.polcmd::text
                 || ':' || pol.polpermissive::text || ':' || pol.polroles::text || ':' || coalesce(pol.polqual::text, '-') || ':' || coalesce(pol.polwithcheck::text, '-') AS l
            FROM pg_catalog.pg_policy pol JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace, anon_id a
           WHERE n.nspname = 'public' AND (0::oid = ANY (pol.polroles) OR a.oid = ANY (pol.polroles))
             -- lista de drepturi = ORICARE dintre ele: NOT = niciunul
             AND NOT has_table_privilege(a.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
             AND NOT has_any_column_privilege(a.oid, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')) p
  UNION ALL
  -- ce mai are anon după fiecare treaptă (cumulat), pe categorie și motiv; detaliu = numărul de obiecte
  SELECT 'RAMANE', 3, e.ordine, e.etapa, split_part(g.eticheta, ' ', 1), NULL, count(*)::text,
         coalesce(g.motiv, 'de retras in ' || g.treapta)
    FROM anon_etape e JOIN anon_regula g ON NOT (g.treapta = ANY (e.aplicate))
   GROUP BY e.etapa, e.ordine, split_part(g.eticheta, ' ', 1), coalesce(g.motiv, 'de retras in ' || g.treapta)
) y
ORDER BY y.s, y.o, y.treapta, y.eticheta COLLATE "C", y.motiv COLLATE "C";

-- ── RPC_PUBLIC: funcțiile apelate de paginile publice (pct. 1). Așteptat: definer = true, anon_execute = true, search_path propriu ──
SELECT 'RPC_PUBLIC' AS sectiune, p.oid::regprocedure::text AS functie, p.prosecdef AS definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute, pg_get_userbyid(p.proowner) AS proprietar,
       coalesce(array_to_string(p.proconfig, '; '), '(mostenit)') AS config
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('fn_sedinte_rsvp_submit', 'fn_red_formular_public', 'fn_red_raspuns_public', 'fn_red_informare_publicata')
 ORDER BY 2;

-- ── FUNCTII_ANON: funcțiile din public / graphql_public pe care anon le poate apela și care rulează cu drepturile LUI (fără DEFINER):
--    după T2, una care atinge un obiect retras dă 42501 în loc de rezultat gol. Așteptat: niciuna folosită de o pagină publică (pct. 1) ──
SELECT 'FUNCTII_ANON' AS sectiune, n.nspname::text AS schema, p.oid::regprocedure::text AS functie, l.lanname::text AS limbaj,
       pg_get_userbyid(p.proowner) AS proprietar, p.prokind::text AS tip
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
 WHERE n.nspname IN ('public', 'graphql_public') AND NOT p.prosecdef AND p.prokind IN ('f', 'p')
   AND has_function_privilege('anon', p.oid, 'EXECUTE')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
   AND p.prorettype <> 'trigger'::regtype
 ORDER BY 2, 3;

-- ── POLITICI_ANON: politicile care includ anon sau PUBLIC (tabelele lor rămân în afara T2). Pentru o eventuală treaptă ulterioară:
--    dacă TOATE cer cont (auth.uid() nenul / profil) și SIMULARE arată 0 rânduri, se pot adăuga cu o migrare separată.
--    r5: anon_are_drept = false => politica e pe o relație fără niciun drept pentru anon (numărate în CONTROL POLITICI_ANON) ──
SELECT 'POLITICI_ANON' AS sectiune, c.oid::regclass::text AS tabel, pol.polname::text AS politica, pol.polcmd::text AS comanda,
       CASE WHEN pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END AS fel,
       (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        OR has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')) AS anon_are_drept,
       (SELECT string_agg(CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END, ',' ORDER BY 1) FROM unnest(pol.polroles) ro) AS roluri,
       coalesce(pg_get_expr(pol.polqual, pol.polrelid), 'true') AS using_expr,
       coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '(= USING)') AS check_expr
  FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND (0::oid = ANY (pol.polroles) OR 'anon'::regrole::oid = ANY (pol.polroles))
 ORDER BY 2, 3;

-- ── CONTEXT_POSTGREST (r6, review #1090): contextul pus de simulare și ce se vede din bază despre configurarea PostgREST ──
--    O cerere GET prin PostgREST cu cheia publică, fără sesiune, rulează într-o tranzacție în care PostgREST pune: rolul (anon), search_path
--    (schemele configurate + cele „extra”), request.jwt.claims (revendicările cheii), request.method, request.path, request.headers,
--    request.cookies; apoi funcția pre-request (dacă e configurată) și, din v12, setările rolului anon. SIMULARE pune: rolul anon;
--    search_path = public, extensions (valorile implicite Supabase); request.jwt.claims = {"iss":"supabase","role":"anon"}; formele vechi
--    request.jwt.claim.sub / .role = '' (pentru auth.uid / auth.role = „nepuse”); request.method = GET; request.path = /<relatia>;
--    request.headers = request.cookies = {} (puse, dar NEMODELATE: valorile reale nu se cunosc).
--    Setările MODELATE (valoarea simulată = cea reală): citite direct (current_setting) în vederi / politici: request.method, request.path,
--    request.jwt.claim.sub, request.jwt.claim.role; în plus, DOAR în corpul lui auth.uid() / auth.role(): request.jwt.claims (din care ele
--    citesc doar sub / role). Orice altă setare citită (request.jwt.claims direct, request.headers, chei calculate, setări proprii) => relația
--    e NEEXECUTATA, cu numele setării. Aici: setările din bază ale rolurilor anon / authenticator (DOAR numele: valorile pot conține secrete)
--    și dacă printre ele e pgrst.db_pre_request. LIMITĂ: configurarea PostgREST din afara bazei (variabile de mediu: pre-request, scheme) și
--    setările rolului anon aplicate de PostgREST (ex. statement_timeout) nu sunt simulate (vezi docs/SECURITATE_ANON_DREPTURI.md §2).
SELECT 'CONTEXT_POSTGREST' AS sectiune,
       EXISTS (SELECT 1 FROM pg_roles ro WHERE ro.rolname = 'authenticator') AS rol_authenticator,
       (SELECT coalesce(string_agg(k.c, ',' ORDER BY k.c), '-') FROM (
          SELECT DISTINCT split_part(x.s, '=', 1) AS c FROM pg_db_role_setting rs JOIN pg_roles ro ON ro.oid = rs.setrole, unnest(rs.setconfig) x(s)
           WHERE ro.rolname = 'anon' AND rs.setdatabase IN (0, (SELECT d.oid FROM pg_database d WHERE d.datname = current_database()))) k) AS setari_rol_anon,
       (SELECT coalesce(string_agg(k.c, ',' ORDER BY k.c), '-') FROM (
          SELECT DISTINCT split_part(x.s, '=', 1) AS c FROM pg_db_role_setting rs JOIN pg_roles ro ON ro.oid = rs.setrole, unnest(rs.setconfig) x(s)
           WHERE ro.rolname = 'authenticator' AND rs.setdatabase IN (0, (SELECT d.oid FROM pg_database d WHERE d.datname = current_database()))) k) AS setari_rol_authenticator,
       EXISTS (SELECT 1 FROM pg_db_role_setting rs JOIN pg_roles ro ON ro.oid = rs.setrole, unnest(rs.setconfig) x(s)
                WHERE ro.rolname = 'authenticator' AND split_part(x.s, '=', 1) = 'pgrst.db_pre_request') AS pre_request_in_baza,
       'public, extensions' AS search_path_simulat, 'GET' AS metoda_simulata, '{"iss":"supabase","role":"anon"}' AS revendicari_simulate;

-- ── SIMULARE (NOTICE): ca anon, în contextul unei cereri GET PostgREST fără sesiune (CONTEXT_POSTGREST), doar citire — ce CITEȘTE anon? ──
--    Ieșirea e o PROBĂ, nu o demonstrație: unde scriptul nu poate analiza, spune NEEXECUTATA / AMBIGUU, nu „dovedit”. T2 doar retrage
--    drepturi și se reface exact cu revenirea: o concluzie greșită aici nu scurge date, ci duce la o pagină cu „fără drept” după T2.
--    Pentru fiecare relație din public pe care anon o poate citi, în ordinea:
--    1. ANALIZA, FĂRĂ EXECUȚIE (r6, review #1090 P1.5): ÎNCHIDEREA relației = tot ce evaluează o citire ca anon, din catalog: regula de citire
--       a fiecărei vederi (arborele intern din pg_rewrite: relațiile :relid, funcțiile :funcid / :opfuncid / :aggfnoid / :winfnoid / ...,
--       operatorii :opno / :eqop / :sortop / :opnos -> funcția lor; plus pg_depend), recursiv prin vederi, și politicile pe care le aplică
--       CITITORUL EFECTIV al fiecărui tabel (r7, review r2 #1090 P1), recursiv prin relațiile citite de ele. Cititorul efectiv: anon pentru
--       relația citită direct și pentru relațiile unei vederi security_invoker (oriunde în lanț); PROPRIETARUL vederii pentru relațiile unei
--       vederi obișnuite (fiecare nivel); relațiile din politicile unui tabel = același cititor ca tabelul (probat pe PG 18). Politicile
--       aplicate: RLS pornit, SELECT / ALL, pentru PUBLIC sau pentru un rol ale cărui drepturi le are cititorul; niciuna dacă cititorul ocolește
--       RLS (superuser, BYPASSRLS, proprietarul tabelului fără FORCE) — linia „SIMULARE cititori pentru …” spune, înaintea execuției, ce tabel
--       e citit ca alt rol decât anon sau fără politici. Funcțiile din sistem nu
--       apar în pg_depend (sunt fixe), de aceea se citesc din arborele intern. Corpurile funcțiilor NU se urmăresc: e admisă DOAR LISTA ALBĂ:
--         - funcții de sistem (pg_catalog, create la initdb: oid < 16384), fără SECURITY DEFINER, fără SET în definiție, IMUABILE (prin
--           contract nu citesc baza, setări sau fișiere) sau STABILE de pe lista v_stabile (dată / oră, JSON, text: depind doar de fusul
--           orar / formate / limbă). Agregatele de sistem intră aici (count, sum, max, string_agg, json_agg ...);
--         - current_setting, doar dacă TOATE apelurile din vederile / politicile închiderii au cheie literală MODELATĂ (CONTEXT_POSTGREST);
--         - auth.uid() / auth.role() (schema auth, fără argumente, SQL, fără DEFINER / SET, corp citit la rulare): doar dacă tot ce citește
--           corpul sunt setările modelate, cu cheie literală, și nu citește tabele (fără FROM).
--       ORICE altă funcție (a noastră, de extensie, cu SET în definiție, SECURITY DEFINER, volatilă, de sistem stabilă din afara listei, ex.
--       query_to_xml / table_to_xml / pg_read_file / lo_get / pg_advisory_lock, auth.jwt()), inclusiv într-o politică a proprietarului unei
--       vederi obișnuite => relația NU SE EXECUTĂ deloc: clasa
--       NEEXECUTATA, cu numele funcției și motivul; contează ca AMBIGUU la concluzie.
--    2. EXECUȚIA (doar cu închiderea pe lista albă): se citesc VALORILE (cel mult 2 rânduri, doar coloanele citibile de anon). Clasa:
--      GOL                = 0 rânduri;
--      DATE_CITIBILE      = un rând cu o valoare nenulă / nezero sau ≥ 2 rânduri;
--      un rând cu TOATE valorile NULL / zero: forma rezultatului nu dovedește nimic; se judecă SURSA, pe calea de date a închiderii (vederi și
--                           relațiile citite de ele, fără relațiile citite doar de politici, care doar filtrează):
--        FARA_DATE_LA_SURSA = relația e o vedere security_invoker; pe calea de date doar relații din public: vederi security_invoker și cel
--                             puțin un tabel, fiecare citit EFECTIV ca anon (EXISTS): 42501 = fără drept, altfel 0 rânduri vizibile;
--        CONSTANTA (fără surse în catalog) = aceleași condiții, dar nicio relație pe calea de date (ex. VALUES): valorile vin doar din
--                             funcțiile listei albe;
--        DATE_CITIBILE      = tabel (rândul poate fi un rând de date); vedere materializată / tabel străin (la vârf sau pe calea de date);
--                             vedere fără security_invoker (citește ca proprietarul); un tabel de bază cu ≥ 1 rând vizibil ca anon;
--        AMBIGUU            = relație în afara schemelor noastre (inclusiv catalogul), dependență de alt fel, altă eroare decât 42501;
--      EROARE             = cererea pică (SQLSTATE + mesaj); 42501 = drept refuzat (nimic citit), altă eroare = NECUNOSCUT.
--    Concluzia „ZERO date citibile ca anon (proba pe aceasta baza, in limitele din document)” cere 0 DATE_CITIBILE, 0 AMBIGUU,
--    0 NEEXECUTATE și 0 erori necunoscute. LIMITE: docs/SECURITATE_ANON_DREPTURI.md §2. Valorile NU se afișează. Plafon 120 s pe tot blocul.
--    Interogările proprii ale scriptului poartă eticheta anon_drepturi_citire (STATISTICI le numără separat, ca „proprii”).
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = public, extensions;
SET LOCAL ROLE anon;
DO $simulare$
DECLARE
  r record; d record; v_b text; v_cols text; v_j jsonb;
  v_date integer := 0; v_sursa integer := 0; v_const integer := 0; v_gol integer := 0; v_err integer := 0; v_ambiguu integer := 0;
  v_neexec integer := 0; v_err_necunoscut integer := 0;
  v_baza integer; v_fara_drept integer; v_zero integer; v_ex boolean; v_m_date text; v_m_amb text; v_neadmise text; v_setari boolean;
  v_baze text[]; v_vederi oid[]; v_politici oid[]; v_cititori text; v_c1 bigint; v_c2 bigint; v_chei text; v_anon oid;
  v_scheme text[] := ARRAY['public'];   -- schemele noastre (lărgite doar prin review)
  -- lista albă a funcțiilor de sistem STABILE (în afara celor imuabile): rezultatul depinde doar de fusul orar / formate / limbă
  v_stabile text[] := ARRAY['now', 'statement_timestamp', 'transaction_timestamp', 'age', 'date', 'date_add', 'date_subtract', 'date_part',
    'date_trunc', 'extract', 'generate_series', 'make_timestamptz', 'overlaps', 'time', 'timetz', 'timestamp', 'timestamptz', 'timezone',
    'to_char', 'to_date', 'to_number', 'to_timestamp', 'interval_pl_timestamptz', 'timestamptz_pl_interval', 'timestamptz_mi_interval',
    'date_cmp_timestamptz', 'date_eq_timestamptz', 'date_ge_timestamptz', 'date_gt_timestamptz', 'date_le_timestamptz', 'date_lt_timestamptz',
    'date_ne_timestamptz', 'timestamp_cmp_timestamptz', 'timestamp_eq_timestamptz', 'timestamp_ge_timestamptz', 'timestamp_gt_timestamptz',
    'timestamp_le_timestamptz', 'timestamp_lt_timestamptz', 'timestamp_ne_timestamptz', 'timestamptz_cmp_date', 'timestamptz_eq_date',
    'timestamptz_ge_date', 'timestamptz_gt_date', 'timestamptz_le_date', 'timestamptz_lt_date', 'timestamptz_ne_date',
    'timestamptz_cmp_timestamp', 'timestamptz_eq_timestamp', 'timestamptz_ge_timestamp', 'timestamptz_gt_timestamp',
    'timestamptz_le_timestamp', 'timestamptz_lt_timestamp', 'timestamptz_ne_timestamp',
    'to_json', 'to_jsonb', 'array_to_json', 'row_to_json', 'json_agg', 'json_agg_strict', 'jsonb_agg', 'jsonb_agg_strict', 'json_object_agg',
    'json_object_agg_strict', 'json_object_agg_unique', 'json_object_agg_unique_strict', 'json_build_array', 'json_build_object',
    'jsonb_build_array', 'jsonb_build_object', 'json_populate_record', 'json_populate_recordset', 'json_to_record', 'json_to_recordset',
    'jsonb_populate_record', 'jsonb_populate_recordset', 'jsonb_to_record', 'jsonb_to_recordset', 'jsonb_path_exists_tz',
    'jsonb_path_match_tz', 'jsonb_path_query_tz', 'jsonb_path_query_array_tz', 'jsonb_path_query_first_tz',
    'array_to_string', 'concat', 'concat_ws', 'format', 'quote_literal', 'quote_nullable', 'anytextcat', 'textanycat', 'length', 'numeric',
    'money', 'to_tsvector', 'to_tsquery', 'plainto_tsquery', 'phraseto_tsquery', 'websearch_to_tsquery', 'ts_headline', 'json_to_tsvector',
    'jsonb_to_tsvector'];
  -- setările modelate, citite DIRECT (current_setting) în vederi / politici; auth.uid / auth.role pot citi în plus request.jwt.claims
  v_modelate text[] := ARRAY['request.method', 'request.path', 'request.jwt.claim.sub', 'request.jwt.claim.role'];
  v_re_noduri text := ':(relid|funcid|opfuncid|hashfuncid|negfuncid|aggfnoid|winfnoid|tsmhandler|startInRangeFunc|endInRangeFunc|opno|eqop|sortop) ([0-9]+)';
  v_re_liste text := ':opnos [(]o([ 0-9]*)[)]';
BEGIN
  SELECT /* anon_drepturi_citire */ ro.oid INTO v_anon FROM pg_roles ro WHERE ro.rolname = 'anon';
  -- contextul cererii (CONTEXT_POSTGREST); request.path se pune pentru fiecare relație, înainte de citire
  PERFORM /* anon_drepturi_citire */ set_config('request.jwt.claims', '{"iss":"supabase","role":"anon"}', true),
          set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', '', true),
          set_config('request.method', 'GET', true), set_config('request.headers', '{}', true), set_config('request.cookies', '{}', true);
  FOR r IN SELECT /* anon_drepturi_citire */ c.oid, c.relkind::text AS tip, c.relname::text AS relname,
                  quote_ident(n.nspname) || '.' || quote_ident(c.relname) AS nume
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND (has_table_privilege(c.oid, 'SELECT') OR has_any_column_privilege(c.oid, 'SELECT'))
            ORDER BY 2, 4 LOOP
    BEGIN
      -- ── 1. ANALIZA (fără execuție): închiderea + lista albă ──
      v_neadmise := NULL; v_m_date := NULL; v_m_amb := NULL; v_setari := false; v_baze := '{}'; v_vederi := '{}'; v_politici := '{}';
      v_cititori := NULL;
      FOR d IN
        -- r7 (review r2 #1090 P1): fiecare relație din închidere poartă CITITORUL EFECTIV (cititor = rolul cu ale cărui drepturi și politici
        -- e citită): anon la vârf; relațiile din regula unei vederi: anon dacă vederea e security_invoker (chiar imbricată într-o vedere
        -- obișnuită), altfel PROPRIETARUL vederii (fiecare nivel, pe lanț); relațiile din politicile unui tabel: același cititor ca tabelul.
        -- Politicile analizate = cele aplicate de PostgreSQL acelui cititor: RLS pornit, fără ocolire (superuser, BYPASSRLS, proprietarul
        -- tabelului / membru al lui fără FORCE), SELECT / ALL, pentru PUBLIC sau pentru un rol ale cărui drepturi le are (pg_has_role USAGE).
        WITH RECURSIVE /* anon_drepturi_citire */ inchidere(fel, cls, obj, cale, cititor) AS (
          SELECT 'rel'::text, 'pg_catalog.pg_class'::regclass::oid, r.oid, 'date'::text, v_anon
          UNION
          SELECT x.fel, x.cls, x.obj, x.cale, x.cititor FROM inchidere i CROSS JOIN LATERAL (
            -- arborii evaluați: regula de citire a unei vederi (cale = cea a vederii) și politicile aplicate cititorului (cale = politica)
            SELECT m.fel, m.cls, m.obj, s.cale, s.cititor
              FROM (SELECT rw.ev_action::text AS arbore, 'pg_catalog.pg_rewrite'::regclass::oid AS dcls, rw.oid AS dobj, i.cale,
                           CASE WHEN coalesce((SELECT o.option_value::boolean FROM pg_options_to_table(vc.reloptions) o
                                                WHERE o.option_name = 'security_invoker'), false) THEN v_anon
                                ELSE vc.relowner END AS cititor
                      FROM pg_rewrite rw JOIN pg_class vc ON vc.oid = rw.ev_class AND vc.relkind = 'v'
                     WHERE i.fel = 'rel' AND rw.ev_class = i.obj AND rw.ev_type = '1'
                    UNION ALL
                    SELECT coalesce(pol.polqual::text, ''), 'pg_catalog.pg_policy'::regclass::oid, pol.oid, 'politica', i.cititor
                      FROM pg_policy pol JOIN pg_class tc ON tc.oid = pol.polrelid AND tc.relrowsecurity
                     WHERE i.fel = 'rel' AND pol.polrelid = i.obj AND pol.polcmd IN ('r', '*')
                       AND NOT coalesce((SELECT (cr.rolsuper OR cr.rolbypassrls OR (pg_has_role(i.cititor, tc.relowner, 'USAGE') AND NOT tc.relforcerowsecurity))
                                           FROM pg_roles cr WHERE cr.oid = i.cititor), false)
                       AND (0::oid = ANY (pol.polroles)
                            OR EXISTS (SELECT 1 FROM unnest(pol.polroles) pr(o) WHERE pr.o <> 0 AND pg_has_role(i.cititor, pr.o, 'USAGE')))) s
              CROSS JOIN LATERAL (
                -- din arborele intern (vede și obiectele de sistem, pe care pg_depend nu le înregistrează)
                SELECT CASE WHEN e.k[1] = 'relid' THEN 'rel' WHEN e.k[1] IN ('opno', 'eqop', 'sortop') THEN 'op' ELSE 'fn' END AS fel,
                       CASE WHEN e.k[1] = 'relid' THEN 'pg_catalog.pg_class'::regclass::oid
                            WHEN e.k[1] IN ('opno', 'eqop', 'sortop') THEN 'pg_catalog.pg_operator'::regclass::oid
                            ELSE 'pg_catalog.pg_proc'::regclass::oid END AS cls,
                       e.k[2]::oid AS obj
                  FROM regexp_matches(s.arbore, v_re_noduri, 'g') e(k) WHERE e.k[2] <> '0'
                UNION ALL
                SELECT 'op', 'pg_catalog.pg_operator'::regclass::oid, o.x::oid
                  FROM regexp_matches(s.arbore, v_re_liste, 'g') e(k), regexp_split_to_table(btrim(e.k[1]), ' +') o(x) WHERE o.x <> ''
                UNION ALL
                -- din pg_depend (obiectele utilizatorilor, inclusiv constantele regclass)
                SELECT CASE dp.refclassid WHEN 'pg_catalog.pg_class'::regclass::oid THEN 'rel' WHEN 'pg_catalog.pg_proc'::regclass::oid THEN 'fn'
                                          WHEN 'pg_catalog.pg_operator'::regclass::oid THEN 'op' ELSE 'alt' END,
                       dp.refclassid, dp.refobjid
                  FROM pg_depend dp WHERE dp.classid = s.dcls AND dp.objid = s.dobj
                UNION ALL
                -- politica însăși (verificarea cheilor din current_setting se face pe exact politicile aplicate)
                SELECT 'pol', s.dcls, s.dobj WHERE s.dcls = 'pg_catalog.pg_policy'::regclass::oid
              ) m
            UNION ALL
            -- operator: funcția lui
            SELECT 'fn', 'pg_catalog.pg_proc'::regclass::oid, o.oprcode::oid, i.cale, i.cititor
              FROM pg_operator o WHERE i.fel = 'op' AND o.oid = i.obj AND o.oprcode::oid <> 0
          ) x
          WHERE NOT (x.fel = i.fel AND x.obj = i.obj)
        )
        SELECT i.fel, i.cls, i.obj, i.cale, i.cititori, c.relkind::text AS relkind, cn.nspname::text AS rel_schema,
               -- tabel cu RLS citit de alt rol decât anon sau de un rol care ocolește RLS: cine îl citește și ce politici se aplică
               CASE WHEN c.relkind IN ('r', 'p') AND c.relrowsecurity THEN
                 (SELECT string_agg(pg_get_userbyid(cr.oid) || ' ('
                           || CASE WHEN cr.rolsuper THEN 'superuser: ocoleste RLS, fara politici de analizat'
                                   WHEN cr.rolbypassrls THEN 'BYPASSRLS: ocoleste RLS, fara politici de analizat'
                                   WHEN pg_has_role(cr.oid, c.relowner, 'USAGE') AND NOT c.relforcerowsecurity
                                     THEN 'proprietarul tabelului, fara FORCE: ocoleste RLS, fara politici de analizat'
                                   ELSE 'politicile lui analizate' END || ')', ', ' ORDER BY cr.rolname)
                    FROM pg_roles cr WHERE cr.oid = ANY (i.cititori)
                     AND (cr.oid <> v_anon OR cr.rolsuper OR cr.rolbypassrls OR (pg_has_role(cr.oid, c.relowner, 'USAGE') AND NOT c.relforcerowsecurity)))
               END AS cititori_info,
               quote_ident(cn.nspname) || '.' || quote_ident(c.relname) AS rel_nume,
               (SELECT o.option_value::boolean FROM pg_options_to_table(c.reloptions) o WHERE o.option_name = 'security_invoker') AS invoker,
               p.oid IS NOT NULL AS e_functie, p.prosecdef, p.proconfig IS NULL AS fara_config,
               (SELECT string_agg(split_part(cf.s, '=', 1), ',') FROM unnest(p.proconfig) cf(s)) AS config_chei,
               p.provolatile::text AS volatil, pn.nspname::text AS pro_schema, p.proname::text AS proname, p.pronargs,
               l.lanname::text AS limbaj, p.prosrc, p.prosqlbody IS NOT NULL AS corp_atomic, p.oid < 16384 AS sistem,
               quote_ident(pn.nspname) || '.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS functie
          FROM (SELECT j.fel, j.cls, j.obj, min(j.cale) AS cale, array_agg(DISTINCT j.cititor) AS cititori FROM inchidere j GROUP BY j.fel, j.cls, j.obj) i
          LEFT JOIN pg_class c ON i.fel = 'rel' AND c.oid = i.obj
          LEFT JOIN pg_namespace cn ON cn.oid = c.relnamespace
          LEFT JOIN pg_proc p ON i.fel = 'fn' AND p.oid = i.obj
          LEFT JOIN pg_namespace pn ON pn.oid = p.pronamespace
          LEFT JOIN pg_language l ON l.oid = p.prolang
         ORDER BY i.fel, i.cale, i.obj
      LOOP
        IF d.fel = 'fn' THEN
          IF NOT d.e_functie THEN
            v_neadmise := concat_ws('; ', v_neadmise, 'functie inexistenta in catalog (oid ' || d.obj::text || ')');
          ELSIF d.pro_schema = 'pg_catalog' AND d.sistem AND NOT d.prosecdef AND d.fara_config AND (d.volatil = 'i' OR d.proname = ANY (v_stabile)) THEN
            NULL;   -- lista albă: funcție de sistem imuabilă sau stabilă din v_stabile
          ELSIF d.pro_schema = 'pg_catalog' AND d.sistem AND NOT d.prosecdef AND d.fara_config AND d.proname = 'current_setting' THEN
            v_setari := true;   -- admisă doar dacă toate cheile sunt literale și modelate (după închidere)
          ELSIF d.pro_schema = 'auth' AND d.proname IN ('uid', 'role') AND d.pronargs = 0 AND NOT d.prosecdef AND d.fara_config
                AND d.limbaj = 'sql' AND d.volatil IN ('i', 's') AND NOT d.corp_atomic THEN
            -- corpul: doar current_setting cu cheie literală modelată (+ request.jwt.claims), fără citiri din tabele
            SELECT /* anon_drepturi_citire */ count(*) INTO v_c1 FROM regexp_matches(d.prosrc, 'current_setting[[:space:]]*[(]', 'gi') m;
            SELECT /* anon_drepturi_citire */ count(*) FILTER (WHERE m.k[1] = ANY (v_modelate || 'request.jwt.claims'::text)),
                   string_agg(DISTINCT m.k[1], ',') FILTER (WHERE NOT (m.k[1] = ANY (v_modelate || 'request.jwt.claims'::text)))
              INTO v_c2, v_chei FROM regexp_matches(d.prosrc, 'current_setting[[:space:]]*[(][[:space:]]*''([^'']*)''', 'gi') m(k);
            IF v_c1 = 0 OR v_c1 <> v_c2 OR d.prosrc ~* '[[:<:]]from[[:>:]]' THEN
              v_neadmise := concat_ws('; ', v_neadmise, d.functie || ' [corp in afara listei: setari ' || coalesce(v_chei, 'calculate / tabele') || ']');
            END IF;
          ELSE
            v_neadmise := concat_ws('; ', v_neadmise, d.functie || ' [' ||
              CASE WHEN d.prosecdef THEN 'SECURITY DEFINER'
                   WHEN NOT d.fara_config THEN 'SET in definitie: ' || d.config_chei
                   WHEN d.pro_schema = 'auth' AND d.proname = 'jwt' THEN 'revendicarile complete ale cheii (ref / iat / exp) nu sunt modelate'
                   WHEN d.pro_schema = 'pg_catalog' AND d.sistem AND d.volatil = 'v' THEN 'de sistem, volatila'
                   WHEN d.pro_schema = 'pg_catalog' AND d.sistem THEN 'de sistem, stabila, in afara listei'
                   ELSE 'proprie / de extensie, limbaj ' || coalesce(d.limbaj, '?') || ', '
                        || CASE d.volatil WHEN 'i' THEN 'imuabila' WHEN 's' THEN 'stabila' ELSE 'volatila' END END || ']');
          END IF;
        ELSIF d.fel = 'pol' THEN
          v_politici := v_politici || d.obj;
        ELSIF d.fel = 'rel' THEN
          IF d.relkind = 'v' THEN v_vederi := v_vederi || d.obj; END IF;
          IF d.cititori_info IS NOT NULL THEN v_cititori := concat_ws('; ', v_cititori, d.rel_nume || ' citit ca ' || d.cititori_info); END IF;
          IF d.cale = 'date' THEN
            -- calea de date (vederi și ce citesc ele): pentru „un rând doar NULL / zero”; primul motiv de DATE_CITIBILE câștigă, apoi AMBIGUU
            IF d.relkind IS NULL THEN
              v_m_amb := coalesce(v_m_amb, 'relatie inexistenta in catalog (oid ' || d.obj::text || ')');
            ELSIF NOT (d.rel_schema = ANY (v_scheme)) THEN
              v_m_amb := coalesce(v_m_amb, 'relatie in afara schemelor noastre: ' || d.rel_nume);
            ELSIF d.relkind = 'v' THEN
              IF d.invoker IS NOT TRUE THEN
                v_m_date := coalesce(v_m_date, CASE WHEN d.obj = r.oid THEN 'vedere fara security_invoker: citeste ca proprietarul'
                                                    ELSE 'vedere intermediara fara security_invoker (citeste ca proprietarul): ' || d.rel_nume END);
              END IF;
            ELSIF d.relkind IN ('r', 'p') THEN
              -- proba la sursă citește tabelul DIRECT ca anon: doar dacă politicile lui anon pe el sunt în analiză (anon e printre cititori)
              IF v_anon = ANY (d.cititori) THEN v_baze := v_baze || d.rel_nume;
              ELSE v_m_amb := coalesce(v_m_amb, 'tabel de baza citit doar ca alt rol decat anon: ' || d.rel_nume); END IF;
            ELSE
              v_m_date := coalesce(v_m_date, 'relatie cu date proprii fara RLS in inchidere (tip ' || d.relkind || '): ' || d.rel_nume);
            END IF;
          END IF;
        ELSIF d.fel = 'alt' THEN
          IF d.cls NOT IN ('pg_catalog.pg_type'::regclass, 'pg_catalog.pg_namespace'::regclass, 'pg_catalog.pg_collation'::regclass,
                           'pg_catalog.pg_language'::regclass, 'pg_catalog.pg_extension'::regclass) THEN
            v_m_amb := coalesce(v_m_amb, 'dependenta de alt fel: ' || d.cls::regclass::text);
          END IF;
        END IF;   -- operator: funcția lui e deja în închidere
      END LOOP;
      -- current_setting în închidere: fiecare apel din arborii vederilor / politicilor închiderii trebuie să aibă ca prim argument o
      -- CONSTANTĂ text cu o cheie MODELATĂ. Cheia se decodează din arborele intern (octeții constantei, fără antetul varlena), fără
      -- deparsare; o cheie calculată nu e o constantă => numărătorile diferă => refuz.
      IF v_setari THEN
        WITH /* anon_drepturi_citire */ t(x) AS (
          SELECT rw.ev_action::text FROM pg_rewrite rw WHERE rw.ev_class = ANY (v_vederi) AND rw.ev_type = '1'
          UNION ALL
          SELECT pol.polqual::text FROM pg_policy pol WHERE pol.oid = ANY (v_politici) AND pol.polqual IS NOT NULL),
        f(o) AS (SELECT p.oid::text FROM pg_proc p WHERE p.proname = 'current_setting' AND p.pronamespace = 'pg_catalog'::regnamespace),
        apel(cheie) AS (
          SELECT (SELECT convert_from(decode(string_agg(lpad(to_hex((o.b::integer + 256) % 256), 2, '0'), '' ORDER BY o.n), 'hex'), 'UTF8')
                    FROM regexp_split_to_table(btrim(m.k[3]), ' +') WITH ORDINALITY o(b, n)
                   WHERE o.n > CASE WHEN (split_part(btrim(m.k[3]), ' ', 1)::integer & 1) = 1 THEN 1 ELSE 4 END)
            FROM t, regexp_matches(t.x, '[{]FUNCEXPR :funcid (' || (SELECT string_agg(f.o, '|') FROM f) || ') [^{]*:args [(]'
                                        || '([{]CONST :consttype 25 [^[}]*:constvalue [0-9]+ [[] ([-0-9 ]+) []])?', 'g') m(k))
        SELECT (SELECT count(*) FROM apel), (SELECT count(*) FROM apel a WHERE a.cheie = ANY (v_modelate)),
               (SELECT string_agg(DISTINCT coalesce(a.cheie, 'cheie calculata'), ',') FROM apel a WHERE a.cheie IS NULL OR NOT (a.cheie = ANY (v_modelate)))
          INTO v_c1, v_c2, v_chei;
        IF v_c1 = 0 OR v_c1 <> v_c2 THEN
          v_neadmise := concat_ws('; ', v_neadmise, 'pg_catalog.current_setting [setari nemodelate: ' || coalesce(v_chei, 'cheie calculata') || ']');
        END IF;
      END IF;
      -- cine citește efectiv tabelele cu RLS ale închiderii, când nu e anon cu politicile lui (înaintea oricărei execuții)
      IF v_cititori IS NOT NULL THEN
        RAISE NOTICE 'SIMULARE cititori pentru %: %', r.nume, v_cititori;
      END IF;
      IF v_neadmise IS NOT NULL THEN
        v_neexec := v_neexec + 1;
        RAISE NOTICE 'SIMULARE anon NEEXECUTATA in % (functie in afara listei: %)', r.nume, v_neadmise;
        CONTINUE;
      END IF;
      -- ── 2. EXECUȚIA (închiderea e toată pe lista albă) ──
      PERFORM /* anon_drepturi_citire */ set_config('request.path', '/' || r.relname, true);
      -- doar coloanele citibile de anon (cu drepturi doar pe unele coloane, SELECT * ar da 42501 fără să spună nimic despre date)
      SELECT /* anon_drepturi_citire */ string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols FROM pg_attribute a
       WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege(r.oid, a.attnum, 'SELECT');
      IF v_cols IS NULL THEN
        v_err := v_err + 1; RAISE NOTICE 'SIMULARE anon EROARE la % (-): nicio coloana citibila', r.nume; CONTINUE;
      END IF;
      -- „alias.*” = rândul întreg (un „to_jsonb(x)” simplu ar lua coloana x, dacă relația are una cu acest nume)
      EXECUTE 'SELECT /* anon_drepturi_citire */ coalesce(jsonb_agg(to_jsonb(anon_sim_q.*)), ''[]''::jsonb) FROM (SELECT ' || v_cols || ' FROM ' || r.nume || ' LIMIT 2) anon_sim_q' INTO v_j;
      IF jsonb_array_length(v_j) = 0 THEN
        v_gol := v_gol + 1;
      ELSIF jsonb_array_length(v_j) = 1
            AND NOT EXISTS (SELECT /* anon_drepturi_citire */ 1 FROM jsonb_each(v_j -> 0) e
                             WHERE NOT (jsonb_typeof(e.value) = 'null' OR (jsonb_typeof(e.value) = 'number' AND e.value::text::numeric = 0))) THEN
        -- un rând, doar NULL / zero: proba la SURSĂ, pe calea de date a închiderii
        v_baza := 0; v_fara_drept := 0; v_zero := 0;
        IF r.tip <> 'v' THEN
          v_m_amb := NULL;
          v_m_date := CASE r.tip WHEN 'm' THEN 'vedere materializata: date proprii, fara RLS' WHEN 'f' THEN 'tabel strain: date proprii, fara RLS'
                                 ELSE 'tabel: randul poate fi un rand de date' END;
        ELSIF v_m_date IS NULL THEN
          -- (r7: cu motivul de DATE_CITIBILE deja stabilit, tabelele nu se mai citesc)
          FOREACH v_b IN ARRAY v_baze LOOP
            -- tabel de bază: citire EFECTIVĂ ca anon (RLS aplicat, politicile lui sunt deja pe lista albă); 42501 = fără drept
            v_baza := v_baza + 1;
            BEGIN
              EXECUTE 'SELECT /* anon_drepturi_citire */ EXISTS (SELECT 1 FROM ' || v_b || ')' INTO v_ex;
              IF v_ex THEN v_m_date := coalesce(v_m_date, 'tabel de baza cu randuri vizibile ca anon: ' || v_b);
              ELSE v_zero := v_zero + 1; END IF;
            EXCEPTION
              WHEN insufficient_privilege THEN v_fara_drept := v_fara_drept + 1;
              WHEN OTHERS THEN v_m_amb := coalesce(v_m_amb, 'eroare ' || SQLSTATE || ' la citirea tabelului de baza ' || v_b);
            END;
          END LOOP;
        END IF;
        IF v_m_date IS NOT NULL THEN
          v_date := v_date + 1; RAISE NOTICE 'SIMULARE anon DATE_CITIBILE in % (1 rand doar NULL / zero; %)', r.nume, v_m_date;
        ELSIF v_m_amb IS NOT NULL THEN
          v_ambiguu := v_ambiguu + 1; RAISE NOTICE 'SIMULARE anon AMBIGUU in % (1 rand doar NULL / zero; %)', r.nume, v_m_amb;
        ELSIF v_baza > 0 THEN
          v_sursa := v_sursa + 1;
          RAISE NOTICE 'SIMULARE anon FARA_DATE_LA_SURSA in % (1 rand doar NULL / zero; % tabele de baza: % fara drept, % cu 0 randuri vizibile)',
            r.nume, v_baza, v_fara_drept, v_zero;
        ELSE
          v_const := v_const + 1;
          RAISE NOTICE 'SIMULARE anon CONSTANTA (fara surse in catalog) in % (1 rand doar NULL / zero; nicio relatie pe calea de date, doar functii din lista alba)', r.nume;
        END IF;
      ELSE
        v_date := v_date + 1; RAISE NOTICE 'SIMULARE anon DATE_CITIBILE in % (% randuri citite, valorile nu se afiseaza)', r.nume, jsonb_array_length(v_j);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := v_err + 1;
      IF SQLSTATE <> '42501' THEN v_err_necunoscut := v_err_necunoscut + 1; END IF;
      RAISE NOTICE 'SIMULARE anon EROARE la % (%): %', r.nume, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'SIMULARE rezumat: rolul curent %, % relatii cu date citibile, % ambigue, % neexecutate, % fara date la sursa, % constante (fara surse in catalog), % goale, % erori (din care % necunoscute, altele decat 42501)',
    current_user, v_date, v_ambiguu, v_neexec, v_sursa, v_const, v_gol, v_err, v_err_necunoscut;
  RAISE NOTICE 'SIMULARE concluzie: %', CASE WHEN v_date = 0 AND v_ambiguu = 0 AND v_neexec = 0 AND v_err_necunoscut = 0
    THEN 'ZERO date citibile ca anon (proba pe aceasta baza, in limitele din document)'
    ELSE 'NEDOVEDIT: ' || v_date || ' cu date citibile, ' || v_ambiguu || ' ambigue, ' || v_neexec || ' neexecutate, ' || v_err_necunoscut
         || ' erori necunoscute - de analizat inainte de T2' END;
END $simulare$;
RESET /* anon_drepturi_citire */ ROLE;

-- ── STATISTICI (NOTICE): interogările rulate ca anon, din pg_stat_statements (dacă extensia e instalată și încărcată) ──
--    Fiecare intrare a lui anon din baza curentă, cu clasa ei (r6, review #1090 P2): forma generată de PostgREST începe cu
--    „WITH pgrst_<nume> AS” (pgrst_source, pgrst_args); cu „pgrst_call” = rpc (apel de funcție), altfel, dacă numește "public"."…" =
--    directa (citire / scriere pe o relație din public), DOAR la intrările de la nivelul de sus (r7: toplevel = false = imbricat => alta).
--    Restul = alta (SQL scris de mână, citiri interne din funcții cu track = all, oricare le-ar fi textul, PostgREST pe alte scheme);
--    eticheta anon_drepturi_citire = proprie (interogările acestui script); textul ascuns = ascunsa.
--    Linia fiecărei intrări: queryid | apeluri | stats_since (PG 17: momentul de la care curg contoarele ACELEI intrări) | sus / imbricat.
--    Rezumatul de comparat între două citiri (regula: docs/SECURITATE_ANON_DREPTURI.md §2):
--      „STATISTICI rezumat anon | directe: N interogari, S apeluri | rpc: … | alte: … | proprii: P | resetare | evacuari | ascunse | track |
--       stats_since | martor | dovada: …”
--    Martorul = interogarea de configurare pe care PostgREST o rulează la începutul FIECĂREI cereri (select set_config(...)), înregistrată
--    sub anon la cererile fără sesiune: crește la orice cerere fără sesiune, deci arată că sesiunile PostgREST chiar sunt urmărite (e
--    numărată și la „alte”). LIPSĂ DE DOVADĂ: text ascuns, track ≠ top / all, setări
--    pg_stat_statements pe rolurile anon / authenticator, fără stats_since, resetare / evacuări necunoscute, martor absent.
DO $statistici$
DECLARE r record; s record; v_schema text; v_reset text; v_dealloc text; v_track text; v_cfg text; v_martor text; v_clasa text;
        v_since boolean := true; v_top boolean := true; v_db oid;
BEGIN
  SELECT n.nspname INTO v_schema FROM pg_extension x JOIN pg_namespace n ON n.oid = x.extnamespace WHERE x.extname = 'pg_stat_statements';
  -- r4: sărit = LIPSĂ DE DOVADĂ, nu „zero apeluri ca anon” (condiția T2 cere statistici citite efectiv)
  IF v_schema IS NULL THEN RAISE NOTICE 'STATISTICI: extensia pg_stat_statements nu e instalata - LIPSA DE DOVADA (nu inseamna zero apeluri ca anon)'; RETURN; END IF;
  SELECT dd.oid INTO v_db FROM pg_database dd WHERE dd.datname = current_database();
  v_track := coalesce(current_setting('pg_stat_statements.track', true), 'necunoscut');
  SELECT string_agg(DISTINCT ro.rolname || ':' || split_part(x.s, '=', 1), ',') INTO v_cfg
    FROM pg_db_role_setting rs JOIN pg_roles ro ON ro.oid = rs.setrole, unnest(rs.setconfig) x(s)
   WHERE ro.rolname IN ('anon', 'authenticator') AND rs.setdatabase IN (0, v_db) AND starts_with(split_part(x.s, '=', 1), 'pg_stat_statements.');
  BEGIN  -- extensia poate fi instalata fara sa fie incarcata (clona locala): nu e eroare a citirii
    BEGIN
      EXECUTE format('SELECT 1 FROM %I.pg_stat_statements s WHERE s.stats_since IS NULL LIMIT 0', v_schema);
    EXCEPTION WHEN undefined_column THEN v_since := false;
    END;
    BEGIN
      EXECUTE format('SELECT 1 FROM %I.pg_stat_statements s WHERE s.toplevel LIMIT 0', v_schema);
    EXCEPTION WHEN undefined_column THEN v_top := false;
    END;
    -- r7 (review r2 #1090 P2): o intrare imbricată (toplevel = false: SQL rulat din interiorul unei funcții, cu track = all) nu e o cerere
    -- PostgREST, oricât ar semăna textul => alta (linia ei poartă marcajul „imbricat”). Fără coloana toplevel (PG < 14): prudent, după text.
    v_clasa := format('CASE WHEN s.query IS NULL OR s.query = %L THEN %L WHEN strpos(s.query, %L) > 0 THEN %L %s'
                      'WHEN s.query ~ %L AND strpos(s.query, %L) > 0 THEN %L WHEN s.query ~ %L AND strpos(s.query, %L) > 0 THEN %L ELSE %L END',
                      '<insufficient privilege>', 'ascunsa', 'anon_drepturi_citire', 'proprie',
                      CASE WHEN v_top THEN 'WHEN s.toplevel IS NOT TRUE THEN ''alta'' ' ELSE '' END,
                      '^WITH pgrst_[a-z]+ AS', 'pgrst_call', 'rpc', '^WITH pgrst_[a-z]+ AS', '"public"."', 'directa', 'alta');
    FOR r IN EXECUTE format('SELECT z.* FROM (SELECT s.queryid, s.calls, %s AS since, %s AS nivel, %s AS clasa, '
                            '       left(regexp_replace(coalesce(s.query, %L), %L, %L, %L), 300) AS q '
                            '  FROM %I.pg_stat_statements s WHERE s.userid = %L::regrole AND s.dbid = %s) z '
                            ' ORDER BY z.clasa <> %L, z.clasa, z.calls DESC, z.queryid LIMIT 1000',
                            CASE WHEN v_since THEN 's.stats_since::text' ELSE 'NULL::text' END,
                            CASE WHEN v_top THEN 'CASE WHEN s.toplevel THEN ''sus'' ELSE ''imbricat'' END' ELSE '''?''' END,
                            v_clasa, '', '[[:space:]]+', ' ', 'g', v_schema, 'anon', v_db, 'directa') LOOP
      RAISE NOTICE 'STATISTICI anon %: queryid % | % apeluri | stats_since % | % | %', r.clasa, r.queryid, r.calls, coalesce(r.since, 'necunoscut'), r.nivel, r.q;
    END LOOP;
    BEGIN
      EXECUTE format('SELECT stats_reset::text, dealloc::text FROM %I.pg_stat_statements_info', v_schema) INTO v_reset, v_dealloc;
    EXCEPTION WHEN undefined_table OR undefined_column THEN v_reset := NULL; v_dealloc := NULL;
    END;
    -- martorul: pg_stat_statements înregistrează interogarea sub rolul de la sfârșitul ei (după set_config('role', ...) = anon la
    -- cererile fără sesiune); se caută întâi la anon, apoi la authenticator; interogările proprii ale scriptului nu contează
    EXECUTE format('SELECT %L || ro.rolname || %L || s.queryid::text || %L || s.calls::text || %L || coalesce(%s, %L) '
                   '  FROM %I.pg_stat_statements s JOIN pg_roles ro ON ro.oid = s.userid '
                   ' WHERE ro.rolname IN (%L, %L) AND s.dbid = %s AND strpos(coalesce(s.query, %L), %L) > 0 AND strpos(coalesce(s.query, %L), %L) = 0 '
                   ' ORDER BY ro.rolname = %L DESC, s.calls DESC, s.queryid LIMIT 1',
                   'rol ', ' | queryid ', ' | ', ' apeluri | stats_since ', CASE WHEN v_since THEN 's.stats_since::text' ELSE 'NULL::text' END, 'necunoscut',
                   v_schema, 'anon', 'authenticator', v_db, '', 'set_config(', '', 'anon_drepturi_citire', 'anon') INTO v_martor;
    RAISE NOTICE 'STATISTICI martor (configurarea fiecarei cereri PostgREST): %', coalesce(v_martor, 'absent');
    EXECUTE format('SELECT count(*) FILTER (WHERE z.clasa = %L) AS n_dir, coalesce(sum(z.calls) FILTER (WHERE z.clasa = %L), 0) AS s_dir, '
                   '       count(*) FILTER (WHERE z.clasa = %L) AS n_rpc, coalesce(sum(z.calls) FILTER (WHERE z.clasa = %L), 0) AS s_rpc, '
                   '       count(*) FILTER (WHERE z.clasa = %L) AS n_alt, coalesce(sum(z.calls) FILTER (WHERE z.clasa = %L), 0) AS s_alt, '
                   '       count(*) FILTER (WHERE z.clasa = %L) AS n_prop, count(*) FILTER (WHERE z.clasa = %L) AS n_asc '
                   '  FROM (SELECT s.calls, %s AS clasa FROM %I.pg_stat_statements s WHERE s.userid = %L::regrole AND s.dbid = %s) z',
                   'directa', 'directa', 'rpc', 'rpc', 'alta', 'alta', 'proprie', 'ascunsa', v_clasa, v_schema, 'anon', v_db) INTO s;
    RAISE NOTICE 'STATISTICI rezumat anon | directe: % interogari, % apeluri | rpc: % interogari, % apeluri | alte: % interogari, % apeluri | proprii: % | resetare: % | evacuari: % | ascunse: % | track: % | stats_since: % | martor: % | dovada: %',
      s.n_dir, s.s_dir, s.n_rpc, s.s_rpc, s.n_alt, s.s_alt, s.n_prop, coalesce(v_reset, 'necunoscuta'), coalesce(v_dealloc, 'necunoscut'), s.n_asc,
      v_track, CASE WHEN v_since THEN 'da' ELSE 'nu' END, CASE WHEN v_martor IS NULL THEN 'absent' ELSE 'da' END,
      CASE WHEN s.n_asc > 0 THEN 'LIPSA DE DOVADA (texte ascunse: cititorul nu vede toate interogarile)'
           WHEN v_track NOT IN ('top', 'all') THEN 'LIPSA DE DOVADA (track = ' || v_track || ': interogarile nu se colecteaza)'
           WHEN v_cfg IS NOT NULL THEN 'LIPSA DE DOVADA (setari pg_stat_statements pe roluri: ' || v_cfg || ')'
           WHEN NOT v_since THEN 'LIPSA DE DOVADA (fara stats_since pe intrari: resetarile selective nu se vad)'
           WHEN v_reset IS NULL OR v_dealloc IS NULL THEN 'LIPSA DE DOVADA (momentul resetarii / evacuarile necunoscute)'
           WHEN v_martor IS NULL THEN 'LIPSA DE DOVADA (martor absent: colectarea pentru sesiunile PostgREST nu se vede)'
           ELSE 'DA' END;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    RAISE NOTICE 'STATISTICI: pg_stat_statements instalata, dar neincarcata (shared_preload_libraries) - sectiune sarita = LIPSA DE DOVADA (nu inseamna zero apeluri ca anon)';
  END;
END $statistici$;
ROLLBACK;
