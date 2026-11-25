-- Revenire 20270112a_ofertare_cantitati_masuratori. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Readuce circuitul ciornelor automate la forma de dinainte (corpurile EXACTE ale lui fn_trg_ofertare_clarificari_baza, ofertare_clarificare_reconfirma,
--   ofertare_clarificare_exceptie_identitate, ofertare_clarificari_export (docs/R5_MIGRARE_3_review_copilot.sql), ofertare_clarificari_notifica
--   (20261121a), fn_ofertare_surse_valideaza (20261026a) și vederea v_ofertare_clarificari_baza (docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql) —
--   amprentele LIVE din $pre$-ul migrării),
--   scoate UNIQUE (licitatie_id, nr), cele 6 tabele noi (cu politicile, triggerele, indecșii, secvențele lor) și cele 30 de funcții noi.
-- Corpurile vechi sunt copiate EXACT din fișierele-sursă de mai sus (nu retastate); proba PGlite (t5.1) verifică
--   amprentele lor față de scheletul cu corpurile LIVE.
-- ORDINEA: întâi merge-ul / deploy-ul care scoate ecranul semnalelor și pasul de comparație din edge (altfel: RPC lipsă → eroare afișată, nimic scris),
--   apoi această revenire.
-- Refuz pe date (L14): orice rând în ofertare_cantitati_evaluari / _semnale / _masuratori / _setari sau orice ciornă cu cheie auto_surse_% = refuz,
--   nimic schimbat (se lămuresc de om: ciornele se retrag / șterg prin decizie separată). Starea EXACTĂ a migrării e verificată sub lock: amprentele
--   celor 5 corpuri rescrise și ale celor 30 de funcții noi, triggerele, UNIQUE-ul, vederea, drepturile; altă stare = refuz cu câmpul care diferă.
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20270112a_ofertare_cantitati_masuratori_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20270112120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock-uri: ACCESS EXCLUSIVE NOWAIT pe cele 6 tabele noi (copiii întâi) și pe ofertare_clarificari, într-o singură instrucțiune, ÎNAINTEA
--   verificărilor (L14); ocupat = 55P03 imediat, nimic schimbat; lock_timeout 100 ms pentru cele implicite. Probe: scripts/pglite/test_ofertare_cantitati_masuratori_local.mjs.
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270112a_ofertare_cantitati_masuratori_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270112a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270112a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270112a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270112a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270112a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.ofertare_cantitati_masuratori') IS NULL OR to_regclass('public.ofertare_cantitati_semnale') IS NULL OR to_regclass('public.ofertare_cantitati_evaluari') IS NULL
     OR to_regclass('public.ofertare_cantitati_setari') IS NULL OR to_regclass('public.ofertare_tipare_cantitate') IS NULL OR to_regclass('public.ofertare_elemente_masura') IS NULL
     OR to_regclass('public.ofertare_clarificari') IS NULL OR to_regclass('public.v_ofertare_clarificari_baza') IS NULL
     OR to_regprocedure('public.fn_ofertare_ciorna_auto_stare(public.ofertare_clarificari,text)') IS NULL THEN
    RAISE EXCEPTION '20270112a revenire: starea nu e cea din 20270112a (lipsesc tabelele / vederea / dispecerul)';
  END IF;
END $pre$;

LOCK TABLE public.ofertare_cantitati_masuratori, public.ofertare_cantitati_semnale, public.ofertare_cantitati_evaluari, public.ofertare_cantitati_setari,
  public.ofertare_tipare_cantitate, public.ofertare_elemente_masura, public.ofertare_clarificari IN ACCESS EXCLUSIVE MODE NOWAIT;

