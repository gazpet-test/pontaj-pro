-- @clona
-- JX-C1 · CERINȚĂ (remediată 06.10.2026, JILAVA_DECIZII A.2; fosta constatare #1 din integrarea J04×J07): cursa dintre tranziția
-- în curs și un INSERT concurent în manifest. A a trecut de ambele triggere (UPDATE → depus, încă fără COMMIT); B încearcă un rând
-- depus_final. Înainte: RLS-ul R11 vedea „aprobat” (snapshot fără commit-ul lui A), FK-ul lua doar FOR KEY SHARE → B reușea și
-- pachetul ajungea DEPUS cu un fișier fără PASS. Acum triggerul BEFORE INSERT blochează pachetul FOR SHARE (conflict cu UPDATE-ul
-- lui A) → B AȘTEAPTĂ (aici: lock_timeout 2 s → 55P03); după COMMIT-ul lui A, același INSERT vede starea comisă „depus” → 42501.
-- @sesiune A
SELECT jx.start('JX-C1', 'C1 remediat: INSERT concurent în manifest în timpul tranziției → B așteaptă tranziția (55P03), apoi e refuzat (42501); pachet depus fără fișiere fără PASS');
-- @edge j04 1
-- @edge j07 1
:editor
BEGIN;
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
-- @sesiune B
:editor
SET lock_timeout = '2s';
SELECT jx.urca('pt/1/v1/depus/depus_final_Concurent.pdf', 'concurent');
SELECT jx.refuza($$SELECT jx.fisier(1, 'depus_final', 'Concurent.pdf', 'pt/1/v1/depus/depus_final_Concurent.pdf', 'concurent')$$, '55P03', 'lock timeout');
RESET lock_timeout;
-- @sesiune A
COMMIT;
:admin
SELECT jx.ok(jx.stare(1) = 'depus'
  AND NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere f WHERE f.pachet_id = 1 AND f.nume = 'Concurent.pdf')
  AND NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere f WHERE f.pachet_id = 1 AND public.fn_pt_fisier_cere_verificare(f.rol)
    AND NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_verificari v WHERE v.pachet_fisier_id = f.id AND v.rezultat = 'PASS')),
  'pachet depus; Concurent.pdf NU a intrat; niciun fișier verificabil fără PASS');
-- După COMMIT, aceeași inserție e refuzată de triggerul de manifest (starea comisă = depus), pentru editor și pentru cheia de serviciu.
-- @sesiune B
:editor
SELECT jx.refuza($$SELECT jx.fisier(1, 'depus_final', 'Concurent.pdf', 'pt/1/v1/depus/depus_final_Concurent.pdf', 'concurent')$$, '42501', 'Manifestul pachetului 1 e închis (stare depus)');
:service
SELECT jx.refuza($$SELECT jx.fisier(1, 'depus_final', 'Concurent.pdf', 'pt/1/v1/depus/depus_final_Concurent.pdf', 'concurent')$$, '42501', 'Manifestul pachetului 1 e închis (stare depus)');
SELECT jx.trecut('JX-C1');
