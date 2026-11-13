# ❓ Întreabă echipa — numele ascunse și regula „Da / Nu / Incert” (deciziile owner-ului, 13.11.2026)

Documentul pentru owner și coordonator. Partea tehnică (fișiere, teste) e în `worker/intrebari-tehnice/README.md`.

## Ce s-a decis
- **A. Numele nu pleacă la furnizorul modelului.** Numele de persoane și de firme din întrebare se ascund înainte de trimitere și
  se pun la loc în răspunsul afișat. Variantele respinse: răspuns doar din documentele noastre; trimitere integrală cu avertisment.
- **B. „Da” / „Nu” doar când o sursă spune exact acel lucru** — r3: citatul trebuie să fie o propoziție întreagă a sursei,
  copiată identic. Altfel răspunsul e „Incert”, cu sursele alăturate ca să le citească omul.

## Ce pleacă și ce nu pleacă în afară
| | Pleacă la furnizorul modelului? |
|---|---|
| Titlul, speța, contextul | DA, dar cu numele și datele personale înlocuite de etichete: `[PERSOANA_1]`, `[FIRMA_1]`, `[CNP_1]`, `[CUI_1]`, `[TELEFON_1]`, `[EMAIL_1]`, `[IBAN_1]`, `[NR_AUTO_1]`, `[ASCUNS_1]` |
| Tabelul „etichetă → nume” | NU. Stă doar în memoria workerului, cât se lucrează la o întrebare; nu se scrie nici pe disc, nici în jurnal |
| Lista de nume din platformă (angajați, terți, CUI-uri) | NU. Workerul o primește de la ERP și o folosește doar ca să găsească numele în text |
| Atașamentele (PDF / poze) | **NU, de acum.** Numele din ele nu pot fi ascunse sigur. Rămân în ERP pentru colegi; modelul află doar că există |
| Extrasele din documentele noastre de cercetare și din paginile oficiale | DA (trec și ele prin mascare) |
| Căutarea pe web | DA, doar căutarea compusă de program din lista aprobată de cuvinte, ca până acum (fără nume, fără speță) |
| Jurnalul workerului | Rămâne pe server și are doar numere: câte nume / date s-au ascuns, pe categorii; la pornire (r3) câte nume s-au încărcat și câte intrări fără valoare s-au aruncat. Nu are valori |

Aceeași persoană primește aceeași etichetă pe toată întrebarea: în titlu, în speță, în context, la reparare. Altă formă scrisă a
aceluiași nume (ordinea inversă „Popescu Ion” / „Ion Popescu”, genitivul „Mariei”, firma cu sau fără „SC”) primește același număr cu
un indice: `[PERSOANA_1_F2]`. Exemplele din acest document sunt inventate.

