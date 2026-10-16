# Recitirea valului 1 (listele de cantități, Haiku 4.5 → Haiku 5.5): procedură unică, v2

**Decizia lui Răzvan (16.10.2026): varianta C.**
- Acum: această procedură (varianta B), DOAR pentru cele 20 de documente din valul 1.
- Separat, înaintea valului 2: protocolul general de versiune a textului (varianta A), doar ca plan. Intrarea pentru A rămâne `RECITIRE_TEXTE_SPEC.md` (v3).

**Stare: propunere.** Nimic nu se rulează până la:
- GO-urile pe procedură și pe scripturi (Copilot + Jakarinos, 2 runde);
- „da”-ul lui Răzvan pe citire;
- „da”-ul lui Răzvan pe preview-ul cu cifre, înainte de aplicare.

v2 = r1 (NO-GO de la ambii revieweri), cu toate observațiile închise; lista e la §10.

## 1. De ce merge aici o procedură simplă

Cele 20 de documente au fost verificate read-only (Anexa A din `RECITIRE_TEXTE_SPEC.md`, completată la §2.1). Verificarea se reia la pasul 0. Toate au zero la:
- derivate: cerințe, F3 vechi, clauze, formulare, triere, răspunsuri, `citire_noi` / `citire_ai`, snapshot-uri;
- proveniență și decizii B;
- extrageri și gardă de ingest.

Toate sunt `procesat`, iar ingest-ul le sare (`ofertare-ingest-doc`, l.209). Ce rămâne de protejat:
- scriitorii care pot lovi în timpul aplicării: §5 (blocarea tabelelor + fereastra de mentenanță);
- corectitudinea textului nou: §4 (criteriile de integritate);
- legătura textului cu PDF-ul citit: §3, §5;
- revenirea: §7.

**Riscul acceptat explicit de Răzvan:** un scriitor care a citit textul vechi ÎNAINTE de aplicare și salvează un derivat DUPĂ ea. Ar fi o funcție edge pornită manual din UI chiar în minutele ferestrei. Blocarea tabelelor nu-l poate opri, pentru că salvează după COMMIT. Verificarea de la §6 îl scoate la vedere ca „proveniență nedovedită”, iar revenirea rămâne posibilă.

## 2. Documentele

Valul are 20 de documente, 505 pagini.

| Licitație | Documente |
|---|---|
| 3 | 137, 138, 139 |
| 5 | 165, 166, 167, 168, 169, 170, 171 |
| 15 | 212, 213 (213 are `pagina_offset = 104`) |
| 93 | 434 |
| 103 | 1288–1294 |

- Copiile din lic. 103 se citesc și ele cu AI: ~120 de pagini, fără logică de refolosire.
- Grupul C (1605–1611) e exclus.
- Lista celor 20 de id-uri e scrisă DIRECT (whitelist) în fiecare script.

### 2.1 Lista derivatelor verificate (aceeași în preview, aplicare, verificare, revenire)

- `ofertare_cerinte` (`sursa_document_id`, `surse_document_ids`)
- `ofertare_cantitati` (`surse_document_ids`)
- `ofertare_clauze_contract` (`document_id`)
- **`ofertare_formulare_registru` (`document_sursa_id`)** — lipsea din Anexa A, adăugat acum
- `ofertare_triere` (`doc_id`)
- `ofertare_raspuns_set_doc` (`document_id`)
- `ofertare_analiza_versiuni.doc_manifest`
- `analiza ? 'citire_noi' | 'citire_ai'` pe rândul documentului
- `ofertare_doc_texte_prov`
- `ofertare_cant_doc_decizii`
- `ofertare_cant_extrageri`
- `ofertare_ingest_garda`

## 3. Pasul 1: citirea în staging (plătită, cu „da”-ul lui Răzvan pe citire)

### Unealta

Funcția edge `ofertare-citire-test` (laboratorul), DEJA deployată.
- Citește PDF-ul din Storage cu promptul și regula de tabel ale ingest-ului: `claude-haiku-5-5`, `max_tokens` 12 000, `thinking` dezactivat.
- Scrie fiecare felie în `ofertare_citire_test` (text, tokeni, cost, eroare) și în `ai_usage_log`.
- **Nu atinge documentele.**

### Pilotul

`scripts/recitire_val1/citeste.ts` (Deno). Îl rulează chat-ul pe serverul AI, cu sesiunea `claudetest@`; credențialele vin din mediu și nu se scriu nicăieri.
- Lucrează secvențial, cu UN apel pe invocare și felii de 8 pagini.
- 212 și 213 se citesc primele.

