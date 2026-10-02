# P2 / J06 — plan de rulare pe clona 103

Pregătire locală, 29.09.2026. **J06b: GO pregătire, NO-RUN live.** Nicio conexiune Supabase/CDP și nicio rulare AI efectuată. Un GO singur nu înlocuiește precondițiile tehnice de mai jos. Nu se folosește service_role și nu se elimină blocajele clonei pentru a obține verde.

## J06b — contract obligatoriu înainte de prima fază

- Actorul fix este `10c105d3-536d-4ca6-b943-803592626909`, din `fixture.actor_id`. La fiecare snapshot se verifică prin `auth.getUser()` și SELECT `profiles(id,is_owner)` cu același JWT authenticated. Sesiunea UI trebuie să aibă același actor și același JWT; reautentificarea/refreshed JWT în timpul seriei nu schimbă automat contextul. Orice pas `requires_owner` produce BLOCKED_BY_ROLE, fără comutarea identității.
- T0 se salvează înainte de orice acțiune UI în `docs/AUDIT_OFERTARE_V2/dovezi/serie-103/T0.json` (sau fragmente + index). Include toate rândurile citite, stările pachetelor/fișierelor/porții, întreg manifestul, cerințele active (`inlocuita_de IS NULL`), auditul J05, contoarele și amprentele tabelelor. Include SELECT brut `storage.objects` sub `103/`, cu id, bucket_id, name, updated_at, eTag, size și SHA256 calculat din bytes descărcați. eTag nu substituie SHA256. Fiecare artefact are `.sha256`; indexul și registrul păstrează și ele hash-uri. Un refuz Storage/RLS este permisiune lipsă, nu inventar gol.
- `serie.json` păstrează T0, snapshotul precedent, actorul, tentativele fiecărei faze și incidentul care oprește seria. Un lock exclusiv împiedică două procese simultane. T0 nu se reface la următoarea comandă. Un lock rămas după crash cere revizuire manuală. Nu ștergeți registrul pentru a ocoli oprirea.
- Garda CDP `Fetch` interceptează cererile înainte de trimitere. Permite SELECT REST brut și citiri Storage strict sub `103/`; singura tentativă de mutație implementată este PATCH `ofertare_licitatii?id=eq.103`, corp exact `{"status":"depusa"}`, în faza cu `refuz_server`. Refuză alte origini, JWT diferit, OR/filtre suplimentare, RPC/Edge, uploaduri fără contract și `pt/103/`. Nu deduce autorizarea din URL-ul paginii.
- **Veriga endpoint lipsă:** nu există aici un endpoint demonstrat de supraveghere completă și gardă server pentru efectele triggerelor/workerilor, inclusiv rândurile ascunse de RLS. Runnerul cere providerul read-only `supraveghere`, cu `complete`, inventar stabil `inventory_id`, actor, gardă server activă pentru 103, toate tabelele și toate obiectele. Rândurile de inventar au id, licitatie_id și SHA256 al întregului rând; obiectele includ bucket_id/name. Acesta este un contract de integrare testat prin simulări, **nu un endpoint nou instalat sau o garanție deja disponibilă**. CLI-ul nu are provider live; refuză `--apply` înainte de acțiuni. Implementarea/verificarea serverului revine lui Claude separat; nu se simulează completitudinea printr-un SELECT filtrat pe 103 sau un boolean în fixture.
- După fiecare fază se salvează snapshotul, diff față de T0 și față de faza precedentă (INSERT/UPDATE/DELETE, inclusiv rânduri vechi și identități Storage schimbate). Se verifică și deriva dintre două comenzi. Orice efect în afara `expected_tables`/`expected_storage` este BYPASS; orice scope diferit de 103 oprește cu cod 22. În lotul negativ actual listele de scrieri comise permise sunt goale. Rețetele viitoare de scriere cer liste concrete și contract de endpoint, nu relaxarea guardului.
- `external_effect` este obligatoriu: `none | db | storage | seap | email | webhook | cron | alta_licitatie`. `--apply` refuză orice altceva decât primele trei, înainte de conexiuni. Efectul declarat nu dezactivează garda activă. `safe_rerun` și `rerun_behavior` sunt prezente pe fiecare fază. Tentativa se persistă înainte de acțiune; după crash/eșec, o fază nesigură cere `--confirm-rerun`. Flagul nu anulează oprirea critică, rolul, precondițiile sau izolarea.
- La primul FALSE_GREEN (exit 20), BYPASS (21), scriere/cerere în afara 103 (22), divergență critică UI/server (23), se salvează incidentul și se oprește seria. Următoarea comandă citește oprirea și refuză continuarea. UNDETERMINED/UI_ONLY/BLOCKED_BY_ROLE au exit 2. Nu continuați un lot shell după un exit nenul.

## J06b — postcondiții brute R5/R12/J05 și slot separat R5

Cu JWT-ul actorului fix, prin PostgREST SELECT paginat, înainte/după fiecare fază:

```sql
SELECT * FROM public.v_ofertare_cantitati_nevalidate WHERE licitatie_id = 103;
SELECT * FROM public.v_ofertare_seap_completitudine WHERE licitatie_id = 103;
SELECT * FROM public.ofertare_derogari_audit WHERE licitatie_id = 103 ORDER BY id;
SELECT * FROM public.ofertare_pt_pachet WHERE licitatie_id = 103 ORDER BY id;
SELECT * FROM public.ofertare_licitatii WHERE id = 103;
SELECT * FROM storage.objects WHERE name LIKE '103/%' ORDER BY id;
```

SQL-ul arată semantica citirilor, nu oferă un executor SQL din browser. Artefactele `*-porti-brut.json` păstrează rândurile, actorul și sloturile R5 `rezultat_claude: null`, `artifact_claude: null`. `public.ofertare_r5_blocaj_sursa(103)` este **funcție SQL**, nu tabel/view. Runnerul SELECT-only nu îi inventează un endpoint și nu o declară verificată. În lipsa unei căi non-owner demonstrate (inclusiv când EXECUTE/RLS refuză), Claude execută separat, SQL admin read-only:

```sql
SELECT public.ofertare_r5_blocaj_sursa(103) AS blocaj;
```

Claude atașează rezultat, moment, identitatea verificatorului și artefact cu hash, legat de hash-ul snapshotului exact al fazei. Actorul seriei rămâne non-owner. Până atunci verificarea funcției R5 este UNDETERMINED, motiv **permisiune/endpoint**, chiar dacă view-ul indică 62 de cantități și UI este disabled. UI_ONLY nu dovedește triggerul; J05 cu zero pachete refuză înainte de R5. Niciun mesaj UI nu substituie aceste postcondiții.

## J06b — P2.01–P2.12, ordinea obligatorie a fiecărei probe

### P2.01 — documente SEAP

