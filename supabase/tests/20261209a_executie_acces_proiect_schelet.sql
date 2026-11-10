-- Schelet minim „tip Supabase” pentru proba LOCALĂ (PGlite, în memorie) a migrării 20261209a și a harness-ului scripts/test_executie_acces_proiect.sql.
-- NU e migrare și nu se rulează pe nicio bază reală. Peste el, runner-ul (scripts/pglite/test_executie_acces_proiect_local.mjs) aplică 20261201a
-- și 20261028a întregi și creează funcțiile din 20261203a / 20261204a / 20261208a EXACT cum sunt în migrările lor (amprentele se verifică).
-- Reproduce: rolurile (service_role cu BYPASSRLS), privilegiile implicite din schema public (ALL pentru anon / authenticated / service_role, ca la
-- Supabase), auth.uid() din cele două surse JWT, storage (cu o politică „autentificat” pe bucket-urile de test, ca accesul de azi), tabelele
-- vechi ale Execuției cu coloanele citite din cod și din migrări (plus câte o coloană NOT NULL) și RLS-ul lor „autentificat” (auth.uid() IS NOT
-- NULL, ca în matricea de securitate din 30.09.2026), câteva tabele ale modulelor excluse (Izometrie, HR, Achiziții, Magazie, Redări) legate de
-- proiecte. Date: profiluri sintetice (1 owner + 3), trei proiecte CLONA-A/B/C, rânduri pe fiecare tabel acoperit.
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
CREATE FUNCTION public.fn_is_app_owner(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p AND is_owner IS TRUE)
$f$;
CREATE TABLE public.executie_proiecte (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, cod_intern text, nume text, activ boolean DEFAULT true, eticheta_gmail text);
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
CREATE TABLE public.executie_tevi (id bigserial PRIMARY KEY, pachet_id bigint REFERENCES public.executie_pachete_lansare(id), serie_unica text NOT NULL);
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
INSERT INTO public.executie_tevi (pachet_id, serie_unica) VALUES (1, 'T-A1'), (2, 'T-C1');
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
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('executie-contracte', '1/docs_tehnice/a.pdf'), ('executie-contracte', '3/docs_tehnice/c.pdf'), ('executie-contracte', 'pccvi/3/c.pdf'),
  ('executie-borderouri', 'sl_1/1_borderou.xls'), ('executie-borderouri', 'sl_3/1_borderou.xls'),
  ('executie-pachete-pdf', '1/2026-11-01_ab_centralizator.xlsx'), ('executie-pachete-pdf', '3/2/aprobare/x.pdf'),
  ('documente-proiect', 'clona-a/2026/11/a.pdf'), ('documente-proiect', 'clona-c/2026/11/c.pdf');
