-- JX-05 (a–f) · Cerința 5, varianta cu PAȘI INTERCALAȚI (o tranzacție, ordine deterministă): o modificare relevantă
-- de SURSĂ / MANIFEST / REZULTAT / OBIECT apare ÎNTRE verificare (J04 + J07 OK) și tranziția finală → REFUZ.
-- Dovedește că serverul reevaluează la tranziție pe versiunile CURENTE (hash-ul sursei J07, identitatea obiectului J04),
-- nu se bazează pe verdictul văzut de UI. Varianta cu DOUĂ sesiuni reale (COMMIT-uri) e în 05g…05j.

-- JX-05a ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-05a', 'SURSA J07 editată între verificare și tranziție → REFUZ J07 (hash nou); după recalcul → depus (J04 rămâne valabil)');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.blocaje(1), '[]', 'verificat: J07 OK');
:editor
SELECT jx.editeaza_capitol(1, 'Anexa 1; garanție 36 luni; 372 branșamente (text revizuit după verificare)');
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["garantie", "anexe", "numere", "pachet"]');
-- @edge j07 1
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
SELECT jx.ok(jx.stare(1) = 'depus', 'depus după reevaluare');
SELECT jx.trecut('JX-05a');
ROLLBACK;
SELECT jx.baza_intacta('JX-05a');

-- JX-05b ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-05b', 'MANIFEST: rând depus_final nou între verificare și tranziție → REFUZ J07 (hash) → după recalcul J07, REFUZ J04 (fără PASS pe fișierul nou) → după reverificare, depus');
-- @edge j04 1
-- @edge j07 1
:editor
SELECT jx.urca('pt/1/v1/depus/depus_final_Anexa_extra.pdf', 'anexa extra');
SELECT jx.fisier(1, 'depus_final', 'Anexa_extra.pdf', 'pt/1/v1/depus/depus_final_Anexa_extra.pdf', 'anexa extra');
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
-- @edge j07 1
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Anexa_extra.pdf: verificare PASS lipsă');
-- @edge j04 1
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
SELECT jx.ok(jx.stare(1) = 'depus', 'depus după ambele reverificări');
SELECT jx.trecut('JX-05b');
ROLLBACK;
SELECT jx.baza_intacta('JX-05b');

-- JX-05c ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-05c', 'REZULTAT J07: rând nou „block” pe ACELAȘI hash între verificare și tranziție → REFUZ (ultimul rezultat câștigă)');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.blocaje(1), '[]', 'verificat: J07 OK');
:service
INSERT INTO ofertare_poarta_rezultate_text(control_code, licitatie_id, parser_version, sursa_hash, stare, detalii)
VALUES ('numere', 1, :'parser_edge', public.ofertare_poarta_text_sursa(1)->>'sursa_hash', 'block', '{"reevaluare":"block"}');
:admin
SELECT jx.egal(jx.blocaje(1), '["numere"]', 'rezultatul nou pe același hash înlocuiește verdictul');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["numere"]');
SELECT jx.trecut('JX-05c');
ROLLBACK;
SELECT jx.baza_intacta('JX-05c');

-- JX-05d ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-05d', 'OBIECT J04 rescris între verificare și tranziție (J07 rămâne OK: obiectele nu intră în hash-ul J07) → REFUZ J04');
-- @edge j04 1
-- @edge j07 1
:admin
SELECT jx.inlocuieste('pt/1/v1/depus/dovada_seap_Dovada.pdf', 'dovada inlocuita');
SELECT jx.egal(jx.blocaje(1), '[]', 'J07 neafectată');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Dovada.pdf: verificare PASS lipsă, SHA diferit sau verificare veche');
SELECT jx.trecut('JX-05d');
ROLLBACK;
SELECT jx.baza_intacta('JX-05d');

-- JX-05e ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-05e', 'CONTROL SQL (fronturi grafic) schimbat între verificare și tranziție → REFUZ: controalele SQL se evaluează live la tranziție, nu din cache');
-- @edge j04 1
-- @edge j07 1
:editor
UPDATE grafic_parametri SET parametri = '{"fronturi":[{"lungime_m":900}]}' WHERE licitatie_id = 1;
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["cantitati_f3_grafic"]');
SELECT jx.trecut('JX-05e');
ROLLBACK;
SELECT jx.baza_intacta('JX-05e');

-- JX-05f ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-05f', '„stale” se decide prin HASH, nu prin timp: sursa schimbată → REFUZ; readusă byte-identic → același hash → verdictul vechi valabil → depus');
-- @edge j04 1
-- @edge j07 1
:admin
SELECT jx.fotografiaza('verificat');
UPDATE grafic_versiuni SET poarta = '[{"test":1}]' WHERE licitatie_id = 1 AND versiune = 1;
SELECT jx.egal(jx.blocaje(1), '["garantie","anexe","numere","pachet"]', 'sursa schimbată ⇒ rezultatele text nu se mai aplică');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
:admin
UPDATE grafic_versiuni SET poarta = '[]' WHERE licitatie_id = 1 AND versiune = 1;
SELECT jx.neschimbat('verificat', 'sursa readusă');
SELECT jx.egal(jx.blocaje(1), '[]', 'același hash ⇒ același rezultat, indiferent de ora calculului');
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
SELECT jx.ok(jx.stare(1) = 'depus', 'depus');
SELECT jx.trecut('JX-05f');
ROLLBACK;
SELECT jx.baza_intacta('JX-05f');
