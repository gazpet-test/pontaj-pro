-- E1-1b. O singura tranzactie: exclusiv scripts/livrare_migrare.sh.
-- Nu activeaza hook-ul Auth, nu modifica inventarul legacy.
DO $pre$
BEGIN
 IF current_user <> 'postgres' OR current_setting('gazpet.livrare_migrare',true)
   IS DISTINCT FROM '20261119a_portal_teren_provisioning:'||txid_current() THEN
   RAISE EXCEPTION 'PORTAL_RUNNER_REQUIRED'; END IF;
 IF current_setting('transaction_isolation') <> 'read committed' THEN
   RAISE EXCEPTION 'PORTAL_READ_COMMITTED_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
END $pre$;
SET LOCAL search_path = public, pg_temp;
-- Livrare offline: auth.users -> employees -> profiles -> copii. RPC-urile nu ruleaza in timpul DDL.
LOCK TABLE auth.users IN SHARE MODE;
LOCK TABLE public.employees,public.profiles,public.user_module_access,
 public.conturi_tip,public.conturi_teren,public.conturi_tip_jurnal IN ACCESS EXCLUSIVE MODE;
CREATE TABLE public.portal_e1_1b_manifest (
 cheie text PRIMARY KEY CHECK (cheie IN ('handle_live','eligibil_live','role_live','post_snapshot')),valoare jsonb NOT NULL);
ALTER TABLE public.portal_e1_1b_manifest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_e1_1b_manifest FROM PUBLIC,anon,authenticated,service_role,teren,supabase_auth_admin;
DO $manifest$
DECLARE p record; v_expected_source text := $live_source$
DECLARE
  v_n         integer := 0;
  v_emp       integer;
  v_nume      text;
  v_metoda    text;
  v_ocupat    boolean := false;
  v_incredere boolean := false;
  v_are_fisa  boolean := false;
  v_eroare    text;
  v_motiv     text;
