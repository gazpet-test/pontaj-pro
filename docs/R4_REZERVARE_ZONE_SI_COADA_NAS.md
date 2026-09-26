# R4 — fără apeluri AI duplicate între taburi (rezervare pe zonă) + coada pe NAS (design)

Data: 25.09.2026 (noapte) · Răspuns la verdictul Copilot: „Rămân coada independentă de browser și prevenirea apelurilor AI duplicate între taburi.”
Runda 2 (după verificator): defectul major „citește de la zero cooperează” reparat + test; plafon pe `pana_la`; `/api/plansa-felii` fail-closed; corecturi de text; design NAS completat (§3). Plus un bug nou de agregare găsit pe planșa 470 (§5, commit separat).
Runda 3 (verdictul Copilot pe deduplicare): dedup-ul pe multiset (`e762c6e`) e înlocuit cu **identitatea rândului de tabel** — (document, pagină, tabel identificat, Nr rând) — commit `a800d38` (§5).
Runda 4 (26.09, verificatorul rundei 3): rândul de margine nu mai primește identitate prin poziție când tabelul are coloană Nr (blocant); Nr repetat / benzi nevecine / text contrazis / indexul tabelului în cheia de poziție (major); Dn cu toate rândurile de verificat menționat la transfer, fără early-return (major); `COD_VERSIUNE` 2026-09-26.8 (§5.3, §5.5).
Ramură locală: `claude/r4-rezervare-zone` (bază `main` @ `8a6fbbb`; numerele de linie din §2 și §5 sunt pe capul ramurii). **Nimic deployat, nimic pushat, nicio scriere în BD** (doar SELECT-uri).

**Verdict propus: PARȚIAL.**

Teste finale pe ramură (pe capul ramurii, după runda 4; toate cu `--node-modules-dir=none --no-lock`, `deno.lock` neatins, md5 `875e293d…`):

| Comandă | Rezultat |
|---|---|
| `deno test supabase/functions/ofertare-plansa-citeste` | **89/89** (după `a800d38`: 78/78) |
| `deno test -A supabase/functions/` | **106/106** (după `a800d38`: 95/95) |
| `concurenta_test.ts` rulat de 10 ori | 10/10 verzi, 49/49 de fiecare dată |
| `node scripts/test-cas-felii.mjs` | **34/34** |
| `node scripts/test-detector-sigla.mjs` | 23/23 |
| `node scripts/verifica-poarta-identica.mjs` | OK |
| `deno check` pe `index.ts` | OK |

Testele noi pică pe codul vechi: cu gărzile de resetare dezactivate pică 5 teste de resetare. Pentru identitatea rândului, mutațiile pe o copie a funcției (identitate pe text / conflict ignorat / împerechere laxă / fără garda de bandă / fără prefixul de margine) fac să pice 8 / 3 / 5 / 2 / 2 teste (§5.6); pe contraexemplul Copilot, dedup-ul pe mulțime și cel pe multiset dau 1 rând, identitatea dă 2. Runda 4: toate cele 11 teste noi pică pe `a800d38` (copie în scratchpad), iar 8 mutații pe regulile noi fac să pice 1–3 teste fiecare (§5.6).

| Punct | Stare |
|---|---|
| Apeluri AI duplicate între taburi | **remediat în cod + teste**, fără schemă nouă (§2), inclusiv resetarea concurentă („citește” de la zero din două taburi). **Nu e închis**: nedeployat (edge + Vercel) și fără testul LIVE cu 2 taburi (`ai_usage_log`: un apel pe zonă). Reziduuri documentate în §2.3. |
| Coada independentă de browser | **deschisă**: design + migrare propusă, neaplicată (§3, `docs/R4_MIGRARE_PROPUSA_ofertare_plansa_coada.sql`). Cere GO pentru schemă nouă și pentru automatizarea plătită. Estimare 6–8 h, peste pragul de ½ zi, deci nu s-a implementat. |

## 1. Starea exactă înainte de fix (`main` @ `8a6fbbb`)

### 1.1 Ce era deja persistent / sigur
- **CAS pe citire**: fiecare scriere a `analiza` filtrează pe `analiza->citire_ai->>rev` + `analiza->plansa->>taiat_la` (`concurenta.ts → scrieCAS`). La conflict se recitește și se fuzionează pe zone (`fuzioneazaZone`), max. 3 încercări, apoi 409.
- **Tăierea** (`plansa.taiat_la`, scrisă de `/api/plansa-felii`) și **versiunea** (`cod|model|prompt_sha` + `taiat_la/cale_felii/geom_sha/fisier`) blochează amestecul (409).
- **Rezultatele pe zonă** stau în `citire_ai.felii[]` (cu `_versiune`, `_zona`, `_regiune`). „⏯ continuă” nu replătește zonele deja salvate.
- **Transferul în cantități**: lease `citire_ai.transfer` + RPC atomic `ofertare_transfer_plansa_cantitati` (aplicat, GO Razvan, vezi `RESTANTE_AUDIT_OFERTARE.md`).

### 1.2 Unde e încă bucla în browser
Serverul citește max. `FELII_PE_RULARE = 4` zone pe invocare și întoarce `continua=true`. **Browserul** reia:
- `src/OfertareLicitatii.jsx:1070` `citestePlansa`: `/api/plansa-felii` (tăiere), apoi `while (runde < 25)` cu `de_la` (l. 1086–1093);
- `:1053` `reiaPlansa`: `mod: 'continua' | 'reia_erori'` (l. 1057–1063);
- `:1046` `lipesteNote` (perechi „note tăiate”); `:1132` `citesteToatePlansele` ia planșele pe rând (comentariul de la l. 1120: „nu există coadă pe server pentru planșe”).
Dacă tabul se închide, citirea se oprește și rămâne `gata:false` până apasă cineva „continuă”.

### 1.3 Scenariul concret de plată dublă (linii din `main`)
Lotul se calcula DOAR din rezultatele salvate, fără să știe de rundele în zbor:
- `handler.ts:621` `existente` = `ca0.felii` (citite la începutul invocării);
- `handler.ts:624–628` `lot` = zonele fără rezultat (`continua`) / căzute (`reia_erori`) / `felii.slice(de_la, de_la+4)`;
- `handler.ts:643` `citesteFelie(...)` = apelul plătit, pe fiecare zonă din lot; `:650` `ai_usage_log`;
- `handler.ts:853` `scrieCAS`; la conflict, `:692` `fuzioneazaZone` păstrează rezultatul o singură dată, dar s-a plătit de două ori.

Exemplu: planșă cu `z1_5`, `z1_6` necitite; tab A și tab B apasă „⏯ continuă”, deci ambele calculează `lot=[z1_5,z1_6]`: **4 apeluri Opus în loc de 2**. La fel se întâmplă cu: A în bucla „citește” (`de_la=4`) + B „continuă” (lotul lui B include zonele în citire la A); două „🔁 reia zonele căzute”; „🧩 note tăiate” din două taburi (`handler.ts:560/566`, până la 6 perechi de două ori). Dacă B apasă „citește” cât A citește, `/api/plansa-felii` șterge feliile și scrie un `taiat_la` nou, iar runda lui A, deja plătită, cade cu 409.

Ordin de mărime (SELECT pe `ai_usage_log`, `function_name='ofertare-plansa-citeste'`):
- **tot istoricul, 29.08–25.09.2026**: 124 invocări, 22,12 USD, 8 documente; medie 0,178 USD/invocare, maxim 0,7108 USD;
- **doar 25.09.2026** (aceleași cifre în UTC și Europe/Bucharest): 94 invocări, 17,24 USD, 7 documente; medie 0,183 USD, maxim 0,7108 USD.

`ai_usage_log` nu are zonă/rulare, așa că dublurile din trecut **nu se pot număra** retroactiv.

## 2. Fix implementat: rezervare per (document, zonă, tăiere), înainte de AI

