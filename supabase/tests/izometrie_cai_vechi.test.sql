-- Teste SQL pentru 20261102c (căile vechi la nivelul stoc). Rulează DOAR prin scripts/test_izometrie_e2a.sh (pasul 4j), pe
-- baza locală *_test, după 20261102a + testele ei + 20261102b + 20261102c (aplicate prin runner). Rezultatul așteptat e scris
-- dinainte pentru fiecare test. Proiectul 3 = LOT 2 (stoc, cu registru); pachetul 2 = LOT 2 (tronsonul 18), cu țeava Y1;
-- proiectul 1 = LOT 1 (off).
\set ON_ERROR_STOP on
SET client_min_messages = notice;
\set TOMA '00000000-0000-0000-0000-000000000117'

-- ═══ C0 catalog ═══
-- porțile ({}) se verifică în harness (4j), cu helperele dinamice ale testelor ascunse: aici ar da fals-pozitiv
SELECT teste.e('C0b cele 3 gărzi: owner postgres, DEFINER, search_path fix, EXECUTE doar postgres',
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('fn_izo_refuz_delete_tevi','fn_izo_refuz_mutare_tevi','fn_izo_refuz_delete_pachet')
     AND pg_get_userbyid(proowner) = 'postgres' AND prosecdef AND proconfig = ARRAY['search_path=public, pg_temp']
     AND proacl::text = '{postgres=X/postgres}'
     AND NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('service_role', oid, 'EXECUTE')) = 3);
SELECT teste.e('C0c trigger-ele căilor vechi ENABLE ALWAYS', (SELECT count(*) FROM pg_trigger
  WHERE tgname IN ('trg_executie_tevi_izo_delete','trg_executie_tevi_izo_mutare','trg_pachete_izo_delete') AND tgenabled = 'A') = 3);
SELECT teste.e('C0d COMMENT-ul de revenire are amprenta nouă + cea de dinainte',
  obj_description('public.magazie_bucati_evenimente'::regclass, 'pg_class') ~ 'amprenta=[0-9a-f]{32} inainte_20261102c=[0-9a-f]{32}$');

-- ═══ date: rânduri noi pe LOT 2 (stoc) și pe LOT 1 (off), ca Toma (authenticated) ═══
SELECT teste.ca(:'TOMA');
SELECT teste.e('C1a adăugarea pe LOT 2 merge (ca înainte)', teste.n($$INSERT INTO public.executie_tevi (pachet_id, serie_unica, lungime_m)
  VALUES (2, 'C1', 12), (2, 'C2', 12), (2, 'C3', 12), (2, 'C4', 12)$$) = 4);
SELECT teste.e('C1b pachet nou concordant pe LOT 2 (tronsonul 19) + pachet LOT 1 (tronsonul 9)',
  teste.n($$INSERT INTO public.executie_pachete_lansare (id, proiect_id, tronson_id) VALUES (201, 3, 19), (202, 1, 9), (203, 3, 19)$$) = 3);
SELECT teste.e('C1c rânduri în pachetele noi', teste.n($$INSERT INTO public.executie_tevi (pachet_id, serie_unica, lungime_m)
  VALUES (201, 'R1', 12), (201, 'R2', 12), (202, 'L1', 12), (203, 'P1', 12)$$) = 4);

