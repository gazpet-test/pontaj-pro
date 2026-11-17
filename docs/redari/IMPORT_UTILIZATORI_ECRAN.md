# Redări — ecranul de import al utilizatorilor / arendașilor (PR4b)

Unde: **Redări → 📥 Import TGZ**, cardul „Import utilizatori / arendași”, sub importul listei beneficiarului.
Cine: același drept ca importul listei — nivel `admin` sau `editor` pe modulul Redări (owner = admin). Un `viewer` poate citi previzualizarea, nu poate scrie.
Sursa: fișierul beneficiarului „Despăgubiri LOT 1 – Date de contact utilizatori.xlsx”, foaia 1, antet pe 3 rânduri, coloanele 24–26 (nume, adresă, telefon).

## Pașii operatorului

1. **Deschide importul utilizatorilor** și alege fișierul `.xlsx`.
2. **Citește și previzualizează.** Se citesc fișierul și parcelele / deținătorii activi ai proiectului. **Nu se scrie nimic.**
   Erorile apar în chenar roșu: fișier care nu e `.xlsx`, fișier fără rânduri în formatul așteptat, foaie lipsă, „două parcele active cu aceeași cheie” (în acest caz nu se importă nimic până nu se lămurește dubla în proiect).
3. **Verifică previzualizarea:** totalurile, tabelul pe UAT și listele pe categorii. Rândurile potrivite după **poziția HG** au marcajul galben „poziție HG”: verifică-le înainte de import.
4. **Descarcă raportul previzualizării** (CSV, UTF-8 cu BOM, separator `;`, ca celelalte exporturi Redări). Raportul conține TOATE rândurile cu utilizator, cu categoria și motivul fiecăruia. Conține numele utilizatorilor (fără adrese / telefoane): nu se trimite mai departe.
5. **Versiunea listei** — obligatorie, fără valoare implicită. Formatul celorlalte loturi: „TGZ ZZ.LL.AAAA”, aici urmat de „utilizatori” (ex. „TGZ 13.07.2026 utilizatori”). Se scrie pe fiecare utilizator importat și pe lot.
6. **Importă N utilizatori pe M parcele** (butonul e activ doar după previzualizare, cu versiunea completată) → a doua confirmare, cu cifrele.
7. **Rezultatul:** lotul creat (stare din BD), utilizatori și contacte noi, câți au fost săriți și de ce. Starea după scriere se **recitește din BD**; se poate descărca „Raportul după scriere” (aceleași rânduri + coloana „După scriere (din BD)”). Lotul apare în „Loturile de import ale utilizatorilor” (toate stările) și, dacă e finalizat, în lista generală „Loturi importate anterior”.

## Ce înseamnă fiecare categorie

| Categorie | Ce înseamnă | Se importă? |
|---|---|---|
| Nou | Persoana nu e deținător pe parcelă; parcela există (după cheie sau după poziția HG unică în UAT) | da, calitate „utilizator” + contactul (adresa; telefonul doar cu cel puțin 9 cifre) |
| Nou — „poziție HG” | Cheia exactă (UAT, HG, cadastru, tarla) diferă, dar poziția HG e unică în UAT | da, după verificare |
| Deja deținător | Același nume normalizat e deja activ pe parcelă (proprietar sau utilizator dintr-un import anterior) | nu (se completează doar contactul lipsă al unui utilizator scris de un import anterior întrerupt) |
| Parcelă negăsită | Nici cheie, nici poziție HG unică | nu (importul nu creează parcele) |
| Coliziune / Exclus | Același om pe aceeași parcelă din mai multe rânduri; cu adrese diferite, persoana NU se importă | nu, de verificat |
| Dublură în fișier | Rând identic cu unul anterior | numărat o dată |
| Fără cheie | Fără poziție HG și fără nr. cadastral | nu |
| În afara proiectului | UAT care nu e al proiectului (fișierul acoperă toată conducta) | nu, doar numărat |

Rândurile fără utilizator (proprietarul folosește terenul) nu apar în raport; ele intră doar în „Rânduri în fișier”.

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
- **Plic:** se grupează pe persoană + adresă + UAT. Un proprietar care e și utilizator pe altă parcelă din același UAT primește un plic cu două convocatoare doar dacă adresa e aceeași în ambele surse; altfel, două plicuri.

## Cum se anulează un import greșit (azi)

Azi **nu există** o anulare pe lot. Singura cale e ștergerea logică, **câte unul**, din Fișa parcelei („Șterge” deținătorul, cu motiv obligatoriu: `sters_la`, `sters_de`, `sters_motiv`; reversibil doar de administrator în BD). Utilizatorii unui import se recunosc după `sursa_date` care începe cu `TGZ_UTILIZATORI:` și după `versiune_lista_tgz` (versiunea dată la import).

**Propunere (neimplementată, cere aprobarea proprietarului, migrare separată):**
- coloana `red_detinatori.import_lot_id` (FK spre `red_import_loturi`), setată de import;
- RPC `fn_red_import_utilizatori_anuleaza(p_lot_id, p_motiv)`, SECURITY DEFINER, doar owner (`auth.uid()` → `profiles.is_owner`), care sub lock pe proiect:
  refuză dacă vreun utilizator al lotului are convocare, răspuns sau PV; altfel marchează șterși logic (cu motiv) toți utilizatorii activi ai lotului și notează anularea în lot (`diferente.anulat_*`);
- revenire + test apply → rollback → re-apply, ca la celelalte migrări Redări.

## Ordinea în producție

1. Publicarea (merge + deploy) de către sesiunea de coordonare, după review.
2. **Proba pe proiectul de test al modulului** cu un **fișier sintetic** (nume fictive, UAT-urile proiectului de test): previzualizare → raport CSV → import → al doilea import al aceluiași fișier (trebuie să dea 0 noi, toți „deja deținători”) → verificarea în Fișa parcelei și în Registru (filtrul „Utilizatori / arendași”).
3. **Importul real** pe Lot 1 doar cu acordul proprietarului **pe cifrele din previzualizare** (raportul CSV atașat la cerere). Poarta convocării utilizatorilor rămâne închisă până la decizia separată a owner-ului.
