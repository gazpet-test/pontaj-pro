-- REVENIRE 20261027a — șterge funcțiile fn_raport_distributie_*, tabelul raport_distributie_linii și coloanele
-- executie_proiecte.raport_distributie, rapoarte_zilnice.distributie_antet (rândurile și marcajele de proiect se pierd).
-- DOAR la cererea explicită a lui Răzvan, ÎMPREUNĂ cu revenirea frontend-ului.
-- Armare per tranzacție: SELECT set_config('gazpet.revenire_20261027a', 'RAPORT_DISTRIBUTIE_REVENIRE:' || txid_current(), true);
DO $revenire$
BEGIN
  IF current_setting('gazpet.revenire_20261027a', true)
       IS DISTINCT FROM 'RAPORT_DISTRIBUTIE_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261027a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261027a=%') THEN
    RAISE EXCEPTION '20261027a: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261027a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.raport_distributie_linii') IS NULL
     OR to_regprocedure('public.fn_raport_distributie_salveaza(bigint,jsonb)') IS NULL
     OR to_regprocedure('public.fn_raport_distributie_unitate_check()') IS NULL THEN
    RAISE EXCEPTION '20261027a: preconditie, obiectele lipsesc';
  END IF;
  DROP FUNCTION public.fn_raport_distributie_salveaza(bigint, jsonb);
  DROP TABLE public.raport_distributie_linii;   -- trigger-ul pleacă odată cu tabelul
  DROP FUNCTION public.fn_raport_distributie_unitate_check();
  ALTER TABLE public.rapoarte_zilnice DROP COLUMN distributie_antet;
  ALTER TABLE public.executie_proiecte DROP COLUMN raport_distributie;
  IF to_regclass('public.raport_distributie_linii') IS NOT NULL
     OR to_regprocedure('public.fn_raport_distributie_salveaza(bigint,jsonb)') IS NOT NULL
     OR to_regprocedure('public.fn_raport_distributie_unitate_check()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('raport_distributie', 'distributie_antet')
                AND table_name IN ('executie_proiecte', 'rapoarte_zilnice')) THEN
    RAISE EXCEPTION '20261027a: postconditie revenire';
  END IF;
  IF current_setting('gazpet.revenire_20261027a', true)
       IS DISTINCT FROM 'RAPORT_DISTRIBUTIE_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261027a: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261027a', '', true);
END $revenire$;
