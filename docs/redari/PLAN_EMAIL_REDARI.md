# Plan: e-mail Redări prin `redari@gazpet.ro` — r13 (04.11.2026)

Doar plan de design: fără cod de producție, fără scrieri în BD, fără secrete. Fiecare felie se livrează separat, cu porțile ei.
**r13** = punctele r6 rămase pentru citire (F1) și restul (Jak r6 P2-01..04, P3-01; Cop r6 P2-01..05, P3-01..02) integrate, plus R6-01..R6-03 ca decizii implicite (n)–(p). Modelul de lot / trimiterea (F2) are GO dublu din r12 / r12b. Tabelul de rezolvare pe toate rundele e la §9. Ce rămâne intenționat pentru implementare, cu criteriul de acceptanță, e la §8.

## Stare review (după r13)
- **Întrebări pentru Razvan — deblochează r15** (r14 a primit NO-GO fără P1 de la ambii; r15 nu începe până la răspuns):
  - **(Q1) Plafonul zilnic**: e acceptabil ca un mesaj autorizat seara să conteze pe **ziua autorizării** (regula simplă), în loc de fereastra de 60 s (`apel_valabil_pana`) din r14? Dacă da, fereastra de 60 s, `apel_expirat` și `fn_red_mail_apel_renunta` se scot, iar punctele Jak r14 P2-03 / P2-04 și Cop r14 P2-02 / P2-03 / P3-02 dispar sau se simplifică.
  - **(Q2) Tombstone-urile**: după golire devin practic permanente (un rând mic, fără conținut: căsuță, HMAC, versiune, date). E acceptabil GDPR? De întrebat și Juridicul (scop, temei, durată nedeterminată, cheile HMAC vechi care nu se pot retrage; Cop r14 P3-01).
  - **(Q3) Asocierea manuală a mesajelor `neprocesabil`**: e nevoie de ea în F1 sau se amână? Dacă se amână, `fn_red_mail_asociaza_neprocesabil` se scoate, iar Jak r14 P2-02 și Cop r14 P2-01 / P2-04 dispar.
  - Notă: r14 a introdus fereastra de 60 s, `apel_expirat`, `fn_red_mail_asociaza_neprocesabil` și `fn_red_mail_apel_renunta`; toate pot fi scoase dacă Q1 / Q3 = varianta simplă.
- **Puncte de review tratate în r6** (verdictul Jakarinos r5, fără niciun P1; Copilot r5 nu a fost rulat):
  - **Jak r5 P2-01** tombstone fără expirare calendaristică → §1.2, §1.8 (tabelul), §1.12, §8; mecanismul verificării: punct deschis mai jos;
  - **Jak r5 P2-02** limita exactă `internalDate ≥ data_start`, `data_start` fixat înaintea capturii `historyId` → §1.1 (modul test, prima activare, recuperarea), §3 F1 (teste);
  - **Jak r5 P2-03** căsuță de test separată în locul `redari+test@` → §1.1 (modul test), §2.2, §4, §3 F1, §7.1 — *implicit (l)*, nou;
  - **Jak r5 P2-04** `red_raspunsuri.data` = `primit_la`, pus de RPC → §1.10, §3 F1 (teste);
  - **Jak r5 P2-05** poarta GDPR pentru domeniul (k) → §2.7 (punctul 6), §1.8 (alerta de 60 de zile), §8; mesajul automat de răspuns: punct deschis mai jos;
  - **Jak r5 P2-06** inventarul unic → §1.12 „Schema F1” (nou), §1.1, §3 F1 (migrarea + postcondițiile);
  - **Jak r5 P3-01** grația = durata maximă a worker-ului + 10 min → §1.8, §8;
  - **Jak r5 P3-02** fișa a–e pentru `fn_red_raspuns_public` extins + `trimis_la` în fișa citirii → §2.4.
- **R6-01..R6-03** (deschise în r6) — **tratate în r13** ca decizii implicite, cu varianta cea mai conservatoare, de confirmat de Razvan înainte de F1: **R6-01** → *implicit (n)* (dovada absenței prin două scanări complete + HMAC, prima absență păstrată, §1.2); **R6-02** → *implicit (o)* (fără mesaj automat de răspuns, informarea doar pe convocator / formular / pagini, §2.7); **R6-03** → *implicit (p)* (data manuală introdusă de om, obligatorie, ≤ azi, cu motiv, §1.10).
- **Verdictul r6** (`2c43b354`): **Jakarinos NO-GO, fără P1; Copilot r6 nerulat.** Punctele de mai jos sunt **tratate în r13**:
  - **Jak r6 P2-01 — contractul OAuth nu acoperă căsuța de test** [**tratat în r13**: §2.3 maparea unică, §1.12, §3 F1] (§1.12 / §2.3 / §4): `citire_test` și `REDARI_GMAIL_TEST_REFRESH_TOKEN` există, dar §2.3 permite doar `citire` / `trimitere`, două nume în Vault și identitatea `redari@`. *Remediere propusă*: o mapare unică `scop → client → căsuță așteptată → secret Vault → flux afectat`, folosită la start, callback, refresh și revocare; fișa a–e actualizată; teste cu identitățile test / producție inversate.
  - **Jak r6 P2-02 — reluarea unei activări întrerupte e nedefinită** [**tratat în r13**: §1.1 prima activare, §1.12] (§1.1 / §1.12): worker-ul moare după `data_start`, înainte de `C_start` și `recuperare`; o nouă activare poate rescrie `data_start` și pierde mesaje. *Remediere propusă*: `data_start` fixat o singură dată și păstrat la reluare; checkpoint-ul și intrarea în recuperare scrise atomic, sub CAS; teste cu întrerupere după fiecare pas și lease expirat.
  - **Jak r6 P2-03 — inventarul §1.12 încă lasă alegeri implementatorului** [**tratat în r13**: §1.12 literalele evenimentelor, `respins_la`; §1.10 tranzițiile pe ambele coloane] (§1.12 / §1.8 / §1.10): `red_mail_evenimente.tip` are categorii, nu literale; momentul respingerii unei adrese propuse nu e definit; `ignorat` „din `neprocesabil`” amestecă `stare` cu `stare_ingestie`. *Remediere propusă*: literalele exacte, data respingerii definită, tranzițiile scrise ca predicate pe ambele coloane.
  - **Jak r6 P2-04 — izolarea între căsuțe nu ajunge la căile Storage** [**tratat în r13**: §1.2 HMAC peste `(casuta, gmail_id)` + `mail/<casuta_cod>/`] (§1.1 / §1.2 / §1.12): același `gmail_id` în două căsuțe dă aceeași cale (HMAC doar pe id, `cale` unică global). *Remediere propusă*: căsuța în namespace-ul Storage sau HMAC peste `(casuta, gmail_id)`; test cu același id în test / producție, inclusiv golire independentă.
  - **Jak r6 P3-01 — `internalDate` descris prea puternic** [**tratat în r13**: §1.10] (§1.10): nu e „momentul în care proprietarul a răspuns”. *Remediere propusă*: regula `data = primit_la` rămâne, formulată „momentul primirii la Google”.
  - Notă Jak la R6-01 [**tratată în r13**, *implicit (n)*]: varianta (A) trebuie să definească dovada absenței dintr-o scanare completă și păstrarea primului rezultat (nu e direct `messages.get → 404`).
- **Verdictul Copilot r6** (`ac32df69`): **NO-GO**. Confirmă cele 5 puncte Jakarinos r6 de mai sus (nu se dublează) și adaugă 1 P1, 5 P2, 2 P3. **P1-01 e tratat în r7, iar în r9 modelul e simplificat** (§1.3, §1.8, §2.4 fișa trimiterii, §3 F2, §8, *implicit (m)*); restul **de rezolvat în r7, după deciziile lui Razvan (a)–(l)**:
  - **Cop r6 P1-01 — aprobarea owner-ului nu e legată de componența imuabilă a lotului** (§1.3, §3 F2): se blochează doar câmpurile snapshot, nu INSERT / DELETE / mutarea unui mesaj între loturi după aprobare. *Remediere propusă*: în BD, după aprobare, orice INSERT, DELETE sau schimbare de `lot_id` refuzată; `lot_sha256` recalculat și verificat sub lock la rezervare; orice schimbare de componență anulează aprobarea; test concurent (admin adaugă / mută un mesaj imediat după aprobare → refuz, niciun apel Gmail). **Tratat în r7** (§1.3 „Componența lotului e imuabilă după aprobare”, §2.4, §3 F2, §8).
  - **Cop r6 P2-01 — activarea căsuței de test nu e izolată de producție** [**tratat în r13**: §1.1 două comutatoare, `red_mail_flux.activ`, §1.12] (§1.1, §1.12 `red_mail_setari`, §3 F1): un singur `citire_activa` pentru ambele căsuțe. *Remediere propusă*: activare per căsuță / flux, `redari@` oprită implicit independent de test, verificată de worker înainte de refresh / `history.list` / `messages.get`; test: test activ + producție oprită → zero apeluri Gmail spre căsuța reală, inclusiv după restart și la cron.
  - **Cop r6 P2-02 — mesajele de test pot ajunge în datele juridice** [**tratat în r13**: §1.10, §1.11, `CHECK` în §1.12] (§1.1, §1.10, §1.11): RPC-urile de înregistrare și de confirmare a adreselor nu verifică `test = false`. *Remediere propusă*: în BD, sursa trebuie să fie din căsuța de producție (`test = false`), sau modul test izolat în alt proiect de date; test cu promovarea unui mesaj de test spre un deținător real, inclusiv prin apel direct la RPC.
  - **Cop r6 P2-03 — plafoanele pot fi depășite la schimbarea zilei / lunii** [**tratat în r13**: §1.9 recalcularea la `apel_incepe`] (§1.9, §1.3): contabilizarea pe `rezervat_la`, dar apelul poate pleca a doua zi. *Remediere propusă*: la `apel_incepe`, sub lock-ul cotelor, fereastra recalculată și capacitatea rezervată pe ziua / luna apelului (fără loc → rămâne în coadă); test cu rezervare înainte de miezul nopții și apel după, inclusiv la schimbarea lunii.
  - **Cop r6 P2-04 — „răspuns vechi înregistrat târziu” depinde de ordonarea consumatorilor** [**tratat în r13**: §1.10 ordinea canonică `data`, apoi `id`] (§0.3, §1.10): dacă un consumator alege ultimul răspuns după `seq` / `created_at`, `data = primit_la` nu ajunge. *Remediere propusă*: ordinea canonică a răspunsurilor (`data` + departajare deterministă), verificată în JS, SQL și export (modificate în F1 dacă e nevoie); test cu răspunsul vechi inserat ultimul.
  - **Cop r6 P2-05 — `conflict_obiect` fără tranziție terminală** [**tratat în r13**: §1.2 `fn_red_mail_ingestie_conflict`] (§1.2, §1.12, §3 F1): finalizarea acceptă doar `stocat` / `respins_*`, deci mesajul rămâne `in_curs` și blochează cursorul. *Remediere propusă*: RPC atomic `in_curs → neprocesabil` pentru `conflict_obiect`, cu soarta obiectului conflictual precizată; test: următorul mesaj din istoric se procesează fără blocajul de 24 h.
  - **Cop r6 P3-01 — `cerere_sha256` nu acoperă toate argumentele** [**tratat în r13**: §1.10] (§1.10): lipsesc `nota` și `confirma_mai_vechi`. *Remediere propusă*: toate argumentele cu efect sau audit în forma canonică (nota normalizată, confirmarea); test: același `operatie_id`, notă diferită → `conflict_operatie`.
  - **Cop r6 P3-02 — semnăturile RPC fără `operatie_id`** [**tratat în r13**: §1.10, §1.11, §1.12] (§1.10): textul spune că ambele RPC-uri îl primesc, dar semnăturile scrise nu-l au. *Remediere propusă*: semnăturile complete în §1.10 și în inventarul F1 (§1.12), cu `operatie_id` și regula hash-ului; la varianta manuală se închide și R6-03.
- **Review r7** (`524df711`) și **Review r7b** (`6f48dad8`): Jakarinos GO cu observații, Copilot NO-GO, fără P1 (Jak r7 P2-01..02, Cop r7 P2-01..02 / P3-01; Jak r7b P2-01..02, Cop r7b P2-01..03 / P3-01). Tratate în r7b și r8, apoi **înlocuite în r9** de modelul simplificat al lotului (*implicit (m)*, §1.3): ordinea globală a lock-urilor, componența doar pe `ciorna`, amprenta scrisă o dată și cele trei hash-uri rămân; mecanismele de recuperare din r7b–r8 sunt scoase.
- **Review r8** (`5717964c`): **Jakarinos NO-GO, Copilot NO-GO, fără P1**, pe cazuri create de stările noi din r8. Toate **tratate în r9 prin simplificare** (*implicit (m)*, §1.3: lot aprobat înghețat, corectura = lot nou, `blocat_integritate` terminal, listă literală de stări, fail-closed):
  - **Jak r8 P2-01** / **Cop r8 P2-02** un lot „arhivat” ocolea condiția „lot închis” și permitea ștergerea unui `necunoscut` → predicat unic conjunctiv: doar `incheiat` **și** niciun `in_apel` / `necunoscut` **și** termen trecut **și** „da”; test (11);
  - **Jak r8 P2-02** / **Cop r8 P2-01** rezervări expirate rămase fără destinație → încheierea trece atomic `in_coada` și `rezervat` (inclusiv expirate) în `anulat` și eliberează plafonul; fără copiere de mesaje; test (8), §1.9;
  - **Jak r8 P2-03** inventarul fișierelor înaintea golirii → `red_mail_fisiere_inventar` scris la încheiere, golirea refuzată fără el, ștergerea finală reluabilă pe inventar, fișierele partajate păstrate; test (11), §1.8.
- **Review r9** (`259d70c6`): **Jakarinos NO-GO, Copilot NO-GO, fără P1**. Toate **tratate în r10**:
  - **Jak r9 P2-01** golirea înaintea terminării reconcilierii → §1.3 („Golirea conținutului”, `fn_red_mail_lot_goleste`, verificat sub lock), §1.8; test (11);
  - **Jak r9 P2-02** / **Cop r9 P2-03** inventarul fără dovadă de completitudine → §1.3 (antetul `red_mail_fisiere_inventar_antet`: `inventar_complet_la`, `nr_fisiere`, `inventar_sha256`; 0 fișiere = antet complet cu 0; imuabil); test (11);
  - **Cop r9 P2-02** eșecul OAuth după încheiere readucea mesajul în coadă → §1.3 („Fără revenire în coadă”), tabelul rezultatelor (§1.3); test (8);
  - **Jak r9 P3-01** / **Cop r9 P2-01** testul „niciun apel după încheiere” → reformulat „niciun apel nou început după încheiere; apelurile deja `in_apel` își termină tranziția”; teste (8)–(9).
- **Review r10** (`21e8cae0`): **Jakarinos NO-GO, Copilot NO-GO, fără P1**, pe trei greșeli introduse de r10. Toate **tratate în r11**:
  - **Jak r10 P2-01** / **Cop r10 P2-01** succesul unui apel după încheiere nu mai avea tranziție → §1.3 („Fără revenire în coadă”: permise `trimis` / `esuat_sigur` / `necunoscut`, interzise doar spre `in_coada` / `rezervat`), tabelul rezultatelor; teste (8), (10);
  - **Jak r10 P2-02** / **Cop r10 P2-02** reverificarea depindea de snapshoturi deja golite → §1.3: `inventar_sha256` din rândurile inventarului, snapshoturile verificate o singură dată la încheiere, golirea și ștergerea compară antet ↔ rânduri; test (11);
  - **Cop r10 P2-03** măturarea rezervărilor expirate pe lot blocat → `rezervat → anulat` (plafon eliberat), permis de trigger; tabelul rezultatelor; test (10).
- **Review r11** (`82a381c9`): **Jakarinos GO cu observații, Copilot NO-GO** (fără P1). Ambele **tratate în r12**:
  - **Cop r11 P2-01** verificarea inventarului la încheiere era unilaterală → §1.3: verificare în ambele sensuri, fără rânduri în plus / duplicate (`UNIQUE (lot_id, mesaj_id, cale)`), `nr_fisiere` = numărul rândurilor, abatere → încheiere refuzată; test (11);
  - **Jak r11 P3-01** formularea ambiguă a testului (10) → „nicio rezervare nouă / niciun `apel_incepe` nou reușit”, „singura acțiune care schimbă starea lotului e încheierea de owner”, operațiile permise pe mesaje enumerate explicit.
- **Review r12** (`9073aac6`): Jakarinos GO, Copilot GO cu observații (P3-01 tratat în r12b: atributele comparate în inventar — `lot_id`, `mesaj_id`, `cale`, `sha256` fișier, `marime` — §1.3, test (11)) — modelul de lot / trimiterea (F2) are GO dublu; rămân deschise punctele r6 pentru citire (F1), după deciziile lui Razvan (a)–(m).
- **Review r13** (`9945abc4`): **Jakarinos NO-GO, Copilot NO-GO, fără P1**. Toate **tratate în r14**:
  - **Jak r13 P2-01** / **Cop r13 P2-02** confirmarea adresei fără contract complet → §1.11 (semnătură, precondiții după lock, efecte, idempotență pe `confirmare_operatie_id` + `confirmare_cerere_sha256`, erori), §1.12; teste;
  - **Jak r13 P2-02** / **Cop r13 P2-05** paginarea completă nu dovedea absența → §1.2, *implicit (n)*: scanări stabile (`historyId` înainte = după), publicare atomică, plus `messages.get` → `404` pe id-ul candidat; altfel tombstone-ul rămâne (fail-closed);
  - **Jak r13 P2-03** / **Cop r13 P3-02** proiectul GCP al clientului de test, „doi clienți” → §2.3 (trei clienți, proiect GCP propriu fiecăruia în mapare, efectul pe scop), §4;
  - **Jak r13 P2-04** data manuală nedefinită → §1.10, §1.12, *implicit (p)*: `data_raspuns date` (dată civilă București), conversia la 00:00 București, ≤ azi la București, coloanele în sursă;
  - **Jak r13 P3-01** departajarea prin `id` schimba comportamentul → §1.10: regula existentă din `stare.js` (`data`, `seq`, `created_at`, poziție), neschimbată, plus preflight pe egalități;
  - **Cop r13 P2-01** `neprocesabil` nu mai putea fi asociat → §1.10 (`fn_red_mail_asociaza_neprocesabil`, owner / admin, cu notă), §1.8;
  - **Cop r13 P2-03** `test` putea fi `NULL` → §1.12 `NOT NULL`, condiția pozitivă `casuta = 'redari@gazpet.ro' AND test IS FALSE` în RPC-uri;
  - **Cop r13 P2-04** plafonul între `apel_incepe` și `send` → §1.9: locul definitiv la `apel_incepe`, `apel_valabil_pana` legat de aceeași zi (≤ 60 s), timeout la refresh, `apel_expirat` → reverificare; tabelul rezultatelor;
  - **Cop r13 P3-01** `are_legatura_juridica` nedefinit → §1.12: funcție SQL literală, fail-closed.
- **Review r14 — oprit pentru decizii** (`7389db3e`): **Jakarinos NO-GO, Copilot NO-GO, fără P1**. Puncte **nerezolvate**, în așteptarea Q1–Q3:
  - **Jak r14 P2-01** — §1.11: ordinea verificărilor contrazice idempotența confirmării (o reluare după commit poate primi `stare_invalida` / `contact_schimbat` / `versiune_veche`); ordinea cerută: autorizare → lock → verificarea operației / hash-ului și întoarcerea rezultatului existent → abia apoi precondițiile unei operații noi.
  - **Jak r14 P2-02** / **Cop r14 P2-04** — `fn_red_mail_asociaza_neprocesabil` fără idempotență completă (cheie unică, hash peste `primit_id`, `detinator_id`, `nota_verificare`, rezultatul reluării, `a_fost_asociat = true`); depinde de Q3.
  - **Jak r14 P2-03** / **Cop r14 P2-03** — `apel_expirat` / `fn_red_mail_apel_renunta` trebuie permise doar înainte de începerea `send`; după, rezultatul rămâne `trimis` / `necunoscut`, fără revenire în coadă; depinde de Q1.
  - **Jak r14 P2-04** — garanția plafonului presupune ceasuri sincronizate între edge și BD (abatere maximă, marjă, oprire la abatere necunoscută); depinde de Q1.
  - **Jak r14 P3-01** — `CHECK`-ul sursei manuale: ambele câmpuri nenule pentru `manual_verificat`, ambele NULL pentru celelalte tipuri.
  - **Cop r14 P2-01** — răspunsul unui mesaj `neprocesabil` asociat manual pierde legătura cu `primit_id` (proveniență și deduplicare mai slabe); depinde de Q3.
  - **Cop r14 P2-02** — §1.9 încă spune că ziua vine din `rezervat_la` și contabilizarea se face la rezervare, contrar r14; depinde de Q1.
  - **Cop r14 P2-05** — departajarea prin „poziția în listă” din `stare.js` nu e reproductibilă în SQL; e nevoie de un ultim criteriu determinist, cu preflight pe egalitatea cheii complete.
  - **Cop r14 P3-01** — tombstone-uri practic permanente: de consemnat în (f), în informare și la poarta Juridic; depinde de Q2.
  - **Cop r14 P3-02** — testele pentru expirare (înainte de `send`, cu `send` început, concurența cu încheierea, lease pierdut, eliberarea cotei) lipsesc din §3 F2 și §8; depinde de Q1.
- **De discutat cu Razvan dimineață** (nu sunt defecte, ci confirmări fără de care felia dependentă nu începe):
  1. deciziile implicite **(a)–(p)** din §7.1, mai ales: **(i)** „ignorat” doar pentru netriate, de owner / admin; **(j)** convocarea pe e-mail nu intră în `red_convocari` și nu schimbă starea juridică a parcelei; **(k)** se captează toată corespondența primită după activare, nu doar ce stă în INBOX; **(l)**, nouă în r6: căsuță de test separată (de ex. `redari-test@`, client OAuth de test, regulă Workspace care respinge expeditorii externi) în locul `redari+test@`; **(m)**, nouă în r9: lotul aprobat e înghețat, corectura = lot nou, `blocat_integritate` terminal; **(n)–(p)**, noi în r13 (din R6-01..R6-03): dovada absenței tombstone-ului prin două scanări complete, fără mesaj automat de răspuns, data manuală introdusă de om (≤ azi, cu motiv);
  2. formularea „o singură ședință” din decizia 2A, înlocuită de (g) cu două ședințe;
  3. probele din §8 (fixture-uri Gmail reale, validarea Juridic a domeniului (k) și a metadatelor de audit, durata backup-urilor, durata maximă a worker-ului Supabase).

**Deciziile lui Razvan (03.11.2026)**
- Căsuța `redari@gazpet.ro` există (Google Workspace). Autorizarea Gmail API o facem împreună (formularea inițială „într-o singură ședință” e înlocuită de *implicit (g)*: două ședințe, câte una pe felie, §7.1).
- **Trimitere** ERP → proprietari: **fără niciun automatism**. Fluxul: lot → aprobare → trimitere, ca la SMS. Mailurile către instituții rămân în 📨 Corespondență (`red_corespondenta`), cu „da” pe fiecare rând.
- **Primire**: răspunsurile intră în ERP, se asociază proprietarului sau parcelei și se centralizează pe „📥 Mesaje Redări” (nou → asociat → rezolvat), plus istoricul pe fișa proprietarului.
- Conținutul primit e **extern** (CLAUDE.md pct. 7 și 10). ERP-ul nu face nicio acțiune automată pe baza lui. AI-ul poate doar sugera, iar omul confirmă.
- **Toate variantele A de la §7 sunt acceptate** (decizii închise).

**Decizii implicite — de confirmat de Razvan** (marcate „*implicit (x)*” în text). Lista completă, cu felia **înaintea căreia** trebuie confirmată și locul pentru data confirmării, e în tabelul de la §7. Comportamentul care depinde de o decizie neconfirmată nu se implementează (Jak r3 P3-02):
- **(a)** adresele din formularul public / din `From` rămân „propuse” până le confirmă un om (§1.11) — înainte de F1;
- **(b)** prima activare citește doar de atunci înainte; importul istoric doar la cerere (§1.1) — înainte de F1;
- **(c)** viewer-ul nu vede conținut de mail; excepția explicită: în `red_raspunsuri` vede canalul `email`, opțiunea, data și referința fixă (§2.1) — înainte de F1;
- **(d)** răspunsul din mail intră în Registru doar verificat, fără text copiat, și apoi nu se mai modifică prin API (§1.10) — înainte de F1;
- **(e)** **nu se golește automat niciun mesaj netriat / neasociat**: alertă la 60 de zile și rămâne; golirea la 90 de zile doar pentru `ignorat` (marcat de un om, cu motiv); corespondența asociată urmează `text_gdpr`, fără golire automată (§1.8) — înainte de F1;
- **(f)** termenele pentru adresele propuse și pentru metadatele de audit (§1.8) — înainte de F1;
- **(g)** cei doi clienți OAuth de producție (plus clientul de test, *(l)*) în **proiecte GCP separate**, câte unul pe client (revocare independentă) și **două ședințe** de consimțământ, câte una pe felie (§2.3) — înainte de F1 (citire) / F2 (trimitere);
- **(h)** aprobarea unui lot expiră după 7 zile, doar pentru mesajele `in_coada` (§1.3) — înainte de F2;
- **(i)** un mesaj care a fost **vreodată** asociat unui proprietar nu poate fi marcat `ignorat`; doar netriatele / neasociatele pot, cu motiv, de owner sau admin (§1.8, §1.10) — înainte de F1;
- **(j)** convocarea pe e-mail **nu se înregistrează în `red_convocari`** și nu schimbă niciodată starea juridică a parcelei (convocat / expediat AR); are stare proprie în `red_mail_mesaje` (§1.5) — înainte de F2;
- **(k)** domeniul captat = **toată corespondența primită în `redari@` după activare**, oriunde ar fi mutată (arhivată, etichetată, coș), mai puțin spamul, care doar se numără (§1.1) — înainte de F1;
- **(l)** modul test folosește o **căsuță de test separată** (de ex. `redari-test@gazpet.ro`), cu client OAuth de test și o regulă Workspace care respinge expeditorii externi, în locul `redari+test@` (§1.1) — înainte de F1;
- **(m)** **un lot aprobat e înghețat**: nu se editează, nu se deblochează, nu se reaprobă; owner-ul poate doar să-l încheie (tot ce n-a intrat în apel devine `anulat`); corectura = lot nou; `blocat_integritate` e terminal pentru trimitere (§1.3) — înainte de F2;
- **(n)** un tombstone din `red_mail_dedup` se șterge **doar** cu dovada completă a absenței: **două scanări complete și stabile** ale căsuței (`messages.list` cu `includeSpamTrash`, toate paginile, fără eroare, `historyId` identic înainte și după scanare), la ≥ 30 de zile distanță, în care HMAC-ul nu apare, **și** `messages.get` → `404` pe id-ul candidat. Fără id candidat sau cu orice pas nedovedit, tombstone-ul **rămâne** (fail-closed); prima absență se păstrează în `absent_prima_la` (§1.2) — înainte de F1;
- **(o)** expeditorii se informează **doar** pe convocator, în formularul public și pe paginile unde apare `redari@`; **fără mesaj automat de răspuns** (§2.7 punctul 6) — înainte de F1;
- **(p)** la înregistrarea manuală a unui răspuns venit pe alt circuit, `data_raspuns` (`date`, dată civilă `Europe/Bucharest`) e introdusă de om, **obligatorie, ≤ azi** (azi = data curentă la București), cu motiv obligatoriu; `red_raspunsuri.data` = acea zi la 00:00 ora București (§1.10) — înainte de F1.

