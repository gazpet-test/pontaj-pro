-- Pachetul de PERSONAL pentru cine scrie propunerea tehnica.
--
-- De ce exista: propunerile de distributie gaze se scriu de un colaborator extern, care cere
-- informatiile pe rand. Ce primeste, primeste din fisiere adunate manual — asa a ajuns la Motru
-- un sudor lichidat cu sase zile inainte de depunere si un nume care nu exista in firma. Aici,
-- lista se genereaza din ERP, LA DATA DEPUNERII, si nu are cum sa fie veche.
--
-- Probat pe 22.06.2026 (data reala a depunerii la Motru): 17 sudori OL si 6 sudori PEHD
-- disponibili, 5 cu EGD, 3 cu RTE, 3 cu INSPECTOR_SSM_80, 2 cu RTS. Propunerea nominaliza 3 OL
-- si 5 PE. Nicu Iosif Catalin NU apare — functia il exclude singura, fiindca plecase pe 16.06.
--
-- SECURITY INVOKER, DELIBERAT — abatere de la regula 4 din CLAUDE.md ("functii -> SECURITY
-- DEFINER"). employees, hr_autorizatii si hr_autorizatii_tipuri au toate RLS cu politici; o
-- functie DEFINER peste ele ar deschide datele de HR oricui are acces la Ofertare, ocolind exact
-- politicile care le pazesc. Regula e buna ca implicit, gresita aici. search_path ramane fixat.
--
-- ATENTIE la numarat: un om poate avea MAI MULTE autorizatii de acelasi tip (6 sudori PEHD au
-- intre ei 18 autorizatii). count(*) numara autorizatii, nu oameni — pentru oameni,
-- count(DISTINCT employee_id).
CREATE OR REPLACE FUNCTION public.fn_ofertare_personal_disponibil(p_la_data date DEFAULT current_date)
RETURNS TABLE (
  employee_id      integer,
  nume             text,
  functie          text,
  tip_cod          text,
  tip_denumire     text,
  categorie        text,
  numar_autorizatie text,
  emitent          text,
  expira           date,
  zile_ramase      integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT e.id, e.name, e.functie,
         t.cod, t.denumire, t.categorie,
         a.numar_autorizatie, a.emitent,
         a.data_expirare,
         CASE WHEN a.fara_expirare THEN NULL
              ELSE (a.data_expirare - p_la_data)::integer END
  FROM public.employees e
  JOIN public.hr_autorizatii a        ON a.employee_id = e.id AND a.deleted_at IS NULL
  JOIN public.hr_autorizatii_tipuri t ON t.id = a.tip_id
  WHERE e.active
    AND (e.termination_date IS NULL OR e.termination_date >= p_la_data)
    AND (e.hire_date IS NULL OR e.hire_date <= p_la_data)
    AND (a.fara_expirare OR a.data_expirare >= p_la_data)
  ORDER BY t.categorie, t.cod, e.name;
$fn$;

REVOKE ALL     ON FUNCTION public.fn_ofertare_personal_disponibil(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_ofertare_personal_disponibil(date) TO authenticated;

COMMENT ON FUNCTION public.fn_ofertare_personal_disponibil(date) IS
  'Personalul cu autorizatii VALABILE la o data data (implicit azi), pentru pachetul trimis celui care scrie propunerea tehnica. SECURITY INVOKER intentionat: datele de HR raman sub RLS-ul lor.';
