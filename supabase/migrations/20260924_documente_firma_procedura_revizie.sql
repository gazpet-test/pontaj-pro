-- 24.09.2026 (Răzvan, audit UI Ofertare pct. 2): procedurile tehnice de execuție trebuie ținute în platformă
-- ca documente ale firmei — categorie proprie + revizie (codul stă în numar_document). Cap. 4.b din PT le citează.
ALTER TABLE public.documente_firma DROP CONSTRAINT IF EXISTS documente_firma_categorie_check;
ALTER TABLE public.documente_firma ADD CONSTRAINT documente_firma_categorie_check CHECK (categorie = ANY (ARRAY[
  'act_constitutiv','certificat_legal','autorizatie','iso','financiar','hr','sudura_otel','sudura_pehd','etalonare','procedura','altele']));
ALTER TABLE public.documente_firma ADD COLUMN IF NOT EXISTS revizie text;
COMMENT ON COLUMN public.documente_firma.revizie IS 'Ediția/revizia documentului (folosită la proceduri: cod în numar_document + revizie).';
