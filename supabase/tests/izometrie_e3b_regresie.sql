-- GENERAT de e3b_regresie.py; suitele LIVE nu se editeaza.
-- Selectati cu -v e2a=true|false; cate o baza proaspata pentru fiecare ramura.
\if :e2a
-- Teste SQL pentru 20261102a (Izometrie E2a). Rulează DOAR prin scripts/test_izometrie_e2a.sh, pe baza locală *_test,
-- după schelet + migrare (aplicată prin runner). Fiecare test are rezultatul așteptat scris dinainte (plan E2 §2.6).
-- Atenție: aici postgres e superuser — testele „ca postgres” arată garda (current_user ≠ writer), nu limitele platformei.
\set ON_ERROR_STOP on
SET client_min_messages = notice;
\set RAZVAN '00000000-0000-0000-0000-000000000121'
\set JANETA '00000000-0000-0000-0000-000000000030'
\set TOMA   '00000000-0000-0000-0000-000000000117'
\set TITI   '00000000-0000-0000-0000-000000000115'
\set FARA   '00000000-0000-0000-0000-0000000000f0'

CREATE TEMP TABLE payload (nume text PRIMARY KEY, p jsonb);
GRANT SELECT ON payload TO PUBLIC;
INSERT INTO payload VALUES
 ('imp1', '{"motiv":"test","surse":[{"fisier":"TOPLET.xlsx","sha256":"1111111111111111111111111111111111111111111111111111111111111111"},
                               {"fisier":"JUP.xlsx","sha256":"2222222222222222222222222222222222222222222222222222222222222222"}],
   "bucati":[
    {"tip":"teava","serie":"254CA09771","sarja":"SA0818","lungime_mm":12280,"perete_mm":7.1,"diametru_mm":610,"stare":"receptionat","depozit_id":11,"izolatie":"PEHD","nr_aviz":"144016","data_aviz":"2026-04-28","sursa":{"fisier":"TOPLET.xlsx","foaie":"TEAVA 7.1 TOPLET","rand":12}},
    {"tip":"teava","serie":"247EK08603","sarja":"SA07348","lungime_mm":12280,"perete_mm":7.1,"diametru_mm":610,"stare":"pe_tronson","tronson_id":21,"depozit_origine_id":10,"sursa":{"fisier":"TOPLET.xlsx","foaie":"TEAVA 7.1 TOPLET","rand":13}},
    {"tip":"teava","serie":"264DB00500","sarja":"SA03585","lungime_mm":12190,"perete_mm":8.8,"diametru_mm":610,"stare":"sosit","depozit_id":9,"sursa":{"fisier":"JUP.xlsx","foaie":"TEAVA 8.8 MM","rand":14}},
    {"tip":"curba","serie":"870","sarja":"2520914","unghi_curba":20,"perete_mm":8,"diametru_mm":610,"stare":"sosit","depozit_id":11,"sursa":{"fisier":"TOPLET.xlsx","foaie":"CURBE LOT 2","rand":20}}]}'),
 ('imp2', '{"surse":[{"fisier":"JUP.xlsx","sha256":"2222222222222222222222222222222222222222222222222222222222222222"}],
   "bucati":[{"tip":"teava","serie":"254CA08543","sarja":"SA04755","lungime_mm":11720,"perete_mm":7.1,"stare":"sosit","depozit_id":9,"sursa":{"fisier":"JUP.xlsx","foaie":"TEAVA 7.1 MM","rand":13}}]}'),
 ('imp2b', '{"surse":[{"fisier":"JUP.xlsx","sha256":"2222222222222222222222222222222222222222222222222222222222222222"}],
   "bucati":[{"tip":"teava","serie":"254CA08543","sarja":"SA04755","lungime_mm":11730,"perete_mm":7.1,"stare":"sosit","depozit_id":9,"sursa":{"fisier":"JUP.xlsx","foaie":"TEAVA 7.1 MM","rand":13}}]}'),
 ('dubla_radacina', '{"surse":[{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}],
   "bucati":[{"tip":"teava","serie":"254-CA 09771","sarja":"SA9","lungime_mm":11000,"perete_mm":7.1,"stare":"sosit","depozit_id":9,"sursa":{"fisier":"X.xlsx","foaie":"F","rand":1}}]}'),
 ('fara_perete', '{"surse":[{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}],
   "bucati":[{"tip":"teava","serie":"299ZZ00001","sarja":"SA9","lungime_mm":11000,"stare":"sosit","depozit_id":9,"sursa":{"fisier":"X.xlsx","foaie":"F","rand":1}}]}'),
 ('fara_sursa', '{"surse":[{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}],
   "bucati":[{"tip":"teava","serie":"299ZZ00002","sarja":"SA9","lungime_mm":11000,"perete_mm":7.1,"stare":"sosit","depozit_id":9}]}'),
 ('depozit_strain', '{"surse":[{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}],
   "bucati":[{"tip":"teava","serie":"299ZZ00003","sarja":"SA9","lungime_mm":11000,"perete_mm":7.1,"stare":"sosit","depozit_id":1,"sursa":{"fisier":"X.xlsx","foaie":"F","rand":1}}]}'),
 ('nu_obiect', '[]'),
 ('fara_bucati', '{"surse":[{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}]}'),
 ('bucati_null', '{"surse":[{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}],"bucati":null}'),
 ('surse_obiect', '{"surse":{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"},"bucati":[{"tip":"teava","serie":"299YY00001","sarja":"SA9","lungime_mm":11000,"perete_mm":7.1,"stare":"sosit","depozit_id":9,"sursa":{"fisier":"X.xlsx","foaie":"F","rand":1}}]}'),
 ('rand_nu_obiect', '{"surse":[{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}],"bucati":[1]}'),
 ('tip_lipsa', '{"surse":[{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}],"bucati":[{"serie":"299YY00002","sarja":"SA9","lungime_mm":11000,"perete_mm":7.1,"stare":"sosit","depozit_id":9,"sursa":{"fisier":"X.xlsx","foaie":"F","rand":1}}]}'),
 ('stare_lipsa', '{"surse":[{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}],"bucati":[{"tip":"teava","serie":"299YY00003","sarja":"SA9","lungime_mm":11000,"perete_mm":7.1,"depozit_id":9,"sursa":{"fisier":"X.xlsx","foaie":"F","rand":1}}]}'),
 ('sursa_necunoscuta', '{"surse":[{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}],"bucati":[{"tip":"teava","serie":"299YY00001","sarja":"SA9","lungime_mm":11000,"perete_mm":7.1,"stare":"sosit","depozit_id":9,"sursa":{"fisier":"Y.xlsx","foaie":"F","rand":1}}]}'),
 ('surse_duplicate', '{"surse":[{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"},{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}],"bucati":[{"tip":"teava","serie":"299YY00001","sarja":"SA9","lungime_mm":11000,"perete_mm":7.1,"stare":"sosit","depozit_id":9,"sursa":{"fisier":"X.xlsx","foaie":"F","rand":1}}]}'),
 ('tronson_cu_depozit', '{"surse":[{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}],"bucati":[{"tip":"teava","serie":"299YY00004","sarja":"SA9","lungime_mm":11000,"perete_mm":7.1,"stare":"pe_tronson","tronson_id":21,"depozit_id":10,"sursa":{"fisier":"X.xlsx","foaie":"F","rand":1}}]}'),
 ('curba_dubla', '{"surse":[{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}],
   "bucati":[{"tip":"curba","serie":"870","sarja":"2520914","unghi_curba":20,"perete_mm":8,"stare":"sosit","depozit_id":11,"sursa":{"fisier":"X.xlsx","foaie":"C","rand":2}}]}');

-- ═══ T1 catalog ═══
SELECT teste.e('T1a rolul: NOLOGIN, NOINHERIT, fără BYPASSRLS', (SELECT NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolsuper FROM pg_roles WHERE rolname = 'izo_registru_writer'));
SELECT teste.e('T1b doar postgres e membru (SET, fără INHERIT); fără SET/INHERIT din API',
  NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = 'izo_registru_writer'::regrole AND member <> 'postgres'::regrole)
  AND EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = 'izo_registru_writer'::regrole AND member = 'postgres'::regrole AND set_option)
  AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = 'izo_registru_writer'::regrole AND inherit_option)
  AND NOT pg_has_role('authenticated', 'izo_registru_writer', 'MEMBER') AND NOT pg_has_role('anon', 'izo_registru_writer', 'MEMBER')
  AND NOT pg_has_role('service_role', 'izo_registru_writer', 'MEMBER') AND NOT pg_has_role('authenticator', 'izo_registru_writer', 'MEMBER'));
