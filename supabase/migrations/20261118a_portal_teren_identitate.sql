-- E1-1a: numai identitate. NU activeaza hook-ul si NU modifica handle_new_user.
-- Tranzactia apartine runnerului. Inventarul este DML autorizat numai la apply.
DO $pre$
BEGIN
  IF current_user <> 'postgres' OR current_setting('gazpet.livrare_migrare', true)
    IS DISTINCT FROM '20261118a_portal_teren_identitate:' || txid_current() THEN
    RAISE EXCEPTION 'PORTAL_RUNNER_REQUIRED';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'PORTAL_READ_COMMITTED_REQUIRED';
  END IF;
  -- Ordine comuna: advisory livrare -> auth.users -> profiles -> obiectele noi.
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'teren')
    OR to_regclass('public.conturi_tip') IS NOT NULL
    OR to_regclass('public.conturi_teren') IS NOT NULL
    OR to_regclass('public.conturi_tip_jurnal') IS NOT NULL
    OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('fn_auth_token_hook','fn_teren_eligibil',
        'fn_portal_porti_lipsa','fn_portal_public_aprobat','fn_conturi_tip_audit','fn_conturi_jurnal_imuabil','fn_portal_uid')) THEN
    RAISE EXCEPTION 'PORTAL_ALREADY_EXISTS';
  END IF;
END $pre$;
SET LOCAL search_path = public, pg_temp;
LOCK TABLE auth.users IN SHARE MODE;
LOCK TABLE public.profiles IN SHARE MODE;
DO $inventory_pre$
BEGIN
  IF (SELECT count(*) FROM auth.users WHERE email IN
    ('florinel.ilie@teren.gazpet.ro','petronel.mititelu@teren.gazpet.ro','test.razvan@teren.gazpet.ro')) <> 3
    OR (SELECT count(DISTINCT email) FROM auth.users WHERE email IN
      ('florinel.ilie@teren.gazpet.ro','petronel.mititelu@teren.gazpet.ro','test.razvan@teren.gazpet.ro')) <> 3
    OR EXISTS (SELECT FROM auth.users WHERE lower(split_part(email,'@',2))='teren.gazpet.ro'
      AND email NOT IN ('florinel.ilie@teren.gazpet.ro','petronel.mititelu@teren.gazpet.ro','test.razvan@teren.gazpet.ro'))
    OR EXISTS (SELECT FROM (VALUES
      ('florinel.ilie@teren.gazpet.ro',55),('petronel.mititelu@teren.gazpet.ro',70),
      ('test.razvan@teren.gazpet.ro',NULL::integer)) v(email,emp)
      JOIN auth.users u ON u.email=v.email LEFT JOIN public.profiles p ON p.id=u.id
      WHERE p.id IS NULL OR p.employee_id IS DISTINCT FROM v.emp) THEN
    RAISE EXCEPTION 'PORTAL_TERRAIN_INVENTORY_CHANGED';
  END IF;
END $inventory_pre$;

CREATE ROLE teren NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT teren TO authenticator;
GRANT USAGE ON SCHEMA public TO teren;

