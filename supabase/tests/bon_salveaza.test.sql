-- Teste SQL pentru 20261102b (fn_bon_salveaza). Rulează DOAR prin scripts/test_izometrie_e2a.sh (pas 4i), pe baza locală
-- *_test, după 20261102a (gărzile registrului trebuie să rămână valabile prin SECURITY INVOKER).
\set ON_ERROR_STOP on
SET client_min_messages = notice;
\set JANETA '00000000-0000-0000-0000-000000000030'
SELECT id AS id_reg FROM public.magazie_bucati WHERE serie = '254CA09771' \gset
SELECT id AS id_gzp FROM public.magazie_bucati WHERE serie = 'GZP1' \gset

SELECT teste.e('B0 funcția: INVOKER, search_path fix, anon fără EXECUTE, authenticated cu EXECUTE',
  (SELECT NOT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE proname = 'fn_bon_salveaza')
  AND NOT has_function_privilege('anon', 'public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)', 'EXECUTE'));

SELECT teste.ca(:'JANETA');
-- B1 bon nou: antet + linie într-o tranzacție
SELECT r->>'bon_id' AS b1, r->>'updated_at' AS v1, r->>'idempotent' AS i1 FROM (SELECT public.fn_bon_salveaza(NULL, NULL,
  '{"proiect_id":1,"numar_bon":"BC-T-1","provenienta":"gazpet","data_bon":"2026-10-21"}', '[{"denumire":"cot 90","cantitate":2}]') r) x \gset
SELECT teste.e('B1 bon nou: o linie, neidempotent', :'i1' = 'false' AND (SELECT count(*) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b1) = 1);
-- B2 retry după răspuns pierdut la creare (același număr, același conținut) → același bon, fără dubluri
SELECT teste.e('B2 retry creare → idempotent, un singur bon, o linie',
  (SELECT (public.fn_bon_salveaza(NULL, NULL, '{"proiect_id":1,"numar_bon":"BC-T-1","provenienta":"gazpet","data_bon":"2026-10-21"}',
     '[{"denumire":"cot 90","cantitate":2}]')->>'idempotent')::boolean)
  AND (SELECT count(*) FROM public.executie_bonuri_consum WHERE numar_bon = 'BC-T-1') = 1
  AND (SELECT count(*) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b1) = 1);
SELECT teste.eroare('B3 același număr, alt conținut → refuz', $$SELECT public.fn_bon_salveaza(NULL, NULL,
  '{"proiect_id":1,"numar_bon":"BC-T-1","provenienta":"gazpet","data_bon":"2026-10-21"}', '[{"denumire":"altceva","cantitate":1}]')$$, 'există deja');
-- B4 editare cu versiunea corectă: liniile înlocuite, versiunea nouă
SELECT r->>'updated_at' AS v4 FROM (SELECT public.fn_bon_salveaza(:b1, :'v1',
  '{"provenienta":"gazpet","data_bon":"2026-10-21","observatii":"editat"}', '[{"denumire":"cot 45","cantitate":1},{"denumire":"teu","cantitate":3}]') r) x \gset
SELECT teste.e('B4 editare: 2 linii noi, cele vechi șterse, versiune nouă', :'v4' <> :'v1'
  AND (SELECT count(*) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b1) = 2
  AND (SELECT count(*) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b1 AND denumire = 'cot 90') = 0);
-- B5 versiune veche + alt conținut → „modificat între timp”, nimic schimbat
SELECT teste.eroare('B5 versiune veche, alt conținut → refuz', format($f$SELECT public.fn_bon_salveaza(%s, %L,
  '{"provenienta":"gazpet","data_bon":"2026-10-21"}', '[{"denumire":"x","cantitate":1}]')$f$, :b1, :'v1'), 'modificat între timp');
-- B6 retry după răspuns pierdut la editare (versiunea veche, ACELAȘI conținut ca B4) → idempotent, fără dubluri
SELECT teste.e('B6 retry editare → idempotent, tot 2 linii', (public.fn_bon_salveaza(:b1, :'v1',
  '{"provenienta":"gazpet","data_bon":"2026-10-21","observatii":"editat"}', '[{"denumire":"teu","cantitate":3},{"denumire":"cot 45","cantitate":1}]')->>'idempotent')::boolean
  AND (SELECT count(*) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b1) = 2);
SELECT teste.eroare('B7 linii goale → refuz (bonul nu se golește)', format($f$SELECT public.fn_bon_salveaza(%s, %L, '{"provenienta":"gazpet","data_bon":"2026-10-21"}', '[]')$f$, :b1, :'v4'), 'cel puțin o linie');
SELECT teste.eroare('B8 cantitate 0 → refuz', format($f$SELECT public.fn_bon_salveaza(%s, %L, '{"provenienta":"gazpet","data_bon":"2026-10-21"}', '[{"denumire":"x","cantitate":0}]')$f$, :b1, :'v4'), 'cantitate > 0');
SELECT teste.e('B7/B8 după refuzuri: bonul are tot cele 2 linii', (SELECT count(*) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b1) = 2);
-- B9 regresie gazpet: bucată gazpet pe bon
SELECT r->>'updated_at' AS v9 FROM (SELECT public.fn_bon_salveaza(:b1, :'v4', '{"provenienta":"gazpet","data_bon":"2026-10-21","observatii":"editat"}',
  format('[{"denumire":"teava gazpet","cantitate":1,"magazie_bucata_id":%s}]', :id_gzp)::jsonb) r) x \gset
SELECT teste.e('B9 bucată gazpet pe bon → merge', (SELECT count(*) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b1 AND magazie_bucata_id = :id_gzp) = 1);
-- B10 bucată din registrul de țeavă → refuz de garda E2a, ATOMIC (antetul și liniile rămân cum erau)
SELECT teste.eroare('B10 bucată din registru → refuz (garda E2a, prin INVOKER)', format($f$SELECT public.fn_bon_salveaza(%s, %L,
  '{"provenienta":"beneficiar","data_bon":"2026-10-21","observatii":"alt"}', '[{"denumire":"teava","cantitate":1,"magazie_bucata_id":%s}]')$f$, :b1, :'v9', :id_reg), 'nu intră pe bon');
SELECT teste.e('B10b după refuz: antetul și liniile neschimbate (atomic)', (SELECT provenienta = 'gazpet' AND observatii = 'editat' FROM public.executie_bonuri_consum WHERE id = :b1)
  AND (SELECT count(*) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b1 AND magazie_bucata_id = :id_gzp) = 1);
RESET ROLE;
SET ROLE anon;
SELECT teste.eroare('B11 anon → fără EXECUTE', $$SELECT public.fn_bon_salveaza(NULL, NULL, '{}', '[]')$$, 'permission denied');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SET ROLE authenticated;
SELECT teste.eroare('B12 fără utilizator autentificat → refuz', $$SELECT public.fn_bon_salveaza(NULL, NULL, '{"proiect_id":1,"numar_bon":"Z","provenienta":"gazpet","data_bon":"2026-10-21"}', '[{"denumire":"x","cantitate":1}]')$$, 'neautentificat');
RESET ROLE;
SELECT 'TESTE BON: TOATE OK';
