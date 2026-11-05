-- Revenire 20261130m_redari_autorizare_tgz. Runner: o tranzactie, GUC gazpet.revenire_20261130m = 'REDARI_AUTORIZARE_TGZ_SCOASA:'||txid_current().
-- Revenirea e posibila DOAR cat niciun proiect nu are autorizarea Transgaz completata (nr / data / PDF). Daca exista, REFUZ explicit:
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
  LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO v_n FROM public.red_proiecte WHERE autorizare_tgz_nr IS NOT NULL OR autorizare_tgz_data IS NOT NULL OR autorizare_tgz_fisier IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION '20261130m revenire REFUZATA: % proiecte au autorizarea Transgaz completata (procedura separata, cu aprobarea lui Razvan)', v_n USING ERRCODE = '55000';
  END IF;
  DROP TRIGGER trg_red_autorizare_tgz ON public.red_proiecte;
  DROP FUNCTION public.fn_red_autorizare_tgz_garda();
  DROP FUNCTION public.fn_red_informare_publicata(text);
  ALTER TABLE public.red_proiecte DROP COLUMN autorizare_tgz_la, DROP COLUMN autorizare_tgz_de, DROP COLUMN autorizare_tgz_fisier,
    DROP COLUMN autorizare_tgz_data, DROP COLUMN autorizare_tgz_nr;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte' AND column_name LIKE 'autorizare_tgz%')
     OR to_regprocedure('public.fn_red_informare_publicata(text)') IS NOT NULL THEN
    RAISE EXCEPTION '20261130m revenire: au ramas obiecte';
  END IF;
END $rev$;
