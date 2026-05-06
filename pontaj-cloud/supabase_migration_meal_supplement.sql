-- ============================================================
-- PontajPRO - Migrare: Supliment Hrană
-- Ruleaza in Supabase > SQL Editor
-- ============================================================

-- 1. Adauga coloana meal_supplement in pontaj_records
ALTER TABLE public.pontaj_records 
ADD COLUMN IF NOT EXISTS meal_supplement boolean DEFAULT false;

-- 2. Adauga setarea pentru valoarea suplimentului
INSERT INTO public.settings (key, value) 
VALUES ('meal_supplement_amount', '15')
ON CONFLICT (key) DO NOTHING;
