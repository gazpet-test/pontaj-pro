-- GENERAT de scripts/izometrie/e3_gen/gen_e3.py din baseline_pre_e3.json (capturat de pe prod 2026-10-21, PG 17.6) — NU se editează
-- de mână. r5f (#825 NO-GO, P1-3/P1-4): reproduce EXACT baseline-ul extern pre-E3 verificat de preflight-ul 0l al migrării
-- 20261103b: owner / RLS / FORCE / ACL pe storage.objects și storage.buckets (fără MAINTAIN, doar PG17), TOATE politicile lor
-- (expresiile exacte; funcțiile din ele = stub-uri cu semnătura de pe prod), trigger-ele profiles prevent_role_escalation_trigger /
-- trg_profiles_campuri_owner_only cu corpurile EXACTE ale funcțiilor. Inclus din izometrie_e3_schelet.sql (\ir).
DO $r$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
  CREATE ROLE supabase_storage_admin NOLOGIN NOINHERIT; END IF; END $r$;
GRANT USAGE ON SCHEMA storage TO supabase_storage_admin;   -- verificările FK rulează ca owner-ul tabelului
-- coloanele profiles citite de politicile Storage și de corpurile trigger-elor (tipurile din expresiile deparsate)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text, ADD COLUMN IF NOT EXISTS can_access_pontaj_brut boolean, ADD COLUMN IF NOT EXISTS can_access_personal_data boolean, ADD COLUMN IF NOT EXISTS can_manage_contracts boolean, ADD COLUMN IF NOT EXISTS can_access_ctc boolean, ADD COLUMN IF NOT EXISTS department text, ADD COLUMN IF NOT EXISTS employee_id bigint, ADD COLUMN IF NOT EXISTS email text, ADD COLUMN IF NOT EXISTS can_use_document_scanner boolean, ADD COLUMN IF NOT EXISTS can_create_comenzi boolean, ADD COLUMN IF NOT EXISTS can_process_achizitii boolean, ADD COLUMN IF NOT EXISTS receive_tichete_logistica boolean, ADD COLUMN IF NOT EXISTS receive_tichete_hr boolean, ADD COLUMN IF NOT EXISTS receive_tichete_administrativ boolean, ADD COLUMN IF NOT EXISTS receive_tichete_it boolean, ADD COLUMN IF NOT EXISTS receive_tichete_comercial boolean, ADD COLUMN IF NOT EXISTS receive_tichete_financiar boolean, ADD COLUMN IF NOT EXISTS receive_bonuri_consum boolean, ADD COLUMN IF NOT EXISTS whatsapp_tier text;
-- stub-urile funcțiilor din expresiile politicilor (deparsarea depinde doar de semnătură și de tipul rezultatului)
CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE AS $s$ SELECT NULL::boolean $s$;
CREATE OR REPLACE FUNCTION public.fn_executie_pachete_acces(p_scriere boolean) RETURNS boolean LANGUAGE sql STABLE AS $s$ SELECT NULL::boolean $s$;
CREATE OR REPLACE FUNCTION public.fn_facturi_pdf_acces() RETURNS boolean LANGUAGE sql STABLE AS $s$ SELECT NULL::boolean $s$;
CREATE OR REPLACE FUNCTION public.fn_hr_decizii_storage_poate(p_name text, p_op text) RETURNS boolean LANGUAGE sql STABLE AS $s$ SELECT NULL::boolean $s$;
CREATE OR REPLACE FUNCTION public.fn_is_app_owner(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $s$ SELECT NULL::boolean $s$;
CREATE OR REPLACE FUNCTION public.fn_ofertare_obiect_in_pachet_inghetat(p_name text) RETURNS boolean LANGUAGE sql STABLE AS $s$ SELECT NULL::boolean $s$;
CREATE OR REPLACE FUNCTION public.my_employee_id() RETURNS bigint LANGUAGE sql STABLE AS $s$ SELECT NULL::bigint $s$;
CREATE OR REPLACE FUNCTION public.poate_edita_documente_firma() RETURNS boolean LANGUAGE sql STABLE AS $s$ SELECT NULL::boolean $s$;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql STABLE AS $s$ SELECT NULL::text[] $s$;
CREATE FUNCTION public.fn_profiles_campuri_owner_only() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $corp$
DECLARE
  v_camp   text;
  v_claims jsonb;
  v_rol    text;
  v_sub    text;
  v_rol_claim  text;
  v_rol_claims text;
BEGIN
  v_camp := CASE
    WHEN NEW.department               IS DISTINCT FROM OLD.department               THEN 'department'
    WHEN NEW.employee_id              IS DISTINCT FROM OLD.employee_id              THEN 'employee_id'
    WHEN NEW.email                    IS DISTINCT FROM OLD.email                    THEN 'email'
    WHEN NEW.can_use_document_scanner IS DISTINCT FROM OLD.can_use_document_scanner THEN 'can_use_document_scanner'
    WHEN NEW.can_manage_stoc          IS DISTINCT FROM OLD.can_manage_stoc          THEN 'can_manage_stoc'
    WHEN NEW.can_create_comenzi       IS DISTINCT FROM OLD.can_create_comenzi       THEN 'can_create_comenzi'
    WHEN NEW.can_process_achizitii    IS DISTINCT FROM OLD.can_process_achizitii    THEN 'can_process_achizitii'
    WHEN NEW.can_access_ctc           IS DISTINCT FROM OLD.can_access_ctc           THEN 'can_access_ctc'
    WHEN NEW.receive_tichete_logistica     IS DISTINCT FROM OLD.receive_tichete_logistica     THEN 'receive_tichete_logistica'
    WHEN NEW.receive_tichete_hr            IS DISTINCT FROM OLD.receive_tichete_hr            THEN 'receive_tichete_hr'
    WHEN NEW.receive_tichete_administrativ IS DISTINCT FROM OLD.receive_tichete_administrativ THEN 'receive_tichete_administrativ'
    WHEN NEW.receive_tichete_it            IS DISTINCT FROM OLD.receive_tichete_it            THEN 'receive_tichete_it'
    WHEN NEW.receive_tichete_comercial     IS DISTINCT FROM OLD.receive_tichete_comercial     THEN 'receive_tichete_comercial'
    WHEN NEW.receive_tichete_financiar     IS DISTINCT FROM OLD.receive_tichete_financiar     THEN 'receive_tichete_financiar'
    WHEN NEW.receive_bonuri_consum    IS DISTINCT FROM OLD.receive_bonuri_consum    THEN 'receive_bonuri_consum'
    WHEN NEW.whatsapp_tier            IS DISTINCT FROM OLD.whatsapp_tier            THEN 'whatsapp_tier'
  END;
  IF v_camp IS NULL THEN
    RETURN NEW;                                   -- nicio coloană protejată schimbată
  END IF;

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''),
                       nullif(current_setting('request.jwt.claim', true), ''))::jsonb;
  v_rol := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), v_claims ->> 'role');
  v_sub := coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), v_claims ->> 'sub');

  -- SEC F2 r4 (30.09.2026): cele două surse ale rolului JWT (request.jwt.claim.role și rolul din claims) nu au voie să se
  -- contrazică: ambele nevide și diferite => refuz (fail-closed), aliniat cu celelalte 3 triggere de pe profiles.
  v_rol_claim  := nullif(current_setting('request.jwt.claim.role', true), '');
  v_rol_claims := nullif(v_claims ->> 'role', '');
  IF v_rol_claim IS NOT NULL AND v_rol_claims IS NOT NULL AND v_rol_claim IS DISTINCT FROM v_rol_claims THEN
    RAISE EXCEPTION 'Doar owner-ul poate modifica % pe un profil (rol JWT contradictoriu: claim.role %, claims.role %)', v_camp, v_rol_claim, v_rol_claims
      USING ERRCODE = '42501';
  END IF;

  IF v_rol IS NULL AND v_sub IS NULL THEN
    -- fără context de cerere: conexiune directă la BD
    IF session_user IN ('postgres', 'supabase_admin') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Doar owner-ul poate modifica % pe un profil (conexiune fără identitate autorizată: %)', v_camp, session_user
      USING ERRCODE = '42501';
  END IF;

  -- SEC F2 r4: ramura service_role legată de rolul SQL efectiv, identic cu celelalte 3: conexiunea PostgREST (session_user =
  -- 'authenticator') ȘI rolul efectiv al cererii current_setting('role') = 'service_role' (SET LOCAL ROLE din JWT, nealterat de
  -- SECURITY DEFINER). Un RPC rulat ca authenticated care își pune singur claim-urile service_role (set_config) are
  -- role = 'authenticated' => cade mai jos pe 42501.
  IF v_rol = 'service_role' AND session_user = 'authenticator' AND current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF v_rol = 'authenticated' AND v_sub IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id::text = v_sub AND is_owner IS TRUE) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Doar owner-ul poate modifica % pe un profil', v_camp USING ERRCODE = '42501';
