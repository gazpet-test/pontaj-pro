-- Date reale pentru testul rollback-ului 20261030a (DOAR PG local, după aplicarea 20261030a). SE COMITE (fără ROLLBACK):
-- citiri oficiale + alerte de TOATE tipurile noi (oficial_egress, oficial_cached, colector_oprit) + o alertă veche
-- (prag_zilnic) care trebuie să supraviețuiască. Verificarea după rollback: monitor_egress_oficial_rollback_verif.sql.
TRUNCATE public.storage_descarcari_jurnal, public.storage_obiecte_blocate, public.storage_egress_alerte, public.notifications, public.supabase_usage_oficial;
INSERT INTO public.supabase_usage_oficial (citit_la, ciclu_start, ciclu_sfarsit, egress_bytes, cached_egress_bytes, storage_size_bytes, sursa, raspuns_brut)
SELECT now() - interval '30 hours', d, (d + interval '1 month')::date, 210 * 1073741824::bigint, 230 * 1073741824::bigint, 1, 'dashboard', '{"t":"rollback"}'
  FROM (SELECT (egress_ciclu_start(now()) AT TIME ZONE 'UTC')::date AS d) x;
INSERT INTO public.storage_egress_alerte (tip, cheie, detalii) VALUES ('prag_zilnic', '2026-01-01', '{"t":"alerta veche, rămâne"}');
SELECT public.egress_detector();
DO $$ DECLARE v_n int; BEGIN
  SELECT count(*) INTO v_n FROM public.storage_egress_alerte WHERE tip IN ('oficial_egress', 'oficial_cached', 'colector_oprit');
  IF v_n <> 5 OR (SELECT count(DISTINCT tip) FROM public.storage_egress_alerte WHERE tip IN ('oficial_egress', 'oficial_cached', 'colector_oprit')) <> 3 THEN
    RAISE EXCEPTION 'Date rollback: așteptat 5 alerte noi pe toate cele 3 tipuri (2 egress, 2 cached, 1 colector), sunt %', v_n;
  END IF;
  IF (SELECT count(*) FROM public.supabase_usage_oficial) <> 1 THEN RAISE EXCEPTION 'Date rollback: citirea lipsește'; END IF;
  RAISE NOTICE 'DATE_ROLLBACK_OK: 1 citire, 5 alerte noi (3 tipuri), 1 alertă veche';
END $$;
