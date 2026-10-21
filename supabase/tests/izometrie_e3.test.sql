-- Teste SQL pentru 20261103b (Izometrie E3). Rulează DOAR prin scripts/test_izometrie_e3.sh, pe baza locală *_test, după
-- scheletul E2a + extensia E3 + 20261102a + 20261102c + 20261103b (prin runner). Rezultatul așteptat e scris dinainte.
-- Identitatea API: SET SESSION AUTHORIZATION authenticator + SET ROLE authenticated + request.jwt.claims (ca PostgREST).
\set ON_ERROR_STOP on
SET client_min_messages = notice;
\set JANETA '00000000-0000-0000-0000-000000000030'
\set CA_PG 'RESET ROLE; RESET SESSION AUTHORIZATION;'
\set CA_J 'RESET ROLE; RESET SESSION AUTHORIZATION; SET SESSION AUTHORIZATION authenticator; SELECT teste.ca(\'00000000-0000-0000-0000-000000000030\');'
\set CA_T 'RESET ROLE; RESET SESSION AUTHORIZATION; SET SESSION AUTHORIZATION authenticator; SELECT teste.ca(\'00000000-0000-0000-0000-000000000117\');'
\set CA_R 'RESET ROLE; RESET SESSION AUTHORIZATION; SET SESSION AUTHORIZATION authenticator; SELECT teste.ca(\'00000000-0000-0000-0000-000000000121\');'
\set ANTET1 '{"proiect_id":3,"depozit_id":11,"sablon":"aviz_teava","furnizor":"Arcelor  Galati","nr_document":"AV 100","data_document":"2026-10-20","total_m":36.2,"total_kg":4000.0}'
\set RANDURI1 '[{"nr_crt":1,"serie":"301AA00001","sarja":"S1","lungime_doc_mm":12100,"perete_mm":7.1,"diametru_mm":610,"greutate_kg":1500.0},{"nr_crt":2,"serie":"301AA00002","sarja":"S1","lungime_doc_mm":12100,"lungime_masurata_mm":12080,"perete_mm":7.1,"diametru_mm":610,"greutate_kg":1500.0},{"nr_crt":3,"serie":"301AA00003","sarja":"S1","lungime_doc_mm":12000,"perete_mm":7.1,"greutate_kg":1000.0,"decizie":"refuzat_la_receptie","motiv":"lovită la descărcare"}]'

-- ═══ pregătire (postgres): LOT 2 activ, o țeavă importată în depozitul 11, Janeta gestionar pe (3, 11) ═══
SELECT public.fn_izo_seteaza_nivel(3, 'stoc', 'test E3') AS nivel;
SELECT public.fn_izo_import_sold_initial(3, 'e3-import', '{"surse":[{"fisier":"T.xlsx","sha256":"4444444444444444444444444444444444444444444444444444444444444444"}],
  "bucati":[{"tip":"teava","serie":"254CA09771","sarja":"SA0818","lungime_mm":12280,"perete_mm":7.1,"diametru_mm":610,"stare":"receptionat","depozit_id":11,
             "sursa":{"fisier":"T.xlsx","foaie":"F","rand":1}}]}'::jsonb) ->> 'bucati' AS importate;
INSERT INTO public.izo_atribuiri (proiect_id, profile_id, rol, depozit_id, acordat_de, motiv) VALUES (3, :'JANETA', 'gestionar', 11, 'test', 'test E3');

-- ═══ E1 catalog ═══
SELECT teste.e('E1a rolurile E3: NOLOGIN, NOINHERIT, fără BYPASSRLS / SUPERUSER / CREATEROLE',
  (SELECT count(*) FROM pg_roles WHERE rolname IN ('izo_doc_editor', 'izo_receptie_writer') AND NOT rolcanlogin AND NOT rolinherit
     AND NOT rolbypassrls AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb) = 2);
SELECT teste.e('E1b porțile complete după E3 (E2a + E3)', cardinality(public.fn_izo_porti_lipsa()) = 0);
SELECT teste.e('E1c INSERT pe coloane al scriitorului = C ∪ {id, uid, radacina_id, server_ver}, exact',
  (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0
     AND NOT a.attisdropped AND has_column_privilege('izo_receptie_writer', 'public.magazie_bucati', a.attname, 'INSERT'))
  = (SELECT array_agg(x ORDER BY x) FROM unnest(public.fn_izo_coloane_c() || ARRAY['id', 'uid', 'radacina_id', 'server_ver']) x));
