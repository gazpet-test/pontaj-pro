# Recitirea valului 1 (listele de cantități, Haiku 4.5 → Haiku 5.5): procedură unică, v5

**Decizia lui Răzvan (16.10.2026): varianta C.**
- Acum: această procedură (varianta B), DOAR pentru cele 20 de documente din valul 1.
- Separat, înaintea valului 2: protocolul general de versiune a textului (varianta A), doar ca plan. Intrarea pentru A rămâne `RECITIRE_TEXTE_SPEC.md` (v3).

**Stare: propunere.** Nimic nu se rulează până la:
- GO-urile pe procedură și pe scripturi (Copilot + Jakarinos, 2 runde);
- „da”-ul lui Răzvan pe citire;
- „da”-ul lui Răzvan pe preview-ul cu cifre, înainte de aplicare.

v2 = r1 (NO-GO de la ambii revieweri), cu toate observațiile închise. v3 = r2 (NO-GO, ambii), plus deciziile chat-ului din 16.10: plafonul de 1,00 USD; anunțul către utilizatori = decizia lui Răzvan. v4 = r3: Copilot 1 P1 + 1 P2, Jakarinos 3 P1. v5 = r4: Copilot GO; Jakarinos 1 P1 + 1 P2. Listele schimbărilor sunt la §10–§13.

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

**Riscul acceptat explicit de Răzvan:** un scriitor care a citit textul vechi ÎNAINTE de aplicare și salvează un derivat DUPĂ ea. Ar fi o funcție edge pornită manual din UI chiar în minutele ferestrei; blocarea tabelelor nu-l poate opri, pentru că salvează după COMMIT. Verificarea de la §6 îl DETECTEAZĂ: „nedovedit” sau „pe text depășit”. Remedierea e o decizie separată a lui Răzvan. **Revenirea prin această procedură NU e garantată în acest caz**, pentru că §7 refuză orice derivat. Tot în riscul acceptat intră o schimbare a PDF-ului în Storage chiar în minutele ferestrei de aplicare.

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
- **Citirea se face ÎN fereastra de mentenanță (§5), nu înaintea ei.**
  - Fereastra durează ~30–40 de minute: ~64 de apeluri × ~20 s, plus aplicarea.
  - Scriitorii automați ai lui `fisier_path` și ai obiectelor din Storage sunt opriți pe toată durata: importul / veghea SEAP (cron), worker-ul NAS și ingest-ul.
- **Pilotul reverifică, ÎNAINTE și DUPĂ fiecare invocare:**
  - rândul documentului: `fisier_path`, `size_bytes`, `pagina_offset`;
  - `storage.objects` (`eTag`, `size`, `updated_at`), prin API-ul Storage (`info`).
  Toate trebuie să fie egale cu prima amprentă.
- **Ce prinde verificarea:**
  - o scriere în Storage mută `updated_at`, deci A → B → A pe obiect e prins;
  - o schimbare a CĂII, chiar temporară, în interiorul unei singure invocări (A → B → A pe `fisier_path`) nu poate veni de la scriitorii automați, care sunt opriți; vine cel mult de la UI și intră în riscul acceptat (§1).
- După ultima felie, pilotul recalculează și `pdf_sha256` pe octeți. Orice diferență: documentul e aruncat (`sursa_schimbata`), iar staging-ul lui nu se folosește.
  - Orice scriere în Storage (upload, înlocuire, chiar și „B, apoi înapoi A”) mută `updated_at` înainte, deci contraexemplul A → B → A e prins. Laboratorul descarcă PDF-ul în interiorul invocării, deci între cele două verificări care o încadrează.
  - După ultima felie, pilotul recalculează și `pdf_sha256` pe octeți.
  - Orice diferență: documentul e aruncat (`sursa_schimbata`), iar staging-ul lui nu se folosește.
- **Fiecare id de staging** reținut trebuie să aibă `doc_id`-ul documentului, `model = 'claude-haiku-5-5'`, intervalul așteptat și `created_at` între cele două amprente.

