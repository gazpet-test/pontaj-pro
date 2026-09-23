# P0C_PILOT_REVIEW — verificarea de conținut a celor 3 rânduri importate (Mânăstirea, pack #2)

Data: 24.09.2026 (v2, ~03:00 RO; v1 ~02:10) · sesiune `session_01TYQw97aZXVXAoHSf25q68z` · nicio modificare de date, nicio confirmare E2, fără redesign, fără extinderea importului.

## 0. Sursa verificării — v2 = ORIGINALELE, nu `text_extras`

| Document | Original citit | Cum | SHA256 original (NAS) | SHA256 în pack #2 | Identic |
|---|---|---|---|---|---|
| Fișa de date (doc 63) | `Z:\Oferte\2.DISTRIBUTIE GAZE\58.Distrib gn in com MANASTIREA, JUD CALARASI termen dep 24.09.2026\documentatie SEAP\Instructiuni_ofertanti_FisaDate_DF1278266.pdf` (23 p., 292.352 B) | `pdftotext -layout -f 13 -l 13` pe Terra (imaginea CLI, poppler), pe o copie din staging; subsolul paginii extrase spune „Pagina 13" | `fd04dcaa…b0f0be` | `fd04dcaa7df1dc5d…` | ✅ |
| Factorii de evaluare (doc 80) | `…\documentatie SEAP\Factorii de evaluare - detaliere.pdf` (10 p., 383.293 B) | Desktop Commander `read_file` PDF (extracție proprie), pagina 1 „Cod document: SC Pagina 1 din 10" | `9e1e29c1…e5ded` | `9e1e29c161f5b347…` | ✅ |
| Formulare (doc 99) | `…\documentatie SEAP\Formulare_conf_ANAP.docx` (62.290 B) | dezarhivat `word/document.xml`, tag-uri eliminate; poziția notei = 15.508 din 48.152 caractere, între „Formularul nr. 7" (13.231) și „Formularul nr. 8" (15.548) | `d9749d61…75c99` | `d9749d6167282fe7…` | ✅ |

Versiunea identificată a documentelor = fișierele din folderul licitației pe NAS (ACL birou, root pe Terra), identice bit cu bit cu ce a citit CLI-ul la producerea pack-ului. `text_extras` din BD (v1) e concordant cu originalele pe toate cele trei pasaje.

## 1. REQ-021 / id 6354 — asociere probatorie incompletă (NU informație inventată)

