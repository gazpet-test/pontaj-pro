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

-- ═══ E11 (r5f, #825 NO-GO): 1 rând = 1 bucată; dublura curbei pe cheia registrului (serie + șarjă + unghiul efectiv) ═══
:CA_J
SELECT teste.eroare('E11a curbe: cantitate 2 pe un rând (total_bucati 2) → refuz la salvare', format('SELECT public.fn_izo_doc_salveaza(NULL, NULL, %L, %L, NULL)',
  '{"proiect_id":3,"depozit_id":11,"sablon":"lista_ambalare_curbe","furnizor":"Gurgenler","nr_document":"PL 869","data_document":"2026-10-19","total_bucati":2}',
  '[{"nr_crt":1,"serie":"869","sarja":"2520914","perete_mm":8,"unghi_doc":22.5,"cantitate":2}]'), 'un rând = o bucată');
SELECT teste.eroare('E11b țeavă: cantitate 2 pe un rând → refuz la salvare', format('SELECT public.fn_izo_doc_salveaza(NULL, NULL, %L, %L, NULL)',
  (:'ANTET1')::jsonb || '{"nr_document":"AV 869","total_m":12.1,"total_kg":null}',
  '[{"nr_crt":1,"serie":"301AA00869","lungime_doc_mm":12100,"perete_mm":7.1,"cantitate":2}]'), 'un rând = o bucată');
-- aceeași serie + șarjă la 22,5° și la 30° (cantitate 1 / goală) = două curbe distincte, ca în registru
SELECT (r ->> 'document_id')::bigint AS doc11 FROM public.fn_izo_doc_salveaza(NULL, NULL,
  '{"proiect_id":3,"depozit_id":11,"sablon":"lista_ambalare_curbe","furnizor":"Gurgenler","nr_document":"PL 870","data_document":"2026-10-19","total_bucati":2}',
  '[{"nr_crt":1,"serie":"870","sarja":"2520914","perete_mm":8,"unghi_doc":22.5,"cantitate":1},{"nr_crt":2,"serie":"870","sarja":"2520914","perete_mm":8,"unghi_doc":30}]', NULL) r \gset
:CA_PG
SELECT teste.eroare('E11c CHECK pe tabel: cantitate 2 inserată direct de editor pe o ciornă → refuz', format($q$SET LOCAL ROLE izo_doc_editor;
  INSERT INTO public.izo_documente_intrare_randuri (document_id, nr_crt, serie, cantitate) VALUES (%s, 99, 'X99', 2)$q$, :doc11), 'izo_doc_rand_o_bucata');
:CA_J
SELECT v ->> 'hash' AS hash11, (v ->> 'ok')::boolean AS ok11, v -> 'blocante' AS bloc11 FROM public.fn_izo_doc_verifica(:doc11) v \gset
SELECT teste.e('E11d 870 / 2520914 la 22,5° și la 30° → fără blocante (nu e dublură), totalul = numărul rândurilor', :'ok11'::boolean);
SELECT teste.e('E11e confirmarea: două bucăți distincte, fără coliziune pe ux_magbuc_izo_curba',
  jsonb_array_length(public.fn_izo_doc_confirma(:doc11, 1, :'hash11') -> 'bucati') = 2);
:CA_PG
SELECT teste.e('E11f registrul: 870 / 2520914 la 22.5 și la 30.0, câte o bucată de cantitate 1, sosit',
  (SELECT string_agg(serie || '/' || sarja || '/' || unghi_curba || '/' || cantitate || '/' || stare, ',' ORDER BY nr_crt_aviz) FROM public.magazie_bucati
    WHERE aviz_intrare_id = :doc11) = '870/2520914/22.5/1/sosit,870/2520914/30.0/1/sosit');
:CA_J
-- același unghi EFECTIV (45 pe listă; 30 pe listă, dar 45 măsurat) → dublură pe ambele rânduri
SELECT (r ->> 'document_id')::bigint AS doc12 FROM public.fn_izo_doc_salveaza(NULL, NULL,
  '{"proiect_id":3,"depozit_id":11,"sablon":"lista_ambalare_curbe","furnizor":"Gurgenler","nr_document":"PL 871","data_document":"2026-10-19","total_bucati":2}',
  '[{"nr_crt":1,"serie":"870","sarja":"2520914","perete_mm":8,"unghi_doc":45},{"nr_crt":2,"serie":"8-70","sarja":"2520914","perete_mm":8,"unghi_doc":30,"unghi_masurat":45}]', NULL) r \gset
SELECT teste.e('E11g aceeași serie + șarjă + unghi efectiv → serie_dublura pe ambele rânduri, singurul blocant',
  (SELECT string_agg(a ->> 'cod' || ':' || (a ->> 'nr_crt'), ',' ORDER BY a ->> 'nr_crt') FROM jsonb_array_elements(public.fn_izo_doc_verifica(:doc12) -> 'blocante') a)
  = 'serie_dublura:1,serie_dublura:2');
-- față de registru: 22,5° există deja (curba_in_registru), 60° e nouă; în document nu sunt dubluri
SELECT (r ->> 'document_id')::bigint AS doc13 FROM public.fn_izo_doc_salveaza(NULL, NULL,
  '{"proiect_id":3,"depozit_id":11,"sablon":"lista_ambalare_curbe","furnizor":"Gurgenler","nr_document":"PL 872","data_document":"2026-10-19","total_bucati":2}',
  '[{"nr_crt":1,"serie":"870","sarja":"2520914","perete_mm":8,"unghi_doc":22.5},{"nr_crt":2,"serie":"870","sarja":"2520914","perete_mm":8,"unghi_doc":60}]', NULL) r \gset
SELECT teste.e('E11h aceeași cheie ca registrul: doar rândul de 22,5° e blocat (curba_in_registru), fără serie_dublura',
  (SELECT string_agg(a ->> 'cod' || ':' || (a ->> 'nr_crt'), ',' ORDER BY a ->> 'nr_crt') FROM jsonb_array_elements(public.fn_izo_doc_verifica(:doc13) -> 'blocante') a)
  = 'curba_in_registru:1');

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

-- ═══ E11 r5f (#825 NO-GO): lock-ul partajat pe proiect, READ COMMITTED, motivul înlocuirii în hash, fără oracle la înlocuire ═══
-- P2-a: lock-ul PARTAJAT (73010, proiect) e ținut până la commit de confirmare și de PV. Documentele n-au rânduri primite, deci
-- garda pe bucăți (care ia și ea lock-ul) nu trage: lock-ul vine DOAR din apelul fn_izo_lock_partajat al intrării
:CA_J
SELECT (r ->> 'document_id')::bigint AS doc7 FROM public.fn_izo_doc_salveaza(NULL, NULL,
  '{"proiect_id":3,"depozit_id":11,"sablon":"lista_ambalare_curbe","furnizor":"Gurgenler","nr_document":"PL 8","data_document":"2026-10-19","total_bucati":1}',
  '[{"nr_crt":1,"serie":"9007","sarja":"H1","perete_mm":8,"unghi_doc":45,"cantitate":1,"decizie":"refuzat_la_receptie","motiv":"lovită la descărcare"}]', NULL) r \gset
SELECT v ->> 'hash' AS hash7 FROM public.fn_izo_doc_verifica(:doc7) v \gset
SELECT (r ->> 'document_id')::bigint AS doc8 FROM public.fn_izo_doc_salveaza(NULL, NULL,
  '{"proiect_id":3,"depozit_id":11,"sablon":"lista_ambalare_curbe","furnizor":"Gurgenler","nr_document":"PL 9","data_document":"2026-10-19","total_bucati":1}',
  '[{"nr_crt":1,"serie":"9008","sarja":"H1","perete_mm":8,"unghi_doc":45,"cantitate":1,"decizie":"refuzat_la_receptie","motiv":"lovită la descărcare"}]', NULL) r \gset
SELECT v ->> 'hash' AS hash8 FROM public.fn_izo_doc_verifica(:doc8) v \gset
BEGIN;
SELECT teste.e('E11a confirmarea unui document fără rânduri primite → 0 bucăți', jsonb_array_length(public.fn_izo_doc_confirma(:doc7, 1, :'hash7') -> 'bucati') = 0);
SELECT teste.e('E11b confirmarea ține lock-ul PARTAJAT (73010, 3) până la commit (fără bucăți: doar din fn_izo_lock_partajat)',
  EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.classid = 73010 AND l.objid = 3
            AND l.objsubid = 2 AND l.mode = 'ShareLock' AND l.granted));
COMMIT;
-- P2-a: un overload scalar fn_izo_lock_partajat(bigint) care NU ia lock-ul nu poate umbri apelul (semnătura VARIADIC bigint[]
-- explicită, cea din GRANT). Fiecare încercare într-o tranzacție anulată (o singură operație E3 per tranzacție), cu ștampila E2a
-- refăcută doar acolo, ca poarta să lase apelul să ajungă la lock
:CA_PG
BEGIN;
CREATE FUNCTION public.fn_izo_lock_partajat(p_proiect bigint) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
  AS $t$ BEGIN RAISE EXCEPTION 'test: overload-ul scalar fn_izo_lock_partajat(bigint) a fost chemat (fără lock)'; END $t$;
DO $t$ BEGIN EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii()); END $t$;
SELECT teste.e('E11c (pregătire) poarta completă cu overload-ul, în tranzacția de test', cardinality(public.fn_izo_porti_lipsa()) = 0);
DISCARD PLANS;   -- planurile sesiunii au rezolvat apelul înaintea overload-ului; fără asta testul n-ar proba nimic
:CA_J
SELECT teste.e('E11d confirmarea cheamă fn_izo_lock_partajat(VARIADIC bigint[]), nu overload-ul scalar',
  (public.fn_izo_doc_confirma(:doc8, 1, :'hash8') ->> 'idempotent')::boolean = false);
