-- Version 20270113120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270113a_ofertare_clarificari_citire.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al
--   runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA). Manifestul .l15.tsv îl generează coordonatorul pe clonă
--   (scripts/livrare_l15_manifest.sh --iesire, docs/LIVRARE_L15_V2.md §5); lista OBIECTELOR revizuită (generată pe PGlite cu pașii reali ai
--   runnerului): supabase/tests/20270113a_ofertare_clarificari_citire.l15.obiecte.tsv. Dry-run pe clonă după aplicare (ROLLBACK):
--   supabase/tests/20270113a_ofertare_clarificari_citire_dryrun.sql.
-- 20270113a_ofertare_clarificari_citire — Ofertare: citirea clarificărilor DOAR pentru cine are acces la modulul Ofertare (decizia owner-ului,
--   26.11.2026). Azi politica SELECT clar_all_sel pe public.ofertare_clarificari e USING (auth.uid() IS NOT NULL): ORICE cont logat citește
--   clarificările, direct și prin vederea v_ofertare_clarificari_baza (security_invoker = on). Politicile de scriere (clar_all_ins / _upd / _del)
--   cer deja (SELECT public.fn_are_acces_ofertare()).
-- Ce face (UN singur lucru):
--   ALTER POLICY clar_all_sel ON public.ofertare_clarificari USING (auth.uid() IS NOT NULL AND (SELECT public.fn_are_acces_ofertare()))
--   — forma (SELECT …) ca la celelalte politici ale tabelului (20260928p). fn_are_acces_ofertare() (20260912, SECURITY DEFINER, fără parametru):
--   owner sau rând în user_module_access cu module = 'ofertare' (cheia EXACTĂ a modulului; sub-modulele ofertare_* nu dau acces, L09).
--   Vederea v_ofertare_clarificari_baza moștenește regula prin security_invoker (nu se atinge).
-- Ce NU face: nu creează / nu șterge obiecte, nu schimbă drepturile (GRANT) tabelului sau vederii, nu atinge celelalte politici, triggerele,
--   vederea, funcția fn_are_acces_ofertare, nicio dată; nu dă acces la Ofertare nimănui. RPC-urile SECURITY DEFINER care citesc clarificările
--   își păstrează porțile proprii (neatinse). Datele existente: nicio verificare pe rânduri (nimic rescris); se tipărește doar numărul lor.
-- Starea de pornire (L14, sub lock): politicile tabelului sunt EXACT cele 4 de azi (nume, comandă, PERMISSIVE, rolul authenticated, USING /
--   WITH CHECK deparsate), RLS activ și neforțat, vederea există cu security_invoker = on și depinde de tabel, fn_are_acces_ofertare are
--   corpul / DEFINER / calea / proprietarul / drepturile din 20260912; altceva = refuz, nimic schimbat. Reaplicare = refuz (politica deja restrânsă).
-- Lock-uri (L06): un singur tabel, ACCESS EXCLUSIVE NOWAIT pe public.ofertare_clarificari (ALTER POLICY cere acest lock), luat ÎNAINTEA
--   verificărilor de stare (L14), bugetul 1 s de la prima încercare (blocul $lock$); ocupat = 55P03, nimic schimbat. Nimic altceva blocat.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), bugetul de lock 1 s, lock_timeout 100 ms
--   (lock-urile implicite), garda finală a runnerului (PLAFON_TIMP + LOCK_TINUT).
-- Ordinea livrării: doar această migrare (fără edge, fără UI: tot codul care citește clarificările e în modulul Ofertare, deja sub acces Ofertare).
--   Independentă de 20270112a (NEAPLICATĂ): merge înainte sau după ea (proba PGlite rulează ambele ordini).
-- Revenire: supabase/revenire/20270113a_ofertare_clarificari_citire_ROLLBACK.sql (readuce USING (auth.uid() IS NOT NULL) EXACT; refuză dacă starea
--   nu e cea pusă aici). Revenirea REDESCHIDE citirea pentru orice cont logat: doar la cererea explicită a owner-ului.
-- Probe: scripts/pglite/test_ofertare_clarificari_citire_local.mjs (scheletul 20270112a, pașii L15 v2 reali; cazuri de acces, refuzuri, revenire,
--   ambele ordini față de 20270112a, mutanți).
DO $pre$
DECLARE v_plafon text; v_alt text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270113a_ofertare_clarificari_citire:' || txid_current() THEN
    RAISE EXCEPTION '20270113a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270113a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270113a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270113a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20270113a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20270111a / 20270112a)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270113a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.ofertare_clarificari') IS NULL OR (SELECT relkind FROM pg_class WHERE oid = 'public.ofertare_clarificari'::regclass) <> 'r' THEN
    RAISE EXCEPTION '20270113a: lipseste tabelul public.ofertare_clarificari';
  END IF;
  -- reaplicare: politica SELECT e deja restransa (orice forma care cheama fn_are_acces_ofertare)
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass AND p.polname = 'clar_all_sel'
               AND pg_get_expr(p.polqual, p.polrelid) LIKE '%fn_are_acces_ofertare%') THEN
    RAISE EXCEPTION '20270113a: politica clar_all_sel e deja restransa la accesul Ofertare (reaplicare)';
  END IF;
  -- dependenta: fn_are_acces_ofertare() din 20260912, neschimbata (corp fara CR, limbaj sql, DEFINER, STABLE, cale sigura, proprietar postgres,
  --   drepturi EXACTE: authenticated + service_role + proprietar, nimic pentru anon / PUBLIC); politica o va chema ca rolul authenticated
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()')
                   AND md5(replace(p.prosrc, chr(13), '')) = '429d28e2a61fb24c8009d67050c16c85' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_are_acces_ofertare') <> 1 THEN
    RAISE EXCEPTION '20270113a: fn_are_acces_ofertare() nu e cea din 20260912 (corp md5 429d28e2a61fb24c8009d67050c16c85, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari); coordonatorul da textul exact (pg_get_functiondef)';
  END IF;
  -- vederea care mosteneste regula: exista, e vedere, security_invoker = on, depinde de tabel (altfel restrangerea n-ar ajunge la ea)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.v_ofertare_clarificari_baza') AND c.relkind = 'v'
                   AND 'security_invoker=on' = ANY (c.reloptions))
     OR NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
                      WHERE rw.ev_class = to_regclass('public.v_ofertare_clarificari_baza') AND d.refclassid = 'pg_class'::regclass
                        AND d.refobjid = 'public.ofertare_clarificari'::regclass) THEN
    RAISE EXCEPTION '20270113a: v_ofertare_clarificari_baza lipseste, nu e vedere security_invoker = on sau nu citeste ofertare_clarificari';
  END IF;
  -- informativ (nu refuz, in afara perimetrului): alte vederi peste tabel FARA security_invoker ar citi ca proprietarul lor, ocolind politica
  SELECT string_agg(DISTINCT v.oid::regclass::text, ', ' ORDER BY v.oid::regclass::text) INTO v_alt
    FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
    JOIN pg_class v ON v.oid = rw.ev_class AND v.relkind IN ('v', 'm')
   WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.ofertare_clarificari'::regclass
     AND v.oid <> 'public.ofertare_clarificari'::regclass
     AND NOT ('security_invoker=on' = ANY (coalesce(v.reloptions, ARRAY[]::text[])));
  IF v_alt IS NOT NULL THEN
    RAISE NOTICE '20270113a: ATENTIE, vederi peste ofertare_clarificari fara security_invoker (citesc ca proprietarul, in afara acestei migrari): %', v_alt;
  END IF;