## Ce prinde mascarea
r3 (review r2 al PR #1086): fiecare clasă de scăpări e închisă printr-o **regulă**, nu prin încă o listă de cazuri; unde regula nu
poate decide, rezultatul e cel prudent (se ascunde / nu se publică).
- **Nume din platformă — regula tulpinii (r3):** un cuvânt scris cu majusculă (sau după un titlu) care, fără diacritice și cu litere
  mici, este o componentă de nume din platformă **plus cel mult o terminație** dintr-o mulțime închisă (cel mult 4 litere):
  articol *-ul, -le*; genitiv-dativ *-ului, -lui, -ei, -ii, -i*; vocativ *-ule, -e*; plural *-i, -ii, -lor, -ilor* — se ascunde:
  „Popescului”, „Popescule”, „Stanului”, „POPESCU-ULUI”. Prenumele feminine: „Mariei”, „Olgăi”, „Andreei”, „Anei”. Un cuvânt cu
  cratimă cu o parte cunoscută se ascunde întreg („Ionescu-Popescu”, „Maria-Ioana”). Caracterele invizibile din interiorul unui
  nume / CNP (spațiu de lățime zero, cratimă moale din PDF-uri copiate) nu îl mai despart.
  - **Compromisul pentru componentele scurte (3 litere: Ion, Dan, Ana):** se recunosc doar exact și în genitivul feminin („Anei”);
    cu terminații ar lovi cuvinte comune („Ani”, „Dane”, „Ionul”). Deci „Ionului” singur rămâne.
  - **Compromisul pentru componentele care sunt și cuvinte comune** (lista scurtă `COMUNE`: Mare, Ion, Preda, Lungu …): scrise
    SINGURE, fără titlu, fără alt nume lângă și fără ca numele întreg să fi apărut în speță, rămân („Mare parte din lucrare”).
- **Același nume, peste tot în speță (r3):** după ce un nume (persoană sau firmă) a fost recunoscut în titlu, speță, context, sursă
  sau răspuns, fiecare componentă a lui se ascunde în **tot** restul spețe, cu aceeași etichetă, chiar dacă singură ar fi cuvânt
  comun: „Ion Mare răspunde de lucrare. Ion cere avizul.” → „[PERSOANA_1] … [PERSOANA_1_F2] cere avizul.”. Titlul, speța și
  contextul se citesc toate ÎNAINTE de mascare (un nume din context se ascunde și în titlu); în plus, fiecare mesaj spre model se
  mai maschează o dată chiar înainte de trimitere. Nu se propagă: cuvintele generice de firmă („Construct”, „Instal”, „Grup”),
  entitățile publice și cuvintele scrise cu literă mică.
- **Nume necunoscute platformei, dacă au un titlu în față:** „dl.”, „dna”, „ing.”, „arh.”, „dr.”, „colegul”, „șeful”,
  „dirigintele”, „maistrul”, „sudorul”, „șoferul” etc. După un titlu se ascunde și un nume care e și cuvânt obișnuit („dl. Ion”,
  „ing. Mare” — r2); la fel două nume din platformă alăturate („Ion Mare”).
- **Firme:** orice nume urmat de SRL / SA / PFA / II / IF / SNC / SCS (cu sau fără puncte, cu sau fără „SC” în față, între ghilimele).
  **Firmele din lista platformei (r3):** potrivirea e pe șirul de cuvinte al numelui, fără deosebire de majuscule, fără diacritice,
  cu orice punctuație între cuvinte și fără forma juridică; găsit în orice scriere, numele se ascunde întreg, împreună cu forma
  juridică lipită: „Engie servicii SRL”, „Gamma, Feronerie”, „GAMMA-FERONERIE”, „gamma feronerie srl”.
- **Intrările din listă fără valoare de identificare se aruncă la încărcare (r3)** și se numără în jurnalul de pornire: o intrare
  făcută doar din cuvinte de umplutură ale coloanelor scrise liber („diverse”, „persoana fizica”, „furnizor”, „client”,
  „necunoscut” …) și o firmă dintr-un singur cuvânt comun (cuvintele generice de firmă, termenii tehnici din vocabularul aprobat
  pentru căutări — „Montaj”, „Gaz” —, sub 4 litere, doar cifre, o localitate cunoscută).
- **Date personale după tipar:** CNP (cu cifra de control), CUI cu „RO” / „CUI” / „cod fiscal” în față sau cunoscut platformei,
  telefoane românești, e-mailuri, IBAN (cu verificarea de control), numere de înmatriculare românești.
- **Ce ascunde omul:** orice cuvânt scris între `[[` și `]]` (sau selectat și ascuns cu butonul „🙈 Ascunde selecția”), și orice
  formă de etichetă scrisă de el („[PERSOANA_1]”, „persoana 1”, cu rând nou în ea) — pleacă `[ASCUNS_n]` și se pune la loc exact.

## Localitățile rămân vizibile (decizia owner-ului, r3)
- Cuvântul de după un **marcaj de localitate** rămâne: „comuna”, „com.”, „satul”, „sat”, „orașul”, „municipiul”, „localitatea”,
  „județul”, „jud.”, „UAT” (și formele „comunei”, „satului” …; abrevierile cu punct), plus cel mult două cuvinte cu majusculă lipite
  de el care nu sunt nume din platformă („comuna Valea Călugărească”). Un nume care urmează după localitate se ascunde în continuare
  („comuna Berceni Ana Popescu” → „comuna Berceni [PERSOANA_1]”).
- Un cuvânt care e **localitate cunoscută platformei** rămâne când apare FĂRĂ titlu și fără alt nume din platformă lângă el. Sursa:
  denumirile UAT-urilor și satele programate din `red_uat` (tabel pe care funcția edge îl citea deja pentru reprezentanți) — fără
  tabele noi.
- **Conflictul nume de familie = localitate:** cu titlu sau cu prenume lângă = persoană (se ascunde: „dl. Berceni”, „Berceni Ana”,
  „Ana Berceni”); altfel = localitate (rămâne: „Berceni are teren”, „Primăria Berceni”). Consecința asumată: un nume de familie
  care e și localitate cunoscută, scris singur, rămâne vizibil chiar dacă persoana a fost numită în aceeași speță.
- Deținătorii de teren din Redări rămân în lista de mascare (persoane fizice — decizia inițială „numele se ascund”), cu regula de
  mai sus pentru numele care sunt și localități.
- Previzualizarea din ecran nu are lista de localități: acolo un asemenea nume scris singur apare ascuns (pe server rămâne).

## Ce NU prinde (limite asumate)
- nume necunoscute platformei, scrise fără titlu în față (ex. „a zis Vasilescu”);
- porecle, inițiale („I. P.”), nume scrise cu literă mică (inclusiv o componentă deja văzută, scrisă cu literă mică);
- forme flexionate neregulate („Popeștii”) și componentele de 3 litere cu alte terminații decât genitivul feminin („Ionului”);
- un cuvânt comun din `COMUNE` scris singur, fără ca numele întreg să fi apărut în speță (vezi compromisul de mai sus);
- firme scrise fără formă juridică și care nu sunt în lista platformei;
- localități (vizibile prin decizia owner-ului — vezi mai sus), adrese, numere de contract / carte funciară / cadastru;
- CUI scris fără „RO” / „CUI” în față și necunoscut platformei.

## Entitățile publice care rămân vizibile (decizia owner-ului, 13.11.2026)
După review-ul PR #1086, owner-ul a decis explicit, pe 13.11.2026: (1) **operatorii de rețea, firmele / instituțiile publice și
Gazpet rămân vizibile** — cerințele lor sunt chiar subiectul întrebărilor; (2) **atașamentele rămân oprite** (nu se trimit la
model); (3) **localitățile rămân vizibile**.

Excepția e strânsă și explicită:
- lista stă într-un **singur loc**, `worker/intrebari-tehnice/nemascate.json`, citit de worker (`mascare.py`) și de ecran
  (`src/intrebariMascare.js`); testele pică dacă apare o listă scrisă în cod sau dacă cele două citiri diferă;
- fiecare intrare are o **categorie**: operator de rețea (Transgaz, Delgaz Grid / E.ON, Distrigaz Sud Rețele, Engie România,
  Premier Energy, Transelectrica, Electrica, Apa Nova București), companie publică (Romgaz, Hidroelectrica), instituție publică
  (ANRE), societatea noastră (Gazpet Instal). **Fără** furnizori, subcontractori, clienți privați sau persoane;
- potrivirea e pe **numele întreg** al entității (fără SRL / SA, cu inițialele lipite: „S.N.T.G.N. Transgaz S.A.” = „sntgn
  transgaz”), nu pe un cuvânt din el: „Transgaz Construct SRL”, „Delgaz Instal SRL”, „Gazpet Montaj SRL” sau „Romgaz Service”
  (firme private inventate, cu nume asemănător) se ascund; „Transgaz”, „TRANSGAZ”, „SNTGN Transgaz SA”, „S.N.T.G.N. TRANSGAZ
  S.A.”, „directorul Transgaz”, „E.ON”, „GAZPET INSTAL SRL”, „SC Gazpet Instal S.R.L.” rămân;
- **orice adăugare în listă = decizia owner-ului, prin coordonator** (PR cu categoria și motivul). Un fișier stricat sau o intrare
  fără categorie permisă oprește workerul la pornire (nu se maschează „pe jumătate”).

## Cum arată în ecran
- Sub speță apare **„🙈 Ce pleacă la AI — verifică înainte de trimitere”**: textul cu etichetele evidențiate și rezumatul
  („Am ascuns 3 nume și date (1 persoană, 1 firmă, 1 telefon). Ce nu e ascuns aici pleacă așa.”), plus ce nu prinde mascarea.
- Butonul **„🙈 Ascunde selecția”** pune cuvântul selectat între `[[ ]]`; se poate scrie și de mână.
- Dacă colegul atașează fișiere: „Atașamentele rămân în ERP pentru colegi, dar NU se trimit la AI.”
- Previzualizarea folosește numele pe care contul colegului le poate citi. Dacă nu le poate citi, ecranul spune asta; pe server se
  ascund oricum toate numele din platformă (deci pleacă cel mult ce arată previzualizarea).

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
- Există un singur drum spre furnizor. Fiecare mesaj trece prin mascare chiar în funcția care construiește cererea.
- Înainte de orice trimitere, o gardă verifică cererea: conținutul trebuie să fie exact de tipul „text mascat” **și produs de
  mascarea acelei întrebări** (r2: un „text mascat” făcut de mână, sau al altei întrebări, e refuzat). Un text construit după
  mascare (lipit, tăiat), un atașament, alt prompt sau altă unealtă oprește cererea înainte să plece. Aceeași gardă se aplică la
  propunerea de căutări, la căutările web, la răspuns și la reparare. Limita: garda prinde greșelile de program, nu un cod
  rău-intenționat rulat în același proces (acela poate ocoli orice verificare).
- Fără lista de nume din platformă, workerul nu preia nicio întrebare (întrebările așteaptă în coadă).
- **Demascarea e strictă (r2):** se pun la loc doar etichetele emise pentru întrebarea aceea, scrise exact. Dacă în răspunsul
  modelului rămâne orice lucru de forma unei etichete care nu e una emisă — `[PERSOANA_999]`, o combinație cu una cunoscută,
  `[PERSOANA_1_F9]` (formă inventată), `[persoana_1]`, `PERSOANA_1` —, răspunsul **nu se publică**: colegul vede o eroare, iar
  jurnalul are doar motivul, fără textul modelului. Nimic nu se „repară” tăcut. Ce scrie colegul însuși de forma unei etichete
  pleacă ascuns (`[ASCUNS_n]`) și se pune la loc exact — rămâne al lui.
- **Etichetele rupte (r3, review P1-5):** pe lângă verificarea etichetelor scrise exact, o a doua verificare citește răspunsul
  fără niciun spațiu alb (rânduri noi, spațiu neîntreruptibil, caractere de lățime zero), cu majuscule și fără diacritice: orice
  „PERSOANA” / „FIRMA” / „CNP” / „CUI” / „TELEFON” / „EMAIL” / „IBAN” / „NR_AUTO” / „ASCUNS” urmat de cifre (cu sau fără paranteze,
  liniuțe) trebuie să fie începutul unei etichete emise, scrise exact, în acel loc. Altfel răspunsul nu se publică (motivul
  `eticheta_rupta` în jurnal, fără textul modelului): `[PERSOANA_` + rând nou + `999]`, un spațiu neîntreruptibil în etichetă,
  o etichetă corectă lângă una ruptă. Compromisul: un text obișnuit al modelului de forma „firma 2” sau „CUI 12345678” oprește și
  el publicarea (direcția prudentă); un prefix lipit de o literă din fața lui e coada unui cuvânt („confirma 2”), nu o etichetă.
- Dacă răspunsul ar ieși cu etichete în locul numelor (demascarea n-a avut loc), nu se publică: colegul vede o eroare.
- Testele pică dacă un drum nou spre furnizor ocolește mascarea, dacă demascarea lipsește sau e incompletă (testele „mutant”).

## Regula B: „Da” / „Nu” / „Incert”
- Sunt doar trei verdicte. „Depinde de …” devine „Incert — depinde de …”.
- **r3 (review P1-2): fără praguri și fără liste de cuvinte.** Recenzentul a găsit a doua oară câte un cuvânt nou care întoarce
  sensul și nu era în listă („exclus” / „inclus”); o listă de opuși nu se termină (minim / maxim, peste / sub, înainte / după,
  lipsește …). Regula nouă: „Da” sau „Nu” rămân DOAR dacă, pe un rând cu marcajul sursei (`[C1]`, `[W2]`), citatul dintre ghilimele
  este **IDENTIC cu o propoziție întreagă** a sursei marcate — niciun cuvânt lipsă, în plus sau schimbat. La comparare nu contează:
  majusculele, diacriticele, spațiile (și spațiile lângă punctuație), ghilimelele, felul liniuței („–”, „—”, „-”) și punctuația de la
  capete. Contează orice altceva, inclusiv o virgulă din interior. Propoziția are cel puțin 6 cuvinte.
- **Cum se despart propozițiile sursei:** la „.”, „!”, „?” urmate de spațiu și la rândul gol. NU după abrevieri („art.”, „alin.”,
  „pct.”, „lit.”, „nr.”, „ord.”, „HG”, „cap.”, „min.”, „max.” …), nici înaintea unei cifre sau a unei paranteze („art. 5”,
  „alin. (2)”), nici înaintea unei bucăți care începe cu o restricție („. Dar numai …”, „; cu excepția …”). **„;” și rândul simplu NU
  despart:** o enumerare („Nu se admit: a) …; b) …”) e o singură propoziție împreună cu introducerea ei, pentru că introducerea
  poate nega elementele — un element citat singur dă „Incert”. O despărțire greșită (o abreviere necunoscută, o enumerare lungă)
  face doar ca citatul să nu fie identic cu nimic → „Incert”, niciodată un „Da” în plus.
