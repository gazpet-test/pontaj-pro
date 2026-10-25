# Magazie EIP B2 - TKT-0353

## Modificari

- src/Magazie.jsx: doar doua linii adaugate, import la linia 16 si montare buton/modal la linia 668. Nicio alta schimbare in acest fisier.
- src/EipIntrareModal.jsx: actiune vizibila dupa verificarea profilului, catalog activ cu cautare, document/furnizor, mai multe articole, repartizare live, cantitati in UM articolului, salvare exclusiv prin fn_eip_intrare_factura, inchidere/reincarcare/toast dupa succes.
- src/eipIntrareLogica.js: exporturi nominale, normalizare virgula/punct, comparare zecimala exacta, refuzarea pierderii de precizie, validare si construire payload dupa corpul RPC B1.
- src/eipIntrareLogica.test.js: 24 teste, inclusiv suma egala/diferita, marime absenta, cantitati invalide, virgula, buc/pereche fara conversie, NULL pentru unica, nespecificat, UUID generat doar la deschidere, dublu click si retry identic dupa eroare de retea. RPC simulat; niciun test nou nu foloseste BD.
- Fisierele noi si cele doua linii adaugate sunt ASCII.

Cheia crypto.randomUUID este generata in handlerul de deschidere. Ref-ul blocheaza sincron al doilea submit. Dupa rezultat incert se pastreaza si payload-ul, iar formularul este blocat pentru retry identic. Un refuz explicit de drept/validare pastreaza datele si permite corectarea. Cheia ramane aceeasi pana la inchiderea modalului.

## Diferente intre brief si contractul B1

1. Butonul existent + Echipament nu are conditie de drept in EchipamenteTab. Pentru noua actiune se verifica aceeasi regula ca fn_eip_verifica_drept: is_owner OR can_process_achizitii OR can_manage_stoc OR role=admin_logistica. Profil absent/eroare: buton ascuns. Nu s-au modificat drepturi, roluri sau actiunile existente.
2. Catalogul eip_articole nu contine o lista de marimi valide per articol, ci doar tip_marime. UI verifica numar pozitiv sau litere uzuale XS/S/M/L/XL etc.; nu poate certifica disponibilitatea unei marimi la producator. Se accepta explicit nespecificat pentru numar/litera, transmis NESPECIFICAT conform normalizarii B1. Pentru unica se transmite exclusiv NULL, conform conditiei serverului.
3. RPC-ul nu citeste/persista observatii sau motiv la receptie. Campul Observatii este dezactivat, cu explicatie vizibila. Constructorul refuza observatii nenule pentru a evita pierderea lor in tacere. Salvarea observatiilor ramane neimplementata: ar necesita schimbarea contractului server, interzisa in acest brief.

## Verificari executate

Node v24.20.0, Vite 5.4.21, Vitest 2.1.9. Dependentele initial lipseau.

Incercarea npm install --ignore-scripts --no-audit --no-fund a esuat:

```text
SystemError [ERR_SYSTEM_ERROR]: uv_os_homedir returned ENOMEM
```

Dupa corectarea locala a detectarii home pentru procesul de verificare:

```text
npm error code EACCES
npm error FetchError: request to https://registry.npmjs.org/yallist/-/yallist-3.1.1.tgz failed
```

S-au copiat dependente locale din worktree-ul 20261025-100010-d7e603-bmw-card in node_modules din acest worktree. package-lock.json are acelasi SHA256 in ambele: EDF3412EE5F422B787A0C3817840C5F237BC791ADD4192F5D83C5BD8A4991202. Lockfile-ul curent nu s-a schimbat; nu s-au adaugat librarii.

Verificarile au folosit PATH pentru Node, cache npm in .tmp/npm-cache si NODE_OPTIONS=--require=./.tmp/npm-worktree.cjs. Acest preload local suprascrie os.homedir pentru a evita eroarea Windows si foloseste .tmp/npm-home; nu modifica aplicatia sau configuratia utilizatorului. Toate scrierile au ramas in worktree.

