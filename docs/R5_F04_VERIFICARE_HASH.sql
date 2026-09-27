-- SELECT numai pentru citire. Același perimetru și aceleași câmpuri ca ofertare_f3_baza.
-- Rulat de Răzvan în producție înainte de activarea blocajului F04.
WITH documente AS (
  SELECT d.id, d.licitatie_id, d.nume_original, d.tip,
    EXISTS (
      SELECT 1 FROM unnest(ARRAY[to_jsonb(d)->>'sha256', to_jsonb(d)->>'fisier_sha256',
        d.analiza#>>'{integritate,sha256}', d.analiza#>>'{integritate,fisier_sha256}']) h
      WHERE h ~* '^[0-9a-f]{64}$'
    ) AS are_hash
  FROM public.ofertare_documente_atribuire d
  WHERE d.analiza ? 'plansa' OR d.tip = 'lista_cantitati'
)
SELECT id, licitatie_id, nume_original, tip, are_hash,
  count(*) OVER () AS documente_relevante,
  count(*) FILTER (WHERE are_hash) OVER () AS cu_hash,
  count(*) FILTER (WHERE NOT are_hash) OVER () AS fara_hash
FROM documente ORDER BY licitatie_id, id;
