# Redări — ecranul de import al utilizatorilor / arendașilor (PR4b)

Unde: **Redări → 📥 Import TGZ**, cardul „Import utilizatori / arendași”, sub importul listei beneficiarului.
Cine: același drept ca importul listei — nivel `admin` sau `editor` pe modulul Redări (owner = admin). Un `viewer` poate citi previzualizarea, nu poate scrie. **Anularea pe lot**: doar owner (în ecran).
Sursa: fișierul primit de la beneficiar cu datele de contact ale utilizatorilor (Excel), foaia 1, antet pe 3 rânduri, coloanele 24–26 (nume, adresă, telefon).

## Pașii operatorului

1. **Deschide importul utilizatorilor** și alege fișierul `.xlsx`.
2. **Citește și previzualizează.** Se citesc fișierul și parcelele / deținătorii activi ai proiectului. **Nu se scrie nimic.**
   Erorile apar în chenar roșu: fișier care nu e `.xlsx`, fișier fără rânduri în formatul așteptat, foaie lipsă, „două parcele active cu aceeași cheie” (în acest caz nu se importă nimic până nu se lămurește dubla în proiect).
3. **Verifică previzualizarea:** totalurile, tabelul pe UAT și listele pe categorii. Pe ecran se văd **cel mult 100 de rânduri pe categorie**: verificarea completă se face din raportul CSV (pasul 4).
4. **Descarcă raportul previzualizării** (CSV, UTF-8 cu BOM, separator `;`, ca celelalte exporturi Redări). Conține TOATE rândurile cu utilizator, cu categoria și motivul fiecăruia, și numele utilizatorilor (fără adrese / telefoane).
5. **Potrivirile după poziția HG** (marcaj galben „poziție HG”) sunt o deducție, nu o dovadă: cheia exactă din fișier diferă de cea a parcelei. Ele se importă **doar** cu bifa separată „Includ și cele N potrivite după poziția HG (le-am verificat în raport)”, **nebifată** implicit. Nebifat: rândurile rămân în raport ca „neimportate: potrivire după poziția HG, neconfirmată” și se pot importa ulterior, cu un al doilea import (aceeași listă, cu bifa).
6. **Versiunea listei** — obligatorie, fără valoare implicită. Formatul celorlalte loturi: „TGZ ZZ.LL.AAAA”, aici urmat de „utilizatori”. Se scrie pe fiecare utilizator importat și pe lot.
7. **Importă N utilizatori pe M parcele** (activ doar după previzualizare, cu versiunea completată; N numără potrivirile HG doar cu bifa) → confirmarea, cu cifrele (inclusiv câte potriviri HG intră sau nu).
   Dacă în proiect există **alt import în curs** sau unul pornit în **ultimele 15 minute** (orice import: listă, Anexa 7, utilizatori), ecranul îl arată și cere **o a doua confirmare, explicită**. Dacă verificarea nu se poate face (eroare de citire), importul nu pornește.
   Din momentul apăsării butonului, **fișierul, versiunea și bifa HG sunt blocate** (butonul arată „Verific alte importuri…”). Dacă fișierul sau proiectul se schimbă totuși înaintea confirmării finale, importul **nu pornește** („Fișierul s-a schimbat înainte de confirmare”) și se reface previzualizarea. Același flux îl folosește „Reia doar completarea contactelor”.
8. **Rezultatul** e citit din bază după scriere (vezi „Stările după scriere”). Rândurile a căror parcelă s-a schimbat în timpul importului apar în lista roșie **„De verificat”** (cu parcela și numele). Se poate descărca „Raportul după scriere” (aceleași rânduri + starea din bază + ID-ul deținătorului + dacă are contact). Lotul apare în „Loturile de import ale utilizatorilor”.

## Ce înseamnă fiecare categorie (previzualizare)

