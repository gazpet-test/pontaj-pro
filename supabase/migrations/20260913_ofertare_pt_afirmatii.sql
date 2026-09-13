-- ofertare_pt_afirmatii — poarta de CONFORMITATE a propunerii tehnice.
--
-- Poarta veche (v_ofertare_pt_stare) raspunde la "e construit?": fiecare cerinta are un capitol.
-- Asta raspunde la alta intrebare, "e adevarat?": ce afirma documentul despre oamenii, utilajele
-- si partenerii nostri se potriveste cu ce are firma de fapt.
--
-- De ce exista, pe scurt, din cazul MOTRU (propunere 345 pag., depusa 22.06.2026):
--   - "Iosif Catalin" declarat sudor disponibil. NICU IOSIF CATALIN (id 85) era lichidat pe
--     16.06.2026 — cu sase zile inainte. Firma AVEA alti sudori; n-a fost lipsa de oameni,
--     a fost lipsa de verificare.
--   - "Trusu Constantin" declarat sudor PE. Nu exista nimeni cu numele asta; era TRUSU DOREL.
-- Ambele gasite cu un SELECT, in cateva secunde, intr-un document citit de mai multi oameni.
--
-- Propunerile de distributie gaze sunt scrise de un colaborator extern, care cere informatiile
-- pe rand. Deci defectele vin din ce i se trimite. Tabelul asta tine ce AFIRMA documentul;
-- view-ul de dedesubt spune unde se bate cap in cap cu ERP-ul.

CREATE TABLE IF NOT EXISTS public.ofertare_pt_afirmatii (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id  bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  fel           text   NOT NULL CHECK (fel IN ('persoana','utilaj','partener')),
  -- textul EXACT din propunere, nenormalizat. Daca scrie "Trusu Constantin", asta se pastreaza:
  -- verdictul trebuie sa poata arata omului ce scrie in document, nu ce am dedus noi.
  text_brut     text   NOT NULL CHECK (btrim(text_brut) <> ''),
  rol_propus    text,
  pagina        integer CHECK (pagina IS NULL OR pagina > 0),
  -- legatura confirmata de om catre realitate. NULL = nelegata inca (sau negasita).
  -- employees.id e INTEGER, nu bigint: un FK bigint->integer nici nu se poate crea.
  employee_id   integer REFERENCES public.employees(id) ON DELETE SET NULL,
  -- cand omul a stabilit ca afirmatia e gresita dar acceptabila (typo corectat, extern fara
  -- contract in ERP), scrie de ce. Fara motiv, exceptia nu se poate salva.
  exceptat      boolean NOT NULL DEFAULT false,
  exceptat_motiv text,
  sursa         text   NOT NULL DEFAULT 'om' CHECK (sursa IN ('om','ai')),
  nota          text,
  creat_de      uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofertare_pt_afirmatii_exceptat_chk
    CHECK (NOT exceptat OR btrim(coalesce(exceptat_motiv,'')) <> ''),
  -- employee_id are sens doar la persoane
  CONSTRAINT ofertare_pt_afirmatii_emp_chk
    CHECK (employee_id IS NULL OR fel = 'persoana'),
  CONSTRAINT ofertare_pt_afirmatii_unic UNIQUE (licitatie_id, fel, text_brut, rol_propus)
);

CREATE INDEX IF NOT EXISTS ofertare_pt_afirmatii_lic_idx ON public.ofertare_pt_afirmatii (licitatie_id);
CREATE INDEX IF NOT EXISTS ofertare_pt_afirmatii_emp_idx ON public.ofertare_pt_afirmatii (employee_id);

COMMENT ON TABLE  public.ofertare_pt_afirmatii IS 'Ce AFIRMA propunerea tehnica despre oameni/utilaje/parteneri. Confruntat cu ERP-ul in v_ofertare_pt_conformitate.';
COMMENT ON COLUMN public.ofertare_pt_afirmatii.text_brut IS 'Textul exact din document, nenormalizat — ca verdictul sa arate ce scrie acolo, nu ce am dedus.';

-- RLS: REVOKE inainte de GRANT, ca la celelalte tabele ofertare.
ALTER TABLE public.ofertare_pt_afirmatii ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_pt_afirmatii FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertare_pt_afirmatii TO authenticated;
GRANT ALL    ON public.ofertare_pt_afirmatii TO service_role;

DROP POLICY IF EXISTS ofertare_pt_afirmatii_select ON public.ofertare_pt_afirmatii;
CREATE POLICY ofertare_pt_afirmatii_select ON public.ofertare_pt_afirmatii
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ofertare_pt_afirmatii_write ON public.ofertare_pt_afirmatii;
CREATE POLICY ofertare_pt_afirmatii_write ON public.ofertare_pt_afirmatii
  FOR ALL TO authenticated
  USING       ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK  ((SELECT public.fn_are_acces_ofertare()));