SELECT teste.e('E1d API-ul n-are DML direct pe documente; intrările interne nu sunt executabile din API',
  NOT has_table_privilege('authenticated', 'public.izo_documente_intrare', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.izo_documente_intrare', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.izo_documente_intrare_randuri', 'INSERT')
  AND NOT has_function_privilege('anon', 'public.fn_izo_doc_salveaza(bigint, bigint, jsonb, jsonb, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_izo_doc_anuleaza(bigint, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_izo_receptie_marcheaza(text, bigint, bigint, integer, bigint, text)', 'EXECUTE'));
SELECT teste.e('E1e owner-ii intrărilor', (SELECT string_agg(proname || ':' || pg_get_userbyid(proowner), ',' ORDER BY proname) FROM pg_proc
  WHERE proname IN ('fn_izo_doc_salveaza', 'fn_izo_doc_confirma', 'fn_izo_doc_pv', 'fn_izo_doc_anuleaza', 'fn_izo_doc_anuleaza_draft', 'fn_izo_doc_verifica'))
  = 'fn_izo_doc_anuleaza:izo_receptie_writer,fn_izo_doc_anuleaza_draft:izo_doc_editor,fn_izo_doc_confirma:izo_receptie_writer,fn_izo_doc_pv:izo_receptie_writer,fn_izo_doc_salveaza:izo_doc_editor,fn_izo_doc_verifica:izo_doc_editor');

-- ═══ E2 salvarea: autorizarea și contractul ═══
:CA_T
SELECT teste.eroare('E2a fără drept pe magazie / fără atribuire → refuz', format('SELECT public.fn_izo_doc_salveaza(NULL, NULL, %L, %L, NULL)', :'ANTET1', '[]'), 'nu ești gestionar');
:CA_PG
SELECT teste.eroare('E2b apel din afara API-ului (session_user postgres) → refuz', $$SELECT public.fn_izo_doc_salveaza(NULL, NULL, '{}', '[]', NULL)$$, 'doar din API');
:CA_J
SELECT teste.eroare('E2c cheie necunoscută în antet → refuz', format('SELECT public.fn_izo_doc_salveaza(NULL, NULL, %L, %L, NULL)', (:'ANTET1')::jsonb || '{"hack":1}', '[]'), 'cheie necunoscută');
SELECT teste.eroare('E2d gestionar pe alt depozit (9) → refuz', format('SELECT public.fn_izo_doc_salveaza(NULL, NULL, %L, %L, NULL)', (:'ANTET1')::jsonb || '{"depozit_id":9}', '[]'), 'nu ești gestionar');
SELECT (r ->> 'document_id')::bigint AS doc1, (r ->> 'versiune')::bigint AS ver1 FROM public.fn_izo_doc_salveaza(NULL, NULL, :'ANTET1', :'RANDURI1', NULL) r \gset
SELECT teste.e('E2e creat: draft, versiunea 1, 3 rânduri', (SELECT stare || ':' || versiune || ':' || (SELECT count(*) FROM public.izo_documente_intrare_randuri WHERE document_id = :doc1)
  FROM public.izo_documente_intrare WHERE id = :doc1) = 'draft:1:3');
SELECT teste.eroare('E2f aceeași identitate (furnizor / nr / dată canonice) încă o dată → 23505', format('SELECT public.fn_izo_doc_salveaza(NULL, NULL, %L, %L, NULL)',
  (:'ANTET1')::jsonb || '{"furnizor":"ARCELOR GALATI","nr_document":"AV100"}', '[]'), 'ux_izo_doc_identitate');
SELECT teste.eroare('E2g editare cu versiunea veche → 40001', format('SELECT public.fn_izo_doc_salveaza(%s, 99, %L, %L, NULL)', :doc1, :'ANTET1', :'RANDURI1'), 's-a schimbat');
SELECT teste.eroare('E2h schimbarea depozitului unui draft → refuz', format('SELECT public.fn_izo_doc_salveaza(%s, 1, %L, %L, NULL)', :doc1, (:'ANTET1')::jsonb || '{"depozit_id":10}', :'RANDURI1'), 'nu se schimbă după creare');
:CA_PG
SELECT teste.eroare('E2i DML direct din API pe documente → refuz', $$SET LOCAL ROLE authenticated; UPDATE public.izo_documente_intrare SET observatii = 'x'$$, 'permission denied');

