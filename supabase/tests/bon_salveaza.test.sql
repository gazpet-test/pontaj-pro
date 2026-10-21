-- Teste SQL pentru 20261102b (fn_bon_salveaza). Rulează DOAR prin scripts/test_izometrie_e2a.sh (pas 4i), pe baza locală
-- *_test, după 20261102a (gărzile registrului trebuie să rămână valabile prin SECURITY INVOKER).
\set ON_ERROR_STOP on
SET client_min_messages = notice;
\set JANETA '00000000-0000-0000-0000-000000000030'
\set OP1 'aaaaaaaa-0000-0000-0000-000000000001'
\set OP2 'aaaaaaaa-0000-0000-0000-000000000002'
\set OP3 'aaaaaaaa-0000-0000-0000-000000000003'
SELECT id AS id_reg FROM public.magazie_bucati WHERE serie = '254CA09771' \gset
SELECT id AS id_gzp FROM public.magazie_bucati WHERE serie = 'GZP1' \gset

SELECT teste.e('B0 funcția: INVOKER, search_path fix, anon fără EXECUTE, authenticated cu EXECUTE; cheia de operație UNIQUE',
  (SELECT NOT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE proname = 'fn_bon_salveaza')
  AND NOT has_function_privilege('anon', 'public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)', 'EXECUTE')
  AND (SELECT indisunique FROM pg_index WHERE indexrelid = 'public.ux_bonc_cheie_operatie'::regclass));

SELECT teste.ca(:'JANETA');
-- B1 bon nou: numărul alocat pe server, antet + linie într-o tranzacție
SELECT r->>'bon_id' AS b1, r->>'updated_at' AS v1, r->>'idempotent' AS i1, r->>'numar_bon' AS n1 FROM (SELECT public.fn_bon_salveaza(NULL, NULL,
  format('{"proiect_id":1,"cheie_operatie":"%s","provenienta":"gazpet","data_bon":"2026-10-21"}', :'OP1')::jsonb, '[{"denumire":"cot 90","cantitate":2}]') r) x \gset
SELECT teste.e('B1 bon nou: o linie, neidempotent, numărul alocat BC-2026-1-0001', :'i1' = 'false' AND :'n1' = 'BC-2026-1-0001'
  AND (SELECT count(*) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b1) = 1);
-- B2 retry al ACELEIAȘI operații (răspuns pierdut) → același bon, fără dubluri
SELECT teste.e('B2 retry creare (aceeași cheie, același conținut) → idempotent, un singur bon',
  (SELECT (r->>'idempotent')::boolean AND (r->>'bon_id')::bigint = :b1 FROM (SELECT public.fn_bon_salveaza(NULL, NULL,
     format('{"proiect_id":1,"cheie_operatie":"%s","provenienta":"gazpet","data_bon":"2026-10-21"}', :'OP1')::jsonb, '[{"denumire":"cot 90","cantitate":2}]') r) x)
  AND (SELECT count(*) FROM public.executie_bonuri_consum WHERE cheie_operatie = :'OP1') = 1);
SELECT teste.eroare('B3 aceeași cheie de operație, alt conținut → refuz', format($f$SELECT public.fn_bon_salveaza(NULL, NULL,
  '{"proiect_id":1,"cheie_operatie":"%s","provenienta":"gazpet","data_bon":"2026-10-21"}', '[{"denumire":"altceva","cantitate":1}]')$f$, :'OP1'), 'alt conținut');
-- B3b două creări DISTINCTE cu același conținut (două ferestre) → două bonuri, numere diferite (Jakarinos r6 N1)
SELECT r->>'numar_bon' AS n2, r->>'idempotent' AS i2 FROM (SELECT public.fn_bon_salveaza(NULL, NULL,
  format('{"proiect_id":1,"cheie_operatie":"%s","provenienta":"gazpet","data_bon":"2026-10-21"}', :'OP2')::jsonb, '[{"denumire":"cot 90","cantitate":2}]') r) x \gset
SELECT teste.e('B3b două creări identice dar distincte → două bonuri (BC-2026-1-0002), nu un „retry”', :'i2' = 'false' AND :'n2' = 'BC-2026-1-0002'
  AND (SELECT count(*) FROM public.executie_bonuri_consum WHERE proiect_id = 1 AND numar_bon LIKE 'BC-2026-1-%') = 2);
-- B4 editare cu versiunea corectă: liniile înlocuite, versiunea nouă, numărul neschimbat
SELECT r->>'updated_at' AS v4, r->>'numar_bon' AS n4 FROM (SELECT public.fn_bon_salveaza(:b1, :'v1',
  '{"provenienta":"gazpet","data_bon":"2026-10-21","observatii":"editat"}', '[{"denumire":"cot 45","cantitate":1},{"denumire":"teu","cantitate":3}]') r) x \gset
