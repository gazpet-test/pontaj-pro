# Employees PII - raport de implementare

Data: 27.10.2026. Migrare NEAPLICATA. Totul este numai in worktree.


## Runda 3 - rezultat si limite

Baza r2 verificata SHA256 `00b383c7d0982dba2a2c355c21795d8c6eff7287c3416f26f5bd372faea61960`,
aplicata numai prin git apply. Fara commit/push/credentiale/BD/deploy.

- P1 Magazie: RPC esuat/refuzat lasa campurile necitite. Input dezactivat si
  explicatie; salveazaMasura refuza inainte de UPDATE. Draft separat de randul citit,
  deci onChange nu poate fabrica drept de salvare. Null citit ramane editabil.
- P1 copia externa: in 20261117a, CREATE OR REPLACE pastreaza functia din
  20260929e, cu o singura schimbare de business: telefon/email conditionate de
  auth.uid + owner/can_access_personal_data. Poarta can_modify_employees ramane.
  Preflight hash SHA256 pe prosrc, owner/definer/search_path/privilegii; snapshot
  pg_get_functiondef si ACL in backup protejat; rollback refuza driftul si verifica
  egalitatea exacta a definitiei restaurate. Mesajele vechi sunt pastrate prin
  literali SQL U& pentru sursa noua ASCII. Migrarea istorica nu este editata.
- P2 Logistica: PIN necitit este etichetat "PIN - doar owner/HR", fara numar
  fictiv de active; setarea dezactivata, cu garda si in setPin/togglePin.
- P2 Admin/Salarii: IBAN/email necitite sunt dezactivate cu explicatie vizibila.
  observatii_hr nu are input in App.jsx: confirmarea reactivarii distinge istoricul
  necitit, iar garda payload ramane. Niciun calcul de salarii/taxe modificat.
- Harness: adaugate cazuri de copiere modifier/owner/HR, rollback exact si drift.
  Optiunea unix_socket_directories se trimite numai pentru valoare nevida.

Conform situatiei comunicate in brief la 27.10: SELECT/UPDATE pe hr_personal_extern
sunt deschise oricarui authenticated, cu 0 copii telefon/email la acea data.
Nu am verificat independent in BD. Politicile acestui tabel raman nemodificate;
copiile ulterioare autorizate owner/HR raman citibile conform acelor politici.
Aceasta schimbare inchide copierea neautorizata, nu accesul la copiile autorizate.

PG17/PostgREST: NERULAT, instructiunea "No ... database" interzice accesul si local.
Verificari runda 3:
- PASS: `node --test scripts/test_employees_pii_client.mjs`, 27/27 (21 existente + 6 noi).
  Noile teste executa disabled/callback/save din sursa reala; includ null legitim,
  necitit, draft editat, PIN necitit vs absent, contor si blocarea actiunilor.
  Paritatea statica reconstruieste functia istorica exacta, verifica hash-ul prosrc
  si decodeaza fixture-ul U& la corpul istoric; nu echivaleaza cu executie PG.
  Testul shell executa fragmentul real pentru socket gol/nevid, fara a porni BD.
- PASS: `node --check src/employeesPersonal.js`; `bash -n scripts/test_employees_pii.sh`.
- Vitest / vite build: NERULATE. `npm ci --ignore-scripts --no-audit --no-fund`
  esueaza inainte de instalare cu `uv_os_homedir returned ENOMEM`. node_modules lipseste.
  Cache-ul si configuratiile npm directionate numai in worktree; nu s-au citit
  credentiale si nu s-au schimbat package.json/package-lock.json.
- PG17 apply/rollback/reapply, SQL privileges si PostgREST: SCRISE, NERULATE.
  Nu afirm ca intreaga suita existenta sau integrarea SQL sunt verzi.
- Toate fisierele atinse in runda 3 sunt LF; artefactele SQL/test noi sunt ASCII.
  Textele existente din JSX au fost pastrate; nu s-a transliterat aplicatia.

