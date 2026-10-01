-- ============================================================================
-- R3 — fost angajat Gazpet ca posibil colaborator extern, cu acord SIGUR (tri-valent)
-- Specificație: docs/CONTURI_CICLU_VIATA.md, secțiunea C (+ 0.2: corecțiile din 30.09; 0.3: runda 3).
-- Depinde de 20260929c DOAR prin funcțiile de identitate (fn_identitate_om / fn_identitate_eticheta) și prin
-- fn_nume_cuvinte (mutată în c în runda 3, o folosește și garda R2); de d nu.
-- „Un om” = JWT authenticated venit prin PostgREST (login authenticator), al unui cont NErevocat (runda 3: fără
-- închidere deschisă, fără ban activ): nici service_role, nici pg_cron, nici o sesiune postgres care își pune singură
-- claims de HR, nici un HR cu contul tocmai închis (JWT încă valabil) nu pot decide acordul.
-- „Fost angajat Gazpet” (marcajul de pe extern) ≠ acordul de colaborare: marcajul spune DOAR că omul a avut contract;
-- acordul e separat, tri-valent (necunoscut / accepta / refuza), implicit necunoscut, setat doar de un om.
--   * employees.colaborare_externa_* (necunoscut / accepta / refuza; implicit necunoscut,
--     NICIODATĂ dedus automat; dovada: cine, când, notă sau document)
--   * trg_employees_colab_ext_protectie_ins/_upd — doar un om (owner / can_modify_employees)
--     setează acordul; confirmat_de/la sunt forțate din sesiune. Acordul e legat de încetarea
--     CURENTĂ: la reactivarea fișei sau la ștergerea / SCHIMBAREA datei de încetare revine la „necunoscut”
--     (direcția sigură; rând în jurnal cu sursa reset_automat) → nu se moștenește la o nouă plecare
--   * hr_colaborare_externa_jurnal (append-only) + trg_employees_zz_colab_ext (sincronizare)
--   * hr_personal_extern.fost_angajat_employee_id + fost_angajat_gazpet (marcaj generat)
--   * trg_hr_personal_extern_fost_angajat — legarea doar de owner/HR; colaborare ACTIVĂ doar pentru un fost
--     angajat (încă) cu acord „accepta”; un extern NELEGAT activ cu numele/emailul unui fost angajat e
--     refuzat (în afară de owner), ca acordul și marcajul să nu poată fi ocolite; dezlegarea → inactiv
--   * fn_colaborare_externa_seteaza / fn_fost_angajat_leaga_extern — RPC cu poartă de rol în cod
-- Ofertare NU se modifică (înghețat până după 02.10): filtrul existent pe ext.activ face ca un
-- fost angajat fără acord să nu poată fi folosit — pentru rândurile NOI/modificate; cele 25 existente
-- (0 omonime cu foști angajați la 29.09) nu sunt reverificate. Idempotentă. Nu atinge datele existente.
-- ============================================================================

-- C.1 Coloane noi pe employees ----------------------------------------------------
-- ── Garda de livrare (start): DOAR prin scripts/livrare_migrare.sh (psql --single-transaction, marcaj legat de txid).
--    Fișierul NU conține BEGIN/COMMIT; psql -f simplu, apply_migration / execute_sql MCP nu îl pot aplica.
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260929e_fost_angajat_colaborare_externa:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20260929e: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

-- ── Precondiții fail-closed (adăugate 01.10.2026 pentru runner) ──────────────────────────
DO $pre_livrare$
DECLARE v_lipsa text[];
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție: migrarea rulează ca postgres (current_user = %)', current_user;
  END IF;
  SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY['fn_identitate_om','fn_identitate_eticheta']::text[]) f
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: lipsesc funcțiile migrării anterioare: %', v_lipsa; END IF;
  IF to_regclass('public.hr_personal_extern') IS NULL THEN RAISE EXCEPTION 'Precondiție: public.hr_personal_extern lipsește'; END IF;
  -- Live 01.10.2026 (citit read-only): SEC F1 (v20261001123000) — setarea implicită a lui postgres pe public nu mai dă
  -- TRUNCATE lui anon/authenticated; tabelele create aici moștenesc asta. Dacă F1 a fost revertit, se reanalizează.
  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
              WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
                AND a.privilege_type = 'TRUNCATE' AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)) THEN
    RAISE EXCEPTION 'Precondiție: SEC F1 nu e live (setarea implicită a lui postgres dă TRUNCATE lui anon/authenticated) — se reanalizează';
  END IF;
  -- r3: amprenta EXACTĂ a helperilor din c folosiți aici (semnătură unică, md5 prosrc, SECURITY DEFINER, proconfig, owner, ACL)
  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
    FROM (VALUES ('fn_identitate_om', 'fn_identitate_om()', '2c64d6b19e2afbf7d158b33d67845e32'),
                 ('fn_identitate_privilegiata', 'fn_identitate_privilegiata()', '13b245513eed1f7f3848ce4edbcec383'),
                 ('fn_identitate_eticheta', 'fn_identitate_eticheta()', '876a28f98d4f4aee76a0580dab4ecc51'),
                 ('fn_nume_familie', 'fn_nume_familie(text)', 'd45994c4bc8aaf51da653578c1cf86cf'),
                 ('fn_nume_cuvinte', 'fn_nume_cuvinte(text)', '8ec2a2ee5b6313ab55ba9ff1a1c6c998'),
                 ('fn_cont_notifica_owneri', 'fn_cont_notifica_owneri(text,text,text,text)', 'ecfb5fa1d44c93c57df39aed1f5c9a5e')) AS w(f, sig, m)
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p
                      WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m AND p.prosecdef
                        AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                        AND pg_get_userbyid(p.proowner)::text = 'postgres'
                        AND p.proacl::text = '{postgres=X/postgres}');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: helperii din 20260929c nu au amprenta livrată (semnătură/md5/secdef/proconfig/owner/ACL): %', v_lipsa; END IF;
