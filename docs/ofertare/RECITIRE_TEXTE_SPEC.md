# Recitirea textelor documentelor (Haiku 4.5 → Haiku 5.5) — specificație v3

**Notă (16.10.2026, decizia lui Răzvan, varianta C):** documentul rămâne intrare pentru proiectul A (protocolul general de versiune a textului, înaintea valului 2). Valul 1 se face prin `RECITIRE_VAL1_PROCEDURA.md`.

**Stare: propunere (PR draft, doar documentație).** Nu se aplică nicio migrare, nu se face deploy, nu se cheltuie nimic și nu se scrie nimic în BD până la:
- GO-urile review-ului (Copilot + Jakarinos, două runde);
- „da”-ul lui Răzvan pe preview-ul cu cifre.

v2 = r1 (NO-GO de la ambii revieweri) + cerința chat-ului din 16.10: aplicarea pe VAL, cu o singură acțiune, plus o cale psql pentru pornire și aplicare.
v3 = r2 (NO-GO de la ambii revieweri). Piesa centrală nouă e **gardul** (§4.1): cât timp un document e într-un val deschis, triggerele din BD refuză ORICE schimbare de text, decizie sau derivat pe el, venită pe altă cale decât funcțiile recitirii. Listele schimbărilor sunt la §13 (v1 → v2) și §14 (v2 → v3).

## 1. De ce

Laboratorul de citire a arătat ce se întâmplă cu listele de cantități scanate citite cu `claude-haiku-4-5`: pierd 44–63 % din cantități și inventează pagini.

`ofertare-ingest-doc` citește din 15.10.2026 (commit `6f8a22c`) cu `claude-haiku-5-5`. Textele citite înainte au rămas însă în `ofertare_documente_atribuire.text_extras`. Cantitățile B (TKT-0329) și orice probă plătită pe ele ar măsura textul stricat.

Răzvan a aprobat recitirea cu Haiku 5.5 (16.10). Primul val cuprinde DOAR listele de cantități.

## 2. Principii

1. **Nimic nu se pierde.** Textul vechi și metadatele lui (`status_procesare`, `pagini_necitite`, `procesat_la`, `pagini_procesate`, `pagini_felie`) se arhivează înainte de înlocuire.
   - Textul se arhivează în `ofertare_doc_texte` (content-addressed, imuabil, 20261031a).
   - Metadatele se arhivează în rândul planului.
2. **Citirea e separată de aplicare.** Recitirea produce un text NOU în arhivă, alături de cel vechi, plus un raport determinist. Documentul nu se schimbă la citire.
3. **Aplicarea e CAS, pe toată identitatea.** Textul se înlocuiește numai dacă `text_extras`, `fisier_path`, `size_bytes` și `pagina_offset` sunt EXACT cele din plan. Lock-urile urmează ordinea fixă din §8.
4. **Proveniența.** Textul nou primește `ofertare_doc_texte_prov` cu `origine = 'transcriere'` și producătorul `recitire-haiku-5-5`, în aceeași tranzacție cu înlocuirea.
5. **Ce înseamnă „invalidat”.**
   - Datele B, legate de `doc_sha256`, nu se mai aplică noului sha. Rămân ca istoric.
   - Orice alt derivat existent pe document BLOCHEAZĂ aplicarea, cu refuzul `derivate`. NU se aplică peste date derivate care n-ar ști că textul s-a schimbat.
6. **Banii au o rezervare conservatoare, iar depășirea oprește valul.** `count_tokens` e o estimare, deci nu o tratăm ca limită exactă.
   - Rezervarea pe apel = 2 × `count_tokens` × tariful de intrare + `max_tokens` × tariful de ieșire.
   - Treapta tarifară e cea de JOS numai dacă 2 × `count_tokens` < 100k; altfel se rezervă la treapta de SUS.
   - `max_tokens` e o constantă de server (12 000), validată în SQL, nu un parametru al edge-ului.
   - Request-ul trimis e exact cel numărat; edge-ul îl construiește o singură dată (test dedicat).
   - Rezervarea și decontarea se serializează pe rândul valului, iar decontarea se face o singură dată.
   - Dacă costul real depășește rezervarea, valul se blochează (`blocat = true`) și nu mai pleacă niciun apel. Depășirea maximă e deci cea a unui singur apel.
     - Cu felii de 8 pagini (~25k tokeni): cel mult ~0,01 USD peste plafon.
     - Un apel peste prag (> 50k tokeni numărați) se rezervă la treapta de sus, deci depășirea vine doar dintr-o eroare de numărare de peste 2×.
   - Un rezultat necunoscut rămâne socotit la rezervare.
7. **Consimțământul e înregistrat, nu presupus.** Pornirea citirii și aplicarea cer o decizie înregistrată cu autor și motiv, într-una din două forme:
   - owner-ul, din UI sau RPC;
   - postgres prin psql (`session_user = 'postgres'`, §5), cu motiv obligatoriu.
   Secretul tehnic al edge-ului doar EXECUTĂ un val deja aprobat.
   - Motivul și jurnalul consemnează operatorul; ele nu dovedesc singure acordul lui Răzvan. Acordul lui e „da”-ul din chat, citat în motiv. Așa e regula pentru orice acțiune pe date reale (CLAUDE.md pct. 3).
   - **Aplicarea e legată de preview-ul văzut:** `aplica_val` primește manifestul aprobat (documentele și `sha_nou`-urile din preview) și nu aplică nimic din afara lui.

## 3. Primul val: listele de cantități (preview, BD 16.10, read-only; interogările în Anexa A)

Există 27 de documente `tip = lista_cantitati` cu text. Valul are 20 de documente, cu **505 pagini cunoscute**; grupul C are `pagini` NULL.

| Grup | Documente | Pagini | Dovada originii textului CURENT | În val |
|---|---|---|---|---|
| A. citite de AI cu Haiku 4.5 | 137, 138, 139 (lic. 3); 165, 166, 167, 168, 169, 170, 171 (lic. 5); **212, 213 (lic. 15)**; 434 (lic. 93) | 385 | (1) `ai_usage_log`: apeluri `ofertare-ingest-doc` cu `claude-haiku-4-5-20251001`, 2,53 USD; (2) `procesat_la` = momentul ULTIMULUI apel AI, la secundă, pe fiecare document, deci nimeni n-a scris textul după acel apel | DA, mod `ai` |
| B. copii în lic. 103 | 1288 ← 165, 1289 ← 166, 1290 ← 167, 1291 ← 168, 1292 ← 169, 1293 ← 170, 1294 ← 171 | 120 | același `nume_original`, aceeași `size_bytes`, același md5 al textului, același `procesat_la` și același `pagina_offset` ca sursa; niciun apel AI propriu | DA, mod `refolosire` (niciodată AI) |
| C. lic. 3, arhiva F1–F6 | 1605–1611 | NULL | fără apel AI în `ai_usage_log`; au `analiza.citire_noi` | NU: alt flux; se decide separat (§12) |

