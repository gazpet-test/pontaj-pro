# Uscare conductă în Execuție — specificație (prima livrare, runda 4 după review)

Stare: **cod + migrare NEAPLICATĂ** (`supabase/migrations/20261225a_executie_uscare.sql`, revenire în
`supabase/revenire/20261225a_executie_uscare_ROLLBACK.sql`). Ecranul: Execuție → proiect → Izometrie → „💨 Uscare conductă”
(`src/UscareConducta.jsx`). Până la aplicarea migrării, ecranul spune că funcția nu e încă activă și nu scrie nimic.

> **Livrarea pe producție (decizia proprietarului, 17.11.2026; §11 „Livrarea pe producție”):** amprenta globală L15 v2 se calculează
> înainte și după migrare, în aceeași tranzacție; plafonul tranzacției a fost ridicat la **5.000 ms** (era 2.000) și bugetul de lock se
> numără de la **prima încercare** (nu de la BEGIN). Tranzacția estimată pe producție: ~2,5–2,8 s. De confirmat prin proba cu ROLLBACK pe
> producție; dacă nici așa nu încape, se ia o instanță mai puternică (nu audit după COMMIT).

## 1. Ce cere contractul și ce cere beneficiarul

**Din documentația contractului** (caietul de sarcini, fir liniar, cap. 4.1.8.5, pag. 155/508 din Proiectul tehnic 1413/2020, Vol. 1.1;
raportul de documentare din 16.11.2026):

| Ce se ȘTIE (scris în caiet) | Text |
|---|---|
| Obligația | uscarea e obligatorie, după proba cu apă și din nou după proba cu aer |
| **Metoda** | „suflare cu aer și utilizare de pistoane absorbante” |
| **Condiția de oprire / criteriul de acceptare** | „Conducta se consideră uscată atunci când **ultimul piston vehiculat iese uscat**.” |
| Plata | articolul de deviz `GC01M1 [1]` (uscare, hm) + pistoane de uscare din burete (cod 7500211) |

| Ce NU se știe (nu e scris nicăieri; nu se inventează) |
|---|
| un prag pentru **punctul de rouă** (valoare, presiune de referință, durată, loc, aparat) — singura mențiune din Volumul 1.1 e la izolarea sudurilor |
| un criteriu pentru **diferența de greutate a buretelui** și câte treceri consecutive |
| procedura detaliată a beneficiarului (aer uscat / azot / vacuum, numărul de treceri) |
| aparatele de măsură (tip, serie, verificare metrologică) — se pot trece la observații |
| numărul de exemplare, termenul de predare, formatul fotografiilor, calea notificării |

**Din mesajul beneficiarului din 27.10.2026** (model de raport atașat): rubricile tabelului (mai jos), notificarea **cu minimum 24 h
înainte**, fotografii „acolo unde este posibil” (presiune, temperatura exterioară, configurația pistoanelor, cântărirea buretelui la intrare
și ieșire), semnăturile constructorului și ale reprezentantului beneficiarului. **Fără procedură și fără valori de acceptare.**

Rubricile modelului (un singur tabel, în această ordine): data, tronson, de la km, la km, lungime, temperatura exterioară, constructor;
utilaje (denumire, buc.), perioada (început, final), durata, configurația pistoanelor (PIG metalic, piston poliuretan, bureți spumă),
cântărirea buretelui 1 (intrare / ieșire), punctul de rouă (valoare, loc); presiunea în spatele buretelui, timpul de deplasare, viteza
medie, cântărirea bureților 2 și 3; observații; concluzie CONFORM / NECONFORM; semnături.

## 2. Criteriul de acceptare în aplicație (P1 din review)

- Implicit, criteriul e cel din caiet: **ultimul piston vehiculat iese uscat** — rezultat consemnat explicit (`piston_final_rezultat`:
  uscat / umed) + **fotografia ultimului piston** (categoria `piston_final`).
- **CONFORM** se poate închide doar cu dovada criteriului: rezultat „uscat” **și** cel puțin o fotografie a ultimului piston (blocant).
- **NECONFORM** se poate închide cu rezultatul negativ consemnat („umed”), fără fotografia pistonului.
- **Punctul de rouă și locul măsurării sunt OPȚIONALE**: rămân rubricile modelului (se trec dacă s-au măsurat) și apar în PDF; nu decid
  concluzia, nu sunt cerute la închidere.
- **Niciun prag numeric** pentru rouă sau pentru diferența de greutate: concluzia o pune omul. Diferența de greutate se afișează doar în
  aplicație (decizia D), PDF-ul păstrează rubricile beneficiarului.
- PDF-ul are, sub observații, rândul „Ultimul piston vehiculat iese uscat (criteriul din caietul de sarcini): ☐ DA ☐ NU”.

## 3. Fluxul

1. **Planificare** — „Uscare nouă” pe un tronson de probă (codul și km-ii se completează singuri) sau pe un interval liber. Constructorul e
   propus (ultimul folosit pe proiect, altfel firma) și **se confirmă la creare** (bifă obligatorie); rămâne editabil și se păstrează în
   raport. Se trec începutul planificat, momentul notificării beneficiarului și referința ei.
2. **Notificarea cu 24 h** — platforma NU trimite nimic; consemnează și **avertizează** dacă notificarea e sub 24 h față de începutul real
   (sau, până la el, cel planificat). Comparația e pe momentul exact, în ora României.
3. **Operațiunea** — pe telefon, pe secțiuni; salvare pe parcurs (buton fix jos) + **ciornă locală** în browser, **și pentru raportul nou**,
   înaintea primei salvări. O ciornă care nu se poate scrie (stocare plină / blocată) e arătată omului (nu se mai promite „rămâne în ciornă”).
   Ciorna ține și rândul de bază: restaurarea pe o versiune mai nouă trece prin îmbinarea pe câmpuri (§6).
4. **Poziția** (§9) și **vremea** (§10).
5. **Măsurători și poze** — fiecare secțiune are „📷 Fotografiază” (camera telefonului), pe categoria ei; la cântăriri, pe fiecare burete și
   pe intrare / ieșire; la criteriu, ultimul piston. Pozele se adaugă după prima salvare. Fiecare poză: **rezervarea căii pe server** →
   urcarea fișierului → înregistrarea (§7).
