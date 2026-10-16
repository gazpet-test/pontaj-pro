# Recitirea valului 1 (listele de cantități, Haiku 4.5 → Haiku 5.5) — procedură o dată, v1

**Decizia lui Răzvan (16.10.2026):** varianta C.
- **Acum:** această procedură (B), DOAR pentru cele 20 de documente din valul 1.
- **Separat, înaintea valului 2:** protocolul general de versiune a textului (A), doar plan. Ca intrare pentru A rămâne `RECITIRE_TEXTE_SPEC.md` (v3), cu cele 3 runde de review.

**Stare:** propunere. Nimic nu se rulează până la:
- GO-urile pe procedură și pe scripturi: Copilot + Jakarinos, 2 runde;
- „da”-ul lui Răzvan pe citire;
- „da”-ul lui Răzvan, separat, pe preview-ul cu cifre, înainte de aplicare.

## 1. De ce merge o procedură simplă aici

Cele 20 de documente au, dovedit read-only (Anexa A din `RECITIRE_TEXTE_SPEC.md`, se reia la pasul 0), zero date atașate:
- zero derivate: cerințe, cantități vechi, clauze, formulare, triere, răspunsuri, `citire_noi` / `citire_ai`, snapshot-uri;
- zero proveniență, decizii B sau extrageri;
- niciun rând de gardă de ingest.

Toate sunt `procesat`. Ingest-ul sare documentele `procesat` (`ofertare-ingest-doc`, l.209), deci niciun producător nu le reia automat.

Ce rămâne de protejat:
- **producătorii manuali sau programați în timpul aplicării:** de aici fereastra de mentenanță de la §5;
- **corectitudinea textului nou:** de aici raportul și criteriile;
- **posibilitatea revenirii:** arhiva și scriptul invers.

**Riscul acceptat explicit de Răzvan:** un scriitor necunoscut chiar în minutele ferestrei. Îl reduc CAS-ul pe document, verificarea după 24h și revenirea.

## 2. Documentele (grupurile A + B; 505 pagini)

- **lic. 3:** 137, 138, 139;
- **lic. 5:** 165, 166, 167, 168, 169, 170, 171;
- **lic. 15:** 212, 213 (213 are `pagina_offset = 104`);
- **lic. 93:** 434;
- **lic. 103:** 1288–1294.

Copiile din lic. 103 se citesc și ele cu AI, la fel ca restul, ~120 de pagini, ~0,08 USD. Așa nu e nevoie de nicio logică de refolosire, iar costul total rămâne sub plafon.

Grupul C (1605–1611) e exclus.

## 3. Pasul 1 — citirea în staging (plătită; cu „da”-ul lui Răzvan pe citire)

**Unealta:** funcția edge `ofertare-citire-test`, laboratorul de citire, DEJA deployată, folosită pe 15.10 pentru proba Haiku 5.5.
- Citește PDF-ul din Storage cu promptul și regula de tabel ale ingest-ului de producție (`_shared/transcriereTabel.ts`).
- Folosește modelul `claude-haiku-5-5`, `max_tokens` 12 000 și `thinking` dezactivat.
- Scrie fiecare felie în `ofertare_citire_test`: textul, tokenii, costul, eroarea.
- **Nu atinge `ofertare_documente_atribuire`.** Fiecare apel ajunge și în `ai_usage_log` (`ofertare-citire-test`).

**Pilotul:** `scripts/recitire_val1/citeste.ts` (Deno). Îl rulează chat-ul pe serverul AI, cu sesiunea contului `claudetest@` (admin Ofertare). Credențialele vin din mediu și nu se scriu nicăieri.
- **Ordinea:** documentele de la §2, cu 212 și 213 întâi; secvențial, câte UN apel pe invocare (`apeluri: 1`), cu felii de 8 pagini.
- **Felie trunchiată** (`trunchiat la max_tokens`) **sau refuzată:** aceeași porțiune se reia cu felia înjumătățită (4 → 2 → 1). O pagină care eșuează și la felia 1 rămâne cu eroare; documentul nu va trece criteriile (§4).
- **Oprirea dură la 0,80 USD**, cu o limită matematică, nu cu o estimare:
  - Înaintea fiecărei invocări, pilotul citește din BD consumul rulării: suma `cost_usd` din `ofertare_citire_test`, pentru documentele valului, de la `T0`, momentul pornirii.
  - Pornește invocarea numai dacă **consum + 0,15 ≤ 0,80**.
  - 0,15 USD e plafonul unui singur apel în cazul cel mai rău: fereastra de context de 200k tokeni × 0,50 USD/M la treapta de sus = 0,10, plus 12 000 tokeni × 2,50 USD/M = 0,03.
  - Invocările sunt secvențiale, iar pilotul e singurul apelant, deci totalul nu poate depăși 0,80 USD.
  - Costul așteptat e ~0,33 USD (~0,005 USD pe 8 pagini în laborator, 505 pagini).
