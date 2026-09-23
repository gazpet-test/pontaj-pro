-- P0c (23.09.2026, aplicată): view-ul avea privilegiile implicite Supabase (anon ALL). security_invoker + RLS le neutralizau, dar regula e strictă.
REVOKE ALL ON public.v_ofertare_source_pack_nereusite FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_ofertare_source_pack_nereusite TO authenticated, service_role;
