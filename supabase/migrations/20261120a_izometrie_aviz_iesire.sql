-- AVIZ-1; runner uses --single-transaction. Never apply directly.
-- Baseline captured 27.10.2026; refuses drift rather than restamping unknown code.
DO $migrare$
DECLARE v_amprenta text; v_meta jsonb; v_lipsa text[];
BEGIN
 IF current_user<>'postgres' OR current_setting('gazpet.livrare_migrare',true)
 IS DISTINCT FROM '20261120a_izometrie_aviz_iesire:'||txid_current() THEN RAISE EXCEPTION 'AVIZ numai runner postgres'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
 IF to_regclass('public.izo_avize_serii') IS NOT NULL OR EXISTS(SELECT 1 FROM storage.buckets WHERE id='izo-avize')
 THEN RAISE EXCEPTION 'AVIZ deja exista'; END IF;
 -- Corpurile exacte de pe prod (27.10.2026) ale funcțiilor pe care se sprijină avizul; COMMENT-urile cu amprente
 -- conțin OID-uri de rol și diferă între medii, deci drift-ul lor se verifică prin <amprenta> = COMMENT (mai jos), ca la 20261109b.
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_iesire_intern(uuid,integer,bigint,bigint[],text,date)'::regprocedure) IS DISTINCT FROM '5bd014cb48c161784e00989d92ea048c'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_birou_autorizat(bigint,integer,boolean)'::regprocedure) IS DISTINCT FROM 'c4c0cbd475c224a44ea5a3eae4fe98e2'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_birou_intrare(bigint,integer,text)'::regprocedure) IS DISTINCT FROM '84c2318be04fb33fba5c8695bfb7635a'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_citire(bigint)'::regprocedure) IS DISTINCT FROM 'b077d01aface67bb26dc9fea4baef0e2'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_porti_lipsa()'::regprocedure) IS DISTINCT FROM '3c136ab43387e8d7807efcadb0768dda'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_porti_e4_lipsa()'::regprocedure) IS DISTINCT FROM '6905733e1c2ccddce2a5757757f24b6b'
 THEN RAISE EXCEPTION 'AVIZ baseline prod diferit'; END IF;
 IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] OR public.fn_izo_porti_e4_lipsa() IS DISTINCT FROM '{}'::text[]
 THEN RAISE EXCEPTION 'AVIZ baseline porti'; END IF;
  -- <amprenta>
  SELECT md5(concat_ws(' | ',
      (SELECT string_agg(format('%s.%s:%s:%s:%s:%s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                                coalesce(pg_get_expr(d.adbin, d.adrelid), ''), coalesce(a.attacl::text, '')), ',' ORDER BY c.relname, a.attnum)
         FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped
          AND (c.relname IN ('izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari')
               OR (c.relname = 'magazie_bucati' AND a.attname IN ('tip_cod','uid','parinte_id','radacina_id','cod_bucata','capat_stanga',
                   'capat_dreapta','serie_canon','dezambiguare','lungime_aviz_mm','lungime_masurata_mm','lungime_mm','lungime_calculata',
                   'lungime_cm','perete_mm','diametru_mm','lot','aviz_intrare_id','nr_crt_aviz','bend_no','capat_marcaj','depozit_id',
                   'tronson_id','server_ver')))),
      (SELECT string_agg(format('%s:%s', c.conname, pg_get_constraintdef(c.oid)), ',' ORDER BY c.conname)
         FROM pg_constraint c WHERE c.conrelid IN ('public.izo_proiect_config'::regclass, 'public.izo_atribuiri'::regclass,
              'public.izo_importuri'::regclass, 'public.magazie_bucati_evenimente'::regclass, 'public.magazie_bucati_miscari'::regclass)
            OR (c.conrelid = 'public.magazie_bucati'::regclass AND (c.conname LIKE 'magazie\_bucati\_izo\_%' OR c.conname IN
                ('magazie_bucati_stare_check','magazie_bucati_locatie_tip_check','magazie_bucati_parinte_id_fkey',
                 'magazie_bucati_radacina_id_fkey','magazie_bucati_depozit_id_fkey','magazie_bucati_tronson_id_fkey')))),
      (SELECT string_agg(format('%s.%s:%s:%s:%s:%s:%s', (SELECT pc.relname FROM pg_class pc WHERE pc.oid = p.polrelid), p.polname, p.polcmd, p.polpermissive,
                                (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r),
                                coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')),
                         ',' ORDER BY (SELECT pc.relname FROM pg_class pc WHERE pc.oid = p.polrelid), p.polname)
         FROM pg_policy p WHERE p.polname LIKE 'izo\_%' OR p.polname LIKE 'magbuc\_izo\_%'),
      (SELECT string_agg(format('%s:%s', pg_get_triggerdef(g.oid, false), g.tgenabled), ',' ORDER BY g.tgname)
         FROM pg_trigger g WHERE NOT g.tgisinternal AND (g.tgname LIKE 'trg\_izo\_%' OR g.tgname LIKE '%\_izo\_%')),
      (SELECT string_agg(pg_get_indexdef(i.oid), ',' ORDER BY i.relname)
         FROM pg_class i WHERE i.relkind = 'i' AND i.relnamespace = 'public'::regnamespace
          AND (i.relname LIKE 'ux\_magbuc\_izo\_%' OR i.relname LIKE 'ix\_magbuc\_izo\_%' OR i.relname LIKE 'ux\_izo\_%'
               OR i.relname LIKE 'ix\_magbuc\_ev\_%' OR i.relname LIKE 'ix\_magbuc\_mis\_%')),
      (SELECT string_agg(format('%s(%s):%s:%s:%s:%s:%s:%s', p.proname, pg_get_function_identity_arguments(p.oid), pg_get_userbyid(p.proowner), p.prosecdef, md5(p.prosrc),
                                coalesce(p.proacl::text, ''), coalesce(p.proconfig::text, ''), p.provolatile), ',' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_izo\_%'),
      (SELECT string_agg(format('%s:%s:%s:%s', c.relname, coalesce(c.relacl::text, ''), c.relrowsecurity, c.relforcerowsecurity), ',' ORDER BY c.relname)
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
          AND c.relname IN ('izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari',
                            'izo_server_ver_seq','izo_atribuiri_id_seq','izo_importuri_id_seq','magazie_bucati_evenimente_id_seq',
                            'magazie_bucati_miscari_id_seq','magazie_bucati','magazie_bucati_id_seq')),
      (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', c.relname, format_type(s.seqtypid, NULL), s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcycle), ',' ORDER BY c.relname)
         FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid
        WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('izo_server_ver_seq','izo_atribuiri_id_seq','izo_importuri_id_seq',
              'magazie_bucati_evenimente_id_seq','magazie_bucati_miscari_id_seq')),
      (SELECT format('%s:%s:%s:%s:%s', r.rolinherit, r.rolcanlogin, r.rolbypassrls,
                     (SELECT string_agg(format('%s:%s:%s:%s', pg_get_userbyid(m.member), m.admin_option, m.inherit_option, m.set_option), ','
                                       ORDER BY pg_get_userbyid(m.member)::text, m.admin_option, m.inherit_option, m.set_option)
                        FROM pg_auth_members m WHERE m.roleid = r.oid), r.rolsuper)
         FROM pg_roles r WHERE r.rolname = 'izo_registru_writer')))
    INTO v_amprenta;
  -- </amprenta>
v_meta:=jsonb_build_object('amprenta',v_amprenta,'evenimente',obj_description('public.magazie_bucati_evenimente'::regclass,'pg_class'),
'porti',obj_description('public.fn_izo_porti_definitii()'::regprocedure,'pg_proc'),
'e3',obj_description('public.fn_izo_porti_e3_definitii()'::regprocedure,'pg_proc'),
'e3b',obj_description('public.fn_izo_porti_e3b_definitii()'::regprocedure,'pg_proc'),
'e4',obj_description('public.fn_izo_porti_e4_definitii()'::regprocedure,'pg_proc'),
'e4b',obj_description('public.fn_izo_porti_e4b_definitii()'::regprocedure,'pg_proc'));
IF v_amprenta IS DISTINCT FROM substring(v_meta->>'evenimente' FROM 'amprenta=([0-9a-f]{32})') THEN RAISE EXCEPTION 'AVIZ baseline amprenta'; END IF;
CREATE TABLE public.izo_avize_serii (
 depozit_id int PRIMARY KEY REFERENCES public.logistica_depozite(id),
 serie text NOT NULL UNIQUE CHECK(serie ~ '^[A-Z][A-Z0-9-]{0,19}$'),
 ultim_nr int NOT NULL CHECK(ultim_nr>=0), activ boolean NOT NULL DEFAULT true,
 actualizat_la timestamptz NOT NULL DEFAULT now());
-- <serii_start>
INSERT INTO public.izo_avize_serii(depozit_id,serie,ultim_nr) VALUES
 (9,'CJPJ',46),(10,'CJPT-O',71),(11,'CJPT',29),(12,'TIZ',0);
-- </serii_start>
CREATE TABLE public.izo_avize_iesire (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
 depozit_id int NOT NULL REFERENCES public.logistica_depozite(id),
 tronson_id bigint NOT NULL REFERENCES public.executie_tronsoane(id),
 serie text NOT NULL, numar int NOT NULL CHECK(numar>0),
 -- lpad truncates numbers longer than 4 digits: preserve the full number.
 nr_complet text GENERATED ALWAYS AS (serie||' '||lpad(numar::text,greatest(4,length(numar::text)),'0')) STORED,
 data_aviz date NOT NULL, emis_de uuid NOT NULL REFERENCES public.profiles(id),
 emis_de_employee_id int REFERENCES public.employees(id), emis_la timestamptz NOT NULL DEFAULT now(),
 sofer_employee_id int REFERENCES public.employees(id), sofer_extern_nume text,
 sofer_confirmat boolean NOT NULL, semnatura_pana_la timestamptz,
 destinatar_tip text NOT NULL CHECK(destinatar_tip IN ('intern','extern')),
 destinatar_denumire text, destinatar_cui text, destinatar_adresa text, motiv text NOT NULL,
 vehicul_activ_id int REFERENCES public.logistica_active(id), nr_auto text NOT NULL CHECK(length(nr_auto) BETWEEN 3 AND 20),
 op_cheie uuid NOT NULL UNIQUE, hash_cerere text NOT NULL CHECK(hash_cerere ~ '^[0-9a-f]{64}$'),
 eveniment_ids bigint[] NOT NULL, antet jsonb NOT NULL, continut jsonb NOT NULL,
 total_bucati int NOT NULL CHECK(total_bucati>0), total_m numeric NOT NULL CHECK(total_m>=0),
 total_kg numeric NOT NULL CHECK(total_kg>=0), stare text NOT NULL DEFAULT 'emis' CHECK(stare IN ('emis','anulat')),
 anulat_motiv text, anulat_de uuid REFERENCES public.profiles(id), anulat_la timestamptz,
 pdf_path text, pdf_etag text, pdf_bytes bigint, pdf_atasat_la timestamptz,
 UNIQUE(serie,numar),
 CHECK((sofer_employee_id IS NOT NULL AND sofer_extern_nume IS NULL) OR
 (sofer_employee_id IS NULL AND sofer_extern_nume IS NOT NULL AND length(btrim(sofer_extern_nume)) BETWEEN 3 AND 200 AND sofer_extern_nume ~ '[^[:space:]]')),
 CHECK(destinatar_tip='intern' OR (destinatar_denumire IS NOT NULL AND destinatar_cui IS NOT NULL AND destinatar_adresa IS NOT NULL
 AND destinatar_denumire ~ '[^[:space:]]' AND destinatar_cui ~ '[^[:space:]]' AND destinatar_adresa ~ '[^[:space:]]')),
 CHECK((stare='emis' AND anulat_motiv IS NULL AND anulat_de IS NULL AND anulat_la IS NULL) OR
 (stare='anulat' AND anulat_motiv IS NOT NULL AND length(anulat_motiv) BETWEEN 3 AND 1000 AND anulat_de IS NOT NULL AND anulat_la IS NOT NULL)),
 CHECK((pdf_path IS NULL AND pdf_etag IS NULL AND pdf_bytes IS NULL AND pdf_atasat_la IS NULL) OR
 (pdf_path IS NOT NULL AND pdf_etag IS NOT NULL AND pdf_bytes IS NOT NULL AND pdf_bytes BETWEEN 1024 AND 10485760 AND pdf_atasat_la IS NOT NULL)));
ALTER TABLE public.izo_avize_serii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.izo_avize_iesire ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.izo_avize_serii,public.izo_avize_iesire FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE public.izo_avize_iesire_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.izo_avize_serii,public.izo_avize_iesire TO authenticated;
CREATE POLICY izo_avize_sel ON public.izo_avize_iesire FOR SELECT TO authenticated
 USING(auth.uid() IS NOT NULL AND public.fn_izo_citire(proiect_id));
CREATE POLICY izo_avize_serii_sel ON public.izo_avize_serii FOR SELECT TO authenticated
 USING(auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.logistica_depozite d
 JOIN public.executie_proiecte p ON p.site_id=d.site_id WHERE d.id=depozit_id AND public.fn_izo_citire(p.id)));
-- Private bridge avoids extending LIVE function ACLs or existing writer rights.
CREATE FUNCTION public.fn_izo_aviz_iesire_intern(uuid,int,bigint,bigint[],text,date) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $f$
 SELECT public.fn_izo_iesire_intern($1,$2,$3,$4,$5,$6)
$f$;
REVOKE ALL ON FUNCTION public.fn_izo_aviz_iesire_intern(uuid,int,bigint,bigint[],text,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT CREATE ON SCHEMA public TO izo_montaj_writer;
ALTER FUNCTION public.fn_izo_aviz_iesire_intern(uuid,int,bigint,bigint[],text,date) OWNER TO izo_montaj_writer;
REVOKE CREATE ON SCHEMA public FROM izo_montaj_writer;
SET LOCAL ROLE izo_montaj_writer;
GRANT EXECUTE ON FUNCTION public.fn_izo_aviz_iesire_intern(uuid,int,bigint,bigint[],text,date) TO postgres;
RESET ROLE;

CREATE FUNCTION public.fn_izo_iesire_cu_aviz(p_cheie uuid,p_depozit int,p_tronson bigint,p_bucati bigint[],p_data date,
 p_sofer_employee int,p_sofer_extern text,p_sofer_confirmat boolean,p_vehicul int,p_nr_auto text,p_destinatar jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $f$
DECLARE v_uid uuid:=auth.uid(); v_old public.izo_avize_iesire; v_av public.izo_avize_iesire;
 v_ids bigint[]; v_payload jsonb; v_hash text; v_r jsonb; v_pr bigint; v_emp int;
 v_serie text; v_num int; v_nr text; v_auto text; v_extern text; v_dest jsonb; v_tip text;
 v_antet jsonb; v_cont jsonb; v_m numeric; v_kg numeric; v_motiv text; v_proiect jsonb;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED' USING ERRCODE='25001'; END IF;
 -- Order: delivery shared -> canonical aviz key -> global key -> authorization
 -- SHARE rows -> series row -> LIVE entry/rate row -> LIVE exit key ->
 -- locations -> roots/pieces sorted by id. Manual exit never
 -- locks a series or aviz key, so it cannot create a reverse edge/deadlock.
 PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
 PERFORM pg_advisory_xact_lock(hashtextextended('izo.aviz|'||public.fn_izo_uid()||'|'||p_cheie,0));
 -- op_cheie is globally UNIQUE; also serialize different authors reusing it.
 PERFORM pg_advisory_xact_lock(hashtextextended('izo.aviz.global|'||p_cheie,0));
 SELECT array_agg(x ORDER BY x) INTO v_ids FROM unnest(p_bucati) x;
 v_extern:=nullif(btrim(p_sofer_extern),'');
 v_auto:=upper(regexp_replace(btrim(p_nr_auto),'[[:space:]]+',' ','g'));
 v_dest:=p_destinatar;
 v_payload:=jsonb_build_object('depozit',p_depozit,'tronson',p_tronson,'bucati',v_ids,'data',p_data,
 'sofer_employee',p_sofer_employee,'sofer_extern',v_extern,'sofer_confirmat',p_sofer_confirmat,
 'vehicul',p_vehicul,'nr_auto',v_auto,'destinatar',v_dest);
 v_hash:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
 SELECT a.* INTO v_old FROM public.izo_avize_iesire a WHERE a.op_cheie=p_cheie;
 IF FOUND THEN
  IF v_old.emis_de IS DISTINCT FROM v_uid OR v_old.hash_cerere IS DISTINCT FROM v_hash THEN RAISE EXCEPTION 'cheie_refolosita'; END IF;
  IF public.fn_izo_citire(v_old.proiect_id) IS NOT TRUE THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('cod','iesit','aviz',to_jsonb(v_old),'eveniment_ids',v_old.eveniment_ids);
 END IF;
 -- Copilot P1-02: o cheie deja jurnalizată în izo_operatii fără aviz (de ex. o ieșire manuală prin fn_izo_iesire_tronson) ar face
 -- ieșirea LIVE să întoarcă răspunsul vechi „iesit”, iar wrapper-ul ar numerota un aviz pentru o ieșire neefectuată acum. Refuz, fără alocare.
 IF EXISTS(SELECT 1 FROM public.izo_operatii o WHERE o.op_id=p_cheie) THEN RAISE EXCEPTION 'cheie_operatie_existenta'; END IF;
 SELECT t.proiect_id INTO v_pr FROM public.executie_tronsoane t WHERE t.id=p_tronson;
 v_emp:=public.fn_izo_birou_autorizat(v_pr,p_depozit,true);
 IF p_cheie IS NULL OR p_depozit IS NULL OR v_pr IS NULL OR p_data IS NULL OR p_data>(now() AT TIME ZONE 'Europe/Bucharest')::date
 OR p_sofer_confirmat IS NULL OR p_bucati IS NULL OR cardinality(v_ids) NOT BETWEEN 1 AND 200
 OR array_position(v_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'parametri_invalizi'; END IF;
 IF (p_sofer_employee IS NOT NULL) = (v_extern IS NOT NULL) OR
 (v_extern IS NOT NULL AND (length(v_extern) NOT BETWEEN 3 AND 200 OR v_extern !~ '[^[:space:]]')) THEN RAISE EXCEPTION 'sofer_invalid'; END IF;
 IF p_sofer_employee IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.employees e WHERE e.id=p_sofer_employee AND e.active IS TRUE)
 THEN RAISE EXCEPTION 'sofer_invalid'; END IF;
 IF p_vehicul IS NOT NULL THEN
  SELECT upper(regexp_replace(btrim(a.nr_inmatriculare),'[[:space:]]+',' ','g')) INTO v_auto FROM public.logistica_active a WHERE a.id=p_vehicul;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicul_invalid'; END IF;
 END IF;
 IF v_auto IS NULL OR length(v_auto) NOT BETWEEN 3 AND 20 THEN RAISE EXCEPTION 'nr_auto_invalid'; END IF;
 IF jsonb_typeof(v_dest) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'destinatar_invalid'; END IF;
 v_tip:=v_dest->>'tip';
 IF v_tip IS NULL OR v_tip NOT IN ('intern','extern') OR
 (v_tip='intern' AND v_dest<>'{"tip":"intern"}'::jsonb) OR
 (v_tip='extern' AND (v_dest-ARRAY['tip','denumire','cui','adresa']<>'{}'::jsonb OR
 jsonb_typeof(v_dest->'denumire') IS DISTINCT FROM 'string' OR jsonb_typeof(v_dest->'cui') IS DISTINCT FROM 'string' OR
 jsonb_typeof(v_dest->'adresa') IS DISTINCT FROM 'string' OR
 length(btrim(v_dest->>'denumire')) NOT BETWEEN 1 AND 200 OR length(btrim(v_dest->>'cui')) NOT BETWEEN 1 AND 50 OR
 length(btrim(v_dest->>'adresa')) NOT BETWEEN 1 AND 500 OR v_dest->>'denumire' !~ '[^[:space:]]' OR
 v_dest->>'cui' !~ '[^[:space:]]' OR v_dest->>'adresa' !~ '[^[:space:]]')) THEN RAISE EXCEPTION 'destinatar_invalid'; END IF;
 UPDATE public.izo_avize_serii s SET ultim_nr=s.ultim_nr+1,actualizat_la=clock_timestamp()
 WHERE s.depozit_id=p_depozit AND s.activ RETURNING s.serie,s.ultim_nr INTO v_serie,v_num;
 IF NOT FOUND THEN RAISE EXCEPTION 'fara_serie'; END IF;
 v_nr:=v_serie||' '||lpad(v_num::text,greatest(4,length(v_num::text)),'0');
 v_r:=public.fn_izo_aviz_iesire_intern(p_cheie,p_depozit,p_tronson,v_ids,v_nr,p_data);
 IF v_r->>'cod' IS DISTINCT FROM 'iesit' THEN RAISE EXCEPTION 'iesire_refuzata'; END IF;
 IF EXISTS(SELECT 1 FROM public.magazie_bucati b WHERE b.id=ANY(v_ids) AND
 -- Curbele n-au lungime în registru (325 pe prod la 27.10): lungimea e cerută doar la țeavă (ca magazie_bucati_izo_registru_check); masa e obligatorie.
 (b.greutate_kg IS NULL OR b.greutate_kg<0 OR (b.lungime_mm IS NULL AND b.tip_cod='teava'))) THEN RAISE EXCEPTION 'instantaneu_incomplet'; END IF;
 SELECT jsonb_agg(jsonb_build_object('bucata_id',b.id,'tip_cod',b.tip_cod,'serie',b.serie,'sarja',b.sarja,'diametru_mm',b.diametru_mm,
 'perete_mm',b.perete_mm,'unghi_curba',b.unghi_curba,'lungime_mm',b.lungime_mm,'greutate_kg',b.greutate_kg) ORDER BY b.id),coalesce(sum(b.lungime_mm),0)/1000.0,sum(b.greutate_kg)
 INTO v_cont,v_m,v_kg FROM public.magazie_bucati b WHERE b.id=ANY(v_ids);
 SELECT jsonb_build_object('id',p.id,'nume',p.nume,'cod_intern',to_jsonb(p)->'cod_intern',
 'beneficiar',to_jsonb(p)->'beneficiar','nr_contract',to_jsonb(p)->'nr_contract','data_contract',to_jsonb(p)->'data_contract')
 INTO v_proiect FROM public.executie_proiecte p WHERE p.id=v_pr;
 v_motiv:=CASE WHEN v_tip='extern' THEN 'Livrare către '||btrim(v_dest->>'denumire') ELSE
 'Transfer intern — materiale puse la dispoziție de beneficiar'||coalesce(' '||nullif(btrim(v_proiect->>'beneficiar'),''),'')||
 coalesce(', contract nr. '||nullif(btrim(v_proiect->>'nr_contract'),'')||coalesce(' / '||nullif(btrim(v_proiect->>'data_contract'),''),''),'') END;
 v_antet:=jsonb_build_object('firma',(SELECT jsonb_object_agg(s.key,s.value) FROM public.logistica_setari s WHERE s.key LIKE 'firma\_%'),
 'proiect',v_proiect,'beneficiar',v_proiect->'beneficiar','contract',jsonb_build_object('nr',v_proiect->'nr_contract','data',v_proiect->'data_contract'),
 'depozit',(SELECT jsonb_build_object('id',d.id,'name',d.name,'adresa',d.adresa) FROM public.logistica_depozite d WHERE d.id=p_depozit),
 'tronson',(SELECT jsonb_build_object('id',t.id,'cod',t.cod,'km_start_m',t.km_start_m,'km_end_m',t.km_end_m)
 FROM public.executie_tronsoane t WHERE t.id=p_tronson),'destinatar',v_dest,'motiv',v_motiv,
 'sofer_nume',coalesce(v_extern,(SELECT e.name FROM public.employees e WHERE e.id=p_sofer_employee)),
 'emitent_nume',(SELECT p.name FROM public.profiles p WHERE p.id=v_uid),'nr_auto',v_auto);
 INSERT INTO public.izo_avize_iesire(proiect_id,depozit_id,tronson_id,serie,numar,data_aviz,emis_de,emis_de_employee_id,
 sofer_employee_id,sofer_extern_nume,sofer_confirmat,semnatura_pana_la,destinatar_tip,destinatar_denumire,destinatar_cui,destinatar_adresa,
 motiv,vehicul_activ_id,nr_auto,op_cheie,hash_cerere,eveniment_ids,antet,continut,total_bucati,total_m,total_kg)
 VALUES(v_pr,p_depozit,p_tronson,v_serie,v_num,p_data,v_uid,v_emp,p_sofer_employee,v_extern,p_sofer_confirmat,
 CASE WHEN p_sofer_employee IS NOT NULL AND p_sofer_confirmat THEN now()+interval '10 minutes' END,
 v_tip,v_dest->>'denumire',v_dest->>'cui',v_dest->>'adresa',v_motiv,p_vehicul,v_auto,p_cheie,v_hash,
 ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(v_r->'eveniment_ids')),v_antet,v_cont,cardinality(v_ids),v_m,v_kg)
 RETURNING * INTO v_av;
 RETURN jsonb_build_object('cod','iesit','aviz',to_jsonb(v_av),'eveniment_ids',v_av.eveniment_ids);
END $f$;

CREATE FUNCTION public.fn_izo_aviz_pdf_ataseaza(p_aviz bigint) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $f$
DECLARE v_a public.izo_avize_iesire; v_o storage.objects; v_path text; v_size bigint; v_etag text;
BEGIN
 -- delivery shared -> aviz row. Storage objects are immutable through API policies.
 PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
 SELECT a.* INTO v_a FROM public.izo_avize_iesire a WHERE a.id=p_aviz FOR UPDATE;
 IF auth.uid() IS NULL OR v_a.emis_de IS DISTINCT FROM auth.uid() OR public.fn_izo_citire(v_a.proiect_id) IS NOT TRUE
 THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
 IF v_a.stare<>'emis' THEN RAISE EXCEPTION 'aviz_anulat'; END IF;
 v_path:=v_a.proiect_id||'/'||v_a.serie||'-'||v_a.numar||'.pdf';
 SELECT o.* INTO v_o FROM storage.objects o WHERE o.bucket_id='izo-avize' AND o.name=v_path;
 IF NOT FOUND THEN RAISE EXCEPTION 'pdf_lipsa'; END IF;
 IF v_o.owner_id IS DISTINCT FROM v_a.emis_de::text OR v_o.metadata->>'mimetype' IS DISTINCT FROM 'application/pdf'
 OR coalesce(v_o.metadata->>'size','') !~ '^[0-9]{1,8}$' THEN RAISE EXCEPTION 'pdf_invalid'; END IF;
 v_size:=(v_o.metadata->>'size')::bigint; v_etag:=nullif(v_o.metadata->>'eTag','');
 IF v_size NOT BETWEEN 1024 AND 10485760 OR v_etag IS NULL THEN RAISE EXCEPTION 'pdf_invalid'; END IF;
 IF v_a.pdf_path IS NOT NULL THEN
  IF v_a.pdf_path IS DISTINCT FROM v_path OR v_a.pdf_etag IS DISTINCT FROM v_etag OR v_a.pdf_bytes IS DISTINCT FROM v_size
  THEN RAISE EXCEPTION 'conflict'; END IF;
 ELSE
  UPDATE public.izo_avize_iesire a SET pdf_path=v_path,pdf_etag=v_etag,pdf_bytes=v_size,pdf_atasat_la=clock_timestamp()
  WHERE a.id=p_aviz RETURNING a.* INTO v_a;
 END IF;
 RETURN jsonb_build_object('cod','atasat','aviz',to_jsonb(v_a));
END $f$;

CREATE FUNCTION public.fn_izo_aviz_anuleaza(p_aviz bigint,p_motiv text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $f$
DECLARE v_a public.izo_avize_iesire; v_motiv text:=btrim(p_motiv);
BEGIN
 -- delivery shared -> aviz row -> authorization rows; never touches series/pieces.
 PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
 SELECT a.* INTO v_a FROM public.izo_avize_iesire a WHERE a.id=p_aviz FOR UPDATE;
 IF auth.uid() IS NULL OR v_a.id IS NULL THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE='42501'; END IF;
 PERFORM public.fn_izo_birou_autorizat(v_a.proiect_id,v_a.depozit_id,true);
 IF v_motiv IS NULL OR length(v_motiv) NOT BETWEEN 3 AND 1000 OR v_motiv !~ '[^[:space:]]' THEN RAISE EXCEPTION 'motiv_invalid'; END IF;
 IF v_a.stare='anulat' THEN
  IF v_a.anulat_motiv IS DISTINCT FROM v_motiv THEN RAISE EXCEPTION 'conflict'; END IF;
 ELSE
  UPDATE public.izo_avize_iesire a SET stare='anulat',anulat_motiv=v_motiv,anulat_de=auth.uid(),anulat_la=clock_timestamp()
  WHERE a.id=p_aviz RETURNING a.* INTO v_a;
 END IF;
 RETURN jsonb_build_object('cod','anulat','aviz',to_jsonb(v_a));
END $f$;
REVOKE ALL ON FUNCTION public.fn_izo_iesire_cu_aviz(uuid,int,bigint,bigint[],date,int,text,boolean,int,text,jsonb),
 public.fn_izo_aviz_pdf_ataseaza(bigint),public.fn_izo_aviz_anuleaza(bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_izo_iesire_cu_aviz(uuid,int,bigint,bigint[],date,int,text,boolean,int,text,jsonb),
 public.fn_izo_aviz_pdf_ataseaza(bigint),public.fn_izo_aviz_anuleaza(bigint,text) TO authenticated;

INSERT INTO storage.buckets(id,name,public) VALUES('izo-avize','izo-avize',false);
CREATE POLICY izo_aviz_pdf_sel ON storage.objects FOR SELECT TO authenticated USING
 (bucket_id='izo-avize' AND auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.izo_avize_iesire a
 WHERE name=a.proiect_id||'/'||a.serie||'-'||a.numar||'.pdf' AND public.fn_izo_citire(a.proiect_id)));
CREATE POLICY izo_aviz_pdf_ins ON storage.objects FOR INSERT TO authenticated WITH CHECK
 (bucket_id='izo-avize' AND auth.uid() IS NOT NULL AND owner_id=auth.uid()::text AND EXISTS(SELECT 1 FROM public.izo_avize_iesire a
 WHERE name=a.proiect_id||'/'||a.serie||'-'||a.numar||'.pdf' AND a.emis_de=auth.uid() AND a.stare='emis'
 AND a.pdf_path IS NULL AND public.fn_izo_citire(a.proiect_id)));
-- Restrictive fences prevent another bucket's broad permissive policy reopening this one.
CREATE POLICY izo_aviz_pdf_r_sel ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING
 (bucket_id<>'izo-avize' OR (auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.izo_avize_iesire a
 WHERE name=a.proiect_id||'/'||a.serie||'-'||a.numar||'.pdf' AND public.fn_izo_citire(a.proiect_id))));
CREATE POLICY izo_aviz_pdf_r_ins ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK
 (bucket_id<>'izo-avize' OR (auth.uid() IS NOT NULL AND owner_id=auth.uid()::text AND EXISTS(SELECT 1 FROM public.izo_avize_iesire a
 WHERE name=a.proiect_id||'/'||a.serie||'-'||a.numar||'.pdf' AND a.emis_de=auth.uid() AND a.stare='emis'
 AND a.pdf_path IS NULL AND public.fn_izo_citire(a.proiect_id))));
CREATE POLICY izo_aviz_pdf_r_upd ON storage.objects AS RESTRICTIVE FOR UPDATE TO PUBLIC
 USING(bucket_id<>'izo-avize') WITH CHECK(bucket_id<>'izo-avize');
CREATE POLICY izo_aviz_pdf_r_del ON storage.objects AS RESTRICTIVE FOR DELETE TO PUBLIC USING(bucket_id<>'izo-avize');
CREATE POLICY izo_aviz_pdf_r_anon ON storage.objects AS RESTRICTIVE FOR ALL TO anon
 USING(bucket_id<>'izo-avize') WITH CHECK(bucket_id<>'izo-avize');

CREATE OR REPLACE FUNCTION public.fn_izo_porti_e4b_definitii() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT md5(concat_ws('|',
   (SELECT string_agg(format('%s:%s:%s:%s:%s:%s',p.oid::regprocedure,p.proowner,p.prosecdef,p.proconfig,p.proacl,md5(p.prosrc)),',' ORDER BY p.oid::regprocedure::text)
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'fn\_izo\_%'),
   (SELECT string_agg(format('%s:%s:%s:%s:%s:%s',c.relname,c.relowner,c.relrowsecurity,c.relacl,c.reloptions,c.relforcerowsecurity),',' ORDER BY c.relname)
    FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND (c.relname=ANY(ARRAY['executie_proiecte', 'executie_tronsoane', 'izo_aprobari', 'izo_bucati_declarate', 'izo_declaratii', 'izo_declaratii_gps','izo_gps_stergeri','izo_avize_serii','izo_avize_iesire', 'izo_declaratii_versiuni', 'izo_dispozitive', 'izo_fronturi', 'izo_operatii', 'izo_preverificari', 'izo_rata_apeluri', 'izo_rezervari', 'izo_suduri', 'izo_suduri_capete', 'izo_sync_incercari', 'izo_tronson_config', 'logistica_depozite', 'magazie_bucati', 'magazie_bucati_evenimente', 'magazie_bucati_miscari']::text[]) OR c.relname IN ('v_izo_carantina_sync','v_izo_rezervari_active','v_izo_alerte'))),
   (SELECT string_agg(format('%s:%s:%s:%s:%s:%s',c.relname,a.attname,a.atttypid,a.attnotnull,a.attacl,pg_get_expr(d.adbin,d.adrelid)),',' ORDER BY c.relname,a.attnum)
    FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY(ARRAY['executie_proiecte', 'executie_tronsoane', 'izo_aprobari', 'izo_bucati_declarate', 'izo_declaratii', 'izo_declaratii_gps','izo_gps_stergeri','izo_avize_serii','izo_avize_iesire', 'izo_declaratii_versiuni', 'izo_dispozitive', 'izo_fronturi', 'izo_operatii', 'izo_preverificari', 'izo_rata_apeluri', 'izo_rezervari', 'izo_suduri', 'izo_suduri_capete', 'izo_sync_incercari', 'izo_tronson_config', 'logistica_depozite', 'magazie_bucati', 'magazie_bucati_evenimente', 'magazie_bucati_miscari']::text[]) AND a.attnum>0 AND NOT a.attisdropped),
   (SELECT string_agg(format('%s:%s',c.relname,pg_get_constraintdef(k.oid)),',' ORDER BY c.relname,k.conname)
    FROM pg_class c JOIN pg_constraint k ON k.conrelid=c.oid WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY(ARRAY['izo_fronturi', 'izo_dispozitive', 'izo_preverificari', 'izo_declaratii', 'izo_bucati_declarate', 'izo_rezervari', 'izo_operatii', 'izo_declaratii_versiuni', 'izo_declaratii_gps','izo_gps_stergeri','izo_avize_serii','izo_avize_iesire', 'izo_sync_incercari', 'izo_rata_apeluri', 'izo_aprobari', 'izo_suduri', 'izo_suduri_capete']::text[])),
   (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s',c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)),',' ORDER BY c.relname,p.polname)
    FROM pg_class c JOIN pg_policy p ON p.polrelid=c.oid WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY(ARRAY['executie_proiecte', 'executie_tronsoane', 'izo_aprobari', 'izo_bucati_declarate', 'izo_declaratii', 'izo_declaratii_gps','izo_gps_stergeri','izo_avize_serii','izo_avize_iesire', 'izo_declaratii_versiuni', 'izo_dispozitive', 'izo_fronturi', 'izo_operatii', 'izo_preverificari', 'izo_rata_apeluri', 'izo_rezervari', 'izo_suduri', 'izo_suduri_capete', 'izo_sync_incercari', 'izo_tronson_config', 'logistica_depozite', 'magazie_bucati', 'magazie_bucati_evenimente', 'magazie_bucati_miscari']::text[])),
   (SELECT string_agg(format('%s:%s:%s',c.relname,pg_get_triggerdef(g.oid),g.tgenabled),',' ORDER BY c.relname,g.tgname)
    FROM pg_class c JOIN pg_trigger g ON g.tgrelid=c.oid WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY(ARRAY['izo_fronturi', 'izo_dispozitive', 'izo_preverificari', 'izo_declaratii', 'izo_bucati_declarate', 'izo_rezervari', 'izo_operatii', 'izo_declaratii_versiuni', 'izo_declaratii_gps','izo_gps_stergeri','izo_avize_serii','izo_avize_iesire', 'izo_sync_incercari', 'izo_rata_apeluri', 'izo_aprobari', 'izo_suduri', 'izo_suduri_capete']::text[]) AND NOT g.tgisinternal),
   (SELECT string_agg(pg_get_indexdef(i.indexrelid),',' ORDER BY i.indexrelid::regclass::text)
    FROM pg_class c JOIN pg_index i ON i.indrelid=c.oid WHERE c.relnamespace='public'::regnamespace AND (c.relname=ANY(ARRAY['izo_fronturi', 'izo_dispozitive', 'izo_preverificari', 'izo_declaratii', 'izo_bucati_declarate', 'izo_rezervari', 'izo_operatii', 'izo_declaratii_versiuni', 'izo_declaratii_gps','izo_gps_stergeri','izo_avize_serii','izo_avize_iesire', 'izo_sync_incercari', 'izo_rata_apeluri', 'izo_aprobari', 'izo_suduri', 'izo_suduri_capete']::text[]) OR i.indexrelid=to_regclass('public.ux_magbuc_ev_decl'))),
   (SELECT string_agg(format('%s:%s:%s',c.relname,c.relowner,c.relacl),',' ORDER BY c.relname) FROM pg_class c
    WHERE c.relnamespace='public'::regnamespace AND c.relkind='S' AND (c.relname IN ('izo_gps_stergeri_id_seq','izo_avize_iesire_id_seq','izo_server_ver_seq','magazie_bucati_id_seq','magazie_bucati_evenimente_id_seq','magazie_bucati_miscari_id_seq') OR c.relname LIKE 'izo\_fronturi\_%' OR c.relname LIKE 'izo\_preverificari\_%' OR c.relname LIKE 'izo\_declaratii\_%' OR c.relname LIKE 'izo\_rezervari\_%' OR c.relname LIKE 'izo\_operatii\_%' OR c.relname LIKE 'izo\_sync\_incercari\_%' OR c.relname LIKE 'izo\_aprobari\_%' OR c.relname LIKE 'izo\_suduri\_%')),
   (SELECT concat_ws(':',rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconfig) FROM pg_roles WHERE rolname='izo_teren_editor'),
   (SELECT string_agg(format('%s:%s:%s:%s:%s',roleid,member,admin_option,inherit_option,set_option),',' ORDER BY roleid,member) FROM pg_auth_members WHERE roleid='izo_teren_editor'::regrole OR member='izo_teren_editor'::regrole)))
 $f$;

EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L','porti='||public.fn_izo_porti_definitii());
EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L','porti_e3='||public.fn_izo_porti_e3_definitii());
EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L','porti_e3b='||public.fn_izo_porti_e3b_definitii());
EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS %L','porti_e4='||public.fn_izo_porti_e4_definitii());
EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS %L','porti_e4b='||public.fn_izo_porti_e4b_definitii());

 v_meta:=jsonb_set(v_meta,'{serii_initiale}',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.depozit_id) FROM public.izo_avize_serii s));
 IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'AVIZ postconditie porti'; END IF;
  -- <amprenta>
  SELECT md5(concat_ws(' | ',
      (SELECT string_agg(format('%s.%s:%s:%s:%s:%s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                                coalesce(pg_get_expr(d.adbin, d.adrelid), ''), coalesce(a.attacl::text, '')), ',' ORDER BY c.relname, a.attnum)
         FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped
          AND (c.relname IN ('izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari')
               OR (c.relname = 'magazie_bucati' AND a.attname IN ('tip_cod','uid','parinte_id','radacina_id','cod_bucata','capat_stanga',
                   'capat_dreapta','serie_canon','dezambiguare','lungime_aviz_mm','lungime_masurata_mm','lungime_mm','lungime_calculata',
                   'lungime_cm','perete_mm','diametru_mm','lot','aviz_intrare_id','nr_crt_aviz','bend_no','capat_marcaj','depozit_id',
                   'tronson_id','server_ver')))),
      (SELECT string_agg(format('%s:%s', c.conname, pg_get_constraintdef(c.oid)), ',' ORDER BY c.conname)
         FROM pg_constraint c WHERE c.conrelid IN ('public.izo_proiect_config'::regclass, 'public.izo_atribuiri'::regclass,
              'public.izo_importuri'::regclass, 'public.magazie_bucati_evenimente'::regclass, 'public.magazie_bucati_miscari'::regclass)
            OR (c.conrelid = 'public.magazie_bucati'::regclass AND (c.conname LIKE 'magazie\_bucati\_izo\_%' OR c.conname IN
                ('magazie_bucati_stare_check','magazie_bucati_locatie_tip_check','magazie_bucati_parinte_id_fkey',
                 'magazie_bucati_radacina_id_fkey','magazie_bucati_depozit_id_fkey','magazie_bucati_tronson_id_fkey')))),
      (SELECT string_agg(format('%s.%s:%s:%s:%s:%s:%s', (SELECT pc.relname FROM pg_class pc WHERE pc.oid = p.polrelid), p.polname, p.polcmd, p.polpermissive,
                                (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r),
                                coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')),
                         ',' ORDER BY (SELECT pc.relname FROM pg_class pc WHERE pc.oid = p.polrelid), p.polname)
         FROM pg_policy p WHERE p.polname LIKE 'izo\_%' OR p.polname LIKE 'magbuc\_izo\_%'),
      (SELECT string_agg(format('%s:%s', pg_get_triggerdef(g.oid, false), g.tgenabled), ',' ORDER BY g.tgname)
         FROM pg_trigger g WHERE NOT g.tgisinternal AND (g.tgname LIKE 'trg\_izo\_%' OR g.tgname LIKE '%\_izo\_%')),
      (SELECT string_agg(pg_get_indexdef(i.oid), ',' ORDER BY i.relname)
         FROM pg_class i WHERE i.relkind = 'i' AND i.relnamespace = 'public'::regnamespace
          AND (i.relname LIKE 'ux\_magbuc\_izo\_%' OR i.relname LIKE 'ix\_magbuc\_izo\_%' OR i.relname LIKE 'ux\_izo\_%'
               OR i.relname LIKE 'ix\_magbuc\_ev\_%' OR i.relname LIKE 'ix\_magbuc\_mis\_%')),
      (SELECT string_agg(format('%s(%s):%s:%s:%s:%s:%s:%s', p.proname, pg_get_function_identity_arguments(p.oid), pg_get_userbyid(p.proowner), p.prosecdef, md5(p.prosrc),
                                coalesce(p.proacl::text, ''), coalesce(p.proconfig::text, ''), p.provolatile), ',' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_izo\_%'),
      (SELECT string_agg(format('%s:%s:%s:%s', c.relname, coalesce(c.relacl::text, ''), c.relrowsecurity, c.relforcerowsecurity), ',' ORDER BY c.relname)
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
          AND c.relname IN ('izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari',
                            'izo_server_ver_seq','izo_atribuiri_id_seq','izo_importuri_id_seq','magazie_bucati_evenimente_id_seq',
                            'magazie_bucati_miscari_id_seq','magazie_bucati','magazie_bucati_id_seq')),
      (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', c.relname, format_type(s.seqtypid, NULL), s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcycle), ',' ORDER BY c.relname)
         FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid
        WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('izo_server_ver_seq','izo_atribuiri_id_seq','izo_importuri_id_seq',
              'magazie_bucati_evenimente_id_seq','magazie_bucati_miscari_id_seq')),
      (SELECT format('%s:%s:%s:%s:%s', r.rolinherit, r.rolcanlogin, r.rolbypassrls,
                     (SELECT string_agg(format('%s:%s:%s:%s', pg_get_userbyid(m.member), m.admin_option, m.inherit_option, m.set_option), ','
                                       ORDER BY pg_get_userbyid(m.member)::text, m.admin_option, m.inherit_option, m.set_option)
                        FROM pg_auth_members m WHERE m.roleid = r.oid), r.rolsuper)
         FROM pg_roles r WHERE r.rolname = 'izo_registru_writer')))
    INTO v_amprenta;
  -- </amprenta>

 EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L','AVIZ amprenta='||v_amprenta||' anterior: '||(v_meta->>'evenimente'));
 EXECUTE format('COMMENT ON TABLE public.izo_avize_serii IS %L',v_meta::text);
END $migrare$;
