# EMPLOYEES PII - inventar static

Inventar initial pastrat mai jos. Verdictul curent despre Magazie si payload-uri
este in [raportul r5](EMPLOYEES_PII_R5_RAPORT.md), inclusiv verificarile la DRY.

Sursa: worktree, fara conexiune BD. Nu reprezinta catalogul live.
Fiecare aparitie executabila directa/embed este listata; SQL include si DDL/FK/trigger pentru completitudine.
Coloanele SQL sunt un superset de identificatori din blocul obiectului (pot apartine si altor tabele), nu dovada ca toate sunt returnate. Vezi constatarile revizuite pentru datele personale.
Inventarul pre-schimbare este pastrat; liniile indica versiunea initiala.

## Citiri / scrieri src si edge

| Loc | Utilizator | Operatie / coloane cerute | Personal necesar |
| --- | --- | --- | --- |
| src/Achizitii.jsx:1655 | ERP: Achizitii | `.from('employees').select('id, name')` | Nu; identificare/operational |
| src/AdeverinteLegator.jsx:459 | ERP: AdeverinteLegator | `employees(name)` | Nu; identificare/operational |
| src/App.jsx:1306 | ERP: App | `.from('employees').select('*,sites(name)')` | DE AUDITAT: wildcard |
| src/App.jsx:1315 | ERP: App | `employees(name,department,sites(name)` | Nu; identificare/operational |
| src/App.jsx:1401 | ERP: App | `employees(name)` | Nu; identificare/operational |
| src/App.jsx:1870 | ERP: App | `.from('employees').select('*,sites(name)')` | DE AUDITAT: wildcard |
| src/App.jsx:1993 | ERP: App | `.from('employees').update({site_id:siteId})` | Nu; identificare/operational |
| src/App.jsx:2408 | ERP: App | `.from('employees').select('id, name')` | Nu; identificare/operational |
| src/App.jsx:2745 | ERP: App | `employees!inner(name, functie)` | Nu; identificare/operational |
| src/App.jsx:3023 | ERP: App | `.from('employees').select('*')` | DE AUDITAT: wildcard |
| src/App.jsx:3136 | ERP: App | `.from('employees').select('id, functie, position, departament_hr, department')` | Nu; identificare/operational |
| src/App.jsx:3590 | ERP: App | `.from('employees').select('id, name')` | Nu; identificare/operational |
| src/App.jsx:4395 | ERP: App | `.from('employees').select('*,sites(name)')` | DE AUDITAT: wildcard |
| src/App.jsx:4845 | ERP: App | `.from('employees').select('*')` | DE AUDITAT: wildcard |
| src/App.jsx:5147 | ERP: App | `.from('employees').select('*')` | DE AUDITAT: wildcard |
| src/App.jsx:5204 | ERP: App | `.from('employees').select('*')` | DE AUDITAT: wildcard |
| src/App.jsx:6536 | ERP: App | `.from('employees').select('*,sites(name)')` | DE AUDITAT: wildcard |
| src/App.jsx:6671 | ERP: App | `.from('employees').select('id')` | Nu; identificare/operational |
| src/App.jsx:6819 | ERP: App | `.from('employees').insert({name:eName.trim(),department:eDept,position:ePos\|\|null,site_id:eSite?Number(eSite):null,active:true,hire_date:eHireDate\|\|null})` | Nu; identificare/operational |
| src/App.jsx:6841 | ERP: App | `.from('employees').update(updates)` | Nu; identificare/operational |
| src/App.jsx:6880 | ERP: App | `.from('employees').update(empUpdates)` | Nu; identificare/operational |
| src/App.jsx:6906 | ERP: App | `.from('employees').delete()` | Nu; identificare/operational |
| src/App.jsx:6937 | ERP: App | `.from('employees').insert(ins.slice(i,i+50))` | Nu; identificare/operational |
| src/App.jsx:8405 | ERP: App | `.from('employees').select('*,sites(name)')` | DE AUDITAT: wildcard |
| src/App.jsx:8445 | ERP: App | `.from('employees').update({email:editSal.empEmail})` | email |
| src/CereriInterneProiect.jsx:649 | ERP: CereriInterneProiect | `.from('employees').select('id, name, department, departament_hr')` | Nu; identificare/operational |
| src/CitesteOricePanel.jsx:320 | ERP: CitesteOricePanel | `.from('employees').select('id,name')` | Nu; identificare/operational |
| src/Executie.jsx:504 | ERP: Executie | `.from('employees').select('id, name')` | Nu; identificare/operational |
| src/Executie.jsx:1235 | ERP: Executie | `.from('employees').select('id, name, functie')` | Nu; identificare/operational |
| src/Executie.jsx:1794 | ERP: Executie | `.from('employees').select('id, name, functie')` | Nu; identificare/operational |
| src/Executie.jsx:3016 | ERP: Executie | `.from('employees').select('id, name, functie')` | Nu; identificare/operational |
| src/Executie.jsx:3028 | ERP: Executie | `.from('employees').select('id, name, functie')` | Nu; identificare/operational |
| src/ExecutieDeciziiEchipa.jsx:36 | ERP: ExecutieDeciziiEchipa | `.from('employees').select('id, name')` | Nu; identificare/operational |
| src/HomeScada.jsx:14 | ERP: HomeScada | `.from('employees').select('id',{count:'exact',head:true})` | Nu; identificare/operational |
| src/HR.jsx:183 | HR / owner | `.from('employees').select('*, sites(name)')` | DE AUDITAT: wildcard |
| src/HR.jsx:325 | HR / owner | `.from('employees').select('*')` | DE AUDITAT: wildcard |
| src/HR.jsx:1598 | HR / owner | `.from('employees').update({ are_autorizatii: val })` | Nu; identificare/operational |
| src/HR.jsx:1609 | HR / owner | `.from('employees').update({ functie: val \|\| null })` | Nu; identificare/operational |
| src/HR.jsx:1619 | HR / owner | `.from('employees').update({ cod_cor: val \|\| null })` | Nu; identificare/operational |
| src/HrAngajatNouWizard.jsx:289 | HR / owner | `.from('employees').insert({ name: f.nume.trim().toUpperCase(), department: f.department, functie: f.functie.trim() \|\| null, position: f.functie.trim() \|\| null, telefon: f.telefon.trim() \|\| null, email: f.email.trim() \|\| null, iban: f.iban.trim() \|\| null, cnp: f.cnp.trim() \|\| null, adresa: f.adresa.trim() \|\| null, data_nasterii: f.data_nasterii \|\| null, hire_date: f.hire_date, cetatenie, active: true, }) RETURNING .select('id,name')` | cnp,iban,adresa,data_nasterii,telefon,email |
| src/HrAutorizatiiCitire.jsx:64 | HR / owner | `employees(name)` | Nu; identificare/operational |
| src/HrAutorizatiiCitire.jsx:67 | HR / owner | `employees(name)` | Nu; identificare/operational |
| src/HrDecizii.jsx:68 | HR / owner | `.from('employees').select('id, name, active, termination_date, position, functie')` | Nu; identificare/operational |
| src/HrDeciziiGenerator.jsx:60 | HR / owner | `.from('employees').select('id, name, active, termination_date')` | Nu; identificare/operational |
| src/HrDiplomeCalificari.jsx:70 | HR / owner | `employees!inner(id, name, active, functie, position)` | Nu; identificare/operational |
| src/HrFostiAngajati.jsx:79 | HR / owner | `.from('employees').select(SELECT_FOSTI)` | Nu; identificare/operational |
| src/HrPersonalExtern.jsx:86 | HR / owner | `.from('employees').select('id,name,email,termination_date,active')` | email |
| src/HrPersonalExtern.jsx:94 | HR / owner | `.from('employees') .select('id,name,active,termination_date,colaborare_externa_status,colaborare_externa_confirmat_la')` | Nu; identificare/operational |
| src/HrRecomandari.jsx:181 | HR / owner | `employees(name, functie)` | Nu; identificare/operational |
| src/ImprumuturiEchipamente.jsx:75 | ERP: ImprumuturiEchipamente | `.from('employees').select('id, name')` | Nu; identificare/operational |
| src/Logistica.jsx:1291 | ERP: Logistica | `.from('employees') .select('id, name')` | Nu; identificare/operational |
| src/Logistica.jsx:4411 | ERP: Logistica | `.from('employees').select('id, name, position, department, functii_extra, functie')` | Nu; identificare/operational |
| src/Logistica.jsx:4487 | ERP: Logistica | `.from('employees').update({ functii_extra: nou })` | Nu; identificare/operational |
| src/Logistica.jsx:5349 | ERP: Logistica | `.from('employees').select('id, name, position, department, functii_extra')` | Nu; identificare/operational |
| src/Logistica.jsx:7013 | ERP: Logistica | `employees!sofer_employee_id(id, name, position)` | Nu; identificare/operational |
| src/Logistica.jsx:7440 | ERP: Logistica | `employees!sofer_employee_id(id, name, position)` | Nu; identificare/operational |
| src/Logistica.jsx:7935 | ERP: Logistica | `.from('employees').select('id, name', { count: 'exact' })` | Nu; identificare/operational |
| src/Logistica.jsx:9043 | ERP: Logistica | `.from('employees') .select('id, name, functie, qr_pin, qr_pin_active, qr_pin_creat_la')` | qr_pin,qr_pin_active,qr_pin_creat_la |
| src/Logistica.jsx:9068 | ERP: Logistica | `employees!qr_sofer_id(name)` | Nu; identificare/operational |
| src/Logistica.jsx:9235 | ERP: Logistica | `.from('employees') .update({ qr_pin: newPin, qr_pin_active: true, qr_pin_creat_la: new Date().toISOString() })` | qr_pin,qr_pin_active,qr_pin_creat_la |
| src/Logistica.jsx:9243 | ERP: Logistica | `.from('employees').select('id, name, functie, qr_pin, qr_pin_active, qr_pin_creat_la')` | qr_pin,qr_pin_active,qr_pin_creat_la |
| src/Logistica.jsx:9250 | ERP: Logistica | `.from('employees').update({ qr_pin_active: newActive })` | qr_pin_active |
| src/Logistica.jsx:9256 | ERP: Logistica | `.from('employees').select('id, name, functie, qr_pin, qr_pin_active, qr_pin_creat_la')` | qr_pin,qr_pin_active,qr_pin_creat_la |
| src/Logistica.jsx:11405 | ERP: Logistica | `.from('employees').select('id, name')` | Nu; identificare/operational |
| src/Magazie.jsx:505 | ERP: Magazie | `.from('employees').select('id, name, functie, marime_incaltaminte, marime_imbracaminte')` | marime_incaltaminte,marime_imbracaminte |
| src/Magazie.jsx:900 | ERP: Magazie | `.from('employees').update({ [campMasura]: valoare \|\| null })` | Nu; identificare/operational |
| src/OfertareCerinte.jsx:176 | ERP: OfertareCerinte | `employees(name)` | Nu; identificare/operational |
| src/OfertareCerinte.jsx:578 | ERP: OfertareCerinte | `employees(name)` | Nu; identificare/operational |
| src/OfertareCerinte.jsx:578 | ERP: OfertareCerinte | `employees(name)` | Nu; identificare/operational |
| src/OfertareCerinte.jsx:578 | ERP: OfertareCerinte | `employees(name)` | Nu; identificare/operational |
| src/ofertareLantProbatorDate.js:4 | ERP: ofertareLantProbatorDate | `employees(name)` | Nu; identificare/operational |
| src/ofertareLantProbatorDate.js:4 | ERP: ofertareLantProbatorDate | `employees(name)` | Nu; identificare/operational |
| src/ofertareLantProbatorDate.js:4 | ERP: ofertareLantProbatorDate | `employees(name)` | Nu; identificare/operational |
| src/OfertareLicitatii.jsx:2808 | ERP: OfertareLicitatii | `employees(name)` | Nu; identificare/operational |
| src/OfertareLicitatii.jsx:2808 | ERP: OfertareLicitatii | `employees(name)` | Nu; identificare/operational |
| src/OfertareLicitatii.jsx:2808 | ERP: OfertareLicitatii | `employees(name)` | Nu; identificare/operational |
| src/OfertareLicitatii.jsx:3239 | ERP: OfertareLicitatii | `employees(name, active)` | Nu; identificare/operational |
| src/OfertareLicitatii.jsx:3243 | ERP: OfertareLicitatii | `employees(name, active)` | Nu; identificare/operational |
| src/OfertareLicitatii.jsx:3246 | ERP: OfertareLicitatii | `employees(name, active)` | Nu; identificare/operational |
| src/OfertareLicitatii.jsx:3250 | ERP: OfertareLicitatii | `employees(name, active)` | Nu; identificare/operational |
| src/OfertareNomenclatoare.jsx:221 | ERP: OfertareNomenclatoare | `.from('employees').select('id', { count:'exact', head:true })` | Nu; identificare/operational |
| src/OfertareOrganigrama.jsx:655 | ERP: OfertareOrganigrama | `.from('employees').select('id, name, functie')` | Nu; identificare/operational |
| src/OfertareOrganigrama.jsx:703 | ERP: OfertareOrganigrama | `employees(name)` | Nu; identificare/operational |
| src/OrganigramaPropuneri.jsx:72 | ERP: OrganigramaPropuneri | `employees(id, name, functie, functie_cim, departament_hr, department)` | Nu; identificare/operational |
| src/OrganigramaPropuneri.jsx:74 | ERP: OrganigramaPropuneri | `.from('employees').select('id, name, functie, functie_cim, departament_hr, department, active')` | Nu; identificare/operational |
| src/TabDocumentePersonale.jsx:737 | ERP: TabDocumentePersonale | `employees(name, functie, departament_hr, cetatenie, cetatenie_secundara)` | Nu; identificare/operational |
| src/TabSantiere.jsx:116 | ERP: TabSantiere | `.from('employees').select('id,name,functie,department')` | Nu; identificare/operational |
| src/TabSantiere.jsx:2327 | ERP: TabSantiere | `employees(id, name, functie)` | Nu; identificare/operational |
| src/TabSantiere.jsx:3524 | ERP: TabSantiere | `employees(name)` | Nu; identificare/operational |
| src/TabSemnaturi.jsx:592 | ERP: TabSemnaturi | `.from('employees').select('id, name, department, position, sites(name)')` | Nu; identificare/operational |
| src/TabSemnaturi.jsx:865 | ERP: TabSemnaturi | `.from('employees').select('id, name, department, position')` | Nu; identificare/operational |
| src/Tichete.jsx:164 | ERP: Tichete | `.from('employees').select('id, name, functie')` | Nu; identificare/operational |
| supabase/functions/citeste-orice/index.ts:216 | Server: citeste-orice | `.from('employees').select('id,name')` | Nu; identificare/operational |
| supabase/functions/hr-autorizatie-citeste/index.ts:183 | Server: hr-autorizatie-citeste | `employees(name)` | Nu; identificare/operational |
| supabase/functions/hr-autorizatii-scan/index.ts:76 | Server: hr-autorizatii-scan | `employees(name)` | Nu; identificare/operational |
| supabase/functions/hr-autorizatii-scan/index.ts:98 | Server: hr-autorizatii-scan | `employees(name)` | Nu; identificare/operational |
| supabase/functions/hr-digest-saptamanal/index.ts:50 | Server: hr-digest-saptamanal | `employees!inner(name, active)` | Nu; identificare/operational |
| supabase/functions/hr-digest-saptamanal/index.ts:55 | Server: hr-digest-saptamanal | `employees!inner(name, active)` | Nu; identificare/operational |
| supabase/functions/hr-digest-saptamanal/index.ts:62 | Server: hr-digest-saptamanal | `employees!inner(name, active)` | Nu; identificare/operational |
| supabase/functions/hr-digest-saptamanal/index.ts:79 | Server: hr-digest-saptamanal | `employees(name)` | Nu; identificare/operational |
| supabase/functions/hr-recomandare-citeste/index.ts:191 | Server: hr-recomandare-citeste | `employees(name)` | Nu; identificare/operational |
| supabase/functions/ofertare-acoperire/core.ts:123 | Server: ofertare-acoperire | `employees(name, active)` | Nu; identificare/operational |
| supabase/functions/ofertare-acoperire/core.ts:164 | Server: ofertare-acoperire | `employees(name, active)` | Nu; identificare/operational |
| supabase/functions/ofertare-acoperire/core.ts:171 | Server: ofertare-acoperire | `employees(name, active)` | Nu; identificare/operational |
| supabase/functions/ofertare-acoperire/core.ts:177 | Server: ofertare-acoperire | `employees(name, active)` | Nu; identificare/operational |
| supabase/functions/ofertare-acoperire/core.ts:260 | Server: ofertare-acoperire | `.from('employees') .select('name, functie, position, hire_date')` | Nu; identificare/operational |
| supabase/functions/ofertare-genereaza-capitol/index.ts:101 | Server: ofertare-genereaza-capitol | `employees(name, functie)` | Nu; identificare/operational |
| supabase/functions/ofertare-genereaza-capitol/index.ts:101 | Server: ofertare-genereaza-capitol | `employees(name)` | Nu; identificare/operational |
| supabase/functions/ofertare-genereaza-capitol/index.ts:101 | Server: ofertare-genereaza-capitol | `employees(name)` | Nu; identificare/operational |
| supabase/functions/ofertare-triere/index.ts:157 | Server: ofertare-triere | `employees(name, position, active)` | Nu; identificare/operational |
| supabase/functions/ofertare-triere/index.ts:159 | Server: ofertare-triere | `.from('employees').select('name, position, functie')` | Nu; identificare/operational |
| supabase/functions/ofertare-triere/index.ts:163 | Server: ofertare-triere | `employees(name, active)` | Nu; identificare/operational |
| api/hr-drive-import.js:105 | Server: api | `.from('employees').select('id, name, active')` | Nu; identificare/operational |
| api/hr-fise-import.js:58 | Server: api | `.from('employees').select('id, name, active')` | Nu; identificare/operational |

