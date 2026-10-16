-- Recitirea valului 1, după COMMIT-ul confirmat al revino.sql (procedura §7.5): read-only prin construcție (scrie doar în obiecte
-- temporare). VERIFICĂ egalitatea BD cu revenire_provizoriu.csv; doar atunci → revenire_rezultat.csv (se comite în repo).
--   deno run -A scripts/recitire_val1/psql.ts -X -1 -v ON_ERROR_STOP=1 -v provizoriu=<dir>/revenire_provizoriu.csv -v rezultat=<dir>/revenire_rezultat.csv \
--        -f scripts/recitire_val1/revino_rezultat.sql
\set ON_ERROR_STOP 1
CREATE TEMP TABLE rv_p (document_id bigint, sha_vechi text, status_procesare text, pagini_necitite integer[], procesat_la timestamptz,
  pagini_procesate integer, pagini_felie integer, prov_id bigint, constatat_la timestamptz) ON COMMIT DROP;
\set c1 '\\copy rv_p FROM ' :'provizoriu' ' WITH (FORMAT csv, HEADER true)'
:c1
DO $v$
DECLARE r record; d record; p record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rv_p) THEN RAISE EXCEPTION 'provizoriu gol'; END IF;
  FOR r IN SELECT * FROM rv_p ORDER BY document_id LOOP
    SELECT encode(sha256(convert_to(text_extras, 'UTF8')), 'hex') AS sha, status_procesare, pagini_necitite, procesat_la, pagini_procesate, pagini_felie
      INTO d FROM public.ofertare_documente_atribuire WHERE id = r.document_id;
    IF d.sha IS DISTINCT FROM r.sha_vechi OR d.status_procesare IS DISTINCT FROM r.status_procesare OR d.pagini_necitite IS DISTINCT FROM r.pagini_necitite
       OR d.procesat_la IS DISTINCT FROM r.procesat_la OR d.pagini_procesate IS DISTINCT FROM r.pagini_procesate OR d.pagini_felie IS DISTINCT FROM r.pagini_felie THEN
      RAISE EXCEPTION 'doc %: starea din BD diferă de RETURNING — NU devine referință', r.document_id;
    END IF;
    SELECT * INTO p FROM public.ofertare_doc_texte_prov WHERE id = r.prov_id;
    IF NOT FOUND OR p.document_id IS DISTINCT FROM r.document_id OR p.sha256 IS DISTINCT FROM r.sha_vechi OR p.origine <> 'sinteza_ai'
       OR p.producator <> 'revenire-recitire' OR p.constatat_la IS DISTINCT FROM r.constatat_la
       OR (SELECT id FROM public.ofertare_doc_texte_prov WHERE document_id = r.document_id ORDER BY constatat_la DESC, id DESC LIMIT 1) IS DISTINCT FROM r.prov_id THEN
      RAISE EXCEPTION 'doc %: proveniența revenirii lipsește, diferă sau nu e ultima', r.document_id;
    END IF;
  END LOOP;
END $v$;
\set c2 '\\copy (SELECT * FROM rv_p ORDER BY document_id) TO ' :'rezultat' ' WITH (FORMAT csv, HEADER true)'
:c2