ROLLBACK;
:CA_PG
BEGIN;
CREATE FUNCTION public.fn_izo_lock_partajat(p_proiect bigint) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
  AS $t$ BEGIN RAISE EXCEPTION 'test: overload-ul scalar fn_izo_lock_partajat(bigint) a fost chemat (fără lock)'; END $t$;
DO $t$ BEGIN EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii()); END $t$;
DISCARD PLANS;
:CA_J
SELECT teste.e('E11e PV-ul la fel', (public.fn_izo_doc_pv(:doc7, 2, 'PV 16', '2026-10-21') ->> 'idempotent')::boolean = false);
ROLLBACK;
:CA_PG
SELECT teste.e('E11f overload-ul și ștampila de test au dispărut (ROLLBACK); doc8 a rămas ciornă, doc7 fără PV',
  (SELECT count(*) FROM pg_proc WHERE proname = 'fn_izo_lock_partajat') = 1 AND cardinality(public.fn_izo_porti_lipsa()) = 0
  AND (SELECT stare FROM public.izo_documente_intrare WHERE id = :doc8) = 'draft'
  AND (SELECT eveniment_pv_id IS NULL FROM public.izo_documente_intrare WHERE id = :doc7));
:CA_J
BEGIN;
SELECT teste.e('E11g PV-ul unui document fără rânduri primite → 0 bucăți', (public.fn_izo_doc_pv(:doc7, 2, 'PV 15', '2026-10-21') ->> 'bucati_receptionate')::int = 0);
SELECT teste.e('E11h PV-ul ține lock-ul PARTAJAT (73010, 3) până la commit',
  EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.classid = 73010 AND l.objid = 3
            AND l.objsubid = 2 AND l.mode = 'ShareLock' AND l.granted));
