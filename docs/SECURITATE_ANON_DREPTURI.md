# Drepturile contului nelogat (`anon`): analiză și curățenie în trei trepte

**Stare:** DRAFT, nimic aplicat. E o schimbare de drepturi: fiecare treaptă se aplică doar cu „da”-ul owner-ului, după review.
**Fișiere:** migrările `20261218a` (T1), `20261218b` (T2), `20261218c` (T3) cu revenirile lor din `supabase/revenire/`, scriptul doar de citire
`scripts/anon_drepturi_citire.sql`, proba locală `scripts/pglite/test_anon_drepturi_local.mjs`, proba cu două sesiuni pentru clonă
`scripts/anon_drepturi_concurenta.mjs`, testul static `src/anonDrepturi.test.js`.
**Runda 2 (review #1081):** amprenta listei prinde și obiectele recreate; retragerea blochează rândurile din catalog și recitește lista
înainte de REVOKE; revenirea pe coloane verifică identitatea coloanei; citirea separă „date citibile” de „agregat fără date”; T2 are o
condiție nouă (§2, §6).

## 1. Pe scurt

- **Ce e `anon`:** rolul cu care ajunge în bază orice cerere făcută **fără cont**: pagina QR a șoferului, formularele publice, linkurile din
  mailuri, dar și **interfața ERP înainte de login, după logout sau cu sesiunea expirată**. Cheia publică a aplicației e în orice browser,
  deci oricine poate face o astfel de cerere.
- **Ce are azi:** drepturi pe aproape toate tabelele, vederile și secvențele din schema `public`. Le are din setările implicite ale bazei
  (orice tabel nou le primește automat), nu pentru că le-ar folosi cineva.
- **De ce nu e o breșă azi:** toate tabelele au RLS pornit și nicio politică nu-l lasă pe `anon` să vadă sau să scrie vreun rând (cele care îl
  includ cer toate un cont logat). Vederile citesc cu drepturile celui care întreabă. Citirea de pe producție (12.11.2026) a confirmat:
  nicio relație cu date citibile ca `anon` (§2).
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
fără sesiune și tratează explicit 401 / 403, fără bucle), pe producție; apoi statisticile resetate și o citire nouă după câteva zile de
lucru normal, care arată **zero** interogări directe ca `anon` pe tabele. Abia atunci T2. Tabelele nu se scot din T2.

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
- **Verificare înainte (citire):** `SIMULARE` (așteptat **0 relații cu date citibile**; agregatele fără date și erorile se listează separat),
  `FUNCTII_ANON` (niciuna folosită de o pagină publică), `STATISTICI` după reset (zero interogări directe pe tabele) și jurnalele API.
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
- rândul `CONTROL` (numărul + amprenta a tot ce **rămâne**): schimbat = ceva nou la „rămâne”, de ex. un obiect creat de `supabase_admin`
  (cu drepturile lui implicite pentru `anon`) sau o politică nouă pe un tabel rămas. Se caută în `OBIECT` (treapta RAMANE) și se analizează.
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
  - comis de altă sesiune între calcul și REVOKE: migrarea **blochează** întâi rândurile din catalog ale obiectelor din listă (o retragere fără
    efect de la PUBLIC, care rescrie rândul fiecărui obiect; se verifică că toate sunt acum ale tranzacției), apoi **recitește** lista: diferită
    de jurnal => refuz, nimic schimbat;
  - încercat de altă sesiune după blocare, pe aceleași obiecte (GRANT / REVOKE / ALTER care rescriu rândul): așteaptă după noi și pică după
    COMMIT („tuple concurrently updated”), deci nu se aplică și nu se pierde;
  - un drept pe o **coloană** care nu avea drepturi (rândul ei nu se blochează): prins după REVOKE (coloanele rescrise trebuie să fie exact
    cele de la recitire) => refuz;
  - obiecte noi / drepturi pe obiecte din afara listei, apărute după blocare: nu sunt atinse; prinse de postcondiții dacă sunt comise
    înaintea lor, altfel de controlul periodic.
  Garanția: ce retrage REVOKE-ul = exact ce e în jurnal, deci revenirea reface exact.
- **Lock-uri (PostgreSQL 17.6, citit din sursă la review):** GRANT / REVOKE **nu iau lock pe obiectele-țintă**. Deschid catalogul
  (`pg_class`, `pg_attribute`, `pg_default_acl`) și rescriu rândul fiecărui obiect. Deci nu opresc citiri, scrieri sau `nextval`. Ce ne
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
     sau o gazdă Supabase). Scenarii: drept comis între calcul și blocare (refuz), drept încercat după blocare (cealaltă sesiune stă blocată
     de noi și pică după COMMIT), drept în zbor la pornire (refuz în 100 ms), drept pe o coloană neblocată (refuz), aplicare + revenire
     fără concurență (exactă). Apoi `--mutant fara_recitire` și `--mutant fara_coloane`: fiecare trebuie să arate defectul (ieșire 0 = prins);
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
   - `SIMULARE`: **0 relații cu date citibile** (agregatele fără date și erorile se notează, nu blochează);
   - `STATISTICI`: pentru T2, după PR-ul de client și resetarea statisticilor, zero interogări directe pe tabele;
   - `OBIECT`: lista pe trepte; `CONTROL`: amprenta lui „rămâne”.
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

- **L01 / L03** — lista e recitită sub blocare (rândurile din catalog ale obiectelor, rescrise de tranzacție) înainte de REVOKE; o schimbare
  apărută între calcul și retragere = refuz, nu suprascriere.
- **L06** — o singură ordine: jurnal → blocarea rândurilor din catalog → recitire → REVOKE; nicio altă tabelă blocată; așteptare 100 ms.
- **L07** — regula se impune în bază, pe orice cale (dreptul lipsește, nu e doar ascuns în UI).
- **L09** — fiecare obiect e verificat pe identitate + nume + tip înainte de REVOKE și la revenire; fiecare coloană pe număr + tip + nume.
- **L12 / L18** — citirea separă „date citibile”, „agregat fără date”, „gol” și „eroare”; nimic nu e numărat ca „gol” din greșeală.
- **L14** — o tranzacție prin runner, cu postcondiții; revenire testată aplicare → revenire → re-aplicare. Revenirea refuză la istoric nou.
- **L15** — lista calculată din catalog comparată cu BASELINE-ul, înainte și sub blocare. Amprenta cuprinde identitatea, RLS / FORCE,
  politicile, corpul vederilor, DEFAULT-urile. Fără regex pe SQL. Un singur REVOKE pe nume citate din catalog.
- **L20** — sunt testate și căile legitime: RPC-ul DEFINER al paginii publice merge, INSERT-ul permis de politică merge, obiectul declarat la
  pct. 1 rămâne, partițiile păstrate se citesc.
- **L24** — condiția T2: clientul nu mai pornește interogări fără sesiune (PR separat).
- **L25** — verificări independente de regulă (instantaneul complet al drepturilor, cereri reale ca `anon`), mutanți pe migrări, reveniri și
  regulă; cursa: simulată determinist în PGlite + probă cu două sesiuni reale pe clona PG 17.6 (rulată 12.11.2026, comportamentele confirmate;
  proba compară pe nume calificate explicit și iese „probă nefuncțională”, nu verdict, când starea așteptată e goală).
