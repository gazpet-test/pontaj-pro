-- DRY 20261205a_polite_alerte: se ruleaza IN ACEEASI tranzactie cu migrarea (scripts/test_polite_alerte.sh), pe scheletul local,
-- apoi ROLLBACK. Fiecare test scrie NOTICE 'TESTnn OK …'; orice abatere = exceptie (ON_ERROR_STOP). Valorile asteptate vin din
-- specificatie (pragurile 60/30/15/0/r1/r2 ale propunerii, D2 A), nu din codul testat (L25). Identitatea: ambele surse JWT + SET LOCAL ROLE.
-- Conturi FICTIVE din schelet: a = owner, b = financiar (scrie garantii), c = gestioneaza contracte, d = fara drepturi.

-- ── TEST01: valorile initiale ale listei (adrese luate din BD, nu inventate) ─────────────────────────────────────────────────
DO $t$
DECLARE v text;
BEGIN
  SELECT string_agg(departament || ':' || fel || ':' || coalesce(email, '-'), ' ' ORDER BY departament, fel, coalesce(email, '-')) INTO v FROM public.polite_alerte_destinatari;
  IF v IS DISTINCT FROM 'executie:manager_proiect:- executie:sef_santier:- financiar:adresa:marilena.tudorache@gazpet.ro financiar:adresa:mirela.popescu@gazpet.ro ofertare:adresa:-' THEN
    RAISE EXCEPTION 'TEST01 FAIL lista initiala: %', v;
  END IF;
  IF (SELECT observatii FROM public.polite_alerte_destinatari WHERE departament = 'ofertare') IS NULL THEN RAISE EXCEPTION 'TEST01 FAIL lipseste observatia pe adresa negasita'; END IF;
  IF (SELECT activ FROM public.polite_alerte_config) IS NOT FALSE THEN RAISE EXCEPTION 'TEST01 FAIL comutatorul nu e oprit'; END IF;
  RAISE NOTICE 'TEST01 OK lista initiala (Marilena din fisa, Mirela din cont, Cristina fara adresa) + comutator oprit';
END $t$;

-- ── TEST02: pragurile (tabel independent: zile ramase -> prag) ────────────────────────────────────────────────────────────────
INSERT INTO public.contracte_polite (id, contract_id, tip, asigurator, nr_polita, valoare_lei, data_emitere, data_expirare, status)
VALUES (901, 18, 'GBE', 'ASIG TEST', 'PRAG-1', 100, '2026-01-01', '2026-12-31', 'activa');
DO $t$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES (61, NULL), (60, '60'), (31, '60'), (30, '30'), (16, '30'), (15, '15'), (1, '15'), (0, '0'), (-6, '0'),
                                 (-7, 'r1'), (-13, 'r1'), (-14, 'r2'), (-30, 'r4')) x(zile, prag) LOOP
    SELECT s.prag INTO v FROM public.fn_polite_scadente(DATE '2026-12-31' - r.zile) s WHERE s.cheie = 'contract:901';
    IF v IS DISTINCT FROM r.prag THEN RAISE EXCEPTION 'TEST02 FAIL zile % -> prag % (astept %)', r.zile, v, r.prag; END IF;
  END LOOP;
  -- actul aditional cu expirare mai tarzie muta scadenta (expirarea efectiva = cea mai tarzie din acte)
  INSERT INTO public.contracte_polite_acte (polita_id, nr_act, data_expirare_noua) VALUES (901, 1, '2027-03-31');
  SELECT s.data_expirare::text || ':' || coalesce(s.prag, '-') INTO v FROM public.fn_polite_scadente(DATE '2026-12-31') s WHERE s.cheie = 'contract:901';
  IF v IS DISTINCT FROM '2027-03-31:-' THEN RAISE EXCEPTION 'TEST02 FAIL expirarea efectiva cu act: %', v; END IF;
  UPDATE public.contracte_polite SET status = 'retrasa' WHERE id = 901;
  IF EXISTS (SELECT 1 FROM public.fn_polite_scadente(DATE '2026-12-31') s WHERE s.cheie = 'contract:901') THEN RAISE EXCEPTION 'TEST02 FAIL polita retrasa inca apare'; END IF;
  RAISE NOTICE 'TEST02 OK pragurile 60/30/15/0/r1/r2/r4, actul muta scadenta, polita inchisa iese';