### Legătura cu PDF-ul (amprenta)

- **Înainte de PRIMA felie a unui document**, pilotul descarcă PDF-ul (Storage `ofertare` / `fisier_path`) și reține:
  - `pdf_sha256`, calculat pe octeți;
  - numărul real de pagini (pdf-lib);
  - din `storage.objects`: `eTag`, `size`, `updated_at`.
- **După ULTIMA felie**, repetă exact aceeași citire. Orice diferență: documentul e aruncat (marcat `sursa_schimbata`), iar staging-ul lui nu se folosește.
- **Fiecare id de staging** reținut trebuie să aibă `doc_id`-ul documentului, `model = 'claude-haiku-5-5'`, intervalul așteptat și `created_at` între cele două amprente.

### Bugetul: rezervare înaintea fiecărui apel, nu sumă după

Pilotul ține un registru persistent, `rulare.json`, pe disc, scris ÎNAINTE de fiecare apel. La o reluare se folosesc același `T0` și același registru.
- **Rezervarea:** înaintea fiecărui apel se adaugă o rezervare de **0,53 USD**. Ăsta e cel mai scump apel posibil: contextul Haiku 5.5 e de 1M tokeni × 0,50 USD/M (treapta de sus) = 0,50, plus 12 000 tokeni de ieșire × 2,50 USD/M = 0,03.
- **Apelul pleacă numai dacă** suma rezervărilor deschise + costurile confirmate + 0,53 ≤ **plafonul dur**.
- **Confirmarea costului:** rezervarea se înlocuiește cu costul real numai dacă rândul din `ofertare_citire_test` există, cu `tokens_in` / `tokens_out` / `cost_usd` corecte, și există și rândul din `ai_usage_log`. Pilotul le citește din BD; nu se bazează pe `ok: true` din răspuns.
- **Fără confirmare** (timeout, eroare de rețea, rând lipsă): rezervarea de 0,53 RĂMÂNE, iar **rularea se oprește** până decide chat-ul.
- **Monitorizare:** înainte și după fiecare apel, pilotul numără rândurile `ofertare-citire-test` din `ai_usage_log` de la `T0`. Un rând care nu e al lui înseamnă că cineva a pornit laboratorul în paralel: rularea se oprește.
- **Plafonul dur e de decis de Răzvan** (vezi §9). Cu rezervarea de 0,53, un plafon de 0,80 lasă doar 0,27 USD utilizabili, iar costul așteptat e ~0,33 USD (~0,005 USD pe 8 pagini în laborator). **Propun plafon dur 1,00 USD**, adică 0,47 utilizabili, cât acceptase chat-ul inițial. Costul real rămâne ~0,33.

### Felii eșuate

O felie trunchiată (`trunchiat la max_tokens`) sau refuzată se reia cu felia înjumătățită: 4 → 2 → 1. O pagină care eșuează și la felia de 1 → documentul NU trece integritatea (§4).

## 4. Pasul 2: asamblarea și raportul (local, determinist, fără AI, fără scrieri în BD)

Unealta e `scripts/recitire_val1/asambleaza.ts` (Deno). Citește read-only, cu `claudetest@`.

### Integritatea

Condiții OBLIGATORII; nicio excepție nu le poate trece peste:
1. Feliile acoperă EXACT 1..`pagini_pdf`, fără goluri sau suprapuneri, și toate sunt fără eroare.
2. **Marcajele brute:** fiecare felie [s+1..e] are exact marcajele `⟦PAGINA s+1⟧ … ⟦PAGINA e⟧`, o dată fiecare, în ordine. Pe asta o verifică laboratorul prin prompt.
   - NU se folosește `asiguraMarcaje`, care ar repara secvențial: de exemplu `1,1` ar deveni `105,106`.
   - O felie cu marcaje lipsă, duplicate sau în afara intervalului → documentul nu trece.
3. `pagini_pdf` = `pagini` din BD, iar amprenta PDF e neschimbată (§3).

### Asamblarea

- Renumerotarea e strictă: `N` → `N + pagina_offset`. Pentru 213 rezultă exact 105..176.
- Feliile se lipesc ca în ingest: `text + '\n'`, apoi `trim()`.
- Rezultă `texte/<id>.txt` și `sha_nou`.

### Raportul (vechi / nou)

