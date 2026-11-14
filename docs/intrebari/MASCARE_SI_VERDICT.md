# ❓ Întreabă echipa — numele ascunse și regula „Da / Nu / Incert” (deciziile owner-ului, 13.11.2026)

Documentul pentru owner și coordonator. Partea tehnică (fișiere, teste) e în `worker/intrebari-tehnice/README.md`. Toate numele de
persoane și de firme private din exemple sunt INVENTATE; entitățile publice sunt doar cele din `nemascate.json`.

## Ce s-a decis
- **A. Numele nu pleacă la furnizorul modelului.** Numele de persoane și de firme din întrebare se ascund înainte de trimitere și
  se pun la loc în răspunsul afișat. Variantele respinse: răspuns doar din documentele noastre; trimitere integrală cu avertisment.
- **B. „Da” / „Nu” doar când o sursă spune exact acel lucru, de sine stătător** — citatul trebuie să fie un PARAGRAF ÎNTREG al
  sursei, copiat identic, paragraf care are o singură propoziție și nu depinde de alt text (r5). Altfel răspunsul e „Incert”, cu
  sursele alăturate ca să le citească omul.
- Owner, după review-ul PR #1086 (neschimbat): operatorii de rețea, instituțiile publice și Gazpet rămân vizibili; atașamentele nu se
  trimit la AI; localitățile rămân vizibile; doar trei verdicte (Da / Nu / Incert).

## r4 / r5: UN SINGUR MOTOR pentru mascare și regula B — și granița lui
Până în r3 regulile de mascare existau de două ori (în worker, în Python, și în ecran, în JavaScript) și fiecare rundă de review a
găsit o diferență între ele. De la r4:
- **mascarea și regula B stau într-un singur fișier**, `src/intrebariMascare.js`: normalizarea, mascarea, învățarea numelor în
  speță, etichetele, demascarea și regula B (paragrafele sursei, numărul de propoziții, listele, compararea citatului), cu listele
  lor;
- **ecranul** îl folosește direct, pentru previzualizare;
- **workerul** îl cheamă printr-un proces Node separat, câte unul pe întrebare (`motor.py` → `motor_cli.mjs`); Python nu „corectează”
  nimic înainte sau după motor: ce dă motorul se folosește ca atare, iar la orice problemă nu se folosește nimic.
- **Granița (r5, corectată):** validarea răspunsului (susținere, polaritate, `curata_raspuns`) rămâne în `cercetare.py`, cu perechea
  ei din `src/intrebariSurse.js`, ținute la fel de setul comun de teste (`teste_validare.json`, `teste_normative.json`, extins cu
  cazurile rundei 5). Validarea scoate liniile pe care sursa nu le susține; regula B rulează DUPĂ ea și e ultimul pas pe text (după
  ea vine doar demascarea), deci nimic din Python nu poate întoarce refuzul regulii B într-un „Da” / „Nu” (test pe flux + mutant).
  Mutarea validării în motor = lucrare separată, declarată, nu face parte din r5.

### Cum e păzit procesul motorului
- **Fișiere verificate:** `worker/intrebari-tehnice/motor_manifest.json` are amprenta sha256 a motorului și a TUTUROR fișierelor
  lui (protocolul, intrarea, `nemascate.json`, `vocabular_web.json`, `cuvinte_comune.json`), plus versiunea Node (24, ca în
  `package.json`) și versiunea Unicode a lui Node (pe server: Node 24.20 = Unicode 17.0). La pornire, workerul verifică fiecare
  fișier, îl copiază într-un dosar privat (atributul doar-citire) și pornește toate procesele de acolo; înainte de fiecare proces
  dosarul se verifică din nou, iar procesul trimite la pornire amprentele fișierelor pe care le încarcă — orice diferență oprește
  tot. **Instantaneul NU e imutabil absolut:** pe Windows, atributul doar-citire nu e o interdicție ACL; contul care rulează workerul
  îl poate schimba. Reverificarea prinde o schimbare de dinaintea pornirii unui proces, nu una făcută cu intenție între verificare și
  încărcare (în afara modelului de amenințare). Pașii de pornire spun ce ACL se acceptă.
- **Protocol strict:** câte un mesaj JSON pe linie, UTF-8, cu versiunea protocolului și câmpurile verificate exact la ambele capete;
  ieșirea standard e doar pentru protocol; erorile sunt coduri scurte, fără text din întrebare sau din lista de nume; nimic în
  jurnalele de eroare ale procesului. Procesul se pornește direct (fără linie de comandă intermediară), cu un mediu minim, iar lista
  de nume îi vine pe intrarea standard, nu ca argument.
- **O întrebare = un proces:** ce s-a învățat, etichetele și tabelul „etichetă → nume” stau doar în procesul acelei întrebări, de la
  prima mascare până la demascarea finală; două întrebări nu împart nimic, nici când rulează în paralel.
- **Limite și termene (r5):** mărimea maximă a unui mesaj (64 MB la intrare, 16 MB la ieșire); 30 de secunde pe operație și 30 de
  minute pe întrebare. ACELAȘI termen monoton al operației acoperă scrierea cererii, golirea ei și citirea răspunsului și e
  plafonat de termenul întrebării. Scrierea rulează pe un fir separat: dacă procesul nu citește, la termen procesul e oprit, ceea ce
  eliberează firul de scriere; oprirea are și ea pași mărginiți (5 secunde pentru proces și pentru fiecare fir), deci apelul revine
  într-un interval mărginit, cu eroare, și nimic nu se publică. Testat cu un proces care nu citește și o cerere de 1 MB, la 100 ms
  pe operație.
- **Fail-closed:** Node lipsă, versiune greșită, amprentă greșită, proces căzut, timp depășit, răspuns trunchiat sau cu altă formă,
  răspuns prea mare → **procesarea se oprește: nu se mai trimite nicio cerere către model, iar răspunsul nu se publică**; colegul
  vede „Eroare internă la ascunderea numelor: procesarea s-a oprit, nu se mai trimite nicio cerere, iar răspunsul nu se publică”,
  jurnalul are doar codul. (Cererile trimise ÎNAINTE de eroare, cu text mascat, au plecat deja — mesajul din r4, „întrebarea NU a
  fost trimisă”, nu era adevărat în acest caz.) Textul original nu ia niciodată locul celui mascat.
- **„Fără rețea” — formularea exactă:** codul fixat prin manifest nu conține apeluri de rețea — NU o proprietate de izolare a
  procesului. Node 24 nu are o permisiune pentru rețea; procesul rulează cu permisiunile Node pornite (nu poate scrie pe disc, nu
  poate porni alte programe, fire de lucru sau module native și citește doar din dosarul lui). Ce se verifică:
  - **pe arborele sintactic** al motorului și al protocolului (`parseAst` din `vite`, deja dependență; testul din
    `src/intrebariMascare.test.js`): importurile doar din fișierele manifestului, niciun import dinamic, niciun `import.meta`, niciun
    identificator din lista închisă a testului (`process`, `globalThis`, `global`, `self`, `window`, `frames`, `require`, `module`,
    `exports`, `eval`, `Function`, `fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource`, `Worker`, `SharedWorker`, `importScripts`,
    `navigator`, `Deno`, `Bun`, `WebAssembly`), nicio accesare a proprietății `constructor`. Un filtru pe text nu ajungea:
    `globalThis["pro" + "cess"]` trecea de el, de arbore nu. Excepțiile, enumerate, sunt doar pentru intrarea `motor_cli.mjs`, care
    gestionează procesul: importurile `node:crypto`, `node:fs`, `node:path`, `node:url`, cele două importuri dinamice ale motorului și
    identificatorii `process` și `globalThis`;
  - **în procesul real:** intrarea scoate, ÎNAINTEA importului motorului, funcțiile de rețea globale și încărcătoarele alternative
    de module (`process.getBuiltinModule`, `process.binding`, `process._linkedBinding`, `process.dlopen`); un test pornește procesul
    cu aceleași flaguri și o sondă în locul protocolului, care confirmă că ele lipsesc.

## Ce pleacă și ce nu pleacă în afară
| | Pleacă la furnizorul modelului? |
|---|---|
| Titlul, speța, contextul | DA, dar cu numele și datele personale înlocuite de etichete: `[PERSOANA_1]`, `[FIRMA_1]`, `[CNP_1]`, `[CUI_1]`, `[TELEFON_1]`, `[EMAIL_1]`, `[IBAN_1]`, `[NR_AUTO_1]`, `[ASCUNS_1]` |
| Tabelul „etichetă → nume” | NU. Stă doar în procesul motorului, cât se lucrează la o întrebare; nu se scrie nici pe disc, nici în jurnal |
| Lista de nume din platformă (angajați, terți, CUI-uri) | NU. Workerul o primește de la ERP și o dă procesului motorului, doar ca să găsească numele în text |
| Atașamentele (PDF / poze) | NU. Numele din ele nu pot fi ascunse sigur. Rămân în ERP pentru colegi; modelul află doar că există |
| Extrasele din documentele noastre de cercetare și din paginile oficiale | DA (trec și ele prin mascare). Textul lor brut și paragraful precedent din sursă ajung doar la procesul local al motorului (regula B) |
| Căutarea pe web | DA, doar căutarea compusă de program din lista aprobată de cuvinte (fără nume, fără speță) |
| Jurnalul workerului | Rămâne pe server și are doar numere: câte nume / date s-au ascuns, pe categorii; la pornire câte nume s-au încărcat și câte intrări fără valoare s-au aruncat. Nu are valori |

Aceeași persoană primește aceeași etichetă pe toată întrebarea; altă formă scrisă a aceluiași nume („Ana Vlădescu” / „Vlădescu
Ana”, „Mariei”, firma cu sau fără „SC”) primește același număr cu un indice: `[PERSOANA_1_F2]`.

## Contractul de acoperire (închis) — ce TREBUIE ascuns
Un nume de persoană sau o firmă care **există în lista platformei** se ascunde în orice scriere de mai jos, **inclusiv când scrierile
se combină** (ex. `SCLumivo/Servi` + caracter invizibil + `ciilorS.R.L.`). Fiecare rând are cazuri scrise de mână în
`worker/intrebari-tehnice/teste_motor.json` și teste „mutant” care scot regula și arată că cazurile pică; în plus, toate rândurile
intră în matricea generativă (secțiunea „Matricea generativă”).

