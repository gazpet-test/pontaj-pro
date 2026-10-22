"""Fixture/teste E3 independente de generatorul migrarii. Nu acceseaza BD."""
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'supabase/tests/izometrie_e3b_garzi.sql'
const = {}
for node in ast.parse((ROOT / 'scripts/izometrie/e3_gen/gen_e3.py').read_text(encoding='utf-8')).body:
    if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
        try:
            const[node.targets[0].id] = ast.literal_eval(node.value)
        except (ValueError, TypeError):
            pass

def quote(value):
    return "'" + value.replace("'", "''") + "'"

def payload(prefix, count):
    value = {'motiv': 'fixture E3 garzi', 'surse': [{'fisier': 'E3.xlsx', 'sha256': 'e'*64}],
        'bucati': [dict(tip='teava', serie=f'{prefix}-{i}', sarja='E3-S', lungime_mm=12000,
            perete_mm=8, stare='receptionat', depozit_id=11,
            sursa={'fisier': 'E3.xlsx', 'foaie': 'F', 'rand': i}) for i in range(1, count+1)]}
    if prefix == 'E3':
        value['bucati'] += [dict(tip='curba',serie=f'E3-CURBA-{i}',sarja='E3-S',perete_mm=8,
            unghi_curba=angle,stare='receptionat',depozit_id=11,
            sursa={'fisier':'E3.xlsx','foaie':'F','rand':count+i}) for i,angle in [(1,45),(2,90)]]
    return json.dumps(value, separators=(',', ':'))

helpers = r"""
-- E2 e2_refuz dispare la ROLLBACK. Varianta de aici pastreaza contextul pentru
-- atacurile directe; RPC-urile sunt resetate explicit in e3_rpc.
CREATE FUNCTION teste.e3_refuz(p_sql text,p_state text,p_mesaj text DEFAULT 'E3b:%') RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
DECLARE v_state text; v_msg text; v_detail text; v_hint text; v_rows bigint;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows=ROW_COUNT;
    RAISE EXCEPTION 'E3: scriere acceptata (% randuri): %',v_rows,p_sql USING ERRCODE='ZE301';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT,v_detail=PG_EXCEPTION_DETAIL,v_hint=PG_EXCEPTION_HINT;
    IF v_state IS DISTINCT FROM p_state OR (p_mesaj IS NOT NULL AND v_msg NOT LIKE p_mesaj) THEN
      RAISE EXCEPTION 'E3: asteptat % / %, primit % / %; SQL=%',p_state,p_mesaj,v_state,v_msg,p_sql;
    END IF;
    IF p_state='23505' AND p_mesaj LIKE 'E3b: conflict%' AND (coalesce(v_detail,'')<>'' OR coalesce(v_hint,'')<>'') THEN
      RAISE EXCEPTION 'E3: coliziune generica dezvaluie DETAIL/HINT: % / %',v_detail,v_hint;
    END IF;
  END;
END $f$;
CREATE FUNCTION teste.e3_rpc(p_sql text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
DECLARE v_r jsonb;
BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);
  PERFORM set_config('izo.receptie_ctx','',true);
  EXECUTE p_sql INTO v_r;
  PERFORM set_config('izo.corectie_ctx','',true);
  PERFORM set_config('izo.receptie_ctx','',true);
  RETURN v_r;
END $f$;
-- Design §5.1 linia 504 / §9.5 linia 796: mesaj cu detalii pentru proiect CITIBIL.
-- Nu acceptam un mesaj generic doar fiindca verifica() afiseaza separat detaliile.
CREATE FUNCTION teste.e3_coliziune_vizibila(p_sql text,p_b bigint,p_proiect bigint,p_stare text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
DECLARE v_state text; v_msg text; v_detail text; v_text text;
BEGIN
 BEGIN
   EXECUTE p_sql;
   RAISE EXCEPTION 'E3: coliziune vizibila acceptata' USING ERRCODE='ZE301';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT,v_detail=PG_EXCEPTION_DETAIL;
   v_text:=coalesce(v_msg,'')||' '||coalesce(v_detail,'');
   IF v_state<>'23505' OR position(p_b::text IN v_text)=0 OR position(p_proiect::text IN v_text)=0 OR position(p_stare IN v_text)=0 THEN
     RAISE EXCEPTION 'E3 mismatch design §5.1/§9.5: coliziune citibila trebuie 23505 cu bucata %, proiect %, stare %; primit %: %',p_b,p_proiect,p_stare,v_state,v_text;
   END IF;
 END;
END $f$;
-- DML real, nu apelarea izolata a helperului de garda. Listele explicite
-- EV/MIS/C sunt aceleasi coloane folosite de fixture-urile E3/E3b.
CREATE FUNCTION teste.e3_put(p_t text,p_j jsonb,p_cols text[]) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
DECLARE v_cols text; v_values text; v_id bigint;
BEGIN
  SELECT string_agg(format('%I',x),','),string_agg(format('(jsonb_populate_record(NULL::public.%I,$1)).%I',p_t,x),',')
    INTO v_cols,v_values FROM unnest(p_cols) x;
  EXECUTE format('INSERT INTO public.%I(%s) SELECT %s RETURNING id',p_t,v_cols,v_values) INTO v_id USING p_j;
  RETURN v_id;
END $f$;
CREATE FUNCTION teste.e3_ev(p_c bigint,p_patch jsonb DEFAULT '{}') RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
DECLARE v_c public.izo_corectii;
BEGIN
  SELECT * INTO STRICT v_c FROM public.izo_corectii WHERE id=p_c;
  RETURN teste.e3_put('magazie_bucati_evenimente',public.fn_izo_cor_eveniment_asteptat(v_c)
    ||jsonb_build_object('server_ver',nextval('public.izo_server_ver_seq'))||p_patch,@@EV@@);
END $f$;
CREATE FUNCTION teste.e3_mis(p_c bigint,p_b bigint,p_patch jsonb DEFAULT '{}') RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
DECLARE v_c public.izo_corectii; v_b public.magazie_bucati;
BEGIN
  SELECT * INTO STRICT v_c FROM public.izo_corectii WHERE id=p_c;
  SELECT * INTO STRICT v_b FROM public.magazie_bucati WHERE id=p_b;
  RETURN teste.e3_put('magazie_bucati_miscari',public.fn_izo_cor_miscare_asteptata(v_c,v_b)
    ||jsonb_build_object('server_ver',nextval('public.izo_server_ver_seq'))||p_patch,@@MIS@@);
END $f$;
CREATE FUNCTION teste.e3_upd(p_b bigint,p_j jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
DECLARE v_cols text; v_values text; v_id bigint;
BEGIN
 SELECT string_agg(format('%I',x),','),string_agg(format('(jsonb_populate_record(NULL::public.magazie_bucati,$1)).%I',x),',')
 INTO v_cols,v_values FROM unnest(public.fn_izo_coloane_c()||ARRAY['server_ver']) x;
 EXECUTE format('UPDATE public.magazie_bucati SET (%s)=(SELECT %s) WHERE id=$2 RETURNING id',v_cols,v_values)
 INTO v_id USING p_j,p_b;
 RETURN v_id;
END $f$;
REVOKE ALL ON FUNCTION teste.e3_refuz(text,text,text),teste.e3_rpc(text),teste.e3_put(text,jsonb,text[]),
  teste.e3_ev(bigint,jsonb),teste.e3_mis(bigint,bigint,jsonb),teste.e3_upd(bigint,jsonb),
  teste.e3_coliziune_vizibila(text,bigint,bigint,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA teste TO authenticated,izo_cor_editor,izo_corectie_writer;
GRANT EXECUTE ON FUNCTION teste.e3_refuz(text,text,text),teste.e3_rpc(text),teste.e3_put(text,jsonb,text[]),
  teste.e3_ev(bigint,jsonb),teste.e3_mis(bigint,bigint,jsonb),teste.e3_upd(bigint,jsonb),
  teste.e3_coliziune_vizibila(text,bigint,bigint,text) TO authenticated,izo_cor_editor,izo_corectie_writer;
"""
for key in ('EV', 'MIS'):
    helpers = helpers.replace('@@'+key+'@@', 'ARRAY['+','.join(quote(x) for x in const[key]+['server_ver'])+']::text[]')