COMMIT;

-- P2-b: READ COMMITTED impus (nu presupus) în toate intrările care scriu — și în verificare, care rulează aceeași poartă —
-- înaintea oricărui lock; mesajul E3 (nu cel al lock-ului E2a, la care ajungeau confirmarea / PV-ul înainte)
BEGIN ISOLATION LEVEL REPEATABLE READ;
:CA_J
SELECT teste.eroare('E11i salvarea sub REPEATABLE READ → refuz', format('SELECT public.fn_izo_doc_salveaza(NULL, NULL, %L, %L, NULL)',
  (:'ANTET1')::jsonb || '{"nr_document":"AV 700"}', '[]'), 'intrările E3 cer READ COMMITTED (acum repeatable read)');
ROLLBACK;
BEGIN ISOLATION LEVEL REPEATABLE READ;
:CA_J
SELECT teste.eroare('E11j anularea ciornei sub REPEATABLE READ → refuz', format('SELECT public.fn_izo_doc_anuleaza_draft(%s, 2, %L)', :doc6, 'motiv de test'),
  'intrările E3 cer READ COMMITTED');
ROLLBACK;
BEGIN ISOLATION LEVEL REPEATABLE READ;
:CA_J
SELECT teste.eroare('E11k confirmarea sub REPEATABLE READ → refuz', format('SELECT public.fn_izo_doc_confirma(%s, 1, %L)', :doc8, :'hash8'),
  'intrările E3 cer READ COMMITTED');
ROLLBACK;
BEGIN ISOLATION LEVEL REPEATABLE READ;
:CA_J
SELECT teste.eroare('E11l PV-ul sub REPEATABLE READ → refuz', format('SELECT public.fn_izo_doc_pv(%s, 3, %L, %L)', :doc4, 'PV 17', '2026-10-21'),
  'intrările E3 cer READ COMMITTED');
ROLLBACK;
BEGIN ISOLATION LEVEL REPEATABLE READ;
:CA_J
SELECT teste.eroare('E11m verificarea sub REPEATABLE READ → refuz', format('SELECT public.fn_izo_doc_verifica(%s)', :doc6), 'intrările E3 cer READ COMMITTED');
ROLLBACK;
BEGIN ISOLATION LEVEL SERIALIZABLE;
:CA_J
SELECT teste.eroare('E11n salvarea sub SERIALIZABLE → refuz', format('SELECT public.fn_izo_doc_salveaza(NULL, NULL, %L, %L, NULL)',
  (:'ANTET1')::jsonb || '{"nr_document":"AV 701"}', '[]'), 'intrările E3 cer READ COMMITTED (acum serializable)');
ROLLBACK;
BEGIN ISOLATION LEVEL REPEATABLE READ;
:CA_PG
SELECT teste.eroare('E11o anularea administrativă a unei ciorne sub REPEATABLE READ → refuz (ramura fără fn_izo_lock_proiect)',
  format('SELECT public.fn_izo_doc_anuleaza(%s, %L)', :doc6, 'motiv de test'), 'intrările E3 cer READ COMMITTED');
