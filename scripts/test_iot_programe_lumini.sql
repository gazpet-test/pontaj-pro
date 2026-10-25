-- Toate datele testului se anuleaza; rollback-ul migrarii se testeaza separat.
BEGIN;
-- Aceleasi cazuri JSON sunt rulate de Node/JS si aici prin RPC-ul real.
SELECT set_config('test.lumini_cases', :'lumini_cases', true);
CREATE FUNCTION public.lumini_assert(p_ok boolean,p_msg text) RETURNS void LANGUAGE plpgsql AS $test_assert$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',p_msg;END IF;END $test_assert$;
CREATE FUNCTION public.lumini_refuz(p_sql text) RETURNS void LANGUAGE plpgsql AS $test_refuz$
DECLARE refuz boolean:=false;
BEGIN
 BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN refuz:=true;END;
 IF NOT refuz THEN RAISE EXCEPTION 'FAIL: trebuia refuzat: %',p_sql;END IF;
END $test_refuz$;
SELECT public.lumini_assert(NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'owner nesuperuser');
SELECT public.lumini_assert((SELECT count(*)=4 FROM pg_class WHERE oid IN ('public.iot_lumini'::regclass,'public.iot_program_lumini'::regclass,'public.iot_lumini_setari'::regclass,'public.iot_lumini_jurnal'::regclass) AND relrowsecurity),'RLS toate tabelele');
SELECT public.lumini_assert((SELECT count(*)=1 FROM public.iot_lumini WHERE rol='exterior' AND dispozitiv_id=85462),'seed exterior');
SELECT public.lumini_assert((SELECT count(*)=2 FROM public.iot_lumini WHERE rol='mixt'),'seed mixt');
SELECT public.lumini_assert(NOT has_function_privilege('authenticated','public.iot_lumini_runtime(text,text,jsonb)','EXECUTE'),'runtime privat');
SELECT public.lumini_assert(NOT has_function_privilege('anon','public.iot_lumini_salveaza(text,jsonb)','EXECUTE'),'anon fara RPC');
SELECT public.lumini_assert(NOT has_table_privilege('authenticated','public.iot_lumini_jurnal','UPDATE,DELETE,INSERT'),'jurnal append-only pentru UI');
SELECT public.lumini_assert((SELECT command='SELECT public.iot_lumini_cron_tick()' FROM cron.job WHERE jobname='iot_lumini_tick_5min'),'cron fara secrete');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT public.lumini_assert((SELECT count(*)=0 FROM public.iot_lumini),'RLS cere auth.uid');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SELECT public.lumini_assert((SELECT count(*)=6 FROM public.iot_lumini),'viewer citeste');
SELECT public.lumini_assert(NOT public.iot_lumini_drept(false),'viewer nu scrie');
SELECT public.lumini_refuz($test_viewer$SELECT public.iot_lumini_salveaza('program','{"nume":"Refuz","tip":"solar","dispozitive":[85462]}')$test_viewer$);
SELECT public.lumini_refuz('INSERT INTO public.iot_lumini_jurnal(dispozitiv_id,comanda,sursa,ok) VALUES(85462,true,''manual'',true)');
SELECT public.lumini_refuz('UPDATE public.iot_lumini SET rol=''interior'' WHERE dispozitiv_id=85462');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
SELECT public.lumini_assert(NOT public.iot_lumini_drept(false),'alt modul admin refuzat');
SELECT public.lumini_refuz($test_alt$SELECT public.iot_lumini_salveaza('program','{"nume":"Refuz","tip":"solar","dispozitive":[85462]}')$test_alt$);

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
DO $test_parametri_reali$
DECLARE c jsonb; acceptat boolean; v_role text; v_tip text; v_id integer;
BEGIN
 FOR c IN SELECT value FROM jsonb_array_elements(current_setting('test.lumini_cases')::jsonb) LOOP
  acceptat:=true;
  BEGIN
   PERFORM public.iot_lumini_salveaza('program',jsonb_build_object('nume','Paritate parametri','tip',c->>'tip','dispozitive',jsonb_build_array(85458),'parametri',c->'parametri'));
  EXCEPTION WHEN OTHERS THEN acceptat:=false;
  END;
  PERFORM public.lumini_assert(acceptat=(c->>'valid')::boolean,'paritate RPC/JS: '||c::text);
 END LOOP;
 -- Matrice completa rol/tip evaluata prin RPC, fara extragere regex.
 FOR v_role,v_id IN SELECT rol,dispozitiv_id FROM public.iot_lumini WHERE dispozitiv_id IN (85462,85458,85457) LOOP
  FOREACH v_tip IN ARRAY ARRAY['solar','orar','simulare_prezenta'] LOOP
   acceptat:=true;
   BEGIN
    PERFORM public.iot_lumini_salveaza('program',jsonb_build_object('nume','Paritate rol','tip',v_tip,'dispozitive',jsonb_build_array(v_id),'parametri',CASE WHEN v_tip='orar' THEN '{"pornire":"18:00","oprire":"06:00","zile":[0]}'::jsonb ELSE '{}'::jsonb END));
   EXCEPTION WHEN OTHERS THEN acceptat:=false;
   END;
   PERFORM public.lumini_assert(acceptat=(NOT ((v_tip='solar' AND v_role='interior') OR (v_tip='simulare_prezenta' AND v_role='exterior'))),'matrice RPC: '||v_tip||'/'||v_role);
  END LOOP;
 END LOOP;
