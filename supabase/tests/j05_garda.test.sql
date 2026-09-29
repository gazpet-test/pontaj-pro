-- ════════════════════════════════════════════════════════════════════════════
-- Test PG16 local pentru garda J05 (supabase/migrations/20261001a_ofertare_derogare_garda_j05.sql).
-- Se rulează DOAR prin scripts/test_j05_garda.sh, pe clusterul dedicat (127.0.0.1:5481), baza
-- `j05_garda_test`. Nu atinge Supabase / producția; nu conține date reale.
--
-- Faze (psql -v faza=…):
--   setup  schelet minim + definițiile LIVE din 30.09 copiate cu pg_get_functiondef (verificate prin
--          md5 = live: funcții, triggere, CHECK/FK audit, politici RLS) + ACL-urile live + fixture + harness
--   live   rulează toate cazurile pe starea live (fără patch)
--   patch  aceleași cazuri după migrare
-- Fiecare aserțiune emite o linie NOTICE „REZ|faza|tip|cod|categorie|OK/FAIL|observat|descriere”.
-- Scriptul NU se oprește la o aserțiune picată: harness-ul compară live cu patch.
-- Categorii:
--   P  gaura J05 (live PERMITE): pe live trebuie să pice cel puțin o aserțiune a cazului, pe patch trec toate
--   H  întărire (live refuză deja, dar cu alt cod, prin a00): la fel ca P
--   R  regresie / flux legitim: trece și pe live, și pe patch
--   A  varianta atomică: descrie comportamentul live; trece pe ambele (patch-ul nu o schimbă)
--   D  gol consemnat: trece pe ambele (descrie ce patch-ul NU acoperă)
--   L / K  cataloage: starea live intactă (live) / garda instalată corect (patch)
-- Identități ca în PostgREST: SET SESSION AUTHORIZATION authenticator + SET ROLE <rol> + request.jwt.claims;
-- „owner_mcp” = sesiune postgres + SET ROLE authenticated + claims owner (MCP care se dă drept owner).
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
SET client_min_messages = notice;

\set OWNER  '00000000-0000-4000-8000-000000000121'
\set EDITOR '00000000-0000-4000-8000-000000000007'
\set VIEWER '00000000-0000-4000-8000-000000000055'
\set ADMMOD '00000000-0000-4000-8000-000000000033'
\set FINANC '00000000-0000-4000-8000-000000000066'
\set NOMOD  '00000000-0000-4000-8000-000000000099'

SELECT (:'faza' = 'setup') AS f_setup, (:'faza' IN ('live', 'patch')) AS f_teste,
       (:'faza' = 'live') AS f_live, (:'faza' = 'patch') AS f_patch,
       (:'faza' IN ('setup', 'live', 'patch')) AS f_valid \gset
\if :f_valid
\else
  \echo 'faza necunoscută: folosește setup | live | patch'
  SELECT 1/0;
\endif

DO $garda$ BEGIN
  IF current_database() <> 'j05_garda_test' OR session_user <> 'postgres'
     OR current_setting('server_version_num')::int / 10000 <> 16 THEN
    RAISE EXCEPTION 'Testul rulează doar pe baza dedicată j05_garda_test (PG16, login postgres).';
  END IF;
END $garda$;

-- ════════════════════════════════════════════════════════════════════════════
\if :f_setup
\echo '== SETUP: schelet + definițiile LIVE 30.09 (md5 = live) + fixture + harness =='
DO $gol$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public')
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('auth', 't')) THEN
    RAISE EXCEPTION 'Baza trebuie să fie goală (scriptul o recreează).';
  END IF;
END $gol$;

-- Rolurile Supabase (globale în cluster; create o singură dată). authenticator = login-ul PostgREST.
DO $roluri$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')                THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')       THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')        THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator')       THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin LOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin')      THEN CREATE ROLE supabase_admin LOGIN SUPERUSER; END IF;
  IF NOT pg_has_role('authenticator', 'anon', 'MEMBER')          THEN GRANT anon TO authenticator; END IF;
  IF NOT pg_has_role('authenticator', 'authenticated', 'MEMBER') THEN GRANT authenticated TO authenticator; END IF;
  IF NOT pg_has_role('authenticator', 'service_role', 'MEMBER')  THEN GRANT service_role TO authenticator; END IF;
END $roluri$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Capcana Supabase: privilegiile implicite dau totul rolurilor API pe obiectele NOI din public.
-- Migrarea trebuie să-și revoce singură EXECUTE pe funcția gărzii (testul K02 o prinde).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- ── auth.*: copiile LIVE (md5 verificat mai jos). ATENȚIE: „select ” are un spațiu la final, ca în live ──
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION auth.jwt()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$
;
CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$
;
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$
;

-- ── Tabele: coloanele / constrângerile live pe care le ating poarta, a00, RPC-ul, garda ──────
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  role text NOT NULL DEFAULT 'manager',
  is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access (
  id serial PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module text NOT NULL,
  access_level text NOT NULL CONSTRAINT user_module_access_level_chk CHECK (access_level = ANY (ARRAY['admin'::text, 'editor'::text, 'viewer'::text])),
  granted_at timestamptz DEFAULT now(),
  granted_by uuid REFERENCES public.profiles(id),
  UNIQUE (profile_id, module));
CREATE TABLE public.contracte_terti (id bigint PRIMARY KEY);
-- ofertare_licitatii: toate cele 34 de coloane live, în ordinea live (a00 compară rândul întreg prin to_jsonb).
CREATE TABLE public.ofertare_licitatii (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nr_anunt text NOT NULL UNIQUE,
  autoritate text NOT NULL,
  obiect text NOT NULL,
  link_seap text,
  valoare_estimata numeric,
  moneda text NOT NULL DEFAULT 'RON'::text,
  loturi jsonb NOT NULL DEFAULT '[]'::jsonb,
  termen_depunere timestamptz,
  criteriu text,
  garantie_participare text,
  nas_path text,
  status text NOT NULL DEFAULT 'identificata'::text CONSTRAINT ofertare_licitatii_status_check
    CHECK (status = ANY (ARRAY['identificata'::text, 'analiza'::text, 'go'::text, 'in_lucru'::text, 'depusa'::text, 'castigata'::text, 'pierduta'::text, 'abandonata'::text])),
  decizie_go text CONSTRAINT ofertare_licitatii_decizie_go_check CHECK (decizie_go = ANY (ARRAY['go'::text, 'no_go'::text])),
  decizie_motivare text,
  decizie_de uuid REFERENCES public.profiles(id),
  decizie_la timestamptz,
  observatii text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  tip_procedura text,
  canal text CONSTRAINT ofertare_licitatii_canal_check CHECK (canal = ANY (ARRAY['seap_cn'::text, 'seap_scn'::text, 'seap_adv'::text, 'non_seap'::text])),
  reluare_a_id bigint REFERENCES public.ofertare_licitatii(id) ON DELETE SET NULL,
  rol_gazpet text NOT NULL DEFAULT 'lider'::text CONSTRAINT ofertare_licitatii_rol_gazpet_check
    CHECK (rol_gazpet = ANY (ARRAY['lider'::text, 'asociat'::text, 'subcontractant'::text, 'tert_sustinator'::text, 'neparticipare'::text])),
  segment text CONSTRAINT ofertare_licitatii_segment_check
    CHECK (segment = ANY (ARRAY['transgaz'::text, 'romgaz'::text, 'conpet'::text, 'distributie'::text, 'altele'::text])),
  c_notice_id bigint,
  sys_notice_type_id integer,
  documentatie_adusa_la timestamptz,
  regim_achizitie text,
  derogare_depunere boolean NOT NULL DEFAULT false,
  responsabil_id uuid REFERENCES public.profiles(id),
  contract_id bigint REFERENCES public.contracte_terti(id) ON DELETE SET NULL,
  derogare_motiv text);
-- Dependențele porții (doar coloanele citite).
CREATE TABLE public.ofertare_pt_pachet (
  id bigint PRIMARY KEY, licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  versiune integer NOT NULL, stare text NOT NULL DEFAULT 'propus'::text);
CREATE TABLE public.ofertare_cerinte (
  id bigint PRIMARY KEY, licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  inlocuita_de bigint, duplicat_al bigint, confirmata_de uuid);
CREATE TABLE public.documente_firma (
  id bigint PRIMARY KEY, utilizabil boolean NOT NULL DEFAULT true, fara_expirare boolean NOT NULL DEFAULT false,
  data_valabilitate date, se_reemite boolean NOT NULL DEFAULT false);
CREATE TABLE public.ofertare_acoperire (
  id bigint PRIMARY KEY, cerinta_id bigint NOT NULL REFERENCES public.ofertare_cerinte(id),
  status text NOT NULL DEFAULT 'in_lucru'::text, verificat_pe_scan boolean NOT NULL DEFAULT false,
  reverificare_ceruta boolean NOT NULL DEFAULT false, doc_firma_id bigint REFERENCES public.documente_firma(id));
-- Dependențele lui R5 (ofertare_r5_blocaj_sursa rulează codul LIVE; doar sursele lui sunt ciot):
-- v_ofertare_cantitati_nevalidate e aici tabel de fixture cu aceleași coloane ca view-ul live.
CREATE TABLE public.ofertare_cantitati (id bigserial PRIMARY KEY, licitatie_id bigint, um text);
CREATE TABLE public.v_ofertare_cantitati_nevalidate (
  licitatie_id bigint PRIMARY KEY,
  lista_f3_nevalidate bigint NOT NULL DEFAULT 0, lista_f3_validate_fara_cant bigint NOT NULL DEFAULT 0,
  invalidate_in_afara_retea bigint NOT NULL DEFAULT 0, total_invalidate bigint NOT NULL DEFAULT 0,
  unitate_schimbata_in_afara_retea bigint NOT NULL DEFAULT 0, um_de_normalizat_f3 bigint NOT NULL DEFAULT 0,
  retea_alte_unitati_lungimi_f3 bigint NOT NULL DEFAULT 0,
  transfer_conflicte_docs integer NOT NULL DEFAULT 0, transfer_conflicte_n integer NOT NULL DEFAULT 0,
  transfer_in_curs integer NOT NULL DEFAULT 0, transfer_conflicte_lista text);
CREATE FUNCTION public.ofertare_totaluri_control(p_licitatie_id bigint) RETURNS jsonb
  LANGUAGE sql STABLE AS $$ SELECT '[]'::jsonb $$;
