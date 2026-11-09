-- FIXTURE SINTETIC pentru harness (date inventate), generat de genereaza_import_exemplu.mjs.
-- Proiect 1, nod NOD-TEST-IMPORT: 5 suduri, 4 suduri cu puncte.
-- Surse: lista sha256 exemplu1exemplu1exemplu1exemplu1exemplu1exemplu1exemplu1exemplu1
-- Rulare: psql -X -v ON_ERROR_STOP=1 --single-transaction -f <acest fișier>
-- Upsert pe (proiect, nod, cod): descrierea se actualizează (versiune + 1), starea / sudorul / NDT nu se ating. Codurile care lipsesc
-- din listă: de executat / însăilate -> anulat (motiv „import: …”); deja sudate -> IMPORTUL SE OPREȘTE (se lămuresc întâi).
-- O sudură anulată de un import și reapărută în listă revine la „de executat”. Nimic nu se șterge.
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'import nod: rulează ca postgres'; END IF;
  IF to_regclass('public.executie_noduri_suduri') IS NULL THEN RAISE EXCEPTION 'import nod: migrarea 20261201a nu e aplicată'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = 1) THEN RAISE EXCEPTION 'import nod: proiectul 1 nu există'; END IF;
END $pre$;
LOCK TABLE public.executie_noduri_suduri IN SHARE ROW EXCLUSIVE MODE;
DROP TABLE IF EXISTS pg_temp._nod_lista, pg_temp._nod_puncte;   -- a doua rulare în aceeași tranzacție (harness)
CREATE TEMP TABLE _nod_lista (cod text PRIMARY KEY, subansamblu text NOT NULL, dn integer, diametru text, poz1 text, poz2 text, certitudine text NOT NULL) ON COMMIT DROP;
INSERT INTO _nod_lista (cod, subansamblu, dn, diametru, poz1, poz2, certitudine) VALUES
  ('CP-001', 'Z1. Linie fictivă DN300', 300, '323,9×8 / 323,9×8', '1 Țeavă test 2,00 m', '2 Cot test 90°', 'sigur'),
  ('CP-002', 'Z1. Linie fictivă DN300', 300, '323,9×8 / 323,9×10', '2 Cot test 90°', '3 Teu O''Test', 'de_confirmat'),
  ('CP-003', 'Z2. Ramură fictivă DN100', 100, '114,3×6,3 / flanșă DN100', '4 Țeavă test', '5 Flanșă test', 'posibil'),
  ('CP-004', 'Z3. Ansamblu fictiv (estimare)', 50, '60,3×4 / 60,3×4', '(de completat)', '(de completat)', 'de_confirmat'),
  ('CP-005', 'Z3. Ansamblu fictiv (estimare)', 50, '60,3×4 / 60,3×4', '(de completat)', '(de completat)', 'de_confirmat');
