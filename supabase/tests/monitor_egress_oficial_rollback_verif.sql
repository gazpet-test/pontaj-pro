-- Verificare după rollback-ul armat 20261030a rulat peste monitor_egress_oficial_rollback_date.sql (DOAR PG local).
DO $$ BEGIN
  IF to_regclass('public.supabase_usage_oficial') IS NOT NULL THEN RAISE EXCEPTION 'Verif rollback: supabase_usage_oficial încă există'; END IF;
  IF EXISTS (SELECT 1 FROM public.storage_egress_alerte WHERE tip NOT IN ('obiect_repetat', 'prag_zilnic', 'cota_ciclu')) THEN
    RAISE EXCEPTION 'Verif rollback: alerte de tip nou rămase'; END IF;
  IF (SELECT count(*) FROM public.storage_egress_alerte WHERE tip = 'prag_zilnic' AND cheie = '2026-01-01') <> 1 THEN
    RAISE EXCEPTION 'Verif rollback: alerta veche (prag_zilnic) a fost ștearsă'; END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.storage_egress_alerte'::regclass AND contype = 'c'
        AND conname = 'storage_egress_alerte_tip_check' AND pg_get_constraintdef(oid) NOT LIKE '%oficial%') <> 1 THEN
    RAISE EXCEPTION 'Verif rollback: CHECK-ul vechi pe tip nu e repus'; END IF;
  BEGIN
    INSERT INTO public.storage_egress_alerte (tip, cheie) VALUES ('colector_oprit', 'x');
    RAISE EXCEPTION 'Verif rollback: CHECK-ul vechi acceptă colector_oprit';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'storage_egress_config'
               AND column_name IN ('cota_cached_bytes', 'oficial_activat_la')) THEN
    RAISE EXCEPTION 'Verif rollback: cota_cached_bytes / oficial_activat_la încă există'; END IF;
  IF to_regprocedure('public.supabase_usage_oficial_valideaza()') IS NOT NULL THEN RAISE EXCEPTION 'Verif rollback: funcția triggerului încă există'; END IF;
  IF (SELECT cota_ciclu_bytes FROM public.storage_egress_config WHERE id = 1) <> 268435456000 THEN
    RAISE EXCEPTION 'Verif rollback: cota_ciclu_bytes nu e readusă la 268435456000 (valoarea live dinainte)'; END IF;
  IF (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'storage_egress_config' AND column_name = 'cota_ciclu_bytes')
       NOT LIKE '%268435456000%' THEN RAISE EXCEPTION 'Verif rollback: DEFAULT-ul cota_ciclu_bytes nu e readus'; END IF;
END $$;
-- markerul pentru harness = rezultat de SELECT (nu depinde de client_min_messages)
SELECT 'VERIF_ROLLBACK_OK: citiri + alerte noi scoase, alerta veche păstrată, CHECK vechi repus' AS rezultat;
