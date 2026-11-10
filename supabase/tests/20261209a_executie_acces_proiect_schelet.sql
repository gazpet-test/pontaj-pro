-- Schelet minim „tip Supabase” pentru proba LOCALĂ (PGlite, în memorie) a migrării 20261209a și a harness-ului scripts/test_executie_acces_proiect.sql.
-- NU e migrare și nu se rulează pe nicio bază reală. Peste el, runner-ul (scripts/pglite/test_executie_acces_proiect_local.mjs) aplică 20261201a
-- și 20261028a întregi și creează funcțiile din 20261203a / 20261204a / 20261208a EXACT cum sunt în migrările lor (amprentele se verifică).
-- Reproduce: rolurile (service_role cu BYPASSRLS), privilegiile implicite din schema public (ALL pentru anon / authenticated / service_role, ca la
-- Supabase), auth.uid() din cele două surse JWT, storage (cu o politică „autentificat” pe bucket-urile de test, ca accesul de azi), tabelele
-- vechi ale Execuției cu coloanele citite din cod și din migrări (plus câte o coloană NOT NULL) și RLS-ul lor „autentificat” (auth.uid() IS NOT
-- NULL, ca în matricea de securitate din 30.09.2026), câteva tabele ale modulelor excluse (Izometrie, HR, Achiziții, Magazie, Redări) legate de
-- proiecte. Date: profiluri sintetice (1 owner + 3), trei proiecte CLONA-A/B/C, rânduri pe fiecare tabel acoperit.
-- r3: tabelele Execuției găsite în catalogul clonei, o dimensiune comună (employees) și un înlocuitor de test pentru fn_executie_swap_tevi_pozitie.
-- r4: graficul intern (grafic_activitati, rânduri pe proiecte + unul doar cu licitație) și coada Inboxului AI cu politicile ei de azi
-- (20261103c, text exact) + predicatul fn_ai_inbox_poate_confirma (corpul de pe clonă, amprenta se verifică) + bucket-ul ei.
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text, owner_id text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.buckets, storage.objects TO anon, authenticated, service_role;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
  SELECT (string_to_array(name, '/'))[1:greatest(cardinality(string_to_array(name, '/')) - 1, 0)]
$f$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, email text, is_owner boolean DEFAULT false, role text,
  can_access_personal_data boolean DEFAULT false, can_access_financiar boolean DEFAULT false);
CREATE TABLE public.user_module_access (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id),
  module text NOT NULL, access_level text NOT NULL, UNIQUE (profile_id, module));
CREATE FUNCTION public.fn_is_app_owner(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p AND is_owner IS TRUE)
$f$;
CREATE TABLE public.executie_proiecte (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, cod_intern text, nume text, activ boolean DEFAULT true, eticheta_gmail text,
  site_id integer);
CREATE TABLE public.sites (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text, proiect_id bigint REFERENCES public.executie_proiecte(id));
CREATE TABLE public.profile_sites (profile_id uuid NOT NULL REFERENCES public.profiles(id), site_id integer NOT NULL REFERENCES public.sites(id),
  valid_until date, PRIMARY KEY (profile_id, site_id));