**Fapte despre cele 20 de documente din val**, toate verificate în Anexa A:
- **Starea textului:** toate au `status_procesare = procesat`, `pagini_necitite` gol și `pagini_procesate = pagini`.
- **Proveniență și decizii:** niciun rând în `ofertare_doc_texte_prov` și nicio decizie B. Textul vechi nu e „valid” pentru B pe nicio cale.
- **Date derivate, toate 0:**
  - `ofertare_cerinte` (sursă sau `surse_document_ids`);
  - `ofertare_cantitati` (F3 vechi);
  - `ofertare_clauze_contract`;
  - `ofertare_triere`;
  - `ofertare_raspuns_set_doc`;
  - `analiza.citire_noi` / `citire_ai`;
  - apariții în `ofertare_analiza_versiuni.doc_manifest`.
- **Garda de ingest:** niciun rând în `ofertare_ingest_garda`, pentru că documentele au fost procesate înainte de gardă.
- **`pagina_offset`:** 213 are **104**, fiind partea a doua din aceeași listă cu 212; marcajele lui sunt 105–176. Celelalte au 0.

**Cost:** Haiku 5.5 costă 0,10 / 0,50 USD pe milion de tokeni (intrare / ieșire), sub pragul de 100k tokeni pe cerere; peste prag, 0,50 / 2,50 (`_shared/ocrLocal.ts`).
- **Estimare orientativă:** ~1/10 din cei 2,53 USD ai citirii Haiku 4.5, adică ~0,25 USD. Tokenizarea diferă, deci e doar orientativă.
- **Limita superioară sigură:** cu felii de 8 pagini și `max_tokens` = 12 000, ieșirea e plafonată la 0,006 USD pe apel. 385 de pagini înseamnă ≥ 49 de apeluri, deci ~0,30 USD doar pe ieșire în cazul cel mai rău, plus intrarea.
- **Plafonul valului: 1,00 USD**, acceptat de chat. Plafonul e garanția; estimarea nu e.

## 4. Model de date (migrarea `20261101a_ofertare_recitire`, NEAPLICATĂ până la „da”)

Toate tabelele au RLS activ și SELECT doar cu `fn_are_acces_ofertare()`. Nu au INSERT / UPDATE / DELETE direct; se scrie doar prin funcțiile de la §5.

```
ofertare_recitiri                -- valul
  id, nume, model ('claude-haiku-5-5'), plafon_usd (0 < p ≤ 10, 2 zecimale),
  stare ('planificat' | 'aprobat' | 'inchis'), blocat bool, blocat_motiv,
  creat_de (uid | NULL pentru psql), creat_la
ofertare_recitire_doc            -- un document din val (planul e IMUABIL după creare; doar coloanele de execuție se schimbă)
  id, recitire_id, document_id, licitatie_id,
  mod ('ai' | 'refolosire'), sursa_id (→ rândul mod='ai' din ACELAȘI val; obligatoriu dacă mod='refolosire', NULL altfel),
  -- identitatea sursei, fixată la planificare:
  sha_vechi, fisier_path, size_bytes, pagina_offset, pagini_plan,
  meta_vechi jsonb (status_procesare, pagini_necitite, procesat_la, pagini_procesate, pagini_felie),
  -- execuție:
  stare ('planificat' | 'in_citire' | 'citit' | 'aplicat' | 'respins' | 'esuat' | 'depasit' | 'revenit'),
  pdf_sha256 (fixat O DATĂ la prima revendicare, necondiționat), pagini_pdf (numărul real de pagini, din pdf-lib),
  token uuid, lease_pana, incercari (contor persistent, ≤ 5), urmatoarea_dupa (backoff), pagini_procesate, pagini_felie (dimensiunea curentă a feliei, persistată la înjumătățire),
  text_partial, sha_nou, completitudine ('integral' | 'partial'), pagini_necitite int[], raport jsonb, cost_usd, motiv
  UNIQUE (recitire_id, document_id); un document e în cel mult UN val cu stare ≠ 'inchis'
ofertare_recitire_rezervari      -- un apel AI
  id, recitire_doc_id, token, incercare, suma_rezervata, cost_real, stare ('deschisa' | 'decontata' | 'necunoscuta'),
  creat_la, inchisa_la; UNIQUE (recitire_doc_id, incercare)
ofertare_recitire_aprobari       -- manifestul aprobat pentru aplicare (imuabil): exact ce a văzut omul în preview
  id, recitire_id, manifest jsonb ([{recitire_doc_id, document_id, sha_nou}]), actor_uid NULL, actor_rol, motiv, la
ofertare_recitire_jurnal         -- append-only: fiecare decizie umană / admin
  id, recitire_id, recitire_doc_id NULL, actiune ('planifica' | 'aproba_citire' | 'aplica_val' | 'aplica' | 'respinge' | 'revino'
  | 'deblocheaza' | 'inchide'), actor_uid NULL, actor_rol ('owner' | 'postgres'), motiv (NOT NULL, ≥ 10 caractere), rezultat jsonb, la
```

**Tranzițiile `ofertare_recitire_doc`:**

| De la | Spre | Funcția |
|---|---|---|
| `planificat` | `in_citire` | `revendica` |
| `planificat` | `depasit` | `revendica` (identitatea documentului diferă de plan) |
| `planificat` | `esuat` | `revendica` (copie cu sursa `esuat` / `respins` / `depasit`) |
| `in_citire` | `in_citire` | `progres`, `fixeaza_pdf`, `revendica` după expirarea lease-ului |
| `in_citire` | `citit` | `text_pune` / `refoloseste` |
| `in_citire` | `esuat` | `esueaza`; `revendica` la a 6-a încercare sau la `pdf_schimbat` |
| `in_citire` | `depasit` | `revendica` / `fixeaza_pdf` (identitatea documentului diferă de plan) |
| `citit` | `aplicat` / `respins` | `aplica` / `aplica_val` / `respinge` |
| `citit` | `depasit` | `aplica` / `aplica_val`, DOAR la CAS de identitate eșuat (persistat în afara sub-blocului, §7) |
| `aplicat` | `revenit` | `revino` |
| `aplicat` | `depasit` | `revino`, la CAS eșuat |

Stările `respins`, `esuat`, `depasit` și `revenit` sunt terminale. **Nicio altă tranziție nu e permisă**, iar orice altă combinație dă refuz.

### 4.1 Gardul (triggerele din migrare)

**Pe ce se aplică.** Un document e „îngrădit” cât timp are un rând `ofertare_recitire_doc` într-un val cu `stare <> 'inchis'`.

**Ce refuză.** Pe un document îngrădit, triggerele refuză orice operație de mai jos venită pe altă cale decât funcțiile recitirii:

| Trigger | Ce refuză |
|---|---|
| `BEFORE UPDATE` pe `ofertare_documente_atribuire` | schimbarea oricăreia dintre coloanele `text_extras`, `fisier_path`, `size_bytes`, `pagina_offset`, `pagini`, `status_procesare`, `pagini_necitite`, `analiza` |
| `BEFORE INSERT OR UPDATE` pe tabelele derivate din §3 | `ofertare_cerinte`, `ofertare_cantitati`, `ofertare_clauze_contract`, `ofertare_triere`, `ofertare_raspuns_set_doc`; la cerințe și la cantitățile vechi verifică și `surse_document_ids` |
| `BEFORE INSERT` pe `ofertare_doc_texte_prov` și `ofertare_cant_doc_decizii` | rânduri noi pe documentul îngrădit (`text_scrie`, `text_confirmat`, decizii de rol) |
| `BEFORE INSERT` pe `ofertare_cant_extrageri` | pornirea unei extrageri B pe document |

**Cum se trece prin gard.** Funcțiile recitirii setează local, în tranzacție, `gazpet.recitire_scriere = '<recitire_doc_id>'`. Triggerul lasă să treacă numai scrierea pe ACEL document. GUC-ul nu poate fi setat prin PostgREST (nu e expus); un apel direct din SQL al altui rol nu ajunge la tabele fără privilegii.

**Gardul ține de la `planifica` până la `inchide`.** `inchide` refuză:
- dacă un document e încă `in_citire`;
- mai devreme de 1 oră după ultima aplicare (fereastră pentru producătorii întârziați: funcțiile edge rulează cel mult 150 s).

**Ce rezolvă gardul:**
- **Producătorii întârziați:** un extractor care a citit textul vechi și salvează după aplicare e refuzat la INSERT.
- **Scriitorii necunoscuți ai lui `text_extras`** (ingest, NAS, SEAP, `document-nou-citeste`, UI): oricine ar fi, e refuzat. Inventarul de la §5.1 rămâne pentru diagnostic, dar siguranța nu depinde de completitudinea lui.
- **`text_confirmat`** apărut după planificare pe sha-ul vechi.

**Costul.** Un SELECT pe un index parțial (`ofertare_recitire_doc` pe documentele din valuri deschise), doar la scrierile pe tabelele de mai sus.

**Erorile.** Triggerele dau `RAISE EXCEPTION` cu SQLSTATE `55006` (`document_in_recitire`). Producătorii existenți tratează deja erorile de BD ca erori de business; refuzul nu pierde date, ci doar amână lucrul.

## 5. Funcții

Toate sunt `SECURITY DEFINER SET search_path = public, pg_temp`.

**Poarta de identitate:**
- Funcțiile **owner** cer `auth.uid()` cu `is_owner`. EXECUTE e dat lui `authenticated`, dar corpul verifică owner-ul.
- Funcțiile **admin** (`_admin`) au trei protecții:
  - corpul verifică `session_user = 'postgres'` și `auth.uid() IS NULL`. `current_user` NU e o verificare: într-o funcție `SECURITY DEFINER` el e owner-ul funcției;
  - EXECUTE e revocat de la PUBLIC, anon, authenticated și service_role, și nu e acordat nimănui;
  - harness-ul testează un rol DB non-API, căruia i se acordă EXECUTE în mod deliberat: apelul lui e refuzat de verificarea `session_user`.
  - Înainte de prima folosire se verifică read-only că sesiunea psql a chat-ului (pooler) are `session_user = 'postgres'`.
- Funcțiile **service_role** au EXECUTE doar pentru service_role.
- Fiecare decizie owner / admin scrie un rând în `ofertare_recitire_jurnal`, cu motiv obligatoriu.

| Funcție | Cine | Ce face |
|---|---|---|
| `planifica(p_nume, p_plafon_usd, p_docs jsonb, p_motiv)` / `planifica_admin(…)` | owner / postgres | Vezi mai jos. |
| `aproba_citire(p_recitire_id, p_motiv)` / `_admin` | owner / postgres | `planificat` → `aprobat`. Abia acum edge-ul poate citi. |
| `revendica(p_recitire_doc_id)` | service_role | Vezi mai jos. Se cheamă ÎNAINTE de descărcare. |
| `fixeaza_pdf(p_recitire_doc_id, p_token, p_pdf_sha256, p_pagini_pdf, p_fisier_path, p_size_bytes)` | service_role | Vezi mai jos. Se cheamă după descărcare. |
| `rezerva(p_recitire_doc_id, p_token, p_incercare, p_tokeni_numarati)` | service_role | Vezi mai jos. |
| `deconteaza(p_rezervare_id, p_token, p_tokeni_in, p_tokeni_out)` / `necunoscuta(p_rezervare_id, p_token)` | service_role | Vezi mai jos. |
| `progres(p_recitire_doc_id, p_token, p_pagini_procesate, p_pagini_felie, p_text_partial)` | service_role | CAS pe token și pe lease. `pagini_procesate` trebuie să crească strict (monoton) sau să rămână egal, cu o felie mai mică (înjumătățire persistată). Prelungește lease-ul. |
| `text_pune(p_recitire_doc_id, p_token, p_text, p_completitudine, p_pagini_necitite, p_raport)` | service_role | CAS pe token. Pune textul în `ofertare_doc_texte` pentru licitația documentului și trece rândul `citit`, cu `sha_nou`. **Nu atinge documentul.** |
| `refoloseste(p_recitire_doc_id, p_token, p_raport)` | service_role | Vezi mai jos. |
| `esueaza(p_recitire_doc_id, p_token, p_motiv)` | service_role | `in_citire` → `esuat`. |
| `aplica_val(p_recitire_id, p_manifest jsonb, p_motiv)` / `aplica_val_admin(…)` | owner / postgres | §7. `p_manifest = [{recitire_doc_id, sha_nou}]`, exact cel din preview. Se salvează în `ofertare_recitire_aprobari`. |
| `aplica(p_recitire_doc_id, p_sha_nou, p_motiv)` / `_admin` | owner / postgres | Un singur document, același corp ca §7, pentru excepții. |
| `respinge(p_recitire_doc_id, p_motiv)` / `_admin` | owner / postgres | `citit` → `respins`. |
| `revino(p_recitire_doc_id, p_motiv)` / `_admin` | owner / postgres | §9. |
| `deblocheaza(p_recitire_id, p_motiv)` / `_admin`; `inchide(…)` / `_admin` | owner / postgres | Deblochează valul după o depășire, respectiv îl închide; `inchide` ridică gardul §4.1. |

**`planifica` / `planifica_admin`**
- Creează valul. Primește `p_docs = [{document_id, mod, sursa_document_id?}]`.
- Pentru fiecare document fixează identitatea curentă: `sha_vechi`, `fisier_path`, `size_bytes`, `pagina_offset`, `pagini_plan`, `meta_vechi`.
- Refuză tot valul (nimic creat) dacă un document:
  - n-are text, e `plansa` sau are `status_procesare` ≠ `procesat`;
  - are o extragere B `in_lucru`;
  - e într-un alt val deschis;
  - are pe `sha_vechi` proveniență sau `text_confirmat`. EXCEPȚIE: proveniența `sinteza_ai` / `revenire-recitire` scrisă de `revino` nu dă validitate, deci nu blochează un val nou după o revenire;
  - are o încercare de ingest vie (gardă cu `in_curs_pana > now()`).
