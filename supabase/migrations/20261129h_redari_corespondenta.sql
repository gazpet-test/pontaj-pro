-- Version 20261129120700. Runner supplies one transaction.
-- 20261129h_redari_corespondenta — Redări: „Corespondență de trimis” (cerere Răzvan 03.11.2026: lista mailurilor/adreselor și ordinea lor, în ERP).
-- Ce face: tabel nou red_corespondenta (un rând = o comunicare: cod A1/B2/C1…, ordine, destinatar, expeditor, documente, dependențe, stare),
-- RLS ca restul Redări (citire = orice nivel; scriere = admin/editor; fără DELETE — anularea e stare), jurnal (fn_red_jurnal) și versiune (CAS în UI).
-- Regula lui Răzvan („nimic nu pleacă fără da-ul meu pe rând”) e în BD: starea `aprobat` o pune DOAR owner-ul (is_owner), cu aprobat_de/aprobat_la
-- puse de trigger; `trimis` / `raspuns_primit` sunt permise doar după `aprobat` și cer data trimiterii. Tabelul NU trimite nimic — e doar evidență.
-- Date: lista inițială din dialog\CHECKLIST_MAILURI_REDARI.md (instituții + expeditori interni, fără date personale ale proprietarilor).
-- Revenire: supabase/revenire/20261129h_redari_corespondenta_ROLLBACK.sql. DRY: supabase/tests/20261129h_redari_corespondenta_dryrun.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261129h_redari_corespondenta:' || txid_current() THEN
    RAISE EXCEPTION '20261129h: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_corespondenta') IS NOT NULL THEN RAISE EXCEPTION '20261129h: tabelul exista deja'; END IF;
  IF to_regclass('public.red_proiecte') IS NULL OR to_regprocedure('public.fn_red_nivel()') IS NULL OR to_regprocedure('public.fn_red_jurnal()') IS NULL
     OR to_regprocedure('public.fn_red_versiune_creste()') IS NULL THEN
    RAISE EXCEPTION '20261129h: lipseste schema Redari (red_proiecte / fn_red_nivel / fn_red_jurnal / fn_red_versiune_creste)';
  END IF;
  IF to_regprocedure('public.fn_red_corespondenta_reguli()') IS NOT NULL THEN RAISE EXCEPTION '20261129h: functia exista deja'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_proiecte WHERE cod = 'LOT1-PRUNISOR-JUPA') THEN RAISE EXCEPTION '20261129h: proiectul LOT1 lipseste'; END IF;
END $pre$;

CREATE TABLE public.red_corespondenta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  cod text NOT NULL CHECK (cod ~ '^[A-Z][0-9]{1,2}$'),
  ordine integer NOT NULL CHECK (ordine BETWEEN 1 AND 999),
  destinatar text NOT NULL CHECK (length(btrim(destinatar)) BETWEEN 1 AND 300),
  subiect text NOT NULL CHECK (length(btrim(subiect)) BETWEEN 1 AND 500),
  expeditor text CHECK (expeditor IS NULL OR length(expeditor) <= 200),
  documente text CHECK (documente IS NULL OR length(documente) <= 2000),
  depinde_de text CHECK (depinde_de IS NULL OR length(depinde_de) <= 1000),
  stare text NOT NULL DEFAULT 'draft' CHECK (stare IN ('draft', 'la_avocat', 'aprobat', 'trimis', 'raspuns_primit', 'anulat')),
  aprobat_de uuid,
  aprobat_la timestamptz,
  trimis_la date,
  nr_inregistrare text CHECK (nr_inregistrare IS NULL OR length(nr_inregistrare) <= 100),
  observatii text CHECK (observatii IS NULL OR length(observatii) <= 4000),
  versiune integer NOT NULL DEFAULT 1,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_corespondenta_cod_uq UNIQUE (proiect_id, cod),
  CONSTRAINT red_corespondenta_trimis_data CHECK (stare NOT IN ('trimis', 'raspuns_primit') OR trimis_la IS NOT NULL)
);
CREATE INDEX idx_red_corespondenta_proiect ON public.red_corespondenta (proiect_id, ordine);
COMMENT ON TABLE public.red_corespondenta IS 'Redări: corespondența de trimis (mailuri / adrese) și ordinea ei. Doar evidență — nu trimite nimic. aprobat = numai owner; trimis/raspuns_primit doar după aprobat.';

