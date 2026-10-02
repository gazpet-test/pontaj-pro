# Jilava / PT93: raport final al verificării read-only (29.09.2026)

> **Corecție Claude (29.09, 23:45), după raport:** rescrierea `termen_depunere` la 02.10 12:00 (ora RO), între 12:51 și 14:36 UTC, **nu e o scriere neidentificată**. Am făcut-o eu, Claude, prin MCP, la **13:59:36 UTC**, cu confirmarea explicită a lui Răzvan. Firul, din transcriptul sesiunii:
> - 13:53 — Răzvan: „fă merge acum, termenul e 02.10”;
> - 13:55 — preview-ul: valoarea veche 2026-10-06 12:00 UTC, 1 rând;
> - 13:59:30 — Răzvan: „da, fă update-ul.”
>
> Rândul „termen_depunere” din §3.6 se închide cu această proveniență. Rămâne însă decizia din §1 și §4.A: termenul oficial SEAP pare mutat pe **06.10.2026, ora 15:00**, iar veghea SEAP rulează pe 30.09 la 05:20 UTC (08:20 ora RO) și probabil va rescrie valoarea. 02.10 12:00 a fost termenul intern ales de Răzvan. De decis de el: ce valoare ține ERP-ul și ce termen se folosește în Formularul de ofertă (valabilitate).


**Licitația verificată:** `ofertare_licitatii.id = 93`, adică SCN1179907, „4420791 - COMUNA JILAVA”, „Protejare conductă transport gaze DN700 Bobești–Jilava (Inel București)”. Responsabilul din ERP este Cristina Dumitrescu. Clona 103 (Domnești) a fost exclusă peste tot.

**Cum s-a lucrat:**
- Controalele sunt împărțite în 5 grupuri. Fiecare grup a fost verificat de două ori: o trecere normală și una adversarială, făcută independent.
- Pe 29.09, între 19:00 și 20:00 UTC, am rulat doar SELECT-uri, plus două funcții STABLE (`ofertare_r5_blocaj_sursa` și `ofertare_totaluri_control`). În BD nu s-a scris nimic, iar în repo nu s-a modificat nimic.
- Raportul folosește numai rezultatele contra-verificate. Acolo unde prima trecere a greșit, spun explicit.

**Cum sunt numite capitolele:** după etichetă (1.a…10, Anexa). În unele SQL-uri apare numărul de ordine: nr 3 = 1.c, nr 9 = 1.i, nr 15 = 3, nr 18 = 4.c, nr 20 = 6, nr 23 = 9, nr 25 = Anexa.

---

## 1. Pe scurt

### Se poate depune?

- **În ERP, doar pe derogarea owner J05.** Poarta server J02 nu e îndeplinită: sunt 0 pachete PT depuse, 158 de cerințe fără acoperire verificată și 8 dovezi „roșii”. J05 le ocolește pe toate. **R5 însă nu îl ocolește.**
  - Azi, R5 întoarce `NULL` numai pentru că Jilava are 0 rânduri în Cantități.
  - De aceea, **Cantitățile Jilava nu se ating până la depunere.**
- **Pe fond (dosarul SEAP), încă nu.** Lipsurile concrete sunt mai jos. Serverul nu prinde niciuna dintre ele.
  - Poarta UI arată `block` pe 5 rânduri: neverificate 276/280, nescrise 22, F3, garanție, anexe.
  - Serverul nu impune niciunul dintre aceste 5 rânduri.
  - Pe traseul cu derogare, poarta UI nu mai rulează.

### Primul lucru de lămurit: termenul e în conflict

- Pe 29.09 la 12:51 UTC, **veghea SEAP a platformei** a citit „termen mutat: 02.10.2026 15:00 → 06.10.2026 15:00”. A actualizat ERP-ul și a notificat 3 persoane.
- Între 12:51 și 14:36 UTC, **cineva a rescris termenul înapoi, la 02.10 09:00 UTC (12:00 ora României)**.
  - Autorul nu poate fi identificat: tabelul nu are audit, iar `updated_at` n-a fost schimbat. Ordinea rezultă din `xmin`.
  - Valoarea de acum nu corespunde niciunui termen SEAP. Cel vechi era 02.10, 15:00 ora României.
- Mutarea e susținută de trei indicii:
  - clarificarea din oficiu (doc 1300);
  - un mail intern cu atașamentul „…decalare termen 06.10.2026”;
  - regula din fișa de date („răspunsul consolidat în a 6-a zi înainte de termen”), care se potrivește cu 06.10, nu cu 02.10.
- Nu am putut confirma direct în SEAP, pentru că API-ul a refuzat accesul.
- **Veghea rulează din nou pe 30.09 la 05:20 UTC (08:20 ora României) și probabil va rescrie termenul.**
- Termenul intern de 02.10, ora 12:00, rămâne decizia ta. Datele din ofertă (valabilitatea din Formularul de ofertă) se calculează însă din termenul oficial.

### Ce blochează concret (de fond, înainte de urcarea în SEAP)

1. **Termenul.** Trebuie citit în SEAP și hotărâtă valoarea din ERP (`TERMEN-DEPUNERE`).
2. **Clarificările necitite.** Răspunsul nr. 2 (doc 1301) și clarificarea din oficiu (doc 1300) au fost publicate pe 29.09 în jurul orei 13:09 (ora României) și sunt neprocesate.
   - Probabil conțin răspunsurile la cele 9 întrebări trimise de Gazpet. Trei privesc eliminatorii: Transgaz PP 97, GANEx și laboratorul de grad II ISC. Două privesc blocaje din PT: Halon (6113) și izolația (6182).
   - Formularul de ofertă declară că Gazpet „acceptă în totalitate” toate răspunsurile.
   - R12 e verde doar pentru că nu socotește aceste documente esențiale.
3. **Subcontractarea ELCAS.** ELCAS e subcontractant declarat, iar textul PT spune „acord de subcontractare anexat ofertei”. În ERP însă, AI-ul a marcat drept „nu se aplică”:
   - Formularul 4 (Acord de subcontractare);
   - 5916 (acorduri, eliminatorie, se prezintă la depunere);
   - 5801 (DUAE distinct pentru subcontractant, eliminatorie);
   - 5936 (DUAE pentru toți participanții);
   - 5908 (centralizatorul lucrărilor subcontractanților).

   În plus, ATSD e ales pe GANEx (5805) cu mențiunea „subcontractant”, dar nu e declarat participant.
4. **Garanția de participare de 10.037,58 lei** (5814/5914/5920, la depunere). Nu apare nicăieri în ERP, iar tichetul TKT-2026-0288 n-a mai fost atins din 24.09.
5. **Cap. 6 (fișe tehnice).**
   - Are 40 de marcaje `[DE COMPLETAT…]`.
   - Are 6 legături blocate: lipsesc fișele SINTAX FT1/FT5, ELCAS FT6/FT7 și cabluri FT8/FT9; la FT4 burduful ofertat e din neopren, deși se cere EPDM; lipsesc certificatele ELCAS și certificatul 3.1 pentru DN50 SINTAX.
   - Eliminatoriile 6045, 6051 și 6053 (conformitatea materialelor, la depunere) sunt închise greșit cu „nu se aplică”.
   - Mai e câte un marcaj în 4.b și în 4.c.
6. **Matricea din Anexa.** A fost generată pe 24.09 și intră automat în DOCX. Declară 181 de cerințe „fără capitol — de analizat” și conține note interne. Depusă așa, ar spune AC că lipsesc răspunsuri, adică exact situația din clauza 5898.
7. **Cap. 5 (F3) e incomplet.** Lipsesc cel puțin 4 poziții: la Ob.3 și Ob.4, Deviz 5, rândurile 12 `TSD02B1` și 13 `TSD06A1` (100 mc, 0,020). F3 nu e nici în modulul Cantități.
8. **Graficul 2.1–2.3.** Cerința 5882 cere Gantt „la nivel de articol de deviz” și în „zile lucrătoare”.
   - 2.1 e în zile calendaristice și are 34 de activități (cam una pe deviz), față de 180 de articole.
   - Textul conține și fraza „se exportă din modulul Grafic al platformei”, o referință internă care nu trebuie să ajungă la autoritate.