END $corp$;
ALTER FUNCTION public.fn_profiles_campuri_owner_only() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_profiles_campuri_owner_only() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_profiles_campuri_owner_only() TO postgres;
CREATE FUNCTION public.prevent_role_escalation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $corp$
DECLARE
  v_rol_claim  text;
  v_rol_claims text;
  v_rol        text;
BEGIN
  IF auth.uid() IS NULL THEN
    -- SEC F2 r3 (30.09.2026): fără identitate de utilizator (sub în JWT), trecerea e permisă DOAR contextului de sistem EXPLICIT:
    --   (a) PostgREST cu cheia service_role: rolul JWT = 'service_role' ȘI session_user = 'authenticator' (conexiunea PostgREST);
    --   (b) conexiune directă la BD: niciun rol JWT (nici claim.role, nici claims.role) ȘI session_user postgres / supabase_admin
    --       (migrări, SQL admin, pg_cron).
    --   Cele două surse ale rolului (request.jwt.claim.role și request.jwt.claims->>'role') nu au voie să se contrazică: ambele
    --   nevide și diferite => refuz (fail-closed). JSON invalid în claims => auth.uid() (evaluat primul) cade cu 22P02,
    --   fail-closed; handlerul de mai jos e doar apărare suplimentară.
    --   Orice altceva — cheia anon, un JWT authenticated fără sub, claim service_role pus prin set_config dintr-o altă sesiune,
    --   authenticator fără claims, alt rol de conexiune — e REFUZAT (42501). current_user NU e folosit: funcția e SECURITY
    --   DEFINER, deci current_user e mereu proprietarul (postgres). r3: ramura (a) cere și rolul SQL EFECTIV al cererii,
    --   current_setting('role') = 'service_role' — PostgREST îl setează din JWT (SET LOCAL ROLE) și SECURITY DEFINER nu-l
    --   schimbă (verificat cu PostgREST 13.0.4 real); un RPC rulat ca authenticated care își pune singur claim-urile
    --   service_role are role = 'authenticated' => refuz.
    v_rol_claim := nullif(current_setting('request.jwt.claim.role', true), '');
    BEGIN
      v_rol_claims := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
    EXCEPTION WHEN invalid_text_representation THEN
      v_rol_claims := NULL;
    END;
    IF v_rol_claim IS NOT NULL AND v_rol_claims IS NOT NULL AND v_rol_claim IS DISTINCT FROM v_rol_claims THEN
      RAISE EXCEPTION '%: rol JWT contradictoriu (claim.role: %, claims.role: %) — refuzat', 'prevent_role_escalation', v_rol_claim, v_rol_claims
        USING ERRCODE = '42501';
    END IF;
    v_rol := coalesce(v_rol_claim, v_rol_claims);
    IF v_rol = 'service_role' AND session_user = 'authenticator' AND current_setting('role', true) = 'service_role' THEN
      RETURN NEW;
    END IF;
    IF v_rol IS NULL AND session_user IN ('postgres', 'supabase_admin') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION '%: modificare pe profiles fără identitate de utilizator și în afara contextului de sistem (rol JWT: %, session_user: %)',
      'prevent_role_escalation', coalesce(v_rol, '<niciunul>'), session_user USING ERRCODE = '42501';
  END IF;

  -- Verifică modificare role
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_owner = true
    ) THEN
      RAISE EXCEPTION 'Doar owners pot schimba rolul (incercat: % → %)', OLD.role, NEW.role;
    END IF;
  END IF;

  -- Verifică modificare is_owner
  IF OLD.is_owner IS DISTINCT FROM NEW.is_owner THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_owner = true
    ) THEN
      RAISE EXCEPTION 'Doar owners pot schimba flag-ul is_owner';
    END IF;
  END IF;

  RETURN NEW;
