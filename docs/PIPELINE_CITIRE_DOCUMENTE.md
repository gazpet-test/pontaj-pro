# Pipeline-ul de citire a documentelor (Ofertare) — de la PDF la BD

Document unic, cap-coadă (decizia Razvan 16.10.2026). **Orice PR care schimbă pipeline-ul îl actualizează în același PR** (secțiunea
afectată + un rând în „Istoric revizii”); CI-ul `pipeline-citire-doc.yml` pică altfel. Căile urmărite:
- **scripturi:** `scripts/ocr_local/**`, `scripts/recitire_val1/**`, `worker/ofertare/**`;
- **funcții edge:** `supabase/functions/ofertare-ocr-*`, `ofertare-ingest-doc`, `ofertare-cantitati-extrage`, `ofertare-citire-test`, `ofertare-pdf-link`, `ofertare-document-nou-citeste`, `ofertare-plansa-citeste`, `ofertare-word-text`, `ofertare-seap-import`, `ofertare-seap-veghe`;
- **cod comun:** `_shared/{transcriereTabel, provenientaText, gardaIngest*, cantNumar, cantNormalizare, cantComparator, dn}.ts`;
- **migrări / reveniri:** `*ofertare_ocr*`, `*ofertare_cant*`, `*ofertare_text_scrie*`, `*ofertare_citire_umbra*`, `*ofertare_ingest_garda*`.

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

## Partea 1 — Surse, ingest AI, proveniență, recitire, cantități (sesiunea Ofertare)

### 1.0 De unde vin documentele

Toate documentele ajung în `ofertare_documente_atribuire`: rândul documentului, plus fișierul în Storage, bucket `ofertare`, la `fisier_path`.

| Sursă | Cine o pornește | Ce scrie | Cost |
|---|---|---|---|
| **SEAP**: importul inițial al documentației | `ofertare-seap-import`, pornit din UI sau de veghe | rânduri de document + fișierele în Storage (`seap_cod`, `seap_meta`; `inlocuieste_id` la versiuni noi) | 0 (fără AI) |
| **SEAP**: documente apărute ulterior (clarificări, erate) | `ofertare-seap-veghe` (joburile cron `ofertare_seap_veghe_0520` / `_1250`, ora UTC), care cheamă importul prin HTTP | la fel | 0 |
| **Arhive** (zip / rar) desfăcute pe NAS | worker-ul NAS (`worker/ofertare/`) | părți `… — pNN_pagA-B.pdf` cu `pagina_offset` | 0 |
| **Manual** (încărcare în fișa licitației) | utilizator Ofertare, din UI | rând + fișier | 0 |

Rândul nou e `status_procesare = 'neprocesat'`. Citirea, adică scrierea în `text_extras`, e pasul următor (§1.1).

**Ce poate merge prost și cum se revine:**

| Situație | Revenire |
|---|---|
| Fișier de sistem (`__MACOSX`, `.DS_Store`) | ingest-ul îl marchează `ignorat`, fără cost |
| Non-PDF (docx, xls, dwg) | rămâne fișier; `.docx` se citește cu `ofertare-word-text` |
| Același fișier importat de două ori (copii între licitații) | Nu se deduplică. Recitirea valului 1 a citit separat copiile din lic. 103 (§1.3). |

### 1.1 Citirea în text (`ofertare-ingest-doc` și căile vecine)

**`ofertare-ingest-doc`**: drumul principal pentru PDF-uri, inclusiv scanate.

