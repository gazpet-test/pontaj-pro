# Redări — ghidul notificărilor (ce trimitem, cui, pe ce canal, cum vedem ce lipsește)

Stare: 04.11.2026. Același conținut îl arată tabul **🌾 Redări teren → 📬 Notificări**, cu verificarea făcută pe proiectul ales.
Tabul doar citește: nu generează, nu trimite și nu scrie nimic. Logica e în `src/redari/notificari.js`, ecranul în
`src/redari/ui/NotificariEcran.jsx`.

Tabul are trei părți:
1. **📚 Ghidul modelelor**: fiecare model, cu starea lui pe proiect (gata / parțial / blocat + motivul / nelivrat încă).
2. **↩ Canalele de răspuns**: unde intră răspunsul în ERP și cum se înregistrează.
3. **📊 Centralizator**: pe deținător și pe UAT, ce s-a trimis, ce s-a confirmat, ce mai e de trimis și ce lipsește. Are filtre și export.

Lipsurile din ghid vin din **aceleași verificări** pe care le fac butoanele care generează documentele. Dacă ghidul spune „gata”, nici butonul
nu se mai oprește pe datele proiectului sau ale UAT-ului. Datele fiecărui document le completezi tot acolo (data PV, locul, adresa
deținătorului).

---

## 1. Modelele

| Model | Ce e | Cui | Canal | De unde (tab → buton) | Cine |
|---|---|---|---|---|---|
| **Convocator** (Model 1) | Convocarea la constatare: zilele sesiunii, codul QR personal, informarea GDPR pe verso | Deținătorii identificați, cu adresă cunoscută | Poștă recomandată cu AR, în plicul comun | 📋 Registru → 📄 Convocator, pe rând. Din 📄 Fișa parcelei → ↻ Reîncarcă | admin / editor |
| **Plic comun + opis + PV de plicuire + etichete** | Toate convocările unei persoane din UAT într-un plic, cu opisul și PV-ul semnat de doi colegi | Deținătorul | Poștă | ✉️ Poștă → Plicuri de făcut | admin / editor |
| **AR** (confirmarea de primire) | Textul de pe AR: câte convocări, pentru ce lucrare | Se întoarce de la Poștă | Poștă | ✉️ Poștă → plicul → AR primit / Retur. Sau importul CSV poștal | admin / editor |
| **Borderou Poștă** (CSV) | Convocările poștale neexpediate, cu fișier și adresă | Ghișeul poștal | Poștă | 📋 Registru → 📮 Borderou CSV | admin / editor |
| **Formularul public de răspuns** | Patru opțiuni: particip (cu ziua), nu particip fără obiecții (cu declarația), nu particip cu obiecții, constatare pe teren | Deținătorul convocat | Online (QR sau link) | Se creează odată cu convocatorul; răspunsul intră singur în Registru | — |
| **Informarea GDPR** | Informarea despre datele personale | Deținătorii | Verso-ul convocatorului; pagina web e planificată | ⚙️ Setări proiect → Text GDPR / Link informare | admin |
| **PV A** (Model 2) | Constatarea per deținător, cu propunerea din deviz | Deținătorul semnează | La sesiune, sau trimis spre semnare prin poștă | 📄 Fișa parcelei → PV A. 🗓️ Sesiune → PV A | admin / editor |
| **PV B** (Model 3) | Constatarea per parcelă: deținătorul lipsește, refuză sau cere constatare pe teren | Comisia: Gazpet, TGZ, UAT | Pe teren sau la sesiune | 📄 Fișa parcelei → PV B (parcela) | admin / editor |
| **PV C** (Model 5) | PV-ul pe tronson, după ce toate parcelele au PV A semnat sau PV B | Transgaz | Predare la Beneficiar | 🛤️ Tronsoane / PV C | admin / editor |
| **Adresa către Primărie** (Model 4, AU-nnnn) | Înștiințarea Primăriei: afișarea, zilele și sala sesiunii, reprezentantul UAT, anexele | Primăria fiecărui UAT | Registratură, poștă sau e-mail (rândul C1 din Corespondență) | 🏛️ UAT-uri → editare UAT → Generează adresa | admin |
| **Afișarea la Primărie** | Convocarea neidentificaților și a celor fără adresă | Neidentificați / fără adresă | Afișare; PV-ul de afișare îl dă Primăria | 🏛️ UAT-uri → perioada afișării și nr. PV de afișare | admin |
| **Cererea de împuternicire** | Cererea către Transgaz (anexă la A1 / A2), DRAFT Juridic | Transgaz | Corespondență (A2) | ⚙️ Setări proiect → Generează cererea (DOCX) | admin |
| **Corespondența** (planul, scrisorile, înștiințările A1–C2) | Planul de verificare, scrisorile către Transgaz, ISC, DAJ, Primării; evidența trimiterii | Instituții | E-mail, registratură, poștă | 📨 Corespondență. Aprobarea o dă owner-ul; „📧 Pregătește mailul” apare pe rândul aprobat | aprobă owner-ul; pregătesc admin / editor |
| **SMS Redări pe UAT** (șablon fix) | Reamintirea zilei și orei sesiunii, cu telefonul de contact; un SMS de persoană | Deținătorii convocați din UAT, fără răspuns și fără PV semnat | SMS | 📋 Registru → 📱 SMS proprietari (lot draft), apoi 📱 SMS → Istoric (aprobare, trimitere) | creează admin / editor cu nivel SMS; aprobă owner-ul |
| **E-mail către proprietari** (F2) | Trimiterea în loturi din redari@gazpet.ro | Deținătorii cu e-mail | E-mail | — | **neconstruit** |