1. **Precondiții:** T0 și gărzi active; copie locală identificată prin SHA256, nume/mărime, control de upload unic. Verigile fixture/selector lipsesc în rețeta actuală; endpointul Storage de scriere nu are contract implementat.
2. **Acțiune:** import copie; apoi înlocuire cu același nume și cazul obiectului lipsă numai după identificarea traseului real. Nu se descarcă din SEAP și nu se fabrică un control de ștergere.
3. **Scrieri așteptate:** la import, un document și un obiect `103/`; manifest doar dacă traseul concret îl scrie. Numărul exact și efectele triggerelor trebuie stabilite în preview. Lotul actual permite zero scrieri comise.
4. **Verdict server așteptat:** importul apare în SELECT, bytes/hash/identitate coincid; înlocuirea trebuie să invalideze proveniența veche. Fără endpoint/fixture: UNDETERMINED.
5. **Verdict UI așteptat:** documentul și starea reală apar; document lipsă nu apare utilizabil. Deduplicarea nu dovedește înlocuirea.
6. **Dovezi de capturat:** HTTP finalizat, capturi, document/manifest integral, metadate și hash Storage, cele două diff-uri și porțile brute.
7. **Cleanup/rollback:** copia 103 numai după preview și confirmare, RETURNING pentru BD; inventar explicit pentru obiecte. Nu atinge originalul, auditul sau alte prefixe.

### P2.02 — citire

1. **Precondiții:** T0, document/page count/selector unic și GO separat de buget; endpointul workerului izolat trebuie probat. Lipsesc fixture-ul integral și endpointul autorizat.
2. **Acțiune:** citire integrală, apoi recitire pentru idempotență, cu același actor. Fără AI în sarcina J06b.
3. **Scrieri așteptate:** documentul și coada de ingestie; cardinalitatea/istoricul workerului din preview, fără efecte în alte licitații. Niciuna autorizată acum.
4. **Verdict server așteptat:** toate paginile procesate, coadă inactivă; recitire fără dubluri. Un count de pagini incomplet nu este succes.
5. **Verdict UI așteptat:** complet/parțial afișat conform SELECT, fără verde pe text trunchiat.
6. **Dovezi de capturat:** pagini totale/procesate, job și erori, HTTP, UI, cele două diff-uri, R5/R12/J05 brut.
7. **Cleanup/rollback:** păstrare istoric; restaurarea câmpurilor autorizate include invalidările dependente. Nu se repornește workerul ca workaround.

### P2.03 — cerințe

1. **Precondiții:** T0, documente citite, ID 6656 și selector unic demonstrat; lipsesc selectorul de rând, textul corecției și fixture-ul de trunchiere.
2. **Acțiune:** extragere → confirmare umană → corecție → reextragere → probă de trunchiere; AI numai cu GO separat.
3. **Scrieri așteptate:** cerințe noi/istoric și coadă; confirmarea/corecția ating ținta și invalidările explicite. Numărul N se fixează în preview; zero în lotul actual.
4. **Verdict server așteptat:** `confirmata_de` este actorul fix; corecția se păstrează la reextragere; istoricul nu dispare.
5. **Verdict UI așteptat:** text și autor corecte, trunchiere semnalată, fără acceptare implicită a propunerilor AI.
6. **Dovezi de capturat:** setul complet și cerințele active, legături/istoric, autor, HTTP/UI, diff T0/precedent și porți brute.
7. **Cleanup/rollback:** corecție prin calea autorizată, cu istoric; nu se șterg în masă cerințele sau semnăturile umane.

### P2.04 — clarificări

1. **Precondiții:** T0; maparea demonstrată 289/290/333 la ID-urile clonei, documente și selectori. Lipsesc mapări/selector; aplicarea D1 și cazul după PT cer stări pregătite.
2. **Acțiune:** leagă cele trei documente → aplică D1 → observă clarificarea după PT, fără a ghici ID-uri după ordine.
3. **Scrieri așteptate:** clarificările țintă, punctele/seturile de răspuns și invalidările PT confirmate prin preview. Niciuna comisă în lotul curent.
4. **Verdict server așteptat:** ID document și status corecte; D1 folosește răspunsul aplicabil; PT anterior nu rămâne valabil nejustificat.
5. **Verdict UI așteptat:** sursa legată vizibil, răspuns și necesar de reverificare concordante cu serverul.
6. **Dovezi de capturat:** mapări, rânduri înainte/după, versiuni PT, HTTP/UI, diff-urile și porțile brute.
7. **Cleanup/rollback:** restabilire pe ID-uri explicite după confirmare; nu se șterge istoricul și nu se declară verificat PT-ul vechi.

### P2.05 — acoperire

1. **Precondiții:** T0; ID candidat, scan și verificare umană, selector unic. Lipsesc aceste verigi; motorul/retry cer buget separat.
2. **Acțiune:** motor → alegere umană → verificare scan → caz AI neverificat → retry, păstrând actorul fix.
3. **Scrieri așteptate:** candidați/acoperiri și invalidările documentate; alegerea atomică poate schimba mai mulți candidați ai aceleiași cerințe. Zero autorizate acum.
4. **Verdict server așteptat:** un singur ales, `ales_de` corect, dovadă/scan valide; rerularea nu schimbă alegerea umană.
5. **Verdict UI așteptat:** AI neverificat rămâne propunere și nu satisface poarta; alegerea persoanei nu se confundă cu documente alternative.
6. **Dovezi de capturat:** toți candidații țintei, autorii, sursa scanului, HTTP/UI, diff T0/precedent, R5/R12/J05 brut.
7. **Cleanup/rollback:** doar restaurare autorizată a alegerii și invalidărilor, fără a fabrica o verificare de scan.

### P2.06 — cantități

1. **Precondiții:** T0, R5 view brut (62 nevalidate), ID cantitate validată/nevalidată și selector. Lipsesc fixture/selector pentru probă izolată.
2. **Acțiune:** validare parțială → revizie F3 (AI separat) → verificare blocare la diferență.
3. **Scrieri așteptate:** cantitatea, istoric și invalidări dependente explicite; cazul negativ nu comite pachet aprobat. Zero scrieri în lotul actual.
4. **Verdict server așteptat:** cantitățile nevalidate/diferențele mențin blocajul; funcția R5 are slot separat Claude, nu se deduce din view.
5. **Verdict UI așteptat:** aprobare disabled; este numai UI_ONLY dacă nu s-a trimis o tentativă server.
6. **Dovezi de capturat:** SELECT cantități/pachete, view R5, slot funcție R5, R12/J05, capturi și ambele diff-uri.
7. **Cleanup/rollback:** restaurare completă numai după preview/confirmare; nu se validează artificial cele 62 pentru a deschide poarta.

### P2.07 — grafic

