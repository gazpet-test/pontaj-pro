-- Recitirea valului 1, pasul 3 (procedura §5): APLICAREA. O singură tranzacție, totul sau nimic.
-- Rulare DOAR prin psql.ts (TLS verify-full cu CA-ul Supabase; README) — chat, în fereastra deschisă cu fereastra.ts, după „da”-ul lui Răzvan pe preview, care citează sha256 al manifestului):
--   deno run -A scripts/recitire_val1/psql.ts -X -1 -v ON_ERROR_STOP=1 -v manifest=<dir>/manifest_aprobat.csv -v texte=<dir>/texte.csv \
--        -v manifest_sha256=<sha din „da”> -v provizoriu=<dir>/aplicare_provizoriu.csv -f scripts/recitire_val1/aplica.sql
-- Apoi, DOAR la exit 0: aplica_rezultat.sql (read-only) → aplicare_rezultat.csv. La orice eroare: fereastra.ts inchide.
\set ON_ERROR_STOP 1
\ir derivate.sql
SET LOCAL lock_timeout = '5s';
SELECT set_config('rv1.manifest_sha256', :'manifest_sha256', true);
-- cârlig DOAR pentru harness (testul de concurență): pauză după LOCK TABLE; fără -v pauza=… nu face nimic
\if :{?pauza}
SELECT set_config('rv1.pauza', :'pauza', true);
\endif

CREATE TEMP TABLE rv_raw (nr bigint GENERATED ALWAYS AS IDENTITY, linie text) ON COMMIT DROP;
\set c1 '\\copy rv_raw(linie) FROM ' :'manifest' ' WITH (FORMAT csv, DELIMITER E''\\x02'', QUOTE E''\\x01'')'
:c1
CREATE TEMP TABLE rv_m (document_id bigint, licitatie_id bigint, pagini integer, sha_vechi text, sha_nou text, fisier_path text, size_bytes bigint,
  pagina_offset integer, pdf_sha256 text, storage_etag text, storage_size bigint, storage_updated_at timestamptz, meta_status_procesare text,
  meta_pagini_necitite integer[], meta_procesat_la timestamptz, meta_pagini_procesate integer, meta_pagini_felie integer, integritate_ok boolean,
  calitate_ok boolean, calitate_acceptata_nominal boolean, motiv_acceptare text) ON COMMIT DROP;
\set c2 '\\copy rv_m FROM ' :'manifest' ' WITH (FORMAT csv, HEADER true)'
:c2
CREATE TEMP TABLE rv_t (document_id bigint, text_b64 text) ON COMMIT DROP;
\set c3 '\\copy rv_t FROM ' :'texte' ' WITH (FORMAT csv, HEADER true)'
:c3
CREATE TEMP TABLE rv_rez (document_id bigint, sha_nou text, status_procesare text, pagini_necitite integer[], procesat_la timestamptz,
  pagini_procesate integer, pagini_felie integer, prov_id bigint, constatat_la timestamptz) ON COMMIT DROP;

DO $aplica$
DECLARE
  c_whitelist CONSTANT bigint[] := ARRAY[137,138,139,165,166,167,168,169,170,171,212,213,434,1288,1289,1290,1291,1292,1293,1294];
  m record; d record; o record; v_text text; v_der text; v_prov bigint; v_cl timestamptz; v_n integer;
