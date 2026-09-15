-- Task #70 (Oana Nica), varianta A: raport semi-automat „Calificare > CIM".
-- Angajați cu o autorizație/calificare valabilă al cărei cod COR diferă de codul COR
-- din CIM → HR decide dacă e nevoie de act adițional. Datele de referință (cod COR pe
-- tip de autorizație și pe angajat) se completează MANUAL de HR, nu se deduc.
-- Presupuneri verificate în repo: employees.active (boolean), employees.termination_date,
-- employees.functie (text liber, rămâne neatinsă), hr_autorizatii.deleted_at / fara_expirare /
-- data_expirare / data_emitere / numar_autorizatie / tip_id, hr_autorizatii_tipuri.denumire / activ.

-- 1. Coloane noi pe tipurile de autorizații (completate manual din HR → Autorizații → ⚙ Tipuri)
ALTER TABLE public.hr_autorizatii_tipuri
  ADD COLUMN IF NOT EXISTS calificare_denumire text,
  ADD COLUMN IF NOT EXISTS cod_cor text;
COMMENT ON COLUMN public.hr_autorizatii_tipuri.calificare_denumire IS
  'Denumirea calificării/ocupației pe care o atestă acest tip de autorizație (ex. „Sudor", „Instalator gaze"). Completat manual de HR (task #70).';
COMMENT ON COLUMN public.hr_autorizatii_tipuri.cod_cor IS
  'Cod COR al calificării atestate de tip. NULL = tipul nu intră în raportul „Calificare > CIM". Completat manual de HR (task #70).';

-- 2. Coloane noi pe angajat (CIM). employees.functie (text liber) există deja și NU se redenumește.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS cod_cor text,
  ADD COLUMN IF NOT EXISTS functie_cim text;
COMMENT ON COLUMN public.employees.cod_cor IS
  'Cod COR din contractul individual de muncă (CIM). Editabil din fișa angajatului (HR). Task #70.';
COMMENT ON COLUMN public.employees.functie_cim IS
  'Funcția exact așa cum apare în CIM (opțional; employees.functie rămâne funcția operațională). Task #70.';

-- 3. View: un rând per (angajat activ, tip de autorizație) cu cod COR diferit de cel din CIM.
--    Angajați fără cod COR pe CIM apar și ei (coalesce → '') — HR vede că lipsește datele.
CREATE OR REPLACE VIEW public.v_hr_calificare_peste_cim
WITH (security_invoker = on) AS
SELECT DISTINCT ON (e.id, t.id)
  e.id                     AS employee_id,
  e.name                   AS employee_name,
  e.functie,
  e.cod_cor                AS cod_cor_cim,
  a.id                     AS autorizatie_id,
  t.denumire               AS tip_denumire,
  t.calificare_denumire,
  t.cod_cor                AS cod_cor_calificare,
  a.numar_autorizatie,
  a.data_expirare,
  a.data_emitere           AS data_obtinerii
FROM public.employees e
JOIN public.hr_autorizatii a        ON a.employee_id = e.id AND a.deleted_at IS NULL
JOIN public.hr_autorizatii_tipuri t ON t.id = a.tip_id
WHERE e.active
  AND (e.termination_date IS NULL OR e.termination_date >= current_date)
  AND (a.fara_expirare OR a.data_expirare IS NULL OR a.data_expirare >= current_date)
  AND t.cod_cor IS NOT NULL AND btrim(t.cod_cor) <> ''
  AND btrim(t.cod_cor) <> coalesce(btrim(e.cod_cor), '')
ORDER BY e.id, t.id, a.data_expirare DESC NULLS FIRST, a.id DESC;

COMMENT ON VIEW public.v_hr_calificare_peste_cim IS
  'Task #70: listă orientativă pentru HR — angajați activi cu o autorizație valabilă al cărei cod COR (pe tip) diferă de codul COR din CIM. Decizia de act adițional e a HR.';

GRANT SELECT ON public.v_hr_calificare_peste_cim TO authenticated, service_role;
