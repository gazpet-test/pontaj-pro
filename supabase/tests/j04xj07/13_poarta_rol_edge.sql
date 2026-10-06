-- JX-07k · poarta de rol a edge-urilor (CLAUDE.md pct. 7d: verify_jwt nu ajunge; JILAVA_DECIZII L3). Handler-ele REALE (J04
-- index.ts, J07 handler.ts) cu poartaOfertare.ts reală: anonim (fără utilizator) → 401, cont fără modulul Ofertare → 403;
-- niciun rând de verificare J04 / rezultat J07 persistat. Mutantul XP_poarta_oricine (poarta lasă pe oricine) trebuie ucis aici.

-- JX-07k ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-07k', 'poarta de rol a edge-urilor J04 și J07: anonim → 401, cont fără modulul Ofertare → 403; nimic persistat');
SELECT jx.fotografiaza('JX-07k');
-- @edge j04 1 ca=anon status=401
-- @edge j07 1 ca=anon status=401
-- @edge j04 1 ca=00000000-0000-4000-8000-000000000099 status=403
-- @edge j07 1 ca=00000000-0000-4000-8000-000000000099 status=403
SELECT jx.neschimbat('JX-07k', 'refuzurile porții de rol nu persistă nimic (verificări J04, rezultate J07, manifest, Storage)');
SELECT jx.trecut('JX-07k');
ROLLBACK;
SELECT jx.baza_intacta('JX-07k');
