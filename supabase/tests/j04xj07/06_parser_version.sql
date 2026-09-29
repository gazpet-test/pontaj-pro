-- JX-06 · Cerința 6: parser_version schimbat cu SURSA NESCHIMBATĂ → verdictul text vechi devine stale → REFUZ.
-- Hash-ul sursei nu e singura dependență a verdictului: rezultatul e legat de (licitație, control, parser_version,
-- sursa_hash). „Deploy” simulat: ofertare_poarta_parser_version() întoarce 'j07-text-v2' (versiunea de pe server).

-- JX-06a ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-06a', 'parser_version nou pe server, sursa identică (același sursa_hash) + J04 PASS → cele 4 rezultate text vechi nu mai contează → REFUZ');
-- @edge j04 1
-- @edge j07 1
:admin
SELECT jx.egal(jx.blocaje(1), '[]', 'verificat cu parserul v1');
CREATE TEMP TABLE h AS SELECT public.ofertare_poarta_text_sursa(1)->>'sursa_hash' AS h0;
CREATE OR REPLACE FUNCTION public.ofertare_poarta_parser_version() RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $f$ SELECT 'j07-text-v2'::text $f$;
SELECT jx.ok((SELECT h0 FROM h) = public.ofertare_poarta_text_sursa(1)->>'sursa_hash', 'sursa_hash NESCHIMBAT');
SELECT jx.egal(jx.blocaje(1), '["garantie","anexe","numere","pachet"]', 'rezultatele v1 sunt stale sub parserul v2');
SELECT jx.egal(jx.control(1, 'anexe')->'stare', '"undetermined"', 'undetermined, nu ok');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["garantie", "anexe", "numere", "pachet"]');
SELECT jx.trecut('JX-06a');
ROLLBACK;
SELECT jx.baza_intacta('JX-06a');

-- JX-06b ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-06b', 'edge-ul J07 rămas pe parserul v1 după upgrade-ul serverului la v2 → 409, nimic persistat → REFUZ în continuare');
-- @edge j04 1
-- @edge j07 1
:admin
CREATE OR REPLACE FUNCTION public.ofertare_poarta_parser_version() RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $f$ SELECT 'j07-text-v2'::text $f$;
SELECT jx.fotografiaza('inainte_edge');
-- @edge j07 1 status=409
SELECT jx.egal(jx.ultim('j07')->'status', '409', 'edge v1 refuză să evalueze sub serverul v2');
SELECT jx.neschimbat('inainte_edge', 'edge-ul refuzat nu scrie nimic');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
SELECT jx.trecut('JX-06b');
ROLLBACK;
SELECT jx.baza_intacta('JX-06b');

-- JX-06c ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-06c', 'rezultat „ok” scris cu ALT parser_version (v0) pe hash-ul curent → ignorat → REFUZ; reevaluarea cu parserul serverului → depus');
-- @edge j04 1
:service
INSERT INTO ofertare_poarta_rezultate_text(control_code, licitatie_id, parser_version, sursa_hash, stare, detalii)
SELECT c, 1, 'j07-text-v0', public.ofertare_poarta_text_sursa(1)->>'sursa_hash', 'ok', '{}'
FROM unnest(ARRAY['garantie', 'anexe', 'numere', 'pachet']) c;
:admin
SELECT jx.egal(jx.blocaje(1), '["garantie","anexe","numere","pachet"]', 'rezultatele v0 nu sunt recunoscute de serverul v1');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
-- @edge j07 1
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
SELECT jx.ok(jx.stare(1) = 'depus', 'depus după reevaluarea cu parserul serverului');
SELECT jx.trecut('JX-06c');
ROLLBACK;
SELECT jx.baza_intacta('JX-06c');

-- JX-06d ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-06d', 'după upgrade la v2, edge-ul v2 reevaluează aceeași sursă → rezultate v2 → depus (calea permisă spre verde e reevaluarea)');
-- @edge j04 1
:admin
CREATE OR REPLACE FUNCTION public.ofertare_poarta_parser_version() RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $f$ SELECT 'j07-text-v2'::text $f$;
-- @edge j07 1 parser=j07-text-v2
SELECT jx.egal((SELECT jsonb_agg(DISTINCT x->>'parser_version') FROM jsonb_array_elements(jx.ultim('j07')->'rezultate') x), '["j07-text-v2"]', 'rezultate v2');
SELECT jx.egal(jx.blocaje(1), '[]', 'poarta OK sub v2');
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
SELECT jx.ok(jx.stare(1) = 'depus', 'depus');
SELECT jx.trecut('JX-06d');
ROLLBACK;
SELECT jx.baza_intacta('JX-06d');