### 2.1 Mecanism (fără schemă nouă)
- Stocare: `analiza.rezervari_zone = {rev, zone: {cheie: {rulare, taiat_la, de_la, pana_la, resetare?}}}`; cheie = zona (`z1_5`) sau perechea (`lipire:z1_1+z1_2`).
- Rezervarea se face prin **CAS** (`concurenta.ts:211 rezervaChei`). Lotul se calculează pe documentul **proaspăt** (`handler.ts:675 planifica`). Se exclud zonele rezervate activ de **altă** rulare pe **aceeași** tăiere (`concurenta.ts:170 rezervateDeAltii`), apoi se scriu rezervările (jeton `rezervari_zone.rev` nou, `:178 rezervariNoi`). La conflict se recalculează, pentru că alt tab a rezervat între timp.
- Toate candidatele rezervate de alții: **409** „Zonele … sunt în lucru în alt tab (altă rulare), rezervate până la HH:MM — nu s-a apelat AI, nu s-a plătit nimic” + `in_lucru`, `rezervat_pana_la`, `cost_usd: 0` (`handler.ts:705–708`). Zero AI, zero scrieri.
- **„Citește” de la zero NU cooperează** (defectul major găsit de verificator, reparat în runda 2): scrierea unei resetări pleacă de la baza `[]` (înlocuiește citirea). La reîncercarea CAS ar fi aruncat rezultatele plătite ale rulării care ținea zonele. Acum, orice rezervare activă a altei rulări pe tăierea curentă (zone sau perechi de note) dă 409 „în lucru în alt tab”, zero AI (`handler.ts:696`). **Simetric**, rezervările unei resetări poartă `resetare: true`. Cât sunt active, „continuă”, „reia zonele căzute”, runda următoare a altei bucle (`de_la>0`) și „note tăiate” primesc 409 fără AI (`handler.ts:700–702`, `:588`). Motivul: scrierea resetării le-ar fi aruncat rezultatele după plată. Astfel o resetare nu coexistă niciodată cu altă rulare activă pe aceeași tăiere.
- În rest (fără resetare), rezervarea parțială înseamnă cooperare: tabul curent citește doar restul, `in_lucru_alt_tab` apare în răspuns, iar bucla nu mai cere runde pentru zonele celuilalt (`maiSunt`). La `de_la>0`, o zonă citită deja bine în citirea curentă nu se mai plătește; `de_la_urmator` avansează după ultima zonă din lot (`handler.ts:714`).
- Eliberare: la scrierea rezultatului (`handler.ts:901 rzCurat`: scoate rezervările rulării curente, curăță expiratele / altă tăiere); la eșec (excepție în AI `:735`, CAS epuizat `:948`) eliberarea e best-effort (`concurenta.ts:239 elibereazaRezervari`).
- **Expirare**: `REZERVARE_EXPIRA_MS = 7 min` (`concurenta.ts:155`), peste limita de ceas Edge (150 s Free / 400 s plătit, docs Supabase „Edge Functions / Limits”). Dacă tabul se închide sau funcția e omorâtă, zona se **preia** automat după expirare.
- **Plafon pe `pana_la`** (runda 2): o rezervare e activă doar dacă `now < pana_la <= now + 7 min + 60 s` (`TOLERANTA_CEAS_MS`, `concurenta.ts:161–166` `rezActiva`; aceeași regulă în `api/_cas.js:16–26` `rezervariActive`, constantele verificate identice în `scripts/test-cas-felii.mjs`). O rezervare coruptă sau scrisă de mână (`pana_la = 2099`; politica RLS de update pe `analiza` e a modulului Ofertare, nu doar a ownerului) e tratată ca expirată. Nu blochează nici citirea, nici retăierea, și se curăță la următoarea scriere.
- Rezervările de pe **altă tăiere** sunt ignorate, pentru că zonele nu mai corespund.
- Toate scrierile CAS din edge filtrează acum și pe `analiza->rezervari_zone->>rev` (`concurenta.ts:18 CALE_REZ`, `:107`). O scriere a citirii nu mai poate șterge pe tăcute rezervarea făcută de alt tab. RPC-ul de transfer folosește `jsonb_set` pe `citire_ai`, deci nu atinge rezervările.
- **Retăierea** (`api/plansa-felii.js`) e refuzată cu 409 cât există zone rezervate active pe tăierea curentă. Verificări:
  - la început (l. 164, pe documentul citit);
  - pe starea **proaspătă**, înaintea fiecăreia dintre cele 3 scrieri „necitibilă” (l. 244/255/265; acestea înlocuiesc tot `plansa`, iar `taiat_la` dispare);
  - pe starea proaspătă, chiar înainte de ștergerea feliilor (l. 308).

  Re-verificarea e **fail-closed** (`api/_cas.js:41 verificaRetaiere`): dacă re-citirea dă eroare sau excepție, răspunsul e 503 „nu retai pe nesigure; nimic nu s-a șters”, nu se trece mai departe.

### 2.2 Teste (deps simulate, fără rețea, fără AI real)
`deno test --node-modules-dir=none --no-lock supabase/functions/ofertare-plansa-citeste` dă **78 passed, 0 failed** pe capul ramurii (după `a800d38`). Istoric: `main` 44; runda 1: 55; după commit-ul `71b74e8`: 62; după `e762c6e` (multiset): 68. `concurenta_test.ts` rulat de 10 ori la rând: **10/10 verzi, 47/47 de fiecare dată** (după `71b74e8`: 45/45; după `e762c6e`: 46/46).
Noi în runda 2 (`concurenta_test.ts`):
- **două bucle „citește” de la zero pe 6 zone** (bucla din UI, `citestePlansa`, fără `/api/plansa-felii`), în două variante: aceeași viteză, respectiv zonele 5–6 mai lente. Rezultat: **6 apeluri AI, 6 zone salvate, `gata=true`**; al doilea tab primește 409 „în lucru în alt tab” din prima rundă (`cost_usd 0`); fiecare zonă plătită apare în citirea finală; nicio rezervare rămasă.
  Reproducere FĂRĂ fix (aceleași teste, cu cele două gărzi dezactivate temporar; 5 rulări pe variantă, rezultat identic de fiecare dată):
  - varianta 1: **8 apeluri AI pe 6 zone** (`z1_5`, `z1_6` plătite de două ori);
  - varianta 2: 6 apeluri AI, dar salvate doar `z1_5, z1_6`, `gata=false` — **4 zone plătite și pierdute**.

  Cifrele sunt exact cele raportate de verificator.
- „citește” de la zero cu o rezervare activă a altei rulări (zonă sau pereche de note) dă 409, 0 AI, 0 scrieri, iar rezervarea celuilalt rămâne neatinsă;
- cât timp o resetare a altei rulări e în zbor, `continua` / `reia_erori` / `de_la=4` / `doar_lipire` dau 409, 0 AI, 0 scrieri;
- „continuă” pornit în timpul rundei 1 a unui „citește” de la zero dă 409; citirea de la zero termină singură: 6 AI, 6 zone, nimic pierdut;
- plafon `pana_la`: +7 min și +7 min 60 s sunt active, +7 min 61 s, 2099 sau o dată invalidă sunt ignorate; rezervarea forjată pe 2099 nu blochează „continuă” și se curăță la scriere.

Din runda 1 (păstrate): două „continuă” simultane dau 2 apeluri AI (nu 4); zone care se suprapun parțial sunt citite exact o dată; o rezervare activă dă 409 fără AI; o rezervare expirată e preluată; o rezervare pe altă tăiere nu blochează; rezervarea e vizibilă în timpul apelului AI; la CAS epuizat rezervarea e eliberată; `de_la=4` sare zona rezervată; „note tăiate” din două taburi plătesc perechea o dată. Testul adaptat „două citește simultane” (4 zone) trece neschimbat.
Alte rulări:
- `deno test --node-modules-dir=none --no-lock -A supabase/functions/`: **95 passed, 0 failed** (după `71b74e8`: 79; după `e762c6e`: 85);
- `node scripts/test-cas-felii.mjs`: **34/34** (+14: plafon, constante identice cu edge, `verificaRetaiere` 409/503/404/null, ordinea re-verificării înaintea celor 3 scrieri „necitibilă” și a ștergerii);
- `node scripts/test-detector-sigla.mjs`: 23/23;
- `node scripts/verifica-poarta-identica.mjs`: OK;
- `deno check` pe `index.ts`: OK.

