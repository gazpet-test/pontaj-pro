# Execuție — dosarul de revendicare: specificație (pașii 1 și 2)

Stare: **PROPUNERE** (runda 2 după review, 15.11.2026). Schema e în `supabase/migrations/20261224a_executie_revendicari.sql`, **NEAPLICATĂ**. Activarea în producție (schemă +
drepturi) cere aprobarea owner-ului. Nimic din acest pas nu trimite documente, nu generează fișiere și nu atinge date.

Ce acoperă: dosarul de revendicare pornit de managerul de proiect (MP) când apare o problemă pe șantier, actele succesive (notificare,
detalieri, răspunsuri, dezacord, acord), termenele cu sursa și confirmarea lor, dovezile din platformă, jurnalul nemodificabil.
Ce NU acoperă (pașii următori): ecranul, șablonul / exportul DOCX, cronul de alerte, importul hărții contractului, AI.

Repo-ul e public: aici nu apar nume de persoane, numere de contract sau valori din contracte. Clauzele se numesc generic
(„clauza de notificare”, „clauza de detaliere”, „clauza de dezacord”); textul contractului stă în fișa contractului din platformă, nu în repo.

## 1. Principii

1. **Platforma semnalează, omul decide.** Nimic nu se trimite automat. „Transmis” se înregistrează doar de om, după transmiterea reală,
   cu data și (de preferat) dovada. Exportul, aprobarea sau semnarea NU înseamnă transmitere.
2. **Necunoscut ≠ zero.** Zile, sume, date lipsă rămân `NULL` și se afișează „necunoscut”; un termen fără date confirmate nu devine „azi”.
3. **Trei stări separate** pe dosar și pe acte: etapa procedurală (unde e procedura), riscul juridic (evaluarea omului) și starea fiecărui
   act (ciornă → aprobat → semnat → transmis). „Eveniment continuu”, „așteaptă răspuns” și „risc de decădere” pot exista simultan.
4. **„Decăzut” nu se setează niciodată automat.** La depășirea unui termen platforma arată „termen depășit / risc de decădere”.
   Constatarea decăderii e o decizie umană motivată (owner sau administrator Execuție), pe riscul juridic al dosarului.
5. **Doar sursele confirmate alimentează calculul.** Un termen calculat are nevoie de o regulă confirmată, legată de un reper al fișei
   contractului confirmat la o versiune anume, și de un declanșator confirmat. Orice schimbare a sursei invalidează confirmarea.
6. **Zile calendaristice; termenele curg de la transmitere** (decizia existentă a owner-ului). Unde textul contractului vorbește de
   primire, regula se configurează cu declanșatorul „primirea actului”; diferența e o întrebare pentru avocat (§8, N2).

## 2. Fluxul dosarului

```
 eveniment ──notificare transmisă──► notificat ──detaliere inițială transmisă──► detaliere_initiala
     │                                  │                                           │
     └──────► retras ◄──────────────────┘                    ┌──────────────────────┼─────────────────────────┐
                                                             ▼                      ▼                         ▼
                                          detaliere_interimara (eveniment continuu) ─► detaliere_finala ─► asteapta_raspuns
                                                                                                            │      │
                                                    raspuns_primit ◄── răspuns primit ──────────────────────┘      │ tăcere = respingere
                                                      │        │                                                    ▼
                                                      │        └────────── dezacord transmis ─────────────────► dezacord
                                                      └─ acord ──► acord ◄─────────────────────────────────────────┘
                                                                     └──► inchis (administrare) ◄── dezacord
```

Tranzițiile sunt O SINGURĂ listă, `fn_executie_revendicare_tranzitii()` (din, spre, nivel, actul cerut, motiv obligatoriu); CHECK-ul
coloanei `etapa` e generat din ea (L20). O tranziție cu „act cerut” trece doar dacă dosarul are un act de acel tip **transmis** (ieșire) /
**primit** (intrare) — etapa reflectă faptele înregistrate, nu o bifă.

