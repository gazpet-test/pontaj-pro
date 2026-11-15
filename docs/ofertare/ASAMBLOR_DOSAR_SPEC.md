# Asamblorul de dosar pentru propunerea tehnică — specificație

Stare: PROPUNERE (15.11.2026). Doar document: fără cod, fără migrări, fără schimbări în modulul Ofertare.
Decizia de direcție: generatorul de propuneri tehnice devine **asamblor de dosar**, iar redactarea asistată rămâne în interiorul lui, pentru părțile specifice licitației (metodologie, particularități). Cele două se îmbină: dosarul se construiește din piese, iar o parte din piese sunt text scris cu asistență.

Referințele `fișier:linie` sunt pe `origin/main` la data documentului. Exemplele sunt generice; nu conțin nume de licitații, de beneficiari sau de persoane și nici valori din dosare reale.

Cuprins:
0. De ce (pe scurt)
1. Ce există azi și ce rămâne neschimbat
2. Piesa de dosar
3. Cuprinsul
4. Matricea cerințelor și registrul factorilor de punctaj
5. Biblioteca de piese standard
6. Unde rămâne proza generată
7. Verificările înainte de depunere
8. Asamblarea
9. Modelul de date propus
10. Ordinea de lucru (5 pași)
11. Alegerile rămase pentru owner
Anexa A. Lecțiile de review care contează la implementare
Anexa B. Abateri de la dezbaterea de arhitectură

---

## 0. De ce (pe scurt)

Comparația cu dosarele depuse în ultimele luni (cinci dosare, de tipuri diferite) arată același tipar:

- un dosar de propunere tehnică are de regulă câteva sute de pagini, iar partea scrisă e minoritară; restul sunt formulare, tabele, grafice, documente standard ale firmei și documente probante;
- generatorul de azi produce un singur DOCX cu proză pe capitole, plus borderoul, Formularul 9 și Formularul 23;
- acolo unde textul din platformă a ajuns în dosarul depus, capitolele narative au trecut aproape neschimbate, iar capitolele despre grafic, cantități, fișe tehnice și declarații au fost înlocuite de mână cu trimiteri la anexe;
- greșelile găsite în dosarele depuse sunt de **asamblare**, nu de stil: titlul altei lucrări rămas într-o piesă, alt responsabil decât cel nominalizat, marcaje „de completat” uitate, trimiteri la anexa greșită, un document probabil expirat, promisiuni peste cerințe.

Câștigul nu vine din mai multă proză. Vine din a avea, pentru fiecare cerință, **răspunsul, dovada potrivită și pagina corectă**, iar pentru fiecare piesă, **sursa, versiunea și responsabilul**.

---

## 1. Ce există azi și ce rămâne neschimbat

### 1.1 Ce există

| Parte | Unde | Ce face |
|---|---|---|
| Modelele de cuprins | `src/OfertarePropunere.jsx:71-187` | 4 cuprinsuri copiate din dosare reale, declarate explicit „punct de pornire, nu șablon” (`:83-95`, `:167-169`) |
| Crearea cuprinsului | `src/OfertarePropunere.jsx:1449-1460` (din model), `:1465-1480` (capitol de mână, cu secțiune și etichetă) | rânduri în `ofertare_pt_capitole`, limită 40 de capitole (`:1468`) |
| Matricea cerință → capitol | `MatriceCerinte`, `src/OfertarePropunere.jsx:311`; verificarea de om `:1740`; dovada `:1773-1795` | legături în `ofertare_pt_legaturi`, dovezi în `ofertare_pt_dovezi`; pagina globală „se știe abia la asamblare” (`:1771-1772`) și nu se scrie |
| Stările legăturii | `supabase/migrations/20260913_ofertare_pt_legaturi_stare_si_dovezi.sql:11-27` | `atribuita / redactata / dovedita / verificata / blocata`; „verificata” cere om, dată și versiunea capitolului |
| Ținta dovezii | același fișier, `:40-52` | document de atribuire, autorizație, document al firmei, fișier sau capitol — exact una |
| Neaplicabil confirmat | `src/OfertarePropunere.jsx:1963-1965` | RPC cu amprenta cerinței văzute (`ofertare_confirma_neaplicabil`) |
| Generarea unui capitol | `supabase/functions/ofertare-genereaza-capitol/index.ts` | instrucțiuni `:65-99`; pachetul de fapte din ERP `:105-225`; cine are voie `:240`; interdicțiile 0–5 în cod `:278-329`; scrierea cu urmă și condiționată de versiune `:520` (`scriere.ts`) |
| Context tehnic | `supabase/functions/ofertare-genereaza-capitol/tehnic.mjs` | schelet pe tip de capitol `:34-48`; normative găsite în documentație `:62-75`; extrase de cel mult 16.000 de caractere `:119` |
| Export DOCX | `src/OfertareExport.js` | de ce DOCX și ce nu face (`:1-19`); propunerea `:58`; borderoul cu coloana de pagini goală `:98`; F23 `:154`; F9 `:228` |
| Poarta propunerii | `src/ofertarePoarta.js:23-215` | ~25 de rânduri block / warn / ok; identitatea lucrării e doar avertisment până la o decizie de business (`:183-186`); rândul porții de server `:204` |
| Controalele de text comune UI + server | `supabase/functions/_shared/ofertarePoartaText.mjs` | garanție `:9`, trimiteri la anexe `:95`, numere cheie `:133`, pachet complet `:151` — aceeași definiție în ambele căi |
| Poarta pe server | `supabase/migrations/20261003a_ofertare_poarta_server_jakv2p3.sql`; apelul din UI `src/ofertarePoartaServer.js:2-8` | impusă la aprobarea / depunerea pachetului și la licitația „depusă” |
| Pachetul | `src/OfertarePropunere.jsx:1801-1852`; `src/ofertarePachet.js:16-72`; `supabase/migrations/20260913_ofertare_pt_pachet_manifest.sql:7-39` | DOCX propunere + borderou, SHA-256, manifest append-only; coloane pentru anexe și fișiere semnate (`20260913_ofertare_pachet_completitudine_semnatura.sql:11-13`); verificările hash pe server (`20260930a_…`) |
| Graficul | `src/GraficLucrare.jsx:127-131` (PDF A3), `:146-185` (Excel fizic și valoric), `:230-231` (MS Project) | exporturi separate, nelegate de dosar |
| Organigrama | `src/OfertareOrganigrama.jsx:457-534` | PDF / PNG separat |
| Documentele firmei | `documente_firma`, cu categoria `procedura` și `revizie` (`supabase/migrations/20260924_documente_firma_procedura_revizie.sql:1-7`) | proceduri, autorizații, ISO — cu valabilitate și „utilizabil” |
| Lanțul probator | `src/ofertareLantProbator.js`, `src/ofertareTitular.js:1-12` | candidații de acoperire pe cerință; cine trebuie să dețină dovada (firma sau persoana) |
| Biblioteca juridică | `src/OfertareBiblioteca.jsx`, `src/ofertareBiblioteca.js:1-5` | decizii și norme; **alt lucru** decât biblioteca de piese de mai jos (vezi 5.1, numele) |

Descrierea detaliată a stării din septembrie: `docs/as-is/ofertare/07_pt_capitole_verificari.md` și `08_pachet_poarta_depunere.md` (liniile de acolo sunt decalate față de azi; între timp au apărut poarta pe server, verificările hash și dovezile de depunere).

### 1.2 Ce rămâne neschimbat

Nimic din ce funcționează nu se aruncă. Asamblorul se pune **peste** obiectele existente:

- `ofertare_pt_capitole`, istoricul versiunilor și trigger-ul de versionare rămân sursa textului. Un capitol devine o piesă de tip „text” (secțiunea 2.3).
- Generatorul `ofertare-genereaza-capitol` rămâne cu interdicțiile lui în cod (cine apelează, lacăt, munca omului, cerințe neconfirmate, scrierea condiționată de versiune). Se schimbă doar ce primește la intrare (secțiunea 6).
- Legăturile, dovezile, neaplicabilul confirmat cu amprentă, garanția, participanții, declarațiile, echipa F9, dotările F23, cantitățile și graficul înghețat rămân cum sunt. Matricea le extinde (secțiunea 4).
- Poarta (`evalueazaPoarta`), controalele comune și poarta pe server rămân un singur adevăr. Verificările noi se adaugă **acolo**, nu într-un al doilea evaluator (secțiunea 7).
- Pachetul cu manifest append-only, hash pe server și dovezile de depunere rămâne „ce s-a aprobat”. Asamblorul îi dă conținut complet (toate piesele, nu doar propunerea și borderoul).
- Modelele de cuprins rămân, ca „profil intern” (secțiunea 3.3), nu ca structură implicită.

---

## 2. Piesa de dosar

### 2.1 Definiție

O **piesă de dosar** este o unitate care apare în borderou: are o poziție în cuprins, o etichetă („Cap. 4”, „Anexa 7.2”, „Formular 11”), un titlu și un conținut care vine dintr-o singură sursă identificabilă.

Un dosar = o listă ordonată de piese, pe o licitație (și pe lot, unde e cazul). Unele piese conțin alte piese (o anexă cu sub-anexe, o secțiune cu capitole).

### 2.2 Tipuri

| Tip | Exemple | Sursa conținutului | Cine produce |
|---|---|---|---|
| `text` | metodologie, înțelegerea proiectului, organizare, particularități | un capitol din `ofertare_pt_capitole` (proză asistată sau scrisă de om) | redactorul, cu asistență |
| `formular` | formularul propunerii, formularul de personal, formularul de utilaje, declarații pe model impus | model al autorității sau al bibliotecii + câmpuri din ERP | generat determinist, verificat de om |
| `tabel` | formularul de conformitate cu pagini, PCCVI pe faze, matrice de riscuri, „aspect – impact – măsură”, centralizator de experiență | date structurate din ERP sau din bibliotecă | generat determinist din date validate |
| `grafic` | Gantt, drum critic, histograme, anexe de resurse | versiunea înghețată din modulul Grafic | export existent, legat de versiune |
| `standard` | proceduri, instrucțiuni de lucru, plan de management al calității, planuri SSM / urgență / mediu | o versiune aprobată din biblioteca de piese (secțiunea 5) | titularul domeniului; completare controlată pe licitație |
| `dovada` | autorizații, certificate, diplome, recomandări, contracte de laborator, fișe tehnice ale furnizorilor | documentul emis, nemodificat (`documente_firma`, HR, parteneri, furnizori) | cine îl deține; nu se rescrie niciodată |
| `extern` | formulare fără valori exportate din programul de devize, piese primite de la un colaborator sau de la un partener | fișier încărcat, cu hash | cel care îl încarcă; verificat ca orice piesă |
| `separator` | coperta de anexă, pagina de secțiune | generat din cuprins | automat |
| `trimitere` | capitolul care spune doar „Graficul de execuție este prezentat în Anexa 1” | generat din inventar (eticheta țintei) | automat, nu de model |

Borderoul, formularul de conformitate cu pagini și cuprinsul sunt și ele piese (tip `tabel`), generate la final din inventar.

### 2.3 Cum intră capitolele de proză existente

- Fiecare rând din `ofertare_pt_capitole` devine o piesă `text`, prin legătură (piesa are `capitol_id`), **nu prin copiere**: textul, versiunea, sursa („ai” / „om”), lacătul și istoricul rămân în tabelul capitolelor. Nu se sincronizează copii între tabele (lecția de design din review-urile anterioare: copiile sincronizate prin triggere au dat de patru ori NO-GO pe lock-uri).
- Capitolele create din model păstrează `sursa='sablon'`; piesa primește în plus sursa structurii (secțiunea 3).
- Capitolele care azi conțin text despre grafic, cantități, fișe tehnice sau declarații pot fi transformate de responsabil în piesă `trimitere` + piesa țintă (grafic / extern / formular). Transformarea nu șterge textul: capitolul rămâne în istoric, iar piesa trimiterii îl înlocuiește în dosar.
- Limita de 40 de capitole (`OfertarePropunere.jsx:1468`) rămâne pentru capitolele de text; piesele nu au această limită (un dosar real are de regulă mai multe piese decât capitole).

### 2.4 Atributele unei piese

| Atribut | Ce înseamnă | Obligatoriu |
|---|---|---|
| poziție, etichetă, titlu | locul în cuprins, eticheta afișată, titlul exact | da |
| `titlu_impus` | titlul și numerotarea vin din documentație și nu se reformulează | da (da / nu) |
| sursa structurii | de unde știm că piesa trebuie să existe: citat + document + revizie + pagină, sau „profil intern” | da |
| obligatorie | lipsa ei blochează finalizarea | da |
| tip și sursa conținutului | vezi 2.2; o singură țintă (capitol, versiune din bibliotecă, versiune de grafic, document probant, fișier extern) | da, din pasul „în lucru” |
| versiunea fixată | versiunea exactă a sursei folosite în dosar (nu „ultima”) | da, la „gata de verificare” |
| responsabil | omul care o aduce la „gata” | da |
| participant | firma care furnizează piesa (ofertant, asociat, subcontractant, terț) — refolosește `participant_id` | când nu e ofertantul |
| cerințele acoperite | prin matrice (secțiunea 4), nu printr-o listă pe piesă | — |
| valabilitate | data până la care e valabilă, unde e cazul; „necunoscută” e o stare, nu „fără expirare” | la dovezi și standard |
| semnătura cerută | piesa trebuie semnată electronic separat (nu se unește cu altele după semnare) | da / nu |

### 2.5 Stările unei piese

```
lipsă ──► în lucru ──► gata de verificare ──► verificată ──► (fixată într-un pachet)
   │           │                │                   │
   └──► nu se aplică (motiv + om + sursa care o justifică)
                                 ▲                   │
                                 └── sursa s-a schimbat (versiune nouă, document înlocuit, valabilitate expirată)
```

- **lipsă**: piesa e în cuprins, dar nu are încă sursă. Apare în lista de lipsuri.
- **în lucru**: are sursă, dar nu e completă (câmpuri necompletate, marcaje, capitol negenerat).
- **gata de verificare**: responsabilul declară că e completă; versiunea sursei se fixează.
- **verificată**: un om, altul decât responsabilul când regula licitației o cere, confirmă piesa **la versiunea fixată**. O versiune nouă a sursei readuce piesa la „gata de verificare” (derivat la citire, ca la legături azi; nu prin trigger care rescrie starea).
- **nu se aplică**: cu motiv, cu omul care a decis și, când piesa e impusă de documentație, cu trimiterea la răspunsul de clarificare sau la textul care o scoate. O piesă impusă nu poate fi „nu se aplică” doar pe motiv intern.
- **fixată**: copia din pachet; nu se mai modifică (manifestul e append-only).

Starea se schimbă doar prin RPC-uri care verifică identitatea (`auth.uid()`), dreptul pe licitație și versiunea văzută (secțiunea 9.4).

---

## 3. Cuprinsul

### 3.1 Principiu

Se separă **structura impusă** (ce piese, în ce ordine, cu ce titluri) de **inventarul obligațiilor** (ce cerințe trebuie acoperite și cu ce dovezi). Fișa de date și formularele impuse dau structura; caietul de sarcini, proiectul și clarificările adaugă obligații în matrice (secțiunea 4), nu capitole noi în cuprins.