9. **PV-urile experienței (Bălăceanca, Butimanu, Poiana) și cazierul administratorului** (TKT-2026-0305). Conform deciziei din TKT-2026-0299, PV-urile pentru 5809 se depun odată cu oferta, nu doar la locul I.
10. **RTE Nica Florentin (autorizația 435).** În ERP nu are număr, emitent sau dată de expirare, iar cerința 5971 se prezintă la depunere.
11. **ELCAS pe 6208.** Laboratorul ISC apare expirat din 05.07.2026, iar autorizația nouă e încă la Mădălina. Pe 6210 nu e ales nimic.
12. **Text AI necitit de om:**
    - 22 de capitole obligatorii nesalvate de un om;
    - 276 din 280 de cerințe PT neverificate;
    - 36 de excepții puse doar de AI. Printre ele sunt 5888 (legitimația EGT), 5889 (certificatele sudorilor) și 5890 (certificatele CND), piese promise ca anexe în cap. 3;
    - 218 cerințe închise „nu se aplică” doar de AI, dintre care 27 eliminatorii.
13. **Pachetul SEAP.** Nu există în ERP și nu va exista pe traseul J05. Opisul, fișierele și regulile de formă se verifică manual: limba română, PDF editabil, semnătură electronică extinsă, opisare și numerotare, împuternicire, parte confidențială separată, nicio variantă.

### Doar de verificat de om (nu blochează)

- **H5.** „Anexa 1” și „cap. 100” sunt alarme false: vin din „HG 856/2002 anexa 1” și din „suduri cap la cap 100%”.
- **H4 (garanția lucrărilor).** Textul din 1.j și din cap. 8 e consecvent: 72 de luni de la semnarea fără obiecțiuni a PV-ului de recepție la terminare, la fel ca în 5969. În ERP lipsește doar momentul de start. Cele două potriviri de „36 luni” sunt alarme false.
- **H1 (nume străine).** COMUNEI, Depozit, EPURARE, Gara („Garanția” trunchiat) și LOCAL sunt cuvinte generice. O căutare mai largă a găsit 0 localități din alte licitații.
- **Dovezile roșii din J02:**
  - certificatul ANAF e expirat din 18.09;
  - certificatul ONRC e valabil până pe 02.10;
  - etalonarea ISOTEST expiră pe 12.10;
  - cazierul firmei e valabil mai puțin de 90 de zile după termen.

  Toate eliminatoriile afectate se prezintă la „primul loc”. ANAF și ONRC se reemit atunci. `se_reemite=false` pe ONRC (doc 146) pare o eroare de date.
- **6039 (Transgaz PP 97).** Ai ales autorizația ET ANRE 21234; trebuie doar confirmată în scris.
- **Confirmarea registrului (E2)** s-a făcut în bloc: 376 de cerințe în aceeași milisecundă, pe 22.09, înaintea ambelor răspunsuri la clarificări.
- **Autorizațiile 44 și 55 (EGT).** Subcategoria descrie distribuția; se verifică pe scan.
- **Bălăceanca.** Există nota „DE VERIFICAT dacă 33.289 mii lei e cota Gazpet”.
- **1.e și 1.g** (scrise de AI) spun „ofertant unic” și „fără terți susținători”. Sunt corecte doar dacă ATSD nu devine terț susținător.
- **Codul SEAP /00011** lipsește din secvența clarificărilor.
- **Întrebările 10–18** (diferențe F3↔planșe) n-au plecat, iar fereastra de întrebări e închisă.
- **Scrieri fără utilizator pe 29.09** (termenul, cap. 1.c v5, stările capitolelor la 16:21, pozițiile la 17:42). Trebuie lămurit cine le-a făcut; detalii la 3.6.

### Ce e OK (susținut de server)

- Licitația e cea corectă. Cele 376 de cerințe active au toate document-sursă din licitația 93.
- R06 funcționează: nicio propunere AI nu e numărată drept dovadă.
- Invalidarea la schimbarea versiunii funcționează: 5877 și 5878 au fost retrase după rescrierea lui 1.c. Istoricul de versiuni e complet (87).
- R12: cele 5 documente esențiale sunt citite, iar fișa de date din platformă are text identic cu cea din SEAP.
- Fișierele-sursă ale dovezilor există în Storage (62/62). Autorizațiile HR folosite nu sunt expirate, șterse sau înlocuite.
- Tabelul de audit J05 e append-only și are RLS. Pe Jilava nu există încă nicio derogare.
- Graficul are 79 de zile, deci încape în 3 luni. CPM-ul recalculat coincide cu 2.1–2.3, inclusiv drumul critic.
- Alegerile tale de dosar sunt înregistrate corect în BD: experiența, RTE, EGT, laboratoarele și sudorii „conform anexei”.
- Nu există capitole goale, observații deschise sau reverificări cerute.

**Corecție de cifră:** „280 de cerințe neverificate” e de fapt `cu_capitol`. Neverificate sunt 276. Patru au fost verificate azi de tine (5819, 5873, 5874, 5875), iar alte două (5877, 5878) au fost invalidate corect de rescrierea cap. 1.c.

---

## 2. Tabelul controalelor (toate cele 117, pe grupuri)

**Legendă pentru „Blochează?”:**
- **DA** = lipsă de fond, de rezolvat sau de acceptat explicit înainte de urcarea în SEAP.
- **J05** = blochează doar în ERP (poarta server J02 sau poarta UI). Pe derogare se ocolește, dar trebuie numit în motiv.
- **nu** = informativ.

Unele controale se repetă între grupuri, fiindcă fiecare grup le-a privit din alt unghi.

### 2.1 Poarta (UI + server): 27 de controale

