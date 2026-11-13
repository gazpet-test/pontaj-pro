# ❓ Întreabă echipa — numele ascunse și regula „Da / Nu / Incert” (deciziile owner-ului, 13.11.2026)

Documentul pentru owner și coordonator. Partea tehnică (fișiere, teste) e în `worker/intrebari-tehnice/README.md`. Toate numele de
persoane și de firme private din exemple sunt INVENTATE; entitățile publice sunt doar cele din `nemascate.json`.

## Ce s-a decis
- **A. Numele nu pleacă la furnizorul modelului.** Numele de persoane și de firme din întrebare se ascund înainte de trimitere și
  se pun la loc în răspunsul afișat. Variantele respinse: răspuns doar din documentele noastre; trimitere integrală cu avertisment.
- **B. „Da” / „Nu” doar când o sursă spune exact acel lucru, de sine stătător** — citatul trebuie să fie o propoziție întreagă a
  sursei, copiată identic, care nu depinde de alt text. Altfel răspunsul e „Incert”, cu sursele alăturate ca să le citească omul.
- Owner, după review-ul PR #1086 (neschimbat): operatorii de rețea, instituțiile publice și Gazpet rămân vizibili; atașamentele nu se
  trimit la AI; localitățile rămân vizibile; doar trei verdicte (Da / Nu / Incert).

## r4: UN SINGUR MOTOR de reguli
Până în r3 regulile existau de două ori (în worker, în Python, și în ecran, în JavaScript) și fiecare rundă de review a găsit o
diferență între ele (în r3: un caracter invizibil pe care ecranul îl scotea, iar workerul nu, deci numele pleca). De acum:
- **toate regulile stau într-un singur fișier**, `src/intrebariMascare.js`: mascarea, învățarea numelor în speță, etichetele,
  demascarea și regula B (tăierea surselor în propoziții, compararea citatului), cu listele și normalizarea lor;
- **ecranul** îl folosește direct, pentru previzualizare;
- **workerul** îl cheamă printr-un proces Node separat, câte unul pe întrebare (`motor.py` → `motor_cli.mjs`). Python nu mai conține
  nicio regulă și nu „corectează” nimic înainte sau după motor: ce dă motorul se folosește ca atare, iar la orice problemă nu se
  folosește nimic.

### Cum e păzit procesul motorului
- **Fișiere verificate:** `worker/intrebari-tehnice/motor_manifest.json` are amprenta sha256 a motorului și a TUTUROR fișierelor
  lui (protocolul, intrarea, `nemascate.json`, `vocabular_web.json`, `cuvinte_comune.json`), plus versiunea Node (24, ca în
  `package.json`) și versiunea Unicode a lui Node (pe server: Node 24.20 = Unicode 17.0). La pornire, workerul verifică fiecare
  fișier, îl copiază într-un dosar privat (doar citire) și pornește toate procesele de acolo — o copiere nouă din repo cât rulează
  workerul nu schimbă motorul folosit; înainte de fiecare proces dosarul se verifică din nou. Procesul trimite la pornire amprentele
  fișierelor pe care le încarcă și versiunile lui; orice diferență oprește tot.
- **Protocol strict:** câte un mesaj JSON pe linie, UTF-8, cu versiunea protocolului și câmpurile verificate exact la ambele capete;
  ieșirea standard e doar pentru protocol; erorile sunt coduri scurte, fără text din întrebare sau din lista de nume; nimic în
  jurnalele de eroare ale procesului. Procesul se pornește direct (fără linie de comandă intermediară), cu un mediu minim, iar lista
  de nume îi vine pe intrarea standard, nu ca argument.
- **O întrebare = un proces:** ce s-a învățat, etichetele și tabelul „etichetă → nume” stau doar în procesul acelei întrebări, de la
  prima mascare până la demascarea finală; două întrebări nu împart nimic, nici când rulează în paralel.
- **Limite:** mărimea maximă a unui mesaj (64 MB la intrare, 16 MB la ieșire), 30 de secunde pe operație, 30 de minute pe întrebare;
  la depășire procesul e oprit.
- **Fail-closed:** Node lipsă, versiune greșită, amprentă greșită, proces căzut, timp depășit, răspuns trunchiat sau cu altă formă,
  răspuns prea mare → **nicio cerere nouă către model și nimic publicat**; colegul vede „Eroare internă la ascunderea numelor, deci
  întrebarea NU a fost trimisă mai departe”, jurnalul are doar codul. Textul original nu ia niciodată locul celui mascat.
- **Fără rețea:** procesul rulează cu permisiunile Node pornite — nu poate scrie pe disc, nu poate porni alte programe sau fire de
  lucru și citește doar din dosarul lui. Node 24 nu are încă o permisiune pentru rețea, așa că lipsa rețelei se verifică separat:
  un test static (vitest) pică dacă motorul, protocolul sau intrarea importă altceva decât propriile fișiere (doar `node:crypto`,
  `node:fs`, `node:path`, `node:url` la intrare, pentru amprente) sau folosesc `fetch`, socket-uri, `eval` etc.; în plus, intrarea
  scoate funcțiile de rețea globale înainte să încarce motorul. Ajunge pentru că motorul primește doar text și întoarce text: fără
  un import și fără funcțiile globale de rețea, nu are pe unde să trimită.

