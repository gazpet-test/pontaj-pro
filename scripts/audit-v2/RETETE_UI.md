# Rețete UI pentru Audit V2

**J06b:** rețetele sunt pregătite, nu autorizate pentru live. Runnerul cere T0 complet și supraveghere/gardă server activă, încă fără endpoint implementat aici. Fiecare fază are `external_effect`, `safe_rerun`, comportament de rerulare și liste de scrieri comise permise. Cele patru probe negative permit zero scrieri; lipsa providerului, a accesului brut la Storage sau a unei verigi concrete produce UNDETERMINED, fără workaround. Vezi [contractul actual](../../docs/AUDIT_OFERTARE_V2/P2_PLAN_RULARE.md).

**Actualizare J06, 29.09.2026:** configurația operabilă pentru clona 103 este în [P2_PLAN_RULARE.md](../../docs/AUDIT_OFERTARE_V2/P2_PLAN_RULARE.md). Are patru faze configurate și 47 UNDETERMINED. Exemplele de mai jos pentru aprobare/depunere reușită descriu fluxul istoric și NU se execută pe clona cu R5/R12 active. Rețetele 10 observă blocarea cu verdict UI_ONLY; 11/status_depusa cere PATCH respins, toast exact, seturi BD neschimbate și audit J05 neschimbat. Fazele AI sunt excluse implicit, inclusiv la `--faza`. TXT-ul ground truth nu este JSON. Testele actuale sunt `node --test scripts/audit-v2/*.test.*` (în sandbox Windows: `--test-isolation=none`).

28.09.2026. Ghid pentru completarea `fixture.scenarii[pas]`, nu scenarii pretins executate. Sursele citate sunt cele locale. ID-urile clonei și mapările 289/290/333 → documentele clonei vin din rezultatul clonării; **289/290/333 și licitația 5 nu sunt ținte de scriere**.

`text=` este potrivire exactă după normalizarea spațiilor în driver, nu căutare parțială. `css=` folosește atribute existente. Textele dinamice se completează cu numărul efectiv afișat. Un selector trebuie să aibă exact un rezultat în panoul deschis; `key={id}` din React NU creează atribut HTML. În lipsa unui identificator de rând, se înregistrează selectorul observat în DOM după filtrare, nu se ghicește `data-id` și nu se folosește arbitrar primul buton „✓”.

Operatorul deschide fișa clonei înaintea rulării. Pentru fiecare fază: precondiția este rândul `ofertare_licitatii.id=L,nr_anunt=SANDBOX-V2-…`; `D1/D6/D8` trebuie să aparțină lui L. Fișa vizibilă trebuie să fie chiar clona. Prezența textului clonei în lista de fundal singură nu dovedește identitatea modalului activ.

Runnerul verifică implicit antetul exact `🏛 nr_anunt`. Pentru PT, Cantități și Clarificări, `context_ui` configurat pe scenariu sau fază folosește tipul `select`, un selector existent și verifică `value === L`. Identitatea contextului UI nu autorizează apelurile către backendul live hardcodat.

## Convenția aserțiunilor

Exemplele sunt forme reale acceptate de `asertiuni.js`; înlocuiește valorile simbolice înainte de JSON:

```json
{"tip":"exists","tabela":"ofertare_licitatii","where":{"id":12345},"asteptat":{"nr_anunt":"SANDBOX-V2-DOMNESTI"}}
{"tip":"exists","tabela":"ofertare_clarificari","where":{"id":45678},"asteptat":{"raspuns_document_id":98765,"status":"raspunsa"},"la_esec":"MISSING_LINK"}
{"tip":"unchanged","tabela":"ofertare_acoperire","where":{"id":45678},"camp":"ales_de","la_esec":"BYPASS"}
{"tip":"chain","cerinta_id":45678,"veriga":5,"stare":"veche","la_esec":"FALSE_GREEN"}
```

`exists/all` au egalitate exactă, nu operatori SQL; nu inventa `notNull`, comparații între coloane sau creștere relativă. Pentru un UUID/timestamp nou observat, există `changed` pe câmp; aceasta nu dovedește singură că noul actor este actorul corect. Pentru versiune/număr de rânduri, calculează valoarea exactă așteptată din preview. `all` pe zero rânduri e fals. `unchanged` cere rânduri pe ambele părți; pentru tabel gol înainte/după folosește `count=0`.