-- ═══ E3 verificarea și confirmarea ═══
:CA_J
SELECT (v ->> 'versiune')::bigint AS ver1, v ->> 'hash' AS hash1, (v ->> 'ok')::boolean AS ok1 FROM public.fn_izo_doc_verifica(:doc1) v \gset
SELECT teste.e('E3a verificarea: fără blocante, avertisment de toleranță pe rândul 2 (20 mm)', :'ok1'::boolean
  AND (SELECT count(*) FROM jsonb_array_elements(public.fn_izo_doc_verifica(:doc1) -> 'avertismente') a WHERE a ->> 'cod' = 'toleranta_lungime') = 1);
SELECT teste.eroare('E3b confirmare cu hash greșit → 40001', format('SELECT public.fn_izo_doc_confirma(%s, %s, %L)', :doc1, :ver1, 'e3-doc-v1:' || repeat('0', 64)), 'verifică din nou');
SELECT (c ->> 'eveniment_id')::bigint AS ev1, jsonb_array_length(c -> 'bucati') AS nb1 FROM public.fn_izo_doc_confirma(:doc1, :ver1, :'hash1') c \gset
:CA_PG
SELECT teste.e('E3c confirmat: 2 bucăți sosit (rândul refuzat fără bucată), lungime_mm = măsurat ?? document, 1 eveniment, 2 nașteri',
  :nb1 = 2
  AND (SELECT string_agg(b.serie || '=' || b.stare || '/' || b.lungime_mm, ',' ORDER BY b.serie) FROM public.magazie_bucati b WHERE b.aviz_intrare_id = :doc1)
      = '301AA00001=sosit/12100,301AA00002=sosit/12080'
  AND (SELECT count(*) FROM public.magazie_bucati_miscari WHERE eveniment_id = :ev1 AND rol = 'nascut') = 2
  AND (SELECT stare || ':' || versiune FROM public.izo_documente_intrare WHERE id = :doc1) = 'confirmat:2'
  AND (SELECT bucata_id IS NULL FROM public.izo_documente_intrare_randuri WHERE document_id = :doc1 AND nr_crt = 3));
:CA_J
SELECT teste.e('E3d retry identic → idempotent, fără scrieri noi', (public.fn_izo_doc_confirma(:doc1, :ver1, :'hash1') ->> 'idempotent')::boolean);
SELECT teste.eroare('E3e editarea unui document confirmat → refuz', format('SELECT public.fn_izo_doc_salveaza(%s, 3, %L, %L, NULL)', :doc1, :'ANTET1', :'RANDURI1'), 'doar ciornele');
SELECT teste.eroare('E3f anularea ciornei pe un confirmat → refuz', format('SELECT public.fn_izo_doc_anuleaza_draft(%s, 3, %L)', :doc1, 'greșit'), 'doar ciornele');

-- ═══ E4 coliziunea cu registrul și unicitatea ═══
SELECT (r ->> 'document_id')::bigint AS doc2 FROM public.fn_izo_doc_salveaza(NULL, NULL,
  (:'ANTET1')::jsonb || '{"nr_document":"AV 101","total_m":12.28,"total_kg":null}',
  '[{"nr_crt":1,"serie":"254-CA 09771","lungime_doc_mm":12280,"perete_mm":7.1}]', NULL) r \gset
SELECT teste.e('E4a seria există deja în registru (din import, altă formă) → blocant serie_in_registru',
  (SELECT count(*) FROM jsonb_array_elements(public.fn_izo_doc_verifica(:doc2) -> 'blocante') a WHERE a ->> 'cod' = 'serie_in_registru') = 1);
SELECT teste.eroare('E4b confirmarea cu blocante → refuz', format('SELECT public.fn_izo_doc_confirma(%s, %s, %L)', :doc2, 1, public.fn_izo_doc_verifica(:doc2) ->> 'hash'), 'blocante');

