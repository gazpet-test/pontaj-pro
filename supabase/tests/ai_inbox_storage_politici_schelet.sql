-- Schelet minim (NU se aplică pe producție) pentru scripts/test_ai_inbox_storage_politici.sh — doar într-o bază locală *_test.
-- Reproduce ce atinge 20261103c (structura din producție citită read-only pe 21.10.2026):
--   * rolurile Supabase (anon / authenticated / service_role BYPASSRLS / supabase_storage_admin = proprietarul tabelelor
--     storage, ca în producție) + default privileges;
--   * auth.uid() din request.jwt.claims (cum îl setează PostgREST / storage-api);
--   * storage.buckets (id, name, public, versioning_status, …) și storage.objects (coloanele folosite: bucket_id, name, owner,
--     owner_id text, metadata, version / is_versioned / is_delete_marker / archived_at), RLS activ, GRANT ALL pentru cele trei
--     roluri (ca live), unic pe (bucket_id, name); storage.foldername() = textul live (plpgsql IMMUTABLE);
--   * politicile live relevante pe storage.objects: ai_inbox_obj_all (FOR ALL TO authenticated, doar bucket_id — gaura),
--     tts_audio_inchis (RESTRICTIVE, ca live) și două politici ale altor bucket-uri în formele live („(bucket_id = 'x'::text)”
--     și „((bucket_id = 'x'::text) AND (EXISTS …))”), ca precondiția „celelalte politici sunt legate de alt bucket” să fie
--     verificată pe forme reale; plus politicile storage ale E3 (20261103b, aplicată ÎNAINTE — ordinea convenită; permisive +
--     RESTRICTIVE pe izo-documente, verbatim) și bucket-ul izo-documente; trigger-ul storage protect_objects_delete NU e reprodus (îl ocolește storage-api cu
--     storage.allow_delete_query; nu ține de RLS);
--   * public.profiles (id, role, is_owner, can_access_personal_data, can_access_financiar), executie_proiecte / profile_sites
--     (pentru ramura „executie”) și fn_ai_inbox_poate_confirma(text, bigint) = TEXTUL LIVE (SECURITY DEFINER);
--   * public.ai_documente_inbox cu coloanele live și cele 4 politici live verbatim (ai_inbox_select / insert / update / delete),
--     trigger-ul BEFORE UPDATE tg_ai_inbox_touch (live); trg_ai_inbox_dedup (BEFORE INSERT, anti-dublură 10 min) și
--     trg_ai_inbox_clasificare (AFTER INSERT → pg_net → edge) NU sunt reproduse (nu țin de storage; pg_net nu există local);
--     nici CHECK-ul ai_inbox_modul_chk (live: doar executie / hr / logistica / financiar — rândul fictiv 609 „upa” n-ar trece live;
--     politicile nu depind de valoare). Rândurile falsificate de testat le refuză trg_ai_inbox_fisier_legat, creat de migrare.
-- Date FICTIVE. Profiluri: a1 = urcă (fără drepturi), a2 = HR (can_access_personal_data), a3 = owner, a4 = fără drepturi,
-- a5 = admin_logistica, a6 = MP pe șantierul 3 (proiectul 5), a7 = financiar; a8 = cont fără rând în profiles.
-- Obiecte în ai-documente-inbox (owner = owner_id = cine a urcat):
--   O1 a1/1_ci.pdf — rândul 601 hr · O2 a1/2_nedecis.pdf — 602 modul NULL (în așteptare) · O3 a1/3_rca.pdf — 603 logistica
--   O4 a1/4_contract.pdf — 604 executie, proiect 5 · O5 a1/5_cert.pdf — 605 financiar · O6 a1/6_orfan.pdf — FĂRĂ rând
--   O7 a2/7_hr.pdf — 607 hr (urcat de HR) · O8 wizard-angajare/1_abc/CI.pdf — 608 hr (wizard „Angajat nou”, urcat de HR)
--   O9 a1/9_upa.pdf — 609 upa · O10 a1/10_exec.pdf — 610 executie fără proiect
-- + un obiect în alt bucket (documente-personal) — nu intră în numărătorile bucket-ului inbox.
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_storage_admin') THEN CREATE ROLE supabase_storage_admin NOLOGIN NOINHERIT; END IF;
END $roluri$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- ── storage (proprietar supabase_storage_admin, ca live) ─────────────────────────────────────────────────────────
CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[], versioning_status text DEFAULT 'DISABLED');
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
  name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  version text, is_versioned boolean NOT NULL DEFAULT false, is_delete_marker boolean NOT NULL DEFAULT false, archived_at timestamptz);