`deno.lock` e neatins (`--no-lock`).

### 2.3 Ce NU acoperă (reziduu, documentat)
- **Fereastra tăiere+upload** în `/api/plansa-felii`: după ultima re-verificare (l. 308), feliile vechi se șterg și cele noi se taie și se urcă **secvențial**: până la 60 de felii (`MAX_FELII`) sau 80 (`MAX_FELII_FIN`), fiecare cu `sharp` extract + jpeg + stats + upload, cu `maxDuration` 300 s (`vercel.json`). Fereastra e de **zeci de secunde, până la ~1 min**. O citire care rezervă în fereastra asta plătește o rundă (≤4 zone) și o pierde (409 la scriere). Scrierea finală a tăierii (CAS doar pe `citire_ai.rev`) pleacă de la documentul citit la început, deci suprascrie și rezervarea acelei citiri. Efectul e același 409. Fereastra o închide coada (§3), sau un marcaj „retăiere în curs” verificat de `rezervaChei` (neimplementat: ar fi un mecanism nou).
- **Între runde** (bucla din browser, sub o secundă) nu există rezervare. Un „citește” din alt tab poate trece de verificări și retăia (acțiune explicită de om); runda următoare a primei bucle cade atunci cu 409 **fără cost** (versiunea salvată e pe altă tăiere). Un „citește” de la zero **fără retăiere**, sosit exact între rundele altei bucle pe aceeași tăiere, re-plătește zonele deja citite de aceasta, iar bucla veche se oprește cu 409 fără cost. Din UI nu se poate ajunge aici, fiindcă „citește” retaie întâi. Se poate doar prin apel direct la API sau din workerul NAS, iar pentru worker regula din §3.4 pas 3 îl evită.
- **Retry-ul furnizorului** în `citesteFelie` (429/529/5xx, max. 2) rămâne. E pe aceeași rezervare, deci nu e dublură între taburi.
- O invocare ținută >7 min (imposibil pe Edge: max. 400 s; posibil în worker fără timeout, vezi §3.4 pas 4) își pierde rezervarea, iar zona poate fi preluată și plătită din nou.
- O rezervare falsă **sub plafon** (≤ now + 8 min), scrisă de un utilizator Ofertare direct în `analiza`, blochează cel mult 8 min. Restul îl limitează plafonul; poarta de scriere pe `analiza` e în afara R4 (§4).
- UI: mesajul de 409 apare ca „Eroare la citire/reluare: Zonele … în lucru în alt tab …” (prin `mesajInvoke`). La final de buclă cu zone lăsate altui tab, UI spune tot „Planșă citită”, cu sumarul parțial (`in_lucru_alt_tab` nu e afișat). E cosmetic; `src/` a rămas neatins.

## 3. Coada pe NAS (independentă de browser) — design + estimare; NEimplementată

### 3.1 De ce nu acum
Estimarea e de 6–8 h (§3.9), peste ½ zi. Coada cere **schemă nouă** și e o **automatizare nouă care cheltuie AI** (CLAUDE.md pct. 3, 4, 7). În plus, workerul NAS își ia singur codul din `main`, deci un merge o pornește imediat. Se livrează doar cu GO și cu plafonul decis de Razvan.

### 3.2 Model: job pe (document, tăiere); idempotența pe zonă rămâne cea din §2
Tabel `ofertare_plansa_coada` (fișier: `docs/R4_MIGRARE_PROPUSA_ofertare_plansa_coada.sql`): `doc_id, licitatie_id, mod (citeste|continua|reia_erori), taiat_la, cale_felii, fisier_path, doc_sha256, versiune, stare (asteapta|lucru|gata|partial|eroare|anulat|oprit_plafon), incercari/max_incercari, urmatoarea_la, luat_de/luat_la/lease_pana, runde, cost_usd, plafon_usd, jurnal, rezultat, cerut_de`.
Drepturi: `REVOKE ALL … FROM PUBLIC, anon, authenticated`, apoi doar `GRANT SELECT` pentru `authenticated`, **fără INSERT direct**. Privilegiile implicite din `public` dau `arwdDxtm` lui anon și authenticated pe orice tabel nou (SELECT pe `pg_default_acl`, 25.09.2026, rolurile `postgres` și `supabase_admin`). RLS le-ar bloca, dar nu ne bazăm doar pe RLS.
De ce job, nu rând pe zonă (cum propunea `R4_COADA_PERSISTENTA_ZONE.md` §2.1): agregarea (sumar, `rezultatCitire`, transfer, clarificare automată) stă în handler. Un rând pe zonă ar cere refactorizarea ei într-un modul separat. Cu job + handler reutilizat, avem deja pe zonă rezervarea, CAS-ul, fuziunea și versiunea.

### 3.3 Înscriere — poarta pe cheltuială în SQL
RPC `ofertare_plansa_coada_inscrie(p_doc_id, p_mod)` (`SECURITY DEFINER`, `search_path = public, pg_temp`):
- poarta: owner sau `responsabil_id` al licitației = `auth.uid()` (aceeași regulă ca `poateCheltui`), cu același mesaj și pe doc inexistent;
- cere **`tip = 'plansa'`** (40 de documente la 25.09.2026; celelalte tipuri au fluxul lor), `plansa.cale_felii` și `citibila ≠ false`;
- îngheață `taiat_la`, `cale_felii`, `fisier_path`, `doc_sha256` (din `ofertare_seap_manifest`);
- `INSERT … ON CONFLICT (doc_id, COALESCE(taiat_la,'')) WHERE stare IN ('asteapta','lucru') DO NOTHING`: dublu-click sau al doilea tab dau același job.
- **Notă (verificator, runda 2; Postgres 16 local cu tabele stub, NU Supabase):** pe un job activ existent pentru același (doc, tăiere), `ofertare_plansa_coada_inscrie` întoarce `{id, existent: true}` și **ignoră `p_mod`-ul nou** — ex. „continua” peste un „citeste” în așteptare lasă modul `citeste`. E intenționat (un singur job activ pe tăiere; workerul alege oricum modul pe starea proaspătă, §3.4 pas 3), dar UI-ul nu trebuie să afișeze modul cerut ca fiind cel pus în coadă: la implementare, răspunsul întoarce și `mod`-ul jobului existent.

UI: „📐 citește” = tăierea (Vercel, secunde, ca azi) + înscriere; mesaj „în coadă — poți închide tabul”; starea jobului se citește din tabel. Dacă heartbeat-ul workerului (`worker_heartbeat`) e mai vechi de 10 min, se păstrează bucla din browser (failover, ca la celelalte cozi).

### 3.4 Bucla workerului (`worker/ofertare/plansa.ts`, apelat din `main.ts` ca celelalte cozi, un job odată)
1. `rpc('ofertare_plansa_coada_ia', {p_worker, p_lease_min: 10})`: `FOR UPDATE SKIP LOCKED`; preia și lease-urile expirate (worker căzut); joburile peste `max_incercari` trec în `eroare`.
2. Verifică proveniența: documentul există, `plansa.taiat_la = job.taiat_la`, `cale_felii` identic. Altfel jobul devine `anulat` („planșa a fost retăiată — reînscrie”), **zero AI**.
3. Rulează **același** `handler` (import din `supabase/functions/ofertare-plansa-citeste/handler.ts`, deps cu cheia service_role, în proces). **Alegerea modului pe starea proaspătă, la fiecare rundă**:
   - `de_la:0` (resetare) doar dacă `mod='citeste'` și **nu există nicio citire pe tăierea jobului** (`citire_ai.taiat_la ≠ job.taiat_la` sau lipsește);
   - dacă există deja o citire pe tăierea jobului (a scris-o un tab, altă rundă sau o rulare anterioară a jobului), atunci `mod:'continua'` (sau `reia_erori` dacă jobul e așa), niciodată `de_la:0`, care ar re-plăti tot;
   - la final, dacă `lipire_necesara>0`, un apel `doar_lipire`.
