-- Revenire 20261216a_executie_raport_rezumat. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: cele 2 trigger-e (trg_raport_zilnic_zz_rezumat pe rapoarte_zilnice, trg_raport_zilnic_salvari_rezumat pe
-- raport_zilnic_salvari), cele 9 funcții fn_raport_rezumat_* (lista exactă, cu amprenta corpului verificată, L15), constrângerea și cele 5 coloane rezumat_*.
-- REFUZĂ dacă există rezumate CORECTATE de om (rezumat_sursa = 'editat'): textul lor ar dispărea în tăcere (golirea = decizie separată,
-- preview -> „da” Răzvan -> export -> apply). Rezumatele AUTOMATE (și codurile rezumat_eroare) se pierd fără refuz: sunt derivate din raport
-- (refăcute de funcție oricând).
-- Rapoartele, liniile și jurnalul salvărilor NU se ating.
-- Gestionarul tranzacției e operatorul (fișierul nu are BEGIN / COMMIT). Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261216a', 'SCOATE_REZUMAT_RAPORT:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261216a SCOATE_REZUMAT_RAPORT
-- Starea EXACTĂ a migrării (r3: și configurația funcțiilor, drepturile lor, starea trigger-elor, definiția CHECK-ului), înainte de orice scoatere.
-- Ordinea lock-urilor (ca RPC-ul de salvare): rapoarte_zilnice, raport_zilnic_salvari — ACCESS EXCLUSIVE NOWAIT, ÎNAINTEA verificării „fără
-- rezumate editate” (o corectură concurentă nu poate fi numărată 0 și apoi pierdută la DROP COLUMN). Ocupat = 55P03, nimic scris.
-- Tot ce ține lock-ul e catalog + căutarea corecturilor (o citire a tabelului, fără scriere); fără plafon de runner (revenirea o trimite
-- operatorul într-un singur string), dar cu lock_timeout 5 s pe orice altă așteptare.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_fn name[] := ARRAY['fn_raport_rezumat_curata', 'fn_raport_rezumat_curata_editat', 'fn_raport_rezumat_taie', 'fn_raport_rezumat_sir',
                             'fn_raport_rezumat_nr', 'fn_raport_rezumat_text', 'fn_raport_rezumat_intrare', 'fn_raport_rezumat_garda',
                             'fn_raport_rezumat_dupa_salvare']::name[];
  v_n integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261216a', true) IS DISTINCT FROM 'SCOATE_REZUMAT_RAPORT:' || txid_current() THEN
    RAISE EXCEPTION '20261216a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261216a=%') THEN
    RAISE EXCEPTION '20261216a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261216a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- starea exactă a migrării: funcțiile (corpul revizuit, DEFINER, proprietar, configurație, drepturi), trigger-ele (forma exactă + activ),
  -- constrângerea (definiția exactă), coloanele
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_raport\_rezumat\_%';
  IF v_n <> 9
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          JOIN (VALUES
            -- AMPRENTE-START
            ('fn_raport_rezumat_curata', 'public.fn_raport_rezumat_curata(text)', '1dc80111035b8102668d5d1e522a0e93'),
            ('fn_raport_rezumat_curata_editat', 'public.fn_raport_rezumat_curata_editat(text)', 'a165c617229ee4843fbd9fd33c26e42f'),
            ('fn_raport_rezumat_taie', 'public.fn_raport_rezumat_taie(text, integer)', '7903b72e96c3ab4617c865805cfe6d6f'),
            ('fn_raport_rezumat_sir', 'public.fn_raport_rezumat_sir(jsonb, text)', '053653a3014609f9a13c4f96b99af586'),
            ('fn_raport_rezumat_nr', 'public.fn_raport_rezumat_nr(jsonb)', '52082fbf3726918e913f1e0dcf30c2e9'),
            ('fn_raport_rezumat_text', 'public.fn_raport_rezumat_text(jsonb)', '8424e32d89ec23ea3eac50d70cbb2df0'),
            ('fn_raport_rezumat_intrare', 'public.fn_raport_rezumat_intrare(public.rapoarte_zilnice)', '9c2aa741a066d78b444972052e5e2148'),
            ('fn_raport_rezumat_garda', 'public.fn_raport_rezumat_garda()', 'a7406ada02921008e03cad7bf055609f'),
            ('fn_raport_rezumat_dupa_salvare', 'public.fn_raport_rezumat_dupa_salvare()', 'c50a62999b1f6f685d5dde349f7c2d6c')
            -- AMPRENTE-END
          ) a(nume, semnatura, amprenta) ON p.oid = to_regprocedure(a.semnatura)
         WHERE n.nspname = 'public' AND md5(replace(p.prosrc, chr(13), '')) = a.amprenta
           AND p.prosecdef = (a.nume = 'fn_raport_rezumat_garda') AND pg_get_userbyid(p.proowner) = 'postgres'
           AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE e.grantee = 0)) <> 9
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.rapoarte_zilnice'::regclass AND tg.tgname = 'trg_raport_zilnic_zz_rezumat'
                     AND tg.tgfoid = to_regprocedure('public.fn_raport_rezumat_garda()') AND tg.tgtype = (1 | 2 | 4 | 16) AND tg.tgqual IS NULL AND tg.tgnargs = 0
                     AND tg.tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.raport_zilnic_salvari'::regclass AND tg.tgname = 'trg_raport_zilnic_salvari_rezumat'
                     AND tg.tgfoid = to_regprocedure('public.fn_raport_rezumat_dupa_salvare()') AND tg.tgtype = (1 | 4) AND tg.tgqual IS NULL AND tg.tgnargs = 0
                     AND tg.tgenabled = 'O')
     OR (SELECT count(*) FROM pg_trigger tg WHERE tg.tgfoid IN (to_regprocedure('public.fn_raport_rezumat_garda()'), to_regprocedure('public.fn_raport_rezumat_dupa_salvare()'))) <> 2
     -- definiția exactă (pg_get_constraintdef); „ NOT VALID” de la capăt e acceptat sau nu (un VALIDATE CONSTRAINT ulterior îl scoate)
     OR (SELECT regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') FROM pg_constraint c
          WHERE c.conrelid = 'public.rapoarte_zilnice'::regclass AND c.conname = 'rapoarte_zilnice_rezumat_ck' AND c.contype = 'c') IS DISTINCT FROM
        -- CHECK-DEF-START
        'CHECK (((((rezumat_sursa IS NULL) AND (rezumat_text IS NULL) AND (rezumat_la IS NULL) AND (rezumat_de IS NULL)) OR ((rezumat_sursa = ''automat''::text) AND (rezumat_text IS NOT NULL) AND (rezumat_la IS NOT NULL) AND (rezumat_de IS NULL)) OR ((rezumat_sursa = ''editat''::text) AND (rezumat_text ~ ''[^[:space:]]''::text) AND (char_length(rezumat_text) <= 4000) AND (rezumat_la IS NOT NULL) AND (rezumat_de IS NOT NULL))) AND ((rezumat_eroare IS NULL) OR (rezumat_eroare ~ ''^[0-9A-Z]{5}$''::text))))'
        -- CHECK-DEF-END
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice'
          AND column_name IN ('rezumat_text', 'rezumat_sursa', 'rezumat_la', 'rezumat_de', 'rezumat_eroare')) <> 5 THEN
    RAISE EXCEPTION '20261216a revenire: starea nu e cea din 20261216a';
  END IF;
  -- nimic altceva nu depinde de coloane / funcții: vederi, politici, alte funcții (dependențe în catalog și apeluri textuale)
  IF EXISTS (SELECT 1 FROM pg_depend d
              WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.rapoarte_zilnice'::regclass
                AND d.refobjsubid IN (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.rapoarte_zilnice'::regclass
                                        AND attname IN ('rezumat_text', 'rezumat_sursa', 'rezumat_la', 'rezumat_de', 'rezumat_eroare'))
                AND NOT (d.classid = 'pg_constraint'::regclass
                         AND d.objid = (SELECT oid FROM pg_constraint WHERE conrelid = 'public.rapoarte_zilnice'::regclass AND conname = 'rapoarte_zilnice_rezumat_ck')))
     OR EXISTS (SELECT 1 FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid
                 WHERE d.classid = 'pg_proc'::regclass AND d.refclassid = 'pg_proc'::regclass
                   AND d.refobjid IN (SELECT p2.oid FROM pg_proc p2 JOIN pg_namespace n2 ON n2.oid = p2.pronamespace
                                       WHERE n2.nspname = 'public' AND p2.proname = ANY (v_fn))
                   AND NOT p.proname = ANY (v_fn))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '\mfn_raport_rezumat_')
     -- apelurile textuale ale funcțiilor (plpgsql nu lasă dependențe în catalog); coloanele: dependențele de mai sus (vederi, SQL, constrângeri)
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND n.nspname !~ '^pg_(toast_)?temp_'   -- funcțiile temporare ale sesiunii (ex. harness-ul) dispar cu ea
                   AND NOT (n.nspname = 'public' AND p.proname = ANY (v_fn))
                   AND p.prosrc ~ '\mfn_raport_rezumat_[a-z_]+\M') THEN
    RAISE EXCEPTION '20261216a revenire: alte obiecte depind de coloanele / functiile rezumatului';
  END IF;
  LOCK TABLE public.rapoarte_zilnice IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.raport_zilnic_salvari IN ACCESS EXCLUSIVE MODE NOWAIT;
  IF EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE rezumat_sursa = 'editat') THEN
    RAISE EXCEPTION '20261216a revenire: exista rezumate corectate de om (rezumat_sursa = editat) — decizie separata inainte';
  END IF;
  -- scoaterea (fără CASCADE): trigger-ele, apoi funcțiile (garda depinde de intrare / text), apoi coloanele
  DROP TRIGGER trg_raport_zilnic_salvari_rezumat ON public.raport_zilnic_salvari;
  DROP TRIGGER trg_raport_zilnic_zz_rezumat ON public.rapoarte_zilnice;
  DROP FUNCTION public.fn_raport_rezumat_dupa_salvare();
  DROP FUNCTION public.fn_raport_rezumat_garda();
  DROP FUNCTION public.fn_raport_rezumat_intrare(public.rapoarte_zilnice);
  DROP FUNCTION public.fn_raport_rezumat_text(jsonb);
  DROP FUNCTION public.fn_raport_rezumat_nr(jsonb);
  DROP FUNCTION public.fn_raport_rezumat_sir(jsonb, text);
  DROP FUNCTION public.fn_raport_rezumat_taie(text, integer);
  DROP FUNCTION public.fn_raport_rezumat_curata_editat(text);
  DROP FUNCTION public.fn_raport_rezumat_curata(text);
  ALTER TABLE public.rapoarte_zilnice
    DROP CONSTRAINT rapoarte_zilnice_rezumat_ck,
    DROP COLUMN rezumat_text, DROP COLUMN rezumat_sursa, DROP COLUMN rezumat_la, DROP COLUMN rezumat_de, DROP COLUMN rezumat_eroare;
  -- postcondiție
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice'
               AND column_name IN ('rezumat_text', 'rezumat_sursa', 'rezumat_la', 'rezumat_de', 'rezumat_eroare'))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_raport\_rezumat\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_raport_zilnic_zz_rezumat', 'trg_raport_zilnic_salvari_rezumat'))
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rapoarte_zilnice_rezumat_ck')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.rapoarte_zilnice'::regclass AND tgname = 'trg_raport_zilnic_versiune') THEN
    RAISE EXCEPTION '20261216a revenire post: au ramas obiecte sau lipseste trigger-ul de versiune (20261208a)';
  END IF;
  PERFORM set_config('gazpet.revenire_20261216a', '', true);   -- dezarmare
END $revenire$;
