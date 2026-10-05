---
name: verificare-oferta-licitatie
description: "Verificare completă a ofertei Gazpet față de documentația SEAP a unei licitații: F3 vs liste de cantități, planșe vs devize, raport de diferențe și solicitare de clarificări."
---

# Verificare ofertă licitație — Gazpet Instal
Versiune skill: v2.1 · 05.10.2026
Schimbări v2.1 (lecția Mânăstirea CN1095546, 05.10.2026 — clarificarea nr. 11 scrisă în 6 versiuni): §0 regula ghilimelelor (nu citezi ce n-ai văzut în textul extras / pe PDF); §1.4 registrul de termene din ERP + datele depunerilor din `.p7s`; §1.9 solicitările depuse ≠ întrebările interne; §7.3 citatele din clarificare se verifică pe document înainte de Copilot; §7.7 ora locală; §8 „revenire la solicitare" când AC nu răspunde.
Schimbări v2.0: unificat versiunea din cont cu cea din repo (lecțiile Răcari 11.09); §0 Python disponibil, puntea de fișiere de reverificat, pornire din modulul Ofertare; §2–3 OCR local PaddleOCR-VL în loc de tăiere PDF + citire imagini; §5 cota TVA după dată; §7 mailul și clarificările = DRAFT până la aprobare + review Copilot. Review Jakarinos (GO cu modificări) integrat: §1 regimul legal + registru versiuni/erate + matrice cerință–dovadă + ANRE; §5 nuanțe la respingere, erori favorabile, indici, TVA; §9 poartă finală umană.

Se aplică peste regulamentul din skill-ul `gazpet-proiecte`. Scopul: să nu depunem o ofertă cu cantități diferite de listele de cantități (motiv de respingere ca neconformă) și să prindem la timp incoerențele proiectantului care ne costă bani în execuție.

## 0. Condiții