Un MATCH înseamnă numai că aserțiunile enumerate au trecut. `changed` pe `updated_at` nu dovedește păstrarea conținutului, idempotența sau validitatea dovezii. Probează separat câmpurile relevante și inventarul ID-urilor. Pentru refuzuri, cere atât dovada tentativei/refuzului în UI/jurnal, cât și read-back fără schimbare.

## 01_seap_documente

**Faze:** `import_copie`, `inlocuire_acelasi_nume`, `document_lipsa`.

UI: deschide tabul `📥 Documentație (N)` (`src/OfertareLicitatii.jsx:3535`). Upload: `css=input[type="file"][multiple]:not([webkitdirectory])` în acest tab, derivat din :1379, sau `css=input[type="file"][webkitdirectory]` pentru folder (:1365). Inputurile sunt `display:none`; driverul final are resolver dedicat pentru upload ascuns, cu unicitate obligatorie. `text=⬇️ Adu din SEAP` există la :1360, însă clona are `link_seap/c_notice_id=NULL`; nu adăuga identificatori SEAP doar ca să pornească testul fără un GO separat pentru acel flux.

Pre: documentele/copii și mărimile sunt cunoscute; toate căile țintă sunt ale clonei. Post import: `ofertare_documente_atribuire` are rândul cu `licitatie_id=L`, `nume_original`, `size_bytes`, `fisier_path`; `status_procesare='neprocesat'` pentru PDF valid. Veriga 1 nu devine ok dacă `ofertare_seap_manifest` lipsește. Manifestul are `document_id,sha256,stare,verificat_la`, nu `sursa_document_id` (`20260924_seap_p0_pas2_manifest_completitudine.sql:24`).

Înlocuire: pregătește două fișiere locale diferite cu același nume; prima variantă aceeași mărime, a doua mărime diferită. La :820–825 deduplicarea este `nume|mărime`: bytes diferiți cu aceeași mărime sunt săriți, iar mărime diferită creează rând nou (:843), nu suprascriere. Aserțiunile trebuie să consemneze comportamentul real; `unchanged` nu este automat succes al integrității. UI nu oferă aici buton de înlocuire directă a obiectului existent.

Document lipsă: nu a fost identificat control UI pentru ștergerea obiectului din Storage păstrând manifestul. Faza rămâne `UNDETERMINED` până când există un fixture lipsă pregătit explicit în sandbox ori o cale UI demonstrată. Nu substitui DELETE SQL. Uploadurile UI folosesc `L/atribuire/...` (:829); copia inițială este `sandbox-v2/5/...`. Ambele trebuie incluse în inventarul pentru rollback.

## 02_citire

**Faze:** `citire_integrala`, `recitire_idempotenta`.

UI: `text=☁️ Pe server` (:1393), disponibil numai dacă există documente eligibile, contul poate porni procesarea și coada nu este activă. Alternativ `text=🤖 Procesează (N)` (:1388) citește prin browser și nu probează restartul workerului. `text=⏹ Oprește serverul` (:1397) oprește coada, nu repornește containerul.

Pre: `ofertare_documente_atribuire` are documentul ales cu stare eligibilă; coada nu este activă. Post pornire: `ofertare_ingest_coada.licitatie_id=L,activ=true,cerut_de=<actor>`; la terminare `activ=false,terminat_la` și documentele au `status_procesare,pagini,pagini_procesate,analiza`. `partial` nu se echivalează cu citire completă, iar un simplu mesaj „terminată” nu dovedește toate paginile. Post retry: aceleași ID-uri, fără dubluri, conținut/locatori păstrați; folosește count pe fiecare document și unchanged pe câmpurile stabile, nu pe timestampurile de procesare.

Limită: pentru document deja citit integral, butonul global poate lipsi; nu există în această rețetă selector pentru forțarea relecturii tuturor documentelor. O fază configurată doar cu `asteapta` nu demonstrează retry. Așteptarea trebuie să vizeze finalul real, nu un text permanent al paginii.

## 03_cerinte

**Faze:** `extragere`, `confirmare_umana`, `corectie`, `reextragere_pastreaza_corectie`, `trunchiere_semnalata`.