## Ce pleacă și ce nu pleacă în afară
| | Pleacă la furnizorul modelului? |
|---|---|
| Titlul, speța, contextul | DA, dar cu numele și datele personale înlocuite de etichete: `[PERSOANA_1]`, `[FIRMA_1]`, `[CNP_1]`, `[CUI_1]`, `[TELEFON_1]`, `[EMAIL_1]`, `[IBAN_1]`, `[NR_AUTO_1]`, `[ASCUNS_1]` |
| Tabelul „etichetă → nume” | NU. Stă doar în procesul motorului, cât se lucrează la o întrebare; nu se scrie nici pe disc, nici în jurnal |
| Lista de nume din platformă (angajați, terți, CUI-uri) | NU. Workerul o primește de la ERP și o dă procesului motorului, doar ca să găsească numele în text |
| Atașamentele (PDF / poze) | NU. Numele din ele nu pot fi ascunse sigur. Rămân în ERP pentru colegi; modelul află doar că există |
| Extrasele din documentele noastre de cercetare și din paginile oficiale | DA (trec și ele prin mascare) |
| Căutarea pe web | DA, doar căutarea compusă de program din lista aprobată de cuvinte (fără nume, fără speță) |
| Jurnalul workerului | Rămâne pe server și are doar numere: câte nume / date s-au ascuns, pe categorii; la pornire câte nume s-au încărcat și câte intrări fără valoare s-au aruncat. Nu are valori |

Aceeași persoană primește aceeași etichetă pe toată întrebarea; altă formă scrisă a aceluiași nume („Ana Vlădescu” / „Vlădescu
Ana”, „Mariei”, firma cu sau fără „SC”) primește același număr cu un indice: `[PERSOANA_1_F2]`.

## Contractul de acoperire (închis) — ce TREBUIE ascuns
Un nume de persoană sau o firmă care **există în lista platformei** se ascunde în orice scriere de mai jos, **inclusiv când scrierile
se combină** (ex. `lUMIVO,` + caracter invizibil + ` serviciiS.R.L.`). Fiecare rând are cazuri în
`worker/intrebari-tehnice/teste_motor.json` (rezultatul scris de mână) și un test „mutant” care scoate regula și arată că
cazurile pică.

| Dimensiune | Ce se acoperă | Exemple (inventate) |
|---|---|---|
| **Majuscule** | Firme: orice combinație. Persoane: forma uzuală (prima literă mare) și integral cu majuscule. Persoanele scrise integral cu litere mici sunt **în afara contractului** | `Lumivo Servicii`, `LUMIVO SERVICII`, `lumivo servicii`, `LuMiVo SeRvIcIi`; `Ana Vlădescu`, `ANA VLĂDESCU` |
| **Diacritice** | Cu / fără diacritice, `ș / ş`, `ț / ţ`, forme Unicode compuse / descompuse | `Șerban`, `Şerban`, `Serban`, `S` + virgula de dedesubt separată |
| **Separatoare** | Între componentele unei firme: 1–6 caractere din mulțimea închisă: spațiu (orice fel, inclusiv neîntreruptibil), tab, rând nou (CR / LF), virgulă, punct, ghilimele, paranteze rotunde, `&`, `+`, cratimele de mai jos. La persoane: spațiile leagă orice componente; celelalte separatoare leagă doar două componente ale **aceluiași** nume din listă („Vlădescu, Ana”) — o enumerare de persoane diferite („Ana Vlădescu, Maria Zamfirescu”) primește etichete diferite, iar fiecare componentă distinctivă se ascunde oricum | `Lumivo, Servicii`, `Lumivo & Servicii`, `Lumivo` + rând nou + `Servicii`, `Vlădescu, Ana` |
| **Forme juridice** | `SRL, SA, PFA, II, IF, SNC, SCS`, cu / fără puncte, orice capitalizare, despărțite sau LIPITE după nume; „SC” / „S.C.” în față, despărțit sau lipit. Firma din listă se potrivește ÎNAINTEA detectorului de formă juridică (P1 din r3). „sa” / „îi” scrise mic și despărțite sunt cuvinte și rămân în afara etichetei (firma se ascunde) | `Lumivo ServiciiSRL`, `Lumivo ServiciiS.R.L.`, `SCLumivo Servicii`, `S.C. Lumivo Servicii S.A.`, `Lumivo, Servicii SRL` |
| **Flexiuni** | UN sufix din `{ului, ilor, ule, lui, lor, ul, le, ei, ii, e, i}` pe o componentă de cel puțin 4 litere (la firme: pe ultima componentă); plus genitivul feminin `Ana→Anei`, `Maria→Mariei`, `Andreea→Andreei`, `Olga→Olgăi`. Fără derivări în lanț | `Vlădescului`, `Vlădescule`, `Crângașului`, `Varnitecului` |
| **Cratimă** | `-`, U+2010, U+2011 la nume compuse și sufixe; se ascunde tot cuvântul compus | `Gheorghiu-Vlădescu`, `Vlădescu-ului`, `VLĂDESCU-ULUI` |
| **Invizibile / de combinare** | Inserate în nume: toate caracterele de combinare (categoria Unicode M) și de format (Cf), inclusiv U+034F, U+FE0F, U+200B, U+00AD, U+FEFF și selectorii de variantă U+FE00–FE0F, U+E0100–E01EF. O SINGURĂ funcție de normalizare (`curata` / `norm` în motor), după tabelele Unicode ale lui Node 24.20 (Unicode 17.0) pe server și ale browserului în ecran | `Vlă` + U+034F + `descu` |
| **Ordine și propagare** | Persoane: ambele ordini. Componenta izolată se ascunde înainte și după apariția numelui întreg, în toate câmpurile întrebării (titlu, speță, context — citite toate înainte de mascare). Ordinea cuvintelor unei firme rămâne fixă | `Ana Vlădescu` / `Vlădescu Ana`; „Mare a cerut avizul” + „Ion Mare răspunde” → ambele ascunse |

