-- JX-01 · Simetric (cerința 1): hash J04 invalid / lipsă / stale + poartă J07 PERMISIVĂ (toate cele 12 controale ok)
-- → REFUZ la aprobat→depus. În fiecare test: J07 e recalculată cu evaluatorul real și agregatorul întoarce blocaje=[],
-- deci refuzul vine EXCLUSIV din J04 (triggerul depus). Toate refuzurile trec prin jx.refuza: la refuz nimic nu se schimbă.
-- Căile: P = pt/1/v1/Propunere.docx, F = pt/1/v1/depus/depus_final_Final.pdf, D = pt/1/v1/depus/dovada_seap_Dovada.pdf.

-- JX-01a ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-01a', 'hash LIPSĂ (edge J04 nerulat / nedeployat) + J07 permisivă → REFUZ J04');
-- @edge j07 1
SELECT jx.egal(jx.blocaje(1), '[]', 'J07 permisivă');
SELECT jx.ok(NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_verificari), 'nicio dovadă J04');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Propunere.docx: verificare PASS lipsă');
SELECT jx.trecut('JX-01a');
ROLLBACK;
SELECT jx.baza_intacta('JX-01a');

-- JX-01b ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-01b', 'hash INVALID (bytes din bucket ≠ SHA din manifest) → edge J04 persistă REFUZ + J07 permisivă → REFUZ J04');
:admin
SELECT jx.inlocuieste('pt/1/v1/depus/depus_final_Final.pdf', 'ALT CONTINUT decat cel din manifest');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'false', 'J04 nu confirmă pachetul');
SELECT jx.egal((SELECT to_jsonb(array_agg(v->>'rezultat' ORDER BY v->>'nume')) FROM jsonb_array_elements(jx.ultim('j04')->'verificari') v),
  '["PASS","PASS","REFUZ","PASS"]', 'Doar Final.pdf e REFUZ (ordine: Borderou, Dovada, Final, Propunere)');
SELECT jx.ok(EXISTS (SELECT 1 FROM ofertare_pt_pachet_verificari WHERE rezultat = 'REFUZ' AND motiv = 'SHA-256 diferit de manifest'
  AND fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf'), 'REFUZ-ul e persistat (append-only), cu motivul edge-ului');
SELECT jx.egal(jx.blocaje(1), '[]', 'J07 permisivă');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Final.pdf: verificare PASS lipsă, SHA diferit');
SELECT jx.trecut('JX-01b');
ROLLBACK;
SELECT jx.baza_intacta('JX-01b');

-- JX-01c ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-01c', 'hash STALE: PASS, apoi obiectul reurcat cu ACEEAȘI bytes (updated_at nou) + J07 permisivă → REFUZ J04 (identitatea contează, nu doar SHA)');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate 4');
:admin
SELECT jx.inlocuieste('pt/1/v1/depus/depus_final_Final.pdf', 'final v1');
SELECT jx.ok((SELECT metadata->>'eTag' = md5('final v1') FROM storage.objects WHERE name = 'pt/1/v1/depus/depus_final_Final.pdf'), 'aceleași bytes (eTag identic)');
SELECT jx.egal(jx.blocaje(1), '[]', 'J07 permisivă');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Final.pdf: verificare PASS lipsă, SHA diferit sau verificare veche');
SELECT jx.trecut('JX-01c');
ROLLBACK;
SELECT jx.baza_intacta('JX-01c');

-- JX-01d ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-01d', 'hash STALE: PASS, apoi obiectul suprascris cu ALȚI bytes (updated_at/eTag/size noi) + J07 permisivă → REFUZ J04');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate 4');
:admin
SELECT jx.inlocuieste('pt/1/v1/Borderou.docx', 'borderou MODIFICAT dupa verificare');
SELECT jx.egal(jx.blocaje(1), '[]', 'J07 permisivă');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Borderou.docx: verificare PASS lipsă, SHA diferit sau verificare veche');
SELECT jx.trecut('JX-01d');
ROLLBACK;
SELECT jx.baza_intacta('JX-01d');

-- JX-01e ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-01e', 'hash STALE: PASS, apoi obiect șters + reurcat (alt obj_id, aceleași bytes) + J07 permisivă → REFUZ J04');
-- @edge j04 1
-- @edge j07 1
:admin
SELECT jx.reurca('pt/1/v1/depus/dovada_seap_Dovada.pdf');
SELECT jx.ok((SELECT o.id <> v.obj_id FROM storage.objects o JOIN ofertare_pt_pachet_verificari v ON v.fisier_path = o.name
  WHERE o.name = 'pt/1/v1/depus/dovada_seap_Dovada.pdf' LIMIT 1), 'obiectul are alt id decât cel verificat');
SELECT jx.egal(jx.blocaje(1), '[]', 'J07 permisivă');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Dovada.pdf: verificare PASS lipsă, SHA diferit sau verificare veche');
SELECT jx.trecut('JX-01e');
ROLLBACK;
SELECT jx.baza_intacta('JX-01e');