SELECT teste.e('T1c funcțiile writer-ului = lista albă, DEFINER, neexecutabile din API',
  (SELECT array_agg(proname::text ORDER BY proname) FROM pg_proc WHERE proowner = 'izo_registru_writer'::regrole)
    = ARRAY['fn_izo_activeaza_si_importa','fn_izo_import_sold_initial','fn_izo_import_storno','fn_izo_seteaza_nivel']
  AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proowner = 'izo_registru_writer'::regrole AND (NOT prosecdef
       OR has_function_privilege('authenticated', oid, 'EXECUTE') OR has_function_privilege('anon', oid, 'EXECUTE')
       OR has_function_privilege('service_role', oid, 'EXECUTE'))));
SELECT teste.e('T1d writer fără CREATE pe public, fără tabele deținute', NOT has_schema_privilege('izo_registru_writer', 'public', 'CREATE')
  AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relowner = 'izo_registru_writer'::regrole));
SELECT teste.e('T1e tabelele noi: anon nimic, authenticated/service_role doar SELECT',
  NOT EXISTS (SELECT 1 FROM unnest(ARRAY['izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari']) t(n),
                            unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p(n)
               WHERE has_table_privilege('anon', 'public.' || t.n, p.n)
                  OR (p.n <> 'SELECT' AND (has_table_privilege('authenticated', 'public.' || t.n, p.n) OR has_table_privilege('service_role', 'public.' || t.n, p.n)))));
SELECT teste.e('T1f toate proiectele off, registrul gol', NOT EXISTS (SELECT 1 FROM public.izo_proiect_config)
  AND NOT EXISTS (SELECT 1 FROM public.magazie_bucati WHERE tip_cod IS NOT NULL) AND public.fn_izo_nivel(3) = 'off');
SELECT teste.e('T1g amprenta în COMMENT', obj_description('public.magazie_bucati_evenimente'::regclass, 'pg_class') ~ 'amprenta=[0-9a-f]{32}( |$)');
SELECT teste.e('T1h rândurile gazpet existente neatinse (18) + beneficiar LOT 1 (1)',
  (SELECT count(*) FROM public.magazie_bucati WHERE provenienta = 'gazpet') = 18 AND (SELECT count(*) FROM public.magazie_bucati WHERE provenienta = 'beneficiar') = 1);

-- ═══ T2 înainte de activare (nivel off): totul ca azi ═══
SELECT teste.ca(:'JANETA');
SELECT teste.e('T2a off: authenticated inserează beneficiar pe proiectul 3', teste.n($$INSERT INTO public.magazie_bucati (proiect_id, tip_material_id, serie, provenienta) VALUES (3, 1, 'TMP1', 'beneficiar')$$) = 1);
SELECT teste.e('T2b off: și îl șterge', teste.n($$DELETE FROM public.magazie_bucati WHERE serie = 'TMP1'$$) = 1);
SELECT teste.eroare('T2c authenticated nu poate seta nivelul', $$SELECT public.fn_izo_seteaza_nivel(3, 'stoc', 'test')$$, 'permission denied');
SELECT teste.eroare('T2d authenticated nu poate importa', $$SELECT public.fn_izo_import_sold_initial(3, 'x-1', '{}'::jsonb)$$, 'permission denied');
SELECT teste.eroare('T2e authenticated nu poate apela fn_izo_acces', $$SELECT public.fn_izo_acces(3, 'magazie', 'editor')$$, 'permission denied');
RESET ROLE;