- Marcajele brute și pe cele normalizate, separat.
- Paginile inventate și lipsă.
- `cantitati_m` și `suma_m`, cu `_shared/cantNumar.ts`. Convenția numerică (`conventieDocument`) se calculează pe GRUPUL de părți (`radacinaParte`), deci 212 + 213 împreună, ca în producție.
- Lungimea.

### Criteriul de calitate

`cantitati_m` nou ≥ vechi. Un document care pică DOAR acest criteriu poate fi acceptat nominal de Răzvan, cu motiv. Excepția nu schimbă integritatea: proveniența rămâne `integral` doar pentru că integritatea a trecut.

`cantitati_m` nu dovedește singur valorile corecte. Pentru aceste diferențe preview-ul listează primele 20 de cantități care diferă (pagina, rândul, vechi, nou). Răzvan sau un om le poate verifica în PDF.

### Ce iese

- `manifest.json`, per document:
  - `document_id`, `licitatie_id`, `pagini`, `sha_vechi`, `sha_nou`;
  - identitatea: `fisier_path`, `size_bytes`, `pagina_offset`, `pdf_sha256`, `storage_etag`, `storage_size`, `storage_updated_at`;
  - `meta_vechi`: `status_procesare`, `pagini_necitite`, `procesat_la`, `pagini_procesate`, `pagini_felie`;
  - `integritate_ok`, `calitate_ok`, `motive`, id-urile de staging.
- `preview.md`.

Manifestul APROBAT conține documentele cu integritatea trecută și calitatea trecută (sau acceptată nominal). El și preview-ul se comit în repo.

## 5. Pasul 3: aplicarea (un script, psql ca postgres, fereastră de mentenanță, cu „da”-ul lui Răzvan pe preview)

### Fereastra

Scripturile `fereastra_deschide.sql` și `fereastra_inchide.sql` sunt idempotente.

**Deschiderea:**
1. Salvează ÎNTÂI starea tuturor joburilor cron (`jobid`, `jobname`, `active`) într-un fișier local `fereastra_stare.csv`.
2. Dezactivează, după COMANDĂ (`command ILIKE '%ofertare%'`), nu doar după prefix, tot ce atinge Ofertare. Lista se afișează și se verifică.
3. Așteaptă 5 minute: `net.http_post` e asincron, iar o funcție edge pornită înainte durează cel mult 150 s.
4. Confirmă că nu există job în curs (`cron.job_run_details`) și nici cereri `pg_net` recente fără răspuns către funcțiile Ofertare (`net.http_request_queue`).
5. Worker-ul NAS e oprit pe server; confirmă `worker_heartbeat.ultimul` mai vechi de 10 minute.
6. Utilizatorii sunt anunțați (Răzvan): fără acțiuni Ofertare în UI cât ține fereastra, cam 10 minute.

**Închiderea** reactivează EXACT joburile care erau active în `fereastra_stare.csv`. Se rulează și după o aplicare eșuată; e verificată prin `SELECT`.

### Scriptul `aplica.sql`

Se rulează cu `psql -v ON_ERROR_STOP=1 -1`. E o singură tranzacție, totul sau nimic.

1. **Gărzi:**
   - `session_user = 'postgres'`;
   - `SET LOCAL lock_timeout = '5s'`;
   - `\copy` în tabele temporare pentru `manifest_aprobat.csv` și `texte/*.txt`;
   - contractul de intrare, cu `RAISE` la orice abatere:
     - id-urile ⊆ whitelist și unice;
     - toate documentele există;
     - `licitatie_id` și `pagini` sunt egale cu manifestul;
     - `sha256(text) = sha_nou`.