- **Ce scoate:** `rulare.json`, cu `T0` și, pentru fiecare document, lista exactă a id-urilor din `ofertare_citire_test` folosite (feliile reușite care acoperă documentul), plus consumul.

**Notă de securitate (descoperire, fără legătură cu procedura):** `ofertare-citire-test` cere doar acces la modulul Ofertare (`poartaOfertare`), nu și poarta pe cheltuială (owner / responsabil). Orice utilizator Ofertare poate porni apeluri plătite. De închis separat, printr-un PR mic; nu blochează această procedură.

## 4. Pasul 2 — asamblarea și raportul (local, determinist, fără AI, fără scrieri în BD)

**Unealta:** `scripts/recitire_val1/asambleaza.ts` (Deno). Citește read-only, cu `claudetest@`, rândurile din `rulare.json` și documentele, apoi:

1. **Asamblarea**, per document:
   - feliile se iau în ordinea `pagina_de_la` și trebuie să acopere EXACT 1..`pagini`, fără goluri și fără suprapuneri;
   - marcajele `⟦PAGINA N⟧` se renumerotează absolut (N + `pagina_offset`), cu aceeași funcție ca ingest-ul. `asiguraMarcaje` se mută din `ofertare-ingest-doc/index.ts` în `_shared`, fără schimbare de comportament, cu test;
   - feliile se lipesc ca în ingest (`text + '\n'`, apoi `trim()`).

   Rezultatul e `texte/<id>.txt` (UTF-8) + `sha_nou` = sha256 al textului.
2. **Raportul**, vechi față de nou, cu `_shared/cantNumar.ts`:
   - paginile așteptate, marcate, inventate (în afara intervalului sau duplicate) și lipsă;
   - `cantitati_m` (tokeni-cantitate cu UM `m`, poziție dovedită ca în PR3) și `suma_m`;
   - lungimea textului.
3. **Criteriile de aplicare:** toate feliile reușite, `pagini_lipsa = 0`, `pagini_inventate = 0`, `cantitati_m` nou ≥ vechi.
4. **Ce scoate:**
   - `manifest.json`, per document: `document_id`, `licitatie_id`, `sha_vechi`, `fisier_path`, `size_bytes`, `pagina_offset`, `meta_vechi` (`status_procesare`, `pagini_necitite`, `procesat_la`, `pagini_procesate`, `pagini_felie`), `sha_nou`, `trece`, `motive`;
   - `preview.md`, un tabel per document cu cifrele raportului.

