-- Teste locale Z2 titularul vizat (decizia omului pe cerință).
\set QUIET on
CREATE TEMP TABLE r (n serial, nume text, ok boolean, info text);
GRANT ALL ON r TO PUBLIC; GRANT ALL ON SEQUENCE r_n_seq TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.t(p_nume text, p_ok boolean, p_info text DEFAULT NULL) RETURNS void LANGUAGE sql AS
$$ INSERT INTO r (nume, ok, info) VALUES (p_nume, coalesce(p_ok, false), p_info) $$;
CREATE OR REPLACE FUNCTION pg_temp.ca(p_uid text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, false) $$;
CREATE TEMP TABLE amprenta AS SELECT md5(string_agg(c::text, '|' ORDER BY id)) h FROM public.ofertare_cerinte c;
GRANT SELECT ON amprenta TO PUBLIC;
SET ROLE authenticated;

SELECT pg_temp.ca(NULL);
DO $$ BEGIN PERFORM public.fn_ofertare_cerinta_titular_seteaza((SELECT min(id) FROM public.ofertare_cerinte), 'operator_economic'); PERFORM pg_temp.t('T1 anonim refuzat', false);
EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.t('T1 anonim refuzat', true); END $$;
SELECT pg_temp.ca('33333333-3333-3333-3333-333333333333');
DO $$ BEGIN PERFORM public.fn_ofertare_cerinta_titular_seteaza((SELECT min(id) FROM public.ofertare_cerinte), 'operator_economic'); PERFORM pg_temp.t('T2 fără modul Ofertare refuzat', false);
EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.t('T2 fără modul Ofertare refuzat', true); END $$;

SELECT pg_temp.ca('22222222-2222-2222-2222-222222222222');
SELECT public.fn_ofertare_cerinta_titular_seteaza((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 16), 'operator_economic', ' ofertant ');
SELECT pg_temp.t('T3 decizia omului se scrie, cu calitatea curățată',
  (SELECT tip_titular = 'operator_economic' AND calitate = 'ofertant' AND setat_de = '22222222-2222-2222-2222-222222222222'
   FROM public.ofertare_cerinte_titular t JOIN public.ofertare_cerinte c ON c.id = t.cerinta_id WHERE c.nr_ordine = 16));
SELECT public.fn_ofertare_cerinta_titular_seteaza((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 16), 'persoana_fizica');
SELECT pg_temp.t('T4 a doua decizie o înlocuiește pe prima (un rând per cerință)',
  (SELECT count(*) = 1 AND bool_and(tip_titular = 'persoana_fizica' AND calitate IS NULL) FROM public.ofertare_cerinte_titular t JOIN public.ofertare_cerinte c ON c.id = t.cerinta_id WHERE c.nr_ordine = 16));
DO $$ BEGIN PERFORM public.fn_ofertare_cerinta_titular_seteaza((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 16), 'firma'); PERFORM pg_temp.t('T5 tip necunoscut refuzat', false);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.t('T5 tip necunoscut refuzat', true); END $$;
SELECT public.fn_ofertare_cerinta_titular_seteaza((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 16), NULL);
SELECT pg_temp.t('T6 NULL = înapoi la deducerea automată (rândul dispare)',
  NOT EXISTS (SELECT 1 FROM public.ofertare_cerinte_titular t JOIN public.ofertare_cerinte c ON c.id = t.cerinta_id WHERE c.nr_ordine = 16));
DO $$ BEGIN PERFORM public.fn_ofertare_cerinta_titular_seteaza((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 37), 'nedeterminat'); PERFORM pg_temp.t('T7 cerința înlocuită nu primește decizie', false);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.t('T7 cerința înlocuită nu primește decizie', true); END $$;
DO $$ BEGIN INSERT INTO public.ofertare_cerinte_titular (cerinta_id, licitatie_id, tip_titular, setat_de) VALUES ((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 146), 900, 'nedeterminat', '22222222-2222-2222-2222-222222222222');
  PERFORM pg_temp.t('T8 INSERT direct refuzat', false);
EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.t('T8 INSERT direct refuzat', true); END $$;
SELECT public.fn_ofertare_cerinta_titular_seteaza((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 146), 'persoana_fizica', 'manager de proiect');
SELECT pg_temp.ca('33333333-3333-3333-3333-333333333333');
SELECT pg_temp.t('T9 fără modul Ofertare: 0 rânduri vizibile', (SELECT count(*) FROM public.ofertare_cerinte_titular) = 0);
RESET ROLE;
-- T11–T15: poarta pe acoperire (Z2b), rulată ca superuser (RLS pe acoperire nu e obiectul testului)
DO $$ DECLARE v_c bigint := (SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 38); BEGIN
  INSERT INTO public.ofertare_acoperire (cerinta_id, mod, status, autorizatie_id, ales) VALUES (v_c, 'personal', 'acoperit', 900, true);
  PERFORM pg_temp.t('T11 fără decizie salvată: persoana se poate alege (poarta e doar pe decizia omului)', true);
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.t('T11 fără decizie salvată: persoana se poate alege (poarta e doar pe decizia omului)', false); END $$;
SELECT set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, false);
DO $$ DECLARE j jsonb := public.fn_ofertare_cerinta_titular_seteaza((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 38), 'operator_economic'); BEGIN
  PERFORM pg_temp.t('T12 decizia „operator" peste o persoană deja aleasă → avertisment, nimic șters',
    j->>'avertisment' IS NOT NULL AND (SELECT count(*) FROM public.ofertare_acoperire WHERE ales) = 1, j::text);
END $$;
DO $$ BEGIN
  INSERT INTO public.ofertare_acoperire (cerinta_id, mod, status, recomandare_id, ales) VALUES ((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 38), 'recomandare', 'acoperit', 7, true);
  PERFORM pg_temp.t('T13 alegerea unei recomandări pe cerință de operator e refuzată', false);
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.t('T13 alegerea unei recomandări pe cerință de operator e refuzată', true); END $$;
DO $$ BEGIN
  INSERT INTO public.ofertare_acoperire (cerinta_id, mod, status, recomandare_id, ales) VALUES ((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 38), 'recomandare', 'acoperit', 8, false);
  PERFORM pg_temp.t('T14 propunerea motorului (ales = false) nu e blocată', true);
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.t('T14 propunerea motorului (ales = false) nu e blocată', false); END $$;
DO $$ BEGIN
  UPDATE public.ofertare_acoperire SET ales = true WHERE recomandare_id = 8;
  PERFORM pg_temp.t('T15 marcarea ca aleasă a propunerii-persoană e refuzată', false);
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.t('T15 marcarea ca aleasă a propunerii-persoană e refuzată', true); END $$;
DO $$ BEGIN
  INSERT INTO public.ofertare_acoperire (cerinta_id, mod, status, doc_firma_id, ales) VALUES ((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 38), 'firma', 'acoperit', 13, true);
  PERFORM pg_temp.t('T16 documentul firmei se alege normal', true);
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.t('T16 documentul firmei se alege normal', false); END $$;
SELECT pg_temp.t('T10 ofertare_cerinte neatins', (SELECT md5(string_agg(c::text, '|' ORDER BY id)) FROM public.ofertare_cerinte c) = (SELECT h FROM amprenta));

\set QUIET off
SELECT CASE WHEN ok THEN 'PASS ' ELSE 'FAIL ' END || nume || CASE WHEN ok THEN '' ELSE ' :: ' || coalesce(info, '') END FROM r ORDER BY n;
SELECT 'TOTAL titular ' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
