-- FIXTURE SINTETIC pentru harness (date inventate), generat de genereaza_import_exemplu.mjs.
-- Proiect 1, nod NOD-TEST-IMPORT: 2 elemente, 1 cu stadiu inițial.
-- Surse: lista sha256 exemplu5exemplu5exemplu5exemplu5exemplu5exemplu5exemplu5exemplu5
-- Rulare: psql -X -v ON_ERROR_STOP=1 --single-transaction -f <acest fișier>
-- Upsert pe (proiect, nod, cod): descrierea și lista etapelor se actualizează (versiune + 1) doar dacă diferă; etapele bifate nu se ating.
-- IMPORTUL SE OPREȘTE (nimic scris) dacă: un element cu etape bifate lipsește din listă; lista nouă de etape a unui element bifat nu păstrează
-- etapele deja bifate (aceleași, în aceeași ordine); stadiul inițial cerut nu se regăsește în primele etape bifate (număr sau dată).
-- Elementele fără bifări care lipsesc din listă -> anulat (motiv „import: …”); un element anulat de un import și reapărut -> activ. Nimic nu se șterge.
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'import constructii: rulează ca postgres'; END IF;
  IF to_regclass('public.executie_noduri_constructii') IS NULL THEN RAISE EXCEPTION 'import constructii: migrarea 20261207a nu e aplicată'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = 1) THEN RAISE EXCEPTION 'import constructii: proiectul 1 nu există'; END IF;
END $pre$;
-- Ordinea lock-urilor (L06), ca în RPC: ÎNTÂI tabelul (SHARE ROW EXCLUSIVE: exclude RPC-ul, care ia ROW EXCLUSIVE înaintea rândului), APOI rândurile.
LOCK TABLE public.executie_noduri_constructii IN SHARE ROW EXCLUSIVE MODE;
DROP TABLE IF EXISTS pg_temp._constr_lista;   -- a doua rulare în aceeași tranzacție (harness)
CREATE TEMP TABLE _constr_lista (cod text PRIMARY KEY, cod_detaliu text NOT NULL, plansa_sursa text NOT NULL, denumire text NOT NULL, tip text NOT NULL,
  grup text NOT NULL, echipament text, cantitate numeric(10,2) NOT NULL, um text NOT NULL, pozitie text, certitudine text NOT NULL, observatii text,
  etape text[] NOT NULL, stadiu_k integer, stadiu_data date) ON COMMIT DROP;
INSERT INTO _constr_lista (cod, cod_detaliu, plansa_sursa, denumire, tip, grup, echipament, cantitate, um, pozitie, certitudine, observatii, etape, stadiu_k, stadiu_data) VALUES
  ('F6-1', 'TEST-C-REZ-01', 'TEST-C-00', 'Fundație fictivă rezervor 1, reazem 1', 'fundatie', 'rezervoare', 'Rezervor fictiv 1', 1, 'buc', 'Poziție fictivă A', 'de_confirmat', 'Date inventate pentru test', ARRAY['sapatura', 'egalizare', 'armare_cofrare', 'turnare', 'elevatie', 'decofrare', 'umplutura', 'montaj']::text[], 4, '2026-10-20'::date),
  ('F6-2', 'TEST-C-REZ-01', 'TEST-C-00', 'Fundație fictivă rezervor 1, reazem 2', 'fundatie', 'rezervoare', 'Rezervor fictiv 1', 1, 'buc', 'Poziție fictivă B', 'de_confirmat', NULL, ARRAY['sapatura', 'egalizare', 'armare_cofrare', 'turnare', 'elevatie', 'decofrare', 'umplutura', 'montaj']::text[], NULL, NULL);