- Pentru `refolosire`, refuză dacă sursa nu e `mod = 'ai'` în același val sau dacă diferă oricare dintre: `size_bytes`, md5-ul textului vechi, `pagina_offset`, `pagini`.

**`revendica`** (ÎNAINTE de orice descărcare)
- Lock pe rândul planului `FOR UPDATE`. Cere valul `aprobat`, ne`blocat` și ne`inchis`.
- Starea trebuie să fie `planificat`, sau `in_citire` cu lease expirat, iar `urmatoarea_dupa ≤ now()`.
- `incercari + 1`; la a 6-a încercare trece în `esuat` (`prea_multe_incercari`). Backoff: `urmatoarea_dupa = now() + 2^incercari minute`.
- Verifică identitatea documentului față de plan (`fisier_path`, `size_bytes`, `sha_vechi`), altfel `depasit`.
- La `refolosire`:
  - sursa `esuat` / `respins` / `depasit` → copia trece în `esuat` (`sursa_esuata`);
  - sursa încă necitită → `asteapta_sursa`, FĂRĂ încercare consumată și FĂRĂ descărcare.
- Emite un token nou și un lease de 10 minute.

**`fixeaza_pdf`** (după descărcare)
- CAS pe token.
- La prima trecere fixează necondiționat `pdf_sha256` și `pagini_pdf`. La reluări valorile trebuie să fie IDENTICE, altfel `esuat` (`pdf_schimbat`).
- `p_fisier_path` și `p_size_bytes` trebuie să fie egale cu planul, altfel `depasit`.
- La `refolosire`, `pdf_sha256` trebuie să fie egal cu al sursei, altfel `esuat` (`pdf_diferit_de_sursa`).

O descărcare eșuată (PDF corupt, 404, peste 60 MB) se închide cu `esueaza`, sau rămâne pe lease; oricum consumă o încercare. Descărcările sunt deci limitate la 5 pe document, cu backoff.

**`rezerva`**
- Lock pe val `FOR UPDATE`.
- Suma rezervată = 2 × `p_tokeni_numarati` × tariful de intrare + `MAX_IESIRE` × tariful de ieșire.
  - `MAX_IESIRE` = 12 000 e o constantă în SQL; edge-ul trimite exact această valoare ca `max_tokens`.
  - Treapta de JOS se aplică numai dacă 2 × `p_tokeni_numarati` < 100 000; altfel treapta de SUS.
  - Tarifele (pe model) sunt constante în funcție, nu parametri.
- Refuză dacă:
  - valul e `blocat` sau `inchis`;
  - documentul nu e `in_citire` cu acest token;
  - consumul (decontat + deschis + necunoscut) plus suma rezervată depășește plafonul. Atunci valul devine `blocat` (`plafon`): nu se mai revendică nimic și nu se mai descarcă nimic până la `deblocheaza`.

**`deconteaza` / `necunoscuta`**
- Iau lock pe val, apoi pe rezervare. Merg numai pe o rezervare `deschisa` și se aplică o singură dată.
- `cost_real` se calculează în SQL din tokenii raportați de API (`usage.input_tokens` / `output_tokens`), cu treapta stabilită de tokenii de intrare REALI. Costul nu vine de la edge.
- `cost_real > suma_rezervata` → valul devine `blocat` (`depasire_rezervare`), iar costul rămâne auditat.

**`refoloseste`**
- CAS pe token. Merge doar pe un rând `mod = 'refolosire'`, cu sursa `citit` sau `aplicat` și cu același `pdf_sha256`.
- Copiază în `ofertare_doc_texte` textul sursei sub `(licitatia copiei, sha)`. Arhiva are cheia `(licitatie_id, sha256)`, iar proveniența o referă.
- Copiază `sha_nou`, `completitudine` și `pagini_necitite`.
- Raportul îl calculează edge-ul față de textul VECHI al copiei. Costul e 0.

### 5.1 Scriitorii rândului de document și ai derivatelor (inventar, pentru diagnostic)

Siguranța NU depinde de completitudinea acestui tabel: gardul §4.1 e la nivel de BD și prinde și scriitorii necunoscuți. Tabelul arată ce se întâmplă cu fiecare cale cunoscută cât timp documentul e îngrădit.

| Scriitor | Ce scrie | Calea / lock-urile | Pe un document îngrădit |
|---|---|---|---|
| `ofertare-ingest-doc` | `text_extras` + metadate | `ofertare_ingest_garda_rezultat`: gardă → document | refuzat de trigger; nici nu pornește pe `procesat` |
| worker NAS (`worker/ofertare/ingest.ts`, `citire_mare.ts`), `ofertare-word-text` | `text_extras` (pdftotext / docx) | aceeași gardă | refuzat de trigger |
| `ofertare-document-nou-citeste` (`scriere.ts`) | `analiza.citire_noi`; `text_extras` doar dacă era gol | CAS pe `analiza` / sha | refuzat de trigger (`analiza` e în lista coloanelor îngrădite) |
| `ofertare-plansa-citeste` | `text_extras` al planșelor | propriu | nu e cazul: `plansa` e exclus din val |
| `ofertare-seap-import` / `seap-veghe`, `_shared/codSeap.mjs` | metadate SEAP pe rând (`seap_meta`, `seap_cod`, …) | UPDATE direct | permis: nu atinge coloanele îngrădite |
| UI `OfertareLicitatii.jsx` | lot, relevanță, tip | UPDATE prin RLS | permis pe coloanele neîngrădite; refuzat pe cele îngrădite |
| `fn_ofertare_cb_text_scrie` (31b) | proveniență | licitație → document | refuzat de trigger (proveniență pe document îngrădit) |
| `fn_ofertare_cb_decizie` | `text_confirmat`, roluri | licitație `FOR SHARE` → advisory | refuzat de trigger |
| `fn_ofertare_cb_extragere_incepe(_grup)` | extragere B | licitație `FOR UPDATE` → documente `NOWAIT` | refuzat de trigger |
| `ofertare-cerinte`, `ofertare-clauze-formulare`, `ofertare-triere`, `ofertare-raspuns-set`, `ofertare-cantitati-extrage` (F3 vechi) | derivatele din §3 | INSERT / UPDATE | refuzat de trigger |

## 6. Citirea: edge `ofertare-ingest-doc`, mod nou `recitire`, plus un job de pas

**Autorizarea.**
- Edge-ul acceptă `{mod: 'recitire', recitire_doc_id}` de la un JWT de owner sau cu secretul intern (Vault `INTERN_EDGE_SECRET`, ca joburile din 20261016a).
- În AMBELE cazuri lucrează numai pe un val `aprobat`. Acordul e în BD, iar secretul nu ține loc de acord.
- `x-ingest-secret` (cel vechi) e refuzat pe acest mod.

