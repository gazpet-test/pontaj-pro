-- Recitirea valului 1, pasul 4 (procedura §6): verificarea după 24h. READ-ONLY. Afișează raportul și EȘUEAZĂ (exit ≠ 0) la:
-- sha / metadate schimbate, altă proveniență decât prov_id, orice derivat cu versiunea sursei ≠ sha_nou („pe text depășit”).
-- Derivatele fără versiune a sursei = „nedovedit” (listate pentru Răzvan, nu fac verificarea să eșueze). Nu repară nimic.
--   psql "$RV1_PG_URL" -X -1 -v ON_ERROR_STOP=1 -v rezultat=<dir>/aplicare_rezultat.csv -f scripts/recitire_val1/verifica.sql
\set ON_ERROR_STOP 1
-- read-only prin construcție: scrie doar în obiecte temporare (READ ONLY ar interzice și CREATE TEMP); harness-ul verifică
CREATE TEMP TABLE rv_r (document_id bigint, sha_nou text, status_procesare text, pagini_necitite integer[], procesat_la timestamptz,
  pagini_procesate integer, pagini_felie integer, prov_id bigint, constatat_la timestamptz) ON COMMIT DROP;
\set c1 '\\copy rv_r FROM ' :'rezultat' ' WITH (FORMAT csv, HEADER true)'
:c1
CREATE TEMP VIEW rv_raport AS
WITH b AS (   -- derivatele CU versiunea sursei (sha): pe text nou / pe text depășit
  SELECT r.document_id, 'decizii_b' AS tabel, z.doc_sha256 = r.sha_nou AS pe_nou FROM rv_r r JOIN public.ofertare_cant_doc_decizii z ON z.document_id = r.document_id
  UNION ALL SELECT r.document_id, 'extrageri_b', e.doc_sha256 = r.sha_nou FROM rv_r r JOIN public.ofertare_cant_extrageri e ON e.document_id = r.document_id
  UNION ALL SELECT r.document_id, 'snapshot', (x->>'sha256') IS NOT DISTINCT FROM r.sha_nou
    FROM rv_r r JOIN public.ofertare_analiza_versiuni s ON true, jsonb_array_elements(s.doc_manifest) x WHERE (x->>'document_id')::bigint = r.document_id
), n AS (     -- derivatele FĂRĂ versiunea sursei: nedovedite
  SELECT r.document_id, 'cerinte' AS tabel FROM rv_r r JOIN public.ofertare_cerinte c ON c.sursa_document_id = r.document_id OR r.document_id = ANY (c.surse_document_ids)
  UNION ALL SELECT r.document_id, 'cantitati' FROM rv_r r JOIN public.ofertare_cantitati q ON r.document_id = ANY (q.surse_document_ids)
  UNION ALL SELECT r.document_id, 'clauze' FROM rv_r r JOIN public.ofertare_clauze_contract k ON k.document_id = r.document_id
  UNION ALL SELECT r.document_id, 'formulare' FROM rv_r r JOIN public.ofertare_formulare_registru f ON f.document_sursa_id = r.document_id
  UNION ALL SELECT r.document_id, 'triere' FROM rv_r r JOIN public.ofertare_triere t ON t.doc_id = r.document_id
  UNION ALL SELECT r.document_id, 'raspunsuri' FROM rv_r r JOIN public.ofertare_raspuns_set_doc x ON x.document_id = r.document_id
  UNION ALL SELECT r.document_id, 'analiza' FROM rv_r r JOIN public.ofertare_documente_atribuire d ON d.id = r.document_id
    WHERE d.analiza ? 'citire_noi' OR d.analiza ? 'citire_ai'
  UNION ALL SELECT r.document_id, 'garda_ingest' FROM rv_r r JOIN public.ofertare_ingest_garda g ON g.doc_id = r.document_id
)
SELECT r.document_id,
  (SELECT encode(sha256(convert_to(text_extras, 'UTF8')), 'hex') FROM public.ofertare_documente_atribuire WHERE id = r.document_id) = r.sha_nou AS sha_ok,
  (SELECT d.status_procesare IS NOT DISTINCT FROM r.status_procesare AND d.pagini_necitite IS NOT DISTINCT FROM r.pagini_necitite
      AND d.procesat_la IS NOT DISTINCT FROM r.procesat_la AND d.pagini_procesate IS NOT DISTINCT FROM r.pagini_procesate
      AND d.pagini_felie IS NOT DISTINCT FROM r.pagini_felie FROM public.ofertare_documente_atribuire d WHERE d.id = r.document_id) AS meta_ok,
  (SELECT array_agg(p.id ORDER BY p.id) FROM public.ofertare_doc_texte_prov p WHERE p.document_id = r.document_id) = ARRAY[r.prov_id] AS prov_ok,
  (SELECT string_agg(tabel, ',') FROM b WHERE b.document_id = r.document_id AND b.pe_nou) AS pe_text_nou,
  (SELECT string_agg(tabel, ',') FROM b WHERE b.document_id = r.document_id AND NOT coalesce(b.pe_nou, false)) AS pe_text_depasit,
  (SELECT string_agg(tabel || ':' || cnt, ',') FROM (SELECT tabel, count(*) cnt FROM n WHERE n.document_id = r.document_id GROUP BY tabel) z) AS nedovedit
FROM rv_r r ORDER BY r.document_id;
\pset footer off
SELECT * FROM rv_raport;
DO $v$
BEGIN
  IF EXISTS (SELECT 1 FROM rv_raport WHERE sha_ok IS NOT TRUE OR meta_ok IS NOT TRUE OR prov_ok IS NOT TRUE OR pe_text_depasit IS NOT NULL) THEN
    RAISE EXCEPTION 'verificare EȘUATĂ: % document(e) cu sha / metadate / proveniență schimbate sau derivate pe text depășit (vezi tabelul)',
      (SELECT count(*) FROM rv_raport WHERE sha_ok IS NOT TRUE OR meta_ok IS NOT TRUE OR prov_ok IS NOT TRUE OR pe_text_depasit IS NOT NULL);
  END IF;
  RAISE NOTICE 'verificare OK; derivate nedovedite: %', (SELECT count(*) FROM rv_raport WHERE nedovedit IS NOT NULL);
END $v$;
