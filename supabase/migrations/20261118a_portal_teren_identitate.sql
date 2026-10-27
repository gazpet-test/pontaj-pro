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
        'fn_portal_porti_lipsa','fn_portal_public_aprobat','fn_portal_public_md5','fn_portal_catalog_amprenta','fn_conturi_tip_audit','fn_conturi_jurnal_imuabil','fn_portal_uid')) THEN
    RAISE EXCEPTION 'PORTAL_ALREADY_EXISTS';
  END IF;
END $pre$;
SET LOCAL search_path = public, pg_temp;
LOCK TABLE auth.users IN SHARE MODE;
LOCK TABLE public.profiles,public.user_module_access IN SHARE MODE;
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
  tip text NOT NULL CHECK (tip IN ('erp','teren','neaprobat')),
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
  IF v_tip='erp' AND event->'claims'->>'role' = 'authenticated' THEN RETURN event; END IF;
  IF v_tip='teren' AND public.fn_teren_eligibil(v_uid) IS TRUE THEN
    RETURN jsonb_set(event, '{claims,role}', '"teren"'::jsonb, true);
  END IF;
  RETURN v_error;
EXCEPTION WHEN OTHERS THEN RETURN v_error;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_auth_token_hook(jsonb) FROM PUBLIC,anon,authenticated,service_role,teren;
GRANT EXECUTE ON FUNCTION public.fn_auth_token_hook(jsonb) TO supabase_auth_admin;

-- Lista celor 21 de functii executabile de PUBLIC pe prod (inventar read-only 27.10, scripts/portal/inventar_public.sql),
-- 20 INVOKER si un DEFINER trigger, conform inventarului furnizat. Nu deducem siguranta doar din INVOKER;
-- corpurile sunt ancorate in md5-urile revizuite, iar orice drift al definitiei/configuratiei/ACL este refuzat.
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


-- Amprenta revizuita din inventarul read-only furnizat de owner; nu invatam corpurile public la apply.
CREATE FUNCTION public.fn_portal_public_md5() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public','pg_temp' AS $hash$
 SELECT '{"public.auto_cost_from_tichet()":"31132cfdbc627358a1e848cf8672606a","public.auto_flag_agabaritic()":"2768f944886579d664b477f617b8b350","public.check_alerta_consum()":"5f993634b5d73d2c819fd00f710a5487","public.fn_claude_context_cleanup()":"bddab2d4bec1914f9ba52383b80a59fc","public.fn_contracte_linii_updated_at()":"554e8749a7b13374a57833f2d27d9ea2","public.fn_executie_touch_updated_at()":"4c906448b83147209f60b2f43138eb70","public.fn_notif_lipsa_fisa_service(bigint)":"04e96ff7871768dab1fbd6ee5111853f","public.fn_trg_categorie_cantitate()":"55e73645ca631dd12428d651b3e0b08f","public.gen_numar_transport()":"c7516ef4ade0e73d7ae0e6858c127d36","public.get_istoric_importuri_evogps()":"63c9562772432344f3363ec9a80b5d68","public.hr_recrutare_touch_updated_at()":"95e1005ac999206e023f52866c68547e","public.notify_tichet_opener_on_resolve()":"79b205d113f9bf87ab49df9c67e8cb22","public.set_updated_at()":"7f72f26535f14d5d91a2cedf23265f32","public.tg_active_lipsa_fisa()":"c356c1e1e9f37fa0a12818e7ecb5b412","public.tg_hr_employees_private_touch()":"e68a08b51a46461971979211b6bf974c","public.tg_lsf_touch_updated()":"5ac90d6b16d4a6ce589897122f2fdb26","public.update_hr_semnaturi_modificat_la()":"3c013c1387867ac00e606f874508d984","public.update_modificat_la_hr_docp()":"c8a2931b006daa93bafd3576bc9e1dc4","public.update_modificat_la_ord_setari()":"4a10ec11414f85ad1e984b16fe423456","public.update_stoc_achizitie()":"d2b7ad81c50620f265e0c8de63c15164","public.update_stoc_rezervor()":"e0f68e63fd8a7222258546754531c732"}'::jsonb;
