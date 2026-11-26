-- Revenire 20270113a_ofertare_clarificari_citire. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Readuce politica SELECT clar_all_sel de pe public.ofertare_clarificari la USING (auth.uid() IS NOT NULL) — forma EXACTĂ de dinainte (20260928p):
--   ORICE cont logat citește iar clarificările (direct și prin v_ofertare_clarificari_baza). E o LĂRGIRE de drepturi: se rulează doar cu decizia
--   owner-ului, consemnată. Nimic altceva nu se atinge (celelalte 3 politici, drepturile, vederea, triggerele, funcția, datele).
-- Refuz pe date (L14): migrarea n-a scris date; nu există rânduri / istoric / configurări noi de pierdut. Starea EXACTĂ a migrării e verificată sub
--   lock: cele 4 politici (SELECT cu USING-ul din 20270113a, celelalte ca în 20260928p), RLS activ neforțat, vederea security_invoker, funcția
--   fn_are_acces_ofertare neschimbată; altă stare = refuz cu câmpul care diferă, nimic schimbat.
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20270113a_ofertare_clarificari_citire_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20270113120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock-uri: ACCESS EXCLUSIVE NOWAIT pe public.ofertare_clarificari (ocupat = 55P03 imediat, nimic schimbat), ÎNAINTEA verificărilor (L14);
--   lock_timeout 100 ms pentru cele implicite. Probe: scripts/pglite/test_ofertare_clarificari_citire_local.mjs.
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270113a_ofertare_clarificari_citire_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270113a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270113a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270113a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270113a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270113a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.ofertare_clarificari') IS NULL THEN RAISE EXCEPTION '20270113a revenire: lipseste public.ofertare_clarificari'; END IF;
END $pre$;

LOCK TABLE public.ofertare_clarificari IN ACCESS EXCLUSIVE MODE NOWAIT;

DO $stare$
DECLARE v_rau text;
BEGIN
  -- politicile, EXACT starea migrarii (aceeasi forma deparsata ca in postconditia ei)
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
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270113a revenire: starea nu e cea din 20270113a (politicile ofertare_clarificari): %', v_rau; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION '20270113a revenire: RLS pe ofertare_clarificari nu e activ (sau e fortat)';
  END IF;
  -- dependenta pe care o chema politica (neschimbata fata de 20260912) si vederea care mosteneste regula
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()')
                   AND md5(replace(p.prosrc, chr(13), '')) = '429d28e2a61fb24c8009d67050c16c85' AND l.lanname = 'sql' AND p.prosecdef AND p.provolatile = 's'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres') THEN
    RAISE EXCEPTION '20270113a revenire: fn_are_acces_ofertare() nu e cea din 20260912 (corp / DEFINER / cale / proprietar)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.v_ofertare_clarificari_baza') AND c.relkind = 'v' AND 'security_invoker=on' = ANY (c.reloptions)) THEN
    RAISE EXCEPTION '20270113a revenire: v_ofertare_clarificari_baza lipseste sau nu e security_invoker = on';
  END IF;
  -- fotografia a ceea ce NU se schimba (comparata in $post$)
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
END $stare$;

-- USING-ul EXACT de dinainte (20260928p)
ALTER POLICY clar_all_sel ON public.ofertare_clarificari USING (auth.uid() IS NOT NULL);

DO $post$
DECLARE v_rau text;
BEGIN
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
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270113a revenire post: politicile ofertare_clarificari: %', v_rau; END IF;
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
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270113a revenire post: s-a schimbat altceva decat politica SELECT: %', v_rau; END IF;
  IF (SELECT count(*) FROM cc_foto) <> 7 THEN RAISE EXCEPTION '20270113a revenire post: fotografia incompleta'; END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270113a_ofertare_clarificari_citire_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270113a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20270113a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