CREATE UNIQUE INDEX objects_bucket_name_unic ON storage.objects (bucket_id, name);
ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.objects TO anon, authenticated, service_role;
GRANT ALL ON storage.buckets TO anon, authenticated, service_role;
CREATE FUNCTION storage.foldername(name text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$function$;
ALTER FUNCTION storage.foldername(text) OWNER TO supabase_storage_admin;

-- ── public: profiluri, proiecte, funcția de drept (text live) ───────────────────────────────────────────────────
CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, role text, is_owner boolean DEFAULT false,
  can_access_personal_data boolean DEFAULT false, can_access_financiar boolean DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE TABLE public.executie_proiecte (id bigint PRIMARY KEY, site_id bigint);
CREATE TABLE public.profile_sites (profile_id uuid, site_id bigint, valid_until date);

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

-- ── coada ai_documente_inbox: coloanele live, politicile live verbatim ───────────────────────────────────────────
CREATE TABLE public.ai_documente_inbox (
  id bigserial PRIMARY KEY, fisier_path text NOT NULL, fisier_nume text NOT NULL, fisier_size_bytes bigint, fisier_mime text,
  status text NOT NULL DEFAULT 'in_asteptare', modul_tinta text, tip_document text, payload_ai jsonb, entitate_tip text,
  entitate_id bigint, entitate_match_confidence smallint, clasificare_confidence smallint, destinatie_tabel text, ai_eroare text,
  redirectionat_din_modul text, confirmat_de uuid, confirmat_la timestamptz, confirmat_ref_id bigint, respins_motiv text,
  uploadat_de uuid NOT NULL, uploadat_la timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  fisier_sters_la timestamptz);
CREATE FUNCTION public.tg_ai_inbox_touch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END $function$;
CREATE TRIGGER trg_ai_inbox_touch BEFORE UPDATE ON public.ai_documente_inbox FOR EACH ROW EXECUTE FUNCTION public.tg_ai_inbox_touch();
ALTER TABLE public.ai_documente_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_inbox_delete ON public.ai_documente_inbox FOR DELETE TO authenticated
  USING (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true))));
CREATE POLICY ai_inbox_insert ON public.ai_documente_inbox FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() IS NOT NULL) AND (uploadat_de = auth.uid())));
CREATE POLICY ai_inbox_select ON public.ai_documente_inbox FOR SELECT TO authenticated
  USING (((uploadat_de = auth.uid()) OR (modul_tinta IS NULL) OR fn_ai_inbox_poate_confirma(modul_tinta, entitate_id)));
CREATE POLICY ai_inbox_update ON public.ai_documente_inbox FOR UPDATE TO authenticated
  USING (((modul_tinta IS NULL) OR fn_ai_inbox_poate_confirma(modul_tinta, entitate_id) OR (uploadat_de = auth.uid())))
  WITH CHECK ((auth.uid() IS NOT NULL));

-- ── politicile storage live (gaura + vecinii) ───────────────────────────────────────────────────────────────────
CREATE POLICY ai_inbox_obj_all ON storage.objects AS PERMISSIVE FOR ALL TO authenticated
  USING ((bucket_id = 'ai-documente-inbox'::text)) WITH CHECK ((bucket_id = 'ai-documente-inbox'::text));
CREATE POLICY tts_audio_inchis ON storage.objects AS RESTRICTIVE FOR ALL TO public
  USING ((bucket_id IS DISTINCT FROM 'tts-audio'::text)) WITH CHECK ((bucket_id IS DISTINCT FROM 'tts-audio'::text));
CREATE POLICY documente_personal_select ON storage.objects FOR SELECT TO authenticated
  USING (((bucket_id = 'documente-personal'::text) AND (EXISTS ( SELECT 1 FROM profiles p
     WHERE ((p.id = auth.uid()) AND ((p.can_access_personal_data = true) OR (p.is_owner = true)))))));
