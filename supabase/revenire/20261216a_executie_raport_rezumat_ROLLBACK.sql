-- Revenire 20261216a_executie_raport_rezumat. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: cele 2 trigger-e (trg_raport_zilnic_zz_rezumat pe rapoarte_zilnice, trg_raport_zilnic_salvari_rezumat pe
-- raport_zilnic_salvari), cele 8 funcții fn_raport_rezumat_* (lista exactă, cu amprenta corpului verificată, L15), constrângerea și cele 4 coloane rezumat_*.
-- REFUZĂ dacă există rezumate CORECTATE de om (rezumat_sursa = 'editat'): textul lor ar dispărea în tăcere (golirea = decizie separată,
-- preview -> „da” Răzvan -> export -> apply). Rezumatele AUTOMATE se pierd fără refuz: sunt derivate din raport (refăcute de funcție oricând).
-- Rapoartele, liniile și jurnalul salvărilor NU se ating.
-- Gestionarul tranzacției e operatorul (fișierul nu are BEGIN / COMMIT). Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261216a', 'SCOATE_REZUMAT_RAPORT:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261216a SCOATE_REZUMAT_RAPORT
-- Ordinea lock-urilor (ca RPC-ul de salvare): rapoarte_zilnice, raport_zilnic_salvari — ACCESS EXCLUSIVE NOWAIT, ÎNAINTEA verificării „fără
-- rezumate editate” (o corectură concurentă nu poate fi numărată 0 și apoi pierdută la DROP COLUMN). Ocupat = 55P03, nimic scris.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_fn name[] := ARRAY['fn_raport_rezumat_curata', 'fn_raport_rezumat_taie', 'fn_raport_rezumat_sir', 'fn_raport_rezumat_nr',
                             'fn_raport_rezumat_text', 'fn_raport_rezumat_intrare', 'fn_raport_rezumat_garda', 'fn_raport_rezumat_dupa_salvare']::name[];
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
  -- starea exactă a migrării: funcțiile (cu corpul revizuit), trigger-ele (forma exactă), constrângerea, coloanele
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_raport\_rezumat\_%';
  IF v_n <> 8
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          JOIN (VALUES
            -- AMPRENTE-START
            ('fn_raport_rezumat_curata', 'public.fn_raport_rezumat_curata(text)', '1dc80111035b8102668d5d1e522a0e93'),
            ('fn_raport_rezumat_taie', 'public.fn_raport_rezumat_taie(text, integer)', '7903b72e96c3ab4617c865805cfe6d6f'),
            ('fn_raport_rezumat_sir', 'public.fn_raport_rezumat_sir(jsonb, text)', '053653a3014609f9a13c4f96b99af586'),
            ('fn_raport_rezumat_nr', 'public.fn_raport_rezumat_nr(jsonb)', '52082fbf3726918e913f1e0dcf30c2e9'),
            ('fn_raport_rezumat_text', 'public.fn_raport_rezumat_text(jsonb)', '00283f5c3cd80066ba57baab70ab085b'),
            ('fn_raport_rezumat_intrare', 'public.fn_raport_rezumat_intrare(public.rapoarte_zilnice)', '478794ce25a5b838533267d0035259b1'),
            ('fn_raport_rezumat_garda', 'public.fn_raport_rezumat_garda()', '29a1018cde4d7fbcd11f892d658059d0'),
            ('fn_raport_rezumat_dupa_salvare', 'public.fn_raport_rezumat_dupa_salvare()', '7bc75002375853875eda7876413390c6')
            -- AMPRENTE-END
          ) a(nume, semnatura, amprenta) ON p.oid = to_regprocedure(a.semnatura)
         WHERE n.nspname = 'public' AND md5(replace(p.prosrc, chr(13), '')) = a.amprenta
           AND p.prosecdef = (a.nume = 'fn_raport_rezumat_garda') AND pg_get_userbyid(p.proowner) = 'postgres') <> 8
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.rapoarte_zilnice'::regclass AND tg.tgname = 'trg_raport_zilnic_zz_rezumat'
                     AND tg.tgfoid = to_regprocedure('public.fn_raport_rezumat_garda()') AND tg.tgtype = (1 | 2 | 4 | 16) AND tg.tgqual IS NULL AND tg.tgnargs = 0)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.raport_zilnic_salvari'::regclass AND tg.tgname = 'trg_raport_zilnic_salvari_rezumat'
                     AND tg.tgfoid = to_regprocedure('public.fn_raport_rezumat_dupa_salvare()') AND tg.tgtype = (1 | 4) AND tg.tgqual IS NULL AND tg.tgnargs = 0)
     OR (SELECT count(*) FROM pg_trigger tg WHERE tg.tgfoid IN (to_regprocedure('public.fn_raport_rezumat_garda()'), to_regprocedure('public.fn_raport_rezumat_dupa_salvare()'))) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.rapoarte_zilnice'::regclass AND conname = 'rapoarte_zilnice_rezumat_ck')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice'
          AND column_name IN ('rezumat_text', 'rezumat_sursa', 'rezumat_la', 'rezumat_de')) <> 4 THEN
    RAISE EXCEPTION '20261216a revenire: starea nu e cea din 20261216a';
  END IF;
  -- nimic altceva nu depinde de coloane / funcții: vederi, politici, alte funcții (dependențe în catalog și apeluri textuale)
  IF EXISTS (SELECT 1 FROM pg_depend d
              WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.rapoarte_zilnice'::regclass
                AND d.refobjsubid IN (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.rapoarte_zilnice'::regclass
                                        AND attname IN ('rezumat_text', 'rezumat_sursa', 'rezumat_la', 'rezumat_de'))
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
  DROP FUNCTION public.fn_raport_rezumat_curata(text);
  ALTER TABLE public.rapoarte_zilnice
    DROP CONSTRAINT rapoarte_zilnice_rezumat_ck,
    DROP COLUMN rezumat_text, DROP COLUMN rezumat_sursa, DROP COLUMN rezumat_la, DROP COLUMN rezumat_de;
  -- postcondiție
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice'
               AND column_name IN ('rezumat_text', 'rezumat_sursa', 'rezumat_la', 'rezumat_de'))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_raport\_rezumat\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_raport_zilnic_zz_rezumat', 'trg_raport_zilnic_salvari_rezumat'))
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rapoarte_zilnice_rezumat_ck')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.rapoarte_zilnice'::regclass AND tgname = 'trg_raport_zilnic_versiune') THEN
    RAISE EXCEPTION '20261216a revenire post: au ramas obiecte sau lipseste trigger-ul de versiune (20261208a)';
  END IF;
  PERFORM set_config('gazpet.revenire_20261216a', '', true);   -- dezarmare
END $revenire$;