BEGIN
  -- Inserăm doar dacă nu există deja (idempotent) — neschimbat
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    INITCAP(REPLACE(REPLACE(SPLIT_PART(NEW.email, '@', 1), '.', ' '), '_', ' ')),
    'manager_santier'
  )
  ON CONFLICT (id) DO NOTHING;

  -- R1 sub-bloc 1: DOAR potrivirea (fără nicio scriere în profiles). Nicio eroare de aici nu blochează crearea contului.
  BEGIN
    v_incredere := COALESCE(NEW.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true';
    SELECT count(*), min(c.employee_id), min(c.employee_name), min(c.metoda),
           COALESCE(bool_or(c.profil_legat IS NOT NULL), false)
      INTO v_n, v_emp, v_nume, v_metoda, v_ocupat
      FROM public.fn_cont_candidati_angajat(NEW.email) c;       -- emailul de LOGARE (GoTrue)
    SELECT p.employee_id IS NOT NULL INTO v_are_fisa FROM public.profiles p WHERE p.id = NEW.id;
    v_are_fisa := COALESCE(v_are_fisa, false);
  EXCEPTION WHEN OTHERS THEN
    v_eroare := SQLERRM;
    RAISE WARNING 'handle_new_user R1 (%): % [%]', NEW.email, SQLERRM, SQLSTATE;
  END;

  -- R1 sub-bloc 2: notificarea owner-ilor (separat; best-effort)
  BEGIN
    IF v_eroare IS NULL AND v_n = 1 AND NOT v_ocupat AND NOT v_are_fisa THEN
      IF NOT v_incredere THEN
        -- orice domeniu: potrivirea pe email poate fi și pe adresa personală trecută pe fișă
        PERFORM public.fn_cont_notifica_owneri('cont_legare_propusa', '🔗 Cont nou: confirmă legarea de fișă',
          format('Cont nou %s → propunere: %s (#%s, prin %s). Dacă tu ai creat contul, confirmă din Admin → Manageri → „Leagă automat”. Dacă nu-l recunoști, NU-l lega și închide-l.',
                 NEW.email, v_nume, v_emp, v_metoda),
          '/admin?tab=managers&cont=' || NEW.id::text);
      END IF;
      -- calea de încredere: legarea și anunțul le face fn_cont_leaga_la_creare (cont-nou); dacă RPC-ul nu vine,
      -- contul apare în alerta fara_angajat cu candidatul unic.
    ELSIF v_eroare IS NOT NULL OR v_incredere
          OR lower(split_part(btrim(COALESCE(NEW.email, '')), '@', 2)) = 'gazpet.ro' THEN
      v_motiv := CASE
        WHEN v_eroare IS NOT NULL THEN 'eroare la potrivire: ' || v_eroare
        WHEN v_n = 0 THEN '0 candidați'
        WHEN v_n > 1 THEN v_n || ' candidați'
        WHEN v_ocupat THEN 'candidatul unic are deja cont'
        ELSE 'legătură existentă păstrată' END;
      PERFORM public.fn_cont_notifica_owneri('cont_nelegat', '⚠️ Cont nou nelegat de fișa de angajat',
        format('Cont nou %s nelegat: %s', NEW.email, v_motiv),
        '/admin?tab=managers&cont=' || NEW.id::text);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user R1 notificare (%): % [%]', NEW.email, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$live_source$;
 v_expected text; v_manifest jsonb; c record;
BEGIN
 SELECT pr.*,pg_get_userbyid(pr.proowner) AS proprietar,l.lanname
 INTO STRICT p FROM pg_proc pr JOIN pg_language l ON l.oid=pr.prolang
 WHERE pr.oid='public.handle_new_user()'::regprocedure;
 -- Corpul este EXACT cel din live/prod_fapte_27_10.txt, nu invatat din tinta.
 -- Antetul pg_get_functiondef este formatat de versiunea PG locala; toate atributele sale sunt verificate separat.
 v_expected := replace(pg_get_functiondef(p.oid),p.prosrc,v_expected_source);
 IF p.prosrc IS DISTINCT FROM v_expected_source OR p.proprietar <> 'postgres'
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
  OR p.lanname <> 'plpgsql' OR p.prorettype <> 'trigger'::regtype
  OR p.prosecdef IS NOT TRUE OR p.provolatile <> 'v' OR p.proisstrict
  OR p.proleakproof OR p.prokind <> 'f' OR p.proparallel <> 'u'
  OR sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')) IS DISTINCT FROM sha256(convert_to(v_expected,'UTF8')) THEN
  RAISE EXCEPTION 'PORTAL_HANDLE_LIVE_CHANGED'; END IF;
 v_manifest := jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proprietar,
  'acl',p.proacl::text,'proconfig',to_jsonb(p.proconfig));
 INSERT INTO public.portal_e1_1b_manifest VALUES ('handle_live',v_manifest||jsonb_build_object(
  'sha256',encode(sha256(convert_to(v_manifest::text,'UTF8')),'hex')));
 SELECT oid,conname,pg_get_constraintdef(oid) AS def INTO STRICT c
 FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='profiles_role_chk';
 IF c.def IS DISTINCT FROM 'CHECK ((role = ANY (ARRAY[''superadmin''::text, ''admin_logistica''::text, ''manager_santier''::text, ''sef_echipa''::text, ''contabilitate''::text, ''hr''::text, ''gestionar''::text, ''magazioner''::text])))'
 THEN RAISE EXCEPTION 'PORTAL_PROFILE_ROLES_CHANGED'; END IF;
 INSERT INTO public.portal_e1_1b_manifest VALUES ('role_live',jsonb_build_object('name',c.conname,'definition',c.def));
 IF EXISTS (SELECT FROM public.profiles WHERE role IS NULL OR role NOT IN
  ('superadmin','admin_logistica','manager_santier','sef_echipa','contabilitate','hr','gestionar','magazioner'))
 THEN RAISE EXCEPTION 'PORTAL_ROLE_PREFLIGHT'; END IF;
END $manifest$;
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_chk;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_chk CHECK (role IN
 ('superadmin','admin_logistica','manager_santier','sef_echipa','contabilitate','hr','gestionar','magazioner','teren','in_asteptare'));

