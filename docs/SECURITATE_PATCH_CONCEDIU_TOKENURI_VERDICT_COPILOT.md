# Verdict Copilot pe #540 (b7ef25b) — 30.09.2026 ~02:50 RO

Text integral, primit prin canalul Copilot (conversația 2) după 210 s. Mesajul trimis: antet (DELTA #538 r3 + cele 4 întrebări) + migrarea și documentul integral (31.119 car.). Testele nu au fost trimise.

---

GO CU CORECTURI pe logica restrângerii accesului direct

Nu este GO de apply și nu închide incidentul tokenurilor. Review static pe b7ef25b; testele și inventarul live sunt dovezi raportate. Traseul de livrare rămâne în runda 4 comună.

1. Predicatul este coerent cu regula UI descrisă, dar aceasta nu stabilește singură accesul legitim

SQL-ul implementează corect regula declarată: owner sau un modul exact hr ori cu prefixul hr.; cele două EXISTS nu acordă acces când UID-ul lipsește. Retragerea privilegiilor și păstrarea doar a SELECT pentru authenticated restrâng accesul direct la tabel, inclusiv pentru ownerul aplicației. service_role rămâne neschimbat în domeniul verificat. (Migrare §2.)

Accept această regulă ca limitare temporară, compatibilă cu UI, numai cu aprobarea explicită a lui Răzvan asupra grupului rezultat. Accesul la pagina HR nu este, prin el însuși, justificare pentru accesul la toate credentialele prin care se poate acționa în numele angajaților. Regula include orice hr.*, orice nivel de acces și conturile de agent care primesc asemenea module.

Corectați în procedură „Deciziile nu sunt condiție pentru patch”: revocarea/reemiterea poate rămâne separată, dar aprobarea matricei de acces țintă este condiție. Un drept distinct pentru distribuirea linkurilor poate veni ulterior; nu cer introducerea lui acum pentru a reduce expunerea generală.

Din cele două fluxuri documentate — butonul HR și edge-ul public — nu identific un actor funcțional cunoscut omis. Nu certific însă inventarul complet al consumatorilor: documentul declară că nu au fost analizate toate edge-urile. Departamentul HR, superadmin sau can_access_personal_data fără modul sunt excluse intenționat; această alegere trebuie să apară în preview.

2. Perechile complete sunt bune pentru tabelul țintă; nu acoperă încă sursa drepturilor

GO pentru comparația combinată tabel + toate politicile + privilegiile efective, inclusiv refuzul stărilor mixte. Este mai robustă decât verificarea izolată a numelui politicii sau a granturilor directe. Refuzul la diferență de deparse pe PG17 este acceptabil, cu postcondiția în tranzacția validată în runda 4.

Corectura necesară: precondiția dependențelor verifică numai existența și tipul coloanelor. Nu demonstrează că is_owner și rândurile user_module_access nu pot fi autoatribuite. (Migrare §1.) Legați aprobarea de verificarea acestor invarianți pe starea efectivă a dependențelor, prin precondiții relevante sau probe obligatorii înainte de apply, cu reviziile consemnate. Nu este necesară amprentarea arbitrară a întregii scheme.

Formulați și domeniul verdictului precis:

Citirea directă prin rolurile API este restrânsă; obținerea tokenurilor prin toate căile aplicației nu este încă demonstrată ca restrânsă.

Un edge care folosește service_role poate citi în continuare tabelul. Faptul că nu este afectat de patch este o proprietate de compatibilitate, nu dovada că propriul endpoint este autorizat corect. Inventarul acestor căi poate continua separat, fără să amâne eliminarea expunerii directe.

3. Revocarea/reemiterea este corect separată, dar opțiunea A trebuie rescrisă

Acord cu separarea DDL-ului de intervenția pe cele 117 tokenuri. Restrângerea SELECT nu trebuie să aștepte o distribuire completă a linkurilor noi.

Totuși, „reemitere pentru toți” prin simplul UPDATE al tokenului nu dezactivează cele 12 rânduri ale angajaților plecați: ele primesc alte credentiale, încă active. Opțiunea recomandată trebuie să distingă explicit:

Invalidarea tuturor celor 117 credentiale vechi, apoi emiterea/activarea de credentiale noi numai pentru angajații confirmați ca eligibili; cele 12 cazuri de plecare sunt dezactivate după confirmarea lui Răzvan. Cele 15 persoane active fără token reprezintă o decizie separată de creare, nu intră implicit în rotație.

Preview-ul pentru operația pe date nu trebuie să fie numai count(*). Trebuie să identifice angajații/rândurile vizate, clasificarea, acțiunea propusă și starea de referință, fără tokenuri. Apply-ul verifică faptul că această stare nu s-a schimbat între confirmare și execuție; o diferență nu se suprascrie tacit.

Eligibilitatea angajatului, expirarea și mecanismul de emitere sunt controale complementare, nu alternative echivalente. Verificarea trebuie aplicată la operațiile publice relevante, atât citire, cât și depunere. Lipsa informației despre eligibilitate nu devine automat o concluzie de fond; comportamentul trebuie decis explicit.

Până la rotație sau o invalidare echivalentă, consemnarea rămâne: „expunerea directă redusă; credentialele anterior accesibile rămân utilizabile”. Cererile deja existente nu se șterg și nu se declară frauduloase automat.

4. Testele discriminatorii care lipsesc din dovezile prezentate

Nu afirm că lipsesc din fișierele necomunicate. Următoarele trebuie să fie identificabile în probe:

| Test | Rezultat cerut |
|---|---|
| Autoatribuirea dreptului: cont fără modul încearcă local să-și seteze is_owner sau să insereze/modifice propriul acces HR, apoi citește tokenurile | Nu obține dreptul și nu vede tokenuri. O modificare a protecțiilor sursă care permite acest lucru invalidează aprobarea, chiar dacă amprenta tabelului tokenurilor este neschimbată. |
| Revocarea dreptului într-o sesiune existentă: cont HR citește; accesul HR este retras; același JWT face o cerere nouă | Zero rânduri în noua tranzacție, dacă nu există altă ramură legitimă de acces. Echivalent pentru owner retrogradat fără modul HR. |
| Limitele grupului țintă: hr viewer, un submodul precum hr.recrutare și valoarea exactă hr. | Regula actuală le permite citirea. Testul trebuie să facă această alegere vizibilă și aprobată, nu să le numească automat „HR legitim”. |
| Dependențele RLS fără privilegii de citire necesare | Refuz sigur, fără fallback care lărgește accesul; efectul asupra utilizatorilor legitimi este consemnat. Testul „RLS pe rând propriu” deja raportat nu acoperă retragerea privilegiilor pe coloanele consultate. |
| Token fictiv copiat înainte de patch | După patch, contul fără modul nu-l mai poate lista, dar copia încă funcționează pe edge. Este demonstrația limitei patch-ului, nu un test care trebuie cosmetizat în verde. |
| Pentru intervenția separată de rotație: token vechi versus nou, angajat eligibil versus dezactivat | Tokenurile vechi sunt refuzate atât la info, cât și la POST; noul token funcționează numai pentru eligibilul aprobat. Nicio valoare de token în logurile probelor. |

Verificarea live cu „Link mobil” sau /co se face de actorul autorizat, fără preluarea linkului în chat ori în raport și fără depunerea unei cereri reale ca test.

Concluzie: GO CU CORECTURI pentru reducerea punctuală a expunerii prin acces direct. Pentru revizia finală sunt necesare aprobarea explicită a grupului țintă, dovezile asupra sursei drepturilor și corectarea planului de invalidare; livrarea atomică rămâne condiția separată din runda 4.