def fixture():
    return "\nBEGIN;\n" + f"""
SELECT public.fn_izo_activeaza_si_importa(3,'E3-import',{quote(payload('E3',6))}::jsonb,'fixture E3');
SELECT set_config('izo.registru_tx','',true);
-- bucata E3-ALT-1 NU e născută de E3-import (E2a permite un singur import pe tranzacție): scrisă direct de scriitorul registrului
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
DO $alt$ DECLARE v_id bigint:=nextval('public.magazie_bucati_id_seq'); BEGIN
  INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver,proiect_id,tip_material_id,tip_cod,
    serie,sarja,perete_mm,lungime_aviz_mm,lungime_mm,lungime_m,lungime_originala_m,cod_bucata,capat_stanga,capat_dreapta,
    provenienta,stare,locatie_tip,locatie_site_id,depozit_id,sursa_receptie)
  VALUES(v_id,gen_random_uuid(),v_id,nextval('public.izo_server_ver_seq'),3,1,'teava','E3-ALT-1','E3-S',8,
    12000,12000,12,12,'AB','A','B','beneficiar','receptionat','depozit',6,11,'manual');
END $alt$;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
INSERT INTO public.izo_atribuiri(proiect_id,profile_id,rol,depozit_id,acordat_de,motiv)
 VALUES(3,'00000000-0000-0000-0000-000000000030','gestionar',11,'test','fixture E3');
SELECT set_config('test.e3_b',(SELECT id::text FROM public.magazie_bucati WHERE serie='E3-1'),true);
SELECT set_config('test.e3_b2',(SELECT id::text FROM public.magazie_bucati WHERE serie='E3-2'),true);
SELECT set_config('request.jwt.claims','{{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}}',true);
""" + helpers

api = "SET SESSION AUTHORIZATION authenticator;\nSET LOCAL ROLE authenticated;\n"
reset = "RESET ROLE;\nRESET SESSION AUTHORIZATION;\n"
def jwt(n):
    return f"SELECT set_config('request.jwt.claims','{{\"sub\":\"00000000-0000-0000-0000-000000000{n}\",\"role\":\"authenticated\"}}',true);\n"

guards = r"""
-- §9.3: un context real, eveniment valid si martori pozitivi intre atacuri.
SET LOCAL ROLE izo_corectie_writer;
DO $guard$
DECLARE v_b bigint:=current_setting('test.e3_b')::bigint;
 v_b2 bigint:=current_setting('test.e3_b2')::bigint; v_c bigint; v_e bigint; v_j jsonb;
BEGIN
  PERFORM teste.e3_refuz(format('INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,inainte,dupa,motiv,propus_de) VALUES(3,''camp'',%s,''{}'',''{"perete_mm":9}'',''E3 inainte fals'',''00000000-0000-0000-0000-000000000121'')',v_b),'22023','E3b: inainte/cale%');
  PERFORM teste.e3_refuz(format('INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,inainte,dupa,motiv,propus_de) VALUES(3,''camp'',%s,NULL,''{"perete_mm":9}'',''E3 autor fals'',''00000000-0000-0000-0000-000000000030'')',v_b),'42501','E3b: identitate%');
  INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,inainte,dupa,motiv,propus_de)
    VALUES(3,'camp',v_b,NULL,'{"perete_mm":9}','E3 direct guard','00000000-0000-0000-0000-000000000121') RETURNING id INTO v_c;
  PERFORM public.fn_izo_cor_marcheaza(v_c);
  PERFORM set_config('izo.corectie_ctx',txid_current()::text||'|camp|'||v_c||'|3|99|',true);
  PERFORM teste.e3_refuz(format('SELECT teste.e3_ev(%s)',v_c),'42501','E3b: corecția contextului diferă');
  PERFORM set_config('izo.corectie_ctx',txid_current()::text||'|camp|'||v_c||'|3|1|',true);
  PERFORM set_config('izo.corectie_ctx',txid_current()::text||'|camp|'||v_c||'|3|1|1',true);
  PERFORM teste.e3_refuz(format('SELECT teste.e3_ev(%s)',v_c),'42501','E3b: context absent / fals');
  PERFORM set_config('izo.corectie_ctx',txid_current()::text||'|camp|'||v_c||'|3|1|',true);
  PERFORM teste.e3_refuz(format('SELECT teste.e3_ev(%s,''{"document_id":"999999"}'')',v_c),'42501','E3b: eveniment diferit');
  PERFORM teste.e3_refuz(format('SELECT teste.e3_ev(%s,''{"proiect_id":2}'')',v_c),'42501','E3b: eveniment diferit');
  PERFORM teste.e3_refuz(format('SELECT teste.e3_ev(%s,''{"tip":"gasit"}'')',v_c),'42501','E3b: eveniment diferit');
  v_e:=teste.e3_ev(v_c);
  PERFORM teste.e3_refuz(format('SELECT teste.e3_ev(%s)',v_c),'42501','E3b: eveniment diferit');
  PERFORM teste.e3_refuz(format('SELECT teste.e3_mis(%s,%s)',v_c,v_b2),'42501','E3b: țintă străină');
  FOR v_j IN SELECT x FROM (VALUES ('{"eveniment_id":-1}'::jsonb),('{"rol":"stare"}'::jsonb),
    ('{"proiect_id":2}'::jsonb),
    ('{"stare_inainte":"receptionat"}'::jsonb),('{"stare_dupa":"carantina"}'::jsonb),
    ('{"in_loc":{"tip":"depozit","depozit_id":12}}'::jsonb)) j(x) LOOP
    PERFORM teste.e3_refuz(format('SELECT teste.e3_mis(%s,%s,%L)',v_c,v_b,v_j),'42501','E3b: mișcare diferită%');
  END LOOP;
  PERFORM teste.e3_refuz(format('UPDATE public.magazie_bucati SET perete_mm=9,server_ver=nextval(''public.izo_server_ver_seq'') WHERE id=%s',v_b),'42501','E3b: UPDATE bucată%');
  PERFORM teste.e3_mis(v_c,v_b);
  PERFORM teste.e3_refuz(format('SELECT teste.e3_mis(%s,%s)',v_c,v_b),'42501','E3b: mișcare diferită%');
  PERFORM teste.e3_refuz(format('UPDATE public.magazie_bucati SET perete_mm=10,server_ver=nextval(''public.izo_server_ver_seq'') WHERE id=%s',v_b),'42501','E3b: UPDATE bucată%');
  PERFORM teste.e3_refuz(format('UPDATE public.magazie_bucati SET perete_mm=9,diametru_mm=400,server_ver=nextval(''public.izo_server_ver_seq'') WHERE id=%s',v_b),'42501','E3b: UPDATE bucată%');
  PERFORM teste.e3_refuz(format('UPDATE public.magazie_bucati SET perete_mm=9 WHERE id=%s',v_b),'42501','E3b: UPDATE bucată%');
  PERFORM set_config('izo.receptie_ctx',txid_current()::text||'|pv|1|3|1',true);
  PERFORM teste.e3_refuz(format('UPDATE public.magazie_bucati SET perete_mm=9 WHERE id=%s',v_b),'42501','E3b: rôle / contexte incompatibile');
  PERFORM set_config('izo.receptie_ctx','',true);
  PERFORM teste.e3_refuz(format('INSERT INTO public.magazie_bucati(id,uid,radacina_id,server_ver) VALUES(%s,gen_random_uuid(),%s,nextval(''public.izo_server_ver_seq''))',v_b+100000,v_b+100000),'42501','E3b: magazie_bucati.INSERT refuzat');
  PERFORM teste.e3_refuz(format('UPDATE public.izo_corectii SET stare=''aplicata'',versiune=2,decis_de=''00000000-0000-0000-0000-000000000121'',decis_rol=session_user,decis_la=now(),eveniment_id=%s WHERE id=%s',v_e+100000,v_c),'42501','E3b: aplicare diferită');
  PERFORM set_config('test.e3_c',v_c::text,true);
  -- Martor: exact UPDATE-ul permis trece, dar decizia ramane pentru atacurile urmatoare.
  UPDATE public.magazie_bucati SET perete_mm=9,server_ver=nextval('public.izo_server_ver_seq') WHERE id=v_b;
  IF NOT FOUND THEN RAISE EXCEPTION 'E3: UPDATE pozitiv fara rand'; END IF;
END $guard$;
RESET ROLE;
-- Privilegiile suplimentare sunt strict fixture de trigger, anulate la ROLLBACK.
-- Nu apelam RPC/poarta sub ACL modificat; refuzul cerut este mesajul triggerului.
GRANT UPDATE(cale,tip,inainte,dupa,propus_de,motiv_decizie) ON public.izo_corectii TO izo_corectie_writer,izo_cor_editor;
SET LOCAL ROLE izo_corectie_writer;
DO $immutable$
DECLARE v_c bigint:=current_setting('test.e3_c')::bigint; v_set text;
BEGIN
  FOREACH v_set IN ARRAY ARRAY['cale=''propunere''','tip=''pierdut''','inainte=''{}''::jsonb',
    'dupa=''{"perete_mm":10}''::jsonb','propus_de=''00000000-0000-0000-0000-000000000030'''] LOOP
    PERFORM teste.e3_refuz(format('UPDATE public.izo_corectii SET %s,stare=''aplicata'',versiune=2,decis_de=''00000000-0000-0000-0000-000000000121'',decis_rol=session_user,decis_la=now() WHERE id=%s',v_set,v_c),'42501','E3b: coloane imutabile%');
  END LOOP;
  FOREACH v_set IN ARRAY ARRAY['respinsa','retrasa'] LOOP
    PERFORM teste.e3_refuz(format('UPDATE public.izo_corectii SET stare=%L,versiune=2,decis_de=''00000000-0000-0000-0000-000000000121'',decis_rol=session_user,decis_la=now(),motiv_decizie=''E3 decizie falsa'' WHERE id=%s',v_set,v_c),'42501','E3b: coloane imutabile%');
  END LOOP;
END $immutable$;
RESET ROLE;
SET LOCAL ROLE izo_cor_editor;
DO $editor_immutable$
DECLARE v_set text;
BEGIN
 FOREACH v_set IN ARRAY ARRAY['cale=''propunere''','tip=''pierdut''','inainte=''{}''::jsonb',
   'dupa=''{"perete_mm":10}''::jsonb','propus_de=''00000000-0000-0000-0000-000000000030'''] LOOP
   PERFORM teste.e3_refuz(format('UPDATE public.izo_corectii SET %s,stare=''retrasa'',versiune=2,decis_de=''00000000-0000-0000-0000-000000000121'',decis_rol=session_user,decis_la=now(),motiv_decizie=''E3 editor fals'' WHERE id=%s',
     v_set,current_setting('test.e3_c')),'42501','E3b: coloane imutabile%');
 END LOOP;
END $editor_immutable$;
RESET ROLE;
ROLLBACK;
"""