**Preview-ul ajunge la chat, iar chat-ul îl duce lui Răzvan.** Manifestul aprobat = documentele cu `trece = true`, plus excepțiile pe care Răzvan le acceptă nominal. Fișierele de lucru stau pe server, în `C:\Users\Public\livrare\recitire_val1\`. Manifestul aprobat și preview-ul se comit în repo, ca dovadă pentru revenire.

## 5. Pasul 3 — aplicarea (un script, psql ca postgres, fereastră de mentenanță; cu „da”-ul lui Răzvan pe preview)

**Fereastra.** Chat-ul o deschide și o închide; fiecare pas e verificat:
1. dezactivează (`cron.alter_job(…, active := false)`) joburile `ofertare_ingest_worker` și `ofertare_extragere_worker`, care rulează în fiecare minut, plus toate celelalte joburi `ofertare_%` care pot rula în fereastră;
2. confirmă că nu are niciun job `ofertare_%` în curs (`cron.job_run_details`, `status = 'running'`);
3. oprește worker-ul NAS pe server și confirmă `worker_heartbeat.ultimul` mai vechi de 10 minute;
4. după aplicare, reactivează EXACT joburile dezactivate (lista se salvează la pasul 1) și repornește worker-ul.

**Scriptul** `scripts/recitire_val1/aplica.sql`:
- se rulează cu `psql -v ON_ERROR_STOP=1 -1`;
- e o singură tranzacție, totul sau nimic: un document care nu trece verificările oprește tot, se repară și se reia;
- `SET LOCAL lock_timeout = '5s'`;
- garda de identitate: `session_user = 'postgres'`, altfel `RAISE`.

Pașii:
1. `\copy` din `manifest_aprobat.csv` și din `texte/*.txt` în tabele temporare.
2. Verifică, pentru fiecare document, `sha256(text) = sha_nou` din manifest: textul aplicat e exact cel din preview.
3. Pentru fiecare document, în ordinea `(licitatie_id, document_id)`:
   - **Lock-uri:** licitația `FOR KEY SHARE`, apoi documentul `FOR NO KEY UPDATE NOWAIT`. Ordinea e cea din 31b; în fereastră nu există concurenți.
   - **CAS:**
     - `sha256(text_extras) = sha_vechi`;
     - `fisier_path`, `size_bytes`, `pagina_offset` = cele din manifest;
     - `status_procesare`, `pagini_necitite`, `procesat_la`, `pagini_procesate`, `pagini_felie` = `meta_vechi`.
     Orice diferență → `RAISE` cu numele documentului.
   - **Zero derivate, sub lock:** lista completă de la §1, plus `ofertare_doc_texte_prov`, `ofertare_cant_doc_decizii`, `ofertare_cant_extrageri` și `ofertare_ingest_garda` (rând absent sau fără lease viu). Orice abatere → `RAISE`.
   - **Arhivare:** `INSERT INTO ofertare_doc_texte (licitatie_id, sha256, text)` pentru textul VECHI și pentru cel NOU, `ON CONFLICT DO NOTHING`. Tabelul are `CHECK` pe sha.
   - **`UPDATE`** pe document: `text_extras` = textul nou, `status_procesare = 'procesat'`, `pagini_necitite = '{}'`, `pagini_procesate = pagini`, `procesat_la = clock_timestamp()`.
   - **Proveniența:** `INSERT ofertare_doc_texte_prov`, cu `origine = 'transcriere'`, producătorul `recitire-haiku-5-5`, `completitudine = 'integral'` și `constatat_la = clock_timestamp()`.
4. La final, `SELECT` de control: pentru fiecare document, sha-ul curent = `sha_nou`, iar `fn_ofertare_cb_text_valid` = `prov`. Rezultatul se salvează în `aplicare.log`.

## 6. Pasul 4 — verificarea după 24h (read-only)

`scripts/recitire_val1/verifica.sql` trebuie să găsească, pentru fiecare document:
- sha-ul curent = `sha_nou`;
- derivatele = 0, sau numai derivate create DUPĂ aplicare, pe textul nou: lista lor, cu `created_at`, de comparat cu momentul aplicării;
- o singură proveniență, cea a recitirii.

Orice abatere ajunge la chat; nimic nu se repară automat.

## 7. Revenirea (la nevoie; cu „da”-ul lui Răzvan)

`scripts/recitire_val1/revino.sql` are aceeași formă: fereastră, o tranzacție, `session_user = 'postgres'`, iar documentele se dau ca listă (toate sau o parte).

Pentru fiecare document:
- **CAS:** `sha256(text_extras) = sha_nou`, identitatea și metadatele puse la aplicare. Altfel `RAISE`.
- **Derivate:** zero derivate create după aplicare; altfel `RAISE` și decide Răzvan.
- **Restaurare:** textul vechi din `ofertare_doc_texte` (cheia `licitatie_id, sha_vechi`) și `meta_vechi` din manifestul comis în repo.
- **Proveniență:** `INSERT ofertare_doc_texte_prov` pentru `sha_vechi`, cu `origine = 'sinteza_ai'`, producătorul `revenire-recitire` și `constatat_la = clock_timestamp()`. Înghețarea alege astfel din nou textul vechi, marcat `text_indisponibil`, deci echivalent pentru B cu starea dinainte (31a l.1071).

## 8. Livrarea (PR-ul acesta)

1. Procedura, plus:
   - `scripts/recitire_val1/{citeste.ts, asambleaza.ts, aplica.sql, verifica.sql, revino.sql}`;
   - mutarea `asiguraMarcaje` în `_shared`, cu test.
2. **Testele:**
   - **Deno:**
     - asamblarea: acoperire, goluri și suprapuneri, renumerotarea la offset 104, sha;
     - raportul: pagini inventate și lipsă, `cantitati_m`;
     - pilotul: oprirea la plafon, cu un mock al BD și al edge-ului, plus înjumătățirea;
     - `asiguraMarcaje` identic cu comportamentul de azi.
   - **PG16** (harness ca la 31a/31b):
     - `aplica.sql` pe o copie sintetică: trece, apoi pică pe CAS de text / identitate / metadate, pe un derivat, pe un sha al textului diferit de manifest și cu `session_user` diferit de postgres; nimic nu e scris la eșec;
     - `revino.sql`: restaurarea și `ingheata` echivalent;
     - `verifica.sql`.
3. Review: Copilot + Jakarinos, 2 runde. Merge-ul îl face chat-ul.
4. Rularea, în ordine, fiecare cu „da”-ul lui Răzvan:
   1. pasul 0, preview-ul read-only din Anexa A, reluat (trebuie să fie tot zero);
   2. citirea;
   3. preview-ul cu cifre;
   4. fereastra și aplicarea;
   5. verificarea după 24h;
   6. proba B plătită pe lic. 15, pe sha-urile noi. Nu mai cere `text_confirmat` pe 212 / 213, pentru că proveniența e `transcriere`.

Nu se creează tabele, migrări, funcții edge noi sau joburi cron. Singura automatizare atinsă e oprirea temporară a joburilor existente, cu repornire verificată. Nota din `registru_automatizari` se scrie în aceeași sesiune.
