-- JX-C2 / JX-C3 · CERINȚE (remediate 06.10.2026, JILAVA_DECIZII A.2): fostele constatări #4 și „manifest rescris de service_role”.
-- JX-C4 rămâne CONSTATARE (acceptată și documentată pentru Jilava): testul o FIXEAZĂ (pică dacă se schimbă, ca să fie reclasificată).

-- JX-C2 ──────────────────────────────────────────────────────────────────────────────────────────────
-- Un PASS vechi NU mai acoperă o verificare ULTERIOARĂ cu REFUZ pe aceeași identitate de obiect (bytes schimbați sub
-- metadate): decide ultima verificare a fișierului, ca la J07 (ultimul rezultat pe hash). Reparația = bytes corecți + reverificare.
BEGIN;
SELECT jx.start('JX-C2', 'C2 remediat: PASS vechi + REFUZ ulterior pe ACEEAȘI identitate (bytes schimbați sub metadate) → ultima verificare decide → REFUZ J04; după reverificare PASS → depus');
-- @edge j04 1
-- @edge j07 1
:admin
UPDATE jx.bucket SET continut = convert_to('FINAL v1', 'UTF8') WHERE name = 'pt/1/v1/depus/depus_final_Final.pdf';
-- @edge j04 1
SELECT jx.ok((SELECT rezultat = 'REFUZ' AND motiv = 'SHA-256 diferit de manifest' FROM ofertare_pt_pachet_verificari
  WHERE fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf' ORDER BY id DESC LIMIT 1), 'ultima verificare a Final.pdf: REFUZ, SHA diferit');
SELECT jx.ok((SELECT count(*) >= 1 FROM ofertare_pt_pachet_verificari
  WHERE fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf' AND rezultat = 'PASS'), 'PASS-ul mai vechi rămâne în istoric (append-only), dar nu mai decide');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Final.pdf: verificare PASS lipsă, SHA diferit sau verificare veche');
:admin
UPDATE jx.bucket SET continut = convert_to('final v1', 'UTF8') WHERE name = 'pt/1/v1/depus/depus_final_Final.pdf';
-- @edge j04 1
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
SELECT jx.ok(jx.stare(1) = 'depus', 'bytes corecți + reverificare (ultimul rezultat = PASS) → depus');
SELECT jx.trecut('JX-C2');
ROLLBACK;
SELECT jx.baza_intacta('JX-C2');

-- JX-C3 ──────────────────────────────────────────────────────────────────────────────────────────────
-- Manifestul e append-only pentru TOATE rolurile: cheia de serviciu nu mai poate rescrie sha256 A→B (nici șterge / adăuga rânduri
-- în afara contractului R11) pe pachetul aprobat; A→B rămâne posibil doar prin pachet nou (JX-09). Doar identitatea de administrare
-- (postgres / supabase_admin fără claims JWT, ca la garda J05) poate repara.
BEGIN;
SELECT jx.start('JX-C3', 'C3 remediat: cheia de serviciu NU poate rescrie manifestul pachetului aprobat (UPDATE sha256 / DELETE / INSERT în afara R11) → 42501; depunerea pe B tot REFUZ');
-- @edge j07 1
:admin
SELECT jx.inlocuieste('pt/1/v1/depus/depus_final_Final.pdf', 'FINAL B');
:service
SELECT jx.refuza($$UPDATE ofertare_pt_pachet_fisiere SET sha256 = jx.sha('FINAL B'), size_bytes = 7 WHERE fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf'$$, '42501', 'e append-only: UPDATE');
SELECT jx.refuza($$DELETE FROM ofertare_pt_pachet_fisiere WHERE fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf'$$, '42501', 'e append-only: DELETE');
SELECT jx.refuza($$SELECT jx.fisier(1, 'propunere_docx', 'Alta.docx', 'pt/1/v1/Alta.docx', 'alta')$$, '42501', 'Manifestul pachetului 1 e închis (stare aprobat)');
-- @edge j04 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'false', 'verificarea pe manifestul neschimbat (A) vede bytes B → REFUZ');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Final.pdf: verificare PASS lipsă, SHA diferit');
:admin
SELECT jx.ok(public.fn_pt_manifest_administrare(), 'postgres fără claims = identitatea de administrare (reparații documentate)');
SELECT jx.trecut('JX-C3');
ROLLBACK;
SELECT jx.baza_intacta('JX-C3');

-- JX-C3b ─────────────────────────────────────────────────────────────────────────────────────────────
-- Ștergerea manifestului e permisă doar cât pachetul e „propus” (aplicația șterge pachetul propus la o aprobare eșuată, manifestul
-- pleacă în cascadă); pe pachetul aprobat, refuzată și pentru cheia de serviciu.
BEGIN;
SELECT jx.start('JX-C3b', 'C3: pachet PROPUS (v2) cu manifest → DELETE pachet (cascadă) permis; pe pachetul aprobat v1 DELETE manifest / DELETE pachet / TRUNCATE refuzate (și pentru cheia de serviciu)');
:admin
INSERT INTO ofertare_pt_pachet(id, licitatie_id, versiune) VALUES (2, 1, 2);
SELECT jx.urca('pt/1/v2/Propunere.docx', 'propunere v2');
SELECT jx.fisier(2, 'propunere_docx', 'Propunere.docx', 'pt/1/v2/Propunere.docx', 'propunere v2');
:service
DELETE FROM ofertare_pt_pachet WHERE id = 2 AND stare = 'propus';
SELECT jx.ok(NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere WHERE pachet_id = 2), 'cascada de la pachetul propus a trecut');
SELECT jx.refuza($$DELETE FROM ofertare_pt_pachet_fisiere WHERE pachet_id = 1 AND rol = 'propunere_docx'$$, '42501', 'e append-only: DELETE');
-- Copilot conv. 3 (NO-GO r1 pe d8cc2da): ocolirea prin ștergerea PĂRINTELUI aprobat (manifestul ar fi plecat în cascadă) e refuzată;
-- TRUNCATE (manifest / pachet, CASCADE) e refuzat și el. jx.refuza verifică și că starea (manifest, dovezi) a rămas neschimbată.
SELECT jx.refuza($$DELETE FROM ofertare_pt_pachet WHERE id = 1$$, '42501', 'nu se poate șterge');
SELECT jx.refuza_oricare($$TRUNCATE ofertare_pt_pachet_fisiere CASCADE$$, ARRAY['42501']);
SELECT jx.refuza_oricare($$TRUNCATE ofertare_pt_pachet CASCADE$$, ARRAY['42501']);
:owner
SELECT jx.refuza_oricare($$DELETE FROM ofertare_pt_pachet WHERE id = 1$$, ARRAY['42501']);   -- authenticated: fără drept de DELETE (garda e pentru service_role)
:admin
SELECT jx.ok((SELECT count(*) FROM ofertare_pt_pachet_fisiere WHERE pachet_id = 1) >= 5 AND jx.stare(1) = 'aprobat', 'pachetul aprobat și manifestul lui sunt intacte');
SELECT jx.trecut('JX-C3b');
ROLLBACK;
SELECT jx.baza_intacta('JX-C3b');

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