- Folderul licitației conectat în Claude (butonul „Add folder"). Fără el nu se poate.
- Desktop Commander online pe stația lui Răzvan — verifică cu `list_devices`.
- Node pe stație (`where node`). **Python e instalat** pe stația lui Răzvan (cu `pymupdf`) — folosește-l pentru extragere de text și randare de pagini; scripturile scrise pe stație sunt ASCII-only, rulate cu `PYTHONIOENCODING=utf-8`.
- Dacă licitația e deja în **modulul Ofertare din ERP** (bucket `ofertare`, dosarul cu id-ul licitației), pornește de la documentele și cerințele extrase acolo; nu le reextrage de la zero.
- **Regula ghilimelelor (05.10.2026)**: nu pui între ghilimele, în niciun livrabil (clarificare, raport, mail, contestație), un text pe care nu l-ai văzut tu în **textul extras** al documentului sau pe PDF. Rezumatul AI din ERP (`analiza.citire_noi.rezumat`, `citita_rezumat`) e **interpretare, nu citat** — la Mânăstirea un „citat" din erata AC luat din rezumat a ajuns în clarificarea oficială și a trebuit înlocuit după verificarea pe PDF. Când ai doar rezumatul, scrii „potrivit eratei din 14.09.2026, …" fără ghilimele, sau deschizi „Text original" / PDF-ul și citezi exact, cu pagina.

Puntea de fișiere binare (`device_stage_files` / `device_commit_files`) era nefuncțională de la update-ul Windows din 08.09.2026 — **verifică întâi dacă merge**. Dacă nu merge: **tot ce citești din folder se face prin Desktop Commander**, iar livrabilele .docx/.xlsx ajung la utilizator prin `SendUserFile` sau ca atașament de mail, nu scrise direct pe NAS. Rapoartele .md se scriu direct în folder cu `write_file`.

## 1. Inventar și date de bază

1. `device_list_dir` recursiv pe folderul licitației.
2. Dacă există `Cerinte licitatie.xlsx` (sau similar), citește-l primul — colegii au extras deja cerințele din caietul de sarcini. `read_file` îl întoarce ca matrice.
3. Citește, în ordine: Fișa de date (Instructiuni_ofertanti_FisaDate_*.pdf), Instrucțiunile pentru ofertanți, Modelul de contract (Formularul 12). Astea dau valoarea estimată, garanțiile, termenul, ajustarea prețului, penalitățile, criteriul de atribuire.
4. Notează termenul de solicitare a clarificărilor și termenul de răspuns al AC. Sunt în Fișa de date, secțiunea I.3 („Numar zile pana la care se pot solicita clarificari … N" și „va raspunde … cu N zile / in a N-a zi inainte"). În ERP, tab-ul **Detalii → ⏱ Registru termene** le calculează din textul fișei (întrebări până la / AC răspunde până la / depunere / contestație per act publicat, L101 art. 8: 7 zile sub prag, 10 zile la/peste pragul de lucrări). E orientativ: confirmi cifrele pe fișă, nu le iei din memorie („3 zile" din memoria colegilor nu avea temei). Toate orele SEAP sunt **ora României**; în BD `termen_depunere` e UTC (12:00Z = 15:00).
5. **Stabilește regimul legal**: achiziție clasică (Legea 98/2016 + HG 395/2016) sau **sectorială** (Legea 99/2016 + HG 394/2016 — frecvent la operatorii de gaze/utilități). Termenele, regulile de clarificare și de corectare diferă.
6. **Registru de versiuni**: fiecare document SEAP cu data/versiunea, toate eratele și toate răspunsurile AC la clarificări. La fiecare răspuns/erată nouă se reverifică ce afectează (liste de cantități, cerințe, termene) — înainte de depunere, verificarea se rulează pe ULTIMA versiune.
7. **Matrice cerință → dovadă**: fiecare cerință din Fișa de date (DUAE, asociați/subcontractanți/terți susținători, experiență similară, personal, garanția de participare, perioada de valabilitate, propunerea tehnică, graficul, justificarea prețului) cu documentul nostru care o acoperă și responsabilul. Golurile se semnalează imediat.
8. **Autorizări ANRE**: tipul și valabilitatea autorizațiilor cerute (verificate în registrul public ANRE la data depunerii), pentru Gazpet și pentru subcontractanți/terți.
9. **Solicitările depuse ≠ întrebările interne.** Întrebările noastre din SEAP nu sunt publice: ce s-a depus efectiv se vede în folderul `Clarificari` al licitației (NAS), iar **data depunerii = timestamp-ul semnăturii din fișierul `.p7s`**, nu data din antetul documentului și nu data din ERP. Înainte să scrii „solicitările noastre nr. 1–10 din 28.08, 01.09 …" numeri fișierele depuse și citești `.p7s`-urile; dacă nu poți, nu pui date. O solicitare depusă după termenul de întrebări (Mânăstirea nr. 10, 30.09) nu se invocă drept „în termen".

## 2. Verifică dacă documentele au strat de text

Documentele SEAP sunt frecvent scanate ca imagini. Testul rapid, pe stație:

```
cd %TEMP% & mkdir pdfx & cd pdfx & npm init -y & npm i pdf-parse pdf-lib --silent --no-audit --no-fund
```

Apoi un script Node care rulează `pdfjs-dist/legacy/build/pdf.mjs` peste fiecare PDF și scrie textul într-un .txt. Dacă ies câteva sute de octeți pentru 100+ pagini → e scanat, mergi pe ruta de la §3.

Căi: hardcodează calea în script, nu o pasa ca argument de linie de comandă — spațiile din numele folderelor strică quoting-ul în `cmd /c`.

## 3. Documente scanate — OCR local (ruta principală)

Pe stația dedicată rulează **PaddleOCR-VL-1.6** (Ollama: `seriouswebby/paddleocr-vl-1.6`; ideal pipeline-ul oficial PaddleOCR). Testat pe Jilava 02.10.2026: listă de cantități 26/26 numere regăsite, ~1–5 s/pagină.

- Randează pagina la **100 dpi** (la 150 dpi paginile dense dau eroare/buclă) cu `pymupdf`, trimite imaginea cu promptul **`Table Recognition:`** pentru tabele și `OCR:` pentru text; `num_ctx` mare (16k), `temperature 0`.
- Ieșirea conține tag-uri de coordonate `<|LOC_n|>` — elimină-le pentru text, dar păstrează-le dacă ai nevoie de poziția dovezii pe pagină.
- Salvează textul **per pagină**, cu proveniența (fișier, pagină, model, dată). Documentul scanat rămâne sursa primară; OCR-ul e transcriere asistată.
- Fiecare cantitate care intră în comparație se verifică pe celulă (simbol + U.M. + cantitate); orice neclaritate = `NEREZOLVAT` și blochează concluzia pe acel articol.
- Tabele dense care intră în buclă (repetă aceeași valoare) → reia pagina la alt dpi sau taiat pe jumătăți; dacă tot nu merge, ruta de rezervă de mai jos.

## 3b. Rezervă: tăierea listelor de cantități pe devize

`read_file` pe un PDF scanat întoarce imaginile paginilor (le poți citi), dar peste ~20 de pagini dă timeout sau trunchiere. Soluția: taie PDF-ul cu `pdf-lib` în fișiere mici și citește-le pe rând.

Structura tipică a unui fișier „Liste de cantitati fara valori": un bloc identic per stradă/obiect, în ordine alfabetică pe localitate apoi pe stradă. La Racari blocul avea 11 pagini: F1 (1), F2 (1), F3 (4), C6 (2), C7 (1), C8 (1), C9 (1). **Verifică numărul de pagini per bloc împărțind totalul la numărul de devize și confirmă vizual pe primele două blocuri** — nu presupune.

Generează apoi un PDF per deviz doar cu paginile F3 și citește-le cu `read_file`.

Ce NU merge: `setRotation` și `setCropBox` — randorul le ignoră, nu câștigi rezoluție. Scanurile rotite 90° se citesc totuși bine așa cum sunt.

## 4. Parsarea ofertei noastre

F3-ul nostru (`F3 rev*.docx` din `gazpet\lucru`) e un text dump din programul de devize. `read_file` pe el poate depăși limita de context — rezultatul se salvează automat într-un fișier local pe care îl parsezi cu Python în container.

Extrage din fiecare `<w:t>` linia și prinde articolele cu un regex care acceptă toate unitățile de măsură: `M.C.`, `M.P.`, `BUC.`, `TONA`, `KG`, `M`, `T`. Atenție: dacă ceri minimum 2 caractere pentru UM, pierzi toate articolele cu `M` (țeavă, cablu) — jumătate din deviz.

Structura unei poziții: `NR SIMBOL [varianta] UM CANTITATE`, urmată de linia cu denumirea, apoi materialele aferente cu același NR.

**Numerele se citesc pe paragraf întreg, nu pe bucăți (lecția Răcari, 11.09.2026).** Doclib rupe frecvent o cantitate în mai multe `<w:t>` din același `<w:p>` („1,50" + „6"). Regexul se aplică DOAR după ce ai concatenat toate `<w:t>` ale paragrafului; altfel citești 1,500 în loc de 1,506 și raportezi Oanei o „rotunjire" care nu există. Orice cantitate care iese „rotundă" (x,500 / x,750 / x,000) acolo unde SEAP are zecimale se reverifică pe textul brut al paragrafului înainte de a intra în raport.

## 5. Comparația

Confruntă fiecare deviz, poziție cu poziție. Ies trei categorii:

**a) Diferențe la noi — se corectează.** Instrucțiunile pentru ofertanți interzic modificarea cantităților din listele de cantități. Regula noastră internă: ZERO abateri la depunere, inclusiv rotunjirile (1,500 în loc de 1,506). Juridic, unele erori se pot corecta ulterior în condiții limitate (HG 395/2016 art. 134–137, respectiv normele sectoriale) — dar asta e plasă de siguranță, nu strategie: nu ne bazăm pe ea.

**b) Indici de variantă `[n]` diferiți — NU sunt erori.** Doclib își ordonează singur variantele de rețetă, deci indicii diferă SISTEMATIC de cei din SEAP. Când simbolul articolului, cantitatea, **denumirea, U.M. și resursele/specificațiile** coincid, diferența de indice nu se raportează ca „diferență de corectat" și nu intră în mailul către Oana ca problemă; cel mult o listă informativă, separată, „indici de aliniat la final". Alinierea o face Oana înainte de depunere, după ce primim rețetele cerute la clarificări (Răcari, 11.09.2026).