| Categorie | Ce înseamnă | Se importă? |
|---|---|---|
| Nou | Persoana nu e deținător pe parcelă; parcela există după cheia exactă | da, calitate „utilizator” + contactul (adresa; telefonul doar cu cel puțin 9 cifre) |
| Nou — „poziție HG” | Cheia exactă (UAT, HG, cadastru, tarla) diferă, dar poziția HG e unică în UAT | doar cu bifa separată, după verificare |
| Deja deținător | Același nume normalizat e deja activ pe parcelă (proprietar sau utilizator dintr-un import anterior) | nu (se completează doar contactul lipsă al unui utilizator scris de un import anterior întrerupt) |
| Parcelă negăsită | Nici cheie, nici poziție HG unică | nu (importul nu creează parcele) |
| Coliziune / Exclus | Același om pe aceeași parcelă din mai multe rânduri; cu adrese diferite, persoana NU se importă | nu, de verificat |
| Dublură în fișier | Rând identic cu unul anterior | numărat o dată |
| Fără cheie | Fără poziție HG și fără nr. cadastral | nu |
| În afara proiectului | UAT care nu e al proiectului (fișierul acoperă toată conducta) | nu, doar numărat |

Rândurile fără utilizator (proprietarul folosește terenul) nu apar în raport; ele intră doar în „Rânduri în fișier”.

## Stările după scriere (din bază)

Starea fiecărui rând se stabilește din **parcela confirmată** a rândului, **calitatea** citită acum și **contactul**, plus marcajul lotului (fiecare utilizator scris are la finalul „sursei” textul `; lot <id-ul lotului>`). Motivul consemnat de import în lot („țintă schimbată”) are prioritate.

| Stare | Ce înseamnă |
|---|---|
| scris de această operație | persoana e pe parcela confirmată, cu marcajul acestui lot și cu contact |
| scris de această operație — contact lipsă | ca mai sus, dar fără contact (reluați „completarea contactelor”) |
| de verificat: ținta s-a schimbat în timpul importului | scris, dar verificarea de după scriere a găsit parcela schimbată (ștearsă, altă cheie / HG, cheie / HG nu mai e unic) sau calitatea schimbată |
| există deja ca utilizator | pe parcelă e un utilizator cu același nume, dar scris de altă operație — nescris acum |
| există deja cu altă calitate | pe parcelă e aceeași persoană ca proprietar / coproprietar etc. — nescris |
| nescris: țintă schimbată | parcela s-a schimbat între plan și scriere; importul a refuzat rândul |
| nescris: importul s-a oprit înainte | eroare înainte de acest rând; refaceți previzualizarea și reluați |
| neimportat: potrivire după poziția HG, neconfirmată | bifa HG nu a fost pusă |
| contact completat de această operație | „deja deținător” (inclusiv un utilizator dintr-un lot anterior) al cărui contact lipsă a fost completat acum, cu răspuns reușit al bazei |
| contact de completat, necompletat de această operație | era în lista contactelor de completat, dar nu s-a scris (import oprit / refuzat); dacă între timp contactul a apărut din altă parte, se spune |
| necunoscut — de verificat | baza nu a putut fi recitită, spune altceva decât lotul, sau **contactul există acum, dar răspunsul la completare s-a pierdut** (poate fi scris de această operație sau de altcineva); nu se declară nimic scris fără dovadă și nimic „neschimbat” fără dovadă |

**Rezultat nesigur.** Dacă răspunsul bazei se pierde în timpul scrierii (rețea, timp expirat), ecranul nu spune „eșuat”, ci **„Rezultat nesigur: nu știm sigur ce s-a scris — iată ce am găsit în bază”** și arată ce a găsit după marcajul lotului și după lista contactelor de completat; restul modulului este **reîncărcat oricum**. Contactele cu rezultat necunoscut au un rând roșu separat și apar în raportul de după scriere ca „necunoscut — de verificat”: se verifică în Fișa parcelei înainte de orice convocare. Un refuz clar al bazei (drept, regulă) apare ca „Import eșuat”.

**Lista contactelor de completat** (inclusiv pentru utilizatorii loturilor anterioare, la „Reia doar completarea contactelor”) se scrie pe lot **înaintea** primului contact trimis. După orice eroare, contactele din listă se recitesc din bază: cele confirmate de un răspuns sunt „completate”, cele lipsă sunt „necompletate”, iar cele existente care nu pot fi atribuite exact sunt „necunoscute”. Pe calea de eroare lotul primește **aceleași** rezultate ale verificării de după scriere ca la finalizarea normală (inclusiv „de verificat: ținta s-a schimbat”), deci avertismentul rămâne în istoric și dacă pagina se închide.

