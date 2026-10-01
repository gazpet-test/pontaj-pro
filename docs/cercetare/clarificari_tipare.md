# Tipare de clarificare — catalog structurat (v1.1, 02.10.2026)

> 82 tipare · sursa de adevăr: `clarificari_tipare.json` · înlocuiește `catalog_clarificari.md` (runda 1, istoric).
> Fiecare tipar: **trigger** structurat → documente de verificat → **cerințe** (`REQ-*` din `registru_cerinte.json`) + precedente CNSC → **întrebare neutră și factuală** (text extern) → **impact intern** (NU se trimite) → încredere + nevoie de review juridic.
> Regula evidence-first: în întrebare se citează un act DOAR dacă cerința are `verificat_pe_sursa:true`. Orice tipar cu ⚖️ trece prin review juridic uman înainte de trimitere. Modelul matricei per licitație: `clarificari_matrice_model.md`.

Review juridic necesar: 31 / 82 · încredere: ridicata 60, medie 20, scazuta 2

| Tipar | Tip | Titlu | Detecție | Încredere | ⚖️ |
|---|---|---|---|---|---|
| [PAT-CTR-01](#pat-ctr-01) | contradictie | Aceeași cerință are valori diferite în fișa de date, caietul de sarcini și contract | comparatie_documente | ridicata |  |
| [PAT-CTR-02](#pat-ctr-02) | contradictie | Cantitate din F3/lista de cantități diferită de planșe sau memoriu | calcul | ridicata |  |
| [PAT-CTR-03](#pat-ctr-03) | contradictie | Răspunsul la clarificări modifică DA, dar documentul-sursă nu a fost republicat | comparatie_documente | ridicata |  |
| [PAT-CTR-04](#pat-ctr-04) | contradictie | Cerință de calificare prezentă doar în caietul de sarcini, nu și în anunț / fișa de date | comparatie_documente | ridicata |  |
| [PAT-INF-01](#pat-inf-01) | informatie_lipsa | Utilități subterane, avize de amplasament, autorizație de construire, predarea amplasamentului | camp_lipsa | ridicata |  |
| [PAT-INF-02](#pat-inf-02) | informatie_lipsa | Lucrări în zona drumului: acord și autorizație de amplasare, restricții de circulație, tarife — în sarcina cui | judecata_umana | ridicata |  |
| [PAT-INF-03](#pat-inf-03) | informatie_lipsa | Acorduri ale proprietarilor și despăgubiri pe trasee prin proprietăți private | judecata_umana | scazuta | ⚖️ |
| [PAT-INF-04](#pat-inf-04) | informatie_lipsa | Coordonatorul SSM, PSS și declarația prealabilă — în sarcina cui | camp_lipsa | ridicata |  |
| [PAT-INF-05](#pat-inf-05) | informatie_lipsa | Verificarea proiectului (componenta de proiectare la P+E) — cine contractează și plătește verificatorii | camp_lipsa | ridicata |  |
| [PAT-INF-06](#pat-inf-06) | informatie_lipsa | Probe, recepție și punere în funcțiune cu operatorul de distribuție — tarife și cuplare | camp_lipsa | ridicata |  |
| [PAT-INF-07](#pat-inf-07) | informatie_lipsa | Localitate cu concesiune a serviciului de distribuție gaze | judecata_umana | medie |  |
| [PAT-INF-08](#pat-inf-08) | informatie_lipsa | Apă: lipsesc presiunea de încercare și pierderea admisibilă; ediția NP 133 neclară | camp_lipsa | ridicata |  |
| [PAT-INF-09](#pat-inf-09) | informatie_lipsa | Verificarea izolației conductei de oțel după umplerea șanțului — metodă și criteriu | cuvant_cheie | ridicata |  |
| [PAT-INF-10](#pat-inf-10) | informatie_lipsa | Protecția catodică — inclusă sau nu în obiect | judecata_umana | medie | ⚖️ |
| [PAT-INF-11](#pat-inf-11) | informatie_lipsa | Valoarea estimată pe lot/obiect nu este publicată | camp_lipsa | ridicata |  |
| [PAT-INF-12](#pat-inf-12) | informatie_lipsa | Formularele de extrase de resurse (C6–C9) sunt cerute, dar nepublicate | camp_lipsa | medie |  |
| [PAT-INF-13](#pat-inf-13) | informatie_lipsa | Racorduri/extinderi pentru racordare (Ord. ANRE 7/2022): varianta de realizare și convenția tehnică cu OSD | judecata_umana | medie |  |
| [PAT-INF-14](#pat-inf-14) | informatie_lipsa | Recepții parțiale pe tronsoane/obiecte și regimul de recepție aplicabil (L169/2026, HG 273/1994) | camp_lipsa | ridicata |  |
| [PAT-AMB-01](#pat-amb-01) | ambiguu | P+E: se cer la ofertă documente care rezultă abia din proiectul tehnic | judecata_umana | ridicata |  |
| [PAT-AMB-02](#pat-amb-02) | ambiguu | Factori de evaluare: noțiuni nedefinite, documente inexistente sau angajamente fără mod de verificare | cuvant_cheie | medie | ⚖️ |
| [PAT-AMB-03](#pat-amb-03) | ambiguu | Rețete de consum și distanțe de transport ale proiectantului — obligatorii sau orientative | cuvant_cheie | ridicata |  |
| [PAT-AMB-04](#pat-amb-04) | ambiguu | Preț unitar unic pe resursă în toate devizele | cuvant_cheie | ridicata |  |
| [PAT-AMB-05](#pat-amb-05) | ambiguu | Plafon procentual pentru cheltuieli indirecte, profit sau organizare de șantier | cuvant_cheie | scazuta | ⚖️ |
| [PAT-AMB-06](#pat-amb-06) | ambiguu | Autorizări speciale (topografie OCPI, aviz GA, ANRE, RTE pe domenii) — la ofertă sau la execuție | comparatie_documente | ridicata | ⚖️ |
| [PAT-AMB-07](#pat-amb-07) | ambiguu | Verificarea îmbinărilor din PE — alte încercări decât examinarea vizuală | cuvant_cheie | ridicata |  |
| [PAT-AMB-08](#pat-amb-08) | ambiguu | Răspunsul AC la o clarificare este evaziv sau incomplet | judecata_umana | ridicata | ⚖️ |
| [PAT-AMB-09](#pat-amb-09) | ambiguu | Factorul de evaluare „contract colectiv de muncă” — nivel, dovadă, asociere | cuvant_cheie | medie | ⚖️ |
| [PAT-AMB-10](#pat-amb-10) | ambiguu | Articole de deviz asimilate sau cu alt simbol decât cel din F3 / indicatoare | cuvant_cheie | medie | ⚖️ |
| [PAT-AMB-11](#pat-amb-11) | ambiguu | Propunerea tehnică: proceduri „pentru toate categoriile de lucrări”, metodologie, interdicția copierii CS | cuvant_cheie | ridicata |  |
| [PAT-CNT-01](#pat-cnt-01) | cantitate | Extinderea controlului nedistructiv la sudurile din oțel și includerea lui în deviz | cuvant_cheie | ridicata |  |
| [PAT-CNT-02](#pat-cnt-02) | cantitate | Elemente cerute de normativ lipsă din F3 (fir trasor, bandă de avertizare; la apă: ridicare topografică, spălare, dezinfecție) | camp_lipsa | medie |  |
| [PAT-CNT-03](#pat-cnt-03) | cantitate | Traversări de obstacole (drum național, cale ferată, curs de apă) — metodă, tub de protecție, avize și condițiile lor | comparatie_documente | medie |  |
| [PAT-CNT-04](#pat-cnt-04) | cantitate | Deșeuri din construcții — transport, eliminare/valorificare, distanță | camp_lipsa | ridicata |  |
| [PAT-CNT-05](#pat-cnt-05) | cantitate | Refacerea îmbrăcăminții: lățimea și structura de refacere față de lungimea șanțului | calcul | ridicata |  |
| [PAT-CNT-06](#pat-cnt-06) | cantitate | Săpătură: pondere manual/mecanizat, categoria de teren și sprijiniri nespecificate | camp_lipsa | medie |  |
| [PAT-STD-01](#pat-std-01) | standard | Probă de etanșeitate „24 de ore” pentru orice tronson sau branșament | cuvant_cheie | ridicata |  |
| [PAT-STD-02](#pat-std-02) | standard | Material sau SDR incompatibil cu treapta de presiune (ex. PE 80 la presiune medie) | comparatie_documente | ridicata |  |
| [PAT-STD-03](#pat-std-03) | standard | Adâncime de pozare sub 0,9 m sau distanțe față de alte rețele sub minimele NTPEE / ANRE electric | calcul | ridicata |  |
| [PAT-STD-04](#pat-std-04) | standard | Canalizare: metoda probei de etanșeitate, criteriul de acceptare și inspecția CCTV | cuvant_cheie | ridicata |  |
| [PAT-STD-05](#pat-std-05) | standard | „Clasa de calitate II” a sudurilor fără nivel de acceptare și criterii CND | cuvant_cheie | ridicata |  |
| [PAT-STD-06](#pat-std-06) | standard | Proceduri de sudare (WPQR): nivel cerut și acceptarea celor existente aprobate ISCIR | cuvant_cheie | ridicata |  |
| [PAT-STD-07](#pat-std-07) | standard | Clasa izolației de fabrică, sistemul de izolare a îmbinărilor și pregătirea suprafeței | cuvant_cheie | ridicata |  |
| [PAT-STD-08](#pat-std-08) | standard | Trimiteri la acte normative abrogate sau la ediții de standarde înlocuite | cuvant_cheie | ridicata | ⚖️ |
| [PAT-STD-09](#pat-std-09) | standard | DA cere ISCIR (autorizare, verificare, RSVTI) pentru conducte de distribuție, branșamente sau SRM | cuvant_cheie | ridicata |  |
| [PAT-STD-10](#pat-std-10) | standard | Metrologie: aparatele de presiune/temperatură folosite la probe — verificare metrologică vs etalonare | cuvant_cheie | medie |  |
| [PAT-STD-11](#pat-std-11) | standard | Specificațiile tehnice ale operatorului de distribuție și documentele de inspecție pentru materiale (3.1 / 3.2) | judecata_umana | ridicata |  |
| [PAT-STD-12](#pat-std-12) | standard | Izolație „foarte întărită” (NTPEE = sistem pe bază de bitum) vs țeavă preizolată 3LPE în F3/planșe | comparatie_documente | ridicata |  |
| [PAT-CAL-01](#pat-cal-01) | calificare | Autorizare ANRE: Ordinul 132/2021 citat, tip neprecizat, cerință lipsă sau tip necorelat cu regimul de presiune | cuvant_cheie | ridicata | ⚖️ |
| [PAT-CAL-02](#pat-cal-02) | calificare | Autorizare ANRE îndeplinită prin asociat sau subcontractant | judecata_umana | medie | ⚖️ |
| [PAT-CAL-03](#pat-cal-03) | calificare | Intervenții pe rețele de gaze în contracte de drumuri sau apă-canal | cuvant_cheie | ridicata | ⚖️ |
| [PAT-CAL-04](#pat-cal-04) | calificare | Personal cheie: legitimații ANRE cu terminologie veche și RTE „pentru gaze” | cuvant_cheie | ridicata | ⚖️ |
| [PAT-CAL-05](#pat-cal-05) | calificare | Experiență similară formulată ca „identică” sau limitată strict la tipul de rețea din obiect | cuvant_cheie | ridicata | ⚖️ |
| [PAT-CAL-06](#pat-cal-06) | calificare | Experiență similară: contract „finalizat/semnat în ultimii 5 ani” sau plafon peste valoarea estimată | calcul | ridicata | ⚖️ |
| [PAT-CAL-07](#pat-cal-07) | calificare | Documentele de dovedire a experienței similare | camp_lipsa | ridicata | ⚖️ |
| [PAT-CAL-08](#pat-cal-08) | calificare | Cifra de afaceri minimă disproporționată sau pe mai mult de 3 ani | calcul | ridicata | ⚖️ |
| [PAT-CAL-09](#pat-cal-09) | calificare | Cerințe de nișă fără legătură aparentă cu lucrările (atestate de alt tip, licență ANRSC, experiență „exclusiv în gaze”, utilaje specifice) | judecata_umana | medie | ⚖️ |
| [PAT-CAL-10](#pat-cal-10) | calificare | Personal cheie: același expert pe mai multe loturi și documentele de experiență | camp_lipsa | medie | ⚖️ |
| [PAT-CAL-11](#pat-cal-11) | calificare | Calificarea sudorilor: autorizație ISCIR vs certificate EN ISO 9606-1 / EN 13067 | cuvant_cheie | ridicata | ⚖️ |
| [PAT-CAL-12](#pat-cal-12) | calificare | VERIFICARE INTERNĂ: autorizațiile sudorilor nominalizați (expirate sau la alt angajator) | comparatie_documente | ridicata | ⚖️ |
| [PAT-CAL-13](#pat-cal-13) | calificare | Certificări cerute la calificare (SR EN ISO 3834-2 / IWE, ISO 9001 / 14001 / 45001) — echivalențe | cuvant_cheie | medie | ⚖️ |
| [PAT-CAL-14](#pat-cal-14) | calificare | Autorizare AFER (subtraversări CF) sau alte autorizări de nișă pentru activități din CS — la ofertă sau la execuție | judecata_umana | medie | ⚖️ |
| [PAT-CAL-15](#pat-cal-15) | calificare | Legitimație ANRE cerută managerului de proiect / șefului de proiect / șefului de șantier | cuvant_cheie | ridicata | ⚖️ |
| [PAT-CAL-16](#pat-cal-16) | calificare | VERIFICARE INTERNĂ: DUAE completat efectiv (cash-flow, ES cu subsecvente, procente de subcontractare, alpha) | comparatie_documente | ridicata |  |
| [PAT-CAL-17](#pat-cal-17) | calificare | Asociere: cerințele de capacitate se cumulează sau se aplică proporțional cu cota de implicare | camp_lipsa | ridicata |  |
| [PAT-GAR-01](#pat-gar-01) | garantie | Garanția de participare: cuantum, valabilitate, forma instrumentului și condiții impuse emitentului | cuvant_cheie | ridicata | ⚖️ |
| [PAT-GAR-02](#pat-gar-02) | garantie | Garanția de bună execuție cumulată cu Sumele Reținute; rețineri succesive; restituire | camp_lipsa | ridicata |  |
| [PAT-GAR-03](#pat-gar-03) | garantie | Perioada de garanție a lucrărilor: categoria de importanță / clasa de consecințe / garanția ANRE de 2 ani | camp_lipsa | ridicata | ⚖️ |
| [PAT-GAR-04](#pat-gar-04) | garantie | Garanția pentru refacerea structurii rutiere (5 ani) și cine o asigură | judecata_umana | ridicata |  |
| [PAT-GAR-05](#pat-gar-05) | garantie | Sume Reținute aplicate deși GBE nu se constituie prin rețineri succesive | comparatie_documente | ridicata |  |
| [PAT-GAR-06](#pat-gar-06) | garantie | VERIFICARE INTERNĂ: cauțiunea pentru contestație — cuantum, plafon, termen, restituire | calcul | ridicata | ⚖️ |
| [PAT-TRM-01](#pat-trm-01) | termen | Termenul de execuție și graficul Gantt — ce include și ce nivel de detaliu | judecata_umana | ridicata |  |
| [PAT-TRM-02](#pat-trm-02) | termen | Răspunsurile la clarificări publicate cu mai puțin de 10 (6) zile înainte de termenul de depunere | calcul | ridicata |  |
| [PAT-TRM-03](#pat-trm-03) | termen | VERIFICARE INTERNĂ: termenul de contestare a documentației / a răspunsului la clarificări | calcul | medie | ⚖️ |
| [PAT-TRM-04](#pat-trm-04) | termen | Termenul de execuție la racorduri/extinderi vs termenele maxime din Ord. ANRE 7/2022 art. 37 | calcul | ridicata |  |
| [PAT-TRM-05](#pat-trm-05) | termen | Termene de clarificare/depunere care se suprapun peste sărbători legale (1–2 zile lucrătoare efective) | calcul | medie | ⚖️ |
| [PAT-CTC-01](#pat-ctc-01) | contract | Ajustarea prețului lipsește la durate de peste 6 luni / contradicție cu prețul ferm (cl. 48.2) | calcul | ridicata |  |
| [PAT-CTC-02](#pat-ctc-02) | contract | Formula de ajustare folosește indici nepublicați (ex. ICCplr) sau preluați din OUG 64/2022 | cuvant_cheie | ridicata |  |
| [PAT-CTC-03](#pat-ctc-03) | contract | Penalitățile de întârziere nu sunt stabilite (se aplică valoarea implicită din cl. 36.4) | camp_lipsa | ridicata |  |
| [PAT-CTC-04](#pat-ctc-04) | contract | Avansul — acordare, cuantum și modul de recuperare | camp_lipsa | ridicata |  |
| [PAT-CTC-05](#pat-ctc-05) | contract | Contract cu prețuri unitare sau cu preț global — modul de plată a cantităților | camp_lipsa | ridicata |  |
| [PAT-CTC-06](#pat-ctc-06) | contract | Clauze privind salariile minime din contractele colective de muncă (Legea 283/2024) | camp_lipsa | medie | ⚖️ |
| [PAT-CTC-07](#pat-ctc-07) | contract | Asigurările executantului: CAR și răspunderea civilă pentru vicii ascunse 10 ani (Legea 169/2026) | camp_lipsa | medie | ⚖️ |

## Contradicții între documente

### PAT-CTR-01
**Aceeași cerință are valori diferite în fișa de date, caietul de sarcini și contract**  · încredere ridicata · vechi: CL-A07

- **Trigger:** aceeași noțiune (termen de execuție, perioadă de garanție, servicii incluse — ex. asistență tehnică, obținere avize) apare cu valori/incluziuni diferite în ≥ 2 documente ale DA _(caută în: fisa_de_date, caiet_sarcini, contract; detecție: comparatie_documente)_
- **Documente de verificat:** Fișa de date; Caiet de sarcini; Model de contract / acord contractual
- **Cerințe:** `REQ-AD-010` HG 395/2016 art. 20 alin. (2); `REQ-AD-009` 665/2023 (BO, nr. complet anonimizat) motivare (art. 209 L98, art. 134–135 HG 395); `REQ-P0-033` Legea 98/2016 art. 181; `REQ-P0-034` HG 395/2016 art. 30 alin. (6)
- **Precedente CNSC:** BO2023_665, BO2026_2328, BO2023_427

> **Întrebare (text extern):** Fișa de date ([secțiunea …], pag. […]) prevede [X]; caietul de sarcini ([cap. …], pag. […]) și/sau modelul de contract ([clauza …]) prevăd [Y]. Vă rugăm să precizați care prevedere se aplică și, dacă este cazul, să publicați documentele actualizate.

- 🔒 **Impact intern (nu se trimite):** tehnic — Ofertăm pe o ipoteză tehnică greșită dacă alegem varianta nevalabilă. · cost — Diferența de preț între variante (ex. servicii incluse/excluse). · risc — Mediu: CNSC nu întoarce contradicția împotriva ofertantului (BO2023_665), dar disputa costă timp; se închide înainte de depunere.
- **Notă:** v1.1: HG 395 art. 30 alin. (6) (REQ-P0-034) — criteriile de calificare apărute doar în CS sunt clauze nescrise; BO2026_2328 confirmă (autorizări cerute doar în CS nu fundamentează respingerea). BO2023_427: contradicția VE anunț vs deviz SF a dus la anularea procedurii — de ridicat ÎNAINTE de depunere. Cazul dedicat calificare-doar-în-CS: PAT-CTR-04.

### PAT-CTR-02
**Cantitate din F3/lista de cantități diferită de planșe sau memoriu**  · încredere ridicata · vechi: CL-C07

- **Trigger:** pentru același articol (cod, UM) cantitatea din F3 diferă de cea măsurată pe planșe/memoriu (prag intern: > 2 % sau > 1 UM la articole unitare) _(caută în: F3, planse, caiet_sarcini; detecție: calcul)_
- **Documente de verificat:** Formular F3 / liste de cantități pe obiecte; Planșe (situație, profile longitudinale); Memoriu tehnic
- **Cerințe:** `REQ-AD-074` 3104/2026 (BO, nr. complet anonimizat) motivare (L98 art. 210; HG 395 art. 136–137); `REQ-AD-123` HG 907/2016 Anexa (conținut-cadru PT), Secțiunea V — Formularul F3, Precizări; `REQ-AD-107` HG 1/2018 Anexa 1, cl. 49.1; `REQ-AD-131` HG 907/2016 Formular F3 coloana 3 (cantitate) — coroborat cu Decizia CNSC BO2026_3104; `REQ-P2-081` Ordin ANRE 89/2018 (NTPEE-2018) art. 75 alin. (1)-(2); art. 194 alin. (2)-(3); art. 195; `REQ-P2-085` Ordin ANRE 89/2018 (NTPEE-2018) art. 194 alin. (1)-(2), (5); art. 196 alin. (1)-(3); `REQ-P2-102` Ordin ANRE 89/2018 (NTPEE-2018) art. 195
- **Precedente CNSC:** BO2026_3104, BO2021_1060, BO2025_1138

> **Întrebare (text extern):** La poziția [cod articol] din lista de cantități [nr./obiect] figurează [cantitate, UM]; din planșa [nr.] / memoriul tehnic (pag. […]) rezultă [cantitate, UM]. Vă rugăm să precizați cantitatea care trebuie ofertată și, dacă este cazul, să publicați lista de cantități corectată.

- 🔒 **Impact intern (nu se trimite):** tehnic — Cantitatea reală de executat diferă de cea plătită/ofertată. · cost — Ofertantul nu poate corecta F3 în ofertă; diferența rămâne risc de execuție (la preț unitar se plătește cantitatea măsurată, cl. 49.1). · risc — Ridicat dacă reducem cantitatea în ofertă: cantitățile publicate sunt obligatorii (BO2026_3104).
- **Notă:** Clarificarea e singurul canal de corectare înainte de depunere. v1.1: dimensiunile obligatorii ale șanțului (NTPEE art. 75, 194–196; REQ-P2-081/085) și supralărgirea refacerii (art. 195; REQ-P2-102) dau reperul de calcul pentru săpătură/umplutură/refacere. BO2025_1138 confirmă: justificarea prețului se raportează exact la C6/F3, deci cantitatea trebuie lămurită înainte.

### PAT-CTR-03
**Răspunsul la clarificări modifică DA, dar documentul-sursă nu a fost republicat**  · încredere ridicata · vechi: —

- **Trigger:** un răspuns publicat schimbă o valoare/cerință, iar documentul DA cu aceeași cerință rămâne în forma inițială în SEAP _(caută în: raspunsuri_clarificari, fisa_de_date, caiet_sarcini; detecție: comparatie_documente)_
- **Documente de verificat:** Răspunsuri la clarificări (toate rundele); Documentul DA vizat
- **Cerințe:** `REQ-AD-002` Legea 98/2016 art. 160 alin. (2); `REQ-AD-007` Ghid ANAP privind gestionarea solicitărilor de clarificări (propunere) secțiunile privind răspunsurile formale și modificarea DA prin clarificări; `REQ-P0-025` Legea 98/2016 art. 160 alin. (3); `REQ-P0-026` HG 395/2016 art. 27 alin. (1)
- **Precedente CNSC:** BO2023_1128

> **Întrebare (text extern):** Prin răspunsul nr. [X] din [data] ați precizat [Y]; documentul [denumire] publicat (pag. […]) prevede în continuare [W]. Vă rugăm să confirmați că se aplică prevederea din răspunsul la clarificări și dacă documentul [denumire] va fi republicat în forma actualizată.

- 🔒 **Impact intern (nu se trimite):** tehnic — Echipa poate lucra pe versiunea veche a cerinței. · cost — Depinde de cerință. · risc — Mediu: comisia poate evalua după documentul nemodificat.
- **Notă:** REQ-AD-007 (ghid ANAP 2020) nu e verificat pe sursă — folosit doar ca context, nu e citat. v1.1: confidence medie→ridicata — L98 art. 160 alin. (3) și HG 395 art. 27 alin. (1) (REQ-P0-025/026, verificate) fixează publicarea răspunsurilor în SEAP; BO2023_1128 confirmă publicarea modificărilor prin erată cu nou termen de depunere.

### PAT-CTR-04
**Cerință de calificare prezentă doar în caietul de sarcini, nu și în anunț / fișa de date**  · încredere ridicata · vechi: —

- **Trigger:** CS cere o autorizare, experiență, personal sau certificare formulată ca „ofertantul trebuie să dețină/prezinte”, iar anunțul de participare / fișa de date nu o includ printre criteriile de calificare _(caută în: caiet_sarcini, fisa_de_date; detecție: comparatie_documente)_
- **Documente de verificat:** Anunț de participare; Fișa de date; Caiet de sarcini
- **Cerințe:** `REQ-P0-033` Legea 98/2016 art. 181; `REQ-P0-034` HG 395/2016 art. 30 alin. (6)
- **Precedente CNSC:** BO2026_2328, BO2024_717, BO2024_1706

> **Întrebare (text extern):** Caietul de sarcini ([cap. …], pag. […]) prevede „[citat cerință]”, cerință care nu figurează în anunțul de participare / fișa de date. Vă rugăm să precizați dacă această cerință constituie criteriu de calificare, verificat la evaluarea ofertelor, sau cerință aplicabilă pe durata execuției contractului și, în al doilea caz, momentul în care se prezintă documentele aferente.

- 🔒 **Impact intern (nu se trimite):** tehnic — Decide dacă documentul trebuie pregătit acum sau la execuție. · cost — Costul obținerii documentului înainte de depunere. · risc — Scăzut pentru Gazpet (HG 395 art. 30 alin. (6): clauză nescrisă); ridicat dacă AC o clasifică totuși drept calificare și n-o contestăm.
- **Notă:** v1.1 (nou): HG 395 art. 30 alin. (6) (REQ-P0-034) și L98 art. 181 (REQ-P0-033), verificate; trei decizii concordante (BO2026_2328, BO2024_717, BO2024_1706).

## Informație lipsă

### PAT-INF-01
**Utilități subterane, avize de amplasament, autorizație de construire, predarea amplasamentului**  · încredere ridicata · vechi: CL-A01

- **Trigger:** DA nu conține planul cu rețelele edilitare existente, avizele de amplasament sau stadiul autorizației de construire; contractul are clauză de condiții fizice neprevăzute (cl. 21.1) _(caută în: caiet_sarcini, planse, contract; detecție: camp_lipsa)_
- **Documente de verificat:** Planșe de situație; Avize/acorduri anexate; Autorizație de construire; Condiții contractuale cl. 21.1
- **Cerințe:** `REQ-AD-113` HG 1/2018 Anexa 1, cl. 21.1; `REQ-SC-017` HG 300/2006 anexa nr. 4 partea B pct. 10.2; `REQ-SC-110` Legea 123/2012 — Titlul II Gaze naturale art. 190 lit. b)–d); `REQ-SC-113` Ordin ANRE 89/2018 (NTPEE-2018) art. 28; art. 27; `REQ-P1-101` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 267 alin. (1)
- **Precedente CNSC:** BO2023_1128

> **Întrebare (text extern):** Vă rugăm să ne transmiteți, pentru [obiect], planurile de situație cu rețelele edilitare existente, avizele de amplasament obținute și autorizația de construire (sau termenul estimat de emitere), precum și termenul estimat de predare a amplasamentului. Vă rugăm să precizați și modul de tratare a rețelelor neidentificate în planuri, în raport cu subclauza 21.1 din condițiile contractuale.

- 🔒 **Impact intern (nu se trimite):** tehnic — Risc de avarii la rețele existente; sondaje manuale suplimentare. · cost — Sondaje, relocări, întârzieri neplătite. · risc — Scăzut (nu afectează conformitatea), dar ridicat pe execuție.
- **Notă:** v1.1: BO2023_1128 — la P+E documentația trebuie să includă perioada estimată pentru obținerea autorizației de construire; vizitarea amplasamentului nu poate fi condiție de conformitate.

### PAT-INF-02
**Lucrări în zona drumului: acord și autorizație de amplasare, restricții de circulație, tarife — în sarcina cui**  · încredere ridicata · vechi: CL-A05

- **Trigger:** traseul este în zona drumului public (ampriză, zonă de siguranță) și DA nu precizează cine obține acordul prealabil/autorizația de amplasare și cine plătește tarifele; branșamente pentru construcții existente / SAU: lucrări în carosabil/trotuar fără articol în F3 pentru semnalizare temporară și fără precizarea cine obține aprobarea administratorului și a poliției rutiere _(caută în: caiet_sarcini, fisa_de_date, F3; detecție: judecata_umana)_
- **Documente de verificat:** Caiet de sarcini; Planșe de situație; F1/F3 (capitol avize); Liste de cantități; Planșe de organizare
- **Cerințe:** `REQ-SC-041` OG 43/1997 art. 46 alin. (1); `REQ-SC-042` OG 43/1997 art. 46 alin. (3); `REQ-SC-044` OG 43/1997 art. 46 alin. (9)–(10); `REQ-SC-078` Clarificări MDLPA — aplicarea Legii 169/2026 (septembrie 2026) răspunsul despre branșamente (trimite la Legea 169/2026 art. 267 alin. (1)); `REQ-SC-079` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 267 alin. (1) (după clarificarea MDLPA); `REQ-SC-069` Ordin MI/MT 1112/411/2000 Partea I pct. (1)–(3), tabelul nr. 1; pct. (4), tabelul nr. 2; `REQ-SC-070` Ordin MI/MT 1112/411/2000 Partea I pct. (6); `REQ-SC-071` Ordin MI/MT 1112/411/2000 Partea I pct. (8) pct. 8.1–8.5; pct. (7); `REQ-SC-073` Ordin MI/MT 1112/411/2000 Partea I pct. (13) lit. c)–g); `REQ-SC-077` Ordin MI/MT 1112/411/2000 Partea I pct. (19); `REQ-P1-101` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 267 alin. (1); `REQ-P2-101` Ordin MTI 1668/2023 Anexă pct. 3.4.1 alin. (5); pct. 3.4.5 alin. (2); `REQ-P0-076` Ordin ANRE 7/2022 art. 54^1; `REQ-P0-084` Ordin ANRE 7/2022 art. 46 alin. (2) lit. m)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Pentru [traseul / branșamentele] din zona drumului [denumire], vă rugăm să precizați cine obține acordul prealabil și autorizația de amplasare și/sau de acces și cine suportă tarifele aferente, precum și dacă documentația pentru restricționarea circulației (scheme de semnalizare temporară, rute ocolitoare) și aprobările aferente sunt în sarcina executantului. Dacă acestea sunt în sarcina executantului, vă rugăm să indicați capitolul din F1/F3 sau articolul din listele de cantități în care se cuprind.

- 🔒 **Impact intern (nu se trimite):** tehnic — Fără autorizație, lucrarea se poate desființa (OG 43/1997 art. 46). Cererea se depune cu ≥ 30 de zile înainte de începere (unele categorii). · cost — Tarife de utilizare și acces, garanții, termene de obținere. Semnalizare, personal, rute ocolitoare. · risc — Scăzut. Scăzut; răspunderea pentru accidente revine executantului.
- **Notă:** Corectură runda 1: regimul branșamentelor pentru construcții existente sub Legea 169/2026 (REQ-SC-078/079) e neverificat pe sursă — nu se citează în întrebare. Contopit cu: Restricții de circulație și semnalizare temporară — documentație, aprobări, cost. v1.1: REQ-P1-101 (L169/2026 art. 267 alin. (1), verificat) confirmă parțial regimul acordului administratorului drumului pentru racordări; REQ-SC-078/079 rămân neverificate și nu se citează. REQ-P0-076: la racorduri pe autorizația administratorului drumului, PV de recepție tehnică ține loc de PV la terminare.

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
**Verificarea proiectului (componenta de proiectare la P+E) — cine contractează și plătește verificatorii**  · încredere ridicata · vechi: —

- **Trigger:** contract de proiectare + execuție; DA nu spune cine plătește verificarea proiectului de verificatori atestați (ANRE pentru gaze, MDLPA pentru alte cerințe) _(caută în: fisa_de_date, caiet_sarcini, contract; detecție: camp_lipsa)_
- **Documente de verificat:** Fișa de date; Caiet de sarcini (tema de proiectare); Formular de ofertă financiară
- **Cerințe:** `REQ-TG-006` Legea 123/2012 — Titlul II Gaze naturale art. 160 alin. (1); `REQ-AD-149` HG 925/1995 Regulament, art. 5 (alineatul final); `REQ-TG-024` Ordin ANRE 17/2026 anexa 8, pct. 18; `REQ-P1-067` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 277 alin. (5); `REQ-P1-068` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 440 alin. (1)–(3); `REQ-P1-069` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 440 alin. (4); art. 441–444; `REQ-P1-071` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 449 alin. (2); `REQ-P1-072` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 577 alin. (5); art. 583 alin. (1)–(2); `REQ-P1-073` Legea 123/2012 — Titlul II Gaze naturale art. 160 alin. (1) (via REQ-TG-006); Ord. ANRE 133/2021 (regulament atestare verificatori gaze)
- **Precedente CNSC:** BO2024_2683

> **Întrebare (text extern):** Pentru componenta de proiectare, vă rugăm să precizați dacă verificarea proiectului de către verificatori atestați este în sarcina autorității contractante sau a ofertantului și, în al doilea caz, capitolul din propunerea financiară în care se cuprinde.

- 🔒 **Impact intern (nu se trimite):** tehnic — Execuția gazelor se face numai pe proiecte verificate (anexa 8 pct. 18 Ord. ANRE 17/2026). · cost — Onorarii verificatori pe fiecare specialitate. · risc — Scăzut.
- **Notă:** REQ-AD-149 (HG 925/1995) are încredere medie. v1.1: confidence medie→ridicata — L169/2026 art. 277 alin. (5) (obligația verificării PT revine beneficiarului) și art. 449 alin. (2) (verificatorul nu poate fi aceeași persoană juridică care elaborează proiectul), REQ-P1-067/071; BO2024_2683 cere verificator independent de proiectant la P+E. REQ-P1-073 (verificatori ANRE, regim special) e NEVERIFICAT — nu se citează.

### PAT-INF-06
**Probe, recepție și punere în funcțiune cu operatorul de distribuție — tarife și cuplare**  · încredere ridicata · vechi: —

- **Trigger:** DA nu spune cine solicită/plătește prezența delegatului OSD la probe și recepții și cine execută cuplarea la rețeaua existentă _(caută în: caiet_sarcini, F3; detecție: camp_lipsa)_
- **Documente de verificat:** Caiet de sarcini; Liste de cantități (probe, cuplări); Aviz tehnic de racordare / acord OSD
- **Cerințe:** `REQ-TG-083` Ordin ANRE 89/2018 (NTPEE-2018) art. 268 alin. (1); `REQ-TG-007` Legea 123/2012 — Titlul II Gaze naturale art. 162 alin. (1); `REQ-TG-080` Ordin ANRE 89/2018 (NTPEE-2018) art. 254 lit. a)-c), f); `REQ-TG-099` Ordin ANRE 89/2018 (NTPEE-2018) art. 296 alin. (1)-(2); `REQ-P0-075` Ordin ANRE 7/2022 art. 38 alin. (1)–(3); `REQ-P0-077` Ordin ANRE 7/2022 art. 39 alin. (1), (5); `REQ-P0-078` Ordin ANRE 7/2022 art. 39 alin. (3); `REQ-P0-080` Ordin ANRE 7/2022 art. 46 alin. (2) lit. h); `REQ-P0-083` Ordin ANRE 7/2022 art. 46 alin. (2) lit. l)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați cine solicită și cine suportă eventualele tarife ale operatorului de distribuție pentru participarea la probe, la recepția lucrărilor ascunse și la punerea în funcțiune, precum și dacă racordarea la rețeaua existentă (cuplarea) se execută de ofertant sau de operator.

- 🔒 **Impact intern (nu se trimite):** tehnic — Cuplarea sub presiune cere echipamente/proceduri OSD. · cost — Tarife OSD, echipe de cuplare. · risc — Scăzut.
- **Notă:** v1.1: Ord. ANRE 7/2022 (verificat): PIF racord + SRM/PRM de către OSD cu PV din anexele 10/11 NTPEE (REQ-P0-077), PIF instalație de utilizare în 5/10 zile lucrătoare (REQ-P0-078), cererea de diriginte OSD cu ≥ 7 zile lucrătoare înainte (REQ-P0-080) — de prins în grafic. Contractele cu convenție tehnică: PAT-INF-13.

### PAT-INF-07
**Localitate cu concesiune a serviciului de distribuție gaze**  · încredere medie · vechi: CL-P04

- **Trigger:** localitatea din obiect are concesionar al distribuției; DA nu spune dacă investiția e în obligațiile concesionarului și cine preia rețeaua în exploatare _(caută în: fisa_de_date, caiet_sarcini; detecție: judecata_umana)_
- **Documente de verificat:** Fișa de date; Studiu de fezabilitate / memoriu; Avize OSD
- **Cerințe:** `REQ-P0-070` Ordin ANRE 7/2022 art. 44 alin. (1) lit. a); `REQ-P0-085` Ordin ANRE 7/2022 art. 54; `REQ-P0-086` Ordin ANRE 7/2022 art. 53
- **Precedente CNSC:** BO2026_2669

> **Întrebare (text extern):** Vă rugăm să precizați dacă pentru [localitate] există un contract de concesiune a serviciului de distribuție a gazelor naturale, care este operatorul de distribuție și cine va prelua rețeaua în exploatare după recepție.

- 🔒 **Impact intern (nu se trimite):** tehnic — Avizele și recepția depind de concesionar. · cost — Poate apărea anularea procedurii (cost ofertare pierdut). · risc — Procedura poate fi anulată (BO2026_2669).
- **Notă:** Fără requirement_id; temei doar precedentul CNSC. v1.1: are acum temei verificat — Ord. ANRE 7/2022 art. 44 alin. (1) lit. a) (OSD selectează OEP/OEE prin proceduri concurențiale), art. 53–54 (REQ-P0-070/085/086). Precedentul BO2026_2669 rămâne relevant pentru suprapunerea cu concesiunea.

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
- **Cerințe:** `REQ-TG-080` Ordin ANRE 89/2018 (NTPEE-2018) art. 254 lit. a)-c), f); `REQ-TG-097` Ordin ANRE 89/2018 (NTPEE-2018) art. 286 lit. e)-f); `REQ-TG-081` Ordin ANRE 89/2018 (NTPEE-2018) art. 262 alin. (1)-(4); `REQ-P2-097` Ordin ANRE 89/2018 (NTPEE-2018) art. 254 lit. b)-c); art. 259; art. 262 alin. (3); `REQ-P0-081` Ordin ANRE 7/2022 art. 46 alin. (2) lit. i)
- **Precedente CNSC:** —

> **Întrebare (text extern):** NTPEE, art. 254, prevede verificarea rezistenței izolației după umplerea șanțului, consemnată în PV de lucrări ascunse cu buletin de laborator autorizat. Vă rugăm să precizați metoda de verificare cerută, lungimea tronsoanelor, criteriul de acceptare și articolul din listele de cantități în care se cuprinde.

- 🔒 **Impact intern (nu se trimite):** tehnic — Metode diferite (rezistență izolație / DCVG / PCM) au echipamente diferite. · cost — Laborator autorizat, repetări. · risc — Scăzut.
- **Notă:** v1.1: REQ-P2-097 (NTPEE art. 254, 259, 262 — PV de lucrări ascunse pentru izolație) și REQ-P0-081 (lucrări ascunse acoperite doar cu dirigintele OSD) confirmă. Metoda de măsurare (SR EN 13509, REQ-P2-051) e NEVERIFICATĂ — nu se citează.

### PAT-INF-10
**Protecția catodică — inclusă sau nu în obiect** · ⚖️ review juridic · încredere medie · vechi: CL-T12

- **Trigger:** conductă de oțel îngropată; CS/F3 nu precizează dacă se execută stația de protecție catodică, anozi, prize sau doar posturi de măsurare și piese electroizolante _(caută în: caiet_sarcini, F3, planse; detecție: judecata_umana)_
- **Documente de verificat:** Caiet de sarcini; Liste de cantități; Planșe
- **Cerințe:** `REQ-TG-110` SR EN 12954 (EN 12954:2019) NTPEE anexa 2 poz. 49 + STAS 7335 (poz. 38-46); `REQ-P2-049` SR EN 12954 (EN 12954:2019) NTPEE anexa 2 poz. 49; art. 258, 263; `REQ-P2-050` EN ISO 15589-1:2026 (anterior EN ISO 15589-1:2017) —; `REQ-P2-040` STAS 7335 /1-86, /2-88, /4-77, /5-90, SR 7335-6:1998, /7-87, /8-85, /9-88, /10-77 NTPEE anexa 2 poz. 38-46
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați dacă obiectul contractului include realizarea protecției catodice (stație, anozi, prize de pământ) sau numai posturile de măsurare și piesele electroizolante și, în primul caz, măsurătorile cerute la recepție.

- 🔒 **Impact intern (nu se trimite):** tehnic — Domeniu de lucrări diferit (specialitate distinctă). · cost — Semnificativ dacă include stația. · risc — Scăzut.
- **Notă:** temei de confirmat: șablonul vechi cita NTPEE art. 263 și SR EN 12954 / EN ISO 15589-1:2026 — fără cerință verificată (REQ-TG-110 neverificat, standard licențiat). Citările au fost scoase din întrebare. v1.1: confidence scazuta→medie — REQ-P2-049 (verificat: SR EN 12954 recomandat în anexa 2, legat de NTPEE art. 258, 263; ediția 2002 depășită de 2019) și REQ-P2-040 (seria STAS 7335 recomandată) confirmă că protecția catodică e cerință de proiect, nu standard obligatoriu. Criteriile tehnice cer standard licențiat; întrebarea rămâne neutră, fără citare de standard. Revizuirea juridică rămâne (domeniu de lucrări).

### PAT-INF-11
**Valoarea estimată pe lot/obiect nu este publicată**  · încredere ridicata · vechi: CL-C01

- **Trigger:** fișa de date dă doar VE totală (sau cu TVA / fără precizarea opțiunilor și a diverselor și neprevăzutelor) _(caută în: fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Fișa de date; Anunț de participare
- **Cerințe:** `REQ-AD-066` HG 395/2016 art. 136 alin. (4); `REQ-P0-054` HG 395/2016 art. 137 alin. (2) lit. b), e), f), j), k)
- **Precedente CNSC:** BO2025_647, BO2023_427, BO2025_3638, BO2024_3631

> **Întrebare (text extern):** Vă rugăm să precizați valoarea estimată fără TVA pentru fiecare lot/obiect și dacă aceasta include [opțiunile / cheltuielile diverse și neprevăzute].

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Reperul pentru pragul de preț aparent neobișnuit de scăzut. · risc — Indirect: pragul de 80 % declanșează justificarea prețului.
- **Notă:** Corectură runda 1: motivul (pragul de 80 %) nu se mai menționează în întrebare — ar dezvălui strategia de preț. v1.1: confirmat — BO2025_3638: diversele și neprevăzutele din devizul general nu fac parte din valoarea contractului (oferta peste VE nu se validează adăugându-le); BO2024_3631: includerea D&N în VE nu justifică singură anularea; BO2023_427: VE necorelată cu devizul SF → anulare. HG 395 art. 137 alin. (2) (REQ-P0-054): prețul peste VE fără fonduri suplimentare → ofertă inacceptabilă.

### PAT-INF-12
**Formularele de extrase de resurse (C6–C9) sunt cerute, dar nepublicate**  · încredere medie · vechi: CL-C06

- **Trigger:** fișa de date cere C6–C9 / extrase de resurse, dar formularele nu sunt în SEAP sau F3 nu are coloanele de resurse _(caută în: fisa_de_date, F3; detecție: camp_lipsa)_
- **Documente de verificat:** Fișa de date; Formulare publicate
- **Cerințe:** `REQ-AD-129` Ghid P91/1-02 (Ord. MLPTL 1568/2002) pct. 2.4; `REQ-P2-058` Ghid P91/1-02 (Ord. MLPTL 1568/2002) pct. 2.2.3; 3.3.1.4; `REQ-P2-059` Ghid P91/1-02 (Ord. MLPTL 1568/2002) pct. 2.2.4-2.2.6
- **Precedente CNSC:** BO2025_1138

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită formularele [C6–C9]. Vă rugăm să le publicați în format editabil sau să confirmați că se acceptă extrasele de resurse generate de programul de deviz al ofertantului, cu conținutul cerut (resursă, UM, cantitate, preț unitar, valoare).

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Timp de reformatare. · risc — Mediu: formular lipsă = neconformitate formală posibilă.
- **Notă:** Ghidul P91/1-02 (REQ-AD-129) nu e verificat pe sursă — nu se citează. v1.1: P91/1-02 are acum cerințe verificate (pct. 2.2.3–2.2.6, REQ-P2-058/059); REQ-AD-129 rămâne neverificat. BO2025_1138 confirmă importanța C6: justificarea prețului trebuie să susțină exact prețurile unitare din C6/F3.

### PAT-INF-13
**Racorduri/extinderi pentru racordare (Ord. ANRE 7/2022): varianta de realizare și convenția tehnică cu OSD**  · încredere medie · vechi: —

- **Trigger:** obiectul include racorduri/branșamente sau extinderi necesare racordării unor solicitanți, iar DA nu spune în ce variantă de racordare se încadrează lucrarea și dacă executantul semnează o convenție tehnică cu OSD (GBE 10 %, garanție ≥ 24 luni, asigurare, penalități) _(caută în: fisa_de_date, caiet_sarcini, contract; detecție: judecata_umana)_
- **Documente de verificat:** Fișa de date; Caiet de sarcini; Model de contract; ATR / contract de racordare (dacă e anexat)
- **Cerințe:** `REQ-P0-065` Ordin ANRE 7/2022 art. 5 alin. (2); art. 6 alin. (3) lit. a)–c); `REQ-P0-069` Ordin ANRE 7/2022 art. 6 alin. (5) lit. b); art. 44 alin. (1) lit. b), (2); `REQ-P0-070` Ordin ANRE 7/2022 art. 44 alin. (1) lit. a); `REQ-P0-090` Ordin ANRE 7/2022 anexa 5, art. 16; `REQ-P0-091` Ordin ANRE 7/2022 anexa 5, art. 17; `REQ-P0-092` Ordin ANRE 7/2022 anexa 5, art. 18 alin. (1); `REQ-P0-094` Ordin ANRE 7/2022 anexa 5, art. 23; `REQ-P0-095` Ordin ANRE 7/2022 anexa 5, art. 48
- **Precedente CNSC:** —

> **Întrebare (text extern):** Obiectul contractului include [racorduri / extinderea conductei] pentru racordarea [solicitanților …] la sistemul de distribuție operat de [OSD]. Vă rugăm să precizați: (a) în ce variantă de realizare a racordării, dintre cele prevăzute la art. 6 alin. (3) din Regulamentul aprobat prin Ordinul ANRE nr. 7/2022, se încadrează lucrările; (b) dacă executantul va încheia o convenție tehnică cu operatorul de distribuție și, în caz afirmativ, dacă garanția de bună execuție și perioada de garanție prevăzute în anexa nr. 5 la regulament se constituie suplimentar față de cele din contract.

- 🔒 **Impact intern (nu se trimite):** tehnic — Diriginte OSD, recepție/PIF prin OSD, documente pentru cartea construcției. · cost — Posibilă dublare a GBE (10 % către OSD + GBE din contract) și a asigurărilor. · risc — Scăzut la ofertare; risc contractual de dublă garanție.
- **Notă:** v1.1 (nou): Ord. ANRE 7/2022 verificat (REQ-P0-065…095). Aplicabilitatea convenției tehnice la contractele atribuite prin SEAP de UAT/OSD diferă de la caz la caz — de aceea întrebarea e deschisă. Tarifele OSD și cuplarea: PAT-INF-06.

### PAT-INF-14
**Recepții parțiale pe tronsoane/obiecte și regimul de recepție aplicabil (L169/2026, HG 273/1994)**  · încredere ridicata · vechi: —

- **Trigger:** lucrare liniară pe mai multe tronsoane/străzi sau cu branșamente, iar DA nu spune dacă se fac recepții la terminare pe tronsoane distincte fizic și funcțional și dacă recepția rețelei se face împreună cu recepția branșamentelor _(caută în: caiet_sarcini, contract; detecție: camp_lipsa)_
- **Documente de verificat:** Caiet de sarcini; Acord contractual / Condiții speciale; Grafic de execuție
- **Cerințe:** `REQ-P1-075` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 577 alin. (6); `REQ-P1-076` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 527 alin. (2)–(3); `REQ-P1-077` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 574; `REQ-P1-078` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 528 alin. (3); `REQ-P1-079` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 528 alin. (4); `REQ-P1-087` HG 273/1994 — Regulament privind receptia constructiilor (forma HG 343/2017) art. 10 alin. (1) lit. c)
- **Precedente CNSC:** BO2024_942

> **Întrebare (text extern):** Vă rugăm să precizați dacă se vor organiza recepții la terminarea lucrărilor pe tronsoane/obiecte distincte fizic și funcțional (art. 527 alin. (3) din Legea nr. 169/2026), dacă recepția [rețelei] se face împreună cu recepția branșamentelor și care sunt documentele pe care executantul trebuie să le predea pentru fiecare recepție.

- 🔒 **Impact intern (nu se trimite):** tehnic — Planificarea predărilor pe tronsoane; dosarul de recepție (cartea tehnică, PV-uri). · cost — Eliberarea mai rapidă a sumelor/garanțiilor pe tronsoane recepționate; penalități calculate pe prețul rămas (REQ-P1-016). · risc — Scăzut.
- **Notă:** v1.1 (nou): L169/2026 art. 527–528, 574 și HG 273/1994 (rămâne în vigoare, REQ-P1-075), verificate. Bonus pentru ES: recepția parțială pe obiecte funcționale independent probează experiența similară (BO2024_942).

## Formulări ambigue

### PAT-AMB-01
**P+E: se cer la ofertă documente care rezultă abia din proiectul tehnic**  · încredere ridicata · vechi: CL-A08

- **Trigger:** contract de proiectare + execuție, iar fișa de date cere la ofertă liste de cantități, extrase de resurse, planșă de organizare sau alte elemente de PT _(caută în: fisa_de_date, caiet_sarcini; detecție: judecata_umana)_
- **Documente de verificat:** Fișa de date; Caiet de sarcini / tema de proiectare
- **Cerințe:** `REQ-AD-122` 3657/C1/4067, 4182 motivare (L98 art. 187, 189; HG 907/2016 art. 12); `REQ-AD-123` HG 907/2016 Anexa (conținut-cadru PT), Secțiunea V — Formularul F3, Precizări; `REQ-P1-056` HG 1/2018 Anexa 2, cl. 49.1
- **Precedente CNSC:** BO2024_3657, BO2024_632, BO2023_1128

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită la ofertă [liste de cantități / extrase de resurse / planșa de organizare de șantier], iar obiectul contractului include elaborarea proiectului tehnic. Vă rugăm să precizați dacă aceste documente se depun la ofertă sau se elaborează după semnarea contractului și, în primul caz, pe ce bază de cantități se întocmesc.

- 🔒 **Impact intern (nu se trimite):** tehnic — Documente fără bază tehnică (PT inexistent). · cost — Efort de ofertare nejustificat. · risc — Mediu: neconformitate pentru document lipsă.
- **Notă:** v1.1: NUANȚĂ — BO2024_632: documentele/procedurile cerute EXPRES în fișa de date trebuie depuse la ofertă și la P+E (nu se amână pentru faza de proiectare). Nu contrazice BO2024_3657 (cerința se contestă la DA), dar dacă DA nu se contestă, cerința se respectă. Anexa 2 HG 1/2018 cl. 49.1: la P+E prețul e forfetar (REQ-P1-056).

### PAT-AMB-02
**Factori de evaluare: noțiuni nedefinite, documente inexistente sau angajamente fără mod de verificare** · ⚖️ review juridic · încredere medie · vechi: CL-P02, CL-P03

- **Trigger:** algoritmul unui factor folosește termeni nedefiniți („tronson”, „adecvat”, „detaliat”) sau trimite la un document nepublicat (PT la P+E) / SAU: factorul punctează elemente fără legătură directă cu obiectul (angajați din comună, vehicule electrice, instruiri) sau fără mecanism de verificare în execuție _(caută în: fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date — factori de evaluare; Documente publicate (SF/DALI/PT); Model de contract (penalități pentru nerespectare)
- **Cerințe:** `REQ-AD-121` 1837/C1/1961 motivare (L98 art. 154 alin. (1), art. 187, 189); `REQ-AD-122` 3657/C1/4067, 4182 motivare (L98 art. 187, 189; HG 907/2016 art. 12); `REQ-P0-043` HG 395/2016 art. 32 alin. (4)–(5); `REQ-P0-045` Legea 98/2016 art. 187 alin. (5) lit. d); `REQ-P0-046` HG 395/2016 art. 32 alin. (2), (8)–(9); `REQ-P0-047` HG 395/2016 art. 32 alin. (6) raportat la L98 art. 187 alin. (8)
- **Precedente CNSC:** BO2025_1837, BO2024_3657, BO2024_2683, BO2025_3409, BO2021_1117

> **Întrebare (text extern):** Pentru factorul de evaluare [denumire], vă rugăm să definiți noțiunea de [tronson / unitate de punctare] și să indicați documentul publicat din care rezultă [tronsoanele / lungimile], respectiv documentul la care se raportează ofertanții în condițiile în care proiectul tehnic se elaborează în cadrul contractului. Pentru factorul [denumire], vă rugăm să precizați și modul în care va fi verificat pe durata contractului angajamentul asumat prin ofertă și consecințele contractuale ale nerespectării lui.

- 🔒 **Impact intern (nu se trimite):** tehnic — Punctaj imposibil de calculat obiectiv. · cost — Ofertă tehnică construită pe ipoteze. Angajamente operaționale greu de respectat. · risc — Risc de punctare arbitrară; procedura poate fi anulată (BO2025_1837). Mediu; un factor favorizant poate fi contestat (BO2024_3657).
- **Notă:** Contestarea factorului e posibilă dacă răspunsul nu clarifică — decizie juridică. Contopit cu: Factori de evaluare „locali” (angajați din zonă, vehicule, training) fără mod de verificare. Corectură runda 1: formularea „considerăm că favorizează operatorii locali… solicităm eliminarea” a fost scoasă (argumentație juridică agresivă). Contestarea se decide separat. v1.1: HG 395 art. 32 (REQ-P0-046) — factori clari, cu avantaj real și legătură cu obiectul; art. 32 alin. (4)–(5) (REQ-P0-043) — personalul punctat nu poate fi și criteriu de calificare. DIVERGENȚĂ de semnalat juridic: BO2024_2683 a reținut ponderea prețului ≤ 40 % la P+E pentru rețele de gaze, în timp ce REQ-P0-047 (HG 395 art. 32 alin. (6) / L98 art. 187 alin. (8)) limitează regula la serviciile intelectuale și la P+E pentru TEN-T și drumuri județene. Factorul „contract colectiv de muncă”: PAT-AMB-09.

### PAT-AMB-03
**Rețete de consum și distanțe de transport ale proiectantului — obligatorii sau orientative**  · încredere ridicata · vechi: CL-C04, CL-C05

- **Trigger:** F3/analizele de preț/răspunsurile AC impun „rețetele proiectantului”, consumuri sau o distanță de transport fixă _(caută în: F3, caiet_sarcini, raspunsuri_clarificari; detecție: cuvant_cheie)_
- **Documente de verificat:** F3 și analize de preț publicate; Răspunsuri la clarificări; Caiet de sarcini
- **Cerințe:** `REQ-AD-130` BO2018_6476 (contestația 195/06.02.2018, nr. anonimizat) motivare (Ghid P91/1-02 pct. 1.4, 2.2.3, 3.3.1.4); `REQ-AD-127` Ghid P91/1-02 (Ord. MLPTL 1568/2002) pct. 1.4 și pct. 3.3.1.4; `REQ-AD-128` Ghid P91/1-02 (Ord. MLPTL 1568/2002) pct. 2.2.3; `REQ-AD-131` HG 907/2016 Formular F3 coloana 3 (cantitate) — coroborat cu Decizia CNSC BO2026_3104; `REQ-AD-133` Ghid P91/1-02 (Ord. MLPTL 1568/2002) pct. 1.4 / 3.3.1.4 (consumuri proprii); `REQ-P2-058` Ghid P91/1-02 (Ord. MLPTL 1568/2002) pct. 2.2.3; 3.3.1.4; `REQ-P2-060` Ghid P91/1-02 (Ord. MLPTL 1568/2002) pct. 3.3.1.5; `REQ-P2-061` Indicator Ts 1981 pagina de gardă (nota editorului) + scrisoarea MFP nr. 62.018/06.11.2001 reprodusă în indicator
- **Precedente CNSC:** BO2018_6476, BO2024_696

> **Întrebare (text extern):** Pentru articolele din Formularul F3 aferente [obiect/categorie], vă rugăm să precizați dacă consumurile de resurse (manoperă, utilaj, transport) și distanța de transport de [x] km indicate în [analizele de preț / documentația proiectantului] sunt obligatorii sau orientative, în condițiile respectării integrale a cantităților din F3 și a cerințelor din caietul de sarcini.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Diferențe de preț unitar. · risc — Mediu: abaterea de la consumuri declarate obligatorii poate duce la neconformitate; reducerea cantităților de material nu e permisă (REQ-AD-131).
- **Notă:** P91/1-02 (REQ-AD-127/128) citit doar indirect, prin BO2018_6476 — nu se citează în întrebare. Un singur precedent CNSC, din 2018. v1.1: confidence medie→ridicata, revizuire juridică eliminată — P91 pct. 2.2.3 și 3.3.1.5 (REQ-P2-058/060, verificate) prevăd că indicatoarele sunt orientative și că ofertantul poate folosi consumuri proprii; nota editorului Ts 2003 (REQ-P2-061) confirmă. BO2024_696 (registru_surse; nu e în cnsc_practica.json) adaugă practica pe articolele asimilate — vezi PAT-AMB-10. REQ-AD-127/128/133 rămân neverificate și nu se citează.

### PAT-AMB-04
**Preț unitar unic pe resursă în toate devizele**  · încredere ridicata · vechi: CL-C08

- **Trigger:** fișa de date/formularele cer (sau nu exclud) prețuri unitare identice pentru aceeași resursă în devize diferite _(caută în: fisa_de_date, F3; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date; Instrucțiuni de completare formulare
- **Cerințe:** `REQ-AD-135` 1923/C9/... (nr. dosar anonimizat în BO2022_1923) motivare (L98 art. 209–210; HG 395 art. 134, 136–137)
- **Precedente CNSC:** BO2022_1923, BO2025_1138

> **Întrebare (text extern):** Vă rugăm să precizați dacă pentru aceeași resursă (material, manoperă, utilaj) prețul unitar trebuie să fie identic în toate devizele pe obiect și dacă este permisă diferențierea costului de transport pe obiecte.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Uniformizare prețuri. · risc — Mediu: diferențe nejustificate → respingere la PANS (BO2022_1923).
- **Notă:** v1.1: BO2025_1138 confirmă că documentele de justificare trebuie să susțină exact prețul unitar din C6/F3.

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
- **Cerințe:** `REQ-AD-032` 1706/C7/1650/1651 motivare (L98 art. 215; HG 395 art. 137); `REQ-AD-029` Legea 98/2016 art. 173 alin. (1); `REQ-P0-033` Legea 98/2016 art. 181; `REQ-P0-034` HG 395/2016 art. 30 alin. (6)
- **Precedente CNSC:** BO2022_1746, BO2024_1706, BO2021_159, BO2024_1529, BO2020_2191, BO2026_2328, BO2026_1360, BO2024_717, BO2021_973, BO2025_833

> **Întrebare (text extern):** Caietul de sarcini ([cap. …]) prevede activitatea [denumire], pentru care este necesară [autorizarea …]. Vă rugăm să precizați dacă dovada acestei autorizări se solicită la depunerea ofertei sau va fi verificată la începerea execuției.

- 🔒 **Impact intern (nu se trimite):** tehnic — Subcontractant autorizat necesar. · cost — Cost subcontractare. · risc — Mediu: autorizările necerute expres nu pot fi motiv de respingere (BO2024_1706), dar verificarea în execuție rămâne.
- **Notă:** BO2021_159 — nuanță: CNSC a obligat AC să verifice capacitatea legală (direct sau prin subcontractanți), nu a declarat oferta neconformă. v1.1: confirmat de 6 decizii noi: autorizările cerute doar în CS/„recomandate” nu fundamentează respingerea (BO2026_2328, BO2024_717, BO2026_1360, BO2024_1529). EXCEPȚIE: BO2020_2191 — dacă fișa de date cere dovada capacității pentru TOATE activitățile și CS include o activitate autorizată (AFER), autorizarea se dovedește la ofertă. Cazul AFER/CF: PAT-CAL-14.

### PAT-AMB-07
**Verificarea îmbinărilor din PE — alte încercări decât examinarea vizuală**  · încredere ridicata · vechi: CL-T13

- **Trigger:** CS nu precizează dacă la PE se cer încercări pe îmbinări de probă/nedistructive sau cere „încercări conform standardelor” fără frecvență _(caută în: caiet_sarcini, F3; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Liste de cantități
- **Cerințe:** `REQ-TG-077` Ordin ANRE 89/2018 (NTPEE-2018) art. 245; `REQ-TG-078` Ordin ANRE 89/2018 (NTPEE-2018) art. 246; `REQ-TG-109` SR EN 13100-1/-2/-3 NTPEE anexa 2 poz. 57-59 + art. 245; `REQ-P2-035` SR EN 13100-1/-2/-3 NTPEE art. 245 + anexa 2 poz. 57-59; `REQ-P2-028` SR EN 12814-1:2001, -2:2021, -4+AC:2018, -5:2001 PT CR 9-2025 art. 44-45 + anexa 16; PT CR 7-2025 (runda 1); `REQ-P2-031` ISO 12176-2:2025 / -3 / -4 / -5 Delgaz ST 505 (A5/2023) — doar când DA o invocă; `REQ-P2-089` Ordin ANRE 89/2018 (NTPEE-2018) art. 197 alin. (1)-(3); art. 239; art. 240 lit. b); art. 244
- **Precedente CNSC:** —

> **Întrebare (text extern):** NTPEE, art. 245, prevede pentru îmbinările din polietilenă control vizual și, după caz, nedistructiv conform proiectului. Vă rugăm să precizați dacă se solicită și alte verificări decât examinarea vizuală, metodele, frecvența și articolul din listele de cantități în care se cuprind.

- 🔒 **Impact intern (nu se trimite):** tehnic — Încercări pe epruvete/laborator. · cost — Laborator, îmbinări de probă. · risc — Scăzut.
- **Notă:** SR EN 13100 / 12814 (REQ-TG-109) sunt recomandate (anexa 2), neverificate — nu se citează. v1.1: REQ-P2-035 (verificat): NDT pe îmbinări PE după SR EN 13100 doar dacă proiectul o prevede (NTPEE art. 245); ISO 12176 (trasabilitate EF) obligatoriu doar dacă DA invocă ST 505 (REQ-P2-031). Conținutul standardelor necesită ediția licențiată.

### PAT-AMB-08
**Răspunsul AC la o clarificare este evaziv sau incomplet** · ⚖️ review juridic · încredere ridicata · vechi: CL-P05, CL-P06

- **Trigger:** răspunsul reconfirmă generic DA („DA respectă legislația”, „conform caietului de sarcini”) sau nu tratează aspectul întrebat _(caută în: raspunsuri_clarificari; detecție: judecata_umana)_
- **Documente de verificat:** Răspunsuri la clarificări; Întrebarea inițială
- **Cerințe:** `REQ-AD-002` Legea 98/2016 art. 160 alin. (2); `REQ-AD-008` 2938/2024 (BO, nr. complet anonimizat) dispozitiv + motivare (art. 160 L98, art. 21 HG 395); `REQ-AD-083` Legea 101/2016 art. 8 alin. (1) lit. a)–b); `REQ-AD-084` 182/C8/4870 pct. I (admisibilitate) — calculul termenului; `REQ-P0-025` Legea 98/2016 art. 160 alin. (3)
- **Precedente CNSC:** BO2024_2938, BO2023_2119, BO2024_1870, BO2024_3155

> **Întrebare (text extern):** Revenim la întrebarea nr. [X] din [data]. Răspunsul publicat la [data] nu precizează [aspectul Y]. Vă rugăm să comunicați [valoarea / documentul / opțiunea] solicitată.

- 🔒 **Impact intern (nu se trimite):** tehnic — Ipoteza rămâne deschisă. · cost — Depinde. · risc — Răspunsul evaziv poate fi contestat (BO2024_2938); termenul curge de la publicarea răspunsului.
- **Notă:** Corectură runda 1: CL-P06 menționa „termenul de contestare de 10 zile” — corect 10 zile peste prag / 7 zile sub prag (L101 art. 8 alin. (1); BO2023_2119, REQ-AD-083). Urmărirea termenului: PAT-TRM-03. v1.1: BO2024_1870 — un răspuns care doar ajustează cifrele nu repară o cerință nelegală. ATENȚIE BO2024_3155: răspunsurile care NU modifică DA nu prelungesc termenul de contestare; refuzul motivat („nu se acceptă”) nu mai poate fi atacat util — cerința restrictivă se contestă de la publicarea DA (PAT-TRM-03).

### PAT-AMB-09
**Factorul de evaluare „contract colectiv de muncă” — nivel, dovadă, asociere** · ⚖️ review juridic · încredere medie · vechi: —

- **Trigger:** fișa de date punctează existența unui contract colectiv de muncă (CCM) fără să precizeze nivelul acceptat (unitate / sector de negociere colectivă), documentul doveditor sau regula pentru asocieri _(caută în: fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date — algoritmul de punctaj; Formulare
- **Cerințe:** `REQ-P0-045` Legea 98/2016 art. 187 alin. (5) lit. d); `REQ-P0-046` HG 395/2016 art. 32 alin. (2), (8)–(9)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Pentru factorul de evaluare privind existența unui contract colectiv de muncă, vă rugăm să precizați: (a) dacă se punctează atât contractul colectiv încheiat la nivel de unitate, cât și cel aplicabil la nivel de sector de negociere colectivă (art. 187 alin. (5) lit. d) din Legea nr. 98/2016); (b) documentele prin care se dovedește îndeplinirea factorului; (c) în cazul unei asocieri, dacă factorul se apreciază pentru lider, pentru fiecare membru sau proporțional.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Eventuală încheiere/înregistrare a unui CCM la nivel de unitate. · risc — Mediu: punctaj pierdut dacă dovada nu corespunde formei cerute.
- **Notă:** v1.1 (nou): REQ-P0-045 e o modificare recentă a L98 (verificată, încredere medie); fără practică CNSC în baza actuală. Legătură cu obligațiile salariale din Legea 283/2024: PAT-CTC-06.

### PAT-AMB-10
**Articole de deviz asimilate sau cu alt simbol decât cel din F3 / indicatoare** · ⚖️ review juridic · încredere medie · vechi: —

- **Trigger:** F3 indică simboluri de normă (ex. TSA02.., GD01.., IZL..) pentru lucrări la care tehnologia ofertantului diferă (electrofuziune PE, manșoane termocontractabile, săpătură mecanizată), iar DA nu spune dacă se acceptă articole asimilate sau consumuri proprii _(caută în: F3, fisa_de_date, raspunsuri_clarificari; detecție: cuvant_cheie)_
- **Documente de verificat:** Formular F3 / liste de cantități; Fișa de date — propunerea financiară; Răspunsuri la clarificări
- **Cerințe:** `REQ-P2-058` Ghid P91/1-02 (Ord. MLPTL 1568/2002) pct. 2.2.3; 3.3.1.4; `REQ-P2-059` Ghid P91/1-02 (Ord. MLPTL 1568/2002) pct. 2.2.4-2.2.6; `REQ-P2-060` Ghid P91/1-02 (Ord. MLPTL 1568/2002) pct. 3.3.1.5; `REQ-P2-079` x-dev.ro — model devize instalații gaze naturale structura simbolurilor (observată); `REQ-P2-080` 696/C11/429, 448 motivare, pag. 33-34; `REQ-AD-074` 3104/2026 (BO, nr. complet anonimizat) motivare (L98 art. 210; HG 395 art. 136–137)
- **Precedente CNSC:** BO2024_696, BO2026_3104

> **Întrebare (text extern):** Pentru pozițiile [cod articol] din listele de cantități aferente [obiect], vă rugăm să precizați dacă se acceptă, în propunerea financiară, articole de deviz asimilate sau consumuri de resurse proprii ale ofertantului (cu alt simbol decât cel indicat), cu păstrarea integrală a cantităților, a unităților de măsură și a descrierii lucrărilor din listele publicate.

- 🔒 **Impact intern (nu se trimite):** tehnic — Permite ofertarea tehnologiei reale (EF, manșoane), pentru care indicatoarele 1981 nu au normă (REQ-P2-060). · cost — Diferențe de consumuri față de norma indicată. · risc — Mediu: cantitățile din F3 rămân obligatorii (REQ-AD-074, BO2026_3104); simbolurile, nu.
- **Notă:** v1.1 (nou): Un singur precedent (BO2024_696, motivare p. 33–34, cerință verificată REQ-P2-080; decizia e în registru_surse, nu în cnsc_practica.json). Contrapondere: BO2026_3104 — reducerea cantităților prin „consumuri proprii” nu e permisă. P91 pct. 3.3.1.5 (REQ-P2-060) confirmă libertatea consumurilor la lucrări fără normă.

### PAT-AMB-11
**Propunerea tehnică: proceduri „pentru toate categoriile de lucrări”, metodologie, interdicția copierii CS**  · încredere ridicata · vechi: —

- **Trigger:** fișa de date cere proceduri tehnice de execuție / metodologie „pentru toate categoriile de lucrări” sau interzice preluarea caietului de sarcini, fără listă de categorii și fără nivel minim de detaliu _(caută în: fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date — propunerea tehnică; Caiet de sarcini; Liste de cantități (categorii de lucrări)
- **Cerințe:** `REQ-P0-048` HG 395/2016 art. 133 alin. (2)–(3); `REQ-P0-049` HG 395/2016 art. 134 alin. (1), (3)–(4); `REQ-P0-055` HG 395/2016 art. 137 alin. (3) lit. a), c), d), e), g)
- **Precedente CNSC:** BO2025_2118, BO2024_632, BO2025_1775, BO2025_3638, BO2022_2053

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită în propunerea tehnică „[citat]”. Vă rugăm să precizați lista categoriilor de lucrări pentru care se solicită proceduri tehnice de execuție (de exemplu, dacă sunt incluse [SRM / racorduri / foraj orizontal dirijat / subtraversări / refaceri]), nivelul minim de detaliere și dacă se acceptă proceduri ale sistemului de management al calității ale ofertantului, adaptate obiectivului.

- 🔒 **Impact intern (nu se trimite):** tehnic — Volum de documentație tehnică de pregătit înainte de depunere. · cost — Ore de redactare; eventual proceduri noi (ex. PN40, foraj). · risc — Ridicat: lipsa unei proceduri cerute expres nu se acoperă la clarificări (BO2025_2118, BO2024_632).
- **Notă:** v1.1 (nou): Cinci decizii noi concordante: conținutul tehnic cerut expres nu se completează la clarificări (BO2025_2118, BO2024_632); formulele generice interzise de DA fac oferta neconformă (BO2025_3638); copierea CS interzisă → neconform chiar și la câștigător (BO2025_1775). Nuanță: detaliile de formă nu justifică respingerea și metoda trebuie aplicată uniform (BO2022_2053).

## Cantități

### PAT-CNT-01
**Extinderea controlului nedistructiv la sudurile din oțel și includerea lui în deviz**  · încredere ridicata · vechi: CL-T06, CL-C03

- **Trigger:** CS spune „suduri controlate nedistructiv conform normativelor” fără procent/metodă, sau F3 nu are articol pentru CND și buletine de laborator _(caută în: caiet_sarcini, F3; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Liste de cantități; Planșe (poziția sudurilor de poziție)
- **Cerințe:** `REQ-TG-068` Ordin ANRE 89/2018 (NTPEE-2018) art. 238 alin. (3)-(4); `REQ-TG-069` Ordin ANRE 89/2018 (NTPEE-2018) art. 238 alin. (5); `REQ-TG-070` Ordin ANRE 89/2018 (NTPEE-2018) art. 224 alin. (2)-(3); `REQ-TG-096` Ordin ANRE 89/2018 (NTPEE-2018) art. 286 lit. d); `REQ-TG-026` Ordin ANRE 17/2026 anexa 3, pct. 6; `REQ-P2-093` Ordin ANRE 89/2018 (NTPEE-2018) art. 198; art. 235 alin. (2)-(4); art. 236-238; `REQ-P2-018` Ordin ANRE 89/2018 (NTPEE-2018) art. 238 alin. (1)-(3); `REQ-P2-020` SR EN ISO 17635:2025 — pentru producție; PT CR 9 anexa 16 / PT CR 7 pentru examene
- **Precedente CNSC:** —

> **Întrebare (text extern):** Caietul de sarcini ([cap. …]) prevede „[citat]”, fără a preciza extinderea controlului nedistructiv. NTPEE, art. 238 alin. (4)–(5), prevede control nedistructiv obligatoriu la conductele subterane din oțel și pentru toate sudurile de poziție. Vă rugăm să precizați procentul de suduri examinate (altele decât sudurile de poziție), metoda de examinare și articolul din listele de cantități în care se cuprind examinările și buletinele de laborator.

- 🔒 **Impact intern (nu se trimite):** tehnic — Volumul CND determină laboratorul și durata. · cost — Semnificativ (RT/UT pe sudură). · risc — Scăzut.
- **Notă:** v1.1: REQ-P2-093 confirmă NDT obligatoriu la conducte subterane și 100 % la sudurile de poziție; corelarea nivel ISO 5817 ↔ acceptare RT/UT (17635) doar dacă CS o cere (REQ-P2-020).

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
- **Cerințe:** `REQ-SC-064` Ordin MTI 1668/2023 Anexă pct. 3.4.4 alin. (1)–(2); `REQ-SC-068` Ordin MTI 1668/2023 Anexă pct. 3.4.7 alin. (1)–(2); `REQ-SC-084` Ordin ANRE 89/2018 (NTPEE-2018) art. 178 alin. (2)–(4); `REQ-SC-086` Ordin ANRE 89/2018 (NTPEE-2018) art. 30, tabelul nr. 1 poz. 10; `REQ-SC-082` Ordin ANRE 89/2018 (NTPEE-2018) art. 85 alin. (1)–(2); `REQ-SC-087` Legea 107/1996 art. 48 alin. (1) lit. e); `REQ-SC-088` Legea 107/1996 art. 50 alin. (1); `REQ-SC-089` Legea 107/1996 art. 49 alin. (3^1); `REQ-SC-091` Ordin MAP 828/2019 Anexa 1 art. 31; `REQ-SC-093` Ordin MAP 828/2019 Anexa 2 art. 23 lit. d), h), j); `REQ-SC-080` OUG 12/1998 art. 29 alin. (2), (4), (5); `REQ-SC-081` HG 525/1996 art. 20 alin. (4) lit. d); alin. (3)
- **Precedente CNSC:** BO2021_159, BO2020_2191, BO2024_1529

> **Întrebare (text extern):** Pentru [subtraversarea DN … / căii ferate … / traversarea cursului de apă …] din [planșa …], vă rugăm să precizați metoda de execuție, lungimea și diametrul tubului de protecție, să ne transmiteți avizele obținute ([administrator drum / infrastructură feroviară / gospodărire a apelor]) și să precizați dacă condițiile impuse prin acestea sunt cuprinse în listele de cantități.

- 🔒 **Impact intern (nu se trimite):** tehnic — Foraj orizontal obligatoriu sub DN, gropi în afara zonei de siguranță. Avizul impune adâncime sub talveg și notificarea începerii execuției. · cost — Foraj, tub OL, cămine/aerisiri. Foraj/subtraversare, protecții de mal. · risc — Scăzut.
- **Notă:** Contopit cu: Traversare de curs de apă — avizul de gospodărire a apelor și condițiile lui. Cerințele SC-087…093 au încredere medie (text consolidat neconfirmat). v1.1: pentru subtraversările CF, autorizarea executantului (AFER) e tratată separat în PAT-CAL-14 (BO2020_2191 vs BO2024_1529).

### PAT-CNT-04
**Deșeuri din construcții — transport, eliminare/valorificare, distanță**  · încredere ridicata · vechi: —

- **Trigger:** F3 are desfaceri (asfalt, beton, pământ excedentar) fără articol de transport/eliminare sau fără distanța până la operatorul autorizat _(caută în: F3, caiet_sarcini; detecție: camp_lipsa)_
- **Documente de verificat:** Liste de cantități; Caiet de sarcini; Autorizație de construire (plan gestionare deșeuri)
- **Cerințe:** `REQ-SC-095` OUG 92/2021 art. 17 alin. (4); `REQ-SC-096` OUG 92/2021 art. 17 alin. (7); `REQ-SC-097` OUG 92/2021 art. 23 alin. (1); `REQ-SC-099` OUG 92/2021 art. 48 alin. (1), (5)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați dacă transportul și predarea către operatori autorizați a deșeurilor din construcții (inclusiv materialele din desfaceri și pământul excedentar) sunt în sarcina executantului, distanța de transport avută în vedere și articolele din listele de cantități în care se cuprind.

- 🔒 **Impact intern (nu se trimite):** tehnic — Evidență lunară și raportare ANPM. · cost — Transport + taxe de depozitare. · risc — Scăzut.

### PAT-CNT-05
**Refacerea îmbrăcăminții: lățimea și structura de refacere față de lungimea șanțului**  · încredere ridicata · vechi: —

- **Trigger:** suprafața de refacere din F3 (mp) ≈ lungimea șanțului × lățimea șanțului, fără supralărgirea NTPEE art. 195 (5 cm/latură la asfalt pe beton, 15 cm la pavaj) sau fără structura rutieră; ori administratorul drumului cere refacerea pe toată lățimea benzii _(caută în: F3, caiet_sarcini, planse; detecție: calcul)_
- **Documente de verificat:** Liste de cantități; Planșe / profile transversale; Aviz/acord administrator drum
- **Cerințe:** `REQ-P2-101` Ordin MTI 1668/2023 Anexă pct. 3.4.1 alin. (5); pct. 3.4.5 alin. (2); `REQ-P2-102` Ordin ANRE 89/2018 (NTPEE-2018) art. 195; `REQ-P2-103` Indicator D 1981 cap. DG (desfaceri), DA (fundații), DB (îmbrăcăminți bituminoase), DI (reparații); `REQ-P2-077` x-dev.ro — model devize instalații gaze naturale deviz «Branșament gaze naturale», art. 15-16; `REQ-SC-062` Ordin MTI 1668/2023 Anexă pct. 3.4.1 alin. (7); pct. 3.4.5 alin. (4)–(5)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Lista de cantități pentru [obiect] prevede [x] mp de refacere a îmbrăcăminții [asfaltice / din pavele] pentru [y] m de șanț. Vă rugăm să precizați lățimea de refacere avută în vedere (lățimea șanțului plus lățimea de desfacere de pe fiecare latură prevăzută de NTPEE, art. 195, sau lățimea impusă de administratorul drumului), structura rutieră care trebuie refăcută și articolele din listele de cantități în care se cuprind.

- 🔒 **Impact intern (nu se trimite):** tehnic — Subcontractor de drumuri; condițiile administratorului. · cost — Diferențe de mp și de structură — una din cele mai mari surse de pierdere la refaceri. · risc — Scăzut.
- **Notă:** v1.1 (nou): NTPEE art. 195 (REQ-P2-102) și Ord. MT 1668/2023 (REQ-P2-101) verificate; consumurile D 1981 sunt doar reper (REQ-P2-103). Garanția refacerii: PAT-GAR-04.

### PAT-CNT-06
**Săpătură: pondere manual/mecanizat, categoria de teren și sprijiniri nespecificate**  · încredere medie · vechi: —

- **Trigger:** F3 are săpătură manuală și/sau mecanizată fără categoria de teren, fără ponderea manual/mecanic (lângă rețele existente, intersecții, branșamente) sau fără articol de sprijiniri la adâncimi la care sunt necesare _(caută în: F3, caiet_sarcini, planse; detecție: camp_lipsa)_
- **Documente de verificat:** Liste de cantități; Profile longitudinale; Studiu geotehnic; Caiet de sarcini
- **Cerințe:** `REQ-P2-081` Ordin ANRE 89/2018 (NTPEE-2018) art. 75 alin. (1)-(2); art. 194 alin. (2)-(3); art. 195; `REQ-P2-085` Ordin ANRE 89/2018 (NTPEE-2018) art. 194 alin. (1)-(2), (5); art. 196 alin. (1)-(3); `REQ-P2-062` Indicator Ts 1981 Sumarul capitolelor pe volume; `REQ-P2-063` Indicator Ts 1981 TsA generalități pct. 4.1; TsC generalități pct. 4.1; `REQ-P2-064` Indicator Ts 1981 Instrucțiuni generale pct. 2.1, 2.3; `REQ-SC-016` HG 300/2006 anexa nr. 4 partea B pct. 10.1 lit. a)–d)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Pentru săpăturile aferente [obiect], vă rugăm să precizați categoria de teren avută în vedere, ponderea săpăturii manuale față de cea mecanizată, dacă sunt necesare sprijiniri ale pereților tranșeei și pe ce lungimi, precum și articolele din listele de cantități în care se cuprind.

- 🔒 **Impact intern (nu se trimite):** tehnic — Productivitate și utilaje; măsuri SSM la excavații (HG 300/2006, REQ-SC-016). · cost — Manual vs mecanic: diferență mare de manoperă pe mc (TsA la mc vs TsC la 100 mc — REQ-P2-063). · risc — Scăzut.
- **Notă:** v1.1 (nou): Dimensiunile minime ale șanțului sunt obligatorii (NTPEE, REQ-P2-081/085); ponderea manual/mecanic și sprijinirile rămân estimări interne (REQ-P2-084, neverificat, nelistat). Pragul „sprijinire peste 1,5 m” (REQ-SC-020) e neverificat — nu se citează.

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
- **Cerințe:** `REQ-TG-055` Ordin ANRE 89/2018 (NTPEE-2018) art. 20 alin. (2); `REQ-TG-056` Ordin ANRE 89/2018 (NTPEE-2018) art. 177 alin. (1)-(2); `REQ-TG-053` Ordin ANRE 89/2018 (NTPEE-2018) art. 19 alin. (1); `REQ-P2-032` SR EN 1555-1…-4:2025 NTPEE anexa 2 poz. 52-55; ST-TGPHD (2023)
- **Precedente CNSC:** —

> **Întrebare (text extern):** În [planșa / lista de cantități poz. X] conducta este indicată din [PE 80, SDR …], iar regimul de presiune din memoriu este [… bar]. NTPEE, art. 20 alin. (2), admite PE 80 numai până la 4 bar. Vă rugăm să precizați materialul și SDR-ul care trebuie ofertate.

- 🔒 **Impact intern (nu se trimite):** tehnic — Material neconform la recepție. · cost — Diferență de preț PE 80/PE 100 și SDR. · risc — Scăzut dacă se clarifică; ridicat pe execuție.
- **Notă:** v1.1: REQ-P2-032 — trei ediții SR EN 1555 coexistă în documente (2011/2013 NTPEE, 2021 ST-TGPHD, ediția curentă); de cerut ediția dacă DA invocă standardul.

### PAT-STD-03
**Adâncime de pozare sub 0,9 m sau distanțe față de alte rețele sub minimele NTPEE / ANRE electric**  · încredere ridicata · vechi: CL-T03

- **Trigger:** profilul longitudinal indică acoperire < 0,9 m (≠ capăt branșament) sau distanțe față de canalizare/apă/cabluri sub tabelul 1 NTPEE / anexa 4b Ord. 239/2019, fără soluție de protecție _(caută în: planse, caiet_sarcini, F3; detecție: calcul)_
- **Documente de verificat:** Profile longitudinale; Planșe de situație; Liste de cantități (tuburi de protecție); Avize deținători rețele
- **Cerințe:** `REQ-TG-059` Ordin ANRE 89/2018 (NTPEE-2018) art. 75 alin. (1)-(2), (4); `REQ-SC-114` Ordin ANRE 89/2018 (NTPEE-2018) art. 29; art. 30, tabelul nr. 1 poz. 4–6; `REQ-SC-115` Ordin ANRE 89/2018 (NTPEE-2018) art. 82 alin. (1)–(3); `REQ-SC-119` Ordin ANRE 239/2019 anexa nr. 4b; `REQ-SC-120` Ordin ANRE 239/2019 art. 33 alin. (2)–(4); `REQ-P2-081` Ordin ANRE 89/2018 (NTPEE-2018) art. 75 alin. (1)-(2); art. 194 alin. (2)-(3); art. 195
- **Precedente CNSC:** —

> **Întrebare (text extern):** În [planșa X], conducta este pozată la [0,6 m] adâncime / la [0,4 m] de [rețeaua …]. NTPEE prevede adâncimea minimă de 0,9 m (art. 75), cu reducere numai prin soluția proiectantului și acordul operatorului, respectiv distanțele minime din Tabelul nr. 1 (art. 30). Vă rugăm să precizați soluția de protecție prevăzută, dacă există acordul operatorului de distribuție și dacă elementele de protecție sunt cuprinse în listele de cantități.

- 🔒 **Impact intern (nu se trimite):** tehnic — Neconformitate la recepția OSD. · cost — Tuburi de protecție, săpătură suplimentară. · risc — Scăzut.
- **Notă:** Corectură runda 1: trimiterile la NTPEE art. 35 și 35^1 (evaluare de risc, răsuflători) nu au cerință verificată — scoase din întrebare. v1.1: REQ-P2-081 (NTPEE art. 75, verificat) confirmă adâncimea minimă 0,9 m (0,5 m la capătul branșamentului).

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
**„Clasa de calitate II” a sudurilor fără nivel de acceptare și criterii CND**  · încredere ridicata · vechi: CL-T07

- **Trigger:** CS/proiectul indică „clasa II” fără nivel de calitate și criterii de acceptare pentru examinarea radiografică/ultrasonică _(caută în: caiet_sarcini; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Memoriu tehnic
- **Cerințe:** `REQ-TG-067` Ordin ANRE 89/2018 (NTPEE-2018) art. 238 alin. (1)-(2); `REQ-TG-054` Ordin ANRE 89/2018 (NTPEE-2018) art. 6 alin. (2) + titlul anexei nr. 2; `REQ-TG-103` SR EN 12732+A1:2014 NTPEE art. 235 alin. (4) + anexa 2 poz. 37; `REQ-P2-018` Ordin ANRE 89/2018 (NTPEE-2018) art. 238 alin. (1)-(3); `REQ-P2-019` SR EN ISO 5817:2023 — pentru producție; PT CR 9-2025 anexa 16 pentru examen; `REQ-P2-020` SR EN ISO 17635:2025 — pentru producție; PT CR 9 anexa 16 / PT CR 7 pentru examene; `REQ-P2-022` SR EN ISO 17636-1:2022 / SR EN ISO 17636-2:2023 — pentru producție; PT CR 9 anexa 16; `REQ-P2-023` SR EN ISO 10675-1:2022 — pentru producție; PT CR 9 anexa 16
- **Precedente CNSC:** —

> **Întrebare (text extern):** NTPEE, art. 238 alin. (1)–(2), prevede clasa de calitate II pentru îmbinările sudate din oțel, cu indicarea clasei în proiect. Vă rugăm să precizați nivelul de calitate și criteriile de acceptare pentru examinarea nedistructivă care se vor aplica la recepție (standardul și ediția).

- 🔒 **Impact intern (nu se trimite):** tehnic — Criteriu de acceptare = rata de respingere a sudurilor. · cost — Refaceri. · risc — Scăzut.
- **Notă:** Edițiile SR EN ISO 5817:2023 / 17635:2025 din runda 1 nu au cerință verificată (standard licențiat; anexa 2 NTPEE e orientativă) — nu se citează în întrebare. v1.1: confidence medie→ridicata — REQ-P2-018 (verificat) confirmă golul: NTPEE art. 238 cere clasa II și NDT prin „metode legal aprobate”, fără trimitere la ISO 5817 sau la niveluri de acceptare; ISO 5817/17635/10675-1 se aplică doar dacă proiectul/CS le fixează (REQ-P2-019/020/023). Limitele numerice cer standard licențiat.

### PAT-STD-06
**Proceduri de sudare (WPQR): nivel cerut și acceptarea celor existente aprobate ISCIR**  · încredere ridicata · vechi: CL-T08

- **Trigger:** CS cere WPQR „nivel 1/2” sau proceduri noi fără a spune dacă se acceptă WPQR-urile existente aprobate _(caută în: caiet_sarcini, fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Fișa de date (dacă e cerință de calificare)
- **Cerințe:** `REQ-TG-065` Ordin ANRE 89/2018 (NTPEE-2018) art. 236 alin. (3); `REQ-TG-138` PT CR 7-2025 (Ordin MEDAT 1172/2026) PT CR 7-2025 — domeniu (citit în runda 1); `REQ-TG-124` PT CR 9-2025 art. 3-4; `REQ-P2-013` SR EN ISO 15614-1:2017 (+A1:2019) PT CR 7-2025 (aprobarea procedurilor de sudare oțel; locator exact în PT CR 7 de reconfirmat) + NTPEE art. 236 alin. (3); `REQ-P2-007` SR EN 12732+A1:2014 NTPEE art. 235 alin. (4) + anexa 2 poz. 37; `REQ-P2-008` SR EN ISO 15609-1:2020 NTPEE art. 228 alin. (3), art. 235 alin. (4) + anexa 2 poz. 30; `REQ-P2-009` SR EN ISO 15607:2004 (ediția din NTPEE) NTPEE art. 235 alin. (4) + anexa 2 poz. 29
- **Precedente CNSC:** —

> **Întrebare (text extern):** NTPEE, art. 236 alin. (3), cere procedee de sudare certificate. Caietul de sarcini ([cap. …]) prevede „[citat]”. Vă rugăm să precizați dacă se acceptă procedurile de sudare existente, aprobate, care acoperă materialul [L245/L290] și domeniul de grosimi [x–y mm], sau dacă sunt necesare calificări noi.

- 🔒 **Impact intern (nu se trimite):** tehnic — Calificare nouă = timp + încercări. · cost — Cost calificare procedură. · risc — Scăzut (mediu dacă e cerință de calificare).
- **Notă:** PT CR 7-2025 (REQ-TG-138) are încredere medie; nivelurile 1/2 din SR EN ISO 15614-1 necesită standard licențiat. v1.1: confidence medie→ridicata — REQ-P2-013 (verificat): procedeele „certificate” din NTPEE se realizează în RO prin WPQR aprobat ISCIR după PT CR 7-2025, pe încercări SR EN ISO 15614-1; anexa 2 NTPEE încorporează edițiile 15609-1:2005 și 15607:2004 (REQ-P2-008/009), diferite de edițiile curente.

### PAT-STD-07
**Clasa izolației de fabrică, sistemul de izolare a îmbinărilor și pregătirea suprafeței**  · încredere ridicata · vechi: CL-T09

- **Trigger:** CS folosește terminologie veche („izolație foarte întărită”, STAS) sau nu indică clasa izolației/ sistemul pentru îmbinări (cazul „foarte întărită” + țeavă preizolată → PAT-STD-12) _(caută în: caiet_sarcini, F3; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Liste de cantități; Specificația operatorului (dacă e invocată)
- **Cerințe:** `REQ-TG-081` Ordin ANRE 89/2018 (NTPEE-2018) art. 262 alin. (1)-(4); `REQ-TG-118` Distrigaz Sud Rețele ST-TOLNP (2023) ST-TOLNP — țeavă oțel și izolație; `REQ-TG-054` Ordin ANRE 89/2018 (NTPEE-2018) art. 6 alin. (2) + titlul anexei nr. 2; `REQ-P2-039` Ordin ANRE 89/2018 (NTPEE-2018) art. 260 alin. (1); art. 262 alin. (1)-(4); `REQ-P2-042` SR EN ISO 21809-1:2019 (ISO 21809-1:2018) Distrigaz ST-TOLNP (2023) — doar când DA o invocă; `REQ-P2-043` EN ISO 21809-3:2016 + A1:2020 —; `REQ-P2-044` SR EN 12068:2002 —; `REQ-P2-046` SR EN ISO 8501-1:2007 Distrigaz ST-TOLNP (Sa 2½ la izolația de fabrică) — doar când DA o invocă; `REQ-P2-097` Ordin ANRE 89/2018 (NTPEE-2018) art. 254 lit. b)-c); art. 259; art. 262 alin. (3)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Caietul de sarcini ([cap. …]) descrie izolația conductei de oțel prin „[citat]”. NTPEE, art. 262, prevede izolarea la producător și, pe șantier, doar a îmbinărilor, reparațiilor și ieșirilor din sol. Vă rugăm să precizați clasa izolației de fabrică, sistemul și clasa de izolare a îmbinărilor (bandă / manșon termocontractabil) și gradul de pregătire a suprafeței cerut pe șantier.

- 🔒 **Impact intern (nu se trimite):** tehnic — Manșoane vs bandă; sablare pe șantier. · cost — Diferențe semnificative pe îmbinare. · risc — Scăzut.
- **Notă:** SR EN ISO 21809-1/-3 figurează „NECONFIRMAT” (ofertare_normative id 40); clasa B2/B3 apare doar în ST-TOLNP Distrigaz (REQ-TG-118, obligatorie doar dacă DA o invocă). v1.1: confidence medie→ridicata — NTPEE art. 260 nu impune grad de pregătire (REQ-P2-039); Sa 2½ și clasa B2/B3 vin doar din ST-TOLNP când DA o invocă (REQ-P2-042/046); sistemele de îmbinare (21809-3, 12068) nu sunt în anexa 2 (REQ-P2-043/044). Contradicția „foarte întărită” (bitum, art. 259 alin. (3)) vs 3LPE a fost separată în PAT-STD-12.

### PAT-STD-08
**Trimiteri la acte normative abrogate sau la ediții de standarde înlocuite** · ⚖️ review juridic · încredere ridicata · vechi: CL-A04, CL-A03

- **Trigger:** DA citează Ordinul MDLPL 863/2008, NTPEE-2008 (Ord. ANRE 5/2009), I 6, articole din Legea 10/1995 sau Legea 50/1991 etc. / SAU: CS citează o ediție de standard înlocuită (ex. listă din runda 1: SR EN 1555, SR EN ISO 17635, SR EN 12954, SR EN 13067, SR EN ISO 15589-1) _(caută în: caiet_sarcini, fisa_de_date, contract; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Fișa de date; Model de contract; Catalog ASRO (ediții în vigoare)
- **Cerințe:** `REQ-AD-126` HG 907/2016 art. 18 alin. (2) lit. b); `REQ-TG-141` Ordin ANRE 5/2009 (NTPEE-2008) Ord. ANRE 89/2018 art. 3; `REQ-TG-140` Normativ I 6-98 —; `REQ-AD-150` Legea 10/1995 (republicata MO 765/30.09.2016) art. 10, art. 41 (rămase în vigoare) — abrogare confirmată: Legea 169/2026 art. 576 alin. (3) lit. c) (MO 661/2026); `REQ-TG-054` Ordin ANRE 89/2018 (NTPEE-2018) art. 6 alin. (2) + titlul anexei nr. 2; `REQ-TG-062` Ordin ANRE 89/2018 (NTPEE-2018) art. 228 alin. (3) și art. 235 alin. (4); `REQ-P1-074` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 576 alin. (3) lit. c); `REQ-P1-098` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 576 alin. (3) lit. b); art. 583 alin. (3); `REQ-P1-072` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 577 alin. (5); art. 583 alin. (1)–(2); `REQ-P1-075` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 577 alin. (6); `REQ-P0-008` Legea 101/2016 cap. II (art. 6–7) — abrogat; `REQ-P2-001` Ordin ANRE 89/2018 (NTPEE-2018) art. 228 alin. (3); art. 235 alin. (4); anexa 2 «Lista standardelor»; `REQ-P2-002` Ordin ANRE 89/2018 (NTPEE-2018) art. 6 alin. (2) + titlul anexei 2
- **Precedente CNSC:** —

> **Întrebare (text extern):** Documentația ([document, pag. …]) face trimitere la [actul / standardul, ediția …], [abrogat / înlocuit de …]. Vă rugăm să precizați actul normativ în vigoare la care se raportează cerința respectivă (de exemplu, HG nr. 907/2016 în locul Ordinului MDLPL nr. 863/2008, respectiv Normele tehnice aprobate prin Ordinul ANRE nr. 89/2018 în locul NTPEE-2008) și dacă se acceptă produse și proceduri conforme cu ediția standardului în vigoare la data depunerii ofertei.

- 🔒 **Impact intern (nu se trimite):** tehnic — Cerințe tehnice depășite (ex. I 6). Produse certificate pe ediția nouă. · cost — Mic. · risc — Scăzut.
- **Notă:** temei de confirmat pentru Legea 10/1995 / Legea 50/1991 vs Legea 169/2026 (REQ-AD-150 și CATUC neverificate; numerotarea CATUC diferă între surse) și pentru I 6 (REQ-TG-140, surse secundare). Acestea nu se citează în întrebare. Contopit cu: Ediții de standarde depășite în caietul de sarcini. Edițiile din runda 1 trebuie reconfirmate în catalogul ASRO. Anexa 2 NTPEE e orientativă (REQ-TG-054): un standard listat acolo nu e obligatoriu prin lege — obligativitatea vine din DA. v1.1: confidence medie→ridicata — temeiul pentru Legea 10/1995 și Legea 50/1991 e acum verificat: L169/2026 art. 576 alin. (3) lit. b)–c) (abrogări de la 25.08.2026) și art. 583 alin. (3) (trimiterile din acte normative se citesc la L169; cele din documente contractuale — prin clarificare), REQ-P1-074/098. HG 925/1995 și HG 273/1994 rămân în vigoare (REQ-P1-072/075). Trimiterile NTPEE la anexa 2 sunt datate (REQ-P2-001/002). Revizuirea juridică rămâne pentru I 6 (REQ-TG-140 neverificat) și pentru documentele contractuale.

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
**Specificațiile tehnice ale operatorului de distribuție și documentele de inspecție pentru materiale (3.1 / 3.2)**  · încredere ridicata · vechi: CL-T11

- **Trigger:** CS nu spune dacă materialele/echipamentele trebuie să respecte ST ale OSD (ex. ST 505, ST-TGPHD, ST-TOLNP) sau le invocă fără ediție / SAU: CS cere „certificat de calitate” fără tip sau cere 3.2 fără a spune cine numește inspectorul și cine plătește _(caută în: caiet_sarcini; detecție: judecata_umana)_
- **Documente de verificat:** Caiet de sarcini; Aviz OSD; Specificația operatorului
- **Cerințe:** `REQ-TG-115` Delgaz Grid ST 505 (A5, 01.2023) ST 505 — cerințe aparat EF; `REQ-TG-116` Delgaz Grid ST 505 (A5, 01.2023) ST 505 — documente; `REQ-TG-117` Distrigaz Sud Rețele ST-TGPHD (2023) ST-TGPHD — documente și vârstă material; `REQ-TG-118` Distrigaz Sud Rețele ST-TOLNP (2023) ST-TOLNP — țeavă oțel și izolație; `REQ-TG-095` Ordin ANRE 89/2018 (NTPEE-2018) art. 286 lit. c); `REQ-TG-057` Ordin ANRE 89/2018 (NTPEE-2018) art. 173 alin. (1) și (3); `REQ-P2-056` SR EN 10204:2005 (EN 10204:2004) Distrigaz ST-TOLNP / ST-TGPHD — doar când DA le invocă; `REQ-P2-037` Distrigaz Sud Rețele ST-TGPHD (2023) ST-TGPHD — documente și vârstă material; `REQ-P2-052` SR EN ISO 3183:2020 (ISO 3183:2019) Distrigaz ST-TOLNP (L245/B PSL1) — doar când DA o invocă; `REQ-P2-031` ISO 12176-2:2025 / -3 / -4 / -5 Delgaz ST 505 (A5/2023) — doar când DA o invocă
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați dacă materialele și echipamentele trebuie să respecte specificațiile tehnice ale operatorului de distribuție [denumire] și, în caz afirmativ, specificațiile și edițiile aplicabile, precum și tipul documentului de inspecție solicitat pentru [țeavă oțel / țeavă PE / fitinguri / robinete / izolație]. Dacă se solicită certificat de tip 3.2, vă rugăm să precizați cine desemnează reprezentantul cumpărătorului și cine suportă costul inspecției.

- 🔒 **Impact intern (nu se trimite):** tehnic — Aparate EF cu cod de bare/memorie, vârstă material la livrare. Termene de livrare mai mari la 3.2. · cost — Furnizori agreați OSD. Inspecție terță. · risc — Scăzut.
- **Notă:** Specificațiile OSD sunt OBLIGATORIE_DOC_ACHIZITIE doar când DA le invocă; altfel bună practică. Contopit cu: Tipul documentului de inspecție pentru materiale (3.1 / 3.2). SR EN 10204 — clauze necitite (standard licențiat); certificatul 3.1 apare în specificațiile Distrigaz (REQ-TG-117/118). v1.1: confidence medie→ridicata — REQ-P2-056 (verificat): tipul documentului de inspecție se fixează prin specificație/CS, 3.2 implică inspector al cumpărătorului; ST-TGPHD cere 2.2 + 3.1 și vârstă ≤ 3 luni la livrare (REQ-P2-037).

### PAT-STD-12
**Izolație „foarte întărită” (NTPEE = sistem pe bază de bitum) vs țeavă preizolată 3LPE în F3/planșe**  · încredere ridicata · vechi: —

- **Trigger:** CS cere „izolație foarte întărită” (sau „întărită”) pentru conducta de oțel, iar F3/planșele prevăd țeavă preizolată în fabrică (3LPE / polietilenă) sau invers _(caută în: caiet_sarcini, F3, planse; detecție: comparatie_documente)_
- **Documente de verificat:** Caiet de sarcini; Liste de cantități; Planșe / memoriu; Specificația OSD (dacă e invocată)
- **Cerințe:** `REQ-P2-038` Ordin ANRE 89/2018 (NTPEE-2018) art. 259 alin. (1) și (3); `REQ-P2-041` STAS 2484-85; SR 8050 NTPEE anexa 2 poz. 50 și 87; `REQ-P2-042` SR EN ISO 21809-1:2019 (ISO 21809-1:2018) Distrigaz ST-TOLNP (2023) — doar când DA o invocă; `REQ-P2-073` Indicator Iz 1981 Sumarul capitolelor; `REQ-P2-074` Indicator Iz 1981 Cap. IZL, generalități pct. 1.1, 1.3, 3.1.1; `REQ-P2-098` Indicator Iz 1981 cap. IZL (art. IZL01-IZL07); IZA01 (sablare); `REQ-TG-081` Ordin ANRE 89/2018 (NTPEE-2018) art. 262 alin. (1)-(4); `REQ-TG-118` Distrigaz Sud Rețele ST-TOLNP (2023) ST-TOLNP — țeavă oțel și izolație
- **Precedente CNSC:** —

> **Întrebare (text extern):** Caietul de sarcini ([cap. …]) prevede pentru conducta de oțel „izolație foarte întărită”, iar [lista de cantități, poz. … / planșa …] prevede [țeavă preizolată în fabrică, tip …]. NTPEE, art. 259 alin. (3), definește izolația foarte întărită ca sistem pe bază de bitum (grund, trei straturi de împâslitură impregnată cu bitum și folie din PVC). Vă rugăm să precizați sistemul de izolație care trebuie ofertat pentru țeavă și pentru îmbinările executate pe șantier, precum și articolele din listele de cantități în care se cuprinde.

- 🔒 **Impact intern (nu se trimite):** tehnic — Tehnologii complet diferite (bitum aplicat vs țeavă preizolată + manșoane). · cost — Diferență mare de preț pe metru și pe îmbinare; normele Iz (IZL) acoperă doar bitum/PVC (REQ-P2-098). · risc — Mediu: ofertare pe sistemul greșit → neconformitate tehnică.
- **Notă:** v1.1 (nou): Separat din PAT-STD-07. REQ-P2-038 (NTPEE art. 259 alin. (1) și (3)) verificat, încredere ridicată; 3LPE clasa B2/B3 vine doar din ST-TOLNP când DA o invocă (REQ-TG-118, REQ-P2-042).

## Calificare

### PAT-CAL-01
**Autorizare ANRE: Ordinul 132/2021 citat, tip neprecizat, cerință lipsă sau tip necorelat cu regimul de presiune** · ⚖️ review juridic · încredere ridicata · vechi: CL-A02, CL-B17

- **Trigger:** FD cere 'autorizație ANRE … conform Ordin 132/2021', nu indică tipul (EDSB/PDSB/…), sau obiectul include gaze și FD nu cere autorizare / SAU: FD cere EDSB/PDSB, dar documentația conține obiective > 6 bar (ET/PT) sau > 10 bar (NT transport); sau invers _(caută în: fisa_de_date, caiet_sarcini, planse; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date — cerințe de calificare; DUAE; Caiet de sarcini (obiect); Fișa de date; Memoriu tehnic (regim de presiune); Planșe
- **Cerințe:** `REQ-TG-008` Ordin ANRE 17/2026 art. 1 alin. (3)-(4), tabel; `REQ-TG-020` Ordin ANRE 17/2026 art. 39 alin. (1)-(2); `REQ-TG-014` Ordin ANRE 17/2026 art. 31 alin. (1); `REQ-TG-052` Ordin ANRE 89/2018 (NTPEE-2018) art. 7 alin. (1); `REQ-AD-029` Legea 98/2016 art. 173 alin. (1); `REQ-TG-001` Legea 123/2012 — Titlul II Gaze naturale art. 121 alin. (1); `REQ-TG-028` Ordin ANRE 17/2026 art. 1 alin. (4) tabel; art. 14 (EDSB); `REQ-TG-041` Ordin ANRE 17/2026 art. 1 alin. (4) tabel; art. 13; `REQ-TG-053` Ordin ANRE 89/2018 (NTPEE-2018) art. 19 alin. (1); `REQ-TG-009` Ordin ANRE 17/2026 art. 1 alin. (4) (tabel) — absența pragurilor de diametru; `REQ-TG-143` Ordin ANRE 118/2013 NTPEE art. 20 alin. (1), art. 21 alin. (1); `REQ-P0-096` Ordin ANRE 17/2026 art. 39 alin. (1)–(2); ordin art. 2–3; Legea 24/2000 art. 11 alin. (1), art. 12 alin. (3); `REQ-P0-066` Ordin ANRE 7/2022 art. 5 alin. (3)–(4)
- **Precedente CNSC:** BO2022_1615, BO2022_2403, BO2024_2636, BO2023_416, BO2026_1360, BO2024_3155

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită „[citat cerință ANRE]”. Având în vedere că Regulamentul aprobat prin Ordinul ANRE nr. 17/2026 a înlocuit Ordinul ANRE nr. 132/2021, iar autorizațiile emise anterior rămân valabile (art. 39), vă rugăm să precizați: (a) tipurile de autorizație ANRE solicitate pentru [proiectare / execuție], corelate cu regimul de presiune al obiectivelor din contract ([… bar]); (b) dacă se acceptă autorizațiile emise în baza oricăruia dintre cele două regulamente; (c) etapa în care se prezintă documentele.

- 🔒 **Impact intern (nu se trimite):** tehnic — Tipul greșit = lucrări neautorizate. Obiective PI cer ET + sudori OL suplimentari. · cost — Subcontractant ET. · risc — Ridicat: cerință nepublicată nu poate fi opusă (BO2022_2403), dar cerința lipsă lasă concurenți neautorizați. Ridicat pentru ofertantul fără tipul corect.
- **Notă:** Corectură runda 1: CL-B17 trimitea la „Ordinul 132/2021 sau actul în vigoare” — actul în vigoare e Ord. ANRE 17/2026. Verificare internă: dovada la ANRE a personalului/dotării în 3 luni (REQ-TG-020). Contopit cu: Tipul autorizației ANRE nu corespunde regimului de presiune al obiectivului. Ord. 17/2026 nu are praguri de diametru — doar tip obiectiv + presiune (REQ-TG-009). v1.1: REQ-P0-096 — Ord. ANRE 17/2026 în vigoare din 26.05.2026; termenul calculat pentru dovada personalului/dotării pe autorizațiile emise pe Ord. 132/2021 s-a împlinit la 26.08.2026 (verificare internă). BO2026_1360: autorizația EDSB a firmei nu poate fi motiv de respingere dacă DA nu a cerut-o expres. BO2024_3155: cerința restrictivă (ex. PT/ET) se contestă în termen de la publicarea DA.

### PAT-CAL-02
**Autorizare ANRE îndeplinită prin asociat sau subcontractant** · ⚖️ review juridic · încredere medie · vechi: CL-B05, CL-B07

- **Trigger:** FD cere autorizația ANRE de la ofertant/lider fără a preciza dacă poate fi îndeplinită de asociatul/subcontractantul care execută partea de gaze _(caută în: fisa_de_date; detecție: judecata_umana)_
- **Documente de verificat:** Fișa de date; DUAE; Acord de asociere / subcontractare
- **Cerințe:** `REQ-TG-016` Ordin ANRE 17/2026 art. 34 alin. (1); `REQ-TG-017` Ordin ANRE 17/2026 art. 34 alin. (2); `REQ-TG-018` Ordin ANRE 17/2026 art. 34 alin. (3); `REQ-AD-028` Legea 98/2016 art. 172 alin. (4); `REQ-AD-029` Legea 98/2016 art. 173 alin. (1); `REQ-AD-030` 3288/2024 (BO, nr. complet anonimizat) motivare (L98 art. 172; Legea 123/2012; Ord. ANRE 132/2021); `REQ-P0-029` Legea 98/2016 art. 174 alin. (1)–(2); `REQ-P0-036` HG 395/2016 art. 31 alin. (3); `REQ-AD-051` Legea 98/2016 art. 193 alin. (2)–(3)
- **Precedente CNSC:** BO2024_3288, BO2022_1615, BO2024_3232, BO2022_2768, BO2021_973

> **Întrebare (text extern):** Vă rugăm să precizați dacă cerința privind autorizația ANRE de tip [EDSB] se consideră îndeplinită de [asociatul / subcontractantul] care execută efectiv lucrările de gaze, în condițiile art. 34 din Regulamentul aprobat prin Ordinul ANRE nr. 17/2026 (subcontractare către operatori autorizați și coordonare printr-un instalator autorizat angajat al antreprenorului general).

- 🔒 **Impact intern (nu se trimite):** tehnic — Coordonare obligatorie prin instalator propriu; răspundere solidară. · cost — — · risc — Ridicat.
- **Notă:** Interpretări în tensiune: L98 art. 172 alin. (4) (fără cerințe de participare pentru subcontractanți, REQ-AD-028) vs BO2024_3288 (AC poate cere ANRE de la toți subcontractanții care execută gaze, REQ-AD-030). Necesită analiză juridică. v1.1: DIVERGENȚĂ CONFIRMATĂ — BO2024_3288 (AC poate cere ANRE de la toți asociații/terții/subcontractanții de pe partea de gaze) vs BO2024_3232 și BO2022_2768 (ajunge membrul/subcontractantul care execută efectiv gazele, dacă repartizarea e clară în ofertă). BO2021_973: când DA cere doar ca lucrarea de gaze să fie executată de operator autorizat, contractul cu o firmă autorizată nu impune declararea ei ca subcontractant — dar BO2020_2191 și BO2025_2344 cer declararea executantului real. Practica rămâne 2:1 în favoarea „executantului efectiv”; confidence rămâne medie, revizuire juridică obligatorie.

### PAT-CAL-03
**Intervenții pe rețele de gaze în contracte de drumuri sau apă-canal** · ⚖️ review juridic · încredere ridicata · vechi: CL-B18

- **Trigger:** LC/CS conțin relocări/protejări de conducte de gaze, ridicări la cotă de răsuflători/cutii, branșamente — fără cerință ANRE în FD _(caută în: caiet_sarcini, F3; detecție: cuvant_cheie)_
- **Documente de verificat:** Liste de cantități; Caiet de sarcini; Fișa de date
- **Cerințe:** `REQ-TG-002` Legea 123/2012 — Titlul II Gaze naturale art. 121 alin. (2); `REQ-TG-014` Ordin ANRE 17/2026 art. 31 alin. (1); `REQ-SC-110` Legea 123/2012 — Titlul II Gaze naturale art. 190 lit. b)–d); `REQ-SC-113` Ordin ANRE 89/2018 (NTPEE-2018) art. 28; art. 27
- **Precedente CNSC:** BO2023_657, BO2023_416, BO2021_973

> **Întrebare (text extern):** Pentru categoriile de lucrări [nr./denumire din lista de cantități] care presupun intervenții asupra sistemului de distribuție a gazelor naturale, vă rugăm să precizați dacă executantul acestora trebuie să dețină autorizație ANRE [tipul …] și dacă acesta trebuie nominalizat ca subcontractant în ofertă.

- 🔒 **Impact intern (nu se trimite):** tehnic — Lucrări pe gaze doar cu operator autorizat. · cost — Subcontractant autorizat. · risc — Mediu.
- **Notă:** BO2023_657 (orice intervenție fizică pe SD cere ANRE) vs BO2023_416 (critica pe ANRE necerută în DA are șanse mici) — interpretări de cântărit juridic. v1.1: BO2021_973 — dacă DA cere doar ca lucrările de gaze să fie executate de un operator autorizat ANRE, ofertantul poate asigura asta prin contract cu o firmă autorizată; divergența BO2023_657 vs BO2023_416 rămâne.

### PAT-CAL-04
**Personal cheie: legitimații ANRE cu terminologie veche și RTE „pentru gaze”** · ⚖️ review juridic · încredere ridicata · vechi: CL-B06, CL-B14

- **Trigger:** FD folosește 'gradul I/II', 'IGIB', 'instalator autorizat ANRE' fără tipurile EGD/EGIU/EGT/PGD / SAU: FD cere 'RTE pentru gaze' / 'RTE autorizat ANRE' _(caută în: fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date — personal cheie; Fișa de date
- **Cerințe:** `REQ-TG-048` Ordin ANRE 65/2023 (modificat prin Ordin ANRE 85/2024) art. 4 alin. (1), Tabelul nr. 1 (modificat prin Ord. 85/2024 art. I pct. 1); `REQ-TG-049` Ordin ANRE 65/2023 (modificat prin Ordin ANRE 85/2024) Tabelul nr. 1 — proiectare; `REQ-TG-003` Legea 123/2012 — Titlul II Gaze naturale art. 121 alin. (3); `REQ-TG-100` Ordin ANRE 89/2018 (NTPEE-2018) art. 285 alin. (3); `REQ-TG-015` Ordin ANRE 17/2026 art. 31 alin. (4); `REQ-P0-043` HG 395/2016 art. 32 alin. (4)–(5)
- **Precedente CNSC:** BO2024_1870, BO2024_2683, BO2026_2328, BO2024_717

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită „[text din fișa de date]”. Vă rugăm să precizați tipul de legitimație de instalator autorizat corespunzător, din cele prevăzute de Regulamentul aprobat prin Ordinul ANRE nr. 65/2023, modificat prin Ordinul ANRE nr. 85/2024 (de exemplu EGD / EGIU / EGT), precum și, pentru responsabilul tehnic cu execuția, domeniul de atestare solicitat.

- 🔒 **Impact intern (nu se trimite):** tehnic — RTE nu semnează lucrările unde a fost instalator/sudor (Ord. 17/2026 art. 31 alin. (4)). · cost — — · risc — Ridicat la nominalizarea expertului. Ridicat.
- **Notă:** Vizarea legitimațiilor (REQ-TG-050) neverificată — verificare internă separată. Contopit cu: RTE „pentru lucrări de gaze”. REQ-TG-100 are încredere medie. Citarea „art. 121 din Legea 123/2012” din runda 1 nu a fost păstrată în întrebare. v1.1: confidence medie→ridicata — 4 decizii noi concordante: legitimația ANRE se cere doar celor care proiectează/execută efectiv (BO2024_1870, BO2024_2683); autorizațiile personalului cerute doar în CS sau generic nu sunt cerințe de calificare (BO2026_2328, BO2024_717). Cazul ANRE cerut managerului/șefului de șantier: PAT-CAL-15.

### PAT-CAL-05
**Experiență similară formulată ca „identică” sau limitată strict la tipul de rețea din obiect** · ⚖️ review juridic · încredere ridicata · vechi: CL-B01, CL-B15, CL-B20

- **Trigger:** ES cere strict 'rețea de distribuție gaze PE' / 'identic' / apă + canal + stație în același contract _(caută în: fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date — capacitate tehnică; Strategia de contractare (dacă e publicată)
- **Cerințe:** `REQ-AD-037` Instrucțiunea ANAP 2/2017 art. 5 alin. (1)–(2); `REQ-AD-042` 2717/2023 (BO, nr. complet anonimizat) motivare (L98 art. 196; HG 395 art. 29; Instr. 2/2017); `REQ-AD-043` 3952/C1/4610 motivare (L98 art. 215–216; HG 395 art. 137; Instr. 2/2017 art. 5 alin. (1)); `REQ-AD-044` 1489/2023 (BO, nr. complet anonimizat) motivare (L99 art. 192; Instr. 2/2017 art. 5); `REQ-AD-090` Instrucțiunea ANAP 2/2017 titlu și preambul (art. 191 și art. 192 lit. a) și b) din Legea 99/2016); `REQ-AD-027` Legea 98/2016 art. 172 alin. (3) și (5); `REQ-P0-030` Legea 98/2016 art. 178 alin. (1)–(2)
- **Precedente CNSC:** BO2023_1378, Decizie_3952, BO2023_2717, BO2023_1489, BO2024_2669, BO2023_1336, BO2026_2328

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită experiență similară în „[citat]”. Vă rugăm să precizați dacă sunt acceptate și lucrări similare sau superioare din punctul de vedere al complexității (de exemplu [conducte de transport / branșamente și extinderi de rețea / rețele de fluide sub presiune]), avându-se în vedere art. 5 din Instrucțiunea ANAP nr. 2/2017, precum și dacă valoarea minimă poate fi atinsă prin mai multe contracte.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — — · risc — Ridicat: excludere la calificare.
- **Notă:** Duplicat contopit (3 surse runda 1). Decizie_3952 — nuanță: transportul a fost acceptat pentru că cerința admitea lucrări „de aceeași natură și complexitate sau superioare”; nu e regulă generală. Cumulul prin mai multe contracte (Instr. 2/2017 art. 4) nu are cerință verificată — nu se citează. v1.1: confirmat — BO2023_1336: dacă DA admite „infrastructuri de gaze naturale”, conductele de transport/SRM sunt similare sau superioare distribuției; AC nu poate adăuga distincții nescrise. L98 art. 178 (REQ-P0-030): cerințele trebuie să fie necesare și adecvate.

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
- **Cerințe:** `REQ-AD-039` Instrucțiunea ANAP 2/2017 art. 11 alin. (3); `REQ-AD-045` 182/C8/4870 motivare (L98 art. 2 alin. (2), art. 196; HG 343/2017 art. 19); `REQ-AD-046` 140/2023 (BO, nr. complet anonimizat) motivare (L98 art. 196, 209; HG 395 art. 134); `REQ-AD-041` Instrucțiunea ANAP 2/2017 art. 14 alin. (3); `REQ-P1-076` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 527 alin. (2)–(3); `REQ-P1-077` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 574; `REQ-P0-039` Legea 98/2016 art. 193 alin. (1); `REQ-P0-042` Legea 98/2016 art. 196 alin. (3)
- **Precedente CNSC:** BO2026_182, Decizie_3952, BO2023_140, BO2024_942, BO2025_1138, BO2026_1360

> **Întrebare (text extern):** Vă rugăm să precizați dacă lista documentelor justificative pentru experiența similară este exemplificativă și dacă se acceptă [PV de recepție la terminarea lucrărilor pe obiect / PV de recepție parțială / recomandări ale beneficiarului / documente constatatoare]. Pentru lucrările executate ca subcontractant, vă rugăm să confirmați că se ia în considerare valoarea lucrărilor executate efectiv, confirmată de antreprenorul general și de beneficiarul final (art. 14 alin. (3) din Instrucțiunea ANAP nr. 2/2017), și documentele acceptate în acest scop.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — — · risc — Ridicat: documentele emise după termenul de depunere nu dovedesc ES (BO2026_182). Ridicat.
- **Notă:** BO2026_182 — nuanță: CNSC nu a exclus automat experiența expertului anterioară autorizării ANRE; recomandările semnate de diriginte trebuie confirmate de beneficiar. Contopit cu: Experiență similară dobândită ca subcontractant sau în asociere. v1.1: confirmat — BO2024_942: recepția parțială pe obiecte funcționale independent probează ES (recepțiile parțiale sunt prevăzute de L169/2026 art. 527 alin. (3) și art. 574, REQ-P1-076/077); BO2025_1138: studiile de teren intră în ES de proiectare. ATENȚIE BO2026_1360: ES trebuie declarată efectiv în DUAE la depunere — omisiunea nu se repară prin DUAE revizuit (PAT-CAL-16).

### PAT-CAL-08
**Cifra de afaceri minimă disproporționată sau pe mai mult de 3 ani** · ⚖️ review juridic · încredere ridicata · vechi: CL-B03

- **Trigger:** cifra de afaceri minimă > 2 × VE sau perioada de referință > ultimele 3 exerciții _(caută în: fisa_de_date; detecție: calcul)_
- **Documente de verificat:** Fișa de date; Valoarea estimată
- **Cerințe:** `REQ-AD-033` Legea 98/2016 art. 175 alin. (2) lit. a), alin. (3)–(4); `REQ-AD-034` Legea 98/2016 art. 177 alin. (1) lit. c); `REQ-P0-035` HG 395/2016 art. 31 alin. (1)–(2); `REQ-P0-032` Legea 98/2016 art. 180 alin. (1)–(3)
- **Precedente CNSC:** BO2024_3232

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită o cifră de afaceri minimă anuală de [X] lei, respectiv de [N] ori valoarea estimată, pentru perioada [ani]. Vă rugăm să precizați motivele care justifică acest nivel, în sensul art. 175 alin. (3)–(4) din Legea nr. 98/2016, și perioada de referință avută în vedere (art. 177 alin. (1) lit. c)).

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — — · risc — Ridicat.
- **Notă:** Corectură runda 1: plafonul de 2 × VE rezultă din L98 art. 175 alin. (2) lit. a), nu doar din avizele ANAP. v1.1: HG 395 art. 31 alin. (1)–(2) (REQ-P0-035): indicatorii economico-financiari proporționali; pe loturi, cerințele se aplică pe lot (REQ-P0-032). BO2024_3232: cash-flow calculat VE×n/durată acceptat dacă AC îl justifică.

### PAT-CAL-09
**Cerințe de nișă fără legătură aparentă cu lucrările (atestate de alt tip, licență ANRSC, experiență „exclusiv în gaze”, utilaje specifice)** · ⚖️ review juridic · încredere medie · vechi: CL-B19, CL-B08

- **Trigger:** cerință de calificare fără corespondent în lucrările din LC (ex. atestat ANIF, utilaj specific, experiență exclusivă) / SAU: FD cere 'licență ANRSC' pentru un contract de execuție lucrări _(caută în: fisa_de_date; detecție: judecata_umana)_
- **Documente de verificat:** Fișa de date; Liste de cantități; Strategia de contractare
- **Cerințe:** `REQ-AD-027` Legea 98/2016 art. 172 alin. (3) și (5); `REQ-TG-166` Legea 241/2006 (republicată) —; `REQ-P0-030` Legea 98/2016 art. 178 alin. (1)–(2); `REQ-P0-035` HG 395/2016 art. 31 alin. (1)–(2)
- **Precedente CNSC:** BO2026_1237, BO2022_2083, BO2024_1016, BO2025_833, BO2024_3155

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită [cerința X, de exemplu licența ANRSC / atestatul …]. Vă rugăm să precizați activitatea sau categoria de lucrări din proiect pentru care este necesară această cerință și dacă aceasta constituie cerință de calificare pentru ofertantul care execută lucrările.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — — · risc — Ridicat dacă nu o îndeplinim. Ridicat dacă nu o deținem.
- **Notă:** Corectură runda 1: cererea „vă solicităm eliminarea” a fost scoasă din textul extern; eliminarea se urmărește, dacă e cazul, prin contestație (BO2022_2083: sarcina probei tehnice e a contestatorului). Contopit cu: Licență ANRSC cerută pentru un contract de execuție. temei de confirmat: Legea 241/2006 / 51/2006 nerecitite (REQ-TG-166 neverificat). v1.1: confidence scazuta→medie — BO2025_833: Revisal, declarații de disponibilitate, backstopping, RC profesională și dovada utilajelor la ofertare au fost eliminate de AC la contestare; BO2024_3155: cerințele de nișă (ISU, INSEMEX, Apele Române, SRMP) se contestă în termen de la publicarea DA. Temei verificat: L98 art. 178, HG 395 art. 31 (REQ-P0-030/035).

### PAT-CAL-10
**Personal cheie: același expert pe mai multe loturi și documentele de experiență** · ⚖️ review juridic · încredere medie · vechi: CL-B23

- **Trigger:** procedură pe loturi cu experți-cheie; FD nu spune dacă același expert poate fi propus pe mai multe loturi sau ce documente dovedesc experiența _(caută în: fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Fișa de date; Formulare CV
- **Cerințe:** `REQ-AD-120` Instrucțiunea ANAP 1/2017 art. referitoare la experții-cheie (numerotare neconfirmată); `REQ-P0-032` Legea 98/2016 art. 180 alin. (1)–(3); `REQ-P0-043` HG 395/2016 art. 32 alin. (4)–(5)
- **Precedente CNSC:** BO2023_2119, BO2024_1699

> **Întrebare (text extern):** Vă rugăm să precizați dacă același expert poate fi propus pentru loturile [1] și [2] și ce documente justificative ale experienței specifice se solicită la depunere.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — — · risc — Ridicat: cerințele formale clare nu se mai pot contesta după depunere (BO2024_1699).
- **Notă:** REQ-AD-120 (Instr. ANAP 1/2017) neverificat — nu se citează. v1.1: L98 art. 180 (REQ-P0-032) — la loturi, cerințele de capacitate se aplică pe fiecare lot; HG 395 art. 32 alin. (4)–(5) (REQ-P0-043) — expertul punctat nu poate fi și criteriu de calificare.

### PAT-CAL-11
**Calificarea sudorilor: autorizație ISCIR vs certificate EN ISO 9606-1 / EN 13067** · ⚖️ review juridic · încredere ridicata · vechi: CL-B10

- **Trigger:** CS/FD cer 'sudori certificați EN ISO 9606-1 / EN 13067' sau 'autorizați ISCIR' sau ambele / SAU: FD/CS cer sudori fără a spune dacă trebuie să fie salariați ai ofertantului sau ai membrului/subcontractantului care execută _(caută în: caiet_sarcini, fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Caiet de sarcini; Fișa de date
- **Cerințe:** `REQ-TG-063` Ordin ANRE 89/2018 (NTPEE-2018) art. 236 alin. (1); `REQ-TG-074` Ordin ANRE 89/2018 (NTPEE-2018) art. 239 alin. (5); `REQ-TG-106` SR EN 13067 (EN 13067:2020) NTPEE anexa 2 poz. 51; `REQ-TG-120` PT CR 9-2025 art. 49 alin. (1); art. 53 alin. (3); `REQ-TG-122` PT CR 9-2025 art. 63; `REQ-TG-135` PT CR 9-2025 art. 1 alin. (1) și art. 2; `REQ-TG-054` Ordin ANRE 89/2018 (NTPEE-2018) art. 6 alin. (2) + titlul anexei nr. 2; `REQ-TG-025` Ordin ANRE 17/2026 anexa 3, pct. 2 vs art. 14 lit. d)-e); `REQ-TG-032` Ordin ANRE 17/2026 art. 14 lit. d); `REQ-TG-033` Ordin ANRE 17/2026 art. 14 lit. e); `REQ-TG-121` PT CR 9-2025 art. 67; `REQ-P2-014` SR EN ISO 9606-1:2017 PT CR 9-2025 art. 25 alin. (1) lit. b) + anexa 16; `REQ-P2-026` SR EN 13067 (EN 13067:2020) NTPEE anexa 2 poz. 51; `REQ-P2-016` SR EN ISO 14731 (ISO 14731:2019) — (nu e citat de NTPEE/PT CR)
- **Precedente CNSC:** BO2024_717, BO2026_2328

> **Întrebare (text extern):** Caietul de sarcini / fișa de date ([…]) solicită pentru sudori „[citat]”. Vă rugăm să precizați dacă autorizațiile emise de ISCIR conform PT CR 9-2025 (inclusiv cele emise anterior, valabile până la expirare potrivit art. 63) sunt acceptate ca dovadă a calificării, fără certificate suplimentare emise de un organism terț, și dacă sudorii trebuie să fie salariați ai ofertantului (sau ai membrului asocierii / subcontractantului care execută lucrările respective) ori se acceptă și sudori puși la dispoziție prin contract de prestări servicii.

- 🔒 **Impact intern (nu se trimite):** tehnic — Dublă certificare = cost și timp. Autorizația ISCIR a sudorului e valabilă numai la angajator (PT CR 9-2025 art. 67). · cost — Certificare terță per sudor. · risc — Ridicat dacă e cerință de calificare. Mediu.
- **Notă:** Corectură runda 1: SR EN 13067 e doar recomandat în anexa 2 NTPEE (REQ-TG-106, REQ-TG-054) — obligatoriu numai dacă DA îl cere expres. Citarea „L98 art. 155” din runda 1 nu are cerință verificată — scoasă. Contopit cu: Sudori salariați vs sudori puși la dispoziție de terți. Neconcordanță internă Ord. ANRE 17/2026: anexa 3 pct. 2 (terț permis) vs art. 14 lit. d)–e) (salariați) — REQ-TG-025. v1.1: confidence medie→ridicata — REQ-P2-014/026 (verificate): certificatul SR EN ISO 9606-1 emis de organism acreditat e una din căile spre autorizarea ISCIR; EN 13067 e doar recomandat, cerința legală fiind autorizația ISCIR PEHD (PT CR 9-2025). BO2024_717 și BO2026_2328: autorizațiile sudorilor cerute doar generic în CS nu sunt cerințe de calificare.

### PAT-CAL-12
**VERIFICARE INTERNĂ: autorizațiile sudorilor nominalizați (expirate sau la alt angajator)** · ⚖️ review juridic · încredere ridicata · vechi: CL-B09

- **Trigger:** pentru fiecare sudor nominalizat: data expirării autorizației < data-limită de depunere + durata execuției, sau angajatorul de pe autorizație ≠ Gazpet _(caută în: fisa_de_date; detecție: comparatie_documente)_
- **Documente de verificat:** Registrul intern de autorizări sudori; REGES; Lista personalului nominalizat
- **Cerințe:** `REQ-TG-120` PT CR 9-2025 art. 49 alin. (1); art. 53 alin. (3); `REQ-TG-121` PT CR 9-2025 art. 67; `REQ-TG-122` PT CR 9-2025 art. 63; `REQ-TG-127` PT CR 9-2025 art. 71
- **Precedente CNSC:** —

> **Întrebare (text extern):** 

- 🔒 **Impact intern (nu se trimite):** tehnic — Sudor neautorizat nu poate lucra (PT CR 9-2025 art. 71). · cost — Reautorizare. · risc — Ridicat dacă sudorul e nominalizat în ofertă.
- **Notă:** Nu se trimite la AC (intrebare_propusa = null). Valabilitate 2 ani, numai la angajator; autorizațiile vechi valabile până la expirare.

### PAT-CAL-13
**Certificări cerute la calificare (SR EN ISO 3834-2 / IWE, ISO 9001 / 14001 / 45001) — echivalențe** · ⚖️ review juridic · încredere medie · vechi: CL-B11, CL-B13

- **Trigger:** FD cere 'ISO 3834-2' sau 'IWE' ca cerință de calificare / SAU: FD cere certificat ISO 45001 (sau 9001/14001) fără clauză de echivalență _(caută în: fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date
- **Cerințe:** `REQ-TG-030` Ordin ANRE 17/2026 art. 14 lit. b); `REQ-AD-027` Legea 98/2016 art. 172 alin. (3) și (5); `REQ-P2-015` SR EN ISO 3834-1…-5:2021 (+ EN ISO 3834-6:2024) — (nu e citat de NTPEE, PT CR 7/9 sau Ord. ANRE 17/2026); `REQ-P2-016` SR EN ISO 14731 (ISO 14731:2019) — (nu e citat de NTPEE/PT CR)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită [certificarea …]. Vă rugăm să precizați dacă se acceptă și certificate echivalente emise de organisme acreditate din alte state membre ori alte dovezi privind măsuri echivalente (de exemplu, pentru sudare, [responsabil cu tehnologia sudării atestat și proceduri de sudare aprobate]).

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Certificare 3834-2 costisitoare. · risc — Ridicat. Mediu.
- **Notă:** Afirmația din runda 1 „NTPEE nu impune ISO 3834” nu are cerință verificată explicită; Ord. ANRE 17/2026 cere doar declarație privind RTS atestat (REQ-TG-030). Contopit cu: Certificări ISO 9001 / 14001 / 45001 cerute — echivalențe. temei de confirmat: runda 1 invoca L98 art. 200–201; nicio cerință verificată în runda 2 — citarea scoasă. v1.1: confidence scazuta→medie — temeiul de confirmat e acum verificat: SR EN ISO 3834 nu e cerut de cadrul legal pentru SD (REQ-P2-015), iar coordonatorul ISO 14731 (IWE) nu e cerut legal — cadrul RO cere RTS atestat ISCIR (REQ-P2-016). Devin obligatorii doar dacă DA le cere.

### PAT-CAL-14
**Autorizare AFER (subtraversări CF) sau alte autorizări de nișă pentru activități din CS — la ofertă sau la execuție** · ⚖️ review juridic · încredere medie · vechi: —

- **Trigger:** planșele/CS includ subtraversarea unei căi ferate (sau alte lucrări cu autorizare specifică: instalații electrice ANRE, CF industriale), iar fișa de date cere generic „dovada capacității pentru toate activitățile” sau nu spune nimic _(caută în: caiet_sarcini, fisa_de_date, planse; detecție: judecata_umana)_
- **Documente de verificat:** Fișa de date; Caiet de sarcini; Planșe de traversare; DUAE — subcontractanți
- **Cerințe:** `REQ-SC-080` OUG 12/1998 art. 29 alin. (2), (4), (5); `REQ-SC-081` HG 525/1996 art. 20 alin. (4) lit. d); alin. (3); `REQ-SC-084` Ordin ANRE 89/2018 (NTPEE-2018) art. 178 alin. (2)–(4); `REQ-P0-033` Legea 98/2016 art. 181; `REQ-P0-034` HG 395/2016 art. 30 alin. (6); `REQ-AD-051` Legea 98/2016 art. 193 alin. (2)–(3)
- **Precedente CNSC:** BO2020_2191, BO2024_1529, BO2021_159

> **Întrebare (text extern):** Caietul de sarcini ([cap. …]) și planșa [nr.] prevăd [subtraversarea căii ferate la km …], lucrare pentru care este necesară [autorizarea AFER a executantului]. Vă rugăm să precizați dacă dovada acestei autorizări (deținute de ofertant sau de un subcontractant) se solicită la depunerea ofertei sau la începerea execuției lucrării respective și, în primul caz, dacă subcontractantul trebuie nominalizat în DUAE.

- 🔒 **Impact intern (nu se trimite):** tehnic — Subcontractant autorizat pentru subtraversare (foraj sub CF). · cost — Preț subcontractor + avizele CN CFR (REQ-SC-081). · risc — Ridicat dacă FD cere capacitatea pentru TOATE activitățile și nu declarăm subcontractantul (BO2020_2191).
- **Notă:** v1.1 (nou): DIVERGENȚĂ de practică: BO2020_2191 (FD cere capacitate pentru toate activitățile + CS include subtraversare CF → AFER sau subcontractant declarat la ofertare; completarea prin clarificări = ofertă inacceptabilă) vs BO2024_1529 (AFER/ANRE electric nu pot fi impuse la evaluare dacă anunțul cere doar ANRE gaze). BO2021_159: AC verifică capacitatea legală doar pentru activitățile efectiv necesare. Regula prudentă internă: declarăm subcontractantul autorizat în DUAE.

### PAT-CAL-15
**Legitimație ANRE cerută managerului de proiect / șefului de proiect / șefului de șantier** · ⚖️ review juridic · încredere ridicata · vechi: —

- **Trigger:** fișa de date cere legitimație/autorizare ANRE (EGD, PGD etc.) pentru roluri de conducere (manager de proiect, șef de proiect, șef de șantier) care nu proiectează și nu execută efectiv instalații de gaze _(caută în: fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date — personal cheie; Factori de evaluare (dacă expertul e punctat)
- **Cerințe:** `REQ-TG-048` Ordin ANRE 65/2023 (modificat prin Ordin ANRE 85/2024) art. 4 alin. (1), Tabelul nr. 1 (modificat prin Ord. 85/2024 art. I pct. 1); `REQ-TG-049` Ordin ANRE 65/2023 (modificat prin Ordin ANRE 85/2024) Tabelul nr. 1 — proiectare; `REQ-P0-030` Legea 98/2016 art. 178 alin. (1)–(2); `REQ-P0-035` HG 395/2016 art. 31 alin. (1)–(2); `REQ-P0-043` HG 395/2016 art. 32 alin. (4)–(5)
- **Precedente CNSC:** BO2024_2683, BO2024_1870, BO2026_1237

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) solicită pentru [managerul de proiect / șeful de șantier] legitimație ANRE de tip [EGD / PGD]. Vă rugăm să precizați activitățile de proiectare sau execuție a instalațiilor de gaze pe care le va desfășura efectiv acest expert și dacă cerința se consideră îndeplinită prin personalul autorizat ANRE nominalizat pentru execuția lucrărilor de gaze.

- 🔒 **Impact intern (nu se trimite):** tehnic — Poate bloca propunerea unui manager fără legitimație. · cost — — · risc — Mediu: cerința se poate elimina la contestare (BO2024_2683).
- **Notă:** v1.1 (nou): Două decizii concordante (BO2024_2683, BO2024_1870): autorizarea ANRE se cere doar celor care proiectează/execută efectiv; impusă managerului e restrictivă. BO2026_1237: experiența „strict în gaze” cerută managerului se elimină dacă nu e justificată. Separat de PAT-CAL-04 (terminologie).

### PAT-CAL-16
**VERIFICARE INTERNĂ: DUAE completat efectiv (cash-flow, ES cu subsecvente, procente de subcontractare, alpha)**  · încredere ridicata · vechi: —

- **Trigger:** înainte de depunere: DUAE trebuie să conțină cifrele concrete (cash-flow cu valoare și sursă, fiecare contract de ES inclusiv contractele subsecvente unui acord-cadru), procentul de subcontractare corelat cu graficul, DUAE separat pentru fiecare terț/subcontractant pe care se bazează capacitatea; „alpha” doar la simplificată/PNRR _(caută în: fisa_de_date; detecție: comparatie_documente)_
- **Documente de verificat:** DUAE (ofertant, asociați, terți, subcontractanți); Grafic de execuție; Fișa de date
- **Cerințe:** `REQ-P0-039` Legea 98/2016 art. 193 alin. (1); `REQ-P0-040` Legea 98/2016 art. 193 alin. (6); `REQ-P0-041` Legea 98/2016 art. 194; `REQ-P0-042` Legea 98/2016 art. 196 alin. (3); `REQ-AD-046` 140/2023 (BO, nr. complet anonimizat) motivare (L98 art. 196, 209; HG 395 art. 134); `REQ-AD-051` Legea 98/2016 art. 193 alin. (2)–(3)
- **Precedente CNSC:** BO2026_1360, BO2022_340, BO2023_140, BO2021_1117, BO2023_246, BO2023_562, BO2026_362

> **Întrebare (text extern):** 

- 🔒 **Impact intern (nu se trimite):** tehnic — Coerență DUAE ↔ Gantt ↔ propunere tehnică. · cost — — · risc — Ridicat: informația de calificare nedeclarată în DUAE e omisiune de fond, nereparabilă prin DUAE revizuit (BO2026_1360).
- **Notă:** v1.1 (nou): Nu se trimite la AC (intrebare_propusa = null). Nuanță: prezentarea în altă formă decât preferă comisia se corectează prin DUAE revizuit (BO2022_340); neconcordanțele DUAE–grafic trebuie clarificate de comisie (BO2021_1117). La clarificările comisiei: cererea necontestată devine obligatorie și se răspunde exact la ce s-a cerut (BO2023_246); cererea vagă se poate contesta (BO2026_362); lipsa semnăturii pe un răspuns care confirmă documente deja semnate se remediază, nu se sancționează (BO2023_562).

### PAT-CAL-17
**Asociere: cerințele de capacitate se cumulează sau se aplică proporțional cu cota de implicare**  · încredere ridicata · vechi: —

- **Trigger:** fișa de date permite asocierea, dar nu spune dacă cifra de afaceri / ES / resursele se îndeplinesc cumulat sau de fiecare asociat proporțional cu cota sa _(caută în: fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Fișa de date — calificare; Acord de asociere
- **Cerințe:** `REQ-P0-036` HG 395/2016 art. 31 alin. (3); `REQ-P0-037` Legea 98/2016 art. 182 alin. (1); `REQ-P0-038` Legea 98/2016 art. 183 alin. (1)
- **Precedente CNSC:** BO2024_3232, BO2022_2768

> **Întrebare (text extern):** Vă rugăm să precizați, pentru ofertele depuse în asociere, dacă cerințele privind [cifra de afaceri / experiența similară / resursele tehnice] se îndeplinesc cumulat de membrii asocierii sau de fiecare asociat proporțional cu cota sa de implicare (art. 31 alin. (3) din HG nr. 395/2016).

- 🔒 **Impact intern (nu se trimite):** tehnic — Structura asocierii și repartizarea lucrărilor. · cost — — · risc — Mediu.
- **Notă:** v1.1 (nou): HG 395 art. 31 alin. (3) (REQ-P0-036): proporționalitatea se poate cere doar dacă e prevăzută în DA. BO2024_3232/BO2022_2768: repartizarea sarcinilor trebuie să fie clară în ofertă. Autorizarea ANRE în asociere: PAT-CAL-02.

## Garanții

### PAT-GAR-01
**Garanția de participare: cuantum, valabilitate, forma instrumentului și condiții impuse emitentului** · ⚖️ review juridic · încredere ridicata · vechi: CL-B04, CL-B21

- **Trigger:** FD limitează instrumentul (doar bancă, rating minim, emitent nominalizat) sau cere original pe hârtie / SAU: GP exprimată doar procentual, > 1 % din VE, sau cu valabilitate diferită de valabilitatea ofertei _(caută în: fisa_de_date; detecție: cuvant_cheie)_
- **Documente de verificat:** Fișa de date; Model de instrument de garantare; Anunț
- **Cerințe:** `REQ-AD-012` Legea 98/2016 art. 154 alin. (4) lit. a)–c); `REQ-AD-013` HG 395/2016 art. 36 alin. (4); `REQ-AD-014` HG 395/2016 art. 36 alin. (5); `REQ-AD-020` 1317/C6/1161 motivare (L99 art. 164; HG 394 art. 45–48); `REQ-AD-011` Legea 98/2016 art. 154 alin. (2); `REQ-AD-064` HG 395/2016 art. 137 alin. (2) lit. i)
- **Precedente CNSC:** BO2021_1317, BO2022_1952, BO2021_2420, BO2021_99, BO2026_15, BO2020_2392, BO2025_1775

> **Întrebare (text extern):** Fișa de date ([secțiunea …]) prevede garanția de participare [ca procent / în valoare de …], cu valabilitate de [N] zile, constituită [numai prin … / de un emitent cu …]. Vă rugăm să precizați cuantumul în lei și perioada minimă de valabilitate a garanției și să confirmați că se acceptă oricare dintre formele prevăzute la art. 154 alin. (4) din Legea nr. 98/2016, inclusiv instrumentul emis de o societate de asigurări, transmis în SEAP odată cu oferta (art. 36 alin. (4)–(5) din HG nr. 395/2016).

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Cost instrument. Comision instrument. · risc — Ridicat. Ridicat: GP lipsă/insuficientă nu se remediază (BO2021_2420).
- **Notă:** Contopire CL-B04 (partea de formă) + CL-B21. Scrisoarea IFN e admisă doar la lucrări cu VE ≤ 40.000.000 lei (REQ-AD-012). Contopit cu: Garanția de participare: cuantum și valabilitate. v1.1: confirmat — BO2020_2392: contează existența GP valabile la termen, nu secțiunea SEAP în care a fost încărcată; BO2026_15: prelungirea o cere AC, iar GP nu e criteriu de calificare; BO2025_1775: neprelungirea după respingere nu înlătură interesul de a contesta.

### PAT-GAR-02
**Garanția de bună execuție cumulată cu Sumele Reținute; rețineri succesive; restituire**  · încredere ridicata · vechi: CL-D03

- **Trigger:** acordul contractual nu fixează GBE sau nu exclude Sumele Reținute (cl. 47.2), ori nu precizează constituirea prin rețineri succesive _(caută în: contract, fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Acord contractual; Condiții generale/specifice HG 1/2018; Fișa de date
- **Cerințe:** `REQ-AD-021` Legea 98/2016 art. 154 alin. (3); `REQ-AD-023` HG 395/2016 art. 40 alin. (4)–(6); `REQ-AD-025` Legea 98/2016 art. 154^2 alin. (5); `REQ-AD-094` HG 1/2018 Anexa 1, cl. 15.1; `REQ-AD-095` HG 1/2018 Anexa 1, cl. 15.6; `REQ-AD-100` HG 1/2018 Anexa 1, cl. 47.2; `REQ-AD-101` HG 1/2018 Anexa 1, cl. 47.4; `REQ-P1-004` HG 1/2018 Anexa 1, cl. 15.1 lit. a); `REQ-P1-005` HG 1/2018 Anexa 1, cl. 15.1 lit. b); `REQ-P1-006` HG 1/2018 Anexa 1, cl. 15.2; `REQ-P1-007` HG 1/2018 Anexa 1, cl. 15.3; `REQ-P1-008` HG 1/2018 Anexa 1, cl. 15.5; `REQ-P1-010` HG 1/2018 Anexa 1, cl. 47.1 (forma HG 1347/2022 și HG 965/2023); `REQ-P1-011` HG 1/2018 Anexa 1, cl. 47.3
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați cuantumul garanției de bună execuție, dacă aceasta se poate constitui prin rețineri succesive (subclauza 15.1), dacă se aplică și Sumele Reținute prevăzute la subclauza 47.2 și modul de corelare cu subclauza 47.4, precum și procentul restituit la Recepția la Terminare (subclauza 15.6).

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Imobilizare de până la 10 % + 5 % din preț. · risc — Scăzut.
- **Notă:** v1.1: REQ-P1-010 — după HG 1347/2022 și HG 965/2023, Sumele Reținute se aplică NUMAI la GBE prin rețineri succesive; cazul DA care le aplică și la GBE prin instrument: PAT-GAR-05. REQ-P1-005: rețineri succesive doar dacă DA le prevede (depunere inițială ≥ 0,5 %).

### PAT-GAR-03
**Perioada de garanție a lucrărilor: categoria de importanță / clasa de consecințe / garanția ANRE de 2 ani** · ⚖️ review juridic · încredere ridicata · vechi: CL-D05, CL-D06

- **Trigger:** acordul contractual nu indică perioada de garanție sau categoria de importanță; perioada de garanție e factor de evaluare fără minim legal precizat _(caută în: contract, fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Acord contractual; Fișa de date (factori de evaluare); Memoriu (categoria de importanță)
- **Cerințe:** `REQ-AD-110` HG 1/2018 Anexa 1, cl. 61.6; `REQ-TG-023` Ordin ANRE 17/2026 anexa 8, pct. 12; `REQ-AD-142` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 531 alin. (6) — confirmat pe MO 661/2026 (runda noapte, REQ-P1); `REQ-AD-144` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 531 alin. (9) — confirmat pe MO 661/2026 (runda noapte, REQ-P1); `REQ-P1-080` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 531 alin. (7), (8), (10); `REQ-P1-081` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 370 alin. (5); `REQ-P1-082` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 532 alin. (3)–(4); `REQ-P1-095` HG 273/1994 — Regulament privind receptia constructiilor (forma HG 343/2017) art. 24 (teza a doua); `REQ-P0-091` Ordin ANRE 7/2022 anexa 5, art. 17
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați perioada de garanție a lucrărilor solicitată și categoria de importanță [sau clasa de consecințe] a lucrării, în raport cu subclauza 61.6 din condițiile contractuale, precum și dacă perioada de garanție constituie factor de evaluare și, în acest caz, valoarea minimă acceptată.

- 🔒 **Impact intern (nu se trimite):** tehnic — Ord. ANRE 17/2026: garanție ≥ 2 ani de la PIF, menționată distinct în contract (REQ-TG-023). · cost — Provizioane pentru remedieri. · risc — Mediu dacă e factor de evaluare.
- **Notă:** Contopire CL-D05 + CL-D06. temei de confirmat: clasele de consecințe și minimele CC1–CC4 din Legea 169/2026 (REQ-AD-142/144) sunt neverificate pe sursă — nu se citează. v1.1: confidence medie→ridicata — minimele pe clase de consecințe sunt acum verificate (REQ-AD-142/144 confirmate pe MO 661/2026; L169 art. 531 alin. (7)–(10), REQ-P1-080; echivalența categorii↔clase, art. 370 alin. (5), REQ-P1-081). HG 273/1994 art. 24: perioada ofertată nu poate fi sub minimul legal (REQ-P1-095). Pentru convenția tehnică ANRE: minimum 24 de luni (REQ-P0-091). Revizuirea juridică rămâne pentru corelarea celor două regimuri.

### PAT-GAR-04
**Garanția pentru refacerea structurii rutiere (5 ani) și cine o asigură**  · încredere ridicata · vechi: —

- **Trigger:** lucrări în ampriza unui DN/drum, cu refacere de structură rutieră; DA nu spune garanția aplicabilă refacerii sau cine e beneficiarul autorizației de amplasare _(caută în: caiet_sarcini, contract; detecție: judecata_umana)_
- **Documente de verificat:** Caiet de sarcini; Acord contractual; Aviz/autorizație administrator drum
- **Cerințe:** `REQ-SC-061` Ordin MTI 1668/2023 Anexă pct. 3.4.1 alin. (5); pct. 3.4.5 alin. (2); `REQ-SC-062` Ordin MTI 1668/2023 Anexă pct. 3.4.1 alin. (7); pct. 3.4.5 alin. (4)–(5); `REQ-SC-063` Ordin MTI 1668/2023 Anexă pct. 3.4.1 alin. (8); pct. 3.4.5 alin. (6); `REQ-SC-075` Ordin MI/MT 1112/411/2000 Partea I pct. (13) lit. k)–l); pct. (18); `REQ-P2-101` Ordin MTI 1668/2023 Anexă pct. 3.4.1 alin. (5); pct. 3.4.5 alin. (2); `REQ-P2-102` Ordin ANRE 89/2018 (NTPEE-2018) art. 195
- **Precedente CNSC:** BO2025_2344

> **Întrebare (text extern):** Pentru refacerea structurii rutiere afectate pe [drumul …], vă rugăm să precizați perioada de garanție aplicabilă, dacă aceasta diferă de perioada de garanție a lucrărilor din contract și cine asigură garanția față de administratorul drumului.

- 🔒 **Impact intern (nu se trimite):** tehnic — Refacerea se face de o societate specializată în drumuri. · cost — Garanție ≥ 5 ani pe refacere. · risc — Mediu: executantul efectiv al refacerii trebuie declarat subcontractant (BO2025_2344).
- **Notă:** v1.1: REQ-P2-101 (Ord. MT 1668/2023): structura rutieră se reface pe cheltuiala beneficiarului autorizației, de o firmă specializată; cantitățile de refacere: PAT-CNT-05.

### PAT-GAR-05
**Sume Reținute aplicate deși GBE nu se constituie prin rețineri succesive**  · încredere ridicata · vechi: —

- **Trigger:** acordul contractual / condițiile speciale prevăd GBE prin instrument de garantare sau virament și, în același timp, Sume Reținute (cl. 47) din fiecare certificat de plată _(caută în: contract, fisa_de_date; detecție: comparatie_documente)_
- **Documente de verificat:** Acord contractual; Condiții speciale HG 1/2018; Fișa de date — GBE
- **Cerințe:** `REQ-P1-010` HG 1/2018 Anexa 1, cl. 47.1 (forma HG 1347/2022 și HG 965/2023); `REQ-P1-011` HG 1/2018 Anexa 1, cl. 47.3; `REQ-P1-005` HG 1/2018 Anexa 1, cl. 15.1 lit. b); `REQ-P1-004` HG 1/2018 Anexa 1, cl. 15.1 lit. a); `REQ-AD-100` HG 1/2018 Anexa 1, cl. 47.2; `REQ-AD-101` HG 1/2018 Anexa 1, cl. 47.4
- **Precedente CNSC:** —

> **Întrebare (text extern):** Acordul contractual prevede constituirea garanției de bună execuție prin [instrument de garantare / virament] și aplicarea Sumelor Reținute de [x] % din fiecare certificat de plată. Vă rugăm să precizați dacă Sumele Reținute se aplică și în cazul în care garanția de bună execuție este constituită integral prin instrument de garantare sau virament, având în vedere subclauza 47.1 din Condițiile Generale (forma modificată prin HG nr. 1347/2022 și HG nr. 965/2023).

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Imobilizare suplimentară de până la 5 % din preț, peste GBE. · risc — Scăzut.
- **Notă:** v1.1 (nou): REQ-P1-010 (verificat) — modificare 2022–2023 care completează REQ-AD-100. Contract pe model HG 1/2018 Anexa 1 (obligatoriu peste prag).

### PAT-GAR-06
**VERIFICARE INTERNĂ: cauțiunea pentru contestație — cuantum, plafon, termen, restituire** · ⚖️ review juridic · încredere ridicata · vechi: —

- **Trigger:** înainte de o contestație: VE ≥ prag (lucrări 26.960.556 lei) → 2 % din VE, plafon 220.000 lei până la termenul de depunere / 2.000.000 lei după; acord-cadru → dublul celui mai mare subsecvent; dovada se depune odată cu contestația _(caută în: fisa_de_date; detecție: calcul)_
- **Documente de verificat:** Anunț (VE, prag); Tip procedură (acord-cadru?); Dovada plății cauțiunii
- **Cerințe:** `REQ-P0-001` Legea 101/2016 art. 61^1 alin. (1) lit. b); `REQ-P0-002` Legea 101/2016 art. 61^1 alin. (1) lit. a)–b) raportat la art. 17 alin. (1) lit. a)–b); `REQ-P0-003` Legea 101/2016 art. 61^1 alin. (2); `REQ-P0-004` Legea 101/2016 art. 61^1 alin. (3)–(4); `REQ-P0-005` Legea 101/2016 art. 61^1 alin. (5)–(6); `REQ-P0-006` Legea 101/2016 art. 61^1 alin. (5^1); `REQ-P0-007` Legea 101/2016 art. 61^1 alin. (7)–(8)
- **Precedente CNSC:** BO2024_3657, BO2020_2392, BO2025_2863, BO2024_1529

> **Întrebare (text extern):** 

- 🔒 **Impact intern (nu se trimite):** tehnic — Cauțiunea se reține în limita prejudiciului dacă AC câștigă definitiv (REQ-P0-006). · cost — Imobilizare 2 % din VE (plafonat); restituire la cerere, după minimum 30 de zile de la rămânerea definitivă (REQ-P0-005). · risc — Ridicat: contestația fără cauțiune se respinge fără analiză (BO2024_3657, BO2020_2392).
- **Notă:** v1.1 (nou): Nu se trimite la AC (intrebare_propusa = null). CORECTURĂ: REQ-AD-085 (neverificat) indica plafonul 880.000 lei din forma 2018–2019; forma curentă: 2.000.000 lei (REQ-P0-001). Plafoanele SUB prag (art. 61^1 alin. (1) lit. a)) nu au cerință verificată în runda P0 — de reconfirmat înainte de folosire.

## Termene

### PAT-TRM-01
**Termenul de execuție și graficul Gantt — ce include și ce nivel de detaliu**  · încredere ridicata · vechi: CL-A09

- **Trigger:** termenul de execuție nu spune dacă include proiectarea, obținerea avizelor (ex. restricții circulație ≥ 30 zile, declarație ITM ≥ 30 zile) sau sezonul rece; FD cere Gantt fără nivel de detaliu _(caută în: fisa_de_date, caiet_sarcini, contract; detecție: judecata_umana)_
- **Documente de verificat:** Fișa de date; Acord contractual; Caiet de sarcini
- **Cerințe:** `REQ-AD-032` 1706/C7/1650/1651 motivare (L98 art. 215; HG 395 art. 137); `REQ-SC-070` Ordin MI/MT 1112/411/2000 Partea I pct. (6); `REQ-SC-011` HG 300/2006 art. 47 lit. a)–b); art. 48; `REQ-P0-072` Ordin ANRE 7/2022 art. 37 alin. (1); `REQ-P0-073` Ordin ANRE 7/2022 art. 37 alin. (2); `REQ-P1-019` HG 1/2018 Anexa 1, cl. 35.1
- **Precedente CNSC:** BO2022_1964, BO2024_1706, BO2024_717, BO2022_2053, BO2022_2768, BO2025_1775, BO2023_1128

> **Întrebare (text extern):** Vă rugăm să precizați dacă termenul de execuție de [N] luni include perioada de [proiectare / obținere a avizelor și autorizațiilor / sezon rece] și ce nivel de detaliere se solicită pentru graficul de execuție (activități, resurse umane și utilaje).

- 🔒 **Impact intern (nu se trimite):** tehnic — Programare realistă. · cost — Penalități de întârziere. · risc — Mediu: Gantt incomplet/incoerent = neconformitate (BO2022_1964).
- **Notă:** v1.1: PRACTICĂ DIVERGENTĂ pe Gantt — BO2022_2053 (respingerea pentru forma Gantt-ului e disproporționată; aceeași metodă la toți) vs BO2024_717, BO2022_2768, BO2025_1775 (Gantt fără resurse pe activitate / drum critic continuu, când e cerut expres → neconform, fără remediere). Granița: cerința expresă din DA — de aceea întrebarea pe nivelul de detaliu e importantă. Termenele ANRE la racordare: PAT-TRM-04.

### PAT-TRM-02
**Răspunsurile la clarificări publicate cu mai puțin de 10 (6) zile înainte de termenul de depunere**  · încredere ridicata · vechi: CL-P01

- **Trigger:** data publicării răspunsului > termen depunere − 10 zile (− 6 zile la procedura simplificată pentru lucrări), pentru întrebări transmise în termen _(caută în: raspunsuri_clarificari; detecție: calcul)_
- **Documente de verificat:** Răspunsuri la clarificări (data publicării); Anunț (termene)
- **Cerințe:** `REQ-AD-003` Legea 98/2016 art. 161 alin. (1); `REQ-AD-004` Legea 98/2016 art. 161 alin. (2); `REQ-AD-005` HG 395/2016 art. 27 alin. (2); `REQ-AD-001` Legea 98/2016 art. 160 alin. (1); `REQ-P0-027` HG 395/2016 art. 27 alin. (3)–(4)
- **Precedente CNSC:** BO2025_286, BO2023_1128

> **Întrebare (text extern):** Răspunsurile la solicitările de clarificare transmise în termen au fost publicate la [data], cu [N] zile înainte de termenul de depunere a ofertelor ([data]). Având în vedere art. 161 din Legea nr. 98/2016, vă rugăm să analizați prelungirea termenului de depunere a ofertelor.

- 🔒 **Impact intern (nu se trimite):** tehnic — Timp insuficient de integrare a răspunsurilor. · cost — — · risc — Scăzut.
- **Notă:** Excepție: 5 zile la urgență demonstrată (REQ-AD-003). v1.1: BO2025_286 — termenele care lasă efectiv 1–2 zile lucrătoare peste sărbători sunt nelegale; cazul dedicat: PAT-TRM-05. BO2023_1128: după remediere AC publică erată cu nou termen de depunere și termen legal de răspuns.

### PAT-TRM-03
**VERIFICARE INTERNĂ: termenul de contestare a documentației / a răspunsului la clarificări** · ⚖️ review juridic · încredere medie · vechi: —

- **Trigger:** la publicarea DA sau a unui răspuns la clarificări care menține o cerință considerată restrictivă: termen = 10 zile (VE ≥ prag UE lucrări 26.960.556 lei) sau 7 zile (VE < prag), din ziua următoare luării la cunoștință _(caută în: raspunsuri_clarificari, fisa_de_date; detecție: calcul)_
- **Documente de verificat:** Anunț (VE); Data publicării DA / răspunsului
- **Cerințe:** `REQ-AD-083` Legea 101/2016 art. 8 alin. (1) lit. a)–b); `REQ-AD-084` 182/C8/4870 pct. I (admisibilitate) — calculul termenului; `REQ-AD-088` Reg. delegate (UE) 2025/2152, 2025/2150, 2025/2151, 2025/2487 + Notificare ANAP 10.12.2025 Reg. delegat (UE) 2025/2152 (clasic) / 2025/2150 (sectorial); `REQ-AD-085` Legea 101/2016 art. 61^1 alin. (1); `REQ-AD-086` 2863/C4/3581 motivare (L101 art. 61^1); `REQ-P0-001` Legea 101/2016 art. 61^1 alin. (1) lit. b); `REQ-P0-002` Legea 101/2016 art. 61^1 alin. (1) lit. a)–b) raportat la art. 17 alin. (1) lit. a)–b); `REQ-P0-008` Legea 101/2016 cap. II (art. 6–7) — abrogat; `REQ-P0-009` Legea 101/2016 art. 16 alin. (1); `REQ-P0-011` Legea 101/2016 art. 21 alin. (3); `REQ-P0-016` Legea 101/2016 art. 9 alin. (1), (3); `REQ-P0-022` Legea 101/2016 art. 59 alin. (1), (4); `REQ-P0-023` Legea 101/2016 art. 49 alin. (2)
- **Precedente CNSC:** BO2026_182, BO2023_2119, BO2025_878, BO2025_2863, BO2024_3155, BO2026_13, BO2023_2185, BO2024_203, BO2024_3064

> **Întrebare (text extern):** 

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Cauțiune 2 % din VE (plafoane sub prag 35.000 / 88.000 lei — neconfirmate în forma curentă). · risc — Pierderea dreptului de a contesta cerința.
- **Notă:** Corectură runda 1: sub prag termenul este de 7 zile, nu 5 (BO2026_182, BO2023_2119). Textul curent L101 art. 8 nu a fost recitit (REQ-AD-083 neverificat) — de confirmat juridic. Cauțiunea are termen de decădere (BO2025_2863). Contestarea DA rămâne admisibilă și dacă depunem ofertă (BO2025_878). Nu se trimite la AC. v1.1: CORECTURĂ — plafonul cauțiunii peste prag după termenul de depunere este 2.000.000 lei (REQ-P0-001), nu 880.000 lei (REQ-AD-085, formă 2018–2019); cauțiunea: PAT-GAR-06. Notificarea prealabilă a AC nu mai există (REQ-P0-008); contestația se trimite și CNSC și AC în termen (REQ-P0-009); motivele noi după termen sunt inadmisibile (REQ-P0-011); achizițiile directe se contestă la tribunal (REQ-P0-023). BO2024_3155: răspunsurile la clarificări care nu modifică DA nu prelungesc termenul. Art. 8 L101 (termenele 10/7 zile) rămâne neverificat pe textul curent. Procedural: criticile reluate după o excludere necontestată sunt tardive (BO2023_2185); cine nu poate înlătura câștigătorul nu are interes față de locurile inferioare (BO2024_203); reevaluarea dispusă de CNSC nu poate ridica neconformități noi (BO2024_3064).

### PAT-TRM-04
**Termenul de execuție la racorduri/extinderi vs termenele maxime din Ord. ANRE 7/2022 art. 37**  · încredere ridicata · vechi: —

- **Trigger:** obiect cu racorduri sau extinderi pentru racordare; DA fixează un termen de execuție fără să spună de la ce act curge și dacă include recepția și PIF făcute de OSD (Ord. 7/2022: 90 de zile racord / 180 de zile extindere, din care recepție+PIF 10/18 zile) _(caută în: fisa_de_date, contract; detecție: calcul)_
- **Documente de verificat:** Fișa de date; Acord contractual; Grafic de execuție
- **Cerințe:** `REQ-P0-071` Ordin ANRE 7/2022 art. 35 alin. (1) lit. a)–f); `REQ-P0-072` Ordin ANRE 7/2022 art. 37 alin. (1); `REQ-P0-073` Ordin ANRE 7/2022 art. 37 alin. (2); `REQ-P0-077` Ordin ANRE 7/2022 art. 39 alin. (1), (5); `REQ-P0-078` Ordin ANRE 7/2022 art. 39 alin. (3); `REQ-P0-080` Ordin ANRE 7/2022 art. 46 alin. (2) lit. h)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Termenul de execuție prevăzut în [fișa de date / contract] este de [N] zile pentru [racorduri / extinderea conductei]. Vă rugăm să precizați actul de la care curge termenul (semnarea contractului, emiterea autorizației de construire sau a acordului administratorului drumului, ordinul de începere) și dacă în acest termen sunt incluse recepția și punerea în funcțiune efectuate de operatorul de distribuție, în raport cu termenele maxime prevăzute la art. 37 din Regulamentul aprobat prin Ordinul ANRE nr. 7/2022.