| Cod | Ce verifică | Stare | Blochează? | Acțiune umană |
|---|---|---|---|---|
| `POARTA-UI` | Verdictul `evalueazaPoarta` pe datele live | OPEN | nu (doar butoanele din UI) | Vezi rândurile blocante de mai jos |
| `POARTA-UI↔SERVER` | Impune serverul ce blochează UI-ul? | CONFLICT | nu | Nimic până după 02.10; pachetul se verifică manual |
| `V_PT_STARE` | Rândul `v_ofertare_pt_stare` pentru 93 | CONFIRMED | nu | — |
| `R06` | Propunerile AI nu devin dovadă | CONFIRMED | nu | — |
| `UI-NEVERIFICATE` | 276/280 de cerințe neverificate de om | OPEN | DA | Verificare în UI; întâi cele 8 blocate |
| `UI-NESCRISE` | 22 de capitole obligatorii doar AI | OPEN | DA | Citite și salvate, după scoaterea `[DE COMPLETAT]` |
| `H2-CANTITATI↔R5` | UI blochează (F3 lipsă), R5 dă `NULL` | CONFLICT | nu | Decizie A/B (recomandat A), plus cele 9 diferențe F3↔planșe |
| `R5` | `ofertare_r5_blocaj_sursa(93)` | NEEDS_HUMAN_REVIEW | nu | Rerulare pe 02.10; F3 confirmat manual |
| `R5-DEROGARE` | Ocolește derogarea R5? (nu) | CONFIRMED | nu | Nu se ating Cantitățile |
| `R12` | Documentele esențiale SEAP sunt citite | CONFIRMED | nu | Rerulare pe 02.10 |
| `R12-CLARIFICARI` | Clarificările rămân în afara R12 | OPEN | DA | Citirea 1300/1301; SEAP /00011 |
| `UI-FARA` | „Fără capitol = 0” stă pe excepții AI | NEEDS_HUMAN_REVIEW | DA | Confirmare pentru 5888/5889/5890, 5908 și duplicate |
| `UI-CAPCANE` | Capcanele de respingere | NEEDS_HUMAN_REVIEW | nu | Confirmare „nicio variantă” (5930) |
| `UI-NECONFIRMATE-E2` | Registrul e confirmat | CONFIRMED | nu | De știut: confirmarea s-a făcut în bloc |
| `H4-GARANTIE` | Garanția lucrărilor (luni + moment) | OPEN | nu | Completezi momentul de start |
| `H5-ANEXE` | Trimiteri la piese din cuprins | NEEDS_HUMAN_REVIEW | nu | Alarme false, se trec în nota de depunere |
| `H9-H10-PACHET` | Opis→fișier; grafic din versiune înghețată | UNDETERMINED | DA | Verificare manuală a pachetului SEAP |
| `H11-GRAFIC` | Relațiile din grafic față de date | UNDETERMINED | nu | Verificare manuală 2.1–2.3 |
| `CONFORMITATE-AFIRMATII` | Afirmațiile PT față de ERP | UNDETERMINED | nu | Opțional: valabilitatea ANRE la 02.10 |
| `H8-PARTICIPARE` | Roluri față de acte și registru | CONFLICT | DA | Acord ELCAS, DUAE ELCAS, centralizator |
| `H1-IDENTITATE` | Nume din alte licitații | CONFIRMED | nu | — |
| `UI-VERZI-DIN-VIEW` | cuprins, goale, nu_e_cazul, observații | CONFIRMED | nu | — |
| `H6-NUMERE` | Numărul de branșamente | NOT_APPLICABLE | nu | — |
| `PT-SEMNATURA-SERVER` | Verifică serverul semnătura porții? | OPEN | nu | `pt_verdict` nu e dovadă |
| `J02-CONTEXT` | Contoarele din `fn_gate_depunere` | OPEN | J05 | J05, plus ANAF/ONRC/ISOTEST |
| `PT-ANEXA-MATRICE` | Matricea Anexa față de legăturile actuale | CONFLICT | DA | Decizie A (regenerare) sau B (scoasă) |
| `PT-DE-COMPLETAT` | Marcajele `[DE COMPLETAT]` | OPEN | DA | 42 de marcaje închise; căutarea finală dă 0 |

### 2.2 Cerințe și eliminatorii: 24 de controale

| Cod | Ce verifică | Stare | Blochează? | Acțiune umană |
|---|---|---|---|---|
| `CER-FARA-CAP` | Cine a închis cerințele fără capitol | NEEDS_HUMAN_REVIEW | nu (vezi `UI-FARA`) | Lista celor 36 din SQL; în UI nu se pot confirma |
| `V_PT_NEVERIFICATE` | 276 de neverificate, pe capitole | OPEN | DA | Ordinea: 1.i, 4.c, 1.h, 9, 4.b, 3; plus 5877/5878 |
| `PT-LEG-BLOCATE` | 8 legături blocate (constatări AI) | OPEN | DA | Decizii FT4/FT3/Halon; fișe și certificate |
| `V_PT_NECONFIRMATE` | Neconfirmate în E2 și J02 | CONFIRMED | nu | — |
| `CER-CAPCANE` | Capcane închise doar de AI | NEEDS_HUMAN_REVIEW | nu | Citit 5930; 5990 se verifică la 4.c |
| `ELIM-ALEGERI` | Alegerile față de deciziile tale | CONFIRMED | nu | Pe scan: autorizațiile 44/55 să fie EGT |
| `ELIM-SCAN` | Dovezi verificate pe scan | OPEN | DA | PV-uri și cazier (TKT-0305); scan pe eliminatoriile „la depunere” |
| `ELIM-NSA-AI` | 27 de eliminatorii „nu se aplică” fără actor | NEEDS_HUMAN_REVIEW | nu (vezi S05-02) | Citite și semnate de un om |
| `ELIM-NSA-SUBCONTR` | Cerințe de subcontractare închise greșit | CONFLICT | DA | DUAE ELCAS și acord, la depunere |
| `ELIM-GARANTIE` | Garanția de participare în ERP | UNDETERMINED | DA | Confirmare că e constituită și urcată în SEAP |
| `CONFLICT-ELIM-FT` | 6045/6051/6053 față de blocajele cap. 6 | CONFLICT | DA | Declarații de conformitate în ofertă sau lipsă acceptată |
| `ELIM-VALABILITATE` | Dovezi roșii în J02 | OPEN | J05 | Reemitere la locul I; flagul `se_reemite` pe doc 146 |
| `ELIM-RTE-5971` | Valabilitatea RTE (autorizația 435) | NEEDS_HUMAN_REVIEW | DA | Citit scanul; completat număr, emitent, expirare |
| `ELIM-ELCAS-6208` | Laboratorul ISC al ELCAS | OPEN | DA | Autorizația nouă sau ISO EN 15257; de văzut și 6210 |
| `ELIM-PARTENERI-PARTICIPANTI` | Parteneri aleși față de parteneri declarați | CONFLICT | DA | Rolul ATSD; decizie pentru EXPCORO |
| `ELIM-6039-TRANSGAZ` | Dovada pentru PP 97 Transgaz | NEEDS_HUMAN_REVIEW | nu | Confirmi ET ANRE 21234 |
| `ELIM-REVERIFICARE` | `reverificare_ceruta` | CONFIRMED | nu | Verde vid (nu prinde expirarea necunoscută) |
| `J02-SIMULARE` | Simularea J02 fără derogare | OPEN | J05 | Motiv J05 complet; R5 să dea `NULL` |
| `INV-CER-PT` | Invalidarea cerință→PT/acoperire | CONFLICT | DA | PV-urile pentru 5809 la depunere (TKT-0299) |
| `INV-CAP-VERS` | Invalidarea la versiunea capitolului | CONFIRMED | nu | Reverificare 5877/5878 pe 1.c v5 |
| `CER-VERS-CLARIF` | Ține registrul cont de clarificări? | UNDETERMINED | DA | Citirea 1300/1301 și confirmarea 1266 |
| `R12-CLARIF` | Vede R12 clarificările? | CONFLICT | DA | La fel ca mai sus |
| `ELIM-IN-PT-SCOP` | Eliminatorii în afara porții PT | NEEDS_HUMAN_REVIEW | nu | Verificate odată cu cap. 3 și 6 |
| `CER-PASAJ` | Pasajul-sursă e găsit | NEEDS_HUMAN_REVIEW | nu | 6159 (minor) |

### 2.3 Capitole și pachet: 26 de controale

