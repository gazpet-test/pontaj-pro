# R6 — doc 770 (Huedin, lic. 101): citirea PDF-urilor peste 60 MB pe worker

Ramura `claude/r6-770-pdf-mare`, worktree `wf_fa1bc031-690-2`. Runda 1: commit `3632155` (calea nouă). Runda 2: commit
`c2f61b5` (fix-urile cerute de verificator). Runda 3 (finisaje după reverificare): 504 fără cost AI dublu (§3.1), gărzile din
SQL (§10), o formulare din §8. Nu am scris nimic în BD (doar SELECT-uri). Nu am făcut push și nu am deschis PR.

## 1. Pe scurt
- Workerul de pe NAS citește acum singur PDF-urile peste 60 MB. Descarcă în flux pe disc, apoi scoate textul cu
  `pdftotext` pe felii. Nu folosește AI pe pagini și nu trece prin edge.
- Cauza reală a buclei de pe 770 e reparată (runda 2). Workerul număra drept „citit” un răspuns de eroare al platformei.
- Pe drumul AI (scanuri sub 60 MB), un 504 nu mai poate dubla costul AI pe aceeași felie (runda 3, §3.1): `{apeluri:1}` și,
  după un răspuns neclar, reîncercare abia după limita de 400 s a edge-ului, cu progresul luat din BD.
- Rezultatul așteptat pe 770 este probabil **`partial`, cu multe `pagini_necitite`** (pagini scanate), nu „citit complet”.
  Închiderea R6 cere, foarte probabil, și decizia separată de **OCR plătit** pe paginile necitite (§8).
- Repunerea în coadă e un SQL propus, **neexecutat** (§10). Are gardă pe commit-ul workerului și rollback pe document.

## 2. Starea de azi (SELECT, 25.09.2026, 21:30–21:40 UTC)

**Doc 770** („Documentatie tehnica HUEDIN Lot 1/Studiu geotehnic__Transgaz+Anexe.pdf”, `tip=alta`):
- `status_procesare='ignorat'`, `size_bytes=99948369` (95,3 MiB);
- `eroare` = „prea mare pentru citirea automată (95 MB > 60 MB) — de spart pe bucăți / procesat pe NAS”;
- `pagini=NULL`, `pagini_procesate=0`, `pagini_necitite={}`, `text_extras=NULL`, `analiza=NULL`, `antet={}`, `ocr=false`;
- `procesat_la=2026-09-25 16:10:25.472+00`;
- `ofertare_doc_de_citit(...)=true`.

**Manifest SEAP**: `ofertare_seap_manifest` id 378, `sha256=b003d340…d43d`, `marime=99948369`, `stare=deja_in_platforma`.

**Coada lic. 101**:
- `activ=false`, `lansari=8234`, `terminat_la=2026-09-25 16:10:32.447+00`;
- `nota` = „221 procesate, 13 parțiale, 0 cu eroare/epuizate (worker NAS: 5421 citite acum, 0 eșuate)”.

**Alte date:**
- `ofertare_ingest_lansari` pentru 770: `incercari=4`. Tick-ul din Supabase (`MAX_INCERCARI=4`) nu-l mai lansează. Oricum
  nu lansează nimic cât heartbeat-ul workerului e sub 10 min.
- Worker: `worker_heartbeat.detalii->>'sha'='8a6fbbb'` (cod **vechi**), heartbeat vechi de 25 s, `in_lucru=[]`.
- `ai_usage_log` pentru 770: **0 rânduri**. Edge-ul murea înainte de apelul AI, deci bucla n-a costat bani pe AI.
- Pe tot BD, pe drumul nou intră **doar 770**. Singurul alt PDF de peste 60 MB necitit este doc 235 (lic. 86,
  78.520.702 B, `neprocesat`). Acela e `tip=plansa`, deci `ofertare_doc_de_citit=false`, și nu e candidat.

## 3. De ce bucla: mecanismul și cauza reală
1. Codul vechi (`8a6fbbb`, `ingest.ts` l.104–109) descărca 770 întreg în memorie și îl scria în `/tmp`. Apoi rula
   `textLocal`. Dacă `pdfinfo`/`pdftotext` eșuau, sau sub 85% din pagini aveau ≥120 de caractere, trimitea la `citesteCuAI`
   (edge `ofertare-ingest-doc`).
2. Edge-ul punea 770 `in_lucru` și murea („Memory limit exceeded”). Platforma răspundea 546 `{code:'WORKER_LIMIT',message}`,
   **fără câmpul `error`**.
3. **Cauza reală:** `citesteCuAI` trata ca eroare doar `!data || data.error`. Răspunsul 546 trecea drept
   „gata (?/? pagini, AI)”, apoi urma `citite++`. Documentul rămânea `in_lucru`, deci tot candidat, și era reluat:
   5421 de „citiri” într-o activare, la 247 de documente în licitație.
4. PR #478 a oprit bucla doar pe edge. Peste 60 MB edge-ul pune `ignorat` (`supabase/functions/ofertare-ingest-doc/index.ts`
   l.193–197). Cronologia e compatibilă: ultimul `procesat_la` al lui 770 e 16:10:25, iar coada se închide la 16:10:32.

**Reparat în runda 2** (`ingest.ts` l.77 `motivRaspunsEdge`, l.107–158 `citesteCuAI`):
- **doar `ok:true` e succes**. Edge-ul pune `ok:true` pe toate răspunsurile bune: skip-urile și felia citită.
- Orice alt răspuns e eroare, cu motivul din `error` → `message`/`code` → `(HTTP n)`: 546, 502 HTML, 504 gol, `{}`,
  eroare de rețea. Se reia de 2 ori, cu pauză, apoi documentul intră pe `eroare` cu motivul real, nu „revine în coadă…”.
