# R4 — fără apeluri AI duplicate între taburi (rezervare pe zonă) + coada pe NAS (design)

Data: 25.09.2026 (noapte) · Răspuns la verdictul Copilot: „Rămân coada independentă de browser și prevenirea apelurilor AI duplicate între taburi.”
Runda 2 (după verificator): defectul major „citește de la zero cooperează” reparat + test; plafon pe `pana_la`; `/api/plansa-felii` fail-closed; corecturi de text; design NAS completat (§3). Plus un bug nou de agregare găsit pe planșa 470 (§5, commit separat).
Runda 3 (verdictul Copilot pe deduplicare): dedup-ul pe multiset (`e762c6e`) e înlocuit cu **identitatea rândului de tabel** — (document, pagină, tabel identificat, Nr rând) — commit `a800d38` (§5).
Runda 4 (26.09, verificatorul rundei 3): rândul de margine nu mai primește identitate prin poziție când tabelul are coloană Nr (blocant); Nr repetat / benzi nevecine / text contrazis / indexul tabelului în cheia de poziție (major); Dn cu toate rândurile de verificat menționat la transfer, fără early-return (major); `COD_VERSIUNE` 2026-09-26.8 (§5.3, §5.5).
Runda 5 (26.09, verificatorul rundei 4): poziția e interzisă în **coloana de felii a unui tabel cu Nr**, chiar dacă felia cu Nr din banda rândului lipsește sau are antete transcrise altfel (blocant V1–V4: 470 dădea 50.105 m sigur, tăcut); restul de la transfer are cheia **(Dn, material)**, ca grupurile sigure (major); TOTAL „extras” cu rest ⇒ „diferenta”, `perechi_neimperecheate` în sumar, SQL-ul 1756 cu ambele variante comentate (minore); `COD_VERSIUNE` 2026-09-26.9 (commit `f1274a1`; §5.3, §5.5–5.7).
Runda 6 (26.09, verificatorul rundei 5): vecinătatea feliilor pe **geometria reală** `zone_geom` (coloana fixată la marginea planșei acoperă și `_N-1`); două grupuri sigure pe aceeași poziție ⇒ ambiguu, nimic suprascris; `COD_VERSIUNE` 2026-09-26.10 (commit `f1c4b66`; confirmat de verificatorul rundei 6: 0 blocante, 0 majore, 3 minore).
Runda 7 (26.09, verdictul Copilot + minorele verificatorilor rundei 6 și ai documentului R5): regresiile obligatorii **COPILOT-REG-1…4** ca teste; cele **4 căi tăcute** rămase devin vizibile (B1 fără geometrie sub coloana fixată, B2 dublă parțială, B3 goluri în secvența Nr, B4 comasare peste capacitatea fâșiei / integrală); ADV7-M5, TOTAL, MY-T4, feliile identice în `api/plansa-felii.js`, rollback-ul 1756 condiționat; `COD_VERSIUNE` 2026-09-26.11 (commit-uri `f4406c7`, `cc2c77f`, `05b92cb`; §5.3, §5.5–5.7).
Ramură locală: `claude/r4-rezervare-zone` (bază `main` @ `8a6fbbb`; numerele de linie din §2 și §5 sunt pe capul ramurii). **Nimic deployat, nimic pushat, nicio scriere în BD** (doar SELECT-uri).

**Verdict propus: PARȚIAL.**

Teste finale pe ramură (pe capul ramurii, după runda 7; toate cu `--node-modules-dir=none --no-lock`, `deno.lock` neatins, md5 `875e293d…`):

| Comandă | Rezultat |
|---|---|
| `deno test supabase/functions/ofertare-plansa-citeste` | **122/122** (după `f1c4b66`: 109/109; după `f1274a1`: 100/100; după `a9fe186`: 89/89; după `a800d38`: 78/78) |
| `deno test -A supabase/functions/` | **139/139** (după `f1c4b66`: 126/126; după `f1274a1`: 117/117; după `a9fe186`: 106/106; după `a800d38`: 95/95) |
| `concurenta_test.ts` rulat de 10 ori | 10/10 verzi, 63/63 de fiecare dată |
| `node scripts/test-cas-felii.mjs` | **34/34** |
| `node scripts/test-detector-sigla.mjs` | 30/30 (+7 verificări `zoneTaiere`, runda 7) |
| `npx vitest run` (atinge `api/`) | 372/372 |
| `node scripts/verifica-poarta-identica.mjs` | OK |
| `deno check` pe `index.ts` | OK |

Testele noi pică pe codul vechi: cu gărzile de resetare dezactivate pică 5 teste de resetare. Pentru identitatea rândului, mutațiile pe o copie a funcției (identitate pe text / conflict ignorat / împerechere laxă / fără garda de bandă / fără prefixul de margine) fac să pice 8 / 3 / 5 / 2 / 2 teste (§5.6); pe contraexemplul Copilot, dedup-ul pe mulțime și cel pe multiset dau 1 rând, identitatea dă 2. Runda 4: toate cele 11 teste noi pică pe `a800d38` (copie în scratchpad), iar 8 mutații pe regulile noi fac să pice 1–3 teste fiecare (§5.6). Runda 5: toate cele 11 teste noi pică pe `a9fe186`, iar 7 mutații pe regulile noi fac să pice 1–6 teste fiecare (§5.6).

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
- Rezervarea se face prin **CAS** (`concurenta.ts:211 rezervaChei`). Lotul se calculează pe documentul **proaspăt** (`handler.ts:1535 planifica`). Se exclud zonele rezervate activ de **altă** rulare pe **aceeași** tăiere (`concurenta.ts:170 rezervateDeAltii`), apoi se scriu rezervările (jeton `rezervari_zone.rev` nou, `:178 rezervariNoi`). La conflict se recalculează, pentru că alt tab a rezervat între timp.
- Toate candidatele rezervate de alții: **409** „Zonele … sunt în lucru în alt tab (altă rulare), rezervate până la HH:MM — nu s-a apelat AI, nu s-a plătit nimic” + `in_lucru`, `rezervat_pana_la`, `cost_usd: 0` (`handler.ts:705–708`). Zero AI, zero scrieri.
- **„Citește” de la zero NU cooperează** (defectul major găsit de verificator, reparat în runda 2): scrierea unei resetări pleacă de la baza `[]` (înlocuiește citirea). La reîncercarea CAS ar fi aruncat rezultatele plătite ale rulării care ținea zonele. Acum, orice rezervare activă a altei rulări pe tăierea curentă (zone sau perechi de note) dă 409 „în lucru în alt tab”, zero AI (`handler.ts:696`). **Simetric**, rezervările unei resetări poartă `resetare: true`. Cât sunt active, „continuă”, „reia zonele căzute”, runda următoare a altei bucle (`de_la>0`) și „note tăiate” primesc 409 fără AI (`handler.ts:700–702`, `:588`). Motivul: scrierea resetării le-ar fi aruncat rezultatele după plată. Astfel o resetare nu coexistă niciodată cu altă rulare activă pe aceeași tăiere.
- În rest (fără resetare), rezervarea parțială înseamnă cooperare: tabul curent citește doar restul, `in_lucru_alt_tab` apare în răspuns, iar bucla nu mai cere runde pentru zonele celuilalt (`maiSunt`). La `de_la>0`, o zonă citită deja bine în citirea curentă nu se mai plătește; `de_la_urmator` avansează după ultima zonă din lot (`handler.ts:714`).
- Eliberare: la scrierea rezultatului (`handler.ts:1775 rzCurat`: scoate rezervările rulării curente, curăță expiratele / altă tăiere); la eșec (excepție în AI `:1595`, CAS epuizat `:1823`) eliberarea e best-effort (`concurenta.ts:239 elibereazaRezervari`).
- **Expirare**: `REZERVARE_EXPIRA_MS = 7 min` (`concurenta.ts:155`), peste limita de ceas Edge (150 s Free / 400 s plătit, docs Supabase „Edge Functions / Limits”). Dacă tabul se închide sau funcția e omorâtă, zona se **preia** automat după expirare.
- **Plafon pe `pana_la`** (runda 2): o rezervare e activă doar dacă `now < pana_la <= now + 7 min + 60 s` (`TOLERANTA_CEAS_MS`, `concurenta.ts:161–166` `rezActiva`; aceeași regulă în `api/_cas.js:16–26` `rezervariActive`, constantele verificate identice în `scripts/test-cas-felii.mjs`). O rezervare coruptă sau scrisă de mână (`pana_la = 2099`; politica RLS de update pe `analiza` e a modulului Ofertare, nu doar a ownerului) e tratată ca expirată. Nu blochează nici citirea, nici retăierea, și se curăță la următoarea scriere.
- Rezervările de pe **altă tăiere** sunt ignorate, pentru că zonele nu mai corespund.
- Toate scrierile CAS din edge filtrează acum și pe `analiza->rezervari_zone->>rev` (`concurenta.ts:18 CALE_REZ`, `:107`). O scriere a citirii nu mai poate șterge pe tăcute rezervarea făcută de alt tab. RPC-ul de transfer folosește `jsonb_set` pe `citire_ai`, deci nu atinge rezervările.
- **Retăierea** (`api/plansa-felii.js`) e refuzată cu 409 cât există zone rezervate active pe tăierea curentă. Verificări:
  - la început (l. 187, pe documentul citit);
  - pe starea **proaspătă**, înaintea fiecăreia dintre cele 3 scrieri „necitibilă” (l. 267/278/288; acestea înlocuiesc tot `plansa`, iar `taiat_la` dispare);
  - pe starea proaspătă, chiar înainte de ștergerea feliilor (l. 331).

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
- **Fereastra tăiere+upload** în `/api/plansa-felii`: după ultima re-verificare (l. 331), feliile vechi se șterg și cele noi se taie și se urcă **secvențial**: până la 60 de felii (`MAX_FELII`) sau 80 (`MAX_FELII_FIN`), fiecare cu `sharp` extract + jpeg + stats + upload, cu `maxDuration` 300 s (`vercel.json`). Fereastra e de **zeci de secunde, până la ~1 min**. O citire care rezervă în fereastra asta plătește o rundă (≤4 zone) și o pierde (409 la scriere). Scrierea finală a tăierii (CAS doar pe `citire_ai.rev`) pleacă de la documentul citit la început, deci suprascrie și rezervarea acelei citiri. Efectul e același 409. Fereastra o închide coada (§3), sau un marcaj „retăiere în curs” verificat de `rezervaChei` (neimplementat: ar fi un mecanism nou).
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

### 5.3 Regula implementată (`handler.ts:430 identificaRanduri`, apelată la l. 1656)
- **Identitate = (document, pagină, tabel identificat, Nr rând).**
  - Pagina vine din `surse_geom` prin `zone_geom` (implicit 1).
  - „Tabelul identificat” = setul de antete normalizate al fragmentului care poartă Nr.
  - Felia și regiunea rămân doar **proveniență**: `_zona`, `_regiune`, `_observatii` = feliile în care s-a văzut rândul.