-- ═══ T3 activarea ═══
SELECT teste.eroare('T3a import pe proiect off → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'imp-0', (SELECT p FROM payload WHERE nume = 'imp2'))$$, 'nivelul stoc');
INSERT INTO public.magazie_bucati (proiect_id, tip_material_id, serie, provenienta) VALUES (3, 1, 'LEGACY1', 'beneficiar');
SELECT teste.eroare('T3b activare cu bucăți beneficiar în afara registrului → refuz', $$SELECT public.fn_izo_seteaza_nivel(3, 'stoc', 'test')$$, 'în afara registrului');
DELETE FROM public.magazie_bucati WHERE serie = 'LEGACY1';
SELECT teste.eroare('T3c montaj → refuz (E4a)', $$SELECT public.fn_izo_seteaza_nivel(3, 'montaj', 'test')$$, 'E4a');
SELECT teste.eroare('T3d fără motiv → refuz', $$SELECT public.fn_izo_seteaza_nivel(3, 'stoc', '')$$, 'motivul');
SELECT teste.e('T3e activare stoc pe proiectul 3 (0 bucăți)', public.fn_izo_seteaza_nivel(3, 'stoc', 'test E2a') = 'stoc');
SELECT teste.e('T3e2 nivelul citit după activare', public.fn_izo_nivel(3) = 'stoc');
SELECT teste.eroare('T3f config nu se scrie direct (nici de postgres)', $$UPDATE public.izo_proiect_config SET nivel_izo = 'off' WHERE proiect_id = 3$$, 'doar prin funcțiile registrului');
SELECT teste.e('T3g LOT 1 rămâne off', public.fn_izo_nivel(1) = 'off');

-- ═══ T4 importul ═══
SELECT teste.e('T4a import imp-1: 3 țevi + 1 curbă',
  (SELECT (r->>'bucati')::int = 4 AND (r->>'tevi')::int = 3 AND (r->>'curbe')::int = 1 AND (r->>'pe_tronson')::int = 1 AND NOT (r->>'duplicat')::boolean
     FROM (SELECT public.fn_izo_import_sold_initial(3, 'imp-1', (SELECT p FROM payload WHERE nume = 'imp1')) r) x));
SELECT teste.e('T4b bucățile: rădăcini (radacina_id = id, cod AB), tip_cod, serie_canon, lungime_cm, loc',
  (SELECT bool_and(radacina_id = id AND parinte_id IS NULL AND cod_bucata = 'AB' AND uid IS NOT NULL AND server_ver IS NOT NULL)
          AND bool_and(serie_canon = upper(regexp_replace(serie, '[[:space:]._/-]', '', 'g')))
          AND count(*) FILTER (WHERE tip_cod = 'teava') = 3 AND count(*) FILTER (WHERE tip_cod = 'curba') = 1
          AND bool_and(tip_cod <> 'teava' OR lungime_cm = round(lungime_mm / 10.0))
          AND count(*) FILTER (WHERE stare = 'pe_tronson' AND locatie_tip = 'tronson' AND tronson_id = 21 AND depozit_id IS NULL
                               AND atribute->>'depozit_origine_id' = '10') = 1
          AND count(*) FILTER (WHERE locatie_tip = 'depozit') = 3
     FROM public.magazie_bucati WHERE tip_cod IS NOT NULL));
SELECT teste.e('T4c un eveniment sold_initial + 4 mișcări „nascut”',
  (SELECT count(*) FROM public.magazie_bucati_evenimente WHERE tip = 'sold_initial' AND import_id = 'imp-1') = 1
  AND (SELECT count(*) FROM public.magazie_bucati_miscari m JOIN public.magazie_bucati_evenimente e ON e.id = m.eveniment_id
        WHERE e.import_id = 'imp-1' AND m.rol = 'nascut') = 4);
SELECT teste.e('T4d același import_id + același payload → duplicat, fără efecte',
  (SELECT (public.fn_izo_import_sold_initial(3, 'imp-1', (SELECT p FROM payload WHERE nume = 'imp1'))->>'duplicat')::boolean)
  AND (SELECT count(*) FROM public.magazie_bucati WHERE tip_cod IS NOT NULL) = 4
  AND (SELECT count(*) FROM public.magazie_bucati_evenimente) = 1);
SELECT teste.eroare('T4e același import_id + alt payload → conflict', $$SELECT public.fn_izo_import_sold_initial(3, 'imp-1', (SELECT p FROM payload WHERE nume = 'imp2'))$$, 'conflict');
SELECT teste.e('T4e2 după conflict: 0 efecte', (SELECT count(*) FROM public.magazie_bucati WHERE tip_cod IS NOT NULL) = 4);
SELECT teste.eroare('T4f R1 (c): a doua rădăcină cu aceeași serie canonică („254-CA 09771”) → refuz',
  $$SELECT public.fn_izo_import_sold_initial(3, 'dub-1', (SELECT p FROM payload WHERE nume = 'dubla_radacina'))$$, 'R1 c');
SELECT teste.eroare('T4g perete lipsă → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'per-1', (SELECT p FROM payload WHERE nume = 'fara_perete'))$$, 'perete');
SELECT teste.eroare('T4h sursa (fișier/foaie/rând) lipsă → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'src-1', (SELECT p FROM payload WHERE nume = 'fara_sursa'))$$, 'R13');
SELECT teste.eroare('T4i depozit al altui proiect → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'dep-1', (SELECT p FROM payload WHERE nume = 'depozit_strain'))$$, 'nu țin de proiectul');
SELECT teste.eroare('T4j curbă cu aceeași serie + șarjă + unghi → coliziune', $$SELECT public.fn_izo_import_sold_initial(3, 'crb-1', (SELECT p FROM payload WHERE nume = 'curba_dubla'))$$, 'coliziune');
SELECT teste.eroare('T4m payload nu e obiect → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'mal-1', (SELECT p FROM payload WHERE nume = 'nu_obiect'))$$, 'payload invalid');
SELECT teste.eroare('T4n payload fără cheia bucati → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'mal-2', (SELECT p FROM payload WHERE nume = 'fara_bucati'))$$, 'payload invalid');
SELECT teste.eroare('T4o bucati null → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'mal-3', (SELECT p FROM payload WHERE nume = 'bucati_null'))$$, 'payload invalid');
SELECT teste.eroare('T4p surse obiect în loc de listă → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'mal-4', (SELECT p FROM payload WHERE nume = 'surse_obiect'))$$, 'payload invalid');
SELECT teste.eroare('T4q payload NULL → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'mal-5', NULL)$$, 'payload invalid');
SELECT teste.eroare('T4r rând care nu e obiect → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'mal-6', (SELECT p FROM payload WHERE nume = 'rand_nu_obiect'))$$, 'nu e obiect');
SELECT teste.eroare('T4s rând fără tip → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'mal-7', (SELECT p FROM payload WHERE nume = 'tip_lipsa'))$$, 'cere teava/curba');
SELECT teste.eroare('T4t rând fără stare → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'mal-8', (SELECT p FROM payload WHERE nume = 'stare_lipsa'))$$, 'la sold inițial');
SELECT teste.eroare('T4u fișierul sursă al rândului nu e în surse[] → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'mal-9', (SELECT p FROM payload WHERE nume = 'sursa_necunoscuta'))$$, 'nu e în surse');
SELECT teste.eroare('T4v surse[] cu fișier duplicat → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'mal-10', (SELECT p FROM payload WHERE nume = 'surse_duplicate'))$$, 'duplicate');
SELECT teste.eroare('T4w pe_tronson cu depozit_id (loc dublu) → refuz', $$SELECT public.fn_izo_import_sold_initial(3, 'mal-11', (SELECT p FROM payload WHERE nume = 'tronson_cu_depozit'))$$, 'pe_tronson cere');
SELECT teste.e('T4x2 izolația lipsă din payload → NULL (necunoscută), nu „neizolata”', (SELECT izolatie IS NULL FROM public.magazie_bucati WHERE serie = '870' AND tip_cod = 'curba')
  AND (SELECT izolatie FROM public.magazie_bucati WHERE serie = '254CA09771') = 'PEHD');
SELECT teste.e('T4k importurile refuzate n-au lăsat nimic', (SELECT count(*) FROM public.izo_importuri) = 1 AND (SELECT count(*) FROM public.magazie_bucati WHERE tip_cod IS NOT NULL) = 4);
SELECT teste.eroare('T4l indexul de frunză e ultima barieră (aceeași serie+șarjă+lungime la cm, scrisă de writer)',
  $q$DO $d$ BEGIN SET LOCAL ROLE izo_registru_writer; PERFORM set_config('izo.registru_tx', txid_current()::text, true);
     INSERT INTO public.magazie_bucati (id, proiect_id, tip_material_id, tip_cod, uid, radacina_id, parinte_id, cod_bucata, serie, sarja, lungime_mm, perete_mm, provenienta, stare, locatie_tip, depozit_id, server_ver)
     SELECT nextval('public.magazie_bucati_id_seq'), 3, 1, 'teava', gen_random_uuid(), b.id, b.id, 'AC', b.serie, b.sarja, b.lungime_mm + 2, 7.1, 'beneficiar', 'sosit', 'depozit', 9, 1
       FROM public.magazie_bucati b WHERE b.serie = '264DB00500'; END $d$$q$, 'ux_magbuc_izo_frunza');

-- ═══ T5 garda: scrieri directe ═══
SELECT teste.ca(:'RAZVAN');
SELECT teste.e('T5a authenticated (owner): UPDATE pe bucată din registru → 0 rânduri (RESTRICTIVE)',
  teste.n($$UPDATE public.magazie_bucati SET observatii = 'x' WHERE tip_cod IS NOT NULL$$) = 0);
SELECT teste.e('T5b authenticated: DELETE → 0 rânduri', teste.n($$DELETE FROM public.magazie_bucati WHERE tip_cod IS NOT NULL$$) = 0);
SELECT teste.eroare('T5c authenticated: INSERT beneficiar pe proiectul 3 → refuz', $$INSERT INTO public.magazie_bucati (proiect_id, tip_material_id, serie, provenienta) VALUES (3, 1, 'Z1', 'beneficiar')$$, 'doar prin funcțiile registrului');
SELECT teste.eroare('T5d authenticated: gazpet → beneficiar pe proiectul 3 → refuz', $$UPDATE public.magazie_bucati SET provenienta = 'beneficiar' WHERE provenienta = 'gazpet' AND proiect_id = 3$$, 'doar prin funcțiile registrului');
SELECT teste.eroare('T5e authenticated: beneficiar LOT 1 → proiectul 3 → refuz', $$UPDATE public.magazie_bucati SET proiect_id = 3 WHERE serie = '254CA00001'$$, 'doar prin funcțiile registrului');
RESET ROLE;
SET ROLE service_role;
SELECT teste.eroare('T5f service_role (BYPASSRLS): UPDATE → garda', $$UPDATE public.magazie_bucati SET observatii = 'x' WHERE serie = '254CA09771'$$, 'doar prin funcțiile registrului');
SELECT teste.eroare('T5g service_role: DELETE → garda', $$DELETE FROM public.magazie_bucati WHERE serie = '254CA09771'$$, 'doar prin funcțiile registrului');
SELECT teste.eroare('T5h service_role: INSERT beneficiar pe proiectul 3 → garda', $$INSERT INTO public.magazie_bucati (proiect_id, tip_material_id, serie, provenienta) VALUES (3, 1, 'Z2', 'beneficiar')$$, 'doar prin funcțiile registrului');
SELECT teste.eroare('T5i service_role: beneficiar → gazpet (OLD) → garda', $$UPDATE public.magazie_bucati SET provenienta = 'gazpet' WHERE serie = '254CA09771'$$, 'doar prin funcțiile registrului');
SELECT teste.eroare('T5j service_role: LOT 2 → LOT 1 (OLD) → garda', $$UPDATE public.magazie_bucati SET proiect_id = 1 WHERE serie = '254CA09771'$$, 'doar prin funcțiile registrului');
SELECT teste.eroare('T5k service_role: LOT 1 → LOT 2 (NEW) → garda', $$UPDATE public.magazie_bucati SET proiect_id = 3 WHERE serie = '254CA00001'$$, 'doar prin funcțiile registrului');
SELECT teste.eroare('T5l service_role: registru INSERT → garda', $$INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, server_ver) VALUES ('gasit', 3, 1)$$, 'permission denied');
RESET ROLE;
CREATE FUNCTION teste.definer_postgres() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('izo.registru_tx', txid_current()::text, true);   -- marcajul singur nu ajunge
  UPDATE public.magazie_bucati SET observatii = 'x' WHERE serie = '254CA09771';
END $$;
SELECT teste.eroare('T5m funcție DEFINER cu owner postgres, chiar cu marcaj → garda', $$SELECT teste.definer_postgres()$$, 'doar prin funcțiile registrului');
DROP FUNCTION teste.definer_postgres();   -- altfel poarta de citiri (T11/T13) o prinde: DEFINER din afara registrului care-l atinge
SELECT teste.eroare('T5n rolul writer fără marcaj → garda', $q$DO $d$ BEGIN SET LOCAL ROLE izo_registru_writer; UPDATE public.magazie_bucati SET observatii = 'x' WHERE serie = '254CA09771'; END $d$$q$, 'doar prin funcțiile registrului');
SELECT teste.eroare('T5o rolul writer cu marcaj, dar stare rezervata → refuz', $q$DO $d$ BEGIN SET LOCAL ROLE izo_registru_writer; PERFORM set_config('izo.registru_tx', txid_current()::text, true); UPDATE public.magazie_bucati SET stare = 'rezervata' WHERE serie = '254CA09771'; END $d$$q$, 'interzisă');
SELECT teste.eroare('T5p rolul writer cu marcaj: DELETE → refuz', $q$DO $d$ BEGIN SET LOCAL ROLE izo_registru_writer; PERFORM set_config('izo.registru_tx', txid_current()::text, true); DELETE FROM public.magazie_bucati WHERE serie = '254CA09771'; END $d$$q$, 'permission denied');
SELECT teste.eroare('T5q tip_cod care nu bate cu tip_material_id → refuz', $q$DO $d$ BEGIN SET LOCAL ROLE izo_registru_writer; PERFORM set_config('izo.registru_tx', txid_current()::text, true); UPDATE public.magazie_bucati SET tip_cod = 'curba' WHERE serie = '254CA09771'; END $d$$q$, 'nu bate');
SELECT teste.eroare('T5r TRUNCATE magazie_bucati → refuz', $$TRUNCATE public.magazie_bucati CASCADE$$, 'TRUNCATE');
SELECT teste.eroare('T5s registru: UPDATE eveniment → refuz', $$UPDATE public.magazie_bucati_evenimente SET motiv = 'x'$$, 'doar-adaug');
SELECT teste.eroare('T5t registru: DELETE mișcare → refuz', $$DELETE FROM public.magazie_bucati_miscari$$, 'doar-adaug');
SELECT teste.eroare('T5u registru: TRUNCATE evenimente → refuz', $$TRUNCATE public.magazie_bucati_evenimente CASCADE$$, 'TRUNCATE');
SELECT teste.eroare('T5v registru: INSERT direct (postgres) → garda', $$INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, server_ver) VALUES ('gasit', 3, 1)$$, 'doar prin funcțiile registrului');
SELECT teste.eroare('T5w izo_importuri: UPDATE direct → garda', $$UPDATE public.izo_importuri SET stare = 'stornat'$$, 'doar prin funcțiile registrului');
SELECT teste.eroare('T5y coloanele registrului pe un rând gazpet (perete_mm) → CHECK doar_registru', $$UPDATE public.magazie_bucati SET perete_mm = 7.1 WHERE serie = 'GZP1'$$, 'magazie_bucati_izo_doar_registru_check');
SELECT teste.eroare('T5z locul exclusiv: bucată pe tronson cu depozit_id → CHECK loc', $q$DO $d$ BEGIN SET LOCAL ROLE izo_registru_writer; PERFORM set_config('izo.registru_tx', txid_current()::text, true); UPDATE public.magazie_bucati SET depozit_id = 10 WHERE serie = '247EK08603'; END $d$$q$, 'magazie_bucati_izo_loc_check');
SELECT teste.e('T5x după toate încercările: registrul neschimbat', (SELECT count(*) FROM public.magazie_bucati WHERE tip_cod IS NOT NULL) = 4
  AND (SELECT count(*) FROM public.magazie_bucati WHERE observatii = 'x') = 0 AND (SELECT count(*) FROM public.magazie_bucati_evenimente) = 1);

-- ═══ T6 regresie pozitivă ═══
SELECT teste.ca(:'JANETA');
SELECT teste.e('T6a producția gazpet pe proiectul 3: INSERT', teste.n($$INSERT INTO public.magazie_bucati (proiect_id, tip_material_id, serie, provenienta, stare) VALUES (3, 16, 'PROD1', 'gazpet', 'sosit')$$) = 1);
SELECT teste.e('T6b producția gazpet pe proiectul 3: UPDATE + DELETE', teste.n($$UPDATE public.magazie_bucati SET observatii = 'ok' WHERE serie = 'PROD1'$$) = 1
  AND teste.n($$DELETE FROM public.magazie_bucati WHERE serie = 'PROD1'$$) = 1);
SELECT teste.e('T6c recepția beneficiar pe LOT 1 (off): INSERT + UPDATE', teste.n($$INSERT INTO public.magazie_bucati (proiect_id, tip_material_id, serie, provenienta, stare, locatie_tip) VALUES (1, 1, '254CA00002', 'beneficiar', 'sosit', 'proiect')$$) = 1
  AND teste.n($$UPDATE public.magazie_bucati SET stare = 'receptionat' WHERE serie = '254CA00002'$$) = 1);
SELECT teste.eroare('T6d stările noi nu sunt permise pe gazpet', $$INSERT INTO public.magazie_bucati (proiect_id, tip_material_id, serie, provenienta, stare) VALUES (1, 1, 'G9', 'gazpet', 'pe_tronson')$$, 'magazie_bucati_stare_check');
SELECT teste.eroare('T6e locația „tronson” nu e permisă pe gazpet', $$INSERT INTO public.magazie_bucati (proiect_id, tip_material_id, serie, provenienta, locatie_tip) VALUES (1, 1, 'G10', 'gazpet', 'tronson')$$, 'violates check constraint');
SELECT teste.e('T6e2 locatie_tip_check: depozit/tronson doar pe beneficiar', (SELECT pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conname = 'magazie_bucati_locatie_tip_check') ~ 'provenienta = ''beneficiar''.*depozit.*tronson');
SELECT teste.e('T6f fără atribuire: 0 rânduri din registru, rândurile gazpet / LOT 1 vizibile ca azi (decizia A)',
  (SELECT count(*) FROM public.magazie_bucati WHERE tip_cod IS NOT NULL) = 0 AND (SELECT count(*) FROM public.magazie_bucati WHERE provenienta = 'gazpet') >= 18
  AND (SELECT count(*) FROM public.magazie_bucati WHERE serie = '254CA00001') = 1);
RESET ROLE;

-- ═══ T7 căile 3 și 9 ═══
SELECT id AS id_reg FROM public.magazie_bucati WHERE serie = '254CA09771' \gset
SELECT teste.ca(:'TOMA');
BEGIN;
SELECT teste.e('T7a sub 2c: rand nelegat permis la stoc', teste.n($$DELETE FROM public.executie_tevi WHERE pachet_id = 2$$) = 1);
ROLLBACK;
SELECT teste.e('T7b DELETE pe executie_tevi a LOT 1 → merge', teste.n($$DELETE FROM public.executie_tevi WHERE serie_unica = 'X2'$$) = 1);
-- id-ul îl dă testul (clientul fără atribuire nu vede rândul, dar îl poate trimite direct)
SELECT teste.eroare('T7c bon cu bucată din registru (id trimis direct) → refuz', format($f$INSERT INTO public.executie_bonuri_consum_linii (bon_id, magazie_bucata_id, denumire) VALUES (1, %s, 'teava')$f$, :id_reg), 'nu intră pe bon');
BEGIN;
SELECT teste.e('T7f sub 2c: rand nelegat permis la stoc', teste.n($$UPDATE public.executie_tevi SET pachet_id = 1 WHERE serie_unica = 'Y1'$$) = 1);
ROLLBACK;
BEGIN;
SELECT teste.e('T7g sub 2c: rand nelegat permis la stoc', teste.n($$UPDATE public.executie_tevi SET pachet_id = 2 WHERE serie_unica = 'X1'$$) = 1);
ROLLBACK;
SELECT teste.eroare('T7h pachet LOT 2 mutat pe LOT 1 → refuz', $$UPDATE public.executie_pachete_lansare SET proiect_id = 1, tronson_id = 8 WHERE id = 2$$, 'nu se mută între proiecte');
SELECT teste.eroare('T7i pachet LOT 1 mutat pe un tronson LOT 2 → refuz', $$UPDATE public.executie_pachete_lansare SET proiect_id = NULL, tronson_id = 18 WHERE id = 1$$, 'nu se mută între proiecte');
SELECT teste.e('T7j pachet LOT 1 mutat pe alt tronson LOT 1 → merge', teste.n($$UPDATE public.executie_pachete_lansare SET tronson_id = 9 WHERE id = 1$$) = 1);
SELECT teste.eroare('T7k tronson LOT 2 mutat pe LOT 1 → refuz', $$UPDATE public.executie_tronsoane SET proiect_id = 1 WHERE id = 18$$, 'nu se mută între proiecte');
SELECT teste.eroare('T7l depozitul 11 (în registru) mutat pe alt site → refuz', $$UPDATE public.logistica_depozite SET site_id = 4 WHERE id = 11$$, 'site-ul lui nu se schimbă');
SELECT teste.e('T7m depozitul 11: alte coloane se schimbă normal', teste.n($$UPDATE public.logistica_depozite SET adresa = 'Topleț' WHERE id = 11$$) = 1);
SELECT teste.eroare('T7n pachet nou cu proiectul 1 + tronson al proiectului 3 → neconcordanță', $$INSERT INTO public.executie_pachete_lansare (proiect_id, tronson_id) VALUES (1, 18)$$, 'neconcordanță');
SELECT teste.eroare('T7o pachet LOT 1 legat de un tronson LOT 2 (proiectul rămâne 1) → refuz', $$UPDATE public.executie_pachete_lansare SET tronson_id = 18 WHERE id = 1$$, 'neconcordanță');
SELECT teste.e('T7p pachet nou concordant pe LOT 2 → merge', teste.n($$INSERT INTO public.executie_pachete_lansare (proiect_id, tronson_id) VALUES (3, 19)$$) = 1);
SELECT teste.eroare('T7q site-ul proiectului 3 (cu registru) → refuz', $$UPDATE public.executie_proiecte SET site_id = 4 WHERE id = 3$$, 'site-ul proiectului nu se schimbă');
SELECT teste.e('T7r site-ul proiectului 1 (off) se schimbă normal', teste.n($$UPDATE public.executie_proiecte SET site_id = 5 WHERE id = 1$$) = 1
  AND teste.n($$UPDATE public.executie_proiecte SET site_id = 4 WHERE id = 1$$) = 1);
SELECT teste.eroare('T7s depozitul 10 (doar origine a unei bucăți pe tronson) mutat pe alt site → refuz', $$UPDATE public.logistica_depozite SET site_id = 4 WHERE id = 10$$, 'site-ul lui nu se schimbă');
SELECT teste.eroare('T7t depozitul 10 (doar origine) șters → refuz', $$DELETE FROM public.logistica_depozite WHERE id = 10$$, 'nu se șterge');
SELECT teste.eroare('T7u depozitul 10 renumerotat → refuz', $$UPDATE public.logistica_depozite SET id = 99 WHERE id = 10$$, 'nu se renumerotează');
SELECT teste.eroare('T7v tronson al proiectului 3 (cu registru) șters → refuz', $$DELETE FROM public.executie_tronsoane WHERE id = 22$$, 'nu se șterg');
SELECT teste.e('T7w tronson LOT 1 (off, fără pachete) șters → merge', teste.n($$DELETE FROM public.executie_tronsoane WHERE id = 11$$) = 1);
SELECT teste.e('T7d bon cu bucată beneficiar LOT 1 → merge', teste.n($$INSERT INTO public.executie_bonuri_consum_linii (bon_id, magazie_bucata_id, denumire) SELECT 2, id, 'teava' FROM public.magazie_bucati WHERE serie = '254CA00001'$$) = 1);
RESET ROLE;
SELECT teste.eroare('T7x TRUNCATE executie_tevi CASCADE cu pachete pe un proiect cu registru → refuz (gardă, nu doar FK)', $$TRUNCATE public.executie_tevi CASCADE$$, 'e refuzat');
SELECT teste.eroare('T7y TRUNCATE executie_pachete_lansare CASCADE → refuz', $$TRUNCATE public.executie_pachete_lansare CASCADE$$, 'e refuzat');
SELECT teste.e('T7z gărzile TRUNCATE ale căilor vechi sunt instalate și ENABLE ALWAYS', (SELECT count(*) FROM pg_trigger
  WHERE tgname IN ('trg_executie_tevi_izo_truncate','trg_pachete_izo_truncate') AND tgenabled = 'A') = 2);
BEGIN;
SELECT teste.e('T7e sub 2c: rand nelegat permis la stoc', teste.n($$DELETE FROM public.executie_pachete_lansare WHERE id = 2$$) = 1);
ROLLBACK;

-- ═══ T8 citire și acces ═══
SELECT teste.ca(:'FARA');
SELECT teste.e('T8a fără acces: nu vede importurile / evenimentele', (SELECT count(*) FROM public.izo_importuri) = 0 AND (SELECT count(*) FROM public.magazie_bucati_evenimente) = 0);
RESET ROLE;
SELECT teste.ca(:'JANETA');
SELECT teste.e('T8a2 modulul magazie singur NU dă citire pe registru (review #806 C)', (SELECT count(*) FROM public.izo_importuri) = 0 AND (SELECT count(*) FROM public.magazie_bucati_evenimente) = 0);
RESET ROLE;
INSERT INTO public.izo_atribuiri (proiect_id, profile_id, rol, depozit_id, acordat_de, motiv) VALUES (3, :'JANETA', 'gestionar', 9, 'test', 'test E2a');
SELECT teste.ca(:'JANETA');
SELECT teste.e('T8b gestionar cu atribuire pe proiectul 3: vede importul, evenimentul și bucățile din registru', (SELECT count(*) FROM public.izo_importuri) = 1
  AND (SELECT count(*) FROM public.magazie_bucati_evenimente) = 1 AND (SELECT count(*) FROM public.magazie_bucati WHERE tip_cod IS NOT NULL) = 4);
SELECT teste.e('T8c fn_izo_proiecte_protejate: proiectul 3, site 6', (SELECT array_agg(proiect_id) FROM public.fn_izo_proiecte_protejate()) = ARRAY[3::bigint]
  AND (SELECT site_id FROM public.fn_izo_proiecte_protejate()) = 6);
RESET ROLE;
CREATE FUNCTION teste.acces_ca(p_uid uuid, p_cheie text, p_nivel text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
  SET LOCAL ROLE izo_registru_writer;
  v := public.fn_izo_acces(3, p_cheie, p_nivel);
  RESET ROLE;
  RETURN v;
END $$;
SELECT teste.e('T8d fn_izo_acces: owner da; editor executie da; viewer la nivel editor nu; fără uid nu',
  teste.acces_ca(:'RAZVAN', 'executie', 'admin') AND teste.acces_ca(:'TOMA', 'executie', 'editor')
  AND NOT teste.acces_ca(:'TITI', 'executie', 'editor') AND teste.acces_ca(:'TITI', 'executie', 'viewer')
  AND NOT teste.acces_ca(:'JANETA', 'executie', 'viewer'));
-- valabilitatea atribuirii la citire: expirată și viitoare nu dau acces; cea curentă da
INSERT INTO public.izo_atribuiri (proiect_id, profile_id, rol, valabil_de, valabil_pana, acordat_de, motiv)
VALUES (3, :'FARA', 'rts_rte', current_date - 30, current_date - 1, 'test', 'expirată'),
       (3, :'FARA', 'manager_aprobator', current_date + 1, NULL, 'test', 'viitoare');
SELECT teste.ca(:'FARA');
SELECT teste.e('T8e atribuire expirată / viitoare → fără citire (importuri, evenimente, bucățile registrului)', (SELECT count(*) FROM public.izo_importuri) = 0
  AND (SELECT count(*) FROM public.magazie_bucati_evenimente) = 0 AND (SELECT count(*) FROM public.magazie_bucati WHERE tip_cod IS NOT NULL) = 0);
RESET ROLE;
INSERT INTO public.izo_atribuiri (proiect_id, profile_id, rol, acordat_de, motiv) VALUES (1, :'TITI', 'inginer_izometrie', 'test', 'alt proiect');
SELECT teste.ca(:'TITI');
SELECT teste.e('T8e2 atribuire pe ALT proiect (1) → 0 bucăți din registrul proiectului 3', (SELECT count(*) FROM public.magazie_bucati WHERE tip_cod IS NOT NULL) = 0
  AND (SELECT count(*) FROM public.izo_importuri) = 0);
RESET ROLE;
INSERT INTO public.izo_atribuiri (proiect_id, profile_id, rol, acordat_de, motiv) VALUES (3, :'FARA', 'inginer_izometrie', 'test', 'curentă');
SELECT teste.ca(:'FARA');
SELECT teste.e('T8f atribuire curentă → citire', (SELECT count(*) FROM public.izo_importuri) = 1);
SELECT teste.e('T8f2 atribuirea pe proiectul 3 nu dă citire pe alt proiect', public.fn_izo_citire(1) = false AND public.fn_izo_citire(3) = true);
RESET ROLE;
-- atribuirile: fără DELETE/TRUNCATE (nici postgres), scrise doar de postgres
SELECT teste.eroare('T8g atribuiri: DELETE → refuz', $$DELETE FROM public.izo_atribuiri WHERE rol = 'rts_rte'$$, 'nu se șterg');
SELECT teste.eroare('T8h atribuiri: TRUNCATE → refuz', $$TRUNCATE public.izo_atribuiri$$, 'nu se șterg');
CREATE ROLE izo_test_admin NOLOGIN;
GRANT izo_test_admin TO CURRENT_USER WITH SET TRUE;   -- PG16+: creatorul non-superuser primește doar ADMIN (fără SET) — branch PG17
GRANT USAGE ON SCHEMA public TO izo_test_admin;
GRANT INSERT, UPDATE ON public.izo_atribuiri TO izo_test_admin;
SELECT teste.eroare('T8i atribuiri: INSERT de alt rol decât postgres (cu drept de tabelă) → refuz',
  $q$DO $d$ BEGIN SET LOCAL ROLE izo_test_admin; INSERT INTO public.izo_atribuiri (proiect_id, profile_id, rol, acordat_de, motiv) VALUES (3, '00000000-0000-0000-0000-000000000117', 'inginer_izometrie', 'x', 'test'); END $d$$q$, 'doar de owner');
DROP OWNED BY izo_test_admin;
DROP ROLE izo_test_admin;

-- ═══ T9 storno ═══
SELECT teste.e('T9a import imp-2 (1 țeavă)', (public.fn_izo_import_sold_initial(3, 'imp-2', (SELECT p FROM payload WHERE nume = 'imp2'))->>'bucati')::int = 1);
SELECT teste.eroare('T9b storno fără motiv → refuz', $$SELECT public.fn_izo_import_storno(3, 'imp-2', '')$$, 'motivul');
SELECT teste.e('T9c storno imp-2 (fără evenimente ulterioare)', (public.fn_izo_import_storno(3, 'imp-2', 'test storno')->>'bucati_anulate')::int = 1);
SELECT teste.e('T9c2 bucata anulata, importul stornat, eveniment storno legat',
  (SELECT stare FROM public.magazie_bucati WHERE serie = '254CA08543') = 'anulata'
  AND (SELECT stare FROM public.izo_importuri WHERE import_id = 'imp-2') = 'stornat'
  AND (SELECT count(*) FROM public.magazie_bucati_evenimente WHERE tip = 'storno' AND import_id = 'imp-2') = 1);
SELECT teste.eroare('T9d storno de două ori → refuz', $$SELECT public.fn_izo_import_storno(3, 'imp-2', 'iar')$$, 'deja');
SELECT teste.e('T9e re-import cu altă lungime după storno (indexurile exclud anulata)', (public.fn_izo_import_sold_initial(3, 'imp-2b', (SELECT p FROM payload WHERE nume = 'imp2b'))->>'bucati')::int = 1);
-- un eveniment ulterior pe o bucată din imp-1, scris ca writer cu marcaj (simulează o ieșire)
DO $d$ DECLARE v_ev bigint; BEGIN
  SET LOCAL ROLE izo_registru_writer; PERFORM set_config('izo.registru_tx', txid_current()::text, true);
  INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, server_ver) VALUES ('iesire_tranzit', 3, nextval('public.izo_server_ver_seq')) RETURNING id INTO v_ev;
  INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, server_ver)
  SELECT v_ev, 3, id, 'mutat', nextval('public.izo_server_ver_seq') FROM public.magazie_bucati WHERE serie = '264DB00500';
END $d$;
SELECT teste.eroare('T9f storno imp-1 după un eveniment ulterior → refuz (fail-closed)', $$SELECT public.fn_izo_import_storno(3, 'imp-1', 'test')$$, 'miscari ulterioare');
SELECT teste.e('T9g imp-1 neatins după refuz', (SELECT count(*) FROM public.magazie_bucati m JOIN public.magazie_bucati_miscari x ON x.bucata_id = m.id
   JOIN public.izo_importuri i ON i.eveniment_id = x.eveniment_id WHERE i.import_id = 'imp-1' AND m.stare <> 'anulata') = 4);

-- ═══ T10 nivelul nu coboară cu registrul plin ═══
SELECT teste.eroare('T10a stoc → off cu fapte în registru → refuz', $$SELECT public.fn_izo_seteaza_nivel(3, 'off', 'test')$$, 'fapte în registru');

-- ═══ T11 porțile verificate la activare (proiectul 2, rămâne off) ═══
SELECT teste.e('T11a porțile complete', cardinality(public.fn_izo_porti_lipsa()) = 0);
ALTER TABLE public.executie_tevi ENABLE TRIGGER trg_executie_tevi_izo_delete;   -- 'O': nu mai trage sub replica
SELECT teste.eroare('T11b trigger coborât din ALWAYS → activarea refuzată', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'trg_executie_tevi_izo_delete');
ALTER TABLE public.executie_tevi ENABLE ALWAYS TRIGGER trg_executie_tevi_izo_delete;
ALTER TABLE public.izo_importuri DISABLE ROW LEVEL SECURITY;
SELECT teste.eroare('T11c RLS oprit pe izo_importuri → activarea refuzată', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'RLS inactiv pe izo_importuri');
ALTER TABLE public.izo_importuri ENABLE ROW LEVEL SECURITY;
SET ROLE izo_registru_writer;   -- ACL-ul funcțiilor registrului îl schimbă doar owner-ul (postgres nu e superuser pe Supabase)
GRANT EXECUTE ON FUNCTION public.fn_izo_import_storno(bigint, text, text) TO authenticated;
RESET ROLE;
SELECT teste.eroare('T11d funcție a registrului executabilă din API → activarea refuzată', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'EXECUTE din API');
SET ROLE izo_registru_writer;
REVOKE EXECUTE ON FUNCTION public.fn_izo_import_storno(bigint, text, text) FROM authenticated;
RESET ROLE;
GRANT TRUNCATE ON public.magazie_bucati TO service_role;
SELECT teste.eroare('T11f TRUNCATE pe magazie_bucati pentru service_role → activarea refuzată', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'TRUNCATE pe magazie_bucati');
REVOKE TRUNCATE ON public.magazie_bucati FROM service_role;
ALTER POLICY magbuc_izo_client_upd ON public.magazie_bucati USING (true);
SELECT teste.eroare('T11g politică slăbită (același nume) → activarea refuzată pe definiții', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'definițiile porților');
SELECT teste.eroare('T11h reapelul pe un proiect deja „stoc” verifică și el porțile', $$SELECT public.fn_izo_seteaza_nivel(3, 'stoc', 'test')$$, 'definițiile porților');
ALTER POLICY magbuc_izo_client_upd ON public.magazie_bucati USING (NOT ((provenienta = 'beneficiar'::text) AND (public.fn_izo_nivel(proiect_id) <> 'off'::text)));
SELECT teste.e('T11e porțile refăcute (inclusiv definițiile); proiectul 2 a rămas off', cardinality(public.fn_izo_porti_lipsa()) = 0 AND public.fn_izo_nivel(2) = 'off');
SELECT teste.e('T11j lock-ul partajat, lookup-urile gărzilor și funcția combinată nu sunt executabile din API (r3)',
  NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) a(n)
               WHERE p.pronamespace = 'public'::regnamespace
                 AND p.proname IN ('fn_izo_lock_partajat','fn_izo_proiecte_pachet','fn_izo_proiecte_site','fn_izo_bucata_proiect',
                                   'fn_izo_proiect_tronson','fn_izo_vreun_protejat','fn_izo_depozit_in_registru',
                                   'fn_izo_pachete_neconcordante','fn_izo_activeaza_si_importa')
                 AND has_function_privilege(a.n, p.oid, 'EXECUTE')));
SELECT teste.e('T11k gărzile căilor vechi sunt DEFINER (owner postgres)', (SELECT bool_and(prosecdef AND pg_get_userbyid(proowner) = 'postgres') FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\_izo\_refuz\_%') AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\_izo\_refuz\_%') = 9);
SELECT teste.e('T11i niciun rol API nu are TRUNCATE pe magazie_bucati', NOT has_table_privilege('service_role', 'public.magazie_bucati', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.magazie_bucati', 'TRUNCATE') AND NOT has_table_privilege('anon', 'public.magazie_bucati', 'TRUNCATE'));

-- ═══ T12 activare + import (r3) ═══
SELECT teste.eroare('T12a activare, apoi import în aceeași tranzacție, pe căi separate → refuz (doar prin funcția combinată)',
  $q$DO $d$ BEGIN PERFORM public.fn_izo_seteaza_nivel(2, 'stoc', 'test'); PERFORM public.fn_izo_import_sold_initial(2, 'r3-sep', (SELECT p FROM payload WHERE nume = 'imp2')); END $d$$q$,
  'fn_izo_activeaza_si_importa');
SELECT teste.e('T12a2 proiectul 2 a rămas off', public.fn_izo_nivel(2) = 'off');
INSERT INTO public.executie_pachete_lansare (proiect_id, tronson_id) VALUES (2, 1);   -- ambele off: permis
SELECT teste.eroare('T12b activare cu un pachet neconcordant (proiectul 2 pe un tronson al proiectului 1) → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'neconcordante');
DELETE FROM public.executie_pachete_lansare WHERE proiect_id = 2 AND tronson_id = 1;
SELECT teste.eroare('T12d funcția combinată după o activare în aceeași tranzacție → refuz (lock deja ținut)',
  $q$DO $d$ BEGIN PERFORM public.fn_izo_seteaza_nivel(2, 'stoc', 'test'); PERFORM public.fn_izo_activeaza_si_importa(2, 'r5-comb', (SELECT p FROM payload WHERE nume = 'imp2'), 'test'); END $d$$q$,
  'tranzacție curată');
REVOKE UPDATE ON public.izo_importuri FROM izo_registru_writer;
SELECT teste.eroare('T12e writer-ului îi lipsește UN drept (UPDATE pe izo_importuri) → activarea refuzată', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'drepturile writer-ului');
GRANT UPDATE ON public.izo_importuri TO izo_registru_writer;
SELECT teste.e('T12f drepturile refăcute: porțile complete', cardinality(public.fn_izo_porti_lipsa()) = 0);
ALTER TABLE public.magazie_bucati DROP CONSTRAINT magazie_bucati_depozit_id_fkey,
  ADD CONSTRAINT magazie_bucati_depozit_id_fkey FOREIGN KEY (depozit_id) REFERENCES public.logistica_depozite(id) ON DELETE CASCADE;
SELECT teste.eroare('T12g FK-ul depozitului slăbit (ON DELETE CASCADE) → activarea refuzată pe definiții', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'definițiile porților');
ALTER TABLE public.magazie_bucati DROP CONSTRAINT magazie_bucati_depozit_id_fkey,
  ADD CONSTRAINT magazie_bucati_depozit_id_fkey FOREIGN KEY (depozit_id) REFERENCES public.logistica_depozite(id) ON DELETE RESTRICT;
ALTER TABLE public.magazie_bucati DROP CONSTRAINT magazie_bucati_izo_doar_registru_check;
SELECT teste.eroare('T12h CHECK-ul doar_registru scos → activarea refuzată pe definiții', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'definițiile porților');
ALTER TABLE public.magazie_bucati ADD CONSTRAINT magazie_bucati_izo_doar_registru_check CHECK (
    tip_cod IS NOT NULL OR (uid IS NULL AND parinte_id IS NULL AND radacina_id IS NULL AND cod_bucata IS NULL
      AND capat_stanga IS NULL AND capat_dreapta IS NULL AND dezambiguare IS NULL AND lungime_aviz_mm IS NULL
      AND lungime_masurata_mm IS NULL AND lungime_mm IS NULL AND lungime_calculata = false AND perete_mm IS NULL
      AND diametru_mm IS NULL AND lot IS NULL AND aviz_intrare_id IS NULL AND nr_crt_aviz IS NULL AND bend_no IS NULL
      AND capat_marcaj IS NULL AND depozit_id IS NULL AND tronson_id IS NULL AND server_ver IS NULL));
CREATE FUNCTION teste.wrapper_activare(p bigint) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT public.fn_izo_seteaza_nivel(p, 'stoc', 'wrapper') $$;
SELECT teste.eroare('T12i o funcție nerevizuită care cheamă funcțiile registrului → porțile refuză', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'wrapper nerevizuit');
DROP FUNCTION teste.wrapper_activare(bigint);
CREATE FUNCTION teste.wrapper_majuscule(p bigint) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT PUBLIC.FN_IZO_SETEAZA_NIVEL(p, 'stoc', 'wrapper') $$;
SELECT teste.eroare('T12i2 wrapper cu MAJUSCULE → porțile îl prind (N3)', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'wrapper nerevizuit');
DROP FUNCTION teste.wrapper_majuscule(bigint);
CREATE FUNCTION teste.wrapper_atomic(p bigint) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public
BEGIN ATOMIC
  SELECT public.fn_izo_seteaza_nivel(p, 'stoc', 'wrapper');
END;
SELECT teste.eroare('T12i3 wrapper BEGIN ATOMIC (corpul în prosqlbody, prosrc gol) → porțile îl prind', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'wrapper nerevizuit');
DROP FUNCTION teste.wrapper_atomic(bigint);
CREATE ROLE izo_test_exec NOLOGIN;
SET ROLE izo_registru_writer;
GRANT EXECUTE ON FUNCTION public.fn_izo_import_storno(bigint, text, text) TO izo_test_exec;
RESET ROLE;
SELECT teste.eroare('T12k EXECUTE pe o funcție a registrului pentru un rol din afara allowlist-ului → porțile refuză', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'allowlist');
SET ROLE izo_registru_writer;
REVOKE EXECUTE ON FUNCTION public.fn_izo_import_storno(bigint, text, text) FROM izo_test_exec;
RESET ROLE;
DROP ROLE izo_test_exec;
SELECT teste.e('T12j porțile refăcute după FK / CHECK / wrapper / allowlist', cardinality(public.fn_izo_porti_lipsa()) = 0);
-- ═══ T13 citirile nerevizuite (acțiunea 6): view cu drepturile ownerului, DEFINER care citește, tranzitiv, SQL dinamic ═══
CREATE VIEW teste.v_citire AS SELECT b.id, b.serie FROM public.magazie_bucati b;
SELECT teste.eroare('T13a view fără security_invoker peste registru → activarea refuzată', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'fără security_invoker');
CREATE VIEW teste.v_citire2 AS SELECT * FROM teste.v_citire;
ALTER VIEW teste.v_citire SET (security_invoker = true);
SELECT teste.eroare('T13a2 view peste view (tranzitiv), fără security_invoker → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'fără security_invoker');
ALTER VIEW teste.v_citire2 SET (security_invoker = true);
SELECT teste.e('T13a3 view-urile cu security_invoker → porțile complete', cardinality(public.fn_izo_porti_lipsa()) = 0);
DROP VIEW teste.v_citire2; DROP VIEW teste.v_citire;
CREATE FUNCTION teste.f_citire_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT count(*) FROM public.magazie_bucati $$;
SELECT teste.eroare('T13b funcție DEFINER din afara registrului care citește registrul → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION teste.f_citire_def();
CREATE FUNCTION teste.f_citire_inv() RETURNS bigint LANGUAGE sql SET search_path = public AS $$ SELECT count(*) FROM public.magazie_bucati $$;
SELECT teste.e('T13c funcție INVOKER care citește registrul, nechemată de DEFINER → porțile complete', cardinality(public.fn_izo_porti_lipsa()) = 0);
CREATE FUNCTION teste.f_citire_def2() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT teste.f_citire_inv() $$;
SELECT teste.eroare('T13c2 DEFINER care cheamă funcția INVOKER (tranzitiv) → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'tranzitiv');
DROP FUNCTION teste.f_citire_def2(); DROP FUNCTION teste.f_citire_inv();
CREATE FUNCTION public.f_citire_dinamica(p_t text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint; BEGIN EXECUTE format('SELECT count(*) FROM %I', p_t) INTO n; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.f_citire_dinamica(text) TO authenticated;
SELECT teste.eroare('T13d DEFINER cu SQL dinamic (format) → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION public.f_citire_dinamica(text);
-- r12: lanț DEFINER → INVOKER → INVOKER; DEFINER peste un view security_invoker; EXECUTE fără format / ||
CREATE FUNCTION teste.f_lant2() RETURNS bigint LANGUAGE sql SET search_path = public AS $$ SELECT count(*) FROM public.magazie_bucati $$;
CREATE FUNCTION teste.f_lant1() RETURNS bigint LANGUAGE sql SET search_path = public AS $$ SELECT teste.f_lant2() $$;
SELECT teste.e('T13f0 lanț INVOKER → INVOKER fără DEFINER → porțile complete', cardinality(public.fn_izo_porti_lipsa()) = 0);
CREATE FUNCTION teste.f_lant0() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT teste.f_lant1() $$;
SELECT teste.eroare('T13f lanț DEFINER → INVOKER → INVOKER → registru → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION teste.f_lant0(); DROP FUNCTION teste.f_lant1(); DROP FUNCTION teste.f_lant2();
CREATE VIEW teste.v_reg WITH (security_invoker = true) AS SELECT b.id FROM public.magazie_bucati b;
SELECT teste.e('T13g0 view security_invoker singur → porțile complete', cardinality(public.fn_izo_porti_lipsa()) = 0);
CREATE FUNCTION teste.leak() RETURNS SETOF bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT id FROM teste.v_reg $$;
SELECT teste.eroare('T13g DEFINER care citește un view security_invoker al registrului → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION teste.leak(); DROP VIEW teste.v_reg;
CREATE FUNCTION teste.f_exec(p_sql text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN EXECUTE p_sql; END $$;
SELECT teste.eroare('T13h DEFINER cu EXECUTE p_sql (fără format / ||), neexpus → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION teste.f_exec(text);
CREATE FUNCTION teste.f_exec_inv(p_sql text) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$ BEGIN EXECUTE p_sql; END $$;
CREATE FUNCTION teste.f_exec_def() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT teste.f_exec_inv('SELECT 1') $$;
SELECT teste.eroare('T13h2 DEFINER → INVOKER cu SQL dinamic → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION teste.f_exec_def(); DROP FUNCTION teste.f_exec_inv(text);
-- r13 (Jak r12 P2): apel NECALIFICAT rezolvat prin search_path-ul funcției DEFINER; identificator CITAT
CREATE FUNCTION teste.f_ns() RETURNS bigint LANGUAGE sql SET search_path = public AS $$ SELECT count(*) FROM public.magazie_bucati $$;
CREATE FUNCTION public.f_ns_def() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = teste, public AS $$ SELECT f_ns() $$;
SELECT teste.eroare('T13i DEFINER cu search_path = teste, public care cheamă f_ns() necalificat → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION public.f_ns_def();
CREATE FUNCTION public.f_ns_def2() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT "teste".f_ns() $$;
SELECT teste.eroare('T13j DEFINER care cheamă "teste".f_ns() (identificator citat) → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION public.f_ns_def2();
CREATE FUNCTION public.f_ns_def3() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT 1 + 0 /* f_ns */ $$;
SELECT teste.eroare('T13k DEFINER (search_path = public) care numește f_ns necalificat, din altă schemă → refuz conservator', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION public.f_ns_def3(); DROP FUNCTION teste.f_ns();
-- exemplul Copilot r12: view security_invoker într-o altă schemă + DEFINER cu search_path care îl include, citit necalificat
CREATE VIEW teste.v_reg2 WITH (security_invoker = true) AS SELECT b.id FROM public.magazie_bucati b;
CREATE FUNCTION public.leak2() RETURNS SETOF bigint LANGUAGE sql SECURITY DEFINER SET search_path = teste, public AS $$ SELECT id FROM v_reg2 $$;
SELECT teste.eroare('T13l DEFINER (search_path = teste, public) care citește necalificat teste.v_reg2 (invoker) → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION public.leak2(); DROP VIEW teste.v_reg2;
-- r14 (Jakarinos + Copilot r13): calea de căutare NECUNOSCUTĂ (fără search_path fixat, sau schimbată în corp) → potrivire
-- necalificată conservatoare, inclusiv pentru schemele platformei
DO $s$ BEGIN IF to_regnamespace('extensions') IS NULL THEN CREATE SCHEMA extensions; CREATE TABLE teste.creat_extensions (x int); END IF; END $s$;
CREATE VIEW extensions.r13_v WITH (security_invoker = true) AS SELECT b.id FROM public.magazie_bucati b;
CREATE FUNCTION public.r13_bridge() RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN RETURN (SELECT count(*) FROM r13_v); END $$;
CREATE FUNCTION public.r13_leak() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = extensions, public AS $$ SELECT public.r13_bridge() $$;
SELECT teste.eroare('T13m exemplul Jak: extensions.r13_v (invoker) + bridge INVOKER fără search_path + leak DEFINER → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION public.r13_leak(); DROP FUNCTION public.r13_bridge();
CREATE FUNCTION public.r13_mostenit() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN (SELECT count(*) FROM r13_v); END $$;
SELECT teste.eroare('T13n exemplul Copilot: DEFINER fără search_path propriu (moștenit de la apelant) → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION public.r13_mostenit();
CREATE FUNCTION public.r13_set_config() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM set_config('search_path', 'extensions, public', true); RETURN (SELECT count(*) FROM r13_v); END $$;
SELECT teste.eroare('T13n2 DEFINER cu search_path fixat, dar schimbat în corp prin set_config → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION public.r13_set_config();
CREATE FUNCTION public.r13_fix() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RETURN (SELECT count(*) FROM r13_v); END $$;
SELECT teste.e('T13n3 DEFINER cu search_path = public fixat, nume din schema platformei necalificat → nu e muchie (nu se rezolvă acolo)',
  cardinality(public.fn_izo_porti_lipsa()) = 0);
-- r15 (Jakarinos + Copilot r14): mutatorii de cale — set_config cu argument variabil, helper mutator, mutator tranzitiv
CREATE FUNCTION public.r15_jak() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text := 'search' || '_path'; BEGIN PERFORM set_config(k, 'extensions, public', true); RETURN (SELECT count(*) FROM r13_v); END $$;
SELECT teste.eroare('T13o exemplul Jak: set_config(k, …) cu argument variabil → mutator → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION public.r15_jak();
CREATE FUNCTION public.schimba_calea() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM set_config('search_path', 'extensions, public', true); END $$;
CREATE FUNCTION public.r15_cop() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM schimba_calea(); RETURN (SELECT count(*) FROM r13_v); END $$;
SELECT teste.eroare('T13p exemplul Copilot: DEFINER cu cale fixată care cheamă un helper mutator → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION public.r15_cop();
CREATE FUNCTION public.r15_nivel1() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM schimba_calea(); END $$;
CREATE FUNCTION public.r15_tranz() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM r15_nivel1(); RETURN (SELECT count(*) FROM r13_v); END $$;
SELECT teste.eroare('T13q mutator tranzitiv pe 2 niveluri (DEFINER → nivel1 → schimba_calea) → refuz', $$SELECT public.fn_izo_seteaza_nivel(2, 'stoc', 'test')$$, 'DEFINER din afara registrului');
DROP FUNCTION public.r15_tranz(); DROP FUNCTION public.r15_nivel1(); DROP FUNCTION public.schimba_calea();
SELECT teste.e('T13q2 după curățare: porțile complete', cardinality(public.fn_izo_porti_lipsa()) = 0);
DROP FUNCTION public.r13_fix(); DROP VIEW extensions.r13_v;
DO $s$ BEGIN IF to_regclass('teste.creat_extensions') IS NOT NULL THEN DROP SCHEMA extensions; DROP TABLE teste.creat_extensions; END IF; END $s$;
SELECT teste.e('T13e porțile refăcute după citirile nerevizuite; proiectul 2 a rămas off', cardinality(public.fn_izo_porti_lipsa()) = 0 AND public.fn_izo_nivel(2) = 'off');
SELECT teste.e('T12c după corectare: proiectul 2 off, fără pachete neconcordante', public.fn_izo_nivel(2) = 'off' AND public.fn_izo_pachete_neconcordante(2) = 0);

-- ═══ T13 carantina (review #807 r3) ═══
SELECT teste.e('T4y carantina: import în depozit, stare carantina (nu disponibilă)',
  (public.fn_izo_import_sold_initial(3, 'car-1', '{"surse":[{"fisier":"Q.xlsx","sha256":"5555555555555555555555555555555555555555555555555555555555555555"}],"bucati":[{"tip":"teava","serie":"299QQ00001","sarja":"SA1","lungime_mm":12000,"perete_mm":7.1,"stare":"carantina","depozit_id":11,"sursa":{"fisier":"Q.xlsx","foaie":"F","rand":1}}]}'::jsonb)->>'bucati')::int = 1);
SELECT teste.e('T4y1 bucata în carantină stă în depozitul 11', (SELECT stare || ':' || locatie_tip || ':' || depozit_id FROM public.magazie_bucati WHERE serie = '299QQ00001') = 'carantina:depozit:11');
SELECT teste.eroare('T4y2 carantina doar pe beneficiar (gazpet → CHECK)', $$UPDATE public.magazie_bucati SET stare = 'carantina' WHERE serie = 'GZP1'$$, 'magazie_bucati_stare_check');
SELECT 'TESTE SQL: TOATE OK';

\else
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
  AND NOT has_function_privilege('authenticated', 'public.fn_izo_doc_anuleaza(bigint, text, uuid)', 'EXECUTE')
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
SELECT teste.e('E8e anularea administrativă a documentului confirmat cu PV', (public.fn_izo_doc_anuleaza(:doc1, 'aviz greșit, reintrodus', '00000000-0000-0000-0000-000000000121') ->> 'bucati_anulate')::int = 2);
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

\endif