### Bugetul: rezervare înaintea fiecărui apel, nu sumă după

Pilotul ține un registru persistent, `rulare.json`, pe disc, scris ÎNAINTE de fiecare apel. La o reluare se folosesc același `T0` și același registru.
- **Rezervarea:** înaintea fiecărui apel se adaugă o rezervare de **0,53 USD**. Ăsta e cel mai scump apel posibil: contextul Haiku 5.5 e de 1M tokeni × 0,50 USD/M (treapta de sus) = 0,50, plus 12 000 tokeni de ieșire × 2,50 USD/M = 0,03.
- **Apelul pleacă numai dacă** suma rezervărilor deschise + costurile confirmate + 0,53 ≤ **plafonul dur**.
- **Confirmarea costului:** rezervarea se înlocuiește cu costul real numai dacă rândul din `ofertare_citire_test` există, cu `tokens_in` / `tokens_out` / `cost_usd` corecte, și există și rândul din `ai_usage_log`. Pilotul le citește din BD; nu se bazează pe `ok: true` din răspuns.
- **Fără confirmare** (timeout, eroare de rețea, rând lipsă): rezervarea de 0,53 RĂMÂNE, iar **rularea se oprește** până decide chat-ul.
- **Monitorizare:** înainte și după fiecare apel, pilotul numără rândurile `ofertare-citire-test` din `ai_usage_log` de la `T0`. Un rând care nu e al lui înseamnă că cineva a pornit laboratorul în paralel: rularea se oprește.
- **Plafonul dur: 1,00 USD.** E decizia chat-ului / a lui Răzvan, 16.10, cu varianta C. Cu rezervarea de 0,53 rămân 0,47 USD utilizabili. Costul așteptat e ~0,33 USD (~0,005 USD pe 8 pagini în laborator).
- **Invariant:** o invocare = cel mult UN apel AI. Pilotul trimite `apeluri: 1`, iar laboratorul limitează la `apeluri` (`index.ts` l.63, l.76). Testul din pilot numără rândurile noi din `ai_usage_log` după fiecare invocare: mai mult de 1 → oprire.

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
- Rezultă `texte.csv` (`document_id`, textul în base64, ca `py` să nu interpreteze nimic) și `sha_nou`.

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

**Manifestul APROBAT** (`manifest_aprobat.csv`) conține, per document: `integritate_ok`, `calitate_ok`, `calitate_acceptata_nominal`, plus motivul acceptării.
- Intră doar documentele cu `integritate_ok = true` și (`calitate_ok` sau `calitate_acceptata_nominal`).
- Manifestul și `preview.md` se comit în repo, iar „da”-ul lui Răzvan citează **commit-ul și sha256-ul lui `manifest_aprobat.csv`**.
- `aplica.sql` primește acest sha256 ca variabilă (`-v manifest_sha256=…`) și îl verifică ÎNAINTE de orice mutație (§5).

## 5. Pasul 3: aplicarea (un script, psql ca postgres, fereastră de mentenanță, cu „da”-ul lui Răzvan pe preview)

### Fereastra

Scriptul `fereastra.ts deschide|inchide <dir>` e idempotent (implementarea: Deno; are nevoie de fișierul de stare, de reluări și de așteptări).

**Deschiderea:**
1. Starea inițială se salvează O SINGURĂ DATĂ pe fereastră, în `fereastra_stare.json`, care conține run-id, `stare = OPEN`, joburile cu `active` și starea worker-ului NAS (pornit sau oprit).
   - O a doua deschidere găsește fișierul `OPEN` și îl REFOLOSEȘTE, fără să-l suprascrie. Nu se pierde starea originală (test: deschide → deschide → închide).
