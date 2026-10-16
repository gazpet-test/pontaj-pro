-- Recitirea valului 1 (procedura §7): REVENIREA, la nevoie și cu „da”-ul lui Răzvan. Fereastră deschisă, o tranzacție, totul sau nimic.
--   psql "$RV1_PG_URL" -X -1 -v ON_ERROR_STOP=1 -v manifest=<dir>/manifest_aprobat.csv -v manifest_sha256=<sha comis> \
--        -v rezultat=<dir>/aplicare_rezultat.csv -v documente='212,213' (sau 'toate') -v provizoriu=<dir>/revenire_provizoriu.csv \
--        -f scripts/recitire_val1/revino.sql
-- Apoi, DOAR la exit 0: revino_rezultat.sql → revenire_rezultat.csv. La orice eroare: fereastra.ts inchide.
\set ON_ERROR_STOP 1
\ir derivate.sql
SET LOCAL lock_timeout = '5s';
SELECT set_config('rv1.manifest_sha256', :'manifest_sha256', true), set_config('rv1.documente', :'documente', true);
CREATE TEMP TABLE rv_raw (nr bigint GENERATED ALWAYS AS IDENTITY, linie text) ON COMMIT DROP;
\set c1 '\\copy rv_raw(linie) FROM ' :'manifest' ' WITH (FORMAT csv, DELIMITER E''\\x02'', QUOTE E''\\x01'')'
:c1
CREATE TEMP TABLE rv_m (document_id bigint, licitatie_id bigint, pagini integer, sha_vechi text, sha_nou text, fisier_path text, size_bytes bigint,
  pagina_offset integer, pdf_sha256 text, storage_etag text, storage_size bigint, storage_updated_at timestamptz, meta_status_procesare text,
  meta_pagini_necitite integer[], meta_procesat_la timestamptz, meta_pagini_procesate integer, meta_pagini_felie integer, integritate_ok boolean,
  calitate_ok boolean, calitate_acceptata_nominal boolean, motiv_acceptare text) ON COMMIT DROP;
\set c2 '\\copy rv_m FROM ' :'manifest' ' WITH (FORMAT csv, HEADER true)'
:c2
CREATE TEMP TABLE rv_r (document_id bigint, sha_nou text, status_procesare text, pagini_necitite integer[], procesat_la timestamptz,
  pagini_procesate integer, pagini_felie integer, prov_id bigint, constatat_la timestamptz) ON COMMIT DROP;
\set c3 '\\copy rv_r FROM ' :'rezultat' ' WITH (FORMAT csv, HEADER true)'
:c3
CREATE TEMP TABLE rv_rez (document_id bigint, sha_vechi text, status_procesare text, pagini_necitite integer[], procesat_la timestamptz,
  pagini_procesate integer, pagini_felie integer, prov_id bigint, constatat_la timestamptz) ON COMMIT DROP;

DO $revino$
DECLARE
  c_whitelist CONSTANT bigint[] := ARRAY[137,138,139,165,166,167,168,169,170,171,212,213,434,1288,1289,1290,1291,1292,1293,1294];
  v_docs bigint[]; m record; d record; o record; v_vechi text; v_der text; v_prov bigint; v_cl timestamptz;