- 🔒 **Impact intern (nu se trimite):** tehnic — Dependențe de OSD (diriginte cerut cu ≥ 7 zile lucrătoare înainte, PIF în 5/10 zile lucrătoare). · cost — Penalități de întârziere pentru zile consumate de OSD. · risc — Scăzut la ofertare; ridicat contractual.
- **Notă:** v1.1 (nou): Ord. ANRE 7/2022 art. 35, 37, 39, 46 — verificat. Corelare cu PAT-TRM-01 (Gantt).

### PAT-TRM-05
**Termene de clarificare/depunere care se suprapun peste sărbători legale (1–2 zile lucrătoare efective)** · ⚖️ review juridic · încredere medie · vechi: —

- **Trigger:** intervalul dintre termenul-limită pentru întrebări, termenul de răspuns al AC și termenul de depunere cuprinde sărbători legale/zile nelucrătoare, astfel încât rămân efectiv ≤ 2 zile lucrătoare pentru întrebări sau pentru analiza răspunsurilor _(caută în: fisa_de_date, raspunsuri_clarificari; detecție: calcul)_
- **Documente de verificat:** Anunț de participare; Calendarul sărbătorilor legale; Răspunsuri la clarificări (date de publicare)
- **Cerințe:** `REQ-AD-001` Legea 98/2016 art. 160 alin. (1); `REQ-AD-003` Legea 98/2016 art. 161 alin. (1); `REQ-AD-004` Legea 98/2016 art. 161 alin. (2); `REQ-AD-005` HG 395/2016 art. 27 alin. (2); `REQ-P0-027` HG 395/2016 art. 27 alin. (3)–(4)
- **Precedente CNSC:** BO2025_286, BO2023_1128