1. **Precondiții:** T0, activități, mod, parametri verificați, versiune și selectori. Lipsesc fixture/stare/selectori pentru editare și după PT.
2. **Acțiune:** editare → înghețare/snapshot → generare PT (AI separat) → editare după PT.
3. **Scrieri așteptate:** activități, o versiune nouă de grafic și, separat, capitole/invalidări PT. Nicio scriere permisă acum.
4. **Verdict server așteptat:** versiuni coerente; modificarea sursei invalidează folosirea versiunii vechi la pachet.
5. **Verdict UI așteptat:** versiunea curentă și nevoia reverificării PT sunt afișate, fără verde pe snapshot vechi.
6. **Dovezi de capturat:** activități integral, versiuni și legături PT, HTTP/UI, cele două diff-uri și porți brute.
7. **Cleanup/rollback:** revenire prin versiune nouă unde aceasta este calea produsului; nu se rescriu snapshoturile istorice.

### P2.08 — propunere tehnică

1. **Precondiții:** T0; capitol/legătură/versiune/locator, om care a citit dovada, selectori unici. Lipsesc fixture și confirmări pentru D1/D6/D8.
2. **Acțiune:** generare (AI separat) → confirmare legături → verificări D1/D6/D8 → promisiune peste cerință → editare după verificare.
3. **Scrieri așteptate:** capitol/istoric, legături și invalidări explicite; fără upload al propunerii tehnice pe Storage. Niciuna în lotul curent.
4. **Verdict server așteptat:** locator și versiune semnate de actor; editarea face veche verificarea anterioară; promisiunea neacoperită nu trece.
5. **Verdict UI așteptat:** lanțul și versiunea corespund SELECT; verificarea veche nu apare verde.
6. **Dovezi de capturat:** current+istoric, legături, locatori, HTTP/UI, T0/precedent și porți brute.
7. **Cleanup/rollback:** versiune nouă de revenire; nu se restaurează ca valabilă o semnătură aferentă altui conținut.

### P2.09 — verificări finale

1. **Precondiții:** T0, capitole identificate, buget și endpoint izolat. Endpointul Edge hardcodat și selectorii/starea nu sunt demonstrate pentru rulare.
2. **Acțiune:** verificare finală → modificare versiune → verificarea invalidării verdictului.
3. **Scrieri așteptate:** raport, capitol/istoric și invalidări, exact după preview; zero în această pregătire.
4. **Verdict server așteptat:** raportul aparține versiunii citite; versiunea nouă nu moștenește nejustificat verdictul.
5. **Verdict UI așteptat:** avertizare/reverificare conform datelor; raportul vechi nu dă verde versiunii noi.
6. **Dovezi de capturat:** raport și versiuni, HTTP fără secrete, UI, ambele diff-uri și R5/R12/J05 brut.
7. **Cleanup/rollback:** păstrează raportul istoric; revenirea textului nu echivalează automat cu verificarea noii versiuni.

### P2.10 — pachet

1. **Precondiții:** T0 complet, zero pachete, R5=62 și R12 blocant, actor fix, PT selectat pe 103. AI neverificat nu este încă izolat de celelalte blocaje.
2. **Acțiune:** observă pachet incomplet/aprobare/semnare disabled. Asamblarea, uploadul/read-back și schimbarea fișierului după aprobare rămân fără traseu demonstrat.
3. **Scrieri așteptate:** ZERO pentru cele trei faze configurate: pachet/fișiere/poartă/manifest/audit/Storage neschimbate. Fluxul reușit generează+încarcă+aprobă împreună, inclusiv `pt/103/`, deci nu este autorizat aici.
4. **Verdict server așteptat:** SELECT brut neschimbat; refuzul triggerului rămâne UNDETERMINED fără tentativă HTTP.
5. **Verdict UI așteptat:** disabled, verdict UI_ONLY. Un buton activ pe cazul negativ este BYPASS, oprire imediată.
6. **Dovezi de capturat:** observații disabled, capturi, seturi complete de pachete/fișiere/poartă/J05/manifest/Storage, diff-urile, R5/R12 brut și slot R5.
7. **Cleanup/rollback:** nimic în cazul normal. Orice efect comis este incident; Claude pregătește revenirea pe ID-uri cu confirmare, fără a șterge auditul.

### P2.11 — depunere

1. **Precondiții:** T0, status in_lucru, derogare false, zero pachete, R5/R12 active; pentru alte faze lipsesc pachetul aprobat, dovada SEAP sau controlul UI derogare.
2. **Acțiune:** „Marchează Depusă” trimite PATCH pentru 103. Nu se depune în SEAP, nu se fabrică dovadă și nu se schimbă actorul pentru derogare.
3. **Scrieri așteptate:** ZERO comise pentru refuz, inclusiv audit J05 și Storage. Tentativa HTTP are `external_effect=db`, `safe_rerun=false` (efectul unui refuz nu se presupune înaintea probei).
4. **Verdict server așteptat:** PATCH 400 finalizat și corelat fazei, status/pachet/audit neschimbate. J05 refuză lipsa pachetului depus; nu probează izolat R5/R12.
5. **Verdict UI așteptat:** mesaj exact de refuz și status in_lucru. Verde contrazis de server este FALSE_GREEN/divergență critică, cu oprire.
6. **Dovezi de capturat:** HTTP metodă/URL/status/durată, mesaj UI/captură, SELECT brut status/pachet/audit/R5/R12, Storage și ambele diff-uri.
7. **Cleanup/rollback:** nimic la refuz. Dacă tranziția reușește, incident BYPASS; nicio inversare automată a depunerii și nicio ștergere a auditului append-only.

### P2.12 — comparație D1/D6/D8

1. **Precondiții:** T0, ground truth semantic JSON verificat și stări așteptate ale celor nouă verigi. Lipsește artifactul; TXT cu hash nu este substitut semantic.
2. **Acțiune:** observă separat matricea D1, D6, D8, fără mutații sau AI.
3. **Scrieri așteptate:** ZERO în toate tabelele și Storage.
4. **Verdict server așteptat:** rândurile/legăturile/versiunile susțin fiecare verigă; fără ground truth, UNDETERMINED.
5. **Verdict UI așteptat:** aceeași stare pe fiecare verigă; verde fără suport este FALSE_GREEN.
6. **Dovezi de capturat:** ground truth cu hash, matrice și lanț brut, capturi, T0/precedent și R5/R12/J05.
7. **Cleanup/rollback:** nimic de restaurat; orice scriere este BYPASS.

## Ce poate demonstra lotul actual

Sunt configurate patru faze fără cost AI: `10_pachet/pachet_incomplet`, `10_pachet/aprobare`, `10_pachet/semnare_poarta`, `11_depunere/status_depusa`. Celelalte 47 de faze P2 rămân UNDETERMINED cu motiv în preview și în anexa de mai jos. Nu au fost inventate ID-uri de rând, pagini, texte corectate sau confirmări umane.