## Ce NU face importul

- nu creează parcele și nu schimbă parcelele;
- nu schimbă proprietarii și nu schimbă calitatea deținătorilor existenți;
- nu trimite nimic (fără mail, SMS, poștă) și nu generează convocatoare;
- nu aprobă convocarea utilizatorilor: până când owner-ul o aprobă în **Setări proiect** (poarta PR3a), rezervarea, regenerarea și expedierea convocatorului unui utilizator sunt refuzate (în BD și în ecran).

## Efecte în aval (pe scurt)

- **Fișa parcelei:** utilizatorii apar în grupul „Utilizatori / arendași”, separat de proprietari.
- **Registru, Notificări, Export:** filtrul de rol „Utilizatori / arendași”; exportul are calitatea „utilizator”.
- **Starea parcelei / centralizatorul:** utilizatorul are rândul lui în `red_v_stare_parcela`; la nivel de parcelă contează starea cea mai puțin avansată (dacă nu e acoperită prin PV A). Un utilizator neconvocat poate ține parcela în „de convocat” cât timp poarta e închisă.
- **Convocatoare în masă:** cu poarta închisă, utilizatorii apar la „excluși” cu motivul „utilizator - convocare neaprobata”.
- **PV-uri și exporturi:** poarta e doar pentru convocare; utilizatorul poate apărea în PV A / PV B și în exporturi.
- **Plic:** se grupează pe persoană + adresă + UAT. Un proprietar care e și utilizator pe altă parcelă din același UAT primește un plic cu două convocatoare doar dacă adresa e aceeași în ambele surse; altfel, două plicuri.

## Regula de operare pentru importul real și riscul rămas

**Regula — fereastră exclusivă, la import ȘI la anulare:** operația o face **un singur operator**, într-o fereastră în care, pe proiect, **nimeni nu face**:
- alte importuri (listă, Anexa 7, utilizatori);
- corecturi de parcele (ștergeri, schimbări de cheie / HG / UAT) sau de **deținători și contacte** (nume, calitate, adresă, telefon);
- operații în aval: convocări, PV-uri, plicuire, mesaje (e-mail / SMS), exporturi trimise mai departe.

Poarta convocării utilizatorilor rămâne închisă (OFF) în toată fereastra. Ecranul avertizează dacă vede alt import în curs sau pornit recent, dar **nu vede** corecturile manuale și operațiile în aval: regula se respectă prin organizare (operatorii anunțați dinainte), nu prin aplicație.

**Ce face importul ca să nu pună un utilizator pe parcela greșită:** înaintea **fiecărei bucăți** scrise recitește parcelele și verifică din nou că ținta e activă, are aceeași identitate și că cheia / poziția HG e încă unică; după scriere verifică încă o dată fiecare rând scris.

**Riscul rămas, în cuvinte simple:** între ultima verificare și momentul scrierii unei bucăți rămâne un interval (citirea deținătorilor și cererea de scriere, eventual mai multe cereri), a cărui durată **nu e garantată**. Dacă exact atunci alt operator schimbă parcela (de exemplu adaugă o a doua parcelă cu aceeași poziție HG), utilizatorul poate ajunge totuși pe parcela veche. Asta **nu e prevenit**, ci **detectat** după scriere: rândul apare „de verificat: ținta s-a schimbat în timpul importului”, în ecran, în raport și în lot (și pe calea de eroare), și se corectează din Fișa parcelei sau prin „Anulează importul”. Detecția nu prinde o schimbare făcută după ultima recitire, o schimbare revenită la starea inițială sau o recitire eșuată (aceasta apare „necunoscut”). Cu fereastra exclusivă de mai sus riscul practic e foarte mic, dar tehnic nu e zero: verificarea și scrierea **nu sunt atomice**.

