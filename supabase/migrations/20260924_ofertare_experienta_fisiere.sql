-- 24.09.2026 (audit UI Ofertare pct. 8; Răzvan: „experiența similară în Ofertare, nu în HR"):
-- PV-ul de recepție și recomandarea se urcă direct din catalogul Experiență similară.
ALTER TABLE public.ofertare_experienta
  ADD COLUMN IF NOT EXISTS pv_path text,
  ADD COLUMN IF NOT EXISTS recomandare_path text;
COMMENT ON COLUMN public.ofertare_experienta.pv_path IS 'PDF-ul PV-ului de recepție, în bucket-ul ofertare (experienta/<id>/...). Alternativă la folder_nas.';
COMMENT ON COLUMN public.ofertare_experienta.recomandare_path IS 'PDF-ul recomandării beneficiarului, în bucket-ul ofertare (experienta/<id>/...).';
