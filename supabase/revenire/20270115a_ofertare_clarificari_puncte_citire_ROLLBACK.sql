-- Revenire 20270115a_ofertare_clarificari_puncte_citire. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Readuce politicile clar_puncte_sel / clar_puncte_rw de pe public.ofertare_clarificari_puncte la forma EXACTĂ de dinainte (20260928l): SELECT pentru
--   ORICE cont logat, scriere (și citire, prin ALL) cu modulul Ofertare; apoi șterge triggerul trg_ofertare_clar_parinte_puncte de pe părinte și cele 3
--   funcții (fn_ofertare_clar_parinte_puncte_garda, fn_ofertare_clar_puncte_poarta, fn_ofertare_clar_are_puncte — în această ordine: politicile și
--   triggerul depind de funcții, garda depinde de celelalte două). E o LĂRGIRE de drepturi: se rulează doar cu decizia owner-ului, consemnată. Nimic
--   altceva nu se atinge (drepturile tabelelor, celelalte triggere, fn_are_acces_ofertare, fn_ofertare_poate_cheltui, fn_clar_punct_semneaza, datele).
-- Refuz pe date (L14): migrarea n-a scris date; nu există rânduri / istoric / configurări noi de pierdut. Starea EXACTĂ a migrării e verificată sub
--   lock: cele 2 politici pe poarta nouă, cele 3 funcții cu corpul / forma / drepturile din 20270115a, triggerul cu forma exactă, de funcții depind DOAR
--   obiectele migrării (pg_depend: cele 2 politici, triggerul, garda — altceva construit pe ele între timp = refuz, fără CASCADE) ȘI niciun alt corp de
--   funcție din schemele aplicației nu le numește textual (apelanții din corpuri $$…$$ / plpgsql NU sunt în pg_depend — review Jakarinos r1 P2; scanarea
--   prosrc e o verificare în plus, nu o garanție L15 — contractul declarat: dependențele înregistrate + absența numelor din corpuri), RLS activ neforțat,
--   dependențele (fn_are_acces_ofertare, fn_ofertare_poate_cheltui) neschimbate — ACELEAȘI condiții ca la aplicare; altă stare = refuz, nimic schimbat.
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20270115a_ofertare_clarificari_puncte_citire_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20270115120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock-uri (aceeași ordine ca la aplicare): ACCESS EXCLUSIVE NOWAIT pe public.ofertare_clarificari_puncte, apoi SHARE ROW EXCLUSIVE NOWAIT pe
--   public.ofertare_clarificari (DROP TRIGGER); ocupat = 55P03 imediat, nimic schimbat; ÎNAINTEA verificărilor (L14); lock_timeout 100 ms pentru cele
--   implicite. Probe: scripts/pglite/test_ofertare_clarificari_puncte_citire_local.mjs.
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270115a_ofertare_clarificari_puncte_citire_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270115a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270115a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270115a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270115a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270115a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.ofertare_clarificari_puncte') IS NULL OR to_regclass('public.ofertare_clarificari') IS NULL THEN
    RAISE EXCEPTION '20270115a revenire: lipseste public.ofertare_clarificari_puncte sau public.ofertare_clarificari';
  END IF;
END $pre$;

LOCK TABLE public.ofertare_clarificari_puncte IN ACCESS EXCLUSIVE MODE NOWAIT;
LOCK TABLE public.ofertare_clarificari IN SHARE ROW EXCLUSIVE MODE NOWAIT;

