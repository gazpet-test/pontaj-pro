-- Revenire 20261213a_executie_acces_proiect_perf. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Redă EXACT politicile 20261209a (predicatele pe rând) pe tabelele acoperite și pe storage.objects și scoate cele 4 funcții ale migrării
-- (fn_executie_acces_proprii_citire / _scriere, fn_executie_acces_politici, fn_executie_acces_politici_verifica). NU redeschide nimic:
-- regula de acces e aceeași (un cont restrâns rămâne restrâns, doar mai lent), deci NU refuză când există conturi restrânse.
-- Trebuie rulată ÎNAINTEA revenirii 20261209a (aceea refuză cât timp funcțiile de aici există).
-- Gestionarul tranzacției e operatorul (fișierul nu are BEGIN / COMMIT). Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261213a', 'REDA_POLITICILE_20261209A:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261213a REDA_POLITICILE_20261209A
-- Ordinea lock-urilor (L06, aceeași ca migrarea): tabelele acoperite în ordinea numelui (o singură instrucțiune), apoi storage.objects,
-- ACCESS EXCLUSIVE NOWAIT (ocupat = 55P03, nimic scris), ÎNAINTEA verificării stării (o schimbare concurentă nu se poate strecura între
-- verificare și ALTER POLICY).
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE r record; v_lista text; v_dif text; v_alte0 text; v_alte1 text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261213a', true) IS DISTINCT FROM 'REDA_POLITICILE_20261209A:' || txid_current() THEN
    RAISE EXCEPTION '20261213a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261213a=%') THEN
    RAISE EXCEPTION '20261213a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261213a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- starea exactă: cele 4 funcții ale migrării (corp, securitate, drepturi) + funcțiile 20261209a pe care le cheamă politicile vechi / noi
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_executie\_acces\_%' OR p.proname = 'fn_executie_proiect_permis')) <> 20
     OR EXISTS (SELECT 1 FROM (VALUES
          ('public.fn_executie_acces_proprii_citire()', '5b98134ac198c85aa30b6dad945c888c', true, true),
          ('public.fn_executie_acces_proprii_scriere()', 'd789f4fffefcf4f61b101f20e375b82f', true, true),
          ('public.fn_executie_acces_politici()', 'd51293ad8182cfe5d492204a7eb2d856', false, false),
          ('public.fn_executie_acces_politici_verifica(text)', '962cf7edb1138582b3bed1264dfd136d', false, false),
          ('public.fn_executie_acces_inventar()', 'f778d649059b169235d262ae3121de9f', false, false),
          ('public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1', true, true),
          ('public.fn_executie_acces_lista_cont(uuid, boolean)', 'e7cf9b852002a1c1cbe781772c33bf0c', false, false),
          ('public.fn_executie_proiect_permis(bigint, boolean)', 'bd4320f76e9f36f492c7186c0a982155', true, true),
          ('public.fn_executie_acces_parinte_permis(text, bigint, boolean)', '112454c743c8116ef76003b2f92e7e00', false, true),
          ('public.fn_executie_acces_obiect_permis(text, text, boolean)', 'c16a677f24f5b583627eb868e0aa8202', false, true)) a(semnatura, amprenta, definer, cu_auth)
        LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
        WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
           OR p.prosecdef IS DISTINCT FROM a.definer OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
           OR has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_auth) THEN
    RAISE EXCEPTION '20261213a revenire: starea nu e cea din 20261213a (functii)';
  END IF;
  -- lock-uri ÎNAINTEA verificării politicilor
  SELECT string_agg(format('public.%I', obiect), ', ' ORDER BY obiect) INTO v_lista
    FROM public.fn_executie_acces_inventar() WHERE tip = 'tabel' AND clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox');
  EXECUTE 'LOCK TABLE ' || v_lista || ' IN ACCESS EXCLUSIVE MODE NOWAIT';
  LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE NOWAIT;
  v_dif := public.fn_executie_acces_politici_verifica('nou');
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261213a revenire: starea nu e cea din 20261213a (politici: %)', v_dif; END IF;
  SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', x.polrelid::regclass, x.polname, x.polcmd, x.polpermissive, x.polroles,
                                        coalesce(pg_get_expr(x.polqual, x.polrelid), ''), coalesce(pg_get_expr(x.polwithcheck, x.polrelid), '')), ';'
                                 ORDER BY x.polrelid::regclass::text, x.polname), ''))
    INTO v_alte0 FROM pg_policy x
   WHERE x.polname NOT LIKE 'executie\_acces\_%'
     AND (x.polrelid = 'storage.objects'::regclass
          OR x.polrelid IN (SELECT to_regclass('public.' || quote_ident(i.obiect)) FROM public.fn_executie_acces_inventar() i
                             WHERE i.tip = 'tabel' AND i.clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox')));

  -- formele vechi (textul exact al lui 20261209a, din același generator)
  FOR r IN SELECT * FROM public.fn_executie_acces_politici() WHERE nou_cit IS DISTINCT FROM vechi_cit OR nou_scr IS DISTINCT FROM vechi_scr ORDER BY tabel LOOP
    IF r.tabel = 'storage.objects' THEN
      EXECUTE format('ALTER POLICY executie_acces_obiect_citire ON storage.objects USING (%s)', r.vechi_cit);
      EXECUTE format('ALTER POLICY executie_acces_obiect_adauga ON storage.objects WITH CHECK (%s)', r.vechi_scr);
      EXECUTE format('ALTER POLICY executie_acces_obiect_modifica ON storage.objects USING (%s) WITH CHECK (%s)', r.vechi_scr, r.vechi_scr);
      EXECUTE format('ALTER POLICY executie_acces_obiect_sterge ON storage.objects USING (%s)', r.vechi_scr);
    ELSE
      EXECUTE format('ALTER POLICY executie_acces_citire ON public.%I USING (%s)', r.tabel, r.vechi_cit);
      EXECUTE format('ALTER POLICY executie_acces_adauga ON public.%I WITH CHECK (%s)', r.tabel, r.vechi_scr);
      EXECUTE format('ALTER POLICY executie_acces_modifica ON public.%I USING (%s) WITH CHECK (%s)', r.tabel, r.vechi_scr, r.vechi_scr);
      EXECUTE format('ALTER POLICY executie_acces_sterge ON public.%I USING (%s)', r.tabel, r.vechi_scr);
    END IF;
  END LOOP;
  v_dif := public.fn_executie_acces_politici_verifica('vechi');
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261213a revenire post: politicile nu au revenit la forma 20261209a: %', v_dif; END IF;
  -- nimic nu mai depinde de funcțiile de aici; restul politicilor neatins
  IF EXISTS (SELECT 1 FROM pg_depend d
              WHERE d.refclassid = 'pg_proc'::regclass
                AND d.refobjid IN (to_regprocedure('public.fn_executie_acces_proprii_citire()'), to_regprocedure('public.fn_executie_acces_proprii_scriere()'),
                                   to_regprocedure('public.fn_executie_acces_politici()'), to_regprocedure('public.fn_executie_acces_politici_verifica(text)'))
                AND d.deptype <> 'i') THEN
    RAISE EXCEPTION '20261213a revenire post: inca depinde ceva de functiile 20261213a';
  END IF;
  SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', x.polrelid::regclass, x.polname, x.polcmd, x.polpermissive, x.polroles,
                                        coalesce(pg_get_expr(x.polqual, x.polrelid), ''), coalesce(pg_get_expr(x.polwithcheck, x.polrelid), '')), ';'
                                 ORDER BY x.polrelid::regclass::text, x.polname), ''))
    INTO v_alte1 FROM pg_policy x
   WHERE x.polname NOT LIKE 'executie\_acces\_%'
     AND (x.polrelid = 'storage.objects'::regclass
          OR x.polrelid IN (SELECT to_regclass('public.' || quote_ident(i.obiect)) FROM public.fn_executie_acces_inventar() i
                             WHERE i.tip = 'tabel' AND i.clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox')));
  IF v_alte1 IS DISTINCT FROM v_alte0 OR EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'zz_executie_acces_proba_forma') THEN
    RAISE EXCEPTION '20261213a revenire post: s-au schimbat alte politici';
  END IF;
  DROP FUNCTION public.fn_executie_acces_politici_verifica(text);
  DROP FUNCTION public.fn_executie_acces_politici();
  DROP FUNCTION public.fn_executie_acces_proprii_scriere();
  DROP FUNCTION public.fn_executie_acces_proprii_citire();
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_executie\_acces\_%' OR p.proname = 'fn_executie_proiect_permis')) <> 16 THEN
    RAISE EXCEPTION '20261213a revenire post: au ramas functii';
  END IF;
  IF current_setting('gazpet.revenire_20261213a', true) IS DISTINCT FROM 'REDA_POLITICILE_20261209A:' || txid_current() THEN
    RAISE EXCEPTION '20261213a revenire: garda final invalida';
  END IF;
END $revenire$;