- **Legarea tronson → rând.** Tronsoanele cu `sursa='tabel'` se leagă 1:1, în ordine, de rândurile tabelelor din **aceeași** felie. Rândul trebuie să conțină lungimea (în m sau km), Dn-ul și măcar un capăt. Dacă numărul nu se potrivește sau valorile diferă, rândul intră la „de verificat”.
- **Nr în altă felie decât lungimea** (cazul 470). Rândul se împerechează cu felia vecină pe orizontală din aceeași bandă (din runda 6: felii care se ating pe geometria reală `zone_geom`; fără geometrie, eticheta `r_c`/`r_c+1`), dar **doar dacă e sigur**:
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
- `COD_VERSIUNE` 2026-09-25.6 → **.7** → **2026-09-26.8** (runda 4) → **2026-09-26.9** (runda 5) → **2026-09-26.10** (runda 6) → **2026-09-26.11** (runda 7, mai jos).

**Runda 4 (26.09, verificatorul rundei 3).** Principiul Copilot: nicio pierdere și nicio umflare **tăcută**. Ce nu e sigur trece la „de verificat”, cu total separat și motiv. Regulile noi din `identificaRanduri`:
- **Poziția e identitate doar dacă niciun fragment din tabel nu are coloană Nr.** Tabelul = grupul fragmentelor împerecheate sigur. Rândul fără Nr dintr-un fragment împerecheat cu unul care are Nr intră la de verificat, cu motivul `MOTIV_AFARA_NR` („rând în afara fragmentului cu Nr”). Asta repară **blocantul**: rândul de margine transcris doar în felia cu lungimi (ex. Nr 38 în plus la baza lui `z1_7`) primea `poz z1_7#38` și se număra încă o dată prin Nr în banda 2. Efectul: 470 ieșea 49.225 m în loc de 48.905, fără niciun semnal. Tot aici: rândul legat de un Nr ilizibil din felia vecină merge la „Nr lipsă sau ilizibil pe rând (în felia vecină, împerecheată)”, nu primește poziție.
- **Nr repetat.** Același (tabel, Nr) citit pe noduri din aceeași felie, dar în componente diferite, intră la de verificat: „Nr X repetat — tabel neidentificat sigur”. Acoperă două tabele cu antete identice (C) și numerotarea reluată (C2). Aceeași regulă se aplică și pentru benzi sau coloane nevecine (|Δr|>1 sau |Δc|>1; grilă necunoscută = nevecine), adică felii care nu se pot suprapune (B).
- **Text contrazis.** Lecturile aceleiași identități din componente diferite (ex. suprapunerea verticală) care diferă pe o coloană de text comună (Strada / De la) nu se contopesc. Toate intră la de verificat. Comparația ignoră spațiile, punctuația și diacriticele, iar prefixul e admis la margine sau pe textul marcat „...”.
- **Cheia de poziție** conține indexul tabelului din felie (`poz z1_2.t2#1`). Cazul D (două tabele fără Nr cu antete identice în aceeași felie) dă acum 4 rânduri / 950 m. Pe a800d38 dădea 300 m sigur + un conflict fals, iar 300 m se pierdeau. Același tabel fără Nr transcris de două ori în aceeași felie (aceleași rânduri L/Dn/Q) intră la de verificat: „posibilă transcriere dublă”.
- **Semnale noi, fără metri:**
  - `perechi[].randuri` / `neimperecheate` = numărul diferit de rânduri între fragmentele împerecheate, inclusiv la δ=0. În runda 4 câmpul rămânea doar în rezultatul intern (`idr.perechi`) și nu ajungea la utilizator; din runda 5 ajunge în sumar, vezi mai jos;
  - `nrFaraLungime` → `sumar.nr_fara_lungime` (+ `_n`) și un avertisment = rânduri numerotate dintr-un fragment cu Nr împerecheat cu lungimi, al căror Nr nu primește nicio lungime în nicio felie.
- Pe 470 (fixture = BD) nimic nu se schimbă: 133 de rânduri, 48.905 m, 0 de verificat, 0 conflicte. Cele 19 rânduri din suprapunerea verticală trec și de controlul de text. În afara feliilor `z?_6`/`z?_7`, 470 mai are un singur tabel: cartușul din `z5_6`, fără Nr și fără lungimi (SELECT 26.09). Pe 130 nici antetele nu au coloană Nr („Tronsoane”, „Tronson”; SELECT 26.09), iar tabelul cu lungimi stă în `z1_4`/`z1_5`, în aceeași bandă și în felii diferite. Am rulat regula veche și pe cea nouă pe o transcriere compactă a lui `z1_4`/`z1_5` (9 din 13 coloane plus tronsoanele, md5 identic cu BD pe toate 4 blocurile). Ambele dau 18 rânduri prin poziție / 37.320 m (Dn250 30.970, Dn180 1.105, Dn160 5.245), cu 0 de verificat.

**Runda 5 (26.09, verificatorul rundei 4).** Blocantul din runda 4 era reparat doar pe jumătate. `grupCuNr` cunoaște doar fragmentele împerecheate **reușit**, iar `vecinNrNesigur` cere coloane comune. Au rămas trei căi prin care fragmentul cu lungimi rămânea singur și primea „poz …”:
- **V1:** `z1_6` fără tabel transcris (fără eroare);
- **V2 / V4:** antetele din `z1_6` sau din `z1_7` transcrise altfel, fără nicio coloană comună. `perecheFragmente` dă null, iar perechea e sărită;
- **V3:** `z1_6` căzută (eroare).

În toate, cele 37 de rânduri din `z1_7` primeau poziție, iar Nr 32–37 (suprapunerea cu banda 2, 1.200 m) se numărau încă o dată prin Nr. Rezultatul era 139 de rânduri / **50.105 m** sigur, 0 de verificat, fără niciun semnal. Cazul e plauzibil: pe 130, `z2_4` și `z2_5` transcriu același tabel cu antete diferite („Tronsoane / Noduri / Localitate / Cod SIRUTA” față de „Tronson / Nod de la / Nod la / Localitate / Cod SIRUTA”; SELECT 26.09).

Regula nouă (în runda 5 `coloaneCuNr`, pe etichetă; din runda 6 `coloanaCuNr`, `handler.ts:573`, verificarea la l. 606, pe geometrie — vezi mai jos):
- **Poziția e interzisă în coloana de felii a unui tabel cu Nr.** Coloanele interzise sunt cele ale oricărui fragment dintr-un grup cu Nr (fragmentul cu Nr sau unul împerecheat sigur cu el), plus coloana din stânga și cea din dreapta, pe aceeași pagină, în **orice bandă**. Rândul trece la „de verificat” cu `MOTIV_COLOANA_NR`.
- **De ce ajunge regula** — *afirmație corectată în runda 6:* „un rând se numără de două ori doar dacă felia lui se suprapune fizic (|Δc| ≤ 1) cu o felie legată de un Nr” era **falsă**: tăietorul fixează ultima coloană la marginea planșei, care poate acoperi și coloana `_N-1` (|Δc| = 2). Regula corectă e pe suprapunerea fizică din `zone_geom` (runda 6, mai jos). Ce rămâne valabil: regula e mai largă decât proba verificatorului rundei 4 (fragment cu Nr la |Δc| ≤ 1). Prinde și tabelul întins pe 3 coloane de felii (Nr în `z?_5`, lungimi în `z?_7`) când banda 1 n-are fragmentul din mijloc. Acolo fragmentul cu Nr e la două coloane distanță, dar `z2_7` e în grupul cu Nr (testul sintetic din §5.6; proba verificatorului dă acolo 2.700 m în loc de 1.700).
- Un fragment din grup cu Nr fără grilă în etichetă interzice poziția pe toată pagina (din runda 6: orice fragment fără geometrie, vezi mai jos).
- **`perechi_neimperecheate`** (+ `_n`) intră în sumar, cu un avertisment („N perechi de felii vecine cu rânduri în afara suprapunerii (z1_6+z1_7: 0/1) …”) doar când există.

Cifre:
- **V1–V4:** 102 rânduri / **24.235 m** sigur (Nr 32–133, benzile 2–4) + 37 de rânduri / 25.870 m de verificat, fără dublare. Suma minus suprapunerea Nr 32–37 dă exact 48.905 m.
- **Date reale.** Pe toate cele 8 documente cu citire, singurele fragmente cu coloană Nr sunt `z1_6`–`z4_6` din 470 (SELECT 26.09 pe cheile rândurilor), deci regula nu schimbă nimic pe ele: **470 = 133 / 48.905 m**, 0 de verificat, niciun avertisment de perechi; **130 = 18 / 37.320 m** prin poziție (transcrierea compactă `p130`, md5 = BD).

**Runda 6 (26.09, verificatorul rundei 5) — vecinătatea feliilor pe geometria reală.** Regula pe coloană din runda 5 se baza pe etichetă (±1 coloană). Tăietorul (`api/plansa-felii.js` l. 318: `left = Math.min(c * pas, Math.max(0, meta.width - latura))`) fixează însă ultima coloană (și ultima bandă) la marginea planșei. Consecința:
- când W mod pas < 0,272·pas (sub 383 px la pas 1.408), felia fixată `_N+1` acoperă și `_N-1`; sub 0,136·pas, `_N` și `_N+1` sunt chiar imagini identice. Mai departe de `_N-1` nu ajunge niciodată (la suprapunerea de 12%);
- dacă tabelul cu Nr stă în `_N-1`, iar felia din mijloc `_N` nu-l transcrie sau cade, fâșia de lungimi din `_N+1` primea „poz …” și se număra a doua oară. Proba verificatorului: GEOM-1 (W = 7.340) 6 rânduri / **1.500 m** sigur în loc de 750, 0 de verificat; GEOM-E2E (W = 7.140) Dn63 `cantitate_plansa` 1.100 (corect 550), Dn40 400 (corect 200), nota „Memoriu 550 m vs planșa 7 1.100 m (+550 m…)”, „diferenta” — o diferență falsă prezentată ca reală.

