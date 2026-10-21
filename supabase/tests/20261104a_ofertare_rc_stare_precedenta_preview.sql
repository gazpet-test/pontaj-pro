-- PREVIEW read-only pentru 20261104a (rulat ÎNAINTE de apply, pentru „da”-ul lui Răzvan pe EFECT).
-- r2 (review #834 r1, P2): simulează EXACT ce ar face ofertare_alerta_rc_necitit la o rulare „acum” (moment parametrizabil în z.acum),
-- per licitație, cu regula NOUĂ (precedența din ofertare_rc_doc_stare, scrisă inline — funcția nu există încă) și, alături, cu regula
-- VECHE (funcția live ofertare_rc_doc_necitit), ca diferența să fie vizibilă:
--   grupare: licitație go / in_lucru, termen în viitor; de_la = cea mai veche zi de sosire dintre documentele în alertă; max_id;
--   CONTINUE: zile_necitit < 1 ȘI zile_depunere > 1 (ziua sosirii = doar banner);
--   clopoțel: revendicarea amprentei rc_necitit '<zi>|<max_id>' față de amprenta EXISTENTĂ (zi diferită SAU max_id mai mare);
--   destinatari: responsabilul + ownerii dacă zile_necitit ≥ 2 SAU zile_depunere ≤ 2 SAU fără responsabil;
--   mail (owner): zile_depunere ≤ 5 ȘI revendicarea rc_necitit_mail (fără rând / zi diferită / 'r' / 'p' mai vechi de 10 minute).
-- O singură instrucțiune (execute_sql întoarce doar ultimul rezultat); detaliul pe documente e în coloana `documente`.
WITH z AS (SELECT now() AS acum),
z2 AS (SELECT acum, (acum AT TIME ZONE 'Europe/Bucharest')::date AS azi FROM z),
d AS (
  SELECT d.id, d.licitatie_id, d.nume_original, d.status_procesare, d.created_at,
    CASE
      WHEN d.status_procesare = 'ignorat' THEN 'citit'
      WHEN (SELECT p.origine FROM ofertare_doc_texte_prov p
             WHERE p.document_id = d.id AND p.sha256 = encode(sha256(convert_to(coalesce(d.text_extras, ''), 'UTF8')), 'hex')
             ORDER BY p.constatat_la DESC, p.id DESC LIMIT 1) = 'ocr_local_neverificat'
       AND NOT EXISTS (SELECT 1 FROM ofertare_cant_doc_decizii x
                       WHERE x.document_id = d.id AND x.decizie = 'text_confirmat'
                         AND x.doc_sha256 = encode(sha256(convert_to(coalesce(d.text_extras, ''), 'UTF8')), 'hex')
                         AND NOT EXISTS (SELECT 1 FROM ofertare_cant_doc_decizii r WHERE r.revoca_id = x.id)) THEN 'text_neverificat'
      WHEN d.status_procesare = 'partial' THEN 'partial'
      WHEN d.status_procesare = 'procesat' AND coalesce(jsonb_typeof(d.analiza -> 'citire_noi'), 'null') <> 'null' THEN 'citit'
      WHEN d.status_procesare = 'procesat' THEN 'perechi_necitite'
      ELSE 'necitit'
    END AS stare_noua,
    public.ofertare_rc_doc_necitit(d.id) AS alerta_veche
  FROM ofertare_documente_atribuire d
  WHERE d.tip = 'raspuns_clarificare'
),
dn AS (SELECT d.*, d.stare_noua IN ('necitit', 'perechi_necitite', 'text_neverificat') AS alerta_noua FROM d),
g AS (
  SELECT li.id, li.nr_anunt, li.obiect, li.termen_depunere, li.responsabil_id, regula,
         count(*) AS nr, min((dn.created_at AT TIME ZONE 'Europe/Bucharest')::date) AS de_la, max(dn.id) AS max_id,
         jsonb_agg(jsonb_build_object('id', dn.id, 'doc', left(coalesce(dn.nume_original, '#' || dn.id), 60),
                                      'status', dn.status_procesare, 'stare_noua', dn.stare_noua, 'era_in_alerta', dn.alerta_veche)
                   ORDER BY dn.id) AS documente
  FROM ofertare_licitatii li
  JOIN dn ON dn.licitatie_id = li.id
  CROSS JOIN LATERAL (VALUES ('noua'), ('veche')) v(regula)
  CROSS JOIN z2
  WHERE li.status IN ('go', 'in_lucru') AND li.termen_depunere > z2.acum
    AND CASE regula WHEN 'noua' THEN dn.alerta_noua ELSE dn.alerta_veche END
  GROUP BY li.id, li.nr_anunt, li.obiect, li.termen_depunere, li.responsabil_id, regula
),
s AS (
  SELECT g.*, z2.azi - g.de_la AS zile_necitit, (g.termen_depunere AT TIME ZONE 'Europe/Bucharest')::date - z2.azi AS zile_dep,
         z2.azi, z2.acum,
         (SELECT a.amprenta FROM ofertare_alerte_amprenta a WHERE a.licitatie_id = g.id AND a.fel = 'rc_necitit') AS ampr,
         (SELECT a.amprenta FROM ofertare_alerte_amprenta a WHERE a.licitatie_id = g.id AND a.fel = 'rc_necitit_mail') AS ampr_mail,
         (SELECT a.trimisa_la FROM ofertare_alerte_amprenta a WHERE a.licitatie_id = g.id AND a.fel = 'rc_necitit_mail') AS mail_la
  FROM g CROSS JOIN z2
),
c AS (
  SELECT s.*,
    NOT (zile_necitit < 1 AND zile_dep > 1) AS trece_de_continue,
    (ampr IS NULL OR split_part(ampr, '|', 1) IS DISTINCT FROM azi::text
       OR (CASE WHEN split_part(ampr, '|', 2) ~ '^[0-9]{1,18}$' THEN split_part(ampr, '|', 2)::bigint ELSE 0 END) < max_id) AS claim_clopotel,
    (zile_dep <= 5 AND (ampr_mail IS NULL OR split_part(ampr_mail, '|', 1) IS DISTINCT FROM azi::text
       OR split_part(ampr_mail, '|', 2) = 'r' OR (split_part(ampr_mail, '|', 2) = 'p' AND mail_la < acum - interval '10 minutes'))) AS claim_mail
  FROM s
)
SELECT c.regula, c.id AS licitatie_id, c.nr_anunt, left(c.obiect, 50) AS obiect,
  (c.termen_depunere AT TIME ZONE 'Europe/Bucharest') AS termen_ro, c.zile_dep, c.zile_necitit, c.de_la, c.nr, c.max_id,
  c.ampr AS amprenta_existenta, c.ampr_mail AS amprenta_mail_existenta,
  CASE WHEN NOT c.trece_de_continue THEN 'doar banner (ziua sosirii)'
       WHEN NOT c.claim_clopotel THEN 'tăcere (amprentă deja la zi)'
       ELSE 'clopoțel' END AS efect,
  CASE WHEN c.trece_de_continue AND c.claim_clopotel THEN
    (SELECT string_agg(coalesce(pr.name, pr.id::text), ', ' ORDER BY pr.name)
     FROM profiles pr
     WHERE pr.id = c.responsabil_id
        OR (pr.is_owner AND (c.zile_necitit >= 2 OR c.zile_dep <= 2 OR c.responsabil_id IS NULL))) END AS destinatari,
  (c.trece_de_continue AND c.claim_mail) AS mail_owner,
  c.documente
FROM c
ORDER BY c.id, c.regula;