| Din | Spre | Nivel | Cere | Motiv |
|---|---|---|---|---|
| eveniment | notificat | scriere | notificare transmisă | – |
| eveniment / notificat | retras | scriere | – | da |
| notificat | detaliere_initiala | scriere | detaliere inițială transmisă | – |
| detaliere_initiala | detaliere_interimara | scriere | detaliere interimară transmisă | – |
| detaliere_initiala / detaliere_interimara | detaliere_finala | scriere | detaliere finală transmisă | – |
| detaliere_initiala | asteapta_raspuns | scriere | – (eveniment punctual: detalierea inițială e și finală) | da |
| detaliere_finala | asteapta_raspuns | scriere | – | – |
| asteapta_raspuns | raspuns_primit | scriere | răspuns al beneficiarului primit | – |
| asteapta_raspuns / raspuns_primit | dezacord | scriere | dezacord transmis | – |
| raspuns_primit / dezacord | acord | scriere | act de acord (transmis sau primit) | – |
| asteapta_raspuns / raspuns_primit / dezacord / acord | inchis | administrare | – | da |
| detaliere_* / asteapta_raspuns / raspuns_primit / dezacord | retras | administrare | – | da |

`inchis` și `retras` sunt finale: un dosar închis nu se mai modifică prin NICIUN RPC (dosar, risc — inclusiv decăderea —, legături,
acte, stări, comunicări, termene, confirmări, dovezi); redeschiderea ar fi o tranziție nouă, de decis.
Detalierile interimare repetate nu schimbă etapa: fiecare e un act nou, cu termenul ei.

**Riscul juridic** (`risc_juridic`): `neevaluat` → `scazut` / `mediu` / `ridicat` (scriere, motiv opțional) și `decadere_constatata`
(DOAR administrare, motiv obligatoriu; ieșirea din ea tot administrare + motiv). Nicio funcție, trigger sau cron nu îl scrie altfel
(postcondiție în migrare).

**Actele** (`executie_revendicare_acte`): tipurile notificare, detaliere_initiala / _interimara / _finala, cerere_prelungire_detaliere,
dezacord (ieșire); raspuns_beneficiar, raspuns_prelungire, decizie (intrare); acord, alt (oricare sens). Cererea de prelungire a
**termenului detalierii** e un act distinct de solicitarea prelungirii **duratei lucrărilor** (aceasta din urmă e conținutul unei detalieri).

| Sens | Din | Spre | Nivel | Condiție |
|---|---|---|---|---|
| ieșire | ciorna | de_aprobat | scriere | – |
| ieșire | de_aprobat | ciorna | scriere | – |
| ieșire | de_aprobat | aprobat | **aprobare** | dosarul are cel puțin un reper „temei” activ și **toate** temeiurile active sunt confirmate și valabile; aprobarea fixează revizia, conținutul și **setul de surse** (vezi mai jos) |
| ieșire | aprobat | ciorna | scriere | aprobarea cade, revizia crește |
| ieșire | aprobat | semnat | scriere | exemplarul semnat (document din proiect, cu SHA-256); aprobarea încă valabilă: aceeași revizie, același conținut, aceleași surse, încă valabile |
| ieșire | semnat → transmis, transmis → transmis | – | scriere | DOAR prin înregistrarea unei comunicări (destinatar, canal, data transmiterii ≤ azi) |
| intrare | ciorna → primit, primit → primit | – | scriere | DOAR prin comunicare (data primirii ≤ azi) |
| oricare | ciorna / de_aprobat → anulat | – | scriere | motiv |
| oricare | aprobat / semnat / transmis / primit → anulat | – | administrare | motiv |

Conținutul (titlu, rezumat, cronologie, temei, argumentare, zile solicitate, sume a/b/c, monedă, numere) se editează DOAR în ciornă.
Ieșirea din „aprobat” spre ciornă crește revizia și șterge aprobarea: aprobarea nu se transferă pe altă versiune. Cuantificarea
(zile, sume) are confirmarea ei, care se pierde la orice salvare fără bifă.

**Sursele aprobate (runda 2).** Sursele contractuale ale actelor unui dosar = legăturile „temei” active ale dosarului. La aprobare se
fixează amprenta setului concret (`aprobat_surse_amprenta`: fiecare legătură, reperul ei, versiunea și amprenta conținutului reperului
confirmate de administrare). Aprobarea rămâne valabilă (`fn_executie_revendicare_act_aprobare_valida`, aceeași funcție la semnare și
în vedere, coloana `aprobare_valida`) doar cât revizia, conținutul și amprenta setului sunt cele aprobate și toate temeiurile sunt încă
valabile. Orice schimbare a surselor — reper modificat în fișă (chiar dacă administrarea îl reconfirmă), temei adăugat, scos sau
reconfirmat pe altă versiune — cere **reaprobarea**: ciornă (revizia crește) → de aprobat → aprobat. Doar legăturile „temei” intră în
set (nu și cele „termen”, „procedură” etc., care alimentează termenele, nu textul actului). Înregistrarea transmiterii unui act deja
semnat NU e blocată de o sursă schimbată (transmiterea e un fapt petrecut); vederea arată `aprobare_valida = false`.

