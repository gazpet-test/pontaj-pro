# R4 — fără apeluri AI duplicate între taburi (rezervare pe zonă) + coada pe NAS (design)

Data: 25.09.2026 (noapte) · Răspuns la verdictul Copilot: „Rămân coada independentă de browser și prevenirea apelurilor AI duplicate între taburi.”
Ramură locală: `claude/r4-rezervare-zone` (bază `main` @ `8a6fbbb`). **Nimic deployat, nimic pushat, nicio scriere în BD** (doar SELECT-uri).

| Punct | Stare |
|---|---|
| Apeluri AI duplicate între taburi | **închis în cod + teste**, fără schemă nouă (§2) — de deployat (edge + Vercel) cu GO |
| Coada independentă de browser | **design + migrare propusă, neaplicată** (§3, `docs/R4_MIGRARE_PROPUSA_ofertare_plansa_coada.sql`) — estimare ~1 zi, peste pragul de ½ zi ⇒ nu s-a implementat |

## 1. Starea exactă înainte de fix (`main` @ `8a6fbbb`)

### 1.1 Ce era deja persistent / sigur
- **CAS pe citire**: fiecare scriere a `analiza` filtrează pe `analiza->citire_ai->>rev` + `analiza->plansa->>taiat_la` (`concurenta.ts → scrieCAS`); la conflict se recitește și se fuzionează pe zone (`fuzioneazaZone`), max. 3 încercări, apoi 409.
- **Tăierea** (`plansa.taiat_la`, scrisă de `/api/plansa-felii`) și **versiunea** (`cod|model|prompt_sha` + `taiat_la/cale_felii/geom_sha/fisier`) blochează amestecul (409).
- **Rezultatele pe zonă** stau în `citire_ai.felii[]` (cu `_versiune`, `_zona`, `_regiune`) ⇒ „⏯ continuă” nu replătește zonele deja salvate.
- **Transferul în cantități**: lease `citire_ai.transfer` + RPC atomic `ofertare_transfer_plansa_cantitati` (aplicat, GO Razvan, vezi `RESTANTE_AUDIT_OFERTARE.md`).

### 1.2 Unde e încă bucla în browser
Serverul citește max. `FELII_PE_RULARE = 4` zone pe invocare și întoarce `continua=true`; **browserul** reia:
- `src/OfertareLicitatii.jsx:1070` `citestePlansa` — `/api/plansa-felii` (tăiere), apoi `while (runde < 25)` cu `de_la` (l. 1086–1093);
- `:1053` `reiaPlansa` — `mod: 'continua' | 'reia_erori'` (l. 1057–1063);
- `:1046` `lipesteNote` (perechi „note tăiate”); `:1132` `citesteToatePlansele` — planșele pe rând (comentariul de la l. 1120: „nu există coadă pe server pentru planșe”).
Tab închis ⇒ citirea se oprește și rămâne `gata:false` până apasă cineva „continuă”.

### 1.3 Scenariul concret de plată dublă (linii din `main`)
Lotul se calcula DOAR din rezultatele salvate, fără să știe de rundele în zbor:
- `handler.ts:621` `existente` = `ca0.felii` (citite la începutul invocării);
- `handler.ts:624–628` `lot` = zonele fără rezultat (`continua`) / căzute (`reia_erori`) / `felii.slice(de_la, de_la+4)`;
- `handler.ts:643` `citesteFelie(...)` = apelul plătit, pe fiecare zonă din lot; `:650` `ai_usage_log`;
- `handler.ts:853` `scrieCAS` → la conflict `:692` `fuzioneazaZone` păstrează rezultatul O dată — banii s-au dat de două ori.