- Mesajele `{error}` ale edge-ului rămân identice.
- Plasa din runda 1 (`trecereBlocata`, l.326) rămâne ca a doua linie de apărare.

### 3.1 Runda 3: un 504 nu mai dublează costul AI pe aceeași felie
**Problema** (verificatorul, runda 2: „PLAUSIBIL”). După un 504, `citesteCuAI` reîncerca la 15 s. Edge-ul însă poate lucra
mai departe: gateway-ul taie la 150 s („Request idle timeout: 150s”), iar invocarea trăiește până la limita ei de timp
(„Wall clock limit … Paid plans: 400s”, supabase.com/docs/guides/functions/limits; organizația e pe planul `pro`,
`get_organization`). Reîncercarea pornea de la același `pagini_procesate` (edge-ul îl citește la pornire și îl scrie la
final), deci citea aceeași felie a doua oară.

**Dovada că se întâmplă (loguri + BD, 25.09, doar citire):**
- `function_edge_logs` pe `ofertare-ingest-doc`, 25.09: 3 × 504, toate la ~150,1 s (150138, 150143, 150153 ms). Două
  vin din browser (Chrome, `supabase-js-web`, cu OPTIONS înainte), unul din worker (`Deno/2.9.7`, 07:13:59).
- Browserul, 504 la 07:03:16.287 (invocare pornită la 07:00:46.15): `ai_usage_log` **4500** (doc 1276, 19652 tokeni
  intrare, 0,0773 USD) e scris la **07:03:28.55, la 12 s DUPĂ 504**, fără niciun răspuns 200 pereche (singurul răspuns în
  fereastră e un 546 al workerului pe 770, de 0,86 s). Deci invocarea a continuat după 504 și și-a terminat felia.
- UI-ul reîncearcă la 5 s (`OfertareLicitatii.jsx` l.896–901): a doua invocare pornește la 07:03:21.47, **înainte** ca prima
  să-și scrie felia (07:03:28.55), deci de la același `pagini_procesate`. Rândul **4504** (doc 1276, 0,0792 USD, scris la
  07:06:05.40, 14 s după al doilea 504) e aceeași felie citită a doua oară. Tot 19652 de tokeni de intrare, ceea ce se
  potrivește; dovada e însă ordinea în timp, nu numărul de tokeni.
- Pe worker: 504-ul de la 07:13:59 și cele 6 × 520 (30–40 s, 10:16–10:51) nu au lăsat rânduri `ai_usage_log` fără pereche.
  Deci pe 25.09 costul dublu s-a produs doar pe drumul din browser. Workerul avea însă aceeași fereastră (15 s < 250 s).

**Fix (`ingest.ts`), ambele măsuri:**
1. **`{apeluri:1}`** (l.125): o felie pe invocare, ca tick-ul din Supabase (`ofertare_ingest_tick()` din BD are
   `'apeluri', 1`, verificat cu `pg_get_functiondef`) și cum cere edge-ul pentru apelurile de pe server (`index.ts`
   l.141–143: două felii de scan pot trece de 150 s). Asta face 504-ul mai rar, dar nu imposibil. Plafonul de runde crește la 240 (`RUNDE_AI`, l.104), ca să rămână capacitatea de 120 × 2 felii.
2. **Răspuns NECLAR ⇒ pauză ≥ limita edge-ului, apoi progresul din BD** (`raspunsNeclar` l.92, l.133–148). E neclar un
   răspuns fără verdict de la funcție: HTTP 504, 502, 520, 524 sau niciun răspuns (apelul nostru expirat la 170 s / rețea).
   Nu sunt neclare verdictele runtime-ului: 500 `WORKER_ERROR`, 503 `BOOT_ERROR`, 546 limită de resurse (invocarea s-a
   oprit). După un răspuns neclar workerul:
   - **așteaptă 400 s** (`PAUZE.edgeNeclarMs`). 504 vine la 150 s, deci invocarea mai poate trăi ≤250 s; apelul nostru
     expiră la 170 s, deci ≤230 s. După pauză, **nicio invocare veche nu mai lucrează** pe document;
   - **recitește `pagini_procesate`/`status_procesare`** (`aAvansat` l.97). Dacă a avansat, felia e scrisă: progres, nu
     eșec (contorul de încercări se golește și se continuă de la noua pagină, sau se întoarce `procesat`/`partial`). Dacă nu,
     se numără o încercare (max. 3, apoi `eroare` cu motivul real). O citire BD picată contează drept „fără progres”:
     siguranța vine din pauză, nu din această verificare.

   Pauza e numai timp, nu bani. Pe 25.09 workerul ar fi făcut 7 pauze: 1 × 504 + 6 × 520.
3. **SIGTERM pe drumul AI** (l.119): workerul iese doar **între** apeluri (după un răspuns sau după pauza lungă), cu
   `întrerupt: SIGTERM (x/y pagini, AI; se reia de acolo)`. Documentul rămâne `in_lucru` cu felia scrisă, iar tura următoare
   continuă de acolo. Pauza de 400 s nu se scurtează la SIGTERM: 170 s (apel) + 400 s < `stop_grace_period` de 12 min.
   Înainte, `citesteCuAI` mergea până la capătul documentului și putea fi omorât cu SIGKILL chiar în timpul unui apel.