## Varianta de server care ar închide riscul (NEIMPLEMENTATĂ — decizia proprietarului)

Ar fi o felie separată, cu migrare, revenire și teste pe bază (apply → rollback → re-apply, două sesiuni concurente):
- **Funcție nouă** `fn_red_import_utilizatori_scrie(p_proiect, p_lot, p_versiune, p_randuri jsonb)`, `SECURITY DEFINER`, identitate din `auth.uid()` și nivel `admin|editor` verificat în funcție; primește rândurile confirmate (parcela aleasă + cum a fost potrivită) și face **verificarea țintei și scrierea în aceeași tranzacție**: deținători + contacte + lot, totul sau nimic. Rezultatul pe fiecare rând (scris / sărit / țintă schimbată) se întoarce și se scrie în lot. Reluarea cu același lot nu dublează nimic (cheia intenției = id-ul lotului).
- **Ordinea lock-urilor:** întâi un lock consultativ pe proiect (`red_import_parcele:<proiect>`), apoi rândurile. Ca să aibă efect, **același lock** trebuie luat de toate căile care schimbă mulțimea / identitatea parcelelor: un trigger `BEFORE INSERT OR UPDATE OF cheie_sursa, poz_hg, uat_id, sters_la` pe `red_parcele` (acoperă importul listei, Anexa 7 și corecturile din Fișa parcelei). Atinge: `red_parcele` (trigger nou), `red_detinatori` (opțional o coloană `import_lot_id` cu cheie străină, în locul marcajului din text), `red_detinatori_contact`, `red_import_loturi`.
- **Anularea pe server:** `fn_red_import_utilizatori_anuleaza(p_lot, p_motiv)`, doar owner (`profiles.is_owner` din `auth.uid()`), care sub același lock + lock-ul convocării pe deținător verifică urmele și șterge logic în aceeași tranzacție (azi verificarea și ștergerea sunt pași separați, vezi mai jos).

## Evidența lotului (`red_import_loturi.diferente`)

Câmpul existent `diferente` (jsonb) păstrează, fără nume și fără contacte (lotul e vizibil și pentru viewer):
- `scrise` — ID-urile deținătorilor creați de lot (+ parcela, rândul Excel, momentul creării / al contactului), refăcute din bază după marcaj și după o eroare;
- `contacte_intentie` — lista contactelor de completat (ID deținător + rândul Excel), scrisă **înaintea** primului contact trimis, inclusiv pentru utilizatorii loturilor anterioare;
- `contacte_scrise` (+ `contacte_la`) — deținătorii cărora lotul le-a scris contactul, confirmat de răspunsul bazei;
- `contacte_nesigure` (bucățile cu răspuns pierdut) și `contacte_necunoscute` (dintre ele, cele care au contact acum: atribuire nedovedită);
- `de_verificat_dupa_scriere` + `verificare_dupa_scriere` (aceleași la finalizare și la eroare), `schimbate_la_scriere`, `hg_neconfirmate`, `deja_detinatori`, `parcela_negasita`, `coliziuni`;
- `anulari` — fiecare anulare: când, cine (din ecran), motivul, ce s-a anulat, ce a rămas și de ce.

Raportul descărcabil de după scriere are aceleași ID-uri, cu numele.

## Anularea unui import greșit (owner)

Fără schemă nouă: se folosește **ștergerea logică existentă** a unui deținător (aceeași ca „Șterge” din Fișa parcelei: `sters_la`, `sters_de`, `sters_motiv`; nu se șterge nimic fizic), aplicată **exact** pe deținătorii cu marcajul lotului.

