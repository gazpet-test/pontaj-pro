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
 ('imp1', '{"motiv":"test","surse":[{"fisier":"TOPLET.xlsx","sha256":"1111111111111111111111111111111111111111111111111111111111111111"}],
   "bucati":[
    {"tip":"teava","serie":"254CA09771","sarja":"SA0818","lungime_mm":12280,"perete_mm":7.1,"diametru_mm":610,"stare":"receptionat","depozit_id":11,"izolatie":"PEHD","nr_aviz":"144016","data_aviz":"2026-04-28","sursa":{"fisier":"TOPLET.xlsx","foaie":"TEAVA 7.1 TOPLET","rand":12}},
    {"tip":"teava","serie":"247EK08603","sarja":"SA07348","lungime_mm":12280,"perete_mm":7.1,"diametru_mm":610,"stare":"pe_tronson","tronson_id":21,"depozit_id":10,"sursa":{"fisier":"TOPLET.xlsx","foaie":"TEAVA 7.1 TOPLET","rand":13}},
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
 ('curba_dubla', '{"surse":[{"fisier":"X.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333"}],
   "bucati":[{"tip":"curba","serie":"870","sarja":"2520914","unghi_curba":20,"perete_mm":8,"stare":"sosit","depozit_id":11,"sursa":{"fisier":"X.xlsx","foaie":"C","rand":2}}]}');

-- ═══ T1 catalog ═══
SELECT teste.e('T1a rolul: NOLOGIN, NOINHERIT, fără BYPASSRLS', (SELECT NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolsuper FROM pg_roles WHERE rolname = 'izo_registru_writer'));
SELECT teste.e('T1b doar postgres e membru; fără SET/INHERIT din API',
  (SELECT array_agg(pg_get_userbyid(member)::text) FROM pg_auth_members WHERE roleid = 'izo_registru_writer'::regrole) = ARRAY['postgres']
  AND NOT pg_has_role('authenticated', 'izo_registru_writer', 'MEMBER') AND NOT pg_has_role('anon', 'izo_registru_writer', 'MEMBER')
  AND NOT pg_has_role('service_role', 'izo_registru_writer', 'MEMBER') AND NOT pg_has_role('authenticator', 'izo_registru_writer', 'MEMBER'));
SELECT teste.e('T1c funcțiile writer-ului = lista albă, DEFINER, neexecutabile din API',
  (SELECT array_agg(proname::text ORDER BY proname) FROM pg_proc WHERE proowner = 'izo_registru_writer'::regrole)
    = ARRAY['fn_izo_import_sold_initial','fn_izo_import_storno','fn_izo_seteaza_nivel']
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
          AND count(*) FILTER (WHERE stare = 'pe_tronson' AND locatie_tip = 'tronson' AND tronson_id = 21) = 1
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
SELECT teste.eroare('T6e locația „tronson” nu e permisă pe gazpet', $$INSERT INTO public.magazie_bucati (proiect_id, tip_material_id, serie, provenienta, locatie_tip, tronson_id) VALUES (1, 1, 'G10', 'gazpet', 'tronson', 8)$$, 'magazie_bucati_locatie_tip_check');
SELECT teste.e('T6f authenticated citește bucățile din registru (SELECT neschimbat)', (SELECT count(*) FROM public.magazie_bucati WHERE tip_cod IS NOT NULL) = 4);
RESET ROLE;

-- ═══ T7 căile 3 și 9 ═══
SELECT teste.ca(:'TOMA');
SELECT teste.eroare('T7a DELETE pe executie_tevi a LOT 2 → refuz', $$DELETE FROM public.executie_tevi WHERE pachet_id = 2$$, 'nu se șterg din client');
SELECT teste.e('T7b DELETE pe executie_tevi a LOT 1 → merge', teste.n($$DELETE FROM public.executie_tevi WHERE serie_unica = 'X2'$$) = 1);
SELECT teste.eroare('T7c bon cu bucată din registru → refuz', $$INSERT INTO public.executie_bonuri_consum_linii (bon_id, magazie_bucata_id, denumire) SELECT 1, id, 'teava' FROM public.magazie_bucati WHERE serie = '254CA09771'$$, 'nu intră pe bon');
SELECT teste.e('T7d bon cu bucată beneficiar LOT 1 → merge', teste.n($$INSERT INTO public.executie_bonuri_consum_linii (bon_id, magazie_bucata_id, denumire) SELECT 2, id, 'teava' FROM public.magazie_bucati WHERE serie = '254CA00001'$$) = 1);
RESET ROLE;
SELECT teste.eroare('T7e ștergerea pachetului LOT 2 (cascadă pe țevi) → refuz', $$DELETE FROM public.executie_pachete_lansare WHERE id = 2$$, 'nu se șterg din client');

-- ═══ T8 citire și acces ═══
SELECT teste.ca(:'FARA');
SELECT teste.e('T8a fără acces: nu vede importurile / evenimentele', (SELECT count(*) FROM public.izo_importuri) = 0 AND (SELECT count(*) FROM public.magazie_bucati_evenimente) = 0);
RESET ROLE;
SELECT teste.ca(:'JANETA');
SELECT teste.e('T8b gestionar cu magazie: vede importul și evenimentul', (SELECT count(*) FROM public.izo_importuri) = 1 AND (SELECT count(*) FROM public.magazie_bucati_evenimente) = 1);
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
SELECT teste.eroare('T10a stoc → off cu bucăți în registru → refuz', $$SELECT public.fn_izo_seteaza_nivel(3, 'off', 'test')$$, 'nu coboară');

SELECT 'TESTE SQL: TOATE OK';