**Rămâne în afara acestui fix:** drumul din **browser** (`OfertareLicitatii.jsx`, `proceseazaDoc`: reîncercare la 5 s, fără
`apeluri`, deci 2 felii) are exact aceeași fereastră; costul dublu de pe 25.09 (0,0792 USD, doc 1276) de acolo vine. Reparația
e în UI sau în edge (deploy), deci e o decizie separată (§12).

## 4. Ce face calea nouă (`worker/ofertare/citire_mare.ts`)
**Cine intră** (`esteMare` l.59, `decizieCitireMare` l.64):
- PDF-urile peste 60 MB (același prag ca edge-ul);
- documentele `ignorat` exact pe motivul scris de edge;
- documentele cu o citire pe felii începută.

Celelalte `ignorat` (spart în bucăți, planșe) nu se ating.

**Pașii:**
1. **Descărcare** (`descarcaPeDisc` l.193): URL semnat, flux HTTP scris direct pe disc (`/tmp/ingest_mare_<id>.pdf`), fără
   să țină fișierul în memorie. SHA-256 se calculează din mers. Mărimea trebuie să fie egală cu `size_bytes`.
2. **Pagini**: `pdfinfo` (`paginiPdf`/`clasificaPdfinfo` l.176–184).
3. **Felii** (`extragePeFelii` l.97): `pdftotext -layout -f/-l` pe felii de 25 de pagini. Felia care pică se înjumătățește
   până la o pagină. Pagina care tot pică intră în `pagini_necitite`, cu motivul ei.
4. **Ieșiri**: aceleași coloane ca un PDF normal:
   - `text_extras` cu ⟦PAGINA n⟧, `pagini`, `pagini_procesate`, `pagini_necitite`;
   - `procesat`/`partial`, `ocr=false`;
   - `antet` + `revizie`, cu Haiku, doar dacă primele 2 pagini au text; rândul din `ai_usage_log`, ~0,001 USD.

   Plus urma în **`analiza.citire_mare`**: încercări, felii, pagini cu/fără text, SHA-256 și `manifest.identic` față de
   manifestul SEAP.
5. **Scan întreg** (0 pagini cu text): `eroare` definitiv, cu motiv (l.325). Documentul nu apare drept „citit”.

Nu cere rebuild. Imaginea are `poppler-utils`, iar `entrypoint.sh` permite deja `git, pdftotext, pdfinfo`.

## 5. Plafoane (constante din `citire_mare.ts`)

| Ce | Plafon | Ce se întâmplă la depășire |
|---|---|---|
| Mărime | 200 MB (`MAX_MARE_BYTES`, limita bucket-ului) | refuz, cu motiv |
| Pagini | 3.000 (`MAX_PAGINI_MARE`) | eșec definitiv, cu motiv |
| Descărcare | 20 min (`TIMP_DESCARCARE_MS`) | eroare trecătoare → se reia |
| `pdfinfo` | 60 s × nr. încercării (60/120/180 s) (`TIMP_PDFINFO_MS`, runda 2) | vezi §6 |
| Felie `pdftotext` | 120 s (`TIMP_FELIE_MS`) | felia se înjumătățește |
| Felii pe document | 60 min (`TIMP_TOTAL_MS`) | restul paginilor intră în `pagini_necitite` („OPRIT la plafonul de timp”) |
| Text | 900k caractere (`MAX_TEXT`) | paginile care nu mai încap intră în `pagini_necitite` |
| Încercări | 3 (`MAX_INCERCARI_MARE`) | `esuat` → sărit până la reset manual |

## 6. Anti-buclă: patru straturi
1. **Încercarea se numără în BD înainte de muncă**, prin compare-and-set pe `analiza->citire_mare->>rev`. Un proces
   omorât pe drum lasă încercarea numărată. După 3 încercări documentul trece pe `esuat` și e sărit fără nicio scriere.
2. **`pdfinfo` trecător vs. definitiv** (runda 2, l.301–305):
   - dacă `pdfinfo` e oprit de semnal (timeout → Deno întoarce cod 143 + `SIGTERM`, verificat) sau nu pornește (cod -1),
     eșecul e **trecător**: `reia`, cu încercarea numărată și plafonul de timp crescut;
   - e **definitiv** („PDF necitibil”) doar când `pdfinfo` a răspuns, dar fără „Pages:”.

   Înainte, un NAS încetinit bloca documentul după o singură încercare.
3. **Edge-ul**: orice răspuns fără `ok:true` e eroare (§3). După un răspuns neclar (504 etc.), reîncercarea vine abia după
   limita de timp a edge-ului și după verificarea progresului în BD (§3.1), deci nu se suprapune cu o invocare vie.
4. **Plasa `trecereBlocata`**: un document care revine candidat după o citire „reușită” în aceeași tură e oprit.

## 7. Oprire și rollback (runda 2)
- `proceseazaIngest` **recitește `ofertare_ingest_coada.activ` înainte de fiecare document** (`coadaActiva`, l.243/260).
  Butonul „Oprește” din UI (`activ=false, nota='oprită manual'`) sau rollback-ul SQL oprește tura la documentul următor,
  fără să rescrie nota și fără notificarea „s-a terminat”. Înainte, workerul vedea `activ` doar la pornire.
- **Citirea deja pornită nu se întrerupe.** Pe un PDF mare, asta poate însemna până la ~85 min pe încercare (§9). O opresc
  doar SIGTERM (repornirea containerului; încercarea nu se consumă) și rollback-ul pe document.
- Pe drumul AI (scanuri sub 60 MB), SIGTERM oprește citirea **între felii** (runda 3, §3.1): documentul rămâne `in_lucru` cu
  felia scrisă și se continuă de acolo în tura următoare.
