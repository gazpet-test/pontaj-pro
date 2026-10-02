-- Suita extinsă J04×J07 — starea de bază (COMMIT în baza locală de unică folosință).
-- Licitația 1, cu TOATE condițiile fluxului normal satisfăcute (cantități F3 validate, cerință confirmată și
-- acoperită pe scan, capitol scris de om cu legătură verificată, grafic, garanție structurată, SEAP complet),
-- și pachetul v1 APROBAT prin fluxul real al UI-ului: manifest → recalcul J07 (edge real) → aprobat (J07 impus).
-- După aprobare, ca la „Marchează depus”: obiectele depuse în SEAP + dovada, apoi rândurile de manifest.
-- Nicio verificare J04 și niciun rezultat J07 pentru manifestul de după aprobare: fiecare test le face singur.
BEGIN;
:editor
INSERT INTO ofertare_licitatii(id, responsabil_id) VALUES (1, :'uid_editor');
INSERT INTO ofertare_cantitati(id, licitatie_id, denumire, categorie, um, cantitate, status, tip_sursa, sursa, extras_de_ai)
  VALUES (1, 1, 'Conductă', 'Conducte', 'm', 1000, 'validat', 'lista_f3', 'F3', false);
INSERT INTO ofertare_cerinte(id, licitatie_id, confirmata_de, text_cerinta)
  VALUES (1, 1, :'uid_editor', 'garanție 36 luni, 372 branșamente');
INSERT INTO ofertare_acoperire(id, cerinta_id, status, verificat_pe_scan) VALUES (1, 1, 'acoperit', true);
INSERT INTO ofertare_pt_capitole(id, licitatie_id, nr, titlu, eticheta, continut)
  VALUES (1, 1, 1, 'Metodologie', 'Anexa 1', 'Anexa 1; garanție 36 luni; 372 branșamente');
INSERT INTO ofertare_pt_legaturi(id, cerinta_id, capitol_id) VALUES (1, 1, 1);
INSERT INTO grafic_parametri VALUES (1, '{"fronturi":[{"lungime_m":1000}]}');
INSERT INTO grafic_versiuni(licitatie_id, versiune, activitati) VALUES (1, 1, '[{"id":1,"durata_zile":5,"predecesori":[]}]');
INSERT INTO ofertare_pt_garantie VALUES (1, 36, 36, 'pif', 'pif', :'uid_editor', NULL);
INSERT INTO seap_compl VALUES (1, NULL);
INSERT INTO ofertare_pt_pachet(id, licitatie_id, versiune) VALUES (1, 1, 1);
INSERT INTO ofertare_pt_pachet_fisiere(pachet_id, rol, nume, sha256, anexa_ref, semnat)
  VALUES (1, 'anexa', 'Anexa 1.pdf', repeat('a', 64), 'Anexa 1', true);
SELECT jx.urca('pt/1/v1/Propunere.docx', 'propunere tehnica v1');
SELECT jx.urca('pt/1/v1/Borderou.docx', 'borderou v1');
SELECT jx.fisier(1, 'propunere_docx', 'Propunere.docx', 'pt/1/v1/Propunere.docx', 'propunere tehnica v1');
SELECT jx.fisier(1, 'borderou_docx', 'Borderou.docx', 'pt/1/v1/Borderou.docx', 'borderou v1');
-- Aprobarea fără recalcul J07 e refuzată de server (J07 impus la propus→aprobat).
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'aprobat', aprobat_de = auth.uid() WHERE id = 1$$, 'P0001', 'J07:');
-- @edge j07 1
SELECT jx.egal((SELECT jsonb_agg(x->>'stare') FROM jsonb_array_elements(jx.ultim('j07')->'rezultate') x),
  '["ok","ok","ok","ok"]', 'Bază: evaluatorul REAL (evalueaza.mjs) dă OK pe cele 4 controale text');
:editor
UPDATE ofertare_pt_pachet SET stare = 'aprobat', aprobat_de = auth.uid() WHERE id = 1;
SELECT jx.urca('pt/1/v1/depus/depus_final_Final.pdf', 'final v1');
SELECT jx.urca('pt/1/v1/depus/dovada_seap_Dovada.pdf', 'dovada seap v1');
SELECT jx.fisier(1, 'depus_final', 'Final.pdf', 'pt/1/v1/depus/depus_final_Final.pdf', 'final v1');
SELECT jx.fisier(1, 'dovada_seap', 'Dovada.pdf', 'pt/1/v1/depus/dovada_seap_Dovada.pdf', 'dovada seap v1');
:admin
-- Gărzi de bază: pachet aprobat, J07 acum STALE (manifestul s-a schimbat după aprobare), nicio dovadă J04.
SELECT jx.ok(jx.stare(1) = 'aprobat', 'Bază: pachetul v1 e aprobat');
SELECT jx.egal(jx.blocaje(1), '["garantie","anexe","numere","pachet"]', 'Bază: rezultatele J07 de la aprobare sunt stale după manifestul depunerii');
SELECT jx.ok(NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_verificari), 'Bază: nicio verificare J04');
SELECT jx.ok((SELECT count(*) FROM ofertare_pt_pachet_fisiere WHERE pachet_id = 1 AND public.fn_pt_fisier_cere_verificare(rol)) = 4,
  'Bază: 4 fișiere cer dovadă J04 (propunere, borderou, depus_final, dovada_seap)');
INSERT INTO jx.config VALUES ('foto_baza', md5(jx.foto()::text));
COMMIT;
