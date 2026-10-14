# Pilot OCR local pentru paginile necitite din Ofertare — plan de proiectare

Status: PLAN (13.10.2026, actualizat 14.10). Nimic pornit, aplicat sau deployat. **Decizia lui Răzvan 14.10** (`claude_context`
#1736, benchmark #1734): citire dublă **LightOnOCR-2 (vLLM) + MinerU2.5-Pro (vLLM)**, iar **Claude e arbitrul** pe dezacorduri (nu
omul). Orice migrare, deploy sau pornire de proces = „da” scris de Răzvan direct în sesiunea Ofertare.
Surse: `claude_context` #1736 (decizia 14.10), #1734 (benchmark), #1726 (deskew obligatoriu), #1728 (audit 130/130, riscul e structura), #1731 (orientare, gardă v3,
prompt ignorat, cusătura benzilor); canalul `paw-data\dialog`; modelul de link semnat `supabase/functions/contracte-pdf-link`.

## 0. Ce avem de citit (live, 13.10.2026)

| Licitație | Documente | Pagini total | Pagini necitite | Unde |
|---|---:|---:|---:|---|
| 102 Botoșani | 507 | 3.435 | **1.447** | doar 2 documente: #1247 „3_PT FV rev.8” (1.251 din 1.636) și #772 „1a_PT-Mem+CS rev.4” (196 din 447) |

Ambele documente sunt `lot_stare = necunoscut` (de triat). Pilotul le procesează DOAR după ce sunt triate (propunerea: `comun`),
ca tot ce intră apoi în prompturi să treacă de aceeași poartă (`fn_ofertare_document_eligibil`). OCR-ul local n-are cost cloud,
dar textul lui alimentează procesări plătite — poarta rămâne una singură.

## 1. Citirea: două cititoare independente + Claude arbitru (decizia 14.10)

