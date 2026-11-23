-- Revenire 20261216a_executie_raport_rezumat. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: cele 3 trigger-e (trg_raport_zilnic_zz_rezumat pe rapoarte_zilnice, trg_raport_zilnic_salvari_rezumat pe
-- raport_zilnic_salvari, r4: trg_raport_rezumat_santier_mutat pe sites), cele 10 funcții fn_raport_rezumat_* (lista exactă, cu amprenta corpului
-- verificată, L15), constrângerea și cele 6 coloane rezumat_* (r4: + rezumat_proiect_id).
-- REFUZĂ dacă există rezumate CORECTATE de om (rezumat_sursa = 'editat'): textul lor ar dispărea în tăcere (golirea = decizie separată,
-- preview -> „da” Răzvan -> export -> apply). Rezumatele AUTOMATE / 'de_recompus' (și codurile rezumat_eroare) se pierd fără refuz: sunt
-- derivate din raport (refăcute de funcție oricând).
-- Rapoartele, liniile, jurnalul salvărilor și șantierele (în afară de trigger-ul lor) NU se ating.
--
-- LIVRAREA (r4, Jakarinos r3 P2: revenirea fără plafon total) = prin runner, ca migrarea, DOAR cu plafon (comanda exactă):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261216a_executie_raport_rezumat_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261216120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul de livrare (gazpet.livrare_migrare = '20261216a_executie_raport_rezumat_ROLLBACK:<txid>') și plafonul (SET de sesiune
--   înainte de BEGIN, 2000 ms, + marcajul gazpet.plafon_tranzactie); fără ele fișierul refuză. Garanția (formularea runnerului): ~2 s de la
--   BEGIN până la intrarea în COMMIT, altfel ROLLBACK la tot; COMMIT-ul propriu-zis nu e plafonat. Runnerul înregistrează revenirea în
--   istoricul migrărilor sub numele ei; o re-aplicare ulterioară a migrării = decizie separată (versiune nouă).
--   Valoarea 2000 ms: o citire a tabelului (căutarea corecturilor, sub SHARE) + catalog. Se MĂSOARĂ pe clonă (volumul de producție) cu runnerul
--   însuși: NOTICE-urile „20261216a revenire: SHARE la X ms … corecturi cautate la Y ms … exclusiv la Z ms … sfarsit la W ms de la BEGIN”
--   + LIVRARE_TIMP / PLAFON_TIMP ale runnerului; țintă W < 1000 ms. Dacă W ≥ 1500 ms pe clonă, NU se rulează: se discută valoarea în review.
-- Ordinea (r4; L06 = ordinea salvării: rapoarte_zilnice, raport_zilnic_salvari, apoi sites, tabelul altui modul, ultimul):
--   1. gărzile și starea EXACTĂ a migrării (doar catalog, niciun lock pe tabele);
--   2. căutarea corecturilor ÎNAINTEA lock-ului exclusiv: (a) o citire simplă, fără lock (refuz devreme, nimic ținut); (b) rapoarte_zilnice
--      SHARE NOWAIT (reîncercat până la 1 s de la BEGIN): SHARE oprește ORICE scriere pe tabel (deci nicio corectură nouă nu mai poate apărea),
--      dar NU și citirile; sub el, căutarea autoritară (o citire a tabelului: scrierile așteaptă cât ea, citirile merg);
--   3. abia apoi ACCESS EXCLUSIVE pe rapoarte_zilnice, raport_zilnic_salvari și sites (cerut de DROP COLUMN / DROP TRIGGER), reîncercat până la
--      1 s de la BEGIN, fiecare încercare cu lock_timeout 100 ms (fără NOWAIT: cererea celui care ține deja SHARE trece înaintea scrierilor care
--      așteaptă după el). Sub el DOAR catalog: reverificarea „fără corecturi” nu mai citește tabelul, pentru că SHARE e ținut neîntrerupt de la
--      căutarea autoritară (un lock urcat nu se pierde) — nicio scriere n-a putut trece între ele.
--   De ce nu un index parțial pe corecturi: crearea lui în migrare ar scana tabelul sub ACCESS EXCLUSIVE (exact ce r3 a scos din migrare), iar
--   CREATE INDEX CONCURRENTLY nu poate rula într-o tranzacție (runnerul = o tranzacție).
--   ACCESS EXCLUSIVE pe sites oprește și citirile șantierelor (multe politici le citesc) pe durata de după lock: catalog, sub plafon.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_fn name[] := ARRAY['fn_raport_rezumat_curata', 'fn_raport_rezumat_curata_editat', 'fn_raport_rezumat_taie', 'fn_raport_rezumat_sir',
                             'fn_raport_rezumat_nr', 'fn_raport_rezumat_text', 'fn_raport_rezumat_intrare', 'fn_raport_rezumat_garda',
                             'fn_raport_rezumat_dupa_salvare', 'fn_raport_rezumat_santier_mutat']::name[];
  v_col name[] := ARRAY['rezumat_text', 'rezumat_sursa', 'rezumat_la', 'rezumat_de', 'rezumat_eroare', 'rezumat_proiect_id']::name[];
  v_n integer; v_plafon text; v_incercari integer := 0;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261216a_executie_raport_rezumat_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261216a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261216a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261216a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  -- r4: plafonul total = ceasul de tranzacție PostgreSQL 17, pornit la BEGIN cu 2000 ms de runner, citit calificat + marcajul prologului
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261216a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261216a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- 1. starea exactă a migrării: funcțiile (corpul revizuit, DEFINER, proprietar, configurație, drepturi), trigger-ele (forma exactă + activ),
  -- constrângerea (definiția exactă), coloanele
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_raport\_rezumat\_%';
  IF v_n <> 10
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          JOIN (VALUES
            -- AMPRENTE-START
            ('fn_raport_rezumat_curata', 'public.fn_raport_rezumat_curata(text)', '1dc80111035b8102668d5d1e522a0e93'),
            ('fn_raport_rezumat_curata_editat', 'public.fn_raport_rezumat_curata_editat(text)', 'a165c617229ee4843fbd9fd33c26e42f'),
            ('fn_raport_rezumat_taie', 'public.fn_raport_rezumat_taie(text, integer)', '7903b72e96c3ab4617c865805cfe6d6f'),
            ('fn_raport_rezumat_sir', 'public.fn_raport_rezumat_sir(jsonb, text)', '053653a3014609f9a13c4f96b99af586'),
            ('fn_raport_rezumat_nr', 'public.fn_raport_rezumat_nr(jsonb)', '52082fbf3726918e913f1e0dcf30c2e9'),
            ('fn_raport_rezumat_text', 'public.fn_raport_rezumat_text(jsonb)', '8424e32d89ec23ea3eac50d70cbb2df0'),
            ('fn_raport_rezumat_intrare', 'public.fn_raport_rezumat_intrare(public.rapoarte_zilnice)', '9c2aa741a066d78b444972052e5e2148'),
            ('fn_raport_rezumat_garda', 'public.fn_raport_rezumat_garda()', '30c2221a1e8983a9fae77259e0ea8f5f'),
            ('fn_raport_rezumat_dupa_salvare', 'public.fn_raport_rezumat_dupa_salvare()', 'c50a62999b1f6f685d5dde349f7c2d6c'),
            ('fn_raport_rezumat_santier_mutat', 'public.fn_raport_rezumat_santier_mutat()', 'ff538640101ea652192f10a89edd5220')
            -- AMPRENTE-END
          ) a(nume, semnatura, amprenta) ON p.oid = to_regprocedure(a.semnatura)
         WHERE n.nspname = 'public' AND md5(replace(p.prosrc, chr(13), '')) = a.amprenta
           AND p.prosecdef = (a.nume IN ('fn_raport_rezumat_garda', 'fn_raport_rezumat_santier_mutat')) AND pg_get_userbyid(p.proowner) = 'postgres'
           AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE e.grantee = 0)) <> 10
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.rapoarte_zilnice'::regclass AND tg.tgname = 'trg_raport_zilnic_zz_rezumat'
                     AND tg.tgfoid = to_regprocedure('public.fn_raport_rezumat_garda()') AND tg.tgtype = (1 | 2 | 4 | 16) AND tg.tgqual IS NULL AND tg.tgnargs = 0
                     AND tg.tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.raport_zilnic_salvari'::regclass AND tg.tgname = 'trg_raport_zilnic_salvari_rezumat'
                     AND tg.tgfoid = to_regprocedure('public.fn_raport_rezumat_dupa_salvare()') AND tg.tgtype = (1 | 4) AND tg.tgqual IS NULL AND tg.tgnargs = 0
                     AND tg.tgenabled = 'O')
     -- r4: trigger-ul de mutare pe sites: AFTER UPDATE pe rând, toate coloanele, condiția exactă, activ
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.sites'::regclass AND tg.tgname = 'trg_raport_rezumat_santier_mutat'
                     AND tg.tgfoid = to_regprocedure('public.fn_raport_rezumat_santier_mutat()') AND tg.tgtype = (1 | 16) AND tg.tgnargs = 0
                     AND tg.tgattr = ''::int2vector AND tg.tgenabled = 'O'
                     AND pg_get_triggerdef(tg.oid) = 'CREATE TRIGGER trg_raport_rezumat_santier_mutat AFTER UPDATE ON public.sites FOR EACH ROW '
                         || 'WHEN ((old.proiect_id IS DISTINCT FROM new.proiect_id)) EXECUTE FUNCTION fn_raport_rezumat_santier_mutat()')
     OR (SELECT count(*) FROM pg_trigger tg WHERE tg.tgfoid IN (to_regprocedure('public.fn_raport_rezumat_garda()'), to_regprocedure('public.fn_raport_rezumat_dupa_salvare()'),
                                                               to_regprocedure('public.fn_raport_rezumat_santier_mutat()'))) <> 3
     -- definiția exactă (pg_get_constraintdef); „ NOT VALID” de la capăt e acceptat sau nu (un VALIDATE CONSTRAINT ulterior îl scoate)
     OR (SELECT regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') FROM pg_constraint c
          WHERE c.conrelid = 'public.rapoarte_zilnice'::regclass AND c.conname = 'rapoarte_zilnice_rezumat_ck' AND c.contype = 'c') IS DISTINCT FROM
        -- CHECK-DEF-START
        'CHECK (((((rezumat_sursa IS NULL) AND (rezumat_text IS NULL) AND (rezumat_la IS NULL) AND (rezumat_de IS NULL) AND (rezumat_proiect_id IS NULL)) OR ((rezumat_sursa = ''automat''::text) AND (rezumat_text IS NOT NULL) AND (rezumat_la IS NOT NULL) AND (rezumat_de IS NULL)) OR ((rezumat_sursa = ''editat''::text) AND (rezumat_text ~ ''[^[:space:]]''::text) AND (char_length(rezumat_text) <= 4000) AND (rezumat_la IS NOT NULL) AND (rezumat_de IS NOT NULL)) OR ((rezumat_sursa = ''de_recompus''::text) AND (rezumat_text IS NULL) AND (rezumat_la IS NOT NULL) AND (rezumat_de IS NULL) AND (rezumat_proiect_id IS NULL))) AND ((rezumat_eroare IS NULL) OR (rezumat_eroare ~ ''^[0-9A-Z]{5}$''::text))))'
        -- CHECK-DEF-END
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice'
          AND column_name = ANY (v_col::text[])) <> 6 THEN
    RAISE EXCEPTION '20261216a revenire: starea nu e cea din 20261216a';
  END IF;
  -- nimic altceva nu depinde de coloane / funcții: vederi, politici, alte funcții (dependențe în catalog și apeluri textuale)
  IF EXISTS (SELECT 1 FROM pg_depend d
              WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.rapoarte_zilnice'::regclass
                AND d.refobjsubid IN (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.rapoarte_zilnice'::regclass AND attname = ANY (v_col))
                AND NOT (d.classid = 'pg_constraint'::regclass
                         AND d.objid = (SELECT oid FROM pg_constraint WHERE conrelid = 'public.rapoarte_zilnice'::regclass AND conname = 'rapoarte_zilnice_rezumat_ck')))
     OR EXISTS (SELECT 1 FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid
                 WHERE d.classid = 'pg_proc'::regclass AND d.refclassid = 'pg_proc'::regclass
                   AND d.refobjid IN (SELECT p2.oid FROM pg_proc p2 JOIN pg_namespace n2 ON n2.oid = p2.pronamespace
                                       WHERE n2.nspname = 'public' AND p2.proname = ANY (v_fn))
                   AND NOT p.proname = ANY (v_fn))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '\mfn_raport_rezumat_')
     -- apelurile textuale ale funcțiilor (plpgsql nu lasă dependențe în catalog); coloanele: dependențele de mai sus (vederi, SQL, constrângeri)
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND n.nspname !~ '^pg_(toast_)?temp_'   -- funcțiile temporare ale sesiunii (ex. harness-ul) dispar cu ea
                   AND NOT (n.nspname = 'public' AND p.proname = ANY (v_fn))
                   AND p.prosrc ~ '\mfn_raport_rezumat_[a-z_]+\M') THEN
    RAISE EXCEPTION '20261216a revenire: alte obiecte depind de coloanele / functiile rezumatului';
  END IF;
  -- 2a. căutarea corecturilor fără niciun lock pe tabel: refuz devreme, nimic ținut
  IF EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE rezumat_sursa = 'editat') THEN
    RAISE EXCEPTION '20261216a revenire: exista rezumate corectate de om (rezumat_sursa = editat) — decizie separata inainte';
  END IF;
  -- 2b. SHARE (oprește scrierile, nu și citirile), NOWAIT + reîncercare până la 1 s de la BEGIN; sub el, căutarea autoritară
  LOOP
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.rapoarte_zilnice IN SHARE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20261216a revenire: BUGET_LOCK: rapoarte_zilnice ocupat (SHARE); % incercari, % ms de la BEGIN; nimic schimbat',
          v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  RAISE NOTICE '20261216a revenire: SHARE la % ms de la BEGIN (% incercari)', round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari;
  IF EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE rezumat_sursa = 'editat') THEN
    RAISE EXCEPTION '20261216a revenire: exista rezumate corectate de om (rezumat_sursa = editat) — decizie separata inainte';
  END IF;
  RAISE NOTICE '20261216a revenire: corecturi cautate la % ms de la BEGIN (0 gasite)', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
  -- 3. ACCESS EXCLUSIVE (DROP COLUMN / DROP TRIGGER), în ordinea salvării, sites ultimul; reîncercat până la 1 s de la BEGIN
  v_incercari := 0;
  LOOP
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.rapoarte_zilnice IN ACCESS EXCLUSIVE MODE;
      LOCK TABLE public.raport_zilnic_salvari IN ACCESS EXCLUSIVE MODE;
      LOCK TABLE public.sites IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20261216a revenire: BUGET_LOCK: rapoarte_zilnice / raport_zilnic_salvari / sites ocupate; % incercari, % ms de la BEGIN; nimic schimbat',
          v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
      END IF;
    END;
  END LOOP;
  RAISE NOTICE '20261216a revenire: exclusiv la % ms de la BEGIN (% incercari)', round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari;
  -- reverificarea sub lock = catalog: SHARE e ținut de la căutarea autoritară, deci nicio corectură nu putea apărea între timp
  IF NOT EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND l.granted
                   AND l.relation = 'public.rapoarte_zilnice'::regclass AND l.mode = 'ShareLock') THEN
    RAISE EXCEPTION '20261216a revenire: lock-ul SHARE de la cautarea corecturilor nu mai e tinut';
  END IF;
  -- scoaterea (fără CASCADE): trigger-ele, apoi funcțiile (garda depinde de intrare / text), apoi coloanele
  DROP TRIGGER trg_raport_rezumat_santier_mutat ON public.sites;
  DROP TRIGGER trg_raport_zilnic_salvari_rezumat ON public.raport_zilnic_salvari;
  DROP TRIGGER trg_raport_zilnic_zz_rezumat ON public.rapoarte_zilnice;
  DROP FUNCTION public.fn_raport_rezumat_santier_mutat();
  DROP FUNCTION public.fn_raport_rezumat_dupa_salvare();
  DROP FUNCTION public.fn_raport_rezumat_garda();
  DROP FUNCTION public.fn_raport_rezumat_intrare(public.rapoarte_zilnice);
  DROP FUNCTION public.fn_raport_rezumat_text(jsonb);
  DROP FUNCTION public.fn_raport_rezumat_nr(jsonb);
  DROP FUNCTION public.fn_raport_rezumat_sir(jsonb, text);
  DROP FUNCTION public.fn_raport_rezumat_taie(text, integer);
  DROP FUNCTION public.fn_raport_rezumat_curata_editat(text);
  DROP FUNCTION public.fn_raport_rezumat_curata(text);
  ALTER TABLE public.rapoarte_zilnice
    DROP CONSTRAINT rapoarte_zilnice_rezumat_ck,
    DROP COLUMN rezumat_text, DROP COLUMN rezumat_sursa, DROP COLUMN rezumat_la, DROP COLUMN rezumat_de, DROP COLUMN rezumat_eroare,
    DROP COLUMN rezumat_proiect_id;
  -- postcondiție
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice'
               AND column_name = ANY (v_col::text[]))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_raport\_rezumat\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_raport_zilnic_zz_rezumat', 'trg_raport_zilnic_salvari_rezumat', 'trg_raport_rezumat_santier_mutat'))
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rapoarte_zilnice_rezumat_ck')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.rapoarte_zilnice'::regclass AND tgname = 'trg_raport_zilnic_versiune') THEN
    RAISE EXCEPTION '20261216a revenire post: au ramas obiecte sau lipseste trigger-ul de versiune (20261208a)';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261216a_executie_raport_rezumat_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261216a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261216a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
