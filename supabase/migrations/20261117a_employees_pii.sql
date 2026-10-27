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
    SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_employees_personal') THEN
    RAISE EXCEPTION 'epi_preflight: obiecte deja existente';
  END IF;
  IF to_regclass('public.employees') IS NULL OR to_regclass('public.profiles') IS NULL THEN RAISE EXCEPTION 'epi_preflight: schema lipsa'; END IF;
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
  policies_before jsonb NOT NULL
);
ALTER TABLE public.employees_pii_acl_20261117a ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employees_pii_acl_20261117a FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.employees_pii_acl_20261117a(before_acl,columns_before,policies_before)
SELECT
  (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY col,grantor,grantee,privilege_type,is_grantable),'[]'::jsonb) FROM (
    SELECT ''::text col,x.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x WHERE c.oid='public.employees'::regclass
    UNION ALL SELECT attname::text,x.* FROM pg_attribute CROSS JOIN LATERAL aclexplode(attacl) x WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped
  ) a),
  ARRAY(SELECT attname::text FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum),
  (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.polname),'[]'::jsonb) FROM pg_policy p WHERE polrelid='public.employees'::regclass);

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

DO $epi_post_20261117a$
DECLARE c text; r text; v record;
BEGIN
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
  UPDATE public.employees_pii_acl_20261117a SET after_acl=(
    SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY col,grantor,grantee,privilege_type,is_grantable),'[]'::jsonb) FROM (
      SELECT ''::text col,x.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x WHERE c.oid='public.employees'::regclass
      UNION ALL SELECT attname::text,x.* FROM pg_attribute CROSS JOIN LATERAL aclexplode(attacl) x WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped
    ) a) WHERE singleton;
  IF (SELECT policies_before IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.polname),'[]'::jsonb) FROM pg_policy p WHERE polrelid='public.employees'::regclass)
      FROM public.employees_pii_acl_20261117a WHERE singleton) THEN RAISE EXCEPTION 'epi_post: politici schimbate'; END IF;
END $epi_post_20261117a$;
NOTIFY pgrst,'reload schema';
