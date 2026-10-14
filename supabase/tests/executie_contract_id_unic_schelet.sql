-- Schelet minim (NU se aplică pe producție) pentru scripts/test_executie_contract_id_unic.sh — doar într-o bază locală *_test.
-- Reproduce ce atinge 20261030b, cu structura citită de pe live la 14.10.2026:
--   * executie_proiecte: id bigserial, nume/cod_intern NOT NULL (cod_intern unic), contract_id → contracte_terti(id),
--     site_id, activ, updated_at; RLS pornit cu politicile live (select USING true; modify ALL pe auth.uid() IS NOT NULL);
--   * fără index pe contract_id (starea dinainte de 20261030b).
-- Date FICTIVE, cu id-urile din TKT-2026-0333: proiectele 27 / 32 legate de contractele 108 / 110 (fără șantier),
-- proiectele 6 / 7 cu nr_contract dar fără contract_id, contractele 200 / 201 libere.
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN INHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN INHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN INHERIT BYPASSRLS; END IF;
END $roluri$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.contracte_terti (
  id bigserial PRIMARY KEY,
  numar_contract text,
  categorie text,
  sens text,
  site_id bigint
);
CREATE TABLE public.executie_proiecte (
  id bigserial PRIMARY KEY,
  nume text NOT NULL,
  cod_intern text NOT NULL UNIQUE,
  nr_contract text,
  contract_id bigint REFERENCES public.contracte_terti(id),
  site_id bigint,
  activ boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.executie_proiecte ENABLE ROW LEVEL SECURITY;
CREATE POLICY executie_proiecte_select ON public.executie_proiecte FOR SELECT TO authenticated USING (true);
CREATE POLICY executie_proiecte_modify ON public.executie_proiecte FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.executie_proiecte, public.contracte_terti TO authenticated, service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

INSERT INTO public.contracte_terti (id, numar_contract, categorie, sens) VALUES
  (108, '3063', 'executie', 'incasare'), (110, '52675', 'executie', 'incasare'),
  (200, '686', 'executie', 'incasare'), (201, '1', 'executie', 'incasare');
INSERT INTO public.executie_proiecte (id, nume, cod_intern, nr_contract, contract_id, site_id) VALUES
  (6,  'Europan (fictiv)',        'EUROPAN',        '1',     NULL, 8),
  (7,  'CFI Tifești (fictiv)',    'TIFESTI_CFI',    '686',   NULL, 10),
  (27, 'Finta–Gheboaia (fictiv)', 'FINTA_GHEBOAIA', '3063',  108,  NULL),
  (32, 'Sonda 16 MI (fictiv)',    'SONDA_16_MI',    '52675', 110,  NULL),
  (40, 'Fără contract (fictiv)',  'FARA_CONTRACT',  NULL,    NULL, 12);
SELECT setval('public.executie_proiecte_id_seq', 100), setval('public.contracte_terti_id_seq', 300);