**Excepțiile au prioritate explicită** — entitățile publice aprobate (`nemascate.json`) și localitățile rămân vizibile; dar
**potrivirea completă a unei firme private din listă vine înaintea excepției** pentru un fragment public: `Transgaz Construct SRL`
se ascunde întreg, `Transgaz` singur rămâne.

**Componentele comune cer context.** Un cuvânt din listă care e și cuvânt obișnuit (lista închisă `cuvinte_comune.json` — litere
grecești, culori, luni, cuvinte des folosite în numele de firme —, termenii tehnici din `vocabular_web.json` și câteva cuvinte scurte
din motor; plus localitățile cunoscute) rămâne vizibil când apare singur, fără context identificator: „Alfa este coeficientul, gamma
este radiația” și „Romane sunt aceste norme” rămân, deși `Alfa SRL`, `Gamma SRL` și persoana `Roman Stan` sunt în listă. Context =
formă juridică alături, „SC” în față, un titlu („dl.”), un alt nume din listă lipit de el sau **numele întreg apărut în aceeași
întrebare**. **Compromisul declarat și testat:** după ce numele întreg a apărut, propagarea ascunde și cuvântul comun scris cu
majusculă („Alfa SRL a livrat. Alfa a facturat” → ambele ascunse; „Roman Stan … Romane sunt aceste norme” → „Romane” ascuns), dar nu
și scris mic („alfa e coeficientul” rămâne). O firmă dintr-un singur cuvânt comun nu se mai aruncă din listă (ca în r3): rămâne, dar
cere context.

**În afara contractului** (spus și în ecran): porecle, greșeli de scriere sau de citire automată (OCR), litere asemănătoare din alte
alfabete, diminutive, alte ordini ale cuvintelor unei firme, nume de persoane scrise doar cu litere mici, nume pe care platforma nu
le cunoaște (nu le cunoaște = nu sunt în lista ei; se prind doar cu „dl.”, „ing.”, „colegul” … în față, sau cu SRL / SA după),
adrese, numere de contract / carte funciară, CUI scris fără „RO” / „CUI” și necunoscut platformei.

**NU sunt „limite”** și nu se acceptă: ocolirea motorului (garda din worker refuză orice text care nu vine din sesiunea motorului
pentru acea întrebare), o listă de nume incompletă tratată ca succes (lista goală sau cu altă formă oprește preluarea), trimiterea
textului nemascat la o eroare (vezi fail-closed).

## Ce mai prinde mascarea (tipare, fără listă)
- **Nume după un titlu**: „dl.”, „dna”, „ing.”, „arh.”, „dr.”, „colegul”, „șeful”, „dirigintele”, „maistrul”, „sudorul”, „șoferul”
  … (și când numele e un cuvânt obișnuit: „dl. Ion”).
- **Firme necunoscute cu formă juridică**: orice nume cu majusculă urmat de SRL / SA / PFA / II / IF / SNC / SCS.
- **Date personale**: CNP (cu cifra de control), CUI cu „RO” / „CUI” / „cod fiscal” în față sau cunoscut platformei, telefoane
  românești, e-mailuri, IBAN (cu verificarea de control), numere de înmatriculare.
- **Ce ascunde omul**: orice cuvânt între `[[` și `]]` (sau selectat și ascuns cu „🙈 Ascunde selecția”), și orice formă de
  etichetă scrisă de el între paranteze drepte — pleacă `[ASCUNS_n]` și se pune la loc exact.
- **Intrările fără valoare** din listă („diverse”, „persoana fizica”, „furnizor”, „client necunoscut” …) se aruncă la încărcare și
  se numără în jurnalul de pornire.

