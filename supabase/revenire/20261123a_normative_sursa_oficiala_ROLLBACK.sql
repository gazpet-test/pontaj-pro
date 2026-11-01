-- Revenire 20261123a: scoate coloanele adăugate pe ofertare_normative (pierde bazele și urmele verificării automate).
-- Întâi se revine edge-ul normative-scan-lunar la v10 (altfel v11 cere coloanele care nu mai există).
ALTER TABLE public.ofertare_normative
  DROP COLUMN IF EXISTS verificare_auto,
  DROP COLUMN IF EXISTS verificat_auto_la,
  DROP COLUMN IF EXISTS forma_oficiala_la,
  DROP COLUMN IF EXISTS legislatie_doc_id;
