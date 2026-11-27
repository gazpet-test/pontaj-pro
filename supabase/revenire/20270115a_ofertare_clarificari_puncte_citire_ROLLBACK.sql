-- Revenire 20270115a_ofertare_clarificari_puncte_citire. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Readuce politicile clar_puncte_sel / clar_puncte_rw de pe public.ofertare_clarificari_puncte la forma EXACTĂ de dinainte (20260928l): SELECT pentru
--   ORICE cont logat, scriere (și citire, prin ALL) cu modulul Ofertare; readuce ofertare_clarificari_export(bigint) la DEFINIȚIA EXACTĂ de dinainte
--   (corpul din 20270112a, md5 328b25f3431c5fc51a016d5ef359e453, SECURITY INVOKER; drepturile EXECUTE nu se ating — CREATE OR REPLACE le păstrează — și
--   sunt verificate la final); apoi șterge triggerul trg_ofertare_clar_parinte_puncte de pe părinte și cele 4 funcții (fn_ofertare_clar_parinte_puncte_garda,
--   fn_ofertare_clar_puncte_poarta, fn_ofertare_clar_are_puncte, fn_ofertare_lic_puncte_poarta — în această ordine: politicile, triggerul și exportul
--   depind de funcții, garda depinde de are_puncte și de poarta pe clarificare, poarta pe clarificare de poarta pe licitație). E o LĂRGIRE de drepturi
--   (punctele redevin citibile oricui e logat; adresa se exportă fără poarta punctelor și fără temeiurile din răspuns): se rulează doar cu decizia
--   owner-ului, consemnată. Nimic altceva nu se atinge (drepturile tabelelor, celelalte triggere, fn_are_acces_ofertare, fn_ofertare_poate_cheltui,
--   fn_ofertare_source_pack_poate_decide, fn_ofertare_ciorna_auto_stare, fn_clar_punct_semneaza, politicile temeiurilor / deciziilor, datele).
-- Refuz pe date (L14): migrarea n-a scris date; nu există rânduri / istoric / configurări noi de pierdut. Starea EXACTĂ a migrării e verificată sub
--   lock: cele 2 politici pe poarta nouă, cele 4 funcții noi + exportul cu corpul / forma / drepturile din 20270115a, triggerul cu forma exactă, de funcții
--   depind DOAR obiectele migrării (pg_depend: cele 2 politici, triggerul — altceva construit pe ele între timp = refuz, fără CASCADE) ȘI niciun alt corp
--   de funcție din schemele aplicației nu le numește textual (apelanții din corpuri $$…$$ / plpgsql NU sunt în pg_depend — review Jakarinos r1 P2;
--   scanarea prosrc e o verificare în plus, nu o garanție L15 — contractul declarat: dependențele înregistrate + absența numelor din corpuri; se
--   exclud, după OID, doar cele 4 funcții noi și exportul, care le numește legitim), RLS activ neforțat, dependențele (fn_are_acces_ofertare,
--   fn_ofertare_poate_cheltui) neschimbate — ACELEAȘI condiții ca la aplicare; altă stare = refuz, nimic schimbat.
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
  IF to_regclass('public.ofertare_clarificari_puncte') IS NULL OR to_regclass('public.ofertare_clarificari') IS NULL
     OR to_regclass('public.ofertare_clarificari_temeiuri') IS NULL OR to_regclass('public.cnsc_decizii') IS NULL THEN
    RAISE EXCEPTION '20270115a revenire: lipseste public.ofertare_clarificari_puncte / ofertare_clarificari / ofertare_clarificari_temeiuri / cnsc_decizii';
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
  -- cele 4 functii puse de migrare + exportul rescris: corp EXACT, forma, drepturile EXACTE, unice (ACELEASI campuri ca postconditia migrarii)
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
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_lic_puncte_poarta(bigint)')
                   AND md5(replace(p.prosrc, chr(13), '')) = 'b9a6713cabd7a57f74184538ec92d2b2' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_lic_puncte_poarta') <> 1 THEN
    RAISE EXCEPTION '20270115a revenire: fn_ofertare_lic_puncte_poarta(bigint) nu e cea din 20270115a (corp md5 b9a6713cabd7a57f74184538ec92d2b2, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_clar_puncte_poarta(bigint)')
                   AND md5(replace(p.prosrc, chr(13), '')) = '238e79d06ebded0cbe2def1577239459' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_clar_puncte_poarta') <> 1 THEN
    RAISE EXCEPTION '20270115a revenire: fn_ofertare_clar_puncte_poarta(bigint) nu e cea din 20270115a (corp md5 238e79d06ebded0cbe2def1577239459, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari)';
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
  -- exportul rescris: corpul nou, plpgsql, SECURITY DEFINER, VOLATILE, jsonb, cale sigura, proprietar postgres, drepturile EXACT cele de azi, unic
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.ofertare_clarificari_export(bigint)')
                   AND md5(replace(p.prosrc, chr(13), '')) = '590e69dbf14e0c6092fed04914069527' AND l.lanname = 'plpgsql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'jsonb'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ofertare_clarificari_export') <> 1 THEN
    RAISE EXCEPTION '20270115a revenire: ofertare_clarificari_export(bigint) nu e cea din 20270115a (corp md5 590e69dbf14e0c6092fed04914069527, plpgsql VOLATILE DEFINER, cale, proprietar, drepturile de azi exacte, unica)';
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
  -- de cele 4 functii depind DOAR obiectele migrarii: cele 2 politici (de poarta pe clarificare), triggerul (de garda); altceva construit pe ele intre timp = refuz (fara CASCADE)
  SELECT string_agg(d.classid::regclass::text || ':' || d.objid::text, ', ' ORDER BY d.classid::regclass::text, d.objid) INTO v_dep
    FROM pg_depend d
   WHERE d.refclassid = 'pg_proc'::regclass AND d.deptype <> 'i'
     AND d.refobjid IN (to_regprocedure('public.fn_ofertare_clar_puncte_poarta(bigint)'), to_regprocedure('public.fn_ofertare_lic_puncte_poarta(bigint)'),
                        to_regprocedure('public.fn_ofertare_clar_are_puncte(bigint)'), to_regprocedure('public.fn_ofertare_clar_parinte_puncte_garda()'))
     AND NOT (d.classid = 'pg_policy'::regclass AND d.objid IN (SELECT p.oid FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass AND p.polname IN ('clar_puncte_sel', 'clar_puncte_rw')))
     AND NOT (d.classid = 'pg_trigger'::regclass AND d.objid IN (SELECT t.oid FROM pg_trigger t WHERE t.tgrelid = 'public.ofertare_clarificari'::regclass AND t.tgname = 'trg_ofertare_clar_parinte_puncte'));
  IF v_dep IS NOT NULL THEN RAISE EXCEPTION '20270115a revenire: de functiile 20270115a depind si alte obiecte (nu doar cele 2 politici si triggerul): %', v_dep; END IF;
  -- apelanti din corpuri text (nu sunt in pg_depend): niciun alt corp de functie din schemele aplicatiei nu numeste functiile migrarii; se exclud
  -- DOAR cele 4 functii ale migrarii si exportul (le numeste legitim si e readus mai jos), dupa OID, nu dupa nume — o omonima din alta schema e un
  -- apelant ca oricare altul (review r2 P2); fara majuscule
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_dep
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\_%'
     AND p.oid NOT IN (to_regprocedure('public.fn_ofertare_clar_puncte_poarta(bigint)'), to_regprocedure('public.fn_ofertare_lic_puncte_poarta(bigint)'),
                       to_regprocedure('public.fn_ofertare_clar_are_puncte(bigint)'), to_regprocedure('public.fn_ofertare_clar_parinte_puncte_garda()'),
                       to_regprocedure('public.ofertare_clarificari_export(bigint)'))
     AND (p.prosrc ILIKE '%fn_ofertare_clar_puncte_poarta%' OR p.prosrc ILIKE '%fn_ofertare_lic_puncte_poarta%' OR p.prosrc ILIKE '%fn_ofertare_clar_are_puncte%' OR p.prosrc ILIKE '%fn_ofertare_clar_parinte_puncte_garda%');
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
    -- >>> FOTOGRAFIE 20270115a
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
    SELECT 'acl_temeiuri', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari_temeiuri'::regclass) a), '(nimic)')
    UNION ALL
    SELECT 'acl_cnsc', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.cnsc_decizii'::regclass) a), '(nimic)')
    UNION ALL
    SELECT 'triggere', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                   FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari_puncte'::regclass AND NOT tg.tgisinternal), '(niciunul)')
    UNION ALL
    -- triggerele parintelui de azi (fara cel nou): dupa migrare, lista fara trg_ofertare_clar_parinte_puncte trebuie sa fie identica
    SELECT 'triggere_parinte', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                           FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tg.tgisinternal AND tg.tgname <> 'trg_ofertare_clar_parinte_puncte'), '(niciunul)')
    UNION ALL
    SELECT 'politici_parinte', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                           FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass), '(niciuna)')
    UNION ALL
    SELECT 'politici_temeiuri', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                            FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_temeiuri'::regclass), '(niciuna)')
    UNION ALL
    SELECT 'politici_cnsc', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                        FROM pg_policy p WHERE p.polrelid = 'public.cnsc_decizii'::regclass), '(niciuna)')
    UNION ALL
    SELECT 'functie_acces', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                               FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()'))
    UNION ALL
    SELECT 'functie_cheltuiala', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_poate_cheltui(bigint, uuid)'))
    UNION ALL
    SELECT 'functie_decide', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ';'), '-')
                                FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_source_pack_poate_decide(bigint)'))
    UNION ALL
    SELECT 'functie_auto_stare', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ';'), '-')
                                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_ciorna_auto_stare(public.ofertare_clarificari, text)'))
    UNION ALL
    SELECT 'functie_trigger', coalesce((SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                          FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_clar_punct_semneaza()')), '(lipsa)')
    UNION ALL
    SELECT 'rls', (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass)
      || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari'::regclass)
      || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_temeiuri'::regclass)
      || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.cnsc_decizii'::regclass)
    UNION ALL
    SELECT 'politici_nr', (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass)
      || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass)
      || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_temeiuri'::regclass)
      || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.cnsc_decizii'::regclass);
    -- <<< FOTOGRAFIE 20270115a
END $stare$;

-- formele EXACTE de dinainte: politicile (20260928l) si exportul (20270112a, textul din productie 27.11.2026: SECURITY INVOKER; drepturile raman)
-- INTAI, apoi triggerul, apoi functiile in ordinea dependentelor (fara CASCADE: dependentele au fost verificate sub lock)
ALTER POLICY clar_puncte_sel ON public.ofertare_clarificari_puncte USING (auth.uid() IS NOT NULL);
ALTER POLICY clar_puncte_rw ON public.ofertare_clarificari_puncte USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
-- >>> EXPORT DE AZI (20270112a 9e; md5 328b25f3431c5fc51a016d5ef359e453)
CREATE OR REPLACE FUNCTION public.ofertare_clarificari_export(p_licitatie_id bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
DECLARE c public.ofertare_clarificari; v_st jsonb; v_out jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RAISE EXCEPTION 'fără acces'; END IF;
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id),false) THEN RAISE EXCEPTION 'Export blocat: fără drept de decizie pe licitație'; END IF;
  FOR c IN SELECT * FROM public.ofertare_clarificari WHERE licitatie_id=p_licitatie_id AND status='de_trimis' ORDER BY nr FOR SHARE LOOP
    IF coalesce(c.sursa,'') ~ '(^|,)revizie_' THEN RAISE EXCEPTION 'Clarificarea #% necesită revizie',c.nr; END IF;
    IF coalesce(c.cheie,'') ~ '^auto_(planse|surse)_' THEN
      v_st := public.fn_ofertare_ciorna_auto_stare(c,'tranzitie');
      IF coalesce(v_st->>'stare','') NOT IN ('ok','ok_identitate_limitata') THEN RAISE EXCEPTION 'Export blocat: %',v_st->>'text'; END IF;
    END IF;
    v_out := v_out || jsonb_build_array(to_jsonb(c));
  END LOOP;
  RETURN v_out;
