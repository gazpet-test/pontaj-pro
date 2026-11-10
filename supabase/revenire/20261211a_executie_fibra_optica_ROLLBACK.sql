-- Revenire 20261211a_executie_fibra_optica. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: tabelele executie_fibra_jurnal, executie_fibra_intervale, executie_fibra_camerete (cu trigger-ele,
-- politicile, indexurile și constrângerile lor), trigger-ul trg_executie_fibra_garda_tronson de pe executie_tronsoane și cele 13
-- funcții fn_executie_fibra_*.
-- REFUZĂ dacă oricare tabel are rânduri: cameretele, raportările și jurnalul nu se șterg de aici. Golirea lor e o decizie separată
-- (preview -> „da” Răzvan -> apply, cu export înainte).
-- Gestionarul tranzacției e operatorul (fișierul nu are BEGIN / COMMIT). Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261211a', 'SCOATE_FIBRA_OPTICA:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261211a SCOATE_FIBRA_OPTICA
-- Lock-urile se iau TOATE cu NOWAIT (contenție = refuz „folosite chiar acum”, nu așteptare -> fără cicluri cu RPC-urile), ÎNAINTEA
-- verificării „gol” (un INSERT concurent nu poate fi numărat 0 și apoi pierdut la DROP), în aceeași ordine ca RPC-urile:
--   executie_proiecte SHARE ROW EXCLUSIVE (părinte prin FK; DROP-ul îl cere pentru trigger-ele FK) -> executie_tronsoane ACCESS EXCLUSIVE
--   (DROP TRIGGER pe ea; RPC-urile blochează întâi rândul tronsonului) -> camerete -> intervale -> jurnal, ACCESS EXCLUSIVE.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează (nimic nu rulează după el), iar harness-ul îi verifică mesajul.
DO $revenire$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261211a', true) IS DISTINCT FROM 'SCOATE_FIBRA_OPTICA:' || txid_current() THEN
    RAISE EXCEPTION '20261211a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261211a=%') THEN
    RAISE EXCEPTION '20261211a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261211a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- starea exactă a migrării: cele 3 tabele, cele 13 funcții, cele 3 trigger-e proprii + garda de pe executie_tronsoane (funcția și tipul exact)
  IF to_regclass('public.executie_fibra_camerete') IS NULL OR to_regclass('public.executie_fibra_intervale') IS NULL
     OR to_regclass('public.executie_fibra_jurnal') IS NULL
     OR to_regprocedure('public.fn_executie_fibra_drept(bigint, boolean)') IS NULL
     OR to_regprocedure('public.fn_executie_fibra_owner()') IS NULL
     OR to_regprocedure('public.fn_executie_fibra_etapa_anterioara(text)') IS NULL
     OR to_regprocedure('public.fn_executie_fibra_cam_tranzitie(text, text)') IS NULL
     OR to_regprocedure('public.fn_executie_fibra_km(integer)') IS NULL
     OR to_regprocedure('public.fn_executie_fibra_reguli_interval()') IS NULL
     OR to_regprocedure('public.fn_executie_fibra_reguli_camereta()') IS NULL
     OR to_regprocedure('public.fn_executie_fibra_prov_jurnal()') IS NULL
     OR to_regprocedure('public.fn_executie_fibra_garda_tronson()') IS NULL
     OR to_regprocedure('public.fn_executie_fibra_raporteaza(bigint, bigint, text, integer, integer, date, text, uuid)') IS NULL
     OR to_regprocedure('public.fn_executie_fibra_anuleaza(bigint, text, uuid)') IS NULL
     OR to_regprocedure('public.fn_executie_fibra_camereta_adauga(bigint, bigint, text, integer, boolean, date, text, uuid)') IS NULL
     OR to_regprocedure('public.fn_executie_fibra_camereta_stare(bigint, integer, text, date, text, uuid)') IS NULL
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND starts_with(p.proname, 'fn_executie_fibra_')) <> 13
     OR (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
          AND tgrelid IN ('public.executie_fibra_camerete'::regclass, 'public.executie_fibra_intervale'::regclass, 'public.executie_fibra_jurnal'::regclass)) <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.executie_tronsoane'::regclass AND tgname = 'trg_executie_fibra_garda_tronson'
                     AND NOT tgisinternal AND tgfoid = 'public.fn_executie_fibra_garda_tronson()'::regprocedure AND tgtype = 19 AND tgqual IS NULL AND tgnargs = 0)
     OR (SELECT count(*) FROM pg_trigger WHERE tgfoid = 'public.fn_executie_fibra_garda_tronson()'::regprocedure) <> 1 THEN
    RAISE EXCEPTION '20261211a revenire: starea nu e cea din 20261211a';
  END IF;
  -- nimic altceva nu depinde de tabele sau de funcții (vederi, FK-uri din alte tabele, alte politici, alte trigger-e pe funcțiile noastre)
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
              WHERE d.classid = 'pg_rewrite'::regclass
                AND d.refobjid IN ('public.executie_fibra_camerete'::regclass, 'public.executie_fibra_intervale'::regclass, 'public.executie_fibra_jurnal'::regclass))
     OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype = 'f'
                 AND c.confrelid IN ('public.executie_fibra_camerete'::regclass, 'public.executie_fibra_intervale'::regclass, 'public.executie_fibra_jurnal'::regclass)
                 AND c.conrelid NOT IN ('public.executie_fibra_camerete'::regclass, 'public.executie_fibra_intervale'::regclass, 'public.executie_fibra_jurnal'::regclass))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE tablename NOT IN ('executie_fibra_camerete', 'executie_fibra_intervale', 'executie_fibra_jurnal')
                 AND strpos(coalesce(qual, '') || coalesce(with_check, ''), 'fn_executie_fibra_') > 0)
     OR EXISTS (SELECT 1 FROM pg_depend d JOIN pg_proc p ON p.oid = d.refobjid
                 WHERE d.refclassid = 'pg_proc'::regclass AND starts_with(p.proname, 'fn_executie_fibra_')
                   AND d.classid = 'pg_rewrite'::regclass) THEN
    RAISE EXCEPTION '20261211a revenire: alte obiecte depind de tabele / functii';
  END IF;
  -- NOWAIT pe toate: revenirea nu așteaptă niciodată. Contenție = refuz controlat, nimic scos; se reia când nimeni nu scrie.
  BEGIN
    LOCK TABLE public.executie_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.executie_tronsoane IN ACCESS EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.executie_fibra_camerete IN ACCESS EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.executie_fibra_intervale IN ACCESS EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.executie_fibra_jurnal IN ACCESS EXCLUSIVE MODE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION '20261211a revenire: tabelele sunt folosite chiar acum (lock indisponibil) — nimic scos, reincearca' USING ERRCODE = '55P03';
  END;
  IF EXISTS (SELECT 1 FROM public.executie_fibra_camerete) OR EXISTS (SELECT 1 FROM public.executie_fibra_intervale)
     OR EXISTS (SELECT 1 FROM public.executie_fibra_jurnal) THEN
    RAISE EXCEPTION '20261211a revenire: tabelele au randuri (camerete / raportari / jurnal) — decizie separata inainte';
  END IF;
  -- scoaterea (fără CASCADE): garda de pe tronsoane, apoi copiii întâi
  DROP TRIGGER trg_executie_fibra_garda_tronson ON public.executie_tronsoane;
  DROP TABLE public.executie_fibra_jurnal;       -- cu trigger-ul, politica și indexurile lui
  DROP TABLE public.executie_fibra_intervale;
  DROP TABLE public.executie_fibra_camerete;
  DROP FUNCTION public.fn_executie_fibra_camereta_stare(bigint, integer, text, date, text, uuid);
  DROP FUNCTION public.fn_executie_fibra_camereta_adauga(bigint, bigint, text, integer, boolean, date, text, uuid);
  DROP FUNCTION public.fn_executie_fibra_anuleaza(bigint, text, uuid);
  DROP FUNCTION public.fn_executie_fibra_raporteaza(bigint, bigint, text, integer, integer, date, text, uuid);
  DROP FUNCTION public.fn_executie_fibra_garda_tronson();
  DROP FUNCTION public.fn_executie_fibra_prov_jurnal();
  DROP FUNCTION public.fn_executie_fibra_reguli_camereta();
  DROP FUNCTION public.fn_executie_fibra_reguli_interval();
  DROP FUNCTION public.fn_executie_fibra_km(integer);
  DROP FUNCTION public.fn_executie_fibra_cam_tranzitie(text, text);
  DROP FUNCTION public.fn_executie_fibra_etapa_anterioara(text);
  DROP FUNCTION public.fn_executie_fibra_owner();
  DROP FUNCTION public.fn_executie_fibra_drept(bigint, boolean);
  -- postcondiție
  IF to_regclass('public.executie_fibra_camerete') IS NOT NULL OR to_regclass('public.executie_fibra_intervale') IS NOT NULL
     OR to_regclass('public.executie_fibra_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND starts_with(p.proname, 'fn_executie_fibra_'))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_executie_fibra_garda_tronson') THEN
    RAISE EXCEPTION '20261211a revenire post: au ramas obiecte';
  END IF;
  PERFORM set_config('gazpet.revenire_20261211a', '', true);   -- dezarmare
END $revenire$;