4. **Timeout pe AI + termenul rezervării**. În worker nu mai există limita de ceas Edge (400 s) care garanta că invocarea se termină înainte să expire rezervarea de 7 min. `citesteFelie` / `lipestePereche` nu au timeout propriu. Workerul injectează prin `deps.fetch`: `fetch(u, { ...init, signal: AbortSignal.timeout(120_000) })`.
   - Rulează cu `paralel: 4`, deci o singură grupă pe rundă.
   - Cel mai rău caz pe rundă: 3 încercări × 120 s + backoff 3 s + 6 s ≈ 369 s < 420 s (termenul rezervării).
   - Alternativa, de ales la implementare: handler-ul primește un callback `laPuls` care reînnoiește `pana_la` prin CAS la fiecare 60 s cât ține runda.
   - Un apel abortat se poate factura parțial (tokenii generați până atunci). Se jurnalizează ca eroare de furnizor și se reia pe zona căzută (`reia_erori`), nu pe tot.
5. După fiecare rundă: `jurnal += {la, body, status, citite_acum, in_lucru_alt_tab, cost_usd, ms}`, `cost_usd +=`, `runde++`, `lease_pana = now()+10 min`. Actualizarea e un UPDATE condiționat `WHERE id AND luat_de = worker AND stare='lucru'`; la 0 rânduri, lease-ul e pierdut și workerul se oprește imediat (fără AI).
6. Răspunsuri:
   - **409 „în lucru în alt tab”** (un tab ține zonele sau face „citește” de la zero): pauză 60 s, apoi reîncearcă **cu `mod:'continua'`** dacă între timp a apărut o citire pe tăierea jobului, ori tot cu `de_la:0` doar dacă încă nu există niciuna. Rezervarea celuilalt expiră singură în ≤ 8 min (plafonul din §2.1), deci ajung ~8 pauze; plafon de siguranță: 10 pauze, apoi `asteapta` cu backoff;
   - **409 tăiere/versiune**: jobul devine `anulat`, cu motiv;
   - **5xx/excepție** (inclusiv abort): jobul trece în `asteapta`, `urmatoarea_la = now()+2^incercari min`; reluarea intră pe `continua`/`reia_erori` conform pasului 3;
   - eroare de business: se scrie în rând, fără throw.
7. Final: `gata` / `partial` (zone căzute) + `rezultat` = sumarul; notificare în `notifications` către `cerut_de` (`modul='Ofertare'`, permis de CHECK).

### 3.5 Idempotență (trei niveluri)
- Înscriere: index unic parțial pe job activ.
- Job: lease + UPDATE condiționat.
- Zonă: rezervarea din §2 (+ CAS + fuziune + versiune + resetare necooperantă). Workerul și un tab deschis cooperează fără plată dublă; reluarea după cădere citește doar zonele fără rezultat (pasul 3).

### 3.6 Proveniență
- Job: `doc_id`, `fisier_path`, `doc_sha256` (când documentul vine din SEAP: 16/40 planșe au sha256 în `ofertare_seap_manifest`, SELECT 25.09), `taiat_la`, `cale_felii`, `versiune`.
- Zonă: `_versiune`, `_zona`, `_regiune {pagina, unitate, x0..y1}` (deja în `citire_ai.felii`).
- Rundă: `jurnal`.

Notă: doar 7/40 planșe au `taiat_la` (SELECT 25.09); celelalte 33 sunt tăieri istorice fără el sau netăiate. La acestea cheia jobului e `taiat_la IS NULL`; recomandat: retăiere înainte de înscriere.

### 3.7 Plafon de cost
- Pe job: `plafon_usd` (valoare de decis de Razvan; repere în §1.3). La depășire jobul trece în `oprit_plafon` + notificare.
- Pe zi: suma din `ai_usage_log` pentru funcție. La depășire workerul nu mai ia joburi și notifică ownerul.
- Paralelism la furnizor: `paralel` 4 (vezi §3.4 pas 4), configurabil în worker, nu din browser.

### 3.8 Fișa de securitate (pentru `registru_automatizari`, la livrare)
- (a) Citește conținut extern: imaginea planșei (document SEAP) trimisă la AI; rezultatul e DATE.
- (b) Scrie: `ofertare_plansa_coada`, `analiza` (citire/rezervări), `ofertare_cantitati` (prin RPC-ul de transfer), `ai_usage_log`, `notifications`. Nu trimite mail și nu atinge drepturi.
- (c) Identitate: service_role în worker — necesar, pentru că scrie pe documentele oricărui responsabil. Înscrierea rulează ca utilizatorul.
- (d) Pornire: DOAR prin RPC, cu poarta owner/responsabil verificată în SQL și tip='plansa'. Claim-ul îl face doar service_role. Tabelul are REVOKE ALL pentru anon/authenticated, în afară de SELECT.
- (e) Cheltuiala o pornește doar un om (înscriere) și e plafonată.

(a) și (b) se ating, deci poarta de rol e obligatorie; e inclusă.

### 3.9 Estimare
| Pas | Durată |
|---|---|
| Migrare + RPC-uri + advisors | 1–1,5 h |
| `plansa.ts` + teste cu mock (inclusiv alegerea modului, timeout, 409) | 2–3 h |
| UI (buton, stare, failover) | 1,5–2 h |
| Test E2E pe NAS cu o planșă mică + registru | ~1 h |
| **Total** | **6–8 h** |

Sintaxa SQL propusă nu a fost rulată (DDL interzis în sesiunea asta). Se validează pe o ramură Supabase după GO.

### 3.10 Varianta fără schemă (cheie în `analiza`) — nerecomandată
`analiza.plansa_coada {cerut_de, cerut_la, mod, luat_de, lease_pana}`, scrisă de edge după poartă, cu claim prin CAS pe jeton. Merge, dar are dezavantaje:
- nu are `SKIP LOCKED`;
- nu are istoric/jurnal separat de RLS;
- aduce încă o sursă de conflicte CAS pe aceeași coloană;
- căutarea se face fără index pe JSON.

Tabelul e mai simplu de auditat.

## 4. Observații în afara R4 (de verificat, nu modificate)
- `/api/plansa-felii` cere doar un utilizator autentificat (`api/plansa-felii.js:146–151`), **fără poarta owner/responsabil**. Orice autentificat poate retăia o planșă: șterge feliile și invalidează citirea în curs. Retăierea nu costă AI, dar poate arunca o citire plătită. E candidat pentru aceeași poartă ca `poateCheltui`.
- Politica RLS `ofertare_documente_update` (`fn_are_acces_ofertare`) permite oricărui utilizator Ofertare să scrie în `analiza`, deci și în `rezervari_zone`. Plafonul din §2.1 limitează efectul unei rezervări false la ≤ 8 min.
- Cozile existente `ofertare_acoperire_coada`, `ofertare_clarificari_coada`, `ofertare_ingest_coada` au politica RLS `ALL` cu `auth.uid() IS NOT NULL` + GRANT INSERT/UPDATE pentru `authenticated`, fără triggere (SELECT pe `pg_policies`, `role_table_grants`, `pg_trigger`, 25.09). Workerul le execută cu service_role fără verificare de rol pe `cerut_de` (ex. `worker/ofertare/acoperire.ts:44–46`). Adică poarta pe cheltuială se poate ocoli prin insert direct în coadă (CLAUDE.md pct. 7d). Coada propusă în §3 NU copiază politica asta.

## 5. Agregarea rândurilor de tabel: identitatea rândului (înlocuiește dedup-ul pe mulțime și pe multiset)

