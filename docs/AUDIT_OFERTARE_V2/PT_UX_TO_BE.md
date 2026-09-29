# PT — TO-BE: „Necesită atenția ta" (propunere, NU implementare)

> Status: PROPUNERE pentru Copilot + Răzvan. Nicio schimbare live în Ofertare până după 02.10. AS-IS: `PT_UX_AUDIT_AS_IS.md`.
> Direcție de produs (Răzvan): `INPUT MINIM → AUTO-RUN → HUMAN ONLY ON EXCEPTION → AUTO-CONTINUE`.
> Reguli Audit V2 care NU se negociază: AI candidate ≠ human verified · lipsa informației ≠ negativ · orice verdict final are provenance · modificările upstream invalidează downstream · gate-urile critice rămân server-side.

## 1. Top 10 probleme (ordonate după impactul asupra omului)
| # | Problema | Exemplu PT93 | Impact |
|---|---|---|---|
| 1 | Verificarea cerințelor e manuală, una câte una, cu citat tastat | 280 cerințe × (click + prompt + reîncărcare completă) | Ore de muncă mecanică înainte de fiecare depunere; omul nu judecă, doar copiază locatoare |
| 2 | Nu există spațiu de lucru pe capitol (cerințe + text + dovezi împreună) | La 1.c ai văzut cerința 5876 în matrice, textul în cuprins, 9 secțiuni mai sus | Omul ține contextul în cap; erori de tipul „răspunsul nu e acolo" descoperite târziu |
| 3 | Poarta nu dă un verdict și nu spune ce ai de făcut | 22 rânduri, 17 fără acțiune; clickul pe rând nu făcea nimic vizibil (reparat azi, #528) | Omul nu știe de unde să înceapă |
| 4 | Acceptarea textului AI cere o editare artificială | 22 capitole AI → rândul „nescrise" rămâne roșu până modifici ceva | Încurajează modificări false doar ca să treacă poarta — distruge semnalul „citit de om" |
| 5 | Stările nu se auto-întrețin | 25 capitole cu text, dar `stare='gol'` | Poarta arată fals-roșu; omul pierde încrederea în semnale |
| 6 | Munca zilnică e la capete, munca rară la mijloc | Matricea e blocul 15/15 | Scroll lung la fiecare operație |
| 7 | Problemele trimit în alte module fără link și fără întoarcere | docs necitite → tab Documente; grafic → modul Grafic | Pierdere de context, drumuri dus-întors |
| 8 | Aceeași cifră calculată în 5 locuri, cu 3 definiții | „neverificate": view vs filtru client vs badge | Cifre care nu bat între ele → suspiciune, verificări duble |
| 9 | Date pe care sistemul le are deja se cer din nou omului | garanția (regex deja găsește 36 luni), anexele (H5), participanții (H8), echipa F9 (acoperire) | Formulare completate de mână cu ce e deja în BD |
| 10 | Verdictul pe care îl vede omul e calculat în browser | `evalueazaPoarta` în 5 locuri; R5 nu e citit din UI | Risc ca UI-ul să spună „verde" și serverul „roșu" (sau invers) — exact ce repară J07 |

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

**Rezultat:** din ~24 de intervenții umane de azi, 6 devin AUTO, 11 CONFIRM (un click pe o decizie pregătită), 5 rămân HUMAN_DECISION, iar BLOCK-urile apar doar când lipsește dovada. Operația #1 (280 verificări) devine: sistemul propune 280 de citate → omul parcurge doar lista „cerință | citat" și confirmă în bloc pe capitol, deschizând individual doar cele marcate „citat slab / negăsit".

## 3. Varianta A — Quick Wins (1–2 zile, risc mic, după 02.10)
Format: problema → exemplu → schimbare → clickuri înainte/după → risc → invariant server neschimbat.

| # | Problema → exemplu | Schimbare | Click înainte → după | Risc | Invariant server |
|---|---|---|---|---|---|
| QW1 | Nu există verdict unic → 22 rânduri | Banner sus `BLOCKED (7) · WARNINGS (4) · OK (11)` + lista doar a rândurilor ne-verzi; rândurile verzi colapsate | citit 22 rânduri → citit 1 linie + N probleme | mic (doar afișare) | verdictul rămâne `evalueazaPoarta` azi / J07 după; nu se schimbă regula |
| QW2 | 17 rânduri fără acțiune | Fiecare rând ne-verde primește buton „Du-mă acolo" (tab/modul + filtru) și o frază „Ce ai de făcut" | căutare manuală → 1 click | mic | niciun gate atins |
| QW3 | Cerințele capitolului invizibile → 1.c / 5876 | În expand-ul capitolului: lista cerințelor legate (text scurt + stare) + filtru matrice „cap. X" | scroll 9 secțiuni + căutare vizuală → 0 scroll | mic | `ofertare_pt_legaturi` neschimbat |
| QW4 | Acceptare AI = editare falsă | Buton „✓ Am citit — accept vN" (scrie `acceptat_de/la/versiune`; poarta „nescrise" citește acceptarea) | deschide editor + modificare falsă + salvează (3C + edit) → 1C | mediu: necesită coloană nouă + ajustare view (schema → aprobare Răzvan) | text acceptat e legat de versiune; editare ulterioară invalidează acceptarea |
| QW5 | Verificare prin `prompt()` fără să vezi textul | Panou lateral la ✓: cerința sus, textul capitolului cu căutare, click pe paragraf = locator | 1C + tastat citat → 2C, fără tastare | mic | aceeași scriere `verificata` + `verificat_la_versiunea` |
| QW6 | Stare „gol" cu text | Afișare derivată: „are text" dacă `length(continut)>0`, iar starea BD e reparată la salvare | — | mic | starea nu intră în gate-uri critice |
| QW7 | Ordinea paginii | Matricea imediat sub Cuprins; blocurile rare (pachete echip./personal, organigramă, clarificări AC, participanți, garanție) într-o secțiune „Date licitație" colapsată | scroll 9 secțiuni → 0–1 | mic | — |
| QW8 | Mesaje fără pas următor | Rescriere cele 18 mesaje: „ce e / de ce contează / ce apeși" + numele rândului/capitolului exact („DEPĂȘIT: 1.c v5 > aprobat v4") | — | mic | — |
| QW9 | Reîncărcare completă la fiecare bifă | Update local al rândului + reîncărcare doar a view-ului porții | 280 × ~20 query-uri → 280 × 2 | mediu (sincronizare) | gate-urile se recitesc oricum la semnare/aprobare (server) |
| QW10 | Filtrul `neconfirmate` fără chip + ✓ care nu confirmă registrul | Chip vizibil + textul rândului spune explicit unde se confirmă (link) | — | mic | registrul E2 neschimbat |

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

