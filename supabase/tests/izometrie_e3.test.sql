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
-- r5g (#825, Jak P1): contraexemplul exact — operatorul prefix audit.#!# peste audit.doc_count(bigint) (INVOKER, citește
-- izo_documente_intrare); DEFINER-ul lui postgres, executabil de authenticated, îl cheamă DOAR prin OPERATOR(audit.#!#): nu
-- numește funcția / tabelul, n-are EXECUTE, corpul ne-ATOMIC n-are dependențe ⇒ în afara închiderii. Fără r5g: poarta verde
\set MSG_IMP_SUF ' (funcție-suport din închiderea citirilor sau mutator de cale) (citire nerevizuită)'
BEGIN;
CREATE SCHEMA audit;
CREATE FUNCTION audit.doc_count(bigint) RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.izo_documente_intrare';
CREATE OPERATOR audit.#!# (RIGHTARG = bigint, FUNCTION = audit.doc_count);
CREATE FUNCTION teste.d_op() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT OPERATOR(audit.#!#) 0::bigint';
GRANT EXECUTE ON FUNCTION teste.d_op() TO authenticated;
SELECT teste.e('E14k operator audit.#!# peste o funcție care citește izo_documente_intrare → poarta refuză explicit (invocare implicită; DEFINER-ul nu e în închidere)',
  ('invocare implicită neanalizată: operator audit.#!#(NONE,bigint) → audit.doc_count(bigint)' || :'MSG_IMP_SUF') = ANY (public.fn_izo_porti_lipsa())
  AND NOT (:'MSG_DEF' = ANY (public.fn_izo_porti_lipsa())));
:CA_T
SELECT teste.e('E14l utilizator fără drept de citire (Toma): direct 0 documente, prin DEFINER-ul cu operator toate — citirea pe care poarta o închide',
  (SELECT count(*) FROM public.izo_documente_intrare) = 0 AND teste.d_op() > 0);
:CA_J
SELECT teste.eroare('E14m același operator → o intrare API refuză', format('SELECT public.fn_izo_doc_verifica(%s)', :doc6), 'porțile registrului nu sunt complete');
:CA_PG
ROLLBACK;
-- r5g (#825, Copilot P1): DEFINER public (search_path = public, pg_temp) → helper INVOKER din storage peste izo_documente_intrare,
-- chemat calificat cu un comentariu între schemă și nume, după un literal '--' pe aceeași linie: originalul n-are forma
-- calificată, necalificatul cere storage în cale, iar copia fără comentarii taie de la „--”-ul din literal. Fără r5g: verde
BEGIN;
CREATE FUNCTION storage.e3_probe() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.izo_documente_intrare';
CREATE FUNCTION public.t_r5g_probe() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $b$DECLARE x text; BEGIN x := '--'; RETURN storage /* ascuns */ . e3_probe(); END$b$;
GRANT EXECUTE ON FUNCTION public.t_r5g_probe() TO authenticated;
SELECT teste.e('E14n literal ''--'' + comentariu în apelul calificat storage.e3_probe → poarta raportează DEFINER-ul', :'MSG_DEF' = ANY (public.fn_izo_porti_lipsa()));
:CA_T
SELECT teste.e('E14o utilizator fără drept de citire: prin DEFINER-ul public toate documentele (citirea pe care poarta o închide)',
  (SELECT count(*) FROM public.izo_documente_intrare) = 0 AND public.t_r5g_probe() > 0);
:CA_J
SELECT teste.eroare('E14p același DEFINER → o intrare API refuză', format('SELECT public.fn_izo_doc_verifica(%s)', :doc6), 'porțile registrului nu sunt complete');
:CA_PG
ROLLBACK;
-- inversul: un literal '/*' și un comentariu „--” (care conține „*/”) între schemă și punct — copia taie de la literal până la
-- „*/”, cu tot cu schema
BEGIN;
CREATE FUNCTION storage.e3_probe() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.izo_documente_intrare';
CREATE FUNCTION public.t_r5g_probe() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $b$BEGIN PERFORM '/*'; RETURN storage -- */ ascuns
  . e3_probe(); END$b$;
SELECT teste.e('E14q literal ''/*'' + comentariu „--” între storage și punct → poarta raportează DEFINER-ul', :'MSG_DEF' = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
-- cast-ul și agregatul cu funcția-suport peste documente (cheamă funcția fără să-i scrie numele; agregatul nu e candidat)
BEGIN;
CREATE TYPE teste.t_doc AS (nr bigint);
CREATE FUNCTION teste.d_cast(integer) RETURNS teste.t_doc LANGUAGE sql AS 'SELECT ROW((SELECT count(*) FROM public.izo_documente_scanuri))::teste.t_doc';
CREATE CAST (integer AS teste.t_doc) WITH FUNCTION teste.d_cast(integer);
CREATE FUNCTION teste.d_cast_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT (1::teste.t_doc).nr';
SELECT teste.e('E14r cast (integer AS teste.t_doc) peste o funcție care citește izo_documente_scanuri → poarta refuză explicit',
  ('invocare implicită neanalizată: cast (integer AS teste.t_doc) → teste.d_cast(integer)' || :'MSG_IMP_SUF') = ANY (public.fn_izo_porti_lipsa())
  AND NOT (:'MSG_DEF' = ANY (public.fn_izo_porti_lipsa())));
ROLLBACK;
BEGIN;
CREATE FUNCTION teste.d_sf(bigint, integer) RETURNS bigint LANGUAGE sql AS 'SELECT $1 + (SELECT count(*) FROM public.izo_documente_intrare_randuri)';
CREATE AGGREGATE teste.d_agg(integer) (SFUNC = teste.d_sf, STYPE = bigint, INITCOND = '0');
CREATE FUNCTION teste.d_agg_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT teste.d_agg(1)';
SELECT teste.e('E14s agregat teste.d_agg peste o funcție care citește izo_documente_intrare_randuri → poarta refuză explicit',
  ('invocare implicită neanalizată: agregat teste.d_agg(integer) → teste.d_sf(bigint,integer)' || :'MSG_IMP_SUF') = ANY (public.fn_izo_porti_lipsa())
  AND NOT (:'MSG_DEF' = ANY (public.fn_izo_porti_lipsa())));
ROLLBACK;
-- martorul: operator / cast / agregat peste funcții din afara închiderii, folosite de un DEFINER → porțile complete
BEGIN;
CREATE FUNCTION teste.d_nev(bigint) RETURNS bigint LANGUAGE sql AS 'SELECT $1 + 1';
CREATE OPERATOR teste.#+# (RIGHTARG = bigint, FUNCTION = teste.d_nev);
CREATE TYPE teste.t_nev AS (nr bigint);
CREATE FUNCTION teste.d_nev_cast(integer) RETURNS teste.t_nev LANGUAGE sql AS 'SELECT ROW($1::bigint)::teste.t_nev';
CREATE CAST (integer AS teste.t_nev) WITH FUNCTION teste.d_nev_cast(integer);
CREATE FUNCTION teste.d_nev_sf(bigint, bigint) RETURNS bigint LANGUAGE sql AS 'SELECT $1 + $2';
CREATE AGGREGATE teste.d_nev_agg(bigint) (SFUNC = teste.d_nev_sf, STYPE = bigint, INITCOND = '0');
CREATE FUNCTION teste.d_nev_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER
  AS 'SELECT (OPERATOR(teste.#+#) 0::bigint) + (1::teste.t_nev).nr + teste.d_nev_agg(1::bigint)';
SELECT teste.e('E14t operator / cast / agregat nevinovate (funcții din afara închiderii), folosite de un DEFINER → porțile complete',
  cardinality(public.fn_izo_porti_lipsa()) = 0 AND teste.d_nev_def() = 3);
ROLLBACK;
-- ═══ E15 r5g (#825) NO-GO: P1-C — funcțiile fn_izo_* sunt ȚINTE ale închiderii (un DEFINER / view / operator din afara
-- fn_izo_* care le cheamă e refuzat; invocările lor implicite din catalog sunt în ștampila E3); P1-D — invocarea implicită prin
-- expresii din catalog (CHECK, DEFAULT, coloană generată, index, trigger, politică) peste funcții din închidere → refuz, în
-- afara listei revizuite de pe prod; P2 — calea devine necunoscută doar la un comentariu lipit de o schemă a platformei ═══
\set MSG_IMP_CAT ' (obiect din catalog care cheamă o funcție din închiderea citirilor) (citire nerevizuită)'
\set MSG_E3_DEF 'definițiile E3 (indexuri / ACL pe tabele și coloane / politici / trigger-e / roluri / bucket / storage.objects / storage.buckets / invocările implicite ale fn_izo_*) diferă de amprenta de la migrare'
SELECT min(document_id) AS doc_r FROM public.izo_documente_intrare_randuri WHERE nr_crt = 1 \gset
-- P1-C, repro-ul reviewer-ului: DEFINER public (cale public, pg_temp), executabil de authenticated, peste cititorul INVOKER al
-- bucății așteptate (owner postgres) — nu numește niciun tabel; fără r5g: poarta verde, iar Toma citește rândul complet
BEGIN;
CREATE FUNCTION public.raport_receptie(p_doc bigint) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $b$SELECT public.fn_izo_doc_bucata_asteptata(p_doc, 1)$b$;
GRANT EXECUTE ON FUNCTION public.raport_receptie(bigint) TO authenticated;
SELECT teste.e('E15a DEFINER peste cititorul INVOKER fn_izo_doc_bucata_asteptata (fără tabel numit) → poarta raportează DEFINER-ul',
  :'MSG_DEF' = ANY (public.fn_izo_porti_lipsa()));
:CA_T
SELECT teste.e('E15b utilizator fără drept de citire (Toma): direct 0 documente, prin wrapper rândul complet (serie, furnizor) — citirea pe care poarta o închide',
  (SELECT count(*) FROM public.izo_documente_intrare) = 0 AND public.raport_receptie(:doc_r) ->> 'serie' IS NOT NULL
  AND public.raport_receptie(:doc_r) ->> 'furnizor' IS NOT NULL);
:CA_J
SELECT teste.eroare('E15c același wrapper → o intrare API refuză', format('SELECT public.fn_izo_doc_verifica(%s)', :doc6), 'porțile registrului nu sunt complete');
:CA_PG
ROLLBACK;
BEGIN;
CREATE FUNCTION public.raport_b(p_doc bigint) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $b$SELECT public.fn_izo_doc_avertismente(p_doc) || public.fn_izo_doc_blocante(p_doc)$b$;
SELECT teste.e('E15d DEFINER peste fn_izo_doc_avertismente || fn_izo_doc_blocante → poarta raportează DEFINER-ul', :'MSG_DEF' = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
BEGIN;
CREATE FUNCTION teste.w_bp(bigint) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT public.fn_izo_bucata_proiect($1)';
SELECT teste.e('E15e DEFINER peste fn_izo_bucata_proiect (DEFINER intern E2a, fără EXECUTE din API) → poarta raportează DEFINER-ul', :'MSG_DEF' = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
BEGIN;
CREATE FUNCTION teste.w_inv(bigint) RETURNS text LANGUAGE sql AS 'SELECT public.fn_izo_doc_hash($1)';
SELECT teste.e('E15f INVOKER din afara fn_izo_* peste fn_izo_doc_hash, nechemat de un DEFINER → porțile complete', cardinality(public.fn_izo_porti_lipsa()) = 0);
CREATE FUNCTION teste.w_def(bigint) RETURNS text LANGUAGE sql SECURITY DEFINER AS 'SELECT teste.w_inv($1)';
SELECT teste.e('E15g DEFINER → INVOKER → fn_izo_doc_hash → poarta raportează DEFINER-ul', :'MSG_DEF' = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
BEGIN;
CREATE VIEW teste.v_hash AS SELECT d.id, public.fn_izo_doc_hash(d.id) AS h FROM generate_series(1, 3) d(id);
SELECT teste.e('E15h view fără security_invoker peste fn_izo_doc_hash → poarta raportează view-ul', :'MSG_VIEW' = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
BEGIN;
CREATE OPERATOR teste.#~# (RIGHTARG = bigint, FUNCTION = public.fn_izo_doc_hash);
CREATE FUNCTION teste.w_op() RETURNS text LANGUAGE sql SECURITY DEFINER AS 'SELECT OPERATOR(teste.#~#) 1::bigint';
SELECT teste.e('E15i operator peste fn_izo_doc_hash → poarta refuză explicit (invocare implicită a unei ținte fn_izo_*)',
  ('invocare implicită neanalizată: operator teste.#~#(NONE,bigint) → fn_izo_doc_hash(bigint)' || :'MSG_IMP_SUF') = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
BEGIN;
CREATE TABLE teste.t_dflt (id int, h text DEFAULT public.fn_izo_doc_hash(1));
SELECT teste.e('E15j DEFAULT al unui tabel oarecare peste fn_izo_doc_hash → ștampila E3 (invocările implicite ale fn_izo_*) refuză',
  :'MSG_E3_DEF' = ANY (public.fn_izo_porti_e3_lipsa()) AND :'MSG_E3_DEF' = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
-- P1-D, repro-ul reviewer-ului (C2): DEFAULT peste o funcție INVOKER care citește documentele; DEFINER-ul doar inserează
-- DEFAULT VALUES — nu numește funcția, nici tabelul documentelor. Fără r5g: poarta verde, Toma primește lista documentelor
BEGIN;
CREATE SCHEMA audit;
CREATE FUNCTION audit.dflt() RETURNS text LANGUAGE sql AS 'SELECT string_agg(nr_document, '','' ORDER BY nr_document) FROM public.izo_documente_intrare';
CREATE TABLE audit.jurnal (id serial, t text DEFAULT audit.dflt());
CREATE FUNCTION teste.d_dflt() RETURNS text LANGUAGE sql SECURITY DEFINER AS 'INSERT INTO audit.jurnal DEFAULT VALUES RETURNING t';
GRANT EXECUTE ON FUNCTION teste.d_dflt() TO authenticated;
SELECT teste.e('E15k DEFAULT peste o funcție care citește izo_documente_intrare, pornit de un DEFINER care n-o numește → poarta refuză explicit',
  ('invocare implicită neanalizată: default value for column t of table audit.jurnal → audit.dflt()' || :'MSG_IMP_CAT') = ANY (public.fn_izo_porti_lipsa())
  AND NOT (:'MSG_DEF' = ANY (public.fn_izo_porti_lipsa())));
:CA_T
SELECT teste.e('E15l utilizator fără drept de citire (Toma): direct 0 documente, prin DEFINER-ul cu DEFAULT numerele documentelor',
  (SELECT count(*) FROM public.izo_documente_intrare) = 0 AND teste.d_dflt() LIKE '%AV 100%');
:CA_J
SELECT teste.eroare('E15m același DEFAULT → o intrare API refuză', format('SELECT public.fn_izo_doc_verifica(%s)', :doc6), 'porțile registrului nu sunt complete');
:CA_PG
ROLLBACK;
-- restul clasei (C1, C3–C6 + politica): câte un refuz explicit, cu obiectul numit
BEGIN;
CREATE SCHEMA audit;
CREATE FUNCTION audit.chk(int) RETURNS boolean LANGUAGE sql AS 'SELECT $1 > -1 - (SELECT count(*) FROM public.izo_documente_scanuri)';
CREATE DOMAIN audit.dom AS int CHECK (audit.chk(VALUE));
CREATE TABLE audit.t3 (x int CHECK (audit.chk(x)));
CREATE FUNCTION audit.trg() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN NEW.x := (SELECT count(*) FROM public.izo_documente_intrare_randuri); RETURN NEW; END$f$;
CREATE TABLE audit.t4 (x bigint);
CREATE TRIGGER t4_bi BEFORE INSERT ON audit.t4 FOR EACH ROW EXECUTE FUNCTION audit.trg();
CREATE FUNCTION audit.ix(int) RETURNS bigint LANGUAGE sql IMMUTABLE AS 'SELECT $1 + 0 * (SELECT count(*) FROM public.izo_documente_intrare)';
CREATE TABLE audit.t5 (x int);
CREATE INDEX t5_ix ON audit.t5 (audit.ix(x));
CREATE TABLE audit.t6 (x int, g bigint GENERATED ALWAYS AS (audit.ix(x)) STORED);
CREATE TABLE audit.t7 (x int);
ALTER TABLE audit.t7 ENABLE ROW LEVEL SECURITY;
CREATE POLICY p7 ON audit.t7 USING (audit.chk(x));
SELECT teste.e('E15n CHECK pe domeniu / pe tabel, trigger, index pe expresie, coloană generată, politică peste funcții care citesc documentele → 6 refuzuri explicite',
  (SELECT count(*) FROM unnest(public.fn_izo_porti_lipsa()) m WHERE m LIKE 'invocare implicită neanalizată: %' AND right(m, length(:'MSG_IMP_CAT')) = :'MSG_IMP_CAT'
     AND (m LIKE '%constraint dom\_check% → audit.chk(integer)%' OR m LIKE '%constraint t3\_x\_check on table audit.t3 → audit.chk(integer)%'
          OR m LIKE '%trigger t4\_bi on table audit.t4 → audit.trg()%' OR m LIKE '%index audit.t5\_ix → audit.ix(integer)%'
          OR m LIKE '%default value for column g of table audit.t6 → audit.ix(integer)%' OR m LIKE '%policy p7 on table audit.t7 → audit.chk(integer)%')) = 6);
ROLLBACK;
-- lista revizuită (replicile EXACTE ale obiectelor de platformă de pe prod — corp, owner, config, limbaj —, generate de gen_e3.py
-- din captură în izometrie_e3_replici_platforma.sql): verde; alt owner / alt nume / doar alt corp (r5h) → refuz
\set MSG_IMP_MUT ' (obiect din catalog care cheamă un mutator de cale) (citire nerevizuită)'
BEGIN;
\ir izometrie_e3_replici_platforma.sql
SELECT teste.e('E15o replicile exacte de pe prod: tr_check_filters (funcție din închidere: cheamă realtime.cast cu SQL dinamic; INVOKER, supabase_realtime_admin), issue_pg_net_access / issue_pg_graphql_access (supabase_admin, search_path="") sunt pe lista revizuită → porțile complete',
  cardinality(public.fn_izo_porti_lipsa()) = 0);
ALTER FUNCTION realtime.subscription_check_filters() OWNER TO postgres;
SELECT teste.e('E15p aceeași replică, alt owner al funcției → amprenta diferă, poarta refuză explicit',
  ('invocare implicită neanalizată: trigger tr_check_filters on table realtime.subscription → realtime.subscription_check_filters()' || :'MSG_IMP_CAT') = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
BEGIN;
\ir izometrie_e3_replici_platforma.sql
SELECT teste.e('E15q replica exactă de pe prod a event trigger-ului issue_pg_net_access (funcție din închidere ȘI mutator: GRANT EXECUTE / SET search_path în corp) → porțile complete',
  cardinality(public.fn_izo_porti_lipsa()) = 0);
ALTER EVENT TRIGGER issue_pg_net_access RENAME TO issue_pg_net_access_2;
SELECT teste.e('E15r același event trigger, alt nume → poarta refuză explicit',
  ('invocare implicită neanalizată: event trigger issue_pg_net_access_2 → extensions.grant_pg_net_access()' || :'MSG_IMP_CAT') = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
-- ═══ E16 r5h (#825 r5g NO-GO, Jak P1): lista albă cu CORPUL în amprentă — contraexemplul Jak: aceeași identitate, același owner,
-- același SECURITY INVOKER și config, DOAR corpul schimbat (copiază numerele documentelor în NEW.filters); un wrapper DEFINER doar
-- inserează în realtime.subscription … RETURNING filters (nu numește cititorul, nici documentele). Fără r5h: poarta verde ═══
BEGIN;
\ir izometrie_e3_replici_platforma.sql
CREATE OR REPLACE FUNCTION realtime.subscription_check_filters() RETURNS trigger LANGUAGE plpgsql
  AS $f$BEGIN NEW.filters := (SELECT string_agg(nr_document, ',' ORDER BY nr_document) FROM public.izo_documente_intrare); RETURN NEW; END$f$;
CREATE FUNCTION public.t_r5h_rt() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $b$INSERT INTO realtime.subscription (id) VALUES (1) RETURNING filters$b$;
GRANT EXECUTE ON FUNCTION public.t_r5h_rt() TO authenticated;
SELECT teste.e('E16a tr_check_filters: doar corpul funcției schimbat (owner / INVOKER / config ca pe prod) → amprenta diferă, poarta refuză explicit (wrapper-ul nu e în închidere)',
  (SELECT owner = 'supabase_realtime_admin' FROM (SELECT pg_get_userbyid(proowner) owner FROM pg_proc WHERE oid = 'realtime.subscription_check_filters()'::regprocedure) o)
  AND ('invocare implicită neanalizată: trigger tr_check_filters on table realtime.subscription → realtime.subscription_check_filters()' || :'MSG_IMP_CAT') = ANY (public.fn_izo_porti_lipsa())
  AND NOT (:'MSG_DEF' = ANY (public.fn_izo_porti_lipsa())));
:CA_T
SELECT teste.e('E16b utilizator fără drept de citire (Toma): direct 0 documente, prin wrapper-ul DEFINER numerele documentelor — citirea pe care poarta o închide',
  (SELECT count(*) FROM public.izo_documente_intrare) = 0 AND public.t_r5h_rt() LIKE '%AV 100%');
:CA_J
SELECT teste.eroare('E16c același corp schimbat → o intrare API refuză', format('SELECT public.fn_izo_doc_verifica(%s)', :doc6), 'porțile registrului nu sunt complete');
:CA_PG
ROLLBACK;
BEGIN;
\ir izometrie_e3_replici_platforma.sql
CREATE OR REPLACE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger LANGUAGE plpgsql SET search_path = ''
  AS $f$BEGIN IF false THEN EXECUTE 'SELECT 1'; END IF; END$f$;
SELECT teste.e('E16d issue_pg_net_access: doar corpul schimbat (tot în închidere: EXECUTE; owner / config ca pe prod) → poarta refuză explicit',
  (SELECT pg_get_userbyid(proowner) = 'supabase_admin' AND proconfig::text = '{"search_path=\"\""}' FROM pg_proc WHERE oid = 'extensions.grant_pg_net_access()'::regprocedure)
  AND ('invocare implicită neanalizată: event trigger issue_pg_net_access → extensions.grant_pg_net_access()' || :'MSG_IMP_CAT') = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
-- r5h (#825 r5g NO-GO, Jak P1): invocarea implicită a unui MUTATOR de cale — contraexemplul Jak: trigger INVOKER (fără SET
-- search_path propriu) care face set_config('search_path', 'storage, public', true) pe un tabel auxiliar; wrapper PL/pgSQL DEFINER
-- cu calea declarată public, pg_temp inserează acolo, apoi cheamă NECALIFICAT e3_cit() — storage.e3_cit, INVOKER, citește
-- documentele. Triggerul e doar în c_mut, wrapper-ul nu numește mutatorul și apelul necalificat se judecă pe calea declarată ⇒
-- fără r5h: poarta verde
BEGIN;
CREATE SCHEMA audit;
CREATE TABLE audit.aux (x int);
CREATE FUNCTION audit.cale_trg() RETURNS trigger LANGUAGE plpgsql
  AS $f$BEGIN PERFORM set_config('search_path', 'storage, public', true); RETURN NEW; END$f$;
CREATE TRIGGER aux_bi BEFORE INSERT ON audit.aux FOR EACH ROW EXECUTE FUNCTION audit.cale_trg();
CREATE FUNCTION storage.e3_cit() RETURNS text LANGUAGE sql AS 'SELECT string_agg(nr_document, '','' ORDER BY nr_document) FROM public.izo_documente_intrare';
CREATE FUNCTION public.t_r5h_cale() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $b$BEGIN INSERT INTO audit.aux VALUES (1); RETURN e3_cit(); END$b$;
GRANT EXECUTE ON FUNCTION public.t_r5h_cale() TO authenticated;
SELECT teste.e('E16e trigger INVOKER mutator de cale (set_config storage, public) pornit de un DEFINER care apoi cheamă necalificat cititorul din storage → poarta refuză explicit (DEFINER-ul nu e în închidere)',
  ('invocare implicită neanalizată: trigger aux_bi on table audit.aux → audit.cale_trg()' || :'MSG_IMP_MUT') = ANY (public.fn_izo_porti_lipsa())
  AND NOT (:'MSG_DEF' = ANY (public.fn_izo_porti_lipsa())));
:CA_T
SELECT teste.e('E16f utilizator fără drept de citire (Toma): direct 0 documente, prin DEFINER-ul cu triggerul mutator numerele documentelor',
  (SELECT count(*) FROM public.izo_documente_intrare) = 0 AND public.t_r5h_cale() LIKE '%AV 100%');
:CA_J
SELECT teste.eroare('E16g același mutator invocat implicit → o intrare API refuză', format('SELECT public.fn_izo_doc_verifica(%s)', :doc6), 'porțile registrului nu sunt complete');
:CA_PG
ROLLBACK;
-- excepțiile precise peste mutatori: trigger-ele profiles de pe prod (corpurile exacte în schelet) sunt verzi; doar corpul schimbat → refuz
BEGIN;
CREATE OR REPLACE FUNCTION public.prevent_role_escalation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $f$BEGIN PERFORM set_config('search_path', 'storage, public', false); RETURN NEW; END$f$;
SELECT teste.e('E16h prevent_role_escalation (mutator, pe lista revizuită): doar corpul schimbat (owner / DEFINER / config ca pe prod) → poarta refuză explicit',
  (SELECT pg_get_userbyid(proowner) = 'postgres' AND prosecdef AND proconfig::text = '{"search_path=public, pg_temp"}' FROM pg_proc WHERE oid = 'public.prevent_role_escalation()'::regprocedure)
  AND ('invocare implicită neanalizată: trigger prevent_role_escalation_trigger on table profiles → prevent_role_escalation()' || :'MSG_IMP_MUT') = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
-- martorul r5h: trigger peste un mutator care NU e pe listă, pe un tabel fără scrieri din DEFINER-i — tot refuz (regula e pe obiect,
-- nu pe apelant); același trigger peste o funcție fără set_config / search_path → verde
BEGIN;
CREATE SCHEMA audit;
CREATE TABLE audit.aux2 (x int);
CREATE FUNCTION audit.nev_trg() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN NEW.x := NEW.x + 1; RETURN NEW; END$f$;
CREATE TRIGGER aux2_bi BEFORE INSERT ON audit.aux2 FOR EACH ROW EXECUTE FUNCTION audit.nev_trg();
SELECT teste.e('E16i martor: trigger peste o funcție fără set_config / search_path → porțile complete', cardinality(public.fn_izo_porti_lipsa()) = 0);
CREATE OR REPLACE FUNCTION audit.nev_trg() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN PERFORM set_config('search_path', 'public', true); RETURN NEW; END$f$;
SELECT teste.e('E16j același trigger, funcția devine mutator (set_config) → poarta refuză explicit',
  ('invocare implicită neanalizată: trigger aux2_bi on table audit.aux2 → audit.nev_trg()' || :'MSG_IMP_MUT') = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
-- martorul P1-D: CHECK / DEFAULT / domeniu / trigger peste funcții din afara închiderii, pornite de un DEFINER → porțile complete
BEGIN;
CREATE SCHEMA audit;
CREATE FUNCTION audit.nev(int) RETURNS boolean LANGUAGE sql AS 'SELECT $1 >= 0';
CREATE DOMAIN audit.dom_nev AS int CHECK (audit.nev(VALUE));
CREATE TABLE audit.t_nev (x audit.dom_nev CHECK (audit.nev(x)), y text DEFAULT audit.nev(1)::text);
CREATE FUNCTION audit.trg_nev() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN RETURN NEW; END$f$;
CREATE TRIGGER t_nev_bi BEFORE INSERT ON audit.t_nev FOR EACH ROW EXECUTE FUNCTION audit.trg_nev();
CREATE FUNCTION teste.d_nev_ins() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'INSERT INTO audit.t_nev (x) VALUES (1) RETURNING x';
SELECT teste.e('E15s martor: CHECK / DEFAULT / domeniu / trigger peste funcții din afara închiderii, pornite de un DEFINER → porțile complete',
  cardinality(public.fn_izo_porti_lipsa()) = 0 AND teste.d_nev_ins() = 1);
ROLLBACK;
-- P2: forma de pe prod (fn_genereaza_numar_tichet: DEFINER, cale public, pg_temp, CAST()) + un comentariu oarecare, cu
-- realtime.cast în închidere (INVOKER cu SQL dinamic, ca pe prod) → verde; cu regula largă (orice „--” / „/*”) era roșie
BEGIN;
CREATE SCHEMA realtime;
CREATE FUNCTION realtime."cast"(val text, type_ regtype) RETURNS jsonb LANGUAGE plpgsql
  AS $f$DECLARE r jsonb; BEGIN EXECUTE format('SELECT to_jsonb(%L::%s)', val, type_) INTO r; RETURN r; END$f$;
CREATE FUNCTION public.t_r5g_tichet() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $b$BEGIN -- numărul următor
  RETURN (SELECT coalesce(max(CAST(substring(x FROM '[0-9]+') AS integer)), 0) + 1 FROM (VALUES ('TKT-0007')) v(x)); END$b$;
SELECT teste.e('E15t P2: DEFINER cu cale fixă fără realtime, un comentariu oarecare și CAST( → porțile complete',
  cardinality(public.fn_izo_porti_lipsa()) = 0 AND public.t_r5g_tichet() = 8);
CREATE OR REPLACE FUNCTION public.t_r5g_tichet() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $b$BEGIN RETURN (realtime /* lipit */ . "cast"('8', 'integer'::regtype) #>> '{}')::integer; END$b$;
SELECT teste.e('E15u același DEFINER, cu un comentariu lipit de realtime în apel → poarta raportează DEFINER-ul', :'MSG_DEF' = ANY (public.fn_izo_porti_lipsa()));
ROLLBACK;
SELECT teste.e('E12d după mutanți (anulați): porțile complete', cardinality(public.fn_izo_porti_lipsa()) = 0);

DO $$ BEGIN RAISE NOTICE 'TESTE E3: TOATE OK'; END $$;
