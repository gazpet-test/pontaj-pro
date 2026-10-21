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

SELECT teste.e('B0 RPC-urile: DEFINER (owner postgres), search_path fix, anon fără EXECUTE, authenticated cu EXECUTE; cheia UNIQUE; liniile doar citire din API',
  (SELECT bool_and(prosecdef AND proowner = 'postgres'::regrole AND proconfig @> ARRAY['search_path=public, pg_temp']) FROM pg_proc WHERE proname IN ('fn_bon_salveaza', 'fn_bon_preia'))
  AND NOT has_function_privilege('anon', 'public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.fn_bon_preia(bigint, timestamptz, jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.fn_bon_preia(bigint, timestamptz, jsonb)', 'EXECUTE')
  AND (SELECT indisunique FROM pg_index WHERE indexrelid = 'public.ux_bonc_cheie_operatie'::regclass)
  AND NOT has_table_privilege('authenticated', 'public.executie_bonuri_consum_linii', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.executie_bonuri_consum_linii', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.executie_bonuri_consum_linii', 'DELETE')
  AND has_table_privilege('authenticated', 'public.executie_bonuri_consum_linii', 'SELECT'));

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
SELECT teste.eroare('B10 bucată din registru → refuz (garda E2a: trigger necondiționat, și sub RPC-ul DEFINER)', format($f$SELECT public.fn_bon_salveaza(%s, %L,
  '{"provenienta":"beneficiar","data_bon":"2026-10-21","observatii":"alt"}', '[{"denumire":"teava","cantitate":1,"magazie_bucata_id":%s}]')$f$, :b1, :'v9', :id_reg), 'nu intră pe bon');
SELECT teste.e('B10b după refuz: antetul și liniile neschimbate (atomic)', (SELECT provenienta = 'gazpet' AND observatii = 'editat' FROM public.executie_bonuri_consum WHERE id = :b1)
  AND (SELECT count(*) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b1 AND magazie_bucata_id = :id_gzp) = 1);
SELECT teste.eroare('B10c bon NOU cu bucată din registru → refuz, fără antet orfan', format($f$SELECT public.fn_bon_salveaza(NULL, NULL,
  '{"proiect_id":3,"cheie_operatie":"%s","provenienta":"beneficiar","data_bon":"2026-10-21"}', '[{"denumire":"teava","cantitate":1,"magazie_bucata_id":%s}]')$f$, :'OP3', :id_reg), 'nu intră pe bon');
SELECT teste.e('B10d nicio urmă a creării refuzate', (SELECT count(*) FROM public.executie_bonuri_consum WHERE cheie_operatie = :'OP3') = 0);
-- B15 scrierile DIRECTE pe linii sunt închise pentru API (r11: REVOKE; doar prin RPC-uri) — INSERT / UPDATE / DELETE refuzate
SELECT teste.eroare('B15 INSERT direct pe linii din API → refuz', format($f$INSERT INTO public.executie_bonuri_consum_linii (bon_id, denumire, cantitate) VALUES (%s, 'direct', 1)$f$, :b1), 'permission denied');
SELECT teste.eroare('B15b UPDATE direct pe linii din API → refuz', format($f$UPDATE public.executie_bonuri_consum_linii SET cantitate = 9 WHERE bon_id = %s$f$, :b1), 'permission denied');
SELECT teste.eroare('B15c DELETE direct pe linii din API → refuz', format($f$DELETE FROM public.executie_bonuri_consum_linii WHERE bon_id = %s$f$, :b1), 'permission denied');
SELECT updated_at AS v15e0 FROM public.executie_bonuri_consum WHERE id = :b1 \gset
SELECT r->>'updated_at' AS v15e FROM (SELECT public.fn_bon_salveaza(:b1, :'v15e0', '{"provenienta":"gazpet","data_bon":"2026-10-21","observatii":"editat"}',
  format('[{"denumire":"teava gazpet","cantitate":1,"magazie_bucata_id":%s},{"denumire":"cot","cantitate":2}]', :id_gzp)::jsonb) r) x \gset
SELECT teste.e('B15e versiunea întoarsă de RPC = cea din BD; liniile scrise de RPC (DEFINER) există',
  :'v15e'::timestamptz = (SELECT updated_at FROM public.executie_bonuri_consum WHERE id = :b1)
  AND (SELECT count(*) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b1) = 2);