CREATE FUNCTION public.ofertare_clasa_unitate(p_um text) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('tip', 'ok') $$;
-- Auditul J05, exact ca live.
CREATE TABLE public.ofertare_derogari_audit (
  id bigserial PRIMARY KEY,
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  actiune text NOT NULL CHECK (actiune IN ('derogare_acordata','derogare_retrasa','depusa_pe_derogare')),
  actor uuid,
  session_user_name text,
  motiv text,
  status_vechi text,
  status_nou text,
  creat_la timestamptz NOT NULL DEFAULT now());

-- ── Funcțiile: copiile LIVE din 30.09 (pg_get_functiondef, md5 verificat mai jos) ───────────
CREATE OR REPLACE FUNCTION public.fn_is_app_owner(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_owner = true);
$function$
;
CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma
               WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare')
  );
$function$
;
CREATE OR REPLACE FUNCTION public.fn_gate_depunere_derogare_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT session_user = 'postgres' OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_owner) $function$
;
CREATE OR REPLACE FUNCTION public.fn_ofertare_licitatii_scriere()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- SECURITY DEFINER: current_user este proprietarul funcției, nu apelantul.
  v_admin boolean := (session_user = 'postgres');
  v_ofertare boolean := (SELECT public.fn_are_acces_ofertare());
  v_service boolean := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true)
  ) = 'service_role';
BEGIN
  IF v_admin OR v_ofertare THEN
    RETURN NEW;
  END IF;
  IF v_service THEN
    IF (to_jsonb(OLD) - 'termen_depunere' - 'documentatie_adusa_la' - 'updated_at')
         IS DISTINCT FROM (to_jsonb(NEW) - 'termen_depunere' - 'documentatie_adusa_la' - 'updated_at') THEN
      RAISE EXCEPTION 'Contextul automat (service_role) poate modifica doar termen_depunere/documentatie_adusa_la'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_module_access u
    WHERE u.profile_id = auth.uid() AND u.module = 'financiar'
  ) THEN
    RAISE EXCEPTION 'Contextul curent nu poate modifica o licitație'
      USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(OLD) - 'contract_id' - 'updated_at')
       IS DISTINCT FROM (to_jsonb(NEW) - 'contract_id' - 'updated_at') THEN
    RAISE EXCEPTION 'Modulul financiar poate modifica doar contract_id pe o licitație'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ofertare_r5_blocaj_sursa(p_licitatie_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_tot jsonb; v_um int; v_tcd int; v_tcn int; v_tic int; v_tcl text; v_err text; v_c jsonb; v_k text; v_n bigint;
BEGIN
  BEGIN
    v_tot := public.ofertare_totaluri_control(p_licitatie_id);
    IF jsonb_typeof(v_tot) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'control TOTAL indisponibil'; END IF;
    SELECT count(*) INTO v_um FROM public.ofertare_cantitati q WHERE q.licitatie_id=p_licitatie_id
      AND public.ofertare_clasa_unitate(q.um)->>'tip'='de_verificat';
    SELECT to_jsonb(c) INTO v_c FROM public.v_ofertare_cantitati_nevalidate c WHERE c.licitatie_id = p_licitatie_id;
    SELECT coalesce(c.transfer_conflicte_docs, 0), coalesce(c.transfer_conflicte_n, 0), coalesce(c.transfer_in_curs, 0), c.transfer_conflicte_lista
      INTO v_tcd, v_tcn, v_tic, v_tcl FROM public.v_ofertare_cantitati_nevalidate c WHERE c.licitatie_id = p_licitatie_id;
  EXCEPTION WHEN others THEN v_err := SQLERRM;
  END;
  IF v_err IS NOT NULL THEN
    RETURN format(': nu putem verifica sursa cantităților (conflictele transferului din planșe: %s) — nu înseamnă zero restanțe', v_err);
  END IF;
  -- F01: aceleași șapte contoare ca poarta JS; înainte de restanțele transferului.
  FOREACH v_k IN ARRAY ARRAY['lista_f3_nevalidate','lista_f3_validate_fara_cant','invalidate_in_afara_retea',
    'total_invalidate','unitate_schimbata_in_afara_retea','um_de_normalizat_f3','retea_alte_unitati_lungimi_f3'] LOOP
    IF v_c IS NOT NULL AND (v_c->>v_k IS NULL) THEN
      RETURN format(' — nu putem verifica cantitățile: contorul %s lipsește', v_k);
    END IF;
    v_n := coalesce((v_c->>v_k)::bigint,0);
    IF v_n > 0 THEN RETURN format(' — cantități de verificat: %s = %s; verifică și validează pozițiile în Cantități',v_k,v_n); END IF;
  END LOOP;
  IF v_um > 0 THEN RETURN ' — unitate de verificat: baza cantităților este incompletă'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_tot) t WHERE t->>'stare' <> 'ok') THEN
    RETURN ' — ' || (SELECT string_agg(DISTINCT t->>'text',' ') FROM jsonb_array_elements(v_tot) t WHERE t->>'stare'<>'ok');
  END IF;
  IF coalesce(v_tcd, 0) > 0 THEN
    RETURN format(' — sursa cantităților e incompletă: %s la transferul din %s (%s): rezolvă-le (recitire care le acoperă) sau confirmă-le în Documente (rezolvare / excepție justificată, cu drept de decizie)',
      CASE WHEN v_tcn = 1 THEN '1 restanță deschisă' ELSE v_tcn || ' restanțe deschise' END, CASE WHEN v_tcd = 1 THEN '1 planșă' ELSE v_tcd || ' planșe' END,
      coalesce(v_tcl, '—'));
  END IF;
  IF coalesce(v_tic, 0) > 0 THEN
    RETURN format(' — transfer din planșă în curs (%s documente): impactul asupra cantităților nu e stabilit; reîncearcă după ce se termină', v_tic);
  END IF;
  RETURN NULL;
END $function$
;
CREATE OR REPLACE FUNCTION public.fn_gate_depunere()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_active int; n_neconfirmate int; n_neacoperite int; n_rosii int; n_reverif int; msg text; v_r5 text;
BEGIN
  IF COALESCE(NEW.derogare_depunere, false) AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.derogare_depunere, false))
     AND NOT public.fn_gate_depunere_derogare_owner() THEN
    RAISE EXCEPTION 'Derogarea de la poarta de depunere o poate da doar ownerul (Razvan).' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'depusa' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'depusa') AND NOT COALESCE(NEW.derogare_depunere, false) THEN
    IF NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet p WHERE p.licitatie_id = NEW.id AND p.stare = 'depus') THEN
      RAISE EXCEPTION 'BLOCAT LA DEPUNERE: lipseste pachetul PT in stare depus pentru licitatia %.', NEW.id USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*) INTO n_active FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL;
    IF n_active = 0 THEN
      RAISE EXCEPTION 'BLOCAT LA DEPUNERE: 0 cerinte extrase active pentru licitatia %.', NEW.id USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*) INTO n_neconfirmate FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL AND c.confirmata_de IS NULL;
    SELECT count(*) INTO n_neacoperite FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id
            AND (a.status = 'nu_se_aplica'
                 OR (a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta, false))));
    SELECT count(*) INTO n_rosii FROM ofertare_acoperire a
      JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      JOIN documente_firma d ON d.id = a.doc_firma_id
      WHERE NOT d.utilizabil
         OR (NOT d.fara_expirare AND d.data_valabilitate IS NOT NULL AND
             d.data_valabilitate < COALESCE(NEW.termen_depunere::date, CURRENT_DATE) + CASE WHEN d.se_reemite THEN 0 ELSE 90 END);
    SELECT count(*) INTO n_reverif FROM ofertare_acoperire a
      JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      WHERE a.status IN ('acoperit','acoperit_partener') AND COALESCE(a.reverificare_ceruta, false);
    IF n_neconfirmate > 0 OR n_neacoperite > 0 OR n_rosii > 0 OR n_reverif > 0 THEN
      msg := format('BLOCAT LA DEPUNERE: %s cerințe neconfirmate de om, %s cerințe fără acoperire VERIFICATĂ de om (propunerea AI nu e dovadă), %s dovezi roșii (expirate/expiră <90 zile după termen/neutilizabile; certificatele de 30 zile trebuie valabile în ziua depunerii), %s dovezi cu reverificare cerută. Rezolvă-le sau derogare_depunere=true (o poate pune doar ownerul).', n_neconfirmate, n_neacoperite, n_rosii, n_reverif);
      RAISE EXCEPTION '%', msg;
    END IF;
  END IF;
  IF NEW.status = 'depusa' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'depusa') THEN
    v_r5 := public.ofertare_r5_blocaj_sursa(NEW.id);
    IF v_r5 IS NOT NULL THEN
      RAISE EXCEPTION 'BLOCAT LA DEPUNERE%. Oferta nu se depune cu sursa cantităților nerezolvată; derogare_depunere=true doar cu decizia lui Razvan (pentru partea asta contează doar dacă depunerea o face ownerul / responsabilul / un admin Ofertare).', v_r5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF COALESCE(NEW.derogare_depunere, false)
     AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.derogare_depunere, false)) THEN
    INSERT INTO public.ofertare_derogari_audit
      (licitatie_id, actiune, actor, session_user_name, motiv, status_vechi, status_nou)
    VALUES (NEW.id, 'derogare_acordata', auth.uid(), session_user, NEW.derogare_motiv,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status);
  END IF;
  IF NEW.status = 'depusa' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'depusa')
     AND COALESCE(NEW.derogare_depunere, false) THEN
    INSERT INTO public.ofertare_derogari_audit
      (licitatie_id, actiune, actor, session_user_name, motiv, status_vechi, status_nou)
    VALUES (NEW.id, 'depusa_pe_derogare', auth.uid(), session_user, NEW.derogare_motiv,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status);
    RAISE NOTICE 'DEROGARE LA DEPUNERE: licitatie_id=%, auth.uid=%, session_user=%, operatie=%, derogare_depunere=true',
      NEW.id, auth.uid(), session_user, TG_OP;
  END IF;
  RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.ofertare_derogare_depunere(p_licitatie_id bigint, p_motiv text, p_acorda boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vechi public.ofertare_licitatii%ROWTYPE;
  v_nou public.ofertare_licitatii%ROWTYPE;
  v_motiv text := nullif(btrim(p_motiv), '');
BEGIN
  IF NOT public.fn_gate_depunere_derogare_owner() THEN
    RAISE EXCEPTION 'Derogarea de la poarta de depunere o poate da doar ownerul (Razvan).' USING ERRCODE = '42501';
  END IF;
  IF p_acorda IS NULL THEN
    RAISE EXCEPTION 'p_acorda trebuie să fie true sau false.' USING ERRCODE = '22023';
  END IF;
  IF p_acorda AND (v_motiv IS NULL OR char_length(v_motiv) < 10) THEN
    RAISE EXCEPTION 'Motivul derogării trebuie să aibă minimum 10 caractere.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_vechi FROM public.ofertare_licitatii WHERE id = p_licitatie_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Licitația % nu există.', p_licitatie_id USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.ofertare_licitatii
    SET derogare_depunere = p_acorda, derogare_motiv = v_motiv
    WHERE id = p_licitatie_id RETURNING * INTO v_nou;
  IF NOT p_acorda OR COALESCE(v_vechi.derogare_depunere, false) THEN
    INSERT INTO public.ofertare_derogari_audit
      (licitatie_id, actiune, actor, session_user_name, motiv, status_vechi, status_nou)
    VALUES (p_licitatie_id, CASE WHEN p_acorda THEN 'derogare_acordata' ELSE 'derogare_retrasa' END,
      auth.uid(), session_user, v_motiv, v_vechi.status, v_nou.status);
  END IF;
END $function$
;
CREATE OR REPLACE FUNCTION public.fn_ofertare_derogari_audit_imuabil()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'Auditul derogărilor este append-only: % interzis.', TG_OP USING ERRCODE = '42501';
END $function$
;

-- ACL-urile LIVE din 30.09 (pg_proc.proacl); privilegiile implicite de mai sus se anulează explicit.
REVOKE ALL ON FUNCTION public.fn_is_app_owner(uuid), public.fn_are_acces_ofertare(), public.fn_gate_depunere_derogare_owner(),
  public.fn_ofertare_licitatii_scriere(), public.ofertare_r5_blocaj_sursa(bigint), public.fn_gate_depunere(),
  public.ofertare_derogare_depunere(bigint, text, boolean), public.fn_ofertare_derogari_audit_imuabil()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_app_owner(uuid), public.fn_are_acces_ofertare() TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gate_depunere_derogare_owner(), public.fn_ofertare_licitatii_scriere(),
  public.ofertare_r5_blocaj_sursa(bigint), public.fn_gate_depunere() TO service_role;
GRANT EXECUTE ON FUNCTION public.ofertare_derogare_depunere(bigint, text, boolean) TO authenticated;

-- Tabele: RLS + politici + ACL ca live.
ALTER TABLE public.ofertare_licitatii ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertare_licitatii_delete ON public.ofertare_licitatii FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_owner));
CREATE POLICY ofertare_licitatii_insert ON public.ofertare_licitatii FOR INSERT TO authenticated
  WITH CHECK ((SELECT fn_are_acces_ofertare()));
