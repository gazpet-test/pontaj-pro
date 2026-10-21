-- PREVIEW read-only pentru 20261104a (rulat ÎNAINTE de apply, pentru „da”-ul lui Răzvan pe EFECT): lista exactă de documente /
-- licitații care ar intra în alerta „răspuns necitit” imediat după schimbare, cu regula nouă (aceeași precedență ca
-- ofertare_rc_doc_stare, scrisă inline pentru că funcția nu există încă) și aceleași filtre ca ofertare_alerta_rc_necitit:
-- licitație go / in_lucru, termen în viitor, ziua sosirii doar banner (excepție: depunere azi / mâine), mail = owner la ≤ 5 zile.
-- „nou_in_alerta” = documentul NU era în alertă cu regula veche (procesat / partial / OCR neverificat erau excluse).
WITH d AS (
  SELECT d.id, d.licitatie_id, d.nume_original, d.status_procesare, d.created_at,
    CASE
      WHEN d.status_procesare = 'ignorat' THEN 'citit'
      WHEN EXISTS (SELECT 1 FROM ofertare_doc_texte_prov p
                   WHERE p.document_id = d.id AND p.origine = 'ocr_local_neverificat'
                     AND p.sha256 = encode(sha256(convert_to(coalesce(d.text_extras, ''), 'UTF8')), 'hex')) THEN 'text_neverificat'
      WHEN d.status_procesare = 'partial' THEN 'partial'
      WHEN d.status_procesare = 'procesat' AND coalesce(jsonb_typeof(d.analiza -> 'citire_noi'), 'null') <> 'null' THEN 'citit'
      WHEN d.status_procesare = 'procesat' THEN 'perechi_necitite'
      ELSE 'necitit'
    END AS stare_noua,
    public.ofertare_rc_doc_necitit(d.id) AS in_alerta_azi
  FROM ofertare_documente_atribuire d
  WHERE d.tip = 'raspuns_clarificare'
), z AS (SELECT (now() AT TIME ZONE 'Europe/Bucharest')::date AS azi)
SELECT li.id AS licitatie_id, li.nr_anunt, left(li.obiect, 60) AS obiect, li.status AS status_licitatie,
  (li.termen_depunere AT TIME ZONE 'Europe/Bucharest') AS termen_ro,
  (li.termen_depunere AT TIME ZONE 'Europe/Bucharest')::date - z.azi AS zile_depunere,
  d.id AS document_id, left(coalesce(d.nume_original, '#' || d.id), 70) AS document, d.status_procesare, d.stare_noua,
  (d.created_at AT TIME ZONE 'Europe/Bucharest')::date AS sosit,
  NOT d.in_alerta_azi AS nou_in_alerta,
  -- ziua sosirii: doar bannerul, fără clopoțel / mail — cu excepția depunerii azi / mâine
  NOT (z.azi - (d.created_at AT TIME ZONE 'Europe/Bucharest')::date < 1 AND (li.termen_depunere AT TIME ZONE 'Europe/Bucharest')::date - z.azi > 1) AS clopotel,
  ((li.termen_depunere AT TIME ZONE 'Europe/Bucharest')::date - z.azi <= 5) AS mail_owner
FROM d JOIN ofertare_licitatii li ON li.id = d.licitatie_id CROSS JOIN z
WHERE d.stare_noua IN ('necitit', 'perechi_necitite', 'text_neverificat')
  AND li.status IN ('go', 'in_lucru') AND li.termen_depunere > now()
ORDER BY zile_depunere, li.id, d.id;
