# R4 — fără apeluri AI duplicate între taburi (rezervare pe zonă) + coada pe NAS (design)

Data: 25.09.2026 (noapte) · Răspuns la verdictul Copilot: „Rămân coada independentă de browser și prevenirea apelurilor AI duplicate între taburi.”
Runda 2 (după verificator): defectul major „citește de la zero cooperează” reparat + test; plafon pe `pana_la`; `/api/plansa-felii` fail-closed; corecturi de text; design NAS completat (§3). Plus un bug nou de agregare găsit pe planșa 470 (§5, commit separat).
Runda 3 (verdictul Copilot pe deduplicare): dedup-ul pe multiset (`e762c6e`) e înlocuit cu **identitatea rândului de tabel** — (document, pagină, tabel identificat, Nr rând) — commit `a800d38` (§5).
Runda 4 (26.09, verificatorul rundei 3): rândul de margine nu mai primește identitate prin poziție când tabelul are coloană Nr (blocant); Nr repetat / benzi nevecine / text contrazis / indexul tabelului în cheia de poziție (major); Dn cu toate rândurile de verificat menționat la transfer, fără early-return (major); `COD_VERSIUNE` 2026-09-26.8 (§5.3, §5.5).
Runda 5 (26.09, verificatorul rundei 4): poziția e interzisă în **coloana de felii a unui tabel cu Nr**, chiar dacă felia cu Nr din banda rândului lipsește sau are antete transcrise altfel (blocant V1–V4: 470 dădea 50.105 m sigur, tăcut); restul de la transfer are cheia **(Dn, material)**, ca grupurile sigure (major); TOTAL „extras” cu rest ⇒ „diferenta”, `perechi_neimperecheate` în sumar, SQL-ul 1756 cu ambele variante comentate (minore); `COD_VERSIUNE` 2026-09-26.9 (commit `f1274a1`; §5.3, §5.5–5.7).
Runda 6 (26.09, verificatorul rundei 5): vecinătatea feliilor pe **geometria reală** `zone_geom` (coloana fixată la marginea planșei acoperă și `_N-1`); două grupuri sigure pe aceeași poziție ⇒ ambiguu, nimic suprascris; `COD_VERSIUNE` 2026-09-26.10 (commit `f1c4b66`; confirmat de verificatorul rundei 6: 0 blocante, 0 majore, 3 minore).
Runda 7 (26.09, verdictul Copilot + minorele verificatorilor rundei 6 și ai documentului R5): regresiile obligatorii **COPILOT-REG-1…4** ca teste; cele **4 căi tăcute** rămase devin vizibile (B1 fără geometrie sub coloana fixată, B2 dublă parțială, B3 goluri în secvența Nr, B4 comasare peste capacitatea fâșiei / integrală); ADV7-M5, TOTAL, MY-T4, feliile identice în `api/plansa-felii.js`, rollback-ul 1756 condiționat; `COD_VERSIUNE` 2026-09-26.11 (commit-uri `f4406c7`, `cc2c77f`, `05b92cb`; §5.3, §5.5–5.7).
Runda 8 (26.09, verificatorul rundei 7: 1 major, 7 minore): rândul cu **Nr citit și lungime necitită** (și în tabelul compact) primește regimul lui B3 — raport, notă la transfer, „diferenta”, ⚠ (major); B2 pe subsecvența comună lungă (LCS), B4 cu capacitatea pe tabel și comasarea integrală neascunsă de „Nr repetat” / de un conflict, B3 cu golul dintre grupuri de felii calificat, MY-T4 cu ținta grupului sigur, TOTAL = „total” fără Dn, rollback-urile 1756 condiționate și pe status (minore); `COD_VERSIUNE` 2026-09-26.12 (commit-uri `4e0591d`, `294a739`; §5.3, §5.5–5.7).
Runda 9 (26.09, verificatorul rundei 8: 3 majore, 3 minore): rândul TOTAL cu **interval de Dn** („Total rețea De 63–110”) e TOTAL, nu candidat pe Dn63, iar între candidații unui Dn pozițiile fără „total” au prioritate (majorul TOTAL-a/b, regresie a rundei 8); rândul cu **Nr citit fără lungime** ajunge și la poziția Dn-ului lui (major NFL-DN); **tronsonul sigur fără Dn citit** nu mai dispare tăcut la transfer (major DN0, pre-existent); fără fals-pozitive NFL pe antete Nr diferite, rollback-ul A condiționat și pe nota exactă, §5.7 reformulat (minore); `COD_VERSIUNE` 2026-09-26.13 (commit `3197aa3`; §5.3, §5.5–5.7).
Runda 10 (26.09, verificatorul rundei 9: 2 majore, 3 minore): prioritatea pozițiilor fără „total” se aplică **înaintea** filtrului pe material (subtotalul „Total conducte PE De 110” nu mai ia cifra lângă poziția reală fără material; major TOTAL-a); intervalul de Dn în notația românească („Dn 63÷110”, „De 63/110”, „Dn 63 la 110”, „până la”) și **listele** de Dn („Dn 63, 90 și 110”) fac din „total” un TOTAL global (major TOTAL-b); subtotal = denumirea care **începe** cu „total”, iar ramura „≥ 2 Dn” din `esteTotal` are test (minore); `COD_VERSIUNE` 2026-09-26.14 (commit `85c53f1`; §5.5–5.7).
Runda 11 (26.09, verificatorul rundei 10: 2 majore, 4 minore): numărul **fără prefix Dn** din intervalul / lista rundei 10 e Dn doar urmat de sfârșit, separator, „mm” sau material / SDR — „Total conducte De 110, 20 tronsoane”, „… și 32 branșamente”, „/ 16 bar”, „De 225/20” (grosimea) nu mai transformă subtotalul în TOTAL global (major, regresie a rundei 10); subtotalul numerotat cu litere / cifre romane / „Cap. 3” e recunoscut (major TOTAL-a, rest); subtotalul cedează doar pozițiilor **compatibile ca material** (minor, regresie vizibilă a rundei 10); limita „… totală” cu materialul grupului scrisă în §5.7; „De 110-110” testat (minore); `COD_VERSIUNE` 2026-09-26.15 (commit `91eb62e`; §5.5–5.7).
Ramură locală: `claude/r4-rezervare-zone` (bază `main` @ `8a6fbbb`; numerele de linie din §2 și §5 sunt pe capul ramurii). **Nimic deployat, nimic pushat, nicio scriere în BD** (doar SELECT-uri).

**Verdict propus: PARȚIAL.**

Teste finale pe ramură (pe capul ramurii, după runda 11; toate cu `--node-modules-dir=none --no-lock`, `deno.lock` neatins, md5 `875e293d…`):

| Comandă | Rezultat |
|---|---|
| `deno test supabase/functions/ofertare-plansa-citeste` | **152/152** (după `85c53f1`: 147/147; după `3197aa3`: 141/141; după `b5e7ecd`: 132/132; după `e8489a6`: 122/122; după `f1c4b66`: 109/109; după `f1274a1`: 100/100; după `a9fe186`: 89/89; după `a800d38`: 78/78) |
| `deno test -A supabase/functions/` | **169/169** (după `85c53f1`: 164/164; după `3197aa3`: 158/158; după `b5e7ecd`: 149/149; după `e8489a6`: 139/139; după `f1c4b66`: 126/126; după `f1274a1`: 117/117; după `a9fe186`: 106/106; după `a800d38`: 95/95) |
| `concurenta_test.ts` rulat de 10 ori | 10/10 verzi, 82/82 de fiecare dată |
| `node scripts/test-cas-felii.mjs` | **34/34** |
| `node scripts/test-detector-sigla.mjs` | 30/30 (+7 verificări `zoneTaiere`, runda 7) |
| `npx vitest run` (atinge `api/`) | 372/372 |
| `node scripts/verifica-poarta-identica.mjs` | OK |
| `deno check` pe `index.ts` | OK |

Testele noi pică pe codul vechi: cu gărzile de resetare dezactivate pică 5 teste de resetare. Pentru identitatea rândului, mutațiile pe o copie a funcției (identitate pe text / conflict ignorat / împerechere laxă / fără garda de bandă / fără prefixul de margine) fac să pice 8 / 3 / 5 / 2 / 2 teste (§5.6); pe contraexemplul Copilot, dedup-ul pe mulțime și cel pe multiset dau 1 rând, identitatea dă 2. Runda 4: toate cele 11 teste noi pică pe `a800d38` (copie în scratchpad), iar 8 mutații pe regulile noi fac să pice 1–3 teste fiecare (§5.6). Runda 5: toate cele 11 teste noi pică pe `a9fe186`, iar 7 mutații pe regulile noi fac să pice 1–6 teste fiecare (§5.6). Runda 8: toate cele 12 teste noi / actualizate pică pe `e8489a6`, iar 33 din 34 de mutații sunt prinse (a 34-a e echivalentă prin construcție; §5.6). Runda 9: toate cele 9 teste noi și cel actualizat pică pe `b5e7ecd`; 20/20 mutații pe regulile noi sunt prinse (inclusiv „TOTAL candidat pe Dn”, echivalentă în runda 8), iar rollback-ul A e testat pe Postgres local, 41/41 (§5.5, §5.6). Runda 10: toate cele 6 teste noi pică pe `7a7bf86` (celelalte 127 trec), iar 23/23 mutații pe regulile noi sunt prinse, inclusiv „`esteTotal` fără ramura ≥ 2 Dn”, care supraviețuia în runda 9 (§5.6). Runda 11: cele 4 teste noi care vizează defectele pică pe `85c53f1` (al cincilea, „total ca prim cuvânt”, e o gardă împotriva lărgirii regulii și trece și acolo), iar 36/36 mutații pe regulile noi și ale rundei 10 sunt prinse (§5.6).

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
- Rezervarea se face prin **CAS** (`concurenta.ts:211 rezervaChei`). Lotul se calculează pe documentul **proaspăt** (`handler.ts:1659 planifica`). Se exclud zonele rezervate activ de **altă** rulare pe **aceeași** tăiere (`concurenta.ts:170 rezervateDeAltii`), apoi se scriu rezervările (jeton `rezervari_zone.rev` nou, `:178 rezervariNoi`). La conflict se recalculează, pentru că alt tab a rezervat între timp.
- Toate candidatele rezervate de alții: **409** „Zonele … sunt în lucru în alt tab (altă rulare), rezervate până la HH:MM — nu s-a apelat AI, nu s-a plătit nimic” + `in_lucru`, `rezervat_pana_la`, `cost_usd: 0` (`handler.ts:705–708`). Zero AI, zero scrieri.
- **„Citește” de la zero NU cooperează** (defectul major găsit de verificator, reparat în runda 2): scrierea unei resetări pleacă de la baza `[]` (înlocuiește citirea). La reîncercarea CAS ar fi aruncat rezultatele plătite ale rulării care ținea zonele. Acum, orice rezervare activă a altei rulări pe tăierea curentă (zone sau perechi de note) dă 409 „în lucru în alt tab”, zero AI (`handler.ts:696`). **Simetric**, rezervările unei resetări poartă `resetare: true`. Cât sunt active, „continuă”, „reia zonele căzute”, runda următoare a altei bucle (`de_la>0`) și „note tăiate” primesc 409 fără AI (`handler.ts:700–702`, `:588`). Motivul: scrierea resetării le-ar fi aruncat rezultatele după plată. Astfel o resetare nu coexistă niciodată cu altă rulare activă pe aceeași tăiere.
- În rest (fără resetare), rezervarea parțială înseamnă cooperare: tabul curent citește doar restul, `in_lucru_alt_tab` apare în răspuns, iar bucla nu mai cere runde pentru zonele celuilalt (`maiSunt`). La `de_la>0`, o zonă citită deja bine în citirea curentă nu se mai plătește; `de_la_urmator` avansează după ultima zonă din lot (`handler.ts:714`).
- Eliberare: la scrierea rezultatului (`handler.ts:1897 rzCurat`: scoate rezervările rulării curente, curăță expiratele / altă tăiere); la eșec (excepție în AI `:1719`, CAS epuizat `:1945`) eliberarea e best-effort (`concurenta.ts:239 elibereazaRezervari`).
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

### 5.3 Regula implementată (`handler.ts:457 identificaRanduri`, apelată la l. 1848)
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
- `COD_VERSIUNE` 2026-09-25.6 → **.7** → **2026-09-26.8** (runda 4) → **2026-09-26.9** (runda 5) → **2026-09-26.10** (runda 6) → **2026-09-26.11** (runda 7) → **2026-09-26.12** (runda 8) → **2026-09-26.13** (runda 9, mai jos).

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

Regula nouă (în runda 5 `coloaneCuNr`, pe etichetă; din runda 6 `coloanaCuNr`, `handler.ts:590`, verificarea la l. 624, pe geometrie — vezi mai jos):
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

Regula nouă (`handler.ts:263–386` + `identificaRanduri`):
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

