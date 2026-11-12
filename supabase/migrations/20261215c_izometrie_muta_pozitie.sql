-- Version 20261215140000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261215c_izometrie_muta_pozitie — TKT-2026-0388: în editorul de izometrie, o piesă adăugată la final („+”) se mută dintr-o dată la
--   începutul pachetului (sau la poziția N), nu cu ↑ apăsat de N ori (N apeluri separate = mutare pe jumătate la o întrerupere).
-- Ce face: RPC-ul fn_executie_tevi_muta_pozitie(p_id, p_poz_noua) → jsonb. ATOMIC (un singur apel = o tranzacție):
--   1. identitatea (auth.uid(), L08) și dreptul de SCRIERE pe proiectul pachetului: fn_executie_nod_drept(proiect, true) — după 20261209a
--      include restricția de acces pe proiect (cont restrâns = doar proiectele lui). Țeavă inexistentă, invizibilă (RLS) sau fără drept =
--      ACELAȘI refuz, cu mesajul porții 20261209a, fără id-uri (L09);
--   2. PROTOCOLUL DE LOCK pe pachet (r2, vezi mai jos): lock consultativ pe pachet + TOATE rândurile pachetului FOR UPDATE NOWAIT, ORDER BY id,
--      înaintea citirii ordinii. Ocupat (altă mutare, un ↑ / ↓ în curs, editorul) = refuz IMEDIAT 55P03 „reîncearcă”, nimic scris (L01);
--   3. citește ordinea (poz_in_pachet, id) și mută piesa pas cu pas prin SCHIMBUL EXISTENT public.fn_executie_swap_tevi_pozitie (poarta
--      20261209a + originalul): gărzile, drepturile, mesajele și recalcularea POZ KM (trigger-ul de după schimb) sunt EXACT cele ale
--      butoanelor ↑ / ↓ — nimic nu e rescris aici. Pachetele în fluxul de montaj refuză schimbul (garda E4a), deci și mutarea;
--   4. postcondiție: ordinea finală = ordinea promisă (piesa pe poziția cerută, celelalte în aceeași ordine), altfel refuz și nimic nu
--      rămâne scris (ex. poziții duplicate în pachet).
-- De ce SECURITY INVOKER (nu DEFINER): rulează cu drepturile și RLS-ul apelantului, ca editorul de azi (care scrie direct executie_tevi);
--   singura scriere e prin schimbul existent. Nu e o funcție nouă cu drepturi de proprietar peste tabelele Execuției, deci nu lărgește
--   suprafața privilegiată inventariată de 20261209a.
-- Sondă de compatibilitate: apelul cu ambii parametri NULL întoarce {"disponibil": true} fără nicio citire / scriere (UI-ul o folosește ca
--   să știe dacă migrarea e aplicată; înainte de migrare butonul ⤒ apare dezactivat).
-- DEPENDENȚĂ: se aplică DUPĂ 20261209a (poarta pe proiect a schimbului, verificată mai jos cu amprenta corpului). Ordinea e impusă și de
--   20261209a: preflight-ul ei refuză orice funcție care numește fn_executie_swap_tevi_pozitie înaintea porții.
-- ORDINEA LOCK-URILOR (L01 / L06, r2 — verdictul Jakarinos: mutarea ținea prima țeavă și o aștepta pe ultima, iar un ↑ / ↓ concurent ținea
--   ultima și o aștepta pe prima = blocaj reciproc). Protocolul pentru orice cale care reordonează un pachet prin acest RPC:
--     (1) pg_try_advisory_xact_lock(hashtextextended('executie_tevi_ordine_pachet:' || pachet, 0)) — lock consultativ de tranzacție pe
--         PACHET, FĂRĂ așteptare: două mutări pe același pachet nu se întrepătrund (a doua = 55P03 imediat);
--     (2) SELECT … FROM executie_tevi WHERE pachet_id = pachet ORDER BY id FOR UPDATE NOWAIT — TOATE rândurile pachetului, FĂRĂ așteptare:
--         un rând ținut de alt cineva (un schimb ↑ / ↓ în curs, o salvare din editor) = 55P03 imediat, nimic scris;
--     (3) abia apoi citirea ordinii și schimburile: fiecare schimb ia FOR UPDATE pe două rânduri pe care le ținem deja, iar trigger-ul
--         POZ KM rescrie rânduri ale aceluiași pachet (ținute tot de noi) — nicio așteptare nouă pe rândurile pachetului.
--   De ce nu mai poate apărea blocajul: un ciclu cere ca MUTAREA să aștepte un lock ținut de cealaltă tranzacție. La pașii (1)-(2) mutarea
--   nu așteaptă niciodată (try / NOWAIT), iar după (2) ține deja tot pachetul, deci un ↑ / ↓ concurent pe același pachet stă la coadă după ea
--   (nu ține nimic din pachet), iar unul care apucase un rând înaintea ei face pasul (2) să refuze imediat. Protocolul NU depinde de ordinea
--   în care schimbul existent își blochează cele două rânduri (originalul e creat direct în BD, corpul nu e în repo; amprenta lui e fixată
--   mai jos) și nu cere modificarea lui. Rămâne în afara garanției doar un lock pe care originalul / trigger-ele lui l-ar lua pe ALT obiect
--   ÎNAINTEA rândurilor pachetului; un astfel de caz ar fi oprit de detectorul de deadlock (40P01, nimic scris), iar proba cu două sesiuni
--   (scripts/izometrie_muta_pozitie_concurenta.sh) îl verifică pe clonă în ambele ordini.
-- Ce NU face: nicio dată, nicio coloană, niciun drept pe tabele, nicio schimbare a schimbului existent sau a trigger-elor.
-- r2 (Jakarinos, P1): amprenta schimbului acoperea doar poarta din public → acum L15 COMPLET: poarta, ORIGINALUL din executie_acces_intern,
--   fn_executie_nod_drept, auth.uid() și callee-urile lor tranzitive revizuite, plus tabelele executie_tevi / executie_pachete_lansare
--   (drepturi, RLS + FORCE, toate politicile și funcțiile lor, triggerele și funcțiile lor), comparate cu BASELINE-ul din producție
--   (un singur bloc marcat, mai jos), ÎNAINTE și DUPĂ. Valorile le scoate coordonatorul cu scripts/tichete_lot2_amprente.sql
--   (tranzacție READ ONLY); până atunci migrarea refuză. Revenirea verifică amprenta funcției pe care o scoate (corp, drepturi, proprietăți).
-- Revenire: supabase/revenire/20261215c_izometrie_muta_pozitie_ROLLBACK.sql (DROP FUNCTION). Proba pe clonă (autosuficientă: își creează
--   datele în tranzacție anulată): supabase/tests/20261215c_izometrie_muta_pozitie.sql; concurența: scripts/izometrie_muta_pozitie_concurenta.sh.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261215c_izometrie_muta_pozitie:' || txid_current() THEN
    RAISE EXCEPTION '20261215c: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261215c: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_executie_tevi_muta_pozitie') THEN
    RAISE EXCEPTION '20261215c: fn_executie_tevi_muta_pozitie exista deja (reaplicare)';
  END IF;
  -- 20261209a aplicată: originalul schimbului în schema internă, cu amprenta corpului din inventarul 20261209a, iar în public poarta, cu
  -- amprenta corpului din 20261209a (fără CR); sursa acestor două valori e repo-ul, independentă de BASELINE-ul de mai jos
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('executie_acces_intern.fn_executie_swap_tevi_pozitie(bigint, bigint)')
                  AND md5(replace(p.prosrc, chr(13), '')) = '551affa41371b0ff3367b0ddebe9b603')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_executie_swap_tevi_pozitie(bigint, bigint)')
                     AND md5(replace(p.prosrc, chr(13), '')) = 'ab1f7875a2784791f9584580b71be38f'
                     AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
                     AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
                     AND p.prorettype = 'void'::regtype::oid AND pg_get_userbyid(p.proowner) = current_user
                     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'fn_executie_swap_tevi_pozitie') <> 2 THEN
    RAISE EXCEPTION '20261215c: poarta 20261209a pe fn_executie_swap_tevi_pozitie lipseste sau difera (aplica intai 20261209a)';
  END IF;
  -- funcția de drept pe Execuție (după 20261209a: cu condiția de proiect): semnătura, tipul, DEFINER, apelabilă de authenticated
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_executie_nod_drept(bigint, boolean)')
                  AND p.prosecdef AND p.prorettype = 'boolean'::regtype::oid
                  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '20261215c: fn_executie_nod_drept(bigint, boolean) lipseste sau difera';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid THEN
    RAISE EXCEPTION '20261215c: auth.uid() lipseste sau difera';
  END IF;
  -- tabelele și coloanele folosite (tipurile din semnătura schimbului: id bigint)
  IF to_regclass('public.executie_tevi') IS NULL OR to_regclass('public.executie_pachete_lansare') IS NULL
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_tevi'::regclass AND attname = 'id' AND NOT attisdropped), '') NOT IN ('bigint', 'integer')
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_tevi'::regclass AND attname = 'pachet_id' AND NOT attisdropped), '') NOT IN ('bigint', 'integer')
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_tevi'::regclass AND attname = 'poz_in_pachet' AND NOT attisdropped), '') NOT IN ('integer', 'smallint', 'bigint', 'numeric')
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_pachete_lansare'::regclass AND attname = 'proiect_id' AND NOT attisdropped), '') NOT IN ('bigint', 'integer') THEN
    RAISE EXCEPTION '20261215c: executie_tevi (id, pachet_id, poz_in_pachet) / executie_pachete_lansare.proiect_id difera';
  END IF;
  -- INVOKER: apelantul trebuie să poată citi și bloca (FOR UPDATE cere UPDATE) rândurile, ca editorul de azi; drepturile se verifică pe rând
  IF NOT has_table_privilege('authenticated', 'public.executie_tevi', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.executie_tevi', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.executie_pachete_lansare', 'SELECT') THEN
    RAISE EXCEPTION '20261215c: authenticated nu are SELECT / UPDATE pe executie_tevi sau SELECT pe executie_pachete_lansare';
  END IF;
  -- lock-ul consultativ al protocolului (hashtextextended, PG >= 11)
  IF to_regprocedure('pg_catalog.hashtextextended(text, bigint)') IS NULL OR to_regprocedure('pg_catalog.pg_try_advisory_xact_lock(bigint)') IS NULL THEN
    RAISE EXCEPTION '20261215c: hashtextextended / pg_try_advisory_xact_lock lipsesc';
  END IF;
