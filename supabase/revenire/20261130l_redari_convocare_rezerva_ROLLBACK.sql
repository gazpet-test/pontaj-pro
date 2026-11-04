-- Revenire 20261130l_redari_convocare_rezerva. Runner: o tranzactie, GUC gazpet.revenire_20261130l = 'REDARI_CONVOCARE_REZERVA_SCOS:'||txid_current().
-- Migrarea creeaza DOAR functia fn_red_convocare_rezerva(uuid, boolean) (fara tabele, date, politici) -> revenirea = DROP FUNCTION.
-- Convocarile create prin ea raman convocari obisnuite (nr C + rand red_convocari), nicio pierdere de date.
-- Dupa revenire, clientul (src/redari/convocatoareMasa.js) primeste PGRST202 si trece pe calea veche, cu avertismentul „protectia lipseste”.
DO $rev$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130l', true) IS DISTINCT FROM 'REDARI_CONVOCARE_REZERVA_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130l revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean)') IS NULL THEN RAISE EXCEPTION '20261130l revenire: migrarea lipseste'; END IF;
  IF EXISTS (SELECT 1 FROM pg_depend WHERE refobjid = 'public.fn_red_convocare_rezerva(uuid,boolean)'::regprocedure AND deptype = 'n') THEN
    RAISE EXCEPTION '20261130l revenire REFUZATA: alte obiecte depind de fn_red_convocare_rezerva' USING ERRCODE = '55000';
  END IF;
  DROP FUNCTION public.fn_red_convocare_rezerva(uuid, boolean);
  IF to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean)') IS NOT NULL THEN RAISE EXCEPTION '20261130l revenire: stare finala gresita'; END IF;
  RAISE NOTICE '20261130l revenire: fn_red_convocare_rezerva scoasa';
END $rev$;