> **Întrebare (text extern):** Termenul-limită pentru transmiterea solicitărilor de clarificare este [data], iar termenul de depunere a ofertelor este [data]. Între [data] și [data] se află [sărbătorile legale / zilele nelucrătoare …], astfel încât rămân [N] zile lucrătoare pentru formularea întrebărilor și analiza răspunsurilor. Vă rugăm să precizați dacă termenul de depunere a ofertelor va fi prelungit, în corelare cu art. 27 alin. (2) din HG nr. 395/2016.

- 🔒 **Impact intern (nu se trimite):** tehnic — Timp insuficient pentru analiza DA și a răspunsurilor. · cost — — · risc — Mediu: ofertă pregătită pe ipoteze neclarificate.
- **Notă:** v1.1 (nou): Un singur precedent (BO2025_286, apă-canal): termenele care lasă efectiv 1–2 zile lucrătoare peste sărbători sunt nelegale; dacă termenul de depunere a trecut, sancțiunea a fost anularea procedurii. Decizia de a contesta (vs. a întreba) e juridică — vezi PAT-TRM-03.

## Clauze contractuale

### PAT-CTC-01
**Ajustarea prețului lipsește la durate de peste 6 luni / contradicție cu prețul ferm (cl. 48.2)**  · încredere ridicata · vechi: CL-D01