Exemplu: planșă cu `z1_5`, `z1_6` necitite; tab A și tab B apasă „⏯ continuă” ⇒ ambele calculează `lot=[z1_5,z1_6]` ⇒ **4 apeluri Opus în loc de 2**. La fel: A în bucla „citește” (`de_la=4`) + B „continuă” (lotul lui B include zonele în citire la A); două „🔁 reia zonele căzute”; „🧩 note tăiate” din două taburi (`handler.ts:560/566`, până la 6 perechi de două ori); B apasă „citește” cât A citește ⇒ `/api/plansa-felii` șterge feliile + `taiat_la` nou ⇒ runda lui A, deja plătită, cade cu 409.
Ordin de mărime (SELECT pe `ai_usage_log`, `function_name='ofertare-plansa-citeste'`, 25.09): 124 invocări, 22,12 USD, 8 documente; medie 0,178 USD/invocare, maxim 0,711 USD. `ai_usage_log` nu are zonă/rulare ⇒ dublurile din trecut **nu se pot număra** retroactiv.

## 2. Fix implementat: rezervare per (document, zonă, tăiere), înainte de AI

### 2.1 Mecanism (fără schemă nouă)
- Stocare: `analiza.rezervari_zone = {rev, zone: {cheie: {rulare, taiat_la, de_la, pana_la}}}`; cheie = zona (`z1_5`) sau perechea (`lipire:z1_1+z1_2`).
- Rezervarea se face prin **CAS** (`concurenta.ts:198 rezervaChei`): lotul se calculează pe documentul **proaspăt** (`handler.ts:654 planifica`), se exclud zonele rezervate activ de **altă** rulare pe **aceeași** tăiere (`:164 rezervateDeAltii`), apoi se scriu rezervările (jeton `rezervari_zone.rev` nou, `:172 rezervariNoi`). La conflict se recalculează (alt tab a rezervat între timp).
- Toate candidatele rezervate de alții ⇒ **409** „Zonele … sunt în lucru în alt tab (altă rulare), rezervate până la HH:MM — nu s-a apelat AI, nu s-a plătit nimic” + `in_lucru`, `rezervat_pana_la`, `cost_usd: 0` (`handler.ts:672–675`). Zero AI, zero scrieri.
- Parțial rezervate ⇒ tabul curent citește doar restul (cooperare); `in_lucru_alt_tab` în răspuns, iar bucla nu mai cere runde pentru zonele celuilalt (`handler.ts:753 maiSunt`). La `de_la>0`, o zonă citită deja bine în citirea curentă nu se mai plătește; `de_la_urmator` avansează după ultima zonă din lot (`:681`).
- Eliberare: la scrierea rezultatului (`handler.ts:868 rzCurat`, scoate rezervările rulării curente, curăță expiratele / altă tăiere); la eșec (excepție în AI `:702`, CAS epuizat `:915`) — best-effort (`concurenta.ts:225 elibereazaRezervari`).
- **Expirare**: `REZERVARE_EXPIRA_MS = 7 min` (`concurenta.ts:155`) > limita de ceas Edge (150 s Free / 400 s plătit — docs Supabase „Edge Functions / Limits”). Tab închis / funcție omorâtă ⇒ după expirare zona se **preia** automat.
- Rezervările de pe **altă tăiere** sunt ignorate (zonele nu mai corespund).
- Toate scrierile CAS filtrează acum și pe `analiza->rezervari_zone->>rev` (`concurenta.ts:18 CALE_REZ`, `:106`) — o scriere a citirii nu mai poate șterge pe tăcute rezervarea făcută de alt tab. RPC-ul de transfer folosește `jsonb_set` pe `citire_ai` ⇒ nu atinge rezervările.
- „🧩 note tăiate”: aceeași rezervare pe perechi (`handler.ts:563`).
- **Retăierea** (`api/plansa-felii.js`) e refuzată cu 409 cât există zone rezervate active pe tăierea curentă: verificare la început (l. 162–173) și **re-verificare pe starea proaspătă chiar înainte de ștergerea feliilor** (l. 299–303); funcția `rezervariActive` în `api/_cas.js:13`.