**Limita specificației:** `OfertarePropunere.jsx:2081–2089` dezactivează aprobarea și semnarea când poarta este blocată. Un click server nu poate fi demonstrat prin UI în această stare. Cele trei probe de pachet sunt UI_ONLY, nu MATCH pentru trigger. Nicio rețetă nu dezactivează protecția și nu substituie un apel SQL/API clickului.

„Marchează Depusă” trimite PATCH pe `ofertare_licitatii?id=eq.103` (`OfertareLicitatii.jsx:326–331,3675`). Cu zero pachete, J05 refuză întâi lipsa pachetului depus, înainte să ajungă la R5. MATCH pentru această fază înseamnă exclusiv: tentativă HTTP respinsă, mesaj business exact și stare neschimbată. R5/R12 sunt recitite ca active, dar execuția independentă a ambelor triggere nu este demonstrată. Pentru izolarea lor ar trebui o probă separată autorizată; nu intră în aceste rețete.

J05 (`20260929b_ofertare_derogare_audit.sql`) scrie `derogare_acordata`, `derogare_retrasa`, `depusa_pe_derogare` numai la operații reușite. Un REFUZ face rollback tranzacțional: **zero rânduri noi de audit**. Se compară întregul set de rânduri înainte/după; un audit vechi nu certifică tentativa curentă. Nu există UI de derogare și nu se acordă derogări în lotul P2.

## Pregătire și ordine

1. Verificare locală, fără browser/BD:

```powershell
node --test scripts/audit-v2/*.test.*
# În sandboxul Windows care refuză procesele copil cu EPERM:
node --test --test-isolation=none scripts/audit-v2/*.test.*
node scripts/audit-v2/test-retete.mjs
```

2. Preview pentru toate scenariile P2, fără conexiuni. `configurat` conține INPUT, acțiuni, pre/postcondiții; `selectate` exclude AI, `amanate_ai` enumeră fazele de buget. O fază fără rețetă rămâne UNDETERMINED și oprește scenariul, nu se sare automat la următoarea mutație.

```powershell
Get-ChildItem scripts/audit-v2/scenarii/*.mjs |
  Where-Object { [int]$_.Name.Substring(0, 2) -le 12 } |
  ForEach-Object { node $_.FullName --dry-run }
```

3. Claude pregătește sesiunea deja autentificată, contul non-owner din fixture, tabul explicit `cdp_target_id` și mediul cu `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AUDIT_ACCESS_TOKEN`. Valorile nu se copiază în raport. Clientul cere JWT `authenticated`. Nu se utilizează helperul de copiere Storage în acest lot.

4. Operatorul verifică starea clonei înainte de GO: `id=103`, `nr_anunt=SANDBOX-V2-DOMNESTI`, status `in_lucru`, `derogare_depunere=false`, zero pachete, view R5 `lista_f3_nevalidate=62`, view completitudine cu `blocaj` nenul/nevid. J06 spune „un document parțial”, fixture-ul vechi menționează ZIP-ul 1286 necitit; cauza se consemnează din view/documente, fără a o ghici. Orice diferență oprește execuția și cere refacerea preview-ului; nu se ajustează așteptarea ca să treacă testul.

5. În Propunerea tehnică se selectează clona. Contextul este verificat prin `css=select:has(option[value="103"])` și valoarea `103`; driverul cere exact un control vizibil. Butoanele sunt texte exacte din JSX. Cele trei faze sunt observații independente; `aprobare` și `pachet_incomplet` observă același buton, nu reprezintă două tentative server.

```powershell
node scripts/audit-v2/scenarii/10_pachet.mjs --faza pachet_incomplet --dry-run
# după GO:
node scripts/audit-v2/scenarii/10_pachet.mjs --faza pachet_incomplet --apply

node scripts/audit-v2/scenarii/10_pachet.mjs --faza aprobare --dry-run
# după GO pentru aceeași listă de probe:
node scripts/audit-v2/scenarii/10_pachet.mjs --faza aprobare --apply

node scripts/audit-v2/scenarii/10_pachet.mjs --faza semnare_poarta --dry-run
node scripts/audit-v2/scenarii/10_pachet.mjs --faza semnare_poarta --apply
```

6. Se deschide fișa clonei 103 în Licitații, identificată prin titlul exact `🏛 SANDBOX-V2-DOMNESTI`. Nu se identifică după obiectul copiat din licitația 5. Apoi:

```powershell
node scripts/audit-v2/scenarii/11_depunere.mjs --faza status_depusa --dry-run
# după GO:
node scripts/audit-v2/scenarii/11_depunere.mjs --faza status_depusa --apply
```

Nu se rulează un batch apply al celor 12 scenarii. Un MATCH al subsetului selectat nu certifică scenariul integral; raportul enumeră fazele selectate și cele AI amânate.

## Scrieri, stare server, verdict și artefact

| Fază | INPUT → acțiune | Scrieri BD / Storage | Stare și verdict așteptat |
|---|---|---|---|
| 10/pachet_incomplet | Clona cu R5/R12 active → observă „🔏 Aprobă pachetul” disabled | 0 în pachet, fișiere, poartă, audit; 0 obiecte | Seturile BD integral neschimbate + porți active; UI_ONLY |
| 10/aprobare | Aceeași stare → observă același control disabled | 0 în aceleași tabele; 0 obiecte | UI_ONLY; refuz server la `aprobat` UNDETERMINED |
| 10/semnare_poarta | Aceeași stare → observă „📦 Semnează verdictul porții” disabled | 0 în aceleași tabele; 0 obiecte | UI_ONLY; nu apare versiune nouă de poartă |
| 11/status_depusa | `in_lucru`, fără derogare/pachet → Detalii & decizie → Marchează Depusă | 1 UPDATE tentat asupra licitației 103, 0 rânduri comise; pachet/fișiere/audit +0; Storage 0 | HTTP PATCH 400 finalizat în această fază + toast exact „Eroare: BLOCAT LA DEPUNERE: lipseste pachetul PT in stare depus pentru licitatia 103.” + licitație integral neschimbată → MATCH strict pe refuzul acesta |

Fiecare rulare salvează în `docs/AUDIT_OFERTARE_V2/dovezi/<scenariu>/<timestamp>/`: `preconditii`, `<n>-<faza>-inainte/dupa` JSON, capturi înainte/după, `jurnal-1`, `dialoguri-1`, `verdict`. Raportul păstrează cererile HTTP ale fazei, costul și limita. La eroare după o tentativă se salvează `dupa-eroare`. Fișierele mari sunt împărțite și pot fi reconstituite prin helperul existent. Jurnalele nu includ corpuri HTTP sau tokenuri brute.

## Fazele amânate: scrieri potențiale și rollback

Acestea **nu se execută** în configurația livrată. Numerele următoare descriu operația, nu promit un rezultat actual pe clonă. Înainte de configurare trebuie cunoscute ID-urile, starea inițială și cardinalitatea exactă în preview.