**Surse citite**: `CLAUDE.md`, `docs/paw/LECTII_REVIEW.md` (L01–L25), `docs/sms/RAPORT_SMS_2026-11-03.md`, migrările `20261130a_sms_mvp.sql` / `20261130b_sms_acces_modul.sql`, `20261126a_redari_teren.sql` (politicile `red_raspunsuri_*`, `red_jurnal_sel`, `red_storage_*`, `fn_red_jurnal`), `20261129e`, `20261129h_redari_corespondenta.sql`, consumatorii `red_raspunsuri` din `src/redari/` și `src/Redari.jsx`, `docs/redari/README.md`, `SABLOANE.md`, `CONTRACT_SCHEMA.md`, edge-urile `redirect-mai-gov`, `noutati-mail`, `ofertare-rfq-inbox`, `ingest-document`, `vicare`, `olx-api`, plus `claude_docs.registru_automatizari` (doar SELECT pe rândurile despre mail/Gmail), DNS-ul public al `gazpet.ro` (03.11) și verdictele r1/r2 Jakarinos + Copilot (citite ca date).

---

## 0. Ce există și ce se refolosește

### 0.1 Gmail API în platformă azi
| Ce | Cum funcționează | Se refolosește? |
|---|---|---|
| `redirect-mai-gov` (repo, v9) | OAuth2 cu refresh token pe o singură căsuță (`razvan.trusu@`), `messages.list` / `get`, idempotență `UNIQUE gmail_msg_id` scrisă ÎNAINTE de acțiune, poarta `esteApelIntern` sau owner, răspuns HTTP doar cu stări fixe. | **Tiparul** da, **secretele** nu. |
| `productie-mail-facturi`, `import-evogps-gmail` | `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` pe căsuța lui Razvan / `automatizari@`. | Nu. |
| `ofertare-rfq-inbox`, `ingest-document` | Apps Script de pe căsuță → edge, cu secret în antet. | Nu (decizia 1A). |
| `noutati-mail`, `send-factura-email` | Resend, claim atomic înainte de trimitere. | Tiparul de claim. |
| `vicare`, `olx-api` | Callback OAuth doar owner, `state` consumat atomic, refresh token în Vault prin RPC. | Da, pentru §2.3. |

### 0.2 Delegare pe domeniu vs. refresh token pe căsuță
- **Delegarea pe domeniu** (service account): un secret pentru orice căsuță `@gazpet.ro`. **Exclusă.**
- **Refresh token pe căsuță**: doar `redari@`, doar scope-urile acordate, secrete proprii (L10).
- Consimțământul îl dă Razvan, logat ca `redari@`. Ecran de consimțământ **Internal**.

### 0.3 Redări azi (ce atinge planul)
- `red_detinatori_contact.email`: 0 adrese din 2.548. Convocatorul tipărit are deja `redari@gazpet.ro`.
- `red_convocari.canal` și `red_raspunsuri.canal` acceptă `email`. `nr_document` = `C-nnnn`.
- **Ce poate citi viewer-ul azi** (contează pentru decizia (c)):
  - `red_raspunsuri_sel`: orice nivel Redări, deci și viewer, inclusiv `obiectii_text`;
  - `red_jurnal_sel`: orice nivel, mai puțin rândurile `red_detinatori_contact` / `red_raspunsuri_meta`. `fn_red_jurnal` copiază valorile pe `red_raspunsuri`;
  - `FisaParcela.jsx` afișează `obiectii_text` în istoric.
- **Consumatorii `red_raspunsuri`**: `stare.js` (`ultimulRaspuns`, starea), `pv.js` (PV A/B), `exportXlsx.js` + `ExportEcran.jsx` (Model_6), `ModalPv.jsx`, `FisaParcela.jsx`, `SesiuneEcran.jsx`, `Redari.jsx`, SQL: `red_v_stare_parcela` (și ce depinde de ea), `fn_red_formular_public` / `fn_red_raspuns_public` (`deja_raspuns`), indexul de prezență `20261129e`, triggerul `fn_red_raspunsuri_valideaza`.
- **Bucketul `redari`**: `red_storage_sel` / `_ins` = SELECT/INSERT pe tot bucketul pentru admin/editor, fără UPDATE/DELETE.
- Decizia 6 (01.11): răspunsul public nu trimite nimic. Planul nu o schimbă.

### 0.4 SPF / DKIM / DMARC `gazpet.ro` (DNS public, 03.11.2026)
- MX = Google. SPF `v=spf1 a mx ip4:<IP firmă> include:_spf.google.com ~all`.
- **DKIM Google lipsește** (`google._domainkey` inexistent). **DMARC `p=none`, fără `rua`**.
- Precondiție F2 (decizia 11A): DKIM pornit, DMARC cu `rua`, `p=none` 2 săptămâni, apoi `p=quarantine`.

---

## 1. Arhitectura

```
                    ┌──────────── redari@gazpet.ro (Gmail) ────────────────┐
  token CITIRE      │ history.list INBOX + SENT / messages.get / attachments │  token TRIMITERE
  (gmail.readonly)  │ messages.list (recuperare, reconciliere)               │  (gmail.send + openid email)
                    └────────────────────────────────────────────────────────┘
        ▲ redari-mail-citeste (cron 5 min, lease)              ▲ redari-mail-trimite (doar UI, lot aprobat)
        │ ingestie: rând + manifest → obiecte → finalizare      │
  red_mail_primite / _obiecte / _evenimente             red_mail_loturi → red_mail_mesaje (snapshot imuabil)
  mail/carantina/ (.eml) · mail/atasamente/ (lista albă)            ▲ aprobare owner pe lot_sha256
        │ indicii (fir / cod / expeditor) + conflicte                │
        ▼                                                             │
  📥 Mesaje Redări: nou → asociat → rezolvat · verificare     (F3) răspuns pe fir = lot de 1 ─┘
        │ doar după verificare: RPC atomic → red_raspunsuri (fără text din mail)
        ├─► fișa proprietarului: istoric (admin/editor)        redari-mail-fisier: proxy de descărcare
        └─► red_mail_adrese_propuse (F1b) → confirmare om → contact
                                               redari-mail-retentie (cron zilnic): golire + orfane
```

- **Cod și identitate separate**: `_shared/gmailCitire.ts` (doar secretele de citire) și `_shared/gmailTrimitere.ts` (doar secretele de trimitere). Un test static verifică faptul că niciunul nu importă celălalt modul și nu numește secretele celuilalt.
- **Identificatorii Gmail** (`id`, `threadId`, `historyId`) rămân **șiruri exacte** în TypeScript (fără `Number`). În PostgreSQL, `historyId` e `numeric(20,0)` și se compară numeric.
- **Timpul de încredere** = `internalDate` (Gmail). Antetul `Date` e scris de expeditor: se păstrează ca `data_declarata`, doar informativ, și nu se folosește la ordonare, retenție sau termene (Cop P3-01).

### 1.1 Citirea: `redari-mail-citeste` (F1)
**Pornire și lease**
- `pg_cron` la 5 minute (decizia 12A) → `pg_net` cu `x-intern-secret` (`poartaCron.ts`), sau owner-ul logat (`?dry=1`, contractul mai jos).
- **Două comutatoare, ambele necesare** (Cop r6 P2-01): `red_mail_setari.citire_activa` (kill-switch global, implicit `false`) **și** `red_mail_flux.activ` pe rândul fiecărei căsuțe / flux (implicit `false`). Căsuța de test și `redari@` se pornesc **separat**, doar de owner: rândul `redari@` rămâne `activ = false` cât timp se testează. Worker-ul verifică `citire_activa AND activ` pentru rândul respectiv **înainte** de refresh-ul de token, `history.list` sau `messages.get`; un rând inactiv nu produce niciun apel Gmail (nici la cron, nici după restart).
- **Starea pe flux** (Jak r3 P2-06): tabelul `red_mail_flux`, cheie `(casuta, flux)`, `flux` ∈ {`inbox`, `sent`, `import`} (enumul complet și coloanele la §1.12). Fiecare rând are **propriile** `history_id` (`numeric(20,0)`), `mod_cursor` (`neinitializat` / `normal` / `recuperare`), `data_start`, `recuperare_tip`, `recuperare_history_id`, `recuperare_page_token`, `mod_test`, `activ`, `data_import_de_la` (doar la `import`), lease (`lease_token`, `lease_pana`, ~4 min), `versiune`. INBOX și SENT nu împart niciun checkpoint: unul poate fi în recuperare în timp ce celălalt merge normal.
- **Lease**: `fn_red_mail_flux_lease(p_flux, p_token, p_secunde)`, CAS pe rândul fluxului. O rulare procesează fluxurile pe rând (INBOX, apoi SENT), fiecare sub lease-ul lui.
- **Orice scriere de progres** (cursor, `mod_cursor`, `recuperare_*`, starea unui mesaj) e CAS pe **lease-ul curent al fluxului + `versiune` + starea așteptată**. O invocare cu lease expirat nu poate suprascrie progresul uneia noi: RPC-ul întoarce `lease_pierdut`, iar edge-ul se oprește imediat.
- **Rândul `sent`** se creează în F2, la activarea trimiterii, cu aceeași regulă de pornire ca INBOX (*implicit (b)*): `history_id` = `getProfile().historyId` capturat la activare, fără scanare retroactivă a SENT.

**Contractul `?dry=1`** (Jak r3 P3-01)
- Permis: refresh token, `history.list` / `messages.list` și `messages.get?format=metadata` (doar antetele `Message-ID`, `Date` și `sizeEstimate`). Răspunsul conține doar numărători și coduri.
- Interzis: `format=full` / `raw` / `attachments.get`, orice scriere în Storage, manifest, rânduri `red_mail_*` (în afara evenimentului `dry_rulat`), cursoare, reconciliere.
- Dry-ul pe căsuța reală e tot prelucrare: e permis doar după condițiile §2.7. Înainte de §2.7 se testează doar pe fixture-uri (teste Deno fără rețea) și în **modul test** de mai jos.

**Modul test** (*implicit (l)*, Jak r5 P2-03; înainte de §2.7, **fără** căsuța reală)
- Testele se fac pe o **căsuță de test separată** (de ex. `redari-test@gazpet.ro`), nu pe `redari@` și nu prin `redari+test@` (plus-addressing-ul lăsa pe oricine să scrie la adresa de test și cerea citirea `Delivered-To` al mesajelor reale). Căsuța reală nu e citită deloc înainte de activare.
- Căsuța de test are **client OAuth de test** propriu (scope `gmail.readonly`, verificarea căsuței ca în §2.3, cu `getProfile().emailAddress` == adresa de test) și rânduri proprii în `red_mail_flux` (`casuta` = adresa de test, `mod_test = true`). Mesajele importate de acolo au `test = true`.
- **Expeditorul intern e impus tehnic**: o regulă Workspace (Admin Console, Razvan) respinge la intrare orice expeditor din afara `@gazpet.ro` pentru căsuța de test. Test: un mesaj extern trimis la adresa de test nu ajunge la citirea corpului (respins de Workspace, deci absent din Gmail).
- Aceleași reguli ca pentru `redari@`: conturile AI nu primesc acces (§2.2), codul are aceeași cale ca în producție (diferă doar `casuta` și secretele).
- **Trecerea în producție** (Jak r4 P2-04, Jak r5 P2-02) = **prima activare** a rândului `inbox` al `redari@` (mai jos), făcută de owner sub lease-ul acelui flux. Rândurile căsuței de test nu se continuă în producție: rămân `mod_test = true` și se opresc. Mesajele de test importate rămân, marcate `test = true`, și sunt excluse din numărători și din retenția de proiect (se golesc ca `ignorat`).

**Domeniul captat** (*implicit (k)*, Jak r4 P2-05, Cop r4 P2-03): toată corespondența **primită** în `redari@` după `data_start`, indiferent unde a fost mutată ulterior (INBOX, arhivă, altă etichetă, coș). Excluse: mesajele trimise (`SENT`, au fluxul lor), ciornele, chat-urile; spamul (`SPAM`) nu se importă, dar se numără pe rulare (eveniment cu număr, fără identificatori), ca să se vadă dacă filtrul Google înghite răspunsuri. Precondiție F1 (Admin Console, Razvan): pe `redari@` fără filtre Gmail care șterg sau mută mesajele; regula de operare „nimeni nu șterge mesaje din Gmail” (ștersele merg în coș, iar coșul e inclus).

**Prima activare** (*implicit (b)*, Jak r5 P2-02)
- Starea inițială a rândului `inbox`: `mod_cursor = 'neinitializat'`, `history_id = NULL`.
- La activare (owner), sub lease, **în această ordine**, fiecare pas un RPC cu CAS pe lease + `versiune` (Jak r6 P2-02): (1) `data_start = now()` (`timestamptz`) se scrie **doar dacă e NULL**; odată scris, e **imuabil** (trigger), iar o reluare a activării îl păstrează; (2) abia apoi `C_start = users.getProfile().historyId`; (3) într-o singură tranzacție, CAS pe `mod_cursor = 'neinitializat'` și `data_start IS NOT NULL`: `history_id = C_start`, `mod_cursor = 'recuperare'`, `recuperare_tip = 'activare'`, `recuperare_history_id = C_start`. Un crash între pași lasă rândul `neinitializat` cu `data_start` deja fixat: activarea se reia de la pasul 2 cu **același** `data_start`, deci niciun interval nu se pierde. Prima rulare face scanarea de recuperare de mai jos (pașii 2–4 de la „Istoric expirat”) pe baza `data_start`, care prinde mesajele sosite între `data_start` și captura `C_start` (istoricul de la `C_start` nu le mai conține); la final `mod_cursor = 'normal'`. Test: crash după fiecare pas și lease expirat între pași → `data_start` neschimbat, fiecare mesaj importat o singură dată.
- **Fără import retroactiv**: mesajele aflate în căsuță înainte de activare nu intră în ERP.
- **Limita de admitere e exactă**: `internalDate ≥ data_start`, pe toate căile fluxului `inbox` (istoric, recuperare, activare). Suprapunerea de siguranță (o oră) rămâne **doar în interogarea Gmail** (`after:`), nu în filtrul din cod; un mesaj cu `internalDate < data_start` nu se importă niciodată pe fluxul `inbox`, nici după un `404`. Test: mesaje sosite înainte / în timpul / după activare, apoi `404` → intră doar cele cu `internalDate ≥ data_start`, fiecare o singură dată.
- **Importul istoric** (Jak r4 P2-04) se face doar la cererea explicită a lui Razvan („da” separat), ca **flux separat**: rândul `red_mail_flux` cu `flux = 'import'`, checkpoint propriu, **filtrul exact `data_import_de_la ≤ internalDate < data_start`** (nu filtrul fluxului normal). Scanarea: `messages.list?q=after:<epoch(data_import_de_la) − 3600> before:<epoch(data_start) + 3600> -in:sent -in:drafts -in:chats&includeSpamTrash=true`, cu limitele exacte aplicate în cod. Nu atinge cursorul `inbox`; mesajele de la granița `data_start` le acoperă dedup-ul. Test: import în timp ce sosesc mesaje noi → fiecare intră o singură dată.

**Mod normal**
- `C0` = `history_id`, citit o dată. **`startHistoryId = C0` fix pe toată paginarea** (`pageToken` până la capăt), `historyTypes = messageAdded`, **fără filtru de etichetă** (un mesaj arhivat sau mutat imediat de o regulă tot apare ca adăugat). Se exclud în cod mesajele cu `SENT`, `DRAFT`, `CHAT`; cele cu `SPAM` se numără și se sar. Un mesaj scos din spam de un om (`labelRemoved SPAM`) intră și el: `historyTypes` include `labelRemoved`, filtrat în cod pe `SPAM`.
- Înregistrările de istoric au `id` crescător. Mesajele lor se procesează în ordine.
- **Publicarea cursorului**:
  - după TOATE paginile: `historyId`-ul întors la ultima pagină, **inclusiv la rezultat gol**;
  - la oprire înainte de final (buget, eroare tranzitorie): doar până la `id`-ul ultimei înregistrări ale cărei mesaje sunt **toate finale** (`ok`, `neprocesabil`, `disparut`). Un mesaj `in_curs` (ingestie incompletă, §1.2) oprește cursorul la înregistrarea dinaintea lui.
- **Reluare în interiorul unei înregistrări / pagini**: la rularea următoare se recitește aceeași fereastră; mesajele deja finale se sar după `(casuta, gmail_id)`, cele `in_curs` se reiau din manifest (§1.2), cele noi se procesează. Nu există progres „pe jumătate de înregistrare” salvat separat: starea mesajului e progresul.

**Istoric expirat (`404`)** — istoricul poate expira în câteva ore, deci e caz normal:
1. Sub lease se capturează **ÎNAINTE de scanare** `C_nou = getProfile().historyId` → `recuperare_history_id`, `mod_cursor = 'recuperare'`, `recuperare_tip = 'cursor_expirat'`.
2. Scanare completă a domeniului captat (*implicit (k)*), nu doar a INBOX-ului actual: `messages.list?q=after:<epoch_secunde(data_start) − 3600> -in:sent -in:drafts -in:chats&includeSpamTrash=true`, apoi în cod filtrul exact `internalDate ≥ data_start` (fără suprapunere, Jak r5 P2-02), spamul numărat și sărit. Un mesaj sosit în timpul întreruperii și arhivat sau mutat în coș înainte de recuperare e găsit. Test: mesaj sosit după activare, arhivat înainte de un `404` → importat. `after:` cu **epoch în secunde** (nu `AAAA/LL/ZZ`, care depinde de fusul orar Gmail), cu o oră de suprapunere: limita Gmail e tratată ca aproximativă, limita exactă e cea din cod.
3. Progresul (`recuperare_page_token`) e durabil, scris cu CAS pe lease. **`pageToken` respins** (`400` / invalid) → scanarea **repornește de la început**, cu același `C_nou`; dedup-ul sare ce e final.
4. La final: `history_id = C_nou`, `mod_cursor = 'normal'`. Rularea următoare citește istoricul de la `C_nou`, deci prinde și ce a sosit în timpul scanării.

**Trei cazuri separate, per mesaj**
| Caz | Exemplu | Ce se face | Cursorul |
|---|---|---|---|
| Dispărut | `messages.get` → `404` | `red_mail_evenimente` (`disparut`, `gmail_id_hmac`) | merge mai departe |
| Neprocesabil | peste limite, structură invalidă, decodare imposibilă | rând **durabil** `stare_ingestie = 'neprocesabil'` + `motiv_cod`; apare la „De triat” | merge mai departe |
| Eroare tranzitorie | `5xx`, `429`, timeout, eroare BD | oprește rularea | rămâne la ultima înregistrare finală |

`invalid_grant` / `401` → `citire_activa = false` automat + `ultima_eroare_cod` + notificare owner.

**Secvența de citire a unui mesaj și limitele** (corectată în r3: `metadata` nu dă structura MIME)
1. `messages.get?format=metadata&metadataHeaders=…` → **doar** `sizeEstimate`, etichete, antete. `sizeEstimate > 25 MB` → `neprocesabil` (`prea_mare`) fără altă descărcare.
2. `messages.get?format=full` cu **plafon pe răspunsul HTTP** citit ca flux: 30 MB de JSON, oprire la depășire → `neprocesabil`. Aici se verifică structura: adâncime ≤ 5, ≤ 50 de părți, ≤ 20 de atașamente, tipurile și `body.size` declarat pe fiecare parte. Datele inline (`body.data`) intră în același plafon.
3. `attachments.get` pentru două categorii distincte (Jak r4 P2-03):
   - **părțile de corp** (`text/plain` / `text/html` alese la pasul 5) care au `body.attachmentId` în loc de `body.data`: descărcate cu plafon de **2 MB** pe răspuns, decodate și trunchiate ca textul inline; **nu se stochează ca fișier** și nu se oferă la descărcare (HTML-ul rămâne doar text extras);
   - **atașamentele** din lista albă (§2.6): plafon pe răspunsul base64url (14 MB pentru 10 MB decodați), apoi verificarea mărimii decodate și a octeților magici.
   - Fixture-uri obligatorii: corp `text/plain` și corp `text/html` livrate prin `attachmentId`.
4. `format=raw` doar dacă `sizeEstimate ≤ 10 MB`, cu plafon de 14 MB pe răspuns. Peste → fără `.eml` (`eml_absent = 'prea_mare'`), mesajul rămâne procesabil.
5. **Decodare**: `body.data` e base64url. Codarea de transfer (base64 / quoted-printable) o decodează Gmail în `format=full` (*de confirmat pe fixture-uri reale, §8*); parserul tratează defensiv și varianta nedecodată. Charset din `Content-Type` prin `TextDecoder`; necunoscut → UTF-8 cu înlocuire + steag `charset_necunoscut`. Ordinea corpului: `text/plain` → altfel `text/html` convertit în text pe server (tokenizator simplu, fără DOM, fără randare) cu steag `doar_html` → altfel corp gol cu steag `fara_corp`. `multipart/alternative`: se alege `text/plain`.
6. **Bugetul pe rulare**: ≤ 50 de mesaje, ≤ 100 MB descărcați în total, ≤ 50 s. La depășire se oprește curat; mesajul început rămâne `in_curs` și se reia.
- Corp ≤ 20.000 de caractere (restul `trunchiat`, L12), subiect ≤ 500.

### 1.2 Deduplicare, ingestie în doi pași, BD ↔ Storage
- **Identitatea de ingestie = `(casuta, gmail_id_hmac)`** (Jak r4 P2-02, Cop r4 P2-02):
  - `gmail_id_hmac = HMAC-SHA256(REDARI_MAIL_REF_SECRET[v], casuta ‖ 0x00 ‖ gmail_id)`, adică peste identitatea canonică `(casuta, gmail_id)` (Jak r6 P2-04: același `gmail_id` în două căsuțe dă HMAC-uri diferite), se calculează **la prima ingestie**, pentru fiecare mesaj, cu `hmac_versiune = v`;
  - **`UNIQUE (casuta, gmail_id_hmac)`** pe toate rândurile, inclusiv cele golite (`gmail_id` brut, păstrat cât timp mesajul e activ pentru apelurile API, are și el UNIQUE parțial pe rândurile negolite);
  - `fn_red_mail_ingestie_incepe` face **întâi** `INSERT … ON CONFLICT (casuta, gmail_id_hmac) DO NOTHING RETURNING`, apoi `SELECT` pe cheie (L04). Rând existent `golit` → întoarce `deja_golit`, **fără nicio descărcare** de corp sau atașamente; rând `in_curs` → reluare; `ok` / `neprocesabil` → sărit. Două rulări concurente pe același id → un singur rând (testat cu barieră);
  - **rotația cheii**: cheile vechi rămân în Vault (`REDARI_MAIL_REF_SECRET_V<n>`) doar pentru căutare; ingestia caută cu toate versiunile active, scrie cu cea curentă. O cheie veche se retrage doar după ce n-a mai rămas niciun rând sau tombstone cu versiunea ei;
  - **după ștergerea finală a auditului** rămâne un tombstone minim în `red_mail_dedup` (`casuta`, `gmail_id_hmac`, `hmac_versiune`, `golit_la`, fără altceva). Ingestia verifică și `red_mail_dedup`;
  - **tombstone-ul nu expiră niciodată singur** (Jak r5 P2-01): termenul politicii Google Vault nu dovedește că originalul a dispărut din Gmail, deci nu există ștergere calendaristică. **Dovada absenței** (*implicit (n)*, completat în r14 după Jak r13 P2-02 / Cop r13 P2-05), toate condițiile, altfel tombstone-ul **rămâne** (fail-closed): (1) **scanare completă și stabilă**: sub lease, `historyId` capturat înainte; `messages.list` cu `includeSpamTrash=true`, toate paginile, fără eroare și fără `pageToken` respins; HMAC-ul fiecărui id calculat cu toate versiunile active și comparat cu tombstone-urile; `historyId` capturat după — dacă diferă de cel dinainte, scanarea e abandonată și nu publică nimic. Rezultatele se publică atomic, sub lease, numai după o scanare validată: tombstone negăsit → `absent_prima_la` (doar dacă e NULL, primul rezultat se păstrează); găsit → `absent_prima_la = NULL`; (2) a doua scanare completă și stabilă, la ≥ 30 de zile după `absent_prima_la`, în care tot lipsește; (3) **`messages.get` → `404` pe id-ul candidat**. Id-ul candidat se poate obține doar dacă un id din listă dă același HMAC (caz în care mesajul există, deci tombstone-ul rămâne); HMAC-ul nu se inversează, deci după golire id-ul candidat de regulă **nu** există, condiția (3) nu se poate dovedi și tombstone-ul **rămâne**. Consecința declarată: în practică tombstone-urile nu se șterg (cost: un rând mic per mesaj golit). Teste: politica Vault prelungită → tombstone-ul rămâne, recuperarea dă `deja_golit`; scanare întreruptă sau cu `historyId` schimbat între început și sfârșit (mesaj nou sosit în timpul scanării) → nicio schimbare; absent, apoi reapărut (scos din coș) → `absent_prima_la` resetat; absent de două ori la 30 de zile, fără id candidat → tombstone păstrat;
  - test: golire → `404` → recuperare → `deja_golit`, nimic reimportat; la fel după ștergerea finală (tombstone).
