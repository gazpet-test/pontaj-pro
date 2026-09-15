---
name: verificare-oferta-licitatie
description: "Verificare completă a ofertei Gazpet față de documentația SEAP a unei licitații: F3 vs liste de cantități, planșe vs devize, raport de diferențe și solicitare de clarificări."
---

# Verificare ofertă licitație — Gazpet Instal

Se aplică peste regulamentul din skill-ul `gazpet-proiecte`. Scopul: să nu depunem o ofertă cu cantități diferite de listele de cantități (motiv de respingere ca neconformă) și să prindem la timp incoerențele proiectantului care ne costă bani în execuție.

## 0. Condiții

- Folderul licitației conectat în Claude (butonul „Add folder"). Fără el nu se poate.
- Desktop Commander online pe stația lui Răzvan — verifică cu `list_devices`.
- Node pe stație (`where node`). Python de obicei NU e instalat; nu insista.

Puntea de fișiere binare (`device_stage_files` / `device_commit_files`) e nefuncțională de la update-ul Windows din 08.09.2026. Consecință: **tot ce citești din folder se face prin Desktop Commander**, iar livrabilele .docx/.xlsx ajung la utilizator prin `SendUserFile` sau ca atașament de mail, nu scrise direct pe NAS. Rapoartele .md se scriu direct în folder cu `write_file`.

## 1. Inventar și date de bază

1. `device_list_dir` recursiv pe folderul licitației.
2. Dacă există `Cerinte licitatie.xlsx` (sau similar), citește-l primul — colegii au extras deja cerințele din caietul de sarcini. `read_file` îl întoarce ca matrice.
3. Citește, în ordine: Fișa de date (Instructiuni_ofertanti_FisaDate_*.pdf), Instrucțiunile pentru ofertanți, Modelul de contract (Formularul 12). Astea dau valoarea estimată, garanțiile, termenul, ajustarea prețului, penalitățile, criteriul de atribuire.
4. Notează termenul de solicitare a clarificărilor și termenul de răspuns al AC. Sunt în Fișa de date, secțiunea I.3.

## 2. Verifică dacă documentele au strat de text

Documentele SEAP sunt frecvent scanate ca imagini. Testul rapid, pe stație:

```
cd %TEMP% & mkdir pdfx & cd pdfx & npm init -y & npm i pdf-parse pdf-lib --silent --no-audit --no-fund
```

Apoi un script Node care rulează `pdfjs-dist/legacy/build/pdf.mjs` peste fiecare PDF și scrie textul într-un .txt. Dacă ies câteva sute de octeți pentru 100+ pagini → e scanat, mergi pe ruta de la §3.

Căi: hardcodează calea în script, nu o pasa ca argument de linie de comandă — spațiile din numele folderelor strică quoting-ul în `cmd /c`.

## 3. Tăierea listelor de cantități pe devize

`read_file` pe un PDF scanat întoarce imaginile paginilor (le poți citi), dar peste ~20 de pagini dă timeout sau trunchiere. Soluția: taie PDF-ul cu `pdf-lib` în fișiere mici și citește-le pe rând.

Structura tipică a unui fișier „Liste de cantitati fara valori": un bloc identic per stradă/obiect, în ordine alfabetică pe localitate apoi pe stradă. La Racari blocul avea 11 pagini: F1 (1), F2 (1), F3 (4), C6 (2), C7 (1), C8 (1), C9 (1). **Verifică numărul de pagini per bloc împărțind totalul la numărul de devize și confirmă vizual pe primele două blocuri** — nu presupune.

Generează apoi un PDF per deviz doar cu paginile F3 și citește-le cu `read_file`.

Ce NU merge: `setRotation` și `setCropBox` — randorul le ignoră, nu câștigi rezoluție. Scanurile rotite 90° se citesc totuși bine așa cum sunt.

## 4. Parsarea ofertei noastre

F3-ul nostru (`F3 rev*.docx` din `gazpet\lucru`) e un text dump din programul de devize. `read_file` pe el poate depăși limita de context — rezultatul se salvează automat într-un fișier local pe care îl parsezi cu Python în container.

Extrage din fiecare `<w:t>` linia și prinde articolele cu un regex care acceptă toate unitățile de măsură: `M.C.`, `M.P.`, `BUC.`, `TONA`, `KG`, `M`, `T`. Atenție: dacă ceri minimum 2 caractere pentru UM, pierzi toate articolele cu `M` (țeavă, cablu) — jumătate din deviz.

Structura unei poziții: `NR SIMBOL [varianta] UM CANTITATE`, urmată de linia cu denumirea, apoi materialele aferente cu același NR.

## 5. Comparația

Confruntă fiecare deviz, poziție cu poziție. Ies trei categorii:

**a) Diferențe la noi — se corectează.** Instrucțiunile pentru ofertanți interzic modificarea cantităților din listele de cantități; orice abatere e motiv de respingere, indiferent cât de mică e valoric. Include aici și rotunjirile (1,500 în loc de 1,506).

