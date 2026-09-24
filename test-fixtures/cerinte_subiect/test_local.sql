-- Teste locale Z1 grupare pe subiect. Rulează ca superuser; trece pe rolul `authenticated` + JWT simulat.
\set QUIET on
CREATE TEMP TABLE r (n serial, nume text, ok boolean, info text);
GRANT ALL ON r TO PUBLIC; GRANT ALL ON SEQUENCE r_n_seq TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.t(p_nume text, p_ok boolean, p_info text DEFAULT NULL) RETURNS void LANGUAGE sql AS
$$ INSERT INTO r (nume, ok, info) VALUES (p_nume, coalesce(p_ok, false), p_info) $$;
CREATE OR REPLACE FUNCTION pg_temp.ca(p_uid text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, false) $$;
CREATE TEMP TABLE amprenta AS SELECT md5(string_agg(c::text, '|' ORDER BY id)) h FROM public.ofertare_cerinte c;
GRANT SELECT ON amprenta TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.subiect(p_nr int) RETURNS text LANGUAGE sql AS
$$ SELECT s.subiect || '/' || s.sursa FROM public.ofertare_cerinte_subiect s JOIN public.ofertare_cerinte c ON c.id = s.cerinta_id
   WHERE c.licitatie_id = 900 AND c.nr_ordine = p_nr AND c.inlocuita_de IS NULL $$;

SET ROLE authenticated;

-- 1-2. fără acces
SELECT pg_temp.ca(NULL);
DO $$ BEGIN PERFORM public.fn_ofertare_subiecte_aplica(900, false); PERFORM pg_temp.t('01 anonim refuzat', false);
EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.t('01 anonim refuzat', true); END $$;
SELECT pg_temp.ca('33333333-3333-3333-3333-333333333333');
DO $$ BEGIN PERFORM public.fn_ofertare_subiecte_aplica(900, true); PERFORM pg_temp.t('02 fără modul Ofertare refuzat', false);
EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.t('02 fără modul Ofertare refuzat', true); END $$;

-- 3-4. preview
SELECT pg_temp.ca('22222222-2222-2222-2222-222222222222');
DO $$ DECLARE j jsonb := public.fn_ofertare_subiecte_aplica(900, false); BEGIN
  PERFORM pg_temp.t('03 preview nu scrie', (j->>'scrise')::int = 0 AND NOT EXISTS (SELECT 1 FROM public.ofertare_cerinte_subiect), j::text);
  PERFORM pg_temp.t('04 preview: total 7, nou 7, 1 neclasificat', (j->>'total')::int = 7 AND (j->'actiuni'->>'nou')::int = 7 AND (j->>'neclasificate')::int = 1, j::text);
  PERFORM pg_temp.t('05 preview: EDSB ×2 în autorizare_anre', (j->'pe_subiect'->>'autorizare_anre')::int = 2, j->>'pe_subiect');
END $$;

-- 6. aplicare
DO $$ DECLARE j jsonb := public.fn_ofertare_subiecte_aplica(900, true); BEGIN
  PERFORM pg_temp.t('06 aplică scrie 7, doar lic. 900', (j->>'scrise')::int = 7
    AND (SELECT count(*) FROM public.ofertare_cerinte_subiect WHERE licitatie_id = 900) = 7
    AND (SELECT count(*) FROM public.ofertare_cerinte_subiect WHERE licitatie_id = 901) = 0, j::text);
END $$;
SELECT pg_temp.t('07 #16 și #37 EDSB → autorizare_anre', pg_temp.subiect(16) = 'autorizare_anre/auto' AND pg_temp.subiect(37) = 'autorizare_anre/auto');
SELECT pg_temp.t('08 #146 → personal_manager_proiect', pg_temp.subiect(146) = 'personal_manager_proiect/auto', pg_temp.subiect(146));
SELECT pg_temp.t('09 #175 (36 luni) → grafic_executie', pg_temp.subiect(175) = 'grafic_executie/auto', pg_temp.subiect(175));
SELECT pg_temp.t('10 #369 agrement + aviz sanitar → materiale_agremente', pg_temp.subiect(369) = 'materiale_agremente/auto', pg_temp.subiect(369));
SELECT pg_temp.t('11 #500 → neclasificat', pg_temp.subiect(500) = 'neclasificat/auto', pg_temp.subiect(500));
SELECT pg_temp.t('12 #501 ambiguu: manager + alternative grafic/ședință',
  (SELECT s.subiect = 'personal_manager_proiect' AND s.alternative @> ARRAY['grafic_executie','management_contract']
   FROM public.ofertare_cerinte_subiect s JOIN public.ofertare_cerinte c ON c.id = s.cerinta_id WHERE c.nr_ordine = 501),
  (SELECT s.alternative::text FROM public.ofertare_cerinte_subiect s JOIN public.ofertare_cerinte c ON c.id = s.cerinta_id WHERE c.nr_ordine = 501));

-- 13. idempotent
DO $$ DECLARE j jsonb := public.fn_ofertare_subiecte_aplica(900, true); BEGIN
  PERFORM pg_temp.t('13 re-aplicare: 0 scrise, 7 neschimbate', (j->>'scrise')::int = 0 AND (j->'actiuni'->>'neschimbat')::int = 7, j::text);
END $$;

-- 14-16. mutarea omului supraviețuiește
SELECT public.fn_ofertare_subiect_muta((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 501), 'grafic_executie');
DO $$ DECLARE j jsonb := public.fn_ofertare_subiecte_aplica(900, true); BEGIN
  PERFORM pg_temp.t('14 mutarea manuală rămâne după re-aplicare', pg_temp.subiect(501) = 'grafic_executie/om'
    AND (j->'actiuni'->>'pastrat_om')::int = 1 AND (j->>'scrise')::int = 0, j::text);
