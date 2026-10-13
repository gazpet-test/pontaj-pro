# Pilot OCR local pentru paginile necitite din Ofertare — plan de proiectare

Status: PLAN (13.10.2026, sesiunea Ofertare). Nimic pornit, aplicat sau deployat. Pașii concreți așteaptă decizia lui Răzvan
asupra **modelului / modelelor de citire** (14.10, după benchmarkul `paw-data\out\ocr_bench_20261014\`). Orice migrare, deploy
sau pornire de proces = „da” scris de Răzvan direct în sesiunea Ofertare.
Surse: `claude_context` #1726 (deskew obligatoriu), #1728 (audit 130/130, riscul e structura), #1731 (orientare, gardă v3,
prompt ignorat, cusătura benzilor); canalul `paw-data\dialog`; modelul de link semnat `supabase/functions/contracte-pdf-link`.

## 0. Ce avem de citit (live, 13.10.2026)

| Licitație | Documente | Pagini total | Pagini necitite | Unde |
|---|---:|---:|---:|---|
| 102 Botoșani | 507 | 3.435 | **1.447** | doar 2 documente: #1247 „3_PT FV rev.8” (1.251 din 1.636) și #772 „1a_PT-Mem+CS rev.4” (196 din 447) |

Ambele documente sunt `lot_stare = necunoscut` (de triat). Pilotul le procesează DOAR după ce sunt triate (propunerea: `comun`),
ca tot ce intră apoi în prompturi să treacă de aceeași poartă (`fn_ofertare_document_eligibil`). OCR-ul local n-are cost cloud,
dar textul lui alimentează procesări plătite — poarta rămâne una singură.

## 1. Modelul (modelele) de citire — parametru, nu alegere fixă

Planul nu e legat de un model. Parametrii pilotului:

| Parametru | Variante (decide Răzvan pe 14.10) |
|---|---|
| `citire.model` | `dots.mocr` (vLLM) · `LightOnOCR-2` (Ollama, ~3× mai rapid în benchmark, 156/157 pe tabele) |
| `citire.mod` | **unic** (un model) · **dublă citire** (ambele modele; diferențele → pagina „de verificat”) |
| `citire.protocol` | versiunea preprocesării: orientare + deskew (#1726) + benzi tăiate ÎNTRE rânduri (rezultatul experimentului S-20261013-pas5-text) |
| `garda.versiune` | v3 (celule goale consecutive, #1731) — semnal, nu decizie de calitate |

Ce știm (independent de model): orientarea și deskew-ul se fac ÎNAINTE; prompturile libere sunt ignorate (doar layout nativ);
fișele de foraj / grilele aproape goale și planșele nu se citesc corect → nu intră în pilot; riscul la tabele e STRUCTURA
(UM + cantitate în aceeași celulă, coloană mutată), nu caracterele (#1728).

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

- Garda declanșată (bucle de celule goale, ieșire tăiată, benzi incomplete), pagina de tip nesuportat, sau (în dublă citire)
  modelele nu coincid pe structură → pagina rămâne „de verificat” și poate merge la citirea cloud existentă
  (`ofertare-ingest-doc` / `citeste-orice`), **cu poarta pe cheltuială** (owner / responsabil pornesc).
- **Promovarea** textului local în `text_extras` + scoaterea paginii din `pagini_necitite` nu e automată în pilot: un RPC cu
  rol (owner / responsabil), după validarea §6, cu `RETURNING` pentru revenire.

## 5. Schema minimă (PLAN — migrare doar cu „da”)

`ofertare_ocr_pagini` (append-only): `id`, `document_id` (FK), `pagina`, `text`, `sursa` = `ocr_local`, `model`, `protocol`,
`garda` (jsonb: versiune + semnale), `stare` (`citit` / `de_verificat` / `respins` / `promovat`), `creat_la`, `promovat_de/la`.
RLS: citire pentru accesul Ofertare, scriere DOAR prin edge-ul cu secret (RPC SECURITY DEFINER cu EXECUTE doar service_role).
Unicitate pe (`document_id`, `pagina`, `model`, `protocol`) — o re-citire cu alt protocol e rând nou, nu suprascriere.

**Legătura cu stocarea pe blocuri (notă de proiectare, de discutat după teste):** Răzvan vrea documentele ca blocuri
(paragraf / rând de tabel) cu identitate stabilă și versiuni append-only, ca o clarificare să schimbe doar blocurile atinse,
iar datele derivate (cerințe, cantități — proveniența din #677/#679) să trimită la versiunea exactă a blocului.
`ofertare_ocr_pagini` e intenționat pe pagină și append-only, ca să poată fi spartă ulterior în blocuri fără pierdere.
Proiectarea blocurilor = notă separată, mâine; nicio schemă fără „da” direct.

## 6. Validare (pilot)

- **20 de pagini mostră** din #1247 / #772: 10 text scanat + 10 tabele, alese de om (nu de model), citite de modelul / modelele
  locale ȘI de cloud.
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
  fără promovare automată în pilot.
- La pornire: rând în `public.automatizari` (fișa a–e, `secrete_nume` = numele secretului, fără valoare) + secțiunea din
  `registru_automatizari`.

## 9. Criterii de oprire și cost

- **Oprire pilot**: o pagină cu text promovat greșit (structură greșită care ajunge în cantități); garda declanșată pe > 20% din
  mostră; GPU-ul blochează Codex / Paw peste pragul stabilit; orice scriere în afara tabelului din §5.
- **Cost**: zero cloud pentru paginile citite local. Timp GPU estimat: ~12 s/pagină cu dots.mocr pe text (campania 13.10), ~3× mai
  puțin cu LightOnOCR-2 (benchmark); pentru 1.447 de pagini → ~4,8 h (dots) / ~1,6 h (LightOn), dublat în dubla citire.
  Comparație: citirea cloud a costat ~86 $ în 60 de zile (ingest-doc 60 $, planșe 22 $, citește-orice 4 $).

## Decizii pentru Răzvan

- **D1** Modelul / modelele de citire (după benchmarkul din 14.10): dots.mocr, LightOnOCR-2, sau dublă citire.
- **D2** Triajul pe loturi al lui #1247 și #772 (propunere: `comun`), înainte de pilot — prin preview → „da” → apply.
- **D3** Schema din §5 (migrare cu „da”) și cele două edge-uri (deploy cu „da”).
- **D4** Nota de proiectare pentru stocarea pe blocuri (după teste).
