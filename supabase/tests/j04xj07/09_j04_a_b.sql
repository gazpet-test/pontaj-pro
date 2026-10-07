-- JX-09 · Cerința 9 (J04 A→B): obiectul verificat A e înlocuit cu B. Reverificarea lui B cât manifestul e încă pentru A
-- → REFUZ; PASS doar după manifest/versiune actualizate printr-o tranziție PERMISĂ (pachet nou v2: propus → aprobat
-- cu J07 → depunere cu B, J04 + J07). Aplicația nu poate rescrie manifestul (append-only) și nici „fabrica” un PASS.
-- (Rescrierea manifestului cu cheia de serviciu e constatarea JX-C3, în 10_constatari.sql.)

-- JX-09a ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-09a', 'A verificat (PASS) → obiect înlocuit cu B → REFUZ (verificare veche); reverify B cu manifestul pe A → REFUZ persistat (SHA diferit) → tranziția tot REFUZ');
-- @edge j04 1
-- @edge j07 1
:admin
SELECT jx.inlocuieste('pt/1/v1/depus/depus_final_Final.pdf', 'FINAL B');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Final.pdf: verificare PASS lipsă, SHA diferit sau verificare veche');
-- @edge j04 1
SELECT jx.egal((SELECT to_jsonb(v->>'motiv') FROM jsonb_array_elements(jx.ultim('j04')->'verificari') v WHERE v->>'nume' = 'Final.pdf'),
  '"SHA-256 diferit de manifest"', 'reverify B: REFUZ, manifestul cere A');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Final.pdf: verificare PASS lipsă, SHA diferit');
SELECT jx.trecut('JX-09a');
ROLLBACK;
SELECT jx.baza_intacta('JX-09a');

-- JX-09b ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-09b', 'PASS „fabricat” pentru B (cheia de serviciu, identitatea reală a obiectului B): calculat=declarat=B → acceptat ca rând, dar nu acoperă manifestul A → REFUZ; calculat=B/declarat=A → CHECK');
-- @edge j07 1
:admin
SELECT jx.inlocuieste('pt/1/v1/depus/depus_final_Final.pdf', 'FINAL B');
:service
INSERT INTO ofertare_pt_pachet_verificari(pachet_fisier_id, bucket, fisier_path, obj_id, obj_updated_at, obj_etag, obj_size,
  sha256_calculat, sha256_declarat, rezultat, verificat_de)