-- tabelele vechi ale Execuției (coloana de proiect + o coloană NOT NULL)
CREATE TABLE public.executie_tronsoane (id bigserial PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id) ON DELETE CASCADE, cod text NOT NULL);
CREATE TABLE public.executie_documente_contract (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), fisier text NOT NULL);
CREATE TABLE public.executie_acte_aditionale (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), nr text NOT NULL);
CREATE TABLE public.executie_ordine_sistare (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), data_sistare date NOT NULL);
CREATE TABLE public.executie_completari_propuse (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), camp text NOT NULL);
CREATE TABLE public.executie_faze_determinante (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), faza text NOT NULL);
CREATE TABLE public.executie_probe_presiune (id bigserial PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id) ON DELETE CASCADE, tronson text NOT NULL);
CREATE TABLE public.executie_situatii_plata (id bigserial PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id), nr_situatie integer NOT NULL);
CREATE TABLE public.executie_situatii_plata_linii (id bigserial PRIMARY KEY, sl_id bigint NOT NULL REFERENCES public.executie_situatii_plata(id) ON DELETE CASCADE, ord integer NOT NULL);
CREATE TABLE public.executie_sl_ajustari (id bigserial PRIMARY KEY, sl_id bigint NOT NULL REFERENCES public.executie_situatii_plata(id) ON DELETE CASCADE, tip text NOT NULL);
CREATE TABLE public.executie_bonuri_consum (id bigserial PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id), numar_bon text);
CREATE TABLE public.executie_bonuri_consum_linii (id bigserial PRIMARY KEY, bon_id bigint NOT NULL REFERENCES public.executie_bonuri_consum(id) ON DELETE CASCADE, cantitate numeric NOT NULL);
CREATE TABLE public.executie_alocari_personal (id bigserial PRIMARY KEY, proiect_id integer, employee_id integer NOT NULL);
CREATE TABLE public.executie_ture (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), data_start date NOT NULL);
CREATE TABLE public.executie_tura_subcontractori (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), data_start date NOT NULL);
CREATE TABLE public.executie_tura_activitati (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), data_start date NOT NULL);
CREATE TABLE public.executie_tura_naveta (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), data_start date NOT NULL);
CREATE TABLE public.proiect_unitati (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  tip text NOT NULL DEFAULT 'tronson', cod text, nume text NOT NULL, ordine integer DEFAULT 0, activ boolean DEFAULT true, obiect_cod text, nod_cod text);
CREATE TABLE public.proiect_activitati (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  nume text NOT NULL, um text, activ boolean DEFAULT true, ordine integer DEFAULT 0, coduri_deviz text, tip_raportare text, sursa_executat text NOT NULL DEFAULT 'raport');
CREATE TABLE public.proiect_articole (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  cod text NOT NULL, cantitate numeric);
-- pachetele de izometrii (20261029a: citire executie / ctc, scriere executie) și țevile lor
CREATE TABLE public.executie_pachete_lansare (id bigserial PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  tronson_id bigint REFERENCES public.executie_tronsoane(id), cod_document_full text NOT NULL);
CREATE TABLE public.executie_pachete_documente (id bigserial PRIMARY KEY, pachet_id bigint NOT NULL REFERENCES public.executie_pachete_lansare(id),
  tip_document text NOT NULL, fisier_path text);
CREATE TABLE public.executie_tevi (id bigserial PRIMARY KEY, pachet_id bigint REFERENCES public.executie_pachete_lansare(id), serie_unica text NOT NULL,
  poz_in_pachet integer);
-- r3: tabelele Execuției create direct în BD (găsite în catalogul clonei), cu coloana de legătură și o coloană NOT NULL
CREATE TABLE public.executie_alerte_ai (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), mesaj text NOT NULL);
CREATE TABLE public.executie_documente_referinta (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), titlu text NOT NULL);
CREATE TABLE public.executie_pachete_cumulat_final (id bigserial PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id), cod text NOT NULL);
CREATE TABLE public.executie_pachete_cumulat_tevi (id bigserial PRIMARY KEY, cumulat_id bigint NOT NULL REFERENCES public.executie_pachete_cumulat_final(id) ON DELETE CASCADE,
  serie text NOT NULL);
CREATE TABLE public.executie_pachete_exports (id bigserial PRIMARY KEY, pachet_cumulat_id bigint REFERENCES public.executie_pachete_cumulat_final(id), fisier text NOT NULL);
CREATE TABLE public.executie_pachete_sudura_sant (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), cod text NOT NULL);
CREATE TABLE public.proiect_activitate_coduri (id bigserial PRIMARY KEY, activitate_id integer NOT NULL REFERENCES public.proiect_activitati(id) ON DELETE CASCADE,
  cod text NOT NULL);
