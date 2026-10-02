-- Fixture LOCAL (NU se aplică pe producție) pentru scripts/test_sec_gbe_iban.sh — doar în baze *_test.
-- Se încarcă DUPĂ scheletul lui 20261005b (supabase/tests/rls_garantii_schelet.sql, #561) și ÎNAINTEA migrării 20261005b:
-- înlocuiește contracte_terti-ul minim cu tabela LIVE completă (55 coloane, md5 e10866a7…), ACL-ul live, cele 5 politici live
-- de dinainte de 20261005b (identice cu scheletul, ca precondiția 62f69c59… a lui 20261005b să treacă), tabelele din CTE-urile
-- view-ului și view-ul live v_gbe_per_contract (md5 b9861ba0…, coloane cae5aa7b…), citite read-only 02.10.2026.
-- Se verifică singur la final: amprentele trebuie să fie EXACT cele live, altfel testul ar dovedi altceva decât producția.
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DROP TABLE public.contracte_terti;
CREATE TABLE public.contracte_terti (
  id bigserial PRIMARY KEY, beneficiar_id bigint, numar_contract text, denumire text NOT NULL, valoare_lei numeric(15,2), valoare_eur numeric(15,2),
  data_semnare date, termen_executie_zile integer, data_termen date, pdf_path text, status text NOT NULL DEFAULT 'activ',
  ai_extracted_at timestamp with time zone, ai_clauze_jsonb jsonb, observatii text, created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(), created_by uuid, categorie text, sens text, partener_text text,
  valoare_actuala_lei numeric(15,2), tip_contract text, rol_gazpet text, contract_parinte_id bigint, site_id bigint, termen_plata_zile integer,
  garantie_buna_executie_pct numeric(5,2), santiere_ids bigint[], contact_factura_nume text, contact_factura_email text, contact_factura_telefon text,
  contact_mng_nume text, contact_mng_email text, contact_mng_telefon text, contact_resp_exec_nume text, contact_resp_exec_email text,
  contact_resp_exec_telefon text, garantie_perioada_luni integer, gbe_data_estimata_recuperare date, gbe_observatii text, gbe_tip text,
  gbe_pct_deblocare_receptie numeric, gbe_pct_deblocare_final numeric, gbe_retinut_manual numeric, gbe_data_receptie_terminare date,
  gbe_data_receptie_finala date, gbe_cont_iban text, gbe_cont_valabil_pana date, tarif_valoare numeric, tarif_unitate text, tarif_moneda text,
  tarif_descriere text, arhivat_la timestamp with time zone, arhivat_de uuid, motiv_arhivare text);
ALTER TABLE public.contracte_terti ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contracte_terti FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.contracte_terti TO anon, authenticated;
GRANT ALL ON public.contracte_terti TO service_role;
-- politicile live de dinainte de 20261005b (identice cu scheletul; 20261005b scoate contracte_terti_write și adaugă contracte_terti_update_garantii)
CREATE POLICY contracte_terti_delete ON public.contracte_terti FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_owner));
CREATE POLICY contracte_terti_insert ON public.contracte_terti FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND (profiles.is_owner OR profiles.can_manage_contracts)));
CREATE POLICY contracte_terti_select ON public.contracte_terti FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY contracte_terti_update ON public.contracte_terti FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND (profiles.is_owner OR profiles.can_manage_contracts)));
CREATE POLICY contracte_terti_write ON public.contracte_terti FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
-- tabelele din CTE-urile view-ului (doar coloanele folosite)
CREATE TABLE public.beneficiari (id bigserial PRIMARY KEY, nume text);
CREATE TABLE public.executie_proiecte (id bigserial PRIMARY KEY, contract_id bigint);
CREATE TABLE public.executie_situatii_plata (id bigserial PRIMARY KEY, proiect_id bigint);
CREATE TABLE public.executie_situatii_plata_linii (id bigserial PRIMARY KEY, sl_id bigint, tip text, denumire text, valoare numeric);
-- date: C1 cu IBAN (text liber „IBAN, bancă”, ca pe live) și reținere manuală (apare în view); C2 fără IBAN, în view; C3 cu IBAN, în afara view-ului
INSERT INTO public.beneficiari (nume) VALUES ('Beneficiar 1');
INSERT INTO public.contracte_terti (beneficiar_id, numar_contract, denumire, status, gbe_tip, gbe_retinut_manual, gbe_cont_iban, gbe_cont_valabil_pana) VALUES
 (1, 'C1/2026', 'Contract 1', 'activ', 'retinere', 1000, 'RO49AAAA1B31007593840000 Banca Transilvania', current_date + 200),
 (1, 'C2/2026', 'Contract 2', 'activ', 'retinere', 500, NULL, NULL),
 (1, 'C3/2026', 'Contract 3', 'activ', 'polita', NULL, 'RO15RNCB0000000000000003', NULL);