END $pre_livrare$;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS colaborare_externa_status text NOT NULL DEFAULT 'necunoscut',
  ADD COLUMN IF NOT EXISTS colaborare_externa_confirmat_de uuid,          -- fără FK: nu blocăm ștergerea unui cont
  ADD COLUMN IF NOT EXISTS colaborare_externa_confirmat_la timestamptz,
  ADD COLUMN IF NOT EXISTS colaborare_externa_nota text,
  ADD COLUMN IF NOT EXISTS colaborare_externa_document text;              -- cale storage / referință document (opțional)
DO $garda$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.employees'::regclass AND conname = 'employees_colab_ext_status_chk') THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_colab_ext_status_chk
      CHECK (colaborare_externa_status IN ('necunoscut','accepta','refuza'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.employees'::regclass AND conname = 'employees_colab_ext_dovada_chk') THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_colab_ext_dovada_chk CHECK (
      (colaborare_externa_status = 'necunoscut'
         AND colaborare_externa_confirmat_de IS NULL AND colaborare_externa_confirmat_la IS NULL
         AND colaborare_externa_document IS NULL)
      OR (colaborare_externa_status <> 'necunoscut'
         AND colaborare_externa_confirmat_de IS NOT NULL AND colaborare_externa_confirmat_la IS NOT NULL
         AND (length(btrim(COALESCE(colaborare_externa_nota, ''))) >= 5 OR colaborare_externa_document IS NOT NULL)));
  END IF;
END $garda$;
COMMENT ON COLUMN public.employees.colaborare_externa_status IS
  'Acordul fostului angajat pentru colaborare externă: necunoscut (implicit) / accepta / refuza. Setat DOAR de un om (owner / HR), niciodată automat.';
COMMENT ON COLUMN public.employees.colaborare_externa_nota IS
  'Dovada acordului (text vizibil tuturor celor logați: fără date sensibile; documentul semnat merge în Documente personale).';

-- C.2 Protecția stării --------------------------------------------------------------
-- Acordul se referă la încetarea CURENTĂ. La reactivare (active → true) sau la ștergerea / schimbarea datei de
-- încetare (anularea încetării / D4 / altă încetare — audit B #9b) se golește: status „necunoscut”, fără
-- proveniență, fără notă/document (istoricul rămâne în jurnal). NU e o deducere de acord (e direcția sigură) și
-- rulează pentru orice identitate. Astfel „accepta” nu poate rămâne pe un angajat activ și nu trece la altă plecare.
-- Orice altă schimbare a acordului cere un OM (fn_identitate_om: JWT authenticated prin PostgREST) cu drept
-- owner / can_modify_employees. Refuzate explicit (fișa de securitate): service_role, pg_cron / migrări (db_login),
-- GoTrue, și o sesiune directă (postgres/MCP) care își pune claims de HR (audit B #9a).
CREATE OR REPLACE FUNCTION public.fn_employees_colab_ext_protectie()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid := public.fn_identitate_om();
BEGIN
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'O fișă nouă începe cu acordul de colaborare externă „necunoscut”; acordul îl setează un om din HR după încetarea contractului'
      USING ERRCODE = '42501';
  END IF;
  IF (OLD.active IS NOT TRUE AND NEW.active IS TRUE)
     OR (OLD.termination_date IS NOT NULL AND NEW.termination_date IS DISTINCT FROM OLD.termination_date) THEN
    NEW.colaborare_externa_status       := 'necunoscut';
    NEW.colaborare_externa_confirmat_de := NULL;
    NEW.colaborare_externa_confirmat_la := NULL;
    NEW.colaborare_externa_nota         := NULL;
    NEW.colaborare_externa_document     := NULL;
    RETURN NEW;
  END IF;
  IF (OLD.colaborare_externa_status, OLD.colaborare_externa_confirmat_de, OLD.colaborare_externa_confirmat_la,
      OLD.colaborare_externa_nota, OLD.colaborare_externa_document)
     IS NOT DISTINCT FROM
     (NEW.colaborare_externa_status, NEW.colaborare_externa_confirmat_de, NEW.colaborare_externa_confirmat_la,
      NEW.colaborare_externa_nota, NEW.colaborare_externa_document) THEN
    RETURN NEW;                                   -- s-a schimbat doar active / data încetării (ex. cron-ul)
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Acordul de colaborare externă îl setează doar un om din platformă (owner / HR, prin aplicație), niciodată automat'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                  WHERE id = v_uid AND (is_owner IS TRUE OR can_modify_employees IS TRUE)) THEN
    RAISE EXCEPTION 'Doar owner sau HR (can_modify_employees) pot seta acordul de colaborare externă'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.colaborare_externa_status IS DISTINCT FROM 'necunoscut' AND NEW.termination_date IS NULL THEN
    RAISE EXCEPTION 'Acordul de colaborare externă se setează doar pentru contracte încheiate sau cu dată de încetare'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.colaborare_externa_status = 'necunoscut' THEN
    NEW.colaborare_externa_confirmat_de := NULL;
    NEW.colaborare_externa_confirmat_la := NULL;
    NEW.colaborare_externa_document     := NULL;
  ELSE
    -- Proveniența vine din sesiune, nu din client.
    NEW.colaborare_externa_confirmat_de := v_uid;
    NEW.colaborare_externa_confirmat_la := now();
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_employees_colab_ext_protectie() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_employees_colab_ext_protectie_ins ON public.employees;
CREATE TRIGGER trg_employees_colab_ext_protectie_ins BEFORE INSERT ON public.employees
  FOR EACH ROW WHEN (NEW.colaborare_externa_status <> 'necunoscut'
                     OR NEW.colaborare_externa_confirmat_de IS NOT NULL
                     OR NEW.colaborare_externa_confirmat_la IS NOT NULL)
  EXECUTE FUNCTION public.fn_employees_colab_ext_protectie();
DROP TRIGGER IF EXISTS trg_employees_colab_ext_protectie_upd ON public.employees;
CREATE TRIGGER trg_employees_colab_ext_protectie_upd BEFORE UPDATE ON public.employees
  FOR EACH ROW WHEN (OLD.colaborare_externa_status       IS DISTINCT FROM NEW.colaborare_externa_status
                  OR OLD.colaborare_externa_confirmat_de IS DISTINCT FROM NEW.colaborare_externa_confirmat_de
                  OR OLD.colaborare_externa_confirmat_la IS DISTINCT FROM NEW.colaborare_externa_confirmat_la
                  OR OLD.colaborare_externa_nota         IS DISTINCT FROM NEW.colaborare_externa_nota
                  OR OLD.colaborare_externa_document     IS DISTINCT FROM NEW.colaborare_externa_document
                  OR OLD.active                          IS DISTINCT FROM NEW.active
                  OR OLD.termination_date                IS DISTINCT FROM NEW.termination_date)
  EXECUTE FUNCTION public.fn_employees_colab_ext_protectie();

-- C.3 Jurnalul acordului (append-only) ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.hr_colaborare_externa_jurnal (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id  integer NOT NULL,        -- fără FK: jurnalul supraviețuiește fișei
  status_vechi text,
  status_nou   text,
  nota         text,
  document     text,
  facut_de     uuid,                    -- omul din platformă (JWT authenticated prin PostgREST); NULL = nu e un om
  facut_de_identitate text,             -- identitatea EXPLICITĂ (fn_identitate_eticheta): db_login:postgres, owner:<uuid>…
  facut_la     timestamptz NOT NULL DEFAULT now(),
  sursa        text NOT NULL DEFAULT 'manual' CHECK (sursa IN ('manual','reset_automat'))
);
CREATE INDEX IF NOT EXISTS idx_hr_colab_ext_jurnal_employee ON public.hr_colaborare_externa_jurnal(employee_id);
COMMENT ON TABLE public.hr_colaborare_externa_jurnal IS
  'Istoricul acordului de colaborare externă al foștilor angajați (append-only; scris doar de trg_employees_zz_colab_ext).';
ALTER TABLE public.hr_colaborare_externa_jurnal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_colab_ext_jurnal_select ON public.hr_colaborare_externa_jurnal;
CREATE POLICY hr_colab_ext_jurnal_select ON public.hr_colaborare_externa_jurnal
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid()
       AND (is_owner IS TRUE OR can_modify_employees IS TRUE OR can_access_personal_data IS TRUE)));
-- P1 (audit C): service_role doar citește; scrierea e doar a triggerului SECURITY DEFINER.
REVOKE ALL ON TABLE public.hr_colaborare_externa_jurnal FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.hr_colaborare_externa_jurnal TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.hr_colaborare_externa_jurnal_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- P2 (audit C): garda rămâne SECURITY INVOKER intenționat — doar RAISE, nu citește/scrie date.
CREATE OR REPLACE FUNCTION public.fn_hr_colab_ext_jurnal_imuabil()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'Jurnalul acordului de colaborare externă e append-only: % interzis', TG_OP USING ERRCODE = '42501';
END $fn$;
REVOKE ALL ON FUNCTION public.fn_hr_colab_ext_jurnal_imuabil() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_hr_colab_ext_jurnal_imuabil ON public.hr_colaborare_externa_jurnal;
CREATE TRIGGER trg_hr_colab_ext_jurnal_imuabil BEFORE UPDATE OR DELETE OR TRUNCATE ON public.hr_colaborare_externa_jurnal
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_hr_colab_ext_jurnal_imuabil();

-- C.4 Legătura cu tabela de externi -----------------------------------------------
ALTER TABLE public.hr_personal_extern
  ADD COLUMN IF NOT EXISTS fost_angajat_employee_id integer;
ALTER TABLE public.hr_personal_extern
  ADD COLUMN IF NOT EXISTS fost_angajat_gazpet boolean GENERATED ALWAYS AS (fost_angajat_employee_id IS NOT NULL) STORED;
DO $garda$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.hr_personal_extern'::regclass
                    AND conname = 'hr_personal_extern_fost_angajat_fk') THEN
    ALTER TABLE public.hr_personal_extern ADD CONSTRAINT hr_personal_extern_fost_angajat_fk
      FOREIGN KEY (fost_angajat_employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;
  END IF;
END $garda$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_personal_extern_fost_angajat
  ON public.hr_personal_extern(fost_angajat_employee_id) WHERE fost_angajat_employee_id IS NOT NULL;
COMMENT ON COLUMN public.hr_personal_extern.fost_angajat_gazpet IS
  'Marcajul „Fost angajat Gazpet” (generat din fost_angajat_employee_id; nu se poate desincroniza).';

-- Cuvintele unui nume (fn_nume_cuvinte) vin din migrarea c (A.0b, runda 3): aceeași normalizare ca garda R2.

-- Foștii angajați (contract încheiat, fișă inactivă) care se potrivesc cu un extern: email identic, sau
-- nume cu ≥ 2 cuvinte în care numele de familie al fișei apare și un set de cuvinte îl conține pe celălalt
-- („Ștefănescu Ion” = STEFANESCU ION = „Ion Stefanescu”; „Radu Mihai” ⊂ RADU MIHAI ALEXANDRU). Internă.
CREATE OR REPLACE FUNCTION public.fn_extern_fost_angajat_potrivire(p_nume text, p_email text)
RETURNS TABLE(employee_id integer, employee_name text, metoda text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH x AS (
    SELECT public.fn_nume_cuvinte(p_nume) AS cuv, lower(btrim(COALESCE(p_email, ''))) AS em
  ),
  fosti AS (
    SELECT e.id, e.name, lower(btrim(COALESCE(e.email, ''))) AS em, public.fn_nume_cuvinte(e.name) AS cuv,
           (array_remove(regexp_split_to_array(upper(extensions.unaccent(btrim(e.name))), '[^[:alnum:]]+'), ''))[1] AS familie
      FROM public.employees e
     WHERE e.termination_date IS NOT NULL AND e.termination_date <= CURRENT_DATE AND e.active IS NOT TRUE
  )
  SELECT f.id, f.name, CASE WHEN x.em <> '' AND f.em = x.em THEN 'email' ELSE 'nume' END
    FROM fosti f, x
   WHERE (x.em <> '' AND f.em = x.em)
      OR (cardinality(x.cuv) >= 2 AND cardinality(f.cuv) >= 2 AND f.familie = ANY (x.cuv)
          AND (x.cuv <@ f.cuv OR f.cuv <@ x.cuv))
   ORDER BY f.id;
$fn$;
REVOKE ALL ON FUNCTION public.fn_extern_fost_angajat_potrivire(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- C.3b Serializare fost angajat ↔ extern (r3, E1 Copilot: TOCTOU între triggerul externului și cel al fișei).
-- O SINGURĂ disciplină: lock-uri advisory de tranzacție pe identitatea comună, luate de AMBELE fluxuri înainte de orice citire:
--   * fișa:    gazpet.colab_ext.emp:<id>, gazpet.colab_ext.nume:<numele de familie vechi/nou>, gazpet.colab_ext.email:<vechi/nou>
--   * externul: gazpet.colab_ext.emp:<fișa legată veche/nouă>, gazpet.colab_ext.nume:<FIECARE cuvânt din nume vechi/nou>
--     (oricare poate fi numele de familie al unui fost angajat — aceeași regulă ca fn_extern_fost_angajat_potrivire),
--     gazpet.colab_ext.email:<vechi/nou>.
-- Cheile se iau într-un singur apel, sortate după hash (fără cicluri între advisory-uri). Citirile de după lock sunt
-- instrucțiuni noi (READ COMMITTED) ⇒ văd ce a comis celălalt flux. Rândurile proprii (fișa, respectiv externul) sunt deja
-- blocate de UPDATE înainte de trigger: un ciclu rând-fișă ↔ rând-extern rămâne posibil doar ca deadlock DETECTAT (40P01,
-- una dintre tranzacții e anulată) — niciodată ca stare finală inconsistentă.
CREATE OR REPLACE FUNCTION public.fn_colab_ext_lock(p_emp integer[], p_nume text[], p_email text[])
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_h bigint;
BEGIN
  FOR v_h IN
    SELECT DISTINCT hashtextextended(k, 0) FROM (
      SELECT 'gazpet.colab_ext.emp:' || x::text AS k FROM unnest(COALESCE(p_emp, '{}'::integer[])) x WHERE x IS NOT NULL
      UNION ALL
      SELECT 'gazpet.colab_ext.nume:' || x FROM unnest(COALESCE(p_nume, '{}'::text[])) x WHERE COALESCE(x, '') <> ''
      UNION ALL
      SELECT 'gazpet.colab_ext.email:' || lower(btrim(x)) FROM unnest(COALESCE(p_email, '{}'::text[])) x WHERE COALESCE(btrim(x), '') <> ''
    ) t ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_h);
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_colab_ext_lock(integer[], text[], text[]) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_employees_colab_ext_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.fn_colab_ext_lock(ARRAY[NEW.id],
                                   ARRAY[public.fn_nume_familie(OLD.name), public.fn_nume_familie(NEW.name)],
                                   ARRAY[OLD.email, NEW.email]);
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_employees_colab_ext_lock() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_employees_colab_ext_lock ON public.employees;
CREATE TRIGGER trg_employees_colab_ext_lock BEFORE UPDATE OF active, termination_date, name, email,
    colaborare_externa_status, colaborare_externa_nota, colaborare_externa_document ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.fn_employees_colab_ext_lock();

-- Protecție: politicile INSERT/UPDATE de pe tabelă permit ORICĂRUI logat să scrie → poarta e aici.
--   (1) legarea / dezlegarea: doar owner / HR; ținta = fost angajat; dezlegarea face colaborarea inactivă;
--   (2) rând legat + activ: fișa e ÎNCĂ a unui fost angajat și acordul e „accepta”;
--   (3) rând NELEGAT + activ cu numele / emailul unui fost angajat → refuz (în afară de owner, care decide
--       la omonimie), ca acordul și marcajul „Fost angajat Gazpet” să nu poată fi ocolite.
CREATE OR REPLACE FUNCTION public.fn_hr_personal_extern_fost_angajat()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid   uuid := public.fn_identitate_om();
  v_owner boolean;
  v_e     record;
  v_pot   record;
BEGIN
  -- r3 (E1): serializare cu fluxul fișei, ÎNAINTE de orice citire din employees (vezi C.3b)
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_colab_ext_lock(ARRAY[NEW.fost_angajat_employee_id], public.fn_nume_cuvinte(NEW.nume), ARRAY[NEW.email]);
  ELSE
    PERFORM public.fn_colab_ext_lock(ARRAY[OLD.fost_angajat_employee_id, NEW.fost_angajat_employee_id],
                                     public.fn_nume_cuvinte(OLD.nume) || public.fn_nume_cuvinte(NEW.nume), ARRAY[OLD.email, NEW.email]);
  END IF;
  v_owner := v_uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_owner IS TRUE);
  IF (TG_OP = 'INSERT' AND NEW.fost_angajat_employee_id IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.fost_angajat_employee_id IS DISTINCT FROM OLD.fost_angajat_employee_id) THEN
    IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles
                                     WHERE id = v_uid AND (is_owner IS TRUE OR can_modify_employees IS TRUE)) THEN
      RAISE EXCEPTION 'Doar owner sau HR (can_modify_employees) pot lega / dezlega un fost angajat de un extern'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.fost_angajat_employee_id IS NOT NULL THEN
      SELECT e.id, e.active, e.termination_date INTO v_e FROM public.employees e WHERE e.id = NEW.fost_angajat_employee_id;
      IF NOT FOUND OR NOT (v_e.termination_date IS NOT NULL AND v_e.termination_date <= CURRENT_DATE AND v_e.active IS NOT TRUE) THEN
        RAISE EXCEPTION 'Fișa #% nu e a unui fost angajat (contract încheiat și fișă inactivă)', NEW.fost_angajat_employee_id
          USING ERRCODE = '22023';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.activ := false;                           -- dezlegare: reactivarea trece prin verificarea (3)
    END IF;
  END IF;
  IF NEW.fost_angajat_employee_id IS NOT NULL AND NEW.activ IS TRUE THEN
    SELECT e.active, e.termination_date, e.colaborare_externa_status INTO v_e
      FROM public.employees e WHERE e.id = NEW.fost_angajat_employee_id;
    IF NOT FOUND OR NOT (v_e.termination_date IS NOT NULL AND v_e.termination_date <= CURRENT_DATE AND v_e.active IS NOT TRUE) THEN
      RAISE EXCEPTION 'Colaborarea externă poate fi activă doar pentru un fost angajat: fișa #% e din nou activă sau fără contract încheiat',
        NEW.fost_angajat_employee_id USING ERRCODE = '23514';
    END IF;
    IF COALESCE(v_e.colaborare_externa_status, 'necunoscut') <> 'accepta' THEN
      RAISE EXCEPTION 'Colaborarea poate fi activă doar dacă fostul angajat a acceptat (HR → Foști angajați)'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.fost_angajat_employee_id IS NULL AND NEW.activ IS TRUE AND NOT v_owner
     AND (TG_OP = 'INSERT' OR NEW.nume IS DISTINCT FROM OLD.nume OR NEW.email IS DISTINCT FROM OLD.email
          OR NEW.activ IS DISTINCT FROM OLD.activ) THEN
    SELECT p.employee_id, p.employee_name INTO v_pot
      FROM public.fn_extern_fost_angajat_potrivire(NEW.nume, NEW.email) p LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'E fost angajat Gazpet (fișa #% %): colaborarea se trece prin HR → Foști angajați, cu acordul lui',
        v_pot.employee_id, v_pot.employee_name
        USING ERRCODE = '23514',
              HINT = format('Folosește HR → Foști angajați → „Trece ca extern” (fișa #%s %s). Dacă e altă persoană cu același nume, activarea o face owner-ul.',
                            v_pot.employee_id, v_pot.employee_name);
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_hr_personal_extern_fost_angajat() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_hr_personal_extern_fost_angajat ON public.hr_personal_extern;
CREATE TRIGGER trg_hr_personal_extern_fost_angajat BEFORE INSERT OR UPDATE ON public.hr_personal_extern
  FOR EACH ROW EXECUTE FUNCTION public.fn_hr_personal_extern_fost_angajat();

