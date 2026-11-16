-- Revenire 20261225a_executie_uscare. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: tabelele executie_uscari, executie_uscare_poze, executie_uscare_jurnal (cu politicile, trigger-ele și cheile
-- lor), cele 12 funcții fn_executie_uscare_*, politicile executie_uscare_citire / _adauga de pe storage.objects și bucket-ul executie-uscare.
-- Starea EXACTĂ a migrării e verificată înainte (amprenta corpului fiecărei funcții + proprietățile, politicile, trigger-ele): altă stare =
-- refuz, nimic schimbat. Tabelele și funcțiile existente NU se ating.
-- REFUZĂ dacă există date: un raport, o poză, un rând de jurnal sau un fișier în bucket (rapoartele de uscare sunt documente semnate;
-- golirea = decizie separată: preview → „da” Răzvan → export → apply).
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon:
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261225a_executie_uscare_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261225120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul (gazpet.livrare_migrare = '20261225a_executie_uscare_ROLLBACK:<txid>') și plafonul; fără ele fișierul refuză.
-- Ordinea (L06, L14): 1. gărzile + starea exactă (doar catalog); 2. lock-urile, NOWAIT, reîncercate ≤ 1 s de la BEGIN, în ordinea:
--   executie_uscari, executie_uscare_poze, executie_uscare_jurnal (ACCESS EXCLUSIVE), storage.objects (ACCESS EXCLUSIVE: DROP POLICY),
--   ÎNAINTEA verificării „fără date” (o scriere concurentă nu poate fi numărată 0 și apoi pierdută); 3. sub lock: starea din nou, „fără date”,
--   DROP-urile, postcondiția. RPC-urile migrării blochează doar rândurile acestor tabele (în aceeași ordine) → fără ciclu.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; r record; v_rau text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261225a_executie_uscare_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261225a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261225a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261225a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261225a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261225a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      LOOP
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.executie_uscari IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.executie_uscare_poze IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.executie_uscare_jurnal IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          IF clock_timestamp() >= now() + interval '1 second' THEN
            RAISE EXCEPTION '20261225a revenire: BUGET_LOCK: tabel ocupat; % incercari, % ms de la BEGIN; nimic schimbat',
              v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
          END IF;
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
    END IF;
    -- tabelele, politicile (câte una pe tabel), trigger-ele (câte două pe tabel), bucket-ul și cele două politici storage
    IF to_regclass('public.executie_uscari') IS NULL OR to_regclass('public.executie_uscare_poze') IS NULL OR to_regclass('public.executie_uscare_jurnal') IS NULL
       OR (SELECT count(*) FROM pg_policy WHERE polrelid IN ('public.executie_uscari'::regclass, 'public.executie_uscare_poze'::regclass,
                                                              'public.executie_uscare_jurnal'::regclass)) <> 3
       OR (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.executie_uscari'::regclass, 'public.executie_uscare_poze'::regclass,
                                                                                  'public.executie_uscare_jurnal'::regclass)) <> 6
       OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'executie-uscare')
       OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname IN ('executie_uscare_citire', 'executie_uscare_adauga')) <> 2 THEN
      RAISE EXCEPTION '20261225a revenire: starea nu e cea din 20261225a (pasul %, tabele / politici / trigger-e / bucket)', v_pas;
    END IF;
    -- funcțiile: exact cele 12, fiecare cu corpul revizuit (amprenta fără CR), limbajul, DEFINER-ul și search_path-ul din migrare
    SELECT string_agg(a.fn, ', ') INTO v_rau FROM (VALUES
        -- AMPRENTE-START
        ('public.fn_executie_uscare_utilaje_ok(jsonb)', 'sql', false, '5950452f25882bc1f1e087fde7dd7ad5'),
        ('public.fn_executie_uscare_cantariri_ok(jsonb)', 'sql', false, '17696f5b75830ec8653f890072e57166'),
        ('public.fn_executie_uscare_lipsa(public.executie_uscari)', 'sql', false, 'f705b938ddaa6aacecb1d82e8a87e9e0'),
        ('public.fn_executie_uscare_tranzitie(text, text)', 'sql', false, '2576d2a04c4a2177ac35cfd79c0ea84c'),
        ('public.fn_executie_uscare_garda()', 'plpgsql', false, '59301ecbc141bd84e57582ac0d448fa1'),
        ('public.fn_executie_uscare_poza_garda()', 'plpgsql', false, '61e054fed73b139da295212b69fbff6a'),
        ('public.fn_executie_uscare_jurnal_garda()', 'plpgsql', false, 'f6b8159d9439e6bd046fc4766d3076a9'),
        ('public.fn_executie_uscare_fara_golire()', 'plpgsql', false, '1b0ebeecc0b85f90e433e344a10524f4'),
        ('public.fn_executie_uscare_salveaza(bigint, bigint, integer, jsonb, uuid)', 'plpgsql', true, 'd18bcdbcfde1050f64d4fb12fc55d4ea'),
        ('public.fn_executie_uscare_stare(bigint, integer, text, text, uuid)', 'plpgsql', true, 'bfbf2fc73e69409e8242dbd681c0f429'),
        ('public.fn_executie_uscare_poza(bigint, text, bigint, text, text, integer, text, uuid)', 'plpgsql', true, '00faf19ac933d7280f98e6814a1b0e25'),
        ('public.fn_executie_uscare_obiect(text, text, boolean)', 'sql', true, '68edeea01bfa4aa86273c77719efb4d5')
        -- AMPRENTE-END
      ) a(fn, limbaj, definer, amp)
      WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                         WHERE p.oid = to_regprocedure(a.fn) AND l.lanname = a.limbaj AND p.prosecdef = a.definer
                           AND md5(replace(p.prosrc, chr(13), '')) = a.amp
                           AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']);
    IF v_rau IS NOT NULL
       OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_uscare\_%') <> 12 THEN
      RAISE EXCEPTION '20261225a revenire: starea nu e cea din 20261225a (pasul %, functii: %)', v_pas, coalesce(v_rau, 'alt numar');
    END IF;
    -- nimic din afara migrării nu depinde de obiectele ei: vederi / chei străine spre tabele, funcții care le numesc
    IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
                WHERE d.classid = 'pg_rewrite'::regclass
                  AND d.refobjid IN ('public.executie_uscari'::regclass, 'public.executie_uscare_poze'::regclass, 'public.executie_uscare_jurnal'::regclass))
       OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype = 'f'
                   AND c.confrelid IN ('public.executie_uscari'::regclass, 'public.executie_uscare_poze'::regclass, 'public.executie_uscare_jurnal'::regclass)
                   AND c.conrelid NOT IN ('public.executie_uscari'::regclass, 'public.executie_uscare_poze'::regclass, 'public.executie_uscare_jurnal'::regclass))
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                     AND p.proname NOT LIKE 'fn\_executie\_uscare\_%'
                     AND p.prosrc ~ '\m(executie_uscari|executie_uscare_poze|executie_uscare_jurnal|fn_executie_uscare_[a-z_]+)\M')
       OR EXISTS (SELECT 1 FROM pg_policies WHERE NOT (schemaname = 'storage' AND tablename = 'objects' AND policyname IN ('executie_uscare_citire', 'executie_uscare_adauga'))
                   AND NOT (schemaname = 'public' AND tablename IN ('executie_uscari', 'executie_uscare_poze', 'executie_uscare_jurnal'))
                   AND coalesce(qual, '') || coalesce(with_check, '') ~ '(executie-uscare|fn_executie_uscare_)') THEN
      RAISE EXCEPTION '20261225a revenire: alte obiecte depind de obiectele migrarii (vederi / chei straine / functii / politici)';
    END IF;
  END LOOP;
  -- sub lock: fără date (rapoartele de uscare sunt documente semnate și nu se șterg de aici)
  IF EXISTS (SELECT 1 FROM public.executie_uscari) OR EXISTS (SELECT 1 FROM public.executie_uscare_poze)
     OR EXISTS (SELECT 1 FROM public.executie_uscare_jurnal) OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'executie-uscare') THEN
    RAISE EXCEPTION '20261225a revenire: exista rapoarte / poze / jurnal / fisiere de uscare (nu se sterg de aici)';
  END IF;
  DROP POLICY executie_uscare_citire ON storage.objects;
  DROP POLICY executie_uscare_adauga ON storage.objects;
  -- Storage poate refuza ștergerile directe din tabelele lui (trigger de protecție, comutat de această setare locală tranzacției);
  -- bucket-ul e gol (verificat mai sus, sub lock)
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.buckets WHERE id = 'executie-uscare';
  -- fn_executie_uscare_lipsa are parametrul de tipul rândului executie_uscari: iese înaintea tabelului (trigger-ul o cheamă doar prin nume)
  DROP FUNCTION public.fn_executie_uscare_lipsa(public.executie_uscari);
  DROP TABLE public.executie_uscare_jurnal;
  DROP TABLE public.executie_uscare_poze;
  DROP TABLE public.executie_uscari;
  DROP FUNCTION public.fn_executie_uscare_salveaza(bigint, bigint, integer, jsonb, uuid);
  DROP FUNCTION public.fn_executie_uscare_stare(bigint, integer, text, text, uuid);
  DROP FUNCTION public.fn_executie_uscare_poza(bigint, text, bigint, text, text, integer, text, uuid);
  DROP FUNCTION public.fn_executie_uscare_obiect(text, text, boolean);
  DROP FUNCTION public.fn_executie_uscare_garda();
  DROP FUNCTION public.fn_executie_uscare_poza_garda();
  DROP FUNCTION public.fn_executie_uscare_jurnal_garda();
  DROP FUNCTION public.fn_executie_uscare_fara_golire();
  DROP FUNCTION public.fn_executie_uscare_tranzitie(text, text);
  DROP FUNCTION public.fn_executie_uscare_utilaje_ok(jsonb);
  DROP FUNCTION public.fn_executie_uscare_cantariri_ok(jsonb);
  IF to_regclass('public.executie_uscari') IS NOT NULL OR to_regclass('public.executie_uscare_poze') IS NOT NULL OR to_regclass('public.executie_uscare_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_uscare\_%')
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'executie-uscare')
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'executie\_uscare\_%') THEN
    RAISE EXCEPTION '20261225a revenire post: au ramas obiecte';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261225a_executie_uscare_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261225a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261225a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