Regula nouă (`handler.ts:262–370` + `identificaRanduri`):
- **Geometria** vine din `analiza.plansa.zone_geom` (scris de `/api/plansa-felii`: `[left, top, width, height, sursa]` în pixelii sursei, cheie = eticheta fără `z`, inclusiv prefixul `pN_` la mai multe pagini). E același obiect din care handler-ul citește deja planșa (`plansaD` → `identificaRanduri(toate, { plansa: plansaD })`), deci nu trebuie încărcat separat. SELECT 26.09: 7 documente au `zone_geom` (470–475, 1035), toate cu `[left, top, 1600, 1600, 0]`; doar 130 (citire veche) nu are.
- **Relația „vecine / suprapuse”:** dreptunghiurile a două felii din aceeași sursă se intersectează sau se ating, cu toleranța `TOL_GEOM_PX` = 2 px. Pe ea se aplică toate cele trei reguli de identitate:
  - **împerecherea fragmentelor** (`perechePosibila`): felii diferite, aceeași bandă (același `[top, top+height]`), intervale x care se ating; ordinea stânga/dreapta = x, apoi eticheta (două felii identice se împerechează o singură dată). Fâșia din coloana fixată se împerechează direct cu tabelul din `_N-1`, deci rândul văzut în ambele se numără **o dată** (GEOM-1: 3 rânduri / 750 m, perechea `z1_4+z1_6`);
  - **„Nr repetat”** (`seSuprapun`): același (tabel, Nr) în felii care nu se ating ⇒ „de verificat”; în felii care se ating (inclusiv banda fixată care acoperă banda `_N-1`) ⇒ același rând;
  - **poziția interzisă în coloana unui tabel cu Nr** (`coloanaCuNr`): intervalul x al feliei atinge intervalul x al oricărui fragment dintr-un grup cu Nr, pe aceeași pagină și sursă, în orice bandă ⇒ `MOTIV_COLOANA_NR`. Prinde fâșia din coloana fixată și când împerecherea e imposibilă (tabelul cu Nr e în banda vecină).
- **Fallback fără geometrie** (tăiere veche; lipsă pe candidat sau pe fragmentul cu Nr) — conservator **doar pentru tabelele cu Nr** (*corectură runda 7*: la runda 6 scria „niciodată umflare” pentru toate; verificatorul rundei 6 a arătat că un tabel FĂRĂ Nr sub coloana fixată se număra de două ori, ADV7-A: 1.500 m sigur în loc de 750. Din runda 7, regula B1 de mai jos închide și cazul fără Nr):
  - împerecherea și „Nr repetat” rămân pe etichetă: vecinele ±1 se suprapun mereu într-o grilă cu suprapunere (asta e rostul ei), iar |Δ| ≥ 2 ⇒ „de verificat” (nu contopire);
  - poziția e **interzisă pe toată pagina** unui tabel cu Nr, cu motivul `MOTIV_COLOANA_NR_FARA_GEOM` („… fără geometria zonelor (tăiere veche) — suprapunerea feliilor nu se poate exclude … (retaie planșa)”). Am ales toată pagina, nu ±2 coloane: ±2 ajunge doar pentru grila de azi (latura 1.600, suprapunere 12%); parametrii tăierilor vechi nu sunt în BD.

Cifre (fără scrieri în BD):
- **GEOM-1 / GEOM-2** (W = 7.340, `z1_5` netranscrisă sau căzută): **3 rânduri / 750 m** sigur, 0 de verificat (f1274a1: 6 / 1.500 m, 3 prin poziție). Fără geometrie: 750 m sigur + 750 m de verificat.
- **GEOM-E2E** prin handler + RPC simulat (W = 7.140): Dn63 **550**, Dn40 **200**, „Planșa 7 confirmă: …”, „extras” (f1274a1: 1.100 / 400, diferență falsă).
- **Date reale:** pe cele 7 geometrii din BD nicio pereche de felii la |Δ| ≥ 2 nu se atinge (cel mai mic gol: 70 px la 471/473/474, coloanele 2 și 4), deci relația geometrică dă aceleași vecinătăți ca eticheta. Coloană Nr are doar 470 (`z1_6`–`z4_6`, SELECT 26.09 pe cheile rândurilor), iar singurul document fără geometrie (130) n-are Nr, deci fallback-ul nu schimbă nimic. **470 = 133 / 48.905 m** (fixture cu `zone_geom` real din BD, 35 de zone; `geomTaiere(9362, 6623)` reproduce exact geometria din BD), **130 = 18 / 37.320 m** (transcrierea compactă `p130`, prin poziție).

**Runda 7 (26.09, Copilot + verificatorii rundei 6 și ai documentului R5) — regresiile Copilot și cele 4 căi TĂCUTE rămase.** Verdictul Copilot (26.09 dimineața) cere regresii explicite: 37/40/41 cu același text = 3 rânduri; același rând în zone suprapuse = o dată, cu observațiile-sursă păstrate; antete identice ≠ automat același tabel; identitate ambiguă = conflict vizibil, fără comasare automată. Verificatorii au numit 4 căi prin care totalul se putea umfla sau pierde fără semnal (toate imposibile pe datele de azi). Toate devin **vizibile** (de verificat cu motiv, sau semnal explicit în raport și în nota transferului); totalul sigur nu se umflă pe nicio cale cunoscută.
- **COPILOT-REG-1…4** (`agregare_test.ts`, teste cu aceste nume). REG-2 a cerut un câmp nou: rândul reconciliat are acum **`_surse`** = fiecare observație comasată (felia, tabelul și rândul din felie, L/Dn/Q citite, `nr_din` = feliile din care vine Nr-ul), pe lângă `_observatii` (feliile). Câmpul ajunge în `citire_ai.tronsoane_unice` (verificat E2E prin handler), iar `text_extras` arată rândul ca „… (Nr 37; văzut în z1_7, z2_7)”. Partea de identitate a raportului (sumar + avertismente) e extrasă în `raportIdentitate` (`handler.ts:1305`, pur, exportat), ca testele să verifice raportul, nu doar rezultatul intern; `textPlansa` e exportată din același motiv.
- **B1 — fără geometrie, tabel FĂRĂ Nr sub coloana fixată** (ADV7-A/B). Fără `zone_geom` pe oricare din cele două fragmente, două grupuri de poziție (tabele fără Nr, grupuri de împerechere diferite) de pe aceeași pagină și bandă, la |Δc| ≥ 2 ⇒ **grupul din dreapta** trece la „de verificat” cu `MOTIV_FARA_GEOM_COLOANA_FIXATA` (coloana fixată `_N+1` poate acoperi `_N-1`); cel din stânga rămâne, deci un rând se numără cel mult o dată. Cu geometrie regula nu se aplică (împerecherea / `vecinNeimp` au decis deja pe suprapunerea reală). ADV7-A fără geometrie: **750 m sigur + 750 m de verificat** (ab5c449: 1.500 m sigur, 0 de verificat); ADV7-B (fâșia cu antete diferite) fără geometrie 750 + 750, cu geometrie 0 + 1.500 (neschimbat). Control: două tabele fără Nr la |Δc| = 3 cu geometrie care nu se ating ⇒ ambele sigure (1.500 m); aceleași fără geometrie ⇒ 750 + 750 (conservator, vizibil). Cu B1, fallback-ul fără geometrie e conservator și pentru tabelele fără Nr.
- **B2 — transcriere dublă PARȚIALĂ** a unui tabel fără Nr în aceeași felie. Garda „tabel dublat” (runda 4) prindea doar dublura identică. Acum: dacă secvența L/Dn/Q a unui tabel (doar rândurile cu lungime) e o **sub-secvență mai scurtă**, în ordine, a altui tabel cu aceleași antete din aceeași felie — prefix, bucată contiguă sau cu rânduri omise la a doua transcriere — **surplusul** (tabelul conținut) trece la „de verificat” cu `MOTIV_DUBLA_PARTIALA`; transcrierea completă rămâne. Proba verificatorului: **3 rânduri / 750 m sigur + 500 m de verificat** (ab5c449: 5 / 1.250 m sigur). Am extins cerința („prefix / sub-secvență contiguă”) și la sub-secvența ne-contiguă (rândul din mijloc omis la a doua transcriere), altfel acel caz rămânea tăcut. Dublura identică rămâne ca în runda 4 (ambele de verificat, nu se știe care e originalul); tabele diferite (cazul D) rămân 4 / 950 m.
- **B3 — golurile din secvența Nr** unui tabel identificat (pagină + antete). Un Nr între primul și ultimul citit care nu apare în **nicio** felie (nici cu lungime, nici fără) e un rând fără nicio lectură. Nu se inventează metri: totalul sigur rămâne cel derivat, dar e **marcat incomplet**: `idr.nrLipsa` → `sumar.nr_lipsa[]` (`pagina`, `tabel`, `interval`, `lipsesc` ca intervale „38–41, 50”, `n`, `nr_ilizibil`, `zone`), `nr_lipsa_n`, `total_sigur_incomplet: true`, avertismentul „secvență Nr incompletă: lipsesc Nr 50 (p1, tabel cu Nr 1–133; 1 rând fără nicio lectură, metri necunoscuți) — totalul sigur (48685 m) NU le conține, e INCOMPLET; de verificat pe planșă”, linia „⚠ SECVENȚĂ Nr INCOMPLETĂ …” în `text_extras`, iar la transfer textul intră în `rest.global` („pe planșă: secvență Nr incompletă …” în nota **fiecărei** poziții atinse și a TOTAL-ului) cu `rest.incomplet` ⇒ pozițiile „extras” trec în „diferenta” (cifra e doar partea citită). Rândurile cu Nr ilizibil (care pot fi chiar golul) sunt numărate în mesaj („1 rând cu Nr ilizibil în lectură, la „de verificat””). 470 fără Nr 50 în ambele felii: **132 / 48.685 m sigur + semnal** (ab5c449: aceleași cifre, 0 de verificat, niciun semnal); E2E: 1751–1756 „diferenta”, nota se termină cu golul. Limită: începutul și sfârșitul tabelului nu se pot verifica pe Nr (numerotarea poate continua de pe altă planșă) — acolo rămân `nr_fara_lungime` și `perechi_neimperecheate`.
- **B4 — două tabele identice în benzi vecine** (L, Dn, Q și text identice). Garda geometrică: comasările prin Nr între două felii din **benzi diferite** (suprapuse doar pe vertical) trebuie să încapă în fâșia comună. Capacitatea = ⌊h / h_min⌋ + 2, cu h = înălțimea intersecției `zone_geom`, h_min = `H_MIN_RAND_MM` = 2 mm pe planșă convertiți cu scara sursei (`surse_geom[].dpi` sau latime / latime_pt; fără scară `H_MIN_RAND_PX_FARA_SCARA` = 12 px, adică 2 mm la 150 dpi), iar +2 = câte un rând tăiat de fiecare margine, transcris în ambele felii. **Justificarea din datele reale** (SELECT 26.09): toate cele 7 documente cu `zone_geom` sunt randări la 200 dpi; pe 470 o bandă de 1.600 px are 52 de rânduri, iar fâșia de 192 px dintre benzi 6–7 rânduri (Nr 32–37, 78–83, 123–129) ⇒ rândul are 24–27,4 px ≈ 3,0–3,5 mm; textul de 1,5 mm (pragul din `api/plansa-felii.js`) cere minimum ~2 mm pe rând. Capacitatea fâșiei de 192 px la 200 dpi = 14 rânduri (470 are cel mult 7). **Peste capacitate** ⇒ toate identitățile comasate între cele două felii trec la „de verificat” (fiecare lectură separat) cu `MOTIV_PESTE_CAPACITATE` („… 20 rânduri (Nr 1–20) comasate între z1_2 și z2_2, dar fâșia comună are 200 px ≈ cel mult 14 rânduri …”): nu se știe care din ele e suprapunerea reală, deci nicio comasare automată. **Sub capacitate** cele două cazuri nu se pot deosebi fără coordonate pe rând; când tot ce vede **cel puțin o felie** din tabel e în comasare (fragmentul ei e comasat integral), raportul spune: `sumar.comasari_neconfirmate[]` (`a`, `b`, `nr`, `randuri`, `fasie_px`, `integral_in`), avertisment și linia „⚠ COMASARE NECONFIRMATĂ …” în `text_extras`. Suprapunerea reală a unui tabel întins pe două benzi nu dă semnalul (fiecare felie vede și rânduri din afara fâșiei, ca la 470); îl dă un tabel care începe / se termină în fâșie sau un al doilea tabel identic (T2 ⊆ T1 sau T1 ⊆ T2). Fără geometrie garda de capacitate nu se aplică (doar semnalul integral). **Analogul pe orizontală** (găsit la documentare): două tabele identice ALĂTURATE (aceeași bandă, coloane vecine) se împerechează rând cu rând (câmp comun + ordine, sau L/Dn/Q) și se numărau o dată, tăcut; acum o pereche de fragmente cu lungimi și cu **aceleași antete** (ambele felii văd tabelul întreg — suprapunerea unui tabel întins pe două coloane de felii nu arată așa, fiecare felie are doar o parte din coloane, ca la 470) intră în `comasari_neconfirmate` cu `axa: 'orizontal'` + avertisment, totalul neschimbat. **130 îl primește** (18 rânduri, `z1_4`+`z1_5`): totalul rămâne 18 / 37.320 m; semnalul e corect ca „de verificat”, dar aici e cel mai probabil fals-pozitiv: pe grila lui 130 (latura 2.500, pas 2.200, W 9.957) coloana fixată `z1_5` = [7.457, 9.957] acoperă 1.643 px din `z1_4` = [6.600, 9.100], deci tabelul poate sta întreg în fâșia comună, iar memoriul confirmă 37.320 m = un tabel.
- **Minore:** ADV7-M5 (axa y a „Nr repetat”) e test (mutantul „doar x” e prins); `seSuprapun` era deja corect.

