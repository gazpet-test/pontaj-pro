-- Schelet LOCAL (PGlite / PG de unică folosință) pentru 20261131i (Redări e-mail: linkul personal și câmpurile completate pe fiecare mesaj). NU se rulează pe producție.
-- = scheletul 20261131h (supabase/tests/20261131h_redari_mail_f2b_schelet.sql: rolurile Supabase, auth.*, profiles, Vault machetă, red_proiecte / red_uat,
--   red_mail_* din 30j / 31a, red_fan_awb, triggerele și RLS-ul lor) + ce citește / scrie 20261131i în plus: coloanele convocatorului pe red_uat (sesiune_zi1..3,
--   program_zi1..3) și red_proiecte (contact_telefon), red_parcele / red_detinatori / red_detinatori_contact / red_detinatori_token (RLS-ul tokenului EXACT ca în
--   20261126a / 30g: o politică SELECT admin / editor, fără scriere pentru roluri), red_convocari (canal / stare / sters_la, citite de inventar), red_numere.
--   Tokenurile se INSEREAZĂ direct în fixture (triggerul 20261126a care le generează cere pgcrypto în schema extensions; comportamentul lui e probat acolo).
-- Corpurile funcțiilor NU sunt aici: proba (scripts/pglite/test_redari_mail_link_local.mjs) le extrage EXACT din migrările lor (26a, 27a, 30k, 30m, 31a — inclusiv
--   fn_red_mail_lot_creeaza / destinatari / lot_aproba / rezerva / apel_incepe / rezultat / f2_garda) și le pune în locul marcajului „@@FUNCTII@@”; 20261131h se
--   aplică apoi ca migrare reală (ca runnerul), iar 20261131i peste ea.
DO $r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN CREATE ROLE supabase_storage_admin NOLOGIN; END IF;
END $r$;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA vault;
GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA vault FROM PUBLIC;
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
-- ---------------------------------------------------------------- Vault (machetă: decrypted_secret = secret în clar; semnăturile de pe live)
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text DEFAULT '', secret text NOT NULL, key_id uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, description, secret, secret AS decrypted_secret, key_id, created_at, updated_at FROM vault.secrets;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '', new_key_id uuid DEFAULT NULL)
  RETURNS uuid LANGUAGE sql AS $$ INSERT INTO vault.secrets (name, description, secret, key_id) VALUES (new_name, new_description, new_secret, new_key_id) RETURNING id $$;
CREATE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL, new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $$ UPDATE vault.secrets SET secret = coalesce(new_secret, secret), name = coalesce(new_name, name), description = coalesce(new_description, description),
    key_id = coalesce(new_key_id, key_id), updated_at = now() WHERE id = secret_id $$;
REVOKE ALL ON vault.secrets, vault.decrypted_secrets FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION vault.create_secret(text, text, text, uuid), vault.update_secret(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
-- ---------------------------------------------------------------- tabelele Redări (coloanele de pe live folosite de 31h / 31i)
CREATE TABLE public.red_proiecte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cod text NOT NULL UNIQUE CHECK (btrim(cod) <> ''), denumire text, activ boolean NOT NULL DEFAULT true,
  contact_nume text, contact_telefon text, contact_email text DEFAULT 'redari@gazpet.ro',
  created_at timestamptz NOT NULL DEFAULT now(), versiune int NOT NULL DEFAULT 1, retentie_mail_pana date,
  autorizare_tgz_nr text, autorizare_tgz_data date, autorizare_tgz_fisier text, autorizare_tgz_obiect uuid, autorizare_tgz_etag text);
CREATE TABLE public.red_uat (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id), nume text NOT NULL, uat3 text NOT NULL,
  sesiune_zi1 date, sesiune_zi2 date, sesiune_zi3 date, program_zi1 text, program_zi2 text, program_zi3 text, versiune integer NOT NULL DEFAULT 1);
CREATE TABLE public.red_parcele (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id), uat_id uuid NOT NULL REFERENCES public.red_uat(id),
  id_parcela text NOT NULL, sters_la timestamptz, UNIQUE (proiect_id, id_parcela));