**Comunicările** (`executie_revendicare_comunicari`) țin separat, pe fiecare destinatar: data transmiterii, data primirii (dacă se
cunoaște), numărul de înregistrare, dovada. Se completează doar câmpurile goale; o corectură = anulare (administrare, motiv) + comunicare
nouă. Dacă toate comunicările unui act sunt anulate, actul revine la „semnat” (ieșire) / „ciornă” (intrare).

## 3. Matricea de acces (alegerea 1, varianta A presupusă)

O singură definiție: `fn_executie_revendicare_drept(proiect, nivel)`, folosită de RLS și de fiecare RPC (L19). Nivelurile:
`citire`, `scriere`, `administrare`, `aprobare`.

| Cont | citire | scriere | administrare | aprobare |
|---|---|---|---|---|
| Owner (`profiles.is_owner`) | toate | toate | toate | **da** |
| Administrator Execuție (`user_module_access` executie = admin) | proiectele permise | proiectele permise (scriere) | proiectele permise (scriere) | nu |
| MP desemnat (`profiles.employee_id` = `executie_proiecte.mp_employee_id`) + orice nivel pe modulul Execuție | proiectul lui, dacă e permis | proiectul lui, dacă e permis la scriere | nu | nu |
| Alt editor / viewer Execuție, alt modul, cont fără drept | nimic | nimic | nimic | nimic |
| Anonim | nimic (fără EXECUTE, fără SELECT) | – | – | – |

„Permis” = restricția pe proiect din 20261209a (`fn_executie_proiect_permis`): un cont restrâns vede / scrie doar proiectele din lista lui
(viewer = doar citire). MP-ul confirmă faptele (declanșatori, date ale actelor, comunicări, dovezi, cuantificări); NU confirmă reguli,
termene manuale, nu constată decăderea și nu aprobă documente.

Ce se verifică la fiecare referință (L09): reperul din fișa contractului, documentul (`documente_proiect`), ordinul de sistare
(`executie_ordine_sistare`), raportul zilnic (`rapoarte_zilnice` → `sites.proiect_id`), exemplarul semnat și dovada comunicării trebuie
să fie ale **proiectului dosarului**; actele / termenele / legăturile referite trebuie să fie ale **aceluiași dosar**. Inexistent și
„al altui proiect” dau același refuz (42501). Proiectul se compară înainte de lock, apoi se reverifică sub lock (un rând ocupat al altui
proiect nu dă alt cod de eroare).

Scrierea directă în tabele: interzisă tuturor rolurilor aplicației (fără INSERT / UPDATE / DELETE). Citirea: RLS pe fiecare tabel, cu
predicatul unic; tabelul cheilor de idempotență: fără niciun drept.

## 4. Termenele

Un termen (`executie_revendicare_termene`) are:

| Ce | Coloane | Cine scrie / confirmă |
|---|---|---|
| obligația | `tip_obligatie` (notificare, detaliere_*, raspuns_prelungire, raspuns_principiu, dezacord, alt) | scriere |
| modul | `mod` = `regula` (calculat) / `manual` (dată introdusă, etichetată manual) | scriere |
| regula | `reper_legatura_id` (clauza din fișa contractului), `nr_zile` (1–3650 sau NULL = necunoscut), `declansator_tip` | scriere; **confirmarea regulii: administrare**, doar dacă legătura cu reperul e confirmată și valabilă |
| declanșatorul | `declansator_tip`, `declansator_data`, `declansator_act_id` / `declansator_termen_id` | scriere; confirmarea: scriere, doar dacă data e egală cu sursa ei de acum și (la `expirare_termen`) lanțul precedentelor e valabil |
| data propusă | `data_propusa` | **doar serverul** (trigger): `declansator_data + nr_zile` când regula și declanșatorul sunt confirmate și ambele valori cunoscute; altfel NULL |
| data confirmată | `data_confirmata`, `confirmat_de`, `confirmat_la`, `justificare` | regulă: scriere, DOAR egală cu data propusă; manual: **administrare**, justificare obligatorie |
| starea | `stare` (deschis / indeplinit / anulat), `indeplinit_act_id`, `stare_motiv` | îndeplinit: scriere, doar cu actul **compatibil** al dosarului, transmis / primit și neanulat (tabelul de mai jos); anulat / redeschis: administrare + motiv |

