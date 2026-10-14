-- Completare de schelet pentru harness-ul 20261029b (peste ofertare_loturi_mvp_schelet.sql + migrarea 20261024b aplicată).
-- Doar coloanele / tabelele de care depinde pilotul OCR local, cu tipurile din producție (verificate în information_schema 14.10).
ALTER TABLE public.ofertare_documente_atribuire ADD COLUMN pagini_necitite integer[], ADD COLUMN fisier_path text;
UPDATE public.ofertare_documente_atribuire SET pagini_necitite = ARRAY[325, 326, 327], fisier_path = '102/atribuire/pt_fv.pdf' WHERE id = 1247;
UPDATE public.ofertare_documente_atribuire SET pagini_necitite = ARRAY[]::integer[] WHERE id = 1302;
CREATE TABLE public.ai_usage_log (id bigserial PRIMARY KEY, function_name text NOT NULL, model text, tokens_in integer DEFAULT 0,
  tokens_out integer DEFAULT 0, cost_usd numeric DEFAULT 0, ref_table text, ref_id bigint, created_at timestamptz DEFAULT now());
CREATE TABLE public.procese_heartbeat (cheie text PRIMARY KEY, descriere text, gazda text, ultimul_semn timestamptz, ultim_ok boolean,
  ultim_mesaj text, prag_minute integer, activ boolean, alertat_la timestamptz, creat_la timestamptz DEFAULT now());
