-- REVENIRE 20261031a — scoate schema TKT-0329 B (18 tabele, 40 de funcții fn_ofertare_cb_*, triggerul de pe ofertare_clarificari).
-- DATELE NOI SE PIERD (texte, observații, calcule, snapshot-uri, audit, jurnalul clarificărilor, bugete / rezervări). Nu atinge date
-- existente. Refuză dacă obiectele s-au schimbat după aplicare (amprenta din comentariu). DOAR la cererea lui Răzvan.
-- Armare per tranzacție:
--   SELECT set_config('gazpet.revenire_20261031a', 'CANTITATI_B_REVENIRE:' || txid_current(), true);
DO $revenire$
DECLARE v_fp text; v_comentariu text; f text;
BEGIN
  IF current_setting('gazpet.revenire_20261031a', true) IS DISTINCT FROM 'CANTITATI_B_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261031a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261031a=%') THEN
    RAISE EXCEPTION '20261031a: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261031a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_ofertare_cb_amprenta()') IS NULL OR to_regclass('public.ofertare_analiza_versiuni') IS NULL THEN
    RAISE EXCEPTION '20261031a: preconditie, migrarea nu e aplicata';
  END IF;
  v_fp := public.fn_ofertare_cb_amprenta();
  v_comentariu := obj_description('public.ofertare_analiza_versiuni'::regclass, 'pg_class');
  IF v_comentariu IS NULL OR v_comentariu NOT LIKE '%amprenta=' || v_fp THEN
    RAISE EXCEPTION '20261031a: preconditie, obiectele s-au schimbat dupa aplicare (amprenta difera) - revenire manuala, cu review';
  END IF;
  DROP TRIGGER trg_ofertare_cb_clarificari_jurnal ON public.ofertare_clarificari;
  DROP TABLE public.ofertare_audit_raspunsuri, public.ofertare_analiza_completari, public.ofertare_cant_cmp, public.ofertare_cant_calcul,
             public.ofertare_analiza_versiuni, public.ofertare_cant_obs, public.ofertare_cant_felii, public.ofertare_cant_extrageri,
             public.ofertare_ai_rezervari, public.ofertare_ai_cereri, public.ofertare_ai_buget, public.ofertare_cant_doc_decizii,
             public.ofertare_cant_alias, public.ofertare_doc_texte_prov, public.ofertare_doc_texte, public.ofertare_clarificari_jurnal,
             public.ofertare_analiza_erori, public.ofertare_termen_clarificari;
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_cb\_%' LOOP
    EXECUTE format('DROP FUNCTION %s', f);
  END LOOP;
END $revenire$;

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_cb\_%')
     OR to_regclass('public.ofertare_cant_obs') IS NOT NULL OR to_regclass('public.ofertare_termen_clarificari') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ofertare_cb_clarificari_jurnal') THEN
    RAISE EXCEPTION '20261031a: postconditie revenire';
  END IF;
  IF current_setting('gazpet.revenire_20261031a', true) IS DISTINCT FROM 'CANTITATI_B_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261031a: garda final invalida';
  END IF;
END $post$;
