-- Revenire 20261130d_sms_sold. Runner: o tranzactie, GUC gazpet.revenire_20261130d = 'SMS_SOLD_SCOS:'||txid_current().
-- Fail-closed: refuza (nimic schimbat) daca obiectele nu mai sunt EXACT cele create de 20261130d: corpurile celor 4 functii (md5 fara CR),
-- vederea v_sms_sold (md5 definitie, security_invoker), tabela (coloane + constrangeri, fara politici / triggere, un rand), nicio alta
-- vedere dependenta, si jobul sms_sold_zilnic (program + md5 comanda).
-- Ce scoate: vederea v_sms_sold, jobul (cron.unschedule — cron.job nu se scrie / blocheaza direct, pe productie postgres nu e superuser), cele 4 functii
-- fn_sold_sms_* si tabela sms_sold. Singurul rand al tabelei e o copie a soldului din contul SMSLink (sursa de adevar ramane la
-- furnizor): nu sunt date de business; ultima citire si ultima eroare se afiseaza in NOTICE inainte de stergere.
-- Ordinea: intai revenirea, apoi retragerea edge-ului sms-sold (pana atunci edge-ul primeste eroare la RPC si raspunde 500, fara efect).
-- Nu atinge nimic din 20261130a / 20261130b / 20261130c.
DO $pre$
DECLARE r record; v_s record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130d', true) IS DISTINCT FROM 'SMS_SOLD_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130d revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- textul pg_get_viewdef depinde de search_path: fixat pentru amprenta vederii (doar in aceasta tranzactie)
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.sms_sold') IS NULL THEN RAISE EXCEPTION '20261130d revenire: migrarea 20261130d lipseste'; END IF;
  -- tabela nu se mai schimba sub noi pana la COMMIT (edge-ul care scrie in ea asteapta sau primeste eroare)
  LOCK TABLE public.sms_sold IN ACCESS EXCLUSIVE MODE;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_sold_sms_prag()', '37e0a4fa5c616f9b45ecca7ac4297ca0'),
      ('public.fn_sold_sms_stare()', 'c8c1f3dbf771873a8236f2d9c1a63a08'),
      ('public.fn_sold_sms_inregistreaza(integer,text)', '0ea6654ed57ed200302b90cd00bda91d'),
      ('public.fn_sold_sms_citeste()', '4852e5157f5e2a55e9c46c5bddee53f4')) AS v(semnatura, md5_corp) LOOP
    IF to_regprocedure(r.semnatura) IS NULL
       OR md5(replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(r.semnatura)), chr(13), '')) IS DISTINCT FROM r.md5_corp THEN
      RAISE EXCEPTION '20261130d revenire: functia % lipseste sau difera de 20261130d', r.semnatura;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sold!_sms!_%' ESCAPE '!') <> 4 THEN
    RAISE EXCEPTION '20261130d revenire: exista alte functii fn_sold_sms_* decat cele 4 din 20261130d';
  END IF;
  -- vederea e exact cea din 20261130d; nicio ALTA vedere nu depinde de tabela / vedere / functii (DROP ar pica sau ar lua altceva cu el)
  IF to_regclass('public.v_sms_sold') IS NULL
     OR md5(replace(pg_get_viewdef('public.v_sms_sold'::regclass), chr(13), '')) IS DISTINCT FROM '280a7d95d87c45bd98200f6fb6f2eb96'
     OR (SELECT reloptions FROM pg_class WHERE oid = 'public.v_sms_sold'::regclass) IS DISTINCT FROM ARRAY['security_invoker=on']::text[] THEN
    RAISE EXCEPTION '20261130d revenire: vederea v_sms_sold lipseste sau difera de 20261130d';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
              WHERE d.classid = 'pg_rewrite'::regclass AND w.ev_class <> 'public.v_sms_sold'::regclass
                AND (d.refobjid IN ('public.sms_sold'::regclass, 'public.v_sms_sold'::regclass)
                     OR d.refobjid IN (SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sold!_sms!_%' ESCAPE '!'))) THEN
    RAISE EXCEPTION '20261130d revenire: alta vedere depinde de obiectele 20261130d';
  END IF;
  IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum) FROM pg_attribute a
        WHERE a.attrelid = 'public.sms_sold'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
       IS DISTINCT FROM 'id:boolean,credit:integer,citit_la:timestamp with time zone,eroare:text,eroare_la:timestamp with time zone'
     OR (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.sms_sold'::regclass) <> 6
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sms_sold')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.sms_sold'::regclass AND NOT tgisinternal)
     OR (SELECT count(*) FROM public.sms_sold) <> 1 THEN
    RAISE EXCEPTION '20261130d revenire: tabela sms_sold nu mai e cea din 20261130d';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'sms_sold_zilnic') <> 1
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sms_sold_zilnic' AND schedule = '10 5 * * *' AND username = 'postgres'
                      AND md5(replace(command, chr(13), '')) = '1e88170e8c48a2e27bb97e45d31a77f5') THEN
    RAISE EXCEPTION '20261130d revenire: jobul sms_sold_zilnic lipseste sau a fost schimbat';
  END IF;
  SELECT * INTO v_s FROM public.sms_sold WHERE id;
  RAISE NOTICE '20261130d revenire: ultima citire credit=% la %, ultima eroare=% la %', v_s.credit, v_s.citit_la, v_s.eroare, v_s.eroare_la;
END $pre$;

SELECT cron.unschedule('sms_sold_zilnic');
DROP VIEW public.v_sms_sold;
DROP FUNCTION public.fn_sold_sms_citeste();
DROP FUNCTION public.fn_sold_sms_inregistreaza(integer, text);
DROP FUNCTION public.fn_sold_sms_stare();
DROP FUNCTION public.fn_sold_sms_prag();
DROP TABLE public.sms_sold;

DO $post$
BEGIN
  IF to_regclass('public.sms_sold') IS NOT NULL OR to_regclass('public.v_sms_sold') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sold!_sms!_%' ESCAPE '!')
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sms_sold_zilnic') THEN
    RAISE EXCEPTION '20261130d revenire: au ramas obiecte 20261130d';
  END IF;
  IF current_setting('gazpet.revenire_20261130d', true) IS DISTINCT FROM 'SMS_SOLD_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130d revenire: garda final invalida';
  END IF;
END $post$;