END $t$;

-- date pentru alerte (azi = 2026-11-10): polita pe contractul cu proiect (15 zile), polita fara proiect (expirata azi), Registru nelegat (30 zile)
INSERT INTO public.contracte_polite (id, contract_id, tip, asigurator, nr_polita, valoare_lei, data_expirare, status) VALUES
  (902, 17, 'CAR', 'ASIG <b>TEST</b>', 'CAR-902', 5000, '2026-11-25', 'activa'),
  (903, 18, 'GPL', 'ASIG TEST', 'GPL-903', 700, '2026-11-10', 'activa');
INSERT INTO public.garantii (id, forma, tip, beneficiar, emitent, numar_document, valoare, moneda, data_expirare, stare)
VALUES (801, 'polita_asigurare', 'buna_executie', 'BENEFICIAR VECHI', 'ASIG VECHI', 'VECHE-801', 900, 'RON', '2026-12-10', 'activa');

-- ── TEST03: proba si comutatorul: doar owner-ul; pornirea cere proba ───────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true), set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  IF auth.uid() IS DISTINCT FROM '00000000-0000-0000-0000-00000000000d'::uuid OR current_user <> 'authenticated' THEN RAISE EXCEPTION 'TEST03 FAIL identitate'; END IF;
  BEGIN PERFORM public.fn_polite_alerte_proba(DATE '2026-11-10'); RAISE EXCEPTION 'TEST03 FAIL proba rulata de un non-owner';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.fn_polite_alerte_porneste(true); RAISE EXCEPTION 'TEST03 FAIL comutator pornit de un non-owner';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.polite_alerte_destinatari) OR EXISTS (SELECT 1 FROM public.polite_alerte_jurnal) OR EXISTS (SELECT 1 FROM public.polite_alerte_config) THEN
    RAISE EXCEPTION 'TEST03 FAIL un non-owner vede lista / jurnalul / comutatorul';
  END IF;
  RAISE NOTICE 'TEST03 OK non-owner: proba / comutator refuzate (42501), lista / jurnal / comutator invizibile';
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true), set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; n integer;
BEGIN
  BEGIN PERFORM public.fn_polite_alerte_porneste(true); RAISE EXCEPTION 'TEST04 FAIL pornit fara proba';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'fara_proba' THEN RAISE; END IF; END;
  v := public.fn_polite_alerte_proba(DATE '2026-11-10');
  -- 902 (ctr 17, proiect 5): Marilena, Mirela, sef santier = 3 adrese + Cristina / MP extern = 2 fara adresa
  -- 903 (ctr 18, fara proiect): Marilena, Mirela + Cristina / sef / MP = 3 fara adresa;  801 (Registru): la fel ca 903
  IF (v->>'randuri')::integer <> 15 OR (v->>'destinatari')::integer <> 3 OR (v->>'fara_adresa')::integer <> 8 THEN RAISE EXCEPTION 'TEST04 FAIL proba: %', v; END IF;
  SELECT count(*) INTO n FROM public.polite_alerte_jurnal WHERE stare = 'proba' AND destinatar_email = 'mp.extern@exemplu.test';
  IF n <> 0 THEN RAISE EXCEPTION 'TEST04 FAIL adresa din afara domeniului a intrat'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.polite_alerte_jurnal WHERE stare = 'proba' AND cheie = 'contract:902|15|2026-11-25|sef.santier@gazpet.ro'
                   AND departamente = ARRAY['executie']::text[]) THEN
    RAISE EXCEPTION 'TEST04 FAIL lipseste seful de santier pe 902';
  END IF;
  IF (SELECT count(*) FROM public.notifications) <> 0 THEN RAISE EXCEPTION 'TEST04 FAIL proba a scris notificari'; END IF;
  v := public.fn_polite_alerte_porneste(true);
  IF (v->>'activ')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'TEST04 FAIL comutatorul nu a pornit: %', v; END IF;
  RAISE NOTICE 'TEST04 OK pornirea cere proba; proba = 15 randuri (3 adrese, 8 fara adresa), fara notificari, fara adrese externe';