Declanșatoarele (nu toate pornesc din data evenimentului):

| `declansator_tip` | Sursa datei (verificată la confirmare și la fiecare citire) |
|---|---|
| `data_eveniment` / `data_constatare` / `data_incetare` | câmpul respectiv al dosarului |
| `transmitere_act` | prima transmitere neanulată a actului (`declansator_act_id`) |
| `primire_act` | prima primire neanulată a actului |
| `expirare_termen` | data confirmată a altui termen al dosarului (ex.: dezacordul după expirarea termenului de răspuns), **cu tot lanțul lui valabil** |
| `alt` | data introdusă (confirmarea o asumă omul) |

Invalidări automate (trigger, pe orice cale de scriere): schimbarea regulii (mod, obligație, declanșator, zile, legătura) → cade confirmarea
regulii; schimbarea declanșatorului → cade confirmarea declanșatorului; data propusă schimbată → cade data confirmată; la termenul manual,
schimbarea justificării → cade data confirmată. La citire (vederea `v_executie_revendicare_termene`), un termen „regulă” a cărui sursă s-a
schimbat (reperul din fișă la altă versiune, legătura scoasă, data declanșatorului diferită de sursă) apare „sursa_de_reverificat”.

**Lanțul termenelor (runda 2).** Un termen „regulă” cu declanșatorul `expirare_termen` depinde de termenul precedent, iar acesta poate
depinde, la rândul lui, de altul. Validitatea (`fn_executie_revendicare_termen_intrari_valide`) = intrările locale ale termenului
(`…_intrari_locale`) **și** tot lanțul (`…_lant_valid`): fiecare precedent e în același dosar, neanulat și cu intrările locale valabile.
Lanțul se urmează doar prin termenele „regulă” (data unui termen manual e asumată de administrare). Consecințe: un precedent cu sursa
schimbată face și dependentul „sursa_de_reverificat”, chiar dacă precedentul își păstrează data confirmată; confirmarea declanșatorului
pe un precedent invalid sau anulat e refuzată; confirmarea datei cere tot lanțul valabil. **Ciclurile** (A depinde de B, B de A, oricât
de lung) și precedentul din alt dosar sunt refuzate de trigger pe orice cale de scriere; un ciclu creat ocolind trigger-ul (administratorul
bazei) dă „invalid”, iar parcurgerea se termină.

**Îndeplinirea (runda 2).** O singură listă a compatibilităților obligație – act (`fn_executie_revendicare_obligatie_acte`, din care e
generat și CHECK-ul coloanei `tip_obligatie`) și o singură funcție a îndeplinirii (`fn_executie_revendicare_indeplinire_la`), folosite de
RPC-ul „îndeplinit” și de vedere:

| Obligația | Se îndeplinește cu |
|---|---|
| notificare / detaliere_initiala / detaliere_interimara / detaliere_finala / dezacord | actul de ieșire de **același tip**, transmis |
| raspuns_prelungire (al beneficiarului) | actul de intrare `raspuns_prelungire`, primit |
| raspuns_principiu (al beneficiarului) | actul de intrare `raspuns_beneficiar` sau `decizie`, primit |
| alt | actul `alt` (ieșire transmis / intrare primit) |

Data îndeplinirii = prima transmitere (ieșire) / primire (intrare) neanulată a unui act neanulat, în starea transmis / primit. Dacă actul
e anulat, toate comunicările lui sunt anulate sau perechea nu mai e compatibilă, data e NULL și termenul apare „indeplinit_de_verificat”.
Un act anulat nu mai dă nici data de transmitere / primire (nici pentru declanșatori).

Calendarul candidat (de confirmat pe contractul aplicabil; **nu e implicit în schemă**, fiecare termen se configurează):

