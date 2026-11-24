# BursaTransport ↔ ERP (Logistica) — faza 1: design + client API

Stare: **faza 1, nimic activ.** Clientul API există ca modul izolat (`supabase/functions/_shared/bursaTransport.mjs`), testat doar pe un server simulat local. Nu există funcție edge, ecran, migrare sau secret setat. Accesul API la BursaTransport nu e încă activat pe contul firmei (cererea e în curs la ei).

Ținta: o cursă / marfă de transport din ERP se publică pe BursaTransport cu un click (după previzualizare și confirmare), apoi se actualizează sau se retrage.

Sursa: specificația oficială „123cargo TMS API” v0.82 (17.12.2024), primită de la BursaTransport și păstrată intern (nu e în repo). Secțiunile citate mai jos se referă la ea.

---

## 1. API-ul pe scurt (din specificație)

| Ce | Valoare |
|---|---|
| Stil | REST peste HTTP, corpul cererilor în JSON |
| URL de bază (firme din România) | test: `https://test.bursatransport.com/api` · live: `https://www.bursatransport.com/api` (spec: „țineți-le în configurație”) |
| Autentificare | HTTP Basic (utilizator + parolă ale contului API) |
| Doi pași | HTTP **409** = cere autentificarea în doi pași. Codul primit prin SMS se trimite ca parametrul `code` la `login/login`, iar răspunsul conține valoarea cookie-ului `Bursa-2step-authentication`, care se trimite la fiecare cerere |
| Răspuns | `{ resultCode: 0 = ok / 1 = eroare, response: text sau obiect(e), availableResults }` |
| Coduri HTTP | 200 ok · 400 date invalide · 401 cont / parolă greșite · **402 acces API neactivat** · 403 operație interzisă · 404 negăsit · 409 doi pași · 500 eroare a bursei |
| Date | `DD-MM-YYYY` (ex. 23-01-2020); booleene trimise 0/1 sau true/false, întoarse 0/1 |
| Paginare | `limit` (maxim 50, implicit 50) + `offset` |

Ce folosim:

| Metodă | Cale | Folosire |
|---|---|---|
| `POST` | `/loads` | publică o marfă (corpul = obiectul `load`); răspunsul = marfa cu id `BM-xxxxxx` sau erorile de validare |
| `PUT` | `/loads/<ID>` | actualizează marfa (corpul = marfa completă) |
| `DELETE` | `/loads/<ID>` | retrage marfa |
| `GET` | `/loads?limit&offset` | mărfurile proprii (pentru reconciliere și pentru expirări) |
| `POST` | `/places` | localitatea pe care bursa o alege pentru un loc (arătată omului înainte de publicare) |
| `POST` | `login/login` | codul SMS al autentificării în doi pași |

Ce NU folosim (intenționat): `POST /loads/<ID>` („uplift”, ridicarea mărfii în listă, care poate costa), `/trucks` (camioane proprii libere; altă temă), ștergerea „unei liste de mărfuri” (forma ei nu e documentată).

---

## 2. Maparea ERP → `load` (POST / PUT)

Coloana „Oblig.” vine din specificație (§ load, coloana POST/PUT): **Y** = obligatoriu, **City** = loc obligatoriu la nivel de localitate, N = opțional.

