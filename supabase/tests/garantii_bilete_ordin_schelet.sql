-- Schelet minim (NU se aplică pe producție) pentru scripts/test_garantii_bilete_ordin.sh — doar într-o bază locală *_test.
-- Reproduce starea LIVE din 02.10.2026 (citită read-only) pe obiectele atinse de 20261003a: public.garantii (coloane,
-- md5 0cd06900…; politicile 20261005b), fn_poate_scrie_garantii (md5 e8ee20a0…), set_updated_at (md5 1c4318be…),
-- garantii_alerte() (md5 fd35c645…, corp verbatim; EXECUTE doar postgres/service_role), garantii_alerte_amprenta (PK
-- garantie_id, fel), notifications (cu notifications_modul_check live). auth.uid() local = claim-ul request.jwt.claim.sub.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $roluri$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- ca în Supabase: tabelele/secvențele noi primesc implicit ALL pentru anon/authenticated/service_role
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, role text, is_owner boolean DEFAULT false, can_manage_contracts boolean DEFAULT false);
CREATE TABLE public.user_module_access (id serial PRIMARY KEY, profile_id uuid, module text, access_level text);
CREATE TABLE public.garantii (
  id bigserial PRIMARY KEY, forma text, tip text, beneficiar text, contract_numar text, contract_data date, lucrare text,
  proiect_id bigint, licitatie_id bigint, valoare numeric(14,2), moneda text DEFAULT 'RON', procent numeric(5,2), trezorerie_cont_id bigint,
  iban text, banca text, emitent text, numar_document text, data_emitere date, data_expirare date, stare text DEFAULT 'activa',
  lucrare_receptionata boolean DEFAULT false, data_receptie date, document_receptie text, data_eliberare date, eliberare_solicitata_la date,
  sursa_document text, observatii text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  contract_terti_id bigint, gbe_polita_id bigint, blocat_litigiu boolean DEFAULT false, litigiu_detalii text);
CREATE TABLE public.garantii_alerte_amprenta (
  garantie_id bigint NOT NULL REFERENCES public.garantii(id) ON DELETE CASCADE, fel text NOT NULL, amprenta text, trimis_la timestamptz DEFAULT now(),
  CONSTRAINT garantii_alerte_amprenta_pkey PRIMARY KEY (garantie_id, fel));
CREATE TABLE public.notifications (
  id bigserial PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, type text NOT NULL,
  modul text DEFAULT 'general', title text NOT NULL, message text, link_to text, read_at timestamptz, action_taken boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT notifications_modul_check CHECK ((modul = ANY (ARRAY['general'::text, 'Logistică'::text, 'Pontaj'::text, 'Execuție'::text, 'Financiar'::text, 'Comercial'::text, 'Administrativ'::text, 'HR'::text, 'Tichete'::text, 'Rapoarte'::text, 'Ședințe'::text, 'Ofertare'::text, 'Clădire'::text]))));

CREATE FUNCTION public.fn_poate_scrie_garantii()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr
             WHERE pr.id = auth.uid() AND (pr.is_owner IS TRUE OR pr.role IN ('superadmin', 'contabilitate', 'admin_logistica')))
    OR EXISTS (SELECT 1 FROM public.user_module_access uma
                WHERE uma.profile_id = auth.uid() AND uma.module IN ('financiar', 'financiar.garantii')
                  AND uma.access_level IN ('admin', 'editor'))
  );
$fn$;
REVOKE ALL ON FUNCTION public.fn_poate_scrie_garantii() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_poate_scrie_garantii() TO authenticated, service_role;

CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