- `rfc_message_id` e index **neunic**, doar pentru corelare: coliziunile se păstrează și se semnalează (`coliziune_message_id`). `raw_sha256` e doar indiciu.
- **„Cunoscut” nu înseamnă „complet”.** Ingestia are stări:
  1. `fn_red_mail_ingestie_incepe` (o tranzacție): rândul `red_mail_primite` cu `stare_ingestie = 'in_curs'` + **manifestul** în `red_mail_obiecte` (un rând per obiect așteptat: `.eml`, fiecare atașament permis, cu `cale` deterministă pe `(casuta, gmail_id_hmac)`, mărimea declarată, `stare = 'asteptat'`). Părțile respinse au deja `stare = 'respins_*'` (durabil).
  2. Edge-ul urcă fiecare obiect (`upsert = false`). Dacă obiectul există deja (reluare), îl citește și compară `sha256`: același → ok; diferit → `fn_red_mail_ingestie_conflict(primit_id, obiect_id, lease_token)` (Cop r6 P2-05): **o tranzacție**, CAS pe `in_curs` + lease: obiectul → `stare = 'conflict_obiect'`, mesajul → `stare_ingestie = 'neprocesabil'`, `motiv_cod = 'conflict_obiect'`, eveniment `ingestie_neprocesabil`. Obiectul conflictual din Storage **nu se suprascrie și nu se șterge** (are rând de manifest, deci nici măturarea de orfane nu-l atinge); îl verifică admin-ul, cu originalul încă în Gmail. Mesajul e final pentru cursor imediat, fără blocajul de 24 h. Test: conflict de sha la reluare → mesajul următor din istoric se procesează în aceeași rulare.
  3. `fn_red_mail_obiect_confirma(obiect_id, sha256, marime)` după fiecare upload reușit.
  4. `fn_red_mail_ingestie_finalizeaza`: CAS pe `in_curs`, verifică faptul că **toate** obiectele manifestului sunt `stocat` sau `respins_*`, apoi `stare_ingestie = 'ok'`. Abia atunci mesajul e final pentru cursor (§1.1).
- **Reluare**: un `gmail_id` găsit cu `in_curs` se reia din manifest (obiectele `asteptat`), nu se sare. Un `in_curs` mai vechi de 24 h fără progres → `neprocesabil` (`ingestie_blocata`), durabil, vizibil.
- **Orfane**: căile se creează doar după manifest, deci un crash lasă cel mult obiecte `asteptat` (reluate) sau obiecte urcate neconfirmate (confirmate la reluare prin sha). Plasa de siguranță: `redari-mail-retentie` listează zilnic prefixul `mail/` și compară cu `red_mail_obiecte`; orice obiect fără rând de manifest, mai vechi de 24 h, se șterge (numărul în jurnal, fără nume).
- **Fără obiecte partajate, izolare pe căsuță** (Jak r6 P2-04): căile includ căsuța **și** HMAC-ul calculat cu ea: `mail/<casuta_cod>/carantina/<gmail_id_hmac>.eml`, `mail/<casuta_cod>/atasamente/<gmail_id_hmac>/<n>`, cu `casuta_cod` ∈ {`redari`, `redari-test`}. Retenția șterge per mesaj, fără numărare de referințe. Test: același `gmail_id` în fixture-urile căsuței de test și ale `redari@` → două rânduri, două căi diferite, golire independentă.

### 1.3 Trimiterea: `redari-mail-trimite` (F2, F3)
- **Pornire**: doar din UI, owner sau admin Redări (§2.1), pe un lot `aprobat`. Fără cron.
- **Snapshot imuabil la crearea lotului**: pe fiecare `red_mail_mesaje`: `catre` complet, `subiect_final`, `corp_text_final`, `corp_html_final`, `antete_snapshot` (jsonb: From, To, Message-ID, In-Reply-To, References, List-Unsubscribe), `atasament_path` + `atasament_nume` + `atasament_mime` + `atasament_sha256` + `atasament_marime` (citite din fișier), `mesaj_sha256`. Pe lot: `lot_sha256` peste lista ordonată a `mesaj_sha256`.
  - Owner-ul vede în preview **adresele complete**, textul exact și atașamentul.
  - `fn_red_mail_lot_aproba(p_lot, p_versiune, p_lot_sha256)` refuză la hash diferit. După aprobare, triggerul blochează câmpurile snapshotului (L07). **Singura excepție** e golirea de retenție (§1.8): triggerul acceptă un UPDATE pe snapshot doar dacă **toate** câmpurile de conținut devin NULL deodată, `retentie_stare` trece în `golit`, iar termenul proiectului a trecut (verificat în trigger, fără identitatea apelantului, L08).
  - **Modelul lotului** (*implicit (m)*, r9 — simplificare după Jak r8 / Cop r8; înlocuiește variantele r7–r8): **un lot aprobat e înghețat**. Nu se editează, nu se deblochează, nu se reaprobă. Corectura = **lot nou** (`ciorna`) creat de un om, cu mesaje noi. Totul e listă literală și fail-closed: orice tranziție care nu e în lista de mai jos e refuzată de BD.
    - **Stările lotului (listă închisă)**: `ciorna` → `aprobat` → `in_trimitere` → `incheiat`; din `aprobat` / `in_trimitere` se poate ajunge în `blocat_integritate`, iar de acolo doar în `incheiat`. Tranzițiile permise sunt **exact**: `ciorna → aprobat` (`fn_red_mail_lot_aproba`), `aprobat → in_trimitere` (prima rezervare), `aprobat | in_trimitere → blocat_integritate` (nepotrivire de hash), `ciorna | aprobat | in_trimitere | blocat_integritate → incheiat` (`fn_red_mail_lot_inchide`). Nicio tranziție nu iese din `incheiat` și nicio tranziție nu duce înapoi spre `ciorna` / `aprobat`.
    - **Ordinea globală a lock-urilor (singura, L06)**: (1) `red_mail_setari` (`FOR SHARE` sau `FOR UPDATE`, după caz), dacă RPC-ul are nevoie de ea; (2) loturile, `FOR UPDATE`, în ordinea `id`-ului; (3) mesajele, `FOR UPDATE`, în ordinea `id`-ului. Orice RPC din §1.3–1.4 și §1.9 (componență, aprobare, încheiere, rezervare, `apel_incepe`, rezultat, reconciliere, ștergere finală) ia doar o parte din această listă, **în această ordine**, și verifică starea, `versiune` și hash-urile **abia după** ce are lock-urile. Celelalte paragrafe trimit aici.
    - **Componența** se schimbă doar prin RPC-uri (`fn_red_mail_lot_adauga` / `_scoate` / `_muta`), **doar pe un lot `ciorna`**. INSERT / DELETE / UPDATE de `lot_id` direct prin PostgREST pe `red_mail_mesaje` sunt închise pentru roluri (fără drepturi de scriere). Trigger `BEFORE INSERT OR UPDATE OF lot_id OR DELETE` pe `red_mail_mesaje` (plasa de siguranță, fără GUC-uri, L08): refuză orice INSERT / schimbare de `lot_id` care atinge un lot în altă stare decât `ciorna`, și orice DELETE, în afara ștergerii finale (mai jos).
    - **Aprobarea**: RPC-urile de componență recalculează `lot_sha256` și incrementează `versiune`. `fn_red_mail_lot_aproba(p_lot, p_versiune, p_lot_sha256)` recalculează hash-ul din mesajele curente și aprobă doar dacă `versiune` **și** hash-ul sunt cele din preview-ul văzut de owner; altfel refuz (`lot_modificat`). La aprobare se scrie **amprenta aprobată** (`aprobat_lot_sha256`, `aprobat_versiune`, `aprobat_de`, `aprobat_la`), o singură dată; după aprobare amprenta și `lot_sha256` sunt imuabile (trigger, fără excepții).
    - **Verificarea la fiecare rezervare și trimitere**: `fn_red_mail_rezerva` și `fn_red_mail_apel_incepe` recalculează hash-ul din lista ordonată a `mesaj_sha256` ale mesajelor lotului și cer ca **toate trei** să fie egale: hash-ul recalculat, `lot_sha256`, `aprobat_lot_sha256`. Orice diferență → lotul trece în `blocat_integritate`, iar rezervarea / apelul curent e refuzat (mesajul nu e trimis).
    - **`blocat_integritate` e terminal pentru trimitere**: nicio rezervare și niciun `apel_incepe` nu mai reușesc pe lot; nu există deblocare și nici reluare. Mesajele `in_apel` își termină tranziția (`fn_red_mail_rezultat`, `_rezultat_tarziu`), iar reconcilierea `necunoscut` și monitorizarea SENT merg normal. Alertă: eveniment `lot_integritate` + notificare owner, cu cele trei hash-uri (fără conținut). Singura acțiune posibilă pe lot e **încheierea** (owner); dacă mai trebuie trimis ceva, se face un lot nou.
    - **Încheierea lotului** — `fn_red_mail_lot_inchide(p_lot, p_versiune, p_motiv)`, doar owner, din orice stare în afară de `incheiat`. Sub lock-urile din ordinea globală, într-o tranzacție:
      1. toate mesajele care **n-au intrat în apel** — `in_coada` și `rezervat`, **inclusiv rezervările cu lease expirat** — trec în `anulat` (`lot_incheiat`) și își eliberează locul din plafon (§1.9). Un worker care ține încă o rezervare validă primește `false` la `apel_incepe` (CAS pe `stare = 'rezervat'` eșuează), deci nu face niciun apel;
      2. mesajele `in_apel` / `necunoscut` / `trimis` / `esuat_*` rămân neschimbate; reconcilierea continuă pe ele. **Încheierea oprește doar apelurile noi** (Jak r9 P3-01, Cop r9 P2-01): niciun `apel_incepe` nu mai reușește după ea, dar un mesaj deja `in_apel` (autorizat înainte) poate face fizic apelul Gmail după încheiere și își termină tranziția; UI-ul afișează „N trimiteri deja autorizate în curs”;
      **Fără revenire în coadă pe un lot încheiat sau blocat** (Cop r9 P2-02; corectat în r11, Jak r10 P2-01, Cop r10 P2-01 / P2-03): pe un lot `incheiat` / `blocat_integritate`, rezultatele permise ale unui apel deja început sunt **exact**: `in_apel → trimis` (succes confirmat, inclusiv prin reconciliere), `in_apel → esuat_sigur` (de ex. eșecul refresh-ului de token / `invalid_grant` / `401` înainte de `send`, `apel_neefectuat`) și `in_apel → necunoscut` (apoi `necunoscut → trimis` / „de decis” prin reconciliere, §1.4). O rezervare expirată, măturată pe un astfel de lot, trece `rezervat → anulat` (locul din plafon se eliberează, §1.9), nu în `in_coada`. Triggerul pe `red_mail_mesaje` refuză pe aceste loturi **doar** tranzițiile spre `in_coada` și spre `rezervat`; celelalte tranziții din tabelul rezultatelor rămân permise;
      3. lotul trece în `incheiat`, cu evenimentul `lot_incheiat` (autor, motiv, numărători).
      **Corectura** (un mesaj greșit, un destinatar uitat, un lot blocat) = owner-ul încheie lotul, apoi un om creează un **lot nou** `ciorna` cu mesaje noi (id, `Message-ID` și `mesaj_sha256` noi), care trece prin aprobarea lui. Mesajele lotului încheiat nu se copiază și nu se mută.
    - **Ștergerea finală de retenție — singura cale de DELETE** — `fn_red_mail_lot_sterge_final(p_lot, p_versiune)`, doar owner, ca operație cu „da” (§1.8, pct. 3). **Predicat unic, conjunctiv**, reverificat sub lock la fiecare apel: lotul e `incheiat` **și** niciun mesaj nu e `in_apel` sau `necunoscut` (reconcilierea încheiată) **și** termenul `retentie_mail_pana` al proiectului a trecut **și** „da”-ul owner-ului e dat. Pașii, reluabili idempotent:
      1. **inventarul fișierelor e deja salvat, cu marcaj de completitudine** (Jak r9 P2-02, Cop r9 P2-03): la încheierea lotului (pasul 3 de mai sus, aceeași tranzacție), din snapshoturile imuabile, deci **înaintea oricărei goliri**, se scriu (a) rândurile `red_mail_fisiere_inventar` (`lot_id`, `mesaj_id`, `cale`, `sha256`, `marime`, `proprietate` ∈ {`exclusiv`, `partajat`}, `stare` ∈ {`de_sters`, `sters`, `pastrat`}), câte unul pentru **fiecare** fișier referit de snapshoturile lotului, și (b) **rândul-antet** `red_mail_fisiere_inventar_antet` (PK `lot_id`): `inventar_complet_la`, `nr_fisiere` (numărul rândurilor scrise), `inventar_sha256` (SHA-256 peste lista canonică ordonată a rândurilor de inventar `(lot_id, mesaj_id, cale, sha256 fișier, marime)`). **Snapshoturile se verifică o singură dată, aici, la încheiere** (Jak r10 P2-02, Cop r10 P2-02): RPC-ul scrie inventarul din ele și verifică, în aceeași tranzacție, **în ambele sensuri** (Cop r11 P2-01): (i) fiecare fișier referit de snapshoturile lotului are **exact un** rând de inventar; (ii) fiecare rând de inventar corespunde unui fișier referit de snapshoturile **acestui** lot (fără rânduri în plus, fără duplicate: `UNIQUE (lot_id, mesaj_id, cale)`); (iii) `nr_fisiere` = numărul rândurilor. **Corespondența** rând ↔ fișier referit (Cop r12 P3-01) = egalitatea **tuturor** atributelor `(lot_id, mesaj_id, cale, sha256 fișier, marime)` cu cele din snapshot (`atasament_path`, `atasament_sha256`, `atasament_marime`), nu doar potrivirea pe `mesaj_id` + `cale`. Clasificarea `exclusiv` / `partajat` se validează separat, față de sursele care dețin fișierul (de ex. convocarea poștală). Orice abatere → încheierea e refuzată în întregime (`inventar_inconsistent`), nimic scris. După aceea, antetul și rândurile inventarului sunt singura sursă: golirea și ștergerea finală nu mai citesc snapshoturile (care pot fi deja golite). Un lot fără fișiere are antet complet cu `nr_fisiere = 0` (diferit de „inventar nescris”, unde antetul lipsește). Antetul și rândurile sunt imuabile (trigger), cu excepția coloanei `stare` a rândurilor; niciun rând nu se șterge înaintea pasului 3. `partajat` = fișier referit și de altă sursă (de ex. convocatorul PDF al convocării poștale, `atasament_path`); acesta are `stare = 'pastrat'` și rămâne sub politica sursei lui;
      2. fișierele `exclusiv` `de_sters` se șterg din Storage pe rând; fiecare e confirmat **absent** înainte de `stare = 'sters'`. Înainte de ștergere se reverifică faptul că nicio altă sursă nu-l referă (altfel trece în `pastrat`);
      3. abia când niciun rând de inventar nu mai e `de_sters`, se șterg, în aceeași tranzacție, rândurile mesajelor, inventarul și lotul, cu evenimentul `lot_sters_final` (numărători, fără conținut);
      4. eșec la un fișier → **evidența rămâne**; rularea următoare reia pe inventarul salvat de unde a rămas; o reluare după succes nu face nimic.
      **Golirea conținutului** mesajelor unui lot (§1.8) — prin `fn_red_mail_lot_goleste` (owner, „da”), nu prin UPDATE direct — are aceleași precondiții, reverificate **sub lock** (ordinea globală) în RPC și în trigger (Jak r9 P2-01, Jak r9 P2-02): lotul e `incheiat`, **reconcilierea s-a încheiat pentru toate mesajele lotului** (niciun `in_apel` / `necunoscut`; reconcilierea are nevoie de snapshot pentru forma canonică, §1.4), antetul inventarului există cu `inventar_complet_la` setat, iar `nr_fisiere` și `inventar_sha256` **recalculate din rândurile inventarului** (nu din snapshoturi) coincid cu cele din antet. Orice nepotrivire → refuz (`inventar_incomplet` / `reconciliere_in_curs`). Ștergerea finală (pasul 3) verifică la fel, tot doar antet ↔ rânduri, deci funcționează și după golire.
      Nu există stare intermediară de lot: progresul stă în inventar. Triggerul acceptă DELETE pe `red_mail_mesaje` doar pentru un lot care satisface predicatul și nu mai are rânduri de inventar `de_sters` (verificat din datele rândurilor, fără identitatea apelantului, L08).
    - **Teste (F2, cu barieră, L25)**: (1) după aprobare, INSERT al unui mesaj nou în lot → refuz; (2) DELETE al unui mesaj → refuz; (3) mutarea unui mesaj din / într-un lot ne-`ciorna`, ca admin / editor și prin PostgREST → refuz; (4) (a) UPDATE direct pe `lot_sha256` sau pe amprenta aprobată după aprobare → refuzat de trigger; (b) corupere simulată în fixture (un `mesaj_sha256` schimbat cu triggerele oprite, ca superuser) → `blocat_integritate` la rezervare și, separat, la `apel_incepe`, fără apel Gmail; (5) admin adaugă / mută un mesaj imediat după aprobare, concurent cu rezervarea → refuz; (6) INSERT / DELETE / mutare începute în `ciorna`, aprobare concurentă, apoi finalizarea modificării → modificarea fie e inclusă în hash-ul aprobat, fie e refuzată; niciodată un mesaj în plus sub aprobarea veche; (7) orice tranziție de stare din afara listei (de ex. `blocat_integritate → aprobat`, `incheiat → in_trimitere`, `aprobat → ciorna`) prin RPC sau PATCH direct → refuz; (8) **încheiere cu rezervări expirate**: lot cu `in_coada`, `rezervat` cu lease valid, `rezervat` cu lease expirat, `in_apel`, `necunoscut` → primele trei `anulat`, locurile din plafon eliberate, `apel_incepe` al worker-ului cu rezervare validă întoarce `false` (niciun apel nou), `in_apel` își termină tranziția (inclusiv cu apelul Gmail făcut fizic după încheiere), iar rezultatul lui pe lotul încheiat poate fi `trimis` (succes după încheiere → permis), `esuat_sigur` (refresh de token eșuat) sau `necunoscut`, niciodată `in_coada`; `necunoscut` se reconciliază; o tranziție directă spre `in_coada` pe lotul încheiat → refuz; (9) încheiere concurentă cu rezervarea / `apel_incepe` → serializat: **niciun apel nou început după încheiere** (`apel_incepe` după încheiere → `false`); separat, un mesaj autorizat prin `apel_incepe` înainte de încheiere își termină tranziția după ea, iar UI-ul îl arată ca trimitere autorizată în curs; (10) `blocat_integritate` pe un lot parțial trimis (Jak r11 P3-01): **nicio rezervare nouă reușită și niciun `apel_incepe` nou reușit**, nicio deblocare; **singura acțiune care schimbă starea lotului e încheierea de owner**. Operațiile permise asupra mesajelor continuă explicit: o rezervare cu lease expirat, măturată pe lotul blocat → `anulat` (nu `in_coada`), cu locul din plafon eliberat; un `in_apel` deja autorizat își termină tranziția (cu succes → `trimis`); reconcilierea `necunoscut` continuă; încheiere de non-owner → refuz; corectura prin lot nou nu atinge lotul vechi; (11) **ștergere finală**: refuzată pe lot ne-`incheiat`, **refuzată cu un mesaj `necunoscut` / `in_apel`** (chiar după termen), refuzată cu termen netrecut sau de non-owner; **inventarul salvat înainte de golire** (golire fără antet → refuz; antet cu `nr_fisiere` sau `inventar_sha256` nepotrivit / rând de inventar lipsă → refuz; lot fără fișiere → antet cu `nr_fisiere = 0`, golire permisă; după golire, inventarul are căile); **golire refuzată cu un mesaj `necunoscut` / `in_apel`** (lot încheiat, termen trecut, inventar complet) și permisă după reconcilierea terminală; **ștergere finală după golire, cu inventar valid** → reușește (verificarea compară doar antetul cu rândurile inventarului, snapshoturile golite nu contează); un rând de inventar alterat după încheiere → refuz; **la încheiere**: rând de inventar în plus (cale nereferită de snapshoturile lotului), rând duplicat, fișier referit fără rând, rând cu `cale` corectă dar `sha256` sau `marime` diferite, sau `nr_fisiere` ≠ numărul rândurilor → încheierea refuzată (`inventar_inconsistent`), nimic scris; fișier marcat `exclusiv` deși e referit de convocarea poștală → refuz; legitimă cu un fișier exclusiv și unul partajat → exclusivul șters și confirmat absent, partajatul `pastrat`, apoi rândurile șterse; crash între ștergerea unui fișier și ștergerea rândurilor → evidența rămâne, reluarea termină o singură dată; (12) ordinea globală a lock-urilor: `rezerva` ↔ `apel_incepe` ↔ aprobare / încheiere, cu setările și lotul contestate simultan → fără deadlock.
  - **Expirarea aprobării după 7 zile** (*implicit (h)*, Cop r3 P3-03): se aplică **doar** mesajelor `in_coada`, care trec în `anulat` (`aprobare_expirata`). `rezervat` cu lease valid se termină normal; `in_apel`, `necunoscut`, `trimis` și `esuat_*` **nu se rescriu**: își păstrează reconcilierea și auditul.
- **Destinatarii eligibili**: doar `red_detinatori_contact.email` (adrese introduse de operatori sau confirmate din `red_mail_adrese_propuse`, §1.11). O adresă doar propusă nu intră niciodată într-un lot.
- **Forma canonică și `mesaj_sha256`** (Cop r3 P2-07, Jak r3 P2-05):
  - `mesaj_sha256` = SHA-256 peste **JSON canonic** (RFC 8785, chei sortate, UTF-8) al obiectului `{v: 1, mesaj_id, from, to, subiect, message_id, in_reply_to, references, corp_text, corp_html, atasamente: [{nume, mime, marime, sha256}]}`.
  - Normalizare: textele în Unicode NFC, sfârșiturile de rând `\n`, fără spații finale la sfârșit de rând; adresele în minuscule; `references` ca listă ordonată.
  - **Excluse**: antetul `X-Gazpet-Redari`, delimitatorii MIME, codarea de transfer, `Date`, ordinea antetelor. Deci aceeași aprobare recompusă de două ori dă același hash, chiar cu delimitatori diferiți, și nu există dependență circulară.
  - Aceeași funcție în TS (compunere + reconciliere) și în SQL (crearea snapshotului), cu test de paritate (L19).
- **Antet de control**: `X-Gazpet-Redari: <id mesaj>; h=<mesaj_sha256>`. E doar **indiciu de corelare**, nu dovadă: la reconciliere hash-ul se recalculează din conținutul găsit (§1.4).
- **Pașii și tranzițiile per mesaj** (L01–L05):
  1. `fn_red_mail_rezerva(p_lot, p_apelant)`: lock-urile în ordinea globală de mai sus (setări → lot → mesaje, L06). Verifică kill-switch, plafon (§1.9), opt-out, `extern_permis`, expirarea aprobării, nivelul și cele trei hash-uri egale (recalculat, `lot_sha256`, amprenta aprobată; Cop r6 P1-01, r8). `in_coada → rezervat` + `lease_token`, `lease_pana` (~2 min), `rezervare_nr` crescător.
  2. Edge-ul recompune MIME-ul **din snapshot** și verifică `mesaj_sha256` + `atasament_sha256` (descarcă și hash-uiește). Diferență → `esuat_sigur` (`snapshot_diferit`), fără apel.
  3. `fn_red_mail_apel_incepe(id, lease_token)`: lock-urile în ordinea globală de mai sus (setări `FOR SHARE` → lot → mesaj), **CAS** pe `stare = 'rezervat'` + lease propriu + `lease_pana > now()`, și **re-verifică** (Jak r4 P2-06): kill-switch-ul (`trimitere_oprita`), opt-out-ul destinatarului, `extern_permis` pentru domeniul lui, lotul încă `aprobat` / `in_trimitere`, neexpirat și cu cele trei hash-uri egale (Cop r6 P1-01, r8). Orice condiție căzută → `rezervat → in_coada` (oprire / anulare) sau `anulat` (opt-out), fără apel. Întoarce `true` / `false`, **commit înainte de apel**. `false` → **niciun apel Gmail**. Un mesaj deja `in_apel` nu mai poate fi retras sigur (apelul poate fi plecat): oprirea îl lasă să-și termine tranziția, iar UI-ul o spune. Test cu barieră între rezervare și oprire / dezabonare.
  4. Refresh token → access token (dacă eșuează aici, apelul nu s-a făcut: §tabel).
  5. `users.messages.send` (`raw`; la F3 și `threadId`).
  6. `fn_red_mail_rezultat(id, lease_token, …)`: CAS; în aceeași tranzacție `trimis` + `trimis_la` (§1.5; nimic în `red_convocari`).

**Tabelul complet al rezultatelor**
| Moment | Rezultat | Tranziție | Retrimitere automată |
|---|---|---|---|
| rezervare | plafon atins / kill-switch / opt-out / aprobare expirată | rămâne `in_coada` (sau `anulat` la expirare / opt-out; expirarea atinge doar `in_coada`) | n/a |
| înainte de `apel_incepe` | lease expirat (măturat) | `rezervat → in_coada` (apelul sigur nu s-a făcut); pe lot `incheiat` / `blocat_integritate`: `rezervat → anulat`, cu locul din plafon eliberat (§1.3) | da, e sigur (doar pe un lot activ) |
| `apel_incepe` | CAS eșuat | nimic; worker-ul se oprește | — |
| refresh token / `send`, după `apel_valabil_pana` | autorizarea a expirat (§1.9) | `in_apel → in_coada` (`apel_expirat`), locul eliberat; pe lot `incheiat` / `blocat_integritate`: `esuat_sigur` | da, de la rezervare |
| refresh token, înainte de `send` | `invalid_grant` / `401` | `in_apel → in_coada` (`apel_neefectuat`) + `trimitere_oprita = true`; pe un lot `incheiat` / `blocat_integritate`: `in_apel → esuat_sigur` (`apel_neefectuat`), niciodată `in_coada` (§1.3) | după repornirea de owner (doar pe un lot activ) |
| orice rezultat, pe lot `incheiat` / `blocat_integritate` | `200` valid / reconciliere găsită | `in_apel` / `necunoscut` → `trimis` (permis și după încheiere) | — |
| `send` | `200` + răspuns valid (`id`, `threadId`) | `trimis` (CAS) | — |
| `send` | `200` dar răspuns de neînțeles | `necunoscut` | **nu** |
| `send` | `400`, `403` scope / permisiune (determinist) | `esuat_sigur` + `eroare_cod` | nu |
| `send` | `429`, `403 rateLimitExceeded`, `5xx`, timeout, rețea | `necunoscut` + pauză de trimitere 15 min | **nu** (§1.4) |
| după `send` OK | RPC-ul `rezultat` eșuează (BD) | 3 reîncercări cu aceleași argumente (idempotent); tot eșec → rămâne `in_apel` → măturat `necunoscut` → reconcilierea îl găsește | nu |
| worker întârziat | răspunde după ce mesajul a fost măturat `necunoscut` | `fn_red_mail_rezultat_tarziu` salvează `gmail_id_raportat`; reconcilierea confirmă | nu |
| `in_apel` cu lease expirat | crash după `apel_incepe` | `necunoscut` | **nu** |
| `necunoscut` | reconciliere: găsit și potrivit | `trimis` (`reconciliat = true`) | — |
| `necunoscut` | 0 găsite după 30 min / 24 h / mai multe / nepotrivire | rămâne `necunoscut`, „de decis” (owner) | nu |
| decizia owner-ului | „nu a plecat” | `esuat_confirmat`; retrimiterea = mesaj nou, aprobare nouă | — |

