-- Schelet minim (NU se aplică pe producție) pentru scripts/test_sec_f4_advisors.sh — doar într-o bază locală *_test, PG17.
-- Reproduce ce atinge 20261022a, cu drepturile EXACTE de pe live (citite 08.10.2026, amprenta 331d7c12…:12):
--   * default privileges ale lui postgres în public: tabele anon/authenticated arwdxt + service_role tot; funcții: service_role X
--     (+ PUBLIC X implicit, nerevocat global — exact cauza heartbeat_*);
--   * heartbeat_alerta() / heartbeat_muti() DEFINER cu {=X, postgres=X, service_role=X}; corpurile ca pe live;
--   * fn_get_next_nr_aviz(text) DEFINER cu {postgres=X, service_role=X, authenticated=X}; corpul ca pe live;
--   * cele 9 tabele: RLS pornit, 0 politici, anon/authenticated arwdxt, service_role arwdDxtm;
--   * dependenții cunoscuți: fn_rag_qr_rezerva (DEFINER), log_storage_upload_error (DEFINER), fn_storage_rls_report (INVOKER);
--   * cron.job (doar tabelul, nu extensia) cu heartbeat_alerta_orar ca postgres; supabase_migrations pentru runner.
SET client_min_messages = warning;
DO $garda$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $garda$;
-- rolurile ca pe live (pg_roles 08.10): INHERIT, fără apartenențe — un GRANT de rol ar moșteni drepturi exact ca pe producție
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN INHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN INHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN INHERIT BYPASSRLS; END IF;
END $roluri$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- tabelele de context (nu sunt în amprentă)
CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean NOT NULL DEFAULT false);
INSERT INTO public.profiles (id, name, is_owner) VALUES
  ('00000000-0000-0000-0000-000000000121', 'TRUSU RAZVAN', true),
  ('00000000-0000-0000-0000-000000000126', 'NATALIA', false);
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, profile_id uuid, type text, title text, message text, link_to text, modul text);
CREATE TABLE public.procese_heartbeat (cheie text PRIMARY KEY, descriere text, gazda text, ultimul_semn timestamptz, ultim_ok boolean,
  ultim_mesaj text, alertat_la timestamptz, activ boolean NOT NULL DEFAULT true, prag_minute integer NOT NULL DEFAULT 120);
INSERT INTO public.procese_heartbeat (cheie, descriere, gazda, ultimul_semn, ultim_ok, ultim_mesaj)
  VALUES ('tura_noapte', 'tura_noapte', 'pc-test', now() - interval '3 hours', true, 'ultimul mesaj de test');
CREATE TABLE public.avize_serii_counter (serie text PRIMARY KEY, last_nr integer NOT NULL DEFAULT 0);