### 3.2 Fluxul

1. **Inventarul surselor**: documentele de atribuire și reviziile aplicabile lotului (refolosește `ofertare_documente_atribuire` și controlul de completitudine a documentației din poartă), inclusiv răspunsurile la clarificări.
2. **Găsirea secțiunilor de structură**: „modul de prezentare a propunerii tehnice” din fișa de date, formularele impuse, eventual un capitol din caietul de sarcini. Locul diferă de la o autoritate la alta (comentariul din `OfertarePropunere.jsx:89-92`), deci se caută după titlu, nu după număr.
3. **Propunerea de structură**: fiecare poziție cu titlul, numerotarea și ordinea **exacte** din sursă, plus citatul și pagina, alăturate. În primul pas propunerea o face omul (lipește sau alege pasajul); extragerea asistată vine la pasul 5 (secțiunea 10) și propune, nu decide.
4. **Confirmarea**: responsabilul licitației confirmă structura **cu sursa alături** (ecran cu pasajul din fișa de date lângă lista de piese). Confirmarea fixează versiunea structurii; orice schimbare ulterioară e o versiune nouă, cu motiv.
5. **Completarea cu anexe**: piesele probante și formularele cerute în alte locuri (calificare, factori de evaluare, caiet) se adaugă ca anexe, fiecare cu sursa cerinței.

Reguli:
- O sursă necitită (tabel scanat neconvertit, anexă necitită) înseamnă **„structură incomplet verificată”**, afișat ca atare; nu se presupune că nu impune nimic.
- Modelul asistat nu decide singur că o secțiune lipsește sau că două formulări sunt echivalente.
- Titlul se scrie o singură dată în exportul final: din piesă, nu și din textul generat (în dosarele depuse au apărut titluri dublate).

### 3.3 Când documentația nu impune o structură

- Responsabilul confirmă explicit constatarea „documentația nu impune structura”, după ce a verificat sursele de la 3.2 pasul 2 (cu lista lor, ca dovadă a căutării).
- Se pornește atunci de la un **profil intern**: unul din modelele existente (`MODELE_CUPRINS`, `OfertarePropunere.jsx:170-187`) sau un profil pe tip de lucrare, adaptat lucrării.
- Profilul vine cu o **matrice de acoperire**: fiecare cerință are piesa care îi răspunde; un profil nu e considerat potrivit doar fiindcă are toate titlurile.
- Profilul pe beneficiar ajută la pornire, dar nu prevalează asupra documentației curente; sursa structurii pieselor rămâne „profil intern”, vizibil în borderoul de lucru.

### 3.4 Contradicții

O contradicție = două surse din documentație care cer lucruri incompatibile (structură, termen, număr, normativ, format).

- Se înregistrează ca obiect: subiectul, sursa A și sursa B (document, revizie, pagină, citat), cine a constatat-o.
- Decizia e una din: (a) se cere clarificare (legătură la întrebarea din modulul Clarificări); (b) se adoptă o variantă, cu motivarea tehnică și omul care a aprobat-o; (c) se tratează ambele (când e posibil fără angajament suplimentar).
- **Nu** se adoptă automat „valoarea acoperitoare”: poate crea un angajament contractual în plus. Dacă varianta adoptată e mai strictă decât cerința minimă, intră în registrul angajamentelor (4.5).
- Rezumatul propunerii poate numi contradicțiile și decizia luată (practică bună găsită într-un dosar depus), din obiectul înregistrat, nu redactat liber.
- Până la decizie, piesele afectate nu pot trece de „în lucru”.

---

## 4. Matricea cerințelor și registrul factorilor de punctaj

### 4.1 Lanțul

```
cerință identificată → răspuns concret → dovadă / document → locator → versiune verificată → pagina finală
```

Fiecare verigă e un câmp separat, cu proveniența ei:

| Verigă | Unde stă | Cine scrie |
|---|---|---|
| cerința | `ofertare_cerinte` (text, document sursă, pagină, pasaj; confirmată de om; înlocuită de) | registrul de cerințe, existent |
| răspunsul | piesa care răspunde (legătura la capitol sau la piesă) + un rezumat scurt al răspunsului ofertat și condițiile lui | responsabilul piesei |
| dovada | `ofertare_pt_dovezi`, extins cu ținta „piesă din dosar” | responsabilul piesei |
| locatorul | ancora în piesă (pagina locală în piesă, titlul de subcapitol sau rândul din tabel), nu text liber din care se ghicește primul număr | ales din piesă, nu tastat |
| versiunea verificată | versiunea piesei (sau a capitolului) la care omul a confirmat | verificatorul |
| pagina finală | calculată după asamblare, pe pachet (secțiunea 8), din începutul piesei + pagina locală | calcul, nu om |

### 4.2 Stările pe cerință

`propus` (o legătură sugerată, inclusiv de model) → `răspuns` (are piesă și rezumat) → `dovedit` (are dovadă cu locator) → `verificat` (un om a văzut cerința lângă pasajul probant, la versiunea curentă) / `insuficient` (cu constatare: ce lipsește) / `neaplicabil justificat` (RPC-ul existent cu amprentă, `OfertarePropunere.jsx:1963-1965`).

Se refolosesc stările existente ale legăturii (`atribuita`, `dovedita`, `verificata`, `blocata` ca „insuficient”), plus cele două câmpuri noi (rezumatul răspunsului și ancora dovezii). Nu se inventează o mașină de stări paralelă.

### 4.3 Reguli

- **„Are capitol” nu înseamnă „e satisfăcută”. „Există documentul” nu înseamnă „dovedește cerința”.** O autorizație, o diplomă și o recomandare dovedesc lucruri diferite; titularul (firmă sau persoană) se verifică cu regula existentă din `ofertareTitular.js`.
- Un document de o sută de pagini anexat nu e dovadă precisă: dovada are locator în interiorul piesei.
- Modelul asistat poate **sugera** corespondențe și poate semnala contradicții; nu poate confirma propria sugestie. O legătură sugerată de model rămâne `propus` până o confirmă un om.
- Verificatorul vede cerința și pasajul probant **alăturate** (textul piesei sau pagina randată a documentului), fără să tasteze locatori în ferestre de dialog.
- O versiune nouă a piesei readuce cerințele ei la „de reverificat” (derivat la citire, cum funcționează azi `verificat_la_versiunea`).
- Cine confirmă: responsabilul licitației sau un verificator desemnat de el pe licitație. Regula „cine a scris nu verifică singur” e o alegere pe licitație (dosarele mici au adesea un singur om).

### 4.4 Formularul de conformitate cu pagini

Unele autorități cer un formular în care fiecare cerință are „documentele doveditoare” și „paginile unde se regăsesc”. Acesta e o **vedere exportată a matricei**, nu un text scris:

- se generează din legături și dovezi, cu paginile calculate pe pachetul final;
- până la asamblare (pașii 1–3), coloana de pagini arată „după asamblare”, nu un număr;
- cerințele fără răspuns verificat apar în formular ca lipsă, nu dispar.

### 4.5 Registrul factorilor de punctaj (separat de matrice)

Factorii de evaluare nu sunt cerințe de conformitate: o cerință se îndeplinește sau nu, un factor aduce puncte în trepte. De aceea au un registru separat.