Output final real pentru npx --no-install vite build (exit 0), log .tmp/eip-b2-build.log:

```text
dist/assets/index-DvM-I5n8.js  7,837.78 kB | gzip: 2,308.72 kB
(!) Some chunks are larger than 500 kB after minification.
built in 9.22s
```

Output final real pentru npx --no-install vitest run (exit 0), log .tmp/eip-b2-tests.log:

```text
src/eipIntrareLogica.test.js (24 tests) 10ms
Test Files  103 passed | 1 skipped (104)
Tests       2561 passed | 6 skipped (2567)
Duration    2.53s
```

Testele sarite sunt cele existente, nu sunt declarate trecute. Harness-ul de componenta simuleaza hook-urile React si RPC-ul; nu este test DOM/browser.

## Neverificat si riscuri

- Fara browser: aspectul, interactiunea reala, focusul si comportamentul pe mobil nu au fost verificate.
- Fara BD/API real: query-ul nou pe eip_articole, apelul RPC, idempotenta server si drepturile RLS/ACL nu au fost executate. Contractul a fost verificat static in migrarea B1; build-ul nu valideaza PostgREST.
- Marimile uzuale sunt o validare UI de format, nu un nomenclator oficial per articol; observatiile nu se pot salva prin contractul existent.
- Dupa inchidere/redeschidere sau refresh, receptia cu rezultat incert se reia cu aceeasi cheie si acelasi payload din localStorage, separat pe utilizator (eip_intrare_pending_v1:<user id>). RPC-ul nu porneste daca receptia nu a putut fi scrisa si recitita (fail-closed). Limita: stocarea e per browser; pe alt dispozitiv receptia nu se poate relua, de aceea Magazia verifica documentul existent inainte de o receptie noua.
- Build-ul avertizeaza asupra dimensiunii chunk-ului principal; nu s-a schimbat strategia de bundling.
- Fara Git, commit, push, secrete, acces BD, migrari sau deploy. Interdictia explicita de commit prevaleaza fata de cerinta contradictorie de livrare din brief.

## Dupa review Jakarinos r1 + r2 (chat, 25.10.2026)
- P1 (retry dupa refresh auth) remediat; r2: la eroare de citire a profilului butonul se ascunde (poateScrie=false), modalul ramane montat cat exista cheia.
- P3 (total exact) remediat.
- P2 (canonicalizare marime numerica): UI trimite o singura forma (42, 042 si 42.0 -> 42). Identitatea stocului din SQL (B1) NU normalizeaza marimea: alte cai de scriere (fn_eip_muta, citirea AI B4, predarea B3) trebuie sa foloseasca aceeasi regula. Verificat in BD 25.10: 6 intrari, 0 cu marime, 0 necanonice, deci nu exista rand istoric afectat. Remediere definitiva = normalizare in functiile SQL (migrare B1.1, cere da Razvan), de facut inainte de B3/B4.
- Copilot r1 (NO-GO, P1): cheia si payload-ul unei receptii cu rezultat incert traiau doar in memorie; la Inchide/refresh se genera alta cheie si receptia se putea dubla. Remediat: inainte de RPC, {cheie, cerere} se salveaza in localStorage (eip_intrare_pending_v1); butonul redeschide aceeasi receptie (Retrimite, aceeasi cheie); se sterge la succes sau respingere definitiva; 'Abandoneaza receptia' doar cu confirmare dupa verificare in Magazie. P2 Copilot (exceptie la citirea profilului) remediat: catch ascunde butonul.
- Copilot r2 (NO-GO): P1-1 persistenta era fail-open (setItem inghitit, RPC pornea oricum) -> acum RPC-ul porneste doar daca {cheie, cerere} a fost scrisa si recitita identic, altfel mesaj si nimic trimis. P1-2 pending-ul era global -> acum namespaced pe user id (eip_intrare_pending_v1:<uid>), nu se preia la schimbarea utilizatorului, modalul se inchide la schimbare de utilizator. P2 formularea veche din raport corectata.

