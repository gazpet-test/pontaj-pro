-- Recitirea valului 1, pasul 0 (procedura §8): reverificarea READ-ONLY că cele 20 de documente au tot zero derivate și sunt „procesat”.
-- Eșuează (exit ≠ 0) la orice abatere. Se rulează înaintea citirii și înaintea aplicării.
--   deno run -A scripts/recitire_val1/psql.ts -X -1 -v ON_ERROR_STOP=1 -f scripts/recitire_val1/pas0.sql
\set ON_ERROR_STOP 1
\ir derivate.sql
\pset footer off
SELECT d.id, d.licitatie_id, d.pagini, d.pagina_offset, d.status_procesare, cardinality(d.pagini_necitite) AS necitite,
       pg_temp.rv1_derivate(d.id, NULL) AS atasate
  FROM public.ofertare_documente_atribuire d
 WHERE d.id = ANY (ARRAY[137,138,139,165,166,167,168,169,170,171,212,213,434,1288,1289,1290,1291,1292,1293,1294]::bigint[])
 ORDER BY d.licitatie_id, d.id;
DO $p$
DECLARE c_whitelist CONSTANT bigint[] := ARRAY[137,138,139,165,166,167,168,169,170,171,212,213,434,1288,1289,1290,1291,1292,1293,1294];
BEGIN
  IF (SELECT count(*) FROM public.ofertare_documente_atribuire WHERE id = ANY (c_whitelist)) <> 20 THEN RAISE EXCEPTION 'pas 0: lipsesc documente'; END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = ANY (c_whitelist)
              AND (d.status_procesare <> 'procesat' OR cardinality(d.pagini_necitite) > 0 OR d.text_extras IS NULL OR d.pagini IS NULL
                   OR d.pagini_procesate IS DISTINCT FROM d.pagini OR pg_temp.rv1_derivate(d.id, NULL) IS NOT NULL)) THEN
    RAISE EXCEPTION 'pas 0: cel puțin un document nu mai e eligibil (vezi tabelul)';
  END IF;
  RAISE NOTICE 'pas 0 OK: 20 de documente, zero atașate';
END $p$;
