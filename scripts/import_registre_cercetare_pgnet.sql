-- Import registre cercetare din răspunsurile pg_net (JSON-urile de la commit-ul fixat), cu verificare sha256.
-- Echivalent cu scripts/import_registre_cercetare.py (aceeași mapare; câmpurile fără coloană → extra).
-- Parametri: id-urile cererilor net.http_get și sha256-urile așteptate (git show <commit>:<fișier> | sha256sum).
DO $imp$
DECLARE
  v_req  int[]  := ARRAY[100594,100595,100596,100597,100598];
  v_sha  text[] := ARRAY['39cc5bfb0ebbd3ca31bb3ac191dbdcbc95ca90e82bd48420401a9feb40e81b33',
                         'bfd7d823a4ed3c7e58dc152d8659e4f8531f34380504c7f67a39d72a999556cb',
                         '5368ae0adf4da8ac28153a66664a2348164a5c4c3e9135928025eeb7d1a66780',
                         'f18afb0f08cce8e75bbb1525ef99325acf196ceba260c534ec3135deba9c82b8',
                         '5856e208067cecff8f8e1641b7875283ede13a2e8c2a0dbb1cb3f62633c9d511'];
  v_doc  jsonb[] := ARRAY[]::jsonb[];
  v_c    text; v_code int; i int;
  V      constant text := 'cercetare-2026-10-02';