CREATE VIEW public.v_gbe_per_contract WITH (security_invoker = on) AS
 WITH retineri AS (
         SELECT p.contract_id,
            sum(abs(l.valoare)) AS gbe_retinut
           FROM ((executie_situatii_plata_linii l
             JOIN executie_situatii_plata s ON ((s.id = l.sl_id)))
             JOIN executie_proiecte p ON ((p.id = s.proiect_id)))
          WHERE ((l.tip = 'retinere'::text) AND ((l.denumire ~~* '%GBE%'::text) OR (l.denumire ~~* '%garan%'::text) OR (l.denumire ~~* '%bun% execu%'::text)) AND (p.contract_id IS NOT NULL))
          GROUP BY p.contract_id
        ), restituiri AS (
         SELECT gbe_restituiri.contract_id,
            sum(gbe_restituiri.valoare_lei) AS gbe_restituit
           FROM gbe_restituiri
          GROUP BY gbe_restituiri.contract_id
        )
 SELECT c.id AS contract_id,
    c.numar_contract,
    c.denumire,
    b.nume AS beneficiar,
    c.garantie_buna_executie_pct,
    c.garantie_perioada_luni,
    c.gbe_data_estimata_recuperare,
    c.gbe_observatii,
    COALESCE(r.gbe_retinut, c.gbe_retinut_manual, (0)::numeric) AS gbe_retinut,
    COALESCE(rs.gbe_restituit, (0)::numeric) AS gbe_restituit,
    (COALESCE(r.gbe_retinut, c.gbe_retinut_manual, (0)::numeric) - COALESCE(rs.gbe_restituit, (0)::numeric)) AS gbe_ramas,
    c.gbe_tip,
    c.gbe_pct_deblocare_receptie,
    c.gbe_pct_deblocare_final,
    c.gbe_data_receptie_terminare,
    c.gbe_data_receptie_finala,
    c.gbe_cont_iban,
    c.gbe_cont_valabil_pana,
    c.valoare_lei,
    c.valoare_actuala_lei,
    c.data_semnare,
    c.status,
    ((r.gbe_retinut IS NULL) AND (c.gbe_retinut_manual IS NOT NULL)) AS retinut_manual
   FROM (((contracte_terti c
     LEFT JOIN beneficiari b ON ((b.id = c.beneficiar_id)))
     LEFT JOIN retineri r ON ((r.contract_id = c.id)))
     LEFT JOIN restituiri rs ON ((rs.contract_id = c.id)))
  WHERE ((COALESCE(r.gbe_retinut, c.gbe_retinut_manual, (0)::numeric) > (0)::numeric) OR (COALESCE(rs.gbe_restituit, (0)::numeric) > (0)::numeric));
REVOKE ALL ON public.v_gbe_per_contract FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.v_gbe_per_contract TO anon, authenticated;
GRANT ALL ON public.v_gbe_per_contract TO service_role;
-- autoverificare: fixture-ul = live (altfel testul nu dovedește nimic despre producție)
DO $verif$
DECLARE v text;
BEGIN
  SELECT md5(string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) INTO v FROM pg_attribute WHERE attrelid = 'public.contracte_terti'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v IS DISTINCT FROM 'e10866a735d996751a2961f936871a20' THEN RAISE EXCEPTION 'fixture: coloanele contracte_terti ≠ live (md5 %)', v; END IF;
  IF (SELECT relacl::text FROM pg_class WHERE oid = 'public.contracte_terti'::regclass) IS DISTINCT FROM '{postgres=arwdDxtm/postgres,anon=arwdxt/postgres,authenticated=arwdxt/postgres,service_role=arwdDxtm/postgres}' THEN
    RAISE EXCEPTION 'fixture: ACL contracte_terti ≠ live (%)', (SELECT relacl::text FROM pg_class WHERE oid = 'public.contracte_terti'::regclass);
  END IF;
  IF md5(pg_get_viewdef('public.v_gbe_per_contract'::regclass)) IS DISTINCT FROM 'b9861ba0ac5ffe289fdc1f82a4c09f5c' THEN
    RAISE EXCEPTION 'fixture: v_gbe_per_contract ≠ live (md5 %)', md5(pg_get_viewdef('public.v_gbe_per_contract'::regclass));
  END IF;
  SELECT md5(string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) INTO v FROM pg_attribute WHERE attrelid = 'public.v_gbe_per_contract'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v IS DISTINCT FROM 'cae5aa7bd328ce2b3649230cae40bbc8' THEN RAISE EXCEPTION 'fixture: coloanele v_gbe_per_contract ≠ live (md5 %)', v; END IF;
END $verif$;