**Runda 7 (26.09, Copilot + verificatorii rundei 6 și ai documentului R5) — regresiile Copilot și cele 4 căi TĂCUTE rămase.** Verdictul Copilot (26.09 dimineața) cere regresii explicite: 37/40/41 cu același text = 3 rânduri; același rând în zone suprapuse = o dată, cu observațiile-sursă păstrate; antete identice ≠ automat același tabel; identitate ambiguă = conflict vizibil, fără comasare automată. Verificatorii au numit 4 căi prin care totalul se putea umfla sau pierde fără semnal (toate imposibile pe datele de azi). Toate devin **vizibile** (de verificat cu motiv, sau semnal explicit în raport și în nota transferului); totalul sigur nu se mai umflă tăcut pe nicio cale cunoscută, cu excepțiile listate în §5.7 (*corectură runda 8*: aici scria „pe nicio cale cunoscută”, fără excepții, deși §5.7 lista chiar atunci limita B2; verificatorul rundei 7 a mai găsit o cale tăcută de pierdere, „Nr citit, lungime necitită”, închisă în runda 8).
- **COPILOT-REG-1…4** (`agregare_test.ts`, teste cu aceste nume). REG-2 a cerut un câmp nou: rândul reconciliat are acum **`_surse`** = fiecare observație comasată (felia, tabelul și rândul din felie, L/Dn/Q citite, `nr_din` = feliile din care vine Nr-ul), pe lângă `_observatii` (feliile). Câmpul ajunge în `citire_ai.tronsoane_unice` (verificat E2E prin handler), iar `text_extras` arată rândul ca „… (Nr 37; văzut în z1_7, z2_7)”. Partea de identitate a raportului (sumar + avertismente) e extrasă în `raportIdentitate` (`handler.ts:1428`, pur, exportat), ca testele să verifice raportul, nu doar rezultatul intern; `textPlansa` e exportată din același motiv.
- **B1 — fără geometrie, tabel FĂRĂ Nr sub coloana fixată** (ADV7-A/B). Fără `zone_geom` pe oricare din cele două fragmente, două grupuri de poziție (tabele fără Nr, grupuri de împerechere diferite) de pe aceeași pagină și bandă, la |Δc| ≥ 2 ⇒ **grupul din dreapta** trece la „de verificat” cu `MOTIV_FARA_GEOM_COLOANA_FIXATA` (coloana fixată `_N+1` poate acoperi `_N-1`); cel din stânga rămâne, deci un rând se numără cel mult o dată. Cu geometrie regula nu se aplică (împerecherea / `vecinNeimp` au decis deja pe suprapunerea reală). ADV7-A fără geometrie: **750 m sigur + 750 m de verificat** (ab5c449: 1.500 m sigur, 0 de verificat); ADV7-B (fâșia cu antete diferite) fără geometrie 750 + 750, cu geometrie 0 + 1.500 (neschimbat). Control: două tabele fără Nr la |Δc| = 3 cu geometrie care nu se ating ⇒ ambele sigure (1.500 m); aceleași fără geometrie ⇒ 750 + 750 (conservator, vizibil). Cu B1, fallback-ul fără geometrie e conservator și pentru tabelele fără Nr.
- **B2 — transcriere dublă PARȚIALĂ** a unui tabel fără Nr în aceeași felie. Garda „tabel dublat” (runda 4) prindea doar dublura identică. Acum: dacă secvența L/Dn/Q a unui tabel (doar rândurile cu lungime) e o **sub-secvență mai scurtă**, în ordine, a altui tabel cu aceleași antete din aceeași felie — prefix, bucată contiguă sau cu rânduri omise la a doua transcriere — **surplusul** (tabelul conținut) trece la „de verificat” cu `MOTIV_DUBLA_PARTIALA`; transcrierea completă rămâne. Proba verificatorului: **3 rânduri / 750 m sigur + 500 m de verificat** (ab5c449: 5 / 1.250 m sigur). Am extins cerința („prefix / sub-secvență contiguă”) și la sub-secvența ne-contiguă (rândul din mijloc omis la a doua transcriere), altfel acel caz rămânea tăcut. Dublura identică rămâne ca în runda 4 (ambele de verificat, nu se știe care e originalul); tabele diferite (cazul D) rămân 4 / 950 m.
- **B3 — golurile din secvența Nr** unui tabel identificat (pagină + antete). Un Nr între primul și ultimul citit care nu apare în **nicio** felie (nici cu lungime, nici fără) e un rând fără nicio lectură. Nu se inventează metri: totalul sigur rămâne cel derivat, dar e **marcat incomplet**: `idr.nrLipsa` → `sumar.nr_lipsa[]` (`pagina`, `tabel`, `interval`, `lipsesc` ca intervale „38–41, 50”, `n`, `nr_ilizibil`, `zone`), `nr_lipsa_n`, `total_sigur_incomplet: true`, avertismentul „secvență Nr incompletă: lipsesc Nr 50 (p1, tabel cu Nr 1–133; 1 rând fără nicio lectură, metri necunoscuți) — totalul sigur (48685 m) NU le conține, e INCOMPLET; de verificat pe planșă”, linia „⚠ SECVENȚĂ Nr INCOMPLETĂ …” în `text_extras`, iar la transfer textul intră în `rest.global` („pe planșă: secvență Nr incompletă …” în nota **fiecărei** poziții atinse și a TOTAL-ului) cu `rest.incomplet` ⇒ pozițiile „extras” trec în „diferenta” (cifra e doar partea citită). Rândurile cu Nr ilizibil (care pot fi chiar golul) sunt numărate în mesaj („1 rând cu Nr ilizibil în lectură, la „de verificat””). 470 fără Nr 50 în ambele felii: **132 / 48.685 m sigur + semnal** (ab5c449: aceleași cifre, 0 de verificat, niciun semnal); E2E: 1751–1756 „diferenta”, nota se termină cu golul. Limită: începutul și sfârșitul tabelului nu se pot verifica pe Nr (numerotarea poate continua de pe altă planșă) — acolo rămân `nr_fara_lungime` și `perechi_neimperecheate`.
- **B4 — două tabele identice în benzi vecine** (L, Dn, Q și text identice). Garda geometrică: comasările prin Nr între două felii din **benzi diferite** (suprapuse doar pe vertical) trebuie să încapă în fâșia comună. Capacitatea = ⌊h / h_min⌋ + 2, cu h = înălțimea intersecției `zone_geom`, h_min = `H_MIN_RAND_MM` = 2 mm pe planșă convertiți cu scara sursei (`surse_geom[].dpi` sau latime / latime_pt; fără scară `H_MIN_RAND_PX_FARA_SCARA` = 12 px, adică 2 mm la 150 dpi), iar +2 = câte un rând tăiat de fiecare margine, transcris în ambele felii. **Justificarea din datele reale** (SELECT 26.09): toate cele 7 documente cu `zone_geom` sunt randări la 200 dpi; pe 470 o bandă de 1.600 px are 52 de rânduri, iar fâșia de 192 px dintre benzi 6–7 rânduri (Nr 32–37, 78–83, 123–129) ⇒ rândul are 24–27,4 px ≈ 3,0–3,5 mm; textul de 1,5 mm (pragul din `api/plansa-felii.js`) cere minimum ~2 mm pe rând. Capacitatea fâșiei de 192 px la 200 dpi = 14 rânduri (470 are cel mult 7). **Peste capacitate** ⇒ toate identitățile comasate între cele două felii trec la „de verificat” (fiecare lectură separat) cu `MOTIV_PESTE_CAPACITATE` („… 20 rânduri (Nr 1–20) comasate între z1_2 și z2_2, dar fâșia comună are 200 px ≈ cel mult 14 rânduri …”): nu se știe care din ele e suprapunerea reală, deci nicio comasare automată. **Sub capacitate** cele două cazuri nu se pot deosebi fără coordonate pe rând; când tot ce vede **cel puțin o felie** din tabel e în comasare (fragmentul ei e comasat integral), raportul spune: `sumar.comasari_neconfirmate[]` (`a`, `b`, `nr`, `randuri`, `fasie_px`, `integral_in`), avertisment și linia „⚠ COMASARE NECONFIRMATĂ …” în `text_extras`. Suprapunerea reală a unui tabel întins pe două benzi nu dă semnalul (fiecare felie vede și rânduri din afara fâșiei, ca la 470); îl dă un tabel care începe / se termină în fâșie sau un al doilea tabel identic (T2 ⊆ T1 sau T1 ⊆ T2). Fără geometrie garda de capacitate nu se aplică (doar semnalul integral). **Analogul pe orizontală** (găsit la documentare): două tabele identice ALĂTURATE (aceeași bandă, coloane vecine) se împerechează rând cu rând (câmp comun + ordine, sau L/Dn/Q) și se numărau o dată, tăcut; acum o pereche de fragmente cu lungimi și cu **aceleași antete** (ambele felii văd tabelul întreg — suprapunerea unui tabel întins pe două coloane de felii nu arată așa, fiecare felie are doar o parte din coloane, ca la 470) intră în `comasari_neconfirmate` cu `axa: 'orizontal'` + avertisment, totalul neschimbat. **130 îl primește** (18 rânduri, `z1_4`+`z1_5`): totalul rămâne 18 / 37.320 m; semnalul e corect ca „de verificat”, dar aici e cel mai probabil fals-pozitiv: pe grila lui 130 (latura 2.500, pas 2.200, W 9.957) coloana fixată `z1_5` = [7.457, 9.957] acoperă 1.643 px din `z1_4` = [6.600, 9.100], deci tabelul poate sta întreg în fâșia comună, iar memoriul confirmă 37.320 m = un tabel.
- **Minore:** ADV7-M5 (axa y a „Nr repetat”) e test (mutantul „doar x” e prins); `seSuprapun` era deja corect.

Cifre (fără scrieri în BD): **470 = 133 / 48.905 m** sigur, 0 de verificat, niciun semnal nou (fixture, cu și fără `zone_geom` real); **130 = 18 / 37.320 m** (transcrierea compactă `p130`, md5 e0bb8525, prin poziție; restul tabelelor din 130 — `z2_4`/`z2_5`, `z7_5` — au 0 lungimi, SELECT 26.09, deci nu intră în B1). Pe datele reale nicio regulă nouă nu schimbă vreun total: singurele fragmente cu Nr sunt `z?_6` din 470, fără goluri și fără comasări integrale; singurul tabel fără Nr cu lungimi e 130 (un singur grup, deci B1 / B2 nu se aplică). Singura diferență de raport pe date reale: 130 primește semnalul „comasare neconfirmată” pe orizontală (`z1_4`+`z1_5`), explicat la B4 — totalul rămâne 18 / 37.320 m.

**Runda 8 (26.09, verificatorul rundei 7: 1 major, 7 minore) — fratele lui B3 și cazurile rămase din B2 / B4 / B3** (commit-uri `4e0591d`, `294a739`; `COD_VERSIUNE` 2026-09-26.12).
- **MAJOR — Nr citit, lungime necitită** (a cincea cale tăcută, de aceeași clasă cu B3; nu e regresie, `ab5c449` se comporta identic; nu apare pe datele de azi, dar poate apărea la orice citire nouă). `nrFaraLungime` lua doar fragmentele cu Nr **fără** lungimi, împerecheate cu felia cu L (cazul 470), iar B3 caută doar Nr **absente**. Într-un tabel compact (Nr și L în același fragment, formatul cel mai des întâlnit) rândul cu Nr citit și tronsonul fără lungime lipsea din total fără niciun semnal: proba V8E2E-B3a dă 900 m sigur, 0 de verificat, poziția „confirmă: 900 m”, deși planșa are 3 rânduri. Pe 470 (Nr 50 prezent în `z2_6`/`z2_7`, L necitit) semnalul exista în raport, dar nu ajungea la transfer (1751–1755 „confirmă” / „extras”, fără ⚠). Acum:
  - `nrFaraLungime` ia și fragmentele cu Nr **care au** lungimi (`if (!fr.colNr || (!cuLungimi(fr) && !nrImperecheatCuL.has(fr.i))) continue`); fiecare intrare are `dn`, luat din celula de Dn a rândului sau a rândului împerecheat (`{ nr: '50', zona: 'z2_6', dn: 40 }`);
  - semnalul are **regimul lui B3**: `total_sigur_incomplet`; avertismentul „1 rând cu Nr citit, dar fără nicio lungime citită: Nr 50 (Dn40) — rândul există pe planșă, metrii lui nu sunt în total; totalul sigur (48685 m) e INCOMPLET — de verificat pe planșă”; linia „⚠ Nr FĂRĂ LUNGIME: …” în `text_extras`; la transfer textul intră în `rest.global`, iar `rest.incomplet` trece „extras” în „diferenta” (§5.5). Nu se inventează metri;
  - excepție deliberată: rândul a cărui lungime **s-a citit**, dar a căzut la legarea tronson → rând („valorile tronsonului diferă”), e deja la „de verificat” cu metrii lui, deci nu se numără și ca „fără lungime”;
  - acoperirea se verifică pe (pagină, **tabel**, Nr) (`294a739`). Pe cheia (pagină, Nr) a rundei 4, un Nr citit cu lungime într-un **alt** tabel de pe aceeași pagină ascundea rândul: tabelul A cu Nr 1–2 și tabelul B (alte antete) cu Nr 2 fără L și Nr 3 dădeau 3 rânduri / 903 m, fără semnal. Acum rândul e semnalat, cu `alt_tabel: true` și textul „Nr 2 (Dn90; același Nr are lungime doar într-un tabel cu alte antete)”: poate fi alt tabel sau același tabel transcris cu alte antete, deci e ambiguu, iar ambiguu = vizibil;
  - pe 470 intact și pe 130 nu apare nimic (`z?_7` din 470 n-are coloană Nr, iar 130 n-are Nr).
- **B2 pe subsecvența comună lungă** (minor). Garda din runda 7 prindea doar sub-secvența exactă cu același antet. Trei variante umflau încă totalul, semnalate doar prin avertismentul generic „repetate”, care rămânea în raport:
  - dubla parțială reciprocă [A,B,C] + [B,C,D]: 6 rânduri / 1.350 m sigur, dintr-un tabel de 900 m;
  - a doua transcriere cu antete transcrise altfel: 6 / 1.400 m;
  - a doua transcriere cu o valoare citită diferit: 7 / 1.800 m.

  Regula nouă (opțiunea 1 a verificatorului): LCS pe (L, Dn, Q) de **cel puțin 2 rânduri** și **cel puțin ½** din tabelul mai scurt, în aceeași felie, **oricare ar fi antetele** ⇒ tabelul mai scurt (la egalitate, al doilea) trece la „de verificat” cu `MOTIV_DUBLA_PARTIALA`. Dn sau Q lipsă într-o lectură nu contrazic. Cel mai lung tabel (primul, la egalitate) nu e marcat de nicio pereche, deci o transcriere rămâne sigură. Cifre: reciproc 750 sigur + 600 de verificat; antete transcrise altfel 900 + 500; valoare citită diferit 900 + 900 (tabelul real are 900 m). Un singur rând comun (LCS 1) ⇒ două tabele, ambele sigure (neschimbat).