- **Trigger:** durata de execuție > 6 luni și acordul contractual nu are clauză de ajustare sau rămâne pe regula implicită cl. 48.2 (preț ferm ≤ 365 de zile) / SAU: acordul contractual nu fixează data de referință sau exclude cl. 48.8 _(caută în: contract, fisa_de_date; detecție: calcul)_
- **Documente de verificat:** Acord contractual; Condiții specifice; Fișa de date
- **Cerințe:** `REQ-AD-078` Legea 98/2016 art. 222^2 alin. (2)–(3); `REQ-AD-079` Legea 98/2016 art. 222^2 alin. (9); `REQ-AD-102` HG 1/2018 Anexa 1, cl. 48.2; `REQ-AD-103` HG 1/2018 Anexa 1, cl. 48.3–48.4; `REQ-AD-104` HG 1/2018 Anexa 1, cl. 48.5; `REQ-AD-106` HG 1/2018 Anexa 1, Definiții lit. n); `REQ-AD-105` HG 1/2018 Anexa 1, cl. 48.8; `REQ-P1-003` Legea 98/2016 art. 222^2 alin. (9) coroborat cu HG 1/2018 art. 4 și Anexa 1 cl. 48.2; `REQ-P1-051` HG 1/2018 Anexa 1, cl. 48.1; `REQ-P1-052` HG 1/2018 Anexa 1, cl. 48.3–48.4; `REQ-P1-053` HG 1/2018 Anexa 1, cl. 48.4 (paragraful final); `REQ-P1-054` HG 1/2018 Anexa 1, cl. 48.6; `REQ-P1-055` HG 1/2018 Anexa 1, cl. 48.7
- **Precedente CNSC:** —