### 5.1 Defectul și de ce multiset-ul nu ajungea
- **Pe `main`** (`handler.ts`, `tronsoaneUnice`), tronsoanele se deduplicau pe **mulțime**, cu cheia de text `de_la|la|L|Dn|Q|zona`. Pe planșa 470 (lic. 95), felia `z2_7` are rândurile Nr crt **37, 40, 41**, toate cu „Florenta Albu → CT, C-tin Brancoveanu, 300 m, Dn40, Q20”. Din ele rămânea unul singur, deci **−600 m pe Dn40**.
- **Runda 2** (`e762c6e`) a introdus dedup-ul pe **multiset**: pentru fiecare cheie se păstra maximul aparițiilor într-o singură felie. Verdictul Copilot: nu ajunge. Contraexemplu: felia A are rândul 37 (300 m, Dn40), felia B are rândul 40 (300 m, Dn40). Textul coincide, dar sunt două rânduri reale; max(1,1)=1, corect este 2. Am rulat contraexemplul pe cele trei funcții: mulțime = 1, multiset = 1, identitate = 2.
- **Al doilea defect, găsit la simulare pe planșa 130** (lic. 3). Același tabel e citit în două felii vecine, iar cele două lecturi transcriu diferit capetele sau zona pe 6 rânduri de tronson (în tabel diferă 13 rânduri, și la cod SIRUTA / sat), deși au aceleași L/Dn/Q. Dedup-ul pe text le număra de două ori: 24 de rânduri / 41.920 m în loc de 18 / 37.320 m (§5.4).

### 5.2 Ce identitate există efectiv în datele citite (SELECT 25.09 pe toate documentele cu `analiza->'citire_ai'`)
8 documente au citire. Tronsoane au doar 470 (399 brute), 130 (75) și 1035 (8). 471–475 au 0 tronsoane, deci nu se schimbă nimic la ele.

**Planșa 470**, `felii[].tabele[0].randuri`:
- Tabelul „Dimensionare” e tăiat de grila de zone în două coloane de felii:
  - `z?_6` are coloanele `Nr crt | Noduri de Plecare | Noduri de Sosire | Sat | Strada | Str. De la | Str. Pana la`, **fără lungime**;
  - `z?_7` are coloanele `Strada | Str. De la | Str. Pana la | Dn ales (mm) | Debit mc/h | Lungime Km`, **fără Nr**.
- Numărul de rânduri e identic în fiecare bandă: 37/37, 52/52, 52/52, 11/11. Tronsoanele din `z?_7` corespund 1:1 și în ordine rândurilor din tabel. Am verificat derivarea pe 152/152 rânduri: `de_la` = Str. De la, `la` = Str. Pana la, `zona` = Strada, L = km × 1000, Dn, Q.
- **Nu există coordonate pe rând.** `_regiune` e cea a zonei (ex. `z1_6`: x 2534–3110 pt, y 1808–2384 pt), identică pe toate rândurile feliei. Rămâne deci „aceeași ordine + câmp comun”.
- Câmpurile comune `z?_6` ↔ `z?_7` sunt `Strada`, `Str. De la` și `Str. Pana la`:
  - `Strada` și `Str. De la` sunt **identice pe toate cele 152 de perechi**;
  - `Str. Pana la` e tăiat de marginea dreaptă a lui `z1_6` pe 6 rânduri (ex. „UAT Cuza Voda” față de „UAT Cuza Voda-Limita”) și e marcat „...” pe 4 rânduri din `z4_6`.
- Geometria (`plansa.zone_geom`): `z1_6` [7040, 0, 1600, 1600] și `z1_7` [7762, 0, 1600, 1600] sunt în aceeași bandă. Benzile se suprapun vertical cu 192 px, așa că Nr 32–37, 78–83 și 123–129 apar în două benzi. Nr 1–133 sunt unice și nu am găsit nicio valoare contrazisă între benzi.

**Planșa 130:**
- Tabelul „Calcul dimensionare” are 18 rânduri, 13 coloane și **fără Nr**. Apare întreg în `z1_4` și în `z1_5` (aceeași bandă).
- 13 din 18 rânduri diferă ca text între cele două lecturi ale tabelului (18 celule: Tronson Plecare/Sosire, Cod SIRUTA Loc., Sat); în tronsoane diferă 6 rânduri (capete / zonă) — exact cele numărate de două ori de dedup-ul pe text. Secvența L/Dn/Q e identică pe toate 18.
- Citirea e veche și nu are `zone_geom`. Tabelul din banda 2 („Tronsoane / noduri”) nu are lungimi.

**Planșa 1035:** doar adnotări (8), fără tabel.

### 5.3 Regula implementată (`handler.ts:346 identificaRanduri`, apelată la l. 1267)
- **Identitate = (document, pagină, tabel identificat, Nr rând).**
  - Pagina vine din `surse_geom` prin `zone_geom` (implicit 1).
  - „Tabelul identificat” = setul de antete normalizate al fragmentului care poartă Nr.
  - Felia și regiunea rămân doar **proveniență**: `_zona`, `_regiune`, `_observatii` = feliile în care s-a văzut rândul.
- **Legarea tronson → rând.** Tronsoanele cu `sursa='tabel'` se leagă 1:1, în ordine, de rândurile tabelelor din **aceeași** felie. Rândul trebuie să conțină lungimea (în m sau km), Dn-ul și măcar un capăt. Dacă numărul nu se potrivește sau valorile diferă, rândul intră la „de verificat”.
- **Nr în altă felie decât lungimea** (cazul 470). Rândul se împerechează cu felia vecină pe orizontală din aceeași bandă (etichetă `r_c`/`r_c+1`, confirmată de `zone_geom` când există), dar **doar dacă e sigur**:
  - există un singur decalaj δ (|δ| ≤ 2; un δ ≠ 0 cere minimum 2 perechi) la care fiecare pereche are **un câmp comun identic** și **niciun câmp comun contrazis**;
  - un prefix e admis doar pe coloana tăiată de marginea feliei sau pe textul marcat „...”;
  - mai multe decalaje valide = ambiguu, adică „de verificat”.
- **Tabel fără Nr** (cazul 130). Identitatea e **poziția rândului**, admisă doar dacă toate rândurile cu lungime ale tabelului stau într-o **singură bandă verticală** (fără suprapunere verticală de deosebit) și fragmentele vecine sunt împerecheate sigur.
  - Două lecturi vecine cu lungimi se pot împerechea și pe **secvența L/Dn/Q** (decalaj unic, minimum 2 perechi). Diferențele de transcriere pe celelalte coloane sunt numărate (`perechi[].diferente_text`), dar nu schimbă identitatea.
  - Pe mai multe benzi: „de verificat”.
- **Observațiile aceleiași identități** din felii suprapuse = **un rând**.
  - **L, Dn sau Q diferite = CONFLICT** în `sumar.conflicte[]`, cu toate variantele și feliile lor. Nu se alege automat nicio valoare, iar rândul nu intră în totalul sigur.
  - Un Q lipsă într-o lectură nu e conflict.
- **Rândurile fără identitate sigură** (Nr lipsă sau ilizibil, împerechere nesigură sau ambiguă, tronson nelegat de un rând, același Nr sub antete diferite pe aceeași pagină) intră la **„de verificat”**. Fiecare lectură se păstrează separat, cu motivul ei: nu dispare și nu se contopește pe text.
- **Adnotările** rămân pe regulile R5: dedup pe mulțime (fără multiset, fără identitate) și nu intră în total când există tabel. „Există tabel” include și rândurile „de verificat”: o planșă cu tabel nesigur nu trece pe adnotări.
- **Sumarul** (`citire_ai.sumar`):
  - `total_sigur_m` = rândurile cu identitate sigură fără conflict, înainte de filtrul de Dn nestandard;
  - `total_de_verificat_m` = lecturile fără identitate (brut) + varianta maximă a fiecărui conflict (plafon);
  - `conflicte[]`, `randuri_fara_identitate[]` (+ `_n`), `identitate_randuri` (lecturi, sigure prin Nr / prin poziție, fără identitate, conflicte);
  - un avertisment când există rânduri de verificat.
  - `lungime_totala_m` / `tronsoane_gasite` rămân cifra care intră în cantități (sigur − nestandard).
