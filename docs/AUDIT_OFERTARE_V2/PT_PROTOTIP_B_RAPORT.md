# PT — Prototip B „Necesită atenția ta”: raport după verificare (29.09.2026, seara)

> **Stare: prototip read-only, NU e „gata”.** Rulează doar pe fixture-ul clonei de audit 103 (`SANDBOX-V2-DOMNESTI`), iar verdictul e **SIMULAT — J07 neaplicat**. Nu intră în producție și nu a atins BD-ul. Producția Ofertare e în freeze până după 02.10.
> Cod: `prototip/pt-atentie/` + `vite.prototip.config.js` (branch `claude/erp-continuare-x4p5a7-pt-prototip-b`, necomis). Design: `PT_UX_TO_BE.md` §4.1 / §4.3, `PT_UX_AUDIT_AS_IS.md`, `PT_UX_REVIEW_JAKARINOS.md` (acestea sunt doar în repo-ul principal, nu pe acest branch).

## 0. Pe scurt

- Au fost doi verificatori. Primul a dat **FAIL** (11 majore, 4 minore), cu verde fals obținut pe mai multe căi. Al doilea a dat **PASS_CU_CONDITII** (2 majore, 2 minore).
- **Toate cele 19 finding-uri sunt închise**, fiecare cu fix și test. Testele noi și cele modificate pică pe codul de dinainte: **90 din 458** pică pe `atentie.js` / `PtNecesitaAtentia.jsx` vechi. Dovada: comanda de la §8, rulată cu fișierele vechi puse temporar la loc.
- Pe 103 verdictul rămâne **BLOCKED (SIMULAT)**, dar lista verde s-a micșorat. `E2.ok` (417) și `R06.ok_scoase_om` (108) nu mai apar, pentru că datele arată scrieri în bloc:
  - 395 de confirmări E2 în aceeași secundă (15.09, 12:31:09);
  - 106 + 2 cerințe „nu se aplică” scoase în câte o singură secundă.
- Rămân deschise:
  - **abaterile de semantică față de server** (§6), de confirmat de Copilot + Răzvan;
  - **lungimea listei pe 103** (9,5 ecrane), care împinge cuprinsul la 11 ecrane de sus (§4);
  - **incidentul `INCIDENT_V2_NSA_AI_2026-09-29.md`, care e OPEN** (deci Audit V2 nu e închis);
  - operațiile (d), (e), (g), nemăsurabile într-un prototip care nu scrie.

## 1. Criteriile lui Copilot → dovada

