# Cum mapăm clarificările ↔ practica CNSC în ERP — opinie de arhitectură

> 05.10.2026 · sesiunea de cercetare juridic-normativă, la cererea lui Răzvan (prin sesiunea de chat). **Doar opinie, fără cod, fără migrări.** Bazată pe 5 zile pe corpus + cazul real Mânăstirea nr. 11. Cifrele de mai jos sunt cele din BD azi (import `cercetare-2026-10-02`), nu cele din runda v1.3: **216 decizii CNSC** (171 L98 / 45 L99; 2020–2026), **432 surse**, **919 cerințe** (864 verificate pe sursă), **313 relații**, **119 tipare** (84 cu precedente CNSC, 40 cu review juridic obligatoriu).

## 0. Ce nu se potrivește cu descrierea primită (de știut înainte de orice decizie)

- **PR #610** (registru termene + badge „rezumat AI — interpretare, nu citat”) e încă **draft, nu pe main**. Propunerea de mai jos se bazează pe el; dacă nu intră, treapta „răspunsul AC” rămâne manuală.
- **Generatorul `ofertare-clarificari-propune` nu știe de tipare/decizii**: e AI peste registrul licitației (`ofertare_cerinte`, cantități, documente). Nimic din corpus nu ajunge azi în el.
- **`ofertare_clarificari_puncte.cerinta_id` există deja** și leagă punctul de `ofertare_cerinte` (cerința *licitației*), nu de `norme_cerinte` (cerința *normativă*). Sunt două lucruri diferite; legătura dintre ele e exact „matricea” (pasul C).
- **Calitatea citabilă a corpusului e inegală**: doar **69/216** decizii au numărul exact (restul sunt anonimizate în Buletinul Oficial → citabile doar cu codul BO + link), 84 au data, toate 216 au link, 182 au citate cu pagină. Controlul judiciar e verificat la 37 (9 menținute, 3 modificate ⚠️, 1 desființată ⚠️, 24 necunoscut); 179 neverificate. Asta dictează §3 și §4.

## 1. Unde se agață în fluxul real (ecran, buton, ce vede omul)