CREATE POLICY ofertare_licitatii_select ON public.ofertare_licitatii FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_licitatii_update ON public.ofertare_licitatii FOR UPDATE TO authenticated
  USING ((SELECT fn_are_acces_ofertare()) OR EXISTS (SELECT 1 FROM user_module_access u WHERE u.profile_id = auth.uid() AND u.module = 'financiar'))
  WITH CHECK ((SELECT fn_are_acces_ofertare()) OR EXISTS (SELECT 1 FROM user_module_access u WHERE u.profile_id = auth.uid() AND u.module = 'financiar'));
-- relacl live: anon / authenticated / service_role = arwdDxtm (vin din privilegiile implicite de mai sus).
ALTER TABLE public.ofertare_derogari_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertare_derogari_audit_select ON public.ofertare_derogari_audit FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (SELECT public.fn_are_acces_ofertare()));
REVOKE ALL ON TABLE public.ofertare_derogari_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ofertare_derogari_audit TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.ofertare_derogari_audit_id_seq FROM PUBLIC, anon, authenticated, service_role;
-- Politicile de SELECT/UPDATE (financiar) citesc user_module_access / profiles ca apelant.
REVOKE ALL ON TABLE public.profiles, public.user_module_access FROM anon;

-- Triggerele live.
CREATE TRIGGER a00_ofertare_licitatii_scriere BEFORE UPDATE ON public.ofertare_licitatii
  FOR EACH ROW EXECUTE FUNCTION fn_ofertare_licitatii_scriere();
CREATE TRIGGER trg_gate_depunere BEFORE INSERT OR UPDATE ON public.ofertare_licitatii
  FOR EACH ROW EXECUTE FUNCTION fn_gate_depunere();
CREATE TRIGGER trg_ofertare_derogari_audit_imuabil BEFORE DELETE OR UPDATE OR TRUNCATE ON public.ofertare_derogari_audit
  FOR EACH STATEMENT EXECUTE FUNCTION fn_ofertare_derogari_audit_imuabil();

-- ── Harness (schema t, doar în baza de test) ─────────────────────────────────
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO PUBLIC;
CREATE EXTENSION dblink SCHEMA t;

-- md5-urile citite read-only din live pe 30.09 (PG 17.6): funcții, triggere, constrângeri, politici.
CREATE TABLE t.md5_live (obiect text PRIMARY KEY, tip text NOT NULL, md5 text NOT NULL);
INSERT INTO t.md5_live VALUES
  ('auth.uid()',                                            'f', 'ea3b41bf29e2ad573067939329aa088e'),
  ('auth.role()',                                           'f', '8a3e05459e07e0633d43c6fba2a2cdf4'),
  ('auth.jwt()',                                            'f', '20054548ba2003f61a6bcb472175700b'),
  ('public.fn_is_app_owner(uuid)',                          'f', '133537ab8080f3da5aa4c145dd5fd93c'),
  ('public.fn_are_acces_ofertare()',                        'f', '6991b618d5fabbefdbd14684d335db48'),
  ('public.fn_gate_depunere_derogare_owner()',              'f', 'adc668e7c06429c70e69a9d1a62ad094'),
  ('public.fn_ofertare_licitatii_scriere()',                'f', '081cd829e8400001e1c31ea6e6506a8f'),
  ('public.fn_gate_depunere()',                             'f', 'b62acc0fef2b0da29e48de6d303fcf5e'),
  ('public.ofertare_derogare_depunere(bigint,text,boolean)','f', '6047e5c3e4d159d5a7a85a7194041eca'),
  ('public.fn_ofertare_derogari_audit_imuabil()',           'f', '6b8c51a4aa01852998015d8d3a325551'),
  ('public.ofertare_r5_blocaj_sursa(bigint)',               'f', '1854c19c60be93f6848136a4a05f876a'),
  ('a00_ofertare_licitatii_scriere',                        't', '35bfc3734ba733dcc678918a5fae2e9c'),
  ('trg_gate_depunere',                                     't', 'acaab0c9559992529c18cb9af23511fb'),
  ('trg_ofertare_derogari_audit_imuabil',                   't', '104048dda78640864201ad853fc2df9d'),
  ('ofertare_derogari_audit_actiune_check',                 'c', 'ccb3f643d993ae9d68284aca20a58366'),
  ('ofertare_derogari_audit_licitatie_id_fkey',             'c', '5d7a55a7ffb6f27375309665934dd04b'),
  ('ofertare_derogari_audit_pkey',                          'c', '4c6419b3704337bbfe50f018842a9ad3'),
  ('ofertare_derogari_audit_select',                        'p', '9cb4e3d817c2dc9142a5015de88b05f0'),
  ('ofertare_licitatii_delete',                             'p', '4221a23071987f0e79c5b46bd4a6e796'),
  ('ofertare_licitatii_insert',                             'p', '94a6245ce427b39edc69e7a8481d0bc8'),
  ('ofertare_licitatii_select',                             'p', 'b3b3b08777360546899db966610ec99a'),
  ('ofertare_licitatii_update',                             'p', '56c65fe8d7b3404990fe43e3278aa30b');
-- ACL-urile live ale funcțiilor (proacl::text, 30.09).
CREATE TABLE t.acl_live (obiect text PRIMARY KEY, acl text NOT NULL);
INSERT INTO t.acl_live VALUES
  ('public.fn_is_app_owner(uuid)',                          '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}'),
  ('public.fn_are_acces_ofertare()',                        '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}'),
  ('public.fn_gate_depunere_derogare_owner()',              '{postgres=X/postgres,service_role=X/postgres}'),
  ('public.fn_ofertare_licitatii_scriere()',                '{postgres=X/postgres,service_role=X/postgres}'),
  ('public.fn_gate_depunere()',                             '{postgres=X/postgres,service_role=X/postgres}'),
  ('public.ofertare_r5_blocaj_sursa(bigint)',               '{postgres=X/postgres,service_role=X/postgres}'),
  ('public.ofertare_derogare_depunere(bigint,text,boolean)','{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.fn_ofertare_derogari_audit_imuabil()',           '{postgres=X/postgres}');
