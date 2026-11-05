-- Runner MUST supply ONE transaction. Never drop a snapshot or its history.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true)
    IS DISTINCT FROM '20261130n_redari_pv_utilizatori_ROLLBACK:'||txid_current() THEN RAISE EXCEPTION 'PR1 rollback: garda start invalida'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.red_procese_verbale, public.red_parcele, public.red_detinatori, public.red_v_tronson IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.red_jurnal IN SHARE MODE;
  IF EXISTS (SELECT 1 FROM (VALUES
    ('public.fn_red_parcela_acoperita_a(uuid)','b932aaf307761d3c504608a30c117bca'),
    ('public.fn_red_pv_calitate_semnatar()','c47235d62aedbf6b3efccba60702b95b'),
    ('public.fn_red_pv_creeaza(text,uuid,uuid,integer)','290f8f0c3ba78d8499db7ef50d0d8bcd'),
    ('public.fn_red_pv_b_semnare()','728fc279beee0b34f9adcfb425b2dd9f')
  ) b(sig,corp) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(b.sig)
    WHERE p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM b.corp OR pg_get_userbyid(p.proowner)<>'postgres'
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']) THEN
    RAISE EXCEPTION 'PR1: corp/metadate functie noua diferite'; END IF;
  PERFORM set_config('gazpet.pr1_revenire_view', (SELECT jsonb_build_array(relowner,relacl)::text FROM pg_class WHERE oid='public.red_v_tronson'::regclass),true);
  IF EXISTS (SELECT 1 FROM public.red_procese_verbale WHERE calitate_semnatar IS NOT NULL OR calitate_document IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela='red_procese_verbale'
      AND (date_vechi ? 'calitate_semnatar' OR date_noi ? 'calitate_semnatar' OR date_vechi ? 'calitate_document' OR date_noi ? 'calitate_document')) THEN
    RAISE EXCEPTION 'PR1 rollback: exista snapshot-uri sau istoric nou; revenire refuzata'; END IF;
END $pre$;
CREATE OR REPLACE VIEW public.red_v_tronson WITH (security_invoker = on) AS
SELECT p.proiect_id, p.tronson, p.uat_id, u.uat3, p.id AS parcela_id, p.id_parcela, p.suprafata_temporara_mp, p.articol_deviz, p.cantitate,
       CASE WHEN EXISTS (SELECT 1 FROM public.red_detinatori d WHERE d.parcela_id = p.id AND d.sters_la IS NULL)
             AND NOT EXISTS (
               SELECT 1 FROM public.red_detinatori d WHERE d.parcela_id = p.id AND d.sters_la IS NULL
                 AND NOT EXISTS (SELECT 1 FROM public.red_procese_verbale pa
                   WHERE pa.parcela_id = p.id AND pa.detinator_id = d.id
                     AND pa.tip = 'A' AND pa.stare = 'semnat' AND pa.sters_la IS NULL)) THEN 'A'
            WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.stare <> 'anulat' AND pb.sters_la IS NULL) THEN 'B'
       END AS tip_pv,
       (EXISTS (SELECT 1 FROM public.red_v_stare_parcela s WHERE s.parcela_id = p.id AND s.stare = 'OBIECTII_DE_TRATAT')
        OR EXISTS (SELECT 1 FROM public.red_procese_verbale px WHERE px.parcela_id = p.id AND px.sters_la IS NULL AND px.stare <> 'anulat'
                      AND px.obiectii_redare AND px.remediat_la IS NULL)) AS obiectii_deschise
  FROM public.red_parcele p
  JOIN public.red_uat u ON u.id = p.uat_id
 WHERE p.sters_la IS NULL;
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
  -- 20261129f (Copilot f7 r1 P2-01): PV B doar daca parcela are cel putin un detinator activ FARA PV A semnat
  -- (sau niciun detinator activ). Parcela e blocata FOR UPDATE mai sus.
  IF p_tip='B' AND EXISTS (SELECT 1 FROM public.red_detinatori x WHERE x.parcela_id=p.id AND x.sters_la IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.red_detinatori x WHERE x.parcela_id=p.id AND x.sters_la IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.red_procese_verbale a WHERE a.parcela_id=p.id AND a.detinator_id=x.id
         AND a.tip='A' AND a.stare='semnat' AND a.sters_la IS NULL)) THEN
    RAISE EXCEPTION 'redari: toti detinatorii activi au PV A semnat; PV B nu este necesar' USING ERRCODE='P0001';
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