DO $import$
DECLARE v_noi integer; v_modif integer; v_react integer; v_anul integer; v_stadiu integer; v_pb text;
BEGIN
  -- 0. stadiul inițial nu poate avea o dată din viitor (Europe/Bucharest)
  SELECT string_agg(l.cod, ', ' ORDER BY l.cod) INTO v_pb FROM _constr_lista l WHERE l.stadiu_data > (now() AT TIME ZONE 'Europe/Bucharest')::date;
  IF v_pb IS NOT NULL THEN RAISE EXCEPTION 'import constructii: stadiu inițial cu dată în viitor la: %', v_pb; END IF;
  -- 1. un element cu etape bifate care lipsește din listă oprește importul (nu se anulează automat)
  SELECT string_agg(s.cod || ' (' || cardinality(s.etape_data) || ' etape bifate)', ', ' ORDER BY s.cod) INTO v_pb FROM public.executie_noduri_constructii s
   WHERE s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND cardinality(s.etape_data) > 0
     AND NOT EXISTS (SELECT 1 FROM _constr_lista l WHERE l.cod = s.cod);
  IF v_pb IS NOT NULL THEN
    RAISE EXCEPTION 'import constructii: lipsesc din listă elemente cu etape bifate: % — se lămuresc întâi, importul nu le anulează', v_pb;
  END IF;
  -- 2. lista nouă de etape trebuie să păstreze etapele deja bifate (aceleași coduri, în aceeași ordine, la început)
  SELECT string_agg(s.cod, ', ' ORDER BY s.cod) INTO v_pb FROM public.executie_noduri_constructii s JOIN _constr_lista l ON l.cod = s.cod
   WHERE s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND cardinality(s.etape_data) > 0
     AND (cardinality(l.etape) < cardinality(s.etape_data) OR l.etape[1:cardinality(s.etape_data)] IS DISTINCT FROM s.etape[1:cardinality(s.etape_data)]);
  IF v_pb IS NOT NULL THEN
    RAISE EXCEPTION 'import constructii: lista nouă de etape nu păstrează etapele deja bifate la: %', v_pb;
  END IF;
  -- 3. stadiul inițial se scrie doar pe elementele fără bifări; pe un element bifat, primele k etape bifate trebuie să fie exact stadiul cerut
  --    (aceleași k etape, toate cu data stadiului): reluarea aceluiași fișier trece și după bifări noi în aplicație; altă dată / alt k = oprire
  SELECT string_agg(s.cod, ', ' ORDER BY s.cod) INTO v_pb FROM public.executie_noduri_constructii s JOIN _constr_lista l ON l.cod = s.cod
   WHERE s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND l.stadiu_k IS NOT NULL AND cardinality(s.etape_data) > 0
     AND (cardinality(s.etape_data) < l.stadiu_k OR s.etape_data[1:l.stadiu_k] IS DISTINCT FROM array_fill(l.stadiu_data, ARRAY[l.stadiu_k]));
  IF v_pb IS NOT NULL THEN
    RAISE EXCEPTION 'import constructii: stadiul inițial diferă de etapele deja bifate la: % (se lămurește în aplicație, nu prin import)', v_pb;
  END IF;
  -- 4. upsert: noile se adaugă; la cele existente se actualizează descrierea / etapele, și doar dacă diferă
  WITH u AS (
    INSERT INTO public.executie_noduri_constructii AS s (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, echipament, cantitate, um,
      pozitie, certitudine, observatii, etape)
    SELECT 1, 'NOD-TEST-IMPORT', l.cod, l.cod_detaliu, l.plansa_sursa, l.denumire, l.tip, l.grup, l.echipament, l.cantitate, l.um, l.pozitie, l.certitudine, l.observatii, l.etape FROM _constr_lista l ORDER BY l.cod
    ON CONFLICT (proiect_id, nod_cod, cod) DO UPDATE SET cod_detaliu = EXCLUDED.cod_detaliu, plansa_sursa = EXCLUDED.plansa_sursa, denumire = EXCLUDED.denumire,
      tip = EXCLUDED.tip, grup = EXCLUDED.grup, echipament = EXCLUDED.echipament, cantitate = EXCLUDED.cantitate, um = EXCLUDED.um, pozitie = EXCLUDED.pozitie,
      certitudine = EXCLUDED.certitudine, observatii = EXCLUDED.observatii, etape = EXCLUDED.etape, versiune = s.versiune + 1
    WHERE (s.cod_detaliu, s.plansa_sursa, s.denumire, s.tip, s.grup, s.echipament, s.cantitate, s.um, s.pozitie, s.certitudine, s.observatii, s.etape) IS DISTINCT FROM (EXCLUDED.cod_detaliu, EXCLUDED.plansa_sursa, EXCLUDED.denumire, EXCLUDED.tip, EXCLUDED.grup, EXCLUDED.echipament,
      EXCLUDED.cantitate, EXCLUDED.um, EXCLUDED.pozitie, EXCLUDED.certitudine, EXCLUDED.observatii, EXCLUDED.etape)
    RETURNING (xmax = 0) AS nou)
  SELECT count(*) FILTER (WHERE nou), count(*) FILTER (WHERE NOT nou) INTO v_noi, v_modif FROM u;
  -- 5. anulate de un import anterior și reapărute în listă -> activ
  UPDATE public.executie_noduri_constructii s SET stare = 'activ', motiv = NULL, versiune = s.versiune + 1
   WHERE s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND s.stare = 'anulat' AND s.motiv LIKE 'import: %'
     AND EXISTS (SELECT 1 FROM _constr_lista l WHERE l.cod = s.cod);
  GET DIAGNOSTICS v_react = ROW_COUNT;
  -- 6. lipsă din listă și fără bifări -> anulat (nu se șterg)
  UPDATE public.executie_noduri_constructii s SET stare = 'anulat', motiv = 'import: lipsește din lista importată (sha256 exemplu5exem)', versiune = s.versiune + 1
   WHERE s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND s.stare = 'activ' AND cardinality(s.etape_data) = 0
     AND NOT EXISTS (SELECT 1 FROM _constr_lista l WHERE l.cod = s.cod);
  GET DIAGNOSTICS v_anul = ROW_COUNT;
  -- 7. stadiul inițial: primele k etape făcute la data dată, fără utilizator (etape_de NULL = „din import”), doar pe elementele fără bifări
  UPDATE public.executie_noduri_constructii s SET etape_data = array_fill(l.stadiu_data, ARRAY[l.stadiu_k]),
         etape_de = array_fill(NULL::uuid, ARRAY[l.stadiu_k]), etape_la = array_fill(now(), ARRAY[l.stadiu_k]), versiune = s.versiune + 1
    FROM _constr_lista l
   WHERE s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND s.cod = l.cod AND l.stadiu_k IS NOT NULL AND cardinality(s.etape_data) = 0;
  GET DIAGNOSTICS v_stadiu = ROW_COUNT;
  -- postcondiții: fiecare cod din fișier e pe nod, activ, cu descrierea / etapele din fișier și (dacă e cerut) cu stadiul cerut
  IF EXISTS (SELECT 1 FROM _constr_lista l LEFT JOIN public.executie_noduri_constructii s ON s.proiect_id = 1 AND s.nod_cod = 'NOD-TEST-IMPORT' AND s.cod = l.cod
              WHERE s.id IS NULL OR s.stare <> 'activ'
                 OR (s.cod_detaliu, s.plansa_sursa, s.denumire, s.tip, s.grup, s.echipament, s.cantitate, s.um, s.pozitie, s.certitudine, s.observatii, s.etape) IS DISTINCT FROM (l.cod_detaliu, l.plansa_sursa, l.denumire, l.tip, l.grup, l.echipament, l.cantitate, l.um, l.pozitie, l.certitudine, l.observatii, l.etape)
                 OR (l.stadiu_k IS NOT NULL AND (cardinality(s.etape_data) < l.stadiu_k
                     OR s.etape_data[1:l.stadiu_k] IS DISTINCT FROM array_fill(l.stadiu_data, ARRAY[l.stadiu_k])))) THEN
    RAISE EXCEPTION 'import constructii: nu toate elementele din fișier sunt pe nod, active și la zi (un element anulat manual se lămurește întâi)';
  END IF;
  RAISE NOTICE 'import constructii %: % noi, % actualizate, % reactivate, % anulate (lipsă din listă), % cu stadiu inițial scris',
    'NOD-TEST-IMPORT', v_noi, v_modif, v_react, v_anul, v_stadiu;
END $import$;