- Rollback-ul pe document golește `analiza.citire_mare`, deci scrierea finală a workerului nu mai găsește `rev`-ul (CAS) și
  **nu scrie peste**. E testat cap-coadă.
- **Ordinea contează: întâi coada, apoi documentul.** Invers, 770 redevine eligibil și e reluat ca încercarea 1.

## 8. Dovada de rutare → rezultatul așteptat
Codul vechi a trimis 770 la `citesteCuAI`. Bucla a existat, iar poarta de mărime a edge-ului (singurul care scrie „prea mare
pentru citirea automată”) a fost cea care a oprit-o. Tick-ul din Supabase nu lansa nimic, fiindcă heartbeat-ul era proaspăt.
Codul vechi ajungea la `citesteCuAI` doar în două cazuri:
- **(i)** `pdfinfo`/`pdftotext` eșuau pe tot documentul;
- **(ii)** sub 85% din pagini aveau ≥120 de caractere non-spațiu (`PRAG_TEXT_PAGINA`/`PRAG_DOC_TEXT`, `8a6fbbb` l.16–17,
  l.107–109).

Deci cel puțin ~15% din paginile lui 770 au strat de text sărac sau lipsă, dacă nu cumva `pdfinfo` sau `pdftotext` au
picat pe tot documentul (cazul (i): atunci ruta spre AI nu dovedește pagini scanate).
Context (SELECT): în același folder „Documentatie tehnica HUEDIN Lot 1/”, **212 din 230** de documente citite au `ocr=true`
(AI-ul le-a găsit scanate).

**Așteptări realiste pe 770:**
- **cel mai probabil `partial`**, cu multe `pagini_necitite` (paginile scanate: foraje, buletine de laborator, anexe);
- **`eroare` definitiv** „niciuna din cele N pagini nu are strat de text”, dacă e scan integral;
- **„PDF necitibil”**, dacă `pdfinfo` răspunde fără „Pages:”.

Calea nouă numără o pagină „cu text” de la ≥20 de caractere, nu de la 120. O pagină doar cu cartuș sau ștampilă poate
apărea „citită” fără conținut util. La verificare contează și `caractere / pagini_cu_text` (SQL §10, pasul 3), nu doar
statusul.

**Criteriul Copilot** („fragmentat + citit; rezultat în `analiza`”) e îndeplinit pe partea gratuită abia după rularea
reală. Dacă multe pagini rămân necitite, R6 **nu se închide doar cu acest drum**. Trebuie decizia de mai jos.

### Decizia separată: OCR plătit pe paginile necitite (cu poarta pe cheltuială)
Nu se face automat. E cost AI, iar regula casei („poarta pe cheltuială”, CLAUDE.md pct. 10) spune că procesările plătite le
pornește doar ownerul sau responsabilul licitației.

**Ordin de mărime:** OCR-ul Haiku pe Huedin a costat **1,0511 USD pentru 213 pagini** (212 documente), adică
**~0,005 USD/pagină** (`ai_usage_log` × `ofertare_documente_atribuire`, lic. 101, `ocr=true`). La N pagini necitite, costul
e ≈ N × 0,005 USD (ex. 500 de pagini ≈ 2,5 USD). Pe felii de mai multe pagini, costul per pagină poate diferi.

**Opțiuni (de decis după citirea gratuită, când se știe N):**
- **A.** Workerul decupează doar paginile necitite în bucăți ≤60 MB (`pdfseparate`/`pdfunite`, deja în imagine) și le
  urcă drept „bucăți” (tiparul existent „spart de platformă în bucăți”). Edge-ul existent le citește cu AI, prin poarta
  existentă: coada pornită de owner/responsabil.
  - Cere `--allow-run` extins în `entrypoint.sh`, **cu rebuild**, fiindcă fișierul e copiat în imagine.
  - Cere rânduri noi în `ofertare_documente_atribuire` (date → GO).
- **B.** Workerul rasterizează paginile și cheamă Haiku direct. E o cale AI nouă, plătită, sub `service_role`. Cere poartă
  proprie și fișă în `registru_automatizari`. Nu o recomand.
- **C.** Manual: cineva sparge PDF-ul local și urcă bucățile din UI. E fluxul existent, cu poarta din UI, fără cod.

## 9. Riscuri operaționale
- **O încercare pe un PDF mare ține singurul loc de citire până la ~85 min.** Calculul: descărcare ≤20 min + `pdfinfo` ≤1–3 min
  + felii ≤60 min + ultima felie ≤2 min + antet ≤1 min.
  - Cât durează, cozile altor licitații nu se citesc. `main.ts` are un singur `ingestInLucru`.
  - Workerul nu preia nici un commit nou: verificarea git cere `inLucru.size === 0`.
  - Cedarea rândului („15 documente sau 15 min”) se face doar **între documente**, deci și între încercările aceluiași
    document, după un `reia`.
  - Cel mai rău caz într-o tură: două descărcări căzute pe timeout, apoi o citire completă, ≈ 2 h 10 min. Azi: 0 cozi
    active (SELECT).
- **`/tmp`, verificat indirect.** Codul vechi scria 770 întreg (99.948.369 B) în `/tmp/ingest_770.pdf` înainte de
  `textLocal` și ajungea la edge. O excepție la scriere ar fi apărut ca „eșuate”, iar nota cozii arată „0 eșuate” la 5421
  de treceri. Deci stratul de container al lui `/tmp` a ținut deja ≥100 MB. Calea nouă scrie aceeași mărime, fără copia din
  memorie. `/tmp` nu e tmpfs în `docker-compose.yml`.
