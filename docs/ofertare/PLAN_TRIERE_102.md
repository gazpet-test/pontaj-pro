# Plan — trierea personalului (ofertare-triere) și trierea pe loturi a licitației 102 (Botoșani CN1096645)

Status: PLAN, nimic implementat / scris în BD. Pregătit 12.10.2026 noaptea de sesiunea Ofertare (server), la cererea chatului.
Ordinea: **după** PR-ul de rigoare #679 (apply 20261026a = „da” separat). Termen depunere 30.10.2026, participăm la Lot 2 și Lot 3.
Surse: `claude_context` #1727 (deciziile lui Răzvan), raportul `C:\Users\Public\paw-data\out\diagnostic_personal_ofertare_20261012.md`,
citiri read-only din live (12.10, ~00:30).

## Fapte verificate pe live (read-only)

- 102 = `are_loturi`, 4 loturi. Din fișa de date (doc 532): **Lot 1** Coșula–Săveni · **Lot 2** Săveni–Darabani · **Lot 3**
  Stăuceni–Ștefănești · **Lot 4** Dorohoi–Darabani.
- **Toate cele 507 documente sunt `lot_stare = necunoscut`** (eligibilitate `de_triat`), inclusiv fișa 532 și detalierea 522. Consecință:
  poarta de loturi blochează ACUM orice procesare plătită pe 102, inclusiv refacerea trierii (`ofertare-triere` index.ts:449
  refuză fișa). Deci (2) trierea pe loturi trebuie făcută cel puțin pentru documentele comune înainte de (1)/re-triere.
- Doc 522 „Detaliere criteriu de atribuire.docx” (tip `alta`, text 14.353 caractere) — factorul 2 (15%) = DOAR **Manager Proiect**,
  pe **conducte de TRANSPORT gaze naturale de înaltă presiune**:
  sub 2 proiecte = **neconform** · 2 = 1 p · 3 = 5 p · 4 = 9 p · ≥5 = **13 p** · **+2 p** pentru certificat de curs „Manager de proiect”
  de la furnizor acreditat (maxim 15). *Corecție față de #1727: nu „>4 până la 15”, ci ≥5 = 13 + bonus 2.*
- Trierea afișată azi e din 24.09 (doc 532, verdict `cu_clarificari`), deci fără 522.
- `documente_firma` (105 rânduri): nicio autorizație ET; doar EDIB (până 2030-07-07). Coloane: `denumire, categorie, tip, data_valabilitate,
  fara_expirare, activ, utilizabil, pdf_path, …`.

## (1) Trierea personalului — PR de cod în `ofertare-triere` (fără schemă, varianta recomandată)