END $pre$;

-- ─── 0. Lock-ul, ÎNAINTEA verificărilor de stare (L14): punct unic, NOWAIT, bugetul 1 s de la PRIMA încercare (șablonul 20270111a);
--     momentul în gazpet.lock_puternic_la pentru LOCK_TINUT. Ocupat peste buget = 55P03, nimic schimbat. ────────────────────────────
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20270113a: BUGET_LOCK: ofertare_clarificari ocupat; % incercari, % ms de la prima incercare (bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.ofertare_clarificari IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20270113a: BUGET_LOCK: lock-ul pe ofertare_clarificari obtinut abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20270113a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. Starea EXACTĂ de azi (sub lock): cele 4 politici (pg_policies, citite pe producție 26.11.2026), RLS activ neforțat; fotografia a tot
--     ce NU se schimbă (drepturile tabelului și ale vederii, definiția și opțiunile vederii, triggerele, funcția) pentru postcondiție ─────
DO $stare$
DECLARE v_rau text; v_n bigint;
BEGIN
  -- forma deparsata a politicilor (pg_get_expr): numele, comanda, PERMISSIVE, rolurile, USING, WITH CHECK — lista completa; orice diferenta = refuz
  SELECT string_agg(coalesce(a.nume, '+' || c.nume) || coalesce(': ' || c.detaliu, ''), '; ' ORDER BY coalesce(a.nume, c.nume)) INTO v_rau
    FROM (VALUES
      -- >>> POLITICI 26.11.2026
      ('clar_all_sel', 'r|permisiva|{authenticated}|(auth.uid() IS NOT NULL)|-'),
      ('clar_all_ins', 'a|permisiva|{authenticated}|-|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)'),
      ('clar_all_upd', 'w|permisiva|{authenticated}|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)'),
      ('clar_all_del', 'd|permisiva|{authenticated}|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)|-')
      -- <<< POLITICI 26.11.2026
    ) a(nume, detaliu)
    FULL JOIN (SELECT p.polname::text AS nume,
                      p.polcmd::text || '|' || CASE WHEN p.polpermissive THEN 'permisiva' ELSE 'restrictiva' END || '|'
                        || coalesce((SELECT '{' || string_agg(CASE WHEN ro = 0 THEN 'PUBLIC' ELSE ro::regrole::text END, ',' ORDER BY ro::regrole::text) || '}' FROM unnest(p.polroles) ro), '{}')
                        || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') AS detaliu
                 FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass) c ON c.nume = a.nume
   WHERE a.nume IS NULL OR c.nume IS NULL OR a.detaliu IS DISTINCT FROM c.detaliu;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270113a: politicile ofertare_clarificari difera de cele de azi (26.11.2026): %', v_rau; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION '20270113a: RLS pe ofertare_clarificari nu e activ (sau e fortat)';
  END IF;
  -- fotografia a ceea ce NU se schimba (comparata in $post$): drepturile tabelului si ale vederii (rol:drept, cu grantor), definitia si optiunile
  -- vederii, triggerele tabelului (nume + definitie), functia (corp + drepturi), numarul politicilor
  CREATE TEMP TABLE cc_foto ON COMMIT DROP AS
    SELECT 'acl_tabel' AS ce, coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari'::regclass) a), '(nimic)') AS val
    UNION ALL
    SELECT 'acl_vedere', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.v_ofertare_clarificari_baza'::regclass) a), '(nimic)')
    UNION ALL
    SELECT 'vedere', md5(pg_get_viewdef('public.v_ofertare_clarificari_baza'::regclass)) || '|' || coalesce((SELECT array_to_string(c.reloptions, ',') FROM pg_class c WHERE c.oid = 'public.v_ofertare_clarificari_baza'::regclass), '-')
    UNION ALL
    SELECT 'triggere', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                   FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tg.tgisinternal), '(niciunul)')
    UNION ALL
    SELECT 'functie', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                         FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()'))
    UNION ALL
    SELECT 'rls', (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari'::regclass)
    UNION ALL
    SELECT 'politici_nr', (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass);
  SELECT count(*) INTO v_n FROM public.ofertare_clarificari;
  RAISE NOTICE '20270113a: stare verificata (4 politici, RLS activ); clarificari existente (neatinse): %', v_n;
END $stare$;

-- ─── 2. Schimbarea: citirea doar cu acces Ofertare (forma (SELECT …) ca la clar_all_ins / _upd / _del) ─────────────────────────────────
ALTER POLICY clar_all_sel ON public.ofertare_clarificari USING (auth.uid() IS NOT NULL AND (SELECT public.fn_are_acces_ofertare()));

-- ─── 3. Postcondiții (exacte): cele 4 politici (SELECT cu USING-ul nou, celelalte neschimbate), RLS, tot ce era în fotografie identic ──
DO $post$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(coalesce(a.nume, '+' || c.nume) || coalesce(': ' || c.detaliu, ''), '; ' ORDER BY coalesce(a.nume, c.nume)) INTO v_rau
    FROM (VALUES
      -- >>> POLITICI 20270113a
      ('clar_all_sel', 'r|permisiva|{authenticated}|((auth.uid() IS NOT NULL) AND ( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare))|-'),
      ('clar_all_ins', 'a|permisiva|{authenticated}|-|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)'),
      ('clar_all_upd', 'w|permisiva|{authenticated}|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)'),
      ('clar_all_del', 'd|permisiva|{authenticated}|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)|-')
      -- <<< POLITICI 20270113a
    ) a(nume, detaliu)
    FULL JOIN (SELECT p.polname::text AS nume,
                      p.polcmd::text || '|' || CASE WHEN p.polpermissive THEN 'permisiva' ELSE 'restrictiva' END || '|'
                        || coalesce((SELECT '{' || string_agg(CASE WHEN ro = 0 THEN 'PUBLIC' ELSE ro::regrole::text END, ',' ORDER BY ro::regrole::text) || '}' FROM unnest(p.polroles) ro), '{}')
                        || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') AS detaliu
                 FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass) c ON c.nume = a.nume
   WHERE a.nume IS NULL OR c.nume IS NULL OR a.detaliu IS DISTINCT FROM c.detaliu;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270113a: postconditie: politicile ofertare_clarificari: %', v_rau; END IF;
  -- fotografia: nimic altceva schimbat (drepturi, vedere, triggere, functie, RLS, numarul politicilor)
  SELECT string_agg(f.ce || ' (era ' || f.val || ', acum ' || coalesce(n.val, 'LIPSA') || ')', '; ' ORDER BY f.ce) INTO v_rau
    FROM cc_foto f
    LEFT JOIN (
      SELECT 'acl_tabel' AS ce, coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                       || '/' || pg_get_userbyid(e.grantor) AS d
                  FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari'::regclass) a), '(nimic)') AS val
      UNION ALL
      SELECT 'acl_vedere', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                       || '/' || pg_get_userbyid(e.grantor) AS d
                  FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.v_ofertare_clarificari_baza'::regclass) a), '(nimic)')
      UNION ALL
      SELECT 'vedere', md5(pg_get_viewdef('public.v_ofertare_clarificari_baza'::regclass)) || '|' || coalesce((SELECT array_to_string(c.reloptions, ',') FROM pg_class c WHERE c.oid = 'public.v_ofertare_clarificari_baza'::regclass), '-')
      UNION ALL
      SELECT 'triggere', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                     FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tg.tgisinternal), '(niciunul)')
      UNION ALL
      SELECT 'functie', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                           FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()'))
      UNION ALL
      SELECT 'rls', (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari'::regclass)
      UNION ALL
      SELECT 'politici_nr', (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass)
    ) n ON n.ce = f.ce
   WHERE n.val IS DISTINCT FROM f.val;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270113a: postconditie: s-a schimbat altceva decat politica SELECT: %', v_rau; END IF;
  IF (SELECT count(*) FROM cc_foto) <> 7 THEN RAISE EXCEPTION '20270113a: postconditie: fotografia incompleta'; END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270113a_ofertare_clarificari_citire:' || txid_current() THEN
    RAISE EXCEPTION '20270113a: garda final invalida';
  END IF;
  RAISE NOTICE '20270113a: sfarsit la % ms de la BEGIN, lock-uri puternice tinute de % ms', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