## Localitățile rămân vizibile (decizia owner-ului)
- Cuvântul de după un **marcaj de localitate** rămâne („comuna”, „com.”, „satul”, „orașul”, „municipiul”, „localitatea”, „județul”,
  „jud.”, „UAT” …), plus cel mult două cuvinte cu majusculă lipite de el care nu sunt nume din listă („comuna Valea Călugărească”).
  Un nume de după localitate se ascunde în continuare („comuna Berceni Ana Vlădescu” → „comuna Berceni [PERSOANA_1]”).
- Un cuvânt care e **localitate cunoscută platformei** (denumirile UAT și satele din `red_uat`) rămâne când apare fără titlu și
  fără alt nume din listă lângă el. Conflictul nume de familie = localitate: cu titlu sau prenume lângă = persoană („dl. Berceni”,
  „Berceni Ana”), altfel = localitate („Berceni are teren”, „Primăria Berceni”).
- Previzualizarea din ecran nu are lista de localități: acolo un asemenea nume scris singur apare ascuns (pe server rămâne) — ecranul
  o spune.

## Entitățile publice care rămân vizibile (decizia owner-ului, 13.11.2026)
- lista stă într-un **singur loc**, `worker/intrebari-tehnice/nemascate.json`, citit doar de motor (deci la fel în ecran și pe
  server); fiecare intrare are o categorie: operator de rețea (Transgaz, Delgaz Grid / E.ON, Distrigaz Sud Rețele, Engie România,
  Premier Energy, Transelectrica, Electrica, Apa Nova București), companie publică (Romgaz, Hidroelectrica), instituție publică
  (ANRE), societatea noastră (Gazpet Instal). **Fără** furnizori, subcontractori, clienți privați sau persoane;
- potrivirea e pe **numele întreg** al entității (fără SRL / SA, cu inițialele lipite: „S.N.T.G.N. Transgaz S.A.” = „sntgn
  transgaz”), nu pe un cuvânt din el: firme private inventate cu nume asemănător („Transgaz Construct SRL”, „Delgaz Instal SRL”,
  „Gazpet Montaj SRL”, „Romgaz Service”) se ascund;
- **orice adăugare în listă = decizia owner-ului, prin coordonator** (PR cu categoria și motivul; manifestul motorului se reface).

## Cum arată în ecran
- Sub speță apare **„🙈 Previzualizare orientativă — verifică înainte de trimitere”**, cu textul cerut de recenzent, lângă ea:
  **„Previzualizare orientativă.** Serverul folosește lista completă din platformă și poate ascunde nume suplimentare. Localitățile
  cunoscute rămân vizibile pe server, chiar dacă aici apar ascunse. Mascarea automată nu garantează eliminarea tuturor numelor.”
  Ecranul nu mai spune că „pe server se ascunde cel puțin la fel” (exemplul localităților arată că nu e adevărat).
- Textul cu etichetele evidențiate, rezumatul („Am ascuns 3 nume și date …”) și lista „Nu prinde” (clasele din afara
  contractului).
- Butonul **„🙈 Ascunde selecția”** pune cuvântul selectat între `[[ ]]`.
- Dacă colegul atașează fișiere: „Atașamentele rămân în ERP pentru colegi, dar NU se trimit la AI.”

## De unde vin numele din platformă (r2, review P1-1)
Funcția edge citește, doar pentru worker, **coloanele de nume / CUI** (niciodată telefon, e-mail, CNP, IBAN, adresă) din tabelele
de mai jos (`SURSE_NUME` în `supabase/functions/intrebari-tehnice-worker/logic.js`). Orice tabel sau coloană care nu se poate citi
oprește lista întreagă → workerul nu preia nimic (fail closed).

| Tabel | Persoane | Firme | CUI | Coloane verificate în |
|---|---|---|---|---|
| `employees` | name | | | cod / scheleți de test |
| `beneficiari` | contact_nume | nume | cif | cod |
| `logistica_furnizori` | persoana_contact | nume | cui | cod |
| `logistica_subcontractori` | contact_nume | nume_scurt, denumire_legala | cui | cod |
| `contracte_terti` | contact_factura_nume, contact_mng_nume, contact_resp_exec_nume | partener_text | | cod |
| `hr_personal_extern` | nume | firma | cui_firma | cod |
| `hr_recrutare_candidati` | nume | | | cod |
| `ofertare_parteneri` | | nume | cui | cod |
| `ofertare_brokeri` | | nume | | cod |
| `logistica_service_parteneri` | | nume | | cod |
| `sedinte_invitati` | nume | firma | | cod |
| `red_detinatori` | nume | | | migrare 20261126a |
| `red_proiecte` | reprezentant_tgz_nume, reprezentant_gazpet_nume, contact_nume | | | migrare 20261126a |
| `red_uat` | reprezentant_uat_nume | | | migrare 20261126a — r3: și **localitățile** `nume`, `sate_zi1`, `sate_zi2`, `sate_zi3` (lista separată `localitati`, folosită doar ca să NU ascundă) |
| `ofertare_oferte_furnizori` | | furnizor | | cod |
| `ofertare_preturi_materiale` | | furnizor | | cod |
| `contracte_subcontract_facturi` | | furnizor_text | | cod |
| `executie_tura_subcontractori` | | firma_text | | cod |
| `facturi_emise` | contact_nume, delegat_nume | beneficiar_nume | beneficiar_cif | cod |
| `logistica_transporturi` | sofer_extern_nume | | | cod |
| `eip_intrari` | | furnizor_nume | furnizor_cui | migrare 20261110a |
| `izo_documente_intrare` | | furnizor | furnizor_cif | migrare 20261103b |

