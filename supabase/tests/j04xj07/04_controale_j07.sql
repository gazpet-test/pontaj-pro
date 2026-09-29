-- JX-04 · Cerința 4: FIECARE din cele 12 controale J07 provocat SEPARAT, prin DATE reale (nu prin înlocuirea funcției),
-- cu celelalte 11 satisfăcute și cu J04 PASS curent → REFUZ la aprobat→depus, cu codul controlului în motiv.
-- Dovada „celelalte 11 satisfăcute”: agregatorul real întoarce blocaje = [cod] EXACT (orice alt control ≠ ok ar apărea
-- în listă); dovada „J04 nu e cauza”: edge-ul J04 real a confirmat toate fișierele (ok=true) înainte de tranziție.
-- Controalele text (garantie/anexe/numere/pachet) sunt evaluate de evaluatorul REAL al edge-ului (evalueaza.mjs),
-- recalculat după schimbare; cele SQL se evaluează live în trigger. Fiecare schimbare e făcută de editor (API).

-- JX-04-01 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-04-01', 'control cuprins singur BLOCK (cuprins gol: capitolele licitației șterse (cu legătura lor) — pachetul nu mai are niciun capitol) + celelalte 11 ok + J04 PASS → REFUZ cu [cuprins]');
:editor
DELETE FROM ofertare_pt_legaturi WHERE capitol_id = 1;
DELETE FROM ofertare_pt_capitole WHERE id = 1;
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate fișierele (nu J04 refuză)');
SELECT jx.egal(jx.blocaje(1), '["cuprins"]', 'blocaje = exact controlul provocat; celelalte 11 ok');
SELECT jx.egal(jx.control(1, 'cuprins')->'stare', '"block"', 'controlul cuprins e BLOCK (nu undetermined)');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["cuprins"]');
SELECT jx.trecut('JX-04-01');
ROLLBACK;
SELECT jx.baza_intacta('JX-04-01');

-- JX-04-02 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-04-02', 'control neverificate singur BLOCK (cerință cu legătura de capitol BLOCATĂ de om (R09) — nu mai e verificată) + celelalte 11 ok + J04 PASS → REFUZ cu [neverificate]');
:editor
UPDATE ofertare_pt_legaturi SET stare = 'blocata', constatare = 'capitolul nu răspunde cerinței' WHERE id = 1;
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate fișierele (nu J04 refuză)');
SELECT jx.egal(jx.blocaje(1), '["neverificate"]', 'blocaje = exact controlul provocat; celelalte 11 ok');
SELECT jx.egal(jx.control(1, 'neverificate')->'stare', '"block"', 'controlul neverificate e BLOCK (nu undetermined)');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["neverificate"]');
SELECT jx.trecut('JX-04-02');
ROLLBACK;
SELECT jx.baza_intacta('JX-04-02');

-- JX-04-03 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-04-03', 'control capcane singur BLOCK (cerință-capcană nouă („ofertele neconforme vor fi respinse”) fără capitol) + celelalte 11 ok + J04 PASS → REFUZ cu [capcane]');
:editor
INSERT INTO ofertare_cerinte(id, licitatie_id, confirmata_de, text_cerinta)
  VALUES (2, 1, auth.uid(), 'Ofertele neconforme vor fi respinse fără posibilitatea de a solicita clarificări');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate fișierele (nu J04 refuză)');
SELECT jx.egal(jx.blocaje(1), '["capcane"]', 'blocaje = exact controlul provocat; celelalte 11 ok');
SELECT jx.egal(jx.control(1, 'capcane')->'stare', '"block"', 'controlul capcane e BLOCK (nu undetermined)');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["capcane"]');
SELECT jx.trecut('JX-04-03');
ROLLBACK;
SELECT jx.baza_intacta('JX-04-03');

-- JX-04-04 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-04-04', 'control goale singur BLOCK (capitol obligatoriu nou, fără conținut și fără fișier) + celelalte 11 ok + J04 PASS → REFUZ cu [goale]');
:editor
INSERT INTO ofertare_pt_capitole(id, licitatie_id, nr, titlu) VALUES (2, 1, 2, 'Organizarea de șantier');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate fișierele (nu J04 refuză)');
SELECT jx.egal(jx.blocaje(1), '["goale"]', 'blocaje = exact controlul provocat; celelalte 11 ok');
SELECT jx.egal(jx.control(1, 'goale')->'stare', '"block"', 'controlul goale e BLOCK (nu undetermined)');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["goale"]');
SELECT jx.trecut('JX-04-04');
ROLLBACK;
SELECT jx.baza_intacta('JX-04-04');