-- ═══ E5 garda pe context (scriitorul E3 direct, cu marcaj valid pentru alt document / alte valori) ═══
:CA_PG
GRANT USAGE ON SCHEMA teste TO izo_receptie_writer;   -- doar ca helperele de test să ruleze sub rolul scriitorului (retras după E5)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO izo_receptie_writer;
BEGIN;
SET LOCAL ROLE izo_receptie_writer;
SELECT public.fn_izo_receptie_marcheaza('confirma', :doc2, 3, 11, 1, public.fn_izo_doc_hash(:doc2));
SELECT teste.eroare('E5a bucată cu tronson_id (câmp „interzis”) → refuz pe proiecție', format($q$INSERT INTO public.magazie_bucati (id, uid, radacina_id, server_ver, %s)
  SELECT 999001, gen_random_uuid(), 999001, 1, %s FROM jsonb_populate_record(NULL::public.magazie_bucati,
    public.fn_izo_doc_bucata_asteptata(%s, 1) || '{"tronson_id":16}') x$q$,
  array_to_string(public.fn_izo_coloane_c(), ', '), (SELECT string_agg('x.' || c, ', ') FROM unnest(public.fn_izo_coloane_c()) c), :doc2), 'diferă de documentul confirmat');
SELECT teste.eroare('E5b UPDATE de stare pe o bucată a altui document în contextul confirma → refuz', format(
  $q$UPDATE public.magazie_bucati SET stare = 'receptionat' WHERE aviz_intrare_id = %s$q$, :doc1), 'doar la PV');
SELECT teste.eroare('E5c eveniment pe alt document → refuz', format($q$INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, motiv, server_ver)
  VALUES ('intrare_aviz', 3, 'doc_intrare', %L, 'x', 1)$q$, :doc1::text), 'diferă de cel așteptat');
ROLLBACK;
BEGIN;
SET LOCAL ROLE izo_receptie_writer;
SELECT teste.eroare('E5d fără marcaj: scriitorul E3 nu scrie nimic în registru', $$INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, server_ver) VALUES ('gasit', 3, 1)$$,
  'fără contextul operației');
ROLLBACK;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA teste FROM izo_receptie_writer;
REVOKE USAGE ON SCHEMA teste FROM izo_receptie_writer;

-- ═══ E6 PV-ul ═══
:CA_J
SELECT teste.eroare('E6a PV pe un draft → refuz', format('SELECT public.fn_izo_doc_pv(%s, 1, %L, %L)', :doc2, 'PV 1', '2026-10-21'), 'doar pe un document confirmat');
SELECT (p ->> 'bucati_receptionate')::int AS npv FROM public.fn_izo_doc_pv(:doc1, 2, 'pv  12/2026', '2026-10-21') p \gset
:CA_PG
SELECT teste.e('E6b PV: 2 bucăți receptionat, un receptie_pv, versiunea 3', :npv = 2
  AND (SELECT count(*) FROM public.magazie_bucati WHERE aviz_intrare_id = :doc1 AND stare = 'receptionat') = 2
  AND (SELECT count(*) FROM public.magazie_bucati_evenimente WHERE document_id = :doc1::text AND tip = 'receptie_pv') = 1
  AND (SELECT versiune || ':' || pv_nr_canon FROM public.izo_documente_intrare WHERE id = :doc1) = '3:PV 12/2026');
:CA_J
SELECT teste.e('E6c retry identic → idempotent', (public.fn_izo_doc_pv(:doc1, 3, 'PV 12/2026', '2026-10-21') ->> 'idempotent')::boolean);
SELECT teste.eroare('E6d alt PV pe același document → refuz', format('SELECT public.fn_izo_doc_pv(%s, 4, %L, %L)', :doc1, 'PV 13', '2026-10-21'), 'are deja PV');

-- ═══ E7 curbe: neconform → carantină; PV fără eligibili → acceptat, 0 bucăți ═══
SELECT (r ->> 'document_id')::bigint AS doc3 FROM public.fn_izo_doc_salveaza(NULL, NULL,
  '{"proiect_id":3,"depozit_id":11,"sablon":"lista_ambalare_curbe","furnizor":"Gurgenler","nr_document":"PL 7","data_document":"2026-10-19","total_bucati":1}',
  '[{"nr_crt":1,"serie":"9006","sarja":"H1","perete_mm":8,"diametru_mm":610,"unghi_doc":45,"unghi_masurat":30,"cantitate":1,"decizie":"primit_neconform","motiv":"unghi 30° în loc de 45°"}]', NULL) r \gset