| Câmp | Ce conține |
|---|---|
| factor, subcriteriu | denumirea exactă din fișa de date, cu sursa (document, pagină, citat) |
| tip | financiar / tehnic cantitativ / tehnic calitativ |
| regula de calcul și pragurile | citat exact + forma structurată (praguri, puncte); confirmată de om |
| angajamentul propus | ce oferim pe factor (de ex. numărul de proiecte similare ale unui rol cheie, un termen redus), aprobat de un om cu drept de decizie |
| dovezile | piesele care probează angajamentul (prin aceeași legătură ca la matrice) |
| estimarea | calcul determinist pentru factorii cantitativi; pentru cei calitativi, o estimare motivată, marcată ca estimare |

Reguli:
- Nu se afișează niciodată „punctaj garantat”.
- Factorii financiari se țin în registru doar ca referință; nu apar în nicio piesă a propunerii tehnice (prețul în propunerea tehnică e motiv de respingere). Piesa „detaliere pe factorii de punctaj” se exportă **fără** factorul de preț, chiar dacă dosare anterioare l-au inclus.
- Piesa de punctaj are titlul lucrării din fișa aprobată a licitației (verificarea de identitate, secțiunea 7, se aplică și ei).

### 4.6 Registrul angajamentelor

Tot ce promite propunerea în plus față de cerințe (durată, garanție, timp de reacție, frecvență de inspecție, resurse suplimentare) e un **angajament**: tip, valoare, unitate, minimul cerut (din cerință), sursa aprobării, omul care l-a aprobat, piesele în care apare.

- „Peste cerințe” poate fi intenționat și punctabil; problema e angajamentul **neaprobat** sau imposibil de susținut.
- Garanția rămâne în tabelul ei (`ofertare_pt_garantie`, cu controlul existent) și se citește în registru printr-o vedere, nu se copiază.
- Textul nu are voie să conțină angajamente numerice care nu sunt în registru (verificarea din secțiunea 7).

---

## 5. Biblioteca de piese standard

### 5.1 Numele

În Ofertare există deja o „Bibliotecă juridică” (decizii și norme, `src/OfertareBiblioteca.jsx`). Ca să nu se confunde, aceasta se numește **„Biblioteca de piese standard”** (în meniu: „📚 Piese standard”).

### 5.2 Trei categorii

| Categorie | Exemple | Ce se poate schimba pe licitație |
|---|---|---|
| **nucleu standard aprobat** | proceduri de sistem și tehnice, instrucțiuni de lucru | nimic în corp; doar câmpurile de identificare (lucrare, beneficiar, ediție tipărită) |
| **document adaptabil** | plan de management al calității, planuri SSM / situații de urgență / mediu, PCCVI de bază, declarații pe model propriu, CV-uri | nucleul rămâne; o secțiune specifică lucrării (riscuri de amplasament, aspecte de mediu, responsabili, organizare) se completează și se aprobă pe licitație |
| **dovadă emisă** | autorizații, certificate, diplome, recomandări, contracte | nimic; documentul original nu se rescrie. Stă unde stă azi (`documente_firma`, documentele HR ale persoanelor, parteneri) — biblioteca doar îl leagă |

Biblioteca nu înlocuiește metodologia specifică lucrării: un plan SSM are nucleu standard, dar riscurile amplasamentului, organizarea și responsabilii se adaptează și se aprobă pe licitație.

### 5.3 Versiuni

Fiecare versiune a unui document din bibliotecă are: identificator, fișier, SHA-256 pe conținut, autor, aprobator, data aprobării, domeniu de aplicare (tipuri de lucrări, beneficiari), data de revizuire planificată, versiunea pe care o înlocuiește, starea (`ciornă` / `aprobată` / `retrasă`) și lista normativelor citate cu data ultimei verificări a actualității lor.

- Dosarul **fixează** versiunea folosită. O versiune nouă în bibliotecă nu schimbă retroactiv un dosar; dosarul în lucru primește un semnal „există versiune nouă”, iar responsabilul decide.
- O versiune retrasă nu mai poate fi aleasă pentru dosare noi, dar rămâne în istoric și în pachetele în care a fost folosită.
- Data de revizuire depășită = avertisment la alegere; normative neverificate de mai mult de un termen stabilit de titular = avertisment. Un an vechi în text nu dovedește singur că documentul e inutilizabil, iar un nume de fișier nu dovedește singur expirarea: se verifică conținutul.

### 5.4 Titulari și aprobatori pe domenii

| Domeniu | Titular (ține la zi) | Aprobă versiunile |
|---|---|---|
| calitate (proceduri, PCCVI, planul calității) | responsabilul cu calitatea | conducerea tehnică |
| SSM și situații de urgență | specialistul SSM / PSI | conducerea tehnică |
| mediu | responsabilul de mediu | conducerea tehnică |
| documentele persoanelor (CV, diplome, autorizații) | HR | HR + persoana, pentru CV |
| declarații și formulare proprii | responsabilul Ofertare | owner sau responsabilul desemnat |
| aplicabilitatea la o licitație | responsabilul licitației | — (decide doar alegerea, nu conținutul) |

Owner-ul desemnează titularii și aprobatorii; lista lor e o setare de drepturi și se schimbă doar cu acordul lui. Aprobatorul nu poate fi autorul versiunii.

### 5.5 Completarea controlată a câmpurilor variabile

- Fiecare versiune declară **lista câmpurilor variabile**, fiecare cu sursa ei: fișa lucrării (denumire, cod, beneficiar, localitate, durată), echipa nominalizată (rol → persoană), participanții, data documentului.
- **Fișa lucrării** e un singur obiect aprobat pe licitație (denumirea exactă, beneficiarul, codul, durata, echipa pe roluri). Toate piesele se completează din ea, inclusiv antetele, subsolurile și tabelele de responsabili. Schimbarea fișei = versiune nouă, iar piesele completate din versiunea veche devin „de recompletat”.
- Completarea se face pe server, determinist (nu cu model AI), și produce o piesă cu hash propriu; piesa reține versiunea șablonului și versiunea fișei folosite.
- Un câmp obligatoriu fără valoare blochează trecerea piesei la „gata de verificare”. Marcajele istorice („TBN”, „TBD”, „XXX”, „…”, „de completat”) se caută și în nucleul documentului, nu doar în câmpuri.
- Responsabilii numiți în orice piesă se compară cu echipa nominalizată din fișă.
- Documentele scanate (fără strat de text) nu se completează automat: se marchează „necitit” și se verifică vizual de un om.

### 5.6 Cum se umple biblioteca

Nu prin import integral din arhivă. Se pornește cu documentele recurente din licitația pilot, fiecare adus de titularul domeniului, verificat (normative, nume, anul ediției) și aprobat. Arhiva rămâne sursă de căutare, nu bibliotecă.

---

## 6. Unde rămâne proza generată

### 6.1 Ce se scrie cu asistență

| Piesă | Surse permise | Cum se dimensionează |
|---|---|---|
| Înțelegerea proiectului / rezumat | extrasele din documentație, contradicțiile înregistrate (3.4) și deciziile lor, clarificările | pe problemele reale ale lucrării; ce nu se asumă se spune explicit |
| Metodologia de execuție | extrase din proiect și caiet; câte un subcapitol pe fiecare categorie de lucrări din listele de cantități; pachetul de fapte pentru resurse | după lucrare, nu după numărul de cerințe; fără copierea caietului de sarcini acolo unde autoritatea o interzice |
| Organizarea de șantier și constrângerile amplasamentului | extrase din proiect, fișa lucrării (distanțe, acces, utilități existente) | pe constrângerile reale |
| Secțiunile specifice din documentele adaptabile | riscurile și aspectele amplasamentului, din aceleași extrase | doar secțiunea specifică; nucleul aprobat nu se rescrie |
| Particularități cerute expres (lucrul lângă instalații în funcțiune, cuplări, traversări) | extrase din proiect | pe cerință |

