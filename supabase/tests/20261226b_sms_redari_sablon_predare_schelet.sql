-- Schelet LOCAL (PGlite / PG de unică folosință) pentru 20261226b (SMS Redări: textul șablonului cu „predare”). NU se rulează pe producție.
-- Reproduce DOAR ce citește migrarea și verificarea loturilor: rolurile Supabase, privilegiile implicite periculoase, red_proiecte / red_uat
-- (coloanele citite de șablon), sms_loturi / sms_mesaje (coloanele citite de fn_sms_redari_lot_motiv_la și de NOTICE-ul loturilor). Corpurile
-- funcțiilor NU sunt aici: testul (scripts/pglite/test_sms_sablon_predare_local.mjs) le extrage EXACT din 20261130a / 20261130c (amprentele =
-- constantele din 20261226b, verificat de test) și le pune după acest fișier.
DO $r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $r$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.red_proiecte (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cod text NOT NULL UNIQUE, contact_telefon text);
CREATE TABLE public.red_uat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id), nume text NOT NULL,
  sesiune_zi1 date, sesiune_zi2 date, sesiune_zi3 date, program_zi1 text, program_zi2 text, program_zi3 text);
CREATE TABLE public.sms_loturi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), categorie text NOT NULL, stare text NOT NULL DEFAULT 'draft', text text NOT NULL,
  filtru jsonb NOT NULL DEFAULT '{}'::jsonb, proiect_id uuid, uat_id uuid, nr_destinatari integer NOT NULL DEFAULT 0,
  creat_la timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.sms_mesaje (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lot_id uuid NOT NULL REFERENCES public.sms_loturi(id), stare text NOT NULL);
DO $t$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['red_proiecte', 'red_uat', 'sms_loturi', 'sms_mesaje'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $t$;