- **SIGTERM în timpul descărcării** nu oprește descărcarea (≤20 min), iar `stop_grace_period` e de 12 min. Dacă descărcarea
  depășește 12 min, Docker dă SIGKILL și încercarea rămâne numărată (`in_curs`). E în plafonul de 3 încercări, deci nu
  buclează.
- **Timeout pe o felie `pdftotext`**: felia se înjumătățește, iar paginile care tot cad ies `pagini_necitite` (`partial`),
  nu `reia`. Un NAS foarte încetinit poate lăsa pagini necitite. Motivul lor apare în text și în `eroare`.
- **Edge-ul `ofertare-ingest-doc`** (neatins) rescrie `eroare` cu mesajul lui de mărime dacă e pornit din UI pe un document
  mare ajuns în `eroare`. Motivul real rămâne în `analiza.citire_mare`.
- **Pauza de 400 s după un răspuns neclar** (runda 3, §3.1) costă doar timp: un document cu 504 la fiecare apel ține locul
  de citire ≤3 × (150 + 400) s ≈ 27,5 min înainte de `eroare` (înainte: ~8 min, dar cu risc de felie dublată). Un 504 izolat
  după care edge-ul își termină felia costă o singură pauză, apoi citirea continuă.
- **Drumul normal**: peste 900k de caractere, paginile care nu mai încap ies `pagini_necitite` (`partial`). Înainte, textul
  se tăia tăcut și documentul rămânea `procesat`.

## 10. SQL propus — NEEXECUTAT

Se rulează **doar după**:
1. merge pe main;
2. heartbeat-ul workerului arată commit-ul nou;
3. GO Razvan.

Condițiile pașilor 2 și 4 au fost verificate ca SELECT pe 25.09 (runda 2 la 21:39 UTC, gărzile noi din runda 3 la
23:09–23:10 UTC; worker pe `8a6fbbb`, `branch=main`, heartbeat 16 s):
- apply fără garda de sha → 1 rând;
- apply cu placeholder-ul necompletat → 0 rânduri (no-op sigur);
- apply cu sha-ul **complet** al lui `8a6fbbb` în locul placeholder-ului: fără garda anti-vechi → 1 rând (comparația pe
  prefix funcționează), cu ea → 0;
- un sha gol ar potrivi orice prefix (`left(x, 0) = ''` → true), de aceea garda cere `length(...) >= 7`;
- R-DOC azi → 0 rânduri (`citire_mare` nu există); garda pe dovezi trece (0 rânduri în `ofertare_pt_dovezi` pe 770).

