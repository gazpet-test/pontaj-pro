-- Schelet LOCAL (PGlite / PG de unică folosință) pentru 20261226a (Redări: declarația „predare” + opțiunea retrasă). NU se rulează pe producție.
-- Reproduce DOAR ce atinge / citește migrarea: rolurile Supabase (service_role BYPASSRLS), privilegiile implicite periculoase (ALL / EXECUTE pe
-- obiecte noi: migrarea trebuie să le scoată), auth.uid() / auth.jwt() / auth.role() (textul live, din 20261130j_redari_mail_f1_schelet.sql),
-- profiles + user_module_access, tabelele Redări folosite (coloanele de pe live, din migrările 20261126a / 27a / 28a / 30j / 30m / 31c), triggerele,
-- politicile și drepturile lor. Corpurile funcțiilor NU sunt aici: testul (scripts/pglite/test_redari_predare_declaratie_local.mjs) le extrage EXACT
-- din migrările lor și le pune în locul marcajului „@@FUNCTII@@” (amprentele = constantele din 20261226a, verificat de test).
DO $r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
END $r$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$function$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$function$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$function$;
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, name text, is_owner boolean NOT NULL DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.user_module_access (
  id serial PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id), module text NOT NULL,
  access_level text NOT NULL CHECK (access_level IN ('admin', 'editor', 'viewer')), UNIQUE (profile_id, module));
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.fn_sms_e_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT coalesce((SELECT p.is_owner FROM public.profiles p WHERE p.id = auth.uid()), false)
$f$;
-- @@FUNCTII@@
-- ---------------------------------------------------------------- tabelele (coloanele de pe live)
CREATE TABLE public.red_proiecte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cod text NOT NULL UNIQUE CHECK (btrim(cod) <> ''),
  denumire text, beneficiar text, contract_nr text, contract_data date, imputernicire_nr text, imputernicire_data date,
  reprezentant_tgz_nume text, reprezentant_tgz_functie text, reprezentant_tgz_telefon text, reprezentant_gazpet_nume text, reprezentant_gazpet_functie text,
  contact_nume text, contact_telefon text,
  contact_email text DEFAULT 'redari@gazpet.ro',
  text_gdpr text NOT NULL DEFAULT 'Text GDPR (schelet).',
  text_declaratie text NOT NULL DEFAULT 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.',
  activ boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  apm_nume text, versiune int NOT NULL DEFAULT 1 CONSTRAINT red_proiecte_versiune_poz CHECK (versiune >= 1),
  executie_proiect_id bigint, link_informare_gdpr text, retentie_mail_pana date,
  autorizare_tgz_nr text, autorizare_tgz_data date, autorizare_tgz_fisier text, autorizare_tgz_obiect uuid, autorizare_tgz_etag text,
  autorizare_tgz_de uuid, autorizare_tgz_la timestamptz,
  convocare_utilizatori_aprobata boolean NOT NULL DEFAULT false, convocare_utilizatori_aprobata_de uuid, convocare_utilizatori_aprobata_la timestamptz
);
CREATE TABLE public.red_uat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id), nume text NOT NULL, uat3 text NOT NULL,
  sesiune_zi1 date, sesiune_zi2 date, sesiune_zi3 date, versiune integer NOT NULL DEFAULT 1);
CREATE TABLE public.red_parcele (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id), uat_id uuid NOT NULL REFERENCES public.red_uat(id),
  id_parcela text NOT NULL, tronson integer, sters_la timestamptz);
CREATE TABLE public.red_detinatori (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parcela_id uuid NOT NULL REFERENCES public.red_parcele(id), nume text NOT NULL, nume_normalizat text NOT NULL,
  calitate text NOT NULL, sters_la timestamptz);
CREATE TABLE public.red_detinatori_token (
  detinator_id uuid PRIMARY KEY REFERENCES public.red_detinatori(id), token_raspuns text NOT NULL UNIQUE CHECK (length(token_raspuns) >= 32), token_expira_la timestamptz);
