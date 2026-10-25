-- Isolated fixture only. Called by scripts/test_iot_ups_alerte.sh.
DO $ups_tests$
DECLARE
  pct integer;
  expected integer;
  actual integer;
  sample jsonb;
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'test owner must be nonsuperuser';
  END IF;
  -- No UPS: all existing temperature/disk/AI alerts, unchanged.
  UPDATE public.iot_dispozitive SET ultima_citire =
    '{"online":true,"cpu_temp":90,"hdd_max":55,"gpu_temp":81,"disk_pct":95,"ai_gemini_ramas_pct":12}' WHERE id=1;
  PERFORM public.iot_verifica_retea();
  IF (SELECT count(*) FROM public.notifications) <> 5
    OR (SELECT count(*) FROM public.notifications WHERE type='error') <> 1
    OR EXISTS (SELECT 1 FROM public.notifications WHERE title LIKE 'UPS:%') THEN
    RAISE EXCEPTION 'regression: existing metric rules';
  END IF;
  -- Compare exact titles, messages and types with pre-migration baseline.
  IF EXISTS ((SELECT type,title,message FROM public.notifications EXCEPT SELECT type,title,message FROM public.baseline)
    UNION ALL (SELECT type,title,message FROM public.baseline EXCEPT SELECT type,title,message FROM public.notifications)) THEN
    RAISE EXCEPTION 'regression: old alerts differ';
  END IF;
  DELETE FROM public.notifications WHERE true;
  UPDATE public.iot_dispozitive SET ultima_citire='{"online":true,"ups_pct":20,"ups_pe_baterie":false}' WHERE id=1;
  PERFORM public.iot_verifica_retea();
  IF EXISTS (SELECT 1 FROM public.notifications) THEN RAISE EXCEPTION 'UPS on mains must be silent'; END IF;

  FOREACH pct IN ARRAY ARRAY[80,50,40,25,20,0] LOOP
    DELETE FROM public.notifications WHERE true;
    UPDATE public.iot_dispozitive SET ultima_citire=jsonb_build_object('online',true,'ups_pe_baterie',true,'ups_pct',pct,'ups_runtime_min',12) WHERE id=1;
    PERFORM public.iot_verifica_retea();
    expected := 1 + CASE WHEN pct < 50 THEN 1 ELSE 0 END + CASE WHEN pct < 25 THEN 1 ELSE 0 END;
    SELECT count(*) INTO actual FROM public.notifications;
    IF actual <> expected THEN RAISE EXCEPTION 'UPS pct %, expected %, got %', pct,expected,actual; END IF;
    IF (SELECT count(*) FROM public.notifications WHERE type='warning' AND title='UPS: serverul AI ruleaza pe baterie'
      AND message LIKE '%' || pct || ' % - autonomie estimata 12 min%') <> 1 THEN RAISE EXCEPTION 'warning title/message'; END IF;
    IF (SELECT count(*) FROM public.notifications WHERE type='error' AND title='UPS: baterie sub 50% pe server') <> (CASE WHEN pct < 50 THEN 1 ELSE 0 END) THEN RAISE EXCEPTION '50 threshold/title'; END IF;
    IF (SELECT count(*) FROM public.notifications WHERE type='error' AND title='UPS: oprire iminenta (Windows opreste serverul la 20%)') <> (CASE WHEN pct < 25 THEN 1 ELSE 0 END) THEN RAISE EXCEPTION '25 threshold/title'; END IF;
    PERFORM public.iot_verifica_retea();
    IF (SELECT count(*) FROM public.notifications) <> expected THEN RAISE EXCEPTION 'dedup duplicated alerts'; END IF;
  END LOOP;
  -- No pct or runtime: warning remains useful and no invalid numeric casts.
  FOREACH sample IN ARRAY ARRAY['{"online":true,"ups_pe_baterie":true}'::jsonb,
    '{"online":true,"ups_pe_baterie":true,"ups_pct":"20","ups_runtime_min":null}'::jsonb] LOOP
    DELETE FROM public.notifications WHERE true;
    UPDATE public.iot_dispozitive SET ultima_citire=sample WHERE id=1;
    PERFORM public.iot_verifica_retea();
    IF (SELECT count(*) FROM public.notifications) <> 1 THEN RAISE EXCEPTION 'missing UPS numeric fields'; END IF;
  END LOOP;
  DELETE FROM public.notifications WHERE true;
  UPDATE public.iot_dispozitive SET ultima_citire='{"online":true,"ups_pe_baterie":"true","ups_pct":20}' WHERE id=1;
  PERFORM public.iot_verifica_retea();
  IF EXISTS (SELECT 1 FROM public.notifications) THEN RAISE EXCEPTION 'string true is not boolean'; END IF;
  -- Offline / stale server keeps exactly one existing network alert, no UPS alerts.
  FOR actual IN 1..2 LOOP
    DELETE FROM public.notifications WHERE true;
    UPDATE public.iot_dispozitive SET meta='{"asteptat_online":true}',
      ultima_citire=jsonb_build_object('online',actual=2,'ups_pe_baterie',true,'ups_pct',20),
      citit_la=CASE WHEN actual=2 THEN now()-interval '21 minutes' ELSE now() END WHERE id=1;
    PERFORM public.iot_verifica_retea();
    IF (SELECT count(*) FROM public.notifications) <> 1
      OR EXISTS (SELECT 1 FROM public.notifications WHERE title LIKE 'UPS:%') THEN RAISE EXCEPTION 'offline/stale regression'; END IF;
  END LOOP;
  DELETE FROM public.notifications WHERE true;
  UPDATE public.iot_dispozitive SET meta='{"asteptat_online":false}' WHERE id=1;
  PERFORM public.iot_verifica_retea();
  IF EXISTS (SELECT 1 FROM public.notifications) THEN RAISE EXCEPTION 'unexpected device regression'; END IF;
END $ups_tests$;
SELECT 'PASS SQL: mains, 80/50/40/25/20/0, real dedup, missing keys, regression, offline/stale';