> **Întrebare (text extern):** Durata de execuție este de [N] luni. Subclauza 48.2 din condițiile generale prevede prețuri ferme pentru durate de cel mult 365 de zile, iar art. 222^2 alin. (9) din Legea nr. 98/2016 prevede clauze de ajustare pentru contractele de lucrări cu durată mai mare de 6 luni. Vă rugăm să precizați clauza de ajustare aplicabilă: formula, indicii și sursa lor, ponderile, termenul fix și data de referință, precum și dacă se aplică subclauza 48.8 privind modificările legislative publicate după data de referință.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Risc de inflație pe materiale/manoperă. Creșteri legislative de cost neacoperite. · risc — Scăzut.
- **Notă:** Contradicție internă identificată în runda 2 (HG 1/2018 cl. 48.2 vs L98 art. 222^2 alin. (9)). Contopit cu: Data de referință și ajustarea pentru modificări legislative (ex. salariul minim). v1.1: REQ-P1-003 (verificat, încredere medie) confirmă contradicția cl. 48.2 vs L98 art. 222^2 alin. (9) și prioritatea legii (HG 1/2018 art. 4); interpretare proprie, fără practică CNSC. Ajustarea nu se aplică lucrărilor evaluate pe bază de Cost (REQ-P1-052); indicii se îngheață la Recepția la Terminare (REQ-P1-054). Salariile minime din CCM: PAT-CTC-06.