-- dimensiune comună (clasa 'comun'): angajații, legați de șantier
CREATE TABLE public.employees (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL, site_id integer REFERENCES public.sites(id));
-- ÎNLOCUITOR DE TEST pentru fn_executie_swap_tevi_pozitie (originalul e creat direct în BD și nu se copiază în repo; amprenta reală e în
-- inventarul migrării, iar runner-ul o înlocuiește în textul migrării cu amprenta acestui corp). Același contract: schimbă pozițiile a două
-- țevi din același pachet, cu mesajele „Teava ID … nu exista”.
CREATE FUNCTION public.fn_executie_swap_tevi_pozitie(p_id_a bigint, p_id_b bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE a integer; b integer; pa bigint; pb bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Neautorizat: trebuie autentificare'; END IF;
  SELECT poz_in_pachet, pachet_id INTO a, pa FROM public.executie_tevi WHERE id = p_id_a FOR UPDATE;
  SELECT poz_in_pachet, pachet_id INTO b, pb FROM public.executie_tevi WHERE id = p_id_b FOR UPDATE;
  IF a IS NULL THEN RAISE EXCEPTION 'Teava ID % nu exista', p_id_a; END IF;
  IF b IS NULL THEN RAISE EXCEPTION 'Teava ID % nu exista', p_id_b; END IF;
  IF pa IS DISTINCT FROM pb THEN RAISE EXCEPTION 'Tevile nu sunt in acelasi pachet'; END IF;
  UPDATE public.executie_tevi SET poz_in_pachet = CASE WHEN id = p_id_a THEN b ELSE a END WHERE id IN (p_id_a, p_id_b);
END $f$;
-- corespondența proiectului (documente_proiect; coada documente_de_repartizat o creează 20261028a, aplicată de runner)
CREATE TABLE public.documente_proiect (id bigserial PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  sursa text, gmail_message_id text, nume_fisier text NOT NULL, mime_type text, marime_bytes bigint, expeditor text, subiect text, data_mail timestamptz,
  storage_path text NOT NULL, drive_file_id text, hash_sha256 text, nas_synced boolean DEFAULT false);
CREATE UNIQUE INDEX documente_proiect_dedup_key ON public.documente_proiect (proiect_id, gmail_message_id, nume_fisier);
CREATE TABLE public.executie_ordine_detectate (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), tip text NOT NULL,
  documente_proiect_id bigint REFERENCES public.documente_proiect(id) ON DELETE CASCADE);
-- raportul zilnic (antetul pe șantier; liniile pe proiect; coloanele antetului ca în 20261208a)
CREATE TABLE public.rapoarte_zilnice (id bigserial PRIMARY KEY, site_id integer NOT NULL REFERENCES public.sites(id), data date NOT NULL,
  sef_santier text, lucrari_efectuate text, utilaje_snapshot jsonb, personal_snapshot jsonb, masini text, probleme text, subcontractori text,
  aprovizionare text, plan_maine text, poze jsonb, meteo text, distributie_antet text, created_by uuid, updated_at timestamptz,
  versiune_salvare integer NOT NULL DEFAULT 0, UNIQUE (site_id, data));
CREATE TABLE public.raport_lucrari (id bigserial PRIMARY KEY, raport_id bigint NOT NULL REFERENCES public.rapoarte_zilnice(id) ON DELETE CASCADE,
  proiect_id bigint, activitate_id integer REFERENCES public.proiect_activitati(id), unitate_id bigint REFERENCES public.proiect_unitati(id),
  cantitate numeric(14,3) NOT NULL);
CREATE TABLE public.raport_distributie_linii (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, raport_id bigint NOT NULL REFERENCES public.rapoarte_zilnice(id) ON DELETE CASCADE,
  tabel text NOT NULL, nr_crt integer NOT NULL, unitate_id bigint REFERENCES public.proiect_unitati(id) ON DELETE SET NULL);
CREATE TABLE public.raport_zilnic_salvari (cheie uuid PRIMARY KEY, raport_id bigint NOT NULL REFERENCES public.rapoarte_zilnice(id) ON DELETE CASCADE,
  versiune integer NOT NULL, amprenta text NOT NULL, profile_id uuid NOT NULL, creat_la timestamptz NOT NULL DEFAULT now(), UNIQUE (raport_id, versiune));
-- r4: graficul intern (Gantt): rânduri pe proiect (proiect_id) sau doar pe licitație (Ofertare)
CREATE TABLE public.grafic_activitati (id bigserial PRIMARY KEY, licitatie_id bigint, proiect_id bigint REFERENCES public.executie_proiecte(id),
  nume text NOT NULL, CHECK (licitatie_id IS NOT NULL OR proiect_id IS NOT NULL));
