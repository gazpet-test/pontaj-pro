-- Durata MUTĂRII unui șantier în alt proiect, la volum (20261216a r5, Jakarinos r4 P2) — DOAR pe CLONĂ, într-o tranzacție ANULATĂ la final
-- (nimic nu rămâne scris). Cât durează mutarea, salvările rapoartelor ACELUI șantier așteaptă (celelalte șantiere nu: r5, S7 din
-- scripts/raport_rezumat_concurenta.sh); scriptul spune cât.
-- Rulare (psql, conexiunea clonei; parola din pgpass), pe rând cu n = 500, 2000, 10000:
--   psql -X -v ON_ERROR_STOP=1 -v sistem=<system_identifier al clonei> -v n=2000 -h <host clonă> -p <port> -U postgres -d postgres \
--        -f scripts/raport_rezumat_mutare_durata.sql
-- Ce face: pe PRIMUL șantier cu proiect, n rapoarte SINTETICE (zilele 1900-01-01 + i, verificate libere), fiecare cu rezumatul automat compus
--   de gardă (ca o salvare reală), apoi mutarea șantierului în alt proiect (UPDATE sites, cu trigger-ul real: lock-urile de rând NOWAIT +
--   invalidarea fiecărui rezumat automat) și tipărește durata mutării. Rapoartele reale ale șantierului (dacă are) intră și ele în
--   invalidare, deci cifra e pentru n + rapoartele lui. Apoi ROLLBACK.
-- Garda țintei: system_identifier al bazei = -v sistem, altfel refuz înainte de orice scriere.
-- Cât de mare e azi cel mai mare șantier (pe PRODUCȚIE, doar citire; o rulează coordonatorul):
--   SELECT site_id, count(*) AS rapoarte, count(*) FILTER (WHERE data >= current_date - 365) AS ultimul_an
--     FROM public.rapoarte_zilnice GROUP BY site_id ORDER BY rapoarte DESC LIMIT 5;
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL statement_timeout = 0;
SELECT set_config('trez.sistem', :'sistem', true) IS NOT NULL AS sistem_setat, set_config('trez.n', :'n', true) IS NOT NULL AS n_setat;
DO $d$
DECLARE
  v_n integer; v_site bigint; v_p0 bigint; v_p1 bigint; v_reale integer; v_inv integer;
  t0 timestamptz; t1 timestamptz; t2 timestamptz;
BEGIN
  IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM current_setting('trez.sistem') THEN
    RAISE EXCEPTION 'REFUZ: system_identifier al bazei <> -v sistem (nu e clona ceruta); nimic scris';
  END IF;
  IF current_setting('trez.n') !~ '^[0-9]{1,5}$' OR current_setting('trez.n')::integer NOT BETWEEN 1 AND 50000 THEN
    RAISE EXCEPTION 'REFUZ: -v n trebuie sa fie intre 1 si 50000';
  END IF;
  v_n := current_setting('trez.n')::integer;
  IF to_regprocedure('public.fn_raport_rezumat_santier_mutat()') IS NULL THEN RAISE EXCEPTION 'REFUZ: 20261216a nu e aplicata pe clona'; END IF;
  SELECT s.id, s.proiect_id INTO v_site, v_p0 FROM public.sites s WHERE s.proiect_id IS NOT NULL ORDER BY s.id LIMIT 1;
  SELECT p.id INTO v_p1 FROM public.executie_proiecte p WHERE p.id IS DISTINCT FROM v_p0 ORDER BY p.id LIMIT 1;
  IF v_site IS NULL OR v_p1 IS NULL THEN RAISE EXCEPTION 'REFUZ: lipseste un santier cu proiect sau un al doilea proiect pe clona'; END IF;
  IF EXISTS (SELECT 1 FROM public.rapoarte_zilnice r WHERE r.site_id = v_site AND r.data BETWEEN DATE '1900-01-01' AND DATE '1900-01-01' + v_n) THEN
    RAISE EXCEPTION 'REFUZ: zilele sintetice 1900-01-01 + 0..% sunt ocupate pe santierul %', v_n, v_site;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rapoarte_zilnice r WHERE r.site_id = v_site AND r.rezumat_sursa = 'editat') THEN
    RAISE EXCEPTION 'REFUZ: santierul % are rezumate corectate de om (mutarea ar refuza); alege alta clona / alt santier', v_site;
  END IF;
  SELECT count(*)::integer INTO v_reale FROM public.rapoarte_zilnice r WHERE r.site_id = v_site;
  t0 := clock_timestamp();
  INSERT INTO public.rapoarte_zilnice (site_id, data, probleme, personal_snapshot, updated_at)
  SELECT v_site, DATE '1900-01-01' + g, 'Proba durata mutare ' || g, '{"total": 5, "sudori": 2}'::jsonb, now()
    FROM generate_series(1, v_n) g;
  t1 := clock_timestamp();
  UPDATE public.sites SET proiect_id = v_p1 WHERE id = v_site;
  t2 := clock_timestamp();
  SELECT count(*)::integer INTO v_inv FROM public.rapoarte_zilnice r WHERE r.site_id = v_site AND r.rezumat_sursa = 'de_recompus';
  RAISE NOTICE 'DURATA_MUTARE n=% (+ % rapoarte reale ale santierului %): % rezumate invalidate; mutarea % ms (% ms / raport); inserarea sintetica % ms',
    v_n, v_reale, v_site, v_inv, round(extract(epoch FROM t2 - t1) * 1000),
    round(extract(epoch FROM t2 - t1) * 1000 / greatest(v_inv, 1), 3), round(extract(epoch FROM t1 - t0) * 1000);
END $d$;
ROLLBACK;