| Câmp `load` | Oblig. | Din ERP (sursa) | Observații |
|---|---|---|---|
| `externalReference` | N (integer) | `logistica_comenzi_transport.id` | Spec: **integer**. Dacă id-ul comenzii nu e întreg (de verificat tipul real), câmpul lipsește, iar reconcilierea merge pe marcajul privat |
| `source` | **City** | `santier_plecare_id` → `sites.lat/lng` (+ `adresa`); sau `alta_locatie` | Locul = coordonate SAU localitate + țară (spec § place: id → nume + țară → cea mai apropiată localitate de coordonate). `alta_locatie` e text liber, deci omul alege localitatea |
| `destination` | **City** | `santier_destinatie_id` → `sites`; sau `alta_locatie` | la fel |
| `loadingDate` | **Y** | `data_transport` | `YYYY-MM-DD` → `DD-MM-YYYY`; nu în trecut (ziua la București) |
| `loadingInterval` | **Y** | — **lipsește** | zile de disponibilitate de la `loadingDate`; se completează în formularul de publicare |
| `requiredTruck[]` | **Y** | `tip_transport` (valorile reale de verificat) → **lipsește** maparea | coduri `truckType`; se combină doar din același grup (A: 1 Box, 2 Tilt, 3 Flat, 9 Oversized, 10 Car transporter, 5 Tipper · B: 6 Tank, 8 Liquid food · C: 7 Container · D: 11 Tractor Unit) |
| `weight` (kg) | **Y** | `_itemi`: greutate | suma pe linii. **De verificat**: greutatea pe linie e totală sau pe bucată (× cantitate) |
| `volume` (m³) | N | `_itemi`: dimensiuni × cantitate | trimis DOAR dacă toate liniile au toate trei dimensiunile; altfel lipsește (nu se ghicește) |
| `length` (m) | N | `_itemi`: lungimea maximă | util la țevi (12 m) |
| `hazardous` | N | `_itemi`: ADR | oricare linie ADR → true |
| `temperatureControlled` | N | — | false |
| `lift`, `mega`, `walkingFloor`, `hangers`, `vehicles`, `container` | N | — | nu se trimit în faza 2 (container cere 20' / 40' → avertisment dacă se alege tipul 7) |
| `groupage` | N | — | opțional în formular |
| `description` | N | — | **publică**: o văd toate firmele de pe bursă. Scrisă / aprobată de om în formular, fără nume de beneficiari, proiecte sau prețuri interne. Plafonul nostru: 500 de caractere (al bursei nu e documentat) |
| `privateNotice` | N | `numar_comanda` | vizibilă doar firmei noastre; poartă marcajul `ERP <numar_comanda>` (reconcilierea după un rezultat necunoscut) |
| `offeredPrice` | N | — | `{ price, currency RON/EUR/USD, vat }`; doar dacă omul îl introduce (întrebarea 3) |
| `contactInformation`, `spotlighted`, `id` | citire | — | le completează bursa (persoana de contact = contul care publică) |

Agabaritic pe o linie fără tipul 9 (Oversized) = avertisment arătat omului, nu blocaj.

Clientul lucrează pe o comandă **normalizată** (`construiesteMarfa`, vezi comentariul din modul). Adaptorul din coloanele reale ale tabelelor se scrie în faza 2, după ce sunt verificate în `information_schema` (faza 1 s-a scris fără acces la BD). Ce trebuie verificat atunci: tipul `logistica_comenzi_transport.id`, valorile `tip_transport` și `status`, numele și unitatea coloanelor de greutate / dimensiuni / ADR / agabaritic din `_itemi`, dacă `sites.lat/lng` sunt completate pe șantiere.

### Ce lipsește în ERP pentru o marfă validă

1. **Tipul de camion** cerut de bursă (`requiredTruck`): `tip_transport` din comandă nu are o corespondență cunoscută → se alege în formular (listă cu grupurile de mai sus).
2. **Perioada** (`loadingInterval`, zile de disponibilitate) → câmp nou în formular.
3. **Localitatea** pentru `alta_locatie` (text liber) și pentru șantierele fără coordonate → omul o alege. Bursa o confirmă prin `/places` înainte de publicare.
4. **Tonajul** (`weight`) → doar dacă liniile au greutate. Fără greutate pe toate liniile, marfa nu se publică.
5. **Descrierea publică** și (opțional) **prețul oferit** → formular.

Toate acestea țin de **publicare**, nu de comandă: se păstrează pe rândul publicării (secțiunea 6), nu pe comandă.

---

## 3. Fluxul propus (faza 2)

