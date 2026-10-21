-- 20261103a — HR «Citește orice»: proveniența documentului din dosar devine STRUCTURALĂ (decizia owner 21.10.2026, varianta A).
-- De ce: confirmHR (src/CitesteOricePanel.jsx) marca documentul inserat din rândul #N al cozii ai_documente_inbox cu textul
-- „[Citește orice #N]” în observații și îl căuta cu LIKE. Observațiile se editează liber din dosar (TabDocumentePersonale),
-- deci eticheta se putea pierde / altera, iar între ultima verificare și INSERT rămânea o fereastră (două taburi pe același rând
-- → două documente). Acum:
--   1. hr_documente_personale.sursa_inbox_id bigint NULL = id-ul rândului din ai_documente_inbox din care s-a salvat documentul.
--      FĂRĂ FK spre ai_documente_inbox: rândurile din coadă se pot șterge de owner (politica ai_inbox_delete), iar proveniența
--      trebuie să rămână. NULL = document venit pe alt drum (Drive import, încărcare manuală, wizard angajat nou).
--   2. index unic parțial (sursa_inbox_id) WHERE NOT NULL: un rând din coadă creează cel mult UN document în dosar, atomic
--      (închide cursa celor două taburi: al doilea INSERT cade cu 23505, UI-ul îl tratează ca „deja salvat din acest rând”).
--      Contează și documentele șterse logic (deleted_at): o copie ștearsă din dosar se poate restaura din Coș, deci rândul
--      ei din coadă nu mai produce alt document (fișierul se poate urca din nou → rând nou).
--   3. nemodificabil: trigger BEFORE UPDATE (funcție SECURITY INVOKER, search_path fix, fără EXECUTE pentru roluri) refuză orice
--      UPDATE care schimbă / șterge / pune sursa_inbox_id (se pune doar la INSERT). Celelalte câmpuri se editează ca înainte;
--      coexistă cu trg_hr_docp_modificat_la (care atinge doar modificat_la; ordinea alfabetică a trigger-elor BEFORE:
--      „…modificat_la” rulează înainte de „…sursa_inbox_imutabil”, deci verificarea vede și ce ar schimba celălalt).
-- Scriitori azi: UI-ul HR (confirmHR pune sursa_inbox_id; editările din TabDocumentePersonale / Coș nu o trimit) și cron-ul
-- api/hr-drive-import.js (service_role, inserează fără ea → NULL). Nimic existent nu e afectat (coloana pornește NULL peste tot).
-- ORDINEA DE LIVRARE: migrarea se aplică ÎNAINTEA merge-ului UI-ului (branch hr/citeste-orice-dubluri). UI-ul nou fără coloană
-- = eroare blocantă „migrarea pentru sursa_inbox_id nu e aplicată — anunță administratorul” (fără inserare fără proveniență).
-- Revenire: supabase/revenire/20261103a_hr_doc_sursa_inbox_ROLLBACK.sql (refuză dacă vreun rând are sursa_inbox_id; doar la
-- cererea lui Răzvan). Test local: scripts/test_hr_doc_sursa_inbox.sh.
-- LIVRARE: doar prin scripts/livrare_migrare.sh; fără BEGIN/COMMIT.

DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261103a_hr_doc_sursa_inbox:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261103a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261103a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.hr_documente_personale') IS NULL OR to_regclass('public.ai_documente_inbox') IS NULL THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103a: lipsește hr_documente_personale sau ai_documente_inbox';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hr_documente_personale'
             AND column_name = 'sursa_inbox_id') THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103a: coloana hr_documente_personale.sursa_inbox_id există deja';
  END IF;
  IF to_regclass('public.hr_documente_personale_sursa_inbox_unic') IS NOT NULL
     OR to_regprocedure('public.hr_docp_sursa_inbox_imutabil()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_docp_sursa_inbox_imutabil') THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103a: indexul / funcția / trigger-ul sursa_inbox există deja';
  END IF;
  -- tipul coloanei noi = tipul cheii din coadă
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_documente_inbox'
                 AND column_name = 'id' AND data_type = 'bigint') THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103a: ai_documente_inbox.id nu e bigint';
  END IF;
END $pre$;

ALTER TABLE public.hr_documente_personale ADD COLUMN sursa_inbox_id bigint;