| Cod | Ce verifică | Stare | Blochează? | Acțiune umană |
|---|---|---|---|---|
| `LIC-93` | Licitația e Jilava, nu 103 | CONFIRMED | nu | — |
| `V_PT_STARE.cuprins` | Există cuprins (25 de capitole) | CONFIRMED | nu | — |
| `CAP-STARI` | Starea „scris” pe capitole | NEEDS_HUMAN_REVIEW | nu | „Scris” nu e dovadă de citire |
| `V_PT_STARE.goale` | Capitole obligatorii goale | CONFIRMED | nu | 0 goale nu înseamnă complete (vezi marcajele) |
| `CAP-PLACEHOLDERE` | Marcajele `[DE COMPLETAT]` | OPEN | DA | 42 închise; căutarea finală dă 0 |
| `V_PT_STARE.nu_e_cazul` | „Nu este cazul” în capitole | CONFIRMED | nu | — |
| `V_PT_STARE.nescrise` | 22 de capitole obligatorii cu sursa AI | OPEN | DA | Citite și salvate din UI, nu prin SQL |
| `CAP-OPTIONALE-AI` | 1.e, 1.g și Anexa scapă de „nescrise” | NEEDS_HUMAN_REVIEW | nu | Confirmare „ofertant unic / fără terți” |
| `CAP-ANEXA-MATRICE` | E publicabilă matricea Anexa? | CONFLICT | DA | Decizie A sau B |
| `CAP-VERSIUNE-DUPA-VERIFICARE` | Capitol editat după verificare | OPEN | DA | Reverificare 5877/5878 pe 1.c v5 |
| `V_PT_STARE.neverificate` | Defalcarea celor 276 | OPEN | DA | Blocate → 43 „atribuita” → restul |
| `CAP-LEGATURI-BLOCATE` | 8 legături blocate | NEEDS_HUMAN_REVIEW | DA | Fiecare constatare confirmată sau infirmată |
| `CAP-ISTORIC` | Istoricul de versiuni e complet | CONFIRMED | nu | — (autorul nu e înregistrat) |
| `CAP-UPDATE-MASA` | Actualizarea în bloc de la 16:21:22 | UNDETERMINED | nu | Sesiunea respectivă spune ce a schimbat |
| `CAP-FISIER` | Capitole depuse ca fișier | NOT_APPLICABLE | nu | — |
| `V_PT_STARE.observatii` | Observații deschise | CONFIRMED | nu | — |
| `PACHET-PT` | Pachetul PT în ERP | OPEN | J05 | Pachet asamblat în afara ERP, verificat manual |
| `PACHET-POARTA-SEMNATA` | Semnătura porții PT | OPEN | nu | — (J07, după Jilava) |
| `PACHET-SERVER-ENFORCEMENT` | Ce verifică serverul la aprobare | OPEN | nu | Rândurile care există doar în UI nu se prezintă ca verzi |
| `PACHET-TRANZITII` | Matricea de stare a pachetului | OPEN | nu | Niciun INSERT/UPDATE pe pachet prin SQL |
| `H9` | Opis→fișier, automat | UNDETERMINED | nu | Verdele din UI nu e dovadă |
| `H9-MANUAL` | Fiecare poziție din opis are fișier real | OPEN | DA | Confruntarea opisului cu fișierele |
| `H9-F4-SUBCONTRACTARE` | ELCAS participant, dar F4 „neaplicabil” | CONFLICT | DA | Registrul aliniat cu decizia pentru ELCAS |
| `H10` | Grafic din versiune înghețată | NEEDS_HUMAN_REVIEW | nu | Verificare 2.1–2.3 (vezi și 5882) |
| `J02-PACHET-DEPUS` | „Depusa” cere pachet depus | OPEN | J05 | J05 cu motiv complet; R5 `NULL` |
| `J05-CALE-DEROGARE` | Cum se pune derogarea și ce rămâne în audit | OPEN | nu | O pui tu, prin RPC, cu contul tău |

### 2.4 Clarificări, cantități, grafic: 22 de controale

| Cod | Ce verifică | Stare | Blochează? | Acțiune umană |
|---|---|---|---|---|
| `TERMEN-DEPUNERE` | Termenul din ERP = termenul din SEAP? | CONFLICT | DA | Citire în SEAP; tu decizi valoarea |
| `CLAR-OFICIU` | Clarificarea din oficiu (1300) | OPEN | DA | Citită; ce modifică (probabil termenul) |
| `CLAR-RASP-NR2` | Răspunsul nr. 2 (1301) | OPEN | DA | Citit; răspunsurile la întrebările 1–9 |
| `R12-RASPUNS-CLARIF` | Acoperă R12 clarificările? | CONFLICT | nu | R12 verde nu dovedește citirea |
| `CLAR-RASP-NR1` | Răspunsul nr. 1 (1266) | NEEDS_HUMAN_REVIEW | nu | Un om confirmă conținutul PDF-ului |
| `CLAR-TRIMISE` | Cele 9 întrebări „trimisa” | OPEN | DA | Confirmare în SEAP (mai ales 51 și 53) |
| `CLAR-DE-TRIMIS` | Cele 9 întrebări F3 „de_trimis” | OPEN | nu | Decizie: retrase, cu rezervă scrisă |
| `CLAR-REZOLUTII` | Aplicarea răspunsurilor în registru | UNDETERMINED | DA | După citire: aplicare sau corectarea capitolelor |
| `CLAR-BAZA-PLANSE` | Clarificări automate din planșe | UNDETERMINED | nu | Informativ (planșele sunt tipizate „alta”) |
| `CLAR-SEAP-00011` | Codul SEAP /00011 lipsă | UNDETERMINED | nu | De verificat în SEAP |
| `POARTA-CLARIFICARE-AC` | Solicitările AC de după depunere | NOT_APPLICABLE | nu | — |
| `H2-CANTITATI` | F3 în ERP | OPEN | J05 | Decizie A/B; A = verificare manuală a cap. 5 |
| `R5-SURSA-CANTITATI` | R5 și rândul „sursa_cantitati” | CONFLICT | nu | R5 nu e dovadă; se numește în J05 |
| `CANT-F3-CAP5` | Cap. 5 față de lista de cantități | CONFLICT | DA | Adăugate 4 poziții în Dv.5; numărătoare pe fiecare deviz |
| `CANT-GRAFIC-CONCORDANTA` | Cantitățile din grafic față de cap. 5 | NEEDS_HUMAN_REVIEW | nu | — |
| `GRAFIC-VERSIUNE` | Există versiune înghețată de grafic? | OPEN | nu | Opțional: înghețare din modulul Grafic |
| `H10` | Piesele de grafic vin din versiune înghețată? | OPEN | J05 | Decizie A (îngheață) sau B (numit în J05) |
| `H11` | Relațiile față de ES/EF | UNDETERMINED | nu | — (CPM recalculat, consistent) |
| `GRAFIC-CERINTA-5882` | Gantt pe articol de deviz și în zile lucrătoare | CONFLICT | DA | Decizie A (refacere) sau B (risc asumat) |
| `GRAFIC-TERMEN` | 79 de zile ≤ 3 luni | CONFIRMED | nu | — |
| `GRAFIC-VALORIC` | Gantt valoric / F9 | UNDETERMINED | nu | Cine face F9; scoasă fraza „modulul Grafic” |
| `GRAFIC-CAPITOLE-OM` | 2.1–2.3 și 5 citite de un om | OPEN | DA | Citite și salvate, cu corecții |

### 2.5 Proveniență, identitate, derogare: 18 controale

| Cod | Ce verifică | Stare | Blochează? | Acțiune umană |
|---|---|---|---|---|
| `PROV-CER-SURSA` | Ancorarea cerințelor în documentație | CONFIRMED | nu | Opțional: 5919 (fără pagină) și 6159 |
| `PROV-CER-CONFIRMARE-E2` | Confirmarea registrului | NEEDS_HUMAN_REVIEW | nu | Tu: bifa în bloc a fost atestarea listei |
| `PROV-ACOP-VERIFICARE (R06)` | Acoperiri verificate pe scan | OPEN | J05 | Numit în J05; scan pe piesele alese |
| `PROV-ACOP-NU_SE_APLICA (S05-02)` | 218 „nu se aplică” doar de AI | CONFLICT | DA | Un om citește cele 27 de eliminatorii |
| `PROV-SURSE-STORAGE` | Fișierele dovezilor sunt în Storage | NEEDS_HUMAN_REVIEW | nu | Scan pe doc 13, 41, 65 și pe autorizațiile 44, 55, 435 |
| `PROV-EXPERIENTA-PV` | PV-urile experienței alese | OPEN | DA | TKT-0305; cota Gazpet la Bălăceanca |
| `PROV-PARTENERI-DOCS` | Documentele partenerilor în ERP | UNDETERMINED | nu | Confirmat dosarul fizic EXPCORO/ELCAS/ATSD |
| `PROV-DOVEZI-ROSII (R07)` | Dovezi expirate sau sub 90 de zile | OPEN | J05 | ANAF nou; ONRC valabil în ziua depunerii |
| `PROV-PT-AI` | PT scris și atribuit de AI | OPEN | nu | Verificare umană în UI (vezi rândurile cu DA) |
| `H1-IDENTITATE` | Nume străine și bifă auditabilă | NEEDS_HUMAN_REVIEW | nu | Citite cele 5; celule trunchiate în Anexa |
| `J05-TABEL-AUDIT` | Auditul derogărilor e append-only | CONFIRMED | nu | — |
| `J05-RPC-OWNER` | RPC-ul owner-only și actorul înregistrat | NEEDS_HUMAN_REVIEW | nu | Apel cu contul tău; motivul nu se mai atinge |
| `J05-DEROGARE-93 / J02` | J02 pe 93 și ce rămâne pe derogare | OPEN | J05 | Pe 02.10: R5 și cantitățile, apoi J05 |
| `R5-93-VACUU` | R5 e verde pe date sau pe lipsă de date? | UNDETERMINED | nu | Confirmat unde s-a verificat F3 |
| `SEAP-DOVADA` | Unde stă dovada depunerii SEAP | OPEN | nu | RPC reapelat cu nr. SEAP și SHA-256 |
| `FISIERE-FINALE-META` | Amprentele fișierelor și ale corpusului | UNDETERMINED | nu | Amprenta rerulată; hash-uri calculate local |
| `TERMEN-CONFLICT` | Termenul, între surse | CONFLICT | nu (alertă; DA la `TERMEN-DEPUNERE`) | Citirea doc 1300 |
| `CLAR-2-NEPROCESAT` | Documentele noi SEAP față de R12 | NEEDS_HUMAN_REVIEW | DA | Citirea 1300/1301 și confirmarea 1266 |