6. **Concluzia** — omul alege CONFORM / NECONFORM (§2).
7. **Închiderea** — doar completă (§5). **Raportul semnat** — PDF-ul (tabelul + anexa foto cu legendă) se tipărește și se semnează; un
   raport neînchis iese marcat „CIORNĂ”.

### Accesul de pe telefon

Ecranul de uscare se deschide pe două drumuri, cu aceeași componentă (`UscareConducta`, aceleași RPC-uri și aceeași logică):
(1) **din aplicația completă** — Execuție → proiect → Izometrie → „💨 Uscare conductă” (adresa directă `/executie?proiect=<id>&tab=uscare`);
(2) **din lansatorul de telefon `/m`** — butonul „💨 Uscare conductă”. La deschiderea lansatorului **nu se enumeră nimic**: butonul apare
după partea de modul a dreptului (owner, din profilul încărcat oricum, sau rândul propriu `executie` din `user_module_access` cu nivel
editor / admin — o singură citire ușoară); dacă citirea eșuează, butonul se arată și decide verificarea de la apăsare. Abia **la apăsare**
se citesc proiectele **active** (arhiva nu se oferă pe telefon) și se verifică pe fiecare dreptul de **scriere** cu aceeași funcție pe care
o cere ecranul (`fn_executie_nod_drept(proiect, true)`: owner sau modulul `executie` editor / admin, plus accesul pe proiect), cu „Se verifică
proiectele…”; dacă nu iese niciunul: „Nu ai drept de scriere pe niciun proiect activ de Execuție”. Un singur proiect = direct ecranul de
uscare al lui; mai multe = o listă scurtă (întâi cele cu rapoarte deschise), apoi ecranul. „← Înapoi” duce la listă / la lansator; cât e
deschis un raport, ieșirea e „← Lista” din ecran (întreabă la modificări nesalvate). O verificare de drept eșuată se arată cu „Reîncearcă”
(nu devine „fără drept”). La ieșire, citirile în curs se opresc (nicio pagină sau verificare în plus). Poarta reală rămâne în BD (RLS + RPC-uri).

## 4. Stările

| Stare | Ce se poate | Cine |
|---|---|---|
| `deschisa` | salvare (CAS pe versiune), poze rezervate / adăugate / scoase, renunțări, închidere, anulare | scriere pe proiect |
| `inchisa` | NIMIC nu se mai schimbă (nici pozele, nici rezervările), pe nicio cale (trigger-e). Doar **redeschidere consemnată** (decizia A): motiv obligatoriu, revizia crește, versiunea închisă (raport + pozele) rămâne în jurnal | administrator Execuție / owner, **cu acces la proiect** (`fn_executie_contract_drept`, cu restricția pe proiect) |
| `anulata` | finală (motiv obligatoriu); nimic nu se mai schimbă; o rezervare rămasă nu mai primește fișier | scriere pe proiect, doar din `deschisa` |

Tranzițiile (o singură listă, `fn_executie_uscare_tranzitie` = `TRANZITII` din `src/uscareLogica.js`, test de paritate):
`deschisa → inchisa`, `inchisa → deschisa`, `deschisa → anulata`. Un raport nu se șterge niciodată.

## 5. Ce cere închiderea (o singură definiție: `fn_executie_uscare_lipsa` = `lipsaDinRand`, paritate pe 25 de cazuri în proba PGlite)

1. rubricile modelului: data, lungimea, temperatura, constructorul, cel puțin un utilaj, orele, configurația pistoanelor, presiunea, timpul
   de deplasare (NU punctul de rouă, observațiile, semnatarii — aceștia se pot scrie de mână);
2. **câte o cântărire pe FIECARE burete declarat** (rândurile 1…n, n = bureții spumă, cel mult 20), fiecare cu intrare și ieșire **sau**
   marcată explicit „nu se aplică” cu motiv (ex. buretele rămas în conductă) — fără kg în acel caz;
3. rezultatul ultimului piston și concluzia; la CONFORM dovada criteriului (§2, blocant);
4. **fotografiile cerute** (decizia B): presiunea, temperatura, pistoanele, cântarul la intrare și la ieșire **pe fiecare burete cântărit**;
   cele lipsă nu blochează, dar cer **justificarea lipsei consemnată** (`poze_justificare`, salvată cu raportul și în jurnal);
5. **zero încărcări nelămurite** (§7).

## 6. Concurență, idempotență, conflict (P1 din review)

- **Cheia apăsării** (UUID per intenție, scrisă în registrul local ÎNAINTE de trimitere): fiecare RPC o **revendică întâi** (lock
  consultativ pe cheie), apoi caută în jurnal. Două apeluri cu aceeași cheie (reîncercare după timeout, două taburi) se serializează: al doilea
  primește „duplicat” cu raportul primului — **nicio dublură la creare**. Aceeași cheie cu alt conținut / alt proiect = refuz.
- O intenție **nelămurită** (rețea) rămâne în registru; **o creare nelămurită blochează orice creare nouă** pe proiect până la lămurire; o
  salvare nelămurită pe un raport blochează alte salvări pe el. Un `23505` (cheia scrisă de alt apel) sau un `42501` nu dovedesc nimic: cheia
  se caută în jurnal (o cheie retrasă = neaplicată).
- **Lămurirea are doar două ieșiri, amândouă cu răspuns de la server** (runda 3, L05):
  1. **„Retrimite identic”** — aceeași cheie: serverul întoarce rezultatul de data trecută („se salvase deja”) sau o aplică acum.
  2. **„Renunț”** — NU mai șterge cheia pe baza markerului local. Ecranul cheamă `fn_executie_uscare_retrage(rpc, parametri, cheie)` cu
     **intenția** din registru (numele RPC-ului + parametrii exacți ai cererii, fără cheie; runda 5), care ia același lock pe cheie (o cerere
     încă în curs se termină întâi) și răspunde după jurnal: **aplicată** → reușită, nimic scris; **neaplicată** → scrie în jurnal o
     **retragere** (`cheie_retrasa`, fără raport), deci cererea pierdută, dacă ajunge mai târziu, e **refuzată** (22023): „nu există” devine
     sigur și definitiv. Fără răspuns sigur (rețea, drept), cheia rămâne în registru.
  Cele două ieșiri **nu sunt interschimbabile**: „Retrimite identic” poate APLICA tocmai cererea la care omul voia să renunțe; doar „Renunț”
  o oprește. De aceea „Renunț” nu are cotă (runda 5) și rămâne mereu posibil pentru autorul cererii.
  O creare lămurită ca aplicată cât formularul „nou” e încă deschis **deschide raportul creat** (butonul „Creează” dispare): nicio cale spre
  o a doua creare cu alt UUID.
