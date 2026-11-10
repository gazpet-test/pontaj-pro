-- Revenire 20261204a_executie_grafic. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: tabelele executie_grafic_activitati și executie_grafic_revizii (cu politicile și indexurile lor)
-- și cele 6 funcții fn_executie_grafic_*.
-- REFUZĂ dacă oricare tabel are rânduri: reviziile importate nu se șterg de aici. Golirea lor e o decizie separată
-- (preview -> „da” Răzvan -> apply, cu export înainte).
-- Gestionarul tranzacției e operatorul (fișierul nu are BEGIN / COMMIT). Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261204a', 'SCOATE_GRAFIC:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261204a SCOATE_GRAFIC
-- Ordinea lock-urilor: executie_grafic_revizii, apoi executie_grafic_activitati, ambele ACCESS EXCLUSIVE, ÎNAINTEA verificării „gol”
-- (un import concurent nu poate fi numărat 0 și apoi pierdut la DROP). Aceeași ordine ca importul (revizii, apoi activitati) -> fără ciclu.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează (nimic nu rulează după el), iar harness-ul îi verifică mesajul.
DO $revenire$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261204a', true) IS DISTINCT FROM 'SCOATE_GRAFIC:' || txid_current() THEN
    RAISE EXCEPTION '20261204a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261204a=%') THEN
    RAISE EXCEPTION '20261204a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261204a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- starea exactă a migrării: cele 2 tabele și cele 6 funcții
  IF to_regclass('public.executie_grafic_revizii') IS NULL OR to_regclass('public.executie_grafic_activitati') IS NULL
     OR to_regprocedure('public.fn_executie_grafic_drept(bigint)') IS NULL
     OR to_regprocedure('public.fn_executie_grafic_importa(jsonb, boolean)') IS NULL
     OR to_regprocedure('public.fn_executie_grafic_j_text(jsonb, text, integer, boolean)') IS NULL
     OR to_regprocedure('public.fn_executie_grafic_j_numar(jsonb, text, numeric, numeric, integer, boolean)') IS NULL
     OR to_regprocedure('public.fn_executie_grafic_j_data(jsonb, text)') IS NULL
     OR to_regprocedure('public.fn_executie_grafic_j_bool(jsonb, text)') IS NULL
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname IN ('fn_executie_grafic_drept', 'fn_executie_grafic_importa', 'fn_executie_grafic_j_text',
                                                      'fn_executie_grafic_j_numar', 'fn_executie_grafic_j_data', 'fn_executie_grafic_j_bool')) <> 6 THEN
    RAISE EXCEPTION '20261204a revenire: starea nu e cea din 20261204a';
  END IF;
  -- nimic altceva nu depinde de tabele sau de funcții (vederi, FK din alte tabele, alte politici / funcții)
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
              WHERE d.classid = 'pg_rewrite'::regclass
                AND d.refobjid IN ('public.executie_grafic_revizii'::regclass, 'public.executie_grafic_activitati'::regclass))
     OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype = 'f'
                 AND c.confrelid IN ('public.executie_grafic_revizii'::regclass, 'public.executie_grafic_activitati'::regclass)
                 AND c.conrelid NOT IN ('public.executie_grafic_activitati'::regclass))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE NOT (schemaname = 'public' AND tablename IN ('executie_grafic_revizii', 'executie_grafic_activitati'))
                 AND strpos(coalesce(qual, '') || coalesce(with_check, ''), 'fn_executie_grafic_') > 0)
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname NOT IN ('fn_executie_grafic_drept', 'fn_executie_grafic_importa', 'fn_executie_grafic_j_text',
                                                                  'fn_executie_grafic_j_numar', 'fn_executie_grafic_j_data', 'fn_executie_grafic_j_bool')
                   AND (strpos(p.prosrc, 'executie_grafic_') > 0)) THEN
    RAISE EXCEPTION '20261204a revenire: alte obiecte depind de tabele / functii';
  END IF;
  LOCK TABLE public.executie_grafic_revizii IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.executie_grafic_activitati IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.executie_grafic_revizii) OR EXISTS (SELECT 1 FROM public.executie_grafic_activitati) THEN
    RAISE EXCEPTION '20261204a revenire: tabelele au randuri (revizii importate) — decizie separata inainte';
  END IF;
  -- scoaterea (fără CASCADE)
  DROP TABLE public.executie_grafic_activitati;   -- cu politica, indexurile și FK-ul ei
  DROP TABLE public.executie_grafic_revizii;
  DROP FUNCTION public.fn_executie_grafic_importa(jsonb, boolean);
  DROP FUNCTION public.fn_executie_grafic_j_text(jsonb, text, integer, boolean);
  DROP FUNCTION public.fn_executie_grafic_j_numar(jsonb, text, numeric, numeric, integer, boolean);
  DROP FUNCTION public.fn_executie_grafic_j_data(jsonb, text);
  DROP FUNCTION public.fn_executie_grafic_j_bool(jsonb, text);
  DROP FUNCTION public.fn_executie_grafic_drept(bigint);
  -- postcondiție
  IF to_regclass('public.executie_grafic_revizii') IS NOT NULL OR to_regclass('public.executie_grafic_activitati') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname IN ('fn_executie_grafic_drept', 'fn_executie_grafic_importa', 'fn_executie_grafic_j_text',
                                                             'fn_executie_grafic_j_numar', 'fn_executie_grafic_j_data', 'fn_executie_grafic_j_bool')) THEN
    RAISE EXCEPTION '20261204a revenire post: au ramas obiecte';
  END IF;
  PERFORM set_config('gazpet.revenire_20261204a', '', true);   -- dezarmare
END $revenire$;
