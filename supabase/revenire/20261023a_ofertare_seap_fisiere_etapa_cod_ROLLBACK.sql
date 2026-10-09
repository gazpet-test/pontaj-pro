-- ROLLBACK 20261023a: lista veche de etape (eșuează dacă există rânduri cu etapa „cod” / „identitate”)
ALTER TABLE public.ofertare_seap_fisiere DROP CONSTRAINT ofertare_seap_fisiere_etapa_check;
ALTER TABLE public.ofertare_seap_fisiere ADD CONSTRAINT ofertare_seap_fisiere_etapa_check
  CHECK (etapa IN ('identificare', 'descarcare', 'semnatura', 'set_volume', 'listare', 'extragere', 'urcare'));
