-- P0c-prep (23.09.2026, GO Copilot): locatorul pe interval ⟦PAGINA a-b⟧ ajunge în registru FĂRĂ pierdere.
-- Schema explicită (nu int4range): pagina_interval_start / pagina_interval_end int NULL.
-- locator_verificat: pagina | interval | document. pagina_declarata rămâne separată (nu e fapt verificat).
-- Semantica: ⟦PAGINA 4⟧ + excerpt literal → pagina (sursa_pagina=4); ⟦PAGINA 3-5⟧ + excerpt → interval (sursa_pagina NULL, 3..5);
-- găsit literal fără pagină/interval demonstrabil → document.

ALTER TABLE public.ofertare_cerinte
  ADD COLUMN IF NOT EXISTS pagina_interval_start integer,
  ADD COLUMN IF NOT EXISTS pagina_interval_end   integer;
ALTER TABLE public.ofertare_cerinte DROP CONSTRAINT IF EXISTS ofertare_cerinte_pagina_interval_chk;
ALTER TABLE public.ofertare_cerinte ADD CONSTRAINT ofertare_cerinte_pagina_interval_chk
  CHECK ((pagina_interval_start IS NULL AND pagina_interval_end IS NULL)
      OR (pagina_interval_start IS NOT NULL AND pagina_interval_end IS NOT NULL AND pagina_interval_start > 0 AND pagina_interval_end >= pagina_interval_start));
ALTER TABLE public.ofertare_cerinte DROP CONSTRAINT IF EXISTS ofertare_cerinte_locator_verificat_check;
ALTER TABLE public.ofertare_cerinte ADD CONSTRAINT ofertare_cerinte_locator_verificat_check
  CHECK (locator_verificat = ANY (ARRAY['pagina','interval','document']));
COMMENT ON COLUMN public.ofertare_cerinte.pagina_interval_start IS 'P0c-prep: intervalul ⟦PAGINA a-b⟧ dovedit de validator (start). Doar când locator_verificat=interval; atunci sursa_pagina e NULL.';
COMMENT ON COLUMN public.ofertare_cerinte.locator_verificat IS 'Verdictul validatorului FĂRĂ AI pe excerpt: pagina = găsit pe pagina declarată; interval = găsit într-un segment ⟦PAGINA a-b⟧ (pagina_interval_start/end); document = găsit în document, pagina corectată din marcaj sau fără pagină demonstrabilă. pagina_declarata = ce a afirmat modelul, NU e fapt verificat. NULL = rând fără validator.';

-- trigger de proveniență: și cele două câmpuri interval sunt blocate pe rândurile din pack
CREATE OR REPLACE FUNCTION public.fn_ofertare_cerinte_pack_protejeaza()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sursa_pack_id IS NOT NULL
       AND current_user <> (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID) THEN
      RAISE EXCEPTION 'ofertare_cerinte: sursa_pack_id se setează doar prin fn_ofertare_source_pack_import';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.sursa_pack_id IS DISTINCT FROM OLD.sursa_pack_id THEN
    RAISE EXCEPTION 'ofertare_cerinte: sursa_pack_id nu se schimbă';
  END IF;
  IF OLD.sursa_pack_id IS NOT NULL THEN
    IF NEW.sursa_pasaj IS DISTINCT FROM OLD.sursa_pasaj OR NEW.sursa_pagina IS DISTINCT FROM OLD.sursa_pagina
       OR NEW.pagina_declarata IS DISTINCT FROM OLD.pagina_declarata OR NEW.locator_verificat IS DISTINCT FROM OLD.locator_verificat
       OR NEW.pagina_interval_start IS DISTINCT FROM OLD.pagina_interval_start OR NEW.pagina_interval_end IS DISTINCT FROM OLD.pagina_interval_end
       OR NEW.sursa_ref IS DISTINCT FROM OLD.sursa_ref OR NEW.sursa_document_id IS DISTINCT FROM OLD.sursa_document_id
       OR NEW.sursa_mapare IS DISTINCT FROM OLD.sursa_mapare OR NEW.pasaj_verificat IS DISTINCT FROM OLD.pasaj_verificat
       OR NEW.incertitudine IS DISTINCT FROM OLD.incertitudine THEN
      RAISE EXCEPTION 'ofertare_cerinte: câmpurile de proveniență ale unei cerințe din pack nu se editează (originalul e în pack)';
    END IF;
    IF NEW.text_cerinta IS DISTINCT FROM OLD.text_cerinta THEN
      NEW.text_editat_la := now();
      NEW.text_editat_de := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_cerinte_pack_protejeaza() FROM PUBLIC, anon;