## Stare

Pregatite: inventar, migrare/rollback, selectii explicite, RPC de citire owner/HR,
helper client, harness PG17 si teste client. Nu este validat pentru productie.

Runda 2: decizia Razvan din 27.10.2026 este implementata pentru omiterea
campurilor necitite in Admin/reactivare/Salarii si exceptia de citire marimi EIP.
Calculele de salarii/taxe nu au fost modificate. Validarea PG17/PostgREST ramane
neefectuata; pachetul nu este declarat validat pentru productie.

S-a rulat numai git apply pentru patch-ul de baza cerut. Nu s-a facut commit/push, nu s-au citit secrete, nu s-a accesat
nicio BD si nu s-a facut deploy. Cererea initiala "No Git commit" prevaleaza
asupra ultimei propozitii din brief.

Istoric runda 2: patch verificat atunci, SHA-256
`ef7f2828c2a0560e5f341741bd0db08dceb73f1f1c179cda1db616d64f605423`.

## Delta runda 2

- `src/employeesPersonal.js`: employeePersonalWrite verifica proprietatea proprie
  din randul citit initial, inclusiv null citit; omite absent/undefined. Formularul
  editat nu poate transforma un camp necitit intr-unul citit. Paginarea RPC comuna
  este refolosita de withEmployeeMarimi: loturi 100, keyset pana la pagina goala,
  verificarea sesiunii, fara rezultat personal partial la eroare.
- `src/App.jsx`: Admin include IBAN numai daca a fost citit; reactivarea omite
  observatii_hr necitite, fara concatenare peste istoric ascuns; Salarii omite
  UPDATE employees.email daca emailul nu a fost citit, chiar daca formularul
  initializeaza sau modifica empEmail. Valorile citite null/'' raman editabile.
- Migrarea NEAPLICATA `20261117a`: fn_employees_marimi(bigint[] DEFAULT NULL),
  numai id si cele doua marimi; auth.uid nenul si owner/HR SAU intrare explicita
  user_module_access(profile_id,module='magazie',access_level viewer/editor/admin).
  Cheia este confirmata de ruta /magazie din App.jsx si migrarile 20261103b/20261106a.
  Rolul singur nu ajunge. SECURITY DEFINER, search_path fix, REVOKE PUBLIC/anon/
  service_role, GRANT authenticated; postconditii pentru privilegiile efective.
  Filtre/paginare/plafon identice cu fn_employees_personal (plafon PostgREST).
  Preflight refuza inclusiv overload-uri marimi existente. Rollback sterge noul RPC
  si pastreaza restaurarea integrala a ACL employees.
- `src/Magazie.jsx`: citeste marimile separat prin RPC, fara SELECT direct personal;
  la refuz/eroare/incompletitudine afiseaza banner clar si continua fara marimi.
  Token de generatie pentru loadAll si invalidare la unmount impiedica aplicarea
  rezultatelor vechi si mesajelor din incarcari depasite.
- Harness SQL: owner, HR inclusiv read-only, fiecare nivel Magazie explicit,
  rol fara intrare, modifier-only, alt modul, auth.uid NULL, anon; fara exceptie
  PIN, fara SELECT direct marimi. Fixture cu FK/CHECK/UNIQUE pentru acces.
  Harness shell accepta `LOCALE` (implicit C.UTF-8) si `UNIX_SOCKET_DIRECTORIES`
  (implicit gol), pastrand implicitele Linux. Verifica disparitia ambelor RPC-uri
  dupa rollback, ACL exact, date neschimbate si re-apply.