CREATE FUNCTION public.garantii_alerte()
RETURNS TABLE(fel text, garantie_id bigint, mesaj text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  r record;
  v_amprenta text;
  v_fel text;
  v_titlu text;
  v_mesaj text;
BEGIN
  FOR r IN
    SELECT g.*, (g.data_expirare - current_date) AS zile
    FROM public.garantii g
    WHERE g.stare = 'activa'
  LOOP
    v_fel := NULL;

    -- 1. Lucrare receptionata, garantia inca blocata -> bani si plafon de recuperat
    IF r.lucrare_receptionata AND r.eliberare_solicitata_la IS NULL THEN
      v_fel := 'de_eliberat';
      v_titlu := 'Garanție de eliberat: ' || coalesce(r.lucrare, r.beneficiar);
      v_mesaj := 'Lucrarea e recepționată, garanția e încă blocată la ' ||
                 coalesce(r.emitent, r.banca, 'Trezorerie') ||
                 coalesce(' (' || translate(trim(to_char(r.valoare,'FM999,999,999.00')), ',.', '.,') || ' ' || r.moneda || ')', '') ||
                 '. Se poate cere eliberarea — generează adresa din Financiar → Garanții.';

    -- 2. Expirata fara receptie -> risc, nu oportunitate
    ELSIF r.data_expirare IS NOT NULL AND r.zile < 0 AND NOT r.lucrare_receptionata THEN
      v_fel := 'expirata_fara_receptie';
      v_titlu := 'Garanție expirată fără recepție: ' || coalesce(r.lucrare, r.beneficiar);
      v_mesaj := 'A expirat la ' || to_char(r.data_expirare,'DD.MM.YYYY') ||
                 ', dar lucrarea nu e marcată recepționată. Verifică dacă beneficiarul cere prelungire.';

    -- 3. Expira curand
    ELSIF r.data_expirare IS NOT NULL AND r.zile BETWEEN 0 AND 60 THEN
      v_fel := 'expira_' || CASE WHEN r.zile <= 7 THEN '7' WHEN r.zile <= 30 THEN '30' ELSE '60' END;
      v_titlu := 'Garanție expiră în ' || r.zile || ' zile: ' || coalesce(r.lucrare, r.beneficiar);
      v_mesaj := coalesce(r.emitent, r.banca, 'Trezorerie') ||
                 coalesce(', ' || r.numar_document, '') ||
                 ', scadență ' || to_char(r.data_expirare,'DD.MM.YYYY') ||
                 '. Dacă lucrarea e recepționată, cere eliberarea; dacă nu, pregătește prelungirea.';
    END IF;

    CONTINUE WHEN v_fel IS NULL;

    v_amprenta := v_fel || '|' || coalesce(r.data_expirare::text,'') || '|' ||
                  r.lucrare_receptionata::text || '|' || coalesce(r.eliberare_solicitata_la::text,'');

    IF EXISTS (SELECT 1 FROM public.garantii_alerte_amprenta a
               WHERE a.garantie_id = r.id AND a.fel = v_fel AND a.amprenta = v_amprenta) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
    SELECT p.id, 'warning', 'financiar', v_titlu, v_mesaj, '/financiar/garantii'
    FROM public.profiles p WHERE p.is_owner = true;

    INSERT INTO public.garantii_alerte_amprenta (garantie_id, fel, amprenta)
    VALUES (r.id, v_fel, v_amprenta)
    ON CONFLICT (garantie_id, fel) DO UPDATE SET amprenta = EXCLUDED.amprenta, trimis_la = now();

    fel := v_fel; garantie_id := r.id; mesaj := v_mesaj;
    RETURN NEXT;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.garantii_alerte() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.garantii_alerte() TO service_role;

ALTER TABLE public.garantii ENABLE ROW LEVEL SECURITY;
CREATE POLICY garantii_rls_sel ON public.garantii AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL));
CREATE POLICY garantii_rls_ins ON public.garantii AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_poate_scrie_garantii()));
CREATE POLICY garantii_rls_upd ON public.garantii AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_poate_scrie_garantii())) WITH CHECK ((SELECT public.fn_poate_scrie_garantii()));
CREATE POLICY garantii_rls_del ON public.garantii AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_poate_scrie_garantii()));

-- Persoane de test: 1 owner, 3 contabilitate (scriu); 6 viewer pe financiar.garantii, 8 oarecine (doar citesc)
INSERT INTO public.profiles (id, name, role, is_owner) VALUES
 ('00000000-0000-0000-0000-000000000001','owner','superadmin',true),
 ('00000000-0000-0000-0000-000000000003','contabilitate','contabilitate',false),
 ('00000000-0000-0000-0000-000000000006','gar_viewer','manager_santier',false),
 ('00000000-0000-0000-0000-000000000008','oarecine','gestionar',false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
 ('00000000-0000-0000-0000-000000000006','financiar.garantii','viewer'),
 ('00000000-0000-0000-0000-000000000008','ofertare','editor');
-- garanția 1 = polița (nu declanșează ramurile vechi: activă, fără expirare, nerecepționată)
INSERT INTO public.garantii (forma, tip, beneficiar, lucrare, emitent, numar_document, valoare, moneda, stare)
VALUES ('polita_asigurare', 'buna_executie', 'Beneficiar 1', 'Lucrarea 1', 'Asigurătorul Z', 'POL-100', 50000, 'RON', 'activa');
