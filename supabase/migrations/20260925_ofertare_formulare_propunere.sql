-- Ciorna AI de completare pe fiecare formular din registru (ofertare-clauze-formulare ce='completare').
-- Propunerea nu schimbă starea; omul o acceptă în UI (stare_pregatire → 'ciorna').
ALTER TABLE public.ofertare_formulare_registru
  ADD COLUMN IF NOT EXISTS propunere_text text,
  ADD COLUMN IF NOT EXISTS propunere_la timestamptz;
