-- Harness 20261213a, partea a doua — inclus de scripts/test_executie_acces_proiect.sql ÎNAINTEA lui T7 (revenirea 20261209a), după ce T3–T6
-- au rulat peste politicile 20261213a. Revenirea 20261209a refuză cât timp 20261213a e aplicată (ordinea revenirilor); revenirea 20261213a
-- armată redă exact politicile 20261209a (aceeași amprentă ca în T9, înainte de aplicare), apoi T7 / T8 rulează ca în r13.
SELECT pg_temp.t_ca(NULL, 'postgres');
SAVEPOINT t9z1;
SELECT set_config('gazpet.revenire_20261209a', 'SCOATE_ACCES_PROIECT:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261209a_executie_acces_proiect_ROLLBACK.sql
\set t9z1_eroare :ERROR
\set t9z1_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t9z1;
SELECT pg_temp.t_eroare('T9z1', :'t9z1_eroare', :'t9z1_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'starea nu e cea din 20261209a');
SELECT set_config('gazpet.revenire_20261213a', 'REDA_POLITICILE_20261209A:' || txid_current(), true);
\ir ../supabase/revenire/20261213a_executie_acces_proiect_perf_ROLLBACK.sql
DO $t$ BEGIN
  IF pg_temp.t13_pol() IS DISTINCT FROM pg_temp.t_g('pol13_0')
     OR to_regprocedure('public.fn_executie_acces_proprii_citire()') IS NOT NULL OR to_regprocedure('public.fn_executie_acces_politici()') IS NOT NULL THEN
    RAISE EXCEPTION 'T9z FAIL: revenirea 20261213a (după T3–T6) nu a redat exact politicile 20261209a';
  END IF;
  RAISE NOTICE 'T9z OK (revenirea 20261209a refuzată cât timp 20261213a e aplicată; revenirea 20261213a = politicile 20261209a)';
END $t$;