-- Regulile de stare. BEFORE INSERT OR UPDATE; SECURITY DEFINER doar pentru a citi profiles.is_owner (aceeași sursă ca fn_red_nivel).
CREATE FUNCTION public.fn_red_corespondenta_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_owner boolean; v_mentenanta boolean; v_era_aprobat boolean; v_continut boolean;
BEGIN
  -- Jakarinos r1 P1-02: mentenanta = sesiune SQL directa ca postgres (session_user nu se schimba in SECURITY DEFINER; PostgREST are session_user
  -- „authenticator”) si FARA claims JWT. service_role / anon / authenticated prin API nu sunt mentenanta.
  v_mentenanta := session_user = 'postgres' AND coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = '';
  v_owner := EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner);
  IF TG_OP = 'UPDATE' THEN
    IF NEW.proiect_id IS DISTINCT FROM OLD.proiect_id OR NEW.cod IS DISTINCT FROM OLD.cod OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'redari: proiectul, codul si autorul unei corespondente nu se schimba' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := now();
    NEW.aprobat_de := OLD.aprobat_de; NEW.aprobat_la := OLD.aprobat_la;   -- le pune doar triggerul
  ELSE
    -- Jakarinos r1 P2-03: autorul il pune triggerul (din aplicatie nu se poate falsifica)
    IF NOT v_mentenanta THEN NEW.created_by := auth.uid(); END IF;
    NEW.aprobat_de := NULL; NEW.aprobat_la := NULL; NEW.created_at := now(); NEW.updated_at := now(); NEW.versiune := 1;
  END IF;
  -- Jakarinos r1 P1-01: aprobarea e pe CONTINUT. Daca se schimba destinatarul, ce se trimite, expeditorul sau documentele, aprobarea cade;
  -- cu continut schimbat randul poate ramane doar in draft / la avocat / anulat (altfel ar pleca ceva neaprobat).
  v_continut := TG_OP = 'UPDATE' AND (NEW.destinatar, NEW.subiect, NEW.expeditor, NEW.documente) IS DISTINCT FROM (OLD.destinatar, OLD.subiect, OLD.expeditor, OLD.documente);
  IF v_continut AND OLD.aprobat_la IS NOT NULL THEN
    IF NEW.stare NOT IN ('draft', 'la_avocat', 'anulat') THEN
      RAISE EXCEPTION 'redari: continutul s-a schimbat dupa aprobare; treci randul in draft si cere din nou aprobarea' USING ERRCODE = '23514';
    END IF;
    NEW.aprobat_de := NULL; NEW.aprobat_la := NULL;
  END IF;
  v_era_aprobat := NEW.aprobat_la IS NOT NULL;
  IF NEW.stare = 'aprobat' AND (TG_OP = 'INSERT' OR OLD.stare IS DISTINCT FROM 'aprobat' OR NEW.aprobat_la IS NULL) THEN
    IF NOT (v_owner OR v_mentenanta) THEN RAISE EXCEPTION 'redari: doar Razvan (owner) aproba o corespondenta' USING ERRCODE = '42501'; END IF;
    NEW.aprobat_de := auth.uid(); NEW.aprobat_la := now(); v_era_aprobat := true;
  END IF;
  IF NEW.stare IN ('trimis', 'raspuns_primit') AND NOT v_era_aprobat THEN
    RAISE EXCEPTION 'redari: o corespondenta se marcheaza trimisa doar dupa aprobarea owner-ului' USING ERRCODE = '23514';
  END IF;
  -- revenirea din aprobat/trimis la draft/la_avocat sterge aprobarea (alt „da” la urmatoarea trimitere)
  IF NEW.stare IN ('draft', 'la_avocat') THEN NEW.aprobat_de := NULL; NEW.aprobat_la := NULL; END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_corespondenta_reguli() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_red_corespondenta_reguli BEFORE INSERT OR UPDATE ON public.red_corespondenta FOR EACH ROW EXECUTE FUNCTION public.fn_red_corespondenta_reguli();
CREATE TRIGGER trg_red_versiune BEFORE UPDATE ON public.red_corespondenta FOR EACH ROW EXECUTE FUNCTION public.fn_red_versiune_creste();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_corespondenta FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();

ALTER TABLE public.red_corespondenta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.red_corespondenta FROM PUBLIC, anon, authenticated;   -- privilegiile implicite Supabase dau ALL pe tabelele noi
GRANT SELECT, INSERT, UPDATE ON public.red_corespondenta TO authenticated;
GRANT ALL ON public.red_corespondenta TO service_role;
CREATE POLICY red_corespondenta_sel ON public.red_corespondenta FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
CREATE POLICY red_corespondenta_ins ON public.red_corespondenta FOR INSERT TO authenticated WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_corespondenta_upd ON public.red_corespondenta FOR UPDATE TO authenticated
  USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));