-- funcțiile vizate — corpurile VERBATIM de pe live 08.10 (md5(prosrc) = c_corpuri din revenire; liniile „  ” goale contează)
CREATE FUNCTION public.heartbeat_muti()
 RETURNS TABLE(cheie text, descriere text, gazda text, tacut_de_minute integer, ultim_mesaj text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT h.cheie, h.descriere, h.gazda,
         (EXTRACT(EPOCH FROM (now() - h.ultimul_semn)) / 60)::int,
         h.ultim_mesaj
  FROM public.procese_heartbeat h
  WHERE h.activ
    AND now() - h.ultimul_semn > make_interval(mins => h.prag_minute)
    AND (h.alertat_la IS NULL OR h.alertat_la < h.ultimul_semn)
  ORDER BY 4 DESC;
$$;
CREATE FUNCTION public.heartbeat_alerta() RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE r record; n integer := 0; p uuid;
BEGIN
  FOR r IN SELECT * FROM public.heartbeat_muti() LOOP
    FOR p IN SELECT id FROM profiles WHERE is_owner = true LOOP
      INSERT INTO notifications (profile_id, type, title, message, link_to, modul)
      VALUES (p, 'warning',
        '⏱️ ' || r.descriere || ' nu mai dă semn de viață',
        format('Tace de %s minute%s. Ultimul mesaj: %s',
               r.tacut_de_minute,
               coalesce(' (' || r.gazda || ')', ''),
               coalesce(r.ultim_mesaj, '—')),
        '/administrativ', 'Administrativ');
    END LOOP;
    UPDATE public.procese_heartbeat SET alertat_la = now() WHERE cheie = r.cheie;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
CREATE FUNCTION public.fn_get_next_nr_aviz(p_serie text) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_nr INTEGER;
BEGIN
  -- Dacă seria nu există (depozit nou), o creăm automat
  INSERT INTO avize_serii_counter (serie, last_nr)
  VALUES (p_serie, 0)
  ON CONFLICT (serie) DO NOTHING;
  
  UPDATE avize_serii_counter
  SET last_nr = last_nr + 1
  WHERE serie = p_serie
  RETURNING last_nr INTO v_nr;
  
  RETURN v_nr;
END;
$$;
-- ACL ca pe live: fn_get_next_nr_aviz a trecut prin restaurarea din 28.08 (REVOKE PUBLIC + GRANT authenticated punctual)
REVOKE ALL ON FUNCTION public.fn_get_next_nr_aviz(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_next_nr_aviz(text) TO authenticated;

-- cele 9 tabele: RLS pornit, FĂRĂ politici, drepturile din default privileges (anon/authenticated arwdxt)
CREATE TABLE public._backup_acoperire_racari_20260921 (id bigint, date jsonb);
CREATE TABLE public._backup_clar63_20260927 (id bigint, date jsonb);
CREATE TABLE public._eval_candidati_inainte_20260921 (id bigint, date jsonb);
CREATE TABLE public._eval_runda1_20260921 (id bigint, date jsonb);
CREATE TABLE public._eval_runda2_20260921 (id bigint, date jsonb);
CREATE TABLE public.olx_tokens (id integer PRIMARY KEY, access_token text, refresh_token text, expires_at timestamptz, scope text, updated_at timestamptz);
CREATE TABLE public.piese_import_staging (id bigserial PRIMARY KEY, rand jsonb);
CREATE TABLE public.rag_qr_log (id bigserial PRIMARY KEY, active_id integer, question text, answered boolean, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.storage_rls_errors (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, occurred_at timestamptz, source text, bucket text, object_path text,
  message text, user_id uuid, status_code integer, captured_at timestamptz DEFAULT now(), log_event_id text UNIQUE);
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['_backup_acoperire_racari_20260921','_backup_clar63_20260927','_eval_candidati_inainte_20260921',
    '_eval_runda1_20260921','_eval_runda2_20260921','olx_tokens','piese_import_staging','rag_qr_log','storage_rls_errors'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $rls$;
INSERT INTO public.olx_tokens (id, access_token, refresh_token, scope, updated_at) VALUES (1, 'tok-test', 'ref-test', 'read', now());
INSERT INTO public.storage_rls_errors (occurred_at, source, bucket, object_path, message) VALUES (now(), 'postgres_log', 'b', 'p', 'm');

-- dependenții cunoscuți — definițiile VERBATIM de pe live 08.10 (pg_get_functiondef; semnătura = c_semnaturi din migrare),
-- ACL ca pe live
CREATE OR REPLACE FUNCTION public.fn_rag_qr_rezerva(p_active_id integer, p_question text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_zi timestamptz := date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest';
  v_id bigint;
BEGIN
  IF p_active_id IS NULL OR coalesce(btrim(p_question), '') = '' THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.rag_qr_cota'));
  IF (SELECT count(*) FROM public.rag_qr_log WHERE created_at >= v_zi) >= 200
     OR (SELECT count(*) FROM public.rag_qr_log WHERE active_id = p_active_id AND created_at >= v_zi) >= 30 THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.rag_qr_log (active_id, question, answered) VALUES (p_active_id, left(btrim(p_question), 300), false)
    RETURNING id INTO v_id;
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.fn_rag_qr_rezerva(integer, text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.log_storage_upload_error(p_bucket text, p_path text, p_message text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.storage_rls_errors (occurred_at, source, bucket, object_path, message, user_id)
  values (now(), 'app_client', p_bucket, left(p_path, 1000), coalesce(nullif(p_message, ''), '(fara mesaj)'), auth.uid());
end;
$function$;
REVOKE ALL ON FUNCTION public.log_storage_upload_error(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_storage_upload_error(text, text, text) TO authenticated;
CREATE OR REPLACE FUNCTION public.fn_storage_rls_report(p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with win as (
    select (now() - make_interval(days => greatest(p_days, 1))) as de_la, now() as pana_la
  ),
  ev as (
    select e.* from public.storage_rls_errors e, win w where e.occurred_at >= w.de_la
  )
  select jsonb_build_object(
    'zile',               greatest(p_days, 1),
    'interval_de_la',     (select de_la   from win),
    'interval_pana_la',   (select pana_la from win),
    'total',              (select count(*) from ev),
    'total_rls_postgres', (select count(*) from ev where source = 'postgres_log'),
    'total_rls_app',      (select count(*) from ev where source = 'app_client'),
    'total_storage_4xx',  (select count(*) from ev where source = 'storage_log'),
    'pe_zi', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object(
                 'zi',  (occurred_at at time zone 'Europe/Bucharest')::date,
                 'nr',  count(*),
                 'rls', count(*) filter (where source in ('postgres_log','app_client'))
               ) as x
        from ev
        group by (occurred_at at time zone 'Europe/Bucharest')::date
        order by 1) s), '[]'::jsonb),
    'pe_bucket', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('bucket', coalesce(bucket, '(necunoscut)'), 'nr', count(*)) as x
        from ev
        group by coalesce(bucket, '(necunoscut)')
        order by count(*) desc) s), '[]'::jsonb),
    'ultimele', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object(
                 'moment_ro', to_char(occurred_at at time zone 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI:SS'),
                 'source',    source,
                 'bucket',    bucket,
                 'cale',      object_path,
                 'status',    status_code,
                 'mesaj',     left(message, 200)
               ) as x
        from ev
        order by occurred_at desc
        limit 15) s), '[]'::jsonb),
    'ultima_captura', (select max(captured_at) from public.storage_rls_errors)
  );
$function$;
REVOKE ALL ON FUNCTION public.fn_storage_rls_report(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_storage_rls_report(integer) TO authenticated;

-- cron.job (doar tabelul, ca precondiția 0e să aibă ce citi)
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text, command text, nodename text DEFAULT 'localhost', nodeport integer DEFAULT 5432,
  database text DEFAULT current_database(), username text DEFAULT CURRENT_USER, active boolean DEFAULT true, jobname text);
INSERT INTO cron.job (schedule, command, username, jobname) VALUES ('15 * * * *', 'SELECT public.heartbeat_alerta();', 'postgres', 'heartbeat_alerta_orar');

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
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO anon, authenticated, service_role;
-- helperii de test NU intră în amprentă și nu sunt în public
