-- E4b-2. API wrappers are deliberately thin; all helpers are private.
CREATE FUNCTION public.fn_izo_autor_valabil(p_autor uuid,p_proiect bigint,p_lock boolean) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_owner boolean; v_emp bigint;
BEGIN
 IF p_lock THEN
  SELECT is_owner,employee_id INTO v_owner,v_emp FROM public.profiles WHERE id=p_autor FOR SHARE;
 ELSE SELECT is_owner,employee_id INTO v_owner,v_emp FROM public.profiles WHERE id=p_autor; END IF;
 IF v_emp IS NULL THEN RETURN false; END IF;
 IF v_owner THEN RETURN true; END IF;
 IF p_lock THEN
  PERFORM 1 FROM public.user_module_access WHERE profile_id=p_autor AND module='executie.izometrie'
   AND access_level IN ('editor','admin') ORDER BY id FOR SHARE;
 ELSE
  PERFORM 1 FROM public.user_module_access WHERE profile_id=p_autor AND module='executie.izometrie' AND access_level IN ('editor','admin');
 END IF;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_lock THEN
  PERFORM 1 FROM public.izo_atribuiri WHERE profile_id=p_autor AND proiect_id=p_proiect AND rol='inginer_izometrie'
   AND activ AND current_date BETWEEN valabil_de AND coalesce(valabil_pana,current_date) ORDER BY id FOR SHARE;
 ELSE
  PERFORM 1 FROM public.izo_atribuiri WHERE profile_id=p_autor AND proiect_id=p_proiect AND rol='inginer_izometrie'
   AND activ AND current_date BETWEEN valabil_de AND coalesce(valabil_pana,current_date);
 END IF;
 RETURN FOUND;
END $f$;

CREATE FUNCTION public.fn_izo_birou_autorizat(p_proiect bigint,p_depozit integer,p_lock boolean) RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_emp bigint; v_owner boolean; v_uid uuid:=public.fn_izo_uid();
BEGIN
 IF p_lock THEN
  SELECT employee_id,is_owner INTO v_emp,v_owner FROM public.profiles WHERE id=v_uid FOR SHARE;
 ELSE SELECT employee_id,is_owner INTO v_emp,v_owner FROM public.profiles WHERE id=v_uid; END IF;
 IF v_emp IS NULL THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
 IF v_owner THEN RETURN v_emp; END IF;
 -- Reuse the deployed access contract; no access/module data is introduced here.
 IF p_depozit IS NULL THEN
  IF NOT (public.fn_izo_acces(p_proiect,'executie.izometrie','editor','manager_aprobator')
    OR public.fn_izo_acces(p_proiect,'executie.izometrie','editor','inlocuitor_aprobator')) THEN
   RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT public.fn_izo_acces(p_proiect,'magazie','editor','gestionar') THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_lock THEN
  PERFORM 1 FROM public.user_module_access WHERE profile_id=v_uid
   AND module=(CASE WHEN p_depozit IS NULL THEN 'executie.izometrie' ELSE 'magazie' END)
   AND access_level IN ('editor','admin') ORDER BY id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_lock THEN
  PERFORM 1 FROM public.izo_atribuiri WHERE profile_id=v_uid AND proiect_id=p_proiect AND activ
   AND current_date BETWEEN valabil_de AND coalesce(valabil_pana,current_date)
   AND ((p_depozit IS NULL AND rol IN ('manager_aprobator','inlocuitor_aprobator') AND depozit_id IS NULL)
     OR (p_depozit IS NOT NULL AND rol='gestionar' AND depozit_id=p_depozit)) ORDER BY id FOR SHARE;
 ELSE
  PERFORM 1 FROM public.izo_atribuiri WHERE profile_id=v_uid AND proiect_id=p_proiect AND activ
   AND current_date BETWEEN valabil_de AND coalesce(valabil_pana,current_date)
   AND ((p_depozit IS NULL AND rol IN ('manager_aprobator','inlocuitor_aprobator') AND depozit_id IS NULL)
     OR (p_depozit IS NOT NULL AND rol='gestionar' AND depozit_id=p_depozit));
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
 RETURN v_emp;
END $f$;

CREATE FUNCTION public.fn_izo_birou_intrare(p_proiect bigint,p_depozit integer) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_lipsa text[];
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
 IF session_user<>'authenticator' OR public.fn_izo_jwt_rol() IS DISTINCT FROM 'authenticated' OR public.fn_izo_uid() IS NULL THEN
  RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
 IF coalesce(current_setting('izo.montaj_ctx',true),'')<>'' OR coalesce(current_setting('izo.receptie_ctx',true),'')<>''
  OR coalesce(current_setting('izo.registru_tx',true),'')<>'' THEN RAISE EXCEPTION 'context_ocupat' USING ERRCODE='42501'; END IF;
 PERFORM public.fn_izo_birou_autorizat(p_proiect,p_depozit,false);
 v_lipsa:=public.fn_izo_porti_lipsa();
 IF cardinality(v_lipsa)>0 THEN RAISE EXCEPTION 'E4b porti %',v_lipsa; END IF;
END $f$;

-- Runs AS the existing E4 registry writer, never as postgres. Typed snapshots and
-- exact event/movement images are checked by the existing registry guards.
CREATE FUNCTION public.fn_izo_birou_fapt(p_bucata bigint,p_op text,p_ref text,p_tronson bigint,p_depozit integer,
 p_autor uuid,p_dispozitiv text,p_ora timestamptz,p_motiv text) RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_b public.magazie_bucati; v_dupa public.magazie_bucati; v_ev public.magazie_bucati_evenimente;
 v_m public.magazie_bucati_miscari; v_ctx text; v_n bigint; v_now timestamptz:=clock_timestamp();