- Exemplul recenzentului: sursa „Montajul acestei conducte de distribuție este **exclus** în zona de protecție a instalației.”,
  citatul cu „**inclus**” → „Incert”; aceeași propoziție citată exact → „Nu” rămâne.
- **Limita rămasă, declarată:** o excepție aflată în ALTĂ propoziție a sursei (ex. propoziția următoare spune „Prevederea nu se
  aplică în zona podurilor.”) nu e văzută de regulă; omul vede citatul și sursa întreagă alăturate. La fel, o propoziție care
  conține ea însăși ghilimele nu poate fi citată (devine „Incert”).
- Fără un asemenea citat (inclusiv când modelul afirmă ferm fără citat), verdictul devine **„Incert — de verificat: niciun citat nu
  reproduce exact o propoziție întreagă dintr-o sursă — citește sursele alăturate.”**, iar ecranul pune **toate sursele consultate
  imediat sub verdict**. La „Da” / „Nu” rămân doar sursele citate, după text.
- Înainte de a trece la „Incert”, modelul primește o singură dată cererea să pună citatul (propoziția întreagă, exact); promptul
  îi cere același lucru de la început.
- Verificarea e pe text, nu pe sens: dacă citatul chiar răspunde la întrebare judecă omul, care vede citatul și sursa alăturate.

