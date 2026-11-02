-- Version 20261129120300. Runner MUST supply one transaction (apply + post).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129d_redari_pv_c:'||txid_current() THEN RAISE EXCEPTION '20261129d: garda start invalida'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.red_procese_verbale IN ACCESS EXCLUSIVE MODE;
  IF to_regprocedure('public.fn_red_pv_c_creeaza(uuid,integer)') IS NOT NULL THEN RAISE EXCEPTION '20261129d: functia exista'; END IF;
  PERFORM set_config('gazpet.r29d_acl',(SELECT coalesce(proacl::text,'NULL') FROM pg_proc WHERE oid='public.fn_red_pv_creeaza(text,uuid,uuid,integer)'::regprocedure),true);
  PERFORM set_config('gazpet.r29d_policies',(SELECT md5(coalesce(string_agg(policyname || '|' || permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' ORDER BY policyname),'')) FROM pg_policies WHERE schemaname='public' AND tablename='red_procese_verbale'),true);
END $pre$;
CREATE FUNCTION public.fn_red_pv_c_creeaza(p_proiect_id uuid,p_tronson int)
RETURNS public.red_procese_verbale LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE ancora uuid; lipsa bigint; r public.red_procese_verbale;
BEGIN
  -- Order: advisory project/tronson -> counter -> INSERT/FK locks. No child row locks.
  PERFORM pg_advisory_xact_lock(hashtextextended('red_pv_c|'||p_proiect_id::text||'|'||p_tronson::text,0));
  IF auth.uid() IS NULL OR public.fn_red_nivel() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'redari: PV C doar admin' USING ERRCODE='42501'; END IF;
  IF p_proiect_id IS NULL OR p_tronson IS NULL OR p_tronson NOT BETWEEN 1 AND 11 THEN RAISE EXCEPTION 'redari: proiect/tronson invalid' USING ERRCODE='22023'; END IF;
  -- Copilot f4d r1 P2-01: eligibilitatea (parcelele tronsonului + acoperirea A/B) ramane stabila pana la COMMIT.
  -- SHARE pe parcele blocheaza INSERT/UPDATE concurente pe parcele; SHARE ROW EXCLUSIVE pe PV blocheaza
  -- anularea/crearea concurenta de PV si serializeaza crearile PV C (actiune rara de admin; lock_timeout 5s).
  -- Ordine (Copilot f4d r3 P3): advisory -> red_procese_verbale -> red_parcele -> contor, aceeasi ca la semnare
  -- (unde UPDATE-ul detine deja PV), deci fara ciclu creare/semnare; fn_red_pv_creeaza: parcela (ROW SHARE) apoi PV.
  LOCK TABLE public.red_procese_verbale IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_parcele IN SHARE MODE;
  -- PV C is per tronson; uat_id is only the anchor required by the schema.
  SELECT u.id INTO ancora FROM public.red_parcele p JOIN public.red_uat u ON u.id=p.uat_id AND u.proiect_id=p.proiect_id
    WHERE p.proiect_id=p_proiect_id AND p.tronson=p_tronson AND p.sters_la IS NULL
    GROUP BY u.id,u.uat3 ORDER BY count(*) DESC,u.uat3 ASC LIMIT 1;
  IF ancora IS NULL THEN RAISE EXCEPTION 'Tronsonul nu are parcele active' USING ERRCODE='P0002'; END IF;
  IF EXISTS(SELECT 1 FROM public.red_procese_verbale v JOIN public.red_uat u ON u.id=v.uat_id
    WHERE u.proiect_id=p_proiect_id AND v.tronson=p_tronson AND v.tip='C' AND v.stare<>'anulat' AND v.sters_la IS NULL)
    THEN RAISE EXCEPTION 'Exista deja un PV C activ pe tronson in proiect' USING ERRCODE='P0001'; END IF;
  SELECT count(*) INTO lipsa FROM public.red_v_tronson WHERE proiect_id=p_proiect_id AND tronson=p_tronson AND tip_pv IS NULL;
  IF lipsa>0 THEN RAISE EXCEPTION 'Tronsonul are parcele fara PV A semnat sau PV B: %',lipsa USING ERRCODE='P0001'; END IF;
  INSERT INTO public.red_procese_verbale(tip,tronson,uat_id,nr_pv,data_pv,stare)
    VALUES('C',p_tronson,ancora,public.fn_red_numar_document('PVC',NULL,p_tronson),(now() AT TIME ZONE 'Europe/Bucharest')::date,'generat') RETURNING * INTO r;
  RETURN r;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_pv_c_creeaza(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_red_pv_c_creeaza(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_red_pv_creeaza(p_tip text, p_parcela_id uuid, p_detinator_id uuid, p_tronson int)
RETURNS public.red_procese_verbale
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE p public.red_parcele; d public.red_detinatori; r public.red_procese_verbale; cod text;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(),'') NOT IN ('admin','editor') THEN
    RAISE EXCEPTION 'redari: creare PV doar admin/editor' USING ERRCODE='42501';
  END IF;
  IF p_tip = 'C' THEN RAISE EXCEPTION 'PV C: foloseste fn_red_pv_c_creeaza'; END IF;
  IF p_tip IS NULL OR p_tip NOT IN ('A','B') THEN RAISE EXCEPTION 'redari: tip PV invalid'; END IF;
  -- Lock order: parcela -> detinator (A) -> counter in fn_red_numar_document.
  SELECT * INTO p FROM public.red_parcele WHERE id=p_parcela_id FOR UPDATE;
  IF NOT FOUND OR p.sters_la IS NOT NULL THEN RAISE EXCEPTION 'redari: parcela inexistenta sau stearsa' USING ERRCODE='P0002'; END IF;
  IF p_tip='A' THEN
    SELECT * INTO d FROM public.red_detinatori WHERE id=p_detinator_id FOR UPDATE;
    IF NOT FOUND OR d.sters_la IS NOT NULL OR d.parcela_id IS DISTINCT FROM p.id THEN
      RAISE EXCEPTION 'redari: detinator inactiv sau de pe alta parcela' USING ERRCODE='23503';
    END IF;
  ELSIF p_detinator_id IS NOT NULL THEN
    RAISE EXCEPTION 'redari: PV B nu are detinator' USING ERRCODE='23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_procese_verbale v WHERE v.tip=p_tip AND v.stare<>'anulat' AND v.sters_la IS NULL
    AND ((p_tip='A' AND v.detinator_id=p_detinator_id) OR (p_tip='B' AND v.parcela_id=p.id))) THEN
    RAISE EXCEPTION 'redari: exista deja un PV % activ; reincarca si deschide PV-ul existent',p_tip;
  END IF;
  SELECT u.uat3 INTO cod FROM public.red_uat u WHERE u.id=p.uat_id AND u.proiect_id=p.proiect_id;
  IF cod IS NULL THEN RAISE EXCEPTION 'redari: UAT incompatibil cu parcela' USING ERRCODE='23503'; END IF;
  INSERT INTO public.red_procese_verbale(tip,parcela_id,detinator_id,uat_id,tronson,nr_pv,data_pv,stare)
  VALUES(p_tip,p.id,CASE WHEN p_tip='A' THEN d.id END,p.uat_id,p.tronson,
    public.fn_red_numar_document('PV'||p_tip,cod,NULL),(now() AT TIME ZONE 'Europe/Bucharest')::date,'generat')
  RETURNING * INTO r;
  RETURN r;
END $fn$;
-- Copilot f4d r2 P2: semnarea PV C reverifica eligibilitatea sub ACELEASI lock-uri ca la creare.
-- Apelata din garda (SECURITY INVOKER, admin); ea insasi SECURITY DEFINER ca sa poata lua LOCK TABLE.
-- Doar admin (altfel oricine autentificat ar putea bloca tabelele). Tranzactia semnarii detine deja
-- ROW EXCLUSIVE pe PV; doua semnari PV C simultane pot da deadlock detectat (una esueaza, se reia).
CREATE FUNCTION public.fn_red_pv_c_neacoperite(p_uat_id uuid, p_tronson int) RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '5s' AS $n$
BEGIN
  IF auth.uid() IS NULL OR public.fn_red_nivel() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'redari: PV C doar admin' USING ERRCODE='42501'; END IF;
  LOCK TABLE public.red_procese_verbale IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_parcele IN SHARE MODE;
  RETURN (SELECT count(*) FROM public.red_v_tronson t JOIN public.red_uat u ON u.proiect_id=t.proiect_id
    WHERE u.id=p_uat_id AND t.tronson=p_tronson AND t.tip_pv IS NULL);
END $n$;
REVOKE EXECUTE ON FUNCTION public.fn_red_pv_c_neacoperite(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_red_pv_c_neacoperite(uuid,integer) TO authenticated;

-- Keep existing policies unchanged, but close direct PostgREST write bypasses.
CREATE FUNCTION public.fn_red_pv_c_garda() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $g$
BEGIN
  IF NEW.tip='C' THEN
    IF auth.uid() IS NULL OR public.fn_red_nivel() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'redari: PV C doar admin' USING ERRCODE='42501'; END IF;
    IF TG_OP='UPDATE' THEN
      IF NEW.sters_la IS DISTINCT FROM OLD.sters_la THEN RAISE EXCEPTION 'PV C: foloseste anularea, nu stergerea/reactivarea' USING ERRCODE='23514'; END IF;
      -- Gemini f4d r1 P2: la semnare eligibilitatea tronsonului se reverifica (parcele noi / PV B anulat dupa creare).
      IF NEW.stare='semnat' AND OLD.stare IS DISTINCT FROM 'semnat' AND public.fn_red_pv_c_neacoperite(NEW.uat_id,NEW.tronson) > 0 THEN
        RAISE EXCEPTION 'PV C: tronsonul are din nou parcele fara PV A semnat sau PV B; nu se poate semna' USING ERRCODE='23514';
      END IF;
    END IF;
    -- RPC executes as postgres; authenticated INSERT must use the RPC with its lock/checks.
    IF TG_OP='INSERT' AND current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'PV C: foloseste fn_red_pv_c_creeaza' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $g$;
REVOKE EXECUTE ON FUNCTION public.fn_red_pv_c_garda() FROM PUBLIC, anon;
CREATE TRIGGER red_pv_c_garda BEFORE INSERT OR UPDATE ON public.red_procese_verbale FOR EACH ROW EXECUTE FUNCTION public.fn_red_pv_c_garda();

DO $post$
BEGIN
  IF (SELECT md5(coalesce(string_agg(policyname || '|' || permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' ORDER BY policyname),'')) FROM pg_policies WHERE schemaname='public' AND tablename='red_procese_verbale') IS DISTINCT FROM current_setting('gazpet.r29d_policies',true) THEN RAISE EXCEPTION '20261129d: politici schimbate'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.red_procese_verbale'::regclass AND tgname='red_pv_c_garda' AND tgenabled='O' AND tgtype=23 AND tgfoid='public.fn_red_pv_c_garda()'::regprocedure)
    OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.fn_red_pv_c_garda()'::regprocedure AND NOT prosecdef AND 'search_path=public, pg_temp'=ANY(proconfig)) THEN RAISE EXCEPTION '20261129d: garda C lipsa/invalida'; END IF;
  IF (SELECT coalesce(proacl::text,'NULL') FROM pg_proc WHERE oid='public.fn_red_pv_creeaza(text,uuid,uuid,integer)'::regprocedure) IS DISTINCT FROM current_setting('gazpet.r29d_acl',true) THEN RAISE EXCEPTION '20261129d: ACL vechi schimbat'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.fn_red_pv_c_neacoperite(uuid,integer)'::regprocedure AND prosecdef AND 'search_path=public, pg_temp'=ANY(proconfig) AND 'lock_timeout=5s'=ANY(proconfig))
    OR has_function_privilege('anon','public.fn_red_pv_c_neacoperite(uuid,integer)','EXECUTE') THEN RAISE EXCEPTION '20261129d: neacoperite incorecta'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.fn_red_pv_c_creeaza(uuid,integer)'::regprocedure AND prosecdef AND 'search_path=public, pg_temp'=ANY(proconfig) AND 'lock_timeout=5s'=ANY(proconfig) AND prorettype='public.red_procese_verbale'::regtype)
    OR has_function_privilege('anon','public.fn_red_pv_c_creeaza(uuid,integer)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.fn_red_pv_c_creeaza(uuid,integer)','EXECUTE')
    OR EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.fn_red_pv_c_creeaza(uuid,integer)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE')
    THEN RAISE EXCEPTION '20261129d: functie/drepturi incorecte'; END IF;
END $post$;