Cifre (fără scrieri în BD): **470 = 133 / 48.905 m** sigur, 0 de verificat, niciun semnal nou (fixture, cu și fără `zone_geom` real); **130 = 18 / 37.320 m** (transcrierea compactă `p130`, md5 e0bb8525, prin poziție; restul tabelelor din 130 — `z2_4`/`z2_5`, `z7_5` — au 0 lungimi, SELECT 26.09, deci nu intră în B1). Pe datele reale nicio regulă nouă nu schimbă vreun total: singurele fragmente cu Nr sunt `z?_6` din 470, fără goluri și fără comasări integrale; singurul tabel fără Nr cu lungimi e 130 (un singur grup, deci B1 / B2 nu se aplică). Singura diferență de raport pe date reale: 130 primește semnalul „comasare neconfirmată” pe orizontală (`z1_4`+`z1_5`), explicat la B4 — totalul rămâne 18 / 37.320 m.

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

### 5.5 Transferul în cantități (`treciInCantitati`, l. 924; `notaRestTransfer`, l. 898; `descriereRestDn`, l. 888; `cheieRest`, l. 885)
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
- Cum s-ar ajunge la retransfer: „continuă” / „reia” nu retransferă (transfer `facut` pe aceeași rulare; după o schimbare de `COD_VERSIUNE` — acum 2026-09-26.10 — sunt refuzate fără `mixare_permisa`). Rămâne doar un „citește” complet, adică retăiere + ~35 de zone plătite (ultima citire completă a lui 470: 2,595 USD în 9 runde).

**Runda 4 — Dn cu TOATE rândurile „de verificat”** (verificatorul, MAJOR; test ADV-T). Pe `a800d38`, `peDiametru` se construia doar din rândurile sigure. Consecințele:
- poziția unui Dn fără niciun rând sigur păstra tăcut `cantitate_plansa` și nota dintr-o citire anterioară;
- fără niciun rând sigur pe planșă, `if (!peDiametru.size) return` ieșea fără nicio scriere.

Acum:
- `notaRestTransfer` numără pe Dn și **conflictele** (`c`, cu plafonul `mc` = varianta maximă). Un Dn doar cu conflicte nu mai scapă.
- Pentru fiecare Dn din `rest.peDn` fără grup sigur (aceeași potrivire pe denumire ca la rândurile sigure; din runda 5 cheia e (Dn, material), vezi mai jos):
  - poziție **validată / „diferenta”** ⇒ update **doar pe notă**, ex. „De verificat: 2 rânduri Dn250 fără identitate sigură (10.350 m); cifra din planșă nu s-a actualizat (34.465 m e dintr-o citire anterioară). Pe planșă: …”. Decizia omului rămâne, iar cifra veche e numită drept veche;
  - poziție **„extras”** (nevalidată) ⇒ `cantitate_plansa = null`, `status = 'diferenta'` și nota „… cifra din planșă s-a golit (era 2.210 m, dintr-o citire anterioară)”;
  - mai multe poziții pe același Dn ⇒ `ambigue[]` (cu `de_verificat`). Nicio poziție sau Dn necunoscut ⇒ raportat în `cantitati.doar_de_verificat[]` (`fara_pozitie` / `fara_dn`). Din rânduri nesigure **nu se inserează** poziții.
- **Fără early-return** cât timp există rest de menționat. Dacă nu există niciun rând sigur, TOTAL **nu devine 0 m**: primește aceeași notă, sau golire dacă e „extras”.
- RPC-ul (live, `pg_get_functiondef` 26.09) aplică `cantitate_plansa` doar când cheia există în patch. Update-ul doar pe notă nu atinge cifra, iar `null` explicit o golește.
- (verificator, minor) Pe un Dn cu rânduri de verificat:
  - poziția **nouă** (doar partea sigură) intră cu `status = 'diferenta'`, nu „extras”;
  - o poziție existentă „extras” trece tot în „diferenta”, chiar dacă cifra sigură egalează memoriul.

**Runda 5 — restul pe (Dn, material)** (verificatorul rundei 4, MAJOR; test E2E-T1). În runda 4, `rest.peDn` și `dnSigure` aveau cheie doar pe Dn, deși grupurile sigure au cheie Dn + material (split-ul Jakarinos 25.09, făcut tocmai pentru Dn110 PE față de OL). Cazul verificatorului: Dn110 PE Nr 1 = 500 m sigur și Dn110 OL cu Nr ilizibil = 90 m de verificat, pe două poziții separate. Poziția OL (id 12) rămânea cu 900 m, „extras” și nota „VECHE OL”, iar `doar_de_verificat` era gol. Acum:
- **Cheia restului** e `cheieRest(dn, material)` = `${dn}|${materialNorm(material)}` (`RestTransfer.peDnMat`). Conflictele poartă materialul (pe conflict și pe fiecare variantă). Eticheta din notă devine „Dn110 OL” sau „Dn250 PE”; fără material rămâne „Dn250”.
- **Ce e „doar de verificat”:**
  - o cheie (Dn, M) cu material cunoscut e doar de verificat dacă nu există grup sigur (Dn, M);
  - o cheie cu material necunoscut (Dn, '') e doar de verificat numai dacă Dn-ul n-are niciun grup sigur. Altfel e numită în nota fiecărui grup sigur de pe acel Dn (`cheiRest`), pentru că poate aparține oricărei poziții.
- **Candidații** pentru un rest (Dn, M) se filtrează pe material ca la ramura sigură (mai multe poziții pe Dn ⇒ cea cu materialul M). Tot mai multe ⇒ `ambigue[]`. `doar_de_verificat[]` primește câmpul `material`.
- **Aceeași poziție atinsă și de un grup sigur** (ex. singura poziție „Conductă Dn110” ia cifra Dn110 PE) ⇒ nota primește „De verificat (Dn110 OL, fără nicio cifră sigură): …”. Poziția trece în „diferenta” dacă era „extras”, fiindcă cifra ei e incompletă.
- Pe T1: id 12 ⇒ `cantitate_plansa` null, „diferenta”, nota „De verificat: 1 rând Dn110 OL fără identitate sigură (90 m); cifra din planșă s-a golit (era 900 m, dintr-o citire anterioară).” Id 11 (PE) primește 500 m și rămâne „extras”: restul OL nu e al lui și e numit doar „pe planșă”. Pe `a9fe186`, id 11 trecea în „diferenta” din cauza rândului OL.
- **Grup sigur ambiguu** (mai multe poziții pe același (Dn, M)): `ambigue[]` numește acum și restul de verificat de pe (Dn, M) (`de_verificat`).
- **TOTAL** (minor): dacă e „extras” și există rest pe planșă (`rest.global`: fără identitate / conflicte / Dn nestandard) ⇒ „diferenta”, ca pe Dn. Pe datele reale nu schimbă nimic: lic. 3 are TOTAL (id 4) „validat”, iar lic. 95 n-are rând TOTAL (SELECT 26.09).

**Runda 6 — două grupuri sigure pe aceeași poziție** (verificatorul rundei 5, MAJOR; pre-existent, codul era identic la `8a6fbbb`, de la split-ul Jakarinos 25.09). Grupurile sigure au cheie (Dn, material). Când două grupuri de pe același Dn, cu materiale diferite — (Dn, PE) și (Dn, OL), sau (Dn, PE) și (Dn, '') — găseau **aceeași** poziție unică, `treciInCantitati` punea două `update` pe același id. RPC-ul live le aplică în ordine (bucla `FOR` peste `p_randuri`), deci ultimul câștiga:
- MY-T2: poziția „Conductă distribuție gaze Dn110”, PE 500 + OL 90 sigure ⇒ `cantitate_plansa` 90, nota „Memoriu 590 m vs planșa 90 m (-500 m…)”, „diferenta”: 500 m pierduți tăcut și o diferență falsă;
- MY-T3: „Țeavă PE100 Dn110”, PE 500 + fără material 300 ⇒ 300, cei 500 m PE dispar.