Apeluri directe gasite: {'src': 62, 'supabase/functions': 3, 'api': 2}. Numarul din brief nu este folosit ca total presupus.

## SQL: migrari, obiecte si coloane

| Loc | Obiect / context | Coloane mentionate in obiect (superset) | Referinta |
| --- | --- | --- | --- |
| supabase/migrations/20260913_fn_ofertare_personal_disponibil.sql:44 | public.fn_ofertare_personal_disponibil | id,name,active,hire_date,termination_date,functie | `FROM public.employees e` |
| supabase/migrations/20260913_ofertare_pt_afirmatii.sql:29 | IF | id,created_at | `employee_id   integer REFERENCES public.employees(id) ON DELETE SET NULL,` |
| supabase/migrations/20260913_ofertare_pt_afirmatii.sql:133 | public.v_ofertare_pt_conformitate | id,name,active,termination_date,functie | `LEFT JOIN public.employees e ON e.id = a.employee_id;` |
| supabase/migrations/20260913_ofertare_pt_afirmatii_calificare.sql:88 | public.v_ofertare_pt_conformitate | id,name,active,termination_date,functie | `LEFT JOIN public.employees e ON e.id = a.employee_id;` |
| supabase/migrations/20260913_ofertare_pt_afirmatii_externi.sql:84 | public.v_ofertare_pt_conformitate | id,name,active,termination_date,functie | `LEFT JOIN public.employees e ON e.id = a.employee_id` |
| supabase/migrations/20260914_conformitate_cumul_functii.sql:51 | public.v_ofertare_pt_conformitate | id,name,active,termination_date,functie | `LEFT JOIN employees e ON e.id = a.employee_id` |
| supabase/migrations/20260914_v_executie_alocari_conflicte.sql:22 | public.v_executie_alocari_conflicte | id,name | `JOIN public.employees e ON e.id = a1.employee_id` |
| supabase/migrations/20260915_hr_autorizatii_notificare_noi.sql:64 | public.fn_trg_hr_autorizatie_noua | id,name,created_at | `SELECT e.name INTO v_persoana FROM public.employees e WHERE e.id = NEW.employee_id;` |
| supabase/migrations/20260915_hr_calificare_peste_cim.sql:19 | DDL/preflight | functie,cod_cor,functie_cim | `ALTER TABLE public.employees` |
| supabase/migrations/20260915_hr_calificare_peste_cim.sql:22 | DDL/preflight | functie,cod_cor,functie_cim | `COMMENT ON COLUMN public.employees.cod_cor IS` |
| supabase/migrations/20260915_hr_calificare_peste_cim.sql:24 | DDL/preflight | functie,functie_cim | `COMMENT ON COLUMN public.employees.functie_cim IS` |
| supabase/migrations/20260915_hr_calificare_peste_cim.sql:25 | DDL/preflight | functie | `'Funct\u0326ia exact as\u0326a cum apare i\u0302n CIM (opt\u0326ional; employees.functie ra\u0306ma\u0302ne funct\u0326ia operat\u0326ionala\u0306). Task #70.';` |
| supabase/migrations/20260915_hr_calificare_peste_cim.sql:43 | public.v_hr_calificare_peste_cim | id,name,active,termination_date,functie,cod_cor | `FROM public.employees e` |
| supabase/migrations/20260915_hr_recomandari.sql:7 | IF | id,created_at | `employee_id     integer REFERENCES public.employees(id) ON DELETE SET NULL,` |
| supabase/migrations/20260928b_hr_formare_profesionala.sql:10 | public.hr_formare_profesionala | id,created_at | `employee_id        integer NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,` |
| supabase/migrations/20260928c_logistica_imprumuturi.sql:8 | public.logistica_imprumuturi | id,created_at | `employee_id        integer REFERENCES public.employees(id) ON DELETE SET NULL,` |
| supabase/migrations/20260929c_conturi_legare_automata.sql:346 | public.fn_cont_serializare_activa | email,name | `WHERE g.tgrelid = to_regclass('public.employees') AND g.tgname = 'trg_employees_persoana_lock'` |
| supabase/migrations/20260929c_conturi_legare_automata.sql:396 | public.fn_cont_candidati_angajat | email,id,name,active,termination_date | `FROM public.employees e` |
| supabase/migrations/20260929c_conturi_legare_automata.sql:611 | public.fn_cont_revalideaza_candidat | email,id,active,termination_date | `PERFORM 1 FROM public.employees e WHERE e.id = p_emp FOR UPDATE;                 -- 1) fis\u0326a` |
| supabase/migrations/20260929c_conturi_legare_automata.sql:642 | public.fn_cont_revalideaza_candidat | email,id,active,termination_date | `IF NOT EXISTS (SELECT 1 FROM public.employees e` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:310 | public.fn_cont_persoana_cnp | cnp,email,id | `SELECT public.fn_cont_cnp_normalizat(e.cnp) FROM public.employees e WHERE e.id = p_employee_id) x` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:373 | public.fn_cont_alt_contract_activ | cnp,email,id,active,termination_date | `FROM public.employees b` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:394 | public.fn_cont_posibil_aceeasi_persoana | email,id,name,active,termination_date | `FROM public.employees e WHERE e.id = p_employee_id` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:397 | public.fn_cont_posibil_aceeasi_persoana | email,id,name,active,termination_date | `FROM public.employees b, a` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:433 | public.fn_cont_garda_persoana | email,id,name | `FROM public.employees e WHERE e.id = p_employee_id;` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:473 | public.fn_cont_motiv_garda | email,id,name | `split_part(p_garda, ':', 2), COALESCE((SELECT e.name FROM public.employees e WHERE e.id::text = split_part(p_garda, ':', 2)), ''))` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:524 | public.fn_employees_persoana_lock | cnp,email,id,name,active,termination_date | `DROP TRIGGER IF EXISTS trg_employees_persoana_lock ON public.employees;` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:525 | trg_employees_persoana_lock | cnp,email,name,active,termination_date | `CREATE TRIGGER trg_employees_persoana_lock BEFORE INSERT OR UPDATE OF cnp, active, termination_date, name, email ON public.employees` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:563 | public.fn_hr_employees_private_persoana_lock | cnp,email,id,name | `FROM public.employees e` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:602 | public.fn_cont_revocat_nu_scrie | Niciuna explicita (verifica rowtype/*) | `DROP TRIGGER IF EXISTS trg_employees_00_cont_revocat ON public.employees;` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:603 | trg_employees_00_cont_revocat | Niciuna explicita (verifica rowtype/*) | `CREATE TRIGGER trg_employees_00_cont_revocat BEFORE INSERT OR UPDATE OR DELETE ON public.employees` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:857 | public.fn_employees_ciclu_cont | email,id,name,active,termination_date | `SELECT e.id FROM public.employees e` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:1044 | public.fn_employees_ciclu_cont | email,id,name,active,termination_date | `DROP TRIGGER IF EXISTS trg_employees_zz_ciclu_cont ON public.employees;` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:1045 | trg_employees_zz_ciclu_cont | active,termination_date | `CREATE TRIGGER trg_employees_zz_ciclu_cont AFTER UPDATE ON public.employees` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:1113 | public.fn_conturi_inchideri_sweep | email,id,name,active,termination_date | `PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE NOWAIT;` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:1115 | public.fn_conturi_inchideri_sweep | email,id,name,active,termination_date | `PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE;` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:1154 | public.fn_conturi_inchideri_sweep | email,id,name,active,termination_date | `SELECT y.* INTO e FROM public.employees y WHERE y.id = x.employee_id;   -- recitire dupa\u0306 lock (revalidare)` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:1529 | public.fn_admin_conturi_alerte | email,id,name,active,termination_date | `LEFT JOIN public.employees e ON e.id = p.employee_id` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:1626 | public.fn_admin_conturi_alerte | email,id,name,active,termination_date | `FROM public.employees e` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:1674 | public.fn_admin_conturi_alerte | email,id,name,active,termination_date | `SELECT array_agg(t.r  /  /  '.'  /  /  t.n) INTO v_lipsa FROM (VALUES ('conturi_inchideri_jurnal','trg_conturi_inchideri_append_only'),('conturi_inchideri_jurnal','trg_conturi_inchideri_fara_truncate'),('employees','trg_employees_persoana_lock'),('employees','trg_employees_00_cont_revocat'),('employees','trg_employees_zz_ciclu_cont'),('hr_employees_private','trg_hr_employees_private_persoana_lock'),('hr_employees_private','trg_hr_employees_private_00_cont_revocat')) AS t(r, n)` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:1674 | public.fn_admin_conturi_alerte | email,id,name,active,termination_date | `SELECT array_agg(t.r  /  /  '.'  /  /  t.n) INTO v_lipsa FROM (VALUES ('conturi_inchideri_jurnal','trg_conturi_inchideri_append_only'),('conturi_inchideri_jurnal','trg_conturi_inchideri_fara_truncate'),('employees','trg_employees_persoana_lock'),('employees','trg_employees_00_cont_revocat'),('employees','trg_employees_zz_ciclu_cont'),('hr_employees_private','trg_hr_employees_private_persoana_lock'),('hr_employees_private','trg_hr_employees_private_00_cont_revocat')) AS t(r, n)` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql:1674 | public.fn_admin_conturi_alerte | email,id,name,active,termination_date | `SELECT array_agg(t.r  /  /  '.'  /  /  t.n) INTO v_lipsa FROM (VALUES ('conturi_inchideri_jurnal','trg_conturi_inchideri_append_only'),('conturi_inchideri_jurnal','trg_conturi_inchideri_fara_truncate'),('employees','trg_employees_persoana_lock'),('employees','trg_employees_00_cont_revocat'),('employees','trg_employees_zz_ciclu_cont'),('hr_employees_private','trg_hr_employees_private_persoana_lock'),('hr_employees_private','trg_hr_employees_private_00_cont_revocat')) AS t(r, n)` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare_ROLLBACK.sql:47 | DDL/preflight | Niciuna explicita (verifica rowtype/*) | `DROP TRIGGER IF EXISTS trg_employees_zz_ciclu_cont ON public.employees;` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare_ROLLBACK.sql:49 | DDL/preflight | Niciuna explicita (verifica rowtype/*) | `DROP TRIGGER IF EXISTS trg_employees_persoana_lock ON public.employees;` |
| supabase/migrations/20260929d_conturi_inchidere_la_incetare_ROLLBACK.sql:53 | DDL/preflight | Niciuna explicita (verifica rowtype/*) | `DROP TRIGGER IF EXISTS trg_employees_00_cont_revocat ON public.employees;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:73 | DDL/preflight | active,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `ALTER TABLE public.employees` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:81 | DDL/preflight | active,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.employees'::regclass AND conname = 'employees_colab_ext_status_chk') THEN` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:82 | DDL/preflight | active,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `ALTER TABLE public.employees ADD CONSTRAINT employees_colab_ext_status_chk` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:85 | DDL/preflight | active,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.employees'::regclass AND conname = 'employees_colab_ext_dovada_chk') THEN` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:86 | DDL/preflight | active,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `ALTER TABLE public.employees ADD CONSTRAINT employees_colab_ext_dovada_chk CHECK (` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:95 | DDL/preflight | active,colaborare_externa_status,colaborare_externa_nota | `COMMENT ON COLUMN public.employees.colaborare_externa_status IS` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:97 | DDL/preflight | active,colaborare_externa_nota | `COMMENT ON COLUMN public.employees.colaborare_externa_nota IS` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:159 | public.fn_employees_colab_ext_protectie | id,active,termination_date,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `DROP TRIGGER IF EXISTS trg_employees_colab_ext_protectie_ins ON public.employees;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:160 | trg_employees_colab_ext_protectie_ins | colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la | `CREATE TRIGGER trg_employees_colab_ext_protectie_ins BEFORE INSERT ON public.employees` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:165 | trg_employees_colab_ext_protectie_ins | colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la | `DROP TRIGGER IF EXISTS trg_employees_colab_ext_protectie_upd ON public.employees;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:166 | trg_employees_colab_ext_protectie_upd | active,termination_date,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `CREATE TRIGGER trg_employees_colab_ext_protectie_upd BEFORE UPDATE ON public.employees` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:227 | trg_hr_colab_ext_jurnal_imuabil | email,id | `FOREIGN KEY (fost_angajat_employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:250 | public.fn_extern_fost_angajat_potrivire | email,id,name,active,termination_date | `FROM public.employees e` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:308 | public.fn_employees_colab_ext_lock | email,id,name | `DROP TRIGGER IF EXISTS trg_employees_colab_ext_lock ON public.employees;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:310 | trg_employees_colab_ext_lock | email,name,active,termination_date,colaborare_externa_status,colaborare_externa_nota,colaborare_externa_document | `colaborare_externa_status, colaborare_externa_nota, colaborare_externa_document ON public.employees` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:312 | trg_employees_colab_ext_lock | email,name,active,termination_date,colaborare_externa_status,colaborare_externa_nota,colaborare_externa_document | `DROP TRIGGER IF EXISTS trg_employees_colab_ext_lock_ins ON public.employees;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:313 | trg_employees_colab_ext_lock_ins | active | `CREATE TRIGGER trg_employees_colab_ext_lock_ins BEFORE INSERT ON public.employees` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:347 | public.fn_hr_personal_extern_fost_angajat | email,id,name,active,termination_date,colaborare_externa_status | `SELECT e.id, e.active, e.termination_date INTO v_e FROM public.employees e WHERE e.id = NEW.fost_angajat_employee_id;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:358 | public.fn_hr_personal_extern_fost_angajat | email,id,name,active,termination_date,colaborare_externa_status | `FROM public.employees e WHERE e.id = NEW.fost_angajat_employee_id;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:374 | public.fn_hr_personal_extern_fost_angajat | email,id,name,active,termination_date,colaborare_externa_status | `SELECT e.id, e.name INTO v_pot FROM public.employees e` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:488 | public.fn_employees_colab_ext_after | email,id,name,active,termination_date,colaborare_externa_status,colaborare_externa_nota,colaborare_externa_document | `DROP TRIGGER IF EXISTS trg_employees_zz_colab_ext ON public.employees;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:489 | trg_employees_zz_colab_ext | email,active,termination_date,colaborare_externa_status,colaborare_externa_nota,colaborare_externa_document | `CREATE TRIGGER trg_employees_zz_colab_ext AFTER UPDATE ON public.employees FOR EACH ROW` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:498 | trg_employees_zz_colab_ext | email,active,termination_date,colaborare_externa_status,colaborare_externa_nota,colaborare_externa_document | `DROP TRIGGER IF EXISTS trg_employees_zz_colab_ext_ins ON public.employees;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:499 | trg_employees_zz_colab_ext_ins | active | `CREATE TRIGGER trg_employees_zz_colab_ext_ins AFTER INSERT ON public.employees FOR EACH ROW` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:527 | public.fn_colaborare_externa_seteaza | id,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `SELECT e.id INTO v_e FROM public.employees e WHERE e.id = p_employee_id FOR UPDATE;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:531 | public.fn_colaborare_externa_seteaza | id,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `UPDATE public.employees e` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:542 | public.fn_colaborare_externa_seteaza | id,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `FROM public.employees e WHERE e.id = p_employee_id);` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:554 | public.fn_fost_angajat_leaga_extern | telefon,email,id,name,position,active,termination_date,functie,colaborare_externa_status | `v_e    public.employees%ROWTYPE;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:564 | public.fn_fost_angajat_leaga_extern | telefon,email,id,name,position,active,termination_date,functie,colaborare_externa_status | `SELECT * INTO v_e FROM public.employees WHERE id = p_employee_id FOR UPDATE;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:633 | public.fn_fost_angajat_leaga_extern | telefon,email,id,name,position,active,termination_date,functie,colaborare_externa_status | `SELECT array_agg(t.r  /  /  '.'  /  /  t.n) INTO v_lipsa FROM (VALUES ('employees','trg_employees_colab_ext_lock'),('employees','trg_employees_colab_ext_lock_ins'),('employees','trg_employees_colab_ext_protectie_ins'),('employees','trg_employees_colab_ext_protectie_upd'),('employees','trg_employees_zz_colab_ext'),('employees','trg_employees_zz_colab_ext_ins'),('hr_colaborare_externa_jurnal','trg_hr_colab_ext_jurnal_imuabil'),('hr_personal_extern','trg_hr_personal_extern_fost_angajat')) AS t(r, n)` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:633 | public.fn_fost_angajat_leaga_extern | telefon,email,id,name,position,active,termination_date,functie,colaborare_externa_status | `SELECT array_agg(t.r  /  /  '.'  /  /  t.n) INTO v_lipsa FROM (VALUES ('employees','trg_employees_colab_ext_lock'),('employees','trg_employees_colab_ext_lock_ins'),('employees','trg_employees_colab_ext_protectie_ins'),('employees','trg_employees_colab_ext_protectie_upd'),('employees','trg_employees_zz_colab_ext'),('employees','trg_employees_zz_colab_ext_ins'),('hr_colaborare_externa_jurnal','trg_hr_colab_ext_jurnal_imuabil'),('hr_personal_extern','trg_hr_personal_extern_fost_angajat')) AS t(r, n)` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:633 | public.fn_fost_angajat_leaga_extern | telefon,email,id,name,position,active,termination_date,functie,colaborare_externa_status | `SELECT array_agg(t.r  /  /  '.'  /  /  t.n) INTO v_lipsa FROM (VALUES ('employees','trg_employees_colab_ext_lock'),('employees','trg_employees_colab_ext_lock_ins'),('employees','trg_employees_colab_ext_protectie_ins'),('employees','trg_employees_colab_ext_protectie_upd'),('employees','trg_employees_zz_colab_ext'),('employees','trg_employees_zz_colab_ext_ins'),('hr_colaborare_externa_jurnal','trg_hr_colab_ext_jurnal_imuabil'),('hr_personal_extern','trg_hr_personal_extern_fost_angajat')) AS t(r, n)` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:633 | public.fn_fost_angajat_leaga_extern | telefon,email,id,name,position,active,termination_date,functie,colaborare_externa_status | `SELECT array_agg(t.r  /  /  '.'  /  /  t.n) INTO v_lipsa FROM (VALUES ('employees','trg_employees_colab_ext_lock'),('employees','trg_employees_colab_ext_lock_ins'),('employees','trg_employees_colab_ext_protectie_ins'),('employees','trg_employees_colab_ext_protectie_upd'),('employees','trg_employees_zz_colab_ext'),('employees','trg_employees_zz_colab_ext_ins'),('hr_colaborare_externa_jurnal','trg_hr_colab_ext_jurnal_imuabil'),('hr_personal_extern','trg_hr_personal_extern_fost_angajat')) AS t(r, n)` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:633 | public.fn_fost_angajat_leaga_extern | telefon,email,id,name,position,active,termination_date,functie,colaborare_externa_status | `SELECT array_agg(t.r  /  /  '.'  /  /  t.n) INTO v_lipsa FROM (VALUES ('employees','trg_employees_colab_ext_lock'),('employees','trg_employees_colab_ext_lock_ins'),('employees','trg_employees_colab_ext_protectie_ins'),('employees','trg_employees_colab_ext_protectie_upd'),('employees','trg_employees_zz_colab_ext'),('employees','trg_employees_zz_colab_ext_ins'),('hr_colaborare_externa_jurnal','trg_hr_colab_ext_jurnal_imuabil'),('hr_personal_extern','trg_hr_personal_extern_fost_angajat')) AS t(r, n)` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql:633 | public.fn_fost_angajat_leaga_extern | telefon,email,id,name,position,active,termination_date,functie,colaborare_externa_status | `SELECT array_agg(t.r  /  /  '.'  /  /  t.n) INTO v_lipsa FROM (VALUES ('employees','trg_employees_colab_ext_lock'),('employees','trg_employees_colab_ext_lock_ins'),('employees','trg_employees_colab_ext_protectie_ins'),('employees','trg_employees_colab_ext_protectie_upd'),('employees','trg_employees_zz_colab_ext'),('employees','trg_employees_zz_colab_ext_ins'),('hr_colaborare_externa_jurnal','trg_hr_colab_ext_jurnal_imuabil'),('hr_personal_extern','trg_hr_personal_extern_fost_angajat')) AS t(r, n)` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql:8 | DDL/preflight | colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `DROP TRIGGER IF EXISTS trg_employees_zz_colab_ext ON public.employees;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql:9 | DDL/preflight | colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `DROP TRIGGER IF EXISTS trg_employees_zz_colab_ext_ins ON public.employees;      -- r7` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql:10 | DDL/preflight | colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `DROP TRIGGER IF EXISTS trg_employees_colab_ext_lock ON public.employees;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql:11 | DDL/preflight | colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `DROP TRIGGER IF EXISTS trg_employees_colab_ext_lock_ins ON public.employees;    -- r7` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql:13 | DDL/preflight | colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `DROP TRIGGER IF EXISTS trg_employees_colab_ext_protectie_ins ON public.employees;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql:14 | DDL/preflight | colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `DROP TRIGGER IF EXISTS trg_employees_colab_ext_protectie_upd ON public.employees;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql:34 | DDL/preflight | colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_colab_ext_dovada_chk;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql:35 | DDL/preflight | colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_colab_ext_status_chk;` |
| supabase/migrations/20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql:36 | DDL/preflight | colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document | `ALTER TABLE public.employees` |
| supabase/migrations/20261002b_conturi_p2_followup.sql:113 | DDL/preflight | cnp,email,name,active,termination_date | `IF NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.employees') AND g.tgname = 'trg_employees_persoana_lock' AND g.tgqual IS NULL` |
| supabase/migrations/20261002b_conturi_p2_followup.sql:212 | public.fn_cont_serializare_activa | cnp,email,name,active,termination_date | `WHERE g.tgrelid = to_regclass('public.employees') AND g.tgname = 'trg_employees_persoana_lock'` |
| supabase/migrations/20261002b_conturi_p2_followup.sql:261 | public.fn_cont_revalideaza_candidat | email,id,active,termination_date | `PERFORM 1 FROM public.employees e WHERE e.id = p_emp FOR UPDATE NOWAIT;      -- 1) fis\u0326a (fa\u0306ra\u0306 as\u0326teptare: lotul t\u0326ine deja lock-uri)` |
| supabase/migrations/20261002b_conturi_p2_followup.sql:263 | public.fn_cont_revalideaza_candidat | email,id,active,termination_date | `PERFORM 1 FROM public.employees e WHERE e.id = p_emp FOR UPDATE;             -- 1) fis\u0326a` |
| supabase/migrations/20261002b_conturi_p2_followup.sql:300 | public.fn_cont_revalideaza_candidat | email,id,active,termination_date | `IF NOT EXISTS (SELECT 1 FROM public.employees e` |
| supabase/migrations/20261002b_conturi_p2_followup.sql:487 | public.fn_conturi_inchideri_sweep | email,id,name,active,termination_date | `PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE NOWAIT;` |
| supabase/migrations/20261002b_conturi_p2_followup.sql:489 | public.fn_conturi_inchideri_sweep | email,id,name,active,termination_date | `PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE;` |
| supabase/migrations/20261002b_conturi_p2_followup.sql:526 | public.fn_conturi_inchideri_sweep | email,id,name,active,termination_date | `SELECT y.* INTO e FROM public.employees y WHERE y.id = x.employee_id;   -- recitire dupa\u0306 lock (revalidare)` |
| supabase/migrations/20261017a_executie_sef_santier.sql:44 | DDL/preflight | id | `IS DISTINCT FROM 'FOREIGN KEY (rts_employee_id) REFERENCES employees(id) / aa / true' THEN` |
| supabase/migrations/20261017a_executie_sef_santier.sql:47 | DDL/preflight | id | `IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.employees'::regclass AND attname = 'id') IS DISTINCT FROM 'integer'` |
| supabase/migrations/20261017a_executie_sef_santier.sql:48 | DDL/preflight | id | `OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.employees'::regclass AND contype = 'p'` |
| supabase/migrations/20261017a_executie_sef_santier.sql:49 | DDL/preflight | id | `AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.employees'::regclass AND attname = 'id')]) THEN` |
| supabase/migrations/20261017a_executie_sef_santier.sql:50 | DDL/preflight | id | `RAISE EXCEPTION 'Precondit\u0326ie 0e: employees.id nu e integer PRIMARY KEY';` |
| supabase/migrations/20261017a_executie_sef_santier.sql:57 | DDL/preflight | id | `FOREIGN KEY (sef_santier_employee_id) REFERENCES public.employees(id);` |
| supabase/migrations/20261017a_executie_sef_santier.sql:59 | DDL/preflight | id | `'S\u0326ef de s\u0326antier (employees.id). Ada\u0306ugat 20261017a; completat manual din fis\u0326a proiectului (Execut\u0326ie), fa\u0306ra\u0306 propuneri automate i\u0302n v1.';` |
| supabase/migrations/20261017a_executie_sef_santier.sql:72 | DDL/preflight | id | `IS DISTINCT FROM 'FOREIGN KEY (sef_santier_employee_id) REFERENCES employees(id) / aa / true' THEN` |
| supabase/migrations/20261018a_hr_decizii_registru.sql:69 | DDL/preflight | id | `IF (SELECT count(*) FROM public.employees WHERE id IN (121, 90, 125)) <> 3 THEN` |
| supabase/migrations/20261018a_hr_decizii_registru.sql:70 | DDL/preflight | Niciuna explicita (verifica rowtype/*) | `RAISE EXCEPTION 'Precondit\u0326ie 0e: semnatarii 121/90/125 lipsesc din employees';` |
| supabase/migrations/20261018a_hr_decizii_registru.sql:87 | public.hr_decizii_semnatari | id | `employee_id int NOT NULL REFERENCES public.employees(id),` |
| supabase/migrations/20261018a_hr_decizii_registru.sql:133 | public.hr_decizii | id | `employee_id int REFERENCES public.employees(id),` |
| supabase/migrations/20261018a_hr_decizii_registru.sql:503 | public._hr_decizie_intrari_rand | id,name,active,termination_date | `INTO v_tinta_emp FROM public.employees e WHERE e.id = t.employee_id;` |
| supabase/migrations/20261018a_hr_decizii_registru.sql:508 | public._hr_decizie_intrari_rand | id,name,active,termination_date | `'nume', coalesce(t.snapshot->'persoana'->>'nume', public._hr_nume_afis((SELECT e.name FROM public.employees e WHERE e.id = t.employee_id)), t.persoana_nume),` |
| supabase/migrations/20261018a_hr_decizii_registru.sql:523 | public._hr_decizie_intrari_rand | id,name,active,termination_date | `'nume', public._hr_nume_afis((SELECT e.name FROM public.employees e WHERE e.id = s.employee_id)));` |
| supabase/migrations/20261018a_hr_decizii_registru.sql:537 | public._hr_decizie_intrari_rand | id,name,active,termination_date | `IF p_blocheaza THEN PERFORM 1 FROM public.employees WHERE id = p_r.employee_id FOR SHARE; END IF;` |
| supabase/migrations/20261018a_hr_decizii_registru.sql:540 | public._hr_decizie_intrari_rand | id,name,active,termination_date | `INTO v_emp FROM public.employees e WHERE e.id = p_r.employee_id;` |
| supabase/migrations/20261018a_hr_decizii_registru.sql:1346 | public.fn_hr_decizie_ataseaza_scan | id,name | `v_nume := coalesce(t.snapshot->'persoana'->>'nume', public._hr_nume_afis((SELECT e.name FROM public.employees e WHERE e.id = t.employee_id)));` |
| supabase/migrations/20261018a_hr_decizii_registru.sql:1395 | public.fn_hr_decizie_ataseaza_scan | id,name | ` /  /  coalesce(public._hr_nume_afis((SELECT e.name FROM public.employees e WHERE e.id::text = v_cur)), v_cur) END,` |
| supabase/migrations/20261018a_hr_decizii_registru.sql:1507 | public._hr_snapshot_simplu | id,name | `'nume', coalesce(public._hr_nume_afis((SELECT e.name FROM public.employees e WHERE e.id = r.employee_id)), r.persoana_nume)),` |
| supabase/migrations/20261018a_hr_decizii_registru.sql:1510 | public._hr_snapshot_simplu | id,name | `'nume', public._hr_nume_afis((SELECT e.name FROM public.employees e WHERE e.id = s.employee_id)))` |
| supabase/migrations/20261103b_izometrie_e3_documente.sql:1210 | DDL/preflight | id,name,position,created_at | `'trigger trg_employees_persoana_lock on public.employees=9dcecd0c70efdf1bf5e24e9c1157bc11',` |
| supabase/migrations/20261103b_izometrie_e3_documente.sql:1211 | DDL/preflight | id,name,position,created_at | `'trigger trg_employees_zz_ciclu_cont on public.employees=8b5dbbd69476106544cff2b5393c116a',` |
| supabase/migrations/20261106a_izometrie_e3b_corectii.sql:3108 | DDL/preflight | Niciuna explicita (verifica rowtype/*) | `'trigger trg_employees_persoana_lock on public.employees=9dcecd0c70efdf1bf5e24e9c1157bc11',` |
| supabase/migrations/20261106a_izometrie_e3b_corectii.sql:3109 | DDL/preflight | Niciuna explicita (verifica rowtype/*) | `'trigger trg_employees_zz_ciclu_cont on public.employees=8b5dbbd69476106544cff2b5393c116a',` |
| supabase/migrations/20261109a_izometrie_e4a_flux.sql:876 | DDL/preflight | Niciuna explicita (verifica rowtype/*) | `'trigger trg_employees_persoana_lock on public.employees=9dcecd0c70efdf1bf5e24e9c1157bc11',` |
| supabase/migrations/20261109a_izometrie_e4a_flux.sql:877 | DDL/preflight | Niciuna explicita (verifica rowtype/*) | `'trigger trg_employees_zz_ciclu_cont on public.employees=8b5dbbd69476106544cff2b5393c116a',` |
| supabase/migrations/20261109b_izometrie_e4b_teren.sql:3112 | a0_izo_suduri_proiectie | Niciuna explicita (verifica rowtype/*) | `'trigger trg_employees_persoana_lock on public.employees=9dcecd0c70efdf1bf5e24e9c1157bc11',` |
| supabase/migrations/20261109b_izometrie_e4b_teren.sql:3113 | a0_izo_suduri_proiectie | Niciuna explicita (verifica rowtype/*) | `'trigger trg_employees_zz_ciclu_cont on public.employees=8b5dbbd69476106544cff2b5393c116a',` |
| supabase_migration_salarii.sql:7 | DDL/preflight | email | `ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS email text;` |
| supabase_migration_salarii.sql:12 | IF | Niciuna explicita (verifica rowtype/*) | `employee_id           integer references public.employees(id) on delete cascade unique,` |
| supabase_migration_salarii.sql:84 | IF | Niciuna explicita (verifica rowtype/*) | `employee_id   integer references public.employees(id),` |
| supabase_schema.sql:33 | if | id,name,department,position,active,created_at | `create table if not exists public.employees (` |
| supabase_schema.sql:45 | if | id,created_at | `employee_id   integer references public.employees(id) on delete cascade,` |
| supabase_schema.sql:61 | if | id,created_at | `alter table public.employees enable row level security;` |
| supabase_schema.sql:83 | "Managerii | id,department | `on public.employees for select` |
| supabase_schema.sql:88 | "Managerii | id,department | `and (p.role = 'admin' or p.department = public.employees.department)` |
| supabase_schema.sql:93 | "Adminii | id | `on public.employees for all` |
| supabase_schema.sql:104 | "Managerii | id,department | `join public.employees e on e.id = public.pontaj_records.employee_id` |
| supabase_schema.sql:115 | "Managerii | id,department | `join public.employees e on e.id = public.pontaj_records.employee_id` |
| supabase_schema.sql:126 | "Managerii | email,id,name,department,position | `join public.employees e on e.id = public.pontaj_records.employee_id` |
| supabase_schema.sql:136 | "Managerii | email,id,name,department,position | `insert into public.employees (name, department, position) values` |
| supabase_schema_v2.sql:29 | if | id,name,department,position,active,created_at,site_id | `create table if not exists public.employees (` |
| supabase_schema_v2.sql:42 | if | id,created_at,site_id | `employee_id   integer references public.employees(id) on delete cascade,` |
| supabase_schema_v2.sql:100 | on_auth_user_created | email,id,name,active,site_id | `alter table public.employees add column if not exists site_id integer references public.sites(id);` |
| supabase_schema_v2.sql:112 | on_auth_user_created | email,id,name,active,site_id | `alter table public.employees disable row level security;` |

## Constatari revizuite

- HR: lista activa, fisa fostului angajat, wizard. Date personale pentru owner/can_access_personal_data. INSERT wizard returneaza deja doar id,name.
- App: pontaj/dashboard/exporturi operationale nu cer personal. Export banca diurne cere IBAN; numai owner/HR il primeste. Admin cere observatii_hr. Salarii cere email, fara atingerea calculului.
- HrPersonalExtern: emailul fostului angajat era folosit la potrivire omonimi; acum se completeaza doar pentru owner/HR. Verificarea autoritativa ramane in RPC/trigger existent.
- Logistica QR: citirea/administrarea PIN nu mai primeste PIN pentru non-HR. Propunere de exceptie necesita decizia lui Razvan; nu se acorda aici.
- Magazie EIP: marimile sunt personale conform deciziei A. Non-HR nu le mai citeste; exceptie operationala de discutat, nu acordata.
- Nu am identificat un select employees.telefon pentru soferul intern in Logistica. Telefoanele soferilor externi sunt alta sursa.
- fn_cont_persoana_cnp / fn_cont_persoana_chei / matcher-ele interne citesc identitate/email, dar au EXECUTE revocat pentru authenticated in migrarile existente. Nu se schimba.
- fn_ofertare_personal_disponibil este INVOKER si intoarce nume/functie/autorizatii, nu coloanele personale din brief.
- RPC-uri existente care folosesc employees%ROWTYPE trebuie verificate pe catalogul live pentru ACL si forma rezultatului; inventarul SQL include fiecare referinta, inclusiv migrari rollback istorice.
- qr-utilaj-info, qr-alimentare-submit si qr-bon-comun-lookup sunt apelate din QrUtilajPage, dar SURSELE edge qr-* LIPSESC din worktree. Nu se poate confirma cheia folosita acolo.
- Un client service_role cu SELECT pe tabel neafectat continua sa citeasca PIN; BYPASSRLS singur nu acorda privilegii de coloane. Migrarea nu revoca service_role.
- View-uri owner/definer care depind de coloane personale: preflight recursiv pe pg_depend refuza expunerea efectiva catre authenticated/anon. Functiile PL/pgSQL/dynamic nu au graf complet in pg_depend; auditul live ramane obligatoriu.

## Payload-uri dinamice revizuite (sursele initiale)

| Loc | Campuri efectiv scrise | RETURNING |
| --- | --- | --- |
| App.jsx:1993 | site_id | absent |
| App.jsx:6819 | name,department,position,site_id,active,hire_date | absent |
| App.jsx:6841 updates | active,termination_date; observatii_hr la reactivare | absent |
| App.jsx:6880 empUpdates | name,position,department,site_id,iban,hire_date,termination_date,cetatenie,tip_contract,procent_ocupare,co_maxim_zile | absent |
| App.jsx:6906 | DELETE rand dupa id, numai RLS existent | absent |
| App.jsx:6937 ins | name,department,position,site_id,active | absent |
| App.jsx:8445 | email | absent |
| HR.jsx:1598/1609/1619 | are_autorizatii / functie / cod_cor | absent |
| HrAngajatNouWizard.jsx:289 | name,department,functie,position,telefon,email,iban,cnp,adresa,data_nasterii,hire_date,cetatenie,active | id,name |
| Logistica.jsx:4487 | functii_extra | absent |
| Logistica.jsx:9235/9250 | qr_pin,qr_pin_active,qr_pin_creat_la / qr_pin_active | absent |
| Magazie.jsx:900 | campMasura = marime_incaltaminte sau marime_imbracaminte | absent |

## Delta dupa implementare

- Cele 11 selectii wildcard directe (9 App, 2 HR) folosesc EMPLOYEES_PUBLIC_COLUMNS; JOIN sites(name) este pastrat.
- HR activi/fosti: helperul completeaza numai pentru owner/HR cnp,iban,adresa,data_nasterii,telefon,email,observatii_hr.
- App Admin: completare autorizata iban,observatii_hr. App Salarii: email. Export banca diurne: iban obligatoriu, eroare daca lipseste dreptul.
- HrPersonalExtern: email completat doar pentru owner/HR. Logistica: qr_pin,qr_pin_active,qr_pin_creat_la completate doar pentru owner/HR.
- Magazie: selectia nu mai cere marimile. Propunere de exceptie operationala in raport; nicio exceptie implementata.
- Noul RPC fn_employees_personal este singura cale noua de citire personala; valideaza auth.uid si cele doua flaguri in corp.
- HrAngajatNouWizard nu necesita schimbari: INSERT are deja RETURNING id,name.
- Constatare suplimentara: fn_fost_angajat_leaga_extern copiaza telefon/email in hr_personal_extern (20260929e:590-592), iar scheletul politicilor are SELECT pentru orice logat (conturi_schelet_supabase.sql:552). ACL employees nu protejeaza copiile. Politica live trebuie verificata, iar eventuala restrictie a hr_personal_extern necesita decizie separata.