1. „Loturile de import ale utilizatorilor” → **Arată loturile** → pe lot, **Anulează importul** (doar owner).
2. **Previzualizarea anulării** (nimic scris): câți se pot anula și câți **rămân**, cu motivul fiecăruia: are convocare (inclusiv anulată sau în plic), răspuns, PV A, PV B pe parcelă generat după import, e-mail legat; a fost modificat de un om după import (nume, calitate, contact). Lista se poate descărca (CSV).
3. **Motivul** (obligatoriu, minim 5 caractere) → **Anulează N utilizatori** → confirmare.
4. Rezultat: anulați, rămași, „necunoscut” (răspuns pierdut — se reia), „de verificat” (o urmă sau o schimbare de contact apărută chiar în timpul anulării). **Pe ecran** se vede tabelul motivelor (rezultat, motiv, câte rânduri), de exemplu „rămâne — neanulat: contact modificat după import — 1”; lista nominală e în raportul anulării (CSV). Anularea se consemnează în lot. Motivul fiecărui rând anulat începe cu `Anulare import utilizatori (lot <id>):`.
5. **Reluabil:** „Verifică din nou / reia” arată ce a rămas; rândurile deja anulate nu se mai ating, iar un al doilea click nu dublează nimic.

**Procedura anulării (fereastră exclusivă):** un singur operator (owner); cât rulează anularea, pe proiect **nu se fac corecturi de deținători sau contacte**, nici convocări, PV-uri, plicuire, mesaje sau alte importuri. Poarta convocării utilizatorilor rămâne închisă.

Ce trebuie știut: înainte de anulare previzualizarea se reface și se anulează doar ce era anulabil și atunci, și acum, cu aceeași dată de modificare a deținătorului **și a contactului** (altfel rândul rămâne). Pentru **fiecare** rând, contactul se recitește **chiar înaintea** ștergerii lui: dacă s-a schimbat față de momentul reținut pe lot la import, rândul **nu** se anulează („neanulat: contact modificat după import”). După anulare se verifică din nou urmele **și** contactele rândurilor anulate: o schimbare apărută între timp e listată „de verificat”. **Garanția nu e atomică:** verificarea și ștergerea sunt cereri separate, deci o convocare / un răspuns / un PV / o corectură de contact făcută exact între ele nu e oprită, ci doar raportată după (cu poarta convocării utilizatorilor închisă, baza refuză oricum convocarea lor); o schimbare făcută după verificarea finală nu mai e văzută. De aceea fereastra exclusivă e obligatorie. „Doar owner” e o regulă a ecranului: în bază, orice admin / editor poate șterge logic un deținător (ca din Fișa parcelei); autorul real al fiecărei schimbări rămâne în jurnalul Redări. Dacă baza refuză citirea unei tabele de verificat (de exemplu una din e-mail), anularea **nu pornește**; dacă recitirea contactului unui rând eșuează, acel rând nu se anulează.

După anulare rămân fizic deținătorul, contactul, tokenul, jurnalul și lotul; tokenul vechi devine inutilizabil (rândul e șters logic), iar un import ulterior creează un deținător nou, cu ID și token noi.

## Raportul CSV

Rapoartele (previzualizare, după scriere, anulare) conțin **numele** persoanelor, ca operatorul să poată verifica potrivirile. Se păstrează local: **nu se urcă în repository, nu se atașează la PR-uri** și nu se trimit mai departe.

## Proba pe proiectul de test al modulului (după publicare)

Doar pe **proiectul de test** al modulului, cu un **fișier sintetic** (nume fictive, UAT-urile proiectului de test), cu **conturi reale** de owner, editor și viewer (accesul real prin aplicație, nu simulat). Testele automate din repository folosesc un client simulat: nu dovedesc drepturile, constrângerile sau concurența reală a bazei — de aceea proba de mai jos e obligatorie. Pentru fiecare pas se notează rezultatul așteptat și cel obținut, iar ID-urile deținătorilor / contactelor se compară local cu lotul și cu raportul CSV.

