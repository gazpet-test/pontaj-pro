-- Recitirea valului 1, după COMMIT-ul confirmat al aplica.sql (procedura §5.5): READ-ONLY. Recitește din BD și VERIFICĂ egalitatea
-- cu aplicare_provizoriu.csv (valorile din RETURNING); NU le redefinește. Doar dacă totul e egal → aplicare_rezultat.csv
-- (referința CAS a revenirii, se comite în repo).
--   psql "$RV1_PG_URL" -X -1 -v ON_ERROR_STOP=1 -v provizoriu=<dir>/aplicare_provizoriu.csv -v rezultat=<dir>/aplicare_rezultat.csv \
--        -f scripts/recitire_val1/aplica_rezultat.sql
\set ON_ERROR_STOP 1
-- read-only prin construcție: scrie doar în obiecte temporare (READ ONLY ar interzice și CREATE TEMP); harness-ul verifică
CREATE TEMP TABLE rv_p (document_id bigint, sha_nou text, status_procesare text, pagini_necitite integer[], procesat_la timestamptz,
  pagini_procesate integer, pagini_felie integer, prov_id bigint, constatat_la timestamptz) ON COMMIT DROP;
\set c1 '\\copy rv_p FROM ' :'provizoriu' ' WITH (FORMAT csv, HEADER true)'
:c1
DO $v$
DECLARE r record; d record; p record; v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM rv_p;
  IF v_n = 0 OR (SELECT count(DISTINCT document_id) FROM rv_p) <> v_n THEN RAISE EXCEPTION 'provizoriu gol sau dublat'; END IF;
  FOR r IN SELECT * FROM rv_p ORDER BY document_id LOOP
    SELECT encode(sha256(convert_to(text_extras, 'UTF8')), 'hex') AS sha, status_procesare, pagini_necitite, procesat_la, pagini_procesate, pagini_felie
      INTO d FROM public.ofertare_documente_atribuire WHERE id = r.document_id;
    IF d.sha IS DISTINCT FROM r.sha_nou OR d.status_procesare IS DISTINCT FROM r.status_procesare OR d.pagini_necitite IS DISTINCT FROM r.pagini_necitite
       OR d.procesat_la IS DISTINCT FROM r.procesat_la OR d.pagini_procesate IS DISTINCT FROM r.pagini_procesate OR d.pagini_felie IS DISTINCT FROM r.pagini_felie THEN
      RAISE EXCEPTION 'doc %: starea din BD diferă de RETURNING (modificare după COMMIT sau COMMIT eșuat) — NU devine referință', r.document_id;
    END IF;
    SELECT * INTO p FROM public.ofertare_doc_texte_prov WHERE id = r.prov_id;
    IF NOT FOUND OR p.document_id IS DISTINCT FROM r.document_id OR p.sha256 IS DISTINCT FROM r.sha_nou OR p.origine <> 'transcriere'
       OR p.producator <> 'recitire-haiku-5-5' OR p.constatat_la IS DISTINCT FROM r.constatat_la THEN
      RAISE EXCEPTION 'doc %: proveniența % lipsește sau diferă', r.document_id, r.prov_id;
    END IF;
    IF (SELECT id FROM public.ofertare_doc_texte_prov WHERE document_id = r.document_id ORDER BY constatat_la DESC, id DESC LIMIT 1) IS DISTINCT FROM r.prov_id THEN
      RAISE EXCEPTION 'doc %: proveniența aplicării nu mai e ultima', r.document_id;
    END IF;
  END LOOP;
END $v$;
\set c2 '\\copy (SELECT * FROM rv_p ORDER BY document_id) TO ' :'rezultat' ' WITH (FORMAT csv, HEADER true)'
:c2
