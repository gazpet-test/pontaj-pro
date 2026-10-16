# Pipeline-ul de citire a documentelor (Ofertare) — de la PDF la BD

Document unic, cap-coadă (decizia Razvan 16.10.2026). **Orice PR care schimbă pipeline-ul îl actualizează în același PR** (secțiunea
afectată + un rând în „Istoric revizii”); CI-ul `pipeline-citire-doc.yml` pică altfel. Căile urmărite: `scripts/ocr_local/**`,
`supabase/functions/ofertare-ocr-*`, `ofertare-ingest-doc`, `ofertare-cantitati-extrage`, `ofertare-citire-test`, `ofertare-pdf-link`, migrările /
revenirile `*ofertare_ocr*`, `*ofertare_cant*`, `*ofertare_text_scrie*`, `*ofertare_citire_umbra*`.

Autori: partea 1 (ingest Haiku 5.5, proveniență / CAS, recitire, cantități — TKT-0329) = sesiunea Ofertare; partea 2 (OCR local,
arbitru, cititor_3, umbra) = laboratorul OCR; asamblarea = chatul principal.

## 0. Harta

```mermaid
flowchart TD
  A[PDF licitatie<br/>Storage / NAS] --> B[Ingest AI<br/>ofertare-ingest-doc<br/>Haiku 5.5]
  B --> C[(text_extras<br/>+ proveniență CAS)]
  B -->|pagini_necitite| D[Cerere OCR local din ERP<br/>fn_ofertare_ocr_cerere<br/>poarta pe cheltuială]
  D --> E[Client OCR local pe serverul AI<br/>preia · descarca · foaie · plan]
  E --> F[Citire GPU<br/>LightOn + MinerU<br/>garda v5]
  F --> G[Comparator literal<br/>+ proveniența marcajelor]
  G --> H{Triere}
  H -->|HIGH_RISK| I[Arbitru plătit<br/>Haiku 5.5 → Sonnet 5<br/>rezervare + plafon BD + prag §8]
  H -->|DEFER fără cifre| J[Restanță<br/>doar_haiku la decizie separată]
  H -->|MARCAJE / OM| K[La om]
  F -->|bandă oprită de gardă| L[cititor_3<br/>Opus, abonament]
  I --> M[Reconciliere<br/>reconciliat / needs_human]
  M --> N[(ofertare_ocr_pagini)]
  C --> O[Extragere cantități<br/>ofertare-cantitati-extrage]
  L -.umbră.-> P[(ofertare_citire_umbra)]
  P -.promovare doar prin CAS + da Razvan.-> C
```

---

## Partea 1 — Ingest AI, proveniență, recitire, cantități *(de completat de sesiunea Ofertare)*

### 1.1 Ingest (`ofertare-ingest-doc`, Haiku 5.5)
*[Ofertare]*

### 1.2 Proveniența textului și CAS (20261031a/b)
*[Ofertare]*

### 1.3 Recitire / citire test (`ofertare-citire-test`)
*[Ofertare]*

### 1.4 Cantități (`ofertare-cantitati-extrage`, TKT-0329 B)
*[Ofertare]*

---

## Partea 2 — OCR local (laboratorul OCR)

Cod: `scripts/ocr_local/` (client pe serverul AI), edge-urile `ofertare-ocr-scrie`, `ofertare-ocr-arbitreaza`, `ofertare-pdf-link`,
migrările 20261029b / c / e, 20261030d, 20261031c. Detaliile de proiectare:
`scripts/ocr_local/README.md`, `docs/ocrlab/*.md`.

### 2.1 Cine pornește ce
| Pas | Cine | Unde | Cost |
|---|---|---|---|
| Cererea rulării (`fn_ofertare_ocr_cerere`: licitație, documente cu `pagini_necitite`, plafon ≤ 15 USD) | om din ERP (poarta pe cheltuială) | BD | — |
| `erp preia / descarca / foaie / plan` | client, server AI | CPU, Storage (egress plafonat) | 0 |
| Confirmarea orientării paginilor | **om** (foaia de contact) | — | — |
| Pornirea vLLM (LightOn, apoi MinerU, un singur proces pe GPU, `gpu.lock`) | om / laborator, noaptea | GPU | 0 |
| `erp citeste`, `incarca-citiri`, `compara` | client | GPU / CPU / BD | 0 |
| `erp arbitreaza` | client, cu „da” Razvan pe sumă | edge + Anthropic API | plătit, plafonat în BD |
| Reluarea unei rulări oprite pe prag (`fn_ofertare_ocr_reia`, max 3) | chat, prin psql, cu „da” Razvan | BD | — |
| `erp reconciliaza` | client | CPU / BD | 0 |

