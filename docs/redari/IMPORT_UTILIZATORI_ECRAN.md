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
| contact completat de această operație | „deja deținător” al cărui contact lipsă a fost completat acum |
| necunoscut — de verificat | baza nu a putut fi recitită sau spune altceva decât lotul; nu se declară nimic scris fără dovadă |

**Rezultat nesigur.** Dacă răspunsul bazei se pierde în timpul scrierii (rețea, timp expirat), ecranul nu spune „eșuat”, ci **„Rezultat nesigur: nu știm sigur ce s-a scris — iată ce am găsit în bază”** și arată ce a găsit după marcajul lotului; restul modulului este anunțat să se reîncarce dacă s-a scris ceva. Un refuz clar al bazei (drept, regulă) apare ca „Import eșuat”.

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

**Regula:** importul real îl face **un singur operator**, într-o fereastră în care **nimeni nu face alte importuri și nici corecturi de parcele** pe proiect (ștergeri, schimbări de cheie / HG / UAT). Ecranul avertizează dacă vede alt import în curs sau pornit recent, dar nu vede corecturile manuale de parcele.

**Ce face importul ca să nu pună un utilizator pe parcela greșită:** înaintea **fiecărei bucăți** scrise recitește parcelele și verifică din nou că ținta e activă, are aceeași identitate și că cheia / poziția HG e încă unică; după scriere verifică încă o dată fiecare rând scris.

**Riscul rămas, în cuvinte simple:** între ultima verificare și momentul scrierii unei bucăți trec câteva fracțiuni de secundă. Dacă exact atunci alt operator schimbă parcela (de exemplu adaugă o a doua parcelă cu aceeași poziție HG), utilizatorul poate ajunge totuși pe parcela veche. Asta **nu e prevenit**, ci **detectat** după scriere: rândul apare „de verificat: ținta s-a schimbat în timpul importului”, în ecran, în raport și în lot, și se corectează din Fișa parcelei sau prin „Anulează importul”. Cu regula de operare de mai sus, riscul practic e foarte mic, dar tehnic nu e zero.

## Varianta de server care ar închide riscul (NEIMPLEMENTATĂ — decizia proprietarului)

Ar fi o felie separată, cu migrare, revenire și teste pe bază (apply → rollback → re-apply, două sesiuni concurente):
- **Funcție nouă** `fn_red_import_utilizatori_scrie(p_proiect, p_lot, p_versiune, p_randuri jsonb)`, `SECURITY DEFINER`, identitate din `auth.uid()` și nivel `admin|editor` verificat în funcție; primește rândurile confirmate (parcela aleasă + cum a fost potrivită) și face **verificarea țintei și scrierea în aceeași tranzacție**: deținători + contacte + lot, totul sau nimic. Rezultatul pe fiecare rând (scris / sărit / țintă schimbată) se întoarce și se scrie în lot. Reluarea cu același lot nu dublează nimic (cheia intenției = id-ul lotului).
- **Ordinea lock-urilor:** întâi un lock consultativ pe proiect (`red_import_parcele:<proiect>`), apoi rândurile. Ca să aibă efect, **același lock** trebuie luat de toate căile care schimbă mulțimea / identitatea parcelelor: un trigger `BEFORE INSERT OR UPDATE OF cheie_sursa, poz_hg, uat_id, sters_la` pe `red_parcele` (acoperă importul listei, Anexa 7 și corecturile din Fișa parcelei). Atinge: `red_parcele` (trigger nou), `red_detinatori` (opțional o coloană `import_lot_id` cu cheie străină, în locul marcajului din text), `red_detinatori_contact`, `red_import_loturi`.
- **Anularea pe server:** `fn_red_import_utilizatori_anuleaza(p_lot, p_motiv)`, doar owner (`profiles.is_owner` din `auth.uid()`), care sub același lock + lock-ul convocării pe deținător verifică urmele și șterge logic în aceeași tranzacție (azi verificarea și ștergerea sunt pași separați, vezi mai jos).

## Evidența lotului (`red_import_loturi.diferente`)

Câmpul existent `diferente` (jsonb) păstrează, fără nume și fără contacte (lotul e vizibil și pentru viewer):
- `scrise` — ID-urile deținătorilor creați de lot (+ parcela, rândul Excel, momentul creării / al contactului), refăcute din bază după marcaj și după o eroare;
- `contacte_scrise` (+ `contacte_la`) — deținătorii cărora lotul le-a scris contactul;
- `de_verificat_dupa_scriere`, `schimbate_la_scriere`, `hg_neconfirmate`, `deja_detinatori`, `parcela_negasita`, `coliziuni`;
- `anulari` — fiecare anulare: când, cine (din ecran), motivul, ce s-a anulat, ce a rămas și de ce.