DO $stare$
DECLARE v_rau text; v_ev integer; v_sem integer; v_mas integer; v_set integer; v_ciorne integer; r record; v_n integer;
BEGIN
  -- date noi (L14): revenirea nu le pierde in tacere
  SELECT (SELECT count(*) FROM public.ofertare_cantitati_evaluari), (SELECT count(*) FROM public.ofertare_cantitati_semnale), (SELECT count(*) FROM public.ofertare_cantitati_masuratori),
         (SELECT count(*) FROM public.ofertare_cantitati_setari), (SELECT count(*) FROM public.ofertare_clarificari WHERE cheie LIKE 'auto_surse_%')
    INTO v_ev, v_sem, v_mas, v_set, v_ciorne;
  IF v_ev + v_sem + v_mas + v_set + v_ciorne > 0 THEN
    RAISE EXCEPTION '20270112a revenire: exista date (% evaluari, % semnale, % masuratori, % setari, % ciorne auto_surse_*); se lamuresc intai de om; nimic schimbat', v_ev, v_sem, v_mas, v_set, v_ciorne;
  END IF;
  -- corpurile rescrise: EXACT amprentele noi ale migrarii (altfel cineva le-a schimbat intre timp)
  FOR r IN SELECT * FROM (VALUES
      -- >>> AMPRENTE NOI
      ('public.fn_trg_ofertare_clarificari_baza()', 'fde8334c4a8af8db114423e95220b74f', false, '{postgres=X/postgres}'),
      ('public.ofertare_clarificare_reconfirma(bigint,text,text,text)', 'c01c40284cb4513abb79aa9eea69e86b', true, '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.ofertare_clarificare_exceptie_identitate(bigint,text,text)', 'd35e5e1fb801d843a9d5192ce30df282', true, '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.ofertare_clarificari_export(bigint)', '328b25f3431c5fc51a016d5ef359e453', false, '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.ofertare_clarificari_notifica(bigint)', 'c18e8787e66b34f6b69b0d005f344896', true, '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.fn_ofertare_surse_valideaza()', '739ba119df5d51bc4981091de810a25e', true, '{postgres=X/postgres}')
      -- <<< AMPRENTE NOI
    ) v(fn, corp_md5, definer, acl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure(r.fn)
                     AND md5(replace(p.prosrc, chr(13), '')) = r.corp_md5 AND l.lanname = 'plpgsql' AND p.prosecdef = r.definer
                     AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION '20270112a revenire: starea nu e cea din 20270112a (%: corp_md5 / definer / cale / proprietar)', r.fn;
    END IF;
  END LOOP;
  -- functiile noi: fiecare, exact (corp, DEFINER, limbaj, volatilitate, drepturi)
  FOR r IN SELECT * FROM (VALUES
      -- >>> AMPRENTE FUNCTII NOI
      ('public.fn_ofertare_masura_identitate(bigint,integer,text,text,text,text)', '2c1c2423527cbd2117eb4d867eec073a', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_trg_ofertare_masuratori_licitatie()', 'ea1f15471e3287f0afa53e13198caa10', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_trg_ofertare_masuratori_imuabil()', 'dab8458922c30c0b5cfd41d363cf7ddf', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_norm(text)', 'c6ca125c69f99f0684b487531f08c854', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_numar_ro(text)', '8e3e67f96f482442afd2a9866162c967', 'plpgsql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_um_canonica(text,text)', 'a8ea20187d2c62d84a2a9b4badfa20db', 'plpgsql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_dn(text)', '60452ac42c68850b4904d587e6bd916b', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_clasifica(text,text,text,numeric[],text,text,text)', '07dd2b080745b6216c176d77710052a6', 'plpgsql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_lot(text,integer[],text)', '7680472ee843029c12450c239fd5c4ec', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_pagini_permise(jsonb,integer)', '0dd4ca63111cbf405093cb03325cd691', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_pagini(text)', '3d9b5b9811e5d76cab058158a4f76873', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_pagina(text,integer)', '392b31108da66447cc0ea9882e349266', 'plpgsql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_verifica(text,jsonb)', '5bf61f88d1dcfbc1b48f034e65291dc3', 'plpgsql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_felii_autoritative(bigint)', '923fd984cb168018b77d67db759c8db6', 'sql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_pagini_neacoperite(text,bigint)', 'b72dd3e5d9bb5385f9e2a8e5d691027c', 'sql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_ofertare_semnale_fotografie(bigint)', '265a7379c98260864f81f0d1cdaacf1d', 'plpgsql', true, 's', 'postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_ofertare_semnale_context(bigint,text,bigint)', 'bbf9d4f96c66dc38f3b15012dbb029fa', 'plpgsql', true, 's', 'postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_ofertare_semnale_felii(bigint,bigint[],bigint,integer,integer)', '4ac882f99f356df0adc3269bf2a5c0a1', 'sql', true, 's', 'postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_ofertare_semnal_rezolvat(public.ofertare_cantitati_semnale)', '2b25ad9357c2bae002744013e2759ce6', 'sql', true, 's', 'postgres:EXECUTE'),
      ('public.fn_ofertare_semnal_ciorna_libera(public.ofertare_clarificari)', '1565b4ab23cfa422f9c5844bfab77404', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_semnal_upsert(bigint,bigint,integer,text,text,text,text)', 'a59d15bcfd134c7876ced8fb0feaa91b', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_numar_text(numeric)', '7cd18101e4aebb84976103f59c928f74', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_semnal_text(bigint,bigint)', 'de56c317e841e2957385d40af571c270', 'plpgsql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_ofertare_semnale_setari(bigint,numeric,integer)', '9cfb151c759aafb3f223e15c36fab5a9', 'plpgsql', true, 'v', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_ofertare_semnal_raspuns_leaga(bigint,bigint,numeric)', '153f2870cc574ed9c71da19ce6efe1e5', 'plpgsql', true, 'v', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_ofertare_semnale_lista(bigint)', '3ba12807cfc770f7302c16315454e03a', 'plpgsql', true, 's', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_ofertare_masuratori_propune(bigint,uuid,jsonb,jsonb)', '31d39b9bc0a3dcb252f16840ca9e7a06', 'plpgsql', true, 'v', 'postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_ofertare_semnale_publica(bigint,bigint,uuid)', 'd95ea61898ea47cacc2732af74075855', 'plpgsql', true, 'v', 'postgres:EXECUTE, service_role:EXECUTE'),
      ('public.ofertare_semnal_baza_stare(public.ofertare_clarificari,text)', '031261130e5f6e78c526ea05e22cbce3', 'plpgsql', true, 's', 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_ofertare_ciorna_auto_stare(public.ofertare_clarificari,text)', '0664b97a62afc2d5e14f533b8e303876', 'plpgsql', true, 's', 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
      -- <<< AMPRENTE FUNCTII NOI
    ) v(fn, corp_md5, limbaj, definer, volatil, acl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure(r.fn)
                     AND md5(replace(p.prosrc, chr(13), '')) = r.corp_md5 AND l.lanname = r.limbaj AND p.prosecdef = r.definer AND p.provolatile = r.volatil
                     AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                     AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                            SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type AS d
                              FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = r.acl) THEN
      RAISE EXCEPTION '20270112a revenire: starea nu e cea din 20270112a (functia %: corp / proprietati / drepturi)', r.fn;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
   AND (p.proname LIKE 'fn\_ofertare\_masura\_%' OR p.proname LIKE 'fn\_ofertare\_semnal%' OR p.proname LIKE 'fn\_ofertare\_masuratori\_%'
        OR p.proname IN ('fn_ofertare_numar_ro', 'fn_ofertare_um_canonica', 'fn_ofertare_ciorna_auto_stare', 'ofertare_semnal_baza_stare', 'fn_trg_ofertare_masuratori_licitatie', 'fn_trg_ofertare_masuratori_imuabil'));
  IF v_n <> 30 THEN RAISE EXCEPTION '20270112a revenire: % functii noi in loc de 30 (supraincarcari sau lipsuri)', v_n; END IF;
  -- triggerele si UNIQUE-ul, exact
  IF (SELECT string_agg(tgname::text, ', ' ORDER BY tgname::text) FROM pg_trigger WHERE tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tgisinternal)
       IS DISTINCT FROM 'a02_ofertare_clarificari_surse, trg_ofertare_cb_clarificari_jurnal, trg_ofertare_clarificari_baza'
     OR (SELECT string_agg(tgname::text, ', ' ORDER BY tgname::text) FROM pg_trigger WHERE tgrelid = 'public.ofertare_cantitati_masuratori'::regclass AND NOT tgisinternal)
       IS DISTINCT FROM 'trg_ofertare_masuratori_imuabil, trg_ofertare_masuratori_licitatie'
     OR (SELECT string_agg(tgname::text, ', ' ORDER BY tgname::text) FROM pg_trigger WHERE tgrelid = 'public.ofertare_cantitati_evaluari'::regclass AND NOT tgisinternal)
       IS DISTINCT FROM 'trg_ofertare_evaluari_imuabil' THEN
    RAISE EXCEPTION '20270112a revenire: triggerele nu sunt cele din 20270112a';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.ofertare_clarificari'::regclass AND c.conname = 'ofertare_clarificari_licitatie_nr_uq' AND c.contype = 'u'
                   AND pg_get_constraintdef(c.oid) = 'UNIQUE (licitatie_id, nr)') THEN
    RAISE EXCEPTION '20270112a revenire: UNIQUE (licitatie_id, nr) nu e cel din 20270112a';
  END IF;
  -- vederea: forma migrarii; drepturile ei si ale functiilor rescrise se fotografiaza si se re-acorda identic
  IF (SELECT string_agg(a.attname::text, ',' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = 'public.v_ofertare_clarificari_baza'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
       IS DISTINCT FROM 'id,licitatie_id,nr,status,stare,mod_ciorna,mod_curent,amprenta_curenta,marcaj_planse,text,detalii'
     OR pg_get_viewdef('public.v_ofertare_clarificari_baza'::regclass) NOT LIKE '%fn_ofertare_ciorna_auto_stare(c.*, ''afisare''::text)%' THEN
    RAISE EXCEPTION '20270112a revenire: vederea v_ofertare_clarificari_baza nu e cea din 20270112a';
  END IF;
  CREATE TEMP TABLE cm_view_acl ON COMMIT DROP AS
    SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END AS rol, e.privilege_type AS drept
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.v_ofertare_clarificari_baza'::regclass;
  CREATE TEMP TABLE cm_fn_acl ON COMMIT DROP AS
    SELECT f.fn, CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END AS rol, e.privilege_type AS drept
      FROM unnest(ARRAY['public.fn_trg_ofertare_clarificari_baza()', 'public.ofertare_clarificare_reconfirma(bigint,text,text,text)', 'public.ofertare_clarificare_exceptie_identitate(bigint,text,text)',
                        'public.ofertare_clarificari_export(bigint)', 'public.ofertare_clarificari_notifica(bigint)', 'public.fn_ofertare_surse_valideaza()']) f(fn)
      JOIN pg_proc p ON p.oid = to_regprocedure(f.fn), aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e;
  -- triggerele migrarii: active, pe functiile lor (un trigger dezactivat = alta stare)
  IF (SELECT count(*) FROM pg_trigger tg WHERE NOT tg.tgisinternal AND tg.tgenabled = 'O'
        AND ((tg.tgrelid = 'public.ofertare_cantitati_masuratori'::regclass AND tg.tgname = 'trg_ofertare_masuratori_licitatie' AND tg.tgfoid = to_regprocedure('public.fn_trg_ofertare_masuratori_licitatie()'))
          OR (tg.tgrelid = 'public.ofertare_cantitati_masuratori'::regclass AND tg.tgname = 'trg_ofertare_masuratori_imuabil' AND tg.tgfoid = to_regprocedure('public.fn_trg_ofertare_masuratori_imuabil()'))
          OR (tg.tgrelid = 'public.ofertare_cantitati_evaluari'::regclass AND tg.tgname = 'trg_ofertare_evaluari_imuabil' AND tg.tgfoid = to_regprocedure('public.fn_trg_ofertare_masuratori_imuabil()'))
          OR (tg.tgrelid = 'public.ofertare_clarificari'::regclass AND tg.tgname = 'trg_ofertare_clarificari_baza' AND tg.tgfoid = to_regprocedure('public.fn_trg_ofertare_clarificari_baza()'))
          OR (tg.tgrelid = 'public.ofertare_clarificari'::regclass AND tg.tgname = 'a02_ofertare_clarificari_surse' AND tg.tgfoid = to_regprocedure('public.fn_ofertare_surse_valideaza()')))) <> 5 THEN
    RAISE EXCEPTION '20270112a revenire: triggerele migrarii nu sunt toate active pe functiile lor';
  END IF;
  -- nimic din afara migrarii nu depinde de functiile noi (catalog: doar triggerele si vederea migrarii; apeluri textuale in alte functii)
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_proc p ON p.oid = d.refobjid AND d.refclassid = 'pg_proc'::regclass
               WHERE p.pronamespace = 'public'::regnamespace
                 AND (p.proname LIKE 'fn\_ofertare\_masura\_%' OR p.proname LIKE 'fn\_ofertare\_semnal%' OR p.proname LIKE 'fn\_ofertare\_masuratori\_%'
                      OR p.proname IN ('fn_ofertare_numar_ro', 'fn_ofertare_um_canonica', 'fn_ofertare_ciorna_auto_stare', 'ofertare_semnal_baza_stare', 'fn_trg_ofertare_masuratori_licitatie', 'fn_trg_ofertare_masuratori_imuabil'))
                 AND d.deptype = 'n'
                 AND NOT (d.classid = 'pg_trigger'::regclass AND d.objid IN (SELECT tg.oid FROM pg_trigger tg WHERE tg.tgrelid IN ('public.ofertare_cantitati_masuratori'::regclass, 'public.ofertare_cantitati_evaluari'::regclass)))
                 AND NOT (d.classid = 'pg_rewrite'::regclass AND d.objid IN (SELECT rw.oid FROM pg_rewrite rw WHERE rw.ev_class = 'public.v_ofertare_clarificari_baza'::regclass))
                 AND NOT (d.classid = 'pg_constraint'::regclass AND d.objid IN (SELECT con.oid FROM pg_constraint con WHERE con.conrelid = 'public.ofertare_cantitati_semnale'::regclass)))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                   AND NOT (p.proname LIKE 'fn\_ofertare\_masura\_%' OR p.proname LIKE 'fn\_ofertare\_semnal%' OR p.proname LIKE 'fn\_ofertare\_masuratori\_%'
                            OR p.proname IN ('fn_ofertare_numar_ro', 'fn_ofertare_um_canonica', 'fn_ofertare_ciorna_auto_stare', 'ofertare_semnal_baza_stare', 'fn_trg_ofertare_masuratori_licitatie', 'fn_trg_ofertare_masuratori_imuabil',
                                             'fn_trg_ofertare_clarificari_baza', 'ofertare_clarificare_reconfirma', 'ofertare_clarificare_exceptie_identitate', 'ofertare_clarificari_export', 'ofertare_clarificari_notifica'))
                   AND p.prosrc ~ '[[:<:]](fn_ofertare_masura_|fn_ofertare_semnal|fn_ofertare_masuratori_|fn_ofertare_numar_ro|fn_ofertare_um_canonica|fn_ofertare_ciorna_auto_stare|ofertare_semnal_baza_stare)') THEN
    RAISE EXCEPTION '20270112a revenire: alte obiecte depind de functiile noi';
  END IF;
END $stare$;

-- 1. vederea (depinde de dispecer) si corpurile vechi EXACTE (CREATE OR REPLACE pastreaza OID, trigger, ACL)
DROP VIEW public.v_ofertare_clarificari_baza;
CREATE OR REPLACE FUNCTION public.fn_trg_ofertare_clarificari_baza()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_st jsonb; v_auto boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    IF coalesce(OLD.cheie,'') LIKE 'auto_planse_%' THEN RAISE EXCEPTION 'Proveniența și deciziile se păstrează; retrage ciorna în loc de ștergere'; END IF;
    IF OLD.origine IN ('platforma','automat') AND OLD.status IN ('trimisa','raspunsa') THEN
      RAISE EXCEPTION 'Documentul transmis este imuabil';
    END IF;
    RETURN OLD;
  END IF;
  v_auto := coalesce(NEW.cheie,'') LIKE 'auto_planse_%' OR (TG_OP='UPDATE' AND coalesce(OLD.cheie,'') LIKE 'auto_planse_%');
  -- F02/F03: proveniența veche contează și când clientul încearcă s-o schimbe.
  IF NEW.origine IN ('platforma','automat') OR (TG_OP='UPDATE' AND OLD.origine IN ('platforma','automat')) OR v_auto THEN
    IF TG_OP='UPDATE' AND (NEW.origine,NEW.licitatie_id) IS DISTINCT FROM (OLD.origine,OLD.licitatie_id) THEN
      RAISE EXCEPTION 'Proveniența clarificării de platformă este imuabilă';
    END IF;
    IF NEW.status='raspunsa' AND (TG_OP='INSERT' OR OLD.status IS NULL OR OLD.status NOT IN ('trimisa','raspunsa')) THEN
      RAISE EXCEPTION 'Clarificare blocată: răspunsul cere o clarificare trimisă';
    END IF;
    IF TG_OP='UPDATE' THEN
      IF OLD.status IN ('trimisa','raspunsa') AND ((NEW.intrebare,NEW.fisier_path) IS DISTINCT FROM (OLD.intrebare,OLD.fisier_path)
        OR NEW.status IS NULL OR NEW.status NOT IN ('trimisa','raspunsa')) THEN RAISE EXCEPTION 'Documentul transmis este imuabil'; END IF;
      -- O editare nu moștenește aprobarea textului anterior, indiferent de writer.
      IF NEW.intrebare IS DISTINCT FROM OLD.intrebare
         AND (OLD.status='de_trimis' OR NEW.status='de_trimis') THEN NEW.status := 'propunere'; END IF;
    END IF;
    IF NEW.status IN ('de_trimis','trimisa') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
       AND current_user IN ('authenticated','anon')
       AND NOT coalesce(public.fn_ofertare_source_pack_poate_decide(NEW.licitatie_id),false) THEN
      RAISE EXCEPTION 'Clarificare blocată: aprobarea cere drept de decizie pe licitație';
    END IF;
  END IF;
  -- Amprenta R9b rămâne exclusiv pe auto_planse_%. 
  IF NOT v_auto THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.cheie,NEW.licitatie_id,NEW.origine) IS DISTINCT FROM (OLD.cheie,OLD.licitatie_id,OLD.origine) THEN
      RAISE EXCEPTION 'Proveniența clarificării automate este imuabilă';
    END IF;
  END IF;
  IF current_user IN ('authenticated','anon','service_role') THEN
    IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Ciorna automată se creează doar prin generatorul controlat'; END IF;
    IF NEW.baza_generare IS DISTINCT FROM OLD.baza_generare THEN RAISE EXCEPTION 'Baza și aprobarea se scriu doar prin reconfirmare'; END IF;
    NEW.sursa := OLD.sursa;
  END IF;
  IF TG_OP='UPDATE' AND NEW.intrebare IS DISTINCT FROM OLD.intrebare AND current_user IN ('authenticated','anon','service_role') THEN
    -- Textul se salvează, aprobarea nu se transferă. Istoricul deciziilor se păstrează.
    NEW.baza_generare := (coalesce(NEW.baza_generare,'{}'::jsonb)-'reconfirmare') ||
      CASE WHEN OLD.baza_generare ? 'reconfirmare' AND NOT (OLD.baza_generare ? 'istoric_decizii')
        THEN jsonb_build_object('istoric_decizii',jsonb_build_array(OLD.baza_generare->'reconfirmare')) ELSE '{}'::jsonb END ||
      jsonb_build_object('text_editat_de',auth.uid(),'text_editat_la',now());
    IF NEW.status='de_trimis' THEN NEW.status := 'propunere'; END IF;
  END IF;
  -- F04: o editare nu poate reactiva excepția nici după revenirea la textul anterior.
  -- Generatorul poate rescrie baza unei propuneri încă nereconfirmate: nu pierde auditul excepției.
  IF TG_OP='UPDATE' AND OLD.baza_generare ? 'istoric_decizii'
     AND NOT (coalesce(NEW.baza_generare,'{}'::jsonb) ? 'istoric_decizii') THEN
    NEW.baza_generare := coalesce(NEW.baza_generare,'{}'::jsonb) ||
      jsonb_build_object('istoric_decizii',OLD.baza_generare->'istoric_decizii');
  END IF;
  IF TG_OP='UPDATE' AND NEW.intrebare IS DISTINCT FROM OLD.intrebare THEN
    NEW.baza_generare := NEW.baza_generare - 'exceptie_identitate';
  END IF;
  IF NEW.status IN ('de_trimis','trimisa') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    v_st := public.ofertare_clarificare_baza_stare(NEW.licitatie_id,NEW.intrebare,NEW.sursa,NEW.baza_generare);
    IF coalesce(v_st->>'stare','') NOT IN ('ok','ok_identitate_limitata') OR coalesce((v_st->>'marcaj_planse')::boolean,true) THEN
      RAISE EXCEPTION 'Clarificare blocată: %. Reconfirmă textul pe baza curentă.',v_st->>'text';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.ofertare_clarificare_reconfirma(p_id bigint,p_amprenta text,p_decizie text,p_nota text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_cur jsonb; v_decizie jsonb; v_sursa text;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RETURN jsonb_build_object('error','fără acces la Ofertare'); END IF;
  IF coalesce(p_decizie,'') NOT IN ('revizuit','luat_act') THEN RETURN jsonb_build_object('error','alege revizuit sau, după transmitere, luat_act'); END IF;
  IF length(btrim(coalesce(p_nota,''))) < (CASE WHEN p_decizie='luat_act' THEN 10 ELSE 5 END) THEN RETURN jsonb_build_object('error','nota de review este prea scurtă'); END IF;
  SELECT * INTO c FROM public.ofertare_clarificari WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR coalesce(c.cheie,'') NOT LIKE 'auto_planse_%' THEN RETURN jsonb_build_object('error','nu e ciornă automată'); END IF;
  -- R9b (Copilot): reconfirmarea cere DREPT DE DECIZIE pe licitație (owner / responsabil / admin Ofertare), nu doar acces la modul.
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(c.licitatie_id),false) THEN RETURN jsonb_build_object('error','fără drept de decizie pe licitație'); END IF;
  v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
  IF p_amprenta IS NULL OR v_st->>'amprenta_curenta' IS DISTINCT FROM p_amprenta THEN RETURN jsonb_build_object('error','textul sau baza s-au schimbat — reîncarcă și verifică'); END IF;
  v_decizie := jsonb_build_object('token',p_amprenta,'text_hash',md5(coalesce(c.intrebare,'')),
    'amprenta',v_st->>'amprenta_baza','text_aprobat',c.intrebare,'de',auth.uid(),'la',now(),'decizie',p_decizie,'nota',btrim(p_nota));
  IF c.status IN ('trimisa','raspunsa') THEN
    IF p_decizie <> 'luat_act' THEN RETURN jsonb_build_object('error','document transmis imuabil — doar luat_act'); END IF;
    UPDATE public.ofertare_clarificari SET baza_generare=coalesce(baza_generare,'{}'::jsonb)||jsonb_build_object('luat_act',v_decizie,
      'istoric_decizii',coalesce(baza_generare->'istoric_decizii','[]'::jsonb)||jsonb_build_array(v_decizie)) WHERE id=p_id;
  ELSE
    IF c.status NOT IN ('propunere','de_trimis') OR p_decizie <> 'revizuit' THEN RETURN jsonb_build_object('error','decizie incompatibilă cu starea ciornei'); END IF;
    v_cur := public.ofertare_f3_baza(c.licitatie_id);
    IF md5((v_cur->>'amprenta') || '|' || md5(coalesce(c.intrebare,''))) IS DISTINCT FROM p_amprenta THEN RETURN jsonb_build_object('error','baza s-a schimbat în timpul verificării'); END IF;
    SELECT string_agg(t,',' ORDER BY o) INTO v_sursa FROM unnest(string_to_array(coalesce(c.sursa,''),',')) WITH ORDINALITY x(t,o) WHERE t <> 'revizie_planse_auto';
    UPDATE public.ofertare_clarificari SET sursa=v_sursa, updated_at=now(),
      baza_generare=v_cur||
        CASE WHEN c.baza_generare->'exceptie_identitate'->>'token'=p_amprenta
          THEN jsonb_build_object('exceptie_identitate',c.baza_generare->'exceptie_identitate') ELSE '{}'::jsonb END ||
        jsonb_build_object('text_hash',md5(coalesce(c.intrebare,'')),'reconfirmare',v_decizie,
        'istoric_decizii',coalesce(c.baza_generare->'istoric_decizii','[]'::jsonb)||
          CASE WHEN c.baza_generare->'reconfirmare' IS NOT NULL AND NOT (c.baza_generare ? 'istoric_decizii') THEN jsonb_build_array(c.baza_generare->'reconfirmare') ELSE '[]'::jsonb END || jsonb_build_array(v_decizie))
      WHERE id=p_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'id',p_id,'decizie',p_decizie);