### PAT-CTC-02
**Formula de ajustare folosește indici nepublicați (ex. ICCplr) sau preluați din OUG 64/2022**  · încredere ridicata · vechi: CL-D07

- **Trigger:** formula conține 'ICCplr', 'ICCmlr' sau trimite la art. 17 OUG 64/2022 pentru un contract nou _(caută în: contract; detecție: cuvant_cheie)_
- **Documente de verificat:** Acord contractual; Fișa de date
- **Cerințe:** `REQ-AD-081` 406/C?/... (anonimizat, BO2023_406) motivare (L98 art. 212 alin. (1) lit. c), art. 222; OUG 64/2022 art. 17); `REQ-AD-078` Legea 98/2016 art. 222^2 alin. (2)–(3); `REQ-AD-116` OUG 64/2022 art. 17 alin. (1); `REQ-AD-117` OUG 64/2022 art. 17 alin. (4) și alin. (8) lit. a1); `REQ-AD-119` INS — Buletin Statistic de Prețuri (lunar), tabel 15 / 15A Buletin Statistic de Prețuri, tabelul 15 (ICC total și pe elemente de cost) și tabelul 15A (ponderi); `REQ-P1-057` OG 15/2021 art. 2 alin. (5)–(7); `REQ-P1-062` INS — Buletin Statistic de Prețuri (lunar), tabel 15 / 15A HG 1/2018 Anexa 1 cl. 48.4–48.5 („aplicabil la data cu 60 de zile înainte de ultima zi a lunii n”); OUG 64/2022 art. 17 alin. (8) (text citat în BO2023_406); `REQ-P1-064` 406/C?/... (anonimizat, BO2023_406) motivare, p. 8–9 (analiza art. 17 alin. (8) lit. a1) OUG 64/2022 și Anexa 4); `REQ-P1-065` 406/C?/... (anonimizat, BO2023_406) motivare, p. 2 și p. 9 (răspunsul INS); `REQ-P1-066` 406/C?/... (anonimizat, BO2023_406) motivare, p. 9 (redare OUG 64/2022 art. 1 alin. (3))
- **Precedente CNSC:** BO2023_406