| Dimensiune | Ce se acoperă | Exemple (inventate) |
|---|---|---|
| **Majuscule** | Firme: numele întreg în orice capitalizare. Persoane (r5): numele întreg — două componente alăturate ale ACEEAȘI persoane din listă, în ambele ordini — în orice capitalizare, inclusiv integral cu litere mici sau amestecat; componentele a două persoane diferite nu se combină. r6: persoanele se DELIMITEAZĂ înaintea grupării — un grup de cuvinte alăturate e un nume doar dacă toate componentele lui sunt ale aceluiași nume din listă (fiecare o dată, deci cel mult câte componente are numele, plus cel mult un al doilea prenume „Ca Titlu” între două dintre ele); după un nume complet începe alt grup. „Cu majusculă” = cel puțin o literă mare ORIUNDE în cuvânt | `Lumivo Servicii`, `lumivo servicii`, `LuMiVo SeRvIcIi`; `ana vlădescu`, `zamfirescu maria`, `ZAMFIRESCU maria`; `ana vlădescu mare ion` → două persoane, două etichete |
| **Componenta distinctivă singură (r5)** | Firme: ORICE componentă distinctivă a unei firme private din listă (nu doar prima) se ascunde și fără numele întreg când e scrisă cu cel puțin o majusculă sau are context (formă juridică despărțită / lipită după ea, „SC” / „S.C.” în față); scrisă integral cu litere mici și fără context: doar prin propagare (vezi „Ordine și propagare”). Persoane: o componentă distinctivă se ascunde și singură, în ORICE scriere, inclusiv cu litere mici. „Distinctivă” = baza normalizată (înainte de flexiune) are cel puțin 4 litere, nu e număr și NU e în listele închise (secțiunea „Listele închise”); o firmă dintr-un singur cuvânt distinctiv e numele întreg (orice scriere) | `Pelorin a facturat`, `pELORIN`, `pelorin srl`, `SC pelorin` (firma `Construct Pelorin SRL`); `ce drepturi are crângașu`, `vlădescului` |
| **Diacritice și forme de compatibilitate** | Cu / fără diacritice, `ș / ş`, `ț / ţ`, forme Unicode compuse / descompuse; r5: literele late și celelalte forme de compatibilitate Unicode. r6: **toate etapele de recunoaștere** (forma juridică despărțită / lipită, „SC”, titlurile, tiparele RO / CUI / telefon / e-mail, cifrele CUI, etichetele, separatoarele, flexiunile, componentele) lucrează pe ACEEAȘI reprezentare a textului — fiecare caracter descompus NFKD, fără semnele de combinare și caracterele de format (`curata` în motor, aceeași funcție ca la compararea numelor) —, cu harta de poziții spre original: ce se ascunde e intervalul ORIGINAL complet, deci restaurarea rămâne exactă | `Șerban`, `Şerban`, `Serban`, `ＶＬĂＤＥＳＣＵ ＡＮＡ`, `ｌｕｍｉｖｏ ｓｅｒｖｉｃｉｉ`, `ＶａｒｎｉｔｅｃＳＲＬ`, `VarnitecＳ．Ｒ．Ｌ．`, `ｄｌ． Ｎｕｍｅ`, `ＲＯ１２３４５６７８` |
| **Separatoare** | Între componentele unei firme: 1–6 caractere din mulțimea închisă: orice spațiu din categoria Unicode Zs (inclusiv cel neîntreruptibil), tab, CR, LF, virgulă, punct, ghilimelele `"` `'` `„` `”` `“` `«` `»` `‚` `‘` `’`, parantezele rotunde, `&`, `+`, r5: `/` și `\`, cratimele de mai jos. La persoane: aceeași mulțime fără punct, CR și LF; r6: și spațiile, și celelalte separatoare leagă doar componente ale **aceluiași** nume din listă (două persoane alăturate, cu sau fără separator, rămân pe etichete diferite) | `Lumivo, Servicii`, `Lumivo & Servicii`, `Lumivo/Servicii SRL`, `Lumivo\Servicii`, `Vlădescu/Ana` |
| **Forme juridice** | `SRL, SA, PFA, II, IF, SNC, SCS`, cu / fără puncte, orice capitalizare, despărțite sau LIPITE după nume; r5: forma lipită se recunoaște pe tulpina componentei sau pe tulpina fără UN sufix de flexiune (`ServiciilorSRL`), pentru firma ÎNTREAGĂ, înaintea excepțiilor, iar eticheta acoperă intervalul original complet (de la prima componentă la sfârșitul formei); pentru o firmă dintr-un cuvânt comun forma lipită ESTE contextul; r6: când un cuvânt se poate citi în mai multe feluri, câștigă citirea care acoperă cel mai mult (`VarnitecI.I.` = firma + `I.I.`, nu flexiunea `-i` cu `.I.` rămas afară), iar la egalitate cea cu context (`alfaII` = `Alfa` + `II`, nu flexiunea `-ii`; ambiguitatea declarată: și `ALFAII` / `aLFAII` — sufixul `-ii` scris mare — se citesc ca forma `II` lipită, deci ascunse; după forma lipită se ia și o formă despărțită: `SERVICIIII SRL`). „SC” / „S.C.” în față, despărțit sau lipit. „sa”, „ii”, „if” scrise mic sunt cuvinte („să”, „îi”) sau sufixe („Lumivoii”): despărțite rămân în afara etichetei, lipite nu sunt formă juridică | `VarnitecSRL`, `VARNITECSRL`, `Varnitecsrl`, `VarnitecS.R.L.`, `AlfaSRL`, `Lumivo ServiciilorSRL`, `SCVarnitec SRL`, `S.C.Varnitec` |
| **Flexiuni** | UN sufix din `{ului, ilor, ule, lui, lor, ul, le, ei, ii, e, i}` pe o componentă de cel puțin 4 litere (la firma întreagă: pe ultima componentă); plus genitivul feminin `Ana→Anei`, `Maria→Mariei`, `Andreea→Andreei`, `Olga→Olgăi`. Fără derivări în lanț (`VarnitecululSRL` rămâne) | `Vlădescului`, `Vlădescule`, `Crângașului`, `Varnitecului` |
| **Cratimă** | `-`, U+2010, U+2011 la nume compuse și sufixe; se ascunde tot cuvântul compus | `Gheorghiu-Vlădescu`, `Vlădescu-ului`, `VLĂDESCU-ULUI` |
| **Invizibile / de combinare** | Inserate în nume: toate caracterele de combinare (categoria Unicode M) și de format (Cf), inclusiv U+034F, U+FE0F, U+200B, U+00AD, U+FEFF și selectorii de variantă U+FE00–FE0F, U+E0100–E01EF. O SINGURĂ funcție de normalizare (`curata` / `norm` în motor), după tabelele Unicode ale lui Node 24.20 (Unicode 17.0) pe server și ale browserului în ecran | `Vlă` + U+034F + `descu` |
| **Ordine și propagare** | Persoane: ambele ordini. Componenta izolată se ascunde înainte și după apariția numelui întreg, în toate câmpurile întrebării (titlu, speță, context — citite toate înainte de mascare). r5, scrisă integral cu litere mici, prin propagare: la firme, componentele distinctive ale firmei întregi din listă; la persoane, orice componentă a numelui întreg apărut în întrebare (și cea comună). Ordinea cuvintelor unei firme rămâne fixă pentru numele întreg (componenta distinctivă se ascunde oricum) | `Ana Vlădescu` / `Vlădescu Ana`; `lumivo a cerut` + `Lumivo Servicii SRL a livrat` → ambele ascunse; `Ion Mare a venit; mare parte e gata` → „mare” ascuns |

**Excepțiile au prioritate explicită** — entitățile publice aprobate (`nemascate.json`) și localitățile rămân vizibile; dar
**potrivirea completă a unei firme private din listă vine înaintea excepției** pentru un fragment public: `Transgaz Construct SRL`
se ascunde întreg, `Transgaz` singur rămâne (un cuvânt al unei entități publice nu e niciodată componentă distinctivă).

**Componentele comune cer context.** Un cuvânt din listă care e și cuvânt obișnuit rămâne vizibil când apare singur, fără context
identificator: „Alfa este coeficientul, gamma este radiația”, „Mare parte din lucrare”, „ion e un atom” rămân, deși `Alfa SRL`,
`Gamma SRL`, `MARE ION` sunt în listă. Context = formă juridică alături, „SC” în față, un titlu („dl.”; r7: doar pentru cuvântul
lipit de titlu — vezi mai jos), o altă componentă a **aceluiași** nume din listă lipită de el sau **numele întreg apărut în aceeași
întrebare**. r6: numele ALTEI persoane lipit de el nu e
context („Ana Vlădescu Mare a venit” → „[PERSOANA_1] Mare a venit”, dacă „Mare” e doar componenta comună a lui `MARE ION`). **Compromisul declarat și testat:** după ce numele întreg a apărut,
propagarea ascunde și cuvântul comun scris cu majusculă („Alfa SRL a livrat. Alfa a facturat” → ambele ascunse); la persoane, din
r5, și scris mic („Ion Mare a venit; mare parte e gata” → „mare” ascuns); la firme, cuvântul comun scris mic rămâne („alfa e
coeficientul”). **Excesul conservator declarat:** motorul nu decide dacă un cuvânt e „obișnuit” — decide lista. Un nume din listă care
nu e în lista de cuvinte comune se ascunde și ca substantiv („busuioc pentru grădină”, dacă `Busuioc` e o persoană din listă);
„pădure” și „munte” sunt în listă și rămân.

### Persoanele: o singură delimitare și identitatea din listă (r7, review r6 P2-1 / P2-2)
Ce e testat (cazurile scrise de mână din `teste_motor.json`, rândurile „r7”, dicționarele numite `incluse`, `egalitate`, `trei`; familiile
r7 ale matricei; mutanții r7) — nimic în plus:
- **O singură delimitare.** Toate căile care construiesc, extind sau reunesc o persoană — lista, titlul, propagarea, componenta +
  context — trec prin ACEEAȘI funcție (`Mascare.delimiteaza`): ea împarte cuvintele alăturate în grupuri și dă fiecărui grup
  identitatea. Titlul și propagarea doar MARCHEAZĂ cuvintele (context, persoană necunoscută); singurul loc care adaugă un interval
  de persoană e `emitePersoane`, care dă mai departe grupurile neschimbate. Inventarul ÎNCHIS al acestor locuri (cine marchează, cine
  delimitează, cine scrie, unde apare categoria `PERSOANA`) e verificat pe arborele sintactic al motorului, cu contraexemple (un titlu
  care adaugă singur o persoană, o categorie calculată, un interval extins, o listă făcută de mână, o unire în `entitate()`).
- **După un titlu** („dl.”, „ing.”, „dna”, „colegul” … — `TITLURI`), cuvintele se împart CA ȘI CUM titlul n-ar fi; titlul dă context
  DOAR primului grup (cel care începe cu cuvântul lipit de el): `dl. Ana Vladescu Ion Mare a venit.` → `dl. [PERSOANA_1] [PERSOANA_2]
  a venit.`; `dl. Mare a semnat.` → ascuns; `dl. Ana Vladescu Mare a plecat.` → „Mare” rămâne (contextul nu trece peste o persoană
  deja delimitată).
- **Persoana necunoscută de după titlu**: cuvintele cu majusculă necunoscute listei („Ca Titlu” sau integral mari, de cel puțin 6
  litere), despărțite prin spații, în fereastra titlului. **Limita declarată: cel mult TREI cuvinte necunoscute** — o regulă de tipar,
  nu o garanție că orice nume necunoscut e ascuns întreg. Persoana necunoscută se oprește înaintea oricărei componente cunoscute
  (deci și înaintea unui nume complet din listă), iar componenta revine delimitării comune: `dl. Popescu Ana Vladescu a venit.` →
  două persoane; `dl. Popescu Mare a sunat.` → `dl. [PERSOANA_1] Mare a sunat.` („Mare” nu e primul grup, deci fără context).
  Decizie (r7, spusă aici ca să poată fi întoarsă): un cuvânt necunoscut din fereastra titlului DUPĂ un nume din listă e altă persoană,
  ascunsă, cu entitate proprie (`dl. Ana Vladescu Popescu` → două etichete); al doilea prenume între două componente ale aceluiași nume
  rămâne în nume (`dl. Ana Gheorghe Vladescu` → o persoană).
- **Identitatea unui grup** (mulțimea G a componentelor lui din listă) o dă DOAR dicționarul, înaintea oricărei învățări din speță —
  deci nu depinde de ordinea textelor: (B1) există o singură intrare din listă cu mulțimea exact G → acea persoană, chiar dacă G e inclusă
  și în alt nume (`ANA VLADESCU` și `ANA MARIA VLADESCU` = două persoane: `Ana Vladescu Ana Maria Vladescu` → două etichete); două
  intrări cu aceeași mulțime (`PETRESCU OLGA` și `OLGA PETRESCU`) → entitate ambiguă; (B2) altfel, G inclusă într-un singur nume →
  forma prescurtată a lui (`Maria` → `ANA MARIA VLADESCU`); (B3) altfel (inclusă în două sau mai multe nume — `Vladescu` singur — sau
  în niciunul) → **entitate ambiguă proprie**: ascunsă, cu eticheta ei, și NICIODATĂ unită cu alta — nici după submulțime, nici prin
  propagare, nici prin ordinea învățării, nici tranzitiv (`Ana Vladescu, Vladescu și Ana Maria Vladescu` → trei etichete). Învățarea
  din speță hotărăște doar CE cuvinte se mai ascund (propagarea), nu identitatea lor.
- **Împărțirea** unui șir de cuvinte alăturate (B5): se evaluează toate împărțirile (nu se oprește la primul nume complet:
  `Ana Vladescu Maria` = numele lung în altă ordine); câștigă cea cu cele mai puține cuvinte vizibile, apoi cele mai puține grupuri,
  apoi cele mai multe nume EXACTE din listă. La egalitate între împărțiri care dau aceluiași cuvânt identități diferite, porțiunea în
  care diferă devine UN grup cu entitate ambiguă proprie (ascuns). Al doilea prenume nu poate repeta o componentă a aceluiași nume
  (găsit de matricea r7).
- **Consecința practică:** aceeași persoană trecută în platformă în două ordini (ex. angajat „NUME PRENUME” și contact „Prenume Nume”)
  = două intrări cu aceeași mulțime → entitate ambiguă (tot ascunsă, aceeași etichetă la fiecare apariție a ei); formele ei prescurtate
  sunt și ele ambigue.

### Listele închise (versionate, în fișiere din manifest)
O componentă e „comună” (cere context) sau ne-distinctivă dacă e în una dintre listele de mai jos; orice altă componentă de cel puțin
4 litere e distinctivă. Schimbarea unei liste = PR, iar manifestul motorului se reface.
- `worker/intrebari-tehnice/cuvinte_comune.json` — cuvintele obișnuite care pot fi și nume: litere grecești, culori, luni și zile,
  animale, plante și forme de relief, meserii și obiecte uzuale care sunt și nume de familie frecvente, cuvintele generice din
  numele de firme (r5: extinse);
- `worker/intrebari-tehnice/vocabular_web.json` — vocabularul tehnic;
- `worker/intrebari-tehnice/nemascate.json` — entitățile publice (orice cuvânt din numele lor);
- `src/intrebariMascare.js` — listele scurte ale motorului: cuvintele scurte comune (`COMUN`), componentele generice de firmă
  (`GENERICE_FIRMA`), intrările fără valoare de identificare (`FARA_VALOARE`), cuvintele de legătură, rolurile, documentele și
  titlurile (`OPRIRE`, `TITLURI`), formele juridice (`FORME_JURIDICE`);
- localitățile cunoscute platformei (lista `localitati` din edge, din `red_uat`).

**În afara contractului** (spus și în ecran): porecle, greșeli de scriere sau de citire automată (OCR), litere asemănătoare din alte
alfabete, litere despărțite prin spații („N u m e”), diminutive, un cuvânt al unei firme scris integral cu litere mici fără numele
întreg al firmei în întrebare (și fără formă juridică / „SC” lângă el), un cuvânt obișnuit care e și nume scris singur, fără numele
întreg în întrebare, nume pe care platforma nu le cunoaște (nu le cunoaște = nu sunt în lista ei; se prind doar cu un titlu în față
— „dl.”, „ing.”, „colegul” și ceilalți din `TITLURI`, cel mult trei cuvinte, r7 — sau cu SRL / SA după), adrese, numere de contract / carte funciară, un CUI
necunoscut platformei scris fără „RO” / „CUI”. **Acoperite din r5** (cu teste): literele late și celelalte forme de compatibilitate,
numele scrise cu litere mici (regulile de mai sus), CUI-ul cunoscut scris cu spații sau cu puncte / cratime între grupe de cifre
(„2345 6789”, „2345.6789”, „23-456-789”; intervalul ascuns merge de la prima la ultima cifră, iar „RO” lipit sau despărțit printr-un
spațiu intră și el).

**NU sunt „limite”** și nu se acceptă: ocolirea motorului (garda din worker refuză orice text care nu vine din sesiunea motorului
pentru acea întrebare), o listă de nume incompletă tratată ca succes (lista goală sau cu altă formă oprește preluarea), trimiterea
textului nemascat la o eroare (vezi fail-closed).

## Ce mai prinde mascarea (tipare, fără listă)
- **Nume după un titlu**: „dl.”, „dna”, „ing.”, „arh.”, „dr.”, „colegul”, „șeful”, „dirigintele”, „maistrul”, „sudorul”, „șoferul”
  și celelalte forme din `TITLURI` (și când numele e un cuvânt obișnuit: „dl. Ion”). r7: cel mult trei cuvinte necunoscute listei,
  oprite înaintea oricărei componente cunoscute; persoanele din listă de după titlu se delimitează ca fără titlu (secțiunea
  „Persoanele: o singură delimitare”).
- **Firme necunoscute cu formă juridică**: orice nume cu majusculă urmat de SRL / SA / PFA / II / IF / SNC / SCS.
- **Date personale**: CNP (cu cifra de control), CUI cu „RO” / „CUI” / „cod fiscal” în față sau cunoscut platformei, telefoane
  românești, e-mailuri, IBAN (cu verificarea de control), numere de înmatriculare.
- **Ce ascunde omul**: orice cuvânt între `[[` și `]]` (sau selectat și ascuns cu „🙈 Ascunde selecția”), și orice formă de
  etichetă scrisă de el între paranteze drepte — pleacă `[ASCUNS_n]` și se pune la loc exact.
- **Intrările fără valoare** din listă („diverse”, „persoana fizica”, „furnizor”, „client necunoscut” și celelalte din
  `FARA_VALOARE`) se aruncă la încărcare și se numără în jurnalul de pornire.

## Localitățile rămân vizibile (decizia owner-ului)
- Cuvântul de după un **marcaj de localitate** rămâne („comuna”, „com.”, „satul”, „orașul”, „municipiul”, „localitatea”, „județul”,
  „jud.”, „UAT” și celelalte din `MARCAJE_LOCALITATE`), plus cel mult două cuvinte cu majusculă lipite de el care nu sunt nume din
  listă („comuna Valea Călugărească”). Un nume de după localitate se ascunde în continuare („comuna Berceni Ana Vlădescu” →
  „comuna Berceni [PERSOANA_1]”).
- Un cuvânt care e **localitate cunoscută platformei** (denumirile UAT și satele din `red_uat`) rămâne când apare fără titlu și
  fără alt nume din listă lângă el. Conflictul nume de familie = localitate: cu titlu sau prenume lângă = persoană („dl. Berceni”,
  „Berceni Ana”), altfel = localitate („Berceni are teren”, „Primăria Berceni”).
- Previzualizarea din ecran nu are lista de localități: acolo un asemenea nume scris singur apare ascuns (pe server rămâne) — ecranul
  o spune.

## Entitățile publice care rămân vizibile (decizia owner-ului, 13.11.2026)
- lista stă într-un **singur loc**, `worker/intrebari-tehnice/nemascate.json`, citit doar de motor (deci la fel în ecran și pe
  server); fiecare intrare are o categorie: operator de rețea (Transgaz, Delgaz Grid / E.ON, Distrigaz Sud Rețele, Engie România,
  Premier Energy, Transelectrica, Electrica, Apa Nova București), companie publică (Romgaz, Hidroelectrica), instituție publică
  (ANRE), societatea noastră (Gazpet Instal). **Fără** furnizori, subcontractori, clienți privați sau persoane;
- potrivirea e pe **numele întreg** al entității (fără SRL / SA, cu inițialele lipite: „S.N.T.G.N. Transgaz S.A.” = „sntgn
  transgaz”), nu pe un cuvânt din el: firme private inventate cu nume asemănător („Transgaz Construct SRL”, „Delgaz Instal SRL”,
  „Gazpet Montaj SRL”, „Romgaz Service”) se ascund;
- **orice adăugare în listă = decizia owner-ului, prin coordonator** (PR cu categoria și motivul; manifestul motorului se reface).

## Cum arată în ecran
- Sub speță apare **„🙈 Previzualizare orientativă — verifică înainte de trimitere”**, cu textul cerut de recenzent, lângă ea:
  **„Previzualizare orientativă.** Serverul folosește lista completă din platformă și poate ascunde nume suplimentare. Localitățile
  cunoscute rămân vizibile pe server, chiar dacă aici apar ascunse. Mascarea automată nu garantează eliminarea tuturor numelor.”
- Textul cu etichetele evidențiate, rezumatul („Am ascuns 3 nume și date”), lista „Nu prinde” (la zi în r5: clasele din afara
  contractului, cu limitele de mai sus scrise distinct, și ce se prinde nou) și formularea exactă despre rețea: „Pe server, mascarea
  rulează local, într-un proces separat; codul ei, fixat prin amprente, nu conține apeluri de rețea (verificare a codului, nu o
  izolare a procesului).”
- Butonul **„🙈 Ascunde selecția”** pune cuvântul selectat între `[[ ]]`.
- Dacă colegul atașează fișiere: „Atașamentele rămân în ERP pentru colegi, dar NU se trimit la AI.”

## De unde vin numele din platformă (r2, review P1-1)
Funcția edge citește, doar pentru worker, **coloanele de nume / CUI** (niciodată telefon, e-mail, CNP, IBAN, adresă) din tabelele
de mai jos (`SURSE_NUME` în `supabase/functions/intrebari-tehnice-worker/logic.js`). Orice tabel sau coloană care nu se poate citi
oprește lista întreagă → workerul nu preia nimic (fail closed).

| Tabel | Persoane | Firme | CUI | Coloane verificate în |
|---|---|---|---|---|
| `employees` | name | | | cod / scheleți de test |
| `beneficiari` | contact_nume | nume | cif | cod |
| `logistica_furnizori` | persoana_contact | nume | cui | cod |
| `logistica_subcontractori` | contact_nume | nume_scurt, denumire_legala | cui | cod |
| `contracte_terti` | contact_factura_nume, contact_mng_nume, contact_resp_exec_nume | partener_text | | cod |
| `hr_personal_extern` | nume | firma | cui_firma | cod |
| `hr_recrutare_candidati` | nume | | | cod |
| `ofertare_parteneri` | | nume | cui | cod |
| `ofertare_brokeri` | | nume | | cod |
| `logistica_service_parteneri` | | nume | | cod |
| `sedinte_invitati` | nume | firma | | cod |
| `red_detinatori` | nume | | | migrare 20261126a |
| `red_proiecte` | reprezentant_tgz_nume, reprezentant_gazpet_nume, contact_nume | | | migrare 20261126a |
| `red_uat` | reprezentant_uat_nume | | | migrare 20261126a — r3: și **localitățile** `nume`, `sate_zi1`, `sate_zi2`, `sate_zi3` (lista separată `localitati`, folosită doar ca să NU ascundă) |
| `ofertare_oferte_furnizori` | | furnizor | | cod |
| `ofertare_preturi_materiale` | | furnizor | | cod |
| `contracte_subcontract_facturi` | | furnizor_text | | cod |
| `executie_tura_subcontractori` | | firma_text | | cod |
| `facturi_emise` | contact_nume, delegat_nume | beneficiar_nume | beneficiar_cif | cod |
| `logistica_transporturi` | sofer_extern_nume | | | cod |
| `eip_intrari` | | furnizor_nume | furnizor_cui | migrare 20261110a |

**Ce NU intră și de ce:** `izo_documente_intrare` (`furnizor`, `furnizor_cif`) — **scos pe 14.11.2026, la pornire**: tabelele
modulului de izometrii sunt închise intenționat pentru `service_role` (rolul cu care citește funcția nu are niciun drept pe ele), deci
acțiunea `nume` răspundea 500 și workerul n-ar fi preluat nimic. Nu se dă un drept nou pe acele tabele pentru o funcție de mascare.
Ce se pierde, măsurat atunci (doar numărări): 3 furnizori și 1 CUI care se găsesc **doar** acolo. **Cele 3 denumiri și 1 CUI pierd
acoperirea prin listă. Tiparele le pot masca în formele recunoscute; denumirile fără formă juridică și CUI-ul fără prefix pot rămâne
vizibile.** (Probat pe motor cu exemple inventate: denumirea simplă și codul numeric rămân vizibile; cu `SRL`, respectiv cu `RO`, sunt
ascunse.) Readucerea lor = decizia owner-ului (trecerea furnizorilor în registrul de furnizori sau o cale de citire acceptată de
modul), printr-un PR.
`profiles` (conturile de aplicație = angajații, deja din `employees`, plus conturi de serviciu);
`firma_profil` (e Gazpet — rămâne vizibilă); `red_detinatori_contact`, `red_corespondenta`, `red_mail_*`, `sms_mesaje` (doar
adrese / telefoane / e-mailuri, tiparele le prind); `polite_*`, `ofertare_organigrama` (numele stau în JSON, nu în coloane);
`ofertare_participari`, `ofertare_licitatii.autoritate`, `cnsc_decizii`, `hr_autorizatii.emitent` (autorități contractante,
concurenți și emitenți publici — informație publică din SEAP / CNSC); `contab_expert_linii`, `trezorerie_extras_linii`,
`hr_decizii` (zonă de salarii / bani: nu se deschide pentru o funcție de mascare fără decizia owner-ului); celelalte coloane libere
cu nume de furnizori (`productie_facturi`, `logistica_achizitii_vrac`, `logistica_mentenanta_plan`, `logistica_imprumuturi`,
`locatii_*`, `ctc_*`, `ofertare_rfq_*`, `izo_avize_iesire`, `probe_oferte`) — aceiași furnizori / clienți sunt deja în registrele de
mai sus; se pot adăuga printr-un PR mic dacă apar goluri.

**Înainte de publicarea funcției edge**, coordonatorul confirmă că toate coloanele din tabel există **și că rolul cu care citește
funcția (`service_role`) are drept de SELECT pe fiecare, inclusiv pe `id`** (doar citire, fără date). 14.11.2026: verificarea de
dinainte se uita doar la existența coloanelor, așa că un tabel fără drept de citire a trecut de ea și a oprit lista abia după publicare.
```sql
WITH t(tabel, coloana) AS (VALUES
  ('employees','name'),('beneficiari','nume'),('beneficiari','contact_nume'),('beneficiari','cif'),
  ('logistica_furnizori','nume'),('logistica_furnizori','persoana_contact'),('logistica_furnizori','cui'),
  ('logistica_subcontractori','nume_scurt'),('logistica_subcontractori','denumire_legala'),('logistica_subcontractori','contact_nume'),
  ('logistica_subcontractori','cui'),('contracte_terti','partener_text'),('contracte_terti','contact_factura_nume'),
  ('contracte_terti','contact_mng_nume'),('contracte_terti','contact_resp_exec_nume'),('hr_personal_extern','nume'),
  ('hr_personal_extern','firma'),('hr_personal_extern','cui_firma'),('hr_recrutare_candidati','nume'),('ofertare_parteneri','nume'),
  ('ofertare_parteneri','cui'),('ofertare_brokeri','nume'),('logistica_service_parteneri','nume'),('sedinte_invitati','nume'),
  ('sedinte_invitati','firma'),('red_detinatori','nume'),('red_proiecte','reprezentant_tgz_nume'),('red_proiecte','reprezentant_gazpet_nume'),
  ('red_proiecte','contact_nume'),('red_uat','reprezentant_uat_nume'),('red_uat','nume'),('red_uat','sate_zi1'),
  ('red_uat','sate_zi2'),('red_uat','sate_zi3'),('ofertare_oferte_furnizori','furnizor'),
  ('ofertare_preturi_materiale','furnizor'),('contracte_subcontract_facturi','furnizor_text'),('executie_tura_subcontractori','firma_text'),
  ('facturi_emise','contact_nume'),('facturi_emise','delegat_nume'),('facturi_emise','beneficiar_nume'),('facturi_emise','beneficiar_cif'),
  ('logistica_transporturi','sofer_extern_nume'),('eip_intrari','furnizor_nume'),('eip_intrari','furnizor_cui')
), toate AS (SELECT tabel, coloana FROM t UNION SELECT DISTINCT tabel, 'id' FROM t)
SELECT a.tabel, a.coloana,
       CASE WHEN c.column_name IS NULL THEN 'coloana lipseste' ELSE 'service_role nu are SELECT' END AS problema
  FROM toate a
  LEFT JOIN information_schema.columns c ON c.table_schema = 'public' AND c.table_name = a.tabel AND c.column_name = a.coloana
 WHERE CASE WHEN c.column_name IS NULL THEN true
            ELSE NOT has_column_privilege('service_role', ('public.' || quote_ident(a.tabel))::regclass, a.coloana, 'SELECT') END
 ORDER BY 1, 2;   -- trebuie să întoarcă 0 rânduri
