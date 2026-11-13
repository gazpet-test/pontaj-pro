# ❓ Întreabă echipa — numele ascunse și regula „Da / Nu / Incert” (deciziile owner-ului, 13.11.2026)

Documentul pentru owner și coordonator. Partea tehnică (fișiere, teste) e în `worker/intrebari-tehnice/README.md`.

## Ce s-a decis
- **A. Numele nu pleacă la furnizorul modelului.** Numele de persoane și de firme din întrebare se ascund înainte de trimitere și
  se pun la loc în răspunsul afișat. Variantele respinse: răspuns doar din documentele noastre; trimitere integrală cu avertisment.
- **B. „Da” / „Nu” doar când o sursă spune aproape cuvânt cu cuvânt același lucru.** Altfel răspunsul e „Incert”, cu sursele
  alăturate ca să le citească omul.

## Ce pleacă și ce nu pleacă în afară
| | Pleacă la furnizorul modelului? |
|---|---|
| Titlul, speța, contextul | DA, dar cu numele și datele personale înlocuite de etichete: `[PERSOANA_1]`, `[FIRMA_1]`, `[CNP_1]`, `[CUI_1]`, `[TELEFON_1]`, `[EMAIL_1]`, `[IBAN_1]`, `[NR_AUTO_1]`, `[ASCUNS_1]` |
| Tabelul „etichetă → nume” | NU. Stă doar în memoria workerului, cât se lucrează la o întrebare; nu se scrie nici pe disc, nici în jurnal |
| Lista de nume din platformă (angajați, terți, CUI-uri) | NU. Workerul o primește de la ERP și o folosește doar ca să găsească numele în text |
| Atașamentele (PDF / poze) | **NU, de acum.** Numele din ele nu pot fi ascunse sigur. Rămân în ERP pentru colegi; modelul află doar că există |
| Extrasele din documentele noastre de cercetare și din paginile oficiale | DA (trec și ele prin mascare) |
| Căutarea pe web | DA, doar căutarea compusă de program din lista aprobată de cuvinte, ca până acum (fără nume, fără speță) |
| Jurnalul workerului | Rămâne pe server și are doar numere: câte nume / date s-au ascuns, pe categorii. Nu are valori |

Aceeași persoană primește aceeași etichetă pe toată întrebarea: în titlu, în speță, în context, la reparare. Altă formă scrisă a
aceluiași nume (ordinea inversă „Popescu Ion” / „Ion Popescu”, genitivul „Mariei”, firma cu sau fără „SC”) primește același număr cu
un indice: `[PERSOANA_1_F2]`. Exemplele din acest document sunt inventate.

## Ce prinde mascarea
- **Nume din platformă:** angajații, persoanele de contact și terții (lista completă a surselor e mai jos), cu sau fără diacritice,
  scrise „NUME Prenume” sau invers, cu majuscule, cu un al doilea prenume, la genitiv / dativ — și cele scurte: „Anei”, „Mariei”,
  „Andreei”, „Olgăi” (r2) — sau cu sufix („Popescu-ului”).
- **Nume necunoscute platformei, dacă au un titlu în față:** „dl.”, „dna”, „ing.”, „arh.”, „dr.”, „colegul”, „șeful”,
  „dirigintele”, „maistrul”, „sudorul”, „șoferul” etc. După un titlu se ascunde și un nume care e și cuvânt obișnuit („dl. Ion”,
  „ing. Mare” — r2); la fel două nume din platformă alăturate („Ion Mare”).
- **Firme:** orice nume urmat de SRL / SA / PFA / II / IF / SNC / SCS (cu sau fără puncte, cu sau fără „SC” în față, între ghilimele)
  și firmele din lista platformei, și fără formă juridică.
- **Date personale după tipar:** CNP (cu cifra de control), CUI cu „RO” / „CUI” / „cod fiscal” în față sau cunoscut platformei,
  telefoane românești, e-mailuri, IBAN (cu verificarea de control), numere de înmatriculare românești.
- **Ce ascunde omul:** orice cuvânt scris între `[[` și `]]` (sau selectat și ascuns cu butonul „🙈 Ascunde selecția”).

## Ce NU prinde (limite asumate)
- nume necunoscute platformei, scrise fără titlu în față (ex. „a zis Vasilescu”);
- porecle, inițiale („I. P.”), nume scrise cu literă mică;
- **un prenume din platformă care e și cuvânt obișnuit, scris SINGUR** — fără titlu și fără alt nume lângă („Ion e un atom
  încărcat”, „Mare parte din lucrare”). Compromisul ales (r2): contextul (titlul sau al doilea nume) decide; fără el, cuvântul
  rămâne, ca să nu ascundem jumătate din textul tehnic. Lista acestor cuvinte (`COMUNE`) e scurtă și e aceeași în Python și JS;