END $function$;
CREATE OR REPLACE FUNCTION public.ofertare_clarificari_export(p_licitatie_id bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_out jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RAISE EXCEPTION 'fără acces'; END IF;
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id),false) THEN RAISE EXCEPTION 'Export blocat: fără drept de decizie pe licitație'; END IF;
  FOR c IN SELECT * FROM public.ofertare_clarificari WHERE licitatie_id=p_licitatie_id AND status='de_trimis' ORDER BY nr FOR SHARE LOOP
    IF coalesce(c.sursa,'') ~ '(^|,)revizie_' THEN RAISE EXCEPTION 'Clarificarea #% necesită revizie',c.nr; END IF;
    IF coalesce(c.cheie,'') LIKE 'auto_planse_%' THEN
      v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
      IF coalesce(v_st->>'stare','') NOT IN ('ok','ok_identitate_limitata') THEN RAISE EXCEPTION 'Export blocat: %',v_st->>'text'; END IF;
    END IF;
    v_out := v_out || jsonb_build_array(to_jsonb(c));
  END LOOP;
  RETURN v_out;
END $function$;
CREATE OR REPLACE FUNCTION public.ofertare_clarificare_exceptie_identitate(p_id bigint,p_amprenta text,p_motiv text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_decizie jsonb; v_documente jsonb; v_metadate jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','autentificare necesară'); END IF;
  IF length(btrim(coalesce(p_motiv,''))) < 10 THEN RETURN jsonb_build_object('error','motivul trebuie să aibă minimum 10 caractere'); END IF;
  SELECT * INTO c FROM public.ofertare_clarificari WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR coalesce(c.cheie,'') NOT LIKE 'auto_planse_%' THEN RETURN jsonb_build_object('error','nu e ciornă automată'); END IF;
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(c.licitatie_id),false) THEN
    RETURN jsonb_build_object('error','fără drept de decizie pe licitație');
  END IF;
  IF c.status IS NULL OR c.status NOT IN ('propunere','de_trimis') THEN RETURN jsonb_build_object('error','excepția se acceptă doar pentru o ciornă netransmisă'); END IF;
  v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
  IF p_amprenta IS NULL OR v_st->>'amprenta_curenta' IS DISTINCT FROM p_amprenta THEN
    RETURN jsonb_build_object('error','baza s-a schimbat — reîncarcă și verifică textul și documentele');
  END IF;
  IF coalesce(v_st->>'stare','') NOT IN ('identitate_limitata','ok_identitate_limitata') THEN
    RETURN jsonb_build_object('error',CASE WHEN v_st->>'stare'='identitate_contradictorie' THEN v_st->>'text'
      ELSE 'baza curentă nu cere excepție de identitate' END);
  END IF;
  SELECT jsonb_agg(x->'id' ORDER BY (x->>'id')::bigint),
    jsonb_object_agg(x->>'id',jsonb_build_object('fisier_path',x->'fisier_path','marime',x->'marime'))
    INTO v_documente,v_metadate FROM jsonb_array_elements(v_st->'curent'->'documente') x WHERE x->>'identitate'='limitata';
  v_decizie := jsonb_build_object('token',p_amprenta,'de',auth.uid(),'la',now(),'motiv',btrim(p_motiv),
    'documente',v_documente,'metadate',v_metadate,'decizie','exceptie_identitate');
  UPDATE public.ofertare_clarificari SET updated_at=now(),
    baza_generare=coalesce(c.baza_generare,'{}'::jsonb)||jsonb_build_object('exceptie_identitate',v_decizie,
      'istoric_decizii',coalesce(c.baza_generare->'istoric_decizii','[]'::jsonb)||
        CASE WHEN c.baza_generare->'reconfirmare' IS NOT NULL AND NOT (c.baza_generare ? 'istoric_decizii')
          THEN jsonb_build_array(c.baza_generare->'reconfirmare') ELSE '[]'::jsonb END || jsonb_build_array(v_decizie))
    WHERE id=p_id;
  RETURN jsonb_build_object('ok',true,'id',p_id);
