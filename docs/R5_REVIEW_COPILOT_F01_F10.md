# R5 — reparațiile Copilot F01–F10

26.09.2026. Implementare locală, fără git, fără deploy și fără modificări în baza reală.
Migrările 1b și 2 nu au fost editate. Migrarea nouă este
`docs/R5_MIGRARE_3_review_copilot.sql`; rollback:
`docs/R5_MIGRARE_3_review_copilot_ROLLBACK.sql`.

**Validarea completă rămâne deschisă:** nu au putut rula PostgreSQL 16, Vitest și Deno native
în această sesiune. Probele de diagnostic Node trec; ele nu înlocuiesc aceste trei rulări.

## Modificări și probe

| F | Fix și fișiere | Test | Limită / ce nu s-a putut verifica |
|---|---|---|---|
| F01 | Migrarea 3: `ofertare_r5_blocaj_sursa` verifică toate cele șapte contoare cerute înaintea transferurilor, cu numele contorului și valoarea în mesaj. Contor lipsă într-un rând prezent = control indisponibil. `src/ofertarePoarta.js`: aceeași listă în `controlSursaAprobareFinala`, folosită efectiv de `evalueazaPoarta`. | `scripts/pg/test_r5_review_f.mjs`: șapte scenarii pe view-ul real, fiecare refuză inserarea pachetului aprobat. `src/ofertareReviewF.test.js`: fiecare contor, zero și date lipsă. Fixture-urile din `ofertarePoarta.test.js`, `ofertareSarcina2.test.js` și `scripts/test-r5-r9b.mjs` includ noul contract. | Probele SQL sunt scrise, dar nu rulate local. Controlul final cere explicit și `um_de_normalizat_f3`, deși H2 intermediar avea o excepție când exista `totaluri_control`. Migrarea 2 și semantica view-ului rămân neschimbate. |
| F02 | `supabase/functions/ofertare-clarificari-propune/core.ts`: persistă `propunere`, cu comentariul corectat. Triggerul din migrarea 3 cere drept de decizie pentru `platforma`/`automat` la intrarea în `de_trimis`/`trimisa`. Originea și licitația devin imuabile pentru aceste rânduri, astfel încât aceeași comandă să nu poată ocoli verificarea. Amprenta R9b rămâne numai pentru `auto_planse_%`. | Test Deno nou în `core_test.ts` capturează rândul efectiv trimis la upsert. Proba PG verifică authenticated fără drept, anon, responsabil, owner, INSERT/UPDATE și încercarea de schimbare a originii; ciorna auto continuă să ceară reconfirmare. | `src/OfertareClarificari.jsx:532` are deja butonul `Confirm motivul — de trimis`, aplicabil și platformei; folosește salvarea obișnuită, deci triggerul decide dreptul. Am corectat doar textele generatorului din UI. Fără test de browser/autentificare reală. Rândurile existente nu au fost rescrise. |
| F03 | Migrarea 3: verificarea stării vechi precedă orice editare de text și orice ieșire pentru clarificări fără cheie auto. `raspunsa` este permisă doar din `trimisa`/`raspunsa`, pentru originile AI, inclusiv refuz la INSERT. | Proba PG: `propunere → raspunsa`, text+status+răspuns în aceeași comandă și `de_trimis → raspunsa` refuzate; apoi transmitere și răspuns permise. Testată și ciorna auto. | Proba PostgreSQL n-a rulat în această sesiune. |
| F04 | Migrarea 3: amprenta include versiunea formulei, calea, mărimea, hashurile opționale și `analiza.integritate`. `identitate_incompleta` apare per document, la nivelul bazei și în textul de review dacă lipsește un SHA-256 în câmpurile recunoscute. Calea/mărimea nu sunt prezentate ca dovadă a identității conținutului. | Două probe PG: schimbări numai de cale/mărime/hash schimbă amprenta; aprobare pe formula veche → migrare → `schimbata`; rollback restabilește formula, fără modificarea rândurilor. | Citirea `information_schema` în Supabase a fost refuzată de instrument. Codul local confirmă `fisier_path` și `size_bytes` (`src/OfertareGarantie.jsx:98`, `api/seap-import.js:237`). `sha256`, `fisier_sha256`, `marime` sunt citite tolerant prin `to_jsonb(d)`; nu presupun că există în schemă. Nu am demonstrat existența/popularea hashurilor în producție. |
| F05 | Migrarea 3: completitudinea SEAP se reverifică la fiecare intrare în `depus`, inclusiv `aprobat → depus`. | Proba PG aprobă pachetul, introduce un blocaj SEAP, verifică refuzul depunerii și păstrarea stării `aprobat`, apoi ridică blocajul și depune. | SQL netestat pe server real în sesiune. |
| F06 | Funcția de aprobare din 1b este copiată integral în migrarea 3; numai ramura DELETE diferă. Ștergerea se înregistrează și după invalidare dacă există o validare anterioară; `aprobare_veche` păstrează valorile acesteia și `istoric_id`. Pentru un rând încă validat fără istoric se păstrează fallback-ul vechi. | Proba PG: validare→DELETE și validare→diferență→DELETE, ambele în `sterse_dupa_validare`, referință la validare; rând niciodată validat fără eveniment `sters`. Comparația statică a confirmat identitatea cu 1b în afara ramurii DELETE. | Proba SQL netestată local. Nu se reconstruiesc retroactiv ștergeri istorice fără eveniment. |
| F07 | `transfer_conflicte.ts`: dacă există `pozitie_id`/`pozitii`, toate identitățile trebuie să fie în acoperire. `handler.ts` transmite `pozitii_evaluate` din atribuirile efective, nu din întregul SELECT al cantităților. `acoperireCitire` le include în înregistrare. Semantica transferului este marcată `2026-09-26.t3`. | `transfer_conflicte_test.ts`: #57 omisă, #58 cu același Dn63 și aceeași zonă → conflict purtat deschis; toate identitățile prezente → poate fi închis. Testul E2E din `concurenta_test.ts` cere acum ambele poziții #31/#32 la închidere. | Probele au trecut prin adaptor Node; Deno nativ și verificarea sa TypeScript nu au rulat. Înregistrările vechi fără lista identităților acoperite nu sunt tratate ca dovadă pentru un conflict care are ID-uri explicite. |
| F08 | `concurenta.ts`: CAS compară atomic **întreaga analiză**. Orice scriere concurentă, inclusiv doar `integritate`, produce conflict, recitire și reconstruirea modificării peste datele curente. Rezervarea/eliberarea modifică numai `rezervari_zone` în această reconstrucție. RPC nou în migrarea 3, `ofertare_plansa_analiza_cas`, SECURITY INVOKER, search_path fix, EXECUTE numai service_role. Payload POST, fără JSON mare în URL. | Două teste în `concurenta_test.ts`: intervenție B înaintea UPDATE-ului A atât la rezervare, cât și la eliberare; snapshot vechi la `scrieCAS`. Probă SQL suplimentară în harness: writer B schimbă integritatea, CAS vechi refuzat, CAS după recitire păstrează ambele modificări. | Simulările trec. RPC-ul nu a fost aplicat/testat pe PostgREST real; proba PG nu a rulat. Migrarea trebuie instalată înainte de worker. Apelurile cu patch în afara câmpurilor cunoscute sunt refuzate. |
| F09 | `src/ofertareGraficReverificare.js` exportă `COLOANE_GRAFIC_REVERIFICARE`; loaderul real din `OfertarePropunere.jsx` o folosește. Adăugate `tip_sursa` **și** `licitatie_id`, ambele din contractul perimetrului TOTAL. | `ofertareReviewF.test.js`: constanta apare în SELECT-ul real, conține câmpurile necesare; proiectarea efectivă păstrează TOTAL comparabil și reverificarea graficului, fără să amestece memoriul cu F3. | Diagnostic Node trecut. Query-ul real nu a putut fi executat pe API; coloanele sunt folosite deja de codul existent. |
| F10 | `ofertareCantitatiAprobare.js`: aceeași extragere a tokenului complet în propunere și reverificare. `DN1000` rămâne `1000`; tokenurile cu lungime în afara a 2–4 cifre rămân întregi și sunt semnalate în mesajul propunerii și blochează controlul frontului. | `ofertareReviewF.test.js`: DN1000 ≠ DN100; front vechi trunchiat cere reverificare; 9/10000/123456 sunt semnalate, nu trunchiate. | „Suportat” înseamnă aici format numeric de 2–4 cifre. Nu am inventat un catalog tehnic de diametre/materiale admise; fronturile existente acceptă și editarea manuală a Dn. |

