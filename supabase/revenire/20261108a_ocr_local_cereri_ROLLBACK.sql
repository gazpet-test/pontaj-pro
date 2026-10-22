-- Numai obiectele B1. Fără CASCADE, fără modificarea registrului de cost.
-- SELECT set_config('gazpet.revenire_20261108a','OCR_LOCAL_REVENIRE:'||txid_current(),true);
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261108a',true) IS DISTINCT FROM 'OCR_LOCAL_REVENIRE:'||txid_current() THEN
    RAISE EXCEPTION '20261108a: necesita postgres si armare per tranzactie';
  END IF;
  PERFORM set_config('lock_timeout','5s',true);
  -- Împiedică admiterea/rezultatul/rezervarea între verificare și DROP.
  PERFORM pg_advisory_xact_lock(hashtext('ocr_local_cota'));
  LOCK TABLE public.ocr_local_cereri, public.ocr_local_incercari IN ACCESS EXCLUSIVE MODE;
  -- Orice istoric, inclusiv finalizat/curatat/refuzat, impune decizie explicita de export.
  IF EXISTS (SELECT 1 FROM public.ocr_local_cereri)
     OR EXISTS (SELECT 1 FROM public.ocr_local_incercari) THEN
    RAISE EXCEPTION '20261108a: exista istoric B1; necesita decizie explicita de export';
  END IF;
  -- B1 nu creează bucket/cron. Dacă B2 le-a instalat, se revine întâi B2:
  -- nu ștergem metadate Storage, obiecte ori joburi create de altă livrare.
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='ocr-local-cereri') THEN
      RAISE EXCEPTION '20261108a: reveniti intai configurarea Storage B2';
    END IF;
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE position('fn_ocr_local_' IN command)>0) THEN
      RAISE EXCEPTION '20261108a: reveniti intai cronul B2';
    END IF;
  END IF;
END $pre$;
DROP FUNCTION public.fn_ocr_local_context(uuid,uuid,uuid);
DROP FUNCTION public.fn_ocr_local_probleme();
DROP FUNCTION public.fn_ocr_local_curatenie_confirma(uuid,boolean,text);
DROP FUNCTION public.fn_ocr_local_curatenie_lista(integer);
DROP FUNCTION public.fn_ocr_local_heartbeat(text,text,timestamptz,jsonb,text);
DROP FUNCTION public.fn_ocr_local_expira();
DROP FUNCTION public.fn_ocr_local_stare(uuid,uuid);
DROP FUNCTION public.fn_ocr_local_inchide_fallback(uuid,jsonb,text,numeric);
DROP FUNCTION public.fn_ocr_local_rezultat(uuid,uuid,jsonb,text,numeric);
DROP FUNCTION public.fn_ocr_local_apel_faza(uuid,text,bigint,jsonb,numeric);
DROP FUNCTION public.fn_ocr_local_rezerva_apel(uuid);
DROP FUNCTION public.fn_ocr_local_drept_platit(uuid,text,uuid,uuid);
DROP FUNCTION public.fn_ocr_local_context(uuid,uuid,uuid);
DROP FUNCTION public.fn_ocr_local_verifica_token(uuid,uuid);
DROP FUNCTION public.fn_ocr_local_preia(text);
DROP FUNCTION public.fn_ocr_local_confirma_upload(uuid,uuid,text,integer);
DROP FUNCTION public.fn_ocr_local_admite(uuid,bigint,bigint,text,integer);
DROP FUNCTION public.fn_ocr_local_expira_una(uuid);
DROP FUNCTION public.fn_ocr_local_disponibilitate(timestamptz);
DROP VIEW public.v_ocr_local_probleme;
DROP TABLE public.ocr_local_cereri;
DROP TABLE public.ocr_local_incercari;
DROP TABLE public.ocr_local_worker;
DROP TABLE public.ocr_local_config;