birth = r"""
SET LOCAL ROLE izo_cor_editor;
INSERT INTO public.izo_corectii(proiect_id,tip,inainte,dupa,motiv,propus_de)
 VALUES(3,'gasit_nou',NULL,'{"tip_cod":"teava","depozit_id":11,"serie":"E3-GASIT","sarja":"E3-S","perete_mm":8,"lungime_aviz_mm":12000}',
 'E3 garda nastere','00000000-0000-0000-0000-000000000121');
RESET ROLE;
SELECT set_config('test.e3_c',(SELECT id::text FROM public.izo_corectii WHERE motiv='E3 garda nastere'),true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
SET LOCAL ROLE izo_corectie_writer;
DO $birth$
DECLARE v_c public.izo_corectii; v_n bigint; v_e bigint; v_j jsonb; v_bad jsonb; v_id bigint;
BEGIN
 SELECT * INTO STRICT v_c FROM public.izo_corectii WHERE id=current_setting('test.e3_c')::bigint;
 v_n:=public.fn_izo_cor_marcheaza(v_c.id); v_e:=teste.e3_ev(v_c.id);
 v_j:=public.fn_izo_cor_bucata_noua(v_c)||jsonb_build_object('id',v_n,'uid',gen_random_uuid(),'radacina_id',v_n,'server_ver',nextval('public.izo_server_ver_seq'));
 FOR v_bad IN SELECT x FROM (VALUES (jsonb_build_object('id',v_n+1)),(jsonb_build_object('radacina_id',v_n+1))) j(x) LOOP
   PERFORM teste.e3_refuz(format('SELECT teste.e3_put(''magazie_bucati'',%L,public.fn_izo_coloane_c()||ARRAY[''id'',''uid'',''radacina_id'',''server_ver''])',v_j||v_bad),'42501','E3b: bucată nouă diferită');
 END LOOP;
 -- Fara id rezervat, contextul insusi trebuie refuzat.
 PERFORM set_config('izo.corectie_ctx',txid_current()::text||'|gasit_nou|'||v_c.id||'|3|1|',true);
 PERFORM teste.e3_refuz(format('SELECT teste.e3_put(''magazie_bucati'',%L,public.fn_izo_coloane_c()||ARRAY[''id'',''uid'',''radacina_id'',''server_ver''])',v_j),'42501','E3b: context absent / fals');
 PERFORM set_config('izo.corectie_ctx',txid_current()::text||'|gasit_nou|'||v_c.id||'|3|1|'||v_n,true);
 PERFORM set_config('izo.corectie_ctx',txid_current()::text||'|gasit_nou|'||v_c.id||'|3|1|'||(v_n+1),true);
 PERFORM teste.e3_refuz(format('SELECT teste.e3_put(''magazie_bucati'',%L,public.fn_izo_coloane_c()||ARRAY[''id'',''uid'',''radacina_id'',''server_ver''])',v_j),'42501','E3b: bucată nouă diferită');
 PERFORM set_config('izo.corectie_ctx',txid_current()::text||'|gasit_nou|'||v_c.id||'|3|1|'||v_n,true);
 PERFORM teste.e3_refuz(format('SELECT teste.e3_put(''magazie_bucati_miscari'',%L,public.fn_izo_coloane_mis()||ARRAY[''server_ver''])',
   jsonb_build_object('eveniment_id',v_e,'proiect_id',3,'bucata_id',v_n,'rol','nascut','stare_dupa','carantina','server_ver',nextval('public.izo_server_ver_seq'))),'42501','E3b: țintă străină');
 v_id:=teste.e3_put('magazie_bucati',v_j,public.fn_izo_coloane_c()||ARRAY['id','uid','radacina_id','server_ver']);
 PERFORM teste.e3_refuz(format('SELECT teste.e3_put(''magazie_bucati'',%L,public.fn_izo_coloane_c()||ARRAY[''id'',''uid'',''radacina_id'',''server_ver''])',v_j),'42501','E3b: bucată nouă diferită');
 PERFORM teste.e3_refuz(format('SELECT teste.e3_mis(%s,%s,''{"rol":"stare"}'')',v_c.id,v_n),'42501','E3b: mișcare diferită%');
 PERFORM teste.e3_refuz(format('SELECT teste.e3_mis(%s,%s)',v_c.id,current_setting('test.e3_b')),'42501','E3b: țintă străină');
 PERFORM teste.e3_refuz(format('UPDATE public.izo_corectii SET stare=''aplicata'',versiune=2,bucata_id=%s,decis_de=''00000000-0000-0000-0000-000000000030'',decis_rol=session_user,decis_la=now(),eveniment_id=%s WHERE id=%s',v_n,v_e,v_c.id),'42501','E3b: naștere lipsă');
 PERFORM teste.e3_mis(v_c.id,v_n);
 PERFORM teste.e3_refuz(format('UPDATE public.izo_corectii SET stare=''aplicata'',versiune=2,bucata_id=%s,decis_de=''00000000-0000-0000-0000-000000000030'',decis_rol=session_user,decis_la=now(),eveniment_id=%s WHERE id=%s',v_n+1,v_e,v_c.id),'42501','E3b: naștere lipsă');
 UPDATE public.izo_corectii SET stare='aplicata',versiune=2,bucata_id=v_n,decis_de='00000000-0000-0000-0000-000000000030',decis_rol=session_user,decis_la=now(),eveniment_id=v_e WHERE id=v_c.id;
 IF v_id<>v_n OR v_c.inainte<>'{}'::jsonb THEN RAISE EXCEPTION 'E3 nastere diferita'; END IF;
END $birth$;
RESET ROLE;
ROLLBACK;
"""

