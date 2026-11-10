-- Schelet minim „tip Supabase” pentru proba LOCALĂ (PGlite, în memorie) a migrării 20261209a și a harness-ului scripts/test_executie_acces_proiect.sql.
-- NU e migrare și nu se rulează pe nicio bază reală. Peste el, runner-ul (scripts/pglite/test_executie_acces_proiect_local.mjs) aplică 20261201a
-- întreagă și creează funcțiile de drept din 20261203a / 20261204a / 20261208a EXACT cum sunt în migrările lor (amprentele se verifică).
-- Reproduce: rolurile (service_role cu BYPASSRLS), privilegiile implicite din schema public (ALL pentru anon / authenticated / service_role, ca la
-- Supabase), auth.uid() din cele două surse JWT, storage, tabelele vechi ale Execuției cu coloanele citite din cod (plus câte o coloană NOT NULL,
-- ca un INSERT „permis” să se oprească într-o constrângere, nu în gardă) și RLS-ul lor „autentificat” (auth.uid() IS NOT NULL, ca în matricea
-- de securitate din 30.09.2026). Date: profiluri sintetice (1 owner + 3), trei proiecte CLONA-A/B/C, câte o situație de plată și un bon pe proiect.
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
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.buckets, storage.objects TO anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, email text, is_owner boolean DEFAULT false);
CREATE TABLE public.user_module_access (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id),
  module text NOT NULL, access_level text NOT NULL, UNIQUE (profile_id, module));
CREATE TABLE public.executie_proiecte (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, cod_intern text, nume text, activ boolean DEFAULT true);
CREATE TABLE public.sites (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text, proiect_id bigint REFERENCES public.executie_proiecte(id));
CREATE TABLE public.profile_sites (profile_id uuid NOT NULL REFERENCES public.profiles(id), site_id integer NOT NULL REFERENCES public.sites(id),
  valid_until date, PRIMARY KEY (profile_id, site_id));

-- tabelele vechi ale Execuției (coloana de proiect + o coloană NOT NULL)
CREATE TABLE public.executie_tronsoane (id bigserial PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id) ON DELETE CASCADE, cod text NOT NULL);
CREATE TABLE public.executie_documente_contract (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), fisier text NOT NULL);
CREATE TABLE public.executie_acte_aditionale (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), nr text NOT NULL);
CREATE TABLE public.executie_ordine_sistare (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), data_sistare date NOT NULL);
CREATE TABLE public.executie_ordine_detectate (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id), tip text NOT NULL);
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
  tip text NOT NULL DEFAULT 'tronson', cod text, nume text NOT NULL, ordine integer DEFAULT 0, activ boolean DEFAULT true);
CREATE TABLE public.proiect_activitati (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  nume text NOT NULL, um text, activ boolean DEFAULT true);
CREATE TABLE public.proiect_articole (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  cod text NOT NULL, cantitate numeric);
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'user_module_access', 'executie_proiecte', 'sites', 'profile_sites',
                           'executie_tronsoane', 'executie_documente_contract', 'executie_acte_aditionale', 'executie_ordine_sistare',
                           'executie_ordine_detectate', 'executie_completari_propuse', 'executie_faze_determinante', 'executie_probe_presiune',
                           'executie_situatii_plata', 'executie_situatii_plata_linii', 'executie_sl_ajustari', 'executie_bonuri_consum',
                           'executie_bonuri_consum_linii', 'executie_alocari_personal', 'executie_ture', 'executie_tura_subcontractori',
                           'executie_tura_activitati', 'executie_tura_naveta', 'proiect_unitati', 'proiect_activitati', 'proiect_articole'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)', t || '_autentificat', t);
  END LOOP;
END $rls$;

-- vederile citite de Execuție (security_invoker, ca în producție pentru cele din repo) + una veche, „definer”, peste un tabel acoperit
CREATE VIEW public.v_executie_dashboard WITH (security_invoker = on) AS SELECT p.id, p.cod_intern, p.nume FROM public.executie_proiecte p;
CREATE VIEW public.v_executie_alocari WITH (security_invoker = on) AS SELECT a.id, a.proiect_id, a.employee_id FROM public.executie_alocari_personal a;
CREATE VIEW public.v_executie_alocari_conflicte WITH (security_invoker = on) AS SELECT a.id AS alocare_id FROM public.executie_alocari_personal a;
CREATE VIEW public.v_sl_fara_factura WITH (security_invoker = on) AS SELECT s.id, s.proiect_id FROM public.executie_situatii_plata s;
CREATE VIEW public.v_contract_efecte_acte WITH (security_invoker = on) AS SELECT a.proiect_id, count(*) AS n FROM public.executie_acte_aditionale a GROUP BY a.proiect_id;
CREATE VIEW public.v_ture_vechi AS SELECT t.id, t.proiect_id FROM public.executie_ture t;

-- date sintetice
INSERT INTO public.profiles (id, name, email, is_owner) VALUES
  ('00000000-0000-4000-8000-000000000001', 'OWNER TEST', 'owner@test.invalid', true),
  ('00000000-0000-4000-8000-000000000002', 'UNU TEST', 'unu@test.invalid', false),
  ('00000000-0000-4000-8000-000000000003', 'DOI TEST', 'doi@test.invalid', false),
  ('00000000-0000-4000-8000-000000000004', 'TREI TEST', 'trei@test.invalid', false);
INSERT INTO public.executie_proiecte (cod_intern, nume) VALUES ('CLONA-A', 'Proiect clona A'), ('CLONA-B', 'Proiect clona B'), ('CLONA-C', 'Proiect clona C');
INSERT INTO public.sites (name, proiect_id) VALUES ('Santier A', 1), ('Santier C', 3);
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
INSERT INTO public.executie_ordine_detectate (proiect_id, tip) VALUES (NULL, 'sistare'), (3, 'sistare');