## Pașii de pornire (pentru coordonator — după review și „da”-ul lui Răzvan)
Nu e nevoie de migrare și nici de secrete noi. **Workerul stă OPRIT pe toată livrarea**, inclusiv cât se copiază fișierele: un
edge nou cu workerul vechi ar trimite speța NEMASCATĂ (workerul vechi nu știe de mascare și nici de atașamentele oprite); un worker
nou cu edge-ul vechi refuză preluarea (`nume_indisponibile`) — sigur, dar blocat. De aceea edge-ul nou se poate publica separat
DOAR cu workerul oprit. **Testul de fum se face cu rularea periodică încă dezactivată**; abia după el se reactivează. Ordinea:
1. **Workerul e oprit — dovedit, nu presupus (r3).** Existența unui fișier sau vechimea jurnalului NU dovedesc nimic. Dovada are
   trei părți, toate trei, pe serverul AI, în PowerShell (se notează rezultatul fiecăreia):
   - task-ul planificat e dezactivat: `schtasks /Change /TN "Intrebari tehnice worker (Gazpet)" /DISABLE`, apoi
     `(Get-ScheduledTask -TaskName "Intrebari tehnice worker (Gazpet)").State` → `Disabled`;
   - niciun proces al workerului: `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*intrebari_worker.py*" }`
     → nimic (dacă apare unul, se așteaptă să se termine — o rulare durează câteva minute — și se repetă verificarea);
   - lacătul de sistem e liber: cu Python-ul workerului, în folderul workerului,
     `python -c "import msvcrt; f=open('worker.lock','a+b'); msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1); print('LIBER')"`
     → `LIBER` (o eroare = o rulare ține lacătul: stop, se reia de la a doua verificare). Procesul se închide și eliberează lacătul.
   Fără toate trei nu se trece la pasul 2. Workerul rămâne dezactivat până la pasul 9.
