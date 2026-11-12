-- Version 20261215130000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261215b_probe_oferte_contact — TKT-2026-0374: pe oferta de probe de presiune, persoana de contact la beneficiar (nume, telefon,
--   e-mail). Azi oferta are doar denumirea firmei (probe_oferte.client).
-- Ce face: 3 coloane text nullable, fără valoare implicită (nu rescriu tabelul), cu plafon de lungime (CHECK cu nume explicite,
--   diferite de cele automate de coloană). Validarea formatului (telefon / mail) e doar avertisment în ecran, nu în BD.
-- Ce NU face: nicio dată, nicio politică, niciun drept nou: coloanele moștenesc drepturile și politicile de rând de azi
--   (probe_oferte_rls_*, 20261004b: doar cine are acces la Ofertare). Date personale ale unui terț: apar doar în oferta respectivă.
-- Compatibilitate: aplicația merge și înainte de migrare (câmpurile apar dezactivate, salvarea ofertei trimite câmpurile de azi).
-- Revenire: supabase/revenire/20261215b_probe_oferte_contact_ROLLBACK.sql (refuză dacă vreo ofertă are date de contact).
-- r2 (Jakarinos, NO-GO la aplicare, P1): RLS pornit și câteva drepturi nu dovedeau „doar cine are acces la Ofertare”; o politică
--   `USING (true)` în plus pentru authenticated ar fi trecut și ar fi arătat contactele (date personale ale unui terț) oricui e logat.
--   Acum: amprenta L15 COMPLETĂ a tabelului (drepturi pe tabel / coloane / secvențe, proprietar, RLS + FORCE, toate politicile,
--   triggerele, funcțiile din politici — fn_are_acces_ofertare — cu corpul și callee-urile lor revizuite), comparată cu BASELINE-ul din
--   producție (un singur bloc marcat, mai jos), ÎNAINTE și DUPĂ ADD COLUMN. Valorile le scoate coordonatorul cu
--   scripts/tichete_lot2_amprente.sql (tranzacție READ ONLY); până atunci migrarea refuză. Revenirea verifică și ea amprenta coloanelor.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261215b_probe_oferte_contact:' || txid_current() THEN
    RAISE EXCEPTION '20261215b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261215b: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.probe_oferte') IS NULL THEN
    RAISE EXCEPTION '20261215b: tabelul public.probe_oferte lipseste';
  END IF;
  -- reaplicare = refuz
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.probe_oferte'::regclass AND NOT attisdropped
              AND attname IN ('client_contact_nume', 'client_contact_telefon', 'client_contact_email'))
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.probe_oferte'::regclass AND conname LIKE 'probe_oferte_contact\_%') THEN
    RAISE EXCEPTION '20261215b: coloanele de contact exista deja (reaplicare)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'probe_oferte' AND column_name = 'client' AND data_type = 'text') THEN
    RAISE EXCEPTION '20261215b: probe_oferte nu are coloana client text (tabel diferit de cel asteptat)';
  END IF;
  -- starea de azi (20261004b): RLS pornit, authenticated citește / adaugă / modifică (prin politici), anon fără drepturi
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.probe_oferte'::regclass)
     OR NOT has_table_privilege('authenticated', 'public.probe_oferte', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.probe_oferte', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.probe_oferte', 'UPDATE')
     OR has_table_privilege('anon', 'public.probe_oferte', 'SELECT') THEN
    RAISE EXCEPTION '20261215b: RLS / drepturile pe probe_oferte difera de cele asteptate (20261004b)';
  END IF;
END $pre$;

