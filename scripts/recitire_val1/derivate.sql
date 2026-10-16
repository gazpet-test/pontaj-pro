-- Recitirea valului 1: lista derivatelor (procedura §2.1), ACEEAȘI în preview / aplicare / verificare / revenire.
-- Funcție TEMPORARĂ (pg_temp, doar în sesiunea psql) — procedura nu creează obiecte în BD. Inclusă cu \ir din celelalte scripturi.
-- p_prov_permis = proveniența așteptată (la revenire: prov_id-ul aplicării); NULL = nicio proveniență permisă.
-- Întoarce NULL dacă documentul n-are nimic atașat, altfel lista „tabel: n”.
CREATE OR REPLACE FUNCTION pg_temp.rv1_derivate(p_doc bigint, p_prov_permis bigint)
RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT nullif(concat_ws(', ',
    (SELECT 'cerinte: ' || count(*) FROM public.ofertare_cerinte c WHERE c.sursa_document_id = p_doc OR p_doc = ANY (c.surse_document_ids) HAVING count(*) > 0),
    (SELECT 'cantitati: ' || count(*) FROM public.ofertare_cantitati q WHERE p_doc = ANY (q.surse_document_ids) HAVING count(*) > 0),
    (SELECT 'clauze: ' || count(*) FROM public.ofertare_clauze_contract k WHERE k.document_id = p_doc HAVING count(*) > 0),
    (SELECT 'formulare: ' || count(*) FROM public.ofertare_formulare_registru f WHERE f.document_sursa_id = p_doc HAVING count(*) > 0),
    (SELECT 'triere: ' || count(*) FROM public.ofertare_triere t WHERE t.doc_id = p_doc HAVING count(*) > 0),
    (SELECT 'raspunsuri: ' || count(*) FROM public.ofertare_raspuns_set_doc r WHERE r.document_id = p_doc HAVING count(*) > 0),
    (SELECT 'snapshot: ' || count(*) FROM public.ofertare_analiza_versiuni s, jsonb_array_elements(s.doc_manifest) e
      WHERE (e->>'document_id')::bigint = p_doc HAVING count(*) > 0),
    (SELECT 'analiza: ' || array_to_string(ARRAY(SELECT k FROM unnest(ARRAY['citire_noi', 'citire_ai']) k WHERE d.analiza ? k), '+')
       FROM public.ofertare_documente_atribuire d WHERE d.id = p_doc AND (d.analiza ? 'citire_noi' OR d.analiza ? 'citire_ai')),
    (SELECT 'provenienta: ' || count(*) FROM public.ofertare_doc_texte_prov p WHERE p.document_id = p_doc AND p.id IS DISTINCT FROM p_prov_permis HAVING count(*) > 0),
    (SELECT 'decizii_b: ' || count(*) FROM public.ofertare_cant_doc_decizii z WHERE z.document_id = p_doc HAVING count(*) > 0),
    (SELECT 'extrageri_b: ' || count(*) FROM public.ofertare_cant_extrageri e WHERE e.document_id = p_doc HAVING count(*) > 0),
    (SELECT 'garda_ingest: 1' FROM public.ofertare_ingest_garda g WHERE g.doc_id = p_doc)
  ), '')
$f$;