- **Cheia e a AUTORULUI** (runda 4, verdict P2-4): jurnalul e unic pe `(creat_de, cheie)`, `creat_de` = `auth.uid()` pus de trigger,
  obligatoriu; toate RPC-urile caută cheia doar în spațiul de chei al apelantului. Un alt cont care cunoaște UUID-ul (din orice proiect) nu
  poate retrage, ocupa sau bloca intenția altcuiva: retragerea lui (sau o operație a lui cu aceeași valoare) privește doar cheia LUI.
- **Retragerea e legată de INTENȚIE** (runda 5, verdict r4 P2-4): serverul NU primește un proiect declarat, ci derivă din intenție, cu
  aceleași reguli ca RPC-ul ei, **proiectul** (salvarea: `p_proiect`, iar raportul, dacă e dat, trebuie să fie al lui; starea / poza:
  proiectul raportului țintă, citit din BD — proiectul unui raport nu se schimbă) și **amprenta** conținutului (`fn_executie_uscare_amprenta`,
  o singură funcție internă, folosită și de cele 3 RPC-uri pe parametrii lor — L19). Retragerea unei chei absente cere **scriere pe proiectul
  intenției**; rândul `cheie_retrasa` poartă proiectul și amprenta ei. O cerere ulterioară a autorului cu cheia retrasă: aceeași intenție =
  „retrasă”, alta = „cheia altei operații” (ambele 22023, nimic aplicat). Întrebarea despre o cheie existentă cere citire pe proiectul ei și
  ca proiectul + amprenta din jurnal să fie ale intenției trimise (altfel 22023). Un cont care nu (mai) scrie pe proiectul intenției nu o
  poate retrage (42501) — pe protocolul r4 retragerea se înscria pe proiectul declarat.
- **Evidența retragerilor — acumulare ACCEPTATĂ explicit** (runda 5, decizia coordonatorului): un rând `cheie_retrasa` rămâne **permanent**
  (o ștergere ar lăsa cererea întârziată să se aplice după „Renunț”, iar promisiunea „refuzată definitiv” ar cădea) și **nu există cotă**
  (cota din runda 4 bloca tocmai calea de siguranță). Evidența **crește** cu un rând mic (cheie, proiect, autor, amprentă, moment) pentru
  fiecare cerere abandonată de om prin „Renunț”; volumul așteptat: **câteva rânduri pe an pe cont** (o retragere apare doar după o cerere
  rămasă fără răspuns din cauza rețelei ȘI decizia omului de a renunța). Protecția împotriva abuzului: cheia e a autorului (alt cont nu
  scrie în spațiul lui de chei) + dreptul de scriere pe proiectul intenției; niciun alt mecanism de limitare. O curățare sigură ar cere o
  schimbare de protocol (chei cu termen de valabilitate verificat de server, după care cererea e refuzată oricum) — **nu se face acum**.
- **Răspunsurile întârziate** (runda 4 + runda 5, verdict r4 P2-3): orice acțiune asincronă a ecranului (salvare, schimbarea stării,
  „Retrimite identic”, „Renunț”, deschiderea raportului creat, poza — inclusiv **comprimarea** —, reîncercarea fișierului, înregistrarea /
  scoaterea / renunțarea la o poză, citirea pozelor, propunerea meteo și alegerea din listă, GPS, PDF) capturează contextul (generația,
  proiectul, raportul deschis, registrul, contul) **înaintea primului `await`**, îl transmite mai departe (nimic nu se recapturează după un
  `await`) și îl verifică după fiecare `await` al ecranului și al exportatorului PDF (inclusiv cele trei etape ale citirii unei poze:
  `fetch()`, `blob()`, `FileReader` — runda 7); o scriere se emite doar dacă e încă valid (altfel nimic trimis, nimic în registru).
  **Limite (verificarea respinge rezultatul, nu oprește operația deja pornită):** o citire paginată comună deja pornită își continuă
  paginile, iar rezultatul vechi e respins la apelant; cererea de URL-uri semnate și o captură `html2canvas` deja pornite se termină, iar
  rezultatul e aruncat; o citire `FileReader` deja pornită se termină, dar nu mai produce nimic (exportul e anulat la verificarea de după).
  Doar descărcarea pozelor e oprită efectiv în zbor (prin semnalul de anulare). Rezultatul
  dovedit scoate totuși cheia din registrul proiectului cererii (registrul capturat), chiar dacă omul a navigat între timp. Cât o cerere e în
  zbor, câmpurile formularului sunt blocate, iar salvarea / schimbarea stării anulează capturile GPS și propunerile meteo încă în zbor (ar
  ateriza peste formularul înlocuit de răspuns).
  **PDF-ul** (runda 6, verdict r5 P2): verificarea nu stă doar în ecran, după export — exportatorul (`uscarePdf.js`) primește o funcție de
  verificare a contextului și un semnal de anulare (anulat de ecran la orice schimbare de raport / proiect / ieșire). Contextul se verifică
  după URL-urile semnate, la fiecare poză după `fetch()`, după `blob()` (dacă a căzut, `FileReader` nu mai pornește) și după citirea
  `FileReader` (runda 7, verdict r6 P3), înainte și după fiecare captură și **imediat înainte de descărcare**; context schimbat =
  buclele se opresc, citirile pozelor în zbor sunt anulate, nimic descărcat, niciun mesaj (o citire întreruptă de anulare nu se numără ca
  „poză necitită”). O eroare reală, cu contextul încă valid, se arată în continuare. Probe: `src/uscarePdf.test.js` și testele „runda 6”
  din `src/UscareConducta.test.jsx` (exportatorul real, poza amânată, navigare între timp → zero descărcări; martorul fără navigare → una).
