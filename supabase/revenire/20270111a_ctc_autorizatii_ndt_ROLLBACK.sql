-- Revenire 20270111a_ctc_autorizatii_ndt. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Readuce ofertare_parteneri_documente la starea din 20260924: CHECK-ul de categorie fără 'autorizatie_ndt' (același nume), apoi scoate trigger-ul
--   trg_ofertare_doc_cale_garda, funcția fn_ofertare_doc_cale_garda(), indexul unic ofertare_parteneri_documente_fisier_path_uq și cele două
--   RPC-uri CTC (fn_ctc_autorizatii_ndt(), fn_ctc_autorizatie_ndt_fisier(bigint)). fn_ctc_autorizatii_drept() (20261222b) rămâne.
-- ORDINEA: întâi UI-ul (secțiunea NDT din CTC + categoria din Parteneri), apoi edge-ul ctc-autorizatie-fisier fără ramura ndt_document_id,
--   apoi această revenire. Dacă edge-ul nou rămâne: RPC-ul lipsă → 503, fără semnătură (fail-closed).
-- Refuz pe date (L14): orice rând 'autorizatie_ndt' sau orice cale sub un dosar ndt/ = refuz, nimic schimbat (documentele se mută / șterg
--   întâi din Parteneri, de un om). Starea EXACTĂ a migrării e verificată sub lock: CHECK-ul, trigger-ul (funcție, moment, evenimente,
--   coloane, stare, fără WHEN / argumente), indexul, detaliul complet al celor trei funcții (aceleași câmpuri ca amprenta) și faptul că nimic
--   din afara migrării nu depinde de ele; altă stare = refuz cu câmpul care diferă.
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20270111a_ctc_autorizatii_ndt_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20270111120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock-uri: ACCESS EXCLUSIVE NOWAIT pe public.ofertare_parteneri_documente (ocupat = 55P03 imediat, nimic schimbat), ÎNAINTEA verificărilor
--   (L14); lock_timeout 100 ms pentru cele implicite. Probe: scripts/pglite/test_ctc_autorizatii_ndt_local.mjs.
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270111a_ctc_autorizatii_ndt_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270111a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270111a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270111a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270111a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270111a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.ofertare_parteneri_documente') IS NULL THEN RAISE EXCEPTION '20270111a revenire: lipseste public.ofertare_parteneri_documente'; END IF;
END $pre$;

LOCK TABLE public.ofertare_parteneri_documente IN ACCESS EXCLUSIVE MODE NOWAIT;