-- ═══ C2 stoc, rânduri nelegate: ștergere / mutare / REPLACE / pachet — merg (decizia A) ═══
SELECT teste.e('C2a DELETE un rând nelegat pe LOT 2 (stoc) → merge', teste.n($$DELETE FROM public.executie_tevi WHERE serie_unica = 'C1'$$) = 1);
SELECT teste.e('C2b DELETE bulk (in) pe LOT 2 → merge', teste.n($$DELETE FROM public.executie_tevi WHERE serie_unica IN ('C2', 'C3')$$) = 2);
SELECT teste.e('C2c import REPLACE (DELETE pe tot pachetul) pe LOT 2 → merge', teste.n($$DELETE FROM public.executie_tevi WHERE pachet_id = 201$$) = 2);
SELECT teste.e('C2d mutarea unui rând între pachete LOT 2 → merge', teste.n($$UPDATE public.executie_tevi SET pachet_id = 201 WHERE serie_unica = 'C4'$$) = 1);
SELECT teste.e('C2e mutarea LOT 2 (stoc) → LOT 1 (off) → merge', teste.n($$UPDATE public.executie_tevi SET pachet_id = 202 WHERE serie_unica = 'C4'$$) = 1);
SELECT teste.e('C2f mutarea LOT 1 (off) → LOT 2 (stoc) → merge', teste.n($$UPDATE public.executie_tevi SET pachet_id = 201 WHERE serie_unica = 'L1'$$) = 1);
SELECT teste.e('C2g ștergerea unui pachet LOT 2 cu rânduri nelegate (cascadă) → merge', teste.n($$DELETE FROM public.executie_pachete_lansare WHERE id = 203$$) = 1);
SELECT teste.e('C2h cascada a șters și rândul pachetului', NOT EXISTS (SELECT 1 FROM public.executie_tevi WHERE serie_unica = 'P1'));
RESET ROLE;

-- ═══ C3 rând legat de o bucată din registru (legătura o pune writer-ul, cu marcaj) ═══
SELECT id AS id_y1 FROM public.executie_tevi WHERE serie_unica = 'Y1' \gset
SELECT id AS id_reg FROM public.magazie_bucati WHERE serie = '254CA09771' \gset
BEGIN;
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx', txid_current()::text, true) IS NOT NULL AS marcaj;
UPDATE public.magazie_bucati SET executie_teava_id = :id_y1 WHERE id = :id_reg;
COMMIT;
SELECT teste.e('C3-pre legătura pusă', (SELECT executie_teava_id FROM public.magazie_bucati WHERE id = :id_reg) = :id_y1);
SELECT teste.ca(:'TOMA');
SELECT teste.eroare('C3a DELETE pe rândul legat → refuz (mesaj clar, nu FK)', $$DELETE FROM public.executie_tevi WHERE serie_unica = 'Y1'$$, 'legat de o bucată din registru');
SELECT teste.eroare('C3b mutarea rândului legat pe alt pachet LOT 2 → refuz', $$UPDATE public.executie_tevi SET pachet_id = 201 WHERE serie_unica = 'Y1'$$, 'nu se mută între pachete');
SELECT teste.eroare('C3c ștergerea pachetului cu un rând legat → refuz', $$DELETE FROM public.executie_pachete_lansare WHERE id = 2$$, 'rânduri legate de registru');
SELECT teste.e('C3d editarea altor câmpuri pe rândul legat → merge (neschimbat)', teste.n($$UPDATE public.executie_tevi SET lungime_m = 12.01 WHERE serie_unica = 'Y1'$$) = 1);
RESET ROLE;
SELECT teste.eroare('C3e nici postgres direct (fără writer + marcaj) nu șterge rândul legat', $$DELETE FROM public.executie_tevi WHERE serie_unica = 'Y1'$$, 'legat de o bucată din registru');

