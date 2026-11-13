-- Revenire 20261223a_tichete_clarificari (r2). NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate cele 8 funcții și tabelul de evidență public.tichete_clarificari create de migrare. Detaliul COMPLET al fiecărei funcții (tip,
--   limbaj, definer, volatilitate, proprietar, config, tipul întors, drepturi, md5 pe corp) e comparat EXACT cu cel livrat; tabelul trebuie
--   să fie al lui postgres, fără triggere adăugate. Altă stare = refuz, nimic schimbat. Tabelele, triggerele și funcțiile existente NU se ating.
-- REFUZĂ dacă protocolul a fost folosit: un rând în tichete_clarificari (o rundă, o încheiere sau un marcaj „clarificat”) sau un comentariu
--   automat (fără autor, cu antetul protocolului). Evidența și mesajele trimise rămân dovada discuției; NU se șterg de aici. ÎN LOC de
--   revenire, oprirea se face din promptul rutinei (se scoate pasul de clarificări, docs/TICHETE_CLARIFICARI.md): funcțiile rămân, dar nu le
--   mai cheamă nimeni.
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon (comanda exactă):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261223a_tichete_clarificari_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261223120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul de livrare (gazpet.livrare_migrare = '20261223a_tichete_clarificari_ROLLBACK:<txid>') și plafonul; fără ele
--   fișierul refuză.
-- Ordinea: 1. gărzile și starea EXACTĂ a migrării (doar catalog); 2. tichete_clarificari ACCESS EXCLUSIVE + tichete_comentarii SHARE
--   (NOWAIT, reîncercat până la 1 s de la BEGIN) ÎNAINTEA verificării „nefolosit”: un apel în curs care a scris deja comentariul / rândul
--   de evidență ține ROW EXCLUSIVE pe tabelul respectiv, deci blocarea așteaptă până își termină scrierea și scrierea lui e numărată; un
--   apel care scrie după blocare așteaptă, iar după COMMIT-ul revenirii scrierea evidenței lui eșuează (tabelul scos) și tranzacția lui se
--   anulează întreagă (comentariul și notificarea lui inclusiv). Sub lock: reverificarea stării, „nefolosit”, DROP, postcondiția.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; r record; v_det text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261223a_tichete_clarificari_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261223a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261223a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261223a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261223a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261223a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      LOOP
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.tichete_clarificari IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.tichete_comentarii IN SHARE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          IF clock_timestamp() >= now() + interval '1 second' THEN
            RAISE EXCEPTION '20261223a revenire: BUGET_LOCK: tichete_clarificari / tichete_comentarii ocupate; % incercari, % ms de la BEGIN; nimic schimbat',
              v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
          END IF;
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
    END IF;
    -- starea exactă: cele 8 funcții, cu detaliul complet livrat (corpul revizuit = md5 pe corp, fără CR)
    FOR r IN SELECT * FROM (VALUES
        ('public.fn_tichet_clarificare_zile_lucratoare(timestamptz, timestamptz)', 'fn_tichet_clarificare_zile_lucratoare',
         -- DETALIU-START zile
         'tip=f, limbaj=sql, definer=false, volatil=s, proprietar=postgres, config=search_path=public, pg_temp, intoarce=integer, acl=postgres:EXECUTE, corp_md5=8b0789e91b0e0dfe626dcd296c2ccf18'
         -- DETALIU-END zile
        ),
        ('public.fn_tichet_clarificare_intrebari_motiv(text[])', 'fn_tichet_clarificare_intrebari_motiv',
         -- DETALIU-START intrebari
         'tip=f, limbaj=sql, definer=false, volatil=i, proprietar=postgres, config=search_path=public, pg_temp, intoarce=text, acl=postgres:EXECUTE, corp_md5=abf4cb7c37a1c91fea39a59707a86917'
         -- DETALIU-END intrebari
        ),
        ('public.fn_tichet_clarificare_apelant_ok()', 'fn_tichet_clarificare_apelant_ok',
         -- DETALIU-START apelant
         'tip=f, limbaj=sql, definer=false, volatil=s, proprietar=postgres, config=search_path=public, pg_temp, intoarce=boolean, acl=postgres:EXECUTE, corp_md5=d42b2449714cd346a7182c8a7901775e'
         -- DETALIU-END apelant
        ),
        ('public.fn_tichet_clarificare_context(bigint)', 'fn_tichet_clarificare_context',
         -- DETALIU-START context
         'tip=f, limbaj=sql, definer=false, volatil=s, proprietar=postgres, config=search_path=public, pg_temp, intoarce=text, acl=postgres:EXECUTE, corp_md5=f72159b227b6c8b47ee3a58e059ab04b'
         -- DETALIU-END context
        ),
        ('public.fn_tichet_clarificare_stare_tichet(bigint)', 'fn_tichet_clarificare_stare_tichet',
         -- DETALIU-START stare_tichet
         'tip=f, limbaj=plpgsql, definer=false, volatil=s, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=postgres:EXECUTE, corp_md5=53ed2cecff971ecf8c41f76b71d99776'
         -- DETALIU-END stare_tichet
        ),
        ('public.fn_tichet_clarificare_trimite(bigint, integer, text[], text)', 'fn_tichet_clarificare_trimite',
         -- DETALIU-START trimite
         'tip=f, limbaj=plpgsql, definer=true, volatil=v, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=postgres:EXECUTE, corp_md5=1b7299708198259bf226c479e5885e43'
         -- DETALIU-END trimite
        ),
        ('public.fn_tichet_clarificare_incheie(bigint, text, text)', 'fn_tichet_clarificare_incheie',
         -- DETALIU-START incheie
         'tip=f, limbaj=plpgsql, definer=true, volatil=v, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=postgres:EXECUTE, corp_md5=5ec3eadbfb34cee22b2c7d7e44fd17d1'
         -- DETALIU-END incheie
        ),
        ('public.fn_tichet_clarificare_stare()', 'fn_tichet_clarificare_stare',
         -- DETALIU-START stare
         'tip=f, limbaj=plpgsql, definer=true, volatil=s, proprietar=postgres, config=search_path=public, pg_temp, intoarce=TABLE(tichet_id bigint, numar_tichet text, status text, subcategorie text, creat_la timestamp with time zone, runda integer, faza text, ultim_automat_id bigint, ultim_automat_la timestamp with time zone, raspuns_autor boolean, ultim_raspuns_autor_la timestamp with time zone, zile_lucratoare integer, prag_tacere integer, actiune text, raspuns_dupa_incheiere boolean, detaliu text, versiune_context text), acl=postgres:EXECUTE, corp_md5=873d19b28bbb0afd7834340449744782'
         -- DETALIU-END stare
        )
      ) v(fn, nume, det) LOOP
      SELECT 'tip=' || p.prokind::text || ', limbaj=' || l.lanname::text || ', definer=' || p.prosecdef::text || ', volatil=' || p.provolatile::text
             || ', proprietar=' || pg_get_userbyid(p.proowner) || ', config=' || coalesce(array_to_string(p.proconfig, '; '), '(mostenit)')
             || ', intoarce=' || coalesce(pg_get_function_result(p.oid), '-')
             || ', acl=' || coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                  SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                         || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                    FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '(niciun drept)')
             || ', corp_md5=' || md5(replace(p.prosrc, chr(13), ''))
        INTO v_det
        FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure(r.fn);
      IF v_det IS DISTINCT FROM r.det
         OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.nume) <> 1 THEN
        RAISE EXCEPTION '20261223a revenire: starea nu e cea din 20261223a (pasul %, %: %)', v_pas, r.nume, coalesce(v_det, 'lipsa');
      END IF;
      -- nimic din afara migrării nu depinde de funcție (catalog + apeluri textuale: plpgsql nu lasă dependențe)
      IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure(r.fn)
                   AND NOT (d.classid = 'pg_proc'::regclass AND d.objid IN (SELECT p.oid FROM pg_proc p
                              WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%')))
         OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                       AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_tichet\_clarificare\_%')
                       AND p.prosrc ~ ('\m' || r.nume || '\M')) THEN
        RAISE EXCEPTION '20261223a revenire: alte obiecte depind de functia %', r.nume;
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%') <> 8 THEN
      RAISE EXCEPTION '20261223a revenire: starea nu e cea din 20261223a (pasul %, alte functii fn_tichet_clarificare_*)', v_pas;
    END IF;
    -- tabelul de evidență: al lui postgres, tabel simplu, fără triggere adăugate (DROP le-ar lua cu el)
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.tichete_clarificari') AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) = 'postgres')
       OR EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = to_regclass('public.tichete_clarificari') AND NOT tg.tgisinternal) THEN
      RAISE EXCEPTION '20261223a revenire: starea nu e cea din 20261223a (pasul %, tabelul tichete_clarificari)', v_pas;
    END IF;
  END LOOP;
  -- sub lock: protocolul nefolosit (evidența și mesajele trimise nu se șterg de aici)
  IF EXISTS (SELECT 1 FROM public.tichete_clarificari) THEN
    RAISE EXCEPTION '20261223a revenire: exista clarificari trimise (tichete_clarificari are randuri); in loc: oprirea pasului din promptul rutinei';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tichete_comentarii c
              WHERE c.autor IS NULL AND (c.text LIKE 'Clarificare _/2' || chr(10) || '%' OR c.text LIKE 'Clarificările automate s-au încheiat.%')) THEN
    RAISE EXCEPTION '20261223a revenire: exista comentarii automate de clarificare; in loc: oprirea pasului din promptul rutinei';
  END IF;
  DROP FUNCTION public.fn_tichet_clarificare_stare();
  DROP FUNCTION public.fn_tichet_clarificare_incheie(bigint, text, text);
  DROP FUNCTION public.fn_tichet_clarificare_trimite(bigint, integer, text[], text);
  DROP FUNCTION public.fn_tichet_clarificare_stare_tichet(bigint);
  DROP FUNCTION public.fn_tichet_clarificare_context(bigint);
  DROP FUNCTION public.fn_tichet_clarificare_apelant_ok();
  DROP FUNCTION public.fn_tichet_clarificare_intrebari_motiv(text[]);
  DROP FUNCTION public.fn_tichet_clarificare_zile_lucratoare(timestamptz, timestamptz);
  DROP TABLE public.tichete_clarificari;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%')
     OR to_regclass('public.tichete_clarificari') IS NOT NULL THEN
    RAISE EXCEPTION '20261223a revenire post: au ramas functii / tabelul';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261223a_tichete_clarificari_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261223a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261223a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