| Criteriu | Dovada concretă | Ce e dovedit / ce nu |
|---|---|---|
| **Flux utilizabil** | **Playwright** pe serverul dev al prototipului (1400×1000, fixture 103, scenariul normal), în `prototip/pt-atentie/dovezi/playwright_sumar.json` → `clickuri`. Măsurători:<br>• **(a)**: 0 clickuri după intrare. Apare verdictul pe o linie, apoi 65 de rânduri grupate.<br>• Toate cele **54 de rânduri blocante** au „Du-mă acolo” și „ai de făcut”.<br>• **(b)+(c)**: 1 click pe „Du-mă acolo” duce în workspace-ul capitolului, unde cerințele capitolului și textul lui sunt **simultan în ecran**. Pe 42/42 de destinații de capitol.<br>• **(f)**: 1 click pe fiecare dintre cele 54 de rânduri blocante.<br>**Teste**: `atentie.test.js` → „„Du-mă acolo” — destinația”.<br>**Capturi**: `capturi/01_normal_proaspat.png`, `02_normal_interactiuni_extinse.png`, `03_normal_fara_capitol.png`. | **Parțial.**<br>• Traseul listă → capitol are 1 click, conform țintei TO-BE.<br>• **Pe 103 lista are 9,5 ecrane**, iar cuprinsul e la 11 ecrane de sus, deci traseul prin cuprins cere o derulare lungă (§4).<br>• 12 din 54 de rânduri blocante duc spre ecrane care nu există în prototip: Documentație, Cantități, Acoperire, Registru E2, Echipa F9. Acolo se afișează un mesaj pe loc. |
| **Stări oneste** | **Funcții pure** (`atentie.test.js`):<br>• eroare pe fiecare sursă → INDISPONIBIL / BLOCKED, niciodată OK (`it.each` pe 14 surse pe snapshotul curat și 13 surse pe 103);<br>• date vechi → WARN, date expirate → INDISPONIBIL cu `ok[]` gol;<br>• altă licitație sau licitație nepermisă → `SNAP:*`, fără listă (V2-1);<br>• AI ≠ om: toate cele 270 de legături AI neverificate sunt în PT02 / PT04 (testul I9);<br>• deciziile în bloc nu apar în verde (F5, F6);<br>• cheie absentă sau NULL → niciun verde, cu scan sistematic pe toate cheile tuturor surselor (F2 „scan”).<br>**Randare statică**: fără „(0)” și fără „Nicio excepție” când lista nu se poate construi; nimic verde pe date vechi sau expirate (F13).<br>**Playwright, 25 de scenarii** (`scenarii[]` din `playwright_sumar.json`): fiecare verdict are banda „SIMULAT” de 3 ori, 0 apariții „READY”; pe datele vechi, expirate și pe ceasul real sunt **0 elemente verzi**. | **Dovedit** pe funcțiile pure, pe randarea statică și în browser, pentru toate scenariile prototipului. |
| **Citire fără efecte ascunse** | **Traseul de cereri** din toată sesiunea Playwright:<br>• **1342 de cereri, toate GET** (61 document, 1281 script), toate spre `http://localhost:5199`, pe 22 de URL-uri unice (doar module locale și fixture-ul);<br>• **0 externe, 0 non-GET, 0 eșuate, 0 răspunsuri HTTP ≥ 400** în traseu;<br>• o eroare 404 în consolă = `/favicon.ico` (confirmat cu `curl`);<br>• WebSocket: doar HMR local (`ws://localhost:5199`);<br>• stocarea browserului la final: 0 cookies, 0 origins, localStorage 0, sessionStorage 0, IndexedDB [];<br>• 0 `<form>`, singurul input e checkbox-ul gărzii, **0 butoane care scriu**.<br>**Cod**: testul „fișierul nu importă supabase, react sau fetch”.<br>**Izolare**:<br>• `git diff` e gol pe `src/`, `vite.config.js`, `package*.json`, `index.html` și `.gitignore` din rădăcină;<br>• build-ul aplicației (979 de module) conține de 0 ori „SIMULAT”, „construiesteAtentia”, „pt-atentie”, „E2_BLOC” și „SANDBOX-V2-DOMNESTI”;<br>• `node_modules/.vite/deps` al aplicației a rămas neatins (mtime 21:02:44, dinaintea rundei); cache-ul prototipului stă în `prototip/pt-atentie/.cache-vite`. | **Dovedit.** În runda asta nu s-a rulat nicio interogare în BD, nicio rulare AI, niciun commit și niciun push. |
| **Dovadă de comportament** | **Teste**:<br>• 458 de teste pe prototip, toate trec;<br>• fără fixture: 412 trec + 46 sărite, adică CI-ul rămâne verde;<br>• suita completă: 1495 de teste, 40 de fișiere, trec.<br>• Fiecare finding are un test care îl prinde (§5); testele pică pe codul de dinainte (90).<br>**Browser**: 25 de capturi PNG, **locale** (date reale, deci necomise), plus `dovezi/playwright_sumar.json` (comis, fără texte din fixture, verificat automat: 0 fragmente). | **Dovedit** pentru ce face prototipul. **Nedovedit**:<br>• (d), (e), (g);<br>• comportamentul cu J07 real;<br>• `documente_firma` (lipsește din fixture);<br>• `candidati_citat` (tabelul nu există). |

## 2. Ce e SIMULAT

- **Verdictul agregat.** J07 (`ofertare_poarta_server()`) nu există în BD, așa că verdictul e calculat în browser.
  - Poartă mereu `simulat: true`, eticheta „SIMULAT — J07 neaplicat” și `nu_inseamna_gata_de_depus: true`.
  - Nu există starea READY.
  - Dacă J07 va exista și va fi mai sever, simularea îl urmează (INT05 BLOCK).
