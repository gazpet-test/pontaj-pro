# Motorul de import SEAP: audit cap-coadă (07.10.2026)

**Ce s-a auditat:** cele 4 drumuri prin care documentele unei licitații intră în `ofertare_documente_atribuire`, citite împreună pe `a45b4b3` (main + #644):
- edge `ofertare-seap-import`;
- `api/seap-import.js`;
- edge `ofertare-seap-veghe`;
- workerul NAS `worker/ofertare/seap.ts`.

**Cine:**
- Jakarinos (Codex, read-only) a făcut auditul: 21 de constatări.
- Claude a verificat fiecare constatare în cod și, unde s-a putut, pe datele din producție (read-only).
- Copilot (conv. 3) a fost poarta pentru fiecare PR.

## Stare pe constatări

| # | Sev. | Pe scurt | Stare |
|---|---|---|---|
| 1 | P0 | Curățenia orfanilor din edge ștergea tot din `<id>/atribuire/` la un SELECT eșuat și obiectele altui drum aflate între upload și INSERT. | **Reparat în #646**: fail-closed, inventar paginat, Storage paginat, doar obiecte neatinse de peste 1 oră. |
| 2 | P1 | Placeholder-ul de veghe era completat de două fișiere cu aceeași cheie de nume. | **Reparat în #646** (worker + edge). |
| 3 | P1 | Garda „deja desfăcută pe drumul SEAP” lucra doar pe nume, deci închidea fals republicările. | **Reparat în #646**: compară sha-ul arhivei. |
| 4 | P1 | Dedup pe nume ÎNAINTE de descărcare, pentru documente (edge per fișier, DownloadArchive, api, `lipsa` din worker). | **Deschis — decizie.** Ține de costul re-descărcărilor din SEAP (vezi „Documente .p7m” mai jos). |
| 5 | P1 | Fișierele „importate deja” se săreau pe orice `document_id` din manifest. | **Reparat în #646**: sha dovedit + documentul există acum, cu fișier real. |
| 6 | P1 | Coada workerului: 20 de cereri vechi blocau cererile noi; `terminat_la` acoperea o cerere venită în timpul procesării. | **Reparat în #646**. |
| 7 | P1 | O excepție după revendicare lăsa arhiva „in_lucru” blocată. | **Reparat în #646**. |
| 8 | P1 | `.p7s` din interiorul arhivelor: edge-ul le desface, workerul le urcă brute („ignorat”). | **Deschis.** Se rezolvă împreună cu desfacerea documentelor `.p7m` (aceeași funcție). |
| 9 | P1 | Parserul ZIP din flux (edge/api) tratează data descriptor sau trunchierea ca sfârșit normal. | **Deschis.** Necesită parsare a directorului central; PR separat cu teste pe ZIP-uri reale. |
| 10 | P1 | ZIP inline (edge/api) decomprimat fără plafon de ieșire (bombă). | **Deschis.** Plafon de output sau trimiterea arhivei la extractorul izolat de pe NAS. |
| 11 | P1 | Arhivele eșuate pe bucla de platformă nu blochează poarta de completitudine. | **Deschis — schemă/SQL** (migrare). Necesită „aplica” de la Răzvan. |
| 12 | P1 | Veghea pune tipul canalului, nu tipul din clasificatorul comun. | **Deschis.** Schimbă clasificarea în Clarificări; de decis. |
| 13 | P1 | Verificarea R6 distrugea dovada sha `urcat`. **În producție: 0 rânduri `urcat`, 836 `deja_in_platforma`.** | **Reparat în #646**. Dovezile noi rămân de acum încolo. |
| 14 | P2 | `cale` din manifest are sens diferit în edge (nume final) față de worker (cale în arhivă). | **Deschis** (identitate comună între drumuri). |
| 15 | P2 | Fișierele simple și copiii din bucla de platformă nu primesc rând de manifest, deci nu au dovadă sha. | **Deschis.** Duce doar la dubluri, nu la pierderi. |
| 16 | P2 | Api-ul compară numele exact; celelalte drumuri compară cheia normalizată. | **Deschis.** |
| 17 | P1 | Veghea citește doar prima pagină din GetAll (50 de înregistrări). | **Deschis.** Paginare + stare „enumerare incompletă”. |
| 18 | P2 | `JUNK_RE` pe prefix în edge/api. | **Reparat în #646**. |
| 19 | P1 | Edge-ul de import accepta orice cont logat (apoi service_role). | **Reparat în #647**: poarta comună Ofertare (`fn_are_acces_ofertare`). |
| 20 | P1 | `.p7s` nedesfăcut în edge/veghe/api: numele pierde `.p7s`, dar conținutul rămâne CMS. | **Deschis.** Împreună cu #8 și cu documentele `.p7m`. |
| 21 | P1 (ipoteză) | Inventare BD fără paginare (plafonul PostgREST). | Parțial: orfanii (#1) sunt paginați. Restul e deschis. Cea mai mare licitație are azi 507 documente. |

## Documente `.pdf/.docx.p7m` (cele 9 de la lic. 92) — de decis

**Context**
- Miloi (Antigravity, Gemini 3.1 Pro) a propus: desfaci conținutul, dar păstrezi numele `X.pdf.p7m`. Cheia rămâne distinctă de `X.pdf`, deci nu reapar problemele din r1/r2, și nici nu se descarcă de două ori.
- **Verificat în cod:** cel puțin 4 consumatori decid după numele care se termină în `.pdf`, deci ar refuza un PDF numit `….pdf.p7m`:
  - `ofertare-triere` (fișa de date);
  - `api/pdf-sparge`;
  - `api/plansa-felii`;
  - `ofertare-etapa1-mail`.

**Variante**
- **A (Miloi)** — numele rămâne `X.pdf.p7m`, conținutul e desfăcut.
  - Necesită adaptarea celor 4 consumatori (un „nume de lucru” fără `.p7m`).
  - Mai multe fișiere atinse, risc de regresii în citire.
- **B (recomandat)** — conținutul desfăcut primește un nume determinist care se termină în `.pdf` / `.docx`, de ex. `X (semnat).pdf`.
  - Nu se ciocnește cu `X.pdf` și nu cere modificări la consumatori.
  - Dedup-ul de dinainte de descărcare caută numele derivat, deci nu se re-descarcă.
  - Semnătura detașată rămâne `X.pdf.p7m`, „ignorat”, cu notă explicită.
  - Numele original din SEAP rămâne în `seap_meta`.
- **C** — status quo: documentele semnate `.p7m` se descarcă și se urcă de mână.

**Pentru cele 9 documente existente** (după B, cu preview + OK): reparare pe loc, fără SEAP și fără ștergeri.
1. Descarci obiectul brut din Storage și desfaci CMS-ul.
2. Urci un obiect nou și actualizezi rândul: nume, `fisier_path`, status.
3. Obiectul vechi rămâne până la verificare.

Id-urile sunt: 319, 320, 321, 322, 323, 324, 327, 359, 360.
