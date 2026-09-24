-- Z1b (24.09.2026, observația Copilot): mutarea omului moștenită pe versiunea NOUĂ a cerinței
-- (clarificare → inlocuita_de) nu e o alegere umană făcută pe noul text. Se păstrează pentru
-- navigare, dar se marchează „moștenită — de reverificat" până o confirmă/mută cineva pe textul nou.
ALTER TABLE public.ofertare_cerinte_subiect ADD COLUMN IF NOT EXISTS mostenit_de_la bigint;
COMMENT ON COLUMN public.ofertare_cerinte_subiect.mostenit_de_la IS
  'cerința veche (inlocuita_de → aceasta) de pe care s-a moștenit mutarea omului; NULL = decizie pe textul curent';

DROP FUNCTION IF EXISTS public._fn_ofertare_subiecte_calc(bigint, int);
CREATE FUNCTION public._fn_ofertare_subiecte_calc(p_licitatie_id bigint, p_versiune int)
RETURNS TABLE (cerinta_id bigint, nr_ordine int, actiune text, vechi text, subiect text,
               sursa text, alternative text[], setat_de uuid, mostenit_de_la bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  SELECT c.id, c.nr_ordine,
    CASE WHEN e.sursa = 'om' THEN 'pastrat_om'
         WHEN e.cerinta_id IS NULL AND p.subiect IS NOT NULL THEN 'mostenit'
         WHEN e.cerinta_id IS NULL THEN 'nou'
         WHEN e.subiect = k.subiect AND e.alternative = k.alternative AND e.versiune = p_versiune THEN 'neschimbat'
         ELSE 'schimbat' END,
    e.subiect,
    CASE WHEN e.sursa = 'om' THEN e.subiect WHEN e.cerinta_id IS NULL AND p.subiect IS NOT NULL THEN p.subiect ELSE k.subiect END,
    CASE WHEN e.sursa = 'om' OR (e.cerinta_id IS NULL AND p.subiect IS NOT NULL) THEN 'om' ELSE 'auto' END,
    CASE WHEN e.sursa = 'om' THEN e.alternative WHEN e.cerinta_id IS NULL AND p.subiect IS NOT NULL THEN '{}'::text[] ELSE k.alternative END,
    CASE WHEN e.sursa = 'om' THEN e.setat_de WHEN e.cerinta_id IS NULL AND p.subiect IS NOT NULL THEN p.setat_de END,
    CASE WHEN e.sursa = 'om' THEN e.mostenit_de_la WHEN e.cerinta_id IS NULL AND p.subiect IS NOT NULL THEN p.id END
  FROM public.ofertare_cerinte c
  LEFT JOIN public.ofertare_cerinte_subiect e ON e.cerinta_id = c.id
  CROSS JOIN LATERAL public.fn_ofertare_subiect_clasifica(c.text_cerinta, c.sursa_sectiune, p_versiune) k
  LEFT JOIN LATERAL (SELECT o.id, s.subiect, s.setat_de FROM public.ofertare_cerinte o
                     JOIN public.ofertare_cerinte_subiect s ON s.cerinta_id = o.id AND s.sursa = 'om'
                     WHERE o.inlocuita_de = c.id ORDER BY o.id DESC LIMIT 1) p ON true
  WHERE c.licitatie_id = p_licitatie_id AND c.inlocuita_de IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public._fn_ofertare_subiecte_calc(bigint, int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_ofertare_subiecte_aplica(p_licitatie_id bigint, p_aplica boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_ver int;
  v_rez jsonb;
  v_scrise int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_are_acces_ofertare() THEN
    RAISE EXCEPTION 'Fără acces la modulul Ofertare' USING ERRCODE = '42501';
  END IF;
  SELECT max(versiune) INTO v_ver FROM public.ofertare_subiecte_regula;
  IF v_ver IS NULL THEN RAISE EXCEPTION 'Nu există reguli de subiect'; END IF;

  WITH x AS (SELECT * FROM public._fn_ofertare_subiecte_calc(p_licitatie_id, v_ver))
  SELECT jsonb_build_object(
    'licitatie_id', p_licitatie_id, 'versiune', v_ver, 'aplicat', p_aplica,
    'total', (SELECT count(*) FROM x),
    'actiuni', coalesce((SELECT jsonb_object_agg(a, n) FROM (SELECT actiune a, count(*) n FROM x GROUP BY 1) q), '{}'::jsonb),
    'neclasificate', (SELECT count(*) FROM x WHERE subiect = 'neclasificat'),
    'de_verificat', (SELECT count(*) FROM x WHERE (sursa = 'auto' AND cardinality(alternative) > 0) OR mostenit_de_la IS NOT NULL),
    'pe_subiect', coalesce((SELECT jsonb_object_agg(s, n) FROM (SELECT subiect s, count(*) n FROM x GROUP BY 1) q), '{}'::jsonb),
    'schimbari', coalesce((SELECT jsonb_agg(jsonb_build_object('cerinta_id', q.cerinta_id, 'nr_ordine', q.nr_ordine, 'din', q.vechi, 'in', q.subiect) ORDER BY q.nr_ordine)
                           FROM (SELECT * FROM x WHERE actiune = 'schimbat' ORDER BY nr_ordine LIMIT 100) q), '[]'::jsonb))
  INTO v_rez;

  IF p_aplica THEN
    INSERT INTO public.ofertare_cerinte_subiect AS t (cerinta_id, licitatie_id, subiect, sursa, versiune, alternative, setat_de, setat_la, mostenit_de_la)
    SELECT x.cerinta_id, p_licitatie_id, x.subiect, x.sursa,
           CASE WHEN x.sursa = 'auto' THEN v_ver END, x.alternative,
           CASE WHEN x.sursa = 'auto' THEN auth.uid() ELSE x.setat_de END, now(), x.mostenit_de_la
    FROM public._fn_ofertare_subiecte_calc(p_licitatie_id, v_ver) x
    WHERE x.actiune IN ('nou', 'schimbat', 'mostenit')
    ON CONFLICT (cerinta_id) DO UPDATE
      SET subiect = EXCLUDED.subiect, sursa = EXCLUDED.sursa, versiune = EXCLUDED.versiune,
          alternative = EXCLUDED.alternative, setat_de = EXCLUDED.setat_de, setat_la = now(),
          mostenit_de_la = EXCLUDED.mostenit_de_la
      WHERE t.sursa = 'auto';                        -- plasă: mutarea omului nu se suprascrie
    GET DIAGNOSTICS v_scrise = ROW_COUNT;
  END IF;
  RETURN v_rez || jsonb_build_object('scrise', v_scrise);
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_subiecte_aplica(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_subiecte_aplica(bigint, boolean) TO authenticated, service_role;

-- Mutarea făcută acum de om e decizie pe textul CURENT → șterge marcajul de moștenire.
-- ── RPC: omul mută o cerință în alt subiect (sau o dă înapoi regulii cu p_subiect = NULL) ──
CREATE OR REPLACE FUNCTION public.fn_ofertare_subiect_muta(p_cerinta_id bigint, p_subiect text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_ver int;
  c record;
  k record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_are_acces_ofertare() THEN
    RAISE EXCEPTION 'Fără acces la modulul Ofertare' USING ERRCODE = '42501';
  END IF;
  SELECT id, licitatie_id, text_cerinta, sursa_sectiune, inlocuita_de INTO c
  FROM public.ofertare_cerinte WHERE id = p_cerinta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cerința % nu există', p_cerinta_id; END IF;
  IF c.inlocuita_de IS NOT NULL THEN
    RAISE EXCEPTION 'Cerința % a fost înlocuită de #% — mută versiunea curentă', p_cerinta_id, c.inlocuita_de;
  END IF;
  SELECT max(versiune) INTO v_ver FROM public.ofertare_subiecte_regula;

  IF p_subiect IS NULL THEN            -- înapoi la regulă
    SELECT * INTO k FROM public.fn_ofertare_subiect_clasifica(c.text_cerinta, c.sursa_sectiune, v_ver);
    INSERT INTO public.ofertare_cerinte_subiect (cerinta_id, licitatie_id, subiect, sursa, versiune, alternative, setat_de, setat_la)
    VALUES (c.id, c.licitatie_id, k.subiect, 'auto', v_ver, k.alternative, auth.uid(), now())
    ON CONFLICT (cerinta_id) DO UPDATE SET subiect = EXCLUDED.subiect, sursa = 'auto', versiune = EXCLUDED.versiune,
      alternative = EXCLUDED.alternative, setat_de = EXCLUDED.setat_de, setat_la = now(), mostenit_de_la = NULL;
    RETURN jsonb_build_object('cerinta_id', c.id, 'subiect', k.subiect, 'sursa', 'auto');
  END IF;

  IF p_subiect <> 'neclasificat' AND NOT EXISTS (
       SELECT 1 FROM public.ofertare_subiecte_regula WHERE versiune = v_ver AND cheie = p_subiect) THEN
    RAISE EXCEPTION 'Subiect necunoscut: %', p_subiect;
  END IF;
  INSERT INTO public.ofertare_cerinte_subiect (cerinta_id, licitatie_id, subiect, sursa, versiune, alternative, setat_de, setat_la)
  VALUES (c.id, c.licitatie_id, p_subiect, 'om', NULL, '{}', auth.uid(), now())
  ON CONFLICT (cerinta_id) DO UPDATE SET subiect = EXCLUDED.subiect, sursa = 'om', versiune = NULL,
    alternative = '{}', setat_de = EXCLUDED.setat_de, setat_la = now(), mostenit_de_la = NULL;
  RETURN jsonb_build_object('cerinta_id', c.id, 'subiect', p_subiect, 'sursa', 'om');
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_subiect_muta(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_subiect_muta(bigint, text) TO authenticated, service_role;