- **CAS**: formularul ține **versiunea de bază** (rândul pe care s-a pornit). La conflict serverul întoarce rândul curent; aplicația **nu
  salvează peste coleg**: îmbină în trei (baza, formularul, serverul) pe câmpuri — schimbările colegului pe câmpurile neatinse intră,
  ale mele rămân, câmpurile schimbate de amândoi cu valori diferite **se aleg explicit** („al meu” / „al colegului”); salvarea e blocată până
  la confirmare, apoi pleacă pe versiunea nouă. La fel la restaurarea unei ciorne pe o versiune veche.
- **Momentele (orele) se compară pe INSTANT**, nu pe textul orei locale: ora de pe ecran + apariția aleasă (la ora de iarnă) + instantul
  original. La 25.10.2026, 00:30Z și 01:30Z se afișează amândouă „03:30”: dacă un coleg a mutat ora pe cealaltă apariție, schimbarea nu se vede
  pe ecran, deci **se arată ca alegere explicită** („03:30 (ora de vară)” / „03:30 (ora de iarnă)”), nu se preia și nu se suprascrie pe tăcute.
  Alegerea pune împreună textul orei, apariția și instantul original.
- Ordinea lock-urilor (L06), aceeași pe toate căile: cheia → raportul FOR UPDATE → rezervarea FOR UPDATE → poza FOR UPDATE → jurnalul (și la
  „scoate”: întâi rezervarea, apoi poza). Retragerea: cheia → autorul (lock consultativ pe cont, doar înaintea numărării) → jurnalul.

## 7. Fotografiile și încărcările parțiale (P2 din review)

- **Rezervarea căii pe server înaintea urcării** (`executie_uscare_incarcari`: calea, categoria, buretele, legenda, cine, când). Storage
  acceptă fișierul DOAR pe o cale rezervată, nerenunțată, neînregistrată, a unui raport deschis, cu drept de scriere pe proiect.
- După urcare, „adaugă” înregistrează poza din rezervare (serverul verifică fișierul). Dacă urcarea sau înregistrarea se întrerup,
  rezervarea rămâne **vizibilă din server** (supraviețuiește refresh-ului) în secțiunea „Încărcări de fotografii nelămurite”: „Înregistrează”
  (fișierul a ajuns), „Reîncearcă fișierul” (cât mai e în memorie), **„📷 Alege fișierul pentru această rezervare”** (după refresh: fișierul
  ales urcă pe ACEEAȘI cale rezervată, apoi se înregistrează — fără rezervare nouă) sau „Renunț…” (cu motiv, în jurnal).
- PDF-ul are, sub observații, **justificarea fotografiilor lipsă** (dacă e scrisă): documentul distribuit păstrează explicația.
- **Nimic nu se șterge automat** după un rezultat ambiguu; o poză scoasă din raport își închide rezervarea („poză scoasă din raport”);
  fișierul rămâne în bucket, ca dovadă. Închiderea cere zero rezervări nelămurite.
- În anexă, ora fotografiei = ora ÎNCĂRCĂRII în platformă (scris „încărcată la”), nu ora din aparat.

## 8. Matricea de acces

| Cont | Citește rapoartele / pozele | Creează / salvează / poze / închide / anulează | Redeschide |
|---|---|---|---|
| owner | toate proiectele | da | da |
| Execuție `admin`, nerestrâns | toate | da | da |
| Execuție `editor`, nerestrâns | toate | da | nu |
| Execuție `viewer` | toate | nu | nu |
| cont restrâns, `editor` pe proiect | doar proiectele lui | doar pe proiectele lui | doar dacă are și modulul `admin` (și acces la proiect) |
| cont restrâns, `viewer` pe proiect | doar proiectele lui | nu | nu |
| alt modul / fără drept / anonim | nimic | nu | nu |

Scrierea: DOAR prin `fn_executie_uscare_salveaza` / `_stare` / `_poza` / `_retrage` (SECURITY DEFINER, `auth.uid()` obligatoriu); niciun
drept INSERT / UPDATE / DELETE pe tabele. Fișierele: nicio modificare / ștergere din aplicație. **Autorizarea retragerilor** (runda 4 +
runda 5): retragerea unei chei cere scriere pe proiectul INTENȚIEI (derivat de server din cererea trimisă, nu declarat) și privește DOAR
cheile apelantului (autor = `auth.uid()`); întrebarea despre o cheie proprie deja folosită cere citire pe proiectul ei, același proiect și
aceeași amprentă (altfel 22023); fără cotă (§6).

## 9. Poziția operațiunii (cerința nouă)

- Câmpuri: coordonate (6 zecimale), **sursa** (`gps` = GPS din telefon / `traseu` = propusă din traseu după km / `manual` = scrisă de mână),
  **precizia** (doar la GPS, obligatorie acolo), **momentul capturii**; la traseu și **km-ul** + **versiunea traseului** (sha256 al
  fișierului de traseu). Toate sau niciunul (CHECK + RPC).
- **GPS doar la cererea omului**: butonul „📍 Poziția mea” face O citire (`getCurrentPosition`), fără urmărire continuă; alternativa e
  scrierea de mână. Poziția confirmată (cea salvată) e separată de propunere: nimic nu se salvează fără apăsarea „Salvează”. Dacă se cer
  două citiri, se aplică doar **ultima cerută** (răspunsurile pot veni în ordine inversă); o editare manuală a poziției anulează citirile în curs.
- **Propunerea din traseu** (`pozitieDinTraseu` în `src/uscareLogica.js`, testată): punctul de pe ax la km-ul dat, prin INVERSAREA calibrării
  pe borne (ca `calibrare()` din `src/lib/izoKml.js`), cu interpolare între borne și extrapolare limitată; ecranul spune că **distanța
  geometrică nu e automat km contractual**. Ecranul NU are încă alegerea traseului (în platformă nu există un traseu calibrat salvat pe
  proiect; axul îl alege omul la importul KML) — rămas pentru o rundă următoare.
- **Coordonatele exacte NU apar implicit în PDF**: doar cu bifa „Include coordonatele exacte”, dată pentru raportul deschis și valabilă
  pentru **următorul export** al lui (nu se moștenește la alt raport / proiect și nu rămâne bifată după export).