2. **Joburile de oprit:**
   - **Allowlist explicit**, adică joburile cunoscute care pot atinge documentele sau tabelele §2.1, verificate pe 16.10: `ofertare_ingest_worker`, `ofertare_extragere_worker`, `ofertare_seap_veghe_0520`, `ofertare_seap_veghe_1250`, `ofertare_radar_0500`, `ofertare_radar_1230`, `ofertare_raport_zilnic_0430`, `ofertare_alerte_0540`, `ofertare_alerte_1310`, `ofertare_alerte_atentie_0630`, `ofertare_alerta_pagini_goale_0615`, `ofertare_clarificari_reminder_0600`, `ofertare_participari_sapt`.
   - Plus orice job a cărui comandă conține `ofertare`.
   - Scriptul refuză dacă un job din allowlist lipsește (redenumit) sau nu e inactiv după pas.
   - Joburile necunoscute, a căror comandă nu menționează Ofertare (de exemplu un dispatcher generic), rămân în riscul acceptat.
3. **Golirea activității asincrone:** `net.http_post` e asincron. O cerere poate fi deja scoasă din coadă și să ruleze, fără răspuns încă. Durata maximă a unei funcții edge pe planul plătit e de 400 s; timeout-ul HTTP de 150 s e distinct.
   - **Condiția:** se notează `T_stop`, momentul în care toți producătorii sunt opriți (joburile + worker-ul NAS). Apoi se notează `T_gol`, primul moment ≥ `T_stop` în care coada `net.http_request_queue` (DOAR cererile spre `/functions/v1/ofertare-*`; joburile altor module țin coada globală mereu ocupată, 16.10) e goală.
   - Nimic nu pornește (nici citirea, nici aplicarea) înainte de **`T_gol` + 15 minute**, iar la acel moment coada e tot goală.
     - Cererile scoase din coadă înainte de `T_gol` rulează cel mult 400 s.
     - O funcție pornită astfel care lansează la rândul ei alta prin HTTP (lanțul concret `ofertare-seap-veghe` → `ofertare-seap-import`, `ofertare-seap-veghe/index.ts` l.371), cu un apel ocolind `pg_net`, se termină cel mult la 2 × 400 s = 13,3 minute. Asta acoperă un lanț pe două niveluri; 15 minute lasă marjă.
   - **Suplimentar, pentru lanțul SEAP:**
     - fereastra NU se deschide la mai puțin de 30 de minute după programările `ofertare_seap_veghe_0520` / `_1250`, iar ultima lor rulare (`cron.job_run_details.end_time`) trebuie să fie mai veche de 30 de minute;
     - în fereastră nu există apel manual de import SEAP (decizia lui Răzvan, cu anunțul de la pct. 6).
   - Lanțurile mai lungi de 2 niveluri, necunoscute azi, rămân în riscul acceptat.
   - Așteptarea e măsurată de la `T_gol` și NU se deduce din ultimul răspuns.
   - Teste:
     - o cerere scoasă din coadă la `T_stop` + 7 minute, fără răspuns → nimic nu pornește înainte de `T_gol` + 15 minute;
     - simularea veghe → import → nimic nu pornește înainte de terminarea lanțului.
4. Confirmă că nu există job în curs (`cron.job_run_details`, `status = 'running'`).
5. Worker-ul NAS e oprit pe server; se confirmă `worker_heartbeat.ultimul` mai vechi de 10 minute (≥ 400 s). Starea inițială (pornit / oprit) e în `fereastra_stare.json`.
6. **Utilizatorii.** Anunțul către utilizatori NU e un pas al procedurii și NU îl trimite nicio sesiune Claude: nici mesaj, nici mail. Decide Răzvan dacă, cum și cui anunță, sau alege o fereastră în care nu lucrează nimeni în Ofertare (de exemplu seara). Chat-ul îi duce întrebarea.