```sql
-- R6 / doc 770 — repunerea în coadă cu workerul NOU. NEEXECUTAT.
-- 770 rămâne 'ignorat' pe mărime: pentru workerul nou asta îl face eligibil, deci documentul NU se modifică de mână.
-- Se repornește doar coada lic. 101.
-- Workerul VECHI (8a6fbbb) nu vede 770 ('ignorat'): ar închide coada imediat și ar trimite notificarea falsă
-- „citirea s-a terminat”. De aici garda pe sha din pasul 2.

-- 1) PREVIEW (rulat 25.09 21:39 UTC)
-- Rezultat 770: ignorat, 99948369 B, analiza NULL, text NULL, pagini NULL, pagini_procesate 0, pagini_necitite {},
--   ocr false, antet {}, revizie NULL, procesat_la 2026-09-25 16:10:25.472+00, procesat_de 01ab5a45-…-c30fe05ab523,
--   de_citit=true.
-- Coada 101 inactivă (lansari 8234). worker_sha=8a6fbbb (VECHI), heartbeat 25 s.
-- docs_de_preluat_101=1 (doar 770), word_de_citit_101=0, cozi_active_acum=0.
-- Valorile documentului sunt cele pe care le repune R-DOC. Dacă preview-ul din ziua apply-ului arată altceva: STOP.
SELECT d.id, d.status_procesare, d.size_bytes, d.eroare, d.text_extras IS NULL AS fara_text, d.pagini, d.pagini_procesate,
       d.pagini_necitite, d.ocr, d.antet, d.revizie, d.procesat_la, d.procesat_de, d.analiza,
       ofertare_doc_de_citit(d.licitatie_id, d.id, d.nume_original, d.tip) AS de_citit,
       c.activ AS coada_activa, c.cerut_de, c.lansari, c.terminat_la, c.nota,
       h.ultimul AS worker_ultimul, now() - h.ultimul AS vechime_heartbeat,
       h.detalii->>'sha' AS worker_sha, h.detalii->'in_lucru' AS worker_in_lucru,
       (SELECT count(*) FROM ofertare_documente_atribuire x
         WHERE x.licitatie_id = 101 AND x.fisier_path NOT LIKE '%/neincarcat/%'
           AND ofertare_doc_de_citit(x.licitatie_id, x.id, x.nume_original, x.tip)
           AND (x.status_procesare IN ('neprocesat','in_lucru','eroare')
                OR (x.status_procesare = 'ignorat' AND x.eroare LIKE 'prea mare pentru citirea automată%'))) AS docs_de_preluat_101,
       (SELECT count(*) FROM ofertare_documente_atribuire x
         WHERE x.licitatie_id = 101 AND x.status_procesare = 'ignorat' AND x.text_extras IS NULL
           AND (x.nume_original ILIKE '%.docx' OR x.nume_original ILIKE '%.doc')) AS word_de_citit_101,
       (SELECT count(*) FROM ofertare_ingest_coada WHERE activ) AS cozi_active_acum
FROM ofertare_documente_atribuire d
JOIN ofertare_ingest_coada c ON c.licitatie_id = d.licitatie_id
LEFT JOIN worker_heartbeat h ON h.nume = 'ofertare-worker'
WHERE d.id = 770;

-- 2) APPLY (după GO)
-- <SHA_COMPLET_MAIN_DUPA_MERGE> = sha-ul COMPLET (40 de caractere) al lui main după merge:
--   `git fetch origin main && git rev-parse origin/main`. La un merge squash e un sha NOU: nici 3632155, nici c2f61b5,
--   nici commit-ul rundei 3.
-- Workerul scrie în worker_heartbeat.detalii->>'sha' forma SCURTĂ (entrypoint.sh: `git rev-parse --short HEAD`, într-o
--   clonă --depth 1 → de regulă 7 caractere). Local, `git rev-parse --short` poate da 8+ caractere când prefixul e ambiguu
--   în repo-ul complet. De aceea garda compară pe PREFIX: sha-ul workerului = începutul sha-ului complet, pe lungimea lui.
--   Control vizual înainte de GO: `git rev-parse --short=7 origin/main` = worker_sha din preview.
-- length(...) >= 7: un sha gol ar potrivi orice prefix (left(x, 0) = '').
-- Workerul trece pe commit-ul nou doar când e liber (verificare la 5 min).
-- Cu placeholder-ul necompletat, UPDATE-ul nu atinge nimic.
UPDATE ofertare_ingest_coada
SET activ = true, cerut_la = now(), terminat_la = NULL, nota = NULL, ultimul_tick = NULL
WHERE licitatie_id = 101 AND activ = false
  AND EXISTS (SELECT 1 FROM ofertare_documente_atribuire d
              WHERE d.id = 770 AND d.status_procesare = 'ignorat'
                AND d.eroare = 'prea mare pentru citirea automată (95 MB > 60 MB) — de spart pe bucăți / procesat pe NAS'
                AND d.analiza IS NULL AND d.text_extras IS NULL AND d.pagini IS NULL)
  AND EXISTS (SELECT 1 FROM worker_heartbeat h
              WHERE h.nume = 'ofertare-worker' AND h.ultimul > now() - interval '10 minutes'
                AND h.detalii->>'branch' = 'main'                                      -- workerul de pe main
                AND length(h.detalii->>'sha') >= 7                                     -- sha real, nu '' / '?'
                AND h.detalii->>'sha' IS DISTINCT FROM '8a6fbbb'                       -- NU codul vechi
                AND h.detalii->>'sha' = left('<SHA_COMPLET_MAIN_DUPA_MERGE>', length(h.detalii->>'sha')))  -- commit-ul de după merge
RETURNING licitatie_id, activ, cerut_de, cerut_la, lansari;

-- 3) SANITY: la ~5 min (stare='in_curs'), apoi la final. O încercare poate dura până la ~85 min.
SELECT id, status_procesare, pagini, pagini_procesate, cardinality(pagini_necitite) AS necitite,
       length(text_extras) AS caractere, left(eroare, 300) AS eroare,
       analiza->'citire_mare'->>'stare' AS stare, analiza->'citire_mare'->>'incercari' AS incercari,
       analiza->'citire_mare'->>'pagini_cu_text' AS cu_text, analiza->'citire_mare'->>'pagini_fara_text' AS fara_text,
       analiza->'citire_mare'->>'felii' AS felii, analiza->'citire_mare'->>'felii_esuate' AS felii_esuate,
       analiza->'citire_mare'->>'oprit' AS oprit,
       round(length(text_extras)::numeric / nullif((analiza->'citire_mare'->>'pagini_cu_text')::int, 0)) AS car_pe_pagina_cu_text,
       analiza->'citire_mare'->'manifest'->>'identic' AS identic_manifest   -- așteptat: true (manifest 378, b003d340…d43d)
FROM ofertare_documente_atribuire WHERE id = 770;
SELECT activ, terminat_la, nota FROM ofertare_ingest_coada WHERE licitatie_id = 101;
SELECT model, tokens_in, tokens_out, cost_usd, created_at FROM ai_usage_log
WHERE ref_table = 'ofertare_documente_atribuire' AND ref_id = 770 ORDER BY created_at DESC LIMIT 3;   -- așteptat: doar antetul Haiku

-- 4) ROLLBACK. ORDINEA CONTEAZĂ: întâi coada, apoi documentul.
-- R-COADA oprește tura. Workerul NOU recitește `activ` înainte de fiecare document, deci se oprește la documentul
--   următor, fără notă și fără notificare.
-- R-COADA NU oprește o citire deja pornită (770: până la ~85 min pe încercare). Pe aceea o opresc doar SIGTERM
--   (repornirea containerului, încercarea nu se consumă) sau R-DOC.
UPDATE ofertare_ingest_coada SET activ = false, nota = 'oprită manual (rollback R6/770)'
WHERE licitatie_id = 101
RETURNING licitatie_id, activ, nota, lansari;

-- 4a) PREVIEW înainte de R-DOC (după R-COADA). R-DOC pune text_extras și revizie pe NULL, dar NU anulează ce s-a construit
--   între timp din textul lui 770. Rulat 25.09 23:12 UTC: toate 0, în afară de seap_manifest=1 (manifestul 378) și
--   ingest_lansari=1 (incercari=4), care există dinainte de citire și nu țin de ea.
-- pt_dovezi > 0 → R-DOC NU se aplică (garda NOT EXISTS de mai jos). Motivul: revizie → NULL pornește triggerul
--   trg_pt_invalideaza_la_revizie_document (AFTER UPDATE OF revizie, dacă revizia chiar se schimbă): legăturile PT
--   'verificata'/'dovedita' cu dovadă pe 770 trec pe 'atribuita', cu „INVALIDATA …” în constatare. R-DOC nu poate anula asta.
-- Oricare din celelalte > 0 → STOP și decizie separată: R-DOC nu le șterge și ar rămâne legate de un document fără text.
SELECT (SELECT count(*) FROM ofertare_pt_dovezi          WHERE document_id = 770)       AS pt_dovezi,
       (SELECT count(*) FROM ofertare_cerinte            WHERE sursa_document_id = 770) AS cerinte,
       (SELECT count(*) FROM ofertare_cerinte_dovezi     WHERE document_id = 770)       AS cerinte_dovezi,
       (SELECT count(*) FROM ofertare_triere             WHERE doc_id = 770)            AS triere,
       (SELECT count(*) FROM ofertare_inventar_ai        WHERE doc_id = 770)            AS inventar_ai,
       (SELECT count(*) FROM ofertare_acoperire_revizii  WHERE document_id = 770)       AS acoperire_revizii,
       (SELECT count(*) FROM ofertare_clauze_contract    WHERE document_id = 770)       AS clauze,
       (SELECT count(*) FROM ofertare_formulare_registru WHERE document_sursa_id = 770) AS formulare,
       (SELECT count(*) FROM ofertare_clarificari        WHERE raspuns_document_id = 770) AS clarificari,
       (SELECT count(*) FROM ofertare_raspuns_set_doc    WHERE document_id = 770)       AS raspuns_set_doc,
       (SELECT count(*) FROM ofertare_citire_test        WHERE doc_id = 770)            AS citire_test,
       (SELECT count(*) FROM ofertare_seap_manifest      WHERE document_id = 770)       AS seap_manifest,   -- 1, dinainte
       (SELECT count(*) FROM ofertare_ingest_lansari     WHERE doc_id = 770)            AS ingest_lansari;  -- 1, dinainte

-- R-DOC: 770 înapoi EXACT la valorile din preview.
-- Dacă citirea e încă în curs, scrierea ei finală are CAS pe analiza->citire_mare->>rev. După R-DOC nu mai găsește
--   rev-ul și NU scrie peste (testat).
-- Fără R-COADA înainte, 770 ar redeveni eligibil și ar fi reluat ca încercarea 1.
-- Același R-DOC servește și ca „reset manual” după un 'esuat' (analiza.citire_mare.stare='esuat'), cu GO separat.
UPDATE ofertare_documente_atribuire
SET status_procesare = 'ignorat',
    eroare = 'prea mare pentru citirea automată (95 MB > 60 MB) — de spart pe bucăți / procesat pe NAS',
    text_extras = NULL, pagini = NULL, pagini_procesate = 0, pagini_necitite = '{}'::int[], size_bytes = 99948369,
    ocr = false, antet = '{}'::jsonb, revizie = NULL,
    procesat_la = '2026-09-25 16:10:25.472+00', procesat_de = '01ab5a45-31f1-4868-81ec-c30fe05ab523',
    analiza = NULLIF(coalesce(analiza, '{}'::jsonb) - 'citire_mare', '{}'::jsonb)
WHERE id = 770 AND analiza ? 'citire_mare'
  AND NOT EXISTS (SELECT 1 FROM ofertare_pt_dovezi p WHERE p.document_id = 770)   -- fără invalidări PT prin trigger (4a)
RETURNING id, status_procesare, left(eroare, 60) AS eroare, analiza, text_extras IS NULL AS fara_text, pagini, pagini_procesate,
          pagini_necitite, ocr, antet, revizie, procesat_la, procesat_de, size_bytes;
-- Nu se anulează: rândul din ai_usage_log pentru antetul Haiku (~0,001 USD, cost real), `lansari` din coadă și
--   DERIVATELE construite între timp din textul lui 770 (cerințe extrase, dovezi, triere, inventar AI, acoperire, clauze,
--   formulare, clarificări, seturi de răspuns) — de aceea preview-ul 4a, cu STOP dacă apare ceva.
```