CREATE TABLE public.conturi_tip (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tip text NOT NULL CHECK (tip IN ('erp','teren')),
  sursa text NOT NULL CHECK (sursa ~ '[^[:space:]]'),
  clasificat_de uuid,
  clasificat_la timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.conturi_teren (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id integer UNIQUE REFERENCES public.employees(id),
  stare text NOT NULL CHECK (stare IN ('in_creare','activ','revocat'))
);
CREATE TABLE public.conturi_tip_jurnal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auth_user_id uuid NOT NULL,
  operatie text NOT NULL CHECK (operatie IN ('INSERT','UPDATE','DELETE')),
  vechi jsonb, nou jsonb,
  autor uuid, rol_sesiune text NOT NULL,
  la timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.conturi_tip ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conturi_teren ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conturi_tip_jurnal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conturi_tip, public.conturi_teren, public.conturi_tip_jurnal
  FROM PUBLIC, anon, authenticated, service_role, teren;
REVOKE ALL ON SEQUENCE public.conturi_tip_jurnal_id_seq FROM PUBLIC, anon, authenticated, service_role, teren;
GRANT SELECT ON public.conturi_tip TO supabase_auth_admin;
CREATE POLICY conturi_tip_hook ON public.conturi_tip FOR SELECT TO supabase_auth_admin
  USING (auth_user_id IS NOT NULL);

CREATE FUNCTION public.fn_conturi_tip_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
  INSERT INTO public.conturi_tip_jurnal(auth_user_id,operatie,vechi,nou,autor,rol_sesiune)
    VALUES (coalesce(NEW.auth_user_id,OLD.auth_user_id), TG_OP,
      CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
      CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END, auth.uid(), session_user);
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_conturi_tip_audit() FROM PUBLIC,anon,authenticated,service_role,teren;
CREATE TRIGGER conturi_tip_audit AFTER INSERT OR UPDATE OR DELETE ON public.conturi_tip
  FOR EACH ROW EXECUTE FUNCTION public.fn_conturi_tip_audit();
CREATE FUNCTION public.fn_conturi_jurnal_imuabil() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $fn$
BEGIN RAISE EXCEPTION 'PORTAL_AUDIT_APPEND_ONLY'; END $fn$;
REVOKE ALL ON FUNCTION public.fn_conturi_jurnal_imuabil() FROM PUBLIC,anon,authenticated,service_role,teren;
CREATE TRIGGER conturi_jurnal_imuabil BEFORE UPDATE OR DELETE OR TRUNCATE ON public.conturi_tip_jurnal
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_conturi_jurnal_imuabil();
CREATE TRIGGER conturi_tip_no_truncate BEFORE TRUNCATE ON public.conturi_tip
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_conturi_jurnal_imuabil();

CREATE FUNCTION public.fn_teren_eligibil(p_uid uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
  -- Hook: rol real supabase_auth_admin; client teren: numai identitatea proprie.
  -- SET ROLE necesita membership real, nu un GUC de aplicatie controlat de client.
  IF p_uid IS NULL OR (session_user <> 'supabase_auth_admin'
    AND current_setting('role',true) IS DISTINCT FROM 'supabase_auth_admin'
    AND auth.uid() IS DISTINCT FROM p_uid) THEN RETURN false; END IF;
  RETURN EXISTS (SELECT FROM public.conturi_teren c
    JOIN public.conturi_tip t ON t.auth_user_id=c.auth_user_id AND t.tip='teren'
    JOIN public.employees e ON e.id=c.employee_id
    JOIN auth.users u ON u.id=c.auth_user_id
    WHERE c.auth_user_id=p_uid AND c.stare='activ' AND e.active IS TRUE
      AND (e.termination_date IS NULL OR e.termination_date >= (now() AT TIME ZONE 'Europe/Bucharest')::date)
      AND (u.banned_until IS NULL OR u.banned_until <= now()));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_teren_eligibil(uuid) FROM PUBLIC,anon,authenticated,service_role,teren;
GRANT EXECUTE ON FUNCTION public.fn_teren_eligibil(uuid) TO supabase_auth_admin,teren;

-- Pe prod, schema auth da USAGE doar lui anon/authenticated/service_role/postgres, iar postgres NU are GRANT OPTION:
-- rolul teren nu poate primi acces direct la auth.uid(). Identitatea clientului teren (si a politicilor TO teren din
-- modulele opt-in) trece prin acest helper DEFINER (proprietar postgres, care are USAGE pe auth).
CREATE FUNCTION public.fn_portal_uid() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
  SELECT auth.uid();
$fn$;
REVOKE ALL ON FUNCTION public.fn_portal_uid() FROM PUBLIC,anon,authenticated,service_role,teren;
GRANT EXECUTE ON FUNCTION public.fn_portal_uid() TO teren;

CREATE FUNCTION public.fn_auth_token_hook(event jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_uid uuid; v_tip text;
  v_error CONSTANT jsonb := '{"error":{"http_code":403,"message":"Cont neautorizat"}}';
BEGIN
  v_uid := (event->>'user_id')::uuid;
  IF v_uid IS NULL OR jsonb_typeof(event->'claims') IS DISTINCT FROM 'object' THEN RETURN v_error; END IF;
  SELECT tip INTO v_tip FROM public.conturi_tip WHERE auth_user_id=v_uid;
  IF v_tip='erp' THEN RETURN event; END IF;
  IF v_tip='teren' AND public.fn_teren_eligibil(v_uid) IS TRUE THEN
    RETURN jsonb_set(event, '{claims,role}', '"teren"'::jsonb, true);
  END IF;
  RETURN v_error;
EXCEPTION WHEN OTHERS THEN RETURN v_error;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_auth_token_hook(jsonb) FROM PUBLIC,anon,authenticated,service_role,teren;
GRANT EXECUTE ON FUNCTION public.fn_auth_token_hook(jsonb) TO supabase_auth_admin;

-- Lista celor 21 de functii executabile de PUBLIC pe prod (inventar read-only 27.10, scripts/portal/inventar_public.sql),
-- revizuita de Izometrie: 20 sunt SECURITY INVOKER (ruleaza cu drepturile rolului teren, care nu are nicio tabela ->
-- orice citire/scriere esueaza), iar singura DEFINER (fn_trg_categorie_cantitate) e functie de trigger, neapelabila prin RPC.
-- Orice schimbare a setului PUBLIC pe prod face apply-ul sa refuze (precondiția de mai jos) si poarta rosie.
CREATE FUNCTION public.fn_portal_public_aprobat() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path TO 'public','pg_temp' AS $fn$
  SELECT ARRAY[
    'public.auto_cost_from_tichet()',
    'public.auto_flag_agabaritic()',
    'public.check_alerta_consum()',
    'public.fn_claude_context_cleanup()',
    'public.fn_contracte_linii_updated_at()',
    'public.fn_executie_touch_updated_at()',
    'public.fn_notif_lipsa_fisa_service(bigint)',
    'public.fn_trg_categorie_cantitate()',
    'public.gen_numar_transport()',
    'public.get_istoric_importuri_evogps()',
    'public.hr_recrutare_touch_updated_at()',
    'public.notify_tichet_opener_on_resolve()',
    'public.set_updated_at()',
    'public.tg_active_lipsa_fisa()',
    'public.tg_hr_employees_private_touch()',
    'public.tg_lsf_touch_updated()',
    'public.update_hr_semnaturi_modificat_la()',
    'public.update_modificat_la_hr_docp()',
    'public.update_modificat_la_ord_setari()',
    'public.update_stoc_achizitie()',
    'public.update_stoc_rezervor()'
  ]::text[];
$fn$;
REVOKE ALL ON FUNCTION public.fn_portal_public_aprobat() FROM PUBLIC,anon,authenticated,service_role,teren;

CREATE FUNCTION public.fn_portal_porti_lipsa() RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v text[] := '{}'; r record; v_signature text;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='teren') THEN RETURN ARRAY['teren lipsa']; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='teren' AND
    (rolbypassrls OR rolsuper OR rolcanlogin OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    v:=array_append(v,'teren atribute'); END IF;
  IF has_schema_privilege('teren','public','CREATE') THEN v:=array_append(v,'teren CREATE public'); END IF;
  IF pg_has_role('teren','authenticated','MEMBER') OR pg_has_role('teren','anon','MEMBER')
    OR pg_has_role('teren','service_role','MEMBER') THEN v:=array_append(v,'teren membership'); END IF;
  FOR r IN SELECT c.oid,c.relkind,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S') ORDER BY c.oid LOOP
    IF r.relkind='S' THEN
      IF has_sequence_privilege('teren',r.oid,'USAGE,SELECT,UPDATE') THEN
        v:=array_append(v,'secventa:'||r.relname); END IF;
    -- MAINTAIN exista doar din PG17 (prod); harness-ul local PG16 il omite.
    ELSIF has_table_privilege('teren',r.oid,CASE WHEN current_setting('server_version_num')::int >= 170000
        THEN 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        ELSE 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' END)
      OR has_any_column_privilege('teren',r.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
      v:=array_append(v,'relatie:'||r.relname);
    END IF;
  END LOOP;
  FOR r IN SELECT p.oid,p.proname,p.proargtypes FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND has_function_privilege('teren',p.oid,'EXECUTE') ORDER BY p.oid LOOP
    -- Semnatura canonica: schema + nume + tipuri (fara numele argumentelor).
    v_signature := 'public.' || quote_ident(r.proname) || '(' || oidvectortypes(r.proargtypes) || ')';
    IF v_signature NOT IN ('public.fn_teren_eligibil(uuid)','public.fn_portal_uid()')
      AND NOT (v_signature=ANY(public.fn_portal_public_aprobat())) THEN
      v:=array_append(v,'functie:'||v_signature);
    END IF;
  END LOOP;
  IF EXISTS (SELECT id FROM auth.users EXCEPT SELECT auth_user_id FROM public.conturi_tip)
    OR EXISTS (SELECT auth_user_id FROM public.conturi_tip EXCEPT SELECT id FROM auth.users) THEN
    v:=array_append(v,'inventar identitati'); END IF;
  RETURN v;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_porti_lipsa() FROM PUBLIC,anon,authenticated,service_role,teren,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.fn_portal_porti_lipsa() TO postgres;

DO $public_pre$
DECLARE v_live text[];
BEGIN
  SELECT coalesce(array_agg('public.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')'
    ORDER BY ('public.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')') COLLATE "C"),'{}')
    INTO v_live FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND EXISTS (SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee=0 AND a.privilege_type='EXECUTE');
  IF cardinality(public.fn_portal_public_aprobat()) <> 21
    OR v_live IS DISTINCT FROM public.fn_portal_public_aprobat() THEN
    RAISE EXCEPTION 'PORTAL_PUBLIC_BASELINE_UNREVIEWED_OR_CHANGED';
  END IF;
END $public_pre$;

-- Setul complet se recalculeaza sub lock: fara numar/UUID-uri ERP hardcodate.
INSERT INTO public.conturi_tip(auth_user_id,tip,sursa)
SELECT id,CASE WHEN email IN ('florinel.ilie@teren.gazpet.ro','petronel.mititelu@teren.gazpet.ro',
  'test.razvan@teren.gazpet.ro') THEN 'teren' ELSE 'erp' END,'inventar_e1_1a_27_10' FROM auth.users;
INSERT INTO public.conturi_teren(auth_user_id,employee_id,stare)
SELECT t.auth_user_id,p.employee_id,'activ' FROM public.conturi_tip t
  JOIN public.profiles p ON p.id=t.auth_user_id WHERE t.tip='teren';
DO $post$
DECLARE v_snapshot jsonb;
BEGIN
  IF public.fn_portal_porti_lipsa() <> '{}'::text[] THEN RAISE EXCEPTION 'PORTAL_POSTCONDITION_FAILED'; END IF;
  SELECT jsonb_build_object(
    'tip',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY auth_user_id),'[]') FROM public.conturi_tip t),
    'teren',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY auth_user_id),'[]') FROM public.conturi_teren t),
    'jurnal',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.conturi_tip_jurnal t),
    'ddl',(SELECT coalesce(jsonb_agg(x.obj ORDER BY x.cheie COLLATE "C"),'[]') FROM (
      SELECT 'f:'||p.oid AS cheie,jsonb_build_array('functie',p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig) AS obj
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('fn_auth_token_hook','fn_teren_eligibil','fn_portal_porti_lipsa',
        'fn_portal_public_aprobat','fn_conturi_tip_audit','fn_conturi_jurnal_imuabil','fn_portal_uid')
      UNION ALL
      SELECT 'r:'||c.oid,jsonb_build_array('relatie',c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity)
      FROM pg_class c WHERE c.oid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.conturi_tip_jurnal'::regclass,'public.conturi_tip_jurnal_id_seq'::regclass)
      UNION ALL
      SELECT 'a:'||a.attrelid||':'||a.attnum,jsonb_build_array('coloana',a.attrelid,a.attnum,a.attname,
        a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,a.attacl,pg_get_expr(d.adbin,d.adrelid))
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.conturi_tip_jurnal'::regclass) AND a.attnum>0 AND NOT a.attisdropped
      UNION ALL
      SELECT 'c:'||c.oid,jsonb_build_array('constrangere',c.conrelid,c.conname,pg_get_constraintdef(c.oid))
      FROM pg_constraint c WHERE c.conrelid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.conturi_tip_jurnal'::regclass)
      UNION ALL
      SELECT 'p:'||p.oid,jsonb_build_array('politica',p.polrelid,p.polname,p.polcmd,p.polpermissive,p.polroles,
        pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
      FROM pg_policy p WHERE p.polrelid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.conturi_tip_jurnal'::regclass)
      UNION ALL
      SELECT 't:'||t.oid,jsonb_build_array('trigger',t.tgrelid,t.tgfoid,t.tgenabled,pg_get_triggerdef(t.oid))
      FROM pg_trigger t WHERE t.tgrelid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.conturi_tip_jurnal'::regclass)
      UNION ALL
      SELECT 's:'||s.seqrelid,to_jsonb(s) FROM pg_sequence s
      WHERE s.seqrelid='public.conturi_tip_jurnal_id_seq'::regclass
    ) x)) INTO v_snapshot;
  EXECUTE format('COMMENT ON TABLE public.conturi_tip IS %L',v_snapshot::text);
END $post$;
