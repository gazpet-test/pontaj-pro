-- P0c — poarta de decizie/import pe Source Pack extinsă la „admin Ofertare" (23.09.2026, cerere explicită Răzvan în chat).
--
-- ⚠️ APLICATĂ DEJA în producție prin MCP `apply_migration` la 23.09.2026 20:08 UTC
--    (supabase_migrations.schema_migrations: version 20260923200814, name p0c_source_pack_gate_ofertare_admin).
--    Fișierul de față RECUPEREAZĂ în git definiția existentă, confruntată cu `pg_get_functiondef` live la 24.09.2026 00:10 RO.
--    NU autorizează o nouă aplicare și NU extinde alte drepturi. Re-rularea e idempotentă (CREATE OR REPLACE), dar nu e necesară.
--
-- Ce face: `fn_ofertare_source_pack_poate_decide(p_licitatie_id)` devine poarta unică folosită de
--   `fn_ofertare_source_pack_decide` și `fn_ofertare_source_pack_import`:
--   owner (profiles.is_owner) SAU responsabilul licitației SAU orice cont cu
--   user_module_access(module='ofertare', access_level='admin').
-- Sfera reală la 24.09.2026: un singur cont admin Ofertare (contul Claude, claude@gazpet.ro); owner-ii și
--   responsabilii aveau dreptul dinainte. Orice viitor admin Ofertare primește automat dreptul —
--   politica (păstrare / restrângere) e decizia lui Răzvan, consemnată în docs/p0c/P0C_PILOT_REVIEW.md §5.
-- Dreptul de decizie/import NU se extinde la confirmarea E2 (confirmata_de) și nici la dovezi.

CREATE OR REPLACE FUNCTION public.fn_ofertare_source_pack_poate_decide(p_licitatie_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.ofertare_licitatii l WHERE l.id = p_licitatie_id AND l.responsabil_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_module_access uma WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare' AND uma.access_level = 'admin')
  );
$fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_source_pack_poate_decide(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_source_pack_poate_decide(bigint) TO authenticated, service_role;

-- Decizia umană per (pack_id, sursa_ref) — identică cu 20260923_p0c_review_decizii.sql, cu poarta de mai sus.
CREATE OR REPLACE FUNCTION public.fn_ofertare_source_pack_decide(p_pack_id bigint, p_ref text, p_decizie text, p_motiv text DEFAULT NULL, p_cerinta_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_actor uuid := auth.uid(); v_pack public.ofertare_source_pack%ROWTYPE; v_id bigint; v_lic bigint;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'decizie: fără sesiune (auth.uid() NULL)'; END IF;
  SELECT * INTO v_pack FROM public.ofertare_source_pack WHERE id = p_pack_id;
  IF v_pack.id IS NULL THEN RAISE EXCEPTION 'decizie: pack inexistent'; END IF;
  IF NOT public.fn_ofertare_source_pack_poate_decide(v_pack.licitatie_id) THEN
    RAISE EXCEPTION 'decizie: doar ownerul, responsabilul licitației sau un admin Ofertare';
  END IF;
  IF p_decizie NOT IN ('IMPORT','DUPLICATE','REJECT','SUPERSEDED','DEFER') THEN RAISE EXCEPTION 'decizie: valoare necunoscută %', p_decizie; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_pack.pack->'cerinte','[]'::jsonb)) x WHERE x->>'ref' = p_ref) THEN
    RAISE EXCEPTION 'decizie: ref % nu există în pack %', p_ref, p_pack_id;
  END IF;
  IF p_cerinta_id IS NOT NULL THEN
    SELECT licitatie_id INTO v_lic FROM public.ofertare_cerinte WHERE id = p_cerinta_id;
    IF v_lic IS DISTINCT FROM v_pack.licitatie_id THEN RAISE EXCEPTION 'decizie: cerința % nu e din licitația pack-ului', p_cerinta_id; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_cerinte WHERE sursa_pack_id = p_pack_id AND sursa_ref = p_ref) AND p_decizie <> 'IMPORT' THEN
    RAISE EXCEPTION 'decizie: % e deja importată în registru — se tratează acolo (nu se poate re-decide aici)', p_ref;
  END IF;
  INSERT INTO public.ofertare_source_pack_decizii (pack_id, sursa_ref, decizie, actor, motiv, cerinta_existenta_id)
  VALUES (p_pack_id, p_ref, p_decizie, v_actor, NULLIF(btrim(p_motiv), ''), p_cerinta_id) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'pack_id', p_pack_id, 'ref', p_ref, 'decizie', p_decizie, 'actor', v_actor);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_source_pack_decide(bigint, text, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_source_pack_decide(bigint, text, text, text, bigint) TO authenticated, service_role;

-- Importul: DOAR ref-uri cu decizia curentă IMPORT; poarta de mai sus. Identic cu 20260923_p0c_review_decizii.sql altfel.
CREATE OR REPLACE FUNCTION public.fn_ofertare_source_pack_import(p_pack_id bigint, p_refs text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_pack public.ofertare_source_pack%ROWTYPE;
  v_nr_anunt text; v_ref text; v_c jsonb;
  v_doc bigint; v_map text; v_id bigint; v_dec text;
  v_inserate bigint[] := '{}'; v_sarite text[] := '{}'; v_nemapate text[] := '{}'; v_refuzate text[] := '{}'; v_fara_decizie text[] := '{}';
  v_importabile int; v_nemapate_total int; v_importate int; v_stare text; v_hist bigint;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'import: fără sesiune (auth.uid() NULL)'; END IF;
  SELECT * INTO v_pack FROM public.ofertare_source_pack WHERE id = p_pack_id FOR UPDATE;
  IF v_pack.id IS NULL THEN RAISE EXCEPTION 'import: pack inexistent'; END IF;
  IF v_pack.stare = 'respins' THEN RAISE EXCEPTION 'import: pack respins'; END IF;
  IF NOT public.fn_ofertare_source_pack_poate_decide(v_pack.licitatie_id) THEN
    RAISE EXCEPTION 'import: doar ownerul, responsabilul licitației sau un admin Ofertare';
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
    IF EXISTS (SELECT 1 FROM public.ofertare_cerinte WHERE sursa_pack_id = p_pack_id AND sursa_ref = v_ref) THEN v_sarite := v_sarite || v_ref; CONTINUE; END IF;
    SELECT decizie INTO v_dec FROM public.v_ofertare_source_pack_decizie_curenta WHERE pack_id = p_pack_id AND sursa_ref = v_ref;
    IF v_dec IS DISTINCT FROM 'IMPORT' THEN v_fara_decizie := v_fara_decizie || v_ref; CONTINUE; END IF;
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
      CASE WHEN (v_c#>>'{locator,verificat}') = 'interval' THEN NULL ELSE COALESCE((v_c#>>'{locator,pagina_validata}')::int, (v_c#>>'{locator,pagina}')::int) END,
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
  VALUES (p_pack_id, v_actor, p_refs, v_inserate, v_sarite, v_nemapate, v_refuzate || v_fara_decizie) RETURNING id INTO v_hist;
  SELECT count(*) FILTER (WHERE pv.importabil), count(*) FILTER (WHERE NOT pv.importabil) INTO v_importabile, v_nemapate_total FROM public.fn_ofertare_source_pack_preview(p_pack_id) pv;
  SELECT count(*) INTO v_importate FROM public.ofertare_cerinte WHERE sursa_pack_id = p_pack_id;
  v_stare := CASE WHEN v_nemapate_total = 0 AND v_importabile > 0 AND v_importate >= v_importabile THEN 'importat' ELSE 'importat_partial' END;
  IF array_length(v_inserate, 1) IS NOT NULL THEN
    UPDATE public.ofertare_source_pack SET stare = v_stare, ultim_import_la = now() WHERE id = p_pack_id;
  ELSE v_stare := v_pack.stare; END IF;
  RETURN jsonb_build_object('import_id', v_hist, 'stare', v_stare, 'actor', v_actor,
    'inserate', to_jsonb(v_inserate), 'sarite', to_jsonb(v_sarite), 'nemapate', to_jsonb(v_nemapate), 'refuzate', to_jsonb(v_refuzate),
    'fara_decizie', to_jsonb(v_fara_decizie), 'importabile', v_importabile, 'nemapate_total', v_nemapate_total, 'importate_total', v_importate);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_source_pack_import(bigint, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_source_pack_import(bigint, text[]) TO authenticated, service_role;