-- Lista inițială (CHECKLIST_MAILURI_REDARI.md, 02.11.2026), toate în `draft`. D1/D2 (mesaje interne către Ramona / R. Toma, deja trimise) nu intră: aici e doar corespondența externă.
INSERT INTO public.red_corespondenta (proiect_id, cod, ordine, destinatar, subiect, expeditor, documente, depinde_de, stare, observatii)
SELECT p.id, v.cod, v.ordine, v.destinatar, v.subiect, v.expeditor, v.documente, v.depinde_de, 'draft', v.observatii
FROM public.red_proiecte p, (VALUES
  ('A4', 10, 'Transgaz — DCC Prunișor–Jupa (dccprunisorjupa@transgaz.ro)', 'Solicitare fișier parcele afectate Lot 1 (poziție HG / km, DWG/SHP/KML)', 'Cristina Dumitrescu (CC office@)', 'Mail_A4_Cerere_DCC_fisier_parcele_Lot1_DE_TRIMIS_v2', 'independent — poate pleca primul', 'Necesar pentru atribuirea tronsoanelor (PV C).'),
  ('A1', 20, 'Transgaz', 'Scrisoarea cu planul de verificare a redărilor Lot 1 (+ ISC/DAJ)', 'Cristina Dumitrescu (CC office@)', 'Scrisoare_Transgaz_plan_verificare_Lot1 rev9 + Plan_verificare_redari_Lot1 rev48', 'avizul avocatului', NULL),
  ('A2', 21, 'Transgaz', 'Cererea de împuternicire către Beneficiar (anexă la A1)', 'Cristina Dumitrescu (CC office@)', 'ERP: Redări → Setări proiect → „Generează cererea (DOCX)”', 'A1', NULL),
  ('A3', 22, 'Transgaz (DPO)', 'Acord de prelucrare (art. 28 GDPR) + aprobarea informării GDPR', 'Cristina Dumitrescu (CC office@)', 'Adresa_TGZ_acord_prelucrare_si_aprobare_informare v1 + Informare_GDPR_Lot1 v3', 'avizul avocatului; poate pleca odată cu A1', 'După aprobare se publică pagina /redari/informare (PR #939).'),
  ('B1', 30, 'ISC Mehedinți', 'Documente de calitate pentru redare / recepție', 'de stabilit (office@ sau Cristina)', 'Adresa_ISC_carte_tehnica_redare_teren v2', 'avizul avocatului', NULL),
  ('B2', 31, 'DAJ Mehedinți', 'Cerere informații de interes public (L544/2001)', 'de stabilit (office@ sau Cristina)', 'Adresa_DAJ_Mehedinti_1_Cerere_L544 v2', 'avizul avocatului', NULL),
  ('B3', 32, 'DAJ Mehedinți', 'Fond funciar — punct de vedere privind redarea în circuitul agricol', 'de stabilit (office@ sau Cristina)', 'Adresa_DAJ_Mehedinti_2_Punct_de_vedere v2', 'avizul avocatului', NULL),
  ('A5', 40, 'Transgaz → Gazpet', 'Primirea împuternicirii și a listei actualizate a deținătorilor (tipizat Anexa 7)', NULL, 'cerută prin A2 (Model_7_Anexa7_Tipizat v5)', 'A1/A2 aprobate de Transgaz', 'Pas de primire, nu de trimitere.'),
  ('C1', 50, 'Primăriile celor 7 UAT-uri', 'Adresa pentru afișare, programul sesiunilor și sala', 'de stabilit', 'ERP: Redări → UAT-uri → „Generează adresa UAT”', 'A5 (împuternicirea primită); datele primăriilor (Ramona, termen 04.11); zilele de sesiune', NULL),
  ('C2', 60, 'Proprietarii / deținătorii', 'Convocări (poștă cu confirmare de primire + QR / link formular)', 'de stabilit', 'ERP: Redări → Registru / Fișa parcelei', 'C1; A5', 'Import TGZ făcut 02.11 (2443 parcele / 2548 deținători); 150 ambigue + 182 erori de tratat. Decizie deschisă: plic per convocare sau plic comun.')
) AS v(cod, ordine, destinatar, subiect, expeditor, documente, depinde_de, observatii)
WHERE p.cod = 'LOT1-PRUNISOR-JUPA';

DO $post$
BEGIN
  IF (SELECT count(*) FROM public.red_corespondenta) <> 10 THEN RAISE EXCEPTION '20261129h: lista initiala incompleta'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_corespondenta') <> 3 THEN RAISE EXCEPTION '20261129h: politici'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.red_corespondenta'::regclass) THEN RAISE EXCEPTION '20261129h: RLS oprit'; END IF;
  IF has_table_privilege('anon', 'public.red_corespondenta', 'SELECT') OR has_table_privilege('authenticated', 'public.red_corespondenta', 'DELETE') THEN
    RAISE EXCEPTION '20261129h: drepturi prea largi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_corespondenta_reguli()'::regprocedure AND prosecdef AND 'search_path=public, pg_temp' = ANY(proconfig))
     OR has_function_privilege('authenticated', 'public.fn_red_corespondenta_reguli()', 'EXECUTE') THEN
    RAISE EXCEPTION '20261129h: functia de reguli are setari gresite';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_corespondenta'::regclass AND NOT tgisinternal) <> 3 THEN RAISE EXCEPTION '20261129h: triggere'; END IF;
END $post$;