END $t$;
RESET ROLE;

-- ── TEST05: cronul (service_role): rezervare unica pe cheie, notificari, a doua rulare = nimic ─────────────────────────────────
SET LOCAL ROLE service_role;
DO $t$
DECLARE n integer; m integer; v jsonb;
BEGIN
  -- r2: rezultatul e un singur jsonb {activ, zi, n, randuri}
  v := public.fn_polite_alerte_rezerva(DATE '2026-11-10');
  SELECT count(*), count(*) FILTER (WHERE e->>'stare' = 'rezervat') INTO n, m FROM jsonb_array_elements(v->'randuri') e;
  IF (v->>'activ')::boolean IS NOT TRUE OR (v->>'n')::integer <> n OR n <> 15 OR m <> 7 THEN
    RAISE EXCEPTION 'TEST05 FAIL prima rezervare: n=% randuri=% rezervate=% (astept 15 / 7)', v->>'n', n, m;
  END IF;
  v := public.fn_polite_alerte_rezerva(DATE '2026-11-10');
  IF (v->>'n')::integer <> 0 OR jsonb_array_length(v->'randuri') <> 0 THEN RAISE EXCEPTION 'TEST05 FAIL a doua rulare a rezervat %', v->>'n'; END IF;
  RAISE NOTICE 'TEST05 OK rezervare 15 randuri (7 de trimis), a doua rulare 0';
END $t$;
RESET ROLE;
DO $t$
DECLARE n integer;
BEGIN
  -- conturi ERP printre destinatari: Mirela (e) pe 3 polite + seful de santier (f) pe 902 = 4 notificari; Marilena nu are cont
  SELECT count(*) INTO n FROM public.notifications;
  IF n <> 4 OR EXISTS (SELECT 1 FROM public.notifications WHERE profile_id NOT IN ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000f')) THEN
    RAISE EXCEPTION 'TEST06 FAIL notificari: %', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE profile_id = '00000000-0000-0000-0000-00000000000f' AND modul = 'Execuție' AND link_to = '/executie?proiect=5') THEN
    RAISE EXCEPTION 'TEST06 FAIL notificarea sefului de santier (modul / link)';
  END IF;
  RAISE NOTICE 'TEST06 OK 4 notificari in aplicatie, pe modulul si linkul departamentului';
END $t$;
SET LOCAL ROLE service_role;
DO $t$
BEGIN
  -- service_role nu citeste jurnalul direct (doar prin RPC-uri)
  BEGIN PERFORM 1 FROM public.polite_alerte_jurnal; RAISE EXCEPTION 'TEST07 FAIL service_role citeste jurnalul direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'TEST07 OK service_role fara acces direct la jurnal';
END $t$;
RESET ROLE;
DO $t$
DECLARE ids bigint[]; n integer;
BEGIN
  SELECT array_agg(id ORDER BY id) INTO ids FROM public.polite_alerte_jurnal WHERE stare = 'rezervat' AND destinatar_email = 'mirela.popescu@gazpet.ro';
  SET LOCAL ROLE service_role;
  n := public.fn_polite_alerte_marcheaza(ids, 'trimis', 'resend_test_1', NULL);
  IF n <> 3 THEN RAISE EXCEPTION 'TEST08 FAIL marcare: %', n; END IF;
  n := public.fn_polite_alerte_marcheaza(ids, 'eroare', NULL, 'resend_4xx');
  IF n <> 0 THEN RAISE EXCEPTION 'TEST08 FAIL a doua marcare a schimbat % randuri', n; END IF;
  BEGIN PERFORM public.fn_polite_alerte_marcheaza(ids, 'trimis', NULL, 'x'); RAISE EXCEPTION 'TEST08 FAIL trimis cu eroare acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  RAISE NOTICE 'TEST08 OK marcare doar din rezervat (CAS), argumente invalide refuzate';