Ce blochează azi (verificat în tab, 04.11.2026):
- **Împuternicirea Transgaz** (nr. + dată în ⚙️ Setări proiect) blochează convocatorul, plicul, AR-ul și adresa către Primărie.
- **Zilele de sesiune cu program** pe fiecare UAT (🏛️ UAT-uri) blochează convocatorul, adresa către Primărie, alegerea „particip” din
  formular și SMS-ul.
- **Afișarea**: perioada și nr. PV de afișare, pe fiecare UAT.
- **SMS**: așteaptă autorizarea scrisă a Transgaz și textul final aprobat de Juridic + Răzvan. Trimiterea e oprită din kill-switch.
- **Textul AR** e validat juridic doar pentru LOT1. Pe alt proiect nu se generează AR.
- **Pagina web GDPR**: PR #939 e draft și așteaptă aprobarea TGZ a textului. Verso-ul convocatorului are deja textul.

## 2. Canalele de răspuns — unde răspunde proprietarul și cum se înregistrează

Toate răspunsurile ajung în același tabel (`red_raspunsuri`). Registrul și Fișa parcelei arată **ultimul răspuns**: după dată, iar la
aceeași dată după ordinea înregistrării. Istoricul rămâne întreg, iar un răspuns nou nu-l șterge pe cel vechi.

