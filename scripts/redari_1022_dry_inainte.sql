-- scripts/redari_1022_dry_inainte.sql — PR #1022, DRY: rulat în ACEEAȘI tranzacție, ÎNAINTEA migrării 20261131f.
-- Salvează red_v_centralizator_uat „înainte” pentru ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA') într-o tabelă TEMP (ON COMMIT DROP) și afișează planul de execuție „înainte”.
-- Nu scrie nimic persistent. Se termină cu ROLLBACK (îl dă cine rulează DRY-ul).
SET LOCAL statement_timeout = '1200s';   -- vederea VECHE pe LOT1 poate fi lentă (motivul PR-ului); un timeout aici invalidează DRY-ul, nu dovedește o regresie
DO $pre$ BEGIN
  IF (SELECT count(*) FROM public.red_proiecte WHERE cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA')) <> 2 THEN RAISE EXCEPTION 'dry 1022: lipsesc proiectele de comparat'; END IF;
END $pre$;
CREATE TEMP TABLE dry1022_inainte ON COMMIT DROP AS
  SELECT v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare, v.numar, v.total_uat, v.procent_inchise FROM public.red_v_centralizator_uat v JOIN public.red_proiecte p ON p.id = v.proiect_id WHERE p.cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA');
CREATE TEMP TABLE dry1022_timp ON COMMIT DROP AS SELECT 'inainte'::text AS faza, ''::text AS cod, 0::numeric AS ms LIMIT 0;
DO $plan$
DECLARE pid uuid; l text; t0 timestamptz;
BEGIN
  SELECT id INTO pid FROM public.red_proiecte WHERE cod = 'LOT1-PRUNISOR-JUPA';
  t0 := clock_timestamp();
  FOR l IN EXECUTE format('EXPLAIN (ANALYZE, BUFFERS) SELECT uat_id, stare, numar FROM public.red_v_centralizator_uat WHERE proiect_id = %L AND stare IS NOT NULL', pid) LOOP
    RAISE NOTICE 'INAINTE LOT1-PRUNISOR-JUPA | %', l;
  END LOOP;
  INSERT INTO dry1022_timp VALUES ('inainte', 'LOT1-PRUNISOR-JUPA', round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1));
END $plan$;
DO $plan$
DECLARE pid uuid; l text; t0 timestamptz;
BEGIN
  SELECT id INTO pid FROM public.red_proiecte WHERE cod = 'TEST-RAZVAN';
  t0 := clock_timestamp();
  FOR l IN EXECUTE format('EXPLAIN (ANALYZE, BUFFERS) SELECT uat_id, stare, numar FROM public.red_v_centralizator_uat WHERE proiect_id = %L AND stare IS NOT NULL', pid) LOOP
    RAISE NOTICE 'INAINTE TEST-RAZVAN | %', l;
  END LOOP;
  INSERT INTO dry1022_timp VALUES ('inainte', 'TEST-RAZVAN', round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1));
END $plan$;
DO $nr$ BEGIN RAISE NOTICE 'dry 1022: inainte salvat — % randuri', (SELECT count(*) FROM dry1022_inainte); END $nr$;
