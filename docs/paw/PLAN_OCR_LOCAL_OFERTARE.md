# Pilot OCR local pe licitația 102 (Botoșani) — SPECIFICAȚIE FINALĂ

Status: SPECIFICAȚIE FINALĂ (14.10.2026, sesiunea Ofertare). Nimic pornit, aplicat sau deployat. Fiecare pas executabil are mai jos
linia EXACTĂ de „da” pe care Răzvan o scrie direct în sesiunea executantă (§9).
Decizii fixate (`claude_context` #1734 benchmark, #1736 decizia 14.10): citire dublă independentă **LightOnOCR-2-1B (vLLM)** +
**MinerU2.5-Pro (vLLM)**; **arbitraj AUTOMAT de Claude Sonnet 5** pe dezacord (vede imagini, 3 $ / 15 $ per 1M tokeni, deja folosit
în triere); **Opus 5** doar pentru fișe de foraj / planșe (în afara pilotului); **omul intervine DOAR unde Claude nu poate decide**
(`needs_human`). Dots.mocr NU mai e în pilot.
Surse: #1726 (deskew obligatoriu), #1728 (audit 130/130; riscul la tabele e structura), #1731 (orientare, gardă v3, cusătura
benzilor), #1734, #1736; pipeline-ul Codex `C:\Users\Gazpet-Ai\Documents\Codex\2026-10-10\git\work\pipeline_ocr_local`; modelul de
link semnat `supabase/functions/contracte-pdf-link`.

## 0. Ce se citește (live, 13–14.10.2026)

| Licitație | Documente | Pagini total | Pagini necitite | Unde |
|---|---:|---:|---:|---|
| 102 Botoșani | 507 | 3.435 | **1.447** | #1247 „3_PT FV rev.8” (1.251 din 1.636) și #772 „1a_PT-Mem+CS rev.4” (196 din 447) |

Ambele sunt `lot_stare = necunoscut`: pilotul le citește DOAR după triere `comun` (D2), ca tot textul rezultat să treacă prin aceeași
poartă (`fn_ofertare_document_eligibil`) înainte de orice prompt plătit.

## 1. Selecția paginilor (locală, fără AI)

1. Doar paginile din `pagini_necitite` ale unui document **eligibil**.
2. Pagina cu **strat de text nativ** suficient (PyMuPDF) nu merge la OCR.
3. Clasificatorul de pixeli al pipeline-ului dă **candidați** (`continuous_text`, `quantity_table`, `form`, `drawing`, `unknown`);
   orientarea automată rămâne „unresolved” la 0/180 și 90/270 → pagina se blochează, nu se ghicește (README pipeline).
4. **Excluse din pilot**: planșe / desene, fișe de foraj / grile aproape goale (Opus 5, separat, nu acum), formulare, pagini albe,
   orientare nerezolvată → listă „de rezolvat manual” în raport.
5. Rămân: **text scanat** și **tabele scanate de cantități**.

## 2. Citirea dublă (local, GPU)

