-- Revenire 20261203a_executie_contract_repere. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: tabelele executie_contract_repere (cu trigger-ul, politica și indexurile lui) și executie_contract_repere_chei,
-- plus cele 3 funcții fn_executie_contract_*.
-- REFUZĂ dacă oricare tabel are rânduri: fișa contractului (inclusiv rândurile arhivate) și jurnalul cheilor nu se șterg de aici. Golirea ei e o decizie separată
-- (preview -> „da” Răzvan -> apply, cu export înainte).
-- Gestionarul tranzacției e operatorul (fișierul nu are BEGIN / COMMIT). Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261203a', 'SCOATE_CONTRACT_REPERE:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261203a SCOATE_CONTRACT_REPERE
-- Ordinea lock-urilor: executie_contract_repere, apoi executie_contract_repere_chei, ambele ACCESS EXCLUSIVE, ÎNAINTEA verificării „gol”
-- (un RPC concurent nu poate scrie un rând numărat 0 și apoi pierdut la DROP). Aceeași ordine ca RPC-ul (rândul, apoi cheia); aici nu se
-- ia niciun advisory -> fără ciclu.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează (nimic nu rulează după el), iar harness-ul îi verifică mesajul.
DO $revenire$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261203a', true) IS DISTINCT FROM 'SCOATE_CONTRACT_REPERE:' || txid_current() THEN
    RAISE EXCEPTION '20261203a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261203a=%') THEN
    RAISE EXCEPTION '20261203a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261203a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- starea exactă a migrării: tabelul, cele 3 funcții, trigger-ul
  IF to_regclass('public.executie_contract_repere') IS NULL OR to_regclass('public.executie_contract_repere_chei') IS NULL
     OR to_regprocedure('public.fn_executie_contract_drept(bigint, boolean)') IS NULL
     OR to_regprocedure('public.fn_executie_contract_provenienta()') IS NULL
     OR to_regprocedure('public.fn_executie_contract_salveaza(bigint, bigint, integer, jsonb, uuid)') IS NULL
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_contract\_%') <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.executie_contract_repere'::regclass AND tgname = 'trg_executie_contract_provenienta') THEN
    RAISE EXCEPTION '20261203a revenire: starea nu e cea din 20261203a';
  END IF;
  -- nimic altceva nu depinde de tabel sau de funcții (vederi, alte politici, FK spre tabel)
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
              WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = 'public.executie_contract_repere'::regclass)
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE confrelid IN ('public.executie_contract_repere'::regclass, 'public.executie_contract_repere_chei'::regclass)
                 AND conrelid <> 'public.executie_contract_repere_chei'::regclass)
     OR EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
                 WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = 'public.executie_contract_repere_chei'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE NOT (schemaname = 'public' AND tablename = 'executie_contract_repere')
                 AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%fn\_executie\_contract\_%') THEN
    RAISE EXCEPTION '20261203a revenire: alte obiecte depind de tabel / functii';
  END IF;
  LOCK TABLE public.executie_contract_repere IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.executie_contract_repere_chei IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.executie_contract_repere) OR EXISTS (SELECT 1 FROM public.executie_contract_repere_chei) THEN
    RAISE EXCEPTION '20261203a revenire: tabelul are randuri (fisa contractului / jurnalul cheilor) — decizie separata inainte';
  END IF;
  -- scoaterea (fără CASCADE)
  DROP TABLE public.executie_contract_repere_chei;   -- întâi tabelul care are FK spre fișă
  DROP TABLE public.executie_contract_repere;        -- cu trigger-ul, politica și indexurile lui
  DROP FUNCTION public.fn_executie_contract_salveaza(bigint, bigint, integer, jsonb, uuid);
  DROP FUNCTION public.fn_executie_contract_provenienta();
  DROP FUNCTION public.fn_executie_contract_drept(bigint, boolean);
  -- postcondiție
  IF to_regclass('public.executie_contract_repere') IS NOT NULL OR to_regclass('public.executie_contract_repere_chei') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_contract\_%') THEN
    RAISE EXCEPTION '20261203a revenire post: au ramas obiecte';
  END IF;
  PERFORM set_config('gazpet.revenire_20261203a', '', true);   -- dezarmare
END $revenire$;
