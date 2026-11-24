-- 20270108a_executie_dcc_registru — ștergerea istoricului runnerului pentru reaplicare, DOAR pe clona 176 (comanda 7 din plan, Task 8), NICIODATĂ
-- pe producție. Rulat DUPĂ revenire (comanda 6), ca aplicarea (comanda 4) să poată rula din nou cu aceeași versiune:
--   "$PSQL_BIN" -X -w -v ON_ERROR_STOP=1 -v sis="$SYS" -v vers="$VERS" -v vrev="$VERS_REV" -v mig="$MIG" -h "$H" -p "$P" -U postgres -d postgres -f supabase/tests/20270108a_executie_dcc_registru_clona_istoric.sql
-- O tranzacție. Variabilele psql trec în blocul DO prin set_config (psql nu le înlocuiește în corpul $$). Blocul REFUZĂ (excepție, nimic șters,
-- psql se oprește înaintea COMMIT-ului) dacă:
--   (1) o variabilă lipsește / are altă formă (sis cifre, vers și vrev 14 cifre și diferite, mig = numele migrării);
--   (2) system_identifier din pg_control_system() <> sis (altă țintă) sau pg_is_in_recovery() (replică);
--   (3) mai există vreun obiect dcc_* / v_dcc_registru (pg_class), fn_dcc_* (pg_proc) sau trg_dcc_* (pg_trigger): revenirea n-a rulat;
--   (4) rândurile din supabase_migrations.schema_migrations cu versiunea vers / vrev SAU cu numele mig / mig_ROLLBACK nu sunt EXACT perechile
--       (vers, mig) și (vrev, mig_ROLLBACK).
-- Apoi DELETE … WHERE (version, name) IN (…) RETURNING, numărul verificat = 2, COMMIT. Fără backslash-uri și fără literale Unicode escapate.
-- Gărzile sunt verificate local pe PGlite: scripts/pglite/dcc_registru/dryrun_pglite.mjs (sistem greșit, obiecte rămase, rânduri <> 2, cazul bun).
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('dcc.sis', :'sis', true), set_config('dcc.vers', :'vers', true), set_config('dcc.vrev', :'vrev', true), set_config('dcc.mig', :'mig', true);
DO $istoric$
DECLARE v_sis text := nullif(current_setting('dcc.sis', true), ''); v_vers text := nullif(current_setting('dcc.vers', true), '');
  v_vrev text := nullif(current_setting('dcc.vrev', true), ''); v_mig text := nullif(current_setting('dcc.mig', true), ''); v_real text; v_n integer;
  v_obiecte text; v_randuri text; v_sterse text;
BEGIN
  -- (1) forma variabilelor
  IF v_sis IS NULL OR v_sis !~ '^[0-9]+$' OR v_vers IS NULL OR v_vers !~ '^[0-9]{14}$' OR v_vrev IS NULL OR v_vrev !~ '^[0-9]{14}$' OR v_vers = v_vrev
     OR v_mig IS DISTINCT FROM '20270108a_executie_dcc_registru' THEN
    RAISE EXCEPTION 'CLONA_ISTORIC_REFUZ: variabile lipsa sau invalide (sis %, vers %, vrev %, mig %); nimic sters',
      coalesce(v_sis, 'lipsa'), coalesce(v_vers, 'lipsa'), coalesce(v_vrev, 'lipsa'), coalesce(v_mig, 'lipsa');
  END IF;
  -- (2) ținta
  SELECT system_identifier::text INTO v_real FROM pg_control_system();
  IF v_real IS DISTINCT FROM v_sis THEN
    RAISE EXCEPTION 'CLONA_ISTORIC_REFUZ: system_identifier % <> sis % (alta tinta); nimic sters', v_real, v_sis;
  END IF;
  IF pg_is_in_recovery() THEN RAISE EXCEPTION 'CLONA_ISTORIC_REFUZ: tinta e in recovery (replica); nimic sters'; END IF;
  PERFORM set_config('lock_timeout', '2s', true);
  LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
  -- (3) revenirea a rulat: niciun obiect al migrării rămas
  SELECT string_agg(o, ', ' ORDER BY o) INTO v_obiecte FROM (
    SELECT 'rel ' || c.relname AS o FROM pg_catalog.pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND (left(c.relname, 4) = 'dcc_' OR c.relname = 'v_dcc_registru')
    UNION ALL
    SELECT 'fn ' || p.proname FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND left(p.proname, 7) = 'fn_dcc_'
    UNION ALL
    SELECT 'trg ' || t.tgname FROM pg_catalog.pg_trigger t WHERE left(t.tgname, 8) = 'trg_dcc_') z;
  IF v_obiecte IS NOT NULL THEN
    RAISE EXCEPTION 'CLONA_ISTORIC_REFUZ: obiectele migrarii exista inca (revenirea n-a rulat): %; nimic sters', left(v_obiecte, 400);
  END IF;
  -- (4) istoricul: EXACT cele două perechi, nimic altceva cu aceleași versiuni / nume
  SELECT count(*), string_agg(m.version || ':' || coalesce(m.name, 'NULL'), ', ' ORDER BY m.version, m.name) INTO v_n, v_randuri
    FROM supabase_migrations.schema_migrations m
   WHERE m.version IN (v_vers, v_vrev) OR m.name IN (v_mig, v_mig || '_ROLLBACK');
  IF v_n <> 2
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version = v_vers AND m.name = v_mig)
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version = v_vrev AND m.name = v_mig || '_ROLLBACK') THEN
    RAISE EXCEPTION 'CLONA_ISTORIC_REFUZ: istoricul nu e exact (%, %) si (%, %_ROLLBACK): % rand(uri) [%]; nimic sters',
      v_vers, v_mig, v_vrev, v_mig, v_n, coalesce(v_randuri, '');
  END IF;
  WITH d AS (
    DELETE FROM supabase_migrations.schema_migrations m
     WHERE (m.version, m.name) IN ((v_vers, v_mig), (v_vrev, v_mig || '_ROLLBACK'))
    RETURNING m.version, m.name)
  SELECT count(*), string_agg(d.version || ':' || d.name, ', ' ORDER BY d.version) INTO v_n, v_sterse FROM d;
  IF v_n <> 2 THEN RAISE EXCEPTION 'CLONA_ISTORIC_REFUZ: DELETE a sters % rand(uri) (astepta 2); anulat', v_n; END IF;
  RAISE NOTICE 'clona_istoric: sterse 2 randuri (%)', v_sterse;
END $istoric$;
COMMIT;
