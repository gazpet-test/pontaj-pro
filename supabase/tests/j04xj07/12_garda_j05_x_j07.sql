-- JX-J05-01 / JX-J05-02 · garda J05 (20261001a, live din 01.10; în fixture prin transplantul live 06.10) × J07.
-- JILAVA_DECIZII L2: derogarea ownerului (RPC) ocolește J02, dar NU J07; după depunere derogare_* sunt înghețate pentru toți
-- în afară de login-ul de administrare (postgres fără claims JWT).

-- JX-J05-01 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-J05-01', 'derogare owner prin RPC + J07 stale → status=depusa REFUZ J07, fără efect (audit neschimbat); după recalcul J07 → depusa pe derogare');
:owner
SELECT public.ofertare_derogare_depunere(1, 'DEROGARE OWNER test J05xJ07 (Jilava)', true);
:admin
SELECT jx.ok((SELECT derogare_depunere IS TRUE FROM ofertare_licitatii WHERE id = 1), 'derogarea e acordată prin RPC');
SELECT jx.ok((SELECT count(*) >= 1 FROM ofertare_derogari_audit WHERE licitatie_id = 1), 'acordarea e auditată (J05)');
SELECT jx.egal(jx.blocaje(1), '["garantie","anexe","numere","pachet"]', 'J07 încă stale (nerecalculată după manifestul depunerii)');
:owner
SELECT jx.refuza($$UPDATE ofertare_licitatii SET status = 'depusa' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
-- @edge j07 1
:owner
UPDATE ofertare_licitatii SET status = 'depusa' WHERE id = 1;
:admin
SELECT jx.ok((SELECT status = 'depusa' FROM ofertare_licitatii WHERE id = 1) AND jx.stare(1) = 'aprobat',
  'depusă pe derogare după J07 OK (pachetul rămâne aprobat — constatarea C4, acceptată)');
SELECT jx.trecut('JX-J05-01');
ROLLBACK;
SELECT jx.baza_intacta('JX-J05-01');

-- JX-J05-02 ─────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-J05-02', 'după depusa: derogare_* înghețate pentru owner, editor și cheia de serviciu (42501); login-ul de administrare (postgres fără claims) poate repara');
:owner
SELECT public.ofertare_derogare_depunere(1, 'DEROGARE OWNER test J05xJ07 (Jilava)', true);
-- @edge j07 1
:owner
UPDATE ofertare_licitatii SET status = 'depusa' WHERE id = 1;
SELECT jx.refuza($$UPDATE ofertare_licitatii SET derogare_motiv = 'rescris după depunere' WHERE id = 1$$, '42501', 'înghețate după depunere');
:editor
SELECT jx.refuza_oricare($$UPDATE ofertare_licitatii SET derogare_depunere = false WHERE id = 1$$, ARRAY['42501']);
:service
SELECT jx.refuza($$UPDATE ofertare_licitatii SET derogare_motiv = 'rescris de serviciu' WHERE id = 1$$, '42501', 'J05');
:admin
UPDATE ofertare_licitatii SET derogare_motiv = 'reparatie documentata (postgres)' WHERE id = 1;
SELECT jx.ok((SELECT derogare_motiv = 'reparatie documentata (postgres)' FROM ofertare_licitatii WHERE id = 1), 'administrarea (postgres fără claims) poate repara');
SELECT jx.trecut('JX-J05-02');
ROLLBACK;
SELECT jx.baza_intacta('JX-J05-02');
