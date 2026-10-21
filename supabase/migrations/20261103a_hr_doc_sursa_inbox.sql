-- 20261103a — HR «Citește orice»: proveniența documentului din dosar devine STRUCTURALĂ (decizia owner 21.10.2026, varianta A).
-- De ce: confirmHR (src/CitesteOricePanel.jsx) marca documentul inserat din rândul #N al cozii ai_documente_inbox cu textul
-- „[Citește orice #N]” în observații și îl căuta cu LIKE. Observațiile se editează liber din dosar (TabDocumentePersonale),
-- deci eticheta se putea pierde / altera, iar între ultima verificare și INSERT rămânea o fereastră (două taburi pe același rând
-- → două documente). Acum:
--   1. hr_documente_personale.sursa_inbox_id bigint NULL = id-ul rândului din ai_documente_inbox din care s-a salvat documentul.
--      FĂRĂ FK spre ai_documente_inbox: rândurile din coadă se pot șterge de owner (politica ai_inbox_delete), iar proveniența
--      trebuie să rămână. NULL = document venit pe alt drum (Drive import, încărcare manuală). Wizard-ul „Angajat nou”
--      (src/HrAngajatNouWizard.jsx) salvează tot din rânduri ale cozii → pune și el sursa_inbox_id (review extern #821, F1).
--   2. index unic parțial (sursa_inbox_id) WHERE NOT NULL: un rând din coadă creează cel mult UN document în dosar, atomic
--      (închide cursa celor două taburi: al doilea INSERT cade cu 23505, UI-ul îl tratează ca „deja salvat din acest rând”).
--      Contează și documentele șterse logic (deleted_at): o copie ștearsă din dosar se poate restaura din Coș, deci rândul
--      ei din coadă nu mai produce alt document (fișierul se poate urca din nou → rând nou).
--   3. nemodificabil: trigger BEFORE UPDATE (funcție SECURITY INVOKER, search_path fix, fără EXECUTE pentru roluri) refuză orice
--      UPDATE care schimbă / șterge / pune sursa_inbox_id (se pune doar la INSERT). Celelalte câmpuri se editează ca înainte;
--      coexistă cu trg_hr_docp_modificat_la (care atinge doar modificat_la; ordinea alfabetică a trigger-elor BEFORE:
--      „…modificat_la” rulează înainte de „…sursa_inbox_imutabil”, deci verificarea vede și ce ar schimba celălalt).
--   4. (review extern #821, Copilot P1) proveniența nu se poate falsifica la INSERT: trigger BEFORE INSERT
--      trg_hr_docp_sursa_inbox_verifica (funcție SECURITY INVOKER, search_path fix, fără EXECUTE pentru roluri). Când
--      NEW.sursa_inbox_id NU e NULL, rândul din ai_documente_inbox trebuie să existe (vizibil apelantului), modul_tinta = 'hr',
--      status IN ('clasificat','eroare') la momentul INSERT-ului și fisier_nume = NEW.fisier_nume — altfel 23514
--      („sursa_inbox_id = N refuzată la INSERT — <motiv>”). NULL rămâne liber (Drive import, încărcări manuale).
--      INVOKER intenționat: citirea rândului trece prin RLS-ul apelantului (ai_inbox SELECT = uploadat_de / modul NULL /
--      fn_ai_inbox_poate_confirma), deci un rând pe care nu-l vede = „nu există” — fără oracol (o funcție DEFINER ar spune
--      oricui are INSERT pe tabelă, înaintea RLS-ului, dacă rândul N e HR / deschis / cu fișierul X). Apelanții legitimi îl
--      văd prin construcție: panoul îl are în coadă (citit cu același RLS), wizard-ul l-a urcat (uploadat_de), service_role
--      sare RLS. Precondiție: authenticated și service_role au SELECT pe coloanele citite.
--   5. (review extern #821, Copilot P1) precondiție legacy: varianta r7 (nelivrată pe producție) scria „[Citește orice #N]”
--      în observații; migrarea REFUZĂ dacă vreun document are încă eticheta (verificat sub LOCK, înaintea coloanei).
-- Scriitori azi: UI-ul HR (confirmHR și wizard-ul „Angajat nou” pun sursa_inbox_id; editările din TabDocumentePersonale / Coș
-- nu o trimit) și cron-ul api/hr-drive-import.js (service_role, inserează fără ea → NULL). Nimic existent nu e afectat
-- (coloana pornește NULL peste tot).
-- ORDINEA DE LIVRARE: migrarea se aplică ÎNAINTEA merge-ului UI-ului (branch hr/citeste-orice-dubluri). UI-ul nou fără coloană
-- = eroare blocantă „migrarea pentru sursa_inbox_id nu e aplicată — anunță administratorul” (fără inserare fără proveniență).
-- LIMITĂRI ACCEPTATE (P2, review extern #821):
--   a. ștergerea DEFINITIVĂ (TabCos «❌ Șterge definitiv» = DELETE; cleanup-recycle-bin după retenție) scoate rândul din
--      dosar, deci și „memoria” indexului unic pentru rândul lui din coadă. Garda de la INSERT (4) refuză oricum un rând din
--      coadă închis ('confirmat' / 'respins') sau șters; golul rămâne doar pentru un rând lăsat DESCHIS (închiderea lui a
--      picat) al cărui document a fost apoi șters definitiv — din el se poate salva din nou un document.
--   b. după prima folosire revenirea BD refuză (există documente cu sursa_inbox_id — vezi supabase/revenire/). Deci o
--      problemă în UI se repară cu un build NOU, înainte (forward-fix), care păstrează contractul coloanei — NU prin revenirea
--      la UI-ul de dinainte de #821 (acela nu scrie / nu citește sursa_inbox_id: cursa celor două taburi și dublurile revin,
--      iar perechea UI + BD nu se mai poate aduce la starea dinainte de #821).
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
DECLARE v_n bigint; v_col text; v_rol text;
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
     OR to_regprocedure('public.hr_docp_sursa_inbox_verifica()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_hr_docp_sursa_inbox_imutabil', 'trg_hr_docp_sursa_inbox_verifica')) THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103a: indexul / funcțiile / trigger-ele sursa_inbox există deja';
  END IF;
  -- tipul coloanei noi = tipul cheii din coadă
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_documente_inbox'
                 AND column_name = 'id' AND data_type = 'bigint') THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103a: ai_documente_inbox.id nu e bigint';
  END IF;
  -- (4) garda de la INSERT (INVOKER) citește id / modul_tinta / status / fisier_nume cu drepturile apelantului: fără SELECT
  -- pe ele, orice INSERT legitim cu proveniență ar cădea (42501) — se oprește aici, nu în producție
  FOREACH v_col IN ARRAY ARRAY['id', 'modul_tinta', 'status', 'fisier_nume'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.ai_documente_inbox'::regclass AND attname = v_col
                   AND attnum > 0 AND NOT attisdropped) THEN
      RAISE EXCEPTION 'PRECONDIȚIE 20261103a: lipsește coloana ai_documente_inbox.%', v_col;
    END IF;
    FOREACH v_rol IN ARRAY ARRAY['authenticated', 'service_role'] LOOP
      IF NOT has_column_privilege(v_rol, 'public.ai_documente_inbox', v_col, 'SELECT') THEN
        RAISE EXCEPTION 'PRECONDIȚIE 20261103a: % nu are SELECT pe ai_documente_inbox.% (garda de la INSERT e INVOKER)', v_rol, v_col;
      END IF;
    END LOOP;
  END LOOP;
  -- (5) precondiție legacy, sub lock-ul pe care oricum îl ia ALTER TABLE (luat direct pe cel mai tare: fără upgrade de lock):
  -- eticheta r7 „[Citește orice #N]” (nelivrată) nu are voie să existe în observații — ar fi o proveniență paralelă,
  -- necunoscută coloanei. Prinde și „ş” cu sedilă / fără diacritice.
  LOCK TABLE public.hr_documente_personale IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO v_n FROM public.hr_documente_personale WHERE observatii ~ '\[Cite[sșş]te orice #';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261103a: % document(e) au în observații eticheta veche „[Citește orice #N]” (varianta r7, nelivrată) — se tratează întâi, printr-o decizie separată; migrarea nu se aplică peste ea', v_n;
  END IF;
END $pre$;

ALTER TABLE public.hr_documente_personale ADD COLUMN sursa_inbox_id bigint;

COMMENT ON COLUMN public.hr_documente_personale.sursa_inbox_id IS
  'Proveniența (20261103a): id-ul rândului din ai_documente_inbox din care «Citește orice» / wizard-ul „Angajat nou” a salvat documentul. Se pune doar la INSERT, verificat atunci (trg_hr_docp_sursa_inbox_verifica: rând HR deschis, același fișier), nemodificabil (trg_hr_docp_sursa_inbox_imutabil), unic (un rând → cel mult un document, și cu deleted_at). Fără FK: rândul din coadă se poate șterge, proveniența rămâne. NULL = alt drum (Drive, manual).';

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

-- (4) garda de la INSERT: proveniența trebuie să fie un rând HR deschis din coadă, al aceluiași fișier
CREATE FUNCTION public.hr_docp_sursa_inbox_verifica()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path = public, pg_temp
AS $f$
DECLARE r record; v_motiv text;
BEGIN
  IF NEW.sursa_inbox_id IS NULL THEN RETURN NEW; END IF;   -- alt drum (Drive, încărcare manuală): nimic de verificat
  -- INVOKER: rândul se citește cu RLS-ul apelantului — unul pe care nu-l vede = „nu există” (fără oracol pe coada altora)
  SELECT i.modul_tinta, i.status, i.fisier_nume INTO r FROM public.ai_documente_inbox i WHERE i.id = NEW.sursa_inbox_id;
  IF NOT FOUND THEN v_motiv := 'rândul nu există în coadă (sau nu îl vezi)';
  ELSIF r.modul_tinta IS DISTINCT FROM 'hr' THEN v_motiv := 'rândul nu e în coada HR';
  ELSIF r.status IS NULL OR r.status NOT IN ('clasificat', 'eroare') THEN
    v_motiv := 'rândul nu mai e deschis în coadă (status ' || coalesce(r.status, 'NULL') || ')';
  ELSIF NEW.fisier_nume IS NULL OR r.fisier_nume IS DISTINCT FROM NEW.fisier_nume THEN
    v_motiv := 'fișierul documentului nu e cel din rândul din coadă';
  END IF;
  IF v_motiv IS NOT NULL THEN
    RAISE EXCEPTION 'hr_documente_personale: sursa_inbox_id = % refuzată la INSERT — %', NEW.sursa_inbox_id, v_motiv
      USING ERRCODE = '23514',
            HINT = 'sursa_inbox_id = rândul HR deschis (clasificat / eroare) din «Citește orice», cu același fisier_nume; NULL pentru Drive / încărcări manuale.';
  END IF;
  RETURN NEW;
END $f$;

REVOKE EXECUTE ON FUNCTION public.hr_docp_sursa_inbox_verifica() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.hr_docp_sursa_inbox_verifica() IS
  '20261103a: BEFORE INSERT pe hr_documente_personale — sursa_inbox_id ne-NULL = rând din ai_documente_inbox vizibil apelantului, modul_tinta hr, status clasificat/eroare, același fisier_nume; altfel 23514.';

CREATE TRIGGER trg_hr_docp_sursa_inbox_verifica
  BEFORE INSERT ON public.hr_documente_personale
  FOR EACH ROW EXECUTE FUNCTION public.hr_docp_sursa_inbox_verifica();

DO $post$
DECLARE v_fn oid := to_regprocedure('public.hr_docp_sursa_inbox_imutabil()');
        v_fv oid := to_regprocedure('public.hr_docp_sursa_inbox_verifica()');
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
  IF v_fn IS NULL OR v_fv IS NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN (v_fn, v_fv)
                AND (p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
                     OR p.proacl IS NULL))   -- proacl NULL = EXECUTE implicit pentru PUBLIC
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid IN (v_fn, v_fv) AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103a: funcțiile trigger-elor nu sunt INVOKER / search_path fix / fără EXECUTE pentru roluri';
  END IF;
  -- tgtype 19 = ROW (1) + BEFORE (2) + UPDATE (16); fără UPDATE OF col, fără WHEN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_hr_docp_sursa_inbox_imutabil'
                 AND t.tgrelid = 'public.hr_documente_personale'::regclass AND t.tgfoid = v_fn AND NOT t.tgisinternal
                 AND t.tgtype = 19 AND t.tgenabled <> 'D' AND t.tgqual IS NULL AND cardinality(t.tgattr::int2[]) = 0) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103a: trigger-ul trg_hr_docp_sursa_inbox_imutabil lipsește / dezactivat / altă definiție';
  END IF;
  -- tgtype 7 = ROW (1) + BEFORE (2) + INSERT (4); fără WHEN (funcția tratează singură NULL-ul)
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_hr_docp_sursa_inbox_verifica'
                 AND t.tgrelid = 'public.hr_documente_personale'::regclass AND t.tgfoid = v_fv AND NOT t.tgisinternal
                 AND t.tgtype = 7 AND t.tgenabled <> 'D' AND t.tgqual IS NULL AND cardinality(t.tgattr::int2[]) = 0) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261103a: trigger-ul trg_hr_docp_sursa_inbox_verifica lipsește / dezactivat / altă definiție';
  END IF;
END $post$;

NOTIFY pgrst, 'reload schema';

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261103a_hr_doc_sursa_inbox:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261103a: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
