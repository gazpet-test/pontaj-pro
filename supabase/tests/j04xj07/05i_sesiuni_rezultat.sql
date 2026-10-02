-- @clona
-- JX-05i · Cerința 5, două sesiuni reale: B (edge J07 rulat din nou, cheia de serviciu) persistă un rezultat „block”
-- pe ACELAȘI hash și face COMMIT între verificarea lui A și tranziția lui A → REFUZ (ultimul rezultat câștigă).
-- @sesiune A
SELECT jx.start('JX-05i', 'două sesiuni: B persistă un rezultat J07 „block” pe același hash și face COMMIT → tranziția lui A REFUZATĂ');
-- @edge j04 1
-- @edge j07 1
:editor
BEGIN;
SELECT jx.egal(jx.blocaje(1), '[]', 'A: poarta OK');
-- @sesiune B
:service
INSERT INTO ofertare_poarta_rezultate_text(control_code, licitatie_id, parser_version, sursa_hash, stare, detalii)
VALUES ('pachet', 1, :'parser_edge', public.ofertare_poarta_text_sursa(1)->>'sursa_hash', 'block', '{"reevaluare":"B"}');
-- @sesiune A
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["pachet"]');
ROLLBACK;
:admin
SELECT jx.ok(jx.stare(1) = 'aprobat', 'pachetul rămâne aprobat');
SELECT jx.trecut('JX-05i');