BEGIN
  IF session_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'garda: session_user=% (trebuie postgres)', session_user; END IF;
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'garda: sesiune cu JWT (auth.uid=%)', auth.uid(); END IF;
  IF encode(sha256(convert_to((SELECT string_agg(linie, E'\n' ORDER BY nr) FROM rv_raw) || E'\n', 'UTF8')), 'hex')
     IS DISTINCT FROM current_setting('rv1.manifest_sha256') THEN RAISE EXCEPTION 'manifestul nu e cel aprobat (sha256)'; END IF;
  v_docs := CASE WHEN current_setting('rv1.documente') = 'toate' THEN ARRAY(SELECT document_id FROM rv_r)
                 ELSE string_to_array(replace(current_setting('rv1.documente'), ' ', ''), ',')::bigint[] END;
  IF cardinality(v_docs) = 0 OR (SELECT count(DISTINCT x) FROM unnest(v_docs) x) <> cardinality(v_docs) THEN RAISE EXCEPTION 'lista de documente goală sau dublată'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_docs) x WHERE NOT (x = ANY (c_whitelist)) OR x NOT IN (SELECT document_id FROM rv_r) OR x NOT IN (SELECT document_id FROM rv_m)) THEN
    RAISE EXCEPTION 'document în afara whitelist-ului / a rezultatului aplicării / a manifestului';
  END IF;
  LOCK TABLE public.ofertare_analiza_versiuni, public.ofertare_cant_doc_decizii, public.ofertare_cant_extrageri, public.ofertare_cantitati,
    public.ofertare_cerinte, public.ofertare_clauze_contract, public.ofertare_doc_texte_prov, public.ofertare_formulare_registru,
    public.ofertare_ingest_garda, public.ofertare_raspuns_set_doc, public.ofertare_triere IN SHARE MODE;
  FOR m IN SELECT rv_m.*, rv_r.status_procesare AS a_status, rv_r.pagini_necitite AS a_necitite, rv_r.procesat_la AS a_procesat_la,
                  rv_r.pagini_procesate AS a_procesate, rv_r.pagini_felie AS a_felie, rv_r.prov_id
             FROM rv_m JOIN rv_r USING (document_id) WHERE rv_m.document_id = ANY (v_docs) ORDER BY rv_m.licitatie_id, rv_m.document_id LOOP
    PERFORM 1 FROM public.ofertare_licitatii WHERE id = m.licitatie_id FOR KEY SHARE;
    SELECT * INTO d FROM public.ofertare_documente_atribuire WHERE id = m.document_id FOR NO KEY UPDATE NOWAIT;
    IF d.licitatie_id IS DISTINCT FROM m.licitatie_id THEN RAISE EXCEPTION 'doc %: licitația s-a schimbat (CAS, sub lock)', m.document_id; END IF;
    -- CAS pe starea EXACTĂ de după aplicare (aplicare_rezultat.csv) + identitate + Storage
    IF encode(sha256(convert_to(d.text_extras, 'UTF8')), 'hex') IS DISTINCT FROM m.sha_nou THEN RAISE EXCEPTION 'doc %: textul nu mai e cel recitit (CAS)', m.document_id; END IF;
    IF d.status_procesare IS DISTINCT FROM m.a_status OR d.pagini_necitite IS DISTINCT FROM m.a_necitite OR d.procesat_la IS DISTINCT FROM m.a_procesat_la
       OR d.pagini_procesate IS DISTINCT FROM m.a_procesate OR d.pagini_felie IS DISTINCT FROM m.a_felie THEN
      RAISE EXCEPTION 'doc %: metadatele diferă de starea de după aplicare (CAS)', m.document_id;
    END IF;
    IF d.fisier_path IS DISTINCT FROM m.fisier_path OR d.size_bytes IS DISTINCT FROM m.size_bytes OR d.pagina_offset IS DISTINCT FROM m.pagina_offset
       OR d.pagini IS DISTINCT FROM m.pagini THEN RAISE EXCEPTION 'doc %: identitatea s-a schimbat (CAS)', m.document_id; END IF;
    SELECT x.metadata->>'eTag' AS etag, (x.metadata->>'size')::bigint AS sz, x.updated_at INTO o
      FROM storage.objects x WHERE x.bucket_id = 'ofertare' AND x.name = m.fisier_path;
    IF NOT FOUND OR o.etag IS DISTINCT FROM m.storage_etag OR o.sz IS DISTINCT FROM m.storage_size
       OR date_trunc('milliseconds', o.updated_at) IS DISTINCT FROM date_trunc('milliseconds', m.storage_updated_at) THEN
      RAISE EXCEPTION 'doc %: PDF-ul din Storage s-a schimbat (CAS)', m.document_id;
    END IF;
    -- exact proveniența aplicării; orice altă proveniență / decizie / extragere / derivat → refuz (decide Răzvan)
    v_der := pg_temp.rv1_derivate(m.document_id, m.prov_id);
    IF v_der IS NOT NULL THEN RAISE EXCEPTION 'doc %: are derivate / proveniențe / decizii în plus: %', m.document_id, v_der; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ofertare_doc_texte_prov WHERE id = m.prov_id AND document_id = m.document_id) THEN
      RAISE EXCEPTION 'doc %: proveniența aplicării % lipsește', m.document_id, m.prov_id;
    END IF;
    SELECT text INTO v_vechi FROM public.ofertare_doc_texte WHERE licitatie_id = m.licitatie_id AND sha256 = m.sha_vechi;
    IF v_vechi IS NULL OR encode(sha256(convert_to(v_vechi, 'UTF8')), 'hex') IS DISTINCT FROM m.sha_vechi THEN
      RAISE EXCEPTION 'doc %: textul vechi lipsește din arhivă', m.document_id;
    END IF;
    UPDATE public.ofertare_documente_atribuire SET text_extras = v_vechi, status_procesare = m.meta_status_procesare,
           pagini_necitite = m.meta_pagini_necitite, procesat_la = m.meta_procesat_la, pagini_procesate = m.meta_pagini_procesate,
           pagini_felie = m.meta_pagini_felie
     WHERE id = m.document_id
     RETURNING status_procesare, pagini_necitite, procesat_la, pagini_procesate, pagini_felie INTO d;
    SELECT greatest(clock_timestamp(), coalesce(max(constatat_la) + interval '1 microsecond', '-infinity'))
      INTO v_cl FROM public.ofertare_doc_texte_prov WHERE document_id = m.document_id;
    INSERT INTO public.ofertare_doc_texte_prov (licitatie_id, document_id, sha256, origine, producator, completitudine, pagini_necitite, constatat_la)
    VALUES (m.licitatie_id, m.document_id, m.sha_vechi, 'sinteza_ai', 'revenire-recitire', 'integral', '{}', v_cl) RETURNING id INTO v_prov;
    -- postcondiții: ultima proveniență (ordonarea înghețării) = sha_vechi, iar textul vechi NU e valid pentru B
    IF (SELECT sha256 FROM public.ofertare_doc_texte_prov WHERE document_id = m.document_id ORDER BY constatat_la DESC, id DESC LIMIT 1) IS DISTINCT FROM m.sha_vechi THEN
      RAISE EXCEPTION 'postcondiție: doc % — ultima proveniență nu e textul vechi', m.document_id;
    END IF;
    IF public.fn_ofertare_cb_text_valid(m.licitatie_id, m.document_id, m.sha_vechi) IS DISTINCT FROM '{}'::jsonb THEN
      RAISE EXCEPTION 'postcondiție: doc % — textul vechi a devenit valid pentru B', m.document_id;
    END IF;
    INSERT INTO rv_rez VALUES (m.document_id, m.sha_vechi, d.status_procesare, d.pagini_necitite, d.procesat_la, d.pagini_procesate, d.pagini_felie, v_prov, v_cl);
  END LOOP;
  IF (SELECT count(*) FROM rv_rez) <> cardinality(v_docs) THEN RAISE EXCEPTION 'postcondiție: % din % documente revenite', (SELECT count(*) FROM rv_rez), cardinality(v_docs); END IF;
END $revino$;
\set c4 '\\copy (SELECT * FROM rv_rez ORDER BY document_id) TO ' :'provizoriu' ' WITH (FORMAT csv, HEADER true)'
:c4