| Obligație | Declanșator propus | Zile |
|---|---|---|
| Notificare | apariția evenimentului (`data_eveniment`) | 30 |
| Prima detaliere | transmiterea notificării | 30 |
| Actualizare interimară | transmiterea detalierii anterioare (fiecare interimară e un termen nou) | 30 |
| Detaliere finală | încetarea evenimentului (`data_incetare`) | 30 |
| Răspuns la cererea de prelungire a detalierii | transmiterea cererii | 5 |
| Răspuns în principiu | transmiterea detalierii finale (textul spune „primire”: vezi N2) | 30 |
| Dezacord | respingerea / expirarea răspunsului / decizia | 10 |

Starea calculată (o singură funcție, `fn_executie_revendicare_termen_stare`, folosită de vedere, de viitorul cron și de UI, L19), în
ordinea priorității: `anulat`; `sursa_de_reverificat` (runda 2: ÎNAINTEA îndeplinirii — o sursă invalidă face nesigură și data față de
care se judecă îndeplinirea); `indeplinit` / `indeplinit_tardiv` / `indeplinit_termen_necunoscut` / `indeplinit_de_verificat`
(îndeplinire nevalabilă, vezi mai sus); fără dată confirmată: `necunoscut` / `neconfirmat` / `neconfirmat_depasit`; cu dată confirmată:
`in_termen` / `scadent_azi` / `depasit_risc_decadere`. **Nu există starea „decăzut”.**

„Azi” = data calendaristică din `Europe/Bucharest` (`fn_executie_revendicare_zi(moment)`), nu `CURRENT_DATE` în UTC. Un termen cu data
D e „scadent azi” până la 23:59:59 ora României din ziua D și „depășit” de la 00:00 a zilei D+1. Regula de numărare folosită: termenul
= D + N zile calendaristice (ziua declanșatorului nu se numără; ultima zi intră integral). Prelungirea când ultima zi e nelucrătoare
NU se aplică (necunoscută 4): motorul nu adaugă zile din oficiu.

O cerere de prelungire NU mută termenul: mutarea cere un termen nou (sau o dată manuală, de administrator, cu justificare). Un act tardiv
nu șterge depășirea: termenul apare „indeplinit_tardiv”.

### Cazuri de calcul (valori scrise de mână; testul PGlite le folosește ca literale)

| # | Intrări | Așteptat |
|---|---|---|
| C1 | eveniment 2026-03-10, 30 zile | data propusă 2026-04-09 |
| C2 | transmitere notificare 2026-01-31, 30 zile (2026 nu e bisect) | 2026-03-02 |
| C3 | transmitere 2028-01-31, 30 zile (2028 bisect) | 2028-03-01 |
| C4 | transmitere 2026-12-15, 30 zile (trecere de an) | 2027-01-14 |
| C5 | cerere de prelungire transmisă 2026-11-27, 5 zile | 2026-12-02 |
| C6 | expirarea termenului de răspuns 2026-12-02, 10 zile | 2026-12-12 |
| C7 | zile necunoscute (NULL) | data propusă NULL, stare `necunoscut` (nu „azi”) |
| C8 | regulă confirmată, declanșator neconfirmat | data propusă NULL |
| C9 | declanșator confirmat, regulă neconfirmată | data propusă NULL |
| C10 | termen confirmat 2026-10-31 (ora de iarnă, după 25.10.2026); moment 2026-10-31 21:30 UTC / 22:30 UTC | ziua RO 2026-10-31 → `scadent_azi` / 2026-11-01 → `depasit_risc_decadere` |
| C11 | termen 2026-07-31 (ora de vară); moment 2026-07-31 20:59:59 UTC / 21:00:00 UTC | `scadent_azi` / `depasit_risc_decadere` (în UTC ar fi încă 31.07) |
| C12 | ziua schimbării orei 2026-03-29; momente 2026-03-28 22:00 UTC, 2026-03-29 20:59:59 UTC, 2026-03-29 21:00 UTC | 2026-03-29, 2026-03-29, 2026-03-30 |
| C13 | termen 2026-04-09; act transmis 2026-04-10 / 2026-04-09 | `indeplinit_tardiv` / `indeplinit` |
| C14 | propus 2026-04-09, neconfirmat, azi 2026-04-10 | `neconfirmat_depasit` |
| C15 | manual 2026-05-05 cu justificare, azi 2026-05-05 | `scadent_azi`, mod `manual` |
| C16 | reperul din fișă modificat după confirmare | `sursa_de_reverificat` |
| C17 | confirmarea unei date diferite de cea propusă (2026-04-10 față de 2026-04-09) | refuz |
| C18 | expirarea termenului T0 confirmat 2026-04-09, 10 zile | 2026-04-19 |
| C19 | C18, apoi sursa lui T0 schimbată (T0 își păstrează data 2026-04-09) | T0 și dependentul: `sursa_de_reverificat`; declanșatorul unui termen nou pe data lui T0: refuz |
| C20 | transmiterea notificării înregistrată 2026-03-20 (prin comunicare), 30 zile | 2026-04-19 |
| C21 | primirea răspunsului înregistrată 2026-03-25, 10 zile | 2026-04-04 |
| C22 | termen al notificării 2026-04-09, îndeplinit de notificarea transmisă 2026-03-20; apoi notificarea anulată | `indeplinit`; apoi `indeplinit_de_verificat` |
| C23 | termen de răspuns al beneficiarului 2026-03-24, răspuns primit 2026-03-25 | `indeplinit_tardiv` |
| C24 | termenul detaliere finale „îndeplinit” cu o notificare | refuz |

