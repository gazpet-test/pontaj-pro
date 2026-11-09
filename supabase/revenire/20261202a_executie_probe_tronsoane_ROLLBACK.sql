-- Revenire 20261202a_executie_probe_tronsoane. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: tabelele executie_probe_jurnal, executie_probe_etape, executie_probe_tronsoane (cu trigger-ele,
-- politicile, indexurile și constrângerile lor, inclusiv FK-ul spre probe_calcule) și cele 7 funcții fn_executie_proba_*.
-- REFUZĂ dacă oricare tabel are rânduri: tronsoanele de probă, etapele și jurnalul nu se șterg de aici. Golirea lor e o decizie
-- separată (preview -> „da” Răzvan -> apply, cu export înainte).
-- Gestionarul tranzacției e operatorul (fișierul nu are BEGIN / COMMIT). Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261202a', 'SCOATE_PROBE_TRONSOANE:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261202a SCOATE_PROBE_TRONSOANE
-- Ordinea lock-urilor, ÎNAINTEA verificării „gol” (un INSERT concurent nu poate fi numărat 0 și apoi pierdut la DROP):
--   1. părinții referiți prin FK, SHARE ROW EXCLUSIVE (executie_proiecte, probe_calcule): DROP-ul le cere oricum acest lock pentru
--      trigger-ele FK; luat primul, un DELETE concurent din modulul Probe (care ar atinge apoi etapele prin ON DELETE SET NULL)
--      așteaptă după noi în loc să formeze un ciclu;
--   2. executie_probe_tronsoane -> executie_probe_etape -> executie_probe_jurnal, ACCESS EXCLUSIVE — aceeași ordine ca RPC-urile
--      (tronson -> etapă -> jurnal) -> fără ciclu.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează (nimic nu rulează după el), iar harness-ul îi verifică mesajul.
DO $revenire$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261202a', true) IS DISTINCT FROM 'SCOATE_PROBE_TRONSOANE:' || txid_current() THEN
    RAISE EXCEPTION '20261202a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261202a=%') THEN
    RAISE EXCEPTION '20261202a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261202a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- starea exactă a migrării: cele 3 tabele, cele 7 funcții, cele 3 trigger-e
  IF to_regclass('public.executie_probe_tronsoane') IS NULL OR to_regclass('public.executie_probe_etape') IS NULL
     OR to_regclass('public.executie_probe_jurnal') IS NULL
     OR to_regprocedure('public.fn_executie_proba_tranzitie(text, text)') IS NULL
     OR to_regprocedure('public.fn_executie_proba_prov_tronson()') IS NULL
     OR to_regprocedure('public.fn_executie_proba_prov_etapa()') IS NULL
     OR to_regprocedure('public.fn_executie_proba_prov_jurnal()') IS NULL
     OR to_regprocedure('public.fn_executie_proba_salveaza(bigint, bigint, integer, text, integer, integer, text, text, uuid)') IS NULL
     OR to_regprocedure('public.fn_executie_proba_anuleaza(bigint, integer, text, uuid)') IS NULL
     OR to_regprocedure('public.fn_executie_proba_etapa(bigint, text, integer, text, date, integer, numeric, text, text, numeric, numeric, numeric, bigint, text, text, text, uuid)') IS NULL
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_proba\_%') <> 7
     OR (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
          AND tgrelid IN ('public.executie_probe_tronsoane'::regclass, 'public.executie_probe_etape'::regclass, 'public.executie_probe_jurnal'::regclass)) <> 3 THEN
    RAISE EXCEPTION '20261202a revenire: starea nu e cea din 20261202a';
  END IF;
  -- nimic altceva nu depinde de tabele sau de funcții (vederi, FK-uri din alte tabele, alte politici)
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
              WHERE d.classid = 'pg_rewrite'::regclass
                AND d.refobjid IN ('public.executie_probe_tronsoane'::regclass, 'public.executie_probe_etape'::regclass, 'public.executie_probe_jurnal'::regclass))
     OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype = 'f'
                 AND c.confrelid IN ('public.executie_probe_tronsoane'::regclass, 'public.executie_probe_etape'::regclass, 'public.executie_probe_jurnal'::regclass)
                 AND c.conrelid NOT IN ('public.executie_probe_tronsoane'::regclass, 'public.executie_probe_etape'::regclass, 'public.executie_probe_jurnal'::regclass))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE tablename NOT IN ('executie_probe_tronsoane', 'executie_probe_etape', 'executie_probe_jurnal')
                 AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%fn\_executie\_proba\_%') THEN
    RAISE EXCEPTION '20261202a revenire: alte obiecte depind de tabele / functii';
  END IF;
  LOCK TABLE public.executie_proiecte, public.probe_calcule IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.executie_probe_tronsoane IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.executie_probe_etape IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.executie_probe_jurnal IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.executie_probe_tronsoane) OR EXISTS (SELECT 1 FROM public.executie_probe_etape)
     OR EXISTS (SELECT 1 FROM public.executie_probe_jurnal) THEN
    RAISE EXCEPTION '20261202a revenire: tabelele au randuri (tronsoane de proba / etape / jurnal) — decizie separata inainte';
  END IF;
  -- scoaterea (fără CASCADE): copiii întâi
  DROP TABLE public.executie_probe_jurnal;      -- cu trigger-ul, politica și indexurile lui
  DROP TABLE public.executie_probe_etape;       -- cu FK-ul spre probe_calcule
  DROP TABLE public.executie_probe_tronsoane;
  DROP FUNCTION public.fn_executie_proba_etapa(bigint, text, integer, text, date, integer, numeric, text, text, numeric, numeric, numeric, bigint, text, text, text, uuid);
  DROP FUNCTION public.fn_executie_proba_anuleaza(bigint, integer, text, uuid);
  DROP FUNCTION public.fn_executie_proba_salveaza(bigint, bigint, integer, text, integer, integer, text, text, uuid);
  DROP FUNCTION public.fn_executie_proba_prov_jurnal();
  DROP FUNCTION public.fn_executie_proba_prov_etapa();
  DROP FUNCTION public.fn_executie_proba_prov_tronson();
  DROP FUNCTION public.fn_executie_proba_tranzitie(text, text);
  -- postcondiție
  IF to_regclass('public.executie_probe_tronsoane') IS NOT NULL OR to_regclass('public.executie_probe_etape') IS NOT NULL
     OR to_regclass('public.executie_probe_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_proba\_%')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.probe_calcule'::regclass AND contype = 'f' AND conname LIKE 'executie\_probe\_%')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE confrelid = 'public.probe_calcule'::regclass AND conname LIKE 'executie\_probe\_%') THEN
    RAISE EXCEPTION '20261202a revenire post: au ramas obiecte';
  END IF;
  PERFORM set_config('gazpet.revenire_20261202a', '', true);   -- dezarmare
END $revenire$;