Verificari runda 2, inainte de verificarea build: 21/21 teste client PASS;
`node --check src/employeesPersonal.js` PASS; `bash -n scripts/test_employees_pii.sh`
PASS. Testele executa constructiile reale de payload extrase din App.jsx, inclusiv
camp editat fara citire, istoricul citit si null legitim; nu simuleaza taxe.
PG17 nu este rulat: instructiunea curenta interzice accesul la BD, inclusiv locala.
`vite build`: NERULAT. Nu exista node_modules; incercarea npm ci din runda 2
esueaza la initializare cu `uv_os_homedir returned ENOMEM`, inainte de instalare.
Cache-ul si configuratiile npm au fost directionate numai in .tmp din worktree.
Nu s-au modificat package.json/package-lock.json si nu s-au citit configuratii secrete.

## Ce s-a schimbat

| Fisier | Modificare |
| --- | --- |
| docs/securitate/EMPLOYEES_PII_INVENTAR.md | 62 apeluri directe src, 3 edge, 2 API; embed-uri, referinte SQL din migrari si schema initiala, payload-uri dinamice, delta dupa modificari |
| scripts/prepare_employees_pii.py | Generator static al inventarului; nu ruleaza SQL si nu modifica src |
| supabase/migrations/20261117a_employees_pii.sql | Garda runner cu txid, READ COMMITTED, lock, baseline inchis de coloane/tipuri, snapshot complet ACL/politici, REVOKE SELECT tabel/coloane, GRANT doar cele 27 coloane publice, RPC personal, postconditii |
| supabase/revenire/20261117a_employees_pii_ROLLBACK.sql | Garda separata, lock inainte de verificare, refuz la drift de schema/ACL, restaurare grantor/grantee/privilegiu/grant option, comparatie integrala ACL, eliminare exclusiv obiecte noi |
| src/employeesPersonal.js | Lista publica inchisa, completare personala pe aceleasi id-uri, autorizare verificata in RPC, loturi de 100 si keyset pana la pagina goala, verificare sesiune, eroare vizibila fara continuare partiala |
| src/App.jsx | 9 selectii wildcard devin lista explicita; Admin completeaza iban/observatii_hr autorizat; Salarii completeaza email autorizat; export banca cere IBAN cu drept personal obligatoriu |
| src/HR.jsx | 2 selectii wildcard devin lista explicita; lista activa/fisa fostului angajat completeaza datele personale numai prin RPC |
| src/HrPersonalExtern.jsx | Lista fostilor angajati nu mai cere email direct; completare autorizata prin RPC |
| src/Logistica.jsx | Cele 3 citiri de PIN-uri nu mai cer coloanele personale direct; completare prin RPC numai pentru owner/HR |
| src/Magazie.jsx | Lista publica explicita; marimi prin RPC autorizat, banner la eroare, garda generatie/unmount |
| scripts/test_employees_pii.sh / .sql / _fixture.sql | Cluster local PG17 izolat, rol postgres NOSUPERUSER, roluri API reale in teste, fixture fictiv, apply/rollback/reapply |
| scripts/test_employees_pii_client.mjs | 21 teste executabile cu node:test, fara npm/Supabase/retea |

Celelalte citiri explicite si embed-urile employees(name/functie/...) raman valide.
Wizard-ul are deja INSERT cu RETURNING id,name, deci nu a fost modificat.
Nu s-a schimbat calculul salarial, nicio politica RLS de scriere, niciun flag de profil,
nicio atribuire user_module_access. Runda 3 modifica explicit RPC-ul de legare externa.

## Alegerea mecanismului

RPC-ul fn_employees_personal(bigint[] DEFAULT NULL) verifica auth.uid() nenul
si profiles.is_owner IS TRUE OR profiles.can_access_personal_data IS TRUE.
Numele rolului, department si can_modify_employees NU acorda citirea personala.
Intoarce id si exact cele 12 coloane din decizia A. Poti cere [] pentru zero randuri,
id-uri individuale sau NULL pentru toate; clientul foloseste doar id-urile deja selectate.
Este STABLE, SECURITY DEFINER, search_path fix public,pg_temp si are EXECUTE
revocat pentru PUBLIC, anon si service_role; authenticated are EXECUTE cu poarta in corp.