> **Întrebare (text extern):** Formula de ajustare din [contract, art. / subclauza …] utilizează indicele [denumire]. Vă rugăm să precizați sursa oficială și tabelul în care este publicat lunar acest indice și, dacă acesta nu este publicat, indicele care îl înlocuiește.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Ajustare imposibil de calculat. · risc — Procedura poate fi anulată (BO2023_406).
- **Notă:** Corectură runda 1: CL-D07 trimitea la „art. 164 HG 395/2016” — abrogat în 2023; temeiul curent e L98 art. 222^2. ICCplr nepublicat de INS din 03.2022; BO2023_406 — nuanță: formula OUG 64 art. 17 alin. (8) lit. a1) privește contractele în derulare, nu contractele noi. v1.1: confirmat de REQ-P1-064/065/066 (din BO2023_406, verificate): ICCplr există doar în Anexa 4 a OUG 64/2022 (ultima lună febr. 2022), INS nu îl publică; pentru proceduri noi OUG 64 permite doar actualizarea VE cu ICC total. Tabelele INS exacte (REQ-P1-061/063) rămân neverificate — nu se citează.

### PAT-CTC-03
**Penalitățile de întârziere nu sunt stabilite (se aplică valoarea implicită din cl. 36.4)**  · încredere ridicata · vechi: CL-D02