- **Ritm**: maximum 1 mesaj / 2 s, maximum 50 / invocare. UI-ul reia până se golește coada.
- `429` / `5xx` repetate (≥ 3 într-o oră) sau „sending limit exceeded” → `trimitere_oprita = true` automat + motiv. O repornește doar owner-ul.

### 1.4 Reconcilierea și monitorizarea SENT
**Reconcilierea rândurilor `necunoscut`** (din `redari-mail-citeste`, care are tokenul de citire; trimiterea nu poate citi)
- Pornire: la fiecare rulare de cron (doar citește SENT și mută starea, nu trimite) + manual (owner / admin).
- `messages.list?q=in:sent rfc822msgid:<Message-ID>`, **paginat complet**, apoi `messages.get?format=full` pe fiecare candidat.
- **Potrivire = toate**:
  - exact un candidat;
  - **un singur** antet `Message-ID`, identic octet cu octet;
  - **un singur** `To`, egal cu `catre`; fără `Cc`, fără `Bcc` (noi nu le punem niciodată);
  - `Subject` identic cu `subiect_final`;
  - **hash-ul recalculat din candidat** = `mesaj_sha256`: se decodează părțile MIME ale copiei din SENT (`text/plain`, `text/html`, **toate** atașamentele, descărcate cu `attachments.get` și hash-uite), se construiește forma canonică (§1.3) și se compară. Valoarea `h=` din `X-Gazpet-Redari` nu contează la decizie (un antet copiat nu dovedește conținutul);
  - manifestul complet al atașamentelor identic (număr, nume, mime, mărime, sha256): nici în plus, nici lipsă;
  - `internalDate ≥ apel_inceput_la − 5 min`.
  - Orice nepotrivire sau imposibilitate de verificare → rămâne `necunoscut`, cu `conflict_reconciliere = true` și motivul.
  - Test: antete și atașament identice, corp modificat → conflict + alertă.
- Rezultat: `fn_red_mail_reconciliaza` (CAS pe `necunoscut`) → `trimis` + `trimis_la`. Căutarea fără rezultat **nu** e dovadă că mesajul n-a plecat: retrimiterea rămâne decizia omului.

**Monitorizarea SENT (separată)** — prinde mesajele trimise din `redari@` fără rând în ERP (token scurs sau trimitere manuală din Gmail):
- Rândul `sent` din `red_mail_flux` (§1.1), cu stare proprie: `startHistoryId` fix, CAS pe lease-ul lui, la `404` scanare `in:sent after:<epoch − 3600>` cu cursor capturat înainte, `labelId = SENT`. Pornit la activarea F2, fără scanare retroactivă.
- Fiecare mesaj nou din SENT se clasifică:
  | Caz | Eveniment + alertă către owner |
  |---|---|
  | niciun rând `red_mail_mesaje` cu acel `Message-ID` / id `X-Gazpet-Redari` | `trimis_in_afara_erp` |
  | identificatori cunoscuți, dar hash-ul recalculat ≠ `mesaj_sha256` | `trimis_modificat` (identificatori refolosiți, conținut diferit) |
  | al doilea mesaj din SENT pentru același rând ERP | `trimis_duplicat` |
  | identificatori cunoscuți, conținut identic | fără alertă; dacă rândul e `necunoscut`, intră în reconciliere |
  Evenimentele conțin doar `gmail_id_hmac`, id-ul rândului ERP și data, fără destinatar sau subiect (metadate pseudonimizate, §1.8).
- Regula de operare: din `redari@` nu trimite nimeni manual din Gmail. Orice excepție apare ca alertă și o explică owner-ul.

### 1.5 Momentul juridic: e-mailul nu înlocuiește poșta cu AR (*implicit (j)*, Jak r4 P1-02)
Codul existent tratează orice convocare activă cu `data_expediere` ca „expediată”, indiferent de canal: `stare.js` (pasul 9 → `EXPEDIAT_ASTEPTAM_AR`), `exportXlsx.js` (`randRegistru` ia cea mai recentă convocare, fără filtru de canal) și `red_v_stare_parcela` (aceeași lipsă). De aceea r5 nu mai pune convocarea pe e-mail în `red_convocari`. Garanția e **prin construcție + trigger + teste**:
- **Unde stă convocarea pe e-mail**: doar în `red_mail_mesaje` (`tip = 'convocare'`), cu număr propriu `M-nnnn` (cheia `M` din `red_numere`), stare proprie (`in_coada` … `trimis` / `necunoscut` / `esuat_*`, §1.3) și `trimis_la` scris atomic doar la succes confirmat (direct sau prin reconciliere). Legătura cu convocarea poștală, dacă există, e `convocare_postala_id` (referință, fără efect asupra ei).
- **Garanția în BD**: trigger `BEFORE INSERT OR UPDATE` pe `red_convocari` (migrarea F2) care refuză `canal = 'email'` pentru toate rolurile aplicației. Preflight-ul numără rândurile `canal = 'email'` existente (așteptat 0; altfel decizia lui Razvan, §8). Opțiunea „email” dispare din selectorul de canal al convocărilor din UI.
- **Consecința**: niciun consumator existent al `red_convocari` (`stare.js`, `exportXlsx.js` / `ExportEcran.jsx`, `red_v_stare_parcela`, `red_v_centralizator_uat`, `pv.js` / `ModalPv.jsx` — inclusiv reluarea după `data_expediere`, `docx.js`, `PlicuriEcran.jsx`, `FisaParcela.jsx`, `Redari.jsx`, funcțiile SMS care citesc convocările) nu vede convocarea pe e-mail, deci starea juridică a parcelei (convocat / expediat AR / retur / confirmat) nu se schimbă. **Fără modificări** în acești consumatori.
- **Unde se vede e-mailul**: pe fișa proprietarului („Istoric e-mail”, admin / editor) și, opțional, într-o coloană separată „e-mail suplimentar trimis la” în Model_6, adăugată în F2 fără a atinge coloanele poștale (AWB, AR, retur).
- **Teste obligatorii (F2)**, pe `stare.js`, `exportXlsx.js` și `red_v_stare_parcela`, cu ieșirea comparată cu cea fără e-mail: (1) **doar e-mail** trimis → starea rămâne `DE_CONVOCAT` (sau afișare), nu `EXPEDIAT_ASTEPTAM_AR`; (2) **poștă, apoi e-mail** → rândul Model_6 păstrează AWB-ul și AR-ul poștal; (3) **poștă returnată, apoi e-mail** → rămâne `CONVOCARE_RETURNATA`; (4) INSERT direct `red_convocari.canal = 'email'` ca editor → refuz.
- „Trimis” = Gmail a acceptat mesajul. **Nu e livrare și nu e confirmare de primire.** E-mailul e canal suplimentar (decizia 6A): poșta cu AR rămâne obligatorie.

### 1.6 Compunerea MIME sigură
- **Un singur `To`**. Fără `Cc`, fără `Bcc`, fără `Reply-To` diferit de `redari@`.
- Orice valoare de antet cu `CR`, `LF`, `NUL` sau alte caractere de control → **refuz** în BD (la crearea lotului) și din nou în edge.
- Adresa: validare strictă (o singură adresă, fără liste, comentarii sau `<>` în plus, domeniu ASCII / punycode). Aceeași funcție în SQL și TS, cu test de paritate (L19).
- RFC 2047 pentru subiect și nume, corpuri `base64`, delimitatori aleatori, RFC 2231 pentru numele de fișier. `Message-ID: <uuid@gazpet.ro>` generat și salvat înainte. `List-Unsubscribe: <mailto:redari@gazpet.ro?subject=dezabonare>`. `X-Gazpet-Redari` (§1.3).
- Teste: injecție de antete (`\r\nBcc:`), două adrese, ghilimele și diacritice în nume, subiect lung.

### 1.7 Codul din subiect și firul Gmail
- **Format**: `[RED-M-000123-K7Q]` pentru orice mesaj trimis din ERP, inclusiv convocările pe e-mail (`M-nnnn` + 3 caractere de control `HMAC(REDARI_MAIL_REF_SECRET, cod)`, cheia `M` în `red_numere`, §1.5).
- Se recunoaște și numărul convocării poștale tipărit pe plic / convocator (`C-0012`, fără control), ca indiciu slab spre acea convocare. Parsare ancorată (L13), teste pozitive + negative.
- **Firul**:
  - răspunsul din ERP (F3): subiectul = `Re: ` + **subiectul primit, neschimbat**. Fără cod în subiectul primit → codul nu se adaugă în subiect, referința merge pe prima linie a corpului;
  - `threadId`, `In-Reply-To`, `References`.
- **Contactul diferă de expeditor**: implicit, răspunsul pleacă la adresa din contact, ca **mesaj nou** (fără `threadId` / `In-Reply-To`, referința în corp). Pe firul expeditorului doar cu alegerea explicită a owner-ului la aprobare, cu adresa completă afișată. Adresa expeditorului merge doar în `red_mail_adrese_propuse` (§1.11), nu în contact.

### 1.8 Tabele, Storage, retenție
**Tabele noi** (prefix `red_mail_`, RLS, fără DELETE pentru roluri, jurnal doar cu numele câmpurilor):
| Tabel | Felie | Ce ține |
|---|---|---|
| `red_mail_setari` (un rând) | F1 (+ F2) | `citire_activa`, `ultima_eroare_cod`, `retentie_activa` + lease-ul global de retenție (cursoarele stau în `red_mail_flux`); F2: `trimitere_oprita` (implicit `true`), plafoane, `extern_permis` (implicit `false`); `versiune` |
| `red_mail_primite` | F1 | `casuta` + `gmail_id_hmac` + `hmac_versiune` (UNIQUE pe `(casuta, gmail_id_hmac)`, §1.2), `gmail_id` (UNIQUE parțial pe rândurile negolite), `a_fost_asociat` (imuabil odată `true`, §1.8), `test`, `rfc_message_id` (neunic) + `coliziune_message_id`, `raw_sha256` (neunic), `thread_id`, `in_reply_to`, `references_ids`, `de_la_adresa`, `de_la_nume`, `reply_to`, `catre`, `subiect`, `corp_text`, steagurile de decodare, `primit_la` (= `internalDate`), `data_declarata`, `auth_*` + `auth_sursa`, `stare_ingestie` (`in_curs` / `ok` / `neprocesabil`) + `motiv_cod`, indiciile (§1.10), legăturile confirmate, `stare` (`nou` / `asociat` / `rezolvat` / `ignorat`) + `ignorat_la` / `ignorat_de` / `ignorat_motiv`, `verificare` + `verificare_nota` (§1.10), `nota`, `cere_dezabonare`, `inregistrat_in_registru` (§1.10), `retentie_stare` (`activ` / `in_golire` / `golit`), `golire_claim_token` / `_pana`, `blocaj_stare` (`fara` / `cerut` / `activ`) + `retentie_blocata_motiv`, `gmail_id_hmac`, `versiune` |
| `red_mail_obiecte` | F1 | manifestul (§1.2): `primit_id`, `tip` (`eml` / `atasament`), `nr`, `cale`, `nume` curățat, `mime_declarat`, `mime_detectat`, `marime_declarata`, `marime`, `sha256`, `stare` (`asteptat` / `stocat` / `respins_tip` / `respins_marime` / `respins_structura` / `respins_buget` / `conflict_obiect` / `in_stergere` / `sters`), `stergere_autorizata_la` |
| `red_mail_dedup` | F1 | tombstone după ștergerea finală: `casuta`, `gmail_id_hmac`, `hmac_versiune`, `golit_la`; fără expirare calendaristică (§1.2) |
| `red_mail_evenimente` | F1 | ingestie / recuperare / retenție / reconciliere / SENT / descărcări: `tip`, id-uri, numărători, `cod`. Fără adrese, subiecte, nume de fișier sau text. |
| `red_mail_flux` | F1 (rândul `sent` în F2) | starea pe flux, cheie `(casuta, flux)` (§1.1) |
| `red_mail_raspuns_sursa` | F1 | `raspuns_id` (UNIQUE), `tip_sursa` (`gmail_redari` / `manual_verificat` / `gmail_redari_sters`), `primit_id` (obligatoriu la `gmail_redari`), `detinator_id`, **UNIQUE `(primit_id, detinator_id)`**, **`operatie_id` (UUID UNIQUE, generat de UI înainte de primul apel)**, `cerere_sha256` (hash-ul argumentelor, pentru idempotență), `metoda_verificare`, `verificat_de/la`; scris doar de RPC-urile de la §1.10 |
| `red_mail_adrese_propuse` | F1 (folosit și de F1b) | §1.11 |
| `red_mail_oauth_state` | F1 | §2.3 |
| `red_mail_loturi`, `red_mail_mesaje` | F2 | §1.3–1.5; pe mesaj și `tip` (`convocare` / `reamintire` / `informare` / `raspuns_fir`), `nr_document` `M-nnnn`, `convocare_postala_id`, `trimis_la` |
| `red_mail_optout` | F2 | `email` normalizat UNIQUE, `activ`, `motiv`, `sursa`, `primit_id`, `setat_de/la` |
| `red_mail_sugestii` | F4 | §2.5 |

**Storage (bucketul `redari`, schimbare explicită pentru `mail/`)**
- `red_storage_sel` / `red_storage_ins` se modifică să **excludă `mail/`** pentru `authenticated`. Postcondiția migrării verifică faptul că nicio politică pentru `authenticated` / `anon` nu acoperă `mail/`.
- INSERT și DELETE pe `mail/`: doar `service_role` (citirea, respectiv retenția). Promisiunea „fișiere imutabile” din README rămâne pentru restul bucketului și se amendează explicit pentru `mail/`.
- **Descărcarea: proxy edge, nu URL semnat** (Cop P2-04). `redari-mail-fisier`, cu `obiect_id` (contractul de identitate la §2.4):
  1. RPC `fn_red_mail_fisier_autorizeaza(obiect_id)`, **apelat cu clientul utilizatorului** (JWT-ul lui, deci `auth.uid()` = utilizatorul final): verifică nivelul (`.eml` doar owner / admin; atașament owner / admin / editor), faptul că obiectul e `stocat` și aparține unui mesaj vizibil apelantului, `retentie_stare = 'activ'`, și scrie evenimentul `descarcare` (cine, ce obiect, fără nume);
  2. edge-ul citește obiectul prin `descarcaCuJurnal` (monitorul de egress: blocare + jurnal de octeți) și îl întoarce în flux cu `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename*=…`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
  - Fiecare transfer trece prin proxy, deci fiecare descărcare e jurnalizată, nu doar emiterea unui link. Nu există URL refolosibil.

**Retenția: `redari-mail-retentie`** (F1, livrată oprită, fișa la §2.4)
- **Ce e eligibil pentru golire automată** (*implicit (e)*, Cop r3 P1-01). Toate termenele se socotesc după `primit_la` = `internalDate`, niciodată după `Date`:
  | Categorie | Regula |
  |---|---|
  | `ignorat` (spam / irelevant), **marcat de owner / admin, cu motiv**, pe un mesaj care n-a fost niciodată asociat (*implicit (i)*) | golire automată la **90 de zile** de la `ignorat_la` (nu de la primire: un mesaj marcat ignorat în ziua 89 nu dispare a doua zi), dacă nu e blocat |
  | `nou` / „de triat” (neasociat, netriat) | **niciodată golit automat**. Alertă către responsabilul numit pentru triere (§2.7 punctul 6) la **60 de zile** („de triat vechi”), repetată săptămânal, cu escaladare la owner; rămâne până îl clasifică un om. Alerta **nu** e termen de retenție și nu se prezintă ca atare (Jak r5 P2-05) |
  | `neprocesabil` | **niciodată golit automat**. Circuit manual: admin-ul îl verifică (originalul e încă în Gmail) și îl marchează `ignorat` sau îl asociază manual prin `fn_red_mail_asociaza_neprocesabil` (§1.10) |
  | `asociat` / `rezolvat` (corespondența unui proprietar) | **fără golire automată**: urmează retenția din `text_gdpr`. La termenul `red_proiecte.retentie_mail_pana` (fixat de owner) panoul îl propune la golire, iar golirea se face ca operație pe date reale (pct. 3: preview → „da” → apply), nu de cron |
  | mesajele trimise (`red_mail_mesaje`) | ca `asociat`: la termenul proiectului, golire doar cu „da”, prin `fn_red_mail_lot_goleste`, și doar dacă lotul e `incheiat`, reconcilierea s-a încheiat pentru toate mesajele (niciun `in_apel` / `necunoscut`) și inventarul fișierelor are antet complet, cu numărătoare și hash verificate (§1.3); ștergerea finală a rândurilor doar prin `fn_red_mail_lot_sterge_final` (§1.3), singura cale de DELETE, cu aceleași condiții plus termen trecut și „da”; **întâi** fișierele exclusive din inventar, confirmate absente, **apoi** evidența; fișierele partajate (convocatorul poștal) rămân sub politica lor; la eșec evidența rămâne și operația se reia pe inventar |
  | `ignorat` → `redeschide` | termenul de 90 de zile se anulează; la o nouă marcare pornește din nou |
  Regula se poate schimba doar printr-o decizie explicită a lui Razvan, cu validarea Juridic a termenului.
- **Invariantul „corespondența juridică nu se golește automat”** (*implicit (i)*, Jak r4 P1-01, Cop r4 P2-01), impus în BD:
  - `a_fost_asociat` (boolean, **imuabil odată `true`**, setat de trigger la prima asociere confirmată) și `are_legatura_juridica` (calculat: `a_fost_asociat` OR există rând în `red_mail_raspuns_sursa` OR o adresă confirmată din acest mesaj OR legătură cu `red_corespondenta`);
  - `fn_red_mail_ignora(primit_id, motiv, versiune)`: **doar owner / admin**, motiv obligatoriu (nevid, ≤ 500), refuză dacă `are_legatura_juridica` (inclusiv după `redeschide` al unui asociat). Editorul nu poate marca `ignorat`; un trigger `BEFORE UPDATE` refuză orice altă cale spre `stare = 'ignorat'`;
  - `fn_red_mail_golire_incepe` și `fn_red_mail_golire_poate` **re-verifică sub lock** că mesajul e `ignorat` și fără legătură juridică; altfel raportează `neeligibil_asociat` și nu ating nimic;
  - test: mesaj asociat + răspuns înregistrat → încercare de `ignorat` ca editor (refuz) și ca admin (refuz) → asociat, `redeschide`, `ignorat` (refuz) → la 91 de zile conținutul intact, cronul raportează `neeligibil_asociat`.
- **Două categorii de date** (Cop r3 P2-05). Golirea înseamnă **ștergerea conținutului**, nu anonimizare completă:
  1. **Conținutul corespondenței** (text, adrese, nume de fișier, fișiere, note libere): se golește la regula de mai sus.
  2. **Metadatele de audit** (`id`, `primit_la`, stările, autorii pașilor, legătura cu deținătorul / parcela, evenimentele): rămân, pentru că documentează ce a făcut ERP-ul cu o corespondență juridică. Temeiul: interesul legitim al operatorului / obligația de evidență din contract (de confirmat cu Juridic). Termen: `retentie_mail_pana` al proiectului, apoi ștergerea completă a rândului, ca operație cu „da” (*implicit (f)*).
  - La golire, `gmail_id` și `thread_id` brute devin NULL; rămâne `gmail_id_hmac` (calculat de la ingestie, §1.2), care ține dedup-ul. Pseudonimizare, nu anonimizare. După ștergerea finală a rândului rămâne doar tombstone-ul din `red_mail_dedup` (§1.2).
  - **Proveniența minimă a răspunsurilor** (Jak r4 P2-07): `red_mail_raspuns_sursa` **nu se șterge** cât timp există rândul `red_raspunsuri` (care urmează retenția Registrului). La ștergerea finală a auditului mesajului, `primit_id` devine NULL și `tip_sursa = 'gmail_redari_sters'`; triggerele de protecție (§1.10) verifică existența rândului de sursă, deci rămân active.
- **Inventarul la nivel de coloană** (Jak r3 P2-02). Ce se golește:
  | Tabel | Coloane golite (→ NULL) | Ce rămâne |
  |---|---|---|
  | `red_mail_primite` | `corp_text`, `subiect`, `de_la_adresa`, `de_la_nume`, `reply_to`, `catre`, `rfc_message_id`, `in_reply_to`, `references_ids`, `raw_sha256`, `data_declarata`, `gmail_id`, `thread_id` (→ `gmail_id_hmac`), **`verificare_nota`**, **`ignorat_motiv`**, **`nota`**, indiciile (liste de id-uri) | stări, date, autori, legătura confirmată |
  | `red_mail_obiecte` + Storage | obiectele șterse; `nume`, `sha256`, `cale` | `tip`, `marime`, `stare = 'sters'` |
  | `red_mail_mesaje` (trimise) | `catre`, `subiect_final`, `corp_text_final`, `corp_html_final`, **`antete_snapshot`**, `atasament_nume`, `rfc_message_id` (excepția din triggerul de imuabilitate, §1.3) | stări, `mesaj_sha256`, datele, `convocare_postala_id`; fișierul convocatorului rămâne pe convocarea poștală, cu retenția ei |
  | `red_mail_adrese_propuse` | `email`, `nota` | starea, sursa, datele |
  | `red_mail_optout` | `motiv` (text liber); adresa rămâne cât timp opt-out-ul e activ (fără ea opt-out-ul nu funcționează) | |
  | `red_mail_sugestii` (F4) | `fragmente`, `categorie` | costul |
  | blocajul legal | `retentie_blocata_motiv` rămâne cât timp blocajul e activ; se golește la ridicarea lui, odată cu restul | |
  | `red_mail_evenimente` | nimic la golire. Conțin **metadate pseudonimizate** (Cop r4 P3-01, Jak r4 P2-07): `gmail_id_hmac` (niciodată `gmail_id` brut), id-uri ERP, date, numărători, uid-ul autorului unui pas. Fără adrese, subiecte, text, nume de fișier | se șterg la ștergerea finală a auditului mesajului (`retentie_mail_pana`); evenimentele fără mesaj (numărători de spam, rulări) la 1 an (*implicit (f)*) |
  | `red_jurnal` (`red_mail_*`) | doar numele câmpurilor + `user_id` / `user_email` ale **angajatului** care a făcut pasul (jurnalul existent `fn_red_jurnal`) | identificatorii angajaților urmează regula jurnalului Redări existent (append-only); nu conțin date ale proprietarilor; menționat în informarea angajaților |
  | `red_raspunsuri` | nimic: fără text din mail (§1.10) | |
  | backup-urile Supabase (PITR / zilnice) | nu se șterg selectiv; ies la rotația lor (durata de verificat, §8), notată în informare | |
  | căsuța Gmail | politică în Google Vault, aliniată (manual, Razvan); ERP-ul nu poate șterge din Gmail | |
- **Adrese propuse — termen propriu** (*implicit (f)*), indiferent dacă au `primit_id` sau vin din formular (`primit_id = NULL`): `propusa` neconfirmată → `email` și `nota` golite după **180 de zile** de la `propus_la`; `respinsa` → după **30 de zile** de la respingere. Acestea se golesc automat (sunt date nevalidate, nu corespondență); rândul rămâne pentru audit.
- **Mașina de stări și blocajul legal** (Cop r3 P2-01):
  - Stări: `activ → in_golire → golit`. Rândurile fără obiecte trec direct prin `fn_red_mail_goleste` (o tranzacție).
  - **Lease global de retenție** (`red_mail_setari.retentie_lease_*`): o singură rulare de retenție la un moment dat.
  - **Claim exclusiv per mesaj**: `fn_red_mail_golire_incepe(primit_id)` ia `FOR UPDATE`, refuză dacă `blocaj_stare` ≠ `fara` sau dacă eligibilitatea nu mai e îndeplinită, apoi scrie `in_golire` + `golire_claim_token` + `golire_claim_pana` + lista exactă de obiecte. Un mesaj cu claim activ nu poate primi alt claim.
  - Obiectele se șterg **secvențial**. Înainte de FIECARE `DELETE`, `fn_red_mail_golire_poate(primit_id, obiect_id, claim_token)` (`FOR UPDATE`) verifică claim-ul propriu, `blocaj_stare = 'fara'`, starea obiectului și **faptul că niciun alt obiect al mesajului nu e `in_stergere`**, apoi marchează obiectul `in_stergere` (valoare din enumul manifestului, §1.8) cu `stergere_autorizata_la`. Răspuns negativ → oprire; rândul revine în `activ` cu obiectele rămase.
  - **Recuperarea unui obiect `in_stergere`** (Jak r4 P2-01): dacă claim-ul a expirat (worker suspendat), noul worker **nu autorizează niciun alt obiect al mesajului** până nu clarifică obiectul `in_stergere`. Clarificarea se face după o perioadă de grație (Jak r5 P3-01) = **durata maximă a unui worker Supabase + 10 minute**, socotită de la `stergere_autorizata_la` (timeout-ul de 30 s al unui `DELETE` nu ajunge: un worker suspendat poate relua `DELETE`-ul până la limita lui de durată, ~400 s pe planurile plătite); valoarea exactă se citește din documentația Supabase și se notează în plan (§8): Storage confirmă că obiectul lipsește → `sters`; există încă → `stocat` din nou. Abia apoi se poate da un claim nou, dacă blocajul și eligibilitatea o mai permit.
  - **Blocajul are două stări** (`blocaj_stare`): `fn_red_mail_blocaj_seteaza` (owner / admin, același `FOR UPDATE`) setează imediat `cerut` și oprește orice autorizare nouă. Dacă niciun obiect al mesajului nu e `in_stergere`, trece direct în `activ`; altfel rămâne `cerut` până la clarificarea acelui obiect, apoi `activ`. UI-ul arată: „blocaj cerut — X obiecte deja șterse, 1 în ștergere” / „blocaj activ, nicio operație în curs”.
  - Garanția, demonstrabilă și în scenariul cu worker întârziat: în orice moment există **cel mult un obiect autorizat la ștergere pe mesaj** (verificarea „niciun alt `in_stergere`” e sub `FOR UPDATE` pe mesaj), deci după `cerut` se mai poate șterge cel mult acel obiect. Niciun claim nou nu se mai dă.
  - Asocierea, verificarea sau înregistrarea unui răspuns pe un rând `in_golire` / `golit` e refuzată.
  - `fn_red_mail_golire_confirma(claim_token)`: golește coloanele doar pentru obiectele confirmate șterse (Storage confirmă că nu mai există), apoi `golit`. Eșec la mijloc → `in_golire` până la expirarea claim-ului, apoi reluat.
  - Teste obligatorii (barieră, L25): două procese de retenție + un admin care cere blocajul, intercalate; **worker A autorizat pe X și suspendat → claim expirat → worker B preia mesajul → B nu poate autoriza Y cât X e `in_stergere` → admin cere blocajul → A își termină `DELETE`-ul pe X, iar nimic altceva nu se șterge**.