COMMENT ON COLUMN public.hr_documente_personale.sursa_inbox_id IS
  'Proveniența (20261103a): id-ul rândului din ai_documente_inbox din care «Citește orice» a salvat documentul. Se pune doar la INSERT, nemodificabil (trg_hr_docp_sursa_inbox_imutabil), unic (un rând → cel mult un document, și cu deleted_at). Fără FK: rândul din coadă se poate șterge, proveniența rămâne. NULL = alt drum (Drive, manual).';

CREATE UNIQUE INDEX hr_documente_personale_sursa_inbox_unic
  ON public.hr_documente_personale (sursa_inbox_id)
  WHERE sursa_inbox_id IS NOT NULL;

COMMENT ON INDEX public.hr_documente_personale_sursa_inbox_unic IS
  '20261103a: un rând din ai_documente_inbox creează cel mult un document în dosarul HR (atomic — două taburi pe același rând: al doilea INSERT = 23505).';

CREATE FUNCTION public.hr_docp_sursa_inbox_imutabil()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path = public, pg_temp
AS $f$
BEGIN
  -- se pune doar la INSERT; orice UPDATE care o schimbă, o golește sau o pune ulterior e refuzat (și pentru service_role)
  IF NEW.sursa_inbox_id IS DISTINCT FROM OLD.sursa_inbox_id THEN
    RAISE EXCEPTION 'hr_documente_personale #%: sursa_inbox_id e nemodificabilă (% → %) — se pune doar la INSERT', OLD.id,
      coalesce(OLD.sursa_inbox_id::text, 'NULL'), coalesce(NEW.sursa_inbox_id::text, 'NULL')
      USING ERRCODE = '23514', HINT = 'Proveniența din «Citește orice» nu se editează; celelalte câmpuri se modifică normal.';
  END IF;
  RETURN NEW;
END $f$;

REVOKE EXECUTE ON FUNCTION public.hr_docp_sursa_inbox_imutabil() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.hr_docp_sursa_inbox_imutabil() IS
  '20261103a: BEFORE UPDATE pe hr_documente_personale — refuză schimbarea lui sursa_inbox_id (proveniența «Citește orice»).';

CREATE TRIGGER trg_hr_docp_sursa_inbox_imutabil
  BEFORE UPDATE ON public.hr_documente_personale
  FOR EACH ROW EXECUTE FUNCTION public.hr_docp_sursa_inbox_imutabil();

DO $post$
DECLARE v_fn oid := to_regprocedure('public.hr_docp_sursa_inbox_imutabil()');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hr_documente_personale'
                 AND column_name = 'sursa_inbox_id' AND data_type = 'bigint' AND is_nullable = 'YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103a: coloana sursa_inbox_id lipsește sau are altă definiție';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'hr_documente_personale_sursa_inbox_unic' AND c.relnamespace = 'public'::regnamespace
      AND i.indrelid = 'public.hr_documente_personale'::regclass AND i.indisunique AND i.indisvalid
      AND pg_get_indexdef(i.indexrelid) LIKE '%USING btree (sursa_inbox_id) WHERE (sursa_inbox_id IS NOT NULL)') THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103a: indexul unic parțial pe hr_documente_personale(sursa_inbox_id) lipsește sau are altă definiție';
  END IF;
  IF v_fn IS NULL
     OR (SELECT prosecdef FROM pg_proc WHERE oid = v_fn)
     OR (SELECT proconfig FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
     OR (SELECT proacl FROM pg_proc WHERE oid = v_fn) IS NULL   -- NULL = EXECUTE implicit pentru PUBLIC
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_fn AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103a: funcția trigger-ului nu e INVOKER / search_path fix / fără EXECUTE pentru roluri';
  END IF;
  -- tgtype 19 = ROW (1) + BEFORE (2) + UPDATE (16); fără UPDATE OF col, fără WHEN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_hr_docp_sursa_inbox_imutabil'
                 AND t.tgrelid = 'public.hr_documente_personale'::regclass AND t.tgfoid = v_fn AND NOT t.tgisinternal
                 AND t.tgtype = 19 AND t.tgenabled <> 'D' AND t.tgqual IS NULL AND cardinality(t.tgattr::int2[]) = 0) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103a: trigger-ul trg_hr_docp_sursa_inbox_imutabil lipsește / dezactivat / altă definiție';
  END IF;
END $post$;

NOTIFY pgrst, 'reload schema';

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261103a_hr_doc_sursa_inbox:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261103a: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