$hash$;
REVOKE ALL ON FUNCTION public.fn_portal_public_md5() FROM PUBLIC,anon,authenticated,service_role,teren;
-- Exceptie explicita pentru catalogul SQL standard livrat de initdb (OID sub FirstNormalObjectId).
-- Nu accepta obiecte noi de aplicatie in information_schema; baseline-ul nu modifica privilegii.
CREATE FUNCTION public.fn_portal_catalog_amprenta(p_oid oid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $fn$
 SELECT jsonb_build_array(c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,
  CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) END,
  (SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl)
    ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped))
 FROM pg_class c WHERE c.oid=p_oid;
$fn$;
REVOKE ALL ON FUNCTION public.fn_portal_catalog_amprenta(oid) FROM PUBLIC,anon,authenticated,service_role,teren;
CREATE TABLE public.portal_public_baseline (semnatura text PRIMARY KEY, amprenta jsonb NOT NULL);
ALTER TABLE public.portal_public_baseline ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_public_baseline FROM PUBLIC,anon,authenticated,service_role,teren,supabase_auth_admin;
CREATE TRIGGER portal_public_baseline_imuabil BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.portal_public_baseline
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_conturi_jurnal_imuabil();
-- INSERT initial se face mai jos, cu triggerul suspendat in aceeasi tranzactie.

