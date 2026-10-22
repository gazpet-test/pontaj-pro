-- Raport numai citire. Nu schimbă tabele, politici sau date existente.
-- ai_usage_log: politica SELECT nu este definită în istoricul disponibil.
-- ai_plafon_rezervari: SELECT owner condiționat de egress_este_owner (20261105a).
-- Calea UI este exclusiv RPC-ul owner; view-urile invoker rămân private.
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261107a_ai_cost_raport:' || txid_current() THEN
    RAISE EXCEPTION '20261107a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261107a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.v_ai_cost_detaliu') IS NOT NULL
     OR to_regclass('public.v_ai_cost_lunar') IS NOT NULL
     OR to_regprocedure('public.fn_ai_cost_lunar(date,date)') IS NOT NULL THEN
    RAISE EXCEPTION '20261107a: obiectele exista deja';
  END IF;
END $pre$;

CREATE OR REPLACE VIEW public.v_ai_cost_detaliu WITH (security_invoker = on) AS
WITH legaturi AS (
  SELECT u.*,
    CASE u.ref_table
      WHEN 'ofertare_licitatii' THEN u.ref_id
      WHEN 'ofertare_documente_atribuire' THEN d.licitatie_id
      WHEN 'ofertare_pt_capitole' THEN pt.licitatie_id
      WHEN 'ofertare_clarificari' THEN cl.licitatie_id
      WHEN 'ofertare_formulare_registru' THEN fr.licitatie_id
      WHEN 'ofertare_ocr_rezervari' THEN rul.licitatie_id
    END AS licitatie_id,
    CASE u.ref_table
      WHEN 'executie_proiecte' THEN u.ref_id
      WHEN 'documente_proiect' THEN dp.proiect_id
      WHEN 'executie_situatii_plata' THEN sp.proiect_id
      WHEN 'comenzi_furnizor' THEN cf.proiect_id
    END AS proiect_id,
    inbox.modul_tinta
  FROM public.ai_usage_log u
  LEFT JOIN public.ofertare_documente_atribuire d ON u.ref_table = 'ofertare_documente_atribuire' AND d.id = u.ref_id
  LEFT JOIN public.ofertare_pt_capitole pt ON u.ref_table = 'ofertare_pt_capitole' AND pt.id = u.ref_id
  LEFT JOIN public.ofertare_clarificari cl ON u.ref_table = 'ofertare_clarificari' AND cl.id = u.ref_id
  LEFT JOIN public.ofertare_formulare_registru fr ON u.ref_table = 'ofertare_formulare_registru' AND fr.id = u.ref_id
  -- 20261029b: rezervare -> rulare -> licitație; nu se adună costul rulării încă o dată.
  LEFT JOIN public.ofertare_ocr_rezervari oz ON u.ref_table = 'ofertare_ocr_rezervari' AND oz.id = u.ref_id
  LEFT JOIN public.ofertare_ocr_rulari rul ON rul.id = oz.rulare_id
  LEFT JOIN public.documente_proiect dp ON u.ref_table = 'documente_proiect' AND dp.id = u.ref_id
  LEFT JOIN public.executie_situatii_plata sp ON u.ref_table = 'executie_situatii_plata' AND sp.id = u.ref_id
  LEFT JOIN public.comenzi_furnizor cf ON u.ref_table = 'comenzi_furnizor' AND cf.id = u.ref_id
  LEFT JOIN public.ai_documente_inbox inbox ON u.ref_table = 'ai_documente_inbox' AND inbox.id = u.ref_id
)
SELECT date_trunc('month', u.created_at AT TIME ZONE 'Europe/Bucharest')::date AS luna,
  CASE
    WHEN u.ref_table = 'ofertare_ocr_rezervari' AND u.licitatie_id IS NULL THEN 'Ofertare - OCR (fara licitatie)'
    WHEN u.ref_table IN ('ofertare_licitatii', 'ofertare_documente_atribuire', 'ofertare_pt_capitole',
      'ofertare_clarificari', 'ofertare_formulare_registru', 'ofertare_ocr_rezervari', 'ofertare_rfq_oferte') THEN 'Ofertare'
    WHEN u.ref_table IN ('hr_recomandari', 'hr_ci_extrase', 'hr_documente_personale') THEN 'HR'
    WHEN u.ref_table = 'ai_documente_inbox' THEN
      CASE lower(btrim(u.modul_tinta))
        WHEN 'hr' THEN 'HR' WHEN 'productie' THEN 'Productie' WHEN 'executie' THEN 'Executie'
        WHEN 'ofertare' THEN 'Ofertare' WHEN 'contracte' THEN 'Contracte'
        ELSE coalesce(nullif(initcap(replace(btrim(u.modul_tinta), '_', ' ')), ''), 'Altele') END
    WHEN u.ref_table = 'comenzi_furnizor' THEN 'Achizitii'
    WHEN u.ref_table IN ('executie_proiecte', 'documente_proiect', 'executie_situatii_plata') THEN 'Executie'
    WHEN u.ref_table = 'contracte_terti' THEN 'Contracte'
    ELSE 'Altele'
  END::text AS modul,
  u.function_name::text AS sursa, u.model::text AS model, coalesce(u.cost_usd, 0)::numeric AS cost_usd,
  CASE WHEN u.licitatie_id IS NOT NULL THEN 'licitatie' WHEN u.proiect_id IS NOT NULL THEN 'proiect' END::text AS tip_tinta,
  coalesce(u.licitatie_id, u.proiect_id)::bigint AS tinta_id,
  CASE WHEN u.licitatie_id IS NOT NULL THEN
    coalesce(nullif(concat_ws(' - ', nullif(l.nr_anunt, ''), nullif(l.obiect, '')), ''), 'Licitatia #' || u.licitatie_id)
  WHEN u.proiect_id IS NOT NULL THEN
    coalesce(nullif(concat_ws(' - ', nullif(p.cod_intern, ''), nullif(p.nume, '')), ''), 'Proiect #' || u.proiect_id)
  END::text AS tinta_nume,
  false AS in_curs, 0::numeric AS rezervat_in_curs_usd