CREATE TABLE public.red_raspunsuri (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  seq bigint NOT NULL GENERATED ALWAYS AS IDENTITY CONSTRAINT red_raspunsuri_seq_key UNIQUE,
  detinator_id uuid NOT NULL CONSTRAINT red_raspunsuri_detinator_id_fkey REFERENCES public.red_detinatori(id),
  canal text NOT NULL,
  data timestamp with time zone DEFAULT now() NOT NULL,
  optiune text NOT NULL,
  zi_sesiune_aleasa date,
  obiectii_text text,
  declaratie_confirmata boolean,
  semnatura_electronica_ref text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT red_raspunsuri_canal_check CHECK ((canal = ANY (ARRAY['online'::text, 'telefon'::text, 'scris'::text, 'sesiune'::text, 'email'::text, 'sms'::text]))),
  CONSTRAINT red_raspunsuri_optiune_check CHECK ((optiune = ANY (ARRAY['particip'::text, 'nu_particip_fara_obiectii'::text, 'nu_particip_cu_obiectii'::text, 'constatare_teren'::text])))
);
CREATE TABLE public.red_raspunsuri_meta (raspuns_id uuid PRIMARY KEY REFERENCES public.red_raspunsuri(id), ip_sau_sursa text, user_agent text, raw_payload jsonb);
CREATE TABLE public.red_rate_limit (cheie text PRIMARY KEY, fereastra_start timestamptz NOT NULL DEFAULT now(), numar int NOT NULL DEFAULT 0);
CREATE TABLE public.red_jurnal (
  id bigserial PRIMARY KEY, tabela text NOT NULL, inregistrare_id uuid, actiune text NOT NULL CHECK (actiune IN ('insert', 'update', 'delete')),
  date_vechi jsonb, date_noi jsonb, user_id uuid, user_email text, created_at timestamptz NOT NULL DEFAULT now());
DO $t$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['red_proiecte', 'red_uat', 'red_parcele', 'red_detinatori', 'red_detinatori_token', 'red_raspunsuri', 'red_raspunsuri_meta',
                           'red_rate_limit', 'red_jurnal'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $t$;
REVOKE ALL ON SEQUENCE public.red_jurnal_id_seq, public.red_raspunsuri_seq_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE public.red_raspunsuri_seq_seq TO authenticated, service_role;
-- triggerele de pe live (ordinea BEFORE pe red_proiecte: autorizare_tgz -> proiect_utilizatori -> proiecte_retentie_mail -> versiune)
CREATE TRIGGER trg_red_legaturi BEFORE INSERT OR UPDATE ON public.red_raspunsuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_legaturi();
CREATE TRIGGER trg_red_legaturi BEFORE INSERT OR UPDATE ON public.red_raspunsuri_meta FOR EACH ROW EXECUTE FUNCTION public.fn_red_legaturi();
CREATE TRIGGER trg_red_raspunsuri_valideaza BEFORE INSERT OR UPDATE ON public.red_raspunsuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_raspunsuri_valideaza();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_raspunsuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_raspunsuri_meta FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_versiune BEFORE UPDATE ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_versiune_creste();
CREATE TRIGGER trg_red_autorizare_tgz BEFORE INSERT OR UPDATE ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_autorizare_tgz_garda();
CREATE TRIGGER trg_red_proiect_utilizatori BEFORE INSERT OR UPDATE ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_proiect_utilizatori_garda();
CREATE TRIGGER trg_red_proiecte_retentie_mail BEFORE INSERT OR UPDATE ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_proiect_retentie();
CREATE TRIGGER trg_red_jurnal_imuabil BEFORE UPDATE OR DELETE ON public.red_jurnal FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal_imuabil();
-- politicile și drepturile de pe live (20261126a + 20261130g)
CREATE POLICY red_proiecte_ins ON public.red_proiecte FOR INSERT TO authenticated WITH CHECK ((select public.fn_red_nivel()) = 'admin');
CREATE POLICY red_proiecte_sel ON public.red_proiecte FOR SELECT TO authenticated USING ((select public.fn_red_nivel()) IS NOT NULL);
CREATE POLICY red_proiecte_upd ON public.red_proiecte FOR UPDATE TO authenticated USING ((select public.fn_red_nivel()) = 'admin') WITH CHECK ((select public.fn_red_nivel()) = 'admin');
CREATE POLICY red_raspunsuri_ins ON public.red_raspunsuri FOR INSERT TO authenticated WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
CREATE POLICY red_raspunsuri_sel ON public.red_raspunsuri FOR SELECT TO authenticated USING ((select public.fn_red_nivel()) IS NOT NULL);
CREATE POLICY red_raspunsuri_upd ON public.red_raspunsuri FOR UPDATE TO authenticated USING ((select public.fn_red_nivel()) IN ('admin', 'editor')) WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
CREATE POLICY red_meta_ins ON public.red_raspunsuri_meta FOR INSERT TO authenticated WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
GRANT SELECT, INSERT, UPDATE ON public.red_proiecte, public.red_uat, public.red_detinatori TO authenticated, service_role;
GRANT SELECT ON public.red_raspunsuri TO authenticated, service_role;
GRANT INSERT (id, detinator_id, canal, data, optiune, zi_sesiune_aleasa, obiectii_text, declaratie_confirmata, semnatura_electronica_ref, created_by),
      UPDATE (canal, data, optiune, zi_sesiune_aleasa, obiectii_text, declaratie_confirmata, semnatura_electronica_ref)
  ON public.red_raspunsuri TO authenticated;
GRANT INSERT, UPDATE ON public.red_raspunsuri TO service_role;
GRANT SELECT, INSERT ON public.red_raspunsuri_meta TO authenticated, service_role;
GRANT SELECT ON public.red_jurnal TO authenticated, service_role;