- **Ceasul de evaluare**, cu excepția opțiunii „ceasul real”.
- **Încărcarea**: întârzieri artificiale, fără rețea.
- **Licitația B (9001)**: e sintetică, fără date.

## 3. Ce NU face

- Nu scrie în BD, nu face fetch, nu importă supabase și nu rulează AI.
- Nu citește Jilava (93) sau alte licitații. `licitatiiPermise = [103]`; orice altă licitație iese `licitatie_nepermisa`.
- Nu are butoane care confirmă, acceptă text, verifică, semnează sau asamblează pachetul. Nu există „confirmă toate” și nici preselecție după scor.
- Nu înlocuiește porțile server: J02, R5, R12, `fn_gate_depunere` și triggerul de pe `ofertare_pt_pachet` rămân singurele care decid.

## 4. Clickuri pe fixture-ul 103 — AS-IS față de prototip

Notația AS-IS:
- C = click;
- D = dialog `prompt` / `confirm`;
- R = reîncărcare completă prin `load()`: pe 103 sunt 24 de GET;
- S = blocuri de pagină traversate cu scroll.

Traseele AS-IS sunt **numărate din handlerele din cod, nu măsurate în browser**. Cele din prototip sunt **măsurate cu Playwright** (`dovezi/playwright_sumar.json` → `clickuri`), la viewport 1000 px înălțime.

| Operație | AS-IS (din cod) | Prototip B (măsurat) | Ținta TO-BE §4.3 | Observații |
|---|---|---|---|---|
| **(a) Văd ce lipsește** | **1–3C, 0D, 1R.**<br>• Tab PT = 1C; select licitație = 2C dacă nu e preselectată.<br>• Din fișă: 3C.<br>• Se citesc 23 de rânduri de poartă: 7 block / 7 warn / 9 ok.<br>• Nu există verdict agregat scris.<br>• 4 rânduri sunt clicabile, dar **doar 1 din cele 7 blocante**.<br>• F9: numărul se vede, motivele cer +1C. | **0C după intrare.** Intrarea în aplicație ar costa 1C; în prototip nu se poate măsura, fiindcă nu există shell de aplicație.<br>• Verdictul scris pe o linie: „⛔ BLOCKED (SIMULAT…): 54 blocaje · 1 sursă indisponibilă”.<br>• 65 de rânduri grupate: 9 BLOCK, 7 HUMAN_DECISION, 39 CONFIRM, 10 WARN.<br>• **54 din 54 de rânduri blocante** au „Du-mă acolo” și „ai de făcut”.<br>• F9: motivele sunt în rând (Elemente).<br>• 0 reîncărcări. | 1C (intru), 1 linie + listă | **Lista e mai lungă decât poarta AS-IS** (65 față de 23 de rânduri; 9,5 ecrane), pentru că e pe capitol. Cele 39 de rânduri CONFIRM sunt:<br>• PT02: 11;<br>• CAP02: 12;<br>• E2_BLOC: 12;<br>• R06_PROPUSA: 4.<br>Fiecare rând are cauză și acțiune, dar lectura nu e „1 linie”. |
| **(b)+(c) Capitol + cerințele lui** | **2C + S + scanarea a 270–271 de rânduri + M.**<br>• Cuprinsul e blocul 5, deci S≈2.<br>• „✎ text” = 1C, iar lista cerințelor nu apare.<br>• Nu există filtru pe capitol: 1C pe rândul „neverificate” sau S≈9 plus 1C pe chip, apoi scanezi badge-ul „→ cap. X”.<br>• **Textul și cerințele nu sunt niciodată vizibile simultan.** | **1C**: „Du-mă acolo” pe rândul capitolului, apoi derulare automată.<br>• Workspace-ul arată **doar cerințele capitolului** (ex. cap. 5: 14) și textul lui, **simultan în ecran**. Verificat pe 42 din 42 de destinații.<br>• **0C** pentru capitolul deschis implicit (cap. 2, 92 de cerințe), dar el e la 10 ecrane sub antet.<br>• **Din cuprins: 1C după o derulare de 11,1 ecrane** (cuprinsul e sub listă). | 1C pe capitol | Ținta e atinsă prin listă. **Cuprinsul e prea jos pe 103.** Opțiunile sunt la §7: A colapsare pe clase, B workspace lateral lipit, C rânduri pe o linie. Nu le-am implementat fără decizie. |
| **(f) Rezolv un blocaj** | **„Caut modulul”.**<br>• 17 din 22 de rânduri de poartă n-au acțiune (AS-IS §3f).<br>• Pe 103, doar 1 din cele 7 rânduri blocante e clicabil.<br>• Fără link spre Documente, Grafic, Cantități, H1/H4/H5/H8/H9. | **1C pe fiecare dintre cele 54 de rânduri blocante:**<br>• **42 → workspace-ul capitolului**, cu cerințe și text simultan (PT02, PT04, CAP02, E2_BLOC, R06_PROPUSA);<br>• **12 → mesaj pe loc** cu ecranul din aplicație și filtrul: Acoperire ×4, Cantități ×2, Propunere ×2, Registru E2 ×2, Documentație ×1, Echipa F9 ×1.<br>Toate au „ai de făcut”. | 1C „Du-mă acolo” / acțiune inline | **Rezolvarea propriu-zisă nu e măsurată**: prototipul nu scrie, iar cele 6 ecrane-destinație nu există în prototip. „1C” înseamnă „ajung la locul și la acțiunea corectă”, nu „am rezolvat”. |
| (d) Accept textul AI | 3C + 1 editare artificială + 1R pe capitol; pe 103: 12 capitole | **nemăsurabil** | 1C „Accept vN” | Prototipul nu scrie, iar acțiunea „Accept vN” nu există (QW4, livrare separată). |
| (e) Verific cerințele | 1 + 270 × (1C + 1D) = 541 de interacțiuni + 270 de locatori tastați + 270R (≈7.020 de cereri) | **nemăsurabil** | ~25 de confirmări pe capitol + ~18 decizii | Prototipul nu scrie. Confirmarea grupată e NO-GO până la criteriile din §6 TO-BE. |
| (g) Gata de depunere | Semnează + Aprobă (1C + 1D) + S≈5 + upload | **nemăsurabil** | 1C „Semnează” | Verdictul e simulat; nu există J07 și nici pachet. |

