# R5 — reparațiile Copilot F01–F10

26.09.2026. Implementare locală, fără git, fără deploy și fără modificări în baza reală.
Migrările 1b și 2 nu au fost editate. Migrarea nouă este
`docs/R5_MIGRARE_3_review_copilot.sql`; rollback:
`docs/R5_MIGRARE_3_review_copilot_ROLLBACK.sql`.

**Situația rundei 1:** nu au putut rula PostgreSQL 16, Vitest și Deno native
în acea sesiune. Probele de diagnostic Node trec; ele nu înlocuiesc aceste trei rulări.
Rezultatele actualizate sunt în „Runda 2” și „Runda 2b — F04”. Decizia temporară F04 din runda 2b
înlocuiește propunerea de amânare a blocării din rundele anterioare.

## Modificări și probe

| F | Fix și fișiere | Test | Limită / ce nu s-a putut verifica |
|---|---|---|---|
| F01 | Migrarea 3: `ofertare_r5_blocaj_sursa` verifică toate cele șapte contoare cerute înaintea transferurilor, cu numele contorului și valoarea în mesaj. Contor lipsă într-un rând prezent = control indisponibil. `src/ofertarePoarta.js`: aceeași listă în `controlSursaAprobareFinala`, folosită efectiv de `evalueazaPoarta`. | `scripts/pg/test_r5_review_f.mjs`: șapte scenarii pe view-ul real, fiecare refuză inserarea pachetului aprobat. `src/ofertareReviewF.test.js`: fiecare contor, zero și date lipsă. Fixture-urile din `ofertarePoarta.test.js`, `ofertareSarcina2.test.js` și `scripts/test-r5-r9b.mjs` includ noul contract. | Probele SQL sunt scrise, dar nu rulate local. Controlul final cere explicit și `um_de_normalizat_f3`, deși H2 intermediar avea o excepție când exista `totaluri_control`. Migrarea 2 și semantica view-ului rămân neschimbate. |
| F02 | `supabase/functions/ofertare-clarificari-propune/core.ts`: persistă `propunere`, cu comentariul corectat. Triggerul din migrarea 3 cere drept de decizie pentru `platforma`/`automat` la intrarea în `de_trimis`/`trimisa`. Originea și licitația devin imuabile pentru aceste rânduri, astfel încât aceeași comandă să nu poată ocoli verificarea. Amprenta R9b rămâne numai pentru `auto_planse_%`. | Test Deno nou în `core_test.ts` capturează rândul efectiv trimis la upsert. Proba PG verifică authenticated fără drept, anon, responsabil, owner, INSERT/UPDATE și încercarea de schimbare a originii; ciorna auto continuă să ceară reconfirmare. | `src/OfertareClarificari.jsx:532` are deja butonul `Confirm motivul — de trimis`, aplicabil și platformei; folosește salvarea obișnuită, deci triggerul decide dreptul. Am corectat doar textele generatorului din UI. Fără test de browser/autentificare reală. Rândurile existente nu au fost rescrise. |
| F03 | Migrarea 3: verificarea stării vechi precedă orice editare de text și orice ieșire pentru clarificări fără cheie auto. `raspunsa` este permisă doar din `trimisa`/`raspunsa`, pentru originile AI, inclusiv refuz la INSERT. | Proba PG: `propunere → raspunsa`, text+status+răspuns în aceeași comandă și `de_trimis → raspunsa` refuzate; apoi transmitere și răspuns permise. Testată și ciorna auto. | Proba PostgreSQL n-a rulat în această sesiune. |
| F04 | Runda 2b: manifest eligibil după document_id și mărime, stări `identitate_limitata`/`ok_identitate_limitata`, excepție auditată per ciornă plus reconfirmare pe același token; UI și rollback actualizate. | Cele două probe PG inițiale + șapte probe F04 B noi, pregătite pentru Claude; șase teste helper/UI trecute în Vitest real. Detalii în „Runda 2b — F04”. | **mitigat temporar; identitate verificabilă restantă (import hash pentru cele 14 documente, cu GO Răzvan)**. PostgreSQL și PostgREST real nu au fost executate în această sesiune. |
| F05 | Migrarea 3: completitudinea SEAP se reverifică la fiecare intrare în `depus`, inclusiv `aprobat → depus`. | Proba PG aprobă pachetul, introduce un blocaj SEAP, verifică refuzul depunerii și păstrarea stării `aprobat`, apoi ridică blocajul și depune. | SQL netestat pe server real în sesiune. |
| F06 | Funcția de aprobare din 1b este copiată integral în migrarea 3; numai ramura DELETE diferă. Ștergerea se înregistrează și după invalidare dacă există o validare anterioară; `aprobare_veche` păstrează valorile acesteia și `istoric_id`. Pentru un rând încă validat fără istoric se păstrează fallback-ul vechi. | Proba PG: validare→DELETE și validare→diferență→DELETE, ambele în `sterse_dupa_validare`, referință la validare; rând niciodată validat fără eveniment `sters`. Comparația statică a confirmat identitatea cu 1b în afara ramurii DELETE. | Proba SQL netestată local. Nu se reconstruiesc retroactiv ștergeri istorice fără eveniment. |
| F07 | `transfer_conflicte.ts`: dacă există `pozitie_id`/`pozitii`, toate identitățile trebuie să fie în acoperire. `handler.ts` transmite `pozitii_evaluate` din atribuirile efective, nu din întregul SELECT al cantităților. `acoperireCitire` le include în înregistrare. Semantica transferului este marcată `2026-09-26.t3`. | `transfer_conflicte_test.ts`: #57 omisă, #58 cu același Dn63 și aceeași zonă → conflict purtat deschis; toate identitățile prezente → poate fi închis. Testul E2E din `concurenta_test.ts` cere acum ambele poziții #31/#32 la închidere. | Probele au trecut prin adaptor Node; Deno nativ și verificarea sa TypeScript nu au rulat. Înregistrările vechi fără lista identităților acoperite nu sunt tratate ca dovadă pentru un conflict care are ID-uri explicite. |
| F08 | `concurenta.ts`: CAS compară atomic **întreaga analiză**. Orice scriere concurentă, inclusiv doar `integritate`, produce conflict, recitire și reconstruirea modificării peste datele curente. Rezervarea/eliberarea modifică numai `rezervari_zone` în această reconstrucție. RPC nou în migrarea 3, `ofertare_plansa_analiza_cas`, SECURITY INVOKER, search_path fix, EXECUTE numai service_role. Payload POST, fără JSON mare în URL. | Două teste în `concurenta_test.ts`: intervenție B înaintea UPDATE-ului A atât la rezervare, cât și la eliberare; snapshot vechi la `scrieCAS`. Probă SQL suplimentară în harness: writer B schimbă integritatea, CAS vechi refuzat, CAS după recitire păstrează ambele modificări. | Simulările trec. RPC-ul nu a fost aplicat/testat pe PostgREST real; proba PG nu a rulat. Migrarea trebuie instalată înainte de worker. Apelurile cu patch în afara câmpurilor cunoscute sunt refuzate. |
| F09 | `src/ofertareGraficReverificare.js` exportă `COLOANE_GRAFIC_REVERIFICARE`; loaderul real din `OfertarePropunere.jsx` o folosește. Adăugate `tip_sursa` **și** `licitatie_id`, ambele din contractul perimetrului TOTAL. | `ofertareReviewF.test.js`: constanta apare în SELECT-ul real, conține câmpurile necesare; proiectarea efectivă păstrează TOTAL comparabil și reverificarea graficului, fără să amestece memoriul cu F3. | Diagnostic Node trecut. Query-ul real nu a putut fi executat pe API; coloanele sunt folosite deja de codul existent. |
| F10 | `ofertareCantitatiAprobare.js`: aceeași extragere a tokenului complet în propunere și reverificare. `DN1000` rămâne `1000`; tokenurile cu lungime în afara a 2–4 cifre rămân întregi și sunt semnalate în mesajul propunerii și blochează controlul frontului. | `ofertareReviewF.test.js`: DN1000 ≠ DN100; front vechi trunchiat cere reverificare; 9/10000/123456 sunt semnalate, nu trunchiate. | „Suportat” înseamnă aici format numeric de 2–4 cifre. Nu am inventat un catalog tehnic de diametre/materiale admise; fronturile existente acceptă și editarea manuală a Dn. |