---

## 3. Detalii pe grupuri

### 3.1 Poarta (UI + server)

**Dovezi:**
- **Reconstrucția porții UI.** Funcția reală `evalueazaPoarta` a rulat în node pe snapshotul view-urilor. Snapshotul primei treceri e identic cu o extragere nouă (62/62 de câmpuri, comparate prin md5).
  - BLOCK: neverificate (276/280), nescrise (22), cantitati (F3 lipsă în ERP), garantie (lipsește momentul de start), anexe (Anexa 1, cap. 100).
  - WARN: conformitate, docs, grafic, identitate, participare, grafic_relatii.
  - Dacă view-ul cantităților dă eroare, poarta blochează, deci se închide corect la eroare.
- **Serverul.**
  - Pe `ofertare_pt_pachet` sunt 3 triggere și RLS: R12+R5; matricea propus→aprobat→depus cu `aprobat_de = auth.uid()`; iar starea `depus` cere fișiere cu rolurile `depus_final` și `dovada_seap`.
  - Pe `ofertare_licitatii` e `trg_gate_depunere` (J02, R5 și auditul derogării).
  - Niciunul nu verifică vreunul dintre cele 5 rânduri BLOCK din UI. `ofertare_pt_poarta` nu are niciun trigger.
  - Pe traseul J05 nu există pachet, deci pe server rulează doar R5.
- **R5 și derogarea.** În `fn_gate_depunere`, blocul J02 are condiția `AND NOT COALESCE(NEW.derogare_depunere,false)`, dar blocul R5 nu are. Mesajul de eroare al R5 sugerează, greșit, că derogarea l-ar rezolva.
- **Cele 36 de excepții AI:**
  - 3 piese cerute chiar în PT: 5888 (EGT), 5889 (sudori), 5890 (CND);
  - 4 cerințe financiare „de confirmat”: 5905, 5906, 5908, 5910;
  - 5 marcate „duplicat”: 6132→5960, 6176→6060, 6183→6125/6179, 6191→6186, 6194→5998;
  - 8 reguli de formă: 5900, 5901, 5912, 5915, 5917, 5918, 5930, 5806;
  - restul sunt instrucțiuni sau cerințe de calificare.
- **Garanția.** 1.j v2 și cap. 8 v4 spun „72 luni de la semnarea fără obiecțiuni a PV de recepție la terminarea lucrărilor”, același moment ca în 5969. Regexul H4 nu vede deloc cap. 8, pentru că paranteza din „72 (șaptezeci și două)” rupe potrivirea.
- **Anexa v3.** Sumarul ei spune: „376 cerințe — redactate 167; blocate 2; neredactate 22; exceptate 4; fără capitol — de analizat 181”. Situația reală: 280 de cerințe cu capitol, 79 de excepții, 8 blocate.
- **Marcajele `[DE COMPLETAT]`:** 40 în cap. 6 (exemple: „H60 este sub 75 mm cerut – de confirmat”, „DoC CE – lipsă”, „producător cablu + fișă”), câte 1 în 4.b, 4.c și Anexa.

**Corecții la contra-verificare:**
- HEAD-ul local e 7bdd5e9, nu 846b58b. Fișierele porții sunt identice cu `origin/main` b0f4ef7. `src/ofertarePropunereDate.js` nu există. Build-ul de pe Vercel nu l-am verificat.
- Pe pachet sunt 3 triggere, nu unul.
- R06: „128” sunt cerințe (104 propunere + 24 eliminatorie), în 242 de rânduri de acoperire.
- Cele 8 legături blocate sunt candidați AI (`confirmat_de` NULL, toate din 24.09 15:39:24), nu constatări umane. 6113 și 6182 sunt chiar întrebările noastre nr. 8 și nr. 9.
- `UI-FARA` trece din nu în DA. `UI-CAPCANE` trece din DA în nu: 5990 e un fals pozitiv al regexului, pe „sudurilor neconforme”.
- `H8` trece din UNDETERMINED în CONFLICT, cu DA. `H1` trece în CONFIRMED. `R12-CLARIFICARI` trece în OPEN.
- Nu doar ownerul poate pune derogarea, ci și o sesiune cu `session_user='postgres'`. Dintre dovezile roșii, doar ANAF e expirat efectiv.
- Controale noi: `PT-ANEXA-MATRICE` și `PT-DE-COMPLETAT`.

### 3.2 Cerințe și eliminatorii

**Dovezi:**
- **Registrul.** 376 de cerințe active: 51 eliminatorii, 296 propunere, 20 formă, 9 contractuale.
  - Toate sunt extrase de AI și confirmate de tine în bloc pe 22.09, la 17:23:15.894, prin „Confirmă tot” (`OfertareLicitatii.jsx:2110–2118`), la vreo 15 minute după extragere.
  - `stare='de_analizat'` la toate.
- **Acoperirea.** 467 de rânduri, 0 verificate pe scan, 0 cu fișier. 218 sunt „nu se aplică” fără actor, dintre care 27 eliminatorii.
- **Alegerile.** Toate au `ales_de` = Răzvan și niciuna nu e verificată pe scan.
  - 5807/5808/5809 → experiențele 40, 35, 25;
  - 5972 EGT → autorizația 44 (Stănescu, expiră 2030-01-02) și 55 (Trușu, expiră 2027-05-14);
  - 5971 RTE → autorizația 435 (Nica);
  - 6206 → EXPCORO; 6208/6209 → ELCAS;
  - 5945 → cazierul firmei (doc 41) și cazierul administratorului (rând „gol”);
  - 5805 GANEx → ATSD;
  - 6039 → ET ANRE 21234 (doc 13);
  - la sudori (5979) nu e ales nimic, conform deciziei tale.