UI: în Cerințe, `text=🤖 Re-extrage (Opus)` dacă există cerințe, altfel `text=🤖 Extrage cerințele (Opus)` (:2299). Dialogul de la :2011 precizează ștergerea celor neconfirmate; poate exista întâi confirmarea corpusului incomplet (:2009). Confirmare pe rând: `css=button[title="Confirm"]` (:2191); corectare: `css=button[title="Corectez"]` (:2192). Ambele se repetă pe rânduri și cer filtrare/selector ancorat observat în DOM pentru C. `text=💾 Salvează corecția` (:2251), `css=input[placeholder="secțiune"]` (:2246), `css=input[placeholder="document probant"]` (:2250); textarea textului nu are identificator stabil per cerință.

Pre: C din clonă, sursa și pasajul citite; pentru confirmare actor uman cunoscut. Post: `confirmata_de` este actorul așteptat; `text_cerinta` este textul exact corectat, iar corectarea este confirmată de actor (`extras_de_ai=false`); nu presupune incrementarea `cerinte.versiune`: handlerul :2073 nu o scrie și triggerul R08 invalidează legăturile, în timp ce versionarea capitolului este separată; `sursa_document_id/sursa_pagina/sursa_pasaj` păstrate după re-extragere, fără înlocuire tăcută a C. Pentru `trunchiere_semnalata`, corpusul trebuie să conțină deliberat pasajul lung, iar textul/pasajul și diagnosticul se confruntă; numărul de cerințe singur nu demonstrează absența trunchierii. Dacă fixture-ul nu conține cazul, verdict `UNDETERMINED`.

## 04_clarificari

**Faze:** `leaga_289`, `leaga_290`, `leaga_333`, `aplica_D1`, `clarificare_dupa_PT`.

UI: pagina Clarificări are `css=select[title="Licitația de lucru"]` (`src/OfertareClarificari.jsx:402`), valoarea L; după schimbare verifică din nou clona. Fiecare document răspuns are butonul `text=🔗 La ce întrebări răspunde?` (:455), urmat de bife și `text=🔗 Leagă (N)` (:501). Butoanele se repetă; nu deduce selectorul documentului din vechiul ID. Alternativ, selectul răspunsului în întrebarea Q apare la :616 și opțiunile au value=ID document clonat (:627); nu are title/id propriu, deci necesită ancorare de DOM. Legarea multiplă scrie `raspuns_document_id` și `status='raspunsa'` (:383).

Impact D1: `text=📋 Analizează impactul în registru` (:645) deschide Documente cu documentul bifat; `text=🔍 Analizează impactul (1)` în `OfertareLicitatii.jsx:1354`; selectează numai operațiile D1 verificate; `text=✅ Aplică cele N selectate` (:1714). Nu folosi „Selectează toate” pentru fixture-uri D6/D8 nesoluționate.

Pre: trei documente răspuns clonate, întrebările și C cunoscute, PT existent înainte de ultima fază. Post legare: rândurile Q au documentul corect/status răspunsă; asta NU înseamnă rezolvat. `ofertare_clarificari_puncte`: `clarificare_id,cerinta_id,rezolutie,document_rezolutie_id,rezolvat_de,rezolvat_la`; rezoluția este separată (`20260928l...sql:6`). Editorul punctelor are `css=input[placeholder="cerința #"]`, :67 în `OfertareClarificariPuncte.jsx`, și selectul cu title `Documentul care a rezolvat efectiv punctul (poate fi altul decât răspunsul la clarificare)` (:73). Post aplicare: C veche are `inlocuita_de=Cnou`, noua cerință păstrează `raspuns_set_id`, iar legăturile PT afectate nu rămân verificate la versiune greșită. Ciclul `inlocuita_de` sau ținta absentă → `UNDETERMINED`.

Întrebare nouă: `text=＋ întrebare` (:519), `css=textarea[placeholder="Textul întrebării..."]` (:553); salvarea este onBlur, deci după `scrie` fă click pe un titlu unic pentru blur. Nu trimite întrebarea în exterior; testul cere apariția în dosar și invalidarea dependentelor.

## 05_acoperire

**Faze:** `motor`, `alegere_umana`, `verificare_scan`, `AI_neverificata`, `retry_pastreaza_alegerea`.

UI motor: `text=☁️ Propune acoperiri (Opus, pe server)` (`OfertareLicitatii.jsx:2825`). Alegerea cu semnătură se face în `text=🔗 Cerință ↔ dovadă` (:3532); `OfertareCerinte.jsx:506` are `css=button[title="Alege varianta asta în locul celei curente"]`, text `alege`. Repetat pe candidați; ancorează explicit C și candidatul din DOM. Acesta apelează `fn_ofertare_alege_acoperire` (:223), nu confunda cu butonul generic „Alege” din catalogul vechi.