- **B4 — capacitatea pe tabel** (minor, fals-pozitiv vizibil). Cheia `perBanda` era perechea de felii. Două tabele reale diferite, alăturate în aceeași felie, cu câte 8 rânduri în fâșie, dădeau 16 > 14 ⇒ toate cele 16 identități (32 de lecturi, 12.368 m) treceau la „de verificat”. Acum cheia e (felia A, felia B, **tabelul** = setul de antete): rândurile a două tabele alăturate ocupă aceeași înălțime, deci nu se adună ⇒ 120 de rânduri sigure. Un singur tabel cu 16 rânduri comasate în aceeași fâșie rămâne peste capacitate (control).
- **B4 — „comasat integral” ignoră rândurile deja de verificat** (minor). Cazul: T2 e identic cu T1 și începe în fâșie. `z1_2` vede T1 și primul rând din T2, deci Nr 1 e „repetat” (de verificat), dar rândul acela conta ca „rând în afara fâșiei”, iar Nr 2–10 se comasau cu T1 fără semnal (9 / 954 m). Acum rândurile fragmentului care n-au ajuns în nicio identitate (deja „de verificat”) nu contează la testul „comasat integral” ⇒ `comasari_neconfirmate` [Nr 2–10, `integral_in` z1_2 și z2_2].
- **B4 — semnalul supraviețuiește unui conflict.** Filtrul `every(idSigure)` ștergea tot semnalul dacă o singură identitate din comasare ieșea în conflict (vizibil separat), iar restul rândurilor comasate tăceau. Acum semnalul numește identitățile ieșite sigure: T1 = T2 cu Nr 5 citit diferit ⇒ conflict Nr 5 + comasare neconfirmată Nr 1–4, 6–10 (9 rânduri). L-a scos la iveală mutația verificatorului „fără filtrul idSigure”, neprinsă în runda 7.
- **B3 — golul dintre grupuri de felii care nu se ating** (minor, fals-pozitiv conservator). Două tabele diferite cu aceleași antete pe aceeași pagină, numerotate 1–5 (`z1_2`) și 20–24 (`z4_5`), dădeau „lipsesc Nr 6–19 … NU le conține, e INCOMPLET”. Acum fragmentele unui tabel (pagină + antete) se grupează pe felii care se ating sau sunt împerecheate. Golul dintre Nr din grupuri **disjuncte** e numit ca atare:
  - `nr_lipsa[].intre_grupuri` = „6–19”, `grupuri_felii` = [z1_2, z4_5];
  - textul: „… Nr 6–19 cad între felii care nu se ating (z1_2 / z4_5) — pot fi și două tabele diferite cu aceleași antete”;
  - avertismentul: „dacă e același tabel, totalul sigur … NU le conține (INCOMPLET)”.

  Rămâne conservator: `total_sigur_incomplet`, iar la transfer „extras” ⇒ „diferenta”, fiindcă un rând lipsă dintr-o bandă netranscrisă arată la fel. Golul din interiorul aceluiași grup (470 fără Nr 50) rămâne „incomplet”, fără calificare.

**Runda 9 (26.09, verificatorul rundei 8) — identificarea** (commit `3197aa3`; `COD_VERSIUNE` 2026-09-26.13). Transferul e în §5.5.
- **NFL fără fals-pozitive pe antete Nr diferite** (minor, regresie a rundei 8 față de `e8489a6`, vizibilă și conservatoare, dar zgomotoasă). Același tabel văzut **întreg** în două felii alăturate, ambele cu coloana Nr și cu lungimi, dar cu antetul Nr transcris diferit („Nr crt” / „Nr”): `c.nrs` ține sig-ul doar al primului fragment din componentă, deci toate rândurile celui de-al doilea ieșeau „fără nicio lungime citită (… lungime doar într-un tabel cu alte antete)”, cu `total_sigur_incomplet` și „extras” ⇒ „diferenta”, deși totalul era complet (V9-NFL-FP: 4 rânduri / 1.000 m; V9E-NFL-FP: 900 m).
  - Acum rândul e sărit dacă **vreun nod din componenta lui are lungime** (`valori`); proba dă `nr_fara_lungime` [] fără și cu geometrie, iar poziția rămâne „confirmă” / „extras”.
  - Tot aici: același rând fizic (o componentă) se raportează **o singură dată**, chiar dacă fragmentele lui au antete diferite (controlul testului: rândul 3 fără L în ambele felii ⇒ un singur „Nr 3”, nu două).
- 470 (cu `zone_geom` real și fără, și varianta V9-NFL-FP2 a verificatorului) și 130 rămân neschimbate.

Cifre (fără scrieri în BD): **470 = 133 / 48.905 m** sigur, 0 de verificat, niciun semnal (fixture, cu `zone_geom` real și fără); **130 = 18 / 37.320 m** (`p130`, md5 e0bb8525), cu același semnal de comasare pe orizontală ca în runda 7. Pe datele reale nicio regulă din rundele 8 și 9 nu schimbă un total sau un semnal (runda 9: 0 din 188 de tronsoane „tabel” cu L de pe 130/470 fără Dn — SELECT verificator; 0 denumiri „total” cu Dn și 0 denumiri cu interval de Dn în `ofertare_cantitati` — SELECT 26.09).

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

### 5.5 Transferul în cantități (`treciInCantitati`, l. 1060; `notaRestTransfer`, l. 1015; `descriereRestDn`, l. 993; `cheieRest`, l. 990)
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
- Cum s-ar ajunge la retransfer: „continuă” / „reia” nu retransferă (transfer `facut` pe aceeași rulare; după o schimbare de `COD_VERSIUNE` — acum 2026-09-26.13 — sunt refuzate fără `mixare_permisa`). Rămâne doar un „citește” complet, adică retăiere + ~35 de zone plătite (ultima citire completă a lui 470: 2,595 USD în 9 runde).

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

Acum (`handler.ts:1100–1155`): întâi se află ținta fiecărui grup sigur (aceeași potrivire pe Dn + filtrul pe material), apoi se scrie. Dacă **mai multe grupuri ajung la același candidat**, poziția e **ambiguă**:
- `cantitate_plansa` **nu se atinge** (patch-ul n-are cheia, iar RPC-ul o aplică doar când există — `pg_get_functiondef` 26.09);
- nota numește **toate** grupurile, cu metrii și rândurile lor, și spune că cifra din planșă e veche, ex. „De verificat: Planșa „PL1.1.pdf” dă 2 grupuri sigure pe aceeași poziție — Dn110 OL 90 m (1 rând); Dn110 PE 500 m (1 rând); împreună 590 m, dar nu se adună și nu se suprascriu automat (denumirea poziției nu le deosebește); cifra din planșă nu s-a actualizat (700 m e dintr-o citire anterioară).” Restul de verificat al grupurilor (cheile (Dn, M) și (Dn, '')) și `rest.global` se adaugă ca înainte;
- „extras” ⇒ „diferenta”; „validat” / „diferenta” rămân, doar nota se schimbă;
- `cantitati.ambigue[]` primește `{ dn, material: null, metri: suma, motiv, grupuri: [{dn, material, metri, randuri}], de_verificat?, pozitii: [{id, denumire}] }`;
- o singură scriere pe id; grupurile din notă și din `ambigue` sunt ordonate (Dn descrescător, material cunoscut alfabetic, apoi fără material), deci rezultatul **nu depinde de ordinea** rândurilor (testat: ordine normală = inversată, aceeași stare în BD);
- TOTAL rămâne suma tuturor grupurilor sigure (nu se pierde nimic din el). Grupurile cu poziții separate își primesc fiecare cifra, ca înainte (control).

Pe datele de azi nu apare: singurul Dn cu material amestecat e 130 Dn250 (28 de lecturi din tabel fără material, 61.940 m brut, și 2 adnotări PE 100 / 5.170 m, care nu intră în total fiindcă există tabel; SELECT verificator 26.09).

**Runda 7 — transferul** (verificatorii rundelor 5 și 6, minore; B3):
- **Secvența Nr incompletă (B3).** `notaRestTransfer` primește `idr.nrLipsa`: textul „secvență Nr incompletă: lipsesc Nr … (p1, tabel cu Nr a–b; N rânduri fără nicio lectură, metri necunoscuți)” intră în `rest.global`, deci în nota fiecărei poziții atinse („De verificat, NEincluse în cifra din planșă: … pe planșă: …”), în nota pozițiilor „doar de verificat” și a TOTAL-ului; `rest.incomplet` ⇒ poziția „extras” trece în „diferenta” și la grupurile sigure (și la inserare), fiindcă cifra din planșă e doar partea citită. „Validat” rămâne validat, doar nota.
- **MY-T4 (minorul verificatorului rundei 5, deschis din runda 6)** (`handler.ts:1236`). Restul fără material (Dn, '') pe un Dn care are grup sigur poate fi al oricărei poziții de pe Dn. Înainte doar poziția grupului sigur îl numea; a doua poziție (ex. „Țeavă OL Dn110”, când grupul sigur e PE) rămânea tăcut cu cifra și nota unei citiri anterioare. Acum fiecare poziție de pe Dn neatinsă de niciun grup sigur primește nota (*textul din paranteză e corectat în runda 8*, mai jos) „De verificat: 1 rând Dn110 fără identitate sigură (90 m) — fără material, pot fi ale acestei poziții (grupul sigur de pe Dn110 e pe alt material); cifra din planșă nu s-a actualizat (900 m e dintr-o citire anterioară).” + „pe planșă: …”, „extras” ⇒ „diferenta” (validat rămâne), intrare `doar_de_verificat` cu `actiune: 'nota_fara_material'`. Cifra **nu se golește** (spre deosebire de „doar de verificat” pe (Dn, M)): poziția poate veni din altă planșă, iar restul poate fi și al poziției PE. O poziție deja atinsă (ex. de restul (Dn, OL)) primește textul în coadă, o singură dată.
- **Rândul TOTAL nu mai e candidat pe Dn** (minorul 3 al verificatorului rundei 6; *regula de alegere a TOTAL-ului e înlocuită în runda 8*, mai jos: TOTAL = „total” fără Dn, iar „Total conducte De 110” devine candidat pe Dn110). `randTotal` se alege întâi, iar `retea` (candidații pe Dn, și pentru „doar de verificat”) îl exclude: o denumire ca „Total conducte De 110” nu mai primește două update-uri pe același id (grupul + TOTAL, ultimul câștiga) și nu mai face ambiguă poziția reală Dn110. Invariant verificat în cod: un al doilea update pe id-ul TOTAL aruncă eroare (transfer `eroare`, 0 scrieri) în loc să se aplice tăcut. Pe BD nu schimbă nimic: niciun rând TOTAL în metri nu are Dn în denumire (SELECT 26.09: lic. 3 id 4, lic. 5 id 487 / 526 / 1097).

**Runda 8 — transferul** (verificatorul rundei 7):
- **Nr citit fără lungime** (MAJOR). `notaRestTransfer` primește și `idr.nrFaraLungime`. Textul „1 rând cu Nr citit, dar fără nicio lungime citită: Nr 50 (Dn40) — rândul există pe planșă, metrii lui nu sunt în total” intră în `rest.global`, deci în nota fiecărei poziții atinse, a pozițiilor doar de verificat și a TOTAL-ului. `rest.incomplet` trece „extras” în „diferenta”, la grupurile sigure și la inserare.
  - 470 cu Nr 50 fără L (V8E2E-NFL): 1751–1756 „diferenta”, iar nota se termină cu „… Dn nestandard Dn60: 110 m; 1 rând cu Nr citit, dar fără nicio lungime citită: Nr 50 (Dn40) …”. Pe `e8489a6`: 1751–1755 „confirmă” / „extras”, 1756 fără mențiune.
  - Tabel compact (V8E2E-B3a): „Planșa „PL1.1.pdf” confirmă: 900 m. De verificat, NEincluse în cifra din planșă: pe planșă: 1 rând cu Nr citit …”, „diferenta”.
- **Inserarea** pe o planșă cu secvența Nr incompletă sau cu Nr fără lungime intră cu „diferenta”. Comportamentul exista din runda 7, dar acum are test (mutantul verificatorului „rest.incomplet la inserare” era neprins).
- **MY-T4 — textul** (minor). Nota pozițiilor de pe un Dn cu rest fără material spunea „grupul sigur de pe Dn110 e pe alt material”. E fals pe un grup sigur ambiguu, unde pozițiile sunt chiar pe același material. Acum nota spune unde a ajuns grupul:
  - „(grupul sigur de pe Dn110 nu i-a fost atribuit: Dn110 PE 500 m e pe poziția „Țeavă PE100 Dn110”)”;
  - „… e ambiguu între 2 poziții (nescris)”;
  - „… e în coliziune pe poziția „X” (nescris)”;
  - „… intră ca poziție nouă („…”)”.

  Status-urile nu se schimbă.