- `COD_VERSIUNE` 2026-09-25.6 → **.7** → **2026-09-26.8** (runda 4, mai jos).

**Runda 4 (26.09, verificatorul rundei 3).** Principiul Copilot: nicio pierdere și nicio umflare **tăcută**. Ce nu e sigur trece la „de verificat”, cu total separat și motiv. Regulile noi din `identificaRanduri`:
- **Poziția e identitate doar dacă niciun fragment din tabel nu are coloană Nr.** Tabelul = grupul fragmentelor împerecheate sigur. Rândul fără Nr dintr-un fragment împerecheat cu unul care are Nr intră la de verificat, cu motivul `MOTIV_AFARA_NR` („rând în afara fragmentului cu Nr”). Asta repară **blocantul**: rândul de margine transcris doar în felia cu lungimi (ex. Nr 38 în plus la baza lui `z1_7`) primea `poz z1_7#38` și se număra încă o dată prin Nr în banda 2. Efectul: 470 ieșea 49.225 m în loc de 48.905, fără niciun semnal. Tot aici: rândul legat de un Nr ilizibil din felia vecină merge la „Nr lipsă sau ilizibil pe rând (în felia vecină, împerecheată)”, nu primește poziție.
- **Nr repetat.** Același (tabel, Nr) citit pe noduri din aceeași felie, dar în componente diferite, intră la de verificat: „Nr X repetat — tabel neidentificat sigur”. Acoperă două tabele cu antete identice (C) și numerotarea reluată (C2). Aceeași regulă se aplică și pentru benzi sau coloane nevecine (|Δr|>1 sau |Δc|>1; grilă necunoscută = nevecine), adică felii care nu se pot suprapune (B).
- **Text contrazis.** Lecturile aceleiași identități din componente diferite (ex. suprapunerea verticală) care diferă pe o coloană de text comună (Strada / De la) nu se contopesc. Toate intră la de verificat. Comparația ignoră spațiile, punctuația și diacriticele, iar prefixul e admis la margine sau pe textul marcat „...”.
- **Cheia de poziție** conține indexul tabelului din felie (`poz z1_2.t2#1`). Cazul D (două tabele fără Nr cu antete identice în aceeași felie) dă acum 4 rânduri / 950 m. Pe a800d38 dădea 300 m sigur + un conflict fals, iar 300 m se pierdeau. Același tabel fără Nr transcris de două ori în aceeași felie (aceleași rânduri L/Dn/Q) intră la de verificat: „posibilă transcriere dublă”.
- **Semnale noi, fără metri:**
  - `perechi[].randuri` / `neimperecheate` = numărul diferit de rânduri între fragmentele împerecheate, inclusiv la δ=0;
  - `nrFaraLungime` → `sumar.nr_fara_lungime` (+ `_n`) și un avertisment = rânduri numerotate dintr-un fragment cu Nr împerecheat cu lungimi, al căror Nr nu primește nicio lungime în nicio felie.
- Pe 470 (fixture = BD) nimic nu se schimbă: 133 de rânduri, 48.905 m, 0 de verificat, 0 conflicte. Cele 19 rânduri din suprapunerea verticală trec și de controlul de text. În afara feliilor `z?_6`/`z?_7`, 470 mai are un singur tabel: cartușul din `z5_6`, fără Nr și fără lungimi (SELECT 26.09). Pe 130 nici antetele nu au coloană Nr („Tronsoane”, „Tronson”; SELECT 26.09), iar tabelul cu lungimi stă în `z1_4`/`z1_5`, în aceeași bandă și în felii diferite. Am rulat regula veche și pe cea nouă pe o transcriere compactă a lui `z1_4`/`z1_5` (9 din 13 coloane plus tronsoanele, md5 identic cu BD pe toate 4 blocurile). Ambele dau 18 rânduri prin poziție / 37.320 m (Dn250 30.970, Dn180 1.105, Dn160 5.245), cu 0 de verificat.

### 5.4 Efect (simulat pe citirile salvate; nimic scris în BD)
| | azi (BD) | multiset (`e762c6e`) | **identitate de rând** |
|---|---|---|---|
| 470 `total_sigur_m` | — | — | **48.905 m** (133 rânduri, toate prin Nr; 152 de lecturi; 19 rânduri văzute în două benzi) |
| 470 în cantități (`lungime_totala_m` / `tronsoane_gasite`) | 48.195 / 130 | 48.795 / 132 | **48.795 / 132** |
| 470 Dn40 | 13.140 | 13.740 | **13.740** (Nr 40, 41 adăugate; Nr 37 văzut în `z1_7` și `z2_7` = o dată) |
| 470 Dn200 / 125 / 110 / 90 / 63 | 17.785 / 2.275 / 780 / 4.545 / 9.670 | neschimbate | neschimbate |
| 470 de verificat / conflicte | — | — | **0 / 0** |
| 470 adnotări neconfirmate | 75 / 34.732 m | 88 / 37.472 m | **75 / 34.732 m** (fără multiset, ca în BD) |
| 470 `posibile_dubluri` / adnotări pe Dn absent | 52 / 3 (1.770 m) | 63 / 3 | 52 / 3 (1.770 m) |
| 470 `tronsoane_unice` | 206 | 221 | 208 (133 rânduri + 75 adnotări) |
| 130 în cantități | 41.920 / 24 | 41.920 / 24 | **37.320 / 18** (prin poziție; Dn250 30.970, Dn180 1.105, Dn160 5.245) |
| 1035 | 167.200 / 5 (adnotări) | idem | idem |

**Nr 57** (Florenta Albu, Crinului → Rozelor, **Dn60**, 110 m) are identitate sigură, deci intră în `total_sigur_m` = 48.905. Pe el se aplică **regula existentă pentru Dn nestandard**: e scos din cantități (`diametre_nestandard: [60]`, `nestandard_m: 110`), de aceea în cantități rămân 132 de rânduri / 48.795 m. În plus, acum e numit în `diferenta_nota` la transfer (§5.5).

**Planșa 130 / lic. 3 (constatare, nemodificată).** `ofertare_cantitati` (SELECT 25.09, scrise la 15.09 din planșa 1.1) are `cantitate_plansa` = 34.465 (id 1, Dn250), 2.210 (id 2, Dn180), 5.245 (id 3, Dn160) și 41.920 (id 4, TOTAL).
- Cu identitatea de rând, cifrele planșei sunt 30.970 / 1.105 / 5.245 / 37.320. Deci id 1, 2 și 4 sunt umflate cu +3.495 / +1.105 / +4.600 m din cauza celor 6 rânduri numărate de două ori.
- `cantitate` (memoriul: 23.630 / 1.100 / 5.250 / 37.320) nu e afectată.
- Totalul corect din planșă (37.320) e egal cu totalul memoriului. Pe Dn250, diferența față de memoriu devine +7.340 m (în BD: +10.835).
- Corecția e o modificare de date: se face doar prin preview → GO → apply.

### 5.5 Transferul în cantități (`treciInCantitati`, l. 679; `notaRestTransfer`, l. 656; `descriereRestDn`, l. 649)
- `cantitate_plansa` primește **doar** rândurile cu identitate sigură, fără conflict și cu Dn standard.
- Restul **nu se promovează**. E numit în `diferenta_nota`, pe fiecare poziție atinsă și pe rândul de total:
  - rândurile fără identitate de pe Dn-ul poziției;
  - apoi, pe planșă, numărul și metrii fără identitate, conflictele cu variantele lor și Dn-urile nestandard.
- Retransferul simulat al lui 470 peste 1751–1756 (test „identitate 470: retransfer…”):
  - **1756 Dn40:** `cantitate_plansa` 13.140 → **13.740**, `status` extras → diferenta, `diferenta_nota` = „Memoriu 13.140 m vs planșa 1 13.740 m (+600 m, pe 56 tronsoane citite din tabel). De verificat, NEincluse în cifra din planșă: pe planșă: Dn nestandard Dn60: 110 m.”
  - **`cantitate` rămâne 13.140** (RPC-ul nu o atinge);
  - 1751–1755 rămân neschimbate ca cifre, iar nota lor devine „Planșa 1 confirmă: … De verificat, NEincluse …”;
  - 0 inserări.