CREATE TEMP TABLE _nod_puncte (cod text PRIMARY KEY, vedere text NOT NULL, x numeric(6,3) NOT NULL, y numeric(6,3) NOT NULL, cert text, sec jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO _nod_puncte (cod, vedere, x, y, cert, sec) VALUES
  ('CP-001', 'PLAN', 12.5, 40, 'sigur', '[]'::jsonb),
  ('CP-002', 'PLAN', 30.25, 40, 'aproximativ', '[]'::jsonb),
  ('CP-003', 'A', 55, 60, 'sigur', '[{"vedere":"PLAN","x_pct":70,"y_pct":20,"certitudine":"sigur"}]'::jsonb),
  ('CP-004', 'A', 80, 75, 'aproximativ', '[]'::jsonb);
DO $import$
DECLARE v_noi integer; v_modif integer; v_react integer; v_anul integer; v_pct integer; v_sudate text;
BEGIN
  -- 1. o sudură deja sudată care lipsește din listă oprește importul (nu se anulează automat)
  SELECT string_agg(s.cod || ' (' || s.stare || ')', ', ' ORDER BY s.cod) INTO v_sudate FROM public.executie_noduri_suduri s
   WHERE s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND s.stare IN ('sudat', 'ndt', 'acceptat', 'reparat')
     AND NOT EXISTS (SELECT 1 FROM _nod_lista l WHERE l.cod = s.cod);
  IF v_sudate IS NOT NULL THEN
    RAISE EXCEPTION 'import nod: lipsesc din listă suduri deja sudate: % — se lămuresc întâi, importul nu le anulează', v_sudate;
  END IF;
  -- 2. upsert: noile se adaugă; la cele existente se actualizează doar descrierea, și doar dacă diferă
  WITH u AS (
    INSERT INTO public.executie_noduri_suduri AS s (proiect_id, nod_cod, cod, subansamblu, dn, diametru, poz1, poz2, certitudine)
    SELECT 1, 'NOD-TEST-IMPORT', l.cod, l.subansamblu, l.dn, l.diametru, l.poz1, l.poz2, l.certitudine FROM _nod_lista l ORDER BY l.cod
    ON CONFLICT (proiect_id, nod_cod, cod) DO UPDATE SET subansamblu = EXCLUDED.subansamblu, dn = EXCLUDED.dn, diametru = EXCLUDED.diametru,
      poz1 = EXCLUDED.poz1, poz2 = EXCLUDED.poz2, certitudine = EXCLUDED.certitudine, versiune = s.versiune + 1
    WHERE (s.subansamblu, s.dn, s.diametru, s.poz1, s.poz2, s.certitudine) IS DISTINCT FROM (EXCLUDED.subansamblu, EXCLUDED.dn, EXCLUDED.diametru, EXCLUDED.poz1, EXCLUDED.poz2, EXCLUDED.certitudine)
    RETURNING (xmax = 0) AS nou)
  SELECT count(*) FILTER (WHERE nou), count(*) FILTER (WHERE NOT nou) INTO v_noi, v_modif FROM u;
  -- 3. anulate de un import anterior și reapărute în listă -> de executat
  UPDATE public.executie_noduri_suduri s SET stare = 'de_executat', data_stare = NULL, motiv = NULL, versiune = s.versiune + 1
   WHERE s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND s.stare = 'anulat' AND s.motiv LIKE 'import: %'
     AND EXISTS (SELECT 1 FROM _nod_lista l WHERE l.cod = s.cod);
  GET DIAGNOSTICS v_react = ROW_COUNT;
  -- 4. lipsă din listă și nesudate -> anulat (nu se șterg)
  UPDATE public.executie_noduri_suduri s SET stare = 'anulat', motiv = 'import: lipsește din lista importată (sha256 exemplu1exem)',
         data_stare = greatest(coalesce(s.data_stare, '-infinity'::date), (now() AT TIME ZONE 'Europe/Bucharest')::date), versiune = s.versiune + 1
   WHERE s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND s.stare IN ('de_executat', 'insailat')
     AND NOT EXISTS (SELECT 1 FROM _nod_lista l WHERE l.cod = s.cod);
  GET DIAGNOSTICS v_anul = ROW_COUNT;
  -- 5. punctele: vederea principală + celelalte vederi, scrise doar dacă diferă
  UPDATE public.executie_noduri_suduri s SET vedere = p.vedere, x_pct = p.x, y_pct = p.y, pozitie_certitudine = p.cert, pozitii_secundare = p.sec
    FROM _nod_puncte p
   WHERE s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND s.cod = p.cod
     AND (s.vedere, s.x_pct, s.y_pct, s.pozitie_certitudine, s.pozitii_secundare) IS DISTINCT FROM (p.vedere, p.x, p.y, p.cert, p.sec);
  GET DIAGNOSTICS v_pct = ROW_COUNT;
  -- postcondiții: fiecare cod din fișier e pe nod, cu descrierea din fișier și activ; fiecare punct e pe sudura lui
  IF EXISTS (SELECT 1 FROM _nod_lista l LEFT JOIN public.executie_noduri_suduri s ON s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND s.cod = l.cod
              WHERE s.id IS NULL OR s.stare = 'anulat'
                 OR (s.subansamblu, s.dn, s.diametru, s.poz1, s.poz2, s.certitudine) IS DISTINCT FROM (l.subansamblu, l.dn, l.diametru, l.poz1, l.poz2, l.certitudine)) THEN
    RAISE EXCEPTION 'import nod: nu toate sudurile din fișier sunt pe nod, active și la zi (o sudură anulată manual se lămurește întâi)';
  END IF;
  IF EXISTS (SELECT 1 FROM _nod_puncte p LEFT JOIN public.executie_noduri_suduri s ON s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND s.cod = p.cod
              WHERE s.id IS NULL OR (s.vedere, s.x_pct, s.y_pct, s.pozitii_secundare) IS DISTINCT FROM (p.vedere, p.x, p.y, p.sec)) THEN
    RAISE EXCEPTION 'import nod: punctele nu au ajuns pe sudurile lor';
  END IF;
  RAISE NOTICE 'import nod %: % noi, % cu descrierea actualizată, % reactivate, % anulate (lipsă din listă), % cu punctele scrise',
    'NOD-TEST-IMPORT', v_noi, v_modif, v_react, v_anul, v_pct;
END $import$;