-- r4: Inboxul AI — predicatul de azi (corpul de pe clonă, text exact) + coada cu coloanele și politicile de azi (20261103c)
CREATE OR REPLACE FUNCTION public.fn_ai_inbox_poate_confirma(p_modul text, p_entitate_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid UUID := auth.uid(); v_owner BOOLEAN; v_rec RECORD;
BEGIN
  IF v_uid IS NULL THEN RETURN true; END IF;  -- service_role / migrări
  SELECT is_owner, role, can_access_personal_data, can_access_financiar
    INTO v_rec FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_rec.is_owner THEN RETURN true; END IF;              -- owner vede tot
  IF p_modul IS NULL THEN RETURN true; END IF;             -- coada „nedecis": oricine logat
  IF p_modul = 'hr'         THEN RETURN COALESCE(v_rec.can_access_personal_data,false); END IF;
  IF p_modul = 'logistica'  THEN RETURN v_rec.role = 'admin_logistica'; END IF;
  IF p_modul = 'financiar'  THEN RETURN COALESCE(v_rec.can_access_financiar,false); END IF;
  IF p_modul = 'executie'   THEN
    -- MP: are profile_sites pe site_id-ul proiectului documentului
    IF p_entitate_id IS NULL THEN RETURN false; END IF;    -- fără proiect determinat → owner-only
    RETURN EXISTS (
      SELECT 1 FROM public.executie_proiecte ep
      JOIN public.profile_sites ps ON ps.site_id = ep.site_id AND ps.profile_id = v_uid
      WHERE ep.id = p_entitate_id
        AND (ps.valid_until IS NULL OR ps.valid_until >= CURRENT_DATE)
    );
  END IF;
  RETURN false;
END $function$;
REVOKE EXECUTE ON FUNCTION public.fn_ai_inbox_poate_confirma(text, bigint) FROM PUBLIC, anon;
CREATE TABLE public.ai_documente_inbox (
  id bigserial PRIMARY KEY, fisier_path text NOT NULL, fisier_nume text NOT NULL, fisier_size_bytes bigint, fisier_mime text,
  status text NOT NULL DEFAULT 'in_asteptare', modul_tinta text, tip_document text, payload_ai jsonb, entitate_tip text,
  entitate_id bigint, entitate_match_confidence smallint, clasificare_confidence smallint, destinatie_tabel text, ai_eroare text,
  redirectionat_din_modul text, confirmat_de uuid, confirmat_la timestamptz, confirmat_ref_id bigint, respins_motiv text,
  uploadat_de uuid NOT NULL, uploadat_la timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  fisier_sters_la timestamptz);
CREATE UNIQUE INDEX idx_ai_inbox_fisier_path ON public.ai_documente_inbox (fisier_path);
ALTER TABLE public.ai_documente_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_inbox_delete ON public.ai_documente_inbox FOR DELETE TO authenticated
  USING (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true))));
CREATE POLICY ai_inbox_insert ON public.ai_documente_inbox FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() IS NOT NULL) AND (uploadat_de = auth.uid())));
CREATE POLICY ai_inbox_select ON public.ai_documente_inbox AS PERMISSIVE FOR SELECT TO authenticated
  USING ((uploadat_de = auth.uid())
    OR (modul_tinta IS NULL
        AND EXISTS (SELECT 1 FROM public.profiles h WHERE h.id = auth.uid() AND (h.is_owner = true OR h.can_access_personal_data = true)))
    OR (modul_tinta IS NOT NULL AND public.fn_ai_inbox_poate_confirma(modul_tinta, entitate_id)));
CREATE POLICY ai_inbox_update ON public.ai_documente_inbox AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((uploadat_de = auth.uid())
    OR (modul_tinta IS NULL
        AND EXISTS (SELECT 1 FROM public.profiles h WHERE h.id = auth.uid() AND (h.is_owner = true OR h.can_access_personal_data = true)))
    OR (modul_tinta IS NOT NULL AND public.fn_ai_inbox_poate_confirma(modul_tinta, entitate_id)))
  WITH CHECK (auth.uid() IS NOT NULL);