DO $stare$
DECLARE v_rau text; v_ndt integer; v_sub integer; r record; v_are jsonb;
BEGIN
  -- date noi (L14): autorizațiile NDT și orice cale din dosarele ndt/ — revenirea nu le pierde în tăcere
  SELECT count(*) FILTER (WHERE categorie = 'autorizatie_ndt'), count(*) FILTER (WHERE fisier_path IS NOT NULL AND strpos('/' || fisier_path, '/ndt/') > 0)
    INTO v_ndt, v_sub FROM public.ofertare_parteneri_documente;
  IF v_ndt > 0 OR v_sub > 0 THEN
    RAISE EXCEPTION '20270111a revenire: exista date NDT (% documente autorizatie_ndt, % cai in dosare ndt/); se lamuresc intai din Parteneri; nimic schimbat', v_ndt, v_sub;
  END IF;
  -- CHECK-urile, exact starea migrării
  SELECT string_agg(coalesce(a.conname, '+' || c.conname), ', ' ORDER BY coalesce(a.conname, c.conname)) INTO v_rau
    FROM (VALUES
      -- >>> CHECK-URI 20270111a
      ('ofertare_parteneri_documente_categorie_check', 'CHECK ((categorie = ANY (ARRAY[''autorizatie_isc''::text, ''iso''::text, ''certificat_legal''::text, ''atestat''::text, ''etalonare''::text, ''alta''::text, ''autorizatie_ndt''::text])))')
      -- <<< CHECK-URI 20270111a
    ) a(conname, def)
    FULL JOIN (SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
                WHERE conrelid = 'public.ofertare_parteneri_documente'::regclass AND contype = 'c') c ON c.conname = a.conname
   WHERE a.conname IS NULL OR c.conname IS NULL OR a.def IS DISTINCT FROM c.def;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270111a revenire: CHECK-urile ofertare_parteneri_documente difera de 20270111a: %', v_rau; END IF;
  -- trigger-ul EXACT (ca postcondiția migrării) și lista triggerelor
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_parteneri_documente'::regclass AND tg.tgname = 'trg_ofertare_doc_cale_garda'
                   AND NOT tg.tgisinternal AND tg.tgfoid = to_regprocedure('public.fn_ofertare_doc_cale_garda()') AND tg.tgtype = 23
                   AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0
                   AND (SELECT string_agg(a.attname::text, ',' ORDER BY a.attname::text) FROM unnest(tg.tgattr::int2[]) k(n)
                          JOIN pg_attribute a ON a.attrelid = tg.tgrelid AND a.attnum = k.n) = 'categorie,fisier_path,partener_id')
     OR (SELECT string_agg(tgname::text, ', ' ORDER BY tgname::text) FROM pg_trigger
          WHERE tgrelid = 'public.ofertare_parteneri_documente'::regclass AND NOT tgisinternal)
        IS DISTINCT FROM 'trg_ofertare_doc_cale_garda, trg_ofertare_parteneri_documente_touch' THEN
    RAISE EXCEPTION '20270111a revenire: trigger-ul de cale nu e cel din 20270111a (functie / moment / evenimente / coloane / stare / lista triggerelor)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('public.ofertare_parteneri_documente_fisier_path_uq')
                   AND i.indrelid = 'public.ofertare_parteneri_documente'::regclass AND i.indisunique
                   AND pg_get_indexdef(i.indexrelid) = 'CREATE UNIQUE INDEX ofertare_parteneri_documente_fisier_path_uq ON public.ofertare_parteneri_documente USING btree (fisier_path) WHERE (fisier_path IS NOT NULL)') THEN
    RAISE EXCEPTION '20270111a revenire: indexul unic pe fisier_path nu e cel din 20270111a';
  END IF;
  -- detaliul livrat al funcțiilor, câmp cu câmp (aceleași expresii ca blocul AMPRENTA_L15 v1 / revenirea 20261222b)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_ofertare_doc_cale_garda()', 'fn_ofertare_doc_cale_garda',
       -- DETALIU-START garda
       jsonb_build_object('tip', 'f', 'limbaj', 'plpgsql', 'definer', 'false', 'volatil', 'v', 'strict', 'false', 'leakproof', 'false',
         'proprietar', 'postgres', 'config', 'search_path=public, pg_temp', 'intoarce', 'trigger',
         'acl', 'postgres:EXECUTE',
         'corp_md5', '5c68115afc38f1ce2c688699bfa3e415', 'sqlbody_md5', '-')
       -- DETALIU-END garda
      ),
      ('public.fn_ctc_autorizatii_ndt()', 'fn_ctc_autorizatii_ndt',
       -- DETALIU-START lista
       jsonb_build_object('tip', 'f', 'limbaj', 'plpgsql', 'definer', 'true', 'volatil', 's', 'strict', 'false', 'leakproof', 'false',
         'proprietar', 'postgres', 'config', 'search_path=public, pg_temp',
         'intoarce', 'TABLE(id bigint, firma text, cui text, numar_document text, emitent text, metoda text, data_emitere date, '
                     'data_valabilitate date, fara_expirare boolean, stare text, are_fisier boolean)',
         'acl', 'authenticated:EXECUTE, postgres:EXECUTE',
         'corp_md5', '35fe8ffe7cebf09d33da17675455eafc', 'sqlbody_md5', '-')
       -- DETALIU-END lista
      ),
      ('public.fn_ctc_autorizatie_ndt_fisier(bigint)', 'fn_ctc_autorizatie_ndt_fisier',
       -- DETALIU-START fisierul
       jsonb_build_object('tip', 'f', 'limbaj', 'plpgsql', 'definer', 'true', 'volatil', 's', 'strict', 'false', 'leakproof', 'false',
         'proprietar', 'postgres', 'config', 'search_path=public, pg_temp', 'intoarce', 'text',
         'acl', 'authenticated:EXECUTE, postgres:EXECUTE',
         'corp_md5', '09c2ed4309d7c643a2d672e6d221a1db', 'sqlbody_md5', '-')
       -- DETALIU-END fisierul
      )
    ) v(fn, nume, livrat) LOOP
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.nume) <> 1
       OR to_regprocedure(r.fn) IS NULL THEN
      RAISE EXCEPTION '20270111a revenire: starea nu e cea din 20270111a (%: lipseste sau are supraincarcari)', r.nume;
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
    SELECT string_agg(k || ': are ' || coalesce(v_are ->> k, 'LIPSESTE') || ', livrat ' || coalesce(r.livrat ->> k, 'LIPSESTE'), '; ' ORDER BY k COLLATE "C")
      INTO v_rau
      FROM (SELECT jsonb_object_keys(v_are) AS k UNION SELECT jsonb_object_keys(r.livrat)) c
     WHERE (v_are ->> k) IS DISTINCT FROM (r.livrat ->> k);
    IF v_rau IS NOT NULL THEN
      RAISE EXCEPTION '20270111a revenire: starea nu e cea din 20270111a (%): %', r.nume, v_rau;
    END IF;
    -- nimic din afara migrării nu depinde de funcție (catalog: doar trigger-ul ei, pe garda; apeluri textuale în alte funcții)
    IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure(r.fn)
                 AND NOT (r.nume = 'fn_ofertare_doc_cale_garda' AND d.classid = 'pg_trigger'::regclass
                          AND d.objid = (SELECT tg.oid FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_parteneri_documente'::regclass
                                           AND tg.tgname = 'trg_ofertare_doc_cale_garda')))
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                     AND p.proname NOT IN ('fn_ofertare_doc_cale_garda', 'fn_ctc_autorizatii_ndt', 'fn_ctc_autorizatie_ndt_fisier')
                     AND p.prosrc ~ ('[[:<:]]' || r.nume || '[[:>:]]')) THEN
      RAISE EXCEPTION '20270111a revenire: alte obiecte depind de functia %', r.nume;
    END IF;
  END LOOP;