Acum (`handler.ts:998–1051`): întâi se află ținta fiecărui grup sigur (aceeași potrivire pe Dn + filtrul pe material), apoi se scrie. Dacă **mai multe grupuri ajung la același candidat**, poziția e **ambiguă**:
- `cantitate_plansa` **nu se atinge** (patch-ul n-are cheia, iar RPC-ul o aplică doar când există — `pg_get_functiondef` 26.09);
- nota numește **toate** grupurile, cu metrii și rândurile lor, și spune că cifra din planșă e veche, ex. „De verificat: Planșa „PL1.1.pdf” dă 2 grupuri sigure pe aceeași poziție — Dn110 OL 90 m (1 rând); Dn110 PE 500 m (1 rând); împreună 590 m, dar nu se adună și nu se suprascriu automat (denumirea poziției nu le deosebește); cifra din planșă nu s-a actualizat (700 m e dintr-o citire anterioară).” Restul de verificat al grupurilor (cheile (Dn, M) și (Dn, '')) și `rest.global` se adaugă ca înainte;
- „extras” ⇒ „diferenta”; „validat” / „diferenta” rămân, doar nota se schimbă;
- `cantitati.ambigue[]` primește `{ dn, material: null, metri: suma, motiv, grupuri: [{dn, material, metri, randuri}], de_verificat?, pozitii: [{id, denumire}] }`;
- o singură scriere pe id; grupurile din notă și din `ambigue` sunt ordonate (Dn descrescător, material cunoscut alfabetic, apoi fără material), deci rezultatul **nu depinde de ordinea** rândurilor (testat: ordine normală = inversată, aceeași stare în BD);
- TOTAL rămâne suma tuturor grupurilor sigure (nu se pierde nimic din el). Grupurile cu poziții separate își primesc fiecare cifra, ca înainte (control).

Pe datele de azi nu apare: singurul Dn cu material amestecat e 130 Dn250 (28 de lecturi din tabel fără material, 61.940 m brut, și 2 adnotări PE 100 / 5.170 m, care nu intră în total fiindcă există tabel; SELECT verificator 26.09).

**Runda 7 — transferul** (verificatorii rundelor 5 și 6, minore; B3):
- **Secvența Nr incompletă (B3).** `notaRestTransfer` primește `idr.nrLipsa`: textul „secvență Nr incompletă: lipsesc Nr … (p1, tabel cu Nr a–b; N rânduri fără nicio lectură, metri necunoscuți)” intră în `rest.global`, deci în nota fiecărei poziții atinse („De verificat, NEincluse în cifra din planșă: … pe planșă: …”), în nota pozițiilor „doar de verificat” și a TOTAL-ului; `rest.incomplet` ⇒ poziția „extras” trece în „diferenta” și la grupurile sigure (și la inserare), fiindcă cifra din planșă e doar partea citită. „Validat” rămâne validat, doar nota.
- **MY-T4 (minorul verificatorului rundei 5, deschis din runda 6)** (`handler.ts:1130`). Restul fără material (Dn, '') pe un Dn care are grup sigur poate fi al oricărei poziții de pe Dn. Înainte doar poziția grupului sigur îl numea; a doua poziție (ex. „Țeavă OL Dn110”, când grupul sigur e PE) rămânea tăcut cu cifra și nota unei citiri anterioare. Acum fiecare poziție de pe Dn neatinsă de niciun grup sigur primește nota „De verificat: 1 rând Dn110 fără identitate sigură (90 m) — fără material, pot fi ale acestei poziții (grupul sigur de pe Dn110 e pe alt material); cifra din planșă nu s-a actualizat (900 m e dintr-o citire anterioară).” + „pe planșă: …”, „extras” ⇒ „diferenta” (validat rămâne), intrare `doar_de_verificat` cu `actiune: 'nota_fara_material'`. Cifra **nu se golește** (spre deosebire de „doar de verificat” pe (Dn, M)): poziția poate veni din altă planșă, iar restul poate fi și al poziției PE. O poziție deja atinsă (ex. de restul (Dn, OL)) primește textul în coadă, o singură dată.
- **Rândul TOTAL nu mai e candidat pe Dn** (minorul 3 al verificatorului rundei 6). `randTotal` se alege întâi, iar `retea` (candidații pe Dn, și pentru „doar de verificat”) îl exclude: o denumire ca „Total conducte De 110” nu mai primește două update-uri pe același id (grupul + TOTAL, ultimul câștiga) și nu mai face ambiguă poziția reală Dn110. Invariant verificat în cod: un al doilea update pe id-ul TOTAL aruncă eroare (transfer `eroare`, 0 scrieri) în loc să se aplice tăcut. Pe BD nu schimbă nimic: niciun rând TOTAL în metri nu are Dn în denumire (SELECT 26.09: lic. 3 id 4, lic. 5 id 487 / 526 / 1097).

**1756 — două variante, decizie separată pentru Razvan** (verificator, minor). Codul de retransfer schimbă **doar** `cantitate_plansa`; `cantitate` rămâne neatinsă (testul „identitate 470: retransfer…”: 13.140). Poziția 1756 a fost însă *creată* din planșă (`cantitate` = `cantitate_plansa` = 13.140), deci se poate argumenta și corectarea lui `cantitate`:
- **Varianta A — doar `cantitate_plansa`** (ce ar face un retransfer): `cantitate` rămâne 13.140, iar poziția arată „memoriu 13.140 vs planșă 13.740”.
- **Varianta B — `cantitate` + `cantitate_plansa`** (SQL-ul de mai jos): ambele devin 13.740.

Corecția se face în reconcilierea R5, prin **preview → GO Razvan (A sau B) → apply**. SQL-ul e **neexecutat**. Ambele variante (și rollback-urile lor) sunt **comentate**, în blocuri separate, ca un copy-paste să nu execute nimic. Varianta A e compatibilă cu pasul B din R5; varianta B din R4 îl exclude (R5 refuză pasul B când `cantitate` ≠ 13.140). `analiza.citire_ai.sumar` al lui 470 rămâne 48.195 m până la o nouă citire. Starea de azi a lui 1756 (SELECT 26.09): 13.140 / 13.140, „extras”, `updated_at` 2026-09-25 16:51:08.040401+00.
```sql
-- PREVIEW (doar citire)
SELECT id, denumire, cantitate, cantitate_plansa, status, diferenta_nota, updated_at FROM ofertare_cantitati WHERE id = 1756;
```
```sql
-- VARIANTA A — rulează DOAR după GO Razvan pe varianta A (doar cantitate_plansa; condiționat pe valorile de azi => 0 rânduri dacă s-a schimbat ceva)
-- UPDATE ofertare_cantitati SET cantitate_plansa = 13740, status = 'diferenta',
--        diferenta_nota = 'Memoriu 13.140 m vs planșa 1 13.740 m (+600 m: Nr 40 și 41, C-tin Brâncoveanu Dn40 300 m, identice ca text cu Nr 37; deduplicare pe identitatea rândului). Neincluse: Nr 57 Dn60 nestandard 110 m, de verificat.',
--        updated_at = now()
--  WHERE id = 1756 AND licitatie_id = 95 AND cantitate = 13140 AND cantitate_plansa = 13140
-- RETURNING id, cantitate, cantitate_plansa, status, updated_at;
```
```sql
-- VARIANTA B — rulează DOAR după GO Razvan pe varianta B (cantitate + cantitate_plansa; condiționat pe valorile de azi)
-- UPDATE ofertare_cantitati
--    SET cantitate = 13740, cantitate_plansa = 13740,
--        diferenta_nota = 'Diametru care nu apare în cantitățile din memoriu. 56 tronsoane citite din tabelul planșei (corecție 25.09: +600 m — rândurile Nr 40 și 41, C-tin Brâncoveanu Dn40 300 m, identice ca text cu Nr 37, erau numărate o dată; deduplicare pe identitatea rândului). Neincluse: Nr 57 Dn60 nestandard 110 m, de verificat.',
--        updated_at = now()
--  WHERE id = 1756 AND licitatie_id = 95 AND cantitate = 13140 AND cantitate_plansa = 13140
-- RETURNING id, cantitate, cantitate_plansa, status, updated_at;
```
**⚠ După pasul B din R5 (`docs/R5_RECONCILIERE_470_V2.md`, marcajul „R5 pas B” în notă) NU se rulează rollback-urile de mai jos: se folosesc DOAR RB / RB-manual din R5.** Rollback-ul din runda 6 (`WHERE id = 1756`, fără gărzi) rulat după A + pasul B readucea 1756 la 13.140 / 13.140 / „extras” și ștergea marcajul — pasul B (cantitatea verificată de Oana) se pierdea fără urmă, iar RB refuza apoi („marcajul lipsește”); reprodus de verificatorul documentului R5 și de mine (controlul S2 de mai jos). De aceea rollback-urile sunt acum **separate pe variantă** și **condiționate**: fiecare atinge rândul doar dacă efectul variantei lui e încă acolo și pasul B nu a fost aplicat (0 rânduri altfel).
```sql
-- ROLLBACK după VARIANTA A (valorile de azi, SELECT 26.09, inclusiv status și updated_at) — doar la nevoie, după GO.
-- NU după pasul B din R5: acolo doar RB / RB-manual din R5 (garda `NOT LIKE '%R5 pas B%'` + `cantitate = 13140` => 0 rânduri).
-- UPDATE ofertare_cantitati SET cantitate = 13140, cantitate_plansa = 13140, status = 'extras',
--        diferenta_nota = 'Diametru care nu apare în cantitățile din memoriu. 54 tronsoane citite din tabelul planșei.',
--        updated_at = '2026-09-25 16:51:08.040401+00'
--  WHERE id = 1756 AND licitatie_id = 95 AND cantitate = 13140 AND cantitate_plansa = 13740
--    AND coalesce(diferenta_nota,'') NOT LIKE '%R5 pas B%'
-- RETURNING id, cantitate, cantitate_plansa, status, updated_at;
```
```sql
-- ROLLBACK după VARIANTA B din R4 (condiționat pe valorile și nota exactă scrise de B) — doar la nevoie, după GO; NU după pasul B din R5.
-- UPDATE ofertare_cantitati SET cantitate = 13140, cantitate_plansa = 13140, status = 'extras',
--        diferenta_nota = 'Diametru care nu apare în cantitățile din memoriu. 54 tronsoane citite din tabelul planșei.',
--        updated_at = '2026-09-25 16:51:08.040401+00'
--  WHERE id = 1756 AND licitatie_id = 95 AND cantitate = 13740 AND cantitate_plansa = 13740
--    AND diferenta_nota = 'Diametru care nu apare în cantitățile din memoriu. 56 tronsoane citite din tabelul planșei (corecție 25.09: +600 m — rândurile Nr 40 și 41, C-tin Brâncoveanu Dn40 300 m, identice ca text cu Nr 37, erau numărate o dată; deduplicare pe identitatea rândului). Neincluse: Nr 57 Dn60 nestandard 110 m, de verificat.'
--    AND coalesce(diferenta_nota,'') NOT LIKE '%R5 pas B%'
-- RETURNING id, cantitate, cantitate_plansa, status, updated_at;
```
Testat pe Postgres 16 local (macheta lic. 95 a verificatorului R5, 1751–1756; pasul B și RB extrase exact din R5 revizia 5; variantele A / B extrase din blocurile de mai sus; harness `scratchpad/r7/pg/run.sh`), **26/26**: A → rollback A = starea inițială (hash); A → pasul B → rollback A = 0 rânduri, B intact (13.740 / 13.740 / diferenta, cu marcaj); A → B → cantitatea readusă manual la 13.140 (marcajul rămâne) → rollback A = 0 rânduri; A → B → RB (R5) → rollback A = starea inițială (anulare în ordine inversă); B din R4 → rollback A = 0, rollback B = starea inițială; B din R4 → pasul B e refuzat de R5 (cere 13.140) → rollback B = starea inițială; starea B din R4 + marcaj → ambele 0 rânduri; nimic aplicat / doar pasul B → ambele 0 rânduri. Control: rollback-ul din runda 6 după A + pasul B ⇒ 13.140 / 13.140 / „extras”, marcaj șters (defectul). Mutații: fără garda pe marcaj ⇒ pică S2b; fără `cantitate = 13140` ⇒ pică S2 și S3.

