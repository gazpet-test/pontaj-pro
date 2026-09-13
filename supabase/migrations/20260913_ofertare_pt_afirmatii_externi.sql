-- Specialistii EXTERNI (terti sustinatori) in poarta de conformitate.
--
-- Poarta construita cu o ora inainte spunea "nu-i in employees => block", ceea ce ar fi dat rosu
-- pe FIECARE tert legitim. La Motru ar fi lovit exact in Marutoiu Ion (topograf PFA) si Tudoran
-- Daniela (SSM prin NISAB-CONS). Regula era buna pentru angajati si gresita pentru externi.
--
-- Baza avea deja ce trebuie: 21 de autorizatii cu employee_id NULL, aduse de pe NAS din dosarele
-- de licitatie — Stuparu Bogdan (RTE montaj instalatii), Nica Florentin (RTE 8.4T, PGT/EGT),
-- Tataru Adrian, Radu Ionut, Manciu, Tinca. Printre ele, randuri de tip FARA cu observatia
-- "DECLARATIE DE DISPONIBILITATE" — chiar documentul cerut de fisa de date pentru personal extern.
--
-- Orfanele nu au nicio cheie de persoana; numele apare doar in fisier_nume / observatii. Deci
-- legatura o face OMUL, explicit. NU o ghicim din numele fisierului: o potrivire gresita aici ar
-- trece un dosar fals drept verificat, adica exact esecul pe care poarta trebuie sa-l previna.
--
-- Regula finala, dupa decizia lui Razvan (blocant doar la fapte fara interpretare):
--   nici angajat, nici extern legat de o autorizatie  -> block   (cazul "Trusu Constantin")
--   angajat plecat la data depunerii                  -> block   (cazul "Iosif Catalin")
--   extern cu autorizatie, fara declaratie            -> warn
--   extern cu autorizatie expirata la acea data       -> warn
--   calificare ceruta lipsa / autorizatii expirate    -> warn
--   aceeasi persoana pe doua roluri                   -> warn
--
-- Probat pe sase cazuri reale: 2 block, 2 warn, 2 ok, exact cum trebuie.

ALTER TABLE public.ofertare_pt_afirmatii
  ADD COLUMN IF NOT EXISTS autorizatie_id     integer REFERENCES public.hr_autorizatii(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disponibilitate_id integer REFERENCES public.hr_autorizatii(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ofertare_pt_afirmatii.autorizatie_id IS
  'Pentru un specialist EXTERN: randul din hr_autorizatii care ii dovedeste calificarea (employee_id NULL acolo). La angajati se lasa NULL — calificarea se verifica prin tip.';
COMMENT ON COLUMN public.ofertare_pt_afirmatii.disponibilitate_id IS
  'Pentru un specialist EXTERN: randul din hr_autorizatii cu declaratia de disponibilitate. Fisa de date o cere; fara ea, afirmatia ramane avertisment.';

ALTER TABLE public.ofertare_pt_afirmatii
  DROP CONSTRAINT IF EXISTS ofertare_pt_afirmatii_extern_chk;
ALTER TABLE public.ofertare_pt_afirmatii
  ADD CONSTRAINT ofertare_pt_afirmatii_extern_chk CHECK (
    (autorizatie_id IS NULL AND disponibilitate_id IS NULL)
    OR (fel = 'persoana' AND employee_id IS NULL)
  );
-- corpul view-ului, identic cu cel aplicat prin apply_migration:

DROP VIEW IF EXISTS public.v_ofertare_pt_conformitate;

CREATE VIEW public.v_ofertare_pt_conformitate WITH (security_invoker = on) AS
WITH baza AS (
  SELECT
    a.id, a.licitatie_id, a.fel, a.text_brut, a.rol_propus, a.pagina,
    a.employee_id, a.exceptat, a.exceptat_motiv, a.tip_cerut_cod,
    a.autorizatie_id, a.disponibilitate_id,
    e.name AS nume_in_erp, e.functie AS functie_in_erp,
    l.termen_depunere::date AS la_data,
    (a.fel = 'persoana' AND a.employee_id IS NULL AND a.autorizatie_id IS NOT NULL) AS extern,
    (a.fel = 'persoana' AND e.id IS NOT NULL AND (
        (e.termination_date IS NOT NULL AND e.termination_date < coalesce(l.termen_depunere::date, current_date))
     OR (e.termination_date IS NULL AND NOT e.active)))              AS om_plecat,
    (a.fel = 'persoana' AND a.employee_id IS NULL AND a.autorizatie_id IS NULL) AS om_negasit,
    (SELECT count(*) FROM public.hr_autorizatii h
      WHERE h.employee_id = e.id AND h.deleted_at IS NULL
        AND NOT h.fara_expirare
        AND h.data_expirare < coalesce(l.termen_depunere::date, current_date)) AS autorizatii_expirate,
    (a.fel = 'persoana' AND a.employee_id IS NULL AND a.autorizatie_id IS NOT NULL
       AND a.disponibilitate_id IS NULL)                             AS extern_fara_disponibilitate,
    (a.autorizatie_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.hr_autorizatii h
         WHERE h.id = a.autorizatie_id AND h.deleted_at IS NULL AND NOT h.fara_expirare
           AND h.data_expirare < coalesce(l.termen_depunere::date, current_date))) AS autorizatie_extern_expirata,
    (a.fel = 'persoana' AND a.employee_id IS NOT NULL AND a.tip_cerut_cod IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.hr_autorizatii h
          JOIN public.hr_autorizatii_tipuri tt ON tt.id = h.tip_id
         WHERE h.employee_id = e.id AND h.deleted_at IS NULL
           AND tt.cod = a.tip_cerut_cod
           AND (h.fara_expirare OR h.data_expirare >= coalesce(l.termen_depunere::date, current_date))
      ))                                                             AS calificare_lipsa,
    (a.fel = 'persoana' AND a.employee_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.ofertare_pt_afirmatii b
         WHERE b.licitatie_id = a.licitatie_id AND b.fel = 'persoana'
           AND b.employee_id = a.employee_id AND b.id <> a.id
           AND coalesce(b.rol_propus,'') <> coalesce(a.rol_propus,''))) AS doua_roluri
  FROM public.ofertare_pt_afirmatii a
  JOIN public.ofertare_licitatii l ON l.id = a.licitatie_id
  LEFT JOIN public.employees e ON e.id = a.employee_id
)
SELECT b.*,
  CASE
    WHEN b.exceptat                       THEN 'exceptat'
    WHEN b.om_negasit                     THEN 'block'
    WHEN b.om_plecat                      THEN 'block'
    WHEN b.extern_fara_disponibilitate    THEN 'warn'
    WHEN b.autorizatie_extern_expirata    THEN 'warn'
    WHEN b.calificare_lipsa               THEN 'warn'
    WHEN b.autorizatii_expirate > 0       THEN 'warn'
    WHEN b.doua_roluri                    THEN 'warn'
    WHEN b.fel IN ('utilaj','partener') AND b.employee_id IS NULL THEN 'warn'
    ELSE 'ok'
  END AS verdict
FROM baza b;

COMMENT ON VIEW public.v_ofertare_pt_conformitate IS
  'Verdict per afirmatie a propunerii tehnice. block = nume care nu exista nici ca angajat nici ca extern legat de o autorizatie, sau om plecat la data depunerii (decizia Razvan 13.09.2026). warn = extern fara declaratie de disponibilitate, autorizatie expirata, calificare lipsa (prin hr_autorizatii_tipuri.cod), aceeasi persoana pe doua roluri, utilaj/partener nelegat.';