| Element | Valoare |
|---|---|
| Model, pe tipul documentului | Volumele (caiete, liste, `alta`): **`claude-haiku-5-5`** (din 15.10, commit `6f8a22c`; înainte Haiku 4.5), felii de **8** pagini. Documentele critice (`fisa_date`, `clarificare`, `raspuns_clarificare`, `formular`): **`claude-sonnet-5`**, felii de **2**. Un parametru `model` poate forța alegerea. |
| Setări | `max_tokens` = `maxOut(model)` din `_shared/transcriereTabel.ts`: **12 000** pe Haiku 5.5, 8 000 în rest. `thinking` dezactivat, fără `temperature`. |
| Prompturi | `PROMPT_ANTET` pe prima felie: JSON cu obiectiv, beneficiar, proiectant, revizie, apoi `===TEXT===`. `PROMPT_TEXT` pe celelalte. Amândouă au **regula de tabel** (`REGULA_TABEL`: o linie pe rând, celulele separate prin ` \| `, inclusiv cele goale) și marcajele `⟦PAGINA N⟧`. |
| Numerotarea paginilor | Absolută: `pagina_offset` + pagina locală. `asiguraMarcaje` renumerotează secvențial când numărul marcajelor = numărul paginilor din felie. |
| Reluare | Cel mult 2 apeluri pe invocare. Progresul (`pagini_procesate`, `pagini_felie`) e salvat, iar invocarea următoare continuă de unde a rămas. |
| `max_tokens` atins | Felia se înjumătățește. O pagină singură care tot nu încape → pagină **necitită** (`pagini_necitite`). |
| Refuz (`stop_reason = refusal`) | Paginile feliei → necitite. |
| Felie peste 24 MB | Se înjumătățește. Pagina singură prea mare → necitită. |
| Text peste 900 000 de caractere | `taie_pagina.ts` taie la ultima pagină întreagă; paginile tăiate → necitite + avertisment. |
| Fișier peste 60 MB | Refuzat de edge. Îl citește worker-ul NAS (`citire_mare.ts`, pe felii). |
| Sărite | `procesat`; `partial` fără `reia: true`; `plansa` (are calea ei); documentele sparte în bucăți (se citesc bucățile); `ignorat`; documentele neeligibile pe loturi (poarta loturi 20261024b, înainte de orice descărcare sau AI) |
| Scrierea | **Garda de ingest** (20260930k): `ofertare_ingest_garda_incearca` (token, lease de 10 min, max 5 eșecuri, max 80 de descărcări), apoi `ofertare_ingest_garda_rezultat`. Acesta scrie rândul documentului (coloane din whitelist) în aceeași tranzacție cu verificarea tokenului, deci un token vechi e respins. Apoi proveniența (§1.2). |
| Cine o pornește | Un utilizator cu acces Ofertare care e **owner sau responsabilul licitației** (poarta pe cheltuială). Sau worker-ul NAS, cu `x-ingest-secret` = `OFERTARE_INGEST_SECRET`, pe coada `ofertare_ingest_coada` (butonul „☁ Pe server”). Cheia anon nu trece niciodată. |
| Cost | Haiku 5.5: 0,10 / 0,50 USD pe milion de tokeni (intrare / ieșire), sub pragul de 100k tokeni pe cerere; peste, 0,50 / 2,50. Sonnet 5: 2 / 10. Fiecare apel ajunge în `ai_usage_log`. Laboratorul a măsurat ~0,005 USD pe 8 pagini cu Haiku 5.5. |

**Worker-ul NAS** (`worker/ofertare/ingest.ts`): consumă aceeași coadă.
- PDF-urile cu strat de text (≥ 85 % pagini cu text) se scot **gratuit**, cu `pdftotext`, cu aceleași marcaje.
- Antetul se citește cu Haiku 4.5 (~0,001 USD; încă Haiku 4.5 în worker).
- Scanurile trec prin edge-ul de mai sus.
- PDF-urile peste 60 MB se citesc local, pe felii.
- Scrie tot prin gardă. Nu scrie proveniență.

**Căile vecine** (scriu și ele `text_extras` sau date din citire):

| Funcție | Ce face | Model / cost | Cine o pornește | Proveniența |
|---|---|---|---|---|
| `ofertare-document-nou-citeste` | Rezumatul unui document apărut ulterior în SEAP → `analiza.citire_noi`. `text_extras` doar dacă era gol (CAS pe `analiza` și pe sha). | `claude-sonnet-5`; PDF-ul întreg doar pentru owner / responsabil / secretul intern | utilizator Ofertare, sau rutina cu `x-radar-secret` | `sinteza_ai` (nu e transcriere, deci nu e valid pentru cantități) |
| `ofertare-plansa-citeste` | Planșele A0, felie cu felie (tăiate de `/api/plansa-felii`): tabelele de dimensionare, cartușul, adnotările → `ofertare_cantitati` + `textPlansa` | `claude-opus-5`, cel mult `FELII_PE_RULARE` pe rulare | owner / responsabil | `sinteza_ai` |
| `ofertare-word-text` | `.doc` / `.docx` → text, fără AI | 0 | ca ingest-ul | — (scrie prin gardă) |

