-- LOCAL runner adapter; concatenate the UNCHANGED E4b rollback immediately after.
-- The runner validates/hashes/records this combined artifact under a separate
-- harness-only name/version, then runs control_0e. No LIVE artifact is edited.
DO $arm$
BEGIN
  IF current_database() !~ '^[a-z0-9_]+_test$' OR session_user <> 'postgres'
     OR current_user <> 'postgres'
     OR current_setting('gazpet.livrare_migrare', true)
        IS DISTINCT FROM '20261109b_izometrie_e4b_prodlike_revenire:' || txid_current() THEN
    RAISE EXCEPTION 'prodlike rollback: runner connection required';
  END IF;
  PERFORM set_config('gazpet.revenire_20261109b', 'IZO_E4B_SCOATE:' || txid_current(), true);
END $arm$;