BEGIN
 IF current_user<>'izo_montaj_writer' OR p_op IS NULL OR p_op NOT IN ('aproba','iesire') THEN RAISE EXCEPTION 'scriitor_invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT v_b FROM public.magazie_bucati WHERE id=p_bucata FOR UPDATE;
 v_dupa:=v_b; v_dupa.updated_at:=v_now; v_dupa.server_ver:=nextval('public.izo_server_ver_seq');
 IF p_op='aproba' THEN
  IF v_b.stare<>'pe_tronson' OR v_b.tronson_id IS DISTINCT FROM p_tronson THEN RAISE EXCEPTION 'stare'; END IF;
  v_dupa.stare:='montata';
 ELSE
  IF v_b.stare NOT IN ('sosit','receptionat','retur') OR v_b.depozit_id IS DISTINCT FROM p_depozit THEN RAISE EXCEPTION 'stare'; END IF;
  v_dupa.stare:='pe_tronson'; v_dupa.locatie_tip:='tronson'; v_dupa.tronson_id:=p_tronson; v_dupa.depozit_id:=NULL;
  v_dupa.atribute:=coalesce(v_b.atribute,'{}'::jsonb)||jsonb_build_object('depozit_origine_id',p_depozit);
 END IF;
 v_ctx:=concat_ws('|',txid_current()::text,p_op,p_ref,v_b.proiect_id,p_tronson,v_dupa.server_ver,v_b.id);
 PERFORM public.fn_izo_montaj_marcheaza(v_ctx,to_jsonb(v_b),to_jsonb(v_dupa),NULL);
 UPDATE public.magazie_bucati SET stare=v_dupa.stare,locatie_tip=v_dupa.locatie_tip,depozit_id=v_dupa.depozit_id,
  tronson_id=v_dupa.tronson_id,atribute=v_dupa.atribute,server_ver=v_dupa.server_ver,updated_at=v_now WHERE id=v_b.id;
 GET DIAGNOSTICS v_n=ROW_COUNT;
 IF v_n<>1 THEN RAISE EXCEPTION 'bucata_schimbata'; END IF;
 IF to_jsonb(v_dupa) IS DISTINCT FROM (SELECT to_jsonb(b) FROM public.magazie_bucati b WHERE b.id=v_b.id) THEN RAISE EXCEPTION 'reconciliere_bucata'; END IF;
 v_ev:=jsonb_populate_record(NULL::public.magazie_bucati_evenimente,jsonb_build_object(
  'tip',CASE WHEN p_op='aproba' THEN 'montaj' ELSE 'livrare' END,'proiect_id',v_b.proiect_id,
  'document_tip',CASE WHEN p_op='aproba' THEN 'izo_declaratie' ELSE 'izo_iesire' END,'document_id',p_ref,
  'motiv',p_motiv,'declarat_de',p_autor,'aplicat_de',public.fn_izo_uid(),'aplicat_rol','izo_montaj_writer',
  'ora_server',v_now,'ora_tableta',p_ora,'dispozitiv_id',p_dispozitiv,'server_ver',nextval('public.izo_server_ver_seq')));
 PERFORM public.fn_izo_montaj_marcheaza(v_ctx,NULL,NULL,jsonb_build_object('tabel','magazie_bucati_evenimente','rand',to_jsonb(v_ev)-'id'));
 INSERT INTO public.magazie_bucati_evenimente(tip,proiect_id,document_tip,document_id,import_id,storno_de_eveniment_id,motiv,
  declarat_de,aplicat_de,aplicat_rol,ora_server,ora_tableta,dispozitiv_id,server_ver)
 VALUES(v_ev.tip,v_ev.proiect_id,v_ev.document_tip,v_ev.document_id,v_ev.import_id,v_ev.storno_de_eveniment_id,v_ev.motiv,
  v_ev.declarat_de,v_ev.aplicat_de,v_ev.aplicat_rol,v_ev.ora_server,v_ev.ora_tableta,v_ev.dispozitiv_id,v_ev.server_ver) RETURNING id INTO v_ev.id;
 v_m:=jsonb_populate_record(NULL::public.magazie_bucati_miscari,jsonb_build_object('eveniment_id',v_ev.id,'proiect_id',v_b.proiect_id,
  'bucata_id',v_b.id,'rol',CASE WHEN p_op='aproba' THEN 'montat' ELSE 'mutat' END,'stare_inainte',v_b.stare,'stare_dupa',v_dupa.stare,
  'din_loc',jsonb_build_object('depozit_id',v_b.depozit_id,'tronson_id',v_b.tronson_id),
  'in_loc',jsonb_build_object('depozit_id',v_dupa.depozit_id,'tronson_id',v_dupa.tronson_id),
  'lungime_mm',v_b.lungime_mm,'inainte',to_jsonb(v_b),'dupa',to_jsonb(v_dupa),'server_ver',nextval('public.izo_server_ver_seq')));
 PERFORM public.fn_izo_montaj_marcheaza(v_ctx,NULL,NULL,jsonb_build_object('tabel','magazie_bucati_miscari','rand',to_jsonb(v_m)-'id'));
 INSERT INTO public.magazie_bucati_miscari(eveniment_id,proiect_id,bucata_id,rol,stare_inainte,stare_dupa,din_loc,in_loc,lungime_mm,inainte,dupa,server_ver)
 VALUES(v_m.eveniment_id,v_m.proiect_id,v_m.bucata_id,v_m.rol,v_m.stare_inainte,v_m.stare_dupa,v_m.din_loc,v_m.in_loc,
  v_m.lungime_mm,v_m.inainte,v_m.dupa,v_m.server_ver);
 PERFORM public.fn_izo_montaj_marcheaza(NULL,NULL,NULL,NULL);
 RETURN v_ev.id;
END $f$;