END $t$;

-- ── TEST09: propunerea citita + provenienta ─────────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE service_role;
DO $t$
DECLARE v jsonb; v_id bigint;
BEGIN
  v := public.fn_polite_propunere_rezerva(repeat('ab', 32), '00000000-0000-0000-0000-00000000000c');
  IF (v->>'rezervat')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'TEST09 FAIL rezervare: %', v; END IF;
  v_id := (v->>'id')::bigint;
  v := public.fn_polite_propunere_rezerva(repeat('ab', 32), '00000000-0000-0000-0000-00000000000c');
  IF (v->>'rezervat')::boolean IS NOT FALSE OR v->>'stare' <> 'in_citire' THEN RAISE EXCEPTION 'TEST09 FAIL a doua rezervare: %', v; END IF;
  v := public.fn_polite_propunere_completeaza(v_id, '{"tip":"GBE","este_act_aditional":false,"asigurator":"ASIG","nr_polita":"H-1","suma":1000,"contract_nr":"30","contract_data":"2025-03-28"}'::jsonb,
                                              '[]'::jsonb, 'claude-sonnet-5-5', 0.01);
  IF v->>'stare' <> 'propus' OR (v->'contract_propus'->>'id')::integer <> 17 THEN RAISE EXCEPTION 'TEST09 FAIL completare / contract propus: %', v; END IF;
  BEGIN PERFORM public.fn_polite_propunere_completeaza(v_id, '{"cheie_straina":1}'::jsonb, '[]'::jsonb, NULL, NULL); RAISE EXCEPTION 'TEST09 FAIL cheie necunoscuta acceptata';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'TEST09 OK o singura rezervare pe document, completare cu contractul propus, chei necunoscute refuzate';
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true), set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v_id bigint; v jsonb; r record;
BEGIN
  SELECT id INTO v_id FROM public.polite_propuneri WHERE pdf_sha256 = repeat('ab', 32);
  IF v_id IS NULL THEN RAISE EXCEPTION 'TEST10 FAIL cine gestioneaza contracte nu vede propunerea'; END IF;
  -- cale directa: provenienta nu se poate pune
  BEGIN
    INSERT INTO public.contracte_polite (contract_id, tip, nr_polita, propunere_id, sursa) VALUES (17, 'GBE', 'DIRECT-1', v_id, 'citit');
    RAISE EXCEPTION 'TEST10 FAIL provenienta pusa direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO public.contracte_polite (contract_id, tip, nr_polita, sursa, pdf_sha256) VALUES (17, 'GBE', 'DIRECT-2', 'citit', repeat('cd', 32));
  SELECT sursa, pdf_sha256, propunere_id INTO r FROM public.contracte_polite WHERE nr_polita = 'DIRECT-2';
  IF r.sursa <> 'manual' OR r.pdf_sha256 IS NOT NULL OR r.propunere_id IS NOT NULL THEN RAISE EXCEPTION 'TEST10 FAIL calea manuala nu forteaza provenienta'; END IF;
  -- salvarea confirmata: polita cu provenienta din propunere
  v := public.fn_polita_salveaza(v_id, jsonb_build_object('tinta', 'polita', 'contract_id', 17, 'tip', 'GBE', 'asigurator', 'ASIG', 'nr_polita', 'H-1',
         'valoare', 1000, 'data_emitere', '2025-04-01', 'data_expirare', '2027-04-01', 'executie_de_la', '2025-04-01', 'executie_pana_la', '2026-12-17'), NULL);
  SELECT cp.sursa, cp.pdf_sha256, cp.pdf_path, cp.propunere_id INTO r FROM public.contracte_polite cp WHERE cp.id = (v->>'polita_id')::bigint;
  IF r.sursa <> 'citit' OR r.pdf_sha256 <> repeat('ab', 32) OR r.pdf_path <> 'polite/propuneri/' || repeat('ab', 32) || '.pdf' OR r.propunere_id <> v_id THEN
    RAISE EXCEPTION 'TEST10 FAIL provenienta din propunere: %', row_to_json(r);
  END IF;
  -- provenienta nu se poate schimba ulterior
  UPDATE public.contracte_polite SET sursa = 'manual', propunere_id = NULL WHERE id = (v->>'polita_id')::bigint;
  IF (SELECT sursa FROM public.contracte_polite WHERE id = (v->>'polita_id')::bigint) <> 'citit' THEN RAISE EXCEPTION 'TEST10 FAIL provenienta schimbata prin UPDATE'; END IF;
  BEGIN PERFORM public.fn_polita_salveaza(v_id, '{"tinta":"polita","contract_id":17,"tip":"GBE"}'::jsonb, NULL); RAISE EXCEPTION 'TEST10 FAIL propunere confirmata de doua ori';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'propunere_deja_decisa' THEN RAISE; END IF; END;
  BEGIN PERFORM public.fn_polita_salveaza(NULL, '{"tinta":"polita","contract_id":17,"tip":"CAR","asigurator":"A","nr_polita":"N","valoare":1}'::jsonb, '{"beneficiar":"B"}'::jsonb);
    RAISE EXCEPTION 'TEST10 FAIL Registru fara drept pe garantii';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.fn_polita_salveaza(NULL, '{"tinta":"polita","contract_id":17,"tip":"GBE","data_emitere":"2026-02-30"}'::jsonb, NULL); RAISE EXCEPTION 'TEST10 FAIL data imposibila';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.fn_polita_salveaza(NULL, '{"tinta":"polita","contract_id":17,"tip":"GBE","valoare":"1.000,50"}'::jsonb, NULL); RAISE EXCEPTION 'TEST10 FAIL suma ambigua';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'TEST10 OK provenienta doar prin salvarea confirmata, imuabila; dubla confirmare, Registru fara drept, data / suma invalide refuzate';
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true), set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  IF EXISTS (SELECT 1 FROM public.polite_propuneri) THEN RAISE EXCEPTION 'TEST11 FAIL contul fara drepturi vede propunerile'; END IF;
  BEGIN PERFORM public.fn_polita_salveaza(NULL, '{"tinta":"polita","contract_id":17,"tip":"GBE"}'::jsonb, NULL); RAISE EXCEPTION 'TEST11 FAIL salvare fara drept';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.polite_alerte_destinatari (departament, fel, email) VALUES ('financiar', 'adresa', 'x@gazpet.ro'); RAISE EXCEPTION 'TEST11 FAIL non-owner a scris lista';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF NOT EXISTS (SELECT 1 FROM public.v_polite_scadente) THEN RAISE EXCEPTION 'TEST11 FAIL vederea scadentelor goala pentru un cont logat'; END IF;
  RAISE NOTICE 'TEST11 OK fara drepturi: propuneri invizibile, salvare / lista refuzate; vederea scadentelor citibila';