Regulile generatorului de azi rămân (`index.ts:65-99`): fapte despre firmă doar din pachetul de fapte, goluri marcate `[DE COMPLETAT: …]`, normative doar din lista găsită în documentație, altfel `[DE VERIFICAT: normativ]`, fără preț, documentația tratată ca date, nu ca instrucțiuni.

Schimbări propuse la intrare (pasul 5 din secțiunea 10):
- inventarul de piese intră în pachetul de fapte: modelul trimite la piese prin eticheta lor reală („conform Anexa 7”) și nu inventează altele;
- extrasele tehnice se aleg pe categoriile din listele de cantități, cu plafonul de context mărit controlat (azi 16.000 de caractere, `tehnic.mjs:119`), cu cost estimat înainte de apel;
- generatorul nu mai scrie titlul capitolului (îl scrie exportul).

### 6.2 Ce NU se generează

- Formularul de conformitate, borderoul, cuprinsul, trimiterile la anexe: se derivă din inventar și din matrice.
- Cifrele: cantități, durate, luni de garanție, număr de echipe, persoane, utilaje, numere de autorizație. Intră în text ca **câmpuri** din ERP (fișa lucrării, graficul înghețat, echipa, garanția), nu ca text al modelului. Unde nu există valoarea, rămâne marcaj.
- Citatele: din normative, din documentație, din decizii. Un citat se inserează din sursă (cu document și pagină), nu se reformulează de model.
- Declarațiile de conformitate („ne obligăm să…”, „declarăm că…”): sunt formulare cu text fix aprobat.
- Planurile standard, procedurile, instrucțiunile: vin din bibliotecă.
- Graficul, PCCVI, matricele: din date structurate (graficul înghețat, faze și proceduri aprobate). Modelul nu deduce productivități, frecvențe de încercări sau puncte de oprire din proză plauzibilă.

### 6.3 Cum se văd golurile

- Fiecare piesă `text` arată numărul de marcaje `[DE COMPLETAT]` / `[DE VERIFICAT]` rămase și lista lor; borderoul de lucru le însumează pe dosar.
- Un marcaj rămas blochează trecerea la „gata de verificare” și finalizarea (secțiunea 7).
- **Acceptarea textului se separă de proveniență**: azi, un capitol generat devine „citit de om” doar dacă un om îl salvează (și atunci sursa devine „om”). Propunerea: piesa primește „acceptat de X la versiunea N”, iar sursa rămâne cea reală („ai” dacă textul nu a fost modificat). Poarta cere acceptarea, nu schimbarea sursei. Până la implementare, regula de azi rămâne.

---

## 7. Verificările înainte de depunere

### 7.1 Principii

- **Blocaje pe fapte**, nu pe impresii: o verificare blochează doar când constatarea e un fapt verificabil (piesă absentă, trimitere fără țintă, dată de expirare depășită, marcaj rămas, hash diferit). Ce cere judecată e alertă cu responsabil, nu blocaj.
- **Necunoscut ≠ în regulă**: o verificare care nu a putut rula, o dată de valabilitate lipsă, un document scanat necitit înseamnă „neverificat”, afișat ca atare, nu „ok”.
- **Pe pachetul final și pe server**: verificările se rulează pe piesele fixate în pachet și se impun în poarta de pe server (`ofertare_poarta_server`), la aprobarea pachetului. UI-ul doar afișează rezultatul.
- **O singură definiție**: fiecare regulă nouă se scrie o dată, în modulul comun de controale (`supabase/functions/_shared/ofertarePoartaText.mjs`) sau în SQL, cu test de paritate când există două implementări.
- **Absența unei alerte nu certifică absența riscului** (la verificările asistate de model).

### 7.2 Lista

| # | Verificare | Ce se compară | Tratament |
|---|---|---|---|
| V1 | Piesă obligatorie absentă | cuprinsul confirmat față de piesele „verificată” | **blocaj** |
| V2 | Trimitere fără țintă | fiecare „Anexa N”, „Formular N”, „cap. X”, „pag. Y” din orice piesă cu text, față de etichetele din inventar și paginile din pachet (extinde controlul existent de trimiteri, `ofertarePoartaText.mjs:95`) | **blocaj**; trimitere fără număr („conform anexei atașate”) = alertă |
| V3 | Pagină în afara documentului | locatorii dovezilor și paginile din formularul de conformitate față de pachet | **blocaj** (după pasul 4) |
| V4 | Marcaje de completat rămase | `[DE COMPLETAT`, `[DE VERIFICAT`, „TBN”, „TBD”, „XXX”, câmpuri goale, în toate piesele cu text (inclusiv anteturi și tabele) | **blocaj** după confirmarea contextului (un „XXX” poate fi legitim într-un cod de material: excepția se notează cu motiv) |
| V5 | Titlul lucrării sau responsabilul contrazis de fișa aprobată | denumirea, codul și beneficiarul din fișă față de anteturi, coperte, piesa de punctaj; persoanele numite față de echipa nominalizată | **blocaj** după confirmarea nepotrivirii |
| V6 | Nume / localitate din altă licitație | denumiri din alte licitații ale firmei găsite în piese (controlul existent de identitate, azi doar avertisment, `ofertarePoarta.js:183-186`) | **alertă contextuală**; poate fi experiență similară legitimă; închisă cu motiv de un om |
| V7 | Dovadă expirată | valabilitatea la **data relevantă** (termenul de depunere sau data cerută de cerință), pe ora României | **blocaj**; dată necunoscută = „de verificat” cu responsabil |
| V8 | Versiune retrasă sau depășită din bibliotecă | versiunea fixată față de starea ei în bibliotecă | retrasă = **blocaj**; înlocuită = alertă |
| V9 | Cerință fără răspuns verificat la versiunea curentă | matricea (secțiunea 4) | **blocaj** (extinde rândurile existente „fără capitol” și „neverificate”) |
| V10 | Promisiune fără sursă sau aprobare | valori numerice cu unitate (luni, ore, zile, frecvențe, procente) din text, față de registrul angajamentelor și de cerințe | angajament nedeclarat = **revizuire obligatorie** (blocaj până la decizie: se aprobă în registru sau se scoate) |
| V11 | Preț în piesa tehnică | sume în lei, coloane de preț în tabele și în piesele externe (formulare fără valori) | **blocaj** pe tipare sigure (coloană de preț nevidă); alertă pe sume izolate (valorile contractelor anterioare la experiență sunt permise) |
| V12 | Piesă scanată necitită | piese `dovada` / `extern` fără strat de text | stare „neverificat”; verificare vizuală a unui om, cu data și numele lui |
| V13 | Fișierul final diferit de cel verificat | hash-ul din manifest față de fișierul semnat și față de fișierul încărcat la depunere | **blocaj** (refolosește verificările hash existente) |
| V14 | Contradicție nedecisă | contradicțiile deschise (3.4) | **blocaj** |
| V15 | Cuprins neconfirmat sau confirmat pe o structură veche | versiunea structurii față de documentele de atribuire curente (revizii, clarificări noi) | **blocaj** |

Controalele existente (cantități, garanție, grafic înghețat, participanți, numere cheie, documentația citită) rămân neschimbate.

### 7.3 Ce nu se copiază din practica găsită

Dosarele depuse sunt probe de practică, nu standard de corectitudine. Nu se preiau: piesa de punctaj copiată de la altă lucrare, planuri cu alt responsabil decât cel nominalizat, marcaje uitate, trimiteri „la anexa atașată”, promisiuni de inspecții și timpi de reacție neaprobați, memoriul care copiază proiectul acolo unde autoritatea interzice asta.

---

## 8. Asamblarea

