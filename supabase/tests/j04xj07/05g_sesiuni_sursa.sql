-- @clona
-- JX-05g · Cerința 5, DOUĂ sesiuni reale (COMMIT-uri, pe o clonă de unică folosință a bazei de test):
-- A verifică (J04 + J07, commit) și, în tranzacția în care urmează să depună, VEDE poarta OK; B editează SURSA J07
-- și face COMMIT; tranziția lui A (READ COMMITTED, ca PostgREST) e refuzată: triggerul reevaluează pe versiunea curentă.
-- @sesiune A
SELECT jx.start('JX-05g', 'două sesiuni: A verificat + vede OK în tranzacția ei; B editează sursa J07 și face COMMIT → tranziția lui A REFUZATĂ');
-- @edge j04 1
-- @edge j07 1
:editor
BEGIN;
SELECT jx.egal(jx.blocaje(1), '[]', 'A: poarta OK în tranzacția de depunere');
-- @sesiune B
:editor
SELECT jx.editeaza_capitol(1, 'Anexa 1; garanție 36 luni; 372 branșamente (editat de B)');
-- @sesiune A
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
ROLLBACK;
:admin
SELECT jx.ok(jx.stare(1) = 'aprobat', 'pachetul rămâne aprobat după commit-ul lui B');
SELECT jx.trecut('JX-05g');
