-- Revenire 20261201a_executie_noduri_suduri. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: tabelul executie_noduri_suduri (cu trigger-ul și politica lui), cele 6 funcții fn_executie_nod_*,
-- politica noduri_scheme_citire de pe storage.objects și bucket-ul noduri-scheme.
-- REFUZĂ dacă tabelul are rânduri sau bucket-ul are fișiere: datele (lista sudurilor, stările bifate, imaginile schemei) nu se șterg de aici.
-- Golirea lor e o decizie separată (preview -> „da” Răzvan -> apply, cu export înainte).
-- Gestionarul tranzacției e operatorul (fișierul nu are BEGIN / COMMIT). Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261201a', 'SCOATE_NODURI_SUDURI:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261201a SCOATE_NODURI_SUDURI
-- Ordinea lock-urilor: storage.objects, apoi executie_noduri_suduri, ambele ACCESS EXCLUSIVE, ÎNAINTEA verificării „gol” (un INSERT /
-- upload concurent nu poate fi numărat 0 și apoi pierdut la DROP). Aceeași ordine ca o citire din Storage (objects, apoi tabelul, prin
-- politica noduri_scheme_citire); RPC-ul blochează doar tabelul -> fără ciclu.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261201a', true) IS DISTINCT FROM 'SCOATE_NODURI_SUDURI:' || txid_current() THEN
    RAISE EXCEPTION '20261201a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261201a=%') THEN
    RAISE EXCEPTION '20261201a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261201a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- starea exactă a migrării: tabelul, cele 6 funcții, trigger-ul, politica storage, bucket-ul
  IF to_regclass('public.executie_noduri_suduri') IS NULL
     OR to_regprocedure('public.fn_executie_nod_drept(bigint, boolean)') IS NULL
     OR to_regprocedure('public.fn_executie_nod_tranzitie(text, text)') IS NULL
     OR to_regprocedure('public.fn_executie_nod_sudura_provenienta()') IS NULL
     OR to_regprocedure('public.fn_executie_nod_sudura_stare(bigint, text, integer, text, date, text, text, text, uuid)') IS NULL
     OR to_regprocedure('public.fn_executie_nod_obiect_citire(text, text)') IS NULL
     OR to_regprocedure('public.fn_executie_nod_pozitii_valide(jsonb, text)') IS NULL
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_nod\_%') <> 6
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.executie_noduri_suduri'::regclass AND tgname = 'trg_executie_nod_sudura_provenienta')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'noduri_scheme_citire')
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'noduri-scheme') THEN
    RAISE EXCEPTION '20261201a revenire: starea nu e cea din 20261201a';
  END IF;
  -- nimic altceva nu depinde de tabel sau de funcții (vederi, alte funcții / politici)
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
              WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = 'public.executie_noduri_suduri'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE NOT (schemaname = 'public' AND tablename = 'executie_noduri_suduri')
                 AND policyname <> 'noduri_scheme_citire'
                 AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%fn\_executie\_nod\_%') THEN
    RAISE EXCEPTION '20261201a revenire: alte obiecte depind de tabel / functii';
  END IF;
  LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.executie_noduri_suduri IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.executie_noduri_suduri) THEN
    RAISE EXCEPTION '20261201a revenire: tabelul are randuri (lista sudurilor / starile) — decizie separata inainte';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'noduri-scheme') THEN
    RAISE EXCEPTION '20261201a revenire: bucket-ul noduri-scheme are fisiere — decizie separata inainte';
  END IF;
END $pre$;

DROP POLICY noduri_scheme_citire ON storage.objects;
SELECT set_config('storage.allow_delete_query', 'true', true);   -- doar dacă versiunea Storage are garda protect_delete (bucket-ul e gol, verificat sus)
DELETE FROM storage.buckets WHERE id = 'noduri-scheme';
DROP TABLE public.executie_noduri_suduri;   -- cu trigger-ul, politica și indexurile lui; fără CASCADE
DROP FUNCTION public.fn_executie_nod_sudura_stare(bigint, text, integer, text, date, text, text, text, uuid);
DROP FUNCTION public.fn_executie_nod_obiect_citire(text, text);
DROP FUNCTION public.fn_executie_nod_sudura_provenienta();
DROP FUNCTION public.fn_executie_nod_tranzitie(text, text);
DROP FUNCTION public.fn_executie_nod_drept(bigint, boolean);
DROP FUNCTION public.fn_executie_nod_pozitii_valide(jsonb, text);

DO $post$
BEGIN
  IF to_regclass('public.executie_noduri_suduri') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_nod\_%')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'noduri_scheme_citire')
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'noduri-scheme') THEN
    RAISE EXCEPTION '20261201a revenire post: au ramas obiecte';
  END IF;
  PERFORM set_config('gazpet.revenire_20261201a', '', true);   -- dezarmare
END $post$;
