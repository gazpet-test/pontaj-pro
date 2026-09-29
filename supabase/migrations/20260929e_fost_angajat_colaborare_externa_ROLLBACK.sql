-- ROLLBACK pentru 20260929e_fost_angajat_colaborare_externa.sql (primul din lanț: e → d → c).
-- Idempotent. NU atinge triggerul S-A (20260929g) și nici funcțiile din c (identitate, fn_nume_cuvinte — mutată în c
-- în runda 3, o folosește și garda R2 din d; le șterge rollback-ul c).
-- ⚠️ Se pierd marcajele „Fost angajat Gazpet” și acordurile de colaborare externă (plus jurnalul lor).
--    Înainte: Claude exportă employees(colaborare_externa_*), hr_colaborare_externa_jurnal și
--    legăturile hr_personal_extern.fost_angajat_employee_id în claude_context, cu confirmarea lui Răzvan.

DROP TRIGGER IF EXISTS trg_employees_zz_colab_ext ON public.employees;
DROP TRIGGER IF EXISTS trg_employees_colab_ext_protectie_ins ON public.employees;
DROP TRIGGER IF EXISTS trg_employees_colab_ext_protectie_upd ON public.employees;
DROP FUNCTION IF EXISTS public.fn_employees_colab_ext_after();
DROP FUNCTION IF EXISTS public.fn_employees_colab_ext_protectie();

DROP TRIGGER IF EXISTS trg_hr_personal_extern_fost_angajat ON public.hr_personal_extern;
DROP FUNCTION IF EXISTS public.fn_hr_personal_extern_fost_angajat();
DROP FUNCTION IF EXISTS public.fn_extern_fost_angajat_potrivire(text, text);

DROP FUNCTION IF EXISTS public.fn_colaborare_externa_seteaza(integer, text, text, text);
DROP FUNCTION IF EXISTS public.fn_fost_angajat_leaga_extern(integer, bigint);

DROP TABLE IF EXISTS public.hr_colaborare_externa_jurnal;
DROP FUNCTION IF EXISTS public.fn_hr_colab_ext_jurnal_imuabil();

DROP INDEX IF EXISTS public.uq_hr_personal_extern_fost_angajat;
ALTER TABLE public.hr_personal_extern DROP CONSTRAINT IF EXISTS hr_personal_extern_fost_angajat_fk;
ALTER TABLE public.hr_personal_extern DROP COLUMN IF EXISTS fost_angajat_gazpet;
ALTER TABLE public.hr_personal_extern DROP COLUMN IF EXISTS fost_angajat_employee_id;

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_colab_ext_dovada_chk;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_colab_ext_status_chk;
ALTER TABLE public.employees
  DROP COLUMN IF EXISTS colaborare_externa_status,
  DROP COLUMN IF EXISTS colaborare_externa_confirmat_de,
  DROP COLUMN IF EXISTS colaborare_externa_confirmat_la,
  DROP COLUMN IF EXISTS colaborare_externa_nota,
  DROP COLUMN IF EXISTS colaborare_externa_document;