- **Ce se prezintă la depunere.** 17 eliminatorii au `cand_se_prezinta='depunere'`, printre ele 5809 (PV), 5971 (RTE), 5972 (EGT), 6045/6051/6053, 5814/5914/5920 (garanție) și 5916 (acorduri).
- **TKT-2026-0299** (rezolvat de tine pe 28.09) a trecut 5809, 5811, 5812 și 5813 pe „la depunere”. Acoperirea 4079 (Butimanu) spune încă „se prezintă la locul I”, iar invalidarea nu urmărește câmpul `cand_se_prezinta`.
- **J02:** 158 de cerințe neacoperite: 9 contractuale, 24 eliminatorii, 20 formă, 105 propunere. Cele 105 se împart în 101 doar cu propunere AI, 3 alese de om fără scan (6182, 6188, 6204) și 1 `regula_propunere` (5978).
- **Dovezile roșii.** Toate cele 5 eliminatorii afectate se prezintă la „primul loc”. 7 din cele 8 rânduri sunt candidați AI nealeși; singurul ales e cazierul firmei (rândul 4075).
- **Autorizația 435 (RTE):** tip RTE, domeniu 8.4T, fișierul există, dar lipsesc numărul și data de expirare; `valabil_la_depunere=false`. Mecanismul de reverificare nu prinde o expirare necunoscută.
- **6208 (ELCAS).** ELCAS e ales, dar laboratorul ISC 3861 e expirat din 05.07.2026. Textul cerinței admite ca alternativă o persoană certificată ISO EN 15257, nivel 3. EXPCORO (ISC 4757, valabil până în 2030) apare doar ca propunere. Pe 6210 nu e ales nimic.
- **ATSD** (partenerul 21) are în catalog `tip_relatie='subcontractant'` și CUI NULL, e ales pe 5805, dar nu e declarat participant. EXPCORO e „furnizor_servicii” în catalog.

**Corecții la contra-verificare:**
- `CER-CAPCANE` trece din CONFIRMED în NEEDS_HUMAN_REVIEW: zero-ul stă pe o excepție AI și pe un capitol neverificat.
- `INV-CER-PT` trece din CONFIRMED în CONFLICT, cu DA. Modificările din 28.09 se explică prin TKT-0299, iar golul „latent” are efect real.
- `ELIM-VALABILITATE` trece din DA în nu (eliminatoriile sunt la „primul loc”).
- Control nou: `ELIM-NSA-SUBCONTR`.
- `ELIM-PARTENERI` se restrânge la ATSD.
- La `CER-FARA-CAP`, acțiunea propusă inițial nu se poate face în UI:
  - nu există filtrul „excepții”;
  - nu există confirmare pentru o excepție;
  - UI-ul nu încarcă `sursa`;
  - indexul `ofertare_pt_legaturi_exceptat_unic` blochează o re-excepție pusă de om.
- `pasaj_verificat` îl setează codul (`ofertare-cerinte/core.ts:311`), nu un om.
- Și alegerile din 22.09 au fost scrise într-o singură tranzacție (17:44:35).

### 3.3 Capitole și pachet

**Dovezi:**
- **Capitolele.** 25 în total (22 obligatorii), toate cu `sursa='ai'` și `stare='scris'`.
  - În cod nu există nicio funcție care să seteze „scris”, deci starea a fost pusă din afara UI, după 16:17:55.
  - Cele 87 de versiuni arhivate au toate `schimbat_de` NULL.
- **1.c v4→v5**, pe 29.09 la 16:17:55 UTC: textul a crescut de la 4.604 la 6.953 de caractere. `handoff_copilot` notează „plan OS: bază Ploiești…”. Rescrierea a venit după ce verificasei 5877 și 5878 pe v4, la 14:37.
- **Actualizarea în bloc** de la 16:21:22 a atins toate cele 25 de capitole. `blocat=true` pe 1.b, 1.c, 1.h, 4.a, 4.b, 4.c și 9. Nu se știe ce coloane s-au schimbat.
- **Legăturile.** 297 de tip „capitol”, dintre care 17 pe eliminatorii, care nu intră în cele 280. Pe propunere și formă:
  - 223 redactata;
  - 43 atribuita, adică nici măcar redactate de AI: cap. 3 are 11, 4.c 11, 2.1 7 din 7, 4.b 6;
  - 8 blocata;
  - 6 verificata.
- **Pachetul.** 0 rânduri în tot sistemul, iar `ofertare/pt/` din Storage e gol. Generat din UI, pachetul ar avea doar `propunere_docx` și `borderou_docx`.
- **Formularele.** Registrul are 10 rânduri, toate scrise de AI.
  - Cele 6 aplicabile (F1, F5, F6, F7, F8, DUAE) sunt „de_pregatit” și nu au fișier.
  - F4 (Acord de subcontractare) are `aplicabil=false`.
  - ELCAS apare ca subcontractant în 1.b, 1.f, 1.i, 2.1, 3 și 6.
- **Gaura din `PACHET-TRANZITII`.** Matricea de stare e un trigger BEFORE UPDATE. Un INSERT direct cu `stare='depus'`, făcut ca service_role sau postgres, trece de ea și satisface verificarea J02.
- **J05:** nu există UI pentru derogare (grep după „derogare” în `src/` și `supabase/functions/` dă 0) și nu există niciun CHECK pe `derogare_motiv`.

**Corecții la contra-verificare:**
- `H9` trece din NOT_APPLICABLE în UNDETERMINED.
- `PACHET-TRANZITII` trece din CONFIRMED în OPEN.
- Controale noi: `CAP-PLACEHOLDERE`, `CAP-ANEXA-MATRICE`, `J05-CALE-DEROGARE`.
- Defalcarea neverificatelor e corectată (17 legături sunt pe eliminatorii).
- „Fluxul n-a fost folosit niciodată” devine „nicio urmă de folosire”.

### 3.4 Clarificări, cantități, grafic

**Dovezi:**
- **Termenul.**
  - Notificarea veghei, la 12:51:10 UTC: „02.10.2026, 15:00 → 06.10.2026, 15:00”. Veghea trimite notificarea doar după un UPDATE reușit.
  - Rândul licitației a fost rescris după aceea. `xmin` 2346905 e mai mare decât cel al notificării (2344796) și mai mic decât cel al notificărilor de la 14:36 UTC (2348089). `updated_at` a rămas 22.09.
  - Valoarea dinainte era 02.10, 12:00 UTC (`docs/JILAVA_CANTITATI_DIAGNOSTIC.md:189`).
  - Veghea (cron la 05:20 și 12:50 UTC) nu semnalase nicio schimbare între 22 și 29.09.
- **Documentele de clarificare.**
  - 1301 (SEAP /00012, 2,1 MB) și 1300 (/00013, 60 KB): publicate pe 29.09, 13:08–13:09 ora României, neprocesate; fișierele există în Storage.
  - 1266 (/00010): textul stocat e rezumatul AI, nu textul PDF-ului. Are o singură întrebare (sudori ISCIR echivalenți, pe care AC o confirmă) și `modificari=[]`.
- **Întrebările trimise.** id 36–42, 51 și 53 (nr. 1–9) sunt „trimisa” și n-au niciun răspuns în ERP.
  - Dacă termenul era 02.10 15:00, fereastra de 8 zile s-a închis pe 24.09 la 15:00 (ora României).
  - 36–42 au trecut pe „trimisa” la 13:17, deci la timp. 51 și 53 au fost create direct „trimisa” la 20:01 și 20:45, adică după închidere.
  - Cu termenul de 06.10, fereastra s-ar fi închis pe 28.09.
- **Întrebările F3.** 54–62 sunt „de_trimis” (create pe 24.09 la 22:07). Fereastra e închisă sub ambele variante de termen.
- **Legarea în registru.** 0 cerințe legate de clarificări, 0 `raspuns_set`. Cele 23 de planșe DWG sunt tipizate „alta”.
- **Cap. 5.**
  - v3, 25.353 de caractere, 180 de rânduri. Toate cele 180 au cod și cantitate pe aceeași linie cu doc 434.
  - Verificarea inversă găsește în doc, la Ob.3 și Ob.4, Deviz 5, rândurile 12–13 (`TSD02B1` și `TSD06A1`, 100 mc, 0,020), care lipsesc din cap. 5. Acolo Deviz 5 se oprește la rândul 11 (`IZK08D1`).
- **Graficul.**
  - 34 de activități (id 45–78), 0 versiuni, 0 parametri, `valoare_lei` NULL la toate.
  - CPM dă 79 de zile, cu drumul critic 45→46→49→50→51→52→53→64→65→66→67→69→70→71→72→73→74→76→77→78, identic cu 2.1–2.3.