| Moment | Ecran existent | Ce apare | Buton |
|---|---|---|---|
| **a. Citirea documentației** (documente intrate, text extras) | Ofertare → licitație → Cerințe / Documentație | Panou „**Tipare declanșate**”: lista tiparelor al căror `trigger.semnal` (cuvinte-cheie, `unde_cauti`: caiet_sarcini/contract/F3) se regăsește în `text_extras`; pe fiecare: titlu, `confidence`, ⚖️ dacă cere review juridic, câte precedente are. Ex.: PAT-GAZ-14 („contract doar execuție, dar CS/F3 cer proiectare”) ar fi prins Mânăstirea din F3 în ziua publicării. | „Verifică față de tipare” (determinist, gratuit) → „Creează întrebare din tipar” (preia `intrebare_propusa` ca ciornă, origine `platforma`) |
| **b. Scrierea unei întrebări / unui punct** | `OfertareClarificari.jsx` / `OfertareClarificariPuncte.jsx` | Sub întrebare: chip-uri cu temeiurile atașate (cerință normativă cu locator, decizie CNSC cu nr./BO + pagină + ⚠️ dacă e atacată). Textul întrebării **nu se modifică automat**. | „⚖️ Temei” → modal cu 3 file: *Tipar* (dacă întrebarea vine dintr-unul), *Cerințe* (`norme_cerinte`, doar `verificat_pe_sursa=true`), *Decizii* (filtre domeniu/temă/lege; propuneri sus, restul căutabil). Bifă separată: „include în adresa către AC” (implicit **nu** — vezi §4). |
| **c. Răspunsul AC** (`analiza.citire_noi` → legat la întrebări) | același panou, pe întrebarea marcată „răspunsă” | Dacă omul marchează răspunsul „evaziv/incomplet”: tiparul PAT-AMB-08 + deciziile lui + **termenul de contestare** din registrul de termene (#610): „act = răspunsul din DD.MM → X zile → termen DD.MM”. Decizia e a omului; platforma doar pune cifrele una lângă alta. | „Răspuns neconcludent?” |
| **d. Contestație / intervenție / răspunsul nostru la comisie** (`ofertare_solicitari_ac`) | Solicitări AC + un ecran „Fișă juridică” per licitație | Toate temeiurile atașate pe licitație, grupate pe temă, cu citatele exacte + link-uri, exportabile ca „fișă pentru avocat” (PDF). Pentru răspunsurile la comisie: PAT-CAL-20 (ce se poate completa la clarificări și ce nu — 37 de precedente). | „Fișă pentru avocat” |

## 2. Modelul de date minim

- **Un tabel nou, `ofertare_clarificari_temeiuri`** (brief-ul din `docs/cercetare/BRIEF_citare_cnsc_clarificari.md`, extins): `clarificare_id` **sau** `punct_id` (exact unul), trei FK-uri nullable cu CHECK „exact una nenulă” — `cnsc_decizie_id → cnsc_decizii`, `requirement_id → norme_cerinte`, `pattern_id → clarificari_tipare`; `citat_idx`, `citat_text` (**copie înghețată** din `citate_cheie`, cu CHECK că e identică la insert), `citat_loc`, `nota` (internă), `sursa` (`manual` | `propus_tipar` | `propus_ai`), `confirmat` bool, `include_in_adresa` bool (implicit false), `creat_de`, `created_at`; UNIQUE pe (țintă, decizie, citat_idx). FK-uri reale, nu `ref_id text` polimorfic.
- **Pe `ofertare_clarificari`: nimic nou.** Tiparul din care s-a născut întrebarea e un rând în tabelul de legătură cu `pattern_id`.
- **Pe licitație: nimic nou** — `regim_achizitie` (clasic/sectorial) și `segment`/domeniu există și sunt exact filtrele de care au nevoie propunerile (L98 vs L99, gaze/distribuție).
- **Refolosit ca atare**: `cnsc_decizii` (regula, `citate_cheie` cu `loc`, `comparabilitate`, `control_judiciar`, `avertisment_instanta`, `verificat`, `lege_aplicabila`, `an`, `link_sursa`), `clarificari_tipare` (`trigger`, `precedente_cnsc`, `normative_refs`, `intrebare_propusa`, `requires_human_legal_review`, `confidence`), `norme_cerinte` (`locator`, `verificat_pe_sursa`).
- **Lipsește și trebuie adăugat în corpus, nu în ERP**: `verificat_instanta_la` + `ultima_verificare` pe decizii (azi 179 neverificate în instanță); o `tema` controlată (acum `text[]` liber); și, în `ofertare_normative`, legătura inversă deja există (`norme_surse.ofertare_normative_id`, 51 de rânduri).
- RLS: citire pentru orice logat; scriere pe temeiuri = cine poate edita clarificarea; scriere pe corpus rămâne **doar owner** (orice „corectare” din UI devine propunere, nu edit).

## 3. Cum se produce legătura — recomand semi-automat în două trepte, prima fără AI

1. **Treapta 1, deterministă și gratuită (intră în B)**: când o întrebare are tipar, propunerile sunt `precedente_cnsc` ale tiparului (84 de tipare le au deja). Ordonare: domeniul licitației == domeniul deciziei → `lege_aplicabila` == regimul licitației → `control_judiciar.rezultat` (menținută > neverificat > necunoscut) → an desc. **Excluse din propuneri**: `modificata` / `desfiintata` (apar separat, gri, cu ⚠️ și cu hotărârea instanței). Omul bifează; `sursa='propus_tipar'`, `confirmat=false` până la bifă.
2. **Treapta 2, AI la cerere (C)**: doar pentru întrebări fără tipar, pe butonul omului, cu **poarta pe cheltuială** (owner/responsabil, ca la generator): re-rank peste `regula`+`citate_cheie` → 3 decizii cu scor și motiv de potrivire. Rămân propuneri; AI-ul **nu scrie niciodată în text**.
3. **Automat: nu.** Nici inserare în adresă, nici „auto-confirm”. Motivul e practic, nu teoretic: la Mânăstirea, din 12 decizii ale v2 au rămas 4 în v6 și colegii au mai tăiat la FINAL — alegerea a fost de ton și strategie, nu de corectitudine.
4. **Limitele care trebuie să fie reguli de cod, nu de bun-simț**: decizie atacată/modificată → niciodată propusă; `verificat=false` → niciodată propusă; vechime > 5 ani → avertisment („L98 s-a modificat; verifică articolul”); L98 ≠ L99 → articolele se citează așa cum sunt în decizie, nu se „traduc”; `requires_human_legal_review=true` pe tipar → exportul în adresă blocat până bifează un owner.

## 4. Ce NU trebuie făcut

- **Platforma nu produce citate.** Singurul text citabil e `citate_cheie[i].text`, copiat înghețat, cu `loc` și link. `regula`, `cum_ne_ajuta`, `comparabilitate`, `citita_rezumat` sunt **interpretare AI** — badge-ul din #610 li se aplică și lor și nu intră niciodată între ghilimele într-un document extern.
- **Proveniența, un singur format**: „Decizia CNSC nr. 3657/C1/4067,4182 din 23.12.2024, p. 28 — portal.cnsc.ro/…” sau, pentru cele anonimizate, „Decizia CNSC publicată în BO nr. BO2022_2473 (nr./data anonimizate), p. 19 — link”. Plus, o singură dată per document: „practică de interpretare, nu normă”. Lipsa oricărui element (pagină, link) = nu se exportă.
- **Nu se expune în exterior** `impact_intern` din tipare (strategia noastră), nici notele interne.
- **Nu se citează prin AI „din memorie”** (asistentul #226 nu răspunde „CNSC a decis că…” fără un rând din `cnsc_decizii` cu link). Reformularea #226 ar trebui să fie: RAG **doar** peste corpusul verificat, cu citare obligatorie a id-ului.
- **Nu lăsăm corpusul să îmbătrânească tăcut**: fără o rundă trimestrială (decizii noi din BO, verificarea instanței), biblioteca devine periculoasă — o decizie desființată citată într-o adresă e mai rău decât nicio citare.

## 5. Cost și ordine — trei pași, Răzvan alege

| Pas | Ce conține | Ce aduce | Cost |
|---|---|---|---|
| **A** (= task #34) | Ecran read-only „Bibliotecă juridică” în Ofertare: căutare în decizii / cerințe / tipare, filtre (domeniu, temă, lege, an, verificat, ⚠️), fișa deciziei cu citate + pagină + link + hotărârea instanței, buton „copiază citarea” în formatul din §4. **Fără tabel nou.** | Ce azi cere o sesiune de cercetare (ore) devine 1 minut pentru colegi; practica intră în uzul zilnic înainte de orice automatizare. | 1 sesiune; zero risc |
| **B** | Tabelul `ofertare_clarificari_temeiuri` + „⚖️ Temei” pe întrebare/punct + propuneri deterministe din tipar (treapta 1) + „Tipare declanșate” la citirea documentației (cuvinte-cheie) + export opțional „Practica CNSC invocată” în PDF-ul adresei, cu bifa `include_in_adresa`. | Fiecare clarificare are lanț probator reproductibil; detecția prinde cazurile deja cunoscute (PAT-GAZ-14, PAT-CTR-02…) în ziua publicării, nu la 3 zile după. | 1–2 sesiuni; cere acordul pe schemă (un tabel + o extindere a RPC-ului de export) |
| **C** | Matricea per licitație (`clarificari_matrice_model.md`: cerință din DA ↔ `norme_cerinte` ↔ tipar ↔ decizie ↔ status), re-rank AI cu scor (treapta 2), alerta „răspuns evaziv → termen de contestare” legată de #610, reformularea #226 ca RAG peste corpus. | Imaginea completă pe licitație și memorie între licitații (aceeași AC, aceeași problemă). | 3+ sesiuni; abia după ce A+B au trecut prin 2–3 licitații reale |

**Recomandarea mea: A imediat, B în aceeași lună, C după ce vedem cum folosesc colegii A+B.** Independent de pas: runda de mentenanță a corpusului (§4, ultimul punct) e condiția ca oricare din ele să rămână sigur.