CREATE POLICY templates_select ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = 'templates'::text));

-- ── E3 (20261103b, Izometrie) aplicată ÎNAINTE — ordinea convenită: politicile storage ale E3 verbatim (branch izometrie/e3,
--    secțiunea K), cu funcțiile fn_izo_scan_poate_* ca stub (false; pe bucket-ul cozii nu se ajunge la ele: OR-ul se oprește la
--    bucket_id IS DISTINCT FROM 'izo-documente'). Așa precondiția 20261103c și toată suita rulează pe un catalog post-E3.
CREATE FUNCTION public.fn_izo_scan_poate_incarca(p_name text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.fn_izo_scan_poate_citi(p_name text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.fn_izo_scan_poate_sterge(p_name text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
REVOKE EXECUTE ON FUNCTION public.fn_izo_scan_poate_incarca(text), public.fn_izo_scan_poate_citi(text), public.fn_izo_scan_poate_sterge(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_izo_scan_poate_incarca(text), public.fn_izo_scan_poate_citi(text), public.fn_izo_scan_poate_sterge(text) TO authenticated;
CREATE POLICY izo_doc_scan_ins ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'izo-documente' AND public.fn_izo_scan_poate_incarca(name));
CREATE POLICY izo_doc_scan_sel ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'izo-documente' AND public.fn_izo_scan_poate_citi(name));
CREATE POLICY izo_doc_scan_del ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'izo-documente' AND public.fn_izo_scan_poate_sterge(name));
CREATE POLICY izo_doc_scan_r_toti ON storage.objects AS RESTRICTIVE FOR ALL TO public
  USING (bucket_id IS DISTINCT FROM 'izo-documente' OR pg_has_role(current_user, 'authenticated', 'USAGE'))
  WITH CHECK (bucket_id IS DISTINCT FROM 'izo-documente' OR pg_has_role(current_user, 'authenticated', 'USAGE'));
CREATE POLICY izo_doc_scan_r_sel ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id IS DISTINCT FROM 'izo-documente' OR public.fn_izo_scan_poate_citi(name));
CREATE POLICY izo_doc_scan_r_ins ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id IS DISTINCT FROM 'izo-documente' OR public.fn_izo_scan_poate_incarca(name));
CREATE POLICY izo_doc_scan_r_del ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id IS DISTINCT FROM 'izo-documente' OR public.fn_izo_scan_poate_sterge(name));
CREATE POLICY izo_doc_scan_r_upd ON storage.objects AS RESTRICTIVE FOR UPDATE TO public
  USING (bucket_id IS DISTINCT FROM 'izo-documente') WITH CHECK (bucket_id IS DISTINCT FROM 'izo-documente');
CREATE POLICY izo_doc_bucket_r_ins ON storage.buckets AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (id IS DISTINCT FROM 'izo-documente');
CREATE POLICY izo_doc_bucket_r_upd ON storage.buckets AS RESTRICTIVE FOR UPDATE TO public
  USING (id IS DISTINCT FROM 'izo-documente') WITH CHECK (id IS DISTINCT FROM 'izo-documente');
CREATE POLICY izo_doc_bucket_r_del ON storage.buckets AS RESTRICTIVE FOR DELETE TO public
  USING (id IS DISTINCT FROM 'izo-documente');