- **Rândul TOTAL** (minor). Runda 7 lua drept TOTAL primul rând cu „total” în denumire, cu două efecte:
  - ordinea din BD decidea între „Total rețea PE” și „Total conducte De 110”;
  - o poziție „Conductă PE Dn110 — lungime totală” devenea TOTAL, iar Dn110 se insera ca poziție nouă (dublură în ofertă).

  *Corectat în runda 9 (mai jos): regula de mai jos trata „Total rețea De 63–110” drept subtotal Dn63, iar un subtotal „Total conducte De 110” făcea ambiguă poziția reală Dn110 fără material.* Acum TOTAL = rândul cu „total” **fără un Dn standard** în denumire (`areDnStandard`, pe `DN_STANDARD`, mutat la nivel de modul). Un „total” cu Dn e candidat pe Dn-ul lui, ca orice poziție: subtotalul pe Dn primește cifra Dn-ului, iar „… lungime totală” e tratată ca poziție. Dacă grupul sigur al Dn-ului merge (prin filtrul pe material) la altă poziție, rândul „total” cu Dn nu rămâne tăcut:
  - primește nota „De verificat: rând de total cu Dn în denumire (subtotal pe Dn sau poziție), neatribuit — grupurile sigure de pe Dn-ul lui (…): Dn110 PE 500 m e pe poziția „Conductă PE Dn110”; nu se completează automat aici; …”;
  - „extras” ⇒ „diferenta”, cifra rămâne neatinsă;
  - apare în `doar_de_verificat`, cu `actiune: 'nota_total_dn'`.

  Schimbare față de runda 7 (testul e rescris): „Total conducte De 110” singur nu mai e TOTAL + Dn110 inserat nou, ci primește cifra Dn110 („confirmă: 500 m”, 0 inserări). Scrierile nu mai depind de ordinea rândurilor (testat în ambele ordini). Pe BD nu schimbă nimic: rândurile TOTAL în metri (lic. 3 id 4, lic. 5 id 487 / 526 / 1097) n-au Dn în denumire (SELECT 26.09). Garda `throw` pe un al doilea update pe TOTAL rămâne. E inaccesibilă prin construcție (TOTAL n-are Dn, deci nu poate fi candidat), ca și excluderea lui din `retea` (mutant echivalent, §5.6).

**Runda 9 — transferul** (verificatorul rundei 8: 3 majore; commit `3197aa3`):
- **TOTAL-a / TOTAL-b** (MAJOR, regresie a rundei 8 față de `e8489a6`; pe BD nu apare: 0 denumiri „total” cu Dn, 0 intervale de Dn, SELECT 26.09).
  - *TOTAL-b:* singurul rând „total” e total global cu interval de Dn, „Total rețea De 63–110” (validat, 1.100). `areDnStandard` vedea „de 63”, deci rândul devenea singurul candidat Dn63: primea subtotalul Dn63 (200 m) și nota falsă „Memoriu 1.100 m vs planșa 200 m (-900 m …)”, rămânea „validat”, iar poziția Dn63 nu se mai insera (cei 200 m nu apăreau pe nicio poziție Dn63). Acum `dnuriDenumire` întoarce Dn-urile standard din denumire și dacă există un **interval** („De 63–110”, „Dn 63-110”, „Dn63 … Dn110”, „Ø63 – Ø110”, și cu un capăt nestandard, „De 60–110”). **TOTAL = „total” + (niciun Dn standard, ≥ 2 Dn sau interval).** Dintre mai multe rânduri TOTAL primul primește totalul (ca înainte), dar **niciunul** nu mai e candidat pe Dn (`retea` le exclude pe toate). V9R-TOTAL-b: TOTAL 1.100 „confirmă totalul”, validat; Dn63 intră ca poziție nouă de 200 m. *Completat în runda 10 (mai jos): separatorii „÷”, „/”, „la”, „până la” și listele de Dn nu erau recunoscuți.*
  - *TOTAL-a:* poziția reală „Conductă distribuție gaze Dn110” (fără material, formatul inserat chiar de sistem) + subtotalul „Total conducte De 110” + grupul Dn110 PE 500. Filtrul pe material nu departaja ⇒ grup AMBIGUU, nescris; poziția validată păstra tăcut 480 și „VECHE 3”. Acum, după filtrul pe material, dacă rămân mai mulți candidați și o parte au „total” în denumire, **se păstrează cei fără „total”** (`preferaFaraTotal`, și la „doar de verificat”). Un subtotal cu un singur Dn rămâne candidat doar când e singurul de pe Dn; altfel primește nota din bucla „total cu Dn” („De verificat: rând de total cu Dn în denumire …, neatribuit — grupurile sigure de pe Dn-ul lui: Dn110 PE 500 m e pe poziția „Conductă distribuție gaze Dn110”; …”, „extras” ⇒ „diferenta”, cifra neatinsă). V9R-TOTAL-a, în ambele ordini: poziția 3 = 500 „confirmă” (validat rămâne), subtotalul 480 + notă, `ambigue` gol, un singur update pe id. *Corectat în runda 10 (mai jos): aplicată DUPĂ filtrul pe material, prioritatea nu ajuta când subtotalul purta materialul grupului („Total conducte PE De 110”) — filtrul îl alegea singur, iar poziția reală păstra tăcut cifra veche.*
  - Bucla „total cu Dn” acoperă acum și Dn-ul **fără grup sigur**, doar cu rânduri de verificat (rândul „doar de verificat” a mers la poziția reală): nota „… neatribuit — pe Dn-ul lui doar rânduri de verificat, fără nicio cifră sigură: 1 rând Dn90 PE fără identitate sigură (300 m); …”. Înainte de prioritatea non-„total” cazul era ambiguu (ambele tăcute, doar în `ambigue[]`).
- **NFL-DN — Nr citit fără lungime, cu Dn cunoscut** (MAJOR; majorul rundei 7 era închis doar parțial). Semnalul ajungea doar la pozițiile atinse de un grup sigur și la TOTAL (prin `rest.global`); poziția Dn-ului rândului fără lungime păstra tăcut cifra și nota unei citiri anterioare (V9E-NFL-DN: „Țeavă PE100 Dn90” 250 / „extras” / „VECHE 12”; Dn63 120 / „validat” / „VECHE 13”). Acum `notaRestTransfer` pune fiecare intrare NFL cu `dn` și pe cheia (Dn, '') (`f`, `fnr`, fără metri adunați la `m`), iar `descriereRestDn` o afișează: „1 rând Dn90 cu Nr citit, fără lungime (Nr 2; metri necunoscuți)”. Astfel:
  - Dn **fără grup sigur** ⇒ „doar de verificat” (calea din runda 4): poziția „extras” se golește (`cantitate_plansa` null, „diferenta”, „… cifra din planșă s-a golit (era 250 m, dintr-o citire anterioară)”), cea validată primește doar nota; `doar_de_verificat` [{90, null, 12, golit}, {63, null, 13, nota}];
  - Dn **cu grup sigur** ⇒ în `cheiRest`, deci în nota grupului („NEincluse în cifra din planșă: 1 rând Dn110 cu Nr citit, fără lungime (Nr 2; …); pe planșă: …”), iar celelalte poziții de pe Dn primesc nota MY-T4 (cifra neatinsă, „extras” ⇒ „diferenta”). Testul NFL compact din runda 8 e actualizat doar cu această mențiune;
  - fără Dn citit, rândul rămâne doar „pe planșă” (`rest.global`), ca în runda 8.
- **DN0 — tronson sigur fără Dn citit** (MAJOR, pre-existent: identic pe `e8489a6`). Un rând SIGUR (Nr și L citite, identitate sigură) cu Dn necitit (ex. celulă Dn comasată pe mai multe rânduri) intra în `total_sigur_m`, dar `treciInCantitati` îl sărea (`if (!t.diametru_mm) continue`), fără semnal: V9E-DN0 dădea 1.200 m sigur, `total_m` 900, poziția Dn110 și TOTAL „confirmă … 900 m” / „extras”. Acum în handler `faraDn = pentruCantitati` fără Dn > 0 (tabel sau, pe planșele fără tabel, adnotări):
  - `rest.global` primește „1 tronson sigur fără Dn citit (300 m) — în lungimea planșei, dar în nicio poziție de cantități (Dn necunoscut)” ⇒ nota fiecărei poziții atinse și a TOTAL-ului; `rest.incomplet` ⇒ „extras” → „diferenta” pe toate (rândul poate fi al oricărui Dn);
  - cheia ('?', material) (`s`, `ms`) ⇒ `doar_de_verificat` [{dn: null, …, `fara_dn`}];
  - avertisment în sumar, câmpurile `tronsoane_fara_dn_n` / `_m` / `tronsoane_fara_dn[]` și linia „⚠ FĂRĂ Dn: …” în `text_extras`;
  - `total_sigur_m` și `lungime_totala_m` rămân 1.200 (nu se scot / nu se inventează metri); TOTAL rămâne suma grupurilor pe Dn (900), ca la Dn-urile nestandard, cu diferența numită în notă.
  Pe datele de azi nu apare (0 din 188 de tronsoane „tabel” cu L de pe 130/470 fără Dn, SELECT verificator pe `citire_ai.felii`).

**Runda 10 — transferul** (verificatorul rundei 9: 2 majore, 3 minore; commit `85c53f1`; `COD_VERSIUNE` 2026-09-26.14). Pe BD nu apare niciunul (SELECT 26.09: 19 denumiri cu „total”, toate încep cu „total”, niciuna cu Dn, niciuna cu interval sau listă de Dn ⇒ clasificarea lor e neschimbată).
- **TOTAL-a, a doua jumătate** (MAJOR, regresie a rundei 8 față de `e8489a6`, rămasă în runda 9). `preferaFaraTotal` rula **după** filtrul pe material. Cu poziția reală „Conductă distribuție gaze Dn110” (fără material, formatul inserat de sistem), subtotalul „Total conducte PE De 110” și grupul Dn110 PE 500, filtrul pe material alegea singur subtotalul: acesta primea 500 „confirmă”, iar poziția reală păstra TĂCUT 480 și „VECHE 3”, fără notă și fără intrare în `ambigue` (ADV10-1). Pe calea „doar de verificat” (ADV10-8: rândul Dn90 PE de verificat, poziția „Conductă distribuție gaze Dn90” „extras” 280 + „Total conducte PE De 90”), nota ajungea doar pe subtotal, iar poziția „extras” nu se golea. Acum candidații unui (Dn, material) se aleg într-un singur loc, `candidatiPe`, în ordinea: **întâi pozițiile fără „total” (subtotal), apoi — tot cu mai mulți candidați — materialul**; la fel în `tinte` și în „doar de verificat”. Subtotalul primește nota din bucla „total cu Dn”. ADV10-1 (validat și extras, ambele ordini): poziția 3 = 500 „confirmă”, subtotalul 480 + notă + „diferenta”, `ambigue` [], un update pe id. ADV10-8 (ambele ordini): poziția 5 golită („diferenta”, „… s-a golit (era 280 m …)”), subtotalul validat primește nota „pe Dn-ul lui doar rânduri de verificat …”.
- **TOTAL-b, notația românească** (MAJOR, regresie față de `e8489a6`). `dnuriDenumire` recunoștea intervalul doar pe „-”, „–”, „—”, „…”; „Total rețea Dn 63÷110”, „De 63 ÷ 110”, „De 63/110”, „Dn 63 la 110” și „Dn 63, 90 și 110” dădeau {dn: [63]}, deci subtotal Dn63: TOTAL-ul validat de 1.100 primea 200 m și nota falsă „-900 m”, iar Dn63 nu se insera (ADV10-7). Acum:
  - separatorul de interval: „-”, „–”, „—”, **„÷”, „/”**, „…” / „...”, **„la”, „până la”**, cu prefixul Dn/De/Ø opțional la al doilea capăt;
  - **listele** după un prefix Dn: „,”, „;”, „+”, „&”, „și”, „sau” („Dn 63, 90 și 110” ⇒ [63, 90, 110]); fiecare număr standard e un Dn, deci ≥ 2 Dn ⇒ TOTAL global (ramura `dn.length !== 1` din `esteTotal`);
  - al doilea capăt / elementul din listă **nu** e Dn când e urmat de unitate sau zecimale („Dn 63 - 200 m”, „De 110, 32,5 m”, „+ 20%”, „; 125 m”, „buc”, „kg”, „ore”), iar un număr nestandard din listă nu se adaugă („De 110, 17 tronsoane”);
  - „De 110/10” (grosimea peretelui): un interval **urcă** („De 60–110”, cu un capăt nestandard, rămâne interval); descrescător doar cu ambele capete standard („Dn 110 ÷ 63”). „De 110/10” rămâne subtotal Dn110.
  *Corectat în runda 11 (mai jos): numărul fără prefix acceptat înainte de orice cuvânt în afară de unități făcea din „Total conducte De 110, 20 tronsoane” un TOTAL global (regresie tăcută).*
  Controale neschimbate: „Total conducte PE 100 SDR11 De 63 (Ø 63 mm)” = subtotal Dn63; „De 110 x 6,6”, „(L = 125 m)”, „SDR 11 - 17”, „la CT” = un singur Dn.
- **Subtotal = denumirea care ÎNCEPE cu „total”** (minor; ADV10-2). `preferaFaraTotal` scotea orice denumire cu „total”; „Conductă PE Dn110 — lungime totală” (poziție reală) pierdea în fața „Conductă OL Dn110”, care primea cifra unui grup **fără material** (500 „confirmă”; `b5e7ecd` dădea ambiguu). Acum subtotal = „total” / „subtotal” la începutul denumirii, după numerotare sau semne („3. Total …”, „Subtotal …”) — `eSubtotal`. ADV10-2, ambele ordini: AMBIGUU vizibil (`ambigue` cu ambele poziții, nimic scris). Bucla „total cu Dn” nu mai notează o poziție care face parte dintr-un set **ambiguu** (`candidatiAmbigui`, din ținte și din „doar de verificat”): setul e raportat întreg în `ambigue`, iar o notă doar pe una dintre poziții ar fi fost inconsecventă. Pentru o poziție reală cu „total” în denumire, neatinsă pentru că grupul a mers (prin material) la altă poziție, bucla păstrează nota din runda 8 (semnal în plus, nu pierdere).
  *Completat în runda 11: numerotarea cu litere / cifre romane / „Cap.” și compatibilitatea de material (mai jos).*