### 1.9 Limite și plafoane
- **Citire**: §1.1 (secvența și plafoanele de octeți).
- **Trimitere, limitele Google** (de verificat pe „Gmail sending limits” înainte de F2): ~2.000 de mesaje / zi / utilizator, ~3.000 de destinatari externi unici / zi; depășirea suspendă trimiterea până la 24 h.
- **Plafoanele proprii** (decizia 7A): **200 / zi, 1.000 / lună, maximum 300 / lot**, plus maximum 1 `reamintire` / destinatar / 24 h.
  - Ferestrele sunt **calendaristice în `Europe/Bucharest`**: ziua = data locală a lui `rezervat_la`, luna = luna calendaristică locală (nu fereastră mobilă), prin helperul existent de oră RO (L17).
  - **Contabilizarea** se face la rezervare, pe `(mesaj_id, rezervare_nr)`. Se numără `rezervat`, `in_apel`, `trimis`, `necunoscut`, `esuat_*`. Doar mesajele care n-au intrat în apel eliberează locul: întoarcerea în coadă (lease expirat înainte de `apel_incepe`, `apel_neefectuat`) și trecerea `in_coada` / `rezervat → anulat` la încheierea lotului (§1.3).
  - **Locul definitiv în plafon se ia la `apel_incepe`, pe ziua apelului** (Cop r6 P2-03, Cop r13 P2-04): rezervarea doar verifică și ține un loc provizoriu; sub lock-ul pe `red_mail_setari` (ordinea globală, §1.3), `apel_incepe` recalculează ziua și luna **curente** (`Europe/Bucharest`) și ia locul definitiv în fereastra lor (dacă diferă de ale rezervării, locul provizoriu se eliberează). Fereastra plină → `rezervat → in_coada` (pe un lot activ; pe un lot `incheiat` / `blocat_integritate` → `anulat`), fără apel. **Autorizarea e legată de aceeași zi**: `apel_incepe` întoarce `apel_valabil_pana` = minimul dintre `now() + 60 s` și sfârșitul zilei curente la București. Edge-ul face refresh-ul de token (timeout 15 s) și `send` **doar dacă** ceasul lui e încă înainte de `apel_valabil_pana`; altfel nu trimite și apelează `fn_red_mail_apel_renunta(id, lease_token)`: `in_apel → in_coada` (`apel_expirat`, pe un lot activ; pe un lot `incheiat` / `blocat_integritate` → `esuat_sigur`), locul eliberat, iar mesajul reia de la rezervare, cu reverificarea pe ziua nouă. Plafonul e astfel garantat pe ziua în care începe `send`. Teste: rezervare la 23:59:59 pe 30.11, `apel_incepe` la 00:00:01 pe 01.12, cu decembrie plin / liber; `apel_incepe` la 23:59:50 și refresh care durează peste miezul nopții → nicio trimitere, `apel_expirat`, reverificare pe ziua nouă; la fel la schimbarea lunii.
  - **Lot de 300 cu plafon de 200 / zi**: lotul se poate aproba. Rezervarea se oprește la plafon, restul rămâne `in_coada`, iar UI-ul arată „plafon zilnic atins, continuă mâine”. Continuarea cere din nou pornirea manuală, în fereastra de 7 zile a aprobării.
- **Kill-switch**: `trimitere_oprita` (implicit `true`), `citire_activa` (implicit `false`), `retentie_activa` (implicit `false`), doar owner. Oprirea ocolește orice cotă (L20).
- **Mod test**: cât timp `extern_permis = false`, orice destinatar în afara `@gazpet.ro` (potrivire exactă de domeniu) e refuzat în BD.

### 1.10 Asocierea, verificarea și intrarea în Registru
**Indicii, calculate toate** (`fn_red_mail_indicii`, o definiție, L19): fir (din F2), cod (+ forma), expeditor (pot fi mai mulți deținători), `conflict_indicii`, `expeditor_diferit`, `reply_to_diferit`, autentificarea (§2.6). Niciun indiciu → „de triat”.

**Stările** (doar omul), ca predicate pe ambele coloane (Jak r6 P2-03): `stare` ∈ {`nou`, `asociat`, `rezolvat`, `ignorat`} (triere) și `stare_ingestie` ∈ {`in_curs`, `ok`, `neprocesabil`} (ingestie) sunt independente. Tranzițiile permise sunt exact: `nou → asociat` (cere `stare_ingestie = 'ok'`; cu conflict, alegere explicită; setează `a_fost_asociat = true`, definitiv), `asociat → rezolvat`, `rezolvat → asociat` (redeschide), `nou → ignorat` (cere `stare_ingestie` ∈ {`ok`, `neprocesabil`} **și** `NOT are_legatura_juridica`; doar owner / admin, cu motiv, *implicit (i)*, §1.8), `ignorat → nou` (redeschide), și **`nou → asociat` pentru un mesaj `neprocesabil`** (Cop r13 P2-01) doar prin `fn_red_mail_asociaza_neprocesabil(operatie_id, primit_id, detinator_id, nota_verificare, versiune)`: owner / admin, după verificarea originalului în Gmail, `nota_verificare` obligatorie (nevid, ≤ 500), eveniment `asociere_manuala`; niciodată automat. Un mesaj `neprocesabil` asociat nu intră în Registru prin `fn_red_mail_inregistreaza_raspuns` (care cere `ok`); răspunsul lui se înregistrează prin `fn_red_mail_inregistreaza_raspuns_manual`. Un mesaj `in_curs` nu își schimbă `stare`. Orice altă pereche e refuzată de trigger. Test: `conflict_obiect` → verificare admin → asociere manuală reușită; aceeași asociere ca editor sau fără notă → refuz.

**Verificarea identității**: `verificare` = `neverificat` (implicit) / `verificat_telefon` / `verificat_semnatura` / `verificat_prezenta` / `verificat_alt` + autor + notă, prin `fn_red_mail_verifica` (admin / editor).

**Intrarea în Registru** (*implicit (d)*) — contractul pentru toți consumatorii:
- **Un răspuns din mail intră în `red_raspunsuri` doar după verificare**, printr-un singur RPC atomic: `fn_red_mail_inregistreaza_raspuns(operatie_id, primit_id, detinator_id, optiune, zi, metoda_verificare, nota, confirma_mai_vechi, versiune)` (semnătura completă, Cop r6 P3-02). În aceeași tranzacție:
  - `FOR UPDATE` pe rândul `red_mail_primite` (L01: serializează apelurile concurente pe același mesaj);
  - verifică faptul că mesajul e `asociat`, `ok`, `retentie_stare = 'activ'`, condiția pozitivă **`casuta = 'redari@gazpet.ro' AND test IS FALSE`** (Cop r6 P2-02, Cop r13 P2-03: un mesaj din căsuța de test nu ajunge niciodată în Registru; `NULL` nu trece), iar `detinator_id` e deținătorul asociat (sau unul din coproprietarii aceleiași parcele, confirmați la asociere);
  - setează `verificare` (dacă nu era) cu metoda dată;
  - inserează `red_raspunsuri` (`canal = 'email'`) + `red_mail_raspuns_sursa`.
  - **`red_raspunsuri.data` = `primit_la` al mailului** (`internalDate`, **momentul primirii mesajului la Google**, Jak r6 P3-01; nu e dovada momentului în care proprietarul l-a scris sau trimis), pus de RPC, **nu `now()`** și nu din argumente (Jak r5 P2-04). Un mesaj vechi înregistrat târziu nu devine astfel „ultimul răspuns” doar prin momentul înregistrării;
  - dacă deținătorul are deja în `red_raspunsuri` un răspuns cu `data` mai recentă, RPC-ul refuză (`raspuns_mai_vechi`) până la confirmarea explicită a operatorului („răspuns mai vechi decât cel curent”, `confirma_mai_vechi = true`). Și confirmat, rândul nu schimbă rezultatul centralizării (`ultimulRaspuns`, starea, PV, Model_6 rămân pe răspunsul mai recent). Test: inclusiv pe mesajele din importul istoric (§1.1), răspuns vechi înregistrat după unul nou → refuz, apoi confirmat → starea parcelei neschimbată;
  - **Ordinea canonică a răspunsurilor** (Cop r6 P2-04, Jak r13 P3-01): „ultimul răspuns” al unui deținător = **regula existentă din `src/redari/stare.js` (`ultimulRaspuns`), neschimbată**: cheia `(data, seq, created_at, poziția în listă)` comparată lexicografic, cea mai mare câștigă; `data` sau `created_at` invalide = −∞, `seq` lipsă = −∞. Pentru răspunsurile din mail, `data` = `primit_la`; pentru cele manuale, ziua introdusă la 00:00 București (*implicit (p)*). F1 verifică faptul că SQL (`red_v_stare_parcela` și ce depinde de ea, `fn_red_formular_public` / `fn_red_raspuns_public`), `pv.js` și exportul (`exportXlsx.js`) folosesc aceeași cheie; un consumator care diferă se aliniază la `stare.js` (fără schimbarea regulii). Preflight F1: numărul perechilor de răspunsuri cu aceeași `data` per deținător (doar numărătoare). Teste: răspuns de mail vechi inserat **ultimul**, după unul mai nou → toți consumatorii aleg tot pe cel mai nou; două răspunsuri cu aceeași `data` → câștigă `seq` mai mare, ca azi; răspuns manual și mail din aceeași zi → mailul (oră > 00:00) e cel mai recent.
- **Idempotența și cardinalitatea** (Jak r3 P2-01, Cop r3 P2-02):
  - un mesaj poate privi mai mulți deținători (coproprietari care scriu împreună), dar **cel mult un răspuns per (mesaj, deținător)**: `UNIQUE (primit_id, detinator_id)` în `red_mail_raspuns_sursa`;
  - `cerere_sha256` = hash peste **toate** argumentele cu efect sau audit (Cop r6 P3-01), în forma canonică (JSON RFC 8785, texte NFC fără spații la capete): `primit_id`, `detinator_id`, `optiune`, `zi`, `metoda_verificare`, `nota`, `confirma_mai_vechi` (la RPC-ul manual, în loc de `primit_id`: `data_raspuns`, `motiv_data`). Excluse doar câmpurile pur operaționale: `operatie_id` (cheia) și `versiune`;
  - **reluare identică** (același `cerere_sha256`, de ex. după timeout) → RPC-ul întoarce `raspuns_id`-ul existent, fără al doilea rând;
  - **cerere diferită** pe aceeași pereche → eroare `conflict_raspuns_existent` (corectarea urmează procedura de la §8);
  - test: două apeluri concurente reale (barieră, L25) → un rând; reluare după timeout → același `raspuns_id`; cerere diferită → conflict; același `operatie_id` cu altă `nota` sau alt `confirma_mai_vechi` → `conflict_operatie`.
- **Textul din mail nu se copiază**: `obiectii_text` primește doar o referință fixă, pusă de RPC (`Obiecții transmise pe e-mail — mesajul RED-…; textul în 📥 Mesaje`). Așa, `red_raspunsuri`, jurnalul lui (`fn_red_jurnal` copiază valorile) și istoricul din `FisaParcela.jsx` nu conțin conținut de mail. Triggerul de validare existent (obiecții ⇒ text nevid) e satisfăcut.
- **Proveniența și conținutul protejate în BD** (L07, Jak r3 P1-01):
  - **constraint trigger `DEFERRABLE INITIALLY DEFERRED`** pe `red_raspunsuri`: la commit, orice rând **nou** `canal = 'email'` trebuie să aibă rândul `red_mail_raspuns_sursa`. Un INSERT direct prin PostgREST (tranzacție proprie, fără sursă) e refuzat. Fără GUC-uri (L08);
  - trigger `BEFORE UPDATE` pe `red_raspunsuri`: `canal` nu se poate schimba nici spre `email`, nici dinspre;
  - **trigger `BEFORE UPDATE` pentru rândurile care au sursă e-mail** (`EXISTS` în `red_mail_raspuns_sursa`): orice schimbare a `optiune`, `data`, `zi_sesiune_aleasa`, `obiectii_text`, `declaratie_confirmata`, `semnatura_electronica_ref`, `detinator_id`, `created_by`, `created_at` e **refuzată**, pentru toate rolurile aplicației. `obiectii_text` trebuie să rămână egal cu referința fixă (verificat și la INSERT). Drepturile UPDATE existente ale editorului (`red_raspunsuri_upd`) rămân pentru celelalte răspunsuri, dar nu ating rândurile din mail;
  - `red_mail_raspuns_sursa`: fără drepturi de scriere pentru roluri, doar prin RPC; nu are DELETE;
  - test obligatoriu: PATCH direct ca editor pe **fiecare** câmp protejat → refuz, rândul neschimbat, niciun rând nou în `red_jurnal` cu valoarea încercată.
- **Răspunsurile `email` preexistente și cele venite pe alt circuit** (Cop r3 P2-03):
  - preflight-ul migrării F1 numără rândurile `red_raspunsuri` cu `canal = 'email'` și le listează (id + dată, fără text) în raportul DRY. Constraint trigger-ul verifică doar rândurile **inserate după** migrare, deci cele vechi nu sunt blocate și nu devin „importate din Gmail”;
  - dacă numărul e > 0, migrarea nu le atinge. Tratarea lor (lăsate ca atare sau marcate `manual_verificat`) e decizia lui Razvan, ca operație pe date reale (§8);
  - un e-mail primit pe alt circuit (de ex. în căsuța unui angajat) se înregistrează prin `fn_red_mail_inregistreaza_raspuns_manual(operatie_id, detinator_id, optiune, zi, metoda_verificare, nota, data_raspuns, motiv_data, confirma_mai_vechi, versiune)` → `tip_sursa = 'manual_verificat'`, `primit_id = NULL`, aceleași protecții. **`data` la înregistrarea manuală** (*implicit (p)*, R6-03, completat după Jak r13 P2-04): argumentul `data_raspuns` e de tip `date` și se interpretează ca **dată civilă în `Europe/Bucharest`**; e obligatoriu și ≤ `(now() AT TIME ZONE 'Europe/Bucharest')::date`, cu `motiv_data` obligatoriu (nevid, ≤ 500). RPC-ul scrie `red_raspunsuri.data` = `(data_raspuns::timestamp AT TIME ZONE 'Europe/Bucharest')` (ziua la 00:00 ora București), o singură conversie, iar în `red_mail_raspuns_sursa` păstrează `data_raspuns` și `motiv_data` (`primit_id` și deci `primit_la` sunt NULL la manual). Aceeași regulă `raspuns_mai_vechi` / `confirma_mai_vechi` și aceeași ordine canonică. Test: răspuns manual și răspuns din mail în aceeași zi, plus data de azi la 23:59 / 00:01 ora București → `≤ azi` corect. **Idempotența** (Cop r4 P3-02): ambele RPC-uri primesc `operatie_id` (UUID generat de UI înainte de primul apel și refolosit la reluare, L04); `UNIQUE (operatie_id)` + `cerere_sha256`: reluare identică → același `raspuns_id`; același `operatie_id` cu argumente diferite → `conflict_operatie`. Test: timeout după commit + reluare → un singur rând. Conținutul acelui mail nu intră în ERP; se recomandă redirecționarea lui către `redari@`.
- **După înregistrare, asocierea și verificarea mesajului se îngheață** (trigger). Corectarea unei atribuiri greșite **nu** e în F1: e operație pe date reale (pct. 3, preview → „da” → apply) până la o felie dedicată de anulare a răspunsurilor (§8).
- **Consumatorii existenți nu se schimbă** și nu au nevoie de o regulă „neverificat”: prin construcție, în `red_raspunsuri` nu există răspunsuri de mail neverificate. Un mail neverificat nu poate înlocui un răspuns verificat (nu ajunge în `ultimulRaspuns`) și nu poate intra în PV, Model_6, starea parcelei sau `deja_raspuns`. Un răspuns de mail verificat se comportă ca orice răspuns înregistrat de operator (e verificat).
- **PV**: obiecțiile din PV le transcrie operatorul în documentul PV (act juridic, cu vizibilitatea existentă a PV-urilor), ca acțiune explicită. ERP-ul nu copiază automat textul mailului în PV.

### 1.11 Adrese propuse (F1b și din mailuri) — *implicit (a)*
- Tabelul `red_mail_adrese_propuse`: `detinator_id`, `email` normalizat, `sursa` (`formular_public` / `mail_primit`), `primit_id` (dacă e cazul), `propus_la`, `stare` (`propusa` → `confirmata` | `respinsa`), `confirmat_de/la`, `metoda_verificare`, notă. Vizibil doar admin / editor.
- **Formularul public (F1b) scrie DOAR aici**, niciodată în `red_detinatori_contact`. Deținerea linkului nu dovedește identitatea sau controlul asupra adresei.
- **Confirmarea — contractul complet** (Jak r13 P2-01, Cop r13 P2-02): `fn_red_mail_adresa_confirma(operatie_id, propunere_id, metoda_verificare, email_contact_asteptat, inlocuieste_existent, versiune)`, după verificarea pe alt canal (telefon / prezență / procedura aprobată de Juridic, §8).
  - **Cine**: admin / editor Redări (nivelul recalculat în RPC, L08).
  - **Precondiții**, verificate după lock (`FOR UPDATE` pe propunere, apoi pe rândul `red_detinatori_contact`): propunerea e `propusa`; `metoda_verificare` ∈ enumul de la §1.12; dacă `sursa = 'mail_primit'`, mesajul sursă are `casuta = 'redari@gazpet.ro' AND test IS FALSE`; `email` curent din contact = `email_contact_asteptat` (NULL = contact gol) — altfel `contact_schimbat` (contactul s-a schimbat între afișare și confirmare); dacă contactul are deja altă adresă, `inlocuieste_existent = true` e obligatoriu — altfel `alegere_necesara`.
  - **Efecte**, într-o tranzacție: propunerea → `confirmata` (`confirmat_de` / `_la`, `metoda_verificare`); `red_detinatori_contact.email` = adresa propusă; jurnal (`fn_red_jurnal`, doar numele câmpurilor); celelalte propuneri `propusa` ale aceluiași deținător rămân neatinse.
  - **Idempotența**: `confirmare_operatie_id` (UUID, `UNIQUE`) și `confirmare_cerere_sha256` pe rândul propunerii; `cerere_sha256` = SHA-256 peste JSON canonic (RFC 8785) `{propunere_id, metoda_verificare, email_contact_asteptat, inlocuieste_existent}`. Reluare cu același `operatie_id` și același hash → rezultatul inițial (`confirmata`), fără a doua scriere; același `operatie_id` cu alt hash, sau propunere deja confirmată de altă operație → `conflict_operatie`.
  - **Erori** (listă închisă): `neautorizat`, `propunere_inexistenta`, `stare_invalida`, `sursa_test`, `metoda_invalida`, `contact_schimbat`, `alegere_necesara`, `conflict_operatie`, `versiune_veche`.
  - Teste: timeout după commit + reluare → un singur efect; contact schimbat între afișare și confirmare → `contact_schimbat`; contact cu altă adresă fără `inlocuieste_existent` → `alegere_necesara`; același `operatie_id` cu altă metodă → `conflict_operatie`; propunere din mesaj de test (`test = true` sau `NULL`, căsuță greșită) → `sursa_test`.
- **Până la confirmare**, adresa nu intră în niciun lot și nu primește nimic (nici mail de confirmare automat: ar fi o trimitere).
- Test obligatoriu: contact gol, token public valid, adresă controlată de altcineva → rând `propusa`, contactul rămâne gol, lotul F2 nu o vede.
- Test (Cop r6 P2-02): mesaj din căsuța de test asociat unui deținător real → `fn_red_mail_inregistreaza_raspuns` și `fn_red_mail_adresa_confirma` refuză, inclusiv prin apel direct la RPC; asocierea unui mesaj `test = true` cu un deținător real e refuzată de trigger.

### 1.12 Schema F1 — inventarul unic (Jak r5 P2-06)
Sursa unică pentru migrarea F1: tabelele, coloanele-cheie, enumurile **complete**, cheile și constrângerile. Celelalte secțiuni descriu comportamentul și trimit aici. **Postcondițiile migrării F1 verifică punct cu punct** fiecare rând de mai jos (existența coloanei, valorile exacte ale fiecărui `CHECK` / enum, fiecare `UNIQUE`, RLS pornit, nicio politică de scriere pentru roluri). Orice element nou în alt paragraf al planului intră și aici, în aceeași revizie. Coloanele F2+ (trimitere, `red_mail_loturi` / `_mesaje` / `_optout`, F4) au inventarul lor la felia respectivă.
| Tabel | Chei și constrângeri | Enumuri (valori complete) | Alte coloane |
|---|---|---|---|
| `red_mail_setari` | un singur rând (`CHECK id = 1`) | — | `citire_activa` (implicit `false`), `ultima_eroare_cod`, `retentie_activa` (implicit `false`), `retentie_lease_token` / `_pana`, `versiune` |
| `red_mail_flux` | PK `(casuta, flux)`; `data_start` imuabil odată scris (trigger) | `flux` ∈ {`inbox`, `sent`, `import`} (`sent` folosit din F2, `import` doar la cerere); `mod_cursor` ∈ {`neinitializat`, `normal`, `recuperare`}; `recuperare_tip` ∈ {`activare`, `cursor_expirat`} sau NULL | `casuta` ∈ {`redari@gazpet.ro`, adresa căsuței de test (*implicit (l)*)}, `history_id` `numeric(20,0)`, `data_start` `timestamptz`, `data_import_de_la` (doar `import`, altfel NULL, `CHECK`), `recuperare_history_id`, `recuperare_page_token`, **`mod_test`** (boolean, `true` doar pe căsuța de test), **`activ`** (boolean, implicit `false`, per rând, Cop r6 P2-01), `lease_token`, `lease_pana`, `versiune` |
| `red_mail_primite` | `UNIQUE (casuta, gmail_id_hmac)` (HMAC peste `(casuta, gmail_id)`); `casuta text NOT NULL`, `test boolean NOT NULL`, `CHECK (test = (casuta <> 'redari@gazpet.ro'))` (Cop r13 P2-03); `UNIQUE (casuta, gmail_id) WHERE gmail_id IS NOT NULL`; index neunic pe `rfc_message_id` | `stare_ingestie` ∈ {`in_curs`, `ok`, `neprocesabil`}; `stare` ∈ {`nou`, `asociat`, `rezolvat`, `ignorat`} (tranzițiile exacte și predicatele pe `stare_ingestie` la §1.10); `verificare` ∈ {`neverificat`, `verificat_telefon`, `verificat_semnatura`, `verificat_prezenta`, `verificat_alt`}; `retentie_stare` ∈ {`activ`, `in_golire`, `golit`}; `blocaj_stare` ∈ {`fara`, `cerut`, `activ`}; `auth_sursa` ∈ {`mx_google`, `necunoscut`}; `eml_absent` ∈ {`prea_mare`} sau NULL | `gmail_id_hmac`, `hmac_versiune`, `gmail_id`, `test`, `a_fost_asociat` (imuabil odată `true`), `motiv_cod`, `primit_la` (= `internalDate`), `data_declarata`, restul coloanelor de la §1.8 |
| `red_mail_obiecte` | FK `primit_id`; `UNIQUE (primit_id, tip, nr)`; `UNIQUE cale` (calea începe cu `mail/<casuta_cod>/`, §1.2) | `tip` ∈ {`eml`, `atasament`}; `stare` ∈ {`asteptat`, `stocat`, `respins_tip`, `respins_marime`, `respins_structura`, `respins_buget`, `conflict_obiect`, `in_stergere`, `sters`} | `cale`, `nume`, `mime_declarat`, `mime_detectat`, `marime_declarata`, `marime`, `sha256`, `stergere_autorizata_la` |
| `red_mail_dedup` | PK `(casuta, gmail_id_hmac)` | — | `hmac_versiune`, `golit_la`, `absent_prima_la` (prima scanare completă fără el, *implicit (n)*); nimic altceva; fără termen de expirare (§1.2) |
| `red_mail_evenimente` | PK `id`; FK opțional `primit_id` | `tip` ∈ (F1, literal, Jak r6 P2-03) {`activare`, `asociere_manuala`, `ingestie_ok`, `ingestie_neprocesabil`, `deja_golit`, `disparut`, `spam_numarat`, `dry_rulat`, `recuperare_inceputa`, `recuperare_terminata`, `lease_pierdut`, `eroare_citire`, `descarcare`, `golire`, `blocaj_cerut`, `blocaj_activ`, `blocaj_ridicat`, `orfane_sterse`, `alerta_de_triat`, `alerta_escaladare`, `oauth_conectat`, `oauth_respins`, `oauth_revocat`, `tombstone_absent`, `tombstone_sters`}; F2 adaugă exact {`reconciliat`, `reconciliere_conflict`, `trimis_in_afara_erp`, `trimis_modificat`, `trimis_duplicat`, `lot_integritate`, `lot_incheiat`, `lot_sters_final`} | `gmail_id_hmac` (niciodată `gmail_id` brut), id-uri ERP, numărători, `cod`, `creat_la` |
| `red_mail_raspuns_sursa` | `UNIQUE raspuns_id`; `UNIQUE (primit_id, detinator_id)`; `UNIQUE operatie_id`; `CHECK (tip_sursa <> 'gmail_redari' OR primit_id IS NOT NULL)`; `CHECK ((tip_sursa = 'manual_verificat') = (data_raspuns IS NOT NULL AND motiv_data IS NOT NULL))` | `tip_sursa` ∈ {`gmail_redari`, `manual_verificat`, `gmail_redari_sters`}; `metoda_verificare` ∈ {`verificat_telefon`, `verificat_semnatura`, `verificat_prezenta`, `verificat_alt`} | `detinator_id`, `cerere_sha256`, `verificat_de` / `_la`, `data_raspuns` (`date`, doar manual), `motiv_data` (doar manual) |
| `red_mail_adrese_propuse` | FK `detinator_id`; FK opțional `primit_id` | `sursa` ∈ {`formular_public`, `mail_primit`}; `stare` ∈ {`propusa`, `confirmata`, `respinsa`} | `email` normalizat, `propus_la`, `confirmat_de` / `_la`, **`respins_de` / `respins_la`** (momentul respingerii, de la care curg cele 30 de zile din §1.8, Jak r6 P2-03; `CHECK`: `respins_la` NOT NULL ⇔ `stare = 'respinsa'`), `metoda_verificare`, `nota`, `confirmare_operatie_id` (`UNIQUE`), `confirmare_cerere_sha256` |
| `red_mail_oauth_state` | `UNIQUE state_sha256` | `scop` ∈ {`citire`, `citire_test` (*implicit (l)*)} în F1; `trimitere` adăugat de migrarea F2 (maparea completă la §2.3) | `owner_id`, `expira_la`, `consumat_la` |
| `red_proiecte` (existent) | — | — | coloana nouă `retentie_mail_pana` |
- `motiv_cod` (`red_mail_primite`) ∈ {`prea_mare`, `structura_invalida`, `decodare_imposibila`, `raspuns_peste_plafon`, `conflict_obiect`, `ingestie_blocata`}: lista închisă din §1.1–1.2, verificată de postcondiții la fel ca enumurile.
- **Semnăturile RPC-urilor cu idempotență** (Cop r6 P3-02): `fn_red_mail_inregistreaza_raspuns(operatie_id, primit_id, detinator_id, optiune, zi, metoda_verificare, nota, confirma_mai_vechi, versiune)`, `fn_red_mail_inregistreaza_raspuns_manual(operatie_id, detinator_id, optiune, zi, metoda_verificare, nota, data_raspuns, motiv_data, confirma_mai_vechi, versiune)`, `fn_red_mail_adresa_confirma(operatie_id, propunere_id, metoda_verificare, email_contact_asteptat, inlocuieste_existent, versiune)` (contractul la §1.11), `fn_red_mail_asociaza_neprocesabil(operatie_id, primit_id, detinator_id, nota_verificare, versiune)`; `operatie_id` UUID generat de UI înainte de primul apel; `cerere_sha256` după regula de la §1.10 (răspunsuri) / §1.11 (confirmare).
- **`are_legatura_juridica`** (Cop r13 P3-01) = funcția `fn_red_mail_are_legatura_juridica(primit_id)` (SQL, `STABLE`, fără argumente de la apelant în afara id-ului), definită literal: `a_fost_asociat` **OR** `EXISTS` în `red_mail_raspuns_sursa` cu acel `primit_id` **OR** `EXISTS` în `red_mail_adrese_propuse` cu acel `primit_id` și `stare = 'confirmata'` **OR** `red_mail_primite.corespondenta_id IS NOT NULL` (legătura cu `red_corespondenta`). Nu e o constatare umană și nu se stochează. Orice `NULL` sau eroare la evaluare = `true` (operația `ignorat` / golire refuzată, fail-closed).
- Triggerele și constrângerile pe tabelele existente (`red_raspunsuri`: constraint trigger amânat, `BEFORE UPDATE` pe `canal` și pe câmpurile rândurilor din mail; `red_jurnal_sel`, `fn_red_jurnal`; politicile Storage pentru `mail/`) sunt tot în inventar, cu postcondiția lor (§1.10, §1.8, §2.1).