## 10. Vremea pentru locul și ora operațiunii

**Acum (până la funcția edge nouă), cu vremea șantierului existentă** (`meteo_cache`, scrisă de `meteo-sync` cam la 2 ore):

- „🌡️ Din meteo” cere întâi **ora începerii**: vremea se propune pentru ea. Se propune doar dacă **ora observației furnizorului**
  (`curent.la`, nu ora preluării) e la cel mult **3 h** de ora începerii — nu se propune vremea curentă pentru o operațiune trecută.
- La salvare, **serverul construiește instantaneul** (L08: proveniența o pune serverul) din `meteo_cache` al unui șantier AL PROIECTULUI:
  furnizorul, șantierul, coordonatele cerute (ale șantierului), **ora cerută** (= ora începerii), **ora observației**, **ora preluării**,
  valoarea automată, vremea. Clientul trimite doar cererea `{cerere: 'santier', site_id}`; un instantaneu scris de client e refuzat.
- Temperatura din raport = cea automată (sursa `meteo`, egală cu instantaneul) sau **cea măsurată de om** (sursa `manual`). Dacă omul
  corectează, **se păstrează și valoarea automată** — și când corectează **înaintea primei salvări** (propunerea încă nesalvată): cererea
  meteo pleacă la server odată cu temperatura măsurată, iar serverul construiește instantaneul (valoarea automată) alături de ea.
- **Invalidarea** (runda 3): schimbarea **instantului** orei începerii (inclusiv alegerea celeilalte apariții a orei de iarnă) golește
  temperatura „din meteo” și propunerea nesalvată; serverul refuză oricum sursa `meteo` pentru alt instantaneu decât cel al orei curente.
  Schimbarea **poziției** anulează propunerea NESALVATĂ (și temperatura ei, dacă era „din meteo”); instantaneul deja salvat e al
  șantierului (nu depinde de poziție) și rămâne. Un răspuns meteo **încă în zbor** când ora / apariția / poziția se schimbă se ignoră
  (generația sursei), la fel o listă de alegere afișată pentru sursa veche. Dacă poziția operațiunii e la peste 10 km de șantierul vremii,
  ecranul avertizează.
- Șantierele proiectului se citesc toate (keyset, fără plafon tăcut de 50), vremea lor pe bucăți de câte 100 (L23).

**Proiect: funcția edge `uscare-vreme` (vremea pe coordonatele operațiunii) — NU e scrisă în această rundă.**

| Aspect | Proiect |
|---|---|
| Intrare | `{ uscare_id, lat, lng, ora }` (ora = ora începerii raportului, ISO cu fus orar) |
| Drept | JWT obligatoriu + verificare de ROL în cod: `fn_executie_nod_drept(proiect_raportului, true)` prin RPC cu identitatea apelantului (nu `verify_jwt` singur, nu `service_role` pentru decizie); raportul deschis |
| Validări | coordonatele raportului = cele cerute (poziția confirmată, nu una arbitrară); `lat` / `lng` în domeniu, 6 zecimale; ora în ultimii 2 ani / următoarele 60 de zile; o cerere pe raport la ≥ 60 s |
| Furnizor | Xweather (cheia existentă a `meteo-sync`): `conditions` pentru ore ≤ 3 h de acum; pentru ore mai vechi — arhiva orară (de verificat disponibilitatea istoricului orar și costul înainte de cod; Open-Meteo ERA5 orar ca alternativă gratuită, cu rezoluția lui) |
| Ora din trecut | se cere observația orară cea mai apropiată de ora începerii; dacă furnizorul nu are oră la ≤ 1 h, NU se propune nimic (motiv afișat) — niciodată vremea curentă |
| Cache / deduplicare | cheia = (lat, lng rotunjite la 0,01°, ora rotunjită la oră, furnizor, versiunea extractorului); același rezultat reutilizat 24 h; o cerere în zbor pe aceeași cheie nu pleacă de două ori (lease cu CAS pe token) |
| Cotă | comună cu integrarea meteo existentă (același contor de apeluri Xweather / zi); refuzul local de cotă raportat distinct de eroarea furnizorului |
| Scriere | NU scrie raportul: scrie instantaneul într-un tabel nou `executie_uscare_meteo` (furnizor, coordonate cerute, ora cerută, ora observației, ora preluării, valori, răspunsul brut), iar `fn_executie_uscare_salveaza` acceptă `{cerere: 'coordonate', snapshot_id}` doar pentru un instantaneu al ACELUI raport cu coordonatele și ora lui curente (schimbarea poziției sau a orei îl invalidează) |
| Fișa a–e (CLAUDE.md pct. 7) | citește conținut extern (API meteo) și scrie (un rând) → poartă de rol + legătura cu raportul, fără mail / bani / drepturi; migrare + revenire + registrul automatizărilor la livrare |

## 11. Schema, livrarea, proba

- Tabele: `executie_uscari`, `executie_uscare_incarcari`, `executie_uscare_poze`, `executie_uscare_jurnal` (doar adăugare: creare, salvare
  cu diferențele, închidere / redeschidere cu conținutul complet, anulare, rezervări, poze, renunțări, retrageri de cereri nelămurite — singurul
  rând fără raport; cheia + amprenta conținutului). RLS pe
  toate patru (citire = `fn_executie_nod_drept(proiect_id, false)`), fără drepturi de scriere pentru clienți. Bucket privat
  `executie-uscare` (JPEG, 10 MB).
- **Livrarea cere amprenta globală L15 v2** (`scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5>
  --diferente-globale supabase/migrations/20261225a_executie_uscare.l15.tsv`): fără pasul „înainte” al runnerului în aceeași tranzacție,
  migrarea refuză (`AMPRENTA_GLOBALA_LIPSA`). Garanția pe lanțul de drept = amprenta globală (orice derivă a oricărei funcții / politici /
  drept = refuz); migrarea mai verifică pe amprentă cele două porți chemate direct și lanțul lor (listă scrisă, fără regex pe corpuri).