```
r3: lista are 4 coloane noi, toate din `red_uat` (`nume`, `sate_zi1`, `sate_zi2`, `sate_zi3`, din migrarea 20261126a) — interogarea
se rulează din nou pe lista de mai sus, chiar dacă cea din r2 a întors 0.
Plus tipul cheii `id` (întreg pentru toate, `uuid` pentru `red_*`):
`SELECT table_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'id' AND table_name IN (<tabelele de mai sus>)`.
O coloană lipsă **sau necitibilă de `service_role`** se scoate din `SURSE_NUME` (PR), nu se publică edge-ul cu ea. Lista din
interogare e aceeași cu `SURSE_NUME` (un test le compară). **Zero rânduri nu garantează citirea efectivă**: interogarea verifică
existența coloanelor și drepturile pe ele, nu și dreptul pe schemă, dependențele unei vederi, configurarea serviciului REST sau
paginile de după prima. De aceea, după publicare, pasul 5 din „Pașii de pornire” rămâne obligatoriu și e proba reală: cu workerul
oprit, acțiunea `nume` cu secretul trebuie să răspundă 200 cu listele cerute nevide, iar cazurile neautorizate 401.

## Garda (verificată în cod, nu prin convenție)
- Există un singur drum spre furnizor. Fiecare mesaj trece prin motor chiar în funcția care construiește cererea.
- Înainte de orice trimitere, o gardă verifică cererea: conținutul trebuie să fie exact de tipul „text mascat” **și produs de
  sesiunea motorului pentru acea întrebare** (un „text mascat” făcut de mână, sau al altei întrebări, e refuzat). Un text construit
  după mascare (lipit, tăiat), un atașament, alt prompt sau altă unealtă oprește cererea înainte să plece. Limita: garda prinde
  greșelile de program, nu un cod rău-intenționat rulat în același proces.
- Fără lista de nume din platformă sau fără motorul verificat, workerul nu preia nicio întrebare (întrebările așteaptă în coadă).
- **Demascarea e strictă:** se pun la loc doar etichetele emise pentru întrebarea aceea, scrise exact. Răspunsul **nu se publică**
  dacă în textul modelului rămâne o „aproape etichetă” care nu e una emisă (`[PERSOANA_999]`, `[PERSOANA_1_F9]`, `[persoana_1]`,
  `PERSOANA_1`) sau o etichetă ruptă (rând nou, spațiu neîntreruptibil sau caracter invizibil în ea: `[PERSOANA_` + rând nou +
  `999]`). „Aproape etichetă” înseamnă doar ce nu poate fi proză: între **paranteze drepte**, sau fără paranteze dar cu categoria
  **exactă, cu majuscule, și „_”** (`PERSOANA_1`). „firma 2 a contractat lucrarea”, „persoana 2”, „CUI 12345678” nu opresc
  publicarea. Între paranteze, categoria contează în orice scriere („[persoană_` + rând nou + `1]” rămâne oprit).
- Dacă răspunsul ar ieși cu etichete în locul numelor (demascarea n-a avut loc), nu se publică.

## Regula B: „Da” / „Nu” / „Incert” (r5 — STRUCTURALĂ)
- Sunt doar trei verdicte. „Depinde de X” devine „Incert — depinde de X”.
- **Contractul exact.** „Da” / „Nu” trec numai dacă pe un rând al răspunsului, lângă marcajul sursei (`[C1]`, `[W2]`), e un citat
  (între ghilimele, cel puțin 6 cuvinte) EGAL cu un PARAGRAF ÎNTREG al acelei surse, iar paragraful e autonom. Ce înseamnă:
  1. **Paragraful** se stabilește ÎN SURSĂ, înainte de extragere și de mascare, fără a elimina rândurile noi: paragrafele sunt
     despărțite de un rând gol (unul sau mai multe, cu spații / tab-uri). Orchestrarea (Python) dă motorului, pentru fiecare extras,
     textul brut cu rândurile noi, dacă marginile extrasului sunt margini reale de paragraf (`inceput_sigur` / `sfarsit_sigur`) și
     paragraful PRECEDENT din sursă — text brut, `''` dacă extrasul e la începutul fișierului, `null` dacă nu se cunoaște (indexul
     corpusului îl scrie pentru fiecare bucată: rândurile de titlu din documente („## Titlu”) sunt și ele paragrafe; înregistrările JSON și
     fragmentele web nu au precedent cunoscut). Citatul se compară cu paragraful corespunzător din textul mascat (cel văzut de model);
     dacă mascarea a schimbat numărul de paragrafe, toate paragrafele acelei surse sunt „context necunoscut”.
  2. **O singură propoziție.** Granițele de propoziție sunt voit excesive: orice „.”, „!”, „?”, „;” urmat (eventual după ghilimele
     sau paranteze de închidere) de un spațiu, și orice rând nou din interiorul paragrafului. Un paragraf cu două sau mai multe
     propoziții nu susține niciodată singur un „Da” / „Nu” — și nici citat întreg, nici o propoziție din el (motivul
     `mai_multe_propozitii`). Abrevierile („art. 5”) dau granițe false, deci „Incert”: e partea sigură.
  3. **Element de listă** (motivul `element_lista`), definit structural, fără alfabete enumerate și fără plafon de lungime — oricare
     dintre condiții:
     - după spațiile și ghilimelele de deschidere (`„` `“` `"` `«` `‚` `‘` `'` `` ` ``), paragraful începe cu un șir de litere / cifre
       Unicode (orice capitalizare, cifre romane incluse) urmat de `)`, sau de `.` / `:` urmat de spațiu, de sfârșit sau direct de o
       **literă** (`B) `, `12345) `, `iv. `, `IV) `, `Art. `, `B.Executarea`, `1.Executarea`);
     - r7 (review r6 P2-3) — **numerotarea compusă**, pe reprezentarea comună a textului (cifrele / literele late și spațiile speciale
       devin obișnuite), cu majusculele verificate ÎNAINTEA trecerii la litere mici: (C1) litere + `.` + cifre (`A.1 text`,
       `A.1.text`, `B.2) text`, `a.2 text`); (C2–C5) `cifre.cifre` la început (`1.1.Executarea`, `1.2.3 text`, `1.1. text`,
       `1.1) text`, `1.1 Executarea`, `1.1 executarea`, `1.1Executarea`) — cu O SINGURĂ excepție, ÎNCHISĂ (C4): `cifre.cifre` +
       spații + unitatea EXACTĂ `bar` sau `m`, scrisă mic, cu limită de cuvânt = cantitate zecimală, paragraful rămâne autonom
       (`6.5 bar reprezinta presiunea maxima admisa pentru proba conductelor.`, `0.5 m …`). **Costurile declarate:** `2.5 MPa …`,
       `6.5 BAR …`, `6.5bar …`, `6.5 bari …` și orice altă unitate după un număr zecimal cu punct dau „Incert”; `1.1 m …` e citit ca
       cantitate (ambiguu textual). Celelalte indicii de listă (paragraful precedent / propriul sfârșit în `:` / `;`) prevalează asupra
       excepției. Virgula zecimală (`6,5 bar …`) nu e atinsă (C6). Marcajele blochează și „Da”, și „Nu”;
     - începe cu `(` + litere / cifre + `)` (`(b)`, `(12)`);
     - începe cu un semn de listă: U+2022 `•`, U+2023 `‣`, U+2043 `⁃`, U+2219 `∙`, U+25AA `▪`, U+25AB `▫`, U+25A0 `■`, U+25A1 `□`,
       U+25CF `●`, U+25CB `○`, U+25E6 `◦`, U+25B8 `▸`, U+25BA `►`, U+00B7 `·` (punctul median), `*`, `+`, U+2212 `−`, `§`, sau
       ORICE caracter din categoria Unicode Pd (toate cratimele și liniuțele);
     - paragraful PRECEDENT din sursă se termină cu `:` sau `;` (după spații, ghilimele, paranteze și semne de evidențiere de
       închidere);
     - paragraful însuși se termină cu `:` sau `;`.
  4. **Listele închise**, căutate ca cuvinte întregi în propoziția unică (forme normalizate: litere mici, fără diacritice; enumerate
     integral în `src/intrebariMascare.js`, constantele `TRIMITERI`, `TRIMITERI_EXPRESII`, `EXCEPTII`, `EXCEPTII_EXPRESII`):
     - **trimiteri** (motivul `trimitere`): conform, conformitate, potrivit; prevazut, prevazuta, prevazute, prevazuti, prevazutul,
       prevazutei, prevazutului, prevazutelor, prevazutilor; mentionat, mentionata, mentionate, mentionati, mentionatul, mentionatei,
       mentionatului, mentionatelor, mentionatilor; precedent, precedenta, precedente, precedenti, precedentul, precedentei,
       precedentului, precedentelor, precedentilor; anterior, anterioara, anterioare, anteriori, anteriorul, anterioarei,
       anteriorului, anterioarelor, anteriorilor; urmator, urmatoare, urmatori, urmatorul, urmatoarea, urmatoarele, urmatorii,
       urmatorului, urmatoarei, urmatorilor; acest, aceasta, acesta, aceste, acestea, acesti, acestia, acestui, acestei, acestor,
       acestuia, acesteia, acestora; acel, acela, acea, aceea, acei, aceia, acele, acelea, acelui, acelei, acelor, aceluia, aceleia,
       acelora; respectiv, respectiva, respective, respectivi, respectivul, respectivei, respectivului, respectivelor,
       respectivilor; prezentul, prezenta, prezentele, prezentului, prezentei, prezentelor; art, articol, articolul, articolului,
       articole, articolele, articolelor; alin, alineat, alineatul, alineatului, alineate, alineatele, alineatelor; lit, litera,
       literei, literele, literelor; pct, punctul, punctului, punctele, punctelor; anexa, anexe, anexei, anexele, anexelor, anexat,
       anexata, anexate, anexati; capitol, capitolul, capitolului, capitole, capitolele, capitolelor; sectiune, sectiunea,
       sectiunii, sectiuni, sectiunile, sectiunilor; tabel, tabelul, tabelului, tabele, tabelele, tabelelor, tabela, tabelei;
       figura, figurii, figuri, figurile, figurilor; el, ea, ei, ele; expresiile „mai sus”, „mai jos”;
     - **deschideri de excepție** (motivul `exceptie`): derogare, derogarea, derogari, derogarile, derogarii, derogarilor, deroga,
       derogat, derogata, derogate, exceptand, exceptie, exceptia, exceptii, exceptiile, exceptiei, exceptiilor; expresiile „prin
       derogare”, „cu exceptia”, „nu se aplica”, „nu sunt aplicabile”, „nu este aplicabil”, „nu este aplicabila”, „nu sunt
       aplicabili”, „in afara de”, „in afara cazului”, „in afara situatiei”, „sub rezerva”, „fara a aduce atingere”.
     Altă formulare a unei trimiteri sau a unei excepții = limită declarată (mai jos).
  5. **Refuzurile păstrate:** marginea extrasului care nu e margine de paragraf sau „…” / „...” în paragraf (`context_taiat`; toate
     fragmentele web sunt tăiate din pagină); paragraful precedent necunoscut (`context_necunoscut`); „|” sau tab — celulă de tabel
     (`tabel`); paragraful nu începe cu majusculă sau cifră (`fragment`) sau nu se termină cu „.”, „!”, „?” (`fara_sfarsit`); citatul
     are sub 6 cuvinte sau nu e pe un rând cu marcajul sursei.
  6. **Autonomia e NECESARĂ, nu suficientă.** Un paragraf autonom poate totuși să nu susțină concluzia: „Montajul conductelor este
     permis exclusiv pe podurile metalice.” trece regula B, dar nu susține un „Da” pentru podurile din lemn — acolo îl oprește
     validarea răspunsului (susținerea și polaritatea, în `cercetare.py` / `src/intrebariSurse.js`, cazul e în setul comun). Regula B
     rulează după validare și e ultimul pas pe text: niciun pas din Python nu poate transforma refuzul ei într-un „Da” / „Nu” (test pe
     fluxul complet + mutantul „worker care ignoră rezultatul regulii B”).
