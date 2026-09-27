-- Rollback SEC 27.09.2026: versiunea fără gardă (cum era înainte).
CREATE OR REPLACE FUNCTION public.fn_ofertare_clasifica_registre(p_licitatie_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_cap int := 0; n_dep int := 0; n_exe int := 0; n_skip int := 0;
BEGIN
  WITH clasificare AS (
    SELECT c.id,
      CASE
        -- verdictul motorului spune „asta se dovedește din catalog"
        WHEN a.status IN ('acoperit','acoperit_partener','gol','regula_propunere')
          THEN 'capabilitate'
        -- „nu se aplică" → decide documentul din care provine
        WHEN a.status = 'nu_se_aplica' AND (
               d.tip IN ('fisa_date','formular')
               OR d.nume_original ILIKE '%instructiuni%'
               OR d.nume_original ILIKE '%formulare%'
             ) THEN 'depunere'
        WHEN a.status = 'nu_se_aplica' THEN 'executie'
        ELSE NULL
      END AS reg
    FROM ofertare_cerinte c
    JOIN ofertare_acoperire a ON a.cerinta_id = c.id
    LEFT JOIN ofertare_documente_atribuire d ON d.id = c.sursa_document_id
    WHERE c.licitatie_id = p_licitatie_id
      AND c.duplicat_al IS NULL AND c.inlocuita_de IS NULL
      AND coalesce(c.registru_sursa, '') <> 'om'      -- mâna omului e definitivă
  ), aplicat AS (
    UPDATE ofertare_cerinte c
       SET registru = cl.reg,
           registru_sursa = 'regula',
           registru_motiv = 'clasificat automat din verdictul motorului + documentul-sursă'
      FROM clasificare cl
     WHERE c.id = cl.id AND cl.reg IS NOT NULL
       AND (c.registru IS DISTINCT FROM cl.reg)
    RETURNING cl.reg
  )
  SELECT
    count(*) FILTER (WHERE reg = 'capabilitate'),
    count(*) FILTER (WHERE reg = 'depunere'),
    count(*) FILTER (WHERE reg = 'executie')
  INTO n_cap, n_dep, n_exe
  FROM aplicat;

  SELECT count(*) INTO n_skip FROM ofertare_cerinte
   WHERE licitatie_id = p_licitatie_id AND duplicat_al IS NULL AND inlocuita_de IS NULL
     AND registru IS NULL;

  RETURN jsonb_build_object(
    'licitatie_id', p_licitatie_id,
    'mutate_capabilitate', n_cap, 'mutate_depunere', n_dep, 'mutate_executie', n_exe,
    'ramase_neclasificate', n_skip);
END $function$;
