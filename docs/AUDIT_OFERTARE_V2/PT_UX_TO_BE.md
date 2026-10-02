# PT — TO-BE: „Necesită atenția ta" (propunere, NU implementare)

> Status: PROPUNERE pentru Copilot + Răzvan. Nicio schimbare live în Ofertare până după 02.10. AS-IS: `PT_UX_AUDIT_AS_IS.md`.
> Direcție de produs (Răzvan): `INPUT MINIM → AUTO-RUN → HUMAN ONLY ON EXCEPTION → AUTO-CONTINUE`.
> Reguli Audit V2 care NU se negociază: AI candidate ≠ human verified · lipsa informației ≠ negativ · orice verdict final are provenance · modificările upstream invalidează downstream · gate-urile critice rămân server-side.

## 0. Status după review (29.09 seara)
- **Jakarinos** (a doua opinie, read-only, cu file:line): corecții factuale în AS-IS + 6 probleme noi care pot induce **fals verde**. Review complet: `PT_UX_REVIEW_JAKARINOS.md`.
- **Copilot**: Quick Wins **GO cu condiții**; Workspace V2 **GO pe direcție/prototip, HOLD producție** până la verdict server complet; verificator de citate **GO pentru candidați, NO-GO pentru confirmarea în bloc în forma inițială**. Regula: *sistemul poate grupa munca, nu poate grupa judecata.*
- **Ordinea de lucru acceptată:** corectitudine semantică / fals verde → verdict server explicabil → Workspace V2 → verificare asistată → optimizare clickuri.
- Totalurile de tip „6 AUTO / 11 CONFIRM / 5 HUMAN" au fost **scoase**: nu erau reproductibile din date.

## 1. Top 10 probleme (după impact × frecvență, ordinea Jakarinos acceptată de Copilot)
| # | Problema | Exemplu concret |
|---|---|---|
| 1 | **Stări fals liniștitoare / divergență listă ↔ poartă** | Matricea arată „✓ dovadă în registru” pe baza statusului de acoperire, fără `verificat_pe_scan` (`OfertarePropunere.jsx:1326/1333/429`), contrar R06 server. **PT93, 29.09: 104 cerințe PT + 24 eliminatorii afișate „dovedite”, 0 verificate pe scan.** Poarta (view server) NU e afectată. „Rezolvate” = atribuite/exceptate, nu verificate (`:340`). Erori de citire afișate ca liste goale (`:1287`, `:1304-1307`). |
| 2 | **Verdict final incomplet / neexplicat** | Verdictul se calculează în browser (`evalueazaPoarta` în 5 locuri); J07 acoperă 12 controale, nu tot (F9, E2, documentație, R5 rămân separat). 19 din 24 de rânduri de poartă fără acțiune. |
| 3 | **Lipsește workspace-ul pe capitol** | La 1.c/cerința 5876: cerința în matrice (blocul 15), textul în cuprins (blocul 5). |
| 4 | **Verificare cu locator tastat, fără textul capitolului** | 280 × (click + prompt + reîncărcare) la PT93; elimină căutarea/tastarea, nu lectura. |
| 5 | **Acceptarea textului AI cere editare artificială; textul acceptat nu e protejat** | Generatorul protejează azi doar `sursa='om'` sau lacătul (`ofertare-genereaza-capitol/index.ts:243-248`). |
| 6 | **Concurență, invalidare, retragerea unei verificări greșite** | `load()` nu anulează răspunsuri pentru altă licitație (`:1251-1349`); constatarea blocării se scrie dar nu se recitește (`:1773` vs `:1325`); după verificare dispar butoanele de blocare/dovadă (`:450-457`). |
| 7 | **Rezolvarea blocajelor fără link și fără întoarcere la context** | docs necitite, grafic, cantități, H1/H4/H5/H8/H9. |
| 8 | **Salvare lentă cu pierdere de stare** | Reîncărcare la bifă; rezultatele pachetelor personal/echipamente golite la reload (`:1310`). |
| 9 | **Ordinea paginii** | Matricea ultima din 15 blocuri; excepțiile active trebuie să rămână vizibile la colapsare. |
| 10 | **Pre-completare din surse verificate + F9 corect** | Importul F9 ia și alternativele, nu doar alegerea omului (`:1969-2003`). |