## 5. Finding-urile verificatorilor și cum au fost închise

Fișierul de teste e `prototip/pt-atentie/atentie.test.js`. Codul e în `atentie.js`, iar partea de ecran în `PtNecesitaAtentia.jsx`.

### Verificatorul 1 (lentila „stări oneste / fals verde”, verdict FAIL)

| # | Sev. | Finding | Fix | Testul care îl prinde |
|---|---|---|---|---|
| F1 | major | DOC03 iese verde când lipsește cheia `blocaj`. | `'blocaj' in d` e obligatoriu; altfel `IND:control:forma_invalida:DOC03`. Evaluatorul primește `documentatie_verificata` doar pe un rând valid. | „F1 — DOC03 …”: 3 teste, unul pe 103. |
| F2 | major | Câmpurile absente sau NULL din `v_ofertare_pt_stare` / `v_ofertare_cantitati_nevalidate` ies „în regulă”. | `CAMPURI_CTRL` pe fiecare control:<br>• contor = întreg ≥ 0;<br>• listă = listă sau NULL;<br>• câmp prezent.<br>Absent sau tip greșit → control indisponibil. NULL pe o listă → „neevaluat”. Contoarele de cantități se verifică **înainte** de `campuriCantitatiNevalidate`. | „F2 — …”: 23 × absent, 23 × NULL, 6 contoare de cantități × {NULL, absent}, 103 și **scan sistematic** pe toate cheile tuturor surselor, cu lista explicită a cheilor de afișare. |
| F3 | major | Rândurile F9 fără licitație dispar în INT02, iar F9.ok iese verde. | Rândurile neatribuibile fac F9 indisponibil (`forma_invalida` / `alta_licitatie`). Rândurile valide rămân BLOCK. F9.ok apare doar pe listă goală fără rânduri ignorate. | „F3 — F9 …”: absent / NULL / altă licitație / 103. |
| F4 | major | PT01.ok iese verde pe o cerință fără capitol „închisă” doar de o propunere AI. | PT01.ok nu se emite dacă există cerințe PT fără capitol ținute afară doar de `propusa` sau de o dovadă fără autor. Titlul spune exact mulțimea. | „F4 — PT01.ok …”. |
| F5 | major | `R06.ok_scoase_om` numără orice `stare_de` nenul (108 pe 103, scrise în bloc). | „Scoasă de om” = autor nevid + moment propriu (`stare_la`, la secundă). Cele în bloc, fără autor sau fără moment → R06_ELIM_AI_NA (eliminatorii) / R06_AI_NA, cu proveniența `om_in_bloc` (portocaliu, nu verde). | „F5 — …”: bloc / gol / spații / fără moment / individual / 103 (107 în bloc). |
| F6 | major | E2.ok (417) vine dintr-un singur click pe tot registrul. | E2_BLOC: confirmările cu același moment (la secundă) sau fără moment → CONFIRM, **blochează**, grupate pe capitol. Șirul gol = neconfirmat. Câmpul `e2_confirmata_la` absent → indisponibil. | „F6 — E2 …”: 103 dă Σ 395 în 12 grupuri. |
| F7 | major | R06_ELIM_AI_NA nu blochează final (verdict WARN). | `blocheaza_final: true`; cauza trimite la incident și la TO-BE §5. În aceeași logică, și **PT06** (excepție PT pusă de AI) blochează — incidentul o numește explicit. | „N15 (finding 7)”, „excepție pusă de AI → PT06 … blochează”. |
| F8 | major | Verde prin absență: 0 cerințe PT → OK; rânduri „Toate cele 0 …”. | PT00 (HUMAN_DECISION, blochează). Niciun `*.ok` pe un univers gol. PT05.ok reformulat, fără „0 din 0”. | „F8 — …”: 2 teste. |
| F9 | major | Când J07 e mai sever, INT05 rămâne WARN și slăbește roșul serverului. | Rang BLOCKED > INDISPONIBIL > WARN > OK. J07 mai sever sau necunoscut → INT05 BLOCK. Mai permisiv → WARN. READY = OK, fără să apară cuvântul READY. | „J07 prezent (finding 9)”: 4 cazuri. |
| F10 | major | În workspace, o legătură AI neverificată apare „✓ verificată de om” dacă e verificată în alt capitol. | Starea e a **legăturii** din capitol. Stare nouă, neverde: „verificată în alt capitol, nu aici (cap. X)”. Progresul numără doar legăturile verificate în capitolul respectiv. | „F10 — workspace …”, inclusiv randat. |
| F11 | major | O sursă „ok” venită cu eroare e acceptată. | `eroare != null` → indisponibil (eroare), indiferent de stare. | „F11 — …”: `echipa_blocaje`, `r5`. |
| F12 | minor | Proveniența „om” fără actor (`verificat_de` NULL, `confirmat_de` ''). | `areActor`: NULL, '' și spații = fără actor. Dovada fără autor → R06_FARA_AUTOR (CONFIRM, blochează). Legătura fără actor → neverificată + INT04. | „F12 — …”. |
| F13 | minor | Chipuri verzi pe date expirate sau vechi. | `calitate` ajunge în cuprins, workspace și proveniență. Verdele devine neutru, cu sufixul „(date vechi)” / „(din date expirate)”. | „F13 — …”: 0 × `#3FB950` în HTML. În Playwright: 0 elemente verzi pe scenariile 17, 18 și 19. |
| F14 | minor | Rândurile cu `licitatie_id` străin trec, dacă sursa e declarată 103. | Orice rând cu `licitatie_id` ≠ L → sursa întreagă `alta_licitatie`. | „F14 — …”: 4 surse. |
| F15 | minor | DEP_ROSII: documentul referit, dar necitit, ajunge doar în INT02. | Documentele necitite **și** termenul de depunere lipsă → DEP_ROSII indisponibil. Termenul nu mai e înlocuit cu „azi”. | „F15 — …”: 2 teste. |

