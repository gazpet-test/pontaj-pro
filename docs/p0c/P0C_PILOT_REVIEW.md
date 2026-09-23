# P0C_PILOT_REVIEW — verificarea de conținut a celor 3 rânduri importate (Mânăstirea, pack #2)

Data: 24.09.2026 · sesiune `session_01TYQw97aZXVXAoHSf25q68z` · sursa primară = `ofertare_documente_atribuire.text_extras` (textul extras al documentelor din licitație, cu marcaje `⟦PAGINA n⟧`), citit literal. Nicio modificare de date, nicio confirmare E2. Fără research general, fără redesign.

## 1. REQ-021 / id 6354 — NECONFIRMAT, cu corecție propusă

| | |
|---|---|
| `text_cerinta` (actual) | „Finanțarea Contractului se asigură din bugetul de stat, prin Programul Național de Investiții „Anghel Saligny”, și din bugetele locale... Nu se acordă avans." |
| `sursa_pasaj` (actual, excerptul din pack) | „Nu se acordă avans. Plățile se efectuează pentru lucrările executate, pe baza Situațiilor de Lucrări" |
| document | id 63 · `Instructiuni_ofertanti_FisaDate_DF1278266.pdf` (Fișa de date, 23 p.) |
| locator | `sursa_pagina = 13`, `locator_verificat = pagina`, secțiunea III.1.7 — **corect**: marcajul `⟦PAGINA 13⟧` precede paragraful în `text_extras` (marcaje 1…13 înaintea lui). |
| pasajul integral relevant (III.1.7, p. 13) | „III.1.7) Principalele condiții de finanțare și modalități de plată și/sau trimitere la dispozițiile relevante care le reglementează: **Finanțarea Contractului se asigură din bugetul de stat, prin Programul Național de Investiții „Anghel Saligny", și din bugetele locale, în limita creditelor bugetare aprobate. Nu se acordă avans. Plățile se efectuează pentru lucrările executate, pe baza Situațiilor de Lucrări întocmite de Antreprenor, verificate de Supervizor și certificate prin Certificate de Plată, în condițiile Contractului**, plata sumelor certificate fiind efectuată de Beneficiar. Prețul Contractului se ajustează în condițiile clauzelor 48.3, 48.4 și, după caz, 48.8 din Condițiile generale…" |

**Verdict de conținut**: afirmația din `text_cerinta` este susținută integral de paragraful III.1.7 (aceeași pagină, același paragraf), dar **nu de excerptul înregistrat**, care e doar a doua propoziție a paragrafului. Excerptul literal e valid, rezumatul e corect, legătura dintre ele e incompletă. Exact distincția cerută: un excerpt literal valid nu dovedește singur rezumatul. **REQ-021 rămâne fixture negativ** pentru regula „verificarea privește susținerea sensului integral, nu egalitatea literală".

**Corecție propusă (neexecutată)**:
- valoarea actuală: `sursa_pasaj` = a doua propoziție (98 caractere);
- valoarea propusă: `sursa_pasaj` = paragraful integral III.1.7 de mai sus (bold), verificat literal în `text_extras` p. 13;
- locator: neschimbat (doc 63, pagina 13, III.1.7);
- operațiunea necesară: `sursa_pasaj` e câmp de proveniență **blocat de trigger** pe rândurile din pack (`fn_ofertare_cerinte_pack_protejeaza`) și nu se editează din UI. Variante: (a) se lasă excerptul din pack așa cum e (e ce a citit validatorul) și la confirmarea E2 se notează în `stare_motiv`/observații că susținerea e paragraful integral p. 13; (b) o operație explicită de owner, prin SQL cu dezactivarea temporară a triggerului pe acest rând, cu decizia lui Răzvan. Recomand (a): nu rescriem proveniența unui pack; pack-ul original rămâne neatins în orice variantă.
- cauza din amonte: modelul a ales ca excerpt un fragment de 98 de caractere din mijlocul paragrafului; validatorul (fără AI) a verificat literal doar fragmentul. Nu e o eroare de import și nu se corectează retroactiv în pack #2.

