-- CORECTIE la 20260913_ofertare_pt_afirmatii.sql, scrisa cateva ore mai tarziu.
--
-- Afirmasem acolo, si in PR, ca potrivirea calificarii NU se poate verifica, fiindca
-- procedeu_sudura / calitate_material sunt goale in hr_autorizatii. Am generalizat de la UN
-- singur om (Trusu Dorel) fara sa ma uit la tipuri. E fals.
--
-- Masurat pe cele 468 de autorizatii active, cu flagurile din hr_autorizatii_tipuri:
--   procedeu_sudura   — 52 au tip care-l cere,  0 lipsesc
--   calitate_material — 52 il cer,             20 lipsesc
--   subcategorie      —  4 il cer,              1 lipseste
--   domenii           — 19 il cer,              2 lipsesc
-- Golul real: 23 de randuri, nu 420. NULL-urile lui Trusu Dorel erau CORECTE — tipul SUDOR_PEHD
-- are necesita_procedura = false. Iar omul are TREI autorizatii SUDOR_PEHD valabile pana in
-- 10.05.2028: ERP-ul stia tot timpul ca e sudor PE.
--
-- Calificarea se verifica prin TIPUL autorizatiei. Rolurile cerute la Motru au toate cod:
-- RTE, EGD, RTS, INSPECTOR_SSM_80, SUDOR_PEHD, SUDOR. Probat pe toate sase: fiecare om
-- nominalizat acolo AVEA calificarea ceruta, valabila la 22.06.2026.
--
-- DROP + CREATE, nu CREATE OR REPLACE: o coloana noua la mijloc nu se poate adauga prin REPLACE
-- ("cannot change name of view column"). Verificat inainte ca nimic nu depinde de view.

ALTER TABLE public.ofertare_pt_afirmatii
  ADD COLUMN IF NOT EXISTS tip_cerut_cod text;

COMMENT ON COLUMN public.ofertare_pt_afirmatii.tip_cerut_cod IS
  'Codul din hr_autorizatii_tipuri cerut de rolul asta (RTE, EGD, RTS, SUDOR_PEHD, SUDOR...). NULL = rolul nu cere o autorizatie anume, sau nu s-a stabilit inca.';

DROP VIEW IF EXISTS public.v_ofertare_pt_conformitate;

CREATE VIEW public.v_ofertare_pt_conformitate WITH (security_invoker = on) AS
SELECT
  a.id, a.licitatie_id, a.fel, a.text_brut, a.rol_propus, a.pagina,
  a.employee_id, a.exceptat, a.exceptat_motiv, a.tip_cerut_cod,
  e.name AS nume_in_erp, e.functie AS functie_in_erp,
  l.termen_depunere::date AS la_data,
  (a.fel = 'persoana' AND e.id IS NOT NULL AND (
      (e.termination_date IS NOT NULL AND e.termination_date < coalesce(l.termen_depunere::date, current_date))
   OR (e.termination_date IS NULL AND NOT e.active)))              AS om_plecat,
  (a.fel = 'persoana' AND a.employee_id IS NULL)                    AS om_negasit,
  (SELECT count(*) FROM public.hr_autorizatii h
    WHERE h.employee_id = e.id AND h.deleted_at IS NULL
      AND NOT h.fara_expirare
      AND h.data_expirare < coalesce(l.termen_depunere::date, current_date)) AS autorizatii_expirate,
  (a.fel = 'persoana' AND a.employee_id IS NOT NULL AND a.tip_cerut_cod IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.hr_autorizatii h
        JOIN public.hr_autorizatii_tipuri tt ON tt.id = h.tip_id
       WHERE h.employee_id = e.id AND h.deleted_at IS NULL
         AND tt.cod = a.tip_cerut_cod
         AND (h.fara_expirare OR h.data_expirare >= coalesce(l.termen_depunere::date, current_date))
    ))                                                              AS calificare_lipsa,
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
    -- Calificare lipsa = WARN, nu block: codul cerut il pune omul, iar o potrivire gresita de cod
    -- ar bloca un dosar bun. Decizia lui Razvan: blocant doar om inexistent si om plecat.
    WHEN a.fel = 'persoana' AND a.employee_id IS NOT NULL AND a.tip_cerut_cod IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.hr_autorizatii h
          JOIN public.hr_autorizatii_tipuri tt ON tt.id = h.tip_id
         WHERE h.employee_id = e.id AND h.deleted_at IS NULL
           AND tt.cod = a.tip_cerut_cod
           AND (h.fara_expirare OR h.data_expirare >= coalesce(l.termen_depunere::date, current_date))
      ) THEN 'warn'
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
  'Verdict per afirmatie a propunerii tehnice. block = om inexistent sau plecat la data depunerii (decizia Razvan 13.09.2026). warn = calificare lipsa (verificata prin hr_autorizatii_tipuri.cod), autorizatii expirate, aceeasi persoana pe doua roluri, utilaj/partener nelegat.';
