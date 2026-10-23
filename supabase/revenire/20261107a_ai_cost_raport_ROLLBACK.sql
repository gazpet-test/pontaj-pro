-- Numai obiectele raportului, fără CASCADE și fără schimbări de date.
-- Armare în tranzacția de revenire:
-- SELECT set_config('gazpet.revenire_20261107a', 'AI_COST_RAPORT:' || txid_current(), true);
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261107a', true) IS DISTINCT FROM 'AI_COST_RAPORT:' || txid_current() THEN
    RAISE EXCEPTION '20261107a: necesita postgres si armare per tranzactie';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
END $pre$;
DROP FUNCTION public.fn_ai_cost_lunar(date,date);
DROP VIEW public.v_ai_cost_lunar;
DROP VIEW public.v_ai_cost_detaliu;