-- ═══ C4 nivelul montaj (setat direct de writer, pe baza de test: fn_izo_seteaza_nivel refuză montaj până la E4a) ═══
BEGIN;
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx', txid_current()::text, true) IS NOT NULL AS marcaj;
UPDATE public.izo_proiect_config SET nivel_izo = 'montaj' WHERE proiect_id = 3;
COMMIT;
SELECT teste.e('C4-pre proiectul 3 la montaj', public.fn_izo_nivel(3) = 'montaj');
SELECT teste.ca(:'TOMA');
SELECT teste.eroare('C4a DELETE pe un rând nelegat LOT 2 la montaj → refuz', $$DELETE FROM public.executie_tevi WHERE serie_unica = 'L1'$$, 'nivelul montaj');
SELECT teste.eroare('C4b mutarea montaj → off → refuz', $$UPDATE public.executie_tevi SET pachet_id = 202 WHERE serie_unica = 'L1'$$, 'nivelul montaj');
SELECT teste.e('C4c-pre rând pe LOT 1 (off)', teste.n($$INSERT INTO public.executie_tevi (pachet_id, serie_unica, lungime_m) VALUES (202, 'L2', 12)$$) = 1);
SELECT teste.eroare('C4c mutarea off → montaj → refuz', $$UPDATE public.executie_tevi SET pachet_id = 201 WHERE serie_unica = 'L2'$$, 'nivelul montaj');
SELECT teste.eroare('C4d ștergerea unui pachet LOT 2 la montaj → refuz', $$DELETE FROM public.executie_pachete_lansare WHERE id = 201$$, 'nivelul montaj');
SELECT teste.e('C4e pe LOT 1 (off) ștergerea merge', teste.n($$DELETE FROM public.executie_tevi WHERE serie_unica = 'L2'$$) = 1);
RESET ROLE;
BEGIN;
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx', txid_current()::text, true) IS NOT NULL AS marcaj;
UPDATE public.izo_proiect_config SET nivel_izo = 'stoc' WHERE proiect_id = 3;
COMMIT;
SELECT teste.e('C4-post proiectul 3 înapoi la stoc', public.fn_izo_nivel(3) = 'stoc');
SELECT teste.ca(:'TOMA');
SELECT teste.e('C4f înapoi la stoc: același rând se șterge', teste.n($$DELETE FROM public.executie_tevi WHERE serie_unica = 'L1'$$) = 1);
RESET ROLE;

-- ═══ C5 ce rămâne blocat la stoc (regresie: neschimbat de 20261102c) ═══
SELECT teste.ca(:'TOMA');
SELECT teste.eroare('C5a pachet LOT 2 mutat pe LOT 1 → refuz', $$UPDATE public.executie_pachete_lansare SET proiect_id = 1, tronson_id = 9 WHERE id = 201$$, 'nu se mută între proiecte');
SELECT teste.eroare('C5b pachet nou neconcordant → refuz', $$INSERT INTO public.executie_pachete_lansare (proiect_id, tronson_id) VALUES (1, 19)$$, 'neconcordanță');
SELECT teste.eroare('C5c tronson LOT 2 șters → refuz', $$DELETE FROM public.executie_tronsoane WHERE id = 23$$, 'nu se șterg');
RESET ROLE;
-- după 20261102b liniile bonului nu se mai scriu din API; garda E2a pe linii se verifică direct, ca postgres (non-writer)
SELECT teste.eroare('C5d linie de bon cu bucată din registru → refuz', format($f$INSERT INTO public.executie_bonuri_consum_linii (bon_id, magazie_bucata_id, denumire) VALUES (1, %s, 'teava')$f$, :id_reg), 'nu intră pe bon');
SELECT teste.eroare('C5e DML în afara writer-ului pe o bucată din registru → refuz', format($f$UPDATE public.magazie_bucati SET observatii = 'x' WHERE id = %s$f$, :id_reg), 'doar prin funcțiile registrului');
SELECT teste.eroare('C5f TRUNCATE pe țevi → refuz', $$TRUNCATE public.executie_tevi CASCADE$$, 'e refuzat');

-- ═══ C6 legătura scoasă → rândul se șterge (dovada că refuzul ținea doar de legătură) ═══
BEGIN;
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx', txid_current()::text, true) IS NOT NULL AS marcaj;
UPDATE public.magazie_bucati SET executie_teava_id = NULL WHERE id = :id_reg;
COMMIT;
SELECT teste.ca(:'TOMA');
SELECT teste.e('C6a fără legătură, Y1 se mută', teste.n($$UPDATE public.executie_tevi SET pachet_id = 201 WHERE serie_unica = 'Y1'$$) = 1);
SELECT teste.e('C6b fără legătură, Y1 se șterge', teste.n($$DELETE FROM public.executie_tevi WHERE serie_unica = 'Y1'$$) = 1);
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'TESTE CAI VECHI: TOATE OK'; END $$;
