-- REVENIRE 20261031c - sterge tabelul de umbra al cititorului 3 si functia de paza. Refuza daca exista randuri promovate (au efect in
-- productie prin CAS: revenirea lor se face intai pe protocolul de text). DOAR la cererea lui Razvan, ca postgres, prin psql.
-- Armare per tranzactie (review Copilot r1 P1-3):
--   SELECT set_config('gazpet.revenire_20261031c', 'UMBRA_C3_REVENIRE:' || txid_current(), true);
DO $revenire$
BEGIN
  IF current_setting('gazpet.revenire_20261031c', true) IS DISTINCT FROM 'UMBRA_C3_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261031c: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261031c=%') THEN
    RAISE EXCEPTION '20261031c: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261031c rollback: necesita postgres'; END IF;
  IF to_regclass('public.ofertare_citire_umbra') IS NULL THEN RAISE EXCEPTION '20261031c rollback: tabelul nu exista'; END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_citire_umbra WHERE stare = 'promovat') THEN
    RAISE EXCEPTION '20261031c rollback: exista randuri promovate - revenirea lor intai pe protocolul de text (CAS)';
  END IF;
END $revenire$;
DROP TABLE public.ofertare_citire_umbra;
DROP FUNCTION public.fn_ofertare_citire_umbra_pazeste();