**Pașii.**
1. `revendica` (token + încercare). Abia apoi descarcă PDF-ul (`ofertare` / `fisier_path`, limita de 60 MB), calculează sha256 pe octeți și numărul real de pagini (pdf-lib), apoi `fixeaza_pdf`.
2. La `mod = 'refolosire'`: dacă `fixeaza_pdf` a trecut, calculează raportul față de textul vechi al copiei și apelează `refoloseste`. **Niciun apel AI**, prin construcție: ramura AI nu există pentru acest mod.
3. La `mod = 'ai'`:
   - aceleași felii, prompturi și marcaje `⟦PAGINA N⟧` ca ingest-ul, numerotate ABSOLUT: `pagina_offset + pagina locală`;
   - Haiku 5.5 forțat; dimensiunea feliei se reia din `pagini_felie` (înjumătățirea persistă);
   - pentru fiecare apel:
     - request-ul (model, prompt, felia PDF, `max_tokens` = 12 000) se construiește O DATĂ și e imuabil;
     - `count_tokens` pe ACEL request (gratuit; e o estimare, de aici marja 2×);
     - `rezerva`, apoi apelul cu exact același request;
     - `deconteaza` cu `usage` din răspuns, sau `necunoscuta` la timeout sau eroare de rețea;
   - după fiecare felie, `progres`; cel mult 2 apeluri pe invocare;
   - la sfârșit, raportul (§6.1) și `text_pune`.
4. Edge-ul NU trece prin garda de ingest, NU scrie `ofertare_documente_atribuire` și NU schimbă `status_procesare`.

**Jobul de pas** (pg_cron, la 2 minute; automatizare nouă, cu fișa a–e în `registru_automatizari` + `public.automatizari`):
- Rulează numai dacă există un val `aprobat`, ne`blocat`, cu documente `planificat` sau `in_citire` cu lease expirat.
- Alege cel mult 2 documente, cu prioritate pe ordinea din plan, deci 212 și 213 întâi.
- Le trimite edge-ului cu `net.http_post` și secretul din Vault.
- Când nu mai are nimic de făcut, nu face nimic. Valul se închide manual.

**Fișa de securitate a jobului:**
- **(a) Conținut extern citit:** PDF-uri publicate de autoritate, prin AI.
- **(b) Ce scrie:** doar tabelele recitirii. Banii sunt plafonați per val.
- **(c) Identitatea:** service_role, pentru că edge-ul trebuie să citească Storage și să scrie arhiva.
- **(d) Cine îl pornește:** nimeni direct; jobul execută numai valuri aprobate de owner sau postgres.
- **(e) Ce cere confirmare umană:** aplicarea.

### 6.1 Raportul determinist (fără AI)

Raportul se calculează pentru textul vechi și pentru cel nou, cu `_shared/cantNumar.ts`:

| Câmp | Definiție |
|---|---|
| `pagini_asteptate` | intervalul absolut [`pagina_offset` + 1, `pagina_offset` + `pagini_pdf`] |
| `pagini_marcate` | paginile cu marcaj găsite în interval |
| `pagini_inventate` | marcaje ÎN AFARA intervalului, sau marcaje duplicate cu conținut diferit |
| `pagini_lipsa` | pagini din interval fără marcaj, plus `pagini_necitite` |
| `cantitati_m` | numărul de tokeni-cantitate cu UM `m`, cu aceleași reguli de poziție dovedită ca PR3 |
| `suma_m` | suma cantităților `m` |
| `tokeni_numerici`, `lungime` | numărul de tokeni numerici, respectiv lungimea textului |

## 7. Aplicarea pe val: `aplica_val` (owner) / `aplica_val_admin` (postgres)

**O singură acțiune, pe manifestul aprobat.**
- Se parcurg DOAR documentele din `p_manifest`, în ordinea `(licitatie_id, document_id)`. Fiecare trebuie să fie `citit` și să aibă `sha_nou` egal cu cel din manifest.
- Un document `citit` după preview și absent din manifest NU se atinge.
- Manifestul și motivul se salvează în `ofertare_recitire_aprobari` înainte de prima aplicare.

**Semantica sub-blocului (savepoint):**
- Fiecare document rulează într-un `BEGIN … EXCEPTION … END` plpgsql. Orice refuz din §8 e un `RAISE` cu cod propriu (SQLSTATE `P0R01`…`P0R09`), deci TOATE efectele documentului (gardă, arhivă, `UPDATE`, proveniență) se anulează. Testul verifică garda octet cu octet.
- În handler, DUPĂ rollback-ul sub-blocului, se persistă numai rezultatul permis:
  - la CAS de identitate eșuat (`text_depasit`), tranziția `citit` → `depasit`;
  - la orice alt refuz, documentul rămâne `citit`;
  - în ambele cazuri, rândul de jurnal și motivul în rezultat.
- Lock-urile luate de un sub-bloc reușit se păstrează până la sfârșitul tranzacției. Ordinea globală `(licitatie_id, document_id)` și `NOWAIT` (§8) exclud ciclurile.

**Criteriile de trecere.** Un document se aplică automat numai dacă îndeplinește TOATE condițiile:

| Criteriu | Pragul |
|---|---|
| Completitudinea | `completitudine = 'integral'` și `pagini_necitite` gol |
| Pagini inventate | `pagini_inventate = 0` |
| Pagini lipsă | `pagini_lipsa = 0` |
| `cantitati_m` | nou ≥ vechi |
| Precondițiile §8 | trec toate |

Cine nu trece rămâne `citit`, cu motivul în rezultat. Se poate aplica individual (`aplica`, cu motiv) sau respinge.

**Rezultatul** e o listă de forma `{aplicate: [...], neaplicate: [{document_id, motiv}]}`. Merge în jurnal și se întoarce apelantului.

## 8. Aplicarea unui document (corpul comun al `aplica` și al `aplica_val`)

Ordinea lock-urilor e fixă: **rând plan → licitație `FOR KEY SHARE` → gardă de ingest `FOR UPDATE NOWAIT` → document `FOR NO KEY UPDATE NOWAIT`**.
- Garda și documentul vin după licitație, la fel ca în `text_scrie` (31b), și se iau cu `NOWAIT`. Dacă le ține altcineva, refuzul e `document_ocupat`: documentul rămâne `citit` și se reia mai târziu.
- Ținând licitația, aplicarea nu așteaptă niciodată o resursă pe care o poate ține un scriitor „document-întâi”. Asta rupe ciclul în trei sesiuni găsit de Copilot: `garda_rezultat` (gardă → document) × `aplica` (licitație → gardă) × un producător (document → `text_scrie` → licitație). Același tipar ca `NOWAIT` din #729.
- Gardul §4.1 oricum refuză scrierile pe text ale producătorului pe un document îngrădit.