CREATE OR REPLACE FUNCTION public.fn_red_pv_b_semnare() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $g$
BEGIN
  -- 20261129f (Copilot f7 r1 P2-02): un PV B nu se mai semneaza daca intre timp TOTI detinatorii activi au PV A semnat;
  -- se anuleaza (motiv). Parcela fara detinatori activi ramane semnabila prin PV B.
  -- Copilot f7 r2 P2: semnarile PV A / PV B pe aceeasi parcela se serializeaza pe randul parcelei (acelasi lock ca
  -- fn_red_pv_creeaza), apoi verificarea vede tot ce s-a comis inainte (READ COMMITTED: snapshot nou pe instructiune).
  IF NEW.tip IN ('A','B') AND NEW.stare='semnat' AND OLD.stare IS DISTINCT FROM 'semnat' AND NEW.parcela_id IS NOT NULL THEN
    PERFORM 1 FROM public.red_parcele WHERE id=NEW.parcela_id FOR UPDATE;
    -- Copilot f7 r3 P3: fara lock nu continuam (de ex. parcela invizibila sub RLS)
    IF NOT FOUND THEN RAISE EXCEPTION 'PV: parcela indisponibila pentru blocare' USING ERRCODE='42501'; END IF;
  END IF;
  IF NEW.tip='B' AND NEW.stare='semnat' AND OLD.stare IS DISTINCT FROM 'semnat'
     AND EXISTS (SELECT 1 FROM public.red_detinatori x WHERE x.parcela_id=NEW.parcela_id AND x.sters_la IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.red_detinatori x WHERE x.parcela_id=NEW.parcela_id AND x.sters_la IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.red_procese_verbale a WHERE a.parcela_id=NEW.parcela_id AND a.detinator_id=x.id
         AND a.tip='A' AND a.stare='semnat' AND a.sters_la IS NULL)) THEN
    RAISE EXCEPTION 'PV B nu se mai poate semna: toti detinatorii activi au PV A semnat; anuleaza PV B' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $g$;
DROP TRIGGER red_pv_b_semnare ON public.red_procese_verbale;
CREATE TRIGGER red_pv_b_semnare BEFORE UPDATE OF stare ON public.red_procese_verbale
FOR EACH ROW EXECUTE FUNCTION public.fn_red_pv_b_semnare();
DROP TRIGGER red_pv_aa_calitate ON public.red_procese_verbale;
DROP FUNCTION public.fn_red_pv_calitate_semnatar();
DROP FUNCTION public.fn_red_parcela_acoperita_a(uuid);
ALTER TABLE public.red_procese_verbale DROP COLUMN calitate_document, DROP COLUMN calitate_semnatar;
DO $post$
BEGIN
  IF (SELECT jsonb_build_array(relowner,relacl)::text FROM pg_class WHERE oid='public.red_v_tronson'::regclass)
    IS DISTINCT FROM current_setting('gazpet.pr1_revenire_view',true) THEN RAISE EXCEPTION 'PR1 rollback: ACL vedere schimbat'; END IF;
  IF to_regprocedure('public.fn_red_parcela_acoperita_a(uuid)') IS NOT NULL
    OR to_regprocedure('public.fn_red_pv_calitate_semnatar()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.red_procese_verbale'::regclass AND attname IN ('calitate_semnatar','calitate_document') AND NOT attisdropped)
    OR NOT coalesce((SELECT 'security_invoker=on'=ANY(reloptions) FROM pg_class WHERE oid='public.red_v_tronson'::regclass),false) THEN
    RAISE EXCEPTION 'PR1 rollback incomplet'; END IF;
END $post$;