### 8.1 Întâi inventarul și borderoul (pasul 1)

Prima livrare nu produce PDF. Produce:
- **inventarul**: lista ordonată de piese, cu tip, sursă, versiune fixată, responsabil, participant, stare și lipsuri;
- **borderoul complet**: toate piesele, inclusiv anexele (azi borderoul listează doar capitolele, `OfertareExport.js:98`), cu coloana de pagini „după asamblare”;
- **lista de lipsuri**: piese lipsă, piese în lucru, cerințe fără piesă, dovezi expirate sau cu dată necunoscută.

Asamblarea fizică (unirea PDF-urilor, numerotarea, împărțirea) rămâne în acest pas la om, în instrumentele de azi. Ca să nu se piardă legătura, omul poate înregistra în borderou intervalele de pagini ale dosarului asamblat de el, marcate „declarat de om, neverificat pe fișier”.

### 8.2 Apoi PDF-ul pe părți, cu pagini reale (pasul 4)

Ordinea:

```
fixarea surselor → randare → ordonare → paginare → borderou și formularul de conformitate → reverificare → împărțire pe părți → semnare (în afara platformei) → verificarea fișierelor semnate
```

- **Unde**: pe server. Unirea PDF-urilor nu se face în aplicația web (biblioteca de manipulare PDF nu merge în build-ul de frontend; `OfertareExport.js:15-19`). Locul exact (funcție edge sau serviciu pe serverul firmei) e o decizie de implementare, cu cost și limite de mărime măsurate pe un dosar de ~500 de pagini.
- **Paginarea e iterativă**: borderoul și formularul de conformitate ocupă ele însele pagini și pot muta paginarea; procesul se repetă până când paginile sunt stabile (de regulă două treceri).
- **Pagina fizică și pagina tipărită** se păstrează amândouă când diferă (coperți nenumerotate, părți cu numerotare continuă).
- **Locatorii**: pentru PDF-urile încărcate se știe sigur intervalul piesei; pagina exactă din interiorul unui document scanat cere locator confirmat de om.
- **Împărțirea pe părți** respectă limita de mărime a platformei de depunere (setată pe licitație) și nu rupe corespondența dintre pagina din borderou și fișierul în care se află.
- **Piesele semnate separat** nu se unesc după semnare (un fișier semnat modificat își pierde semnătura); borderoul le listează ca fișiere distincte.

### 8.3 Semnarea și depunerea rămân în afara platformei

- Semnătura electronică pe PDF și încărcarea în platforma de achiziții se fac în instrumentele de azi.
- Platforma **înregistrează** fișierele semnate (hash, mărime, data) și dovada depunerii, și le compară cu pachetul aprobat (V13).
- „Aprobarea internă” (semnătura porții din `ofertare_pt_poarta`) și „semnătura electronică” pe PDF au nume distincte în ecran și în documentație.
- Hash-ul dovedește identitatea fișierului, nu conformitatea conținutului. Orice editare după verificare = versiune nouă și reverificarea elementelor afectate.

---

## 9. Modelul de date propus

Doar descris. Nicio migrare nu se scrie în această etapă. Numele sunt orientative; la implementare, fiecare tabel nou respectă regulile casei (RLS activ, drepturi explicite, politici cu `auth.uid() IS NOT NULL` și acces pe licitație, vederi `security_invoker`, funcții `SECURITY DEFINER` cu `search_path` fix).

### 9.1 Ce se refolosește

| Obiect existent | Rol în asamblor |
|---|---|
| `ofertare_licitatii` (+ responsabili) | dosarul aparține licitației; responsabilii licitației sunt responsabilii dosarului |
| `ofertare_documente_atribuire` | sursele structurii, ale cerințelor și ale contradicțiilor |
| `ofertare_cerinte` | cerințele (sursă, pagină, pasaj, confirmare, înlocuire) |
| `ofertare_pt_capitole` (+ versiuni) | conținutul pieselor `text` |
| `ofertare_pt_legaturi`, `ofertare_pt_dovezi` | matricea; se extind (9.3) |
| `ofertare_pt_garantie`, `ofertare_pt_participanti`, `ofertare_pt_declaratii`, `ofertare_pt_echipa` | fapte pentru fișa lucrării, registrul angajamentelor și formulare |
| `ofertare_pt_anexe_asteptate` | se migrează logic în piese (o anexă așteptată = piesă `lipsă` cu sursa declarației); tabelul rămâne citit până la mutare |
| `documente_firma`, documentele HR ale persoanelor, `ofertare_experienta`, `ofertare_parteneri` | dovezile emise (piese `dovada`) |
| `grafic_versiuni` | piesele `grafic`, pe versiunea înghețată |
| `ofertare_pt_pachet`, `ofertare_pt_pachet_fisiere`, verificările hash, poarta pe server | pachetul final; se extind (9.3) |
| `ofertare_clarificari` | decizia „se cere clarificare” la contradicții |

### 9.2 Tabele noi

| Tabel | Coloane principale | Citește | Scrie |
|---|---|---|---|
| `ofertare_dosar_structura` | `licitatie_id`, `lot`, `versiune`, `fel` (`impusa` / `profil_intern`), `profil_cod`, `confirmat_de`, `confirmat_la`, `motiv_schimbare`; UNIQUE (licitație, lot, versiune) | cine are acces la licitație | doar RPC „confirmă structura” (responsabilul licitației sau owner) |
| `ofertare_dosar_structura_surse` | `structura_id`, `document_id`, `document_revizie`, `pagina`, `citat`, `rol` (`structura` / `formular_impus` / `cautat_fara_rezultat`) | idem | RPC, împreună cu structura |
| `ofertare_dosar_piese` | `licitatie_id`, `lot`, `structura_versiune`, `parinte_id`, `ordine`, `eticheta`, `titlu`, `titlu_impus`, `obligatorie`, `tip`, ținta conținutului (exact una: `capitol_id` / `biblioteca_versiune_id` / `grafic_versiune` / `doc_firma_id` / alt id de dovadă / `fisier_path` + `sha256`), `versiune` (a piesei), `sursa_versiune_fixata`, `responsabil_id`, `participant_id`, `stare`, `motiv_nu_se_aplica`, `valabil_pana_la`, `valabilitate_necunoscuta`, `semnatura_ceruta`, `verificat_de`, `verificat_la`, `verificat_la_versiunea`, `acceptat_de`, `acceptat_la_versiunea` (pentru `text`) | idem | responsabilul piesei prin RPC; stările prin RPC; proveniența (creat de, sursa, hash) o pune serverul |
| `ofertare_dosar_contradictii` | `licitatie_id`, `subiect`, sursa A și B (document, revizie, pagină, citat), `decizie` (`clarificare` / `varianta_adoptata` / `ambele`), `motivare`, `clarificare_id`, `decis_de`, `decis_la` | idem | constatare: oricine cu acces; decizia: responsabilul licitației prin RPC |
| `ofertare_dosar_fisa` | `licitatie_id`, `versiune`, câmpurile lucrării (structurate, nu text liber), echipa pe roluri (referințe la persoane), `aprobat_de`, `aprobat_la` | idem + funcția de completare | RPC „aprobă fișa”; versiune nouă la orice schimbare |
| `ofertare_factori_evaluare` | `licitatie_id`, `lot`, `cod`, `denumire`, `tip`, `regula_citat`, `regula` (praguri structurate), sursa (document, pagină), `confirmat_de`, `confirmat_la` | idem | responsabilul licitației |
| `ofertare_factori_angajamente` | `factor_id`, `angajament`, `valoare`, `unitate`, `estimare`, `estimare_e_calcul`, `motivare`, `aprobat_de`, `aprobat_la` | idem | propunere: responsabilul; aprobare: owner sau delegatul lui, prin RPC |
| `ofertare_angajamente` | `licitatie_id`, `tip`, `valoare`, `unitate`, `minim_cerut`, `cerinta_id`, `aprobat_de`, `aprobat_la`, `motiv` | idem + verificarea V10 | ca la factori |
| `ofertare_biblioteca_documente` | `cod`, `titlu`, `categorie` (`nucleu` / `adaptabil`), `domeniu`, `domeniu_aplicare`, `titular_id`, `activ` | toți utilizatorii modulului Ofertare | titularul domeniului |
| `ofertare_biblioteca_versiuni` | `document_id`, `versiune`, `fisier_path`, `sha256`, `campuri` (lista câmpurilor variabile și sursa fiecăruia), `normative`, `normative_verificate_la`, `autor_id`, `aprobat_de`, `aprobat_la`, `revizuire_la`, `inlocuieste_id`, `stare` | idem | autorul creează ciorna; aprobatorul domeniului (alt om decât autorul) aprobă prin RPC; după aprobare versiunea e imuabilă |
| `ofertare_biblioteca_aprobatori` | `domeniu`, `user_id`, `rol` (`titular` / `aprobator`) | idem | **doar owner** (e o setare de drepturi) |
| `ofertare_dosar_pagini` (pasul 4) | `pachet_id`, `piesa_id`, `piesa_versiune`, `parte_nr`, `pagina_fizica_start`, `pagina_fizica_end`, `pagina_tiparita_start`, `fisier_sha256` | idem | doar funcția de asamblare de pe server |

