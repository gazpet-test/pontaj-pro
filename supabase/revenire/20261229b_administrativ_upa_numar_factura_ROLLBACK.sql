-- Revenire 20261229b_administrativ_upa_numar_factura. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Scoate garda numărului facturii de pe upa_achizitii: triggerul trg_upa_achizitii_numar_factura, CHECK-ul upa_achizitii_numar_factura_nevid și
--   funcțiile fn_upa_numar_factura_obligatoriu / fn_upa_numar_factura_ok. Nicio dată nu se pierde (rândurile rămân cum sunt; după revenire
--   numărul redevine opțional pe toate căile).
-- REFUZĂ (nimic schimbat) dacă amprenta COMPLETĂ a obiectelor migrării (CHECK-ul cu starea validării, triggerul, funcțiile cu sursa / drepturile /
--   proprietarul, ORICE obiect dependent de funcțiile noi — blocul AMPRENTA, identic cu cel din postcondițiile migrării) diferă de constanta
--   revizuită. Lock-ul se ia ÎNAINTEA verificărilor (L14). O dependență normală nouă pe funcții (de ex. o politică) face oricum DROP-ul să pice.
-- Ordinea revenirilor: 20261229c -> 20261229b -> 20261229a (b e independentă de a, dar se retrage înaintea ei).
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261229b_administrativ_upa_numar_factura_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261229120101 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock (NOWAIT): upa_achizitii ACCESS EXCLUSIVE. Probe: scripts/pglite/test_upa_alerta_local.mjs.
DO $pre$
DECLARE v_plafon text; v_amp text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261229b_administrativ_upa_numar_factura_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261229b revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261229b revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261229b revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261229b revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261229b revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.upa_achizitii') IS NULL OR to_regprocedure('public.fn_upa_numar_factura_ok(text)') IS NULL
     OR to_regprocedure('public.fn_upa_numar_factura_obligatoriu()') IS NULL THEN
    RAISE EXCEPTION '20261229b revenire: starea nu e cea din 20261229b (functiile migrarii lipsesc)';
  END IF;
  -- lock-ul ÎNAINTEA verificărilor (L14), NOWAIT
  LOCK TABLE public.upa_achizitii IN ACCESS EXCLUSIVE MODE NOWAIT;
  -- AMPRENTA_20261229b_INCEPUT
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'con ' || k.conname || ' ' || k.contype::text || ' val=' || k.convalidated || ' ' || pg_get_constraintdef(k.oid) AS l
      FROM pg_constraint k WHERE k.conrelid = 'public.upa_achizitii'::regclass AND k.conname = 'upa_achizitii_numar_factura_nevid'
    UNION ALL
    SELECT 'trg ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t WHERE t.tgrelid = 'public.upa_achizitii'::regclass AND NOT t.tgisinternal AND t.tgname = 'trg_upa_achizitii_numar_factura'
    UNION ALL
    -- orice obiect care depinde de funcțiile noi (în afara CHECK-ului și a triggerului de mai sus = altă politică / vedere / trigger: abatere)
    SELECT 'dep ' || pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> ' || p.proname || ' ' || d.deptype::text
      FROM pg_depend d JOIN pg_proc p ON p.oid = d.refobjid
     WHERE d.refclassid = 'pg_proc'::regclass AND p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_upa_numar_factura_ok', 'fn_upa_numar_factura_obligatoriu')
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_upa_numar_factura_ok', 'fn_upa_numar_factura_obligatoriu')
  ) x;
  -- AMPRENTA_20261229b_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM '96b7109570727ea2d0377aa1b02a6418' THEN
    RAISE NOTICE 'AMPRENTA_20261229b_TEXT %', v_amp;
    RAISE EXCEPTION '20261229b revenire: AMPRENTA obiectelor migrarii % (asteptat 96b7109570727ea2d0377aa1b02a6418): starea nu e cea din 20261229b; nimic schimbat',
      md5(coalesce(v_amp, ''));
  END IF;
END $pre$;

DROP TRIGGER trg_upa_achizitii_numar_factura ON public.upa_achizitii;
ALTER TABLE public.upa_achizitii DROP CONSTRAINT upa_achizitii_numar_factura_nevid;
DROP FUNCTION public.fn_upa_numar_factura_obligatoriu();
DROP FUNCTION public.fn_upa_numar_factura_ok(text);

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_upa_numar_factura_ok', 'fn_upa_numar_factura_obligatoriu'))
     OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.upa_achizitii'::regclass AND k.conname = 'upa_achizitii_numar_factura_nevid')
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.upa_achizitii'::regclass AND t.tgname = 'trg_upa_achizitii_numar_factura') THEN
    RAISE EXCEPTION '20261229b revenire: postconditie: obiectele migrarii au ramas';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261229b_administrativ_upa_numar_factura_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261229b revenire: garda final invalida';
  END IF;
END $post$;