- **Compararea citatului nu folosește normalizarea permisivă a numelor:** semnele, cifrele, operatorii și diacriticele cu sens se
  păstrează (`-5 ≠ 5`, `≤ ≠ <`, `sau ≠ său`). Contează doar: majusculele, spațiile, ghilimelele, sedila / virgula de sub ș / ț, felul
  liniuței (o liniuță tipografică în fața unei cifre rămâne semn minus) și punctuația de la sfârșit.
- **Cererea către model** spune exact: „Da” / „Nu” doar cu un PARAGRAF ÎNTREG, copiat exact de la începutul la sfârșitul lui, cu o
  singură propoziție; repararea (o singură dată) repetă cerința.
- Fără un asemenea citat, verdictul devine **„Incert — de verificat: niciun citat nu reproduce exact un paragraf întreg și de sine
  stătător dintr-o sursă — citește sursele alăturate.”**, iar ecranul pune toate sursele consultate imediat sub verdict.
- **Costul (acceptat):** mai puține „Da” / „Nu” — orice paragraf cu două propoziții, orice abreviere urmată de spațiu, orice listă,
  orice trimitere sau excepție din listele închise și orice paragraf al cărui precedent nu se cunoaște dau „Incert”.
- **Limitele declarate:** regula verifică integritatea și autonomia STRUCTURALĂ a textului, nu sensul. Dependențele pe care nu le
  recunoaște rămân nevăzute: o restricție aflată în ALT paragraf decât cel precedent (mai sus în document, într-un tabel, într-o
  notă), o trimitere sau o excepție scrisă altfel decât în listele închise, o listă fără marcaj și fără „:” / „;” înainte. Omul vede
  citatul și sursa alăturate.

