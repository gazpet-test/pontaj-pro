-- Fixture LOCAL (NU se aplică pe producție) pentru scripts/test_sec_garantii_iban.sh — doar în baze *_test.
-- Se încarcă DUPĂ scheletul lui 20261005b (supabase/tests/rls_garantii_schelet.sql, #561) și ÎNAINTEA migrării 20261005b:
-- înlocuiește garantii-ul minim cu tabela LIVE completă (33 coloane, md5 0cd06900…), ACL-ul live, view-ul live
-- v_garantii_situatie (md5 e0457893…) și RPC-ul live garantii_adresa_eliberare (md5 3645ed09…), citite read-only 01.10.2026.
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DROP TABLE public.garantii;
CREATE TABLE public.garantii (id bigserial PRIMARY KEY, forma text, tip text, beneficiar text, contract_numar text, contract_data date, lucrare text, proiect_id bigint, licitatie_id bigint, valoare numeric(14,2), moneda text, procent numeric(5,2), trezorerie_cont_id bigint, iban text, banca text, emitent text, numar_document text, data_emitere date, data_expirare date, stare text, lucrare_receptionata boolean, data_receptie date, document_receptie text, data_eliberare date, eliberare_solicitata_la date, sursa_document text, observatii text, created_at timestamp with time zone, updated_at timestamp with time zone, contract_terti_id bigint, gbe_polita_id bigint, blocat_litigiu boolean, litigiu_detalii text);
ALTER TABLE public.garantii ALTER COLUMN id TYPE bigint;
ALTER TABLE public.garantii ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.garantii FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN ON public.garantii TO anon, authenticated;
GRANT ALL ON public.garantii TO service_role;
CREATE POLICY garantii_rw ON public.garantii FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
INSERT INTO public.garantii (tip, forma, beneficiar, iban, stare, lucrare_receptionata, valoare, moneda) VALUES
 ('buna_executie','depozit_bancar','B1','RO49AAAA1B31007593840000','activa',true,1000,'RON');
CREATE VIEW public.v_garantii_situatie WITH (security_invoker = on) AS
 SELECT id,
    forma,
    tip,
    beneficiar,
    contract_numar,
    contract_data,
    lucrare,
    proiect_id,
    licitatie_id,
    valoare,
    moneda,
    procent,
    trezorerie_cont_id,
    iban,
    banca,
    emitent,
    numar_document,
    data_emitere,
    data_expirare,
    stare,
    lucrare_receptionata,
    data_receptie,
    document_receptie,
    data_eliberare,
    eliberare_solicitata_la,
    sursa_document,
    observatii,
    created_at,
    updated_at,
    (data_expirare - CURRENT_DATE) AS zile_pana_expirare,
        CASE
            WHEN (stare <> 'activa'::text) THEN NULL::text
            WHEN (lucrare_receptionata AND (eliberare_solicitata_la IS NULL)) THEN 'Lucrare receptionata - se poate cere eliberarea'::text
            WHEN ((data_expirare IS NOT NULL) AND (data_expirare < CURRENT_DATE) AND (NOT lucrare_receptionata)) THEN 'EXPIRATA dar lucrarea nu e receptionata - risc de garantie neacoperita'::text
            WHEN ((data_expirare IS NOT NULL) AND ((data_expirare - CURRENT_DATE) <= 30)) THEN 'Expira in sub 30 de zile'::text
            WHEN ((data_expirare IS NOT NULL) AND ((data_expirare - CURRENT_DATE) <= 60)) THEN 'Expira in sub 60 de zile'::text
            WHEN (eliberare_solicitata_la IS NOT NULL) THEN ('Eliberare ceruta la '::text || eliberare_solicitata_la)
            ELSE NULL::text
        END AS de_facut
   FROM garantii g;

CREATE OR REPLACE FUNCTION public.garantii_adresa_eliberare(p_id bigint)
 RETURNS TABLE(destinatar text, subiect text, corp text, avertisment text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    coalesce(g.emitent, g.banca, 'Trezoreria Municipiului Ploiesti'),
    'Solicitare eliberare garantie de buna executie – contract nr. ' ||
      coalesce(g.contract_numar, '___') || ' – ' || coalesce(g.lucrare, g.beneficiar),
    CASE WHEN g.blocat_litigiu THEN
      '⛔ Garantia e blocata de un litigiu in curs cu ' || g.beneficiar || '.' || E'\n\n' ||
      coalesce(g.litigiu_detalii || E'\n\n', '') ||
      'Nu se genereaza adresa de eliberare cat timp litigiul e deschis. ' ||
      'Daca litigiul s-a incheiat, scoate bifa de litigiu din fisa garantiei si genereaza adresa din nou.'
    ELSE
      'Catre, ' || coalesce(g.emitent, g.banca, 'Trezoreria Municipiului Ploiesti') || E'\n\n' ||
      'Subscrisa GAZPET INSTAL SRL, CUI RO22029920, cu sediul in Ploiesti, str. Fluturilor nr. 34, ' ||
      'jud. Prahova, reprezentata prin Trusu Razvan Mihail in calitate de administrator,' || E'\n\n' ||
      'Referitor la ' ||
        CASE g.forma
          WHEN 'polita_asigurare' THEN 'polita de asigurare pentru garantia de buna executie nr. ' || coalesce(g.numar_document,'___')
          WHEN 'scrisoare_bancara' THEN 'scrisoarea de garantie bancara nr. ' || coalesce(g.numar_document,'___')
          WHEN 'depozit_bancar' THEN 'depozitul pentru garantii de buna executie, cont ' || coalesce(g.iban,'___')
          ELSE 'contul de disponibil din sume reprezentand garantie de buna executie ' || coalesce(g.iban,'___')
        END ||
        coalesce(', constituit(a) la data de ' || to_char(g.data_emitere, 'DD.MM.YYYY'), '') ||
        coalesce(' cu scadenta ' || to_char(g.data_expirare, 'DD.MM.YYYY'), '') ||
        ', in favoarea ' || g.beneficiar ||
        ', pentru contractul nr. ' || coalesce(g.contract_numar,'___') ||
        coalesce('/' || to_char(g.contract_data, 'DD.MM.YYYY'), '') ||
        coalesce(' – „' || g.lucrare || '”', '') || ',' || E'\n\n' ||
      'va aducem la cunostinta ca lucrarile au fost receptionate' ||
        coalesce(' prin ' || g.document_receptie, '') ||
        coalesce(' din data de ' || to_char(g.data_receptie, 'DD.MM.YYYY'), '') ||
        ', iar obligatiile contractuale au fost indeplinite integral.' || E'\n\n' ||
      'Prin prezenta va solicitam eliberarea garantiei' ||
        coalesce(' in valoare de ' ||
          translate(trim(to_char(g.valoare, 'FM999,999,999.00')), ',.', '.,') || ' ' || g.moneda, '') ||
        ' si diminuarea corespunzatoare a expunerii inregistrate pe numele societatii noastre.' || E'\n\n' ||
      'Anexam documentele justificative.' || E'\n\n' ||
      'Cu stima,' || E'\n' ||
      'GAZPET INSTAL SRL' || E'\n' ||
      'Trusu Razvan Mihail, Administrator'
    END,
    CASE
      WHEN g.blocat_litigiu
        THEN 'BLOCAT DE LITIGIU — nu trimite nimic pana nu se lamureste.'
      WHEN NOT g.lucrare_receptionata AND g.data_receptie IS NOT NULL
        THEN 'Receptia e documentata (' || coalesce(g.document_receptie,'PV gasit') ||
             ') dar nu e inca bifata in fisa. Bifeaza „Receptie" inainte de a trimite.'
      WHEN NOT g.lucrare_receptionata
        THEN 'ATENTIE: lucrarea NU e marcata ca receptionata si nu avem niciun PV. Expirarea nu inseamna eliberare - cererea va fi respinsa.'
      WHEN g.document_receptie IS NULL
        THEN 'Lucrarea e marcata receptionata dar nu e trecut documentul de receptie (PVR/PVRTL). Completeaza-l inainte de a trimite.'
      WHEN g.document_receptie ILIKE '%PVRTL%' OR g.document_receptie ILIKE '%terminarea lucrarilor%'
        THEN 'Receptia e la TERMINAREA lucrarilor, nu finala - de regula se elibereaza doar 70%. Verifica ce procent ceri.'
      WHEN g.stare <> 'activa'
        THEN 'Garantia nu mai e activa (stare: ' || g.stare || '). Verifica daca adresa mai are rost.'
      ELSE NULL
    END
  FROM public.garantii g WHERE g.id = p_id;
$function$;
REVOKE ALL ON FUNCTION public.garantii_adresa_eliberare(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.garantii_adresa_eliberare(bigint) TO authenticated, service_role;