END $function$;
CREATE OR REPLACE FUNCTION public.ofertare_clarificari_notifica(p_licitatie_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_resp uuid[]; v_n int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RETURN jsonb_build_object('error','fără acces'); END IF;
  -- 20261121a: ambii responsabili (fără NULL, fără dubluri)
  SELECT array(SELECT DISTINCT x FROM unnest(ARRAY[responsabil_id, responsabil2_id]) x WHERE x IS NOT NULL) INTO v_resp FROM public.ofertare_licitatii WHERE id=p_licitatie_id;
  FOR c IN SELECT * FROM public.ofertare_clarificari WHERE licitatie_id=p_licitatie_id AND cheie LIKE 'auto_planse_%' AND status <> 'retrasa' ORDER BY id FOR UPDATE LOOP
    v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
    IF v_st->>'stare' IN ('schimbata','indisponibila') AND v_st->>'amprenta_curenta' IS NOT NULL AND cardinality(v_resp) > 0 AND c.baza_generare->>'notificat_neactual' IS DISTINCT FROM v_st->>'amprenta_curenta' THEN
      INSERT INTO public.notifications(profile_id,type,modul,title,message,link_to)
        SELECT r,'info','Ofertare','Clarificare de reverificat','Licitația #'||p_licitatie_id||': baza s-a schimbat — de reverificat. Textul rămâne păstrat. Nimic trimis automat.','/ofertare'
        FROM unnest(v_resp) r;
      UPDATE public.ofertare_clarificari SET baza_generare=coalesce(baza_generare,'{}'::jsonb)||jsonb_build_object('notificat_neactual',v_st->>'amprenta_curenta') WHERE id=c.id;
      v_n:=v_n+1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'notificari',v_n);