lists = r"""
-- §9.3: apartenenta la import, anulata si propunere deschisa. Fara RPC administrativ ocolit.
SET LOCAL ROLE izo_cor_editor;
INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,inainte,dupa,motiv,propus_de)
 VALUES(3,'camp',current_setting('test.e3_b')::bigint,NULL,'{"serie":"E3-PROPUSA"}','E3 propunere deschisa','00000000-0000-0000-0000-000000000121');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
UPDATE public.magazie_bucati SET stare='anulata',server_ver=nextval('public.izo_server_ver_seq') WHERE serie='E3-3';
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
SET LOCAL ROLE izo_corectie_writer;
DO $lists$
DECLARE v_c bigint; v_b bigint;
BEGIN
 INSERT INTO public.izo_corectii(proiect_id,tip,import_id,inainte,dupa,motiv,propus_de)
 VALUES(3,'storno_import','E3-import',NULL,NULL,'E3 lista garda','00000000-0000-0000-0000-000000000121') RETURNING id INTO v_c;
 FOR v_b IN SELECT id FROM public.magazie_bucati WHERE serie IN ('E3-ALT-1','E3-3','E3-1') LOOP
   PERFORM teste.e3_refuz(format('INSERT INTO public.izo_corectii_bucati(corectie_id,bucata_id) VALUES(%s,%s)',v_c,v_b),'42501','E3b: bucată storno neeligibilă');
 END LOOP;
 INSERT INTO public.izo_corectii_bucati(corectie_id,bucata_id) VALUES(v_c,current_setting('test.e3_b2')::bigint);
 IF NOT FOUND THEN RAISE EXCEPTION 'E3 lista pozitiva lipsa'; END IF;
END $lists$;
RESET ROLE;
ROLLBACK;
"""

uniqueness = api + jwt('030') + r"""
DO $unique$
DECLARE v_r jsonb; v_c bigint; v_b bigint:=current_setting('test.e3_b')::bigint;
BEGIN
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_propune(''camp'',3,%s,''{"serie":"E3-2"}'',''E3 coliziune vie'')',v_b));
 v_c:=(v_r->>'corectie_id')::bigint;
 PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
 PERFORM teste.e3_coliziune_vizibila(format('SELECT public.fn_izo_cor_aproba(%s,1)',v_c),current_setting('test.e3_b2')::bigint,3,'receptionat');
 IF (SELECT stare FROM public.izo_corectii WHERE id=v_c)<>'propusa'
    OR (SELECT serie FROM public.magazie_bucati WHERE id=v_b)<>'E3-1'
    OR EXISTS(SELECT 1 FROM public.magazie_bucati_evenimente WHERE document_tip='izo_corectie' AND document_id=v_c::text) THEN
   RAISE EXCEPTION 'E3 unicitate: efecte partiale'; END IF;
 -- Verifica intoarce detalii pentru coliziunea citibila, nu doar un text generic.
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_verifica(%s,NULL,NULL,NULL,NULL)',v_c));
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_r->'blocante') x
   WHERE (x->>'bucata_id')::bigint=current_setting('test.e3_b2')::bigint AND x->>'proiect_id'='3' AND x->>'stare'='receptionat') THEN
   RAISE EXCEPTION 'E3 lipsesc detaliile coliziunii vizibile: %',v_r; END IF;
 PERFORM set_config('test.e3_c',v_c::text,true);
END $unique$;
""" + reset + r"""
-- Aceeasi propunere trece dupa anularea piesei care ocupa seria.
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
UPDATE public.magazie_bucati SET stare='anulata',server_ver=nextval('public.izo_server_ver_seq') WHERE id=current_setting('test.e3_b2')::bigint;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
""" + api + jwt('121') + r"""
DO $free$ DECLARE v_r jsonb; BEGIN
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_aproba(%s,1)',current_setting('test.e3_c')));
 IF (SELECT serie FROM public.magazie_bucati WHERE id=current_setting('test.e3_b')::bigint)<>'E3-2' OR v_r->>'stare_dupa' IS NULL THEN
   RAISE EXCEPTION 'E3 seria anulata nu a fost eliberata'; END IF;
END $free$;
""" + reset + r"""
-- Curbe: aceeasi serie/sarja, unghiuri diferite admise, egalizarea unghiului refuzata.
""" + api + jwt('030') + r"""
DO $curve$ DECLARE v_c bigint; v_r jsonb; v_b bigint; BEGIN
 SELECT id INTO STRICT v_b FROM public.magazie_bucati WHERE serie='E3-CURBA-2';
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_propune(''camp'',3,%s,''{"serie":"E3-CURBA-1"}'',''E3 unghi diferit'')',v_b));
 PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
 PERFORM teste.e3_rpc(format('SELECT public.fn_izo_cor_aproba(%s,1)',v_r->>'corectie_id'));
 PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_propune(''camp'',3,%s,''{"unghi_curba":45}'',''E3 coliziune unghi'')',v_b));
 v_c:=(v_r->>'corectie_id')::bigint;
 PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
 PERFORM teste.e3_coliziune_vizibila(format('SELECT public.fn_izo_cor_aproba(%s,1)',v_c),
   (SELECT id FROM public.magazie_bucati WHERE serie='E3-CURBA-1' AND unghi_curba=45),3,'receptionat');
END $curve$;
""" + reset + "ROLLBACK;\n"

states = r"""
-- Stari administrate numai in fixture pentru a izola eligibilitatea propunerii.
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
UPDATE public.magazie_bucati SET stare=CASE serie WHEN 'E3-2' THEN 'pe_tronson' WHEN 'E3-3' THEN 'pierduta' WHEN 'E3-4' THEN 'anulata' ELSE 'carantina' END,
  locatie_tip=CASE WHEN serie='E3-2' THEN 'tronson' ELSE 'depozit' END,
  depozit_id=CASE WHEN serie='E3-2' THEN NULL ELSE 11 END,
  tronson_id=CASE WHEN serie='E3-2' THEN 16 ELSE NULL END,
  atribute=CASE WHEN serie='E3-2' THEN '{"depozit_origine_id":11}'::jsonb ELSE atribute END,
  server_ver=nextval('public.izo_server_ver_seq') WHERE serie IN ('E3-2','E3-3','E3-4','E3-5');
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
""" + api + jwt('030') + r"""
DO $states$
DECLARE v_b bigint; v_r jsonb;
BEGIN
 FOR v_b IN SELECT id FROM public.magazie_bucati WHERE serie IN ('E3-2','E3-3','E3-4','E3-5') LOOP
   PERFORM teste.e3_refuz(format('SELECT public.fn_izo_cor_propune(''carantina_intrare'',3,%s,''{"ncr_ref":"E3-NCR"}'',''E3 stare interzisa'')',v_b),'22023');
 END LOOP;
 PERFORM teste.e3_refuz(format('SELECT public.fn_izo_cor_propune(''gasit_recuperare'',3,%s,''{}'',''E3 recuperare stare gresita'')',current_setting('test.e3_b')),'22023','E3b: recuperare invalidă');
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_propune(''carantina_intrare'',3,%s,''{"ncr_ref":"E3-NCR"}'',''E3 CAS stare'')',current_setting('test.e3_b')));
 PERFORM set_config('test.e3_c',v_r->>'corectie_id',true);
END $states$;
""" + reset + r"""
SAVEPOINT e3_cas;
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
UPDATE public.magazie_bucati SET stare='sosit',server_ver=nextval('public.izo_server_ver_seq') WHERE id=current_setting('test.e3_b')::bigint;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
""" + api + jwt('121') + r"""
SELECT teste.e3_refuz(format('SELECT public.fn_izo_cor_aproba(%s,1)',current_setting('test.e3_c')),'40001');
""" + reset + r"""
ROLLBACK TO e3_cas;
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
UPDATE public.magazie_bucati SET depozit_id=12,server_ver=nextval('public.izo_server_ver_seq') WHERE id=current_setting('test.e3_b')::bigint;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
""" + api + jwt('121') + r"""
SELECT teste.e3_refuz(format('SELECT public.fn_izo_cor_aproba(%s,1)',current_setting('test.e3_c')),'40001');
""" + reset + "ROLLBACK;\n"