2. **Blocarea tabelelor auxiliare:** `LOCK TABLE … IN SHARE MODE` pe toate tabelele de la §2.1. Ordinea e fixă, alfabetică. `storage.objects` NU se blochează: e al rolului de storage, iar `postgres` nu are dreptul. Pe Storage rămâne CAS-ul de la pasul 3, iar o schimbare a PDF-ului în minutele ferestrei intră în riscul acceptat. `SHARE` permite citirile, dar oprește orice INSERT / UPDATE / DELETE până la COMMIT. Predicatul „zero derivate” e astfel stabil în tranzacție. Un scriitor care ține deja un lock incompatibil → `lock_timeout` → totul se anulează și se reia.
3. **Per document**, în ordinea `(licitatie_id, document_id)`:
   - lock pe licitație `FOR KEY SHARE`, apoi pe document `FOR NO KEY UPDATE NOWAIT`;
   - **CAS NULL-safe** (`IS NOT DISTINCT FROM`) pe:
     - `sha256(text_extras) = sha_vechi`;
     - `fisier_path`, `size_bytes`, `pagina_offset`, `pagini`;
     - toate câmpurile din `meta_vechi`;
     - `storage.objects`: `eTag`, `size`, `updated_at` = cele din manifest.
   - zero derivate (§2.1); orice abatere → `RAISE`, cu id-ul documentului;
   - arhivarea: `INSERT INTO ofertare_doc_texte`, cu textul VECHI și cu cel NOU, `ON CONFLICT DO NOTHING`;
   - `UPDATE` pe document:
     - `text_extras` = textul nou;
     - `status_procesare = 'procesat'`;
     - `pagini_necitite = '{}'`;
     - `pagini_procesate = pagini`;
     - `procesat_la = clock_timestamp()`;
     - `RETURNING` → `meta_aplicat`.
   - proveniența: `INSERT ofertare_doc_texte_prov`, cu `origine = 'transcriere'`, producător `recitire-haiku-5-5`, `completitudine = 'integral'` (integritatea a trecut), `constatat_la = clock_timestamp()`; `RETURNING id` → `prov_id`.
4. **Postcondiții, cu `RAISE`, nu doar `SELECT`:**
   - pentru fiecare document, sha-ul curent = `sha_nou`;
   - `fn_ofertare_cb_text_valid` → `{tip: 'prov', id: prov_id}`;
   - exact 20 de documente (sau câte are manifestul) modificate.
5. **Rezultatul** e scris cu `\copy (SELECT …) TO 'aplicare_rezultat.csv'`: `document_id`, `sha_nou`, `meta_aplicat`, `prov_id`, momentul. Fișierul se comite în repo și e referința CAS a revenirii.

## 6. Pasul 4: verificarea după 24h (read-only)

`scripts/recitire_val1/verifica.sql`, pentru fiecare document:
- sha-ul curent = `sha_nou`, iar metadatele = `meta_aplicat`;
- o singură proveniență: `prov_id`;
- **derivatele (§2.1):**
  - zero → OK;
  - orice rând cu versiunea sursei (sha) egală cu `sha_nou` → OK „pe textul nou”;
  - orice rând fără versiune a sursei → **„proveniență nedovedită”**, listat pentru Răzvan, indiferent de `created_at`.

Nu se repară nimic automat.

## 7. Revenirea (la nevoie, cu „da”-ul lui Răzvan)

`revino.sql` are aceeași formă: fereastră, o tranzacție, `session_user`, `LOCK TABLE`, whitelist și contract de intrare. Documentele se dau ca listă (toate sau o parte).

Per document:
1. **CAS** pe starea EXACTĂ de după aplicare, din `aplicare_rezultat.csv`:
   - `sha_nou`;
   - `meta_aplicat`, inclusiv `procesat_la`;
   - identitatea și Storage.

   Altfel `RAISE`.
2. **Zero derivate și zero decizii** pe document (§2.1), fără filtru temporal. Altfel `RAISE` și decide Răzvan.
3. **Restaurarea:** textul vechi din `ofertare_doc_texte` (`licitatie_id`, `sha_vechi`) și `meta_vechi` din manifestul comis.
4. **Proveniența** `sinteza_ai` / `revenire-recitire` pe `sha_vechi`, cu `constatat_la = clock_timestamp()`. Înghețarea alege din nou textul vechi, ca `text_indisponibil`, deci echivalent pentru B.
5. Rezultatul se scrie în `revenire_rezultat.csv`.

## 8. Livrarea (PR-ul acesta)

### Scripturile

`scripts/recitire_val1/`:
- `citeste.ts`, `asambleaza.ts`;
- `fereastra_deschide.sql`, `fereastra_inchide.sql`;
- `aplica.sql`, `verifica.sql`, `revino.sql`;
- `README.md` (ordinea pașilor).

### Teste Deno

- **Pilotul**, cu mock pentru edge și BD:
  - rezervarea de 0,53 și oprirea la plafon;
  - cost neconfirmat → rezervarea rămâne, rularea se oprește;
  - un apel străin în `ai_usage_log` → oprire;
  - reluarea cu același `T0`;
  - înjumătățirea feliei;
  - amprenta PDF schimbată → document aruncat.
- **Asamblarea:**
  - acoperire, goluri, suprapuneri;
  - marcaje brute `1,1` / lipsă / în afara intervalului → refuz;
  - 213 → exact 105..176;
  - convenția pe grupul 212 + 213;
  - sha-ul.

