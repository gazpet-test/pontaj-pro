# Text-șablon: ANUNȚUL de afișare la primărie (convocarea pe UAT) — propunere 18.11.2026, de validat de Juridic și de Răzvan

Sursa: Planul procedurii de predare a terenurilor (rev. 1, transmis Transgaz pe 18.11.2026), pct. 4.3 („Convocarea pe UAT, cu lista
parcelelor (fără date personale), se afișează la intrarea în primărie cu cel puțin 10 zile înainte, pentru toți proprietarii, inclusiv
cei fără adresă sau neidentificați. … Afișarea e publicitate suplimentară; nu valorează acceptare tacită.”) și cap. 8 („Convocatorul
afișat la primărie conține identificarea parcelelor, nu date personale.”). Textul e adaptat din convocatorul individual (Model 1, rev. 1)
și din Anexa 2 a adresei către primărie (Model 4). Placeholder-ele {{camp}} se completează din red_proiecte / red_uat / red_parcele;
nicio coloană cu date personale nu intră în document. Documentul se descarcă (DOCX) din 🏛️ UAT-uri → editare UAT; nu se salvează în ERP:
afișarea se consemnează prin PV-ul de afișare al primăriei (perioada + nr. PV, pe UAT).

Marcaje de formatare (citite de scripts/redari_sablon_anunt_afisare.mjs): `# ` titlu, `## ` subtitlu, `### ` subcapitol,
`!i ` paragraf cursiv, `!b ` aldin, `!m ` mărunt (9 pt), `!s ` mic (10 pt), `!c ` centrat (literele se pot combina: `!ic `), `!qr` = codul QR
într-un cadru la dreapta (textul următor curge pe lângă el), `!latimi a,b,c` = lățimile coloanelor tabelului care urmează (procente),
`!faraborduri` = tabelul următor fără chenar, `| … | … |` = rând de tabel (primul rând = antet, repetat pe fiecare pagină; rândul cu
`{{rand.*}}` = rândul-șablon repetat pentru fiecare parcelă).

---

!m Lider al Asocierii Gazpet Instal – Moldocor – Habau – Comesad RO · Contract Transgaz nr. {{contract_nr}}/{{contract_data}} · {{proiect_denumire}}

# ANUNȚ

## CONVOCARE la predarea terenului

## Comuna {{uat}}, județul {{judet}}

!ic În numele și cu împuternicirea S.N.T.G.N. TRANSGAZ S.A., în calitate de Beneficiar al investiției (împuternicire nr. {{imputernicire_nr}} / {{imputernicire_data}}).

!b Către toți proprietarii și deținătorii (coproprietari, moștenitori, arendași, utilizatori) terenurilor de pe raza comunei {{uat}} afectate temporar de lucrările la {{proiect_denumire}}, pentru parcelele din lista de mai jos – inclusiv cei cărora convocarea nu le-a putut fi transmisă prin poștă.

Lucrările de readucere a terenului la starea inițială pe parcelele din listă au fost executate. Vă invităm să constatați starea terenului și să semnați procesul-verbal de predare, la sediul Primăriei {{uat}}, în una dintre zilele de mai jos. Puteți veni în oricare dintre zile, în intervalul programat pentru satul sau tarlaua dumneavoastră sau în oricare alt interval liber. Procesul-verbal va fi pregătit cu datele parcelei; la sesiune doar îl verificați și îl semnați.

!latimi 12,18,28,42
| Ziua | Data | Program | Sate / tarlale programate |
| Ziua 1 | {{zi1}} | {{program1}} | {{sate_zi1}} |
| Ziua 2 | {{zi2}} | {{program2}} | {{sate_zi2}} |
| Ziua 3 | {{zi3}} | {{program3}} | {{sate_zi3}} |

Vă rugăm să aveți asupra dumneavoastră actul de identitate și, dacă este cazul, actul care dovedește calitatea de proprietar, moștenitor sau arendaș. Dacă parcela are mai mulți coproprietari, fiecare semnează în nume propriu; un coproprietar poate semna pentru ceilalți numai cu mandat scris.

### Cum ne puteți răspunde