Verificarea pe scan în Cerințe & acoperire: titlul `Verificat pe scan (R1) — copiază scanul autorizației` (`OfertareLicitatii.jsx:2921`), numai dacă autorizația are scan; citește efectiv scanul înainte de click. Dacă D6/D8 folosește alt tip de dovadă fără acest control, nu declara verificare făcută doar fiindcă există un status verde.

Pre: ID-urile tuturor candidaților C, alegerea inițială și scanul cunoscute. Post motor: candidați propuși, nu alegere umană inventată; post alegere: exact un `ales=true`, `ales_de=<actor>`; post scan: `verificat_pe_scan=true`, `verificat_de`, `verificat_la`, `fisier_path`, `reverificare_ceruta=false` dacă s-a reverificat explicit. AI neverificată: păstrează un candidat `verificat_pe_scan=false` și verifică lanț veriga 3 `propusa`; retry trebuie să păstreze `ales`, `ales_de` și conținutul dovezii aprobate, nu doar ID-ul.

## 06_cantitati

**Faze:** `validare_partiala`, `revizie_F3`, `diferenta_blocheaza`.

UI: `text=🤖 Extrage din documentație` (`OfertareCantitati.jsx:208`; la reluare textul conține felia). Validare rând: `css=button[title="Validează — ai verificat cifra; abia atunci intră ca aprobată în grafic și în poarta propunerii"]` (:238), repetat pe rânduri. Cantitate: `css=input[type="number"][placeholder="?"]` (:233), tot repetat; ancoră DOM după cod/denumire, fără index presupus. `scrie` nu declanșează onBlur: mută focusul prin click după editare.

Pre: Q1/Q2 din L, Q1 verificată vizual, Q2 deliberat nevalidată; lista F3 revizuită este o copie în dosarul clonei. Post validare: Q1.status=`validat`, Q2 rămâne `extras`; păstrează cifra exactă. Post re-extragere revizie: valoarea veche nu se suprascrie, Q1.status=`diferenta`, `diferenta_nota` prezintă revizia. Blocarea finală: încearcă aprobare PT numai în clonă și citește `ofertare_pt_pachet` neschimbat; `ofertare_r5_blocaj_sursa` este funcție, nu tabel și nu intră în verificatorul SELECT-only. Pentru această probă contractul trebuie să citească pachetele/poarta, nu numai cantitățile.

## 07_grafic

**Faze:** `editare`, `inghetare`, `generare_PT`, `editare_dupa_PT`.

UI: `text=💾 Salvează graficul` (`GraficLucrare.jsx:227`), `text=＋ Activitate` (:226). În poarta graficului: `text=💾 Salvează parametrii` (`GraficPoarta.jsx:373`), `text=⚙️ Generează grafic (ofertă)` sau `(intern)` (:372). Inputul `css=input[placeholder="ex: 3FS, 7SS+10"]` este existent (:296 în GraficLucrare), dar se repetă pe activități. Fronturile au placeholder `localitate / tronson`, `m`, `Dn` (`GraficPoarta.jsx:432`–434), iar identificarea frontului este manuală/DOM.

Pre: date suficiente pentru poarta graficului, fronturi derivate din cantități validate. Post salvare: `grafic_activitati` are editarea; post îngheț: un rând nou `grafic_versiuni` cu `versiune,mod,generat_de,durata_zile,snapshot.parametri,activitati` (scriere :313). „Salvează graficul” nu este sinonim cu „îngheață versiune”. Post PT: capitolul generat și sursa utilizată se citesc; post editare: vechiul snapshot din `grafic_versiuni` trebuie neschimbat, iar PT/pachetul trebuie să semnalizeze depășirea. Contractul are nevoie de `ofertare_pt_capitole` și `ofertare_pt_pachet` pentru a demonstra această ultimă relație.

## 08_pt

**Faze:** `generare`, `confirma_legaturi`, `verifica_D1`, `verifica_D6`, `verifica_D8`, `promisiune_peste_cerinta`, `editeaza_dupa_verificare`.

UI: `text=📑 Deschide matricea propunerii` (`OfertarePropunere.jsx:702`); pe capitolul țintă `text=✎ text` (:592), apoi `text=🤖 Generează din cerințe` (:620). Un capitol fără cerințe sau blocat are buton disabled. Promptul pentru instrucțiune e la :1594. Editare: `text=✎ Modifică textul` (:609), `css=textarea[placeholder="Textul capitolului, așa cum intră în propunere."]` (`OfertareRevizii.jsx:166`), `text=Salvează (versiune nouă)` (:172).