Un view security_invoker nu poate acorda ownerului aplicatiei coloane refuzate
rolului BD authenticated, folosit si de owner si de HR. RPC-ul evita roluri BD noi,
duplicarea formularelor si mutarea datelor intr-un tabel nou.

SELECT tabel este revocat pentru authenticated/anon, apoi sunt revocate si
granturile SELECT directe pe fiecare coloana, inclusiv cele care ar supravietui
REVOKE pe tabel. Numai authenticated primeste lista publica. Postconditiile verifica
privilegiile EFECTIVE, deci granturile mostenite/PUBLIC care expun personal refuza
tranzactia. Nu se foloseste CASCADE pentru ACL.

INSERT/UPDATE raman sub granturile si RLS existente: owner sau can_modify_employees.
Un utilizator cu doar can_access_personal_data citeste prin RPC, dar nu primeste
scriere noua. Un utilizator cu doar can_modify_employees pastreaza scrierea si
nu primeste citire. Asa cere pastrarea comportamentului existent; "HR poate scrie"
nu inseamna ca flagul de citire acorda si scriere.

RETURNING cnp/iban/qr_pin sau * este refuzat inclusiv pentru owner/HR conectat
ca authenticated. RETURNING id/name ramane valid. Dupa o scriere personala se
reciteste prin RPC; apelurile existente nu cer personal in RETURNING.

Snapshot-ul salveaza metadate ACL, nu valori HR. RLS activ fara policies si
REVOKE pentru rolurile API protejeaza tabelul de backup. Rollback restaureaza
semantica completa a privilegiilor, inclusiv grant option si grantor; ordinea
textuala a aclitem nu este un privilegiu si nu este promisa. Drift-ul ulterior
este refuzat inainte de revocari. Nu se sterg/modifica randuri employees nici
la apply, nici la rollback; nu e necesara conditia "fara angajati noi".

## Riscuri concrete si decizii ramase

1. **Inchis in cod pentru caile autorizate.** Admin/reactivare/Salarii omit
   campurile personale necitite; 3 teste noi executa constructiile reale.
   Reactivarea fara drept nu adauga nota de incetare, conform deciziei de omitere;
   istoricul existent nu este suprascris. Mesajul legacy de confirmare despre
   notarea incetarii ramane o limita de UX (scope strict payload). Nu s-au
   schimbat drepturile de scriere sau introdus garantii noi de concurenta.
2. **Inchis pentru marimi EIP in cod; validare SQL ramasa.** Exceptia aprobata
   foloseste numai fn_employees_marimi si acces explicit magazie/owner/HR.
   SELECT direct ramane blocat. PIN-urile qr_pin* raman numai owner/HR, fara
   exceptie Magazie sau Logistica. Telefonul soferului extern este alta sursa.
3. **Copii in alte tabele (runda 3).** Copierea noua de telefon/email prin
   fn_fost_angajat_leaga_extern cere drept personal. Politicile hr_personal_extern
   nu se modifica: copiile facute legitim de owner/HR sunt in continuare citibile
   de authenticated. Brief-ul comunica 0 copii la 27.10; fara verificare live.
   Audit/recycle-bin/exporturi vechi raman de verificat separat.
4. **Surse QR lipsa.** qr-utilaj-info, qr-alimentare-submit si qr-bon-comun-lookup
   sunt invocate de QrUtilajPage, dar nu exista surse qr-* in supabase/functions.
   Nu se poate confirma rolul folosit. Un service_role cu SELECT existent pe tabel
   ramane neafectat; BYPASSRLS singur nu acorda SELECT. Harness-ul verifica
   service_role cu SELECT, nu codul edge absent.