**c) Erori ale proiectantului aparent în favoarea noastră — NU se corectează în ofertă** (cantitatea din liste e obligatorie; o preiei ca atare) și se notează în raport, ca să nu o „corecteze" cineva. Dacă se semnalează sau nu în clarificări e o **decizie a lui Răzvan, pe caz**: o cantitate supraestimată nu garantează venit (la decontare se plătește ce s-a executat și măsurat), iar o eroare de proiect poate ascunde o problemă tehnică sau contractuală. Raportul arată impactul tehnic, contractual și la decontare pentru fiecare astfel de punct.

**TVA:** oferta se compară fără TVA; unde intervine TVA (F1, garanții, valoare estimată), cota standard e 19% până la 31.07.2025 și **21% de la 01.08.2025**, după data faptului generator, nu după data devizului. Taxarea inversă și scutirile sunt **regimuri fiscale distincte, nu „cotă 0%"** — se verifică separat, după Codul fiscal și documentația AC. Nu presupune cota din memorie.

**Control de completitudine:** numărul de pagini și de articole citite = numărul din document; fără duplicate; separatorii zecimali/de mii interpretați corect; totalurile pe deviz recalculate. Pentru fiecare diferență raportată se păstrează captura/pagina-dovadă.

Fă și o verificare de coerență internă: raportul cantitate/metru liniar e un **indicator** (nu o regulă) și ar trebui să fie apropiat pe devize similare. Abaterile sunt fie erori ale proiectantului, fie erori de citire de-ale tale — verifică a doua oară înainte de a le raporta.