Verificare C: `css=button[title="Am citit răspunsul din capitol și satisface cerința"]` (:452), cere răspuns la `window.prompt` pentru locator (:1752). Dovada: `css=button[title="Leagă o dovadă (document + pagină)"]` (:454), două prompturi — numărul documentului din lista afișată și locator (:1787–1790). Blocare promisiune nejustificată: `css=button[title="Răspunsul NU satisface cerința — scrie de ce"]` (:456), prompt de constatare (:1769). Toate se repetă; ținta este C și capitolul ei, nu primul rezultat.

Pre: legături pentru D1/D6/D8, capitolele și sursele corecte. Post generare: conținut și proveniență AI; post verificare: `ofertare_pt_legaturi.stare='verificata'`, `confirmat_de`, `confirmat_la`, `locator_raspuns`, `verificat_la_versiunea=capitol.versiune`. Dovezile au `legatura_id,document_id,locator_local,pagina_locala,pagina_globala` unde câmpul există; nu presupune că locator text generează automat pagina globală. După editare: versiune capitol schimbată și verificarea veche nu este ok (lanț 5 `veche/propusa`, după invalidarea reală). Aserțiunea de paritate dintre coloane necesită valori citite sau `chain`, nu câmp inventat.

## 09_verificari

**Faze:** `verificare_finala`, `modificare_versiune`, `verdict_invalideaza`.

UI: `text=🔍 Verificare finală` în fișă (`OfertareLicitatii.jsx:3557`), apoi `text=🔍 Rulează verificarea` sau `text=🔁 Rulează din nou` (:4668). Există un prompt de parolă la :4640; valoarea nu se pune în fixture, raport sau jurnal. Operatorul completează în sesiunea autorizată; driverul final acceptă prompt prin `confirma.text` sau `confirma.prompt_env`.

**Limită critică de mediu:** apelul de la :4646 are URL-ul Edge live hardcodat. Un browser deschis pe localhost/preview nu garantează că această funcție va folosi backend local. Nu rula această fază într-un mediu presupus local fără verificarea destinației; sarcina curentă nu autorizează apel live.

Pre: niciun job concurent de verificare; setul exact de cerințe/versiuni fotografiat. Post: nou `ofertare_verificari` cu `licitatie_id,verdict,raport,modele,rulat_de,created_at`. Schema/insertul curent nu scrie amprentă explicită a capitolelor (`ofertare-verificare-finala/index.ts:135`). Editează capitolul prin rețeta 08 și probează dacă verdictul este marcat vechi. Dacă rândul/eticheta rămân aceleași, raportează `MISSING_LINK/FALSE_GREEN`, nu configura așteptarea astfel încât simpla păstrare a verdictului să treacă. Contractul trebuie să citească și capitolele.

## 10_pachet

**Faze:** `pachet_incomplet`, `AI_neverificata_blocheaza`, `asamblare`, `upload_readback_hash`, `aprobare`, `semnare_poarta`, `modificare_fisier_dupa_aprobare`.

UI: `text=🔏 Aprobă pachetul` (`OfertarePropunere.jsx:2084`), apoi confirmare explicită (:1815); `text=📦 Semnează verdictul porții` (:2089). Prima acțiune generează PT și borderou, urcă, inserează manifest și aprobă în același handler (:1811–1868). **Nu există butoane UI separate „asamblare” → „upload/readback/hash” → „aprobare”** pentru acest flux. Faze separate trebuie să observe aceeași operație fără repetarea artificială a aprobării, ori să rămână indisponibile.

Pre: anexele așteptate, capitolele și toate rezervele cunoscute; un caz negativ cu dovadă AI neverificată. Post: `ofertare_pt_pachet.stare,versiune,aprobat_de,aprobat_la,grafic_versiune,pt_poarta_id`; manifestul `pachet_id,rol,nume,sha256,size_bytes,fisier_path,sursa_versiune`; poarta `licitatie_id,versiune,verdict,snapshot`. Hash bine format nu dovedește read-back server. Jurnalul poate arăta download-ul din browser; BD nu certifică bytes. Veriga 7 rămâne nedeterminată fără comparație independentă a conținutului.

