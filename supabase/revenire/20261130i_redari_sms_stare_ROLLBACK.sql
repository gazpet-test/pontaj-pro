-- Revenire 20261130i_redari_sms_stare. Runner: o tranzactie, GUC gazpet.revenire_20261130i = 'REDARI_SMS_STARE_SCOS:'||txid_current().
-- Migrarea creeaza DOAR functia de citire fn_red_sms_stare(uuid) (fara tabele, date, politici) -> revenirea = DROP FUNCTION, fara pierdere de date.
-- Refuz daca functia a capatat dependinte (o vedere / functie SQL care o refera) — DROP fara CASCADE ar pica oricum; mesajul e explicit.
-- ATENTIE: dupa revenire, coloana „SMS” din Registru si randul SMS din Fisa parcelei afiseaza eroarea de citire — se revine intai codul.
DO $rev$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130i', true) IS DISTINCT FROM 'REDARI_SMS_STARE_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130i revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_red_sms_stare(uuid)') IS NULL THEN RAISE EXCEPTION '20261130i revenire: migrarea lipseste'; END IF;
  IF EXISTS (SELECT 1 FROM pg_depend WHERE refobjid = 'public.fn_red_sms_stare(uuid)'::regprocedure AND deptype = 'n') THEN
    RAISE EXCEPTION '20261130i revenire REFUZATA: alte obiecte depind de fn_red_sms_stare' USING ERRCODE = '55000';
  END IF;
  DROP FUNCTION public.fn_red_sms_stare(uuid);
  IF to_regprocedure('public.fn_red_sms_stare(uuid)') IS NOT NULL THEN RAISE EXCEPTION '20261130i revenire: stare finala gresita'; END IF;
  RAISE NOTICE '20261130i revenire: fn_red_sms_stare scoasa';
END $rev$;