-- module excluse (accesul lor e al lor): legate de proiecte, ca derivarea din catalog să le găsească și să se oprească la ele
CREATE TABLE public.izo_tronson_config (tronson_id bigint PRIMARY KEY REFERENCES public.executie_tronsoane(id), activ boolean DEFAULT false);
CREATE TABLE public.hr_decizii (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), nr text NOT NULL);
CREATE TABLE public.comenzi_furnizor (id bigserial PRIMARY KEY, proiect_id bigint, numar text NOT NULL);
CREATE TABLE public.magazie_bucati (id bigserial PRIMARY KEY, executie_teava_id bigint REFERENCES public.executie_tevi(id), cod text NOT NULL);
CREATE TABLE public.red_proiecte (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), executie_proiect_id bigint REFERENCES public.executie_proiecte(id), nume text);
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'user_module_access', 'executie_proiecte', 'sites', 'profile_sites',
                           'executie_tronsoane', 'executie_documente_contract', 'executie_acte_aditionale', 'executie_ordine_sistare',
                           'executie_ordine_detectate', 'executie_completari_propuse', 'executie_faze_determinante', 'executie_probe_presiune',
                           'executie_situatii_plata', 'executie_situatii_plata_linii', 'executie_sl_ajustari', 'executie_bonuri_consum',
                           'executie_bonuri_consum_linii', 'executie_alocari_personal', 'executie_ture', 'executie_tura_subcontractori',
                           'executie_tura_activitati', 'executie_tura_naveta', 'proiect_unitati', 'proiect_activitati', 'proiect_articole',
                           'executie_pachete_lansare', 'executie_pachete_documente', 'executie_tevi', 'documente_proiect',
                           'rapoarte_zilnice', 'raport_lucrari', 'raport_distributie_linii',
                           'executie_alerte_ai', 'executie_documente_referinta', 'executie_pachete_cumulat_final', 'executie_pachete_cumulat_tevi',
                           'executie_pachete_exports', 'executie_pachete_sudura_sant', 'proiect_activitate_coduri',
                           'grafic_activitati',
                           'izo_tronson_config', 'hr_decizii', 'comenzi_furnizor', 'magazie_bucati', 'red_proiecte'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)', t || '_autentificat', t);
  END LOOP;
END $rls$;
ALTER TABLE public.raport_zilnic_salvari ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.raport_zilnic_salvari FROM PUBLIC, anon, authenticated, service_role;

-- vederile citite de Execuție (security_invoker, ca în producție pentru cele din repo) + una veche „definer” peste un tabel EXCLUS (nu e treaba migrării)
CREATE VIEW public.v_executie_dashboard WITH (security_invoker = on) AS SELECT p.id, p.cod_intern, p.nume FROM public.executie_proiecte p;
CREATE VIEW public.v_executie_alocari WITH (security_invoker = on) AS SELECT a.id, a.proiect_id, a.employee_id FROM public.executie_alocari_personal a;
CREATE VIEW public.v_executie_alocari_conflicte WITH (security_invoker = on) AS SELECT a.id AS alocare_id FROM public.executie_alocari_personal a;
CREATE VIEW public.v_sl_fara_factura WITH (security_invoker = on) AS SELECT s.id, s.proiect_id FROM public.executie_situatii_plata s;
CREATE VIEW public.v_contract_efecte_acte WITH (security_invoker = on) AS SELECT a.proiect_id, count(*) AS n FROM public.executie_acte_aditionale a GROUP BY a.proiect_id;
CREATE VIEW public.v_comenzi_vechi AS SELECT c.id, c.proiect_id FROM public.comenzi_furnizor c;

-- Storage: bucket-urile de test + accesul de azi („autentificat”)
INSERT INTO storage.buckets (id, name) VALUES ('executie-contracte', 'executie-contracte'), ('executie-borderouri', 'executie-borderouri'),
  ('executie-pachete-pdf', 'executie-pachete-pdf'), ('documente-proiect', 'documente-proiect');
CREATE POLICY test_obiecte_autentificat ON storage.objects FOR ALL TO authenticated
  USING (bucket_id IN ('executie-contracte', 'executie-borderouri', 'executie-pachete-pdf', 'documente-proiect'))
  WITH CHECK (bucket_id IN ('executie-contracte', 'executie-borderouri', 'executie-pachete-pdf', 'documente-proiect'));
-- r4: bucket-ul Inboxului AI cu politicile de azi (20261103c, text exact)
INSERT INTO storage.buckets (id, name) VALUES ('ai-documente-inbox', 'ai-documente-inbox');
CREATE POLICY ai_inbox_obj_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ai-documente-inbox'
    AND (SELECT auth.uid()) IS NOT NULL
    AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
         OR ((storage.foldername(name))[1] = 'wizard-angajare'
             AND EXISTS (SELECT 1 FROM public.profiles p
                          WHERE p.id = (SELECT auth.uid()) AND (p.is_owner = true OR p.can_access_personal_data = true))))
    AND NOT EXISTS (SELECT 1 FROM public.ai_documente_inbox i WHERE i.fisier_path = objects.name));