2. Merge PR-ul (cod ecran + worker + edge).
3. Interogarea de verificare a coloanelor (secțiunea „De unde vin numele”, cu cele 4 coloane noi din `red_uat`) → 0 rânduri lipsă.
   Altfel: stop, PR de corectură pe `SURSE_NUME`.
4. Deploy edge `intrebari-tehnice-worker` (v3, `verify_jwt = false`, ca până acum): **`index.ts` și `logic.js` se publică ÎMPREUNĂ**
   (același deploy; `logic.js` are poarta, sursele de nume și localitățile — un `index.ts` fără el nu pornește, unul cu un
   `logic.js` vechi n-ar trimite localitățile). Aceleași setări: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, secretul din Vault
   `INTREBARI_WORKER_SECRET`. Starea de bază rămâne cea de după PR #1012 (migrarea 20261131e aplicată, edge v2).
5. Verificarea acțiunii `nume` FĂRĂ worker: un apel cu secretul → **200** cu `persoane`, `firme`, `cui` nevide și `localitati`
   (listă, poate fi goală) — se notează doar numărul lor, nu valorile; un apel fără antet / cu cheia anon / cu un JWT de cont
   obișnuit / cu un secret greșit → **401**. Orice alt rezultat: stop, workerul rămâne oprit.