FROM legaturi u
LEFT JOIN public.ofertare_licitatii l ON l.id = u.licitatie_id
LEFT JOIN public.executie_proiecte p ON p.id = u.proiect_id
UNION ALL
SELECT date_trunc('month', r.creat_la AT TIME ZONE 'Europe/Bucharest')::date,
  'Izometrie (citire avize)'::text, 'izo-e9'::text, NULL::text,
  CASE r.stare WHEN 'decontat' THEN r.cost_real WHEN 'pastrat' THEN r.suma_rezervata ELSE 0 END::numeric,
  'proiect'::text, substring(r.cheie FROM '^izo_e3_ocr:([0-9]+)$')::bigint,
  coalesce(nullif(concat_ws(' - ', nullif(p.cod_intern, ''), nullif(p.nume, '')), ''),
    'Proiect #' || substring(r.cheie FROM '^izo_e3_ocr:([0-9]+)$'))::text,
  r.stare = 'rezervat', CASE WHEN r.stare = 'rezervat' THEN r.suma_rezervata ELSE 0 END::numeric
FROM public.ai_plafon_rezervari r
LEFT JOIN public.executie_proiecte p ON p.id::text = substring(r.cheie FROM '^izo_e3_ocr:([0-9]+)$')
-- Luna registrului de plafon este UTC; raportarea folosește data apelului în București.
WHERE r.cheie ~ '^izo_e3_ocr:[0-9]+$';

CREATE OR REPLACE VIEW public.v_ai_cost_lunar WITH (security_invoker = on) AS
SELECT luna, modul, tip_tinta, tinta_id, tinta_nume, model,
  count(*) FILTER (WHERE NOT in_curs)::bigint AS apeluri,
  sum(cost_usd)::numeric AS cost_usd,
  sum(rezervat_in_curs_usd)::numeric AS rezervat_in_curs_usd
FROM public.v_ai_cost_detaliu
GROUP BY luna, modul, tip_tinta, tinta_id, tinta_nume, model;

REVOKE ALL ON public.v_ai_cost_detaliu, public.v_ai_cost_lunar FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_ai_cost_lunar(p_de date, p_pana date)
RETURNS TABLE (luna date, modul text, tip_tinta text, tinta_id bigint, tinta_nume text, model text,
  apeluri bigint, cost_usd numeric, rezervat_in_curs_usd numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE
  ) THEN
    RAISE EXCEPTION 'Raportul Cost AI este disponibil numai ownerului.' USING ERRCODE = '42501';
  END IF;
  -- Ambele capete sunt luni incluse. NULL nu trebuie să elimine filtrul.
  IF p_de IS NULL OR p_pana IS NULL OR NOT isfinite(p_de) OR NOT isfinite(p_pana)
     OR extract(day FROM p_de) <> 1 OR extract(day FROM p_pana) <> 1 OR p_de > p_pana THEN
    RAISE EXCEPTION 'Interval de luni invalid.' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT v.* FROM public.v_ai_cost_lunar v
    WHERE v.luna >= p_de AND v.luna <= p_pana
    ORDER BY v.luna, v.modul, v.tip_tinta NULLS FIRST, v.tinta_id NULLS FIRST, v.tinta_nume NULLS FIRST, v.model NULLS FIRST;
END $f$;
REVOKE EXECUTE ON FUNCTION public.fn_ai_cost_lunar(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ai_cost_lunar(date,date) TO authenticated;