-- ── L15 (r2): amprenta COMPLETĂ a stării de acces, verificată ÎNAINTE și DUPĂ schimbare ──
-- Obiectele: tabelul probe_oferte; funcțiile: cele din politicile și triggerele tabelelor (le găsește catalogul: pg_depend / pg_trigger) +
--   cele din BASELINE (punctul de plecare și callee-urile tranzitive revizuite; plpgsql nu lasă pg_depend, deci lista e explicită, nu căutată
--   în text). Pe fiecare: drepturile pe tabel / coloane / secvențe, proprietarul, RLS + FORCE, TOATE politicile (USING NULL = true),
--   triggerele (funcția, starea, definiția cu WHEN); pe funcții: tip, limbaj, DEFINER, proprietar, search_path, drepturi, md5 pe corp.
-- Calculul (AMPRENTA_L15 v1) e IDENTIC cu cel din scripts/tichete_lot2_amprente.sql (L19, testul src/tichete_lot2_amprente.test.js).
-- Funcțiile pg_temp de mai jos trăiesc doar în sesiunea migrării și se șterg la final. Orice diferență față de BASELINE (un drept în plus
--   pentru anon, o politică USING true în plus, altă funcție / alt corp, un trigger oprit, RLS / FORCE schimbat) = refuz, nimic scris.
-- >>> BASELINE 20261215b — SINGURUL loc cu valori din producție: coloana linie_baseline din scripts/tichete_lot2_amprente.sql (secțiunea
--     20261215b), copiată ÎNTREAGĂ, în ordinea afișată; coloana „detaliu” de acolo intră în review. Necompletat = migrarea refuză.
CREATE FUNCTION pg_temp.amp_baseline_20261215b() RETURNS TABLE (eticheta text, amprenta text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $bl$
  SELECT v.eticheta, v.amprenta FROM (VALUES
    ('functie auth.jwt()', '0a339ea1d249a021248f635d6afb9687')
    , ('functie auth.uid()', '547eb1864858f1efce909a735a04d521')
    , ('functie fn_are_acces_ofertare()', 'f060eebc2439bcff301212ef9424d68c')
    , ('functie probe_teren_oferta_guard()', 'dd0bf91598de0a627e4ea65634582543')
    , ('tabel probe_oferte | acl', '7ac76ed37dc6d6d174e23d9fe0069f77')
    , ('tabel probe_oferte | acl coloane', 'a0e240c36ade38bbb43163c61b36e86b')
    , ('tabel probe_oferte | politici', '30dd457965b922556f7a71463b468c84')
    , ('tabel probe_oferte | rls', '0a318f8ff8d8cc0bbd7b4b61a975f7b3')
    , ('tabel probe_oferte | secvente', 'fae9b7ec2c1bd81c5d6fe488d761094a')
    , ('tabel probe_oferte | triggere', '870af9511142bb46d21da101cc50a051')
  ) v(eticheta, amprenta)
$bl$;
-- <<< BASELINE 20261215b
CREATE FUNCTION pg_temp.amp_calc_20261215b() RETURNS TABLE (eticheta text, amprenta text, detaliu text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $amp$
WITH
amp_tabele(oid) AS (VALUES ('public.probe_oferte'::regclass::oid)),
amp_functii_explicite(oid) AS (SELECT to_regprocedure(substr(b.eticheta, 9))::oid FROM pg_temp.amp_baseline_20261215b() b WHERE b.eticheta LIKE 'functie %'),
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
CREATE FUNCTION pg_temp.amp_verifica_20261215b(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $vf$
DECLARE v_dif text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261215b())
     OR EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261215b() b
                 WHERE b.eticheta IS NULL OR b.amprenta IS NULL OR b.amprenta !~ '^[0-9a-f]{32}$'
                    OR (b.eticheta NOT LIKE 'tabel %' AND b.eticheta NOT LIKE 'functie %')) THEN
    RAISE EXCEPTION '20261215b: baseline L15 necompletat sau invalid (scripts/tichete_lot2_amprente.sql, sectiunea 20261215b)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261215b() b GROUP BY b.eticheta HAVING count(*) > 1) THEN
    RAISE EXCEPTION '20261215b: baseline L15 cu etichete duble';
  END IF;
  SELECT string_agg(coalesce(c.eticheta, b.eticheta) || ' = ' || coalesce(c.amprenta, 'LIPSESTE') || ' (baseline ' || coalesce(b.amprenta, 'NU ARE') || ')',
                    '; ' ORDER BY coalesce(c.eticheta, b.eticheta) COLLATE "C")
    INTO v_dif
    FROM pg_temp.amp_calc_20261215b() c FULL JOIN pg_temp.amp_baseline_20261215b() b ON b.eticheta = c.eticheta
   WHERE c.amprenta IS DISTINCT FROM b.amprenta;
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261215b: starea de acces (%) difera de baseline-ul L15 revizuit: %', p_moment, v_dif;
  END IF;
  -- independent de baseline: o funcție SECURITY DEFINER din lanț fără search_path propriu = refuz (L15)
  IF EXISTS (SELECT 1 FROM pg_temp.amp_calc_20261215b() c
              WHERE c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%') THEN
    RAISE EXCEPTION '20261215b: o functie SECURITY DEFINER din lantul de acces nu are search_path propriu';
  END IF;
END $vf$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.amp_verifica_20261215b('inainte'); END $l15_inainte$;

ALTER TABLE public.probe_oferte
  ADD COLUMN client_contact_nume text,
  ADD COLUMN client_contact_telefon text,
  ADD COLUMN client_contact_email text,
  ADD CONSTRAINT probe_oferte_contact_nume_ck CHECK (client_contact_nume IS NULL OR length(client_contact_nume) <= 120),
  ADD CONSTRAINT probe_oferte_contact_telefon_ck CHECK (client_contact_telefon IS NULL OR length(client_contact_telefon) <= 40),
  ADD CONSTRAINT probe_oferte_contact_email_ck CHECK (client_contact_email IS NULL OR length(client_contact_email) <= 160);
COMMENT ON COLUMN public.probe_oferte.client_contact_nume IS 'Persoana de contact la beneficiar (opțional; apare în exportul ofertei dacă e completată). TKT-2026-0374, 20261215b.';
COMMENT ON COLUMN public.probe_oferte.client_contact_telefon IS 'Telefonul persoanei de contact la beneficiar (opțional, text liber). TKT-2026-0374, 20261215b.';
COMMENT ON COLUMN public.probe_oferte.client_contact_email IS 'E-mailul persoanei de contact la beneficiar (opțional, text liber). TKT-2026-0374, 20261215b.';

DO $post$
DECLARE v_col text; v record;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['client_contact_nume', 'client_contact_telefon', 'client_contact_email'] LOOP
    SELECT a.attnotnull, a.atthasdef, format_type(a.atttypid, a.atttypmod) AS tip INTO v
      FROM pg_attribute a WHERE a.attrelid = 'public.probe_oferte'::regclass AND a.attname = v_col AND NOT a.attisdropped;
    IF NOT FOUND OR v.tip IS DISTINCT FROM 'text' OR v.attnotnull OR v.atthasdef THEN
      RAISE EXCEPTION '20261215b: % nu e text nullable fara valoare implicita', v_col;
    END IF;
    -- drepturile pe coloană, pe rând (has_column_privilege cu 'A,B' = oricare)
    IF NOT has_column_privilege('authenticated', 'public.probe_oferte', v_col, 'SELECT')
       OR NOT has_column_privilege('authenticated', 'public.probe_oferte', v_col, 'INSERT')
       OR NOT has_column_privilege('authenticated', 'public.probe_oferte', v_col, 'UPDATE')
       OR has_column_privilege('anon', 'public.probe_oferte', v_col, 'SELECT') THEN
      RAISE EXCEPTION '20261215b: drepturile pe % difera (authenticated SELECT/INSERT/UPDATE, anon fara)', v_col;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.probe_oferte'::regclass AND contype = 'c' AND convalidated
       AND conname IN ('probe_oferte_contact_nume_ck', 'probe_oferte_contact_telefon_ck', 'probe_oferte_contact_email_ck')) <> 3 THEN
    RAISE EXCEPTION '20261215b: CHECK-urile de lungime lipsesc';
  END IF;
  -- coloanele noi nu au drepturi proprii (le moștenesc pe cele ale tabelului, amprentate), CHECK-urile au exact definițiile de mai sus,
  -- iar nimic altceva nu depinde de ele (nicio politică, vedere, index)
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.probe_oferte'::regclass AND a.attacl IS NOT NULL
              AND a.attname IN ('client_contact_nume', 'client_contact_telefon', 'client_contact_email'))
     OR (SELECT string_agg(c.conname || '=' || pg_get_constraintdef(c.oid), '; ' ORDER BY c.conname COLLATE "C") FROM pg_constraint c
          WHERE c.conrelid = 'public.probe_oferte'::regclass AND c.conname LIKE 'probe_oferte_contact\_%')
        IS DISTINCT FROM 'probe_oferte_contact_email_ck=CHECK (((client_contact_email IS NULL) OR (length(client_contact_email) <= 160))); '
                      || 'probe_oferte_contact_nume_ck=CHECK (((client_contact_nume IS NULL) OR (length(client_contact_nume) <= 120))); '
                      || 'probe_oferte_contact_telefon_ck=CHECK (((client_contact_telefon IS NULL) OR (length(client_contact_telefon) <= 40)))'
     OR EXISTS (SELECT 1 FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
                 WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.probe_oferte'::regclass
                   AND a.attname IN ('client_contact_nume', 'client_contact_telefon', 'client_contact_email')
                   AND NOT (d.classid = 'pg_constraint'::regclass
                            AND d.objid IN (SELECT c.oid FROM pg_constraint c WHERE c.conrelid = 'public.probe_oferte'::regclass
                                             AND c.conname IN ('probe_oferte_contact_nume_ck', 'probe_oferte_contact_telefon_ck', 'probe_oferte_contact_email_ck')))) THEN
    RAISE EXCEPTION '20261215b: coloanele de contact au drepturi proprii, alte CHECK-uri sau obiecte legate de ele';
  END IF;
END $post$;

-- L15 (r2): aceeași amprentă DUPĂ schimbare (nimic din starea de acces nu s-a mișcat), apoi funcțiile pg_temp se șterg
DO $l15_dupa$ BEGIN PERFORM pg_temp.amp_verifica_20261215b('dupa'); END $l15_dupa$;
DROP FUNCTION pg_temp.amp_verifica_20261215b(text), pg_temp.amp_calc_20261215b(), pg_temp.amp_baseline_20261215b();