DO $stare$
DECLARE v_rau text; v_dep text; v_attnum smallint;
BEGIN
  -- politicile, EXACT starea migrarii (aceeasi forma deparsata ca in postconditia ei)
  SELECT string_agg(coalesce(a.nume, '+' || c.nume) || coalesce(': ' || c.detaliu, ''), '; ' ORDER BY coalesce(a.nume, c.nume)) INTO v_rau
    FROM (VALUES
      -- >>> POLITICI PUNCTE 20270115a
      ('clar_puncte_sel', 'r|permisiva|{authenticated}|fn_ofertare_clar_puncte_poarta(clarificare_id)|-'),
      ('clar_puncte_rw', '*|permisiva|{authenticated}|fn_ofertare_clar_puncte_poarta(clarificare_id)|fn_ofertare_clar_puncte_poarta(clarificare_id)')
      -- <<< POLITICI PUNCTE 20270115a
    ) a(nume, detaliu)
    FULL JOIN (SELECT p.polname::text AS nume,
                      p.polcmd::text || '|' || CASE WHEN p.polpermissive THEN 'permisiva' ELSE 'restrictiva' END || '|'
                        || coalesce((SELECT '{' || string_agg(CASE WHEN ro = 0 THEN 'PUBLIC' ELSE ro::regrole::text END, ',' ORDER BY ro::regrole::text) || '}' FROM unnest(p.polroles) ro), '{}')
                        || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') AS detaliu
                 FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass) c ON c.nume = a.nume
   WHERE a.nume IS NULL OR c.nume IS NULL OR a.detaliu IS DISTINCT FROM c.detaliu;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270115a revenire: starea nu e cea din 20270115a (politicile ofertare_clarificari_puncte): %', v_rau; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION '20270115a revenire: RLS pe ofertare_clarificari_puncte nu e activ (sau e fortat)';
  END IF;
  -- cele 3 functii puse de migrare: corp EXACT, forma, drepturile EXACTE, unice (ACELEASI campuri ca postconditia migrarii)
  -- >>> FUNCTII 20270115a
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_clar_are_puncte(bigint)')
                   AND md5(replace(p.prosrc, chr(13), '')) = '2245a58f811059df647d9d7032595637' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_clar_are_puncte') <> 1 THEN
    RAISE EXCEPTION '20270115a revenire: fn_ofertare_clar_are_puncte(bigint) nu e cea din 20270115a (corp md5 2245a58f811059df647d9d7032595637, sql VOLATILE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_clar_puncte_poarta(bigint)')
                   AND md5(replace(p.prosrc, chr(13), '')) = 'abd6b68b5b34a67f777045541aeff04a' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_clar_puncte_poarta') <> 1 THEN
    RAISE EXCEPTION '20270115a revenire: fn_ofertare_clar_puncte_poarta(bigint) nu e cea din 20270115a (corp md5 abd6b68b5b34a67f777045541aeff04a, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_clar_parinte_puncte_garda()')
                   AND md5(replace(p.prosrc, chr(13), '')) = 'af05fe431f584442cea2351f4257427f' AND l.lanname = 'plpgsql' AND p.prokind = 'f'
                   AND NOT p.prosecdef AND p.provolatile = 'v' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'trigger'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'postgres:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_clar_parinte_puncte_garda') <> 1 THEN
    RAISE EXCEPTION '20270115a revenire: fn_ofertare_clar_parinte_puncte_garda() nu e cea din 20270115a (corp md5 af05fe431f584442cea2351f4257427f, plpgsql VOLATILE INVOKER, cale, proprietar, doar proprietarul executa, unica)';
  END IF;
  -- <<< FUNCTII 20270115a
  -- triggerul: forma exacta (BEFORE ROW DELETE + UPDATE OF licitatie_id = 27, garda, fara WHEN / argumente, activ)
  SELECT a.attnum INTO v_attnum FROM pg_attribute a WHERE a.attrelid = 'public.ofertare_clarificari'::regclass AND a.attname = 'licitatie_id' AND NOT a.attisdropped;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.ofertare_clarificari'::regclass AND t.tgname = 'trg_ofertare_clar_parinte_puncte'
                   AND t.tgfoid = to_regprocedure('public.fn_ofertare_clar_parinte_puncte_garda()') AND t.tgtype = 27 AND t.tgattr = v_attnum::text::int2vector
                   AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgenabled = 'O' AND NOT t.tgisinternal)
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.ofertare_clarificari'::regclass AND t.tgname = 'trg_ofertare_clar_parinte_puncte') <> 1 THEN
    RAISE EXCEPTION '20270115a revenire: triggerul trg_ofertare_clar_parinte_puncte nu e cel din 20270115a (BEFORE UPDATE OF licitatie_id OR DELETE, FOR EACH ROW, garda, fara WHEN / argumente, activ)';
  END IF;
  -- de cele 3 functii depind DOAR obiectele migrarii: cele 2 politici (de poarta), triggerul (de garda); altceva construit pe ele intre timp = refuz (fara CASCADE)
  SELECT string_agg(d.classid::regclass::text || ':' || d.objid::text, ', ' ORDER BY d.classid::regclass::text, d.objid) INTO v_dep
    FROM pg_depend d
   WHERE d.refclassid = 'pg_proc'::regclass AND d.deptype <> 'i'
     AND d.refobjid IN (to_regprocedure('public.fn_ofertare_clar_puncte_poarta(bigint)'), to_regprocedure('public.fn_ofertare_clar_are_puncte(bigint)'), to_regprocedure('public.fn_ofertare_clar_parinte_puncte_garda()'))
     AND NOT (d.classid = 'pg_policy'::regclass AND d.objid IN (SELECT p.oid FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass AND p.polname IN ('clar_puncte_sel', 'clar_puncte_rw')))
     AND NOT (d.classid = 'pg_trigger'::regclass AND d.objid IN (SELECT t.oid FROM pg_trigger t WHERE t.tgrelid = 'public.ofertare_clarificari'::regclass AND t.tgname = 'trg_ofertare_clar_parinte_puncte'));
  IF v_dep IS NOT NULL THEN RAISE EXCEPTION '20270115a revenire: de functiile 20270115a depind si alte obiecte (nu doar cele 2 politici si triggerul): %', v_dep; END IF;
  -- apelanti din corpuri text (nu sunt in pg_depend): niciun alt corp de functie din schemele aplicatiei nu numeste functiile migrarii; se exclud
  -- DOAR cele 3 functii ale migrarii (dupa OID, nu dupa nume — o omonima din alta schema e un apelant ca oricare altul, review r2 P2); fara majuscule
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_dep
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\_%'
     AND p.oid NOT IN (to_regprocedure('public.fn_ofertare_clar_puncte_poarta(bigint)'), to_regprocedure('public.fn_ofertare_clar_are_puncte(bigint)'), to_regprocedure('public.fn_ofertare_clar_parinte_puncte_garda()'))
     AND (p.prosrc ILIKE '%fn_ofertare_clar_puncte_poarta%' OR p.prosrc ILIKE '%fn_ofertare_clar_are_puncte%' OR p.prosrc ILIKE '%fn_ofertare_clar_parinte_puncte_garda%');
  IF v_dep IS NOT NULL THEN RAISE EXCEPTION '20270115a revenire: alte functii numesc in corp functiile 20270115a (apelanti neinregistrati in pg_depend): %', v_dep; END IF;
  -- dependentele pe care le chema poarta (neschimbate fata de 20260912 / 20261124a: ACELEASI campuri ca la aplicare)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()')
                   AND md5(replace(p.prosrc, chr(13), '')) = '429d28e2a61fb24c8009d67050c16c85' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_are_acces_ofertare') <> 1 THEN
    RAISE EXCEPTION '20270115a revenire: fn_are_acces_ofertare() nu e cea din 20260912 (corp md5 429d28e2a61fb24c8009d67050c16c85, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_poate_cheltui(bigint, uuid)')
                   AND md5(replace(p.prosrc, chr(13), '')) = '07fba9e2e4249481fa9184fc48abc58d' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_poate_cheltui') <> 1 THEN
    RAISE EXCEPTION '20270115a revenire: fn_ofertare_poate_cheltui(bigint, uuid) nu e cea din 20261124a (corp md5 07fba9e2e4249481fa9184fc48abc58d, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari)';
  END IF;
  -- fotografia a ceea ce NU se schimba (comparata in $post$): aceleasi campuri ca la aplicare
  CREATE TEMP TABLE cp_foto ON COMMIT DROP AS
    SELECT 'acl_tabel' AS ce, coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass) a), '(nimic)') AS val
    UNION ALL
    SELECT 'acl_parinte', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari'::regclass) a), '(nimic)')
    UNION ALL
    SELECT 'triggere', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                   FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari_puncte'::regclass AND NOT tg.tgisinternal), '(niciunul)')
    UNION ALL
    SELECT 'triggere_parinte', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                           FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tg.tgisinternal AND tg.tgname <> 'trg_ofertare_clar_parinte_puncte'), '(niciunul)')
    UNION ALL
    SELECT 'politici_parinte', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                           FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass), '(niciuna)')
    UNION ALL
    SELECT 'functie_acces', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                               FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()'))
    UNION ALL
    SELECT 'functie_cheltuiala', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_poate_cheltui(bigint, uuid)'))
    UNION ALL
    SELECT 'functie_trigger', coalesce((SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                          FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_clar_punct_semneaza()')), '(lipsa)')
    UNION ALL
    SELECT 'rls', (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass)
      || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari'::regclass)
    UNION ALL
    SELECT 'politici_nr', (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass)
      || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass);
END $stare$;

-- formele EXACTE de dinainte (20260928l); politicile si triggerul INTAI (depind de functii), apoi functiile in ordinea dependentelor (fara CASCADE:
-- dependentele au fost verificate sub lock)
ALTER POLICY clar_puncte_sel ON public.ofertare_clarificari_puncte USING (auth.uid() IS NOT NULL);
ALTER POLICY clar_puncte_rw ON public.ofertare_clarificari_puncte USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP TRIGGER trg_ofertare_clar_parinte_puncte ON public.ofertare_clarificari;
DROP FUNCTION public.fn_ofertare_clar_parinte_puncte_garda();
DROP FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint);
DROP FUNCTION public.fn_ofertare_clar_are_puncte(bigint);