-- C.5 Sincronizarea: jurnal + dezactivarea externului (activarea NU se face niciodată automat)
CREATE OR REPLACE FUNCTION public.fn_employees_colab_ext_after()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_reset boolean := (OLD.active IS NOT TRUE AND NEW.active IS TRUE)
                     OR (OLD.termination_date IS NOT NULL AND NEW.termination_date IS DISTINCT FROM OLD.termination_date);
  -- r4 (varianta C) + r5 (varianta A, decizia lui Răzvan, E-LIFECYCLE-2): politica C se aplică din momentul în care fișa
  -- trece din activă în inactivă, INDIFERENT de termination_date (și o dată de încetare viitoare: la scadență nu mai vine
  -- niciun UPDATE, deci verificarea se face anticipat, la programare).
  v_devine_fost boolean := OLD.active IS TRUE AND NEW.active IS NOT TRUE;
  v_em    text := lower(btrim(COALESCE(NEW.email, '')));
  v_cuv   text[] := public.fn_nume_cuvinte(NEW.name);
  v_fam   text := public.fn_nume_familie(NEW.name);
  x       record;
BEGIN
  IF OLD.colaborare_externa_status   IS DISTINCT FROM NEW.colaborare_externa_status
     OR OLD.colaborare_externa_nota     IS DISTINCT FROM NEW.colaborare_externa_nota
     OR OLD.colaborare_externa_document IS DISTINCT FROM NEW.colaborare_externa_document THEN
    INSERT INTO public.hr_colaborare_externa_jurnal (employee_id, status_vechi, status_nou, nota, document, facut_de,
                                                     facut_de_identitate, sursa)
    VALUES (NEW.id, OLD.colaborare_externa_status, NEW.colaborare_externa_status,
            CASE WHEN v_reset
                 THEN format('Resetat automat: %s; acordul era pentru încetarea din %s. La o nouă plecare se reconfirmă.',
                             CASE WHEN OLD.active IS NOT TRUE AND NEW.active IS TRUE THEN 'fișa a fost reactivată'
                                  WHEN NEW.termination_date IS NULL THEN 'data încetării a fost ștearsă'
                                  ELSE 'data încetării a fost schimbată (' || to_char(NEW.termination_date, 'DD.MM.YYYY') || ')' END,
                             COALESCE(to_char(OLD.termination_date, 'DD.MM.YYYY'), '—'))
                 ELSE NEW.colaborare_externa_nota END,
            NEW.colaborare_externa_document, public.fn_identitate_om(), public.fn_identitate_eticheta(),
            CASE WHEN v_reset THEN 'reset_automat' ELSE 'manual' END);
  END IF;
  IF (OLD.colaborare_externa_status = 'accepta' AND NEW.colaborare_externa_status IS DISTINCT FROM 'accepta')
     OR (OLD.active IS NOT TRUE AND NEW.active IS TRUE) THEN
    UPDATE public.hr_personal_extern SET activ = false, updated_at = now()
     WHERE fost_angajat_employee_id = NEW.id AND activ;
  END IF;
  -- r4 (E-LIFECYCLE, varianta C): externii ACTIVI NELEGAȚI care existau deja cu identitatea omului care tocmai a fost
  -- dezactivat (r5: la dezactivare, chiar dacă data încetării e în viitor).
  --   * email identic  → dezactivare automată (direcția sigură; activarea o face din nou un om) + notificare owner;
  --   * doar pe nume   → notificare owner, FĂRĂ dezactivare (poate fi altă persoană cu același nume).
  -- Lock-urile advisory pe identitate sunt deja ținute (trg_employees_colab_ext_lock) ⇒ fără cursă cu un extern nou.
  IF v_devine_fost THEN
    FOR x IN
      SELECT h.id, h.nume, (v_em <> '' AND lower(btrim(COALESCE(h.email, ''))) = v_em) AS pe_email
        FROM public.hr_personal_extern h
       WHERE h.fost_angajat_employee_id IS NULL AND h.activ IS TRUE
         AND ((v_em <> '' AND lower(btrim(COALESCE(h.email, ''))) = v_em)
              OR (cardinality(v_cuv) >= 2 AND cardinality(public.fn_nume_cuvinte(h.nume)) >= 2 AND v_fam = ANY (public.fn_nume_cuvinte(h.nume))
                  AND (public.fn_nume_cuvinte(h.nume) <@ v_cuv OR v_cuv <@ public.fn_nume_cuvinte(h.nume))))
       ORDER BY h.id
    LOOP
      IF x.pe_email THEN
        UPDATE public.hr_personal_extern SET activ = false, updated_at = now() WHERE id = x.id;
        PERFORM public.fn_cont_notifica_owneri('extern_fost_angajat_dezactivat', '⏸ Extern dezactivat: e fost angajat Gazpet',
          format('Externul #%s %s are emailul fișei #%s %s, al cărei contract s-a încheiat. Colaborarea a fost oprită automat; se reactivează prin HR → Foști angajați, cu acordul lui.',
                 x.id, x.nume, NEW.id, NEW.name),
          '/hr?tab=fosti');
      ELSE
        PERFORM public.fn_cont_notifica_owneri('extern_fost_angajat_omonim', '⚠ Extern activ cu numele unui fost angajat',
          format('Externul #%s %s are același nume ca fișa #%s %s, al cărei contract s-a încheiat. Nu l-am dezactivat (poate fi altă persoană): verifică și, dacă e același om, trece-l prin HR → Foști angajați.',
                 x.id, x.nume, NEW.id, NEW.name),
          '/hr?tab=fosti');
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_employees_colab_ext_after() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_employees_zz_colab_ext ON public.employees;
CREATE TRIGGER trg_employees_zz_colab_ext AFTER UPDATE ON public.employees FOR EACH ROW
  WHEN (OLD.colaborare_externa_status   IS DISTINCT FROM NEW.colaborare_externa_status
     OR OLD.colaborare_externa_nota     IS DISTINCT FROM NEW.colaborare_externa_nota
     OR OLD.colaborare_externa_document IS DISTINCT FROM NEW.colaborare_externa_document
     OR OLD.active IS DISTINCT FROM NEW.active
     OR OLD.termination_date IS DISTINCT FROM NEW.termination_date)
  EXECUTE FUNCTION public.fn_employees_colab_ext_after();