-- Orice diferență față de live (md5 / ACL). Gol = copia e fidelă.
CREATE FUNCTION t.diferente_live() RETURNS TABLE(obiect text, asteptat text, gasit text) LANGUAGE sql STABLE AS $f$
  SELECT l.obiect, l.md5, x.m FROM t.md5_live l
  CROSS JOIN LATERAL (SELECT CASE l.tip
      WHEN 'f' THEN (SELECT md5(pg_get_functiondef(to_regprocedure(l.obiect))))
      WHEN 't' THEN (SELECT md5(pg_get_triggerdef(tg.oid)) FROM pg_trigger tg WHERE tg.tgname = l.obiect AND NOT tg.tgisinternal)
      WHEN 'c' THEN (SELECT md5(pg_get_constraintdef(c.oid)) FROM pg_constraint c WHERE c.conname = l.obiect)
      WHEN 'p' THEN (SELECT md5(coalesce(p.qual, '') || '|' || coalesce(p.with_check, '')) FROM pg_policies p WHERE p.policyname = l.obiect)
    END AS m) x
  WHERE x.m IS DISTINCT FROM l.md5
  UNION ALL
  SELECT a.obiect, a.acl, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(a.obiect))
  FROM t.acl_live a
  WHERE (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(a.obiect)) IS DISTINCT FROM a.acl
  UNION ALL
  SELECT 'triggere pe ofertare_licitatii', 'a00_ofertare_licitatii_scriere,trg_gate_depunere',
         (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.ofertare_licitatii'::regclass AND NOT tgisinternal)
  WHERE (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.ofertare_licitatii'::regclass AND NOT tgisinternal)
        IS DISTINCT FROM 'a00_ofertare_licitatii_scriere,trg_gate_depunere'
$f$;

-- Raportare: o linie NOTICE per aserțiune; nu oprește scriptul.
CREATE FUNCTION t.rez(p_tip text, p_cod text, p_cat text, p_ok boolean, p_obs text, p_desc text) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  RAISE NOTICE 'REZ|%|%|%|%|%|%|%', current_setting('t.faza', true), p_tip, p_cod, p_cat,
    CASE WHEN p_ok IS TRUE THEN 'OK' ELSE 'FAIL' END,
    left(regexp_replace(replace(coalesce(p_obs, '-'), '|', '/'), '\s+', ' ', 'g'), 170),
    replace(p_desc, '|', '/');
END $f$;
CREATE FUNCTION t.ok(p_cod text, p_cat text, p_cond boolean, p_desc text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM t.rez('ok', p_cod, p_cat, p_cond IS TRUE,
    CASE WHEN p_cond IS TRUE THEN 'da' WHEN p_cond IS FALSE THEN 'nu' ELSE 'NULL' END, p_desc);
END $f$;

-- Identități. sesiune = SET SESSION AUTHORIZATION (login), rol = SET ROLE, claims = request.jwt.claims.
CREATE TABLE t.identitati (nume text PRIMARY KEY, sesiune text, rol text, claims text);
INSERT INTO t.identitati VALUES
  ('admin',               NULL,                  NULL,            ''),
  ('owner',               'authenticator',       'authenticated', jsonb_build_object('sub', :'OWNER',  'role', 'authenticated')::text),
  ('owner_mcp',           NULL,                  'authenticated', jsonb_build_object('sub', :'OWNER',  'role', 'authenticated')::text),
  ('editor',              'authenticator',       'authenticated', jsonb_build_object('sub', :'EDITOR', 'role', 'authenticated')::text),
  ('viewer',              'authenticator',       'authenticated', jsonb_build_object('sub', :'VIEWER', 'role', 'authenticated')::text),
  ('admmod',              'authenticator',       'authenticated', jsonb_build_object('sub', :'ADMMOD', 'role', 'authenticated')::text),
  ('financiar',           'authenticator',       'authenticated', jsonb_build_object('sub', :'FINANC', 'role', 'authenticated')::text),
  ('nomod',               'authenticator',       'authenticated', jsonb_build_object('sub', :'NOMOD',  'role', 'authenticated')::text),
  ('service',             'authenticator',       'service_role',  '{"role": "service_role"}'),
  ('anon',                'authenticator',       'anon',          '{"role": "anon"}'),
  ('fara_sub',            'authenticator',       'authenticated', '{"role": "authenticated"}'),
  ('sub_fantoma',         'authenticator',       'authenticated', '{"sub": "00000000-0000-4000-8000-00000000dead", "role": "authenticated"}'),
  ('rol_strain',          'authenticator',       'authenticated', jsonb_build_object('sub', :'OWNER', 'role', 'postgres')::text),
  ('authenticator_gol',   'authenticator',       NULL,            ''),
  ('auth_admin_gol',      'supabase_auth_admin', NULL,            ''),
  ('supabase_admin_gol',  'supabase_admin',      NULL,            ''),
  ('admin_claims_editor', NULL,                  NULL,            jsonb_build_object('sub', :'EDITOR', 'role', 'authenticated')::text);
GRANT SELECT ON t.identitati TO PUBLIC;
CREATE FUNCTION t.ca(p_ident text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r record;
BEGIN
  SELECT * INTO STRICT r FROM t.identitati WHERE nume = p_ident;
  EXECUTE 'RESET ROLE';
  EXECUTE 'RESET SESSION AUTHORIZATION';
  IF r.sesiune IS NOT NULL THEN EXECUTE format('SET SESSION AUTHORIZATION %I', r.sesiune); END IF;
  IF r.rol IS NOT NULL THEN EXECUTE format('SET ROLE %I', r.rol); END IF;
  PERFORM set_config('request.jwt.claims', coalesce(r.claims, ''), false);
END $f$;

-- Motivele de test (textul exact; MA are diacritice, ghilimele românești, linie nouă).
CREATE TABLE t.motive (cod text PRIMARY KEY, m text NOT NULL);
INSERT INTO t.motive VALUES
  ('M0',    'Derogare fixture M0: dosar incomplet la termen, decizia ownerului (test J05).'),
  ('MR',    'Depunere Jilava PT93: 280 cerințe neverificate de om până la termen; decizia lui Răzvan, 30.09.2026.'),
  ('MA',    E'Derogare atomică J05 — PT93 cu R5 curat;\nmotiv aprobat de owner, păstrat exact: ș ț ă î â „citat”.'),
  ('MB',    'Motiv B scris în cursă după depunere: nu trebuie să intre.'),
  ('MX',    'Motiv rescris de un non-owner, fără audit.'),
  ('MESEC', 'ESEC AUDIT J05: a doua înregistrare de audit trebuie să cadă.');
GRANT SELECT ON t.motive TO PUBLIC;
CREATE FUNCTION t.m(p_cod text) RETURNS text LANGUAGE sql STABLE AS $f$ SELECT m FROM t.motive WHERE cod = p_cod $f$;
CREATE FUNCTION t.sha(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT encode(sha256(convert_to(p, 'UTF8')), 'hex') $f$;

-- Starea unei licitații + instantaneu (rândul + auditul) înainte de fiecare caz.
CREATE FUNCTION t.stare(p_lic bigint) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT format('%s|%s|%s', status, derogare_depunere, coalesce(md5(derogare_motiv), 'NULL'))
  FROM public.ofertare_licitatii WHERE id = p_lic $f$;
CREATE FUNCTION t.n_audit(p_lic bigint) RETURNS bigint LANGUAGE sql STABLE AS $f$
  SELECT count(*) FROM public.ofertare_derogari_audit WHERE licitatie_id = p_lic $f$;
CREATE TABLE t.instantaneu (lic bigint PRIMARY KEY, stare text, n_audit bigint, max_id bigint);
CREATE FUNCTION t.fixeaza(p_lic bigint) RETURNS void LANGUAGE sql AS $f$
  DELETE FROM t.instantaneu WHERE lic = p_lic;
  INSERT INTO t.instantaneu SELECT p_lic, t.stare(p_lic), t.n_audit(p_lic),
    coalesce((SELECT max(id) FROM public.ofertare_derogari_audit), 0);
$f$;
-- Rândurile de audit apărute după instantaneu (ordonate după id).
CREATE FUNCTION t.noi(p_lic bigint) RETURNS SETOF public.ofertare_derogari_audit LANGUAGE sql STABLE AS $f$
  SELECT a.* FROM public.ofertare_derogari_audit a JOIN t.instantaneu i ON i.lic = p_lic
  WHERE a.licitatie_id = p_lic AND a.id > i.max_id ORDER BY a.id $f$;
CREATE FUNCTION t.neschimbat(p_cod text, p_cat text, p_lic bigint) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM t.ok(p_cod, p_cat, (SELECT t.stare(p_lic) = i.stare AND t.n_audit(p_lic) = i.n_audit
                              FROM t.instantaneu i WHERE i.lic = p_lic),
    format('L%s: rândul (status/derogare/motiv) și auditul rămân exact ca înainte', p_lic));
END $f$;

-- Un caz: comută identitatea, încearcă instrucțiunea, revine la admin, raportează.
CREATE FUNCTION t.caz(p_cod text, p_cat text, p_ident text, p_sql text, p_stare text, p_fragment text,
                      p_desc text, p_randuri bigint DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_state text; v_msg text; v_n bigint; v_ok boolean; v_obs text;
BEGIN
  PERFORM t.ca(p_ident);
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  PERFORM t.ca('admin');
  IF v_state IS NULL THEN
    v_obs := format('trece (%s %s)', v_n, CASE WHEN v_n = 1 THEN 'rând' ELSE 'rânduri' END);
    v_ok := p_stare IS NULL AND (p_randuri IS NULL OR v_n = p_randuri);
  ELSE
    v_obs := v_state || ' ' || v_msg;
    v_ok := p_stare IS NOT NULL AND v_state = p_stare AND (p_fragment IS NULL OR position(p_fragment IN v_msg) > 0);
  END IF;
  PERFORM t.rez('caz', p_cod, p_cat, v_ok, v_obs, p_desc || ' [' || p_ident || ']');
END $f$;

-- RPC de probă (NU există în producție): SECURITY DEFINER al lui postgres, apelabil de oricine →
-- ajunge la rând ocolind RLS, ca orice RPC definer. Arată că garda nu depinde de calea de acces.
CREATE FUNCTION t.sonda_rpc(p_id bigint, p_motiv text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE n bigint;
BEGIN
  UPDATE public.ofertare_licitatii SET derogare_motiv = p_motiv WHERE id = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $f$;
GRANT EXECUTE ON FUNCTION t.sonda_rpc(bigint, text) TO PUBLIC;

-- Concurență: două sesiuni reale prin dblink (A în tranzacție, B blocată pe lacătul rândului).
CREATE FUNCTION t.dsn() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT format('host=127.0.0.1 port=%s dbname=%s user=postgres application_name=j05_dblink',
                current_setting('port'), current_database()) $f$;
CREATE FUNCTION t.tenta(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n bigint; s text; m text;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN 'trece (' || n || ')';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE, m = MESSAGE_TEXT;
  RETURN s || ' ' || m;
END $f$;
CREATE FUNCTION t.dbl_sesiune(p_conn text, p_ident text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r record;
BEGIN
  SELECT * INTO STRICT r FROM t.identitati WHERE nume = p_ident;
  PERFORM t.dblink_connect(p_conn, t.dsn());
  IF r.sesiune IS NOT NULL THEN PERFORM t.dblink_exec(p_conn, format('SET SESSION AUTHORIZATION %I', r.sesiune)); END IF;
  IF r.rol IS NOT NULL THEN PERFORM t.dblink_exec(p_conn, format('SET ROLE %I', r.rol)); END IF;
  PERFORM t.dblink_exec(p_conn, format('SET request.jwt.claims = %L', coalesce(r.claims, '')));
END $f$;
CREATE FUNCTION t.concurenta(p_sql_a text, p_sql_b text, p_ident_b text, p_rr boolean DEFAULT false,
  OUT rez_a text, OUT rez_b text, OUT b_blocat boolean, OUT rez_b_reluare text) LANGUAGE plpgsql AS $f$
DECLARE v_pid int;
BEGIN
  PERFORM t.dbl_sesiune('j05a', 'owner');
  PERFORM t.dbl_sesiune('j05b', p_ident_b);
  SELECT x.pid INTO v_pid FROM t.dblink('j05b', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM t.dblink_exec('j05a', 'BEGIN');
  SELECT x.r INTO rez_a FROM t.dblink('j05a', format('SELECT t.tenta(%L)', p_sql_a)) AS x(r text);
  IF p_rr THEN   -- B își ia instantaneul ÎNAINTE de COMMIT-ul lui A
    PERFORM t.dblink_exec('j05b', 'BEGIN ISOLATION LEVEL REPEATABLE READ');
    PERFORM x.n FROM t.dblink('j05b', 'SELECT count(*) FROM public.ofertare_licitatii') AS x(n bigint);
  END IF;
  PERFORM t.dblink_send_query('j05b', format('SELECT t.tenta(%L)', p_sql_b));
  b_blocat := false;
  FOR i IN 1..200 LOOP
    b_blocat := EXISTS (SELECT 1 FROM pg_locks WHERE pid = v_pid AND NOT granted);
    EXIT WHEN b_blocat;
    PERFORM pg_sleep(0.05);
  END LOOP;
  PERFORM t.dblink_exec('j05a', 'COMMIT');
  SELECT x.r INTO rez_b FROM t.dblink_get_result('j05b') AS x(r text);
  PERFORM x.r FROM t.dblink_get_result('j05b') AS x(r text);        -- rezultatul gol de final
  IF p_rr THEN
    PERFORM t.dblink_exec('j05b', 'ROLLBACK');
    SELECT x.r INTO rez_b_reluare FROM t.dblink('j05b', format('SELECT t.tenta(%L)', p_sql_b)) AS x(r text);
  END IF;
  PERFORM t.dblink_disconnect('j05a');
  PERFORM t.dblink_disconnect('j05b');
END $f$;

-- ── Verificarea copiei: md5 + ACL = live ─────────────────────────────────────
DO $md5$
DECLARE v text;
BEGIN
  SELECT string_agg(format('%s: așteptat %s, găsit %s', obiect, asteptat, coalesce(gasit, 'LIPSĂ')), E'\n') INTO v
  FROM t.diferente_live();
  IF v IS NOT NULL THEN
    RAISE EXCEPTION E'SETUP: scheletul NU e copia live:\n%', v;
  END IF;
  RAISE NOTICE 'SETUP: % obiecte cu md5 = live, % ACL-uri de funcții = live', (SELECT count(*) FROM t.md5_live), (SELECT count(*) FROM t.acl_live);
END $md5$;

-- ── Fixture (fără date reale) ─────────────────────────────────────────────────
INSERT INTO public.profiles (id, email, is_owner) VALUES
  (:'OWNER',  'owner.j05@test.local',     true),
  (:'EDITOR', 'editor.j05@test.local',    false),
  (:'VIEWER', 'viewer.j05@test.local',    false),
  (:'ADMMOD', 'admmod.j05@test.local',    false),
  (:'FINANC', 'financiar.j05@test.local', false),
  (:'NOMOD',  'nomod.j05@test.local',     false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  (:'EDITOR', 'ofertare', 'editor'), (:'VIEWER', 'ofertare', 'viewer'),
  (:'ADMMOD', 'ofertare', 'admin'),  (:'FINANC', 'financiar', 'editor');
GRANT SELECT ON public.profiles, public.user_module_access TO authenticated;
INSERT INTO public.contracte_terti (id) VALUES (1);
INSERT INTO public.ofertare_licitatii (id, nr_anunt, autoritate, obiect, status) OVERRIDING SYSTEM VALUE
  SELECT i, 'J05-L' || i, 'Autoritate test J05', 'Obiect test J05 nr. ' || i, 'in_lucru'
  FROM unnest(ARRAY[10, 11, 12, 13, 14, 15, 16, 20, 21, 22, 23]) AS i;
-- L10 / L15: J02 satisfăcută (pachet depus + o cerință confirmată, acoperită și verificată).
INSERT INTO public.ofertare_pt_pachet (id, licitatie_id, versiune, stare) VALUES (10, 10, 1, 'depus'), (15, 15, 1, 'depus');
INSERT INTO public.ofertare_cerinte (id, licitatie_id, confirmata_de) VALUES (100, 10, :'EDITOR'), (150, 15, :'EDITOR');
INSERT INTO public.ofertare_acoperire (id, cerinta_id, status, verificat_pe_scan) VALUES (100, 100, 'acoperit', true), (150, 150, 'acoperit', true);
-- L14: R5 blochează (un contor al cantităților > 0).
INSERT INTO public.v_ofertare_cantitati_nevalidate (licitatie_id, total_invalidate) VALUES (14, 1);
-- Stări ca în producție, pe fluxurile reale: ownerul acordă prin RPC (L11, L12, L16), depune L12 și L16;
-- editorul depune normal L15 și trece L16 în „castigata”.
SELECT t.ca('owner');
SELECT public.ofertare_derogare_depunere(i, t.m('M0')) FROM unnest(ARRAY[11, 12, 16]) AS i;
UPDATE public.ofertare_licitatii SET status = 'depusa' WHERE id IN (12, 16);
SELECT t.ca('editor');
UPDATE public.ofertare_licitatii SET status = 'depusa' WHERE id = 15;
UPDATE public.ofertare_licitatii SET status = 'castigata' WHERE id = 16;
SELECT t.ca('admin');
DO $fix$
DECLARE m0 text := md5(t.m('M0'));
BEGIN
  IF t.stare(11) <> 'in_lucru|t|' || m0 OR t.n_audit(11) <> 1
     OR t.stare(12) <> 'depusa|t|' || m0 OR t.n_audit(12) <> 2
     OR t.stare(15) <> 'depusa|f|NULL' OR t.n_audit(15) <> 0
     OR t.stare(16) <> 'castigata|t|' || m0 OR t.n_audit(16) <> 2
     OR EXISTS (SELECT 1 FROM unnest(ARRAY[10, 13, 14, 20, 21, 22, 23]) AS i
                WHERE t.stare(i) <> 'in_lucru|f|NULL' OR t.n_audit(i) <> 0) THEN
    RAISE EXCEPTION 'SETUP: fixture-ul nu are stările așteptate.';
  END IF;
  RAISE NOTICE 'SETUP: fixture gata (L10–L16, L20–L23; % evenimente de audit)', (SELECT count(*) FROM public.ofertare_derogari_audit);
END $fix$;
\echo 'SETUP OK'
\endif

-- ════════════════════════════════════════════════════════════════════════════
\if :f_teste
SELECT set_config('t.faza', :'faza', false) \gset x_
SELECT t.ca('admin');

-- ── Cataloage ──────────────────────────────────────────────────────────────
\if :f_live
SELECT t.ok('L01', 'L', to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NULL, 'starea live: funcția gărzii nu există');
SELECT t.ok('L02', 'L', NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'a00_ofertare_derogare_garda_j05'), 'starea live: triggerul gărzii nu există');
SELECT t.ok('L03', 'L', NOT EXISTS (SELECT 1 FROM t.diferente_live()), 'funcțiile / triggerele / constrângerile / politicile / ACL-urile au md5 = live 30.09');
\endif
\if :f_patch
SELECT t.ok('K01', 'K', (SELECT md5(prosrc) = 'f84c9aeeb80fd990ee6f5110865a1aac' AND prosecdef
                          AND proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(proowner) = 'postgres'
                          AND position('J05-20261001a' IN prosrc) > 0
                         FROM pg_proc WHERE oid = to_regprocedure('public.fn_ofertare_derogare_garda_j05()')),
  'garda: corpul din patch (md5), SECURITY DEFINER, search_path fixat, proprietar postgres');
SELECT t.ok('K02', 'K', NOT has_function_privilege('anon', 'public.fn_ofertare_derogare_garda_j05()', 'EXECUTE')
                    AND NOT has_function_privilege('authenticated', 'public.fn_ofertare_derogare_garda_j05()', 'EXECUTE')
                    AND NOT has_function_privilege('service_role', 'public.fn_ofertare_derogare_garda_j05()', 'EXECUTE')
                    AND (SELECT proacl::text FROM pg_proc WHERE oid = 'public.fn_ofertare_derogare_garda_j05()'::regprocedure) = '{postgres=X/postgres}',
  'garda nu e apelabilă din API (nici PUBLIC, în ciuda privilegiilor implicite Supabase)');
SELECT t.ok('K03', 'K', (SELECT md5(pg_get_triggerdef(oid)) = '242904dd6b644d7d65c9492bc8d5f1c5' AND tgenabled = 'O'
                                AND tgfoid = 'public.fn_ofertare_derogare_garda_j05()'::regprocedure
                         FROM pg_trigger WHERE tgname = 'a00_ofertare_derogare_garda_j05'),
  'trigger BEFORE UPDATE FOR EACH ROW, activ, legat de funcția gărzii');
SELECT t.ok('K04', 'K', (SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.ofertare_licitatii'::regclass AND NOT tgisinternal
                           AND (tgtype & 19) = 19 ORDER BY tgname COLLATE "C" LIMIT 1) = 'a00_ofertare_derogare_garda_j05',
  'garda e PRIMUL trigger BEFORE UPDATE (înaintea lui a00_ofertare_licitatii_scriere și a porții)');
SELECT t.ok('K05', 'K', (SELECT count(*) FROM t.diferente_live() WHERE obiect <> 'triggere pe ofertare_licitatii') = 0
                    AND (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.ofertare_licitatii'::regclass AND NOT tgisinternal)
                        = 'a00_ofertare_derogare_garda_j05,a00_ofertare_licitatii_scriere,trg_gate_depunere',
  'migrarea n-a atins nimic live: aceleași md5/ACL pentru funcții, triggere, constrângeri, politici; doar garda în plus');
\endif

-- ════════════════════════════════════════════════════════════════════════════
-- Partea 1 — o sesiune; fiecare caz într-un SAVEPOINT anulat la final (cazurile nu se influențează).
BEGIN;

-- ── P: gaura J05 (live permite) ────────────────────────────────────────────────
SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('P01', 'P', 'editor', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 11$q$, t.m('MX')),
  '42501', 'J05:', 'editor (modul Ofertare) rescrie motivul unei derogări active');
SELECT t.neschimbat('P01.b', 'P', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('P02', 'P', 'editor', $q$UPDATE public.ofertare_licitatii SET derogare_depunere = false WHERE id = 11$q$,
  '42501', 'J05:', 'editor retrage derogarea (true→false)');
SELECT t.neschimbat('P02.b', 'P', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('P03', 'P', 'editor', $q$UPDATE public.ofertare_licitatii SET derogare_depunere = false, derogare_motiv = NULL WHERE id = 11$q$,
  '42501', 'J05:', 'editor retrage derogarea și șterge motivul');
SELECT t.neschimbat('P03.b', 'P', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(10);
SELECT t.caz('P04', 'P', 'editor', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 10$q$, t.m('MX')),
  '42501', 'J05:', 'editor pre-completează motivul pe o licitație fără derogare (îl preia apoi o acordare doar pe flag)');
SELECT t.neschimbat('P04.b', 'P', 10);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('P05', 'P', 'viewer', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 11$q$, t.m('MX')),
  '42501', 'J05:', 'viewer (access_level=viewer, ignorat de fn_are_acces_ofertare) rescrie motivul');
SELECT t.neschimbat('P05.b', 'P', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('P06', 'P', 'admmod', $q$UPDATE public.ofertare_licitatii SET derogare_depunere = false WHERE id = 11$q$,
  '42501', 'J05:', 'admin de modul Ofertare (non-owner) retrage derogarea');
SELECT t.neschimbat('P06.b', 'P', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(12);
SELECT t.caz('P07', 'P', 'editor', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 12$q$, t.m('MX')),
  '42501', 'J05:', 'editor rescrie motivul DUPĂ depunere (L12 depusă pe derogare)');
SELECT t.neschimbat('P07.b', 'P', 12);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(12);
SELECT t.caz('P08', 'P', 'editor', $q$UPDATE public.ofertare_licitatii SET derogare_depunere = false WHERE id = 12$q$,
  '42501', 'J05:', 'editor retrage derogarea DUPĂ depunere');
SELECT t.neschimbat('P08.b', 'P', 12);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(12);
SELECT t.caz('P09', 'P', 'owner', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 12$q$, t.m('MR')),
  '42501', 'înghețate după depunere', 'owner (JWT) rescrie motivul DUPĂ depunere');
SELECT t.neschimbat('P09.b', 'P', 12);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(12);
SELECT t.caz('P10', 'P', 'owner', $q$UPDATE public.ofertare_licitatii SET derogare_depunere = false WHERE id = 12$q$,
  '42501', 'înghețate după depunere', 'owner (JWT) retrage derogarea DUPĂ depunere');
SELECT t.neschimbat('P10.b', 'P', 12);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(12);
SELECT t.caz('P11', 'P', 'owner', format($q$SELECT public.ofertare_derogare_depunere(12, %L)$q$, t.m('MR')),
  '42501', 'înghețate după depunere', 'owner prin RPC reacordă cu alt motiv DUPĂ depunere (live: trece, auditat de RPC)');
SELECT t.neschimbat('P11.b', 'P', 12);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(12);
SELECT t.caz('P12', 'P', 'owner', $q$SELECT public.ofertare_derogare_depunere(12, 'Retragere dupa depunere', false)$q$,
  '42501', 'înghețate după depunere', 'owner prin RPC retrage DUPĂ depunere (live: trece, auditat de RPC)');
SELECT t.neschimbat('P12.b', 'P', 12);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(15);
SELECT t.caz('P13', 'P', 'owner', format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L WHERE id = 15$q$, t.m('MR')),
  '42501', 'înghețate după depunere', 'owner pune derogare pe o licitație depusă normal (derogare retroactivă)');
SELECT t.neschimbat('P13.b', 'P', 15);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(12);
SELECT t.caz('P14', 'P', 'owner_mcp', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 12$q$, t.m('MR')),
  '42501', 'înghețate după depunere', 'sesiune postgres + SET ROLE authenticated + claims owner (MCP) rescrie motivul după depunere');
SELECT t.neschimbat('P14.b', 'P', 12);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('P15', 'P', 'admin_claims_editor', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 11$q$, t.m('MX')),
  '42501', 'J05:', 'sesiune postgres cu claims de non-owner rămase setate (identitatea JWT are prioritate)');
SELECT t.neschimbat('P15.b', 'P', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('P16', 'P', 'rol_strain', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 11$q$, t.m('MX')),
  '42501', 'J05:', 'claims cu sub = owner, dar role = „postgres” (doar role=authenticated trece)');
SELECT t.neschimbat('P16.b', 'P', 11);
ROLLBACK TO SAVEPOINT c;

-- ── H: întărire (live refuză deja prin a00, cu P0001; garda refuză cu 42501 indiferent de a00) ──
SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('H01', 'H', 'service', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 11$q$, t.m('MX')),
  '42501', 'J05:', 'service_role (cheia de backend) rescrie motivul');
SELECT t.neschimbat('H01.b', 'H', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('H02', 'H', 'service', $q$UPDATE public.ofertare_licitatii SET derogare_depunere = false WHERE id = 11$q$,
  '42501', 'J05:', 'service_role retrage derogarea');
SELECT t.neschimbat('H02.b', 'H', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('H03', 'H', 'anon', format($q$SELECT t.sonda_rpc(11, %L)$q$, t.m('MX')),
  '42501', 'J05:', 'anon printr-un RPC SECURITY DEFINER (ocolește RLS)');
SELECT t.neschimbat('H03.b', 'H', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('H04', 'H', 'financiar', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 11$q$, t.m('MX')),
  '42501', 'J05:', 'utilizator cu modulul financiar (trece de RLS) rescrie motivul');
SELECT t.neschimbat('H04.b', 'H', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('H05', 'H', 'fara_sub', format($q$SELECT t.sonda_rpc(11, %L)$q$, t.m('MX')),
  '42501', 'J05:', 'claims authenticated FĂRĂ sub, prin RPC definer');
SELECT t.neschimbat('H05.b', 'H', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('H06', 'H', 'sub_fantoma', format($q$SELECT t.sonda_rpc(11, %L)$q$, t.m('MX')),
  '42501', 'J05:', 'claims authenticated cu sub fără profil, prin RPC definer');
SELECT t.neschimbat('H06.b', 'H', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('H07', 'H', 'authenticator_gol', format($q$SELECT t.sonda_rpc(11, %L)$q$, t.m('MX')),
  '42501', 'fără identitate autorizată', 'login authenticator cu claims golite, prin RPC definer');
SELECT t.neschimbat('H07.b', 'H', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('H08', 'H', 'auth_admin_gol', format($q$SELECT t.sonda_rpc(11, %L)$q$, t.m('MX')),
  '42501', 'fără identitate autorizată', 'login supabase_auth_admin fără claims, prin RPC definer');
SELECT t.neschimbat('H08.b', 'H', 11);
ROLLBACK TO SAVEPOINT c;

-- ── R: fluxuri legitime / celelalte porți (trec pe live și pe patch) ──────────────────
-- R01–R02 + P17–P19: RPC → depunere → înghețul pe aceeași licitație (L10).
SAVEPOINT c; SELECT t.fixeaza(10);
SELECT t.caz('R01', 'R', 'owner', format($q$SELECT public.ofertare_derogare_depunere(10, %L)$q$, t.m('MR')),
  NULL, NULL, 'owner prin RPC ofertare_derogare_depunere acordă derogarea (L10)', 1);
SELECT t.ok('R01.b', 'R', (SELECT count(*) FROM t.noi(10)) = 1, 'exact 1 eveniment de audit nou');
SELECT t.ok('R01.c', 'R', (SELECT actiune FROM t.noi(10) LIMIT 1) = 'derogare_acordata', 'evenimentul e derogare_acordata (scris de poartă, nu de RPC)');
SELECT t.ok('R01.d', 'R', (SELECT actor = :'OWNER'::uuid AND session_user_name = 'authenticator' FROM t.noi(10) LIMIT 1), 'actor = ownerul nominal (JWT), sesiunea = authenticator');
SELECT t.ok('R01.e', 'R', (SELECT motiv = t.m('MR') FROM t.noi(10) LIMIT 1), 'motivul din audit = motivul aprobat (egalitate de text)');
SELECT t.ok('R01.f', 'R', (SELECT t.sha(motiv) = t.sha(t.m('MR')) FROM t.noi(10) LIMIT 1), 'motivul din audit = motivul aprobat (SHA-256)');
SELECT t.ok('R01.g', 'R', (SELECT status_vechi = 'in_lucru' AND status_nou = 'in_lucru' FROM t.noi(10) LIMIT 1), 'statusuri în audit: in_lucru → in_lucru');
SELECT t.ok('R01.h', 'R', (SELECT derogare_depunere AND derogare_motiv = t.m('MR') FROM public.ofertare_licitatii WHERE id = 10), 'licitația: derogare_depunere=true, motivul aprobat');
SELECT t.caz('R02', 'R', 'owner', $q$UPDATE public.ofertare_licitatii SET status = 'depusa' WHERE id = 10$q$,
  NULL, NULL, 'owner pune „depusa” după RPC', 1);
SELECT t.ok('R02.b', 'R', (SELECT count(*) FROM t.noi(10)) = 2, 'exact 2 evenimente noi în total (acordare + depunere)');
SELECT t.ok('R02.c', 'R', (SELECT array_agg(actiune ORDER BY id) FROM t.noi(10)) = ARRAY['derogare_acordata', 'depusa_pe_derogare'], 'al doilea eveniment e depusa_pe_derogare');
SELECT t.ok('R02.d', 'R', (SELECT motiv = t.m('MR') FROM t.noi(10) WHERE actiune = 'depusa_pe_derogare'), 'depusa_pe_derogare: motivul EXACT aprobat (text)');
SELECT t.ok('R02.e', 'R', (SELECT t.sha(motiv) = t.sha(t.m('MR')) FROM t.noi(10) WHERE actiune = 'depusa_pe_derogare'), 'depusa_pe_derogare: motivul EXACT aprobat (SHA-256)');
SELECT t.ok('R02.f', 'R', (SELECT actor = :'OWNER'::uuid AND status_vechi = 'in_lucru' AND status_nou = 'depusa' FROM t.noi(10) WHERE actiune = 'depusa_pe_derogare'), 'depusa_pe_derogare: actor owner, in_lucru → depusa');
SELECT t.ok('R02.g', 'R', (SELECT count(DISTINCT t.sha(motiv)) = 1 FROM t.noi(10)), 'același motiv în ambele evenimente (acordare = depunere)');
SELECT t.caz('P17', 'P', 'owner', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 10$q$, t.m('MX')),
  '42501', 'înghețate după depunere', 'după R02: owner rescrie motivul (UPDATE direct)');
SELECT t.caz('P18', 'P', 'owner', $q$SELECT public.ofertare_derogare_depunere(10, 'Retragere dupa depunere', false)$q$,
  '42501', 'înghețate după depunere', 'după R02: owner retrage prin RPC');
SELECT t.caz('P19', 'P', 'editor', $q$UPDATE public.ofertare_licitatii SET derogare_depunere = false WHERE id = 10$q$,
  '42501', 'J05:', 'după R02: editor retrage');
SELECT t.ok('P19.b', 'P', (SELECT status = 'depusa' AND derogare_depunere AND derogare_motiv = t.m('MR') FROM public.ofertare_licitatii WHERE id = 10)
                      AND (SELECT count(*) FROM t.noi(10)) = 2, 'după P17–P19: licitația și auditul exact ca după depunere');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('R03', 'R', 'editor', $q$UPDATE public.ofertare_licitatii SET status = 'depusa' WHERE id = 11$q$,
  NULL, NULL, 'editor depune pe derogarea acordată de owner (flux legitim)', 1);
SELECT t.ok('R03.b', 'R', (SELECT count(*) = 1 AND bool_and(actiune = 'depusa_pe_derogare' AND motiv = t.m('M0') AND actor = :'EDITOR'::uuid) FROM t.noi(11)),
  'un singur eveniment: depusa_pe_derogare, motivul ownerului, actor = editorul');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c;
SELECT t.caz('R04', 'R', 'editor', $q$UPDATE public.ofertare_licitatii SET observatii = 'nota editor', termen_depunere = now() + interval '2 days' WHERE id = 11$q$,
  NULL, NULL, 'editor modifică alte câmpuri pe o licitație cu derogare', 1);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c;
SELECT t.caz('R05', 'R', 'editor', format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, observatii = 'retrimis' WHERE id = 11$q$, t.m('M0')),
  NULL, NULL, 'editor retrimite derogare_* NESCHIMBATE împreună cu alt câmp (ca un formular)', 1);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(10);
SELECT t.caz('R06', 'R', 'editor', $q$UPDATE public.ofertare_licitatii SET status = 'depusa' WHERE id = 10$q$,
  NULL, NULL, 'depunere normală (J02 satisfăcută, fără derogare)', 1);
SELECT t.ok('R06.b', 'R', (SELECT count(*) FROM t.noi(10)) = 0, 'depunerea normală nu scrie în auditul derogărilor');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(13);
SELECT t.caz('R07', 'R', 'editor', $q$UPDATE public.ofertare_licitatii SET status = 'depusa' WHERE id = 13$q$,
  'P0001', 'lipseste pachetul PT', 'poarta J02 intactă: depunere fără pachet depus, fără derogare');
SELECT t.neschimbat('R07.b', 'R', 13);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(10);
SELECT t.caz('R08', 'R', 'editor', format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L WHERE id = 10$q$, t.m('MX')),
  '42501', 'doar ownerul', 'R07 intactă: non-ownerul nu poate ACORDA derogarea');
SELECT t.neschimbat('R08.b', 'R', 10);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(10);
SELECT t.caz('R09', 'R', 'editor', format($q$SELECT public.ofertare_derogare_depunere(10, %L)$q$, t.m('MX')),
  '42501', 'doar ownerul', 'RPC-ul refuză non-ownerul');
SELECT t.neschimbat('R09.b', 'R', 10);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c;
SELECT t.caz('R10', 'R', 'service', $q$UPDATE public.ofertare_licitatii SET termen_depunere = now() + interval '3 days' WHERE id = 11$q$,
  NULL, NULL, 'service_role mută termen_depunere (veghea SEAP) — lista albă a lui a00 intactă', 1);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c;
SELECT t.caz('R11', 'R', 'service', $q$UPDATE public.ofertare_licitatii SET observatii = 'service' WHERE id = 11$q$,
  'P0001', 'Contextul automat', 'a00 intact: service_role nu scrie alte câmpuri');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c;
SELECT t.caz('R12', 'R', 'financiar', $q$UPDATE public.ofertare_licitatii SET contract_id = 1 WHERE id = 11$q$,
  NULL, NULL, 'financiar leagă contract_id (GBE) — lista albă a lui a00 intactă', 1);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('R13', 'R', 'nomod', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 11$q$, t.m('MX')),
  NULL, NULL, 'cont fără modul: RLS îl filtrează (0 rânduri, nicio eroare)', 0);
SELECT t.neschimbat('R13.b', 'R', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('R14', 'R', 'anon', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 11$q$, t.m('MX')),
  NULL, NULL, 'anon direct: RLS îl filtrează (0 rânduri)', 0);
SELECT t.neschimbat('R14.b', 'R', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c;
SELECT t.caz('R15', 'R', 'service', format($q$SELECT public.ofertare_derogare_depunere(11, %L)$q$, t.m('MX')),
  '42501', 'permission denied', 'service_role nu are EXECUTE pe RPC');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c;
SELECT t.caz('R16', 'R', 'anon', format($q$SELECT public.ofertare_derogare_depunere(11, %L)$q$, t.m('MX')),
  '42501', 'permission denied', 'anon nu are EXECUTE pe RPC');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(12);
SELECT t.caz('R17', 'R', 'admin', $q$UPDATE public.ofertare_licitatii SET derogare_motiv = derogare_motiv || ' [corectie admin documentata]' WHERE id = 12$q$,
  NULL, NULL, 'administrare fără JWT (postgres: MCP / SQL editor) repară motivul după depunere', 1);
SELECT t.ok('R17.b', 'R', (SELECT count(*) FROM t.noi(12)) = 0, 'reparația admin nu lasă rând de audit (se documentează separat)');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('R18', 'R', 'supabase_admin_gol', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 11$q$, t.m('MX')),
  'P0001', 'Contextul curent', 'supabase_admin fără claims: garda îl lasă, a00 îl oprește în continuare (doar postgres e admin acolo)');
SELECT t.neschimbat('R18.b', 'R', 11);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(13);
SELECT t.caz('R19', 'R', 'owner', format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L WHERE id = 13$q$, t.m('MR')),
  NULL, NULL, 'owner acordă derogarea prin UPDATE direct (fără RPC)', 1);
SELECT t.ok('R19.b', 'R', (SELECT count(*) = 1 AND bool_and(actiune = 'derogare_acordata' AND motiv = t.m('MR') AND actor = :'OWNER'::uuid) FROM t.noi(13)),
  'poarta auditează acordarea directă: derogare_acordata, motivul exact, actor owner');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c;
SELECT t.caz('R20', 'R', 'owner_mcp', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 11$q$, t.m('MR')),
  NULL, NULL, 'MCP care se dă drept owner (postgres + JWT owner), înainte de depunere', 1);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c;
SELECT t.caz('R21', 'R', 'owner', $q$SELECT public.ofertare_derogare_depunere(13, 'scurt')$q$,
  '22023', 'minimum 10', 'RPC-ul validează în continuare motivul (min. 10 caractere)');
ROLLBACK TO SAVEPOINT c;

-- ── A: varianta atomică (un singur UPDATE de owner: derogare + motiv + depusa) ──────────
SAVEPOINT c; SELECT t.fixeaza(13);
SELECT t.caz('A01', 'A', 'owner', format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 13$q$, t.m('MA')),
  NULL, NULL, 'owner (JWT, ca PostgREST): UPDATE {derogare_depunere:true, derogare_motiv:M, status:depusa} pe L13 (fără pachet: J02 ar bloca)', 1);
SELECT t.ok('A01.b', 'A', (SELECT status = 'depusa' AND derogare_depunere AND derogare_motiv = t.m('MA') FROM public.ofertare_licitatii WHERE id = 13), 'licitația: depusa, derogare=true, motivul exact');
SELECT t.ok('A01.c', 'A', (SELECT count(*) FROM t.noi(13)) = 2, 'exact 2 evenimente de audit (ambele ramuri ale porții rulează: flagul trece false→true ȘI statusul trece în depusa)');
SELECT t.ok('A01.d', 'A', (SELECT array_agg(actiune ORDER BY id) FROM t.noi(13)) = ARRAY['derogare_acordata', 'depusa_pe_derogare'], 'ordinea: derogare_acordata, apoi depusa_pe_derogare');
SELECT t.ok('A01.e', 'A', (SELECT bool_and(motiv = t.m('MA')) FROM t.noi(13)), 'ambele cu motivul EXACT aprobat (egalitate de text)');
SELECT t.ok('A01.f', 'A', (SELECT bool_and(t.sha(motiv) = t.sha(t.m('MA'))) FROM t.noi(13)), 'ambele cu motivul EXACT aprobat (SHA-256)');
SELECT t.ok('A01.g', 'A', (SELECT bool_and(actor = :'OWNER'::uuid) FROM t.noi(13)), 'ambele cu actor = ownerul nominal (JWT)');
SELECT t.ok('A01.h', 'A', (SELECT bool_and(session_user_name = 'authenticator') FROM t.noi(13)), 'sesiunea înregistrată = authenticator (PostgREST)');
SELECT t.ok('A01.i', 'A', (SELECT bool_and(status_vechi = 'in_lucru') FROM t.noi(13)), 'status_vechi = in_lucru în ambele');
SELECT t.ok('A01.j', 'A', (SELECT bool_and(status_nou = 'depusa') FROM t.noi(13)), 'status_nou = depusa în ambele (inclusiv la derogare_acordata)');
SELECT t.ok('A01.k', 'A', (SELECT count(DISTINCT creat_la) = 1 FROM t.noi(13)), 'aceeași tranzacție (creat_la identic)');
SELECT t.caz('A02', 'A', 'owner', format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 13$q$, t.m('MA')),
  NULL, NULL, 'reluare: al doilea UPDATE identic', 1);
SELECT t.ok('A02.b', 'A', (SELECT count(*) FROM t.noi(13)) = 2, 'reluarea nu adaugă audit (idempotentă)');
SELECT t.ok('A02.c', 'A', (SELECT status = 'depusa' AND derogare_depunere AND derogare_motiv = t.m('MA') FROM public.ofertare_licitatii WHERE id = 13), 'licitația neschimbată de reluare');
SELECT t.caz('P20', 'P', 'owner', format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 13$q$, t.m('MB')),
  '42501', 'înghețate după depunere', 'reluare cu ALT motiv după depunerea atomică (live: rescrie motivul fără audit)');
SELECT t.ok('P20.b', 'P', (SELECT derogare_motiv = t.m('MA') FROM public.ofertare_licitatii WHERE id = 13) AND (SELECT count(*) FROM t.noi(13)) = 2,
  'motivul rămâne cel aprobat; auditul are tot 2 evenimente');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(14);
SELECT t.caz('A03', 'A', 'owner', format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 14$q$, t.m('MA')),
  'P0001', 'cantități de verificat', 'R5 blochează și varianta atomică (derogarea nu ocolește R5)');
SELECT t.neschimbat('A03.b', 'A', 14);
DELETE FROM public.v_ofertare_cantitati_nevalidate WHERE licitatie_id = 14;   -- R5 rezolvat (fixture)
SELECT t.caz('A03.c', 'A', 'owner', format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 14$q$, t.m('MA')),
  NULL, NULL, 'după rezolvarea R5, reluarea ACELUIAȘI UPDATE atomic trece', 1);
SELECT t.ok('A03.d', 'A', (SELECT array_agg(actiune ORDER BY id) FROM t.noi(14)) = ARRAY['derogare_acordata', 'depusa_pe_derogare']
                      AND (SELECT bool_and(motiv = t.m('MA')) FROM t.noi(14)),
  'exact 2 evenimente cu motivul exact: tentativa refuzată n-a lăsat niciun rând (nici de audit)');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(13);
SELECT t.caz('A04', 'A', 'editor', format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 13$q$, t.m('MA')),
  '42501', 'doar ownerul', 'varianta atomică încercată de non-owner');
SELECT t.neschimbat('A04.b', 'A', 13);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(13);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
ALTER TABLE public.ofertare_derogari_audit ADD CONSTRAINT t_esec_j05
  CHECK (NOT (actiune = 'depusa_pe_derogare' AND motiv = 'ESEC AUDIT J05: a doua înregistrare de audit trebuie să cadă.'));
SELECT t.caz('A05', 'A', 'owner', format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 13$q$, t.m('MESEC')),
  '23514', 't_esec_j05', 'al doilea eveniment de audit eșuează ⇒ tot UPDATE-ul cade');