| | |
|---|---|
| `text_cerinta` | „Finanțarea Contractului se asigură din bugetul de stat, prin Programul Național de Investiții „Anghel Saligny”, și din bugetele locale... Nu se acordă avans." |
| `sursa_pasaj` (excerptul din pack, literal, `pasaj_verificat = true` — rămâne true) | „Nu se acordă avans. Plățile se efectuează pentru lucrările executate, pe baza Situațiilor de Lucrări" |
| locator | doc 63 · **pagina 13** (confirmat pe original: subsolul „Pagina 13") · III.1.7 |
| **pasajul exact din original (p. 13, III.1.7)** | „Finanțarea Contractului se asigură din bugetul de stat, prin Programul Național de Investiții „Anghel Saligny”, și din bugetele locale, în limita creditelor bugetare aprobate. Nu se acordă avans. Plățile se efectuează pentru lucrările executate, pe baza Situațiilor de Lucrări întocmite de Antreprenor, verificate de Supervizor și certificate prin Certificate de Plată, în condițiile Contractului, plata sumelor certificate fiind efectuată de Beneficiar." |

**Concluzie**: afirmația e susținută integral de paragraful de pe pagina 13; excerptul înregistrat susține doar partea „nu se acordă avans". Fixture negativ „excerpt literal valid ≠ rezumat susținut". Fără schimbare de date: pack-ul, excerptul și proveniența rămân neatinse (trigger neatins).

## 2. REQ-032 / id 6352 — aceeași limită, tratată simetric

| | |
|---|---|
| `text_cerinta` | „factorul „Preț” are o pondere de 65% în totalul criteriului de atribuire, căruia îi corespunde un maximum de 65 puncte [...] factorul „Experiența profesională a Managerului de proiect” are o pondere de 5%." |
| `sursa_pasaj` (literal, rămâne) | „factorul „Preț” are o pondere de 65% în totalul criteriului de atribuire, căruia îi corespunde un maximum de 65 puncte" |
| locator | doc 80 · pagina 1 · „Factori de evaluare" — confirmat pe original |
| **fragment exact 65% (original p. 1)** | „1. factorul „Preț” are o pondere de 65% în totalul criteriului de atribuire, căruia îi corespunde un maximum de 65 puncte," |
| **fragment exact 5% (original p. 1)** | „4. factorul „Experiența profesională a Managerului de proiect” are o pondere de 5% în totalul criteriului de atribuire, căruia îi corespunde un maximum de 5 puncte," |
| concordanță cu Fișa de date | II.2.5 (original p. 3–5): „Pretul ofertei … 65% Punctaj maxim factor: 65"; „FACTORUL „Experiența profesională a Managerului de proiect” … 5% Punctaj maxim factor: 5". |

**Concluzie**: ambele componente sunt susținute de pagina 1 a documentului aplicabil (și de Fișa de date II.2.5); excerptul acoperă doar 65%. Componenta „5%" are dovada suplimentară de mai sus, fără elipse. Fără schimbare de date.

## 3. REQ-035 / id 6353 — clauza confirmată; tipul rămâne de decis

| | |
|---|---|
| `text_cerinta` = `sursa_pasaj` | „Este interzisă subcontractarea totală a contractului." |
| document | doc 99 `Formulare_conf_ANAP.docx` (fără paginație fixă → `locator_verificat = document`, `sursa_pagina = NULL`), secțiunea „Formularul nr. 7" |
| **pasajul exact din originalul DOCX** (nota de sub modelul „Acord de subcontractare", imediat înainte de „Formularul nr. 8 … PROPUNERE TEHNICĂ") | „Note: Prezentul acord constituie un model orientativ si se va completa în functie de cerintele specifice ale obiectului contractului/contractelor. In cazul în care oferta va fi declarata câștigatoare, se va încheia un contract de subcontractare în aceleasi conditii în care contractorul a semnat contractul cu autoritatea contractanta. Este interzisa subcontractarea totala a contractului." |

**Concluzie**: clauza există literal în formular. **Tipul**: propun `contractuala` (sau `forma`), nu `eliminatorie` — textul e o notă la modelul de acord de subcontractare (obligație la contractare), nu un criteriu de calificare cu sancțiune de respingere formulată în Fișa de date; nu am verificat aplicabilitatea în Fișa de date III.1 (în afara scopului) și **nu folosesc trimiterea la art. 218 L98/2016 ca probă** (textul legal nu e reprodus, nu e verificat aici). Decizia de tip o dă Răzvan la E2; schimbarea de tip e câmp editabil (nu proveniență).

## 4. Dovada suplimentară — mecanismul existent NU o poate ține legată de cerință (limită semnalată înainte de E2)

Inventarul locurilor existente, per cerință:
- `ai_feedback` (ref_table='ofertare_cerinte', ref_id): `verdict` e limitat prin CHECK la `neverificat | confirmat | corectat | respins`, iar `output_corectat` e gândit pentru textul corectat — o „dovadă suplimentară" ar trebui înregistrată ca `confirmat` (= confirmare generică, exact ce nu vrem) sau ca `corectat` (fals).
- `ofertare_cerinte.stare_motiv`: text liber pe rând, dar semantic legat de stările `nu_se_aplica`/`blocata`; fără structură, fără verificator/dată proprii.
- `ofertare_pt_observatii`: per capitol PT, nu per cerință. `ofertare_verificari`: per licitație (raport arbitru). `ofertare_acoperire_revizii`: per acoperire.
- `ofertare_source_pack_decizii`: per (pack, ref), append-only, cu actor/timp/motiv — cel mai apropiat, dar decizia curentă e deja `IMPORT` și un rând nou cu `motiv` lung ar suprascrie semantic „decizia curentă" (rămâne IMPORT, dar amestecă decizia cu dovada).

**Limita**: nu există un loc structurat, per cerință, pentru {document_id, versiune (sha256), locator, pasaj exact, concluzie, verificator, dată}. Nu înlocuiesc cu o confirmare generică. Până la decizie, dovada stă în acest fișier (repo, main) și în `claude_docs.handoff_activ`. **Propunere minimă (neexecutată, cere GO)**: tabel append-only `ofertare_cerinte_dovezi` (cerinta_id, document_id, sha256, locator jsonb, pasaj text, concluzie text, verificat_de uuid, verificat_la) + RLS ca la decizii; UI: listă sub rândul din registru. Alternativ, fără schemă: un rând `ofertare_source_pack_decizii` cu decizie `IMPORT` repetată și `motiv` = dovada structurată în text — funcțional, dar amestecă semanticile; nu recomand.

## 5. Drepturile — sfera exactă și cererea de confirmare

Regula server-side (`fn_ofertare_source_pack_poate_decide`) autorizează, pe lângă owner și responsabil, **orice cont cu `user_module_access(module='ofertare', access_level='admin')`**. Sfera reală la 24.09.2026:

| Cont | Nivel Ofertare | Poate decide/importa |
|---|---|---|
| Razvan Trusu, Tudorache Marilena Claudia | owner | da (dinainte) |
| responsabilul fiecărei licitații | — | da, doar pe licitația lui (dinainte) |
| **Claude** (`claude@gazpet.ro`) | **admin** (15.09.2026) | **da — singurul admin** |
| Cristina Dumitrescu, Kostas T, Madalina Tanase, Mioara Olaru, Mirela Popescu, Mirela Rosu, Oana Nica, Silviu Stanescu | editor | nu |

Deci astăzi regula afectează un singur cont, dar orice viitor `ofertare:admin` va primi automat dreptul. **Răzvan: confirmi păstrarea politicii „admin Ofertare = poate decide/importa" (opțiunea A), sau o restrângem explicit la contul Claude / la owner+responsabil (opțiunea B)?** Nimic nu se schimbă până nu răspunzi.

## 6. Protecția generatorului — remediere DESCHISĂ, nu închisă

- Faptic acum: cele 3 rânduri nu au legături PT (0 în `ofertare_pt_legaturi`) și nu au acoperiri (0) → nu intră în generare. Rămân neatribuite până la E2.
- NU e demonstrată o interdicție tehnică generală: `ofertare-genereaza-capitol` folosește orice cerință atribuită unui capitol, indiferent de `confirmata_de`; `ofertare-acoperire` rulează pe toate cerințele unui tip; `ofertare-verificare-finala` le marchează `confirmata:false` (bine). Remediere înregistrată ca todo: filtrare / semantică explicită a cerințelor neconfirmate în generator (blocare la atribuire sau marcaj „NECONFIRMATĂ" în prompt), de decis în P1.

## 7. Concluzia finală pe cele trei rânduri

| Rând | Conținut | Schimbare de date propusă | Gata de E2 (aprobare nominală Răzvan, fără „confirmă tot") |
|---|---|---|---|
| REQ-032 / 6352 | susținut integral (65% + 5%) pe originalul p. 1 | niciuna; dovada suplimentară pentru „5%" = §2 | da, ca `propunere` (informație de evaluare) — tipul îl confirmă Răzvan |
| REQ-035 / 6353 | clauza confirmată literal în DOCX | tip: `eliminatorie` → propun `contractuala` (câmp editabil, la E2) | da, după decizia de tip |
| REQ-021 / 6354 | susținut integral de paragraful III.1.7 p. 13; excerptul e parțial | niciuna pe proveniență; dovada = §1 | da, cu dovada suplimentară persistată (vezi limita §4) — sau rămâne fixture negativ neconfirmat până se decide §4 |

Restul de 39 de candidați: neatinși. P1: neînceput. După închiderea §4 (decizie) și §5 (confirmare) putem închide pilotul P0c fără a pretinde că documentația Mânăstirea a fost extrasă exhaustiv.