ROLLBACK;
:CA_PG
SELECT teste.e('E11p ciornele doc6 / doc8 neatinse de încercările sub REPEATABLE READ', (SELECT stare || ':' || versiune FROM public.izo_documente_intrare WHERE id = :doc6) = 'draft:2'
  AND (SELECT stare || ':' || versiune FROM public.izo_documente_intrare WHERE id = :doc8) = 'draft:1');

-- P2-c: motiv_inlocuire intră în hash: același document cu alt motiv → alt hash; cu același motiv → același hash (tranzacții anulate,
-- ca ținta să rămână liberă; hash-ul nu conține id-ul documentului)
BEGIN;
:CA_J
SELECT r ->> 'hash' AS hm1 FROM public.fn_izo_doc_salveaza(NULL, NULL, (:'ANTET1')::jsonb
  || jsonb_build_object('inlocuieste_document_id', :doc2, 'motiv_inlocuire', 'motivul unu', 'nr_document', 'AV 800'), :'RANDURI1', NULL) r \gset
ROLLBACK;
BEGIN;
:CA_J
SELECT r ->> 'hash' AS hm2 FROM public.fn_izo_doc_salveaza(NULL, NULL, (:'ANTET1')::jsonb
  || jsonb_build_object('inlocuieste_document_id', :doc2, 'motiv_inlocuire', 'motivul doi', 'nr_document', 'AV 800'), :'RANDURI1', NULL) r \gset
ROLLBACK;
BEGIN;
:CA_J
SELECT r ->> 'hash' AS hm3 FROM public.fn_izo_doc_salveaza(NULL, NULL, (:'ANTET1')::jsonb
  || jsonb_build_object('inlocuieste_document_id', :doc2, 'motiv_inlocuire', 'motivul unu', 'nr_document', 'AV 800'), :'RANDURI1', NULL) r \gset
ROLLBACK;
SELECT teste.e('E11q același document cu alt motiv_inlocuire → alt hash; cu același motiv → același hash', :'hm1' <> :'hm2' AND :'hm1' = :'hm3');

-- P2-d: înlocuirea unei ținte inaccesibile — „nu există”, „există, dar nu e a ta” și „e a altuia și deja înlocuită” dau EXACT
-- același SQLSTATE + mesaj (înainte: 23503 de la FK, 23514, 23505 de la UNIQUE)
:CA_PG
CREATE FUNCTION teste.eroare_exacta(p_sql text) RETURNS text LANGUAGE plpgsql AS $t$
BEGIN
  EXECUTE p_sql; RETURN 'fără eroare';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $t$;
GRANT EXECUTE ON FUNCTION teste.eroare_exacta(text) TO authenticated;
:CA_J
SELECT teste.eroare_exacta(format('SELECT public.fn_izo_doc_salveaza(NULL, NULL, %L, %L, NULL)', (:'ANTET1')::jsonb
  || jsonb_build_object('inlocuieste_document_id', 9000000000, 'motiv_inlocuire', 'revendic', 'nr_document', 'AV 910'), '[]')) AS m_nu_exista \gset
SELECT teste.eroare_exacta(format('SELECT public.fn_izo_doc_salveaza(NULL, NULL, %L, %L, NULL)', (:'ANTET1')::jsonb
  || jsonb_build_object('inlocuieste_document_id', :doc5, 'motiv_inlocuire', 'revendic', 'nr_document', 'AV 911'), '[]')) AS m_inaccesibil \gset
:CA_R
SELECT (r ->> 'document_id')::bigint AS doc9 FROM public.fn_izo_doc_salveaza(NULL, NULL, (:'ANTET1')::jsonb
  || jsonb_build_object('depozit_id', 9, 'nr_document', 'AV 902', 'inlocuieste_document_id', :doc5, 'motiv_inlocuire', 'înlocuită de owner'), '[]', NULL) r \gset
:CA_J
SELECT teste.eroare_exacta(format('SELECT public.fn_izo_doc_salveaza(NULL, NULL, %L, %L, NULL)', (:'ANTET1')::jsonb
  || jsonb_build_object('inlocuieste_document_id', :doc5, 'motiv_inlocuire', 'revendic', 'nr_document', 'AV 912'), '[]')) AS m_inlocuit \gset
SELECT teste.e('E11r ținta inexistentă / inaccesibilă / inaccesibilă și deja înlocuită → același SQLSTATE și mesaj, generic',
  :'m_nu_exista' = :'m_inaccesibil' AND :'m_inaccesibil' = :'m_inlocuit'
  AND :'m_nu_exista' = '23514 izo E3: documentul înlocuit nu există, nu e anulat sau nu ai acces la el');
:CA_PG
SELECT teste.e('E11s nicio încercare n-a lăsat document (refuzul e înaintea INSERT-ului)',
  (SELECT count(*) FROM public.izo_documente_intrare WHERE nr_document IN ('AV 910', 'AV 911', 'AV 912')) = 0);
DROP FUNCTION teste.eroare_exacta(text);
SELECT teste.e('E10g porțile complete la final', cardinality(public.fn_izo_porti_lipsa()) = 0);

