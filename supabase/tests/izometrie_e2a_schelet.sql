-- Schelet minim (NU se aplică pe producție) pentru scripts/test_izometrie_e2a.sh — doar într-o bază locală *_test.
-- Reproduce ce citește/atinge 20261102a de pe live (inventar 20.10.2026, docs/izometrie/INVENTAR_SCHEMA_E1.md):
--   rolurile Supabase (anon/authenticated/authenticator/service_role) + default privileges ale lui postgres
--   (tabele: anon/authenticated arwdxt, service_role tot; secvențe: rwU) — exact ca pe live;
--   magazie_bucati cu coloanele, CHECK-urile și politicile live (SELECT true, I/U/D auth.uid() IS NOT NULL);
--   executie_proiecte (1 = LOT 1 site 4, 3 = LOT 2 site 6), executie_tronsoane (1–11 LOT 1, 16–23 LOT 2),
--   logistica_depozite (1, 2 site 4; 4 site 9 = proiectul 2; 9, 10, 11 site 6), magazie_tipuri_material, pachete/țevi, bonuri;
--   auth.uid() din request.jwt.claims; supabase_migrations.schema_migrations pentru runner; helpers în schema teste.
-- Diferență față de live, asumată: aici postgres e SUPERUSER (în Supabase nu e) — primitivele CREATE ROLE /
--   ALTER OWNER / pg_auth_members se dovedesc DOAR pe branch-ul Supabase (§6.1 p10), nu aici.
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOLOGIN NOINHERIT; END IF;
END $roluri$;
GRANT anon, authenticated, service_role TO authenticator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- ── oameni și acces ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean NOT NULL DEFAULT false, can_manage_stoc boolean NOT NULL DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_sel ON public.profiles FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
INSERT INTO public.profiles (id, name, is_owner, can_manage_stoc) VALUES
  ('00000000-0000-0000-0000-000000000121', 'TRUSU RAZVAN', true, true),
  ('00000000-0000-0000-0000-000000000030', 'CIOC JANETA', false, true),
  ('00000000-0000-0000-0000-000000000117', 'TOMA RAZVAN ALIN', false, false),
  ('00000000-0000-0000-0000-000000000115', 'TITI JENO', false, false),
  ('00000000-0000-0000-0000-0000000000f0', 'FARA ACCES', false, false);
CREATE TABLE public.user_module_access (id bigserial PRIMARY KEY, profile_id uuid NOT NULL, module text NOT NULL, access_level text NOT NULL);
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY uma_sel ON public.user_module_access FOR SELECT TO authenticated USING (profile_id = auth.uid());
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('00000000-0000-0000-0000-000000000030', 'magazie', 'editor'),
  ('00000000-0000-0000-0000-000000000117', 'executie', 'editor'),
  ('00000000-0000-0000-0000-000000000115', 'executie', 'viewer');

-- ── proiecte, tronsoane, depozite, tipuri ──────────────────────────────────────────────────────────────
CREATE TABLE public.executie_proiecte (id bigserial PRIMARY KEY, nume text, site_id integer, mp_employee_id bigint, coordonator_transgaz text);
ALTER TABLE public.executie_proiecte ENABLE ROW LEVEL SECURITY;
CREATE POLICY ep_all ON public.executie_proiecte FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
INSERT INTO public.executie_proiecte (id, nume, site_id) VALUES (1, 'LOT 1', 4), (2, 'ALT PROIECT', 9), (3, 'LOT 2', 6);
CREATE TABLE public.executie_tronsoane (id bigserial PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id) ON DELETE CASCADE,
  cod text NOT NULL, km_start_m integer, km_end_m integer, UNIQUE (proiect_id, cod));
