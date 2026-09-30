-- J02b — raport READ-ONLY: cerințe pe licitații ACTIVE închise (verde) DOAR de AI.
-- Nu scrie nimic. Rulabil oricând (înainte și după migrare).
-- Licitație activă = status NOT IN ('castigata','pierduta','abandonata').
-- cale 'gate_nsa_ai' : fn_gate_depunere live o numără acoperită doar prin ofertare_acoperire.status='nu_se_aplica' (propunere AI),
--                      fără nicio dovadă acoperit/acoperit_partener verificată pe scan.
-- cale 'pt_exceptat_ai': v_ofertare_pt_stare o numără „exceptată” doar prin ofertare_pt_legaturi fel='exceptat' sursa='ai',
--                      fără exceptare 'om' și fără capitol (cerințe tip propunere/forma).
WITH lic AS (
  SELECT id, status FROM public.ofertare_licitatii
  WHERE status NOT IN ('castigata','pierduta','abandonata')
), cer AS (
  SELECT c.* FROM public.ofertare_cerinte c JOIN lic ON lic.id = c.licitatie_id
  WHERE c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
), gate AS (
  SELECT 'gate_nsa_ai'::text AS cale, c.licitatie_id, c.id AS cerinta_id, c.tip,
         (c.stare = 'nu_se_aplica' AND c.stare_de IS NOT NULL) AS are_decizie_om_fara_amprenta
  FROM cer c
  WHERE EXISTS (SELECT 1 FROM public.ofertare_acoperire a WHERE a.cerinta_id = c.id AND a.status = 'nu_se_aplica')
    AND NOT EXISTS (SELECT 1 FROM public.ofertare_acoperire a WHERE a.cerinta_id = c.id
                    AND a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan
                    AND NOT COALESCE(a.reverificare_ceruta, false))
), pt AS (
  SELECT 'pt_exceptat_ai'::text, c.licitatie_id, c.id, c.tip, false
  FROM cer c
  WHERE c.tip IN ('propunere','forma')
    AND EXISTS (SELECT 1 FROM public.ofertare_pt_legaturi l WHERE l.cerinta_id = c.id AND l.fel = 'exceptat' AND l.sursa = 'ai')
    AND NOT EXISTS (SELECT 1 FROM public.ofertare_pt_legaturi l WHERE l.cerinta_id = c.id AND l.fel = 'exceptat' AND COALESCE(l.sursa,'') <> 'ai')
    AND NOT EXISTS (SELECT 1 FROM public.ofertare_pt_legaturi l WHERE l.cerinta_id = c.id AND l.fel = 'capitol')
), r AS (SELECT * FROM gate UNION ALL SELECT * FROM pt)
SELECT r.cale, r.licitatie_id, lic.status AS status_licitatie,
       count(*) AS cerinte,
       count(*) FILTER (WHERE r.tip = 'eliminatorie') AS eliminatorii,
       count(*) FILTER (WHERE r.are_decizie_om_fara_amprenta) AS cu_stare_om_fara_amprenta,
       (array_agg(r.cerinta_id ORDER BY r.cerinta_id))[1:20] AS primele_id
FROM r JOIN lic ON lic.id = r.licitatie_id
GROUP BY r.cale, r.licitatie_id, lic.status
ORDER BY r.cale, r.licitatie_id;
