-- Livrabil de revenire prin acelasi runner, sub numele de mai jos.
DO $pre$
BEGIN
  IF current_user <> 'postgres' OR current_setting('gazpet.livrare_migrare',true)
    IS DISTINCT FROM '20261118a_portal_teren_identitate_ROLLBACK:'||txid_current() THEN
    RAISE EXCEPTION 'PORTAL_ROLLBACK_RUNNER_REQUIRED'; END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'PORTAL_READ_COMMITTED_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
END $pre$;
SET LOCAL search_path = public, pg_temp;
-- Lock inainte de citirea baseline-ului: blocheaza inclusiv cascadele concurente.
LOCK TABLE auth.users IN SHARE MODE;
LOCK TABLE public.conturi_tip,public.conturi_teren,public.conturi_tip_jurnal IN ACCESS EXCLUSIVE MODE;
DO $check$
DECLARE v_snapshot jsonb;
BEGIN
  SELECT jsonb_build_object(
    'tip',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY auth_user_id),'[]') FROM public.conturi_tip t),
    'teren',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY auth_user_id),'[]') FROM public.conturi_teren t),
    'jurnal',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.conturi_tip_jurnal t),
    'ddl',(SELECT coalesce(jsonb_agg(x.obj ORDER BY x.cheie COLLATE "C"),'[]') FROM (
      SELECT 'f:'||p.oid AS cheie,jsonb_build_array('functie',p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig) AS obj
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('fn_auth_token_hook','fn_teren_eligibil','fn_portal_porti_lipsa',
        'fn_portal_public_aprobat','fn_conturi_tip_audit','fn_conturi_jurnal_imuabil')
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
  IF v_snapshot IS DISTINCT FROM obj_description('public.conturi_tip'::regclass,'pg_class')::jsonb
    OR public.fn_portal_porti_lipsa() <> '{}'::text[] THEN
    RAISE EXCEPTION 'PORTAL_ROLLBACK_NEW_DATA_OR_CONFIG'; END IF;
END $check$;
DROP TABLE public.conturi_tip;
DROP TABLE public.conturi_teren;
DROP TABLE public.conturi_tip_jurnal;
DROP FUNCTION public.fn_auth_token_hook(jsonb);
DROP FUNCTION public.fn_teren_eligibil(uuid);
DROP FUNCTION public.fn_portal_porti_lipsa();
DROP FUNCTION public.fn_portal_public_aprobat();
DROP FUNCTION public.fn_conturi_tip_audit();
DROP FUNCTION public.fn_conturi_jurnal_imuabil();
REVOKE teren FROM authenticator;
REVOKE USAGE ON SCHEMA public FROM teren;
DROP ROLE teren;
-- Istoricul runnerului ramane intact: reaplicarea aceleiasi livrari este refuzata.
