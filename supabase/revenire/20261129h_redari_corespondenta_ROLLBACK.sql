-- Revenire 20261129h_redari_corespondenta. Runner: o tranzactie, GUC gazpet.revenire_20261129h = 'REDARI_CORESPONDENTA_SCOASA:'||txid_current().
-- Refuza daca evidenta a fost folosita (randuri modificate sau adaugate fata de lista initiala) — altfel s-ar pierde starea reala a corespondentei.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261129h', true) IS DISTINCT FROM 'REDARI_CORESPONDENTA_SCOASA:' || txid_current() THEN
    RAISE EXCEPTION '20261129h revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_corespondenta') IS NULL THEN RAISE EXCEPTION '20261129h revenire: migrarea lipseste'; END IF;
  LOCK TABLE public.red_corespondenta IN ACCESS EXCLUSIVE MODE;
  -- Jakarinos r1 P2-04: „nefolosit” = in jurnal exista DOAR cele 10 inserari ale migrarii (fara utilizator); orice update / delete / insert din aplicatie = folosit
  IF EXISTS (SELECT 1 FROM public.red_corespondenta WHERE versiune > 1 OR stare <> 'draft') OR (SELECT count(*) FROM public.red_corespondenta) <> 10
     OR EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_corespondenta' AND (actiune <> 'insert' OR user_id IS NOT NULL))
     OR (SELECT count(*) FROM public.red_jurnal WHERE tabela = 'red_corespondenta') <> 10 THEN
    RAISE EXCEPTION '20261129h revenire: evidenta a fost folosita — refuz (exporta intai randurile)';
  END IF;
END $pre$;
DROP TABLE public.red_corespondenta;
DROP FUNCTION public.fn_red_corespondenta_reguli();
DO $post$
BEGIN
  IF to_regclass('public.red_corespondenta') IS NOT NULL OR to_regprocedure('public.fn_red_corespondenta_reguli()') IS NOT NULL THEN
    RAISE EXCEPTION '20261129h revenire: obiecte ramase';
  END IF;
END $post$;