## Testele (pe scurt)
- Un set de cazuri scrise de mână, `worker/intrebari-tehnice/teste_motor.json`, rulat de trei ori: **vitest** pe motor
  (`src/intrebariMascare.test.js`), **procesul Node real** prin `motor.py` (`test_motor.py`, `test_worker.py` — transportul spre
  model e simulat, motorul nu) și un **browser real** (`worker/intrebari-tehnice/motor_browser.html`: din rădăcina repo-ului
  `python -m http.server 8765 --bind 127.0.0.1`, apoi `http://127.0.0.1:8765/worker/intrebari-tehnice/motor_browser.html` — rezultatul
  în pagină și în `window.REZULTAT_MOTOR`). r5: așteptările din r4 care lăsau vizibile componente acum contractate (persoane scrise
  mic, componenta distinctivă singură, „gama de feronerie” după firma întreagă) sunt ÎNLOCUITE; probele pozitive legitime („Da”
  păstrat) și cele pentru entitățile publice / localități rămân.
- Mutanți: câte o regulă scoasă pentru fiecare rând al contractului și pentru fiecare regulă a regulii B (context tăiat,
  context necunoscut, tabel, cele trei condiții ale elementului de listă, categoria Pd, plafonul de lungime al marcajului, literele
  mari din marcaj, paragraful cu mai multe propoziții, granițele „;” și „rând nou”, trimiteri, excepții, fragment, fără sfârșit,
  alinierea paragrafelor brute și mascate, compararea permisivă) — vitest; fiecare cale de eroare a procesului (procesul de test
  `test_motor_defect.mjs`, inclusiv cel care nu citește intrarea): zero cereri noi, zero răspunsuri publicate.