### Teste PG16 (harness ca la 31a / 31b)

- **`aplica.sql`:** trece pe o copie sintetică. Pică, fără să scrie nimic, pe:
  - id în afara whitelist-ului sau dublat;
  - `licitatie_id` / `pagini` diferite;
  - CAS de text / identitate / metadate / Storage;
  - un derivat (pe fiecare tabel din §2.1);
  - `sha256(text) ≠ sha_nou`;
  - `session_user` ≠ postgres.
  În plus, un INSERT concurent în `ofertare_cerinte` așteaptă lock-ul și intră DUPĂ COMMIT.
- **`fereastra_*`:** idempotență; închiderea după o aplicare eșuată readuce exact starea.
- **`revino.sql`:** CAS pe `meta_aplicat`; un derivat → refuz; `ingheata` echivalent.
- **`verifica.sql`:** clasificarea „nedovedită”.

### Review și merge

Copilot + Jakarinos, 2 runde. Merge-ul îl face chat-ul.

### Rularea (fiecare pas cu „da”-ul lui Răzvan)

1. Pasul 0: preview read-only (§2.1); trebuie să iasă zero.
2. Citirea.
3. Preview-ul cu cifre.
4. Fereastra, aplicarea, închiderea ferestrei.
5. Verificarea după 24h.
6. Proba B plătită pe lic. 15, pe sha-urile noi.

### Ce nu creează

Nu se creează tabele, migrări, funcții edge sau joburi. Nota din `registru_automatizari` (oprirea temporară a joburilor) se scrie în aceeași sesiune.

**Separat:** `ofertare-citire-test` are doar poarta de acces Ofertare, nu și poarta pe cheltuială. Se închide printr-un PR mic, după valul 1. Până atunci, monitorizarea pilotului (§3) oprește rularea dacă apar apeluri străine.

## 9. Decizie cerută lui Răzvan

**Plafonul dur al citirii.** Cu rezervarea de 0,53 USD pe apel (cazul cel mai rău, demonstrat):
- **0,80 USD** lasă 0,27 utilizabili, sub costul așteptat de 0,33. Citirea s-ar opri înainte de final.
- **1,00 USD** (propus) lasă 0,47 utilizabili.

Costul real așteptat rămâne ~0,33 USD.

## 10. Schimbări v1 → v2 (review r1)

| Observație | Rezolvare |
|---|---|
| Plafonul (Jakarinos #1: 1M context, nu 200k; Copilot P1: cost necunoscut) | Rezervare persistentă 0,53 înaintea apelului; costul confirmat din BD; fără confirmare → rezervarea rămâne și rularea se oprește; monitorizarea apelurilor străine; plafonul supus deciziei (§9) |
| Producătorii UI / API care nu sunt opriți (Jakarinos #2, Copilot P1 derivate) | `LOCK TABLE … IN SHARE MODE` pe toate tabelele §2.1; cron-urile oprite după comandă; așteptare pentru `pg_net`; anunț către utilizatori. Riscul rămas e numit explicit la §1. |
| Identitatea PDF (Jakarinos #3, Copilot P1) | `pdf_sha256` + `storage.objects` (`eTag`, `size`, `updated_at`) înainte și după citire; CAS pe Storage în `aplica.sql`; id-urile de staging verificate |
| Excepții declarate fals „integral” (Jakarinos #4) | Integritatea e obligatorie, fără excepții; excepția acoperă doar criteriul de calitate |
| Verificarea temporală la 24h (Jakarinos #5) | Clasificarea „nedovedită”; revenirea cere zero derivate, fără filtru temporal |
| CAS-ul revenirii pe `procesat_la` (Jakarinos #6, Copilot P1) | `RETURNING` → `aplicare_rezultat.csv` (`meta_aplicat`, `prov_id`), comis în repo |
| Marcajele reparate de `asiguraMarcaje` (Jakarinos #7) | Marcajele brute stricte, fără reparare; raport separat brut / normalizat; convenția pe grupul 212 + 213; listarea diferențelor pentru verificare umană |
| Contractul SQL (Jakarinos #8) | Whitelist, unicitate, existență, `licitatie_id` / `pagini`, NULL-safe, postcondiții cu `RAISE`; `formulare_registru` adăugat |
| Fereastra care nu se poate restaura (Copilot P2) | `fereastra_stare.csv` salvat întâi; închiderea idempotentă, rulată și după eșec |
| Endpoint fără poartă pe cheltuială (Copilot P2) | Monitorizare + oprire în pilot; PR separat |
