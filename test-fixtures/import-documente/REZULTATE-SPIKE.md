# Spike A/B/C — OCR pe scan cantitativ (Import Documente)

**Data:** 11.08.2026, 23:40–00:00 · **Executat:** sesiunea principală Claude Code (aprobat Răzvan)
**Material:** paginile 26–35 din `Documentatie_fara_valori.pdf` (deviz F3 Bisericani 399/2021,
scan Xerox fără strat de text, rotații mixte 90°/270°), randate la 300dpi cu rotația aplicată.

## Concurenți

| | Motor | Config |
|---|---|---|
| **A** | Tesseract 5.3.4 | `ron` din **tessdata_best** (9.6MB), `--psm 6`, pagini întregi |
| **B** | Azure Document Intelligence | **NEEXECUTAT** — nu există cont/cheie Azure (punct deschis §13 din spec) |
| **C** | Claude API `claude-sonnet-5` | vision, pagini în 2 jumătăți cu 30pt suprapunere, JPEG q85, prompt strict „transcrie, nu corecta" |

## Rezultate pe indicativele de normă (metrica din spec §7)

Adevărul de pe hârtie stabilit vizual pe paginile 30 și 26 (citite de om/Fable direct din PNG).

| Metrică | A — Tesseract best | C — Claude sonnet |
|---|---|---|
| Indicativi distincți găsiți (10 pag) | 15 | **20** |
| Indicativi corupți (invalizi la regex) | **4** — `TSDO1C1`, `TSDO4C1`, `GDO5A1`, `IFFO9B1` (toate 0↔O) + `TSEO04B1` (O inserat) | **0** |
| Indicativi halucinați (nu există pe hârtie) | 0 | **0** — toți cei 5 „în plus" față de Tesseract verificați vizual pe pag. 26: există |
| `L = 907m` (pag. 30) | ✓ corect (best; pachetul standard citea 90m) | ✓ corect |
| Cantități `45.000 / 18.000 / 63.000` | ✓ dar cu zgomot de punctuație (`M,C,`) | ✓ curat |
| Cost | 0 $ | **0,47 $ / 10 pagini** (~0,047 $/pag; 100k tok in, 11k out) |
| Timp | ~2 s/pagină local | ~20 s/pagină prin edge |

**Fiecare indicativ existent doar în output-ul Tesseract e o versiune coruptă a unuia citit
corect de Claude** (`GDO5A1`↔`GD05A1` etc.) — împerechere perfectă, zero excepții.

## Concluzii

1. **Claude (sonnet) câștigă categoric pe acuratețe** pe fontul matricial al devizelor Transgaz:
   0 erori vs 5 corupții + rateuri de detecție la Tesseract best, pe același material.
2. **Costul e neglijabil la volumul real**: ~0,05 $/pagină → un deviz de 160 pag ≈ 7,5 $;
   la „doar licitații noi" = câțiva dolari pe lună.
3. **Suprapunerea jumătăților** produce rânduri duplicate la graniță — pasul de merge trebuie
   să dedublice (cost cunoscut al splitului, compensat de DPI-ul efectiv mai bun).
4. **Regexul structural din spec prinde toate erorile Tesseract** — rămâne plasa de siguranță
   indiferent de motor.

## Propunere de arhitectură (de validat cu Răzvan)

- **Scan narativ:** Claude direct (calitate + diacritice), Tesseract local = fallback gratuit.
- **Scan cantitativ:** **doi cititori independenți = Tesseract (cu coordonate din TSV) + Claude**;
  unde diferă → marcaj pentru om. Erorile lor sunt necorelate (tehnologii diferite) — exact
  scopul pentru care spec-ul propunea Azure, dar **fără vendor nou**: trasabilitatea (coordonate
  pe cuvânt) o dă Tesseract TSV, acuratețea o dă Claude, iar dezacordul = semnal.
- **Azure DI rămâne opțiune de rezervă** dacă practica arată că perechea de mai sus scapă erori
  corelate (improbabil, dar măsurabil după primele 2-3 licitații reale).

## Reproducere

```bash
# render: python3 + pymupdf (vezi istoricul sesiunii 11.08)
# A: tesseract spike/pNNN.png out -l ron --psm 6   (ron = tessdata_best!)
# C: edge function spike-ocr-claude (Supabase), input {b64, mime}, model claude-sonnet-5
```
Artefactele de lucru (`spike/`) sunt gitignored — regenerabile din PDF-urile fixture.