SELECT t.neschimbat('A05.b', 'A', 13);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(13);
SELECT t.caz('A06', 'A', 'owner_mcp', format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 13$q$, t.m('MA')),
  NULL, NULL, 'varianta atomică prin MCP (postgres + SET ROLE authenticated + claims owner)', 1);
SELECT t.ok('A06.b', 'A', (SELECT array_agg(actiune ORDER BY id) FROM t.noi(13)) = ARRAY['derogare_acordata', 'depusa_pe_derogare'], 'aceleași 2 evenimente');
SELECT t.ok('A06.c', 'A', (SELECT bool_and(actor = :'OWNER'::uuid AND session_user_name = 'postgres' AND motiv = t.m('MA')) FROM t.noi(13)), 'actor owner, sesiune postgres, motivul exact');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(13);
SELECT t.caz('A07', 'A', 'admin', format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 13$q$, t.m('MA')),
  NULL, NULL, 'varianta atomică din admin fără JWT', 1);
SELECT t.ok('A07.b', 'A', (SELECT count(*) = 2 AND bool_and(actor IS NULL AND session_user_name = 'postgres' AND motiv = t.m('MA')) FROM t.noi(13)),
  'fără JWT: auditul NU are actor (NU e „owner nominal”)');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('A08', 'A', 'owner', format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 11$q$, t.m('MA')),
  NULL, NULL, 'varianta atomică pe o derogare DEJA acordată (L11, motiv M0) cu motiv nou', 1);