SELECT teste.e('B4 editare: 2 linii noi, cele vechi șterse, versiune nouă, același număr', :'v4' <> :'v1' AND :'n4' = :'n1'
  AND (SELECT count(*) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b1) = 2
  AND (SELECT count(*) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b1 AND denumire = 'cot 90') = 0);
SELECT teste.eroare('B5 versiune veche, alt conținut → refuz', format($f$SELECT public.fn_bon_salveaza(%s, %L,
  '{"provenienta":"gazpet","data_bon":"2026-10-21"}', '[{"denumire":"x","cantitate":1}]')$f$, :b1, :'v1'), 'modificat între timp');
SELECT teste.e('B6 retry editare (versiunea veche, ACELAȘI conținut ca B4) → idempotent, tot 2 linii', (public.fn_bon_salveaza(:b1, :'v1',
  '{"provenienta":"gazpet","data_bon":"2026-10-21","observatii":"editat"}', '[{"denumire":"teu","cantitate":3},{"denumire":"cot 45","cantitate":1}]')->>'idempotent')::boolean
  AND (SELECT count(*) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b1) = 2);
SELECT teste.eroare('B7 linii goale → refuz (bonul nu se golește)', format($f$SELECT public.fn_bon_salveaza(%s, %L, '{"provenienta":"gazpet","data_bon":"2026-10-21"}', '[]')$f$, :b1, :'v4'), 'cel puțin o linie');
SELECT teste.eroare('B8 cantitate 0 → refuz', format($f$SELECT public.fn_bon_salveaza(%s, %L, '{"provenienta":"gazpet","data_bon":"2026-10-21"}', '[{"denumire":"x","cantitate":0}]')$f$, :b1, :'v4'), 'cantitate > 0');
SELECT teste.eroare('B8b bon nou fără cheie de operație → refuz', $$SELECT public.fn_bon_salveaza(NULL, NULL, '{"proiect_id":1,"provenienta":"gazpet"}', '[{"denumire":"x","cantitate":1}]')$$, 'cheie_operatie');
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
SELECT teste.eroare('B10c bon NOU cu bucată din registru → refuz, fără antet orfan', format($f$SELECT public.fn_bon_salveaza(NULL, NULL,
  '{"proiect_id":3,"cheie_operatie":"%s","provenienta":"beneficiar","data_bon":"2026-10-21"}', '[{"denumire":"teava","cantitate":1,"magazie_bucata_id":%s}]')$f$, :'OP3', :id_reg), 'nu intră pe bon');
SELECT teste.e('B10d nicio urmă a creării refuzate', (SELECT count(*) FROM public.executie_bonuri_consum WHERE cheie_operatie = :'OP3') = 0);
RESET ROLE;
-- B14 numerotarea trece de 9999 fără trunchiere (Jakarinos r7)
INSERT INTO public.executie_bonuri_consum (numar_bon, proiect_id) VALUES ('BC-2026-2-9999', 2);
SELECT teste.ca(:'JANETA');
SELECT r->>'numar_bon' AS n14 FROM (SELECT public.fn_bon_salveaza(NULL, NULL,
  '{"proiect_id":2,"cheie_operatie":"aaaaaaaa-0000-0000-0000-000000000014","provenienta":"gazpet","data_bon":"2026-10-21"}', '[{"denumire":"x","cantitate":1}]') r) x \gset
SELECT teste.e('B14 după BC-2026-2-9999 vine BC-2026-2-10000', :'n14' = 'BC-2026-2-10000');
RESET ROLE;
SELECT teste.eroare('B13 număr de bon duplicat pe proiect, din afara RPC-ului → refuz de index (UNIQUE în BD)',
  $$INSERT INTO public.executie_bonuri_consum (numar_bon, proiect_id) VALUES ('BC-2026-1-0001', 1)$$, 'ux_bonc_proiect_numar');
SET ROLE anon;
SELECT teste.eroare('B11 anon → fără EXECUTE', $$SELECT public.fn_bon_salveaza(NULL, NULL, '{}', '[]')$$, 'permission denied');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SET ROLE authenticated;
SELECT teste.eroare('B12 fără utilizator autentificat → refuz', $$SELECT public.fn_bon_salveaza(NULL, NULL, '{"proiect_id":1,"cheie_operatie":"aaaaaaaa-0000-0000-0000-000000000009","provenienta":"gazpet"}', '[{"denumire":"x","cantitate":1}]')$$, 'neautentificat');
RESET ROLE;
SELECT 'TESTE BON: TOATE OK';