## Efectul F04 și ordinea instalării

Identificatorul `r5_f04_v1` intră în formula amprentei, inclusiv pentru baze fără documente relevante.
Toate bazele R9b salvate pe formula veche vor diferi la următoarea citire.
Ciornele reconfirmate devin `schimbata` și cer reverificare; textul, deciziile și statusul salvat nu se rescriu la migrare.
**0 reconfirmate în producție** este numărul comunicat în `JAK_REVIEW_F.md`, nu un rezultat verificat independent în această sesiune.

Mai întâi migrarea 3, apoi workerul `ofertare-plansa-citeste` și restul codului.
La rollback, se retrage întâi workerul dependent de noul RPC. Rollback-ul restaurează exact cele cinci funcții existente
din 1b/2 și elimină numai funcția CAS nouă; nu șterge coloane/date. Am verificat static corpurile celor cinci funcții.

`identitate_incompleta` nu este „fișier verificat”: un hash absent nu poate detecta înlocuirea conținutului la aceeași cale
și aceeași mărime. Nici prezența unui hash în metadate nu dovedește singură că acesta a fost recalculat pe bytes actuali.
Migrarea nu calculează hashuri și nu atribuie identitate pe baza unui manifest NAS/SEAP care nu dovedește fișierul actual.

## Întrebarea de unități — doar constatare, fără fix

