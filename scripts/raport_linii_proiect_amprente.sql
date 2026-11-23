-- Amprenta L15 pentru migrarea 20261217a_executie_raport_linii_proiect — DOAR CITIRE, pentru coordonator, pe PRODUCȚIE (și pe clonă).
-- Rulare (o tranzacție READ ONLY, nimic scris; parola din pgpass, niciodată în comandă):
--   psql -X -v ON_ERROR_STOP=1 -h <host> -p <port> -U <user> -d postgres -f scripts/raport_linii_proiect_amprente.sql > amprente_20261217a.txt
-- Ce tipărește (același format ca scripts/raport_rezumat_amprente.sql / scripts/tichete_lot2_amprente.sql):
--   eticheta | amprenta (md5 pe „detaliu”) | linie_baseline (de copiat în blocul BASELINE al migrării) | sursa | atentie | detaliu
--   * tabelele: raport_lucrari și (r4) raport_distributie_linii (pe ele stau trigger-ele noi), rapoarte_zilnice și sites (rândurile lor
--     sunt blocate de trigger-e; ordinea lock-urilor se sprijină pe trigger-ele lor: garda rezumatului și mutarea șantierului, 20261216a) —
--     drepturi pe tabel / coloane / secvențe, proprietar, RLS + FORCE, TOATE politicile, inventarul triggerelor;
--     r4: cele 47 de etichete lipite pe 12.11.2026 trebuie să iasă IDENTIC; etichetele noi (raport_distributie_linii + funcțiile trigger-elor
--     ei) iau locul rândurilor DE_COMPLETAT din migrare (blocul se lipește întreg, în ordinea afișată);
--   * funcțiile: pornirea = fn_raport_zilnic_salveaza (singura cale a aplicației care scrie liniile), funcțiile din politicile / triggerele
--     celor patru tabele (le găsește catalogul) și „indiciile” = numele apare în corpul unei funcții din listă (callee tranzitiv; plpgsql nu
--     lasă pg_depend). Indiciul e DOAR o propunere pentru revizor: poarta din migrare nu caută nimic în text, compară exact lista din BASELINE;
--   * „atentie” = ce trebuie privit cu ochii înainte de a accepta baseline-ul (drepturi pentru anon / PUBLIC, politici USING true,
--     DEFINER fără search_path, EXECUTE în corp).
-- Cum se folosește: coloana linie_baseline, în ordinea afișată, se copiază ÎNTREAGĂ între marcajele „>>> BASELINE 20261217a” /
--   „<<< BASELINE 20261217a” ale migrării (singurul loc din migrare cu valori de producție), iar „detaliu” intră în review. Migrarea refuză
--   până atunci (baseline necompletat) și refuză orice diferență față de el, înainte și după schimbare (excepțiile „după”: antetul migrării).
-- Corpul de calcul dintre marcajele AMPRENTA_L15 e IDENTIC (octet cu octet, fără CR) cu cel din scripts/tichete_lot2_amprente.sql și din
--   migrare (L19, testul src/raportLiniiProiectAmprente.test.js); search_path fixat la public, pg_temp, ca numele să iasă la fel peste tot.
\set ON_ERROR_STOP 1
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = public, pg_temp;
SELECT current_database() AS baza, (SELECT system_identifier FROM pg_control_system()) AS sistem, version() AS versiune, now() AS la;