### 5.6 Teste
- **Fixture reală** `fixture_470.ts`: feliile `z1_6..z4_7`, reduse la Nr, Strada, Str. De la, Str. Pana la (`z?_6`) și la rândul complet + tronsoanele (`z?_7`); antetele sunt exact ca în BD. Transcrierea e verificată prin SELECT față de fișier, pe fiecare din cele 8 felii: număr de rânduri, suma Nr, suma L și md5 pe câmpurile păstrate, **toate identice** (ex. `z2_6`: 52 de rânduri, ΣNr 2990, md5 `f36087…`; `z2_7`: ΣL 11.600, md5 tronsoane `552ee3…`).
- **`agregare_test.ts`** (45 de teste: 17 din runda 3 + 9 din runda 4 + 5 din runda 5 + 5 din runda 6 + 9 din runda 7), cazurile cerute în runda 3:
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

- **Runda 5 — testele verificatorului rundei 4, devenite regresie.** Toate cele 11 teste noi pică pe `a9fe186`, pe aserțiunea de fond. Controlul l-am rulat pe o copie din scratchpad (`neg5`): handler-ul de la `a9fe186` plus exportul constantei `MOTIV_COLOANA_NR`, ca importul să se lege. Pe aceeași copie mai pică 4 teste existente, cu așteptări schimbate intenționat: `peDnMat` în loc de `peDn`, eticheta „Dn250 PE” în note și `material` în `doar_de_verificat`.

  | Test (runda 5) | Rezultat acum | Pe `a9fe186` |
  |---|---|---|
  | BLOCANT 470 V1: `z1_6` fără tabel transcris | 102 / **24.235 m** sigur + 37 / 25.870 m de verificat (`MOTIV_COLOANA_NR`), 0 prin poziție | 139 / 50.105 m, 37 prin poziție, 0 de verificat |
  | BLOCANT 470 V2: `z1_6` cu antete transcrise altfel | idem | idem |
  | BLOCANT 470 V3: `z1_6` căzută (eroare) | idem | idem |
  | BLOCANT 470 V4: `z1_7` cu antete transcrise altfel | idem | idem |
  | BLOCANT sintetic: tabel pe 3 coloane de felii (Nr în `z?_5`, L în `z?_7`), banda 1 fără mijloc; control: tabel fără Nr în `z1_2` | 5 rânduri / 1.700 m (Nr 3–5 + `poz z1_2.t1#1–2`) + 1.000 m de verificat | 9 / 2.700 m (Nr 3, 4 de două ori); la fel cu proba verificatorului (|Δc| ≤ 1 față de fragmentul cu Nr) |
  | E2E (handler + RPC simulat) 470 V4 peste 1751–1756 | sumar 24.235 / 25.870; 1756 Dn40 `cantitate_plansa` 10.440, „diferenta”, nota numește „13 rânduri Dn40 fără identitate sigură”; 1753 Dn110 450; 1751 Dn200 (toate cele 8 rânduri în `z1_7`) golit + notă | Dn40 14.720, cu nota „Memoriu 13.140 m vs planșa 1 14.720 m (+1.580 m …)”; Dn110 1.000; Dn200 „confirmă” 17.785 |
  | E2E `perechi_neimperecheate` (Nr 38 în plus în `z1_7`) | sumar `[{z1_6, z1_7, δ 0, 37/38, neîmperecheate 0/1}]` + avertisment | câmpul lipsește |
  | E2E-T1: Dn110 PE sigur + Dn110 OL de verificat, poziții PE / OL | id 12 (OL): null, „diferenta”, notă; `doar_de_verificat` = [{110, OL, 12, golit}]; id 11 (PE): 500, „extras” | id 12: 900, „extras”, „VECHE OL”; `doar_de_verificat` gol |
  | E2E: o singură poziție Dn110 (memoriu 500) + PE sigur + OL de verificat | 500, „diferenta” (doar din rândul OL), nota „De verificat (Dn110 OL, fără nicio cifră sigură): …” | OL „acoperit” de PE, `doar_de_verificat` gol |
  | E2E: TOTAL „extras” cu rest pe planșă | `cantitate_plansa` 1.740, „diferenta” | 1.740, „extras” |
  | E2E: grup sigur ambiguu (două poziții Dn110 PE) | nimic scris; `ambigue[0].de_verificat` = „1 rând Dn110 PE fără identitate sigură (90 m)” | fără `de_verificat` |

  În testul „identitate 470: retransfer…” se verifică acum și că pe 470 curat nu apare `perechi_neimperecheate` și niciun avertisment de perechi.
- **Controale negative runda 5** (mutații pe o copie a handler-ului nou, testele neschimbate; copia nemutată trece 86/86 pe `agregare_test.ts` + `concurenta_test.ts`):

  | Mutație | Teste care pică |
  |---|---|
  | fără regula pe coloana tabelului cu Nr | 6 (V1–V4, sintetic, E2E V4) |
  | doar proba verificatorului (fragment cu Nr la \|Δc\| ≤ 1) | 1 (sintetic, 3 coloane) |
  | cheia restului doar pe Dn (fără material) | 6 (T1, poziția unică, ambiguu + 3 teste de transfer din runda 4 pe etichete) |
  | fără filtrul pe material la „doar de verificat” | 1 (T1) |
  | fără „diferenta” pe TOTAL | 1 |
  | fără `perechi_neimperecheate` în sumar | 1 |
  | fără „diferenta” pe poziția atinsă deja de un grup sigur | 1 |

- **Runda 6 — testele verificatorului rundei 5, devenite regresie** (`agregare_test.ts` +5, `concurenta_test.ts` +4). Cele 6 teste „MAJOR” pică pe `f1274a1`, pe aserțiunea de fond; controlul l-am rulat pe o copie din scratchpad (`neg6`): handler-ul de la `f1274a1` plus exportul constantei `MOTIV_COLOANA_NR_FARA_GEOM`, ca importul să se lege (95 de teste: 88 trec, 7 pică). Al 7-lea e testul sintetic din runda 5, cu așteptare schimbată intenționat: rulează acum cu geometria tăietorului (rezultat identic: 1.700 m + 1.000 m de verificat) și, separat, fără geometrie, unde tabelul fără Nr din `z1_2` trece și el la „de verificat” (`MOTIV_COLOANA_NR_FARA_GEOM`: 1.200 m sigur + 1.500 m). Cele 3 controale trec și pe `f1274a1`.

  | Test (runda 6) | Rezultat acum | Pe `f1274a1` |
  |---|---|---|
  | GEOM-1 / GEOM-2: W = 7.340, tabel cu Nr în `z1_4`, `z1_5` netranscrisă / căzută, fâșia de lungimi în `z1_6` (fixată) | **3 / 750 m** sigur prin Nr, pereche `z1_4+z1_6`, `_observatii` [z1_4, z1_6]; fără geometrie 750 + 750 m de verificat (`…_FARA_GEOM`); control `z1_5` transcrisă = 750 m | 6 / 1.500 m, 3 prin poziție, 0 de verificat |
  | Fâșia din coloana fixată (`z1_6`, rândurile 1–4) nu se poate împerechea: tabelul cu Nr e în banda 2 (`z2_4`, Nr 3–5); control: fâșie în `z1_1` | Nr 3–5 = **450 m** + 900 m de verificat (`MOTIV_COLOANA_NR`); control 5 rânduri, 2 prin poziție | 7 / 1.350 m, 4 prin poziție (Nr 3, 4 de două ori) |
  | „Nr repetat” pe geometrie: H = 3.000, banda fixată `z3_2` atinge `z1_2`; `z1_2`/`z1_3` despărțite de 500 px; controale: geometria standard, gol de 1 px | `z3_2`: **3 / 900 m** (fără geometrie 1.800 m de verificat); despărțite: 1.800 m de verificat („felii care nu se suprapun”), 0 perechi; controalele 3 / 900 m | `z3_2`: 0 sigure / 1.800 m; despărțite: 3 / 900 m (eticheta c, c+1) |
  | E2E GEOM (handler + RPC simulat, W = 7.140, `z1_5` = `z1_6`) | sumar 750 / 0, prin Nr 3; Dn63 **550**, Dn40 **200**, „Planșa 7 confirmă”, „extras” | 1.500 m, 3 prin poziție; Dn63 1.100, Dn40 400, „diferenta” falsă |
  | Transfer: PE 500 + OL 90 sigure pe „Conductă distribuție gaze Dn110” (cifră veche 700), ordine normală și inversată | 700 neatins, „diferenta”, nota cu ambele grupuri; `ambigue[0].grupuri` OL 90 / PE 500; stare identică în ambele ordini | 90 (ultimul câștigă) |
  | Transfer: PE 500 + fără material 300 (+ un rând PE de verificat 40 m) pe „Țeavă PE100 Dn110”; varianta validată | 800 neatins, „diferenta”, nota + „1 rând Dn110 PE fără identitate sigură (40 m)”; validat: 780 și „validat” rămân, doar nota | 300 (500 m PE pierduți) |
  | Controale: `geomTaiere` = `zone_geom` din BD (470) și coloana fixată; fixture 470 cu `zone_geom` real; poziții PE / OL separate | 470 = **133 / 48.905 m**, 133 prin Nr, 0 de verificat, aceleași 4 perechi, 19 rânduri în două benzi; PE 500 / OL 90, `ambigue` gol | trec și pe `f1274a1` |