Pașii:
1. Rândul trebuie să fie `citit`; `sha_nou` trebuie să fie egal cu parametrul (doar la `aplica`).
2. Lock pe licitație.
3. **Garda de ingest:** `INSERT … ON CONFLICT DO NOTHING`, apoi `FOR UPDATE`.
   - Dacă `in_curs_pana > now()` → refuz `ingest_in_curs`.
   - Altfel `incercare_token = NULL` și `in_curs_pana = NULL`, ca un `ofertare_ingest_garda_rezultat` întârziat, cu tokenul vechi, să fie respins.
   - **Un ingest ULTERIOR (după `inchide`)** nu suprascrie textul: ingest-ul sare documentele cu `status_procesare = 'procesat'` (`ofertare-ingest-doc`, l.209). Doar `partial` + `reia` le reia, iar `aplica_val` aplică numai textele integrale, deci rezultatul e `procesat`.
   - NU ne bazăm pe `deja_ingerat`: pentru cele 20 de documente garda e nouă, fără `ingerat_size` / `etag`.
   - Test dedicat: gardă absentă → aplicare → un ingest pornit fără `reia` → documentul e sărit.
4. Lock pe document. **CAS de identitate:** `sha256(text_extras) = sha_vechi`, `fisier_path`, `size_bytes` și `pagina_offset` = cele din plan. Altfel rândul trece în `depasit` și răspunsul e `text_depasit`.
5. **Precondiții sub lock**, fiecare cu un refuz numit:
   - extragere B `in_lucru` pe document → `extragere_in_lucru`;
   - ORICE derivat din lista §3 → `derivate`, cu numărătorile. Lista e fixă în funcție; un tabel nou de derivate o extinde explicit.
   - Rezultatele întârziate, salvate după aplicare, nu pot apărea cât timp valul e deschis: gardul §4.1 le refuză la INSERT. Verificarea de aici acoperă ce exista DINAINTE.
6. **Arhivare:**
   - textul vechi: `INSERT INTO ofertare_doc_texte … ON CONFLICT DO NOTHING`, fără proveniență;
   - metadatele vechi sunt deja în `meta_vechi` și se verifică egale cu cele curente, altfel `depasit`.
7. `UPDATE` pe document:
   - `text_extras`, `pagini_necitite`;
   - `status_procesare = 'procesat'`, după criteriile de mai sus;
   - `procesat_la = clock_timestamp()`;
   - `pagini_procesate = pagini_pdf`.
8. Proveniența: `INSERT ofertare_doc_texte_prov`, cu `origine = 'transcriere'`, producătorul `recitire-haiku-5-5`, completitudinea și paginile necitite.
   - `constatat_la` = `greatest(clock_timestamp(), max(constatat_la al documentului) + 1 µs)`, luat DUPĂ lock-uri, nu `now()` de la începutul tranzacției.
   - Ordinea pe document e deci strict monotonă, iar înghețarea vede ultima activare. Altă proveniență pe document nu poate apărea între timp: gardul §4.1.
9. Rândul trece în `aplicat`. Se scrie în jurnal.

**Efectul asupra TKT-0329 B:**
- `fn_ofertare_cb_text_valid` pe sha-ul nou întoarce proveniența (`transcriere`). Proba pe lic. 15 NU mai cere `text_confirmat` pe 212 și 213.
- Înghețarea (`fn_ofertare_cb_ingheata`) alege ultima proveniență ≤ moment, deci sha-ul nou.
- Snapshot-urile mai vechi păstrează sha-ul vechi, iar textul lui e în arhivă.

## 9. Revenirea: `revino` (owner) / `revino_admin` (postgres)

Aceeași ordine a lock-urilor ca la §8, inclusiv `NOWAIT`. Revenirea e posibilă numai cât valul e deschis, deci gardul e activ. După `inchide`, o revenire = un val nou.

Pașii:
1. Rândul trebuie să fie `aplicat`. CAS: `sha256(text_extras) = sha_nou`, iar `fisier_path`, `size_bytes` și `pagina_offset` sunt cele din plan. Altfel `depasit`.
2. Extragerea B `in_lucru` blochează revenirea; un derivat apărut DUPĂ aplicare o blochează și el (refuz `derivate`).
3. Textul vechi se pune înapoi din arhivă, cu `CHECK` pe sha. Se pun înapoi și TOATE câmpurile din `meta_vechi`.
4. **Istoricul activării.** Se inserează un rând de proveniență pentru `sha_vechi` cu `origine = 'sinteza_ai'` și producătorul `revenire-recitire`.
   - Motivul: înghețarea alege ultima proveniență, care trebuie să fie din nou textul vechi.
   - Rândul NU face textul valid: `sinteza_ai` = „fără dovadă”, iar înghețarea îl marchează `text_indisponibil` (31a l.1071).
   - `constatat_la` monoton, ca la §8, pasul 8.
   - Pe sha-ul vechi nu există altă proveniență sau `text_confirmat`: `planifica` a refuzat altfel, iar gardul a refuzat orice decizie nouă pe document de atunci. Pasul se REVERIFICĂ sub lock, cu refuzul `decizie_pe_sha_vechi`, fără să revoce vreo decizie umană.
   - Contractul e **echivalența semantică pentru B**, nu identitatea stării: înainte nu existau proveniențe, după revenire există una `sinteza_ai`. Testul compară rezultatul `fn_ofertare_cb_ingheata` (sha ales, `text_indisponibil`, dovada) dinainte de aplicare cu cel de după revenire.
5. Garda e tratată ca la §8, pasul 3.
6. Rândul trece în `revenit` (terminal). Se scrie în jurnal.

O nouă recitire a aceluiași document se face printr-un val nou.

## 10. Teste (harness PG16, ca `scripts/test_ofertare_cantitati_b.sh`)

**`planifica`** refuză:
- un ne-owner, sau o funcție admin apelată din `authenticated`;
- un document deja într-un val deschis;
- un document cu proveniență sau `text_confirmat` pe sha-ul vechi;
- o refolosire cu `pagina_offset` sau mărime diferită;
- un document cu ingest în curs.

**`revendica`:**
- două sesiuni pe același document → una singură primește tokenul;
- reluarea cu alt `pdf_sha256` → `esuat`;
- o copie înainte de sursă → `asteapta_sursa`, fără niciun apel AI.

**`progres`:**
- refuză un token vechi și pagini în regres;
- înjumătățirea persistă (8 → 4 → 2 se reia de la 2).

**Bani:**
- două sesiuni care rezervă concurent nu depășesc plafonul;
- `cost_real > rezervat` → val blocat;
- o decontare dublă e refuzată;
- `necunoscuta` rămâne socotită.

**`text_pune` / `refoloseste`:**
- documentul rămâne neschimbat (hash pe rând înainte și după);
- copia din lic. 103 e materializată în `ofertare_doc_texte` sub lic. 103, fără eroare de FK;
- `completitudine` și `pagini_necitite` sunt copiate.