### 2.2 Teste (deps simulate, fără rețea, fără AI real)
`deno test --node-modules-dir=none supabase/functions/ofertare-plansa-citeste` ⇒ **55 passed, 0 failed** (înainte: 44; rulat de 10 ori la rând, 10/10 verzi). Noi (`concurenta_test.ts`):
- două „continuă” simultane pe aceleași zone ⇒ **2 apeluri AI** (nu 4), al doilea tab 409 „în lucru în alt tab”, `citite_acum: 0`, nicio rezervare rămasă;
- două taburi pe zone care se suprapun parțial ⇒ fiecare zonă citită **exact o dată** (5 apeluri pe 5 zone), fără 409;
- rezervare activă a altei rulări ⇒ 409, 0 AI, 0 scrieri, rezervarea celuilalt neatinsă;
- rezervare **expirată** ⇒ preluată, zona citită, rezervarea veche curățată;
- rezervare pe altă tăiere ⇒ nu blochează;
- rezervarea există ÎN TIMPUL apelului AI (termen = 7 min) și dispare după scriere;
- CAS epuizat la scrierea rezultatului ⇒ 409, rezervarea eliberată, nimic suprascris;
- „citește” pe runde (`de_la=4`) sare zona rezervată de alt tab, `continua=false`, `de_la_urmator=6`;
- „note tăiate” din două taburi ⇒ perechea plătită o dată;
- unitar `rezervateDeAltii`/`rezervariNoi`.
**Test existent adaptat (transparent):** „două rulări simultane «citește» → un singur transfer” accepta 4+4 apeluri AI; acum al doilea tab nu mai plătește (4 apeluri, 409). Traseul lease-ului („transfer în curs de altă rulare”) e păstrat într-un test separat („citește” nou terminat în timpul transferului ⇒ sărit, 1 RPC, 1 inserare).
Alte rulări: `deno test --node-modules-dir=none -A supabase/functions/` ⇒ **72 passed, 0 failed**; `node scripts/test-cas-felii.mjs` ⇒ **20/20** (+6: `rezervariActive`, aceeași funcție în handler); `node scripts/test-detector-sigla.mjs` ⇒ 23/23. `deno.lock` readus.

### 2.3 Ce NU acoperă (reziduu, documentat)
- **Fereastra tăiere+upload** în `/api/plansa-felii`: o citire care rezervă după re-verificare și înainte de scrierea tăierii noi ⇒ o rundă (≤4 zone) plătită și pierdută (409). Secunde, nu minute.
- **Între runde** (bucla din browser, ~sub o secundă) nu există rezervare ⇒ un „citește” din alt tab poate trece de verificare și retăia (acțiune explicită de om). O închide coada (§3).
- **Retry-ul furnizorului** în `citesteFelie` (429/529/5xx, max. 2) rămâne — e pe aceeași rezervare, nu dublură între taburi.
- Un tab ținut >7 min într-o singură invocare (imposibil pe Edge: max. 400 s) ar pierde rezervarea.
- UI: mesajul de 409 apare ca „Eroare la citire/reluare: Zonele … în lucru în alt tab …” (prin `mesajInvoke`); la final de buclă cu zone lăsate altui tab, UI spune tot „Planșă citită” cu sumarul parțial (`in_lucru_alt_tab` nu e afișat). Cosmetic, `src/` neatins.

## 3. Coada pe NAS (independentă de browser) — design + estimare; NEimplementată

### 3.1 De ce nu acum
Estimare ~1 zi (§3.9) > ½ zi; cere **schemă nouă** și e o **automatizare nouă care cheltuie AI** (CLAUDE.md pct. 3, 4, 7) — iar workerul NAS își ia singur codul din `main`, deci un merge o pornește imediat. Se livrează doar cu GO + plafon decis de Razvan.