cycle = api + jwt('030') + r"""
-- §5.2: pierdut/recuperat nu deschide un episod nou de carantina.
DO $cycle$
DECLARE v_tip text; v_d jsonb; v_r jsonb; v_b bigint:=current_setting('test.e3_b')::bigint; v_stare text;
BEGIN
 FOREACH v_tip IN ARRAY ARRAY['carantina_intrare','pierdut','gasit_recuperare','carantina_iesire'] LOOP
   v_d:=CASE v_tip WHEN 'carantina_intrare' THEN '{"ncr_ref":"E3-EPISOD"}'::jsonb
     WHEN 'carantina_iesire' THEN '{"ncr_ref":"E3-INCHIS"}'::jsonb
     WHEN 'pierdut' THEN '{"cauza":"disparuta"}'::jsonb ELSE '{}'::jsonb END;
   PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
   v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_propune(%L,3,%s,%L,''E3 ciclu carantina'')',v_tip,v_b,v_d));
   PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
   PERFORM teste.e3_rpc(format('SELECT public.fn_izo_cor_aproba(%s,1)',v_r->>'corectie_id'));
   v_stare:=CASE v_tip WHEN 'carantina_intrare' THEN 'carantina' WHEN 'pierdut' THEN 'pierduta' WHEN 'gasit_recuperare' THEN 'carantina' ELSE 'receptionat' END;
   IF (SELECT stare FROM public.magazie_bucati WHERE id=v_b)<>v_stare THEN RAISE EXCEPTION 'E3 episod schimbat la %',v_tip; END IF;
 END LOOP;
END $cycle$;
""" + reset + "ROLLBACK;\n"

gasit = api + jwt('121') + r"""
DO $gasit_neg$
DECLARE v_d jsonb:='{"tip_cod":"teava","depozit_id":11,"serie":"E3-NOU","sarja":"E3-S","perete_mm":8,"lungime_aviz_mm":12000}';
 v_bad jsonb; v_r jsonb; v_key text;
BEGIN
 FOREACH v_key IN ARRAY ARRAY['perete_mm','lungime_aviz_mm'] LOOP
   PERFORM teste.e3_refuz(format('SELECT public.fn_izo_cor_propune(''gasit_nou'',3,NULL,%L,''E3 gasit incomplet'')',v_d-v_key),'22023');
 END LOOP;
 v_bad:=v_d-ARRAY['lungime_aviz_mm']||'{"tip_cod":"curba"}';
 PERFORM teste.e3_refuz(format('SELECT public.fn_izo_cor_propune(''gasit_nou'',3,NULL,%L,''E3 curba fara unghi'')',v_bad),'22023');
 PERFORM teste.e3_refuz(format('SELECT public.fn_izo_cor_propune(''gasit_nou'',NULL,NULL,%L,''E3 proiect lipsa'')',v_d),'22023');
 PERFORM teste.e3_refuz(format('SELECT public.fn_izo_cor_propune(''gasit_nou'',3,NULL,%L,''E3 site strain'')',v_d||'{"depozit_id":4}'),'22023');
 FOR v_bad IN SELECT x FROM (VALUES ('{"tip":"teava"}'::jsonb),('{"lungime_mm":12000}'::jsonb),
   ('{"stare":"receptionat"}'::jsonb),('{"atribute":{}}'::jsonb)) j(x) LOOP
   PERFORM teste.e3_refuz(format('SELECT public.fn_izo_cor_propune(''gasit_nou'',3,NULL,%L,''E3 cheie straina'')',v_d||v_bad),'22023','E3b: cheie%');
 END LOOP;
 PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_propune(''gasit_nou'',3,NULL,%L,''E3 gasit duplicat'')',v_d||'{"serie":"E3-1"}'));
 PERFORM set_config('test.e3_c',v_r->>'corectie_id',true);
 PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
 PERFORM teste.e3_coliziune_vizibila(format('SELECT public.fn_izo_cor_aproba(%s,1)',v_r->>'corectie_id'),
   current_setting('test.e3_b')::bigint,3,'receptionat');
 IF EXISTS(SELECT 1 FROM public.magazie_bucati WHERE atribute->>'corectie_id'=v_r->>'corectie_id') THEN RAISE EXCEPTION 'E3 duplicat nascut'; END IF;
END $gasit_neg$;
""" + reset + "ROLLBACK;\n"