-- preview: + pagina_interval_start / pagina_interval_end (tipul de retur se schimbă → DROP + CREATE + grants)
DROP FUNCTION IF EXISTS public.fn_ofertare_source_pack_preview(bigint, real);
CREATE FUNCTION public.fn_ofertare_source_pack_preview(p_pack_id bigint, p_prag real DEFAULT 0.45)
RETURNS TABLE (
  ref text, text_grounded text, tip text, cand_se_prezinta text, document_probant text, lot text,
  nume_fisier text, document_id bigint, sursa_mapare text,
  pagina integer, pagina_declarata integer, pagina_interval_start integer, pagina_interval_end integer,
  sectiune text, excerpt_verificat text, locator_verificat text, incertitudine text,
  seamana_cu_id bigint, seamana_cu_similarity real, deja_importat boolean, importabil boolean
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_pack public.ofertare_source_pack%ROWTYPE;
BEGIN
  SELECT * INTO v_pack FROM public.ofertare_source_pack sp WHERE sp.id = p_pack_id;  -- RLS: fn_are_acces_ofertare
  IF v_pack.id IS NULL THEN RAISE EXCEPTION 'pack inexistent sau fără acces'; END IF;
  RETURN QUERY
  WITH c AS (
    SELECT x.value AS j, x.ordinality AS ord FROM jsonb_array_elements(COALESCE(v_pack.pack->'cerinte', '[]'::jsonb)) WITH ORDINALITY x
  ), m AS (
    SELECT c.j, c.ord,
           c.j->>'ref' AS ref,
           c.j#>>'{locator,nume_fisier}' AS nume_fisier,
           d.document_id, d.sursa_mapare
    FROM c
    LEFT JOIN LATERAL (
      SELECT * FROM public.fn_ofertare_source_pack_mapeaza_doc(
        v_pack.licitatie_id, c.j#>>'{locator,nume_fisier}', c.j#>>'{locator,seap_cod}',
        (SELECT (dd->>'id')::bigint FROM jsonb_array_elements(COALESCE(v_pack.pack->'documente','[]'::jsonb)) dd
          WHERE dd->>'nume_fisier' = c.j#>>'{locator,nume_fisier}' LIMIT 1))
    ) d ON true
  )
  SELECT m.ref,
         m.j->>'text',
         m.j->>'tip',
         public.fn_ofertare_source_pack_cand(m.j->>'cand_se_prezinta'),
         m.j->>'document_probant',
         m.j->>'lot',
         m.nume_fisier, m.document_id, m.sursa_mapare,
         COALESCE((m.j#>>'{locator,pagina_validata}')::int, (m.j#>>'{locator,pagina}')::int),
         (m.j#>>'{locator,pagina_declarata}')::int,
         (m.j#>'{locator,pagina_interval}'->>0)::int,
         (m.j#>'{locator,pagina_interval}'->>1)::int,
         m.j#>>'{locator,sectiune}',
         m.j#>>'{locator,excerpt}',
         m.j#>>'{locator,verificat}',
         m.j->>'incertitudine',
         s.id, s.sim,
         EXISTS (SELECT 1 FROM public.ofertare_cerinte oc WHERE oc.sursa_pack_id = p_pack_id AND oc.sursa_ref = m.ref),
         (m.document_id IS NOT NULL)
  FROM m
  LEFT JOIN LATERAL (
    SELECT oc.id, extensions.similarity(oc.text_cerinta, m.j->>'text') AS sim
    FROM public.ofertare_cerinte oc
    WHERE oc.licitatie_id = v_pack.licitatie_id AND oc.inlocuita_de IS NULL AND oc.duplicat_al IS NULL
      AND extensions.similarity(oc.text_cerinta, m.j->>'text') >= p_prag
    ORDER BY sim DESC, oc.id LIMIT 1
  ) s ON true
  ORDER BY m.ord;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_source_pack_preview(bigint, real) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_source_pack_preview(bigint, real) TO authenticated, service_role;

-- import: transportă intervalul; locator_verificat acceptă 'interval'
CREATE OR REPLACE FUNCTION public.fn_ofertare_source_pack_import(p_pack_id bigint, p_refs text[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_pack public.ofertare_source_pack%ROWTYPE;
  v_nr_anunt text;
  v_ref text;
  v_c jsonb;
  v_doc bigint; v_map text; v_id bigint;
  v_inserate bigint[] := '{}'; v_sarite text[] := '{}'; v_nemapate text[] := '{}'; v_refuzate text[] := '{}';
  v_importabile int; v_nemapate_total int; v_importate int; v_stare text; v_hist bigint;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'import: fără sesiune (auth.uid() NULL)'; END IF;
  SELECT * INTO v_pack FROM public.ofertare_source_pack WHERE id = p_pack_id FOR UPDATE;
  IF v_pack.id IS NULL THEN RAISE EXCEPTION 'import: pack inexistent'; END IF;
  IF v_pack.stare = 'respins' THEN RAISE EXCEPTION 'import: pack respins'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = v_actor AND pr.is_owner)
     AND NOT EXISTS (SELECT 1 FROM public.ofertare_licitatii l WHERE l.id = v_pack.licitatie_id AND l.responsabil_id = v_actor) THEN
    RAISE EXCEPTION 'import: doar ownerul sau responsabilul licitației';
  END IF;
  SELECT nr_anunt INTO v_nr_anunt FROM public.ofertare_licitatii WHERE id = v_pack.licitatie_id;
  IF (v_pack.pack #>> '{licitatie,licitatie_id}')::bigint IS DISTINCT FROM v_pack.licitatie_id
     OR ((v_pack.pack #>> '{licitatie,nr_anunt}') IS NOT NULL AND (v_pack.pack #>> '{licitatie,nr_anunt}') IS DISTINCT FROM v_nr_anunt) THEN
    RAISE EXCEPTION 'import: pack ≠ licitatie (identitate)';
  END IF;
  IF p_refs IS NULL OR array_length(p_refs, 1) IS NULL THEN RAISE EXCEPTION 'import: niciun ref selectat'; END IF;

  FOREACH v_ref IN ARRAY p_refs LOOP
    SELECT x INTO v_c FROM jsonb_array_elements(v_pack.pack->'cerinte') x WHERE x->>'ref' = v_ref LIMIT 1;
    IF v_c IS NULL THEN v_refuzate := v_refuzate || v_ref; CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.ofertare_cerinte WHERE sursa_pack_id = p_pack_id AND sursa_ref = v_ref) THEN
      v_sarite := v_sarite || v_ref; CONTINUE;
    END IF;
    SELECT document_id, sursa_mapare INTO v_doc, v_map FROM public.fn_ofertare_source_pack_mapeaza_doc(
      v_pack.licitatie_id, v_c#>>'{locator,nume_fisier}', v_c#>>'{locator,seap_cod}',
      (SELECT (dd->>'id')::bigint FROM jsonb_array_elements(COALESCE(v_pack.pack->'documente','[]'::jsonb)) dd
        WHERE dd->>'nume_fisier' = v_c#>>'{locator,nume_fisier}' LIMIT 1));
    IF v_doc IS NULL THEN v_nemapate := v_nemapate || v_ref; CONTINUE; END IF;
    INSERT INTO public.ofertare_cerinte (
      licitatie_id, sursa_document_id, sursa_sectiune, sursa_pagina, pagina_declarata, pagina_interval_start, pagina_interval_end,
      sursa_pasaj, pasaj_verificat, locator_verificat, text_cerinta, tip, lot, document_probant, cand_se_prezinta, incertitudine,
      extras_de_ai, confirmata_de, stare, sursa_pack_id, sursa_ref, sursa_mapare)
    VALUES (
      v_pack.licitatie_id, v_doc, v_c#>>'{locator,sectiune}',
      -- sursa_pagina = doar pagină DOVEDITĂ (pagina_validata sau, la verdict 'pagina', pagina); la 'interval'/'document' fără pagină → NULL
      CASE WHEN (v_c#>>'{locator,verificat}') = 'interval' THEN NULL
           ELSE COALESCE((v_c#>>'{locator,pagina_validata}')::int, (v_c#>>'{locator,pagina}')::int) END,
      (v_c#>>'{locator,pagina_declarata}')::int,
      CASE WHEN (v_c#>>'{locator,verificat}') = 'interval' THEN (v_c#>'{locator,pagina_interval}'->>0)::int END,
      CASE WHEN (v_c#>>'{locator,verificat}') = 'interval' THEN (v_c#>'{locator,pagina_interval}'->>1)::int END,
      v_c#>>'{locator,excerpt}', (v_c#>>'{locator,verificat}') IS NOT NULL,
      CASE WHEN v_c#>>'{locator,verificat}' IN ('pagina','interval','document') THEN v_c#>>'{locator,verificat}' ELSE NULL END,
      v_c->>'text',
      CASE WHEN v_c->>'tip' IN ('eliminatorie','propunere','forma','contractuala') THEN v_c->>'tip' ELSE 'propunere' END,
      v_c->>'lot', v_c->>'document_probant',
      public.fn_ofertare_source_pack_cand(v_c->>'cand_se_prezinta'),
      CASE WHEN v_c->>'incertitudine' IN ('sigur','probabil','neclar') THEN v_c->>'incertitudine' ELSE NULL END,
      true, NULL, 'de_analizat', p_pack_id, v_ref, v_map)
    RETURNING id INTO v_id;
    v_inserate := v_inserate || v_id;
  END LOOP;

  INSERT INTO public.ofertare_source_pack_importuri (pack_id, actor, refs_cerute, inserate, sarite, nemapate, refuzate)
  VALUES (p_pack_id, v_actor, p_refs, v_inserate, v_sarite, v_nemapate, v_refuzate) RETURNING id INTO v_hist;

  SELECT count(*) FILTER (WHERE pv.importabil), count(*) FILTER (WHERE NOT pv.importabil)
    INTO v_importabile, v_nemapate_total FROM public.fn_ofertare_source_pack_preview(p_pack_id) pv;
  SELECT count(*) INTO v_importate FROM public.ofertare_cerinte WHERE sursa_pack_id = p_pack_id;
  v_stare := CASE WHEN v_nemapate_total = 0 AND v_importabile > 0 AND v_importate >= v_importabile
                  THEN 'importat' ELSE 'importat_partial' END;
  UPDATE public.ofertare_source_pack SET stare = v_stare, ultim_import_la = now() WHERE id = p_pack_id;

  RETURN jsonb_build_object('import_id', v_hist, 'stare', v_stare, 'actor', v_actor,
    'inserate', to_jsonb(v_inserate), 'sarite', to_jsonb(v_sarite), 'nemapate', to_jsonb(v_nemapate), 'refuzate', to_jsonb(v_refuzate),
    'importabile', v_importabile, 'nemapate_total', v_nemapate_total, 'importate_total', v_importate);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_source_pack_import(bigint, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_source_pack_import(bigint, text[]) TO authenticated;