CREATE TABLE public.portal_provisioning (
 provisioning_id uuid PRIMARY KEY,
 employee_id integer NOT NULL REFERENCES public.employees(id),
 email_calculat text NOT NULL UNIQUE CHECK (email_calculat ~ '^[a-z0-9]+([.][a-z0-9]+)*@teren[.]gazpet[.]ro$'),
 stare text NOT NULL CHECK (stare IN ('rezervat','creat','finalizat','anulat')),
 cerut_de uuid NOT NULL, cerut_la timestamptz NOT NULL DEFAULT clock_timestamp(),
 payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256)=32),
 auth_user_id uuid UNIQUE REFERENCES auth.users(id),
 CHECK ((stare='rezervat' AND auth_user_id IS NULL) OR stare='anulat'
   OR (stare IN ('creat','finalizat') AND auth_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX portal_provisioning_employee_deschis ON public.portal_provisioning(employee_id)
 WHERE stare IN ('rezervat','creat');
ALTER TABLE public.conturi_teren
 ADD COLUMN provisioning_id uuid UNIQUE REFERENCES public.portal_provisioning(provisioning_id),
 ADD COLUMN creat_la timestamptz,
 ADD COLUMN revocat_la timestamptz,
 ADD COLUMN revocat_motiv text;
-- Legacy: data crearii este necunoscuta; nu o inventam la apply. DEFAULT numai pentru randurile noi.
ALTER TABLE public.conturi_teren ALTER COLUMN creat_la SET DEFAULT now();
CREATE TABLE public.portal_provisioning_jurnal (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tabela text NOT NULL, operatie text NOT NULL, vechi jsonb,nou jsonb,
 autor uuid,rol_sesiune text NOT NULL,la timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.portal_provisioning ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_provisioning_jurnal ENABLE ROW LEVEL SECURITY;
-- Fara politici permisive si fara granturi client: numai RPC-uri DEFINER gardate.
REVOKE ALL ON public.portal_provisioning,public.portal_provisioning_jurnal
 FROM PUBLIC,anon,authenticated,service_role,teren,supabase_auth_admin;
REVOKE ALL ON SEQUENCE public.portal_provisioning_jurnal_id_seq
 FROM PUBLIC,anon,authenticated,service_role,teren,supabase_auth_admin;
CREATE FUNCTION public.fn_portal_provisioning_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 INSERT INTO public.portal_provisioning_jurnal(tabela,operatie,vechi,nou,autor,rol_sesiune)
 VALUES (TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,
 CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END,auth.uid(),session_user);
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_provisioning_audit() FROM PUBLIC,anon,authenticated,service_role,teren;
CREATE TRIGGER portal_provisioning_audit AFTER INSERT OR UPDATE OR DELETE ON public.portal_provisioning
 FOR EACH ROW EXECUTE FUNCTION public.fn_portal_provisioning_audit();
CREATE TRIGGER portal_conturi_teren_audit AFTER INSERT OR UPDATE OR DELETE ON public.conturi_teren
 FOR EACH ROW EXECUTE FUNCTION public.fn_portal_provisioning_audit();
CREATE TRIGGER portal_provisioning_jurnal_imuabil BEFORE UPDATE OR DELETE OR TRUNCATE ON public.portal_provisioning_jurnal
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_conturi_jurnal_imuabil();
CREATE TRIGGER portal_provisioning_no_truncate BEFORE TRUNCATE ON public.portal_provisioning
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_conturi_jurnal_imuabil();

-- Brief E1-1b: UPDATE termination_date=azi revoca imediat; r6 avea ultima zi inclusiva.
-- Predicat comun pentru pregatire, creare, finalizare, trigger si hook. Fisierul 18a ramane nemodificat.
CREATE FUNCTION public.fn_portal_angajat_eligibil(p_employee_id integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
 SELECT EXISTS (SELECT FROM public.employees e WHERE e.id=p_employee_id AND e.active IS TRUE
  AND (e.termination_date IS NULL OR e.termination_date > (now() AT TIME ZONE 'Europe/Bucharest')::date));
$fn$;
REVOKE ALL ON FUNCTION public.fn_portal_angajat_eligibil(integer) FROM PUBLIC,anon,authenticated,service_role,teren;

DO $elig_manifest$
DECLARE p record; m jsonb;
BEGIN
 SELECT pr.*,pg_get_userbyid(pr.proowner) AS proprietar INTO STRICT p
 FROM pg_proc pr WHERE pr.oid='public.fn_teren_eligibil(uuid)'::regprocedure;
 IF NOT EXISTS (SELECT FROM jsonb_array_elements(obj_description('public.conturi_tip'::regclass,'pg_class')::jsonb->'ddl') x
  WHERE x.value=jsonb_build_array('functie',p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig))
 THEN RAISE EXCEPTION 'PORTAL_ELIGIBILITY_MANIFEST_CHANGED'; END IF;
 IF p.prosrc IS DISTINCT FROM $elig_source$
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
END $elig_source$
  OR p.proprietar<>'postgres' OR p.prosecdef IS NOT TRUE
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
 THEN RAISE EXCEPTION 'PORTAL_ELIGIBILITY_BASELINE_CHANGED'; END IF;
 m:=jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proprietar,'acl',p.proacl::text,'proconfig',to_jsonb(p.proconfig));
 INSERT INTO public.portal_e1_1b_manifest VALUES('eligibil_live',m||jsonb_build_object('sha256',encode(sha256(convert_to(m::text,'UTF8')),'hex')));
END $elig_manifest$;
CREATE OR REPLACE FUNCTION public.fn_teren_eligibil(p_uid uuid) RETURNS boolean
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
    WHERE c.auth_user_id=p_uid AND c.stare='activ' AND public.fn_portal_angajat_eligibil(e.id) IS TRUE
      AND (u.banned_until IS NULL OR u.banned_until <= now()));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $fn$;

CREATE FUNCTION public.fn_portal_cont_pregateste(p_employee_id integer,p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_uid uuid:=auth.uid(); v_name text; v_parts text[]; v_base text; v_email text;
 v_i integer:=1; r public.portal_provisioning%ROWTYPE;
BEGIN
 IF v_uid IS NULL OR NOT EXISTS (SELECT FROM public.profiles p WHERE p.id=v_uid AND
  (p.is_owner IS TRUE OR EXISTS (SELECT FROM public.user_module_access a
   WHERE a.profile_id=v_uid AND a.module='hr')))
 THEN RAISE EXCEPTION 'PORTAL_ACCESS_DENIED'; END IF;
 IF p_cheie IS NULL OR p_employee_id IS NULL THEN RAISE EXCEPTION 'PORTAL_INVALID_REQUEST'; END IF;
 -- Ordine: advisory email (global) -> employees -> portal_provisioning -> conturi_tip -> conturi_teren/profiles.
 -- Serializarea namespace-ului email acopera si coliziunile intre angajati diferiti.
 PERFORM pg_advisory_xact_lock(hashtext('portal.email.teren'));
 SELECT e.name INTO v_name FROM public.employees e WHERE e.id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_INVALID_REQUEST'; END IF;
 SELECT * INTO r FROM public.portal_provisioning WHERE provisioning_id=p_cheie FOR UPDATE;
 IF FOUND THEN
  IF r.employee_id IS DISTINCT FROM p_employee_id OR r.cerut_de IS DISTINCT FROM v_uid
   OR r.payload_sha256 IS DISTINCT FROM sha256(convert_to(jsonb_build_array(p_employee_id,v_uid)::text,'UTF8'))
   OR r.stare='anulat' THEN RAISE EXCEPTION 'PORTAL_KEY_CONFLICT'; END IF;
  RETURN jsonb_build_object('provisioning_id',r.provisioning_id,'email',r.email_calculat,
   'stare',r.stare,'auth_user_id',r.auth_user_id);
 END IF;
 IF public.fn_portal_angajat_eligibil(p_employee_id) IS NOT TRUE
  OR EXISTS (SELECT FROM public.conturi_teren WHERE employee_id=p_employee_id)
  OR EXISTS (SELECT FROM public.profiles WHERE employee_id=p_employee_id)
  OR EXISTS (SELECT FROM public.portal_provisioning WHERE employee_id=p_employee_id AND stare IN ('rezervat','creat'))
 THEN RAISE EXCEPTION 'PORTAL_EMPLOYEE_UNAVAILABLE'; END IF;
 v_name:=lower(translate(v_name,'ĂÂÎȘŞȚŢăâîșşțţ','AAISSTTaaisstt'));
 v_parts:=regexp_split_to_array(btrim(v_name),'[[:space:]]+');
 IF cardinality(v_parts)<2 THEN RAISE EXCEPTION 'PORTAL_EMPLOYEE_NAME_INVALID'; END IF;
 v_base:=array_to_string(v_parts[2:cardinality(v_parts)],'.')||'.'||v_parts[1];
 -- Diacritice eliminate explicit, cratime/apostrofuri devin separatori; alte alfabete sunt refuzate.
 v_base:=regexp_replace(v_base,'[-''’]+','.','g');
 IF v_base !~ '^[a-z0-9]+([.][a-z0-9]+)*$' OR length(v_base)>55 THEN
  RAISE EXCEPTION 'PORTAL_EMPLOYEE_NAME_INVALID'; END IF;
 LOOP
  v_email:=v_base||CASE WHEN v_i=1 THEN '' ELSE '.'||v_i::text END||'@teren.gazpet.ro';
  EXIT WHEN NOT EXISTS (SELECT FROM public.portal_provisioning WHERE email_calculat=v_email)
   AND NOT EXISTS (SELECT FROM auth.users WHERE lower(email)=v_email);
  v_i:=v_i+1;
 END LOOP;
 INSERT INTO public.portal_provisioning(provisioning_id,employee_id,email_calculat,stare,cerut_de,payload_sha256)
 VALUES(p_cheie,p_employee_id,v_email,'rezervat',v_uid,sha256(convert_to(jsonb_build_array(p_employee_id,v_uid)::text,'UTF8')))
 ON CONFLICT (provisioning_id) DO NOTHING RETURNING * INTO r;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_KEY_CONFLICT'; END IF;
 RETURN jsonb_build_object('provisioning_id',r.provisioning_id,'email',r.email_calculat,
  'stare',r.stare,'auth_user_id',r.auth_user_id);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_cont_pregateste(integer,uuid) FROM PUBLIC,anon,authenticated,service_role,teren;
GRANT EXECUTE ON FUNCTION public.fn_portal_cont_pregateste(integer,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_portal_emp integer; v_portal_id uuid; v_portal public.portal_provisioning%ROWTYPE;
  v_n         integer := 0;
  v_emp       integer;
  v_nume      text;
  v_metoda    text;
  v_ocupat    boolean := false;
  v_incredere boolean := false;
  v_are_fisa  boolean := false;
  v_eroare    text;
  v_motiv     text;
BEGIN

  IF NEW.raw_app_meta_data->>'tip_cont' = 'teren' THEN
    -- Ordine: employees -> portal_provisioning -> conturi_tip -> conturi_teren -> profiles.
    -- auth.users este deja inserat de GoTrue; nu blocam un alt rand auth.users pe aceasta cale.
    v_portal_emp := (NEW.raw_app_meta_data->>'employee_id')::integer;
    v_portal_id := (NEW.raw_app_meta_data->>'provisioning_id')::uuid;
    PERFORM 1 FROM public.employees WHERE id=v_portal_emp FOR UPDATE;
    IF NOT FOUND OR public.fn_portal_angajat_eligibil(v_portal_emp) IS NOT TRUE THEN
      RAISE EXCEPTION 'PORTAL_RESERVATION_INVALID'; END IF;
    SELECT * INTO v_portal FROM public.portal_provisioning WHERE provisioning_id=v_portal_id FOR UPDATE;
    IF NOT FOUND OR v_portal.employee_id IS DISTINCT FROM v_portal_emp
      OR v_portal.stare IS DISTINCT FROM 'rezervat' OR v_portal.auth_user_id IS NOT NULL
      OR NEW.email IS DISTINCT FROM v_portal.email_calculat
      OR EXISTS (SELECT FROM public.profiles WHERE employee_id=v_portal_emp)
      OR EXISTS (SELECT FROM public.conturi_teren WHERE employee_id=v_portal_emp) THEN
      RAISE EXCEPTION 'PORTAL_RESERVATION_INVALID'; END IF;
    INSERT INTO public.conturi_tip(auth_user_id,tip,sursa,clasificat_de)
      VALUES(NEW.id,'teren','provisioning_e1_1b',v_portal.cerut_de);
    INSERT INTO public.conturi_teren(auth_user_id,employee_id,stare,provisioning_id)
      VALUES(NEW.id,v_portal_emp,'in_creare',v_portal_id);
    INSERT INTO public.profiles(id,email,name,role,employee_id)
      SELECT NEW.id,NEW.email,e.name,'teren',e.id FROM public.employees e WHERE e.id=v_portal_emp;
    UPDATE public.portal_provisioning SET stare='creat',auth_user_id=NEW.id
      WHERE provisioning_id=v_portal_id AND stare='rezervat' AND auth_user_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_RESERVATION_INVALID'; END IF;
    RETURN NEW;
  END IF;
  -- Inserăm doar dacă nu există deja (idempotent) — neschimbat
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    INITCAP(REPLACE(REPLACE(SPLIT_PART(NEW.email, '@', 1), '.', ' '), '_', ' ')),
    'in_asteptare'
  )
  ON CONFLICT (id) DO NOTHING;

  -- R1 sub-bloc 1: DOAR potrivirea (fără nicio scriere în profiles). Nicio eroare de aici nu blochează crearea contului.
  BEGIN
    v_incredere := COALESCE(NEW.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true';
    SELECT count(*), min(c.employee_id), min(c.employee_name), min(c.metoda),
           COALESCE(bool_or(c.profil_legat IS NOT NULL), false)
      INTO v_n, v_emp, v_nume, v_metoda, v_ocupat
      FROM public.fn_cont_candidati_angajat(NEW.email) c;       -- emailul de LOGARE (GoTrue)
    SELECT p.employee_id IS NOT NULL INTO v_are_fisa FROM public.profiles p WHERE p.id = NEW.id;
    v_are_fisa := COALESCE(v_are_fisa, false);
  EXCEPTION WHEN OTHERS THEN
    v_eroare := SQLERRM;
    RAISE WARNING 'handle_new_user R1 (%): % [%]', NEW.email, SQLERRM, SQLSTATE;
  END;

  -- R1 sub-bloc 2: notificarea owner-ilor (separat; best-effort)
  BEGIN
    IF v_eroare IS NULL AND v_n = 1 AND NOT v_ocupat AND NOT v_are_fisa THEN
      IF NOT v_incredere THEN
        -- orice domeniu: potrivirea pe email poate fi și pe adresa personală trecută pe fișă
        PERFORM public.fn_cont_notifica_owneri('cont_legare_propusa', '🔗 Cont nou: confirmă legarea de fișă',
          format('Cont nou %s → propunere: %s (#%s, prin %s). Dacă tu ai creat contul, confirmă din Admin → Manageri → „Leagă automat”. Dacă nu-l recunoști, NU-l lega și închide-l.',
                 NEW.email, v_nume, v_emp, v_metoda),
          '/admin?tab=managers&cont=' || NEW.id::text);
      END IF;
      -- calea de încredere: legarea și anunțul le face fn_cont_leaga_la_creare (cont-nou); dacă RPC-ul nu vine,
      -- contul apare în alerta fara_angajat cu candidatul unic.
    ELSIF v_eroare IS NOT NULL OR v_incredere
          OR lower(split_part(btrim(COALESCE(NEW.email, '')), '@', 2)) = 'gazpet.ro' THEN
      v_motiv := CASE
        WHEN v_eroare IS NOT NULL THEN 'eroare la potrivire: ' || v_eroare
        WHEN v_n = 0 THEN '0 candidați'
        WHEN v_n > 1 THEN v_n || ' candidați'
        WHEN v_ocupat THEN 'candidatul unic are deja cont'
        ELSE 'legătură existentă păstrată' END;
      PERFORM public.fn_cont_notifica_owneri('cont_nelegat', '⚠️ Cont nou nelegat de fișa de angajat',
        format('Cont nou %s nelegat: %s', NEW.email, v_motiv),
        '/admin?tab=managers&cont=' || NEW.id::text);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user R1 notificare (%): % [%]', NEW.email, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.fn_portal_cont_finalizeaza(p_provisioning_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE r public.portal_provisioning%ROWTYPE; v_emp integer; c public.conturi_teren%ROWTYPE;
BEGIN
 -- Exceptie server L08: rol SQL real; nu auth.role() sau claim/GUC custom.
 IF session_user <> 'service_role' AND current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'PORTAL_ACCESS_DENIED'; END IF;
 -- Ordine: employees -> portal_provisioning -> conturi_tip -> conturi_teren -> profiles -> user_module_access.
 SELECT employee_id INTO v_emp FROM public.portal_provisioning WHERE provisioning_id=p_provisioning_id;
 PERFORM 1 FROM public.employees WHERE id=v_emp FOR UPDATE;
 SELECT * INTO r FROM public.portal_provisioning WHERE provisioning_id=p_provisioning_id FOR UPDATE;
 IF NOT FOUND OR r.stare NOT IN ('creat','finalizat') OR r.auth_user_id IS NULL
  OR public.fn_portal_angajat_eligibil(v_emp) IS NOT TRUE THEN RAISE EXCEPTION 'PORTAL_FINALIZE_INVALID'; END IF;
 PERFORM 1 FROM public.conturi_tip WHERE auth_user_id=r.auth_user_id AND tip='teren' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_FINALIZE_INVALID'; END IF;
 SELECT * INTO c FROM public.conturi_teren WHERE auth_user_id=r.auth_user_id FOR UPDATE;
 IF NOT FOUND OR c.employee_id IS DISTINCT FROM r.employee_id OR c.provisioning_id IS DISTINCT FROM r.provisioning_id
  OR (r.stare='creat' AND c.stare IS DISTINCT FROM 'in_creare')
  OR (r.stare='finalizat' AND c.stare IS DISTINCT FROM 'activ') THEN RAISE EXCEPTION 'PORTAL_FINALIZE_INVALID'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=r.auth_user_id AND role='teren'
   AND employee_id=r.employee_id AND is_owner IS NOT TRUE FOR UPDATE;
 IF NOT FOUND OR EXISTS (SELECT FROM public.user_module_access WHERE profile_id=r.auth_user_id)
  OR NOT EXISTS (SELECT FROM auth.users u WHERE u.id=r.auth_user_id AND u.email=r.email_calculat
    AND u.raw_app_meta_data->>'tip_cont'='teren'
    AND u.raw_app_meta_data->>'employee_id'=r.employee_id::text
    AND u.raw_app_meta_data->>'provisioning_id'=r.provisioning_id::text
    AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN RAISE EXCEPTION 'PORTAL_FINALIZE_INVALID'; END IF;
 IF r.stare='creat' THEN
  UPDATE public.portal_provisioning SET stare='finalizat'
   WHERE provisioning_id=r.provisioning_id AND stare='creat' AND auth_user_id=r.auth_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_FINALIZE_CONFLICT'; END IF;
  UPDATE public.conturi_teren SET stare='activ' WHERE auth_user_id=r.auth_user_id
    AND provisioning_id=r.provisioning_id AND stare='in_creare';
  IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_FINALIZE_CONFLICT'; END IF;
 END IF;
 IF NOT EXISTS (SELECT FROM public.portal_provisioning z
   JOIN public.conturi_tip t ON t.auth_user_id=z.auth_user_id AND t.tip='teren'
   JOIN public.conturi_teren ct ON ct.auth_user_id=z.auth_user_id AND ct.employee_id=z.employee_id
    AND ct.provisioning_id=z.provisioning_id AND ct.stare='activ'
   JOIN public.profiles p ON p.id=z.auth_user_id AND p.role='teren' AND p.employee_id=z.employee_id
   WHERE z.provisioning_id=r.provisioning_id AND z.auth_user_id=r.auth_user_id AND z.stare='finalizat'
    AND p.is_owner IS NOT TRUE)
  OR EXISTS (SELECT FROM public.user_module_access WHERE profile_id=r.auth_user_id)
 THEN RAISE EXCEPTION 'PORTAL_FINALIZE_POSTCONDITION'; END IF;
 RETURN jsonb_build_object('provisioning_id',r.provisioning_id,'auth_user_id',r.auth_user_id,'stare','finalizat');
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_cont_finalizeaza(uuid) FROM PUBLIC,anon,authenticated,service_role,teren;
GRANT EXECUTE ON FUNCTION public.fn_portal_cont_finalizeaza(uuid) TO service_role;

CREATE FUNCTION public.fn_cont_aproba_erp(p_auth_user_id uuid,p_rol text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_uid uuid:=auth.uid(); v_emp integer;
BEGIN
 IF v_uid IS NULL OR NOT EXISTS (SELECT FROM public.profiles WHERE id=v_uid AND is_owner IS TRUE)
 THEN RAISE EXCEPTION 'PORTAL_ACCESS_DENIED'; END IF;
 IF p_rol IS NULL OR p_rol NOT IN ('superadmin','admin_logistica','manager_santier','sef_echipa',
   'contabilitate','hr','gestionar','magazioner') THEN RAISE EXCEPTION 'PORTAL_ROLE_INVALID'; END IF;
 -- Ordine: employees (daca este legat) -> conturi_tip -> conturi_teren -> profiles.
 SELECT employee_id INTO v_emp FROM public.profiles WHERE id=p_auth_user_id;
 IF v_emp IS NOT NULL THEN PERFORM 1 FROM public.employees WHERE id=v_emp FOR UPDATE; END IF;
 -- Lock pe parintele Auth serializeaza doua aprobari pentru aceeasi tinta fara clasificare.
 -- Provisioning nu ia lock pe auth.users existent (NEW este propria insertie).
 PERFORM 1 FROM auth.users WHERE id=p_auth_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_TARGET_INVALID'; END IF;
 IF EXISTS (SELECT FROM public.conturi_tip WHERE auth_user_id=p_auth_user_id)
  OR EXISTS (SELECT FROM public.conturi_teren WHERE auth_user_id=p_auth_user_id)
  OR EXISTS (SELECT FROM auth.users WHERE id=p_auth_user_id AND raw_app_meta_data->>'tip_cont'='teren')
 THEN RAISE EXCEPTION 'PORTAL_TARGET_CLASSIFIED'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_auth_user_id AND role='in_asteptare' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_TARGET_INVALID'; END IF;
 INSERT INTO public.conturi_tip(auth_user_id,tip,sursa,clasificat_de)
  VALUES(p_auth_user_id,'erp','aprobare_owner_e1_1b',v_uid);
 UPDATE public.profiles SET role=p_rol WHERE id=p_auth_user_id AND role='in_asteptare';
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_APPROVAL_CONFLICT'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_aproba_erp(uuid,text) FROM PUBLIC,anon,authenticated,service_role,teren;
GRANT EXECUTE ON FUNCTION public.fn_cont_aproba_erp(uuid,text) TO authenticated;

CREATE FUNCTION public.fn_portal_revoca_la_plecare() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 -- Ordine: employees (deja blocat de UPDATE) -> conturi_teren; nu exista lock invers.
 IF public.fn_portal_angajat_eligibil(NEW.id) IS NOT TRUE THEN
  UPDATE public.conturi_teren SET stare='revocat',revocat_la=clock_timestamp(),
   revocat_motiv=CASE WHEN NEW.active IS NOT TRUE THEN 'angajat_inactiv' ELSE 'incetare_contract' END
   WHERE employee_id=NEW.id AND stare IN ('in_creare','activ');
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_revoca_la_plecare() FROM PUBLIC,anon,authenticated,service_role,teren;
CREATE TRIGGER portal_revoca_la_plecare AFTER UPDATE OF active,termination_date ON public.employees
 FOR EACH ROW EXECUTE FUNCTION public.fn_portal_revoca_la_plecare();

CREATE FUNCTION public.fn_portal_1b_snapshot() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
 SELECT jsonb_build_object(
  'auth',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]')::text,'UTF8')),'hex') FROM (SELECT id,email,raw_app_meta_data,banned_until FROM auth.users) t),
  'profiles',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]')::text,'UTF8')),'hex') FROM public.profiles t),
  'employees',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]')::text,'UTF8')),'hex') FROM public.employees t),
  'access',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]')::text,'UTF8')),'hex') FROM public.user_module_access t),
  'tip',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY auth_user_id),'[]')::text,'UTF8')),'hex') FROM public.conturi_tip t),
  'teren',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY auth_user_id),'[]')::text,'UTF8')),'hex') FROM public.conturi_teren t),
  'tip_jurnal',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]')::text,'UTF8')),'hex') FROM public.conturi_tip_jurnal t),
  'provisioning',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY provisioning_id),'[]')::text,'UTF8')),'hex') FROM public.portal_provisioning t),
  'jurnal',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]')::text,'UTF8')),'hex') FROM public.portal_provisioning_jurnal t),
  'ddl',(SELECT coalesce(jsonb_agg(x.obj ORDER BY x.cheie COLLATE "C"),'[]') FROM (
   SELECT 'f:'||p.oid AS cheie,jsonb_build_array('function',p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig) AS obj
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='public' OR p.oid IN ('auth.uid()'::regprocedure,'auth.jwt()'::regprocedure)) AND p.prokind IN ('f','p')
   UNION ALL SELECT 'r:'||c.oid,jsonb_build_array('relation',c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
   UNION ALL SELECT 'a:'||a.attrelid||':'||a.attnum,jsonb_build_array('column',a.attrelid,a.attnum,a.attname,a.atttypid,
    a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,a.attacl,pg_get_expr(d.adbin,d.adrelid))
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
   UNION ALL SELECT 'c:'||c.oid,jsonb_build_array('constraint',c.conrelid,c.conname,pg_get_constraintdef(c.oid))
    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'
   UNION ALL SELECT 'p:'||p.oid,jsonb_build_array('policy',p.polrelid,p.polname,p.polcmd,p.polpermissive,p.polroles,
    pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) FROM pg_policy p
    JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
   UNION ALL SELECT 't:'||t.oid,jsonb_build_array('trigger',t.tgrelid,t.tgfoid,t.tgenabled,pg_get_triggerdef(t.oid))
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
  ) x));
