-- Copilot (24.09.2026, blocul 4): „ignorat tehnic ≠ neaplicabil”. Un document din documentația de atribuire
-- care n-a putut fi citit (planșă prea mare, fișier nesuportat, eroare) și a rămas fără text NU dispare
-- din completitudine: poarta finală cere ca un om să bifeze că l-a consultat sau că nu e relevant.
-- Răzvan, 24.09: „da la bifă”.
-- Nu se numără: arhivele/semnăturile/DUAE (conținutul lor e extras sau e formular SEAP) și fișierele-lacăt Office.

ALTER TABLE public.ofertare_documente_atribuire
  ADD COLUMN IF NOT EXISTS relevanta_verificata_de uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS relevanta_verificata_la timestamptz,
  ADD COLUMN IF NOT EXISTS relevanta_nota text;
COMMENT ON COLUMN public.ofertare_documente_atribuire.relevanta_verificata_la IS
  'Bifa umană pentru un document necitit automat (ignorat/eroare, fără text): consultat manual sau nerelevant. Fără ea, poarta finală blochează.';

-- bifa se pune doar prin RPC: cine are acces Ofertare, cu motiv obligatoriu; se poate și retrage
CREATE OR REPLACE FUNCTION public.fn_ofertare_doc_bifa_relevanta(p_doc_id bigint, p_nota text, p_retrage boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_are_acces_ofertare() THEN
    RETURN jsonb_build_object('error', 'fără acces Ofertare');
  END IF;
  IF NOT p_retrage AND length(coalesce(trim(p_nota), '')) < 5 THEN
    RETURN jsonb_build_object('error', 'scrie motivul (min. 5 caractere): ce ai verificat / de ce nu e relevant');
  END IF;
  UPDATE public.ofertare_documente_atribuire
     SET relevanta_verificata_de = CASE WHEN p_retrage THEN NULL ELSE auth.uid() END,
         relevanta_verificata_la = CASE WHEN p_retrage THEN NULL ELSE now() END,
         relevanta_nota          = CASE WHEN p_retrage THEN NULL ELSE trim(p_nota) END
   WHERE id = p_doc_id
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('error', 'document inexistent'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_ofertare_doc_bifa_relevanta(bigint, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_doc_bifa_relevanta(bigint, text, boolean) TO authenticated;

-- aceeași definiție ca în 20260924_seap_p0_pas2_manifest_completitudine.sql + CTE „ign” + coloane noi la final
CREATE OR REPLACE VIEW public.v_ofertare_seap_completitudine WITH (security_invoker = on) AS
WITH ess AS (
  SELECT d.licitatie_id,
         count(*) FILTER (WHERE d.tip IN ('fisa_date', 'cs_volum', 'lista_cantitati')) AS esentiale,
         count(*) FILTER (WHERE d.tip = 'cs_volum') AS caiete,
         count(*) FILTER (WHERE d.tip IN ('fisa_date', 'cs_volum', 'lista_cantitati') AND d.status_procesare <> 'procesat') AS esentiale_necitite,
         count(*) FILTER (WHERE d.status_procesare = 'neprocesat') AS necitite_total
  FROM public.ofertare_documente_atribuire d GROUP BY d.licitatie_id
), sf AS (
  SELECT f.licitatie_id,
         count(*) FILTER (WHERE f.stare = 'eroare') AS seap_erori,
         count(*) FILTER (WHERE f.stare = 'identificat') AS seap_in_curs,
         string_agg(f.nume_seap || ' [' || coalesce(f.etapa, '?') || ']', '; ' ORDER BY f.nume_seap) FILTER (WHERE f.stare = 'eroare') AS seap_erori_lista
  FROM public.ofertare_seap_fisiere f GROUP BY f.licitatie_id
), ign AS (
  SELECT d.licitatie_id,
         count(*) AS ignorate_neverificate,
         string_agg(regexp_replace(d.nume_original, '^.*/', ''), '; ' ORDER BY d.id) AS ignorate_lista
  FROM public.ofertare_documente_atribuire d
  WHERE d.status_procesare IN ('ignorat', 'eroare')
    AND d.text_extras IS NULL
    AND d.relevanta_verificata_la IS NULL
    AND d.nume_original !~* '\.(rar|zip|7z|p7s|p7m|xml|log)(\s*\d*)$'
    AND d.nume_original !~ '(^|/)~\$'
    AND NOT public.ofertare_doc_are_bucati(d.licitatie_id, d.id, d.nume_original)   -- originalele sparte în bucăți
  GROUP BY d.licitatie_id
)
SELECT l.id AS licitatie_id,
       (l.c_notice_id IS NOT NULL) AS din_seap,
       CASE WHEN l.c_notice_id IS NULL THEN 'n/a'
            WHEN c.licitatie_id IS NULL OR c.terminat_la IS NULL THEN 'nerulata'
            WHEN c.raport ? 'eroare' THEN 'eroare'
            ELSE 'ok' END AS enumerare,
       c.terminat_la AS enumerare_la,
       (c.raport->>'seap')::int AS seap_total,
       coalesce(sf.seap_erori, 0) AS seap_erori,
       coalesce(sf.seap_in_curs, 0) AS seap_in_curs,
       sf.seap_erori_lista,
       coalesce(e.esentiale, 0) AS esentiale,
       coalesce(e.caiete, 0) AS caiete,
       coalesce(e.esentiale_necitite, 0) AS esentiale_necitite,
       coalesce(e.necitite_total, 0) AS necitite_total,
       CASE
         WHEN l.c_notice_id IS NOT NULL AND (c.licitatie_id IS NULL OR c.terminat_la IS NULL)
           THEN 'nu putem verifica completitudinea: documentația din SEAP nu a fost încă enumerată'
         WHEN l.c_notice_id IS NOT NULL AND c.raport ? 'eroare'
           THEN 'nu putem verifica completitudinea: enumerarea SEAP a eșuat (' || left(c.raport->>'eroare', 120) || ')'
         WHEN coalesce(sf.seap_erori, 0) > 0
           THEN sf.seap_erori || ' fișier(e) din SEAP nerecuperate: ' || left(sf.seap_erori_lista, 300)
         WHEN coalesce(sf.seap_in_curs, 0) > 0
           THEN sf.seap_in_curs || ' fișier(e) din SEAP încă în curs de aducere'
         WHEN coalesce(e.caiete, 0) = 0
           THEN 'niciun caiet de sarcini / volum de proiect identificat în documentație'
         WHEN coalesce(e.esentiale_necitite, 0) > 0
           THEN e.esentiale_necitite || ' document(e) esențiale (fișa de date, caiete/PT, liste de cantități) necitite sau citite parțial'
         WHEN coalesce(g.ignorate_neverificate, 0) > 0
           THEN g.ignorate_neverificate || ' document(e) necitite automat, fără bifa unui om (consultat / nerelevant): ' || left(g.ignorate_lista, 300)
       END AS blocaj,
       coalesce(g.ignorate_neverificate, 0) AS ignorate_neverificate,
       g.ignorate_lista
FROM public.ofertare_licitatii l
LEFT JOIN public.ofertare_seap_cereri c ON c.licitatie_id = l.id
LEFT JOIN sf ON sf.licitatie_id = l.id
LEFT JOIN ess e ON e.licitatie_id = l.id
LEFT JOIN ign g ON g.licitatie_id = l.id;
REVOKE ALL ON public.v_ofertare_seap_completitudine FROM PUBLIC, anon;
GRANT SELECT ON public.v_ofertare_seap_completitudine TO authenticated, service_role;
