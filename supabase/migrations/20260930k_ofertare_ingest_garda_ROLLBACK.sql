-- Rollback pentru 20260930k_ofertare_ingest_garda.sql (șterge doar obiectele noi; datele din garda se pierd).
BEGIN;
DROP FUNCTION IF EXISTS public.ofertare_ingest_garda_reactiveaza(bigint);
DROP FUNCTION IF EXISTS public.ofertare_ingest_garda_rezultat(bigint, boolean, boolean, text, bigint, text, text);
DROP FUNCTION IF EXISTS public.ofertare_ingest_garda_incearca(bigint, bigint, text, text);
DROP FUNCTION IF EXISTS public.ofertare_ingest_garda_notifica(bigint, text);
DROP TABLE IF EXISTS public.ofertare_ingest_garda;
COMMIT;
