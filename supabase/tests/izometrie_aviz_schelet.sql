-- Local-only additions BEFORE any migration fingerprint; never production DDL.
DO $$ BEGIN IF current_database() !~ '_test$' THEN RAISE EXCEPTION 'fixture only'; END IF; END $$;
CREATE TABLE IF NOT EXISTS public.employees(id int PRIMARY KEY,name text NOT NULL,active boolean NOT NULL DEFAULT true,position text);
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS position text;
CREATE TABLE IF NOT EXISTS public.logistica_active(id int PRIMARY KEY,nr_inmatriculare text,categorie_vehicul text,stare text);
CREATE TABLE IF NOT EXISTS public.logistica_setari(key text PRIMARY KEY,value text);
CREATE TABLE IF NOT EXISTS public.hr_semnaturi_electronice(employee_id int REFERENCES public.employees(id),fisier_path text,activ boolean,deleted_at timestamptz);
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistica_active ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistica_setari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_semnaturi_electronice ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS metadata jsonb;
INSERT INTO storage.buckets(id,name,public) VALUES('hr-semnaturi','hr-semnaturi',false) ON CONFLICT DO NOTHING;
INSERT INTO public.employees(id,name,active,position) VALUES(30,'GESTIONAR TEST',true,'gestionar'),(121,'SOFER TEST',true,'sofer'),(117,'MP TEST',true,'manager'),(990,'INACTIV TEST',false,'sofer') ON CONFLICT DO NOTHING;
INSERT INTO public.logistica_active VALUES(901,'PH 01 ABC','camion','activ');
INSERT INTO public.logistica_setari VALUES('firma_nume','Gazpet TEST'),('firma_cui','RO123'),('firma_adresa','Ploiesti TEST'),('firma_reg_com','J29/123/2000');