-- ═══ E11 r5f (#825 NO-GO, P1-3): Storage — stratul RESTRICTIV; RLS / FORCE / owner / ACL pe storage.objects în poarta E3 ═══
-- mutanții rulează în tranzacții anulate la final (ROLLBACK): baza rămâne cum era
\set CA_F 'RESET ROLE; RESET SESSION AUTHORIZATION; SET SESSION AUTHORIZATION authenticator; SELECT teste.ca(\'00000000-0000-0000-0000-0000000000f0\');'
\set CA_ANON 'RESET ROLE; RESET SESSION AUTHORIZATION; SET SESSION AUTHORIZATION authenticator; SELECT set_config(\'request.jwt.claims\', \'{"role":"anon"}\', false); SET ROLE anon;'
SELECT teste.e('E11a stratul RESTRICTIV: 5 politici izo_doc_scan_r_* pe storage.objects, RLS activ, poarta E3 completă',
  (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND NOT polpermissive AND polname LIKE 'izo\_doc\_scan\_r\_%') = 5
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass) AND cardinality(public.fn_izo_porti_e3_lipsa()) = 0);
-- mutant: o politică PERMISIVĂ generală nouă (FOR ALL TO public, USING / WITH CHECK true) — izo-documente rămâne închis
BEGIN;
CREATE POLICY mutant_general_r5f ON storage.objects FOR ALL TO public USING (true) WITH CHECK (true);
INSERT INTO storage.objects (bucket_id, name) VALUES (NULL, 'fara-bucket/r5f.pdf');
-- r5f (coordonat cu chat 21.10): politicile altor module pe Storage (ex. 20261103c, ai-documente-inbox) NU înroșesc poarta —
-- protecția izo-documente e stratul RESTRICTIV, nu ștampila politicilor străine
CREATE POLICY mutant_alt_bucket_r5f ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'ai-documente-inbox');
SELECT teste.e('E11b0 permisivă generală + politică pe alt bucket: porțile (E2a + E3) rămân complete',
  cardinality(public.fn_izo_porti_e3_lipsa()) = 0 AND cardinality(public.fn_izo_porti_lipsa()) = 0);
:CA_F
SELECT teste.e('E11b permisivă generală: un utilizator fără acces nu vede obiectul din izo-documente; rândul cu bucket_id NULL trece',
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'izo-documente') = 0 AND (SELECT count(*) FROM storage.objects WHERE bucket_id IS NULL) = 1);
SELECT teste.eroare('E11c permisivă generală: un utilizator fără acces nu încarcă în izo-documente', format($q$INSERT INTO storage.objects (bucket_id, name)
  VALUES ('izo-documente', '%s/0b1c2d3e-0000-4000-8000-000000000003.pdf')$q$, :doc6), 'row-level security');
-- r5f (#825 NO-GO, runda de corecție): E11h ÎNAINTEA oricărei ștergeri din bloc (altfel, pe o migrare fără strat, DELETE-ul
-- reușit al lui E11e golea bucket-ul și E11h trecea trivial)
:CA_ANON
SELECT teste.e('E11h anon: nimic din izo-documente, iar celelalte rânduri se citesc fără eroare de drept (predicatul lui e fără funcții E3)',
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'izo-documente') = 0
  AND (SELECT count(*) FROM storage.objects WHERE bucket_id IS DISTINCT FROM 'izo-documente') >= 1);
:CA_J
SELECT teste.e('E11d permisivă generală: UPDATE pe un obiect din izo-documente → 0 rânduri (și pentru gestionarul ciornei)',
  teste.n($q$UPDATE storage.objects SET name = name || 'x' WHERE bucket_id = 'izo-documente'$q$) = 0);
:CA_F
SELECT teste.e('E11e permisivă generală: un utilizator fără acces nu șterge din izo-documente',
  teste.n($q$DELETE FROM storage.objects WHERE bucket_id = 'izo-documente'$q$) = 0);
:CA_J
SELECT teste.e('E11f alt bucket (avize): încărcarea merge ca înainte',
  teste.n($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('avize', 'r5f/aviz.pdf')$q$) = 1);
SELECT teste.e('E11f2 alt bucket (avize): citirea merge ca înainte',
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'avize' AND name = 'r5f/aviz.pdf') = 1);
SELECT teste.eroare('E11g mutarea unui obiect din alt bucket ÎN izo-documente → refuz (WITH CHECK restrictiv)', format($q$UPDATE storage.objects
  SET bucket_id = 'izo-documente', name = '%s/0b1c2d3e-0000-4000-8000-000000000004.pdf' WHERE bucket_id = 'avize' AND name = 'r5f/aviz.pdf'$q$, :doc6),
  'row-level security');
SELECT teste.e('E11f3 alt bucket (avize): UPDATE-ul unui obiect merge ca înainte (r_upd / r_toti nu ating alte bucket-uri)',
  teste.n($q$UPDATE storage.objects SET name = 'r5f/aviz-2.pdf' WHERE bucket_id = 'avize' AND name = 'r5f/aviz.pdf'$q$) = 1);
