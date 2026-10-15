# TKT-2026-0329, varianta B: cantități structurate + audit al răspunsurilor Autorității

**Stare:** SPECIFICAȚIE v1 (15.10.2026). Nimic implementat. Migrările, deploy-urile și orice cost AI se fac doar cu „da” de la Răzvan.
**Decizie de pornire:** Răzvan, 14.10.2026, varianta B (`claude_context` #1758).
**Studii:** Jakarinos r1, `C:\Users\Public\paw-data\out\tkt0329_r1_jak.log`, plus harta codului din această sesiune (secțiunea 2).

## 1. Problema, pe cazul real

**Tichetul** (Oana, 06.10): între F3 și ATR, lungimea țevii diferă mult (6.400 m față de 3.995 m). Platforma n-a semnalat nimic și n-a propus clarificare. Un alt ofertant a întrebat, iar Autoritatea a răspuns. Platforma ar trebui să vadă răspunsul din SEAP și să arate ce nu a sesizat la analiza inițială.

**Cazul este licitația 15 (Răcari, extindere gaze).** Documentul 1624, „Răspuns consolidat nr. 2”, conține totul:
- **Solicitarea nr. 7 (alt ofertant):** Fișa de date (II.2.4), Caietul de sarcini (secț. 5) și Anexa 1 la ATR (Distrigaz Sud Rețele) dau convergent **3.995,00 m PEHD SDR11 Dn 90**, defalcat identic pe **16 obiective/străzi**. F3 însumează **6.400 m** (+2.405 m). Doar 3 din 16 străzi au lungimi identice; la celelalte diferențele sunt între −14% și +159%.
- **Răspunsul nr. 16:** „Întocmirea ofertei se va face conform lungimilor din ATR, un total de 3.995,00 m + lungimile aferente branșamentelor conform proiectului.”
- Tot acolo apare o a doua neconcordanță: **+87 m branșamente PE Dn 32**.

**Ce aveam noi pe licitația 15:**
- **0 rânduri** în `ofertare_cantitati`. Extragerea nu a rulat, deci controlul H2 nu avea ce compara.
- 7 clarificări proprii, niciuna despre lungimi.

**Cauzele, în ordine:**
1. **Extragerea de cantități nu e un pas sigur al fluxului.** Pe licitațiile recente doar 5 și 103 au cantități; 15, 101, 102 și 92 au 0 sau aproape 0.
2. **ATR nu are identitate cantitativă.** E tipat `alta`, cu `tip_sursa = null`, iar CHECK-ul pe `tip_sursa` nu are valoarea ATR. Nu intră în H2.
3. **Rândurile de cantitate nu au structură.** Nu au pagină, DN, material, stradă/tronson sau versiune de document. DN-ul stă doar în `denumire`, iar lotul vine din numele fișierului.
4. **H2 compară sume globale în metri pe licitație**, nu per obiect. `v_ofertare_contradictii` nu are niciun consumator.
5. **Clarificările primesc doar rândurile cu `diferenta_nota`, maximum 40.** O contradicție între două rânduri extrase separat nu ajunge niciodată la generator.
6. **Răspunsurile Autorității:** `ofertare-raspuns-set` compară cu registrul doar `efect_posibil`. `confirmare` și `efect_cantitati` sunt doar numărate. Nu există o versiune înghețată a analizei noastre față de care să se facă auditul, iar `document-nou-citeste` suprascrie `citire_noi`.

## 2. Ce există și se refolosește

| Bucată | Unde | Cum o folosim |
|---|---|---|
| Tipare documente | `_shared/tipDocument.mjs` (+ `api/_tipDocument.js`) | neschimbat; rolul cantitativ (F3/ATR/CS/…) se stabilește separat, pe observație (§4.1) |
| Extragere AI cantități | `ofertare-cantitati-extrage` (felii 55k, gpt-5-mini, poarta owner/responsabil, `ai_usage_log`) | se adaugă un mod structurat (v2) peste aceeași feliere și poartă; registrul `ofertare_cantitati` rămâne |
| Poarta pe cheltuială | `poarta.ts` (owner sau `responsabil_id`) | aceeași, server-side |
| Plafon cu rezervare durabilă | OCR local: `ofertare_ocr_rulari.plafon_usd` + `ofertare_ocr_rezervari` (20261029b/c) | același model: rezervare înainte de apel, decontare după, plafon per licitație |
| Inventarul răspunsurilor | `ofertare-raspuns-set` `inventar` → `propunere.dispozitii[]` (tip `efect_posibil / confirmare / efect_cantitati / neclar / anexa`, citat, `disp_id`) | sursa auditului, cu **toate** tipurile, nu doar `efect_posibil` |
| Citirea documentelor noi | `ofertare-document-nou-citeste` (`intrebari_raspunse[]`) | input secundar; nu se modifică |
| Versiuni de document SEAP | rând nou + `seap_meta.inlocuieste[_id]`, sha256 în `ofertare_seap_fisiere` | identitatea versiunii = `document_id` + sha256 al `text_extras` folosit |

## 3. Ce construim (vedere de ansamblu)

```
documente (versiune = document_id + sha text)
   │  E. extragere structurată (AI, plătit, cache pe sha, plafon/licitație, poartă)
   ▼
ofertare_cant_obs              observații: rol, pagină, lot, obiect, material, DN, UM, cantitate, citat
   │  C. comparație DETERMINISTĂ (fără AI): pe cheie de obiect, înaintea clarificărilor
   ▼
ofertare_cant_cmp              F3 vs ATR / CS / Fișa / memoriu / planșe / C6, per obiect + total
   │──► clarificari-propune (contradicțiile structurate, prioritizate)  ──► H2 (cu ATR)
   │  Î. înghețare: versiunea inițială a analizei noastre
   ▼
ofertare_analiza_versiuni      snapshot imuabil: documente+sha, observații, comparații, clarificările noastre
   │  A. audit al răspunsurilor (reguli întâi, AI doar pe rest)
   ▼
ofertare_audit_raspunsuri      omisiune / modificare ulterioară / deja observat / nedeterminabil + dovezi
```

## 4. Model de date (o singură migrare, PR2)

Regulile pentru orice obiect nou se aplică toate: RLS activ, policies `auth.uid() IS NOT NULL` + `fn_are_acces_ofertare`, view-uri `security_invoker`, funcții `SECURITY DEFINER SET search_path = public, pg_temp`, REVOKE PUBLIC pe ce nu e UI. Scrierile vin doar din edge-uri cu `service_role` și poartă de rol în cod.

### 4.1 `ofertare_cant_obs` — observații (append-only)
- `id`, `licitatie_id`, `document_id` (FK), `doc_sha256` (sha256 al `text_extras` folosit), `extragere_id` (FK 4.2).
- `rol_sursa`: CHECK `f3 | c6 | lista_alt | atr | cs | fisa_date | memoriu | plansa | raspuns | alt`.
  - Se stabilește în ordinea: antetul secțiunii (F3/C6 din `sectiuni.ts`) → regula pe nume (`\batr\b|aviz tehnic de racordare` → `atr`, `fisa` → `fisa_date`, `caiet` → `cs`, `memoriu` → `memoriu`) → modelul, doar dacă primele nu decid.
- `pagina` (int, din markerul `⟦PAGINA n⟧`; null dacă lipsește), `lot_nr int[]`.
- `obiect_brut` (text, exact cum apare), `obiect_cheie` (normalizat, §5.1), `material` (`PE100 | PEHD | OL | …`, normalizat), `dn_mm` (numeric), `sdr` (numeric), `um_norm` (`m | buc | mc | …`), `cantitate` (numeric, null ≠ 0), `e_total` (bool).
- `citat` (≤ 300 caractere, textul-sursă exact al rândului), `extractor` (`ai:<model>@<prompt_ver>` | `regula@<ver>`).
- Unic `(extragere_id, hash_rand)`. Nu se face UPDATE/DELETE din aplicație; o versiune nouă a documentului = observații noi.

### 4.2 `ofertare_cant_extrageri` — jurnal + cache
- `id`, `licitatie_id`, `document_id`, `doc_sha256`, `prompt_versiune`, `model`.
- `stare` (`rezervat | gata | esuat | abandonat`), `felii`, `randuri`, `cost_rezervat`, `cost_usd`, `pornit_de`, `created_at`.
- **Cache:** unic `(document_id, doc_sha256, prompt_versiune)` pe `stare = gata`. O re-extragere a aceleiași versiuni nu plătește din nou.

### 4.3 Plafon per licitație
Se generalizează modelul OCR, fără să-l atingem pe acela:
- `ofertare_ai_buget(licitatie_id, scop, plafon_usd, cost_usd, cost_rezervat, cost_abandonat)`, cu `scop ∈ ('cant_extragere','audit_raspunsuri')` și `CHECK (cost_usd + cost_rezervat + cost_abandonat ≤ plafon_usd)`.
- Rezervarea e atomică într-o funcție SQL (`FOR UPDATE`), înainte de fiecare apel plătit.
- Un rezultat necunoscut păstrează rezervarea, ca la OCR.
- Plafonul implicit e decizia D3.

### 4.4 `ofertare_cant_cmp` — comparații deterministe
- `id`, `licitatie_id`, `calcul_id` (o rulare a comparatorului; amprentă = sha peste observațiile intrate), `cheie` (`lot|obiect_cheie|material|dn|um`; `*` pentru totaluri).
- `valori jsonb`: `{ rol: { valoare, obs_ids[], documente[] } }`.
- `referinta` (rolul de referință, implicit `f3`), `delta_abs`, `delta_rel`, `prag_abs`, `prag_rel`.
- `verdict`: CHECK `concordant | diferenta | doar_f3 | lipsa_f3 | neasociat`.
- `importanta` (numeric, pentru ordonare: `|delta_abs|` × greutatea UM).
- Neasociatele nu se ignoră niciodată: apar în listă cu verdictul lor.

### 4.5 `ofertare_analiza_versiuni` — analiza inițială păstrată (imuabilă)
- `id`, `licitatie_id`, `tip` (`initiala | recalcul`), `inghetata_la`, `inghetata_de`, `motiv`.
- `documente jsonb` (`[{document_id, doc_sha256, tip, aparut_ulterior}]`), `calcul_id` (comparația înghețată).
- `clarificari jsonb`: id, cheie, intrebare, status și data trimiterii ale **clarificărilor noastre** la momentul înghețării.
- `obs_amprenta`, `cmp_amprenta`, `amprenta` (sha256 canonic peste tot).
- Un trigger refuză UPDATE/DELETE după `inghetata_la`. O singură `initiala` per licitație și lot (index unic parțial).
- Momentul înghețării e decizia D1.

### 4.6 `ofertare_audit_raspunsuri`
- `id`, `licitatie_id`, `versiune_analiza_id` (FK 4.5), `set_id` (FK `ofertare_raspuns_set`, nullable), `document_id` (răspunsul).
- `disp_id` (din inventarul raspuns-set), `nr_solicitare`, `citat_intrebare`, `citat_raspuns`.
- `efect`: `confirmare | modificare | cantitati | neclar`.
- `clasificare`: CHECK `omisiune | modificare_ulterioara | deja_observat | nedeterminabil`.
- `motiv` (text scurt), `dovezi jsonb` (`cmp_ids`, `obs_ids`, `clarificare_ids`, `document_ids` + sha), `sursa_clasificare` (`regula@ver | ai:<model>@<prompt>`), `cost_usd`.
- `decizie_om` (`confirmat | respins | null`), `decis_de`, `decis_la`, `nota`.
- Unic `(versiune_analiza_id, document_id, disp_id)`: un răspuns se auditează o singură dată față de aceeași versiune.

## 5. Logica

### 5.1 Extragerea structurată (PR3, edge `ofertare-cantitati-extrage` mod `structurat`, sau edge nou)
- **Documentele vizate:** `lista_cantitati` (F3/C6/…), `cs_volum`, `fisa_date`, `alta` cu rol ATR, `raspuns_clarificare`. Planșele rămân la `ofertare-plansa-citeste`, iar ieșirea lor se mapează în observații cu `rol = plansa`.
- **Ce cere promptul**, rând cu rând: `[pagina, obiect_brut, material, dn, sdr, denumire, um, cantitate, e_total, citat]`. Fără calcule, null ≠ 0, ca azi.
- **Normalizare deterministă după model** (în cod, testată):
  - DN din text, cu regex `D[Nn]?\s*=?\s*(\d+)`; dacă diferă de câmpul modelului, câștigă regex-ul și se marchează;
  - UM, cu `ml → m`;
  - `obiect_cheie`: minuscule, fără diacritice, fără prefixe `str.|strada|aleea|drumul|DC|DJ` normalizate, cu numărul de stradă păstrat;
  - material.
- **Cost:**
  1. poarta (owner/responsabil);
  2. cache pe `(document_id, doc_sha256, prompt_versiune)`;
  3. rezervare în `ofertare_ai_buget` înaintea fiecărei felii;
  4. decontare după felie; rezultat necunoscut → rezervarea rămâne.
  Doar documentele noi sau modificate plătesc.
- Registrul `ofertare_cantitati` **nu se schimbă** în MVP. Observațiile sunt un strat nou, alături; legătura spre registru se face mai târziu (§8, în afara MVP).

### 5.2 Comparația deterministă (PR4, SQL + JS pur, fără AI)
- Se grupează observațiile pe cheia `lot|obiect_cheie|material|dn|um_norm`, câte o valoare per rol. Se ia ultima versiune a fiecărui document; versiunile înlocuite rămân pentru audit.
- Pentru fiecare cheie se compară F3 cu fiecare alt rol prezent; se face și comparația pe totaluri (`*`).
- **Praguri:**
  - **Pentru H2 (poarta grafic / PT):** pragul H2 actual, 0,1% relativ.
  - **Pentru semnalarea în clarificări:** `|Δ| > max(1 m, 1%)` la UM = m. Valorile se vor fixa pe Răcari (decizia D4).
- **Chei asemănătoare:** o cheie fără pereche exactă se potrivește doar cu aceeași stradă și același DN (distanță de editare ≤ 2 pe `obiect_cheie`). Altfel verdictul e `neasociat`, afișat.
- **Ieșirea:**
  - rânduri `ofertare_cant_cmp`;
  - în **H2**: un `atr_m` nou în `v_ofertare_pt_stare`, ca F3 vs ATR să fie tratat ca memoriul (warn);
  - **clarificari-propune** primește contradicțiile structurate (verdict `diferenta`, ordonate după `importanta`, maximum 40, cu numărul celor omise), pe lângă rândurile cu `diferenta_nota`.

### 5.3 Înghețarea (PR2 funcția SQL, PR4 butonul)
- `fn_ofertare_analiza_ingheata(lic, lot, motiv)` scrie snapshot-ul 4.5 din starea curentă: documente + sha, ultimul `calcul_id`, clarificările noastre.
- Nu cheamă AI. E idempotentă pe amprentă.

### 5.4 Auditul răspunsurilor (PR5)
- **Declanșator:** un document nou `raspuns_clarificare` (veghe SEAP / worker) **și** inventarul raspuns-set făcut. Auditul ia **toate** dispozițiile: `efect_posibil`, `confirmare`, `efect_cantitati`, `neclar`.
- **Pas 1, reguli fără AI, în ordine:**
  1. **`deja_observat`:** dispoziția atinge o cheie cu verdict `diferenta` în comparația înghețată **sau** răspunde unei clarificări noastre din snapshot. Potrivirea se face pe cifre (valori, Δ) + `obiect_cheie`/DN în citat, ori pe `raspuns_document_id` / similaritatea întrebării (Jaccard ≥ 0,6 cu `cheie`).
  2. **`modificare_ulterioara`:** răspunsul vine cu o versiune nouă de document (erată, F3 revizuit, `seap_meta.inlocuieste_id`) **și** subiectul nu se găsea în documentele din snapshot. Exemplu: o cerință nouă introdusă de răspuns.
  3. **`omisiune`:** subiectul se găsea în documentele din snapshot (citatul răspunsului trimite la cifre sau obiecte din observațiile snapshot-ului, sau la documente din snapshot), iar noi nu l-am semnalat (nici comparație `diferenta`, nici clarificare). **O confirmare fără schimbare de documentație cade aici** (cerința tichetului). Exemplu: Răcari, solicitarea 7 / răspunsul 16.
  4. Altfel: **nedeterminat**, care trece la pasul 2.
- **Pas 2, AI doar pe rest** (plătit, poartă, cache pe `(disp_id, amprenta snapshot, prompt_ver)`, plafon `audit_raspunsuri`):
  - modelul primește citatul și doar contextul relevant din snapshot (observațiile și comparațiile cu aceleași chei/cifre, clarificările noastre), nu documentația întreagă;
  - întoarce doar o clasificare din cele 4, cu motiv și dovezi;
  - orice ieșire în afara schemei → `nedeterminabil`.
- **Omul decide:** fiecare rând are `confirmat / respins`. Nimic nu modifică registrul sau clarificările automat.

### 5.5 Interfața (PR4 + PR6)
- **Licitație → Cantități**, tab nou „Comparație”: tabel pe cheie (obiect, DN, UM; coloane F3 / ATR / CS / Fișa / memoriu / planșe; Δ; verdict), filtru „doar diferențe”, legătură spre citat și pagină. Plus butonul „Îngheață analiza inițială” (decizia D1).
- **Licitație → Clarificări**, secțiune „Audit răspunsuri Autoritate”: grupat pe clasificare, cu citatul întrebării/răspunsului, dovezile și butoanele confirmat/respins. Omisiunile confirmate apar și ca lecție pentru licitație.

## 6. Acceptanță (pe date reale, înainte de LIVE)

1. **Răcari (licitația 15).** Documentele, verificate în BD pe 15.10: Fișa de date 201, CS 198 + CS revizuit 318, ATR în „Pth … part.1 — p01” (doc 214, tip `alta`, conține 3.995), F3 în listele de cantități 212 + 213 (ambele conțin 6.400). Extragerea pe ele dă 16 chei de stradă Dn 90, cu valori ATR/CS. Comparația are:
   - **13 chei `diferenta`** și **3 `concordant`**;
   - totalul F3 6.400 vs ATR 3.995;
   - separat, Dn 32 branșamente Δ 87 m.

   Clarificari-propune primește aceste contradicții pe primele locuri.
2. **Auditul Răcari.** Snapshot-ul se îngheață din documentele de dinaintea doc 1624: originalele, plus răspunsul nr. 1 (316) și CS revizuit (318), fără clarificările de lungime. Auditul doc 1624 clasifică solicitarea 7 / răspunsul 16 drept **`omisiune`**, iar dovezile citează ATR/CS și F3.
3. **Licitațiile 103 și 5** (au cantități): comparația nu produce `diferenta` acolo unde registrul validat e concordant (fals-pozitive < 5% din chei, verificat de om pe eșantion).
4. **Cost:** a doua extragere pe aceeași versiune = 0 USD (cache); plafonul oprește înaintea apelului.
5. **Teste:** unit pentru normalizare, chei, praguri, reguli de audit (Deno/vitest); harness SQL pentru tabele, RLS, imuabilitate și plafon (stil `test_ofertare_ocr_local.sh`).

## 7. Plan pe PR-uri (fiecare: review Jakarinos + Copilot conv. 3, PR draft, merge prin chat cu „da”)

| PR | Conținut | BD | Cost AI |
|---|---|---|---|
| PR1 | această specificație (doc) | — | — |
| PR2 | migrarea: 4.1–4.6 + funcțiile rezervă/decontează/îngheață + RLS + harness SQL + revenire | **da** (preview → „da” → apply) | — |
| PR3 | extragere structurată (edge), normalizare, cache, plafon, poartă + teste | — | doar la rulare, cu poarta |
| PR4 | comparator determinist + `atr_m` în H2 + tab Comparație + butonul de înghețare | view `v_ofertare_pt_stare` (migrare mică) | 0 |
| PR5 | clarificari-propune primește contradicțiile structurate | — | — |
| PR6 | audit răspunsuri (reguli + AI pe rest) + UI | — | doar la rulare, cu poarta |
| Probă | Răcari cap-coadă (§6), apoi o licitație activă | date reale doar cu „da” | estimat sub 2 USD pe Răcari |

## 8. În afara MVP (de decis după)
- Legarea observațiilor de registrul `ofertare_cantitati` (propunere de corecție a registrului din comparație, cu aprobare).
- Textul OCR local ca sursă pentru documentele scanate (laboratorul OCR), când va fi gata.
- Audit retroactiv pe licitațiile închise (lecții).

## 9. Decizii pentru Răzvan (A/B/C)

- **D1 — când se îngheață analiza inițială**
  - **A (recomandat):** automat la prima clarificare a noastră trimisă (`status → trimisa`) sau, dacă nu trimitem nimic, la termenul-limită de clarificări. Plus buton manual pentru responsabil.
  - **B:** doar manual.
  - **C:** automat la fiecare rulare a comparației, cu istoricul tuturor versiunilor.
- **D2 — modelul pentru extragerea structurată**
  - **A (recomandat):** gpt-5-mini, ca azi (ieftin), cu normalizarea deterministă după.
  - **B:** Claude Sonnet 5.5 (structură mai sigură, de ~5–10 ori mai scump).
  - **C:** A, cu B doar pe feliile unde A întoarce rânduri fără DN/obiect.
- **D3 — plafoane implicite pe licitație**
  - **A (recomandat):** extragere 5 USD + audit 3 USD, ridicabile de owner.
  - **B:** un singur plafon de 10 USD.
  - **C:** alte valori.
- **D4 — întinderea MVP**
  - **A (recomandat):** doar lungimi (UM = m: conducte, branșamente, tuburi de protecție), cu DN și material.
  - **B:** toate cantitățile din F3.
- **D5 — proba**
  - **A (recomandat):** Răcari (licitația 15, închisă) ca probă de acceptanță, apoi prima licitație activă cu termen de clarificări deschis.
  - **B:** direct pe o licitație activă.