EXCEPTION WHEN others THEN RETURN jsonb_build_object('error',SQLERRM);
END $function$
;
CREATE OR REPLACE FUNCTION public.fn_ofertare_surse_valideaza()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_lipsa bigint;
  v_rol text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_utilizator boolean;
  -- 20261026a: pe ofertare_cerinte se validează surse_document_ids (blocul comun de la final), ca pe cantități.
  -- sursele derivate de server (clarificarea automată): un ID DISPĂRUT (inexistent global) se păstrează — codul îl tratează ca
  -- neverificabil = exclus; un ID existent în ALTĂ licitație se refuză ca la orice scriere (review Copilot r1 P1 #1)
  v_derivat boolean := false;
  v_max constant int := 20000;   -- fără trunchiere: baza F3 a clarificării automate poate avea sute de rânduri (Jakarinos r6 P2)
BEGIN
  v_utilizator := v_rol IN ('authenticated', 'anon');
  IF v_utilizator THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.surse_document_ids IS NOT NULL THEN
        RAISE EXCEPTION 'Sursele (surse_*) le scrie doar serverul' USING ERRCODE = '42501';
      END IF;
      IF TG_TABLE_NAME = 'ofertare_clarificari' THEN
        -- originile rezervate serverului (automat, platforma) nu se inserează de utilizator (review Copilot r3 P1)
        IF NEW.surse_cerinte_ids IS NOT NULL OR NEW.surse_cantitati_ids IS NOT NULL OR NEW.origine IN ('automat', 'platforma') THEN
          RAISE EXCEPTION 'Sursele (surse_*) și clarificările generate (automat / platforma) le scrie doar serverul' USING ERRCODE = '42501';
        END IF;
      END IF;
    ELSE
      IF NEW.surse_document_ids IS DISTINCT FROM OLD.surse_document_ids THEN
        RAISE EXCEPTION 'Sursele (surse_*) le scrie doar serverul' USING ERRCODE = '42501';
      END IF;
      IF TG_TABLE_NAME = 'ofertare_clarificari' THEN
        IF NEW.surse_cerinte_ids IS DISTINCT FROM OLD.surse_cerinte_ids OR NEW.surse_cantitati_ids IS DISTINCT FROM OLD.surse_cantitati_ids THEN
          RAISE EXCEPTION 'Sursele (surse_*) le scrie doar serverul' USING ERRCODE = '42501';
        END IF;
        -- originea e atribut de proveniență: imuabilă pentru utilizator după INSERT (fără spălare platforma -> manual, Copilot r3 P1)
        IF NEW.origine IS DISTINCT FROM OLD.origine THEN
          RAISE EXCEPTION 'Originea clarificării nu se schimbă după creare' USING ERRCODE = '42501';
        END IF;
        IF OLD.origine = 'automat' AND (NEW.sursa, NEW.baza_generare) IS DISTINCT FROM (OLD.sursa, OLD.baza_generare) THEN
          RAISE EXCEPTION 'Proveniența clarificării automate (origine / sursa / baza_generare) o scrie doar serverul' USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'ofertare_clarificari' THEN
    -- Clarificarea AUTOMATĂ din planșe (ofertare_clarificare_planse_auto, scrisă doar de server): sursele se derivă din
    -- ce a folosit funcția — planșele din `sursa` („planse_auto:475,474,…”), documentele și rândurile de cantități din
    -- baza_generare. Fără să rescriem RPC-ul de 12k. La UPDATE sursele NU scad (reuniune cu cele vechi, Jakarinos r6 P1 #6):
    -- o ciornă protejată își poate păstra textul despre o planșă scoasă din `sursa` — planșa rămâne în proveniență.
    IF NEW.origine = 'automat' AND (TG_OP = 'INSERT' OR NEW.sursa IS DISTINCT FROM OLD.sursa
                                    OR NEW.baza_generare IS DISTINCT FROM OLD.baza_generare OR NEW.origine IS DISTINCT FROM OLD.origine
                                    OR NEW.surse_document_ids IS DISTINCT FROM OLD.surse_document_ids
                                    OR NEW.surse_cantitati_ids IS DISTINCT FROM OLD.surse_cantitati_ids) THEN
      NEW.surse_document_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM (
          SELECT t::bigint AS x FROM unnest(string_to_array(replace(coalesce(NEW.sursa, ''), 'planse_auto:', ''), ',')) t
           WHERE coalesce(NEW.sursa, '') LIKE 'planse_auto:%' AND t ~ '^[0-9]{1,18}$'
          UNION
          SELECT (e->>'id')::bigint FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.baza_generare->'documente') = 'array'
                                                                   THEN NEW.baza_generare->'documente' ELSE '[]'::jsonb END) e
           WHERE e->>'id' ~ '^[0-9]{1,18}$'
          UNION
          SELECT y FROM unnest(CASE WHEN TG_OP = 'UPDATE' THEN OLD.surse_document_ids END) y WHERE y IS NOT NULL
          UNION   -- 20261026a: sursele scrise EXPLICIT de server odată cu textul (ofertare_clarificare_planse_auto)
          SELECT y FROM unnest(NEW.surse_document_ids) y WHERE y IS NOT NULL) s);
      NEW.surse_cantitati_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM (
          SELECT (e->>'id')::bigint AS x
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.baza_generare->'randuri') = 'array'
                                           THEN NEW.baza_generare->'randuri' ELSE '[]'::jsonb END) e
           WHERE e->>'id' ~ '^[0-9]{1,18}$'
          UNION
          SELECT y FROM unnest(CASE WHEN TG_OP = 'UPDATE' THEN OLD.surse_cantitati_ids END) y WHERE y IS NOT NULL
          UNION   -- 20261026a: idem, cantitățile scrise explicit
          SELECT y FROM unnest(NEW.surse_cantitati_ids) y WHERE y IS NOT NULL) s);
      v_derivat := true;
    END IF;
    IF NEW.surse_cerinte_ids IS NOT NULL THEN
      IF array_position(NEW.surse_cerinte_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_cerinte_ids) > v_max THEN
        RAISE EXCEPTION 'surse_cerinte_ids: fără NULL, maxim %', v_max USING ERRCODE = '22023';
      END IF;
      NEW.surse_cerinte_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_cerinte_ids) x);
      SELECT x INTO v_lipsa FROM unnest(NEW.surse_cerinte_ids) x
       WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cerinte c WHERE c.id = x AND c.licitatie_id = NEW.licitatie_id) LIMIT 1;
      IF FOUND THEN RAISE EXCEPTION 'surse_cerinte_ids: cerința % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
    END IF;
    IF NEW.surse_cantitati_ids IS NOT NULL THEN
      IF array_position(NEW.surse_cantitati_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_cantitati_ids) > v_max THEN
        RAISE EXCEPTION 'surse_cantitati_ids: fără NULL, maxim %', v_max USING ERRCODE = '22023';
      END IF;
      NEW.surse_cantitati_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_cantitati_ids) x);
      SELECT x INTO v_lipsa FROM unnest(NEW.surse_cantitati_ids) x
       WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cantitati q WHERE q.id = x AND q.licitatie_id = NEW.licitatie_id)
         AND (NOT v_derivat OR EXISTS (SELECT 1 FROM public.ofertare_cantitati q WHERE q.id = x)) LIMIT 1;
      IF FOUND THEN RAISE EXCEPTION 'surse_cantitati_ids: cantitatea % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
    END IF;
  END IF;
  -- surse_document_ids: pe ambele tabele
  IF NEW.surse_document_ids IS NOT NULL THEN
    IF array_position(NEW.surse_document_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_document_ids) > v_max THEN
      RAISE EXCEPTION 'surse_document_ids: fără NULL, maxim %', v_max USING ERRCODE = '22023';
    END IF;
    NEW.surse_document_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_document_ids) x);
    SELECT x INTO v_lipsa FROM unnest(NEW.surse_document_ids) x
     WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = x AND d.licitatie_id = NEW.licitatie_id)
       AND (NOT v_derivat OR EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = x)) LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'surse_document_ids: documentul % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
  END IF;
  RETURN NEW;