END $stare$;

-- ordinea specificației (§5.7): CHECK-ul vechi, apoi trigger-ul, funcția gărzii, indexul și cele două RPC-uri
ALTER TABLE public.ofertare_parteneri_documente DROP CONSTRAINT ofertare_parteneri_documente_categorie_check,
  ADD CONSTRAINT ofertare_parteneri_documente_categorie_check
  CHECK (categorie IN ('autorizatie_isc', 'iso', 'certificat_legal', 'atestat', 'etalonare', 'alta'));
DROP TRIGGER trg_ofertare_doc_cale_garda ON public.ofertare_parteneri_documente;
DROP FUNCTION public.fn_ofertare_doc_cale_garda();
DROP INDEX public.ofertare_parteneri_documente_fisier_path_uq;
DROP FUNCTION public.fn_ctc_autorizatie_ndt_fisier(bigint);
DROP FUNCTION public.fn_ctc_autorizatii_ndt();

DO $post$
DECLARE v_rau text;
BEGIN
  -- absența TUTUROR obiectelor noi (după nume, oricare semnătură)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname IN ('fn_ofertare_doc_cale_garda', 'fn_ctc_autorizatii_ndt', 'fn_ctc_autorizatie_ndt_fisier'))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ofertare_doc_cale_garda')
     OR EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ofertare_parteneri_documente_fisier_path_uq') THEN
    RAISE EXCEPTION '20270111a revenire post: au ramas obiecte';
  END IF;
  SELECT string_agg(coalesce(a.conname, '+' || c.conname), ', ' ORDER BY coalesce(a.conname, c.conname)) INTO v_rau
    FROM (VALUES
      -- >>> CHECK-URI 20260924
      ('ofertare_parteneri_documente_categorie_check', 'CHECK ((categorie = ANY (ARRAY[''autorizatie_isc''::text, ''iso''::text, ''certificat_legal''::text, ''atestat''::text, ''etalonare''::text, ''alta''::text])))')
      -- <<< CHECK-URI 20260924
    ) a(conname, def)
    FULL JOIN (SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
                WHERE conrelid = 'public.ofertare_parteneri_documente'::regclass AND contype = 'c' AND convalidated) c ON c.conname = a.conname
   WHERE a.conname IS NULL OR c.conname IS NULL OR a.def IS DISTINCT FROM c.def;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270111a revenire post: CHECK-urile ofertare_parteneri_documente: %', v_rau; END IF;
  IF (SELECT string_agg(tgname::text, ', ' ORDER BY tgname::text) FROM pg_trigger
       WHERE tgrelid = 'public.ofertare_parteneri_documente'::regclass AND NOT tgisinternal) IS DISTINCT FROM 'trg_ofertare_parteneri_documente_touch' THEN
    RAISE EXCEPTION '20270111a revenire post: triggerele ofertare_parteneri_documente';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270111a_ctc_autorizatii_ndt_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270111a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20270111a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
