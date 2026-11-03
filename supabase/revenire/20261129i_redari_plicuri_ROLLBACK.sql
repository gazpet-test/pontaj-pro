-- Revenire 20261129i_redari_plicuri. Runner: o tranzactie, GUC gazpet.revenire_20261129i = 'REDARI_PLICURI_SCOASA:'||txid_current().
-- NU sterge date: red_plicuri + red_loturi_plicuire se muta intr-o schema de arhiva (redari_retras_plicuri_<data_ora>), impreuna cu o copie
-- a legaturii convocare -> plic (id, plic_id, retur_detaliu). Pe red_convocari se scot coloanele noi si se reface constrangerea retur veche.
-- Refuza daca exista convocari cu retur 'decedat' / 'altul' (constrangerea veche nu le-ar accepta) — acelea se trateaza intai, cu acordul owner-ului.
DO $rev$
DECLARE v_schema text := 'redari_retras_plicuri_' || to_char(clock_timestamp() AT TIME ZONE 'Europe/Bucharest', 'YYYYMMDD_HH24MISS');
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261129i', true) IS DISTINCT FROM 'REDARI_PLICURI_SCOASA:' || txid_current() THEN
    RAISE EXCEPTION '20261129i revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_plicuri') IS NULL THEN RAISE EXCEPTION '20261129i revenire: migrarea lipseste'; END IF;
  IF to_regnamespace(v_schema) IS NOT NULL THEN RAISE EXCEPTION '20261129i revenire: schema de arhiva exista deja (%)', v_schema; END IF;
  LOCK TABLE public.red_convocari, public.red_plicuri, public.red_loturi_plicuire IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.red_convocari WHERE retur IN ('decedat', 'altul')) OR EXISTS (SELECT 1 FROM public.red_plicuri WHERE retur IN ('decedat', 'altul')) THEN
    RAISE EXCEPTION '20261129i revenire: exista convocari cu retur decedat/altul — refuz';
  END IF;
  EXECUTE format('CREATE SCHEMA %I', v_schema);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC, anon, authenticated, service_role', v_schema);
  EXECUTE format('CREATE TABLE %I.numere_plic AS SELECT * FROM public.red_numere WHERE cheie = ''PP'' OR cheie LIKE ''PL-%%''', v_schema);   -- numerele nu se refolosesc
  EXECUTE format('CREATE TABLE %I.convocari_plic AS SELECT id, plic_id, retur_detaliu FROM public.red_convocari WHERE plic_id IS NOT NULL OR retur_detaliu IS NOT NULL', v_schema);
  DROP TRIGGER trg_red_convocari_posta_garda ON public.red_convocari;
  DROP INDEX public.idx_red_convocari_plic;
  ALTER TABLE public.red_convocari DROP COLUMN plic_id;
  ALTER TABLE public.red_convocari DROP COLUMN retur_detaliu;
  ALTER TABLE public.red_convocari DROP CONSTRAINT red_convocari_retur_check;
  ALTER TABLE public.red_convocari ADD CONSTRAINT red_convocari_retur_check
    CHECK (retur IS NULL OR retur = ANY (ARRAY['destinatar_necunoscut', 'mutat', 'avizat_neridicat', 'refuz', 'adresa_incompleta']));
  DROP TRIGGER trg_red_plic_reguli ON public.red_plicuri; DROP TRIGGER trg_red_versiune ON public.red_plicuri;
  DROP TRIGGER trg_red_plic_propaga ON public.red_plicuri; DROP TRIGGER trg_red_jurnal ON public.red_plicuri;
  DROP TRIGGER trg_red_lot_reguli ON public.red_loturi_plicuire; DROP TRIGGER trg_red_versiune ON public.red_loturi_plicuire;
  DROP TRIGGER trg_red_jurnal ON public.red_loturi_plicuire;
  REVOKE ALL ON public.red_plicuri, public.red_loturi_plicuire FROM PUBLIC, anon, authenticated, service_role;
  EXECUTE format('ALTER TABLE public.red_plicuri SET SCHEMA %I', v_schema);
  EXECUTE format('ALTER TABLE public.red_loturi_plicuire SET SCHEMA %I', v_schema);
  DROP FUNCTION public.fn_red_plic_creeaza(uuid, uuid[]);
  DROP FUNCTION public.fn_red_lot_plicuire_creeaza(uuid, uuid[], date);
  DROP FUNCTION public.fn_red_cheie_persoana(uuid);
  DROP FUNCTION public.fn_red_plic_reguli();
  DROP FUNCTION public.fn_red_plic_propaga();
  DROP FUNCTION public.fn_red_lot_reguli();
  DROP FUNCTION public.fn_red_plic_scan_exista(uuid, text);
  DROP FUNCTION public.fn_red_convocari_posta_garda();
  DROP FUNCTION public.fn_red_plic_garda_persoana(uuid);
  EXECUTE format('ALTER TABLE public.red_plic_sare SET SCHEMA %I', v_schema);   -- sarea pleaca odata cu cheile (arhiva fara drepturi)
  IF to_regclass('public.red_plicuri') IS NOT NULL OR to_regclass(format('%I.red_plicuri', v_schema)) IS NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_convocari' AND column_name IN ('plic_id', 'retur_detaliu')) THEN
    RAISE EXCEPTION '20261129i revenire: stare finala gresita';
  END IF;
  RAISE NOTICE '20261129i revenire: plicurile pastrate in %', v_schema;
END $rev$;