## 5. Dovezi, jurnal, alerte, idempotență

- **Dovezi** (`executie_revendicare_dovezi`): exact o țintă pe rând — document, ordin de sistare sau raport zilnic — a proiectului
  dosarului, cu rolul probator și amprenta rândului-țintă la momentul legării (o schimbare ulterioară a țintei se vede la comparare).
  Scoaterea = `activ = false` + motiv (nimic nu se șterge). Rapoartele ERP sunt dovezi operaționale; echivalența lor cu jurnalul de
  șantier contractual e **neverificată**.
- **Retenția țintelor = alegere de ARHIVARE (alegerea 7, varianta A presupusă; runda 2).** Cheile străine spre documente, ordine de
  sistare și rapoarte nu au CASCADE și nu există nicio cale de dezlegare. Efectul exact: un document / ordin / raport legat **o dată**
  ca dovadă, ca exemplar semnat al unui act sau ca dovadă a unei comunicări **nu se mai poate șterge niciodată** din modulul lui
  (eroare de cheie străină). Blocarea rămâne și după scoaterea dovezii (`activ = false`), după anularea comunicării sau a actului și după
  închiderea / retragerea dosarului — rândul dovezii rămâne, cu motivul scoaterii, ca istoric. Ștergerea unui astfel de fișier devine o
  decizie separată a owner-ului (preview → „da” → operație pe bază). Varianta B: dezlegare reală (rândul dovezii șters / referința
  golită) de către administrare, cu motiv în jurnal, permisă DOAR înainte să fie transmis vreun act al dosarului care citează dovada; după
  transmitere, retenția rămâne permanentă. B cere un RPC nou și o regulă „actul citează dovada” (azi actele nu au legătură explicită cu
  dovezile). Fiecare cheie străină spre alt tabel are index complet (postcondiție), ca verificarea ei la ștergerea sursei să nu scaneze
  tabelele dosarului (inclusiv rândurile scoase).
- **Jurnal** (`executie_revendicare_jurnal`): un rând pentru fiecare INSERT / UPDATE / DELETE pe tabelele dosarului (trigger AFTER, în
  aceeași tranzacție, pe orice cale), cu rândul înainte / după, autorul (`auth.uid()`) și tranzacția. UPDATE / DELETE / TRUNCATE pe jurnal
  = refuz, inclusiv pentru proprietarul tabelelor. **Limită:** nu e imuabilitate față de administratorul bazei — el poate dezactiva
  trigger-ele (scriptul de concurență din runda 2 chiar făcea asta, la curățenia de pe clonă; cel din runda 3 lucrează pe o bază de unică
  folosință, ștearsă întreagă la final, deci nu mai atinge trigger-ele).
- **Confidențialitatea fișierelor:** RLS-ul dosarului protejează rândurile dosarului, nu fișierele legate. Documentele (`documente_proiect`
  și bucketurile lor) rămân protejate DOAR de politicile modulului lor; cine le vede acolo le vede și fără dosar. Exemplarul semnat în
  Storage cu politica dosarului vine la pasul 5.