-- JX-04-05 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-04-05', 'control nescrise singur BLOCK (capitol obligatoriu nou scris de AI, nerescris de om) + celelalte 11 ok + J04 PASS → REFUZ cu [nescrise]');
:editor
INSERT INTO ofertare_pt_capitole(id, licitatie_id, nr, titlu, continut, sursa)
  VALUES (2, 1, 2, 'Organizarea de șantier', 'Text propus automat pentru organizarea de șantier', 'ai');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate fișierele (nu J04 refuză)');
SELECT jx.egal(jx.blocaje(1), '["nescrise"]', 'blocaje = exact controlul provocat; celelalte 11 ok');
SELECT jx.egal(jx.control(1, 'nescrise')->'stare', '"block"', 'controlul nescrise e BLOCK (nu undetermined)');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["nescrise"]');
SELECT jx.trecut('JX-04-05');
ROLLBACK;
SELECT jx.baza_intacta('JX-04-05');

-- JX-04-06 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-04-06', 'control cantitati_f3_grafic singur BLOCK (fronturile graficului (1200 m) nu mai corespund listei F3 (1000 m), peste toleranța de 0,1%) + celelalte 11 ok + J04 PASS → REFUZ cu [cantitati_f3_grafic]');
:editor
UPDATE grafic_parametri SET parametri = '{"fronturi":[{"lungime_m":1200}]}' WHERE licitatie_id = 1;
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate fișierele (nu J04 refuză)');
SELECT jx.egal(jx.blocaje(1), '["cantitati_f3_grafic"]', 'blocaje = exact controlul provocat; celelalte 11 ok');
SELECT jx.egal(jx.control(1, 'cantitati_f3_grafic')->'stare', '"block"', 'controlul cantitati_f3_grafic e BLOCK (nu undetermined)');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["cantitati_f3_grafic"]');
SELECT jx.trecut('JX-04-06');
ROLLBACK;
SELECT jx.baza_intacta('JX-04-06');

-- JX-04-07 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-04-07', 'control garantie singur BLOCK (garanția oferită (24 luni) sub minimul cerut (36 luni) — partea SQL structurată) + celelalte 11 ok + J04 PASS → REFUZ cu [garantie]');
:editor
UPDATE ofertare_pt_garantie SET oferit_luni = 24 WHERE licitatie_id = 1;
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate fișierele (nu J04 refuză)');
SELECT jx.egal(jx.blocaje(1), '["garantie"]', 'blocaje = exact controlul provocat; celelalte 11 ok');
SELECT jx.egal(jx.control(1, 'garantie')->'stare', '"block"', 'controlul garantie e BLOCK (nu undetermined)');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["garantie"]');
SELECT jx.trecut('JX-04-07');
ROLLBACK;
SELECT jx.baza_intacta('JX-04-07');

-- JX-04-08 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-04-08', 'control anexe singur BLOCK (capitolul trimite la „Anexa 2”, care nu există în cuprins (evaluatorul text real)) + celelalte 11 ok + J04 PASS → REFUZ cu [anexe]');
:editor
SELECT jx.editeaza_capitol(1, 'Anexa 2; garanție 36 luni; 372 branșamente');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate fișierele (nu J04 refuză)');
SELECT jx.egal(jx.blocaje(1), '["anexe"]', 'blocaje = exact controlul provocat; celelalte 11 ok');
SELECT jx.egal(jx.control(1, 'anexe')->'stare', '"block"', 'controlul anexe e BLOCK (nu undetermined)');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["anexe"]');
SELECT jx.trecut('JX-04-08');
ROLLBACK;
SELECT jx.baza_intacta('JX-04-08');

-- JX-04-09 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-04-09', 'control numere singur BLOCK (capitolul spune 371 branșamente, cerințele 372 (evaluatorul text real)) + celelalte 11 ok + J04 PASS → REFUZ cu [numere]');
:editor
SELECT jx.editeaza_capitol(1, 'Anexa 1; garanție 36 luni; 371 branșamente');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate fișierele (nu J04 refuză)');
SELECT jx.egal(jx.blocaje(1), '["numere"]', 'blocaje = exact controlul provocat; celelalte 11 ok');
SELECT jx.egal(jx.control(1, 'numere')->'stare', '"block"', 'controlul numere e BLOCK (nu undetermined)');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["numere"]');
SELECT jx.trecut('JX-04-09');
ROLLBACK;
SELECT jx.baza_intacta('JX-04-09');

