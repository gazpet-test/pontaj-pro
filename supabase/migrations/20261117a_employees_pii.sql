-- NEAPLICAT. ASCII / LF. Runner 20261117120000, o singura tranzactie.
-- Fara BEGIN/COMMIT: runner-ul armeaza garda cu txid_current(). Fara date HR modificate.
DO $epi_start_20261117a$
DECLARE c text; a record;
  expected text[] := ARRAY['id','name','department','position','active','created_at','site_id','email','iban','hire_date','termination_date','functii_extra','functie','departament_hr','rol_in_firma','telefon','are_autorizatii','observatii_hr','cetatenie','tip_contract','procent_ocupare','co_maxim_zile','cetatenie_secundara','qr_pin','qr_pin_active','qr_pin_creat_la','cnp','adresa','data_nasterii','protejat_la_stergere','marime_incaltaminte','marime_imbracaminte','cod_cor','functie_cim','colaborare_externa_status','colaborare_externa_confirmat_de','colaborare_externa_confirmat_la','colaborare_externa_nota','colaborare_externa_document'];
BEGIN
  IF current_user <> 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261117a_employees_pii:' || txid_current() THEN
    RAISE EXCEPTION 'epi_garda: armare invalida';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'epi_izolare: READ COMMITTED necesar'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
  PERFORM set_config('lock_timeout','5s',true);
  IF EXISTS(SELECT 1 FROM pg_db_role_setting s,unnest(s.setconfig) cfg WHERE lower(cfg) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION 'epi_garda: armare persistenta';
  END IF;
  IF to_regclass('public.employees_pii_acl_20261117a') IS NOT NULL OR EXISTS(
    SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('fn_employees_personal','fn_employees_marimi')) THEN
    RAISE EXCEPTION 'epi_preflight: obiecte deja existente';
  END IF;
  IF to_regclass('public.employees') IS NULL OR to_regclass('public.profiles') IS NULL THEN RAISE EXCEPTION 'epi_preflight: schema lipsa'; END IF;
  -- Baseline revizuit: corpul exact din 20260929e, UTF8/LF, fara normalizare.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.fn_fost_angajat_leaga_extern(integer,bigint)')
    AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3805eb86a4fb38c31b698620a6ac97014c72315cbe03245e516c3373ed60d43d'
    AND p.proowner=current_user::regrole AND p.prosecdef AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
    AND p.proconfig=ARRAY['search_path=public, pg_temp']::text[])
    OR has_function_privilege('anon','public.fn_fost_angajat_leaga_extern(integer,bigint)','EXECUTE')
    OR has_function_privilege('service_role','public.fn_fost_angajat_leaga_extern(integer,bigint)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.fn_fost_angajat_leaga_extern(integer,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'epi_preflight: drift fn_fost_angajat_leaga_extern';
  END IF;
  -- Lock inainte de citirea metadatelor; nu se blocheaza randuri HR si nu se modifica date.
  LOCK TABLE public.employees IN ACCESS EXCLUSIVE MODE;
  IF (SELECT relowner <> current_user::regrole OR NOT relrowsecurity OR relkind <> 'r' FROM pg_class WHERE oid='public.employees'::regclass) THEN
    RAISE EXCEPTION 'epi_preflight: owner/RLS/tip employees neasteptat';
  END IF;
  IF EXISTS(SELECT attname FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped
    EXCEPT SELECT unnest(expected)) OR EXISTS(SELECT unnest(expected) EXCEPT
    SELECT attname FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped) THEN
    RAISE EXCEPTION 'epi_preflight: coloane diferite de baseline; revizuire necesara';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attname='id' AND atttypid IN ('int4'::regtype,'int8'::regtype)) THEN
    RAISE EXCEPTION 'epi_preflight: tip id neasteptat';
  END IF;
  FOREACH c IN ARRAY ARRAY['cnp','iban','adresa','telefon','email','observatii_hr','qr_pin','marime_incaltaminte','marime_imbracaminte'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attname=c AND atttypid='text'::regtype) THEN
      RAISE EXCEPTION 'epi_preflight: tip coloana personala neasteptat';
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attname='data_nasterii' AND atttypid='date'::regtype)
    OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attname='qr_pin_active' AND atttypid='boolean'::regtype)
    OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attname='qr_pin_creat_la' AND atttypid='timestamptz'::regtype) THEN
    RAISE EXCEPTION 'epi_preflight: tipuri data/PIN neasteptate';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.profiles'::regclass AND NOT attisdropped AND
    ((attname='id' AND atttypid='uuid'::regtype) OR (attname IN ('is_owner','can_access_personal_data','can_modify_employees') AND atttypid='boolean'::regtype))) <> 4 THEN
    RAISE EXCEPTION 'epi_preflight: flaguri profiles lipsa sau tip neasteptat';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.employees'::regclass AND polname='employees_update_authorized' AND polcmd='w')
    OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.employees'::regclass AND polname='employees_insert_authorized' AND polcmd='a') THEN
    RAISE EXCEPTION 'epi_preflight: politicile existente de scriere lipsesc';
  END IF;
  -- Nu folosim CASCADE pentru ACL: dependentele granturilor trebuie revizuite separat.
  FOR a IN SELECT x.* FROM (
    SELECT (aclexplode(relacl)).* FROM pg_class WHERE oid='public.employees'::regclass
    UNION ALL SELECT (aclexplode(attacl)).* FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped
  ) x WHERE x.privilege_type='SELECT' AND x.grantee IN ('authenticated'::regrole,'anon'::regrole) LOOP
    IF a.grantor <> current_user::regrole THEN RAISE EXCEPTION 'epi_preflight: grantor SELECT neasteptat'; END IF;
  END LOOP;