SELECT teste.e('E11f4 alt bucket (avize): DELETE-ul unui obiect merge ca înainte (r_del / r_toti nu ating alte bucket-uri)',
  teste.n($q$DELETE FROM storage.objects WHERE bucket_id = 'avize' AND name = 'r5f/aviz-2.pdf'$q$) = 1);
:CA_PG
ROLLBACK;
-- r5f (#825 NO-GO, runda de corecție): DELETE și scrierile lui anon sub permisiva generală — fiecare componentă a stratului
-- RESTRICTIV are testul ei: r_del (E11n gestionarul pe manifest, E11q fără WHERE), r_toti pe INSERT (E11o) și pe DELETE (E11p)
BEGIN;
CREATE POLICY mutant_general_r5f ON storage.objects FOR ALL TO public USING (true) WITH CHECK (true);
INSERT INTO storage.objects (bucket_id, name) VALUES ('avize', 'r5f/aviz-anon.pdf');
:CA_J
SELECT teste.e('E11n permisivă generală: gestionarul ciornei (cititor) nu șterge obiectul din MANIFEST → 0 rânduri (r_del)',
  teste.n(format($q$DELETE FROM storage.objects WHERE bucket_id = 'izo-documente' AND name = '%s/0b1c2d3e-0000-4000-8000-000000000001.pdf'$q$, :doc6)) = 0);
:CA_ANON
SELECT teste.eroare('E11o permisivă generală: anon nu încarcă în izo-documente → refuz RLS (r_toti, WITH CHECK)', format($q$INSERT INTO storage.objects (bucket_id, name)
  VALUES ('izo-documente', '%s/0b1c2d3e-0000-4000-8000-000000000005.pdf')$q$, :doc6), 'row-level security');
SELECT teste.n($q$DELETE FROM storage.objects$q$) AS sters_anon \gset
:CA_PG
SELECT teste.e('E11p permisivă generală: anon, DELETE fără WHERE → obiectul din izo-documente rămâne (r_toti, USING); cel din avize e șters, ca înainte',
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'izo-documente') = 1
  AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'avize' AND name = 'r5f/aviz-anon.pdf'));
:CA_F
SELECT teste.n($q$DELETE FROM storage.objects$q$) AS sters_f \gset
:CA_PG
SELECT teste.e('E11q permisivă generală: un utilizator fără acces, DELETE fără WHERE → obiectul din izo-documente rămâne (r_del)',
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'izo-documente') = 1);
ROLLBACK;
-- mutant: DISABLE ROW LEVEL SECURITY pe storage.objects → poarta E3 (explicit + ștampila) îl raportează, intrările refuză
BEGIN;
ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;
SELECT teste.e('E11i DISABLE RLS pe storage.objects → poarta E3 îl raportează (explicit și prin ștampilă), poarta completă e incompletă',
  'Storage: RLS pe storage.objects / bucket-ul izo-documente privat / politicile RESTRICTIVE izo_doc_scan_r_*' = ANY (public.fn_izo_porti_e3_lipsa())
  AND cardinality(public.fn_izo_porti_e3_lipsa()) = 2 AND cardinality(public.fn_izo_porti_lipsa()) > 0);
:CA_J
SELECT teste.eroare('E11j DISABLE RLS pe storage.objects → o intrare API refuză', format('SELECT public.fn_izo_doc_verifica(%s)', :doc6), 'porțile registrului nu sunt complete');
:CA_PG
ROLLBACK;
BEGIN;
GRANT TRUNCATE ON storage.objects TO anon;
SELECT teste.e('E11k ACL nou pe storage.objects (TRUNCATE la anon) → poarta E3 îl raportează', cardinality(public.fn_izo_porti_e3_lipsa()) > 0);
ROLLBACK;
BEGIN;
ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;
SELECT teste.e('E11l FORCE RLS schimbat pe storage.objects → poarta E3 îl raportează', cardinality(public.fn_izo_porti_e3_lipsa()) > 0);
ROLLBACK;
BEGIN;
ALTER TABLE storage.objects OWNER TO postgres;
SELECT teste.e('E11m owner schimbat pe storage.objects → poarta E3 îl raportează', cardinality(public.fn_izo_porti_e3_lipsa()) > 0);
ROLLBACK;