-- C.6 Funcțiile apelabile din UI (poartă: owner sau can_modify_employees, în cod) ----
CREATE OR REPLACE FUNCTION public.fn_colaborare_externa_seteaza(p_employee_id integer, p_status text, p_nota text, p_document text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid  uuid := public.fn_identitate_om();
  v_nota text := NULLIF(btrim(p_nota), '');
  v_doc  text := NULLIF(btrim(p_document), '');
  v_e    record;
  v_schimbat boolean;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles
                                   WHERE id = v_uid AND (is_owner IS TRUE OR can_modify_employees IS TRUE)) THEN
    RAISE EXCEPTION 'Doar owner sau HR (can_modify_employees) pot seta acordul de colaborare externă' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('necunoscut','accepta','refuza') THEN
    RAISE EXCEPTION 'Stare necunoscută: % (necunoscut / accepta / refuza)', p_status USING ERRCODE = '22023';
  END IF;
  IF p_status <> 'necunoscut' AND COALESCE(length(v_nota), 0) < 5 AND v_doc IS NULL THEN
    RAISE EXCEPTION 'Pentru Acceptă / Refuză e obligatorie dovada: o notă de minim 5 caractere sau un document'
      USING ERRCODE = '22023';
  END IF;
  IF p_status = 'necunoscut' THEN v_doc := NULL; END IF;     -- „necunoscut” nu are document de dovadă
  SELECT e.id INTO v_e FROM public.employees e WHERE e.id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fișa #% nu există', p_employee_id USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.employees e
     SET colaborare_externa_status = p_status, colaborare_externa_nota = v_nota, colaborare_externa_document = v_doc
   WHERE e.id = p_employee_id
     AND (e.colaborare_externa_status, e.colaborare_externa_nota, e.colaborare_externa_document)
         IS DISTINCT FROM (p_status, v_nota, v_doc);
  v_schimbat := FOUND;
  RETURN (SELECT jsonb_build_object('employee_id', e.id, 'status', e.colaborare_externa_status,
                                    'confirmat_de', e.colaborare_externa_confirmat_de,
                                    'confirmat_la', e.colaborare_externa_confirmat_la,
                                    'nota', e.colaborare_externa_nota, 'document', e.colaborare_externa_document,
                                    'schimbat', v_schimbat)
            FROM public.employees e WHERE e.id = p_employee_id);
