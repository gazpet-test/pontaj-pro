-- JX-C2 / JX-C3 / JX-C4 · CONSTATĂRI (nu cerințe): comportamente actuale care NU contrazic cerințele §2 pe căile aplicației,
-- dar pe care Copilot / Răzvan trebuie să le decidă. Testele le FIXEAZĂ (pică dacă se schimbă, ca să fie reclasificate).

-- JX-C2 ──────────────────────────────────────────────────────────────────────────────────────────────
-- Constatarea #4: J04 acceptă ORICE PASS a cărui identitate se potrivește exact, chiar dacă o verificare ULTERIOARĂ a
-- aceleiași identități (id, updated_at, eTag, size) a dat REFUZ „SHA-256 diferit” (bytes schimbați sub metadate, ex.
-- scriere directă în stratul de stocare). J07, în schimb, ia doar ULTIMUL rezultat pe hash (vezi JX-05c).
BEGIN;
SELECT jx.start('JX-C2', 'CONSTATARE #4: PASS vechi + REFUZ ulterior pe ACEEAȘI identitate de obiect (bytes schimbați sub metadate) → J04 lasă tranziția să treacă');
-- @edge j04 1
-- @edge j07 1
:admin
-- Aceeași lungime, alți bytes, metadate (id/updated_at/eTag/size) neatinse: doar stratul de bytes se schimbă.
UPDATE jx.bucket SET continut = convert_to('FINAL v1', 'UTF8') WHERE name = 'pt/1/v1/depus/depus_final_Final.pdf';
-- @edge j04 1
SELECT jx.ok((SELECT rezultat = 'REFUZ' AND motiv = 'SHA-256 diferit de manifest' FROM ofertare_pt_pachet_verificari
  WHERE fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf' ORDER BY id DESC LIMIT 1), 'ultima verificare a Final.pdf: REFUZ, SHA diferit');
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
SELECT jx.ok(jx.stare(1) = 'depus', 'tranziția a trecut pe PASS-ul mai vechi');
SELECT jx.constatare('JX-C2', 'J04 folosește un PASS mai vechi deși ultima verificare a aceleiași identități e REFUZ (SHA diferit); J07 ar fi refuzat (ultimul rezultat câștigă)');
SELECT jx.trecut('JX-C2');
ROLLBACK;
SELECT jx.baza_intacta('JX-C2');

-- JX-C3 ──────────────────────────────────────────────────────────────────────────────────────────────
-- Constatare nouă: manifestul e append-only DOAR pentru authenticated (GRANT); service_role (GRANT ALL, fără trigger)
-- îl poate rescrie. Un edge / script cu cheia de serviciu poate schimba SHA-ul declarat și apoi obține PASS pe alți bytes,
-- fără „pachet nou” (tranziția permisă cerută în §2 pentru A→B). Aplicația (authenticated) nu poate: vezi JX-09c.
BEGIN;
SELECT jx.start('JX-C3', 'CONSTATARE: cheia de serviciu poate RESCRIE manifestul (sha256 A→B) și apoi depune B pe pachetul v1, fără versiune nouă');
-- @edge j07 1
:admin
SELECT jx.inlocuieste('pt/1/v1/depus/depus_final_Final.pdf', 'FINAL B');
:service
UPDATE ofertare_pt_pachet_fisiere SET sha256 = jx.sha('FINAL B'), size_bytes = 7 WHERE fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf';
-- @edge j07 1
-- @edge j04 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'PASS pe B după rescrierea manifestului');
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
SELECT jx.ok(jx.stare(1) = 'depus', 'depus cu manifestul rescris de service_role');
SELECT jx.constatare('JX-C3', 'service_role poate UPDATE ofertare_pt_pachet_fisiere.sha256 (GRANT ALL, niciun trigger de imuabilitate) → A→B fără pachet nou');
SELECT jx.trecut('JX-C3');
ROLLBACK;
SELECT jx.baza_intacta('JX-C3');

-- JX-C4 ──────────────────────────────────────────────────────────────────────────────────────────────
-- Constatarea #3 (comportament J02/J05 existent): derogarea ownerului ocolește J02, deci și cerința „pachet depus”
-- — implicit J04 —, dar NU ocolește J07 (JX-07f). Licitația poate deveni „depusă” cu pachetul doar APROBAT, fără
-- nicio dovadă J04. Decizia (J05 să ceară și J04 sau nu) rămâne la Copilot + Răzvan.
BEGIN;
SELECT jx.start('JX-C4', 'CONSTATARE #3: derogarea J05 (owner) + J07 OK → licitație depusă cu pachetul doar aprobat, fără nicio dovadă J04');
-- @edge j07 1
:owner
SELECT public.ofertare_derogare_depunere(1, 'derogare de test pentru constatarea 3', true);
UPDATE ofertare_licitatii SET status = 'depusa' WHERE id = 1;
:admin
SELECT jx.ok((SELECT status = 'depusa' FROM ofertare_licitatii WHERE id = 1) AND jx.stare(1) = 'aprobat'
  AND NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_verificari), 'depusă pe derogare, pachet aprobat, zero verificări J04');
SELECT jx.ok((SELECT count(*) >= 1 FROM ofertare_derogari_audit WHERE licitatie_id = 1), 'derogarea e auditată (J05)');
SELECT jx.constatare('JX-C4', 'J05 ocolește J02 și implicit J04 (pachetul rămâne aprobat, fără dovezi hash); J07 rămâne impus');
SELECT jx.trecut('JX-C4');
ROLLBACK;
SELECT jx.baza_intacta('JX-C4');