## Efectul F04 și ordinea instalării — istoric runda 1; actualizat în runda 2b

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

## Runda 2

27.09.2026 — sarcina `JAK_REVIEW_F2.md`. Modificări locale, fără git, deploy sau modificări în producție.
**F04 rămâne deschis:** lipsește rezultatul verificării hashurilor din producție, cerut înaintea implementării blocării.
Nu există dovadă că hashurile lipsesc peste tot și nu am presupus că sunt populate.

### Corecții implementate

- **Atomicitate:** în migrarea 3 și rollback, singurul `COMMIT` este ultima instrucțiune, după `ofertare_totaluri_control`
  și granturile sale. Proba PG introduce o excepție după ultimele granturi, înainte de COMMIT, în ambele sensuri.
  Compară toate funcțiile publice înainte/după: definiție, OID, proprietar, ACL și configurație; verifică inclusiv
  crearea/ștergerea CAS. Nu este doar o verificare textuală a poziției COMMIT.
- **F02:** protecția documentului transmis și revenirea la `propunere` la editare sunt înaintea ieșirii pentru
  clarificări fără `auto_planse_`. Sunt acoperite `platforma` și `automat`, indiferent de writer.
  Editarea unei ciorne `de_trimis` împreună cu `status='trimisa'` revine tot la `propunere`.
  Reaprobarea separată cere drept de decizie; textele `trimisa`/`raspunsa` și fișierul transmis sunt imuabile.
  Amprenta cantitativă rămâne exclusiv pentru cheile auto.
