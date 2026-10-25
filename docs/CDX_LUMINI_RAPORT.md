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

## Runda 7

Cele 18 fisiere din lumini_base au fost copiate intai in worktree.
Remedieri fata de baza r6:
- lumini_edge.ts: bugetul soft de 75s limiteaza numai ON. OFF are buget
  separat de 140s, sub limita minima Edge de 150s si lease-ul de 240s.
  Admiterea OFF se opreste la 120s, rezervand 20s pentru POST + recitire
  (doua timeout-uri Tuya de 10s). Bugetul este reverificat dupa reserve,
  jurnal si save, inainte de POST. OFF ruleaza in grupe de maximum trei,
  in acelasi lease; ON asteapta incheierea tuturor grupelor OFF.
- Rotirea OFF ramane. Amanarile temporale apar explicit in amanate_off,
  cu motiv plafon_dur_off, si in runtime.motor.amanate (cheie deja admisa
  de RPC). Jurnalul deduplica pe dispozitiv/program pe episodul de amanare;
  alerta foloseste deduplicarea existenta. Lista se goleste dupa convergenta.
- Plafonul comun 2 foloseste fereastra_activa intoarsa de evalueaza,
  calculata la acelasi moment pentru toate programele. Include ziua
  eligibila/vacanta/explicit si intervalul [apus, sfarsit), inclusiv pauzele
  dintre segmente. Configuratia aprobata, dar dormanta, nu activeaza plafonul.
- lumini_logica.ts: calcul solar lazy; orarul si urmatoarele sale ferestre
  functioneaza si cu coordonate invalide.

Dovezi noi in scripts/test_lumini_node.mjs si src/luminiLogica.test.js:
- Ceas virtual cu asteptari concurente: 12 OFF cu POST 8s + recitire 8s,
  dupa initializare DB 20s + GET initial 8s, termina in 92s; maximum trei
  operatii simultane dupa citirea initiala, toate sub acelasi lease.
  Exista POST OFF dupa 75s; ON din acelasi tick este refuzat.
- Initializare lenta: noua OFF trimise, trei amanate explicit, apoi toate
  cele trei trimise in tick-ul urmator; ambele tick-uri sub 140s simulate.
  Amanari repetate: jurnal/alerta deduplicate, rotire si reluare verificate.
- Intarzieri la reserve/jurnal/save: 76s nu suprima OFF, dar blocheaza ON;
  121s produce amanare OFF explicita, fara POST.
- Luni, sambata inainte de apus si exact la sfarsit: orarul porneste trei
  lumini. Sambata in fereastra: maximum doua, in ambele ordini ale programelor.
  Fereastra activa este verificata si in pauza simularii, vacanta si explicit.
- Coordonate invalide + orar valid: ON in Edge si urmatoarele ferestre corecte.

Verificari executate in r7:
- npx --no-install vite build: TRECUT; avertismente bundle/importuri existente.
- npx --no-install vitest run src: 93 fisiere trecute, 1 skipped;
  2332 teste trecute, 6 skipped.
- node --test scripts/test_lumini_node.mjs: 43/43 TRECUTE, Node 24.20.0.
- node --check pe toate cele trei fisiere .ts din tuya: TRECUT.
- python -X utf8 scripts/livrare_validator.py pe migrare: OK, 32 instructiuni.

Dependente existente copiate local din lumini-fix6; fara biblioteci noi sau
modificari package/lockfile. npx a esuat initial la uv_os_homedir; reluarea
a trecut cu preload local .tmp/lumini-homedir.cjs si cache npm in worktree.
Comparatie binara cu baza: numai cele doua fisiere motor, cele doua fisiere
de teste si acest raport difera. Cladire.jsx, UI, index.ts, migrarea si
rollback-ul sunt identice cu baza r6.

NEEXECUTATE in r7: SQL/Postgres, PostgREST/API real, Deno, browser, Tuya real
si executie pe gazda Edge. Ceasul simulat nu probeaza latentele DB sau limita
gazdei; rezerva de 20s acopera apelurile Tuya, nu blocheaza/abandoneaza un
apel DB deja in curs. Nu se declara validat un termen absolut pentru DB.
Fara Git, commit, push, credentiale, BD sau deploy; numai scrieri in worktree.