| Pas | Scrieri posibile dacă va fi configurat | Revenire / date permanente |
|---|---|---|
| 01 import | N obiecte `103/atribuire/...`, N INSERT/UPDATE `ofertare_documente_atribuire`; split PDF mare poate adăuga copii | Inventar de obiecte/ID-uri noi și snapshot al placeholderelor înainte; numai după preview → confirmare → apply cu RETURNING. Nu se șterge nimic automat |
| 02 citire | 1 coadă `ofertare_ingest_coada`, D documente actualizate; D și feliile depind de job | Nu porni până nu există inventarul D și o procedură de oprire a workerului; snapshot integral pentru restaurare aprobată, costul AI consumat nu se recuperează |
| 03 cerințe | Confirmare/corecție: 1 cerință țintă; extragere: coadă + număr necunoscut de cerințe și relații | Restaurare numai după compararea versiunilor și efectelor triggerelor; istoricul rămâne, nu se face UPDATE în masă |
| 04 clarificări | Legare manuală: N clarificări selectate; analiza/aplicarea poate afecta documentul/răspunsuri/cerințe | Nu se deduce maparea 289/290/333 către clarificări din ordinea ID-urilor; se salvează câmpurile și ID-urile concrete înainte |
| 05 acoperire | Alegere atomică: candidații cerinței; verificare scan: 1 acoperire; motor: N propuneri | Starea candidaților și ales_de înainte/după; nu se modifică alegerile reale ca pregătire implicită |
| 06 cantități | Validare: 1 cantitate plus istoricul/invalidările triggerelor; revizie AI: N rânduri | Nu se validează cele 62 pentru a deschide poarta; restaurarea trebuie să includă efectele dependente |
| 07 grafic | Activități N, la generare 1 versiune snapshot; PT generat separat | Snapshoturile istorice nu se rescriu; revenirea produce versiune nouă dacă aceasta este calea UI |
| 08 PT | Legătură verificată: 1 rând; editare: 1 capitol + istoric și invalidări; generare: 1 capitol/fază, eventual relații | Se păstrează istoricul; revenire prin versiune nouă, verificările vechi nu sunt declarate valide |
| 09 verificări | AI: 1 raport `ofertare_verificari`; editarea reutilizează pasul 08 | Raportul vechi nu dovedește verificarea versiunii noi; lipsa invalidării se raportează MISSING_LINK/FALSE_GREEN |
| 10 flux reușit | Handler unic: rezervă 1 pachet, încarcă F obiecte, inserează F fișiere, încearcă 1 aprobare; la eroare încearcă ștergerea propusului | Neexecutabil în lot. Pot rămâne obiecte orfane. UI utilizează `pt/103/...`, în afara prefixului autorizat `103/`; nu se lărgește guardul Storage |
| 11 depunere fișiere | Necesită pachet aprobat: N finale + 1 dovadă, N+1 obiecte/manifest, 1 UPDATE stare | Neexecutabil cu zero pachete. Nu se fabrică dovada SEAP. Derogarea are traseu separat absent din UI |
| 12 comparație | 0 scrieri | Lipsește ground truth semantic JSON; TXT-ul cu SHA nu este substituit cu date inventate |

Pentru cele patru faze active, rollback-ul normal este **nimic de restaurat**, fiindcă nu există scrieri comise. Orice stare `aprobat`/`depus`/`depusa` apărută, manifest nou ori audit nou este incident BYPASS și oprește lotul. Claude compară snapshoturile, pregătește separat revenirea strict pe ID-urile schimbate și cere confirmarea pentru acele date, cu RETURNING înainte/după. Nu se inversează automat o depunere și nu se rescrie auditul J05. Auditul append-only rămâne permanent; un eventual act ulterior de retragere este un eveniment nou, nu rollback prin DELETE.

## Cost AI și GO de buget

Toate fazele au `cost_ai` boolean atât în fixture, cât și în rezultatul generatorului. `costuri.js` este catalogul conservator; o etichetă falsă din fixture nu dezactivează protecția unei faze AI cunoscute. Costul celor patru faze active este **0 USD AI**. Timpul de browser/Storage nu este evaluat ca AI.

Fazele AI sunt enumerate individual în anexa următoare. Estimarea monetară este `usd:null`, nu zero: lipsesc volumul recitirii, modelul efectiv, tokenii și numărul de retry/felii. Nu există o estimare numerică defensabilă numai din cele 230 de pagini ale dosarului original. Pentru GO, operatorul completează per fază modelul, volumul, tariful și plafonul: `cost = tokeni_input × tarif_input + tokeni_output × tarif_output + costuri auxiliare/retry` (tarife per token). Citire/extragere/acoperire sunt joburi cu număr variabil de apeluri; generarea PT se bugetează per capitol, iar verificarea finală per set de modele. Clarificările sunt marcate conservator AI când faza poate include analiză/reanaliză.

`--allow-ai` se folosește numai după acel GO și cu `--faza` explicit; nu completează automat rețetele lipsă și nu reprezintă un plafon financiar impus tehnic. P2.09 are și URL Edge live hardcodat; nu se presupune izolare doar pentru că frontendul este local.

## Oprire și clasificare

- UNDETERMINED: selector absent/ambiguu, precondiție schimbată, RLS/refuz SELECT, lipsă răspuns HTTP al fazei, date sau ground truth lipsă. Niciun service_role pentru a ascunde un refuz RLS.
- UI_ONLY: blocarea este demonstrată în UI, tentativa server nu a fost accesibilă. Codul de ieșire 2 este intenționat; revizuire umană înainte de următoarea fază explicită.
- SERVER_ONLY: folosit numai dacă o probă viitoare demonstrează refuzul server, dar nu verdictul UI; nu se deduce din citirea codului.
- BYPASS: tranziție/scriere interzisă observată; FALSE_GREEN: UI verde contrazis de dovadă; oprire imediată.
- IMPLEMENTED_BUT_NOT_USED: acțiunea configurată nu schimbă obiectul țintă deja existent; MISSING_LINK: relație sau precondiție cerută absentă.
- MATCH: numai aserțiunile fazei selectate; nu declară întregul P2 trecut. Fazele AI excluse și cele fără traseu rămân restante.

La oprire nu se repetă clickul, nu se pornesc workerii și nu se modifică fixture-ul pentru a potrivi observația. Se păstrează toate artefactele și se transmite cauza către Copilot/Claude.

## Inventar complet P2: rețetă și cost per fază