**Ce NU intră și de ce:** `profiles` (conturile de aplicație = angajații, deja din `employees`, plus conturi de serviciu);
`firma_profil` (e Gazpet — rămâne vizibilă); `red_detinatori_contact`, `red_corespondenta`, `red_mail_*`, `sms_mesaje` (doar
adrese / telefoane / e-mailuri, tiparele le prind); `polite_*`, `ofertare_organigrama` (numele stau în JSON, nu în coloane);
`ofertare_participari`, `ofertare_licitatii.autoritate`, `cnsc_decizii`, `hr_autorizatii.emitent` (autorități contractante,
concurenți și emitenți publici — informație publică din SEAP / CNSC); `contab_expert_linii`, `trezorerie_extras_linii`,
`hr_decizii` (zonă de salarii / bani: nu se deschide pentru o funcție de mascare fără decizia owner-ului); celelalte coloane libere
cu nume de furnizori (`productie_facturi`, `logistica_achizitii_vrac`, `logistica_mentenanta_plan`, `logistica_imprumuturi`,
`locatii_*`, `ctc_*`, `ofertare_rfq_*`, `izo_avize_iesire`, `probe_oferte`) — aceiași furnizori / clienți sunt deja în registrele de
mai sus; se pot adăuga printr-un PR mic dacă apar goluri.

**Înainte de publicarea funcției edge**, coordonatorul confirmă că toate coloanele din tabel există (doar citire, fără date):
```sql
SELECT t.tabel, t.coloana
FROM (VALUES
  ('employees','name'),('beneficiari','nume'),('beneficiari','contact_nume'),('beneficiari','cif'),
  ('logistica_furnizori','nume'),('logistica_furnizori','persoana_contact'),('logistica_furnizori','cui'),
  ('logistica_subcontractori','nume_scurt'),('logistica_subcontractori','denumire_legala'),('logistica_subcontractori','contact_nume'),
  ('logistica_subcontractori','cui'),('contracte_terti','partener_text'),('contracte_terti','contact_factura_nume'),
  ('contracte_terti','contact_mng_nume'),('contracte_terti','contact_resp_exec_nume'),('hr_personal_extern','nume'),
  ('hr_personal_extern','firma'),('hr_personal_extern','cui_firma'),('hr_recrutare_candidati','nume'),('ofertare_parteneri','nume'),
  ('ofertare_parteneri','cui'),('ofertare_brokeri','nume'),('logistica_service_parteneri','nume'),('sedinte_invitati','nume'),
  ('sedinte_invitati','firma'),('red_detinatori','nume'),('red_proiecte','reprezentant_tgz_nume'),('red_proiecte','reprezentant_gazpet_nume'),
  ('red_proiecte','contact_nume'),('red_uat','reprezentant_uat_nume'),('red_uat','nume'),('red_uat','sate_zi1'),
  ('red_uat','sate_zi2'),('red_uat','sate_zi3'),('ofertare_oferte_furnizori','furnizor'),
  ('ofertare_preturi_materiale','furnizor'),('contracte_subcontract_facturi','furnizor_text'),('executie_tura_subcontractori','firma_text'),
  ('facturi_emise','contact_nume'),('facturi_emise','delegat_nume'),('facturi_emise','beneficiar_nume'),('facturi_emise','beneficiar_cif'),
  ('logistica_transporturi','sofer_extern_nume'),('eip_intrari','furnizor_nume'),('eip_intrari','furnizor_cui'),
  ('izo_documente_intrare','furnizor'),('izo_documente_intrare','furnizor_cif')
) AS t(tabel, coloana)
LEFT JOIN information_schema.columns c ON c.table_schema = 'public' AND c.table_name = t.tabel AND c.column_name = t.coloana
WHERE c.column_name IS NULL;   -- trebuie să întoarcă 0 rânduri
```
r3: lista are 4 coloane noi, toate din `red_uat` (`nume`, `sate_zi1`, `sate_zi2`, `sate_zi3`, din migrarea 20261126a) — interogarea
se rulează din nou pe lista de mai sus, chiar dacă cea din r2 a întors 0.
Plus tipul cheii `id` (întreg pentru toate, `uuid` pentru `red_*`):
`SELECT table_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'id' AND table_name IN (…)`.
O coloană lipsă se scoate din `SURSE_NUME` (PR), nu se publică edge-ul cu ea.