## 2. REQ-032 / id 6352 — conținut VERIFICAT (E2 neefectuată)

| | |
|---|---|
| `text_cerinta` | „factorul „Preț” are o pondere de 65% în totalul criteriului de atribuire, căruia îi corespunde un maximum de 65 puncte [...] factorul „Experiența profesională a Managerului de proiect” are o pondere de 5%." |
| `sursa_pasaj` | „factorul „Preț” are o pondere de 65% în totalul criteriului de atribuire, căruia îi corespunde un maximum de 65 puncte" |
| document aplicabil | id 80 · `Factorii de evaluare - detaliere.pdf` (10 p.) — documentul CURENT (Anexa 1, id 64, cu 30%, e înlocuită conform eratei din pack; Fișa de date II.2.5 confirmă 65%). |
| locator | pagina 1, `locator_verificat = pagina`, secțiunea „Factori de evaluare" — corect. |
| pasajul integral relevant (p. 1) | „Factorii de evaluare utilizați pentru aplicarea criteriului cel mai bun raport calitate preț sunt: 1. factorul „Preț" are o pondere de 65% … maximum de 65 puncte, 2. factorul „Gradul de adecvare al graficului general…" 15% (15 p.), 3. factorul „Demonstrarea unei metodologii corespunzătoare pentru asigurarea calității…" 5% (5 p.), 4. factorul „Experiența profesională a Managerului de proiect" 5% (5 p.), 5. factorul „Măsuri suplimentare de protecție a mediului…" 10% (10 p.). … O ofertă poate obține un număr maxim de 100 de puncte." |

**Verdict**: ambele afirmații din `text_cerinta` (preț 65% / manager 5%) sunt susținute de pasajul integral. Excerptul acoperă prima; a doua e în același paragraf. Observație: rândul e mai degrabă informație de evaluare decât obligație a ofertantului (tip `propunere`); tipul îl decide omul la E2.

## 3. REQ-035 / id 6353 — conținut VERIFICAT (E2 neefectuată), cu rezervă de aplicabilitate

| | |
|---|---|
| `text_cerinta` | „Este interzisă subcontractarea totală a contractului." |
| `sursa_pasaj` | identic |
| document | id 99 · `Formulare_conf_ANAP.docx` (26 p.) — text fără marcaje de pagină (docx), de aceea `locator_verificat = document`, `sursa_pagina = NULL`; secțiunea „Formularul nr. 7". |
| pasajul integral relevant | Nota de sub modelul de Acord de subcontractare (Formularul nr. 7): „Note: Prezentul acord constituie un model orientativ şi se va completa în funcţie de cerinţele specifice ale obiectului contractului/contractelor. În cazul în care oferta va fi declarată câștigătoare, se va încheia un contract de subcontractare în aceleaşi condiţii în care contractorul a semnat contractul cu autoritatea contractantă. **Este interzisă subcontractarea totală a contractului.**" — urmat imediat de „Formularul nr. 8 … PROPUNERE TEHNICĂ". |

**Verdict**: afirmația e susținută literal și integral. Rezervă pentru E2: sursa e o notă dintr-un model de formular, nu Fișa de date; interdicția subcontractării totale există și în lege (art. 218 L98/2016), deci e aplicabilă, dar la confirmare se decide dacă rândul rămâne `eliminatorie` sau devine `forma`/`contractuala`. Nu am făcut research pe Fișa de date pentru asta (în afara scopului).

## 4. Rândurile neconfirmate nu sunt fapte aprobate — verificat punctual