SELECT t.ok('A08.b', 'A', (SELECT count(*) = 1 AND bool_and(actiune = 'depusa_pe_derogare' AND motiv = t.m('MA')) FROM t.noi(11)),
  'un SINGUR eveniment: depusa_pe_derogare cu motivul nou; derogare_acordata NU se mai scrie (flagul era deja true)');
ROLLBACK TO SAVEPOINT c;

-- ── D: goluri consemnate (trec pe live ȘI pe patch — ce garda NU acoperă) ───────────────
SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('D01', 'D', 'owner', $q$UPDATE public.ofertare_licitatii SET derogare_depunere = false WHERE id = 11$q$,
  NULL, NULL, 'GOL: owner retrage prin UPDATE direct (fără RPC), înainte de depunere', 1);
SELECT t.ok('D01.b', 'D', (SELECT count(*) FROM t.noi(11)) = 0, 'GOL confirmat: retragerea directă a ownerului NU lasă rând de audit (poarta nu jurnalizează true→false)');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(11);
SELECT t.caz('D02', 'D', 'owner', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 11$q$, t.m('MR')),
  NULL, NULL, 'GOL: owner schimbă motivul prin UPDATE direct, flagul rămâne true', 1);
SELECT t.ok('D02.b', 'D', (SELECT count(*) FROM t.noi(11)) = 0, 'GOL confirmat: schimbarea directă de motiv NU lasă rând de audit');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c;
SELECT t.caz('D03', 'D', 'editor', format($q$INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, status, derogare_motiv) VALUES ('J05-D03', 'Autoritate', 'Obiect', 'in_lucru', %L)$q$, t.m('MX')),
  NULL, NULL, 'GOL: non-owner creează o licitație cu derogare_motiv completat (garda e doar pe UPDATE)', 1);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(12);