### Verificatorul 2 (lentila „rețea / izolare”, verdict PASS_CU_CONDITII)

| # | Sev. | Finding | Fix | Testul care îl prinde |
|---|---|---|---|---|
| V2-1 | major | Lista „(0) — Nicio excepție” și contoarele pe 0 când lista nu se poate construi. La eroare parțială, contorul arată „0 grupuri de confirmat”. | Verdictul primește câmpurile noi:<br>• `lista_construita`;<br>• `lista_motiv`;<br>• `reguli_neevaluate`;<br>• `neevaluate_pe_clasa` (din `CLASE_REGULI`).<br>Pe ecran: „Lista nu poate fi construită: …”, contoare „—”. La eroare parțială contorul arată „N + M reguli neevaluate”. | „V2-1 — …”: SNAP:licitatie_nepermisa, SNAP:alta_licitatie, toate sursele în eroare, eroare parțială. Capturi 21 și 25. |
| V2-2 | major | Izolarea nu rezistă la commit: testul importă static fixture-ul necomis, iar nimic nu oprește comiterea fixture-ului și a capturilor. | `.gitignore` local: `fixtures/`, `capturi/`, `.cache-vite/`. Fixture-ul se încarcă opțional (`import.meta.glob`) și în test, și în ecran. Testele pe 103 folosesc `it.skipIf`. | CI simulat (copie fără `fixtures/`): **suita completă 40 de fișiere, 1449 trec + 46 sărite**; prototipul are 412 teste care trec + 46 sărite. Build-ul prototipului trece și fără fixture. |
| V2-3 | minor | README: „pe ceasul real fixture-ul apare expirat” depinde de oră. | Reformulat: „vechi după 10 min, expirat după 2 h de la captură (20:13 UTC)”. | Captura 19 (ceasul real la 21:5x UTC): BLOCKED, marcat „date vechi”. |
| V2-4 | minor | Serverul dev scrie în `node_modules/.vite/deps` al aplicației. | `cacheDir: prototip/pt-atentie/.cache-vite`. | În Playwright, deps-urile vin din `/.cache-vite/deps/…`. `node_modules/.vite/deps/_metadata.json` a rămas cu mtime 21:02:44, dinaintea rundei. |