ALTER TABLE public.executie_tronsoane ENABLE ROW LEVEL SECURITY;
CREATE POLICY et_sel ON public.executie_tronsoane FOR SELECT TO authenticated USING (true);
CREATE POLICY et_mod ON public.executie_tronsoane FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
INSERT INTO public.executie_tronsoane (id, proiect_id, cod) SELECT g, 1, 'T' || g FROM generate_series(1, 11) g;
INSERT INTO public.executie_tronsoane (id, proiect_id, cod) SELECT g, 3, 'T' || (g - 4) FROM generate_series(16, 23) g;
CREATE TABLE public.logistica_depozite (id serial PRIMARY KEY, name text NOT NULL, cod_3litere text UNIQUE, site_id integer, adresa text, activ boolean DEFAULT true);
ALTER TABLE public.logistica_depozite ENABLE ROW LEVEL SECURITY;
CREATE POLICY depozite_all ON public.logistica_depozite FOR ALL TO authenticated USING (auth.uid() IS NOT NULL);
INSERT INTO public.logistica_depozite (id, name, cod_3litere, site_id) VALUES
  (1, 'Balvanești', 'BAL', 4), (2, 'Sisești', 'SIS', 4), (7, 'Sediu Ploiești', 'SED', 1),
  (4, 'Căldăraru', 'CAL', 9), (9, 'DM Jupânești', 'JUP', 6), (10, 'DM Orșova Nord', 'ORN', 6), (11, 'OS Topleț', 'TOP', 6), (12, 'Rezervă Topleț', 'REZ', 6);
CREATE TABLE public.magazie_tipuri_material (id serial PRIMARY KEY, nume text NOT NULL, categorie text, cheie text, activ boolean DEFAULT true);
ALTER TABLE public.magazie_tipuri_material ENABLE ROW LEVEL SECURITY;
CREATE POLICY mtm_sel ON public.magazie_tipuri_material FOR SELECT TO authenticated USING (true);
INSERT INTO public.magazie_tipuri_material (id, nume, categorie, cheie) VALUES
  (1, 'Țeavă conductă', 'teava', 'teava'), (2, 'Tub de protecție', 'teava', 'tub_protectie'), (3, 'Curbă', 'fiting', 'curba'),
  (11, 'Robinet', 'armatura', 'robinet'), (16, 'Produs finit producție', 'fiting', 'produs_productie');

-- ── magazie_bucati exact ca pe live (coloane, default-uri, CHECK-uri, FK, indexuri, politici) ─────────
CREATE TABLE public.executie_pachete_lansare (id bigserial PRIMARY KEY, proiect_id bigint, tronson_id bigint REFERENCES public.executie_tronsoane(id), km_start_m integer);
CREATE TABLE public.executie_tevi (id bigserial PRIMARY KEY, pachet_id bigint REFERENCES public.executie_pachete_lansare(id) ON DELETE CASCADE,
  serie_unica text, lungime_m numeric);