SELECT v ->> 'hash' AS hash3 FROM public.fn_izo_doc_verifica(:doc3) v \gset
SELECT teste.e('E7a confirmarea listei de curbe', (public.fn_izo_doc_confirma(:doc3, 1, :'hash3') ->> 'idempotent')::boolean = false);
SELECT teste.e('E7b PV fără rânduri primite conform → acceptat, 0 bucăți', (public.fn_izo_doc_pv(:doc3, 2, 'PV 14', '2026-10-21') ->> 'bucati_receptionate')::int = 0);
:CA_PG
SELECT teste.e('E7c curba: carantină, unghiul real (30), eveniment intrare_lista_ambalare',
  (SELECT stare || ':' || unghi_curba FROM public.magazie_bucati WHERE aviz_intrare_id = :doc3) = 'carantina:30.0'
  AND EXISTS (SELECT 1 FROM public.magazie_bucati_evenimente WHERE document_id = :doc3::text AND tip = 'intrare_lista_ambalare'));

-- ═══ E8 anularea: ciorna (gestionarul) și confirmatul (administrativ, PV întâi) ═══
:CA_T
SELECT teste.eroare('E8a anularea ciornei de un ne-atribuit → refuz', format('SELECT public.fn_izo_doc_anuleaza_draft(%s, 1, %L)', :doc2, 'greșit'), 'nu ești gestionar');
:CA_J
SELECT teste.e('E8b gestionarul își anulează ciorna (doar antetul)', public.fn_izo_doc_anuleaza_draft(:doc2, 1, 'seria există deja') ->> 'stare' = 'anulat');
:CA_PG
SELECT teste.e('E8c ciorna anulată: autor, rol, motiv; niciun eveniment', (SELECT anulat_de::text || ':' || anulat_de_rol || ':' || anulat_motiv FROM public.izo_documente_intrare WHERE id = :doc2)
  = :'JANETA' || ':authenticator:seria există deja'
  AND NOT EXISTS (SELECT 1 FROM public.magazie_bucati_evenimente WHERE document_id = :doc2::text));
SELECT teste.eroare('E8d anularea administrativă din API → refuz', $$SET LOCAL ROLE authenticated; SELECT public.fn_izo_doc_anuleaza(1, 'x')$$, 'permission denied');
SELECT teste.e('E8e anularea administrativă a documentului confirmat cu PV', (public.fn_izo_doc_anuleaza(:doc1, 'aviz greșit, reintrodus') ->> 'bucati_anulate')::int = 2);
SELECT teste.e('E8f stornourile: întâi PV-ul, apoi intrarea; bucățile anulata; documentul anulat cu ambele storno-uri',
  (SELECT string_agg(e.storno_de_eveniment_id::text, ',' ORDER BY e.id) FROM public.magazie_bucati_evenimente e WHERE e.document_id = :doc1::text AND e.tip = 'storno')
    = (SELECT eveniment_pv_id || ',' || eveniment_intrare_id FROM public.izo_documente_intrare WHERE id = :doc1)
  AND (SELECT count(*) FROM public.magazie_bucati WHERE aviz_intrare_id = :doc1 AND stare = 'anulata') = 2
  AND (SELECT stare FROM public.izo_documente_intrare WHERE id = :doc1) = 'anulat');

-- ═══ E9 reintroducerea / înlocuirea ═══
:CA_J
SELECT teste.eroare('E9a înlocuire fără motiv → refuz', format('SELECT public.fn_izo_doc_salveaza(NULL, NULL, %L, %L, NULL)',
  (:'ANTET1')::jsonb || jsonb_build_object('inlocuieste_document_id', :doc1), :'RANDURI1'), 'izo_doc_inlocuire_cu_motiv');
SELECT (r ->> 'document_id')::bigint AS doc4 FROM public.fn_izo_doc_salveaza(NULL, NULL,
  (:'ANTET1')::jsonb || jsonb_build_object('inlocuieste_document_id', :doc1, 'motiv_inlocuire', 'reintrodus după anulare', 'nr_document', 'AV 100-C'), :'RANDURI1', NULL) r \gset
SELECT teste.e('E9b reintrodus (identitate diferită permisă), salvare repetată → trece', (public.fn_izo_doc_salveaza(:doc4, 1, (:'ANTET1')::jsonb
  || jsonb_build_object('inlocuieste_document_id', :doc1, 'motiv_inlocuire', 'reintrodus după anulare', 'nr_document', 'AV 100-C'), :'RANDURI1', NULL) ->> 'versiune')::int = 2);