doc = api + jwt('030') + r"""
DO $doc$
DECLARE v_r jsonb; v_d bigint; v_check jsonb; v_b bigint; v_tip text;
BEGIN
 v_r:=public.fn_izo_doc_salveaza(NULL,NULL,
   '{"proiect_id":3,"depozit_id":11,"sablon":"aviz_teava","furnizor":"E3 fixture","nr_document":"E3-DOC","data_document":"2026-10-22","total_m":12}',
   '[{"nr_crt":1,"serie":"E3-DOC-1","sarja":"E3-S","perete_mm":8,"lungime_doc_mm":12000}]',NULL);
 v_d:=(v_r->>'document_id')::bigint;
 v_check:=public.fn_izo_doc_verifica(v_d);
 PERFORM public.fn_izo_doc_confirma(v_d,(v_check->>'versiune')::bigint,v_check->>'hash');
 PERFORM set_config('izo.receptie_ctx','',true);
 SELECT id INTO STRICT v_b FROM public.magazie_bucati WHERE aviz_intrare_id=v_d;
 FOREACH v_tip IN ARRAY ARRAY['carantina_intrare','pierdut'] LOOP
   PERFORM teste.e3_refuz(format('SELECT public.fn_izo_cor_propune(%L,3,%s,%L,''E3 fara PV'')',v_tip,v_b,
     CASE WHEN v_tip='pierdut' THEN '{"cauza":"disparuta"}' ELSE '{"ncr_ref":"E3-NCR"}' END),'22023','E3b: pune întâi PV-ul');
 END LOOP;
 PERFORM public.fn_izo_doc_pv(v_d,2,'E3-PV','2026-10-22');
 PERFORM set_config('izo.receptie_ctx','',true);
 -- RPC real cu owner izo_cor_editor, care nu are UPDATE pe document.
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_propune(''gasit_nou'',3,NULL,%L,''E3 referinta document'')',
   jsonb_build_object('tip_cod','teava','depozit_id',11,'serie','E3-REF','sarja','E3-S','perete_mm',8,'lungime_aviz_mm',12000,'document_intrare_id',v_d)));
 IF v_r->'inainte' IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'E3 gasit inainte nevid'; END IF;
 PERFORM set_config('test.e3_c',v_r->>'corectie_id',true);
 PERFORM set_config('test.e3_d',v_d::text,true);
END $doc$;
""" + jwt('121') + r"""
DO $approve_ref$ DECLARE v_r jsonb; BEGIN
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_aproba(%s,1)',current_setting('test.e3_c')));
 PERFORM set_config('test.e3_found',v_r->>'bucata_id',true);
 IF NOT EXISTS(SELECT 1 FROM public.magazie_bucati WHERE id=(v_r->>'bucata_id')::bigint AND stare='carantina'
   AND aviz_intrare_id IS NULL AND nr_crt_aviz IS NULL AND sursa_receptie='manual'
   AND atribute->>'sursa'='e3b' AND atribute->>'corectie_id'=current_setting('test.e3_c')) THEN
   RAISE EXCEPTION 'E3 referinta a devenit apartenenta'; END IF;
END $approve_ref$;
""" + reset + r"""
SAVEPOINT e3_header;
SET LOCAL ROLE izo_corectie_writer;
DO $header_setup$ DECLARE v_c bigint; BEGIN
 -- F1: guard-ul valideaza si INSERT-ul intern, independent de intrarea RPC.
 PERFORM teste.e3_refuz(format('INSERT INTO public.izo_corectii(proiect_id,tip,document_intrare_id,inainte,dupa,motiv,propus_de) VALUES(3,''pv'',%s,NULL,%L,''F1 infinit'',''00000000-0000-0000-0000-000000000121'')',current_setting('test.e3_d'),'{"pv_nr":"F1","pv_data":"infinity"}'),'22023','E3b: PV invalid');
 PERFORM teste.e3_refuz(format('INSERT INTO public.izo_corectii(proiect_id,tip,document_intrare_id,inainte,dupa,motiv,propus_de) VALUES(3,''pv'',%s,NULL,%L,''F1 infinit'',''00000000-0000-0000-0000-000000000121'')',current_setting('test.e3_d'),'{"pv_nr":"F1","pv_data":"-infinity"}'),'22023','E3b: PV invalid');
 INSERT INTO public.izo_corectii(proiect_id,tip,document_intrare_id,inainte,dupa,motiv,propus_de)
 VALUES(3,'pv',current_setting('test.e3_d')::bigint,NULL,'{"pv_nr":"E3-PV-NOU","pv_data":"2026-10-23"}',
  'E3 header guard','00000000-0000-0000-0000-000000000121') RETURNING id INTO v_c;
 PERFORM public.fn_izo_cor_marcheaza(v_c); PERFORM teste.e3_ev(v_c);
END $header_setup$;
-- Proba proiectiei direct pe helper: trigger-ul E3 recanonizeaza valorile,
-- iar writer-ul nu are UPDATE pe furnizor/canoane; nu schimbam ACL-ul testului.
DO $header_canon$ DECLARE v_old jsonb; v_new jsonb; v_col text; BEGIN
 SELECT to_jsonb(d) INTO v_old FROM public.izo_documente_intrare d WHERE id=current_setting('test.e3_d')::bigint;
 v_new:=v_old || jsonb_build_object('pv_nr','E3-PV-NOU','pv_nr_canon','E3-PV-NOU','pv_data','2026-10-23','versiune',(v_old->>'versiune')::bigint+1);
 IF public.fn_izo_garda_corectie('izo_documente_intrare','UPDATE',v_old,v_new) IS NOT TRUE THEN
  RAISE EXCEPTION 'F1 PV valid refuzat'; END IF;
 -- *_canon sunt GENERATED ALWAYS (nu pot fi scrise direct): se verifică sursele lor
 FOREACH v_col IN ARRAY ARRAY['furnizor','nr_document'] LOOP
  PERFORM teste.e3_refuz(format('SELECT public.fn_izo_garda_corectie(''izo_documente_intrare'',''UPDATE'',%L::jsonb,%L::jsonb)',v_old,v_new || jsonb_build_object(v_col,'F1 fals')),'42501','E3b: UPDATE PV diferit');
 END LOOP;
END $header_canon$;
RESET ROLE;
ROLLBACK TO e3_header;
-- Anularea referintei nu modifica piesa gasita (snapshot complet).
SELECT set_config('test.e3_found_snapshot',(SELECT to_jsonb(b)::text FROM public.magazie_bucati b WHERE id=current_setting('test.e3_found')::bigint),true);
SELECT public.fn_izo_doc_anuleaza(current_setting('test.e3_d')::bigint,'E3 anulare referinta','00000000-0000-0000-0000-000000000121');
DO $ref_end$ BEGIN
 IF (SELECT to_jsonb(b) FROM public.magazie_bucati b WHERE id=current_setting('test.e3_found')::bigint)
   IS DISTINCT FROM current_setting('test.e3_found_snapshot')::jsonb THEN RAISE EXCEPTION 'E3 anularea a atins gasit_nou'; END IF;
END $ref_end$;
ROLLBACK;
"""

recovery = api + jwt('030') + r"""
DO $lost$ DECLARE v_r jsonb; BEGIN
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_propune(''pierdut'',3,%s,''{"cauza":"disparuta"}'',''E3 depozit recuperare'')',current_setting('test.e3_b')));
 PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
 PERFORM teste.e3_rpc(format('SELECT public.fn_izo_cor_aproba(%s,1)',v_r->>'corectie_id'));
END $lost$;
""" + reset + r"""
UPDATE public.logistica_depozite SET activ=false WHERE id=12;
""" + api + jwt('121') + r"""
DO $recovery$ DECLARE v_dep int; BEGIN
 FOREACH v_dep IN ARRAY ARRAY[12,4] LOOP
   PERFORM teste.e3_refuz(format('SELECT public.fn_izo_cor_propune(''gasit_recuperare'',3,%s,%L,''E3 depozit invalid'')',current_setting('test.e3_b'),jsonb_build_object('depozit_id',v_dep)),'22023','E3b: depozit invalid');
 END LOOP;
END $recovery$;
""" + reset + "ROLLBACK;\n"

cross = r"""
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
INSERT INTO public.izo_proiect_config(proiect_id,nivel_izo,server_ver) VALUES(2,'stoc',nextval('public.izo_server_ver_seq'));
UPDATE public.magazie_bucati SET proiect_id=2,locatie_site_id=9,depozit_id=4,server_ver=nextval('public.izo_server_ver_seq') WHERE serie='E3-6';
UPDATE public.magazie_bucati SET stare='taiata',server_ver=nextval('public.izo_server_ver_seq') WHERE serie='E3-4';
UPDATE public.magazie_bucati SET parinte_id=(SELECT id FROM public.magazie_bucati WHERE serie='E3-4'),
 radacina_id=(SELECT id FROM public.magazie_bucati WHERE serie='E3-4'),serie='E3-LEAF',cod_bucata='AC',capat_dreapta='C',
 server_ver=nextval('public.izo_server_ver_seq') WHERE serie='E3-5';
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
INSERT INTO public.izo_atribuiri(proiect_id,profile_id,rol,depozit_id,acordat_de,motiv)
 VALUES(3,'00000000-0000-0000-0000-000000000030','manager_aprobator',NULL,'test','E3 responsabil non-owner');
""" + api + jwt('121') + r"""
DO $cross_visible$
DECLARE v_r jsonb; v_id bigint;
BEGIN
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_propune(''camp'',3,%s,''{"serie":"E3-6"}'',''E3 coliziune proiect strain'')',current_setting('test.e3_b')));
 PERFORM set_config('test.e3_c',v_r->>'corectie_id',true);
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_verifica(%s,NULL,NULL,NULL,NULL)',v_r->>'corectie_id'));
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_r->'blocante') x WHERE x->>'proiect_id'='2'
   AND x->>'bucata_id' IS NOT NULL AND x->>'stare'='receptionat') THEN RAISE EXCEPTION 'E3 cross: owner fara detalii: %',v_r; END IF;
END $cross_visible$;
""" + jwt('030') + r"""
DO $cross_hidden$
DECLARE v_r jsonb;
BEGIN
 IF public.fn_izo_citire(2) THEN RAISE EXCEPTION 'E3 martorul citeste proiectul ascuns'; END IF;
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_verifica(%s,NULL,NULL,NULL,NULL)',current_setting('test.e3_c')));
 IF v_r->'blocante'<>'[]'::jsonb OR jsonb_array_length(v_r->'avertismente')=0 THEN
   RAISE EXCEPTION 'E3 cross: dezvaluire sau certificare globala falsa: %',v_r; END IF;
 PERFORM teste.e3_refuz(format('SELECT public.fn_izo_cor_aproba(%s,1)',current_setting('test.e3_c')),'23505','E3b: seria / combinația există deja în registru, pe un proiect la care nu ai acces');
 IF EXISTS(SELECT 1 FROM public.magazie_bucati_evenimente WHERE document_tip='izo_corectie' AND document_id=current_setting('test.e3_c')) THEN
   RAISE EXCEPTION 'E3 cross: efecte dupa coliziune'; END IF;
 -- Inchidem propunerea, apoi coliziune exclusiv cu o frunza (nu o radacina vie).
 PERFORM teste.e3_rpc(format('SELECT public.fn_izo_cor_respinge(%s,1,''E3 trecere la frunza'')',current_setting('test.e3_c')));
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_propune(''camp'',3,%s,''{"serie":"E3-LEAF"}'',''E3 coliziune frunza'')',current_setting('test.e3_b')));
 PERFORM set_config('test.e3_c',v_r->>'corectie_id',true);
END $cross_hidden$;
""" + jwt('121') + r"""
SELECT teste.e3_coliziune_vizibila(format('SELECT public.fn_izo_cor_aproba(%s,1)',current_setting('test.e3_c')),
 (SELECT id FROM public.magazie_bucati WHERE serie='E3-LEAF'),3,'receptionat');
""" + reset + "ROLLBACK;\n"