**Găsit la măsurare (nu era în verificări).** Pe 103, „Du-mă acolo” de pe `E2_BLOC:fara_capitol` (141 de cerințe, majoritatea ne-PT) ducea în vederea „Cerințe PT fără capitol”, care are 1 rând. Deci nu le arăta. Fix: `destinatieDuMa`. „Fără capitol” e folosit doar pentru regulile PT; restul primește mesajul cu ecranul din aplicație. Test: „„Du-mă acolo” — destinația”.

## 6. Abateri de semantică de confirmat (Copilot + Răzvan)

Principiul comun: **o decizie fără om identificat sau luată pe grup se tratează ca lipsa deciziei umane**. Simularea poate fi mai strictă decât serverul, niciodată mai permisivă. Toate abaterile sunt scrise în cauza rândului („Decizia finală: Copilot + Răzvan”).

1. **R06_ELIM_AI_NA și PT06 blochează final.** Serverul le socotește închise; incidentul le numește FALSE_GREEN. R06_AI_NA (cerințe ne-eliminatorii cu „nu se aplică” AI) rămâne CONFIRM neblocant. **De decis** dacă și ele blochează.
2. **E2_BLOC blochează.** Serverul (`n_neconfirmate`) le socotește confirmate. Pe 103 sunt 395.
3. **„Nu se aplică” în bloc = fără decizie individuală.** Pe 103: 107 eliminatorii + #64 (propunerea exceptată de om, deja acoperită pe aspectul PT).
4. **R06_FARA_AUTOR blochează.** Formula R06 a serverului nu cere `verificat_de`. Pe 103 nu apare.
5. **NULL pe un câmp-listă din `v_ofertare_pt_stare` = „neevaluat”**, nu verde, pentru că `array_agg` fără rânduri dă tot NULL. Consecință: un view care întoarce NULL în loc de `{}` pe o licitație curată nu va ieși niciodată OK. Remedierea corectă e `COALESCE` în view, după freeze.
6. **PT00**: 0 cerințe PT e o decizie umană blocantă.
7. **INT05**: J07 mai sever sau necunoscut → BLOCK.
8. Abaterile vechi (H6 `numere` neevaluat, INT01 blocant pe cerință, dependențe mai stricte etc.) sunt în `prototip/pt-atentie/README.md`.

## 7. Limite și ce a rămas deschis