- r6 (review r5): recunoașterea pe textul brut (mutantul pică pe cazurile cu litere late), persoanele nedelimitate (orice componente
  alăturate = un nume), varianta lipită care acoperă mai puțin, marcajul „.” urmat de cifră — fiecare cu mutantul lui; **inventarul
  închis** al funcțiilor care aplică o expresie regulată, fiecare clasificată (reprezentarea de recunoaștere / listele / excepție cu
  motiv: etichetele emise, regula B, ecranul), plus verificarea că etapele de recunoaștere sunt apelate doar din `detecteaza`, iar
  `detecteaza` primește doar reprezentarea; **invarianța la reprezentare**: fiecare caz scris de mână, rescris cu litere late sau
  descompus (NFD), dă aceeași mascare.
- r7 (review r6): cazurile recenzentului și contraexemplele contractului (titlu + persoane alăturate, persoana necunoscută care se
  oprește, contextul doar primului grup, nume incluse, forme ambigue izolate, învățarea în ambele ordini, puntea tranzitivă, egalitatea
  cu identități incompatibile, două intrări cu aceeași mulțime, numerotările compuse C1–C5 cu „Da” și cu „Nu”, excepția închisă C4 și
  virgula zecimală păstrate); mutanți: contextul titlului pe toată fereastra, titlul care construiește singur intervalul, fără
  potrivirea exactă (B1), forma ambiguă legată de primul nume (B3), fără departajarea după numele exacte, prima împărțire la egalitate,
  oprirea la primul nume complet, al doilea prenume care repetă o componentă, fără C1, fără C2–C5, excepția C4 lărgită / scoasă / fără
  majuscule / fără limita de cuvânt, numerotarea pe textul brut; **inventarul închis al căilor de persoane** (A1) cu contraexemple;
  identitatea din dicționar (B1–B3) testată direct, independentă de ordinea intrărilor din listă și stabilă la schimbarea ordinii de
  învățare (aceleași clase de forme în orice ordine a textelor).

### Matricea generativă (criteriul de acceptare L25)
`worker/intrebari-tehnice/generativ.mjs` — fără niciun import și fără funcțiile motorului — generează PRODUSUL COMPLET al
dimensiunilor de mai jos. Pentru fiecare caz știe intervalul exact al numelui în text, iar oracolul cere: (a) intervalul așteptat e
înlocuit INTEGRAL de o etichetă validă și restul textului e neatins; (b) forma normalizată a ieșirii nu conține componenta
distinctivă; (c) demascarea dă textul inițial; (d) cazurile negative rămân neschimbate; (e) r6: la persoanele diferite alăturate,
fiecare interval are eticheta altei entități; (f) r7: identitățile așteptate — calculate în generator, din contract (B1–B5: toate
împărțirile șirului de cuvinte alăturate, identitatea fiecărui grup din dicționarul de test, egalitatea cu identități diferite =
un grup ambiguu), fără funcțiile motorului — două intervale au aceeași entitate DACĂ ȘI NUMAI DACĂ au aceeași identitate așteptată
(la forma ambiguă: ascunsă și cu altă entitate decât numele complete). Cazurile în care contractul nu decide intervalul (aceleași
identități, granițe diferite) se exclud și se numără — în domeniul de mai jos: zero. Fără (a), „AlfaSRL” (fără componentă distinctivă) ar trece nemascat.
`src/intrebariMascare.generativ.test.js` rulează ACELEAȘI loturi pe fire de lucru din vitest și în procese Node cu flagurile din
`motor.py`, cere zero eșecuri în ambele și aceeași amprentă sha256 a ieșirilor pe fiecare lot; loturi de cel mult 100.000 de
cazuri, fără plafon total (toate loturile rulează; r7: ≈ 5,3 minute pe serverul AI, 8 fire + 8 procese). Testul verifică și că
tabelul de mai jos are exact cifrele generatorului.

**Domeniul publicat** (dicționarul de test: persoanele VLĂDESCU ANA, ZAMFIRESCU MARIA, ȘERBĂNESCU OLGA, CRÂNGAȘU VIOREL, MARE ION,
DUMBRĂVEANU ANDREEA-IOANA; firmele Lumivo Servicii SRL — distinctivă pe prima poziție, Varnitec SRL — un cuvânt distinctiv, Alfa SRL —
un cuvânt comun, Construct Pelorîn SRL — distinctivă pe a doua poziție, cu diacritice, Barzeni Instal Grup SRL — trei cuvinte,
Transgaz Construct SRL — începe cu o entitate publică; CUI 12345678; localitatea Berceni). Valorile:
- majuscule: ca în listă, MAJUSCULE, litere mici, mixt (prima literă mică, restul mari) — 4;
- diacritice: cu / fără (doar unde numele are diacritice);
- separatoare de firmă: spațiu, NBSP, U+2009, U+3000, tab, CR, LF, `,` `.` `"` `'` `„` `”` `“` `«` `»` `‚` `‘` `’` `(` `)` `&` `+`
  `/` `\` `-` U+2010 U+2011 și două combinații de 6 caractere — 30 (fiecare caracter = limita 1, combinațiile = limita 6);
- separatoare de persoană: spațiu, NBSP, U+2009, tab, `,`, „, ”, `"` `'` `„` `”` `(` `)` `&` `+` `/` `\` `-` U+2010 U+2011 și o
  combinație de 6 caractere — 20;
- separatoare de firmă în familia reprezentării (r6): spațiu, U+3000, `,`, `/` — 4 (la literele late `,` și `/` devin U+FF0C, U+FF0F);
- separatoare între două persoane diferite (r6): spațiu, NBSP, două spații, „, ”, „ & ”, „ și ”, `/` — 7; între trei: spațiu, „, ” — 2;
- forme juridice (r6: FIECARE formă din contract): niciuna; `SRL`, `SA`, `PFA`, `II`, `IF`, `SNC`, `SCS`, fiecare despărțită fără
  puncte, despărțită cu puncte (`S.R.L.`, `I.I.`…), lipită fără puncte, lipită cu puncte (28); `srl`, `pfa`, `snc`, `scs` scrise mic,
  despărțite și lipite (8; `sa`, `ii`, `if` scrise mic sunt cuvinte — contract) — 37;
- „SC”: nimic, „SC ”, „S.C. ”, „SC” lipit, „S.C.” lipit — 5;
- reprezentarea (r6): N = litere obișnuite; L = toată bucata (nume, separatoare, „SC”, forma juridică) cu litere late U+FF01–FF5E (o
  literă cu diacritic = litera lată + semnul de combinare); F = doar „SC” și forma juridică cu litere late;
- flexiuni: niciuna și fiecare din cele 11 sufixe (doar pe o bază de cel puțin 4 litere), plus genitivul feminin la prenumele în -a;
- invizibile: niciunul, U+034F (M) și U+200B (Cf), fiecare la începutul, mijlocul și sfârșitul componentei distinctive — 7;
- poziții în propoziție: început, interior, sfârșit — 3; ordinea persoanelor: Nume Prenume / Prenume Nume; cratimele prenumelui
  compus: `-`, U+2010, U+2011;
- r7 — titluri: „dl. ”, „Dl. ”, „ing. ”, „dna ”, „colegul ” — 5; separatorul dintre două persoane după titlu: spațiu, „, ”, NBSP — 3;
  cuvintele necunoscute de după titlu: 0–3 din Popovici, Tudorache, Iordache, „Ca Titlu” sau MAJUSCULE; ce urmează după ele: fiecare
  persoană în fiecare ordine (12), componenta comună Mare / Ion singură (2), persoană + componentă comună (3), nimic (1);
