-- scripts/redari_1022_dry.sql — PR #1022, DRY: rulat în ACEEAȘI tranzacție, DUPĂ migrarea 20261131f
-- (și după scripts/redari_1022_dry_inainte.sql). Compară bilateral (EXCEPT ALL) vederea înainte / după pentru ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA'),
-- afișează planul de execuție „după” cu timpul, și REFUZĂ (RAISE) dacă cifrele diferă. Se termină cu ROLLBACK (îl dă cine rulează).
SET LOCAL statement_timeout = '300s';
DO $pre$ BEGIN
  IF to_regclass('pg_temp.dry1022_inainte') IS NULL THEN RAISE EXCEPTION 'dry 1022: rulati intai scripts/redari_1022_dry_inainte.sql in aceeasi tranzactie'; END IF;
  IF position('PARTITION BY v.proiect_id, v.uat_id' IN pg_get_viewdef('public.red_v_centralizator_uat'::regclass, true)) = 0 THEN
    RAISE EXCEPTION 'dry 1022: migrarea 20261131f nu e aplicata in aceasta tranzactie'; END IF;
END $pre$;
CREATE TEMP TABLE dry1022_dupa ON COMMIT DROP AS
  SELECT v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare, v.numar, v.total_uat, v.procent_inchise FROM public.red_v_centralizator_uat v JOIN public.red_proiecte p ON p.id = v.proiect_id WHERE p.cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA');
DO $plan$
DECLARE r record; l text; t0 timestamptz;
BEGIN
  FOR r IN SELECT id, cod FROM public.red_proiecte WHERE cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA') ORDER BY cod LOOP
    t0 := clock_timestamp();
    FOR l IN EXECUTE format('EXPLAIN (ANALYZE, BUFFERS) SELECT uat_id, stare, numar FROM public.red_v_centralizator_uat WHERE proiect_id = %L AND stare IS NOT NULL', r.id) LOOP
      RAISE NOTICE 'DUPA % | %', r.cod, l;
    END LOOP;
    INSERT INTO dry1022_timp VALUES ('dupa', r.cod, round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1));
  END LOOP;
END $plan$;
DO $compara$
DECLARE n_ia int; n_ai int; n_in int; n_du int; r record;
BEGIN
  SELECT count(*) INTO n_ia FROM (SELECT * FROM dry1022_inainte EXCEPT ALL SELECT * FROM dry1022_dupa) x;
  SELECT count(*) INTO n_ai FROM (SELECT * FROM dry1022_dupa EXCEPT ALL SELECT * FROM dry1022_inainte) x;
  SELECT count(*) INTO n_in FROM dry1022_inainte; SELECT count(*) INTO n_du FROM dry1022_dupa;
  FOR r IN SELECT faza, cod, ms FROM dry1022_timp ORDER BY cod, faza DESC LOOP RAISE NOTICE 'TIMP % % = % ms', r.cod, r.faza, r.ms; END LOOP;
  RAISE NOTICE 'dry 1022: inainte % randuri, dupa % randuri, inainte-dupa %, dupa-inainte %', n_in, n_du, n_ia, n_ai;
  IF n_ia <> 0 OR n_ai <> 0 OR n_in <> n_du THEN RAISE EXCEPTION 'dry 1022: cifrele difera inainte / dupa — NU se aplica'; END IF;
  IF n_in = 0 THEN RAISE EXCEPTION 'dry 1022: nicio linie de comparat (proiecte fara date?) — verificare nedovedita'; END IF;
  RAISE NOTICE 'dry 1022: OK — aceleasi cifre';
END $compara$;
