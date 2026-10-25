-- NEEXECUTAT. Exportati jurnalul si configuratia inainte de revenire.
DO $lumini_revenire_20261113a$
BEGIN
  IF current_user <> 'postgres' OR current_setting('gazpet.revenire_20261113a',true) IS DISTINCT FROM 'IOT_LUMINI_SCOATE:' || txid_current() THEN RAISE EXCEPTION '20261113a: garda start invalida'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Necesita READ COMMITTED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
  -- Aceeasi ordine de lock ca in RPC; blocam acquire pana la finalul tranzactiei.
  PERFORM pg_advisory_xact_lock(hashtext('iot_lumini_config'));
  PERFORM 1 FROM public.iot_lumini_setari WHERE id=true FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.iot_lumini_setari WHERE id=true AND COALESCE((runtime->>'lease_pana')::timestamptz,'epoch')>clock_timestamp()) THEN RAISE EXCEPTION 'Comanda/tick in curs; rollback refuzat'; END IF;
  -- Nu stergem date operative. Revenire distructiva refuzata daca au existat comenzi/programe.
  IF EXISTS(SELECT 1 FROM public.iot_lumini_jurnal) OR EXISTS(SELECT 1 FROM public.iot_program_lumini) THEN RAISE EXCEPTION 'Export si plan separat pentru date operative necesare'; END IF;
  -- Pauzele/backoff-urile, cursorul OFF si rezervarile sunt urme operative chiar fara jurnal final.
  IF EXISTS(SELECT 1 FROM public.iot_lumini_setari WHERE id=true AND
    (COALESCE(runtime->'motor','{}') NOT IN ('{}'::jsonb,'{"pauze":{},"backoff":{},"citiri_esuate":{}}'::jsonb)
     OR COALESCE(jsonb_array_length(runtime->'rezervari'),0)>0
     OR COALESCE((runtime->>'off_n')::integer,0)>0)) THEN RAISE EXCEPTION 'Export runtime operational necesar'; END IF;
  -- Verificam configuratia completa, inclusiv randuri lipsa sau suplimentare.
  IF (SELECT count(*) FROM public.iot_lumini_setari)<>1
    OR EXISTS(SELECT 1 FROM public.iot_lumini_setari s WHERE
      ROW(s.lat,s.lon,s.tz,s.pauza_ore,s.vacanta_de,s.vacanta_pana,s.simulare_pana_la)
      IS DISTINCT FROM ROW(44.94::numeric,26.03::numeric,'Europe/Bucharest'::text,3::numeric,NULL::date,NULL::date,'23:30'::time))
    OR EXISTS(SELECT 1 FROM (VALUES (85462,'exterior'),(85458,'mixt'),(85460,'mixt'),(85457,'interior'),(85459,'interior'),(85461,'interior')) seed(id,rol)
      FULL JOIN public.iot_lumini l ON l.dispozitiv_id=seed.id
      WHERE seed.id IS NULL OR l.dispozitiv_id IS NULL OR l.rol IS DISTINCT FROM seed.rol OR l.activ IS DISTINCT FROM true)
    THEN RAISE EXCEPTION 'Configuratie modificata dupa apply; export separat necesar'; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='iot_lumini_tick_5min';
END $lumini_revenire_20261113a$;
DROP FUNCTION public.iot_lumini_cron_tick();
DROP FUNCTION public.iot_lumini_runtime(text,text,jsonb);
DROP FUNCTION public.iot_lumini_salveaza(text,jsonb);
DROP FUNCTION public.iot_lumini_valideaza(text,jsonb);
DROP FUNCTION public.iot_lumini_drept(boolean);
DROP TABLE public.iot_lumini_jurnal;
DROP TABLE public.iot_program_lumini;
DROP TABLE public.iot_lumini_setari;
DROP TABLE public.iot_lumini;