## 6. Planșele față de liste

Din PTh, citește memoriul tehnic și planșele de detalii (de obicei ultimele 5-6 pagini din partea 1). Compară legendele planșelor cu articolele din deviz. Ce caută:

- elemente desenate sau cerute în memoriu care nu au niciun articol în liste (răsuflători, manșoane, vane de secționare, cămine);
- materiale numite diferit în planșă față de deviz (tip de teu, de robinet, de regulator, de firidă) — sunt diferențe reale de preț;
- diametre care nu se potrivesc între memoriu, textul articolului și codul de material.

## 7. Livrabile

1. `VERIFICARE F3 rev* vs SEAP - <data>.md` în `gazpet\lucru` — scris direct cu `write_file`.
2. `VERIFICARE scheme montaj vs F3 - <data>.md`, tot acolo.
3. Solicitarea de clarificări ca .docx — **DRAFT**, cu **fiecare citat și fiecare dată verificate pe document** (regula ghilimelelor din §0; lista verificărilor se păstrează lângă draft, ca `VERIFICARE_TEMEIURI_<data>.md`), apoi revizuit de Copilot (poarta GO/NO-GO, conținutul integral — diff/text efectiv, nu „e în PR #…", fără date interne inutile) și aprobat de Răzvan înainte de depunere — generată cu `docx` (npm) în container, în formatul clarificărilor anterioare din folderul `clarificari`: antet către autoritatea contractantă, referință la anunțul SEAP, puncte numerotate, semnătura S.C. GAZPET INSTAL S.R.L.
4. Handoff-ul proiectului actualizat în Project.
5. Clarificările se depun în SEAP DOAR cu semnătură electronică. Colegii pot rescrie puncte din draft (Mânăstirea: pct. 7) — versiunea depusă se salvează pe NAS ca `… - FINAL.docx` lângă `.p7s`, iar variantele intermediare (v5/v6/_rezerva) rămân până vine răspunsul AC; ștergerea lor e decizia lui Răzvan. Dacă semnatarul nu e disponibil în ziua planificată, pleacă în următoarea zi lucrătoare (Răcari: pregătite vineri, depuse luni, tardive). Planifică depunerea cu o zi de rezervă față de termenul din Fișa de date și spune explicit în mail cine semnează și când. Termenul se scrie cu **ora locală** (ex. „14.10.2026, ora 15:00"), luată din SEAP (`tenderReceiptDeadline`) sau din ERP (afișat deja pe ora României), nu din valoarea UTC din BD.
6. Mail către Oana Nica (`oana.nica@gazpet.ro`) — **doar `create_draft` + preview în chat; pleacă numai la „trimite” explicit al lui Răzvan** (protocolul din `gazpet-proiecte` §10.1) — cu documentul atașat (base64 în `create_draft`), care să conțină explicit: ce se corectează în F3, de ce intră fiecare punct în clarificare, unde sunt rapoartele și ce NU se semnalează.

## 8. Ce intră și ce nu intră în clarificare

Intră: neconcordanțe între documente, elemente lipsă din liste, specificații care lipsesc, clauze contractuale ambigue sau dezavantajoase (ajustarea prețului, mecanismul de plată, perioada de garanție, avansul, durata).

Când AC **nu a răspuns consolidat** până la termenul din fișă și termenul de întrebări a trecut, documentul nu e „contestație" și nu e „clarificare nouă", ci **revenire la solicitare** (L98 art. 160–161 / L99 art. 173): recapitulează solicitările depuse (numărate din NAS, §1.9), arată ce s-a publicat între timp fără răspuns, și **se încheie cu solicitarea de decalare a termenului** proporțional cu modificările. Contestația (L101) e decizie separată a lui Răzvan, cu sesiunea juridică (termen 7/10 zile de la act, cauțiune).

NU intră: clauzele care ne avantajează (penalități de întârziere anormal de mici, cantități supraestimate), și nici scăpările proiectantului care sunt publice pentru toți ofertanții și nu creează un avantaj ilegal — semnalarea lor doar atrage atenția concurenței.

## 9. Verificări finale înainte de depunere

- Nu s-a eliminat și nu s-a introdus niciun articol de deviz (interzis fără erată a AC).
- Aceleași prețuri unitare pentru aceeași operațiune/resursă în toată oferta; aceleași cote de indirecte și profit; niciun articol cu valoarea 0.
- Cheltuielile indirecte detaliate conform Anexei 6 din Ghidul P91/1.02.
- Valorile din F3 preluate corect în F2 și din F2 în F1.
- C6–C9 prezentate în forma cerută de Instrucțiuni (de regulă pe fiecare deviz în parte, nu cumulat).
- Cotele de indirecte/profit uniforme și lipsa articolelor cu valoare 0 se verifică față de ce cere documentația (nu ca dogmă); orice excepție se justifică în ofertă.
- Verificarea s-a rulat pe ultima versiune a documentației (registrul de la §1.6), inclusiv toate eratele și răspunsurile AC.

## 10. Poarta finală — umană
Decizia de depunere o ia un om, cu responsabil numit (Răzvan sau cine desemnează el). Orice neconcordanță materială nerezolvată (`NEREZOLVAT`) blochează depunerea. După încărcare: verificarea semnăturilor electronice pe fiecare fișier, a listei de fișiere încărcate și a recipisei SEAP. Review-ul Copilot/al altor agenți e a doua opinie, nu aprobarea finală.