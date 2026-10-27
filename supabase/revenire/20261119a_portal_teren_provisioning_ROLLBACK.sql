-- Revenire E1-1b: numai prin runner, refuz cu orice date/istoric/DDL noi.
DO $pre$
BEGIN
 IF current_user <> 'postgres' OR current_setting('gazpet.livrare_migrare',true)
  IS DISTINCT FROM '20261119a_portal_teren_provisioning_ROLLBACK:'||txid_current() THEN
  RAISE EXCEPTION 'PORTAL_ROLLBACK_RUNNER_REQUIRED'; END IF;
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'PORTAL_READ_COMMITTED_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
END $pre$;
SET LOCAL search_path = public, pg_temp;
LOCK TABLE auth.users IN SHARE MODE;
LOCK TABLE public.employees,public.profiles,public.user_module_access,public.portal_provisioning,
 public.conturi_tip,public.conturi_teren,public.conturi_tip_jurnal,public.portal_provisioning_jurnal,
 public.portal_e1_1b_manifest IN ACCESS EXCLUSIVE MODE;
DO $check$
BEGIN
 IF public.fn_portal_1b_snapshot() IS DISTINCT FROM
  (SELECT valoare FROM public.portal_e1_1b_manifest WHERE cheie='post_snapshot')
  OR public.fn_portal_porti_lipsa_1b() <> '{}'::text[] THEN
  RAISE EXCEPTION 'PORTAL_1B_ROLLBACK_NEW_DATA_OR_CONFIG'; END IF;
END $check$;
DO $restore$
DECLARE m jsonb; c jsonb; v_actual jsonb; p record; v_key text;
BEGIN
 FOREACH v_key IN ARRAY ARRAY['handle_live','eligibil_live'] LOOP
 SELECT valoare INTO STRICT m FROM public.portal_e1_1b_manifest WHERE cheie=v_key;
 IF encode(sha256(convert_to((m-'sha256')::text,'UTF8')),'hex') IS DISTINCT FROM m->>'sha256'
 THEN RAISE EXCEPTION 'PORTAL_HANDLE_MANIFEST_INVALID'; END IF;
 EXECUTE m->>'definition';
 -- CREATE OR REPLACE pastreaza owner/ACL exact; snapshot-ul a refuzat orice deriva.
 SELECT pr.*,pg_get_userbyid(pr.proowner) AS proprietar INTO STRICT p
  FROM pg_proc pr WHERE pr.oid=CASE WHEN v_key='handle_live' THEN 'public.handle_new_user()'::regprocedure ELSE 'public.fn_teren_eligibil(uuid)'::regprocedure END;
 v_actual:=jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proprietar,
  'acl',p.proacl::text,'proconfig',to_jsonb(p.proconfig));
 IF v_actual IS DISTINCT FROM m-'sha256' THEN RAISE EXCEPTION 'PORTAL_HANDLE_RESTORE_FAILED'; END IF;
 END LOOP;
 SELECT valoare INTO STRICT c FROM public.portal_e1_1b_manifest WHERE cheie='role_live';
 ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_chk;
 EXECUTE format('ALTER TABLE public.profiles ADD CONSTRAINT %I %s',c->>'name',c->>'definition');
END $restore$;
DROP TRIGGER portal_revoca_la_plecare ON public.employees;
DROP TRIGGER portal_conturi_teren_audit ON public.conturi_teren;
ALTER TABLE public.conturi_teren DROP COLUMN provisioning_id,DROP COLUMN creat_la,
 DROP COLUMN revocat_la,DROP COLUMN revocat_motiv;
DROP FUNCTION public.fn_portal_porti_lipsa_1b();
DROP FUNCTION public.fn_portal_1b_snapshot();
DROP FUNCTION public.fn_portal_cont_pregateste(integer,uuid);
DROP FUNCTION public.fn_portal_cont_finalizeaza(uuid);
DROP FUNCTION public.fn_cont_aproba_erp(uuid,text);
DROP FUNCTION public.fn_portal_revoca_la_plecare();
DROP TABLE public.portal_provisioning;
DROP TABLE public.portal_provisioning_jurnal;
DROP FUNCTION public.fn_portal_provisioning_audit();
DROP FUNCTION public.fn_portal_angajat_eligibil(integer);
DROP TABLE public.portal_e1_1b_manifest;
DO $post$
BEGIN
 IF to_regclass('public.portal_provisioning') IS NOT NULL
  OR to_regprocedure('public.fn_portal_cont_finalizeaza(uuid)') IS NOT NULL
  OR public.fn_portal_porti_lipsa() <> '{}'::text[] THEN RAISE EXCEPTION 'PORTAL_1B_ROLLBACK_POSTCONDITION'; END IF;
END $post$;
