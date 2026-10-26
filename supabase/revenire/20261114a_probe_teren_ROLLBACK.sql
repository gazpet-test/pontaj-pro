-- NEEXECUTAT. Fara CASCADE. Refuzam pierderea oricarui raport/citiri operative.
DO $pt_revenire_20261114a$
BEGIN
  IF current_user <> 'postgres' OR current_setting('gazpet.revenire_20261114a',true) IS DISTINCT FROM 'PROBE_TEREN_SCOATE:' || txid_current() THEN RAISE EXCEPTION 'pt_garda: garda start invalida'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'pt_izolare: necesita READ COMMITTED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
  PERFORM pg_advisory_xact_lock(hashtext('probe_teren_scriere'));
  LOCK TABLE public.probe_calcule, public.probe_log_executie, public.probe_exec_utilaje, public.probe_log_utilaje, public.probe_teren_operatii IN ACCESS EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM public.probe_exec_utilaje) OR EXISTS(SELECT 1 FROM public.probe_log_utilaje) OR EXISTS(SELECT 1 FROM public.probe_teren_operatii)
    OR EXISTS(SELECT 1 FROM public.probe_log_executie WHERE poza_manometru_path IS NOT NULL OR intarziata OR cheie IS NOT NULL OR creat_de IS NOT NULL)
    THEN RAISE EXCEPTION 'pt_rollback_date: exista date operative; export si plan separat necesare'; END IF;
  IF EXISTS(SELECT 1 FROM public.probe_calcule WHERE beneficiar_tip IS DISTINCT FROM CASE WHEN proiect_id IS NOT NULL THEN 'gazpet'::text ELSE NULL::text END
    OR tert_ref_tip IS NOT NULL OR tert_ref_id IS NOT NULL OR tert_client IS NOT NULL)
    THEN RAISE EXCEPTION 'pt_rollback_beneficiar: coloane beneficiar modificate; export separat necesar'; END IF;
END $pt_revenire_20261114a$;
DROP VIEW public.v_probe_raport;
DROP TRIGGER probe_calc_teren_guard ON public.probe_calcule;
DROP TRIGGER probe_log_teren_guard ON public.probe_log_executie;
DROP POLICY probe_calc_teren_citire ON public.probe_calcule;
DROP POLICY probe_calc_teren_filtru ON public.probe_calcule;
DROP POLICY probe_calc_teren_insert ON public.probe_calcule;
DROP POLICY probe_calc_teren_update ON public.probe_calcule;
DROP POLICY probe_calc_teren_delete ON public.probe_calcule;
DROP POLICY probe_log_teren_filtru ON public.probe_log_executie;
DROP POLICY probe_log_teren_citire ON public.probe_log_executie;
DROP FUNCTION public.fn_probe_porneste(bigint,jsonb,numeric,text,text);
DROP FUNCTION public.fn_probe_citire(bigint,numeric,text,jsonb,text,boolean,text,text);
DROP FUNCTION public.fn_probe_opreste_utilaj(bigint,bigint,numeric,text,text,text,jsonb,text,boolean,text);
DROP FUNCTION public.fn_probe_inchide(bigint,text,numeric,text,jsonb,text,text);
DROP FUNCTION public.probe_teren_protejeaza();
DROP FUNCTION public.probe_teren_scrie(text,bigint,jsonb,text);
DROP FUNCTION public.probe_teren_poza(text);
DROP FUNCTION public.probe_teren_bord(bigint,numeric,boolean,text);
DROP FUNCTION public.probe_teren_norma(bigint);
DROP TABLE public.probe_log_utilaje;
DROP TABLE public.probe_exec_utilaje;
DROP TABLE public.probe_teren_operatii;
DROP FUNCTION public.probe_teren_drept(boolean);
ALTER TABLE public.probe_log_executie DROP COLUMN poza_manometru_path, DROP COLUMN intarziata, DROP COLUMN cheie, DROP COLUMN creat_de;
ALTER TABLE public.probe_calcule DROP CONSTRAINT probe_teren_beneficiar,
  DROP COLUMN beneficiar_tip, DROP COLUMN tert_ref_tip, DROP COLUMN tert_ref_id, DROP COLUMN tert_client;
-- ACL si RLS legacy raman; nu dezactivam protectia tabelelor existente.