- Preprocesare comună, o singură dată: orientare (confirmată), deskew ±2° (#1726), benzi tăiate ÎNTRE rânduri pentru text continuu
  (regula pas6); tabelele — pagina întreagă.
- **LightOnOCR-2-1B** și **MinerU2.5-Pro**, fiecare pe propriul server vLLM pe loopback, citesc aceeași imagine preprocesată, independent.
- Gardă v3 pe fiecare ieșire (bucle de celule goale, ieșire tăiată) — semnal, nu decizie.
- **Comparare** pe trei niveluri: cuvânt (diacriticele ș/ş, ț/ţ normalizate DOAR pentru comparare), cifră (fără nicio normalizare a
  separatorului zecimal) și **triplet de tabel** (cod / UM / cantitate). Identic la toate nivelurile = **acceptat local** (fără arbitraj).
  Orice dezacord sau gardă declanșată = decupajul (bbox) merge la arbitru.

## 3. Arbitrajul automat (Claude Sonnet 5)

**Intrare** per decupaj cu dezacord: imaginea decupajului (din pagina preprocesată) + cele două citiri ca DATE de comparat (nu
instrucțiuni — pct. 10), plus contextul minim (tip pagină, rândul precedent la tabele).

**Ieșire strict structurată** (JSON validat de schemă; orice altă formă = `needs_human`):

```json
{ "decizie": "ales_lighton" | "ales_mineru" | "text_propus" | "needs_human",
  "text": "<textul ales sau propus; gol la needs_human>",
  "motiv": "<max 200 caractere>",
  "e_cantitate": true | false,
  "anomalie_separator": true | false }
```

- `needs_human` **obligatoriu** când: decupajul e ilizibil; niciuna din citiri nu corespunde imaginii și textul nu se poate citi sigur;
  Claude nu e sigur; ieșirea nu respectă schema.
- `text_propus` (niciuna din citiri, Claude citește direct) e permis, dar pe cantități intră în audit 100% (§4).
- Model: `claude-sonnet-5`, temperatură 0, fără gândire extinsă; prompt fix, versionat în repo; fiecare apel în `ai_usage_log`.
- **Fiecare decizie se păstrează ca triplet** (citire LightOn / citire MinerU / ales + motiv + versiune prompt + model) în
  tabelul append-only din §5 — set de date pentru un viitor fine-tune.

## 4. Cantități (bani)

- Arbitrajul automat e permis și pe cantități, dar **fiecare decizie e marcată „arbitrat de Claude”** și rămâne verificabilă pe imagine.
- **Fără promovare automată** în tabelele de lucru (`ofertare_cantitati`, `text_extras`): promovarea e un RPC cu rol (§6).
- **Anomalii de separator** (ex. 0.056 vs 0,056; punct de mii vs zecimal) — semnalate `anomalie_separator = true` și NICIODATĂ
  normalizate automat (#1726 pct. 3); intră în audit 100%.
- **Eșantion de audit uman**: 100% din `text_propus` pe cantități, 100% din anomaliile de separator, plus **10% aleator** (minim 20
  decizii) din restul arbitrajelor pe cantități. Mecanism: la sfârșitul rulării, raportul extrage eșantionul cu o sămânță fixă
  (reproductibil); omul marchează pe imagine `corect` / `greșit` (`verificat_de`, `verificat_la`). **O singură decizie greșită în
  eșantion** → toate arbitrajele pe cantități ale rulării trec la `needs_human` (nicio promovare) + analiză.

## 5. Schema (PLAN — migrare doar cu „da” D3)

- `ofertare_ocr_pagini` (append-only): `id`, `document_id` (FK), `pagina`, `cititor` (`lighton` / `mineru` / `reconciliat`), `text`,
  `model_rev`, `protocol`, `garda` (jsonb), `stare` (`citit` / `de_arbitrat` / `needs_human` / `respins` / `promovat`), `rulare_id`,
  `creat_la`, `promovat_de/la`. Unic pe (`document_id`, `pagina`, `cititor`, `protocol`, `rulare_id`).
- `ofertare_ocr_arbitraje` (append-only): `id`, `pagina_id`, `bbox`, `citire_lighton`, `citire_mineru`, `decizie`, `text`, `motiv`,
  `e_cantitate`, `anomalie_separator`, `arbitru_model`, `prompt_versiune`, `cost_usd`, `in_esantion`, `verificat_de/la`, `verdict_om`.
- `ofertare_ocr_rulari`: `id`, `licitatie_id`, `pornit_de`, `pornit_la`, `plafon_usd`, `cost_usd`, `stare`, `oprit_motiv`.
- RLS: citire pentru accesul Ofertare; scriere DOAR prin edge-ul cu secret (RPC SECURITY DEFINER, EXECUTE doar service_role); fără
  UPDATE / DELETE din API (append-only; `verificat_*` printr-un RPC cu rol).
- Legătura cu stocarea pe blocuri (paragraf / rând de tabel, identitate stabilă, versiuni append-only, derivate legate de versiunea
  exactă — #677/#679): `ofertare_ocr_pagini` rămâne pe pagină ca să poată fi spartă în blocuri fără pierdere; proiectarea = D4.

## 6. Fluxul de integrare și rularea

```
utilizator autorizat (owner / responsabil 102) ─► buton „Pornește OCR local” în ERP ─► edge ofertare-ocr-cerere (poarta pe cheltuială,
     rol verificat în cod, plafon cost) ─► rând ofertare_ocr_rulari (stare = ceruta)
server AI (lansatorul unic, pornit de om) ─► citește cererile „ceruta” prin edge cu secret ─► POST ofertare-pdf-link {document_id}
     ─► URL semnat 5 min (doar document eligibil; jurnal append-only, limită) ─► pipeline local: preprocesare → LightOn + MinerU →
     comparare → arbitraj Sonnet 5 pe dezacorduri ─► POST ofertare-ocr-scrie (secret) ─► tabelele din §5, nimic altceva
promovare (separat): RPC cu rol, după auditul §4, cu RETURNING pentru revenire
```

- **Pornire DOAR la comanda unui utilizator autorizat** (poarta pe cheltuială, ca la citirea cloud) — fără cron, fără auto-start.
- Serverul AI NU primește cheia service_role: vorbește doar cu edge-urile, cu secret din Vault (modelul `contracte-pdf-link`).
- Cheia Anthropic pentru arbitraj stă în edge (`ofertare-ocr-arbitreaza`, apelat de server cu secret) sau pe server — **de decis în D3**;
  recomandare: edge, ca plafonul și jurnalul de cost să fie în BD.

**Rularea locală** (după D3 + „da” de pornire):
1. Precondiții: greutăți **LightOnOCR-2-1B** (există în `C:\Users\Public\paw-data\models`) și **MinerU2.5-Pro** (NU e încă descărcat);
   pipeline-ul Codex adaptat la două cititoare (azi are un singur endpoint și promptul dots înghețat) — adaptarea = PR separat, testat
   pe CPU (cele 22 de teste existente + teste noi pentru comparare și triplet); serverele vLLM pe loopback (ex. 8017 / 8018).
2. **Fereastra GPU**: un singur GPU, partajat cu Codex / Paw; `C:\Users\Public\paw-data\gpu.lock` — rularea îl ia la început, îl
   eliberează la sfârșit; clientul refuză orice cerere cât lock-ul e al altcuiva. Modelele se încarcă pe rând (LightOn, apoi MinerU),
   nu simultan.
3. **Timpi estimați** (1.447 pagini): LightOn ~1,6 h, MinerU ~1,4 h (benchmark #1734), arbitraj Sonnet 5 pe < 40 de pagini cu dezacord.
   Rulare idempotentă pe (`document`, `pagina`, `cititor`, `rulare`): la oprirea serverului se reia de la ultima pagină scrisă.
4. Heartbeat în `procese_heartbeat` (cheie `ocr_local_ofertare`) cât rulează.

## 7. Fișa de securitate (CLAUDE.md pct. 7) + rând în `automatizari`

- **(a) Conținut extern:** documentele de licitație (PDF-uri SEAP de la autorități / proiectanți) — citite de modelele locale și,
  pe decupaje, de Claude. Textul e DATE; arbitrul primește citirile ca date de comparat, nu ca instrucțiuni.
- **(b) Ce scrie:** DOAR rânduri append-only în `ofertare_ocr_pagini` / `ofertare_ocr_arbitraje` / `ofertare_ocr_rulari`. Nu scrie în
  `ofertare_cantitati` / `text_extras`, nu trimite mail, nu atinge drepturi. **Cost**: apeluri Anthropic plătite pe arbitraj, sub plafon.
- **(c) Identitate:** serverul AI fără service_role; edge-urile folosesc service_role DOAR pentru URL-ul semnat și RPC-urile de scriere
  cu EXECUTE restrâns (justificare: apelantul n-are cont Supabase, poarta e secretul — ca la `contracte-pdf-link`).
- **(d) Cine pornește:** cererea — doar owner / responsabilul licitației (rol verificat în cod; cheia anon nu trece); procesul local —
  doar prin lansatorul unic, de om; edge-urile serverului — doar cu secretul din Vault.
- **(e) Confirmare umană:** pornirea (poarta pe cheltuială); `needs_human`; auditul eșantionului pe cantități; promovarea (RPC cu rol).
  (a) și (b) se ating → poarta de rol + pașii de confirmare de mai sus sunt obligatorii (regula tare pct. 7).
- La livrare: rând în `public.automatizari` (fișa a–e, `secrete_nume` doar numele) + secțiunea din `registru_automatizari`.

## 8. Criterii de oprire (pilot) și cost

- **Oprire automată a rulării**: `needs_human` > 15% din decupajele arbitrate; gardă declanșată pe > 20% din pagini; cost arbitraj peste
  plafon; orice eroare de schemă la scriere; GPU ocupat de altcineva peste fereastră.
- **Oprire a pilotului** (decizie Răzvan): o decizie greșită în eșantionul de audit pe cantități (§4); o scriere în afara tabelelor §5.
- **Cost**: citirea locală — zero cloud (~3 h GPU). Arbitrajul Sonnet 5: ~3k tokeni intrare (imagine decupaj + citiri) și ~0,3k ieșire
  per decizie ≈ 0,015 $; la ~400 de decupaje ≈ **6 $**. **Plafon propus: 15 $ pe rulare**, verificat înainte de fiecare apel (oprire
  la atingere). Comparație: citirea cloud a costat ~86 $ în 60 de zile.

## 9. „Da”-urile — liniile EXACTE (scrise de Răzvan direct în sesiunea executantă)

| Pas | Ce face | Linia de „da” |
|---|---|---|
| **D2** | Triere `comun` pentru #1247 și #772 pe licitația 102 (preview → apply prin `fn_ofertare_documente_lot_seteaza`) | `da D2: triere comun pentru documentele 1247 și 772 pe licitația 102, după preview` |
| **D3a** | Migrarea schemei din §5 (tabele append-only + RPC-uri), prin `scripts/livrare_migrare.sh`, după GO Copilot + Jakarinos | `da D3a: apply migrarea OCR local <nume> cu SHA <sha256>` |
| **D3b** | Deploy edge-uri: `ofertare-ocr-cerere`, `ofertare-pdf-link`, `ofertare-ocr-scrie`, `ofertare-ocr-arbitreaza` + secretul în Vault | `da D3b: deploy edge ofertare-ocr-cerere, ofertare-pdf-link, ofertare-ocr-scrie, ofertare-ocr-arbitreaza și secretul OCR_LOCAL_SECRET` |
| **D3c** | Descărcarea MinerU2.5-Pro în `paw-data\models` + PR-ul de adaptare a pipeline-ului la două cititoare | `da D3c: descarcă MinerU2.5-Pro și adaptează pipeline-ul la LightOn + MinerU` |
| **D4** | Nota de proiectare pentru stocarea pe blocuri (doar document) | `da D4: scrie nota de proiectare pentru blocuri` |
| **Pornire** | Prima rulare pe 102, plafon 15 $, în fereastra GPU | `da pornire OCR local pe 102, plafon 15 USD, fereastră GPU <interval>` |
| **Promovare** | Mutarea textului reconciliat (după audit) în `text_extras` / cantități, pe documentele auditate | `da promovare OCR local pe 102 pentru rularea <id>, după audit` |
