-- Revenire 20261222b_ctc_autorizatii_citire. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate EXACT cele trei funcții create de migrare: fn_ctc_autorizatii_drept(), fn_ctc_autorizatii_sudori(), fn_ctc_autorizatie_fisier(bigint).
-- Garda (r2): DETALIUL COMPLET al fiecărei funcții, în aceeași formă ca amprenta L15 (tip, limbaj, definer, volatil, strict, leakproof,
-- proprietar, config, întoarce, acl, corp_md5, sqlbody_md5), comparat câmp cu câmp cu starea livrată de migrare (postcondiția ei fixează
-- aceleași drepturi). Orice diferență (ex. un GRANT în plus, altă volatilitate) = refuz cu câmpurile care diferă, nimic schimbat. Nimic altceva nu se atinge (migrarea n-a
-- schimbat tabele, politici sau drepturi existente). După revenire, secțiunea din CTC arată „neactivată încă”, iar edge fn
-- ctc-autorizatie-fisier refuză (RPC-ul lipsește).
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon (comanda exactă):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261222b_ctc_autorizatii_citire_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261222120101 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Fără lock pe tabele (doar DROP FUNCTION; DROP ia lock pe funcție). Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; r record; v_are jsonb; v_dif text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261222b_ctc_autorizatii_citire_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261222b revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261222b revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261222b revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261222b revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261222b revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- detaliul livrat, câmp cu câmp (aceleași expresii ca în blocul AMPRENTA_L15 v1 al migrării)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_ctc_autorizatii_drept()', 'fn_ctc_autorizatii_drept',
       -- DETALIU-START dreptul
       jsonb_build_object('tip', 'f', 'limbaj', 'sql', 'definer', 'true', 'volatil', 's', 'strict', 'false', 'leakproof', 'false',
         'proprietar', 'postgres', 'config', 'search_path=public, pg_temp', 'intoarce', 'boolean',
         'acl', 'postgres:EXECUTE',
         'corp_md5', 'fde56a1c781ebe02a9deb4b0f1ad57e6', 'sqlbody_md5', '-')
       -- DETALIU-END dreptul
      ),
      ('public.fn_ctc_autorizatii_sudori()', 'fn_ctc_autorizatii_sudori',
       -- DETALIU-START lista
       jsonb_build_object('tip', 'f', 'limbaj', 'plpgsql', 'definer', 'true', 'volatil', 's', 'strict', 'false', 'leakproof', 'false',
         'proprietar', 'postgres', 'config', 'search_path=public, pg_temp',
         'intoarce', 'TABLE(id bigint, titular text, extern boolean, firma text, tip text, subcategorie text, numar_autorizatie text, emitent text, '
                     'data_emitere date, data_expirare date, fara_expirare boolean, procedeu_sudura text, diametru_teava_mm numeric, '
                     'calitate_material text, stare text, inlocuita boolean, scan text)',
         'acl', 'authenticated:EXECUTE, postgres:EXECUTE',
         'corp_md5', '12cf8b5f19a1eda1aaf34d63305e77c1', 'sqlbody_md5', '-')
       -- DETALIU-END lista
      ),
      ('public.fn_ctc_autorizatie_fisier(bigint)', 'fn_ctc_autorizatie_fisier',
       -- DETALIU-START fisierul
       jsonb_build_object('tip', 'f', 'limbaj', 'plpgsql', 'definer', 'true', 'volatil', 's', 'strict', 'false', 'leakproof', 'false',
         'proprietar', 'postgres', 'config', 'search_path=public, pg_temp', 'intoarce', 'text',
         'acl', 'authenticated:EXECUTE, postgres:EXECUTE',
         'corp_md5', 'ab6504326b3939a16def215b690ea6d1', 'sqlbody_md5', '-')
       -- DETALIU-END fisierul
      )
    ) v(fn, nume, livrat) LOOP
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.nume) <> 1
       OR to_regprocedure(r.fn) IS NULL THEN
      RAISE EXCEPTION '20261222b revenire: starea nu e cea din 20261222b (%: lipseste sau are supraincarcari)', r.nume;
    END IF;
    SELECT jsonb_build_object(
             'tip', p.prokind::text, 'limbaj', l.lanname::text, 'definer', p.prosecdef::text, 'volatil', p.provolatile::text,
             'strict', p.proisstrict::text, 'leakproof', p.proleakproof::text, 'proprietar', pg_get_userbyid(p.proowner)::text,
             'config', coalesce(array_to_string(p.proconfig, '; '), '(mostenit)'), 'intoarce', coalesce(pg_get_function_result(p.oid), '-'),
             'acl', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                      SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                             || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                        FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '(niciun drept)'),
             'corp_md5', md5(replace(p.prosrc, chr(13), '')),
             'sqlbody_md5', coalesce(md5(replace(pg_get_function_sqlbody(p.oid), chr(13), '')), '-'))
      INTO v_are
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure(r.fn);
    -- câmpurile din oricare parte (un câmp lipsă din livrat sau în plus = diferență)
    SELECT string_agg(k || ': are ' || coalesce(v_are ->> k, 'LIPSESTE') || ', livrat ' || coalesce(r.livrat ->> k, 'LIPSESTE'), '; ' ORDER BY k COLLATE "C")
      INTO v_dif
      FROM (SELECT jsonb_object_keys(v_are) AS k UNION SELECT jsonb_object_keys(r.livrat)) c
     WHERE (v_are ->> k) IS DISTINCT FROM (r.livrat ->> k);
    IF v_dif IS NOT NULL THEN
      RAISE EXCEPTION '20261222b revenire: starea nu e cea din 20261222b (%): %', r.nume, v_dif;
    END IF;
    -- nimic din afara migrării nu depinde de funcție (catalog + apeluri textuale; cele trei între ele sunt permise)
    IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure(r.fn)
                 AND NOT (d.classid = 'pg_proc'::regclass AND d.objid IN (to_regprocedure('public.fn_ctc_autorizatii_sudori()'),
                                                                          to_regprocedure('public.fn_ctc_autorizatie_fisier(bigint)'))))
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                     AND p.proname NOT IN ('fn_ctc_autorizatii_drept', 'fn_ctc_autorizatii_sudori', 'fn_ctc_autorizatie_fisier')
                     AND p.prosrc ~ ('\m' || r.nume || '\M')) THEN
      RAISE EXCEPTION '20261222b revenire: alte obiecte depind de functia %', r.nume;
    END IF;
  END LOOP;
  DROP FUNCTION public.fn_ctc_autorizatie_fisier(bigint);
  DROP FUNCTION public.fn_ctc_autorizatii_sudori();
  DROP FUNCTION public.fn_ctc_autorizatii_drept();
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname IN ('fn_ctc_autorizatii_drept', 'fn_ctc_autorizatii_sudori', 'fn_ctc_autorizatie_fisier')) THEN
    RAISE EXCEPTION '20261222b revenire post: au ramas obiecte';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261222b_ctc_autorizatii_citire_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261222b revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261222b revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