- **Trigger:** acordul contractual nu precizează cuantumul penalităților de întârziere _(caută în: contract; detecție: camp_lipsa)_
- **Documente de verificat:** Acord contractual
- **Cerințe:** `REQ-AD-096` HG 1/2018 Anexa 1, cl. 36.4; `REQ-AD-097` HG 1/2018 Anexa 1, cl. 36.5; `REQ-AD-114` HG 1/2018 Anexa 2, cl. 36.4 și cl. 48.2–48.5; `REQ-P1-015` HG 1/2018 Anexa 1, cl. 36.3; `REQ-P1-016` HG 1/2018 Anexa 1, cl. 36.4 (teza finală) și cl. 59.4; `REQ-P1-017` HG 1/2018 Anexa 1, cl. 36.6
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați în Acordul Contractual cuantumul penalităților de întârziere pe zi (ca procent din prețul contractului sau din valoarea lucrărilor rămase de executat), întrucât, în lipsa acestei mențiuni, subclauza 36.4 conduce la o valoare zilnică egală cu Prețul Contractului împărțit la Durata de Execuție, plafonată la 15 %.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Expunere zilnică foarte mare. · risc — Scăzut.
- **Notă:** v1.1: după recepția/utilizarea unei părți, penalitatea și plafonul de 15 % se calculează pe prețul rămas (REQ-P1-016); penalitățile de întârziere sunt singurele datorate pentru întârziere (REQ-P1-017); milestones → reținere 10 % (REQ-P1-015).

### PAT-CTC-04
**Avansul — acordare, cuantum și modul de recuperare**  · încredere ridicata · vechi: CL-D04

- **Trigger:** acordul contractual nu precizează avansul sau varianta de justificare (cl. 46.6 / 46.7) _(caută în: contract, fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Acord contractual
- **Cerințe:** `REQ-AD-098` HG 1/2018 Anexa 1, cl. 46.6; `REQ-AD-099` HG 1/2018 Anexa 1, cl. 46.7; `REQ-P1-012` HG 1/2018 Anexa 1, cl. 46.1–46.3; `REQ-P1-013` HG 1/2018 Anexa 1, cl. 46.4–46.5; `REQ-P1-014` HG 1/2018 Anexa 2, cl. 46.7
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați dacă se acordă avans, cuantumul și numărul tranșelor, precum și varianta de justificare aplicabilă (subclauza 46.6 sau subclauza 46.7 din condițiile generale).

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — Flux de numerar. · risc — Scăzut.
- **Notă:** v1.1: avansul se plătește după Data de Începere, cu GBE și garanție de returnare (REQ-P1-012); la P+E, implicit două tranșe (Anexa 2 cl. 46.7, REQ-P1-014).

### PAT-CTC-05
**Contract cu prețuri unitare sau cu preț global — modul de plată a cantităților**  · încredere ridicata · vechi: —

- **Trigger:** DA nu precizează dacă se plătesc cantitățile măsurate (cl. 49.1) sau un preț forfetar _(caută în: contract, fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Acord contractual; Fișa de date
- **Cerințe:** `REQ-AD-107` HG 1/2018 Anexa 1, cl. 49.1; `REQ-P1-056` HG 1/2018 Anexa 2, cl. 49.1; `REQ-P1-035` HG 1/2018 Anexa 1, cl. 50.1
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați dacă contractul este cu prețuri unitare, cu plata cantităților efectiv executate și măsurate (subclauza 49.1 din condițiile generale), sau cu preț global.

- 🔒 **Impact intern (nu se trimite):** tehnic — — · cost — La preț global, diferențele de cantitate rămân la executant. · risc — Scăzut.
- **Notă:** v1.1: la P+E (Anexa 2 cl. 49.1) prețul fără Sume Provizionate e forfetar, plătit după Graficul de Eșalonare (REQ-P1-056).

### PAT-CTC-06
**Clauze privind salariile minime din contractele colective de muncă (Legea 283/2024)** · ⚖️ review juridic · încredere medie · vechi: —

- **Trigger:** modelul de contract nu conține clauza privind plata salariului minim brut și a salariilor minime din CCM, sau o conține fără să indice CCM de referință, modul de verificare și efectul modificării salariilor după data de referință _(caută în: contract, fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Model de contract; Fișa de date; Clauza de ajustare / modificări legislative
- **Cerințe:** `REQ-P0-060` Legea 283/2024 art. XI alin. (1); `REQ-P0-061` Legea 283/2024 art. XI alin. (3); `REQ-P0-062` Legea 283/2024 art. XI alin. (5); `REQ-P0-063` Legea 283/2024 art. XI alin. (4), (7); `REQ-P0-064` Legea 98/2016 art. 223 alin. (1) lit. c)
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați: (a) clauza din contract prin care contractantul și subcontractanții garantează plata salariului minim brut și a salariilor minime din contractele colective de muncă (art. XI alin. (5) din Legea nr. 283/2024) și contractul colectiv de muncă avut în vedere; (b) documentele prin care se verifică respectarea acestei obligații pe durata execuției; (c) dacă modificarea salariilor minime după data de referință se tratează prin clauza de ajustare sau prin clauza privind modificările legislative.

- 🔒 **Impact intern (nu se trimite):** tehnic — Raportare lunară privind salariile proprii și ale subcontractanților. · cost — Costul manoperei la nivelul minim din CCM; risc de cost necompensat la creșteri de salariu. · risc — Mediu: condamnarea definitivă pentru încălcări salariale → excludere 2 ani (REQ-P0-061); încălcarea clauzelor → excludere 1–2 ani (REQ-P0-063).
- **Notă:** v1.1 (nou): Legea 283/2024 art. XI verificată (încredere medie). Corelare cu PAT-CTC-01 (ajustare) și cu justificarea prețului (PANS: manopera sub salariul minim).

### PAT-CTC-07
**Asigurările executantului: CAR și răspunderea civilă pentru vicii ascunse 10 ani (Legea 169/2026)** · ⚖️ review juridic · încredere medie · vechi: —

- **Trigger:** contractul cere „asigurările prevăzute de lege” fără sumă, durată sau moment de prezentare, sau nu menționează asigurarea de răspundere civilă pentru vicii ascunse introdusă de Legea 169/2026 _(caută în: contract, fisa_de_date; detecție: camp_lipsa)_
- **Documente de verificat:** Model de contract / Condiții speciale; Fișa de date
- **Cerințe:** `REQ-P1-083` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 451 alin. (3); `REQ-P1-084` Legea 169/2026 — Codul amenajarii teritoriului, urbanismului si constructiilor (CATUC) art. 556 alin. (4), (5), (7), (8) (atribuire dedusă — alin. (3)–(8) apar după art. 556 alin. (2) în paginarea pe coloane); `REQ-P0-094` Ordin ANRE 7/2022 anexa 5, art. 23
- **Precedente CNSC:** —

> **Întrebare (text extern):** Vă rugăm să precizați asigurările pe care executantul trebuie să le încheie și să le prezinte (asigurarea lucrărilor de construcții-montaj și asigurarea de răspundere civilă pentru vicii ascunse prevăzută de Legea nr. 169/2026), suma asigurată minimă, perioada de valabilitate, momentul prezentării și dacă costul acestora se include în prețul ofertei sau se decontează separat.

- 🔒 **Impact intern (nu se trimite):** tehnic — Contractare poliță la începerea lucrărilor. · cost — Prime de asigurare pe 10 ani — piață neverificată. · risc — Scăzut la ofertare; ridicat la începerea lucrărilor dacă polița nu se obține.
- **Notă:** v1.1 (nou): REQ-P1-084 e verificat, dar cu încredere medie (numărul articolului — art. 556 — trebuie reconfirmat pe forma consolidată); de aceea întrebarea citează legea fără articol. Răspunderea pentru vicii ascunse 10 ani (art. 451 alin. (3), REQ-P1-083) e verificată.

## Changelog

Catalog tipare de clarificări — v1.1 (changelog)

**Fișier:** `lucru/clarificari_tipare_v11.json` — catalogul complet, cu aceeași schemă ca v1.0. Are 82 de tipare: 63 existente și 19 noi. Scriptul care îl generează și îl validează este `lucru/build_v11.py`.

## Ce s-a schimbat
- **Tiparele existente.** Am adăugat 247 de trimiteri la cerințe (în total sunt folosite 166 de cerințe REQ-P0/P1/P2 distincte) și 95 de precedente CNSC. Din cele 37 de decizii noi au fost folosite 36. BO2026_76 (OUG 41/2025, anulare la apă-canal) nu e relevantă pentru clarificări. Fiecare modificare are în `note` o mențiune care începe cu „v1.1:”.
- **Încredere crescută la 14 tipare:**
  - CTR-03, INF-05, AMB-03, STD-05/06/07/08/11, CAL-04, CAL-11 și GAR-03 au trecut de la medie la ridicată;
  - INF-10, CAL-09 și CAL-13 au trecut de la scăzută la medie.

  La AMB-03 am scos și cerința de revizuire juridică, pentru că P91 pct. 2.2.3 și 3.3.1.5 sunt acum verificate.
- **Divergențe notate (rămân cu revizuire juridică):**
  - **CAL-02:** BO2024_3288 contrazice BO2024_3232 și BO2022_2768, iar BO2021_973 complică tabloul. Încrederea rămâne medie.
  - **AMB-02:** BO2024_2683 aplică plafonul de 40 % pentru preț la proiectare și execuție (P+E) pe gaze, deși HG 395 art. 32 alin. (6) (REQ-P0-047) restrânge regula.
  - **TRM-01:** practica pe graficul Gantt e împărțită: BO2022_2053 pe de o parte, BO2024_717, BO2022_2768 și BO2025_1775 pe de alta.
  - **AMB-01:** BO2024_632 aduce o nuanță față de BO2024_3657.
  - **CAL-14:** BO2020_2191 contrazice BO2024_1529.
- **Corecturi:**
  - **TRM-03 și GAR-06:** plafonul cauțiunii este 2.000.000 lei (REQ-P0-001), nu 880.000 lei (REQ-AD-085).
  - **STD-08:** abrogarea Legii 10/1995 și a Legii 50/1991 are acum temei verificat (REQ-P1-074 și REQ-P1-098).
- **19 tipare noi:**

  | Tipar | Subiect |
  |---|---|
  | CTR-04 | Cerință de calificare care apare doar în caietul de sarcini |
  | INF-13 | Racordare după Ord. ANRE 7/2022 și convenția tehnică |
  | INF-14 | Recepții parțiale după L169/2026 |
  | AMB-09 | Contractul colectiv de muncă folosit ca factor de evaluare |
  | AMB-10 | Articole asimilate în deviz (BO2024_696) |
  | AMB-11 | Proceduri tehnice cerute „pentru toate categoriile” |
  | CTC-06 | Salariile minime din CCM (Legea 283/2024) |
  | CTC-07 | Asigurarea pentru vicii ascunse pe 10 ani (L169/2026) |
  | GAR-05 | Sume reținute aplicate doar la reținerile succesive |
  | GAR-06 | Cauțiunea (verificare internă) |
  | TRM-04 | Termenele din Ord. ANRE 7/2022 art. 37 |
  | TRM-05 | Termene de clarificare suprapuse peste sărbători (BO2025_286) |
  | STD-12 | Izolație „foarte întărită” = bitum, față de 3LPE (NTPEE art. 259 alin. (3)) |
  | CAL-14 | Autorizare AFER la subtraversări de cale ferată |
  | CAL-15 | Autorizare ANRE cerută managerului de proiect |
  | CAL-16 | DUAE (verificare internă) |
  | CAL-17 | Cerințe proporționale în asociere |
  | CNT-05 | Lățimea de refacere a drumului |
  | CNT-06 | Săpătură manuală sau mecanizată și sprijiniri |

## Verificări programatice (toate trecute)
- **Cerințe:** toate trimiterile REQ există în `registru_cerinte.json`.
- **Precedente:** toate trimiterile SRC-CNSC există. Patru dintre ele (BO2025_647, BO2018_6476, BO2024_696 și BO2025_2863) apar doar în `registru_surse.json`, nu și în `cnsc_practica.json`.
- **Citări în întrebări:** nicio întrebare nu citează un act care are în `normative_refs` doar cerințe neverificate. Nu există nici citări „mixte”, adică acte care au în același tipar și cerințe verificate, și cerințe neverificate. Actele modificatoare care apar în întrebări (de exemplu HG 1347/2022, HG 965/2023, Ord. ANRE 85/2024) sunt acoperite de locatorii unor cerințe verificate.
- **Format:** cheile sunt identice cu schema v1.0, iar JSON-ul trece validarea cu `json.tool`.

**Rămân deschise:** art. 8 din Legea 101/2016 (termenele de 7 și 10 zile) și plafoanele cauțiunii sub prag nu sunt reverificate. La CTC-07, numărul articolului 556 din L169/2026 trebuie reconfirmat.
