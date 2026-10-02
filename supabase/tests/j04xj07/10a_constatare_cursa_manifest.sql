-- @clona
-- JX-C1 · CONSTATARE (nu cerință; constatarea #1 din integrarea J04×J07): cursa dintre tranziția în curs și un
-- INSERT concurent în manifest. A a trecut de ambele triggere (UPDATE → depus, încă fără COMMIT); B inserează un rând
-- depus_final: politica RLS R11 vede încă „aprobat” (snapshot fără commit-ul lui A), FK-ul ia doar FOR KEY SHARE (nu intră
-- în conflict cu FOR NO KEY UPDATE al lui A) → B reușește. După COMMIT-ul lui A: pachet DEPUS cu un fișier fără PASS.
-- Testul FIXEAZĂ comportamentul actual: dacă o remediere (ex. trigger BEFORE INSERT pe manifest cu FOR SHARE pe pachet
-- + reverificarea stării) intră, aserțiunea „cursa reprodusă” pică și testul trebuie mutat la cerințe (B refuzat).
-- @sesiune A
SELECT jx.start('JX-C1', 'CONSTATARE #1: INSERT concurent în manifest în timpul tranziției → pachet depus cu fișier fără PASS (cursa reprodusă, neremediată)');
-- @edge j04 1
-- @edge j07 1
:editor
BEGIN;
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
-- @sesiune B
:editor
SET lock_timeout = '2s';
SELECT jx.urca('pt/1/v1/depus/depus_final_Concurent.pdf', 'concurent');
SELECT jx.fisier(1, 'depus_final', 'Concurent.pdf', 'pt/1/v1/depus/depus_final_Concurent.pdf', 'concurent');
RESET lock_timeout;
-- @sesiune A
COMMIT;
:admin
SELECT jx.ok(jx.stare(1) = 'depus'
  AND EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere f WHERE f.pachet_id = 1 AND f.nume = 'Concurent.pdf'
    AND NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_verificari v WHERE v.pachet_fisier_id = f.id AND v.rezultat = 'PASS')),
  'cursa reprodusă: pachet depus + Concurent.pdf fără PASS');
SELECT jx.constatare('JX-C1', 'reprodus: {"stare":"depus","fara_pass":["Concurent.pdf"]} — B a inserat în manifest în timpul tranziției lui A');
-- După COMMIT, aceeași inserție e refuzată de RLS (pachetul nu mai e aprobat): cursa există doar în fereastra tranziției.
-- @sesiune B
:editor
SELECT jx.urca('pt/1/v1/depus/depus_final_Tarziu.pdf', 'tarziu');
SELECT jx.refuza($$SELECT jx.fisier(1, 'depus_final', 'Tarziu.pdf', 'pt/1/v1/depus/depus_final_Tarziu.pdf', 'tarziu')$$, '42501', 'row-level security');
SELECT jx.trecut('JX-C1');
