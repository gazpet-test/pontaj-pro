# Faza 1 — ramura NATIV completă (PDF → intermediar → validare → .docx)

**Data:** 12.08.2026, tura de noapte · **Material:** `Caiet_de_sarcini.pdf` (SNIF, 109 pag, criptat RC4-permisiuni)
**Spec:** claude_docs `spec_import_documente_v3` §5 etapele 1–7, §8, §10, §12.

## Cum se rulează (fără nicio intervenție manuală)

```bash
python3 scripts/import_documente/extract_nativ.py     # PDF → out/intermediar.md + media/ + extract_meta.json
python3 scripts/import_documente/valideaza_nativ.py   # → out/raport_validare.json (exit 1 = ceva de revizuit)
node scripts/import_documente/gen_docx.mjs            # → out/Caiet_de_sarcini.docx
```

Toate cu default-uri pe fixture; primul argument = alt PDF / alt director.
`out/` e gitignored — totul regenerabil. **La deschiderea .docx în Word: apare
întrebarea de actualizare câmpuri → „Da"** (populează cuprinsul cu hyperlink-uri).

## Criteriile de acceptare §12 (F1 nativ)

| # | Criteriu | Status |
|---|---|---|
| 1 | 109 pag criptate → .docx fără intervenție | ✅ 3 comenzi, zero pași manuali |
| 2 | CAP. 1..8 ȘI romane = Heading 1 | ✅ 19 H1: CAP. 1–6 arabe + 7, 8 (promovate prin cuprins) + CAP. I–XI romane |
| 3 | Cuprins original eliminat, TOC generat cu hyperlink | ✅ 156 linii dot-leader eliminate; TableOfContents + updateFields |
| 4 | Antetul SNIF nu apare de 109 ori | ✅ 649 linii mobilier eliminate; „SNIF" rămâne doar în 6 mențiuni legitime din corp |
| 5 | Diacritice corecte (ș/ț și ş/ţ) | ✅ ambele forme prezente și în md și în docx |
| 6 | 46 tabele = tabele Word | ✅* 40 tabele + 5 convertite în liste (defect 2 = cerință) + 1 **casetă de subsol goală** exclusă corect — „46" din referință includea acest artefact |
| 7 | Ștampile/semnături = imagini la locul lor | ✅ 52 imagini la poziția Y sursă (34 fișiere unice — docx deduplică octeții identici) |
| 8 | Raport validare | ✅ raport_validare.json, V1–V8 (UI vine în F3+) |
| 9 | Fiecare paragraf trasabil la pagina sursă | ✅ 109 bookmark-uri `pag_sursa_N` (Word: Inserare → Marcaj) |
| 10 | Originalul neatins | ✅ sha256 identic cu HEAD; decriptarea se face pe copie temporară ștearsă la final |

**Test de deschidere independent:** LibreOffice Writer (headless) a randat .docx-ul
în PDF de 150 pagini fără nicio eroare; python-docx (parser independent) îl citește
integral: 2.212 paragrafe, 40 tabele, headinguri 19/126/17/7.

## Capturi ale validării care dovedesc REGULA DE AUR

- **V3 marchează o neconcordanță REALĂ din sursă**: cuprinsul original zice
  „1.5. Proiectant **de specialitate**", corpul zice „1.5. Proiectant **general**".
  Sistemul nu a corectat nimic — a marcat pentru om. (Echivalentul narativ al
  criteriului §12.12 de la cantitativ.)
- Intrarea 64/65 din cuprins regăsită ca titlu; restul verificărilor PASS.

## Peste referința `intermediar.md` (sesiunea paralelă)

1. Titlurile rupte pe rânduri/fragmente sunt ÎNTREGI: „CAP. VII. CONTROLUL
   CALITĂȚII LUCRĂRILOR – CALITATEA ÎN CONSTRUCȚII" (referința: `## CONTROLUL`
   pe un rând, restul cuvintelor separate), „CAP. I. STANDARDELE … PROBE, TESTE,
   VERIFICĂRI." pe 3 rânduri unite (referința: trunchiat la „TREBUIE").
2. Fragmentele de pe același baseline (titluri justificate sparte de PyMuPDF în
   câte o „linie" pe cuvânt) se unesc geometric.
3. Absorbția continuărilor de titlu e **ghidată de cuprinsul original** — se
   oprește exact unde intrarea din cuprins se termină (propozițiile bold-caps de
   sub titlu nu se lipesc).
4. Sub-titluri prinse și cu spațiu lipsă („5.4.Materiale"), numerotare ROMANĂ
   (III.1) și 4 niveluri (7.3.1.1) — în referință rămâneau lipite în paragrafe.
5. Paragrafele respectă granițele de bloc ale sursei; bulinele „- " sunt itemi
   reali, cu continuările relipite (referința avea aceleași rupturi).
6. Caseta goală de subsol nu devine tabel fantomă.

## Arhitectura confirmată pentru F2+ (scan)

Vezi `REZULTATE-SPIKE.md`: narativ scan = Claude direct (Tesseract fallback);
cantitativ = doi cititori independenți (Tesseract TSV + Claude), dezacord → om;
Azure = rezervă. Formatul `intermediar.md` + `extract_meta.json` + validarea
V1–V8 sunt COMUNE ambelor ramuri — exact ce cere §5 (etapele 4–7 refolosite).