END $t$;
RESET ROLE;

-- ── TEST12 (r5): Registrul legat de polita (financiar) — datele se CITESC prin legatura (v_garantii_registru), nu se copiaza ────
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; r record; v_pid bigint; v_gid bigint;
BEGIN
  v := public.fn_polita_salveaza(NULL, '{"tinta":"polita","contract_id":17,"tip":"GBE","asigurator":"ASIG GBE","nr_polita":"H35416-T","valoare":1000.5,"moneda":"RON","data_emitere":"2025-04-01","data_expirare":"2026-12-31"}'::jsonb,
                                 '{"beneficiar":"BENEFICIAR TEST","lucrare":"LUCRARE TEST"}'::jsonb);
  v_pid := (v->>'polita_id')::bigint; v_gid := (v->>'garantie_id')::bigint;
  SELECT contract_polita_id, pe_contract, emitent_ef, valoare_ef, tip_ef, data_expirare_ef INTO r FROM public.v_garantii_registru WHERE id = v_gid;
  IF r.contract_polita_id <> v_pid OR NOT r.pe_contract OR r.emitent_ef <> 'ASIG GBE' OR r.valoare_ef <> 1000.5 OR r.tip_ef <> 'buna_executie' OR r.data_expirare_ef <> '2026-12-31' THEN
    RAISE EXCEPTION 'TEST12 FAIL randul legat in v_garantii_registru: %', row_to_json(r);
  END IF;
  -- act aditional (prelungire + majorare) => Registrul il vede imediat, fara nicio scriere in garantii
  PERFORM public.fn_polita_salveaza(NULL, jsonb_build_object('tinta', 'act', 'polita_id', v_pid, 'nr_act', 1, 'valoare', 1500, 'data_expirare_noua', '2027-03-31'), NULL);
  SELECT valoare_ef, data_expirare_ef, zile_pana_expirare_ef, valoare, data_expirare INTO r FROM public.v_garantii_registru WHERE id = v_gid;
  IF r.data_expirare_ef <> '2027-03-31' OR r.valoare_ef <> 1500 OR r.zile_pana_expirare_ef <> ('2027-03-31'::date - CURRENT_DATE)
     OR r.valoare <> 1000.5 OR r.data_expirare <> '2026-12-31' THEN
    RAISE EXCEPTION 'TEST12 FAIL dupa act (efectiv din polita, propriu ramas istoric): %', row_to_json(r);
  END IF;
  -- coloanele proprii ale documentului nu se pot modifica pe un rand legat; restul (receptie) da
  BEGIN UPDATE public.garantii SET emitent = 'ALTUL' WHERE id = v_gid; RAISE EXCEPTION 'TEST12 FAIL emitentul unui rand legat s-a modificat';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM <> 'registru_legat_de_polita' THEN RAISE; END IF; END;
  UPDATE public.garantii SET lucrare_receptionata = true, data_receptie = '2026-11-01' WHERE id = v_gid;
  IF NOT (SELECT lucrare_receptionata FROM public.v_garantii_registru WHERE id = v_gid) THEN RAISE EXCEPTION 'TEST12 FAIL receptia pe rand legat'; END IF;
  -- scadentele: randul legat nu se dubleaza (vine o singura data, din contract)
  IF (SELECT count(*) FROM public.fn_polite_scadente(DATE '2026-11-10') s WHERE s.nr_polita = 'H35416-T') <> 1 THEN RAISE EXCEPTION 'TEST12 FAIL dublura in scadente'; END IF;
  BEGIN PERFORM public.fn_polita_salveaza(NULL, '{"tinta":"registru","tip":"GBE","asigurator":"A","nr_polita":"N"}'::jsonb, '{"beneficiar":"B"}'::jsonb);
    RAISE EXCEPTION 'TEST12 FAIL Registru fara valoare';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'TEST12 OK Registrul legat citit prin legatura (act vazut imediat), coloanele proprii raman istoric si nu se modifica, fara dublura';