- **Cerința 5882** (fișa de date, IV.4.1, p. 10) cere „la nivel de articol de deviz” și „zile lucrătoare”. 2.1 scrie „zile calendaristice” și „la nivel de deviz/articol”.

**Corecții la contra-verificare:**
- Control nou `TERMEN-DEPUNERE` (CONFLICT). Prima trecere spusese că termenul „a rămas” 02.10, ceea ce e fals.
- `CLAR-OFICIU` trece din UNDETERMINED în OPEN.
- `CANT-F3-CAP5` trece din NEEDS_HUMAN_REVIEW în CONFLICT. Cele „18 rânduri trunchiate” erau un artefact al regexului, care limita distanța la 200 de caractere.
- `CLAR-BAZA-PLANSE` trece din NOT_APPLICABLE în UNDETERMINED.
- Control nou: `CLAR-SEAP-00011`.
- La 1266, textul e rezumatul AI, nu textul PDF-ului.
- În 2.1 e o referință internă de scos.

### 3.5 Proveniență, identitate, derogare

**Dovezi:**
- **Cerințele.** 376/376 au document-sursă din licitația 93. 375 au pagină (lipsește la 5919), 375 au pasajul găsit automat (6159 nu). `pasaj_verificat` e automat, nu uman. 4 cerințe au fost modificate după confirmare (28.09, 09:39: 5809, 5811, 5812, 5813, prin TKT-0299).
- **S05-02.** Cele 218 „nu se aplică” au semnătura scriitorului AI (`ofertare-acoperire/core.ts:360-371`: `referinta_text = motiv`, `scor` NULL, fără actor) și au fost create pe 22.09, între 17:25 și 18:06 UTC.
  - UI-ul le afișează „E o propunere, nu o decizie”, dar `fn_gate_depunere` le socotește închise.
  - Constatarea există deja în `docs/AUDIT_OFERTARE_V2/01_INVENTAR_WHITEBOX.md`, ca S05-02 (FALSE_GREEN, critică).
- **Storage.** 62/62 de căi găsite, 0 diferențe de mărime. Fără fișier: doc 133 (ISOTEST) și autorizațiile 35, 400, 523, 524, 526, dintre care niciuna nu e aleasă.
- **Experiențele 25/35/40** au `pv_path` NULL, dar `folder_nas` descrie PV-urile pe NAS. În bucket există `balaceanca-aa1-acord-asociere-procent-executat.pdf`, nelegat de nicio experiență. `ofertare_parteneri_documente` are 0 rânduri în tot sistemul.
- **J05.**
  - Tabelul de audit are RLS, doar SELECT pentru authenticated și service_role, și un trigger de imuabilitate. Are 2 rânduri, ambele din smoke-ul pe 103.
  - RPC-ul `ofertare_derogare_depunere(bigint,text,boolean)` e SECURITY DEFINER și cere un motiv de cel puțin 10 caractere.
  - Owneri: Răzvan Trusu și Tudorache Marilena Claudia.
  - Cele 9 profiluri cu modulul Ofertare (inclusiv „Claude” și „Test Ofertare”) pot, după acordare, să editeze `derogare_motiv` sau să retragă derogarea fără rând de audit. Tot ele pot pune „depusa” din UI.
- **Amprentele din 29.09:**
  - corpus `ofertare/93/%`: 51 de obiecte, 117.668.245 B, `78f78c6c29ba9877572c2cbf0884737b`;
  - manifest SEAP: 98 de intrări, `72b8174d27b7f348deb78b10e163de59`. Manifestul acoperă doar cele 6 arhive inițiale, fără 1266/1300/1301.

**Corecții la contra-verificare:**
- Acoperirile `acoperit/acoperit_partener` sunt 242, nu 227.
- Fără închidere umană sunt 376/376 de cerințe, nu 158.
- `S05-02` trece din UNDETERMINED în CONFLICT, cu DA.
- Control nou: `R5-93-VACUU`.
- Copia motivului din rândul `depusa_pe_derogare` nu e sigură; sigur e doar rândul scris de RPC.
- Manifestul SEAP nu e un reper de completitudine.

### 3.6 Scrieri fără utilizator în producția Ofertare (28–29.09), de lămurit

| Ce | Când (UTC) | Urmă |
|---|---|---|
| `termen_depunere` rescris la 02.10 09:00 | 29.09, între 12:51 și 14:36 | Nicio urmă. **Prioritar.** |
| Cap. 1.c rescris (v4→v5) | 29.09 16:17:55 | `handoff_copilot`: „plan OS rescris” |
| `stare` gol→scris pe toate cele 25 de capitole | 29.09 16:21:22 | `handoff_copilot`: „operațiuni de dosar autorizate de Răzvan (… stări de capitol)” |
| Poziții și alegeri pe eliminatorii | 29.09 17:42:56 | Nota „Decizie Răzvan 29.09”, `created_by` NULL |
| `cand_se_prezinta` pe 5809/5811/5812/5813 | 28.09 09:39 | TKT-2026-0299, rezolvat din contul tău |

Ultimele patru par operații de dosar autorizate de tine. Pentru rescrierea termenului nu am găsit nicio urmă.

### 3.7 Divergențe între grupuri (cum le-am tratat)

- **Dovezile roșii.** Grupul Cerințe le-a marcat „nu blochează” (primul loc), grupul Proveniență „blochează”. În raport le trec la J05, cu reemitere la locul I.
- **H1.** Un grup l-a dat CONFIRMED, celălalt NEEDS_HUMAN_REVIEW. Ambele n-au găsit contaminare; lipsește doar o bifă umană auditabilă. Rămâne WARN, conform deciziei B.
- **`UI-FARA` (DA) față de `CER-FARA-CAP` (nu).** Blocantă e doar partea cu 5888/5889/5890 și 5908.
- **H10.** Un grup a pus DA, celălalt nu. Pe traseul J05, H10 nu rulează. Fondul e cerința 5882 plus lipsa versiunii înghețate, cu decizie A/B.
- **Derogarea „din UI”** (prima trecere, grupul Poarta): nu există UI pentru derogare. Se pune prin RPC, cu contul tău.
- **Repo-ul s-a mișcat în timpul verificării** (HEAD 7bdd5e9 → fb7b89b), iar în working tree sunt modificări ale altor sesiuni, pe care nu le-am atins. Fișierele porții sunt neschimbate față de `origin/main` b0f4ef7.

---

## 4. Acțiunile până pe 02.10, ora 12:00 (în ordine)

Responsabilii sunt trecuți doar acolo unde reies din date. În rest scrie „de stabilit”; responsabilul licitației în ERP e Cristina Dumitrescu. Orice scriere făcută de Claude se face numai cu confirmarea ta explicită (preview → confirmare → apply).

**A. Imediat (înainte de rularea veghei pe 30.09 la 05:20 UTC, adică 08:20 ora României)**
1. Citit termenul oficial în SEAP (secțiunea IV) și doc 1300. Cine: de stabilit.
2. Hotărât ce valoare are `termen_depunere` în ERP și dacă veghea mai rulează. Cine: Răzvan. Dacă e nevoie de o corectură, o face Claude, numai cu preview și confirmarea ta.
3. Aflat cine a rescris termenul între 12:51 și 14:36 UTC. Cine: Răzvan. Claude poate căuta read-only în `handoff_activ` și `handoff_copilot`.

**B. 30.09: citiri și decizii**

4. Citite 1301 și 1300, plus confirmarea umană a lui 1266. Se notează ce răspunde AC la fiecare dintre întrebările 1–9, cu prioritate la nr. 2, 3, 4, 8 și 9. Se verifică în SEAP ce e /00011 și dacă întrebările 51 și 53 au plecat. Cine citește: de stabilit. Consecințele le decizi tu.
5. Întrebările 10–18 se închid ca retrase, iar diferențele F3↔planșe devin rezervă scrisă. Cine: Răzvan (se face în UI).
6. Rolurile în ofertă:
   - ELCAS: subcontractant, deci acord F4 semnat, DUAE distinct și centralizator în propunerea financiară;
   - ATSD: subcontractant sau terț susținător (5813);
   - EXPCORO: furnizor de servicii sau subcontractant.

   Decizia e a lui Răzvan. Strângerea actelor și actualizarea participanților și a lui F4: de stabilit.