### 3.2 Model: job pe (document, tăiere); idempotența pe zonă rămâne cea din §2
Tabel `ofertare_plansa_coada` (fișier: `docs/R4_MIGRARE_PROPUSA_ofertare_plansa_coada.sql`): `doc_id, licitatie_id, mod (citeste|continua|reia_erori), taiat_la, cale_felii, fisier_path, doc_sha256, versiune, stare (asteapta|lucru|gata|partial|eroare|anulat|oprit_plafon), incercari/max_incercari, urmatoarea_la, luat_de/luat_la/lease_pana, runde, cost_usd, plafon_usd, jurnal, rezultat, cerut_de`. RLS: doar SELECT pentru `authenticated`; **fără INSERT direct**.
De ce job, nu rând pe zonă (cum propunea `R4_COADA_PERSISTENTA_ZONE.md` §2.1): agregarea (sumar, `rezultatCitire`, transfer, clarificare automată) e în handler; un rând pe zonă ar cere refactorizarea ei într-un modul separat. Cu job + handler reutilizat, per-zonă avem deja rezervare/CAS/fuziune/versiune.

### 3.3 Înscriere — poarta pe cheltuială în SQL
RPC `ofertare_plansa_coada_inscrie(p_doc_id, p_mod)` (`SECURITY DEFINER`, `search_path = public, pg_temp`): owner sau `responsabil_id` al licitației = `auth.uid()` (aceeași regulă ca `poateCheltui`), același mesaj pe doc inexistent; cere `plansa.cale_felii` și `citibila ≠ false`; îngheață `taiat_la`, `cale_felii`, `fisier_path`, `doc_sha256` (din `ofertare_seap_manifest`); `INSERT … ON CONFLICT (doc_id, COALESCE(taiat_la,'')) WHERE stare IN ('asteapta','lucru') DO NOTHING` ⇒ dublu-click / al doilea tab = același job.
UI: „📐 citește” = tăierea (Vercel, secunde, ca azi) + înscriere; mesaj „în coadă — poți închide tabul”; starea jobului din tabel. Dacă heartbeat-ul workerului (`worker_heartbeat`) e mai vechi de 10 min ⇒ se păstrează bucla din browser (failover, ca la celelalte cozi).

### 3.4 Bucla workerului (`worker/ofertare/plansa.ts`, apelat din `main.ts` ca celelalte cozi, un job odată)
1. `rpc('ofertare_plansa_coada_ia', {p_worker, p_lease_min: 10})` — `FOR UPDATE SKIP LOCKED`, preia și lease-urile expirate (worker căzut); joburile peste `max_incercari` ⇒ `eroare`.
2. Verifică proveniența: documentul există, `plansa.taiat_la = job.taiat_la`, `cale_felii` identic ⇒ altfel `anulat` („planșa a fost retăiată — reînscrie”), **zero AI**.
3. Rulează **același** `handler` (import din `supabase/functions/ofertare-plansa-citeste/handler.ts`, deps cu cheia service_role, în proces — fără limita de 150/400 s): prima rundă `de_la:0` (dacă `mod='citeste'` și nu există citire pe tăierea jobului), apoi `mod:'continua'` (sau `reia_erori`) până `continua=false`; la final, dacă `lipire_necesara>0`, un apel `doar_lipire`.
4. După fiecare rundă: `jurnal += {la, body, status, citite_acum, in_lucru_alt_tab, cost_usd, ms}`, `cost_usd +=`, `runde++`, `lease_pana = now()+10 min` — UPDATE condiționat `WHERE id AND luat_de = worker AND stare='lucru'`; 0 rânduri ⇒ lease pierdut ⇒ oprire imediată (fără AI).
5. Răspunsuri: 409 „în lucru în alt tab” ⇒ un tab ține zonele: pauză 60 s, reîncearcă (rezervarea expiră singură); 409 tăiere/versiune ⇒ `anulat` cu motiv; 5xx/excepție ⇒ `asteapta`, `urmatoarea_la = now()+2^incercari min`; eroare de business ⇒ scrisă în rând, nu throw.
6. Final: `gata` / `partial` (zone căzute) + `rezultat` = sumarul; notificare `notifications` către `cerut_de` (`modul='Ofertare'`, permis de CHECK).

### 3.5 Idempotență (trei niveluri)
Înscriere: index unic parțial pe job activ. Job: lease + UPDATE condiționat. Zonă: rezervarea din §2 (+ CAS + fuziune + versiune) — workerul și un tab deschis cooperează fără plată dublă; reluarea după cădere citește doar zonele fără rezultat.