- **F06:** când nu există eveniment `validat`, DELETE caută un `invalidat`/`redeschis` cu
  `aprobare_veche.status='validat'` **sau** `status_vechi='validat'`. Păstrează dovada și ID-ul evenimentului
  în `aprobare_veche`; folosește `valori_vechi` pentru câmpurile absente. `unitate_schimbata` este exclus.
  Proba PG parcurge validat fără istoric → invalidare/redeschidere → DELETE, verifică valorile aprobate,
  evenimentul `sters`, contorul view-ului și cele două forme de dovadă separat.
- **F10:** tokenul numeric include zecimalele, iar frontul păstrează tipul în `dn_tip` (`DN`, `De`, `D`).
  `DN1000` rămâne `1000`; `De914,4×7,1` păstrează `914,4`, iar `De60.3` păstrează `60.3`.
  Modelul existent este Dn întreg: orice `De` și orice diametru zecimal sunt semnalate „de verificat” și blochează
  controlul fronturilor, inclusiv pe fronturi istorice trunchiate și grafic înghețat. Nu deducem DN din diametrul exterior.
- **U:** în JS și triggerul SQL, observația `cantitate_plansa` rămâne în metri; numai fallback-ul `cantitate`
  se multiplică cu factorul unității, atât pentru rândul nou, cât și pentru referința aprobată.
  Comparația câmpului `cantitate` rămâne în unitatea rândului. Cazurile comune din
  `src/ofertareInvalidareUnitati.cazuri.js` verifică m/km/hm, apariția și eliminarea observației,
  egalitatea fizică, cantitatea necunoscută, schimbarea cantității și referința din istoric.
  **Caz suplimentar descoperit:** și `api/_cantitatiInvalidare.js` este o copie folosită de CAD;
  am sincronizat-o, astfel încât toate cele trei copii rămân identice octet cu octet.

### F04 — SELECT de rulat înainte de implementare