**`aplica`:**
- textul schimbat între timp → `depasit`;
- `fisier_path` schimbat → `depasit`;
- extragere `in_lucru` → refuz;
- un derivat sintetic (o cerință) → `derivate`;
- ingest cu lease viu → `ingest_in_curs`;
- **un ingest întârziat** (token emis înainte de aplicare, `ofertare_ingest_garda_rezultat` după) → respins, iar textul recitit rămâne;
- arhiva și proveniența sunt corecte;
- `text_valid` e valid pe sha-ul nou; deciziile pe sha-ul vechi nu se mai aplică.

**Concurența** (3 sesiuni, fără deadlock): `aplica_val` × `text_scrie` × `extragere_incepe_grup`, și `aplica` × `ofertare_ingest_garda_rezultat`.

**`aplica_val`:**
- un document care nu trece criteriile rămâne `citit`, cu motiv, iar celelalte se aplică;
- un refuz pe un document nu le anulează pe celelalte;
- jurnalul e scris.

**`revino`:**
- CAS-ul;
- metadatele restaurate;
- `fn_ofertare_cb_ingheata` imediat după revenire alege sha-ul VECHI, cu `text_indisponibil`;
- un derivat apărut după aplicare blochează revenirea.

**Identitate:** funcțiile `_admin` refuză orice `auth.uid()` nenul și orice rol ≠ postgres; un motiv sub 10 caractere e refuzat.

**Gardul (§4.1), câte un test pe fiecare trigger:**
- un `UPDATE text_extras` direct (ca garda / NAS) pe un document îngrădit → `55006`;
- `ofertare_ingest_garda_rezultat` cu token valid pe un document îngrădit → refuzat, textul rămâne;
- `text_scrie`, `decizie text_confirmat`, `extragere_incepe` → refuzate;
- un INSERT în fiecare tabel derivat (inclusiv prin `surse_document_ids`) → refuzat;
- metadate SEAP / lot pe același rând → permise;
- după `inchide`, toate sunt din nou permise;
- `inchide` mai devreme de 1 oră după ultima aplicare → refuz.

**Ciclul în trei sesiuni (Copilot r2):** T1 `garda_rezultat` ține garda; T3 ține documentul (UPDATE direct, apoi `text_scrie`); T2 `aplica` ține licitația. Rezultatul: T2 primește `document_ocupat` (`NOWAIT`), fără deadlock, iar T1 / T3 sunt refuzate de gard.

**Sub-bloc:** un CAS sau un derivat care eșuează DUPĂ lock-ul și modificarea gărzii lasă garda neschimbată, comparată octet cu octet. Persistă doar `citit` → `depasit` / jurnalul.

**Manifest:** un document devenit `citit` după preview și absent din manifest nu e aplicat; un `sha_nou` diferit față de manifest → neaplicat.

**Bani:**
- `usage` real peste estimarea `count_tokens` (simulat 1,9×) intră în rezervare;
- simulat 2,5× → val `blocat`, iar apelul următor nu mai pleacă;
- traversarea pragului de 100k → rezervare la treapta de sus;
- `max_tokens` diferit de constantă → refuz;
- un request modificat după numărare → testul edge eșuează (request imuabil).

**Cron:**
- un PDF corupt → 5 încercări cu backoff, apoi `esuat`; numărul descărcărilor e ≤ 5;
- plafonul atins → val `blocat`, iar jobul nu mai revendică;
- o copie cu sursa `esuat` → `esuat`, fără descărcare.

**`revino`:**
- o proveniență concurentă cu timestamp mai vechi nu bate activarea (`constatat_la` monoton);
- `fn_ofertare_cb_ingheata`, dinainte de aplicare față de după revenire, e echivalentă pentru B;
- după revenire, `planifica` acceptă documentul într-un val nou.

**Identitate admin:** un rol DB non-API căruia i se acordă deliberat EXECUTE → refuzat de `session_user`.

**Edge (Deno, cu mock-uri):**
- fără owner și fără secretul intern → 403;
- `x-ingest-secret` → refuz;
- un val neaprobat → refuz;
- `refolosire` nu cheamă niciodată AI-ul (spy pe fetch);
- plafonul atins oprește valul înainte de apel;
- marcajele sunt absolute la offset 104;
- raportul detectează paginile inventate și cele lipsă.

## 11. Livrare

1. Acest PR (doar specificația) trece review-ul: Copilot + Jakarinos, 2 runde.
2. PR-ul de cod, cu două runde de review; merge-ul îl face chat-ul. Conține:
   - migrarea `20261101a`, cu revenirea ei și harness-ul;
   - modul `recitire` în ingest-doc;
   - jobul de pas;
   - un ecran minimal pentru owner (val, raport, butoanele „Aprobă citirea”, „Aplică valul” și „Revino”).
3. **Cu „da”-ul lui Răzvan:**
   - apply-ul migrării;
   - deploy-ul `ofertare-ingest-doc`;
   - activarea jobului;
   - `planifica_admin` + `aproba_citire_admin` cu lista exactă de la §3 și plafonul de 1,00 USD (chat-ul, prin psql, cu motivul care citează „da”-ul).
4. Citirea pornește automat prin job: întâi 212 și 213, apoi restul. Rapoartele ajung la chat ca preview cu cifre.
5. Cu „da”-ul lui Răzvan pe preview: `aplica_val_admin`. Neaplicatele se listează.
6. Proba plătită B pe lic. 15, pe sha-urile noi.
7. Registrele: `registru_automatizari` + `public.automatizari` (jobul și edge-ul), în aceeași sesiune.

## 12. Ce NU face

- Nu recitește altceva decât lista valului. Valul 2 (celelalte tipuri) are un plan și un preview separate.
- Grupul C (1605–1611) are `analiza.citire_noi`; originea textului lor se clarifică separat, înaintea oricărui val.
- Nu recitește planșe, `.docx` sau texte pdftotext.
- Nu șterge nimic.
- Nu trimite mailuri și nu atinge drepturi.

## 13. Schimbări v1 → v2

- **Copilot P1 (plafon) + Jakarinos P1 #4:**
  - limita superioară se calculează din `count_tokens` + `max_tokens` + treapta tarifară;
  - decontarea se calculează în SQL din tokeni și se face o singură dată, serializat;
  - depășirea blochează valul.
- **Copilot P1 (derivate) + Jakarinos P1 #2:** precondiția „zero derivate”, verificată sub lock la aplicare și la revenire, cu refuzul `derivate`. Afirmația falsă despre invalidarea cerințelor confirmate a fost scoasă.
- **Copilot P1 (tranziția de start) + Jakarinos P1 #5:**
  - `revendica` atomic, cu token și lease;
  - `progres` cu CAS și creștere monotonă;
  - înjumătățirea feliei persistată;
  - tabelul de tranziții.
