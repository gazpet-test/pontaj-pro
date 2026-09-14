-- Triere din Fișa de date (14.09.2026, cerut de Răzvan după facturile de API).
-- Etapa 0 ieftină: se citește DOAR fișa de date (~20 pag, un apel), se scoate fișa de triere
-- în formatul Excel-ului colegilor (cerință / ce cere / cine acoperă la Gazpet) + verdict.
-- Procesarea integrală (citire documente, registru, acoperire) rămâne după decizie și o pornește
-- doar ownerul sau responsabilul licitației — acolo pleacă banii.

CREATE TABLE IF NOT EXISTS public.ofertare_triere (
  id           bigserial PRIMARY KEY,
  licitatie_id bigint NOT NULL UNIQUE REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  doc_id       bigint REFERENCES public.ofertare_documente_atribuire(id) ON DELETE SET NULL,
  rezultat     jsonb NOT NULL DEFAULT '{}'::jsonb,
  verdict      text CHECK (verdict IN ('mergem','cu_clarificari','nu_se_poate','neclar')),
  model        text,
  cost_usd     numeric(10,4),
  created_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ofertare_triere ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertare_triere TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ofertare_triere_id_seq TO authenticated, service_role;
DROP POLICY IF EXISTS triere_sel ON public.ofertare_triere;
DROP POLICY IF EXISTS triere_mod ON public.ofertare_triere;
CREATE POLICY triere_sel ON public.ofertare_triere FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY triere_mod ON public.ofertare_triere FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Costul AI al unei licitații, ca să se vadă ÎNAINTE și DUPĂ, nu pe factură.
-- ai_usage_log leagă apelurile fie direct de licitație (ref_table ofertare_licitatii),
-- fie de document (ofertare_documente_atribuire) — se adună ambele.
CREATE OR REPLACE FUNCTION public.fn_ofertare_cost_ai(p_lic bigint)
RETURNS TABLE (apeluri bigint, cost_usd numeric, pe_functie jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH c AS (
    SELECT u.function_name, u.cost_usd
    FROM public.ai_usage_log u
    LEFT JOIN public.ofertare_documente_atribuire d
      ON u.ref_table = 'ofertare_documente_atribuire' AND d.id = u.ref_id
    WHERE (u.ref_table = 'ofertare_licitatii' AND u.ref_id = p_lic)
       OR (u.ref_table = 'ofertare_documente_atribuire' AND d.licitatie_id = p_lic)
       OR (u.ref_table = 'ofertare_clarificari' AND u.ref_id IN (SELECT id FROM public.ofertare_clarificari WHERE licitatie_id = p_lic))
  )
  SELECT count(*)::bigint, round(coalesce(sum(cost_usd),0)::numeric, 2),
         coalesce((SELECT jsonb_object_agg(function_name, round(s::numeric,2)) FROM (SELECT function_name, sum(cost_usd) s FROM c GROUP BY 1) x), '{}'::jsonb)
  FROM c;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_cost_ai(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_cost_ai(bigint) TO authenticated, service_role;