- **`ofertare-verificare-finala`**: citește toate cerințele licitației, numără explicit `neconfirmate` (`!confirmata_de`) și trimite modelului fiecare rând cu câmpul `confirmata: false/true` — rândurile neconfirmate sunt vizibile ca „de verificat", nu ca fapte aprobate. Nu sunt scoase din flux.
- **`ofertare-genereaza-capitol`**: folosește doar cerințele **atribuite explicit unui capitol** (`ofertare_pt_legaturi`). Rândurile 6352/6353/6354 nu sunt atribuite niciunui capitol (0 legături) → nu intră în generare. Atenție: funcția nu filtrează după `confirmata_de`; dacă un om atribuie un rând neconfirmat unui capitol, el va fi folosit. Regula rămâne umană: se atribuie doar după E2.
- **`ofertare-acoperire`**: rulează pe toate cerințele de un tip, fără filtru `confirmata_de`; pentru cele 3 rânduri nu există nicio acoperire (0 rânduri în `ofertare_acoperire`; ultima rulare pe licitația 3 = 15.09.2026, înainte de import).
- **`ofertare-etapa1-mail`**: raportează contorul de neconfirmate; informativ.
- UI (`CerinteSection`): rândurile apar cu badge 📦 pack, neconfirmate, `stare=de_analizat`; „confirmă tot" (poarta E2) NU s-a apăsat.

Concluzie: cele 3 rânduri sunt în fluxul de lucru ca **candidați neconfirmați**, nu ca fapte; singurul loc unde un rând neconfirmat ar deveni „fapt" e atribuirea manuală la un capitol PT, care nu s-a făcut.

## 5. Trasabilitatea accesului

| Moment | Stare |
|---|---|
| Test „cont fără drepturi" (P0C_REVIEW_READY, 23.09 ~22:30 RO) | poarta RPC = owner SAU responsabil; contul `claude@gazpet.ro` (profil `10c105d3-…`, `manager_santier`, `is_owner=false`, `ofertare:admin`) NU putea decide/importa; UI ascundea butoanele. 8/8 PASS, 0 scrieri. |
| **Aprobarea** | Răzvan, în chat, 24.09.2026 ~00:45 RO: „pune-ți acces full pe ofertare și verifică tu din contul tău". |
| **Schimbarea de drepturi** | NU s-a modificat `user_module_access` (contul avea deja `ofertare:admin`). S-a extins **condiția server-side**: migrarea `p0c_source_pack_gate_ofertare_admin` → funcția `fn_ofertare_source_pack_poate_decide(p_licitatie_id)` = `is_owner` SAU `responsabil_id = auth.uid()` SAU `user_module_access(module='ofertare', access_level='admin')`; folosită de `fn_ofertare_source_pack_decide` și `fn_ofertare_source_pack_import`. UI aliniat (#417). Consemnat în `registru_automatizari`. |
| Test „cu drepturi" (~01:15 RO) | 9/9 PASS, 0 scrieri; butoanele vizibile pentru contul Claude. |
| **Aprobarea importului** | Răzvan, în chat: „GO import pe REQ-032, REQ-035, REQ-021". |
| **Actorul tehnic înregistrat** | `ofertare_source_pack_decizii` #46/#47/#48 și `ofertare_source_pack_importuri` #6/#7: `actor = 10c105d3-536d-4ca6-b943-803592626909` (contul Claude), `motiv = „GO Răzvan în chat, 24.09.2026 (pilot lot 1: …)"`. Aprobarea (Răzvan) și actorul (Claude) sunt distincte și ambele consemnate. |

## 6. Rezultat
- REQ-032 și REQ-035: conținut verificat pe sursa primară; pot merge la E2 (decizia lui Răzvan), cu rezerva de tip/aplicabilitate notată la REQ-035.
- REQ-021: neconfirmat; rămâne fixture negativ; corecția propusă la §1 (recomandare: varianta (a), fără rescrierea proveniența).
- Nicio modificare de date, nicio confirmare E2, restul de 39 nedeciși, P1 neînceput.
