# Lumini sediu - Runda 5, 25.10.2026

Copiate intai toate cele 17 fisiere din lumini_base, la aceleasi cai.
Schimbari punctuale P2/P3; convergenta si ordinea OFF/ON raman din r4.
Cladire.jsx, lumini_logica.ts, index.ts si ROLLBACK sunt identice binar cu baza.
Fara Git, commit, push, credentiale, BD, deploy sau comenzi fizice.
Interdictia explicita fara commit prevaleaza asupra finalului brief-ului.

P2: tick-ul intoarce amanate cu dispozitiv_id, program_id si motiv
plafon_comun_2. Lista ultimului tick se persista in runtime.motor.amanate;
urmatorul tick o inlocuieste, inclusiv cu lista goala. Comenzile manuale
pastreaza lista ultimului tick. CladireLumini afiseaza "amanat: plafon comun"
langa lumina si programul afectat. ok:true descrie executia fara erori;
amanate arata explicit comenzile omise din cauza capacitatii.

Urma este notificare, cu titlu stabil per (program, lumina), prin iot_alerta
existent: deduplicare dupa tip/titlu timp de 12 ore, independent de citire.
Nu se adauga un jurnal de comanda pentru un ON care nu a fost trimis.
Eroarea RPC-ului de notificare este expusa in erori. Migrarea NEAPLICATA
20261113a permite cheia amanate in runtime; nu adauga tabele/coloane sau
modificari de drepturi. ROLLBACK continua sa refuze runtime operational.

P3 - dovezi adaugate:
- Doua lumini interior/mixt citite ON fara program + simulare aprobata +
  orar distinct: zero POST pentru orar, motiv in fiecare rezultat si o
  singura notificare pe trei tick-uri consecutive. Acelasi test pentru
  solar MIXT. Dupa eliberare, ON trece si mesajul dispare la noul tick.
- Handlerul index.ts real: token esuat, apoi succes in cererea urmatoare;
  exact o noua cerere de token si toate cele sase GET-uri de stare revin.
- Lista activa se schimba intre tick-uri, apoi se stabilizeaza. Cu buget
  de un POST pe tick si stari neconvergente, toate luminile ramase active
  primesc OFF in cel mult un ciclu complet de rotire.
- Plafon interior/mixt ocupat concomitent cu OFF si ON exterior:
  ambele comenzi trec, OFF primul.
- test-fixtures/lumini_setari.json este comun JS si harness-ului RPC SQL:
  ore/numere echivalente, date identice, gol/NULL in ambele directii,
  pauza + ora schimbate simultan si pauza + vacanta schimbate simultan.
  SQL verifica pastrarea EXACTA a programului/aprobarii sau invalidarea
  lor, plus valoarea pauzei salvate. Harness-ul primeste fixture-ul prin
  psql; verifica si persistarea amanate si deduplicarea notificarii.
  Fixture-ul iot_alerta reproduce fereastra reala de 12 ore; verificarea
  notifications ruleaza ca owner, fara GRANT suplimentar pentru service_role.

Comportament ales: cu simulare activa/aprobata, inclusiv un program SOLAR
pe lumina MIXT poate fi amanat de plafonul comun de doua lumini. Exteriorul
si OFF nu intra in acest plafon. Editarea programului sau schimbarea rolului
NU produc OFF: dezactiveaza programele afectate, scot luminile din acoperire
si cer reaprobare. O lumina ramasa aprinsa nu este stinsa automat prin editare.

Verificari executate:
- npx --no-install vite build: TRECUT; avertismente bundle/importuri existente.
- npx --no-install vitest run src: 93 fisiere trecute, 1 skipped;
  2329 teste trecute, 6 skipped.
- node --test scripts/test_lumini_node.mjs: 36/36 TRECUTE, Node 24.20.0.
- node --check pe index.ts, lumini_edge.ts, lumini_logica.ts: TRECUT.
- python -X utf8 scripts/livrare_validator.py pe migrare: OK,
  32 instructiuni de nivel superior.

Dependente existente copiate local din lumini-fix4, fara download sau
modificari package/lockfile. Prima lansare npx a esuat la os.homedir in
sandbox; executiile reusite folosesc preload-ul local
.tmp/lumini-homedir.cjs (fallback la cwd) si cache npm in .tmp/npm-cache.
Toate scrierile sunt in worktree; fara biblioteci noi.

