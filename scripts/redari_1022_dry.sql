-- scripts/redari_1022_dry.sql — PR #1022, DRY: rulat în ACEEAȘI tranzacție, DUPĂ migrarea 20261131f
-- (și după scripts/redari_1022_dry_inainte.sql). Compară bilateral (EXCEPT ALL) vederea înainte / după pentru ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA'),
-- afișează planul de execuție „după” cu timpul, și REFUZĂ (RAISE) dacă cifrele diferă. Se termină cu ROLLBACK (îl dă cine rulează).
SET LOCAL statement_timeout = '1200s';
DO $pre$ BEGIN
  IF to_regclass('pg_temp.dry1022_inainte') IS NULL THEN RAISE EXCEPTION 'dry 1022: rulati intai scripts/redari_1022_dry_inainte.sql in aceeasi tranzactie'; END IF;
  IF position('PARTITION BY v.proiect_id, v.uat_id' IN pg_get_viewdef('public.red_v_centralizator_uat'::regclass, true)) = 0 THEN
    RAISE EXCEPTION 'dry 1022: migrarea 20261131f nu e aplicata in aceasta tranzactie'; END IF;
END $pre$;
CREATE TEMP TABLE dry1022_dupa ON COMMIT DROP AS
  SELECT v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare, v.numar, v.total_uat, v.procent_inchise FROM public.red_v_centralizator_uat v JOIN public.red_proiecte p ON p.id = v.proiect_id WHERE p.cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA');
DO $plan$
DECLARE pid uuid; l text; t0 timestamptz;
BEGIN
  SELECT id INTO pid FROM public.red_proiecte WHERE cod = 'LOT1-PRUNISOR-JUPA';
  t0 := clock_timestamp();
  FOR l IN EXECUTE format('EXPLAIN (ANALYZE, BUFFERS) SELECT uat_id, stare, numar FROM public.red_v_centralizator_uat WHERE proiect_id = %L AND stare IS NOT NULL', pid) LOOP
    RAISE NOTICE 'DUPA LOT1-PRUNISOR-JUPA | %', l;
  END LOOP;
  INSERT INTO dry1022_timp VALUES ('dupa', 'LOT1-PRUNISOR-JUPA', round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1));
END $plan$;
DO $plan$
DECLARE pid uuid; l text; t0 timestamptz;
BEGIN
  SELECT id INTO pid FROM public.red_proiecte WHERE cod = 'TEST-RAZVAN';
  t0 := clock_timestamp();
  FOR l IN EXECUTE format('EXPLAIN (ANALYZE, BUFFERS) SELECT uat_id, stare, numar FROM public.red_v_centralizator_uat WHERE proiect_id = %L AND stare IS NOT NULL', pid) LOOP
    RAISE NOTICE 'DUPA TEST-RAZVAN | %', l;
  END LOOP;
  INSERT INTO dry1022_timp VALUES ('dupa', 'TEST-RAZVAN', round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1));
END $plan$;
-- Jakarinos r6 P2: coerența UAT ↔ proiect (premisa echivalenței cifrelor) — RAISE, nu doar afișare
DO $coer$ BEGIN
  IF EXISTS (SELECT 1 FROM public.red_v_stare_parcela v JOIN public.red_uat u ON u.id = v.uat_id WHERE u.proiect_id IS DISTINCT FROM v.proiect_id) THEN
    RAISE EXCEPTION 'dry 1022: exista randuri cu UAT din alt proiect — echivalenta PARTITION BY nedovedita'; END IF;
  RAISE NOTICE 'dry 1022: coerenta UAT / proiect OK';