CREATE FUNCTION public.fn_portal_porti_lipsa() RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v text[] := '{}'; r record; v_signature text;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='teren') THEN RETURN ARRAY['teren lipsa']; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='teren' AND
    (rolbypassrls OR rolsuper OR rolcanlogin OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    v:=array_append(v,'teren atribute'); END IF;
  IF has_schema_privilege('teren','public','CREATE') THEN v:=array_append(v,'teren CREATE public'); END IF;
  IF EXISTS (SELECT FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='teren')) THEN v:=array_append(v,'teren membership'); END IF;
  IF NOT EXISTS (SELECT FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='teren')
    AND member=(SELECT oid FROM pg_roles WHERE rolname='authenticator')) THEN
    v:=array_append(v,'config incompleta: authenticator teren'); END IF;
  IF EXISTS (SELECT FROM pg_namespace n WHERE n.nspname <> 'pg_catalog'
    AND n.nspname !~ '^pg_(toast|temp)_' AND has_schema_privilege('teren',n.oid,'USAGE')
    AND has_schema_privilege('teren',n.oid,'CREATE')) THEN
    v:=array_append(v,'teren CREATE schema accesibila'); END IF;
  -- pg_catalog este suprafata interna PostgreSQL, exclusa explicit din schemele aplicatiei.
  IF (SELECT array_agg(nspname::text ORDER BY nspname COLLATE "C") FROM pg_namespace
      WHERE nspname <> 'pg_catalog' AND nspname !~ '^pg_(toast|temp)_'
        AND has_schema_privilege('teren',oid,'USAGE'))
      IS DISTINCT FROM ARRAY['information_schema','net','public']::text[] THEN
    v:=array_append(v,'teren scheme USAGE'); END IF;
  FOR r IN SELECT * FROM public.portal_public_baseline WHERE semnatura NOT LIKE 'rel:%' LOOP
    IF r.amprenta IS DISTINCT FROM (SELECT jsonb_build_array(md5(pg_get_functiondef(p.oid)),
        p.prosecdef,p.proowner,p.proconfig,p.proacl) FROM pg_proc p WHERE p.oid=to_regprocedure(r.semnatura)) THEN
      v:=array_append(v,'amprenta:'||r.semnatura); END IF;
  END LOOP;
  FOR r IN SELECT * FROM public.portal_public_baseline WHERE semnatura LIKE 'rel:%' LOOP
    IF r.amprenta IS DISTINCT FROM public.fn_portal_catalog_amprenta(to_regclass(substr(r.semnatura,5))) THEN
      v:=array_append(v,'amprenta:'||r.semnatura); END IF;
  END LOOP;
  FOR r IN SELECT c.oid,c.relkind,c.relname,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_'
      AND has_schema_privilege('teren',n.oid,'USAGE') AND c.relkind IN ('r','p','v','m','f','S') ORDER BY c.oid LOOP
    IF r.relkind='S' THEN
      IF has_sequence_privilege('teren',r.oid,'USAGE,SELECT,UPDATE') THEN
        v:=array_append(v,'secventa:'||r.relname); END IF;
    -- MAINTAIN exista doar din PG17 (prod); harness-ul local PG16 il omite.
    ELSIF has_table_privilege('teren',r.oid,CASE WHEN current_setting('server_version_num')::int >= 170000
        THEN 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        ELSE 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' END)
      OR has_any_column_privilege('teren',r.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
      -- Catalogul standard permite doar SELECT-ul fixat la apply, fara DML/DDL sau granturi pe coloane noi.
      IF r.nspname <> 'information_schema' OR r.oid >= 16384
        OR has_table_privilege('teren',r.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege('teren',r.oid,'INSERT,UPDATE,REFERENCES')
        OR NOT EXISTS (SELECT FROM public.portal_public_baseline b
          WHERE b.semnatura='rel:information_schema.'||quote_ident(r.relname)
          AND b.amprenta=public.fn_portal_catalog_amprenta(r.oid)) THEN
        v:=array_append(v,'relatie:'||r.relname); END IF;
    END IF;
  END LOOP;
  FOR r IN SELECT p.oid,p.proname,p.proargtypes,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_'
      AND has_schema_privilege('teren',n.oid,'USAGE') AND has_function_privilege('teren',p.oid,'EXECUTE') ORDER BY p.oid LOOP
    -- Semnatura canonica: schema + nume + tipuri (fara numele argumentelor).
    v_signature := quote_ident(r.nspname) || '.' || quote_ident(r.proname) || '(' || oidvectortypes(r.proargtypes) || ')';
    IF v_signature NOT IN ('public.fn_teren_eligibil(uuid)','public.fn_portal_uid()')
      AND NOT EXISTS (SELECT FROM public.portal_public_baseline WHERE semnatura=v_signature) THEN
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
DECLARE v_live text[]; r record;
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
  FOR r IN SELECT key,value FROM jsonb_each_text(public.fn_portal_public_md5()) LOOP
    IF r.value IS DISTINCT FROM (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p
      WHERE p.oid=to_regprocedure(r.key) AND p.proowner='postgres'::regrole) THEN
      RAISE EXCEPTION 'PORTAL_PUBLIC_BASELINE_UNREVIEWED_OR_CHANGED'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='net' AND has_function_privilege('teren',p.oid,'EXECUTE')) <> 12
    OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='net' AND p.prosecdef AND has_function_privilege('teren',p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'PORTAL_NET_BASELINE_UNREVIEWED_OR_CHANGED'; END IF;
END $public_pre$;
ALTER TABLE public.portal_public_baseline DISABLE TRIGGER portal_public_baseline_imuabil;
INSERT INTO public.portal_public_baseline
SELECT quote_ident(n.nspname)||'.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')',
 jsonb_build_array(md5(pg_get_functiondef(p.oid)),p.prosecdef,p.proowner,p.proconfig,p.proacl)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='public' AND ('public.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')')
 = ANY(public.fn_portal_public_aprobat())) OR (n.nspname='net' AND has_function_privilege('teren',p.oid,'EXECUTE'))
 OR (n.nspname='information_schema' AND p.oid<16384 AND NOT p.prosecdef AND p.proowner=n.nspowner AND has_function_privilege('teren',p.oid,'EXECUTE'));
INSERT INTO public.portal_public_baseline
SELECT 'rel:information_schema.'||quote_ident(c.relname),public.fn_portal_catalog_amprenta(c.oid)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='information_schema' AND c.oid<16384 AND c.relkind IN ('r','v')
 AND has_table_privilege('teren',c.oid,'SELECT')
 AND NOT has_table_privilege('teren',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 AND NOT has_any_column_privilege('teren',c.oid,'INSERT,UPDATE,REFERENCES');
ALTER TABLE public.portal_public_baseline ENABLE TRIGGER portal_public_baseline_imuabil;

-- Setul complet se recalculeaza sub lock: fara numar/UUID-uri ERP hardcodate.
INSERT INTO public.conturi_tip(auth_user_id,tip,sursa)
SELECT id,CASE WHEN email IN ('florinel.ilie@teren.gazpet.ro','petronel.mititelu@teren.gazpet.ro',
  'test.razvan@teren.gazpet.ro') THEN 'teren'
 WHEN EXISTS (SELECT FROM public.profiles p WHERE p.id=u.id AND (p.is_owner IS TRUE OR p.employee_id IS NOT NULL))
   OR EXISTS (SELECT FROM public.user_module_access a WHERE a.profile_id=u.id) THEN 'erp'
 ELSE 'neaprobat' END,'inventar_e1_1a_27_10' FROM auth.users u;
DO $pending$ DECLARE v_count bigint; BEGIN
 SELECT count(*) INTO v_count FROM public.conturi_tip WHERE tip='neaprobat';
 RAISE NOTICE 'PORTAL_NEAPROBATE: %',v_count;
END $pending$;
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
    'baseline',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY semnatura),'[]') FROM public.portal_public_baseline b),
    'ddl',(SELECT coalesce(jsonb_agg(x.obj ORDER BY x.cheie COLLATE "C"),'[]') FROM (
      SELECT 'f:'||p.oid AS cheie,jsonb_build_array('functie',p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig) AS obj
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('fn_auth_token_hook','fn_teren_eligibil','fn_portal_porti_lipsa',
        'fn_portal_public_aprobat','fn_portal_public_md5','fn_portal_catalog_amprenta','fn_conturi_tip_audit','fn_conturi_jurnal_imuabil','fn_portal_uid')
      UNION ALL
      SELECT 'r:'||c.oid,jsonb_build_array('relatie',c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity)
      FROM pg_class c WHERE c.oid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.portal_public_baseline'::regclass,'public.conturi_tip_jurnal'::regclass,'public.conturi_tip_jurnal_id_seq'::regclass)
      UNION ALL
      SELECT 'a:'||a.attrelid||':'||a.attnum,jsonb_build_array('coloana',a.attrelid,a.attnum,a.attname,
        a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,a.attacl,pg_get_expr(d.adbin,d.adrelid))
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.portal_public_baseline'::regclass,'public.conturi_tip_jurnal'::regclass) AND a.attnum>0 AND NOT a.attisdropped
      UNION ALL
      SELECT 'c:'||c.oid,jsonb_build_array('constrangere',c.conrelid,c.conname,pg_get_constraintdef(c.oid))
      FROM pg_constraint c WHERE c.conrelid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.portal_public_baseline'::regclass,'public.conturi_tip_jurnal'::regclass)
      UNION ALL
      SELECT 'p:'||p.oid,jsonb_build_array('politica',p.polrelid,p.polname,p.polcmd,p.polpermissive,p.polroles,
        pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
      FROM pg_policy p WHERE p.polrelid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.portal_public_baseline'::regclass,'public.conturi_tip_jurnal'::regclass)
      UNION ALL
      SELECT 't:'||t.oid,jsonb_build_array('trigger',t.tgrelid,t.tgfoid,t.tgenabled,pg_get_triggerdef(t.oid))
      FROM pg_trigger t WHERE t.tgrelid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.portal_public_baseline'::regclass,'public.conturi_tip_jurnal'::regclass)
      UNION ALL
      SELECT 's:'||s.seqrelid,to_jsonb(s) FROM pg_sequence s
      WHERE s.seqrelid='public.conturi_tip_jurnal_id_seq'::regclass
    ) x)) INTO v_snapshot;
  EXECUTE format('COMMENT ON TABLE public.conturi_tip IS %L',v_snapshot::text);
END $post$;