SELECT f.id, 'ofertare', o.name, o.id, o.updated_at, o.metadata->>'eTag', (o.metadata->>'size')::bigint, jx.sha('FINAL B'), jx.sha('FINAL B'), 'PASS', :'uid_editor'
FROM ofertare_pt_pachet_fisiere f JOIN storage.objects o ON o.bucket_id = 'ofertare' AND o.name = f.fisier_path
WHERE f.fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf';
SELECT jx.refuza($$INSERT INTO ofertare_pt_pachet_verificari(pachet_fisier_id, bucket, fisier_path, obj_id, obj_updated_at, obj_etag, obj_size,
  sha256_calculat, sha256_declarat, rezultat) SELECT f.id, 'ofertare', o.name, o.id, o.updated_at, o.metadata->>'eTag', (o.metadata->>'size')::bigint,
  jx.sha('FINAL B'), f.sha256, 'PASS' FROM ofertare_pt_pachet_fisiere f JOIN storage.objects o ON o.name = f.fisier_path
  WHERE f.fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf'$$, '23514', 'ofertare_pt_verificari_pass_chk');
-- @edge j04 1
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Final.pdf: verificare PASS lipsă, SHA diferit');
SELECT jx.trecut('JX-09b');
ROLLBACK;
SELECT jx.baza_intacta('JX-09b');

-- JX-09c ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-09c', 'aplicația NU poate „actualiza” manifestul A→B pe v1: UPDATE/DELETE → permission denied; rând duplicat → unique; rând nou B lângă A → A tot cere PASS pe bytes A → REFUZ');
-- @edge j07 1
:admin
SELECT jx.inlocuieste('pt/1/v1/depus/depus_final_Final.pdf', 'FINAL B');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet_fisiere SET sha256 = jx.sha('FINAL B') WHERE fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf'$$, '42501', 'permission denied');
SELECT jx.refuza($$DELETE FROM ofertare_pt_pachet_fisiere WHERE fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf'$$, '42501', 'permission denied');
SELECT jx.refuza($$SELECT jx.fisier(1, 'depus_final', 'Final.pdf', 'pt/1/v1/depus/depus_final_Final.pdf', 'FINAL B')$$, '23505', 'ofertare_pt_pachet_fisiere_unic');
SELECT jx.urca('pt/1/v1/depus/depus_final_Final_B.pdf', 'FINAL B');
SELECT jx.fisier(1, 'depus_final', 'Final_B.pdf', 'pt/1/v1/depus/depus_final_Final_B.pdf', 'FINAL B');
-- @edge j07 1
-- @edge j04 1
SELECT jx.egal((SELECT jsonb_object_agg(v->>'nume', v->>'rezultat') FROM jsonb_array_elements(jx.ultim('j04')->'verificari') v
  WHERE v->>'nume' LIKE 'Final%'), '{"Final.pdf":"REFUZ","Final_B.pdf":"PASS"}', 'B are PASS pe rândul lui; rândul A rămâne și e REFUZ');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Final.pdf: verificare PASS lipsă, SHA diferit');
SELECT jx.trecut('JX-09c');
ROLLBACK;
SELECT jx.baza_intacta('JX-09c');

-- JX-09d ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-09d', 'calea PERMISĂ: pachet nou v2 (propus → manifest → J07 → aprobat → depunere cu B → J04 + J07) → depus; v1 nu mai poate fi depus, deși are PASS valabil pe bytes-ii A (J07 pachet_versiune)');
:editor
INSERT INTO ofertare_pt_pachet(id, licitatie_id, versiune) VALUES (2, 1, 2);
INSERT INTO ofertare_pt_pachet_fisiere(pachet_id, rol, nume, sha256, anexa_ref, semnat) VALUES (2, 'anexa', 'Anexa 1.pdf', repeat('a', 64), 'Anexa 1', true);
SELECT jx.urca('pt/1/v2/Propunere.docx', 'propunere tehnica v2');
SELECT jx.urca('pt/1/v2/Borderou.docx', 'borderou v2');
SELECT jx.fisier(2, 'propunere_docx', 'Propunere.docx', 'pt/1/v2/Propunere.docx', 'propunere tehnica v2');
SELECT jx.fisier(2, 'borderou_docx', 'Borderou.docx', 'pt/1/v2/Borderou.docx', 'borderou v2');
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'aprobat', aprobat_de = auth.uid() WHERE id = 2$$, 'P0001', 'J07: controale blocante');
-- @edge j07 1
:editor
UPDATE ofertare_pt_pachet SET stare = 'aprobat', aprobat_de = auth.uid() WHERE id = 2;
SELECT jx.urca('pt/1/v2/depus/depus_final_Final.pdf', 'FINAL B');
SELECT jx.urca('pt/1/v2/depus/dovada_seap_Dovada.pdf', 'dovada v2');
SELECT jx.fisier(2, 'depus_final', 'Final.pdf', 'pt/1/v2/depus/depus_final_Final.pdf', 'FINAL B');
SELECT jx.fisier(2, 'dovada_seap', 'Dovada.pdf', 'pt/1/v2/depus/dovada_seap_Dovada.pdf', 'dovada v2');
-- @edge j07 1
-- v1: chiar cu toate dovezile J04 valabile, nu mai e „pachetul curent”.
-- @edge j04 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'v1 are PASS pe bytes-ii A');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: pachet_versiune');
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 2$$, 'P0001', 'Propunere.docx: verificare PASS lipsă');
-- @edge j04 2
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'v2: PASS pe toate fișierele, inclusiv B');
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 2;
:admin
SELECT jx.ok(jx.stare(2) = 'depus' AND jx.stare(1) = 'aprobat', 'v2 depus cu B; v1 rămâne aprobat (istoric)');
SELECT jx.ok(EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere f JOIN ofertare_pt_pachet_verificari v ON v.pachet_fisier_id = f.id
  WHERE f.pachet_id = 2 AND f.nume = 'Final.pdf' AND f.sha256 = jx.sha('FINAL B') AND v.rezultat = 'PASS'), 'dovada PASS pentru B e pe manifestul v2');