## Garda (verificată în cod, nu prin convenție)
- Există un singur drum spre furnizor. Fiecare mesaj trece prin motor chiar în funcția care construiește cererea.
- Înainte de orice trimitere, o gardă verifică cererea: conținutul trebuie să fie exact de tipul „text mascat” **și produs de
  sesiunea motorului pentru acea întrebare** (un „text mascat” făcut de mână, sau al altei întrebări, e refuzat). Un text construit
  după mascare (lipit, tăiat), un atașament, alt prompt sau altă unealtă oprește cererea înainte să plece. Limita: garda prinde
  greșelile de program, nu un cod rău-intenționat rulat în același proces.
- Fără lista de nume din platformă sau fără motorul verificat, workerul nu preia nicio întrebare (întrebările așteaptă în coadă).
- **Demascarea e strictă:** se pun la loc doar etichetele emise pentru întrebarea aceea, scrise exact. Răspunsul **nu se publică**
  dacă în textul modelului rămâne o „aproape etichetă” care nu e una emisă (`[PERSOANA_999]`, `[PERSOANA_1_F9]`, `[persoana_1]`,
  `PERSOANA_1`) sau o etichetă ruptă (rând nou, spațiu neîntreruptibil sau caracter invizibil în ea: `[PERSOANA_` + rând nou +
  `999]`). **r4 (pct. 5 din brief):** „aproape etichetă” înseamnă doar ce nu poate fi proză: între **paranteze drepte**, sau fără
  paranteze dar cu categoria **exactă, cu majuscule, și „_”** (`PERSOANA_1`). „firma 2 a contractat lucrarea”, „persoana 2”,
  „CUI 12345678” nu mai opresc publicarea (în r3 le opreau — refuz fals). Între paranteze, categoria contează în orice scriere
  („[persoană_` + rând nou + `1]” rămâne oprit), pentru că un text obișnuit nu se scrie așa.
- Dacă răspunsul ar ieși cu etichete în locul numelor (demascarea n-a avut loc), nu se publică.

## Regula B: „Da” / „Nu” / „Incert” (r4 — conservatoare)
- Sunt doar trei verdicte. „Depinde de …” devine „Incert — depinde de …”.
- **„Da” / „Nu” trec numai cu un citat INTEGRAL dintr-o propoziție AUTONOMĂ** a sursei marcate pe același rând (`[C1]`, `[W2]`);
  orice dependență structurală pe care programul n-o poate reconstitui dă **„Incert”**. Propoziția NU e autonomă dacă:
  - e un **element de listă** (numerotată, cu litere, cu liniuțe / buline), **introducerea** unei liste („…:”), are „;”, sau e o
    **celulă de tabel** — chiar dacă introducerea conține „nu”. Contraexemplul din r3 („Nu se admit următoarele lucrări: 1. …;
    2. Executarea sudurilor …” cu doar elementul 2 citat) dă acum „Incert”; la fel enumerarea citată întreagă (validarea sigură a
    unui bloc de listă poate veni ulterior);
  - are o **trimitere** („conform alin. (2)”, „potrivit anexei …”, „art.”, „lit.”, „prevăzut la”) sau o expresie care se sprijină pe
    alt text („aceste condiții”, „acesta”, „respectiv”, „prezentul”, „de mai sus”);
  - are o **excepție / derogare** („prin derogare”, „cu excepția”, „nu se aplică”), sau **altă propoziție din același paragraf**
    are o restricție (excepție, derogare, „numai / doar dacă”, „cu condiția”, „dar numai”) — „Montajul pe poduri este permis cu tub
    de protecție. Prin derogare, montajul este interzis pe podurile din lemn.” dă „Incert” pentru oricare dintre ele;
  - paragraful ei e **tăiat la marginea extrasului**: lipsa vecinului nu înseamnă lipsa restricției. Extrasele din documentele
    noastre sunt bucăți de paragrafe întregi (marginile sunt sigure), afară de feliile unui paragraf prea lung; **fragmentele web
    sunt mereu tăiate din pagină**, deci nu susțin singure un „Da” / „Nu”; „…” într-un extras e tot o tăietură;
  - începe cu literă mică (fragment) sau nu se termină cu „.”, „!”, „?”.
- **Compararea citatului nu folosește normalizarea permisivă a numelor:** semnele, cifrele, operatorii și diacriticele cu sens se
  păstrează (`-5 ≠ 5`, `≤ ≠ <`, `sau ≠ său`). Contează doar: majusculele, spațiile, ghilimelele, sedila / virgula de sub ș / ț, felul
  liniuței (o liniuță tipografică în fața unei cifre rămâne semn minus) și punctuația de la sfârșit. Citatul are cel puțin 6 cuvinte.
- Fără un asemenea citat, verdictul devine **„Incert — de verificat: niciun citat nu reproduce exact o propoziție întreagă și de
  sine stătătoare dintr-o sursă — citește sursele alăturate.”**, iar ecranul pune toate sursele consultate imediat sub verdict.
  Înainte, modelul primește o singură dată cererea să pună citatul; promptul îi spune regula de la început.
