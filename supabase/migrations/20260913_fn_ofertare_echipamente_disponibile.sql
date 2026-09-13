-- Oglinda lui fn_ofertare_personal_disponibil, pentru "infrastructura care va fi utilizata".
--
-- SECURITY INVOKER, din acelasi motiv ca la personal: logistica_active si logistica_documente au
-- RLS cu politici; o functie DEFINER peste ele ar deschide datele de logistica oricui are acces
-- la Ofertare, ocolind exact politicile care le pazesc.
--
-- DECIZIA DE DESIGN care conteaza: NU intoarce doar "valabil". Masurat pe 288 de active din pool
-- (13.09.2026): 197 n-au NICIO scadenta in sistem. Un filtru strict ar lasa 75 si ar face firma
-- sa para ca n-are utilaje. Deci trei stari:
--   valabil     — are dovada si niciuna expirata la data ceruta        (75 la 01.10.2026)
--   expirat     — are dovada, dar a expirat                            (16 — ASTEA se depun gresit azi)
--   fara_dovezi — n-are nicio scadenta in BD                           (197 — lista de lucru a Logisticii)
-- UI-ul bifeaza implicit doar `valabil`.
--
-- tip_id-urile sunt CITITE din logistica_tipuri_documente, nu ghicite:
--   1 = ITP, 2 = RCA, 18 = Verificare echipament sudura (ISO 12176), 10 = Carte ID utilaj,
--   19 = Carte Tehnica, 23 = Talon.
-- ISCIR(5), ADR(7), VTP(15), PSI(16), AST(17), CASCO(3) au ZERO randuri azi — nu se pot genera.
--
-- Etalonarile metrologice NU sunt aici: singurul loc unde stau (logistica_amc, 13 randuri) n-are
-- active_id, deci nu se poate lega de utilaj. Pana apare legatura, un pachet "echipament +
-- etalonarea lui" nu se poate construi onest.
CREATE OR REPLACE FUNCTION public.fn_ofertare_echipamente_disponibile(p_la_data date DEFAULT current_date)
RETURNS TABLE (activ_id integer, cod_intern text, denumire text, categorie_tip text,
               categorie_sub text, identificator text, an_fabricatie integer, proprietate text,
               itp_expira date, verificare_expira date, rca_expira date,
               are_doc_tehnic boolean, zile_ramase integer, status text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $fn$
  WITH d AS (
    SELECT dd.active_id,
           max(dd.data_expirare) FILTER (WHERE dd.tip_id = 1)  AS itp,
           max(dd.data_expirare) FILTER (WHERE dd.tip_id = 18) AS verif,
           max(dd.data_expirare) FILTER (WHERE dd.tip_id = 2)  AS rca,
           bool_or(dd.tip_id IN (10, 19, 23))                  AS doc_tehnic
    FROM public.logistica_documente dd
    WHERE dd.active_id IS NOT NULL
    GROUP BY dd.active_id)
  SELECT a.id,
         a.cod_intern,
         nullif(btrim(coalesce(a.marca, '') || ' ' || coalesce(a.model, '')), ''),
         c.tip, c.subcategorie,
         coalesce(a.nr_inmatriculare, a.serie_sasiu, a.nr_inventar, a.cod_intern),
         a.an_fabricatie,
         coalesce(a.tip_proprietate, a.firma_proprietara),
         d.itp, d.verif, d.rca,
         coalesce(d.doc_tehnic, false),
         CASE WHEN d.itp IS NULL AND d.verif IS NULL THEN NULL
              ELSE (least(coalesce(d.itp, 'infinity'::date), coalesce(d.verif, 'infinity'::date)) - p_la_data)::integer END,
         CASE WHEN d.itp IS NULL AND d.verif IS NULL THEN 'fara_dovezi'
              WHEN coalesce(d.itp, p_la_data) >= p_la_data
               AND coalesce(d.verif, p_la_data) >= p_la_data THEN 'valabil'
              ELSE 'expirat' END
  FROM public.logistica_active a
  LEFT JOIN public.logistica_categorii c ON c.id = a.categorie_id
  LEFT JOIN d ON d.active_id = a.id
  WHERE a.stare = 'Functional' AND NOT a.vandut AND NOT a.deep_sleep
    AND (a.comodat_data_sfarsit IS NULL OR a.comodat_data_sfarsit >= p_la_data)
  ORDER BY c.tip, c.subcategorie, a.marca, a.model;
$fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_echipamente_disponibile(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_echipamente_disponibile(date) TO authenticated;