-- ── date fictive ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('ai-documente-inbox', 'ai-documente-inbox', false, 20971520, ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/heic']),
  ('documente-personal', 'documente-personal', false, NULL, NULL), ('templates', 'templates', false, NULL, NULL),
  ('tts-audio', 'tts-audio', false, NULL, NULL), ('izo-documente', 'izo-documente', false, 10485760, ARRAY['application/pdf']);
INSERT INTO public.profiles (id, name, role, is_owner, can_access_personal_data, can_access_financiar) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Urcă (fictiv)', 'user', false, false, false),
  ('00000000-0000-0000-0000-0000000000a2', 'HR (fictiv)', 'user', false, true, false),
  ('00000000-0000-0000-0000-0000000000a3', 'Owner (fictiv)', 'user', true, false, false),
  ('00000000-0000-0000-0000-0000000000a4', 'Fără drept (fictiv)', 'user', false, false, false),
  ('00000000-0000-0000-0000-0000000000a5', 'Logistică (fictiv)', 'admin_logistica', false, false, false),
  ('00000000-0000-0000-0000-0000000000a6', 'MP șantier 3 (fictiv)', 'user', false, false, false),
  ('00000000-0000-0000-0000-0000000000a7', 'Financiar (fictiv)', 'user', false, false, true);
INSERT INTO public.executie_proiecte (id, site_id) VALUES (5, 3), (6, 4);
INSERT INTO public.profile_sites (profile_id, site_id, valid_until) VALUES ('00000000-0000-0000-0000-0000000000a6', 3, NULL);
INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
  ('ai-documente-inbox', '00000000-0000-0000-0000-0000000000a1/1_ci.pdf',        '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('ai-documente-inbox', '00000000-0000-0000-0000-0000000000a1/2_nedecis.pdf',   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('ai-documente-inbox', '00000000-0000-0000-0000-0000000000a1/3_rca.pdf',       '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('ai-documente-inbox', '00000000-0000-0000-0000-0000000000a1/4_contract.pdf',  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('ai-documente-inbox', '00000000-0000-0000-0000-0000000000a1/5_cert.pdf',      '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('ai-documente-inbox', '00000000-0000-0000-0000-0000000000a1/6_orfan.pdf',     '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('ai-documente-inbox', '00000000-0000-0000-0000-0000000000a2/7_hr.pdf',        '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2'),
  ('ai-documente-inbox', 'wizard-angajare/1_abc/CI.pdf',                         '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2'),
  ('ai-documente-inbox', '00000000-0000-0000-0000-0000000000a1/9_upa.pdf',       '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('ai-documente-inbox', '00000000-0000-0000-0000-0000000000a1/10_exec.pdf',     '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('documente-personal', '7/aidoc_1.pdf',                                        '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2');
INSERT INTO public.ai_documente_inbox (id, fisier_path, fisier_nume, fisier_size_bytes, fisier_mime, status, modul_tinta, entitate_id, uploadat_de) VALUES
  (601, '00000000-0000-0000-0000-0000000000a1/1_ci.pdf', 'CI.pdf', 1234, 'application/pdf', 'clasificat', 'hr', NULL, '00000000-0000-0000-0000-0000000000a1'),
  (602, '00000000-0000-0000-0000-0000000000a1/2_nedecis.pdf', 'nedecis.pdf', 11, 'application/pdf', 'in_asteptare', NULL, NULL, '00000000-0000-0000-0000-0000000000a1'),
  (603, '00000000-0000-0000-0000-0000000000a1/3_rca.pdf', 'RCA.pdf', 22, 'application/pdf', 'clasificat', 'logistica', NULL, '00000000-0000-0000-0000-0000000000a1'),
  (604, '00000000-0000-0000-0000-0000000000a1/4_contract.pdf', 'contract.pdf', 33, 'application/pdf', 'clasificat', 'executie', 5, '00000000-0000-0000-0000-0000000000a1'),
  (605, '00000000-0000-0000-0000-0000000000a1/5_cert.pdf', 'cert.pdf', 44, 'application/pdf', 'clasificat', 'financiar', NULL, '00000000-0000-0000-0000-0000000000a1'),
  (607, '00000000-0000-0000-0000-0000000000a2/7_hr.pdf', 'cazier.pdf', 55, 'application/pdf', 'clasificat', 'hr', NULL, '00000000-0000-0000-0000-0000000000a2'),
  (608, 'wizard-angajare/1_abc/CI.pdf', 'CI.pdf', 66, 'application/pdf', 'clasificat', 'hr', NULL, '00000000-0000-0000-0000-0000000000a2'),
  (609, '00000000-0000-0000-0000-0000000000a1/9_upa.pdf', 'factura.pdf', 77, 'application/pdf', 'clasificat', 'upa', NULL, '00000000-0000-0000-0000-0000000000a1'),
  (610, '00000000-0000-0000-0000-0000000000a1/10_exec.pdf', 'oi.pdf', 88, 'application/pdf', 'eroare', 'executie', NULL, '00000000-0000-0000-0000-0000000000a1');
SELECT setval('public.ai_documente_inbox_id_seq', 1000);
