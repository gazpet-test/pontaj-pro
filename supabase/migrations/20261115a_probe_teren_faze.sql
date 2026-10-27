-- NEAPLICAT. Runner version 20261115120000. ASCII / LF. Fara backfill.
DO $pt2_start_20261115a$
BEGIN
  IF current_user<>'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261115a_probe_teren_faze:' || txid_current() THEN RAISE EXCEPTION 'pt_garda: garda start invalida'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'pt_izolare: necesita READ COMMITTED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
  PERFORM pg_advisory_xact_lock(hashtext('probe_teren_scriere'));
  PERFORM set_config('lock_timeout','5s',true);
  IF EXISTS(SELECT 1 FROM pg_db_role_setting s,unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN RAISE EXCEPTION 'pt_garda: armare persistenta interzisa'; END IF;
  IF to_regprocedure('public.probe_teren_scrie(text,bigint,jsonb,text)') IS NULL
    OR to_regclass('public.executie_tronsoane') IS NULL THEN RAISE EXCEPTION 'pt_schema: etapa 1 si tronsoane necesare'; END IF;
  -- CREATE foloseste current_user; CREATE OR REPLACE pastreaza owner-ul writer-ului.
  -- Cei doi owneri trebuie sa ramana identici si dupa livrare: triggerul verifica writer-ul.
  IF (SELECT proowner FROM pg_proc WHERE oid='public.probe_teren_scrie(text,bigint,jsonb,text)'::regprocedure)<>current_user::regrole THEN
    RAISE EXCEPTION 'pt_preflight: creare teren si writer necesita acelasi owner';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['tip_fluid','dn_id','lungime_m','presiune_bar','config_id','created_by']) c
    WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='probe_calcule' AND column_name=c)) THEN RAISE EXCEPTION 'pt_schema: coloane planificare lipsa'; END IF;
  IF to_regclass('public.probe_teren_e2a_schema') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('probe_teren_scrie_e1','probe_teren_faze_guard','fn_probe_schimba_faza','fn_probe_creeaza_teren'))
    OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND
      ((table_name='probe_calcule' AND column_name IN ('faza_curenta','creat_din_teren')) OR
       (table_name='probe_log_executie' AND column_name IN ('faza','limita_faza')) OR
       (table_name='probe_exec_utilaje' AND column_name IN ('faza_start','faza_stop')))) THEN RAISE EXCEPTION 'pt_preflight: obiecte etapa 2a deja existente'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.probe_exec_utilaje'::regclass AND conname='probe_exec_utilaje_check') THEN RAISE EXCEPTION 'pt_schema: CHECK oprire etapa 1 lipsa'; END IF;
END $pt2_start_20261115a$;
LOCK TABLE public.probe_calcule,public.probe_log_executie,public.probe_exec_utilaje,public.probe_log_utilaje,public.probe_teren_operatii IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.probe_calcule ADD COLUMN faza_curenta text, ADD COLUMN creat_din_teren boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT probe_calc_faza_tip CHECK (faza_curenta IS NULL OR
   (tip_fluid IS NOT NULL AND ((tip_fluid='aer' AND faza_curenta IN ('pistonare','uscare','calibrare','proba')) OR
   (tip_fluid='apa' AND faza_curenta IN ('umplere','presurizare')))));
ALTER TABLE public.probe_log_executie ADD COLUMN faza text, ADD COLUMN limita_faza boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT probe_log_faza CHECK (faza IS NULL OR faza IN ('pistonare','uscare','calibrare','proba','umplere','presurizare'));
CREATE TABLE public.probe_teren_e2a_schema(coloane_nn text[] NOT NULL,check_oprire text NOT NULL);
ALTER TABLE public.probe_teren_e2a_schema ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.probe_teren_e2a_schema FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.probe_teren_e2a_schema SELECT ARRAY[]::text[],pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid='public.probe_exec_utilaje'::regclass AND conname='probe_exec_utilaje_check';
ALTER TABLE public.probe_exec_utilaje ADD COLUMN faza_start text, ADD COLUMN faza_stop text,
 ALTER COLUMN ore_bord_start DROP NOT NULL, ALTER COLUMN poza_start_path DROP NOT NULL,
 DROP CONSTRAINT probe_exec_utilaje_check,
 ADD CONSTRAINT probe_exec_faze CHECK (
   (faza_start IS NULL OR faza_start IN ('pistonare','uscare','calibrare','proba','umplere','presurizare')) AND
   (faza_stop IS NULL OR faza_stop IN ('pistonare','uscare','calibrare','proba','umplere','presurizare'))),
 ADD CONSTRAINT probe_exec_dovezi CHECK (
   (coalesce(faza_start IN ('umplere','presurizare'),false) OR (ore_bord_start IS NOT NULL AND poza_start_path IS NOT NULL)) AND
   ((ora_stop IS NULL AND ore_bord_stop IS NULL AND poza_stop_path IS NULL AND motiv_oprire IS NULL AND faza_stop IS NULL) OR
    (ora_stop IS NOT NULL AND ora_stop>=ora_start AND motiv_oprire IS NOT NULL AND
      ((coalesce(faza_start IN ('umplere','presurizare'),false)
        AND (ore_bord_stop IS NULL OR (ore_bord_stop>=coalesce(ore_bord_start,0) AND ore_bord_stop::text NOT IN ('NaN','Infinity','-Infinity')))
        AND (poza_stop_path IS NULL OR btrim(poza_stop_path)<>'')) OR
       (ore_bord_stop IS NOT NULL AND ore_bord_stop>=ore_bord_start AND ore_bord_stop::text NOT IN ('NaN','Infinity','-Infinity') AND poza_stop_path IS NOT NULL AND btrim(poza_stop_path)<>'')))));


DO $pt2_planificare_20261115a$
DECLARE cols text[]; col text; expresie text;
BEGIN
  -- Numai campurile comerciale cunoscute. Alta coloana obligatorie fara default => preflight refuzat.
  SELECT coalesce(array_agg(attname ORDER BY attnum),ARRAY[]::text[]) INTO cols FROM pg_attribute
   WHERE attrelid='public.probe_calcule'::regclass AND attnum>0 AND NOT attisdropped AND attnotnull
     AND attname=ANY(ARRAY['dn_id','lungime_m','presiune_bar','config_id','v_conducta_mc','v_la_presiune_mc',
       'durata_proba_h','durata_pistonare_h','durata_total_h','consum_motorina_l','timp_umplere_h','timp_presurizare_h','valoare_lei']);
  UPDATE public.probe_teren_e2a_schema SET coloane_nn=cols WHERE check_oprire<>'';
  FOREACH col IN ARRAY cols LOOP
    EXECUTE format('ALTER TABLE public.probe_calcule ALTER COLUMN %I DROP NOT NULL',col);
    expresie:=concat_ws(' AND ',expresie,format('%I IS NOT NULL',col));
  END LOOP;
  IF expresie IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.probe_calcule ADD CONSTRAINT probe_planificare_nn CHECK (creat_din_teren OR ('||expresie||'))';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.probe_calcule'::regclass AND a.attnum>0 AND NOT a.attisdropped
    AND a.attnotnull AND NOT a.atthasdef AND a.attidentity='' AND a.attgenerated=''
    AND a.attname NOT IN ('tip_fluid','status','beneficiar_tip','created_by','creat_din_teren')
    AND NOT (a.attname='id' AND pg_get_serial_sequence('public.probe_calcule','id') IS NOT NULL)) THEN
    RAISE EXCEPTION 'pt_schema: alta coloana obligatorie fara default; verificare schema necesara';
  END IF;
END $pt2_planificare_20261115a$;
ALTER TABLE public.probe_teren_operatii DROP CONSTRAINT probe_teren_operatii_actiune_check,
 ADD CONSTRAINT probe_teren_operatii_actiune_check CHECK (actiune IN ('porneste','citire','opreste_utilaj','inchide','completeaza_executie','schimba_faza','creeaza_teren'));