\echo
\echo '=== 20261217a_executie_raport_linii_proiect — raport_lucrari, raport_distributie_linii, rapoarte_zilnice, sites + salvarea raportului ==='
WITH RECURSIVE
-- >>> INTRARE 20261217a
amp_tabele(oid) AS (VALUES ('public.raport_lucrari'::regclass::oid), ('public.raport_distributie_linii'::regclass::oid), ('public.rapoarte_zilnice'::regclass::oid), ('public.sites'::regclass::oid)),
amp_pornire(oid) AS (VALUES (to_regprocedure('public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, jsonb, integer, uuid)')::oid)),
-- <<< INTRARE 20261217a
amp_start(oid, sursa) AS (
  SELECT s.oid, 'pornire' FROM amp_pornire s
  UNION
  SELECT d.refobjid, 'politica' FROM pg_depend d JOIN pg_policy pol ON pol.oid = d.objid
   WHERE d.classid = 'pg_policy'::regclass AND d.refclassid = 'pg_proc'::regclass AND pol.polrelid IN (SELECT t.oid FROM amp_tabele t)
  UNION
  SELECT tg.tgfoid, 'trigger' FROM pg_trigger tg WHERE tg.tgrelid IN (SELECT t.oid FROM amp_tabele t) AND NOT tg.tgisinternal
),
amp_lant(oid, adancime) AS (
  SELECT s.oid, 0 FROM amp_start s
  UNION
  SELECT p2.oid, l.adancime + 1 FROM amp_lant l JOIN pg_proc p ON p.oid = l.oid
    JOIN pg_proc p2 ON p2.oid <> p.oid AND p2.pronamespace IN ('public'::regnamespace, to_regnamespace('auth'), to_regnamespace('executie_acces_intern'))
     AND p.prolang IN (SELECT lg.oid FROM pg_language lg WHERE lg.lanname IN ('sql', 'plpgsql')) AND p.prosrc ~* ('\m' || p2.proname || '\M')
   WHERE l.adancime < 6
),
amp_functii_explicite(oid) AS (SELECT DISTINCT l.oid FROM amp_lant l),
-- >>> AMPRENTA_L15 v1
amp_functii(oid) AS (
  SELECT f.oid FROM amp_functii_explicite f WHERE f.oid IS NOT NULL
  UNION
  SELECT d.refobjid FROM pg_depend d JOIN pg_policy pol ON pol.oid = d.objid
   WHERE d.classid = 'pg_policy'::regclass AND d.refclassid = 'pg_proc'::regclass AND pol.polrelid IN (SELECT t.oid FROM amp_tabele t)
  UNION
  SELECT tg.tgfoid FROM pg_trigger tg WHERE tg.tgrelid IN (SELECT t.oid FROM amp_tabele t) AND NOT tg.tgisinternal
),
amp_calc(eticheta, amprenta, detaliu) AS (
  SELECT x.eticheta, md5(x.detaliu), x.detaliu FROM (
    -- drepturile pe tabel (relacl NULL = implicitul proprietarului); rolul 0 = PUBLIC; * = cu GRANT OPTION
    SELECT 'tabel ' || c.oid::regclass::text || ' | acl' AS eticheta,
           coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
             SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
               FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e) a), '(niciun drept)') AS detaliu
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- drepturile pe coloane (doar coloanele cu drepturi proprii)
    SELECT 'tabel ' || c.oid::regclass::text || ' | acl coloane',
           coalesce((SELECT string_agg(a.d, '; ' ORDER BY a.d COLLATE "C") FROM (
             SELECT att.attname::text || ' ' || CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
               FROM pg_attribute att CROSS JOIN LATERAL aclexplode(att.attacl) e
              WHERE att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped AND att.attacl IS NOT NULL) a), '(fara drepturi pe coloane)')
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- proprietarul, tipul, RLS și FORCE RLS
    SELECT 'tabel ' || c.oid::regclass::text || ' | rls',
           'proprietar=' || pg_get_userbyid(c.relowner) || ', tip=' || c.relkind::text || ', rls=' || c.relrowsecurity::text
           || ', force=' || c.relforcerowsecurity::text
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- secvențele tabelului (serial / identity) și drepturile lor
    SELECT 'tabel ' || c.oid::regclass::text || ' | secvente',
           coalesce((SELECT string_agg(a.d, '; ' ORDER BY a.d COLLATE "C") FROM (
             SELECT s.oid::regclass::text || ' ' || CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
               FROM pg_depend dp JOIN pg_class s ON s.oid = dp.objid AND s.relkind = 'S'
               CROSS JOIN LATERAL aclexplode(coalesce(s.relacl, acldefault('s', s.relowner))) e
              WHERE dp.classid = 'pg_class'::regclass AND dp.refclassid = 'pg_class'::regclass AND dp.refobjid = c.oid
                AND dp.deptype IN ('a', 'i')) a), '(fara secvente)')
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- TOATE politicile: comanda, PERMISSIVE / RESTRICTIVE, rolurile, USING (NULL = true), WITH CHECK (NULL = același USING)
    SELECT 'tabel ' || c.oid::regclass::text || ' | politici',
           coalesce((SELECT string_agg(a.d, chr(10) ORDER BY a.d COLLATE "C") FROM (
             SELECT pol.polname::text || ' | ' || pol.polcmd::text || ' | ' || CASE WHEN pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END
                    || ' | roluri=' || coalesce((SELECT string_agg(r.n, ',' ORDER BY r.n COLLATE "C") FROM (
                         SELECT CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END AS n FROM unnest(pol.polroles) ro) r), '-')
                    || ' | USING ' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), 'true')
                    || ' | CHECK ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '(= USING)') AS d
               FROM pg_policy pol WHERE pol.polrelid = c.oid) a), '(fara politici)')
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- triggerele (fără cele interne de FK): funcția, starea (O / D / R / A), definiția întreagă (moment, evenimente, WHEN)
    SELECT 'tabel ' || c.oid::regclass::text || ' | triggere',
           coalesce((SELECT string_agg(a.d, chr(10) ORDER BY a.d COLLATE "C") FROM (
             SELECT tg.tgname::text || ' | ' || tg.tgfoid::regprocedure::text || ' | stare=' || tg.tgenabled::text || ' | ' || pg_get_triggerdef(tg.oid) AS d
               FROM pg_trigger tg WHERE tg.tgrelid = c.oid AND NOT tg.tgisinternal) a), '(fara triggere)')
      FROM pg_class c WHERE c.oid IN (SELECT t.oid FROM amp_tabele t)
    UNION ALL
    -- funcțiile (pornire + politici + triggere + callee-urile din BASELINE): proprietăți, drepturi, md5 pe corp (fără CR)
    SELECT 'functie ' || p.oid::regprocedure::text,
           'tip=' || p.prokind::text || ', limbaj=' || l.lanname::text || ', definer=' || p.prosecdef::text || ', volatil=' || p.provolatile::text
           || ', strict=' || p.proisstrict::text || ', leakproof=' || p.proleakproof::text || ', proprietar=' || pg_get_userbyid(p.proowner)
           || ', config=' || coalesce(array_to_string(p.proconfig, '; '), '(mostenit)') || ', intoarce=' || coalesce(pg_get_function_result(p.oid), '-')
           || ', acl=' || coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                  FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '(niciun drept)')
           || ', corp_md5=' || md5(replace(p.prosrc, chr(13), ''))
           || ', sqlbody_md5=' || coalesce(md5(replace(pg_get_function_sqlbody(p.oid), chr(13), '')), '-')
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid IN (SELECT f.oid FROM amp_functii f)
  ) x
)
-- <<< AMPRENTA_L15 v1
SELECT c.eticheta, c.amprenta,
       CASE WHEN row_number() OVER (ORDER BY c.eticheta COLLATE "C") = 1 THEN '    ' ELSE '  , ' END || format('(%L, %L)', c.eticheta, c.amprenta) AS linie_baseline,
       CASE WHEN c.eticheta LIKE 'functie %' THEN
              coalesce((SELECT string_agg(DISTINCT s.sursa, ', ') FROM amp_start s WHERE s.oid = to_regprocedure(substr(c.eticheta, 9))), 'indiciu')
            ELSE 'tabel' END AS sursa,
       concat_ws('; ',
         CASE WHEN c.eticheta LIKE '% | acl%' AND c.detaliu ~ '(^|[ ,;])(anon|PUBLIC):' THEN 'drepturi pentru anon / PUBLIC' END,
         CASE WHEN c.eticheta LIKE '% | politici' AND c.detaliu ~ 'USING true' THEN 'politica USING true' END,
         CASE WHEN c.eticheta LIKE '% | politici' AND c.detaliu ~ 'roluri=([^|]*,)?(PUBLIC|anon)[,| ]' THEN 'politica pentru PUBLIC / anon' END,
         CASE WHEN c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%' THEN 'DEFINER fara search_path (migrarea refuza)' END,
         CASE WHEN c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=false%' AND c.detaliu LIKE '%config=(mostenit)%' THEN 'INVOKER fara search_path (de privit)' END,
         CASE WHEN c.eticheta LIKE 'functie %' AND (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(substr(c.eticheta, 9))) ~* '\mexecute\M' THEN 'EXECUTE in corp (de privit)' END
       ) AS atentie,
       c.detaliu
  FROM amp_calc c ORDER BY c.eticheta COLLATE "C";

ROLLBACK;