**Ce poate merge prost și cum se revine:**

| Situație | Efect | Revenire |
|---|---|---|
| Model care pierde cantități (Haiku 4.5, laborator 15.10: 44–63 % pe listele scanate) | text incomplet | **Recitirea** (§1.3) |
| Pagini necitite (refuz, prea mari) | `status_procesare = 'partial'` și `pagini_necitite` | `reia: true` după mărirea plafonului, sau OCR local (partea 2) |
| Rezultat întârziat de la o încercare veche | respins de gardă (tokenul) | automat |
| Worker oprit la mijloc (memorie) | lease expirat → încercarea se preia; după 5 eșecuri `blocat` | reactivare doar de owner (`ofertare_ingest_garda_reactiveaza`) |

### 1.2 Proveniența textului și CAS (20261031a, 20261031b)

**De ce există.** `text_extras` nu spune singur cum a fost produs. Pentru cantitățile structurate (§1.4) contează dacă textul e o **transcriere** sau o **sinteză AI**.

| Element | Ce este |
|---|---|
| `ofertare_doc_texte` | Arhiva content-addressed `(licitatie_id, sha256) → text`. Imuabilă, cu `CHECK` pe sha. Aici stau textele vechi după înlocuire. |
| `ofertare_doc_texte_prov` | Append-only, pe `(document, sha)`: `origine` (`transcriere` / `sinteza_ai`), `producator`, `completitudine` (`integral` / `partial`), `pagini_necitite`, `constatat_la` |
| `fn_ofertare_cb_text_scrie` (31a, refăcută în **31b**) | Funcția prin care producătorii scriu proveniența (`_shared/provenientaText.ts`, best-effort: o eroare nu oprește producătorul) |
| `fn_ofertare_cb_text_valid(_asof)` | Predicatul unic. Textul e **valid** pentru un document și un sha dacă ultima proveniență e `transcriere`, SAU dacă există o decizie umană `text_confirmat` nerevocată. Altfel `{}`. |
| Înghețarea (`fn_ofertare_cb_ingheata`) | Alege, pentru fiecare document, ultima proveniență ≤ moment. Un text fără dovadă intră în snapshot ca `text_indisponibil`. |

**Cum lucrează `fn_ofertare_cb_text_scrie` după 31b:**
- **Ordinea lock-urilor:** licitația `FOR KEY SHARE`, apoi documentul `FOR NO KEY UPDATE`. E aceeași ordine ca la pornirea extragerii de grup, deci fără ciclu de deadlock.
- **CAS:** proveniența se scrie DOAR dacă textul dat are exact sha-ul `text_extras`-ului curent. Altfel răspunsul e `{refuz: 'text_depasit'}` și nu se scrie nimic.
- **Efectul:** un producător întârziat nu poate scrie o proveniență „mai nouă” pentru un text deja înlocuit.

| | |
|---|---|
| Cine o pornește | Producătorii, ca service_role: ingest, `document-nou-citeste`, `plansa-citeste`. Worker-ul NAS și `word-text` NU scriu proveniență, deci textele lor nu sunt valide pentru cantități până la o confirmare umană. |
| Cost | 0 |
| Ce poate merge prost | Proveniența lipsă (texte mai vechi de 31a/31b, toate textele de dinainte de 16.10) → textul nu e valid pentru cantități. Se rezolvă cu `text_confirmat` (decizie umană, `fn_ofertare_cb_decizie`) sau cu o recitire. |
| Revenire | `supabase/revenire/20261031b_…_ROLLBACK.sql` (corpul din 31a) și `20261031a_…_ROLLBACK.sql`. Amândouă sunt armate pe tranzacție. 31a și 31b sunt APLICATE pe 16.10. |

### 1.3 Recitirea textelor și laboratorul de citire (`ofertare-citire-test`, `scripts/recitire_val1/`)

