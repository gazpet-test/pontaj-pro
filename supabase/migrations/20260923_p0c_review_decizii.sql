-- P0c review semantics (23.09.2026, GO Copilot prin Răzvan):
--   1. Decizia umană per (pack_id, sursa_ref) e un fapt SEPARAT de starea cerinței din registru:
--      IMPORT | DUPLICATE | REJECT | SUPERSEDED | DEFER — append-only, cu actor/timp/motiv/legătură la cerința existentă.
--      NU se mai folosește `nu_se_aplica` ca sinonim pentru „nu importăm".
--   2. Review completion ≠ import completion: v_ofertare_source_pack_revizie spune „decise X/N, importate Y" separat de stare.
--   3. Importul RPC acceptă DOAR ref-uri cu decizia curentă = IMPORT (similaritatea rămâne avertisment, nu verdict).

CREATE TABLE IF NOT EXISTS public.ofertare_source_pack_decizii (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pack_id bigint NOT NULL REFERENCES public.ofertare_source_pack(id) ON DELETE RESTRICT,
  sursa_ref text NOT NULL,
  decizie text NOT NULL CHECK (decizie IN ('IMPORT','DUPLICATE','REJECT','SUPERSEDED','DEFER')),
  actor uuid NOT NULL,
  motiv text,
  cerinta_existenta_id bigint REFERENCES public.ofertare_cerinte(id) ON DELETE SET NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofertare_source_pack_decizii_motiv_chk CHECK (decizie = 'IMPORT' OR (motiv IS NOT NULL AND length(btrim(motiv)) >= 3)),
  CONSTRAINT ofertare_source_pack_decizii_dup_chk CHECK (decizie <> 'DUPLICATE' OR cerinta_existenta_id IS NOT NULL)
);
COMMENT ON TABLE public.ofertare_source_pack_decizii IS 'Decizia UMANĂ pe fiecare candidat din Source Pack (pack_id, sursa_ref). Append-only: decizia curentă = ultimul rând. IMPORT ≠ importat (importul e pasul următor, în ofertare_source_pack_importuri). DUPLICATE cere cerința existentă; REJECT/SUPERSEDED/DEFER cer motiv. Nu se scrie nimic în ofertare_cerinte.stare.';
CREATE INDEX IF NOT EXISTS ofertare_source_pack_decizii_pack_ref_idx ON public.ofertare_source_pack_decizii (pack_id, sursa_ref, id DESC);
CREATE INDEX IF NOT EXISTS ofertare_source_pack_decizii_cerinta_idx ON public.ofertare_source_pack_decizii (cerinta_existenta_id);
CREATE INDEX IF NOT EXISTS ofertare_source_pack_decizii_actor_idx ON public.ofertare_source_pack_decizii (actor);

CREATE OR REPLACE FUNCTION public.fn_ofertare_source_pack_decizii_ro()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN RAISE EXCEPTION 'ofertare_source_pack_decizii: append-only (fără UPDATE/DELETE) — o decizie nouă se adaugă, nu se rescrie'; END $fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_source_pack_decizii_ro() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_ofertare_source_pack_decizii_ro ON public.ofertare_source_pack_decizii;
CREATE TRIGGER trg_ofertare_source_pack_decizii_ro BEFORE UPDATE OR DELETE ON public.ofertare_source_pack_decizii
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_source_pack_decizii_ro();

ALTER TABLE public.ofertare_source_pack_decizii ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_source_pack_decizii FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ofertare_source_pack_decizii TO authenticated, service_role;
DROP POLICY IF EXISTS ofertare_source_pack_decizii_select ON public.ofertare_source_pack_decizii;
CREATE POLICY ofertare_source_pack_decizii_select ON public.ofertare_source_pack_decizii
  FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
-- INSERT doar prin RPC-ul DEFINER de mai jos (fără policy de INSERT pentru authenticated)