### 4.4 Ce trebuie construit (ordine sugerată, fiecare cu GO Copilot)
1. J07 live (verdict server unic) — precondiție: UI afișează, nu recalculează.
2. Coloane acceptare capitol (`acceptat_de/la/versiune`) + regula „nescrise" pe acceptare.
3. Verificator de citate (edge/worker): per legătură cerință↔capitol întoarce `citat, locator, scor, parser_version, hash_text` → stocat ca **candidat** (`sursa='ai'`), niciodată `verificata`.
4. Confirmare în bloc pe capitol (scrie `verificata` doar pentru rândurile afișate omului, cu `verificat_la_versiunea` + hash citat).
5. Workspace capitol (UI) + ecranul „Necesită atenția ta".
6. Pre-completări AUTO (cuprins, F9, garanție, anexe, participanți) cu provenance.

## 5. Ce NU se schimbă (invarianți server)
- Tranzițiile de stare și poarta de depunere (J02, matricea #515), derogarea auditată (J05), R5/R12 server-side, trigger-ul pe `ofertare_pt_pachet`, hash-ul pachetului (J04), legarea verdictelor de hash/versiune (J07).
- Nicio acțiune AUTO nu scrie `verificata`/`confirmata_de`: AI produce doar candidați; confirmarea e mereu a unui om identificat, legată de versiune.
- „Lipsă informație" rămâne UNDETERMINED/BLOCK pe eliminatorii, niciodată verde implicit.
- Editarea upstream invalidează confirmările downstream (nu le șterge; le marchează stale și le readuce în lista de atenție).

## 6. Rămâne de făcut înainte de decizie
- Jakarinos: a doua părere pe §2 (verificatorul de citate: cum demonstrăm că nu devine „AI verifică AI") și pe §4.4 pct. 3–4.
- Miloi: clickuri măsurate pe clona 103 pentru (a)–(g), ca să înlocuiască estimările din §4.3.
- Copilot: GO/NO-GO pe Quick Wins (după 02.10) și pe direcția V2.
