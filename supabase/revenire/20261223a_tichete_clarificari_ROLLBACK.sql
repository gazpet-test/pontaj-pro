-- Revenire 20261223a_tichete_clarificari (r3). NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate ce a creat migrarea: trigger-ul trg_tichet_clarificare_ancora de pe tichete, cele 10 funcții, tabelul de evidență
--   public.tichete_clarificari și tabelul ancorelor public.tichete_clarificari_ancore. Detaliul COMPLET al fiecărei funcții (tip, limbaj,
--   definer, volatilitate, proprietar, config, tipul întors, drepturi, md5 pe corp) e comparat EXACT cu cel livrat; trigger-ul trebuie să
--   fie EXACT cel livrat (nume, tabel, funcție, tgtype, WHEN, argumente, coloane, stare); tabelele trebuie să fie ale lui postgres, fără
--   triggere adăugate. Altă stare = refuz, nimic schimbat. Celelalte tabele, triggere și funcții existente NU se ating.
-- REFUZĂ dacă protocolul a fost folosit: un rând în tichete_clarificari (o rundă, o încheiere sau un marcaj „clarificat”) sau un comentariu
--   automat (fără autor, cu antetul protocolului). Evidența și mesajele trimise rămân dovada discuției; NU se șterg de aici. Ancorele singure
--   (tichete create după aplicare, fără nicio clarificare) NU blochează: sunt doar proveniență, dispar cu tabelul (la o re-aplicare,
--   tichetele de dinainte rămân în afara protocolului). ÎN LOC de revenire, oprirea se face din promptul rutinei (se scoate pasul de
--   clarificări, docs/TICHETE_CLARIFICARI.md): funcțiile rămân, dar nu le mai cheamă nimeni.
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon (comanda exactă):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261223a_tichete_clarificari_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261223120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul de livrare (gazpet.livrare_migrare = '20261223a_tichete_clarificari_ROLLBACK:<txid>') și plafonul; fără ele
--   fișierul refuză.
-- Ordinea: 1. gărzile și starea EXACTĂ a migrării (doar catalog); 2. lock-urile, în ordinea căilor de scriere (L06): tichete ACCESS
--   EXCLUSIVE (cerut de DROP TRIGGER; un apel al rutinei sau o scriere pe tichete în curs ține lock pe tabel, deci revenirea reîncearcă) ->
--   tichete_comentarii SHARE -> tichete_clarificari ACCESS EXCLUSIVE -> tichete_clarificari_ancore ACCESS EXCLUSIVE (NOWAIT, reîncercat până
--   la 1 s de la BEGIN) ÎNAINTEA verificării „nefolosit”: un apel în curs care a scris deja comentariul / rândul de evidență ține lock pe
--   tabelul respectiv, deci blocarea așteaptă până își termină scrierea și scrierea lui e numărată; un apel care începe după blocare
--   așteaptă lock-ul rândului tichetului, iar după COMMIT-ul revenirii nu mai găsește protocolul (protocol_retras) sau, dacă a trecut de
--   acea verificare, scrierea evidenței lui eșuează (tabelul scos) și tranzacția lui se anulează întreagă. Sub lock: reverificarea stării,
--   „nefolosit”, DROP, postcondiția.
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
          LOCK TABLE public.tichete IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.tichete_comentarii IN SHARE MODE NOWAIT;
          LOCK TABLE public.tichete_clarificari IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.tichete_clarificari_ancore IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          IF clock_timestamp() >= now() + interval '1 second' THEN
            RAISE EXCEPTION '20261223a revenire: BUGET_LOCK: tichete / tichete_comentarii / tichete_clarificari / tichete_clarificari_ancore ocupate; % incercari, % ms de la BEGIN; nimic schimbat',
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
         'tip=f, limbaj=sql, definer=false, volatil=s, proprietar=postgres, config=search_path=public, pg_temp, intoarce=text, acl=postgres:EXECUTE, corp_md5=27c21c847a73fbbe6fb1263564948a36'
         -- DETALIU-END context
        ),
        ('public.fn_tichet_clarificare_stare_tichet(bigint)', 'fn_tichet_clarificare_stare_tichet',
         -- DETALIU-START stare_tichet
         'tip=f, limbaj=plpgsql, definer=false, volatil=s, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=postgres:EXECUTE, corp_md5=37ffbfa2c7aaa0a23834cd3395c2c776'
         -- DETALIU-END stare_tichet
        ),
        ('public.fn_tichet_clarificare_trimite(bigint, integer, text[], text)', 'fn_tichet_clarificare_trimite',
         -- DETALIU-START trimite
         'tip=f, limbaj=plpgsql, definer=true, volatil=v, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=postgres:EXECUTE, corp_md5=6084c6ed2d4f24470a19d31c25cbd44c'
         -- DETALIU-END trimite
        ),
        ('public.fn_tichet_clarificare_incheie(bigint, text, text)', 'fn_tichet_clarificare_incheie',
         -- DETALIU-START incheie
         'tip=f, limbaj=plpgsql, definer=true, volatil=v, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=postgres:EXECUTE, corp_md5=346fc394be1019b39e318cb8de4aefcb'
         -- DETALIU-END incheie
        ),
        ('public.fn_tichet_clarificare_stare()', 'fn_tichet_clarificare_stare',
         -- DETALIU-START stare
         'tip=f, limbaj=plpgsql, definer=true, volatil=s, proprietar=postgres, config=search_path=public, pg_temp, intoarce=TABLE(tichet_id bigint, numar_tichet text, status text, subcategorie text, creat_la timestamp with time zone, runda integer, faza text, ultim_automat_id bigint, ultim_automat_la timestamp with time zone, raspuns_autor boolean, ultim_raspuns_autor_la timestamp with time zone, zile_lucratoare integer, prag_tacere integer, actiune text, raspuns_dupa_incheiere boolean, detaliu text, versiune_context text), acl=postgres:EXECUTE, corp_md5=873d19b28bbb0afd7834340449744782'
         -- DETALIU-END stare
        ),
        ('public.fn_tichet_clarificare_eligibil_motiv(text, text, jsonb, text)', 'fn_tichet_clarificare_eligibil_motiv',
         -- DETALIU-START eligibil
         'tip=f, limbaj=sql, definer=false, volatil=i, proprietar=postgres, config=search_path=public, pg_temp, intoarce=text, acl=postgres:EXECUTE, corp_md5=ab261e83e88d6ca88c70dfff9543d206'
         -- DETALIU-END eligibil
        ),
        ('public.fn_tichet_clarificare_ancora()', 'fn_tichet_clarificare_ancora',
         -- DETALIU-START ancora
         'tip=f, limbaj=plpgsql, definer=true, volatil=v, proprietar=postgres, config=search_path=public, pg_temp, intoarce=trigger, acl=postgres:EXECUTE, corp_md5=266c393913e0caab43841ff08fbd83e1'
         -- DETALIU-END ancora
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
      -- nimic din afara migrării nu depinde de funcție (catalog + apeluri textuale: plpgsql nu lasă dependențe); singura dependență
      -- permisă în afara funcțiilor: trigger-ul ancorei pe funcția lui (verificat EXACT mai jos)
      IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure(r.fn)
                   AND NOT (d.classid = 'pg_proc'::regclass AND d.objid IN (SELECT p.oid FROM pg_proc p
                              WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%'))
                   AND NOT (r.nume = 'fn_tichet_clarificare_ancora' AND d.classid = 'pg_trigger'::regclass
                            AND d.objid IN (SELECT tg.oid FROM pg_trigger tg WHERE tg.tgname = 'trg_tichet_clarificare_ancora'
                                              AND tg.tgrelid = to_regclass('public.tichete'))))
         OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                       AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_tichet\_clarificare\_%')
                       AND p.prosrc ~ ('\m' || r.nume || '\M')) THEN
        RAISE EXCEPTION '20261223a revenire: alte obiecte depind de functia %', r.nume;
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%') <> 10 THEN
      RAISE EXCEPTION '20261223a revenire: starea nu e cea din 20261223a (pasul %, alte functii fn_tichet_clarificare_*)', v_pas;
    END IF;
    -- trigger-ul ancorei: EXACT cel livrat (un singur trigger pe funcția lui; tichete, AFTER INSERT OR UPDATE FOR EACH ROW = tgtype 21,
    -- fără WHEN / argumente / coloane, activ)
    IF (SELECT count(*) FROM pg_trigger tg WHERE tg.tgfoid = to_regprocedure('public.fn_tichet_clarificare_ancora()')) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_trigger tg
                       WHERE tg.tgfoid = to_regprocedure('public.fn_tichet_clarificare_ancora()') AND tg.tgrelid = to_regclass('public.tichete')
                         AND tg.tgname = 'trg_tichet_clarificare_ancora' AND tg.tgtype = 21 AND tg.tgenabled = 'O' AND NOT tg.tgisinternal
                         AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND cardinality(tg.tgattr::int2[]) = 0 AND tg.tgconstraint = 0) THEN
      RAISE EXCEPTION '20261223a revenire: starea nu e cea din 20261223a (pasul %, trigger-ul trg_tichet_clarificare_ancora)', v_pas;
    END IF;
    -- tabelele noi: ale lui postgres, tabele simple, fără triggere adăugate (DROP le-ar lua cu ele)
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.tichete_clarificari') AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) = 'postgres')
       OR EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = to_regclass('public.tichete_clarificari') AND NOT tg.tgisinternal) THEN
      RAISE EXCEPTION '20261223a revenire: starea nu e cea din 20261223a (pasul %, tabelul tichete_clarificari)', v_pas;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.tichete_clarificari_ancore') AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) = 'postgres')
       OR EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = to_regclass('public.tichete_clarificari_ancore') AND NOT tg.tgisinternal) THEN
      RAISE EXCEPTION '20261223a revenire: starea nu e cea din 20261223a (pasul %, tabelul tichete_clarificari_ancore)', v_pas;
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
  DROP TRIGGER trg_tichet_clarificare_ancora ON public.tichete;
  DROP FUNCTION public.fn_tichet_clarificare_ancora();
  DROP FUNCTION public.fn_tichet_clarificare_eligibil_motiv(text, text, jsonb, text);
  DROP FUNCTION public.fn_tichet_clarificare_stare();
  DROP FUNCTION public.fn_tichet_clarificare_incheie(bigint, text, text);
  DROP FUNCTION public.fn_tichet_clarificare_trimite(bigint, integer, text[], text);
  DROP FUNCTION public.fn_tichet_clarificare_stare_tichet(bigint);
  DROP FUNCTION public.fn_tichet_clarificare_context(bigint);
  DROP FUNCTION public.fn_tichet_clarificare_apelant_ok();
  DROP FUNCTION public.fn_tichet_clarificare_intrebari_motiv(text[]);
  DROP FUNCTION public.fn_tichet_clarificare_zile_lucratoare(timestamptz, timestamptz);
  DROP TABLE public.tichete_clarificari;
  DROP TABLE public.tichete_clarificari_ancore;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%')
     OR to_regclass('public.tichete_clarificari') IS NOT NULL OR to_regclass('public.tichete_clarificari_ancore') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.tichete'::regclass AND tg.tgname = 'trg_tichet_clarificare_ancora') THEN
    RAISE EXCEPTION '20261223a revenire post: au ramas functii / tabelele / trigger-ul';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261223a_tichete_clarificari_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261223a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261223a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
