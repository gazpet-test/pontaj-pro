-- GENERATED. Refuses any E4b facts; restores exact E4a body and all stamps.
DO $revenire$
DECLARE v_amprenta text; v_scrisa text; v_impl text[]; v_lipsa text[]; v_meta jsonb; v_t text; v_count bigint;
BEGIN
 IF current_user<>'postgres' OR current_setting('gazpet.revenire_20261109b',true)
  IS DISTINCT FROM 'IZO_E4B_SCOATE:'||txid_current() THEN RAISE EXCEPTION 'E4b revenire nearmata'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
 FOREACH v_t IN ARRAY @@TABLES@@ LOOP
  EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',v_t);
  EXECUTE format('SELECT count(*) FROM public.%I',v_t) INTO v_count;
  IF v_count<>0 THEN RAISE EXCEPTION 'E4b date existente: %; rollback refuzat',v_t; END IF;
 END LOOP;
 v_lipsa:=public.fn_izo_porti_lipsa(); IF cardinality(v_lipsa)>0 THEN RAISE EXCEPTION 'E4b porti %',v_lipsa; END IF;
 @@IMPL_POST@@
 v_meta:=obj_description('public.izo_rata_apeluri'::regclass,'pg_class')::jsonb;
 IF v_meta->>'amprenta' IS NULL THEN RAISE EXCEPTION 'E4b metadata lipsa'; END IF;
 @@PORTI_OLD@@
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_porti_lipsa()'::regprocedure) IS DISTINCT FROM @@OLD_MD5@@ THEN RAISE EXCEPTION 'E4b restore body differs'; END IF;
 DROP VIEW public.v_izo_carantina_sync,public.v_izo_rezervari_active;
 DROP FUNCTION public.fn_izo_porti_e4b_lipsa(),public.fn_izo_porti_e4b_definitii();
 -- Triggers depend on the immutable guard; remove them with the empty tables first.
 @@DROP_FUNCTIONS_BEFORE_TABLES@@
 @@DROP_TABLES@@
 DROP FUNCTION public.fn_izo_teren_imuabil();
 REVOKE ALL ON SCHEMA public FROM izo_teren_editor;
 DROP ROLE izo_teren_editor;
 @@IMPL_PRE@@
 EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L',v_meta->>'porti');
 EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L',v_meta->>'e3');
 EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L',v_meta->>'e3b');
 EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS %L',v_meta->>'e4');
 EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L',v_meta->>'evenimente');
 v_lipsa:=public.fn_izo_porti_lipsa(); IF cardinality(v_lipsa)>0 THEN RAISE EXCEPTION 'E4b restore gates %',v_lipsa; END IF;
 @@AMPRENTA@@
 IF v_amprenta IS DISTINCT FROM v_meta->>'amprenta' THEN RAISE EXCEPTION 'E4b restore fingerprint differs'; END IF;
END $revenire$;
