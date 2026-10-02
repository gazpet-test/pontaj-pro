-- Adaugă doar coloanele ale căror migrări locale sunt descrieri (SQL complet numai în istoricul live).
-- Regexurile de fixture NU pretind că reproduc integral corpusul live; testele M01 folosesc intrări explicite.
DO $view$
DECLARE d text:=rtrim(pg_get_viewdef('v_ofertare_pt_stare'::regclass,true),E';\n ');
BEGIN
  EXECUTE 'CREATE OR REPLACE VIEW v_ofertare_pt_stare WITH(security_invoker=on) AS SELECT b.*,
    (SELECT sum(q.cantitate) FROM ofertare_cantitati q WHERE q.licitatie_id=b.licitatie_id AND q.tip_sursa=''lista_f3'' AND q.um=''m'') lista_f3_m,
    g.cerut_luni garantie_cerut_luni, g.oferit_luni garantie_oferit_luni,
    g.cerut_moment garantie_cerut_moment, g.oferit_moment garantie_oferit_moment,
    (g.confirmat_de IS NOT NULL) garantie_confirmata, (g.justificare IS NOT NULL) garantie_justificata,
    ARRAY(SELECT (m[1])::int FROM ofertare_pt_capitole k CROSS JOIN LATERAL regexp_matches(k.continut,''garanție ([0-9]+) luni'',''g'') m WHERE k.licitatie_id=b.licitatie_id) garantie_luni_in_capitole,
    (SELECT count(*) FROM ofertare_cerinte c WHERE c.licitatie_id=b.licitatie_id AND c.text_cerinta LIKE ''%garanție%'') garantie_cerinte_lucrari,
    ARRAY(SELECT m[1] FROM ofertare_pt_capitole k CROSS JOIN LATERAL regexp_matches(k.continut,''(Anexa [0-9]+)'',''g'') m WHERE k.licitatie_id=b.licitatie_id) anexe_referite,
    ARRAY(SELECT k.eticheta FROM ofertare_pt_capitole k WHERE k.licitatie_id=b.licitatie_id) anexe_existente,
    ARRAY[]::text[] fraze_anexe,
    ARRAY(SELECT k.eticheta||''|''||k.titlu FROM ofertare_pt_capitole k WHERE k.licitatie_id=b.licitatie_id) capitole_ref,
    ARRAY(SELECT (m[1])::int FROM ofertare_pt_capitole k CROSS JOIN LATERAL regexp_matches(k.continut,''([0-9]+) branșamente'',''g'') m WHERE k.licitatie_id=b.licitatie_id) bransamente_in_capitole,
    ARRAY(SELECT (m[1])::int FROM ofertare_cerinte c CROSS JOIN LATERAL regexp_matches(c.text_cerinta,''([0-9]+) branșamente'',''g'') m WHERE c.licitatie_id=b.licitatie_id) bransamente_in_cerinte,
    ARRAY(SELECT k.eticheta FROM ofertare_pt_capitole k WHERE k.licitatie_id=b.licitatie_id) anexe_asteptate,
    coalesce((SELECT jsonb_agg(jsonb_build_object(''ref'',a.ref)) FROM ofertare_pt_anexe_asteptate a WHERE a.licitatie_id=b.licitatie_id),''[]''::jsonb) anexe_declarate,
    ''{}''::jsonb anexe_responsabili,
    (SELECT p.stare FROM ofertare_pt_pachet p WHERE p.licitatie_id=b.licitatie_id ORDER BY p.versiune DESC LIMIT 1) pachet_stare,
    coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM ofertare_pt_pachet_fisiere f WHERE f.pachet_id=
      (SELECT p.id FROM ofertare_pt_pachet p WHERE p.licitatie_id=b.licitatie_id ORDER BY p.versiune DESC LIMIT 1)),''[]''::jsonb) pachet_fisiere,
    (SELECT gv.activitati FROM grafic_versiuni gv WHERE gv.licitatie_id=b.licitatie_id ORDER BY gv.versiune DESC LIMIT 1) grafic_activitati_declarate,
    (SELECT gv.mod FROM grafic_versiuni gv WHERE gv.licitatie_id=b.licitatie_id ORDER BY gv.versiune DESC LIMIT 1) grafic_versiune_mod
    FROM ('||d||') b LEFT JOIN ofertare_pt_garantie g ON g.licitatie_id=b.licitatie_id';
END $view$;