projection = birth[:birth.index('DO $birth$')] + r"""
DO $projection_c$
DECLARE v_c public.izo_corectii; v_n bigint; v_j jsonb; v_bad jsonb; v_k text; v_oid oid; v_value jsonb; v_count int:=0;
BEGIN
 SELECT * INTO STRICT v_c FROM public.izo_corectii WHERE id=current_setting('test.e3_c')::bigint;
 v_n:=public.fn_izo_cor_marcheaza(v_c.id); PERFORM teste.e3_ev(v_c.id);
 v_j:=public.fn_izo_cor_bucata_noua(v_c)||jsonb_build_object('id',v_n,'uid',gen_random_uuid(),'radacina_id',v_n,'server_ver',nextval('public.izo_server_ver_seq'));
 FOREACH v_k IN ARRAY public.fn_izo_coloane_c() LOOP
   SELECT atttypid INTO STRICT v_oid FROM pg_attribute WHERE attrelid='public.magazie_bucati'::regclass AND attname=v_k;
   -- NULL pentru o valoare nenula; pentru NULL folosim o valoare tipizabila,
   -- astfel esecul vine din proiectie, nu din cast sau CHECK/FK.
   v_value:=CASE WHEN v_j->v_k IS DISTINCT FROM 'null'::jsonb THEN 'null'::jsonb
     WHEN v_oid IN ('int2'::regtype,'int4'::regtype,'int8'::regtype,'numeric'::regtype,'float8'::regtype) THEN '17'::jsonb
     WHEN v_oid='bool'::regtype THEN 'true'::jsonb WHEN v_oid='jsonb'::regtype THEN '{"E3":"mutant"}'::jsonb
     WHEN v_oid='date'::regtype THEN '"2026-10-23"'::jsonb
     WHEN v_oid IN ('timestamp'::regtype,'timestamptz'::regtype) THEN '"2026-10-23T10:00:00Z"'::jsonb
     WHEN v_oid='uuid'::regtype THEN '"00000000-0000-0000-0000-000000000030"'::jsonb ELSE '"E3-MUTANT"'::jsonb END;
   v_bad:=v_j||jsonb_build_object(v_k,v_value);
   PERFORM teste.e3_refuz(format('SELECT teste.e3_put(''magazie_bucati'',%L,public.fn_izo_coloane_c()||ARRAY[''id'',''uid'',''radacina_id'',''server_ver''])',v_bad),'42501','E3b: bucată nouă diferită');
   v_count:=v_count+1;
 END LOOP;
 IF v_count<>51 THEN RAISE EXCEPTION 'E3 C incompleta: %',v_count; END IF;
 -- Martor pozitiv, aceeasi forma de INSERT fara mutatie.
 PERFORM teste.e3_put('magazie_bucati',v_j,public.fn_izo_coloane_c()||ARRAY['id','uid','radacina_id','server_ver']);
END $projection_c$;
RESET ROLE;
ROLLBACK;
"""

positive_l = """
-- lista C citită ca postgres (helper-ele interne E3 n-au EXECUTE pentru API; un GRANT ar înroși poarta)
SELECT set_config('test.e3_cols', array_to_string(public.fn_izo_coloane_c(), ','), true);
""" + api + jwt('121') + r"""
DO $positive_l$
DECLARE v_tip text; v_k text; v_b bigint; v_value jsonb; v_d jsonb; v_r jsonb; v_before jsonb; v_after jsonb; v_n int:=0; v_allowed text[];
 v_teava text[]:=ARRAY['serie','sarja','lot','lungime_aviz_mm','lungime_masurata_mm','perete_mm','diametru_mm','greutate_kg','dimensiune','grad_otel','standard','izolatie'];
 v_curba text[]:=ARRAY['serie','sarja','lot','unghi_curba','perete_mm','diametru_mm','greutate_kg','dimensiune','grad_otel','standard','izolatie'];
BEGIN
 FOREACH v_tip IN ARRAY ARRAY['teava','curba'] LOOP
   SELECT id INTO STRICT v_b FROM public.magazie_bucati WHERE serie=CASE v_tip WHEN 'teava' THEN 'E3-1' ELSE 'E3-CURBA-1' END;
   -- Lista asteptata vine din design §2.5, nu din functia testata.
   FOREACH v_k IN ARRAY (CASE v_tip WHEN 'teava' THEN v_teava ELSE v_curba END) LOOP
     BEGIN
       SELECT to_jsonb(b) INTO v_before FROM public.magazie_bucati b WHERE id=v_b;
       v_value:=CASE v_k WHEN 'lungime_aviz_mm' THEN '11000'::jsonb WHEN 'lungime_masurata_mm' THEN '11500'::jsonb
         WHEN 'unghi_curba' THEN '60'::jsonb WHEN 'perete_mm' THEN '9'::jsonb WHEN 'diametru_mm' THEN '400'::jsonb
         WHEN 'greutate_kg' THEN '42'::jsonb WHEN 'izolatie' THEN '"GRP"'::jsonb ELSE to_jsonb('E3-NOU-'||v_k) END;
       v_d:=jsonb_build_object(v_k,v_value);
       IF v_k=ANY(ARRAY['serie','sarja','lot','lungime_aviz_mm','lungime_masurata_mm','unghi_curba']) THEN
         PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
         v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_propune(''camp'',3,%s,%L,''E3 pozitiv L'')',v_b,v_d));
         PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
         v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_aproba(%s,1)',v_r->>'corectie_id'));
       ELSE
         v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_camp(%s,%s,%L,''E3 pozitiv L'')',v_b,v_before->>'server_ver',v_d));
       END IF;
       SELECT to_jsonb(b) INTO v_after FROM public.magazie_bucati b WHERE id=v_b;
       IF v_after->v_k IS DISTINCT FROM v_value OR v_after->'server_ver'=v_before->'server_ver' THEN
         RAISE EXCEPTION 'E3 L valoare incorecta %/%',v_tip,v_k; END IF;
       v_allowed:=ARRAY[v_k]||CASE WHEN v_k IN ('lungime_aviz_mm','lungime_masurata_mm') THEN ARRAY['lungime_mm','lungime_m','lungime_originala_m'] ELSE '{}'::text[] END;
       IF ((SELECT coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) FROM jsonb_each(v_after) e WHERE e.key = ANY(string_to_array(current_setting('test.e3_cols'),',')))-v_allowed)
         IS DISTINCT FROM ((SELECT coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) FROM jsonb_each(v_before) e WHERE e.key = ANY(string_to_array(current_setting('test.e3_cols'),',')))-v_allowed) THEN
         RAISE EXCEPTION 'E3 L a schimbat coloane suplimentare %/%',v_tip,v_k; END IF;
       IF (SELECT count(*) FROM public.magazie_bucati_miscari WHERE eveniment_id=(v_r->>'eveniment_id')::bigint)<>1
         OR NOT EXISTS(SELECT 1 FROM public.izo_corectii WHERE id=(v_r->>'corectie_id')::bigint AND stare='aplicata') THEN
         RAISE EXCEPTION 'E3 L fara audit complet %/%',v_tip,v_k; END IF;
       IF v_k IN ('lungime_aviz_mm','lungime_masurata_mm') AND (
         (v_after->>'lungime_mm')::numeric<>(v_value#>>'{}')::numeric
         OR (v_after->>'lungime_m')::numeric<>(v_value#>>'{}')::numeric/1000
         OR (v_after->>'lungime_originala_m')::numeric<>(v_value#>>'{}')::numeric/1000) THEN
         RAISE EXCEPTION 'E3 derivate incorecte pentru %',v_k; END IF;
       -- Anulam fiecare succes, pastram numai numaratoarea in afara subtranzactiei.
       RAISE EXCEPTION 'E3 succes izolat' USING ERRCODE='ZE302';
     EXCEPTION WHEN SQLSTATE 'ZE302' THEN NULL;
     END;
     v_n:=v_n+1;
   END LOOP;
 END LOOP;
 IF v_n<>23 THEN RAISE EXCEPTION 'E3 L incomplet: %',v_n; END IF;
END $positive_l$;
""" + reset + "ROLLBACK;\n"

