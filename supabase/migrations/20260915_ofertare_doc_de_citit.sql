-- ANTI-BUG 15.09.2026 (prins de Razvan pe DF1278266 si pe Clinceni SCN1179776):
-- la citirea AI intrau doua categorii de fisiere care n-aveau ce cauta acolo:
--   1. PLANSELE (tip='plansa') — au calea lor, ofertare-plansa-citeste. Citita ca PDF obisnuit,
--      o scanare A0 de 78 MB nu da text util, ramane agatata pe 'in_lucru' si se reia la fiecare trecere.
--   2. FISIERELE DEJA SPARTE — originalul de 84 MB citit peste bucatile lui deja procesate.
--      Costul e dublu, dar mai grav e ca textul ar intra DE DOUA ORI in registrul de cerinte.
-- Marcajul "spart in N bucati" traia doar in textul din `eroare` si se pierdea la re-import
-- (veghea readuce fisierul ca rand nou, curat — exact ce s-a intamplat cu doc 221 pe licitatia 3).
-- De aceea regula se deduce din REALITATE: daca exista bucati pe numele lui, fisierul e spart.
--
-- In plus, testul de PDF era '\.pdf$', deci sarea tacut fisierele pe care SEAP le normalizeaza
-- cu sufix numeric ("Caiet de sarcini-LA PT(2).pdf" -> "Caiet de sarcini-LA PT.pdf 2").
-- Alea nu s-ar fi citit NICIODATA, fara ca cineva sa afle.
--
-- Predicatul e acelasi ca `deCititCaPdf` din src/OfertareLicitatii.jsx. Daca se schimba unul,
-- se schimba si celalalt; ofertare-ingest-doc il cheama prin RPC ca plasa de siguranta.

DROP FUNCTION IF EXISTS public.ofertare_doc_de_citit(int, bigint, text, text);
DROP FUNCTION IF EXISTS public.ofertare_doc_are_bucati(int, bigint, text);

CREATE OR REPLACE FUNCTION public.ofertare_doc_are_bucati(p_licitatie_id bigint, p_doc_id bigint, p_nume text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM ofertare_documente_atribuire b
    WHERE b.licitatie_id = p_licitatie_id
      AND b.id <> p_doc_id
      AND b.nume_original ~ ('^' || regexp_replace(regexp_replace(coalesce(p_nume,''), '\.pdf$', '', 'i'),
                                                   '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g')
                             || ' — p\d+_pag[\d-]+\.pdf$')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.ofertare_doc_are_bucati(bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ofertare_doc_are_bucati(bigint, bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ofertare_doc_de_citit(p_licitatie_id bigint, p_doc_id bigint, p_nume text, p_tip text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(p_nume,'') ~* '\.pdf *\d*$'
     AND coalesce(p_tip,'') <> 'plansa'
     AND NOT public.ofertare_doc_are_bucati(p_licitatie_id, p_doc_id, p_nume);
$$;
REVOKE EXECUTE ON FUNCTION public.ofertare_doc_de_citit(bigint, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ofertare_doc_de_citit(bigint, bigint, text, text) TO service_role;
