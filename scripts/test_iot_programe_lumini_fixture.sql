-- Numai clusterul izolat al harness-ului. Fara acces la Tuya/Vault reale.
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth,public TO authenticated,anon,service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fixture_uid$
 SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid
$fixture_uid$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access(profile_id uuid REFERENCES public.profiles(id),module text,access_level text CHECK(access_level IN ('viewer','editor','admin')));
INSERT INTO public.profiles VALUES ('00000000-0000-0000-0000-000000000001',true),('00000000-0000-0000-0000-000000000002',false),('00000000-0000-0000-0000-000000000003',false),('00000000-0000-0000-0000-000000000004',false);
INSERT INTO public.user_module_access VALUES ('00000000-0000-0000-0000-000000000002','cladire','editor'),('00000000-0000-0000-0000-000000000003','cladire','viewer'),('00000000-0000-0000-0000-000000000004','alt_modul','admin');
CREATE TABLE public.iot_dispozitive(id integer PRIMARY KEY,sursa text,meta jsonb);
INSERT INTO public.iot_dispozitive SELECT x,'tuya','{"categorie":"tdq"}' FROM generate_series(85457,85462) x;
CREATE TABLE public.notifications(id bigint GENERATED ALWAYS AS IDENTITY,title text,message text);
CREATE FUNCTION public.iot_alerta(p_type text,p_title text,p_message text,p_link text DEFAULT '/cladire') RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fixture_alerta$
BEGIN
 IF EXISTS(SELECT 1 FROM public.notifications WHERE title=p_title) THEN RETURN 0; END IF;
 INSERT INTO public.notifications(title,message) VALUES(p_title,p_message); RETURN 1;
END $fixture_alerta$;
REVOKE ALL ON FUNCTION public.iot_alerta(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.iot_alerta(text,text,text,text) TO service_role;
CREATE FUNCTION public.iot_cron_tick() RETURNS void LANGUAGE plpgsql AS $fixture_tick$ BEGIN NULL; END $fixture_tick$;
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $fixture_net$ SELECT 1::bigint $fixture_net$;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY,schedule text,command text,nodename text DEFAULT 'localhost',nodeport integer DEFAULT 5432,database text DEFAULT current_database(),username text DEFAULT current_user,active boolean DEFAULT true,jobname text);
CREATE FUNCTION cron.schedule(p_name text,p_schedule text,p_command text) RETURNS bigint LANGUAGE sql AS $fixture_schedule$
 INSERT INTO cron.job(jobname,schedule,command) VALUES(p_name,p_schedule,p_command) RETURNING jobid
$fixture_schedule$;
CREATE FUNCTION cron.unschedule(p_id bigint) RETURNS boolean LANGUAGE plpgsql AS $fixture_unschedule$
BEGIN DELETE FROM cron.job WHERE jobid=p_id;RETURN FOUND;END $fixture_unschedule$;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[],name text,created_by text,idempotency_key text,rollback text[]);
-- Reproducem default privileges Supabase, apoi migrarea trebuie sa le restranga.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
