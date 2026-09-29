-- JX-08 · Cerința 8: la REFUZ, starea și dovezile anterioare NU sunt suprascrise. (Fiecare refuz din suită trece deja
-- prin jx.refuza = fotografie completă înainte/după; aici: dovezi acumulate + refuzuri de toate tipurile, append-only
-- impus pe server chiar și pentru cheia de serviciu și superuser, edge-urile refuzate nu scriu.)

-- JX-08a ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-08a', 'dovezi acumulate (REFUZ J04 tehnic + PASS J04 + rezultate J07) rămân byte-identice după 5 refuzuri de tipuri diferite; stare, aprobare, depus_la neatinse');
-- @edge j04 1 snapshot=indisponibil
-- @edge j04 1
-- @edge j07 1
:admin
SELECT jx.ok((SELECT count(*) FROM ofertare_pt_pachet_verificari) = 8 AND (SELECT count(*) FROM ofertare_poarta_rezultate_text) = 8,
  '8 verificări J04 (4 REFUZ + 4 PASS) + 8 rezultate J07 (aprobare + depunere)');
CREATE TEMP TABLE d0 AS SELECT jx.dovezi() AS d;
-- 1) J07 blocat de un control SQL live
:editor
UPDATE ofertare_pt_legaturi SET stare = 'blocata', constatare = 'probă' WHERE id = 1;
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["neverificate"]');
UPDATE ofertare_pt_legaturi SET stare = 'verificata', constatare = NULL WHERE id = 1;
-- 2) J04: obiect rescris după PASS
:admin
SELECT jx.inlocuieste('pt/1/v1/Borderou.docx', 'borderou rescris');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Borderou.docx: verificare PASS lipsă');
-- 3) matrice: retrogradare; 4) depus_la direct; 5) cheia de serviciu
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'propus' WHERE id = 1$$, 'P0001', 'aprobat → propus');
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET depus_la = now() WHERE id = 1$$, 'P0001', 'depus_la se scrie doar');
:service
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Borderou.docx: verificare PASS lipsă');
:admin
SELECT jx.egal(jx.dovezi(), (SELECT d FROM d0), 'dovezile și starea sunt byte-identice după toate refuzurile');
SELECT jx.ok((SELECT stare = 'aprobat' AND depus_la IS NULL AND aprobat_la IS NOT NULL FROM ofertare_pt_pachet WHERE id = 1), 'pachetul e tot aprobat');
SELECT jx.trecut('JX-08a');
ROLLBACK;
SELECT jx.baza_intacta('JX-08a');

-- JX-08b ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-08b', 'append-only pe server: UPDATE/DELETE/TRUNCATE pe verificările J04 și rezultatele J07 → REFUZ pentru cheia de serviciu (GRANT) și superuser (trigger); DELETE pe auditul J05 refuzat; manifest/pachet nemodificabile din API');
-- @edge j04 1
-- @edge j07 1
-- Două straturi: cheia de serviciu are doar SELECT+INSERT (GRANT); superuser-ul, care ocolește GRANT-urile, e oprit de trigger.
:service
SELECT jx.refuza($$UPDATE ofertare_pt_pachet_verificari SET rezultat = 'PASS', motiv = NULL$$, '42501', 'permission denied');
SELECT jx.refuza($$DELETE FROM ofertare_pt_pachet_verificari WHERE rezultat = 'REFUZ'$$, '42501', 'permission denied');
SELECT jx.refuza($$UPDATE ofertare_poarta_rezultate_text SET stare = 'ok'$$, '42501', 'permission denied');
SELECT jx.refuza($$DELETE FROM ofertare_poarta_rezultate_text$$, '42501', 'permission denied');
:admin
SELECT jx.refuza($$UPDATE ofertare_pt_pachet_verificari SET motiv = 'rescris de superuser'$$, '42501', 'append-only');
SELECT jx.refuza($$TRUNCATE ofertare_pt_pachet_verificari$$, '42501', 'append-only');
SELECT jx.refuza($$TRUNCATE ofertare_poarta_rezultate_text$$, '42501', 'append-only');
SELECT jx.refuza($$DELETE FROM ofertare_poarta_rezultate_text$$, '42501', 'append-only');
SELECT jx.refuza_oricare($$DELETE FROM ofertare_derogari_audit$$, ARRAY['42501', 'P0001']);
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet_fisiere SET sha256 = repeat('0', 64) WHERE pachet_id = 1$$, '42501', 'permission denied');
SELECT jx.refuza($$DELETE FROM ofertare_pt_pachet_fisiere WHERE pachet_id = 1$$, '42501', 'permission denied');
SELECT jx.refuza($$DELETE FROM ofertare_pt_pachet WHERE id = 1$$, '42501', 'permission denied');
SELECT jx.trecut('JX-08b');
ROLLBACK;
SELECT jx.baza_intacta('JX-08b');

-- JX-08c ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-08c', 'edge-urile refuzate nu scriu nimic: J04 pe pachet inexistent (404) sau depus (409), J07 pe sursă ilizibilă (409); rezultatele noi se ADAUGĂ, cele vechi rămân (prefix identic)');
:admin
SELECT jx.fotografiaza('inainte');
-- @edge j04 99
SELECT jx.egal(jx.ultim('j04')->'status', '404', 'J04: pachet inexistent → 404');
:admin
ALTER TABLE ofertare_cerinte RENAME COLUMN text_cerinta TO text_cerinta_indisponibil;
-- @edge j07 1
SELECT jx.egal(jx.ultim('j07')->'status', '409', 'J07: sursă ilizibilă → 409');
ALTER TABLE ofertare_cerinte RENAME COLUMN text_cerinta_indisponibil TO text_cerinta;
SELECT jx.neschimbat('inainte', 'edge-urile refuzate nu au scris nimic');
-- @edge j07 1
:admin
CREATE TEMP TABLE t0 AS SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS t FROM ofertare_poarta_rezultate_text t;
:editor
SELECT jx.editeaza_capitol(1, 'Anexa 1; garanție 36 luni; 372 branșamente (v2)');
-- @edge j07 1
:admin
SELECT jx.ok((SELECT jsonb_agg(x ORDER BY n) FROM jsonb_array_elements((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM ofertare_poarta_rezultate_text t))
  WITH ORDINALITY e(x, n) WHERE n <= (SELECT jsonb_array_length(t) FROM t0)) = (SELECT t FROM t0), 'rezultatele vechi J07 sunt prefix neschimbat');
SELECT jx.ok((SELECT count(*) FROM ofertare_poarta_rezultate_text) = (SELECT jsonb_array_length(t) FROM t0) + 4, 'reevaluarea a ADĂUGAT 4 rânduri');
-- și pentru J04: pachetul depus nu mai acceptă verificări (409), dovezile rămân
-- @edge j04 1
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
:admin
SELECT jx.fotografiaza('depus');
-- @edge j04 1
SELECT jx.egal(jx.ultim('j04')->'status', '409', 'J04 pe pachet depus → 409');
SELECT jx.neschimbat('depus', 'J04 refuzat pe pachet depus nu scrie');
SELECT jx.trecut('JX-08c');
ROLLBACK;
SELECT jx.baza_intacta('JX-08c');