### 9.3 Coloane noi pe tabele existente

| Tabel | Coloană | De ce |
|---|---|---|
| `ofertare_pt_legaturi` | `piesa_id` (pentru legăturile la piese care nu sunt text); CHECK: exact una dintre `capitol_id` / `piesa_id` la legăturile de acoperire | matricea leagă cerința de orice piesă; legăturile pe capitol rămân cum sunt (fără copiere) |
| `ofertare_pt_legaturi` | `raspuns_rezumat`, `sugerat_de_ai` (boolean, pus de server) | veriga „răspuns”; o sugestie a modelului rămâne vizibilă ca atare |
| `ofertare_pt_dovezi` | ținta `piesa_id`; `ancora` (pagina locală în piesă / titlul subcapitolului / rândul din tabel), aleasă din piesă | locator stabil; înlocuiește ghicirea primului număr din text liber (`OfertarePropunere.jsx:1782`) |
| `ofertare_pt_pachet_fisiere` | `piesa_id`, `piesa_versiune` | pachetul știe ce piesă și ce versiune conține fiecare fișier |

Pagina finală **nu** devine coloană pe dovadă (`pagina_globala` rămâne nefolosită și se retrage după pasul 4): depinde de pachet, deci se calculează din `ofertare_dosar_pagini` + ancora dovezii.

### 9.4 Cine scrie și cum

- Tranzițiile de stare (confirmă structura, fixează versiunea, verifică piesa, acceptă textul, aprobă fișa, decide o contradicție, aprobă un angajament, aprobă o versiune din bibliotecă) trec prin RPC-uri care: iau identitatea din `auth.uid()`; verifică dreptul pe licitația **fiecărei** ținte atinse; blochează întâi rândul părinte, apoi verifică; primesc versiunea văzută și refuză dacă s-a schimbat; scriu într-o singură tranzacție tot ce ține de aceeași intenție.
- Coloanele de proveniență (creat de, sursa, hash, sugerat de AI) le pune serverul și nu le poate schimba utilizatorul.
- Regula „piesa e completă” (un singur predicat) se definește o dată în SQL și se citește de UI, de poartă și de funcția de asamblare.
- Citirile pe dosare mari folosesc paginare keyset (un dosar poate avea sute de dovezi; plafonul serverului e de 1.000 de rânduri pe cerere).

---

## 10. Ordinea de lucru (5 pași)

Fiecare pas e o felie livrabilă separat, cu propriul PR, review și (unde e cazul) migrare cu revenire.

### Pasul 1 — Inventarul de dosar pe licitația pilot

- **Ce**: structura confirmată de om cu sursa alături (3.2, fără extragere asistată); piesele cu tip, sursă, responsabil, stare; capitolele existente legate ca piese `text`; anexele așteptate aduse ca piese; borderoul complet exportat; lista explicită de lipsuri; verificările V1, V14, V15.
- **Ce nu**: PDF, bibliotecă, model AI.
- **Ce se testează**: confirmarea structurii doar de responsabil / owner (test cu un utilizator fără drept); o schimbare de revizie a fișei de date face structura „de reconfirmat”; borderoul are toate piesele, în ordine, cu „după asamblare” la pagini; lipsurile apar și nu dispar la reîncărcare; capitolele existente nu se modifică.
- **Ce se măsoară**: timpul de îndosariere pe pilot față de declarația responsabilului pentru o licitație comparabilă anterioară; câte piese lipsă a semnalat inventarul înainte de termen.

### Pasul 2 — Matricea probantă

- **Ce**: legături la piese, rezumatul răspunsului, ancora dovezii aleasă din piesă, verificarea cu cerința alături, stările din 4.2; registrul factorilor de punctaj și registrul angajamentelor; acceptarea textului separată de proveniență; verificările V9, V10.
- **Ce se testează**: o versiune nouă de piesă readuce cerințele ei la „de reverificat”; o sugestie a modelului nu poate fi confirmată de model; factorul financiar nu apare în nicio piesă exportată; un angajament numeric din text fără rând în registru blochează.
- **Ce se măsoară**: timpul de găsire a dovezii pentru un eșantion de cerințe; numărul de cerințe „insuficiente” găsite înainte de depunere.

### Pasul 3 — Biblioteca restrânsă, aprobată

- **Ce**: documentele recurente din pilot (proceduri, instrucțiuni, plan de calitate, planuri SSM / urgență / mediu, declarații), cu versiuni, titulari și aprobatori pe domenii; fișa lucrării; completarea controlată pe server; verificările V4, V5, V6, V7, V8, V12.
- **Ce se testează**: aprobatorul nu poate fi autorul; versiunea aprobată nu se mai modifică; o versiune retrasă nu poate fi aleasă; schimbarea fișei face piesele „de recompletat”; un câmp gol sau un marcaj istoric blochează; un responsabil diferit de echipa nominalizată e găsit în anteturi și tabele; valabilitatea pe ora României la termenul de depunere; data necunoscută ≠ valabil.
- **Ce se măsoară**: numărul de piese standard refolosite fără rescriere; erorile de identitate prinse (nume de altă lucrare, alt responsabil).

### Pasul 4 — Asamblarea PDF cu pagini reale

- **Ce**: asamblarea pe server după 8.2; `ofertare_dosar_pagini`; borderoul și formularul de conformitate paginate; împărțirea pe părți; înregistrarea fișierelor semnate și compararea lor; verificările V2 (cu pagini), V3, V11, V13.
- **Ce se testează**: paginile din borderou corespund fișierului real (verificare pe PDF-ul generat, nu pe calcul); paginarea e stabilă după a doua trecere; o piesă semnată nu e unită; un fișier semnat diferit de cel aprobat blochează; rezultatul unei asamblări vechi nu suprascrie unul nou.
- **Ce se măsoară**: trimiterile reparate de mână după asamblare (ținta: zero); timpul de la „toate piesele verificate” la „dosar pe părți”.

### Pasul 5 — Tabele structurate și redactare asistată pe lucrare

