# Automatizări noi — propuneri pentru discuția din 03.11.2026

Cerere Răzvan (02.11, seara): automatizări care scot omul din introducerea datelor, folosind NAS, Drive, Gmail. Consultați: Jakarinos (citire în cod, read-only), Copilot, Gemini, pe baza registrului `public.automatizari` (121 de rânduri active / de verificat). Cifrele de câștig sunt estimări pentru pilot, nu măsurători.

## Regula comună (toți trei au ajuns la ea)
Nu 15 agenți separați, ci **un singur mecanism „propune → omul confirmă → se aplică”**:
- documentul original (mail / scan / fișier) se păstrează cu amprentă și proveniență;
- extragerea se face local (OCR pe serverul AI), cu reguli deterministe; AI-ul doar pentru ambiguități;
- workerul scrie **propuneri**, nu stări finale; aplicarea o face un utilizator cu rolul potrivit, cu verificarea valorii vechi (fără suprascrieri);
- nimic nu pleacă în afara firmei fără „da”-ul tău.
Asta respectă fișa a–e din CLAUDE.md pct. 7: orice citește conținut extern și scrie are poartă de rol și pas de confirmare.

## Redări teren
| # | Ce | Stare | Ce cere de la tine |
|---|---|---|---|
| R1 | **Borderou / confirmări poștale → convocări** (expediere + AWB, AR, retur) din CSV/Excel, asociere după nr. convocare sau AWB | **în lucru azi-noapte** (felia 9, fără migrare, totul cu confirmare în ecranul „📮 Poștă”) | un borderou real de la poștă / FAN, ca să verificăm maparea coloanelor |
| R2 | Scanuri AR / retururi (cartonașe) de pe NAS → propuneri de AR/retur | propunere | unde ajung fizic cartonașele scanate (folder NAS) |
| R3 | Mailuri către redari@ → răspunsuri propuse (opțiune, parcelă), editorul confirmă identitatea | propunere | decizia pe forward-ul redari@ (azi merge la tine) |
| R4 | Scanuri PV A/B/C semnate (NAS/mail) → asociere automată după nr. PV / QR, editorul confirmă | propunere | folderul NAS pentru scanuri PV |
| R5 | Fișierul DCC (A4) → tronson + km propuse pe parcelă, aplicare doar de admin | după ce vine fișierul | „da” pe A4 (03.11, de la Cristina) |
| R6 | Zilnic: listă internă a deținătorilor fără răspuns după termen → coadă de urmărire (telefon / reluare) | propunere | canalul (doar intern; SMS/mail extern doar cu „da”) |

## ERP — primele trei (consens)
| Ordine | Ce | Cine o propune | Câștig estimat |
|---|---|---|---|
| 1 | **e-Factura ANAF → facturi primite + potrivire cu comanda și recepția** (XML UBL, determinist, fără AI) | Gemini #1, Copilot #2 | 15–35 h/lună |
| 2 | **Aviz / factură → recepție propusă în Magazie / EIP** (refolosește `fn_eip_intrare_factura`, aliasurile de furnizor, extractorul `ocr-packing-list`) | Jakarinos #3, Copilot #3 | 15–35 h/lună |
| 3 | **Raport carduri carburant (Rompetrol) din mail → lot de import** (importatorul există deja; se automatizează aducerea) + corelare cu EvoGPS | Jakarinos #2, Gemini #3 | câteva ore/lună + detecție abateri |

Alte propuneri (după pilot): certificate furnizor → dosarul comenzii / CTC; documente service → fișa utilajului; buletine metrologice → AMC; polițe și acte de prelungire → registru; bilete la ordin scanate; extras bancar → propuneri de încasare (cere tabel nou); notă vocală de la șeful de șantier → ciornă raport zilnic; PV probă de presiune → registrul probelor; confirmarea furnizorului → termene pe repere.

## Ce au semnalat la automatizările existente (de decis, nu am oprit nimic)
- **Redirecționarea codurilor hub.mai.gov.ro** — redistribuie coduri de autentificare; candidat la suspendare dacă nu mai e nevoie.
- **Bucket-ul public `partajare-externa`** — preferabil linkuri cu expirare în loc de citire publică.
- **Worker-ul `.p7s/.p7m`** — să păstreze originalul semnat, nu să-l înlocuiască.
- **`parse-pccvi-faze`** — înlocuiește fazele direct; ar trebui să treacă printr-o propunere, iar poarta să ceară drept de scriere, nu doar acces la modul.
- **Ingestii multiple** (tura de noapte, corespondență, Citește Orice, acte adiționale): același act poate veni pe mail, Drive și NAS → deduplicare comună după amprentă.
- **Patrula Scorilos în 6 treceri** → un proces parametrizat.
- **Golirea coșului + anonimizarea GDPR** — de verificat excepțiile de păstrare și eșecul parțial (Storage vs BD).

## Ce îți cer dimineață
1. Pilotul R1 (gata în ERP): un borderou real ca să-l probăm.
2. Ordinea pentru ERP: e-Factura → recepții din avize → carburant (sau altă ordine).
3. Decizii pe cele 7 semnalări de mai sus (păstrăm / oprim / reparăm).