Disponibil și în `docs/R5_F04_VERIFICARE_HASH.sql`. Perimetrul și recunoașterea hashului sunt identice
cu `ofertare_f3_baza`; coloanele opționale se citesc prin `to_jsonb`, fără presupuneri despre schemă.

```sql
WITH documente AS (
  SELECT d.id, d.licitatie_id, d.nume_original, d.tip,
    EXISTS (
      SELECT 1 FROM unnest(ARRAY[to_jsonb(d)->>'sha256', to_jsonb(d)->>'fisier_sha256',
        d.analiza#>>'{integritate,sha256}', d.analiza#>>'{integritate,fisier_sha256}']) h
      WHERE h ~* '^[0-9a-f]{64}$'
    ) AS are_hash
  FROM public.ofertare_documente_atribuire d
  WHERE d.analiza ? 'plansa' OR d.tip = 'lista_cantitati'
)
SELECT id, licitatie_id, nume_original, tip, are_hash,
  count(*) OVER () AS documente_relevante,
  count(*) FILTER (WHERE are_hash) OVER () AS cu_hash,
  count(*) FILTER (WHERE NOT are_hash) OVER () AS fara_hash
FROM documente ORDER BY licitatie_id, id;
```

Rezultatul încă nu a fost primit. Fără rânduri = niciun document în perimetrul de mai sus.
Dacă există documente și `cu_hash=0`, propun **fără implementare**: calcul SHA-256 din bytes efectivi ai fișierului
și salvarea identității legate de versiunea exactă a sursei, cu inventar/preview și tratarea fișierelor inaccesibile;
abia apoi activarea blocării. Calea, mărimea și aprobarea umană nu substituie hashul conținutului.

După verificarea datelor, F04 trebuie să dea prioritate lui `identitate_neverificabila` față de `ok` și `luat_act`,
cu mesaj nominal „documentul X nu are hash — reverifică sursa”, când un document relevant din baza **curentă**
are identitate incompletă. De testat atunci: reconfirmare pe aceeași amprentă fără hash, un singur document fără hash
într-un lot mixt, dispariția hashului după aprobare, hash invalid, document nerelevant fără hash, export și trimitere.
**În această rundă nu am modificat `ofertare_clarificare_baza_stare`; semnalul existent nu este încă un blocaj.**

### Rulări și limite

- **Vitest 2.1.9 real: 726/726, 21 fișiere.** Comandă:
  `node .jak/review-f2-vitest-native.mjs src/ofertare src/grafic src/Ofertare`.
  Runnerul folosește API-ul Vitest și aserțiunile sale reale, worker threads, `preserveSymlinks`,
  fără esbuild; TypeScript este transformat de `node:module.stripTypeScriptTypes`.
  Nu folosește adaptoarele de aserțiuni din runda 1. Configurația React/Vite obișnuită și build-ul nu sunt validate astfel.
  Comanda standard `npx --no-install vitest run src/ofertare src/grafic src/Ofertare` a eșuat înaintea testelor,
  la subprocessul esbuild (`spawn EPERM`). Primele rulări alternative au evidențiat copia CAD și fixture-ul fără
  `dn_tip`; am corectat ambele, apoi suita completă de mai sus a trecut.
- **Deno 2.9.7 nativ: încercat, fără rezultat de test trecut.** Executabilul este în
  `C:/Users/offic/AppData/Local/Microsoft/WinGet/Packages/DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe/deno.exe`.
  `deno test -A --node-modules-dir=none supabase/functions/ofertare-plansa-citeste supabase/functions/ofertare-clarificari-propune supabase/functions/ofertare-document-nou-citeste`
  nu poate descărca manifestul JSR `@std/assert` (și încearcă registrul npm pentru Supabase).
  Testul nou `invalidare_unitati_test.ts` folosește aserțiuni Node native, fără dependențe externe;
  `deno test -A --node-modules-dir=none supabase/functions/ofertare-plansa-citeste/invalidare_unitati_test.ts`
  trece verificarea de tipuri, apoi Deno se oprește cu panic la pipe Windows: `Unexpected client pipe failure`,
  cod 5 / `The handle is invalid`. **0 teste confirmate executate de Deno.**
  Rularea separată `deno check --node-modules-dir=none supabase/functions/ofertare-plansa-citeste/invalidare_unitati_test.ts`
  a trecut. Cele 24 de cazuri sunt verificate funcțional în Vitest; acest lucru nu înlocuiește Deno test.
