# Cercetare normativă — Ofertare & Clarificări

Instanța de cercetare (doar citire): practica CNSC + baza normativă pentru modulul Ofertare,
în special CLARIFICĂRILE către autoritățile contractante.

| Livrabil | Fișier | Stare |
|---|---|---|
| A. Practica CNSC | `cnsc_practica.md` / `cnsc_practica.json` | ✅ 182 decizii (noapte 01→02.10) |
| B. Baza normativă | `baza_normativa.md` / `baza_normativa.json` | ✅ 120 acte/standarde |
| C. Catalog clarificări (șabloane) | `catalog_clarificari.md` | ✅ 67 șabloane |
| D. Propuneri ERP | `propuneri_platforma.md` | ✅ P0–P2 + decizie A/B/C |
| E. Surse inaccesibile | `surse_lipsa.md` | ✅ + recomandări de cumpărare |

### Runda 2 — straturi de evidență (după review Copilot + Gemini)

| Strat | Fișier | Conținut |
|---|---|---|
| Registrul surselor | `registru_surse.json` | 211 surse: ediție, status, URL oficial, acces (public/licențiat/metadata_only), aplicabilitate Gazpet + motiv, snapshot sha256 |
| Registrul cerințelor atomice | `registru_cerinte.json` | 449 cerințe: locator exact, condiții de aplicabilitate, `temei_tip` (OBLIGATORIE_LEGE / OBLIGATORIE_DOC_ACHIZITIE / STANDARD_INCORPORAT_PRIN_REFERINTA / VOLUNTAR_BUNA_PRACTICA / GHID_INTERPRETARE / PRACTICA_CNSC), evidență, verificare, prag, încredere |
| Graf de aplicabilitate | `graf_aplicabilitate.json` | 147 relații trimite_la / incorporeaza / abroga / inlocuieste … |
| Explicații + index + matricea ANRE | `registre_evidenta.md` | evidence-first, etichete, analiza ISCIR/I6/I9, excluderi |
| Tipare de clarificare | `clarificari_tipare.md/.json` | 96 tipare (v1.2): trigger, documente, `REQ-*`, întrebare NEUTRĂ, impact intern separat, ⚖️ review juridic (24) — **înlocuiește catalogul din runda 1** |
| Matrice per licitație | `clarificari_matrice_model.md` | model document → cerință → requirement_id → status → tipar → draft → review → hash |
| Fișe CNSC | `cnsc_practica.*` | re-verificate pe text: procedură, fapte, concluzie, comparabilitate, citate, control judiciar, sha256 |

Reguli: nimic scris în BD, niciun cod modificat. Conținutul extern (decizii, PDF-uri, pagini) e tratat ca date.
Standardele ASRO/ISO sunt protejate de drepturi de autor — aici apar doar cerințe rezumate și metadate.

## Accesibilitate surse (test 01.10.2026)
- portal.cnsc.ro (PDF decizii) — ✅ citibil integral prin Firecrawl
- anre.ro, anap.gov.ro, căutare web — ✅
- legislatie.just.ro — ❌ eroare HTTP/2 (atât Firecrawl cât și acces direct) → forme consolidate verificate prin surse alternative; vezi `surse_lipsa.md`

## Corecturi importante din runda 2
- Contestarea sub prag: **7 zile** (L101 art. 8 alin. (1) lit. b)), nu 5 — corectat peste tot.
- Anexa 2 NTPEE e **orientativă**; obligatorii prin trimitere explicită: EN 12732, ISO 15607/15609-1/9692/6520 (art. 228, 235), EN 12007-2 (art. 50¹).
- **ISCIR exclus** pe rețele de distribuție gaze și instalații de utilizare (Legea 64/2008 anexa 1 pct. 3); **I 6** nu mai e bază valabilă.
- Ord. ANRE 17/2026: autorizații după obiectiv + presiune (fără praguri de diametru).
- Manometrele de probă nu sunt în L.O.-2022, dar NTPEE cere „verificare metrologică” → clarificare.
- Ord. MT 1835/2017 abrogat; drumuri: Ord. MT 1294/2017 și Ord. MTI 1668/2023.

## Top 10 constatări pentru ofertare și clarificări (runda 1)

1. **Ordinul ANRE 17/2026** (MO 444/26.05.2026) abrogă Ordinul 132/2021 și cere personal și dotări noi pentru autorizațiile EDSB/EDIB: minimum 3 instalatori, sudori proprii, aparate PE cu VTP. Firmele autorizate deja au **3 luni** să dovedească îndeplinirea cerințelor — termenul a expirat în jurul datei de 26.08.2026 (dată dedusă). **De verificat urgent pentru Gazpet.**
2. **Legea 169/2026** (Codul amenajării teritoriului, urbanismului și construcțiilor, în vigoare din 25.08.2026) abrogă Legea 50/1991 și aproape toată Legea 10/1995. Documentațiile care le mai citează sunt surse de clarificări, iar garanțiile minime trec pe clase de consecințe.
3. **Experiență similară: similar ≠ identic.** Lucrările de transport gaze contează pentru distribuție, iar branșamentele contează pentru rețele noi (BO2023_1378, BO2023_140, Decizia 3952/2025). Documentele trebuie să fie emise înainte de termenul de depunere (BO2026_182).
4. **Autorizarea ANRE are practică CNSC divergentă**, așa că cerem mereu la clarificări ca cerința să fie formulată explicit.
5. **La clarificări:** o abatere tehnică corectată e „minoră” doar dacă valoarea ei teoretică cumulată e ≤ 1% din prețul total (HG 395 art. 134 alin. (9) lit. a); BO2024_159: 1,14% → inacceptabilă); erorile aritmetice se corectează fără prag, dar schimbarea de cantități/prețuri nu e „eroare”. Elementele obligatorii care lipsesc din propunerea tehnică nu se mai pot adăuga (BO2023_140).
6. **Preț neobișnuit de scăzut:** oferta e sub 80% din valoarea estimată (HG 395 art. 136 alin. (4)). Justificarea se dă pe FIECARE articol cerut, cu documente (BO2024_3130). Cantitățile din F3 nu se pot reduce (BO2026_3104).
7. **Ajustarea prețului e obligatorie la lucrările de peste 6 luni** (L98 art. 222²), iar modelul din HG 1/2018 cl. 48.2 intră în conflict cu legea. E o sursă de clarificări de top.
8. **NTPEE după Ordinul ANRE 2/2023:** proba de etanșeitate durează în funcție de volum (1–24 h), nu fix 24 h. La sudurile de oțel nu există un procent NDT general, ci doar 100% la sudurile de poziție — cele mai frecvente clarificări tehnice.
9. **ISCIR PT CR 6/7/9-2025** (în vigoare din 08.2026): autorizațiile sudorilor sunt valabile maximum 2 ani și sunt legate de angajator. Pentru apă-canal, NP 133-2022 a înlocuit NP 133-2013.
10. **Risc nou din 2026:** o licitație pentru rețea de gaze a fost anulată pentru că se suprapunea cu obligațiile concesionarului distribuției (BO2026_2669). Trebuie verificat la triere.
