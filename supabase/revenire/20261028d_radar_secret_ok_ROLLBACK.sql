-- REVENIRE 20261028d — șterge fn_radar_secret_ok. Efect: olx-api refuză apelurile interne (x-radar-secret); UI-ul (JWT) merge.
-- DOAR la cererea explicită a lui Răzvan. Armare per tranzacție:
--   SELECT set_config('gazpet.revenire_20261028d', 'RADAR_OK_REVENIRE:' || txid_current(), true);
DO $revenire$
BEGIN
  IF current_setting('gazpet.revenire_20261028d', true)
       IS DISTINCT FROM 'RADAR_OK_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261028d: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261028d=%') THEN
    RAISE EXCEPTION '20261028d: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261028d: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_radar_secret_ok(text)') IS NULL THEN RAISE EXCEPTION '20261028d: preconditie, functia lipseste'; END IF;
  DROP FUNCTION public.fn_radar_secret_ok(text);
  IF to_regprocedure('public.fn_radar_secret_ok(text)') IS NOT NULL THEN RAISE EXCEPTION '20261028d: postconditie revenire'; END IF;
  PERFORM set_config('gazpet.revenire_20261028d', '', true);
END $revenire$;