1. **Sursa**: comanda de transport ajunsă în starea finală de aprobare (lanțul existent: `submitata` → `aprobata_mitrache` → aprobarea a doua; numele exact al stării finale e de verificat). *Depinde de întrebarea 1*: azi tabelul are 0 rânduri în producție.
2. **Cine publică**: poarta de rol din funcția edge (owner + oamenii numiți; întrebarea 2). Nu e suficient `verify_jwt`.
3. **Formularul „Publică pe bursă”** (în Logistica, modul mic separat; `Logistica.jsx` primește doar butonul): completează ce lipsește (tip camion, perioadă, descriere, preț), apoi cere bursei localitățile (`/places`) și arată **exact** ce vede bursa (previzualizare din `construiesteMarfa`).
4. **„Publică”** (confirmarea omului) → funcția edge:
   - (a) RPC cu `auth.uid()` care creează intenția de publicare cu o cheie UUID per intenție (L04) + hash-ul corpului aprobat (claim **înainte** de apelul extern);
   - (b) `POST /loads`;
   - (c) înscrierea rezultatului (id `BM-…`, starea) pe rândul publicării.
5. **Rezultat necunoscut** (timeout / 5xx / răspuns fără id): starea „necunoscut”, fără reîncercare automată (L05). Butonul „Verifică pe bursă” caută marfa în lista proprie după `externalReference` / marcajul privat. Găsită = publicată; negăsită pe lista completă = se poate republica (cu cheie nouă, decizia omului); listă incompletă = rămâne necunoscut.
6. **Actualizare**: o schimbare pe comandă (dată, greutate) NU se propagă singură. Ecranul arată „diferă de ce e pe bursă”, iar omul apasă „Actualizează” (PUT, aceeași poartă).
7. **Retragere**: la anularea / respingerea comenzii sau după găsirea transportatorului, ecranul cere retragerea (DELETE), confirmată de om (întrebarea 5). 404 la retragere = verificare în listă înainte de „retrasă”.
8. **Expirare**: bursa șterge automat mărfurile expirate (`expiredLoads` în statistici). Un buton „Verifică pe bursă” (citire) marchează marfa „expirată” când nu mai apare în lista completă. O verificare automată periodică ar fi o automatizare separată, cu fișa ei.

Mediul: tot ce se face în faza 2 merge pe **test.bursatransport.com**. Mediul live cere o schimbare de cod explicită (`permiteLive`), după testul pe mediul de test și „da”-ul owner-ului.

---

## 4. Erorile și ce vede omul

| Cod client | Când | Ce vede omul | Ce face sistemul |
|---|---|---|---|
| `validare` | 400, sau 200 cu `resultCode = 1` și motive recunoscute | lista câmpurilor respinse (textul bursei, tăiat la 300 de caractere) | nimic publicat; omul corectează |
| `api_neactivat` | 402 | „Accesul API nu e activat pe contul firmei” | nimic publicat; nu se reîncearcă |
| `autentificare_refuzata` | 401 | „Contul API refuzat (secretele)” | nimic publicat; se verifică secretele (owner) |
| `doi_pasi_necesar` | 409 | „Bursa cere codul SMS” → câmp pentru cod (titularul contului) | nimic publicat; după cod, omul reapasă |
| `operatie_interzisa` | 403 | „Contul nu are voie la această operație” | nimic publicat |
| `inexistent` | 404 | „Marfa nu mai există pe bursă” | la retragere: verificare în listă |
| `necunoscut` | rețea / timeout / 5xx / 3xx / răspuns fără id / formă necunoscută **după o scriere** | „Rezultat necunoscut: verifică pe bursă” | fără reîncercare; reconciliere |
| `forma_necunoscuta` | citire cu răspuns nerecunoscut | „Răspuns neașteptat: de verificat” | nimic dedus |
| `cerere_invalida` | id care nu e `BM-…`, cod SMS invalid | — | nicio cerere trimisă |
| `neconfigurat` / `url_nepermis` / `live_neactivat` | secrete lipsă / URL în afara celor două din spec / live fără activare în cod | „Integrarea nu e configurată” | nicio cerere trimisă |

Clientul nu urmează redirect-uri: un 3xx = rezultat necunoscut, iar antetul de autentificare nu pleacă spre altă adresă.

### Autentificarea în doi pași

Specificația nu spune cât trăiește cookie-ul. Variante pentru faza 2 (decizie după primul test pe mediul de test):