- genitivele masculine cu articol lipit („Popescului”), formele de vocativ („Ioane”);
- firme scrise fără formă juridică și care nu sunt în lista platformei;
- localități — **rămân vizibile prin decizia owner-ului** (13.11.2026) —, adrese, numere de contract / carte funciară / cadastru;
  un nume de familie identic cu o localitate se ascunde însă și ca localitate (numele contează mai mult);
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
| `red_uat` | reprezentant_uat_nume | | | migrare 20261126a |
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
  ('red_proiecte','contact_nume'),('red_uat','reprezentant_uat_nume'),('ofertare_oferte_furnizori','furnizor'),
  ('ofertare_preturi_materiale','furnizor'),('contracte_subcontract_facturi','furnizor_text'),('executie_tura_subcontractori','firma_text'),
  ('facturi_emise','contact_nume'),('facturi_emise','delegat_nume'),('facturi_emise','beneficiar_nume'),('facturi_emise','beneficiar_cif'),
  ('logistica_transporturi','sofer_extern_nume'),('eip_intrari','furnizor_nume'),('eip_intrari','furnizor_cui'),
  ('izo_documente_intrare','furnizor'),('izo_documente_intrare','furnizor_cif')
) AS t(tabel, coloana)
LEFT JOIN information_schema.columns c ON c.table_schema = 'public' AND c.table_name = t.tabel AND c.column_name = t.coloana
WHERE c.column_name IS NULL;   -- trebuie să întoarcă 0 rânduri
```
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
- Dacă răspunsul ar ieși cu etichete în locul numelor (demascarea n-a avut loc), nu se publică: colegul vede o eroare.
- Testele pică dacă un drum nou spre furnizor ocolește mascarea, dacă demascarea lipsește sau e incompletă (testele „mutant”).

## Regula B: „Da” / „Nu” / „Incert”
- Sunt doar trei verdicte. „Depinde de …” devine „Incert — depinde de …”.
- „Da” sau „Nu” rămân doar dacă răspunsul are, pe un rând cu marcajul sursei (`[C1]`, `[W2]`), un **citat** între ghilimele care
  trece pragul „aproape cuvânt cu cuvânt”:
  - citatul are cel puțin **6 cuvinte**;
  - cel puțin **90%** din cuvintele lui apar **în aceeași ordine** într-o singură propoziție a sursei marcate (deci cel mult un
    cuvânt din zece diferit; diacriticele și majusculele nu contează);
  - cifrele lui (cu semn și unitate) sunt aceleași ca în sursă, iar condițiile sursei („numai după …”, „cu excepția …”,
    „dar …”) nu sunt tăiate;
  - **cuvintele care întorc sensul stau pe aceleași locuri ca în sursă (r2, review P1-3).** Citatul se aliniază cuvânt cu cuvânt
    cu propoziția sursei, iar aceste cuvinte nu intră în toleranța de „un cuvânt din zece”:
    - negațiile — *nu, nici, niciun / nicio, niciodată, nimic, nimeni, fără, exceptând, excepția, decât* și *ne-* în fața lui
      *admis, permis, conform, autorizat, obligatoriu, avizat, respectat, îndeplinit, corespunzător, valid, acceptat,
      recepționat*: fiecare din citat trebuie să fie în sursă pe aceeași poziție, iar fiecare din **toată** propoziția sursei
      trebuie să fie în citat (o negație lăsată afară poate răsturna fragmentul: „Nu este corect ca …”);
    - obligație / permisiune — *trebuie, poate / pot, obligatoriu, opțional, facultativ, interzis, admis / admite, permis /
      permite, recomandat*: fiecare din citat trebuie să fie în sursă pe aceeași poziție; cele din sursă contează doar în partea
      citată (un „se pot repara” din altă parte a propoziției nu strică citatul, un „trebuie” scos din mijlocul lui da).

    Exemplu (contraexemplul recenzentului): sursa „Documentația **nu conține** avizul … și raportul **conține** toate
    verificările …”, citatul „Documentația **conține** avizul … și raportul **nu conține** toate verificările …” → „Incert”.
    Compromisul: o propoziție lungă cu o negație în altă parte decât fragmentul citat trebuie citată întreagă, altfel „Incert” —
    preferăm un „Incert” în plus unui „Da” răsturnat.
- Fără un asemenea citat (inclusiv când modelul afirmă ferm fără citat), verdictul devine **„Incert — de verificat: nicio sursă nu
  spune aproape cuvânt cu cuvânt același lucru — citește sursele alăturate.”**, iar ecranul pune **toate sursele consultate imediat
  sub verdict**. La „Da” / „Nu” rămân doar sursele citate, după text.
- Înainte de a trece la „Incert”, modelul primește o singură dată cererea să pună citatul (aceeași reparare ca până acum).
- Verificarea e pe cuvinte, nu pe sens: dacă citatul chiar răspunde la întrebare judecă omul, care vede citatul și sursa alăturate.

## Pașii de pornire (pentru coordonator — după review și „da”-ul lui Răzvan)
Nu e nevoie de migrare și nici de secrete noi. **Workerul stă OPRIT pe toată livrarea**, inclusiv cât se copiază fișierele: un
edge nou cu workerul vechi ar trimite speța NEMASCATĂ (workerul vechi nu știe de mascare și nici de atașamentele oprite); un worker
nou cu edge-ul vechi refuză preluarea (`nume_indisponibile`) — sigur, dar blocat. De aceea edge-ul nou se poate publica separat
DOAR cu workerul oprit. Ordinea exactă:
1. **Workerul e oprit — verificat, nu presupus:** task-ul planificat al workerului dezactivat, nicio rulare în curs (lacătul
   `worker.lock` liber / niciun proces al workerului), iar ultima linie din jurnalul workerului e mai veche decât oprirea. Fără
   această verificare nu se trece la pasul 2.
2. Merge PR-ul (cod ecran + worker + edge).
3. Interogarea de verificare a coloanelor de mai sus (secțiunea „De unde vin numele”) → 0 rânduri lipsă. Altfel: stop, PR de
   corectură pe `SURSE_NUME`.
4. Deploy edge `intrebari-tehnice-worker` (v3, `verify_jwt = false`, ca până acum): poarta pe secret (neschimbată ca regulă) +
   acțiunea `nume` cu sursele noi + `logic.js` (fișier nou, publicat odată cu `index.ts`). Aceleași setări: `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, secretul din Vault `INTREBARI_WORKER_SECRET`. Starea de bază rămâne cea de după PR #1012
   (migrarea 20261131e aplicată, edge v2).