Tentativa de modificare a unui fișier deja aprobat nu are control în UI identificat. Nu substitui script de Storage/SQL în runnerul UI. Poți documenta butonul absent și cere test separat autorizat de API pe sandbox. Protecția se verifică și la `aprobat→propus`, vezi opinia white-box; simpla absență a unui buton nu demonstrează poarta server.

## 11_depunere

**Faze:** `fara_dovada_SEAP`, `cu_depus_final_si_dovada`, `status_depusa`, `derogare_non_owner`.

UI pachet aprobat: `css=input[type="file"][multiple]` pentru finale și `css=input[type="file"]:not([multiple])` pentru dovadă, **numai când este deschis un singur formular de pachet** (`OfertarePropunere.jsx:675`–676). Dacă există mai multe pachete aprobate, selectorul este ambiguu; identifică P în DOM, nu lua primul. `text=Înregistrează depunerea` (:677). Fără dovadă, butonul e disabled; asta demonstrează doar UI. Post cu ambele: manifestul are cel puțin un `depus_final` și un `dovada_seap`, iar P.stare=`depus`, `depus_la` completat.

Status licitație: tab `text=📝 Detalii & decizie` (:3538), `text=📮 Marchează Depusă` (:3660 cu mapping :56), disponibil din `in_lucru`. Înainte încearcă pe clonă fără pachet depus; dacă `status` trece, clasifică BYPASS pentru legătura cerută de plan. Apoi probează cu artefactele reale din sandbox. Nu reseta statusul prin SQL în acest harness.

Derogare: nu s-a găsit control UI pentru setarea `derogare_depunere`; `derogare_non_owner` nu se poate demonstra prin simplu click pe „Marchează Depusă”. Necesită probă API separată cu JWT non-owner, autorizată pentru sandbox. Absența UI se raportează `UNDETERMINED`, nu MATCH pe securitatea server.

## 12_comparatie

**Faze:** `matrice_D1`, `matrice_D6`, `matrice_D8`; readOnly.

Panoul existent are `css=aside[aria-label="Lanțul dovezii"]` și titlu exact `text=🔗 Lanțul dovezii · cerința #C` (`OfertareLantProbator.jsx:51`–53). Operatorul îl deschide înaintea fazei; contractul readOnly acceptă numai `asteapta` și `observa`, deci nu poate deschide automat alte trei cerințe prin click în interiorul acestei rulări. Nu completa trei faze cu aceeași cerință vizibilă.

Pre: ground truth exact, fișier și hash, pagina pentru fiecare D1/D6/D8. Post: fiecare verigă este comparată cu cerința curentă și răspunsul AC; `anexe_asteptate` nu are FK `cerinta_id`; `pagina_globala` fără identitate de fișier/versiune nu dovedește pagina artefactului depus. `chain` poate afirma starea observată, inclusiv `nedeterminat`, dar nu certifică semantica ground truth. Runnerul generează acum `matrice-P4` prin `comparaGroundTruth`: compară SHA-urile așteptate cu manifestul și poate semnala PARTIAL/CONFLICT/UNDETERMINED; nu citește semantic pagina și nu declară CONFIRMED. Verdictul de comparație semantică și locatorii confirmați trebuie păstrați ca dovadă explicită, fără „text identic” ca proxy.

## P3 — concurență și restart

**13_concurenta_cerinta / aceeasi_cerinta:** două taburi distincte, același C din L. Ambele deschid „Corectez” înainte de salvare. `pregatire` / `pregatire_2` scriu două texte distincte; `actiuni` / `actiuni_2` salvează corecția. Post: fie refuz explicit al versiunii vechi, fie istoric demonstrabil al ambelor; ultimul text singur nu dovedește absența overwrite-ului. Contractul citește cerințe, dar istoricul editării nu este automat în snapshot.

**14_concurenta_capitol / acelasi_capitol:** pregătire în editorul de capitol al aceluiași ID, două conținuturi; salvări concurente `Salvează (versiune nouă)`. Post: versiune și istoric `ofertare_pt_capitole_versiuni` corelate, fără pierderea uneia dintre variante. Trebuie citit istoricul, nu doar rândul curent.

**15_concurenta_acoperire / aceeasi_acoperire:** două taburi aleg candidați diferiți ai aceluiași C. Pre: ambele liste încărcate; post: exact o alegere, `ales_de` actor valid, ambele tentative vizibile în jurnal, istoricul alegerii păstrat unde există. Unicitatea finală singură nu demonstrează lipsa overwrite-ului tăcut. RPC-ul de alegere e intenționat atomic.