- Rămân **nemodificate** (în afara fix-ului): eticheta „Memoriu” pe cifra venită din planșa însăși și „confirmă” pe propriile cifre.
- Cum s-ar ajunge la retransfer: „continuă” / „reia” nu retransferă (transfer `facut` pe aceeași rulare; după o schimbare de `COD_VERSIUNE` — acum 2026-09-26.8 — sunt refuzate fără `mixare_permisa`). Rămâne doar un „citește” complet, adică retăiere + ~35 de zone plătite (ultima citire completă a lui 470: 2,595 USD în 9 runde).

**Runda 4 — Dn cu TOATE rândurile „de verificat”** (verificatorul, MAJOR; test ADV-T). Pe `a800d38`, `peDiametru` se construia doar din rândurile sigure. Consecințele:
- poziția unui Dn fără niciun rând sigur păstra tăcut `cantitate_plansa` și nota dintr-o citire anterioară;
- fără niciun rând sigur pe planșă, `if (!peDiametru.size) return` ieșea fără nicio scriere.

Acum:
- `notaRestTransfer` numără pe Dn și **conflictele** (`c`, cu plafonul `mc` = varianta maximă). Un Dn doar cu conflicte nu mai scapă.
- Pentru fiecare Dn din `rest.peDn` fără grup sigur (aceeași potrivire pe denumire ca la rândurile sigure):
  - poziție **validată / „diferenta”** ⇒ update **doar pe notă**, ex. „De verificat: 2 rânduri Dn250 fără identitate sigură (10.350 m); cifra din planșă nu s-a actualizat (34.465 m e dintr-o citire anterioară). Pe planșă: …”. Decizia omului rămâne, iar cifra veche e numită drept veche;
  - poziție **„extras”** (nevalidată) ⇒ `cantitate_plansa = null`, `status = 'diferenta'` și nota „… cifra din planșă s-a golit (era 2.210 m, dintr-o citire anterioară)”;
  - mai multe poziții pe același Dn ⇒ `ambigue[]` (cu `de_verificat`). Nicio poziție sau Dn necunoscut ⇒ raportat în `cantitati.doar_de_verificat[]` (`fara_pozitie` / `fara_dn`). Din rânduri nesigure **nu se inserează** poziții.
- **Fără early-return** cât timp există rest de menționat. Dacă nu există niciun rând sigur, TOTAL **nu devine 0 m**: primește aceeași notă, sau golire dacă e „extras”.
- RPC-ul (live, `pg_get_functiondef` 26.09) aplică `cantitate_plansa` doar când cheia există în patch. Update-ul doar pe notă nu atinge cifra, iar `null` explicit o golește.
- (verificator, minor) Pe un Dn cu rânduri de verificat:
  - poziția **nouă** (doar partea sigură) intră cu `status = 'diferenta'`, nu „extras”;
  - o poziție existentă „extras” trece tot în „diferenta”, chiar dacă cifra sigură egalează memoriul.

**1756 — două variante, decizie separată pentru Razvan** (verificator, minor). Codul de retransfer schimbă **doar** `cantitate_plansa`; `cantitate` rămâne neatinsă (testul „identitate 470: retransfer…”: 13.140). Poziția 1756 a fost însă *creată* din planșă (`cantitate` = `cantitate_plansa` = 13.140), deci se poate argumenta și corectarea lui `cantitate`:
- **Varianta A — doar `cantitate_plansa`** (ce ar face un retransfer): `cantitate` rămâne 13.140, iar poziția arată „memoriu 13.140 vs planșă 13.740”.
- **Varianta B — `cantitate` + `cantitate_plansa`** (SQL-ul de mai jos): ambele devin 13.740.

Corecția se face în reconcilierea R5, prin **preview → GO Razvan (A sau B) → apply**. SQL-ul e **neexecutat**. `analiza.citire_ai.sumar` al lui 470 rămâne 48.195 m până la o nouă citire.
```sql
-- PREVIEW
SELECT id, denumire, cantitate, cantitate_plansa, status, diferenta_nota, updated_at FROM ofertare_cantitati WHERE id = 1756;
-- APPLY varianta A (doar după GO Razvan; condiționat pe valorile de azi => 0 rânduri dacă s-a schimbat ceva)
-- UPDATE ofertare_cantitati SET cantitate_plansa = 13740, status = 'diferenta',
--        diferenta_nota = 'Memoriu 13.140 m vs planșa 1 13.740 m (+600 m: Nr 40 și 41, C-tin Brâncoveanu Dn40 300 m, identice ca text cu Nr 37; deduplicare pe identitatea rândului). Neincluse: Nr 57 Dn60 nestandard 110 m, de verificat.',
--        updated_at = now()
--  WHERE id = 1756 AND licitatie_id = 95 AND cantitate = 13140 AND cantitate_plansa = 13140
-- RETURNING id, cantitate, cantitate_plansa, status, updated_at;
-- APPLY varianta B (doar după GO Razvan)
UPDATE ofertare_cantitati
   SET cantitate = 13740, cantitate_plansa = 13740,
       diferenta_nota = 'Diametru care nu apare în cantitățile din memoriu. 56 tronsoane citite din tabelul planșei (corecție 25.09: +600 m — rândurile Nr 40 și 41, C-tin Brâncoveanu Dn40 300 m, identice ca text cu Nr 37, erau numărate o dată; deduplicare pe identitatea rândului). Neincluse: Nr 57 Dn60 nestandard 110 m, de verificat.',
       updated_at = now()
 WHERE id = 1756 AND licitatie_id = 95 AND cantitate = 13140 AND cantitate_plansa = 13140
RETURNING id, cantitate, cantitate_plansa, updated_at;
-- ROLLBACK (A sau B; valorile de azi, SELECT 25.09, inclusiv status și updated_at):
-- UPDATE ofertare_cantitati SET cantitate = 13140, cantitate_plansa = 13140, status = 'extras',
--        diferenta_nota = 'Diametru care nu apare în cantitățile din memoriu. 54 tronsoane citite din tabelul planșei.',
--        updated_at = '2026-09-25 16:51:08.040401+00'
--  WHERE id = 1756;
```

### 5.6 Teste
- **Fixture reală** `fixture_470.ts`: feliile `z1_6..z4_7`, reduse la Nr, Strada, Str. De la, Str. Pana la (`z?_6`) și la rândul complet + tronsoanele (`z?_7`); antetele sunt exact ca în BD. Transcrierea e verificată prin SELECT față de fișier, pe fiecare din cele 8 felii: număr de rânduri, suma Nr, suma L și md5 pe câmpurile păstrate, **toate identice** (ex. `z2_6`: 52 de rânduri, ΣNr 2990, md5 `f36087…`; `z2_7`: ΣL 11.600, md5 tronsoane `552ee3…`).
- **`agregare_test.ts`** (26 de teste: 17 din runda 3 + 9 din runda 4), cazurile cerute în runda 3:
  - (1) Nr 37/40/41 cu text identic = 3 rânduri, și în aceeași felie, și cu Nr în `z2_6` / L în `z2_7`;
  - (2) același Nr în două felii suprapuse = o dată;
  - (3) contraexemplul Copilot = 2;
  - (4) conflict pe L (raportat, în afara totalului sigur, plafon 330 m) și pe Dn;
  - (5) 6 lecturi fără identitate (fără tabel, câmp comun contrazis, Nr ilizibil, împerechere ambiguă cu 3 rânduri identice), totalul lor separat 1.800 m, iar adnotarea nu devine sursă;
  - (6) fixture 470: 133 de rânduri prin Nr, 48.905 m, 0 de verificat, perechile `z?_6+z?_7` cu δ=0, Nr 57 → nestandard, cantități 132 / 48.795, Dn40 13.740.

  Plus: poziția (130) + garda multi-bandă, antete diferite, adnotări fără multiset, `nrRand`, 470 fără `z?_6` (152 de lecturi, toate de verificat).