5. Verificarea acțiunii `nume` FĂRĂ worker: un apel cu secretul → 200 cu trei liste nevide (doar numărul lor se notează, nu
   valorile); un apel fără antet / cu cheia anon / cu un JWT de cont obișnuit / cu un secret greșit → 401.
6. Pe serverul AI, cu workerul încă oprit, copierea fișierelor workerului din `main` în folderul workerului: `intrebari_worker.py`,
   `cercetare.py`, **`mascare.py`** și **`nemascate.json` (fișier nou — fără el workerul nu pornește)**, `vocabular_web.json`,
   `corpus_manifest.json`. Se compară sha256 al fiecărui fișier copiat cu cel din `main`.
7. Testele workerului pe `main`, în clona repo-ului de pe server (aceeași versiune de Python ca workerul):
   `python -I -B -m unittest discover -s worker/intrebari-tehnice -p "test_*.py"` — toate OK (testele citesc și fișierele din
   `src/` și `supabase/`, deci nu se rulează din folderul workerului).
8. Abia acum workerul se reactivează. Verificare: o întrebare de test a ownerului, cu nume inventate („Ion Testescu, tel
   0700 000 000”) → răspunsul afișat are numele la loc; în jurnalul workerului apar doar `mascate` (numere pe categorii),
   `inlocuiri`, `regula_b`, fără valori.
9. Registrul: rândul de mai jos în `registru_automatizari` și în `public.automatizari` (fără valori de secrete).

Revenirea: workerul se oprește întâi, apoi edge-ul și fișierele workerului se întorc împreună la versiunea anterioară.

## Rândul propus pentru `registru_automatizari` (înlocuiește fișa „Întreabă echipa”)
**Întreabă echipa (intrebari-tehnice-worker) — actualizare 13.11.2026: mascarea numelor (A) + regula „Da / Nu / Incert” (B).**
- **Ce**: spețe tehnice din ERP (`/intrebari`) → răspuns AI informativ, din cercetare, vizibil doar autorului și ownerului. Din
  13.11: numele de persoane / firme și datele personale se ascund înainte de orice apel la furnizor și se pun la loc doar în textul
  afișat; atașamentele nu se mai trimit la furnizor; „Da” / „Nu” doar cu citat aproape cuvânt cu cuvânt, altfel „Incert” cu sursele
  alăturate.
- **(a) Conținut extern**: textul spețelor (scris de colegi), paginile oficiale găsite de căutarea web (domenii fixe), extrasele din
  corpusul intern. Atașamentele rămân în ERP și nu mai ajung la model. Nou, intern: numele angajaților și ale terților (citite de
  edge din BD din tabelele `SURSE_NUME`, doar coloanele de nume / CUI) — folosite doar pentru mascare, în memoria workerului.
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
3. **Localitățile** rămân vizibile.

## De confirmat de Răzvan (cu recomandare)
1. **Deținătorii de teren din Redări** (`red_detinatori`, mii de nume pe proiect) intră în lista de mascare. **A (implementat,
   recomandat)**: da — sunt persoane fizice; costul e că un nume de familie identic cu o localitate se ascunde și ca localitate.
   **B**: nu intră (se ascund doar dacă au titlu în față, ex. „dl.”).
