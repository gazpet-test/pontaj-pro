-- Version 20261229120200. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20261229c_administrativ_upa_bucket.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2, ca 20261229a).
--   Lista OBIECTELOR revizuită: supabase/tests/20261229c_administrativ_upa_bucket.l15.obiecte.tsv.
-- 20261229c_administrativ_upa_bucket — Administrativ → Unități protejate: drepturile pe bucketul Storage documente-upa (facturile UPA = dovada
--   pentru control), aliniate cu regula din upa_achizitii (acordul owner-ului, 19.11.2026).
-- Ce face:
--   * înlocuiește politica largă "upa docs authenticated all" (FOR ALL TO public: ORICE cont logat citea, încărca, suprascria și ștergea orice
--     factură UPA) cu trei politici pe storage.objects, doar pentru bucket_id = 'documente-upa':
--       upa_docs_citire   SELECT (deci și linkul semnat): fn_upa_poate_citi() = owner sau administrativ / administrativ.upa la ORICE nivel;
--       upa_docs_adaugare INSERT: fn_upa_poate_scrie() (din 20261229a: owner sau administrativ / administrativ.upa admin / editor);
--       upa_docs_stergere DELETE: fn_upa_poate_scrie().
--     UPDATE: niciuna (nu e nevoie: ecranul și Citește Orice încarcă doar cu upsert:false și nu mută fișiere în bucket) = nimeni nu suprascrie.
--   * fn_upa_poate_citi() (SECURITY DEFINER, identitatea = auth.uid(), L08): predicatul de citire, același tipar ca fn_upa_poate_scrie.
-- Ce NU face: nu atinge bucketul (storage.buckets), fișierele, alte politici de pe storage.objects, upa_achizitii sau drepturile pe module.
-- CERE 20261229a aplicată: fn_upa_poate_scrie() cu amprenta EXACTĂ (sursa, DEFINER, search_path, proprietar, drepturi) — verificată în $pre$.
-- ORDINEA LIVRĂRII (de coordonator, după „da”): 20261229a -> merge-ul ecranului NOU (ascunde scrierea celor fără drept) -> VERIFICAREA PE LIVE
--   (chat-ul, nu migrarea): cine a încărcat / confirmat facturi UPA în ultimele luni (Unități protejate și Citește Orice → UPA) FĂRĂ acces
--   Administrativ / Unități protejate admin sau editor — după aplicare acel cont n-ar mai putea încărca; cine citea facturile fără niciun acces
--   Administrativ n-ar mai putea deschide PDF-ul. Abia apoi 20261229c. Citește Orice mută factura în bucket CA utilizatorul care confirmă.
-- Ordinea lock-urilor (L06): migrarea ia doar storage.objects; politicile noi nu blochează nimic (citesc profiles / user_module_access).
-- Lock la aplicare (punct unic, NOWAIT, bugetul 1 s de la prima încercare, docs/LIVRARE_L15_V2.md §9): storage.objects ACCESS EXCLUSIVE
--   (DROP / CREATE POLICY + sonda politicilor). Lock-urile implicite de după set: citiri (ACCESS SHARE) pe storage.buckets, profiles,
--   user_module_access în preflight / sondă; copia sondei e o tabelă temporară anulată (pg_temp.objects).
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, garda finală.
-- Revenire: supabase/revenire/20261229c_administrativ_upa_bucket_ROLLBACK.sql (reface EXACT politica veche). Probe: scripts/pglite/test_upa_alerta_local.mjs.
DO $pre$
DECLARE v_plafon text; v_pol record; v_n integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261229c_administrativ_upa_bucket:' || txid_current() THEN
    RAISE EXCEPTION '20261229c: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261229c: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261229c: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261229c: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20261229c: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20261229c: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regprocedure('public.fn_upa_poate_citi()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_upa_poate_citi')
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname IN ('upa_docs_citire', 'upa_docs_adaugare', 'upa_docs_stergere')) THEN
    RAISE EXCEPTION '20261229c: obiectele exista deja (reaplicare)';
  END IF;
  -- 20261229a aplicată: fn_upa_poate_scrie() EXACT cea revizuită (sursa fără CR, DEFINER, STABLE, search_path, proprietar, drepturi)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = to_regprocedure('public.fn_upa_poate_scrie()') AND l.lanname = 'sql' AND p.prosecdef AND p.provolatile = 's'
                    AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND md5(replace(p.prosrc, chr(13), '')) = 'f471aac26eec8d6dfae5749073a00fc4'
                    AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                           SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                                  || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                             FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE') THEN
    RAISE EXCEPTION '20261229c: cere 20261229a aplicata (fn_upa_poate_scrie() lipseste sau nu e forma revizuita); nimic schimbat';
  END IF;
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL
     OR (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'storage.objects'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION '20261229c: storage.objects lipseste sau nu are RLS pornit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'documente-upa') THEN
    RAISE EXCEPTION '20261229c: bucketul documente-upa lipseste';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION '20261229c: auth.uid() lipseste'; END IF;
  -- politica veche: EXACT forma din baseline (FOR ALL TO public, permisivă, USING = WITH CHECK = bucket + auth.uid() IS NOT NULL), o singură dată
  SELECT count(*) INTO v_n FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'upa docs authenticated all';
  SELECT p.polcmd, p.polpermissive, p.polroles, pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS c INTO v_pol
    FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'upa docs authenticated all';
  IF v_n <> 1 OR v_pol.polcmd::text IS DISTINCT FROM '*' OR v_pol.polpermissive IS NOT TRUE OR v_pol.polroles IS DISTINCT FROM ARRAY[0]::oid[]
     OR v_pol.q IS DISTINCT FROM '((bucket_id = ''documente-upa''::text) AND (auth.uid() IS NOT NULL))'
     OR v_pol.c IS DISTINCT FROM '((bucket_id = ''documente-upa''::text) AND (auth.uid() IS NOT NULL))' THEN
    RAISE NOTICE '20261229c: politica veche gasita: n=% cmd=% perm=% roluri=% using=% check=%', v_n, v_pol.polcmd, v_pol.polpermissive, v_pol.polroles, v_pol.q, v_pol.c;
    RAISE EXCEPTION '20261229c: politica "upa docs authenticated all" nu e exact forma revizuita (ALL TO public, bucket + auth.uid() IS NOT NULL); nimic schimbat';
  END IF;
END $pre$;

-- ── lock-ul pe storage.objects (punct unic, NOWAIT, bugetul 1 s de la PRIMA încercare; momentul în gazpet.lock_puternic_la pentru LOCK_TINUT) ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20261229c: BUGET_LOCK: storage.objects ocupat; % incercari, % ms de la prima incercare (bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20261229c: BUGET_LOCK: lock-ul pe storage.objects obtinut abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20261229c: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. Predicatul de citire (L19, L08: identitatea = auth.uid()) ────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_upa_poate_citi() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL
     AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
          OR EXISTS (SELECT 1 FROM public.user_module_access u
                      WHERE u.profile_id = auth.uid() AND u.module IN ('administrativ', 'administrativ.upa')))
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_poate_citi() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_poate_citi() TO authenticated;
COMMENT ON FUNCTION public.fn_upa_poate_citi() IS 'UPA (20261229c): apelantul (auth.uid()) e owner sau are administrativ / administrativ.upa la orice nivel. Citirea facturilor din documente-upa.';

-- ─── 2. Politicile bucketului ────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY "upa docs authenticated all" ON storage.objects;
CREATE POLICY upa_docs_citire ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documente-upa' AND (SELECT public.fn_upa_poate_citi()));
CREATE POLICY upa_docs_adaugare ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documente-upa' AND (SELECT public.fn_upa_poate_scrie()));
CREATE POLICY upa_docs_stergere ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documente-upa' AND (SELECT public.fn_upa_poate_scrie()));

-- ─── 3. Postcondiții ─────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_pol text; v_amp text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = to_regprocedure('public.fn_upa_poate_citi()') AND l.lanname = 'sql' AND p.prosecdef AND p.provolatile = 's'
                    AND p.prokind = 'f' AND NOT p.proleakproof AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
                    AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                           SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                                  || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                             FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_upa_poate_citi') <> 1 THEN
    RAISE EXCEPTION '20261229c post: functia fn_upa_poate_citi (limbaj / definer / search_path / owner / drepturi exacte)';
  END IF;
  -- politicile EXACTE ale bucketului (nume | comandă | P/R | roluri | USING | CHECK); politica veche a dispărut
  SELECT string_agg(p.polname || ' | ' || p.polcmd::text || ' | ' || CASE WHEN p.polpermissive THEN 'P' ELSE 'R' END || ' | '
                    || (SELECT string_agg(CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END, ',' ORDER BY 1) FROM unnest(p.polroles) ro) || ' | '
                    || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' | ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'),
                    chr(10) ORDER BY p.polname)
    INTO v_pol FROM pg_policy p
   WHERE p.polrelid = 'storage.objects'::regclass AND p.polname IN ('upa_docs_citire', 'upa_docs_adaugare', 'upa_docs_stergere', 'upa docs authenticated all');
  IF v_pol IS DISTINCT FROM concat_ws(chr(10),
       'upa_docs_adaugare | a | P | authenticated | - | ((bucket_id = ''documente-upa''::text) AND ( SELECT fn_upa_poate_scrie() AS fn_upa_poate_scrie))',
       'upa_docs_citire | r | P | authenticated | ((bucket_id = ''documente-upa''::text) AND ( SELECT fn_upa_poate_citi() AS fn_upa_poate_citi)) | -',
       'upa_docs_stergere | d | P | authenticated | ((bucket_id = ''documente-upa''::text) AND ( SELECT fn_upa_poate_scrie() AS fn_upa_poate_scrie)) | -') THEN
    RAISE EXCEPTION '20261229c post: politicile bucketului nu sunt cele declarate: %', v_pol;
  END IF;
  -- AMPRENTA_20261229c_INCEPUT (blocul e IDENTIC în migrare și în revenire; proba PGlite compară textul)
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
    RAISE EXCEPTION '20261229c post: AMPRENTA obiectelor % (asteptat 91c138f7e6265316a94af0e9a2ea1103)', md5(coalesce(v_amp, ''));
  END IF;