NEEXECUTATE: harness SQL/Postgres (interdictia explicita de acces la BD),
Deno, PostgREST/API real, Tuya real si browser. Testele Node folosesc mock-uri
persistente, inclusiv notificari; validatorul lexical si testele JS nu
probeaza executia SQL, RLS sau comportamentul API in productie.

## Runda 6

Cele 18 fisiere din lumini_base au fost copiate la aceleasi cai in worktree.
Modificari punctuale fata de baza r5:
- ROLLBACK refuza configuratia diferita de seed: lat/lon/tz, pauza_ore=3,
  vacanta NULL, simulare_pana_la=23:30; cere exact cele sase roluri seed,
  toate active. Refuza si randuri lipsa/suplimentare. Mesajul este
  "Configuratie modificata dupa apply; export separat necesar".
- Migrarea NEAPLICATA: preflight pentru toate cele patru tabele si toate
  cele cinci nume de functii, inclusiv supraincarcari cu alta semnatura.
  Runtime refuza token NULL/gol/doar spatii inainte de lock sau scriere.
- CAS local in RPC-ul existent: versiune bigint initial 0, verificata sub
  lock si incrementata la fiecare salvare de setari. Versiunea lipsa/veche
  refuza salvarea cu "setarile au fost modificate de altcineva; reincarca".
  Runtime-ul nu incrementeaza versiunea configuratiei.
- CladireLumini citeste si transmite versiunea din initial/draft.
  Actualizeaza executa o singura incarcare. Draftul se goleste dupa succes,
  se pastreaza la refuz CAS; pentru o noua baza dupa conflict se reincarca
  pagina. URL-ul cron ramane identic; test Node regex exclude markdown.

Teste adaugate:
- Harness shell: coliziune pentru fiecare tabel/functie; rollback refuzat
  pentru pauza_ore, coordonate, vacanta, sfarsit simulare, rol, inactivare,
  lumina lipsa; rollback curat/seed ramane scenariul final de succes.
- Harness SQL: token invalid pe acquire/reserve/save/release fara schimbare
  runtime; doua snapshot-uri cu aceeasi versiune, prima salvare reusita,
  a doua refuzata cu mesaj exact si stare nemodificata; versiune lipsa.
  Testele existente citesc versiunea curenta pentru a testa in continuare
  validarea reala a campurilor, nu un refuz CAS incidental.
- Contract UI: executa handlerul run extras din componenta cu load/save
  simulate; verifica o incarcare la refresh/salvare si zero la refuz.

Verificari executate in r6:
- npx --no-install vite build: TRECUT; avertismente bundle/importuri existente.
- npx --no-install vitest run src: 93 fisiere trecute, 1 skipped;
  2330 teste trecute, 6 skipped.
- node --test scripts/test_lumini_node.mjs: 37/37 TRECUTE.
- node --check pe toate cele trei fisiere .ts din tuya: TRECUT.
- python -X utf8 scripts/livrare_validator.py pe migrare: OK, 32 instructiuni.
- bash -n scripts/test_iot_programe_lumini.sh: TRECUT (doar sintaxa).

Dependente existente copiate din lumini-fix5 in worktree. Fara librarii noi
sau schimbari package/lockfile. npx a esuat initial la uv_os_homedir;
reluarea a trecut cu preload local .tmp/lumini-homedir.cjs si cache npm local.
Comparatie binara cu baza: Cladire.jsx si index.ts/lumini_edge.ts/
lumini_logica.ts sunt identice. Motorul nu a fost schimbat.

NEEXECUTATE in r6: harness SQL/Postgres, concurenta pe sesiuni reale,
PostgREST/API, Deno, browser si Tuya real. Interdictia de acces la BD a fost
respectata; testele SQL sunt livrate, nu declarate trecute. CAS are test SQL
cu snapshot vechi, dar nu a fost validat aici pe server real.
Fara Git, commit, push, credentiale, BD sau deploy; numai scrieri in worktree.
Restrictia explicita "No Git commit" prevaleaza asupra finalului brief-ului.
