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
- **Nume din platformă:** angajații, persoanele de contact și terții (furnizori, beneficiari), cu sau fără diacritice, scrise
  „NUME Prenume” sau invers, cu majuscule, cu un al doilea prenume, la genitiv („Mariei”) sau cu sufix („Popescu-ului”).
- **Nume necunoscute platformei, dacă au un titlu în față:** „dl.”, „dna”, „ing.”, „arh.”, „dr.”, „colegul”, „șeful”,
  „dirigintele”, „maistrul”, „sudorul”, „șoferul” etc.
- **Firme:** orice nume urmat de SRL / SA / PFA / II / IF / SNC / SCS (cu sau fără puncte, cu sau fără „SC” în față, între ghilimele)
  și firmele din lista platformei, și fără formă juridică.
- **Date personale după tipar:** CNP (cu cifra de control), CUI cu „RO” / „CUI” / „cod fiscal” în față sau cunoscut platformei,
  telefoane românești, e-mailuri, IBAN (cu verificarea de control), numere de înmatriculare românești.
- **Ce ascunde omul:** orice cuvânt scris între `[[` și `]]` (sau selectat și ascuns cu butonul „🙈 Ascunde selecția”).

## Ce NU prinde (limite asumate)
- nume necunoscute platformei, scrise fără titlu în față (ex. „a zis Vasilescu”);
- porecle, inițiale („I. P.”), nume scrise cu literă mică;
- firme scrise fără formă juridică și care nu sunt în lista de terți;
- localități, adrese, numere de contract / carte funciară / cadastru (decizia A acoperă persoane și firme);
- CUI scris fără „RO” / „CUI” în față și necunoscut platformei.

Intenționat **NU se ascund** firmele publice și operatorii de rețea, al căror nume ține de normativ (Transgaz, Delgaz, Distrigaz,
Engie, E.ON, Romgaz, Premier Energy, Electrica, Transelectrica, Hidroelectrica, Apa Nova) și Gazpet. Lista e închisă și versionată
(`NEMASCATE` în `worker/intrebari-tehnice/mascare.py` și în `src/intrebariMascare.js`); o schimbare se face doar prin PR.

## Cum arată în ecran
- Sub speță apare **„🙈 Ce pleacă la AI — verifică înainte de trimitere”**: textul cu etichetele evidențiate și rezumatul
  („Am ascuns 3 nume și date (1 persoană, 1 firmă, 1 telefon). Ce nu e ascuns aici pleacă așa.”), plus ce nu prinde mascarea.
- Butonul **„🙈 Ascunde selecția”** pune cuvântul selectat între `[[ ]]`; se poate scrie și de mână.
- Dacă colegul atașează fișiere: „Atașamentele rămân în ERP pentru colegi, dar NU se trimit la AI.”
- Previzualizarea folosește numele pe care contul colegului le poate citi. Dacă nu le poate citi, ecranul spune asta; pe server se
  ascund oricum toate numele din platformă (deci pleacă cel mult ce arată previzualizarea).

## Garda (verificată în cod, nu prin convenție)
- Există un singur drum spre furnizor. Fiecare mesaj trece prin mascare chiar în funcția care construiește cererea.
- Înainte de orice trimitere, o gardă verifică cererea: conținutul trebuie să fie exact de tipul „text mascat”, pe care îl produce
  doar mascarea. Un text construit după mascare (lipit, tăiat), un atașament, alt prompt sau altă unealtă oprește cererea înainte să
  plece. Aceeași gardă se aplică la propunerea de căutări, la căutările web, la răspuns și la reparare.
- Fără lista de nume din platformă, workerul nu preia nicio întrebare (întrebările așteaptă în coadă).
- Dacă răspunsul ar ieși cu etichete în locul numelor (demascarea n-a avut loc), nu se publică: colegul vede o eroare.
- Testele pică dacă un drum nou spre furnizor ocolește mascarea sau dacă demascarea lipsește (testele „mutant”).

## Regula B: „Da” / „Nu” / „Incert”
- Sunt doar trei verdicte. „Depinde de …” devine „Incert — depinde de …”.
- „Da” sau „Nu” rămân doar dacă răspunsul are, pe un rând cu marcajul sursei (`[C1]`, `[W2]`), un **citat** între ghilimele care
  trece pragul „aproape cuvânt cu cuvânt”:
  - citatul are cel puțin **6 cuvinte**;
  - cel puțin **90%** din cuvintele lui apar **în aceeași ordine** într-o singură propoziție a sursei marcate (deci cel mult un
    cuvânt din zece diferit; diacriticele și majusculele nu contează);
  - cifrele lui (cu semn și unitate) sunt aceleași ca în sursă, negația e aceeași, iar condițiile sursei („numai după …”,
    „cu excepția …”, „dar …”) nu sunt tăiate.
- Fără un asemenea citat (inclusiv când modelul afirmă ferm fără citat), verdictul devine **„Incert — de verificat: nicio sursă nu
  spune aproape cuvânt cu cuvânt același lucru — citește sursele alăturate.”**, iar ecranul pune **toate sursele consultate imediat
  sub verdict**. La „Da” / „Nu” rămân doar sursele citate, după text.
- Înainte de a trece la „Incert”, modelul primește o singură dată cererea să pună citatul (aceeași reparare ca până acum).
- Verificarea e pe cuvinte, nu pe sens: dacă citatul chiar răspunde la întrebare judecă omul, care vede citatul și sursa alăturate.