**b) Indici de variantă `[n]` diferiți.** Programul nostru de devize își atribuie propriii indici. Trebuie aliniați la cei din SEAP înainte de depunere, de regulă după ce primim rețetele cerute la clarificări.

**c) Erori ale proiectantului în favoarea noastră — NU se corectează și NU se semnalează.** Cantitatea din listele de cantități e obligatorie; dacă proiectantul a pus de zece ori mai mult transport de pământ decât e cazul, o preiei ca atare. Notează în raport, ca să nu o „corecteze" cineva din echipă.

Fă și o verificare de coerență internă: raportul cantitate/metru liniar trebuie să fie constant pe toate devizele. Abaterile sunt fie erori ale proiectantului, fie erori de citire de-ale tale — verifică a doua oară înainte de a le raporta.

## 6. Planșele față de liste

Din PTh, citește memoriul tehnic și planșele de detalii (de obicei ultimele 5-6 pagini din partea 1). Compară legendele planșelor cu articolele din deviz. Ce caută:

- elemente desenate sau cerute în memoriu care nu au niciun articol în liste (răsuflători, manșoane, vane de secționare, cămine);
- materiale numite diferit în planșă față de deviz (tip de teu, de robinet, de regulator, de firidă) — sunt diferențe reale de preț;
- diametre care nu se potrivesc între memoriu, textul articolului și codul de material.

## 7. Livrabile

1. `VERIFICARE F3 rev* vs SEAP - <data>.md` în `gazpet\lucru` — scris direct cu `write_file`.
2. `VERIFICARE scheme montaj vs F3 - <data>.md`, tot acolo.
3. Solicitarea de clarificări ca .docx, generată cu `docx` (npm) în container, în formatul clarificărilor anterioare din folderul `clarificari`: antet către autoritatea contractantă, referință la anunțul SEAP, puncte numerotate, semnătura S.C. GAZPET INSTAL S.R.L.
4. Handoff-ul proiectului actualizat în Project.
5. Mail către Oana Nica (`oana.nica@gazpet.ro`) cu documentul atașat (base64 în `create_draft`), care să conțină explicit: ce se corectează în F3, de ce intră fiecare punct în clarificare, unde sunt rapoartele și ce NU se semnalează.

## 8. Ce intră și ce nu intră în clarificare

Intră: neconcordanțe între documente, elemente lipsă din liste, specificații care lipsesc, clauze contractuale ambigue sau dezavantajoase (ajustarea prețului, mecanismul de plată, perioada de garanție, avansul, durata).

NU intră: clauzele care ne avantajează (penalități de întârziere anormal de mici, cantități supraestimate), și nici scăpările proiectantului care sunt publice pentru toți ofertanții și nu creează un avantaj ilegal — semnalarea lor doar atrage atenția concurenței.

## 9. Verificări finale înainte de depunere

- Nu s-a eliminat și nu s-a introdus niciun articol de deviz (interzis fără erată a AC).
- Aceleași prețuri unitare pentru aceeași operațiune/resursă în toată oferta; aceleași cote de indirecte și profit; niciun articol cu valoarea 0.
- Cheltuielile indirecte detaliate conform Anexei 6 din Ghidul P91/1.02.
- Valorile din F3 preluate corect în F2 și din F2 în F1.
- C6–C9 prezentate în forma cerută de Instrucțiuni (de regulă pe fiecare deviz în parte, nu cumulat).