-- B16 la editare data rămâne în anul din număr (Copilot r7 P2)
SELECT teste.eroare('B16 editare cu data în alt an decât numărul → refuz', format($f$SELECT public.fn_bon_salveaza(%s, %L,
  '{"provenienta":"gazpet","data_bon":"2027-01-05","observatii":"editat"}', '[{"denumire":"y","cantitate":1}]')$f$, :b1, :'v15e'), 'iese din anul');
-- B17 liniile se scriu în ordinea trimisă (sortarea e doar pentru comparația de idempotență)
SELECT r->>'bon_id' AS b17 FROM (SELECT public.fn_bon_salveaza(NULL, NULL,
  '{"proiect_id":1,"cheie_operatie":"aaaaaaaa-0000-0000-0000-000000000004","provenienta":"gazpet","data_bon":"2026-10-21"}',
  '[{"denumire":"zeta","cantitate":1},{"denumire":"alfa","cantitate":1},{"denumire":"mu","cantitate":1}]') r) x \gset
SELECT teste.e('B17 ordinea liniilor = ordinea trimisă (zeta, alfa, mu)',
  (SELECT string_agg(denumire, ',' ORDER BY id) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b17) = 'zeta,alfa,mu');
-- B18 preluarea financiară prin RPC (r11): costurile pe linii + starea, într-o tranzacție, cu CAS (pe un bon separat:
--     bonul OP1 rămâne „generat” pentru cursele din harness)
SELECT r->>'bon_id' AS b18, r->>'updated_at' AS v18v FROM (SELECT public.fn_bon_salveaza(NULL, NULL,
  '{"proiect_id":1,"cheie_operatie":"aaaaaaaa-0000-0000-0000-000000000005","provenienta":"gazpet","data_bon":"2026-10-21"}',
  '[{"denumire":"p1","cantitate":1},{"denumire":"p2","cantitate":3}]') r) x \gset
SELECT (SELECT jsonb_agg(jsonb_build_object('linie_id', id, 'cost_unitar', 10) ORDER BY id) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b18) AS costuri,
       (SELECT jsonb_agg(jsonb_build_object('linie_id', id, 'cost_unitar', 10) ORDER BY id) FROM (SELECT id FROM public.executie_bonuri_consum_linii WHERE bon_id = :b18 ORDER BY id LIMIT 1) z) AS costuri1 \gset
SELECT teste.eroare('B18a gazpet cu o linie fără cost → refuz', format($f$SELECT public.fn_bon_preia(%s, %L, %L)$f$, :b18, :'v18v', :'costuri1'), 'fiecare dintre cele 2 linii');
SELECT teste.eroare('B18b versiune greșită → refuz', format($f$SELECT public.fn_bon_preia(%s, %L, %L)$f$, :b18, '2020-01-01 00:00:00+00', :'costuri'), 'modificat între timp');
SELECT r->>'updated_at' AS v18 FROM (SELECT public.fn_bon_preia(:b18, :'v18v', :'costuri'::jsonb) r) x \gset
SELECT teste.e('B18 preluat: stare, cine, valoare = cost × cantitate pe fiecare linie',
  (SELECT stare = 'preluat' AND preluat_de = :'JANETA'::uuid AND preluat_la IS NOT NULL AND updated_at = :'v18'::timestamptz FROM public.executie_bonuri_consum WHERE id = :b18)
  AND (SELECT bool_and(cost_unitar = 10 AND valoare = 10 * cantitate) FROM public.executie_bonuri_consum_linii WHERE bon_id = :b18));
SELECT teste.e('B18c retry al preluării (răspuns pierdut, aceleași costuri) → idempotent',
  (public.fn_bon_preia(:b18, :'v18v', :'costuri'::jsonb)->>'idempotent')::boolean);
SELECT teste.eroare('B18d editarea unui bon preluat → refuz', format($f$SELECT public.fn_bon_salveaza(%s, %L,
  '{"provenienta":"gazpet","data_bon":"2026-10-21","observatii":"editat"}', '[{"denumire":"y","cantitate":1}]')$f$, :b18, :'v18'), 'se editează doar');