SELECT t.caz('D04', 'D', 'admin', $q$UPDATE public.ofertare_licitatii SET derogare_depunere = false WHERE id = 12$q$,
  NULL, NULL, 'admin fără JWT retrage după depunere (calea de reparație)', 1);
SELECT t.ok('D04.b', 'D', (SELECT count(*) FROM t.noi(12)) = 0, 'reparația admin nu lasă rând de audit');
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c;
SELECT t.caz('D05', 'D', 'owner', format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 16$q$, t.m('MR')),
  NULL, NULL, 'LIMITARE: după depusa → castigata, ownerul poate edita iar (înghețul e pe status = depusa)', 1);
ROLLBACK TO SAVEPOINT c;

SAVEPOINT c; SELECT t.fixeaza(13);
SELECT t.caz('D06', 'D', 'owner', $q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, status = 'depusa' WHERE id = 13$q$,
  NULL, NULL, 'GOL: varianta atomică FĂRĂ motiv (motivul se validează doar în RPC)', 1);
SELECT t.ok('D06.b', 'D', (SELECT count(*) = 2 AND bool_and(motiv IS NULL) FROM t.noi(13)), 'ambele evenimente au motiv NULL');
ROLLBACK TO SAVEPOINT c;

ROLLBACK;

-- ════════════════════════════════════════════════════════════════════════════
-- Partea 2 — concurență reală: două sesiuni dblink (commit efectiv; baza e recreată la fiecare fază).
-- A (owner) ține lacătul rândului în tranzacție; B trimite UPDATE-ul, e blocat, A face COMMIT, B continuă.
SELECT t.fixeaza(20);
SELECT * FROM t.concurenta(
  format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 20$q$, t.m('MA')),
  format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 20$q$, t.m('MA')),
  'owner') \gset c01_
