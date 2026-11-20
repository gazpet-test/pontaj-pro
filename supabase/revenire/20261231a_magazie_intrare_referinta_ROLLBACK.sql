-- Revenire 20261231a_magazie_intrare_referinta. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Scoate regula „aceeași intrare nu se salvează de două ori” de pe magazie_echipamente: triggerul trg_magazie_referinta_intentie, funcția
--   fn_magazie_referinta_intentie_imuabila, constrângerea magazie_echipamente_referinta_intentie_key și coloana referinta_intentie.
-- ORDINEA: ÎNTÂI se retrage codul ecranului care trimite coloana (PR #1150), apoi revenirea; altfel ecranul nou primește refuz la „Adaugă din factură”.
-- REFUZĂ (nimic schimbat) dacă:
--   * vreun rând are referinta_intentie (L14: date scrise de calea nouă; ștergerea coloanei ar pierde cheile, iar o retrimitere după revenire n-ar
--     mai fi apărată) — numărul lor apare în mesaj; ce se face cu ele decide owner-ul, separat;
--   * amprenta COMPLETĂ a obiectelor migrării (coloana, constrângerea, indexurile pe coloană, triggerul, funcția cu sursa / drepturile / proprietarul,
--     ORICE obiect dependent de coloană sau de funcție — blocul AMPRENTA, identic cu cel din postcondițiile migrării) diferă de constanta revizuită.
--   Lock-ul se ia ÎNAINTEA verificărilor (L14), NOWAIT.
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261231a_magazie_intrare_referinta_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261231120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock (NOWAIT): magazie_echipamente ACCESS EXCLUSIVE. Probe: scripts/pglite/test_magazie_intrare_referinta_local.mjs.
DO $pre$
DECLARE v_plafon text; v_amp text; v_n bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261231a_magazie_intrare_referinta_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261231a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261231a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261231a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261231a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261231a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.magazie_echipamente') IS NULL OR to_regprocedure('public.fn_magazie_referinta_intentie_imuabila()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_echipamente'::regclass AND a.attname = 'referinta_intentie' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '20261231a revenire: starea nu e cea din 20261231a (obiectele migrarii lipsesc)';
  END IF;
  -- lock-ul ÎNAINTEA verificărilor (L14), NOWAIT
  LOCK TABLE public.magazie_echipamente IN ACCESS EXCLUSIVE MODE NOWAIT;
  -- date scrise de calea nouă = refuz (după lock: numărătoare stabilă)
  SELECT count(*) INTO v_n FROM public.magazie_echipamente e WHERE e.referinta_intentie IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION '20261231a revenire: % randuri au referinta_intentie (scrise de „Adauga din factura”); stergerea coloanei le-ar pierde cheile; nimic schimbat', v_n;
  END IF;
  -- AMPRENTA_20261231a_INCEPUT
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'col ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull || ' def=' || a.atthasdef
           || ' id=' || a.attidentity::text || ' gen=' || a.attgenerated::text || ' acl=' || coalesce(a.attacl::text, '-') AS l
      FROM pg_attribute a WHERE a.attrelid = 'public.magazie_echipamente'::regclass AND a.attname = 'referinta_intentie' AND NOT a.attisdropped
    UNION ALL
    SELECT 'con ' || k.conname || ' ' || k.contype::text || ' val=' || k.convalidated || ' defer=' || k.condeferrable || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k WHERE k.conrelid = 'public.magazie_echipamente'::regclass AND k.conname = 'magazie_echipamente_referinta_intentie_key'
    UNION ALL
    -- orice index care conține coloana nouă (al constrângerii; un index în plus = abatere)
    SELECT 'idx ' || pg_get_indexdef(i.indexrelid) || ' nnd=' || i.indnullsnotdistinct || ' valid=' || i.indisvalid
      FROM pg_index i WHERE i.indrelid = 'public.magazie_echipamente'::regclass
       AND (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'public.magazie_echipamente'::regclass AND a.attname = 'referinta_intentie') = ANY (i.indkey::int2[])
    UNION ALL
    SELECT 'trg ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t WHERE t.tgrelid = 'public.magazie_echipamente'::regclass AND NOT t.tgisinternal AND t.tgname = 'trg_magazie_referinta_intentie'
    UNION ALL
    -- orice obiect care depinde de coloana nouă sau de funcția nouă (în afara constrângerii / indexului / triggerului = vedere, politică …: abatere)
    SELECT 'dep ' || pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> ' || pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid) || ' ' || d.deptype::text
      FROM pg_depend d
     WHERE (d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.magazie_echipamente'::regclass
            AND d.refobjsubid = (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'public.magazie_echipamente'::regclass AND a.attname = 'referinta_intentie'))
        OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure('public.fn_magazie_referinta_intentie_imuabila()'))
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_magazie_referinta_intentie_imuabila'
  ) x;
  -- AMPRENTA_20261231a_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM 'fe28f2660a5d24a63b37b9d79f949158' THEN
    RAISE NOTICE 'AMPRENTA_20261231a_TEXT %', v_amp;
    RAISE EXCEPTION '20261231a revenire: AMPRENTA obiectelor migrarii % (asteptat fe28f2660a5d24a63b37b9d79f949158): starea nu e cea din 20261231a; nimic schimbat',
      md5(coalesce(v_amp, ''));
  END IF;
END $pre$;

DROP TRIGGER trg_magazie_referinta_intentie ON public.magazie_echipamente;
DROP FUNCTION public.fn_magazie_referinta_intentie_imuabila();
ALTER TABLE public.magazie_echipamente DROP CONSTRAINT magazie_echipamente_referinta_intentie_key;
ALTER TABLE public.magazie_echipamente DROP COLUMN referinta_intentie;

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_magazie_referinta_intentie_imuabila')
     OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.magazie_echipamente'::regclass AND k.conname = 'magazie_echipamente_referinta_intentie_key')
     OR to_regclass('public.magazie_echipamente_referinta_intentie_key') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.magazie_echipamente'::regclass AND t.tgname = 'trg_magazie_referinta_intentie')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_echipamente'::regclass AND a.attname = 'referinta_intentie' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '20261231a revenire: postconditie: obiectele migrarii au ramas';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261231a_magazie_intrare_referinta_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261231a revenire: garda final invalida';
  END IF;
END $post$;
