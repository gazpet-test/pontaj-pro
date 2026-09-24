-- Teste locale pentru 20260924_p0c_cerinte_dovezi.sql — rulează pe schema-stub, NU pe producție. Fiecare bloc afișează PASS/FAIL.
\set ON_ERROR_STOP off
\pset format unaligned
\pset tuples_only on
CREATE OR REPLACE FUNCTION pg_temp.ca(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, false);
$$;
CREATE OR REPLACE FUNCTION pg_temp.asteapta_eroare(p_sql text, p_frag text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql; RETURN 'FAIL (nu a dat eroare): ' || p_frag;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM ILIKE '%' || p_frag || '%' THEN RETURN 'PASS: refuz „' || p_frag || '"'; ELSE RETURN 'FAIL (altă eroare: ' || SQLERRM || ') aşteptam: ' || p_frag; END IF;
END $$;

-- T1 actor neautentificat → refuz
SELECT pg_temp.ca(NULL);
SET ROLE authenticated;
SELECT pg_temp.asteapta_eroare($q$SELECT public.fn_ofertare_cerinte_dovada_adauga(1, 'Finanțarea Contractului se asigură din bugetul de stat', 'susține partea de finanțare', 9001, '{"pagina":13}')$q$, 'fără sesiune');
-- T2 actor fără acces Ofertare → refuz
SELECT pg_temp.ca('33333333-3333-3333-3333-333333333333');
SELECT pg_temp.asteapta_eroare($q$SELECT public.fn_ofertare_cerinte_dovada_adauga(1, 'Finanțarea Contractului se asigură din bugetul de stat', 'susține partea de finanțare', 9001, '{"pagina":13}')$q$, 'fără acces');
-- T3 document din altă licitație → refuz
SELECT pg_temp.ca('22222222-2222-2222-2222-222222222222');
SELECT pg_temp.asteapta_eroare($q$SELECT public.fn_ofertare_cerinte_dovada_adauga(1, 'Finanțarea Contractului se asigură din bugetul de stat', 'susține partea de finanțare', 9002, '{"pagina":13}')$q$, 'altă licitație');
-- T4 excerpt original păstrat + fragment suplimentar înregistrat → proveniență completabilă fără rescriere
SELECT CASE WHEN (public.fn_ofertare_cerinte_dovada_adauga(1, 'Finanțarea Contractului se asigură din bugetul de stat, prin Programul Național de Investiții „Anghel Saligny", și din bugetele locale', 'susține componenta de finanțare pe care excerptul din pack nu o acoperea', 9001, '{"pagina":13,"sectiune":"III.1.7"}', repeat('a',64)))->>'id' = '1' THEN 'PASS: dovada 1 adăugată' ELSE 'FAIL T4' END;
SELECT CASE WHEN sursa_pasaj = 'Nu se acordă avans. Plățile se efectuează pentru lucrările executate' AND pasaj_verificat AND confirmata_de IS NULL THEN 'PASS: excerptul, pasaj_verificat și E2 (confirmata_de NULL) neschimbate' ELSE 'FAIL T4b' END FROM public.ofertare_cerinte WHERE id = 1;
SELECT CASE WHEN pentru_textul_curent AND NOT inlocuita AND activa AND document_nume = 'Fisa_de_date_TEST.pdf' AND verificat_de_nume = 'Editor Ofertare' THEN 'PASS: view — pentru textul curent, neînlocuită, activă, document + verificator vizibile' ELSE 'FAIL T4c' END FROM public.v_ofertare_cerinte_dovezi WHERE id = 1;
-- T5 append-only: UPDATE / DELETE refuzate (chiar și ca postgres)
RESET ROLE;
SELECT pg_temp.asteapta_eroare($q$UPDATE public.ofertare_cerinte_dovezi SET explicatie = 'x' WHERE id = 1$q$, 'append-only');
SELECT pg_temp.asteapta_eroare($q$DELETE FROM public.ofertare_cerinte_dovezi WHERE id = 1$q$, 'append-only');
-- T6 INSERT direct ca authenticated (ocolind RPC-ul) → refuz RLS
SET ROLE authenticated;
SELECT pg_temp.asteapta_eroare($q$INSERT INTO public.ofertare_cerinte_dovezi (cerinta_id, text_md5, pasaj, explicatie, verificat_de) VALUES (1, md5('x'), 'pasaj direct fara rpc', 'ocolire', '22222222-2222-2222-2222-222222222222')$q$, 'permission denied');
-- T7 corecție: rând nou care înlocuiește rândul 1; rândul 1 apare „înlocuit"
SELECT CASE WHEN (public.fn_ofertare_cerinte_dovada_adauga(1, 'Finanțarea Contractului se asigură din bugetul de stat, prin Programul Național de Investiții „Anghel Saligny", și din bugetele locale, în limita creditelor bugetare aprobate', 'pasaj completat până la capătul frazei', 9001, '{"pagina":13,"sectiune":"III.1.7"}', NULL, 1))->>'id' = '2' THEN 'PASS: corecția 2 adăugată' ELSE 'FAIL T7' END;
SELECT CASE WHEN (SELECT inlocuita AND pentru_textul_curent AND NOT activa FROM public.v_ofertare_cerinte_dovezi WHERE id = 1) AND (SELECT NOT inlocuita AND activa FROM public.v_ofertare_cerinte_dovezi WHERE id = 2) THEN 'PASS: 1 înlocuită (md5 încă bun, dar NU activă), 2 activă' ELSE 'FAIL T7b' END;
-- T8 corecție pe rândul altei cerințe → refuz
RESET ROLE;
INSERT INTO public.ofertare_cerinte (licitatie_id, sursa_document_id, text_cerinta) VALUES (900, 9001, 'Altă cerință de test');
SET ROLE authenticated;
SELECT pg_temp.asteapta_eroare($q$SELECT public.fn_ofertare_cerinte_dovada_adauga(2, 'un pasaj oarecare de test', 'explicatie', NULL, '{}', NULL, 1)$q$, 'altei cerințe');
-- T9 textul cerinței se modifică ulterior → dovezile NU mai sunt „pentru textul curent" (rămân în istoric)
RESET ROLE;
UPDATE public.ofertare_cerinte SET text_cerinta = text_cerinta || ' (text corectat ulterior)', text_editat_la = now() WHERE id = 1;
SET ROLE authenticated;
SELECT CASE WHEN count(*) = 2 AND bool_and(NOT pentru_textul_curent) THEN 'PASS: după editarea textului, ambele dovezi rămân, dar nu mai sunt pentru textul curent' ELSE 'FAIL T9' END FROM public.v_ofertare_cerinte_dovezi WHERE cerinta_id = 1;
-- T10 dovadă nouă după corecția textului → e pentru textul curent
SELECT CASE WHEN (public.fn_ofertare_cerinte_dovada_adauga(1, 'un pasaj reverificat pe textul corectat', 'reverificare după editare', 9001, '{"pagina":13}'))->>'id' = '3' THEN 'PASS: dovada 3 pe textul nou' ELSE 'FAIL T10' END;
SELECT CASE WHEN pentru_textul_curent THEN 'PASS: dovada 3 e pentru textul curent' ELSE 'FAIL T10b' END FROM public.v_ofertare_cerinte_dovezi WHERE id = 3;
-- T11 cititor fără acces Ofertare nu vede dovezile (RLS pe tabel + security_invoker pe view)
SELECT pg_temp.ca('33333333-3333-3333-3333-333333333333');
SELECT CASE WHEN count(*) = 0 THEN 'PASS: fără acces Ofertare → 0 rânduri în view' ELSE 'FAIL T11' END FROM public.v_ofertare_cerinte_dovezi;
-- T12 pasaj prea scurt / sha invalid → refuz CHECK
SELECT pg_temp.ca('11111111-1111-1111-1111-111111111111');
SELECT pg_temp.asteapta_eroare($q$SELECT public.fn_ofertare_cerinte_dovada_adauga(1, 'scurt', 'explicatie ok', NULL, '{"pagina":1}')$q$, 'pasaj_chk');
SELECT pg_temp.asteapta_eroare($q$SELECT public.fn_ofertare_cerinte_dovada_adauga(1, 'un pasaj suficient de lung', 'explicatie ok', NULL, '{"pagina":1}', 'nu-e-sha')$q$, 'sha_chk');
-- T13 locator: exact una dintre pagina/interval/verificat; pagina > 0; interval [a,b] cu 0 < a <= b
SELECT pg_temp.asteapta_eroare($q$SELECT public.fn_ofertare_cerinte_dovada_adauga(1, 'un pasaj suficient de lung', 'explicatie ok', NULL, '{}')$q$, 'exact una');
SELECT pg_temp.asteapta_eroare($q$SELECT public.fn_ofertare_cerinte_dovada_adauga(1, 'un pasaj suficient de lung', 'explicatie ok', NULL, '{"pagina":13,"interval":[3,5]}')$q$, 'exact una');
SELECT pg_temp.asteapta_eroare($q$SELECT public.fn_ofertare_cerinte_dovada_adauga(1, 'un pasaj suficient de lung', 'explicatie ok', NULL, '{"pagina":0}')$q$, 'locator_chk');
SELECT pg_temp.asteapta_eroare($q$SELECT public.fn_ofertare_cerinte_dovada_adauga(1, 'un pasaj suficient de lung', 'explicatie ok', NULL, '{"interval":[5,3]}')$q$, 'locator_chk');
SELECT pg_temp.asteapta_eroare($q$SELECT public.fn_ofertare_cerinte_dovada_adauga(1, 'un pasaj suficient de lung', 'explicatie ok', NULL, '{"verificat":"pagina"}')$q$, 'locator_chk');
SELECT CASE WHEN (public.fn_ofertare_cerinte_dovada_adauga(1, 'un pasaj pe interval de pagini', 'explicatie ok', 9001, '{"interval":[3,5],"sectiune":"II.2"}'))->>'id' IS NOT NULL THEN 'PASS: interval valid acceptat' ELSE 'FAIL T13' END;
-- T14 textul văzut de verificator ≠ textul curent → refuz (editare între afișare și salvare)
SELECT pg_temp.asteapta_eroare($q$SELECT public.fn_ofertare_cerinte_dovada_adauga(1, 'un pasaj suficient de lung', 'explicatie ok', NULL, '{"pagina":2}', NULL, NULL, 'text vechi, vazut inainte de editare')$q$, 's-a schimbat între afișare și salvare');
SELECT CASE WHEN (public.fn_ofertare_cerinte_dovada_adauga(1, 'un pasaj suficient de lung', 'explicatie ok', NULL, '{"pagina":2}', NULL, NULL, (SELECT text_cerinta FROM public.ofertare_cerinte WHERE id = 1)))->>'id' IS NOT NULL THEN 'PASS: textul văzut = textul curent → acceptat' ELSE 'FAIL T14' END;
RESET ROLE;
SELECT 'TOTAL rânduri dovezi: ' || count(*) FROM public.ofertare_cerinte_dovezi;