- **Validatorul runnerului** (runda 4): migrarea (91 de instrucțiuni la runda 5) și revenirea (1) trec `scripts/livrare_validator.py
  --plafon-tranzactie-ms <N>` (runda 16 a runnerului: migrarea cu 5000, revenirea cu 2000; orice alt plafon = refuz `PLAFON_DIFERIT`). Numele parametrului de plafon apare DOAR în citirea exactă acceptată (nici în comentarii); cele două CHECK-uri ale
  căii folosesc `E'…\\.jpg$'` (literal E, două backslash-uri = un singur backslash în regex, aceeași expresie în catalog — verificat în
  proba locală, amprentele de structură ale celor două tabele neschimbate).
- **Manifestul** `.l15.tsv` îl generează coordonatorul pe clonă (`scripts/livrare_l15_manifest.sh --iesire …`). Lista obiectelor pe care
  trebuie să le conțină — **252** (runda 5: 85 coloane, 79 constrângeri, 18 funcții — `fn_executie_uscare_amprenta` nouă, retragerea cu
  semnătura `(text, jsonb, uuid)` —, 6 politici, 24 relații — fără indexul cotei —, 8 tipuri, 32 trigger-e; familie, etichetă, operație; generată cu pașii reali ai runnerului pe PGlite și revizuită) — e în
  `supabase/tests/20261225a_executie_uscare.l15.obiecte.tsv`. Comparația (pe clonă, după generare; PG17 nu are constrângerile NOT NULL ca
  rânduri):
  `diff <(grep -v '^#' supabase/tests/20261225a_executie_uscare.l15.obiecte.tsv | sort) <(grep -v '^#' supabase/migrations/20261225a_executie_uscare.l15.tsv | cut -f1-3 | sort)` → gol.
- **Storage — politicile EFECTIVE** (runda 3): postcondiția copiază TOATE politicile de pe `storage.objects` pe o copie temporară (aceleași
  coloane, inclusiv `owner_id`, metadatele și coloanele generate) și **exact drepturile pe tabel** ale lui `anon` / `authenticated` (fiecare
  drept pe rând: o copie cu drepturi pe care tabelul real nu le dă ar da refuzuri false). Probează **7 identități**: anonim, un cont sintetic
  fără drept și conturi REALE citite din `profiles` / `user_module_access` / `executie_acces_proiect` (owner, admin / editor / viewer pe
  Execuție, un cont restrâns pe proiect). Fiecare are fișiere ale ei în bucket (`owner` = `owner_id` = contul, metadate ca la o încărcare
  reală), pe proiectul 0 (inexistent) și pe un proiect pe care contul îl vede. Ca fiecare: nu vede nimic, nu modifică / șterge nimic (fără
  filtru), nu încarcă nimic (cu și fără proprietar, pe ambele căi). La aplicare nu există nicio uscare / rezervare, deci politicile modulului
  nu deschid nimic: orice deschidere vine din altă politică și oprește migrarea (ex. `FOR INSERT TO authenticated WITH CHECK (owner_id =
  auth.uid()::text)`, contraexemplul review-ului r2). Drepturi doar pe coloane (fără dreptul pe tabel) = refuz explicit, revizuire de om.
  Totul anulat; costul nu depinde de mărimea tabelului. **Ce nu acoperă**: politici care se deschid doar pentru o uscare / rezervare EXISTENTĂ
  (nu există la aplicare) și trigger-ele lui `storage.objects` — acestea se probează pe clonă cu date (mai jos, pasul 3) și se revizuiesc în
  PR-ul de baseline: `SELECT polname, polcmd, polpermissive, polroles::regrole[], pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass ORDER BY 1;`
  Sonda **nu repară** o politică existentă: o politică generică incompatibilă se rezolvă explicit (PR separat, cu „da”-ul owner-ului).
- **Condițiile de funcționare ale sondei** (runda 4, verdict P1-2 / P2-5), verificate, raportate DISTINCT de refuzul pe politici:
  - ajutătorul temporar care scrie fișierele de probă rămâne **SECURITY INVOKER** (politicile INSERT se aplică rolului probat) și primește
    **EXECUTE explicit** pentru `anon` / `authenticated` (privilegiile implicite pot să nu-l dea lui PUBLIC); refuzul INSERT-ului (RLS /
    dreptul pe copie) e prins în corpul lui, iar un refuz al APELULUI = condiție lipsă, nu „încărcare refuzată”;
  - ACL-ul copiei e **normalizat** (se retrag toate drepturile primite la creare, ex. din privilegii implicite globale), apoi se reproduc
    drepturile tabelului real și se **verifică** egalitatea drepturilor efective, pe fiecare rol și drept;
  - drepturile doar pe coloane (nereproductibile) = condiție lipsă.
  O condiție lipsă oprește migrarea cu `SONDA_CONDITII` (nimic comis; revizuire de om), separat de `politicile EFECTIVE … deschid`.
- **Limitele sondei** (de citit înaintea oricărei concluzii „Storage e sigur”): e un **eșantion** — cel mult 7 identități, câte PRIMUL cont
  din fiecare categorie, căi cu uscarea 0, metadate fixe. Poate rata politici condiționate de **alte conturi**, de **alte metadate** sau de
  **rapoarte / rezervări existente**. Nu înlocuiește baseline-ul revizuit al politicilor de producție și nici probele cu structura reală pe
  clonă; amprenta unui baseline permisiv nu demonstrează siguranța lui.