:editor
UPDATE ofertare_licitatii SET status = 'depusa' WHERE id = 1;
SELECT jx.trecut('JX-09d');
ROLLBACK;
SELECT jx.baza_intacta('JX-09d');

-- JX-09e ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-09e', 'A→B→A: bytes-ii A readuși (identitate nouă) → PASS-ul vechi e stale → REFUZ; reverify → PASS pe A → depus (PASS = bytes din manifest + obiectul curent)');
-- @edge j04 1
-- @edge j07 1
:admin
SELECT jx.inlocuieste('pt/1/v1/depus/depus_final_Final.pdf', 'FINAL B');
SELECT jx.inlocuieste('pt/1/v1/depus/depus_final_Final.pdf', 'final v1');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Final.pdf: verificare PASS lipsă, SHA diferit sau verificare veche');
-- @edge j04 1
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
SELECT jx.ok(jx.stare(1) = 'depus', 'depus pe A reverificat');
SELECT jx.trecut('JX-09e');
ROLLBACK;
SELECT jx.baza_intacta('JX-09e');

-- JX-09f ─────────────────────────────────────────────────────────────────────────────────────────────
-- C2 (ultima verificare decide) face ca în JX-09b REFUZ-ul real de după PASS-ul fabricat să decidă singur. Aici PASS-ul fabricat
-- pentru B (cheia de serviciu, identitatea reală a obiectului B, calculat = declarat = B) e chiar ULTIMUL rând al fișierului: doar
-- potrivirea SHA dovadă ↔ manifest (A) îl mai poate refuza.
BEGIN;
SELECT jx.start('JX-09f', 'PASS fabricat pentru B ca ULTIMĂ verificare (identitate reală, calculat=declarat=B), manifestul pe A → REFUZ J04 doar prin potrivirea SHA cu manifestul');
-- @edge j07 1
:admin
SELECT jx.inlocuieste('pt/1/v1/depus/depus_final_Final.pdf', 'FINAL B');
-- @edge j04 1
SELECT jx.ok((SELECT rezultat = 'REFUZ' FROM ofertare_pt_pachet_verificari WHERE fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf' ORDER BY id DESC LIMIT 1)
  AND (SELECT count(*) = 3 FROM ofertare_pt_pachet_verificari WHERE rezultat = 'PASS'), 'J04 real: 3 PASS, Final.pdf REFUZ (bytes B ≠ manifest A)');
:service
INSERT INTO ofertare_pt_pachet_verificari(pachet_fisier_id, bucket, fisier_path, obj_id, obj_updated_at, obj_etag, obj_size,
  sha256_calculat, sha256_declarat, rezultat, verificat_de)
SELECT f.id, 'ofertare', o.name, o.id, o.updated_at, o.metadata->>'eTag', (o.metadata->>'size')::bigint, jx.sha('FINAL B'), jx.sha('FINAL B'), 'PASS', :'uid_editor'
FROM ofertare_pt_pachet_fisiere f JOIN storage.objects o ON o.bucket_id = 'ofertare' AND o.name = f.fisier_path
WHERE f.fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf';
:admin
SELECT jx.ok((SELECT rezultat = 'PASS' AND sha256_calculat = jx.sha('FINAL B') FROM ofertare_pt_pachet_verificari
  WHERE fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf' ORDER BY id DESC LIMIT 1), 'ultimul rând al Final.pdf: PASS fabricat pe B');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Final.pdf: verificare PASS lipsă, SHA diferit');
SELECT jx.trecut('JX-09f');
ROLLBACK;
SELECT jx.baza_intacta('JX-09f');
