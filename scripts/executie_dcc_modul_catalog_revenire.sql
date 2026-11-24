-- Revenirea catalogului sub-modulului executie_dcc (scripts/executie_dcc_modul_catalog.sql). NERULAT. Doar coordonatorul, cu „da”-ul proprietarului.
--   psql -X -w -v ON_ERROR_STOP=1 -h <H> -p <P> -U postgres -d postgres -f scripts/executie_dcc_modul_catalog_revenire.sql
-- Șterge cheia DOAR dacă nimeni nu are drept pe ea (niciun rând user_module_access cu module = executie_dcc) și dacă e EXACT rândul inserat
-- de script (copil al lui executie). Drepturile acordate între timp se retrag întâi, printr-o decizie separată.
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $revenire$
DECLARE v_n integer;
BEGIN
  LOCK TABLE public.user_module_access IN SHARE MODE NOWAIT;
  IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'executie_dcc') THEN
    RAISE EXCEPTION 'revenire catalog executie_dcc: exista drepturi pe executie_dcc; se retrag intai (decizie separata); nimic sters';
  END IF;
  DELETE FROM public.app_modules WHERE key = 'executie_dcc' AND parent_key = 'executie';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'revenire catalog executie_dcc: % randuri sterse (asteptat 1); nimic sters', v_n; END IF;
END $revenire$;
COMMIT;