- **Ramura „≥ 2 Dn fără interval” din `esteTotal`** (minor): acum are test („Total rețea Dn63 și Dn110”, „Total conducte Dn 63, 90 și 110”); mutația `return interval || dn.length === 0` e prinsă.

**Runda 11 — transferul** (verificatorul rundei 10: 2 majore, 4 minore; commit `91eb62e`; `COD_VERSIUNE` 2026-09-26.15). Pe BD nu apare niciunul (SELECT 26.09: aceleași 19 denumiri cu „total”, toate încep cu „total” fără numerotare, niciuna cu Dn ⇒ clasificarea lor e neschimbată).
- **TOTAL-b, fals-pozitivul rundei 10** (MAJOR, regresie față de `7a7bf86`). Separatorii de listă / interval ai rundei 10 luau drept Dn orice număr standard fără prefix, dacă după el nu venea o unitate din lista scurtă: „Total conducte De 110, 20 tronsoane” ⇒ [20, 110]; „… De 110 și 32 branșamente” ⇒ [32, 110]; „Dn110 la 32 case”, „De 110 / 16 bar”, „De 110 la 20 bar”, „De 225/20”, „De 180/16” ⇒ interval. Subtotalul Dn110 devenea TOTAL global: primul în BD lua 1.100 (umflat, „extras”), iar TOTAL-ul real rămânea TĂCUT la 1.000 „VECHE 6”; cu TOTAL-ul real primul, subtotalul ieșea din rețea și din orice scriere, TĂCUT „VECHE 4” (ADV11-3 / 3r). Acum, în `RE_DN_DENUMIRE`:
  - numărul **fără prefix** (al doilea capăt sau element de listă) e Dn doar dacă după el vine sfârșitul, punctuație / separator (`) , ; . : / ÷ – — - + & …`), „mm”, alt separator de listă / interval („și”, „sau”, „la”, „până”) sau un material / SDR („pe”, „PE100”, „ol”, „sdr”), și nu zecimale. Orice alt cuvânt (tronsoane, branșamente, case, bar, metri, mp, poz …) îl anulează;
  - pe „/”, regula „descrescător cu ambele capete standard” nu se aplică (grosimea: „De 225/20”, „De 180/16”, „De 110/100”); intervalul cu „/” e doar crescător („De 63/110”) sau cu prefix pe al doilea capăt („Dn110/Dn63”);
  - fără prefix, al doilea capăt al unui interval crescător trebuie să fie și el Dn standard („De 110 - 120” = subtotal Dn110; „De 60–110” rămâne interval);
  - cu prefix, numărul e Dn și urmat de unitate („De 63 și De 110 m” ⇒ [63, 110]; runda 10 îl respingea — garda de unitate a rămas doar pentru numerele fără prefix, unde e acum lista pozitivă de mai sus), dar nu cu zecimale.
  ADV11-3 / 3r, 6 denumiri × 2 ordini: TOTAL-ul real „confirmă totalul: 1.100 m”, Dn110 900, Dn63 200, subtotalul 850 + nota „total cu Dn” („extras” ⇒ „diferenta”, „validat” rămâne), `ambigue` gol.