**Închiderea** reactivează EXACT joburile care erau active în `fereastra_stare.json` și repornește worker-ul NAS dacă era pornit, cu verificarea heartbeat-ului proaspăt.
- **Se rulează IMEDIAT la ORICE oprire după deschidere**, nu doar după aplicare:
  - eroare sau oprire a pilotului (cost neconfirmat, apel străin, plafon, `sursa_schimbata`);
  - eroare la asamblare;
  - un „da” pe preview care întârzie;
  - aplicare eșuată.
  Pilotul și scripturile se termină cu un cod distinct, iar `README.md` cere `fereastra.ts inchide` ca prim pas la orice cod ≠ 0. Joburile nu rămân oprite cât se așteaptă o decizie. Reluarea = o fereastră nouă, cu toate verificările din nou.
- Test: timeout cu cost neconfirmat în citire → închiderea readuce exact starea inițială.
- Se rulează și după o aplicare eșuată.
- E verificată prin `SELECT`, apoi marchează fișierul `CLOSED`.

### Scriptul `aplica.sql`

Se rulează cu `psql -v ON_ERROR_STOP=1 -1`. E o singură tranzacție, totul sau nimic.

1. **Gărzi (înainte de orice mutație):**
   - `sha256` al conținutului `manifest_aprobat.csv`, încărcat linie cu linie în ordine, = `:manifest_sha256` (cel din „da”). Altfel `RAISE`.
   - `session_user = 'postgres'`;
   - `SET LOCAL lock_timeout = '5s'`;
   - `\copy` în tabele temporare pentru `manifest_aprobat.csv` (o dată ca linii brute, pentru sha256, și o dată tipizat) și `texte.csv`;
   - contractul de intrare, cu `RAISE` la orice abatere:
     - id-urile ⊆ whitelist și unice;
     - pentru fiecare rând, `integritate_ok = true` și (`calitate_ok` sau `calitate_acceptata_nominal` cu motiv);
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
   - proveniența: `INSERT ofertare_doc_texte_prov`, cu `origine = 'transcriere'`, producător `recitire-haiku-5-5`, `completitudine = 'integral'` (integritatea a trecut), `constatat_la = greatest(clock_timestamp(), max(constatat_la al documentului) + 1 µs)`, luat sub lock; `RETURNING id` → `prov_id`.
4. **Postcondiții, cu `RAISE`, nu doar `SELECT`:**
   - pentru fiecare document, sha-ul curent = `sha_nou`;
   - `fn_ofertare_cb_text_valid` → `{tip: 'prov', id: prov_id}`;
   - exact 20 de documente (sau câte are manifestul) modificate.
5. **Rezultatul NU se exportă din tranzacția de mutație.**
   - Exportul dintr-o tranzacție încă deschisă ar putea exista chiar dacă COMMIT-ul eșuează.
   - **În** tranzacție, valorile EXACTE din `RETURNING` (`sha_nou`, `meta_aplicat`, `prov_id`, `constatat_la`) se scriu, prin `\copy`, în `aplicare_provizoriu.csv`. Fișierul e PROVIZORIU: nu e referință cât timp COMMIT-ul nu e confirmat.
   - După COMMIT confirmat (exit 0), rulează `aplica_rezultat.sql`, read-only. El recitește din BD și VERIFICĂ, cu `RAISE`, că sha-ul, metadatele și proveniența sunt EGALE cu cele din `aplicare_provizoriu.csv`. Nu le redefinește.
   - Dacă verificarea trece, fișierul provizoriu devine `aplicare_rezultat.csv`, cu aceleași valori.
   - Dacă nu trece, un scriitor a modificat ceva între COMMIT și verificare: e raportat lui Răzvan și NU devine referință. Test: o modificare doar de metadate între COMMIT și export → eșec.
   - Abia acest fișier se comite în repo și e referința CAS a revenirii.

## 6. Pasul 4: verificarea după 24h (read-only)