DO $post$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(coalesce(a.nume, '+' || c.nume) || coalesce(': ' || c.detaliu, ''), '; ' ORDER BY coalesce(a.nume, c.nume)) INTO v_rau
    FROM (VALUES
      -- >>> POLITICI PUNCTE 27.11.2026
      ('clar_puncte_sel', 'r|permisiva|{authenticated}|(auth.uid() IS NOT NULL)|-'),
      ('clar_puncte_rw', '*|permisiva|{authenticated}|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)')
      -- <<< POLITICI PUNCTE 27.11.2026
    ) a(nume, detaliu)
    FULL JOIN (SELECT p.polname::text AS nume,
                      p.polcmd::text || '|' || CASE WHEN p.polpermissive THEN 'permisiva' ELSE 'restrictiva' END || '|'
                        || coalesce((SELECT '{' || string_agg(CASE WHEN ro = 0 THEN 'PUBLIC' ELSE ro::regrole::text END, ',' ORDER BY ro::regrole::text) || '}' FROM unnest(p.polroles) ro), '{}')
                        || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') AS detaliu
                 FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass) c ON c.nume = a.nume
   WHERE a.nume IS NULL OR c.nume IS NULL OR a.detaliu IS DISTINCT FROM c.detaliu;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270115a revenire post: politicile ofertare_clarificari_puncte: %', v_rau; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
               AND p.proname IN ('fn_ofertare_clar_puncte_poarta', 'fn_ofertare_clar_are_puncte', 'fn_ofertare_clar_parinte_puncte_garda'))
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.ofertare_clarificari'::regclass AND t.tgname = 'trg_ofertare_clar_parinte_puncte') THEN
    RAISE EXCEPTION '20270115a revenire post: functiile sau triggerul 20270115a mai exista';
  END IF;
  SELECT string_agg(f.ce || ' (era ' || f.val || ', acum ' || coalesce(n.val, 'LIPSA') || ')', '; ' ORDER BY f.ce) INTO v_rau
    FROM cp_foto f
    LEFT JOIN (
      SELECT 'acl_tabel' AS ce, coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                       || '/' || pg_get_userbyid(e.grantor) AS d
                  FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass) a), '(nimic)') AS val
      UNION ALL
      SELECT 'acl_parinte', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                       || '/' || pg_get_userbyid(e.grantor) AS d
                  FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari'::regclass) a), '(nimic)')
      UNION ALL
      SELECT 'triggere', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                     FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari_puncte'::regclass AND NOT tg.tgisinternal), '(niciunul)')
      UNION ALL
      SELECT 'triggere_parinte', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                             FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tg.tgisinternal AND tg.tgname <> 'trg_ofertare_clar_parinte_puncte'), '(niciunul)')
      UNION ALL
      SELECT 'politici_parinte', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                             FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass), '(niciuna)')
      UNION ALL
      SELECT 'functie_acces', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()'))
      UNION ALL
      SELECT 'functie_cheltuiala', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                      FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_poate_cheltui(bigint, uuid)'))
      UNION ALL
      SELECT 'functie_trigger', coalesce((SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                            FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_clar_punct_semneaza()')), '(lipsa)')
      UNION ALL
      SELECT 'rls', (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass)
        || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari'::regclass)
      UNION ALL
      SELECT 'politici_nr', (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass)
        || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass)
    ) n ON n.ce = f.ce
   WHERE n.val IS DISTINCT FROM f.val;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270115a revenire post: s-a schimbat altceva decat cele 2 politici + functiile + triggerul: %', v_rau; END IF;
  IF (SELECT count(*) FROM cp_foto) <> 10 THEN RAISE EXCEPTION '20270115a revenire post: fotografia incompleta'; END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270115a_ofertare_clarificari_puncte_citire_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270115a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20270115a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