### 2.2 Planul paginilor (`plan.py`)
Randare 150 dpi, orientarea **confirmată** (fără confirmare: `orientare_nerezolvata`, exclusă), deskew, benzi (text continuu → benzi
tăiate pe rânduri albe; tabel → pagina întreagă). **Rutarea v2 (#735)**: clasificarea pe pixeli (`drawing` / `grid_form` / `unknown`) NU
mai exclude pagina — e semnal `clasificare_incerta`, pagina se citește ca `quantity_table`; exclusă doar pagina practic albă
(cerneală < 0,2 %, fără `kind` dat de om). Motiv: pe Răcari, 140/176 de pagini din lista de cantități erau excluse ca „planșe”.

### 2.3 Cititorii și garda
LightOn-OCR-2 1B și MinerU 2.5 Pro 1.2B în vLLM pe loopback (`protocol.json`: căi, SHA-ul greutăților, comenzile `vllm serve`).
**Garda v5** (`guard.py`): oprește DOAR banda la buclă (bloc de 200 de caractere ×4, linie lungă ×4, celule goale, caractere unice puține),
după confirmarea vLLM liber; banda devine `banda_intreaga` → om. Scutirea imaginilor base64 MinerU e pe **proveniență înregistrată**
(#717), nu pe forma textului.

### 2.4 Comparatorul (`compare.py`)
Literal (varianta A, #718): cuvinte cu ș/ş, ț/ţ unificate DOAR la comparare; cifrele literal (separatorul zecimal nu se normalizează);
tabele rând cu rând; regula A (celule goale de la coada rândului). Ieșirea: dezacorduri `text`, `rand_tabel`, `rand_lipsa_*`,
`structura_tabele`, `banda_intreaga`, cu amprentă (`item_sha256`) legată de BD.
**Proveniența marcajelor (#737)**: marcajele scrise de pipeline (⟦rowspan⟧, cadrul ⟦img⟧ + `src`, ⟦tabel_neparsat⟧, ⟦…_invalid⟧, cadrul
⟦barat⟧, ^{ }/_{ }) trec prin `_m()`; în modul normal nimic nu se schimbă (segmente, itemi, BD); `segmente_provenienta` dă măștile, cu
paritate verificată (fail-closed).

### 2.5 Trierea (`triere.py`, #737 / #738)
| Clasă | Regula | Ce se întâmplă |
|---|---|---|
| HIGH_RISK | conținut diferit lângă cifre (număr, UM, semn, cod, coloană), proveniență nestabilită | arbitrul plătit (cascadă) |
| DEFER | conținut diferit, nicio cifră (Unicode) la niciun cititor | **restanță** (nu în masă la om) — a doua trecere decisă separat |
| MARCAJE | conținutul identic, diferă doar marcajele pipeline-ului | om |
| OM | `structura_tabele`, `banda_intreaga` | om, fără AI |
`erp arbitreaza --triere` e permis doar în probă (`--max-apeluri`) până la decizia pentru DEFER.

### 2.6 Arbitrul (`ofertare-ocr-arbitreaza`)
- **Cascadă** (implicit): Haiku 5.5 pe orice dezacord; Sonnet 5 când Haiku e nesigur sau citirile diferă în cifre. Prompt versionat
  (`arb-v3`, #742: regula 10 diacritice); `protocol.json` → `prompt_versiuni_admise` (deciziile plătite pe versiuni vechi rămân valabile).
- **doar_haiku** (#739): un apel Haiku, fără escaladare, refuz server-side dacă citirile din BD au vreo cifră (`\p{N}`); deciziile nu intră
  în pragul §8 (proveniență legată de tentativă + model + eticheta serverului).
- **Bani**: rezervare ATOMICĂ în BD pe limita de sus a apelului (`fn_ofertare_ocr_arbitraj_rezerva`), plafonul rulării
  (`cost + rezervat + abandonat ≤ plafon_usd`) = **poarta tare**; un plafon local în client e doar estimare (#736 respins).
- **Pragul §8**: needs_human > 15 % din arbitrajele Claude (după minim 20) → rularea `oprita`. Reluarea doar prin
  `fn_ofertare_ocr_reia` (max 3 pe rulare), numărătoarea pe epoca reluării.
- Validările 4xx ale edge-ului (înaintea rezervării) nu opresc proba (#741).

### 2.7 Reconcilierea (`reconcile.py`)
Baza = LightOn; deciziile validate strict (schemă, model și versiune admise); dezacord fără decizie validă = needs_human; o pagină cu
needs_human nu are text propus. Semnalele (`clasificare_incerta`, cusături) ajung în `garda.semnale`.

### 2.8 Cititorul 3 și umbra
- **cititor_3** (`cititor3.py`, branch `ocrlab/cititor3`): a treia citire cu Claude Code headless pe serverul AI (`claude -p --restricted
  --tools Read --strict-mcp-config`, fără cheie API = abonament), un apel concurent, timeout per bandă, oprire la limita abonamentului
  (fără trecere pe API). Backend-ul din configurare: `claude_cli` acum, `api` mai târziu (pe traseul arbitrului, cu rezervare).
- **Umbra** (20261031c): `ofertare_citire_umbra`, lângă producție, legată de document / pagină / bandă / imagine / PDF (sha) / orientare,
  cu sha-ul `text_extras` la citire; scriere doar postgres (psql); un rând nou intră `neevaluat`; `promovat` doar din `bun`, doar în
  tranzacția armată de fluxul CAS (cu „da” Razvan); rândurile promovate nu se modifică / șterg.
- Rezultat Răcari (16.10): pe d205 p58 (listă de cantități, oprită la ambii cititori) Opus a recuperat ultimele 2 articole, verificate pe
  imagine.

### 2.9 Tabelele OCR
`ofertare_ocr_rulari` (stare, plafon, cost, rezervări), `ofertare_ocr_pagini` (citiri pe bandă + reconciliat pe pagină),
`ofertare_ocr_dezacorduri`, `ofertare_ocr_arbitraje`, `ofertare_ocr_reluari`, `ofertare_citire_umbra`. Citire: accesul Ofertare
(`fn_are_acces_ofertare`); scriere: doar prin RPC / edge cu secretul OCR local sau ca postgres (umbra, reluarea).

### 2.10 Costuri (măsurate)
| | Valoare | Sursă |
|---|---|---|
| Cascadă, per apel | ~0,0048 USD (escaladare ~50 %) | proba r1, 117 + 126 apeluri |
| Haiku singur (doar_haiku), per apel | ~0,0005 USD | proba r1, 179 de apeluri |
| r1 (102), arbitraj complet / doar HIGH_RISK (5.926) | ~57 / ~28 USD | `paw-data/ocrlab/masurare_triere.json` |
| GPU, Răcari 960 de benzi | LightOn 36 min, MinerU 38 min | noaptea 15→16.10 |
| cititor_3 (Opus, abonament) | 11–32 s / bandă (mediana 19 s) | 42 de benzi Răcari |

### 2.11 Ce poate merge prost și cum se revine
| Situație | Efect | Revenire |
|---|---|---|
| Buclă la un cititor | banda oprită (`banda_intreaga`) | om / cititor_3 |
| Orientare greșită | citire greșită pe pagină | se confirmă pe imaginea ROTITĂ, nu pe miniatură |
| Prag §8 depășit | rularea `oprita` | `fn_ofertare_ocr_reia` (max 3), cu „da” |
| Plafon atins | rezervarea refuzată | plafon nou doar cu „da” |
| Apel cu rezultat necunoscut | item → needs_human, socotit la prag | automat la reluare |
| Migrare | — | `supabase/revenire/*_ROLLBACK.sql`, armată pe tranzacție |

---

## Istoric revizii
| Data | PR | Ce s-a schimbat |
|---|---|---|
| 14.10.2026 | #693 | Pipeline-ul OCR local D3c (LightOn + MinerU, comparare, reconciliere fail-closed) |
| 14.10.2026 | #696, #698 | Migrările D3a / D3b (20261029b / c) + cele 3 edge-uri |
| 14.10.2026 | #700, #702, #704 | Clientul OCR local → ERP (20261029e), butonul din Loturi, protecția la egress |
| 15.10.2026 | #708 | Garda fără alarmă falsă pe tabele + paza oprește doar banda |
| 15.10.2026 | #715 | Cascada arbitrului Haiku → Sonnet |
| 15.10.2026 | #716 | Reîncercare per item la urcarea citirilor |
| 15.10.2026 | #717 | Garda v5 (scutire pe proveniență, imagini base64) |
| 15.10.2026 | #718 | Comparatorul literal (varianta A) |
| 15.10.2026 | #719 | Prompt arb-v2 (formatul citirilor) |
| 15.10.2026 | #720 | Reluarea rulării oprite pe prag (20261030d) |
| 16.10.2026 | #735 | Rutarea v2: pixelii nu mai exclud pagini |
| 16.10.2026 | #737 | Proveniența marcajelor + trierea |
| 16.10.2026 | #738 | `--triere` doar în probă |
| 16.10.2026 | #739 | Modul doar_haiku (edge + client) |
| 16.10.2026 | #740 | Tabelul de umbră 20261031c |
| 16.10.2026 | #741 | Validările 4xx nu opresc proba |
| 16.10.2026 | #742 | Prompt arb-v3 (diacritice) |
| 16.10.2026 | (acest PR) | Documentul pipeline-ului + CI |
