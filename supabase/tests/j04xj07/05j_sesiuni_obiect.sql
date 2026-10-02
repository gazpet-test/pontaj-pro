-- @clona
-- JX-05j · Cerința 5, două sesiuni reale, pe OBIECTUL verificat de J04:
--  (1) B rescrie obiectul și face COMMIT între verificarea lui A și tranziție → REFUZ J04 (verificare veche);
--  (2) după reverificare, A pornește tranziția (UPDATE trecut, încă fără COMMIT): B NU poate modifica obiectul —
--      triggerul J04 ține FOR SHARE pe rândurile storage.objects până la COMMIT (B primește 55P03 la lock_timeout);
--  (3) după COMMIT-ul lui A, obiectul e înghețat pentru aplicație (politica R12: UPDATE/DELETE → 0 rânduri).
-- @sesiune A
SELECT jx.start('JX-05j', 'două sesiuni pe obiect: rescris+COMMIT de B → REFUZ J04; în timpul tranziției lui A, B blocat pe FOR SHARE (55P03); după COMMIT, obiect înghețat R12');
-- @edge j04 1
-- @edge j07 1
:editor
BEGIN;
SELECT jx.egal(jx.blocaje(1), '[]', 'A: poarta OK');
-- @sesiune B
:admin
SELECT jx.inlocuieste('pt/1/v1/depus/depus_final_Final.pdf', 'final RESCRIS de B');
-- @sesiune A
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Final.pdf: verificare PASS lipsă, SHA diferit sau verificare veche');
ROLLBACK;
-- (2) A reverifică (manifestul declară „final v1”, bucket-ul are acum bytes-ii lui B → REFUZ); B readuce bytes-ii corecți.
-- @edge j04 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'false', 'reverificarea pe bytes-ii lui B e refuzată (SHA diferit de manifest)');
-- @sesiune B
:admin
SELECT jx.inlocuieste('pt/1/v1/depus/depus_final_Final.pdf', 'final v1');
-- @sesiune A
-- @edge j04 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'reverificare PASS pe obiectul curent');
:editor
BEGIN;
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
-- @sesiune B
:admin
SET lock_timeout = '300ms';
SELECT jx.refuza($$UPDATE storage.objects SET updated_at = updated_at + interval '1 second' WHERE name = 'pt/1/v1/depus/depus_final_Final.pdf'$$, '55P03', 'lock timeout');
SELECT jx.refuza($$DELETE FROM storage.objects WHERE name = 'pt/1/v1/Propunere.docx'$$, '55P03', 'lock timeout');
RESET lock_timeout;
-- @sesiune A
COMMIT;
:admin
SELECT jx.ok(jx.stare(1) = 'depus', 'A a depus pe obiectele verificate');
-- @sesiune B
:editor
SELECT jx.fara_efect($$UPDATE storage.objects SET metadata = '{"size":1,"eTag":"x"}' WHERE name = 'pt/1/v1/depus/depus_final_Final.pdf'$$);
SELECT jx.fara_efect($$DELETE FROM storage.objects WHERE name = 'pt/1/v1/depus/depus_final_Final.pdf'$$);
SELECT jx.trecut('JX-05j');