---

## 2. Securitatea

### 2.1 Roluri și ce vede viewer-ul (*implicit (c)*)
| Acțiune | owner | admin Redări | editor Redări | viewer Redări |
|---|---|---|---|---|
| lista mesajelor, corpul, atașamentele permise, istoricul de mail pe fișă | da | da | da | **doar numărători** |
| `.eml` brut (carantină) | da | da | nu | nu |
| asociere / rezolvare / verificare / înregistrare răspuns | da | da | da | nu |
| marcare `ignorat` (doar mesaje fără legătură juridică, cu motiv, *implicit (i)*) | da | da | nu | nu |
| confirmarea adreselor propuse | da | da | da | nu |
| `retentie_blocata` | da | da | nu | nu |
| creare lot (preview) | da | da | da | nu |
| **aprobare lot** | **da** | nu | nu | nu |
| pornire trimitere, reconciliere manuală | da | da | nu | nu |
| decizie pe `necunoscut` | da | nu | nu | nu |
| opt-out: confirmarea unei cereri / scoaterea | da / da | da / nu | nu | nu |
| comutatoare, plafoane, termene, OAuth | da | nu | nu | nu |

**Viewer-ul — ce se modifică**:
- `red_mail_*`: politicile RLS de SELECT doar pentru admin / editor (owner prin `fn_red_nivel` = admin).
- Vederile noi (`red_mail_v_inbox`, `red_mail_v_istoric_detinator`) sunt `security_invoker`, deci moștenesc RLS-ul: viewer-ul primește 0 rânduri.
- **Numărătorile** viewer-ului vin din RPC-ul `fn_red_mail_numaratori(proiect_id)` (SECURITY DEFINER): doar contoare pe stare / UAT, fără id-uri de mesaj, adrese sau date.
- **`red_jurnal_sel`** se modifică: rândurile cu `tabela LIKE 'red_mail_%'` intră în lista „doar admin / editor” (alături de `red_detinatori_contact`, `red_raspunsuri_meta`). În plus, `fn_red_jurnal` pune doar numele câmpurilor pe toate tabelele `red_mail_*`.
- **`red_raspunsuri` / `red_raspunsuri_sel` — excepția explicită** (*implicit (c)*, Cop r3 P3-01): politica rămâne neschimbată (viewer-ul vede răspunsurile, ca azi). Pentru un răspuns venit din mail, **informația provenită din e-mail** pe care o vede viewer-ul e **doar**: `canal = 'email'`, `optiune`, `data`, `zi_sesiune_aleasa` și referința fixă din `obiectii_text`. Celelalte coloane ale rândului (id, `detinator_id`, `seq`, `created_by`, `created_at` etc.) le vede ca la orice răspuns, ca azi (Jak r4 P3-01: politica nu face proiecție de coloane). „Viewer doar numărători” se referă la 📥 Mesaje și la tabelele `red_mail_*`, nu la Registru. Dacă Razvan vrea ca viewer-ul să nu vadă nici asta, se schimbă `red_raspunsuri_sel` (și consumatorii viewer-ului), cu felie separată.
- `FisaParcela.jsx`: secțiunea „Istoric e-mail” se încarcă doar pentru admin / editor. Istoricul de răspunsuri existent rămâne cum e (nu conține text de mail).
- `red_corespondenta.observatii` e text liber: UI-ul nu oferă „copiază din mail”. Regula „nu lipi conținut de mail în câmpuri vizibile viewer-ului” intră în ghidul operatorului (și în §8 ca verificare la review-ul UI).
- **Test obligatoriu** (F1, prin API, ca viewer, după „Înregistrează răspuns”): `red_mail_*`, vederile noi, `red_jurnal` (inclusiv rândurile `red_raspunsuri` noi), `red_raspunsuri`, `storage.objects` pe `mail/`, proxy-ul de descărcare → niciun text din mail, nicio adresă, niciun obiect. Testul verifică și **lista pozitivă**: pe răspunsul din mail, valorile provenite din e-mail vizibile viewer-ului sunt exact cele de mai sus, iar restul coloanelor sunt identice cu cele ale unui răspuns introdus de operator.

### 2.2 Accesul conturilor AI la căsuță
- **Conturile AI (inclusiv `claude@gazpet.ro`) NU primesc acces direct la `redari@`**: fără delegare, fără parolă, fără sesiune logată în vreun browser de pe serverul AI.
- Singurul acces e tokenul OAuth al ERP-ului, prin porțile ERP.
- Testele se fac prin ERP, către și dinspre adrese `@gazpet.ro`; rezultatul se verifică pe ecranul ERP. Aceeași regulă pentru căsuța de test (*implicit (l)*, §1.1): conturile AI nu primesc acces la ea.
- Consimțământul OAuth îl dă Razvan, logat el ca `redari@`.

### 2.3 Tokenurile, riscul rezidual și callback-ul OAuth
**Riscul rezidual (declarat)**: tokenul de citire poate citi toată căsuța, cel de trimitere poate trimite oriunde; porțile sunt doar în ERP. `service_role`, Edge Secrets și Vault sunt comune proiectului, deci separarea dintre funcții e de cod și review, nu de platformă. Măsuri:
- **trei clienți OAuth** (doi de producție + clientul de test, *implicit (l)*), trei tokenuri, **fiecare în proiectul GCP lui** (*implicit (g)*, Jak r3 P2-04, Jak r13 P2-03): Google revocă granturile tuturor clienților **din același proiect** pentru un utilizator, deci numai proiectele separate dau revocare independentă (o revocare la callback-ul de trimitere nu oprește citirea; o revocare pe clientul de test, de ex. pentru că owner-ul a autorizat din greșeală `redari@`, nu atinge citirea reală). Varianta „același proiect” e acceptabilă doar dacă Razvan o alege explicit: atunci orice revocare oprește **toate** fluxurile clienților din acel proiect (efectele din coloana „ce oprește” se aplică cumulat) și cere reconectarea lor;
- **două ședințe de consimțământ de producție** (*implicit (g)*, Cop r3 P2-06), câte una pe felie: citirea la activarea F1, trimiterea la activarea F2 (plus conectarea separată a clientului de test, cu căsuța de test). Asta înlocuiește formularea „o singură ședință” din decizia 2A, pentru că F1 și F2 se activează la momente diferite (de confirmat);
- cod și secrete separate, testul static de import;
- tokenurile în Vault, citite de un RPC cu EXECUTE doar `service_role`, care acceptă **exact** numele din maparea de mai jos;
- **Maparea unică** (Jak r6 P2-01) — singura sursă pentru `start`, `callback`, refresh și revocare; orice scop / client / căsuță / secret în afara ei e refuzat:
  | `scop` | Client OAuth | Proiect GCP | Căsuța așteptată | Secretul din Vault | Ce oprește la eroare / revocare |
  |---|---|---|---|---|---|
  | `citire` | „ERP Redări citire” | „Redări citire” (propriu) | `redari@gazpet.ro` | `REDARI_GMAIL_CITIRE_REFRESH_TOKEN` | `red_mail_flux.activ = false` pe rândurile `redari@` |
  | `citire_test` (*implicit (l)*) | „ERP Redări test” | „Redări test” (propriu, separat de citirea reală) | adresa căsuței de test (de ex. `redari-test@gazpet.ro`) | `REDARI_GMAIL_TEST_REFRESH_TOKEN` | `red_mail_flux.activ = false` pe rândurile căsuței de test |
  | `trimitere` (F2) | „ERP Redări trimitere” | „Redări trimitere” (propriu) | `redari@gazpet.ro` | `REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN` | `trimitere_oprita = true` |
  Test: identități inversate (clientul de test întoarce `redari@`, clientul de citire întoarce adresa de test, secretul unui scop cerut pentru alt scop) → revocare imediată, nimic salvat;
- verificarea scope-urilor **la callback și la fiecare refresh**, pe seturi **normalizate** (mai jos): ceva în plus, ceva lipsă, sau câmpul `scope` absent → se aplică efectul scopului respectiv din coloana „ce oprește” a mapării (Cop r13 P3-02: doar căsuța / fluxul afectat, nu oprirea globală) + alertă. Lipsa unui câmp necesar verificării = oprire, nu acceptare;
- monitorizarea SENT (§1.4);
- revocarea (mai jos).

**Seturile OAuth complete** (fără alternative). Se compară **seturi canonice**, nu șiruri literale (Jak r3 P2-03): Google poate întoarce un scope într-o reprezentare echivalentă. Normalizarea folosește o **listă închisă de echivalențe**; orice altceva rămâne diferit:
| Reprezentare întoarsă | Forma canonică |
|---|---|
| `email`, `https://www.googleapis.com/auth/userinfo.email` | `email` |
| `openid` | `openid` |
| `https://www.googleapis.com/auth/gmail.readonly` | `gmail.readonly` |
| `https://www.googleapis.com/auth/gmail.send` | `gmail.send` |

