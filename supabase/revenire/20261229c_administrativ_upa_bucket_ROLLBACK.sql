-- Revenire 20261229c_administrativ_upa_bucket. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Reface EXACT politica veche "upa docs authenticated all" pe storage.objects (FOR ALL TO public, permisivă, USING = WITH CHECK =
--   ((bucket_id = 'documente-upa'::text) AND (auth.uid() IS NOT NULL)) — forma verificată de migrare în $pre$, singura acceptată) și scoate
--   politicile upa_docs_citire / upa_docs_adaugare / upa_docs_stergere și funcția fn_upa_poate_citi(). Fișierele din bucket nu se ating.
-- REFUZĂ (nimic schimbat) dacă amprenta COMPLETĂ a obiectelor migrării (cele trei politici, funcția cu sursa / drepturile / proprietarul, ORICE
--   obiect dependent de fn_upa_poate_citi — blocul AMPRENTA, identic cu cel din postcondițiile migrării) diferă de constanta revizuită, sau dacă
--   există deja o politică cu numele vechi. Lock-ul se ia ÎNAINTEA verificărilor (L14). Imediat după refacere, politica veche se verifică pe
--   comandă, permisivitate, roluri, USING și CHECK (identic în catalog).
-- Ordinea revenirilor: 20261229c -> 20261229b -> 20261229a (politicile de aici folosesc fn_upa_poate_scrie din 20261229a: fără revenirea asta,
--   revenirea lui 20261229a pică la DROP FUNCTION, nimic schimbat).
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261229c_administrativ_upa_bucket_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261229120201 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock (NOWAIT): storage.objects ACCESS EXCLUSIVE. Probe: scripts/pglite/test_upa_alerta_local.mjs.
DO $pre$
DECLARE v_plafon text; v_amp text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261229c_administrativ_upa_bucket_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261229c revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261229c revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261229c revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261229c revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261229c revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('storage.objects') IS NULL OR to_regprocedure('public.fn_upa_poate_citi()') IS NULL
     OR (SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname IN ('upa_docs_citire', 'upa_docs_adaugare', 'upa_docs_stergere')) <> 3 THEN
    RAISE EXCEPTION '20261229c revenire: starea nu e cea din 20261229c (functia / politicile migrarii lipsesc)';
  END IF;
  -- lock-ul ÎNAINTEA verificărilor (L14), NOWAIT
  LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE NOWAIT;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'upa docs authenticated all') THEN
    RAISE EXCEPTION '20261229c revenire: politica veche exista deja; nimic schimbat';
  END IF;
  -- AMPRENTA_20261229c_INCEPUT
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'pol ' || p.polname || ' ' || p.polcmd::text || ' perm=' || p.polpermissive
           || ' roles=' || coalesce((SELECT string_agg(rl.nume, ',' ORDER BY rl.nume COLLATE "C") FROM (
                SELECT CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END AS nume FROM unnest(p.polroles) ro) rl), '-')
           || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') AS l
      FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname IN ('upa_docs_citire', 'upa_docs_adaugare', 'upa_docs_stergere')
    UNION ALL
    -- orice obiect care depinde de fn_upa_poate_citi (în afara politicii de citire = abatere)
    SELECT 'dep ' || pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> fn_upa_poate_citi ' || d.deptype::text
      FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure('public.fn_upa_poate_citi()')
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_upa_poate_citi'
  ) x;
  -- AMPRENTA_20261229c_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM '91c138f7e6265316a94af0e9a2ea1103' THEN
    RAISE NOTICE 'AMPRENTA_20261229c_TEXT %', v_amp;
    RAISE EXCEPTION '20261229c revenire: AMPRENTA obiectelor migrarii % (asteptat 91c138f7e6265316a94af0e9a2ea1103): starea nu e cea din 20261229c; nimic schimbat',
      md5(coalesce(v_amp, ''));
  END IF;
END $pre$;

DROP POLICY upa_docs_citire ON storage.objects;
DROP POLICY upa_docs_adaugare ON storage.objects;
DROP POLICY upa_docs_stergere ON storage.objects;
CREATE POLICY "upa docs authenticated all" ON storage.objects AS PERMISSIVE FOR ALL TO public
  USING (((bucket_id = 'documente-upa'::text) AND (auth.uid() IS NOT NULL)))
  WITH CHECK (((bucket_id = 'documente-upa'::text) AND (auth.uid() IS NOT NULL)));
DROP FUNCTION public.fn_upa_poate_citi();

DO $post$
DECLARE v_pol text;
BEGIN
  SELECT string_agg(p.polname || ' | ' || p.polcmd::text || ' | ' || CASE WHEN p.polpermissive THEN 'P' ELSE 'R' END || ' | '
                    || coalesce((SELECT string_agg(CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END, ',') FROM unnest(p.polroles) ro), '-') || ' | '
                    || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' | ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'),
                    chr(10) ORDER BY p.polname)
    INTO v_pol FROM pg_policy p
   WHERE p.polrelid = 'storage.objects'::regclass AND p.polname IN ('upa docs authenticated all', 'upa_docs_citire', 'upa_docs_adaugare', 'upa_docs_stergere');
  IF v_pol IS DISTINCT FROM 'upa docs authenticated all | * | P | PUBLIC | ((bucket_id = ''documente-upa''::text) AND (auth.uid() IS NOT NULL)) | ((bucket_id = ''documente-upa''::text) AND (auth.uid() IS NOT NULL))' THEN
    RAISE EXCEPTION '20261229c revenire: postconditie: politica veche nu e identica (%)', v_pol;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_upa_poate_citi') THEN
    RAISE EXCEPTION '20261229c revenire: postconditie: fn_upa_poate_citi a ramas';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261229c_administrativ_upa_bucket_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261229c revenire: garda final invalida';
  END IF;
END $post$;
