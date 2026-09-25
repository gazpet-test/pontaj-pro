-- Aplicată prin MCP 25.09.2026 (ofertare_clarificare_planse_propunere): status nou 'propunere' (motiv neconfirmat)
-- + ofertare_clarificare_planse_auto v2 — ciorna pleacă ca 'propunere', text pe tronson ↔ poziție F3, art. 160–161 L98/2016.
-- Definiția completă a funcției: vezi pg_get_functiondef în BD (sursa de adevăr).
ALTER TABLE public.ofertare_clarificari DROP CONSTRAINT ofertare_clarificari_status_check;
ALTER TABLE public.ofertare_clarificari ADD CONSTRAINT ofertare_clarificari_status_check
  CHECK (status = ANY (ARRAY['propunere','de_trimis','trimisa','raspunsa','retrasa']));
