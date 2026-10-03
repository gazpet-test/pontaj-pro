-- NU este migrare. Numai revenire tehnică armată, într-o tranzacție exterioară. Fără GO de execuție: doar la cererea lui Răzvan.
-- r4: șterge și helper-ul fn_ofertare_pf_acces_ofertare() (după politica pf_executor_registru_sel care îl folosește).
-- r3: șterge și wrapper-ul fn_ofertare_pf_uid(); executorul nu mai are nimic pe schema auth.
-- r2 (03.10.2026, modelul 20261010a r2 / Copilot P1.4): versiunile închise/înlocuite refuză ÎNTOTDEAUNA revenirea;
--   drafturile de lucru (cu valorile introduse de oameni) cer o a doua armare, separată, pentru date.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.rollback_tehnic_20261012a', 'STERGE_PF_SCHEMA:' || txid_current(), true);
--   -- doar dacă există drafturi și Răzvan a decis explicit și ștergerea lor:
--   SELECT set_config('gazpet.rollback_tehnic_20261012a_date', 'STERGE_PF_DRAFTURI:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
DO $arm$
BEGIN
  IF current_setting('gazpet.rollback_tehnic_20261012a', true) IS DISTINCT FROM 'STERGE_PF_SCHEMA:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: revenire PF nearmată';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.rollback_tehnic_20261012a%') THEN
    RAISE EXCEPTION 'REFUZ: armare persistentă';
  END IF;
  LOCK TABLE public.ofertare_pf_pachete, public.ofertare_pf_valori IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.ofertare_pf_pachete WHERE stare <> 'lucru' OR manifest IS NOT NULL OR inchis_la IS NOT NULL) THEN
    RAISE EXCEPTION 'REFUZ: există versiuni închise sau înlocuite, date reale';
  END IF;
  IF (EXISTS (SELECT 1 FROM public.ofertare_pf_pachete) OR EXISTS (SELECT 1 FROM public.ofertare_pf_valori))
     AND current_setting('gazpet.rollback_tehnic_20261012a_date', true) IS DISTINCT FROM 'STERGE_PF_DRAFTURI:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: există % drafturi PF de lucru — ștergerea lor cere armarea separată gazpet.rollback_tehnic_20261012a_date',
      (SELECT count(*) FROM public.ofertare_pf_pachete);
  END IF;
END $arm$;
DROP VIEW public.v_ofertare_pf_control;
DROP FUNCTION public.fn_ofertare_pf_versiune_noua(bigint,text);
DROP FUNCTION public.fn_ofertare_pf_inchide(bigint);
DROP TABLE public.ofertare_pf_valori;
DROP TABLE public.ofertare_pf_pachete;
DROP FUNCTION public.fn_ofertare_pf_valoare_garda();
DROP FUNCTION public.fn_ofertare_pf_pachet_garda();
DROP POLICY pf_executor_registru_sel ON public.ofertare_formulare_registru;
DROP FUNCTION public.fn_poate_scrie_pf();
DROP FUNCTION public.fn_poate_citi_pf();
DROP FUNCTION public.fn_ofertare_pf_uid();
DROP FUNCTION public.fn_ofertare_pf_acces_ofertare();
REVOKE SELECT ON public.ofertare_formulare_registru FROM ofertare_pf_executor;
REVOKE EXECUTE ON FUNCTION extensions.digest(text,text) FROM ofertare_pf_executor;
REVOKE USAGE ON SCHEMA public, extensions FROM ofertare_pf_executor;
DROP ROLE ofertare_pf_executor;
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('ofertare_pf_pachete','ofertare_pf_valori','v_ofertare_pf_control'))
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
       ('fn_poate_citi_pf','fn_poate_scrie_pf','fn_ofertare_pf_uid','fn_ofertare_pf_acces_ofertare','fn_ofertare_pf_pachet_garda','fn_ofertare_pf_valoare_garda','fn_ofertare_pf_inchide','fn_ofertare_pf_versiune_noua'))
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ofertare_pf_executor') THEN
    RAISE EXCEPTION 'POST: revenire incompletă';
  END IF;
END $post$;