- r7 — al doilea dicționar de test, cu nume INCLUSE (familiile `nume_incluse_alaturate`, `forme_ambigue_si_punti`): VLĂDESCU ANA ⊂
  VLĂDESCU ANA MARIA, ȘERBĂNESCU OLGA ⊂ ȘERBĂNESCU OLGA ELENA, MARE ION; toate ordinile componentelor fiecărui nume (2 și 6); care nume
  e primul (2); separatorul dintre nume: spațiu, „, ”, NBSP, „ și ” — 4; titlul: fără, „dl.” — 2; formele ambigue (în ambele nume):
  `Vlădescu`, `Vlădescului`, `Ana` / `Șerbănescu`, `Olga`; ordinea celor trei bucăți (numele scurt, cel lung, forma ambiguă): toate 6;
  separatorul dintre bucăți: „; apoi ”, „ și ”, „, ” — 3; cu / fără pre-trecere (învățarea) — 2; majuscule: ca în listă, MAJUSCULE,
  litere mici — 3 (`ana` scrisă mic și singură nu e componentă distinctivă: rămâne vizibilă, deci în afara familiei — 2.592 de
  combinații numărate ca neaplicabile).

| Familia | Dimensiuni (numărul de valori) | Produs | Loturi |
|---|---|---|---|
| `firme_nume_intreg` | (firma × diacritice × separator: 122 de variante aplicabile) × majuscule 4 × formă juridică 37 × „SC” 5 × flexiune 12 × invizibil 7 × poziție 3 | 22.750.560 | 228 |
| `firme_reprezentare` | (firma × diacritice × separator spațiu / U+3000 / `,` / `/`: 18) × reprezentare L, F 2 × majuscule 4 × formă juridică 37 × „SC” 5 × flexiune 12 × invizibil 7 × poziție 3 | 6.713.280 | 68 |
| `conflict_entitate_publica` | majuscule 4 × separator 30 × formă juridică 37 × poziție 3 (Transgaz Construct, întreagă) | 13.320 | 1 |
| `firme_componenta_singura` | (componenta distinctivă, oricare poziție × diacritice: 4) × reprezentare N, L, F 3 × majuscule 4 × formă juridică 37 × „SC” 5 × flexiune 12 × invizibil 7 × poziție 3 | 2.237.760 | 23 |
| `persoane_nume_intreg` | (persoana × ordine × diacritice × flexiunea ultimei componente × cratimă: 314) × reprezentare N, L 2 × majuscule 4 × separator 20 × invizibil 7 × poziție 3 | 1.055.040 | 11 |
| `persoane_componenta_singura` | (componenta × diacritice × flexiune: 174) × reprezentare N, L 2 × majuscule 4 × invizibil 7 × poziție 3 | 29.232 | 1 |
| `persoane_alaturate` | (perechea ordonată de persoane diferite × ordinea fiecăreia × diacritice: 232) × reprezentare N, L 2 × majuscule 4 × separatorul dintre ele 7 × poziție 3 | 38.976 | 1 |
| `persoane_trei` | (trei persoane diferite, în ordine × ordinea fiecăreia: 960) × majuscule 4 × separator 2 × poziție 3 | 23.040 | 1 |
| `persoana_si_componenta_comuna` | (persoana, alta decât MARE ION × ordine: 10) × componenta comună Mare / Ion 2 × înainte / după 2 × majuscule 4 × separator 2 × poziție 3 | 960 | 1 |
| `context_si_propagare` | 9 perechi (componenta singură scrisă mic / comună + numele întreg) × înainte / după × flexiune 3 × poziție 3 (24 de combinații neaplicabile: flexiune pe o bază sub 4 litere → 138 de cazuri) | 162 | 1 |
| `exceptii` | 26 de cazuri (entități publice, localitate, componente generice și comune singure, CUI fragmentat și negative; r6: și cu litere late) × poziție 3 | 78 | 1 |
| `titlu_persoane_alaturate` | r7: (perechea ordonată de persoane diferite × ordinea fiecăreia × diacritice: 232) × titlu 5 × majuscule 4 × separatorul dintre ele 3 × poziție 3 | 41.760 | 1 |
| `titlu_necunoscut_si_lista` | r7: titlu 5 × cuvinte necunoscute 0–3 (4) × ce urmează 18 × majusculele necunoscuților 2 × majusculele persoanei 2 × poziție 3 (570 neaplicabile: fără cuvinte necunoscute, variantele lor de majuscule și „nimic” → 3.750 de cazuri) | 4.320 | 1 |
| `nume_incluse_alaturate` | r7: (perechea de nume incluse × care e primul × ordinea componentelor scurt 2 × lung 6: 48) × diacritice 2 × majuscule 3 × separator 4 × titlu 2 × poziție 3 | 6.912 | 1 |
| `forme_ambigue_si_punti` | r7: (perechea × forma ambiguă × ordinea componentelor scurt × lung: 60) × ordinea bucăților 6 × diacritice 2 × majuscule 3 × separator 3 × pre-trecere 2 × poziție 3 (2.592 neaplicabile: `ana` scrisă mic și singură → 36.288 de cazuri) | 38.880 | 1 |
| **Total** | | **32.954.280** | **341** |

**r7 — familiile noi, rulate pe motorul r6 (`ade7b3c3`) înainte de reparație** (fiecare familie are un singur lot, lotul 0): toate
pică pe clasele raportate — `titlu_persoane_alaturate` 8.040 de eșecuri (`dl. Vlădescu Ana Zamfirescu Maria` → titlul lua trei
cuvinte), `titlu_necunoscut_si_lista` 1.350 (`dl. Vlădescu Ana Mare` → „Mare” absorbit; `dl. Popovici Vlădescu Ana` → o persoană),
`nume_incluse_alaturate` 6.696 (`Vlădescu Ana Vlădescu Ana Maria` → aceeași entitate), `forme_ambigue_si_punti` 36.288 (forma
ambiguă unită cu un nume complet). Pe r7: zero eșecuri, zero cazuri nedecise de contract.

**Tăietura declarată (r6).** Produsul complet al TUTUROR dimensiunilor într-o singură familie de firme (122 × 3 reprezentări × 4 × 37 ×
5 × 12 × 7 × 3 = 68.251.680 de cazuri, ≈ 9–10 minute pe rulare) nu se rulează: reprezentarea (L, F) e încrucișată complet cu
majusculele, formele juridice, „SC”, flexiunile, invizibilele și pozițiile, dar doar cu 4 separatoare (spațiu, U+3000, `,`, `/`), nu
cu toate 30; cele 30 de separatoare sunt încrucișate complet cu restul în reprezentarea N. La persoane: perechile și tripletele de
persoane alăturate nu au flexiuni și caractere invizibile (acestea sunt încrucișate în `persoane_nume_intreg`), iar `persoane_trei`
e doar în reprezentarea N, cu diacritice. r7: familiile cu titlu și cu nume incluse sunt în reprezentarea N, fără flexiuni (afară de
`Vlădescului`) și fără caractere invizibile — acestea sunt încrucișate în familiile vechi, pe aceeași delimitare.

Ce NU acoperă matricea: combinațiile în afara domeniului de mai sus (alte nume, alte caractere, alte poziții); pentru ele rămân
contractul, cazurile scrise de mână și mutanții. Matricea e dovada pentru combinațiile enumerate, nu o demonstrație universală.

## Pașii de pornire (pentru coordonator — după review și „da”-ul lui Răzvan)
Nu e nevoie de migrare și nici de secrete noi. **Merge-ul NU publică funcția edge și NU pornește workerul.** Workerul stă OPRIT pe
toată livrarea; testul de fum se face cu rularea periodică încă dezactivată. Ordinea:
1. **Workerul e oprit — dovedit, nu presupus.** Pe serverul AI, în PowerShell (se notează rezultatul fiecăreia):
   - task-ul planificat e dezactivat: `schtasks /Change /TN "Intrebari tehnice worker (Gazpet)" /DISABLE`, apoi
     `(Get-ScheduledTask -TaskName "Intrebari tehnice worker (Gazpet)").State` → `Disabled`;
   - niciun proces al workerului **și niciun proces al motorului**:
     `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*intrebari_worker.py*" -or $_.CommandLine -like "*motor_cli.mjs*" }`
     → nimic (dacă apare unul, se așteaptă să se termine și se repetă verificarea);
   - lacătul de sistem e liber: cu Python-ul workerului, în folderul workerului,
     `python -c "import msvcrt; f=open('worker.lock','a+b'); msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1); print('LIBER')"` → `LIBER`.
   Fără toate trei nu se trece mai departe. Workerul rămâne dezactivat până la pasul 10.
