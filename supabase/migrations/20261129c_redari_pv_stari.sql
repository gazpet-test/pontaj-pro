-- Version 20261129120200. Runner supplies one transaction; no business data changes.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129c_redari_pv_stari:' || txid_current() THEN
    RAISE EXCEPTION '20261129c: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.red_procese_verbale IN ACCESS EXCLUSIVE MODE;
  IF to_regprocedure('public.fn_red_pv_stare_tranzitie()') IS NOT NULL THEN RAISE EXCEPTION '20261129c: functia exista'; END IF;
  PERFORM set_config('gazpet.r29c_policies',(SELECT md5(coalesce(string_agg(policyname || '|' || permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' ORDER BY policyname),'')) FROM pg_policies WHERE schemaname='public' AND tablename='red_procese_verbale'),true);
END $pre$;

CREATE FUNCTION public.fn_red_pv_stare_tranzitie() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
BEGIN
  -- Copilot/Gemini f4c r1 P1: identitatea PV-ului nu se schimba niciodata (numarul e nerefolosibil, ancora e fixa).
  IF ROW(NEW.id,NEW.tip,NEW.nr_pv,NEW.parcela_id,NEW.detinator_id,NEW.uat_id,NEW.tronson,NEW.created_by,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id,OLD.tip,OLD.nr_pv,OLD.parcela_id,OLD.detinator_id,OLD.uat_id,OLD.tronson,OLD.created_by,OLD.created_at) THEN
    RAISE EXCEPTION 'Identitatea PV-ului (tip, numar, parcela, detinator, UAT, tronson) nu se modifica.' USING ERRCODE='23514';
  END IF;
  -- Dupa semnat/anulat randul e inghetat INTEGRAL; singura exceptie e remediat_la (urmarirea obiectiilor).
  IF OLD.stare IN ('semnat','anulat') AND (to_jsonb(NEW) - 'remediat_la') IS DISTINCT FROM (to_jsonb(OLD) - 'remediat_la') THEN
    RAISE EXCEPTION 'Un PV semnat sau anulat nu mai poate fi modificat (exceptie: data remedierii).' USING ERRCODE='23514';
  END IF;
  IF NEW.stare IS DISTINCT FROM OLD.stare THEN
    IF NOT ((OLD.stare='generat' AND NEW.stare IN ('trimis_spre_semnare','semnat','anulat'))
      OR (OLD.stare='trimis_spre_semnare' AND NEW.stare IN ('semnat','anulat'))) OR NEW.stare IS NULL THEN
      RAISE EXCEPTION 'Tranzitie de stare PV nepermisa: % -> %',OLD.stare,NEW.stare USING ERRCODE='23514';
    END IF;
  END IF;
  -- Cerintele starii se verifica la FIECARE UPDATE (Gemini f4c r1: trimis -> trimis cu data stearsa ocolea verificarea).
  IF NEW.stare='trimis_spre_semnare' AND NEW.trimis_spre_semnare_data IS NULL THEN
    RAISE EXCEPTION 'Data trimiterii spre semnare este obligatorie.' USING ERRCODE='23514';
  END IF;
  IF NEW.stare='semnat' AND (NEW.semnat_primit_data IS NULL OR NEW.fisier_semnat_path IS NULL OR NEW.fisier_semnat_path !~ '[^[:space:]]') THEN
    RAISE EXCEPTION 'PV semnat necesita data primirii si scanul semnat.' USING ERRCODE='23514';
  END IF;
  IF NEW.stare='semnat' AND NEW.tip='B' AND NEW.motiv_pv_b IS NULL THEN
    RAISE EXCEPTION 'Motivul PV B este obligatoriu la semnare.' USING ERRCODE='23514';
  END IF;
  IF NEW.stare='anulat' AND (NEW.motiv_anulare IS NULL OR NEW.motiv_anulare !~ '[^[:space:]]') THEN
    RAISE EXCEPTION 'Motivul anularii este obligatoriu.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_pv_stare_tranzitie() FROM PUBLIC, anon;
CREATE TRIGGER red_pv_stare_tranzitie BEFORE UPDATE ON public.red_procese_verbale
FOR EACH ROW EXECUTE FUNCTION public.fn_red_pv_stare_tranzitie();

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.red_procese_verbale'::regclass
    AND tgname='red_pv_stare_tranzitie' AND tgfoid='public.fn_red_pv_stare_tranzitie()'::regprocedure AND tgenabled='O' AND tgtype=19)
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_red_pv_stare_tranzitie()'::regprocedure
      AND NOT prosecdef AND 'search_path=public, pg_temp'=ANY(proconfig)) THEN RAISE EXCEPTION '20261129c: post trigger/functie'; END IF;
  IF (SELECT md5(coalesce(string_agg(policyname || '|' || permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' ORDER BY policyname),'')) FROM pg_policies WHERE schemaname='public' AND tablename='red_procese_verbale')
    IS DISTINCT FROM current_setting('gazpet.r29c_policies',true) THEN RAISE EXCEPTION '20261129c: politici schimbate'; END IF;
END $post$;
