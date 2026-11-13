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
--   pentru anon, pentru controlul periodic), RAMANE (ce mai are anon după fiecare treaptă), RPC_PUBLIC, FUNCTII_ANON, POLITICI_ANON; apoi
--   NOTICE-urile SIMULARE (ce citește anon azi, ca anon, doar citire; r5: „un rând doar NULL / zero” confirmat la SURSĂ) și STATISTICI
--   (interogările rulate ca anon, cu queryid, și linia-rezumat de comparat între două citiri, dacă extensia de statistici e încărcată).
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

-- ── SIMULARE (NOTICE): ca anon (JWT fără utilizator), doar citire — ce CITEȘTE anon efectiv din relațiile pe care are drept de citire? ──
--    Se citesc VALORILE (cel mult 2 rânduri, doar coloanele pe care anon le poate citi), nu doar existența unui rând (r2, review #1081 P2:
--    EXISTS nu evaluează valorile, iar o vedere-agregat dă un rând chiar fără date). Fiecare relație primește UNA din clasele:
--      GOL                = 0 rânduri;
--      DATE_CITIBILE      = un rând cu o valoare nenulă / nezero sau ≥ 2 rânduri => o pagină / un client poate depinde de acel drept: se
--                           analizează ÎNAINTE de T2;
--      un rând cu TOATE valorile NULL / zero: FORMA rezultatului nu dovedește nimic (r5, review r4: `sum` peste 1 și -1 dă tot zero,
--                           `coalesce(sum(x), 0)` dă 0 și fără rânduri; un tabel cu un rând vizibil „(0)” arată la fel). Se verifică SURSA,
--                           din catalog și prin citire efectivă ca anon. ÎNCHIDEREA vederii = dependențele înregistrate în pg_depend ale
--                           regulii ei de citire (pg_rewrite), urmărite recursiv prin vederi, prin funcțiile cu corp analizat (SQL cu
--                           BEGIN ATOMIC, agregate) și prin operatorii definiți de utilizator (spre funcțiile lor). Clasa:
--        FARA_DATE_LA_SURSA = DOVEDIT: relația e o vedere cu security_invoker = on; închiderea are doar relații din schemele noastre (public):
--                             vederi, toate cu security_invoker = on, și tabele, cel puțin unul, fiecare citit EFECTIV ca anon (EXISTS):
--                             42501 = fără drept, altfel 0 rânduri vizibile; funcțiile din închidere: fără SECURITY DEFINER și analizabile
--                             (de sistem din pg_catalog, corp analizat, sau auth.uid / auth.role / auth.jwt, vezi mai jos);
--        CONSTANTA          = DOVEDIT (nu e scurgere): aceleași condiții, dar închiderea nu are niciun tabel (ex. VALUES, constante): valorile
--                             nu vin din niciun tabel. Contraexemplul review-ului (`sum` peste VALUES (1), (-1)) intră aici;
--        DATE_CITIBILE      = tabel (rândul poate fi chiar un rând de date); vedere materializată / tabel străin / secvență, la vârf sau în
--                             închidere (date proprii, fără RLS); vedere fără security_invoker, la vârf sau intermediară (citește ca
--                             proprietarul ei); un tabel de bază din închidere cu ≥ 1 rând vizibil ca anon;
--        AMBIGUU            = neconfirmat, cu motivul (numele) în mesaj: funcție SECURITY DEFINER (poate ocoli RLS), funcție cu corpul citit
--                             la rulare (plpgsql, SQL fără BEGIN ATOMIC, C ...: dependențele ei nu sunt în catalog), relație în afara
--                             schemelor noastre, dependență de alt fel, altă eroare decât 42501 la citirea unui tabel de bază;
--      EROARE             = cererea pică (SQLSTATE + mesaj); 42501 = drept refuzat (nimic citit), altă eroare = rezultat NECUNOSCUT.
--    auth.uid() / auth.role() / auth.jwt() (schema auth, fără argumente, fără SECURITY DEFINER; potrivire exactă pe schemă + nume + număr de
--    argumente) sunt acceptate explicit, deși corpul lor e SQL fără BEGIN ATOMIC: sunt funcțiile platformei care întorc revendicările JWT ale
--    cererii (aici JWT-ul simulat fără utilizator => NULL / „anon”), nu valori din tabele, și rulează cu drepturile apelantului (anon), deci nu
--    pot ocoli RLS. Politicile RLS ale tabelelor de bază nu intră în închidere: ele doar FILTREAZĂ rândurile acelui tabel, iar filtrul e deja
--    aplicat de citirea efectivă ca anon (o funcție DEFINER dintr-o politică nu scoate valori în vedere).
--    LIMITE (ce nu vede închiderea): SQL construit la rulare de funcții de sistem (ex. query_to_xml('select ...')), cast-urile prin funcțiile de
--    intrare / ieșire ale tipurilor și constrângerile domeniilor; dependențele pe obiectele fixe ale sistemului nu sunt înregistrate (sunt
--    tratate ca funcții de sistem). Toate rulează cu drepturile lui anon (RLS aplicat), dar tabelele citite așa nu sunt verificate aici.
--    Concluzia „zero date citibile” cere 0 DATE_CITIBILE, 0 AMBIGUU și 0 erori necunoscute (linia „SIMULARE concluzie”); FARA_DATE_LA_SURSA și
--    CONSTANTA contează ca dovedit. Valorile NU se afișează (doar clasa, numele relației și numărătorile). Tot blocul are plafon 120 s; la
--    depășire = eroare, se rulează pe clonă.
SET LOCAL statement_timeout = '120s';
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('request.jwt.claim.role', 'anon', true),
       set_config('request.jwt.claim.sub', '', true);