BEGIN
  FOR i IN 1..5 LOOP
    SELECT content, status_code INTO v_c, v_code FROM net._http_response WHERE id = v_req[i];
    IF v_c IS NULL OR v_code IS DISTINCT FROM 200 THEN RAISE EXCEPTION 'REFUZ: răspunsul % lipsește sau status %', v_req[i], v_code; END IF;
    IF encode(sha256(convert_to(v_c,'UTF8')),'hex') <> v_sha[i] THEN RAISE EXCEPTION 'REFUZ: sha256 diferit la cererea %', v_req[i]; END IF;
    v_doc := v_doc || v_c::jsonb;
  END LOOP;

  -- 1. norme_surse
  INSERT INTO public.norme_surse (source_id,tip,cod,titlu,emitent,editie,data_publicarii,effective_from,effective_to,status,inlocuit_de,url_oficial,acces,domenii,
      aplicabilitate_gazpet,motiv_aplicabilitate,verificat_pe_sursa_primara,ofertare_normative_id,snapshot_sha256,snapshot_data,ultima_verificare,nota,extra,versiune_import)
  SELECT r->>'source_id', r->>'tip', r->>'cod', r->>'titlu', r->>'emitent', r->>'editie',
    CASE WHEN r->>'data_publicarii' ~ '^\d{4}-\d\d-\d\d$' THEN (r->>'data_publicarii')::date WHEN r->>'data_publicarii' ~ '^\d\d\.\d\d\.\d{4}$' THEN to_date(r->>'data_publicarii','DD.MM.YYYY') END,
    CASE WHEN r->>'effective_from' ~ '^\d{4}-\d\d-\d\d$' THEN (r->>'effective_from')::date WHEN r->>'effective_from' ~ '^\d\d\.\d\d\.\d{4}$' THEN to_date(r->>'effective_from','DD.MM.YYYY') END,
    CASE WHEN r->>'effective_to' ~ '^\d{4}-\d\d-\d\d$' THEN (r->>'effective_to')::date WHEN r->>'effective_to' ~ '^\d\d\.\d\d\.\d{4}$' THEN to_date(r->>'effective_to','DD.MM.YYYY') END,
    r->>'status', r->>'inlocuit_de', r->>'url_oficial', r->>'acces',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(r->'domenii','[]'))),
    r->>'aplicabilitate_gazpet', r->>'motiv_aplicabilitate', (r->>'verificat_pe_sursa_primara')::boolean, (r->>'ofertare_normative_id')::bigint,
    r->>'snapshot_sha256', (r->>'snapshot_data')::date, (r->>'ultima_verificare')::date, r->>'nota',
    (r - ARRAY['source_id','tip','cod','titlu','emitent','editie','data_publicarii','effective_from','effective_to','status','inlocuit_de','url_oficial','acces','domenii',
               'aplicabilitate_gazpet','motiv_aplicabilitate','verificat_pe_sursa_primara','ofertare_normative_id','snapshot_sha256','snapshot_data','ultima_verificare','nota'])
      || CASE WHEN r->>'data_publicarii' IS NOT NULL AND r->>'data_publicarii' !~ '^(\d{4}-\d\d-\d\d|\d\d\.\d\d\.\d{4})$' THEN jsonb_build_object('data_publicarii_brut', r->>'data_publicarii') ELSE '{}'::jsonb END
      || CASE WHEN r->>'effective_from' IS NOT NULL AND r->>'effective_from' !~ '^(\d{4}-\d\d-\d\d|\d\d\.\d\d\.\d{4})$' THEN jsonb_build_object('effective_from_brut', r->>'effective_from') ELSE '{}'::jsonb END,
    V
  FROM jsonb_array_elements(v_doc[1]) r
  ON CONFLICT (source_id) DO NOTHING;

  -- 2. norme_cerinte
  INSERT INTO public.norme_cerinte (requirement_id,source_id,editie,locator,cerinta,conditii_aplicabilitate,temei_tip,obligatoriu_de_ce,evidenta_ceruta,verificare,prag,
      tip_consum,domeniu,faza,incredere,verificat_pe_sursa,necesita_standard_licentiat,note,tema,extra,versiune_import)
  SELECT r->>'requirement_id', r->>'source_id', r->>'editie', r->>'locator', r->>'cerinta', r->>'conditii_aplicabilitate', r->>'temei_tip', r->>'obligatoriu_de_ce',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(r->'evidenta_ceruta','[]'))), r->>'verificare', NULLIF(r->'prag','null'::jsonb),
    r->>'tip_consum', r->>'domeniu', r->>'faza', r->>'incredere', COALESCE((r->>'verificat_pe_sursa')::boolean,false), COALESCE((r->>'necesita_standard_licentiat')::boolean,false),
    r->>'note', r->>'tema',
    r - ARRAY['requirement_id','source_id','editie','locator','cerinta','conditii_aplicabilitate','temei_tip','obligatoriu_de_ce','evidenta_ceruta','verificare','prag',
              'tip_consum','domeniu','faza','incredere','verificat_pe_sursa','necesita_standard_licentiat','note','tema'],
    V
  FROM jsonb_array_elements(v_doc[2]) r
  ON CONFLICT (requirement_id) DO NOTHING;

  -- 3. norme_graf
  INSERT INTO public.norme_graf (from_source_id,to_source_id,relatie,locator,nota,tema,versiune_import)
  SELECT r->>'from_source_id', r->>'to_source_id', r->>'relatie', COALESCE(r->>'locator',''), r->>'nota', r->>'tema', V
  FROM jsonb_array_elements(v_doc[3]) r
  ON CONFLICT (from_source_id,to_source_id,relatie,locator) DO NOTHING;

  -- 4. cnsc_decizii
  INSERT INTO public.cnsc_decizii (id,source_id,nr_decizie,buletin_oficial,alias_buletin_oficial,data,an,domeniu,tema,regula,temei_legal,link_sursa,autoritate,obiect,problema,
      solutie,rationament_cnsc,cum_ne_ajuta,tip_procedura,lege_aplicabila,valoare_estimata,sub_prag,fapte_relevante,concluzie_cnsc,comparabilitate,citate_cheie,control_judiciar,
      avertisment_instanta,verificat,snapshot_text_sha256,temei_tip,extra,versiune_import)
  SELECT r->>'id', (SELECT s.source_id FROM public.norme_surse s WHERE s.source_id = 'SRC-' || (r->>'id')),
    r->>'nr_decizie', r->>'buletin_oficial', r->>'alias_buletin_oficial',
    CASE WHEN r->>'data' ~ '^\d{4}-\d\d-\d\d$' THEN (r->>'data')::date WHEN r->>'data' ~ '^\d\d\.\d\d\.\d{4}$' THEN to_date(r->>'data','DD.MM.YYYY') END,
    (r->>'an')::int, r->>'domeniu', ARRAY(SELECT jsonb_array_elements_text(COALESCE(r->'tema','[]'))), r->>'regula',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(r->'temei_legal','[]'))), r->>'link_sursa', r->>'autoritate', r->>'obiect', r->>'problema',
    r->>'solutie', r->>'rationament_cnsc', r->>'cum_ne_ajuta', r->>'tip_procedura', r->>'lege_aplicabila', (r->>'valoare_estimata')::numeric, (r->>'sub_prag')::boolean,
    r->>'fapte_relevante', r->>'concluzie_cnsc',
    CASE jsonb_typeof(r->'comparabilitate') WHEN 'object' THEN r->'comparabilitate' WHEN 'string' THEN jsonb_build_object('text', r->>'comparabilitate') END,
    COALESCE(NULLIF(r->'citate_cheie','null'::jsonb),'[]'::jsonb),
    CASE jsonb_typeof(r->'control_judiciar') WHEN 'object' THEN r->'control_judiciar' WHEN 'string' THEN jsonb_build_object('text', r->>'control_judiciar') END,
    r->>'avertisment_instanta', COALESCE((r->>'verificat')::boolean,false), r->>'snapshot_text_sha256', 'PRACTICA_CNSC',
    (r - ARRAY['id','nr_decizie','buletin_oficial','alias_buletin_oficial','data','an','domeniu','tema','regula','temei_legal','link_sursa','autoritate','obiect','problema',
               'solutie','rationament_cnsc','cum_ne_ajuta','tip_procedura','lege_aplicabila','valoare_estimata','sub_prag','fapte_relevante','concluzie_cnsc','comparabilitate',
               'citate_cheie','control_judiciar','avertisment_instanta','verificat','snapshot_text_sha256','temei_tip'])
      || CASE WHEN r->>'data' IS NOT NULL AND r->>'data' !~ '^(\d{4}-\d\d-\d\d|\d\d\.\d\d\.\d{4})$' THEN jsonb_build_object('data_brut', r->>'data') ELSE '{}'::jsonb END,
    V
  FROM jsonb_array_elements(v_doc[4]) r
  ON CONFLICT (id) DO NOTHING;

  -- 5. clarificari_tipare
  INSERT INTO public.clarificari_tipare (pattern_id,cod_vechi,tip_problema,titlu,trigger,documente_de_verificat,normative_refs,precedente_cnsc,intrebare_propusa,impact_intern,
      confidence,requires_human_legal_review,note,versiune_import)
  SELECT r->>'pattern_id', ARRAY(SELECT jsonb_array_elements_text(COALESCE(r->'cod_vechi','[]'))), r->>'tip_problema', r->>'titlu', r->'trigger',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(r->'documente_de_verificat','[]'))), ARRAY(SELECT jsonb_array_elements_text(COALESCE(r->'normative_refs','[]'))),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(r->'precedente_cnsc','[]'))), r->>'intrebare_propusa', NULLIF(r->'impact_intern','null'::jsonb),
    r->>'confidence', COALESCE((r->>'requires_human_legal_review')::boolean,false), r->>'note', V
  FROM jsonb_array_elements(v_doc[5]) r
  ON CONFLICT (pattern_id) DO NOTHING;

  -- legături logice din tipare (fail-closed)
  IF EXISTS (SELECT 1 FROM public.clarificari_tipare t, unnest(t.normative_refs) x WHERE NOT EXISTS (SELECT 1 FROM public.norme_cerinte c WHERE c.requirement_id = x))
     OR EXISTS (SELECT 1 FROM public.clarificari_tipare t, unnest(t.precedente_cnsc) x WHERE NOT EXISTS (SELECT 1 FROM public.norme_surse s WHERE s.source_id = x)) THEN
    RAISE EXCEPTION 'REFUZ: tipare cu referințe orfane';
  END IF;
END $imp$;