END $pre$;

-- ── L15 (r2): amprenta COMPLETĂ a stării de acces, verificată ÎNAINTE și DUPĂ schimbare ──
-- Obiectele: tabelele executie_tevi și executie_pachete_lansare, schimbul (poarta din public + originalul din executie_acces_intern), fn_executie_nod_drept, auth.uid(); funcțiile: cele din politicile și triggerele tabelelor (le găsește catalogul: pg_depend / pg_trigger) +
--   cele din BASELINE (punctul de plecare și callee-urile tranzitive revizuite; plpgsql nu lasă pg_depend, deci lista e explicită, nu căutată
--   în text). Pe fiecare: drepturile pe tabel / coloane / secvențe, proprietarul, RLS + FORCE, TOATE politicile (USING NULL = true),
--   triggerele (funcția, starea, definiția cu WHEN); pe funcții: tip, limbaj, DEFINER, proprietar, search_path, drepturi, md5 pe corp.
-- Calculul (AMPRENTA_L15 v1) e IDENTIC cu cel din scripts/tichete_lot2_amprente.sql (L19, testul src/tichete_lot2_amprente.test.js).
-- Funcțiile pg_temp de mai jos trăiesc doar în sesiunea migrării și se șterg la final. Orice diferență față de BASELINE (un drept în plus
--   pentru anon, o politică USING true în plus, altă funcție / alt corp, un trigger oprit, RLS / FORCE schimbat) = refuz, nimic scris.
-- >>> BASELINE 20261215c — SINGURUL loc cu valori din producție: coloana linie_baseline din scripts/tichete_lot2_amprente.sql (secțiunea
--     20261215c), copiată ÎNTREAGĂ, în ordinea afișată; coloana „detaliu” de acolo intră în review. Necompletat = migrarea refuză.
CREATE FUNCTION pg_temp.amp_baseline_20261215c() RETURNS TABLE (eticheta text, amprenta text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $bl$
  SELECT v.eticheta, v.amprenta FROM (VALUES
    ('DE_COMPLETAT: scripts/tichete_lot2_amprente.sql, sectiunea 20261215c', '-')
  ) v(eticheta, amprenta)
$bl$;
-- <<< BASELINE 20261215c
CREATE FUNCTION pg_temp.amp_calc_20261215c() RETURNS TABLE (eticheta text, amprenta text, detaliu text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $amp$
WITH
amp_tabele(oid) AS (VALUES ('public.executie_tevi'::regclass::oid), ('public.executie_pachete_lansare'::regclass::oid)),
amp_functii_explicite(oid) AS (SELECT to_regprocedure(substr(b.eticheta, 9))::oid FROM pg_temp.amp_baseline_20261215c() b WHERE b.eticheta LIKE 'functie %'),
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
CREATE FUNCTION pg_temp.amp_verifica_20261215c(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $vf$
DECLARE v_dif text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261215c())
     OR EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261215c() b
                 WHERE b.eticheta IS NULL OR b.amprenta IS NULL OR b.amprenta !~ '^[0-9a-f]{32}$'
                    OR (b.eticheta NOT LIKE 'tabel %' AND b.eticheta NOT LIKE 'functie %')) THEN
    RAISE EXCEPTION '20261215c: baseline L15 necompletat sau invalid (scripts/tichete_lot2_amprente.sql, sectiunea 20261215c)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.amp_baseline_20261215c() b GROUP BY b.eticheta HAVING count(*) > 1) THEN
    RAISE EXCEPTION '20261215c: baseline L15 cu etichete duble';
  END IF;
  SELECT string_agg(coalesce(c.eticheta, b.eticheta) || ' = ' || coalesce(c.amprenta, 'LIPSESTE') || ' (baseline ' || coalesce(b.amprenta, 'NU ARE') || ')',
                    '; ' ORDER BY coalesce(c.eticheta, b.eticheta) COLLATE "C")
    INTO v_dif
    FROM pg_temp.amp_calc_20261215c() c FULL JOIN pg_temp.amp_baseline_20261215c() b ON b.eticheta = c.eticheta
   WHERE c.amprenta IS DISTINCT FROM b.amprenta;
  IF v_dif IS NOT NULL THEN
    RAISE EXCEPTION '20261215c: starea de acces (%) difera de baseline-ul L15 revizuit: %', p_moment, v_dif;
  END IF;
  -- independent de baseline: o funcție SECURITY DEFINER din lanț fără search_path propriu = refuz (L15)
  IF EXISTS (SELECT 1 FROM pg_temp.amp_calc_20261215c() c
              WHERE c.eticheta LIKE 'functie %' AND c.detaliu LIKE '%definer=true%' AND c.detaliu LIKE '%config=(mostenit)%') THEN
    RAISE EXCEPTION '20261215c: o functie SECURITY DEFINER din lantul de acces nu are search_path propriu';
  END IF;
END $vf$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.amp_verifica_20261215c('inainte'); END $l15_inainte$;

CREATE FUNCTION public.fn_executie_tevi_muta_pozitie(p_id bigint, p_poz_noua integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE
  v_pachet bigint;
  v_proiect bigint;
  v_ids bigint[];
  v_final bigint[];
  v_asteptat bigint[];
  v_blocate integer;
  v_n integer;
  v_i integer;
  k integer;
BEGIN
  -- sonda de compatibilitate (UI): nimic citit, nimic scris
  IF p_id IS NULL AND p_poz_noua IS NULL THEN
    RETURN jsonb_build_object('disponibil', true);
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Execuție: autentificare necesară' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_poz_noua IS NULL THEN
    RAISE EXCEPTION 'Execuție: parametri lipsă' USING ERRCODE = '22023';
  END IF;
  -- pachetul și proiectul, sub RLS-ul apelantului: inexistent = invizibil = fără drept (același refuz, L09)
  SELECT t.pachet_id::bigint INTO v_pachet FROM public.executie_tevi t WHERE t.id = p_id;
  IF v_pachet IS NOT NULL THEN
    SELECT k2.proiect_id::bigint INTO v_proiect FROM public.executie_pachete_lansare k2 WHERE k2.id = v_pachet;
  END IF;
  IF v_pachet IS NULL OR public.fn_executie_nod_drept(v_proiect, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'Execuție: nu ai drept de scriere pe acest proiect' USING ERRCODE = '42501';
  END IF;
  -- L01 / L06, protocolul de lock (antetul migrării 20261215c): (1) pachetul, fără așteptare; (2) toate rândurile lui, ORDER BY id, NOWAIT;
  -- abia apoi ordinea. Nicio așteptare în acești pași = mutarea nu poate închide un ciclu cu un ↑ / ↓ concurent.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('executie_tevi_ordine_pachet:' || v_pachet::text, 0)) THEN
    RAISE EXCEPTION 'Execuție: pachetul e modificat chiar acum de altcineva (reîncearcă)' USING ERRCODE = '55P03';
  END IF;
  BEGIN
    SELECT count(*) INTO v_blocate FROM (SELECT t.id FROM public.executie_tevi t WHERE t.pachet_id = v_pachet ORDER BY t.id FOR UPDATE NOWAIT) b;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Execuție: pachetul e modificat chiar acum de altcineva (reîncearcă)' USING ERRCODE = '55P03';
  END;
  SELECT array_agg(t.id::bigint ORDER BY t.poz_in_pachet, t.id) INTO v_ids FROM public.executie_tevi t WHERE t.pachet_id = v_pachet;
  v_n := coalesce(cardinality(v_ids), 0);
  v_i := array_position(v_ids, p_id);
  IF v_i IS NULL OR v_blocate <> v_n THEN
    -- țeava a plecat din pachet între citire și lock, o țeavă nouă a apărut după lock, sau rânduri pe care apelantul nu le poate bloca
    RAISE EXCEPTION 'Execuție: pachetul s-a schimbat între timp (reîncarcă)' USING ERRCODE = '40001';
  END IF;
  IF p_poz_noua < 1 OR p_poz_noua > v_n THEN
    RAISE EXCEPTION 'Execuție: poziția trebuie să fie între 1 și %', v_n USING ERRCODE = '22023';
  END IF;
  -- ordinea promisă: piesa pe p_poz_noua, celelalte în aceeași ordine (același algoritm ca planMutare din src/izoMutaPozitie.js)
  v_asteptat := array_remove(v_ids, p_id);
  v_asteptat := v_asteptat[1:p_poz_noua - 1] || p_id || v_asteptat[p_poz_noua:v_n - 1];
  -- pas cu pas, prin schimbul existent (gărzi, drepturi, POZ KM); vecinul de la fiecare pas e cel din ordinea citită sub lock
  IF p_poz_noua < v_i THEN
    FOR k IN REVERSE v_i - 1 .. p_poz_noua LOOP
      PERFORM public.fn_executie_swap_tevi_pozitie(p_id, v_ids[k]);
    END LOOP;
  ELSIF p_poz_noua > v_i THEN
    FOR k IN v_i + 1 .. p_poz_noua LOOP
      PERFORM public.fn_executie_swap_tevi_pozitie(p_id, v_ids[k]);
    END LOOP;
  END IF;
  -- postcondiție (L20): altfel nimic nu rămâne scris
  SELECT array_agg(t.id::bigint ORDER BY t.poz_in_pachet, t.id) INTO v_final FROM public.executie_tevi t WHERE t.pachet_id = v_pachet;
  IF v_final IS DISTINCT FROM v_asteptat THEN
    RAISE EXCEPTION 'Execuție: ordinea rezultată diferă de cea cerută (poziții duplicate în pachet?) — nu s-a schimbat nimic' USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object('ok', true, 'poz_veche', v_i, 'poz_noua', p_poz_noua, 'schimburi', abs(v_i - p_poz_noua));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_tevi_muta_pozitie(bigint, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_tevi_muta_pozitie(bigint, integer) TO authenticated;
COMMENT ON FUNCTION public.fn_executie_tevi_muta_pozitie(bigint, integer) IS
  'Izometrie: mută o piesă la poziția N în pachet, atomic, prin schimbul existent (gărzi + POZ KM). INVOKER. TKT-2026-0388, 20261215c.';

DO $post$
DECLARE v_fn regprocedure := to_regprocedure('public.fn_executie_tevi_muta_pozitie(bigint, integer)');
BEGIN
  -- amprenta funcției noi: corpul (md5 fără CR, același cu cel verificat de revenire și de src/izoMutaPozitie.test.js), proprietățile, ACL exact
  IF v_fn IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
                                  AND p.prorettype = 'jsonb'::regtype::oid AND p.provolatile = 'v' AND p.prokind = 'f' AND NOT p.proisstrict
                                  AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
                                  AND pg_get_userbyid(p.proowner) = current_user
                                  AND md5(replace(p.prosrc, chr(13), '')) = '74c10379b9c971f0f98e4490be5601fc') THEN
    RAISE EXCEPTION '20261215c: functia nu are proprietatile asteptate (corp, INVOKER, search_path, jsonb)';
  END IF;
  IF (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
        SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
               || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
          FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE p.oid = v_fn) a)
     IS DISTINCT FROM 'authenticated:EXECUTE, ' || current_user || ':EXECUTE'
     OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261215c: drepturile pe functie difera (doar authenticated + proprietarul)';
  END IF;
  -- nimic nu se leagă de poartă după OID (plpgsql: fără pg_depend), ca în verificarea 20261209a
  IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass
              AND d.refobjid IN (to_regprocedure('public.fn_executie_swap_tevi_pozitie(bigint, bigint)'),
                                 to_regprocedure('executie_acces_intern.fn_executie_swap_tevi_pozitie(bigint, bigint)'))
              AND d.objid = v_fn) THEN
    RAISE EXCEPTION '20261215c: functia noua e legata dupa OID de schimb';
  END IF;
END $post$;

-- L15 (r2): aceeași amprentă DUPĂ schimbare (nimic din starea de acces nu s-a mișcat), apoi funcțiile pg_temp se șterg
DO $l15_dupa$ BEGIN PERFORM pg_temp.amp_verifica_20261215c('dupa'); END $l15_dupa$;
DROP FUNCTION pg_temp.amp_verifica_20261215c(text), pg_temp.amp_calc_20261215c(), pg_temp.amp_baseline_20261215c();