SELECT t.rez('conc', 'C01', 'A', :'c01_rez_b' = 'trece (1)', 'A: ' || :'c01_rez_a' || ' · B: ' || :'c01_rez_b',
  'două sesiuni owner, același UPDATE atomic (READ COMMITTED): B așteaptă lacătul, apoi trece fără efect');
SELECT t.ok('C01.b', 'A', :'c01_b_blocat'::boolean AND :'c01_rez_a' = 'trece (1)', 'B a fost efectiv blocat de A; A a trecut');
SELECT t.ok('C01.c', 'A', (SELECT array_agg(actiune ORDER BY id) FROM t.noi(20)) = ARRAY['derogare_acordata', 'depusa_pe_derogare']
                      AND (SELECT bool_and(motiv = t.m('MA')) FROM t.noi(20)), 'exact 2 evenimente (nu 4), motivul exact');

SELECT t.fixeaza(21);
SELECT * FROM t.concurenta(
  format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 21$q$, t.m('MA')),
  format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 21$q$, t.m('MB')),
  'owner') \gset c02_
SELECT t.rez('conc', 'C02', 'P', :'c02_rez_b' LIKE '42501 J05:%', 'A: ' || :'c02_rez_a' || ' · B: ' || :'c02_rez_b',
  'cursă: B (owner) trimite același UPDATE atomic cu ALT motiv; după COMMIT-ul lui A licitația e deja depusă');
SELECT t.ok('C02.b', 'P', :'c02_b_blocat'::boolean AND (SELECT derogare_motiv = t.m('MA') FROM public.ofertare_licitatii WHERE id = 21),
  'motivul final = cel aprobat de A');
SELECT t.ok('C02.c', 'P', (SELECT count(*) = 2 AND bool_and(motiv = t.m('MA')) FROM t.noi(21)), 'auditul: 2 evenimente, motivul lui A');

SELECT t.fixeaza(22);
SELECT * FROM t.concurenta(
  format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 22$q$, t.m('MA')),
  format($q$UPDATE public.ofertare_licitatii SET derogare_motiv = %L WHERE id = 22$q$, t.m('MX')),
  'editor') \gset c03_
SELECT t.rez('conc', 'C03', 'P', :'c03_rez_b' LIKE '42501 J05:%', 'A: ' || :'c03_rez_a' || ' · B: ' || :'c03_rez_b',
  'cursă: editorul rescrie motivul exact în timp ce ownerul depune');
SELECT t.ok('C03.b', 'P', :'c03_b_blocat'::boolean AND (SELECT derogare_motiv = t.m('MA') FROM public.ofertare_licitatii WHERE id = 22),
  'motivul final = cel aprobat de owner');

SELECT t.fixeaza(23);
SELECT * FROM t.concurenta(
  format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 23$q$, t.m('MA')),
  format($q$UPDATE public.ofertare_licitatii SET derogare_depunere = true, derogare_motiv = %L, status = 'depusa' WHERE id = 23$q$, t.m('MA')),
  'owner', true) \gset c04_
SELECT t.rez('conc', 'C04', 'A', :'c04_rez_b' LIKE '40001%' AND :'c04_rez_b_reluare' = 'trece (1)',
  'B: ' || :'c04_rez_b' || ' · reluare: ' || :'c04_rez_b_reluare',
  'B în REPEATABLE READ (instantaneu luat înainte de COMMIT-ul lui A): 40001, apoi reluarea trece fără efect');
SELECT t.ok('C04.b', 'A', :'c04_b_blocat'::boolean AND (SELECT count(*) = 2 AND bool_and(motiv = t.m('MA')) FROM t.noi(23)),
  'B a fost blocat; auditul are exact 2 evenimente');

\echo 'TESTE_COMPLETE'
\endif