CREATE FUNCTION public.probe_teren_scrie_e1(p_actiune text,p_calc_id bigint,p_date jsonb,p_cheie text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $pt_scrie_legacy_20261115a$
DECLARE c public.probe_calcule%ROWTYPE; op public.probe_teren_operatii%ROWTYPE;
  u jsonb; v_items jsonb; e public.probe_exec_utilaje%ROWTYPE;
  v_id bigint; v_log bigint; v_nou bigint; v_ultima timestamptz; v_intarziata boolean:=false;
  v_p numeric; v_rez jsonb;
BEGIN
  IF NOT public.probe_teren_drept(true) THEN RAISE EXCEPTION 'pt_acces: drept explicit de scriere probe_teren necesar' USING ERRCODE='42501'; END IF;
  IF p_cheie IS NULL OR length(btrim(p_cheie)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'pt_cheie: cheie obligatorie, maxim 200 caractere'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('probe_teren_scriere'));
  SELECT * INTO op FROM public.probe_teren_operatii WHERE cheie=p_cheie;
  IF FOUND THEN
    IF op.calc_id IS DISTINCT FROM p_calc_id OR op.actiune IS DISTINCT FROM p_actiune OR op.continut IS DISTINCT FROM p_date OR op.creat_de IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'pt_cheie_conflict: cheia exista cu alt continut sau autor';
    END IF;
    RETURN op.rezultat;
  END IF;
  SELECT * INTO c FROM public.probe_calcule WHERE id=p_calc_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pt_proba: proba inexistenta'; END IF;
  -- Completarea nu schimba workflow-ul si ramane permisa dupa inchidere.
  IF p_actiune='completeaza_executie' THEN
    IF (p_date->>'temperatura_c')::numeric::text IN ('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'pt_date: temperatura invalida';
    END IF;
    UPDATE public.probe_calcule SET
      config_real_id=(p_date->>'config_real_id')::bigint,
      temperatura_c=(p_date->>'temperatura_c')::numeric,
      operator_nume=p_date->>'operator_nume',responsabil_nume=p_date->>'responsabil_nume',
      pv_path=p_date->>'pv_path',pv_generat_la=(p_date->>'pv_generat_la')::timestamptz,
      aep_diagrama_path=p_date->>'aep_diagrama_path',updated_at=now()
      WHERE id=p_calc_id;
    v_rez:=jsonb_build_object('ok',true,'calc_id',p_calc_id,'ora_server',now());
    INSERT INTO public.probe_teren_operatii(cheie,calc_id,actiune,continut,rezultat,creat_de)
      VALUES(p_cheie,p_calc_id,p_actiune,p_date,v_rez,auth.uid());
    RETURN v_rez;
  END IF;
  IF c.beneficiar_tip IS NULL THEN RAISE EXCEPTION 'pt_beneficiar: completati beneficiarul probei istorice'; END IF;
  -- Referinta poate disparea dupa creare; pornirea revalideaza.
  IF p_actiune='porneste' AND c.beneficiar_tip='tert' AND c.tert_ref_tip IN ('oferta','contract')
    AND NOT public.probe_teren_referinta_exista(c.tert_ref_tip,c.tert_ref_id) THEN
    RAISE EXCEPTION 'pt_beneficiar: referinta inexistenta sau lipsa drept probe_teren';
  END IF;
  IF (p_actiune='porneste' AND c.status IS DISTINCT FROM 'planificata') OR
     (p_actiune<>'porneste' AND c.status IS DISTINCT FROM 'in_executie') THEN RAISE EXCEPTION 'pt_status: tranzitie de status nepermisa'; END IF;
  IF p_actiune NOT IN ('porneste','citire','opreste_utilaj','inchide') THEN RAISE EXCEPTION 'pt_actiune: actiune invalida'; END IF;

  IF p_actiune<>'opreste_utilaj' THEN
    v_p:=(p_date->>'presiune')::numeric;
    IF v_p IS NULL OR v_p<0 OR v_p::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'pt_presiune: presiune invalida'; END IF;
    SELECT max(ora_citire) INTO v_ultima FROM public.probe_log_executie WHERE calc_id=p_calc_id;
    IF v_ultima>now() THEN RAISE EXCEPTION 'pt_timp: tranzactie veche; reincercati'; END IF;
    IF p_actiune='citire' AND now()-v_ultima<interval '6 hours' THEN RAISE EXCEPTION 'pt_citire_devreme: urmatoarea citire dupa minimum 6 ore'; END IF;
    v_intarziata:=coalesce(now()-v_ultima>interval '8 hours',false);
    IF p_actiune='inchide' AND (p_date->>'rezultat' IS NULL OR p_date->>'rezultat' NOT IN ('admis','respins')) THEN RAISE EXCEPTION 'pt_rezultat: admis sau respins obligatoriu'; END IF;
    v_items:=p_date->'utilaje';
  ELSE
    IF p_date->>'motiv' IS NULL OR p_date->>'motiv' NOT IN ('terminat','defect','inlocuit','altul') THEN RAISE EXCEPTION 'pt_motiv: motiv oprire obligatoriu'; END IF;
    IF p_date->>'motiv'='altul' AND coalesce(btrim(p_date->>'observatii'),'')='' THEN RAISE EXCEPTION 'pt_motiv: explicati motivul altul'; END IF;
    v_items:=jsonb_build_array(jsonb_build_object('active_id',p_date->'active_id','ore_bord',p_date->'ore_bord','poza_path',p_date->'poza',
      'confirma_salt',p_date->'confirma_salt','motiv_salt',p_date->'motiv_salt'));
  END IF;
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'pt_utilaje: lista utilaje obligatorie'; END IF;
  IF jsonb_array_length(v_items)>100 OR (p_actiune='porneste' AND jsonb_array_length(v_items)=0) THEN RAISE EXCEPTION 'pt_utilaje: intre 1 si 100 utilaje la pornire'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR x->>'active_id' IS NULL)
    OR (SELECT count(*)<>count(DISTINCT x->>'active_id') FROM jsonb_array_elements(v_items) x) THEN RAISE EXCEPTION 'pt_utilaje: utilaj lipsa sau duplicat'; END IF;
  IF p_actiune IN ('citire','inchide') AND (
    EXISTS(SELECT 1 FROM public.probe_exec_utilaje a WHERE a.calc_id=p_calc_id AND a.ora_stop IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) x WHERE (x->>'active_id')::bigint=a.active_id)) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) x WHERE NOT EXISTS(SELECT 1 FROM public.probe_exec_utilaje a WHERE a.calc_id=p_calc_id AND a.ora_stop IS NULL AND a.active_id=(x->>'active_id')::bigint)))
    THEN RAISE EXCEPTION 'pt_utilaje: lista trebuie sa contina exact utilajele active'; END IF;

  IF p_actiune<>'opreste_utilaj' THEN
    PERFORM public.probe_teren_poza(p_calc_id,p_date->>'poza_manometru',p_cheie);
    INSERT INTO public.probe_log_executie(calc_id,ora_citire,presiune_citita_bar,poza_manometru_path,intarziata,cheie,creat_de,operator_id,observatii)
      VALUES(p_calc_id,now(),v_p,p_date->>'poza_manometru',v_intarziata,p_cheie,auth.uid(),auth.uid(),p_date->>'observatii') RETURNING id INTO v_log;
  END IF;
  FOR u IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_id:=(u->>'active_id')::bigint;
    PERFORM public.probe_teren_poza(p_calc_id,u->>'poza_path',p_cheie);
    PERFORM public.probe_teren_bord(v_id,(u->>'ore_bord')::numeric,
      coalesce((u->>'confirma_salt')::boolean,(p_date->>'confirma_salt')::boolean,false),coalesce(u->>'motiv_salt',p_date->>'motiv_salt'));
    IF p_actiune='porneste' THEN
      IF u->>'rol' IS NULL OR u->>'rol' NOT IN ('compresor','booster','pompa') THEN RAISE EXCEPTION 'pt_rol: rol utilaj invalid'; END IF;
      IF EXISTS(SELECT 1 FROM public.probe_exec_utilaje WHERE active_id=v_id AND ora_stop IS NULL) THEN RAISE EXCEPTION 'pt_utilaj_ocupat: utilaj deja activ'; END IF;
      INSERT INTO public.probe_exec_utilaje(calc_id,active_id,rol,ore_bord_start,poza_start_path,creat_de)
        VALUES(p_calc_id,v_id,u->>'rol',(u->>'ore_bord')::numeric,u->>'poza_path',auth.uid());
    ELSIF p_actiune IN ('opreste_utilaj','inchide') THEN
      SELECT * INTO e FROM public.probe_exec_utilaje WHERE calc_id=p_calc_id AND active_id=v_id AND ora_stop IS NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'pt_utilaj: utilajul nu este activ in aceasta proba'; END IF;
      UPDATE public.probe_exec_utilaje SET ora_stop=now(),ore_bord_stop=(u->>'ore_bord')::numeric,poza_stop_path=u->>'poza_path',
        motiv_oprire=CASE WHEN p_actiune='inchide' THEN 'terminat' ELSE p_date->>'motiv' END,observatii=p_date->>'observatii' WHERE id=e.id;
    END IF;
    IF v_log IS NOT NULL THEN
      INSERT INTO public.probe_log_utilaje(log_id,active_id,ore_bord,poza_path) VALUES(v_log,v_id,(u->>'ore_bord')::numeric,u->>'poza_path');
    END IF;
  END LOOP;

  IF p_actiune='opreste_utilaj' AND p_date->'inlocuitor' IS NOT NULL AND p_date->'inlocuitor'<>'null'::jsonb THEN
    u:=p_date->'inlocuitor';
    IF jsonb_typeof(u) IS DISTINCT FROM 'object' OR u->>'active_id' IS NULL OR u->>'rol' IS NULL OR u->>'rol' NOT IN ('compresor','booster','pompa') THEN RAISE EXCEPTION 'pt_inlocuitor: date invalide'; END IF;
    v_id:=(u->>'active_id')::bigint;
    IF v_id=e.active_id OR EXISTS(SELECT 1 FROM public.probe_exec_utilaje WHERE active_id=v_id AND ora_stop IS NULL) THEN RAISE EXCEPTION 'pt_inlocuitor: utilaj identic sau ocupat'; END IF;
    PERFORM public.probe_teren_poza(p_calc_id,u->>'poza_path',p_cheie);
    PERFORM public.probe_teren_bord(v_id,(u->>'ore_bord')::numeric,coalesce((u->>'confirma_salt')::boolean,false),u->>'motiv_salt');
    INSERT INTO public.probe_exec_utilaje(calc_id,active_id,rol,ore_bord_start,poza_start_path,creat_de)
      VALUES(p_calc_id,v_id,u->>'rol',(u->>'ore_bord')::numeric,u->>'poza_path',auth.uid()) RETURNING id INTO v_nou;
    UPDATE public.probe_exec_utilaje SET inlocuit_prin=v_nou WHERE id=e.id;
  END IF;
  IF p_actiune='porneste' THEN
    UPDATE public.probe_calcule SET status='in_executie',ora_start=now(),data_executie=(now() AT TIME ZONE 'Europe/Bucharest')::date,presiune_initiala_bar=v_p WHERE id=p_calc_id;
  ELSIF p_actiune='inchide' THEN
    -- Revalidam TOATE dovezile, inclusiv citirile si utilajele oprite anterior.
    FOR u IN SELECT jsonb_build_object('path',p) FROM (
      SELECT poza_start_path p FROM public.probe_exec_utilaje WHERE calc_id=p_calc_id
      UNION ALL SELECT poza_stop_path FROM public.probe_exec_utilaje WHERE calc_id=p_calc_id
      UNION ALL SELECT poza_manometru_path FROM public.probe_log_executie WHERE calc_id=p_calc_id
      UNION ALL SELECT lu.poza_path FROM public.probe_log_utilaje lu JOIN public.probe_log_executie l ON l.id=lu.log_id WHERE l.calc_id=p_calc_id
    ) poze WHERE p IS NOT NULL LOOP PERFORM public.probe_teren_poza(p_calc_id,u->>'path'); END LOOP;
    IF NOT EXISTS(SELECT 1 FROM public.probe_exec_utilaje WHERE calc_id=p_calc_id) OR EXISTS(SELECT 1 FROM public.probe_exec_utilaje WHERE calc_id=p_calc_id AND (ora_stop IS NULL OR ore_bord_stop IS NULL)) THEN RAISE EXCEPTION 'pt_inchidere: exista utilaje neoprite sau lipsesc intervalele'; END IF;
    UPDATE public.probe_calcule SET status=CASE WHEN p_date->>'rezultat'='admis' THEN 'finalizata' ELSE 'respinsa' END,
      ora_stop=now(),presiune_finala_bar=v_p,durata_reala_h=extract(epoch FROM now()-c.ora_start)/3600 WHERE id=p_calc_id;
  END IF;
  v_rez:=jsonb_build_object('ok',true,'calc_id',p_calc_id,'log_id',v_log,'inlocuitor_interval_id',v_nou,'intarziata',v_intarziata,'ora_server',now());
  INSERT INTO public.probe_teren_operatii(cheie,calc_id,actiune,continut,rezultat,creat_de) VALUES(p_cheie,p_calc_id,p_actiune,p_date,v_rez,auth.uid());
  RETURN v_rez;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
    RAISE EXCEPTION 'pt_date: date JSON invalide; verificati id, ore de bord si confirmarea';