- **Node R5/R9b: 9/9**, `node --test --test-isolation=none scripts/test-r5-r9b.mjs`.
- **PostgreSQL: teste scrise, nerulate**, conform sarcinii. `scripts/pg/test_r5_review_f.mjs` are 41 probe:
  14 existente + atomicitate + F02 + F06 + 24 cazuri U cu paritate SQL/JS inclusiv textul notei.
  `node --check scripts/pg/test_r5_review_f.mjs` a trecut; nu validează SQL.
  Pentru PostgreSQL 16 local de test: `PGURI=postgres://postgres@localhost:5432/r9b_test_review_f node scripts/pg/test_r5_review_f.mjs`.
  Harness-ul recreează exclusiv baza locală de test indicată. Nu se rulează pe producție.
- Nu am rulat PostgreSQL, PostgREST real, verificarea hashurilor în producție, build sau CI/deploy.
  CI existent include automat noile teste Vitest/Deno și scriptul PG extins.

## Runda 2b — F04

Sarcina `JAK_F04.md`, varianta B aprobată de Copilot + Răzvan. Modificări locale, fără git,
aplicare de migrări sau schimbări în producție.

**F04 = mitigat temporar; identitate verificabilă restantă (import hash pentru cele 14 documente, cu GO Răzvan).**

Faptele din producție sunt cele comunicate de Claude în sarcină: 26 documente relevante, niciun hash
în `ofertare_documente_atribuire`, 12 documente cu manifest și mărime concordantă, 14 fără manifest.
Nu am repetat verificarea în producție și nu am importat hashuri.

Implementare în migrarea 3:

- `ofertare_f3_baza` folosește și manifestul: `document_id` și licitație identice,
  `marime = size_bytes`, SHA-256 valid; cel mai recent `verificat_la`, apoi `id` pentru egalități.
  Caută ultimul rând eligibil, fără asociere după nume. Hashurile valide din document rămân utilizabile.
  Documentele au `identitate: verificata/limitata`; hashul selectat intră în amprentă.
  Formula este acum `r5_f04_v2`, deci aprobările pe formula anterioară cer reverificare.
- Orice document relevant cu identitate limitată impune `identitate_limitata`, inclusiv peste `luat_act`.
  Avertismentul nominal precizează limita înlocuirii la aceeași cale și mărime.
  Exportul și trecerea în `de_trimis/trimisa` sunt blocate.
- RPC-ul `ofertare_clarificare_exceptie_identitate` cere autentificare, drept de decizie pe licitație,
  motiv de minimum 10 caractere și tokenul curent al textului+bazei. Este SECURITY DEFINER cu search_path
  explicit, PUBLIC/anon revocate și authenticated autorizat. Blochează rândul ciornei la citire;
  actualizarea are WHERE pe ID. Acceptă numai ciorne netransmise.
- Excepția se păstrează în `baza_generare.exceptie_identitate` și `istoric_decizii`: token, autor,
  dată, motiv, lista ID-urilor documentelor limitate și `metadate` indexate după ID, fiecare cu
  `fisier_path` și `marime`. Scrierea directă a bazei rămâne interzisă clienților.
  Reconfirmarea păstrează numai excepția pe același token. Numai perechea excepție+reconfirmare
  curentă permite `ok_identitate_limitata`; avertismentul rămâne în text și în
  `detalii.avertisment_identitate`, precum și în detaliile bazei salvate la reconfirmare.