`scripts/recitire_val1/verifica.sql`, pentru fiecare document:
- sha-ul curent = `sha_nou`, iar metadatele = `meta_aplicat`;
- o singură proveniență: `prov_id`;
- **derivatele (§2.1):**
  - zero → OK;
  - orice rând cu versiunea sursei (sha) egală cu `sha_nou` → OK „pe textul nou”;
  - orice rând cu versiunea sursei DIFERITĂ de `sha_nou` → **„derivat pe text depășit”**. Verificarea EȘUEAZĂ (exit ≠ 0) și raportul merge la Răzvan;
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
2. **Proveniență, derivate, decizii:**
   - proveniența documentului trebuie să fie EXACT {`prov_id` din `aplicare_rezultat.csv`};
   - orice altă proveniență, orice decizie, extragere sau derivat (§2.1), fără filtru temporal → `RAISE`, iar decide Răzvan.
3. **Restaurarea:** textul vechi din `ofertare_doc_texte` (`licitatie_id`, `sha_vechi`) și `meta_vechi` din manifestul comis.
4. **Proveniența** `sinteza_ai` / `revenire-recitire` pe `sha_vechi`, cu `constatat_la = greatest(clock_timestamp(), max(constatat_la al documentului) + 1 µs)` sub lock.
   - **Postcondiție cu `RAISE`:** ultima proveniență a documentului (aceeași ordonare ca în `fn_ofertare_cb_ingheata`: `constatat_la DESC, id DESC`) are `sha_vechi`, iar `fn_ofertare_cb_text_valid(lic, doc, sha_vechi) = '{}'`.
   - Înghețarea alege deci din nou textul vechi, ca `text_indisponibil`, echivalent pentru B.
   - NU se apelează `fn_ofertare_cb_ingheata`: ar scrie un snapshot.
5. Rezultatul se exportă DUPĂ COMMIT, read-only, prin `revino_rezultat.sql` → `revenire_rezultat.csv`, cu aceeași regulă ca la §5.

## 8. Livrarea (PR-ul acesta)

### Scripturile

`scripts/recitire_val1/`:
- `citeste.ts`, `asambleaza.ts`;
- `fereastra.ts`, `pas0.sql`, `derivate.sql` (lista §2.1, ca funcție TEMPORARĂ `pg_temp`, fără obiecte noi în BD);
- `aplica.sql` + `aplica_rezultat.sql` (read-only, după COMMIT), `verifica.sql`, `revino.sql` + `revino_rezultat.sql`;
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
2. Fereastra se deschide (seara sau când decide Răzvan), apoi citirea în fereastră.
3. Preview-ul cu cifre.
4. Aplicarea, în ACEEAȘI fereastră, după „da”-ul lui Răzvan pe preview, apoi închiderea ferestrei.
   - Dacă „da”-ul întârzie, fereastra se închide după citire și se redeschide pentru aplicare, cu toate verificările din nou.
   - CAS-ul pe Storage și pe identitate rămâne obligatoriu.
5. Verificarea după 24h.
6. Proba B plătită pe lic. 15, pe sha-urile noi.

### Ce nu creează

Nu se creează tabele, migrări, funcții edge sau joburi. Nota din `registru_automatizari` (oprirea temporară a joburilor) se scrie în aceeași sesiune.

**Separat:** `ofertare-citire-test` are doar poarta de acces Ofertare, nu și poarta pe cheltuială. Se închide printr-un PR mic, după valul 1. Până atunci, monitorizarea pilotului (§3) oprește rularea dacă apar apeluri străine.

## 9. Decizii luate

- **Plafonul dur al citirii: 1,00 USD**, cu rezervarea de 0,53 pe apel (chat-ul, pe aprobarea lui Răzvan din 16.10).
- **Anunțul către utilizatori** pentru fereastră: decizia lui Răzvan, nu un pas automat.

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
| Fereastra care nu se poate restaura (Copilot P2) | `fereastra_stare.json` salvat întâi; închiderea idempotentă, rulată și după eșec |
| Endpoint fără poartă pe cheltuială (Copilot P2) | Monitorizare + oprire în pilot; PR separat |

## 11. Schimbări v2 → v3 (review r2)