**16_restart_worker:** `porneste_citire` prin `☁️ Pe server`, apoi PAUZĂ; Claude repornește workerul separat. La `dupa_restart`, operatorul redeschide aceeași clonă și reia cu checkpoint; `retry_idempotent` cere tentativă reală de retry, nu doar observație. Snapshotul dinaintea pornirii și cel de la pauză sunt ambele necesare: deduplicarea se compară cu primul, progresul cu al doilea. Nu condiționa reluarea de o coadă inactivă dacă ea trebuie să fie în curs la restart. Dovada restartului este jurnalul operatorului/containerului, nu simpla existență a checkpointului.

## Rețete generate și exemple JSON

`retete.js` exportă `retete(fixture)` și `PARAMETRI_EXEMPLU`. Generatorul produce **30 de faze parametrizate**, fără browser/BD și fără să modifice argumentul. Runnerul consumă automat copia rezultată. Câmpurile lipsă rămân NULL în exemplu, iar fazele fără parametri completabili primesc `motiv_indisponibil`, nu acțiuni fictive. `fixture.nr_anunt` este marcajul exact al clonei; `fixture.retete` folosește chei `pas/faza`. Un selector de rând parametrizat se completează numai după inspectarea DOM; nu se inventează un atribut.

Exemplu **sintetic**, cu ID-uri de test, pentru faza depunere fără dovadă (nu este țintă de producție):

```json
{
  "licitatie_id":12345,
  "nr_anunt":"SANDBOX-V2-TEST",
  "cerinte":{"D1":101,"D6":102,"D8":103},
  "retete":{
    "11_depunere/fara_dovada_SEAP":{
      "pachet_id":50,
      "fisiere_finale":["C:/audit-fixture/final.pdf"],
      "finale_selector":"css=input[type=\"file\"][multiple]",
      "depune_selector":"text=Înregistrează depunerea"
    }
  }
}
```

Generatorul produce următoarea fază, exact în schema runnerului:

```json
{
  "actiuni":[
    {"tip":"incarca","selector":"css=input[type=\"file\"][multiple]","fisiere":["C:/audit-fixture/final.pdf"]},
    {"tip":"observa","selector":"text=Înregistrează depunerea","asteptat":{"disabled":true},"la_esec":"BYPASS"}
  ],
  "postconditii":[
    {"tip":"exists","tabela":"ofertare_pt_pachet","where":{"id":50},"asteptat":{"stare":"aprobat"},"la_esec":"MISSING_LINK"},
    {"tip":"count","tabela":"ofertare_pt_pachet_fisiere","where":{"pachet_id":50,"rol":"dovada_seap"},"valoare":0,"la_esec":"BYPASS"}
  ]
}
```

Pentru fiecare P2, forma JSON de mai jos este o **intrare reală** pentru `fixture.retete`. NULL trebuie completat din preview/DOM înainte de execuție; generatorul refuză să o transforme în acțiune până atunci. Selectorii cu text exact de mai jos există în surse; selectorii NULL nu au identificator unic derivabil numai din cod.

```json
{
  "01_seap_documente/import_copie":{"fisiere":null,"nume":null,"size_bytes":null,"final_selector":null},
  "02_citire/citire_integrala":{"doc_id":null,"pagini":null,"final_selector":null},
  "03_cerinte/confirmare_umana":{"cerinta_id":null,"actor_id":null,"confirma_selector":null,"final_selector":null},
  "04_clarificari/leaga_289":{"clarificare_id":null,"document_id":null,"deschide_selector":null,"bifa_selector":null,"nr_selectate":null,"final_selector":null},
  "05_acoperire/alegere_umana":{"cerinta_id":null,"acoperire_id":null,"actor_id":null,"alege_selector":null,"final_selector":null},
  "06_cantitati/validare_partiala":{"cantitate_id":null,"nevalidata_id":null,"valideaza_selector":null,"final_selector":null},
  "07_grafic/inghetare":{"mod":null,"versiune_noua":null,"actor_id":null,"are_activitati":null,"final_selector":null},
  "08_pt/verifica_D1":{"legatura_id":null,"capitol_id":null,"versiune":null,"actor_id":null,"locator":null,"verifica_selector":null,"final_selector":null},
  "09_verificari/modificare_versiune":{"capitol_id":null,"cerinta_id":null,"text":null,"versiune_noua":null,"stare_lant_asteptata":null,"deschide_editor_selector":null,"final_selector":null},
  "10_pachet/aprobare":{"versiune_noua":null,"actor_id":null,"final_selector":null},
  "11_depunere/cu_depus_final_si_dovada":{"pachet_id":null,"fisiere_finale":null,"fisier_dovada":null,"finale_selector":null,"dovada_selector":null,"depune_selector":null,"final_selector":null},
  "12_comparatie/matrice_D1":{"verigi_asteptate":null},
  "16_restart_worker/porneste_citire":{"actor_id":null,"final_selector":null},
  "16_restart_worker/dupa_restart":{"doc_id":null,"pagini":null,"final_selector":null}
}
```