DO $simulare$
DECLARE r record; d record; v_cols text; v_j jsonb; v_date integer := 0; v_sursa integer := 0; v_const integer := 0; v_gol integer := 0;
        v_err integer := 0; v_ambiguu integer := 0; v_err_necunoscut integer := 0;
        v_baza integer; v_fara_drept integer; v_zero integer; v_ex boolean; v_m_date text; v_m_amb text;
        v_scheme text[] := ARRAY['public'];   -- schemele noastre (lărgite doar prin review)
BEGIN
  FOR r IN SELECT c.oid, c.relkind::text AS tip, quote_ident(n.nspname) || '.' || quote_ident(c.relname) AS nume FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND (has_table_privilege(c.oid, 'SELECT') OR has_any_column_privilege(c.oid, 'SELECT'))
            ORDER BY 2 LOOP
    BEGIN
      -- doar coloanele citibile de anon (cu drepturi doar pe unele coloane, SELECT * ar da 42501 fără să spună nimic despre date)
      SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols FROM pg_attribute a
       WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege(r.oid, a.attnum, 'SELECT');
      IF v_cols IS NULL THEN
        v_err := v_err + 1; RAISE NOTICE 'SIMULARE anon EROARE la % (-): nicio coloana citibila', r.nume; CONTINUE;
      END IF;
      -- „alias.*” = rândul întreg (un „to_jsonb(x)” simplu ar lua coloana x, dacă relația are una cu acest nume)
      EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(anon_sim_q.*)), ''[]''::jsonb) FROM (SELECT ' || v_cols || ' FROM ' || r.nume || ' LIMIT 2) anon_sim_q' INTO v_j;
      IF jsonb_array_length(v_j) = 0 THEN
        v_gol := v_gol + 1;
      ELSIF jsonb_array_length(v_j) = 1
            AND NOT EXISTS (SELECT 1 FROM jsonb_each(v_j -> 0) e
                             WHERE NOT (jsonb_typeof(e.value) = 'null' OR (jsonb_typeof(e.value) = 'number' AND e.value::text::numeric = 0))) THEN
        -- un rând, doar NULL / zero (r5): dovada la SURSĂ. Primul motiv de DATE_CITIBILE câștigă, apoi primul de AMBIGUU.
        v_baza := 0; v_fara_drept := 0; v_zero := 0; v_m_date := NULL; v_m_amb := NULL;
        IF r.tip <> 'v' THEN
          v_m_date := CASE r.tip WHEN 'm' THEN 'vedere materializata: date proprii, fara RLS' WHEN 'f' THEN 'tabel strain: date proprii, fara RLS'
                                 ELSE 'tabel: randul poate fi un rand de date' END;
        ELSE
          FOR d IN
            WITH RECURSIVE inchidere(cls, obj) AS (
              SELECT 'pg_catalog.pg_class'::regclass::oid, r.oid
              UNION
              SELECT x.cls, x.obj FROM inchidere i CROSS JOIN LATERAL (
                -- vedere: dependențele regulii ei de citire (fără ea însăși)
                SELECT dp.refclassid AS cls, dp.refobjid AS obj
                  FROM pg_rewrite rw JOIN pg_depend dp ON dp.classid = 'pg_catalog.pg_rewrite'::regclass AND dp.objid = rw.oid
                 WHERE i.cls = 'pg_catalog.pg_class'::regclass AND rw.ev_class = i.obj AND rw.ev_type = '1'
                   AND EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = i.obj AND c.relkind = 'v')
                UNION ALL
                -- operator definit de utilizator: funcțiile lui; funcție fără DEFINER, din afara pg_catalog, cu corp analizat: tot ce citește
                SELECT dp.refclassid, dp.refobjid FROM pg_depend dp
                 WHERE dp.classid = i.cls AND dp.objid = i.obj
                   AND (i.cls = 'pg_catalog.pg_operator'::regclass
                        OR (i.cls = 'pg_catalog.pg_proc'::regclass
                            AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = i.obj AND NOT p.prosecdef AND p.pronamespace <> 'pg_catalog'::regnamespace
                                          AND (p.prosqlbody IS NOT NULL OR p.prokind = 'a'))))
              ) x
              WHERE NOT (x.cls = i.cls AND x.obj = i.obj)
            )
            SELECT i.cls, i.obj, c.relkind::text AS relkind, cn.nspname::text AS rel_schema,
                   quote_ident(cn.nspname) || '.' || quote_ident(c.relname) AS rel_nume,
                   (SELECT o.option_value::boolean FROM pg_options_to_table(c.reloptions) o WHERE o.option_name = 'security_invoker') AS invoker,
                   p.oid IS NOT NULL AS e_functie, p.prosecdef, pn.nspname::text AS pro_schema, p.proname::text AS proname, p.pronargs,
                   p.prokind::text AS prokind, p.prosqlbody IS NOT NULL AS are_corp, l.lanname::text AS limbaj, p.oid::regprocedure::text AS functie
              FROM inchidere i
              LEFT JOIN pg_class c ON i.cls = 'pg_catalog.pg_class'::regclass AND c.oid = i.obj
              LEFT JOIN pg_namespace cn ON cn.oid = c.relnamespace
              LEFT JOIN pg_proc p ON i.cls = 'pg_catalog.pg_proc'::regclass AND p.oid = i.obj
              LEFT JOIN pg_namespace pn ON pn.oid = p.pronamespace
              LEFT JOIN pg_language l ON l.oid = p.prolang
             ORDER BY i.cls, i.obj
          LOOP
            IF d.cls = 'pg_catalog.pg_class'::regclass THEN
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
                -- tabel de bază: citire EFECTIVĂ ca anon (RLS aplicat); 42501 = fără drept
                v_baza := v_baza + 1;
                BEGIN
                  EXECUTE 'SELECT EXISTS (SELECT 1 FROM ' || d.rel_nume || ')' INTO v_ex;
                  IF v_ex THEN v_m_date := coalesce(v_m_date, 'tabel de baza cu randuri vizibile ca anon: ' || d.rel_nume);
                  ELSE v_zero := v_zero + 1; END IF;
                EXCEPTION
                  WHEN insufficient_privilege THEN v_fara_drept := v_fara_drept + 1;
                  WHEN OTHERS THEN v_m_amb := coalesce(v_m_amb, 'eroare ' || SQLSTATE || ' la citirea tabelului de baza ' || d.rel_nume);
                END;
              ELSE
                v_m_date := coalesce(v_m_date, 'relatie cu date proprii fara RLS in inchidere (tip ' || d.relkind || '): ' || d.rel_nume);
              END IF;
            ELSIF d.cls = 'pg_catalog.pg_proc'::regclass THEN
              IF NOT d.e_functie THEN
                v_m_amb := coalesce(v_m_amb, 'functie inexistenta in catalog (oid ' || d.obj::text || ')');
              ELSIF d.prosecdef THEN
                v_m_amb := coalesce(v_m_amb, 'functie SECURITY DEFINER (poate ocoli RLS): ' || d.functie);
              ELSIF d.pro_schema = 'pg_catalog' THEN
                NULL;   -- funcție de sistem, cu drepturile apelantului
              ELSIF d.pro_schema = 'auth' AND d.proname IN ('uid', 'role', 'jwt') AND d.pronargs = 0 THEN
                NULL;   -- revendicările JWT ale cererii (vezi antetul)
              ELSIF d.are_corp OR d.prokind = 'a' THEN
                NULL;   -- corp analizat: dependențele lui sunt deja în închidere
              ELSE
                v_m_amb := coalesce(v_m_amb, 'functie cu corpul citit la rulare (limbaj ' || d.limbaj || ', neanalizabil): ' || d.functie);
              END IF;
            ELSIF d.cls IN ('pg_catalog.pg_operator'::regclass, 'pg_catalog.pg_type'::regclass, 'pg_catalog.pg_namespace'::regclass,
                            'pg_catalog.pg_collation'::regclass, 'pg_catalog.pg_language'::regclass, 'pg_catalog.pg_extension'::regclass) THEN
              NULL;   -- operator: urmărit prin funcțiile lui; tip / schemă / colație / limbaj / extensie: nu citesc date
            ELSE
              v_m_amb := coalesce(v_m_amb, 'dependenta de alt fel: ' || d.cls::regclass::text);
            END IF;
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
          RAISE NOTICE 'SIMULARE anon CONSTANTA in % (1 rand doar NULL / zero; nu citeste niciun tabel: constante / functii de sistem)', r.nume;
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
  RAISE NOTICE 'SIMULARE rezumat: rolul curent %, % relatii cu date citibile, % ambigue neconfirmate, % fara date la sursa (dovedit), % constante (dovedit), % goale, % erori (din care % necunoscute, altele decat 42501)',
    current_user, v_date, v_ambiguu, v_sursa, v_const, v_gol, v_err, v_err_necunoscut;
  RAISE NOTICE 'SIMULARE concluzie: %', CASE WHEN v_date = 0 AND v_ambiguu = 0 AND v_err_necunoscut = 0 THEN 'ZERO date citibile ca anon (dovedit pe aceasta baza)'
    ELSE 'NEDOVEDIT: ' || v_date || ' cu date citibile, ' || v_ambiguu || ' ambigue, ' || v_err_necunoscut || ' erori necunoscute - de analizat inainte de T2' END;
