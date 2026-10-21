-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261102b_bon_salvare_tranzactionala_ROLLBACK — NU e migrare. Scoate public.fn_bon_salveaza, indexul și coloana
-- executie_bonuri_consum.cheie_operatie (doar cheile de idempotență ale creărilor; numerele, antetele și liniile bonurilor
-- rămân neatinse). UI-ul care cheamă funcția (ConsumuriBonuriTab) se retrage ÎNAINTE (revert PR) — altfel salvarea
-- bonurilor nu mai merge.
-- Refuză dacă funcția / indexul au fost modificate după migrare (amprenta din COMMENT) sau dacă alte obiecte depind de ele.
-- Procedura (un singur string):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261102b', 'BON_RPC_SCOATE:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $revenire$
DECLARE v_acum text; v_scrisa text;
BEGIN
  IF current_setting('gazpet.revenire_20261102b', true) IS DISTINCT FROM 'BON_RPC_SCOATE:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261102b: nearmată (gazpet.revenire_20261102b legat de txid_current) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Revenire 20261102b: rulează ca postgres'; END IF;
  IF to_regprocedure('public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)') IS NULL OR to_regclass('public.ux_bonc_cheie_operatie') IS NULL
     OR to_regclass('public.ux_bonc_proiect_numar') IS NULL THEN
    RAISE EXCEPTION 'Revenire 20261102b: fn_bon_salveaza / ux_bonc_cheie_operatie nu există — nimic de scos';
  END IF;
  SELECT md5(p.prosrc || '|' || coalesce(p.proacl::text, '') || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text
             || '|' || (SELECT pg_get_indexdef('public.ux_bonc_cheie_operatie'::regclass))
             || '|' || (SELECT pg_get_indexdef('public.ux_bonc_proiect_numar'::regclass)))
    INTO v_acum FROM pg_proc p WHERE p.oid = 'public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)'::regprocedure;
  v_scrisa := substring(obj_description('public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)'::regprocedure, 'pg_proc') FROM 'amprenta=([0-9a-f]{32})');
  IF v_acum IS DISTINCT FROM v_scrisa THEN
    RAISE EXCEPTION 'Revenire 20261102b: funcția / indexul diferă de cele livrate (acum %, în COMMENT %) — refuz', v_acum, v_scrisa;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE public.executie_bonuri_consum IN ACCESS EXCLUSIVE MODE;
  DROP FUNCTION public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb);   -- fără CASCADE: o dependență neașteptată anulează tot
  DROP INDEX public.ux_bonc_cheie_operatie;
  DROP INDEX public.ux_bonc_proiect_numar;
  ALTER TABLE public.executie_bonuri_consum DROP COLUMN cheie_operatie;
  IF to_regprocedure('public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_bonuri_consum' AND column_name = 'cheie_operatie') THEN
    RAISE EXCEPTION 'Revenire 20261102b: au rămas obiecte';
  END IF;
  PERFORM set_config('gazpet.revenire_20261102b', '', true);
END
$revenire$;