- **Limita declarată:** regula verifică integritatea și autonomia textului, nu sensul. Un citat autonom și autentic poate totuși
  susține o concluzie greșită pentru speța concretă; o restricție aflată în ALT paragraf al documentului nu e văzută. Omul vede
  citatul și sursa alăturate.

## Testele (pe scurt)
- Un singur set de cazuri, `worker/intrebari-tehnice/teste_motor.json`, rulat de trei ori: **vitest** pe motor
  (`src/intrebariMascare.test.js`), **procesul Node real** prin `motor.py` (`test_motor.py`, `test_worker.py` — transportul spre
  model e simulat, motorul nu) și un **browser real** (`worker/intrebari-tehnice/motor_browser.html`: din rădăcina repo-ului
  `python -m http.server 8765 --bind 127.0.0.1`, apoi `http://127.0.0.1:8765/worker/intrebari-tehnice/motor_browser.html` — rezultatul
  în pagină și în `window.REZULTAT_MOTOR`).
- Mutanți: câte o regulă scoasă pentru fiecare rând al contractului și pentru fiecare excludere din regula B (vitest); fiecare cale
  de eroare a procesului (procesul de test `test_motor_defect.mjs`): zero cereri noi, zero răspunsuri publicate.

## Pașii de pornire (pentru coordonator — după review și „da”-ul lui Răzvan)
Nu e nevoie de migrare și nici de secrete noi. **Merge-ul NU publică funcția edge și NU pornește workerul.** Workerul stă OPRIT pe
toată livrarea; testul de fum se face cu rularea periodică încă dezactivată. Ordinea:
1. **Workerul e oprit — dovedit, nu presupus.** Pe serverul AI, în PowerShell (se notează rezultatul fiecăreia):
   - task-ul planificat e dezactivat: `schtasks /Change /TN "Intrebari tehnice worker (Gazpet)" /DISABLE`, apoi
     `(Get-ScheduledTask -TaskName "Intrebari tehnice worker (Gazpet)").State` → `Disabled`;
   - niciun proces al workerului **și niciun proces al motorului**:
     `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*intrebari_worker.py*" -or $_.CommandLine -like "*motor_cli.mjs*" }`
     → nimic (dacă apare unul, se așteaptă să se termine și se repetă verificarea);
   - lacătul de sistem e liber: cu Python-ul workerului, în folderul workerului,
     `python -c "import msvcrt; f=open('worker.lock','a+b'); msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1); print('LIBER')"` → `LIBER`.
   Fără toate trei nu se trece mai departe. Workerul rămâne dezactivat până la pasul 10.
