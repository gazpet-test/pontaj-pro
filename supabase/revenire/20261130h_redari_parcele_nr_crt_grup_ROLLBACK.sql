-- Revenire 20261130h_redari_parcele_nr_crt_grup. Runner: o tranzactie, GUC gazpet.revenire_20261130h = 'REDARI_NR_CRT_GRUP_SCOS:'||txid_current().
-- r5 (Copilot r4 P1-01): revenirea e posibila DOAR cat nu exista nicio parcela cu nr_crt_grup nenul. Daca exista, REFUZ explicit (cu numaratoarea),
-- fara nicio schimbare: scoaterea coloanei ar pierde identitatea „x.y” din BD activa, iar o reaplicare ulterioara ar lasa NULL = „fara subnumar”,
-- adica exact asocierea tacita 166 <-> 166.1 pe care migrarea o previne. O revenire cu valori ar cere o procedura separata de arhivare + restaurare,
-- cu aprobarea lui Razvan (nu exista in acest PR).
-- Ordinea: LOCK ACCESS EXCLUSIVE pe red_parcele INAINTE de numarare (nimeni nu poate insera un grup intre verificare si DROP).
-- ATENTIE: dupa revenire codul de import (care scrie / citeste nr_crt_grup) nu mai functioneaza — se revine intai codul.
DO $rev$
DECLARE v_n bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130h', true) IS DISTINCT FROM 'REDARI_NR_CRT_GRUP_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130h revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_parcele' AND column_name = 'nr_crt_grup') THEN
    RAISE EXCEPTION '20261130h revenire: migrarea lipseste';
  END IF;
  LOCK TABLE public.red_parcele IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO v_n FROM public.red_parcele WHERE nr_crt_grup IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION '20261130h revenire REFUZATA: % parcele au nr_crt_grup nenul; scoaterea coloanei le-ar pierde identitatea „x.y” (procedura separata, cu aprobare)', v_n
      USING ERRCODE = '55000';
  END IF;
  DROP TRIGGER trg_red_parcele_nr_crt_grup ON public.red_parcele;
  DROP FUNCTION public.fn_red_parcele_nr_crt_grup_imutabil();
  ALTER TABLE public.red_parcele DROP COLUMN nr_crt_grup;   -- scoate si CHECK-urile red_parcele_nr_crt_grup_forma / _cu_cheie si privilegiile pe coloana
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_parcele' AND column_name = 'nr_crt_grup')
     OR to_regprocedure('public.fn_red_parcele_nr_crt_grup_imutabil()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_parcele'::regclass AND tgname = 'trg_red_parcele_nr_crt_grup')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_parcele'::regclass AND conname IN ('red_parcele_nr_crt_grup_forma', 'red_parcele_nr_crt_grup_cu_cheie')) THEN
    RAISE EXCEPTION '20261130h revenire: stare finala gresita';
  END IF;
  RAISE NOTICE '20261130h revenire: coloana nr_crt_grup scoasa (0 valori nenule)';
END $rev$;
