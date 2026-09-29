# P2 / J06 — plan de rulare pe clona 103

Pregătire locală, 29.09.2026. Nicio conexiune Supabase/CDP și nicio rulare AI efectuată în această sarcină. Claude execută `--apply` după GO Copilot. Nu se folosește service_role. Nu se elimină blocajele clonei pentru a obține verde.

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
| 12_comparatie/matrice_D8 | false / 0 | UNDETERMINED: Titlul exact este demonstrat în UI; lipsesc ground truth JSON semantic și stările confirmate ale verigilor. Manifestul TXT nu este JSON. |