END;
$corp$;
ALTER FUNCTION public.prevent_role_escalation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_role_escalation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevent_role_escalation() TO postgres;
GRANT EXECUTE ON FUNCTION public.prevent_role_escalation() TO service_role;
CREATE TRIGGER prevent_role_escalation_trigger BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION prevent_role_escalation();
CREATE TRIGGER trg_profiles_campuri_owner_only BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION fn_profiles_campuri_owner_only();
-- owner, RLS / FORCE, ACL (grantor = owner, ca pe prod)
ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
REVOKE ALL ON TABLE storage.buckets FROM PUBLIC, anon, authenticated, postgres, service_role, supabase_storage_admin;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE storage.buckets TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE storage.buckets TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE storage.buckets TO postgres WITH GRANT OPTION;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE storage.buckets TO service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE storage.buckets TO supabase_storage_admin WITH GRANT OPTION;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets NO FORCE ROW LEVEL SECURITY;
ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
REVOKE ALL ON TABLE storage.objects FROM PUBLIC, anon, authenticated, postgres, service_role, supabase_storage_admin;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE storage.objects TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE storage.objects TO authenticated;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE storage.objects TO postgres WITH GRANT OPTION;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE storage.objects TO service_role;
GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE storage.objects TO supabase_storage_admin WITH GRANT OPTION;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects NO FORCE ROW LEVEL SECURITY;
-- politicile (110), exact ca pe prod
CREATE POLICY "Authenticated can delete documente-flota" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING ((bucket_id = 'documente-flota'::text));
CREATE POLICY "Authenticated can read documente-flota" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING ((bucket_id = 'documente-flota'::text));
CREATE POLICY "Authenticated can update documente-flota" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((bucket_id = 'documente-flota'::text));
CREATE POLICY "Authenticated can upload documente-flota" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((bucket_id = 'documente-flota'::text));
CREATE POLICY "Pontaj brut delete owner" ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (((bucket_id = 'pontaj-brut-istoric'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true))))));
CREATE POLICY "Pontaj brut insert authorized" ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (((bucket_id = 'pontaj-brut-istoric'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.can_access_pontaj_brut = true) OR (profiles.is_owner = true)))))));
CREATE POLICY "Pontaj brut select authorized" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (((bucket_id = 'pontaj-brut-istoric'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.can_access_pontaj_brut = true) OR (profiles.is_owner = true)))))));
CREATE POLICY "Pontaj net delete owner" ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (((bucket_id = 'pontaj-net-istoric'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true))))));
CREATE POLICY "Pontaj net insert authorized" ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (((bucket_id = 'pontaj-net-istoric'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.can_access_pontaj_brut = true) OR (profiles.is_owner = true)))))));
CREATE POLICY "Pontaj net select authorized" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (((bucket_id = 'pontaj-net-istoric'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.can_access_pontaj_brut = true) OR (profiles.is_owner = true)))))));
CREATE POLICY "Supliment hrana delete owner" ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (((bucket_id = 'supliment-hrana-istoric'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true))))));
CREATE POLICY "Supliment hrana insert authorized" ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (((bucket_id = 'supliment-hrana-istoric'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.can_access_pontaj_brut = true) OR (profiles.is_owner = true)))))));
CREATE POLICY "Supliment hrana select authorized" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (((bucket_id = 'supliment-hrana-istoric'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.can_access_pontaj_brut = true) OR (profiles.is_owner = true)))))));
CREATE POLICY "ai_inbox_obj_all" ON storage.objects AS PERMISSIVE FOR ALL TO "authenticated" USING ((bucket_id = 'ai-documente-inbox'::text)) WITH CHECK ((bucket_id = 'ai-documente-inbox'::text));
CREATE POLICY "autorizatii_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING ((bucket_id = 'autorizatii'::text));
CREATE POLICY "autorizatii_read" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING ((bucket_id = 'autorizatii'::text));
CREATE POLICY "autorizatii_write" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((bucket_id = 'autorizatii'::text));
CREATE POLICY "avize_authenticated_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (((bucket_id = 'avize'::text) AND (auth.role() = 'authenticated'::text)));
CREATE POLICY "avize_authenticated_read" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (((bucket_id = 'avize'::text) AND (auth.role() = 'authenticated'::text)));
CREATE POLICY "cf_storage_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'comenzi-furnizor'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_owner = true))))));
CREATE POLICY "cf_storage_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((bucket_id = 'comenzi-furnizor'::text));
CREATE POLICY "cf_storage_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING ((bucket_id = 'comenzi-furnizor'::text));
CREATE POLICY "chat_imagini_read" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'chat-imagini'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "chat_imagini_upload" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'chat-imagini'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "contracte_comodat_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'contracte-comodat'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true))))));
CREATE POLICY "contracte_comodat_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'contracte-comodat'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_personal_data = true) OR (profiles.role = 'admin_logistica'::text)))))));
CREATE POLICY "contracte_comodat_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'contracte-comodat'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_personal_data = true) OR (profiles.role = 'admin_logistica'::text)))))));
CREATE POLICY "contracte_comodat_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'contracte-comodat'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_personal_data = true) OR (profiles.role = 'admin_logistica'::text)))))));
CREATE POLICY "contracte_terti_storage_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'contracte-terti'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true))))));
CREATE POLICY "contracte_terti_storage_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'contracte-terti'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_manage_contracts = true)))))));
CREATE POLICY "contracte_terti_storage_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'contracte-terti'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_manage_contracts = true)))))));
CREATE POLICY "contracte_terti_storage_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'contracte-terti'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_manage_contracts = true)))))));
CREATE POLICY "ctc_storage_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'ctc-documente'::text) AND (auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_owner OR p.can_access_ctc))))));
CREATE POLICY "ctc_storage_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'ctc-documente'::text) AND (auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_owner OR p.can_access_ctc))))));
CREATE POLICY "ctc_storage_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'ctc-documente'::text) AND (auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_owner OR p.can_access_ctc))))));
CREATE POLICY "ctc_storage_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'ctc-documente'::text) AND (auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_owner OR p.can_access_ctc))))));
CREATE POLICY "documente_firma_storage_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'documente-firma'::text) AND poate_edita_documente_firma()));
CREATE POLICY "documente_firma_storage_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'documente-firma'::text) AND poate_edita_documente_firma()));
CREATE POLICY "documente_firma_storage_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING ((bucket_id = 'documente-firma'::text));
CREATE POLICY "documente_firma_storage_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'documente-firma'::text) AND poate_edita_documente_firma())) WITH CHECK (((bucket_id = 'documente-firma'::text) AND poate_edita_documente_firma()));
CREATE POLICY "documente_personal_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (((bucket_id = 'documente-personal'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND ((p.can_access_personal_data = true) OR (p.is_owner = true)))))));
CREATE POLICY "documente_personal_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (((bucket_id = 'documente-personal'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND ((p.can_access_personal_data = true) OR (p.is_owner = true)))))));
CREATE POLICY "documente_personal_select" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (((bucket_id = 'documente-personal'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND ((p.can_access_personal_data = true) OR (p.is_owner = true)))))));
CREATE POLICY "documente_personal_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO public USING (((bucket_id = 'documente-personal'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND ((p.can_access_personal_data = true) OR (p.is_owner = true)))))));
CREATE POLICY "documente_proiect_storage_read" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'documente-proiect'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "edc_storage_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'executie-contracte'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "edc_storage_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'executie-contracte'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "edc_storage_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'executie-contracte'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "edc_storage_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'executie-contracte'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "executie_borderouri_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'executie-borderouri'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true))))));
CREATE POLICY "executie_borderouri_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'executie-borderouri'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "executie_borderouri_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'executie-borderouri'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "executie_borderouri_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'executie-borderouri'::text) AND (auth.uid() IS NOT NULL))) WITH CHECK (((bucket_id = 'executie-borderouri'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "executie_pachete_pdf_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'executie-pachete-pdf'::text) AND ( SELECT fn_executie_pachete_acces(true) AS fn_executie_pachete_acces)));
CREATE POLICY "executie_pachete_pdf_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'executie-pachete-pdf'::text) AND ( SELECT fn_executie_pachete_acces(true) AS fn_executie_pachete_acces)));
CREATE POLICY "executie_pachete_pdf_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'executie-pachete-pdf'::text) AND ( SELECT fn_executie_pachete_acces(false) AS fn_executie_pachete_acces)));
CREATE POLICY "executie_pachete_pdf_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'executie-pachete-pdf'::text) AND ( SELECT fn_executie_pachete_acces(true) AS fn_executie_pachete_acces))) WITH CHECK (((bucket_id = 'executie-pachete-pdf'::text) AND ( SELECT fn_executie_pachete_acces(true) AS fn_executie_pachete_acces)));
CREATE POLICY "facturi_storage_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'facturi-emise'::text) AND fn_is_app_owner(auth.uid())));
CREATE POLICY "facturi_storage_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'facturi-emise'::text) AND fn_facturi_pdf_acces()));
CREATE POLICY "facturi_storage_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'facturi-emise'::text) AND fn_facturi_pdf_acces()));
CREATE POLICY "facturi_storage_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'facturi-emise'::text) AND fn_facturi_pdf_acces())) WITH CHECK (((bucket_id = 'facturi-emise'::text) AND fn_facturi_pdf_acces()));
CREATE POLICY "hr_decizii_storage_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'hr-decizii'::text) AND fn_hr_decizii_storage_poate(name, 'insert'::text)));
CREATE POLICY "hr_decizii_storage_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'hr-decizii'::text) AND fn_hr_decizii_storage_poate(name, 'select'::text)));
CREATE POLICY "hr_semnaturi_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (((bucket_id = 'hr-semnaturi'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND ((p.can_access_personal_data = true) OR (p.is_owner = true)))))));
CREATE POLICY "hr_semnaturi_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (((bucket_id = 'hr-semnaturi'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND ((p.can_access_personal_data = true) OR (p.is_owner = true)))))));
CREATE POLICY "hr_semnaturi_select" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (((bucket_id = 'hr-semnaturi'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND ((p.can_access_personal_data = true) OR (p.is_owner = true)))))));
CREATE POLICY "hr_semnaturi_self_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'hr-semnaturi'::text) AND ((storage.foldername(name))[1] = (my_employee_id())::text)));
CREATE POLICY "hr_semnaturi_self_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'hr-semnaturi'::text) AND ((storage.foldername(name))[1] = (my_employee_id())::text)));
CREATE POLICY "hr_semnaturi_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO public USING (((bucket_id = 'hr-semnaturi'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND ((p.can_access_personal_data = true) OR (p.is_owner = true)))))));
CREATE POLICY "ofertare_storage_del" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'ofertare'::text) AND fn_are_acces_ofertare() AND (NOT fn_ofertare_obiect_in_pachet_inghetat(name))));
CREATE POLICY "ofertare_storage_ins" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'ofertare'::text) AND fn_are_acces_ofertare()));
CREATE POLICY "ofertare_storage_sel" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'ofertare'::text) AND fn_are_acces_ofertare()));
CREATE POLICY "ofertare_storage_upd" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'ofertare'::text) AND fn_are_acces_ofertare() AND (NOT fn_ofertare_obiect_in_pachet_inghetat(name)))) WITH CHECK (((bucket_id = 'ofertare'::text) AND fn_are_acces_ofertare() AND (NOT fn_ofertare_obiect_in_pachet_inghetat(name))));
CREATE POLICY "ordine_deplasare_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'ordine-deplasare-pdf'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_owner = true))))));
CREATE POLICY "ordine_deplasare_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'ordine-deplasare-pdf'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND ((p.can_access_personal_data = true) OR (p.is_owner = true)))))));
CREATE POLICY "ordine_deplasare_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'ordine-deplasare-pdf'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND ((p.can_access_personal_data = true) OR (p.is_owner = true)))))));
CREATE POLICY "ordine_deplasare_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'ordine-deplasare-pdf'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND ((p.can_access_personal_data = true) OR (p.is_owner = true)))))));
CREATE POLICY "pl_packing_del" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'packing-lists'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true))))));
CREATE POLICY "pl_packing_ins" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'packing-lists'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "pl_packing_sel" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING ((bucket_id = 'packing-lists'::text));
CREATE POLICY "pl_packing_upd" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'packing-lists'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "probe_citiri_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'probe-citiri'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true))))));
CREATE POLICY "probe_citiri_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'probe-citiri'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "probe_citiri_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING ((bucket_id = 'probe-citiri'::text));
CREATE POLICY "productie_storage_rw" ON storage.objects AS PERMISSIVE FOR ALL TO "authenticated" USING (((bucket_id = 'productie'::text) AND (auth.uid() IS NOT NULL))) WITH CHECK (((bucket_id = 'productie'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "qr_bonuri_delete_owner" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'qr-bonuri'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.role = 'admin_logistica'::text)))))));
CREATE POLICY "qr_bonuri_insert_auth" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((bucket_id = 'qr-bonuri'::text));
CREATE POLICY "qr_bonuri_select_auth" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING ((bucket_id = 'qr-bonuri'::text));
CREATE POLICY "rapoarte_obj_all" ON storage.objects AS PERMISSIVE FOR ALL TO "authenticated" USING ((bucket_id = 'rapoarte-zilnice'::text)) WITH CHECK ((bucket_id = 'rapoarte-zilnice'::text));
CREATE POLICY "recrutare_cv_select_hr" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'recrutare-cv'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND ((p.is_owner = true) OR (p.can_access_personal_data = true)))))));
CREATE POLICY "sedinte_pdf_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((bucket_id = 'sedinte-pdf'::text));
CREATE POLICY "sedinte_pdf_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING ((bucket_id = 'sedinte-pdf'::text));
CREATE POLICY "sedinte_pdf_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((bucket_id = 'sedinte-pdf'::text)) WITH CHECK ((bucket_id = 'sedinte-pdf'::text));
CREATE POLICY "service_fise_doc_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'service-fise-documente'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "service_fise_doc_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'service-fise-documente'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "service_fise_doc_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING ((bucket_id = 'service-fise-documente'::text));
CREATE POLICY "service_fise_doc_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'service-fise-documente'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "templates_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'templates'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = 'superadmin'::text) OR (profiles.is_owner = true)))))));
CREATE POLICY "templates_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'templates'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = 'superadmin'::text) OR (profiles.is_owner = true)))))));
CREATE POLICY "templates_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING ((bucket_id = 'templates'::text));
CREATE POLICY "templates_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'templates'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.role = 'superadmin'::text) OR (profiles.is_owner = true)))))));
CREATE POLICY "tichete_storage_delete_own" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'tichete-atasamente'::text) AND ((owner = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true)))))));
CREATE POLICY "tichete_storage_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'tichete-atasamente'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "tichete_storage_select" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'tichete-atasamente'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "tts_audio_inchis" ON storage.objects AS RESTRICTIVE FOR ALL TO public USING ((bucket_id IS DISTINCT FROM 'tts-audio'::text)) WITH CHECK ((bucket_id IS DISTINCT FROM 'tts-audio'::text));
CREATE POLICY "upa docs authenticated all" ON storage.objects AS PERMISSIVE FOR ALL TO public USING (((bucket_id = 'documente-upa'::text) AND (auth.uid() IS NOT NULL))) WITH CHECK (((bucket_id = 'documente-upa'::text) AND (auth.uid() IS NOT NULL)));
CREATE POLICY "whatsapp_bonuri_delete_owner_only" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'whatsapp-motorina-bonuri'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true))))));
CREATE POLICY "whatsapp_bonuri_insert_owner_or_admin_logistica" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'whatsapp-motorina-bonuri'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.role = 'admin_logistica'::text)))))));
CREATE POLICY "whatsapp_bonuri_select_owner_or_admin_logistica" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'whatsapp-motorina-bonuri'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.role = 'admin_logistica'::text)))))));
CREATE POLICY "whatsapp_bonuri_update_owner_or_admin_logistica" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'whatsapp-motorina-bonuri'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.role = 'admin_logistica'::text)))))));