-- functia casei e set_updated_at(), aceeasi folosita de trg_pt_capitole_upd.
DROP TRIGGER IF EXISTS trg_pt_afirmatii_upd ON public.ofertare_pt_afirmatii;
CREATE TRIGGER trg_pt_afirmatii_upd
  BEFORE UPDATE ON public.ofertare_pt_afirmatii
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Verdictul, per afirmatie ──────────────────────────────────────────
-- Decizia lui Razvan, 13.09.2026: BLOCANT doar la om inexistent si om plecat. Restul, avertisment.
-- Motivul: alea doua sunt fapte verificabile fara interpretare, si exact ele au trecut la Motru.
--
-- Verificarea se face LA DATA DEPUNERII (ofertare_licitatii.termen_depunere), nu la "azi" —
-- altfel o propunere corecta la vremea ei ar iesi rosie peste un an, iar una gresita la vremea ei
-- ar iesi verde daca omul s-a reangajat intre timp.
--
-- CE NU POATE VERIFICA INCA: daca autorizatia e pentru ce i se cere (sudor PE, ANRE EGD, 8.4.D).
-- Campurile procedeu_sudura / calitate_material / diametru_teava_mm sunt goale pe autorizatiile
-- din hr_autorizatii — verificat pe Trusu Dorel (id 120): 6 autorizatii valabile, toate cu
-- campurile alea NULL. Pana se completeaza (task #46), poarta prinde om inexistent si om plecat,
-- dar nu si calificare nepotrivita. Randul 'calificare' de mai jos spune asta pe fata, ca sa nu
-- para acoperit ce nu e.
CREATE OR REPLACE VIEW public.v_ofertare_pt_conformitate WITH (security_invoker = on) AS
SELECT
  a.id, a.licitatie_id, a.fel, a.text_brut, a.rol_propus, a.pagina,
  a.employee_id, a.exceptat, a.exceptat_motiv,
  e.name AS nume_in_erp, e.functie AS functie_in_erp,
  l.termen_depunere::date AS la_data,
  -- persoana plecata INAINTE de depunere (sau inactiva fara data): cazul Nicu Iosif Catalin
  (a.fel = 'persoana' AND e.id IS NOT NULL AND (
      (e.termination_date IS NOT NULL AND e.termination_date < coalesce(l.termen_depunere::date, current_date))
   OR (e.termination_date IS NULL AND NOT e.active)))              AS om_plecat,
  -- persoana nominalizata pe care n-o gasim deloc: cazul "Trusu Constantin"
  (a.fel = 'persoana' AND a.employee_id IS NULL)                    AS om_negasit,
  -- autorizatii expirate la data depunerii — avertisment, nu blocaj
  (SELECT count(*) FROM public.hr_autorizatii h
    WHERE h.employee_id = e.id AND h.deleted_at IS NULL
      AND NOT h.fara_expirare
      AND h.data_expirare < coalesce(l.termen_depunere::date, current_date)) AS autorizatii_expirate,
  -- aceeasi persoana pe mai multe roluri in aceeasi propunere
  (a.fel = 'persoana' AND a.employee_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.ofertare_pt_afirmatii b
       WHERE b.licitatie_id = a.licitatie_id AND b.fel = 'persoana'
         AND b.employee_id = a.employee_id AND b.id <> a.id
         AND coalesce(b.rol_propus,'') <> coalesce(a.rol_propus,''))) AS doua_roluri,
  CASE
    WHEN a.exceptat THEN 'exceptat'
    WHEN a.fel = 'persoana' AND a.employee_id IS NULL THEN 'block'
    WHEN a.fel = 'persoana' AND e.id IS NOT NULL AND (
         (e.termination_date IS NOT NULL AND e.termination_date < coalesce(l.termen_depunere::date, current_date))
      OR (e.termination_date IS NULL AND NOT e.active)) THEN 'block'
    WHEN a.fel = 'persoana' AND EXISTS (
         SELECT 1 FROM public.hr_autorizatii h
          WHERE h.employee_id = e.id AND h.deleted_at IS NULL AND NOT h.fara_expirare
            AND h.data_expirare < coalesce(l.termen_depunere::date, current_date)) THEN 'warn'
    WHEN a.fel = 'persoana' AND a.employee_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.ofertare_pt_afirmatii b
          WHERE b.licitatie_id = a.licitatie_id AND b.fel = 'persoana'
            AND b.employee_id = a.employee_id AND b.id <> a.id
            AND coalesce(b.rol_propus,'') <> coalesce(a.rol_propus,'')) THEN 'warn'
    WHEN a.fel IN ('utilaj','partener') AND a.employee_id IS NULL THEN 'warn'
    ELSE 'ok'
  END AS verdict
FROM public.ofertare_pt_afirmatii a
JOIN public.ofertare_licitatii l ON l.id = a.licitatie_id
LEFT JOIN public.employees e ON e.id = a.employee_id;

COMMENT ON VIEW public.v_ofertare_pt_conformitate IS
  'Verdict per afirmatie a propunerii tehnice. block = om inexistent sau plecat la data depunerii (decizia Razvan 13.09.2026); restul warn. NU verifica potrivirea calificarii — campurile de procedeu din hr_autorizatii sunt goale (task #46).';