BEGIN
  -- 1. gărzi, ÎNAINTE de orice mutație
  IF session_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'garda: session_user=% (trebuie postgres)', session_user; END IF;
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'garda: sesiune cu JWT (auth.uid=%)', auth.uid(); END IF;
  IF encode(sha256(convert_to((SELECT string_agg(linie, E'\n' ORDER BY nr) FROM rv_raw) || E'\n', 'UTF8')), 'hex')
     IS DISTINCT FROM current_setting('rv1.manifest_sha256') THEN
    RAISE EXCEPTION 'manifestul nu e cel aprobat (sha256 diferit de cel din „da”)';
  END IF;
  SELECT count(*) INTO v_n FROM rv_m;
  IF v_n = 0 THEN RAISE EXCEPTION 'manifest gol'; END IF;
  IF EXISTS (SELECT 1 FROM rv_m WHERE document_id IS NULL OR NOT (document_id = ANY (c_whitelist))) THEN RAISE EXCEPTION 'document în afara whitelist-ului'; END IF;
  IF (SELECT count(DISTINCT document_id) FROM rv_m) <> v_n THEN RAISE EXCEPTION 'document dublat în manifest'; END IF;
  IF EXISTS (SELECT 1 FROM rv_m WHERE integritate_ok IS NOT TRUE) THEN RAISE EXCEPTION 'integritatea nu se poate excepta'; END IF;
  IF EXISTS (SELECT 1 FROM rv_m WHERE NOT (calitate_ok IS TRUE OR (calitate_acceptata_nominal IS TRUE AND length(btrim(coalesce(motiv_acceptare, ''))) >= 10))) THEN
    RAISE EXCEPTION 'calitate neacceptată (nici calitate_ok, nici acceptare nominală cu motiv)';
  END IF;
  -- texte.csv poate conține și textele documentelor scoase din aprobare: se cere EXACT un text pentru fiecare document din manifest
  IF (SELECT count(DISTINCT document_id) FROM rv_t) <> (SELECT count(*) FROM rv_t)
     OR EXISTS (SELECT 1 FROM rv_m LEFT JOIN rv_t USING (document_id) WHERE rv_t.document_id IS NULL) THEN
    RAISE EXCEPTION 'texte.csv nu corespunde manifestului (lipsă sau dublat)';
  END IF;
  IF EXISTS (SELECT 1 FROM rv_m JOIN rv_t USING (document_id)
              WHERE encode(sha256(decode(rv_t.text_b64, 'base64')), 'hex') IS DISTINCT FROM rv_m.sha_nou) THEN
    RAISE EXCEPTION 'textul nou nu are sha_nou din manifest';
  END IF;
  IF EXISTS (SELECT 1 FROM rv_m LEFT JOIN public.ofertare_documente_atribuire x ON x.id = rv_m.document_id
              WHERE x.id IS NULL OR x.licitatie_id IS DISTINCT FROM rv_m.licitatie_id OR x.pagini IS DISTINCT FROM rv_m.pagini) THEN
    RAISE EXCEPTION 'document inexistent sau cu licitație / pagini diferite de manifest';
  END IF;

  -- 2. tabelele auxiliare: SHARE (citiri permise, nicio scriere a altora până la COMMIT); ordine fixă, alfabetică
  LOCK TABLE public.ofertare_analiza_versiuni, public.ofertare_cant_doc_decizii, public.ofertare_cant_extrageri, public.ofertare_cantitati,
    public.ofertare_cerinte, public.ofertare_clauze_contract, public.ofertare_doc_texte_prov, public.ofertare_formulare_registru,
    public.ofertare_ingest_garda, public.ofertare_raspuns_set_doc, public.ofertare_triere IN SHARE MODE;
  PERFORM pg_sleep(coalesce(nullif(current_setting('rv1.pauza', true), ''), '0')::numeric);

  -- 3. per document, în ordinea (licitatie_id, document_id)
  FOR m IN SELECT * FROM rv_m ORDER BY licitatie_id, document_id LOOP
    PERFORM 1 FROM public.ofertare_licitatii WHERE id = m.licitatie_id FOR KEY SHARE;
    SELECT * INTO d FROM public.ofertare_documente_atribuire WHERE id = m.document_id FOR NO KEY UPDATE NOWAIT;
    IF d.licitatie_id IS DISTINCT FROM m.licitatie_id THEN RAISE EXCEPTION 'doc %: licitația s-a schimbat (CAS, sub lock)', m.document_id; END IF;
    IF encode(sha256(convert_to(d.text_extras, 'UTF8')), 'hex') IS DISTINCT FROM m.sha_vechi THEN RAISE EXCEPTION 'doc %: textul s-a schimbat (CAS)', m.document_id; END IF;
    IF d.fisier_path IS DISTINCT FROM m.fisier_path OR d.size_bytes IS DISTINCT FROM m.size_bytes OR d.pagina_offset IS DISTINCT FROM m.pagina_offset
       OR d.pagini IS DISTINCT FROM m.pagini THEN RAISE EXCEPTION 'doc %: identitatea s-a schimbat (CAS)', m.document_id; END IF;
    IF d.status_procesare IS DISTINCT FROM m.meta_status_procesare OR d.pagini_necitite IS DISTINCT FROM m.meta_pagini_necitite
       OR d.procesat_la IS DISTINCT FROM m.meta_procesat_la OR d.pagini_procesate IS DISTINCT FROM m.meta_pagini_procesate
       OR d.pagini_felie IS DISTINCT FROM m.meta_pagini_felie THEN RAISE EXCEPTION 'doc %: metadatele s-au schimbat (CAS)', m.document_id; END IF;
    SELECT x.metadata->>'eTag' AS etag, (x.metadata->>'size')::bigint AS sz, x.updated_at INTO o
      FROM storage.objects x WHERE x.bucket_id = 'ofertare' AND x.name = m.fisier_path;
    IF NOT FOUND OR o.etag IS DISTINCT FROM m.storage_etag OR o.sz IS DISTINCT FROM m.storage_size
       OR date_trunc('milliseconds', o.updated_at) IS DISTINCT FROM date_trunc('milliseconds', m.storage_updated_at) THEN
      RAISE EXCEPTION 'doc %: PDF-ul din Storage s-a schimbat (CAS)', m.document_id;
    END IF;
    v_der := pg_temp.rv1_derivate(m.document_id, NULL);
    IF v_der IS NOT NULL THEN RAISE EXCEPTION 'doc %: are derivate / proveniență / decizii: %', m.document_id, v_der; END IF;
    SELECT convert_from(decode(text_b64, 'base64'), 'UTF8') INTO v_text FROM rv_t WHERE document_id = m.document_id;
    INSERT INTO public.ofertare_doc_texte (licitatie_id, sha256, text) VALUES (m.licitatie_id, m.sha_vechi, d.text_extras) ON CONFLICT DO NOTHING;
    INSERT INTO public.ofertare_doc_texte (licitatie_id, sha256, text) VALUES (m.licitatie_id, m.sha_nou, v_text) ON CONFLICT DO NOTHING;
    UPDATE public.ofertare_documente_atribuire SET text_extras = v_text, status_procesare = 'procesat', pagini_necitite = '{}',
           pagini_procesate = m.pagini, procesat_la = clock_timestamp()
     WHERE id = m.document_id
     RETURNING status_procesare, pagini_necitite, procesat_la, pagini_procesate, pagini_felie INTO d;
    SELECT greatest(clock_timestamp(), coalesce(max(constatat_la) + interval '1 microsecond', '-infinity'))
      INTO v_cl FROM public.ofertare_doc_texte_prov WHERE document_id = m.document_id;
    INSERT INTO public.ofertare_doc_texte_prov (licitatie_id, document_id, sha256, origine, producator, completitudine, pagini_necitite, constatat_la)
    VALUES (m.licitatie_id, m.document_id, m.sha_nou, 'transcriere', 'recitire-haiku-5-5', 'integral', '{}', v_cl) RETURNING id INTO v_prov;
    INSERT INTO rv_rez VALUES (m.document_id, m.sha_nou, d.status_procesare, d.pagini_necitite, d.procesat_la, d.pagini_procesate, d.pagini_felie, v_prov, v_cl);
  END LOOP;

  -- 4. postcondiții (RAISE, nu SELECT)
  FOR m IN SELECT rv_m.*, rv_rez.prov_id FROM rv_m JOIN rv_rez USING (document_id) LOOP
    IF (SELECT encode(sha256(convert_to(text_extras, 'UTF8')), 'hex') FROM public.ofertare_documente_atribuire WHERE id = m.document_id) IS DISTINCT FROM m.sha_nou THEN
      RAISE EXCEPTION 'postcondiție: doc % nu are sha_nou', m.document_id;
    END IF;
    IF public.fn_ofertare_cb_text_valid(m.licitatie_id, m.document_id, m.sha_nou) IS DISTINCT FROM
       jsonb_build_object('tip', 'prov', 'id', m.prov_id, 'completitudine', 'integral') THEN
      RAISE EXCEPTION 'postcondiție: doc % nu e valid prin proveniența %', m.document_id, m.prov_id;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM rv_rez) <> v_n THEN RAISE EXCEPTION 'postcondiție: % documente aplicate din %', (SELECT count(*) FROM rv_rez), v_n; END IF;
END $aplica$;

-- rezultatul PROVIZORIU (devine referință doar după COMMIT confirmat + aplica_rezultat.sql)
\set c4 '\\copy (SELECT document_id, sha_nou, status_procesare, pagini_necitite, procesat_la, pagini_procesate, pagini_felie, prov_id, constatat_la FROM rv_rez ORDER BY document_id) TO ' :'provizoriu' ' WITH (FORMAT csv, HEADER true)'
:c4