Vă rugăm să ne comunicați dacă participați: la telefon {{contact_telefon}}, prin e-mail la {{contact_email}} sau prin răspuns scris, la contactul de mai jos. Dacă ați primit convocarea și prin poștă, puteți răspunde și prin formularul online, scanând cu telefonul codul QR din scrisoare. Puteți alege: particip la sesiune (în ziua și intervalul alese); nu particip și nu am obiecții privind starea terenului; contest starea terenului și solicit constatarea pe teren, la data stabilită de comisie.

În lipsa participării sau a unui răspuns, reprezentanții Beneficiarului, ai Antreprenorului și ai Primăriei pot efectua o constatare tehnică documentată a stării terenului. Prezenta afișare este o publicitate suplimentară a convocării; ea nu valorează acceptare tacită din partea dumneavoastră.

### Precizări

Această convocare privește numai starea terenului după lucrări. Despăgubirile și indemnizațiile pentru folosința terenului sunt stabilite și plătite de TRANSGAZ; întrebările despre ele le puteți adresa reprezentantului TRANSGAZ prezent la sesiune.

!qr

!m Date personale: Transgaz folosește datele proprietarilor și deținătorilor ca să organizeze predarea terenului după lucrările la conducta de gaze; Gazpet Instal organizează convocarea în numele Transgaz. Datele nu sunt folosite pentru reclamă. Prezentul anunț nu conține date personale. Informarea completă despre folosirea datelor și drepturile dumneavoastră: {{link_informare}} (sau scanați codul QR alăturat); o puteți cere și la telefonul de mai jos.

!s Contact GAZPET INSTAL: {{contact_nume}}, tel. {{contact_telefon}}, e-mail {{contact_email}}

!s Contact TRANSGAZ (DRFT / ofițer de legătură): {{reprezentant_tgz}}, tel. {{reprezentant_tgz_telefon}}

!latimi 55,45
!faraborduri
| GAZPET INSTAL S.R.L. – Antreprenor | Data: {{data}} |
| _______________________ |  |
| {{semnatar_gazpet}} |  |

### Lista parcelelor din comuna {{uat}} (număr de parcele: {{numar_parcele}}; fără date personale), în ordinea tarla / nr. cadastral

!latimi 7,25,14,26,16,12
| Nr. | Sat | Tarla | Nr. cadastral / parcelă | Poz. HG | Tronson |
| {{rand.nr}} | {{rand.sat}} | {{rand.tarla}} | {{rand.nr_cadastral}} | {{rand.poz_hg}} | {{rand.tronson}} |

---

Placeholder-e (32): contract_nr, contract_data, proiect_denumire, uat, judet, imputernicire_nr, imputernicire_data, zi1, program1, sate_zi1, zi2, program2, sate_zi2, zi3, program3, sate_zi3, contact_telefon, contact_email, qr, link_informare, contact_nume, reprezentant_tgz, reprezentant_tgz_telefon, data, semnatar_gazpet, numar_parcele, rand.nr, rand.sat, rand.tarla, rand.nr_cadastral, rand.poz_hg, rand.tronson.
Surse (aceleași helper-e ca la convocator și adresa UAT — `campuriContractProiect`, `campuriSesiuniUat`, `campuriContactGazpet` din src/redari/docx.js): red_proiecte (contract_nr, contract_data, denumire, imputernicire_nr, imputernicire_data, contact_nume, contact_telefon, contact_email, reprezentant_tgz_nume + reprezentant_tgz_functie, reprezentant_tgz_telefon, reprezentant_gazpet_nume + reprezentant_gazpet_functie); red_uat (nume, judet, sesiune_zi1..3, program_zi1..3, sate_zi1..3); red_v_parcele, doar parcelele active ale UAT-ului, doar coloanele sat, tarla, nr_cadastral, poz_hg, tronson (fără deținători, adrese, telefoane, cote); link_informare = pagina publică a informării GDPR (https://redari.gazpet.ro/redari/informare, aceeași pentru toți — fără link personal), qr = codul QR al aceleiași pagini; data = azi (Europe/Bucharest).
