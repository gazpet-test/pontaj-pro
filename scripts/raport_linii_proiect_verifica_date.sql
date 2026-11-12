-- Liniile raportului zilnic cu ALT proiect decât șantierul raportului (20261217a) — DOAR CITIRE, pentru coordonator, pe PRODUCȚIE (și pe clonă).
-- Întrebarea: defectul din antetul migrării 20261217a (linii scrise pe proiectul vechi în timp ce șantierul se muta) a produs deja ceva?
-- Rulare (o tranzacție READ ONLY, nimic scris; parola din pgpass, niciodată în comandă):
--   psql -X -v ON_ERROR_STOP=1 -v sistem=<system_identifier al bazei> -h <host> -p <port> -U <user> -d postgres \
--        -f scripts/raport_linii_proiect_verifica_date.sql > linii_proiect_date.txt
-- Garda țintei: system_identifier al bazei = -v sistem, altfel refuz înainte de orice citire.
-- Ce tipărește: un NOTICE „LINII_PROIECT …” cu numerele, apoi lista rapoartelor atinse (cel mult 200, fără niciun text din raport).
-- Categoriile (o linie poate intra în mai multe):
--   linii_alt_proiect / rapoarte_alt_proiect / santiere — liniile al căror proiect diferă de proiectul de AZI al șantierului raportului.
--     Nu înseamnă automat defect: un șantier mutat LEGITIM în alt proiect are rapoartele vechi cu liniile pe proiectul vechi (corect: scrise
--     cât era acolo). Istoricul mutărilor nu e păstrat în BD, deci „proiectul la data raportului” se deduce, nu se citește:
--   probabil_defect — raportul atins a fost salvat DUPĂ un alt raport al aceluiași șantier cu liniile pe proiectul de azi (deci șantierul era
--     deja în proiectul de azi când s-a salvat; ora salvării = ultima intrare din raport_zilnic_salvari, altfel updated_at). Fals pozitiv
--     posibil doar dacă șantierul s-a mutat de mai multe ori (dus-întors) — se verifică cu ochii pe lista de mai jos;
--   amestecate — un raport cu linii pe mai multe proiecte (RPC-ul nu le poate scrie așa: urmă a căii directe vechi);
--   activitate_straina — linia e pe un proiect, activitatea ei pe altul;
--   rezumat_alt_proiect — rezumatul a fost compus SUB LOCK (20261216a) pentru alt proiect decât al liniilor: semnul cel mai direct al
--     defectului după 12.11.2026 (garda a citit proiectul nou, liniile au rămas pe cel vechi);
--   distributie_tronson_strain — rândurile de distribuție gaze cu tronsonul altui proiect decât al șantierului de azi (aceeași întrebare pentru
--     raport_distributie_linii, care nu are coloană de proiect).
-- Fără corecții de date aici: ce iese se discută cu Răzvan (preview -> „da” -> apply, separat).
\set ON_ERROR_STOP 1
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SELECT set_config('tlp.sistem', :'sistem', true) IS NOT NULL AS sistem_setat;
DO $d$
DECLARE v record;
BEGIN
  IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM current_setting('tlp.sistem') THEN
    RAISE EXCEPTION 'REFUZ: system_identifier al bazei <> -v sistem (nu e baza ceruta); nimic citit';
  END IF;
  WITH
  salvat AS (   -- ora ultimei salvări a fiecărui raport
    SELECT z.id, z.site_id, coalesce((SELECT max(s.creat_la) FROM public.raport_zilnic_salvari s WHERE s.raport_id = z.id), z.updated_at) AS la
      FROM public.rapoarte_zilnice z
  ),
  linii AS (
    SELECT l.id, l.raport_id, l.proiect_id AS p_linie, st.proiect_id AS p_santier, sv.site_id, sv.la, pa.proiect_id AS p_activitate
      FROM public.raport_lucrari l
      JOIN salvat sv ON sv.id = l.raport_id
      JOIN public.sites st ON st.id = sv.site_id
      LEFT JOIN public.proiect_activitati pa ON pa.id = l.activitate_id
  ),
  alt AS (SELECT * FROM linii WHERE p_linie IS DISTINCT FROM p_santier),
  rap_alt AS (SELECT DISTINCT raport_id, site_id, la, p_santier FROM alt),
  probabil AS (
    SELECT DISTINCT r.raport_id FROM rap_alt r
     WHERE EXISTS (SELECT 1 FROM linii o WHERE o.site_id = r.site_id AND o.raport_id <> r.raport_id
                     AND o.p_linie IS NOT DISTINCT FROM r.p_santier AND o.la < r.la)
  )
  SELECT (SELECT count(*) FROM alt) AS linii_alt, (SELECT count(*) FROM rap_alt) AS rapoarte_alt,
         (SELECT count(DISTINCT site_id) FROM rap_alt) AS santiere, (SELECT count(*) FROM probabil) AS probabil,
         (SELECT count(*) FROM (SELECT raport_id FROM linii GROUP BY raport_id HAVING count(DISTINCT coalesce(p_linie, -1)) > 1) x) AS amestecate,
         (SELECT count(*) FROM linii WHERE p_activitate IS NOT NULL AND p_activitate IS DISTINCT FROM p_linie) AS activitate_straina,
         (SELECT count(DISTINCT z.id) FROM public.rapoarte_zilnice z JOIN public.raport_lucrari l ON l.raport_id = z.id
           WHERE z.rezumat_proiect_id IS NOT NULL AND l.proiect_id IS DISTINCT FROM z.rezumat_proiect_id) AS rezumat_alt,
         (SELECT count(*) FROM public.raport_distributie_linii d JOIN public.rapoarte_zilnice z ON z.id = d.raport_id
            JOIN public.sites st ON st.id = z.site_id JOIN public.proiect_unitati u ON u.id = d.unitate_id
           WHERE u.proiect_id IS DISTINCT FROM st.proiect_id) AS distributie
    INTO v;
  RAISE NOTICE 'LINII_PROIECT linii_alt_proiect=% rapoarte_alt_proiect=% santiere=% probabil_defect=% amestecate=% activitate_straina=% rezumat_alt_proiect=% distributie_tronson_strain=%',
    v.linii_alt, v.rapoarte_alt, v.santiere, v.probabil, v.amestecate, v.activitate_straina, v.rezumat_alt, v.distributie;
