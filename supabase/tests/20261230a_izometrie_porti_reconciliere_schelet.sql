-- Schema FALSĂ pentru proba locală (PGlite) a migrării 20261230a_izometrie_porti_reconciliere. NU se rulează pe nicio bază reală.
-- Conține doar ce verifică poarta E2 (fn_izo_porti_lipsa) în afara funcțiilor ei: trigger-ele ENABLE ALWAYS, RLS, politicile RESTRICTIVE
-- pe magazie_bucati, rolul scriitor (fără LOGIN / INHERIT, membru doar postgres cu SET), drepturile lui, secvențele, plus tabelele / rolurile
-- citite de definițiile E2a / E3 / E3b / E4 / E4b. Funcțiile porților (corpurile REALE) le pune testul, extrase exact din migrări.
-- Starea = cea de la 20261120a (ștampilele puse, porțile verzi); „istoria” de după (20261209a / 20261211a / 20261218a / 20261118a-19a) o
-- reface testul, ca pe producție.
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE authenticator NOLOGIN;
CREATE ROLE izo_registru_writer NOLOGIN NOINHERIT; CREATE ROLE izo_doc_editor NOLOGIN NOINHERIT; CREATE ROLE izo_receptie_writer NOLOGIN NOINHERIT;
CREATE ROLE izo_cor_editor NOLOGIN NOINHERIT; CREATE ROLE izo_corectie_writer NOLOGIN NOINHERIT; CREATE ROLE izo_teren_editor NOLOGIN NOINHERIT;
CREATE ROLE izo_montaj_writer NOLOGIN NOINHERIT;
GRANT izo_registru_writer TO postgres WITH INHERIT FALSE, SET TRUE;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY, bucket_id text, name text, owner_id text, metadata jsonb);
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY; ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE SEQUENCE public.izo_server_ver_seq; CREATE SEQUENCE public.magazie_bucati_id_seq; CREATE SEQUENCE public.magazie_bucati_evenimente_id_seq;
CREATE SEQUENCE public.magazie_bucati_miscari_id_seq; CREATE SEQUENCE public.izo_importuri_id_seq; CREATE SEQUENCE public.izo_atribuiri_id_seq;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text);
CREATE TABLE public.executie_proiecte (id bigint PRIMARY KEY, site_id integer);
CREATE TABLE public.executie_tronsoane (id bigint PRIMARY KEY, proiect_id bigint);
CREATE TABLE public.executie_pachete_lansare (id bigint PRIMARY KEY, proiect_id bigint);
CREATE TABLE public.executie_pachete_documente (id bigint PRIMARY KEY, pachet_id bigint);
CREATE TABLE public.executie_tevi (id bigint PRIMARY KEY, pachet_id bigint);
CREATE TABLE public.executie_bonuri_consum_linii (id bigint PRIMARY KEY);
CREATE TABLE public.logistica_depozite (id integer PRIMARY KEY, site_id integer);
CREATE TABLE public.izo_tronson_config (tronson_id bigint PRIMARY KEY);
CREATE TABLE public.magazie_bucati (id bigint PRIMARY KEY DEFAULT nextval('public.magazie_bucati_id_seq'), stare text);
CREATE TABLE public.magazie_bucati_evenimente (id bigint PRIMARY KEY DEFAULT nextval('public.magazie_bucati_evenimente_id_seq'));
CREATE TABLE public.magazie_bucati_miscari (id bigint PRIMARY KEY DEFAULT nextval('public.magazie_bucati_miscari_id_seq'));
CREATE TABLE public.izo_importuri (id bigint PRIMARY KEY DEFAULT nextval('public.izo_importuri_id_seq'));
CREATE TABLE public.izo_atribuiri (id bigint PRIMARY KEY DEFAULT nextval('public.izo_atribuiri_id_seq'));
CREATE TABLE public.izo_proiect_config (proiect_id bigint PRIMARY KEY);
CREATE TABLE public.izo_documente_intrare (id bigint PRIMARY KEY); CREATE TABLE public.izo_documente_intrare_randuri (id bigint PRIMARY KEY);
CREATE TABLE public.izo_documente_scanuri (id bigint PRIMARY KEY); CREATE TABLE public.izo_documente_istoric (id bigint PRIMARY KEY);
CREATE TABLE public.izo_corectii (id bigint PRIMARY KEY); CREATE TABLE public.izo_corectii_bucati (id bigint PRIMARY KEY);
-- tabelele citite de handle_new_user (corpul din 20261119a declară %ROWTYPE pe portal_provisioning)
CREATE TABLE public.portal_provisioning (id uuid PRIMARY KEY, employee_id integer, stare text);