Scos din top: „stare gol produce fals-roșu” — UI derivă deja eticheta din text (`:543/:584`); rămâne doar calitatea stării stocate.

## 2. Autonomie — clasificarea fiecărei operații umane de azi
Format: **ce face omul azi → de ce e necesar → se poate automatiza? → ce dovadă îi trebuie sistemului → când escaladează la om**. Clasa: AUTO / CONFIRM / HUMAN_DECISION / BLOCK.

| Operație | Clasă TO-BE | Ce face omul azi → de ce | Automatizare + dovada necesară | Escaladare la om |
|---|---|---|---|---|
| Creare cuprins | **AUTO** | alege model / tastează din fișa de date; ca structura să urmeze fișa | extragere capitole din fișa de date (deja citită) → cuprins cu `sursa='sablon'` + locator (doc/pagină) per capitol | fișa nu are listă explicită sau diferă de model → HUMAN_DECISION |
| Atribuire cerință → capitol | **AUTO** (cu provenance `sursa='ai'`) | bifează + select; ca fiecare cerință să aibă unde răspunde | `sursa_sectiune` + potrivire semantică → legătură `sursa='ai'`, NU verificată | scor mic / 2 candidați apropiați → CONFIRM |
| Excepție „nu se aplică la PT" | **CONFIRM** | motiv text | propunere automată pt. cerințe de calificare/financiare (tip ≠ propunere) cu motiv tipizat | cerință tehnică propusă ca excepție → HUMAN_DECISION |
| Scrierea capitolului | **AUTO** (draft) | generează + editează | generator cu schelet (ex. 1.c.2 standard din memorie #1481) + cerințele legate | întotdeauna trece prin CONFIRM mai jos |
| „Am citit capitolul" (acceptare AI) | **CONFIRM** | azi: editare artificială | acțiune explicită „Accept textul vN" → `sursa` rămâne `ai`, se scrie `acceptat_de/la/versiune` | — (e chiar confirmarea) |
| Verificare legătură cerință ↔ text | **CONFIRM** | tastează locatorul | generatorul/verificatorul întoarce **citatul exact + locator** per cerință → om vede cerință | citat și apasă ✓/✗ | citat negăsit, contradicție, capcană → HUMAN_DECISION |
| Dovadă (document + pagină) | **AUTO** candidat, **CONFIRM** final | 2 prompt-uri | din `ofertare_acoperire` (scan cu pagină) → dovadă candidat cu hash doc | dovadă doar AI (nu pe scan) → rămâne candidat; eliminatoriu fără scan → BLOCK |
| Confirmare cerință în registru (E2) | **CONFIRM** | alt ecran | aceeași acțiune ca verificarea din PT (un singur ✓ care scrie ambele, cu provenance) | — |
| Blocare / constatare | **HUMAN_DECISION** | prompt constatare | sistemul propune constatarea când citatul contrazice cerința | mereu om |
| Import echipa F9 | **AUTO** | buton „pornește din acoperiri" | rulare automată la schimbarea acoperirii | rol fără om / om fără autorizație valabilă → BLOCK cu cauza |
| Disponibilitate personal | **CONFIRM** | „confirmă" per om | pre-verificare pontaj/alocări/concedii | conflict de alocare → HUMAN_DECISION |
| Legare externi / declarații disponibilitate | **CONFIRM** | 2 select-uri | potrivire nume din documentul încărcat | lipsă document → BLOCK |
| Calificare cerută per afirmație | **AUTO** | select | tipul vine din cerința de personal (acoperire → `hr_autorizatii_tipuri`) | tip ambiguu → CONFIRM |
| Garanție | **CONFIRM** | click candidat + completează | `RX_LUNI`/`ghicesteMoment` pre-completează cerut; oferit = politica firmei (ex. 72) | cerut > oferit sau moment neclar → HUMAN_DECISION |
| Participanți / declarații / anexe | **CONFIRM** | 3 formulare | H8 `fraze_asociere` + H5 `anexe_referite` → rânduri candidate cu locator | subcontractant fără acord în dosar → BLOCK |
| Identitate (H1, nume străine) | **HUMAN_DECISION** (WARN + bifă auditată — decizia B) | nicio acțiune azi | sistemul listează fiecare nume + locatorul | mereu om |
| Observații | **HUMAN_DECISION** | adaugă/închide cu prompt | — | — |
| Semnează verdictul | **CONFIRM** | click | server calculează verdictul (J07); omul doar semnează | orice BLOCK server → nu se poate |
| Aprobă pachet | **CONFIRM** | click + confirm | pachet generat automat când verdictul e verde și toate CONFIRM-urile sunt date | — |
| Înregistrare depunere | **HUMAN_DECISION** (acțiune fizică SEAP) | 2 upload | hash + comparație automată cu pachetul aprobat (J04) | hash diferit → BLOCK |
| Clarificări AC după depunere | ascuns până la depunere | — | — | — |

**Corecții după review (Jakarinos + Copilot), prevalează asupra tabelului:**
- Excepție „nu se aplică la PT": **HUMAN_DECISION** motivată; CONFIRM doar pentru o regulă explicită demonstrabilă din sursă.
- Calificare cerută: **AUTO doar copiază tipul exact din cerința verificată**; nu se deduce din autorizația candidatului.
- Import F9: **AUTO doar pentru sincronizarea alegerilor umane curente**; handlerul actual nu e sigur de automatizat.
- Blocaje deterministe (hash vechi, dovadă obligatorie lipsă, control indisponibil) → **BLOCK automat**; contradicția semantică rămâne decizie umană.
- E2 (extracția obligației) și verificarea PT (răspunsul o satisface) rămân **două confirmări distincte**.
- Dovadă „fără scan": BLOCK doar pentru documente probante obligatorii; cerințele satisfăcute prin text nu cer scan.
- Clarificări AC: se afișează când există solicitare sau depunere, nu doar după marcajul ERP.
- AUTO produce **candidați**; niciun AUTO nu scrie `verificata`/`confirmata_de`/acceptare. Operația de verificare devine: sistemul propune candidați (citat + locator + context); omul examinează fiecare rând în workspace-ul capitolului; salvarea poate fi grupată, judecata nu.

## 3. Varianta A — Quick Wins (după 02.10, după GO Copilot)
**QW0 (prioritar, bug nu UX): fals verde „dovedită".** Reproducere read-only (PT93: 104+24) → contract comun cu R06 (aceeași definiție ca serverul: acoperit **și** `verificat_pe_scan` **și** fără reverificare cerută) → test de regresie. Tot aici: „rezolvate” redenumit/redefinit, erorile de citire afișate ca erori, anularea răspunsurilor pentru altă licitație, recitirea constatării.

| # | Schimbare | Tip | Invariant server neschimbat |
|---|---|---|---|
| QW2 | Fiecare rând ne-verde are „Du-mă acolo” + „ce ai de făcut” (păstrează licitația/filtrul, cu întoarcere) | UI | niciun gate atins |
| QW3 | Cerințele capitolului în expand (toate legăturile, stare atribuit/verificat/blocat/expirat) + filtru pe capitol | UI | `ofertare_pt_legaturi` neschimbat |
| QW7 | Matricea sub cuprins; blocurile rare colapsate, blocajele active rămân în lista de atenție | UI | — |
| QW8 | Mesaje cu cauza exactă (rând, capitol, versiune din manifest) | UI (+ eventual RPC extins) | regulile neschimbate |
| QW10 | Chip „neconfirmate E2” + link spre registru; E2 rămâne separat de PT | UI | registrul E2 neschimbat |
| QW1 | Banner BLOCKED/WARN/OK/indisponibil; zero BLOCK ≠ „gata de depus”; F9 vizibil separat | UI cu condiții | verdictul nu se schimbă |
| QW5 | Panou de verificare cu textul integral + versiune; click pe paragraf = locator, verificarea rămâne explicită | UI cu condiții | aceeași scriere `verificata` |
| QW9 | Update local + recitirea tuturor dependențelor porții (nu „2 query-uri”) | UI cu condiții | UI optimist nu deschide gate-ul |
| QW4 | „Accept textul vN” — **livrare separată**: schemă + protecție în generator + invalidare + test concurență | server + schemă (aprobare Răzvan) | `sursa='ai'` păstrată; editarea invalidează acceptarea |
| ~~QW6~~ | Retras: afișarea gol/scris e deja derivată; eventual doar indicator de contradicție stare stocată ↔ text | — | — |

Ordine: QW0 → QW10 + QW2/QW8 → QW3 + QW5 → QW7 + QW1 → QW4 (separat) → QW9. Estimarea „1–2 zile" nu se mai susține pentru tot pachetul.

## 4. Varianta B — PT Workspace V2 (justificat: problema #1 nu se rezolvă din layout)
### 4.1 Ecranul principal (wireframe)
```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Jilava (93) · termen 02.10 12:00 · 2 zile      [⛔ BLOCKED]  3 blocaje · 2 warn │
│ Verdict server: J07 v1 · calculat 14:32 · sursa v_ofertare_pt_stare  (▸ detalii)│
├───────────────────────────────────────────────────────────────────────────────┤
│ NECESITĂ ATENȚIA TA (5)                                                        │
│  ⛔ 280 citate propuse de verificat  (262 puternice · 18 slabe)  [Verifică →]   │
│  ⛔ Fișe tehnice: 4× [DE COMPLETAT] (cablu ELCAS)            [Deschide cap. 6 →]│
│  ⛔ Pachet PT negenerat — pornește automat după verificări          (auto)     │
│  ⚠  5 nume străine în text (COMUNEI, Gara…)          [Vezi locurile → H1]      │
│  ⚠  5 documente necitite                              [Citește acum]           │
│  ✓ 11 controale OK  (▸)                                                        │
├────────────────────┬──────────────────────────────────────────────────────────┤
│ CUPRINS            │ WORKSPACE CAPITOL 1.c  v5 · scris de AI · acceptat: nu   │
│ 1.a ✓ 12/12        │ ┌ Cerințe (14) ───────────────┐ ┌ Text ────────────────┐ │
│ 1.b ⏳ 3/18        │ │ 5876 plan OS  citat: 1.c.2 ✓│ │ 1.c.2 Planul de org… │ │
│ 1.c ⏳ 0/14  ◀     │ │ 5965 ≥20 m    citat: „…20 m"│ │ (click paragraf =    │ │
│ 1.d ✓ 6/6          │ │ 6066 pichet   citat slab ⚠ │ │  locator)            │ │
│ …                  │ │ [✓ Confirmă puternicele 12] │ │ [✎ Editează] [✓ Accept│ │
│ 6  ⛔ [DE COMPL.]   │ └────────────────────────────┘ └───────────────────────┘ │
│                    │ ▸ Dovezi (3)   ▸ Istoric v1–v5   ▸ Proveniență/audit      │
├────────────────────┴──────────────────────────────────────────────────────────┤
│ ▸ Date licitație (F9, echipamente, personal, organigramă, participanți,       │
│   garanție, anexe)      ▸ Exporturi      ▸ După depunere: clarificări AC       │
└───────────────────────────────────────────────────────────────────────────────┘
```
Principii: sus doar verdictul server + lista de acțiuni; centru = un capitol cu cerințele lui și textul lui; restul expandabil. Nicio cifră calculată de două ori: toate vin din același răspuns server (J07).

### 4.2 Fluxul TO-BE
1. **INPUT MINIM:** import SEAP (deja) + politica firmei (garanție oferită, sediu, subcontractori standard).
2. **AUTO-RUN (fundal, NAS/worker):** cuprins din fișa de date → atribuire cerințe → draft capitole pe schelete → propunere citat+locator per cerință → dovezi candidat din acoperire → F9/anexe/participanți/garanție pre-completate → verdict server.
3. **HUMAN ONLY ON EXCEPTION:** ecranul „Necesită atenția ta" = doar CONFIRM-uri grupate (pe capitol) + HUMAN_DECISION + BLOCK cu cauza și acțiunea.
4. **AUTO-CONTINUE:** după fiecare confirmare serverul recalculează; când nu mai sunt excepții → pachet generat + hash (J04) → notificare „gata de semnat".
Invalidare: orice editare upstream (text capitol, cerință, clarificare, document) marchează stale confirmările dependente (J07 hash-binding) și le readuce în listă — nu se pierd tăcut.

### 4.3 Clickuri înainte/după (operațiile cerute)
| Operație | AS-IS | V2 |
|---|---|---|
| (a) văd ce lipsește | 2–3C, 22 rânduri de citit | 1C (intru), 1 linie + listă |
| (b)+(c) capitol + cerințele lui | 1C + scroll 9 secțiuni + căutare | 1C pe capitol |
| (d) accept text AI | 3C + editare falsă | 1C „Accept vN" |
| (e) verific 280 cerințe | ~560 interacțiuni + 280 reîncărcări | ~25 confirmări pe capitol + ~18 decizii individuale (cele slabe) |
| (f) rezolv un blocaj | caut modulul | 1C „Du-mă acolo" / acțiune inline |
| (g) gata de depunere | semnează + aprobă + scroll + confirm | notificare → „Semnează" (1C) → pachet deja generat |

### 4.4 Ce trebuie construit (ordine după review, fiecare cu GO Copilot)
1. **Corectitudine semantică** (QW0): fals verde, „rezolvate", erori ca liste goale, concurență la schimbarea licitației.
2. **Contract server agregat complet** (extinde J07; nu se prezintă J07 actual ca poarta completă): toate rândurile, F9, E2, documentație, R5, cu cauza + acțiunea.
3. **Workspace pe capitol + acceptare sigură** (QW4 cu protecție în generator).
4. **Candidați de citate** (GO Copilot): `QUOTE_FOUND` ≠ `REQUIREMENT_SATISFIED`; AI propune MATCH/PARTIAL/CONFLICT/UNDETERMINED; stocat ca candidat cu hash-uri și `parser_version`.
5. **Confirmare grupată** — doar după criteriile din §6.
6. **Automatizări și auto-continue** (cuprins, F9 din alegeri curente, garanție, anexe, participanți), toate ca candidați cu provenance.

## 5. Ce NU se schimbă (invarianți server)
- Tranzițiile de stare și poarta de depunere (J02, matricea #515), derogarea auditată (J05), R5/R12 server-side, trigger-ul pe `ofertare_pt_pachet`, hash-ul pachetului (J04), legarea verdictelor de hash/versiune (J07).
- Nicio acțiune AUTO nu scrie `verificata`/`confirmata_de`: AI produce doar candidați; confirmarea e mereu a unui om identificat, legată de versiune.
- „Lipsă informație" rămâne UNDETERMINED/BLOCK pe eliminatorii, niciodată verde implicit.
- Editarea upstream invalidează confirmările downstream (nu le șterge; le marchează stale și le readuce în lista de atenție).

## 6. Criteriile GO pentru confirmarea grupată (Copilot + Jakarinos)
„Sistemul poate grupa munca, dar nu poate grupa judecata." Acceptat: „20 de rânduri examinate individual → un commit". Respins: „confirmă toate cele 87 cu scor > X".
1. Fiecare candidat arată cerința completă (subpuncte, condiții), sursa autorității + clarificările aplicabile, citatul exact în context, documentul/locatorul, versiunea și hash-ul cerinței, hash-ul textului PT, `parser_version`, sursa.
2. Zero preselecție după scor; omul marchează explicit fiecare rând (examinat / confirmat / respins); butonul salvează doar rândurile marcate, listate explicit.
3. Serverul nu acceptă `verified=true` venit din client; actorul și timpul se stabilesc pe server.
4. Commit atomic: dacă o cerință/capitol/sursă s-a schimbat între examinare și salvare → tot lotul refuzat ca stale, cu rândurile afectate listate; niciun commit parțial tăcut.
5. Idempotență la dublu submit; concurență: o sesiune modifică capitolul, cealaltă confirmă → a doua e refuzată.
6. Audit append-only: actor, timp, cerință/versiune/hash, capitol/versiune/hash, document/hash, locator, `parser_version`, model (dacă e AI), decizie.
7. Teste negative obligatorii: citat real dar insuficient; citat contradictoriu; citat parțial/trunchiat; citat din versiune veche; clarificare înlocuită; același text în document greșit; conflict între surse; hash schimbat după review; același nume de fișier, bytes diferiți; candidat AI greșit.
8. Evaluare oarbă pe cazuri reale (Domnești, Jilava), cu ground truth uman fără scor AI vizibil: câte fals-pozitive semantice propune și dacă interfața l-a făcut pe om să confirme ceva greșit; plus timp/clickuri înainte vs după, fără creșterea erorilor.

## 7. Rămâne de făcut
- Miloi: clickuri măsurate pe clona 103 pentru (a)–(g), în locul estimărilor din §4.3.
- După 02.10: QW0 (reproducere + fix + test), apoi Quick Wins în ordinea din §3, fiecare cu GO Copilot.
