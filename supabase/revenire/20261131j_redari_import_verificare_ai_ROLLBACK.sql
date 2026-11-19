-- Revenire 20261131j_redari_import_verificare_ai. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Readuce starea de dinainte de 20261131j: scoate tabelele red_proiect_drepturi și red_import_ai_jurnal (cu politicile, triggerul de jurnal și
--   FK-urile lor) și funcțiile fn_red_import_ai_poate / fn_red_import_ai_rezerva / fn_red_import_ai_inchide. Nimic altceva nu fusese schimbat.
-- CONTRACTUL L14 (textual): revenirea REFUZĂ la ORICE urmă de folosire după aplicare: un rând în red_proiect_drepturi (un drept acordat), un rând
--   în red_import_ai_jurnal (un apel rezervat / plătit) sau un rând în red_jurnal pentru tabela red_proiect_drepturi (un drept acordat și retras
--   între timp). Nimic nu se șterge din istoric: după primul drept acordat sau primul apel, întoarcerea = migrare nouă, revizuită.
-- Starea EXACTĂ a migrării e verificată de două ori (înainte și după lock): corpurile (AMPRENTE-NOI 20261131j) + proprietăți + ACL, tabelele.
--
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261131j_redari_import_verificare_ai_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261131200001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock (L06), punct unic, NOWAIT: red_proiect_drepturi → red_import_ai_jurnal → red_proiecte → profiles, toate ACCESS EXCLUSIVE (verificarea „fără
--   date” sub lock, apoi DROP), bugetul 1 s de la prima încercare. De ce ACCESS EXCLUSIVE și pe red_proiecte / profiles: scoaterea unui FK (DROP TABLE
--   sau DROP CONSTRAINT) ia ACCESS EXCLUSIVE pe tabela REFERITĂ (măsurat în proba PGlite: pg_locks după DROP); luat aici explicit, NOWAIT, în buget —
--   altfel DROP-ul l-ar aștepta implicit. Cât e ținut (până la COMMIT, plafonul 2000 ms) sunt oprite și CITIRILE din profiles și red_proiecte (toate
--   ecranele / politicile care le citesc așteaptă): de rulat doar într-un moment liniștit.
-- Probe: scripts/pglite/test_redari_import_ai_local.mjs (aplicare -> revenire -> reaplicare pe bază nefolosită; refuzurile revenirii, inclusiv istoricul).
DO $pre$
DECLARE v_plafon text; v_incercari integer := 0; v_t0 timestamptz; v_buget constant interval := interval '1 second'; v_pas integer; v_rau text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261131j_redari_import_verificare_ai_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261131j revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261131j revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261131j revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261131j revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261131j revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      v_t0 := clock_timestamp();
      LOOP
        IF clock_timestamp() >= v_t0 + v_buget THEN
          RAISE EXCEPTION '20261131j revenire: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul lock-urilor e 1 s de la prima incercare); nimic schimbat',
            v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000) USING ERRCODE = '55P03';
        END IF;
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.red_proiect_drepturi IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_import_ai_jurnal IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
      IF clock_timestamp() >= v_t0 + v_buget THEN
        RAISE EXCEPTION '20261131j revenire: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari); nimic schimbat',
          round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari USING ERRCODE = '55P03';
      END IF;
      RAISE NOTICE '20261131j revenire: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
    END IF;
    -- funcțiile: EXACT cele din 20261131j (amprentele AMPRENTE-NOI 20261131j din migrare) + proprietățile + ACL-urile
    SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
      FROM (VALUES
        -- >>> AMPRENTE-NOI 20261131j
        ('public.fn_red_import_ai_poate(uuid)', 'b20a13bf9179b76c00812b63362bf32f', 'sql', true, 's', 'boolean'),
        ('public.fn_red_import_ai_rezerva(uuid,uuid,text,text,integer,integer,integer,integer,integer)', '959e29666c0086ac713cbf3af4bc2318', 'plpgsql', true, 'v', 'jsonb'),
        ('public.fn_red_import_ai_inchide(uuid,uuid,text,integer,integer,integer,integer,text)', '33ac8ddf00565721662122fd7d71a3ef', 'plpgsql', true, 'v', 'boolean')
        -- <<< AMPRENTE-NOI 20261131j
      ) a(semnatura, amprenta, limbaj, definer, volatil, intoarce)
      LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
     WHERE p.oid IS NULL
        OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
        OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
        OR p.prosecdef IS DISTINCT FROM a.definer
        OR p.provolatile::text IS DISTINCT FROM a.volatil
        OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
        OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres';
    -- (to_regprocedure / to_regclass, nu ::regprocedure / ::regclass: pe o bază fără migrare refuzul trebuie să fie al gărzii, nu o eroare de cast)
    IF v_rau IS NOT NULL
       OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('fn_red_import_ai_poate', 'fn_red_import_ai_rezerva', 'fn_red_import_ai_inchide')) <> 3
       OR (SELECT string_agg(p.proname || '=' || coalesce((SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)::text, ''), ';' ORDER BY p.proname COLLATE "C")
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_red_import_ai_poate', 'fn_red_import_ai_rezerva', 'fn_red_import_ai_inchide'))
          IS DISTINCT FROM 'fn_red_import_ai_inchide={postgres=X/postgres,service_role=X/postgres};fn_red_import_ai_poate={authenticated=X/postgres,postgres=X/postgres};fn_red_import_ai_rezerva={authenticated=X/postgres,postgres=X/postgres}'
       OR to_regclass('public.red_proiect_drepturi') IS NULL OR to_regclass('public.red_import_ai_jurnal') IS NULL
       OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid IN (to_regclass('public.red_proiect_drepturi'), to_regclass('public.red_import_ai_jurnal')) AND NOT t.tgisinternal) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.red_proiect_drepturi') AND t.tgname = 'trg_red_jurnal'
                        AND t.tgfoid = to_regprocedure('public.fn_red_jurnal()') AND t.tgtype = 29 AND t.tgqual IS NULL AND t.tgnargs = 0)
       OR (SELECT count(*) FROM pg_policy WHERE polrelid IN (to_regclass('public.red_proiect_drepturi'), to_regclass('public.red_import_ai_jurnal'))) <> 2 THEN
      RAISE EXCEPTION '20261131j revenire: starea nu e cea din 20261131j (pasul %, functii: %)', v_pas, coalesce(v_rau, 'drepturi / variante / tabele / triggere / politici');
    END IF;
    -- L14: refuz pe ORICE urmă de folosire după aplicare (nimic nu se șterge)
    IF EXISTS (SELECT 1 FROM public.red_proiect_drepturi) OR EXISTS (SELECT 1 FROM public.red_import_ai_jurnal)
       OR EXISTS (SELECT 1 FROM public.red_jurnal j WHERE j.tabela = 'red_proiect_drepturi') THEN
      RAISE EXCEPTION '20261131j revenire: ISTORIC_NOU (L14): drepturi acordate (sau acordate si retrase) / apeluri AI dupa aplicare — nimic sters; intoarcerea = migrare noua, revizuita (pasul %)', v_pas;
    END IF;
  END LOOP;