- **Prima probă cu ROLLBACK pe țintă (17.11.2026): sonda a căzut, nimic comis.** Eroarea: `missing FROM-clause entry for table "objects"`.
  Cauza: pe țintă, `storage.objects` are 139 de politici; câteva au subinterogări care se referă la rândul exterior, iar `pg_get_expr` le
  tipărește calificate cu numele tabelei (`… WHERE i.cale = objects.name`, `objects.owner_id`). Recreate pe copia sondei, care avea alt nume,
  referirea nu mai avea la ce se lega. Clona de probă nu a prins pentru că acolo `storage.objects` nu are nicio politică. **Reparația**
  (doar în blocul sondei; funcțiile, tabelele, politicile modulului, lock-urile și garda neschimbate; lista obiectelor tot 252): copia se
  numește chiar `objects`, în schema temporară a sesiunii (`pg_temp.objects`), deci expresiile se recreează neschimbate (fără înlocuiri de
  text); tabela reală e numită peste tot `storage.objects`, copia `pg_temp.objects`; un `pg_temp.objects` deja existent în sesiune = refuz
  `SONDA_CONDITII`; o politică pe care copia n-o poate purta (ex. o funcție pe rândul întreg tipat `storage.objects`) = `SONDA_CONDITII` cu
  numele politicii, nu eroare brută. Proba PGlite (secțiunea 2b) reproduce forma țintei cu nume sintetice: codul vechi pică exact cu eroarea de
  pe țintă, codul nou trece cu aceleași verdicte, iar o politică preexistentă cu subinterogare care deschide bucket-ul e prinsă în continuare.
  Costul: ~210 ms cu 139 de politici față de ~155 ms fără (PGlite), departe de plafonul de 5000 ms. **Regula:** înaintea probelor unei
  migrări care citește politicile de pe `storage.objects`, clona de probă trebuie să poarte politicile țintei pe `storage.objects`.
- **Drepturile pe tabelele noi** (runda 3): migrarea retrage drepturile rămase ALTOR roluri (privilegiile implicite ale platformei) pe
  tabelele și secvențele ei; postcondiția și revenirea cer ACL-ul exact: proprietarul + `SELECT` (fără GRANT OPTION) pentru `authenticated` /
  `service_role`; pe secvențe doar proprietarul.
- **Revenirea** refuză dacă există date (raport / rezervare / poză / jurnal / retragere / fișier) și verifică **starea exactă**: corpul și
  proprietățile fiecărei funcții (18), fiecare politică (comanda, rolurile, expresia exactă), fiecare trigger (funcția, tipul, activ),
  bucket-ul (privat, limita, tipurile), drepturile pe tabele și ACL-ul exact (niciun alt rol, nici pe secvențe), coloanele (nume + tip, în
  ordine) și — runda 3 — **structura** fiecărui tabel ca amprentă: coloanele cu NOT NULL / valoarea implicită / identitatea / generarea /
  colația, **constrângerile** (nume + definiție: un `CHECK` adăugat pe tabelul gol = refuz), indecșii, opțiunile, parametrii secvenței.
  Amprentele de structură sunt calculate pe PGlite (PG 18, fără rândurile NOT NULL ca constrângeri, deci comparabile cu PG 17); pasul 5 de
  mai jos le confirmă pe clonă (o nepotrivire dă refuz cu amprenta găsită, nimic schimbat).
- **Proba locală** (`scripts/pglite/test_executie_uscare_local.mjs`, PGlite = PG 18): **105 verificări** (runda 5) — întâi **validatorul real al
  runnerului** (`scripts/livrare_validator.py --plafon-tranzactie`, ca `livrare_migrare.sh`) pe octeții migrării ȘI ai revenirii, plus formele
  vechi refuzate (backslash în literal obișnuit, numele parametrului de plafon în comentariu) și `bash -n` + linia `\echo` pe scriptul cu
  două sesiuni (runda 4); apoi aplicarea ca la livrare (manifest generat → livrare aprobată), drepturi pe 9 conturi, CHECK-ul căii în catalog
  (punct literal), criteriul, cântăririle, pozele / rezervările, meteo construit de server, poziția, stările, idempotența, retragerea cheii
  (legată de autor și — runda 5 — de intenție: proiectul derivat, amprenta, refuzul pe proiectul altei intenții; fără cotă: 25 de retrageri la
  rând trec; **paritatea amprentei**: fiecare cerere aplicată în probă, pe toate cele 9 tipuri, e găsită „aplicată” de retragerea intenției ei), CAS-ul, refuzurile (garda „înainte” și o tabelă veche citită acum, bugetul lock-ului fără
  coliziune, 8 politici Storage generice inclusiv contraexemplele `owner_id` din r2 și r3, drepturi pe coloane), fără refuz fals (politică fără
  dreptul de tabel; privilegiile implicite ale altui rol; privilegiile implicite globale pe copia sondei), condiția lipsă a sondei raportată
  distinct, revenirea (16 schimbări de definiție / structură / ACL la același număr de obiecte), **41 de mutanți** (runda 5: dreptul pe proiectul intenției, proiectul derivat din raport, amprenta cheii existente, cota pusă la loc, legarea
  cheii retrase de intenție în RPC-uri; un mutant al cărui text
  nu mai există în migrare = test picat, nu „mutant prins”), paritatea JS = SQL.
- **Proba cu DOUĂ sesiuni reale — obligatorie pe clonă** (PGlite are o singură conexiune):
  `supabase/tests/20261225a_executie_uscare_doua_sesiuni.sh` — scenariile, comenzile și rezultatele așteptate sunt în fișier; pe scurt:
  1. creare / reîncercare cu aceeași cheie, concurent: a doua așteaptă cheia, întoarce `duplicat: true` cu același id; un singur raport;
  2. salvare / închidere concurente pe aceeași versiune: una trece, cealaltă primește `conflict` (sau refuzul închiderii), nimic pierdut;
  3. poză / închidere concurente: închiderea așteaptă poza; fie poza intră înainte (și închiderea o vede), fie e refuzată după;
  4. (runda 3) creare în curs + „Renunț” pe aceeași cheie → „aplicată”, nimic retras; retragere în curs + crearea întârziată → refuz 22023;
     două chei diferite cu același `hashtext` → se serializează, dar fac DOUĂ rapoarte (intențiile nu se confundă);
  (Runda 5: retragerea primește intenția; fără cotă, deci fără scenariul R3 din runda 4; R2 verifică și proiectul retragerii.)
  Runda 4: în scenariile P2 / R2 linia `\echo R=:LAST_ERROR_SQLSTATE` (variabila psql neghilimelată; forma cu ghilimele simple nu se
  înlocuia — probat pe clonă) și se verifică și ieșirea procesului B.

### Livrarea pe producție (runda 3: limita uneltei de livrare)

**Gărzile de timp reale** (nu există altele; mențiunea unui plafon de 1.500 ms din raportul rundei 2 NU era o gardă — eliminată):

