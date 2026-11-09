# PR #999 — integrarea Modelului 1U cu antetul oficial (06.11.2026)

Branch: `redari/antet-sabloane`. Merge din `origin/main` @ `dcfc9d68`, peste baza PR #999 @ `69e99c5a`;
fără rebase, force push sau merge în main.

## Integrare și fișiere

Merge-ul Git a fost automat, fără fișiere unmerged sau conflicte textuale.
Conflictul de comportament #999/#1004 a fost rezolvat păstrând `faraDateFirma(pasi(doc), ...)`
și `adaugaAntet(zip, ...)` în constructorul comun `construieste`, după rețetele de text.
Astfel și `convocator_utilizator.docx` primește imaginea oficială exclusiv în header-ul primei pagini.

- `scripts/redari_sabloane_din_modele.mjs`: constructorul comun păstrat, comentarii actualizate pentru șase rețete și validarea 1U.
- `scripts/redari_sablon_cerere_imputernicire.mjs`: adăugat `--verifica` fără scriere, comparație octet cu octet, exit 1 la diferență.
- `src/redari/sabloaneA4.test.js`: Model 1U inclus la A4, antet first/titlePg, imagine exactă, lățime utilă și lipsa rândului firmei;
  inclus în `SCOS_INCEPUT`. Amprenta 1U provine independent din DOCX-ul main @ `dcfc9d68`.
  Verificată și completarea strictă a 1U cu QR și verso, cu date fictive.
- `src/redari/docx.test.js`: singura așteptare #1004 ajustată este antetul textual comun:
  după eliminarea rândului firmei, comparația privește primul text („Lider al Asocierii…”), înaintea destinatarilor diferiți.
- `docs/redari/SABLOANE.md`: excepția (10) include explicit 1U, șapte șabloane în total;
  §4 conține ieșirea integrală actuală a verificatorului.
- `docs/redari/RAPORT_PR3B.md`: statut actualizat, integrarea antetului explicată.
- `docs/redari/RAPORT_PR999_ACTUALIZARE.md`: acest raport al actualizării.

Model 1U: **validat de Razvan 06.11.2026**. Marcajele care îl declarau DRAFT au fost eliminate;
textele juridice ale rețetei nu au fost modificate. Alte documente DRAFT independente își păstrează statutul.
Aspectul antetului a fost verificat în Word și aprobat de Răzvan conform cererii; nu pretind o nouă verificare vizuală în această sesiune.

## Șabloane regenerate

Rulate `node scripts/redari_sabloane_din_modele.mjs` și `node scripts/redari_sablon_cerere_imputernicire.mjs`:
`convocator.docx`, `convocator_utilizator.docx`, `pv_a.docx`, `pv_b.docx`, `pv_c.docx`,
`adresa_uat.docx`, `cerere_imputernicire.docx`, toate în `public/redari/sabloane/`.
Cele șase șabloane existente în PR #999 sunt identice cu rezultatele regenerate; 1U este actualizat.
Ambele comenzi cu `--verifica` raportează `identic` pentru toate cele șapte fișiere.
`node scripts/redari_sabloane_verifica.mjs`: șapte șabloane OK, zero placeholder-e rupte.

## Verificări

- `npx vite build`: verde (exit 0); avertismente despre importuri mixte și chunk-uri mari.
- `npx vitest run`: 171 fișiere trecute, 3 sărite, 1 eșuat; 4177 teste trecute, 22 sărite, 1 eșuat.
  Eșecul este `api/_poartaOfertare.test.js:172`, așteptare 2 apariții ale căilor în workflow, rezultat 1.
  Main (#1005) a eliminat triggerul push în favoarea rulării săptămânale, fără ajustarea testului.
  Fișierele testului și workflow-ului sunt identice cu main; eșecul a fost reprodus separat pe main @ `dcfc9d68`.
  Nu au fost modificate în acest task, conform limitei „nu atinge alte module”. Cerința suitei complete verzi rămâne neîndeplinită din acest motiv.
- `npx vitest run src/redari/sabloaneA4.test.js src/redari/docx.test.js src/redari/sabloaneFinalV2.test.js`: 3 fișiere, 194 teste trecute.
- `git diff --check`: verde.
- Fără modificări proprii de migrări, module din afara Redări sau date reale; fișierele aduse prin merge sunt cele din main.

## Reguli L01–L25 pentru această actualizare

| Regulă | Respectare / dovadă |
|---|---|
| L01 | n/a |
| L02 | n/a |
| L03 | n/a |
| L04 | n/a |
| L05 | n/a |
| L06 | n/a |
| L07 | n/a |
| L08 | n/a |
| L09 | n/a |
| L10 | n/a |
| L11 | n/a |
| L12 | Toate cele șase rețete trec prin constructorul comun; amprenta independentă 1U și amprentele existente verifică textul integral, cu singura eliminare declarată în SCOS_INCEPUT. Verificatorul confirmă șapte șabloane fără placeholder-e rupte. |
| L13 | Păstrate selecțiile exacte și refuzurile explicite ale parserului de antet; sabloaneA4.test.js verifică atât documentele valide, cât și secțiuni multiple, header existent și sectPrChange. |
| L14 | n/a |
| L15 | n/a |
| L16 | n/a |
| L17 | n/a |
| L18 | --verifica pentru împuternicire raportează diferența cu exit 1; doar ENOENT este tratat drept fișier lipsă, celelalte erori de citire se propagă. |
| L19 | faraDateFirma + adaugaAntet rămân în construieste pentru toate rețetele; imaginea folosește modulul comun redari_antet.mjs și la împuternicire. |
| L20 | Teste pozitive pe toate șabloanele și pe convocatoare completate strict cu QR/verso; testele negative ale structurii de antet rămân verzi. |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a |
| L24 | n/a |
| L25 | DOCX-uri reale, imagine comparată octet cu octet cu referința, amprenta 1U din main și fraze juridice așteptate independent în docx.test.js; raportarea exactă a eșecului suitei complete. |