- Editarea textului elimină excepția activă, fără pierderea auditului, inclusiv dacă textul este
  ulterior readus la forma veche. Schimbarea bazei invalidează tokenul; reconfirmarea singură
  nu reînnoiește excepția. Caz suplimentar: regenerarea unei propuneri înainte de reconfirmare
  putea elimina istoricul; triggerul îl păstrează și pe această cale.
- UI: avertisment vizibil și buton „Accept excepția de identitate”, cu motiv obligatoriu.
  Dreptul este citit prin poarta serverului existentă; răspunsurile întârziate nu dau drepturi
  pe altă licitație/profil. Helperul JS acceptă aceleași două stări de ieșire ca SQL și păstrează
  blocarea pentru editări locale, marcaje de revizie și control indisponibil.
- `ofertare_r5_blocaj_sursa` nu a fost modificată în această rundă. Excepția nu aprobă cantități
  și nu derogă de la poarta pachetului final. Rollback-ul restaurează suplimentar funcțiile de
  stare/reconfirmare/export din migrarea 2 și elimină RPC-ul nou; datele și auditul se păstrează.
  Migrarea și rollback-ul rămân tranzacții unice, cu COMMIT după ultimele definiții/granturi.

Verificări:

- **Vitest real 2.1.9: 732/732, 22 fișiere**, inclusiv 6 probe noi pentru helper/UI.
  Comandă: `node .jak/review-f2-vitest-native.mjs src/ofertare src/grafic src/Ofertare`.
  Runnerul existent folosește motorul/asertările Vitest cu worker threads, fără esbuild.
  Comanda standard `npx --no-install vitest run src/ofertare src/grafic src/Ofertare`
  s-a oprit înaintea testelor: `esbuild: spawn EPERM`.
- **Deno nativ: încercat, fără teste executate confirmate.** Comanda `deno test -A --node-modules-dir=none`
  pentru `ofertare-plansa-citeste`, `ofertare-clarificari-propune`, `ofertare-document-nou-citeste`
  s-a oprit la descărcarea manifestului JSR `@std/assert`. Nu există rezultat Deno trecut.
- **Regresii Node R5/R9b: 9/9.** JSX-ul modificat trece parsarea `@babel/parser`.
- **PostgreSQL: 7 probe F04 B noi, scrise, nerulate**, conform sarcinii; Claude le rulează.
  Acoperă refuzul fără excepție, ambele ordini excepție/reconfirmare, auditul și avertismentul,
  schimbarea textului/bazei, token vechi/null, motiv scurt, lipsa dreptului/auth,
  scriere directă, manifest valid, manifest cu mărime nepotrivită, lot mixt, nume identic cu ID diferit,
  document nerelevant, regenerare, izolare per ciornă, `luat_act` și poarta finală independentă.
  Fixture-ul include manifestul cu RLS; probele vechi pornesc cu o identitate verificată.
  `node --check` trece pentru ambele scripturi PG. Comanda pentru Claude rămâne
  `PGURI=postgres://postgres@localhost:5432/r9b_test_review_f node scripts/pg/test_r5_review_f.mjs`.
- Nu am executat PostgreSQL, RPC/PostgREST real, build sau deploy. Validarea SQL și API rămâne
  de făcut de Claude înaintea instalării; parsarea JS și Vitest nu o substituie.

„Verificată” este clasificarea metadatelor în varianta B: această migrare nu recalculează hashul
fișierului din storage. Excepția umană nu constituie dovadă de identitate a conținutului.

## Runda 2c

Sarcina `JAK_F04C.md`: cele trei puncte NO-GO corectate local. Regulile de mai jos înlocuiesc
selecția manifestului și a primului hash descrise la runda 2b. Fără git sau aplicare în producție.

- **F04 — eligibilitatea manifestului:** numai `stare='deja_in_platforma'`, asociere prin
  `document_id`, aceeași `licitatie_id`, `marime=size_bytes` și SHA-256 de 64 caractere hex.
  Ultimul rând se determină după `id DESC`, fără filtrare prealabilă după eligibilitate și fără
  ordonare după `verificat_la`. Dacă acesta este neeligibil, documentul este `contradictorie`,
  inclusiv când există un hash valid în analiză sau un manifest vechi eligibil. Metadatele relevante
  ale ultimului manifest intră în amprentă; timestampurile și ID-ul rândului manifest nu intră.