END$fn$;
CREATE VIEW public.v_ofertare_clarificari_baza WITH (security_invoker = on) AS
SELECT c.id, c.licitatie_id, c.nr, c.status, s.x ->> 'stare' AS stare, s.x ->> 'mod_ciorna' AS mod_ciorna, s.x -> 'curent' ->> 'mod' AS mod_curent,
       s.x ->> 'amprenta_curenta' AS amprenta_curenta, coalesce((s.x ->> 'marcaj_planse')::boolean, false) AS marcaj_planse, s.x ->> 'text' AS text, s.x AS detalii
  FROM public.ofertare_clarificari c
 CROSS JOIN LATERAL (SELECT public.ofertare_clarificare_baza_stare(c.licitatie_id, c.intrebare, c.sursa, c.baza_generare) AS x) s
 WHERE coalesce(c.cheie, '') LIKE 'auto_planse_%' AND c.status <> 'retrasa';
REVOKE ALL ON public.v_ofertare_clarificari_baza FROM PUBLIC, anon, authenticated, service_role;
DO $acl$
DECLARE r record;
BEGIN
  FOR r IN SELECT rol, string_agg(drept, ', ' ORDER BY drept) AS drepturi FROM cm_view_acl WHERE rol <> 'postgres' GROUP BY rol LOOP
    EXECUTE format('GRANT %s ON public.v_ofertare_clarificari_baza TO %I', r.drepturi, r.rol);
  END LOOP;
