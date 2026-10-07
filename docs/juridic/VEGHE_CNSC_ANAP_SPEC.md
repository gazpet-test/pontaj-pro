# Veghe CNSC + ANAP — specificație v1 (07.10.2026)

Cerere Răzvan 07.10.2026: (1) corpusul CNSC să crească automat, nu selectat manual, (3) notificările ANAP de interpretare să intre în baza normativă, plus (1b) urmărirea concurenței: cine contestă, cât de des, cu ce rezultat, ca să tragem concluzii de conduită. Scop principal: clarificări și contestații mai bine fundamentate. Implementare: sesiunea Ofertare (modulul Ofertare + juridic). Fără cod în această specificație.

## 0. Ce avem și ce lipsește
- `cnsc_decizii`: 216 decizii verificate, 2020 → 17.07.2026, selectate manual de sesiunea juridică (`versiune_import = cercetare-2026-10-02`). Coloane bogate: problema, soluție, raționament, „cum ne ajută”, temei legal, citate, comparabilitate. **Lipsește:** alimentarea continuă, contestatorul și CUI-ul lui ca date structurate, legătura cu dosarul și cu încheierile.
- `norme_surse` (432), `norme_cerinte` (919), `clarificari_tipare` (119), `ofertare_clarificari_temeiuri` (gol, pasul B).
- Surse verificate 07.10:
  - **portal.cnsc.ro**: ASP.NET, listă încărcată prin `callWebMethod` (JavaScript), căutare după nr. decizie, contestator, nr. înregistrare, interval de date, autoritate, CUI. Fără API, fără notificări. PDF-urile deciziilor pe `sivadoc/download.aspx?docUID=…`. Fragil, dar e sursa oficială.
  - **achizia.ro**: bibliotecă publică fără cont, cu tot ce publică CNSC: decizii, motivări (BO), dosare, încheieri. Pagini HTML curate: listă `/decizii?q=<text>` (50/pag), fișă `/acte-cnsc/<id>` cu contestator, CUI, autoritate, data înregistrării, data deciziei, complet, soluția extrasă, PDF-urile. Mult mai ușor de citit decât portalul. Nu e sursă oficială: PDF-ul CNSC rămâne proba.
  - **anap.gov.ro**: WordPress în spatele Cloudflare (503 „Verifying your browser” pentru roboți). Se citește doar cu browser real. ANAP nu răspunde la clarificări în proceduri (acelea sunt ale autorității contractante și le luăm din SEAP). Publică **notificări de interpretare**, ghiduri, puncte de vedere, rar (câteva pe lună).

## 1. Veghe CNSC — alimentare automată a corpusului
**Automatizare:** edge function `cnsc-veghe` + cron săptămânal (luni 06:00), rulabilă și manual din UI de owner/responsabil Ofertare.

**Pasul A, descoperire (fără AI, gratuit):**
- Interogări pe achizia.ro `/decizii?q=…` pentru un set de **cuvinte-cheie** ținut în tabel (`cnsc_veghe_criterii`, tip `cuvant`): gaze, distribuție gaze, SRM, SRMP, ANRE, apă-canal, rețea de distribuție, CPV 45231221, 45231220, 45231300, 45232150.
- Interogări pe **autorități** urmărite (tip `autoritate`): ADI-urile de gaze, Transgaz, Romgaz, Distrigaz Sud Rețele, Delgaz Grid, operatorii regionali de apă unde ofertăm.
- Interogări pe **contestatori** urmăriți (tip `contestator`, cu CUI): concurenții noștri (listă pornită din `ofertare_concurenti` dacă există, altfel din deciziile deja în corpus: Totalgaz Industrie, Inspet, Art Instal, Construct Mapcom etc.). Se completează de Răzvan/Marilena din UI.
- Pentru fiecare rezultat nou (cheie: nr. decizie + an, dedup și pe `buletin_oficial`): citește fișa `/acte-cnsc/<id>` și scrie în `cnsc_decizii` un rând **`verificat = false`**, `versiune_import = veghe-AAAA-LL-ZZ`, cu: nr. decizie, data, complet, contestator + CUI, autoritate + CUI, obiect, CPV, soluția extrasă (admite / respinge / ia act de renunțare / anulare), link PDF CNSC, link achizia.ro, nr. înregistrare, dosar.
- Portal.cnsc.ro se folosește doar pentru **verificarea PDF-ului** (descărcare + SHA-256 în `snapshot_text_sha256`), nu pentru căutare.

**Pasul B, rezumare (AI, plătit, prin poarta pe cheltuială):**
- Doar pentru rândurile `verificat = false` cu domeniu relevant (filtru determinist pe CPV/cuvinte), și doar la apăsarea „Rezumă” de către owner/responsabil, sau în lot lunar aprobat. Completează problema, raționamentul, concluzia, „cum ne ajută”, temei legal, citate, în același format ca cele 216 existente (promptul existent al sesiunii juridice, pus în repo).
- Rândul devine `verificat = true` **doar după bifă umană** în UI. Opiniile și temeiurile (pasul B juridic) folosesc numai rânduri verificate.

**Coloane noi în `cnsc_decizii`** (migrare aditivă): `contestator text`, `contestator_cui text`, `autoritate_cui text`, `cpv text[]`, `complet text`, `nr_inregistrare text`, `dosar text`, `link_achizia text`, `solutie_tip text` (admis / respins / renuntare / anulat / partial), `data_inregistrare date`, `sursa_descoperire text` (cuvant / autoritate / contestator / manual).

