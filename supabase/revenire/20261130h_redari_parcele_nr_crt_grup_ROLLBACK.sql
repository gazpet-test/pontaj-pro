-- Revenire 20261130h_redari_parcele_nr_crt_grup. Runner: o tranzactie, GUC gazpet.revenire_20261130h = 'REDARI_NR_CRT_GRUP_SCOS:'||txid_current().
-- Ca la 20261130e: revenirea NU pierde date. Valorile nenule (id, proiect_id, id_parcela, cheie_sursa, nr_crt_grup) se copiaza intr-o schema de arhiva
-- proprie (redari_retras_<data_ora>), fara acces pentru aplicatie, apoi triggerul + functia + coloana se scot. red_jurnal ramane neatins.
-- ATENTIE: dupa revenire codul de import (care scrie / citeste nr_crt_grup) nu mai functioneaza — se revine intai codul.
DO $rev$
DECLARE v_schema text := 'redari_retras_' || to_char(clock_timestamp() AT TIME ZONE 'Europe/Bucharest', 'YYYYMMDD_HH24MISS'); v_n bigint; v_dupa bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130h', true) IS DISTINCT FROM 'REDARI_NR_CRT_GRUP_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130h revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_parcele' AND column_name = 'nr_crt_grup') THEN
    RAISE EXCEPTION '20261130h revenire: migrarea lipseste';
  END IF;
  IF to_regnamespace(v_schema) IS NOT NULL THEN RAISE EXCEPTION '20261130h revenire: schema de arhiva exista deja (%)', v_schema; END IF;
  LOCK TABLE public.red_parcele IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO v_n FROM public.red_parcele WHERE nr_crt_grup IS NOT NULL;
  EXECUTE format('CREATE SCHEMA %I', v_schema);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC, anon, authenticated, service_role', v_schema);
  EXECUTE format('CREATE TABLE %I.red_parcele_nr_crt_grup AS SELECT id AS parcela_id, proiect_id, id_parcela, cheie_sursa, nr_crt_grup, sters_la '
                 'FROM public.red_parcele WHERE nr_crt_grup IS NOT NULL', v_schema);
  EXECUTE format('REVOKE ALL ON %I.red_parcele_nr_crt_grup FROM PUBLIC, anon, authenticated, service_role', v_schema);
  EXECUTE format('SELECT count(*) FROM %I.red_parcele_nr_crt_grup', v_schema) INTO v_dupa;
  IF v_dupa IS DISTINCT FROM v_n THEN RAISE EXCEPTION '20261130h revenire: arhiva incompleta (% fata de %)', v_dupa, v_n; END IF;
  DROP TRIGGER trg_red_parcele_nr_crt_grup ON public.red_parcele;
  DROP FUNCTION public.fn_red_parcele_nr_crt_grup_imutabil();
  ALTER TABLE public.red_parcele DROP COLUMN nr_crt_grup;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_parcele' AND column_name = 'nr_crt_grup')
     OR to_regprocedure('public.fn_red_parcele_nr_crt_grup_imutabil()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_parcele'::regclass AND tgname = 'trg_red_parcele_nr_crt_grup') THEN
    RAISE EXCEPTION '20261130h revenire: stare finala gresita';
  END IF;
  RAISE NOTICE '20261130h revenire: % valori nr_crt_grup pastrate in %.red_parcele_nr_crt_grup', v_n, v_schema;
END $rev$;
