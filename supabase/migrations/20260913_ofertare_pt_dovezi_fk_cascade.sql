-- Gasit la proba P0.6 (13.09.2026): FK-urile tintei erau ON DELETE SET NULL, dar CHECK-ul
-- ofertare_pt_dovezi_tinta_chk cere EXACT o tinta -> stergerea documentului-tinta pica pe CHECK.
-- O dovada a carei tinta dispare nu mai e o dovada: CASCADE. Invalidarea verificarii care se
-- sprijinea pe ea ramane treaba triggerelor de revizie (P0.6), nu a stergerii.
-- (Fisierul de migrare P0.3 e corectat si el, ca un mediu nou sa porneasca direct cu CASCADE.)
ALTER TABLE public.ofertare_pt_dovezi
  DROP CONSTRAINT IF EXISTS ofertare_pt_dovezi_document_id_fkey,
  DROP CONSTRAINT IF EXISTS ofertare_pt_dovezi_autorizatie_id_fkey,
  DROP CONSTRAINT IF EXISTS ofertare_pt_dovezi_doc_firma_id_fkey;
ALTER TABLE public.ofertare_pt_dovezi
  ADD CONSTRAINT ofertare_pt_dovezi_document_id_fkey    FOREIGN KEY (document_id)    REFERENCES public.ofertare_documente_atribuire(id) ON DELETE CASCADE,
  ADD CONSTRAINT ofertare_pt_dovezi_autorizatie_id_fkey FOREIGN KEY (autorizatie_id) REFERENCES public.hr_autorizatii(id) ON DELETE CASCADE,
  ADD CONSTRAINT ofertare_pt_dovezi_doc_firma_id_fkey   FOREIGN KEY (doc_firma_id)   REFERENCES public.documente_firma(id) ON DELETE CASCADE;