| Gardă | Unde | Ce face |
|---|---|---|
| `transaction_timeout = 5000 ms` (runda 16; era 2000) | pus de runner înainte de `BEGIN`; verificat în `$pre$` (`5000/session` + marcajul prologului); validatorul runnerului cere ca runnerul să dea exact această valoare | oprește toată tranzacția (amprentele runnerului + corpul + garda finală) |
| `lock_timeout = 100 ms` | `$pre$` | o așteptare implicită de lock nu depășește 100 ms |
| bugetul lock-urilor: 1 s de la **prima încercare** (runda 16; era de la `BEGIN`) | `$lock$` (migrare) | verificat **înaintea fiecărei încercări și după obținerea setului complet** (și fără coliziune); încercarea = subtranzacție (eșecul eliberează lock-urile parțiale); peste buget = `BUGET_LOCK`, nimic schimbat |
| bugetul lock-urilor la revenire: 1 s de la `BEGIN` | revenirea (fără amprentă globală, plafon 2000, nu s-a schimbat) | ca înainte |
| garda finală a runnerului | `livrare_migrare.sh` | plafonul ~5000 ms până la intrarea în COMMIT; tipărește și `LOCK_TINUT` (cât a fost ținut setul de lock-uri puternice de la obținerea lui până la gardă; fără COMMIT și fără eliberarea reală) |
| validatorul runnerului (runda 17) | `livrare_validator.py`, înainte de conexiune | fiecare comparație a plafonului din cod verificată STRUCTURAL (formă + valoare; altfel `PLAFON_FORMA`); runnerul fără `--plafon-tranzactie-ms` = `PLAFON_LIPSA` local, nu abia în `$pre$` |

Migrarea **nu fixează `statement_timeout`**; „lock la …”, „sfarsit la … ; lock-uri puternice tinute de …” sunt doar afișate. Lock-urile luate
(NOWAIT, ordinea fixă): `executie_proiecte`, `executie_probe_tronsoane` (cheile străine, SHARE ROW EXCLUSIVE), `storage.objects` (ACCESS
EXCLUSIVE: politicile + sonda; **oprește citirile și scrierile de fișiere din toată aplicația** cât e ținut — până la COMMIT, inclusiv pasul
„după” al runnerului, ~1,3–1,6 s estimat pe producție — o extrapolare, nu o măsurătoare) — de aplicat într-un moment liniștit.
**Lock-urile implicite de după set (runda 17):** `INSERT INTO storage.buckets` ia ROW EXCLUSIVE pe `storage.buckets` (+ indecșii, verificarea
de unicitate, triggerele platformei) cât `storage.objects` e deja ACCESS EXCLUSIVE; postcondițiile și sonda citesc `storage.buckets`,
`profiles`, `user_module_access`, `executie_acces_proiect` și lanțul de drept. Fiecare așteptare e limitată la 100 ms (`lock_timeout`), apoi
refuz, nimic comis — dar ținând deja fișierele oprite. Inventarul complet: comentariul blocului de lock din migrare și docs/LIVRARE_L15_V2.md
§9; proba pe clonă: `supabase/tests/l15_aplicare_concurenta.sh --migrare uscare` (inclusiv `storage.buckets` blocat).
**Revenirea** (plafon 2000, fără amprentă globală) are altă acoperire decât aplicarea L15: înaintea aplicării reale proprietarul acceptă
explicit procedura ei sau cere o revenire compatibilă L15, separat (docs/LIVRARE_L15_V2.md §9, „Fișierele de revenire”).

**De ce s-a schimbat (runda 16):** pe producție un calcul de amprentă durează ~0,86 s (cald, forma optimizată) + ~0,2–0,3 s pe un backend
proaspăt, iar pasul runnerului ~×1,5 ⇒ tranzacția întreagă ~2,5–2,8 s (estimat), peste vechiul plafon de 2.000 ms; iar amprenta
„înainte” (~1,2–1,3 s) consuma singură bugetul lock-urilor numărat de la `BEGIN`. Proprietarul a decis (17.11.2026): protocolul atomic
rămâne, plafonul urcă la 5.000 ms, secunda lock-urilor se numără de la prima încercare (docs/LIVRARE_L15_V2.md §9).

**Ce se măsoară la proba cu ROLLBACK pe producție** (cu acordul owner-ului, cu runnerul complet, într-o sesiune NOUĂ, ca la livrare): timpul
amprentei „înainte”, momentul obținerii lock-urilor (de la `BEGIN` și de la prima încercare), durata corpului migrării, timpul amprentei
„după”, garda finală (`PLAFON_TIMP`), `LOCK_TINUT` și — cu un observator din altă sesiune — momentul real al eliberării lock-urilor și
sesiunile aplicației care au așteptat; plus de câte ori apare `BUGET_LOCK` la 3 rulări. Dacă nu încape în 5.000 ms: instanță mai puternică.

## 12. Ce NU face prima livrare (pași următori, de decis)

- Nu sincronizează etapa „uscare” din Probe pe tronsoane cu raportul (fără copii sincronizate prin trigger-e); propunere: în fișa tronsonului
  de probă, lista rapoartelor de uscare legate (citire prin cheia străină).
- Nu trimite notificarea și nu trimite raportul (mailurile rămân la oameni). Nu are semnătură electronică.
- Nu are încă alegerea traseului pentru propunerea poziției după km (§9) și nici funcția edge pentru vremea pe coordonate (§10, proiectată).
- Constructorul implicit vine din ultimul raport al proiectului: proiectul nu are încă un câmp de configurare „constructor” (de adăugat cu
  acordul owner-ului, dacă se dorește).

## 13. Deciziile (presupuse pe recomandarea recenzentului; se pot schimba ușor)

- **A. Redeschiderea**: doar administrator Execuție / owner, cu acces la proiect, cu motiv; versiunea închisă se păstrează în jurnal.
- **B. Pozele lipsă**: BLOCARE pentru dovada ultimului piston uscat la CONFORM; pentru celelalte, avertisment cu justificarea lipsei
  consemnată (obligatorie la închidere).
- **C. Constructorul implicit**: propus din proiect (ultimul raport; firma, la primul), **confirmat la creare**, editabil, păstrat în raport.
- **D. Diferența de greutate**: doar în aplicație; PDF-ul păstrează rubricile beneficiarului; fără prag.