-- JX-01f ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-01f', 'hash STALE: PASS, apoi obiectul ȘTERS din bucket + J07 permisivă → REFUZ J04 (obiect inexistent)');
-- @edge j04 1
-- @edge j07 1
:admin
SELECT jx.sterge('pt/1/v1/Propunere.docx');
SELECT jx.egal(jx.blocaje(1), '[]', 'J07 permisivă');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Propunere.docx: obiect inexistent în bucket-ul ofertare');
SELECT jx.trecut('JX-01f');
ROLLBACK;
SELECT jx.baza_intacta('JX-01f');

-- JX-01g ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-01g', 'hash STALE: PASS, apoi obiectul GOLIT (size 0) + J07 permisivă → REFUZ J04 (obiect gol)');
-- @edge j04 1
-- @edge j07 1
:admin
SELECT jx.goleste('pt/1/v1/Borderou.docx');
SELECT jx.egal(jx.blocaje(1), '[]', 'J07 permisivă');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Borderou.docx: obiect gol sau dimensiune necunoscută');
SELECT jx.trecut('JX-01g');
ROLLBACK;
SELECT jx.baza_intacta('JX-01g');

-- JX-01h ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-01h', 'eroare internă J04 (RPC snapshot indisponibil) → 4 REFUZ persistate, fără PASS + J07 permisivă → REFUZ J04');
-- @edge j04 1 snapshot=indisponibil
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'false', 'J04 nu confirmă');
SELECT jx.ok((SELECT count(*) = 4 AND bool_and(rezultat = 'REFUZ' AND motiv LIKE '%indisponibil%') FROM ofertare_pt_pachet_verificari),
  'eroarea tehnică devine REFUZ persistat, niciodată PASS');
SELECT jx.egal(jx.blocaje(1), '[]', 'J07 permisivă');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Propunere.docx: verificare PASS lipsă');
SELECT jx.trecut('JX-01h');
ROLLBACK;
SELECT jx.baza_intacta('JX-01h');

-- JX-01i ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-01i', 'hash PARȚIAL: obiect rescris ÎN TIMPUL verificării (snapshot înainte ≠ după) → 3 PASS + 1 REFUZ + J07 permisivă → REFUZ J04 pe acel fișier');
-- @edge j04 1 schimba_in_timpul=pt/1/v1/depus/depus_final_Final.pdf
-- @edge j07 1
SELECT jx.ok((SELECT count(*) FILTER (WHERE rezultat = 'PASS') = 3 AND count(*) FILTER (WHERE rezultat = 'REFUZ'
  AND motiv = 'obiect schimbat în timpul verificării' AND fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf') = 1 FROM ofertare_pt_pachet_verificari),
  '3 PASS + REFUZ „obiect schimbat în timpul verificării”');
SELECT jx.egal(jx.blocaje(1), '[]', 'J07 permisivă');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Final.pdf: verificare PASS lipsă');
SELECT jx.trecut('JX-01i');
ROLLBACK;
SELECT jx.baza_intacta('JX-01i');

-- JX-01j ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-01j', 'PASS FALS scris direct cu cheia de serviciu: calculat≠declarat → CHECK; SHA corect dar identitate de obiect inventată → acceptat ca rând, REFUZ la tranziție (J07 permisivă)');
-- @edge j07 1
:service
SELECT jx.refuza($$INSERT INTO ofertare_pt_pachet_verificari(pachet_fisier_id, bucket, fisier_path, obj_id, obj_updated_at, obj_size,
    sha256_calculat, sha256_declarat, rezultat) SELECT id, 'ofertare', fisier_path, gen_random_uuid(), now(), 10, repeat('b', 64), sha256, 'PASS'
    FROM ofertare_pt_pachet_fisiere WHERE fisier_path = 'pt/1/v1/Propunere.docx'$$, '23514', 'ofertare_pt_verificari_pass_chk');
INSERT INTO ofertare_pt_pachet_verificari(pachet_fisier_id, bucket, fisier_path, obj_id, obj_updated_at, obj_etag, obj_size,
    sha256_calculat, sha256_declarat, rezultat)
  SELECT id, 'ofertare', fisier_path, gen_random_uuid(), now(), 'etag-inventat', size_bytes, sha256, sha256, 'PASS'
  FROM ofertare_pt_pachet_fisiere WHERE pachet_id = 1 AND rol IN ('propunere_docx', 'borderou_docx', 'depus_final', 'dovada_seap');
:admin
SELECT jx.ok((SELECT count(*) FROM ofertare_pt_pachet_verificari WHERE rezultat = 'PASS') = 4, '4 PASS-uri false inserate');
SELECT jx.egal(jx.blocaje(1), '[]', 'J07 permisivă');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Propunere.docx: verificare PASS lipsă, SHA diferit sau verificare veche');
SELECT jx.trecut('JX-01j');
ROLLBACK;
SELECT jx.baza_intacta('JX-01j');