2. Merge PR-ul (motor + ecran + worker + corpus; edge-ul din PR-ul anterior, neschimbat aici).
3. Interogarea de verificare a coloanelor (secțiunea „De unde vin numele”) → 0 rânduri lipsă. Altfel: stop.
4. Dacă edge-ul `intrebari-tehnice-worker` nu e încă publicat cu acțiunea `nume` (verdictul r3: „GO cu condiții”): deploy cu
   workerul oprit, **`index.ts` și `logic.js` împreună**, `verify_jwt = false`, aceleași setări (`SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, secretul din Vault `INTREBARI_WORKER_SECRET`).
   **Găsit la pornire (14.11.2026):** publicarea se face prin workflow-ul manual de deploy, iar acolo `verify_jwt = false` îl primesc
   doar funcțiile din lista `NO_JWT`. Funcția rula deja cu `verify_jwt = false` (publicată pe 06.11.2026 în afara workflow-ului), dar
   nu era în listă: un deploy din workflow ar fi pus `verify_jwt = true`, iar workerul — care trimite doar antetul
   `x-intrebari-secret` — ar fi fost oprit de platformă înaintea codului. Slug-ul e acum în listă. Verificarea fără nicio cheie,
   înainte și după deploy: o cerere POST fără antete de autentificare trebuie să primească **401 cu răspunsul funcției**
   (`{"error":"Neautorizat"}`), nu refuzul platformei pentru antetul de autorizare lipsă.
5. Verificarea acțiunii `nume` FĂRĂ worker: cu secretul → **200** cu `persoane`, `firme`, `cui` nevide și `localitati` (doar numărul
   lor se notează); fără antet / cu cheia anon / cu un JWT de cont obișnuit / cu un secret greșit → **401**. Altfel: stop.
6. **Node, Python și drepturile pe server (r5: rezultatele acceptate sunt scrise; la orice neconformitate workerul NU pornește):**
   - `node --version` → `v24.x` (pe 13.11.2026: `v24.20.0`) și `node -p "process.versions.unicode"` → aceeași valoare ca `unicode`
     din `motor_manifest.json` (`17.0`). Altfel: stop — fie se instalează versiunea fixată, fie se reface manifestul printr-un PR
     (`node scripts/intrebari/manifest_motor.mjs`) și se rulează din nou testele. Dacă `node` nu e în PATH-ul contului care rulează
     task-ul, se setează `INTREBARI_NODE` (calea completă) în acțiunea task-ului;
   - Python-ul task-ului (calea din acțiunea task-ului) `--version` → `3.12.x` sau `3.13.x` (cel cu care au trecut testele de la
     pasul 8). Altă versiune: stop, până se rulează testele cu ea;
   - ACL-ul dosarului workerului, al subdosarului lui `motor\` și al **dosarului temporar folosit EFECTIV de worker** (acolo se face
     instantaneul; `icacls` pe fiecare) → **acceptat**: drept de scriere (`F`, `M` sau `W`) DOAR pentru contul task-ului,
     `NT AUTHORITY\SYSTEM` și `BUILTIN\Administrators`. Orice alt cont sau grup cu drept de scriere (`Everyone`, `BUILTIN\Users`,
     `Authenticated Users`, alt utilizator) → stop: workerul nu pornește până când ACL-ul e corectat (decizia coordonatorului, cu
     „da”-ul lui Răzvan). Instantaneul nu e imutabil absolut (vezi „Cum e păzit procesul motorului”), de aceea contează cine poate
     scrie acolo.
     **Care e dosarul temporar efectiv** (14.11.2026): cel întors de `tempfile.gettempdir()` în procesul workerului, pornit cu EXACT
     acțiunea task-ului — nu neapărat `$env:TEMP` al contului. Dacă dosarul temporar al contului e acceptat, se poate folosi el. Pe
     serverul AI nu e (un grup de izolare al altor unelte are drept de modificare acolo) și nu se schimbă, ca să nu strice acele
     unelte: workerul are **dosarul lui temporar**, subdosarul `tmp\` al dosarului workerului (moștenește ACL-ul acceptat), dat prin
     variabila `TMPDIR`. Task Scheduler nu poate pune variabile de mediu, așa că ele se pun **în același proces Python**, înaintea
     încărcării workerului, iar pornirea e **refuzată** dacă `tempfile` n-a ales dosarul dedicat (lipsește sau nu se poate scrie în
     el — altfel `tempfile` ar trece în tăcere la următorul dosar din lista lui, adică la cel al contului):
     `pythonw -B -c "import os, sys, runpy, tempfile; d = r'<dosarul workerului>'; t = d + r'\tmp'; os.environ['TMPDIR'] = t; os.environ['INTREBARI_NODE'] = r'<calea completă a lui node.exe>'; sys.path[0] = d; os.path.normcase(tempfile.gettempdir()) == os.path.normcase(t) or sys.exit(3); runpy.run_path(d + r'\intrebari_worker.py', run_name='__main__')"`,
     cu dosarul de lucru = dosarul workerului. `INTREBARI_NODE` fixează binarul lui Node (scris doar de administratori), în loc de
     căutarea în PATH.
     Probat cu un script de probă în locul workerului, cu aceeași acțiune: `__name__`, `__file__`, `sys.argv[0]`, `sys.path[0]`,
     importul modulelor de lângă script și codul de ieșire sunt ca la pornirea directă; `tempfile.gettempdir()` = dosarul `tmp\`;
     dosarul creat de `tempfile.mkdtemp` (Python 3.13) are drepturi doar pentru `OWNER RIGHTS`, `SYSTEM` și `Administrators`, fără
     moștenire; cu dosarul dedicat lipsă, procesul iese cu codul 3 și scriptul nu rulează. Tot la pornire s-a găsit că dosarul
     workerului moștenea din dosarul public drept de modificare pentru grupurile de sesiune ale sistemului (sesiuni interactive,
     servicii, sarcini planificate): moștenirea a fost scoasă, au rămas doar cele trei conturi acceptate.
     Testul de fum (pasul 9) pornește workerul cu EXACT acțiunea task-ului, citită din task.
7. Pe serverul AI, cu workerul oprit, copierea fișierelor din `main` în folderul workerului (`C:\Users\Public\intrebari_worker\`):
   - lângă script: `intrebari_worker.py`, `cercetare.py`, **`motor.py`**, `corpus_manifest.json`, **`motor_manifest.json`**,
     `vocabular_web.json` (din `worker/intrebari-tehnice/`);
   - motorul, în subfolderul **`motor\`**, **păstrând căile din repo** (exact lista din `motor_manifest.json`):
     `motor\src\intrebariMascare.js`, `motor\worker\intrebari-tehnice\motor_protocol.mjs`, `motor\worker\intrebari-tehnice\motor_cli.mjs`,
     `motor\worker\intrebari-tehnice\nemascate.json`, `motor\worker\intrebari-tehnice\vocabular_web.json`,
     `motor\worker\intrebari-tehnice\cuvinte_comune.json` (workerul caută motorul în `motor\` de lângă el; altă locație = variabila
     `INTREBARI_MOTOR_RADACINA`);
   - **indexul corpusului se reface** (r5: fiecare bucată are acum și paragraful precedent din sursă): din clona de pe `main`,
     `node scripts/intrebari/construieste_corpus.mjs C:\Users\Public\intrebari_worker\corpus_index.json`; amprenta lui trebuie să
     fie cea din `corpus_manifest.json` (workerul o verifică la pornire; altfel nu preia nimic);
   - **`mascare.py` vechi se șterge** din folderul workerului (nu mai e folosit; rămas acolo ar crea confuzie).
   Verificarea: `node scripts/intrebari/manifest_motor.mjs --verifica` în clona de pe `main` → „la zi”; workerul verifică singur,
   la pornire, amprentele fișierelor copiate (cu finaluri de linie LF) — o diferență = `motor_invalid` în jurnal, nicio preluare.
8. Testele pe `main`, în clona repo-ului de pe server: `npm install` + `npx vitest run src/intrebariMascare.test.js
   src/intrebariMascare.generativ.test.js src/intrebariSurse.test.js scripts/intrebari/corpus.test.mjs` și
   `python -I -B -m unittest discover -s worker/intrebari-tehnice -p "test_*.py"` (aceeași versiune de Python ca workerul, Node 24
   în PATH) — toate OK. Opțional, testul în browser (secțiunea „Testele”).
9. **Testul de fum controlat, cu task-ul încă DEZACTIVAT:** coada are doar întrebarea de test a ownerului (nume inventate, un
   genitiv, o localitate, un nume cu un caracter invizibil copiat, un nume scris cu litere mici). Se pornește workerul **o singură
   dată, de mână**; se verifică: răspunsul afișat are numele la loc și nicio etichetă; jurnalul are `nume_incarcate` (doar numere),
   apoi `mascate`, `inlocuiri`, `regula_b` — fără valori; niciun proces `motor_cli.mjs` rămas (verificarea din pasul 1). Orice
   abatere: stop, se raportează.
10. Abia acum se reactivează rularea periodică: `schtasks /Change /TN "Intrebari tehnice worker (Gazpet)" /ENABLE` → `Ready`.
11. Registrul: rândul de mai jos în `registru_automatizari` și în `public.automatizari` (fără valori de secrete).

Revenirea: workerul se oprește întâi (pasul 1), apoi fișierele workerului, ale motorului și indexul corpusului se întorc împreună la
versiunea anterioară (edge-ul poate rămâne: lista de nume e aceeași).

## Rândul propus pentru `registru_automatizari` (înlocuiește fișa „Întreabă echipa”)
**Întreabă echipa (intrebari-tehnice-worker) — actualizare 13.11.2026: mascarea numelor (A) + regula „Da / Nu / Incert” (B), r5
motorul unic, regula B structurală.**
- **Ce**: spețe tehnice din ERP (`/intrebari`) → răspuns AI informativ, din cercetare, vizibil doar autorului și ownerului. Numele de
  persoane / firme și datele personale se ascund înainte de orice apel la furnizor (motorul unic, un proces Node local pe
  întrebare) și se pun la loc doar în textul afișat; atașamentele nu se trimit la furnizor; „Da” / „Nu” doar cu un citat identic cu
  un paragraf întreg, dintr-o singură propoziție și de sine stătător, al sursei, altfel „Incert” cu sursele alăturate.
- **(a) Conținut extern**: textul spețelor (scris de colegi), paginile oficiale găsite de căutarea web (domenii fixe), extrasele din
  corpusul intern. Intern: numele angajaților și ale terților (citite de edge din BD, doar coloanele de nume / CUI, plus
  localitățile din `red_uat`) — folosite doar pentru mascare, în memoria procesului motorului.
- **(b) Ce poate scrie / face**: doar răspunsul sau eroarea pe rândul întrebării preluate + jurnalul de preluări. Procesul motorului:
  nu scrie pe disc și nu pornește alte procese (permisiunile Node); codul fixat prin manifest nu conține apeluri de rețea (verificare
  a codului, nu izolare a procesului). Fără mail, bani sau drepturi.
- **(c) Identitate**: edge cu `service_role` (coloane fixe, doar către worker); workerul apelează furnizorul cu cheia API a firmei.
  Fiecare cerere spre furnizor trece prin motor și prin garda tipului „text mascat”.
- **(d) Cine pornește**: doar deținătorul `INTREBARI_WORKER_SECRET` (verificat în BD, fail closed). Întrebările le pun doar cei cu
  cheia de modul `intrebari_tehnice` (sau ownerul), 5 / zi / utilizator, plafon global 40 de preluări / zi.
- **(e) Confirmare umană**: nu e cazul (răspunsul e informativ). Schimbările listei de entități nemascate și ale listei de cuvinte
  comune se fac doar prin PR, cu „da”-ul lui Răzvan.
- **Secrete (doar nume)**: `INTREBARI_WORKER_SECRET`, cheia API Anthropic (Credential Manager). Nimic nou.
- **Oprire**: dezactivezi task-ul din Task Scheduler + `automatizari.stare = oprit`.

## Decis de Răzvan (13.11.2026, după review-ul PR #1086)
1. **Entitățile publice** (operatori de rețea, companii / instituții publice, Gazpet) rămân vizibile — lista închisă din
   `nemascate.json`.
2. **Atașamentele** rămân oprite (nu se trimit la AI).
3. **Localitățile** rămân vizibile (marcaj + localitățile cunoscute din `red_uat`; conflictul nume = localitate: cu titlu sau
   prenume lângă = persoană, altfel localitate).
4. **Deținătorii de teren din Redări** rămân în lista de mascare (persoane fizice), cu regula de la 3.
5. **Răspunsul are trei verdicte**: Da / Nu / Incert.
