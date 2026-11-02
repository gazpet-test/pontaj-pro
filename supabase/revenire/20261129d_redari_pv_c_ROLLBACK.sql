-- Runner supplies one transaction; no business data removed.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261129d',true) IS DISTINCT FROM 'REDARI_PV_C_SCOASA:'||txid_current() THEN RAISE EXCEPTION '20261129d: revenire neinarmata'; END IF;
  IF EXISTS(SELECT 1 FROM pg_db_role_setting s,unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261129d%') THEN RAISE EXCEPTION 'Armare persistenta'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.red_procese_verbale IN ACCESS EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM public.red_procese_verbale WHERE tip='C') THEN RAISE EXCEPTION 'Revenire refuzata: exista PV C, inclusiv anulate/sterse'; END IF;
END $pre$;
DROP TRIGGER red_pv_c_garda ON public.red_procese_verbale;
DROP FUNCTION public.fn_red_pv_c_garda();
DROP FUNCTION public.fn_red_pv_c_creeaza(uuid,integer);

CREATE OR REPLACE FUNCTION public.fn_red_pv_creeaza(p_tip text, p_parcela_id uuid, p_detinator_id uuid, p_tronson int)
RETURNS public.red_procese_verbale
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE p public.red_parcele; d public.red_detinatori; r public.red_procese_verbale; cod text;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(),'') NOT IN ('admin','editor') THEN
    RAISE EXCEPTION 'redari: creare PV doar admin/editor' USING ERRCODE='42501';
  END IF;
  IF p_tip = 'C' THEN RAISE EXCEPTION 'PV C - felia 4e'; END IF;
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
DO $post$
BEGIN
  IF to_regprocedure('public.fn_red_pv_c_creeaza(uuid,integer)') IS NOT NULL OR to_regprocedure('public.fn_red_pv_c_garda()') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.red_procese_verbale'::regclass AND tgname='red_pv_c_garda') THEN RAISE EXCEPTION 'Revenire incompleta'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE version='20261129120300';
  END IF;
END $post$;