- **`concurenta_test.ts`:**
  - retransferul 470 prin handler (8 zone `z?_6`/`z?_7`, 2 runde, 8 apeluri AI simulate);
  - transfer cu rânduri de verificat (doar 300 m sigur ajung în `cantitate_plansa`; nota numește 250 m fără identitate și conflictul Nr 2 320/330 m);
  - mock-ul `aiDn` primește acum tabelul cu Nr (fără el, rândul ar fi „de verificat”).
- **Controale negative** (mutații pe o copie a funcției, testele neschimbate):

  | Mutație | Teste care pică |
  |---|---|
  | identitate pe text | 8 |
  | conflict ignorat | 3 |
  | împerechere care acceptă câmp contrazis | 5 |
  | fără garda de bandă pentru poziție | 2 |
  | fără prefixul de margine | 2 (fixture 470: banda 1 nu s-ar mai împerechea) |

- **Runda 4 — testele adversariale ale verificatorului, devenite regresie.** Fiecare pică pe `a800d38`: rulate pe o copie din scratchpad cu handler-ul de la `a800d38`, la care am adăugat doar exportul constantei de motiv, ca importul să se lege. Eșecul e pe aserțiunea de fond (totaluri / starea din BD), nu pe câmpurile noi. Singura excepție e testul de semnal `nr_fara_lungime`, unde lipsa semnalului e chiar defectul.

  | Test (runda 4) | Rezultat acum | Pe `a800d38` |
  |---|---|---|
  | BLOCANT sintetic: rândul 4 doar în `z1_7`, banda 2 îl are cu Nr | 5 rânduri / 1.500 m sigur + 400 m de verificat (`MOTIV_AFARA_NR`); `neimperecheate` [0, 1] | 6 / 1.900 m, 0 de verificat |
  | BLOCANT fixture 470: Nr 38 în plus la baza lui `z1_7` / Nr 31 în plus la vârful lui `z2_7` | 133 / **48.905 m** în ambele variante + rândul în plus la de verificat (320 m, respectiv L-ul Nr 31) | 134 / 49.225 m și 134 / 49.205 m, 0 de verificat |
  | C: două tabele cu antete identice în aceeași felie, Nr 1–2 fiecare | 0 sigure, 4 lecturi / 1.200 m de verificat („Nr repetat … de două ori în z2_3”) | 2 / 600 m |
  | C2: numerotare reluată în același tabel | 0 sigure, 1.200 m de verificat | 2 / 600 m |
  | B: același tabel/Nr în `z1_2` și `z3_5` (nevecine) | 0 sigure, 1.800 m de verificat; control: `z1_2`/`z2_2` (vecine) = 3 / 900 m | 3 / 900 m |
  | D: două tabele fără Nr, antete identice, aceeași felie | 4 / **950 m** (`poz z1_2.t1#1` … `t2#2`); același tabel transcris de 2 ori ⇒ 1.000 m de verificat | 300 m + conflict fals 200/150, 300 m pierduți |
  | text: același Nr în benzi vecine, Strada diferită | 0 sigure, 1.200 m de verificat; control: „C-tin Brancoveanu” / „Ctin  Brâncoveanu” și „Limita intra...” = același rând | 2 / 600 m |
  | Nr ilizibil în felia cu Nr, rândul împerecheat din felia cu L | de verificat (motiv „în felia vecină”) | `poz z1_7#2` sigur |
  | Nr fără nicio lungime (felia cu L a pierdut rândul de margine) | `nrFaraLungime` = [Nr 4, z1_6] + avertisment | nimic (lipsă tăcută) |
  | transfer (handler): Dn250 / Dn180 doar de verificat, Dn160 sigur | id 1 („diferenta”): 34.465 păstrat, nota „… nu s-a actualizat (34.465 m e dintr-o citire anterioară)”; id 2 („extras”): `cantitate_plansa` null, „diferenta”; 0 inserări | id 1 cu „NOTA VECHE”, id 2 cu 2.210 |
  | transfer (handler): niciun rând sigur | RPC rulat; Dn250 „extras” golit; TOTAL validat: 34.465 păstrat + notă, **nu 0 m** | early-return: 0 scrieri, cifre și note vechi |

  În `concurenta_test.ts`, transferul cu rânduri de verificat verifică acum și `status = 'diferenta'` la inserare. Nota numește și conflictul pe Dn40 („1 conflict Dn40 (până la 330 m)”).
- **Controale negative runda 4** (mutații pe o copie a handler-ului nou, cu testele neschimbate; copia nemutată trece 75/75 pe `agregare_test.ts` + `concurenta_test.ts`):

  | Mutație | Teste care pică |
  |---|---|
  | fără interdicția poziției în grupul cu Nr | 2 (blocant sintetic + 470) |
  | fără „Nr repetat” | 3 (B, C, C2) |
  | cheie de poziție fără indexul tabelului | 1 (D) |
  | fără textul contrazis | 1 |
  | fără tratarea Dn-urilor doar de verificat | 2 (transfer) |
  | fără „Nr ilizibil în vecină” | 1 |
  | benzi nevecine permise | 1 (B) |
  | fără garda „tabel dublat” | 1 (D) |

### 5.7 Limite cunoscute (documentate, nu blochează)
- `total_de_verificat_m` e un **plafon brut**: fiecare lectură fără identitate se adună separat, deci un rând din suprapunerea verticală poate fi numărat de două ori; conflictele intră cu varianta maximă.
- Două tabele **cu antete identice** și Nr care se suprapun:
  - în aceeași felie, sau în felii nevecine ⇒ „de verificat” (runda 4: „Nr repetat”);
  - în benzi sau coloane **vecine**, cu text diferit pe o coloană comună (Strada / De la) ⇒ „de verificat” (runda 4: text contrazis);
  - în benzi vecine, cu L/Dn/Q diferite ⇒ conflict (vizibil);
  - **rămâne neacoperit:** în benzi vecine, cu L, Dn, Q **și** text identice pe coloanele comune. Nu se pot deosebi de suprapunerea verticală a aceluiași tabel (fără coordonate pe rând), deci se numără ca un rând. Subnumărarea e posibilă doar dacă două rânduri din tabele diferite sunt identice pe toate coloanele citite.

  Cu antete diferite și același Nr ⇒ „de verificat”.
- Garda „tabel dublat” (tabel fără Nr transcris de două ori în aceeași felie) prinde doar dublura **identică** pe toată secvența L/Dn/Q. O transcriere dublă parțială s-ar număra ca două tabele.
- `nrFaraLungime` semnalează rândurile numerotate fără lungime doar pentru fragmentele cu Nr împerecheate sigur cu o felie cu lungimi. Dacă împerecherea eșuează, toată banda trece oricum la „de verificat” (ADV-H).
- Comparația de text (runda 4) poate trimite la „de verificat” și două lecturi ale aceluiași rând transcrise foarte diferit, ex. o abreviere („Str. Florenta Albu” / „Florenta Albu”). Asta e fail-safe, nu tăcut; pe 470 nu apare niciun caz (19/19 rânduri din suprapunere trec).
- La transfer, o poziție validată sau „diferenta” pe un Dn doar de verificat își păstrează `cantitate_plansa` din citirea anterioară, iar nota o numește explicit veche. Rândul TOTAL primește, când există rânduri sigure, doar partea sigură (cu restul numit în notă).
- Împerecherea caută doar între felii vecine direct (c, c+1); un Nr aflat la două felii distanță ajunge la rând doar prin fragmentul din mijloc, dacă are câmpuri comune cu ambele.
- Identitatea depinde de `tabele[].randuri`. Promptul (`INSTRUCTIUNI`) cere deja tabelele cu rânduri și nu s-a schimbat; o citire care n-ar transcrie rândurile ar da totul „de verificat”, nu un total pe text.