- **Ce**: PCCVI pe faze, matrice de riscuri, „aspect – impact – măsură”, tabelul de activități, din date validate; integrarea cu graficul înghețat și cu formularele fără valori din devize; metodologia pe categoriile din listele de cantități (6.1); extragerea asistată a structurii, ca propunere confirmată de om.
- **Ce se testează**: un tabel nu conține valori pe care nu le are sursa; răspunsul modelului tăiat sau parțial nu se scrie; costul se rezervă înainte de apel; extragerea structurii marchează sursele necitite.
- **Ce se măsoară**: timpul de redactare a metodologiei; marcajele rămase la prima versiune; corecturile de structură făcute de om după extragere.

**Ce NU e indicator de succes**: numărul de pagini generate.

---

## 11. Alegerile rămase pentru owner

Direcția (asamblor de dosar cu redactare asistată în interior) e decisă (15.11.2026). Rămân șase alegeri. Varianta presupusă în această specificație e cea marcată **(recomandat)**, din dezbaterea de arhitectură.

| # | Alegere | A | B | C |
|---|---|---|---|---|
| 1 | Pilotul | **o licitație curentă, cu responsabil desemnat (recomandat)** | retrospectiv, pe un dosar deja depus | toate tipurile de licitații deodată |
| 2 | Structura inițială | **confirmată de om, cu sursa alături (recomandat)** | extrasă asistat, apoi confirmată de om | model fix implicit |
| 3 | Biblioteca | un singur administrator | **titulari și aprobatori pe domenii (recomandat)** | import integral din arhivă |
| 4 | Finalizarea | **inventar întâi, PDF ulterior, semnare în afara platformei (recomandat)** | PDF din prima livrare | semnare și depunere integrate imediat |
| 5 | Porțile | doar avertismente | **blocaje pe fapte; incertitudinile rezolvate cu dovadă și responsabil (recomandat)** | verdict AI de conformitate |
| 6 | Dosarele primite de la un colaborator extern | **intră în inventar ca piese externe, cu aceleași verificări (recomandat)** | rămân în afara platformei | se rescriu în platformă |

Alegerea 5 include și o decizie amânată azi: identitatea lucrării (nume din alte licitații) e doar avertisment până la decizia owner-ului (`ofertarePoarta.js:183-186`). Varianta B o împarte: contradicția cu fișa aprobată (V5) devine blocaj după confirmarea nepotrivirii; numele străine fără legătură cu fișa (V6) rămân alertă contextuală.

---

## Anexa A. Lecțiile de review care contează la implementare

Din `docs/paw/LECTII_REVIEW.md`. Aici: cum le-a prins specificația, ca să nu fie descoperite abia la review.

| Lecție | Unde contează | Cum e prinsă aici |
|---|---|---|
| L01 lock înainte de verificare / CAS | confirmarea structurii, fixarea versiunilor, verificarea pieselor | 9.4: RPC-urile blochează întâi părintele, primesc versiunea văzută și refuză la diferență |
| L02 atomic | structură + surse; aprobarea unei versiuni din bibliotecă; pachet + manifest + pagini | 9.4: o intenție = o tranzacție într-un singur RPC |
| L03 rezultat vechi | completarea din bibliotecă, asamblarea PDF, textul generat | piesa reține versiunea sursei și a fișei folosite; rezultatul se scrie doar dacă sursa e încă la versiunea citită (8.2, pasul 4) |
| L04 / L05 idempotență și ambiguu | asamblarea pe server, încărcarea fișierelor semnate | cheie pe intenție la asamblare; un eșec ambiguu nu șterge și nu regenerează, se recitește starea (de detaliat la pasul 4) |
| L06 ordinea lock-urilor | RPC-uri care ating piese, legături și pachet | ordinea se scrie în fiecare RPC; nicio sincronizare de copii prin triggere (2.3) |
| L07 toate căile | stările pieselor, aprobările din bibliotecă | stările doar prin RPC / triggere în BD, nu doar în UI (2.5, 9.4) |
| L08 identitate | aprobări, confirmări, proveniență | `auth.uid()`; proveniența pusă de server, imuabilă (9.4) |
| L09 entitatea țintă | piese care trimit la documente, dovezi, versiuni din bibliotecă | dreptul se verifică pe licitația fiecărei ținte (9.4) |
| L11 dovada | locatorul dovezii | ancoră aleasă din piesă, nu primul număr din text liber (9.3) |
| L12 completitudine | structura, inventarul, extragerea asistată | sursă necitită = „structură incomplet verificată”; lipsurile nu dispar (3.2, 8.1) |
| L13 parsere | V2, V4, V10, V11 | tipare ancorate, testate pozitiv și negativ, definite într-un singur loc (7.1) |
| L14 / L15 migrări și porți | fiecare pas cu tabele noi; verificările noi în poarta de pe server | migrare + revenire testată pe clonă de chat; porțile noi intră în poarta existentă, nu într-una paralelă |
| L16 unicitate și hash | piese, versiuni din bibliotecă, fișiere | UNIQUE pe (licitație, lot, versiune) etc.; identitatea fișierului = SHA-256 pe conținut (5.3, 9.2) |
| L17 timp | valabilitatea (V7) | ora României, la data relevantă, nu „azi” în UTC |
| L18 necunoscut ≠ ok | toate verificările | 7.1: control indisponibil, dată lipsă, scan necitit = „neverificat” |
| L19 o singură definiție | „piesa e completă”, tiparele de text | 7.1 și 9.4: o definiție, citită de UI, poartă și asamblare; paritate testată unde există două |
| L20 căile legitime | excepțiile la V4 / V6, „nu se aplică” | excepții cu motiv și om; teste și pe căile permise |
| L21 / L22 răspuns și cost AI | extragerea structurii, metodologia mai lungă | răspuns tăiat sau parțial nu se scrie; cost rezervat înainte de apel (pasul 5); generatorul de azi le respectă deja |
| L23 paginare | dovezi, legături, piese pe dosare mari | keyset (9.4) |
| L24 async | ecranul dosarului, asamblarea | rezultatul se aplică doar pe licitația și versiunea curente (de detaliat la implementare) |
| L25 teste reale | toți pașii | rezultatele așteptate din surse independente; paginile verificate pe PDF-ul real, nu pe calcul (pasul 4) |
| L10 secrete | — | n/a: asamblorul nu introduce secrete noi |

## Anexa B. Abateri de la dezbaterea de arhitectură

Specificația urmează recomandarea B din dezbatere (asamblor cu redactare asistată în interior), pașii 1–5 și cele șase alegeri. Abaterile:

1. **„Direcția” nu mai e o alegere**: owner-ul a decis-o pe 15.11.2026. Locul ei în tabel îl ia alegerea 6 (dosarele colaboratorului extern), care vine din dezbatere: varianta „verificator” e acolo o etapă inițială în asamblor, iar dosarele scrise de un colaborator extern sunt exact cazul ei.
2. **Registrul angajamentelor apare din pasul 2, nu doar ca poartă**: dezbaterea îl propune la porți; aici e și sursa verificării V10 și a piesei de punctaj, deci trebuie să existe înaintea lor.
3. **Pagina finală nu e coloană pe dovadă**: dezbaterea cere „pagină finală” în lanț; aici e calculată pe pachet (`ofertare_dosar_pagini`), pentru că depinde de versiunea pachetului, iar coloana existentă `pagina_globala` nu a fost niciodată scrisă.
4. **Numele bibliotecii**: „Biblioteca de piese standard”, ca să nu se confunde cu biblioteca juridică existentă.
5. **Fișa lucrării ca obiect aprobat**: dezbaterea cere „o singură fișă aprobată” pentru identitate; aici e tabel versionat, pentru că și piesele completate trebuie să știe din ce versiune vin.
