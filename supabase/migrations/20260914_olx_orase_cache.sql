-- OLX Partner API: /api/partner/cities NU are filtru de nume (q e ignorat), doar limit/offset,
-- iar /regions/{id}/cities nu exista in v2. 13.789 orase. Fara cache local, formularul lua mereu
-- primul rand (Bucuresti, id 1), care cere obligatoriu sector (district_id) — de aici
-- „district_id: Valoare gresita" la publicarea anuntului (14.09.2026).
-- Aplicata prin MCP (apply_migration olx_orase_cache). Umplere: olx-api actiune=orase_sync.
CREATE TABLE IF NOT EXISTS public.olx_orase (
  id          integer PRIMARY KEY,           -- id-ul OLX al orasului
  name        text NOT NULL,
  county      text,
  region_id   integer,
  latitude    numeric,
  longitude   numeric,
  sincronizat_la timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.olx_orase IS 'Cache al oraselor OLX (/api/partner/cities), sincronizat prin olx-api actiune=orase_sync. Cautarea de oras din HR → Recrutare → Publica pe OLX se face aici, nu la OLX.';
CREATE INDEX IF NOT EXISTS olx_orase_name_idx ON public.olx_orase (lower(name));
CREATE INDEX IF NOT EXISTS olx_orase_county_idx ON public.olx_orase (county);
ALTER TABLE public.olx_orase ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.olx_orase TO authenticated;
GRANT ALL ON public.olx_orase TO service_role;
DROP POLICY IF EXISTS olx_orase_select ON public.olx_orase;
CREATE POLICY olx_orase_select ON public.olx_orase FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