END $simulare$;
RESET ROLE;

-- ── STATISTICI (NOTICE): interogările rulate ca anon de la ultima resetare a statisticilor (dacă extensia e instalată) ──
--    Așteptat: doar apelurile RPC ale paginilor publice (fn_red_*, fn_sedinte_rsvp_submit) și ce face platforma; un SELECT / INSERT direct
--    pe un tabel din public = de analizat înainte de T2. Jurnalele API (cererile /rest/v1 fără utilizator) le citește coordonatorul separat.
--    r5: fiecare linie are queryid; la final O linie-rezumat stabilă, de comparat între două citiri (docs/SECURITATE_ANON_DREPTURI.md §2):
--      „STATISTICI rezumat anon | directe: N interogari, S apeluri | rpc: … | resetare: <moment> | evacuari: <dealloc> | ascunse: <k> | dovada: …”
--    directe = interogările distincte (queryid) ale lui anon din baza curentă care numesc o RELAȚIE din public în forma PostgREST
--    („"public"."nume"” urmat de altceva decât „(”; PostgREST le pune în pgrst_source); rpc = aceeași formă urmată de „(” (apel de funcție).
--    Textul „<insufficient privilege>” (cititorul nu vede textul interogării) sau momentul resetării necunoscut = LIPSA DE DOVADA.
DO $statistici$
DECLARE r record; v_schema text; v_rel text; v_rpc text; v_reset text; v_dealloc text;
BEGIN
  SELECT n.nspname INTO v_schema FROM pg_extension x JOIN pg_namespace n ON n.oid = x.extnamespace WHERE x.extname = 'pg_stat_statements';
  -- r4: sărit = LIPSĂ DE DOVADĂ, nu „zero apeluri ca anon” (condiția T2 cere statistici citite efectiv)
  IF v_schema IS NULL THEN RAISE NOTICE 'STATISTICI: extensia pg_stat_statements nu e instalata - LIPSA DE DOVADA (nu inseamna zero apeluri ca anon)'; RETURN; END IF;
  -- fără backslash: punctul și ghilimelele ca clase de caractere
  v_rel := '"public"[.]"[^"]+"[[:space:]]*([^([:space:]]|$)';
  v_rpc := '"public"[.]"[^"]+"[[:space:]]*[(]';
  BEGIN  -- extensia poate fi instalata fara sa fie incarcata (clona locala): nu e eroare a citirii
  FOR r IN EXECUTE format('SELECT s.queryid, s.calls, left(regexp_replace(s.query, %L, %L, %L), 300) AS q FROM %I.pg_stat_statements s '
                          'WHERE s.userid = %L::regrole ORDER BY s.calls DESC, s.queryid LIMIT 300', '[[:space:]]+', ' ', 'g', v_schema, 'anon') LOOP
    RAISE NOTICE 'STATISTICI anon: queryid % | % apeluri | %', r.queryid, r.calls, r.q;
  END LOOP;
  BEGIN
    EXECUTE format('SELECT stats_reset::text, dealloc::text FROM %I.pg_stat_statements_info', v_schema) INTO v_reset, v_dealloc;
  EXCEPTION WHEN undefined_table OR undefined_column THEN v_reset := NULL; v_dealloc := NULL;
  END;
  EXECUTE format('SELECT count(DISTINCT s.queryid) FILTER (WHERE s.directa) AS n_dir, coalesce(sum(s.calls) FILTER (WHERE s.directa), 0) AS s_dir, '
                 '       count(DISTINCT s.queryid) FILTER (WHERE s.rpc) AS n_rpc, coalesce(sum(s.calls) FILTER (WHERE s.rpc), 0) AS s_rpc, '
                 '       count(*) FILTER (WHERE s.ascunsa) AS ascunse '
                 '  FROM (SELECT x.queryid, x.calls, (x.query IS NULL OR x.query = %L) AS ascunsa, coalesce(x.query ~ %L, false) AS directa, '
                 '               coalesce(x.query ~ %L, false) AS rpc '
                 '          FROM %I.pg_stat_statements x '
                 '         WHERE x.userid = %L::regrole AND x.dbid = (SELECT d.oid FROM pg_database d WHERE d.datname = current_database())) s',
                 '<insufficient privilege>', v_rel, v_rpc, v_schema, 'anon') INTO r;
  RAISE NOTICE 'STATISTICI rezumat anon | directe: % interogari, % apeluri | rpc: % interogari, % apeluri | resetare: % | evacuari: % | ascunse: % | dovada: %',
    r.n_dir, r.s_dir, r.n_rpc, r.s_rpc, coalesce(v_reset, 'necunoscuta'), coalesce(v_dealloc, 'necunoscut'), r.ascunse,
    CASE WHEN r.ascunse > 0 THEN 'LIPSA DE DOVADA (texte ascunse: cititorul nu vede toate interogarile)'
         WHEN v_reset IS NULL OR v_dealloc IS NULL THEN 'LIPSA DE DOVADA (momentul resetarii / evacuarile necunoscute)'
         ELSE 'DA' END;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    RAISE NOTICE 'STATISTICI: pg_stat_statements instalata, dar neincarcata (shared_preload_libraries) - sectiune sarita = LIPSA DE DOVADA (nu inseamna zero apeluri ca anon)';
  END;
END $statistici$;
ROLLBACK;
