-- PREVIEW read-only pentru 20261121a (înainte de apply, pentru „da”-ul lui Răzvan pe EFECT).
-- Efectul la apply: coloanele noi pornesc goale (NULL pe toate licitațiile) → toate funcțiile de alertă se comportă EXACT ca azi (ARRAY[R1, NULL]
-- filtrat de NULL = ARRAY[R1]; „fără responsabil” = R1 NULL ȘI R2 NULL = R1 NULL). Nimic nu se trimite în plus până nu se setează un responsabil 2.
-- Preview-ul arată starea curentă (licitațiile active, responsabilul 1) și că nu există încă coloanele (deci niciun R2 de migrat).
SELECT
  (SELECT count(*) FROM ofertare_licitatii) AS licitatii_total,
  (SELECT count(*) FROM ofertare_licitatii WHERE status IN ('identificata', 'analiza', 'go', 'in_lucru') AND termen_depunere > now()) AS active,
  (SELECT count(*) FROM ofertare_licitatii WHERE status IN ('identificata', 'analiza', 'go', 'in_lucru') AND termen_depunere > now() AND responsabil_id IS NULL) AS active_fara_responsabil,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_licitatii' AND column_name LIKE 'responsabil2%') AS coloane_r2_existente,
  (SELECT jsonb_agg(jsonb_build_object('id', l.id, 'nr', l.nr_anunt, 'status', l.status, 'responsabil', p.name) ORDER BY l.termen_depunere)
     FROM ofertare_licitatii l LEFT JOIN profiles p ON p.id = l.responsabil_id
     WHERE l.status IN ('identificata', 'analiza', 'go', 'in_lucru') AND l.termen_depunere > now()) AS licitatii_active;
