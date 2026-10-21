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
SELECT teste.e('T1g amprenta în COMMENT', obj_description('public.magazie_bucati_evenimente'::regclass, 'pg_class') ~ 'amprenta=[0-9a-f]{32}$');
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
SELECT teste.eroare('T7a DELETE pe executie_tevi a LOT 2 → refuz', $$DELETE FROM public.executie_tevi WHERE pachet_id = 2$$, 'nu se șterg din client');
SELECT teste.e('T7b DELETE pe executie_tevi a LOT 1 → merge', teste.n($$DELETE FROM public.executie_tevi WHERE serie_unica = 'X2'$$) = 1);
-- id-ul îl dă testul (clientul fără atribuire nu vede rândul, dar îl poate trimite direct)
SELECT teste.eroare('T7c bon cu bucată din registru (id trimis direct) → refuz', format($f$INSERT INTO public.executie_bonuri_consum_linii (bon_id, magazie_bucata_id, denumire) VALUES (1, %s, 'teava')$f$, :id_reg), 'nu intră pe bon');
SELECT teste.eroare('T7f țeavă LOT 2 mutată pe pachet LOT 1 → refuz', $$UPDATE public.executie_tevi SET pachet_id = 1 WHERE serie_unica = 'Y1'$$, 'nu se mută între pachete');
SELECT teste.eroare('T7g țeavă LOT 1 mutată pe pachet LOT 2 → refuz', $$UPDATE public.executie_tevi SET pachet_id = 2 WHERE serie_unica = 'X1'$$, 'nu se mută între pachete');
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
SELECT teste.eroare('T7e ștergerea pachetului LOT 2 (cascadă pe țevi) → refuz', $$DELETE FROM public.executie_pachete_lansare WHERE id = 2$$, 'nu se șterg din client');

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
SELECT teste.eroare('T9f storno imp-1 după un eveniment ulterior → refuz (fail-closed)', $$SELECT public.fn_izo_import_storno(3, 'imp-1', 'test')$$, 'mișcări ulterioare');
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
SELECT teste.e('T12c după corectare: proiectul 2 off, fără pachete neconcordante', public.fn_izo_nivel(2) = 'off' AND public.fn_izo_pachete_neconcordante(2) = 0);

-- ═══ T13 carantina (review #807 r3) ═══
SELECT teste.e('T4y carantina: import în depozit, stare carantina (nu disponibilă)',
  (public.fn_izo_import_sold_initial(3, 'car-1', '{"surse":[{"fisier":"Q.xlsx","sha256":"5555555555555555555555555555555555555555555555555555555555555555"}],"bucati":[{"tip":"teava","serie":"299QQ00001","sarja":"SA1","lungime_mm":12000,"perete_mm":7.1,"stare":"carantina","depozit_id":11,"sursa":{"fisier":"Q.xlsx","foaie":"F","rand":1}}]}'::jsonb)->>'bucati')::int = 1);
SELECT teste.e('T4y1 bucata în carantină stă în depozitul 11', (SELECT stare || ':' || locatie_tip || ':' || depozit_id FROM public.magazie_bucati WHERE serie = '299QQ00001') = 'carantina:depozit:11');
SELECT teste.eroare('T4y2 carantina doar pe beneficiar (gazpet → CHECK)', $$UPDATE public.magazie_bucati SET stare = 'carantina' WHERE serie = 'GZP1'$$, 'magazie_bucati_stare_check');
SELECT 'TESTE SQL: TOATE OK';