`are_activitati` este boolean: `true` adaugă confirmarea înlocuirii graficului (:292 în GraficPoarta), `false` nu inventează dialog. `verigi_asteptate` este de exemplu `{"6":"nedeterminat","7":"nedeterminat","8":"nedeterminat","9":"nedeterminat"}` pentru o comparație care probează explicit limitele existente; acest MATCH local nu certifică depunerea. Pentru `stare_lant_asteptata` după editare sunt relevante `veche/propusa`, nu `ok`.

Exemplu manual pentru promptul PT, după identificarea unică a butonului C:

```json
{"tip":"confirma","accept":true,"text":"paragraful 3, pagina 2"}
```

Pentru un prompt sensibil autorizat separat, schema permite `{"tip":"confirma","accept":true,"prompt_env":"AUDIT_UI_PROMPT"}`; valoarea se introduce numai în mediul operatorului și nu se copiază în JSON. Acest mecanism nu autorizează funcția live hardcodată din P2.09.

P3 concurență folosește acest format exact, completat cu selectori de rând observați:

```json
{
  "obiect":{"tabela":"ofertare_pt_capitole","id":null},
  "faze":{"acelasi_capitol":{
    "pregatire":[{"tip":"scrie","selector":"css=textarea[placeholder=\"Textul capitolului, așa cum intră în propunere.\"]","text":"VARIANTA A — fixture concurență"}],
    "pregatire_2":[{"tip":"scrie","selector":"css=textarea[placeholder=\"Textul capitolului, așa cum intră în propunere.\"]","text":"VARIANTA B — fixture concurență"}],
    "actiuni":[{"tip":"click","selector":"text=Salvează (versiune nouă)"}],
    "actiuni_2":[{"tip":"click","selector":"text=Salvează (versiune nouă)"}],
    "postconditii":[]
  }}
}
```

Acesta NU este un test complet până când se configurează ID și postcondiții care acceptă ambele ordini concurente și verifică **uniunea capitol curent + versiuni istorice**. Triggerul arhivează OLD (`20260928i...sql:20`); a cere ambele texte numai în istoric este greșit. Pentru cerință se folosesc editorul/corecția din P2.03 și `obiect.tabela='ofertare_cerinte'`; pentru acoperire se folosesc două butoane candidate din P2.05 și `obiect.tabela='ofertare_acoperire'`. Generatorul lasă explicit aceste trei faze neconfigurate, fiindcă o aserțiune de număr/versiune fără istoricul ambelor tentative ar putea da fals MATCH.

## Starea corecțiilor de harness și limite rămase

Verificate în revizia finală citită: uploadul ascuns are resolver dedicat; `confirma` primește text/env; `observa` validează disabled explicit; snapshotul citește toate pachetele și fișierele, capitolele și istoricul; contractele 06/07/09 au tabele suplimentare; restartul folosește `preconditii_reluare` și checkpoint înainte/după. Acestea nu mai sunt blocaje raportate.

Rămân limite reale de produs/scenariu: rânduri fără identificatori DOM unici; operații fără control UI (derogare, mutare/ștergere obiect deja aprobat); aprobarea combină mai multe operații într-un singur handler; comparația semantică a paginii cere om; UI local poate apela un URL live hardcodat; RLS poate ascunde rânduri. O fază de observație nu se substituie unei tentative de scriere/retry.

Testare locală a generatorului: `node scripts/audit-v2/test-retete.mjs` — 12 aserțiuni trecute (fixture nemodificat, nuluri neexecutabile, refuz ID 5, păstrare configurare manuală, rețetă negativă cu disabled și read-back). `node --check scripts/audit-v2/retete.js` trecut. Nicio rețetă UI nu a fost executată pe browser/backend în această contribuție; nicio trimitere externă sau procesare AI.
