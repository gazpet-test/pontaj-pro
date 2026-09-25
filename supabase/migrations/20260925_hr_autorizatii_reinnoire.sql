-- 25.09.2026: procedura de reînnoire autorizații HR (aplicată prin MCP apply_migration)
ALTER TABLE public.hr_autorizatii
  ADD COLUMN IF NOT EXISTS inlocuita_de_id bigint REFERENCES public.hr_autorizatii(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inlocuita_la timestamptz;
CREATE INDEX IF NOT EXISTS idx_hr_autorizatii_inlocuita_de ON public.hr_autorizatii(inlocuita_de_id) WHERE inlocuita_de_id IS NOT NULL;
-- v_chuck_hr_alerte: + AND (ha.inlocuita_de_id IS NULL) în ambele ramuri (autorizatie + rsvti)
-- v_hr_autorizatii_status: + coloane inlocuita_de_id, inlocuita_la, verificat_pe_scan (la final)
DO $$
DECLARE d text;
BEGIN
  d := pg_get_viewdef('public.v_chuck_hr_alerte'::regclass);
  d := replace(d, '(ha.deleted_at IS NULL)', '(ha.deleted_at IS NULL) AND (ha.inlocuita_de_id IS NULL)');
  EXECUTE 'CREATE OR REPLACE VIEW public.v_chuck_hr_alerte WITH (security_invoker = on) AS ' || d;
  d := pg_get_viewdef('public.v_hr_autorizatii_status'::regclass);
  d := replace(d, ' AS dovada_nume', ' AS dovada_nume, a.inlocuita_de_id, a.inlocuita_la, a.verificat_pe_scan');
  EXECUTE 'CREATE OR REPLACE VIEW public.v_hr_autorizatii_status WITH (security_invoker = on) AS ' || d;
END $$;
