-- JX-02 · Simetric invers (cerința 2): hash J04 VALID și CURENT (PASS pe toate cele 4 fișiere, obiecte neatinse)
-- + poartă J07 BLOCK → REFUZ la aprobat→depus. Refuzul vine EXCLUSIV din J07 (triggerul de documentație).
-- (Fiecare dintre cele 12 controale provocat separat e în 04_controale_j07.sql.)

-- JX-02a ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-02a', 'J04 PASS curent + J07 NErecalculată după manifestul depunerii (rezultate text stale) → REFUZ J07');
-- @edge j04 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate 4');
SELECT jx.egal(jx.blocaje(1), '["garantie","anexe","numere","pachet"]', 'J07: cele 4 controale text sunt undetermined (hash vechi)');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["garantie", "anexe", "numere", "pachet"]');
SELECT jx.trecut('JX-02a');
ROLLBACK;
SELECT jx.baza_intacta('JX-02a');

-- JX-02b ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-02b', 'J04 PASS curent + J07 INDISPONIBILĂ (sursa text ilizibilă: edge 409, nimic scris) → REFUZ J07');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.blocaje(1), '[]', 'pornim de la J07 OK');
:admin
-- Coloana citită de sursa J07 dispare (view-urile o urmează prin attnum; funcția de sursă o cere după nume).
ALTER TABLE ofertare_cerinte RENAME COLUMN text_cerinta TO text_cerinta_indisponibil;
SELECT jx.fotografiaza('inainte_409');
-- @edge j07 1
SELECT jx.egal(jx.ultim('j07')->'status', '409', 'edge J07 → 409, sursa nu se poate citi');
SELECT jx.neschimbat('inainte_409', 'edge-ul J07 refuzat (409) nu scrie nimic');
SELECT jx.egal(jx.blocaje(1), '["garantie","anexe","numere","pachet"]', 'controalele text devin undetermined (sursă ilizibilă)');
SELECT jx.egal(jx.control(1, 'garantie')->'stare', '"undetermined"', 'undetermined, nu ok');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
SELECT jx.trecut('JX-02b');
ROLLBACK;
SELECT jx.baza_intacta('JX-02b');

-- JX-02c ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-02c', 'J04 PASS curent + agregatorul J07 aruncă eroare internă → tranziția cade (fail-closed), nimic scris');
-- @edge j04 1
-- @edge j07 1
:admin
CREATE OR REPLACE FUNCTION public.ofertare_poarta_server(p_licitatie_id bigint) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
  BEGIN RAISE EXCEPTION 'poarta J07 căzută (simulat)' USING ERRCODE = 'XX000'; END $f$;
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'XX000', 'poarta J07 căzută');
SELECT jx.trecut('JX-02c');
ROLLBACK;
SELECT jx.baza_intacta('JX-02c');

-- JX-02d ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-02d', 'J04 PASS curent + edge J07 persistă „undetermined” (eroare de parser) pe hash-ul curent → REFUZ J07');
-- @edge j04 1
-- @edge j07 1
:service
INSERT INTO ofertare_poarta_rezultate_text(control_code, licitatie_id, parser_version, sursa_hash, stare, detalii)
VALUES ('anexe', 1, :'parser_edge', public.ofertare_poarta_text_sursa(1)->>'sursa_hash', 'undetermined', '{"eroare":"parser"}');
:admin
SELECT jx.egal(jx.blocaje(1), '["anexe"]', 'ultimul rezultat pe hash-ul curent câștigă');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["anexe"]');
SELECT jx.trecut('JX-02d');
ROLLBACK;
SELECT jx.baza_intacta('JX-02d');