END $coer$;
DO $compara$
DECLARE n_ia int; n_ai int; n_in int; n_du int; r record;
BEGIN
  SELECT count(*) INTO n_ia FROM (SELECT * FROM dry1022_inainte EXCEPT ALL SELECT * FROM dry1022_dupa) x;
  SELECT count(*) INTO n_ai FROM (SELECT * FROM dry1022_dupa EXCEPT ALL SELECT * FROM dry1022_inainte) x;
  SELECT count(*) INTO n_in FROM dry1022_inainte; SELECT count(*) INTO n_du FROM dry1022_dupa;
  FOR r IN SELECT faza, cod, ms FROM dry1022_timp ORDER BY cod, faza DESC LOOP RAISE NOTICE 'TIMP % % = % ms', r.cod, r.faza, r.ms; END LOOP;
  RAISE NOTICE 'dry 1022: inainte % randuri, dupa % randuri, inainte-dupa %, dupa-inainte %', n_in, n_du, n_ia, n_ai;
  IF n_ia <> 0 OR n_ai <> 0 OR n_in <> n_du THEN RAISE EXCEPTION 'dry 1022: cifrele difera inainte / dupa — NU se aplica'; END IF;
  -- Jakarinos r4 P2: fiecare proiect trebuie să aibă rânduri (altfel comparația nu dovedește nimic pentru el)
  FOR r IN SELECT p.cod, (SELECT count(*) FROM dry1022_inainte i WHERE i.proiect_id = p.id) AS n FROM public.red_proiecte p WHERE p.cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA') LOOP
    IF r.n = 0 THEN RAISE EXCEPTION 'dry 1022: % nu are randuri in centralizator — verificare nedovedita', r.cod; END IF;
  END LOOP;
  RAISE NOTICE 'dry 1022: OK — aceleasi cifre';
END $compara$;
-- Jakarinos r4 P2 (L25): aceeași citire ca apelantul real — rolul authenticated, cu JWT de owner (RLS + security_invoker)
DO $jwt$
DECLARE o uuid;
BEGIN
  SELECT id INTO o FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  IF o IS NULL THEN RAISE EXCEPTION 'dry 1022: niciun owner pentru proba cu JWT'; END IF;
  -- numărul așteptat (ca postgres) se trece printr-o setare locală: tabela TEMP a lui postgres nu e citibilă de rolul authenticated
  PERFORM set_config('dry1022.asteptat', (SELECT coalesce(json_object_agg(p.cod, (SELECT count(*) FROM dry1022_dupa d WHERE d.proiect_id = p.id AND d.stare IS NOT NULL)), '{}')::text
    FROM public.red_proiecte p WHERE p.cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA')), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
END $jwt$;
SET LOCAL ROLE authenticated;
DO $rol$
DECLARE r record; n int; t0 timestamptz; vazute int := 0; l text;
BEGIN
  FOR r IN SELECT id, cod FROM public.red_proiecte WHERE cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA') ORDER BY cod LOOP
    vazute := vazute + 1;
    t0 := clock_timestamp();
    SELECT count(*) INTO n FROM public.red_v_centralizator_uat WHERE proiect_id = r.id AND stare IS NOT NULL;
    -- planul de execuție chiar cu rolul / JWT-ul apelantului real (RLS + security_invoker)
    FOR l IN EXECUTE format('EXPLAIN (ANALYZE, BUFFERS) SELECT uat_id, stare, numar FROM public.red_v_centralizator_uat WHERE proiect_id = %L AND stare IS NOT NULL', r.id) LOOP
      RAISE NOTICE 'ROL % | %', r.cod, l;
    END LOOP;
    RAISE NOTICE 'ROL authenticated (owner) % : % randuri in % ms', r.cod, n, round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
    IF n IS DISTINCT FROM (current_setting('dry1022.asteptat')::json ->> r.cod)::int THEN
      RAISE EXCEPTION 'dry 1022: % — rolul authenticated vede alt numar de randuri decat postgres', r.cod; END IF;
  END LOOP;
  -- Jakarinos r5 P2: ambele proiecte trebuie să fie vizibile rolului (altfel bucla le-ar omite fără eroare)
  IF vazute <> 2 THEN RAISE EXCEPTION 'dry 1022: rolul authenticated vede % din 2 proiecte — verificare nedovedita', vazute; END IF;
END $rol$;
RESET ROLE;
