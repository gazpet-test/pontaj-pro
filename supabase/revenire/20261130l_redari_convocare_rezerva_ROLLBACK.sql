-- Revenire 20261130l_redari_convocare_rezerva. Runner: o tranzactie, GUC gazpet.revenire_20261130l = 'REDARI_CONVOCARE_REZERVA_SCOS:'||txid_current().
-- Migrarea creeaza: functia fn_red_convocare_rezerva(uuid, boolean, text), functia trigger fn_red_convocari_rezerva_garda() si triggerul
-- trg_red_convocari_garda_rezerva (BEFORE INSERT pe red_convocari). Fara tabele, date, politici -> revenirea = DROP TRIGGER + DROP FUNCTION x2.
-- Convocarile create prin RPC raman convocari obisnuite (nr C + rand red_convocari), nicio pierdere de date.
-- ATENTIE: NU exista fallback. Dupa revenire, clientul primeste PGRST202 si AMBELE cai (generarea in masa si convocatorul individual din
-- Registru, prin rezervaNumarConvocare) REFUZA orice convocator nou („protectia la concurenta nu e activa — aplicati migrarea 20261130l”).
-- Descarcarea / regenerarea cu acelasi numar raman disponibile. Ordinea la livrare: migrarea activa INAINTEA clientului; la revenire, intai codul.
DO $rev$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130l', true) IS DISTINCT FROM 'REDARI_CONVOCARE_REZERVA_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130l revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean,text)') IS NULL OR to_regprocedure('public.fn_red_convocari_rezerva_garda()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_convocari'::regclass AND tgname = 'trg_red_convocari_garda_rezerva') THEN
    RAISE EXCEPTION '20261130l revenire: migrarea lipseste (functie / garda / trigger)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_depend WHERE refobjid = 'public.fn_red_convocare_rezerva(uuid,boolean,text)'::regprocedure AND deptype = 'n')
     OR EXISTS (SELECT 1 FROM pg_depend d WHERE d.refobjid = 'public.fn_red_convocari_rezerva_garda()'::regprocedure AND d.deptype = 'n'
                  AND NOT (d.classid = 'pg_trigger'::regclass AND d.objid = (SELECT oid FROM pg_trigger WHERE tgrelid = 'public.red_convocari'::regclass AND tgname = 'trg_red_convocari_garda_rezerva'))) THEN
    RAISE EXCEPTION '20261130l revenire REFUZATA: alte obiecte depind de functiile 20261130l' USING ERRCODE = '55000';
  END IF;
  DROP TRIGGER trg_red_convocari_garda_rezerva ON public.red_convocari;
  DROP FUNCTION public.fn_red_convocari_rezerva_garda();
  DROP FUNCTION public.fn_red_convocare_rezerva(uuid, boolean, text);
  IF to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean,text)') IS NOT NULL OR to_regprocedure('public.fn_red_convocari_rezerva_garda()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_red_convocari_garda_rezerva') THEN
    RAISE EXCEPTION '20261130l revenire: stare finala gresita';
  END IF;
  RAISE NOTICE '20261130l revenire: fn_red_convocare_rezerva + garda rezervarii scoase';
END $rev$;