END $function$;
-- <<< EXPORT DE AZI
DROP TRIGGER trg_ofertare_clar_parinte_puncte ON public.ofertare_clarificari;
DROP FUNCTION public.fn_ofertare_clar_parinte_puncte_garda();
DROP FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint);
DROP FUNCTION public.fn_ofertare_clar_are_puncte(bigint);
DROP FUNCTION public.fn_ofertare_lic_puncte_poarta(bigint);

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
               AND p.proname IN ('fn_ofertare_clar_puncte_poarta', 'fn_ofertare_lic_puncte_poarta', 'fn_ofertare_clar_are_puncte', 'fn_ofertare_clar_parinte_puncte_garda'))
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.ofertare_clarificari'::regclass AND t.tgname = 'trg_ofertare_clar_parinte_puncte') THEN
    RAISE EXCEPTION '20270115a revenire post: functiile sau triggerul 20270115a mai exista';
  END IF;
  -- exportul readus EXACT la definitia de azi: corp md5 328b25f3431c5fc51a016d5ef359e453, plpgsql, SECURITY INVOKER, VOLATILE, jsonb, cale sigura,
  -- proprietar postgres, drepturile EXACTE de azi (nu le-am atins), unic
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.ofertare_clarificari_export(bigint)')
                   AND md5(replace(p.prosrc, chr(13), '')) = '328b25f3431c5fc51a016d5ef359e453' AND l.lanname = 'plpgsql' AND p.prokind = 'f'
                   AND NOT p.prosecdef AND p.provolatile = 'v' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'jsonb'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ofertare_clarificari_export') <> 1 THEN
    RAISE EXCEPTION '20270115a revenire post: ofertare_clarificari_export(bigint) nu e cea de azi (corp md5 328b25f3431c5fc51a016d5ef359e453, plpgsql VOLATILE INVOKER, cale, proprietar, drepturi exacte, unica)';
  END IF;
  SELECT string_agg(f.ce || ' (era ' || f.val || ', acum ' || coalesce(n.val, 'LIPSA') || ')', '; ' ORDER BY f.ce) INTO v_rau
    FROM cp_foto f
    LEFT JOIN (
    -- >>> FOTOGRAFIE 20270115a
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
    SELECT 'acl_temeiuri', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari_temeiuri'::regclass) a), '(nimic)')
    UNION ALL
    SELECT 'acl_cnsc', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.cnsc_decizii'::regclass) a), '(nimic)')
    UNION ALL
    SELECT 'triggere', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                   FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari_puncte'::regclass AND NOT tg.tgisinternal), '(niciunul)')
    UNION ALL
    -- triggerele parintelui de azi (fara cel nou): dupa migrare, lista fara trg_ofertare_clar_parinte_puncte trebuie sa fie identica
    SELECT 'triggere_parinte', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                           FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tg.tgisinternal AND tg.tgname <> 'trg_ofertare_clar_parinte_puncte'), '(niciunul)')
    UNION ALL
    SELECT 'politici_parinte', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                           FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass), '(niciuna)')
    UNION ALL
    SELECT 'politici_temeiuri', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                            FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_temeiuri'::regclass), '(niciuna)')
    UNION ALL
    SELECT 'politici_cnsc', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                        FROM pg_policy p WHERE p.polrelid = 'public.cnsc_decizii'::regclass), '(niciuna)')
    UNION ALL
    SELECT 'functie_acces', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                               FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()'))
    UNION ALL
    SELECT 'functie_cheltuiala', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_poate_cheltui(bigint, uuid)'))
    UNION ALL
    SELECT 'functie_decide', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ';'), '-')
                                FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_source_pack_poate_decide(bigint)'))
    UNION ALL
    SELECT 'functie_auto_stare', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ';'), '-')
                                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_ciorna_auto_stare(public.ofertare_clarificari, text)'))
    UNION ALL
    SELECT 'functie_trigger', coalesce((SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                          FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_clar_punct_semneaza()')), '(lipsa)')
    UNION ALL
    SELECT 'rls', (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass)
      || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari'::regclass)
      || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_temeiuri'::regclass)
      || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.cnsc_decizii'::regclass)
    UNION ALL
    SELECT 'politici_nr', (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass)
      || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass)
      || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_temeiuri'::regclass)
      || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.cnsc_decizii'::regclass)
    -- <<< FOTOGRAFIE 20270115a
    ) n ON n.ce = f.ce
   WHERE n.val IS DISTINCT FROM f.val;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270115a revenire post: s-a schimbat altceva decat cele 2 politici + functiile + exportul + triggerul: %', v_rau; END IF;
  IF (SELECT count(*) FROM cp_foto) <> 16 THEN RAISE EXCEPTION '20270115a revenire post: fotografia incompleta'; END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270115a_ofertare_clarificari_puncte_citire_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270115a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20270115a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