- **Lungimea listei pe 103** (65 de rânduri, 9,5 ecrane). Cuprinsul ajunge la 11 ecrane de sus. Opțiuni, de ales de Copilot + Răzvan, **niciuna implementată**:
  - **A.** Clasele CONFIRM și WARN colapsate implicit. Antetul rămâne cu numărul; blocajele stau deschise.
  - **B.** Workspace-ul și cuprinsul într-un panou lateral lipit, lângă listă.
  - **C.** Rânduri pe o singură linie, cu cauza la expand.
- **Decizia individuală e dedusă din timp** (două decizii în aceeași secundă = bloc). Un script care scrie un singur rând, cu un autor oarecare, trece drept decizie umană. Remedierea reală e remedierea A din incident: actorul, momentul și versiunea cerinței scrise pe server.
- **DEP_ROSII e mereu indisponibil pe 103.** `documente_firma` nu e în fixture (decizia deschisă 6), deci 103 nu poate ieși niciodată OK în prototip.
- **J07 și `candidati_citat` nu există în BD.** INT05 și PT07 sunt testate numai sintetic.
- **Texte trunchiate** în fixture (1500 de caractere pe capitol). Regulile folosesc `continut_gol` / `*_md5` / `server_cer`, calculate pe textul integral.
- **Scan-ul de chei** lasă verzi, explicit, doar câmpurile de afișare și NULL-urile legitime din SQL. Lista e în testul „scan” și trebuie reluată la fiecare coloană nouă din view-uri.
- **Capturile și fixture-ul nu se comit** (date reale). Pe branch rămân doar `dovezi/playwright_sumar.json` și codul. Capturile se regenerează cu scriptul Playwright din scratchpad (§8).
- **`vitest` rulat din rădăcină** scrie în continuare cache-ul lui (`node_modules/.vite/vitest`), ca orice test al aplicației. Nu l-am schimbat, fiindcă ar cere modificarea `vite.config.js` al aplicației.
- **Incidentul `INCIDENT_V2_NSA_AI_2026-09-29.md` e OPEN** (în repo-ul principal). Prototipul îl reflectă (R06_ELIM_AI_NA, PT06), dar nu îl rezolvă.
- **Măsurarea pe aplicația reală** (Miloi, TO-BE §7) rămâne de făcut. Numerele AS-IS de mai sus sunt din cod, nu din browser.

## 8. Cum rulezi

Din rădăcina worktree-ului. `node_modules` există; nu se instalează nimic.

```bash
npx vitest run prototip/pt-atentie                      # 458 de teste (fără fixture: 412 + 46 sărite)
npx vite build --config vite.prototip.config.js         # build în prototip/pt-atentie/dist (ignorat)
npx vite --config vite.prototip.config.js               # http://localhost:5199 (cache în prototip/pt-atentie/.cache-vite)
# dovada în browser (serverul de mai sus pornit): capturi/ + dovezi/playwright_sumar.json
node /tmp/claude-0/-home-user-pontaj-pro/73db5287-168c-547e-9934-1c38453024bc/scratchpad/pw_prototip_b.cjs
```

Rezultatele rulate pentru acest raport (29.09.2026, ~21:56–22:10 UTC):

| Comandă | Rezultat |
|---|---|
| `npx vitest run prototip/pt-atentie` | 1 fișier, **458 passed** (458) |
| `npx vitest run` (toată suita) | 40 de fișiere, **1495 passed** (1495) |
| CI simulat, fără `fixtures/` | 40 de fișiere, **1449 passed + 46 skipped**; prototip: 412 + 46 |
| `npx vite build --config vite.prototip.config.js` | EXIT 0, `dist/assets/index-*.js` 1.382,99 kB |
| `npx vite build` (aplicația) | EXIT 0, 979 de module, 0 stringuri ale prototipului în `dist/` |
| Playwright (25 de scenarii + clickuri) | EXIT 0:<br>• 1342 de cereri GET locale, 0 externe, 0 non-GET;<br>• stocarea browserului goală;<br>• 25 de capturi locale.<br>Clickurile sunt la §4. |
| Mutație (fișierele vechi puse la loc temporar) | **90 failed** / 368 passed din 458. Fișierele noi au fost restaurate, cu md5 identic. |