CREATE TABLE public.red_detinatori (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parcela_id uuid NOT NULL REFERENCES public.red_parcele(id), nume text NOT NULL CHECK (btrim(nume) <> ''),
  calitate text NOT NULL DEFAULT 'proprietar', sters_la timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  nume_normalizat text);  -- pe baza reala NOT NULL fara implicit; aici nullable (fixture-urile vechi ale probei nu il dau), fixture-ul de cost il completeaza
CREATE TABLE public.red_detinatori_token (
  detinator_id uuid PRIMARY KEY REFERENCES public.red_detinatori(id),
  token_raspuns text NOT NULL UNIQUE CHECK (length(token_raspuns) >= 32),
  token_expira_la timestamptz);
CREATE TABLE public.red_detinatori_contact (detinator_id uuid PRIMARY KEY REFERENCES public.red_detinatori(id), adresa_comuna text, telefon text, email text);
CREATE TABLE public.red_convocari (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), detinator_id uuid NOT NULL REFERENCES public.red_detinatori(id),
  canal text NOT NULL CHECK (canal IN ('posta', 'sms', 'email', 'afisare', 'telefon')), stare text NOT NULL DEFAULT 'activ', sters_la timestamptz, fisier_convocator_path text);
CREATE TABLE public.red_numere (cheie text PRIMARY KEY, ultimul int NOT NULL DEFAULT 0);
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz DEFAULT now());
ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
INSERT INTO storage.buckets (id, name, public) VALUES ('redari', 'redari', false);
CREATE TABLE public.red_mail_primite (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
-- red_mail_setari: 20261130j + coloanele F2 și CHECK-ul inert din 20261131a (20261131h le schimbă, aplicată de probă)
CREATE TABLE public.red_mail_setari (
  id smallint PRIMARY KEY CONSTRAINT red_mail_setari_id_ck CHECK (id = 1),
  citire_activa boolean NOT NULL DEFAULT false,
  ultima_eroare_cod text CONSTRAINT red_mail_setari_eroare_ck CHECK (ultima_eroare_cod IS NULL OR ultima_eroare_cod ~ '^[a-z0-9_]{1,64}$'),
  retentie_activa boolean NOT NULL DEFAULT false,
  golire_gmail_activa boolean NOT NULL DEFAULT false,
  retentie_lease_token uuid,
  retentie_lease_pana timestamptz,
  versiune integer NOT NULL DEFAULT 1 CONSTRAINT red_mail_setari_versiune_ck CHECK (versiune >= 1),
  actualizat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_mail_setari_lease_ck CHECK ((retentie_lease_token IS NULL) = (retentie_lease_pana IS NULL))
);
INSERT INTO public.red_mail_setari (id) VALUES (1);
ALTER TABLE public.red_mail_setari
  ADD COLUMN trimitere_oprita boolean NOT NULL DEFAULT true,
  ADD COLUMN extern_permis boolean NOT NULL DEFAULT false,
  ADD COLUMN plafon_zi integer NOT NULL DEFAULT 200 CHECK (plafon_zi BETWEEN 1 AND 200),
  ADD COLUMN plafon_luna integer NOT NULL DEFAULT 1000 CHECK (plafon_luna BETWEEN 1 AND 1000),
  ADD COLUMN pauza_pana timestamptz,
  ADD COLUMN ultim_apel_la timestamptz;
ALTER TABLE public.red_mail_setari ADD CONSTRAINT red_mail_f2_inert_ck CHECK (trimitere_oprita IS TRUE AND extern_permis IS FALSE);
-- red_mail_oauth_state: 20261130j
CREATE TABLE public.red_mail_oauth_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_sha256 text NOT NULL CONSTRAINT red_mail_oauth_state_sha_uq UNIQUE CONSTRAINT red_mail_oauth_state_sha_ck CHECK (state_sha256 ~ '^[0-9a-f]{64}$'),
  scop text NOT NULL CONSTRAINT red_mail_oauth_state_scop_ck CHECK (scop IN ('citire', 'citire_test', 'golire', 'golire_test')),
  owner_id uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  expira_la timestamptz NOT NULL,
  consumat_la timestamptz,
  CONSTRAINT red_mail_oauth_state_expira_ck CHECK (expira_la > creat_la AND expira_la <= creat_la + interval '10 minutes'),
  CONSTRAINT red_mail_oauth_state_consumat_ck CHECK (consumat_la IS NULL OR consumat_la >= creat_la)
);
-- red_mail_evenimente: 20261130j, cu CHECK-ul tipului extins de 20261131a ('f2')
CREATE TABLE public.red_mail_evenimente (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tip text NOT NULL CONSTRAINT red_mail_evenimente_tip_ck CHECK (tip IN ('activare', 'ingestie_ok', 'ingestie_neprocesabil', 'deja_golit', 'disparut', 'spam_numarat',
    'dry_rulat', 'recuperare_inceputa', 'recuperare_terminata', 'lease_pierdut', 'eroare_citire', 'descarcare', 'golire', 'blocaj_cerut', 'blocaj_activ',
    'blocaj_ridicat', 'orfane_sterse', 'alerta_de_triat', 'alerta_escaladare', 'oauth_conectat', 'oauth_respins', 'oauth_revocat', 'tombstone_sters',
    'neprocesabil_eliberat', 'eliberare_anulata', 'gmail_trash_inceput', 'gmail_in_cos', 'gmail_trash_ambiguu', 'gmail_de_decis', 'gmail_absent_verificat',
    'gmail_stergere_esuata', 'metoda_nepermisa', 'trash_tardiv', 'alerta_gmail_stergere', 'alerta_dedup_expira', 'tombstone_sters_termen', 'hmac_cheie_retrasa', 'f2')),
  primit_id uuid CONSTRAINT red_mail_evenimente_primit_fk REFERENCES public.red_mail_primite(id) ON DELETE CASCADE,
  obiect_id uuid,
  casuta text CONSTRAINT red_mail_evenimente_casuta_ck CHECK (casuta IS NULL OR casuta IN ('redari@gazpet.ro', 'redari-test@gazpet.ro')),
  gmail_id_hmac text CONSTRAINT red_mail_evenimente_hmac_ck CHECK (gmail_id_hmac IS NULL OR gmail_id_hmac ~ '^[0-9a-f]{64}$'),
  cod text CONSTRAINT red_mail_evenimente_cod_ck CHECK (cod IS NULL OR cod ~ '^[a-z0-9_]{1,64}$'),
  numar bigint CONSTRAINT red_mail_evenimente_numar_ck CHECK (numar IS NULL OR numar >= 0),
  numaratori jsonb CONSTRAINT red_mail_evenimente_numaratori_ck CHECK (numaratori IS NULL OR (jsonb_typeof(numaratori) = 'object' AND length(numaratori::text) <= 2000
    AND NOT jsonb_path_exists(numaratori, '$.* ? (@.type() != "number")') AND NOT jsonb_path_exists(numaratori, '$.keyvalue() ? (!(@.key like_regex "^[a-z0-9_]{1,40}$"))'))),
  autor uuid,
  creat_la timestamptz NOT NULL DEFAULT now()
);
-- 20261131a: loturile, mesajele (cu FK-ul spre red_detinatori, ca pe live), jurnalul F2 (CHECK-ul inline = același nume automat ca pe live)
CREATE TABLE public.red_mail_jurnal_f2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lot_id uuid, mesaj_id uuid, autor uuid,
  cod text NOT NULL CHECK (cod IN ('creat','aprobat','rezervat','apel_inceput','trimis','esuat_sigur','necunoscut','esuat_confirmat','anulat','lot_integritate','lot_incheiat','golit','lot_sters_final','setari','optout')),
  creat_la timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.red_mail_loturi (
  id uuid PRIMARY KEY,
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  uat_id uuid NOT NULL REFERENCES public.red_uat(id),
  cerere_sha256 text NOT NULL CHECK (cerere_sha256 ~ '^[0-9a-f]{64}$'),
  stare text NOT NULL DEFAULT 'ciorna' CHECK (stare IN ('ciorna','aprobat','in_trimitere','blocat_integritate','incheiat')),
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune>0),
  lot_sha256 text NOT NULL CHECK (lot_sha256 ~ '^[0-9a-f]{64}$'),
  aprobat_lot_sha256 text CHECK (aprobat_lot_sha256 ~ '^[0-9a-f]{64}$'),
  aprobat_versiune integer, aprobat_de uuid, aprobat_la timestamptz,
  creat_de uuid NOT NULL, creat_la timestamptz NOT NULL DEFAULT now(),
  incheiat_la timestamptz,
  CHECK ((aprobat_la IS NULL)=(aprobat_de IS NULL) AND (aprobat_la IS NULL)=(aprobat_lot_sha256 IS NULL)
    AND (aprobat_la IS NULL)=(aprobat_versiune IS NULL)),
  CHECK (stare NOT IN ('aprobat','in_trimitere','blocat_integritate') OR aprobat_la IS NOT NULL)
);
CREATE TABLE public.red_mail_mesaje (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES public.red_mail_loturi(id),
  detinator_id uuid NOT NULL REFERENCES public.red_detinatori(id),
  tip text NOT NULL DEFAULT 'convocare' CHECK (tip='convocare'),
  nr_document text NOT NULL UNIQUE,
  convocare_postala_id uuid REFERENCES public.red_convocari(id),
  catre text, subiect_final text, corp_text_final text, corp_html_final text,
  message_id text UNIQUE,
  antete_snapshot jsonb,
  atasament_path text, atasament_nume text, atasament_mime text, atasament_sha256 text, atasament_marime bigint,
  mesaj_sha256 text NOT NULL CHECK (mesaj_sha256 ~ '^[0-9a-f]{64}$'),
  stare text NOT NULL DEFAULT 'in_coada' CHECK (stare IN ('in_coada','rezervat','in_apel','trimis','esuat_sigur','necunoscut','esuat_confirmat','anulat')),
  lease_token uuid, lease_pana timestamptz, rezervare_nr integer NOT NULL DEFAULT 0,
  rezervat_la timestamptz, apel_inceput_la timestamptz, trimis_la timestamptz,
  gmail_id text, thread_id text, gmail_id_raportat text,
  eroare_cod text CHECK (eroare_cod ~ '^[a-z0-9_]{1,64}$'),
  retentie_stare text NOT NULL DEFAULT 'activ' CHECK (retentie_stare IN ('activ','golit')),
  UNIQUE (lot_id,detinator_id),
  CHECK ((stare='trimis')=(trimis_la IS NOT NULL)),
  CHECK (retentie_stare='golit' OR (catre IS NOT NULL AND corp_text_final IS NOT NULL AND subiect_final IS NOT NULL AND message_id IS NOT NULL))
);
CREATE INDEX red_mail_mesaje_coada ON public.red_mail_mesaje(lot_id,stare,id);
CREATE TABLE public.red_mail_optout (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
  activ boolean NOT NULL DEFAULT true, motiv text NOT NULL CHECK (length(btrim(motiv)) BETWEEN 1 AND 500),
  sursa text NOT NULL CHECK (sursa IN ('cerere_om','mail_primit')), primit_id uuid REFERENCES public.red_mail_primite(id),
  setat_de uuid NOT NULL, setat_la timestamptz NOT NULL DEFAULT now(),
  CHECK (email=lower(email))
);
CREATE TABLE public.red_mail_fisiere_inventar_antet (
  lot_id uuid PRIMARY KEY REFERENCES public.red_mail_loturi(id), inventar_complet_la timestamptz NOT NULL DEFAULT now(),
  nr_fisiere integer NOT NULL CHECK (nr_fisiere>=0), inventar_sha256 text NOT NULL CHECK (inventar_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE TABLE public.red_mail_fisiere_inventar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lot_id uuid NOT NULL REFERENCES public.red_mail_loturi(id),
  mesaj_id uuid NOT NULL REFERENCES public.red_mail_mesaje(id), cale text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'), marime bigint NOT NULL CHECK (marime>0),
  proprietate text NOT NULL CHECK (proprietate IN ('exclusiv','partajat')),
  stare text NOT NULL CHECK (stare IN ('de_sters','sters','pastrat')), UNIQUE(lot_id,mesaj_id,cale)
);
-- 20261212a: AWB-urile FAN (doar coloanele citite de triggerul 31h + CHECK-ul stărilor)
CREATE TABLE public.red_fan_awb (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  lot_id uuid NOT NULL, plic_id uuid NOT NULL,
  nr_plic text NOT NULL CHECK (nr_plic ~ '^PL-[A-Z]{3}-[0-9]{4}$'),
  stare text NOT NULL DEFAULT 'propus' CHECK (stare IN ('propus', 'aprobat', 'in_curs', 'generat', 'eroare', 'necunoscut', 'anulat', 'ridicat')),
  hash_date text NOT NULL CHECK (hash_date ~ '^[0-9a-f]{64}$')
);
-- @@FUNCTII@@
-- ---------------------------------------------------------------- CHECK-ul snapshotului (31a, după funcțiile lui) + triggerele REALE F2 (20261131a)
ALTER TABLE public.red_mail_mesaje ADD CONSTRAINT red_mail_f2_snapshot_ck CHECK (
 retentie_stare='golit' OR (public.fn_red_mail_f2_email(catre) AND catre=lower(catre)
 AND length(btrim(subiect_final)) BETWEEN 1 AND 500 AND subiect_final !~ '[[:cntrl:]]'
 AND length(btrim(corp_text_final)) BETWEEN 1 AND 20000 AND message_id='<'||id::text||'@gazpet.ro>'));
CREATE TRIGGER trg_red_mail_f2_lot BEFORE UPDATE ON public.red_mail_loturi FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_f2_garda();
CREATE TRIGGER trg_red_mail_f2_mesaj BEFORE INSERT OR UPDATE OR DELETE ON public.red_mail_mesaje FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_f2_garda();
CREATE TRIGGER trg_red_mail_f2_jurnal_imuabil BEFORE UPDATE OR DELETE ON public.red_mail_jurnal_f2 FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal_imuabil();
-- ---------------------------------------------------------------- triggerele de pe live (20261130k)
CREATE TRIGGER trg_red_mail_setari_reguli BEFORE UPDATE OR DELETE ON public.red_mail_setari FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_setari_reguli();
CREATE TRIGGER trg_red_mail_fara_truncate BEFORE TRUNCATE ON public.red_mail_setari FOR EACH STATEMENT EXECUTE FUNCTION public.fn_red_jurnal_imuabil();
CREATE TRIGGER trg_red_versiune BEFORE UPDATE ON public.red_mail_setari FOR EACH ROW EXECUTE FUNCTION public.fn_red_versiune_creste();
CREATE TRIGGER trg_red_mail_oauth_state_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.red_mail_oauth_state FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_oauth_state_reguli();
CREATE TRIGGER trg_red_mail_evenimente_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.red_mail_evenimente FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_evenimente_reguli();
CREATE TRIGGER trg_red_mail_evenimente_fara_truncate BEFORE TRUNCATE ON public.red_mail_evenimente FOR EACH STATEMENT EXECUTE FUNCTION public.fn_red_jurnal_imuabil();
-- ---------------------------------------------------------------- RLS + drepturi (20261126a / 30g / 30j / 31a)
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['red_mail_setari', 'red_mail_evenimente', 'red_mail_oauth_state', 'red_mail_primite'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    IF t <> 'red_mail_oauth_state' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (( SELECT public.fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))', t || '_sel', t);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['red_mail_loturi', 'red_mail_mesaje', 'red_mail_optout', 'red_mail_fisiere_inventar', 'red_mail_fisiere_inventar_antet', 'red_mail_jurnal_f2'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_sms_e_owner() IS TRUE)', t || '_sel', t);
  END LOOP;
  ALTER TABLE public.red_fan_awb ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.red_fan_awb FROM PUBLIC, anon, authenticated, service_role;
  GRANT SELECT ON public.red_fan_awb TO authenticated, service_role;
  CREATE POLICY red_fan_awb_citire ON public.red_fan_awb FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));
  FOREACH t IN ARRAY ARRAY['red_proiecte', 'red_uat', 'red_parcele', 'red_detinatori', 'red_convocari'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((select public.fn_red_nivel()) IS NOT NULL)', t || '_sel', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t);
  END LOOP;
  -- 20261126a / 30g: PII și tokenul: SELECT doar admin / editor; tokenul fără scriere pentru nimeni (nici service_role nu are INSERT / UPDATE)
  FOREACH t IN ARRAY ARRAY['red_detinatori_contact', 'red_detinatori_token'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t);
  END LOOP;
  CREATE POLICY red_contact_sel ON public.red_detinatori_contact FOR SELECT TO authenticated USING ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  CREATE POLICY red_token_sel ON public.red_detinatori_token FOR SELECT TO authenticated USING ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER TABLE public.red_numere ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.red_numere FROM PUBLIC, anon, authenticated, service_role;
  GRANT SELECT ON public.red_numere TO authenticated, service_role;
  -- 20261126a / 30g: admin Redări poate modifica proiectul (inclusiv codul) — calea pe care triggerul 31h o îngrădește
  CREATE POLICY red_proiecte_upd ON public.red_proiecte FOR UPDATE TO authenticated USING ((select public.fn_red_nivel()) = 'admin') WITH CHECK ((select public.fn_red_nivel()) = 'admin');
  GRANT UPDATE ON public.red_proiecte TO authenticated;
END $rls$;
REVOKE ALL ON SEQUENCE public.red_mail_evenimente_id_seq FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON storage.objects, storage.buckets TO anon, authenticated, service_role;
-- funcțiile: doar proprietarul, în afară de cele expuse (20261126a §7, 20261130m, 20261131a)
REVOKE ALL ON FUNCTION public.fn_red_nivel(), public.fn_red_jurnal_imuabil(), public.fn_red_versiune_creste(), public.fn_red_informare_publicata(text),
  public.fn_red_mail_setari_reguli(), public.fn_red_mail_oauth_state_reguli(), public.fn_red_mail_evenimente_reguli(),
  public.fn_red_mail_f2_canonic(jsonb), public.fn_red_mail_f2_hash(jsonb), public.fn_red_mail_f2_email(text), public.fn_red_mail_f2_text(text), public.fn_red_mail_f2_mesaj_hash(public.red_mail_mesaje),
  public.fn_red_mail_f2_lot_hash(uuid), public.fn_red_mail_f2_owner(), public.fn_red_mail_f2_audit(uuid,uuid,text),
  public.fn_red_mail_f2_poate(public.red_mail_loturi), public.fn_red_mail_f2_setari(boolean,boolean,integer), public.fn_sms_e_owner(),
  public.fn_red_mail_f2_garda(), public.fn_red_mail_f2_retentie_poate(uuid), public.fn_red_mail_rezerva(uuid), public.fn_red_mail_apel_incepe(uuid,uuid),
  public.fn_red_mail_rezultat(uuid,uuid,text,text,text), public.fn_red_mail_destinatari(uuid,uuid,uuid), public.fn_red_mail_lot_creeaza(uuid,uuid,uuid,uuid[],text,text),
  public.fn_red_mail_lot_aproba(uuid,integer,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_nivel(), public.fn_sms_e_owner() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_informare_publicata(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_mail_f2_setari(boolean,boolean,integer), public.fn_red_mail_rezerva(uuid), public.fn_red_mail_apel_incepe(uuid,uuid),
  public.fn_red_mail_rezultat(uuid,uuid,text,text,text), public.fn_red_mail_destinatari(uuid,uuid,uuid), public.fn_red_mail_lot_creeaza(uuid,uuid,uuid,uuid[],text,text),
  public.fn_red_mail_lot_aproba(uuid,integer,text) TO authenticated;
