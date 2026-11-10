-- Revenire 20261207a_executie_noduri_constructii. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: tabelul executie_noduri_constructii (cu trigger-ul, politica, indexurile și CHECK-urile lui) și cele 4 funcții
-- fn_executie_constr_*. NU atinge 20261201a (executie_noduri_suduri, fn_executie_nod_*, storage).
-- REFUZĂ dacă tabelul are rânduri: lista elementelor și etapele bifate nu se șterg de aici (decizie separată: preview -> „da” Răzvan -> apply,
-- cu export înainte).
-- Gestionarul tranzacției e operatorul (fișierul nu are BEGIN / COMMIT). Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261207a', 'SCOATE_NODURI_CONSTRUCTII:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261207a SCOATE_NODURI_CONSTRUCTII
-- Lock: tabelul, ACCESS EXCLUSIVE NOWAIT (ocupat = 55P03, nimic scris), ÎNAINTEA verificării „gol” (un INSERT concurent nu poate fi numărat 0
-- și apoi pierdut la DROP). RPC-ul blochează doar un rând al tabelului -> fără ciclu.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează (nimic nu rulează după el), iar harness-ul îi verifică mesajul.
-- Ordinea revenirilor: 20261207a ÎNAINTEA lui 20261201a (politica tabelului folosește fn_executie_nod_drept; revenirea 20261201a refuză cât timp
-- tabelul de aici există).
DO $revenire$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261207a', true) IS DISTINCT FROM 'SCOATE_NODURI_CONSTRUCTII:' || txid_current() THEN
    RAISE EXCEPTION '20261207a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261207a=%') THEN
    RAISE EXCEPTION '20261207a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261207a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- starea exactă a migrării: tabelul, cele 4 funcții, trigger-ul, politica
  IF to_regclass('public.executie_noduri_constructii') IS NULL
     OR to_regprocedure('public.fn_executie_constr_etape_valide(text[])') IS NULL
     OR to_regprocedure('public.fn_executie_constr_bifari_valide(text[], date[], uuid[], timestamptz[])') IS NULL
     OR to_regprocedure('public.fn_executie_constr_provenienta()') IS NULL
     OR to_regprocedure('public.fn_executie_constr_etapa(bigint, integer, text, text, date, text, uuid)') IS NULL
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_constr\_%') <> 4
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.executie_noduri_constructii'::regclass AND tgname = 'trg_executie_constr_provenienta')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_noduri_constructii' AND policyname = 'executie_noduri_constructii_citire') THEN
    RAISE EXCEPTION '20261207a revenire: starea nu e cea din 20261207a';
  END IF;
  -- nimic altceva nu depinde de tabel sau de funcții (vederi / reguli, FK-uri spre tabel, politici ale altor tabele)
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
              WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = 'public.executie_noduri_constructii'::regclass)
     OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.confrelid = 'public.executie_noduri_constructii'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE NOT (schemaname = 'public' AND tablename = 'executie_noduri_constructii')
                 AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%fn\_executie\_constr\_%') THEN
    RAISE EXCEPTION '20261207a revenire: alte obiecte depind de tabel / functii';
  END IF;
  LOCK TABLE public.executie_noduri_constructii IN ACCESS EXCLUSIVE MODE NOWAIT;
  IF EXISTS (SELECT 1 FROM public.executie_noduri_constructii) THEN
    RAISE EXCEPTION '20261207a revenire: tabelul are randuri (lista elementelor / etapele bifate) — decizie separata inainte';
  END IF;
  -- scoaterea (fără CASCADE): tabelul întâi (CHECK-urile și trigger-ul lui folosesc funcțiile)
  DROP TABLE public.executie_noduri_constructii;   -- cu trigger-ul, politica, indexurile și CHECK-urile lui
  DROP FUNCTION public.fn_executie_constr_etapa(bigint, integer, text, text, date, text, uuid);
  DROP FUNCTION public.fn_executie_constr_provenienta();
  DROP FUNCTION public.fn_executie_constr_bifari_valide(text[], date[], uuid[], timestamptz[]);
  DROP FUNCTION public.fn_executie_constr_etape_valide(text[]);
  -- postcondiție
  IF to_regclass('public.executie_noduri_constructii') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_constr\_%')
     OR to_regprocedure('public.fn_executie_nod_drept(bigint, boolean)') IS NULL THEN
    RAISE EXCEPTION '20261207a revenire post: au ramas obiecte (sau a disparut dreptul din 20261201a)';
  END IF;
  PERFORM set_config('gazpet.revenire_20261207a', '', true);   -- dezarmare
END $revenire$;