| Observație | Rezolvare |
|---|---|
| Revenirea se autorefuza pe proveniența aplicării (Jakarinos #1, Copilot P1) | Se cere EXACT `prov_id`; orice altă proveniență / decizie / derivat → refuz. Riscul de la §1 e reformulat: revenirea nu e garantată după un derivat întârziat. |
| Feliile nelegate de octeții citiți, A → B → A (Jakarinos #2) | `updated_at` / `eTag` / `size` din Storage, verificate înainte și după FIECARE invocare; o scriere mută `updated_at`. |
| Golirea `pg_net`, limita de 400 s (Jakarinos #3) | Coada goală + nicio cerere spre Ofertare în ultimele 8 minute; heartbeat NAS ≥ 10 minute. |
| Starea ferestrei suprascrisă la redeschidere (Jakarinos #4, Copilot P2) | `fereastra_stare.json` creat o singură dată (`OPEN` → `CLOSED`), refolosit la reluare; testul deschide → deschide → închide. |
| Worker-ul NAS nerepornit (Jakarinos #5) | Starea lui inițială salvată; închiderea îl repornește și verifică heartbeat-ul. |
| Derivat cu sha-ul sursei greșit la 24h (Jakarinos #6) | Clasa „pe text depășit” → verificarea eșuează. |
| Export înainte de COMMIT (Copilot P1) | Export read-only separat, după COMMIT confirmat, recitit din BD (`aplica_rezultat.sql`, `revino_rezultat.sql`). |
| Aplicarea nelegată de preview, integritatea neimpusă în SQL (Copilot P1) | Câmpurile `integritate_ok` / `calitate_*` în manifest, verificate în SQL; sha256 al manifestului din „da” verificat înainte de mutații. |
| Ordonarea provenienței la revenire (Copilot P2) | `greatest(clock_timestamp(), max + 1 µs)` sub lock (și la aplicare); postcondiția cu `RAISE` pe ultima proveniență + text nevalid. |
| Plafonul / anunțul (chat 16.10) | 1,00 USD; anunțul = decizia lui Răzvan. |

## 12. Schimbări v3 → v4 (review r3)

| Observație | Rezolvare |
|---|---|
| Golirea `pg_net`: o cerere scoasă din coadă e încă în zbor (Copilot P1, Jakarinos #1) | `T_stop` + 8 minute, măsurat de la oprire, plus coada goală; nu se mai deduce din ultimul răspuns; test dedicat |
| Laboratorul recitește `fisier_path`, deci o schimbare temporară a căii nu se vede (Jakarinos #2) | Citirea se face în fereastră (scriitorii automați ai căii și ai Storage-ului opriți); `fisier_path`, `size_bytes`, `pagina_offset` și Storage verificate înainte și după fiecare invocare; restul (UI) intră în riscul acceptat |
| Exportul după COMMIT poate prelua o modificare ulterioară drept reper (Jakarinos #3) | `RETURNING` → `aplicare_provizoriu.csv` în tranzacție; după COMMIT, `aplica_rezultat.sql` verifică egalitatea, fără să redefinească; altfel nu devine referință |
| Selecția joburilor după comandă (Copilot P2) | Allowlist explicit al joburilor cunoscute, plus comanda; refuz dacă un job din allowlist lipsește sau a rămas activ |

## 13. Schimbări v4 → v5 (review r4)

| Observație | Rezolvare |
|---|---|
| Golirea: cerere scoasă târziu din coadă; lanțul veghe → import care ocolește `pg_net` (Jakarinos P1) | `T_gol` + 15 minute (2 niveluri × 400 s + marjă), cu coada goală la final; fereastra la ≥ 30 de minute după rularea veghei SEAP; fără import manual în fereastră; teste dedicate; lanțurile mai lungi intră în riscul acceptat |
| Închiderea ferestrei la eșec în citire / asamblare (Jakarinos P2) | Închidere imediată la orice cod ≠ 0 după deschidere, inclusiv la așteptarea unei decizii; test pe cazul de timeout |