- **Controale negative runda 6** (mutații pe o copie a handler-ului nou, cu testele neschimbate; copia nemutată trece 95/95 pe `agregare_test.ts` + `concurenta_test.ts`):

  | Mutație | Teste care pică |
  |---|---|
  | împerecherea doar pe etichetă (c, c+1) | 3 (GEOM-1, E2E GEOM, „Nr repetat” pe geometrie) |
  | coloana cu Nr pe etichetă ±1 (regula din `f1274a1`) | 3 (GEOM-1, fâșia fără pereche, sintetic runda 5) |
  | fără fallback (fără geometrie ⇒ nicio interdicție) | 3 (GEOM-1, sintetic runda 5, E2E 470 V4) |
  | fallback fără geometrie = eticheta ±1 | 2 (GEOM-1, sintetic runda 5) |
  | „Nr repetat” pe etichetă ±1 | 1 |
  | toleranță 0 px | 1 |
  | coliziunea ignorată (ultimul grup câștigă) | 2 |
  | nota coliziunii în ordinea grupurilor (nesortată) | 2 |
  | coliziunea scrie suma grupurilor în `cantitate_plansa` | 2 |
  | coliziunea fără „diferenta” pe „extras” | 2 |
  | coliziunea fără intrare în `ambigue` | 2 |

  E2E 470 V4 (fără `zone_geom` în simulare) trece acum prin fallback: rândurile din `z1_7` au motivul `MOTIV_COLOANA_NR_FARA_GEOM`; cifrele sunt aceleași (24.235 / 25.870 m).
- Probele verificatorului rundei 5, rulate pe handler-ul nou (copie `r6v`): GEOM-1/2/3 = 750 m; GEOM-E2E = 550 / 200 „confirmă”; MY-T2 = 590 neatins + notă, MY-T3 = 800 neatins + notă; MY-T4 neschimbat (minorul, §5.7); testele adversariale din rundele 3–4 (`adv*`, `ver_test`, `ver_e2e_test`, 19 teste) dau loguri identice cu `f1274a1`; `p130_run` = 18 / 37.320 m.

- **Runda 7 — regresiile Copilot și cele 4 căi tăcute** (`agregare_test.ts` +9, `concurenta_test.ts` +4; `test-detector-sigla.mjs` +7 verificări). Suitele: `ofertare-plansa-citeste` **122/122**, `-A supabase/functions/` **139/139**, `concurenta_test.ts` 10 × 63/63, `test-cas-felii` 34/34, `test-detector-sigla` 30/30, `verifica-poarta-identica` OK, `deno check index.ts` exit 0, `vitest` 372/372; `deno.lock` neschimbat (md5 875e293d).

  | Test (runda 7) | Rezultat acum | Pe `ab5c449` |
  |---|---|---|
  | **COPILOT-REG-1**: 37/40/41 cu același text — aceeași felie; 37 în banda 1, 40/41 în banda 2; 470 real | 3 rânduri / 900 m; 470: Brâncoveanu Dn40 300 m = Nr 37 (z1_7+z2_7), 40, 41 | trece (regresie a comportamentului existent) |
  | **COPILOT-REG-2**: același rând în zone suprapuse = o dată, cu sursele | Nr 37: un rând, `_surse` = [z1_7 rând 37, Nr din z1_6; z2_7 rând 6, Nr din z2_6]; 19 rânduri cu 2 surse; `text_extras` „(Nr 37; văzut în z1_7, z2_7)” | pică: `_surse` nu există |
  | **COPILOT-REG-2 (E2E)** prin handler: `citire_ai.tronsoane_unice` salvat | un rând Nr 37 cu `_observatii` + `_surse`; `text_extras` cu sursele | pică |
  | **COPILOT-REG-3**: antete identice ≠ același tabel | Nr diferite în aceeași felie ⇒ 4 / 1.200 m; fără Nr (D) ⇒ 4 / 950 m; același Nr cu L diferit în benzi vecine ⇒ conflict 250/260 (în raport); același Nr de două ori în felie ⇒ „Nr repetat”; felii nevecine (z1_2 / z4_2 pe geometria reală) ⇒ 1.200 m de verificat | trece |
  | **COPILOT-REG-4**: identitate ambiguă în raport | împerechere ambiguă (3 lecturi) + același Nr sub antete diferite (2) ⇒ 150 m sigur, **1.500 m de verificat separat**; `raportIdentitate`: sumar, lista cu motive, avertismentul; `text_extras` „DE VERIFICAT … 1500 m”; nota transferului numește restul | trece |
  | **B1** (ADV7-A/B) fără geometrie | fâșia Dn+L și fâșia L: **750 sigur + 750 de verificat** (`MOTIV_FARA_GEOM_COLOANA_FIXATA`, rămâne `poz z1_4`); cu geometrie 750 / 0; ADV7-B 750 + 750 (cu geometrie 0 + 1.500); controale: \|Δc\| = 3 cu geometrie ⇒ 1.500 sigur, fără ⇒ 750 + 750; 130-like (c, c+1) neschimbat | 1.500 m sigur, 0 de verificat |
  | **B2** dublă parțială în aceeași felie | prefix: **3 / 750 m + 500 m** de verificat (`MOTIV_DUBLA_PARTIALA`); bucată de la mijloc / final și ne-contiguă: tot 3 / 750; dublura identică 0 + 1.500 (ca înainte); tabele diferite 5 / 1.200 | 5 / 1.250 m sigur |
  | **B3** 470 fără Nr 50 în ambele felii | 132 / 48.685 m + `nr_lipsa` [p1, Nr 1–133, lipsesc 50, zone z1_6…z4_6], `total_sigur_incomplet`, avertisment, nota transferului, `text_extras` ⚠; Nr 50 ilizibil (rândul există) ⇒ 220 m de verificat + „1 rând cu Nr ilizibil”; 470 intact ⇒ niciun semnal | câmpul lipsește (0 semnal) |
  | **B3 (E2E)** prin handler + RPC simulat | sumar 48.685 / 0, `total_sigur_incomplet`; 1751–1756 „diferenta”, nota se termină cu „pe planșă: … secvență Nr incompletă: lipsesc Nr 50 …”; `text_extras` ⚠ | 5 poziții „confirmă”, „extras”, nimic despre gol |
  | **B4** două tabele identice în benzi vecine (H 3.000, fâșie 200 px, 200 dpi ⇒ ≤ 14 rânduri) | 20 de rânduri: **0 sigur, 40 de lecturi / 4.380 m de verificat** (`MOTIV_PESTE_CAPACITATE`); fără scară tot peste (≤ 18); 10 rânduri: comasate + `comasari_neconfirmate` + avertisment + ⚠; T2 = T1 + 2 rânduri ⇒ semnal (`integral_in` z1_2); suprapunere reală (Nr 1–12 / 7–14) ⇒ niciun semnal; pe orizontală (z1_2 / z1_3, aceleași antete) ⇒ 3 rânduri + semnal `axa: 'orizontal'`, fâșie 192 px; 470 ⇒ niciun semnal | 20 / 2.190 m sigur, al doilea tabel pierdut tăcut |
  | **ADV7-M5**: același tabel în z1_2 și z4_2 (benzi care nu se ating) | 0 sigur, 1.800 m de verificat („felii care nu se suprapun”); control z1_2 / z2_2 ⇒ 900 m | trece (codul era corect; testul prinde mutantul „doar x”) |
  | **MY-T4** prin handler: PE sigur 500 + fără material 90 de verificat, poziții PE / OL | OL (id 12): 900 neatins, „diferenta”, nota „… fără material, pot fi ale acestei poziții …”; `doar_de_verificat` [{110, null, 12, nota_fara_material}]; OL validat ⇒ rămâne validat, doar nota | OL 900 „extras”, „VECHE OL” |
  | **TOTAL** nu e candidat pe Dn (spion pe `p_randuri`) | „Total conducte De 110” singur: Dn110 PE intră ca poziție nouă, TOTAL primește totalul, un singur update pe id; cu „Conductă PE Dn110”: 500 / 500, `ambigue` gol | două update-uri pe id 4 ([4, 4]); cu poziția reală: ambiguu, nimic scris pe Dn110 |
  | `test-detector-sigla.mjs` §10: `zoneTaiere` (api/plansa-felii.js) | W 7.140 (rest 100 px): 5 zone, nu 6 (`identice` [[1_6, 1_5]]); W 7.340: 6 zone (control); W 7.140 × H 3.000: 10 zone unice, 8 sărite; H 1.600: banda 2 = banda 1 ⇒ 3 zone, nu 6; 470 (9.362 × 6.623): 35 zone, nimic sărit; prefixul paginii păstrat | funcția nu există (feliile identice se tăiau, se urcau și se plăteau de două ori) |

  **Control negativ pe `ab5c449`** (copie `scratchpad/r7/neg`: handler-ul de la `ab5c449` + doar exporturile noi — constantele de motiv, `capacitateFasie`, `intervaleNr`, un `raportIdentitate` minimal — ca importurile să se lege; `--no-check`): 108 teste, **9 pică**, toate pe aserțiunea de fond (REG-2 ×2, B1, B2, B3 ×2, B4, MY-T4, TOTAL cu „un singur update pe id: [4,4]”); trec REG-1, REG-3, REG-4, ADV7-M5 (comportament deja corect, acum fixat ca regresie).

  **Mutații pe o copie a handler-ului nou** (`scratchpad/r7/mut/run.py`, testele neschimbate; copia nemutată 108/108) — **toate 18 prinse**, plus 1 pe `api/plansa-felii.js`:

  | Mutație | Teste care pică |
  |---|---|
  | B1 dezactivat | 1 (B1) |
  | B1 aplicat și cu geometrie | 1 (controlul \|Δc\| = 3 cu geometrie) |
  | B1 marchează grupul din stânga | 1 (rămâne `poz z1_4`, fâșia din z1_6 de verificat) |
  | B2 dezactivat | 1 |
  | B2 doar sub-secvență contiguă | 1 (rândul din mijloc omis) |
  | B3 fără `nr_lipsa` | 2 (unitar + E2E) |
  | B3 fără golul în nota transferului | 2 |
  | B3 fără „diferenta” pe incomplet | 1 (E2E) |
  | B3 fără avertisment | 2 |
  | B4 fără capacitate | 1 |
  | B4 capacitate fără +2 | 1 |
  | B4 fără comasări integrale | 1 |
  | B4 comasare integrală doar pe ambele părți | 1 (T2 = T1 + 2 rânduri) |
  | B4 fără semnalul pe orizontală | 1 |
  | REG-2 fără `_surse` | 6 (REG-2 unitar + E2E; semnalul pe orizontală citește `_surse`) |
  | „Nr repetat” doar pe x (ADV7-M5) | 2 (ADV7-M5, REG-3) |
  | TOTAL candidat pe Dn, fără gardă | 1 |
  | MY-T4 dezactivat | 1 |
  | `zoneTaiere` fără dedup (api) | 4 verificări din §10 |

  **Probele verificatorilor rulate pe handler-ul nou vs `ab5c449`** (copie `scratchpad/r7/probe`, loguri comparate): `adv_test`, `adv2_test`, `adv3_test`, `ver_test`, `adv7b_test`, `my_geom_test`, `ver_e2e_test`, `my_geom_e2e_test`, `adv7_e2e_test` — **identice**; diferă doar ce trebuia: `adv7_test` (ADV7-A/B fără geometrie: 1.500 sigur ⇒ 750 + 750) și `my_e2e_test` (MY-T4: OL „diferenta” + notă). `p130` = 18 / 37.320 m (Dn250 30.970, Dn180 1.105, Dn160 5.245), neschimbat; singurul semnal nou e comasarea pe orizontală `z1_4`+`z1_5` (vezi B4 în §5.3: cel mai probabil fals-pozitiv, fiindcă coloana fixată `z1_5` acoperă 1.643 px din `z1_4`).