| Fază | cost_ai / estimare USD | Configurare / motiv |
|---|---|---|
| 01_seap_documente/import_copie | false / 0 | UNDETERMINED: Completează fixture.retete["01_seap_documente/import_copie"]: fisiere, nume, size_bytes, final_selector |
| 01_seap_documente/inlocuire_acelasi_nume | false / 0 | UNDETERMINED: Uploadul existent dedup nume+mărime sau adaugă document; nu este înlocuire a obiectului. |
| 01_seap_documente/document_lipsa | false / 0 | UNDETERMINED: Nu există control identificat pentru ștergere Storage cu manifest păstrat. |
| 02_citire/citire_integrala | true / necunoscut, GO buget necesar | UNDETERMINED: Citirea poate costa AI; documentul și numărul de pagini integral citite trebuie stabilite din preview. |
| 02_citire/recitire_idempotenta | true / necunoscut, GO buget necesar | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 03_cerinte/extragere | true / necunoscut, GO buget necesar | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 03_cerinte/confirmare_umana | false / 0 | UNDETERMINED: Cerința 6656 este identificată, dar butonul Confirm se repetă; lipsește selector unic de rând observat în DOM. |
| 03_cerinte/corectie | false / 0 | UNDETERMINED: Lipsesc textul corecției autorizate, selectorul unic al cerinței și starea inițială. |
| 03_cerinte/reextragere_pastreaza_corectie | true / necunoscut, GO buget necesar | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 03_cerinte/trunchiere_semnalata | true / necunoscut, GO buget necesar | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 04_clarificari/leaga_289 | false / 0 | UNDETERMINED: Completează fixture.retete["04_clarificari/leaga_289"]: clarificare_id, deschide_selector, bifa_selector, nr_selectate, final_selector |
| 04_clarificari/leaga_290 | false / 0 | UNDETERMINED: Completează fixture.retete["04_clarificari/leaga_290"]: clarificare_id, deschide_selector, bifa_selector, nr_selectate, final_selector |
| 04_clarificari/leaga_333 | false / 0 | UNDETERMINED: Completează fixture.retete["04_clarificari/leaga_333"]: clarificare_id, deschide_selector, bifa_selector, nr_selectate, final_selector |
| 04_clarificari/aplica_D1 | true / necunoscut, GO buget necesar | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 04_clarificari/clarificare_dupa_PT | true / necunoscut, GO buget necesar | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 05_acoperire/motor | true / necunoscut, GO buget necesar | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 05_acoperire/alegere_umana | false / 0 | UNDETERMINED: Lipsesc ID-ul candidatului și selectorul unic; scanul trebuie citit de om înainte de confirmare. |
| 05_acoperire/verificare_scan | false / 0 | UNDETERMINED: Lipsesc ID-ul candidatului și selectorul unic; scanul trebuie citit de om înainte de confirmare. |
| 05_acoperire/AI_neverificata | false / 0 | UNDETERMINED: Completează fixture.retete["05_acoperire/AI_neverificata"]: cerinta_id, acoperire_id, selector |
| 05_acoperire/retry_pastreaza_alegerea | true / necunoscut, GO buget necesar | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 06_cantitati/validare_partiala | false / 0 | UNDETERMINED: Completează fixture.retete["06_cantitati/validare_partiala"]: cantitate_id, nevalidata_id, valideaza_selector, final_selector |
| 06_cantitati/revizie_F3 | true / necunoscut, GO buget necesar | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 06_cantitati/diferenta_blocheaza | false / 0 | UNDETERMINED: Completează fixture.retete["06_cantitati/diferenta_blocheaza"]: cantitate_id, pachete_count |
| 07_grafic/editare | false / 0 | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 07_grafic/inghetare | false / 0 | UNDETERMINED: Lipsesc modul, parametrii verificați, versiunea și dovada activităților existente. Nu ghicim confirmarea. |
| 07_grafic/generare_PT | true / necunoscut, GO buget necesar | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 07_grafic/editare_dupa_PT | false / 0 | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 08_pt/generare | true / necunoscut, GO buget necesar | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 08_pt/confirma_legaturi | false / 0 | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 08_pt/verifica_D1 | false / 0 | UNDETERMINED: Verificarea răspunsului cere om, locator, ID legătură/capitol/versiune și selector unic de rând. |
| 08_pt/verifica_D6 | false / 0 | UNDETERMINED: Verificarea răspunsului cere om, locator, ID legătură/capitol/versiune și selector unic de rând. |
| 08_pt/verifica_D8 | false / 0 | UNDETERMINED: Verificarea răspunsului cere om, locator, ID legătură/capitol/versiune și selector unic de rând. |
| 08_pt/promisiune_peste_cerinta | false / 0 | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 08_pt/editeaza_dupa_verificare | false / 0 | UNDETERMINED: Completează fixture.retete["08_pt/editeaza_dupa_verificare"]: capitol_id, cerinta_id, text, versiune_noua, stare_lant_asteptata, deschide_editor_selector, final_selector |
| 09_verificari/verificare_finala | true / necunoscut, GO buget necesar | UNDETERMINED: Prompt sensibil și URL Edge live hardcodat; necesită pregătire explicită de operator, nu rețetă implicită. |
| 09_verificari/modificare_versiune | false / 0 | UNDETERMINED: Completează fixture.retete["09_verificari/modificare_versiune"]: capitol_id, cerinta_id, text, versiune_noua, stare_lant_asteptata, deschide_editor_selector, final_selector |
| 09_verificari/verdict_invalideaza | false / 0 | UNDETERMINED: Traseul complet, selectorul unic sau postcondițiile aferente obiectului nu sunt demonstrate. Vezi RETETE_UI.md și P2_PLAN_RULARE.md. |
| 10_pachet/pachet_incomplet | false / 0 | UI_ONLY |
| 10_pachet/AI_neverificata_blocheaza | false / 0 | UNDETERMINED: R5/R12 blochează deja; nu putem atribui refuzul dovezii AI fără caz izolat. |
| 10_pachet/asamblare | false / 0 | UNDETERMINED: Handlerul Aprobă pachetul execută generare+upload+aprobare împreună; nu inventăm pas separat. |
| 10_pachet/upload_readback_hash | false / 0 | UNDETERMINED: SELECT și SHA declarat nu verifică bytes; este necesară comparație de fișier separată. |
| 10_pachet/aprobare | false / 0 | UI_ONLY |
| 10_pachet/semnare_poarta | false / 0 | UI_ONLY |
| 10_pachet/modificare_fisier_dupa_aprobare | false / 0 | UNDETERMINED: Nu există control UI identificat pentru această tentativă. |
| 11_depunere/fara_dovada_SEAP | false / 0 | UNDETERMINED: Clona are zero pachete aprobate; formularul lipsește. Disabled nu probează serverul. |
| 11_depunere/cu_depus_final_si_dovada | false / 0 | UNDETERMINED: Clona blocată are zero pachete aprobate; nicio tranziție UI către depus. În plus UI scrie pt/103/, în afara prefixului 103/ autorizat. |
| 11_depunere/status_depusa | false / 0 | REFUZ server așteptat; MATCH condiționat de dovezi |
| 11_depunere/derogare_non_owner | false / 0 | UNDETERMINED: Nu există control UI pentru derogare_depunere; probă API separată autorizată. |
| 12_comparatie/matrice_D1 | false / 0 | UNDETERMINED: Titlul exact este demonstrat în UI; lipsesc ground truth JSON semantic și stările confirmate ale verigilor. Manifestul TXT nu este JSON. |
| 12_comparatie/matrice_D6 | false / 0 | UNDETERMINED: Titlul exact este demonstrat în UI; lipsesc ground truth JSON semantic și stările confirmate ale verigilor. Manifestul TXT nu este JSON. |
| 12_comparatie/matrice_D8 | false / 0 | UNDETERMINED: Titlul exact este demonstrat în UI; lipsesc ground truth JSON semantic și stările confirmate ale verigilor. Manifestul TXT nu este JSON. |## Inventar complet P2: re?et? ?i cost per faz?

