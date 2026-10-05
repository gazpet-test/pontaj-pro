-- Schelet minim (NU se aplică pe producție) pentru scripts/test_tipare_impact_owner.sh — doar într-o bază locală *_test.
-- Reproduce ce citește 20261015a de pe live (05.10.2026):
--   - privilegiile implicite ale lui postgres în public (pg_default_acl live: tabele → anon/authenticated arwdxt,
--     service_role ALL; funcții → EXECUTE doar postgres + service_role, fără PUBLIC);
--   - clarificari_tipare exact ca în 20261007a (coloane, CHECK, RLS, 4 policy-uri, REVOKE anon/PUBLIC, GRANT-uri) ⇒
--     relacl {postgres=arwdDxtm,authenticated=arwdxt,service_role=arwdDxtm}, ca pe live;
--   - fn_is_app_owner (md5 8d335ed3…, SECDEF, STABLE, EXECUTE authenticated) + profiles + auth.uid() din GUC.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $roluri$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;   -- global: per schemă nu se poate scoate PUBLIC
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean DEFAULT false);
CREATE FUNCTION public.fn_is_app_owner(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_owner = true);
$function$;
GRANT EXECUTE ON FUNCTION public.fn_is_app_owner(uuid) TO authenticated;
INSERT INTO public.profiles (id, name, is_owner) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Owner', true),
  ('00000000-0000-0000-0000-0000000000b2', 'Coleg', false);

-- clarificari_tipare exact ca în 20261007a
CREATE TABLE public.clarificari_tipare (
  pattern_id             text PRIMARY KEY,
  cod_vechi              text[] NOT NULL DEFAULT '{}',
  tip_problema           text NOT NULL,
  titlu                  text NOT NULL,
  trigger                jsonb NOT NULL,
  documente_de_verificat text[] NOT NULL DEFAULT '{}',
  normative_refs         text[] NOT NULL DEFAULT '{}',
  precedente_cnsc        text[] NOT NULL DEFAULT '{}',
  intrebare_propusa      text,
  impact_intern          jsonb,
  confidence             text CHECK (confidence IN ('ridicata','medie','scazuta')),
  requires_human_legal_review boolean NOT NULL DEFAULT false,
  note                   text,
  versiune_import        text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.clarificari_tipare ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clarificari_tipare FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clarificari_tipare TO authenticated;
GRANT ALL ON public.clarificari_tipare TO service_role;
CREATE POLICY clarificari_tipare_select ON public.clarificari_tipare FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY clarificari_tipare_insert_owner ON public.clarificari_tipare FOR INSERT TO authenticated WITH CHECK (public.fn_is_app_owner(auth.uid()));
CREATE POLICY clarificari_tipare_update_owner ON public.clarificari_tipare FOR UPDATE TO authenticated USING (public.fn_is_app_owner(auth.uid())) WITH CHECK (public.fn_is_app_owner(auth.uid()));
CREATE POLICY clarificari_tipare_delete_owner ON public.clarificari_tipare FOR DELETE TO authenticated USING (public.fn_is_app_owner(auth.uid()));

INSERT INTO public.clarificari_tipare (pattern_id, tip_problema, titlu, trigger, intrebare_propusa, impact_intern, confidence, requires_human_legal_review, versiune_import) VALUES
  ('PAT-A-01', 'experienta', 'Experiență similară restrictivă', '{"cuvinte":["similar"]}', 'Vă rugăm să clarificați…', '{"cost":"mare","risc_respingere":"ridicat","tehnic":"x"}', 'ridicata', true, 'v1'),
  ('PAT-B-02', 'termene', 'Termen de execuție nerealist', '{"cuvinte":["termen"]}', NULL, '{"cost":"mic","risc_respingere":"mediu","tehnic":"y"}', 'medie', false, 'v1'),
  ('PAT-C-03', 'garantii', 'Garanție disproporționată', '{"cuvinte":["garantie"]}', NULL, NULL, NULL, false, 'v1');