- **TOTAL-a, numerotarea cu litere** (MAJOR, pre-existent, identic pe `7a7bf86`). `eSubtotal` (`/^[^a-z]*(?:sub…)?total/`) nu recunoștea „a) Total conducte PE De 110”, „II. Total …”, „Cap. 3 Total …”: subtotalul lua 500 „confirmă”, iar poziția reală „Conductă distribuție gaze Dn110” rămânea TĂCUT la 480 „VECHE 3” (ADV11-1). Acum subtotal = „total” / „subtotal” ca **prim cuvânt**, după semne, după o numerotare cu 1–2 litere sau cifre romane urmată de „.” / „)”, sau după prefixele întregi „Cap.”, „Art.”, „Poz.”, „Pct.” cu numărul lor. „Conductă PE Dn110 (total)”, „Poziție total …”, „Capac total …” nu sunt subtotal. ADV11-1 („a)”, „II.”, „Cap. 3”, „Art. 2 -”, „B. Subtotal”) × 2 ordini: poziția 500 „confirmă” (validat), subtotalul 480 + notă, „diferenta”.
- **Compatibilitatea de material** (minor, regresie vizibilă a rundei 10). Cu prioritatea înaintea materialului, „Total conducte OL De 110” lângă „Conductă PE Dn110” ceda poziției PE: grupul OL 40 se scria peste poziția PE 500 („Memoriu 500 vs 40”, ADV11-2), iar cu grupurile PE 500 + OL 40 cele două intrau în coliziune, nimic scris (ADV11-2b). Acum `preferaFaraTotal(cs, mat)` scoate subtotalul doar dacă rămâne cel puțin o poziție **compatibilă** cu materialul grupului (același material sau fără material; grupul fără material = oricare); altfel rămâne regula veche (filtrul pe material). ADV11-2: OL 40 pe subtotalul OL, poziția PE neatinsă; ADV11-2b: PE 500 pe poziția PE, OL 40 pe subtotalul OL, `ambigue` gol; grupul fără material cu „Total conducte De 110” + „Conductă PE Dn110”: poziția PE ia cifra, subtotalul notă (ca în runda 9).
- „De 110-110” (minor): `dnuriDenumire` = {dn: [110], interval: false}, cu test; mutația `b > a` → `b >= a` e prinsă.
- „Lungime totală conducte PE De 110” lângă poziția fără material (minor, documentare): limită scrisă în §5.7.

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
-- Runda 8: și `status = 'diferenta'` (starea scrisă de A) — o validare umană ulterioară (status 'validat') NU se anulează (0 rânduri).
-- Runda 9: și nota EXACTĂ scrisă de A (ca la rollback-ul B) — un retransfer legitim ulterior (aceleași valori 13.740 / „diferenta”,
-- altă notă) NU se anulează (0 rânduri). După un retransfer se folosește DOAR RB-manual (valori verificate de om).
-- UPDATE ofertare_cantitati SET cantitate = 13140, cantitate_plansa = 13140, status = 'extras',
--        diferenta_nota = 'Diametru care nu apare în cantitățile din memoriu. 54 tronsoane citite din tabelul planșei.',
--        updated_at = '2026-09-25 16:51:08.040401+00'
--  WHERE id = 1756 AND licitatie_id = 95 AND cantitate = 13140 AND cantitate_plansa = 13740 AND status = 'diferenta'
--    AND diferenta_nota = 'Memoriu 13.140 m vs planșa 1 13.740 m (+600 m: Nr 40 și 41, C-tin Brâncoveanu Dn40 300 m, identice ca text cu Nr 37; deduplicare pe identitatea rândului). Neincluse: Nr 57 Dn60 nestandard 110 m, de verificat.'
--    AND coalesce(diferenta_nota,'') NOT LIKE '%R5 pas B%'
-- RETURNING id, cantitate, cantitate_plansa, status, updated_at;
```
```sql
-- ROLLBACK după VARIANTA B din R4 (condiționat pe valorile și nota exactă scrise de B) — doar la nevoie, după GO; NU după pasul B din R5.
-- Runda 8: și `status = 'extras'` (B nu scrie status-ul, deci starea lăsată de B e „extras”) — o validare umană ulterioară nu se anulează.
-- UPDATE ofertare_cantitati SET cantitate = 13140, cantitate_plansa = 13140, status = 'extras',
--        diferenta_nota = 'Diametru care nu apare în cantitățile din memoriu. 54 tronsoane citite din tabelul planșei.',
--        updated_at = '2026-09-25 16:51:08.040401+00'
--  WHERE id = 1756 AND licitatie_id = 95 AND cantitate = 13740 AND cantitate_plansa = 13740 AND status = 'extras'
--    AND diferenta_nota = 'Diametru care nu apare în cantitățile din memoriu. 56 tronsoane citite din tabelul planșei (corecție 25.09: +600 m — rândurile Nr 40 și 41, C-tin Brâncoveanu Dn40 300 m, identice ca text cu Nr 37, erau numărate o dată; deduplicare pe identitatea rândului). Neincluse: Nr 57 Dn60 nestandard 110 m, de verificat.'
--    AND coalesce(diferenta_nota,'') NOT LIKE '%R5 pas B%'
-- RETURNING id, cantitate, cantitate_plansa, status, updated_at;
```
Testat pe Postgres 16 local (macheta lic. 95 a verificatorului R5, 1751–1756; pasul B și RB extrase exact din R5 revizia 5; variantele A / B extrase din blocurile de mai sus; harness `scratchpad/r7/pg/run.sh`), **26/26**: A → rollback A = starea inițială (hash); A → pasul B → rollback A = 0 rânduri, B intact (13.740 / 13.740 / diferenta, cu marcaj); A → B → cantitatea readusă manual la 13.140 (marcajul rămâne) → rollback A = 0 rânduri; A → B → RB (R5) → rollback A = starea inițială (anulare în ordine inversă); B din R4 → rollback A = 0, rollback B = starea inițială; B din R4 → pasul B e refuzat de R5 (cere 13.140) → rollback B = starea inițială; starea B din R4 + marcaj → ambele 0 rânduri; nimic aplicat / doar pasul B → ambele 0 rânduri. Control: rollback-ul din runda 6 după A + pasul B ⇒ 13.140 / 13.140 / „extras”, marcaj șters (defectul). Mutații: fără garda pe marcaj ⇒ pică S2b; fără `cantitate = 13140` ⇒ pică S2 și S3.

**Runda 8** (verificatorul rundei 7, minor; scenariul V8-S8). Rollback-ul A nu verifica status-ul: după A și o validare umană (1756 „validat”, fără pasul B) atingea 1 rând și readucea 13.140 / 13.140 / „extras”, anulând decizia omului. Acum:
- rollback-ul A cere `status = 'diferenta'`, adică starea scrisă de A;
- rollback-ul B cere `status = 'extras'`: B nu scrie status-ul, deci starea lăsată de B e „extras”.

Harness-ul e refăcut din blocurile SQL de mai sus, extrase automat din acest fișier, cu pasul B și RB din R5 rev. 5 (`scratchpad/r8/pg/run.sh`, Postgres 16 local). Rezultat: **36/36**, adică cele 26 din runda 7 plus:
- V8-S7: retransfer care șterge marcajul ⇒ 0 rânduri;
- V8-S8: A + validare ⇒ RB-A 0 rânduri, validarea intactă;
- R8-S9: B din R4 + validare ⇒ RB-B și RB-A 0 rânduri;
- R8-S10: A, validare, apoi omul revine pe „diferenta” ⇒ RB-A 1 rând (garda e pe starea lui A, nu pe istoric).

Mutații: RB-A fără garda de status ⇒ pică 3 verificări (V8-S8); RB-B fără ea ⇒ pică 2 (R8-S9). Postgres-ul local a fost oprit și șters.

**Runda 9** (verificatorul rundei 8, minor; scenariul V9-S11). Rollback-ul A era condiționat pe valori, status și lipsa marcajului, dar nu pe nota exactă a lui A (spre deosebire de rollback-ul B). După A, un retransfer legitim al codului nou scrie aceleași valori (13.740 / „diferenta”), cu altă notă și fără marcaj; RB-A atingea atunci 1 rând și anula și retransferul (13.140 / „extras” / notă veche / `updated_at` vechi). Acum RB-A cere și `diferenta_nota` = nota exactă scrisă de A. **După un retransfer (orice notă diferită de cea a lui A) se folosește DOAR RB-manual**, pe valori verificate de om.

Harness-ul e refăcut din blocurile SQL de mai sus, extrase automat din acest fișier (`scratchpad/r9/pg/run.sh`, Postgres 16 local; pasul B și RB din R5 rev. 5): **41/41** — cele 36 din runda 8, plus V9-S11 (A + retransfer ⇒ RB-A 0 rânduri, retransferul intact), V9-S12 (B din R4 + retransfer ⇒ RB-B 0 rânduri) și R9-S13 (A + retransfer ⇒ RB-A 0, rândul rămâne cel al retransferului). Mutație: RB-A fără garda pe notă ⇒ pică 4 verificări (V9-S11, R9-S13). Postgres-ul local a fost oprit și șters.

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

- **Runda 8 — verificatorul rundei 7** (`agregare_test.ts` +6, `concurenta_test.ts` +4, 2 teste actualizate). Suitele: `ofertare-plansa-citeste` **132/132**, `-A supabase/functions/` **149/149**, `concurenta_test.ts` 10 × 67/67, `test-cas-felii` 34/34, `test-detector-sigla` 30/30, `verifica-poarta-identica` OK, `deno check index.ts` exit 0, `vitest` 372/372 (runda 8 nu atinge `api/`); `deno.lock` neschimbat (md5 875e293d).

  | Test (runda 8) | Rezultat acum | Pe `e8489a6` |
  |---|---|---|
  | **NFL** (unitar): tabel compact cu Nr 2 fără L; 470 cu Nr 50 fără L; două tabele cu Nr pe aceeași pagină | 900 m sigur + `nr_fara_lungime` [{2, z1_1, Dn110}], `total_sigur_incomplet`, avertisment, `rest.global` + `incomplet`, ⚠; 470: 132 / 48.685 m + [{50, z2_6, Dn40}]; control: L citită, dar căzută la legare ⇒ 350 m de verificat, nu „fără lungime”; 470 intact ⇒ []; A (Nr 1–2) + B (Nr 2 fără L, Nr 3) ⇒ 3 / 903 m + [{2, z1_2, Dn90, `alt_tabel`}] | `nr_fara_lungime` [] (tăcut) |
  | **NFL (E2E, compact)** = V8E2E-B3a | poziția 11: 900, „diferenta”, nota numește rândul 2; ⚠ în `text_extras` | „confirmă: 900 m”, „extras” |
  | **NFL (E2E, 470)** = V8E2E-NFL | 1751–1756 „diferenta”, nota se termină cu Nr 50 (Dn40); ⚠ | 1751–1755 „extras”, nimic la transfer |
  | **Inserare** pe planșă incompletă (gol la Nr 2 / Nr 2 fără L) | poziția nouă Dn110 cu „diferenta” și cu nota | golul: trece (comportament din runda 7, acum fixat; prinde mutantul neprins); fără L: „extras” |
  | **B2** pe LCS | reciproc 750 + 600; antete transcrise altfel 900 + 500; valoare citită diferit 900 + 900; tabelul mai lung pus al doilea ⇒ rămâne el; LCS 1 ⇒ 5 / 1.200 m sigure; Dn lipsă într-o lectură ⇒ tot dublă | 1.350 / 1.400 / 1.800 m sigur |
  | **B4** capacitatea pe tabel | două tabele alăturate, 8 + 8 rânduri în fâșie ⇒ 120 sigure; un tabel cu 16 rânduri în fâșie ⇒ peste capacitate (control) | 104 sigure + 32 de lecturi / 12.368 m de verificat |
  | **B4** T2 începe în fâșie | 9 / 954 m + Nr 1 „repetat” + `comasari_neconfirmate` Nr 2–10 | 9 / 954 m, fără semnal |
  | **B4** conflict în comasarea integrală | conflict Nr 5 + comasare neconfirmată Nr 1–4, 6–10 (9 rânduri) | semnalul dispărea |
  | **B3** gol între grupuri de felii (1–5 / 20–24) | `intre_grupuri` 6–19, `grupuri_felii` [z1_2, z4_5], avertisment „dacă e același tabel”; 470 fără Nr 50 ⇒ fără calificare | „lipsesc Nr 6–19 … INCOMPLET”, fără calificare |
  | **MY-T4** cu grup sigur ambiguu (două poziții PE) | ambele note: „… Dn110 PE 500 m e ambiguu între 2 poziții (nescris)”; 11 „diferenta”, 12 rămâne validat | „… e pe alt material” (fals) |
  | **MY-T4** (runda 7, actualizat) | „… Dn110 PE 500 m e pe poziția „Țeavă PE100 Dn110”” | „… e pe alt material” |
  | **TOTAL** (runda 7, rescris) | (a) „Total conducte De 110” singur ⇒ cifra Dn110, 0 inserări; (b) + „Conductă PE Dn110” ⇒ 3 = 500, iar 4 primește notă + „diferenta”, cifra 700 neatinsă; (c) „Conductă PE Dn110 — lungime totală” + TOTAL, în ambele ordini ⇒ poziția 500, TOTAL 500, 0 inserări; (d) V8E2E-TOTAL, în ambele ordini ⇒ aceleași scrieri | (a) TOTAL + Dn110 inserat; (c) poziția luată drept TOTAL + Dn110 inserat; (d) depinde de ordine |

  **Control negativ pe `e8489a6`** (copie `scratchpad/r8/neg`: handler-ul de la `e8489a6` + doar exportul `textNrFaraLungime`, ca importul să se lege; `--no-check`): 118 teste, **12 pică**, adică cele 10 noi și cele 2 actualizate, toate pe aserțiunea de fond (tabelul de mai sus); celelalte 106 trec.

  **Mutații pe o copie a handler-ului nou** (`scratchpad/r8/mut/run.py`, testele neschimbate; copia nemutată 118/118): **33 din 34 prinse**.
  - Cele 22 noi (runda 8), cu numărul de teste care pică: NFL cu condiția veche 3; NFL fără text la transfer 4; NFL fără `incomplet` 4; NFL fără ⚠ 3; NFL cu `total_sigur_incomplet` doar pe `nrLipsa` 4; NFL fără excluderea lungimii căzute la legare 1; NFL cu cheia veche (pagină, Nr) 1; NFL fără `alt_tabel` 1; NFL fără Dn 4; B2 LCS dezactivat 1; LCS de 1 rând 4; LCS marchează tabelul mai lung 2; LCS strict pe Dn/Q lipsă 1; B4 capacitate pe pereche 1; B4 integral fără ignorarea rândurilor de verificat 1; B4 cu `every` (vechi) 1; B4 fără filtrul `idSigure` 1 (neprinsă în runda 7); B3 între grupuri dezactivat 1; B3 între grupuri mereu 3; TOTAL cu regula veche 1; TOTAL cu Dn fără notă 1; MY-T4 cu textul vechi 2.
  - Cele 12 din runda 7, re-rulate: 11 prinse, inclusiv „B3 la inserare fără `incomplet`” (neprinsă în runda 7, acum prinsă de testul nou).
  - **Neprinsă: „TOTAL candidat pe Dn”** (`retea = conducte`). E acum **echivalentă prin construcție**: TOTAL n-are Dn standard în denumire, deci nu se potrivește cu niciun candidat pe Dn, ca și garda `throw` din runda 7.

  **Probele verificatorilor pe handler-ul nou vs `e8489a6`** (`scratchpad/r8/cmp`, loguri comparate):
  - identice: `adv_test`, `adv2_test`, `adv3_test`, `ver_test`, `ver_e2e_test`, `adv7_test` (diferă doar calea fișierului dintr-o urmă de stivă), `adv7b_test`, `adv7_e2e_test`, `my_geom_test`, `my_geom_e2e_test`;
  - diferă doar ce trebuia: `my_e2e_test` (textul MY-T4), `v8_test` (B2a/b/c, B3a, B4a), `v8b_test` (120 sigure), `v8e2e_test` (NFL compact și 470, MY-T4 ambiguu; copia veche a testelor MY-T4 / TOTAL din runda 7 pică, exact ca testele actualizate).

  `p130` = 18 / 37.320 m, cu același semnal pe orizontală.

- **Runda 9 — verificatorul rundei 8** (`agregare_test.ts` +3, `concurenta_test.ts` +6, 1 test actualizat: nota poziției Dn110 din „runda 8 NFL (E2E, compact)” numește acum și rândul fără lungime pe Dn-ul ei). Probele V9R-DN0, V9R-NFL-DN, V9R-TOTAL-a și V9R-TOTAL-b ale verificatorului sunt acum teste (întărite). Suitele: `ofertare-plansa-citeste` **141/141**, `-A supabase/functions/` **158/158**, `concurenta_test.ts` 10 × 73/73, `test-cas-felii` 34/34, `test-detector-sigla` 30/30, `verifica-poarta-identica` OK, `deno check index.ts` exit 0, `vitest` 372/372 (runda 9 nu atinge `api/`); `deno.lock` neschimbat (md5 875e293d).

  | Test (runda 9) | Rezultat acum | Pe `b5e7ecd` |
  |---|---|---|
  | **DN0** (E2E) = V9R-DN0: Nr 1 Dn110 500, Nr 2 fără Dn 300, Nr 3 Dn110 400; poziție Dn110 + TOTAL „extras” | sumar 1.200 / 1.200, `tronsoane_fara_dn` [Nr 2, 300 m], avertisment; `total_m` 900; `doar_de_verificat` [fara_dn]; Dn110 și TOTAL 900 „diferenta”, nota „… pe planșă: 1 tronson sigur fără Dn citit (300 m) …”; ⚠ FĂRĂ Dn | TOTAL „confirmă totalul: 900 m” / „extras”, niciun semnal |
  | **NFL-DN** (E2E) = V9R-NFL-DN: Nr 2 Dn90 și Nr 4 Dn63 fără L; poziții Dn90 „extras”, Dn63 „validat”; + Dn110 cu grup sigur și a doua poziție OL | Dn90 golită, „diferenta”, nota „1 rând Dn90 cu Nr citit, fără lungime (Nr 2; …)”; Dn63 validat, doar nota; Dn110 PE: mențiunea în nota grupului; OL: nota MY-T4, „diferenta”, cifra 60 neatinsă | Dn90 250 „extras” „VECHE 12”; Dn63 „VECHE 13” |
  | **TOTAL-a** (E2E) = V9R-TOTAL-a, în ambele ordini | poziția 3 = 500 „confirmă”, validat; subtotalul 480 + notă, „diferenta”; `ambigue` []; un update pe id | ambiguu, poziția 3 480 „VECHE 3” |
  | **TOTAL-b** (E2E) = V9R-TOTAL-b: 5 denumiri de total cu interval (inclusiv un capăt nestandard) + două rânduri TOTAL | TOTAL 1.100 „confirmă totalul”, validat; Dn63 inserat 200; al doilea TOTAL (cu interval) neatins, nu candidat pe Dn63 | TOTAL validat 200 + „-900 m”, Dn63 lipsă |
  | **TOTAL** (E2E) subtotal pe un Dn doar cu rânduri de verificat | poziția Dn90 golită („doar de verificat”), subtotalul: notă „pe Dn-ul lui doar rânduri de verificat …”; `doar_de_verificat` [golit, nota_total_dn] | ambiguu, ambele tăcute |
  | **NFL-FP** (unitar, fără / cu geometrie; E2E) | `nr_fara_lungime` [], totalul complet (1.000 / 900 m), poziția „extras”; control: rândul 3 fără L în ambele felii ⇒ un singur „Nr 3” | Nr 1–4 „fără lungime”, `total_sigur_incomplet`, „diferenta” |
  | `dnuriDenumire` (unitar) | un Dn / interval / ≥ 2 Dn / capăt nestandard / fără Dn | — (funcție nouă) |
  | `notaRestTransfer` (unitar): chei (90, ''), ('?', ''), ('?', PE); texte; `incomplet` doar din DN0 | ca în stânga | chei lipsă |

  **Control negativ pe `b5e7ecd`** (copie `scratchpad/r9/neg`: handler-ul de la `b5e7ecd` + stub-uri fără comportament pentru exporturile noi `dnuriDenumire`, `textFaraDn`; `--no-check`): 127 de teste, **10 pică** (cele 9 noi și cel actualizat), toate pe aserțiunea de fond; restul de 117 trec.

  **Mutații pe o copie a handler-ului nou** (`scratchpad/r9/mut/run.py`, testele neschimbate; copia nemutată 127/127): **20/20 prinse** — TOTAL cu regula rundei 8 1; TOTAL fără interval 1; `retea` exclude doar primul TOTAL 1; `retea = conducte` (echivalentă în runda 8, acum prinsă) 1; `preferaFaraTotal` dezactivat 2; doar în ținte 1; bucla „total cu Dn” fără restul de verificat 1; `dnuriDenumire` fără interval 2; NFL fără cheia (Dn, '') 3; `descriereRestDn` fără `f` 3; NFL fără `incomplet` (forma nouă) 3; DN0 nepasat 1; DN0 fără `incomplet` 2; fără text în `rest.global` 2; fără avertisment 1; fără ⚠ 1; fără sumar 1; fără cheia ('?', material) 1; NFL-FP fără verificarea lungimii în componentă 2; NFL fără dedup pe componentă 1. Mutațiile rundelor 7–8 re-rulate (`scratchpad/r8/mut/run.py`): toate cele aplicabile prinse; 3 nu se mai aplică textual (codul lor s-a schimbat) și sunt acoperite de echivalentele de mai sus.

  **Probele verificatorului rundei 8 pe handler-ul nou** (`scratchpad/r9/probe`, comparat cu `b5e7ecd`): `v9_test` identic, cu excepția NFL-FP (fals-pozitivul dispare); `v9e2e_test`: V9E-DN0, V9E-NFL-DN, V9E-TOTAL-a/b arată comportamentul de mai sus, iar V9R-* trec toate 4. `p130` = 18 / 37.320 m (Dn250 30.970, Dn180 1.105, Dn160 5.245), neschimbat, cu același semnal pe orizontală; 470 = 133 / 48.905 m.

- **Runda 10 — verificatorul rundei 9** (`agregare_test.ts` +1, `concurenta_test.ts` +5; niciun test existent schimbat). Probele ADV10-1, ADV10-2, ADV10-7 și ADV10-8 ale verificatorului sunt acum teste cu aserțiuni (ambele ordini, validat și extras unde contează). Suitele: `ofertare-plansa-citeste` **147/147**, `-A supabase/functions/` **164/164**, `concurenta_test.ts` 10 × 78/78, `test-cas-felii` 34/34, `test-detector-sigla` 30/30, `verifica-poarta-identica` OK, `deno check index.ts` exit 0, `vitest` 372/372 (runda 10 nu atinge `api/`); `deno.lock` neschimbat (md5 875e293d).

  | Test (runda 10) | Rezultat acum | Pe `7a7bf86` |
  |---|---|---|
  | **TOTAL-a** (E2E) = ADV10-1: „Conductă distribuție gaze Dn110” + „Total conducte PE De 110”, grup PE; validat și extras × 2 ordini | poziția 3 = 500 „confirmă” (status păstrat); subtotalul 480 + nota „total cu Dn”, „diferenta”; `ambigue` []; ops [update 3 (500), update 4 (doar notă)] | subtotalul 500 „confirmă”; poziția 3 480 „VECHE 3”, tăcut |
  | **TOTAL-a, „doar de verificat”** (E2E) = ADV10-8, 2 ordini | poziția 5 golită, „diferenta”, „… s-a golit (era 280 m …)”; subtotalul validat: nota „pe Dn-ul lui doar rânduri de verificat …”; `doar_de_verificat` [golit, nota_total_dn] | poziția 5 280 „VECHE 5”; nota doar pe subtotal |
  | **TOTAL-b** (E2E) = ADV10-7: „Dn 63÷110”, „De 63 ÷ 110”, „De 63/110”, „Dn 63 la 110”, „De 63 până la De 110”, „Dn63 și Dn110”, „Dn 63, 90 și 110”; control „De 63 (Ø 63 mm)” | TOTAL 1.100 „confirmă totalul”, validat; Dn63 inserat 200; `total_m` 1.100; controlul = subtotal Dn63 200 „confirmă”, 0 inserări | TOTAL validat 200 + „-900 m”, Dn63 lipsă (primele 5 și lista) |
  | **Subtotal la început** (E2E) = ADV10-2, 2 ordini; + „3. Total conducte De 110”, „Subtotal conducte De 110” | ambiguu [3, 4], niciun update, notele „VECHE”; subtotalele numerotate / „Subtotal” rămân subtotal (poziția reală ia 500, subtotalul notă) | 500 „confirmă” pe OL; „lungime totală” notă „total cu Dn” |
  | **Ambiguu pe „doar de verificat”** (E2E): „Conductă PE Dn90 — lungime totală” + „Conductă PE Dn90 lot 2”, rest Dn90 PE | `ambigue` [PE, [5, 6]], niciun update pe 5 / 6; `doar_de_verificat` [ambiguu] | „lot 2” golită, „lungime totală” notă |
  | `dnuriDenumire` (unitar): 8 forme noi de interval / listă; 11 forme cu un singur Dn (unități, zecimale, %, grosime, SDR, „la CT”, număr nestandard în listă); descrescător | ca în stânga | primele 8 ⇒ {dn: [63]} |

  **Control negativ pe `7a7bf86`** (copie `scratchpad/r10/neg`: handler-ul de la `7a7bf86`, testele noi; fără stub-uri, niciun export nou): 133 de teste, **6 pică** (toate cele noi), pe aserțiunea de fond; restul de 127 trec.

  **Mutații pe o copie a handler-ului nou** (`scratchpad/r10/mut/run.py`, testele neschimbate; copia nemutată 133/133): **23/23 prinse** — `esteTotal` fără ramura ≥ 2 Dn 1; ținte cu materialul înaintea priorității 1; „doar de verificat” cu materialul înaintea priorității 1; `candidatiPe` fără `preferaFaraTotal` 5; `eSubtotal` = orice „total” 1; fără prefixul de numerotare 1; fără „subtotal” 1; bucla „total cu Dn” fără excluderea seturilor ambigue 1; seturile ambigue doar din ținte 1; separatorul fără „÷” 2 / fără „/” 2 / fără „la” 2 / fără „până” 1; fără liste 2; lista fără „și” 1 / fără virgulă 2; fără garda de unitate 1; garda fără zecimale 1; garda fără „%” 1; interval mereu (fără „urcă”) 1; interval doar crescător 1; interval doar cu ambele capete standard 1; număr nestandard adăugat din listă 1.

  **Probele verificatorului rundei 9 pe handler-ul nou** (`scratchpad/r10/head`, `scratchpad/r10/v`): ADV10-1/2/7/8 arată comportamentul de mai sus; `v9_test` 6/6, `adv7_test` 7/7, `adv7b_test`, `v8_test`, `v8b_test` trec; `v9e2e_test` pică doar pe copia veche a testului NFL compact (actualizat intenționat în runda 9, ca la verificator). `p130` = 18 / 37.320 m (Dn250 30.970, Dn180 1.105, Dn160 5.245), același semnal pe orizontală; 470 = 133 / 48.905 m.

- **Runda 11 — verificatorul rundei 10** (`agregare_test.ts` +1, `concurenta_test.ts` +4; niciun test existent schimbat). Probele ADV11-1, ADV11-2 / 2b și ADV11-3 / 3r ale verificatorului sunt acum teste cu aserțiuni, în ambele ordini. Suitele: `ofertare-plansa-citeste` **152/152**, `-A supabase/functions/` **169/169**, `concurenta_test.ts` 10 × 82/82, `test-cas-felii` 34/34, `test-detector-sigla` 30/30, `verifica-poarta-identica` OK, `deno check index.ts` exit 0 (runda 11 nu atinge `api/`); `deno.lock` neschimbat (md5 875e293d).

  | Test (runda 11) | Rezultat acum | Pe `85c53f1` | Pe `7a7bf86` |
  |---|---|---|---|
  | `dnuriDenumire` (unitar): 13 forme cu un singur Dn („, 20 tronsoane”, „și 32 branșamente”, „la 32 case”, „/ 16 bar”, „la 20 bar”, „, 16 bar”, „- 50 bransamente”, „si 90 mp”, „110-110”, „- 120”, „/100”, „; 17”, „și 12”), „De 225/20”, „De 180/16”, „- 200 metri”; 11 forme pozitive (sfârșit, „mm”, PE / SDR, „/” cu prefix, prefix + unitate) | ca în stânga | pică | pică |
  | **ADV11-1** (E2E): „a)”, „II.”, „Cap. 3”, „Art. 2 -”, „B. Subtotal” × 2 ordini; limita „Lungime totală … PE” | poziția 500 „confirmă”, subtotalul 480 + notă; limita: rândul „… totală” 500, poziția 480 „VECHE 3” | subtotalul 500, poziția TĂCUT 480 | idem |
  | **ADV11-2 / 2b** (E2E) × 2 ordini + grupul fără material | OL pe subtotalul OL, PE pe poziția PE; fără material: poziția PE | OL 40 pe poziția PE / coliziune | trece |
  | **ADV11-3 / 3r** (E2E): 6 denumiri × 2 ordini | TOTAL 1.100 „confirmă”, subtotalul notă | subtotalul 1.100 sau TĂCUT, TOTAL real TĂCUT 1.000 | trece |
  | „Total” ca prim cuvânt (E2E): „Conductă PE Dn110 (total)”, „Poziție total …”, „Capac total …” + „Conductă OL Dn110”, fără material × 2 ordini | ambiguu, nimic scris (gardă împotriva lărgirii `eSubtotal`) | trece | pică |

  **Control negativ** (`scratchpad/r11w/neg_7065789`, `neg_7a7bf86`: handler-ul vechi, testele noi): pe `7065789` (= `85c53f1`) 138 de teste, **4 pică** (cele 4 care vizează defectele, pe aserțiunea de fond), 134 trec; pe `7a7bf86` pică 9 (cele 6 ale rundei 10, unitarul rundei 11 pe „Dn110/Dn63”, ADV11-1 și garda „prim cuvânt”), iar ADV11-2 / 3 trec — confirmă că acolo erau regresii ale rundei 10.

  **Mutații pe o copie a handler-ului nou** (`scratchpad/r11w/mut.py`, testele neschimbate; copia nemutată 138/138): **36/36 prinse** — urmarea numărului fără prefix: oarecare 3, fără garda de zecimale 1, fără sfârșit 5, fără „mm” 2, fără „și / sau / la” 2, fără „pe” 1, fără „sdr” 1, fără punctuație 2; capătul / elementul fără prefix doar cu garda de zecimale 3 / 3; „/” descrescător permis 1; „/” cu prefix respins 1; crescător nestandard fără prefix = interval 1; `b >= a` 1; descrescător cu `b === a` 1; `NU_ZECIMALE` gol 1; cu prefix garda veche de unitate 1; `eSubtotal` fără litere 1, fără cifre romane 1, fără „Cap./Art.” 1, „cap” fără `\b` 1, „total” oriunde 1, fără „subtotal” 2; `preferaFaraTotal` fără compatibilitate 1, compatibil fără ramura „grup fără material” 1, fără „poziție fără material” 5, dezactivat 7; materialul înaintea priorității 7; regulile rundei 10: `esteTotal` fără ≥ 2 Dn 1, fără „÷” 2, fără „/” 3, fără „la” 3, fără liste 3, lista fără „și” 2, număr nestandard din listă 1, bucla „total cu Dn” fără excluderea seturilor ambigue 3.

  **Probele verificatorilor pe handler-ul nou**: ADV11 (`scratchpad/ver11`) ca mai sus; ADV10-1/2/7/8 neschimbate; `v9_test` 6/6, `adv7_test` 7/7, `adv7b_test`, `v8_test`, `v8b_test`, `dn10_test` trec; `v9e2e_test` pică doar pe copia veche a testului NFL compact (intenționat, ca în runda 10). `p130` = 18 / 37.320 m (Dn250 30.970, Dn180 1.105, Dn160 5.245); 470 = 133 / 48.905 m.

### 5.7 Limite cunoscute (documentate, nu blochează) — actualizat în runda 11
**Ce e acum vizibil (runda 7), care înainte era tăcut:** tabelul fără Nr sub coloana fixată fără geometrie (B1, „de verificat”); transcrierea dublă parțială în aceeași felie (B2, „de verificat”); golurile din secvența Nr (B3, `nr_lipsa` + avertisment + nota transferului + ⚠ în text, total marcat incomplet); comasarea între benzi peste capacitatea fâșiei (B4, „de verificat”) și, sub capacitate, comasarea integrală pe vertical sau pe orizontală (B4, `comasari_neconfirmate` + avertisment + ⚠); a doua poziție de pe un Dn la restul fără material (MY-T4, notă + „diferenta”); rândul TOTAL cu Dn în denumire (un singur update pe id); feliile identice (tăiate și plătite o singură dată, `zone_identice`).

**Ce a mai devenit vizibil în runda 8:** rândul cu Nr citit și lungime necitită, inclusiv în tabelul compact (notă, „diferenta”, ⚠, ca B3); dubla parțială reciprocă, cea cu antete transcrise altfel și cea cu o valoare citită diferit (B2 pe LCS); comasarea integrală ascunsă de un „Nr repetat” sau de un conflict (B4); rândul „total” cu Dn neatins de grupul Dn-ului lui (notă).

**Ce a mai devenit vizibil în runda 9:** tronsonul sigur fără Dn citit (DN0: avertisment, sumar, notă pe poziții și TOTAL, „diferenta”, ⚠); poziția Dn-ului unui rând cu Nr citit fără lungime (NFL-DN: golire pe „extras”, notă pe „validat”); subtotalul „total” cu Dn lângă poziția reală a Dn-ului (notă, în loc de ambiguu tăcut) — *corectură runda 10: doar când subtotalul nu purta materialul grupului*; TOTAL-ul global cu interval de Dn nu mai primește tăcut subtotalul primului Dn — *corectură runda 10: doar pentru separatorii „-”, „–”, „—”, „…”*.

**Ce a mai devenit vizibil în runda 10:** subtotalul cu materialul grupului („Total conducte PE De 110”) lângă poziția reală fără material — acum poziția primește cifra (sau, pe „doar de verificat”, se golește), iar subtotalul nota; TOTAL-ul cu interval „÷”, „/”, „la”, „până la” sau cu listă de Dn nu mai primește tăcut subtotalul primului Dn; „… lungime totală” lângă o altă poziție pe același Dn, cu un grup fără material, e din nou ambiguu vizibil (nu cifra pe cealaltă poziție) — *corectură runda 11: separatorii rundei 10 făceau din subtotalul „De 110, 20 tronsoane” un TOTAL global (TOTAL-ul real tăcut); subtotalul numerotat cu litere („a) Total …”) lua încă cifra*.

**Ce a mai devenit vizibil în runda 11:** subtotalul Dn urmat de un număr care nu e Dn („, 20 tronsoane”, „/ 16 bar”, „De 225/20”) rămâne subtotal, iar TOTAL-ul real primește totalul; subtotalul numerotat cu litere / cifre romane / „Cap. 3” lângă poziția reală primește nota, iar poziția cifra.

*Corectură runda 8:* aici scria „Totalul sigur nu se mai poate umfla pe nicio cale cunoscută; pierderile cunoscute sunt toate semnalate”. Prima parte contrazicea limita B2 listată chiar mai jos, iar a doua rata cazul „Nr citit, lungime necitită”. Formularea corectă: **totalul sigur nu se umflă tăcut pe nicio cale cunoscută, cu excepția celor două limite de mai jos** (B4 cu numerotări care se suprapun parțial; B2 sub pragul LCS); **pierderile cunoscute sunt semnalate, cu excepția rândului omis de AI la capătul unui tabel** (B3, mai jos).

*Corectură runda 9:* fraza de mai sus („pierderile cunoscute sunt semnalate, cu excepția rândului omis de AI la capătul unui tabel”) era contrazisă de trei căi găsite de verificatorul rundei 8 (tronsonul sigur fără Dn pierdut la transfer; poziția Dn-ului unui rând NFL cu cifra veche tăcută; efectele TOTAL-a/b), toate închise acum. Formularea de acum, fără „toate”: **pe căile cunoscute și testate, totalul sigur nu se umflă tăcut** (excepții: B4 cu numerotări care se suprapun parțial; B2 sub pragul LCS) **și pierderile sunt semnalate** (excepție: rândul omis de AI la capătul unui tabel, B3). Căile necunoscute rămân posibile; rundele 7–10 au găsit câte una sau mai multe la fiecare reverificare (runda 10: TOTAL-a cu materialul pe subtotal și TOTAL-b cu „÷” / liste; runda 11: fals-pozitivul listelor rundei 10 și subtotalul numerotat cu litere — închise acum).

**Ce rămâne (limite, cu semnalul care există):**
- `total_de_verificat_m` e un **plafon brut**: fiecare lectură fără identitate se adună separat, deci un rând din suprapunerea verticală poate fi numărat de două ori (inclusiv la comasarea peste capacitate, B4: 20 de rânduri ⇒ 40 de lecturi); conflictele intră cu varianta maximă.
- Două tabele **cu antete identice** și Nr care se suprapun:
  - în aceeași felie, sau în felii nevecine ⇒ „de verificat” (runda 4: „Nr repetat”; axa y testată din runda 7, ADV7-M5);
  - în benzi sau coloane **vecine**, cu text diferit pe o coloană comună (Strada / De la) ⇒ „de verificat” (runda 4: text contrazis);
  - în benzi vecine, cu L/Dn/Q diferite ⇒ conflict (vizibil);
  - în benzi vecine, cu L, Dn, Q **și** text identice (runda 7, B4): peste capacitatea fâșiei ⇒ „de verificat”; sub capacitate ⇒ numărate o dată, **cu semnal** când tot ce vede cel puțin o felie din tabel e în comasare. **Rămâne tăcut** doar cazul în care ambele felii văd și rânduri din afara fâșiei — T1 și T2 ar avea aceleași Nr, cu valori și text identice, pe porțiunea comasată, și rânduri diferite la ambele capete (numerotări care se suprapun parțial). Din runda 8, rândurile deja „de verificat” ale unei felii (ex. „Nr repetat” când T2 începe în fâșie) nu mai ascund comasarea, iar un conflict pe o identitate nu mai șterge semnalul celorlalte. Capacitatea se numără pe tabel (două tabele diferite alăturate nu se adună). Fără geometrie garda de capacitate nu există (rămâne doar semnalul integral);
  - alăturate (aceeași bandă, coloane vecine), cu aceleași antete ⇒ numărate o dată, **cu semnal** (`axa: 'orizontal'`). Semnalul poate fi fals-pozitiv când coloana fixată acoperă mult din vecina ei (130: 1.643 px), fiindcă atunci tabelul chiar poate fi văzut întreg în ambele felii.

  Cu antete diferite și același Nr ⇒ „de verificat”.
- **B4 — capacitatea** depinde de `H_MIN_RAND_MM` = 2 mm (≈ 60% din rândul măsurat pe 470) și de scara sursei. Fără scară (scanări fără dpi / puncte PDF), 12 px; sub ~100 dpi un tabel real cu rânduri de 2 mm poate depăși capacitatea ⇒ „de verificat” (fals-pozitiv vizibil, nu pierdere). Toate cele 7 documente cu geometrie din BD sunt randări la 200 dpi.
- **B2 — dublura parțială** se recunoaște în două feluri (aceeași felie):
  - sub-secvența exactă (L/Dn/Q) a unui tabel cu aceleași antete, de orice lungime (runda 7);
  - din runda 8, subsecvența comună (LCS pe L, Dn, Q, cu Dn / Q lipsă tolerate) de ≥ 2 rânduri și ≥ ½ din tabelul mai scurt, oricare ar fi antetele.

  **Rămâne sub prag** (umflare posibilă): o a doua transcriere care nu e sub-secvență exactă cu aceleași antete și are în comun cu prima (LCS) un singur rând sau mai puțin de jumătate din tabelul mai scurt (ex. antete transcrise altfel cu un singur rând; 2 din 5 rânduri citite la fel). Semnalul rămas e avertismentul „repetate” (rânduri prin poziție cu aceeași L și același Dn), doar în raport. **Fals-pozitive posibile** (vizibile, nu umflare): două tabele reale diferite din aceeași felie, fără Nr, cu ≥ 2 rânduri identice (L, Dn, Q) în aceeași ordine și cel puțin jumătate din cel mai scurt ⇒ cel mai scurt la „de verificat” (proba V8-B2d). Dublura identică cu aceleași antete trimite ambele copii la „de verificat”; cu antete diferite, doar pe a doua (tabelele de un singur rând sunt sub prag).
- **B1 e deliberat larg:** fără geometrie, orice al doilea tabel fără Nr aflat la ≥ 2 coloane de felii în dreapta altuia, pe aceeași bandă, trece la „de verificat”, chiar dacă e alt tabel (fail-safe, cu motiv). Remediul e retăierea (scrie `zone_geom`). Pe datele de azi nu apare (130 are un singur tabel cu lungimi).
- **B3 — golurile din secvența Nr** se văd doar **între** primul și ultimul Nr citit al unui tabel (pagină + antete). Începutul / sfârșitul tabelului nu se pot verifica pe Nr (numerotarea poate continua de pe altă planșă) — acolo rămân `nr_fara_lungime` și `perechi_neimperecheate`. Nr-urile cu sufix (12a) nu intră în verificare. Dacă o bandă are antetele transcrise altfel, formează alt „tabel” și pot apărea goluri false (semnal în plus, nu pierdere; cazul e oricum însoțit de rânduri „de verificat”, V1–V4). Două tabele diferite cu aceleași antete pe aceeași pagină (ex. 1–5 și 20–24) dau și ele un gol fals; din runda 8, când golul cade între grupuri de felii care nu se ating, raportul îl califică („pot fi și două tabele diferite cu aceleași antete”, `intre_grupuri`), dar rămâne conservator (incomplet, „diferenta” la transfer), fiindcă o bandă netranscrisă arată la fel. Când cele două tabele stau în felii care se ating, golul nu e calificat.
- Garda „tabel dublat” (tabel fără Nr transcris de două ori în aceeași felie) și B2 lucrează doar în **aceeași felie**; între felii diferite decid împerecherea, garda multi-bandă și B1.
- `nrFaraLungime` (din runda 8 și în tabelul compact, cu Dn și cu regimul lui B3 la transfer; din runda 9 și pe poziția Dn-ului lui, iar un rând cu lungime într-o lectură împerecheată nu mai e „fără lungime”, un rând fizic se raportează o dată) acoperă fragmentele cu Nr care au lungimi sau sunt împerecheate sigur cu o felie cu lungimi. Dacă împerecherea eșuează, toată banda trece oricum la „de verificat” (ADV-H). Limite:
  - fals-pozitive conservatoare: un rând de grupare numerotat („1” = localitatea X, cu sub-rânduri 1.1, 1.2) sau un rând numerotat fără conductă ⇒ semnal + „diferenta”;
  - acoperirea e pe (pagină, tabel, Nr); un Nr cu lungime doar sub **alte** antete pe aceeași pagină dă semnal cu `alt_tabel` (ambiguu: alt tabel sau același tabel transcris altfel). Fals-pozitiv posibil (vizibil): o bandă cu antetele transcrise altfel, în care rândul din fâșie și-a pierdut lungimea, deși banda vecină o are; cazul e oricum însoțit de „Nr apare în tabele cu antete diferite” (de verificat);
  - tabelul compact al cărui număr de tronsoane nu se potrivește cu rândurile (AI omite tronsonul fără L) ⇒ toată felia la „de verificat” (legare 1:1 imposibilă), nu „fără lungime”.
- Comparația de text (runda 4) poate trimite la „de verificat” și două lecturi ale aceluiași rând transcrise foarte diferit, ex. o abreviere („Str. Florenta Albu” / „Florenta Albu”). Asta e fail-safe, nu tăcut; pe 470 nu apare niciun caz (19/19 rânduri din suprapunere trec).
- **La transfer:**
  - o poziție validată sau „diferenta” pe un (Dn, material) doar de verificat își păstrează `cantitate_plansa` din citirea anterioară, iar nota o numește explicit veche;
  - rândul TOTAL primește, când există rânduri sigure, doar partea sigură, cu restul numit în notă, și trece în „diferenta” dacă era „extras” și există rest pe planșă (inclusiv secvența Nr incompletă);
  - restul fără material pe un Dn cu grup sigur (MY-T4, închis în runda 7) marchează și celelalte poziții de pe Dn, dar **nu le golește** cifra din planșă (poate veni din altă planșă); nota o numește „dintr-o citire anterioară” și, din runda 8, spune unde a ajuns grupul sigur (altă poziție / ambiguu / coliziune / poziție nouă);
  - **coliziunea** (runda 6: mai multe grupuri sigure pe aceeași poziție) lasă `cantitate_plansa` neatinsă, cu nota care o numește veche, și trece poziția „extras” în „diferenta”. Nu o golește (ca „doar de verificat”), pentru că cerința a fost „niciun update de `cantitate_plansa` pe acel id”; golirea ar fi o alternativă de decis;
  - rândul TOTAL = „total” în denumire cu **niciun Dn standard, ≥ 2 Dn-uri sau un interval** (runda 9; runda 8 lua doar „fără Dn”, iar „Total rețea De 63–110” devenea candidat Dn63 și primea subtotalul în rândul TOTAL validat, cu poziția Dn63 dispărută); un „total” cu **un singur** Dn e candidat pe Dn-ul lui. Un **subtotal** (denumire care începe cu „total” / „subtotal” ca prim cuvânt, după semne, după o numerotare cu cifre, 1–2 litere sau cifre romane, ori după „Cap.” / „Art.” / „Poz.” / „Pct.” cu numărul lor; runda 10, completat în runda 11) e candidat doar când e singurul de pe Dn: lângă o poziție fără „total” pe același Dn, **compatibilă cu materialul grupului** (același material sau fără material; grupul fără material = oricare), primește doar notă (runda 10: prioritatea se aplică înaintea filtrului pe material, în ținte și la „doar de verificat”; runda 11: doar în favoarea pozițiilor compatibile — „Total conducte OL De 110” lângă „Conductă PE Dn110”, cu grupul OL, ia cifra OL). O poziție care conține „total” în altă parte („… lungime totală”) e poziție reală (runda 10). Rămân:
    - dintre mai multe rânduri TOTAL, primul (în ordinea din BD) primește totalul, iar celelalte **nu se ating** (cifra lor rămâne din citirea anterioară, fără notă); niciunul nu mai e candidat pe Dn. **Pe BD apare** (observat de verificatorul rundei 10, pre-existent, neredeschis): licitația 5 are 3 rânduri TOTAL în m („Total conducte retea de distribuție” 1097, „TOTAL Conducta - TOTAL” 487, „TOTAL Extindere rețele alimentare cu apă potabilă - TOTAL” 526) — la un transfer pe lic. 5 doar primul ar primi totalul, celelalte tăcut. De decis de Razvan: notă pe toate + un singur scris, sau ambiguu vizibil;
    - TOTAL-ul primește suma tuturor grupurilor sigure, chiar dacă denumirea lui numește un interval mai îngust („De 63–110” cu Dn160 pe planșă);
    - un „total” cu un singur Dn, singurul de pe acel Dn, e tratat ca poziție (subtotal);
    - un subtotal care **nu** începe cu „total” („Lungime totală conducte De 110”, „Conducte De 110 — total”) e tratat ca poziție reală: lângă altă poziție pe același Dn, fără material care să departajeze, iese AMBIGUU (vizibil, `ambigue`), nu notă. **Cu materialul grupului în denumirea „… totală”** („Lungime totală conducte PE De 110”, grup PE) și o poziție fără material pe același Dn („Conductă distribuție gaze Dn110”), filtrul pe material dă cifra rândului „… totală”, iar cealaltă poziție rămâne **neatinsă, fără notă** (cifra și nota din citirea anterioară; identic pe `7a7bf86`). E o limită: fizic, rândul nu se deosebește de „Conductă PE Dn110 — lungime totală” (poziție reală), deci nu se poate trata ca subtotal fără să strice cazul ADV10-2 (testul „Lungime totală … PE” din ADV11-1 fixează comportamentul);
    - intervalul se recunoaște pe „-”, „–”, „—”, „÷”, „/”, „…” / „...”, „la”, „până la” după un număr cu prefix Dn/De/Ø, iar lista pe „,”, „;”, „+”, „&”, „și”, „sau” (runda 10). Al doilea capăt / elementul din listă **fără prefix** e Dn doar urmat de sfârșit, punctuație / separator, „mm”, alt separator de listă / interval sau material / SDR, și nu de zecimale (runda 11); cu prefix, e Dn oricum, fără zecimale. Nu se recunosc: numere fără niciun prefix („Total 63÷110” — dar fără Dn e oricum TOTAL), numere separate doar prin spațiu („Dn 63 90 110” ⇒ subtotal Dn63), un element fără prefix urmat de alt cuvânt, chiar dacă e o listă reală („Dn 63 și 110 m”, „Dn 63 și 110 (PE)” ⇒ subtotal Dn63: fals-negativ — rândul e tratat ca subtotal Dn63, deci primește nota „total cu Dn” lângă poziția reală Dn63 sau, singur pe Dn63, cifra Dn63 cu diferența față de memoriu în notă; vizibil, nu tăcut), un interval crescător fără prefix cu al doilea capăt nestandard („De 110 - 120”), un interval descrescător cu un capăt nestandard. Pe „/” (grosimea peretelui: „De 110/10”, „De 225/20”, „De 110/100”) descrescătorul fără prefix nu e interval (runda 11; în runda 10 „De 225/20” și „De 110/100” erau). Pe BD nu există nicio denumire „total” cu Dn, interval sau listă de Dn (SELECT 26.09, refăcut în runda 11: 19 denumiri „total”, toate încep cu „total” fără numerotare, 0 cu Dn);
  - tronsoanele sigure fără Dn citit (runda 9, DN0) nu intră în nicio poziție și nici în cifra TOTAL (ca Dn-urile nestandard); sunt numite în notă, în avertisment și ⚠, iar pozițiile / TOTAL „extras” trec în „diferenta”. Nu se ghicește Dn-ul (ex. din rândurile vecine);
  - poziția neatinsă de citire (niciun rând — sigur, de verificat, fără lungime cu Dn-ul ei — pe Dn-ul ei) își păstrează cifra, comportament de dinainte, nelegat de identitate. Din runda 9, un rând cu Nr citit fără lungime, cu Dn citit, atinge poziția Dn-ului lui (NFL-DN).
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