5. **View-uri/definer live.** Preflight-ul foloseste pg_depend recursiv si refuza
   view-uri owner/materializate accesibile prin dependente relevante. Garda e
   deliberat conservatoare pentru dependenta pe intreaga relatie: poate refuza
   si un view care intoarce numai nume. Un asemenea refuz necesita baseline
   revizuit, nu eliminarea garzii. Nu exista graf complet pg_depend pentru
   apeluri PL/pgSQL/dynamic. Inventarul si revocarea granturilor NU dovedesc singure
   lipsa oricarui RPC vechi care serializeaza randuri sau copiaza personal.
6. **Compatibilitate si asincron.** Erorile helperului afiseaza toast si arunca,
   oprind exporturile/incarcarile inainte de aplicarea unui rezultat partial.
   Unele callback-uri legacy nu au catch local si pot produce promise rejection
   in consola dupa toast; componentele nu au primit o refacere generala a
   mecanismului de generatie/unmount. Helperul verifica schimbarea sesiunii,
   dar asta nu reprezinta o garantie de ordine intre doua load-uri ale aceluiasi
   ecran. In runda 2 EchipamenteTab are garda generatie/unmount pentru noua citire;
   celelalte componente legacy nu au fost refacute.
7. **Volum.** Noul RPC este paginat pe id pana la pagina goala, inclusiv sub un
   max-rows mai mic. Listele publice legacy nu au fost repaginate global:
   plafonul PostgREST existent ramane de verificat. Inventarul SQL este static,
   include referintele si un superset de coloane mentionate in bloc; nu este
   echivalent cu o analiza semantica completa a catalogului live.

## Verificari initiale runda 1 si limite (runda 2: vezi delta de mai sus)

- PASS: `node --test scripts/test_employees_pii_client.mjs`, 13/13, Node 24.20.0.
  Cazuri: allow-list independenta din brief + paritate GRANT SQL, non-HR fara RPC,
  export bancar refuzat, owner/HR, limita server 1, forme single/lista goala,
  erori RPC/profil/query, raspuns incomplet, sesiune schimbata, loturi 205 id-uri,
  scanare selectii directe src fara wildcard/personal.
- PASS: `node --check src/employeesPersonal.js`.
- PASS: `bash -n scripts/test_employees_pii.sh` cu Bash local.
- Harness PG17: SCRIS, NERULAT. Nu s-a accesat nicio BD. Fixture-ul copiaza
  coloanele/check-urile employees din scheletul existent, cu auth/profiles/RLS
  necesare; nu reproduce toate triggerele ciclului de viata sau extensiile de
  productie. Nu este prezentat ca test de integrare completa.
- `vite build`: NERULAT. Nu exista node_modules. Instalarea `npm ci --ignore-scripts
  --no-audit --no-fund` cu cache/config directionate in worktree a esuat la
  initializarea npm: `uv_os_homedir returned ENOMEM`. Nu s-au instalat librarii
  noi si nu s-au modificat package.json/package-lock.json.
- Vitest/Deno/PostgREST real: NERULATE. Nu exista dependintele locale si nu au fost
  autorizate conexiuni la servicii. Niciun query nou nu este declarat validat
  pe API-ul real doar pentru ca trece testul client.

Pentru verificarea locala PG17: `bash scripts/test_employees_pii.sh`.
Harness-ul creeaza propriul cluster numai pe 127.0.0.1, sub worktree, neutralizeaza
configuratia libpq mostenita, foloseste postgres NOSUPERUSER, testeaza garda,
schema drift, PUBLIC, view expus, overload RPC, DML/RETURNING cu rol authenticated,
owner/HR/read-only/modifier, auth.uid NULL, anon si service_role, lipsa modificarilor
de date, rollback ACL integral, refuz drift si re-apply. Nu il indreptati spre productie.

## Teste manuale necesare inainte de livrare

