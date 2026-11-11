-- Revenire 20261206a_meteo_istoric_zilnic. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: vederea v_meteo_zile, funcția fn_meteo_praguri_seteaza, tabelele meteo_istoric_zilnic, meteo_praguri_jurnal și
-- meteo_praguri_nelucrabil (cu politicile lor).
-- REFUZĂ dacă istoricul are rânduri sau dacă pragurile nu mai sunt cele de pornire (versiune > 1): datele meteo preluate și pragurile
-- alese de owner nu se șterg de aici. Golirea lor e o decizie separată (preview -> „da” Răzvan -> apply, cu export înainte).
-- Gestionarul tranzacției e operatorul (fișierul nu are BEGIN / COMMIT). Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261206a', 'SCOATE_METEO_ISTORIC:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261206a SCOATE_METEO_ISTORIC
-- Ordinea lock-urilor: meteo_istoric_zilnic, meteo_praguri_nelucrabil, apoi meteo_praguri_jurnal, toate ACCESS EXCLUSIVE, ÎNAINTEA verificării
-- „gol / neschimbat” (o scriere concurentă din meteo-sync sau din RPC nu poate fi numărată 0 și apoi pierdută la DROP). meteo-sync scrie doar
-- istoricul; RPC-ul ia pragurile, apoi jurnalul (aceeași ordine); vederea citește istoricul și pragurile -> fără ciclu.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează (nimic nu rulează după el), iar harness-ul îi verifică mesajul.
DO $revenire$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261206a', true) IS DISTINCT FROM 'SCOATE_METEO_ISTORIC:' || txid_current() THEN
    RAISE EXCEPTION '20261206a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261206a=%') THEN
    RAISE EXCEPTION '20261206a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261206a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- starea exactă a migrării: cele trei tabele, vederea, funcția (și nimic în plus cu același prefix)
  IF to_regclass('public.meteo_istoric_zilnic') IS NULL OR to_regclass('public.meteo_praguri_nelucrabil') IS NULL
     OR to_regclass('public.meteo_praguri_jurnal') IS NULL OR to_regclass('public.v_meteo_zile') IS NULL
     OR to_regprocedure('public.fn_meteo_praguri_seteaza(integer, numeric, numeric, numeric, numeric)') IS NULL
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_meteo_praguri_seteaza') <> 1 THEN
    RAISE EXCEPTION '20261206a revenire: starea nu e cea lasata de migrare (obiecte lipsa sau in plus)';
  END IF;
  -- ordinea: istoricul, pragurile, jurnalul (RPC-ul ia pragurile, apoi jurnalul → aceeași ordine, fără ciclu)
  LOCK TABLE public.meteo_istoric_zilnic, public.meteo_praguri_nelucrabil, public.meteo_praguri_jurnal IN ACCESS EXCLUSIVE MODE;
  -- nimic altceva nu depinde de obiectele migrării (DROP fără CASCADE ar eșua oricum; refuzul explicit spune de ce)
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
               WHERE d.classid = 'pg_rewrite'::regclass
                 AND d.refobjid IN ('public.meteo_istoric_zilnic'::regclass, 'public.meteo_praguri_nelucrabil'::regclass, 'public.meteo_praguri_jurnal'::regclass, 'public.v_meteo_zile'::regclass)
                 AND w.ev_class NOT IN ('public.v_meteo_zile'::regclass)) THEN
    RAISE EXCEPTION '20261206a revenire: alte vederi depind de obiectele migrarii';
  END IF;
  IF EXISTS (SELECT 1 FROM public.meteo_istoric_zilnic) THEN
    RAISE EXCEPTION '20261206a revenire: tabelul are randuri (istoricul meteo preluat nu se sterge de aici)';
  END IF;
  IF (SELECT count(*) FROM public.meteo_praguri_nelucrabil) <> 1
     OR EXISTS (SELECT 1 FROM public.meteo_praguri_nelucrabil WHERE id <> 1 OR versiune <> 1 OR actualizat_de IS NOT NULL
                  OR precipitatii_mm_min <> 10 OR zapada_cm_min <> 1 OR tmax_sub_c <> 0 OR tmin_max_c <> -5)
     OR (SELECT count(*) FROM public.meteo_praguri_jurnal) <> 1
     OR EXISTS (SELECT 1 FROM public.meteo_praguri_jurnal WHERE versiune <> 1 OR actualizat_de IS NOT NULL) THEN
    RAISE EXCEPTION '20261206a revenire: pragurile au fost schimbate (configuratia aleasa si jurnalul ei nu se sterg de aici)';
  END IF;
  DROP VIEW public.v_meteo_zile;
  DROP FUNCTION public.fn_meteo_praguri_seteaza(integer, numeric, numeric, numeric, numeric);
  DROP TABLE public.meteo_istoric_zilnic;
  DROP TABLE public.meteo_praguri_jurnal;
  DROP TABLE public.meteo_praguri_nelucrabil;
  IF to_regclass('public.meteo_istoric_zilnic') IS NOT NULL OR to_regclass('public.meteo_praguri_nelucrabil') IS NOT NULL
     OR to_regclass('public.meteo_praguri_jurnal') IS NOT NULL OR to_regclass('public.v_meteo_zile') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_meteo_praguri_seteaza') THEN
    RAISE EXCEPTION '20261206a revenire: post — obiecte ramase';
  END IF;
  -- armarea se consumă: o a doua rulare în aceeași tranzacție nu mai e armată
  PERFORM set_config('gazpet.revenire_20261206a', '', true);
END $revenire$;
