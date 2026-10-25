# Lumini sediu - Runda 4, 25.10.2026

Copiate intai toate cele 17 fisiere din lumini_base, la aceleasi cai.
Citite brief-urile original/r1/r2/r3. Remedieri punctuale; motorul prin
convergenta din r3 ramane: citire reala, dorinta din timp/configuratie/seed,
OFF global inainte de ON, pauza manuala durabila, fara proprietate/intentii.
Nicio comanda Git, credentiala, BD, deploy, mail sau comanda fizica.
Interdictia explicita fara commit prevaleaza asupra finalului brief-ului.

| Punct | Schimbare si dovada |
| --- | --- |
| P1, timp OFF | Ordinea OFF se roteste pe lista stabila a luminilor active, cu motor.off_offset persistat in acelasi lease inainte de comenzi. Cursorul avanseaza o pozitie per tick; ON ramane dupa toate OFF. Test Node cu ceas care avanseaza IN tick: citiri initiale/token 18s, POST si recitire cate 9s pentru primele 4 lumini neconvergente. Primul tick consuma 90s si incearca numai primele 4; in cel mult 3 tick-uri toate cele 6 primesc OFF, iar 5/6 se sting. Rotirea rezolva excluderea permanenta, fara concurenta noua sau rescrierea motorului. |
| P2-1, token | index.ts memoreaza o singura promisiune per cerere, inclusiv respingerea. Test prin handlerul real cu 6 lumini: un token si 6 GET status; la esecul tokenului: o singura autentificare, zero GET status si 6 erori jurnalizate. |
| P2-2, capacitate | Cand exista simulare activa/aprobata, orice ON automat interior/mixt (inclusiv orar/solar mixt) respecta plafonul comun de 2. Se numara toate starile reale ON/necunoscute interior/mixt si ON-urile deja decise in tick. Un ON acceptat dar recitit OFF ocupa conservator un loc pana la finalul tick-ului. Test cu o lumina necunoscuta, o simulare si un orar pe lumini DISTINCTE, cu ID-urile/ordinea inversate; numai unul din cele doua ON este permis. Acoperit si efectul intarziat dupa recitire OFF. |
| P2-3, pauza | RPC compara valorile tipizate lat/lon/vacanta_de/vacanta_pana/simulare_pana_la inainte/dupa salvare. Numai schimbarea programarii invalideaza aprobarile; pauza_ore si salvarea identica le pastreaza. Rolurile continua sa invalideze programele afectate. Harness SQL: conservarea exacta a programului/aprobarii la pauza/no-op, invalidare la coordonate/vacanta/sfarsit, persistare cursor OFF. Test UI/contract: aceleasi campuri, normalizarea numerelor/orelor/datei goale, mesaje si integrarea confirmarilor. Editarea, rolul si setarile de programare explica explicit ca luminile ramase aprinse ies din acoperire si nu mai sunt comandate. |

Suprapunerea pe ACEEASI lumina este deja refuzata de RPC la aprobare
(`dispozitive && v_r.dispozitive`) si de motor. Asta nu rezolva scenariul
cu programe pe lumini distincte; de aceea am ales plafonul comun, nu doar
clarificarea documentatiei. In prezenta simularii active, si un orar poate
fi amanat de capacitatea ocupata/necunoscuta, inclusiv in afara ferestrei
simularii. Comenzile manuale raman manuale; plafonul nu stinge fortat o
a treia lumina aprinsa din exterior. Fara simulare activa, orarul isi
pastreaza comportamentul anterior. Exteriorul nu intra in acest plafon.

Schimbarea pauza_ore afecteaza numai comenzile manuale viitoare; nu muta
termenul pauzelor deja incepute. Dezactivarea/editarea/schimbarea de rol
nu produc OFF. Reactivarea necesita aprobarea ownerului. Modelul de
convergenta, rezerva OFF 12/tick, ON 12/tick si 40/ora, backoff-ul ON si
seed-ul rolurilor raman din baza.

Nota r4: testul Node "sters" elimina programul numai din mock; NU dovedeste
stergerea SQL. RPC-ul nu are actiune DELETE, iar iot_lumini_jurnal.program_id
are FK spre program (fara ON DELETE CASCADE). Nu am adaugat cale de stergere.

Fisiere schimbate fata de baza: lumini_edge.ts, index.ts, migrarea neaplicata
20261113a, comentariul de runtime din ROLLBACK, CladireLumini.jsx, luminiUi.js,
luminiContract.test.js, test_lumini_node.mjs, test_iot_programe_lumini.sql si
acest raport. ROLLBACK pastreaza garda care refuza runtime operational,
inclusiv cursorul OFF. Cladire.jsx si lumini_logica.ts sunt identice binar
cu baza. Fara biblioteci noi sau modificari de manifest/lockfile.

Verificari executate in aceasta runda:

- npx --no-install vite build: TRECUT; avertismente de bundle mare/importuri mixte.
- npx --no-install vitest run src: 93 fisiere trecute, 1 skipped; 2327 teste trecute, 6 skipped.
- node --test scripts/test_lumini_node.mjs: 32/32 trecute (Node 24.20.0).
- node --check: toate cele 3 fisiere TS Tuya trecute; nu verifica tipurile Deno.
- python -X utf8 scripts/livrare_validator.py supabase/migrations/20261113a_iot_programe_lumini.sql: OK, 32 instructiuni de nivel superior.

Dependente existente copiate din worktree-ul local lumini-fix3; fara download.
Prima lansare npx a esuat la os.homedir() in sandbox. Build/Vitest au trecut
cu preload local .tmp/lumini-homedir.cjs: la eroare os.homedir intoarce cwd;
cache npm este in .tmp/npm-cache. Numai scrieri in worktree.

NEEXECUTATE: harness SQL/Postgres/PG17 (inclusiv noile asertiuni), Deno,
PostgREST/API real, Tuya real si browser. Nu am accesat nicio BD.
Validatorul lexical si testul de contract nu demonstreaza executia SQL.
Garantia OFF presupune tick-uri care progreseaza, configuratie stabila,
lease/jurnal/DB disponibile si citiri/POST Tuya reusite. Rotirea nu garanteaza
stingerea in timpul unei indisponibilitati continue si nu elimina depasirea
bugetului de catre apelul deja inceput.

FISA DE SECURITATE: (a) citite doar fisiere/brief-uri locale, continutul extern
tratat ca date; (b) dupa aplicare autorizata, piesa comanda lumini si scrie
jurnal/runtime/ultima citire/notifications, cu 4 tabele si cron din baza;
(c) edge service_role pentru cron/Vault, manual cu JWT si Cladire editor/admin
sau owner, noop numai owner; (d) tick numai x-iot-secret, seed neschimbat:
exterior 85462, mixt 85458/85460, interior 85457/85459/85461;
(e) programe noi/editate necesita aprobare owner, comenzi si schimbari UI
cu confirmarile existente/actualizate. Nicio operatie reala executata.