1. Verificati in UI garzile implementate pentru campurile personale necitite.
2. Rulati harness-ul PG17 si `npx vite build`, apoi verificarile de regresie HR/conturi.
3. Cu token de utilizator normal, prin PostgREST real: GET name/functie reusit,
   GET cnp/iban/qr_pin/* refuzat; embed employees(name) reusit, employees(*) refuzat.
   PATCH/POST cu `Prefer: return=representation` personal/* refuzat; id/name permis
   numai daca exista drept de scriere. Nu verificati doar cu rolul administrativ.
4. Owner si HR: lista HR, fisa fostului angajat, IBAN Admin, email Salarii si export
   bancar; utilizator normal vede listele operationale fara telefon/PIN.
   Owner/HR si utilizator cu intrare explicita magazie citesc marimile EIP;
   fara aceasta intrare ecranul continua fara marimi si afiseaza mesajul.
   Utilizatorul numai can_access_personal_data citeste, dar nu scrie; modifierul
   fara acces personal poate modifica public fara pierderea campurilor personale.
5. Verificati prin API filtrele `.select('id,...').order('id').gt('id',...)` pe RPC,
   politica de profil, plafonul max-rows si refresh-ul cache-ului PostgREST dupa NOTIFY.
6. Confirmati pe sursele reale qr-* credentialul de serviciu si testati autentificarea
   PIN/alimentarea. Nu publicati niciun secret in rezultate.
7. Verificati ACL/owner/proconfig/corp/callee pentru RPC-urile existente din inventar,
   politicile copiilor personale si orice view refuzat de preflight. Snapshot-ul
   local nu este dovada starii live. Exceptia EIP este aprobata in aceasta runda;
   nicio exceptie pentru PIN. Politicile hr_personal_extern raman in afara rundei; copierea prin RPC este reparata in runda 3.
8. Pe mediu local de integrare: apply -> rollback -> re-apply, verificand ACL tabel
   SI coloane, grant option/grantor si lipsa schimbarilor in employees.

## Fisa de securitate

| Element | Rezultat proiectat / limita |
| --- | --- |
| Identitate | auth.uid(), NULL refuzat; fara p_user sau GUC custom ca autorizare |
| Citire publica | Lista inchisa de 27 coloane, grant pe coloane + RLS existent |
| Citire personala | 12 coloane + id numai owner/HR; exceptie separata doar pentru marimi prin fn_employees_marimi, acces explicit magazie sau owner/HR |
| Scriere | Granturi/RLS existente; can_modify_employees nu primeste citire; garzi de omitere Admin/reactivare/Salarii |
| RETURNING | Refuz personal/* la rol authenticated; id/name permis |
| Granturi mostenite/PUBLIC | Verificate efectiv; tranzactie refuzata daca raman |
| View-uri | Garda recursiva conservatoare, fara rescrierea view-urilor existente |
| Functii vechi/copii | Copiere externa conditionata de drept personal; politicile tabelului extern si auditul live raman separate |
| Secrete | Nu se citesc sau se logheaza valori personale; fixture-uri fictive |
| Service | Granturile tabelului pentru service_role nu sunt modificate; sursele qr-* absente |
| Rollback | Restaurare ACL exacta semantic; refuz la drift, fara stergerea datelor HR |
| Aplicare | Niciuna; numai artefacte in worktree, fara commit/deploy |

## L01-L25 - evaluare finala runda 3

| Regula | Aplicare / dovada / limita |
| --- | --- |
| L01 | Migrare: advisory apoi lock employees; rollback lock employees/backup inainte de verificare. RPC extern pastreaza lock-urile FOR UPDATE si idempotenta istorice; test SQL repeta legarea aceluiasi angajat. Fara mutatii client noi. |
| L02 | Migrare si rollback in tranzactia unica armata de runner; RPC copiaza atomic. Harness shell pastreaza --single-transaction; SQL NERULAT. |
| L03 | n/a |
| L04 | n/a - nu se introduc bani/cantitati/mail; idempotenta RPC externa existenta este pastrata si are caz SQL. |
| L05 | n/a |
| L06 | Ordinea advisory -> employees -> backup la revenire ramane. RPC extern pastreaza ordinea employees -> extern existent; fara lock nou. Testul static compara intregul corp vechi, exceptand poarta aprobata. |
| L07 | Poarta de copiere in CREATE OR REPLACE, nu doar UI; fn_employees_personal si ACL pe coloane raman. Limita explicita: SELECT/UPDATE hr_personal_extern raman deschise pentru authenticated, conform brief; nu se pretinde inchiderea tuturor copiilor. |
| L08 | Poarta noua foloseste auth.uid nenul + flags profiles; identitatea/poarta veche fn_identitate_om si can_modify_employees pastrate. Cazuri SQL NULL, modifier, owner, HR si HR doar citire; NERULATE. |
| L09 | Exceptia Magazie ramane autorizata server-side pe module='magazie', nivel explicit, sau owner/HR. Nicio identitate client noua; tests SQL existente pastrate. |
| L10 | Fara citire de secrete/credentiale; contacte exclusiv fictive in fixture. PIN necitit nu este tratat ca inexistent. |
| L11 | n/a |
| L12 | RPC esuat ramane eroare vizibila si lista publica fara marimi; inputs necitite dezactivate. Testele client pastreaza refuzul rezultatelor partiale. |
| L13 | Test pozitiv/negativ pentru expresiile reale; regex numai pentru teste statice, nu pentru autorizare SQL. Baseline prosrc este SHA256 pe bytes UTF8/LF, nu regex. |
| L14 | Backup cu definitia pg_get_functiondef si ACL; rollback verifica drift inainte de restaurare si egalitatea exacta dupa. Harness apply -> rollback -> reapply extins, NERULAT. Nu se modifica date employees la migrare. |
| L15 | Preflight prosrc SHA256 din 20260929e + owner/definer/search_path/privilegii. Snapshot ACL si pg_get_functiondef; test static independent confirma baseline si pastrarea corpului. Partial: auditul tuturor callee/triggere live ramane neefectuat; nu se pretinde amprenta completa. EXECUTE la rollback foloseste doar snapshot protejat, fara text client. |
| L16 | n/a - nicio cheie de business noua; constrangerile de unicitate ale fixture-ului extern sunt reproduse. |
| L17 | n/a - calculul salarial/taxele si regulile de timp nu sunt modificate. |
| L18 | employeeFieldRead distinge proprietate absenta/undefined de null citit. Magazie fara scriere la blur; Admin/Salarii disabled; Logistica fara 0 active sau Set PIN pentru necitit. Teste executabile PASS. |
| L19 | employeeFieldRead comun UI, save Magazie/PIN si employeePersonalWrite. Poarta SQL de copiere foloseste acelasi predicat ca fn_employees_personal. Test static pentru paritatea corpului istoric; test SQL modifier/owner/HR scris. |
| L20 | Teste pozitive null citit + editare/stergere marime, PIN null existent vs necitit; SQL owner/HR si modifier, idempotenta si legare explicita, HR read-only refuzat. Client PASS; SQL NERULAT. |
| L21 | n/a |
| L22 | n/a |
| L23 | Paginarea comuna a celor doua RPC-uri ramane pana la pagina goala; testele existente loturi/cap server 1 PASS. Listele publice legacy nu sunt repaginate global. |
| L24 | Garda generatie/unmount Magazie din r2 ramane. Draft-ul de marimi este separat de employees si nu fabrica proprietati citite. Nu sunt introduse load-uri async noi. Limitele de cursa legacy din alte ecrane raman. |
| L25 | 27/27 node:test PASS; source callbacks/disabled executate cu expected independent. Testele SQL ruleaza ca authenticated, harness postgres NOSUPERUSER; fixture cu FK/UNIQUE si baseline prosrc exact. Fixture fn_identitate_om este minimala si nu reproduce intregul lant live de triggere. PG17/PostgREST/Vitest/build NERULATE; motivul de mai sus. |
