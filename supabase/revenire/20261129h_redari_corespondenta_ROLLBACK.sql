-- Revenire 20261129h_redari_corespondenta. Runner: o tranzactie, GUC gazpet.revenire_20261129h = 'REDARI_CORESPONDENTA_SCOASA:'||txid_current().
-- Jakarinos r1–r5: revenirea NU sterge date. Tabelul (cu tot cu randuri, indecsi, constrangeri) se muta intr-o schema de arhiva proprie
-- (redari_retras_<data_ora>), fara acces pentru aplicatie; triggerele si functiile 20261129h se scot. Jurnalul red_jurnal ramane neatins.
-- Astfel nu mai e nevoie de verificarea „evidenta a fost folosita?” (care avea cazuri-limita cu tranzactii concurente): nimic nu se pierde.
DO $rev$
DECLARE v_schema text := 'redari_retras_' || to_char(clock_timestamp() AT TIME ZONE 'Europe/Bucharest', 'YYYYMMDD_HH24MISS');
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261129h', true) IS DISTINCT FROM 'REDARI_CORESPONDENTA_SCOASA:' || txid_current() THEN
    RAISE EXCEPTION '20261129h revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_corespondenta') IS NULL THEN RAISE EXCEPTION '20261129h revenire: migrarea lipseste'; END IF;
  IF to_regnamespace(v_schema) IS NOT NULL THEN RAISE EXCEPTION '20261129h revenire: schema de arhiva exista deja (%)', v_schema; END IF;
  LOCK TABLE public.red_corespondenta IN ACCESS EXCLUSIVE MODE;
  DROP TRIGGER trg_red_corespondenta_reguli ON public.red_corespondenta;
  DROP TRIGGER trg_red_versiune ON public.red_corespondenta;
  DROP TRIGGER trg_red_jurnal ON public.red_corespondenta;
  EXECUTE format('CREATE SCHEMA %I', v_schema);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC, anon, authenticated, service_role', v_schema);
  REVOKE ALL ON public.red_corespondenta FROM PUBLIC, anon, authenticated, service_role;
  EXECUTE format('ALTER TABLE public.red_corespondenta SET SCHEMA %I', v_schema);
  DROP FUNCTION public.fn_red_corespondenta_reguli();
  IF to_regclass('public.red_corespondenta') IS NOT NULL OR to_regprocedure('public.fn_red_corespondenta_reguli()') IS NOT NULL OR to_regclass(format('%I.red_corespondenta', v_schema)) IS NULL THEN
    RAISE EXCEPTION '20261129h revenire: stare finala gresita';
  END IF;
  RAISE NOTICE '20261129h revenire: evidenta pastrata in %.red_corespondenta', v_schema;
END $rev$;