END $pt_scrie_legacy_20261115a$;
CREATE OR REPLACE FUNCTION public.probe_teren_bord(p_id bigint,p_ore numeric,p_confirma boolean,p_motiv text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $pt_bord_20261115a$
DECLARE v_ore numeric; v_t timestamptz; v_baza numeric; v_salt numeric;
BEGIN
  IF p_ore IS NULL OR p_ore<0 OR p_ore::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'pt_bord: ore de bord invalide'; END IF;
  SELECT ore_functionare_actuale INTO v_baza FROM public.logistica_active WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'pt_utilaj: utilaj inexistent'; END IF;
  SELECT h.ore,h.t INTO v_ore,v_t FROM (
    SELECT ore_bord_start ore,ora_start t FROM public.probe_exec_utilaje WHERE active_id=p_id
    UNION ALL SELECT ore_bord_stop,ora_stop FROM public.probe_exec_utilaje WHERE active_id=p_id AND ora_stop IS NOT NULL
    UNION ALL SELECT u.ore_bord,l.ora_citire FROM public.probe_log_utilaje u JOIN public.probe_log_executie l ON l.id=u.log_id WHERE u.active_id=p_id
  ) h WHERE h.ore IS NOT NULL ORDER BY h.t DESC,h.ore DESC LIMIT 1;
  IF v_t>now() THEN RAISE EXCEPTION 'pt_timp: tranzactie anterioara ultimei citiri; reincercati'; END IF;
  -- Contorul din catalog este reper doar pana la prima citire de teren; nu ii inventam o data.
  IF v_ore IS NULL THEN v_ore:=v_baza; END IF;
  IF p_ore<v_ore THEN RAISE EXCEPTION 'pt_bord_scade: ora de bord nu poate scadea fata de %',v_ore; END IF;
  v_salt:=p_ore-v_ore;
  IF (v_salt>24 OR (v_t IS NOT NULL AND v_salt>2*extract(epoch FROM now()-v_t)/3600+4))
    AND (p_confirma IS DISTINCT FROM true OR coalesce(btrim(p_motiv),'')='') THEN
    RAISE EXCEPTION 'pt_bord_salt: salt mare; confirmare explicita si motiv obligatorii';
  END IF;
END $pt_bord_20261115a$;
CREATE OR REPLACE FUNCTION public.probe_teren_scrie(p_actiune text,p_calc_id bigint,p_date jsonb,p_cheie text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $pt_scrie_20261115a$
DECLARE c public.probe_calcule%ROWTYPE; op public.probe_teren_operatii%ROWTYPE;
  u jsonb; v_items jsonb; e public.probe_exec_utilaje%ROWTYPE;
  v_id bigint; v_log bigint; v_nou bigint; v_ultima timestamptz; v_intarziata boolean:=false;
  v_p numeric; v_rez jsonb; v_faza text; v_faze text[]; v_apa boolean; v_umplere boolean;
BEGIN
  IF NOT public.probe_teren_drept(true) THEN RAISE EXCEPTION 'pt_acces: drept explicit de scriere probe_teren necesar' USING ERRCODE='42501'; END IF;
  IF p_cheie IS NULL OR length(btrim(p_cheie)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'pt_cheie: cheie obligatorie, maxim 200 caractere'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('probe_teren_scriere'));
  SELECT * INTO op FROM public.probe_teren_operatii WHERE cheie=p_cheie;
  IF FOUND THEN
    IF op.calc_id IS DISTINCT FROM p_calc_id OR op.actiune IS DISTINCT FROM p_actiune OR op.continut IS DISTINCT FROM p_date OR op.creat_de IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'pt_cheie_conflict: cheia exista cu alt continut sau autor';
    END IF;
    RETURN op.rezultat;
  END IF;
  SELECT * INTO c FROM public.probe_calcule WHERE id=p_calc_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pt_proba: proba inexistenta'; END IF;
  IF p_actiune='completeaza_executie' OR (c.faza_curenta IS NULL AND p_actiune NOT IN ('porneste','schimba_faza')) THEN
    RETURN public.probe_teren_scrie_e1(p_actiune,p_calc_id,p_date,p_cheie);
  END IF;
  IF c.tip_fluid IS NULL OR c.tip_fluid NOT IN ('aer','apa') THEN RAISE EXCEPTION 'pt_faza_tip: tip fluid invalid'; END IF;
  IF c.faza_curenta IS NULL AND p_actiune='schimba_faza' THEN RAISE EXCEPTION 'pt_faza_legacy: executie E1 fara faze'; END IF;
  v_apa:=c.tip_fluid='apa';
  v_faze:=CASE WHEN v_apa THEN ARRAY['umplere','presurizare'] ELSE ARRAY['pistonare','uscare','calibrare','proba'] END;
  v_faza:=CASE WHEN p_actiune='porneste' THEN v_faze[1] ELSE c.faza_curenta END;
  -- La respingerea din umplere dovezile manometrului sunt optionale.
  v_umplere:=v_apa AND (p_actiune='porneste' OR
    (p_actiune='inchide' AND c.faza_curenta='umplere' AND p_date->>'rezultat'='respins'));
  IF c.beneficiar_tip IS NULL THEN RAISE EXCEPTION 'pt_beneficiar: completati beneficiarul probei istorice'; END IF;
  -- Referinta poate disparea dupa creare; pornirea revalideaza.
  IF p_actiune='porneste' AND c.beneficiar_tip='tert' AND c.tert_ref_tip IN ('oferta','contract')
    AND NOT public.probe_teren_referinta_exista(c.tert_ref_tip,c.tert_ref_id) THEN
    RAISE EXCEPTION 'pt_beneficiar: referinta inexistenta sau lipsa drept probe_teren';
  END IF;
  IF (p_actiune='porneste' AND c.status IS DISTINCT FROM 'planificata') OR
     (p_actiune<>'porneste' AND c.status IS DISTINCT FROM 'in_executie') THEN RAISE EXCEPTION 'pt_status: tranzitie de status nepermisa'; END IF;
  IF p_actiune NOT IN ('porneste','citire','opreste_utilaj','inchide','schimba_faza') THEN RAISE EXCEPTION 'pt_actiune: actiune invalida'; END IF;

  IF p_actiune='schimba_faza' THEN
    IF p_date->>'faza_noua' IS DISTINCT FROM v_faze[array_position(v_faze,c.faza_curenta)+1] OR p_date->>'faza_noua' IS NULL THEN
      RAISE EXCEPTION 'pt_faza_tranzitie: numai faza imediat urmatoare este permisa';
    END IF;
    v_faza:=p_date->>'faza_noua';
  END IF;
  IF p_actiune='inchide' AND (p_date->>'rezultat' IS NULL OR p_date->>'rezultat' NOT IN ('admis','respins')) THEN RAISE EXCEPTION 'pt_rezultat: admis sau respins obligatoriu'; END IF;
  IF v_umplere AND p_actiune='inchide' AND coalesce(btrim(p_date->>'observatii'),'')='' THEN
    RAISE EXCEPTION 'pt_hidraulic_motiv: explicati respingerea din umplere';
  END IF;
  IF v_apa AND (p_actiune='citire' OR (p_actiune='inchide' AND p_date->>'rezultat'='admis')) AND c.faza_curenta<>'presurizare' THEN
    RAISE EXCEPTION 'pt_hidraulic_faza: citiri numai in presurizare';
  END IF;
  IF NOT v_apa AND p_actiune='inchide' AND p_date->>'rezultat'='admis' AND c.faza_curenta<>'proba' THEN
    RAISE EXCEPTION 'pt_faza_admis: admis numai din proba';
  END IF;
  IF v_apa AND p_actiune='citire' AND EXISTS(SELECT 1 FROM public.probe_log_executie WHERE calc_id=p_calc_id AND faza='presurizare' AND NOT limita_faza) THEN
    RAISE EXCEPTION 'pt_hidraulic_numar: exista deja citirea intermediara';
  END IF;
  IF v_apa AND p_actiune='inchide' AND p_date->>'rezultat'='admis' AND
    ((SELECT count(*) FROM public.probe_log_executie WHERE calc_id=p_calc_id AND faza='presurizare' AND limita_faza AND poza_manometru_path IS NOT NULL)<>1 OR
     (SELECT count(*) FROM public.probe_log_executie WHERE calc_id=p_calc_id AND faza='presurizare' AND NOT limita_faza AND poza_manometru_path IS NOT NULL)<>1) THEN
    RAISE EXCEPTION 'pt_hidraulic_citiri: inceput si o citire intermediara cu poza necesare inainte de final';
  END IF;
  IF v_apa AND NOT v_umplere AND p_actiune<>'opreste_utilaj' AND coalesce(btrim(p_date->>'poza_manometru'),'')='' THEN
    RAISE EXCEPTION 'pt_hidraulic_poza: poza manometru obligatorie';
  END IF;
  IF p_actiune<>'opreste_utilaj' AND NOT v_umplere THEN
    v_p:=(p_date->>'presiune')::numeric;
    IF v_p IS NULL OR v_p<0 OR v_p::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'pt_presiune: presiune invalida'; END IF;
    SELECT max(ora_citire) INTO v_ultima FROM public.probe_log_executie WHERE calc_id=p_calc_id;
    IF v_ultima>now() THEN RAISE EXCEPTION 'pt_timp: tranzactie veche; reincercati'; END IF;
    IF p_actiune='citire' AND NOT v_apa AND c.faza_curenta='proba' AND now()-v_ultima<interval '6 hours' THEN RAISE EXCEPTION 'pt_citire_devreme: urmatoarea citire dupa minimum 6 ore'; END IF;
    v_intarziata:=NOT v_apa AND c.faza_curenta='proba' AND p_actiune IN ('citire','inchide') AND coalesce(now()-v_ultima>interval '8 hours',false);
    v_items:=p_date->'utilaje';
  ELSIF p_actiune='opreste_utilaj' THEN
    IF p_date->>'motiv' IS NULL OR p_date->>'motiv' NOT IN ('terminat','defect','inlocuit','altul') THEN RAISE EXCEPTION 'pt_motiv: motiv oprire obligatoriu'; END IF;
    IF p_date->>'motiv'='altul' AND coalesce(btrim(p_date->>'observatii'),'')='' THEN RAISE EXCEPTION 'pt_motiv: explicati motivul altul'; END IF;
    v_items:=jsonb_build_array(jsonb_build_object('active_id',p_date->'active_id','ore_bord',p_date->'ore_bord','poza_path',p_date->'poza',
      'confirma_salt',p_date->'confirma_salt','motiv_salt',p_date->'motiv_salt'));
  END IF;
  IF v_umplere THEN
    v_items:=p_date->'utilaje';
    IF p_actiune='inchide' THEN
      v_p:=(p_date->>'presiune')::numeric;
      IF v_p<0 OR v_p::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'pt_presiune: presiune invalida'; END IF;
    END IF;
  END IF;
  IF v_apa AND (v_items IS NULL OR v_items='null'::jsonb) THEN v_items:='[]'::jsonb; END IF;
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'pt_utilaje: lista utilaje obligatorie'; END IF;
  IF jsonb_array_length(v_items)>100 OR (NOT v_apa AND p_actiune='porneste' AND jsonb_array_length(v_items)=0) THEN RAISE EXCEPTION 'pt_utilaje: intre 1 si 100 utilaje la pornire'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR x->>'active_id' IS NULL)
    OR (SELECT count(*)<>count(DISTINCT x->>'active_id') FROM jsonb_array_elements(v_items) x) THEN RAISE EXCEPTION 'pt_utilaje: utilaj lipsa sau duplicat'; END IF;
  IF NOT v_apa AND p_actiune IN ('citire','inchide','schimba_faza') AND (
    EXISTS(SELECT 1 FROM public.probe_exec_utilaje a WHERE a.calc_id=p_calc_id AND a.ora_stop IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) x WHERE (x->>'active_id')::bigint=a.active_id)) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) x WHERE NOT EXISTS(SELECT 1 FROM public.probe_exec_utilaje a WHERE a.calc_id=p_calc_id AND a.ora_stop IS NULL AND a.active_id=(x->>'active_id')::bigint)))
    THEN RAISE EXCEPTION 'pt_utilaje: lista trebuie sa contina exact utilajele active'; END IF;

  IF v_apa AND p_actiune IN ('citire','schimba_faza','inchide') AND EXISTS(
    SELECT 1 FROM jsonb_array_elements(v_items) x WHERE NOT EXISTS(
      SELECT 1 FROM public.probe_exec_utilaje a WHERE a.calc_id=p_calc_id AND a.ora_stop IS NULL AND a.active_id=(x->>'active_id')::bigint)) THEN
    RAISE EXCEPTION 'pt_hidraulic_utilaje: lista optionala contine utilaje inactive';
  END IF;
  IF p_actiune<>'opreste_utilaj' AND (NOT v_umplere OR
      (p_actiune='inchide' AND (v_p IS NOT NULL OR p_date->>'poza_manometru' IS NOT NULL))) THEN
    IF NOT v_umplere OR p_date->>'poza_manometru' IS NOT NULL THEN
      PERFORM public.probe_teren_poza(p_calc_id,p_date->>'poza_manometru',p_cheie);
    END IF;
    INSERT INTO public.probe_log_executie(calc_id,ora_citire,presiune_citita_bar,poza_manometru_path,intarziata,cheie,creat_de,operator_id,observatii,faza,limita_faza)
      VALUES(p_calc_id,now(),v_p,p_date->>'poza_manometru',v_intarziata,p_cheie,auth.uid(),auth.uid(),p_date->>'observatii',v_faza,p_actiune IN ('porneste','schimba_faza','inchide')) RETURNING id INTO v_log;
  END IF;
  FOR u IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_id:=(u->>'active_id')::bigint;
    IF NOT v_apa THEN
    PERFORM public.probe_teren_poza(p_calc_id,u->>'poza_path',p_cheie);
    PERFORM public.probe_teren_bord(v_id,(u->>'ore_bord')::numeric,
      coalesce((u->>'confirma_salt')::boolean,(p_date->>'confirma_salt')::boolean,false),coalesce(u->>'motiv_salt',p_date->>'motiv_salt'));
    ELSE
      IF u->>'poza_path' IS NOT NULL THEN PERFORM public.probe_teren_poza(p_calc_id,u->>'poza_path',p_cheie); END IF;
      IF u->>'ore_bord' IS NOT NULL THEN PERFORM public.probe_teren_bord(v_id,(u->>'ore_bord')::numeric,
        coalesce((u->>'confirma_salt')::boolean,(p_date->>'confirma_salt')::boolean,false),coalesce(u->>'motiv_salt',p_date->>'motiv_salt')); END IF;
      IF NOT EXISTS(SELECT 1 FROM public.logistica_active WHERE id=v_id) THEN RAISE EXCEPTION 'pt_utilaj: utilaj inexistent'; END IF;
    END IF;
    IF p_actiune='porneste' THEN
      IF u->>'rol' IS NULL OR u->>'rol' NOT IN ('compresor','booster','pompa') THEN RAISE EXCEPTION 'pt_rol: rol utilaj invalid'; END IF;
      IF EXISTS(SELECT 1 FROM public.probe_exec_utilaje WHERE active_id=v_id AND ora_stop IS NULL) THEN RAISE EXCEPTION 'pt_utilaj_ocupat: utilaj deja activ'; END IF;
      INSERT INTO public.probe_exec_utilaje(calc_id,active_id,rol,ore_bord_start,poza_start_path,creat_de,faza_start)
        VALUES(p_calc_id,v_id,u->>'rol',(u->>'ore_bord')::numeric,u->>'poza_path',auth.uid(),v_faza);
    ELSIF p_actiune IN ('opreste_utilaj','inchide') THEN
      SELECT * INTO e FROM public.probe_exec_utilaje WHERE calc_id=p_calc_id AND active_id=v_id AND ora_stop IS NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'pt_utilaj: utilajul nu este activ in aceasta proba'; END IF;
      UPDATE public.probe_exec_utilaje SET ora_stop=now(),ore_bord_stop=(u->>'ore_bord')::numeric,poza_stop_path=u->>'poza_path',
        motiv_oprire=CASE WHEN p_actiune='inchide' THEN 'terminat' ELSE p_date->>'motiv' END,observatii=p_date->>'observatii',faza_stop=v_faza WHERE id=e.id;
    END IF;
    IF v_log IS NOT NULL AND (NOT v_apa OR (u->>'ore_bord' IS NOT NULL AND u->>'poza_path' IS NOT NULL)) THEN
      INSERT INTO public.probe_log_utilaje(log_id,active_id,ore_bord,poza_path) VALUES(v_log,v_id,(u->>'ore_bord')::numeric,u->>'poza_path');
    END IF;
  END LOOP;

  IF p_actiune='opreste_utilaj' AND p_date->'inlocuitor' IS NOT NULL AND p_date->'inlocuitor'<>'null'::jsonb THEN
    u:=p_date->'inlocuitor';
    IF jsonb_typeof(u) IS DISTINCT FROM 'object' OR u->>'active_id' IS NULL OR u->>'rol' IS NULL OR u->>'rol' NOT IN ('compresor','booster','pompa') THEN RAISE EXCEPTION 'pt_inlocuitor: date invalide'; END IF;
    v_id:=(u->>'active_id')::bigint;
    IF v_id=e.active_id OR EXISTS(SELECT 1 FROM public.probe_exec_utilaje WHERE active_id=v_id AND ora_stop IS NULL) THEN RAISE EXCEPTION 'pt_inlocuitor: utilaj identic sau ocupat'; END IF;
    IF NOT v_apa THEN
    PERFORM public.probe_teren_poza(p_calc_id,u->>'poza_path',p_cheie);
    PERFORM public.probe_teren_bord(v_id,(u->>'ore_bord')::numeric,coalesce((u->>'confirma_salt')::boolean,false),u->>'motiv_salt');
    ELSE
      IF u->>'poza_path' IS NOT NULL THEN PERFORM public.probe_teren_poza(p_calc_id,u->>'poza_path',p_cheie); END IF;
      IF u->>'ore_bord' IS NOT NULL THEN PERFORM public.probe_teren_bord(v_id,(u->>'ore_bord')::numeric,
        coalesce((u->>'confirma_salt')::boolean,(p_date->>'confirma_salt')::boolean,false),coalesce(u->>'motiv_salt',p_date->>'motiv_salt')); END IF;
    END IF;
    INSERT INTO public.probe_exec_utilaje(calc_id,active_id,rol,ore_bord_start,poza_start_path,creat_de,faza_start)
      VALUES(p_calc_id,v_id,u->>'rol',(u->>'ore_bord')::numeric,u->>'poza_path',auth.uid(),v_faza) RETURNING id INTO v_nou;
    UPDATE public.probe_exec_utilaje SET inlocuit_prin=v_nou WHERE id=e.id;
  END IF;
  IF p_actiune='porneste' THEN
    UPDATE public.probe_calcule SET status='in_executie',ora_start=now(),data_executie=(now() AT TIME ZONE 'Europe/Bucharest')::date,presiune_initiala_bar=v_p,faza_curenta=v_faza WHERE id=p_calc_id;
  ELSIF p_actiune='schimba_faza' THEN
    UPDATE public.probe_calcule SET faza_curenta=v_faza,
      presiune_initiala_bar=CASE WHEN v_apa THEN v_p ELSE presiune_initiala_bar END WHERE id=p_calc_id;
  ELSIF p_actiune='inchide' THEN
    IF v_apa THEN
      UPDATE public.probe_exec_utilaje SET ora_stop=now(),motiv_oprire='terminat',faza_stop=v_faza WHERE calc_id=p_calc_id AND ora_stop IS NULL;
    END IF;
    -- Revalidam TOATE dovezile, inclusiv citirile si utilajele oprite anterior.
    FOR u IN SELECT jsonb_build_object('path',p) FROM (
      SELECT poza_path p FROM public.probe_teren_poze WHERE calc_id=p_calc_id
      UNION ALL SELECT poza_start_path FROM public.probe_exec_utilaje WHERE calc_id=p_calc_id
      UNION ALL SELECT poza_stop_path FROM public.probe_exec_utilaje WHERE calc_id=p_calc_id
      UNION ALL SELECT poza_manometru_path FROM public.probe_log_executie WHERE calc_id=p_calc_id
      UNION ALL SELECT lu.poza_path FROM public.probe_log_utilaje lu JOIN public.probe_log_executie l ON l.id=lu.log_id WHERE l.calc_id=p_calc_id
    ) poze WHERE p IS NOT NULL LOOP PERFORM public.probe_teren_poza(p_calc_id,u->>'path'); END LOOP;
    IF NOT v_apa AND (NOT EXISTS(SELECT 1 FROM public.probe_exec_utilaje WHERE calc_id=p_calc_id) OR EXISTS(SELECT 1 FROM public.probe_exec_utilaje WHERE calc_id=p_calc_id AND (ora_stop IS NULL OR ore_bord_stop IS NULL))) THEN RAISE EXCEPTION 'pt_inchidere: exista utilaje neoprite sau lipsesc intervalele'; END IF;
    UPDATE public.probe_calcule SET status=CASE WHEN p_date->>'rezultat'='admis' THEN 'finalizata' ELSE 'respinsa' END,
      ora_stop=now(),presiune_finala_bar=v_p,durata_reala_h=extract(epoch FROM now()-c.ora_start)/3600 WHERE id=p_calc_id;
  END IF;
  v_rez:=jsonb_build_object('ok',true,'calc_id',p_calc_id,'log_id',v_log,'inlocuitor_interval_id',v_nou,'intarziata',v_intarziata,'ora_server',now());
  INSERT INTO public.probe_teren_operatii(cheie,calc_id,actiune,continut,rezultat,creat_de) VALUES(p_cheie,p_calc_id,p_actiune,p_date,v_rez,auth.uid());
  RETURN v_rez;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
    RAISE EXCEPTION 'pt_date: date JSON invalide; verificati id, ore de bord si confirmarea';
