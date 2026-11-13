# Drepturile contului nelogat (`anon`): analiză și curățenie în trei trepte

**Stare (13.11.2026):** T1 (`20261218a`) și T3 (`20261218c`) aplicate pe producție; clientul fără interogări fără sesiune (PR #1082) e pe
producție. T2 (`20261218b`) **neaplicată**: așteaptă cele două dovezi din scriptul de citire (§2). Fiecare treaptă se aplică doar cu
„da”-ul owner-ului, după review.
**Fișiere:** migrările `20261218a` (T1), `20261218b` (T2), `20261218c` (T3) cu revenirile lor din `supabase/revenire/`, scriptul doar de citire
`scripts/anon_drepturi_citire.sql`, proba locală `scripts/pglite/test_anon_drepturi_local.mjs`, proba cu două sesiuni pentru clonă
`scripts/anon_drepturi_concurenta.mjs`, testul static `src/anonDrepturi.test.js`.
**Runda 2 (review #1081):** amprenta listei prinde și obiectele recreate; retragerea blochează rândurile din catalog și recitește lista
înainte de REVOKE; revenirea pe coloane verifică identitatea coloanei; citirea separă „date citibile” de „agregat fără date”; T2 are o
condiție nouă (§2, §6).
**Runda 4 (review r3):** blocarea nu mai folosește PUBLIC (ar fi șters un drept dat concurent lui PUBLIC), ci un rol-santinelă creat în
tranzacție; migrarea recitește și ACL-ul complet al fiecărei ținte (toate rolurile) și verifică la final că „după” diferă de „înainte” exact
prin intrările lui `anon` din jurnal; T2 ține ACCESS SHARE pe ținte (oprește o politică nouă creată în paralel) și verifică la final că
nicio țintă nu are politică pentru `anon` / PUBLIC; citirea marchează „un rând doar cu zero / NULL” ca ambiguu și îl confirmă din
definiție (§5).
**Runda 5 (citirea, înaintea T2):** forma vederii nu mai e dovadă. „Un rând doar cu zero / NULL” se dovedește la **sursă** (clasa
`FARA_DATE_LA_SURSA`: tabelele de bază ale vederii, găsite în catalog, citite efectiv ca `anon`) sau iese `CONSTANTA` / `DATE_CITIBILE` /
`AMBIGUU` (§2); `STATISTICI` are `queryid` și o linie-rezumat de comparat între două citiri; `CONTROL` vede și politicile pentru `anon` /
PUBLIC puse pe tabele fără drept.
**Runda 6 (review #1090):** ieșirea citirii e o **probă**, nu o demonstrație. Întâi analiza din catalog, cu o listă albă de funcții:
o relație cu o funcție din afara listei nu se mai execută (`NEEXECUTATA`). Simularea pune contextul unei cereri GET reale prin API
(metoda, calea, revendicările cheii) și refuză setările pe care nu le modelează. `STATISTICI`: clase după forma API-ului, `stats_since`
pe fiecare intrare, colectarea pornită, martorul API-ului; regula de comparare e pe fiecare intrare (§2).
**Runda 7 (review r2 #1090):** analiza ia politicile **cititorului efectiv** (proprietarul unei vederi obișnuite, pe fiecare nivel), nu
doar pe ale lui `anon`, și spune când cititorul ocolește RLS; intrările imbricate din statistici nu mai pot fi „directe”; șablonul notei
umane pentru relațiile `NEEXECUTATA` (§2).

## 1. Pe scurt

- **Ce e `anon`:** rolul cu care ajunge în bază orice cerere făcută **fără cont**: pagina QR a șoferului, formularele publice, linkurile din
  mailuri, dar și **interfața ERP înainte de login, după logout sau cu sesiunea expirată**. Cheia publică a aplicației e în orice browser,
  deci oricine poate face o astfel de cerere.
- **Ce are azi:** drepturi pe aproape toate tabelele, vederile și secvențele din schema `public`. Le are din setările implicite ale bazei
  (orice tabel nou le primește automat), nu pentru că le-ar folosi cineva.
- **De ce nu e o breșă azi:** toate tabelele au RLS pornit și nicio politică nu-l lasă pe `anon` să vadă sau să scrie vreun rând (cele care îl
  includ cer toate un cont logat). Vederile citesc cu drepturile celui care întreabă. Citirile de pe producție (13.11.2026) nu au găsit
  date; cea cu scriptul rundei 5 a ieșit „zero”, dar review-ul a arătat cazuri pe care scriptul le-ar fi trecut greșit: se reface cu
  scriptul rundei 6 (§2).
- **Ce câștigăm:**
  - un strat de apărare în plus: dacă mâine o politică e scrisă greșit, `anon` tot nu are drept pe tabel;
  - tabelele noi nu mai primesc automat drepturi pentru `anon` (T3);
  - review-urile nu mai „îngheață” în baseline drepturi inutile pentru `anon` (semnalat la PR #1071, #1075, #1077, #1080).
- **Riscul general:** dacă ceva chiar folosește un drept retras, acel lucru primește „nu ai drept” (eroare 42501 / 401) în loc de listă
  goală. Se repară cu revenirea treptei, care reface **exact** ce s-a retras. Pentru T2 riscul e **real** azi (§2): de aceea are o condiție.

## 2. Cine folosește de fapt `anon`

### Paginile publice (din cod)

Paginile fără login (`src/App.jsx`): `/login`, `/q/:id`, `/co`, `/rsvp/:token/:status`, `/redari/raspuns/:token`, `/redari/informare`,
`/aplica`. Fiecare acces făcut cu cheia publică, fără sesiune:

| Obiect | Operație | De unde | De ce merge fără drepturi pe tabele |
|---|---|---|---|
| `fn_sedinte_rsvp_submit` | RPC | `src/RsvpSedintaPage.jsx` | SECURITY DEFINER (citirea verifică `RPC_PUBLIC`) |
| `fn_red_formular_public` | RPC | `src/RedariRaspunsPublic.jsx` | SECURITY DEFINER (`20261126a`) |
| `fn_red_raspuns_public` | RPC | `src/RedariRaspunsPublic.jsx` | SECURITY DEFINER (`20261126a`) |
| `fn_red_informare_publicata` | RPC | `src/RedariInformarePublic.jsx` | SECURITY DEFINER (`20261130m`) |
| edge `qr-utilaj-info`, `qr-alimentare-submit`, `qr-bon-comun-lookup`, `rag-utilaj` | HTTP | `src/QrUtilajPage.jsx` | funcții edge; nu ating tabelele ca `anon` |
| edge `concediu-mobil` | HTTP | `src/ConcediuMobilPage.jsx` | funcție edge |
| edge `recrutare-aplica` | HTTP | `src/AplicaPublic.jsx` | funcție edge cu `service_role` |
| edge `ingest-document` (script Google) | HTTP | `scripts/apps_script_ingestie_gmail.js` | funcție edge cu `service_role` |
| `/login` | doar autentificare | `src/App.jsx` | nu atinge tabele |

Paginile publice nu folosesc niciun tabel, nicio vedere și nicio secvență direct. Lista „păstrate” din regulă (pct. 1) rămâne goală.
Dreptul de apel al lui `anon` pe cele 4 RPC-uri **nu se atinge** (funcțiile nu sunt în aceste trepte).

### Interfața ERP fără sesiune: EXISTĂ acces direct (corectură față de runda 1)

Runda 1 spunea „nicio cerere ca `anon` pe tabele”. **E fals.** Statisticile de pe producție (secțiunea `STATISTICI`, cumulate din
07.08.2026) arată interogări directe pe tabele ca `anon`, prin API-ul bazei, făcute de interfața ERP când pornește **fără sesiune**
(înainte de login, după logout, cu sesiunea expirată):

| Ce face interfața | Obiecte | Apeluri ca `anon` (cumulat) |
|---|---|---|
| contoarele paginii principale | 9 tabele | 105–111 pe fiecare |
| lista conversațiilor din chat | 1 vedere | 45 |
| notificările | 1 tabel | 17 |
| aprobările comenzilor | 1 tabel | 15 |
| lista angajaților | 1 tabel | 11 |

Azi aceste cereri întorc listă goală (RLS) sau o eroare, deci nu se scurg date. Dar după T2 ar primi toate „nu ai drept” (42501 / 401):
o regresie reală (zgomot, ecrane cu eroare, reîncercări). Cifrele sunt cumulate: nu spun câte cereri au loc azi (unele tabele au pierdut
deja dreptul de citire pentru `anon`). Lista exactă pe obiecte rămâne în raportul de pe server, nu în repo.

**Condiția pentru T2 (obligatorie):** întâi PR-ul separat „client fără interogări fără sesiune” (interfața nu mai pornește interogări
fără sesiune și tratează explicit 401 / 403, fără bucle), pe producție (#1082, 13.11.2026); apoi **două dovezi** din scriptul de citire.
Abia atunci T2. Tabelele nu se scot din T2.

**Încadrarea (runda 6).** T2 doar **retrage** drepturi ale lui `anon` și se reface exact cu revenirea. O concluzie greșită a scriptului
nu scurge date: în cel mai rău caz, o pagină publică primește „fără drept” după T2, ceea ce se vede imediat și se repară cu revenirea.
De aceea ieșirea scriptului e **o probă, nu o demonstrație**: unde nu poate analiza, spune `NEEXECUTATA` / `AMBIGUU` / „lipsă de
dovadă”, nu „dovedit”. Scriptul nu urmărește completitudinea teoretică; închide prin refuz conservator cazurile cunoscute (review #1090).

**Dovada 1 — zero date citibile ca `anon`** (secțiunea `SIMULARE`, linia `SIMULARE concluzie: ZERO …`). Pentru fiecare relație din
`public` pe care `anon` o poate citi, în ordinea:

1. **Analiza, fără execuție** (runda 6). Scriptul strânge din catalog **închiderea** relației, adică tot ce evaluează o citire ca `anon`:
   - regula de citire a fiecărei vederi, recursiv prin vederi: relațiile, funcțiile și operatorii (cu funcțiile lor) se citesc din
     **arborele intern** al regulii, nu doar din tabelul de dependențe (acolo funcțiile și tabelele sistemului nu apar deloc: de aici
     venea contraexemplul cu `query_to_xml` și o vedere peste catalog ieșea „constantă”);
   - politicile aplicate de **cititorul efectiv** al fiecărui tabel (runda 7, review r2 #1090 P1), recursiv prin relațiile citite de ele.

   **Cine citește efectiv** (regula PostgreSQL, probată pe PG 18 în testul local):
   - relația citită direct și relațiile unei vederi `security_invoker = on` (oriunde în lanț, chiar sub o vedere obișnuită): `anon`;
   - relațiile unei vederi **obișnuite** (fără `security_invoker`): **proprietarul vederii**, cu drepturile și **politicile lui**; pe lanț,
     proprietarul fiecărui nivel (vedere peste vedere);
   - relațiile citite dintr-o politică: același cititor ca tabelul politicii.

   Politicile analizate pe un tabel = cele pe care PostgreSQL le aplică acelui cititor: RLS pornit, SELECT / ALL, pentru PUBLIC sau pentru
   un rol ale cărui drepturi le are cititorul (direct sau moștenit). **Niciuna** dacă cititorul ocolește RLS: superuser, `BYPASSRLS`,
   proprietarul tabelului (sau membru al lui) fără `FORCE ROW LEVEL SECURITY`. Ieșirea o spune, înaintea oricărei execuții, într-o linie
   `SIMULARE cititori pentru <relație>: <tabel> citit ca <rol> (<superuser / BYPASSRLS / proprietarul tabelului, fără FORCE>: ocolește
   RLS, fără politici de analizat | politicile lui analizate)`, pentru fiecare tabel cu RLS citit ca alt rol decât `anon` sau fără
   politici. Contraexemplul review-ului (politică `TO <proprietarul vederii>` care cheamă o funcție cu `pg_advisory_lock`, vedere
   obișnuită a acelui proprietar, cu SELECT pentru `anon`) iese acum `NEEXECUTATA`, iar funcția nu rulează. Proba „la sursă” (mai jos)
   citește un tabel direct ca `anon` doar dacă politicile lui `anon` pe el sunt în analiză.

   Corpurile funcțiilor **nu se mai urmăresc**. E admisă doar o **listă albă**:
   - funcțiile sistemului (create la instalarea serverului), fără SECURITY DEFINER și fără SET în definiție, care fie sunt **imuabile**
     (prin contract nu citesc baza, setări sau fișiere), fie sunt pe lista scurtă de funcții **stabile** pure (dată / oră, JSON, text:
     depind doar de fusul orar, formate, limbă). Agregatele sistemului (`count`, `sum`, `max`, `string_agg`, `json_agg` …) intră aici;
   - `current_setting`, doar dacă **fiecare** apel are ca cheie o constantă **modelată** (vezi contextul de mai jos); cheia se citește din
     arborele intern, nu din text; o cheie calculată = refuz;
   - `auth.uid()` / `auth.role()` (schema `auth`, fără argumente, fără DEFINER / SET), doar dacă tot ce citește corpul lor sunt setările
     modelate (cu cheie literală) și nu citește tabele.

   **Orice altă funcție** (a noastră, de extensie, cu SET în definiție, SECURITY DEFINER, volatilă, de sistem din afara listei: ex.
   `query_to_xml`, `table_to_xml`, `pg_read_file`, `lo_get`, `pg_advisory_lock`; `auth.jwt()`) ⇒ relația **nu se execută deloc**: clasa
   `NEEXECUTATA`, cu numele funcției și motivul. Contează ca `AMBIGUU` la concluzie. Așa nu mai rulează nimic cu efecte (un lock
   consultativ luat de o funcție ar fi supraviețuit anulării tranzacției), iar o funcție cu `SET request.jwt.claims = …` (care schimbă
   contextul RLS) nu mai poate face ca „0 rânduri văzute ca `anon`” să pară dovadă.
2. **Execuția** (doar cu închiderea pe lista albă), în contextul unei cereri reale (mai jos). Se citesc valorile (cel mult 2 rânduri,
   doar coloanele citibile de `anon`):
   - **0 rânduri** = `GOL`; **un rând cu o valoare nenulă / nezero sau mai multe rânduri** = `DATE_CITIBILE`;
   - **un rând doar cu zero / NULL** nu dovedește nimic prin el însuși (`sum` peste `1` și `-1` dă tot zero). Se judecă **sursa**, pe
     calea de date a închiderii (vederile și relațiile citite de ele; relațiile citite doar de politici doar filtrează):
     - `FARA_DATE_LA_SURSA`: vedere `security_invoker = on`, la fel toate vederile de pe calea de date; doar relații din `public`; cel
       puțin un tabel, iar fiecare tabel, citit efectiv ca `anon`, e interzis (42501) sau arată 0 rânduri;
     - `CONSTANTA (fără surse în catalog)`: aceleași condiții, dar nicio relație pe calea de date (ex. `VALUES`): valorile vin doar din
       funcțiile listei albe. Nu scrie „dovedit”;
     - `DATE_CITIBILE`: tabel; vedere materializată / tabel străin; vedere fără `security_invoker`; un tabel de bază cu cel puțin un rând
       vizibil ca `anon`;
     - `AMBIGUU`, cu numele: relație din altă schemă (inclusiv catalogul), dependență de alt fel, altă eroare decât 42501, tabel pe
       calea de date citit doar ca alt rol decât `anon`.

**Contextul cererii simulate** (secțiunea `CONTEXT_POSTGREST`). O cerere GET prin API-ul bazei (PostgREST) cu cheia publică, fără
sesiune, rulează într-o tranzacție în care PostgREST pune rolul, `search_path`, revendicările cheii (`request.jwt.claims`), metoda,
calea, antetele și cookie-urile cererii (documentația PostgREST, „Transaction-scoped settings”). Simularea pune: rolul `anon`;
`search_path = public, extensions` (valorile implicite Supabase); revendicările `{"iss":"supabase","role":"anon"}`; formele vechi
`request.jwt.claim.sub` / `.role` goale (pentru `auth.uid()` / `auth.role()` echivalent cu „nepuse”); metoda `GET`; calea `/<relația>`;
antetele și cookie-urile `{}`.
- **Setări modelate** (valoarea simulată = cea reală a unei cereri fără sesiune): metoda, calea, `request.jwt.claim.sub` / `.role`; plus
  `request.jwt.claims`, dar **doar** în corpul lui `auth.uid()` / `auth.role()` (din care ele citesc doar `sub` / `role`). Antetele,
  cookie-urile, revendicările complete (`ref`, `iat`, `exp` nu sunt simulate, de aceea `auth.jwt()` și citirea directă a lui
  `request.jwt.claims` sunt refuzate), cheile calculate și setările proprii ⇒ `NEEXECUTATA`, cu numele setării.
- **Limite** (spuse și în ieșire): funcția „pre-request” a PostgREST și setările rolului `anon` pe care PostgREST le aplică (ex.
  `statement_timeout`) **nu sunt simulate**. `CONTEXT_POSTGREST` arată ce se vede din bază: dacă rolurile `anon` / `authenticator` au
  setări (doar numele, valorile pot fi secrete) și dacă printre ele e `pgrst.db_pre_request`. Configurarea din variabilele de mediu ale
  serviciului (pre-request, scheme) nu se vede din bază: coordonatorul o confirmă separat. Alte limite cunoscute: conversiile prin
  funcțiile de intrare / ieșire ale tipurilor (tipurile de bază le creează doar administratorul serverului), constrângerile domeniilor
  (rulează doar la conversie și pot doar da eroare), recunoașterea corpului lui `auth.uid()` / `auth.role()` după text. (Politicile
  proprietarului unei vederi obișnuite **nu** mai sunt o limită: din runda 7 se analizează, vezi mai sus.)

**Concluzia** `ZERO date citibile ca anon (proba pe aceasta baza, in limitele din document)` cere: **0 `DATE_CITIBILE`, 0 `AMBIGUU`,
0 `NEEXECUTATA`, 0 erori necunoscute** (42501 = drept refuzat, se notează). Valorile nu se afișează. Citirile din 13.11.2026 (clonă și
producție, cu scriptul rundei 5) trebuie **refăcute** cu scriptul rundei 6. De așteptat pe producție: tabelele ale căror politici pentru
`anon` / PUBLIC apelează funcții proprii (azi cel puțin o politică RESTRICTIVE) și vederile care le citesc ies `NEEXECUTATA`; acolo
decide un om (funcția e citită și revizuită), nu scriptul. Runda 7 analizează în plus politicile proprietarilor vederilor obișnuite:
citirea de pe producție se reface cu scriptul rundei 7 (numărul de `NEEXECUTATA` poate crește, niciodată scădea pe aceeași bază).

**Nota umană pentru relațiile `NEEXECUTATA` (varianta A, recomandată în review-ul r2 #1090).** Pe producție, citirea rundei 6 a dat
`NEDOVEDIT` cu 5 vederi `NEEXECUTATA` (toate implică funcții SECURITY DEFINER proprii). Pentru fiecare, un om scrie o notă **în PR-ul
T2**, înaintea aplicării. Nota **completează** proba; **nu** transformă ieșirea scriptului în `ZERO` (concluzia scriptului rămâne
`NEDOVEDIT`). Repo-ul e public: nota din PR referă obiectele prin numărul de ordine și amprentă, iar numele, corpurile și detaliile
stau în raportul intern al coordonatorului, cu aceeași structură. Șablonul:

```
Nota NEEXECUTATA <n> / <total> — citirea din <data, ora> (rezumatul SIMULARE + CONTROL de atunci)
1. Vederea: <identificare> | security_invoker: <da/nu> | proprietar: <rol> | amprenta regulii (md5 din OBIECT): <md5>
2. Funcțiile din închidere (linia NEEXECUTATA) și apelurile lor TRANZITIVE, fiecare cu:
   - identitate (schemă, nume, argumente) | proprietar | DEFINER / INVOKER | proconfig (inclusiv search_path) | volatilitate
   - amprenta corpului: md5(replace(prosrc, chr(13), '')) | momentul citirii
   - sursele citite (tabele / vederi / setări) și verificările de identitate din corp (auth.uid(), rolul, profilul)
3. Cititorul efectiv al fiecărui tabel (linia „SIMULARE cititori”) și politicile aplicate lui
4. Concluzia motivată: ce poate întoarce vederea unei cereri fără sesiune (fără date / doar date publice / date private) și de ce
5. Paginile publice care depind de vedere (din cod) și ce se întâmplă cu ele după T2
6. Verificarea fără sesiune prin API (GET cu cheia publică, fără sesiune): codul HTTP, numărul de rânduri, data; fără valori
7. Revizuit de: <om> | data
8. Obligație: dacă vreo definiție de la 1–3 se schimbă (altă amprentă) înaintea aplicării T2, nota se reface
```

**Dovada 2 — zero interogări directe ale lui `anon` pe tabele** (secțiunea `STATISTICI`, din `pg_stat_statements`). Fiecare intrare a
lui `anon` din baza curentă are o **clasă**:
- `directa` = forma generată de PostgREST (textul începe cu `WITH pgrst_…`), fără apel de funcție, pe o relație din `public` (citire sau
  scriere, inclusiv `INSERT` cu listă de coloane);
- `rpc` = forma PostgREST cu apel de funcție (`pgrst_call`): paginile publice;
- `alta` = tot restul (SQL scris de mână, citiri interne ale funcțiilor apelate de `anon` când colectarea e `all`, PostgREST pe alte
  scheme); se tipăresc, dar nu intră la directe. Runda 7 (review r2 #1090 P2): o intrare **imbricată** (`toplevel = false`: SQL rulat
  din interiorul unei funcții) e mereu `alta`, cu marcajul `imbricat` pe linie, chiar dacă textul ei are forma PostgREST și numește
  `"public"."…"` — nu e o cerere prin API. Fără coloana `toplevel` (PostgreSQL < 14), clasa se dă prudent după text (nivelul `?`);
- `proprie` = interogările acestui script (eticheta `anon_drepturi_citire`); `ascunsa` = textul nu e vizibil pentru cititor.

Fiecare linie: `STATISTICI anon <clasa>: queryid Q | N apeluri | stats_since T | sus/imbricat | <text>`; `stats_since` (PostgreSQL 17)
= momentul de la care curg contoarele **acelei** intrări. Directele se tipăresc primele. Apoi martorul și linia-rezumat:

`STATISTICI rezumat anon | directe: N interogari, S apeluri | rpc: … | alte: … | proprii: P | resetare: <moment> | evacuari: <E> | ascunse: <H> | track: <top/all> | stats_since: da | martor: da | dovada: DA`

- **`dovada: DA`** doar dacă: niciun text ascuns; colectarea e pornită (`pg_stat_statements.track` = `top` sau `all`; `none` = nu se
  colectează nimic, contoarele stau pe loc); nicio setare `pg_stat_statements.*` pe rolurile `anon` / `authenticator`; intrările au
  `stats_since`; momentul resetării globale și evacuările se cunosc; martorul există. Altfel `LIPSA DE DOVADA (<motivul>)`. O secțiune
  **sărită** (extensia lipsă sau neîncărcată, ca pe clona locală) = lipsă de dovadă, nu „zero apeluri”.
- **Martorul (proba de colectare):** interogarea de configurare pe care PostgREST o rulează **la începutul fiecărei cereri**
  (`select set_config(…)`): există deja în statistici și e inofensivă. Statisticile o trec sub rolul cu care se termină (după schimbarea
  rolului), deci la cererile fără sesiune apare sub `anon` (și e numărată la „alte”); scriptul o caută întâi la `anon`, apoi la
  `authenticator`, fără interogările proprii. Linia `STATISTICI martor … rol R | queryid Q | N apeluri | stats_since T`. Între două citiri,
  martorul trebuie să aibă **același** rol, `queryid` și `stats_since` și **mai multe** apeluri: așa se vede că cererile fără sesiune prin
  API chiar sunt urmărite în intervalul comparat. Dacă în interval n-a fost nicio cerere fără sesiune (martorul nu crește), coordonatorul
  poate deschide o pagină publică doar de citire (ex. informarea Redări) și reface citirea B.
- **Regula de comparare** (citirea A azi, citirea B peste câteva zile de lucru normal; ambele cu `dovada: DA`):
  1. martorul: același `queryid` și `stats_since`, apeluri B > A. Altfel comparația nu e probă;
  2. pentru **fiecare** `queryid` direct din A: există și în B, cu **același** `stats_since` și apeluri B ≥ A. Altfel acea intrare e
     „fără probă” (a fost resetată selectiv sau evacuată și readăugată: suma poate arăta la fel deși au fost apeluri — exemplul
     review-ului: A = 100, resetare selectivă, încă 100 de apeluri, B = 100);
  3. apeluri B > A pe o intrare directă, sau un `queryid` direct nou în B = **„a crescut”**: interfața tot face cereri fără sesiune pe
     tabele, T2 nu se aplică (se caută intrarea în listă);
  4. dovada 2 = martorul crește (1), nicio intrare „fără probă” (2) și nimic „a crescut” (3). Dacă statisticile au fost resetate global
     între A și B (alt moment `resetare`), B singură trebuie să arate `directe: 0 interogari, 0 apeluri`.
- Rezumatul din runda 6 numără altfel decât cel din runda 5 (clase noi): citirea A se reface cu scriptul nou, nu se compară cu cea veche.

## 3. Treptele

Regula e una singură (blocul `REGULA_ANON v2`, identic în citire și în cele trei migrări). Se aplică pe obiectele lui `postgres` din `public`,
cu drepturi acordate de `postgres`. Restul apare la „rămâne”, cu motivul.

### T1: secvențele (`20261218a`)
- **Ce face:** retrage de la `anon` drepturile pe secvențele din `public`. Excepție: secvențele din DEFAULT-ul tabelelor în care `anon` poate
  insera, adică cele folosite de o pagină publică (azi niciunul) sau cele cu o politică INSERT / ALL pentru `anon` / PUBLIC. Sunt păstrate prudent,
  chiar dacă politicile de azi cer toate cont. INSERT-ul pe o coloană IDENTITY nu cere drept pe secvență, deci acelea nu sunt excepții.
  Creează și jurnalul comun al treptelor (schemă separată, neexpusă, fără drepturi pentru nimeni în afară de `postgres`).
- **Ce se strică dacă greșim:** un INSERT făcut direct ca `anon` într-un tabel cu `serial` ar da 42501 pe secvență. Statisticile nu arată
  niciun INSERT direct ca `anon`.
- **Verificare înainte (citire):** `OBIECT` (lista T1), `POLITICI_ANON`, `STATISTICI`.
- **Risc:** foarte mic.

### T2: tabelele și vederile fără nicio politică pentru `anon` (`20261218b`)
- **Ce face:** retrage de la `anon` toate drepturile (pe obiect și pe coloane) pe tabelele fără politici pentru `anon` / PUBLIC și pe vederi.
  Tabelele cu politici pentru `anon` / PUBLIC rămân neatinse (vezi §4).
- **Partiții:** dreptul nu se moștenește. Părintele și fiecare partiție sunt judecate separat (fiecare are rândul lui în listă). Retragerea pe
  părinte nu atinge partițiile și invers. O cerere pe părinte cere doar dreptul pe părinte; una direct pe partiție, doar dreptul pe partiție.
- **Ce se strică dacă greșim:** o cerere fără cont pe un astfel de obiect primește 42501 / 401 în loc de listă goală. **Azi există astfel de
  cereri** (§2), deci T2 are condiția de la §2. La fel pentru o funcție fără SECURITY DEFINER apelată de `anon` care citește un obiect retras.
- **Verificare înainte (citire):** `SIMULARE` (așteptat **0 relații cu date citibile**, 0 ambigue, 0 neexecutate, linia
  `SIMULARE concluzie: ZERO …`; cele fără date la sursă, constantele și erorile de drept se listează separat; o `NEEXECUTATA` se decide de
  un om, după funcția numită), `FUNCTII_ANON` (niciuna folosită de o pagină publică), `STATISTICI` (regula de comparare pe fiecare
  intrare + martorul, §2) și jurnalele API. **`STATISTICI` sărită** (extensia lipsă sau neîncărcată) = **lipsă de dovadă**, nu „zero
  apeluri”: condiția T2 nu e îndeplinită până nu se citesc efectiv.
- **Risc:** mic **după** condiția de la §2; înainte, regresie sigură în interfață.

### T3: drepturile implicite (`20261218c`)
- **Ce face:** tabelele, vederile și secvențele **noi** create de `postgres` în `public` nu mai primesc drepturi pentru `anon`. Sonda din
  migrare creează un tabel și o vedere, verifică și le șterge.
- **Ce se strică dacă greșim:** nimic din ce există azi. O funcționalitate publică nouă care chiar are nevoie de `anon` pe un tabel trebuie să
  dea dreptul explicit în migrarea ei. Asta se revizuiește oricum.
- **Regula pentru migrările noi (după T2 / T3):** fără `GRANT ... TO anon`, decât pentru un acces public revizuit. Acel obiect intră și în lista
  pct. 1 a regulii, ca o citire ulterioară să nu-l propună la retragere.
- **Ce rămâne:** drepturile implicite ale lui `supabase_admin` (platforma) nu se pot schimba ca `postgres`, deci obiectele create de platformă
  în `public` (rar) ar primi drepturi pentru `anon`.
- **Risc:** foarte mic.

## 4. Ce rămâne pentru `anon` după toate treptele

- tabelele cu politici pentru `anon` / PUBLIC (azi toate cer cont) și secvențele celor cu politică INSERT / ALL. Se pot retrage într-o treaptă
  ulterioară, cu o migrare separată, după ce `POLITICI_ANON` + `SIMULARE` arată că nu dau nimic fără cont;
- obiectele altui proprietar și drepturile implicite ale lui `supabase_admin`;
- dreptul de apel pe funcții (inclusiv cele 4 RPC-uri publice): în afara treptelor, îl urmărește controlul 0e al runnerului.

**Controlul periodic** (după fiecare migrare și lunar): scriptul de citire. Se compară cu ultima citire revizuită:
- rândurile `BASELINE` (după aplicare: T1 / T2 / T3 = 0 obiecte): un rând nou = un obiect cu drepturi pentru `anon` apărut între timp;
- rândul `CONTROL RAMANE` (numărul + amprenta a tot ce **rămâne**): schimbat = ceva nou la „rămâne”, de ex. un obiect creat de `supabase_admin`
  (cu drepturile lui implicite pentru `anon`) sau o politică nouă pe un tabel rămas. Se caută în `OBIECT` (treapta RAMANE) și se analizează;
- rândul `CONTROL POLITICI_ANON` (runda 5; numărul + amprenta politicilor care îl numesc pe `anon` / PUBLIC pe tabele unde `anon` nu are
  **niciun** drept): azi nu dau acces, dar un GRANT ulterior le-ar activa. Schimbat = o astfel de politică nouă / modificată / ștearsă: se
  caută în `POLITICI_ANON` (coloana `anon_are_drept = false`) și se analizează.
Controlul se poate muta în poarta automată a runnerului (cere aprobare separată).

## 5. Cum se aplică și cum revenim

- **Cum se aplică:** fiecare treaptă e o livrare separată, prin runner, **doar cu plafonul de 2000 ms**. `20261218a` e prima (creează jurnalul).
  `20261218b` și `20261218c` cer jurnalul, dar nu se cer una pe alta.
- **Lista nu e scrisă de mână:** migrarea o calculează din catalog și o compară cu BASELINE-ul (număr de obiecte + amprenta listei) scos de
  scriptul de citire **din aceeași bază** (amprenta conține identitatea internă a obiectelor: BASELINE-ul clonei nu merge pe producție și
  invers). Necompletat sau diferit = refuz, nimic schimbat. La refuz, lista de acum apare în NOTICE.
- **Ce intră în amprentă (v2):** pe fiecare obiect: identitatea internă (un obiect șters și recreat cu același nume e alt obiect), drepturile
  lui `anon` pe obiect și pe coloane (coloana prin număr + tip + nume), proprietarul, RLS și FORCE, părinții (partiție / moștenire),
  opțiunile, corpul vederii, toate politicile (cu expresiile lor), DEFAULT-urile (la o secvență: DEFAULT-urile care o folosesc).
- **Ce se detectează exact, pe ferestre:**
  - schimbat înainte de calcul (de la citire): orice câmp din amprentă => refuz;
  - comis de altă sesiune între calcul și REVOKE: migrarea **blochează** întâi rândurile din catalog ale obiectelor din listă, apoi
    **recitește** lista și **ACL-ul complet** al fiecărui obiect (toate rolurile, inclusiv PUBLIC): orice diferență față de ce s-a calculat
    => refuz, nimic schimbat. Blocarea = o retragere fără efect de la un **rol-santinelă** creat chiar în tranzacție: nicio altă sesiune nu-l
    vede până la COMMIT, deci nu are și nu poate primi niciun drept, iar retragerea lui nu schimbă ACL-ul nimănui, dar rescrie rândul fiecărui
    obiect (se verifică că toate sunt acum ale tranzacției). În runda 3 blocarea era o retragere de la PUBLIC: un drept dat lui PUBLIC de
    altă sesiune chiar în acea fereastră era șters de blocare și recitirea nu mai vedea nimic (review r3). Santinela se șterge în aceeași
    tranzacție; postcondiția verifică că nu a rămas;
  - **T2, politică nouă pe o țintă** (`CREATE POLICY … TO anon`, review r3): schimbă alt catalog decât rândul blocat. De aceea T2 ia
    **ACCESS SHARE** pe fiecare tabel / vedere din listă, înainte de blocare, până la COMMIT. Nu oprește citiri sau scrieri, dar intră în
    conflict cu tot DDL-ul care cere ACCESS EXCLUSIVE: CREATE / ALTER / DROP POLICY, pornirea / oprirea RLS, rescrierea unei vederi, DROP,
    schimbarea proprietarului (CREATE POLICY probat cu două sesiuni, R6; restul de confirmat pe sursa 17.6 la review). Un astfel de DDL
    venit după noi așteaptă și rulează după COMMIT, peste starea nouă (îl vede controlul periodic); unul deja în curs la pornire => 100 ms,
    apoi refuz. Vederile materializate și tabelele străine nu se pot bloca așa, dar nici nu pot avea politici. A doua plasă: la final,
    niciun obiect din jurnal nu are politică pentru `anon` / PUBLIC (altfel refuz). **Costul:** câte un lock pe relație (~400, plus
    relațiile citite de vederi), câteva ms; un DDL care cere ACCESS EXCLUSIVE pe o țintă cât suntem în tranzacție așteaptă după noi (cel mult
    până la plafonul de 2000 ms) și, cât așteaptă, ține la coadă cererile care vin după el pe acel tabel. Tabela de lock-uri plină = refuz;
  - încercat de altă sesiune după blocare, pe aceleași obiecte (GRANT / REVOKE / ALTER care rescriu rândul): așteaptă după noi și pică după
    COMMIT („tuple concurrently updated”), deci nu se aplică și nu se pierde;
  - un drept pe o **coloană** care nu avea drepturi (rândul ei nu se blochează): prins după REVOKE (coloanele rescrise trebuie să fie exact
    cele de la recitire) => refuz;
  - obiecte noi / drepturi pe obiecte din afara listei, apărute după blocare: nu sunt atinse; prinse de postcondiții dacă sunt comise
    înaintea lor, altfel de controlul periodic.
  Garanția: ce retrage REVOKE-ul = exact ce e în jurnal, deci revenirea reface exact. Postcondiția o verifică direct: ACL-ul complet
  „după” al fiecărei ținte = „înainte” fără EXACT intrările lui `anon` din jurnal (nimic în plus, nimic în minus pentru alt rol).
- **Blocarea nu e „fără urme”:** rescrie rândurile din catalog ale țintelor (alt `xmin`, scrie în WAL, cu același conținut) și creează /
  șterge un rol (catalogul de roluri e comun pentru tot serverul). Totul în aceeași tranzacție: la refuz nu rămâne nimic.
- **Lock-uri (PostgreSQL 17.6, citit din sursă la review):** GRANT / REVOKE **nu iau lock pe obiectele-țintă**. Deschid catalogul
  (`pg_class`, `pg_attribute`, `pg_default_acl`) și rescriu rândul fiecărui obiect. Singurul lock pe relații e ACCESS SHARE-ul luat
  explicit de T2 (mai sus). Deci nu opresc citiri, scrieri sau `nextval`. Ce ne
  serializează cu alte sesiuni sunt rândurile din catalog rescrise de noi, ținute până la COMMIT (vezi mai sus). Noi așteptăm doar după o
  tranzacție care rescrisese deja rândul (100 ms, apoi refuz). VACUUM / ANALYZE pe aceleași obiecte pot aștepta cel mult cât tranzacția
  noastră (sub plafon). Duratele din PGlite (PostgreSQL 18, o singură conexiune) **nu validează** producția.
- **Confirmat pe clona PostgreSQL 17.6, cu două sesiuni reale (12.11.2026):** sesiunea care încearcă un GRANT pe un obiect deja blocat de noi
  stă blocată și pică la COMMIT-ul nostru cu „tuple concurrently updated”; rândul unei coloane fără drepturi nu se blochează (GRANT-ul pe ea
  trece imediat), iar verificarea coloanelor îl prinde. Drept în zbor la pornire: refuz prin lock_timeout (~270 ms de la pornire). Durate
  pe clonă: `b` ~220 ms, revenirea lui `b` ~50 ms de la BEGIN. Ambii mutanți (`fara_recitire`, `fara_coloane`) sunt prinși.
- **Proba pe clonă PostgreSQL 17 (înainte de orice „da”):**
  1. citirea pe clonă → rândurile `BASELINE` ale clonei;
  2. proba cu două sesiuni reale: `scripts/anon_drepturi_concurenta.mjs --sistem <identificatorul clonei>` (refuză altă țintă, altă versiune
     sau o gazdă Supabase). Scenarii: drept comis între calcul și blocare (R1, refuz), drept nou pentru PUBLIC în aceeași fereastră pe `a`,
     `b` și `c` (R7a / R7b / R7c: refuz, iar dreptul celeilalte sesiuni rămâne), drept încercat după blocare (R2: cealaltă sesiune stă
     blocată de noi și pică după COMMIT), drept în zbor la pornire (R3, refuz în 100 ms), drept pe o coloană neblocată (R4, refuz), politică
     nouă pentru `anon` pe o țintă T2 după postcondiții (R6: cealaltă sesiune stă blocată până la COMMIT-ul nostru), `c` cu un ALTER DEFAULT
     PRIVILEGES după blocare + revenire exactă (R8), aplicare + revenire fără concurență (R5 pe `b`; R9 pe `c` și `a`, cu duratele). Apoi
     mutanții `fara_recitire`, `fara_coloane`, `blocare_public` (blocarea din runda 3) și `fara_lock` (fără ACCESS SHARE): fiecare trebuie să
     arate defectul (ieșire 0 = prins);
  3. livrarea reală prin runner, cu `--plafon-tranzactie-ms 2000`: `a` → `b` → `c`, câte o livrare, cu BASELINE-ul clonei. Timpul din
     NOTICE-ul „sfarsit la … ms”: țintă sub 1000 ms; **la 1500 ms sau peste nu se aplică pe producție** (se împarte lista);
  4. citirea din nou (T1 / T2 / T3 = 0), reveniri `c` → `b` → `a` prin runner (instantaneul drepturilor = cel de la început), re-aplicare.
- **Cum revenim:** revenirea fiecărei trepte reface **exact** drepturile din jurnal (pe obiect și pe coloane, cu acordantul) și verifică după.
  Ordinea: `c` → `b` → `a`. Refuză dacă între timp s-a schimbat ceva ce nu poate reface exact: obiect șters / redenumit, coloană care nu mai e
  aceeași (redenumită, scoasă, alt tip, alta nouă cu același nume), drept nou dat lui `anon`, sau `a` cât timp `b` / `c` au rânduri. Revenirea
  lui `c` nu dă drepturi retroactiv obiectelor create între timp.

### Pașii coordonatorului
1. Producție, doar citire: `scripts/anon_drepturi_citire.sql` (ieșirea rămâne pe server). Se verifică:
   - `RPC_PUBLIC`: toate cu `definer = true` și `anon_execute = true`;
   - `FUNCTII_ANON`: niciuna folosită de paginile publice;
   - `CONTEXT_POSTGREST`: setările rolurilor `anon` / `authenticator` (doar nume) și `pre_request_in_baza`; separat, configurarea
     serviciului API (pre-request) din panoul platformei: dacă există o funcție pre-request, concluzia `SIMULARE` nu o acoperă (§2);
   - `SIMULARE`: **0 relații cu date citibile, 0 ambigue, 0 neexecutate** (linia `SIMULARE concluzie: ZERO …`). „Un rând doar cu zero /
     NULL” se judecă la sursă (§2): `FARA_DATE_LA_SURSA` / `CONSTANTA (fără surse în catalog)` se notează; un tabel cu un rând vizibil `(0)`
     iese „date citibile”. Erorile de drept (42501) se notează, nu blochează; o altă eroare = necunoscut. O `NEEXECUTATA` numește funcția
     și motivul: se citește funcția și se decide (nu se ocolește), cu nota umană din §2 în PR-ul T2. Liniile `SIMULARE cititori` arată
     tabelele citite ca proprietarul unei vederi obișnuite sau fără politici (cititor care ocolește RLS);
   - `STATISTICI`: pentru T2, regula de comparare din §2 (martorul crește; fiecare intrare directă din A e în B cu același `stats_since`
     și aceleași apeluri; nicio intrare directă nouă). Sărită sau `LIPSA DE DOVADA` = lipsă de dovadă;
   - `OBIECT`: lista pe trepte; `CONTROL`: amprenta lui „rămâne” și a politicilor pentru `anon` / PUBLIC pe tabele fără drept.
2. Clonă: proba de la §5 (pașii 1–4).
3. Review pe diff-ul cu BASELINE-ul completat. Lista pe obiecte se revizuiește din ieșirea citirii.
4. „Da”-ul owner-ului pentru fiecare treaptă → producție, în ordine, cu BASELINE-ul citit de pe producție chiar înainte. După fiecare: citirea
   din nou și testul paginilor publice (RSVP, formularul și informarea Redări, QR, concediu, aplică) și al ecranului de login, cu Ctrl+Shift+R.

## 6. Recomandare

**Toate trei, în ordinea T1 → T3 → T2, ca livrări separate.**
- T1 și T3 nu ating nimic folosit și opresc reapariția drepturilor. Merg după proba pe clonă.
- T2 e câștigul principal, dar **NU se aplică** până nu e îndeplinită condiția de la §2 (PR-ul de client pe producție + zero interogări
  directe ca `anon` pe tabele într-o citire nouă), apoi testul paginilor publice și al ecranului de login.
- Tabelele cu politici pentru PUBLIC (§4) rămân pentru o treaptă ulterioară, separată.

## 7. Regulile de review respectate

- **L01 / L03** — lista și ACL-ul complet sunt recitite sub blocare (rândurile din catalog ale obiectelor, rescrise de tranzacție) înainte
  de REVOKE; o schimbare apărută între calcul și retragere = refuz, nu suprascriere. Blocarea nu schimbă nimic înainte de verificare
  (santinela, r4); în T2 și DDL-ul pe ținte e oprit (ACCESS SHARE).
- **L06** — o singură ordine: jurnal → (T2: ACCESS SHARE pe ținte) → santinela → blocarea rândurilor din catalog → recitire → REVOKE;
  așteptare 100 ms.
- **L07** — regula se impune în bază, pe orice cale (dreptul lipsește, nu e doar ascuns în UI).
- **L09** — fiecare obiect e verificat pe identitate + nume + tip înainte de REVOKE și la revenire; fiecare coloană pe număr + tip + nume.
- **L07 / L08** (runda 6) — simularea pune contextul real al unei cereri fără sesiune (rol, metodă, cale, revendicări fără utilizator);
  o funcție care își schimbă singură identitatea (`SET request.jwt.claims` în definiție) sau citește setări nemodelate e refuzată, nu
  evaluată; identitatea din simulare nu autorizează nimic, e doar contextul probei.
- **L11 / L12 / L18** — citirea separă „date citibile”, „ambiguu”, „neexecutată” (funcție din afara listei albe), „fără date la sursă” și
  „constantă (fără surse în catalog)” (din catalog + citire efectivă ca `anon`, nu din formă), „gol” și „eroare” (de drept / necunoscută);
  nimic nu e „dovedit”: concluzia „zero” e o probă și cere 0 date, 0 ambigue, 0 neexecutate, 0 erori necunoscute; statistici sărite, texte
  ascunse, colectare oprită, fără `stats_since`, fără martor sau resetare necunoscută = lipsă de dovadă; o listă de lock-uri goală în proba
  locală = eșec, nu „ok”.
- **L13** (runda 6) — tiparele sunt ancorate și pe forme fixe: câmpurile arborelui intern al catalogului (`:funcid N` …, cu spațiu și
  cifre), cheia `current_setting` decodată din octeții constantei (nu din text deparsat), forma API-ului ancorată la început
  (`^WITH pgrst_…`); fiecare are test pozitiv + negativ (cheie calculată, SQL scris de mână cu nume între ghilimele, `INSERT` cu listă de
  coloane).
- **L14** — o tranzacție prin runner, cu postcondiții; revenire testată aplicare → revenire → re-aplicare. Revenirea refuză la istoric nou.
- **L15** — lista calculată din catalog comparată cu BASELINE-ul, înainte și sub blocare. Amprenta cuprinde identitatea, RLS / FORCE,
  politicile, corpul vederilor, DEFAULT-urile. Fără regex pe SQL. Un singur REVOKE pe nume citate din catalog.
- **L20** — sunt testate și căile legitime: RPC-ul DEFINER al paginii publice merge, INSERT-ul permis de politică merge, obiectul declarat la
  pct. 1 rămâne, partițiile păstrate se citesc; în citire (runda 6): `auth.uid()`, funcțiile stabile din listă (`now`, `date_trunc`,
  `to_char`, `jsonb_build_object`) și o politică pe metoda cererii (`GET`) trec, nu sunt refuzate; runda 7: vederea obișnuită a unui
  proprietar care ocolește RLS se execută ca până acum (politicile lui `anon` / PUBLIC de pe tabelul de sub ea nu se aplică, iar funcția
  din ele nu rulează: verificat în `pg_locks`), iar ieșirea spune de ce.
- **L07 / L08** (runda 7) — contextul de acces e cel real pe fiecare nivel: `anon` sau proprietarul vederii obișnuite (cu politicile și
  ocolirea RLS ale lui), nu doar `anon` peste tot.
- **L24** — condiția T2: clientul nu mai pornește interogări fără sesiune (PR separat).
- **L25** — verificări independente de regulă (instantaneul complet al drepturilor, cereri reale ca `anon`), mutanți pe migrări, reveniri și
  regulă; cursa: simulată determinist în PGlite + probă cu două sesiuni reale pe clona PG 17.6 (R1–R5 rulate 12.11.2026, comportamentele
  confirmate; R6–R9 și mutanții `blocare_public` / `fara_lock` noi în runda 4, de rulat pe clonă; proba compară pe nume calificate explicit și
  iese „probă nefuncțională”, nu verdict, când starea așteptată e goală sau niciun scenariu n-a fost judecat). Citirea (runda 6):
  contraexemplele review-ului #1090 sunt teste PGlite (funcția cu SET în definiție, `query_to_xml` peste altă schemă, lock-ul consultativ
  verificat în `pg_locks`, politica pe metoda cererii, resetarea selectivă), fiecare regulă nouă are mutantul ei, iar regula de comparare a
  statisticilor e scrisă în test independent de script. PGlite e PostgreSQL 18: citirea se rerulează pe clona PG 17.6 și pe producție.

## Deschis după review-ul rundei 4 (nu blochează merge-ul migrărilor neaplicate)

- **SIMULARE, clasa „agregat fără date”**: **închis în runda 5** — clasa după formă a dispărut; un rând doar cu zero / NULL se judecă la sursă (`FARA_DATE_LA_SURSA`) sau rămâne nedovedit (§2). Contraexemplul (`sum` peste `1` și `-1`, fără tabele) iese `CONSTANTA (fără surse în catalog)`.
- **Review #1090 (runda 6)**: cele 5 P1 și P2 închise prin refuz conservator (§2): funcții cu SET în definiție / proprii / de sistem care execută SQL = `NEEXECUTATA`; analiza înaintea execuției; contextul cererii API + setările nemodelate refuzate; `stats_since`, colectarea pornită și martorul; forma API-ului la interogările directe. Fiecare regulă are contraexemplul review-ului ca test și un mutant. Rămân limitele scrise în §2 (pre-request, setările rolului, conversiile tipurilor, domeniile).
- **Review r2 #1090 (runda 7)**: P1 (vederile obișnuite aplică politicile proprietarului) închis — închiderea poartă cititorul efectiv
  pe fiecare nivel, funcțiile din politicile proprietarului sunt pe aceeași listă albă înaintea execuției, ocolirea RLS e spusă în
  ieșire; contraexemplul review-ului (lock consultativ) e test + mutant. P2 (`toplevel`) închis — intrările imbricate sunt `alta`.
  Cele 5 vederi `NEEXECUTATA` de pe producție: nota umană (§2) în PR-ul T2.
- **POLITICI_ANON**: **închis în runda 5** — rândul `CONTROL POLITICI_ANON` (§4).
- **ATTACH PARTITION** ia doar ShareUpdateExclusive pe părinte, deci nu e oprit de lock-ul ACCESS SHARE al treptei T2; nu acordă drepturi și nu redeschide cursa cu politicile.
- **Înainte de aplicarea oricărei trepte**: probă prin runnerul real pe clonă (aplicare, revenire, reaplicare, sub 1500 ms), citire pe producție chiar înainte, BASELINE din aceeași citire, confirmarea atributului CREATEROLE și a triggerelor de eveniment pe producție, acordul owner-ului pentru fiecare treaptă.
