-- Revenire 20261130m_redari_autorizare_tgz. Runner: o tranzactie, GUC gazpet.revenire_20261130m = 'REDARI_AUTORIZARE_TGZ_SCOASA:'||txid_current().
-- Revenirea e posibila DOAR cat niciun proiect nu are vreo urma a autorizarii Transgaz (nr / data / PDF / obiect / cine / cand). Daca exista, REFUZ explicit:
-- scoaterea coloanelor ar pierde evidenta autorizarii si ar re-bloca informarea fara urma. PDF-urile din storage NU se sterg (nici acum, nici la refuz).
-- ATENTIE: dupa revenire codul (#939: Setari proiect, versoul convocatorului, pagina /redari/informare) nu mai gaseste coloanele / RPC-ul —
-- se revine intai codul. Fara cod, informarea ramane „nepublicata” (pagina cu banda PROIECT, convocatorul refuzat la expediere).
DO $rev$
DECLARE v_n bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130m', true) IS DISTINCT FROM 'REDARI_AUTORIZARE_TGZ_SCOASA:' || txid_current() THEN
    RAISE EXCEPTION '20261130m revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte' AND column_name = 'autorizare_tgz_fisier') THEN
    RAISE EXCEPTION '20261130m revenire: migrarea lipseste';
  END IF;
  -- aceeași ordine a lock-urilor ca migrarea și garda de convocări: red_convocari, apoi red_proiecte
  LOCK TABLE public.red_convocari IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE;
  -- r2 (Copilot P1-04): orice urma (inclusiv _obiect / _de / _la ramase dupa golire) opreste revenirea
  SELECT count(*) INTO v_n FROM public.red_proiecte WHERE autorizare_tgz_nr IS NOT NULL OR autorizare_tgz_data IS NOT NULL OR autorizare_tgz_fisier IS NOT NULL
    OR autorizare_tgz_obiect IS NOT NULL OR autorizare_tgz_etag IS NOT NULL OR autorizare_tgz_de IS NOT NULL OR autorizare_tgz_la IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION '20261130m revenire REFUZATA: % proiecte au autorizarea Transgaz completata (procedura separata, cu aprobarea lui Razvan)', v_n USING ERRCODE = '55000';
  END IF;
  DROP TRIGGER trg_red_convocari_informare ON public.red_convocari;
  DROP FUNCTION public.fn_red_convocari_informare_garda();
  DROP TRIGGER trg_red_autorizare_tgz ON public.red_proiecte;
  DROP FUNCTION public.fn_red_autorizare_tgz_garda();
  DROP FUNCTION public.fn_red_informare_publicata(text);
  ALTER TABLE public.red_proiecte DROP CONSTRAINT red_proiecte_autorizare_tgz_obiect_cu_fisier;
  ALTER TABLE public.red_proiecte DROP COLUMN autorizare_tgz_la, DROP COLUMN autorizare_tgz_de, DROP COLUMN autorizare_tgz_etag, DROP COLUMN autorizare_tgz_obiect, DROP COLUMN autorizare_tgz_fisier,
    DROP COLUMN autorizare_tgz_data, DROP COLUMN autorizare_tgz_nr;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte' AND column_name LIKE 'autorizare_tgz%')
     OR to_regprocedure('public.fn_red_informare_publicata(text)') IS NOT NULL OR to_regprocedure('public.fn_red_convocari_informare_garda()') IS NOT NULL THEN
    RAISE EXCEPTION '20261130m revenire: au ramas obiecte';
  END IF;
END $rev$;
