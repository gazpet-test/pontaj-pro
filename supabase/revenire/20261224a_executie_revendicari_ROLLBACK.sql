-- Revenire 20261224a_executie_revendicari. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: cele 9 tabele executie_revendicar* (cu trigger-ele, politicile și indexurile lor), cele 2 vederi
-- v_executie_revendicare_* și cele 36 de funcții fn_executie_revendicare_*.
-- REFUZĂ dacă oricare tabel are rânduri (dosare, jurnal, chei, alerte...): nimic din dosarele de revendicare nu se șterge de aici. Golirea e o
-- decizie separată (preview -> „da” owner -> apply, cu export înainte).
-- Gestionarul tranzacției e runnerul (livrare_migrare.sh --plafon-tranzactie-ms 2000, același ca la migrare) sau operatorul. Un singur string:
--   SET transaction_timeout = 2000; BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.livrare_migrare', '20261224a_executie_revendicari_ROLLBACK:' || txid_current(), true);
--   SELECT set_config('gazpet.plafon_tranzactie', '2000:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- Ordinea lock-urilor: aceeași ca în RPC-uri (dosarele, apoi copiii, apoi jurnalul și cheile), toate ACCESS EXCLUSIVE NOWAIT, ÎNAINTEA
-- verificării „gol” (un RPC concurent nu poate scrie un rând numărat 0 și apoi pierdut la DROP; un tabel ocupat = refuz imediat, fără
-- așteptare, deci fără ciclu). Nu se ia niciun advisory.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează (nimic nu rulează după el).
DO $revenire$
DECLARE
  v_tab constant text[] := ARRAY['executie_revendicari', 'executie_revendicare_repere', 'executie_revendicare_acte', 'executie_revendicare_comunicari',
                                 'executie_revendicare_termene', 'executie_revendicare_dovezi', 'executie_revendicare_alerte', 'executie_revendicare_jurnal',
                                 'executie_revendicare_chei'];
  t text; r record; v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261224a_executie_revendicari_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261224a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261224a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261224a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261224a revenire: PLAFON_TRANZACTIE lipsa: % marcaj %', coalesce(v_plafon, 'lipsa'),
      coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- starea exactă a migrării: tabelele, vederile, numărul de funcții, trigger-ele active
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname ~ '^executie_revendicar' AND c.relname = ANY (v_tab)) <> 9
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname ~ '^executie_revendicar' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')) <> 9
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname IN ('v_executie_revendicare_termene', 'v_executie_revendicare_acte')) <> 2
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_revendicare\_%') <> 36
     OR (SELECT count(*) FROM pg_trigger g WHERE g.tgrelid IN (SELECT ('public.' || x)::regclass FROM unnest(v_tab) x) AND NOT g.tgisinternal) <> 15 THEN
    RAISE EXCEPTION '20261224a revenire: starea nu e cea din 20261224a';
  END IF;
  -- nimic altceva nu depinde de obiectele migrării: vederi străine, FK-uri din afară, politici care cheamă predicatul
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid JOIN pg_class v ON v.oid = w.ev_class
              WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid IN (SELECT ('public.' || x)::regclass FROM unnest(v_tab) x)
                AND v.relname NOT IN ('v_executie_revendicare_termene', 'v_executie_revendicare_acte'))
     OR EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid JOIN pg_class v ON v.oid = w.ev_class
                 WHERE d.classid = 'pg_rewrite'::regclass
                   AND d.refobjid IN ('public.v_executie_revendicare_termene'::regclass, 'public.v_executie_revendicare_acte'::regclass)
                   AND v.oid NOT IN ('public.v_executie_revendicare_termene'::regclass, 'public.v_executie_revendicare_acte'::regclass))
     OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.contype = 'f' AND k.confrelid IN (SELECT ('public.' || x)::regclass FROM unnest(v_tab) x)
                 AND k.conrelid NOT IN (SELECT ('public.' || x)::regclass FROM unnest(v_tab) x))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE NOT (schemaname = 'public' AND tablename = ANY (v_tab))
                 AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%fn\_executie\_revendicare\_%') THEN
    RAISE EXCEPTION '20261224a revenire: alte obiecte depind de tabele / vederi / functii';
  END IF;
  FOREACH t IN ARRAY v_tab LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE NOWAIT', t);
  END LOOP;
  FOREACH t IN ARRAY v_tab LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', t) INTO r;
    IF (r.exists) THEN RAISE EXCEPTION '20261224a revenire: tabelul % are randuri — decizie separata inainte', t; END IF;
  END LOOP;
  -- scoaterea (fără CASCADE): vederile, funcțiile care au în semnătură tipul unui rând (argument / rezultat), tabelele (copiii întâi),
  -- apoi restul funcțiilor
  DROP VIEW public.v_executie_revendicare_termene;
  DROP VIEW public.v_executie_revendicare_acte;
  DROP FUNCTION public.fn_executie_revendicare_act_amprenta(public.executie_revendicare_acte);
  DROP FUNCTION public.fn_executie_revendicare_dosar_blocheaza(bigint, text);
  DROP TABLE public.executie_revendicare_chei;
  DROP TABLE public.executie_revendicare_jurnal;
  DROP TABLE public.executie_revendicare_alerte;
  DROP TABLE public.executie_revendicare_dovezi;
  DROP TABLE public.executie_revendicare_termene;
  DROP TABLE public.executie_revendicare_comunicari;
  DROP TABLE public.executie_revendicare_acte;
  DROP TABLE public.executie_revendicare_repere;
  DROP TABLE public.executie_revendicari;
  FOR r IN SELECT p.oid::regprocedure AS sem FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_revendicare\_%' ORDER BY p.proname LOOP
    EXECUTE format('DROP FUNCTION %s', r.sem);
  END LOOP;
  -- postcondiție
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND (c.relname ~ '^executie_revendicar' OR c.relname ~ '^v_executie_revendicar'))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_revendicare\_%') THEN
    RAISE EXCEPTION '20261224a revenire post: au ramas obiecte';
  END IF;
  PERFORM set_config('gazpet.livrare_migrare', '', true);   -- dezarmare
END $revenire$;