- **F04 — contradicții:** se colectează toate hashurile valide din cele patru câmpuri ale
  documentului/analizei și din toate manifestele eligibile. Lista este normalizată lowercase,
  deduplicată și sortată. Fără hash și fără manifest contradictoriu → `limitata`; un singur hash
  distinct → `verificata`; cel puțin două → `contradictorie`. Istoricul eligibil cu hashuri diferite
  nu este ascuns nici dacă ultimul rând revine la un hash anterior. Toată lista intră în amprenta
  `r5_f04_v3`; hashul singular `sha256` este NULL la contradicție. Bazele anterioare cer reverificare.
  `identitate_contradictorie` are prioritate față de review, `luat_act` și identitatea limitată din
  același lot. Textul nominal cere rezolvare și interzice excepția. RPC-ul refuză fără să scrie
  excepție/audit; porțile existente refuză exportul și trecerile în `de_trimis`/`trimisa`.
  Helperul JS afișează aceeași stare, exclude ciorna din export și nu permite butonul de excepție.
- **F02 — DELETE:** triggerul refuză ștergerea rândurilor `platforma`/`automat` în
  `trimisa`/`raspunsa`, inclusiv chei hash fără prefix. Ciornele fără prefix auto și rândurile manuale
  rămân ștergibile; protecția existentă `auto_planse_%` rămâne aplicată.

Verificări:

- **Vitest real 2.1.9: 734/734, 22 fișiere**, inclusiv cele două teste noi de contradicție UI/export.
  Comandă: `node .jak/review-f2-vitest-native.mjs src/ofertare src/grafic src/Ofertare`.
  Comanda standard `npx --no-install vitest run` s-a oprit înaintea testelor la `esbuild: spawn EPERM`.
  Runnerul existent folosește motorul și aserțiunile Vitest, worker threads și transformarea TypeScript
  prin Node, fără esbuild; rezultatul nu validează build-ul sau transformările React/Vite obișnuite.
- **7 probe PostgreSQL noi scrise, nerulate**, în `scripts/pg/test_r5_review_f.mjs`:
  DELETE prin rolul authenticated cu grant DELETE și RLS `clar_all` în fixture (ambele origini,
  toate cele patru statusuri, manual și protecția auto); stări manifest neeligibile inclusiv cu hash
  valid în analiză; ultimul ID neeligibil prin stare/mărime/licitație cu timestampuri în ordine inversă;
  hashuri istorice contradictorii; fiecare dintre cele cinci surse de hash, egalitate și normalizare;
  analiza A + manifest B cu schimbare de amprentă și refuzul excepției/exportului/tranzițiilor chiar
  după reconfirmare; lot mixt cu excepție anterioară și `luat_act` după transmitere.
  Probele existente au fost adaptate: fixture verificat cu `deja_in_platforma`, identitate absentă
  separată de manifest neeligibil, duplicat identic fără schimbarea amprentei. Coloanele opționale de
  hash există doar în fixture pentru acoperirea celor patru surse; schema reală nu este modificată.
- `node --check` a trecut pentru ambele scripturi PG. Verificare statică: cele patru funcții modificate
  sunt deja restaurate/eliminate de rollback; nu apar funcții noi în această rundă. Rollback-ul rămâne
  neschimbat. Migrarea și rollback-ul au fiecare un singur COMMIT, ultima instrucțiune.
- PostgreSQL și PostgREST nu au fost executate, conform sarcinii; Claude rulează:
  `PGURI=postgres://postgres@localhost:5432/r9b_test_review_f node scripts/pg/test_r5_review_f.mjs`.
  Scriptul recreează exclusiv baza locală de test. Nu am rulat build, deploy sau migrări în producție.