# §9.4 cere UPDATE pe fiecare coloana C, nu numai INSERT-ul gasit_nou.
# Refolosim mutatorul tipizat, dar martorul este o corectie camp cu miscare.
projection_update = r"""
SET LOCAL ROLE izo_corectie_writer;
DO $setup_c_update$ DECLARE v_c bigint; BEGIN
 INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,inainte,dupa,motiv,propus_de)
 VALUES(3,'camp',current_setting('test.e3_b')::bigint,NULL,'{"perete_mm":9}','E3 C UPDATE','00000000-0000-0000-0000-000000000121') RETURNING id INTO v_c;
 PERFORM public.fn_izo_cor_marcheaza(v_c); PERFORM teste.e3_ev(v_c);
 PERFORM teste.e3_mis(v_c,current_setting('test.e3_b')::bigint);
 PERFORM set_config('test.e3_c',v_c::text,true);
END $setup_c_update$;
RESET ROLE;
DO $grants_fixture$ DECLARE v_cols text; BEGIN
 SELECT string_agg(format('%I',x),',') INTO v_cols FROM unnest(public.fn_izo_coloane_c()) x;
 EXECUTE format('GRANT UPDATE(%s) ON public.magazie_bucati TO izo_corectie_writer',v_cols);
END $grants_fixture$;
SET LOCAL ROLE izo_corectie_writer;
""" + projection[projection.index('DO $projection_c$'):projection.index('RESET ROLE;\nROLLBACK;')]
projection_update = projection_update.replace('v_n:=public.fn_izo_cor_marcheaza(v_c.id); PERFORM teste.e3_ev(v_c.id);',
    "v_n:=current_setting('test.e3_b')::bigint;")
projection_update = projection_update.replace("v_j:=public.fn_izo_cor_bucata_noua(v_c)||jsonb_build_object('id',v_n,'uid',gen_random_uuid(),'radacina_id',v_n,'server_ver',nextval('public.izo_server_ver_seq'));",
    "SELECT to_jsonb(b)||jsonb_build_object('perete_mm',9,'server_ver',nextval('public.izo_server_ver_seq')) INTO v_j FROM public.magazie_bucati b WHERE id=v_n;")
projection_update = projection_update.replace("format('SELECT teste.e3_put(''magazie_bucati'',%L,public.fn_izo_coloane_c()||ARRAY[''id'',''uid'',''radacina_id'',''server_ver''])',v_bad),'42501','E3b: bucată nouă diferită'",
    "format('SELECT teste.e3_upd(%s,%L)',v_n,v_bad),'42501','E3b: UPDATE bucată%'")
projection_update = projection_update.replace("PERFORM teste.e3_put('magazie_bucati',v_j,public.fn_izo_coloane_c()||ARRAY['id','uid','radacina_id','server_ver']);",
    "IF teste.e3_upd(v_n,v_j) IS DISTINCT FROM v_n THEN RAISE EXCEPTION 'E3 UPDATE pozitiv fara rand'; END IF;")
projection_update = projection_update.replace('aceeasi forma de INSERT fara mutatie','aceeasi forma de UPDATE fara mutatie')
projection_update += 'RESET ROLE;\nROLLBACK;\n'

derivatives = r"""
SET LOCAL ROLE izo_cor_editor;
INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,inainte,dupa,motiv,propus_de)
 VALUES(3,'camp',current_setting('test.e3_b')::bigint,NULL,'{"lungime_aviz_mm":11000}','E3 derivate guard','00000000-0000-0000-0000-000000000121');
RESET ROLE;
SELECT set_config('test.e3_c',(SELECT id::text FROM public.izo_corectii WHERE motiv='E3 derivate guard'),true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
SET LOCAL ROLE izo_corectie_writer;
DO $derivatives$
DECLARE v_c bigint:=current_setting('test.e3_c')::bigint; v_b bigint:=current_setting('test.e3_b')::bigint; v_col text;
BEGIN
 PERFORM public.fn_izo_cor_marcheaza(v_c); PERFORM teste.e3_ev(v_c); PERFORM teste.e3_mis(v_c,v_b);
 FOREACH v_col IN ARRAY ARRAY['lungime_mm','lungime_m','lungime_originala_m'] LOOP
   PERFORM teste.e3_refuz(format('UPDATE public.magazie_bucati SET lungime_aviz_mm=11000,lungime_mm=%s,lungime_m=%s,lungime_originala_m=%s,server_ver=nextval(''public.izo_server_ver_seq'') WHERE id=%s',
     CASE WHEN v_col='lungime_mm' THEN 12000 ELSE 11000 END,
     CASE WHEN v_col='lungime_m' THEN 12 ELSE 11 END,
     CASE WHEN v_col='lungime_originala_m' THEN 12 ELSE 11 END,v_b),'42501','E3b: UPDATE bucată%');
 END LOOP;
END $derivatives$;
RESET ROLE;
ROLLBACK;
"""

sections = [('-- §9.3 garda executata', guards), ('-- §9.3 gasit_nou: id/nascut/legatura', birth),
    ('-- §9.3 lista storno',lists),('-- §9.5 unicitate',uniqueness),('-- §9.5 proiecte/frunza',cross),('-- §9.6 stari/CAS',states),
    ('-- §9.6 episod carantina',cycle),('-- §9.6 recuperare depozite',recovery),
    ('-- §9.7 gasit_nou negative',gasit),('-- §9.3/9.6/9.7 document real/PV/referinta',doc),
    ('-- §9.4 proiectie UPDATE C (51 coloane)',projection_update),
    ('-- §9.4 proiectie INSERT C (51 coloane)',projection),('-- §9.4 L_teava/L_curba (23 chei)',positive_l),
    ('-- §9.4 derivate',derivatives)]
OUT.write_text('-- Generat de scripts/izometrie/e3b_build_garzi.py; fara acces BD.\n'
    + "DO $safe$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $safe$;\n"
    + '\n'.join(label+fixture()+body for label,body in sections)
    + "\nDO $end$ BEGIN IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'E3 a lasat poarta rosie'; END IF; RAISE NOTICE 'TESTE E3b-E3: TOATE OK'; END $end$;\n", encoding='utf-8', newline='\n')
print(OUT.relative_to(ROOT))