- **A (preferată)**: un utilizator API dedicat, fără doi pași, dacă bursa permite. Nimic de păstrat.
- **B**: cookie-ul păstrat server-side (tabel accesibil doar funcției edge sau Vault), introdus de titular cu codul SMS la expirare. Nu ajunge niciodată în browser sau în răspunsuri.

Clientul suportă ambele: `confirma2Pasi(cod)` întoarce cookie-ul apelantului, iar `clientBursa({ cookie2Pasi })` îl folosește.

---

## 5. Fișa de securitate (CLAUDE.md pct. 7, a–e)

- **(a) Conținut extern citit**: răspunsurile bursei (mesaje de validare, lista mărfurilor proprii, numele localităților, datele de contact întoarse). Sunt **date**: curățate de caractere de control, tăiate, afișate omului. Nu declanșează nicio acțiune și nu trec prin AI.
- **(b) Ce scrie / face**: publică, actualizează și retrage o marfă **publică** pe bursă, deci o scriere **în afara firmei**, vizibilă altor firme (descriere, rută, dată, eventual preț oferit = angajament comercial). În ERP scrie doar rândul publicării (faza 2). Nu trimite mailuri și nici SMS-uri (SMS-ul de doi pași îl trimite bursa titularului, la cererea omului). Nu mută bani. „Uplift”-ul (posibil cost) e exclus.
- **(c) Identitate**: funcția edge (faza 2) verifică JWT-ul omului și rolul în cod (owner / persoanele numite, intrarea explicită în `user_module_access` pe `logistica`). Intenția de publicare se scrie prin RPC cu `auth.uid()` (L08). Rezultatul extern (id `BM-…`, starea) se înscrie printr-un RPC executabil doar de `service_role`, cu actorul verificat, ca la FAN Courier: omul nu poate scrie singur id-ul bursei (proveniență, L08). Secretele `BURSATRANSPORT_USER`, `BURSATRANSPORT_PASSWORD`, `BURSATRANSPORT_BASE_URL` stau doar în Edge Secrets, fără alternativă din alt modul (L10).
- **(d) Cine o poate porni**: doar butoanele din ERP, după poarta de rol din cod. În faza 2 nu există cron sau webhook.
- **(e) Confirmare umană**: publicarea (după previzualizarea exactă), actualizarea și retragerea cer fiecare confirmarea omului. Codul SMS îl introduce titularul. Conținutul citit de la bursă și conținutul comenzii nu publică nimic singure. Cele două condiții (citește conținut extern **și** scrie în afară) se ating doar prin om + poarta de rol, deci regula tare e respectată.

La livrarea fazei 2 (funcție edge deployată): rând nou în `public.automatizari` și în `registru_automatizari`, cu această fișă.

---

## 6. Ce se schimbă în BD (faza 2, NEAPLICAT, propunere)

În faza 1 **nu** intră fișier de migrare, din două motive:

1. Garda L15 v2 a migrărilor cere amprenta globală din baza live, pe care o calculează chat-ul.
2. Locul coloanelor depinde de întrebarea 1: dacă cursele nu vin din comenzile de transport, legătura pe comandă e greșită.

Propunerea de schemă:

- **Recomandat: tabel separat `logistica_bursa_publicari`**, câte un rând pe publicare, cu istoric (republicare după expirare):
  - legături: `comanda_id` (FK, nullable dacă sursa e alta), `cheie_intentie uuid UNIQUE` (L04), `hash_corp` (corpul aprobat);
  - stare: `stare` (`in_publicare` / `publicata` / `necunoscut` / `retrasa` / `expirata` / `respinsa`, CHECK derivat din tranzițiile din §3), `id_bursa` (`^BM-…`, UNIQUE parțial pe rândurile vii), `mediu` (`test` / `live`);
  - proveniență și timp: `publicat_de` (setat de server), `publicat_la`, `actualizat_la`, `retras_la`, `ultima_eroare_cod`;
  - datele formularului (`interval_zile`, `tipuri_camion`, descrierea, prețul) în corpul aprobat.
  - RLS + GRANT doar citire pentru `authenticated`. Scrierile doar prin RPC-uri (comanda omului cu `auth.uid()`; înscrierea rezultatului doar cu `service_role`). Trigger BEFORE pentru proveniență (L07 / L08).