6. Pe serverul AI, cu workerul încă oprit, copierea fișierelor workerului din `main` în folderul workerului: `intrebari_worker.py`,
   `cercetare.py`, **`mascare.py`**, **`nemascate.json`** și **`vocabular_web.json`** (fără ele workerul nu pornește — r3: mascarea
   citește și vocabularul), `corpus_manifest.json`. Se compară sha256 al fiecărui fișier copiat cu cel din `main`.
7. Testele workerului pe `main`, în clona repo-ului de pe server (aceeași versiune de Python ca workerul):
   `python -I -B -m unittest discover -s worker/intrebari-tehnice -p "test_*.py"` — toate OK (testele citesc și fișierele din
   `src/` și `supabase/`, deci nu se rulează din folderul workerului).
8. **Testul de fum controlat, cu task-ul încă DEZACTIVAT (r3):** coada are doar întrebarea de test a ownerului (o citire:
   câte rânduri `intrebari_tehnice` sunt în starea `noua`; dacă mai sunt și altele, se așteaptă sau se acceptă explicit că rularea le
   preia și pe ele — cel mult 3). Întrebarea de test are nume inventate, un genitiv și o localitate („Avizul revine lui Testescului;
   Ion Testescu, tel 0700 000 000, din comuna X”). Se pornește workerul **o singură dată, de mână** (aceeași comandă ca în task,
   rulată direct, nu prin task), apoi se verifică: răspunsul afișat are numele la loc și nicio etichetă; în jurnalul workerului apar
   `nume_incarcate` (doar numere: câte nume, câte intrări aruncate), apoi `mascate` (numere pe categorii), `inlocuiri`,
   `regula_b` — fără valori; procesul s-a încheiat (verificarea din pasul 1, a doua parte). Orice abatere: stop, workerul rămâne
   dezactivat, se raportează.
9. Abia acum se reactivează rularea periodică: `schtasks /Change /TN "Intrebari tehnice worker (Gazpet)" /ENABLE`, iar
   `(Get-ScheduledTask -TaskName "Intrebari tehnice worker (Gazpet)").State` → `Ready`.
