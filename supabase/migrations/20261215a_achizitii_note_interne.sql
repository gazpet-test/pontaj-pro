-- Version 20261215120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261215a_achizitii_note_interne — TKT-2026-0361: notițe interne pe comanda către furnizor (discuții la telefon cu furnizorul,
--   data trimiterii cererii etc.), care NU apar pe cererea de ofertă, pe comandă, pe PV-uri sau în mailuri.
-- Cererea de ofertă (PDF) se generează din același rând comenzi_furnizor, deci o singură coloană acoperă ambele.
-- Ce face: ADD COLUMN note_interne text, nullable, fără valoare implicită (nu rescrie tabelul), cu o limită de 4000 de caractere
--   (CHECK cu nume explicit, diferit de cel automat de coloană; pe un tabel cu coloana nouă NULL verificarea e instantanee).
-- Ce NU face: nicio dată, nicio politică, niciun drept nou: coloana moștenește drepturile de tabel existente (aceleași conturi care
--   scriu azi comanda o pot scrie). Generatoarele de documente din Achizitii.jsx citesc câmpuri numite explicit, deci coloana nu
--   ajunge în PDF-uri (testul src/achizitiiNoteInterne.test.js).
-- Compatibilitate: aplicația merge și înainte de migrare (câmpul apare dezactivat), și după.
-- Revenire: supabase/revenire/20261215a_achizitii_note_interne_ROLLBACK.sql (refuză dacă există notițe scrise).
-- r2 (Jakarinos, NO-GO la aplicare, P1): garda verifica doar SELECT / UPDATE pentru authenticated; un drept în plus pentru anon sau o
--   politică permisivă în plus ar fi trecut și ar fi expus notițele. Acum: amprenta L15 COMPLETĂ a tabelului (drepturi pe tabel /
--   coloane / secvențe, proprietar, RLS + FORCE, toate politicile, triggerele, funcțiile lor și callee-urile revizuite), comparată cu
--   BASELINE-ul din producție (un singur bloc marcat, mai jos), ÎNAINTE și DUPĂ ADD COLUMN. Valorile le scoate coordonatorul cu
--   scripts/tichete_lot2_amprente.sql (tranzacție READ ONLY); până atunci migrarea refuză. Revenirea verifică și ea amprenta coloanei.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261215a_achizitii_note_interne:' || txid_current() THEN
    RAISE EXCEPTION '20261215a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261215a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.comenzi_furnizor') IS NULL THEN
    RAISE EXCEPTION '20261215a: tabelul public.comenzi_furnizor lipseste';
  END IF;
  -- reaplicare = refuz
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.comenzi_furnizor'::regclass AND attname = 'note_interne' AND NOT attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.comenzi_furnizor'::regclass AND conname = 'comenzi_furnizor_note_interne_lung_ck') THEN
    RAISE EXCEPTION '20261215a: note_interne exista deja (reaplicare)';
  END IF;
  -- tabelul e cel cunoscut (coloanele pe care le folosește aplicația lângă notiță: CAS pe updated_at, observațiile publice)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'comenzi_furnizor' AND column_name = 'updated_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'comenzi_furnizor' AND column_name = 'observatii' AND data_type = 'text') THEN
    RAISE EXCEPTION '20261215a: comenzi_furnizor nu are coloanele asteptate (updated_at, observatii text)';
  END IF;
  -- starea de azi a drepturilor: authenticated citește și modifică tabelul (altfel coloana nouă n-ar fi utilizabilă din aplicație)
  IF NOT has_table_privilege('authenticated', 'public.comenzi_furnizor', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.comenzi_furnizor', 'UPDATE') THEN
    RAISE EXCEPTION '20261215a: authenticated nu are SELECT / UPDATE pe comenzi_furnizor (drepturi diferite de cele asteptate)';
  END IF;
END $pre$;

-- ── L15 (r2): amprenta COMPLETĂ a stării de acces, verificată ÎNAINTE și DUPĂ schimbare ──
-- Obiectele: tabelul comenzi_furnizor; funcțiile: cele din politicile și triggerele tabelelor (le găsește catalogul: pg_depend / pg_trigger) +
--   cele din BASELINE (punctul de plecare și callee-urile tranzitive revizuite; plpgsql nu lasă pg_depend, deci lista e explicită, nu căutată
--   în text). Pe fiecare: drepturile pe tabel / coloane / secvențe, proprietarul, RLS + FORCE, TOATE politicile (USING NULL = true),
--   triggerele (funcția, starea, definiția cu WHEN); pe funcții: tip, limbaj, DEFINER, proprietar, search_path, drepturi, md5 pe corp.
-- Calculul (AMPRENTA_L15 v1) e IDENTIC cu cel din scripts/tichete_lot2_amprente.sql (L19, testul src/tichete_lot2_amprente.test.js).
-- Funcțiile pg_temp de mai jos trăiesc doar în sesiunea migrării și se șterg la final. Orice diferență față de BASELINE (un drept în plus
--   pentru anon, o politică USING true în plus, altă funcție / alt corp, un trigger oprit, RLS / FORCE schimbat) = refuz, nimic scris.
-- >>> BASELINE 20261215a — SINGURUL loc cu valori din producție: coloana linie_baseline din scripts/tichete_lot2_amprente.sql (secțiunea
--     20261215a), copiată ÎNTREAGĂ, în ordinea afișată; coloana „detaliu” de acolo intră în review. Necompletat = migrarea refuză.
CREATE FUNCTION pg_temp.amp_baseline_20261215a() RETURNS TABLE (eticheta text, amprenta text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $bl$
  SELECT v.eticheta, v.amprenta FROM (VALUES
    ('DE_COMPLETAT: scripts/tichete_lot2_amprente.sql, sectiunea 20261215a', '-')
  ) v(eticheta, amprenta)
$bl$;
-- <<< BASELINE 20261215a
CREATE FUNCTION pg_temp.amp_calc_20261215a() RETURNS TABLE (eticheta text, amprenta text, detaliu text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $amp$
WITH
amp_tabele(oid) AS (VALUES ('public.comenzi_furnizor'::regclass::oid)),
amp_functii_explicite(oid) AS (SELECT to_regprocedure(substr(b.eticheta, 9))::oid FROM pg_temp.amp_baseline_20261215a() b WHERE b.eticheta LIKE 'functie %'),
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
SELECT c.eticheta, c.amprenta, c.detaliu FROM amp_calc c
$amp$;
CREATE FUNCTION pg_temp.amp_verifica_20261215a(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $vf$
DECLARE v_dif text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261215a())
     OR EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261215a() b
                 WHERE b.eticheta IS NULL OR b.amprenta IS NULL OR b.amprenta !~ '^[0-9a-f]{32}$'
                    OR (b.eticheta NOT LIKE 'tabel %' AND b.eticheta NOT LIKE 'functie %')) THEN
    RAISE EXCEPTION '20261215a: baseline L15 necompletat sau invalid (scripts/tichete_lot2_amprente.sql, sectiunea 20261215a)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261215a() b GROUP BY b.eticheta HAVING count(*) > 1) THEN
    RAISE EXCEPTION '20261215a: baseline L15 cu etichete duble';
  END IF;
  SELECT string_agg(coalesce(c.eticheta, b.eticheta) || ' = ' || coalesce(c.amprenta, 'LIPSESTE') || ' (baseline ' || coalesce(b.amprenta, 'NU ARE') || ')',
                    '; ' ORDER BY coalesce(c.eticheta, b.eticheta) COLLATE "C")
    INTO v_dif
    FROM pg_temp.amp_calc_20261215a() c FULL JOIN pg_temp.amp_baseline_20261215a() b ON b.eticheta = c.eticheta
   WHERE c.amprenta IS DISTINCT FROM b.amprenta;
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261215a: starea de acces (%) difera de baseline-ul L15 revizuit: %', p_moment, v_dif;
  END IF;
  -- independent de baseline: o funcție SECURITY DEFINER din lanț fără search_path propriu = refuz (L15)
  IF EXISTS (SELECT 1 FROM pg_temp.amp_calc_20261215a() c
              WHERE c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%') THEN
    RAISE EXCEPTION '20261215a: o functie SECURITY DEFINER din lantul de acces nu are search_path propriu';
  END IF;
END $vf$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.amp_verifica_20261215a('inainte'); END $l15_inainte$;

ALTER TABLE public.comenzi_furnizor
  ADD COLUMN note_interne text,
  ADD CONSTRAINT comenzi_furnizor_note_interne_lung_ck CHECK (note_interne IS NULL OR length(note_interne) <= 4000);
COMMENT ON COLUMN public.comenzi_furnizor.note_interne IS
  'Notițe interne (doar pentru colegi): NU intră în PDF-ul comenzii, al cererii de ofertă, în PV-uri sau în mailuri. TKT-2026-0361, 20261215a.';

DO $post$
DECLARE v record;
BEGIN
  SELECT a.attnotnull, a.atthasdef, format_type(a.atttypid, a.atttypmod) AS tip INTO v
    FROM pg_attribute a WHERE a.attrelid = 'public.comenzi_furnizor'::regclass AND a.attname = 'note_interne' AND NOT a.attisdropped;
  IF NOT FOUND OR v.tip IS DISTINCT FROM 'text' OR v.attnotnull OR v.atthasdef THEN
    RAISE EXCEPTION '20261215a: note_interne nu e text nullable fara valoare implicita';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.comenzi_furnizor'::regclass AND conname = 'comenzi_furnizor_note_interne_lung_ck'
                  AND contype = 'c' AND convalidated) THEN
    RAISE EXCEPTION '20261215a: CHECK-ul de lungime lipseste';
  END IF;
  -- drepturile pe coloană, verificate pe rând (has_column_privilege cu 'A,B' = oricare)
  IF NOT has_column_privilege('authenticated', 'public.comenzi_furnizor', 'note_interne', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.comenzi_furnizor', 'note_interne', 'UPDATE') THEN
    RAISE EXCEPTION '20261215a: authenticated nu poate citi / modifica note_interne';
  END IF;
  -- coloana nouă nu are drepturi proprii (le moștenește pe cele ale tabelului, amprentate mai sus) și nimic nu depinde de ea în afara
  -- CHECK-ului ei (nicio politică, vedere, index); CHECK-ul are exact definiția de mai sus
  IF (SELECT a.attacl FROM pg_attribute a WHERE a.attrelid = 'public.comenzi_furnizor'::regclass AND a.attname = 'note_interne') IS NOT NULL
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.comenzi_furnizor'::regclass
          AND c.conname = 'comenzi_furnizor_note_interne_lung_ck') IS DISTINCT FROM 'CHECK (((note_interne IS NULL) OR (length(note_interne) <= 4000)))'
     OR EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.comenzi_furnizor'::regclass
                 AND d.refobjsubid = (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'public.comenzi_furnizor'::regclass AND a.attname = 'note_interne')
                 AND NOT (d.classid = 'pg_constraint'::regclass
                          AND d.objid = (SELECT c.oid FROM pg_constraint c WHERE c.conrelid = 'public.comenzi_furnizor'::regclass
                                          AND c.conname = 'comenzi_furnizor_note_interne_lung_ck'))) THEN
    RAISE EXCEPTION '20261215a: note_interne are drepturi proprii, alt CHECK sau obiecte legate de ea';
  END IF;
  IF EXISTS (SELECT 1 FROM public.comenzi_furnizor WHERE note_interne IS NOT NULL) THEN
    RAISE EXCEPTION '20261215a: note_interne are valori dupa migrare (nu trebuia scris nimic)';
  END IF;
END $post$;

-- L15 (r2): aceeași amprentă DUPĂ schimbare (nimic din starea de acces nu s-a mișcat), apoi funcțiile pg_temp se șterg
DO $l15_dupa$ BEGIN PERFORM pg_temp.amp_verifica_20261215a('dupa'); END $l15_dupa$;
DROP FUNCTION pg_temp.amp_verifica_20261215a(text), pg_temp.amp_calc_20261215a(), pg_temp.amp_baseline_20261215a();