În `supabase/functions/ofertare-plansa-citeste/handler.ts`:

- Linia 1345 adună `t.lungime_m` în `g.m`; liniile 1486–1487 construiesc valoarea `m` din această sumă.
- Linia 1593 scrie `cantitate_plansa: m` fără conversie în unitatea rândului.
- Linia 1620 inserează rânduri noi cu `um: 'm'`, `cantitate: m`, `cantitate_plansa: m`.
- Liniile 1740/1745 scriu TOTAL-ul observațiilor tot în metri.
- **Limita relevantă:** liniile 1378–1379 aleg pentru actualizare numai rânduri `m`/`ml` sau fără unitate. Handlerul nu actualizează direct un candidat `km`.

`src/ofertareUnitati.js:13–15` multiplică orice bază, inclusiv `cantitate_plansa`, cu factorul unității rândului.
Reproducere executată: `{um:'km', cantitate_plansa:1000}` → `inMetri(...,'cantitate_plansa') = 1000000`.
Dacă cei 1000 sunt observația în metri, rezultatul este greșit de 1000 de ori.
Situația poate apărea după schimbarea unității unui rând sau prin alt writer; nu am verificat asemenea rânduri în producție.

Fix propus separat: formalizarea contractului „cantitate = unitatea rândului; cantitate_plansa = metri”, apoi factor 1
pentru baza `cantitate_plansa` în `inMetri`, `controlTotaluri` JS și perechea SQL `ofertare_totaluri_control`
(migrarea 2, liniile 681/686/691 aplică acum același factor). Trebuie verificate și comparațiile din writeri și datele istorice
înainte de modificare, fără conversii în masă presupuse. Nu am schimbat acest contract în F01–F10.

## Execuții

Au trecut:

- `node --test --test-isolation=none scripts/test-r5-r9b.mjs`: **9/9**.
- Diagnostic Node pentru cele șapte fișiere JS: `ofertareReviewF`, `ofertarePoarta`, `ofertareCantitatiAprobare`,
  `ofertareSarcina2`, `ofertareCantitatiInvalidare`, `ofertareControale`, `graficPoartaCalcul`: **354/354**.
  Comandă: `node --import ./.jak/review-f-vitest-hooks.mjs --test --test-isolation=none <fișierele .test.js>`.
- Diagnostic Node pentru toate cele șase suite `ofertare-plansa-citeste/*_test.ts` și `ofertare-clarificari-propune/core_test.ts`: **221/221**.
  Comandă: `node --import ./.jak/review-f-deno-hooks.mjs --test --test-isolation=none supabase/functions/ofertare-plansa-citeste/*_test.ts supabase/functions/ofertare-clarificari-propune/core_test.ts`.
- `node --check` pentru ambele scripturi PostgreSQL.
- După ajustarea tokenului Dn cu sufix `mm`, rerulare țintită `ofertareReviewF.test.js`: **14/14**, prin același adaptor Node.
- Verificarea statică: rollback exact pe cele cinci funcții, F06 neschimbat în afara DELETE, șase funcții în migrarea 3.

Adaptoarele de diagnostic din `.jak/review-f-*` folosesc `node:assert`, teste în același proces și clienți simulați;
nu reprezintă Vitest, Deno, verificare TypeScript sau PostgREST. Rularea inițială fără `--test-isolation=none`
a fost blocată de `spawn EPERM`. Un fixture „citire veche” avea timestamp de transfer din aceeași milisecundă
cu reevaluarea; l-am făcut explicit istoric pentru a nu depinde de viteza execuției.

Nu au putut rula:

- `npx --no-install vitest ...`: `ENOTCACHED`, instalare locală incompletă. Refacerea cu `npm ci`
  a eșuat offline (`ENOTCACHED`) și online (`Exit handler never called`). Nu există rezultat Vitest/build valid.
- `deno --version`: executabil indisponibil; nu există rezultat Deno nativ.
- `PGURI=postgres://postgres@localhost:5432/r9b_test_review_f node scripts/pg/test_r5_review_f.mjs`:
  **setup eșuat, `psql: EPERM`, 0 probe executate din 14**. PostgreSQL 16/psql nu sunt disponibile în PATH;
  mediul restricționează și lansarea procesului. Nicio bază nu a fost recreată de acest apel.
- Citirea Supabase `information_schema`/număr de reconfirmări: refuz automat — „MCP tool call requires approval,
  but approval policy is never”. Nu am încercat ocolirea refuzului. Nici query-ul F09, nici RPC-ul F08 nu sunt verificate pe API real.

CI este pregătit în `.github/workflows/ofertare-regresie.yml`: path `docs/R5_MIGRARE_3*`, job PostgreSQL cu scriptul nou
după probele R9b existente; fixture-ul aplică integral aprobare_istoric + 1b + 2 + 3.
Joburile Vitest și Deno existente includ testele noi. CI nu a fost declanșat în această sesiune.