10. Registrul: rândul de mai jos în `registru_automatizari` și în `public.automatizari` (fără valori de secrete).

Revenirea: workerul se oprește întâi (pasul 1, cu toate trei verificările), apoi edge-ul (`index.ts` + `logic.js` împreună) și
fișierele workerului se întorc împreună la versiunea anterioară.

## Rândul propus pentru `registru_automatizari` (înlocuiește fișa „Întreabă echipa”)
**Întreabă echipa (intrebari-tehnice-worker) — actualizare 13.11.2026: mascarea numelor (A) + regula „Da / Nu / Incert” (B).**
- **Ce**: spețe tehnice din ERP (`/intrebari`) → răspuns AI informativ, din cercetare, vizibil doar autorului și ownerului. Din
  13.11: numele de persoane / firme și datele personale se ascund înainte de orice apel la furnizor și se pun la loc doar în textul
  afișat; atașamentele nu se mai trimit la furnizor; „Da” / „Nu” doar cu un citat identic cu o propoziție întreagă a sursei,
  altfel „Incert” cu sursele alăturate.
- **(a) Conținut extern**: textul spețelor (scris de colegi), paginile oficiale găsite de căutarea web (domenii fixe), extrasele din
  corpusul intern. Atașamentele rămân în ERP și nu mai ajung la model. Nou, intern: numele angajaților și ale terților (citite de
  edge din BD din tabelele `SURSE_NUME`, doar coloanele de nume / CUI, plus denumirile UAT / satele din `red_uat` ca listă de
  localități care NU se ascund) — folosite doar pentru mascare, în memoria workerului.
- **(b) Ce poate scrie / face**: doar răspunsul sau eroarea pe rândul întrebării preluate + jurnalul de preluări + notificarea
  autorului. Fără mail, bani sau drepturi. Edge-ul doar citește numele (fără scriere).
- **(c) Identitate**: edge cu `service_role` (serverul AI n-are cont Supabase; RPC-urile workerului și citirea listei de nume îl
  cer — coloane fixe, doar către worker); workerul apelează furnizorul cu cheia API a firmei, nu cu abonamentul. Fiecare cerere spre
  furnizor trece prin mascare și prin garda tipului „text mascat”.
- **(d) Cine pornește**: doar deținătorul `INTREBARI_WORKER_SECRET` (verificat în BD, fail closed). Întrebările le pun doar cei cu
  cheia de modul `intrebari_tehnice` (sau ownerul), 5 / zi / utilizator, plafon global 40 de preluări / zi.
- **(e) Confirmare umană**: nu e cazul (răspunsul e informativ, nu produce acțiuni). Accesul la modul și schimbările listei de
  entități nemascate (`nemascate.json`) se fac doar cu „da”-ul lui Răzvan (PR).
- **Secrete (doar nume)**: `INTREBARI_WORKER_SECRET` (Vault + fișierul de secret de pe serverul AI), cheia API Anthropic
  (Credential Manager). Nimic nou.
- **Oprire**: dezactivezi task-ul din Task Scheduler + `automatizari.stare = oprit`. Fără listă de nume (edge oprit / vechi) workerul
  nu preia nimic.

## Decis de Răzvan (13.11.2026, după review-ul PR #1086)
1. **Entitățile publice** (operatori de rețea, companii / instituții publice, Gazpet) rămân vizibile — lista închisă din
   `nemascate.json`, vezi mai sus.
2. **Atașamentele** rămân oprite (nu se trimit la AI).
3. **Localitățile** rămân vizibile — r3: regula din secțiunea „Localitățile rămân vizibile” (marcaj + localitățile cunoscute din
   `red_uat`; conflictul nume = localitate: cu titlu sau prenume lângă = persoană, altfel localitate). Nu mai e nimic „de confirmat”
   aici.
4. **Deținătorii de teren din Redări** rămân în lista de mascare (persoane fizice, sub decizia „numele se ascund”), cu regula de la 3
   pentru numele care sunt și localități.