**Laboratorul (`ofertare-citire-test`)**
- Citește un document cu un model ales (`haiku` = 4.5, `haiku55`, `sonnet`, `opus`), pe felii, cu exact promptul și regula de tabel ale ingest-ului.
- Scrie DOAR în `ofertare_citire_test` (text, tokeni, cost, eroare pe felie) și în `ai_usage_log`. Nu atinge documentul.
- Pe el s-a făcut proba din 15.10: Haiku 5.5 față de Haiku 4.5 pe primele 8 pagini.
- **Atenție:** poarta lui e doar „acces Ofertare”, NU poarta pe cheltuială. Orice utilizator Ofertare poate porni apeluri plătite. De închis după valul 1: recitirea valului 1 îl folosește cu `claudetest@`, care e admin, nu owner.

**Recitirea, varianta C** (decizia lui Răzvan, 16.10)

- **Valul 1:** procedură unică (`docs/ofertare/RECITIRE_VAL1_PROCEDURA.md` v5, scripturile din `scripts/recitire_val1/`, #734). Cuprinde 20 de liste de cantități:
  - 13 citite cu Haiku 4.5;
  - 7 copii ale lic. 5 în lic. 103.

  Toate 20 au zero date derivate.
- **Valul 2 (celelalte ~950 de documente):** abia după protocolul general de versiune a textului (varianta A, `docs/ofertare/RECITIRE_TEXTE_SPEC.md` v3, doar intrare).

| Pas | Cine | Cost | Ce poate merge prost → revenire |
|---|---|---|---|
| 0. `pas0.sql`: cele 20 de documente au tot zero derivate și sunt `procesat` | chat, read-only | 0 | o abatere → oprire, decide Răzvan |
| 1. `fereastra.ts deschide`: snapshot-ul joburilor (o dată), cele 13 joburi Ofertare oprite, worker-ul NAS oprit, golirea `T_gol` + 15 min. Coada `pg_net` numără DOAR cererile spre `/functions/v1/ofertare-*` și `vercel-relay` (care pornește `seap-import` pe Vercel), pentru că joburile altor module țin coada globală mereu ocupată (#745). Orice activitate nouă reia așteptarea. | chat, seara, cu „da”-ul lui Răzvan | 0 | stare coruptă → oprire fără suprascriere. **La orice eroare după deschidere: `fereastra.ts inchide`** (repune exact joburile și worker-ul). |
| 2. `citeste.ts`: laboratorul, Haiku 5.5, secvențial, UN apel pe invocare | chat, cu „da” | plafon **dur 1,00 USD** pe val (rezervare persistentă de 0,53 USD înaintea fiecărui apel, cazul cel mai rău). Așteptat ~0,33 USD. | apel fără exact un rând de staging, usage neatribuit, apel străin, sursă schimbată → oprire, cu rezervarea păstrată. Registrul valului e unul singur (`rulare.json`) și ilizibil = oprire. |
| 3. `asambleaza.ts`: marcaje brute exacte (fără reparare), acoperire 1..pagini, identitatea citirii = cea din BD, convenția numerică pe grupul de părți (212 + 213) | chat, local | 0 | integritatea nu se poate excepta. Calitatea (`cantitati_m` nou ≥ vechi) se poate accepta nominal de Răzvan. |
| 4. Preview → „da”-ul lui Răzvan, cu commit-ul + sha256 al `manifest_aprobat.csv` | Răzvan | — | — |
| 5. `aplica.sql`: o tranzacție psql ca postgres | chat | 0 | Pași: `LOCK TABLE … IN SHARE MODE` pe tabelele derivate, apoi CAS pe text, identitate, metadate, PDF-ul din Storage și licitație, apoi arhivarea textului vechi și nou, apoi `UPDATE`, apoi proveniența `transcriere` / `recitire-haiku-5-5`. Orice abatere → `RAISE`, nimic scris. După COMMIT, `aplica_rezultat.sql` verifică egalitatea cu `RETURNING`. |
| 6. `verifica.sql`, după 24h | chat, read-only | 0 | derivat pe text depășit → eșec, decide Răzvan. Derivate fără versiune → „nedovedit”, listate. |
| R. `revino.sql` | chat, cu „da” | 0 | CAS pe starea exactă de după aplicare. Textul și metadatele vechi revin. Proveniența `sinteza_ai` / `revenire-recitire` face înghețarea să aleagă textul vechi, marcat `text_indisponibil`. |

**Conexiunea postgres a recitirii** (`RV1_PG_URL`, ca postgres; #744, după prima pornire din 16.10):
- **Problema:** deno-postgres v0.19.3 nu verifica certificatul pooler-ului și trecea tăcut pe necriptat.
- **Acum** conexiunea se face DOAR criptat și verificat: `verify-full`, adică lanțul de certificate și numele de gazdă, cu CA-ul Supabase din repo. Fișierul e `scripts/recitire_val1/supabase-prod-ca-2021.crt`: Supabase Root 2021 CA, public, sha256 `80:70:25:AD:…:CA:FA`, valid până la 26.04.2031.
- **`conexiune.ts`** e comun pentru tot ce se conectează:
  - URL-ul se citește cu parametrii decodați și e permis doar `sslmode=verify-full`;
  - erorile au mesaje fixe pe categorii (TLS / autentificare / rețea), fără parolă.
- **`fereastra.ts`** folosește `tls: { enabled, enforce, caCertificates }`. Orice eșec → cod 2, fără nicio schimbare.
- **psql se rulează DOAR prin `scripts/recitire_val1/psql.ts`:**
  - conexiunea se dă ca cuvinte-cheie libpq (`sslmode=verify-full sslrootcert=…`); parola doar în mediul procesului;
  - `-X` e impus și stdin e închis, deci nu poate intra un `\connect` pe stdin;
  - argumentele trec pe o listă albă structurală: `-X -1 -q -v NUME=…` și exact un `-f`, cu calea exactă a unuia din cele 6 scripturi ale procedurii;
  - erorile de conectare ale psql apar doar pe categorii;
  - executabilul se ia din `RV1_PSQL` (pe serverul AI: `C:/Users/Public/pgsql/bin/psql.exe`).
- **Verificat pe viu** (tenant inexistent):
  - CA-ul nostru: TLS trece;
  - CA greșit: `certificate verify failed`;
  - formele de ocolire (`-Xd…sslmode=disable`, `\connect` pe stdin, `-h`): refuzate.

**Worker-ul NAS** se oprește și pornește de pe serverul AI (pașii 1 și 8 din README): `terra_ssh.py '…/docker stop|start gazpet-ofertare-worker'`.

**Confirmarea costului** (#747, după fereastra_2 din 16.10):
- `ofertare_citire_test.cost_usd` e `numeric(10,4)`, iar `ai_usage_log.cost_usd` e `numeric(10,6)`.
- Pilotul recalculează costul din tokeni (tariful Haiku 5.5, pe treaptă) și îl compară cu fiecare rând, la precizia lui. Costul confirmat e cel exact.
- O oprire pe „cost neconfirmat” se rezolvă cu `citeste.ts <dir_val> --reconciliaza` (fără AI), nu editând registrul.

Testele: 56 Deno (`deno test -A scripts/recitire_val1/`) și harness-ul PG16 `scripts/test_recitire_val1.sh`.

### 1.4 Cantitățile structurate și comparatorul (TKT-0329 B: 20261031a, `ofertare-cantitati-extrage`, `_shared/cantComparator.ts`)

**Extragerea (modul `structurat`, PR3 #729)**

| Pas | Ce face |
|---|---|
| Intrarea | Doar documentele cu **text valid** (§1.2). Celelalte sunt sărite (`text_nevalid`). |
| Rolurile | Rolurile pe secțiuni (`f3`, `c6`, `atr`, `cs`, `fisa_date`, `memoriu`, `plansa`…), din antet, marcaje sau titlu. Deciziile omului (`rol_confirmat` / `nu_e_sursa_cantitativa`) le înlocuiesc. |
| Feliile | Felii cu poziție. Modelul `openai_mini` (cheia `OPENAI_API_KEY`) întoarce rânduri. |
| Normalizarea în cod (`_shared/cantNumar.ts`, `cantNormalizare.ts`, `dn.ts`) | Cantitatea e **dovedită** doar dacă tokenul întreg e găsit în textul documentului, are UM-ul alăturat sau UM-ul din antetul coloanei, și nu e diametru sau exponent. **Dovada pe rând** (val 2, PR-A, normalizator `n3`): codul de articol dat de model trebuie să fie un identificator ÎNTREG al liniei cantității, iar Dn-urile din denumire + citat în blocul rândului. Blocul = linia cantității; liniile de dedesubt intră doar cu delimitare pozitivă (se închid în linia „… Total=” a articolului, max. 4 linii, fără început de articol / linie cu UM / linie goală / pagină nouă între ele); la tabelul markdown doar linia. Altfel `cod_alt_rand` / `dn_alt_rand` → nedovedit (riscul DN63/DN110). Un Dn în plus pe rând → `dn_ambiguu`. Listele cu denumirea DEASUPRA cantității rămân nedovedite (fail-closed). **Convenția numerică** (`3.995` = 3995 sau 3,995) se ia doar din dovezi tari, pe GRUPUL de părți ale aceluiași PDF. Un token ambiguu → `valoare_ambigua` → cheia `incomplet`. |
| Pornirea | Prin `fn_ofertare_cb_extragere_incepe_grup` (31b), sub mutexul licitației: documentele `FOR SHARE NOWAIT`, verificarea manifestului de grup, verificarea deciziilor de rol, apoi cererea. |
| Scrierea | Rezultatul intră în tabelele imuabile `ofertare_cant_extrageri` / `_felii` / `_obs`. |

**Comparatorul (`_shared/cantComparator.ts`, PR4a #731; funcții pure, încă nelegat de UI)**
- **Deduplicarea:** pe valori brute, doar la același (document, sha, offset) cu semantică identică. Orice dezacord → `conflict_sursa`.
- **Agregarea:** `masura = lungime` (km → m), pe rol și cheie (`lot|obiect|tip|material|dn|um`), cu aliasuri umane.
- **Totalurile:** `suma_vs_total` și `suma_vs_subtotal`, emise mereu.
- **Pragurile:**
  - H2: diferență relativă > 0,1 %;
  - „de semnalat”: > 1 m ȘI > 1 %.
- **Acoperirea pe perechi:** `gata` doar cu toate condițiile îndeplinite. Neasociatele, cheile incomplete și anomaliile din roluri o blochează.
- **H2:** tri-state, `necalculat` / `incomplet` / `gata`.
- **Amprenta:** canonică.
- **PR4b**, după proba pe lic. 15: edge-ul „Recalculează”, tab-ul Comparație, view-ul H2.

| | |
|---|---|
| Cine o pornește | **Owner sau responsabilul licitației** (poarta pe cheltuială în edge) și DOAR pe o **cerere** activă (`fn_ofertare_cb_cerere`: owner / responsabil / admin Ofertare). Cererea cere un **plafon** setat de owner (`fn_ofertare_cb_buget_seteaza`, scopul `cant_extragere`, ≤ 100 USD). `x-radar-secret` e refuzat în acest mod. |
| Cost | Fiecare felie e plătită printr-o rezervare atomică în BD (`fn_ofertare_cb_rezerva`, apoi `fn_ofertare_cb_deconteaza` / `_necunoscuta` / `_abandon`). Consumul = decontat + deschis + necunoscut + abandonat. Depășirea rezervării → bugetul `blocat` (deblocare doar de owner). |
| Ce poate merge prost | Text nevalid → documentul e sărit. Grup schimbat sau ocupat → `grup_schimbat` / `grup_ocupat`, se reia. Felie cu rezultat necunoscut → socotită în consum, reluată doar de om (`fn_ofertare_cb_extragere_redeschide`). Cantități ambigue → `incomplet`, nu se adună. |
| Revenire | Tabelele sunt imuabile: o extragere nouă (alt sha / extractor) nu șterge istoricul. Migrarea are `supabase/revenire/20261031a_ofertare_cantitati_b_ROLLBACK.sql`, armată. |
| Starea la 16.10 | 31a + 31b + edge-urile deployate. **Proba plătită pe lic. 15 (Răcari) e amânată până după recitirea 212 / 213.** Plafonul și pornirea le face Răzvan; cererea o poate face `claudetest@`. După recitire, 212 / 213 au proveniență `transcriere`, deci nu mai cer `text_confirmat`. |

### 1.5 Porțile și plafoanele (rezumat)

| Pas plătit | Cine îl poate porni | Plafon / control |
|---|---|---|
| Ingest (`ofertare-ingest-doc`) | owner sau responsabilul licitației, sau worker-ul NAS (secret) | per apel în `ai_usage_log`, fără plafon pe licitație |
| `document-nou-citeste` (PDF întreg) | owner / responsabil / secretul intern. Rezumatul din textul existent: oricine are acces Ofertare. | per apel |
| `plansa-citeste` | owner / responsabil | `FELII_PE_RULARE` pe rulare |
| Laboratorul (`ofertare-citire-test`) | **orice utilizator Ofertare (gaură, de închis după valul 1)** | — |
| Recitirea valului 1 | chat, cu „da”-ul lui Răzvan, prin laborator | 1,00 USD dur pe val, rezervare 0,53 pe apel |
| Extragerea cantităților | owner / responsabil, pe cererea activă | plafonul `cant_extragere` (owner), rezervare atomică |
| Arbitrul OCR (partea 2) | client, cu „da” pe sumă | plafonul rulării în BD |

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
- **Poarta de diacritice** (#742, determinist, după decizia finală — Haiku sau Sonnet): dacă cele două citiri diferă doar prin semne
  combinante (detectare LARGĂ: NFD fără `\p{M}`), un `text_propus` e acceptat doar dacă are aceeași bază ca UNA dintre citiri, cu lista
  ÎNCHISĂ de semne scoase (U+0302 U+0306 U+030C U+0326 U+0327, doar după A-Z / a-z); altfel `needs_human`, text gol, cost real
  păstrat. Prinde ≠ / ≰ și semnele invizibile. Dezacordurile mixte (litere + diacritice) nu intră sub poartă.
- **doar_haiku** (#739): un apel Haiku, fără escaladare, refuz server-side dacă citirile din BD au vreo cifră (`\p{N}`); deciziile nu intră
  în pragul §8 (proveniență legată de tentativă + model + eticheta serverului).
- **Bani**: rezervare ATOMICĂ în BD pe limita de sus a apelului (`fn_ofertare_ocr_arbitraj_rezerva`), plafonul rulării
  (`cost + rezervat + abandonat ≤ plafon_usd`) = **poarta tare**; un plafon local în client e doar estimare (#736 respins).
- **Pragul §8**: needs_human > 15 % din arbitrajele Claude (după minim 20) → rularea `oprita`. Reluarea doar prin
  `fn_ofertare_ocr_reia` (max 3 pe rulare), numărătoarea pe epoca reluării.
- Validările 4xx ale edge-ului (400 / 413 / 422, înaintea rezervării, nimic cheltuit) nu opresc proba: item-ul e notat refuzat
  (`validare_<status>`) și sărit; un context > 2000 de caractere e sărit de client înainte de apel (#741).

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
| 16.10.2026 | #741 | Clientul: validările 4xx nu opresc proba, contextul > 2000 sărit înainte de apel |
| 16.10.2026 | #742 | Prompt arb-v3 (diacritice) |
| 16.10.2026 | (acest PR) | Documentul pipeline-ului + CI |
| 16.10.2026 | (acest PR) | Partea 1, scrisă de sesiunea Ofertare: §1.0 sursele, §1.1 ingest + căile vecine, §1.2 proveniența / CAS (31a / 31b), §1.3 laboratorul + recitirea valului 1 (#734), §1.4 cantități + comparator (#726 #729 #731), §1.5 porțile; căile CI extinse |
| 16.10.2026 | #744 | Recitirea valului 1: conexiunea postgres doar cu TLS `verify-full` și CA-ul Supabase (`conexiune.ts`, `fereastra.ts`), wrapper-ul `psql.ts` (listă albă de argumente, stdin închis, erori pe categorii), directoarele create de scripturi, worker-ul NAS în README |
| 16.10.2026 | #742 (r4) | Poarta deterministă pe `text_propus` la perechile doar de diacritice (Jakarinos r1–r4) |
| 16.10.2026 | #746 | `fereastra.ts`: coada `pg_net` numărată doar pe cererile spre funcțiile Ofertare + `vercel-relay` (coada globală nu se golea din cauza joburilor altor module) |
| 16.10.2026 | (acest PR) | Pilotul recitirii: costul confirmat din tokeni la precizia fiecărui tabel (staging `numeric(10,4)` față de `ai_usage_log` `numeric(10,6)`) + `--reconciliaza` pentru o oprire pe „cost neconfirmat” |
| 16.10.2026 | (acest PR) | Val 2, PR-A: dovada pe rând — codul pe linia cantității, Dn-ul în blocul rândului (`blocRand`, `verificaRand`) |