END $pre$;

-- ─── 1. Funcțiile (întâi cele care nu sunt folosite de politici), apoi tabelele ────────────────────────────────────────────────
DROP FUNCTION public.fn_red_import_ai_inchide(uuid, uuid, text, integer, integer, integer, integer, text);
DROP FUNCTION public.fn_red_import_ai_rezerva(uuid, uuid, text, text, integer, integer, integer, integer, integer);
DROP TABLE public.red_import_ai_jurnal;
DROP FUNCTION public.fn_red_import_ai_poate(uuid);
DROP TABLE public.red_proiect_drepturi;

-- ─── 2. Postcondiții ─────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
BEGIN
  IF to_regclass('public.red_proiect_drepturi') IS NOT NULL OR to_regclass('public.red_import_ai_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                 AND p.proname IN ('fn_red_import_ai_poate', 'fn_red_import_ai_rezerva', 'fn_red_import_ai_inchide'))
     OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.confrelid IN ('public.red_proiecte'::regclass, 'public.profiles'::regclass)
                 AND c.conname LIKE ANY (ARRAY['red_proiect_drepturi%', 'red_import_ai_jurnal%'])) THEN
    RAISE EXCEPTION '20261131j revenire: postconditie: obiecte ramase';
  END IF;
  RAISE NOTICE '20261131j revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