CREATE FUNCTION public.fn_izo_birou_preview(p_preverificare bigint) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT jsonb_build_object('preverificare',to_jsonb(s),'randuri',coalesce((
  SELECT jsonb_agg(jsonb_build_object('declaratie',to_jsonb(d),'rezervari',(
   SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.izo_rezervari r WHERE r.declaratie_id=d.id),
   'bucata',(SELECT to_jsonb(b)||jsonb_build_object('radacina',(SELECT to_jsonb(root) FROM public.magazie_bucati root WHERE root.id=coalesce(b.radacina_id,b.id)),
     'fara_pv',public.fn_izo_pv_lipsa(ARRAY[coalesce(b.radacina_id,b.id)])) FROM public.magazie_bucati b WHERE b.id=d.bucata_id),
   'copii',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.uid),'[]') FROM public.izo_bucati_declarate c WHERE c.declaratie_id=d.id)) ORDER BY d.id)
  FROM public.izo_declaratii d WHERE d.preverificare_id=s.id),'[]'),
  'config',(SELECT to_jsonb(c) FROM public.izo_tronson_config c WHERE c.tronson_id=s.tronson_id),
  'proiect_config',(SELECT to_jsonb(c) FROM public.izo_proiect_config c WHERE c.proiect_id=s.proiect_id),
  'proiect',(SELECT to_jsonb(p) FROM public.executie_proiecte p WHERE p.id=s.proiect_id),
  'tronson',(SELECT to_jsonb(t) FROM public.executie_tronsoane t WHERE t.id=s.tronson_id))
 FROM public.izo_preverificari s WHERE s.id=p_preverificare
$f$;

CREATE FUNCTION public.fn_izo_aprobare_intern(p_preverificare bigint) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_pr bigint; v_doc jsonb;
BEGIN
 -- API/isolation/schema precede the first table read.
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
 SELECT proiect_id INTO v_pr FROM public.izo_preverificari WHERE id=p_preverificare;
 PERFORM public.fn_izo_birou_intrare(v_pr,NULL);
 v_doc:=public.fn_izo_birou_preview(p_preverificare);
 IF v_doc IS NULL THEN RAISE EXCEPTION 'sesiune_lipsa'; END IF;
 RETURN v_doc||jsonb_build_object('amprenta',encode(sha256(convert_to(v_doc::text,'UTF8')),'hex'),'decizii_cerute','[]'::jsonb);
END $f$;

CREATE FUNCTION public.fn_izo_birou_jurnal(p_cheie uuid,p_canal text,p_tip text,p_proiect bigint,p_tronson bigint,
 p_payload jsonb,p_hash text,p_raspuns jsonb) RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 INSERT INTO public.izo_operatii(autor_profile_id,op_id,canal,proiect_id,tronson_id,dispozitiv_id,seq,versiune_format,
  tip_op,payload,hash_cerere,rezultat,raspuns)
 VALUES(public.fn_izo_uid(),p_cheie,p_canal,p_proiect,p_tronson,p_cheie,1,1,p_tip,p_payload,p_hash,'acceptat',p_raspuns)
$f$;