END $t$;
RESET ROLE;

-- ── TEST13: lista (owner): doar @gazpet.ro, normalizata ──────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true), set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  BEGIN INSERT INTO public.polite_alerte_destinatari (departament, fel, email) VALUES ('financiar', 'adresa', 'cineva@exemplu.test'); RAISE EXCEPTION 'TEST13 FAIL adresa externa acceptata';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.polite_alerte_destinatari (departament, fel) VALUES ('financiar', 'sef_santier'); RAISE EXCEPTION 'TEST13 FAIL rol pe alt departament';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO public.polite_alerte_destinatari (departament, fel, email) VALUES ('ofertare', 'adresa', '  Nou.Om@Gazpet.RO ');
  IF NOT EXISTS (SELECT 1 FROM public.polite_alerte_destinatari WHERE email = 'nou.om@gazpet.ro' AND creat_de = '00000000-0000-0000-0000-00000000000a') THEN
    RAISE EXCEPTION 'TEST13 FAIL normalizarea / autorul';
  END IF;
  RAISE NOTICE 'TEST13 OK lista: adrese externe si roluri pe alt departament refuzate, adresa normalizata, autorul pus de server';
END $t$;
RESET ROLE;

-- ── TEST14 (r5): legarea / deslegarea unui rand existent (date proprii ca istoric); paritatea de_facut pe randurile nelegate ─────
DO $t$
DECLARE v_pid bigint; r record; n integer;
BEGIN
  INSERT INTO public.contracte_polite (contract_id, tip, asigurator, nr_polita, valoare_lei, data_expirare) VALUES (18, 'CAR', 'ASIG NOU', 'LEG-1', 3000, '2027-05-01') RETURNING id INTO v_pid;
  -- legarea = UPDATE cu FK; coloanele proprii raman neschimbate (istoric), vederea arata polita
  UPDATE public.garantii SET contract_polita_id = v_pid WHERE id = 801;
  SELECT emitent, numar_document, valoare, emitent_ef, numar_document_ef, valoare_ef, data_expirare_ef INTO r FROM public.v_garantii_registru WHERE id = 801;
  IF r.emitent <> 'ASIG VECHI' OR r.numar_document <> 'VECHE-801' OR r.valoare <> 900 OR r.emitent_ef <> 'ASIG NOU' OR r.numar_document_ef <> 'LEG-1'
     OR r.valoare_ef <> 3000 OR r.data_expirare_ef <> '2027-05-01' THEN
    RAISE EXCEPTION 'TEST14 FAIL legarea unui rand existent: %', row_to_json(r);
  END IF;
  -- legat => nu mai intra in scadente ca rand de Registru (doar polita, o data)
  IF EXISTS (SELECT 1 FROM public.fn_polite_scadente(DATE '2026-11-10') s WHERE s.cheie = 'registru:801') THEN RAISE EXCEPTION 'TEST14 FAIL randul legat inca in scadente'; END IF;
  -- deslegarea: coloanele proprii redevin editabile, vederea revine la ele
  UPDATE public.garantii SET contract_polita_id = NULL WHERE id = 801;
  UPDATE public.garantii SET emitent = 'ASIG VECHI 2' WHERE id = 801;
  IF (SELECT emitent_ef FROM public.v_garantii_registru WHERE id = 801) <> 'ASIG VECHI 2' THEN RAISE EXCEPTION 'TEST14 FAIL deslegarea'; END IF;
  -- paritatea expresiei recalculate cu v_garantii_situatie: pe randurile nelegate *_ef = coloanele vederii existente
  SELECT count(*) INTO n FROM public.v_garantii_registru WHERE NOT pe_contract
    AND (de_facut_ef IS DISTINCT FROM de_facut OR zile_pana_expirare_ef IS DISTINCT FROM zile_pana_expirare OR data_expirare_ef IS DISTINCT FROM data_expirare);
  IF n <> 0 THEN RAISE EXCEPTION 'TEST14 FAIL paritatea pe % randuri nelegate', n; END IF;
  -- stergerea unei polite legate e refuzata (FK RESTRICT), nu lasa Registrul fara sursa
  UPDATE public.garantii SET contract_polita_id = v_pid WHERE id = 801;
  BEGIN DELETE FROM public.contracte_polite WHERE id = v_pid; RAISE EXCEPTION 'TEST14 FAIL polita legata stearsa';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  RAISE NOTICE 'TEST14 OK legare / deslegare cu istoric, paritate de_facut, stergerea politei legate refuzata';
END $t$;

-- (revenirea, mutantii ei si legarea concurenta cu doua sesiuni reale ruleaza separat, in scripts/test_polite_alerte.sh)
SELECT 'DRY_COMPLET';