CREATE POLICY ai_inbox_obj_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    bucket_id = 'ai-documente-inbox'
    AND (SELECT auth.uid()) IS NOT NULL
    AND (owner_id = (SELECT auth.uid())::text
         OR EXISTS (SELECT 1 FROM public.ai_documente_inbox i
                     WHERE i.fisier_path = objects.name AND i.uploadat_de::text = objects.owner_id
                       AND ((i.modul_tinta IS NOT NULL AND public.fn_ai_inbox_poate_confirma(i.modul_tinta, i.entitate_id))
                            OR (i.modul_tinta IS NULL
                                AND EXISTS (SELECT 1 FROM public.profiles h WHERE h.id = (SELECT auth.uid()) AND h.can_access_personal_data = true))))
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.is_owner = true)));
CREATE POLICY ai_inbox_obj_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    bucket_id = 'ai-documente-inbox'
    AND (SELECT auth.uid()) IS NOT NULL
    AND (owner_id = (SELECT auth.uid())::text
         OR EXISTS (SELECT 1 FROM public.ai_documente_inbox i
                     WHERE i.fisier_path = objects.name AND i.uploadat_de::text = objects.owner_id
                       AND i.modul_tinta IS NOT NULL AND public.fn_ai_inbox_poate_confirma(i.modul_tinta, i.entitate_id))
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.is_owner = true)));

-- date sintetice
INSERT INTO public.profiles (id, name, email, is_owner) VALUES
  ('00000000-0000-4000-8000-000000000001', 'OWNER TEST', 'owner@test.invalid', true),
  ('00000000-0000-4000-8000-000000000002', 'UNU TEST', 'unu@test.invalid', false),
  ('00000000-0000-4000-8000-000000000003', 'DOI TEST', 'doi@test.invalid', false),
  ('00000000-0000-4000-8000-000000000004', 'TREI TEST', 'trei@test.invalid', false);
INSERT INTO public.executie_proiecte (cod_intern, nume) VALUES ('CLONA-A', 'Proiect clona A'), ('CLONA-B', 'Proiect clona B'), ('CLONA-C', 'Proiect clona C');
INSERT INTO public.sites (name, proiect_id) VALUES ('Santier A', 1), ('Santier C', 3), ('Santier fara proiect', NULL);
INSERT INTO public.executie_tronsoane (proiect_id, cod) VALUES (1, 'TR-A1'), (1, 'TR-A2'), (2, 'TR-B1'), (3, 'TR-C1');
INSERT INTO public.executie_situatii_plata (proiect_id, nr_situatie) VALUES (1, 1), (2, 1), (3, 1);
INSERT INTO public.executie_situatii_plata_linii (sl_id, ord) VALUES (1, 1), (1, 2), (2, 1), (3, 1);
INSERT INTO public.executie_sl_ajustari (sl_id, tip) VALUES (1, 'x'), (3, 'x');
INSERT INTO public.executie_bonuri_consum (proiect_id, numar_bon) VALUES (1, 'BC-1'), (2, 'BC-2'), (3, 'BC-3');
INSERT INTO public.executie_bonuri_consum_linii (bon_id, cantitate) VALUES (1, 1), (3, 2), (3, 3);
INSERT INTO public.executie_alocari_personal (proiect_id, employee_id) VALUES (1, 10), (3, 11);
INSERT INTO public.executie_ture (proiect_id, data_start) VALUES (1, '2026-11-01'), (3, '2026-11-01');
INSERT INTO public.executie_acte_aditionale (proiect_id, nr) VALUES (1, 'AA1'), (3, 'AA1');
INSERT INTO public.proiect_articole (proiect_id, cod) VALUES (1, 'GA04'), (2, 'GA04'), (3, 'GA04');
INSERT INTO public.proiect_activitati (proiect_id, nume) VALUES (1, 'Lansat'), (3, 'Lansat');
INSERT INTO public.proiect_unitati (proiect_id, cod, nume) VALUES (1, 'U-A', 'Obiect A'), (3, 'U-C', 'Obiect C');
INSERT INTO public.executie_pachete_lansare (proiect_id, tronson_id, cod_document_full) VALUES (1, 1, 'IZO-A'), (3, 4, 'IZO-C');
INSERT INTO public.executie_pachete_documente (pachet_id, tip_document, fisier_path) VALUES
  (1, 'centralizator', '1/2026-11-01_ab_centralizator.xlsx'), (2, 'aprobare', '3/2/aprobare/x.pdf');