-- JX-04-10 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-04-10', 'control pachet singur BLOCK (piesă declarată („Anexa 2”) fără fișier în pachetul final (evaluatorul text real)) + celelalte 11 ok + J04 PASS → REFUZ cu [pachet]');
:editor
INSERT INTO ofertare_pt_anexe_asteptate VALUES (1, 1, 'Anexa 2');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate fișierele (nu J04 refuză)');
SELECT jx.egal(jx.blocaje(1), '["pachet"]', 'blocaje = exact controlul provocat; celelalte 11 ok');
SELECT jx.egal(jx.control(1, 'pachet')->'stare', '"block"', 'controlul pachet e BLOCK (nu undetermined)');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["pachet"]');
SELECT jx.trecut('JX-04-10');
ROLLBACK;
SELECT jx.baza_intacta('JX-04-10');

-- JX-04-11 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-04-11', 'control grafic_relatii singur BLOCK (versiune nouă de grafic cu relație FS contrazisă de datele declarate (B începe înainte să se termine A)) + celelalte 11 ok + J04 PASS → REFUZ cu [grafic_relatii]');
:editor
INSERT INTO grafic_versiuni(licitatie_id, versiune, activitati) VALUES (1, 2,
  '[{"id":"A","durata_zile":5,"es":1,"ef":5,"predecesori":[]},{"id":"B","durata_zile":3,"es":3,"ef":5,"predecesori":[{"id":"A","relatie":"FS"}]}]');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate fișierele (nu J04 refuză)');
SELECT jx.egal(jx.blocaje(1), '["grafic_relatii"]', 'blocaje = exact controlul provocat; celelalte 11 ok');
SELECT jx.egal(jx.control(1, 'grafic_relatii')->'stare', '"block"', 'controlul grafic_relatii e BLOCK (nu undetermined)');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["grafic_relatii"]');
SELECT jx.trecut('JX-04-11');
ROLLBACK;
SELECT jx.baza_intacta('JX-04-11');

-- JX-04-12 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-04-12', 'control grafic_sursa singur BLOCK (piesă de grafic depusă, generată din altă versiune (grafic@v7) decât cea înghețată (v1)) + celelalte 11 ok + J04 PASS → REFUZ cu [grafic_sursa]');
:editor
SELECT jx.urca('pt/1/v1/depus/depus_final_Grafic_executie.pdf', 'grafic de executie v7');
INSERT INTO ofertare_pt_pachet_fisiere(pachet_id, rol, nume, sha256, fisier_path, size_bytes, sursa_versiune)
  VALUES (1, 'depus_final', 'Grafic_executie.pdf', jx.sha('grafic de executie v7'), 'pt/1/v1/depus/depus_final_Grafic_executie.pdf', 21, 'grafic@v7');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate fișierele (nu J04 refuză)');
SELECT jx.egal(jx.blocaje(1), '["grafic_sursa"]', 'blocaje = exact controlul provocat; celelalte 11 ok');
SELECT jx.egal(jx.control(1, 'grafic_sursa')->'stare', '"block"', 'controlul grafic_sursa e BLOCK (nu undetermined)');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["grafic_sursa"]');
SELECT jx.trecut('JX-04-12');
ROLLBACK;
SELECT jx.baza_intacta('JX-04-12');

-- JX-04-07b ────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-04-07b', 'control garantie singur BLOCK prin TEXT (structurat ok 36/36, dar capitolul spune 48 luni; evaluatorul real) + celelalte 11 ok + J04 PASS → REFUZ cu [garantie]');
:editor
SELECT jx.editeaza_capitol(1, 'Anexa 1; garanție 48 luni; 372 branșamente');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS');
SELECT jx.egal((SELECT to_jsonb(x->>'stare') FROM jsonb_array_elements(jx.ultim('j07')->'rezultate') x WHERE x->>'control_code' = 'garantie'),
  '"block"', 'evaluatorul text real blochează garanția');
SELECT jx.egal(jx.blocaje(1), '["garantie"]', 'blocaje = [garantie]');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["garantie"]');
SELECT jx.trecut('JX-04-07b');
ROLLBACK;
SELECT jx.baza_intacta('JX-04-07b');

-- JX-04-13 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-04-13', 'contraprobă: fără schimbare, același flux (J04 + J07) → blocaje=[] și depus reușește; agregatorul are exact cele 12 controale');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.blocaje(1), '[]', 'fără schimbare: toate ok');
SELECT jx.egal((SELECT jsonb_agg(c->>'control_code' ORDER BY c->>'control_code') FROM jsonb_array_elements(ofertare_poarta_server(1)->'controale') c),
  '["anexe","cantitati_f3_grafic","capcane","cuprins","garantie","goale","grafic_relatii","grafic_sursa","nescrise","neverificate","numere","pachet"]',
  'agregatorul conține exact cele 12 controale');
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
SELECT jx.ok(jx.stare(1) = 'depus', 'depus');
SELECT jx.trecut('JX-04-13');
ROLLBACK;
SELECT jx.baza_intacta('JX-04-13');