| Client | Cerute | Setul canonic acceptat (exact, după normalizare) | Verificarea căsuței înainte de salvare |
|---|---|---|---|
| „ERP Redări citire” | `https://www.googleapis.com/auth/gmail.readonly` | {`gmail.readonly`} | `users.getProfile().emailAddress` == `redari@gazpet.ro` (exact, minuscule). Fără afirmația `hd` (getProfile nu o dă). |
| „ERP Redări test” (*implicit (l)*) | `https://www.googleapis.com/auth/gmail.readonly` | {`gmail.readonly`} | `users.getProfile().emailAddress` == adresa căsuței de test (exact, minuscule); niciodată `redari@`. |
| „ERP Redări trimitere” | `https://www.googleapis.com/auth/gmail.send openid email` | {`gmail.send`, `openid`, `email`} | `id_token`-ul din răspunsul de token, **validat local** (fără `tokeninfo`): semnătura RS256 cu cheile JWKS Google (WebCrypto, fără librărie nouă), `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}, `aud` = client ID-ul de trimitere, `exp` în viitor, `iat` rezonabil, `email_verified = true`, `email` == `redari@gazpet.ro`, `hd` == `gazpet.ro`. |
- Cererea de autorizare: `access_type=offline`, `prompt=consent`, **`include_granted_scopes=false`** (nu se combină cu permisiuni acordate altor clienți din același proiect), `login_hint=redari@gazpet.ro`, `hd=gazpet.ro`. `login_hint` și `hd` din cerere sunt **doar sugestii pentru ecranul Google, nu dovezi**: dovada e verificarea din tabel.
- La **refresh**, Google poate omite `id_token` și poate întoarce `scope` în altă formă: la refresh se verifică doar setul canonic de scope-uri (căsuța a fost verificată la callback). Fixture-uri reale pentru callback și refresh sunt criteriu de acceptanță (§8).
- Proiectele GCP: trei, separate (*implicit (g)*, mapare mai sus).

**Fișa a–e: `redari-mail-oauth`**
- **(a)**: răspunsurile Google (`code`, `state`, erori, răspunsul de token, `id_token`).
- **(b)**: un secret în Vault, rândul `red_mail_oauth_state`, un eveniment. Nu trimite mail. Atinge un drept puternic (accesul la căsuță), deci doar owner.
- **(c)**: `service_role` după poartă, pentru Vault (`fn_red_mail_secret_seteaza`, EXECUTE doar `service_role`, numai numele din maparea unică de mai sus).
- **(d)**:
  - `start`: doar owner (JWT + `is_owner` în cod și în RPC), `scop` ∈ {`citire`, `citire_test`, `trimitere`}, după maparea unică (trimiterea acceptată doar după ce migrarea F2 e aplicată). `state` aleator de 32 de octeți, salvat ca sha256, legat de `owner_id` + `scop`, expiră în 10 minute;
  - `callback` (GET, fără JWT): `state` consumat atomic (`UPDATE … WHERE sha = … AND consumat_la IS NULL AND expira_la > now() RETURNING`), owner-ul re-verificat, schimbul `code → token`, verificarea scope-urilor exacte și a căsuței (tabelul de mai sus). Orice nepotrivire → **revocare imediată** la Google și nimic salvat.
- **(e)**: fiecare conectare e o acțiune a owner-ului, logat la Google ca **căsuța așteptată** din mapare (`redari@` sau căsuța de test). Înlocuirea unui token existent cere confirmare explicită.
- **Cine accesează secretul**: doar `redari-mail-citeste` (`citire`, `citire_test`) și `redari-mail-trimite` (`trimitere`), prin RPC-ul din Vault, după mapare. Niciun rol de aplicație.
- **Revocarea**: (1) kill-switch-urile din ERP; (2) acțiunea `revoca` (owner): revocare la Google + golirea secretului; (3) de rezervă, contul `redari@` → Securitate → Aplicații terțe, sau Admin Console → API controls; (4) parola `redari@` schimbată + sesiunile închise, la suspiciune; (5) notă în `registru_automatizari`.

### 2.4 Fișele a–e pentru celelalte automatizări
**Contractul de identitate pentru edge-urile pornite de un utilizator** (Cop r3 P2-04; se aplică la `redari-mail-fisier`, `redari-mail-trimite`, `redari-mail-oauth` / `start`, reconcilierea manuală, F4):
1. Identitatea vine **doar din JWT-ul din `Authorization`**, verificat cu `auth.getUser(jwt)` (refuză tokenurile expirate și sesiunile revocate). Niciun uid, rol sau nivel din body, query sau alte antete nu e luat în seamă (L08).
2. Autorizarea pe entitate se face **în BD**, în una din două forme, aleasă per RPC și scrisă în comentariul lui:
   - **(i)** RPC apelat **cu clientul utilizatorului** (JWT-ul lui): `auth.uid()` e utilizatorul final, iar RPC-ul (SECURITY DEFINER) recalculează nivelul și apartenența. Folosită la `fn_red_mail_fisier_autorizeaza`;
   - **(ii)** RPC de serviciu (EXECUTE doar `service_role`) care primește `p_apelant` = **exclusiv** uid-ul întors de `getUser` și recalculează drepturile din `profiles` / `user_module_access` (excepția de cale server din L08). Folosită la `fn_red_mail_rezerva` (ca `fn_sms_rezerva`).
3. Clientul `service_role` se folosește pentru Storage și pentru operațiile privilegiate **numai după** ce RPC-ul de autorizare a întors „da”, și numai pe obiectul / lotul autorizat (calea vine din RPC, nu din cerere).
4. Teste: editor cu `obiect_id` al unui mesaj pe care nu-l poate vedea → 404 generic; uid de owner pus în body / query → ignorat; JWT expirat sau sesiune revocată → 401; cheia anon ca JWT → 401.

**`redari-mail-citeste` (F1)**
- **(a)**: tot ce intră în `redari@` (antete, corp, atașamente) + SENT (antete, `X-Gazpet-Redari`, atașamentul la reconciliere).
- **(b)**: scrie `red_mail_primite` / `_obiecte` / `_evenimente`, obiecte în `mail/`, cursoarele, `red_mail_dedup`; din F2, la reconciliere doar `red_mail_mesaje`: `necunoscut → trimis` + `trimis_la` (nimic în `red_convocari`, §1.5); alertele SENT. **Nu trimite, nu modifică Gmail.** (a) ∩ (b) doar ca date.
- **(c)**: `service_role` după poartă: nimeni din aplicație nu are voie să fabrice un mesaj primit sau proveniența lui (L08). RPC-uri cu EXECUTE doar `service_role`.
- **(d)**: cron cu `x-intern-secret` sau owner (reconcilierea manuală și admin). Teste: anon 401, utilizator obișnuit 403.
- **(e)**: nu trimite. Efectele le face omul. Activarea: owner, după §2.7.

**`redari-mail-trimite` (F2 + F3)**
- **(a)**: adresele din contact; la F3 antetele mesajului la care se răspunde.
- **(b)**: **trimite mail extern** din `redari@` (PII), scrie doar `red_mail_mesaje` (inclusiv convocările pe e-mail, §1.5); **nu scrie în `red_convocari`**. Nu citește căsuța.
- **(c)**: `service_role` după poartă; RPC-urile re-verifică nivelul apelantului (`p_apelant`).
- **(d)**: owner sau admin Redări (`poartaModul.ts` + nivel în BD), doar loturi aprobate. Teste: anon 401, viewer / editor 403 la pornire, lot modificat după aprobare refuzat.
- **(e)**: orice trimitere = lot aprobat de owner pe `lot_sha256`; **un lot aprobat e înghețat** (*implicit (m)*, §1.3): componența, `lot_sha256` și amprenta aprobată nu se mai schimbă, cele trei hash-uri se compară sub lock la rezervare și la `apel_incepe`, o nepotrivire duce lotul în `blocat_integritate` (terminal pentru trimitere, alertă owner). Owner-ul poate doar încheia lotul (mesajele care n-au intrat în apel devin `anulat`); corectura = lot nou, aprobat separat. F3 = lot de 1. Un mail primit nu declanșează nicio trimitere.

**`redari-mail-fisier` (F1, proxy de descărcare)**
- **(a)**: niciun conținut extern interpretat; transmite octeții unui obiect deja stocat.
- **(b)**: nu scrie altceva decât evenimentul de descărcare și jurnalul de egress.
- **(c)**: `service_role` pentru citirea din Storage (prefixul `mail/` nu are politici pentru utilizatori), după autorizarea în RPC.
- **(d)**: utilizator logat; nivelul, apartenența obiectului și starea se verifică în `fn_red_mail_fisier_autorizeaza`. Teste: viewer 403, editor pe `.eml` 403, `obiect_id` al altui mesaj / golit / respins → 404 generic.
- **(e)**: fiecare descărcare e o acțiune explicită a unui om.

**`fn_red_raspuns_public` extins (F1b, câmpul `email`, Jak r5 P3-02)**
- **(a)**: intrare **anonimă** din formularul public (deținătorul tokenului): adresa de e-mail tastată, extern și nevalidat.
- **(b)**: scrie **doar** un rând `propusa` în `red_mail_adrese_propuse` (`sursa = formular_public`); nu atinge `red_detinatori_contact`, nu trimite nimic (nici mail de confirmare), nu atinge bani sau drepturi. (a) ∩ (b) doar ca date nevalidate.
- **(c)**: funcția existentă, SECURITY DEFINER, apelabilă de `anon` ca azi; partea nouă scrie doar în tabelul de propuneri, fără `service_role` din edge.
- **(d)**: oricine are un token public valid; **rate limit-ul existent** al funcției se aplică și câmpului nou; validare strictă a adresei (aceeași funcție SQL ca la §1.6). Teste ca anon: injecție, adresă invalidă, prima introducere malițioasă (§1.11).
- **(e)**: **confirmare umană** obligatorie (`fn_red_mail_adresa_confirma`, admin / editor, după verificarea pe alt canal) înainte ca adresa să intre în contact sau într-un lot (*implicit (a)*).

**`redari-mail-retentie` (F1, oprită)**
- **(a)**: nimic extern; rândurile proprii, termenele, lista prefixului `mail/`.
- **(b)**: **șterge** obiecte din `mail/` și golește coloane — ireversibil. **Automat doar**: mesajele `ignorat` (marcate de un om, cu motiv) la 90 de zile, adresele propuse expirate, obiectele orfane. **Niciodată automat**: `nou`, `neprocesabil`, `asociat`, `rezolvat`, mesajele trimise (§1.8).
- **(c)**: `service_role` (DELETE în Storage + coloane închise pentru roluri), prin RPC-urile mașinii de stări.
- **(d)**: cron cu `x-intern-secret`; owner `?dry=1` (numărătoarea a ce ar goli, pe categorii, fără nicio ștergere).
- **(e)**: activarea = „da” după un dry-run. Golirea corespondenței asociate / trimise = operație cu „da” la termenul proiectului. Blocajul legal oprește golirea (§1.8).

### 2.5 F4 — sugestii AI (opțional)
- **(a)** subiect și corp (extern, ostil). **(b)** doar `red_mail_sugestii` (enum + încredere + offset-uri); costă bani. **(c)** `service_role`, `ANTHROPIC_API_KEY` prin `_shared/haiku55.ts`. **(d)** admin / editor pe un mesaj, owner pe mai multe; fără cron; cost rezervat înainte (L22). **(e)** sugestia doar se afișează.
- Model fără unelte, fără web, fără BD, `max_tokens` mic; ieșire validată strict (L21).
- **Verificare GDPR separată** înainte de activare: furnizorul AI ca sub-împuternicit (DPA, loc, transfer, retenția la furnizor), autorizarea Transgaz.

### 2.6 Riscuri și măsuri
- **Anti prompt-injection**: F1–F3 fără model AI pe mailuri. Textul primit nu ajunge ca instrucțiune la un model cu unelte (nici la sesiunile Claude: pct. 10).
- **Atașamente**: listă albă PDF / JPEG / PNG pe octeții magici, ca **filtru de tip, nu certificat de inofensivitate** (un PDF poate fi poliglot sau conține JavaScript). De aceea nimic nu se deschide, randează, convertește, OCR-izează sau trimite la AI automat; descărcarea e doar fișier (`octet-stream`, `nosniff`), iar ghidul operatorului cere deschiderea cu cititorul PDF din sistem, nu în browser. Respinse (durabil, doar metadate): executabile, arhive, HTML, SVG, Office cu macro, `.eml` încuibate.
- **Linkuri**: doar text, neclicabile, nicio imagine la distanță, ERP-ul nu urmează linkuri.
- **`Authentication-Results`, frontiera de încredere** (Jak P2-05):
  - proprietatea pe care ne bazăm: la mesajele **primite din internet prin MX-ul Google**, Google adaugă deasupra tuturor antetelor existente un `Authentication-Results` cu `authserv-id` = `mx.google.com`. Expeditorul nu poate scrie deasupra lui;
  - regula: se citește **doar antetul cel mai de sus**; e de încredere doar dacă `authserv-id` = `mx.google.com` **și** mesajul a intrat pe traseul MX (primul `Received` de sus e al Google, eticheta nu indică import / POP);
  - precondiție F1 (Admin Console, Razvan): `redari@` **fără** reguli de rutare, import, POP sau redirecționare spre / dinspre serverul local. Altfel proprietatea nu se aplică;
  - **când proveniența nu se poate stabili** (antet absent, `authserv-id` diferit, traseu non-MX, mesaj intern din domeniu, antete duplicate în blocul de sus) → `auth_sursa = 'necunoscut'`, afișat „necunoscut”, nu „pass”;
  - **confirmarea empirică** a proprietății pe fixture-uri reale e criteriu de acceptanță F1 (§8);
  - în orice caz rezultatul e **informativ**: `dmarc=pass` dovedește domeniul, nu persoana, și nu e folosit în nicio decizie automată.
- **Spoofing**: `From` / `Reply-To` falsificabile. Asocierea după expeditor sau cod nu dovedește identitatea (§1.10). Răspunsul pleacă implicit la contact (§1.7). `Reply-To` diferit de `From` → steag `reply_to_diferit`, iar ERP-ul nu răspunde niciodată la `Reply-To`.
- **PII în loguri**: `console.*` doar coduri; răspunsuri HTTP doar contoare; Sentry cu `src/redari/sentryScrub.js`; `red_jurnal` doar numele câmpurilor pe `red_mail_*`; adrese mascate în liste.
- **Teste ostile obligatorii (F1)**: `From` falsificat cu adresa unui deținător; `Reply-To` diferit de `From`; **două antete `From`**; `Authentication-Results: mx.google.com; dmarc=pass` pus de expeditor sub cel real; **fără antet autentic, cu un `Authentication-Results: mx.google.com` fals** (fixture de traseu non-MX) → `necunoscut`; **două `Authentication-Results` în blocul de sus**; două `Message-ID`; `Message-ID` refolosit (coliziune); cod valid copiat de pe un plic; subiect cu `\r\n`; atașament `.pdf` care e ZIP; **PDF poliglot** (PDF valid + ZIP / HTML) → stocat ca PDF doar ca fișier descărcabil, niciodată randat; MIME adânc / 500 de părți; răspuns `full` peste plafon; corp cu instrucțiuni injectate → nicio acțiune; `Date` retrodatat cu 1 an → retenția după `internalDate`.

### 2.7 GDPR — condiții înainte de F1 pe date reale
F1 se poate livra și testa cu `citire_activa = false` și cu mailuri interne de test. **Activarea pe căsuța reală** cere toate:
1. **Cadrul contractual**: contractul / împuternicirea Transgaz permite comunicarea pe e-mail și prelucrarea mailurilor primite de Gazpet în numele Transgaz.
2. **Sub-împuternicitul Google**: autorizarea scrisă a Transgaz (art. 28(2)); Cloud Data Processing Addendum acceptat; locul datelor și transferurile (SCC / DPF) la dosar.
3. **Informarea aplicabilă** pe canalele unde apare `redari@`: scop, temei, destinatari (inclusiv Google), retenție, transferuri, drepturi. `text_gdpr` implicit nu menționează azi e-mailul; informarea v3 (PR #939 draft) nu e în repo.
4. `retentie_mail_pana` fixat pe proiect.
5. Precondiția de traseu de la §2.6 (fără rutare / import / POP).
6. **Poarta GDPR pentru domeniul captat** (Jak r5 P2-05, *implicit (k)*): Juridic validează **expres, înainte de F1**: (i) domeniul (k) — toată corespondența primită, inclusiv mesajele străine de proiect; (ii) utilizarea exclusivă a căsuței pentru Redări și informarea expeditorilor **doar** pe convocator, în formularul public și pe paginile unde apare `redari@`, **fără mesaj automat de răspuns** (*implicit (o)*, R6-02 varianta B: un răspuns automat ar fi o trimitere automată, contrar deciziei „fără niciun automatism”); (iii) tratarea mesajelor străine: marcate `ignorat` de admin, cu motiv (*implicit (i)*), golite la 90 de zile; (iv) un **responsabil numit** pentru triere, cu escaladare la owner după 60 de zile (§1.8). Alerta de 60 de zile nu e prezentată ca termen de retenție. Validarea se notează (dată, cine) în §7.1 la (k). Spre deosebire de punctele 1–5 (condiții de activare), punctul 6 e condiție **înainte de începerea F1**.

F1b cere în plus informarea din formular și procedura de confirmare a adreselor (Juridic). F2: textul mailurilor validat de Juridic + DKIM / DMARC. F4: verificarea separată (§2.5).

---

## 3. Felii de livrare (cu dependențele)

Porți comune: branch din `origin/main`; GO Jakarinos + Copilot pe diff; DRY verde pe prod (gardă de start, o tranzacție, postcondiții, `_ROLLBACK.sql` care nu șterge date, L14); build `npx vite build`; rând în `automatizari` + secțiune în `registru_automatizari` (fișa a–e, doar nume de secrete). Merge / deploy / apply: sesiunea de programare, după GO. **Activarea citirii, a trimiterii, a `extern_permis`, a retenției, importul istoric și fiecare conectare OAuth cer „da”-ul lui Razvan.**

**Ordinea internă în F1** (Cop §6): (1) schema + RLS + politicile Storage + modificările la `red_jurnal_sel` / `fn_red_jurnal` + regresii pe `red_raspunsuri`; (2) OAuth de citire cu verificarea căsuței; (3) ingestia (inițializare, lease, cursor, recuperare, manifest) pe fixture-uri; (4) UI de triere / asociere / verificare / înregistrare răspuns; (5) proxy-ul de descărcare; (6) retenția, livrată oprită, cu termene și blocaje testate; (7) abia după §2.7: activarea controlată.

### F0 — Pregătire (fără cod de producție)
§4 (fără conectarea OAuth); condițiile §2.7 pornite (Juridic, Transgaz); DKIM / DMARC; verificarea traseului `redari@` (fără rutare / import / POP).

### F1 — Primirea + schema minimă comună
- **Migrare: da**, exact inventarul de la §1.12 (postcondițiile îl verifică punct cu punct): `red_mail_setari` (coloanele de citire), `red_mail_flux` (rândul `inbox` al `redari@` + rândurile căsuței de test, *implicit (l)*), `red_mail_primite`, `red_mail_obiecte`, `red_mail_dedup`, `red_mail_evenimente`, `red_mail_raspuns_sursa`, `red_mail_adrese_propuse`, `red_mail_oauth_state`, `red_proiecte.retentie_mail_pana`; RPC-urile §1.1–1.2, §1.8, §1.10–1.11, §2.1 (numărătorile), §2.3 (Vault, state); triggerele de proveniență pe `red_raspunsuri` (constraint trigger amânat, `BEFORE UPDATE` pe `canal`, `BEFORE UPDATE` pe câmpurile rândurilor din mail) + preflight-ul pe răspunsurile `email` preexistente; modificarea `red_jurnal_sel` și a `fn_red_jurnal` pentru `red_mail_*`; politicile Storage pentru `mail/`; vederile noi. Cronurile se creează oprite. **`red_v_stare_parcela` nu se modifică** (r2 o modifica; r3 n-are nevoie, §1.10).
- **Edge: da.** `redari-mail-oauth` (doar `citire` și `citire_test`), `redari-mail-citeste` (INBOX; monitorizarea SENT și reconcilierea vin în F2), `redari-mail-fisier`, `redari-mail-retentie`, `_shared/gmailCitire.ts`.
- **UI: da.** `src/redari/ui/MesajeEcran.jsx` (Nou / De triat / Asociat / Rezolvat / Ignorat, firul, indiciile cu conflicte, autentificarea cu „necunoscut”, steagurile, verificarea, atașamentele prin proxy, „Înregistrează răspuns” → RPC-ul atomic, adresele propuse din mail); „Istoric e-mail” pe `FisaParcela.jsx` (admin / editor); contorul pe Dashboard (pentru viewer prin RPC-ul de numărători); panoul owner (comutatoare, activare, termen, conectare / revocare OAuth de citire).
- **Amânate explicit în F2**: indiciul de fir, reconcilierea, monitorizarea SENT, opt-out-ul (în F1 doar steagul `cere_dezabonare`), OAuth de trimitere.
- **DRY / teste**:
  - cursor: inițializare (*b*), `startHistoryId` fix, rezultat gol, oprire la mijloc, 404 → recuperare cu cursor capturat înainte, `pageToken` invalid → restart, lease expirat înainte de salvarea checkpoint-ului, două rulări concurente, `historyId` > `Number.MAX_SAFE_INTEGER`;
  - ingestie: crash după rând / după un obiect / înainte de finalizare → reluare completă; obiect orfan; conflict de sha; dispărut / neprocesabil / tranzitoriu;
  - dedup și coliziuni; secvența metadata → full → attachments cu plafoane;
  - testele ostile §2.6;
  - **viewer prin API** (§2.1), editor fără `.eml`, politicile Storage ca non-owner;
  - proveniența: INSERT direct `canal = email` refuzat, schimbarea `canal` refuzată, PATCH ca editor pe fiecare câmp protejat al unui răspuns din mail → refuz fără urmă în jurnal, RPC-ul atomic (eșec la mijloc → nimic scris), idempotența (concurență, reluare, conflict), asociere înghețată după înregistrare, răspunsurile `email` preexistente neatinse, un mail neverificat nu apare în `ultimulRaspuns` / PV / export / `deja_raspuns`;
  - contractul de identitate (§2.4, punctul 4);
  - fluxurile INBOX / SENT: ambele cursoare expirate, întrerupere și reluare fără suprascriere reciprocă (cu rândul `sent` din fixture);
  - `?dry=1`: nicio scriere în afara evenimentului, niciun `full` / `raw`; modul test (*implicit (l)*): un mesaj de la un expeditor extern către căsuța de test nu ajunge la citirea corpului (respins de regula Workspace), iar `redari@` nu e citită deloc în modul test;
  - dedup după golire (`deja_golit`, tombstone), corp livrat prin `attachmentId`, domeniul captat (mesaj arhivat / în coș înainte de `404` → importat; spam numărat), trecerea test → producție și importul istoric cu mesaje sosite în timpul tranziției (fiecare o singură dată); limita exactă `internalDate ≥ data_start`: mesaje înainte / în timpul / după activare, apoi `404` → nimic de dinainte de `data_start` (Jak r5 P2-02); tombstone cu politica Vault prelungită → păstrat (§1.2);
  - `red_raspunsuri.data` = `primit_la` (nu `now()`); răspuns mai vechi decât cel curent → refuz fără confirmare, cu confirmare centralizarea neschimbată, inclusiv pe importul istoric (§1.10);
  - retenția în dry-run și pe fixture-uri: `nou` de 120 de zile **nu** se golește (doar alertă), `neprocesabil` vechi nu se golește, `ignorat` (de admin, fără legătură juridică) la 90 de zile de la `ignorat_la` se golește, **`ignorat` refuzat pe un mesaj asociat / înregistrat / redeschis după asociere, iar la 91 de zile conținutul e intact (`neeligibil_asociat`)**, worker întârziat cu obiect `in_stergere` + claim preluat + blocaj (§1.8), propunere din formular neconfirmată la 180 de zile, blocaj cerut în timpul `in_golire` cu două procese de retenție intercalate, eșec după ștergerea parțială, `Date` retrodatat; după golire, **fiecare coloană** din inventar e verificată (NULL / HMAC);
  - callback OAuth: state expirat / refolosit / alt owner, scope în plus / lipsă, altă căsuță → revocare; maparea unică (§2.3) cu identități inversate test / producție → revocare, nimic salvat;
  - r13: activarea per căsuță (test activ + `redari@` inactiv → zero apeluri Gmail spre `redari@`, inclusiv la cron și după restart); activarea întreruptă după fiecare pas (`data_start` neschimbat); același `gmail_id` în două căsuțe (HMAC și căi diferite, golire independentă); `conflict_obiect` → `neprocesabil` atomic, mesajul următor procesat; tranzițiile `stare` × `stare_ingestie` din afara listei → refuz; `tip` de eveniment în afara listei → refuz; mesaj de test promovat spre un deținător real → refuz; ordinea canonică „ultimul răspuns” în JS / SQL / export cu răspunsul vechi inserat ultimul; `cerere_sha256` cu `nota` / `confirma_mai_vechi` diferite → `conflict_operatie`; înregistrare manuală fără dată / cu dată în viitor / fără motiv → refuz (*implicit (p)*); tombstone: scanare incompletă / absență unică / absență dublă la 30 de zile (*implicit (n)*).
- Probă pe prod: înainte de §2.7 doar **modul test**, pe căsuța de test separată (*implicit (l)*, mesaje trimise din căsuțe interne); după §2.7, `?dry=1` de owner pe `redari@`, apoi activarea.

### F1b — Câmpul de e-mail în formularul public (*implicit (a)*)
- **Migrare: da**: `fn_red_raspuns_public` primește un câmp opțional `email`, validat, scris **doar** în `red_mail_adrese_propuse` (`sursa = formular_public`), cu rate limit-ul existent. **UI**: `RedariRaspunsPublic.jsx` + informarea.
- Depinde de F1 (tabelul) și de §2.7 punctul 3 + procedura Juridic de confirmare.
- DRY + teste ca anon: injecție, adresă invalidă, prima introducere malițioasă (contact gol → rămâne gol, lotul F2 nu o vede).

### F2 — Trimiterea în loturi + reconcilierea + SENT
- **Migrare: da.** Coloanele de trimitere, `red_mail_loturi`, `red_mail_mesaje` (snapshot + triggere de imuabilitate, modelul lotului din §1.3 — *implicit (m)*: stările `ciorna` / `aprobat` / `in_trimitere` / `blocat_integritate` / `incheiat` cu lista literală a tranzițiilor, triggerul de componență, RPC-urile de componență doar pe `ciorna`, amprenta aprobată, `fn_red_mail_lot_inchide`, `fn_red_mail_lot_goleste`, `fn_red_mail_lot_sterge_final`, `red_mail_fisiere_inventar` + antetul `red_mail_fisiere_inventar_antet`, triggerul „fără revenire în coadă pe lot încheiat / blocat” (interzise doar tranzițiile spre `in_coada` / `rezervat`), ordinea globală a lock-urilor scrisă în comentariul fiecărui RPC; expirarea aprobării), `red_mail_optout`, cheia `M`, RPC-urile §1.3–1.5, §1.9, rândul `sent` în `red_mail_flux`, funcția canonică de hash (SQL + TS, paritate), **triggerul pe `red_convocari` care refuză `canal = 'email'`** + preflight (§1.5). Fără modificări în `red_v_stare_parcela` / `stare.js` / `exportXlsx.js` (eventual coloana separată „e-mail suplimentar” în Model_6).
- **Edge: da.** `redari-mail-oauth` (scopul `trimitere`), `redari-mail-trimite` + `_shared/gmailTrimitere.ts`; în `redari-mail-citeste`: reconcilierea și monitorizarea SENT.
- **UI: da.** „✉️ Lot e-mail” (filtre, șabloane validate de Juridic, preview cu adresele complete, aprobare, „Trimite” cu progres, plafon atins), lista „de decis” pentru `necunoscut`, alertele SENT, setările, opt-out.
- **DRY / teste**: modelul lotului (testele (1)–(12) de la §1.3: componență înghețată după aprobare, UPDATE pe hash / amprentă refuzat și corupere simulată detectată, tranziții din afara listei refuzate, încheiere cu rezervări expirate și `in_apel` / `necunoscut` (niciun apel nou după încheiere, fără revenire în coadă), golire refuzată înainte de reconcilierea terminală și fără antet de inventar complet, `blocat_integritate` terminal, ștergere finală refuzată cu `necunoscut`, inventarul salvat înainte de golire, fișier exclusiv / partajat, crash la mijloc, ordinea lock-urilor fără deadlock); fiecare rând din tabelul de la §1.3 (inclusiv worker întârziat, eșec de persistare, `429` după `in_apel`), `apel_incepe` cu lease pierdut → niciun apel, kill-switch / opt-out / `extern_permis` schimbate între rezervare și `apel_incepe` (barieră) → niciun apel, testele (1)–(4) de la §1.5 (doar e-mail, poștă apoi e-mail, poștă returnată apoi e-mail, INSERT `canal = email` refuzat), snapshot / atașament schimbat, plafon la concurență (2 sesiuni + barieră, L25), ferestrele în `Europe/Bucharest` la miezul nopții și la schimbarea orei, lot 300 / plafon 200, opt-out între creare și rezervare, `extern_permis = false`, reconcilierea (exact 1 / 0 / 2 / `Cc` prezent / antet dublu / **antete și atașament identice dar corp modificat** / atașament în plus / paginare), SENT (fără rând ERP, identificatori refolosiți cu conținut diferit, duplicat), hash canonic stabil la două compuneri cu delimitatori diferiți, expirarea aprobării care nu atinge `in_apel` / `necunoscut`, MIME ostil.
- Probă: 3 adrese `@gazpet.ro`, apoi „da” pentru `extern_permis` și un prim lot ≤ 10.
- **Precondiții**: DKIM + DMARC, textul validat, §2.7.

### F3 — Răspuns pe fir
- **Migrare: mică** (`raspuns_fir`, `in_reply_to_primit_id`, alegerea destinatarului, „lot de 1”). **Edge**: `threadId` + antetele de fir, subiectul neschimbat, referința în corp. **UI**: „Răspunde” (ciornă → aprobare → trimite). **Teste**: subiect fără cod, contact ≠ expeditor (mesaj nou), fir corect pe o căsuță internă.

### F4 — Sugestii AI (opțional)
- **Migrare: da** (`red_mail_sugestii` + rezervarea costului). **Edge**: `redari-mail-sugereaza`. **UI**: insigna „sugestie”. **Teste**: §2.5 + injecții. **Precondiție**: verificarea GDPR separată.

---

## 4. Pașii manuali cu Razvan (fără valori, doar nume)

1. **Conturile AI nu primesc acces la `redari@`** (§2.2).
2. **Clienții OAuth**: Gmail API activat, ecran **Internal**, clienții Web „ERP Redări citire”, „ERP Redări trimitere” și „ERP Redări test” (*implicit (l)*) (redirect = URL-ul `redari-mail-oauth`), **fiecare în proiectul GCP lui** (*implicit (g)*, maparea din §2.3); în Admin Console, aplicațiile marcate de încredere, limitate la scope-urile lor.
3. **Două ședințe de consimțământ** (*implicit (g)*): la activarea F1, Razvan, în ERP ca owner, apasă „Conectează citire”; la activarea F2, „Conectează trimitere” (butonul există doar după aplicarea F2). De fiecare dată Google cere logarea **lui** ca `redari@`. Tokenurile ajung direct în Vault. Clienții stau în proiecte GCP separate (*implicit (g)*).
4. **Secretele** (doar nume):
   - Edge Secrets: `REDARI_GMAIL_CITIRE_CLIENT_ID`, `REDARI_GMAIL_CITIRE_CLIENT_SECRET`, `REDARI_GMAIL_TRIMITERE_CLIENT_ID`, `REDARI_GMAIL_TRIMITERE_CLIENT_SECRET`; pentru căsuța de test (*implicit (l)*): `REDARI_GMAIL_TEST_CLIENT_ID`, `REDARI_GMAIL_TEST_CLIENT_SECRET`;
   - Vault: `REDARI_GMAIL_CITIRE_REFRESH_TOKEN`, `REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN` (scrise de callback), `REDARI_GMAIL_TEST_REFRESH_TOKEN` (*implicit (l)*), `REDARI_MAIL_REF_SECRET`;
   - refolosit: `INTERN_EDGE_SECRET`; doar F4: `ANTHROPIC_API_KEY`;
   - **nu se refolosesc** `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN`.
5. **DNS / Admin Console**: DKIM + DMARC (§0.4); `redari@` fără rutare / import / POP / redirecționare; retenție în Google Vault; DPA acceptat; căsuța de test separată (*implicit (l)*) cu regula care respinge expeditorii din afara `@gazpet.ro`.
6. **Juridic / Transgaz**: §2.7 (inclusiv poarta GDPR a domeniului (k), punctul 6, înainte de F1) + procedura de confirmare a adreselor (F1b).
7. **Registre**: rândurile în `public.automatizari` (citire, trimitere, oauth, fișier, retenție, F4) + secțiunea „E-mail Redări” în `registru_automatizari`, cu procedura de revocare.

## 5. Ce cere „da” separat
Fiecare conectare OAuth, `citire_activa` pe căsuța reală, importul istoric (dacă se cere), `retentie_activa`, `trimitere_oprita = false`, `extern_permis = true`, fiecare lot extern (aprobarea e „da”-ul), F1b, F4, orice corectare de răspuns deja înregistrat, golirea corespondenței asociate / trimise la termenul proiectului, ștergerea finală a metadatelor de audit, tratarea răspunsurilor `email` preexistente, fiecare decizie implicită din §7.1.

## 6. Ce NU face planul
Nu trimite către instituții (rămân în `red_corespondenta`). Nu înlocuiește poșta cu AR. Nu răspunde automat. Nu șterge și nu mută nimic în Gmail. Nu dă conturilor AI acces la căsuță. Nu folosește o adresă nevalidată de un om. Nu importă istoricul căsuței fără cerere.

---

## 7. Decizii închise (Razvan, 03.11.2026: toate variantele A)
1. **Acces**: clienți OAuth dedicați, refresh token în Vault prin callback doar owner (doi clienți, §2.3).
2. **Scope-uri**: `gmail.readonly` + `gmail.send` (+ `openid email` pe clientul de trimitere, pentru verificarea căsuței). „O singură autorizare” devine, *implicit (g)*, două ședințe (citirea la F1, trimiterea la F2), pentru că feliile se activează separat.
3. **Asocierea**: o confirmă mereu omul.
4. **Dezabonarea venită pe mail**: steag + confirmarea omului.
5. **Aprobarea loturilor**: doar owner-ul.
6. **Valoarea juridică**: e-mailul e canal suplimentar; poșta cu AR rămâne.
7. **Plafoane**: 200 / zi, 1.000 / lună, maximum 300 / lot.
8. **Retenția**: dosarul la termenul din `text_gdpr`; spam / irelevant golite după 90 de zile. Precizarea r4 (*implicit (e)*): doar mesajele marcate `ignorat` de un om se golesc automat; netriatele nu.
9. **Sursa adreselor**: operator + câmp opțional în formular (F1b) + adresa dintr-un mail, ultimele două doar ca propuneri confirmate de om.
10. **Cine vede mesajele**: admin + editor Redări; viewer doar numărători.
11. **DKIM / DMARC**: înainte de F2.
12. **Cronul de citire**: 5 minute.

### 7.1 Decizii implicite — de confirmat de Razvan înaintea feliei indicate
Regula (Jak r3 P3-02): comportamentul care depinde de o decizie din tabel **nu se implementează** până nu are data confirmării completată aici (PR de documentație). O decizie respinsă redeschide secțiunea respectivă din plan înainte de felie.
| Cod | Decizia implicită | Unde | Înainte de | Confirmat (data, de către) |
|---|---|---|---|---|
| (a) | Adresele din formular / din `From` rămân „propuse” până le confirmă un om; neeligibile pentru loturi | §1.11 | F1 (tabelul) / F1b | — |
| (b) | Prima activare citește doar de atunci înainte; importul istoric doar la cerere, separat | §1.1 | F1 | — |
| (c) | Viewer-ul nu vede conținut de mail; excepția: în `red_raspunsuri` vede canal, opțiune, dată, zi și referința fixă | §2.1 | F1 | — |
| (d) | Răspunsul din mail intră în Registru doar verificat, fără text copiat, cel mult unul per (mesaj, deținător), apoi neschimbabil prin API | §1.10 | F1 | — |
| (e) | Nicio golire automată pentru `nou` / `neprocesabil` / `asociat` / `rezolvat` / trimise; automat doar `ignorat` (om + motiv), la 90 de zile de la marcare; alertă la 60 de zile pentru netriate | §1.8 | F1 (retenția) | — |
| (f) | Metadatele de audit păstrate până la `retentie_mail_pana`; adrese propuse golite la 180 de zile (neconfirmate) / 30 de zile (respinse) | §1.8 | F1 (retenția) | — |
| (g) | Clienții OAuth în proiecte GCP separate; două ședințe de consimțământ (F1, F2) | §2.3, §4 | F1 (citire) / F2 (trimitere) | — |
| (h) | Aprobarea unui lot expiră după 7 zile, doar pentru `in_coada` | §1.3 | F2 | — |
| (i) | Un mesaj asociat vreodată nu poate fi `ignorat`; `ignorat` doar pentru netriate / neasociate, de owner / admin, cu motiv | §1.8, §1.10 | F1 | — |
| (j) | Convocarea pe e-mail nu intră în `red_convocari` și nu schimbă starea juridică a parcelei; stare proprie în `red_mail_mesaje` | §1.5 | F2 | — |
| (k) | Domeniul captat = toată corespondența primită după activare (inclusiv arhivată / coș), spamul doar numărat; mesajele reale din modul test nu se importă. **Plus validarea Juridic expresă** (§2.7 punctul 6) | §1.1, §2.7 | F1 | — (Razvan: —; Juridic: —) |
| (l) | Modul test pe o căsuță de test separată (de ex. `redari-test@`), client OAuth de test, regulă Workspace care respinge expeditorii externi, în locul `redari+test@` | §1.1, §4 | F1 | — |
| (m) | Lotul aprobat e înghețat; doar încheiere de owner (netrimisele → `anulat`); corectura = lot nou; `blocat_integritate` terminal; ștergerea finală doar din `incheiat`, fără `in_apel` / `necunoscut`, cu inventarul fișierelor scris la încheiere | §1.3 | F2 | — |
| (n) | Tombstone șters doar cu dovada completă: două scanări complete și stabile (`historyId` neschimbat), la ≥ 30 de zile, HMAC negăsit, **și** `messages.get` → `404` pe id-ul candidat; altfel rămâne (fail-closed) | §1.2 | F1 | — |
| (o) | Informarea expeditorilor doar pe convocator / formular / pagini; fără mesaj automat de răspuns | §2.7 | F1 | — |
| (p) | Înregistrarea manuală: `data_raspuns` `date` (dată civilă București), introdusă de om, obligatorie, ≤ azi, cu motiv; `red_raspunsuri.data` = ziua la 00:00 București | §1.10 | F1 | — |

---

## 8. Rămâne pentru implementarea F1 / F2 (cu criteriul de acceptanță)
| Felie | Ce | Criteriul de acceptanță |
|---|---|---|
| F1 | Proprietatea `Authentication-Results` pe traseul real al `redari@` | Fixture-uri reale (expeditor gmail.com, yahoo, intern `@gazpet.ro`, redirecționat, cu antet fals): rezultatul e `pass` / `fail` doar pe traseul MX confirmat, altfel `necunoscut`; capturile atașate la PR (fără PII) |
| F1 | Decodarea codării de transfer în `format=full` | Fixture-uri reale base64 / quoted-printable / charset necunoscut / HTML-only: textul afișat corect, steagurile corecte |
| F1 | Durata backup-urilor Supabase (PITR / zilnice) | Valoarea citită din dashboard și trecută în informare + `registru_automatizari` |
| F1 | Regula „nu lipi conținut de mail în câmpuri vizibile viewer-ului” | Ghidul operatorului actualizat; UI-ul nu are „copiază din mail” în afara `red_mail_*` (verificat la review) |
| F1 | Corectarea unui răspuns înregistrat greșit | F1 o blochează (trigger testat); până la o felie de anulare, owner-ul o face ca operație pe date reale (pct. 3) |
| F1b | Procedura Juridic de confirmare a adreselor propuse | Text aprobat, metoda de verificare în enum, fără mail automat de confirmare |
| F2 | Semantica lui `429` / `403 rateLimitExceeded` | Tratat ca `necunoscut` (tabelul §1.3); dacă documentația Google confirmă neacceptarea sigură, se poate trece prin owner la „repune în coadă” cu același `Message-ID`, după o reconciliere negativă |
| F1 | Răspunsurile `canal = 'email'` preexistente | Numărate și listate de preflight; dacă > 0, Razvan decide (lăsate / `manual_verificat`) înainte de apply, ca operație pe date reale |
| F1 | Modul test pe căsuța de test separată (*implicit (l)*, înlocuiește `redari+test@` și citirea `Delivered-To` pe căsuța reală) | Căsuța creată, client OAuth de test conectat, regula Workspace activă (captură fără PII); test: mesaj extern → nu ajunge la citirea corpului; codul are aceeași cale ca în producție |
| F1 (înainte de start) | Poarta GDPR pentru domeniul (k) (§2.7 punctul 6) | Validarea expresă a Juridic (domeniul, utilizarea exclusivă și informarea fără mesaj automat — *implicit (o)*, mesajele străine, responsabilul de triere cu escaladare la 60 de zile), notată în §7.1 la (k) |
| F1 | Durata maximă a unui worker Supabase (perioada de grație, §1.8) | Valoarea citită din documentația Supabase pentru planul proiectului și notată aici; grația = valoarea + 10 minute, de la `stergere_autorizata_la` |
| F1 / F2 | Scope-urile întoarse de Google | Fixture-uri reale ale endpoint-ului de token (callback + refresh, pentru ambii clienți); normalizarea acoperă doar echivalențele din lista închisă; orice altceva → oprire |
| F1 | Temeiul păstrării metadatelor de audit | Confirmat de Juridic (decizia (f)); trecut în informare |
| F2 | `X-Gazpet-Redari` păstrat în copia din SENT; corpul decodat din SENT dă aceeași formă canonică | Test pe o căsuță internă: antetul există, iar hash-ul recalculat din SENT = `mesaj_sha256` (Gmail nu transformă corpurile `base64`) |
| F2 | Limitele Google la zi | Citite pe pagina oficială și notate; plafoanele proprii rămân sub ele |
| F2 | Modelul lotului (Cop r6 P1-01; r9, *implicit (m)*) | Confirmarea lui Razvan pentru (m) în §7.1; postcondițiile verifică lista literală a stărilor și tranzițiilor, triggerul de componență, fără drepturi de scriere directă pe `red_mail_mesaje`, `lot_sha256` și amprenta imuabile după aprobare, ordinea globală a lock-urilor în comentariul fiecărui RPC; testele (1)–(12) din §1.3 trec: lot aprobat înghețat, `blocat_integritate` terminal, încheierea anulează tot ce n-a intrat în apel (inclusiv rezervările expirate) și eliberează plafonul, ștergerea finală doar din `incheiat` fără `in_apel` / `necunoscut`, cu inventarul fișierelor salvat înainte de golire, fișierele întâi, reluabilă; r10: golirea doar după reconcilierea terminală și cu antetul inventarului complet (`nr_fisiere`, `inventar_sha256` verificate, inclusiv lot cu 0 fișiere), niciun apel nou după încheiere, niciun mesaj al unui lot încheiat / blocat readus în coadă; r11: pe lot încheiat / blocat sunt permise `in_apel → trimis` / `esuat_sigur` / `necunoscut` și `rezervat → anulat` (măturare), interzise doar spre `in_coada` / `rezervat`; inventarul verificat antet ↔ rânduri, snapshoturile doar la încheiere; r12: la încheiere, inventarul verificat în ambele sensuri (snapshot → rând și rând → snapshot, fără duplicate, `nr_fisiere` = numărul rândurilor) |
| F2 | Convocări `canal = 'email'` preexistente în `red_convocari` | Preflight-ul le numără (așteptat 0); dacă > 0, Razvan decide înainte de apply, ca operație pe date reale |
| F1 | Termenul politicii Google Vault pentru `redari@` | Fixat de Razvan în Admin Console și notat (informare, aliniere cu retenția). **Nu** mai stabilește viața tombstone-urilor din `red_mail_dedup` (Jak r5 P2-01): acestea se șterg doar după verificarea de citire în doi pași (§1.2), prin două scanări complete la ≥ 30 de zile (*implicit (n)*); test cu politica Vault prelungită |
| F1 | Fără filtre Gmail care mută / șterg pe `redari@` | Captură din Admin Console / setările căsuței atașată la PR (fără PII); alerta de spam numărat funcționează pe fixture |

---

## 9. Tabelul de rezolvare (r1 → … → r13 → r14)
Rezolvările marcate „cond. (x)” depind de o decizie implicită din §7.1 și se implementează doar după confirmarea ei.
| Runda / punct | Rezolvare |
|---|---|
| r1 Decizii (Jak P3-12, Cop P3-03) | r2: §7 închis; r3: + deciziile implicite (a)–(d) marcate |
| r1 Jak/Cop acces AI direct (Cop P1-01) | r2: §2.2; închis |
| r1 Cursor (Jak P1-1, Cop P2-01) | r2: §1.1; r3: completat (vezi r2 Jak P2-02, Cop P2-01/03) |
| r1 Dedup (Jak P1-2, Cop P2-02) | r2: §1.2; închis |
| r1 Crash la trimitere (Jak P1-3, Cop P2-05) | r2: §1.3–1.5; r3: completat (r2 Jak P2-07, Cop P2-08) |
| r1 Retenție (Jak P1-4, Cop P2-06) | r2: §1.8; r3: completat (r2 Jak P2-04, Cop P2-06) |
| r1 GDPR (Jak P1-5, Cop P2-07) | r2: §2.7; închis ca porți |
| r1 Token (Jak P2-6, Cop P2-03/04) | r2: §2.3; r3: seturi OAuth exacte (r2 Jak P2-03, Cop P2-07) |
| r1 Snapshot / MIME (Jak P2-7, Cop P3-02) | r2: §1.3, §1.6; închis |
| r1 `.eml` / atașamente (Jak P2-8, Cop P3-01) | r2: §1.8–1.9; r3: secvența corectată (r2 Jak P2-01, Cop P2-02) |
| r1 Asociere ≠ identitate (Jak P2-9) | r2: §1.10; r3: contractul complet (r2 Jak P1-02) |
| r1 Dependențe (Jak P2-10) | r2: §3; r3: F1b refăcut, OAuth trimitere în F2 |
| r1 Fir Gmail (Jak P2-11) | r2: §1.7; închis |
| **r2 Jak P1-01** viewer prin tabelele existente | §2.1: `red_jurnal_sel` + `fn_red_jurnal` pentru `red_mail_*`, RLS / vederi / RPC de numărători; §1.10: în `red_raspunsuri` nu intră text din mail; test API ca viewer |
| **r2 Jak P1-02** contractul de verificare pentru toți consumatorii | §1.10: doar răspunsuri verificate intră în Registru, RPC atomic, constraint trigger amânat, `canal` imuabil, asociere înghețată; consumatorii inventariați la §0.3, neschimbați prin construcție; corectarea → §8 |
| **r2 Jak P1-03** recuperarea BD ↔ Storage | §1.2: `in_curs` + manifest `red_mail_obiecte`, reluare idempotentă, finalizare, cursor doar pe mesaje finale, orfane curățate zilnic |
| r2 Jak P2-01 `metadata` fără MIME | §1.1: secvența metadata → full (plafon) → attachments → raw, plafoane pe HTTP / base64 / decodat, reguli de decodare |
| r2 Jak P2-02 inițializare și progres | §1.1: prima activare (*implicit b*), reluarea în pagină / înregistrare, `pageToken` invalid → restart, `data_start` `timestamptz` + epoch, `historyId` șir / `numeric` |
| r2 Jak P2-03 OAuth contradictoriu | §2.3: seturile exacte per client, getProfile pentru citire, `id_token` validat local pentru trimitere, `include_granted_scopes=false`, scope verificat la fiecare refresh |
| r2 Jak P2-04 retenția: copii și concurență | §1.8: tabelul copiilor (inclusiv backup-uri, Gmail), `retentie_stare` în schemă, protocolul cu blocajul (verificare înainte de fiecare DELETE), mesajele `nou` |
| r2 Jak P2-05 frontiera `Authentication-Results` | §2.6: proprietatea traseului MX, precondiția fără rutare / import, `necunoscut` la proveniență nestabilită, teste; confirmarea empirică → §8 |
| r2 Jak P2-06 monitorizarea SENT | §1.4: cursor SENT separat, checkpoint + suprapunere, corelare, alertă; reconcilierea cu antete duplicate, `Cc` / `Bcc`, paginare |
| r2 Jak P2-07 contractul operațional | §1.3: tabelul complet (inclusiv `429` după `in_apel`, 200 neinterpretabil, eșec de persistare, worker întârziat); §1.9: ferestre `Europe/Bucharest`, contabilizarea pe `(mesaj_id, rezervare_nr)`, lot 300 / plafon 200 |
| r2 Jak P3-01 OAuth trimitere | Doar în F2 (§2.3, §3, §4) |
| r2 Jak P3-02 teste ostile | §2.6: `Reply-To`, PDF poliglot, `From` / `Authentication-Results` duplicate |
| **r2 Cop P1-01** F1b, adresă anonimă | §1.11 (*implicit a*): doar `red_mail_adrese_propuse`, confirmare umană, neeligibilă pentru loturi, test de primă introducere malițioasă |
| r2 Cop P2-01 inițializarea cursorului | §1.1 (*implicit b*): `neinitializat`, captură sub lease, fără import retroactiv; importul istoric separat, cu epoch și suprapunere |
| r2 Cop P2-02 `metadata` | ca Jak P2-01 |
| r2 Cop P2-03 lease pe progres, `pageToken`, `historyId` | §1.1: CAS pe lease + versiune + stare pe toate scrierile, restart la `pageToken` invalid, `numeric(20,0)` / șir; teste în F1 |
| r2 Cop P2-04 URL-uri semnate | §1.8: proxy edge `redari-mail-fisier` (autorizare RPC + flux + jurnal pe fiecare transfer), fără URL semnat; fișa la §2.4 |
| r2 Cop P2-05 consumatorii `red_raspunsuri` | ca Jak P1-02 (varianta conservatoare, *implicit d*); fără invariant dublu: verificarea stă pe `red_mail_primite`, iar `red_mail_raspuns_sursa` există doar pentru verificate |
| r2 Cop P2-06 retenție: netriate, blocaj în `in_golire` | ca Jak P2-04: mașina de stări, teste. (Regula r3 „golire la 90 de zile pentru `nou`” e **înlocuită** în r4 de §7.1 (e): netriatele nu se golesc automat.) |
| r2 Cop P2-07 OAuth inconsistent | ca Jak P2-03 + o singură regulă de livrare (trimiterea în F2) |
| r2 Cop P2-08 `apel_incepe` + conținutul la reconciliere | §1.3: CAS cu rezultat explicit, niciun apel fără el; §1.4: `X-Gazpet-Redari` + sha-ul atașamentului |
| r2 Cop P3-01 antetul `Date` | §1: timpul de încredere = `internalDate`; `Date` → `data_declarata`; test de retrodatare |
| r2 Cop P3-02 README | Rândul din `docs/redari/README.md` reformulat: trimiterea cere lot aprobat de owner; citirea, reconcilierea și retenția sunt automatizări separate, activate explicit de owner |
| **r3 Jak P1-01** răspunsul înregistrat modificabil prin API | §1.10: trigger `BEFORE UPDATE` pe rândurile cu sursă e-mail (toate câmpurile de conținut / rezultat / dată / proveniență), referința fixă impusă la INSERT și UPDATE; test PATCH ca editor pe fiecare câmp, fără urmă în jurnal — cond. (d) |
| r3 Jak P2-01 / Cop P2-02 idempotența înregistrării | §1.10: `FOR UPDATE` pe mesaj, `UNIQUE (primit_id, detinator_id)`, `cerere_sha256`, reluare identică → același `raspuns_id`, cerere diferită → conflict; test concurent — cond. (d) |
| r3 Jak P2-02 inventarul retenției | §1.8: inventar pe coloane (note, motive, `antete_snapshot`, propuneri fără mesaj), termen propriu pentru propuneri, excepția din triggerul de imuabilitate al snapshotului (§1.3); test pe fiecare coloană — cond. (f) |
| r3 Jak P2-03 / Cop P3-02 scope-uri echivalente | §2.3: cerute vs. set canonic, listă închisă de echivalențe (`email` ≡ `userinfo.email`), verificare la callback și la refresh, `scope` absent = oprire; fixture-uri reale → §8 |
| r3 Jak P2-04 revocarea comună în același proiect GCP | §2.3: proiecte GCP separate — cond. (g); varianta „același proiect” doar explicit, cu oprirea și reconectarea ambelor fluxuri |
| r3 Jak P2-05 reconcilierea nu verifică corpul | §1.3: forma canonică (RFC 8785, NFC, `\n`, fără `X-Gazpet-Redari` / delimitatori); §1.4: hash recalculat din copia SENT, manifest complet de atașamente, `h=` doar indiciu; SENT: `trimis_modificat` / `trimis_duplicat`; test cu corp modificat |
| r3 Jak P2-06 starea comună a două cursoare | §1.1: `red_mail_flux` cu cheie `(casuta, flux)`, lease și checkpoint pe flux; rândul `sent` creat la F2, fără scanare retroactivă; test cu ambele cursoare expirate |
| r3 Jak P3-01 contractul `?dry=1` | §1.1: operații permise / interzise; dry pe căsuța reală doar după §2.7; modul test `redari+test@` (varianta cu căsuță separată în §8). **Înlocuit în r6** de căsuța de test separată (*implicit (l)*, r5 Jak P2-03) |
| r3 Jak P3-02 deciziile implicite înaintea feliei | Introducere + §7.1: tabel cu felia și coloana „confirmat (data, de către)”; regula „nu se implementează până la confirmare”; în §9 rezolvările dependente sunt marcate „cond.” |
| **r3 Cop P1-01** ștergerea automată a netriatelor | §1.8: nicio golire automată pentru `nou` / `neprocesabil` / asociate / trimise; automat doar `ignorat` (om + motiv), la 90 de zile de la marcare; alertă la 60 de zile; asociatele la termen doar cu „da”; §2.4 (b) actualizat — cond. (e) |
| r3 Cop P2-01 fereastra blocajului legal | §1.8: lease global de retenție, claim exclusiv per mesaj, ștergere secvențială cu `in_stergere`, blocaj `cerut` → `activ`; garanția „cel mult obiectul deja în ștergere”; test cu două procese + admin |
| r3 Cop P2-03 răspunsurile `email` preexistente | §1.10: preflight cu numărătoare, constraint trigger doar pe rânduri noi, decizia pe cele vechi la Razvan (§8); RPC manual `manual_verificat` pentru e-mailuri primite pe alt circuit |
| r3 Cop P2-04 identitatea la RPC-urile din edge | §2.4: contractul JWT → `getUser` → RPC (cu clientul utilizatorului sau `p_apelant` doar din `getUser`) → `service_role` doar după autorizare; teste (alt `obiect_id`, uid falsificat, JWT revocat) |
| r3 Cop P2-05 metadatele rămase, propuneri din formular | §1.8: două categorii (conținut / audit), temei și termen pentru audit, `gmail_id` → HMAC, „pseudonimizare, nu anonimizare”; termen pentru propuneri, inclusiv cele fără `primit_id` — cond. (f) |
| r3 Cop P2-06 „o singură ședință OAuth” contradictoriu | §2.3, §4, §7: două ședințe, câte una pe felie — cond. (g) |
| r3 Cop P2-07 canonicalizarea hash-ului | §1.3: forma canonică, fără dependență circulară, stabilă între compuneri; test cu delimitatori diferiți |
| r3 Cop P3-01 excepția viewer-ului | §2.1: câmpurile pe care viewer-ul le vede din `red_raspunsuri` enumerate explicit + lista pozitivă în test — cond. (c) |
| r3 Cop P3-03 expirarea aprobării pe stări | §1.3: expirarea atinge doar `in_coada`; `in_apel` / `necunoscut` / `trimis` / `esuat_*` neschimbate; test — cond. (h) |
| **r4 Jak P1-01 / Cop P2-01** „ignorat” ocolește protecția corespondenței asociate | §1.8, §1.10, §2.1: `a_fost_asociat` imuabil, `are_legatura_juridica`, `ignorat` doar din `nou` / `neprocesabil`, doar owner / admin, cu motiv, trigger pe orice altă cale; re-verificare sub lock la golire (`neeligibil_asociat`); test asociat → ignorat refuzat → 91 de zile intact — cond. (i) |
| **r4 Jak P1-02** e-mailul nu înlocuiește poșta cu AR | §1.5: convocarea pe e-mail stă doar în `red_mail_mesaje` (`M-nnnn`, stare proprie); trigger pe `red_convocari` refuză `canal = 'email'`; consumatorii existenți (`stare.js`, `exportXlsx.js`, `red_v_stare_parcela` …) neschimbați prin construcție; teste: doar e-mail, poștă + e-mail, retur + e-mail, INSERT refuzat — cond. (j) |
| r4 Jak P2-01 claim expirat vs. blocaj | §1.8: cel mult un obiect `in_stergere` per mesaj (sub `FOR UPDATE`), clarificarea obiectului după grație înainte de orice altă autorizare, `in_stergere` în enum; test worker întârziat + claim preluat + blocaj |
| r4 Jak P2-02 / Cop P2-02 dedup după golire | §1.2: `gmail_id_hmac` de la prima ingestie, `UNIQUE (casuta, gmail_id_hmac)`, `INSERT … ON CONFLICT` înaintea manifestului, `deja_golit` fără descărcare, versiuni de cheie, tombstone `red_mail_dedup` cât trăiește originalul în Gmail; teste concurente |
| r4 Jak P2-03 corpul livrat prin `attachmentId` | §1.1: părțile de corp descărcate separat (2 MB), decodate ca text, nestocate ca fișier; fixture-uri `text/plain` + `text/html` |
| r4 Jak P2-04 trecerea test → producție, importul istoric | §1.1: `fn_red_mail_trece_productie` atomic (cursor recapturat, `data_start` nou, mesajele reale din test neimportate — cond. (k)); importul = flux `import` separat, filtrul `data_import_de_la ≤ internalDate < data_start`; teste cu mesaje în tranziție. **r6**: trecerea = prima activare a `redari@` (căsuța de test separată, r5 Jak P2-03) |
| r4 Jak P2-05 / Cop P2-03 mesaje arhivate înainte de recuperare | §1.1: domeniul captat = toată corespondența primită (fără filtru INBOX în istoric, recuperare cu `includeSpamTrash`, fără `in:inbox`), spam numărat, precondiția „fără filtre care mută / șterg”; test arhivat înainte de `404` — cond. (k) |
| r4 Jak P2-06 kill-switch / opt-out verificate prea devreme | §1.3: `apel_incepe` re-verifică kill-switch, opt-out, `extern_permis`, starea lotului sub aceeași ordine de lock; `in_apel` nu se poate retrage (declarat); test cu barieră |
| r4 Jak P2-07 / Cop P3-01 identificatori în evenimente / jurnal | §1.8: evenimentele doar cu `gmail_id_hmac` (metadate pseudonimizate) și termen de ștergere; `red_jurnal` cu identificatorii angajaților, regulă existentă; proveniența minimă (`red_mail_raspuns_sursa` cu `gmail_redari_sters`) păstrată cât există răspunsul |
| r4 Jak P3-01 lista pozitivă vs. politica păstrată | §2.1: lista = informația provenită din e-mail; restul coloanelor ca la orice răspuns; testul aliniat |
| r4 Jak P3-02 formulări depășite | Introducere („o singură ședință” marcată ca înlocuită), §4 („proiecte GCP separate”), §9 (regula 60 / 90 pentru netriate marcată ca înlocuită) |
| r4 Cop P3-02 idempotența răspunsurilor manuale | §1.10: `operatie_id` UUID generat înainte de primul apel, `UNIQUE` + `cerere_sha256`, conflict la argumente diferite; test timeout + reluare |
| r5 Jak P2-01 tombstone expirat calendaristic | §1.2: tombstone fără expirare, șters doar după verificarea de citire (`404`, doi pași la 30 de zile); test cu politica Vault prelungită; §8 (rândul Vault). Mecanismul fără `gmail_id` brut: deschis (R6-01), până atunci niciun tombstone nu se șterge |
| r5 Jak P2-02 recuperarea admite mesaje de dinainte de activare | §1.1: `data_start` fixat înaintea capturii `historyId`, limita exactă `internalDate ≥ data_start` (suprapunerea doar în `after:`), scanare de recuperare `activare` pentru intervalul dintre cele două momente; test înainte / în timpul / după activare + `404` |
| r5 Jak P2-03 modul test fără expeditor intern impus | §1.1, §2.2, §4, §3 F1, §8: căsuță de test separată, client OAuth de test, regulă Workspace pentru expeditorii externi; `redari+test@` și citirea `Delivered-To` scoase — cond. (l) |
| r5 Jak P2-04 `red_raspunsuri.data` fără contract | §1.10: `data` = `primit_la`, pus de RPC; răspuns mai vechi decât cel curent → refuz până la `confirma_mai_vechi`, centralizarea neschimbată; test pe importul istoric. Data la RPC-ul manual: deschis (R6-03) — cond. (d) |
| r5 Jak P2-05 poarta GDPR pentru domeniul (k) | §2.7 punctul 6 (condiție înainte de F1), §1.8 (responsabil de triere, escaladare la 60 de zile, alerta ≠ retenție), §7.1 (k), §8. Mesajul automat de răspuns: deschis (R6-02) — cond. (k) |
| r5 Jak P2-06 inventarul schemei F1 | §1.12 nou: tabele, enumuri complete (`flux` cu `import`, `recuperare_tip`, `scop`), chei, `red_mail_dedup`, `mod_test`; §3 F1: migrarea = inventarul, postcondiții punct cu punct |
| r5 Jak P3-01 grația la ștergere | §1.8: grația = durata maximă a worker-ului Supabase + 10 min, de la `stergere_autorizata_la`; valoarea în §8 |
| r5 Jak P3-02 fișele a–e | §2.4: fișa `fn_red_raspuns_public` extins (F1b); fișa citirii cu `trimis_la` în `red_mail_mesaje`, nu `data_expediere` |
| **r6 Cop P1-01** aprobarea nelegată de componența lotului | r7: §1.3: trigger pe `red_mail_mesaje` (INSERT / DELETE / `lot_id`) pentru loturile aprobate, schimbarea componenței doar prin retragerea aprobării de owner, `lot_sha256` recalculat sub lock la rezervare și la `apel_incepe`; §2.4 (e); §3 F2; §8; teste inserare / ștergere / mutare / sha schimbat |
| r7 Jak P2-01..02 / Cop P2-01..02, P3-01 (pe remedierea P1-01) | r7b: §1.3: lock comun pe lot pentru componență / aprobare / retragere / rezervare, componența doar prin RPC, amprenta aprobată imuabilă, retragere atomică, `blocat_integritate` (ce blochează, ce continuă, alertă, deblocare de owner + aprobare nouă), DELETE doar prin ștergerea finală de retenție pe lot `arhivat`; §1.8; §3 F2; §8; teste (7)–(11) |
| r7b Jak P2-01..02 / Cop P2-01..03, P3-01 (pe remedierea P1-01) | r8: §1.3: ordinea globală unică a lock-urilor (setări → loturi după `id` → mesaje după `id`); amprenta aprobată scrisă o dată, niciodată rescrisă; retragerea și deblocarea = înlocuirea lotului (lot vechi `arhivat` înghețat, copiile `in_coada` într-un lot nou `ciorna`, aprobare nouă); trei hash-uri comparate, `lot_sha256` imuabil; ștergerea finală cu fișierele întâi, reluabilă; §1.8; §3 F2; §8; teste (4), (6), (10)–(12) |
| r8 Jak P2-01..03 / Cop P2-01..02 (pe modelul lotului) | r9, simplificare (*implicit (m)*): §1.3: stări în listă închisă (`ciorna` → `aprobat` → `in_trimitere` → `incheiat`, `blocat_integritate` terminal), lot aprobat înghețat, scoase retragerea / deblocarea / copierea mesajelor și stările din r8, încheierea de owner anulează tot ce n-a intrat în apel, ștergerea finală doar din `incheiat` fără `in_apel` / `necunoscut`, inventarul fișierelor scris la încheiere; §1.8, §1.9, §2.4, §3 F2, §7.1, §8; teste (1)–(12) refăcute. Rândurile r7 / r7b / r8 de mai sus descriu mecanisme **înlocuite în r9** |
| r9 Jak P2-01..02, P3-01 / Cop P2-01..03 | r10: §1.3: golirea doar după reconcilierea terminală, sub lock (`fn_red_mail_lot_goleste`); antetul inventarului cu `inventar_complet_la` / `nr_fisiere` / `inventar_sha256` (0 fișiere = antet complet); pe lot `incheiat` / `blocat_integritate` niciun mesaj nu revine în coadă (`in_apel → esuat_sigur` / `necunoscut`); „niciun apel nou după încheiere”; §1.8; §3 F2; §8; teste (8), (9), (11) |
| r10 Jak P2-01..02 / Cop P2-01..03 | r11: §1.3: pe lot `incheiat` / `blocat_integritate` permise `in_apel → trimis` / `esuat_sigur` / `necunoscut` și măturarea `rezervat → anulat`, interzise doar spre `in_coada` / `rezervat`; `inventar_sha256` din rândurile inventarului, snapshoturile verificate doar la încheiere, golirea / ștergerea compară antet ↔ rânduri; tabelul rezultatelor; §3 F2; §8; teste (8), (10), (11) |
| r11 Cop P2-01 / Jak P3-01 | r12: §1.3: inventarul verificat la încheiere în ambele sensuri (fără rânduri în plus / duplicate, `nr_fisiere` = numărul rândurilor); testul (10) reformulat; test (11) extins; §8 |
| r12 Cop P3-01 | r12b: §1.3: corespondența inventar ↔ snapshot = egalitatea `(lot_id, mesaj_id, cale, sha256, marime)`, `marime` în inventar și în `inventar_sha256`, clasificarea exclusiv / partajat validată separat; test (11) cu sha / mărime diferite |
| r6 Jak P2-01..04, P3-01 / Cop P2-01..05, P3-01..02 + R6-01..03 (citire, F1) | r13: §2.3 maparea unică scop → client → căsuță → secret → efect; §1.1 activare per căsuță (`red_mail_flux.activ`) și `data_start` fixat o dată + CAS la activare; §1.12 literalele evenimentelor, `respins_la`, `absent_prima_la`, `CHECK test`; §1.10 tranziții pe `stare` × `stare_ingestie`, `test = false` la înregistrare, ordinea canonică `data` + `id`, `cerere_sha256` complet, semnături cu `operatie_id`, `internalDate` = primirea la Google; §1.2 HMAC și căi pe căsuță, `fn_red_mail_ingestie_conflict`; §1.9 plafoane recalculate la `apel_incepe`; R6-01..03 → *implicit (n)*, *(o)*, *(p)* (§7.1) |
| r13 Jak P2-01..04, P3-01 / Cop P2-01..05, P3-01..02 | r14: §1.11 contractul complet al confirmării adresei; §1.2 / (n) scanări stabile + `messages.get 404`, fail-closed; §2.3 / §4 trei clienți, proiect GCP propriu; §1.10 / §1.12 / (p) `data_raspuns date` la București, regula `ultimulRaspuns` existentă, `fn_red_mail_asociaza_neprocesabil`, `test NOT NULL`, `are_legatura_juridica` literal; §1.9 loc în plafon la `apel_incepe` pe ziua apelului, `apel_valabil_pana` |
| r14 Jak P2-01..04, P3-01 / Cop P2-01..05, P3-01..02 | **Nerezolvate** — oprit pentru deciziile Q1–Q3 (Stare review); r15 după răspunsul lui Razvan |