END $test_parametri_reali$;
SELECT public.iot_lumini_salveaza('program','{"nume":"Solar test","tip":"solar","dispozitive":[85462],"activ":true,"aprobat_de":"00000000-0000-0000-0000-000000000002"}');
SELECT public.lumini_assert((SELECT NOT activ AND aprobat_de IS NULL AND aprobat_la IS NULL FROM public.iot_program_lumini WHERE nume='Solar test'),'program nou inactiv, ignora injectare aprobare');
SELECT public.lumini_refuz(format('SELECT public.iot_lumini_salveaza(''aprobare'',%L)',jsonb_build_object('id',(SELECT id FROM public.iot_program_lumini WHERE nume='Solar test'),'activ',true)));
SELECT public.lumini_refuz($test_exterior$SELECT public.iot_lumini_salveaza('program','{"nume":"Sim invalid","tip":"simulare_prezenta","dispozitive":[85462]}')$test_exterior$);
SELECT public.lumini_refuz($test_lista$SELECT public.iot_lumini_salveaza('program','{"nume":"Lista invalida","tip":"solar","dispozitive":[123]}')$test_lista$);
SELECT public.lumini_refuz($test_setari$SELECT public.iot_lumini_salveaza('setari','{"lat":44.94,"lon":26.03,"simulare_pana_la":"23:30"}')$test_setari$);

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT public.iot_lumini_salveaza('aprobare',jsonb_build_object('id',(SELECT id FROM public.iot_program_lumini WHERE nume='Solar test'),'activ',true));
SELECT public.lumini_assert((SELECT activ AND aprobat_de=auth.uid() FROM public.iot_program_lumini WHERE nume='Solar test'),'owner aproba');
SELECT public.iot_lumini_salveaza('program','{"nume":"Conflict","tip":"solar","dispozitive":[85462]}');
SELECT public.lumini_refuz(format('SELECT public.iot_lumini_salveaza(''aprobare'',%L)',jsonb_build_object('id',(SELECT id FROM public.iot_program_lumini WHERE nume='Conflict'),'activ',true)));
SELECT public.iot_lumini_salveaza('program',jsonb_build_object('id',(SELECT id FROM public.iot_program_lumini WHERE nume='Solar test'),'nume','Solar editat','tip','solar','dispozitive',jsonb_build_array(85462)));
SELECT public.lumini_assert((SELECT NOT activ AND aprobat_de IS NULL FROM public.iot_program_lumini WHERE nume='Solar editat'),'editare anuleaza aprobare inclusiv owner');
SELECT public.iot_lumini_salveaza('program','{"nume":"Sim mixt","tip":"simulare_prezenta","dispozitive":[85458,85460],"parametri":{"sfarsit":"23:30"}}');
SELECT public.iot_lumini_salveaza('aprobare',jsonb_build_object('id',(SELECT id FROM public.iot_program_lumini WHERE nume='Sim mixt'),'activ',true));
SELECT public.iot_lumini_salveaza('rol','{"dispozitiv_id":85458,"rol":"exterior"}');
SELECT public.lumini_assert((SELECT NOT activ AND aprobat_de IS NULL FROM public.iot_program_lumini WHERE nume='Sim mixt'),'rol schimbat invalideaza program');
SELECT public.lumini_refuz($test_vacanta$SELECT public.iot_lumini_salveaza('setari','{"lat":44.94,"lon":26.03,"vacanta_de":"2026-12-24","simulare_pana_la":"23:30"}')$test_vacanta$);
RESET ROLE;
-- Expiram determinist lease-ul, fara asteptare si fara privilegii UI suplimentare.
UPDATE public.iot_lumini_setari SET runtime=jsonb_build_object('token','expirat','lease_pana',clock_timestamp()-interval '1 second','programe',jsonb_build_object('_intentii',jsonb_build_object('test',jsonb_build_object('stare','in_curs')))) WHERE id=true;
SET LOCAL ROLE service_role;
SELECT public.lumini_assert(NOT (public.iot_lumini_runtime('save','expirat','{}')->>'ok')::boolean,'save lease expirat refuzat');
SELECT public.lumini_assert(NOT (public.iot_lumini_runtime('reserve','expirat')->>'ok')::boolean,'POST cu lease expirat refuzat');
SELECT public.lumini_assert((public.iot_lumini_runtime('acquire','succesor')->>'ok')::boolean,'succesor dupa expirare');
SELECT public.lumini_assert(NOT (public.iot_lumini_runtime('release','expirat')->>'ok')::boolean,'worker vechi nu elibereaza succesorul');
SELECT public.lumini_assert((public.iot_lumini_runtime('acquire','concurent')->>'ok')::boolean=false,'lease succesor ramane ocupat');
SELECT public.lumini_assert((public.iot_lumini_runtime('acquire','concurent')->'runtime') IS NULL,'refuz fara snapshot pentru concurent');
SELECT public.lumini_assert((SELECT runtime->'programe'->'_intentii'->'test'->>'stare'='in_curs' FROM public.iot_lumini_setari WHERE id=true),'intentie pastrata dupa expirare');
SELECT public.iot_lumini_runtime('release','succesor');
RESET ROLE;
UPDATE public.iot_lumini_setari SET runtime='{}' WHERE id=true;

