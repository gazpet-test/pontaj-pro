-- Revenire 20261130d_sms_sold. Runner: o tranzactie, GUC gazpet.revenire_20261130d = 'SMS_SOLD_SCOS:'||txid_current().
-- Fail-closed: refuza (nimic schimbat) daca obiectele nu mai sunt EXACT cele create de 20261130d. r2 (#971, Copilot P2-08 + Jakarinos
-- P3; r3: + privilegiile pe coloane attacl si proisstrict): AMPRENTA completa, aceeasi interogare si aceeasi constanta ca in postconditia migrarii: coloane + valori implicite, DEFINITIILE
-- constrangerilor (nu doar numarul), proprietar / RLS / FORCE RLS / ACL / optiuni pe tabela si vedere, numarul de politici si triggere,
-- definitia vederii, iar pe fiecare functie: semnatura, SECURITY DEFINER, volatilitatea, proconfig, proprietarul, ACL-ul si corpul;
-- plus jobul sms_sold_zilnic (program, md5 comanda, activ, utilizator). Apoi: un singur rand, nicio ALTA vedere dependenta.
-- Ce scoate: jobul (cron.unschedule — cron.job nu se scrie / blocheaza direct, pe productie postgres nu e superuser), vederea
-- v_sms_sold, cele 4 functii fn_sold_sms_* si tabela sms_sold. Singurul rand al tabelei e o copie a soldului din contul SMSLink
-- (sursa de adevar ramane la furnizor): nu sunt date de business; ultima citire si ultima eroare se afiseaza in NOTICE.
-- Ordinea: intai revenirea, apoi retragerea edge-ului sms-sold (pana atunci edge-ul primeste eroare la RPC si raspunde 500, fara efect).
-- Nu atinge nimic din 20261130a / 20261130b / 20261130c. 30d se revine INAINTEA oricarei reveniri care ar scoate fn_sms_e_owner (30a).
DO $pre$
DECLARE v_s record; v_amprenta text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130d', true) IS DISTINCT FROM 'SMS_SOLD_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130d revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- textul din catalog (regprocedure, pg_get_viewdef) depinde de search_path: fixat pentru amprenta (doar in aceasta tranzactie)
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.sms_sold') IS NULL OR to_regclass('public.v_sms_sold') IS NULL THEN
    RAISE EXCEPTION '20261130d revenire: migrarea 20261130d lipseste';
  END IF;
  -- tabela nu se mai schimba sub noi pana la COMMIT (edge-ul care scrie in ea asteapta sau primeste eroare)
  LOCK TABLE public.sms_sold IN ACCESS EXCLUSIVE MODE;
  SELECT md5(concat_ws(E'\n',
    (SELECT string_agg(format('%s:%s:%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), coalesce((SELECT string_agg(x::text, ' ' ORDER BY x::text) FROM unnest(a.attacl) x), '-')), ';' ORDER BY a.attnum)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'public.sms_sold'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
    (SELECT string_agg(c.conname || '=' || pg_get_constraintdef(c.oid), ';' ORDER BY c.conname) FROM pg_constraint c WHERE c.conrelid = 'public.sms_sold'::regclass),
    (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', r.relname, r.relkind, pg_get_userbyid(r.relowner), r.relrowsecurity, r.relforcerowsecurity,
                              coalesce((SELECT string_agg(x::text, ' ' ORDER BY x::text) FROM unnest(r.relacl) x), '-'), coalesce(array_to_string(r.reloptions, ' '), '-')), ';' ORDER BY r.relname)
       FROM pg_class r WHERE r.oid IN ('public.sms_sold'::regclass, 'public.v_sms_sold'::regclass)),
    (SELECT count(*)::text FROM pg_policy WHERE polrelid = 'public.sms_sold'::regclass) || ':'
      || (SELECT count(*)::text FROM pg_trigger WHERE tgrelid = 'public.sms_sold'::regclass AND NOT tgisinternal),
    md5(replace(pg_get_viewdef('public.v_sms_sold'::regclass), chr(13), '')),
    (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s:%s', p.oid::regprocedure, p.prosecdef, p.proisstrict, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '-'),
                              pg_get_userbyid(p.proowner), coalesce((SELECT string_agg(x::text, ' ' ORDER BY x::text) FROM unnest(p.proacl) x), '-'),
                              md5(replace(p.prosrc, chr(13), ''))), ';' ORDER BY p.proname)
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sold!_sms!_%' ESCAPE '!'),
    (SELECT string_agg(format('%s:%s:%s:%s:%s', j.jobname, j.schedule, md5(replace(j.command, chr(13), '')), j.active, j.username), ';' ORDER BY j.jobid)
       FROM cron.job j WHERE j.jobname = 'sms_sold_zilnic'))) INTO v_amprenta;
  IF v_amprenta IS DISTINCT FROM '33cbff5fea50460503f200095b4eb370' THEN
    RAISE EXCEPTION '20261130d revenire: obiectele nu mai sunt exact cele din 20261130d (amprenta %)', v_amprenta;
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sold!_sms!_%' ESCAPE '!') <> 4
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'sms_sold_zilnic') <> 1 OR (SELECT count(*) FROM public.sms_sold) <> 1 THEN
    RAISE EXCEPTION '20261130d revenire: functiile / jobul / randul nu sunt exact cele din 20261130d';
  END IF;
  -- nicio ALTA vedere nu depinde de tabela / vedere / functii (DROP ar pica sau ar lua altceva cu el)
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
              WHERE d.classid = 'pg_rewrite'::regclass AND w.ev_class <> 'public.v_sms_sold'::regclass
                AND (d.refobjid IN ('public.sms_sold'::regclass, 'public.v_sms_sold'::regclass)
                     OR d.refobjid IN (SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sold!_sms!_%' ESCAPE '!'))) THEN
    RAISE EXCEPTION '20261130d revenire: alta vedere depinde de obiectele 20261130d';
  END IF;
  SELECT * INTO v_s FROM public.sms_sold WHERE id;
  RAISE NOTICE '20261130d revenire: ultima citire credit=% la %, ultima eroare=% la %', v_s.credit, v_s.citit_la, v_s.eroare, v_s.eroare_la;
END $pre$;

SELECT cron.unschedule('sms_sold_zilnic');
DROP VIEW public.v_sms_sold;
DROP FUNCTION public.fn_sold_sms_citeste();
DROP FUNCTION public.fn_sold_sms_inregistreaza(integer, text, timestamptz, text);
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
