-- GENERATED. Refuses any E4b facts; restores exact E4a body and all stamps.
DO $revenire$
DECLARE v_amprenta text; v_scrisa text; v_impl text[]; v_lipsa text[]; v_meta jsonb; v_t text; v_count bigint;
BEGIN
 IF current_user<>'postgres' OR current_setting('gazpet.revenire_20261109b',true)
  IS DISTINCT FROM 'IZO_E4B_SCOATE:'||txid_current() THEN RAISE EXCEPTION 'E4b revenire nearmata'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
 LOCK TABLE public.magazie_bucati_evenimente IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.magazie_bucati_evenimente WHERE document_tip IN ('izo_declaratie','izo_iesire','izo_primire')) THEN
  RAISE EXCEPTION 'E4b date existente: fapte registru; rollback refuzat'; END IF;
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
 @@GUARD_OLD@@
 @@FLUX_OLD@@
 @@E4_GATE_OLD@@
 @@DEPOT_OLD@@
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_depozit_in_registru(integer)'::regprocedure) IS DISTINCT FROM @@DEPOT_MD5@@ THEN RAISE EXCEPTION 'E4b depot restore differs'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_porti_e4_lipsa()'::regprocedure) IS DISTINCT FROM @@E4_GATE_MD5@@ THEN RAISE EXCEPTION 'E4b E4 gate restore differs'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_flux_admin(bigint,boolean,text)'::regprocedure) IS DISTINCT FROM @@FLUX_MD5@@ THEN RAISE EXCEPTION 'E4b flux restore differs'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_garda_montaj(text,text,jsonb,jsonb)'::regprocedure) IS DISTINCT FROM @@GUARD_MD5@@ THEN RAISE EXCEPTION 'E4b guard restore differs'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_porti_lipsa()'::regprocedure) IS DISTINCT FROM @@OLD_MD5@@ THEN RAISE EXCEPTION 'E4b restore body differs'; END IF;
 DROP VIEW public.v_izo_carantina_sync,public.v_izo_rezervari_active;
 DROP FUNCTION public.fn_izo_porti_e4b_lipsa(),public.fn_izo_porti_e4b_definitii();
 -- Triggers depend on the immutable guard; remove them with the empty tables first.
 @@DROP_FUNCTIONS_BEFORE_TABLES@@
 DROP INDEX public.ux_magbuc_ev_decl;
 DROP POLICY magbuc_izo_montaj_ins ON public.magazie_bucati;
 @@CUT_REVOKE@@
 REVOKE USAGE ON SEQUENCE public.magazie_bucati_id_seq FROM izo_montaj_writer;
 REVOKE EXECUTE ON FUNCTION public.fn_izo_uid() FROM izo_montaj_writer;
 REVOKE UPDATE(stare,locatie_tip,depozit_id,tronson_id,atribute) ON public.magazie_bucati FROM izo_montaj_writer;
 REVOKE ALL ON public.magazie_bucati_evenimente,public.magazie_bucati_miscari FROM izo_montaj_writer;
 REVOKE ALL ON SEQUENCE public.magazie_bucati_evenimente_id_seq,public.magazie_bucati_miscari_id_seq FROM izo_montaj_writer;
 DROP POLICY izo_montaj_evenimente_sel ON public.magazie_bucati_evenimente;
 DROP POLICY izo_montaj_evenimente_ins ON public.magazie_bucati_evenimente;
 DROP POLICY izo_montaj_miscari_sel ON public.magazie_bucati_miscari;
 DROP POLICY izo_montaj_miscari_ins ON public.magazie_bucati_miscari;
 @@DROP_TABLES@@
 DROP FUNCTION public.fn_izo_teren_imuabil(),public.fn_izo_decl_ceas();
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