### 3.6 Proveniență
Job: `doc_id`, `fisier_path`, `doc_sha256` (când documentul vine din SEAP — 16/40 planșe au sha256 în `ofertare_seap_manifest`, SELECT 25.09), `taiat_la`, `cale_felii`, `versiune`. Zonă: `_versiune`, `_zona`, `_regiune {pagina, unitate, x0..y1}` (deja în `citire_ai.felii`). Rundă: `jurnal`. Notă: doar 7/40 planșe au `taiat_la` (tăieri istorice) — la acestea cheia jobului e `taiat_la IS NULL`; recomandat: retăiere înainte de înscriere.

### 3.7 Plafon de cost
Pe job: `plafon_usd` (valoare de decis de Razvan; reper: 0,178 USD/rundă medie, 0,711 max) ⇒ `oprit_plafon` + notificare. Pe zi: suma din `ai_usage_log` pentru funcție ⇒ workerul nu mai ia joburi, notifică ownerul. Paralelism la furnizor: `paralel` 2 (configurabil în worker, nu din browser).

### 3.8 Fișa de securitate (pentru `registru_automatizari`, la livrare)
(a) citește conținut extern: imaginea planșei (document SEAP) trimisă la AI; rezultatul e DATE. (b) scrie: `ofertare_plansa_coada`, `analiza` (citire/rezervări), `ofertare_cantitati` (prin RPC-ul de transfer), `ai_usage_log`, `notifications`; nu trimite mail, nu atinge drepturi. (c) identitate: service_role în worker — necesar (scrie pe documentele oricărui responsabil); înscrierea rulează ca utilizatorul. (d) pornire: DOAR prin RPC cu poarta owner/responsabil verificată în SQL; claim-ul doar service_role. (e) cheltuiala pornită doar de om (înscriere), plafonată. (a)+(b) se ating ⇒ poarta de rol e obligatorie — inclusă.

### 3.9 Estimare
Migrare + RPC-uri + advisors: 1–1,5 h · `plansa.ts` + teste cu mock: 2–3 h · UI (buton, stare, failover): 1,5–2 h · test E2E pe NAS cu o planșă mică + registru: ~1 h ⇒ **6–8 h**. Sintaxa SQL propusă nu a fost rulată (DDL interzis în sesiunea asta) — se validează pe o ramură Supabase după GO.

### 3.10 Varianta fără schemă (cheie în `analiza`) — nerecomandată
`analiza.plansa_coada {cerut_de, cerut_la, mod, luat_de, lease_pana}` scrisă de edge după poartă, claim prin CAS pe jeton. Merge, dar: fără `SKIP LOCKED`, fără istoric/jurnal separat de RLS, încă o sursă de conflicte CAS pe aceeași coloană, căutare fără index pe JSON. Tabelul e mai simplu de auditat.

## 4. Observații în afara R4 (de verificat, nu modificate)
- `/api/plansa-felii` cere doar utilizator autentificat (`api/plansa-felii.js:146–151`), **fără poarta owner/responsabil** — orice autentificat poate retăia o planșă (șterge feliile, invalidează citirea în curs). Retăierea nu costă AI, dar poate arunca o citire plătită. Candidat pentru aceeași poartă ca `poateCheltui`.
- Cozile existente `ofertare_acoperire_coada`, `ofertare_clarificari_coada`, `ofertare_ingest_coada`: politică RLS `ALL` cu `auth.uid() IS NOT NULL` + GRANT INSERT/UPDATE pentru `authenticated`, fără triggere (SELECT pe `pg_policies`, `role_table_grants`, `pg_trigger`, 25.09); workerul le execută cu service_role fără verificare de rol pe `cerut_de` (ex. `worker/ofertare/acoperire.ts:44–46`). Adică poarta pe cheltuială se poate ocoli prin insert direct în coadă (CLAUDE.md pct. 7d). Coada propusă în §3 NU copiază politica asta.