INSERT INTO public.executie_tevi (pachet_id, serie_unica, poz_in_pachet) VALUES (1, 'T-A1', 1), (2, 'T-C1', 1), (1, 'T-A2', 2), (2, 'T-C2', 2);
INSERT INTO public.executie_alerte_ai (proiect_id, mesaj) VALUES (1, 'alerta A'), (3, 'alerta C');
INSERT INTO public.executie_documente_referinta (proiect_id, titlu) VALUES (1, 'ref A'), (3, 'ref C');
INSERT INTO public.executie_pachete_cumulat_final (proiect_id, cod) VALUES (1, 'CF-A'), (3, 'CF-C');
INSERT INTO public.executie_pachete_cumulat_tevi (cumulat_id, serie) VALUES (1, 'S-A'), (2, 'S-C');
INSERT INTO public.executie_pachete_exports (pachet_cumulat_id, fisier) VALUES (1, 'a.xlsx'), (2, 'c.xlsx');
INSERT INTO public.executie_pachete_sudura_sant (proiect_id, cod) VALUES (1, 'SS-A'), (3, 'SS-C');
INSERT INTO public.proiect_activitate_coduri (activitate_id, cod) VALUES (1, 'GA04-A'), (2, 'GA04-C');
INSERT INTO public.employees (name, site_id) VALUES ('ANGAJAT UNU', 1), ('ANGAJAT DOI', 2);
INSERT INTO public.documente_proiect (proiect_id, sursa, gmail_message_id, nume_fisier, storage_path) VALUES
  (1, 'gmail', 'm-a', 'a.pdf', 'clona-a/2026/11/a.pdf'), (3, 'gmail', 'm-c', 'c.pdf', 'clona-c/2026/11/c.pdf');
INSERT INTO public.executie_ordine_detectate (proiect_id, tip, documente_proiect_id) VALUES (NULL, 'sistare', NULL), (3, 'sistare', 2), (1, 'sistare', 1);
INSERT INTO public.rapoarte_zilnice (site_id, data, probleme) VALUES (1, '2026-11-02', 'A'), (2, '2026-11-02', 'C'), (3, '2026-11-02', 'fara proiect');
INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, unitate_id, cantitate) VALUES (1, 1, 1, 1, 5), (2, 3, 2, 2, 7);
INSERT INTO public.raport_distributie_linii (raport_id, tabel, nr_crt, unitate_id) VALUES (1, 'conducta', 1, 1), (2, 'conducta', 1, 2), (3, 'conducta', 1, NULL);
INSERT INTO public.izo_tronson_config (tronson_id) VALUES (1), (4);
INSERT INTO public.hr_decizii (proiect_id, nr) VALUES (1, 'D1'), (3, 'D3');
INSERT INTO public.comenzi_furnizor (proiect_id, numar) VALUES (1, 'C1'), (3, 'C3');
INSERT INTO public.magazie_bucati (executie_teava_id, cod) VALUES (1, 'B1'), (2, 'B3');
INSERT INTO public.red_proiecte (executie_proiect_id, nume) VALUES (3, 'Redari C');
INSERT INTO public.grafic_activitati (licitatie_id, proiect_id, nume) VALUES (NULL, 1, 'Lansare A'), (NULL, 3, 'Lansare C'), (77, NULL, 'Licitatie fara proiect');
-- un rând deja clasificat (sursa rândurilor de probă ale harness-ului; „in_asteptare” ar porni clasificarea)
INSERT INTO public.ai_documente_inbox (fisier_path, fisier_nume, status, modul_tinta, entitate_id, uploadat_de) VALUES
  ('00000000-0000-4000-8000-000000000001/vechi.pdf', 'vechi.pdf', 'clasificat', 'executie', 1, '00000000-0000-4000-8000-000000000001');
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('executie-contracte', '1/docs_tehnice/a.pdf'), ('executie-contracte', '3/docs_tehnice/c.pdf'), ('executie-contracte', 'pccvi/3/c.pdf'),
  ('executie-borderouri', 'sl_1/1_borderou.xls'), ('executie-borderouri', 'sl_3/1_borderou.xls'),
  ('executie-pachete-pdf', '1/2026-11-01_ab_centralizator.xlsx'), ('executie-pachete-pdf', '3/2/aprobare/x.pdf'),
  ('documente-proiect', 'clona-a/2026/11/a.pdf'), ('documente-proiect', 'clona-c/2026/11/c.pdf');