END $$;
SELECT pg_temp.t('15 setat_de = omul care a mutat',
  (SELECT setat_de FROM public.ofertare_cerinte_subiect s JOIN public.ofertare_cerinte c ON c.id = s.cerinta_id WHERE c.nr_ordine = 501) = '22222222-2222-2222-2222-222222222222');
DO $$ BEGIN PERFORM public.fn_ofertare_subiect_muta((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 501), 'inventat'); PERFORM pg_temp.t('16 subiect necunoscut refuzat', false);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.t('16 subiect necunoscut refuzat', true); END $$;
SELECT public.fn_ofertare_subiect_muta((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 500), 'neclasificat');
SELECT pg_temp.t('17 „neclasificat" e mutare validă', pg_temp.subiect(500) = 'neclasificat/om');
SELECT public.fn_ofertare_subiect_muta((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 501), NULL);
SELECT pg_temp.t('18 NULL = înapoi la regulă', pg_temp.subiect(501) = 'personal_manager_proiect/auto', pg_temp.subiect(501));

-- 19-21. scriere directă interzisă, RLS pe citire
DO $$ BEGIN INSERT INTO public.ofertare_cerinte_subiect (cerinta_id, licitatie_id, subiect, sursa, versiune) VALUES ((SELECT id FROM public.ofertare_cerinte WHERE licitatie_id = 901), 901, 'ssm', 'auto', 2);
  PERFORM pg_temp.t('19 INSERT direct refuzat', false);
EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.t('19 INSERT direct refuzat', true); END $$;
DO $$ BEGIN UPDATE public.ofertare_cerinte_subiect SET subiect = 'ssm'; PERFORM pg_temp.t('20 UPDATE direct refuzat', false);
EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.t('20 UPDATE direct refuzat', true); END $$;
SELECT pg_temp.ca('33333333-3333-3333-3333-333333333333');
SELECT pg_temp.t('21 fără modul Ofertare: 0 rânduri vizibile', (SELECT count(*) FROM public.ofertare_cerinte_subiect) = 0);
DO $$ BEGIN PERFORM * FROM public._fn_ofertare_subiecte_calc(900, 2); PERFORM pg_temp.t('22 funcția internă nu e apelabilă', false);
EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.t('22 funcția internă nu e apelabilă', true); END $$;
SELECT pg_temp.ca('22222222-2222-2222-2222-222222222222');

-- 23-25. moștenire pe versiunea nouă a cerinței (clarificare)
SELECT public.fn_ofertare_subiect_muta((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 37), 'experienta_similara');
RESET ROLE;
INSERT INTO public.ofertare_cerinte (licitatie_id, nr_ordine, sursa_sectiune, text_cerinta) VALUES (900, 38, 'III.1.2', 'Autorizație EDSB (text modificat prin clarificare)');
UPDATE public.ofertare_cerinte SET inlocuita_de = (SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 38) WHERE nr_ordine = 37;
UPDATE amprenta SET h = (SELECT md5(string_agg(c::text, '|' ORDER BY id)) FROM public.ofertare_cerinte c);
SET ROLE authenticated;
DO $$ DECLARE j jsonb := public.fn_ofertare_subiecte_aplica(900, true); BEGIN
  PERFORM pg_temp.t('23 versiunea nouă moștenește mutarea omului', pg_temp.subiect(38) = 'experienta_similara/om' AND (j->'actiuni'->>'mostenit')::int = 1, j::text);
END $$;
SELECT pg_temp.t('23b moștenirea e marcată (mostenit_de_la = cerința veche)',
  (SELECT s.mostenit_de_la FROM public.ofertare_cerinte_subiect s JOIN public.ofertare_cerinte c ON c.id = s.cerinta_id WHERE c.nr_ordine = 38)
  = (SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 37));
DO $$ DECLARE j jsonb := public.fn_ofertare_subiecte_aplica(900, false); BEGIN
  PERFORM pg_temp.t('23c moștenita intră la „de verificat"', (j->>'de_verificat')::int >= 1, j::text);
END $$;
SELECT public.fn_ofertare_subiect_muta((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 38), 'autorizare_anre');
SELECT pg_temp.t('23d mutarea pe textul nou șterge marcajul de moștenire',
  (SELECT s.mostenit_de_la IS NULL AND s.sursa = 'om' FROM public.ofertare_cerinte_subiect s JOIN public.ofertare_cerinte c ON c.id = s.cerinta_id WHERE c.nr_ordine = 38));
DO $$ BEGIN PERFORM public.fn_ofertare_subiect_muta((SELECT id FROM public.ofertare_cerinte WHERE nr_ordine = 37), 'ssm'); PERFORM pg_temp.t('24 cerința înlocuită nu se mai mută', false);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.t('24 cerința înlocuită nu se mai mută', true); END $$;
RESET ROLE;
SELECT pg_temp.t('25 ofertare_cerinte neatins (text, E2, proveniență)', (SELECT md5(string_agg(c::text, '|' ORDER BY id)) FROM public.ofertare_cerinte c) = (SELECT h FROM amprenta));
-- 26. ștergerea cerinței șterge și subiectul
DELETE FROM public.ofertare_cerinte WHERE nr_ordine = 500;
SELECT pg_temp.t('26 ON DELETE CASCADE', NOT EXISTS (SELECT 1 FROM public.ofertare_cerinte_subiect s WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cerinte c WHERE c.id = s.cerinta_id)));

\set QUIET off
SELECT CASE WHEN ok THEN 'PASS ' ELSE 'FAIL ' END || nume || CASE WHEN ok THEN '' ELSE ' :: ' || coalesce(info, '') END FROM r ORDER BY n;
SELECT 'TOTAL ' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