-- ═══ E12 r5f (#825 NO-GO, P1-4): trigger-ele în poarta E3 cu definiția completă (WHEN / UPDATE OF), nu doar funcție + tgtype ═══
BEGIN;
DROP TRIGGER trg_izo_doc_garda ON public.izo_documente_intrare;
CREATE TRIGGER trg_izo_doc_garda BEFORE INSERT OR UPDATE OR DELETE ON public.izo_documente_intrare
  FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.fn_izo_doc_garda();
ALTER TABLE public.izo_documente_intrare ENABLE ALWAYS TRIGGER trg_izo_doc_garda;
SELECT teste.e('E12a trg_izo_doc_garda recreat cu WHEN (false) — aceeași funcție, aceleași evenimente, ENABLE ALWAYS → poarta E3 îl raportează',
  (SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_izo_doc_garda') = 'A' AND cardinality(public.fn_izo_porti_e3_lipsa()) > 0);
ROLLBACK;
BEGIN;
DROP TRIGGER prevent_role_escalation_trigger ON public.profiles;
CREATE TRIGGER prevent_role_escalation_trigger BEFORE UPDATE ON public.profiles
  FOR EACH ROW WHEN (OLD.is_owner IS NOT DISTINCT FROM NEW.is_owner) EXECUTE FUNCTION public.prevent_role_escalation();
SELECT teste.e('E12b prevent_role_escalation_trigger recreat cu WHEN care sare exact schimbarea is_owner → poarta E3 și cea completă îl raportează',
  cardinality(public.fn_izo_porti_e3_lipsa()) > 0 AND cardinality(public.fn_izo_porti_lipsa()) > 0);
ROLLBACK;
BEGIN;
DROP TRIGGER trg_profiles_campuri_owner_only ON public.profiles;
CREATE TRIGGER trg_profiles_campuri_owner_only BEFORE UPDATE OF name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_profiles_campuri_owner_only();
SELECT teste.e('E12c trg_profiles_campuri_owner_only recreat cu UPDATE OF name → poarta E3 îl raportează', cardinality(public.fn_izo_porti_e3_lipsa()) > 0);
ROLLBACK;

-- ═══ E13 r5f (#825 NO-GO, a doua ușă): rândul bucket-ului din storage.buckets — politicile lui în ștampila E3, stratul
-- RESTRICTIV izo_doc_bucket_r_* (fără INSERT / UPDATE / DELETE pe izo-documente), verificarea explicită ═══
BEGIN;
CREATE POLICY mutant_buckets_r5f ON storage.buckets FOR ALL TO public USING (true) WITH CHECK (true);
SELECT teste.e('E13a politică permisivă generală nouă pe storage.buckets → poarta E3 rămâne verde (stratul RESTRICTIV protejează rândul)',
  cardinality(public.fn_izo_porti_e3_lipsa()) = 0);
:CA_F
SELECT teste.e('E13b permisivă pe buckets: un utilizator fără acces nu face izo-documente public → 0 rânduri',
  teste.n($q$UPDATE storage.buckets SET public = true WHERE id = 'izo-documente'$q$) = 0);
SELECT teste.e('E13c permisivă pe buckets: UPDATE fără WHERE atinge doar celelalte bucket-uri (avize: 1 rând, ca înainte)',
  teste.n($q$UPDATE storage.buckets SET public = true$q$) = 1);
:CA_ANON
SELECT teste.e('E13d permisivă pe buckets: anon nu face izo-documente public / fără limite → 0 rânduri',
  teste.n($q$UPDATE storage.buckets SET public = true, file_size_limit = NULL WHERE id = 'izo-documente'$q$) = 0);
:CA_PG
SELECT teste.e('E13e izo-documente a rămas privat, cu limita lui; avize s-a schimbat (neatins de E3)',
  (SELECT string_agg(format('%s:%s:%s', id, public::text, coalesce(file_size_limit::text, '-')), ',' ORDER BY id) FROM storage.buckets)
  = 'avize:true:-,izo-documente:false:10485760');
DELETE FROM storage.objects WHERE bucket_id = 'izo-documente';   -- bucket gol (ca postgres): DELETE-ul de mai jos îl decide doar RLS, nu FK-ul
:CA_F
SELECT teste.e('E13f permisivă pe buckets: un utilizator fără acces nu șterge bucket-ul (gol) izo-documente → 0 rânduri',
  teste.n($q$DELETE FROM storage.buckets WHERE id = 'izo-documente'$q$) = 0);
SELECT teste.e('E13f2 permisivă pe buckets: nici nu-l redenumește (scos de sub nume, apoi recreat public) → 0 rânduri (USING)',
  teste.n($q$UPDATE storage.buckets SET id = 'izo-redenumit', public = true WHERE id = 'izo-documente'$q$) = 0);
:CA_PG
DELETE FROM storage.buckets WHERE id = 'izo-documente';   -- dispărut (șters de un rol cu BYPASSRLS): nu-l recreează altcineva
:CA_F
SELECT teste.eroare('E13g permisivă pe buckets: un utilizator fără acces nu recreează izo-documente (public) → refuz RLS',
  $q$INSERT INTO storage.buckets (id, name, public) VALUES ('izo-documente', 'izo-documente', true)$q$, 'row-level security');
SELECT teste.eroare('E13h permisivă pe buckets: nici prin mutarea altui bucket pe id-ul izo-documente → refuz RLS',
  $q$UPDATE storage.buckets SET id = 'izo-documente' WHERE id = 'avize'$q$, 'row-level security');
:CA_PG
ROLLBACK;
BEGIN;
DROP POLICY izo_doc_bucket_r_upd ON storage.buckets;
SELECT teste.e('E13i politica RESTRICTIVĂ izo_doc_bucket_r_upd lipsă → poarta E3 o raportează explicit (și prin ștampilă)',
  'Storage: RLS pe storage.buckets / politicile RESTRICTIVE izo_doc_bucket_r_* pe rândul bucket-ului izo-documente' = ANY (public.fn_izo_porti_e3_lipsa())
  AND cardinality(public.fn_izo_porti_e3_lipsa()) = 2);
ROLLBACK;
BEGIN;
ALTER TABLE storage.buckets DISABLE ROW LEVEL SECURITY;
SELECT teste.e('E13j DISABLE RLS pe storage.buckets → poarta E3 îl raportează explicit (și prin ștampilă), poarta completă e incompletă',
  'Storage: RLS pe storage.buckets / politicile RESTRICTIVE izo_doc_bucket_r_* pe rândul bucket-ului izo-documente' = ANY (public.fn_izo_porti_e3_lipsa())
  AND cardinality(public.fn_izo_porti_e3_lipsa()) = 2 AND cardinality(public.fn_izo_porti_lipsa()) > 0);
ROLLBACK;

-- ═══ E14 r5f (#825): tabelele documentelor E3 (izo_documente_intrare / _randuri / _scanuri) în închiderea citirilor, ca
-- registrul (design §13.2): un DEFINER / un view fără security_invoker / un lanț din afara fn_izo_* care ajunge la ele → refuz.
-- Fără ele în sămânță, toți mutanții de mai jos dădeau poarta verde (martorul pe magazie_bucati era refuzat corect) ═══
\set MSG_DEF 'o funcție DEFINER din afara registrului poate citi registrul — direct, prin view sau tranzitiv (citire nerevizuită)'
\set MSG_VIEW 'un view / view materializat citește registrul fără security_invoker (citire nerevizuită)'
SELECT teste.e('E14a starea curată (funcțiile E3 legitime fn_izo_doc_* / fn_izo_scan_* citesc documentele): porțile complete',
  cardinality(public.fn_izo_porti_lipsa()) = 0);
BEGIN;
CREATE FUNCTION teste.d_doc() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM public.izo_documente_intrare';
SELECT teste.e('E14b DEFINER care citește izo_documente_intrare → poarta raportează', :'MSG_DEF' = ANY (public.fn_izo_porti_lipsa()));
:CA_J
SELECT teste.eroare('E14c același DEFINER → o intrare API refuză', format('SELECT public.fn_izo_doc_verifica(%s)', :doc6), 'porțile registrului nu sunt complete');
:CA_PG
ROLLBACK;
BEGIN;
CREATE VIEW teste.v_doc AS SELECT * FROM public.izo_documente_scanuri;
SELECT teste.e('E14d view fără security_invoker peste izo_documente_scanuri → poarta raportează', :'MSG_VIEW' = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
BEGIN;
CREATE VIEW teste.v_doc WITH (security_invoker = on) AS SELECT * FROM public.izo_documente_scanuri;
SELECT teste.e('E14e același view cu security_invoker = on (necitit de un DEFINER) → porțile complete', cardinality(public.fn_izo_porti_lipsa()) = 0);
CREATE FUNCTION teste.d_v_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM teste.v_doc';
SELECT teste.e('E14f DEFINER care citește view-ul security_invoker al izo_documente_scanuri → poarta raportează', :'MSG_DEF' = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
BEGIN;
CREATE FUNCTION teste.d_rand_inv() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.izo_documente_intrare_randuri';
SELECT teste.e('E14g INVOKER care citește izo_documente_intrare_randuri, nechemat de un DEFINER → porțile complete', cardinality(public.fn_izo_porti_lipsa()) = 0);
CREATE FUNCTION teste.d_rand_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT teste.d_rand_inv()';
SELECT teste.e('E14h DEFINER → INVOKER care citește izo_documente_intrare_randuri → poarta raportează', :'MSG_DEF' = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
BEGIN;
CREATE FUNCTION teste.d_atomic() RETURNS bigint LANGUAGE sql SECURITY DEFINER BEGIN ATOMIC SELECT count(*) FROM public.izo_documente_scanuri; END;
SELECT teste.e('E14i DEFINER BEGIN ATOMIC peste izo_documente_scanuri → poarta raportează', :'MSG_DEF' = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
BEGIN;
CREATE FUNCTION teste.d_reg() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM public.magazie_bucati';
SELECT teste.e('E14j martorul E2a: DEFINER care citește magazie_bucati → poarta raportează, ca înainte', :'MSG_DEF' = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
SELECT teste.e('E12d după mutanți (anulați): porțile complete', cardinality(public.fn_izo_porti_lipsa()) = 0);

DO $$ BEGIN RAISE NOTICE 'TESTE E3: TOATE OK'; END $$;