- **Alerte** (`executie_revendicare_alerte`): doar structura (pasul 4 o umple, cu cronul): termen + versiunea lui, prag (7z / 3z / 1z /
  scadent / depășit / neconfirmat), destinatar, zi; cheie unică de deduplicare. Destinatarul își vede alertele doar dacă mai are acces.
- **Idempotență** (L04/L05): fiecare RPC primește cheia UUID a intenției. Aceeași cheie + același conținut + același cont = rezultatul
  de data trecută (`duplicat: true`, cu rândul de acum); altă operație / alt conținut / alt cont = refuz. Conflictul de versiune (CAS)
  nu consumă cheia. Cheile stau durabil în `executie_revendicare_chei` (fără drepturi pentru aplicație).
- **Ordinea lock-urilor** (L06), aceeași în toate RPC-urile: (1) lock consultativ pe cheie → (2) dosarul `FOR UPDATE` (dreptul verificat
  înainte ȘI reverificat după lock, L01: o desemnare / permisiune retrasă cât apelul aștepta = refuz 42501; proba: K4 din
  `supabase/tests/20261224a_executie_revendicari_concurenta.sh`, pe un cluster PG17 dispensabil, cu mutantul `fara_reverificare`) → (3) rândul-copil
  `FOR UPDATE` (act, apoi comunicare / termen / legătură / dovadă) → (4) la final, rândurile ALTOR module (reper, document, ordin, raport,
  șantier) `FOR SHARE NOWAIT` (ocupat = 55P03, nimic scris) → (5) scrierea + jurnalul + cheia. Revenirea: aceleași tabele, în aceeași
  ordine, `ACCESS EXCLUSIVE NOWAIT`.

## 6. Alegerile owner-ului (presupuse: varianta A) și ce s-ar schimba la B / C

| # | Alegere | Presupus (A) | B | C |
|---|---|---|---|---|
| 1 | Acces | MP desemnat + owner + admin Execuție pe proiectele permise | + responsabilul de contracte al proiectului: o condiție nouă în `fn_executie_revendicare_drept` (și coloana lui pe proiect, dacă nu există) | + citire pentru ceilalți utilizatori Execuție ai proiectului: ramura `citire` a aceleiași funcții. Fără schimbare de tabele |
| 2 | Contracte | un contract pilot; schema nu e legată de o clauză sau de un contract (regulile sunt pe termen, sursa e reperul din fișa proiectului) | celelalte contracte: doar date (fișa fiecărui proiect + termenele) | idem |
| 3 | Numerotare | `nr_iesire` (unic în toată firma) și `nr_beneficiar` (unic pe proiect și sens), introduse manual, verificare de dubluri pe forma canonică | serie automată pe proiect / tip: o funcție nouă care propune numărul; coloanele rămân | registru general de ieșiri: un tabel separat, iar `nr_iesire` devine referință spre el |
| 4 | Timp și bani | zile + sume a/b/c introduse și confirmate manual, NULL = necunoscut | doar timp: UI-ul ascunde sumele; schema neschimbată | calcul detaliat: tabele noi de linii, legate de act; coloanele actuale rămân totalurile |
| 5 | Sursa contractuală | doar repere confirmate (legătura confirmată de administrare, pe versiune) alimentează termenul și aprobarea | documentația de atribuire validată de avocat: alt tip de reper în fișă, aceeași confirmare | doar dosare și ciorne: tranziția `de_aprobat → aprobat` scoasă din listă (o linie) |
| 6 | Validare și semnare | owner-ul aprobă fiecare document; exemplarul semnat se încarcă; aprobarea / exportul ≠ transmitere | reprezentant delegat nominal: nivelul `aprobare` din funcția de drept primește lista delegaților | avocatul verifică fiecare document: o stare în plus (`verificat_juridic`) în lista tranzițiilor actelor |
| 7 | Retenția dovezilor (runda 2) | arhivare: o țintă legată o dată nu se mai șterge din modulul ei (§5) | dezlegare reală de către administrare, cu motiv, doar înainte de transmiterea unui act care citează dovada: RPC nou + legătura act – dovadă | – |

## 7. Ce rămâne în afara schemei (pașii 3–6)