END $epi_start_20261117a$;

-- Backup exclusiv de metadate ACL. RLS fara policies: niciun rol API nu il citeste.
CREATE TABLE public.employees_pii_acl_20261117a (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  before_acl jsonb NOT NULL, after_acl jsonb,
  columns_before text[] NOT NULL,
  fost_extern_before text NOT NULL, fost_extern_after text,
  fost_extern_acl aclitem[],
  policies_before jsonb NOT NULL
);
ALTER TABLE public.employees_pii_acl_20261117a ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employees_pii_acl_20261117a FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.employees_pii_acl_20261117a(before_acl,columns_before,policies_before,fost_extern_before,fost_extern_acl)
SELECT
  (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY col,grantor,grantee,privilege_type,is_grantable),'[]'::jsonb) FROM (
    SELECT ''::text col,x.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x WHERE c.oid='public.employees'::regclass
    UNION ALL SELECT attname::text,x.* FROM pg_attribute CROSS JOIN LATERAL aclexplode(attacl) x WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped
  ) a),
  ARRAY(SELECT attname::text FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum),
  (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.polname),'[]'::jsonb) FROM pg_policy p WHERE polrelid='public.employees'::regclass),
  pg_get_functiondef('public.fn_fost_angajat_leaga_extern(integer,bigint)'::regprocedure),
  (SELECT proacl FROM pg_proc WHERE oid='public.fn_fost_angajat_leaga_extern(integer,bigint)'::regprocedure);

REVOKE SELECT ON public.employees FROM authenticated,anon;
DO $epi_columns_20261117a$
DECLARE col text;
BEGIN
  FOR col IN SELECT attname FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE SELECT (%I) ON public.employees FROM authenticated,anon',col);
  END LOOP;
END $epi_columns_20261117a$;
GRANT SELECT (id,name,department,position,active,created_at,site_id,hire_date,termination_date,functii_extra,functie,departament_hr,rol_in_firma,are_autorizatii,cetatenie,tip_contract,procent_ocupare,co_maxim_zile,cetatenie_secundara,protejat_la_stergere,cod_cor,functie_cim,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document)
  ON public.employees TO authenticated;

CREATE FUNCTION public.fn_employees_personal(p_ids bigint[] DEFAULT NULL)
RETURNS TABLE(id bigint,cnp text,iban text,adresa text,data_nasterii date,telefon text,email text,observatii_hr text,
  qr_pin text,qr_pin_active boolean,qr_pin_creat_la timestamptz,marime_incaltaminte text,marime_imbracaminte text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $epi_read_20261117a$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
    AND (p.is_owner IS TRUE OR p.can_access_personal_data IS TRUE)) THEN
    RAISE EXCEPTION 'Acces refuzat la date personale' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT e.id::bigint,e.cnp,e.iban,e.adresa,e.data_nasterii,e.telefon,e.email,e.observatii_hr,
    e.qr_pin,e.qr_pin_active,e.qr_pin_creat_la,e.marime_incaltaminte,e.marime_imbracaminte
    FROM public.employees e WHERE p_ids IS NULL OR e.id=ANY(p_ids) ORDER BY e.id;