## 11. Teste (rulate în worktree, cu `--no-lock`; `deno.lock` neschimbat, md5 verificat)

**`citire_mare_test.ts`: 29/29** (runda 1: 23). Cele 6 noi:
- rollback pe document în timpul citirii → rezultatul nu se scrie peste;
- `clasificaPdfinfo` (fără „Pages:” → definitiv; semnal / cod -1 → trecător);
- `ruleaza` real, comandă inexistentă → cod -1;
- `ruleaza` real, `sleep 5` cu plafon 200 ms → cod 143 + `SIGTERM` → trecător;
- `pdfinfo` oprit la timeout → `reia` cu plafon 60/120/180 s, `esuat` la a 3-a;
- `pdfinfo` fără „Pages:” → definitiv din prima.

Fără `sleep` în `--allow-run`, testul de timeout real se sare (28 + 1 ignorat).

**`ingest_mare_test.ts`: 4/4** (runda 1: 1; runda 2: 3):
- (1) `proceseazaIngest` pe lic. 101 simulată:
  - 770 iese `partial`, fără edge;
  - 900 (edge 546 WORKER_LIMIT) iese `eroare: WORKER_LIMIT: Memory limit exceeded (HTTP 546)` după 3 apeluri, nu „citit”;
  - 901 (edge `ok:true`, dar rămâne candidat) e oprit de plasă;
  - nota cozii: „2 citite acum, 2 eșuate”.