## Pașii de pornire (pentru coordonator — după review și „da”-ul lui Răzvan)
Nu e nevoie de migrare și nici de secrete noi. Ordinea contează:
1. Merge PR-ul (cod ecran + worker + edge).
2. Deploy edge `intrebari-tehnice-worker` (v3, `verify_jwt = false`, ca până acum): adaugă acțiunea `nume`. Edge-ul folosește
   aceleași setări ca înainte: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, secretul din Vault `INTREBARI_WORKER_SECRET`.
   Starea de bază rămâne cea de după PR #1012 (migrarea 20261131e aplicată, edge v2).
3. Abia apoi, pe serverul AI, copierea fișierelor workerului din `main` în folderul workerului: `intrebari_worker.py`,
   `cercetare.py`, **`mascare.py` (fișier nou — fără el workerul nu pornește)**, `vocabular_web.json`, `corpus_manifest.json`.
   Un worker nou cu un edge vechi (fără `nume`) nu preia nimic și scrie `nume_indisponibile` în jurnal — sigur, dar blocat.
4. Secretele rămân aceleași (doar numele): `INTREBARI_WORKER_SECRET` (Vault + fișierul de secret de pe server), cheia API
   Anthropic din Credential Manager. Căutarea web rămâne activată în Console pentru workspace-ul cheii.
5. Verificare: o întrebare de test a ownerului, cu nume inventate („Ion Testescu, tel 0700 000 000”) → răspunsul afișat are
   numele la loc; în jurnalul workerului apar doar `mascate` (numere pe categorii), `inlocuiri`, `regula_b`, fără valori.
6. Registrul: rândul de mai jos în `registru_automatizari` și în `public.automatizari` (fără valori de secrete).

## Rândul propus pentru `registru_automatizari` (înlocuiește fișa „Întreabă echipa”)
**Întreabă echipa (intrebari-tehnice-worker) — actualizare 13.11.2026: mascarea numelor (A) + regula „Da / Nu / Incert” (B).**
- **Ce**: spețe tehnice din ERP (`/intrebari`) → răspuns AI informativ, din cercetare, vizibil doar autorului și ownerului. Din
  13.11: numele de persoane / firme și datele personale se ascund înainte de orice apel la furnizor și se pun la loc doar în textul
  afișat; atașamentele nu se mai trimit la furnizor; „Da” / „Nu” doar cu citat aproape cuvânt cu cuvânt, altfel „Incert” cu sursele
  alăturate.
- **(a) Conținut extern**: textul spețelor (scris de colegi), paginile oficiale găsite de căutarea web (domenii fixe), extrasele din
  corpusul intern. Atașamentele rămân în ERP și nu mai ajung la model. Nou, intern: numele angajaților și ale terților (citite de
  edge din BD, doar coloanele de nume / CUI) — folosite doar pentru mascare, în memoria workerului.
- **(b) Ce poate scrie / face**: doar răspunsul sau eroarea pe rândul întrebării preluate + jurnalul de preluări + notificarea
  autorului. Fără mail, bani sau drepturi. Edge-ul doar citește numele (fără scriere).
- **(c) Identitate**: edge cu `service_role` (serverul AI n-are cont Supabase; RPC-urile workerului și citirea listei de nume îl
  cer — coloane fixe, doar către worker); workerul apelează furnizorul cu cheia API a firmei, nu cu abonamentul. Fiecare cerere spre
  furnizor trece prin mascare și prin garda tipului „text mascat”.
- **(d) Cine pornește**: doar deținătorul `INTREBARI_WORKER_SECRET` (verificat în BD, fail closed). Întrebările le pun doar cei cu
  cheia de modul `intrebari_tehnice` (sau ownerul), 5 / zi / utilizator, plafon global 40 de preluări / zi.
- **(e) Confirmare umană**: nu e cazul (răspunsul e informativ, nu produce acțiuni). Accesul la modul și schimbările listei de firme
  nemascate se fac doar cu „da”-ul lui Răzvan (PR).
- **Secrete (doar nume)**: `INTREBARI_WORKER_SECRET` (Vault + fișierul de secret de pe serverul AI), cheia API Anthropic
  (Credential Manager). Nimic nou.
- **Oprire**: dezactivezi task-ul din Task Scheduler + `automatizari.stare = oprit`. Fără listă de nume (edge oprit / vechi) workerul
  nu preia nimic.

## De decis de Răzvan (cu recomandare)
1. **Firmele publice nemascate** (Transgaz, Delgaz, Distrigaz, Engie, E.ON, Romgaz, Premier Energy, Electrica, Transelectrica,
   Hidroelectrica, Apa Nova, Gazpet). **A (recomandat)**: rămân vizibile — cerințele lor sunt subiectul întrebării și nu sunt date
   personale. **B**: se ascund și ele (răspunsurile despre cerințele Transgaz / Delgaz devin generale).
2. **Atașamentele**. **A (implementat)**: nu se mai trimit la AI. **B**: un PR separat care citește local textul din PDF și îl
   maschează înainte de trimitere (pozele / scanările rămân oprite).
3. **Localitățile** rămân nemascate (decizia A a vizat persoane și firme). **A (recomandat)**: așa rămâne — locul contează pentru
   normativ (zona, distribuitorul). **B**: se ascund și ele.
