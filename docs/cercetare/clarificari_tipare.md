# Tipare de clarificare — catalog structurat (runda 2)

> 63 tipare · sursa de adevăr: `clarificari_tipare.json` · înlocuiește `catalog_clarificari.md` (runda 1, păstrat doar ca istoric).
> Fiecare tipar: **trigger** structurat → documente de verificat → **cerințe** (`REQ-*` din `registru_cerinte.json`) + precedente CNSC → **întrebare neutră și factuală** (text extern) → **impact intern** (NU se trimite) → încredere + nevoie de review juridic.
> Regula evidence-first: în întrebare se citează un act DOAR dacă cerința are `verificat_pe_sursa:true`. Orice tipar cu ⚖️ trece prin review juridic uman înainte de trimitere. Modelul matricei per licitație: `clarificari_matrice_model.md`.

Review juridic necesar: 24 / 63 · încredere: ridicata 38, medie 20, scazuta 5

| Tipar | Tip | Titlu | Detecție | Încredere | ⚖️ |
|---|---|---|---|---|---|
| [PAT-CTR-01](#pat-ctr-01) | contradictie | Aceeași cerință are valori diferite în fișa de date, caietul de sarcini și contract | comparatie_documente | ridicata |  |
| [PAT-CTR-02](#pat-ctr-02) | contradictie | Cantitate din F3/lista de cantități diferită de planșe sau memoriu | calcul | ridicata |  |
| [PAT-CTR-03](#pat-ctr-03) | contradictie | Răspunsul la clarificări modifică DA, dar documentul-sursă nu a fost republicat | comparatie_documente | medie |  |
| [PAT-INF-01](#pat-inf-01) | informatie_lipsa | Utilități subterane, avize de amplasament, autorizație de construire, predarea amplasamentului | camp_lipsa | ridicata |  |
| [PAT-INF-02](#pat-inf-02) | informatie_lipsa | Lucrări în zona drumului: acord și autorizație de amplasare, restricții de circulație, tarife — în sarcina cui | judecata_umana | ridicata |  |
| [PAT-INF-03](#pat-inf-03) | informatie_lipsa | Acorduri ale proprietarilor și despăgubiri pe trasee prin proprietăți private | judecata_umana | scazuta | ⚖️ |
| [PAT-INF-04](#pat-inf-04) | informatie_lipsa | Coordonatorul SSM, PSS și declarația prealabilă — în sarcina cui | camp_lipsa | ridicata |  |
| [PAT-INF-05](#pat-inf-05) | informatie_lipsa | Verificarea proiectului (componenta de proiectare la P+E) — cine contractează și plătește verificatorii | camp_lipsa | medie |  |
| [PAT-INF-06](#pat-inf-06) | informatie_lipsa | Probe, recepție și punere în funcțiune cu operatorul de distribuție — tarife și cuplare | camp_lipsa | ridicata |  |
| [PAT-INF-07](#pat-inf-07) | informatie_lipsa | Localitate cu concesiune a serviciului de distribuție gaze | judecata_umana | medie |  |
| [PAT-INF-08](#pat-inf-08) | informatie_lipsa | Apă: lipsesc presiunea de încercare și pierderea admisibilă; ediția NP 133 neclară | camp_lipsa | ridicata |  |
| [PAT-INF-09](#pat-inf-09) | informatie_lipsa | Verificarea izolației conductei de oțel după umplerea șanțului — metodă și criteriu | cuvant_cheie | ridicata |  |
| [PAT-INF-10](#pat-inf-10) | informatie_lipsa | Protecția catodică — inclusă sau nu în obiect | judecata_umana | scazuta | ⚖️ |
| [PAT-INF-11](#pat-inf-11) | informatie_lipsa | Valoarea estimată pe lot/obiect nu este publicată | camp_lipsa | ridicata |  |
| [PAT-INF-12](#pat-inf-12) | informatie_lipsa | Formularele de extrase de resurse (C6–C9) sunt cerute, dar nepublicate | camp_lipsa | medie |  |
| [PAT-AMB-01](#pat-amb-01) | ambiguu | P+E: se cer la ofertă documente care rezultă abia din proiectul tehnic | judecata_umana | ridicata |  |
| [PAT-AMB-02](#pat-amb-02) | ambiguu | Factori de evaluare: noțiuni nedefinite, documente inexistente sau angajamente fără mod de verificare | cuvant_cheie | medie | ⚖️ |
| [PAT-AMB-03](#pat-amb-03) | ambiguu | Rețete de consum și distanțe de transport ale proiectantului — obligatorii sau orientative | cuvant_cheie | medie | ⚖️ |
| [PAT-AMB-04](#pat-amb-04) | ambiguu | Preț unitar unic pe resursă în toate devizele | cuvant_cheie | ridicata |  |
| [PAT-AMB-05](#pat-amb-05) | ambiguu | Plafon procentual pentru cheltuieli indirecte, profit sau organizare de șantier | cuvant_cheie | scazuta | ⚖️ |
| [PAT-AMB-06](#pat-amb-06) | ambiguu | Autorizări speciale (topografie OCPI, aviz GA, ANRE, RTE pe domenii) — la ofertă sau la execuție | comparatie_documente | ridicata | ⚖️ |
| [PAT-AMB-07](#pat-amb-07) | ambiguu | Verificarea îmbinărilor din PE — alte încercări decât examinarea vizuală | cuvant_cheie | ridicata |  |
| [PAT-AMB-08](#pat-amb-08) | ambiguu | Răspunsul AC la o clarificare este evaziv sau incomplet | judecata_umana | ridicata | ⚖️ |
| [PAT-CNT-01](#pat-cnt-01) | cantitate | Extinderea controlului nedistructiv la sudurile din oțel și includerea lui în deviz | cuvant_cheie | ridicata |  |
| [PAT-CNT-02](#pat-cnt-02) | cantitate | Elemente cerute de normativ lipsă din F3 (fir trasor, bandă de avertizare; la apă: ridicare topografică, spălare, dezinfecție) | camp_lipsa | medie |  |
| [PAT-CNT-03](#pat-cnt-03) | cantitate | Traversări de obstacole (drum național, cale ferată, curs de apă) — metodă, tub de protecție, avize și condițiile lor | comparatie_documente | medie |  |
| [PAT-CNT-04](#pat-cnt-04) | cantitate | Deșeuri din construcții — transport, eliminare/valorificare, distanță | camp_lipsa | ridicata |  |
| [PAT-STD-01](#pat-std-01) | standard | Probă de etanșeitate „24 de ore” pentru orice tronson sau branșament | cuvant_cheie | ridicata |  |
| [PAT-STD-02](#pat-std-02) | standard | Material sau SDR incompatibil cu treapta de presiune (ex. PE 80 la presiune medie) | comparatie_documente | ridicata |  |
| [PAT-STD-03](#pat-std-03) | standard | Adâncime de pozare sub 0,9 m sau distanțe față de alte rețele sub minimele NTPEE / ANRE electric | calcul | ridicata |  |
| [PAT-STD-04](#pat-std-04) | standard | Canalizare: metoda probei de etanșeitate, criteriul de acceptare și inspecția CCTV | cuvant_cheie | ridicata |  |
| [PAT-STD-05](#pat-std-05) | standard | „Clasa de calitate II” a sudurilor fără nivel de acceptare și criterii CND | cuvant_cheie | medie |  |
| [PAT-STD-06](#pat-std-06) | standard | Proceduri de sudare (WPQR): nivel cerut și acceptarea celor existente aprobate ISCIR | cuvant_cheie | medie |  |
| [PAT-STD-07](#pat-std-07) | standard | Clasa izolației de fabrică, sistemul de izolare a îmbinărilor și pregătirea suprafeței | cuvant_cheie | medie |  |
| [PAT-STD-08](#pat-std-08) | standard | Trimiteri la acte normative abrogate sau la ediții de standarde înlocuite | cuvant_cheie | medie | ⚖️ |
| [PAT-STD-09](#pat-std-09) | standard | DA cere ISCIR (autorizare, verificare, RSVTI) pentru conducte de distribuție, branșamente sau SRM | cuvant_cheie | ridicata |  |
| [PAT-STD-10](#pat-std-10) | standard | Metrologie: aparatele de presiune/temperatură folosite la probe — verificare metrologică vs etalonare | cuvant_cheie | medie |  |
| [PAT-STD-11](#pat-std-11) | standard | Specificațiile tehnice ale operatorului de distribuție și documentele de inspecție pentru materiale (3.1 / 3.2) | judecata_umana | medie |  |
| [PAT-CAL-01](#pat-cal-01) | calificare | Autorizare ANRE: Ordinul 132/2021 citat, tip neprecizat, cerință lipsă sau tip necorelat cu regimul de presiune | cuvant_cheie | ridicata | ⚖️ |
| [PAT-CAL-02](#pat-cal-02) | calificare | Autorizare ANRE îndeplinită prin asociat sau subcontractant | judecata_umana | medie | ⚖️ |
| [PAT-CAL-03](#pat-cal-03) | calificare | Intervenții pe rețele de gaze în contracte de drumuri sau apă-canal | cuvant_cheie | ridicata | ⚖️ |
| [PAT-CAL-04](#pat-cal-04) | calificare | Personal cheie: legitimații ANRE cu terminologie veche și RTE „pentru gaze” | cuvant_cheie | medie | ⚖️ |
| [PAT-CAL-05](#pat-cal-05) | calificare | Experiență similară formulată ca „identică” sau limitată strict la tipul de rețea din obiect | cuvant_cheie | ridicata | ⚖️ |
| [PAT-CAL-06](#pat-cal-06) | calificare | Experiență similară: contract „finalizat/semnat în ultimii 5 ani” sau plafon peste valoarea estimată | calcul | ridicata | ⚖️ |
| [PAT-CAL-07](#pat-cal-07) | calificare | Documentele de dovedire a experienței similare | camp_lipsa | ridicata | ⚖️ |
| [PAT-CAL-08](#pat-cal-08) | calificare | Cifra de afaceri minimă disproporționată sau pe mai mult de 3 ani | calcul | ridicata | ⚖️ |
| [PAT-CAL-09](#pat-cal-09) | calificare | Cerințe de nișă fără legătură aparentă cu lucrările (atestate de alt tip, licență ANRSC, experiență „exclusiv în gaze”, utilaje specifice) | judecata_umana | scazuta | ⚖️ |
| [PAT-CAL-10](#pat-cal-10) | calificare | Personal cheie: același expert pe mai multe loturi și documentele de experiență | camp_lipsa | medie | ⚖️ |
| [PAT-CAL-11](#pat-cal-11) | calificare | Calificarea sudorilor: autorizație ISCIR vs certificate EN ISO 9606-1 / EN 13067 | cuvant_cheie | medie | ⚖️ |
| [PAT-CAL-12](#pat-cal-12) | calificare | VERIFICARE INTERNĂ: autorizațiile sudorilor nominalizați (expirate sau la alt angajator) | comparatie_documente | ridicata | ⚖️ |
| [PAT-CAL-13](#pat-cal-13) | calificare | Certificări cerute la calificare (SR EN ISO 3834-2 / IWE, ISO 9001 / 14001 / 45001) — echivalențe | cuvant_cheie | scazuta | ⚖️ |
| [PAT-GAR-01](#pat-gar-01) | garantie | Garanția de participare: cuantum, valabilitate, forma instrumentului și condiții impuse emitentului | cuvant_cheie | ridicata | ⚖️ |
| [PAT-GAR-02](#pat-gar-02) | garantie | Garanția de bună execuție cumulată cu Sumele Reținute; rețineri succesive; restituire | camp_lipsa | ridicata |  |
| [PAT-GAR-03](#pat-gar-03) | garantie | Perioada de garanție a lucrărilor: categoria de importanță / clasa de consecințe / garanția ANRE de 2 ani | camp_lipsa | medie | ⚖️ |
| [PAT-GAR-04](#pat-gar-04) | garantie | Garanția pentru refacerea structurii rutiere (5 ani) și cine o asigură | judecata_umana | ridicata |  |
| [PAT-TRM-01](#pat-trm-01) | termen | Termenul de execuție și graficul Gantt — ce include și ce nivel de detaliu | judecata_umana | ridicata |  |
| [PAT-TRM-02](#pat-trm-02) | termen | Răspunsurile la clarificări publicate cu mai puțin de 10 (6) zile înainte de termenul de depunere | calcul | ridicata |  |
| [PAT-TRM-03](#pat-trm-03) | termen | VERIFICARE INTERNĂ: termenul de contestare a documentației / a răspunsului la clarificări | calcul | medie | ⚖️ |
| [PAT-CTC-01](#pat-ctc-01) | contract | Ajustarea prețului lipsește la durate de peste 6 luni / contradicție cu prețul ferm (cl. 48.2) | calcul | ridicata |  |
| [PAT-CTC-02](#pat-ctc-02) | contract | Formula de ajustare folosește indici nepublicați (ex. ICCplr) sau preluați din OUG 64/2022 | cuvant_cheie | ridicata |  |
| [PAT-CTC-03](#pat-ctc-03) | contract | Penalitățile de întârziere nu sunt stabilite (se aplică valoarea implicită din cl. 36.4) | camp_lipsa | ridicata |  |
| [PAT-CTC-04](#pat-ctc-04) | contract | Avansul — acordare, cuantum și modul de recuperare | camp_lipsa | ridicata |  |
| [PAT-CTC-05](#pat-ctc-05) | contract | Contract cu prețuri unitare sau cu preț global — modul de plată a cantităților | camp_lipsa | ridicata |  |

## Contradicții între documente

### PAT-CTR-01
**Aceeași cerință are valori diferite în fișa de date, caietul de sarcini și contract**  · încredere ridicata · vechi: CL-A07

- **Trigger:** aceeași noțiune (termen de execuție, perioadă de garanție, servicii incluse — ex. asistență tehnică, obținere avize) apare cu valori/incluziuni diferite în ≥ 2 documente ale DA _(caută în: fisa_de_date, caiet_sarcini, contract; detecție: comparatie_documente)_
- **Documente de verificat:** Fișa de date; Caiet de sarcini; Model de contract / acord contractual
- **Cerințe:** `REQ-AD-010` HG 395/2016 art. 20 alin. (2); `REQ-AD-009` 665/2023 (BO, nr. complet anonimizat) motivare (art. 209 L98, art. 134–135 HG 395)
- **Precedente CNSC:** BO2023_665

> **Întrebare (text extern):** Fișa de date ([secțiunea …], pag. […]) prevede [X]; caietul de sarcini ([cap. …], pag. […]) și/sau modelul de contract ([clauza …]) prevăd [Y]. Vă rugăm să precizați care prevedere se aplică și, dacă este cazul, să publicați documentele actualizate.

- 🔒 **Impact intern (nu se trimite):** tehnic — Ofertăm pe o ipoteză tehnică greșită dacă alegem varianta nevalabilă. · cost — Diferența de preț între variante (ex. servicii incluse/excluse). · risc — Mediu: CNSC nu întoarce contradicția împotriva ofertantului (BO2023_665), dar disputa costă timp; se închide înainte de depunere.

### PAT-CTR-02
**Cantitate din F3/lista de cantități diferită de planșe sau memoriu**  · încredere ridicata · vechi: CL-C07

- **Trigger:** pentru același articol (cod, UM) cantitatea din F3 diferă de cea măsurată pe planșe/memoriu (prag intern: > 2 % sau > 1 UM la articole unitare) _(caută în: F3, planse, caiet_sarcini; detecție: calcul)_
- **Documente de verificat:** Formular F3 / liste de cantități pe obiecte; Planșe (situație, profile longitudinale); Memoriu tehnic
- **Cerințe:** `REQ-AD-074` 3104/2026 (BO, nr. complet anonimizat) motivare (L98 art. 210; HG 395 art. 136–137); `REQ-AD-123` HG 907/2016 Anexa (conținut-cadru PT), Secțiunea V — Formularul F3, Precizări; `REQ-AD-107` HG 1/2018 Anexa 1, cl. 49.1; `REQ-AD-131` HG 907/2016 Formular F3 coloana 3 (cantitate) — coroborat cu Decizia CNSC BO2026_3104
- **Precedente CNSC:** BO2026_3104, BO2021_1060

> **Întrebare (text extern):** La poziția [cod articol] din lista de cantități [nr./obiect] figurează [cantitate, UM]; din planșa [nr.] / memoriul tehnic (pag. […]) rezultă [cantitate, UM]. Vă rugăm să precizați cantitatea care trebuie ofertată și, dacă este cazul, să publicați lista de cantități corectată.

- 🔒 **Impact intern (nu se trimite):** tehnic — Cantitatea reală de executat diferă de cea plătită/ofertată. · cost — Ofertantul nu poate corecta F3 în ofertă; diferența rămâne risc de execuție (la preț unitar se plătește cantitatea măsurată, cl. 49.1). · risc — Ridicat dacă reducem cantitatea în ofertă: cantitățile publicate sunt obligatorii (BO2026_3104).
- **Notă:** Clarificarea e singurul canal de corectare înainte de depunere.

### PAT-CTR-03
**Răspunsul la clarificări modifică DA, dar documentul-sursă nu a fost republicat**  · încredere medie · vechi: —

- **Trigger:** un răspuns publicat schimbă o valoare/cerință, iar documentul DA cu aceeași cerință rămâne în forma inițială în SEAP _(caută în: raspunsuri_clarificari, fisa_de_date, caiet_sarcini; detecție: comparatie_documente)_
- **Documente de verificat:** Răspunsuri la clarificări (toate rundele); Documentul DA vizat
- **Cerințe:** `REQ-AD-002` Legea 98/2016 art. 160 alin. (2); `REQ-AD-007` Ghid ANAP privind gestionarea solicitărilor de clarificări (propunere) secțiunile privind răspunsurile formale și modificarea DA prin clarificări
- **Precedente CNSC:** —

> **Întrebare (text extern):** Prin răspunsul nr. [X] din [data] ați precizat [Y]; documentul [denumire] publicat (pag. […]) prevede în continuare [W]. Vă rugăm să confirmați că se aplică prevederea din răspunsul la clarificări și dacă documentul [denumire] va fi republicat în forma actualizată.

- 🔒 **Impact intern (nu se trimite):** tehnic — Echipa poate lucra pe versiunea veche a cerinței. · cost — Depinde de cerință. · risc — Mediu: comisia poate evalua după documentul nemodificat.
- **Notă:** REQ-AD-007 (ghid ANAP 2020) nu e verificat pe sursă — folosit doar ca context, nu e citat.

## Informație lipsă

### PAT-INF-01
**Utilități subterane, avize de amplasament, autorizație de construire, predarea amplasamentului**  · încredere ridicata · vechi: CL-A01

- **Trigger:** DA nu conține planul cu rețelele edilitare existente, avizele de amplasament sau stadiul autorizației de construire; contractul are clauză de condiții fizice neprevăzute (cl. 21.1) _(caută în: caiet_sarcini, planse, contract; detecție: camp_lipsa)_
- **Documente de verificat:** Planșe de situație; Avize/acorduri anexate; Autorizație de construire; Condiții contractuale cl. 21.1
- **Cerințe:** `REQ-AD-113` HG 1/2018 Anexa 1, cl. 21.1; `REQ-SC-017` HG 300/2006 anexa nr. 4 partea B pct. 10.2; `REQ-SC-110` Legea 123/2012 — Titlul II Gaze naturale art. 190 lit. b)–d); `REQ-SC-113` Ordin ANRE 89/2018 (NTPEE-2018) art. 28; art. 27
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să ne transmiteți, pentru [obiect], planurile de situație cu rețelele edilitare existente, avizele de amplasament obținute și autorizația de construire (sau termenul estimat de emitere), precum și termenul estimat de predare a amplasamentului. Vă rugăm să precizați și modul de tratare a rețelelor neidentificate în planuri, în raport cu subclauza 21.1 din condițiile contractuale.

- 🔒 **Impact intern (nu se trimite):** tehnic — Risc de avarii la rețele existente; sondaje manuale suplimentare. · cost — Sondaje, relocări, întârzieri neplătite. · risc — Scăzut (nu afectează conformitatea), dar ridicat pe execuție.

### PAT-INF-02
**Lucrări în zona drumului: acord și autorizație de amplasare, restricții de circulație, tarife — în sarcina cui**  · încredere ridicata · vechi: CL-A05

- **Trigger:** traseul este în zona drumului public (ampriză, zonă de siguranță) și DA nu precizează cine obține acordul prealabil/autorizația de amplasare și cine plătește tarifele; branșamente pentru construcții existente / SAU: lucrări în carosabil/trotuar fără articol în F3 pentru semnalizare temporară și fără precizarea cine obține aprobarea administratorului și a poliției rutiere _(caută în: caiet_sarcini, fisa_de_date, F3; detecție: judecata_umana)_
- **Documente de verificat:** Caiet de sarcini; Planșe de situație; F1/F3 (capitol avize); Liste de cantități; Planșe de organizare
- **Cerințe:** `REQ-SC-041` OG 43/1997 art. 46 alin. (1); `REQ-SC-042` OG 43/1997 art. 46 alin. (3); `REQ-SC-044` OG 43/1997 art. 46 alin. (9)–(10); `REQ-SC-078` Clarificări MDLPA — aplicarea Legii 169/2026 (septembrie 2026) răspunsul despre branșamente (trimite la Legea 169/2026 art. 267 alin. (1)); `REQ-SC-079` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 267 alin. (1) (după clarificarea MDLPA); `REQ-SC-069` Ordin MI/MT 1112/411/2000 Partea I pct. (1)–(3), tabelul nr. 1; pct. (4), tabelul nr. 2; `REQ-SC-070` Ordin MI/MT 1112/411/2000 Partea I pct. (6); `REQ-SC-071` Ordin MI/MT 1112/411/2000 Partea I pct. (8) pct. 8.1–8.5; pct. (7); `REQ-SC-073` Ordin MI/MT 1112/411/2000 Partea I pct. (13) lit. c)–g); `REQ-SC-077` Ordin MI/MT 1112/411/2000 Partea I pct. (19)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Pentru [traseul / branșamentele] din zona drumului [denumire], vă rugăm să precizați cine obține acordul prealabil și autorizația de amplasare și/sau de acces și cine suportă tarifele aferente, precum și dacă documentația pentru restricționarea circulației (scheme de semnalizare temporară, rute ocolitoare) și aprobările aferente sunt în sarcina executantului. Dacă acestea sunt în sarcina executantului, vă rugăm să indicați capitolul din F1/F3 sau articolul din listele de cantități în care se cuprind.

- 🔒 **Impact intern (nu se trimite):** tehnic — Fără autorizație, lucrarea se poate desființa (OG 43/1997 art. 46). Cererea se depune cu ≥ 30 de zile înainte de începere (unele categorii). · cost — Tarife de utilizare și acces, garanții, termene de obținere. Semnalizare, personal, rute ocolitoare. · risc — Scăzut. Scăzut; răspunderea pentru accidente revine executantului.
- **Notă:** Corectură runda 1: regimul branșamentelor pentru construcții existente sub Legea 169/2026 (REQ-SC-078/079) e neverificat pe sursă — nu se citează în întrebare. Contopit cu: Restricții de circulație și semnalizare temporară — documentație, aprobări, cost.

### PAT-INF-03
**Acorduri ale proprietarilor și despăgubiri pe trasee prin proprietăți private** · ⚖️ review juridic · încredere scazuta · vechi: CL-A06

- **Trigger:** traseul traversează proprietăți private și DA nu spune cine obține acordurile/convențiile și cine plătește eventualele despăgubiri _(caută în: caiet_sarcini, planse, F3; detecție: judecata_umana)_
- **Documente de verificat:** Planșe de situație / plan cadastral; Caiet de sarcini; F1/F3
- **Cerințe:** —
- **Precedente CNSC:** —

> **Întrebare (text extern):** Pentru tronsoanele care traversează proprietăți private ([planșe/poziții]), vă rugăm să precizați dacă acordurile proprietarilor și eventualele despăgubiri sunt în sarcina autorității contractante / operatorului de distribuție sau a executantului și, în al doilea caz, capitolul din F1/F3 în care se cuprind.

- 🔒 **Impact intern (nu se trimite):** tehnic — Blocaj de execuție pe proprietăți fără acord. · cost — Despăgubiri necuantificabile la ofertare. · risc — Scăzut.
- **Notă:** temei de confirmat: șablonul din runda 1 invoca Legea 123/2012 art. 109–113; nicio cerință verificată în runda 2 — citarea a fost eliminată.

### PAT-INF-04
**Coordonatorul SSM, PSS și declarația prealabilă — în sarcina cui**  · încredere ridicata · vechi: CL-B12

- **Trigger:** pe șantier lucrează mai mulți antreprenori/subantreprenori și DA nu precizează cine asigură coordonatorul SSM pe durata realizării și cine depune declarația prealabilă la ITM _(caută în: caiet_sarcini, fisa_de_date, F3; detecție: camp_lipsa)_
- **Documente de verificat:** Caiet de sarcini; F3 / organizare de șantier
- **Cerințe:** `REQ-SC-003` HG 300/2006 art. 7; art. 4 lit. j); `REQ-SC-004` HG 300/2006 art. 59 lit. a)–b); `REQ-SC-001` HG 300/2006 art. 10; art. 13; art. 14; `REQ-SC-011` HG 300/2006 art. 47 lit. a)–b); art. 48
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați dacă coordonatorul în materie de securitate și sănătate pe durata realizării lucrării (HG nr. 300/2006, art. 7) va fi desemnat de autoritatea contractantă sau dacă serviciul este în sarcina executantului; în al doilea caz, vă rugăm să indicați articolul din F3 sau din organizarea de șantier în care se cuprinde costul.

- 🔒 **Impact intern (nu se trimite):** tehnic — Lipsa coordonatorului blochează începerea lucrărilor. · cost — Cost coordonator ≥ 5 ani experiență pe durata contractului. · risc — Scăzut.

### PAT-INF-05
**Verificarea proiectului (componenta de proiectare la P+E) — cine contractează și plătește verificatorii**  · încredere medie · vechi: —

- **Trigger:** contract de proiectare + execuție; DA nu spune cine plătește verificarea proiectului de verificatori atestați (ANRE pentru gaze, MDLPA pentru alte cerințe) _(caută în: fisa_de_date, caiet_sarcini, contract; detecție: camp_lipsa)_
- **Documente de verificat:** Fișa de date; Caiet de sarcini (tema de proiectare); Formular de ofertă financiară
- **Cerințe:** `REQ-TG-006` Legea 123/2012 — Titlul II Gaze naturale art. 160 alin. (1); `REQ-AD-149` HG 925/1995 Regulament, art. 5 (alineatul final); `REQ-TG-024` Ordin ANRE 17/2026 anexa 8, pct. 18
- **Precedente CNSC:** —

> **Întrebare (text extern):** Pentru componenta de proiectare, vă rugăm să precizați dacă verificarea proiectului de către verificatori atestați este în sarcina autorității contractante sau a ofertantului și, în al doilea caz, capitolul din propunerea financiară în care se cuprinde.

- 🔒 **Impact intern (nu se trimite):** tehnic — Execuția gazelor se face numai pe proiecte verificate (anexa 8 pct. 18 Ord. ANRE 17/2026). · cost — Onorarii verificatori pe fiecare specialitate. · risc — Scăzut.
- **Notă:** REQ-AD-149 (HG 925/1995) are încredere medie.

### PAT-INF-06
**Probe, recepție și punere în funcțiune cu operatorul de distribuție — tarife și cuplare**  · încredere ridicata · vechi: —

- **Trigger:** DA nu spune cine solicită/plătește prezența delegatului OSD la probe și recepții și cine execută cuplarea la rețeaua existentă _(caută în: caiet_sarcini, F3; detecție: camp_lipsa)_
- **Documente de verificat:** Caiet de sarcini; Liste de cantități (probe, cuplări); Aviz tehnic de racordare / acord OSD
- **Cerințe:** `REQ-TG-083` Ordin ANRE 89/2018 (NTPEE-2018) art. 268 alin. (1); `REQ-TG-007` Legea 123/2012 — Titlul II Gaze naturale art. 162 alin. (1); `REQ-TG-080` Ordin ANRE 89/2018 (NTPEE-2018) art. 254 lit. a)-c), f); `REQ-TG-099` Ordin ANRE 89/2018 (NTPEE-2018) art. 296 alin. (1)-(2)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați cine solicită și cine suportă eventualele tarife ale operatorului de distribuție pentru participarea la probe, la recepția lucrărilor ascunse și la punerea în funcțiune, precum și dacă racordarea la rețeaua existentă (cuplarea) se execută de ofertant sau de operator.

- 🔒 **Impact intern (nu se trimite):** tehnic — Cuplarea sub presiune cere echipamente/proceduri OSD. · cost — Tarife OSD, echipe de cuplare. · risc — Scăzut.

### PAT-INF-07
**Localitate cu concesiune a serviciului de distribuție gaze**  · încredere medie · vechi: CL-P04

- **Trigger:** localitatea din obiect are concesionar al distribuției; DA nu spune dacă investiția e în obligațiile concesionarului și cine preia rețeaua în exploatare _(caută în: fisa_de_date, caiet_sarcini; detecție: judecata_umana)_
- **Documente de verificat:** Fișa de date; Studiu de fezabilitate / memoriu; Avize OSD
- **Cerințe:** —
- **Precedente CNSC:** BO2026_2669

> **Întrebare (text extern):** Vă rugăm să precizați dacă pentru [localitate] există un contract de concesiune a serviciului de distribuție a gazelor naturale, care este operatorul de distribuție și cine va prelua rețeaua în exploatare după recepție.

- 🔒 **Impact intern (nu se trimite):** tehnic — Avizele și recepția depind de concesionar. · cost — Poate apărea anularea procedurii (cost ofertare pierdut). · risc — Procedura poate fi anulată (BO2026_2669).
- **Notă:** Fără requirement_id; temei doar precedentul CNSC.

### PAT-INF-08
**Apă: lipsesc presiunea de încercare și pierderea admisibilă; ediția NP 133 neclară**  · încredere ridicata · vechi: CL-T04

- **Trigger:** CS/proiectul de apă nu indică presiunea de probă și pierderea de presiune admisibilă pe tronsoane sau nu spune dacă e elaborat pe NP 133-2013 ori NP 133-2022 _(caută în: caiet_sarcini, planse; detecție: camp_lipsa)_
- **Documente de verificat:** Caiet de sarcini (probe); Memoriu tehnic; Planșe
- **Cerințe:** `REQ-TG-149` NP 133-2022 vol. I (Ordin MDLPA 15/2023) Ordin MDLPA 15/2023 art. 3; `REQ-TG-151` NP 133-2022 vol. I (Ordin MDLPA 15/2023) cap. 9 (Rețele de distribuție), cerințe privind execuția, alin. (9); `REQ-TG-152` NP 133-2022 vol. I (Ordin MDLPA 15/2023) cap. 9, alin. (9) lit. f); `REQ-TG-153` NP 133-2022 vol. I (Ordin MDLPA 15/2023) cap. 9, alin. (10); `REQ-TG-157` NP 133-2022 vol. I (Ordin MDLPA 15/2023) cap. 9, alin. (13)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Caietul de sarcini ([cap. …]) nu indică presiunea de încercare și pierderea de presiune admisibilă pentru tronsoanele [X], valori care, potrivit NP 133-2022 vol. I, cap. 9 alin. (13), se stabilesc prin proiect. Vă rugăm să le comunicați și să precizați dacă proiectul este elaborat în baza NP 133-2013 sau a NP 133-2022.

- 🔒 **Impact intern (nu se trimite):** tehnic — Fără valori, proba nu poate fi declarată reușită. · cost — Durata/repetarea probelor. · risc — Scăzut.
- **Notă:** Corectură runda 1: trimiterea la „7.3.6 alin. (2)” înlocuită cu cap. 9 alin. (13) (REQ-TG-157).

### PAT-INF-09
**Verificarea izolației conductei de oțel după umplerea șanțului — metodă și criteriu**  · încredere ridicata · vechi: CL-T10

- **Trigger:** CS cere „verificarea izolației” fără metodă, lungime de tronson, criteriu de acceptare sau articol în F3 _(caută în: caiet_sarcini, F3; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Liste de cantități
- **Cerințe:** `REQ-TG-080` Ordin ANRE 89/2018 (NTPEE-2018) art. 254 lit. a)-c), f); `REQ-TG-097` Ordin ANRE 89/2018 (NTPEE-2018) art. 286 lit. e)-f); `REQ-TG-081` Ordin ANRE 89/2018 (NTPEE-2018) art. 262 alin. (1)-(4)
- **Precedente CNSC:** —

> **Întrebare (text extern):** NTPEE, art. 254, prevede verificarea rezistenței izolației după umplerea șanțului, consemnată în PV de lucrări ascunse cu buletin de laborator autorizat. Vă rugăm să precizați metoda de verificare cerută, lungimea tronsoanelor, criteriul de acceptare și articolul din listele de cantități în care se cuprinde.

- 🔒 **Impact intern (nu se trimite):** tehnic — Metode diferite (rezistență izolație / DCVG / PCM) au echipamente diferite. · cost — Laborator autorizat, repetări. · risc — Scăzut.

### PAT-INF-10
**Protecția catodică — inclusă sau nu în obiect** · ⚖️ review juridic · încredere scazuta · vechi: CL-T12

- **Trigger:** conductă de oțel îngropată; CS/F3 nu precizează dacă se execută stația de protecție catodică, anozi, prize sau doar posturi de măsurare și piese electroizolante _(caută în: caiet_sarcini, F3, planse; detecție: judecata_umana)_
- **Documente de verificat:** Caiet de sarcini; Liste de cantități; Planșe
- **Cerințe:** `REQ-TG-110` SR EN 12954 (EN 12954:2019) NTPEE anexa 2 poz. 49 + STAS 7335 (poz. 38-46)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați dacă obiectul contractului include realizarea protecției catodice (stație, anozi, prize de pământ) sau numai posturile de măsurare și piesele electroizolante și, în primul caz, măsurătorile cerute la recepție.

- 🔒 **Impact intern (nu se trimite):** tehnic — Domeniu de lucrări diferit (specialitate distinctă). · cost — Semnificativ dacă include stația. · risc — Scăzut.
- **Notă:** temei de confirmat: șablonul vechi cita NTPEE art. 263 și SR EN 12954 / EN ISO 15589-1:2026 — fără cerință verificată (REQ-TG-110 neverificat, standard licențiat). Citările au fost scoase din întrebare.

### PAT-INF-11
**Valoarea estimată pe lot/obiect nu este publicată**  · încredere ridicata · vechi: CL-C01

- **Trigger:** fișa de date dă doar VE totală (sau cu TVA / fără precizarea opțiunilor și a diverselor și neprevăzutelor) _(caută în: fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Fișa de date; Anunț de participare
- **Cerințe:** `REQ-AD-066` HG 395/2016 art. 136 alin. (4)
- **Precedente CNSC:** BO2025_647

> **Întrebare (text extern):** Vă rugăm să precizați valoarea estimată fără TVA pentru fiecare lot/obiect și dacă aceasta include [opțiunile / cheltuielile diverse și neprevăzute].

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Reperul pentru pragul de preț aparent neobișnuit de scăzut. · risc — Indirect: pragul de 80 % declanșează justificarea prețului.
- **Notă:** Corectură runda 1: motivul (pragul de 80 %) nu se mai menționează în întrebare — ar dezvălui strategia de preț.

### PAT-INF-12
**Formularele de extrase de resurse (C6–C9) sunt cerute, dar nepublicate**  · încredere medie · vechi: CL-C06

- **Trigger:** fișa de date cere C6–C9 / extrase de resurse, dar formularele nu sunt în SEAP sau F3 nu are coloanele de resurse _(caută în: fisa_de_date, F3; detecție: camp_lipsa)_
- **Documente de verificat:** Fișa de date; Formulare publicate
- **Cerințe:** `REQ-AD-129` Ordin MLPTL 1568/2002 — Ghid P91/1-02 pct. 2.4
- **Precedente CNSC:** —

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită formularele [C6–C9]. Vă rugăm să le publicați în format editabil sau să confirmați că se acceptă extrasele de resurse generate de programul de deviz al ofertantului, cu conținutul cerut (resursă, UM, cantitate, preț unitar, valoare).

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Timp de reformatare. · risc — Mediu: formular lipsă = neconformitate formală posibilă.
- **Notă:** Ghidul P91/1-02 (REQ-AD-129) nu e verificat pe sursă — nu se citează.

## Formulări ambigue

### PAT-AMB-01
**P+E: se cer la ofertă documente care rezultă abia din proiectul tehnic**  · încredere ridicata · vechi: CL-A08

- **Trigger:** contract de proiectare + execuție, iar fișa de date cere la ofertă liste de cantități, extrase de resurse, planșă de organizare sau alte elemente de PT _(caută în: fisa_de_date, caiet_sarcini; detecție: judecata_umana)_
- **Documente de verificat:** Fișa de date; Caiet de sarcini / tema de proiectare
- **Cerințe:** `REQ-AD-122` 3657/C1/4067, 4182 motivare (L98 art. 187, 189; HG 907/2016 art. 12); `REQ-AD-123` HG 907/2016 Anexa (conținut-cadru PT), Secțiunea V — Formularul F3, Precizări
- **Precedente CNSC:** BO2024_3657

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită la ofertă [liste de cantități / extrase de resurse / planșa de organizare de șantier], iar obiectul contractului include elaborarea proiectului tehnic. Vă rugăm să precizați dacă aceste documente se depun la ofertă sau se elaborează după semnarea contractului și, în primul caz, pe ce bază de cantități se întocmesc.

- 🔒 **Impact intern (nu se trimite):** tehnic — Documente fără bază tehnică (PT inexistent). · cost — Efort de ofertare nejustificat. · risc — Mediu: neconformitate pentru document lipsă.

### PAT-AMB-02
**Factori de evaluare: noțiuni nedefinite, documente inexistente sau angajamente fără mod de verificare** · ⚖️ review juridic · încredere medie · vechi: CL-P02, CL-P03

- **Trigger:** algoritmul unui factor folosește termeni nedefiniți („tronson”, „adecvat”, „detaliat”) sau trimite la un document nepublicat (PT la P+E) / SAU: factorul punctează elemente fără legătură directă cu obiectul (angajați din comună, vehicule electrice, instruiri) sau fără mecanism de verificare în execuție _(caută în: fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date — factori de evaluare; Documente publicate (SF/DALI/PT); Model de contract (penalități pentru nerespectare)
- **Cerințe:** `REQ-AD-121` 1837/C1/1961 motivare (L98 art. 154 alin. (1), art. 187, 189); `REQ-AD-122` 3657/C1/4067, 4182 motivare (L98 art. 187, 189; HG 907/2016 art. 12)
- **Precedente CNSC:** BO2025_1837, BO2024_3657

> **Întrebare (text extern):** Pentru factorul de evaluare [denumire], vă rugăm să definiți noțiunea de [tronson / unitate de punctare] și să indicați documentul publicat din care rezultă [tronsoanele / lungimile], respectiv documentul la care se raportează ofertanții în condițiile în care proiectul tehnic se elaborează în cadrul contractului. Pentru factorul [denumire], vă rugăm să precizați și modul în care va fi verificat pe durata contractului angajamentul asumat prin ofertă și consecințele contractuale ale nerespectării lui.

- 🔒 **Impact intern (nu se trimite):** tehnic — Punctaj imposibil de calculat obiectiv. · cost — Ofertă tehnică construită pe ipoteze. Angajamente operaționale greu de respectat. · risc — Risc de punctare arbitrară; procedura poate fi anulată (BO2025_1837). Mediu; un factor favorizant poate fi contestat (BO2024_3657).
- **Notă:** Contestarea factorului e posibilă dacă răspunsul nu clarifică — decizie juridică. Contopit cu: Factori de evaluare „locali” (angajați din zonă, vehicule, training) fără mod de verificare. Corectură runda 1: formularea „considerăm că favorizează operatorii locali… solicităm eliminarea” a fost scoasă (argumentație juridică agresivă). Contestarea se decide separat.

### PAT-AMB-03
**Rețete de consum și distanțe de transport ale proiectantului — obligatorii sau orientative** · ⚖️ review juridic · încredere medie · vechi: CL-C04, CL-C05

- **Trigger:** F3/analizele de preț/răspunsurile AC impun „rețetele proiectantului”, consumuri sau o distanță de transport fixă _(caută în: F3, caiet_sarcini, raspunsuri_clarificari; detecție: cuvant_cheie)_
- **Documente de verificat:** F3 și analize de preț publicate; Răspunsuri la clarificări; Caiet de sarcini
- **Cerințe:** `REQ-AD-130` BO2018_6476 (contestația 195/06.02.2018, nr. anonimizat) motivare (Ghid P91/1-02 pct. 1.4, 2.2.3, 3.3.1.4); `REQ-AD-127` Ordin MLPTL 1568/2002 — Ghid P91/1-02 pct. 1.4 și pct. 3.3.1.4; `REQ-AD-128` Ordin MLPTL 1568/2002 — Ghid P91/1-02 pct. 2.2.3; `REQ-AD-131` HG 907/2016 Formular F3 coloana 3 (cantitate) — coroborat cu Decizia CNSC BO2026_3104; `REQ-AD-133` Ordin MLPTL 1568/2002 — Ghid P91/1-02 pct. 1.4 / 3.3.1.4 (consumuri proprii)
- **Precedente CNSC:** BO2018_6476

> **Întrebare (text extern):** Pentru articolele din Formularul F3 aferente [obiect/categorie], vă rugăm să precizați dacă consumurile de resurse (manoperă, utilaj, transport) și distanța de transport de [x] km indicate în [analizele de preț / documentația proiectantului] sunt obligatorii sau orientative, în condițiile respectării integrale a cantităților din F3 și a cerințelor din caietul de sarcini.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Diferențe de preț unitar. · risc — Mediu: abaterea de la consumuri declarate obligatorii poate duce la neconformitate; reducerea cantităților de material nu e permisă (REQ-AD-131).
- **Notă:** P91/1-02 (REQ-AD-127/128) citit doar indirect, prin BO2018_6476 — nu se citează în întrebare. Un singur precedent CNSC, din 2018.

### PAT-AMB-04
**Preț unitar unic pe resursă în toate devizele**  · încredere ridicata · vechi: CL-C08

- **Trigger:** fișa de date/formularele cer (sau nu exclud) prețuri unitare identice pentru aceeași resursă în devize diferite _(caută în: fisa_de_date, F3; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date; Instrucțiuni de completare formulare
- **Cerințe:** `REQ-AD-135` 1923/C9/... (nr. dosar anonimizat în BO2022_1923) motivare (L98 art. 209–210; HG 395 art. 134, 136–137)
- **Precedente CNSC:** BO2022_1923

> **Întrebare (text extern):** Vă rugăm să precizați dacă pentru aceeași resursă (material, manoperă, utilaj) prețul unitar trebuie să fie identic în toate devizele pe obiect și dacă este permisă diferențierea costului de transport pe obiecte.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Uniformizare prețuri. · risc — Mediu: diferențe nejustificate → respingere la PANS (BO2022_1923).

### PAT-AMB-05
**Plafon procentual pentru cheltuieli indirecte, profit sau organizare de șantier** · ⚖️ review juridic · încredere scazuta · vechi: CL-C02

- **Trigger:** formularele sau fișa de date impun un procent maxim pentru indirecte/profit/OS _(caută în: fisa_de_date, F3; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date; F1–F5
- **Cerințe:** `REQ-AD-124` HG 907/2016 Formularul F3 — structura totalurilor
- **Precedente CNSC:** —

> **Întrebare (text extern):** Fișa de date / formularul [denumire] (pag. […]) prevede un plafon de [x] % pentru [cheltuieli indirecte / profit / organizare de șantier]. Vă rugăm să precizați dacă depășirea acestui plafon conduce la respingerea ofertei sau dacă valoarea are caracter orientativ.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Structura prețului constrânsă. · risc — Mediu.
- **Notă:** temei de confirmat: runda 1 invoca abateri semnalate de ANAP în control ex-ante — sursă necitită în runda 2.

### PAT-AMB-06
**Autorizări speciale (topografie OCPI, aviz GA, ANRE, RTE pe domenii) — la ofertă sau la execuție** · ⚖️ review juridic · încredere ridicata · vechi: CL-B22

- **Trigger:** CS menționează activități care cer autorizări (OCPI, gospodărire ape, ANRE, RTE), dar fișa de date nu spune dacă dovada se cere la ofertă _(caută în: fisa_de_date, caiet_sarcini; detecție: comparatie_documente)_
- **Documente de verificat:** Fișa de date — cerințe de calificare; Caiet de sarcini
- **Cerințe:** `REQ-AD-032` 1706/C7/1650/1651 motivare (L98 art. 215; HG 395 art. 137); `REQ-AD-029` Legea 98/2016 art. 173 alin. (1)
- **Precedente CNSC:** BO2022_1746, BO2024_1706, BO2021_159

> **Întrebare (text extern):** Caietul de sarcini ([cap. …]) prevede activitatea [denumire], pentru care este necesară [autorizarea …]. Vă rugăm să precizați dacă dovada acestei autorizări se solicită la depunerea ofertei sau va fi verificată la începerea execuției.

- 🔒 **Impact intern (nu se trimite):** tehnic — Subcontractant autorizat necesar. · cost — Cost subcontractare. · risc — Mediu: autorizările necerute expres nu pot fi motiv de respingere (BO2024_1706), dar verificarea în execuție rămâne.
- **Notă:** BO2021_159 — nuanță: CNSC a obligat AC să verifice capacitatea legală (direct sau prin subcontractanți), nu a declarat oferta neconformă.

### PAT-AMB-07
**Verificarea îmbinărilor din PE — alte încercări decât examinarea vizuală**  · încredere ridicata · vechi: CL-T13

- **Trigger:** CS nu precizează dacă la PE se cer încercări pe îmbinări de probă/nedistructive sau cere „încercări conform standardelor” fără frecvență _(caută în: caiet_sarcini, F3; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Liste de cantități
- **Cerințe:** `REQ-TG-077` Ordin ANRE 89/2018 (NTPEE-2018) art. 245; `REQ-TG-078` Ordin ANRE 89/2018 (NTPEE-2018) art. 246; `REQ-TG-109` SR EN 13100-1/-2/-3 NTPEE anexa 2 poz. 57-59 + art. 245
- **Precedente CNSC:** —

> **Întrebare (text extern):** NTPEE, art. 245, prevede pentru îmbinările din polietilenă control vizual și, după caz, nedistructiv conform proiectului. Vă rugăm să precizați dacă se solicită și alte verificări decât examinarea vizuală, metodele, frecvența și articolul din listele de cantități în care se cuprind.

- 🔒 **Impact intern (nu se trimite):** tehnic — Încercări pe epruvete/laborator. · cost — Laborator, îmbinări de probă. · risc — Scăzut.
- **Notă:** SR EN 13100 / 12814 (REQ-TG-109) sunt recomandate (anexa 2), neverificate — nu se citează.

### PAT-AMB-08
**Răspunsul AC la o clarificare este evaziv sau incomplet** · ⚖️ review juridic · încredere ridicata · vechi: CL-P05, CL-P06

- **Trigger:** răspunsul reconfirmă generic DA („DA respectă legislația”, „conform caietului de sarcini”) sau nu tratează aspectul întrebat _(caută în: raspunsuri_clarificari; detecție: judecata_umana)_
- **Documente de verificat:** Răspunsuri la clarificări; Întrebarea inițială
- **Cerințe:** `REQ-AD-002` Legea 98/2016 art. 160 alin. (2); `REQ-AD-008` 2938/2024 (BO, nr. complet anonimizat) dispozitiv + motivare (art. 160 L98, art. 21 HG 395); `REQ-AD-083` Legea 101/2016 art. 8 alin. (1) lit. a)–b); `REQ-AD-084` 182/C8/4870 pct. I (admisibilitate) — calculul termenului
- **Precedente CNSC:** BO2024_2938, BO2023_2119

> **Întrebare (text extern):** Revenim la întrebarea nr. [X] din [data]. Răspunsul publicat la [data] nu precizează [aspectul Y]. Vă rugăm să comunicați [valoarea / documentul / opțiunea] solicitată.

- 🔒 **Impact intern (nu se trimite):** tehnic — Ipoteza rămâne deschisă. · cost — Depinde. · risc — Răspunsul evaziv poate fi contestat (BO2024_2938); termenul curge de la publicarea răspunsului.
- **Notă:** Corectură runda 1: CL-P06 menționa „termenul de contestare de 10 zile” — corect 10 zile peste prag / 7 zile sub prag (L101 art. 8 alin. (1); BO2023_2119, REQ-AD-083). Urmărirea termenului: PAT-TRM-03.

## Cantități

### PAT-CNT-01
**Extinderea controlului nedistructiv la sudurile din oțel și includerea lui în deviz**  · încredere ridicata · vechi: CL-T06, CL-C03

- **Trigger:** CS spune „suduri controlate nedistructiv conform normativelor” fără procent/metodă, sau F3 nu are articol pentru CND și buletine de laborator _(caută în: caiet_sarcini, F3; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Liste de cantități; Planșe (poziția sudurilor de poziție)
- **Cerințe:** `REQ-TG-068` Ordin ANRE 89/2018 (NTPEE-2018) art. 238 alin. (3)-(4); `REQ-TG-069` Ordin ANRE 89/2018 (NTPEE-2018) art. 238 alin. (5); `REQ-TG-070` Ordin ANRE 89/2018 (NTPEE-2018) art. 224 alin. (2)-(3); `REQ-TG-096` Ordin ANRE 89/2018 (NTPEE-2018) art. 286 lit. d); `REQ-TG-026` Ordin ANRE 17/2026 anexa 3, pct. 6
- **Precedente CNSC:** —

> **Întrebare (text extern):** Caietul de sarcini ([cap. …]) prevede „[citat]”, fără a preciza extinderea controlului nedistructiv. NTPEE, art. 238 alin. (4)–(5), prevede control nedistructiv obligatoriu la conductele subterane din oțel și pentru toate sudurile de poziție. Vă rugăm să precizați procentul de suduri examinate (altele decât sudurile de poziție), metoda de examinare și articolul din listele de cantități în care se cuprind examinările și buletinele de laborator.

- 🔒 **Impact intern (nu se trimite):** tehnic — Volumul CND determină laboratorul și durata. · cost — Semnificativ (RT/UT pe sudură). · risc — Scăzut.

### PAT-CNT-02
**Elemente cerute de normativ lipsă din F3 (fir trasor, bandă de avertizare; la apă: ridicare topografică, spălare, dezinfecție)**  · încredere medie · vechi: —

- **Trigger:** conductă PE fără articol pentru fir trasor/cutii de acces sau conductă subterană fără bandă de avertizare în F3 / SAU: rețea de apă fără articole pentru spălare/dezinfecție sau pentru ridicarea topografică înainte de umplutură (format GIS al operatorului) _(caută în: F3, caiet_sarcini; detecție: camp_lipsa)_
- **Documente de verificat:** Liste de cantități; Planșe; Caiet de sarcini
- **Cerințe:** `REQ-TG-060` Ordin ANRE 89/2018 (NTPEE-2018) art. 203 alin. (1)-(3), (5); `REQ-TG-061` Ordin ANRE 89/2018 (NTPEE-2018) art. 216; `REQ-TG-158` NP 133-2022 vol. I (Ordin MDLPA 15/2023) cap. 9, alin. (15)-(16); `REQ-TG-159` NP 133-2022 vol. I (Ordin MDLPA 15/2023) 7.3.7 (trimis din cap. 9 alin. 17)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Listele de cantități pentru [obiect] nu conțin articole pentru [element], prevăzut de [NTPEE, art. 203 (fir trasor) / NTPEE, art. 216 (bandă de avertizare) / NP 133-2022 vol. I, cap. 9 alin. (15)–(16) (ridicare topografică)]. Vă rugăm să precizați articolul în care este cuprins sau să publicați lista de cantități completată.

- 🔒 **Impact intern (nu se trimite):** tehnic — Obligatorii la recepție. Fără releveu, recepția se blochează. · cost — Material + manoperă pe toată lungimea. Topograf, analize apă. · risc — Scăzut (cantitățile nu se modifică în ofertă). Scăzut.
- **Notă:** Contopit cu: Apă: spălare, dezinfecție și ridicare topografică as-built fără articol în F3. REQ-TG-159 (dezinfecție) are încredere medie — nu se citează.

### PAT-CNT-03
**Traversări de obstacole (drum național, cale ferată, curs de apă) — metodă, tub de protecție, avize și condițiile lor**  · încredere medie · vechi: —

- **Trigger:** planșele arată subtraversare DN/CF/tramvai fără lungime/diametru de tub de protecție în F3 sau fără metoda de execuție (foraj vs șanț deschis) / SAU: planșele arată traversarea unui curs de apă/dig, iar avizul de gospodărire a apelor nu e anexat sau condițiile lui nu se regăsesc în F3 _(caută în: planse, F3, caiet_sarcini; detecție: comparatie_documente)_
- **Documente de verificat:** Planșe (profil subtraversare); Liste de cantități; Avize CNAIR / CFR; Planșe (profil traversare); Aviz de gospodărire a apelor
- **Cerințe:** `REQ-SC-064` Ordin MTI 1668/2023 Anexă pct. 3.4.4 alin. (1)–(2); `REQ-SC-068` Ordin MTI 1668/2023 Anexă pct. 3.4.7 alin. (1)–(2); `REQ-SC-084` Ordin ANRE 89/2018 (NTPEE-2018) art. 178 alin. (2)–(4); `REQ-SC-086` Ordin ANRE 89/2018 (NTPEE-2018) art. 30, tabelul nr. 1 poz. 10; `REQ-SC-082` Ordin ANRE 89/2018 (NTPEE-2018) art. 85 alin. (1)–(2); `REQ-SC-087` Legea 107/1996 art. 48 alin. (1) lit. e); `REQ-SC-088` Legea 107/1996 art. 50 alin. (1); `REQ-SC-089` Legea 107/1996 art. 49 alin. (3^1); `REQ-SC-091` Ordin MAP 828/2019 Anexa 1 art. 31; `REQ-SC-093` Ordin MAP 828/2019 Anexa 2 art. 23 lit. d), h), j)
- **Precedente CNSC:** BO2021_159

> **Întrebare (text extern):** Pentru [subtraversarea DN … / căii ferate … / traversarea cursului de apă …] din [planșa …], vă rugăm să precizați metoda de execuție, lungimea și diametrul tubului de protecție, să ne transmiteți avizele obținute ([administrator drum / infrastructură feroviară / gospodărire a apelor]) și să precizați dacă condițiile impuse prin acestea sunt cuprinse în listele de cantități.

- 🔒 **Impact intern (nu se trimite):** tehnic — Foraj orizontal obligatoriu sub DN, gropi în afara zonei de siguranță. Avizul impune adâncime sub talveg și notificarea începerii execuției. · cost — Foraj, tub OL, cămine/aerisiri. Foraj/subtraversare, protecții de mal. · risc — Scăzut.
- **Notă:** Contopit cu: Traversare de curs de apă — avizul de gospodărire a apelor și condițiile lui. Cerințele SC-087…093 au încredere medie (text consolidat neconfirmat).

### PAT-CNT-04
**Deșeuri din construcții — transport, eliminare/valorificare, distanță**  · încredere ridicata · vechi: —

- **Trigger:** F3 are desfaceri (asfalt, beton, pământ excedentar) fără articol de transport/eliminare sau fără distanța până la operatorul autorizat _(caută în: F3, caiet_sarcini; detecție: camp_lipsa)_
- **Documente de verificat:** Liste de cantități; Caiet de sarcini; Autorizație de construire (plan gestionare deșeuri)
- **Cerințe:** `REQ-SC-095` OUG 92/2021 art. 17 alin. (4); `REQ-SC-096` OUG 92/2021 art. 17 alin. (7); `REQ-SC-097` OUG 92/2021 art. 23 alin. (1); `REQ-SC-099` OUG 92/2021 art. 48 alin. (1), (5)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați dacă transportul și predarea către operatori autorizați a deșeurilor din construcții (inclusiv materialele din desfaceri și pământul excedentar) sunt în sarcina executantului, distanța de transport avută în vedere și articolele din listele de cantități în care se cuprind.

- 🔒 **Impact intern (nu se trimite):** tehnic — Evidență lunară și raportare ANPM. · cost — Transport + taxe de depozitare. · risc — Scăzut.

## Standarde și specificații tehnice

### PAT-STD-01
**Probă de etanșeitate „24 de ore” pentru orice tronson sau branșament**  · încredere ridicata · vechi: CL-T01

- **Trigger:** CS cere probă de etanșeitate 24 h fără referire la volumul tronsonului (regex: 'etan[șs]eitate.{0,40}24\s*(h/ore)') _(caută în: caiet_sarcini; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini (probe); Grafic de execuție
- **Cerințe:** `REQ-TG-088` Ordin ANRE 89/2018 (NTPEE-2018) art. 273 alin. (2), Tabelul nr. 8^1 (Ord. 2/2023); `REQ-TG-087` Ordin ANRE 89/2018 (NTPEE-2018) art. 273 alin. (1); `REQ-TG-086` Ordin ANRE 89/2018 (NTPEE-2018) art. 272 lit. a); `REQ-TG-089` Ordin ANRE 89/2018 (NTPEE-2018) art. 275-276, Tabelul nr. 9
- **Precedente CNSC:** —

> **Întrebare (text extern):** Caietul de sarcini ([cap. …]) prevede o durată de 24 de ore pentru proba de etanșeitate a [tronsoanelor / branșamentelor]. NTPEE, art. 273 alin. (2) și Tabelul nr. 8^1, stabilește durata probei în funcție de volumul tronsonului. Vă rugăm să precizați dacă durata se stabilește conform NTPEE sau dacă se solicită expres 24 de ore pentru toate tronsoanele și, în al doilea caz, dacă această durată este avută în vedere în termenul de execuție de [N] zile.

- 🔒 **Impact intern (nu se trimite):** tehnic — Mobilizare echipamente de înregistrare, durată. · cost — Ore de echipă/utilaj suplimentare la branșamente. · risc — Scăzut.

### PAT-STD-02
**Material sau SDR incompatibil cu treapta de presiune (ex. PE 80 la presiune medie)**  · încredere ridicata · vechi: CL-T02

- **Trigger:** presiunea de proiect > 4 bar și materialul indicat este PE 80, sau SDR nespecificat/diferit între documente _(caută în: planse, F3, caiet_sarcini; detecție: comparatie_documente)_
- **Documente de verificat:** Planșe; Liste de cantități; Memoriu tehnic (regim de presiune)
- **Cerințe:** `REQ-TG-055` Ordin ANRE 89/2018 (NTPEE-2018) art. 20 alin. (2); `REQ-TG-056` Ordin ANRE 89/2018 (NTPEE-2018) art. 177 alin. (1)-(2); `REQ-TG-053` Ordin ANRE 89/2018 (NTPEE-2018) art. 19 alin. (1)
- **Precedente CNSC:** —

> **Întrebare (text extern):** În [planșa / lista de cantități poz. X] conducta este indicată din [PE 80, SDR …], iar regimul de presiune din memoriu este [… bar]. NTPEE, art. 20 alin. (2), admite PE 80 numai până la 4 bar. Vă rugăm să precizați materialul și SDR-ul care trebuie ofertate.

- 🔒 **Impact intern (nu se trimite):** tehnic — Material neconform la recepție. · cost — Diferență de preț PE 80/PE 100 și SDR. · risc — Scăzut dacă se clarifică; ridicat pe execuție.

### PAT-STD-03
**Adâncime de pozare sub 0,9 m sau distanțe față de alte rețele sub minimele NTPEE / ANRE electric**  · încredere ridicata · vechi: CL-T03

- **Trigger:** profilul longitudinal indică acoperire < 0,9 m (≠ capăt branșament) sau distanțe față de canalizare/apă/cabluri sub tabelul 1 NTPEE / anexa 4b Ord. 239/2019, fără soluție de protecție _(caută în: planse, caiet_sarcini, F3; detecție: calcul)_
- **Documente de verificat:** Profile longitudinale; Planșe de situație; Liste de cantități (tuburi de protecție); Avize deținători rețele
- **Cerințe:** `REQ-TG-059` Ordin ANRE 89/2018 (NTPEE-2018) art. 75 alin. (1)-(2), (4); `REQ-SC-114` Ordin ANRE 89/2018 (NTPEE-2018) art. 29; art. 30, tabelul nr. 1 poz. 4–6; `REQ-SC-115` Ordin ANRE 89/2018 (NTPEE-2018) art. 82 alin. (1)–(3); `REQ-SC-119` Ordin ANRE 239/2019 anexa nr. 4b; `REQ-SC-120` Ordin ANRE 239/2019 art. 33 alin. (2)–(4)
- **Precedente CNSC:** —

> **Întrebare (text extern):** În [planșa X], conducta este pozată la [0,6 m] adâncime / la [0,4 m] de [rețeaua …]. NTPEE prevede adâncimea minimă de 0,9 m (art. 75), cu reducere numai prin soluția proiectantului și acordul operatorului, respectiv distanțele minime din Tabelul nr. 1 (art. 30). Vă rugăm să precizați soluția de protecție prevăzută, dacă există acordul operatorului de distribuție și dacă elementele de protecție sunt cuprinse în listele de cantități.

- 🔒 **Impact intern (nu se trimite):** tehnic — Neconformitate la recepția OSD. · cost — Tuburi de protecție, săpătură suplimentară. · risc — Scăzut.
- **Notă:** Corectură runda 1: trimiterile la NTPEE art. 35 și 35^1 (evaluare de risc, răsuflători) nu au cerință verificată — scoase din întrebare.

### PAT-STD-04
**Canalizare: metoda probei de etanșeitate, criteriul de acceptare și inspecția CCTV**  · încredere ridicata · vechi: CL-T05, CL-T14

- **Trigger:** CS cere probă cu aer sau fără criteriu, sau F3 nu are articol pentru CCTV/probe _(caută în: caiet_sarcini, F3; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Liste de cantități
- **Cerințe:** `REQ-TG-160` NP 133-2022 vol. II (Ordin MDLPA 14/2023) 3.6.1 alin. (10); `REQ-TG-161` NP 133-2022 vol. II (Ordin MDLPA 14/2023) 3.6.1 alin. (10) lit. b) pct. iii)-v); `REQ-TG-162` NP 133-2022 vol. II (Ordin MDLPA 14/2023) 3.6.1 alin. (11) (runda 1); `REQ-TG-163` NP 133-2022 vol. II (Ordin MDLPA 14/2023) 3.6.1 alin. (9) și alin. (10) lit. ... (raport CCTV); `REQ-TG-165` SR EN 1610:2015 —
- **Precedente CNSC:** —

> **Întrebare (text extern):** NP 133-2022 vol. II, 3.6.1, prevede inspecția CCTV a tronsoanelor supuse probei și proba de etanșeitate cu apă. Caietul de sarcini ([cap. …]) prevede [proba cu aer / nu precizează criteriul]. Vă rugăm să precizați metoda de probă cerută, volumul admisibil de apă adăugată și articolele din listele de cantități în care se cuprind inspecția CCTV și probele.

- 🔒 **Impact intern (nu se trimite):** tehnic — CCTV prin contractor specializat. · cost — CCTV + apă + repetări. · risc — Scăzut.
- **Notă:** Corectură runda 1: precedentul „2344/2025” atașat la CL-T14 privește subcontractarea și PANS, nu CCTV — eliminat. SR EN 1610 (REQ-TG-165) necesită standard licențiat.

### PAT-STD-05
**„Clasa de calitate II” a sudurilor fără nivel de acceptare și criterii CND**  · încredere medie · vechi: CL-T07

- **Trigger:** CS/proiectul indică „clasa II” fără nivel de calitate și criterii de acceptare pentru examinarea radiografică/ultrasonică _(caută în: caiet_sarcini; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Memoriu tehnic
- **Cerințe:** `REQ-TG-067` Ordin ANRE 89/2018 (NTPEE-2018) art. 238 alin. (1)-(2); `REQ-TG-054` Ordin ANRE 89/2018 (NTPEE-2018) art. 6 alin. (2) + titlul anexei nr. 2; `REQ-TG-103` SR EN 12732+A1:2014 NTPEE art. 235 alin. (4) + anexa 2 poz. 37
- **Precedente CNSC:** —

> **Întrebare (text extern):** NTPEE, art. 238 alin. (1)–(2), prevede clasa de calitate II pentru îmbinările sudate din oțel, cu indicarea clasei în proiect. Vă rugăm să precizați nivelul de calitate și criteriile de acceptare pentru examinarea nedistructivă care se vor aplica la recepție (standardul și ediția).

- 🔒 **Impact intern (nu se trimite):** tehnic — Criteriu de acceptare = rata de respingere a sudurilor. · cost — Refaceri. · risc — Scăzut.
- **Notă:** Edițiile SR EN ISO 5817:2023 / 17635:2025 din runda 1 nu au cerință verificată (standard licențiat; anexa 2 NTPEE e orientativă) — nu se citează în întrebare.

### PAT-STD-06
**Proceduri de sudare (WPQR): nivel cerut și acceptarea celor existente aprobate ISCIR**  · încredere medie · vechi: CL-T08

- **Trigger:** CS cere WPQR „nivel 1/2” sau proceduri noi fără a spune dacă se acceptă WPQR-urile existente aprobate _(caută în: caiet_sarcini, fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Fișa de date (dacă e cerință de calificare)
- **Cerințe:** `REQ-TG-065` Ordin ANRE 89/2018 (NTPEE-2018) art. 236 alin. (3); `REQ-TG-138` PT CR 7-2025 (Ordin MEDAT 1172/2026) PT CR 7-2025 — domeniu (citit în runda 1); `REQ-TG-124` PT CR 9-2025 (Ordin MEDAT 1172/2026) art. 3-4
- **Precedente CNSC:** —

> **Întrebare (text extern):** NTPEE, art. 236 alin. (3), cere procedee de sudare certificate. Caietul de sarcini ([cap. …]) prevede „[citat]”. Vă rugăm să precizați dacă se acceptă procedurile de sudare existente, aprobate, care acoperă materialul [L245/L290] și domeniul de grosimi [x–y mm], sau dacă sunt necesare calificări noi.

- 🔒 **Impact intern (nu se trimite):** tehnic — Calificare nouă = timp + încercări. · cost — Cost calificare procedură. · risc — Scăzut (mediu dacă e cerință de calificare).
- **Notă:** PT CR 7-2025 (REQ-TG-138) are încredere medie; nivelurile 1/2 din SR EN ISO 15614-1 necesită standard licențiat.

### PAT-STD-07
**Clasa izolației de fabrică, sistemul de izolare a îmbinărilor și pregătirea suprafeței**  · încredere medie · vechi: CL-T09

- **Trigger:** CS folosește terminologie veche („izolație foarte întărită”, STAS) sau nu indică clasa izolației/ sistemul pentru îmbinări _(caută în: caiet_sarcini, F3; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Liste de cantități; Specificația operatorului (dacă e invocată)
- **Cerințe:** `REQ-TG-081` Ordin ANRE 89/2018 (NTPEE-2018) art. 262 alin. (1)-(4); `REQ-TG-118` Distrigaz Sud Rețele ST-TOLNP (2023) ST-TOLNP — țeavă oțel și izolație; `REQ-TG-054` Ordin ANRE 89/2018 (NTPEE-2018) art. 6 alin. (2) + titlul anexei nr. 2
- **Precedente CNSC:** —

> **Întrebare (text extern):** Caietul de sarcini ([cap. …]) descrie izolația conductei de oțel prin „[citat]”. NTPEE, art. 262, prevede izolarea la producător și, pe șantier, doar a îmbinărilor, reparațiilor și ieșirilor din sol. Vă rugăm să precizați clasa izolației de fabrică, sistemul și clasa de izolare a îmbinărilor (bandă / manșon termocontractabil) și gradul de pregătire a suprafeței cerut pe șantier.

- 🔒 **Impact intern (nu se trimite):** tehnic — Manșoane vs bandă; sablare pe șantier. · cost — Diferențe semnificative pe îmbinare. · risc — Scăzut.
- **Notă:** SR EN ISO 21809-1/-3 figurează „NECONFIRMAT” (ofertare_normative id 40); clasa B2/B3 apare doar în ST-TOLNP Distrigaz (REQ-TG-118, obligatorie doar dacă DA o invocă).

### PAT-STD-08
**Trimiteri la acte normative abrogate sau la ediții de standarde înlocuite** · ⚖️ review juridic · încredere medie · vechi: CL-A04, CL-A03

- **Trigger:** DA citează Ordinul MDLPL 863/2008, NTPEE-2008 (Ord. ANRE 5/2009), I 6, articole din Legea 10/1995 sau Legea 50/1991 etc. / SAU: CS citează o ediție de standard înlocuită (ex. listă din runda 1: SR EN 1555, SR EN ISO 17635, SR EN 12954, SR EN 13067, SR EN ISO 15589-1) _(caută în: caiet_sarcini, fisa_de_date, contract; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Fișa de date; Model de contract; Catalog ASRO (ediții în vigoare)
- **Cerințe:** `REQ-AD-126` HG 907/2016 art. 18 alin. (2) lit. b); `REQ-TG-141` Ordin ANRE 5/2009 (NTPEE-2008) Ord. ANRE 89/2018 art. 3; `REQ-TG-140` Normativ I 6-98 —; `REQ-AD-150` Legea 10/1995 (republicata MO 765/30.09.2016) art. 10, art. 41 (rămase în vigoare); `REQ-TG-054` Ordin ANRE 89/2018 (NTPEE-2018) art. 6 alin. (2) + titlul anexei nr. 2; `REQ-TG-062` Ordin ANRE 89/2018 (NTPEE-2018) art. 228 alin. (3) și art. 235 alin. (4)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Documentația ([document, pag. …]) face trimitere la [actul / standardul, ediția …], [abrogat / înlocuit de …]. Vă rugăm să precizați actul normativ în vigoare la care se raportează cerința respectivă (de exemplu, HG nr. 907/2016 în locul Ordinului MDLPL nr. 863/2008, respectiv Normele tehnice aprobate prin Ordinul ANRE nr. 89/2018 în locul NTPEE-2008) și dacă se acceptă produse și proceduri conforme cu ediția standardului în vigoare la data depunerii ofertei.

- 🔒 **Impact intern (nu se trimite):** tehnic — Cerințe tehnice depășite (ex. I 6). Produse certificate pe ediția nouă. · cost — Mic. · risc — Scăzut.
- **Notă:** temei de confirmat pentru Legea 10/1995 / Legea 50/1991 vs Legea 169/2026 (REQ-AD-150 și CATUC neverificate; numerotarea CATUC diferă între surse) și pentru I 6 (REQ-TG-140, surse secundare). Acestea nu se citează în întrebare. Contopit cu: Ediții de standarde depășite în caietul de sarcini. Edițiile din runda 1 trebuie reconfirmate în catalogul ASRO. Anexa 2 NTPEE e orientativă (REQ-TG-054): un standard listat acolo nu e obligatoriu prin lege — obligativitatea vine din DA.

### PAT-STD-09
**DA cere ISCIR (autorizare, verificare, RSVTI) pentru conducte de distribuție, branșamente sau SRM**  · încredere ridicata · vechi: —

- **Trigger:** CS/FD cer 'ISCIR' sau 'RSVTI' în legătură cu conducta de distribuție, racorduri/branșamente, IU sau SRM (nu cu utilaje: compresoare cu recipient, macarale) _(caută în: caiet_sarcini, fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Fișa de date
- **Cerințe:** `REQ-TG-131` Legea 64/2008 (republicată) art. 1 alin. (2) + anexa 1 pct. 3; `REQ-TG-092` Ordin ANRE 89/2018 (NTPEE-2018) art. 281 alin. (2) + Tabel 8 nota **); `REQ-TG-132` Legea 64/2008 (republicată) art. 2 + anexa 2 pct. 2, 3; `REQ-TG-133` Legea 64/2008 (republicată) art. 2 + anexa 2 pct. 4
- **Precedente CNSC:** —

> **Întrebare (text extern):** Caietul de sarcini ([cap. …]) solicită [autorizare / verificare ISCIR / RSVTI] pentru [conducta de distribuție / branșamente / SRM]. Legea nr. 64/2008, art. 1 alin. (2) și anexa 1 pct. 3, exceptează sistemele de distribuție a gazelor naturale de la regimul ISCIR. Vă rugăm să precizați echipamentele la care se referă cerința și documentele care trebuie prezentate.

- 🔒 **Impact intern (nu se trimite):** tehnic — Utilajele (recipiente > 0,5 bar, macarale) rămân sub ISCIR. · cost — Mic. · risc — Scăzut; dacă e cerință de calificare în FD → review juridic.
- **Notă:** Corectură runda 1: ISCIR exclus pe rețelele de distribuție (Legea 64/2008 anexa 1 pct. 3). Sudorii rămân autorizați ISCIR prin PT CR 9-2025 (vezi PAT-CAL-11).

### PAT-STD-10
**Metrologie: aparatele de presiune/temperatură folosite la probe — verificare metrologică vs etalonare**  · încredere medie · vechi: —

- **Trigger:** CS cere „buletin de verificare metrologică BRML” pentru manometre/înregistratoare de probă _(caută în: caiet_sarcini; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Cerințe OSD pentru probe
- **Cerințe:** `REQ-TG-173` Ordin ANRE 89/2018 (NTPEE-2018) art. 274 alin. (1)-(2); `REQ-TG-176` Ordin ANRE 89/2018 (NTPEE-2018) art. 274 alin. (1) vs OG 20/1992 art. 15; `REQ-TG-168` OG 20/1992 art. 15 alin. 1-2; `REQ-TG-170` Ordin BRML 77/2022 — L.O.-2022 anexă, Tabel, poz. 21 (L62); `REQ-TG-179` Ordin BRML 204/2024 —
- **Precedente CNSC:** —

> **Întrebare (text extern):** Caietul de sarcini ([cap. …]) solicită [buletin de verificare metrologică] pentru aparatele de măsură folosite la probe. Vă rugăm să confirmați dacă, pentru aparatele de presiune și temperatură cu înregistrare prevăzute de NTPEE la art. 274, se acceptă certificatul de etalonare emis de un laborator acreditat, cu termenul de valabilitate indicat.

- 🔒 **Impact intern (nu se trimite):** tehnic — Manometrele de probă nu sunt în L.O.-2022 (doar L62-3, pneuri). · cost — Etalonare vs verificare. · risc — Scăzut.
- **Notă:** Ordinul BRML 204/2024 (modifică L.O.-2022) necitit — REQ-TG-179; de reverificat înainte de folosire.

### PAT-STD-11
**Specificațiile tehnice ale operatorului de distribuție și documentele de inspecție pentru materiale (3.1 / 3.2)**  · încredere medie · vechi: CL-T11

- **Trigger:** CS nu spune dacă materialele/echipamentele trebuie să respecte ST ale OSD (ex. ST 505, ST-TGPHD, ST-TOLNP) sau le invocă fără ediție / SAU: CS cere „certificat de calitate” fără tip sau cere 3.2 fără a spune cine numește inspectorul și cine plătește _(caută în: caiet_sarcini; detecție: judecata_umana)_
- **Documente de verificat:** Caiet de sarcini; Aviz OSD; Specificația operatorului
- **Cerințe:** `REQ-TG-115` Delgaz Grid ST 505 (A5, 01.2023) ST 505 — cerințe aparat EF; `REQ-TG-116` Delgaz Grid ST 505 (A5, 01.2023) ST 505 — documente; `REQ-TG-117` Distrigaz Sud Rețele ST-TGPHD (2023) ST-TGPHD — documente și vârstă material; `REQ-TG-118` Distrigaz Sud Rețele ST-TOLNP (2023) ST-TOLNP — țeavă oțel și izolație; `REQ-TG-095` Ordin ANRE 89/2018 (NTPEE-2018) art. 286 lit. c); `REQ-TG-057` Ordin ANRE 89/2018 (NTPEE-2018) art. 173 alin. (1) și (3)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați dacă materialele și echipamentele trebuie să respecte specificațiile tehnice ale operatorului de distribuție [denumire] și, în caz afirmativ, specificațiile și edițiile aplicabile, precum și tipul documentului de inspecție solicitat pentru [țeavă oțel / țeavă PE / fitinguri / robinete / izolație]. Dacă se solicită certificat de tip 3.2, vă rugăm să precizați cine desemnează reprezentantul cumpărătorului și cine suportă costul inspecției.

- 🔒 **Impact intern (nu se trimite):** tehnic — Aparate EF cu cod de bare/memorie, vârstă material la livrare. Termene de livrare mai mari la 3.2. · cost — Furnizori agreați OSD. Inspecție terță. · risc — Scăzut.
- **Notă:** Specificațiile OSD sunt OBLIGATORIE_DOC_ACHIZITIE doar când DA le invocă; altfel bună practică. Contopit cu: Tipul documentului de inspecție pentru materiale (3.1 / 3.2). SR EN 10204 — clauze necitite (standard licențiat); certificatul 3.1 apare în specificațiile Distrigaz (REQ-TG-117/118).

## Calificare

### PAT-CAL-01
**Autorizare ANRE: Ordinul 132/2021 citat, tip neprecizat, cerință lipsă sau tip necorelat cu regimul de presiune** · ⚖️ review juridic · încredere ridicata · vechi: CL-A02, CL-B17

- **Trigger:** FD cere 'autorizație ANRE … conform Ordin 132/2021', nu indică tipul (EDSB/PDSB/…), sau obiectul include gaze și FD nu cere autorizare / SAU: FD cere EDSB/PDSB, dar documentația conține obiective > 6 bar (ET/PT) sau > 10 bar (NT transport); sau invers _(caută în: fisa_de_date, caiet_sarcini, planse; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date — cerințe de calificare; DUAE; Caiet de sarcini (obiect); Fișa de date; Memoriu tehnic (regim de presiune); Planșe
- **Cerințe:** `REQ-TG-008` Ordin ANRE 17/2026 art. 1 alin. (3)-(4), tabel; `REQ-TG-020` Ordin ANRE 17/2026 art. 39 alin. (1)-(2); `REQ-TG-014` Ordin ANRE 17/2026 art. 31 alin. (1); `REQ-TG-052` Ordin ANRE 89/2018 (NTPEE-2018) art. 7 alin. (1); `REQ-AD-029` Legea 98/2016 art. 173 alin. (1); `REQ-TG-001` Legea 123/2012 — Titlul II Gaze naturale art. 121 alin. (1); `REQ-TG-028` Ordin ANRE 17/2026 art. 1 alin. (4) tabel; art. 14 (EDSB); `REQ-TG-041` Ordin ANRE 17/2026 art. 1 alin. (4) tabel; art. 13; `REQ-TG-053` Ordin ANRE 89/2018 (NTPEE-2018) art. 19 alin. (1); `REQ-TG-009` Ordin ANRE 17/2026 art. 1 alin. (4) (tabel) — absența pragurilor de diametru; `REQ-TG-143` Ordin ANRE 118/2013 NTPEE art. 20 alin. (1), art. 21 alin. (1)
- **Precedente CNSC:** BO2022_1615, BO2022_2403, BO2024_2636, BO2023_416

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită „[citat cerință ANRE]”. Având în vedere că Regulamentul aprobat prin Ordinul ANRE nr. 17/2026 a înlocuit Ordinul ANRE nr. 132/2021, iar autorizațiile emise anterior rămân valabile (art. 39), vă rugăm să precizați: (a) tipurile de autorizație ANRE solicitate pentru [proiectare / execuție], corelate cu regimul de presiune al obiectivelor din contract ([… bar]); (b) dacă se acceptă autorizațiile emise în baza oricăruia dintre cele două regulamente; (c) etapa în care se prezintă documentele.

- 🔒 **Impact intern (nu se trimite):** tehnic — Tipul greșit = lucrări neautorizate. Obiective PI cer ET + sudori OL suplimentari. · cost — Subcontractant ET. · risc — Ridicat: cerință nepublicată nu poate fi opusă (BO2022_2403), dar cerința lipsă lasă concurenți neautorizați. Ridicat pentru ofertantul fără tipul corect.
- **Notă:** Corectură runda 1: CL-B17 trimitea la „Ordinul 132/2021 sau actul în vigoare” — actul în vigoare e Ord. ANRE 17/2026. Verificare internă: dovada la ANRE a personalului/dotării în 3 luni (REQ-TG-020). Contopit cu: Tipul autorizației ANRE nu corespunde regimului de presiune al obiectivului. Ord. 17/2026 nu are praguri de diametru — doar tip obiectiv + presiune (REQ-TG-009).

### PAT-CAL-02
**Autorizare ANRE îndeplinită prin asociat sau subcontractant** · ⚖️ review juridic · încredere medie · vechi: CL-B05, CL-B07

- **Trigger:** FD cere autorizația ANRE de la ofertant/lider fără a preciza dacă poate fi îndeplinită de asociatul/subcontractantul care execută partea de gaze _(caută în: fisa_de_date; detecție: judecata_umana)_
- **Documente de verificat:** Fișa de date; DUAE; Acord de asociere / subcontractare
- **Cerințe:** `REQ-TG-016` Ordin ANRE 17/2026 art. 34 alin. (1); `REQ-TG-017` Ordin ANRE 17/2026 art. 34 alin. (2); `REQ-TG-018` Ordin ANRE 17/2026 art. 34 alin. (3); `REQ-AD-028` Legea 98/2016 art. 172 alin. (4); `REQ-AD-029` Legea 98/2016 art. 173 alin. (1); `REQ-AD-030` 3288/2024 (BO, nr. complet anonimizat) motivare (L98 art. 172; Legea 123/2012; Ord. ANRE 132/2021)
- **Precedente CNSC:** BO2024_3288, BO2022_1615

> **Întrebare (text extern):** Vă rugăm să precizați dacă cerința privind autorizația ANRE de tip [EDSB] se consideră îndeplinită de [asociatul / subcontractantul] care execută efectiv lucrările de gaze, în condițiile art. 34 din Regulamentul aprobat prin Ordinul ANRE nr. 17/2026 (subcontractare către operatori autorizați și coordonare printr-un instalator autorizat angajat al antreprenorului general).

- 🔒 **Impact intern (nu se trimite):** tehnic — Coordonare obligatorie prin instalator propriu; răspundere solidară. · cost — — · risc — Ridicat.
- **Notă:** Interpretări în tensiune: L98 art. 172 alin. (4) (fără cerințe de participare pentru subcontractanți, REQ-AD-028) vs BO2024_3288 (AC poate cere ANRE de la toți subcontractanții care execută gaze, REQ-AD-030). Necesită analiză juridică.

### PAT-CAL-03
**Intervenții pe rețele de gaze în contracte de drumuri sau apă-canal** · ⚖️ review juridic · încredere ridicata · vechi: CL-B18

- **Trigger:** LC/CS conțin relocări/protejări de conducte de gaze, ridicări la cotă de răsuflători/cutii, branșamente — fără cerință ANRE în FD _(caută în: caiet_sarcini, F3; detecție: cuvant_cheie)_
- **Documente de verificat:** Liste de cantități; Caiet de sarcini; Fișa de date
- **Cerințe:** `REQ-TG-002` Legea 123/2012 — Titlul II Gaze naturale art. 121 alin. (2); `REQ-TG-014` Ordin ANRE 17/2026 art. 31 alin. (1); `REQ-SC-110` Legea 123/2012 — Titlul II Gaze naturale art. 190 lit. b)–d); `REQ-SC-113` Ordin ANRE 89/2018 (NTPEE-2018) art. 28; art. 27
- **Precedente CNSC:** BO2023_657, BO2023_416

> **Întrebare (text extern):** Pentru categoriile de lucrări [nr./denumire din lista de cantități] care presupun intervenții asupra sistemului de distribuție a gazelor naturale, vă rugăm să precizați dacă executantul acestora trebuie să dețină autorizație ANRE [tipul …] și dacă acesta trebuie nominalizat ca subcontractant în ofertă.

- 🔒 **Impact intern (nu se trimite):** tehnic — Lucrări pe gaze doar cu operator autorizat. · cost — Subcontractant autorizat. · risc — Mediu.
- **Notă:** BO2023_657 (orice intervenție fizică pe SD cere ANRE) vs BO2023_416 (critica pe ANRE necerută în DA are șanse mici) — interpretări de cântărit juridic.

### PAT-CAL-04
**Personal cheie: legitimații ANRE cu terminologie veche și RTE „pentru gaze”** · ⚖️ review juridic · încredere medie · vechi: CL-B06, CL-B14

- **Trigger:** FD folosește 'gradul I/II', 'IGIB', 'instalator autorizat ANRE' fără tipurile EGD/EGIU/EGT/PGD / SAU: FD cere 'RTE pentru gaze' / 'RTE autorizat ANRE' _(caută în: fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date — personal cheie; Fișa de date
- **Cerințe:** `REQ-TG-048` Ordin ANRE 65/2023 (modificat prin Ordin ANRE 85/2024) art. 4 alin. (1), Tabelul nr. 1 (modificat prin Ord. 85/2024 art. I pct. 1); `REQ-TG-049` Ordin ANRE 65/2023 (modificat prin Ordin ANRE 85/2024) Tabelul nr. 1 — proiectare; `REQ-TG-003` Legea 123/2012 — Titlul II Gaze naturale art. 121 alin. (3); `REQ-TG-100` Ordin ANRE 89/2018 (NTPEE-2018) art. 285 alin. (3); `REQ-TG-015` Ordin ANRE 17/2026 art. 31 alin. (4)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită „[text din fișa de date]”. Vă rugăm să precizați tipul de legitimație de instalator autorizat corespunzător, din cele prevăzute de Regulamentul aprobat prin Ordinul ANRE nr. 65/2023, modificat prin Ordinul ANRE nr. 85/2024 (de exemplu EGD / EGIU / EGT), precum și, pentru responsabilul tehnic cu execuția, domeniul de atestare solicitat.

- 🔒 **Impact intern (nu se trimite):** tehnic — RTE nu semnează lucrările unde a fost instalator/sudor (Ord. 17/2026 art. 31 alin. (4)). · cost — — · risc — Ridicat la nominalizarea expertului. Ridicat.
- **Notă:** Vizarea legitimațiilor (REQ-TG-050) neverificată — verificare internă separată. Contopit cu: RTE „pentru lucrări de gaze”. REQ-TG-100 are încredere medie. Citarea „art. 121 din Legea 123/2012” din runda 1 nu a fost păstrată în întrebare.

### PAT-CAL-05
**Experiență similară formulată ca „identică” sau limitată strict la tipul de rețea din obiect** · ⚖️ review juridic · încredere ridicata · vechi: CL-B01, CL-B15, CL-B20

- **Trigger:** ES cere strict 'rețea de distribuție gaze PE' / 'identic' / apă + canal + stație în același contract _(caută în: fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date — capacitate tehnică; Strategia de contractare (dacă e publicată)
- **Cerințe:** `REQ-AD-037` Instrucțiunea ANAP 2/2017 art. 5 alin. (1)–(2); `REQ-AD-042` 2717/2023 (BO, nr. complet anonimizat) motivare (L98 art. 196; HG 395 art. 29; Instr. 2/2017); `REQ-AD-043` 3952/C1/4610 motivare (L98 art. 215–216; HG 395 art. 137; Instr. 2/2017 art. 5 alin. (1)); `REQ-AD-044` 1489/2023 (BO, nr. complet anonimizat) motivare (L99 art. 192; Instr. 2/2017 art. 5); `REQ-AD-090` Instrucțiunea ANAP 2/2017 titlu și preambul (art. 191 și art. 192 lit. a) și b) din Legea 99/2016); `REQ-AD-027` Legea 98/2016 art. 172 alin. (3) și (5)
- **Precedente CNSC:** BO2023_1378, Decizie_3952, BO2023_2717, BO2023_1489, BO2024_2669

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită experiență similară în „[citat]”. Vă rugăm să precizați dacă sunt acceptate și lucrări similare sau superioare din punctul de vedere al complexității (de exemplu [conducte de transport / branșamente și extinderi de rețea / rețele de fluide sub presiune]), avându-se în vedere art. 5 din Instrucțiunea ANAP nr. 2/2017, precum și dacă valoarea minimă poate fi atinsă prin mai multe contracte.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — — · risc — Ridicat: excludere la calificare.
- **Notă:** Duplicat contopit (3 surse runda 1). Decizie_3952 — nuanță: transportul a fost acceptat pentru că cerința admitea lucrări „de aceeași natură și complexitate sau superioare”; nu e regulă generală. Cumulul prin mai multe contracte (Instr. 2/2017 art. 4) nu are cerință verificată — nu se citează.

### PAT-CAL-06
**Experiență similară: contract „finalizat/semnat în ultimii 5 ani” sau plafon peste valoarea estimată** · ⚖️ review juridic · încredere ridicata · vechi: CL-B01

- **Trigger:** ES cere contract 'finalizat'/'semnat'/'început' în ultimii 5 ani sau plafon valoric > VE _(caută în: fisa_de_date; detecție: calcul)_
- **Documente de verificat:** Fișa de date; Valoarea estimată
- **Cerințe:** `REQ-AD-035` Legea 98/2016 art. 179 lit. a); `REQ-AD-036` Instrucțiunea ANAP 2/2017 art. 3 alin. (3) lit. a); `REQ-AD-038` Instrucțiunea ANAP 2/2017 art. 11 alin. (1)–(2); `REQ-AD-039` Instrucțiunea ANAP 2/2017 art. 11 alin. (3); `REQ-AD-040` Instrucțiunea ANAP 2/2017 art. 13 alin. (2) + Notă
- **Precedente CNSC:** —

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită „[citat]”. Vă rugăm să confirmați că se acceptă partea de lucrări executată și recepționată în ultimii 5 ani dintr-un contract început anterior sau aflat în derulare, dovedită prin procese-verbale de recepție la terminarea lucrărilor pe obiecte (art. 11 din Instrucțiunea ANAP nr. 2/2017). Vă rugăm să precizați și dacă plafonul de [X] lei, raportat la valoarea estimată de [Y] lei, se menține (art. 3 alin. (3) lit. a) din aceeași instrucțiune).

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — — · risc — Ridicat: excludere la calificare.

### PAT-CAL-07
**Documentele de dovedire a experienței similare** · ⚖️ review juridic · încredere ridicata · vechi: CL-B16, CL-B02

- **Trigger:** FD cere 'lucrări duse la bun sfârșit' fără listă de documente sau cu listă închisă (doar PV recepție finală) / SAU: FD nu spune cum se valorifică ES din contracte în care ofertantul a fost subcontractant/asociat _(caută în: fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Fișa de date; Dosarul de referințe al ofertantului; Contracte de referință ale ofertantului
- **Cerințe:** `REQ-AD-039` Instrucțiunea ANAP 2/2017 art. 11 alin. (3); `REQ-AD-045` 182/C8/4870 motivare (L98 art. 2 alin. (2), art. 196; HG 343/2017 art. 19); `REQ-AD-046` 140/2023 (BO, nr. complet anonimizat) motivare (L98 art. 196, 209; HG 395 art. 134); `REQ-AD-041` Instrucțiunea ANAP 2/2017 art. 14 alin. (3)
- **Precedente CNSC:** BO2026_182, Decizie_3952, BO2023_140

> **Întrebare (text extern):** Vă rugăm să precizați dacă lista documentelor justificative pentru experiența similară este exemplificativă și dacă se acceptă [PV de recepție la terminarea lucrărilor pe obiect / PV de recepție parțială / recomandări ale beneficiarului / documente constatatoare]. Pentru lucrările executate ca subcontractant, vă rugăm să confirmați că se ia în considerare valoarea lucrărilor executate efectiv, confirmată de antreprenorul general și de beneficiarul final (art. 14 alin. (3) din Instrucțiunea ANAP nr. 2/2017), și documentele acceptate în acest scop.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — — · risc — Ridicat: documentele emise după termenul de depunere nu dovedesc ES (BO2026_182). Ridicat.
- **Notă:** BO2026_182 — nuanță: CNSC nu a exclus automat experiența expertului anterioară autorizării ANRE; recomandările semnate de diriginte trebuie confirmate de beneficiar. Contopit cu: Experiență similară dobândită ca subcontractant sau în asociere.

### PAT-CAL-08
**Cifra de afaceri minimă disproporționată sau pe mai mult de 3 ani** · ⚖️ review juridic · încredere ridicata · vechi: CL-B03

- **Trigger:** cifra de afaceri minimă > 2 × VE sau perioada de referință > ultimele 3 exerciții _(caută în: fisa_de_date; detecție: calcul)_
- **Documente de verificat:** Fișa de date; Valoarea estimată
- **Cerințe:** `REQ-AD-033` Legea 98/2016 art. 175 alin. (2) lit. a), alin. (3)–(4); `REQ-AD-034` Legea 98/2016 art. 177 alin. (1) lit. c)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită o cifră de afaceri minimă anuală de [X] lei, respectiv de [N] ori valoarea estimată, pentru perioada [ani]. Vă rugăm să precizați motivele care justifică acest nivel, în sensul art. 175 alin. (3)–(4) din Legea nr. 98/2016, și perioada de referință avută în vedere (art. 177 alin. (1) lit. c)).

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — — · risc — Ridicat.
- **Notă:** Corectură runda 1: plafonul de 2 × VE rezultă din L98 art. 175 alin. (2) lit. a), nu doar din avizele ANAP.

### PAT-CAL-09
**Cerințe de nișă fără legătură aparentă cu lucrările (atestate de alt tip, licență ANRSC, experiență „exclusiv în gaze”, utilaje specifice)** · ⚖️ review juridic · încredere scazuta · vechi: CL-B19, CL-B08

- **Trigger:** cerință de calificare fără corespondent în lucrările din LC (ex. atestat ANIF, utilaj specific, experiență exclusivă) / SAU: FD cere 'licență ANRSC' pentru un contract de execuție lucrări _(caută în: fisa_de_date; detecție: judecata_umana)_
- **Documente de verificat:** Fișa de date; Liste de cantități; Strategia de contractare
- **Cerințe:** `REQ-AD-027` Legea 98/2016 art. 172 alin. (3) și (5); `REQ-TG-166` Legea 241/2006 (republicată) —
- **Precedente CNSC:** BO2026_1237, BO2022_2083, BO2024_1016

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită [cerința X, de exemplu licența ANRSC / atestatul …]. Vă rugăm să precizați activitatea sau categoria de lucrări din proiect pentru care este necesară această cerință și dacă aceasta constituie cerință de calificare pentru ofertantul care execută lucrările.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — — · risc — Ridicat dacă nu o îndeplinim. Ridicat dacă nu o deținem.
- **Notă:** Corectură runda 1: cererea „vă solicităm eliminarea” a fost scoasă din textul extern; eliminarea se urmărește, dacă e cazul, prin contestație (BO2022_2083: sarcina probei tehnice e a contestatorului). Contopit cu: Licență ANRSC cerută pentru un contract de execuție. temei de confirmat: Legea 241/2006 / 51/2006 nerecitite (REQ-TG-166 neverificat).

### PAT-CAL-10
**Personal cheie: același expert pe mai multe loturi și documentele de experiență** · ⚖️ review juridic · încredere medie · vechi: CL-B23

- **Trigger:** procedură pe loturi cu experți-cheie; FD nu spune dacă același expert poate fi propus pe mai multe loturi sau ce documente dovedesc experiența _(caută în: fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Fișa de date; Formulare CV
- **Cerințe:** `REQ-AD-120` Instrucțiunea ANAP 1/2017 art. referitoare la experții-cheie (numerotare neconfirmată)
- **Precedente CNSC:** BO2023_2119, BO2024_1699

> **Întrebare (text extern):** Vă rugăm să precizați dacă același expert poate fi propus pentru loturile [1] și [2] și ce documente justificative ale experienței specifice se solicită la depunere.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — — · risc — Ridicat: cerințele formale clare nu se mai pot contesta după depunere (BO2024_1699).
- **Notă:** REQ-AD-120 (Instr. ANAP 1/2017) neverificat — nu se citează.

### PAT-CAL-11
**Calificarea sudorilor: autorizație ISCIR vs certificate EN ISO 9606-1 / EN 13067** · ⚖️ review juridic · încredere medie · vechi: CL-B10

- **Trigger:** CS/FD cer 'sudori certificați EN ISO 9606-1 / EN 13067' sau 'autorizați ISCIR' sau ambele / SAU: FD/CS cer sudori fără a spune dacă trebuie să fie salariați ai ofertantului sau ai membrului/subcontractantului care execută _(caută în: caiet_sarcini, fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Fișa de date
- **Cerințe:** `REQ-TG-063` Ordin ANRE 89/2018 (NTPEE-2018) art. 236 alin. (1); `REQ-TG-074` Ordin ANRE 89/2018 (NTPEE-2018) art. 239 alin. (5); `REQ-TG-106` SR EN 13067 (EN 13067:2020) NTPEE anexa 2 poz. 51; `REQ-TG-120` PT CR 9-2025 (Ordin MEDAT 1172/2026) art. 49 alin. (1); art. 53 alin. (3); `REQ-TG-122` PT CR 9-2025 (Ordin MEDAT 1172/2026) art. 63; `REQ-TG-135` PT CR 9-2025 (Ordin MEDAT 1172/2026) art. 1 alin. (1) și art. 2; `REQ-TG-054` Ordin ANRE 89/2018 (NTPEE-2018) art. 6 alin. (2) + titlul anexei nr. 2; `REQ-TG-025` Ordin ANRE 17/2026 anexa 3, pct. 2 vs art. 14 lit. d)-e); `REQ-TG-032` Ordin ANRE 17/2026 art. 14 lit. d); `REQ-TG-033` Ordin ANRE 17/2026 art. 14 lit. e); `REQ-TG-121` PT CR 9-2025 (Ordin MEDAT 1172/2026) art. 67
- **Precedente CNSC:** —

> **Întrebare (text extern):** Caietul de sarcini / fișa de date ([…]) solicită pentru sudori „[citat]”. Vă rugăm să precizați dacă autorizațiile emise de ISCIR conform PT CR 9-2025 (inclusiv cele emise anterior, valabile până la expirare potrivit art. 63) sunt acceptate ca dovadă a calificării, fără certificate suplimentare emise de un organism terț, și dacă sudorii trebuie să fie salariați ai ofertantului (sau ai membrului asocierii / subcontractantului care execută lucrările respective) ori se acceptă și sudori puși la dispoziție prin contract de prestări servicii.

- 🔒 **Impact intern (nu se trimite):** tehnic — Dublă certificare = cost și timp. Autorizația ISCIR a sudorului e valabilă numai la angajator (PT CR 9-2025 art. 67). · cost — Certificare terță per sudor. · risc — Ridicat dacă e cerință de calificare. Mediu.
- **Notă:** Corectură runda 1: SR EN 13067 e doar recomandat în anexa 2 NTPEE (REQ-TG-106, REQ-TG-054) — obligatoriu numai dacă DA îl cere expres. Citarea „L98 art. 155” din runda 1 nu are cerință verificată — scoasă. Contopit cu: Sudori salariați vs sudori puși la dispoziție de terți. Neconcordanță internă Ord. ANRE 17/2026: anexa 3 pct. 2 (terț permis) vs art. 14 lit. d)–e) (salariați) — REQ-TG-025.

### PAT-CAL-12
**VERIFICARE INTERNĂ: autorizațiile sudorilor nominalizați (expirate sau la alt angajator)** · ⚖️ review juridic · încredere ridicata · vechi: CL-B09

- **Trigger:** pentru fiecare sudor nominalizat: data expirării autorizației < data-limită de depunere + durata execuției, sau angajatorul de pe autorizație ≠ Gazpet _(caută în: fisa_de_date; detecție: comparatie_documente)_
- **Documente de verificat:** Registrul intern de autorizări sudori; REGES; Lista personalului nominalizat
- **Cerințe:** `REQ-TG-120` PT CR 9-2025 (Ordin MEDAT 1172/2026) art. 49 alin. (1); art. 53 alin. (3); `REQ-TG-121` PT CR 9-2025 (Ordin MEDAT 1172/2026) art. 67; `REQ-TG-122` PT CR 9-2025 (Ordin MEDAT 1172/2026) art. 63; `REQ-TG-127` PT CR 9-2025 (Ordin MEDAT 1172/2026) art. 71
- **Precedente CNSC:** —

> **Întrebare (text extern):** 

- 🔒 **Impact intern (nu se trimite):** tehnic — Sudor neautorizat nu poate lucra (PT CR 9-2025 art. 71). · cost — Reautorizare. · risc — Ridicat dacă sudorul e nominalizat în ofertă.
- **Notă:** Nu se trimite la AC (intrebare_propusa = null). Valabilitate 2 ani, numai la angajator; autorizațiile vechi valabile până la expirare.

### PAT-CAL-13
**Certificări cerute la calificare (SR EN ISO 3834-2 / IWE, ISO 9001 / 14001 / 45001) — echivalențe** · ⚖️ review juridic · încredere scazuta · vechi: CL-B11, CL-B13

- **Trigger:** FD cere 'ISO 3834-2' sau 'IWE' ca cerință de calificare / SAU: FD cere certificat ISO 45001 (sau 9001/14001) fără clauză de echivalență _(caută în: fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date
- **Cerințe:** `REQ-TG-030` Ordin ANRE 17/2026 art. 14 lit. b); `REQ-AD-027` Legea 98/2016 art. 172 alin. (3) și (5)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită [certificarea …]. Vă rugăm să precizați dacă se acceptă și certificate echivalente emise de organisme acreditate din alte state membre ori alte dovezi privind măsuri echivalente (de exemplu, pentru sudare, [responsabil cu tehnologia sudării atestat și proceduri de sudare aprobate]).

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Certificare 3834-2 costisitoare. · risc — Ridicat. Mediu.
- **Notă:** Afirmația din runda 1 „NTPEE nu impune ISO 3834” nu are cerință verificată explicită; Ord. ANRE 17/2026 cere doar declarație privind RTS atestat (REQ-TG-030). Contopit cu: Certificări ISO 9001 / 14001 / 45001 cerute — echivalențe. temei de confirmat: runda 1 invoca L98 art. 200–201; nicio cerință verificată în runda 2 — citarea scoasă.

## Garanții

### PAT-GAR-01
**Garanția de participare: cuantum, valabilitate, forma instrumentului și condiții impuse emitentului** · ⚖️ review juridic · încredere ridicata · vechi: CL-B04, CL-B21

- **Trigger:** FD limitează instrumentul (doar bancă, rating minim, emitent nominalizat) sau cere original pe hârtie / SAU: GP exprimată doar procentual, > 1 % din VE, sau cu valabilitate diferită de valabilitatea ofertei _(caută în: fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date; Model de instrument de garantare; Anunț
- **Cerințe:** `REQ-AD-012` Legea 98/2016 art. 154 alin. (4) lit. a)–c); `REQ-AD-013` HG 395/2016 art. 36 alin. (4); `REQ-AD-014` HG 395/2016 art. 36 alin. (5); `REQ-AD-020` 1317/C6/1161 motivare (L99 art. 164; HG 394 art. 45–48); `REQ-AD-011` Legea 98/2016 art. 154 alin. (2); `REQ-AD-064` HG 395/2016 art. 137 alin. (2) lit. i)
- **Precedente CNSC:** BO2021_1317, BO2022_1952, BO2021_2420, BO2021_99

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) prevede garanția de participare [ca procent / în valoare de …], cu valabilitate de [N] zile, constituită [numai prin … / de un emitent cu …]. Vă rugăm să precizați cuantumul în lei și perioada minimă de valabilitate a garanției și să confirmați că se acceptă oricare dintre formele prevăzute la art. 154 alin. (4) din Legea nr. 98/2016, inclusiv instrumentul emis de o societate de asigurări, transmis în SEAP odată cu oferta (art. 36 alin. (4)–(5) din HG nr. 395/2016).

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Cost instrument. Comision instrument. · risc — Ridicat. Ridicat: GP lipsă/insuficientă nu se remediază (BO2021_2420).
- **Notă:** Contopire CL-B04 (partea de formă) + CL-B21. Scrisoarea IFN e admisă doar la lucrări cu VE ≤ 40.000.000 lei (REQ-AD-012). Contopit cu: Garanția de participare: cuantum și valabilitate.

### PAT-GAR-02
**Garanția de bună execuție cumulată cu Sumele Reținute; rețineri succesive; restituire**  · încredere ridicata · vechi: CL-D03

- **Trigger:** acordul contractual nu fixează GBE sau nu exclude Sumele Reținute (cl. 47.2), ori nu precizează constituirea prin rețineri succesive _(caută în: contract, fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Acord contractual; Condiții generale/specifice HG 1/2018; Fișa de date
- **Cerințe:** `REQ-AD-021` Legea 98/2016 art. 154 alin. (3); `REQ-AD-023` HG 395/2016 art. 40 alin. (4)–(6); `REQ-AD-025` Legea 98/2016 art. 154^2 alin. (5); `REQ-AD-094` HG 1/2018 Anexa 1, cl. 15.1; `REQ-AD-095` HG 1/2018 Anexa 1, cl. 15.6; `REQ-AD-100` HG 1/2018 Anexa 1, cl. 47.2; `REQ-AD-101` HG 1/2018 Anexa 1, cl. 47.4
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați cuantumul garanției de bună execuție, dacă aceasta se poate constitui prin rețineri succesive (subclauza 15.1), dacă se aplică și Sumele Reținute prevăzute la subclauza 47.2 și modul de corelare cu subclauza 47.4, precum și procentul restituit la Recepția la Terminare (subclauza 15.6).

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Imobilizare de până la 10 % + 5 % din preț. · risc — Scăzut.

### PAT-GAR-03
**Perioada de garanție a lucrărilor: categoria de importanță / clasa de consecințe / garanția ANRE de 2 ani** · ⚖️ review juridic · încredere medie · vechi: CL-D05, CL-D06

- **Trigger:** acordul contractual nu indică perioada de garanție sau categoria de importanță; perioada de garanție e factor de evaluare fără minim legal precizat _(caută în: contract, fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Acord contractual; Fișa de date (factori de evaluare); Memoriu (categoria de importanță)
- **Cerințe:** `REQ-AD-110` HG 1/2018 Anexa 1, cl. 61.6; `REQ-TG-023` Ordin ANRE 17/2026 anexa 8, pct. 12; `REQ-AD-142` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 531 alin. (6) [după artevis.ro] / art. 466 „Durata garanțiilor” [după indexul verificatori.ro] — CONFLICT; `REQ-AD-144` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 531 alin. (9) [după artevis.ro]
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați perioada de garanție a lucrărilor solicitată și categoria de importanță [sau clasa de consecințe] a lucrării, în raport cu subclauza 61.6 din condițiile contractuale, precum și dacă perioada de garanție constituie factor de evaluare și, în acest caz, valoarea minimă acceptată.

- 🔒 **Impact intern (nu se trimite):** tehnic — Ord. ANRE 17/2026: garanție ≥ 2 ani de la PIF, menționată distinct în contract (REQ-TG-023). · cost — Provizioane pentru remedieri. · risc — Mediu dacă e factor de evaluare.
- **Notă:** Contopire CL-D05 + CL-D06. temei de confirmat: clasele de consecințe și minimele CC1–CC4 din Legea 169/2026 (REQ-AD-142/144) sunt neverificate pe sursă — nu se citează.

### PAT-GAR-04
**Garanția pentru refacerea structurii rutiere (5 ani) și cine o asigură**  · încredere ridicata · vechi: —

- **Trigger:** lucrări în ampriza unui DN/drum, cu refacere de structură rutieră; DA nu spune garanția aplicabilă refacerii sau cine e beneficiarul autorizației de amplasare _(caută în: caiet_sarcini, contract; detecție: judecata_umana)_
- **Documente de verificat:** Caiet de sarcini; Acord contractual; Aviz/autorizație administrator drum
- **Cerințe:** `REQ-SC-061` Ordin MTI 1668/2023 Anexă pct. 3.4.1 alin. (5); pct. 3.4.5 alin. (2); `REQ-SC-062` Ordin MTI 1668/2023 Anexă pct. 3.4.1 alin. (7); pct. 3.4.5 alin. (4)–(5); `REQ-SC-063` Ordin MTI 1668/2023 Anexă pct. 3.4.1 alin. (8); pct. 3.4.5 alin. (6); `REQ-SC-075` Ordin MI/MT 1112/411/2000 Partea I pct. (13) lit. k)–l); pct. (18)
- **Precedente CNSC:** BO2025_2344

> **Întrebare (text extern):** Pentru refacerea structurii rutiere afectate pe [drumul …], vă rugăm să precizați perioada de garanție aplicabilă, dacă aceasta diferă de perioada de garanție a lucrărilor din contract și cine asigură garanția față de administratorul drumului.

- 🔒 **Impact intern (nu se trimite):** tehnic — Refacerea se face de o societate specializată în drumuri. · cost — Garanție ≥ 5 ani pe refacere. · risc — Mediu: executantul efectiv al refacerii trebuie declarat subcontractant (BO2025_2344).

## Termene

### PAT-TRM-01
**Termenul de execuție și graficul Gantt — ce include și ce nivel de detaliu**  · încredere ridicata · vechi: CL-A09

- **Trigger:** termenul de execuție nu spune dacă include proiectarea, obținerea avizelor (ex. restricții circulație ≥ 30 zile, declarație ITM ≥ 30 zile) sau sezonul rece; FD cere Gantt fără nivel de detaliu _(caută în: fisa_de_date, caiet_sarcini, contract; detecție: judecata_umana)_
- **Documente de verificat:** Fișa de date; Acord contractual; Caiet de sarcini
- **Cerințe:** `REQ-AD-032` 1706/C7/1650/1651 motivare (L98 art. 215; HG 395 art. 137); `REQ-SC-070` Ordin MI/MT 1112/411/2000 Partea I pct. (6); `REQ-SC-011` HG 300/2006 art. 47 lit. a)–b); art. 48
- **Precedente CNSC:** BO2022_1964, BO2024_1706

> **Întrebare (text extern):** Vă rugăm să precizați dacă termenul de execuție de [N] luni include perioada de [proiectare / obținere a avizelor și autorizațiilor / sezon rece] și ce nivel de detaliere se solicită pentru graficul de execuție (activități, resurse umane și utilaje).

- 🔒 **Impact intern (nu se trimite):** tehnic — Programare realistă. · cost — Penalități de întârziere. · risc — Mediu: Gantt incomplet/incoerent = neconformitate (BO2022_1964).

### PAT-TRM-02
**Răspunsurile la clarificări publicate cu mai puțin de 10 (6) zile înainte de termenul de depunere**  · încredere ridicata · vechi: CL-P01

- **Trigger:** data publicării răspunsului > termen depunere − 10 zile (− 6 zile la procedura simplificată pentru lucrări), pentru întrebări transmise în termen _(caută în: raspunsuri_clarificari; detecție: calcul)_
- **Documente de verificat:** Răspunsuri la clarificări (data publicării); Anunț (termene)
- **Cerințe:** `REQ-AD-003` Legea 98/2016 art. 161 alin. (1); `REQ-AD-004` Legea 98/2016 art. 161 alin. (2); `REQ-AD-005` HG 395/2016 art. 27 alin. (2); `REQ-AD-001` Legea 98/2016 art. 160 alin. (1)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Răspunsurile la solicitările de clarificare transmise în termen au fost publicate la [data], cu [N] zile înainte de termenul de depunere a ofertelor ([data]). Având în vedere art. 161 din Legea nr. 98/2016, vă rugăm să analizați prelungirea termenului de depunere a ofertelor.

- 🔒 **Impact intern (nu se trimite):** tehnic — Timp insuficient de integrare a răspunsurilor. · cost — — · risc — Scăzut.
- **Notă:** Excepție: 5 zile la urgență demonstrată (REQ-AD-003).

### PAT-TRM-03
**VERIFICARE INTERNĂ: termenul de contestare a documentației / a răspunsului la clarificări** · ⚖️ review juridic · încredere medie · vechi: —

- **Trigger:** la publicarea DA sau a unui răspuns la clarificări care menține o cerință considerată restrictivă: termen = 10 zile (VE ≥ prag UE lucrări 26.960.556 lei) sau 7 zile (VE < prag), din ziua următoare luării la cunoștință _(caută în: raspunsuri_clarificari, fisa_de_date; detecție: calcul)_
- **Documente de verificat:** Anunț (VE); Data publicării DA / răspunsului
- **Cerințe:** `REQ-AD-083` Legea 101/2016 art. 8 alin. (1) lit. a)–b); `REQ-AD-084` 182/C8/4870 pct. I (admisibilitate) — calculul termenului; `REQ-AD-088` Reg. delegate (UE) 2025/2152, 2025/2150, 2025/2151, 2025/2487 + Notificare ANAP 10.12.2025 Reg. delegat (UE) 2025/2152 (clasic) / 2025/2150 (sectorial); `REQ-AD-085` Legea 101/2016 art. 61^1 alin. (1); `REQ-AD-086` 2863/C4/3581 motivare (L101 art. 61^1)
- **Precedente CNSC:** BO2026_182, BO2023_2119, BO2025_878, BO2025_2863

> **Întrebare (text extern):** 

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Cauțiune 2 % din VE (plafoane sub prag 35.000 / 88.000 lei — neconfirmate în forma curentă). · risc — Pierderea dreptului de a contesta cerința.
- **Notă:** Corectură runda 1: sub prag termenul este de 7 zile, nu 5 (BO2026_182, BO2023_2119). Textul curent L101 art. 8 nu a fost recitit (REQ-AD-083 neverificat) — de confirmat juridic. Cauțiunea are termen de decădere (BO2025_2863). Contestarea DA rămâne admisibilă și dacă depunem ofertă (BO2025_878). Nu se trimite la AC.

## Clauze contractuale

### PAT-CTC-01
**Ajustarea prețului lipsește la durate de peste 6 luni / contradicție cu prețul ferm (cl. 48.2)**  · încredere ridicata · vechi: CL-D01

- **Trigger:** durata de execuție > 6 luni și acordul contractual nu are clauză de ajustare sau rămâne pe regula implicită cl. 48.2 (preț ferm ≤ 365 de zile) / SAU: acordul contractual nu fixează data de referință sau exclude cl. 48.8 _(caută în: contract, fisa_de_date; detecție: calcul)_
- **Documente de verificat:** Acord contractual; Condiții specifice; Fișa de date
- **Cerințe:** `REQ-AD-078` Legea 98/2016 art. 222^2 alin. (2)–(3); `REQ-AD-079` Legea 98/2016 art. 222^2 alin. (9); `REQ-AD-102` HG 1/2018 Anexa 1, cl. 48.2; `REQ-AD-103` HG 1/2018 Anexa 1, cl. 48.3–48.4; `REQ-AD-104` HG 1/2018 Anexa 1, cl. 48.5; `REQ-AD-106` HG 1/2018 Anexa 1, Definiții lit. n); `REQ-AD-105` HG 1/2018 Anexa 1, cl. 48.8
- **Precedente CNSC:** —

> **Întrebare (text extern):** Durata de execuție este de [N] luni. Subclauza 48.2 din condițiile generale prevede prețuri ferme pentru durate de cel mult 365 de zile, iar art. 222^2 alin. (9) din Legea nr. 98/2016 prevede clauze de ajustare pentru contractele de lucrări cu durată mai mare de 6 luni. Vă rugăm să precizați clauza de ajustare aplicabilă: formula, indicii și sursa lor, ponderile, termenul fix și data de referință, precum și dacă se aplică subclauza 48.8 privind modificările legislative publicate după data de referință.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Risc de inflație pe materiale/manoperă. Creșteri legislative de cost neacoperite. · risc — Scăzut.
- **Notă:** Contradicție internă identificată în runda 2 (HG 1/2018 cl. 48.2 vs L98 art. 222^2 alin. (9)). Contopit cu: Data de referință și ajustarea pentru modificări legislative (ex. salariul minim).

### PAT-CTC-02
**Formula de ajustare folosește indici nepublicați (ex. ICCplr) sau preluați din OUG 64/2022**  · încredere ridicata · vechi: CL-D07

- **Trigger:** formula conține 'ICCplr', 'ICCmlr' sau trimite la art. 17 OUG 64/2022 pentru un contract nou _(caută în: contract; detecție: cuvant_cheie)_
- **Documente de verificat:** Acord contractual; Fișa de date
- **Cerințe:** `REQ-AD-081` 406/C?/... (anonimizat, BO2023_406) motivare (L98 art. 212 alin. (1) lit. c), art. 222; OUG 64/2022 art. 17); `REQ-AD-078` Legea 98/2016 art. 222^2 alin. (2)–(3); `REQ-AD-116` OUG 64/2022 art. 17 alin. (1); `REQ-AD-117` OUG 64/2022 art. 17 alin. (4) și alin. (8) lit. a1); `REQ-AD-119` INS — Buletin Statistic de Prețuri (lunar), tabel 15 / 15A Buletin Statistic de Prețuri, tabelul 15 (ICC total și pe elemente de cost) și tabelul 15A (ponderi)
- **Precedente CNSC:** BO2023_406

> **Întrebare (text extern):** Formula de ajustare din [contract, art. / subclauza …] utilizează indicele [denumire]. Vă rugăm să precizați sursa oficială și tabelul în care este publicat lunar acest indice și, dacă acesta nu este publicat, indicele care îl înlocuiește.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Ajustare imposibil de calculat. · risc — Procedura poate fi anulată (BO2023_406).
- **Notă:** Corectură runda 1: CL-D07 trimitea la „art. 164 HG 395/2016” — abrogat în 2023; temeiul curent e L98 art. 222^2. ICCplr nepublicat de INS din 03.2022; BO2023_406 — nuanță: formula OUG 64 art. 17 alin. (8) lit. a1) privește contractele în derulare, nu contractele noi.

### PAT-CTC-03
**Penalitățile de întârziere nu sunt stabilite (se aplică valoarea implicită din cl. 36.4)**  · încredere ridicata · vechi: CL-D02

- **Trigger:** acordul contractual nu precizează cuantumul penalităților de întârziere _(caută în: contract; detecție: camp_lipsa)_
- **Documente de verificat:** Acord contractual
- **Cerințe:** `REQ-AD-096` HG 1/2018 Anexa 1, cl. 36.4; `REQ-AD-097` HG 1/2018 Anexa 1, cl. 36.5; `REQ-AD-114` HG 1/2018 Anexa 2, cl. 36.4 și cl. 48.2–48.5
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați în Acordul Contractual cuantumul penalităților de întârziere pe zi (ca procent din prețul contractului sau din valoarea lucrărilor rămase de executat), întrucât, în lipsa acestei mențiuni, subclauza 36.4 conduce la o valoare zilnică egală cu Prețul Contractului împărțit la Durata de Execuție, plafonată la 15 %.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Expunere zilnică foarte mare. · risc — Scăzut.

### PAT-CTC-04
**Avansul — acordare, cuantum și modul de recuperare**  · încredere ridicata · vechi: CL-D04

- **Trigger:** acordul contractual nu precizează avansul sau varianta de justificare (cl. 46.6 / 46.7) _(caută în: contract, fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Acord contractual
- **Cerințe:** `REQ-AD-098` HG 1/2018 Anexa 1, cl. 46.6; `REQ-AD-099` HG 1/2018 Anexa 1, cl. 46.7
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați dacă se acordă avans, cuantumul și numărul tranșelor, precum și varianta de justificare aplicabilă (subclauza 46.6 sau subclauza 46.7 din condițiile generale).

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Flux de numerar. · risc — Scăzut.

### PAT-CTC-05
**Contract cu prețuri unitare sau cu preț global — modul de plată a cantităților**  · încredere ridicata · vechi: —

- **Trigger:** DA nu precizează dacă se plătesc cantitățile măsurate (cl. 49.1) sau un preț forfetar _(caută în: contract, fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Acord contractual; Fișa de date
- **Cerințe:** `REQ-AD-107` HG 1/2018 Anexa 1, cl. 49.1
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați dacă contractul este cu prețuri unitare, cu plata cantităților efectiv executate și măsurate (subclauza 49.1 din condițiile generale), sau cu preț global.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — La preț global, diferențele de cantitate rămân la executant. · risc — Scăzut.