CREATE FUNCTION public.fn_izo_aproba_intern(p_cheie uuid,p_preverificare bigint,p_randuri jsonb,p_amprenta text,p_decizii jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_s public.izo_preverificari; v_d public.izo_declaratii; v_b public.magazie_bucati; v_r jsonb;
 v_emp bigint; v_ev bigint; v_evs bigint[]:='{}'; v_ids bigint[]; v_doc jsonb; v_hash text; v_payload jsonb; v_old public.izo_operatii; v_n bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
 SELECT * INTO v_s FROM public.izo_preverificari WHERE id=p_preverificare;
 PERFORM public.fn_izo_birou_intrare(v_s.proiect_id,NULL);
 IF v_s.id IS NULL THEN RAISE EXCEPTION 'sesiune_lipsa'; END IF;
 IF p_cheie IS NULL OR jsonb_typeof(p_randuri) IS DISTINCT FROM 'array' OR jsonb_array_length(p_randuri) NOT BETWEEN 1 AND 200
  OR p_decizii IS DISTINCT FROM '{}'::jsonb OR p_amprenta IS NULL THEN RAISE EXCEPTION 'parametri_invalizi'; END IF;
 SELECT array_agg((x->>'declaratie_id')::bigint ORDER BY (x->>'declaratie_id')::bigint) INTO v_ids FROM jsonb_array_elements(p_randuri) x;
 IF cardinality(v_ids)<>(SELECT count(DISTINCT x) FROM unnest(v_ids) x) OR array_position(v_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'randuri_invalide'; END IF;
 SELECT * INTO v_s FROM public.izo_preverificari WHERE id=p_preverificare FOR UPDATE;
 PERFORM 1 FROM public.izo_declaratii WHERE preverificare_id=v_s.id ORDER BY id FOR UPDATE;
 v_payload:=jsonb_build_object('preverificare',p_preverificare,'randuri',p_randuri,'amprenta',p_amprenta,'decizii',p_decizii);
 v_hash:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
 SELECT * INTO v_old FROM public.izo_operatii WHERE autor_profile_id=public.fn_izo_uid() AND op_id=p_cheie;
 IF FOUND THEN
  IF v_old.canal<>'aprobare' OR v_old.tip_op<>'aproba' OR v_old.hash_cerere<>v_hash THEN RAISE EXCEPTION 'cheie_refolosita'; END IF;
  PERFORM public.fn_izo_birou_autorizat(v_s.proiect_id,NULL,true);
  RETURN v_old.raspuns;
 END IF;
 v_emp:=public.fn_izo_birou_autorizat(v_s.proiect_id,NULL,true);
 IF v_s.stare<>'trimisa' THEN RAISE EXCEPTION 'sesiune_stare'; END IF;
 PERFORM public.fn_izo_blocheaza_locuri(v_s.proiect_id,ARRAY[]::integer[],ARRAY[v_s.tronson_id]);
 PERFORM public.fn_izo_blocheaza_tabele(); PERFORM public.fn_izo_lock_partajat(v_s.proiect_id);
 IF coalesce(public.fn_izo_nivel(v_s.proiect_id),'off') NOT IN ('stoc','montaj') OR NOT EXISTS
  (SELECT 1 FROM public.izo_tronson_config WHERE tronson_id=v_s.tronson_id AND flux_montaj) THEN RAISE EXCEPTION 'flux_inactiv'; END IF;
 PERFORM 1 FROM public.magazie_bucati WHERE proiect_id=v_s.proiect_id AND id=radacina_id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.magazie_bucati WHERE id IN (SELECT bucata_id FROM public.izo_declaratii WHERE id=ANY(v_ids)) ORDER BY id FOR UPDATE;
 v_doc:=public.fn_izo_birou_preview(v_s.id);
 IF encode(sha256(convert_to(v_doc::text,'UTF8')),'hex') IS DISTINCT FROM p_amprenta THEN RAISE EXCEPTION 'preview_vechi'; END IF;
 -- Validate every selected row before the first fact. Partial approval is an explicit subset.
 FOR v_r IN SELECT value FROM jsonb_array_elements(p_randuri) LOOP
  SELECT * INTO v_d FROM public.izo_declaratii WHERE id=(v_r->>'declaratie_id')::bigint AND preverificare_id=v_s.id;
  IF NOT FOUND OR v_d.versiune IS DISTINCT FROM (v_r->>'versiune')::integer
   OR v_d.updated_at IS DISTINCT FROM (v_r->>'updated_at')::timestamptz OR v_d.stare<>'trimisa' THEN RAISE EXCEPTION 'cas'; END IF;
  IF v_d.declarat_de=public.fn_izo_uid() OR v_d.declarat_de_angajat=v_emp THEN RAISE EXCEPTION 'propriul_rand' USING ERRCODE='42501'; END IF;
  IF v_d.tip<>'montaj' OR v_d.identificare IS DISTINCT FROM 'bucata' OR v_d.depinde_de_uid IS NOT NULL
   OR v_d.payload ? 'sudura' OR coalesce(v_d.payload#>>'{amonte,tip}','inceput_lant')<>'inceput_lant' THEN RAISE EXCEPTION 'necesita_graf_suduri_si_simulare'; END IF;
  SELECT * INTO v_b FROM public.magazie_bucati WHERE id=v_d.bucata_id;
  IF v_b.proiect_id IS DISTINCT FROM v_s.proiect_id OR v_b.stare IS DISTINCT FROM 'pe_tronson'
   OR v_b.tronson_id IS DISTINCT FROM v_s.tronson_id OR v_b.tip_cod IS NULL OR v_b.executie_teava_id IS NOT NULL
   OR v_b.lungime_mm IS DISTINCT FROM (v_d.payload->>'lungime_montata_mm')::integer THEN RAISE EXCEPTION 'stare'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.izo_rezervari WHERE declaratie_id=v_d.id AND declaratie_versiune=v_d.versiune
   AND bucata_id=v_b.id AND activa AND expira_dupa IS NULL) THEN RAISE EXCEPTION 'rezervare_pierduta'; END IF;
  IF cardinality(public.fn_izo_pv_lipsa(ARRAY[coalesce(v_b.radacina_id,v_b.id)]))>0 THEN RAISE EXCEPTION 'fara_pv'; END IF;
  IF (v_d.payload#>>'{confirmare,mod}') IS NULL OR (v_d.payload#>>'{confirmare,mod}') NOT IN ('marcaj','taiata','masurat','marcaj_diferit') THEN RAISE EXCEPTION 'lungime_neconfirmata'; END IF;
  IF v_d.payload#>>'{confirmare,mod}'='marcaj' AND (v_d.payload#>>'{confirmare,cm}')::integer IS DISTINCT FROM (round(v_b.lungime_mm::numeric/10)::integer%100) THEN RAISE EXCEPTION 'marcaj'; END IF;
 END LOOP;
 FOR v_d IN SELECT * FROM public.izo_declaratii WHERE id=ANY(v_ids) ORDER BY id LOOP
  v_ev:=public.fn_izo_birou_fapt(v_d.bucata_id,'aproba',v_d.id::text,v_s.tronson_id,NULL,v_d.declarat_de,v_d.dispozitiv_id::text,
   (SELECT ora_tableta FROM public.izo_operatii WHERE autor_profile_id=v_d.declarat_de AND op_id=v_d.ultimul_op_id AND canal='teren'),NULL);
  v_evs:=array_append(v_evs,v_ev);
  UPDATE public.izo_rezervari SET activa=false,eliberata_la=clock_timestamp(),motiv_eliberare='consumata',eveniment_id=v_ev,
   server_ver=nextval('public.izo_server_ver_seq') WHERE declaratie_id=v_d.id AND declaratie_versiune=v_d.versiune AND activa;
  GET DIAGNOSTICS v_n=ROW_COUNT; IF v_n<>1 THEN RAISE EXCEPTION 'reconciliere_rezervare'; END IF;
  UPDATE public.izo_declaratii SET stare='aprobata',aprobat_de=public.fn_izo_uid(),aprobat_de_angajat=v_emp,
   decis_la=clock_timestamp(),eveniment_ids=ARRAY[v_ev],server_ver=nextval('public.izo_server_ver_seq') WHERE id=v_d.id;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.izo_declaratii WHERE preverificare_id=v_s.id AND stare NOT IN ('aprobata','respinsa','stearsa')) THEN
  UPDATE public.izo_preverificari SET stare='inchisa',server_ver=nextval('public.izo_server_ver_seq') WHERE id=v_s.id;
 END IF;
 v_r:=jsonb_build_object('cod','aprobat','eveniment_ids',to_jsonb(v_evs));
 INSERT INTO public.izo_aprobari(cheie_operatie,proiect_id,tronson_id,aprobator,aprobator_angajat,randuri,decizii,hash_cerere,amprenta_preview,eveniment_ids,raspuns)
 VALUES(p_cheie,v_s.proiect_id,v_s.tronson_id,public.fn_izo_uid(),v_emp,p_randuri,p_decizii,v_hash,p_amprenta,v_evs,v_r);
 PERFORM public.fn_izo_birou_jurnal(p_cheie,'aprobare','aproba',v_s.proiect_id,v_s.tronson_id,v_payload,v_hash,v_r);
 RETURN v_r;
END $f$;

CREATE FUNCTION public.fn_izo_aprobare_lot(p_preverificare bigint) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT public.fn_izo_aprobare_intern(p_preverificare)
$f$;
CREATE FUNCTION public.fn_izo_aproba(p_cheie uuid,p_preverificare bigint,p_randuri jsonb,p_amprenta text,p_decizii jsonb) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT public.fn_izo_aproba_intern(p_cheie,p_preverificare,p_randuri,p_amprenta,p_decizii)
$f$;

CREATE FUNCTION public.fn_izo_iesire_intern(p_cheie uuid,p_depozit integer,p_tronson bigint,p_bucati bigint[],p_nr_aviz text,p_data date) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_pr bigint; v_b public.magazie_bucati; v_payload jsonb; v_hash text; v_old public.izo_operatii;
 v_r jsonb; v_evs bigint[]:='{}'; v_ev bigint; v_ids bigint[]; v_site integer;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
 SELECT proiect_id INTO v_pr FROM public.executie_tronsoane WHERE id=p_tronson;
 PERFORM public.fn_izo_birou_intrare(v_pr,p_depozit);
 IF v_pr IS NULL THEN RAISE EXCEPTION 'tronson_lipsa'; END IF;
 IF p_cheie IS NULL OR p_depozit IS NULL OR p_data IS NULL OR p_data>current_date
  OR length(btrim(coalesce(p_nr_aviz,''))) NOT BETWEEN 3 AND 100 OR cardinality(p_bucati) NOT BETWEEN 1 AND 200
  OR p_bucati IS NULL OR array_position(p_bucati,NULL) IS NOT NULL THEN RAISE EXCEPTION 'parametri_invalizi'; END IF;
 SELECT array_agg(x ORDER BY x) INTO v_ids FROM unnest(p_bucati) x;
 IF cardinality(v_ids)<>(SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN RAISE EXCEPTION 'bucati_duplicate'; END IF;
 -- Serialize a depot key without taking root locks before authorization/locations.
 PERFORM pg_advisory_xact_lock(hashtextextended('izo.iesire|'||public.fn_izo_uid()::text||'|'||p_cheie::text,0));
 v_payload:=jsonb_build_object('depozit',p_depozit,'tronson',p_tronson,'bucati',to_jsonb(v_ids),'nr_aviz',btrim(p_nr_aviz),'data',p_data);
 v_hash:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
 SELECT * INTO v_old FROM public.izo_operatii WHERE autor_profile_id=public.fn_izo_uid() AND op_id=p_cheie;
 PERFORM public.fn_izo_birou_autorizat(v_pr,p_depozit,true);
 IF v_old.id IS NOT NULL THEN
  IF v_old.canal<>'depozit' OR v_old.tip_op<>'iesire' OR v_old.hash_cerere<>v_hash THEN RAISE EXCEPTION 'cheie_refolosita'; END IF;
  RETURN v_old.raspuns;
 END IF;
 PERFORM public.fn_izo_blocheaza_locuri(v_pr,ARRAY[p_depozit],ARRAY[p_tronson]);
 PERFORM public.fn_izo_blocheaza_tabele(); PERFORM public.fn_izo_lock_partajat(v_pr);
 IF coalesce(public.fn_izo_nivel(v_pr),'off') NOT IN ('stoc','montaj') OR NOT EXISTS
  (SELECT 1 FROM public.izo_tronson_config WHERE tronson_id=p_tronson AND flux_montaj) THEN RAISE EXCEPTION 'flux_inactiv'; END IF;
 SELECT site_id INTO v_site FROM public.executie_proiecte WHERE id=v_pr;
 IF NOT EXISTS(SELECT 1 FROM public.logistica_depozite WHERE id=p_depozit AND activ AND site_id=v_site) THEN RAISE EXCEPTION 'depozit_invalid'; END IF;
 PERFORM 1 FROM public.magazie_bucati WHERE id IN (SELECT coalesce(radacina_id,id) FROM public.magazie_bucati WHERE id=ANY(v_ids)) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.magazie_bucati WHERE id=ANY(v_ids) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.magazie_bucati WHERE id=ANY(v_ids))<>cardinality(v_ids) THEN RAISE EXCEPTION 'bucata_lipsa'; END IF;
 FOR v_b IN SELECT * FROM public.magazie_bucati WHERE id=ANY(v_ids) ORDER BY id LOOP
  IF v_b.proiect_id IS DISTINCT FROM v_pr OR v_b.tip_cod IS NULL OR v_b.provenienta<>'beneficiar'
   OR v_b.stare NOT IN ('sosit','receptionat','retur') OR v_b.depozit_id IS DISTINCT FROM p_depozit
   OR v_b.executie_teava_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.magazie_bucati WHERE parinte_id=v_b.id AND stare<>'anulata') THEN RAISE EXCEPTION 'stare'; END IF;
  IF cardinality(public.fn_izo_pv_lipsa(ARRAY[coalesce(v_b.radacina_id,v_b.id)]))>0 THEN RAISE EXCEPTION 'fara_pv'; END IF;
  -- A reservation on this tronson is regularized; one on another tronson is not.
  IF EXISTS(SELECT 1 FROM public.izo_rezervari WHERE bucata_id=v_b.id AND activa
    AND (expira_dupa IS NULL OR expira_dupa>now()) AND tronson_id<>p_tronson) THEN RAISE EXCEPTION 'rezervata_alt_tronson'; END IF;
 END LOOP;
 FOR v_b IN SELECT * FROM public.magazie_bucati WHERE id=ANY(v_ids) ORDER BY id LOOP
  v_ev:=public.fn_izo_birou_fapt(v_b.id,'iesire',p_cheie::text,p_tronson,p_depozit,public.fn_izo_uid(),NULL,
   p_data::timestamp AT TIME ZONE 'Europe/Bucharest','Aviz '||btrim(p_nr_aviz));
  v_evs:=array_append(v_evs,v_ev);
 END LOOP;
 v_r:=jsonb_build_object('cod','iesit','eveniment_ids',to_jsonb(v_evs));
 PERFORM public.fn_izo_birou_jurnal(p_cheie,'depozit','iesire',v_pr,p_tronson,v_payload,v_hash,v_r);
 RETURN v_r;
END $f$;

CREATE FUNCTION public.fn_izo_dependenti(p_decl bigint) RETURNS bigint[]
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 WITH RECURSIVE deps AS (
  SELECT id,uid FROM public.izo_declaratii WHERE id=p_decl
  UNION
  SELECT d.id,d.uid FROM public.izo_declaratii d JOIN deps x ON d.depinde_de_uid=x.uid
   OR EXISTS(SELECT 1 FROM public.izo_bucati_declarate c WHERE c.declaratie_id=x.id AND c.uid IN (d.bucata_decl_uid,d.sursa_decl_uid))
  WHERE d.stare NOT IN ('aprobata','respinsa','stearsa')
 ) SELECT coalesce(array_agg(id ORDER BY id),'{}'::bigint[]) FROM deps
$f$;

CREATE FUNCTION public.fn_izo_decizie_intern(p_cheie uuid,p_decl bigint,p_versiune integer,p_updated_at timestamptz,
 p_motiv text,p_dependente jsonb,p_revizie boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_d public.izo_declaratii; v_x public.izo_declaratii; v_s public.izo_preverificari;
 v_ids bigint[]; v_before bigint[]; v_keys text[]; v_actual text[]; v_choice text; v_hash text; v_payload jsonb; v_r jsonb;
 v_old public.izo_operatii; v_type text:=CASE WHEN p_revizie THEN 'revizie' ELSE 'respinge' END;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
 SELECT * INTO v_d FROM public.izo_declaratii WHERE id=p_decl;
 PERFORM public.fn_izo_birou_intrare(v_d.proiect_id,NULL);
 IF v_d.id IS NULL THEN RAISE EXCEPTION 'declaratie_lipsa'; END IF;
 IF p_cheie IS NULL OR p_updated_at IS NULL OR length(btrim(coalesce(p_motiv,''))) NOT BETWEEN 3 AND 1000
  OR p_revizie IS NULL OR jsonb_typeof(p_dependente) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'parametri_invalizi'; END IF;
 PERFORM 1 FROM public.izo_fronturi WHERE proiect_id=v_d.proiect_id ORDER BY id FOR SHARE;
 v_before:=public.fn_izo_dependenti(p_decl);
 -- Conservative project closure, acquired once in the same order as sync.
 PERFORM 1 FROM public.izo_preverificari WHERE proiect_id=v_d.proiect_id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.izo_declaratii WHERE proiect_id=v_d.proiect_id ORDER BY id FOR UPDATE;
 v_ids:=public.fn_izo_dependenti(p_decl);
 IF v_before IS DISTINCT FROM v_ids THEN RAISE EXCEPTION 'preview_vechi'; END IF;
 SELECT * INTO v_d FROM public.izo_declaratii WHERE id=p_decl;
 v_payload:=jsonb_build_object('decl',p_decl,'versiune',p_versiune,'updated_at',p_updated_at,'motiv',btrim(p_motiv),'dependente',p_dependente,'revizie',p_revizie);
 v_hash:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
 SELECT * INTO v_old FROM public.izo_operatii WHERE autor_profile_id=public.fn_izo_uid() AND op_id=p_cheie;
 PERFORM public.fn_izo_birou_autorizat(v_d.proiect_id,NULL,true);
 IF v_old.id IS NOT NULL THEN
  IF v_old.canal<>'aprobare' OR v_old.tip_op<>v_type OR v_old.hash_cerere<>v_hash THEN RAISE EXCEPTION 'cheie_refolosita'; END IF;
  RETURN v_old.raspuns;
 END IF;
 IF v_d.versiune IS DISTINCT FROM p_versiune OR v_d.updated_at IS DISTINCT FROM p_updated_at THEN RAISE EXCEPTION 'cas'; END IF;
 PERFORM public.fn_izo_autor_valabil(declarat_de,proiect_id,true) FROM public.izo_declaratii WHERE id=ANY(v_ids) ORDER BY declarat_de;
 SELECT * INTO v_s FROM public.izo_preverificari WHERE id=v_d.preverificare_id;
 IF p_revizie THEN
  IF v_s.stare<>'trimisa' OR v_d.stare NOT IN ('trimisa','in_verificare') OR p_dependente<>'{}'::jsonb THEN RAISE EXCEPTION 'stare'; END IF;
  IF cardinality(v_ids)>1 THEN RAISE EXCEPTION 'necesita_revizie_dependente'; END IF;
 ELSE
  IF v_d.stare IN ('aprobata','respinsa','stearsa') OR (v_s.stare='deschisa' AND EXISTS(
   SELECT 1 FROM public.izo_fronturi WHERE tronson_id=v_s.tronson_id AND profile_id=v_s.autor_profile_id AND activ AND expira_la>now())
    AND public.fn_izo_autor_valabil(v_s.autor_profile_id,v_s.proiect_id,false)) THEN RAISE EXCEPTION 'stare'; END IF;
  SELECT coalesce(array_agg(x::text ORDER BY x::text),'{}') INTO v_keys FROM unnest(v_ids) x WHERE x<>p_decl;
  SELECT coalesce(array_agg(x ORDER BY x),'{}') INTO v_actual FROM jsonb_object_keys(p_dependente) x;
  IF v_keys IS DISTINCT FROM v_actual THEN RAISE EXCEPTION 'dependente_schimbate'; END IF;
 END IF;
 PERFORM 1 FROM public.magazie_bucati WHERE proiect_id=v_d.proiect_id AND id=radacina_id ORDER BY id FOR UPDATE;
 FOR v_x IN SELECT * FROM public.izo_declaratii WHERE id=ANY(v_ids) ORDER BY id LOOP
  IF v_x.id=p_decl THEN
   UPDATE public.izo_declaratii SET stare=CASE WHEN p_revizie THEN 'revizie_ceruta' ELSE 'respinsa' END,
    stare_inainte_blocare=NULL,blocata_motiv=NULL,conflict_cod=NULL,decis_la=clock_timestamp(),decizie_motiv=btrim(p_motiv),
    server_ver=nextval('public.izo_server_ver_seq') WHERE id=v_x.id;
  ELSE
   v_choice:=CASE WHEN p_revizie THEN 'blocheaza' ELSE p_dependente->>v_x.id::text END;
   IF v_choice IS NULL OR v_choice NOT IN ('blocheaza','respinge') THEN RAISE EXCEPTION 'decizie_nepermisa'; END IF;
   IF v_choice='respinge' AND EXISTS(SELECT 1 FROM public.izo_preverificari s JOIN public.izo_fronturi f
    ON f.tronson_id=s.tronson_id AND f.profile_id=s.autor_profile_id
    WHERE s.id=v_x.preverificare_id AND s.stare='deschisa' AND f.activ AND f.expira_la>now()
     AND public.fn_izo_autor_valabil(s.autor_profile_id,s.proiect_id,false)) THEN RAISE EXCEPTION 'decizie_nepermisa'; END IF;
   UPDATE public.izo_declaratii SET stare=CASE WHEN v_choice='respinge' THEN 'respinsa' ELSE 'blocata' END,
    stare_inainte_blocare=CASE WHEN v_choice='blocheaza' THEN coalesce(v_x.stare_inainte_blocare,v_x.stare) END,
    blocata_motiv=CASE WHEN v_choice='blocheaza' THEN CASE WHEN NOT p_revizie OR v_x.blocata_motiv='dependenta_anulata' THEN 'dependenta_anulata' ELSE 'dependenta_in_revizie' END END,
    conflict_cod=CASE WHEN v_choice='blocheaza' THEN v_x.conflict_cod END,
    decis_la=clock_timestamp(),decizie_motiv=btrim(p_motiv),server_ver=nextval('public.izo_server_ver_seq') WHERE id=v_x.id;
  END IF;
 END LOOP;
 IF NOT p_revizie THEN
  UPDATE public.izo_rezervari SET activa=false,eliberata_la=clock_timestamp(),motiv_eliberare=CASE WHEN declaratie_id=p_decl THEN 'respinsa' ELSE 'parinte_anulat' END,
   server_ver=nextval('public.izo_server_ver_seq') WHERE activa AND (declaratie_id=ANY(v_ids) OR bucata_decl_uid IN
    (SELECT uid FROM public.izo_bucati_declarate WHERE declaratie_id=ANY(v_ids)));
  UPDATE public.izo_bucati_declarate SET stare='anulata',server_ver=nextval('public.izo_server_ver_seq') WHERE declaratie_id=ANY(v_ids) AND stare='declarata';
 END IF;
 UPDATE public.izo_preverificari s SET stare='inchisa',server_ver=nextval('public.izo_server_ver_seq')
 WHERE s.id IN (SELECT preverificare_id FROM public.izo_declaratii WHERE id=ANY(v_ids)) AND s.stare<>'inchisa'
  AND NOT EXISTS(SELECT 1 FROM public.izo_declaratii d WHERE d.preverificare_id=s.id AND d.stare NOT IN ('aprobata','respinsa','stearsa'));
 v_r:=jsonb_build_object('cod',CASE WHEN p_revizie THEN 'revizie_ceruta' ELSE 'respinsa' END,'declaratie_id',p_decl);
 PERFORM public.fn_izo_birou_jurnal(p_cheie,'aprobare',v_type,v_d.proiect_id,v_d.tronson_id,v_payload,v_hash,v_r);
 RETURN v_r;
END $f$;

CREATE FUNCTION public.fn_izo_front_intern(p_tronson bigint,p_motiv text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_pr bigint; v_n bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
 SELECT proiect_id INTO v_pr FROM public.executie_tronsoane WHERE id=p_tronson;
 PERFORM public.fn_izo_birou_intrare(v_pr,NULL);
 IF v_pr IS NULL THEN RAISE EXCEPTION 'tronson_lipsa'; END IF;
 IF length(btrim(coalesce(p_motiv,''))) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'motiv_obligatoriu'; END IF;
 PERFORM 1 FROM public.izo_fronturi WHERE tronson_id=p_tronson AND activ FOR UPDATE;
 PERFORM public.fn_izo_birou_autorizat(v_pr,NULL,true);
 UPDATE public.izo_fronturi SET activ=false,eliberat_de=public.fn_izo_uid(),eliberat_motiv=btrim(p_motiv),
  server_ver=nextval('public.izo_server_ver_seq') WHERE tronson_id=p_tronson AND activ;
 GET DIAGNOSTICS v_n=ROW_COUNT;
 RETURN jsonb_build_object('cod',CASE WHEN v_n=0 THEN 'fara_efect' ELSE 'eliberat' END);
END $f$;

CREATE FUNCTION public.fn_izo_iesire_tronson(p_cheie uuid,p_depozit integer,p_tronson bigint,p_bucati bigint[],p_nr_aviz text,p_data date) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT public.fn_izo_iesire_intern(p_cheie,p_depozit,p_tronson,p_bucati,p_nr_aviz,p_data)
$f$;
CREATE FUNCTION public.fn_izo_respinge(p_cheie uuid,p_decl bigint,p_versiune integer,p_updated_at timestamptz,p_motiv text,p_dependente jsonb) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT public.fn_izo_decizie_intern(p_cheie,p_decl,p_versiune,p_updated_at,p_motiv,p_dependente,false)
$f$;
CREATE FUNCTION public.fn_izo_revizie_cere(p_cheie uuid,p_decl bigint,p_versiune integer,p_updated_at timestamptz,p_motiv text) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT public.fn_izo_decizie_intern(p_cheie,p_decl,p_versiune,p_updated_at,p_motiv,'{}'::jsonb,true)
$f$;
CREATE FUNCTION public.fn_izo_front_elibereaza(p_tronson bigint,p_motiv text) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT public.fn_izo_front_intern(p_tronson,p_motiv)
$f$;

CREATE FUNCTION public.fn_izo_serie_intern(p_cheie uuid,p_decl bigint,p_versiune integer,p_updated_at timestamptz,p_bucata bigint,p_motiv text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_d public.izo_declaratii; v_b public.magazie_bucati; v_s public.izo_preverificari;
 v_payload jsonb; v_hash text; v_old public.izo_operatii; v_r jsonb; v_conflict text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED' USING ERRCODE='25001'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
 SELECT * INTO v_d FROM public.izo_declaratii WHERE id=p_decl;
 PERFORM public.fn_izo_birou_intrare(v_d.proiect_id,NULL);
 IF v_d.id IS NULL OR p_cheie IS NULL OR p_updated_at IS NULL OR p_bucata IS NULL
  OR length(btrim(coalesce(p_motiv,''))) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'parametri_invalizi'; END IF;
 SELECT * INTO v_s FROM public.izo_preverificari WHERE id=v_d.preverificare_id FOR UPDATE;
 SELECT * INTO v_d FROM public.izo_declaratii WHERE id=p_decl FOR UPDATE;
 v_payload:=jsonb_build_object('decl',p_decl,'versiune',p_versiune,'updated_at',p_updated_at,'bucata',p_bucata,'motiv',btrim(p_motiv));
 v_hash:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
 SELECT * INTO v_old FROM public.izo_operatii WHERE autor_profile_id=public.fn_izo_uid() AND op_id=p_cheie;
 PERFORM public.fn_izo_birou_autorizat(v_d.proiect_id,NULL,true);
 IF v_old.id IS NOT NULL THEN
  IF v_old.canal<>'aprobare' OR v_old.tip_op<>'serie' OR v_old.hash_cerere<>v_hash THEN RAISE EXCEPTION 'cheie_refolosita'; END IF;
  RETURN v_old.raspuns;
 END IF;
 IF v_s.stare<>'trimisa' OR v_d.stare<>'in_verificare' OR v_d.identificare IS DISTINCT FROM 'nerezolvata'
  OR v_d.versiune IS DISTINCT FROM p_versiune OR v_d.updated_at IS DISTINCT FROM p_updated_at THEN RAISE EXCEPTION 'cas'; END IF;
 PERFORM public.fn_izo_blocheaza_locuri(v_d.proiect_id,ARRAY[]::integer[],ARRAY[v_d.tronson_id]);
 PERFORM 1 FROM public.izo_tronson_config WHERE tronson_id=v_d.tronson_id FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM public.izo_tronson_config WHERE tronson_id=v_d.tronson_id AND flux_montaj)
  OR coalesce(public.fn_izo_nivel(v_d.proiect_id),'off')='off' THEN RAISE EXCEPTION 'flux_inactiv'; END IF;
 PERFORM 1 FROM public.magazie_bucati WHERE proiect_id=v_d.proiect_id AND id=radacina_id ORDER BY id FOR UPDATE;
 SELECT * INTO v_b FROM public.magazie_bucati WHERE id=p_bucata FOR UPDATE;
 IF NOT FOUND OR v_b.proiect_id IS DISTINCT FROM v_d.proiect_id OR v_b.stare IS DISTINCT FROM 'pe_tronson'
  OR v_b.tronson_id IS DISTINCT FROM v_d.tronson_id OR v_b.tip_cod IS NULL OR v_b.executie_teava_id IS NOT NULL
  OR EXISTS(SELECT 1 FROM public.magazie_bucati WHERE parinte_id=v_b.id AND stare<>'anulata') THEN RAISE EXCEPTION 'stare'; END IF;
 IF v_b.lungime_mm IS DISTINCT FROM (v_d.payload->>'lungime_montata_mm')::integer THEN RAISE EXCEPTION 'lungime_incompatibila'; END IF;
 IF cardinality(public.fn_izo_pv_lipsa(ARRAY[coalesce(v_b.radacina_id,v_b.id)]))>0 THEN RAISE EXCEPTION 'fara_pv'; END IF;
 IF EXISTS(SELECT 1 FROM public.izo_rezervari WHERE bucata_id=v_b.id AND activa AND (expira_dupa IS NULL OR expira_dupa>now())) THEN RAISE EXCEPTION 'bucata_rezervata'; END IF;
 IF (SELECT count(*) FROM public.izo_rezervari WHERE autor_profile_id=v_d.declarat_de AND activa AND (expira_dupa IS NULL OR expira_dupa>now()))>=60 THEN RAISE EXCEPTION 'limita'; END IF;
 UPDATE public.izo_rezervari SET activa=false,eliberata_la=clock_timestamp(),motiv_eliberare='expirata',
  server_ver=nextval('public.izo_server_ver_seq') WHERE bucata_id=v_b.id AND activa AND expira_dupa<=now();
 IF EXISTS(SELECT 1 FROM public.magazie_bucati b WHERE b.id<>v_b.id AND b.proiect_id=v_b.proiect_id AND b.stare NOT IN ('taiata','anulata')
  AND b.serie_canon=v_b.serie_canon AND b.sarja IS NOT DISTINCT FROM v_b.sarja AND b.lungime_cm=v_b.lungime_cm
  AND NOT EXISTS(SELECT 1 FROM public.magazie_bucati c WHERE c.parinte_id=b.id AND c.stare<>'anulata')) THEN v_conflict:='r1d'; END IF;
 UPDATE public.izo_declaratii SET bucata_id=v_b.id,identificare='bucata',stare=CASE WHEN v_conflict IS NULL THEN 'trimisa' ELSE 'conflict' END,
  conflict_cod=v_conflict,versiune=versiune+1,decis_la=clock_timestamp(),decizie_motiv=btrim(p_motiv),
  payload=payload||jsonb_build_object('bucata',jsonb_build_object('bucata_id',v_b.id)),
  server_ver=nextval('public.izo_server_ver_seq') WHERE id=v_d.id RETURNING * INTO v_d;
 INSERT INTO public.izo_declaratii_versiuni(declaratie_id,versiune,payload,hash_cerere,op_id)
 VALUES(v_d.id,v_d.versiune,v_d.payload,v_hash,p_cheie);
 INSERT INTO public.izo_rezervari(proiect_id,tronson_id,declaratie_id,declaratie_versiune,autor_profile_id,bucata_id,din_depozit)
 VALUES(v_d.proiect_id,v_d.tronson_id,v_d.id,v_d.versiune,v_d.declarat_de,v_b.id,false);
 v_r:=jsonb_build_object('cod','lamurita','declaratie_id',v_d.id,'versiune',v_d.versiune,'updated_at',v_d.updated_at,'stare',v_d.stare);
 PERFORM public.fn_izo_birou_jurnal(p_cheie,'aprobare','serie',v_d.proiect_id,v_d.tronson_id,v_payload,v_hash,v_r);
 RETURN v_r;
END $f$;
CREATE FUNCTION public.fn_izo_serie_lamureste(p_cheie uuid,p_decl bigint,p_versiune integer,p_updated_at timestamptz,p_bucata bigint,p_motiv text) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
 SELECT public.fn_izo_serie_intern(p_cheie,p_decl,p_versiune,p_updated_at,p_bucata,p_motiv)
$f$;