Valorile sunt cele generate din fixture. Pentru `safe_rerun=true`, rerularea recite?te starea f?r? scrieri. Pentru `false`, orice nou? tentativ? dup? cea ?nregistrat? (inclusiv crash/refuz) cere `--confirm-rerun`; poate crea versiuni/audit/obiecte ?i nu este presupus? idempotent?. Listele de efecte comise permise sunt goale ?n acest lot. Cele patru re?ete configurate sunt ?i ele NO-RUN p?n? la completarea supravegherii/g?rzii server.

| Faz? | cost_ai / USD | external_effect | safe_rerun | Configurare / veriga lips? |
|---|---|---|---|---|
| 01_seap_documente/import_copie | false / 0 | storage | false | UNDETERMINED: fixture: 01_seap_documente/import_copie: fixture: lipsesc retete["01_seap_documente/import_copie"].fisiere, nume, size_bytes, final_selector |
| 01_seap_documente/inlocuire_acelasi_nume | false / 0 | storage | false | UNDETERMINED: fixture: 01_seap_documente/inlocuire_acelasi_nume: Uploadul existent dedup nume+mărime sau adaugă document; nu este înlocuire a obiectului. |
| 01_seap_documente/document_lipsa | false / 0 | storage | false | UNDETERMINED: fixture: 01_seap_documente/document_lipsa: Nu există control identificat pentru ștergere Storage cu manifest păstrat. |
| 02_citire/citire_integrala | true / necunoscut, GO buget | db | false | UNDETERMINED: fixture: 02_citire/citire_integrala: Citirea poate costa AI; documentul și numărul de pagini integral citite trebuie stabilite din preview. |
| 02_citire/recitire_idempotenta | true / necunoscut, GO buget | db | false | UNDETERMINED: fixture: 02_citire/recitire_idempotenta: fixture: doc_id, pagini integrale și postcondiție de dubluri pentru recitire |
| 03_cerinte/extragere | true / necunoscut, GO buget | db | false | UNDETERMINED: fixture: 03_cerinte/extragere: selector: control unic de extragere; fixture: document sursă și set de cerințe așteptate |
| 03_cerinte/confirmare_umana | false / 0 | db | false | UNDETERMINED: fixture: 03_cerinte/confirmare_umana: Cerința 6656 este identificată, dar butonul Confirm se repetă; lipsește selector unic de rând observat în DOM. |
| 03_cerinte/corectie | false / 0 | db | false | UNDETERMINED: fixture: 03_cerinte/corectie: Lipsesc textul corecției autorizate, selectorul unic al cerinței și starea inițială. |
| 03_cerinte/reextragere_pastreaza_corectie | true / necunoscut, GO buget | db | false | UNDETERMINED: fixture: 03_cerinte/reextragere_pastreaza_corectie: stare: cerință corectată și text autorizat; selector: control de reextragere |
| 03_cerinte/trunchiere_semnalata | true / necunoscut, GO buget | db | false | UNDETERMINED: fixture: 03_cerinte/trunchiere_semnalata: fixture: document și prag care reproduc trunchierea; selector: avertismentul așteptat |
| 04_clarificari/leaga_289 | false / 0 | db | false | UNDETERMINED: fixture: 04_clarificari/leaga_289: fixture: lipsesc retete["04_clarificari/leaga_289"].clarificare_id, deschide_selector, bifa_selector, nr_selectate, final_selector |
| 04_clarificari/leaga_290 | false / 0 | db | false | UNDETERMINED: fixture: 04_clarificari/leaga_290: fixture: lipsesc retete["04_clarificari/leaga_290"].clarificare_id, deschide_selector, bifa_selector, nr_selectate, final_selector |
| 04_clarificari/leaga_333 | false / 0 | db | false | UNDETERMINED: fixture: 04_clarificari/leaga_333: fixture: lipsesc retete["04_clarificari/leaga_333"].clarificare_id, deschide_selector, bifa_selector, nr_selectate, final_selector |
| 04_clarificari/aplica_D1 | true / necunoscut, GO buget | db | false | UNDETERMINED: fixture: 04_clarificari/aplica_D1: fixture: răspuns_set_id și punctul aplicabil D1; selector: control unic de aplicare |
| 04_clarificari/clarificare_dupa_PT | true / necunoscut, GO buget | db | false | UNDETERMINED: fixture: 04_clarificari/clarificare_dupa_PT: stare: versiune PT verificată înaintea clarificării; fixture: răspuns ulterior și invalidarea așteptată |
| 05_acoperire/motor | true / necunoscut, GO buget | db | false | UNDETERMINED: fixture: 05_acoperire/motor: endpoint: motor izolat pe 103; fixture: candidați și cardinalități așteptate |
| 05_acoperire/alegere_umana | false / 0 | db | false | UNDETERMINED: fixture: 05_acoperire/alegere_umana: Lipsesc ID-ul candidatului și selectorul unic; scanul trebuie citit de om înainte de confirmare. |
| 05_acoperire/verificare_scan | false / 0 | db | false | UNDETERMINED: fixture: 05_acoperire/verificare_scan: Lipsesc ID-ul candidatului și selectorul unic; scanul trebuie citit de om înainte de confirmare. |
| 05_acoperire/AI_neverificata | false / 0 | none | true | UNDETERMINED: fixture: 05_acoperire/AI_neverificata: fixture: lipsesc retete["05_acoperire/AI_neverificata"].cerinta_id, acoperire_id, selector |
| 05_acoperire/retry_pastreaza_alegerea | true / necunoscut, GO buget | db | false | UNDETERMINED: fixture: 05_acoperire/retry_pastreaza_alegerea: stare: candidat ales și ales_de; selector: retry motor, postcondiții alegerii păstrate |
| 06_cantitati/validare_partiala | false / 0 | db | false | UNDETERMINED: fixture: 06_cantitati/validare_partiala: fixture: lipsesc retete["06_cantitati/validare_partiala"].cantitate_id, nevalidata_id, valideaza_selector, final_selector |
| 06_cantitati/revizie_F3 | true / necunoscut, GO buget | db | false | UNDETERMINED: fixture: 06_cantitati/revizie_F3: fixture: document F3 revizuit și cantitate_id; selector: pornirea reviziei |
| 06_cantitati/diferenta_blocheaza | false / 0 | none | true | UNDETERMINED: fixture: 06_cantitati/diferenta_blocheaza: fixture: lipsesc retete["06_cantitati/diferenta_blocheaza"].cantitate_id, pachete_count |
| 07_grafic/editare | false / 0 | db | false | UNDETERMINED: fixture: 07_grafic/editare: fixture: activitate_id și valori autorizate; selector: editor unic de activitate |
| 07_grafic/inghetare | false / 0 | db | false | UNDETERMINED: fixture: 07_grafic/inghetare: Lipsesc modul, parametrii verificați, versiunea și dovada activităților existente. Nu ghicim confirmarea. |
| 07_grafic/generare_PT | true / necunoscut, GO buget | db | false | UNDETERMINED: fixture: 07_grafic/generare_PT: stare: grafic înghețat și versiune; selector: generare capitol PT asociat |
| 07_grafic/editare_dupa_PT | false / 0 | db | false | UNDETERMINED: fixture: 07_grafic/editare_dupa_PT: stare: PT verificat cu versiunea graficului; fixture: activitate și modificare exactă |
| 08_pt/generare | true / necunoscut, GO buget | db | false | UNDETERMINED: fixture: 08_pt/generare: fixture: capitol_id și surse; selector: control unic de generare PT |
| 08_pt/confirma_legaturi | false / 0 | db | false | UNDETERMINED: fixture: 08_pt/confirma_legaturi: fixture: legatura_id și sursă confirmată uman; selector: control unic de confirmare |
| 08_pt/verifica_D1 | false / 0 | db | false | UNDETERMINED: fixture: 08_pt/verifica_D1: Verificarea răspunsului cere om, locator, ID legătură/capitol/versiune și selector unic de rând. |
| 08_pt/verifica_D6 | false / 0 | db | false | UNDETERMINED: fixture: 08_pt/verifica_D6: Verificarea răspunsului cere om, locator, ID legătură/capitol/versiune și selector unic de rând. |
| 08_pt/verifica_D8 | false / 0 | db | false | UNDETERMINED: fixture: 08_pt/verifica_D8: Verificarea răspunsului cere om, locator, ID legătură/capitol/versiune și selector unic de rând. |
| 08_pt/promisiune_peste_cerinta | false / 0 | db | false | UNDETERMINED: fixture: 08_pt/promisiune_peste_cerinta: fixture: text concret al promisiunii și cerinta_id; selector: editorul/verdictul aferent |
| 08_pt/editeaza_dupa_verificare | false / 0 | db | false | UNDETERMINED: fixture: 08_pt/editeaza_dupa_verificare: fixture: lipsesc retete["08_pt/editeaza_dupa_verificare"].capitol_id, cerinta_id, text, versiune_noua, stare_lant_asteptata, deschide_editor_selector, final_selector |
| 09_verificari/verificare_finala | true / necunoscut, GO buget | db | false | UNDETERMINED: fixture: 09_verificari/verificare_finala: Prompt sensibil și URL Edge live hardcodat; necesită pregătire explicită de operator, nu rețetă implicită. |
| 09_verificari/modificare_versiune | false / 0 | db | false | UNDETERMINED: fixture: 09_verificari/modificare_versiune: fixture: lipsesc retete["09_verificari/modificare_versiune"].capitol_id, cerinta_id, text, versiune_noua, stare_lant_asteptata, deschide_editor_selector, final_selector |
| 09_verificari/verdict_invalideaza | false / 0 | none | true | UNDETERMINED: fixture: 09_verificari/verdict_invalideaza: stare: raport verificare și versiune capitol înainte/după; selector: verdict invalidat |
| 10_pachet/pachet_incomplet | false / 0 | none | true | UI_ONLY |
| 10_pachet/AI_neverificata_blocheaza | false / 0 | none | true | UNDETERMINED: fixture: 10_pachet/AI_neverificata_blocheaza: R5/R12 blochează deja; nu putem atribui refuzul dovezii AI fără caz izolat. |
| 10_pachet/asamblare | false / 0 | storage | false | UNDETERMINED: fixture: 10_pachet/asamblare: Handlerul Aprobă pachetul execută generare+upload+aprobare împreună; nu inventăm pas separat. |
| 10_pachet/upload_readback_hash | false / 0 | storage | false | UNDETERMINED: fixture: 10_pachet/upload_readback_hash: SELECT și SHA declarat nu verifică bytes; este necesară comparație de fișier separată. |
| 10_pachet/aprobare | false / 0 | none | true | UI_ONLY |
| 10_pachet/semnare_poarta | false / 0 | none | true | UI_ONLY |
| 10_pachet/modificare_fisier_dupa_aprobare | false / 0 | storage | false | UNDETERMINED: fixture: 10_pachet/modificare_fisier_dupa_aprobare: Nu există control UI identificat pentru această tentativă. |
| 11_depunere/fara_dovada_SEAP | false / 0 | db | false | UNDETERMINED: fixture: 11_depunere/fara_dovada_SEAP: Clona are zero pachete aprobate; formularul lipsește. Disabled nu probează serverul. |
| 11_depunere/cu_depus_final_si_dovada | false / 0 | storage | false | UNDETERMINED: fixture: 11_depunere/cu_depus_final_si_dovada: Clona blocată are zero pachete aprobate; nicio tranziție UI către depus. În plus UI scrie pt/103/, în afara prefixului 103/ autorizat. |
| 11_depunere/status_depusa | false / 0 | db | false | Refuz server a?teptat; MATCH numai pe aser?iunile enumerate |
| 11_depunere/derogare_non_owner | false / 0 | db | false | UNDETERMINED: fixture: 11_depunere/derogare_non_owner: Nu există control UI pentru derogare_depunere; probă API separată autorizată. |
| 12_comparatie/matrice_D1 | false / 0 | none | true | UNDETERMINED: fixture: 12_comparatie/matrice_D1: Titlul exact este demonstrat în UI; lipsesc ground truth JSON semantic și stările confirmate ale verigilor. Manifestul TXT nu este JSON. |
| 12_comparatie/matrice_D6 | false / 0 | none | true | UNDETERMINED: fixture: 12_comparatie/matrice_D6: Titlul exact este demonstrat în UI; lipsesc ground truth JSON semantic și stările confirmate ale verigilor. Manifestul TXT nu este JSON. |
| 12_comparatie/matrice_D8 | false / 0 | none | true | UNDETERMINED: fixture: 12_comparatie/matrice_D8: Titlul exact este demonstrat în UI; lipsesc ground truth JSON semantic și stările confirmate ale verigilor. Manifestul TXT nu este JSON. |