| Canal | Unde intră | Cum se înregistrează | Activ? |
|---|---|---|---|
| **Formular online** (QR / link) | Singur, prin `fn_red_raspuns_public`, cu canalul „online” | Operatorul nu face nimic. Dacă proprietarul răspunde de două ori pe același cod, se păstrează ambele răspunsuri și contează ultimul | da |
| **Telefon** | Canalul „telefon”, plus o notă cu operatorul și sursa | 📋 Registru → 📞 Răspuns, canal „Telefon” (implicit): opțiunea, ziua (doar din zilele UAT-ului), obiecțiile, declarația confirmată verbal | da |
| **La sesiune** | Canalul „sesiune” („particip”) | 🗓️ Sesiune → Prezent; PV A / PV B din același ecran. Sau 📞 Răspuns, canal „La sesiune” | da |
| **Scris / poștă** (scrisoare de la proprietar) | Canalul „scris”, plus nota cu operatorul și nr. de înregistrare | 📋 Registru → 📞 Răspuns, canal „Scris / poștă”. **AR-ul și returul nu sunt răspunsuri**: se trec pe plic, în ✉️ Poștă | da (manual) |
| **SMS** | Canalul „sms”, înregistrat de operator. SMS-ul din ERP e doar de ieșire, nu se citesc SMS-urile primite | 📋 Registru → 📞 Răspuns, canal „SMS primit”; la sursă, numărul de pe care a venit | da (manual) |
| **E-mail redari@gazpet.ro** | Neactiv. Citirea căsuței e felia F1 (PR #987 draft, migrări neaplicate) | Până atunci: 📞 Răspuns, canal „Scris / poștă”, cu sursa „primit pe e-mail” | manual |

Modalul 📞 Răspuns are selectorul de canal: Telefon (implicit), Scris / poștă, SMS primit, La sesiune. „Online” îl scrie doar formularul
public. **„E-mail” nu apare intenționat.** După F1, planul (`PLAN_EMAIL_REDARI.md` §1.10) cere ca un răspuns pe canalul e-mail să aibă
sursa: mesajul din redari@ sau calea manuală verificată (`fn_red_mail_inregistreaza_raspuns_manual`, `tip_sursa = 'manual_verificat'`).
Un răspuns scris direct cu canalul e-mail ar ocoli această proveniență. Până la F1, un răspuns venit pe e-mail se trece „scris”, cu
sursa „primit pe e-mail”. Opțiunea e-mail se adaugă în modal odată cu F1, prin RPC-ul manual.

## 3. Centralizatorul — ce am trimis, ce mai avem de trimis, lipsurile

Un rând înseamnă o pereche parcelă × deținător, la fel ca în Registru. O persoană cu trei parcele apare de trei ori. Pe fiecare UAT și pe
total se numără:

- **Convocator generat / expediat / AR primit / retur**. Returul contează doar dacă nu a venit un AR după el (aceeași regulă ca starea din Registru).
- **SMS trimis / livrat / eșuat**, din `fn_red_sms_stare`.
- **Răspuns primit**: total și pe canalul ultimului răspuns.
- **PV A generat / semnat**, **PV B (parcelă) / semnat**.
- **Afișat la Primărie**: neidentificați sau fără adresă, într-un UAT cu perioada și nr. PV de afișare completate.
- **De trimis**: deținătorii fără **niciun canal reușit**. Canal reușit înseamnă AR primit, SMS livrat, un răspuns pe orice canal, PV semnat
  sau afișare (pentru neidentificați / fără adresă). Dintre ei, **plecat, neconfirmat** înseamnă convocare expediată fără AR și fără retur,
  sau SMS plecat fără confirmare. Restul n-au primit încă nimic.
- **Lipsuri**: fără adresă, neidentificat, fără telefon. Telefonul îl văd doar admin și editor; pentru viewer coloana arată „?”.

Filtrele: UAT, apoi „de trimis”, „netrimis deloc”, „plecat, fără confirmare”, „fără răspuns”, „cu retur”, „SMS eșuat”, „fără adresă”,
„neidentificat”, „fără telefon”. Exportul (xlsx cu foile Centralizator + Deținători, sau CSV) ține cont de filtrele alese și **nu conține
telefoane**.

Cifrele sunt corecte sau lipsesc, nu se ghicesc. Dacă o sursă nu se poate citi (SMS-ul, de exemplu), ecranul arată avertismentul, iar
coloana are „?”, nu 0. Dacă Registrul, convocările, răspunsurile sau PV-urile nu se pot citi, centralizatorul nu se afișează deloc.

## 4. Pașii, pe scurt (cine, din ce tab)

1. **Admin**: ⚙️ Setări proiect (contract, împuternicire, contact, texte) și 🏛️ UAT-uri (zile de sesiune cu program, reprezentant, afișare).
   📬 Notificări → Ghid trebuie să arate „gata” la convocator, plic și adresa UAT.
2. **Admin**: adresa către Primărie (🏛️ UAT-uri), apoi trimiterea ei prin 📨 Corespondență (rândul C1, cu aprobarea owner-ului).
3. **Admin / editor**: convocatoarele (📋 Registru), apoi plicurile și lotul de plicuire (✉️ Poștă), apoi expedierea.
4. **Admin / editor**: AR-urile și retururile, pe plic sau din importul CSV poștal (✉️ Poștă).
5. **Admin / editor**: răspunsurile primite la telefon, prin scrisoare, SMS sau e-mail se trec din 📋 Registru → 📞 Răspuns. Cele online
   intră singure.
6. **Owner**: SMS-ul de reamintire, după autorizarea Transgaz (📋 Registru → 📱 SMS proprietari; aprobarea din 📱 SMS → Istoric).
7. **Oricine are acces la modul**: 📬 Notificări → Centralizator → filtrul „de trimis”. Lista e baza pentru pasul următor: a doua
   convocare, afișarea sau telefonul.
8. **Admin / editor**: PV A / PV B la sesiune (🗓️ Sesiune, 📄 Fișa parcelei), apoi PV C pe tronson (🛤️ Tronsoane).