UPDATE public.executie_bonuri_consum SET provenienta = 'beneficiar' WHERE id = :b17;
SELECT updated_at AS v18e FROM public.executie_bonuri_consum WHERE id = :b17 \gset
SELECT teste.eroare('B18e bon beneficiar cu costuri → refuz (nu se valorizează)', format($f$SELECT public.fn_bon_preia(%s, %L,
  (SELECT jsonb_agg(jsonb_build_object('linie_id', id, 'cost_unitar', 1)) FROM public.executie_bonuri_consum_linii WHERE bon_id = %s))$f$, :b17, :'v18e', :b17), 'nu se valorizează');
SELECT public.fn_bon_preia(:b17, :'v18e', '[]')->>'idempotent' AS i18f \gset
SELECT teste.e('B18f bon beneficiar fără costuri → preluat', :'i18f' = 'false' AND (SELECT stare FROM public.executie_bonuri_consum WHERE id = :b17) = 'preluat');
-- B20 client vechi după REVOKE (Jakarinos + Copilot r11 P1): costurile pe linii refuzate (permission denied), iar trecerea
--     directă a antetului în „preluat” e refuzată de garda trg_bonc_preluare_garda → bonul rămâne „generat”, fără succes fals
SELECT r->>'bon_id' AS b20 FROM (SELECT public.fn_bon_salveaza(NULL, NULL,
  '{"proiect_id":1,"cheie_operatie":"aaaaaaaa-0000-0000-0000-000000000006","provenienta":"gazpet","data_bon":"2026-10-21"}',
  '[{"denumire":"q","cantitate":1}]') r) x \gset
SELECT teste.eroare('B20a client vechi: costul direct pe linie → refuz', format($f$UPDATE public.executie_bonuri_consum_linii SET cost_unitar = 1, valoare = 1 WHERE bon_id = %s$f$, :b20), 'permission denied');
SELECT teste.eroare('B20b client vechi: antetul direct în „preluat” → refuz de gardă', format($f$UPDATE public.executie_bonuri_consum SET stare = 'preluat', preluat_de = %L, preluat_la = now(), updated_at = now() WHERE id = %s$f$, :'JANETA', :b20), 'doar prin fn_bon_preia');
SELECT teste.eroare('B20c doar preluat_la, direct → refuz', format($f$UPDATE public.executie_bonuri_consum SET preluat_la = now() WHERE id = %s$f$, :b20), 'doar prin fn_bon_preia');
SELECT teste.eroare('B20d bon nou direct, deja „preluat” → refuz', $$INSERT INTO public.executie_bonuri_consum (proiect_id, stare) VALUES (1, 'preluat')$$, 'doar prin fn_bon_preia');
SELECT teste.e('B20e după încercările clientului vechi bonul e tot „generat”, fără preluare', (SELECT stare = 'generat' AND preluat_de IS NULL AND preluat_la IS NULL FROM public.executie_bonuri_consum WHERE id = :b20));
UPDATE public.executie_bonuri_consum SET stare = 'anulat', updated_at = now() WHERE id = :b20;
SELECT teste.e('B20f anularea directă (fără câmpurile de preluare) merge', (SELECT stare FROM public.executie_bonuri_consum WHERE id = :b20) = 'anulat');
RESET ROLE;
-- B21 nicio funcție din afara RPC-urilor nu scrie pe linii; service_role fără DML pe linii (Copilot r11)
SELECT teste.e('B21 invariant: scrierile pe linii doar în fn_bon_salveaza / fn_bon_preia; service_role doar citire',
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
                 AND p.proname NOT IN ('fn_bon_salveaza', 'fn_bon_preia')
                 AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), ''))
                     ~* '(insert\s+into|update|delete\s+from|truncate(\s+table)?|copy)\s+(only\s+)?("?public"?\s*\.\s*)?"?executie_bonuri_consum_linii\M')
  AND NOT has_table_privilege('service_role', 'public.executie_bonuri_consum_linii', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.executie_bonuri_consum_linii', 'DELETE')
  AND NOT has_table_privilege('service_role', 'public.executie_bonuri_consum_linii', 'TRUNCATE'));
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