END $epi_read_20261117a$;
REVOKE ALL ON FUNCTION public.fn_employees_personal(bigint[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.fn_employees_personal(bigint[]) TO authenticated;

CREATE FUNCTION public.fn_employees_marimi(p_ids bigint[] DEFAULT NULL)
RETURNS TABLE(id bigint,marime_incaltaminte text,marime_imbracaminte text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $epi_marimi_20261117a$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
      AND (p.is_owner IS TRUE OR p.can_access_personal_data IS TRUE))
    OR EXISTS(SELECT 1 FROM public.user_module_access u WHERE u.profile_id=auth.uid()
      AND u.module='magazie' AND u.access_level IN ('viewer','editor','admin'))
  ) THEN
    RAISE EXCEPTION 'Acces refuzat la marimi EIP' USING ERRCODE='42501';
  END IF;
  -- Ca la RPC personal: filtre id, ordine stabila; plafon/paginare prin PostgREST.
  RETURN QUERY SELECT e.id::bigint,e.marime_incaltaminte,e.marime_imbracaminte
    FROM public.employees e WHERE p_ids IS NULL OR e.id=ANY(p_ids) ORDER BY e.id;
END $epi_marimi_20261117a$;
REVOKE ALL ON FUNCTION public.fn_employees_marimi(bigint[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.fn_employees_marimi(bigint[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_fost_angajat_leaga_extern(p_employee_id integer, p_extern_id bigint DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid  uuid := public.fn_identitate_om();
  v_e    public.employees%ROWTYPE;
  v_x    public.hr_personal_extern%ROWTYPE;
  v_id   bigint;
  v_constr text;
  v_exist  bigint;
  v_personal boolean;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles
                                   WHERE id = v_uid AND (is_owner IS TRUE OR can_modify_employees IS TRUE)) THEN
    RAISE EXCEPTION 'Doar owner sau HR (can_modify_employees) pot trece un fost angajat ca extern' USING ERRCODE = '42501';
  END IF;
  -- Dreptul de copiere este identic cu fn_employees_personal; rolul de scriere nu ajunge.
  v_personal := auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
      AND (p.is_owner IS TRUE OR p.can_access_personal_data IS TRUE));
  SELECT * INTO v_e FROM public.employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fișa #% nu există', p_employee_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT (v_e.termination_date IS NOT NULL AND v_e.termination_date <= CURRENT_DATE AND v_e.active IS NOT TRUE) THEN
    RAISE EXCEPTION 'Fișa #% nu e a unui fost angajat (contract încheiat și fișă inactivă)', p_employee_id USING ERRCODE = '22023';
  END IF;
  SELECT x.id INTO v_id FROM public.hr_personal_extern x WHERE x.fost_angajat_employee_id = p_employee_id;
  IF FOUND THEN RETURN v_id; END IF;                          -- idempotent

  IF p_extern_id IS NOT NULL THEN
    SELECT * INTO v_x FROM public.hr_personal_extern WHERE id = p_extern_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Externul #% nu există', p_extern_id USING ERRCODE = 'P0002';
    END IF;
    IF v_x.fost_angajat_employee_id IS NOT NULL THEN
      RAISE EXCEPTION 'Externul #% e deja legat de fișa #%', p_extern_id, v_x.fost_angajat_employee_id USING ERRCODE = '23505';
    END IF;
    UPDATE public.hr_personal_extern
       SET fost_angajat_employee_id = p_employee_id,
           activ = (activ AND v_e.colaborare_externa_status = 'accepta'),
           updated_at = now()
     WHERE id = p_extern_id;
    RETURN p_extern_id;
  END IF;

  BEGIN
    INSERT INTO public.hr_personal_extern (nume, functie, telefon, email, observatii, activ, created_by, fost_angajat_employee_id)
    VALUES (v_e.name, COALESCE(v_e.functie, v_e.position), CASE WHEN v_personal THEN v_e.telefon ELSE NULL END, CASE WHEN v_personal THEN NULLIF(btrim(v_e.email), '') ELSE NULL END,
            format('Fost angajat Gazpet (fișa #%s), contract încheiat la %s', v_e.id, to_char(v_e.termination_date, 'DD.MM.YYYY')),
            v_e.colaborare_externa_status = 'accepta', v_uid, p_employee_id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constr = CONSTRAINT_NAME;
    IF v_constr = 'uq_hr_personal_extern_nume' THEN
      SELECT x.id INTO v_exist FROM public.hr_personal_extern x WHERE lower(btrim(x.nume)) = lower(btrim(v_e.name));
      RAISE EXCEPTION 'Există deja un extern cu numele %', v_e.name
        USING ERRCODE = '23505', HINT = format('Există deja externul %s (#%s): leagă-l explicit', v_e.name, v_exist);
    END IF;
    RAISE;
  END;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_fost_angajat_leaga_extern(integer, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_fost_angajat_leaga_extern(integer, bigint) TO authenticated;

DO $epi_post_20261117a$
DECLARE c text; r text; v record;
BEGIN
  IF has_function_privilege('anon','public.fn_employees_marimi(bigint[])','EXECUTE')
    OR has_function_privilege('service_role','public.fn_employees_marimi(bigint[])','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.fn_employees_marimi(bigint[])','EXECUTE') THEN
    RAISE EXCEPTION 'epi_post: privilegii RPC marimi neasteptate';
  END IF;
  FOREACH r IN ARRAY ARRAY['authenticated','anon'] LOOP
    FOREACH c IN ARRAY ARRAY['cnp','iban','adresa','data_nasterii','telefon','email','observatii_hr','qr_pin','qr_pin_active','qr_pin_creat_la','marime_incaltaminte','marime_imbracaminte'] LOOP
      IF has_column_privilege(r,'public.employees',c,'SELECT') THEN
        RAISE EXCEPTION 'epi_preflight: SELECT personal mostenit/PUBLIC; revizuire ACL necesara';
      END IF;
    END LOOP;
  END LOOP;
  -- Dependente tranzitive ale view-urilor (inclusiv materializate), fara regex pe SQL.
  -- Conservator: dependenta pe intreaga relatie poate include si view-uri fara personal.
  -- Nu eliminam garda automat: asemenea view-uri necesita baseline revizuit separat.
  FOR v IN WITH RECURSIVE dependent(relid) AS (
    SELECT DISTINCT rw.ev_class FROM pg_depend d JOIN pg_rewrite rw ON d.classid='pg_rewrite'::regclass AND d.objid=rw.oid
    WHERE d.refclassid='pg_class'::regclass AND d.refobjid='public.employees'::regclass
      AND (d.refobjsubid=0 OR d.refobjsubid IN (SELECT attnum FROM pg_attribute WHERE attrelid='public.employees'::regclass
        AND attname=ANY(ARRAY['cnp','iban','adresa','data_nasterii','telefon','email','observatii_hr','qr_pin','qr_pin_active','qr_pin_creat_la','marime_incaltaminte','marime_imbracaminte'])))
    UNION
    SELECT rw.ev_class FROM dependent p JOIN pg_depend d ON d.refclassid='pg_class'::regclass AND d.refobjid=p.relid
      JOIN pg_rewrite rw ON d.classid='pg_rewrite'::regclass AND d.objid=rw.oid
  ) SELECT c.oid,c.relkind,c.reloptions FROM dependent d JOIN pg_class c ON c.oid=d.relid WHERE c.oid<>'public.employees'::regclass LOOP
    IF v.relkind='m' OR (v.relkind='v' AND NOT EXISTS(
      SELECT 1 FROM pg_options_to_table(v.reloptions) opt WHERE opt.option_name='security_invoker' AND opt.option_value::boolean)) THEN
      IF has_any_column_privilege('authenticated',v.oid,'SELECT') OR has_any_column_privilege('anon',v.oid,'SELECT') THEN
        RAISE EXCEPTION 'epi_preflight: view personal accesibil; necesita audit separat';
      END IF;
    END IF;
  END LOOP;
  IF NOT has_column_privilege('authenticated','public.employees','name','SELECT') OR
     NOT has_column_privilege('authenticated','public.employees','functie','SELECT') THEN RAISE EXCEPTION 'epi_post: SELECT public lipsa'; END IF;
  IF (SELECT fost_extern_acl IS DISTINCT FROM (SELECT proacl FROM pg_proc
      WHERE oid='public.fn_fost_angajat_leaga_extern(integer,bigint)'::regprocedure)
      FROM public.employees_pii_acl_20261117a WHERE singleton) THEN
    RAISE EXCEPTION 'epi_post: ACL functie externa schimbat';
  END IF;
  UPDATE public.employees_pii_acl_20261117a SET
    fost_extern_after=pg_get_functiondef('public.fn_fost_angajat_leaga_extern(integer,bigint)'::regprocedure), after_acl=(
    SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY col,grantor,grantee,privilege_type,is_grantable),'[]'::jsonb) FROM (
      SELECT ''::text col,x.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x WHERE c.oid='public.employees'::regclass
      UNION ALL SELECT attname::text,x.* FROM pg_attribute CROSS JOIN LATERAL aclexplode(attacl) x WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped
    ) a) WHERE singleton;
  IF (SELECT policies_before IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.polname),'[]'::jsonb) FROM pg_policy p WHERE polrelid='public.employees'::regclass)
      FROM public.employees_pii_acl_20261117a WHERE singleton) THEN RAISE EXCEPTION 'epi_post: politici schimbate'; END IF;
END $epi_post_20261117a$;
NOTIFY pgrst,'reload schema';