- Importul propus → confirmat al hărții contractului (azi legătura dosar–reper are confirmarea ei; după pasul 3, confirmarea legăturii
  va cere și reperul confirmat în fișă).
- Termenele interimare recurente generate (azi: termen nou, manual sau prin regulă, pentru fiecare actualizare).
- Cronul alertelor, ecranul MP, ciorna DOCX, exemplarul semnat în Storage cu politica dosarului (azi: documentele din `documente_proiect`,
  protejate de politicile lor).
- Inventarul accesului pe proiect din 20261209a (`fn_executie_acces_inventar`) nu cunoaște tabelele noi: scriptul de catalog le va
  lista ca neclasificate. Tabelele noi au propriul predicat, care include restricția pe proiect (clasa „drept”); adăugarea lor în
  inventar = migrare separată.
- Legătura FK spre `documente_proiect`, `executie_ordine_sistare`, `rapoarte_zilnice`: un rând folosit O DATĂ ca dovadă / exemplar semnat
  / dovadă a comunicării nu mai poate fi șters NICIODATĂ din modulul lui (alegerea 7, §5). Efect asupra altor module, de aprobat; mesajul
  de eroare din tabul Documente va fi cel brut al cheii străine până la ecran.
- Livrarea (runda 3): cu plafonul EXTINS (`--plafon-tranzactie-ms 15000 --plafon-extins`, fereastra 21:00–06:00, docs/LIVRARE_L15_V2.md
  §7 / §9) și amprenta globală L15 v2; blocul unic de lock (6 tabele referite, SHARE ROW EXCLUSIVE NOWAIT, bugetul de 1 s de la prima
  încercare). Lista obiectelor din manifest e în repo (`supabase/tests/20261224a_executie_revendicari.l15.obiecte.tsv`, 646 de obiecte:
  cele noi + câte 2 trigger-e interne pe tabelele referite pentru fiecare din cele 15 chei străine spre ele), generată pe PGlite cu pașii
  reali ai runnerului; manifestul cu amprente (`20261224a_executie_revendicari.l15.tsv`) îl generează coordonatorul pe clona PG17, apoi
  proba cu ROLLBACK pe țintă. Revenirea: plafonul 2000, fără amprentă globală (varianta A din §9 a documentului de livrare).
- Regula porților Izometrie (docs/izometrie/PORTI_REGULA.md): migrarea și revenirea scriu tot DDL-ul static (cu numele obiectelor), deci
  nu ating perimetrul porților și trec verificarea CI fără ritualul PRE / ștampile / POST.

## 8. Necunoscute

| # | Necunoscută | Ce presupune schema până la răspuns |
|---|---|---|
| N1 | Regula de numărare a zilelor (ziua inițială, ultima zi nelucrătoare, ora-limită) | D + N calendaristic, fără prelungire; validare juridică înainte să fie prezentat drept termen contractual |
| N2 | „De la transmitere” (decizia owner-ului) față de „de la primire” (textul unor clauze) | declanșatorul se alege pe fiecare termen; implicit transmiterea; primirea se păstrează separat pe comunicare |
| N3 | Ce contract e aplicabil și ce versiune (contract semnat vs. documentație de atribuire) | sursa = reperul din fișa proiectului, confirmat pe versiune; un draft rămâne draft |
| N4 | Efectul tăcerii beneficiarului (respingere tacită) și data de la care curge dezacordul | termenul de dezacord are declanșatorul `expirare_termen`, configurat de om |
| N5 | Echivalența rapoartelor ERP cu jurnalul de șantier contractual | rapoartele sunt dovezi operaționale, nu jurnal contractual |
| N6 | Cine semnează și cu ce delegare | aprobarea = owner; semnatarul real se vede pe exemplarul semnat încărcat |
| N7 | Numerotarea (registru, serie DCC) | manual, cu verificare de dubluri |
| N8 | Formula de rezervă a drepturilor, blocurile juridice ale șablonului | în afara schemei (pasul 5) |
| N9 | Starea reală a dosarelor deja deschise în afara platformei (acte trimise, termene trecute) | se înregistrează manual ca acte + comunicări, cu dovezile; nimic importat automat |
| N10 | MP-ul cu modulul Execuție doar „viewer” | poate scrie în dosarele proiectului lui (dreptul vine din desemnare); de confirmat |