END $acl$;
COMMENT ON VIEW public.v_ofertare_clarificari_baza IS 'R9b: starea review-ului textului exact pe baza curentă, cu diferențe și valori pentru panoul intern. Necesita_review și luat_act nu sunt aprobări de export. security_invoker.';

-- 2. functiile noi care nu sunt de trigger / de CHECK (cele cu tip de rand intai: altfel DROP TABLE le-ar cere CASCADE)
DROP FUNCTION public.fn_ofertare_ciorna_auto_stare(public.ofertare_clarificari, text);
DROP FUNCTION public.ofertare_semnal_baza_stare(public.ofertare_clarificari, text);
DROP FUNCTION public.fn_ofertare_semnale_lista(bigint);
DROP FUNCTION public.fn_ofertare_semnale_publica(bigint, bigint, uuid);
DROP FUNCTION public.fn_ofertare_masuratori_propune(bigint, uuid, jsonb, jsonb);
DROP FUNCTION public.fn_ofertare_semnal_raspuns_leaga(bigint, bigint, numeric);
DROP FUNCTION public.fn_ofertare_semnale_setari(bigint, numeric, integer);
DROP FUNCTION public.fn_ofertare_semnal_text(bigint, bigint);
DROP FUNCTION public.fn_ofertare_masura_numar_text(numeric);
DROP FUNCTION public.fn_ofertare_semnal_upsert(bigint, bigint, integer, text, text, text, text);
DROP FUNCTION public.fn_ofertare_semnal_ciorna_libera(public.ofertare_clarificari);
DROP FUNCTION public.fn_ofertare_semnal_rezolvat(public.ofertare_cantitati_semnale);
DROP FUNCTION public.fn_ofertare_semnale_felii(bigint, bigint[], bigint, integer, integer);
DROP FUNCTION public.fn_ofertare_semnale_context(bigint, text, bigint);
DROP FUNCTION public.fn_ofertare_semnale_fotografie(bigint);
DROP FUNCTION public.fn_ofertare_masura_pagini_neacoperite(text, bigint);
DROP FUNCTION public.fn_ofertare_masura_felii_autoritative(bigint);
DROP FUNCTION public.fn_ofertare_masura_verifica(text, jsonb);
DROP FUNCTION public.fn_ofertare_masura_pagina(text, integer);
DROP FUNCTION public.fn_ofertare_masura_pagini(text);
DROP FUNCTION public.fn_ofertare_masura_pagini_permise(jsonb, integer);
DROP FUNCTION public.fn_ofertare_masura_lot(text, integer[], text);
DROP FUNCTION public.fn_ofertare_masura_clasifica(text, text, text, numeric[], text, text, text);
DROP FUNCTION public.fn_ofertare_masura_dn(text);
DROP FUNCTION public.fn_ofertare_um_canonica(text, text);
DROP FUNCTION public.fn_ofertare_numar_ro(text);
DROP FUNCTION public.fn_ofertare_masura_norm(text);
-- 3. tabelele (copiii intai; triggerele si politicile lor pleaca cu ele), apoi functiile de trigger si de CHECK, apoi UNIQUE-ul
DROP TABLE public.ofertare_cantitati_masuratori;
DROP TABLE public.ofertare_cantitati_semnale;
DROP TABLE public.ofertare_cantitati_evaluari;
DROP TABLE public.ofertare_cantitati_setari;
DROP TABLE public.ofertare_tipare_cantitate;
DROP TABLE public.ofertare_elemente_masura;
DROP FUNCTION public.fn_trg_ofertare_masuratori_imuabil();
DROP FUNCTION public.fn_trg_ofertare_masuratori_licitatie();
DROP FUNCTION public.fn_ofertare_masura_identitate(bigint, integer, text, text, text, text);
ALTER TABLE public.ofertare_clarificari DROP CONSTRAINT ofertare_clarificari_licitatie_nr_uq;

