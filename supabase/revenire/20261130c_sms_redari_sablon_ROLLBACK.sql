-- Revenire 20261130c_sms_redari_sablon. Runner: o tranzactie, GUC gazpet.revenire_20261130c = 'SMS_SABLON_SCOS:'||txid_current().
-- Fail-closed: scoate cele 3 functii ale sablonului (DROP) si NU redeschide fn_sms_lot_redari_creeaza (textul liber ramane fara drept de
-- apel pentru aplicatie): dupa revenire nimeni nu mai creeaza loturi Redari din aplicatie, pana la o migrare noua. Loturile interne,
-- aprobarea, trimiterea si istoricul raman exact ca in 20261130b.
-- NU sterge date: loturile Redari deja create din sablon raman in sms_loturi (filtru->>'sablon' = 'redari_v1'), cu mesajele lor.
-- Refuza daca exista loturi din sablon inca ACTIVE (draft / aprobat / in_trimitere): se anuleaza intai din 📱 SMS -> Istoric
-- (tabela e blocata inainte de verificare, ca sa nu apara unul nou intre verificare si DROP).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130c', true) IS DISTINCT FROM 'SMS_SABLON_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130c revenire: garda invalida';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION '20261130c revenire: izolarea trebuie sa fie READ COMMITTED'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,boolean)') IS NULL
     OR to_regprocedure('public.fn_sms_redari_sablon_calc(text,date[],text[],text,date)') IS NULL
     OR to_regprocedure('public.fn_sms_redari_sablon_model()') IS NULL OR to_regclass('public.sms_loturi') IS NULL THEN
    RAISE EXCEPTION '20261130c revenire: migrarea 20261130c lipseste';
  END IF;
END $pre$;

-- creatorii de loturi trec prin INSERT pe sms_loturi: SHARE ROW EXCLUSIVE ii opreste pana la COMMIT, citirile (Istoric) merg
LOCK TABLE public.sms_loturi IN SHARE ROW EXCLUSIVE MODE;

DO $date$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.sms_loturi
   WHERE categorie = 'redari' AND filtru->>'sablon' = 'redari_v1' AND stare IN ('draft', 'aprobat', 'in_trimitere');
  IF v_n > 0 THEN
    RAISE EXCEPTION '20261130c revenire: % loturi Redari din sablon sunt inca active (draft / aprobat / in_trimitere); anuleaza-le intai', v_n;
  END IF;
END $date$;

DROP FUNCTION public.fn_sms_lot_redari_sablon_creeaza(uuid, uuid, text, boolean);
DROP FUNCTION public.fn_sms_redari_sablon_calc(text, date[], text[], text, date);
DROP FUNCTION public.fn_sms_redari_sablon_model();

DO $post$
DECLARE v_o oid;
BEGIN
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!') <> 40 THEN
    RAISE EXCEPTION '20261130c revenire: functiile fn_sms_* nu sunt cele 40 din 20261130b';
  END IF;
  -- fail-closed: textul liber ramane inchis pentru aplicatie
  IF has_function_privilege('authenticated', 'public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261130c revenire: fn_sms_lot_redari_creeaza nu trebuie redeschisa';
  END IF;
  FOR v_o IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!' LOOP
    IF has_function_privilege('anon', v_o, 'EXECUTE') OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_o AND a.grantee = 0) THEN
      RAISE EXCEPTION '20261130c revenire: drepturi gresite pe %', v_o::regprocedure;
    END IF;
  END LOOP;
  RAISE NOTICE '20261130c revenire: sablonul scos, textul liber ramane inchis; pastrate % loturi Redari din sablon (inactive)',
    (SELECT count(*) FROM public.sms_loturi WHERE categorie = 'redari' AND filtru->>'sablon' = 'redari_v1');
END $post$;