**UI (Ofertare → Bibliotecă juridică, tab nou „Veghe CNSC”):** listă „de triat” (neverificate), filtre pe domeniu/autoritate/contestator/soluție, buton „Rezumă” (poartă pe cheltuială), buton „Verificat”, „Nu ne privește” (status `ignorat`, rămâne în tabel pentru statistică). Badge în meniul Ofertare cu numărul de decizii netriate.

## 1b. Concurența — conduită, din aceleași date
Fără sursă nouă: tot din `cnsc_decizii` + SEAP (ofertanții din rapoartele procedurii, când le avem).
- View `v_cnsc_concurenti`: pe contestator (CUI): număr de contestații pe an, autorități atacate, obiect (gaze / apă), rată admis/respins/renunțare, timp mediu până la decizie, dacă atacă rezultatul sau documentația, dacă contestă des același tip de cerință (experiență similară, personal, terț susținător, prețul neobișnuit de scăzut).
- Pagină „Concurenți” în Bibliotecă juridică: tabel + fișă pe firmă cu lista deciziilor. Concluziile de conduită (de ex. „contestă sistematic documentația la ADI-uri, cu 70% respingeri”) se generează la cerere cu AI, pe datele verificate, și se salvează ca notă cu dată, nu se recalculează automat.
- Alertă: când un concurent urmărit apare cu o contestație nouă la o autoritate unde avem ofertă depusă sau în lucru (legătură cu `ofertare_licitatii` pe CUI autoritate) → rând în notificările ERP pentru responsabilul ofertei. Fără mail automat.

## 3. ANAP — notificări de interpretare
- Nu se poate citi din cloud (Cloudflare). Rulează **pe PC-ul din birou**, în rutina de noapte sau lunar (1 a lunii), cu browser real (Playwright pe Edge-ul existent, ca la Copilot): deschide `anap.gov.ro/ro/` secțiunile Notificări / Ghiduri & documente utile / Comunicate, listează articolele noi față de ultima rulare (titlu + URL + dată), descarcă PDF-urile atașate.
- Fiecare articol nou → rând în `norme_surse` cu `tip = 'notificare_anap'`, `verificat = false`, text extras. Rezumarea și legarea de `norme_cerinte` / `clarificari_tipare` se fac la cerere, cu AI, prin poarta pe cheltuială, apoi bifă umană.
- Dacă într-o lună nu apare nimic, rutina scrie „0 noi” în jurnal, nu tace.

## 4. Fișa de securitate (CLAUDE.md pct. 7)
- (a) Conținut extern citit: HTML/PDF de pe achizia.ro, portal.cnsc.ro, anap.gov.ro. Se tratează ca date; niciun text de acolo nu declanșează acțiuni.
- (b) Scrie: doar INSERT în `cnsc_decizii` / `norme_surse` cu `verificat = false`, și notificări interne. Nu trimite mail, nu atinge bani, drepturi sau oferte.
- (c) Identitate: edge function cu `service_role` doar pentru INSERT în cele două tabele (justificare: cron fără utilizator). Citirea din UI prin RLS normal.
- (d) Pornire: cron + buton în UI vizibil doar owner/responsabil Ofertare (verificare de rol în cod, nu doar JWT).
- (e) Confirmare umană: orice rezumare cu AI (cost), orice `verificat = true`, orice concluzie de conduită salvată.
- Rând în `public.automatizari` + secțiune în `registru_automatizari` la livrare.

## 5. Livrare, în ordine
1. **PR1 (Ofertare):** migrarea coloanelor noi + `cnsc_veghe_criterii` + view-ul `v_cnsc_concurenti`; backfill contestator/CUI/soluție pentru cele 216 existente, din achizia.ro (pas preview → confirmare → apply).
2. **PR2:** edge `cnsc-veghe` (pasul A) + cron + tab „Veghe CNSC” cu triaj. Primul run pe interval 17.07.2026 → azi, ca să închidem gaura.
3. **PR3:** „Rezumă” prin poarta pe cheltuială + pagina „Concurenți” + alerta pe autorități comune.
4. **PR4 (PC / tura de noapte):** scriptul ANAP + rândul în `norme_surse`.
Fiecare PR: build, teste pe parser (fixture-uri HTML salvate din achizia.ro, ca să nu depindem de rețea în CI), review Jakarinos, PR draft, merge de Ofertare.

## 6. Decizii Răzvan (07.10.2026)
- **D1. Concurenți urmăriți (inițial):** INSPET, INGAZFORCONSTRUCT, CISGAZ, IRGC, HABAU (entitatea din RO, după CUI), INSTGAZ, INVEST GENERAL, TOTALGAZ. CUI-urile se completează la PR1 din achizia.ro și se confirmă în UI. Lista se extinde din UI.
- **D2. Triaj:** Răzvan, Marilena și responsabilul Ofertare. „Verificat” și „Rezumă” vizibile doar pentru ei (drept explicit în `user_module_access`, acordat de Răzvan).
- **D3. Frecvență:** săptămânal, luni 06:00.
- **D4. Buget rezumare AI:** OK, sub 5 €/lună. Peste 30 de decizii/lună rezumarea se oprește și cere confirmare.
