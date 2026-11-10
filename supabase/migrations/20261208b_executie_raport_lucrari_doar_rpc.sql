-- Version 20261208130000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261208b_executie_raport_lucrari_doar_rpc — PASUL 2 al raportului legat de devize: liniile raportului zilnic se scriu DOAR prin
-- fn_raport_zilnic_salveaza (20261208a). Se aplică DUPĂ ce telefonul nou e în producție (deploy-ul PR-ului), nu odată cu 20261208a:
-- telefonul vechi șterge și inserează direct în raport_lucrari și, la un raport golit, nu ar vedea refuzul (review r1 P2-9).
-- Ce face: REVOKE INSERT / UPDATE / DELETE pe raport_lucrari de la anon și authenticated (L07). Citirea rămâne neschimbată.
-- Ce NU face: nicio dată, nicio politică (RLS-ul existent al tabelului rămâne exact cum e), nimic pe service_role.
-- Revenire: supabase/revenire/20261208b_executie_raport_lucrari_doar_rpc_ROLLBACK.sql (redă scrierea directă lui authenticated).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261208b_executie_raport_lucrari_doar_rpc:' || txid_current() THEN
    RAISE EXCEPTION '20261208b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261208b: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- 20261208a aplicată (RPC-ul care scrie liniile există și e al lui postgres, DEFINER)
  IF to_regprocedure('public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, integer, uuid)') IS NULL
     OR (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, integer, uuid)')) IS NOT TRUE THEN
    RAISE EXCEPTION '20261208b: 20261208a nu e aplicata (fn_raport_zilnic_salveaza lipseste)';
  END IF;
  -- starea de azi: authenticated scrie direct (fiecare drept verificat separat), fără drepturi pe coloane
  IF NOT has_table_privilege('authenticated', 'public.raport_lucrari', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.raport_lucrari', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.raport_lucrari', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.raport_lucrari', 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.raport_lucrari'::regclass AND attnum > 0 AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20261208b: drepturile pe raport_lucrari difera de cele asteptate (authenticated I/U/D/S, fara ACL pe coloane) — deja aplicata?';
  END IF;
END $pre$;

REVOKE INSERT, UPDATE, DELETE ON public.raport_lucrari FROM anon, authenticated;

DO $post$
BEGIN
  IF has_table_privilege('authenticated', 'public.raport_lucrari', 'INSERT') OR has_table_privilege('authenticated', 'public.raport_lucrari', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.raport_lucrari', 'DELETE') OR NOT has_table_privilege('authenticated', 'public.raport_lucrari', 'SELECT')
     OR has_table_privilege('anon', 'public.raport_lucrari', 'INSERT') OR has_table_privilege('anon', 'public.raport_lucrari', 'UPDATE')
     OR has_table_privilege('anon', 'public.raport_lucrari', 'DELETE') THEN
    RAISE EXCEPTION '20261208b post: privilegii raport_lucrari';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261208b_executie_raport_lucrari_doar_rpc:' || txid_current() THEN
    RAISE EXCEPTION '20261208b: garda final invalida';
  END IF;
END $post$;