END $pt_scrie_20261115a$;
CREATE OR REPLACE FUNCTION public.probe_teren_protejeaza() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $pt_protejeaza_20261115a$
BEGIN
  IF TG_TABLE_NAME='probe_calcule' THEN
    IF TG_OP='INSERT' THEN
      IF NEW.beneficiar_tip IS NULL AND NEW.proiect_id IS NOT NULL THEN NEW.beneficiar_tip:='gazpet'; END IF;
    END IF;
    IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND
      ROW(NEW.beneficiar_tip,NEW.proiect_id,NEW.tert_ref_tip,NEW.tert_ref_id,NEW.tert_ref_text,NEW.tert_client)
      IS DISTINCT FROM ROW(OLD.beneficiar_tip,OLD.proiect_id,OLD.tert_ref_tip,OLD.tert_ref_id,OLD.tert_ref_text,OLD.tert_client)) THEN
      IF NEW.beneficiar_tip='tert' AND NEW.tert_ref_tip IN ('oferta','contract') AND NOT public.probe_teren_referinta_exista(NEW.tert_ref_tip,NEW.tert_ref_id) THEN
        RAISE EXCEPTION 'pt_beneficiar: referinta inexistenta sau lipsa drept probe_teren';
      END IF;
    END IF;
    IF current_user <> (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.probe_teren_scrie(text,bigint,jsonb,text)'::regprocedure) THEN
      IF TG_OP='INSERT' THEN
        IF NEW.faza_curenta IS NOT NULL OR NEW.creat_din_teren OR NEW.status IS DISTINCT FROM 'planificata' OR NEW.ora_start IS NOT NULL OR NEW.ora_stop IS NOT NULL
          OR NEW.data_executie IS NOT NULL OR NEW.durata_reala_h IS NOT NULL OR NEW.presiune_initiala_bar IS NOT NULL
          OR NEW.presiune_finala_bar IS NOT NULL OR NEW.temperatura_c IS NOT NULL OR NEW.config_real_id IS NOT NULL
          OR NEW.operator_nume IS NOT NULL OR NEW.responsabil_nume IS NOT NULL
          OR NEW.pv_path IS NOT NULL OR NEW.pv_generat_la IS NOT NULL OR NEW.aep_diagrama_path IS NOT NULL THEN RAISE EXCEPTION 'pt_rpc: executia se scrie numai prin RPC'; END IF;
      ELSIF TG_OP='DELETE' THEN
        IF OLD.status<>'planificata' THEN RAISE EXCEPTION 'pt_rpc: executia nu se sterge'; END IF;
        RETURN OLD;
      ELSE
        -- Executia si documentele se scriu numai prin writer-ul RPC.
        -- Observatii si updated_at raman editabile direct.
        IF ROW(NEW.faza_curenta,NEW.creat_din_teren,NEW.status,NEW.ora_start,NEW.ora_stop,NEW.data_executie,NEW.durata_reala_h,NEW.presiune_initiala_bar,NEW.presiune_finala_bar,NEW.temperatura_c,NEW.config_real_id,NEW.operator_nume,NEW.responsabil_nume,NEW.pv_path,NEW.pv_generat_la,NEW.aep_diagrama_path)
          IS DISTINCT FROM ROW(OLD.faza_curenta,OLD.creat_din_teren,OLD.status,OLD.ora_start,OLD.ora_stop,OLD.data_executie,OLD.durata_reala_h,OLD.presiune_initiala_bar,OLD.presiune_finala_bar,OLD.temperatura_c,OLD.config_real_id,OLD.operator_nume,OLD.responsabil_nume,OLD.pv_path,OLD.pv_generat_la,OLD.aep_diagrama_path)
          THEN RAISE EXCEPTION 'pt_rpc: executia se scrie numai prin RPC'; END IF;
        IF OLD.status<>'planificata' AND ROW(NEW.beneficiar_tip,NEW.proiect_id,NEW.tert_ref_tip,NEW.tert_ref_id,NEW.tert_ref_text,NEW.tert_client)
          IS DISTINCT FROM ROW(OLD.beneficiar_tip,OLD.proiect_id,OLD.tert_ref_tip,OLD.tert_ref_id,OLD.tert_ref_text,OLD.tert_client)
          THEN RAISE EXCEPTION 'pt_beneficiar: beneficiar blocat dupa pornire'; END IF;
      END IF;
    END IF;
  ELSE
    IF current_user <> (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.probe_teren_scrie(text,bigint,jsonb,text)'::regprocedure) THEN
      RAISE EXCEPTION 'pt_rpc: jurnal append-only, scriere numai prin RPC' USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $pt_protejeaza_20261115a$;

-- Trigger separat: paritate tip/faza inclusiv la scriere SQL de catre proprietar.
CREATE FUNCTION public.probe_teren_faze_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $pt2_faze_guard_20261115a$
DECLARE fluid text; faze text[]; poz integer; poz_stop integer;
BEGIN
  IF TG_TABLE_NAME='probe_calcule' THEN
    IF TG_OP='UPDATE' THEN
      IF OLD.status<>'planificata' AND NEW.tip_fluid IS DISTINCT FROM OLD.tip_fluid THEN RAISE EXCEPTION 'pt_faza_tip: tip blocat dupa pornire'; END IF;
      IF OLD.faza_curenta IS NOT NULL AND NEW.faza_curenta IS DISTINCT FROM OLD.faza_curenta THEN
        faze:=CASE WHEN OLD.tip_fluid='apa' THEN ARRAY['umplere','presurizare'] ELSE ARRAY['pistonare','uscare','calibrare','proba'] END;
        IF NEW.faza_curenta IS DISTINCT FROM faze[array_position(faze,OLD.faza_curenta)+1] OR NEW.faza_curenta IS NULL THEN RAISE EXCEPTION 'pt_faza_tranzitie: numai urmatoarea faza'; END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  SELECT tip_fluid INTO fluid FROM public.probe_calcule WHERE id=NEW.calc_id;
  faze:=CASE WHEN fluid='apa' THEN ARRAY['umplere','presurizare'] ELSE ARRAY['pistonare','uscare','calibrare','proba'] END;
  IF TG_TABLE_NAME='probe_log_executie' THEN
    IF NEW.faza IS NOT NULL AND (fluid IS NULL OR NOT NEW.faza=ANY(faze)) THEN RAISE EXCEPTION 'pt_faza_tip: faza citirii nu apartine tipului'; END IF;
  ELSE
    IF NEW.faza_start IS NOT NULL THEN
      poz:=array_position(faze,NEW.faza_start); poz_stop:=array_position(faze,NEW.faza_stop);
      IF fluid IS NULL OR poz IS NULL OR (NEW.faza_stop IS NOT NULL AND (poz_stop IS NULL OR poz_stop<poz)) THEN RAISE EXCEPTION 'pt_faza_utilaj: interval faze invalid'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $pt2_faze_guard_20261115a$;
CREATE TRIGGER probe_calc_faze_guard BEFORE INSERT OR UPDATE ON public.probe_calcule FOR EACH ROW EXECUTE FUNCTION public.probe_teren_faze_guard();
CREATE TRIGGER probe_log_faze_guard BEFORE INSERT OR UPDATE ON public.probe_log_executie FOR EACH ROW EXECUTE FUNCTION public.probe_teren_faze_guard();
CREATE TRIGGER probe_exec_faze_guard BEFORE INSERT OR UPDATE ON public.probe_exec_utilaje FOR EACH ROW EXECUTE FUNCTION public.probe_teren_faze_guard();

CREATE FUNCTION public.fn_probe_schimba_faza(p_calc_id bigint,p_faza_noua text,p_presiune_bar numeric,p_poza_manometru text,p_utilaje jsonb,p_observatii text,p_confirma_salt boolean,p_motiv_salt text,p_cheie text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $pt2_schimba_20261115a$
 SELECT public.probe_teren_scrie('schimba_faza',p_calc_id,jsonb_build_object('faza_noua',p_faza_noua,'presiune',p_presiune_bar,
 'poza_manometru',p_poza_manometru,'utilaje',p_utilaje,'observatii',p_observatii,'confirma_salt',p_confirma_salt,'motiv_salt',p_motiv_salt),p_cheie);
$pt2_schimba_20261115a$;

CREATE FUNCTION public.fn_probe_creeaza_teren(p_proiect_id bigint,p_tronson_id bigint,p_tip_fluid text,p_beneficiar_tip text,p_tert_ref_tip text,p_tert_ref_id bigint,p_tert_ref_text text,p_tert_client text,p_cheie text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $pt2_creeaza_20261115a$
DECLARE op public.probe_teren_operatii%ROWTYPE; payload jsonb; v_id bigint;
  v_tronson bigint:=p_tronson_id; v_nr_tronsoane bigint; v_unic_tronson bigint;
BEGIN
  IF NOT public.probe_teren_drept(true) THEN RAISE EXCEPTION 'pt_acces: drept explicit de scriere probe_teren necesar' USING ERRCODE='42501'; END IF;
  IF p_cheie IS NULL OR length(btrim(p_cheie)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'pt_cheie: cheie obligatorie'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('probe_teren_scriere'));
  payload:=jsonb_build_object('proiect_id',p_proiect_id,'tronson_id',p_tronson_id,'tip_fluid',p_tip_fluid,'beneficiar_tip',p_beneficiar_tip,
    'tert_ref_tip',p_tert_ref_tip,'tert_ref_id',p_tert_ref_id,'tert_ref_text',p_tert_ref_text,'tert_client',p_tert_client);
  SELECT * INTO op FROM public.probe_teren_operatii WHERE cheie=p_cheie;
  IF FOUND THEN
    IF op.actiune<>'creeaza_teren' OR op.continut IS DISTINCT FROM payload OR op.creat_de IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'pt_cheie_conflict: alt continut sau autor'; END IF;
    RETURN op.calc_id;
  END IF;
  IF p_tip_fluid IS NULL OR p_tip_fluid NOT IN ('aer','apa') THEN RAISE EXCEPTION 'pt_faza_tip: tip fluid invalid'; END IF;
  IF p_proiect_id IS NULL THEN RAISE EXCEPTION 'pt_proiect: proiect obligatoriu pentru orice beneficiar'; END IF;
  PERFORM 1 FROM public.executie_proiecte WHERE id=p_proiect_id FOR UPDATE; -- lock exclusiv: un tronson nou concurent nu poate trece intre numarare si completare
  IF NOT FOUND THEN RAISE EXCEPTION 'pt_proiect: proiect inexistent'; END IF;
  SELECT count(*),min(id) INTO v_nr_tronsoane,v_unic_tronson FROM public.executie_tronsoane WHERE proiect_id=p_proiect_id;
  IF v_tronson IS NULL THEN
    IF v_nr_tronsoane>=2 THEN RAISE EXCEPTION 'pt_tronson: selectati tronsonul lucrarii'; END IF;
    v_tronson:=v_unic_tronson;
  END IF;
  IF v_tronson IS NOT NULL THEN
    PERFORM 1 FROM public.executie_tronsoane WHERE id=v_tronson AND proiect_id=p_proiect_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'pt_tronson: tronsonul nu apartine proiectului'; END IF;
  END IF;
  IF p_beneficiar_tip IS NULL OR p_beneficiar_tip NOT IN ('gazpet','tert') OR (p_beneficiar_tip='gazpet' AND p_proiect_id IS NULL) THEN RAISE EXCEPTION 'pt_beneficiar: beneficiar sau proiect invalid'; END IF;
  IF p_beneficiar_tip='tert' AND (p_tert_ref_tip IS NULL OR p_tert_ref_tip NOT IN ('oferta','contract','comanda') OR coalesce(btrim(p_tert_client),'')='') THEN RAISE EXCEPTION 'pt_beneficiar: referinta tert si client obligatorii'; END IF;
  -- CHECK-ul E1 si triggerul valideaza structural si existential referintele tert.
  INSERT INTO public.probe_calcule(proiect_id,tronson_id,tip_fluid,beneficiar_tip,tert_ref_tip,tert_ref_id,tert_ref_text,tert_client,
    creat_din_teren,status,created_by,dn_id,lungime_m,presiune_bar,config_id)
    VALUES(p_proiect_id,v_tronson,p_tip_fluid,p_beneficiar_tip,p_tert_ref_tip,p_tert_ref_id,p_tert_ref_text,p_tert_client,
      true,'planificata',auth.uid(),NULL,NULL,NULL,NULL) RETURNING id INTO v_id;
  INSERT INTO public.probe_teren_operatii(cheie,calc_id,actiune,continut,rezultat,creat_de)
    VALUES(p_cheie,v_id,'creeaza_teren',payload,jsonb_build_object('calc_id',v_id,'ora_server',now()),auth.uid());
  RETURN v_id;
END $pt2_creeaza_20261115a$;

CREATE OR REPLACE VIEW public.v_probe_raport WITH (security_invoker=on) AS
 SELECT c.id calc_id,c.beneficiar_tip,c.proiect_id,c.tert_ref_tip,c.tert_ref_id,c.tert_ref_text,c.tert_client,c.status,
   coalesce(c.tert_ref_tip IN ('oferta','contract'),false) referinta_verificata,
   c.ora_start prima_pornire,c.ora_stop inchisa_la,t.ultima_oprire,
   extract(epoch FROM c.ora_stop-c.ora_start)/3600 durata_reala_h,
   coalesce(j.numar_citiri,0) numar_citiri,coalesce(j.citiri_intarziate,0) citiri_intarziate,
   coalesce(t.defecte,0) utilaje_oprite_defect,coalesce(a.utilaje,'[]'::jsonb) utilaje,
   extract(epoch FROM pf.ora_citire-pi.ora_citire)/3600 interval_presiune_h,
   CASE WHEN c.tip_fluid='aer' AND c.v_conducta_mc>0 AND pf.presiune_citita_bar>=pi.presiune_citita_bar
     AND pf.ora_citire>pi.ora_citire THEN
     c.v_conducta_mc*(pf.presiune_citita_bar-pi.presiune_citita_bar)/1.01325/(extract(epoch FROM pf.ora_citire-pi.ora_citire)/60)
     ELSE NULL END debit_real_estimat_mc_min,
   'indicativ: aer liber la 1.01325 bar; prima si ultima citire de presiune / intervalul lor; fara corectie termica; NULL la apa sau scadere presiune'::text debit_mentiune,
   public.probe_teren_bazin(c.id) litri_fise_bazin_comparatie,
   'din fise de bazin, orientativ; doar rezervor_id NOT NULL, fara statii externe (bazin comun: aceeasi cifra poate apare pe mai multe utilaje, TKT-2026-0358)'::text fise_bazin_mentiune,
   public.probe_teren_statii_externe(c.id) litri_statii_externe_orientativ,
   'alimentari din statii externe (orientativ); doar rezervor_id IS NULL, suma pe proba, fara atribuire pe utilaj'::text statii_externe_mentiune,
   c.faza_curenta,coalesce(faz.faze,'[]'::jsonb) faze,
   coalesce(h.citiri,'[]'::jsonb) citiri_hidraulice
 FROM public.probe_calcule c
 LEFT JOIN LATERAL (SELECT ora_citire,presiune_citita_bar FROM public.probe_log_executie
   WHERE calc_id=c.id AND presiune_citita_bar IS NOT NULL ORDER BY ora_citire,id LIMIT 1) pi ON true
 LEFT JOIN LATERAL (SELECT ora_citire,presiune_citita_bar FROM public.probe_log_executie
   WHERE calc_id=c.id AND presiune_citita_bar IS NOT NULL ORDER BY ora_citire DESC,id DESC LIMIT 1) pf ON true
 LEFT JOIN LATERAL (SELECT min(ora_start) prima_pornire,
   CASE WHEN bool_and(ora_stop IS NOT NULL) THEN max(ora_stop) END ultima_oprire,
   count(DISTINCT active_id) FILTER (WHERE motiv_oprire='defect') defecte FROM public.probe_exec_utilaje WHERE calc_id=c.id) t ON true
 LEFT JOIN LATERAL (SELECT count(*) numar_citiri,count(*) FILTER (WHERE intarziata) citiri_intarziate FROM public.probe_log_executie WHERE calc_id=c.id) j ON true
 LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('active_id',s.active_id,'ore_lucrate',s.ore,'intervale',s.n,
   'intervale_active',s.active,'opriri_defect',s.defecte,'norma_consum_l_h',public.probe_teren_norma(s.active_id),
   'litri_estimati',s.ore*public.probe_teren_norma(s.active_id)) ORDER BY s.active_id) utilaje
   FROM (SELECT active_id,sum(ore_bord_stop-ore_bord_start) ore,count(*) n,count(*) FILTER (WHERE ora_stop IS NULL) active,
     count(*) FILTER (WHERE motiv_oprire='defect') defecte
     FROM public.probe_exec_utilaje WHERE calc_id=c.id GROUP BY active_id) s) a ON true

 LEFT JOIN LATERAL (
   SELECT jsonb_agg(jsonb_build_object('faza',f.nume,'inceput',f.t0,'sfarsit',f.t1,
     'durata_h',extract(epoch FROM f.t1-f.t0)/3600,'utilaje',coalesce(m.utilaje,'[]'::jsonb)) ORDER BY f.ord) faze
   FROM (
     SELECT x.nume,x.ord,
       CASE WHEN x.ord=1 THEN c.ora_start ELSE b.ora_citire END t0,
       coalesce(lead(b.ora_citire) OVER (ORDER BY x.ord),c.ora_stop) t1
     FROM unnest(CASE WHEN c.tip_fluid='apa' THEN ARRAY['umplere','presurizare'] ELSE ARRAY['pistonare','uscare','calibrare','proba'] END) WITH ORDINALITY x(nume,ord)
     LEFT JOIN LATERAL (SELECT l.ora_citire FROM public.probe_log_executie l
       WHERE l.calc_id=c.id AND l.faza=x.nume AND l.limita_faza
       ORDER BY l.ora_citire,l.id LIMIT 1) b ON true
   ) f
   LEFT JOIN LATERAL (
     SELECT jsonb_agg(jsonb_build_object('active_id',s.active_id,'ore_lucrate',s.ore,
       'norma_consum_l_h',public.probe_teren_norma(s.active_id),'litri_estimati',s.ore*public.probe_teren_norma(s.active_id)) ORDER BY s.active_id) utilaje
     FROM (
       SELECT z.active_id,CASE WHEN bool_and(z.ore IS NOT NULL) THEN sum(z.ore) END ore FROM (
         SELECT e.active_id,fin.ore-ini.ore ore
         FROM public.probe_exec_utilaje e
         LEFT JOIN LATERAL (
           SELECT CASE WHEN e.faza_start=f.nume THEN e.ore_bord_start ELSE lu.ore_bord END ore
           FROM (SELECT 1) dummy LEFT JOIN public.probe_log_executie l ON l.calc_id=c.id AND l.faza=f.nume AND l.limita_faza
             
           LEFT JOIN public.probe_log_utilaje lu ON lu.log_id=l.id AND lu.active_id=e.active_id
           ORDER BY l.ora_citire,l.id LIMIT 1
         ) ini ON true
         LEFT JOIN LATERAL (
           SELECT CASE WHEN e.faza_stop=f.nume THEN e.ore_bord_stop ELSE lu.ore_bord END ore
           FROM (SELECT 1) dummy LEFT JOIN public.probe_log_executie l ON l.calc_id=c.id AND l.limita_faza
             AND l.faza=(ARRAY['pistonare','uscare','calibrare','proba'])[f.ord+1]
           LEFT JOIN public.probe_log_utilaje lu ON lu.log_id=l.id AND lu.active_id=e.active_id
           ORDER BY l.ora_citire,l.id LIMIT 1
         ) fin ON true
         WHERE c.tip_fluid='aer' AND e.calc_id=c.id
           AND array_position(ARRAY['pistonare','uscare','calibrare','proba'],e.faza_start)<=f.ord
           AND (e.faza_stop IS NULL OR array_position(ARRAY['pistonare','uscare','calibrare','proba'],e.faza_stop)>=f.ord)
       ) z GROUP BY z.active_id
     ) s
   ) m ON true
   WHERE c.faza_curenta IS NOT NULL AND f.t0 IS NOT NULL
     AND f.ord<=array_position(CASE WHEN c.tip_fluid='apa' THEN ARRAY['umplere','presurizare'] ELSE ARRAY['pistonare','uscare','calibrare','proba'] END,c.faza_curenta)
 ) faz ON true

 LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('log_id',l.id,'ora',l.ora_citire,'presiune_bar',l.presiune_citita_bar,
   'poza_manometru',l.poza_manometru_path,'limita_faza',l.limita_faza) ORDER BY l.ora_citire,l.id) citiri
   FROM public.probe_log_executie l WHERE l.calc_id=c.id AND c.tip_fluid='apa' AND l.faza='presurizare') h ON true
 WHERE auth.uid() IS NOT NULL AND public.probe_teren_drept(false);

REVOKE ALL ON FUNCTION public.probe_teren_scrie_e1(text,bigint,jsonb,text),public.probe_teren_faze_guard(),
 public.fn_probe_schimba_faza(bigint,text,numeric,text,jsonb,text,boolean,text,text),
 public.fn_probe_creeaza_teren(bigint,bigint,text,text,text,bigint,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_probe_schimba_faza(bigint,text,numeric,text,jsonb,text,boolean,text,text),
 public.fn_probe_creeaza_teren(bigint,bigint,text,text,text,bigint,text,text,text) TO authenticated;
