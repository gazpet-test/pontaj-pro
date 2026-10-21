-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261102b_bon_salvare_tranzactionala_ROLLBACK — NU e migrare. Scoate public.fn_bon_salveaza (nicio dată atinsă:
-- funcția nu are tabele / coloane proprii). UI-ul care o cheamă (ConsumuriBonuriTab) se retrage ÎNAINTE (revert PR).
-- Refuză dacă funcția a fost modificată după migrare (amprenta din COMMENT) sau dacă alte obiecte depind de ea.
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
  IF to_regprocedure('public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Revenire 20261102b: fn_bon_salveaza nu există — nimic de scos';
  END IF;
  SELECT md5(p.prosrc || '|' || coalesce(p.proacl::text, '') || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text)
    INTO v_acum FROM pg_proc p WHERE p.oid = 'public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)'::regprocedure;
  v_scrisa := substring(obj_description('public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)'::regprocedure, 'pg_proc') FROM 'amprenta=([0-9a-f]{32})');
  IF v_acum IS DISTINCT FROM v_scrisa THEN
    RAISE EXCEPTION 'Revenire 20261102b: funcția diferă de cea livrată (acum %, în COMMENT %) — refuz', v_acum, v_scrisa;
  END IF;
  DROP FUNCTION public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb);   -- fără CASCADE: o dependență neașteptată anulează tot
  IF to_regprocedure('public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Revenire 20261102b: funcția a rămas';
  END IF;
  PERFORM set_config('gazpet.revenire_20261102b', '', true);
END
$revenire$;