END $post$;

-- ── postcondiția pe politicile EFECTIVE ale bucketului (TOATE politicile de pe storage.objects): o SONDĂ, anulată integral ──
-- Același tipar ca 20261225a (acolo, comentariile complete): o copie TEMPORARĂ pg_temp.objects (aceleași coloane, inclusiv cele generate), cu
--   EXACT politicile de pe storage.objects (recreate neschimbate din catalog: ale noastre și orice politică generică ce nu numește bucketul) și
--   EXACT drepturile pe tabel ale rolurilor anon / authenticated; condițiile sondei verificate (altfel SONDA_CONDITII, distinct de un refuz RLS).
-- Identitățile: anonim; un cont sintetic fără niciun drept; conturi REALE (doar citite, câte primul după id): owner; scriere = admin / editor pe
--   administrativ și pe administrativ.upa (fără owner); citire = viewer pe administrativ / administrativ.upa FĂRĂ admin / editor pe niciuna (fără
--   owner); alt modul = un cont cu acces doar în alte module. Categoriile fără niciun cont pe țintă se raportează în NOTICE (nu se inventează).
-- Pentru fiecare identitate, pe o copie reumplută: N fișiere în documente-upa (câte unul AL FIECĂREI identități — owner / owner_id = ea, cu
--   metadate ca la o încărcare reală — plus unul fără proprietar). AȘTEPTAT (scris de mână, nu din predicate):
--     scriere: vede N, încarcă (cu și fără proprietar), șterge toate N, nu modifică;   citire: vede N, nu încarcă, nu șterge, nu modifică;
--     owner = scriere;   anonim / fără drept / alt modul: nu vede nimic, nu încarcă, nu șterge, nu modifică.
--   Modificarea și ștergerea FĂRĂ filtru (cu filtru PostgreSQL aplică și politicile SELECT și ar ascunde o politică generică).
-- LIMITE (ca la 20261225a): eșantion — primul cont din fiecare categorie, metadate fixe, căi fixe; nu înlocuiește baseline-ul revizuit și
--   proba pe clonă cu structura reală. Copia se numește `objects` (pg_temp.objects) ca expresiile calificate cu numele tabelei să se lege.
DO $sonda$
DECLARE
  v_fara constant uuid := '00000000-0000-4000-8000-00000000c0de';
  v_rau text := '';
  v_cond text := '';
  v_probate text := '';
  v_lipsa text := '';
  v_n bigint;
  v_cols text[];
  v_ids jsonb := '[]'::jsonb;
  v_inainte jsonb;
  v_dupa jsonb;
  v_k text;
  v_i integer := 0;
  v_nr integer := 0;
  v_esuate integer := 0;
  v_tot integer;
  v_st text;
  v_j jsonb;
  p record;
  x record;
  y record;