2. Merge PR-ul (motor + ecran + worker; edge-ul din PR-ul anterior, neschimbat aici).
3. Interogarea de verificare a coloanelor (secțiunea „De unde vin numele”) → 0 rânduri lipsă. Altfel: stop.
4. Dacă edge-ul `intrebari-tehnice-worker` nu e încă publicat cu acțiunea `nume` (verdictul r3: „GO cu condiții”): deploy cu
   workerul oprit, **`index.ts` și `logic.js` împreună**, `verify_jwt = false`, aceleași setări (`SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, secretul din Vault `INTREBARI_WORKER_SECRET`).
5. Verificarea acțiunii `nume` FĂRĂ worker: cu secretul → **200** cu `persoane`, `firme`, `cui` nevide și `localitati` (doar numărul
   lor se notează); fără antet / cu cheia anon / cu un JWT de cont obișnuit / cu un secret greșit → **401**. Altfel: stop.
6. **Node pe server:** `node --version` → `v24.x` (pe 13.11.2026: `v24.20.0`), iar
   `node -p "process.versions.unicode"` → aceeași valoare ca `unicode` din `motor_manifest.json` (`17.0`). Altfel: stop — fie se
   instalează versiunea fixată, fie se reface manifestul printr-un PR (`node scripts/intrebari/manifest_motor.mjs`) și se rulează
   din nou testele. Dacă `node` nu e în PATH-ul contului care rulează task-ul, se setează `INTREBARI_NODE` (calea completă) în
   acțiunea task-ului.
7. Pe serverul AI, cu workerul oprit, copierea fișierelor din `main` în folderul workerului (`C:\Users\Public\intrebari_worker\`):
   - lângă script: `intrebari_worker.py`, `cercetare.py`, **`motor.py`**, `corpus_manifest.json`, **`motor_manifest.json`**,
     `vocabular_web.json` (din `worker/intrebari-tehnice/`);
   - motorul, în subfolderul **`motor\`**, **păstrând căile din repo** (exact lista din `motor_manifest.json`):
     `motor\src\intrebariMascare.js`, `motor\worker\intrebari-tehnice\motor_protocol.mjs`, `…\motor_cli.mjs`, `…\nemascate.json`,
     `…\vocabular_web.json`, `…\cuvinte_comune.json` (workerul caută motorul în `motor\` de lângă el; altă locație = variabila
     `INTREBARI_MOTOR_RADACINA`);
   - **`mascare.py` vechi se șterge** din folderul workerului (nu mai e folosit; rămas acolo ar crea confuzie).
   Verificarea: `node scripts/intrebari/manifest_motor.mjs --verifica` în clona de pe `main` → „la zi”; workerul verifică singur,
   la pornire, amprentele fișierelor copiate (cu finaluri de linie LF) — o diferență = `motor_invalid` în jurnal, nicio preluare.
8. Testele pe `main`, în clona repo-ului de pe server: `npm install` + `npx vitest run src/intrebariMascare.test.js` și
   `python -I -B -m unittest discover -s worker/intrebari-tehnice -p "test_*.py"` (aceeași versiune de Python ca workerul, Node 24
   în PATH) — toate OK. Opțional, testul în browser (secțiunea „Testele”).
9. **Testul de fum controlat, cu task-ul încă DEZACTIVAT:** coada are doar întrebarea de test a ownerului (nume inventate, un
   genitiv, o localitate, un nume cu un caracter invizibil copiat). Se pornește workerul **o singură dată, de mână**; se verifică:
   răspunsul afișat are numele la loc și nicio etichetă; jurnalul are `nume_incarcate` (doar numere), apoi `mascate`, `inlocuiri`,
   `regula_b` — fără valori; niciun proces `motor_cli.mjs` rămas (verificarea din pasul 1). Orice abatere: stop, se raportează.
10. Abia acum se reactivează rularea periodică: `schtasks /Change /TN "Intrebari tehnice worker (Gazpet)" /ENABLE` → `Ready`.
11. Registrul: rândul de mai jos în `registru_automatizari` și în `public.automatizari` (fără valori de secrete).

Revenirea: workerul se oprește întâi (pasul 1), apoi fișierele workerului și ale motorului se întorc împreună la versiunea
anterioară (edge-ul poate rămâne: lista de nume e aceeași).

## Rândul propus pentru `registru_automatizari` (înlocuiește fișa „Întreabă echipa”)
**Întreabă echipa (intrebari-tehnice-worker) — actualizare 13.11.2026: mascarea numelor (A) + regula „Da / Nu / Incert” (B), r4
motorul unic.**
- **Ce**: spețe tehnice din ERP (`/intrebari`) → răspuns AI informativ, din cercetare, vizibil doar autorului și ownerului. Numele de
  persoane / firme și datele personale se ascund înainte de orice apel la furnizor (motorul unic, un proces Node local pe
  întrebare) și se pun la loc doar în textul afișat; atașamentele nu se trimit la furnizor; „Da” / „Nu” doar cu un citat identic cu
  o propoziție întreagă și de sine stătătoare a sursei, altfel „Incert” cu sursele alăturate.
- **(a) Conținut extern**: textul spețelor (scris de colegi), paginile oficiale găsite de căutarea web (domenii fixe), extrasele din
  corpusul intern. Intern: numele angajaților și ale terților (citite de edge din BD, doar coloanele de nume / CUI, plus
  localitățile din `red_uat`) — folosite doar pentru mascare, în memoria procesului motorului.
- **(b) Ce poate scrie / face**: doar răspunsul sau eroarea pe rândul întrebării preluate + jurnalul de preluări. Procesul motorului:
  nimic (fără scriere pe disc, fără rețea, fără alte procese — permisiunile Node + testul static). Fără mail, bani sau drepturi.
- **(c) Identitate**: edge cu `service_role` (coloane fixe, doar către worker); workerul apelează furnizorul cu cheia API a firmei.
  Fiecare cerere spre furnizor trece prin motor și prin garda tipului „text mascat”.
- **(d) Cine pornește**: doar deținătorul `INTREBARI_WORKER_SECRET` (verificat în BD, fail closed). Întrebările le pun doar cei cu
  cheia de modul `intrebari_tehnice` (sau ownerul), 5 / zi / utilizator, plafon global 40 de preluări / zi.
- **(e) Confirmare umană**: nu e cazul (răspunsul e informativ). Schimbările listei de entități nemascate și ale listei de cuvinte
  comune se fac doar prin PR, cu „da”-ul lui Răzvan.
- **Secrete (doar nume)**: `INTREBARI_WORKER_SECRET`, cheia API Anthropic (Credential Manager). Nimic nou.
- **Oprire**: dezactivezi task-ul din Task Scheduler + `automatizari.stare = oprit`.

## Decis de Răzvan (13.11.2026, după review-ul PR #1086)
1. **Entitățile publice** (operatori de rețea, companii / instituții publice, Gazpet) rămân vizibile — lista închisă din
   `nemascate.json`.
2. **Atașamentele** rămân oprite (nu se trimit la AI).
3. **Localitățile** rămân vizibile (marcaj + localitățile cunoscute din `red_uat`; conflictul nume = localitate: cu titlu sau
   prenume lângă = persoană, altfel localitate).
4. **Deținătorii de teren din Redări** rămân în lista de mascare (persoane fizice), cu regula de la 3.
5. **Răspunsul are trei verdicte**: Da / Nu / Incert.
