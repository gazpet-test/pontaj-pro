-- Completare de schelet pentru harness-ul 20261031a (peste ofertare_loturi_mvp_schelet.sql + migrarea 20261024b aplicată).
-- Doar coloanele / tabelele de care depinde schema TKT-0329 B, cu tipurile din producție (verificate în information_schema 15.10).
ALTER TABLE public.ofertare_documente_atribuire ADD COLUMN text_extras text, ADD COLUMN procesat_la timestamptz,
  ADD COLUMN seap_meta jsonb, ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN pagini_necitite integer[];
UPDATE public.ofertare_documente_atribuire SET created_at = now() - interval '30 days';
CREATE TABLE public.ofertare_clarificari (id bigserial PRIMARY KEY, licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  nr integer, intrebare text NOT NULL, status text NOT NULL DEFAULT 'propunere', origine text, updated_at timestamptz DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.ofertare_clarificari TO authenticated;
GRANT USAGE ON SEQUENCE public.ofertare_clarificari_id_seq TO authenticated;
CREATE TABLE public.ai_usage_log (id bigserial PRIMARY KEY, function_name text NOT NULL, model text, tokens_in integer DEFAULT 0,
  tokens_out integer DEFAULT 0, cost_usd numeric DEFAULT 0, ref_table text, ref_id bigint, created_at timestamptz DEFAULT now());
