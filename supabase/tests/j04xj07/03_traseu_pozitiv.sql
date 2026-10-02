-- JX-03 · Traseu pozitiv (cerința 3): hash J04 și poartă J07 CURENTE, toate condițiile fluxului normal satisfăcute
-- → aprobat→depus reușește (ca UI-ul: UPDATE … RETURNING id), apoi licitația → depusă (J02 + J07 în gate).

-- JX-03a ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-03a', 'J04 PASS + J07 OK → pachet depus (1 rând, depus_la = ora serverului, aprobarea neatinsă) → licitație depusă');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS pe toate 4');
SELECT jx.egal(jx.blocaje(1), '[]', 'J07: toate cele 12 controale ok');
SELECT jx.fotografiaza('aprobat');
:editor
WITH u AS (UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1 RETURNING id)
SELECT jx.ok((SELECT count(*) = 1 FROM u), 'UPDATE … RETURNING id întoarce exact pachetul (echivalentul .select(''id'').single())');
:admin
SELECT jx.ok((SELECT stare = 'depus' AND depus_la = now() FROM ofertare_pt_pachet WHERE id = 1), 'depus, cu depus_la pus de server');
SELECT jx.egal((SELECT to_jsonb(p) - 'stare' - 'depus_la' FROM ofertare_pt_pachet p WHERE p.id = 1),
  (SELECT (f->'pachete'->0) - 'stare' - 'depus_la' FROM jx.fotografii WHERE eticheta = 'aprobat'),
  'în afară de stare/depus_la, pachetul e neschimbat (aprobat_de / aprobat_la / versiune)');
SELECT jx.ok((SELECT count(*) = 4 FROM ofertare_pt_pachet_fisiere f JOIN storage.objects o ON o.name = f.fisier_path
  WHERE f.pachet_id = 1 AND public.fn_pt_fisier_cere_verificare(f.rol) AND EXISTS (SELECT 1 FROM ofertare_pt_pachet_verificari v
    WHERE v.pachet_fisier_id = f.id AND v.rezultat = 'PASS' AND v.sha256_calculat = f.sha256 AND v.obj_id = o.id
      AND v.obj_updated_at = o.updated_at)), 'fiecare fișier depus are dovadă PASS pe obiectul curent');
:editor
UPDATE ofertare_licitatii SET status = 'depusa' WHERE id = 1;
:admin
SELECT jx.ok((SELECT status = 'depusa' FROM ofertare_licitatii WHERE id = 1), 'licitația e depusă (J02: pachet depus; J07 reverificată în gate)');
SELECT jx.ok((SELECT count(*) = 0 FROM ofertare_derogari_audit), 'fără derogare J05');
SELECT jx.trecut('JX-03a');
ROLLBACK;
SELECT jx.baza_intacta('JX-03a');

-- JX-03b ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-03b', 'ordinea verificărilor nu contează: J07 înainte de J04 → depus (dovezile J04 nu intră în hash-ul J07)');
-- @edge j07 1
-- @edge j04 1
SELECT jx.egal(jx.blocaje(1), '[]', 'J07 rămâne OK după J04');
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
SELECT jx.ok(jx.stare(1) = 'depus', 'depus');
SELECT jx.trecut('JX-03b');
ROLLBACK;
SELECT jx.baza_intacta('JX-03b');

-- JX-03c ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-03c', 'reluare după refuz (ca UI-ul): primul „depus” refuzat fără J07 → nimic scris; J07 → al doilea „depus” reușește cu aceleași dovezi J04');
-- @edge j04 1
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
-- @edge j07 1
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
:admin
SELECT jx.ok(jx.stare(1) = 'depus', 'depus la a doua încercare');
SELECT jx.ok((SELECT count(*) = 4 FROM ofertare_pt_pachet_verificari), 'dovezile J04 de la prima încercare au fost folosite, nu dublate');
SELECT jx.trecut('JX-03c');
ROLLBACK;
SELECT jx.baza_intacta('JX-03c');