-- ── decizia curentă per (pack, ref): ultimul rând
CREATE OR REPLACE VIEW public.v_ofertare_source_pack_decizie_curenta WITH (security_invoker = on) AS
SELECT DISTINCT ON (d.pack_id, d.sursa_ref) d.id, d.pack_id, d.sursa_ref, d.decizie, d.actor, d.motiv, d.cerinta_existenta_id, d.creat_la
FROM public.ofertare_source_pack_decizii d
ORDER BY d.pack_id, d.sursa_ref, d.id DESC;
REVOKE ALL ON public.v_ofertare_source_pack_decizie_curenta FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_ofertare_source_pack_decizie_curenta TO authenticated, service_role;

-- ── RPC: decizia umană (owner sau responsabilul licitației), append-only
CREATE OR REPLACE FUNCTION public.fn_ofertare_source_pack_decide(p_pack_id bigint, p_ref text, p_decizie text, p_motiv text DEFAULT NULL, p_cerinta_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_actor uuid := auth.uid(); v_pack public.ofertare_source_pack%ROWTYPE; v_id bigint; v_lic bigint;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'decizie: fără sesiune (auth.uid() NULL)'; END IF;
  SELECT * INTO v_pack FROM public.ofertare_source_pack WHERE id = p_pack_id;
  IF v_pack.id IS NULL THEN RAISE EXCEPTION 'decizie: pack inexistent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = v_actor AND pr.is_owner)
     AND NOT EXISTS (SELECT 1 FROM public.ofertare_licitatii l WHERE l.id = v_pack.licitatie_id AND l.responsabil_id = v_actor) THEN
    RAISE EXCEPTION 'decizie: doar ownerul sau responsabilul licitației';
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
GRANT EXECUTE ON FUNCTION public.fn_ofertare_source_pack_decide(bigint, text, text, text, bigint) TO authenticated;

-- ── preview: + decizia curentă (fără pierdere pe restul coloanelor)
DROP FUNCTION IF EXISTS public.fn_ofertare_source_pack_preview(bigint, real);
CREATE FUNCTION public.fn_ofertare_source_pack_preview(p_pack_id bigint, p_prag real DEFAULT 0.45)
RETURNS TABLE (
  ref text, text_grounded text, tip text, cand_se_prezinta text, document_probant text, lot text,
  nume_fisier text, document_id bigint, sursa_mapare text,
  pagina integer, pagina_declarata integer, pagina_interval_start integer, pagina_interval_end integer,
  sectiune text, excerpt_verificat text, locator_verificat text, incertitudine text,
  seamana_cu_id bigint, seamana_cu_similarity real, deja_importat boolean, importabil boolean,
  decizie text, decizie_motiv text, decizie_cerinta_id bigint, decizie_actor uuid, decizie_la timestamptz
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
         (m.document_id IS NOT NULL),
         dz.decizie, dz.motiv, dz.cerinta_existenta_id, dz.actor, dz.creat_la
  FROM m
  LEFT JOIN LATERAL (
    SELECT oc.id, extensions.similarity(oc.text_cerinta, m.j->>'text') AS sim
    FROM public.ofertare_cerinte oc
    WHERE oc.licitatie_id = v_pack.licitatie_id AND oc.inlocuita_de IS NULL AND oc.duplicat_al IS NULL
      AND extensions.similarity(oc.text_cerinta, m.j->>'text') >= p_prag
    ORDER BY sim DESC, oc.id LIMIT 1
  ) s ON true
  LEFT JOIN public.v_ofertare_source_pack_decizie_curenta dz ON dz.pack_id = p_pack_id AND dz.sursa_ref = m.ref
  ORDER BY m.ord;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_source_pack_preview(bigint, real) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_source_pack_preview(bigint, real) TO authenticated, service_role;

-- ── revizie per pack: review completion ≠ import completion
CREATE OR REPLACE VIEW public.v_ofertare_source_pack_revizie WITH (security_invoker = on) AS
SELECT sp.id AS pack_id, sp.licitatie_id, sp.stare, sp.nr_cerinte,
       count(dz.sursa_ref) AS decise,
       count(*) FILTER (WHERE dz.decizie = 'IMPORT')     AS decise_import,
       count(*) FILTER (WHERE dz.decizie = 'DUPLICATE')  AS decise_duplicate,
       count(*) FILTER (WHERE dz.decizie = 'REJECT')     AS decise_reject,
       count(*) FILTER (WHERE dz.decizie = 'SUPERSEDED') AS decise_superseded,
       count(*) FILTER (WHERE dz.decizie = 'DEFER')      AS decise_defer,
       (SELECT count(*) FROM public.ofertare_cerinte oc WHERE oc.sursa_pack_id = sp.id) AS importate,
       (sp.nr_cerinte IS NOT NULL AND sp.nr_cerinte > 0 AND count(dz.sursa_ref) >= sp.nr_cerinte) AS revizuit
FROM public.ofertare_source_pack sp
LEFT JOIN public.v_ofertare_source_pack_decizie_curenta dz ON dz.pack_id = sp.id
GROUP BY sp.id;
COMMENT ON VIEW public.v_ofertare_source_pack_revizie IS 'revizuit = toate cerințele din pack au o decizie umană curentă. NU înseamnă că au fost importate (importate e separat) și NU înseamnă registru complet (PACK_REVIEWED ≠ TENDER_COMPLETE).';
REVOKE ALL ON public.v_ofertare_source_pack_revizie FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_ofertare_source_pack_revizie TO authenticated, service_role;

-- ── import: doar ref-uri cu decizia curentă IMPORT; restul → fara_decizie
CREATE OR REPLACE FUNCTION public.fn_ofertare_source_pack_import(p_pack_id bigint, p_refs text[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_pack public.ofertare_source_pack%ROWTYPE;
  v_nr_anunt text;
  v_ref text;
  v_c jsonb;
  v_doc bigint; v_map text; v_id bigint; v_dec text;
  v_inserate bigint[] := '{}'; v_sarite text[] := '{}'; v_nemapate text[] := '{}'; v_refuzate text[] := '{}'; v_fara_decizie text[] := '{}';
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
    -- poarta umană: fără decizie curentă IMPORT nu intră nimic (similaritatea/pragurile nu decid)
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
  VALUES (p_pack_id, v_actor, p_refs, v_inserate, v_sarite, v_nemapate, v_refuzate || v_fara_decizie) RETURNING id INTO v_hist;
  SELECT count(*) FILTER (WHERE pv.importabil), count(*) FILTER (WHERE NOT pv.importabil)
    INTO v_importabile, v_nemapate_total FROM public.fn_ofertare_source_pack_preview(p_pack_id) pv;
  SELECT count(*) INTO v_importate FROM public.ofertare_cerinte WHERE sursa_pack_id = p_pack_id;
  v_stare := CASE WHEN v_nemapate_total = 0 AND v_importabile > 0 AND v_importate >= v_importabile
                  THEN 'importat' ELSE 'importat_partial' END;
  -- starea pack-ului se schimbă doar dacă a intrat ceva (un apel fără niciun IMPORT nu „importă parțial” nimic)
  IF array_length(v_inserate, 1) IS NOT NULL THEN
    UPDATE public.ofertare_source_pack SET stare = v_stare, ultim_import_la = now() WHERE id = p_pack_id;
  ELSE v_stare := v_pack.stare; END IF;
  RETURN jsonb_build_object('import_id', v_hist, 'stare', v_stare, 'actor', v_actor,
    'inserate', to_jsonb(v_inserate), 'sarite', to_jsonb(v_sarite), 'nemapate', to_jsonb(v_nemapate), 'refuzate', to_jsonb(v_refuzate),
    'fara_decizie', to_jsonb(v_fara_decizie),
    'importabile', v_importabile, 'nemapate_total', v_nemapate_total, 'importate_total', v_importate);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_source_pack_import(bigint, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_source_pack_import(bigint, text[]) TO authenticated;