SET LOCAL ROLE service_role;
SELECT public.lumini_assert((public.iot_lumini_runtime('acquire','token-a')->>'ok')::boolean,'lease acquire');
SELECT public.lumini_assert(NOT (public.iot_lumini_runtime('acquire','token-b')->>'ok')::boolean,'lease concurenta refuzata');
SELECT public.lumini_assert(NOT (public.iot_lumini_runtime('reserve','token-b')->>'ok')::boolean,'token strain refuzat');
DO $test_tick_cap$
BEGIN
 FOR i IN 1..12 LOOP PERFORM public.lumini_assert((public.iot_lumini_runtime('reserve','token-a')->>'ok')::boolean,'primele 12');END LOOP;
 PERFORM public.lumini_assert(NOT (public.iot_lumini_runtime('reserve','token-a')->>'ok')::boolean,'comanda 13 refuzata');
 PERFORM public.iot_lumini_runtime('release','token-a');
 FOR j IN 1..3 LOOP
  PERFORM public.iot_lumini_runtime('acquire','token-a');
  FOR i IN 1..12 LOOP PERFORM public.iot_lumini_runtime('reserve','token-a');END LOOP;
  PERFORM public.iot_lumini_runtime('release','token-a');
 END LOOP;
 PERFORM public.iot_lumini_runtime('acquire','token-a');
 PERFORM public.lumini_assert(NOT (public.iot_lumini_runtime('reserve','token-a')->>'ok')::boolean,'comanda 41 refuzata');
 PERFORM public.iot_lumini_runtime('release','token-a');
END $test_tick_cap$;
INSERT INTO public.iot_lumini_jurnal(dispozitiv_id,comanda,sursa,ok) VALUES(85462,true,'manual',false);
RESET ROLE;
SELECT public.lumini_assert((SELECT count(*)=1 FROM public.notifications WHERE title='Lumini sediu: plafon comenzi atins'),'notificare dedup');
SET LOCAL ROLE authenticated;
SELECT public.lumini_assert((SELECT count(*)=1 FROM public.iot_lumini_jurnal),'jurnal vizibil');
SELECT public.lumini_refuz('UPDATE public.iot_lumini_jurnal SET ok=true WHERE dispozitiv_id=85462');
SELECT public.lumini_refuz('DELETE FROM public.iot_lumini_jurnal WHERE dispozitiv_id=85462');
RESET ROLE;
ROLLBACK;
