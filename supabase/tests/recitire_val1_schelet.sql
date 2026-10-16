-- Completare de schelet pentru harness-ul recitirii valului 1 (scripts/test_recitire_val1.sh), peste ofertare_loturi_mvp_schelet.sql
-- + 20261024b + ofertare_cantitati_b_schelet_extra.sql + 20261031a + 20261031b. Tipurile = producția (information_schema, 16.10).
ALTER TABLE public.ofertare_documente_atribuire ADD COLUMN fisier_path text NOT NULL DEFAULT '', ADD COLUMN size_bytes bigint,
  ADD COLUMN pagina_offset integer NOT NULL DEFAULT 0, ADD COLUMN pagini integer, ADD COLUMN pagini_procesate integer NOT NULL DEFAULT 0,
  ADD COLUMN pagini_felie integer, ADD COLUMN analiza jsonb;
UPDATE public.ofertare_documente_atribuire SET pagini_necitite = '{}' WHERE pagini_necitite IS NULL;
ALTER TABLE public.ofertare_documente_atribuire ALTER COLUMN pagini_necitite SET NOT NULL, ALTER COLUMN pagini_necitite SET DEFAULT '{}';
ALTER TABLE public.ofertare_cerinte ADD COLUMN surse_document_ids bigint[];
ALTER TABLE public.ofertare_cantitati ADD COLUMN surse_document_ids bigint[];
CREATE TABLE public.ofertare_clauze_contract (id bigserial PRIMARY KEY, licitatie_id bigint NOT NULL, document_id bigint, categorie text NOT NULL DEFAULT 'x');
CREATE TABLE public.ofertare_formulare_registru (id bigserial PRIMARY KEY, licitatie_id bigint NOT NULL, document_sursa_id bigint, denumire text NOT NULL DEFAULT 'x');
CREATE TABLE public.ofertare_triere (id bigserial PRIMARY KEY, licitatie_id bigint NOT NULL, doc_id bigint, rezultat jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.ofertare_raspuns_set_doc (set_id bigint NOT NULL, document_id bigint NOT NULL, ordine integer NOT NULL DEFAULT 1);
CREATE TABLE public.ofertare_ingest_garda (doc_id bigint PRIMARY KEY REFERENCES public.ofertare_documente_atribuire(id), incercare_token uuid,
  in_curs_pana timestamptz);
CREATE TABLE public.worker_heartbeat (nume text PRIMARY KEY, ultimul timestamptz NOT NULL, detalii jsonb NOT NULL DEFAULT '{}');
CREATE SCHEMA storage;
CREATE TABLE storage.objects (id bigserial PRIMARY KEY, bucket_id text, name text, metadata jsonb, updated_at timestamptz DEFAULT now());
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text NOT NULL DEFAULT '* * * * *', command text NOT NULL, active boolean NOT NULL DEFAULT true, jobname text);
CREATE TABLE cron.job_run_details (runid bigserial PRIMARY KEY, jobid bigint, status text, start_time timestamptz, end_time timestamptz);
CREATE SCHEMA net;
CREATE TABLE net.http_request_queue (id bigserial PRIMARY KEY, method text NOT NULL DEFAULT 'POST', url text NOT NULL, timeout_milliseconds integer NOT NULL DEFAULT 1000);
-- rolul de test non-API, cu drept de citire (verifică garda session_user)
CREATE ROLE rv1_test LOGIN;
GRANT USAGE ON SCHEMA storage TO rv1_test;
GRANT SELECT ON ALL TABLES IN SCHEMA public, storage TO rv1_test;