### 5.7 Limite cunoscute (documentate, nu blochează) — actualizat în runda 7
**Ce e acum vizibil (runda 7), care înainte era tăcut:** tabelul fără Nr sub coloana fixată fără geometrie (B1, „de verificat”); transcrierea dublă parțială în aceeași felie (B2, „de verificat”); golurile din secvența Nr (B3, `nr_lipsa` + avertisment + nota transferului + ⚠ în text, total marcat incomplet); comasarea între benzi peste capacitatea fâșiei (B4, „de verificat”) și, sub capacitate, comasarea integrală pe vertical sau pe orizontală (B4, `comasari_neconfirmate` + avertisment + ⚠); a doua poziție de pe un Dn la restul fără material (MY-T4, notă + „diferenta”); rândul TOTAL cu Dn în denumire (un singur update pe id); feliile identice (tăiate și plătite o singură dată, `zone_identice`). Totalul sigur nu se mai poate umfla pe nicio cale cunoscută; pierderile cunoscute sunt toate semnalate, cu excepțiile de mai jos.

**Ce rămâne (limite, cu semnalul care există):**
- `total_de_verificat_m` e un **plafon brut**: fiecare lectură fără identitate se adună separat, deci un rând din suprapunerea verticală poate fi numărat de două ori (inclusiv la comasarea peste capacitate, B4: 20 de rânduri ⇒ 40 de lecturi); conflictele intră cu varianta maximă.
- Două tabele **cu antete identice** și Nr care se suprapun:
  - în aceeași felie, sau în felii nevecine ⇒ „de verificat” (runda 4: „Nr repetat”; axa y testată din runda 7, ADV7-M5);
  - în benzi sau coloane **vecine**, cu text diferit pe o coloană comună (Strada / De la) ⇒ „de verificat” (runda 4: text contrazis);
  - în benzi vecine, cu L/Dn/Q diferite ⇒ conflict (vizibil);
  - în benzi vecine, cu L, Dn, Q **și** text identice (runda 7, B4): peste capacitatea fâșiei ⇒ „de verificat”; sub capacitate ⇒ numărate o dată, **cu semnal** când tot ce vede cel puțin o felie din tabel e în comasare. **Rămâne tăcut** doar cazul în care ambele felii văd și rânduri din afara fâșiei — T1 și T2 ar avea aceleași Nr, cu valori și text identice, pe porțiunea comasată, și rânduri diferite la ambele capete (numerotări care se suprapun parțial). Fără geometrie garda de capacitate nu există (rămâne doar semnalul integral);
  - alăturate (aceeași bandă, coloane vecine), cu aceleași antete ⇒ numărate o dată, **cu semnal** (`axa: 'orizontal'`). Semnalul poate fi fals-pozitiv când coloana fixată acoperă mult din vecina ei (130: 1.643 px), fiindcă atunci tabelul chiar poate fi văzut întreg în ambele felii.

  Cu antete diferite și același Nr ⇒ „de verificat”.
- **B4 — capacitatea** depinde de `H_MIN_RAND_MM` = 2 mm (≈ 60% din rândul măsurat pe 470) și de scara sursei. Fără scară (scanări fără dpi / puncte PDF), 12 px; sub ~100 dpi un tabel real cu rânduri de 2 mm poate depăși capacitatea ⇒ „de verificat” (fals-pozitiv vizibil, nu pierdere). Toate cele 7 documente cu geometrie din BD sunt randări la 200 dpi.
- **B2 — dublura parțială** se recunoaște doar când a doua transcriere e o sub-secvență exactă (L/Dn/Q) a primei. O a doua transcriere cu o valoare citită diferit nu e sub-secvență și se numără ca al doilea tabel; semnalul care rămâne e avertismentul existent pe rândurile identificate prin poziție cu aceeași lungime și același Dn („pot fi tronsoane reale diferite sau rânduri citite de două ori”), doar când măcar un rând a fost citit la fel de ambele dăți. Dublura identică trimite ambele copii la „de verificat” (nu se știe care e originalul).
- **B1 e deliberat larg:** fără geometrie, orice al doilea tabel fără Nr aflat la ≥ 2 coloane de felii în dreapta altuia, pe aceeași bandă, trece la „de verificat”, chiar dacă e alt tabel (fail-safe, cu motiv). Remediul e retăierea (scrie `zone_geom`). Pe datele de azi nu apare (130 are un singur tabel cu lungimi).
- **B3 — golurile din secvența Nr** se văd doar **între** primul și ultimul Nr citit al unui tabel (pagină + antete). Începutul / sfârșitul tabelului nu se pot verifica pe Nr (numerotarea poate continua de pe altă planșă) — acolo rămân `nr_fara_lungime` și `perechi_neimperecheate`. Nr-urile cu sufix (12a) nu intră în verificare. Dacă o bandă are antetele transcrise altfel, formează alt „tabel” și pot apărea goluri false (semnal în plus, nu pierdere; cazul e oricum însoțit de rânduri „de verificat”, V1–V4).
- Garda „tabel dublat” (tabel fără Nr transcris de două ori în aceeași felie) și B2 lucrează doar în **aceeași felie**; între felii diferite decid împerecherea, garda multi-bandă și B1.
- `nrFaraLungime` semnalează rândurile numerotate fără lungime doar pentru fragmentele cu Nr împerecheate sigur cu o felie cu lungimi. Dacă împerecherea eșuează, toată banda trece oricum la „de verificat” (ADV-H).
- Comparația de text (runda 4) poate trimite la „de verificat” și două lecturi ale aceluiași rând transcrise foarte diferit, ex. o abreviere („Str. Florenta Albu” / „Florenta Albu”). Asta e fail-safe, nu tăcut; pe 470 nu apare niciun caz (19/19 rânduri din suprapunere trec).
- **La transfer:**
  - o poziție validată sau „diferenta” pe un (Dn, material) doar de verificat își păstrează `cantitate_plansa` din citirea anterioară, iar nota o numește explicit veche;
  - rândul TOTAL primește, când există rânduri sigure, doar partea sigură, cu restul numit în notă, și trece în „diferenta” dacă era „extras” și există rest pe planșă (inclusiv secvența Nr incompletă);
  - restul fără material pe un Dn cu grup sigur (MY-T4, închis în runda 7) marchează și celelalte poziții de pe Dn, dar **nu le golește** cifra din planșă (poate veni din altă planșă); nota o numește „dintr-o citire anterioară”;
  - **coliziunea** (runda 6: mai multe grupuri sigure pe aceeași poziție) lasă `cantitate_plansa` neatinsă, cu nota care o numește veche, și trece poziția „extras” în „diferenta”. Nu o golește (ca „doar de verificat”), pentru că cerința a fost „niciun update de `cantitate_plansa` pe acel id”; golirea ar fi o alternativă de decis;
  - rândul TOTAL se recunoaște după „total” în denumire; o poziție de conductă numită „… lungime totală” ar fi luată drept TOTAL (pe BD nu există; SELECT 26.09);
  - poziția neatinsă de citire își păstrează cifra, comportament de dinainte, nelegat de identitate.
- **Regula pe coloana tabelului cu Nr (runda 5, pe geometrie din runda 6) e deliberat largă:**
  - un tabel fără Nr care are lungimi și a cărui felie atinge pe orizontală o felie a unui tabel cu Nr (orice bandă, aceeași pagină) trece la „de verificat” cu `MOTIV_COLOANA_NR`, chiar dacă e alt tabel. E fail-safe, cu motiv, nu tăcut. Pe datele de azi nu apare: singurele fragmente cu Nr sunt `z?_6` din 470 (SELECT 26.09);
  - **fără geometrie** (tăiere veche), poziția e interzisă pe **toată pagina** unui tabel cu Nr (`MOTIV_COLOANA_NR_FARA_GEOM`), inclusiv pentru un tabel fără Nr aflat departe. Remediul e retăierea (scrie `zone_geom`). Pe datele de azi nu apare: singurul document fără geometrie (130) n-are Nr.
- **Împerecherea caută doar între felii care se ating în aceeași bandă** (runda 6: pe geometrie, deci și coloana fixată cu `_N-1`; fără geometrie, c și c+1). Un Nr aflat într-o felie care nu atinge felia cu lungimi ajunge la rând doar prin fragmentul din mijloc, dacă are câmpuri comune cu ambele. Dacă fragmentul din mijloc lipsește într-o bandă, dar există în alta, rândurile din banda fără mijloc trec la „de verificat” (regula pe coloană, testul sintetic).

  Dacă mijlocul lipsește în **toate** benzile:
  - tabelul pe mai multe benzi ⇒ „de verificat” (garda multi-bandă);
  - tabelul într-o singură bandă ⇒ rândurile rămân pe poziție. Se numără o singură dată, pentru că nicio lungime nu se leagă de un Nr, dar Nr-urile nu apar în identitate.
- **Felii identice:** din runda 7 `api/plansa-felii.js` (`zoneTaiere`) nu le mai taie și nu le mai plătește de două ori (dedup pe (left, top) în aceeași sursă, prima etichetă păstrată, `zone_identice` = [sărită, păstrată]). Apar când restul W (sau H) peste (N−1)·pas e ≤ latura − pas (~192 px), inclusiv H între pas și latură (banda 2 = banda 1). Tăierile vechi pot avea încă felii identice; agregarea le tratează corect (se împerechează ca felii care se ating, numărate o dată). Pe geometriile din BD nu apare (cel mai mic rest: 454 px).
- **Identitatea depinde de `tabele[].randuri`.** Promptul (`INSTRUCTIUNI`) cere deja tabelele cu rânduri și nu s-a schimbat.
  - Omisiunea **parțială** (o felie cu Nr netranscrisă, căzută sau cu antete transcrise altfel) nu mai umflă totalul: rândurile fără Nr din coloana tabelului cu Nr trec la „de verificat” (V1–V4).
  - Omisiunea **totală** a rândurilor cu Nr pe un tabel pe mai multe benzi ⇒ totul „de verificat” (testul 6b).
  - Tabelul într-o singură bandă, fără nicio felie cu Nr transcrisă ⇒ rămâne pe poziție, numărat o dată.
  - Un rând omis de AI în **toate** feliile care îl văd: dacă e între Nr citite ⇒ semnalat (B3); la capătul tabelului ⇒ doar prin `perechi_neimperecheate` / `nr_fara_lungime`, când există.
- `_surse` (REG-2) mărește `citire_ai.tronsoane_unice` cu ~110 octeți pe observație (470: 152 de observații, ~17 KB, față de ~180 KB cât are azi `citire_ai.felii`).