CREATE TABLE public.comenzi_furnizor (id bigserial PRIMARY KEY);
CREATE TABLE public.magazie_bucati (
  id bigserial PRIMARY KEY,
  proiect_id bigint REFERENCES public.executie_proiecte(id),
  comanda_furnizor_id bigint REFERENCES public.comenzi_furnizor(id),
  tip_material_id integer NOT NULL REFERENCES public.magazie_tipuri_material(id),
  serie text, sarja text, dimensiune text, grad_otel text, standard text,
  lungime_m numeric, lungime_originala_m numeric, greutate_kg numeric, unghi_curba numeric,
  cantitate numeric NOT NULL DEFAULT 1, um text NOT NULL DEFAULT 'buc',
  provenienta text NOT NULL DEFAULT 'gazpet' CONSTRAINT magazie_bucati_provenienta_check CHECK (provenienta = ANY (ARRAY['beneficiar'::text, 'gazpet'::text])),
  izolatie text DEFAULT 'neizolata' CONSTRAINT magazie_bucati_izolatie_check CHECK (izolatie = ANY (ARRAY['neizolata'::text, 'PEHD'::text, 'GRP'::text])),
  furnizor text, producator text,
  sursa_receptie text NOT NULL DEFAULT 'packing_list' CONSTRAINT magazie_bucati_sursa_receptie_check CHECK (sursa_receptie = ANY (ARRAY['packing_list'::text, 'aviz'::text, 'mtc'::text, 'manual'::text])),
  fara_packing_list boolean NOT NULL DEFAULT false, nr_document text, data_receptie date, mtc_path text,
  stare text NOT NULL DEFAULT 'sosit' CONSTRAINT magazie_bucati_stare_check CHECK (stare = ANY (ARRAY['sosit'::text, 'receptionat'::text, 'rezervata'::text, 'montata'::text, 'consumata'::text, 'retur'::text])),
  locatie_tip text DEFAULT 'sediu' CONSTRAINT magazie_bucati_locatie_tip_check CHECK (locatie_tip = ANY (ARRAY['sediu'::text, 'proiect'::text])),
  locatie_site_id integer,
  executie_teava_id bigint REFERENCES public.executie_tevi(id),
  atribute jsonb, observatii text, receptionat_de uuid, receptionat_la timestamptz, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_magbuc_proiect ON public.magazie_bucati (proiect_id);
CREATE INDEX idx_magbuc_stare ON public.magazie_bucati (stare);
CREATE INDEX idx_magbuc_serie ON public.magazie_bucati (serie);
ALTER TABLE public.magazie_bucati ENABLE ROW LEVEL SECURITY;
CREATE POLICY magbuc_sel ON public.magazie_bucati FOR SELECT TO authenticated USING (true);
CREATE POLICY magbuc_ins ON public.magazie_bucati FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY magbuc_upd ON public.magazie_bucati FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY magbuc_del ON public.magazie_bucati FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
-- câteva rânduri gazpet ca pe live (18 rânduri, toate sosit) + unul beneficiar pe LOT 1 (recepția de azi, nivel off)
INSERT INTO public.magazie_bucati (proiect_id, tip_material_id, serie, sarja, lungime_m, provenienta, stare, locatie_tip)
SELECT p, 1, 'GZP' || g, 'S' || g, 12, 'gazpet', 'sosit', 'sediu' FROM generate_series(1, 18) g, LATERAL (SELECT (ARRAY[1,3,2])[1 + g % 3] AS p) x;
INSERT INTO public.magazie_bucati (proiect_id, tip_material_id, serie, sarja, lungime_m, provenienta, stare, locatie_tip)
VALUES (1, 1, '254CA00001', 'SA00001', 12.4, 'beneficiar', 'sosit', 'proiect');

INSERT INTO public.executie_pachete_lansare (id, proiect_id, tronson_id) VALUES (1, 1, 8), (2, 3, 18);
SELECT setval('public.executie_pachete_lansare_id_seq', 100);
INSERT INTO public.executie_tevi (pachet_id, serie_unica, lungime_m) VALUES (1, 'X1', 12), (1, 'X2', 12), (2, 'Y1', 12);
ALTER TABLE public.executie_tevi ENABLE ROW LEVEL SECURITY;
CREATE POLICY executie_tevi_select ON public.executie_tevi FOR SELECT TO authenticated USING (true);
CREATE POLICY executie_tevi_modify ON public.executie_tevi FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
ALTER TABLE public.executie_pachete_lansare ENABLE ROW LEVEL SECURITY;
CREATE POLICY epl_all ON public.executie_pachete_lansare FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.executie_bonuri_consum (id bigserial PRIMARY KEY, proiect_id bigint, provenienta text);
CREATE TABLE public.executie_bonuri_consum_linii (id bigserial PRIMARY KEY, bon_id bigint REFERENCES public.executie_bonuri_consum(id) ON DELETE CASCADE,
  magazie_bucata_id bigint REFERENCES public.magazie_bucati(id), denumire text, cantitate numeric);
ALTER TABLE public.executie_bonuri_consum ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_bonuri_consum_linii ENABLE ROW LEVEL SECURITY;
CREATE POLICY ebc_all ON public.executie_bonuri_consum FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY ebcl_all ON public.executie_bonuri_consum_linii FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
INSERT INTO public.executie_bonuri_consum (id, proiect_id, provenienta) VALUES (1, 3, 'beneficiar'), (2, 1, 'beneficiar');

CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);

-- helpers de test (schema teste; invoker — rulează cu rolul curent)
CREATE SCHEMA teste;
GRANT USAGE ON SCHEMA teste TO anon, authenticated, service_role;
CREATE FUNCTION teste.ca(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  SET ROLE authenticated;
END $$;
CREATE FUNCTION teste.eroare(p_eticheta text, p_sql text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF p_fragment IS NOT NULL AND position(lower(p_fragment) IN lower(SQLERRM)) = 0 THEN
      RAISE EXCEPTION 'TEST % : eroare diferita: % (asteptat: %)', p_eticheta, SQLERRM, p_fragment;
    END IF;
    RAISE NOTICE 'OK   %', p_eticheta;
    RETURN;
  END;
  RAISE EXCEPTION 'TEST % : a trecut, asteptam eroare (%)', p_eticheta, p_fragment;
END $$;
CREATE FUNCTION teste.e(p_eticheta text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'TEST % : esuat', p_eticheta; END IF;
  RAISE NOTICE 'OK   %', p_eticheta;
END $$;
CREATE FUNCTION teste.n(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  EXECUTE p_sql; GET DIAGNOSTICS v = ROW_COUNT; RETURN v;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO anon, authenticated, service_role;
