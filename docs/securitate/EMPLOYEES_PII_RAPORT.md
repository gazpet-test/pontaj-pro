# Employees PII - raport de implementare

Data: 27.10.2026. Migrare NEAPLICATA. Totul este numai in worktree.

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

Patch verificat inainte de aplicare: SHA-256
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
nicio atribuire user_module_access si niciun RPC existent.

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
3. **Copii in alte tabele.** fn_fost_angajat_leaga_extern (20260929e:590-592)
   copiaza telefon/email in hr_personal_extern. Scheletul conturi_schelet_supabase.sql:552
   are SELECT pentru orice logat. Asta poate pastra o cale de citire a datelor
   copiate chiar dupa restrictionarea employees. Nu se poate confirma politica
   live fara BD. Restrictionarea acestui tabel/RPC existent depaseste brief-ul;
   necesita decizia lui Razvan. Verificati si audit/recycle-bin/exporturi vechi.
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
   nicio exceptie pentru PIN. hr_personal_extern ramane explicit in afara rundei.
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
| Functii vechi/copii | Inventariate; auditul live/calea hr_personal_extern raman deschise |
| Secrete | Nu se citesc sau se logheaza valori personale; fixture-uri fictive |
| Service | Granturile tabelului pentru service_role nu sunt modificate; sursele qr-* absente |
| Rollback | Restaurare ACL exacta semantic; refuz la drift, fara stergerea datelor HR |
| Aplicare | Niciuna; numai artefacte in worktree, fara commit/deploy |

## L01-L25

| Regula | Aplicare / dovada / limita |
| --- | --- |
| L01 | Lock employees inainte de snapshot; rollback blocheaza employees/backup inainte de drift check. Nu sunt introduse cote sau mutatii concurente de date. |
| L02 | Migrarea/rollback necesita tranzactie unica prin runner/psql --single-transaction. Noul RPC doar citeste. |
| L03 | n/a - fara lease, cache derivat sau scriere conditionata de versiune. |
| L04 | n/a - fara bani, cantitati, mail sau intentii mutabile noi. |
| L05 | n/a - fara fallback platit, stergere storage sau retry de scrieri. |
| L06 | Advisory gazpet.livrare_migrare -> lock employees; rollback apoi backup. Ordinea este explicita, nu se blocheaza mai multe entitati HR. |
| L07 | GRANT pe coloane si poarta in RPC impun regula direct in BD, inclusiv SELECT/RETURNING. Limita: copiile hr_personal_extern si RPC-urile live vechi necesita audit separat. |
| L08 | RPC foloseste numai auth.uid si profile flags. NULL refuzat in harness SQL; niciun parametru de identitate. |
| L09 | fn_employees_marimi verifica auth.uid si intrarea explicita profile_id/module='magazie', nivel valid, sau owner/HR. Test SQL cu rol fara acces si alt modul, plus viewer/editor/admin; NERULAT. Nu exista scope de proiect pentru employees. |
| L10 | Nu se creeaza parole sau se citesc secrete; PIN existent doar restrictionat la citire. Nicio derivare din CNP/telefon; fixture-urile sunt fictive. |
| L11 | n/a - fara extragere AI/documente sau afirmatii de dovada. |
| L12 | Inventarul numara 62 apeluri src independent de cifra din brief, include embed-uri/SQL. Helperul refuza raspunsul personal incomplet. Analiza SQL statica este declarata superset, nu dovada completa live. |
| L13 | Regex-ul este folosit numai pentru inventar/static tests, nu ca poarta SQL/autoritate de acces. SELECT/RPC se valideaza prin privilegii/corp SQL; staticele nu sunt prezentate ca parser semantic. |
| L14 | Fara BEGIN/COMMIT in artefact, garda txid/READ COMMITTED, tranzactie in runner, postconditii, backup ACL, rollback cu lock/drift check. Apply/rollback/reapply scris in harness, NERULAT. |
| L15 | Partial: baseline inchis coloane/tipuri, ACL complet cu grantor/grant option, politici snapshot, dependente view pe catalog. NU pretind amprenta completa pe corp/callee/triggere live; necesita audit de integrare inainte de productie. |
| L16 | n/a - nicio cheie noua de business/dedup. singleton backup are PRIMARY KEY/CHECK. |
| L17 | n/a - nu se schimba parsarea numerelor sau regulile de timp; filtrele legacy sunt pastrate. |
| L18 | withEmployeeMarimi: eroare/refuz/incompletitudine/sesiune schimbata = mesaj explicit si lista publica fara marimi, nu afirmatie ca marimile sunt goale. 3 teste negative noi PASS. Helperul personal/export ramane fail-closed. |
| L19 | employeePersonalWrite comun celor 3 payload-uri; mergeEmployeeRpc comun ambelor citiri. Allow-list independenta si paritate GRANT testate. Autorizarea ramane in SQL, clientul nu reproduce accesul Magazie. |
| L20 | Testele client pozitive/negative 21/21 PASS, inclusiv null citit si editare fara citire. Harness SQL extins cu toate exceptiile Magazie, refuzuri si PIN nemodificat; NERULAT. |
| L21 | n/a - nu se modifica raspunsuri AI sau scrierea lor. |
| L22 | n/a - nu se apeleaza AI/servicii platite. |
| L23 | Ambele RPC-uri folosesc acelasi keyset pana la pagina goala, loturi 100; teste cap server 1, 205 id-uri personal si 103 id-uri marimi PASS. Listele publice legacy nu sunt repaginate global. |
| L24 | Magazie EchipamenteTab: loadGeneration captureaza generatia, refuza rezultate vechi si invalideaza la unmount; helperul verifica sesiunea inainte de merge. Assert static pentru legarea garzii; fara test React de cursa. Limitele legacy din alte ecrane raman. |
| L25 | 21 teste client executate; payload-uri reale din App.jsx, valori asteptate independente. Harness SQL NOSUPERUSER/authenticated cu FK/CHECK/UNIQUE si rollback exact extins, NERULAT. SQL/PostgREST real nevalidate; build consemnat separat. |