DO $post$
DECLARE r record; v_n integer;
BEGIN
  -- corpurile readuse = amprentele LIVE (cele din $pre$-ul migrarii), proprietati si ACL identice cu cele fotografiate
  FOR r IN SELECT * FROM (VALUES
      -- >>> AMPRENTE LIVE
      ('public.fn_trg_ofertare_clarificari_baza()', '2183cb89a14d499311ac823bb41ce204', false),
      ('public.ofertare_clarificare_reconfirma(bigint,text,text,text)', '704c8c2961fbaf6bfa1da493e59f4900', true),
      ('public.ofertare_clarificare_exceptie_identitate(bigint,text,text)', '1ff26128565d0b0901e00eb8e4cad47f', true),
      ('public.ofertare_clarificari_export(bigint)', 'a5c24ae8d822383ef66977d598543fd9', false),
      ('public.ofertare_clarificari_notifica(bigint)', '1a77b5c8226f86257b779140e18c56c7', true),
      ('public.ofertare_clarificare_baza_stare(bigint,text,text,jsonb)', '1eb3d1c9992ff06a6e76fb79692a9313', false),
      ('public.fn_ofertare_surse_valideaza()', '03b3a62bf2b4bdce1378e75397179099', true)
      -- <<< AMPRENTE LIVE
    ) v(fn, corp_md5, definer) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure(r.fn)
                     AND md5(replace(p.prosrc, chr(13), '')) = r.corp_md5 AND l.lanname = 'plpgsql' AND p.prosecdef = r.definer
                     AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION '20270112a revenire post: % nu are corpul LIVE (corp md5 % / definer %)', r.fn, r.corp_md5, r.definer;
    END IF;
    IF EXISTS (SELECT 1 FROM cm_fn_acl a WHERE a.fn = r.fn)
       AND (SELECT string_agg(rol || ':' || drept, ', ' ORDER BY rol || ':' || drept COLLATE "C") FROM cm_fn_acl WHERE fn = r.fn)
           IS DISTINCT FROM (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                               SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type AS d
                                 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE p.oid = to_regprocedure(r.fn)) a) THEN
      RAISE EXCEPTION '20270112a revenire post: drepturile functiei % s-au schimbat', r.fn;
    END IF;
  END LOOP;
  -- absenta TUTUROR obiectelor noi
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
   AND (p.proname LIKE 'fn\_ofertare\_masura\_%' OR p.proname LIKE 'fn\_ofertare\_semnal%' OR p.proname LIKE 'fn\_ofertare\_masuratori\_%'
        OR p.proname IN ('fn_ofertare_numar_ro', 'fn_ofertare_um_canonica', 'fn_ofertare_ciorna_auto_stare', 'ofertare_semnal_baza_stare', 'fn_trg_ofertare_masuratori_licitatie', 'fn_trg_ofertare_masuratori_imuabil'));
  IF v_n <> 0 OR to_regclass('public.ofertare_cantitati_masuratori') IS NOT NULL OR to_regclass('public.ofertare_cantitati_semnale') IS NOT NULL
     OR to_regclass('public.ofertare_cantitati_evaluari') IS NOT NULL OR to_regclass('public.ofertare_cantitati_setari') IS NOT NULL
     OR to_regclass('public.ofertare_tipare_cantitate') IS NOT NULL OR to_regclass('public.ofertare_elemente_masura') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ofertare_clarificari_licitatie_nr_uq')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_ofertare_masuratori_licitatie', 'trg_ofertare_masuratori_imuabil', 'trg_ofertare_evaluari_imuabil')) THEN
    RAISE EXCEPTION '20270112a revenire post: au ramas obiecte';
  END IF;
  -- triggerele ofertare_clarificari, vederea veche (coloane, definitia pe baza F3, drepturile fotografiate)
  IF (SELECT string_agg(tgname::text, ', ' ORDER BY tgname::text) FROM pg_trigger WHERE tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tgisinternal)
       IS DISTINCT FROM 'a02_ofertare_clarificari_surse, trg_ofertare_cb_clarificari_jurnal, trg_ofertare_clarificari_baza'
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari'::regclass AND tg.tgname = 'trg_ofertare_clarificari_baza'
                      AND tg.tgfoid = to_regprocedure('public.fn_trg_ofertare_clarificari_baza()') AND tg.tgtype = 31 AND tg.tgenabled = 'O') THEN
    RAISE EXCEPTION '20270112a revenire post: triggerele ofertare_clarificari';
  END IF;
  IF (SELECT string_agg(a.attname::text, ',' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = 'public.v_ofertare_clarificari_baza'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
       IS DISTINCT FROM 'id,licitatie_id,nr,status,stare,mod_ciorna,mod_curent,amprenta_curenta,marcaj_planse,text,detalii'
     OR pg_get_viewdef('public.v_ofertare_clarificari_baza'::regclass) NOT LIKE '%ofertare_clarificare_baza_stare(c.licitatie_id, c.intrebare, c.sursa, c.baza_generare)%'
     OR pg_get_viewdef('public.v_ofertare_clarificari_baza'::regclass) NOT LIKE '%''auto_planse_%''%'
     OR pg_get_viewdef('public.v_ofertare_clarificari_baza'::regclass) LIKE '%surse%'
     OR (SELECT string_agg(rol || ':' || drept, ', ' ORDER BY rol || ':' || drept COLLATE "C") FROM cm_view_acl)
        IS DISTINCT FROM (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                            SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type AS d
                              FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.v_ofertare_clarificari_baza'::regclass) a) THEN
    RAISE EXCEPTION '20270112a revenire post: vederea v_ofertare_clarificari_baza nu e cea veche (coloane / definitie / drepturi)';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270112a_ofertare_cantitati_masuratori_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270112a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20270112a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