BEGIN
  IF to_regclass('pg_temp.objects') IS NOT NULL THEN
    RAISE EXCEPTION '20261229c post: SONDA_CONDITII: sesiunea are deja relatia temporara pg_temp.objects (copia sondei nu se poate crea; revizuire manuala)';
  END IF;
  BEGIN
    FOR x IN SELECT r.rol, d.drept FROM unnest(ARRAY['anon', 'authenticated']) r(rol), unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']) d(drept)
              WHERE NOT has_table_privilege(r.rol, 'storage.objects', d.drept) AND has_any_column_privilege(r.rol, 'storage.objects', d.drept) LOOP
      v_cond := v_cond || x.rol || ' are drept ' || x.drept || ' doar pe coloane (sonda nu il reproduce: revizuire manuala); ';
    END LOOP;
    CREATE TEMP TABLE pg_temp.objects (LIKE storage.objects INCLUDING GENERATED) ON COMMIT DROP;
    FOR p IN SELECT attname FROM pg_attribute WHERE attrelid = 'pg_temp.objects'::regclass AND attnum > 0 AND NOT attisdropped AND attnotnull LOOP
      EXECUTE format('ALTER TABLE pg_temp.objects ALTER COLUMN %I DROP NOT NULL', p.attname);
    END LOOP;
    SELECT array_agg(attname::text) INTO v_cols FROM pg_attribute
     WHERE attrelid = 'pg_temp.objects'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '';
    -- un fișier ca la o încărcare reală, cu drepturile APELANTULUI (SECURITY INVOKER): 'inserat' / 'refuzat' (refuzul INSERT-ului, prins aici)
    CREATE FUNCTION pg_temp.sonda_rand_20261229c(p_cols text[], p_nume text, p_uid uuid, p_meta boolean) RETURNS text
    LANGUAGE plpgsql SECURITY INVOKER AS $r$
    DECLARE v_c text[] := ARRAY['bucket_id', 'name']; v_v text[] := ARRAY[quote_literal('documente-upa'), quote_literal(p_nume)];
    BEGIN
      IF 'id' = ANY (p_cols) THEN v_c := v_c || 'id'::text; v_v := v_v || quote_literal(md5(p_nume)::uuid::text); END IF;
      IF 'owner' = ANY (p_cols) THEN v_c := v_c || 'owner'::text; v_v := v_v || quote_nullable(p_uid::text); END IF;
      IF 'owner_id' = ANY (p_cols) THEN v_c := v_c || 'owner_id'::text; v_v := v_v || quote_nullable(p_uid::text); END IF;
      IF p_meta AND 'metadata' = ANY (p_cols) THEN
        v_c := v_c || 'metadata'::text;
        v_v := v_v || quote_literal('{"eTag": "0", "size": 123456, "mimetype": "application/pdf", "cacheControl": "max-age=3600", "contentLength": 123456, "httpStatusCode": 200}');
      END IF;
      IF p_meta AND 'user_metadata' = ANY (p_cols) THEN v_c := v_c || 'user_metadata'::text; v_v := v_v || quote_literal('{}'); END IF;
      IF p_meta AND 'version' = ANY (p_cols) THEN v_c := v_c || 'version'::text; v_v := v_v || quote_literal(md5('v' || p_nume)); END IF;
      BEGIN
        EXECUTE format('INSERT INTO pg_temp.objects (%s) VALUES (%s)',
                       (SELECT string_agg(quote_ident(c), ', ') FROM unnest(v_c) c), array_to_string(v_v, ', '));
      EXCEPTION WHEN insufficient_privilege THEN
        RETURN 'refuzat';
      END;
      RETURN 'inserat';
    END $r$;
    GRANT EXECUTE ON FUNCTION pg_temp.sonda_rand_20261229c(text[], text, uuid, boolean) TO anon, authenticated;
    IF NOT has_function_privilege('anon', 'pg_temp.sonda_rand_20261229c(text[], text, uuid, boolean)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'pg_temp.sonda_rand_20261229c(text[], text, uuid, boolean)', 'EXECUTE')
       OR (SELECT fp.prosecdef FROM pg_proc fp WHERE fp.oid = 'pg_temp.sonda_rand_20261229c(text[], text, uuid, boolean)'::regprocedure) IS DISTINCT FROM false THEN
      v_cond := v_cond || 'ajutatorul sondei nu are EXECUTE pentru anon / authenticated sau nu e SECURITY INVOKER; ';
    END IF;
    ALTER TABLE pg_temp.objects ENABLE ROW LEVEL SECURITY;
    FOR x IN SELECT DISTINCT e.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) e
              WHERE c.oid = 'pg_temp.objects'::regclass AND e.grantee <> c.relowner LOOP
      EXECUTE format('REVOKE ALL ON pg_temp.objects FROM %s', CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(x.grantee)) END);
    END LOOP;
    FOR x IN SELECT r.rol, d.drept FROM unnest(ARRAY['anon', 'authenticated']) r(rol), unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) d(drept)
              WHERE has_table_privilege(r.rol, 'storage.objects', d.drept) LOOP
      EXECUTE format('GRANT %s ON pg_temp.objects TO %I', x.drept, x.rol);
    END LOOP;
    FOR x IN SELECT r.rol, d.drept FROM unnest(ARRAY['anon', 'authenticated']) r(rol), unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) d(drept)
              WHERE has_table_privilege(r.rol, 'pg_temp.objects', d.drept) IS DISTINCT FROM has_table_privilege(r.rol, 'storage.objects', d.drept) LOOP
      v_cond := v_cond || 'copia are alt drept ' || x.drept || ' pentru ' || x.rol || ' decat tabelul real; ';
    END LOOP;
    FOR p IN SELECT pol.polname, pol.polcmd, pol.polpermissive, pg_get_expr(pol.polqual, pol.polrelid) AS q, pg_get_expr(pol.polwithcheck, pol.polrelid) AS c,
                    (SELECT string_agg(CASE WHEN r.oid = 0 THEN 'public' ELSE quote_ident(pg_get_userbyid(r.oid)) END, ', ')
                       FROM unnest(pol.polroles) r(oid)) AS roluri
               FROM pg_policy pol WHERE pol.polrelid = 'storage.objects'::regclass ORDER BY pol.polname LOOP
      v_nr := v_nr + 1;
      BEGIN
        EXECUTE format('CREATE POLICY %I ON pg_temp.objects AS %s FOR %s TO %s%s%s', 'sonda_' || v_nr,
          CASE WHEN p.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
          p.roluri, CASE WHEN p.q IS NULL THEN '' ELSE ' USING (' || p.q || ')' END, CASE WHEN p.c IS NULL THEN '' ELSE ' WITH CHECK (' || p.c || ')' END);
      EXCEPTION WHEN OTHERS THEN
        v_esuate := v_esuate + 1;
        v_cond := v_cond || 'politica ' || quote_ident(p.polname) || ' nu s-a putut recrea pe copie (' || SQLSTATE || ': ' || SQLERRM || '); ';
      END;
    END LOOP;
    IF v_nr <> (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass)
       OR v_nr - v_esuate <> (SELECT count(*) FROM pg_policy WHERE polrelid = 'pg_temp.objects'::regclass) THEN
      RAISE EXCEPTION '20261229c post: sonda storage: politicile nu s-au copiat toate';
    END IF;
    -- identitățile (doar citite) cu clasa AȘTEPTATĂ: s = scriere, c = citire, n = nimic
    v_ids := jsonb_build_array(jsonb_build_object('e', 'anonim', 'rol', 'anon', 'uid', NULL, 'cls', 'n'),
                               jsonb_build_object('e', 'cont fara drept', 'rol', 'authenticated', 'uid', v_fara, 'cls', 'n'));
    FOR x IN
      SELECT 'owner' AS e, 's' AS cls, (SELECT pr.id FROM public.profiles pr WHERE pr.is_owner IS TRUE ORDER BY pr.id LIMIT 1) AS uid
      UNION ALL
      SELECT 'scriere ' || m.m || ' ' || n.n, 's', (SELECT u.profile_id FROM public.user_module_access u
                 WHERE u.module = m.m AND u.access_level = n.n
                   AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = u.profile_id AND pr.is_owner IS TRUE)
                 ORDER BY u.profile_id LIMIT 1)
        FROM (VALUES ('administrativ'), ('administrativ.upa')) m(m), (VALUES ('admin'), ('editor')) n(n)
      UNION ALL
      SELECT 'citire ' || m.m, 'c', (SELECT u.profile_id FROM public.user_module_access u
                 WHERE u.module = m.m AND u.access_level = 'viewer'
                   AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = u.profile_id AND pr.is_owner IS TRUE)
                   AND NOT EXISTS (SELECT 1 FROM public.user_module_access w WHERE w.profile_id = u.profile_id
                                    AND w.module IN ('administrativ', 'administrativ.upa') AND w.access_level IN ('admin', 'editor'))
                 ORDER BY u.profile_id LIMIT 1)
        FROM (VALUES ('administrativ'), ('administrativ.upa')) m(m)
      UNION ALL
      SELECT 'alt modul', 'n', (SELECT u.profile_id FROM public.user_module_access u
                 WHERE NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = u.profile_id AND pr.is_owner IS TRUE)
                   AND NOT EXISTS (SELECT 1 FROM public.user_module_access w WHERE w.profile_id = u.profile_id AND w.module IN ('administrativ', 'administrativ.upa'))
                 ORDER BY u.profile_id LIMIT 1)
    LOOP
      IF x.uid IS NOT NULL THEN
        v_ids := v_ids || jsonb_build_array(jsonb_build_object('e', x.e, 'rol', 'authenticated', 'uid', x.uid, 'cls', x.cls));
      ELSE
        v_lipsa := v_lipsa || x.e || '; ';
      END IF;
    END LOOP;
    v_tot := jsonb_array_length(v_ids) + 1;
    FOR x IN SELECT o.v ->> 'e' AS e, o.v ->> 'rol' AS rol, (o.v ->> 'uid')::uuid AS uid, o.v ->> 'cls' AS cls FROM jsonb_array_elements(v_ids) o(v) LOOP
      v_probate := v_probate || x.e || '; ';
      -- copia reumplută ca postgres (proprietarul copiei: RLS nu i se aplică): un fișier al fiecărei identități + unul fără proprietar
      RESET ROLE;
      DELETE FROM pg_temp.objects;
      FOR y IN SELECT (o.v ->> 'uid')::uuid AS uid, o.ord FROM jsonb_array_elements(v_ids) WITH ORDINALITY o(v, ord) LOOP
        IF pg_temp.sonda_rand_20261229c(v_cols, format('manual/2031-01/proba-%s-%s.pdf', y.ord, md5(x.e)), y.uid, true) IS DISTINCT FROM 'inserat' THEN
          v_cond := v_cond || 'fisierul de proba nu s-a putut scrie ca postgres; ';
        END IF;
      END LOOP;
      IF pg_temp.sonda_rand_20261229c(v_cols, format('manual/2031-01/proba-0-%s.pdf', md5(x.e)), NULL, true) IS DISTINCT FROM 'inserat' THEN
        v_cond := v_cond || 'fisierul fara proprietar nu s-a putut scrie ca postgres; ';
      END IF;
      PERFORM set_config('request.jwt.claim.sub', coalesce(x.uid::text, ''), true);
      PERFORM set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', x.uid, 'role', x.rol))::text, true);
      -- (1) citirea
      v_n := 0;
      IF x.rol = 'authenticated' THEN SET LOCAL ROLE authenticated; ELSE SET LOCAL ROLE anon; END IF;
      BEGIN
        SELECT count(*) INTO v_n FROM pg_temp.objects WHERE bucket_id = 'documente-upa';
      EXCEPTION WHEN insufficient_privilege THEN v_n := 0;
      END;
      RESET ROLE;
      -- (parantezele: condiția unui IF plpgsql se termină la primul THEN, inclusiv cel dintr-un CASE neîncadrat)
      IF v_n <> (CASE WHEN x.cls IN ('s', 'c') THEN v_tot ELSE 0 END) THEN
        v_rau := v_rau || x.e || ' vede ' || v_n || ' din ' || v_tot || '; ';
      END IF;
      -- (2) modificarea fără filtru: nimeni
      SELECT coalesce(jsonb_object_agg(name, ctid::text), '{}'::jsonb) INTO v_inainte FROM pg_temp.objects;
      IF x.rol = 'authenticated' THEN SET LOCAL ROLE authenticated; ELSE SET LOCAL ROLE anon; END IF;
      BEGIN
        UPDATE pg_temp.objects SET owner = x.uid;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
      RESET ROLE;
      SELECT coalesce(jsonb_object_agg(name, ctid::text), '{}'::jsonb) INTO v_dupa FROM pg_temp.objects;
      IF EXISTS (SELECT 1 FROM jsonb_each_text(v_inainte) a WHERE v_dupa ? a.key AND v_dupa ->> a.key IS DISTINCT FROM a.value) THEN
        v_rau := v_rau || x.e || ' modifica; ';
      END IF;
      -- (3) ștergerea fără filtru: scrierea șterge toate, restul niciunul
      SELECT coalesce(jsonb_object_agg(name, ctid::text), '{}'::jsonb) INTO v_inainte FROM pg_temp.objects;
      IF x.rol = 'authenticated' THEN SET LOCAL ROLE authenticated; ELSE SET LOCAL ROLE anon; END IF;
      BEGIN
        DELETE FROM pg_temp.objects;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
      RESET ROLE;
      SELECT coalesce(jsonb_object_agg(name, ctid::text), '{}'::jsonb) INTO v_dupa FROM pg_temp.objects;
      v_n := (SELECT count(*) FROM jsonb_object_keys(v_inainte) k WHERE NOT v_dupa ? k);
      IF v_n <> (CASE WHEN x.cls = 's' THEN v_tot ELSE 0 END) THEN
        v_rau := v_rau || x.e || ' sterge ' || v_n || ' din ' || v_tot || '; ';
      END IF;
      -- (4) încărcarea, cu și fără proprietar: doar scrierea
      FOREACH v_k IN ARRAY ARRAY['proprietar', 'fara proprietar'] LOOP
        v_i := v_i + 1;
        v_st := NULL;
        IF x.rol = 'authenticated' THEN SET LOCAL ROLE authenticated; ELSE SET LOCAL ROLE anon; END IF;
        BEGIN
          v_st := pg_temp.sonda_rand_20261229c(v_cols, format('manual/2031-01/nou-%s.pdf', v_i), CASE WHEN v_k = 'proprietar' THEN x.uid END, v_k = 'proprietar');
        EXCEPTION WHEN insufficient_privilege THEN
          v_cond := v_cond || x.e || ': apelul ajutatorului sondei refuzat (' || SQLERRM || '); ';
        END;
        RESET ROLE;
        IF (v_st = 'inserat') IS DISTINCT FROM (x.cls = 's') AND v_st IS NOT NULL THEN
          v_rau := v_rau || x.e || CASE WHEN v_st = 'inserat' THEN ' incarca (' ELSE ' NU incarca (' END || v_k || '); ';
        END IF;
      END LOOP;
    END LOOP;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'sonda:' || jsonb_build_object('p', v_probate, 'r', v_rau, 'c', v_cond, 'l', v_lipsa)::text;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    v_j := substr(SQLERRM, length('sonda:') + 1)::jsonb;
    v_probate := v_j ->> 'p'; v_rau := v_j ->> 'r'; v_cond := v_j ->> 'c'; v_lipsa := v_j ->> 'l';
  END;
  IF current_user IS DISTINCT FROM 'postgres' OR to_regclass('pg_temp.objects') IS NOT NULL
     OR to_regprocedure('pg_temp.sonda_rand_20261229c(text[], text, uuid, boolean)') IS NOT NULL
     OR v_probate IS NULL OR v_rau IS NULL OR v_cond IS NULL OR v_lipsa IS NULL THEN
    RAISE EXCEPTION '20261229c post: sonda storage nu s-a anulat';
  END IF;
  IF v_cond <> '' THEN
    RAISE EXCEPTION '20261229c post: SONDA_CONDITII: sonda politicilor de pe storage.objects nu a putut proba corect (NU e un refuz RLS; revizuire manuala): %', v_cond;
  END IF;
  IF v_rau <> '' THEN
    RAISE EXCEPTION '20261229c post: politicile EFECTIVE de pe storage.objects nu dau pe documente-upa drepturile declarate: %', v_rau;
  END IF;
  RAISE NOTICE '20261229c: sonda storage: identitati probate: %; categorii fara cont pe tinta: %', v_probate, coalesce(nullif(v_lipsa, ''), 'niciuna');
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261229c_administrativ_upa_bucket:' || txid_current() THEN
    RAISE EXCEPTION '20261229c: garda final invalida';
  END IF;
  RAISE NOTICE '20261229c: sfarsit la % ms de la BEGIN; lock-ul pe storage.objects tinut de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $sonda$;
