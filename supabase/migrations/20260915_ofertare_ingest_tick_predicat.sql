-- ofertare_ingest_tick: workerul de pe server foloseste acelasi predicat ca UI-ul.
-- Era `doc.nume_original ~* '\.pdf$'`, care lua si plansele (78 MB citite degeaba, raman
-- agatate pe 'in_lucru' si se reiau la fiecare trecere) si fisierele deja sparte (84 MB
-- peste bucatile lor, cu textul dublat in registrul de cerinte). Vezi 20260915_ofertare_doc_de_citit.sql.
-- Restul functiei e neschimbat: lease de 3 minute, 3 documente in paralel, max 4 incercari.

CREATE OR REPLACE FUNCTION public.ofertare_ingest_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  jwt text; c record; d record; n_lansate int; n_ramase int; in_asteptare int; rid bigint;
  PARALEL constant int := 3; LEASE constant interval := interval '3 minutes'; MAX_INCERCARI constant int := 4;
BEGIN
  SELECT decrypted_secret INTO jwt FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_JWT' LIMIT 1;
  IF jwt IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO in_asteptare FROM net.http_request_queue WHERE url LIKE '%/ofertare-ingest-doc';
  FOR c IN SELECT * FROM ofertare_ingest_coada WHERE activ ORDER BY cerut_la LOOP
    n_lansate := 0;
    IF in_asteptare = 0 THEN
      FOR d IN
        SELECT doc.id, coalesce(doc.pagini_procesate, 0) AS pp FROM ofertare_documente_atribuire doc
        LEFT JOIN ofertare_ingest_lansari l ON l.doc_id = doc.id
        WHERE doc.licitatie_id = c.licitatie_id
          AND doc.status_procesare IN ('neprocesat', 'in_lucru', 'eroare')
          AND ofertare_doc_de_citit(doc.licitatie_id, doc.id, doc.nume_original, doc.tip)
          AND doc.fisier_path NOT LIKE '%/neincarcat/%'
          AND (l.doc_id IS NULL OR l.lansat_la < now() - LEASE OR (l.req_id IS NOT NULL AND EXISTS (SELECT 1 FROM net._http_response r WHERE r.id = l.req_id)))
          AND (l.doc_id IS NULL OR l.incercari < MAX_INCERCARI OR coalesce(doc.pagini_procesate,0) > l.pagini_la_lansare)
        ORDER BY (doc.status_procesare = 'in_lucru') DESC, doc.id LIMIT PARALEL
      LOOP
        rid := net.http_post(
          url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/ofertare-ingest-doc',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || jwt),
          body := jsonb_build_object('doc_id', d.id, 'apeluri', 1),
          timeout_milliseconds := 150000);
        INSERT INTO ofertare_ingest_lansari (doc_id, pagini_la_lansare, req_id) VALUES (d.id, d.pp, rid)
          ON CONFLICT (doc_id) DO UPDATE SET lansat_la = now(), req_id = EXCLUDED.req_id,
            incercari = CASE WHEN EXCLUDED.pagini_la_lansare > ofertare_ingest_lansari.pagini_la_lansare THEN 1 ELSE ofertare_ingest_lansari.incercari + 1 END,
            pagini_la_lansare = EXCLUDED.pagini_la_lansare;
        n_lansate := n_lansate + 1;
      END LOOP;
      in_asteptare := in_asteptare + n_lansate;
    END IF;
    UPDATE ofertare_ingest_coada SET ultimul_tick = now(), lansari = lansari + n_lansate WHERE licitatie_id = c.licitatie_id;
    IF n_lansate = 0 AND in_asteptare = 0 THEN
      SELECT count(*) INTO n_ramase FROM ofertare_documente_atribuire doc
      LEFT JOIN ofertare_ingest_lansari l ON l.doc_id = doc.id
      WHERE doc.licitatie_id = c.licitatie_id AND doc.status_procesare IN ('neprocesat', 'in_lucru', 'eroare')
        AND ofertare_doc_de_citit(doc.licitatie_id, doc.id, doc.nume_original, doc.tip)
        AND doc.fisier_path NOT LIKE '%/neincarcat/%'
        AND (l.doc_id IS NULL OR l.lansat_la < now() - LEASE);
      IF n_ramase = 0 AND NOT EXISTS (
        SELECT 1 FROM ofertare_documente_atribuire doc JOIN ofertare_ingest_lansari l ON l.doc_id = doc.id
        WHERE doc.licitatie_id = c.licitatie_id AND doc.status_procesare IN ('neprocesat','in_lucru','eroare') AND l.lansat_la >= now() - LEASE
      ) THEN
        UPDATE ofertare_ingest_coada SET activ = false, terminat_la = now(),
          nota = (SELECT format('%s procesate, %s partiale, %s cu eroare/epuizate',
                    count(*) FILTER (WHERE status_procesare = 'procesat'), count(*) FILTER (WHERE status_procesare = 'partial'),
                    count(*) FILTER (WHERE status_procesare IN ('eroare','neprocesat','in_lucru')))
                  FROM ofertare_documente_atribuire doc WHERE doc.licitatie_id = c.licitatie_id
                    AND ofertare_doc_de_citit(doc.licitatie_id, doc.id, doc.nume_original, doc.tip))
        WHERE licitatie_id = c.licitatie_id;
        IF c.cerut_de IS NOT NULL THEN
          INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
          SELECT c.cerut_de, 'info', 'Ofertare', 'Ofertare: citirea documentatiei s-a terminat la ' || coalesce(li.nr_anunt, '#' || li.id),
            (SELECT nota FROM ofertare_ingest_coada WHERE licitatie_id = c.licitatie_id) || '. Poti porni extragerea cerintelor.', '/ofertare'
          FROM ofertare_licitatii li WHERE li.id = c.licitatie_id;
        END IF;
      END IF;
    END IF;
  END LOOP;
END $function$;