- (2) `citesteCuAI` pe 12 forme de răspuns: `ok:true` / `continua`, skip, 546, 404 `{error}`, `{error}` 200, `{}`, 504 gol,
  502 HTML, `{message}` 504, eroare de rețea, `ok:false`. Runda 3: verifică și pauzele exacte — 15 s / 30 s după un
  verdict (546, 404, `{error}`, `{}`, `ok:false`), 400 s după fiecare răspuns neclar (504, 502, rețea).
- (3) rollback în timpul citirii lui 770 (coada, apoi documentul): 770 rămâne exact ca după rollback, 905 nu e atins,
  nota nu e rescrisă, fără notificare.
- (4) runda 3, pe un **ceas virtual** (pauzele se înregistrează, fără 400 s reale) și un edge simulat ca cel real (citește
  felia de la `pagini_procesate` la pornire, o scrie la final; peste 150 s → 504, dar continuă până la 400 s):
  - toate apelurile cer `apeluri: 1`; `raspunsNeclar` (0/502/504/520/524 da; 200/404/500/503/546 nu); `aAvansat`;
  - (A) prima invocare ține 330 s (504 la 150 s, felia scrisă la 330 s): o pauză de 400 s, progresul 0 → 8 citit din BD,
    felii citite `[0, 8]`, `procesat (16/16 pagini, AI)`, nicio invocare pornită cât alta mai lucra;
  - (A') contra-probă în test, cu pauza veche de 15 s pe același edge simulat: felii `[0, 0, 8]` — felia 0 dublată, ca pe
    doc 1276;
  - (B) invocarea omorâtă la 400 s de fiecare dată: 3 apeluri, 3 × 400 s, `eroare: răspuns gol (HTTP 504)`, fără suprapuneri;
  - (C) SIGTERM în timpul pauzei: pauza rămâne 400 s, niciun apel nou, `întrerupt: SIGTERM (8/16 pagini, AI; …)`,
    documentul rămâne `in_lucru` la pagina 8.

**Contra-probă:** cu cele două condiții vechi puse temporar la loc (`!data || data.error`, fără recitirea lui `activ`),
toate 3 testele pică. Fișierul a fost restaurat.

**Contra-probă runda 3** (pe o copie în scratchpad, worktree-ul neatins), fiecare schimbare scoasă pe rând:
- `raspunsNeclar` mereu `false` (comportamentul vechi: reîncercare la 15 s) → testele (2) și (4) pică;
- `apeluri: 2` la loc → testul (4) pică;
- fără verificarea SIGTERM între apeluri → testul (4) pică.

**Alte verificări:**
- `bash test-fixtures/seap_terra/run.sh`: **27/27 + 15/15**. Scriptul rescria `deno.lock` (`deno run` fără `--no-lock`),
  așa că am restaurat fișierul și am adăugat `--no-lock` în `run.sh`.
- `deno check --node-modules-dir=none --no-lock worker/ofertare/main.ts`: **94 erori, identic cu baza (HEAD `3632155`)**,
  pe fișiere și pe tipuri. Toate sunt vechi, din tiparele supabase-js („never”). Niciuna în `citire_mare.ts`.
- README: comenzile de test au `--no-lock`.

**Runda 3, reluate după modificări** (25.09, ~23:15 UTC): `citire_mare_test` 29/29; `ingest_mare_test` 4/4;
`run.sh` exit 0, 27/27 + 15/15; `deno check` pe `main.ts`: 94 erori, identic cu `c2f61b5` pe fișiere (ingest.ts 31,
seap.ts 49 etc.) și pe coduri TS (citirea nouă din BD are cast local, ca `coadaActiva`); `deno check` pe cele două
fișiere de test: fără erori; md5 `deno.lock` `875e293d…` identic înainte și după.

## 12. Ce rămâne pentru închidere
1. Review + merge pe main. Ramura e locală: nu e pushată și nu are PR, conform regulilor sesiunii. Workerul preia singur
   commit-ul, fără rebuild.
2. Completezi `<SHA_COMPLET_MAIN_DUPA_MERGE>` cu `git rev-parse origin/main` (sha complet; garda compară pe prefix),
   verifici vizual `git rev-parse --short=7 origin/main` = `worker_sha` din preview, apoi GO Razvan pe §10 pasul 2.
3. Verificarea rezultatului pe 770 (§10 pasul 3):
   - `stare='gata'`, `identic_manifest=true`;
   - câte pagini sunt necitite și câte caractere pe pagină cu text.
4. Decizia de OCR plătit pe paginile necitite (§8, A/B/C), cu poarta pe cheltuială.
5. Separat de R6: drumul din **browser** (`OfertareLicitatii.jsx` `proceseazaDoc`) reîncearcă la 5 s după un 504, cu 2 felii
   pe invocare. E aceeași fereastră de cost dublu, dovedită pe 25.09 (doc 1276, rândurile 4500/4504, 0,0792 USD în plus;
   §3.1). Variante:
   - **A.** UI-ul trimite `apeluri:1` și, după un 504, așteaptă ~400 s sau verifică `pagini_procesate` înainte de
     reîncercare (cod UI, fără deploy de edge);
   - **B.** edge-ul refuză o invocare nouă cât alta e în zbor pe același document (lease în BD; cere deploy de edge și,
     probabil, o coloană sau un tabel nou);
   - **C.** rămâne așa (sume mici, 504 rar: 2 în browser pe 25.09).
6. Actualizarea `registru_automatizari` și `RESTANTE_AUDIT_OFERTARE.md` (rândul 770), după rezultat. Fișa workerului:
   - citește PDF extern;
   - scrie doar pe rândul documentului + `ai_usage_log`;
   - `service_role`;
   - fără AI nou.
