-- @clona
-- JX-05h · Cerința 5, două sesiuni reale: B adaugă un rând de MANIFEST (depus_final, cu obiectul lui) și face COMMIT
-- între verificarea lui A și tranziția lui A → REFUZ (J07: hash-ul sursei include manifestul; J04: fișier fără PASS).
-- @sesiune A
SELECT jx.start('JX-05h', 'două sesiuni: B adaugă un fișier în manifest și face COMMIT după verificarea lui A → tranziția lui A REFUZATĂ (J07, apoi J04)');
-- @edge j04 1
-- @edge j07 1
:editor
BEGIN;
SELECT jx.egal(jx.blocaje(1), '[]', 'A: poarta OK');
-- @sesiune B
:editor
SELECT jx.urca('pt/1/v1/depus/depus_final_B.pdf', 'fisier adaugat de B');
SELECT jx.fisier(1, 'depus_final', 'B.pdf', 'pt/1/v1/depus/depus_final_B.pdf', 'fisier adaugat de B');
-- @sesiune A
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
ROLLBACK;
-- A recalculează J07 (manifestul nou e acum în sursă); J04 tot refuză fișierul lui B, neverificat.
-- @edge j07 1
:editor
BEGIN;
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'B.pdf: verificare PASS lipsă');
ROLLBACK;
:admin
SELECT jx.ok(jx.stare(1) = 'aprobat', 'pachetul rămâne aprobat');
SELECT jx.trecut('JX-05h');
