-- Revenire 20270105b_executie_proiect_configurare. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Scoate poarta „în configurare”: RPC-ul fn_executie_proiect_configurare_completa, garda fn_executie_proiect_configurare_garda cu cele două trigger-e,
--   jurnalul executie_proiect_configurare_jurnal. Coloanele configurare_* rămân (sunt ale 20270105a; revenirea ei vine după aceasta).
-- REFUZĂ (nimic schimbat) dacă există proiecte cu configurarea declarată sau rânduri în jurnal (L14: date scrise de calea nouă; decizie separată),
--   dacă amprenta COMPLETĂ a obiectelor migrării (blocul AMPRENTA, identic cu cel din postcondițiile migrării) diferă de constanta revizuită, sau
--   dacă alte obiecte depind de cele scoase. Lock-ul se ia ÎNAINTEA verificărilor, NOWAIT. Porțile Izometrie: ritualul PRE / ștampile / POST.
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20270105b_executie_proiect_configurare_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20270105130001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock (NOWAIT): executie_proiecte, executie_proiect_configurare_jurnal — ACCESS EXCLUSIVE. Probe: scripts/pglite/test_executie_rest_decontat_local.mjs.
DO $pre$
DECLARE v_plafon text; v_amp text; v_n bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270105b_executie_proiect_configurare_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270105b revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270105b revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270105b revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270105b revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270105b revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.executie_proiect_configurare_jurnal') IS NULL
     OR to_regprocedure('public.fn_executie_proiect_configurare_completa(bigint, text)') IS NULL
     OR to_regprocedure('public.fn_executie_proiect_configurare_garda()') IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_executie\_proiect\_configurare\_%') <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid = 'public.executie_proiecte'::regclass AND t.tgname = 'trg_rest_decontat_configurare_garda')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = 'trg_rest_decontat_configurare_jurnal_garda') THEN
    RAISE EXCEPTION '20270105b revenire: starea nu e cea din 20270105b (obiectele migrarii lipsesc sau difera)';
  END IF;
  IF to_regprocedure('public.fn_izo_porti_lipsa()') IS NULL OR to_regprocedure('public.fn_izo_porti_definitii()') IS NULL
     OR to_regprocedure('public.fn_izo_porti_e3_definitii()') IS NULL OR to_regprocedure('public.fn_izo_porti_e3b_definitii()') IS NULL
     OR to_regprocedure('public.fn_izo_porti_e4_definitii()') IS NULL OR to_regprocedure('public.fn_izo_porti_e4b_definitii()') IS NULL THEN
    RAISE EXCEPTION '20270105b revenire: portile Izometrie (20261230a) lipsesc';
  END IF;
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270105b revenire: portile Izometrie nu sunt verzi inainte: %', public.fn_izo_porti_lipsa();
  END IF;
  -- nimic altceva nu depinde de obiectele scoase
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = 'public.executie_proiect_configurare_jurnal'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE NOT (schemaname = 'public' AND tablename = 'executie_proiect_configurare_jurnal')
                 AND coalesce(qual, '') || coalesce(with_check, '') ~ 'fn_executie_proiect_configurare_')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                   AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_proiect\_configurare\_%')
                   AND p.prosrc ~ '\m(fn_executie_proiect_configurare_[a-z_]+|executie_proiect_configurare_jurnal)\M') THEN
    RAISE EXCEPTION '20270105b revenire: alte obiecte (vederi / politici / functii) depind de obiectele migrarii';
  END IF;
  LOCK TABLE public.executie_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.executie_proiect_configurare_jurnal IN ACCESS EXCLUSIVE MODE NOWAIT;
  SELECT count(*) INTO v_n FROM public.executie_proiecte e WHERE e.configurare_completa_la IS NOT NULL OR e.configurare_exceptie_motiv IS NOT NULL;
  IF v_n > 0 THEN RAISE EXCEPTION '20270105b revenire: % proiecte configurate (configurare_completa_la) — decizie separata inainte; nimic schimbat', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.executie_proiect_configurare_jurnal;
  IF v_n > 0 THEN RAISE EXCEPTION '20270105b revenire: % randuri in jurnal (executie_proiect_configurare_jurnal) — decizie separata inainte; nimic schimbat', v_n; END IF;
  -- AMPRENTA_20270105b_INCEPUT (blocul e IDENTIC în migrare și în revenire; proba PGlite compară textul)
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'col ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
           || ' id=' || a.attidentity::text || ' gen=' || a.attgenerated::text || ' acl=' || coalesce(a.attacl::text, '-') AS l
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.executie_proiect_configurare_jurnal'::regclass AND NOT a.attisdropped AND a.attnum > 0
    UNION ALL
    SELECT 'tab rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity || ' acl=' || coalesce(c.relacl::text, '-') || ' own=' || pg_get_userbyid(c.relowner)
      FROM pg_class c WHERE c.oid = 'public.executie_proiect_configurare_jurnal'::regclass
    UNION ALL
    SELECT 'con ' || k.conname || ' ' || k.contype::text || ' val=' || k.convalidated || ' defer=' || k.condeferrable || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k WHERE k.conrelid = 'public.executie_proiect_configurare_jurnal'::regclass AND k.contype <> 'n'
    UNION ALL
    SELECT 'idx ' || pg_get_indexdef(i.indexrelid) || ' valid=' || i.indisvalid FROM pg_index i WHERE i.indrelid = 'public.executie_proiect_configurare_jurnal'::regclass
    UNION ALL
    SELECT 'trg ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('trg_rest_decontat_configurare_garda', 'trg_rest_decontat_configurare_jurnal_garda')
    UNION ALL
    SELECT 'pol ' || p.polname || ' ' || p.polcmd::text || ' perm=' || p.polpermissive
           || ' roles=' || coalesce((SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r), 'PUBLIC')
           || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')
      FROM pg_policy p WHERE p.polrelid = 'public.executie_proiect_configurare_jurnal'::regclass
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_executie\_proiect\_configurare\_%'
  ) x;
  -- AMPRENTA_20270105b_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM 'e0fb8d9d973c83507fd28c73f8777364' THEN
    RAISE NOTICE 'AMPRENTA_20270105b_TEXT %', v_amp;
    RAISE EXCEPTION '20270105b revenire: AMPRENTA obiectelor migrarii % (asteptat e0fb8d9d973c83507fd28c73f8777364): starea nu e cea din 20270105b; nimic schimbat',
      md5(coalesce(v_amp, ''));
  END IF;
END $pre$;

DROP TRIGGER trg_rest_decontat_configurare_garda ON public.executie_proiecte;
DROP TABLE public.executie_proiect_configurare_jurnal;   -- cu trigger-ul și politica lui
DROP FUNCTION public.fn_executie_proiect_configurare_completa(bigint, text);
DROP FUNCTION public.fn_executie_proiect_configurare_garda();

DO $post$
BEGIN
  IF to_regclass('public.executie_proiect_configurare_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_executie\_proiect\_configurare\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('trg_rest_decontat_configurare_garda', 'trg_rest_decontat_configurare_jurnal_garda')) THEN
    RAISE EXCEPTION '20270105b revenire post: au ramas obiecte';
  END IF;
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L', 'porti_e3=' || public.fn_izo_porti_e3_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L', 'porti_e3b=' || public.fn_izo_porti_e3b_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS %L', 'porti_e4=' || public.fn_izo_porti_e4_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS %L', 'porti_e4b=' || public.fn_izo_porti_e4b_definitii());
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270105b revenire post: portile Izometrie nu sunt verzi dupa: %', public.fn_izo_porti_lipsa();
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270105b_executie_proiect_configurare_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270105b revenire: garda final invalida';
  END IF;
END $post$;