END $fn$;
-- P3 (audit C): fără service_role (refuzat oricum în cod: tri-starea o decide doar un om).
REVOKE ALL ON FUNCTION public.fn_colaborare_externa_seteaza(integer, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_colaborare_externa_seteaza(integer, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_fost_angajat_leaga_extern(p_employee_id integer, p_extern_id bigint DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid  uuid := public.fn_identitate_om();
  v_e    public.employees%ROWTYPE;
  v_x    public.hr_personal_extern%ROWTYPE;
  v_id   bigint;
  v_constr text;
  v_exist  bigint;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles
                                   WHERE id = v_uid AND (is_owner IS TRUE OR can_modify_employees IS TRUE)) THEN
    RAISE EXCEPTION 'Doar owner sau HR (can_modify_employees) pot trece un fost angajat ca extern' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_e FROM public.employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fișa #% nu există', p_employee_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT (v_e.termination_date IS NOT NULL AND v_e.termination_date <= CURRENT_DATE AND v_e.active IS NOT TRUE) THEN
    RAISE EXCEPTION 'Fișa #% nu e a unui fost angajat (contract încheiat și fișă inactivă)', p_employee_id USING ERRCODE = '22023';
  END IF;
  SELECT x.id INTO v_id FROM public.hr_personal_extern x WHERE x.fost_angajat_employee_id = p_employee_id;
  IF FOUND THEN RETURN v_id; END IF;                          -- idempotent

  IF p_extern_id IS NOT NULL THEN
    SELECT * INTO v_x FROM public.hr_personal_extern WHERE id = p_extern_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Externul #% nu există', p_extern_id USING ERRCODE = 'P0002';
    END IF;
    IF v_x.fost_angajat_employee_id IS NOT NULL THEN
      RAISE EXCEPTION 'Externul #% e deja legat de fișa #%', p_extern_id, v_x.fost_angajat_employee_id USING ERRCODE = '23505';
    END IF;
    UPDATE public.hr_personal_extern
       SET fost_angajat_employee_id = p_employee_id,
           activ = (activ AND v_e.colaborare_externa_status = 'accepta'),
           updated_at = now()
     WHERE id = p_extern_id;
    RETURN p_extern_id;
  END IF;

  BEGIN
    INSERT INTO public.hr_personal_extern (nume, functie, telefon, email, observatii, activ, created_by, fost_angajat_employee_id)
    VALUES (v_e.name, COALESCE(v_e.functie, v_e.position), v_e.telefon, NULLIF(btrim(v_e.email), ''),
            format('Fost angajat Gazpet (fișa #%s), contract încheiat la %s', v_e.id, to_char(v_e.termination_date, 'DD.MM.YYYY')),
            v_e.colaborare_externa_status = 'accepta', v_uid, p_employee_id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constr = CONSTRAINT_NAME;
    IF v_constr = 'uq_hr_personal_extern_nume' THEN
      SELECT x.id INTO v_exist FROM public.hr_personal_extern x WHERE lower(btrim(x.nume)) = lower(btrim(v_e.name));
      RAISE EXCEPTION 'Există deja un extern cu numele %', v_e.name
        USING ERRCODE = '23505', HINT = format('Există deja externul %s (#%s): leagă-l explicit', v_e.name, v_exist);
    END IF;
    RAISE;
  END;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_fost_angajat_leaga_extern(integer, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_fost_angajat_leaga_extern(integer, bigint) TO authenticated;

-- ── Postcondiții (adăugate 01.10.2026 pentru runner) — orice abatere anulează tot ──────────
DO $post_livrare$
DECLARE v_n integer; v_lipsa text[];
BEGIN
  -- funcțiile migrării există; cele SECURITY DEFINER au search_path fixat; niciuna executabilă de anon (excepții explicite)
  SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY['fn_colab_ext_lock','fn_employees_colab_ext_lock','fn_colaborare_externa_seteaza','fn_employees_colab_ext_after','fn_employees_colab_ext_protectie','fn_extern_fost_angajat_potrivire','fn_fost_angajat_leaga_extern','fn_hr_colab_ext_jurnal_imuabil','fn_hr_personal_extern_fost_angajat']::text[]) f
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: funcții lipsă după migrare: %', v_lipsa; END IF;
  SELECT array_agg(p.proname::text) INTO v_lipsa FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_colaborare_externa_seteaza','fn_employees_colab_ext_after','fn_employees_colab_ext_protectie','fn_extern_fost_angajat_potrivire','fn_fost_angajat_leaga_extern','fn_hr_colab_ext_jurnal_imuabil','fn_hr_personal_extern_fost_angajat']::text[]) AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c WHERE c LIKE 'search_path=%');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: SECURITY DEFINER fără search_path: %', v_lipsa; END IF;
  SELECT array_agg(p.proname::text) INTO v_lipsa FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_colaborare_externa_seteaza','fn_employees_colab_ext_after','fn_employees_colab_ext_protectie','fn_extern_fost_angajat_potrivire','fn_fost_angajat_leaga_extern','fn_hr_colab_ext_jurnal_imuabil','fn_hr_personal_extern_fost_angajat']::text[])
     AND p.proname <> ALL(ARRAY[]::text[]) AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: funcții executabile de anon: %', v_lipsa; END IF;
  -- tabelele noi: RLS activ, anon fără niciun drept
  SELECT array_agg(t) INTO v_lipsa FROM unnest(ARRAY['hr_colaborare_externa_jurnal']::text[]) t
   WHERE to_regclass('public.' || t) IS NULL
      OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t))
      OR has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: tabele fără RLS sau cu drepturi pentru anon: %', v_lipsa; END IF;
  -- triggerele cerute există și sunt active
  SELECT array_agg(t.r || '.' || t.n) INTO v_lipsa FROM (VALUES ('employees','trg_employees_colab_ext_lock'),('employees','trg_employees_colab_ext_protectie_ins'),('employees','trg_employees_colab_ext_protectie_upd'),('employees','trg_employees_zz_colab_ext'),('hr_colaborare_externa_jurnal','trg_hr_colab_ext_jurnal_imuabil'),('hr_personal_extern','trg_hr_personal_extern_fost_angajat')) AS t(r, n)
   WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.' || t.r) AND g.tgname = t.n AND g.tgenabled <> 'D');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: triggere lipsă/dezactivate: %', v_lipsa; END IF;
  v_n := 0;
END $post_livrare$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260929e_fost_angajat_colaborare_externa:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20260929e: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