Raportul descărcabil de după scriere are aceleași ID-uri, cu numele.

## Anularea unui import greșit (owner)

Fără schemă nouă: se folosește **ștergerea logică existentă** a unui deținător (aceeași ca „Șterge” din Fișa parcelei: `sters_la`, `sters_de`, `sters_motiv`; nu se șterge nimic fizic), aplicată **exact** pe deținătorii cu marcajul lotului.

1. „Loturile de import ale utilizatorilor” → **Arată loturile** → pe lot, **Anulează importul** (doar owner).
2. **Previzualizarea anulării** (nimic scris): câți se pot anula și câți **rămân**, cu motivul fiecăruia: are convocare (inclusiv anulată sau în plic), răspuns, PV A, PV B pe parcelă generat după import, e-mail legat; a fost modificat de un om după import (nume, calitate, contact). Lista se poate descărca (CSV).
3. **Motivul** (obligatoriu, minim 5 caractere) → **Anulează N utilizatori** → confirmare.
4. Rezultat: anulați, rămași, „necunoscut” (răspuns pierdut — se reia), „de verificat” (o urmă apărută chiar în timpul anulării); se descarcă raportul anulării; anularea se consemnează în lot. Motivul fiecărui rând anulat începe cu `Anulare import utilizatori (lot <id>):`.
5. **Reluabil:** „Verifică din nou / reia” arată ce a rămas; rândurile deja anulate nu se mai ating, iar un al doilea click nu dublează nimic.

Ce trebuie știut: înainte de anulare previzualizarea se reface și se anulează doar ce era anulabil și atunci, și acum, cu aceeași dată de modificare (altfel rândul rămâne). Verificarea urmelor și ștergerea sunt pași separați: o convocare / un răspuns / un PV apărut exact între ei nu e oprit, ci raportat „de verificat” (cu poarta convocării utilizatorilor închisă, baza refuză oricum convocarea lor). „Doar owner” e o regulă a ecranului: în bază, orice admin / editor poate șterge logic un deținător (ca din Fișa parcelei); autorul real al fiecărei schimbări rămâne în jurnalul Redări. Dacă baza refuză citirea unei tabele de verificat (de exemplu una din e-mail), anularea **nu pornește**.

## Raportul CSV

Rapoartele (previzualizare, după scriere, anulare) conțin **numele** persoanelor, ca operatorul să poată verifica potrivirile. Se păstrează local: **nu se urcă în repository, nu se atașează la PR-uri** și nu se trimit mai departe.

## Proba pe proiectul de test al modulului (după publicare)

Cu un **fișier sintetic** (nume fictive, UAT-urile proiectului de test):
1. Previzualizare → raport CSV → import **fără** bifa HG → rezultatul: rândurile HG „neimportate … neconfirmate”.
2. Al doilea import cu **bifa HG** → intră doar rândurile HG; al treilea import → 0 noi, toți „deja deținători”.
3. Avertismentul: pornește un import al listei pe proiectul de test și, în aceeași fereastră de 15 minute, importul utilizatorilor → a doua confirmare apare.
4. „Reia doar completarea contactelor” când nu e nimic de completat → mesaj „Nimic de completat”, niciun lot nou.
5. Verificare în Fișa parcelei și în Registru (filtrul „Utilizatori / arendași”); poarta OFF → utilizatorul nu primește convocator.
6. **Anularea:** pe un lot de probă, un utilizator cu o convocare de probă (poarta ON doar pe proiectul de test) și unul fără → previzualizarea arată 1 anulabil / 1 rămas → anulare cu motiv → Fișa parcelei îl arată „șters” cu motivul → „Verifică din nou” arată „deja anulat”, nimic nou de anulat.
7. Schimbarea proiectului în timpul unui import: rezultatul nu apare pe celălalt proiect.

## Ordinea în producție

1. Publicarea (merge + deploy) de către sesiunea de coordonare, după review.
2. Proba de mai sus pe proiectul de test al modulului.
3. **Importul real** doar cu acordul proprietarului **pe cifrele din previzualizare** (raportul CSV arătat local), după verificarea tuturor potrivirilor HG, în fereastra de lucru de mai sus (un singur operator). Poarta convocării utilizatorilor rămâne închisă până la decizia separată a owner-ului.