| # | Schimbare | Unde |
|---|---|---|
| 1.1 | **Documentele de criterii în context**: pe lângă fișa de date, documentele licitației cu nume ~ `criteri|detaliere|factor|evaluare` (sau tip dedicat, vezi decizia D3) intră ca text (`text_extras`, plafon ~40k), fiecare prin `documentEligibil` (poarta pe loturi). Dacă un astfel de document există dar e blocat/neeligibil → rezultatul marchează vizibil „criteriile de atribuire NU au intrat în context: doc #522 (de_triat)” și verdictul nu poate fi `mergem` (fail-closed, nu tăcut). | index.ts ~440-456, ~514 |
| 1.2 | **Prompt: atestări de FIRMĂ ≠ roluri** — autorizațiile ANRE/ISC/ISO de operator economic (ET, EDIB etc.) merg DOAR în `atestari`; în `roluri` intră doar persoane nominalizate. Factorii de evaluare nu sunt roluri: rolurile se extrag din detalierea criteriilor. | PROMPT l.51-61 |
| 1.3 | **AUTORIZAȚII FIRMĂ în context** din `documente_firma` (`activ`, `utilizabil`, `data_valabilitate`/`fara_expirare`); verdictul marchează lipsa unei autorizații de firmă cerute ca risc eliminatoriu (`cu_clarificari`/`nu_se_poate`). | context nou |
| 1.4 | **Echivalențe ANRE ca mapare explicită aprobată** (decizia #1727 pct. 2), nu judecata AI: tabel constant în `_shared/echivalenteAnre.ts` (cod vechi de persoană → tipul nou acceptat), trimis în prompt; **post-validare în cod**: o `propunere` pe un rol care cere un tip ANRE e acceptată doar dacă persoana are tipul literal sau unul din echivalențele aprobate, altfel motiv „echivalență nevalidată” (nu verde). | `_shared/` nou + post-procesare |
| 1.5 | **Preferință EGT** (decizia #1727 pct. 3): pe rolurile de persoană EGT se propune de principiu TRUȘU RĂZVAN sau STĂNESCU SILVIU — constantă în cod, trimisă ca preferință; codul nu propune pe altcineva dacă unul din cei doi are EGT valabil. | constantă + post-procesare |
| 1.6 | **Barem cu bonus**: structura `barem` primește `bonus: {conditie, puncte}`; codul acordă bonusul doar dacă persoana are în `hr_autorizatii` un certificat „Manager de proiect” valabil (altfel îl afișează ca „+2 p posibil cu certificat”). Natura `transport` (nu distribuție): recomandările pe distribuție NU se numără la acest rol. | `baremRol`/`puncteBarem` ~159-180 |
| 1.7 | Higienă context (diagnostic pct. 5): `hr_autorizatii` doar cu titular activ (`emp.active` / `ext.activ`); plafonul de 160 de linii prioritizat pe ANRE/RTE/manager, cu avertisment dacă se taie. | ~461-493 |
| 1.8 | Teste deno: selecția documentelor de criterii (inclusiv blocat pe lot → avertisment), echivalențe (literal / aprobat / refuzat), bonus barem, preferința EGT. | `ofertare-triere/*_test.ts` |

Livrare: branch + PR draft → Jakarinos (cod) → merge → **deploy ofertare-triere = „da” Răzvan** → re-triere pe 102 (cost AI, buton
„Refă trierea” apăsat de owner/responsabil, după ce 532 + 522 sunt triate `comun`).

**Date reale (doar cu „da” Răzvan, separat):** autorizația ET a firmei se adaugă în `documente_firma` **cu documentul** (Răzvan îl are /
îl urcă). Fără ea, verdictul corect pe 102 rămâne „autorizație de firmă ET lipsă în platformă”.

## (2) Trierea pe loturi a lui 102 — propunere (preview → „da” → apply prin RPC, cu confirmare umană)

Scrierea stărilor se face DOAR prin `fn_ofertare_documente_lot_seteaza` (rol verificat în funcție; owner / responsabil / admin
Ofertare). Propunerea de mai jos e **reguli deterministe pe calea din `nume_original`** + AI doar pe ce rămâne neclar.

| Grup (după cale) | Doc. | Pagini | Propunere | Sursă |
|---|---:|---:|---|---|
| `*/1_CTGN|COTG Cosula-Saveni-Darabani/*` (Cond 80, Elec 62, Constr 20) + `4_Studii Geotehnice/1_*` (2) | 164 | ~391 | **alocat {1,2}** — folder MIXT (Lot 1 Coșula–Săveni + Lot 2 Săveni–Darabani). Se procesează (conține Lot 2), dar cerințele/cantitățile extrase poartă lotul pe pagină/tronson. Opțional: AI propune pe planșă {1} / {2} / {1,2} după tronson/localitate, om confirmă. | regulă + AI opțional |
| `*/2_* Stauceni-Stefanesti/*` (55+52+17) + geo `2_*`, `2a_*` (3) | 127 | ~428 | **alocat {3}** | regulă |
| `*/3_* Dorohoi-Darabani/*` (52+73+14) + geo `3_*` (1) | 140 | ~247 | **alocat {4}** — în afara participării, neprocesat | regulă |
| `Precizări_Cerinte lotN`, `Acord contractual … Lot N`, `Formular propunere tehnica - LOT N` | 12 | ~163 | **alocat {N}** | regulă (lot în nume) |
| Rădăcină: fișa 532, detalierea 522, DUAE, formulare standard, `1a_PT-Mem+CS` (447 p), `3_PT FV rev.8` (1636 p), `4_REFOLOSIBILE`, `2a_P. Ds. Elec` (fișier la rădăcina folderului) | ~29 | ~2.111 | **comun** | regulă + verificare om (documentele mari 1247/772 rămân comune — Faza 0) |
| `3_Avize/*` | 44 | 95 | **comun implicit**; avizele cu localitate în nume (ex. „Aviz Săveni”) → AI propune lotul după localitate, om confirmă | AI pe neclare |

Ce NU se face automat: niciun document nu trece în `alocat {4}` / în afara participării fără să apară în preview (o excludere greșită
= lipsă tăcută, mai gravă decât un document lăsat de triat). Preview: listă completă pe grupuri + numărătoare „procesate / în afara
loturilor / de triat”, aprobată de Răzvan; apply în loturi mici prin RPC (cu `p_nota` = regula aplicată), `RETURNING` pentru revenire.
AI-ul (dacă se folosește pe avize / folderul mixt) doar PROPUNE, pe text deja extras (fără citire nouă plătită de PDF-uri), omul confirmă.

Ordinea recomandată: **2a** fișa 532 + detalierea 522 + rădăcina → `comun` (deblochează re-trierea personalului) → **1** PR triere +
deploy → re-triere 102 → **2b** restul grupurilor (reguli) → **2c** avize + folderul mixt (AI propune, om confirmă).

## Decizii pentru Răzvan

- **D1** Trierea pe loturi: aplic regulile din tabel (preview complet → „da” → apply), AI doar pe avize / folderul mixt? (recomandat: da)
- **D2** Folderul `1_ Cosula-Saveni-Darabani` (Lot 1 + Lot 2, 164 doc.): A = `{1,2}` pe tot și lotul pe pagină la extragere (recomandat, rapid) / B = AI + om pe fiecare planșă înainte.
- **D3** Documentele de criterii: A = recunoaștere după nume (`criteri|detaliere|factor`, recomandat, fără schemă) / B = tip nou `criterii_atribuire` (schemă + reclasificare).
- **D4** Lista exactă de echivalențe ANRE vechi → nou de pus în cod (o completează / confirmă Răzvan; până atunci nicio echivalență acceptată automat).
- **D5** Autorizația ET a firmei: documentul pentru `documente_firma` (de la Răzvan).