| Parametru | Valoare (decizia 14.10) |
|---|---|
| `citire.cititori` | **LightOnOCR-2** (vLLM) și **MinerU2.5-Pro** (vLLM), independente, pe aceeași imagine preprocesată |
| `citire.comparare` | pe **cuvânt**, pe **cifră** și pe **triplet de tabel** (cod / UM / cantitate); identic = acceptat local |
| `citire.arbitru` | **Claude**, DOAR pe decupajele cu dezacord: primește imaginea decupajului (nu pagina întreagă, nu textul celor doi ca instrucțiune) și decide ce scrie pe imagine |
| `citire.protocol` | orientare + deskew (#1726) + benzi tăiate ÎNTRE rânduri (S-20261013-pas5-text) — înaintea ambelor cititoare |
| `garda.versiune` | v3 (celule goale consecutive, #1731) — semnal: o gardă declanșată la oricare cititor = decupajul merge la arbitru |

Fiecare decupaj arbitrat se păstrează ca **triplet**: citirea LightOn / citirea MinerU / ce a ales Claude (+ motiv scurt). Pentru
**cantități** (bani): rândul se marchează „arbitrat de Claude”, rămâne verificabil de om pe imagine și **nu se promovează automat**.
Fișele de foraj / grilele aproape goale și planșele rămân EXCLUSE (nu se citesc corect, #1731). Prompturile libere sunt ignorate de
cititoare (doar layout nativ); riscul la tabele e STRUCTURA, nu caracterele (#1728) — de aceea comparația pe triplet.

**Arbitrajul în pilot** e manual-asistat: Claude în sesiunea Ofertare (abonament, nu API plătit), pe o coadă de decupaje cu dezacord.
**Dacă arbitrajul devine automat în producție** = automatizare nouă: fișă a–e, poartă de rol, iar dacă folosește API plătit —
plafon de cost + acord explicit al lui Răzvan (nu se presupune).

## 2. Selecția paginilor (automată, înainte de orice citire)

1. Doar pagini din `pagini_necitite` ale unui document **eligibil** (poarta pe loturi).
2. **Text nativ prezent** (stratul de text al PDF-ului, PyMuPDF): pagina NU merge la OCR. Excepție doar dacă textul nativ e
   vădit incomplet la tabele (#1728: referința nativă omitea 38,5% din rânduri) — atunci intră în dubla verificare, nu înlocuiește.
3. Clasificare pe pagină (local, fără AI cloud): orientare (0/90/180/270), raport alb/negru, densitate de linii de grilă,
   format (A3/A1 = probabil planșă). Excluse din pilot: **planșe/desene**, **fișe de foraj / grile aproape goale**, pagini albe.
4. Rămân: **pagini scanate de text** și **tabele scanate de cantități** — cele două tipuri pe care testele le-au arătat bune.

## 3. Fluxul de integrare (fără service_role pe server)

```
server AI ──(1) POST ofertare-pdf-link {document_id} + antet secret──► edge (secret în Vault, jurnal append-only, limită)
          ◄─(2) URL semnat 5 min (doar PDF-ul cerut, doar dacă documentul e eligibil)─┘
          ── descarcă, orientare + deskew + benzi între rânduri, citire cu model(e), garda v3
          ──(3) POST ofertare-ocr-scrie {document_id, pagina, text, semnale} + secret──► edge cu poartă pe secret
                 └─ scrie DOAR în tabelul nou (§5) cu sursa='ocr_local', model, protocol, semnalele gărzii;
                    NU atinge text_extras / pagini_necitite direct — promovarea e un pas separat (§4)
```

- Modelul e `contracte-pdf-link`: secret în Vault verificat în BD (`fn_verifica_secret`), `verify_jwt = false` cu poartă
  proprie, jurnal append-only, limită pe minut / zi. Edge-ul care emite linkul verifică ȘI eligibilitatea documentului.
- Edge-ul de scriere validează: document existent + eligibil, pagina în `pagini_necitite`, dimensiune text plafonată, model și
  protocol din lista albă. Serverul nu primește cheia service_role.

## 4. Fallback pe cloud și promovarea textului

- Dezacord între cititoare (cuvânt / cifră / triplet) sau gardă declanșată → decupajul merge la **Claude arbitru** (§1), nu la cloud.
- Pagina de tip nesuportat, sau decupaj pe care arbitrul nu-l poate decide de pe imagine (ilizibil) → „de verificat” și poate merge
  la citirea cloud existentă (`ofertare-ingest-doc` / `citeste-orice`), **cu poarta pe cheltuială** (owner / responsabil pornesc).
- **Promovarea** textului local în `text_extras` + scoaterea paginii din `pagini_necitite` nu e automată în pilot: un RPC cu
  rol (owner / responsabil), după validarea §6, cu `RETURNING` pentru revenire.

## 5. Schema minimă (PLAN — migrare doar cu „da”)

`ofertare_ocr_pagini` (append-only): `id`, `document_id` (FK), `pagina`, `text`, `sursa` = `ocr_local`, `model`, `protocol`,
`garda` (jsonb: versiune + semnale), `stare` (`citit` / `de_verificat` / `respins` / `promovat`), `creat_la`, `promovat_de/la` —
câte un rând per cititor (LightOn, MinerU) și unul pentru textul reconciliat.
`ofertare_ocr_arbitraje` (append-only): `id`, `pagina_id`, decupajul (bbox), `citire_lighton`, `citire_mineru`, `ales`, `motiv`,
`arbitru` = `claude` (+ sesiune / versiune), `e_cantitate` (bool), `verificat_de/la` (om, opțional) — perechea „cine a citit ce și ce
s-a ales” rămâne pentru audit.
RLS: citire pentru accesul Ofertare, scriere DOAR prin edge-ul cu secret (RPC SECURITY DEFINER cu EXECUTE doar service_role).
Unicitate pe (`document_id`, `pagina`, `model`, `protocol`) — o re-citire cu alt protocol e rând nou, nu suprascriere. Schema
finală (și legătura cu blocurile) = nota de proiectare; nicio migrare fără „da” direct.

**Legătura cu stocarea pe blocuri (notă de proiectare, de discutat după teste):** Răzvan vrea documentele ca blocuri
(paragraf / rând de tabel) cu identitate stabilă și versiuni append-only, ca o clarificare să schimbe doar blocurile atinse,
iar datele derivate (cerințe, cantități — proveniența din #677/#679) să trimită la versiunea exactă a blocului.
`ofertare_ocr_pagini` e intenționat pe pagină și append-only, ca să poată fi spartă ulterior în blocuri fără pierdere.
Proiectarea blocurilor = notă separată, mâine; nicio schemă fără „da” direct.

## 6. Validare (pilot)

- **20 de pagini mostră** din #1247 / #772: 10 text scanat + 10 tabele, alese de om (nu de model), citite de ambele cititoare
  (LightOn + MinerU), reconciliate (arbitraj Claude pe dezacorduri) ȘI citite de cloud, ca reper.
- Pe mostră se măsoară separat: câte decupaje au dezacord (volumul arbitrajului) și, pe cele arbitrate, câte decizii ale lui Claude
  confirmă omul pe imagine — în special la cantități.
- Comparația o fac **vizual** Claude și Răzvan pe imaginea paginii (ca la auditul 130/130), rând cu rând la tabele.
  NU se raportează un procent de acuratețe din „JSON valid” sau din potrivirea textului cu referința nativă (care e ea însăși
  incompletă, #1728).
- Rezultat: o fișă per pagină (corect / structură greșită / text lipsă / garda declanșată) în `paw-data\out\`.

## 7. Operațional

- **Un singur GPU**, partajat cu Codex / Paw: o coadă cu un singur consumator (lock pe GPU, ca lock-ul per conversație din
  `run_paw`); pilotul cedează când rulează altceva. Pornirea DOAR prin lansatorul unic (`run_paw` extins, nu `.ps1` ad-hoc).
- **Heartbeat** în `procese_heartbeat` (cheie `ocr_local_ofertare`, prag în minute) — după ce Module repară #49.
- **Server oprit**: nimic nu se pierde — paginile rămân în `pagini_necitite`; coada se reia de la ultima pagină scrisă
  (idempotent pe unicitatea din §5). Fără timeouts care să marcheze pagini „citite” fals.

## 8. Fișa de securitate (CLAUDE.md pct. 7) + rând în `automatizari`

- **(a) Conținut extern citit:** documentele de licitație (PDF-uri SEAP scrise de autorități / proiectanți). Textul OCR e DATE,
  nu instrucțiuni; nu ajunge niciodată ca prompt pentru o acțiune.
- **(b) Ce scrie:** doar rânduri în `ofertare_ocr_pagini` (append-only), prin edge cu secret. Nu trimite mail, nu atinge bani,
  drepturi sau `text_extras` (promovarea e un RPC cu rol, separat).
- **(c) Identitate:** serverul nu are service_role; edge-urile au service_role doar pentru URL-ul semnat și pentru RPC-ul de scriere
  cu EXECUTE restrâns — justificare ca la `contracte-pdf-link`.
- **(d) Cine pornește:** doar cine deține secretul (Vault) — serverul AI prin lansatorul unic; pilotul îl pornește Răzvan.
- **(e) Confirmare umană:** (a) și (b) se ating (citește conținut extern ȘI scrie) → poartă de rol pe promovare + validarea §6;
  fără promovare automată în pilot; cantitățile „arbitrate de Claude” rămân verificabile de om pe imagine. Arbitrul primește
  imaginea decupajului; textele celor două cititoare sunt DATE de comparat, nu instrucțiuni (pct. 10). Arbitraj automat în
  producție = automatizare nouă (fișă proprie, poartă de rol, plafon + acord dacă e API plătit).
- La pornire: rând în `public.automatizari` (fișa a–e, `secrete_nume` = numele secretului, fără valoare) + secțiunea din
  `registru_automatizari`.

## 9. Criterii de oprire și cost

- **Oprire pilot**: o pagină cu text promovat greșit (structură greșită care ajunge în cantități); garda declanșată pe > 20% din
  mostră; GPU-ul blochează Codex / Paw peste pragul stabilit; orice scriere în afara tabelului din §5.
- **Cost**: zero cloud pentru paginile citite local. Timp GPU: două treceri (LightOn + MinerU) pe 1.447 de pagini — de măsurat pe
  mostra din §6 înainte de estimarea finală (benchmarkul #1734 dă vitezele per model; LightOn ~3× mai rapid decât dots.mocr).
  Arbitrajul: doar decupajele cu dezacord, de Claude în sesiune (abonament, fără API plătit în pilot).
  Comparație: citirea cloud a costat ~86 $ în 60 de zile (ingest-doc 60 $, planșe 22 $, citește-orice 4 $).

## Decizii pentru Răzvan

- ~~**D1** Modelul / modelele de citire~~ — DECIS 14.10 (#1736): LightOnOCR-2 + MinerU2.5-Pro, Claude arbitru pe dezacord.
- **D2** Triajul pe loturi al lui #1247 și #772 (propunere: `comun`), înainte de pilot — prin preview → „da” → apply.
- **D3** Schema din §5 (migrare cu „da”) și cele două edge-uri (deploy cu „da”).
- **D4** Nota de proiectare pentru stocarea pe blocuri (după teste).
