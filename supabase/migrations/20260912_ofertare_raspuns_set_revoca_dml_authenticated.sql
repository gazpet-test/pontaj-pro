-- Privilegiile implicite din Supabase dau authenticated DML complet pe orice tabel nou; GRANT SELECT
-- nu le scoate, doar le confirma. RLS le bloca oricum (politica e doar de SELECT), dar grantul ramas
-- e o capcana pentru cine adauga maine o politica de INSERT „ca sa mearga ceva".
-- Scrierile pe setul de raspuns trec exclusiv prin edge/RPC cu service_role.
REVOKE ALL ON public.ofertare_raspuns_set FROM authenticated;
REVOKE ALL ON public.ofertare_raspuns_set_doc FROM authenticated;
GRANT SELECT ON public.ofertare_raspuns_set TO authenticated;
GRANT SELECT ON public.ofertare_raspuns_set_doc TO authenticated;