DO $rls$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['magazie_bucati','izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari',
                           'izo_documente_intrare','izo_documente_intrare_randuri','izo_documente_scanuri'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $rls$;
CREATE POLICY magbuc_izo_client_sel ON public.magazie_bucati AS RESTRICTIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY magbuc_izo_client_ins ON public.magazie_bucati AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY magbuc_izo_client_upd ON public.magazie_bucati AS RESTRICTIVE FOR UPDATE TO authenticated USING (true);
CREATE POLICY magbuc_izo_client_del ON public.magazie_bucati AS RESTRICTIVE FOR DELETE TO authenticated USING (true);

-- funcția comună a trigger-elor gărzii (în fixture): fn_izo_* = API-ul revizuit, în afara închiderii citirilor
CREATE FUNCTION public.fn_izo_fixture_garda() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$;
DO $trg$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM (VALUES ('magazie_bucati','trg_magbuc_izo_garda'), ('magazie_bucati','trg_magbuc_izo_truncate'),
      ('magazie_bucati_evenimente','trg_izo_ev_garda'), ('magazie_bucati_evenimente','trg_izo_ev_truncate'),
      ('magazie_bucati_miscari','trg_izo_mis_garda'), ('magazie_bucati_miscari','trg_izo_mis_truncate'),
      ('izo_importuri','trg_izo_imp_garda'), ('izo_importuri','trg_izo_imp_truncate'),
      ('izo_proiect_config','trg_izo_cfg_garda'), ('izo_proiect_config','trg_izo_cfg_truncate'),
      ('izo_atribuiri','trg_izo_atr_garda'), ('izo_atribuiri','trg_izo_atr_truncate'),
      ('executie_tevi','trg_executie_tevi_izo_delete'), ('executie_tevi','trg_executie_tevi_izo_mutare'),
      ('executie_pachete_lansare','trg_pachete_izo_delete'), ('executie_pachete_lansare','trg_pachete_izo_mutare'),
      ('executie_tronsoane','trg_tronsoane_izo_mutare'), ('logistica_depozite','trg_depozite_izo_mutare'),
      ('executie_proiecte','trg_proiecte_izo_site'),
      ('executie_tevi','trg_executie_tevi_izo_truncate'), ('executie_pachete_lansare','trg_pachete_izo_truncate'),
      ('executie_bonuri_consum_linii','trg_bon_linii_izo_bucata')) v(t, g) LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.fn_izo_fixture_garda()', r.g, r.t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I', r.t, r.g);
  END LOOP;
END $trg$;

-- drepturile scriitorului (exact cele cerute de poartă)
GRANT SELECT, INSERT, UPDATE ON public.magazie_bucati TO izo_registru_writer;
GRANT SELECT, INSERT ON public.magazie_bucati_evenimente, public.magazie_bucati_miscari TO izo_registru_writer;
GRANT SELECT, INSERT, UPDATE ON public.izo_importuri, public.izo_proiect_config TO izo_registru_writer;
GRANT SELECT ON public.izo_atribuiri TO izo_registru_writer;
GRANT USAGE ON SEQUENCE public.izo_server_ver_seq, public.magazie_bucati_id_seq, public.magazie_bucati_evenimente_id_seq,
  public.magazie_bucati_miscari_id_seq, public.izo_importuri_id_seq TO izo_registru_writer;
-- starea de la 20261120a: anon încă avea drepturi pe secvența comună (retrase de 20261218a)
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.magazie_bucati_id_seq TO anon;

-- mutatorul de cale (pe prod: lanțul fn_conturi_inchideri_sweep → … → fn_cont_leaga_la_creare): corp cu set_config
CREATE FUNCTION public.fn_cont_leaga_la_creare(p_profile_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $fn$ BEGIN PERFORM set_config('gazpet.fixture', 'x', true); RETURN NULL; END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_leaga_la_creare(uuid) FROM PUBLIC;