7. Garanția de participare de 10.037,58 lei: confirmat că e constituită și urcată în SEAP (TKT-2026-0288). Cine: de stabilit.
8. Cele 3 scanuri PV (experiențele 25, 35, 40) și cazierul administratorului, legate în ERP. Cine: Oana (TKT-2026-0305).
9. Autorizația nouă ELCAS. Cine: Mădălina (mailul e trimis). Dacă nu vine: EXPCORO pe 6208 și ce se alege pe 6210. Cine: Răzvan.
10. RTE, autorizația 435: citit scanul și completate numărul, emitentul și expirarea. Cine: de stabilit.
11. Cap. 6:
    - decizii pe FT4 (EPDM sau neopren), pe FT3 (inelul H60 față de 75 mm cerut), pe țeava preizolată sau neizolată și pe Halon (6113, după Clarificarea 2). Cine: Răzvan;
    - fișele și certificatele SINTAX, ELCAS, KITMETAL și cabluri; închiderea celor 42 de marcaje din 6, 4.b și 4.c. Cine: de stabilit.
12. Anexa: A (regenerată din legăturile de acum și citită) sau B (scoasă din DOCX). Cine: Răzvan.
13. Cap. 5: adăugate cele 4 poziții din Dv.5 și numărate rândurile pe fiecare deviz. Cine: de stabilit. Decizia H2 (A sau B, recomandat A): Răzvan.
14. Graficul:
    - 5882, A (zile lucrătoare, pe articol) sau B (risc asumat, trecut în rezerve). Cine: Răzvan;
    - scoasă fraza „modulul Grafic al platformei”. Cine: de stabilit;
    - cine face F9 valoric. Cine: Răzvan.

**C. 30.09–01.10: verificare umană în UI**

15. Cele 36 de excepții AI. Prioritare: 5888/5889/5890 (le atribuie un om unui capitol), 5908, 5905/5906/5910, duplicatele 6132/6176/6183/6191/6194 și 6026. Lista o pregătește Claude (Q18, read-only); cine verifică: de stabilit.
16. Cele 27 de eliminatorii „nu se aplică”. Prioritare: 5801/5916/5936, 5814/5914/5920, 6045/6051/6053, 5813. Lista o pregătește Claude (Q31); cine citește: de stabilit, cu Răzvan pe eliminatorii.
17. Reverificat 5877 și 5878 pe 1.c v5. Cine: Răzvan.
18. Legăturile PT, în ordine: cele 8 blocate, apoi cele 43 „atribuita” (2.1–2.3, 3, 4.c), apoi 1.i, 4.c, 1.h, 9, 4.b, 3. Cine: de stabilit.
19. Cele 22 de capitole obligatorii, citite și salvate după scoaterea marcajelor. Cine: de stabilit, pe fiecare capitol.
20. Scan pe eliminatoriile care se prezintă „la depunere” și pe piesele alese (doc 13, 41, 65; autorizațiile 44, 55, 435). Cine: de stabilit.
21. Documentele cu termen:
    - certificat ANAF nou și certificat ONRC valabil în ziua depunerii efective;
    - reetalonarea ISOTEST (expiră pe 12.10);
    - flagul `se_reemite` pe doc 146.

    Cine: de stabilit.
22. Opțional: completat momentul garanției în H4. Cine: Răzvan. Nota de depunere cu alarmele false (H4, H5, H1): Claude face ciorna, tu o aprobi.

**D. 01.10: pachetul și motivul derogării**

23. Verificare manuală a pachetului SEAP. Cine: de stabilit.
    - opisul confruntat cu fișierele;
    - regulile de formă;
    - anexele din cap. 3 (EGT, sudori, CND);
    - acordul ELCAS;
    - Anexa, conform deciziei de la punctul 12;
    - căutare după „DE COMPLETAT” în fișierele finale, care trebuie să dea 0;
    - SHA-256 și MD5 calculate local pentru fiecare fișier.
24. Ciorna motivului J05. Cine: Claude face ciorna, tu o aprobi. Motivul numește:
    - J02: lipsește pachetul PT depus;
    - R06: 158 de cerințe fără acoperire verificată, plus S05-02: 218 închise doar de AI (27 eliminatorii);
    - R07: 8 dovezi roșii;
    - 276 de cerințe PT neverificate, 22 de capitole necitite, 36 de excepții AI;
    - H2 / R5 vid: 0 cantități în ERP, iar F3 a fost verificat manual;
    - H10: grafic fără versiune înghețată;
    - pachet asamblat manual;
    - ce rămâne deschis din subcontractare, garanție și fișele tehnice.

**E. 02.10 dimineață**

25. Rerulat SQL-ul (secțiunea 5) și comparat cu valorile din 29.09. Cine: Claude (read-only).
26. Reguli până la depunere:
    - nimeni nu scrie în Cantități pentru Jilava;
    - niciun INSERT/UPDATE pe `ofertare_pt_pachet` prin SQL sau serviciu;
    - nicio editare de capitole prin SQL și nicio actualizare în bloc;
    - după acordarea derogării, `derogare_motiv` nu se mai atinge.
27. Urcarea în SEAP. Cine: de stabilit.
28. J05. Cine: Răzvan.
    - Apelezi `ofertare_derogare_depunere` cu contul tău (din aplicație sau cu supabase-js cu JWT-ul tău), nu din SQL editor sau MCP, unde actorul ar rămâne NULL.
    - Motivul conține invarianții ocoliți, numărul și ora confirmării SEAP și SHA-256 pentru fiecare fișier.
    - Apoi pui „depusa” din UI.
    - Pe urmă, Q61 trebuie să arate același motiv în `derogare_acordata` și în `depusa_pe_derogare`.

---

## 5. Ce se rerulează pe 02.10 dimineața

Fișierul SQL consolidat e în `JILAVA_PT93_RERULARE_0210.sql`, în același director. Ordinea:

1. **Q01–Q06: termenul, primul.** O notificare nouă „TERMEN MUTAT” înseamnă că veghea a rescris termenul.
2. **Q45, Q48, Q11: documente noi SEAP și R12.** Orice cod SEAP după /00013 e un document nou de citit.
3. **Q13: R5.** Trebuie să dea `NULL` cu 0 rânduri de cantități (dacă s-a mers pe H2 varianta A). **Obligatoriu înainte de J05 și de „depusa”.**
4. **Q29 și Q61:** contoarele J02 și auditul derogării.
5. **Q07–Q10:** poarta UI; opțional, reconstrucția în node cu `evalueazaPoarta`.
6. **Q25/Q26:** marcajele, ținta e 0. **Q27:** Anexa. **Q22/Q24:** capitole editate după 29.09 (md5 și versiuni noi).
7. **Q14, Q16, Q17:** progresul verificării umane.
8. **Q58–Q60:** pachetul. Trebuie să fie tot 0; un pachet apărut fără fișiere înseamnă creat pe cale privilegiată.
9. **Q67–Q69:** amprentele corpusului și ale manifestului (`78f78c6c…`, `72b8174d…`).
10. **Q37, Q36b, Q44, Q40/Q43, Q46, Q49–Q51, Q28:** închiderea punctelor de fond (PV-uri, RTE, garanție, subcontractare, clarificări, cap. 5, grafic).

Scripturile de reconstrucție rulate pe 29.09 (`jilava_poarta/`, `contra_poarta/`, `cpm_cv.mjs`) sunt doar în scratchpad-ul sesiunii `/tmp/claude-0/-home-user-pontaj-pro/73db5287-168c-547e-9934-1c38453024bc/scratchpad/`, nu în repo, și pot să nu mai existe. Q09/Q10 și Q53 dau datele necesare ca să fie refăcute.