SELECT v ->> 'hash' AS hash4 FROM public.fn_izo_doc_verifica(:doc4) v \gset
SELECT teste.e('E9c seriile eliberate de anulare se reconfirmă pe documentul nou', jsonb_array_length(public.fn_izo_doc_confirma(:doc4, 2, :'hash4') -> 'bucati') = 2);
SELECT teste.eroare('E9d a doua înlocuire a aceleiași ținte → 23505', format('SELECT public.fn_izo_doc_salveaza(NULL, NULL, %L, %L, NULL)',
  (:'ANTET1')::jsonb || jsonb_build_object('inlocuieste_document_id', :doc1, 'motiv_inlocuire', 'încă o dată', 'nr_document', 'AV 100-D'), '[]'), 'inlocuieste_document_id');
-- ținta pe un depozit unde Janeta nu e gestionar (o creează și o anulează owner-ul) → refuz generic
:CA_R
SELECT (r ->> 'document_id')::bigint AS doc5 FROM public.fn_izo_doc_salveaza(NULL, NULL, (:'ANTET1')::jsonb || '{"depozit_id":9,"nr_document":"AV 900"}', '[]', NULL) r \gset
SELECT public.fn_izo_doc_anuleaza_draft(:doc5, 1, 'test țintă') ->> 'stare' AS st5;
:CA_J
SELECT teste.eroare('E9e înlocuirea unei ținte pe un depozit fără acces → refuz generic', format('SELECT public.fn_izo_doc_salveaza(NULL, NULL, %L, %L, NULL)',
  (:'ANTET1')::jsonb || jsonb_build_object('inlocuieste_document_id', :doc5, 'motiv_inlocuire', 'revendic', 'nr_document', 'AV 901'), '[]'), 'nu ai acces');

-- ═══ E10 Storage: încărcare / ștergere / fără UPDATE ═══
SELECT (r ->> 'document_id')::bigint AS doc6 FROM public.fn_izo_doc_salveaza(NULL, NULL, (:'ANTET1')::jsonb || '{"nr_document":"AV 600"}', '[]', NULL) r \gset
SELECT teste.e('E10a încărcarea în calea unei ciorne proprii → trece', teste.n(format($q$INSERT INTO storage.objects (bucket_id, name)
  VALUES ('izo-documente', '%s/0b1c2d3e-0000-4000-8000-000000000001.pdf')$q$, :doc6)) = 1);
SELECT teste.eroare('E10b încărcarea în calea unui document confirmat → refuz', format($q$INSERT INTO storage.objects (bucket_id, name)
  VALUES ('izo-documente', '%s/0b1c2d3e-0000-4000-8000-000000000002.pdf')$q$, :doc4), 'row-level security');
SELECT teste.e('E10c manifestul cu obiectul existent', (public.fn_izo_doc_salveaza(:doc6, 1, (:'ANTET1')::jsonb || '{"nr_document":"AV 600"}', '[]',
  jsonb_build_array(jsonb_build_object('cale', :doc6 || '/0b1c2d3e-0000-4000-8000-000000000001.pdf', 'sha256_original', repeat('a', 64), 'sha256_pdf', repeat('b', 64),
    'marime', 1000, 'mime', 'application/pdf'))) ->> 'versiune')::int = 2);
SELECT teste.e('E10d ștergerea unui obiect din manifest → 0 rânduri (politica)', teste.n(format($q$DELETE FROM storage.objects WHERE bucket_id = 'izo-documente' AND name = '%s/0b1c2d3e-0000-4000-8000-000000000001.pdf'$q$, :doc6)) = 0);
SELECT teste.e('E10e UPDATE / mutare pe un obiect → 0 rânduri (fără politică UPDATE)', teste.n(format($q$UPDATE storage.objects SET name = name || 'x' WHERE bucket_id = 'izo-documente'$q$)) = 0);
SELECT teste.eroare('E10f manifest cu un obiect inexistent → refuz', format('SELECT public.fn_izo_doc_salveaza(%s, 2, %L, %L, %L)', :doc6, (:'ANTET1')::jsonb || '{"nr_document":"AV 600"}', '[]',
  jsonb_build_array(jsonb_build_object('cale', :doc6 || '/0b1c2d3e-0000-4000-8000-000000000009.pdf', 'sha256_original', repeat('a', 64), 'sha256_pdf', repeat('b', 64), 'marime', 1, 'mime', 'application/pdf'))), 'nu există în Storage');
:CA_PG
SELECT teste.e('E10g porțile complete la final', cardinality(public.fn_izo_porti_lipsa()) = 0);

DO $$ BEGIN RAISE NOTICE 'TESTE E3: TOATE OK'; END $$;
