-- Revenire 20261130a_sms_mvp. Runner: o tranzactie, GUC gazpet.revenire_20261130a = 'SMS_MVP_SCOS:'||txid_current().
-- Ca la 29h / 29i: revenirea NU sterge date. Cele 5 tabele (cu randuri, indecsi, constrangeri, secventa) se muta intr-o schema de arhiva
-- proprie (sms_retras_<data_ora>), fara acces pentru aplicatie; vederea, politicile, triggerele si functiile 20261130a se scot.
-- Dupa revenire nu mai exista nicio cale de trimitere (fn_sms_rezerva dispare): edge-ul sms-trimite primeste eroare si nu trimite nimic.
DO $rev$
DECLARE v_schema text := 'sms_retras_' || to_char(clock_timestamp() AT TIME ZONE 'Europe/Bucharest', 'YYYYMMDD_HH24MISS'); v_t text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130a', true) IS DISTINCT FROM 'SMS_MVP_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130a revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.sms_loturi') IS NULL OR to_regclass('public.sms_mesaje') IS NULL OR to_regclass('public.sms_setari') IS NULL
     OR to_regclass('public.sms_optout') IS NULL OR to_regclass('public.sms_dlr') IS NULL THEN
    RAISE EXCEPTION '20261130a revenire: migrarea lipseste';
  END IF;
  IF to_regnamespace(v_schema) IS NOT NULL THEN RAISE EXCEPTION '20261130a revenire: schema de arhiva exista deja (%)', v_schema; END IF;
  LOCK TABLE public.sms_setari, public.sms_loturi, public.sms_mesaje, public.sms_optout, public.sms_dlr IN ACCESS EXCLUSIVE MODE;
  DROP VIEW public.sms_v_loturi;
  DROP TRIGGER trg_sms_setari_reguli ON public.sms_setari;
  DROP TRIGGER trg_sms_loturi_reguli ON public.sms_loturi;
  DROP TRIGGER trg_sms_mesaje_reguli ON public.sms_mesaje;
  DROP TRIGGER trg_sms_optout_reguli ON public.sms_optout;
  DROP TRIGGER trg_sms_dlr_reguli ON public.sms_dlr;
  -- politicile depind de fn_sms_e_owner: se scot inainte de functii (tabelele arhivate raman cu RLS pornit, fara nicio politica = inchise)
  DROP POLICY sms_setari_sel ON public.sms_setari;
  DROP POLICY sms_loturi_sel ON public.sms_loturi;
  DROP POLICY sms_mesaje_sel ON public.sms_mesaje;
  DROP POLICY sms_optout_sel ON public.sms_optout;
  DROP POLICY sms_dlr_sel ON public.sms_dlr;
  EXECUTE format('CREATE SCHEMA %I', v_schema);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC, anon, authenticated, service_role', v_schema);
  FOREACH v_t IN ARRAY ARRAY['sms_dlr', 'sms_optout', 'sms_mesaje', 'sms_loturi', 'sms_setari'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', v_t);
    EXECUTE format('ALTER TABLE public.%I SET SCHEMA %I', v_t, v_schema);
  END LOOP;
  DROP FUNCTION public.fn_sms_rezerva(uuid, integer, text);
  DROP FUNCTION public.fn_sms_rezultat(uuid, boolean, text, text, text);
  DROP FUNCTION public.fn_sms_dlr_aplica(text, text, boolean, timestamptz);
  DROP FUNCTION public.fn_sms_panou();
  DROP FUNCTION public.fn_sms_angajati_lista();
  DROP FUNCTION public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean);
  DROP FUNCTION public.fn_sms_lot_redari_creeaza(text, uuid, uuid, boolean);
  DROP FUNCTION public.fn_sms_lot_aproba(uuid, integer);
  DROP FUNCTION public.fn_sms_lot_anuleaza(uuid, text);
  DROP FUNCTION public.fn_sms_setari_salveaza(boolean, integer, integer, integer);
  DROP FUNCTION public.fn_sms_redari_autorizare_seteaza(boolean, text, date, integer);
  DROP FUNCTION public.fn_sms_optout_seteaza(text, boolean, text);
  DROP FUNCTION public.fn_sms_setari_reguli();
  DROP FUNCTION public.fn_sms_loturi_reguli();
  DROP FUNCTION public.fn_sms_mesaje_reguli();
  DROP FUNCTION public.fn_sms_optout_reguli();
  DROP FUNCTION public.fn_sms_dlr_reguli();
  DROP FUNCTION public.fn_sms_consum();
  DROP FUNCTION public.fn_sms_cere_owner();
  DROP FUNCTION public.fn_sms_e_owner();
  DROP FUNCTION public.fn_sms_text_valid(text);
  DROP FUNCTION public.fn_sms_text_verifica(text);
  DROP FUNCTION public.fn_sms_text_final(text);
  DROP FUNCTION public.fn_sms_tel_normalizat(text);
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname LIKE 'sms!_%' ESCAPE '!')
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!')
     OR (SELECT count(*) FROM pg_class c WHERE c.relnamespace = to_regnamespace(v_schema) AND c.relkind = 'r') <> 5 THEN
    RAISE EXCEPTION '20261130a revenire: stare finala gresita';
  END IF;
  RAISE NOTICE '20261130a revenire: datele SMS pastrate in schema %', v_schema;
END $rev$;
