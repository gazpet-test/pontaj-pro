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
  LOCK TABLE public.employees,public.hr_personal_extern,public.employees_pii_acl_20261117a IN ACCESS EXCLUSIVE MODE;
  SELECT * INTO STRICT saved FROM public.employees_pii_acl_20261117a WHERE singleton;
  SELECT array_agg(attname::text ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped;
  IF cols IS DISTINCT FROM saved.columns_before THEN RAISE EXCEPTION 'epi_rollback_drift: coloane schimbate'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY col,grantor,grantee,privilege_type,is_grantable),'[]'::jsonb) INTO actual FROM (
    SELECT ''::text col,x.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x WHERE c.oid='public.employees'::regclass
    UNION ALL SELECT attname::text,x.* FROM pg_attribute CROSS JOIN LATERAL aclexplode(attacl) x WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped
  ) x;
  IF actual IS DISTINCT FROM saved.after_acl THEN RAISE EXCEPTION 'epi_rollback_drift: privilegii schimbate dupa migrare'; END IF;
  IF pg_get_functiondef('public.fn_fost_angajat_leaga_extern(integer,bigint)'::regprocedure)
      IS DISTINCT FROM saved.fost_extern_after OR
      (SELECT proacl FROM pg_proc WHERE oid='public.fn_fost_angajat_leaga_extern(integer,bigint)'::regprocedure)
      IS DISTINCT FROM saved.fost_extern_acl THEN
    RAISE EXCEPTION 'epi_rollback_drift: functie externa schimbata';
  END IF;
  IF saved.members_after IS DISTINCT FROM (WITH RECURSIVE ancestors(id) AS (SELECT unnest(ARRAY['authenticated'::regrole::oid,'anon'::regrole::oid,'service_role'::regrole::oid]) UNION SELECT membership_row.roleid FROM pg_auth_members membership_row JOIN ancestors p ON membership_row.member=p.id) SELECT coalesce(jsonb_agg(to_jsonb(membership_row) ORDER BY membership_row.roleid,membership_row.member,membership_row.grantor),'[]'::jsonb) FROM pg_auth_members membership_row WHERE membership_row.member IN (SELECT id FROM ancestors)) OR
     saved.extern_policies_after IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('name',polname,'cmd',polcmd,'roles',polroles,'permissive',polpermissive,'qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) ORDER BY polname) FROM pg_policy WHERE polrelid='public.hr_personal_extern'::regclass) OR
     saved.write_guard_after IS DISTINCT FROM (SELECT jsonb_build_object('all_triggers',(SELECT jsonb_agg(to_jsonb(tg) ORDER BY tg.tgname) FROM pg_trigger tg WHERE tg.tgrelid='public.employees'::regclass),'extern_table',(SELECT jsonb_build_object('acl',relacl,'owner',relowner,'rls',relrowsecurity,'force',relforcerowsecurity) FROM pg_class WHERE oid='public.hr_personal_extern'::regclass),'trigger',to_jsonb(t),'function',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.employees'::regclass AND t.tgname='trg_employees_zz_pii_write') THEN
    RAISE EXCEPTION 'epi_rollback_drift: politici/roluri/trigger schimbate';
  END IF;
  IF saved.policies_before IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.polname),'[]'::jsonb)
    FROM pg_policy p WHERE polrelid='public.employees'::regclass) THEN
    RAISE EXCEPTION 'epi_rollback_drift: politici employees schimbate';
  END IF;
  -- Restauram exact expresiile din snapshot protejat; numele/rolurile nu au fost schimbate.
  FOR a IN SELECT * FROM jsonb_to_recordset(saved.extern_policies_before) AS x(name text,qual text,"check" text) LOOP
    IF a.name='hr_personal_extern_update' THEN
      EXECUTE format('ALTER POLICY %I ON public.hr_personal_extern USING (%s) WITH CHECK (%s)',a.name,a.qual,a."check");
    ELSIF a.name='hr_personal_extern_insert' THEN
      EXECUTE format('ALTER POLICY %I ON public.hr_personal_extern WITH CHECK (%s)',a.name,a."check");
    END IF;
  END LOOP;
  IF saved.extern_policies_before IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('name',polname,'cmd',polcmd,'roles',polroles,'permissive',polpermissive,'qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) ORDER BY polname) FROM pg_policy WHERE polrelid='public.hr_personal_extern'::regclass) THEN
    RAISE EXCEPTION 'epi_rollback: restaurare politici inexacta';
  END IF;
  -- Definitia provine exclusiv din snapshot-ul protejat, nu din parametri client.
  EXECUTE saved.fost_extern_before;
  IF pg_get_functiondef('public.fn_fost_angajat_leaga_extern(integer,bigint)'::regprocedure)
      IS DISTINCT FROM saved.fost_extern_before OR
      (SELECT proacl FROM pg_proc WHERE oid='public.fn_fost_angajat_leaga_extern(integer,bigint)'::regprocedure)
      IS DISTINCT FROM saved.fost_extern_acl THEN
    RAISE EXCEPTION 'epi_rollback: restaurare functie inexacta';
  END IF;
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
DROP TRIGGER trg_employees_zz_pii_write ON public.employees;
DROP FUNCTION public.fn_employees_pii_write_guard();
DROP FUNCTION public.fn_employees_marimi(bigint[]);
DROP FUNCTION public.fn_employees_personal(bigint[]);
DROP TABLE public.employees_pii_acl_20261117a;
NOTIFY pgrst,'reload schema';