- Varianta din brief (coloane pe `logistica_comenzi_transport`: `bursa_id`, `bursa_stare`, `bursa_publicat_la`) e mai simplă, dar pierde istoricul și cheia de intenție. Ar fi acceptabilă doar dacă sursa rămâne comanda și republicarea nu contează.

Migrarea vine cu revenire în `supabase/revenire/`, garda L15 v2 (ca `20261231a`), probă PGlite și numărul ales după toate branch-urile.

---

## 7. Teste (faza 1)

`src/logistica/bursaTransport.test.js` pornește un **server HTTP simulat** pe 127.0.0.1, construit după specificație:

- câmpurile obligatorii ale lui `load`;
- envelope-ul de răspuns;
- codurile 401 / 402 / 404 / 409 / 500;
- cookie-ul de doi pași;
- lista „indexată după id”.

O gardă de rețea pică testul la orice cerere spre altă adresă.

Ce se verifică:

- antetul Basic (pe UTF-8);
- maparea completă a unei comenzi (valoarea așteptată scrisă de mână);
- fiecare câmp lipsă;
- grupurile de camioane, data în trecut;
- 402 / 401 / 409 fără reîncercare;
- doi pași cap-coadă;
- „necunoscut” la 5xx / timeout / redirect / răspuns fără id;
- reconcilierea după referință pe mai multe pagini (eroare pe pagină ≠ „negăsit”; peste plafon = incomplet);
- marcajul comparat exact;
- id-uri invalide care nu pleacă la bursă;
- secretele care nu apar în client sau în rezultate.

În plus, 14 mutanți ai clientului (fiecare regulă stricată pe rând) au fost toți prinși de teste.

**Ce NU poate dovedi serverul simulat**: formele nedocumentate în specificație. Ele se verifică la primul contact cu mediul de test, în ordinea:

1. `GET /loads` (doar citire): forma listei;
2. `POST /places`;
3. o marfă de test `POST` → `PUT` → `DELETE`;
4. o marfă invalidă (forma erorilor de validare: statusul 400 sau 200, structura `response`);
5. doi pași: calea exactă `login/login` față de URL-ul de bază, `code` în JSON sau ca formular, cookie-ul în `Set-Cookie` sau în corp, durata lui.

Rulare: `npx vitest run src/logistica/bursaTransport.test.js`.

---

## 8. Întrebări pentru owner

1. **De unde vin cursele de publicat?** Comenzile de transport din ERP nu sunt folosite azi (0 rânduri). A) le punem în folosință (ecran de comandă + aprobările existente), iar publicarea pornește din comanda aprobată; B) din altă parte (mutări de utilaje din Logistica, livrări din Achiziții); C) un formular separat „Publică marfă”, fără comandă.
2. **Cine apasă „Publică” / „Retrage”?** A) doar owner-ul; B) owner-ul + responsabilul logistic numit, după aprobarea finală; C) oricine are acces la Logistica.
3. **Prețul oferit se publică?** A) nu (fără preț, negociere pe telefon); B) da, introdus de om la fiecare publicare (RON / EUR, cu sau fără TVA).
4. **Contul API și doi pași**: ce utilizator BursaTransport folosim? Se poate cere bursei un utilizator API fără doi pași? Dacă nu, cine primește SMS-ul (titularul contului)?
5. **Retragerea**: A) ecranul o propune la anularea comenzii și la găsirea transportatorului, omul confirmă; B) doar manual, din butonul „Retrage”.

---

## 9. Etape

- **Faza 1 (acest PR)**: designul + clientul + testele pe serverul simulat.
- **Faza 2** (după răspunsuri și după activarea API-ului): verificarea coloanelor reale, migrarea (NEAPLICATĂ, cu revenire și L15), funcția edge cu poarta de rol, formularul de publicare, primul test pe test.bursatransport.com cu o marfă fictivă.
- **Faza 3**: mediul live, după „da”-ul owner-ului; eventual verificarea periodică a expirărilor (automatizare nouă, cu fișa ei).