1. **Roluri reale:** viewer — vede previzualizarea, nu are butonul de import și nici bifa HG; editor — importă, nu vede „Anulează importul”; owner — importă și anulează.
2. **Import fără / cu HG și repetare:** previzualizare → raport CSV → import **fără** bifa HG (rândurile HG „neimportate … neconfirmate”) → al doilea import **cu** bifa HG (intră doar rândurile HG) → al treilea import: 0 noi, toți „deja deținători”, fără dubluri în Fișa parcelei.
3. **Răspuns pierdut după scriere, la deținători:** se întrerupe rețeaua (de exemplu modul „offline” din browser) imediat după pornirea scrierii → „Rezultat nesigur” cu ce s-a găsit în bază; lotul „eșuat” cu evidența din bază; celelalte ecrane ale modulului reîncărcate; reluarea (previzualizare nouă) nu dublează nimic.
4. **Răspuns pierdut la contacte, inclusiv completarea contactelor unui lot anterior:** pe un lot vechi cu utilizatori fără contact, „Reia doar completarea contactelor” cu rețeaua întreruptă la trimiterea contactelor → „Rezultat nesigur”, contactele „necunoscut — de verificat” (nu „neschimbat”), modulul reîncărcat; în lot: `contacte_intentie`, `contacte_necunoscute`; verificare în Fișa parcelei.
5. **Țintă HG schimbată + eroare la contacte:** în timpul importului unui rând potrivit după HG se adaugă (din alt cont) o a doua parcelă cu aceeași poziție HG, iar contactul e refuzat → lotul „eșuat” păstrează „de verificat: ținta s-a schimbat” (se verifică în istoricul loturilor, după reîncărcarea paginii).
6. **Anulare, repetare, reimport și tokenul vechi:** lot de probă cu un utilizator cu convocare de probă (poarta ON doar pe proiectul de test) și unul fără → 1 anulabil / 1 rămas → anulare cu motiv → Fișa parcelei îl arată „șters” cu motivul → „Verifică din nou”: „deja anulat”, nimic nou de anulat → linkul de răspuns cu **tokenul vechi** nu mai funcționează → reimportul creează un deținător nou (ID și token noi), fără să reactiveze rândul anulat.
7. **Intervenții concurente (cu barieră între verificare și scriere):** dintr-un al doilea cont, între previzualizarea anulării și execuție (și, unde se poate, chiar în timpul execuției): se modifică un deținător, i se corectează **contactul**, i se adaugă un document (convocare / PV de probă) → rândul respectiv rămâne neanulat sau apare „de verificat”, cu motivul vizibil pe ecran.
8. **Schimbare de fișier / proiect:** se schimbă fișierul în timpul verificării altor importuri (selectorul e blocat; dacă totuși se schimbă, importul nu pornește), se schimbă proiectul în timpul citirii și al scrierii (rezultatul nu apare pe celălalt proiect) și se verifică reîncărcarea efectivă a celorlalte ecrane (Registru, Fișa parcelei, Notificări).
9. **Avertismentul altor importuri:** un import al listei pe proiectul de test și, în aceeași fereastră de 15 minute, importul utilizatorilor → a doua confirmare apare.
10. **Poarta convocării OFF / ON și efectele în aval:** cu poarta OFF utilizatorul nu primește convocator (exclus cu motiv la generarea în masă); cu poarta ON (doar pe proiectul de test) — convocatorul utilizatorului, apariția în **PV A / PV B**, în **export** (calitatea „utilizator”) și la **plicuire** (gruparea pe persoană + adresă + UAT); apoi poarta din nou OFF.
11. „Reia doar completarea contactelor” când nu e nimic de completat → „Nimic de completat”, niciun lot nou.

## Ordinea în producție

1. Publicarea (merge + deploy) de către sesiunea de coordonare, după review favorabil pe SHA-ul final.
2. Proba de mai sus pe proiectul de test al modulului, cu demonstrarea recuperării complete (stările „necunoscut” / „de verificat” lămurite) și compararea ID-urilor cu lotul și cu raportul CSV.
3. Verificarea tuturor potrivirilor HG din raportul complet și **acordul proprietarului pe previzualizarea finală** (raportul CSV arătat local).
4. **Importul real** în **fereastra exclusivă** de mai sus (un operator, fără alte importuri, corecturi de parcele / deținători / contacte sau operații în aval); aceeași regulă la o eventuală anulare. Poarta convocării utilizatorilor rămâne închisă până la decizia separată a owner-ului.
5. Reconcilierea completă după import și rezolvarea tuturor stărilor „necunoscut” / „de verificat” **înaintea** folosirii utilizatorilor în documente sau comunicări.