- **Copilot P1 (revenirea) + P2 + Jakarinos P1 #3:**
  - `meta_vechi`, restaurat integral;
  - proveniența `sinteza_ai` pe sha-ul vechi, ca înghețarea să aleagă textul curent, marcat indisponibil;
  - precondiția „fără proveniență / `text_confirmat` pe sha-ul vechi” la planificare;
  - `aplicat` → `revenit` e o tranziție explicită.
- **Jakarinos P1 #1 (ingest întârziat):** aplicarea anulează tokenul gărzii, în ordinea gardă → document, și refuză un lease viu; test dedicat.
- **Jakarinos P1 #6 (identitatea PDF-ului):**
  - `pdf_sha256` fixat necondiționat;
  - CAS pe `fisier_path`, `size_bytes` și `pagina_offset` la aplicare și la revenire;
  - verificare la fiecare reluare.
- **Jakarinos P1 #7 (copii) + Copilot:**
  - modul `refolosire` e fixat în plan și nu cheamă niciodată AI-ul;
  - textul e materializat sub licitația copiei;
  - completitudinea și paginile necitite sunt copiate;
  - raportul e calculat față de textul vechi al copiei;
  - la planificare, același `pagina_offset`.
- **Jakarinos P2 #8:** pagini absolute (213 are offset 104), numărate față de `pagini_pdf` real.
- **Jakarinos P2 #9 + Copilot P2:**
  - cifrele sunt reformulate (505 = A + B);
  - dovada originii textului curent (`procesat_la` = ultimul apel AI);
  - interogările preview-ului în Anexa A;
  - verificarea proveniențelor și a snapshot-urilor.
- **Cerința chat-ului:**
  - `aplica_val`, cu criterii deterministe;
  - căile `_admin` prin psql, cu motiv obligatoriu și jurnal;
  - pornirea citirii prin `aproba_citire`, executată de job.

## 14. Schimbări v2 → v3

- **Jakarinos #2 (ingest ulterior):** ingest-ul sare `procesat`, iar aplicarea pe val dă doar texte integrale. Nu ne mai bazăm pe `deja_ingerat`, iar gardul acoperă fereastra valului.
- **Jakarinos #3 (derivate întârziate) + Copilot P1 (inventarul scriitorilor):** gardul prin triggere (§4.1) și inventarul de la §5.1.
- **Jakarinos #4 (`text_confirmat` după planificare):** gardul o refuză; reverificare sub lock la revenire.
- **Jakarinos #5 (timestamp-ul provenienței):** `constatat_la` monoton, după lock-uri.
- **Jakarinos #6 (descărcări nelimitate):** `revendica` ÎNAINTE de descărcare, cu contor ≤ 5 și backoff; plafonul atins blochează valul; copiile cu sursa eșuată se închid.
- **Jakarinos #7 (aprobarea legată de preview):** `aplica_val` cu manifest imuabil.
- **Jakarinos #8 + Copilot P1 (`current_user` în `SECURITY DEFINER`):** `session_user`, plus ACL și testul cu rol non-API.
- **Jakarinos #9 + Copilot P1 (savepoint):** semantica explicită, cu tranzițiile complete în tabel.
- **Jakarinos #10:** proveniența de revenire nu blochează un val nou.
- **Jakarinos #1 + Copilot P2 (bani):** marja 2× pe `count_tokens`, treapta tarifară conservatoare, `max_tokens` constantă de server, request imuabil, cost calculat din `usage` real. Depășirea e cel mult cea a unui apel.
- **Copilot P1 (ciclul în trei sesiuni):** `NOWAIT` pe gardă și document, plus test.
- **Copilot P2 (revenirea):** contractul e echivalența semantică pentru B, cu test comparativ pe `ingheata`.

## Anexa A — interogările preview-ului (read-only, rulate pe 16.10)

```sql
-- grupurile și dovada originii textului curent
SELECT d.id, d.licitatie_id, d.pagini, d.pagina_offset, d.size_bytes, d.status_procesare, d.pagini_procesate,
       cardinality(coalesce(d.pagini_necitite, '{}')) AS necitite, d.procesat_la,
       (SELECT string_agg(DISTINCT u.model, ',') FROM ai_usage_log u WHERE u.ref_table = 'ofertare_documente_atribuire'
          AND u.ref_id::text = d.id::text AND u.function_name = 'ofertare-ingest-doc') AS modele,
       (SELECT max(u.created_at) FROM ai_usage_log u WHERE u.ref_table = 'ofertare_documente_atribuire'
          AND u.ref_id::text = d.id::text AND u.function_name = 'ofertare-ingest-doc') AS ultim_apel_ai
  FROM ofertare_documente_atribuire d WHERE d.tip = 'lista_cantitati' AND length(coalesce(d.text_extras, '')) > 0 ORDER BY d.id;
-- copiile lic. 103 ↔ lic. 5
SELECT a.id, b.id AS copie, a.size_bytes = b.size_bytes, md5(a.text_extras) = md5(b.text_extras), a.pagina_offset = b.pagina_offset
  FROM ofertare_documente_atribuire a JOIN ofertare_documente_atribuire b ON b.licitatie_id = 103 AND b.nume_original = a.nume_original
 WHERE a.licitatie_id = 5 AND a.tip = 'lista_cantitati';
-- proveniență, decizii, derivate, snapshot-uri, gardă (pe cele 20 de documente)
SELECT d.id,
  (SELECT count(*) FROM ofertare_doc_texte_prov p WHERE p.document_id = d.id) AS prov,
  (SELECT count(*) FROM ofertare_cant_doc_decizii z WHERE z.document_id = d.id) AS decizii_b,
  (SELECT count(*) FROM ofertare_cerinte c WHERE c.sursa_document_id = d.id OR d.id = ANY (c.surse_document_ids)) AS cerinte,
  (SELECT count(*) FROM ofertare_cantitati q WHERE d.id = ANY (q.surse_document_ids)) AS f3_vechi,
  (SELECT count(*) FROM ofertare_clauze_contract k WHERE k.document_id = d.id) AS clauze,
  (SELECT count(*) FROM ofertare_triere t WHERE t.doc_id = d.id) AS triere,
  (SELECT count(*) FROM ofertare_raspuns_set_doc r WHERE r.document_id = d.id) AS raspunsuri,
  coalesce(d.analiza ? 'citire_noi', false) OR coalesce(d.analiza ? 'citire_ai', false) AS citire_noi_ai,
  (SELECT count(*) FROM ofertare_analiza_versiuni s, jsonb_array_elements(s.doc_manifest) e WHERE (e->>'document_id')::bigint = d.id) AS snapshot,
  (SELECT count(*) FROM ofertare_ingest_garda g WHERE g.doc_id = d.id) AS garda
  FROM ofertare_documente_atribuire d
 WHERE d.id IN (137,138,139,165,166,167,168,169,170,171,212,213,434,1288,1289,1290,1291,1292,1293,1294);
-- rezultat 16.10: toate coloanele = 0 / false pe toate cele 20 de documente
```