END $d$;

-- lista rapoartelor atinse (id-uri, zile, proiecte, ora salvării; niciun text din raport), cele mai noi întâi
SELECT z.id AS raport_id, z.site_id, z.data, st.proiect_id AS proiect_santier_azi,
       (SELECT string_agg(DISTINCT coalesce(l.proiect_id::text, '-'), ',') FROM public.raport_lucrari l WHERE l.raport_id = z.id) AS proiecte_linii,
       (SELECT count(*) FROM public.raport_lucrari l WHERE l.raport_id = z.id AND l.proiect_id IS DISTINCT FROM st.proiect_id) AS linii_alt_proiect,
       z.rezumat_proiect_id, z.rezumat_sursa,
       coalesce((SELECT max(s.creat_la) FROM public.raport_zilnic_salvari s WHERE s.raport_id = z.id), z.updated_at) AS salvat_la
  FROM public.rapoarte_zilnice z JOIN public.sites st ON st.id = z.site_id
 WHERE EXISTS (SELECT 1 FROM public.raport_lucrari l WHERE l.raport_id = z.id AND l.proiect_id IS DISTINCT FROM st.proiect_id)
    OR EXISTS (SELECT 1 FROM public.raport_distributie_linii d JOIN public.proiect_unitati u ON u.id = d.unitate_id
                WHERE d.raport_id = z.id AND u.proiect_id IS DISTINCT FROM st.proiect_id)
 ORDER BY salvat_la DESC NULLS LAST, z.id DESC
 LIMIT 200;

ROLLBACK;