$fn$;
REVOKE ALL ON FUNCTION public.fn_portal_1b_snapshot() FROM PUBLIC,anon,authenticated,service_role,teren,supabase_auth_admin;
CREATE FUNCTION public.fn_portal_porti_lipsa_1b() RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v text[]; r record;
BEGIN
 v:=public.fn_portal_porti_lipsa();
 IF EXISTS (SELECT FROM public.portal_e1_1b_manifest WHERE cheie='post_snapshot')
  AND public.fn_portal_1b_snapshot()->'ddl' IS DISTINCT FROM
   (SELECT valoare->'ddl' FROM public.portal_e1_1b_manifest WHERE cheie='post_snapshot') THEN
  v:=array_append(v,'1b amprenta DDL'); END IF;
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('fn_portal_cont_pregateste','fn_portal_cont_finalizeaza',
  'fn_cont_aproba_erp','fn_portal_angajat_eligibil','fn_portal_revoca_la_plecare','fn_portal_provisioning_audit',
  'fn_portal_1b_snapshot','fn_portal_porti_lipsa_1b','handle_new_user') LOOP
  IF has_function_privilege('teren',r.oid,'EXECUTE') OR has_function_privilege('anon',r.oid,'EXECUTE') THEN
   v:=array_append(v,'1b functie:'||r.proname); END IF;
 END LOOP;
 -- Inventarul lipsa ramane o alerta explicita (pending/invite nu inseamna aprobare).
 IF EXISTS (SELECT FROM public.portal_provisioning p JOIN public.conturi_teren c USING(provisioning_id)
   WHERE p.auth_user_id IS DISTINCT FROM c.auth_user_id OR p.employee_id IS DISTINCT FROM c.employee_id
    OR (p.stare='finalizat' AND c.stare NOT IN ('activ','revocat'))) THEN
   v:=array_append(v,'1b provisioning incoerent'); END IF;
 RETURN v;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_porti_lipsa_1b() FROM PUBLIC,anon,authenticated,service_role,teren,supabase_auth_admin;
CREATE TRIGGER portal_1b_manifest_imuabil BEFORE UPDATE OR DELETE OR TRUNCATE ON public.portal_e1_1b_manifest
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_conturi_jurnal_imuabil();
DO $post$
BEGIN
 IF public.fn_portal_porti_lipsa_1b() <> '{}'::text[] THEN RAISE EXCEPTION 'PORTAL_1B_POSTCONDITION'; END IF;
 INSERT INTO public.portal_e1_1b_manifest VALUES ('post_snapshot',public.fn_portal_1b_snapshot());
END $post$;
