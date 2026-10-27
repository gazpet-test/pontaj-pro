-- NEAPLICAT. O singura tranzactie. Restaureaza privilegiile efective si grantorii initiali.
DO $epi_rollback_20261117a$
DECLARE saved public.employees_pii_acl_20261117a%ROWTYPE; actual jsonb; c text; a record; cols text[];
BEGIN
  IF current_user<>'postgres' OR current_setting('gazpet.revenire_20261117a',true) IS DISTINCT FROM 'EMPLOYEES_PII_RESTAUREAZA:' || txid_current() THEN
    RAISE EXCEPTION 'epi_garda: rollback nearmat';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'epi_izolare: READ COMMITTED necesar'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
  PERFORM set_config('lock_timeout','5s',true);
  IF EXISTS(SELECT 1 FROM pg_db_role_setting s,unnest(s.setconfig) cfg WHERE lower(cfg) LIKE 'gazpet.revenire_20261117a=%') THEN RAISE EXCEPTION 'epi_garda: armare persistenta'; END IF;
  LOCK TABLE public.employees,public.employees_pii_acl_20261117a IN ACCESS EXCLUSIVE MODE;
  SELECT * INTO STRICT saved FROM public.employees_pii_acl_20261117a WHERE singleton;
  SELECT array_agg(attname::text ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped;
  IF cols IS DISTINCT FROM saved.columns_before THEN RAISE EXCEPTION 'epi_rollback_drift: coloane schimbate'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY col,grantor,grantee,privilege_type,is_grantable),'[]'::jsonb) INTO actual FROM (
    SELECT ''::text col,x.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x WHERE c.oid='public.employees'::regclass
    UNION ALL SELECT attname::text,x.* FROM pg_attribute CROSS JOIN LATERAL aclexplode(attacl) x WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped
  ) x;
  IF actual IS DISTINCT FROM saved.after_acl THEN RAISE EXCEPTION 'epi_rollback_drift: privilegii schimbate dupa migrare'; END IF;
  REVOKE SELECT ON public.employees FROM authenticated,anon;
  FOREACH c IN ARRAY cols LOOP EXECUTE format('REVOKE SELECT (%I) ON public.employees FROM authenticated,anon',c); END LOOP;
  FOR a IN SELECT * FROM jsonb_to_recordset(saved.before_acl) AS x(col text,grantor oid,grantee oid,privilege_type text,is_grantable boolean)
    WHERE grantee IN ('authenticated'::regrole,'anon'::regrole) AND privilege_type='SELECT' ORDER BY col,grantee LOOP
    EXECUTE format('GRANT SELECT %s ON public.employees TO %I%s',
      CASE WHEN a.col='' THEN '' ELSE format('(%I)',a.col) END,
      pg_get_userbyid(a.grantee), CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY col,grantor,grantee,privilege_type,is_grantable),'[]'::jsonb) INTO actual FROM (
    SELECT ''::text col,x.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x WHERE c.oid='public.employees'::regclass
    UNION ALL SELECT attname::text,x.* FROM pg_attribute CROSS JOIN LATERAL aclexplode(attacl) x WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped
  ) x;
  IF actual IS DISTINCT FROM saved.before_acl THEN RAISE EXCEPTION 'epi_rollback: restaurare ACL inexacta'; END IF;
END $epi_rollback_20261117a$;
DROP FUNCTION public.fn_employees_marimi(bigint[]);
DROP FUNCTION public.fn_employees_personal(bigint[]);
DROP TABLE public.employees_pii_acl_20261117a;
NOTIFY pgrst,'reload schema';
