# Redări Lot 1 — semnarea electronică de la distanță a PV-ului tip A + e-mailul către proprietari (SPECIFICAȚIE)

Stare: 17.11.2026, runda 5 (după re-review-ul rundei 4; deciziile proprietarului din 17.11.2026). **Doar document.** Nu există cod, migrare sau schimbare de
date în acest PR. Deciziile D1–D14 sunt **luate** (§1) și nu se mai redeschid aici; ce a rămas cu adevărat deschis e la §3.
Întrebările pentru avocat / Juridic sunt **informative** (§12.2): răspunsurile pot ajusta textele, nu schimbă varianta aleasă.
Documentul nu afirmă că vreo variantă e legală sau valabilă. Orice migrare, RPC sau modificare de drepturi propusă aici **necesită
acordul proprietarului** înainte de implementare și se livrează în felii separate, cu review propriu.

Cuprins: 0. De ce · 1. Deciziile proprietarului · 2. Ce putem dovedi · 3. Ce trebuie decis înainte de prima felie de cod ·
4. Starea de azi · 5. Variantele · 6. Riscuri asumate și modelul de amenințări · 7. Proiectarea · 8. E-mailul către proprietari ·
9. Fișa de securitate și GDPR · 10. Ce trebuie să spună documentele trimise beneficiarului · 11. Etapele de livrare ·
12. Propuneri implicite și întrebări pentru avocat · 13. Lecțiile L01–L25 · 14. Istoric.

Termeni folosiți: **Antreprenorul** = Gazpet; **beneficiarul** = Transgaz; **cerere** = cererea de semnare electronică a unui PV A;
**sesiune de acces** = cheia scurtă primită de deținător după ce introduce corect codul SMS (nu are legătură cu „sesiunea la
primărie”); **telefonul pentru cod** = numărul primit de la beneficiar, păstrat separat de contactul obișnuit (§7.4);
**nemodificabil prin aplicație** = nu poate fi schimbat de rolurile aplicației (anonim, utilizator autentificat, inclusiv admin /
editor Redări, și funcțiile edge ale aplicației) — **nu** și de administratorul bazei de date sau de o restaurare din copie (§7.18).

---

## 0. De ce

Planul procedurii de predare a terenurilor (rev. 1, trimis beneficiarului) spune la pct. 4.4 că deținătorul poate alege, în formularul
online, opțiunea:

> „Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.”

și continuă: Antreprenorul generează din registru PV-ul tip A completat și îl transmite proprietarului spre semnare, electronic.
„PV-ul semnat astfel are aceeași valoare ca unul semnat la sesiune. Declarația online singură e probă a lipsei obiecțiilor, nu ține
locul semnăturii.” Aceeași frază apare în modelul de convocator (rev. 1) și în modelul de e-mail către proprietari trimis
beneficiarului.

**În platformă nu există azi niciun flux de semnare electronică**, iar e-mailul către proprietari (felia F2) e construit doar parțial și
are transportul oprit. Specificația descrie ce trebuie construit, după deciziile proprietarului, în ce ordine, și ce putem dovedi.

---

## 1. Deciziile proprietarului (17.11.2026)

Date în chatul de coordonare, 17.11.2026. Sunt **decise**; secțiunile indicate le aplică.

| # | Decizia | Ce înseamnă în proiectare | Unde |
|---|---|---|---|
| D1 | **Varianta principală = semnătura electronică simplă în platformă:** link personal (QR), cod pe SMS, „Semnez” + nume tastat. Proprietarul a decis că semnătura simplă ajunge pentru fraza din plan „aceeași valoare ca unul semnat la sesiune”. | Nu mai e întrebare deschisă. Ce nu dovedește semnătura simplă rămâne scris ca **risc asumat** (§6.1). | §5, §7 |
| D2 | **Rezerva rămâne:** PV-ul tipărit, semnat de mână, fotografiat și încărcat **prin același link**. Dacă nici așa, sesiunea sau PV tip B. | Felie proprie (S5), aceeași fereastră de 7 zile, verificată de operator. **S5 e condiție a pilotului cu deținători** (pilotul nu începe fără ea, §11). | §7.13 |
| D3 | **Codul pleacă DOAR la telefoanele primite de la beneficiar.** | Telefonul pentru cod nu poate fi modificat de operator. Corecțiile vin doar printr-un fișier nou de la beneficiar sau cu aprobarea owner-ului, jurnalizat. | §7.4, §6.2 (T1) |
| D4 | **Același link personal** pentru răspuns și pentru semnare; **pe SMS doar codul.** | Niciun SMS nu poartă linkul. | §7.1, §7.11 |
| D5 | **Contrasemnarea:** semnătura Antreprenorului se **generează din ERP** (reprezentantul autentificat semnează din ecran, și în lot); reprezentantul beneficiarului semnează **la următoarea zi de sesiune de la primărie, în lot** (recomandare acceptată; se schimbă dacă beneficiarul cere altfel). | Stări noi ale cererii, lista pentru ziua de sesiune, încărcarea scanului. | §7.12 |
| D6 | **La început PDF-ul îl pregătește operatorul** (din DOCX); generarea directă a PDF-ului din platformă vine într-o felie ulterioară. | Hash calculat de server, legătura cu versiunea datelor din registru, riscul rămas până la generarea directă. | §7.5, S7 |
| D7 | **Fără semnătură desenată.** | Bifă + nume tastat. | §7.1 |
| D8 | **IP trunchiat** și doar tipul browserului. | IPv4 la /24, IPv6 la /48; familia browserului și a sistemului. | §9 |
| D9 | **Fără sigiliu calificat la pilot.** | Fără ancoră independentă; riscul rămâne scris (§6.1); marca temporală trece la „eventual, mai târziu”. | §7.18 |
| D10 | **Doi coproprietari cu același telefon → sesiune.** | Cererea se refuză la deschidere când același telefon e al altei persoane. | §7.4 |
| D11 | **Fereastra de semnare = 7 zile.** La expirare, parcela se finalizează prin PV tip B. | Termenul curge de la **punerea la dispoziție a PV-ului** (deschiderea cererii), ca în planul trimis beneficiarului; anunțul nu îl mută. Termenele dependente la §7.2. | §7.2 |
| D12 | **„Doar electronic”** (închisă mai devreme, tot 17.11): PV-ul nu se mai trimite spre semnare prin poștă; cine nu are e-mail / telefon cu internet rămâne la sesiune sau la PV B. Alinierea textului din formular și din convocatoare: PR #1117 (draft). | — | §0 |
| D13 | **Orarul codului (fostul O8, decis 17.11.2026):** codul de semnare se trimite **la orice oră**, când îl cere deținătorul; toate celelalte SMS-uri rămân în intervalul 08–20. | Excepție explicită **numai** pentru mesajul de cod cerut de deținător (categoria `redari_cod`), scrisă în **ambele** locuri: în rezervarea SQL și în verificarea dinaintea apelului către furnizor. Nu există o oră limită separată pentru ultimul cod: codul se poate cere cât cererea e în fereastră. | §7.2, §7.11 |
| D14 | **Lista persoanelor care semnează pentru Antreprenor o administrează owner-ul și managerul de proiect** (fostul punct de administrare din O1, decis 17.11.2026). | În listă scriu (adăugare / retragere) doar owner-ul și managerul de proiect al proiectului; fiecare schimbare se jurnalizează (cine, când, pe cine). Managerul de proiect poate fi el însuși persoană desemnată. Cum se identifică managerul de proiect în platformă (un câmp pe proiectul Redări sau managerul proiectului de Execuție legat) se stabilește în felia S3, cu acordul owner-ului pe schimbarea de schemă. Simplul nivel de admin Redări nu dă drept de scriere în listă. | §7.9, §7.12 |
| — | **Ecranul „Semnări la distanță”**, pe UAT și pe tronson, cu numărul de PV-uri în fiecare stare și lista pentru ziua de sesiune. | Felia de interfață (S4). | §7.16 |
| — | **Scopul dovezilor = „pot demonstra că am trimis”** (17.11, seara). Nu se verifică la furnizorul de SMS detectarea SIM-ului înlocuit și nici cât păstrează textele. | Secțiunea „Ce putem dovedi” (§2) și dosarul de dovezi; orice mecanism de identificare mai tare decât cele decise trece la „eventual, mai târziu” (§12.1). | §2 |

---

## 2. Ce putem dovedi

**Scopul** (decizia din 17.11, seara): să putem arăta beneficiarului (și, la nevoie, altcuiva) că **Antreprenorul a făcut
demersurile** — convocarea a plecat, codul a plecat, documentul a fost pus la dispoziție, cine a semnat ce și când. **Nu** urmărim să
dovedim cine a citit un mesaj sau cine a folosit efectiv linkul și codul (§6.1).

| Canal | Ce dovedim | Ce există azi în platformă | Unde se vede în ERP | Ce aduce / ce lipsește |
|---|---|---|---|---|
| **Scrisoarea recomandată (plicul)** | Plicul a plecat (nr. plic, AWB / nr. de urmărire, data expedierii, opisul de la dosar) și a ajuns (data AR, scanul AR, primit de destinatar sau de altă persoană, cu mențiune) **sau** s-a întors (motivul, data, scanul returului) | `red_plicuri` (`20261129i_redari_plicuri.sql:52-95`); propagat pe convocare: nr. C-nnnn, data expedierii, nr. de urmărire, confirmarea, returul, hash-ul conținutului, fișierul convocatorului (`red_convocari`, `20261126a_redari_teren.sql:191-206`) | Ecranul Plicuri, coloana „AWB / expediat” (`src/redari/ui/PlicuriEcran.jsx:124-126`); cronologia fișei parcelei (`src/redari/ui/FisaParcela.jsx:177-181`); exportul Model_6, coloanele P–T (`src/redari/exportXlsx.js:52-53`) | Complet pentru convocare. Pentru semnarea PV-ului scrisoarea nu se mai folosește (D12). |
| **Curierul** | AWB generat, ridicat de curier | `red_fan_awb` (`20261212a_redari_fan_awb.sql:22-57`) — migrare scrisă, **neaplicată** (`:2`) | — | Până la aplicare, AWB-ul curierului e cel trecut pe plic (rândul de sus). |
| **SMS** | Că mesajul a fost **acceptat de furnizorul SMS** și, dacă vine, raportul de livrare al operatorului telecom (livrat / eșuat), plus **textul exact** (comun pe lot, aprobat de proprietar cu nr. autorizării scrise a beneficiarului). Trei ore distincte, oricare poate lipsi: **ora înregistrării rezultatului acceptat** (`sms_mesaje.trimis_la`, `20261130a:362`), **ora aplicării raportului de livrare** în BD (`livrat_la`, `:367`) și **ora raportată de operatorul telecom** (`sms_dlr.raportat_la`, păstrată doar dacă e plauzibilă, `:810-812`). | `sms_mesaje` (`20261130a_sms_mvp.sql:112-134`), `sms_dlr` (`:147-157`), `sms_loturi` (`:81-110`) | Rândul „SMS” și cronologia din fișă (`FisaParcela.jsx:33-44`, `:193`); agregatele pe deținător (`20261130i_redari_sms_stare.sql:89-127`); lista SMS în CSV, fără telefon (`src/redari/smsStare.js:144-145`) | Fișa și CSV-ul de azi arată agregate, nu istoricul fiecărui mesaj. Lipsesc: numărul **mascat**, cele trei ore, separat, pe fiecare mesaj. Pentru cod: legătura mesaj ↔ cerere și evenimentele „cod acceptat de furnizor / livrare raportată” (§7.11). Rezultatul `necunoscut` (rezervat, fără răspuns) se arată ca „rezultat necunoscut”, nu ca trimis. Livrarea arată că mesajul a ajuns pe telefon, nu că a fost citit. |
| **E-mail** | Momentul în care serverul de e-mail a acceptat mesajul | `red_mail_mesaje.trimis_la` (`20261131a_redari_mail_f2_loturi.sql:160-186`) | — (transportul e oprit, `supabase/functions/_shared/redariMailF2.mjs:4`, `:85-86`) | Starea „trimis” din F2 = acceptat de serverul de e-mail, nu livrat / citit; în ecranul și dosarul semnării apare ca „anunț expediat” sau „anunț netrimis” (§7.16) (fără pixel de urmărire, intenționat, §8.3). Depinde de F2 (§8.2). |
| **Afișarea la primărie** | Nr. PV de afișare, perioada, ora, cine a afișat | `red_uat` (`20261126a:132`; `20261127a_redari_uat_setari.sql:53-54`); regula „afișare completă” (`src/redari/notificari.js:32-38`) | Setările UAT; exportul Model_6, coloana U (`exportXlsx.js:53`) | Numărul, perioada, ora și persoana există deja. Lipsește doar **scanul** PV-ului de afișare — propus în felia S4. |
| **Răspunsul online** | Data, opțiunea, declarația bifată, IP-ul și browserul | `red_raspunsuri` + `red_raspunsuri_meta` (`20261126a:208-225`) | Cronologia fișei; exportul Model_6, coloanele V–X (`exportXlsx.js:53-54`) | Complet. |
| **Deschiderea linkului, codul, documentul, semnarea** (nou) | Momentul fiecărui eveniment: PV pus la dispoziție (cererea deschisă), anunț expediat / netrimis, pagina deschisă, cod cerut / acceptat de furnizor / livrare raportată / verificat, document servit (cu SHA-256), semnat (nume tastat, versiunea textului de acord) | Nimic azi | Fișa parcelei; ecranul „Semnări la distanță” (§7.16) | Jurnalul de dovezi al cererii (§7.9). |
| **Semnătura Antreprenorului și contrasemnarea beneficiarului** (nou) | Cine a semnat din ERP pentru Antreprenor, când, pe ce document; data contrasemnării beneficiarului și scanul ei | Nimic azi | Idem | §7.12. |

**Dosarul de dovezi** (export nou, felia S4) = **rezumatul** pe deținător + **documentele suport** care îl însoțesc.

**Rezumatul** — pe deținător (pe parcelă: câte un rezumat pentru fiecare deținător), începe pe o pagină nouă și **continuă pe pagini
suplimentare** („pagina 2 din 3”) când istoricul nu încape; nu se taie niciodată (L12):
- identificarea: proiectul, UAT-ul, parcela, deținătorul, nr. PV-ului;
- cronologic, pe canale, din rândurile de mai sus: convocarea (nr. C-nnnn, nr. plicului, data expedierii, AWB / nr. de urmărire, AR sau
  retur), afișarea (nr. PV, perioada, ora, cine a afișat), SMS-urile (numărul mascat, de forma `07•• ••• •12`, șablonul / textul
  lotului cu versiunea, starea: acceptat de furnizor / livrare raportată / eșuat / **rezultat necunoscut**, cele trei ore separat, „—”
  unde lipsesc), e-mailurile (adresa mascată, acceptat de serverul de e-mail sau „netrimis”), răspunsul online (data, opțiunea),
  semnarea (PV pus la dispoziție, **anunț expediat / anunț netrimis**, linkul deschis, codurile cu starea lor, documentul servit cu
  SHA-256, semnat, Antreprenorul, beneficiarul);
- fiecare mesaj (SMS / e-mail) poartă id-ul lui din platformă și id-ul evenimentului din lanțul de dovezi cu care e legat;
- **opisul documentelor suport** (mai jos), fiecare cu SHA-256; un document care lipsește din platformă apare ca „lipsește din
  platformă”, nu dispare din listă;
- datele semnăturii Antreprenorului și ale anexei se iau din **conținutul canonic din BD** (§7.5), nu din textul PDF-ului anexei,
  care apare doar ca document suport;
- data extragerii. **Fără** token, telefon complet, IP, text de obiecții și **fără codul SMS**: pentru SMS-ul cu cod apare doar
  șablonul versionat (cu „[cod]” în locul cifrelor) și evenimentele; fără „generat automat” și fără nume de unelte; autorul e
  responsabilul de contract.

**Documentele suport** (octeții exacți din platformă, nu trimiteri „la dosar”): convocatorul exact trimis (fișierul convocării, cu
hash-ul lui), opisul plicului, scanul AR sau al returului, scanul PV-ului de afișare (după S4), PDF-ul supus semnării (b), anexa
oficială (c), scanul contrasemnat și manifestul de finalizare (§7.5). Se predau împreună cu rezumatul, într-o arhivă (ZIP) cu rezumatul
PDF la început; aceleași fișiere rămân în platformă, nemodificabile prin aplicație (§7.18), și se pot extrage din nou oricând, cu
aceleași hash-uri.

- Ieșiri: dosarul din fișa parcelei și, pentru un UAT / tronson, o arhivă cu dosarul fiecărui deținător; aceleași date ca rânduri noi
  în exportul Model_6 (numărul mascat, orele SMS-ului, starea semnării, starea anunțului). O singură funcție de citire pentru ecran și
  export (L19), cu paginare keyset (L23).

---

## 3. Ce trebuie decis înainte de prima felie de cod

După deciziile din §1 rămân deschise doar punctele de mai jos (fostul O8, orarul codului, e decis: D13). Când trebuie decise:
- **O1, O2, O3, O7, O9 — înainte de S3** (semnătura Antreprenorului, contrasemnarea, finalizarea, acoperirea și PV C); O7 e deci
  necesară înainte de S3, nu „până la pilot”;
- **O4, O5 — înainte de orice probă pe date reale** (O5 și înainte de S2);
- **O6 — înainte de S6** (reamintirea pe e-mail).

Prima felie (S1) poate începe după „da”-ul proprietarului pe specificație, pe transport inert.

| # | Ce e deschis | A | B | C | Recomandare |
|---|---|---|---|---|---|
| O1 | **Cine semnează pentru Antreprenor din ERP (D5)** — administrarea listei e decisă (D14: owner-ul și managerul de proiect) | Persoanele desemnate pe proiect (1–3, ex. responsabilul de contract, șeful de proiect), cu funcția lor | Orice utilizator cu nivel admin Redări pe proiect | — | **A.** Persoanele se numesc pe proiect, de către owner sau managerul de proiect (D14); fiecare trebuie să aibă și acces Redări (admin / editor); identitatea vine din autentificare, nu din ce scrie cineva în formular. Simplul nivel de admin Redări **nu** dă dreptul de a semna. Rămâne de numit persoanele, înainte de S3. |
| O2 | **Ce cere beneficiarul pentru semnătura reprezentantului său** | Semnătură de mână pe **anexa fiecărui PV**, la următoarea zi de sesiune, în lot | Un **borderou pe zi**, cu toate PV-urile, semnat o dată | Semnătura electronică proprie a beneficiarului | **A** (recomandarea acceptată în D5); se întreabă beneficiarul prin documentele de la §10. B dacă o cere reprezentantul; C nu se construiește fără cererea lui. |
| O3 | **Ziua de contrasemnare când UAT-ul nu mai are zile de sesiune** (un deținător poate semna după ultima zi de sesiune) | O **zi de contrasemnare** convenită cu reprezentantul beneficiarului, trecută în ERP pe UAT | Contrasemnarea la predarea PV C pe tronson | — | **A.** Fără zi programată, ecranul arată alerta „fără zi de contrasemnare” (§7.16). |
| O4 | **Conținutul informării pentru datele noi** | Completare la informarea existentă (aceeași pagină, versiune nouă) + un rezumat de 3 rânduri pe pagina de semnare | Informare separată pentru semnare | — | **A.** Textul îl dă Juridic; lista datelor e la §9 și §10. Fără informare publicată, fluxul nu pornește pe date reale. |
| O5 | **Autorizarea categoriei de SMS cu cod** | **Lot permanent pe proiect** (`redari_cod`), aprobat o dată de owner: șablon versionat, plafoane, dată de expirare; aceleași porți ca azi | Fiecare cod aprobat individual (inutilizabil pentru un cod valabil 10 minute) | — | **A**; autorizarea scrisă a beneficiarului pentru SMS să numească explicit și codurile de semnare (§10). |
| O6 | **Reamintirea** cu 2 zile înainte de expirarea ferestrei (§7.2). **Pe SMS pleacă doar codul (D4)**, deci reamintirea, dacă există, e doar pe e-mail. | E-mail (unde există adresă și F2 e activ) + lista „expiră în 2 zile” pentru operator, care poate suna | Doar lista pentru operator, fără niciun mesaj | — | **A.** |
| O7 | **Contestațiile și acoperirea parcelei** (fostele D16, D18) | Contestația e obiect separat; cât e deschisă, PV-ul nu mai acoperă parcela; utilizatorul / arendașul **nu** închide parcela cât un proprietar are obiecții sau contestație deschise; decide responsabilul de contract, cu confirmarea owner-ului | Contestația doar se consemnează; regulile de acoperire rămân ca azi | — | **A.** Atinge regula de acoperire (`20261130n_redari_pv_utilizatori.sql:198-214`, `src/redari/pv.js:229-235`): migrare proprie, cu paritate JS / SQL. **Necesară înainte de S3.** |
| O9 | **Parcelele mixte în PV C** (un deținător semnat la sesiune + altul semnat electronic) și coloana nouă | Regula de azi rămâne: parcela cu **cel puțin un** PV A semnat la sesiune intră la „PV A la sesiune”; parcela semnată **doar** de la distanță intră într-o coloană nouă „PV A semnat electronic”, niciodată la „corespondență” | Coloană separată „mixt” pentru parcelele cu ambele metode | — | **A** (schimbă cel mai puțin regula de azi, `pv.js:398-402`). Textul coloanelor îl dă Juridic. Necesară înainte de S3. |

Restul alegerilor tehnice (cifrele telefonului înainte de cod, linkul compromis, calea veche de semnare, fișierele în BD, limitele)
au o **propunere implicită** la §12.1, care se aplică dacă proprietarul nu spune altfel.

---

## 4. Starea de azi (cu fișier:rând, verificat pe `origin/main` `d943e090`, 17.11.2026)

### 4.1 Ce se întâmplă după opțiunea „nu particip, fără obiecții”

1. **Formularul public** (`src/RedariRaspunsPublic.jsx`) înregistrează răspunsul prin RPC-ul `fn_red_raspuns_public`
   (`supabase/migrations/20261126a_redari_teren.sql:724-781`). Pentru această opțiune cere bifarea declarației
   (`RedariRaspunsPublic.jsx:152`, garda în BD la `20261126a:760` și în trigger la `:457`).
   - **Textul de azi nu spune nimic despre semnarea electronică.** Descrierea opțiunii: „Sunt de acord ca procesul-verbal să fie
     întocmit în lipsa mea.” (`RedariRaspunsPublic.jsx:21`); declarația implicită: „… sunt de acord ca procesul-verbal să fie întocmit
     în lipsa mea.” (`:26`). Declarația se poate înlocui pe proiect din `red_proiecte.text_declaratie` (`:141`); ce text are proiectul
     real nu verificăm aici. Alinierea cu decizia din 17.11: PR #1117 (draft).
   - **Decizia 6** (01.11): răspunsul nu trimite nimic și nu generează PV; operatorul face totul din Registru (`RedariRaspunsPublic.jsx:10`,
     `docs/redari/README.md:115`).
2. **Starea perechii (parcelă, deținător)** devine „A răspuns — fără obiecții” (`src/redari/stare.js:103`, rangul 5 din `:14`).
3. **PV-ul A** îl creează și îl generează operatorul (admin / editor) din fișa parcelei: `ModalPv.jsx` → `fn_red_pv_creeaza`, apoi
   „Generează DOCX” (`src/redari/ui/ModalPv.jsx:191-222`). Rezultatul e un **DOCX** în bucketul `redari`, versionat pe cale
   (`src/redari/pv.js:314-327`, `:375-392`), legat de rând prin `fisier_generat_path`. Nu există conversie DOCX → PDF în platformă.
4. **„Trimis spre semnare”** = un buton care schimbă doar starea și data (`ModalPv.jsx:325`, `:247`). Nu trimite nimic, nu leagă nicio
   dovadă. Starea parcelei devine „PV trimis spre semnare” (`stare.js:97`, rangul 3).
5. **„Semnat”** = operatorul încarcă un scan PDF / JPG / PNG (`ModalPv.jsx:248-260`, `pv.js:328-340`), cu bifele „Semnat fizic” și
   „Semnat la sesiune” (`ModalPv.jsx:327-328`), printr-o actualizare directă a rândului cu CAS (`ModalPv.jsx:263-265`). Baza de date cere
   pentru `semnat` data primirii și calea scanului (`supabase/migrations/20261129c_redari_pv_stari.sql:35-37`). După `semnat` / `anulat`
   rândul e înghețat, **cu o excepție: `remediat_la`** (`20261129c:21-24`); identitatea PV-ului nu se schimbă niciodată (`:17-20`).
   Tranzițiile permise: `generat → trimis_spre_semnare | semnat | anulat`, `trimis_spre_semnare → semnat | anulat` (`:26-27`).
6. **PV C pe tronson numără PARCELE**: o parcelă intră la „PV A la sesiune” dacă are **cel puțin un** PV A semnat cu
   `semnat_la_sesiune = true`, altfel la „corespondență” (`pv.js:398-402`; coloana din `20261129a_redari_pv_schema.sql:37`). O parcelă
   semnată doar electronic ar apărea azi la „corespondență”.
7. **Acoperirea parcelei prin PV A** (`fn_red_parcela_acoperita_a`, `20261130n:198-214`, oglinda JS `pv.js:229-235`): parcela e
   acoperită dacă a semnat **un** utilizator / arendaș, **sau** dacă au semnat toți proprietarii activi.
8. **Coloane pregătite, nefolosite:** `red_raspunsuri.semnatura_electronica_ref` (`20261126a:216`) și `red_procese_verbale.semnatari`
   (jsonb, `20261126a:241`). Niciun ecran nu le scrie.
9. Ghidul notificărilor spune încă „trimis spre semnare prin poștă” la PV A (`docs/redari/GHID_NOTIFICARI.md:28`).

### 4.2 Ce canale există

| Canal | Ce face azi | Unde |
|---|---|---|
| Link personal + QR din convocator | Duce la formularul public `/redari/raspuns/:token`. Tokenul are 43 de caractere aleatoare, e generat în BD, **nu se schimbă** (nu există revocare sau rotire), expiră la ultima zi de sesiune a UAT-ului + 30 de zile (expirarea tokenului, nu fereastra de semnare). Limitele diferă pe apeluri: citirea formularului are doar limita de 30 / IP / 10 min (`:690`); trimiterea răspunsului are 30 / IP / 10 min și 5 / token / 10 min (`:746`, `:749`). | `20261126a:175-180`, `:286-292`, `:295-300`, `:676-722`; `RedariRaspunsPublic.jsx:9` |
| SMS (SMSLink) | Doar loturi pe UAT, cu un **text comun pe lot** (`sms_loturi.text`), create de admin / editor și aprobate de owner; mesajul individual nu are text propriu. Confirmarea de livrare vine prin `sms-dlr`. Comutatorul Redări e oprit până la autorizarea scrisă a beneficiarului și textul final; cât timp șablonul e „provizoriu”, merge doar pe proiecte `TEST-…`, cu cel mult 5 destinatari. SMS extern doar între 08 și 20. | `docs/sms/ACTIVARE_SMS_REDARI.md:3-24`; `20261130a_sms_mvp.sql:18`, `:70`, `:77`, `:81-110`, `:112-134`; `supabase/functions/sms-dlr/index.ts:1-3` |
| E-mail F2 (`redari@`) | Loturi aprobate de owner, construite parțial. **Transportul real e oprit în cod** și în BD; lipsesc OAuth de trimitere, Gmail, reconcilierea, DKIM / DMARC. | `redariMailF2.mjs:4`, `:85-86`; `20261131a_redari_mail_f2_loturi.sql`; `docs/redari/RAPORT_F2_EMAIL.md:189-197` |
| Poșta / curierul cu confirmare | Canalul obligatoriu al convocării. E-mailul și SMS-ul sunt doar în plus. Pentru semnarea PV-ului, poșta nu se mai folosește (D12). | `docs/redari/PLAN_EMAIL_REDARI.md:440-447`, `:909` |

### 4.3 Ce vede cine are linkul (azi)

`fn_red_formular_public` întoarce, pentru un token valid: **identificatorul parcelei, UAT-ul, denumirea proiectului**, zilele de
sesiune, **existența unui răspuns anterior** (`deja_raspuns`), textul declarației, textul GDPR și contactul proiectului
(`20261126a:706-720`); antetul paginii afișează parcela, UAT-ul și proiectul (`RedariRaspunsPublic.jsx:80-95`). Pagina nu afișează
numele, adresa sau telefonul deținătorului, dar **identificatorul parcelei + UAT-ul pot identifica indirect persoana**. Formularea din
subsolul paginii, „pagina nu afișează și nu cere date personale” (`:319`), e mai largă decât ce face pagina; se corectează în textele
din S0 (§11).

### 4.4 De unde vine telefonul și cine îl poate schimba

- Telefonul și e-mailul stau în `red_detinatori_contact` (`20261126a:182-189`), vizibile doar pentru admin / editor (`:889`). Intră prin
  importul fișierelor beneficiarului, parsate în navigator (Anexa 7: `src/redari/importAnexa7.js:13`, `:119`; lista TGZ: inserare
  directă din navigator, `src/redari/importTgz.js:685`) sau le introduce operatorul. **Admin / editor pot modifica oricând telefonul**
  (`20261126a:904-905`) și **pot citi tokenul** (`:875`, `:890`). Nu se păstrează proveniența unui telefon (din ce fișier, cine l-a
  schimbat); jurnalul general `red_jurnal` reține doar numele câmpurilor schimbate pentru contact (`:265`).
- **Formularul public nu cere telefon sau e-mail.** Câmpul opțional de e-mail din formular e planificat (felia F1b,
  `PLAN_EMAIL_REDARI.md:845-848`), nu construit.
- Modelul de PV A cere „Act de identitate (serie, nr.)” și „Act doveditor al calității”. La distanță nu le vedem (§7.17).

**Consecința pentru D3:** telefoanele din contact **nu** se pot folosi pentru cod așa cum sunt (orice operator le poate fi schimbat).
Telefonul pentru cod se ia doar dintr-un import nou al fișierului beneficiarului, păstrat cu proveniența (§7.4).

---

## 5. Variantele de semnare electronică (context)

**Context (rezumatul nostru al textului regulamentului, nu o opinie juridică).** Regulamentul (UE) nr. 910/2014 („eIDAS”), modificat
prin Regulamentul (UE) 2024/1183, definește trei niveluri: semnătura electronică (simplă), semnătura avansată (art. 26) și semnătura
calificată. Art. 25: unei semnături nu i se poate nega efectul juridic doar pentru că e electronică sau nu e calificată; cea calificată
are efectul echivalent al semnăturii olografe. La nivel național se aplică Legea nr. 214/2024.

| | A. Semnătură în platformă (link + cod SMS) | B. PDF tipărit, semnat de mână, fotografiat și încărcat | C. Semnătură avansată / calificată la un furnizor extern | D. Doar declarația online + PV tip B |
|---|---|---|---|---|
| **Decizia** | **Principală (D1)** | **Rezervă (D2)** | Nu la pilot | Calea pentru cine nu semnează (D11, D12) |
| **Ce vede deținătorul** | Pagina din linkul personal (același QR / link din scrisoare); cere un cod pe SMS; după cod vede PV-ul A complet; bifează acordul, își tastează numele, apasă „Semnez”; poate descărca PDF-ul. | Descarcă PDF-ul **din același link, după cod**; îl tipărește, semnează, fotografiază, încarcă prin link. | Un e-mail / SMS de la furnizor; identificare; semnează în aplicația furnizorului. | Nimic în plus față de formular. |
| **Ce dovadă rămâne** | Că linkul personal și un cod trimis la numărul dat de beneficiar au fost folosite, când, pe ce document (SHA-256 calculat de server), cu ce text de acord și ce nume tastat; livrarea codului. | Imaginea cu semnătura de mână + momentul încărcării, legate de cerere și de documentul servit. Originalul hârtie rămâne la deținător. | Fișierul semnat, verificabil cu un validator. | Răspunsul online; PV B semnat de comisie. |
| **Ce nu dovedește** | Cine a folosit linkul și codul (§6.1). | Că imaginea e a documentului servit (nu există legătură criptografică între poză și PDF); că semnătura e a deținătorului. | — | Nu e o semnătură a deținătorului. |
| **Cost** | Un SMS per cod (1–3 SMS per semnătură); dezvoltare internă (§11). | Timp de operator la verificarea imaginii. | De cerut ofertă. | Zero. |

**De urmărit, nu de construit acum:** portofelul european de identitate digitală (eIDAS 2) ar trebui să permită persoanelor fizice
semnătura calificată gratuită. Stadiul în România la data semnărilor e de verificat.

---

## 6. Riscuri asumate și modelul de amenințări

### 6.1 Riscuri asumate (D1, D6, D9)

Proprietarul a ales semnătura simplă; riscurile de mai jos sunt **asumate**, nu întrebări blocante. Se scriu în anexa de semnare
(ce **nu** dovedește semnarea) și în dosar.
- **Identitatea.** Semnarea dovedește că linkul personal și un cod trimis la numărul dat de beneficiar au fost folosite, când și pe ce
  document. **Nu** dovedește cine le-a folosit: o rudă, cineva din aceeași gospodărie, cineva căruia deținătorul i-a dat codul sau
  telefonul. Atenuări ieftine, deja în flux: textul de acord („declar că sunt [numele din PV] și semnez personal”), SMS-ul („nu dați
  codul nimănui; nu vi-l cerem la telefon”).
- **SIM înlocuit sau număr reatribuit:** numărul dat de beneficiar poate ajunge la altă persoană; dovada nu poate exclude acest lucru.
- **Rezerva olografă** dă doar o copie (poza), fără legătură criptografică cu documentul servit; originalul rămâne la deținător.
- **PDF-ul pregătit de operator** (D6): până la generarea directă din platformă, corespondența PDF ↔ registru se **detectează**, nu se
  împiedică (§7.5).
- **Fără ancoră independentă** (D9): integritatea e „nemodificabil prin aplicație”; o modificare făcută de administratorul BD sau o
  restaurare coerentă nu se poate detecta din platformă (§7.18).
- **PDF-ul anexei oficiale e generat în navigator** (până la S7): serverul fixează conținutul canonic și amprenta lui, nu și paginile
  PDF-ului; corespondența o verifică omul — operatorul care tipărește lista zilei (confirmare consemnată) și reprezentantul care
  contrasemnează (§7.5). O anexă falsificată la atașare, nevăzută de operator, rămâne posibilă; se descoperă ulterior regenerând
  anexa din documentul canonic. Dosarul de dovezi afișează conținutul canonic din BD, nu textul din PDF.
- **Scanul contrasemnat se leagă de PV prin verificarea vizuală a operatorului** (§7.12): operatorul confirmă explicit, consemnat cu
  identitatea lui, că pe scan citește nr. PV-ului și codul anexei oficiale. Serverul nu citește scanul; o asociere greșită (scanul
  anexei altui PV, o pagină lipsă) rămâne posibilă și se poate descoperi ulterior, comparând scanul cu anexa oficială păstrată.
- **Același om poate deschide cererea și semna pentru Antreprenor**, dacă e persoană desemnată (O1): deciziile nu cer separarea
  acestor roluri (§7.12).

### 6.2 Modelul de amenințări (ce rămâne după decizii)

| # | Cine / ce | Scenariul | Ce propunem | Ce rămâne |
|---|---|---|---|---|
| T1 | **Operator intern** (admin / editor Redări) — constatarea P1-1 din review | Azi poate citi tokenul și schimba telefonul din contact (§4.4); și-ar putea trece propriul număr și semna în locul deținătorului. | **D3:** codul pleacă doar la telefonul pentru cod, care vine dintr-un import al fișierului beneficiarului (fișierul păstrat neschimbat, cu SHA-256, nr. și data adresei beneficiarului, cine l-a importat) sau dintr-o corecție aprobată de owner, jurnalizată (§7.4). **Niciun operator nu poate schimba singur numărul la care pleacă codul**; editarea contactului obișnuit nu atinge telefonul pentru cod. Confirmarea PDF-ului de a doua persoană (§7.5). | Un operator care importă un **fișier falsificat** ca „fișier al beneficiarului” (detectabil ulterior: fișierul rămâne la dosar și se poate compara cu originalul beneficiarului); doi operatori complici la PDF; owner-ul (is_owner) ocolește orice separare. **Risc asumat.** |
| T2 | **Altcineva din gospodărie** | Plicul și telefonul ajung la aceeași rudă; ruda semnează. | Textul de acord și al SMS-ului (§6.1); doi coproprietari cu același telefon → sesiune (D10). | Nu se poate împiedica tehnic (§6.1). |
| T4 | **Cod redirecționat** | Redirecționarea SMS-urilor sau cineva sună deținătorul „din partea Gazpet” și îi cere codul. | SMS: „nu vi-l cerem la telefon”; codul valabil 10 minute, legat de o singură cerere (§7.6). | Inginerie socială. |
| T5 | **Link furat** (QR fotografiat, plic interceptat, e-mail citit de altcineva, §8.3) | Fără telefon, nu vede PV-ul și nu semnează, dar vede datele dinainte de cod (§7.8), poate cere coduri (care pleacă la deținător) și poate consuma încercările: **blochează calea electronică**. | Limite persistente și răcire temporară (§7.7); SMS: „dacă nu ați cerut codul, sunați la …”; operatorul vede tiparul „coduri cerute, niciunul verificat” și poate bloca semnarea electronică pe deținător (§12.1). | Calea electronică indisponibilă pentru acel deținător; rămâne sesiunea / PV B. |
| T6 | **Navigator modificat** | Trimite alt hash, alt nume, altă versiune de acord, alt număr. | Serverul nu primește număr de la client; hash-ul e calculat de server; acordul se leagă de versiunea și textul integral din BD (§7.5, §7.6). | — |
| T7 | **Administratorul BD / o cale privilegiată / restaurarea unei copii** | Modifică dovezi, fișiere și hash-uri împreună, coerent. | **Adversar exclus** din garanția „nemodificabil prin aplicație” (§7.18). | Nedetectabil fără ancoră (D9, risc asumat). |

(T3 din runda 2 e acum un risc asumat, la §6.1.)

---

## 7. Proiectarea

### 7.1 Fluxul, pas cu pas

**Pregătirea (o dată pe proiect / pe fișier):** operatorul importă fișierul beneficiarului cu telefoanele (§7.4); owner-ul aprobă lotul
permanent de SMS cu cod (O5) și lista persoanelor care semnează pentru Antreprenor (o administrează owner-ul și managerul de
proiect, D14).

**Operatorul (admin / editor Redări, în ERP):**
1. **Precondiții** (verificate în BD, sub lock, §7.10): ultimul răspuns al deținătorului e „nu particip, fără obiecții” (online, cu
   declarația bifată); PV-ul A există și e `generat` sau `trimis_spre_semnare` fără cerere activă; verificarea parcelei pe teren e
   completată (§7.17); deținătorul are **telefon pentru cod** (§7.4), care nu e al altei persoane (D10); semnarea electronică nu e
   blocată pe deținător.
2. **PDF-ul de semnat (D6):** operatorul salvează DOCX-ul generat ca PDF (din Word) și îl încarcă în ecranul „Trimite spre semnare
   electronică”. Platforma verifică `%PDF-` și mărimea, îl arată pagină cu pagină; **o a doua persoană** (alt admin / editor) confirmă
   că PDF-ul corespunde datelor din registru. SHA-256 îl calculează **serverul**. **Confirmarea reține hash-ul PDF-ului și amprenta
   versiunii registrului pe care a văzut-o persoana a doua** (§7.5).
3. **Deschide cererea** (un singur RPC, L02) = **punerea la dispoziție a PV-ului**: sub lock pe PV reverifică, față de confirmare,
   hash-ul PDF-ului și amprenta registrului (orice schimbare a PV-ului după confirmare = refuz, confirmarea devine invalidă, §7.5); scrie
   octeții PDF-ului și hash-ul, legătura cu DOCX-ul și cu amprenta rândului PV, versiunea telefonului pentru cod, termenul de 7 zile
   (§7.2), și trece PV-ul în `trimis_spre_semnare`. Cheie UUID per intenție (L04). **De aici curge termenul.**
4. **Anunțul** (opțional): e-mailul „PV-ul e gata de semnat” cu același link personal (§8), unde există adresă și F2 e activ. **Pe SMS
   nu pleacă linkul** (D4). Fără anunț, deținătorul vede PV-ul când redeschide QR-ul din scrisoare. Nimic nu pleacă automat (decizia 6).
   **Anunțul e separat de termen și nu îl mută**: termenul curge de la pasul 3, chiar dacă anunțul pleacă mai târziu sau deloc (practica
   propusă: anunțul în aceeași zi cu deschiderea). În dosar și în ecran apare „anunț netrimis” cât timp n-a plecat niciunul.
5. **Urmărirea** în ecranul „Semnări la distanță” (§7.16) și în fișa parcelei. Operatorul poate **retrage** cererea, cu motiv.

**Deținătorul (pe telefon, fără cont):**
1. Deschide linkul personal (QR sau e-mail). Vede ce vede și azi (§4.3) plus, dacă are un PV de semnat, „există un proces-verbal
   pregătit pentru semnare, până la [data], ora 20:00” (lista exactă: §7.8).
2. Apasă „Trimite-mi codul”. Primește un SMS cu un cod de 6 cifre, valabil 10 minute; codul se poate cere la orice oră cât
   cererea e în fereastră (D13, §7.2).
3. Introduce codul. Abia acum vede **PV-ul A complet** (exact octeții din cerere) și îl poate descărca.
4. Are trei butoane:
   - **„Semnez”**: bifează textul de acord (de la Juridic, versionat, păstrat integral), își tastează numele, apasă „Semnez” (fără
     semnătură desenată, D7). Acordul se leagă de hash-ul pe care **serverul** l-a servit în sesiunea de acces.
   - **„Am obiecții”**: scrie obiecțiile; se înregistrează un răspuns nou cu obiecții, iar cererea se închide ca `refuzata` (§7.14).
   - **„Am semnat pe hârtie — încarc poza”** (rezerva, D2, §7.13).
5. Vede confirmarea și poate descărca PDF-ul semnat cât e valabilă sesiunea de acces. Nu primește PDF-ul pe e-mail.

**Antreprenorul (persoana desemnată, O1):** în „Semnări la distanță” alege PV-urile semnate de deținători și **semnează din ERP, în
lot**, cu confirmare explicită (§7.12). ERP-ul generează anexa de semnare a fiecărui PV.

**Beneficiarul (reprezentantul):** la următoarea zi de sesiune de la primărie (sau la ziua de contrasemnare, O3) **efectiv
disponibilă** (§7.12) semnează anexele oficiale din „lista pentru ziua de sesiune”, în lot; operatorul încarcă scanul fiecărei anexe semnate, iar PV-ul devine `semnat` (§7.12).

### 7.2 Termenele (D11 = 7 zile)

| Termen | Valoare | De ce |
|---|---|---|
| **Fereastra deținătorului** (`expira_la`) | **O singură regulă:** 7 zile calendaristice de la **punerea la dispoziție a PV-ului** (= deschiderea cererii, §7.1 pasul 3), ca în planul trimis beneficiarului („7 zile de la punerea la dispoziție a procesului-verbal”). Ziua deschiderii nu se numără; termenul = data locală a deschiderii (Europe/Bucharest) + 7 zile, la **ora 20:00**. Anunțul (e-mail) e separat și **nu mută termenul**. | La 20:00 operatorul încă lucrează; ora de terminare nu depinde de orarul codului (D13). |
| Cererea codului | **La orice oră** cât cererea e în fereastră (D13): până la `expira_la`, fără o limită separată pentru ultimul cod. Pagina afișează termenul („semnarea până la [data] ora 20:00”) și, în ultima zi, avertismentul că semnarea trebuie terminată până la 20:00 (sesiunea de acces nu trece de termen). | Cine cere codul foarte aproape de 20:00 în ultima zi are mai puțin timp de semnat; pagina o spune explicit, nu promite mai mult. |
| Codul | 10 minute | — |
| Sesiunea de acces | min(30 de minute, `expira_la`) | — |
| **Reamintirea** | Cu **2 zile** înainte de `expira_la` (ziua a 5-a): rândul apare în lista „expiră în 2 zile”; e-mailul, după O6 | Nimic nu pleacă automat; operatorul pornește trimiterea (lot) sau sună. |
| Rezerva olografă | Încărcarea în aceeași fereastră; o poză încărcată la timp **nu expiră** cât așteaptă verificarea operatorului | Deținătorul nu e penalizat pentru întârzierea noastră. |
| **La expirare** | Cererea → `expirata`; parcela se finalizează prin **PV tip B** (D11). O cerere nouă pe același PV doar cu aprobarea owner-ului (ex. codul nu a plecat din vina noastră), jurnalizată. | — |
| Semnătura Antreprenorului | Fără termen în BD; alertă dacă PV-ul semnat de deținător n-a fost semnat de Antreprenor până în ajunul următoarei zile de sesiune / de contrasemnare | Să intre pe lista zilei. |
| Contrasemnarea beneficiarului | La următoarea zi de sesiune sau de contrasemnare (O3) **efectiv disponibilă** (§7.12); semnătura deținătorului **nu expiră** cât așteaptă | Fereastra de 7 zile privește doar pasul deținătorului. |
| Tokenul personal | Neschimbat (ultima zi de sesiune + 30 de zile, `20261126a:295-300`) | Semnarea folosește fereastra cererii, nu expirarea tokenului: RPC-urile de semnare acceptă tokenul doar dacă are o cerere în fereastră. Formularul de răspuns rămâne închis după expirarea tokenului, ca azi. După închiderea cererii, linkul nu mai autorizează nimic; pagina arată doar starea și contactul proiectului (inclusiv pentru o contestație, care se face prin operator, §7.15). |

**Exemplu calendaristic** (aceeași regulă, oricare ar fi ora deschiderii):

| Cererea deschisă (PV pus la dispoziție) | Anunțul pe e-mail | Termenul (`expira_la`) | Codul se poate cere |
|---|---|---|---|
| luni 16.11.2026, 15:00 | luni 16.11, 15:10 | **luni 23.11.2026, 20:00** | oricând de la deschidere până luni 23.11, 20:00 |
| luni 16.11.2026, 15:00 | joi 19.11 (întârziat) sau deloc | **luni 23.11.2026, 20:00** (anunțul nu îl mută) | idem |
| luni 16.11.2026, **21:30** (după 20:00) | marți 17.11 | **luni 23.11.2026, 20:00** (ziua deschiderii nu se numără: deținătorul are în continuare zilele 17–23.11) | oricând de la 21:30 (inclusiv în noaptea deschiderii) până luni 23.11, 20:00 |
| marți 17.11.2026, 00:10 | marți 17.11 | **marți 24.11.2026, 20:00** | oricând de la 00:10 până marți 24.11, 20:00 |

**Orarul codului — decis (D13, 17.11.2026): la orice oră, la cererea deținătorului.**
- **Modulul SMS:** azi rezervarea refuză loturile Redări în afara orelor 08–20 (`20261130a:716`, `:724`), iar funcția de trimitere
  reverifică ora înaintea fiecărei cereri către furnizor (`supabase/functions/sms-trimite/logica.ts:12`, `:102`). Se adaugă o
  **excepție explicită numai pentru mesajul de cod cerut de deținător** (categoria `redari_cod`), în **ambele** locuri: în rezervarea
  SQL și în verificarea dinaintea apelului extern. Toate celelalte SMS-uri (convocări, orice alt lot Redări) rămân 08–20. Aprobarea
  lotului permanent, plafoanele, opt-out-ul, comutatoarele și oprirea de urgență rămân aplicabile și noaptea.
- **Ce vede deținătorul:** poate cere codul oricând în fereastră; singura limită e termenul (`expira_la`, ora 20:00 în ziua
  termenului). După termen cererea expiră și codul nu se mai poate cere.
- **Semnarea propriu-zisă:** nu e limitată de orar; sesiunea de acces durează cel mult 30 de minute și nu trece de termen.
- **Riscul asumat:** SMS-uri noaptea — un link furat poate trezi deținătorul cu coduri (limitele de la §7.7 rămân). Excepția din
  modulul SMS are probe proprii: ceas controlat la 07:59 / 20:01 și noaptea, codul pleacă, iar celelalte loturi sunt refuzate.

**Compatibilitatea celor 7 zile:**
- **cu orarul codului:** codul se poate cere oricând în fereastră (D13), deci deținătorul are efectiv toate cele 7 zile, inclusiv
  serile și restul zilei deschiderii; limitele de coduri (§7.7: 3 / 24 h, 6 pe cerere) încap fără să blocheze un deținător legitim;
- **cu contrasemnarea:** fereastra privește doar deținătorul; după „Semnez”, PV-ul așteaptă Antreprenorul și beneficiarul fără să
  expire. Riscul real e lipsa unei zile de sesiune după semnare (UAT-ul are doar trei zile) → O3 și alerta din §7.16;
- **cu termenul PV C pe tronson:** un PV care așteaptă contrasemnarea apare separat în PV C (§7.19), nu blochează tăcut.

### 7.3 Stările

**PV-ul (`red_procese_verbale.stare`) nu primește stări noi:** `trimis_spre_semnare` = există o cerere activă sau a existat una închisă
fără finalizare; `semnat` = documentul final e legat; `anulat` = ca azi, **refuzat cât timp există o cerere activă**.

**Coloană nouă pe PV: `metoda_semnare`** ∈ {`sesiune`, `teren`, `electronic_distanta`, `olograf_distanta`}, **setată de server**
(trigger BEFORE, imuabilă după `semnat`, L08). Pentru metodele de la distanță, `semnat_fizic = false`, `semnat_la_sesiune = false`.

**Calea veche** (încărcarea scanului + „semnat” prin actualizare directă, `ModalPv.jsx:234-269`), propunerea implicită (§12.1):
- **R1.** `electronic_distanta` / `olograf_distanta` se pot seta **numai** de RPC-ul de finalizare: triggerul pe PV verifică, la trecerea
  în `semnat` cu aceste metode, că există în aceeași tranzacție cererea `finalizata` a PV-ului.
- **R2.** Pe un PV A care a avut **orice** cerere electronică, calea directă spre `semnat` se acceptă doar pentru semnarea **în
  prezență** (`sesiune` / `teren`, `semnat_fizic = true`), cu motiv, consemnat în jurnalul ultimei cereri. Regula stă în trigger și
  ține și după închiderea cererii, inclusiv la PATCH direct (L07).
- **R3.** Scanul primit „de la distanță” fără cerere nu mai e o metodă pentru PV A noi (D12): scos din UI; PV-urile vechi rămân cum sunt.

**Cererea de semnare** (listă închisă, tranzițiile într-un tabel, L20):

| Din | În | Cine |
|---|---|---|
| — | `deschisa` | operator (RPC de deschidere) |
| `deschisa` | `semnata_detinator` | deținătorul („Semnez”) |
| `deschisa` | `incarcata_olograf` | deținătorul (poza PV-ului semnat de mână, D2) |
| `incarcata_olograf` | `semnata_detinator` | operator (acceptă poza) |
| `incarcata_olograf` | `deschisa` / `expirata` | operator (respinge, cu motiv): înapoi la `deschisa` dacă fereastra mai e deschisă, altfel `expirata` |
| `deschisa` | `refuzata` | deținătorul („Am obiecții”) |
| `deschisa` | `expirata` | automat, la prima citire după `expira_la` (fără cron) |
| `deschisa` | `blocata` | automat, la epuizarea limitelor (§7.7) |
| `deschisa`, `incarcata_olograf`, `semnata_detinator`, `semnata_antreprenor`, `blocata` | `retrasa` | operator, cu motiv; automat la schimbarea telefonului pentru cod |
| `semnata_detinator` | `semnata_antreprenor` | persoana desemnată (O1), în lot (§7.12) |
| `semnata_antreprenor` | `finalizata` | operator, la încărcarea scanului contrasemnat de beneficiar (§7.12) |

`refuzata`, `expirata`, `retrasa`, `finalizata` sunt finale; `blocata` se închide doar prin retragere. O cerere nouă pe același PV
doar dacă nu există alta activă (UNIQUE parțial, L16) și, după `expirata`, doar cu aprobarea owner-ului (§7.2). Contestația după
`finalizata` e un obiect separat (§7.15). Ce arată ecranul de urmărire (trimis / deschis / cod verificat …) se **derivă** din stare +
jurnalul de dovezi (§7.16), nu sunt stări noi.

**Starea parcelei** (`stare.js` și vederea `red_v_stare_parcela`, aceeași regulă, test de paritate, L19):
- se păstrează regula 3 „PV trimis spre semnare”, **cu o excepție**: un răspuns cu obiecții înregistrat **după** deschiderea cererii
  (refuzul) trece înaintea ei, ca parcela să apară „Obiecții de tratat”. Azi regula 3 ar ascunde obiecțiile (`stare.js:97` e verificată
  înaintea răspunsurilor, `:100-105`). Atinge o vedere existentă: migrare proprie, cu L15 și paritate JS / SQL.
- contestația deschisă se vede pe parcelă după O7;
- eticheta „PV trimis spre semnare” primește în UI detaliul electronic („semnat de deținător”, „așteaptă contrasemnarea beneficiarului”).

### 7.4 Telefonul pentru cod (D3)

**Regula:** codul pleacă **doar** la un telefon primit de la beneficiar. Operatorul **nu** poate modifica numărul folosit pentru cod.

- **Tabel separat** `red_pv_semnare_telefoane`, alimentat **doar** prin două RPC-uri; contactul obișnuit (`red_detinatori_contact`)
  rămâne cum e și nu e citit de fluxul de semnare.
- **Importul beneficiarului** (`fn_red_semnare_telefoane_importa`): primește fișierul beneficiarului (octeții, păstrați neschimbați, cu
  SHA-256 calculat de server), nr. și data adresei cu care l-a trimis beneficiarul, și rândurile (deținător, telefon) extrase în
  navigator cu același parser ca importul Anexa 7. Serverul setează sursa `import_beneficiar`, legătura cu fișierul, cine a importat și
  când (L08). **Primul import** se face din fișierul original al beneficiarului, nu din contactul de azi (care poate fi fost editat).
- **Corecția** (`fn_red_semnare_telefon_corecteaza`): doar owner-ul (verificat în BD), cu motiv și referință (ex. adresa beneficiarului,
  telefonul confirmat de deținător la sesiune); sursa `corectie_owner`; rând în jurnalul de dovezi.
- Orice versiune nouă sau retragere a telefonului unui deținător **retrage automat** cererile lui active și le revocă codurile și
  sesiunile (§7.9).
- **D10:** dacă același telefon (normalizat) e telefonul pentru cod al **altei persoane** (altă `cheie_persoana`, ca la plicuri,
  `20261129i:57`) dintre deținătorii parcelei, cererea se refuză la deschidere cu motivul „telefon comun → sesiune”. Același om pe mai
  multe parcele, cu același număr, e permis.
- **Ce rămâne (legat de T1):** importul îl face tot un operator, iar rândurile sunt extrase în navigator. Un fișier falsificat sau rânduri
  care nu corespund fișierului se pot **detecta** ulterior (fișierul rămâne la dosar și se poate compara cu originalul beneficiarului /
  re-citi), dar nu se pot împiedica în pilot. „Eventual, mai târziu” (§12.1): citirea fișierului pe server și aprobarea fiecărui import
  de către owner.

### 7.5 Lanțul documentelor (D6: PDF-ul pregătit de operator)

Trei documente, fiecare cu SHA-256 calculat de **server** pe octeții din BD, niciodată declarat de client:

| | Document | Ce leagă | Cum se verifică |
|---|---|---|---|
| (a) | **Sursa:** DOCX-ul generat din registru (`fisier_generat_path`, `pv.js:314-327`) + **amprenta rândului PV** | **Amprenta versiunii registrului** = hash-ul, calculat de server, al câmpurilor PV-ului + calea DOCX-ului. Se reține de **trei** ori: la încărcarea PDF-ului, la **confirmarea** persoanei a doua (versiunea pe care a văzut-o) și la deschidere (sub lock). Garda pe PV (§7.9) interzice orice schimbare cât cererea e activă. | La deschidere, amprenta curentă trebuie să fie **identică** cu cea confirmată (altfel refuz, vezi mai jos); la semnătura Antreprenorului și la finalizare, serverul o recalculează din nou: diferită = refuz (L03). |
| (b) | **PDF-ul supus acordului** | Octeții în BD (`bytea`, plafon 2 MB), hash-ul calculat la încărcare. Deținătorul primește exact acești octeți; sesiunea de acces e legată de acest hash (§7.6). Navigatorul poate trimite hash-ul văzut doar ca verificare suplimentară (nepotrivire = refuz). | Oricine recalculează SHA-256 al PDF-ului păstrat și îl compară cu cel din confirmare, din cerere și din anexă. |
| (c) | **Anexa de semnare oficială**, apoi **scanul ei contrasemnat** | Conținutul anexei îl fixează **serverul** la semnătura Antreprenorului (mai jos); anexa tipărește nr. PV-ului, hash-ul lui (b), evenimentele deținătorului, semnătura Antreprenorului, **prefixul lanțului de dovezi** și codul anexei; are loc liber pentru reprezentantul beneficiarului. (b) rămâne **neschimbat**. Scanul anexei oficiale contrasemnate e documentul final; `fisier_semnat_path` indică cererea (format `semnare:<id>`; CHECK-ul de azi cere doar o valoare nevidă, `20261129c:35-37`). | Dosarul = (b) + anexa oficială (c) + scanul + manifestul de finalizare (hash-urile (a), (b), al conținutului anexei, al octeților anexei, al scanului, prefixul și capul lanțului la finalizare, ora). |

**Confirmarea PDF-ului, legată de versiunea registrului.** Persoana a doua vede PDF-ul alături de datele din registru; ecranul primește
de la server, odată cu datele afișate, amprenta versiunii lor. RPC-ul de confirmare primește hash-ul PDF-ului văzut și amprenta
văzută și, sub lock pe PV, le compară cu PDF-ul încărcat, cu amprenta curentă și cu amprenta de la încărcare (toate trei egale, altfel
refuz: PV-ul s-a schimbat după conversia în PDF); le reține împreună cu identitatea ei (`auth.uid()`).
Deschiderea cererii reverifică, **sub lock pe PV** (§7.10), că hash-ul PDF-ului și amprenta curentă sunt **exact** cele confirmate.
Orice schimbare a sursei între confirmare și deschidere (PV editat, DOCX regenerat) **invalidează confirmarea**: deschiderea e refuzată
cu motivul „PV-ul s-a schimbat după confirmare”, confirmarea e marcată `invalidata` și nu mai poate fi folosită; urmează PDF nou și
confirmare nouă. Scenariul din review: persoana a doua confirmă PDF-ul pe versiunea V1 a registrului; operatorul schimbă PV-ul în V2
înainte de deschidere → **deschiderea e refuzată**; PDF-ul confirmat pe V1 nu se poate lega niciodată de amprenta V2. (Riscul conversiei
manuale DOCX → PDF, mai jos, rămâne separat.)

**Anexa oficială: conținut fixat de server, o singură versiune tipărită.**
- **Conținutul** îl scrie RPC-ul de semnare a Antreprenorului (§7.12), în aceeași tranzacție cu semnătura: un document canonic (JSON
  cu cheile ordonate) cu tot ce tipărește anexa — nr. PV, parcela, deținătorul, hash-ul (b), amprenta (a), evenimentele deținătorului
  (id-ul și hash-ul fiecăruia), numele și funcția semnatarului, ora, hash-ul imaginii semnăturii, **prefixul lanțului** — și hash-ul
  lui (`sha256_continut_anexa`). **Codul anexei** = primele 12 caractere ale acestui hash. Nimic din conținut nu vine de la client.
- **Generarea (la pilot): în navigator; PDF-ul anexei e o REPREZENTARE a conținutului canonic, verificată de oameni.** Ce garantează
  serverul e **conținutul canonic** (ce s-a semnat, de cine, când) și amprenta lui (`sha256_continut_anexa`), fixate în BD la
  semnătura Antreprenorului. Serverul **nu** garantează că paginile PDF-ului atașat spun același lucru: un apel direct al RPC-ului de
  atașare poate trimite un PDF cu alt nume sau alte evenimente pe pagini și cu hash-ul corect în metadate.
  - Generatorul din navigator citește doar documentul canonic de la server, tipărește pe fiecare pagină nr. PV-ului și codul anexei și
    trece în PDF versiunea lui. Atașarea (`fn_red_semnare_anexa_ataseaza`) primește octeții și `sha256_continut_anexa` pentru care
    au fost generați; serverul refuză dacă hash-ul nu e cel fixat pentru cerere, verifică `%PDF-` și plafonul și calculează hash-ul
    octeților. Verificarea că metadatele PDF-ului (`Keywords`) conțin hash-ul conținutului rămâne doar ca **control de consistență**
    (prinde o anexă atașată la cererea greșită sau un generator vechi), **nu** ca dovadă că paginile corespund conținutului.
  - **Corespondența pagini ↔ conținut canonic o verifică omul, consemnat:** (1) **operatorul care descarcă lista zilei** vede, pentru
    fiecare anexă inclusă, PDF-ul alături de conținutul canonic afișat de ERP din BD (nr. PV, deținătorul, evenimentele, semnatarul,
    ora, codul anexei) și confirmă explicit (bifă pe anexă) că spun același lucru; confirmarea intră în lanțul de dovezi cu
    `auth.uid()` lui și hash-ul octeților anexei, în aceeași tranzacție cu descărcarea care îngheață anexa (fără confirmare, lista nu
    se descarcă); (2) **reprezentantul beneficiarului** contrasemnează anexa tipărită, pe care o poate compara cu PV-ul (b) din lista
    zilei. Ambele sunt verificări **umane**, nu tehnice.
  - **Dosarul de dovezi și ecranele afișează conținutul canonic din BD**, nu textul din PDF-ul anexei; PDF-ul și scanul apar ca
    documente suport, cu hash-urile lor (§2, §7.19).
  - **Riscul rămas** (scris și la §6.1): o anexă ale cărei pagini diferă de conținutul canonic trece dacă cine o atașează o falsifică
    (apel direct al RPC-ului) **și** operatorul care tipărește lista nu observă sau e complice; se poate descoperi ulterior,
    regenerând anexa din documentul canonic și comparând-o cu cea păstrată / scanată.
  - **Eventual, mai târziu (felia S7):** anexa generată de **server** din evenimentul de semnare înregistrat, odată cu generarea directă
    a PDF-ului PV-ului, prin același serviciu de server; clientul nu mai trimite octeți, iar verificarea umană (1) dispare.
- **O singură anexă oficială pe cerere.** Prima atașare reușită devine anexa oficială (`versiune_anexa = 1`); reluarea cu aceeași cheie
  UUID întoarce același rezultat (L04, L05). **Înlocuirea** e permisă doar **înainte de prima tipărire** (evenimentul „lista zilei
  descărcată”, care reține hash-ul fiecărei anexe incluse), cu motiv, ca versiune nouă (versiunea veche rămâne în jurnal). După prima
  tipărire anexa e **înghețată**: lista zilei, re-descărcările ei și dosarul folosesc exact octeții anexei oficiale păstrate, nu o
  regenerare; o regenerare ulterioară nu poate fi atașată.
- **Versiunea contrasemnată** = anexa oficială înghețată; finalizarea o reține în manifest (versiunea, hash-ul octeților, codul).
  Operatorul confirmă vizual, la încărcarea scanului, că pe scan se citesc nr. PV-ului și codul anexei oficiale (§7.12; riscul asumat
  la §6.1).
- **Prefixul lanțului, nu capul.** Hash-ul tipărit în anexă e al evenimentului „semnat de Antreprenor” = capul lanțului **în acel
  moment**. După el se adaugă legitim evenimente (anexa atașată, descărcări, lista zilei tipărită, un raport de livrare SMS întârziat,
  contrasemnarea). La finalizare serverul verifică: (1) evenimentul tipărit există în lanțul cererii și lanțul recalculat de la primul
  eveniment până la el dă exact hash-ul tipărit; (2) fiecare eveniment de după el se leagă corect de precedentul, până la capul curent.
  Capul curent **nu** trebuie să fie egal cu hash-ul tipărit. Evenimentele de după prefix nu apar în anexă (ex. o livrare SMS raportată
  târziu); apar în dosarul de dovezi.

**Ce rămâne până la generarea directă a PDF-ului (felia S7).** La început nu se poate **împiedica** încărcarea unui PDF diferit de
registru, doar **detecta**: (1) a doua persoană confirmă PDF-ul față de versiunea registrului pe care o vede, înainte de deschidere
(consemnat cu `auth.uid()` ei, legat de amprentă, ca mai sus);
(2) navigatorul extrage textul PDF-ului și verifică, orientativ, nr. PV-ului și identificatorul parcelei (plasă, nu dovadă); (3)
persoana care semnează pentru Antreprenor vede PDF-ul alături de datele din registru. Riscul rămas: doi oameni care greșesc la fel sau
sunt complici. **Împiedicarea** vine în S7: PDF-ul produs direct din registru, printr-un serviciu de server cu secret propriu (L10) și
fișă de securitate proprie; atunci pasul (1) dispare. Tot în S7, același serviciu generează și **anexa oficială** din documentul
canonic (mai sus), iar verificarea umană a anexei la tipărirea listei zilei dispare.

### 7.6 Codul și sesiunea de acces

**Codul:**
- generat de server (aleator criptografic), 6 cifre, valabil 10 minute; păstrat ca HMAC cu secret propriu al fluxului (L10), legat de
  cerere și de versiunea telefonului; în clar doar temporar, pentru expediere (§7.11);
- **un singur cod activ pe cerere:** un cod nou anulează, în aceeași tranzacție, codurile anterioare;
- **cheie de intenție pe cererea de cod** (L04, L05): navigatorul generează o cheie UUID înainte de primul apel „Trimite-mi codul” și o
  păstrează în `sessionStorage`, pe cerere; după un timeout sau o rețea căzută reapelează cu **aceeași** cheie. Aceeași cheie pe aceeași
  cerere → același rezultat („codul a fost cerut la HH:MM”), **fără al doilea cod, fără al doilea SMS și fără consum dublu** din limitele de la
  §7.7 și din plafoanele SMS; aceeași cheie pe alt token / altă cerere → refuz. Cheia e UNIQUE pe (cerere, cheie) în tabelul codurilor.
  O cheie nouă („cere alt cod”) e o intenție nouă: anulează codul anterior și consumă din limite. Codul nu e întors niciodată în
  răspuns;
- verificarea, sub lock-ul cererii (§7.10): întâi se incrementează contorul de încercări, apoi se compară; **verificarea reușită consumă
  codul atomic** (`UPDATE … SET consumat_la = now() WHERE id = … AND consumat_la IS NULL AND anulat_la IS NULL AND expira_la > now()
  RETURNING`; 0 rânduri = refuz).

**Sesiunea de acces:**
- emisă doar la verificarea reușită: cheie aleatoare de 32 de octeți, păstrată ca hash; în navigator în `sessionStorage`, niciodată în
  URL sau în `localStorage`;
- **legată de:** cerere + deținător + hash-ul PDF-ului (b) + versiunea telefonului; expiră la min(30 de minute, `expira_la`);
- fiecare RPC public reverifică **toate** legăturile sub lock;
- **revocată** în aceeași tranzacție cu: retragerea, refuzul, expirarea, blocarea, finalizarea, schimbarea telefonului pentru cod,
  blocarea semnării electronice pe deținător.

**Scenariul din review, acoperit:** deținătorul validează codul (sesiunea S1 pe cererea C1); operatorul retrage C1 și deschide C2 pe
același token. S1 e revocată la retragere și, oricum, legată de C1 și de hash-ul lui: **nu autorizează nimic pe C2**.

**Reluarea după succes:** semnarea poartă o cheie UUID per intenție, generată în navigator înainte de primul apel (L04); aceeași cheie +
aceleași date → **același rezultat** (L05); aceeași cheie + alte date → refuz; altă cheie pe o cerere deja semnată → „deja semnat”.
După `semnata_detinator`, sesiunea mai permite doar recitirea și descărcarea.

### 7.7 Limitele

| Nivel | Limită propusă | Ce se întâmplă peste |
|---|---|---|
| Cerere | un cod nou la cel mult 60 s; 3 coduri / 24 h; 6 coduri pe cerere; 5 încercări greșite pe cod (a 5-a anulează codul) | după 3 coduri anulate prin încercări: cererea → `blocata` |
| Deținător (persistent, peste toate cererile lui, fără resetare la cerere nouă) | 10 coduri în total; 2 cereri blocate | semnarea electronică se oprește pe deținător; o redeschide doar un **admin**, cu motiv, după ce l-a sunat |
| Telefon (HMAC al numărului, peste deținători) | 5 coduri / 24 h | refuz „contactați-ne” |
| Proiect | **20 de coduri / zi la pilot, 60 / zi după** (în setări, schimbate doar de owner); codurile consumă și din plafonul SMS general (implicit 200 / zi, 1.500 / lună, `20261130a:68-69`) | refuz „contactați-ne”; alertă în ecranul de urmărire |
| Apeluri publice | contoarele `red_rate_limit` existente (`ip:` 30 / 10 min) + chei **separate** pentru cererea de cod (`tc:` pe hash-ul tokenului) și pentru acțiunile cu sesiune (`s:` pe hash-ul sesiunii) | citirea documentului și semnarea nu consumă din cota pe token |

**Atacul de blocare (T5):** limitele nu pot opri pe cineva care are linkul să indisponibilizeze calea electronică pentru acel deținător;
îl împiedică doar să ghicească codul și să trimită SMS-uri în altă parte. Ce rămâne: o semnare amânată sau mutată la sesiune / PV B.
După `blocata`, cererea se retrage; o cerere nouă o deschide doar un admin, cu motiv, fără resetarea contoarelor persistente.

### 7.8 Ce se vede înainte de cod

Lista închisă, pentru cine are doar tokenul:
- tot ce întoarce azi `fn_red_formular_public` (§4.3) — neschimbat;
- **în plus**, din RPC-ul nou de stare: „există un PV pregătit pentru semnare: da / nu”, starea pe trei valori (`de semnat`, `semnat`,
  `închis`) și termenul (data, ora 20:00), fără motiv, fără nume, fără date din PV;
- **nicio cifră din telefon** (propunerea implicită, §12.1): „codul pleacă la numărul comunicat de beneficiar”.

Ce **nu** se vede înainte de cod: PV-ul, numele, starea terenului, obiecțiile, telefonul, istoricul de dovezi. RPC-ul nou nu micșorează
ce dezvăluie deja `fn_red_formular_public`; protecția reală e secretul tokenului + limitele. Citirea formularului primește și ea cheia
pe token (`t:`), ca toate apelurile publice să aibă aceleași limite.

### 7.9 Obiectele de bază de date (doar lista și rolul; nimic creat aici)

Regulile casei: tabele cu RLS pornit, `REVOKE ALL` de la `anon` / `authenticated` și acordare explicită; funcții
`SECURITY DEFINER SET search_path = public, pg_temp`, `REVOKE EXECUTE FROM PUBLIC`, `GRANT` doar pe RPC-urile dedicate; identitatea
operatorului **numai** din `auth.uid()` + `fn_red_nivel()` pe proiectul fiecărui id atins (L08, L09); erorile așteptate întoarse ca
jsonb cu motiv din listă închisă; triggerele de jurnal existente (`fn_red_jurnal`) pe tabelele cu date de operator, **nu** pe tabelele de
coduri și sesiuni.

**Tabele noi**

| Nume propus | Rol | Cine citește / scrie |
|---|---|---|
| `red_pv_semnare_pdf` | PDF-ul (b) încărcat de operator (octeți + SHA-256, amprenta registrului la încărcare, cine l-a încărcat) și **confirmarea** persoanei a doua: hash-ul PDF-ului văzut, **amprenta versiunii registrului văzute**, cine a confirmat și când, starea confirmării (`confirmata` / `folosita` de o cerere / `invalidata`). | SELECT admin / editor; scriere doar prin RPC |
| `red_pv_semnari` | Cererea: PV, deținător, starea (§7.3), legătura cu PDF-ul confirmat (b) + SHA-256, calea DOCX (a) + amprenta rândului PV, versiunea telefonului pentru cod, `expira_la`, `versiune`, cheia UUID, cine a deschis / retras / finalizat și când, documentul canonic al anexei + `sha256_continut_anexa` + prefixul lanțului, anexa oficială (octeți + hash + `versiune_anexa` + `inghetata_la`), scanul contrasemnat (octeți + hash), manifestul. UNIQUE parțial: o cerere activă pe PV. | SELECT admin / editor (viewer: doar starea, prin vedere fără telefon și fără octeți); scriere **doar** prin RPC |
| `red_pv_semnare_importuri` | Fișierele beneficiarului cu telefoane (octeții, SHA-256, nr. / data adresei, cine a importat). | SELECT admin / editor; scriere doar prin RPC |
| `red_pv_semnare_telefoane` | Telefonul pentru cod, versionat, cu sursa (`import_beneficiar` + importul / `corectie_owner` + motivul). | SELECT admin / editor; scriere doar prin RPC |
| `red_pv_semnare_coduri` | HMAC-ul codului, creat / expiră / consumat / anulat, încercări, cheia de intenție a cererii de cod (UNIQUE pe cerere + cheie, §7.6), legătura cu mesajul SMS. | nimeni direct; doar funcțiile DEFINER |
| `red_pv_semnare_sesiuni` | Sesiunile de acces (§7.6). | nimeni direct |
| `red_pv_semnare_dovezi` | Jurnalul de dovezi, **doar adăugare pentru rolurile aplicației**; fiecare rând conține hash-ul rândului precedent al cererii (lanț, §7.18). Evenimente: PDF confirmat (hash + amprenta), cerere deschisă = PV pus la dispoziție, anunț expediat (id-ul mesajului de e-mail), pagină deschisă, cod cerut / acceptat de furnizor / livrare raportată / eșuat / rezultat necunoscut / greșit / verificat (cu id-ul mesajului SMS), document servit (hash), descărcare, acord (versiune + hash text), nume tastat, semnat, poză olografă încărcată / acceptată / respinsă, refuz, blocare, retragere, semnătura Antreprenorului (= prefixul tipărit în anexă), anexă atașată / înlocuită, anexă confirmată de operator față de conținutul canonic, lista zilei descărcată (hash-urile anexelor incluse), scan contrasemnat verificat vizual, finalizare, contestație. | SELECT admin / editor; scriere doar prin RPC |
| `red_pv_semnare_olograf` | Pozele / PDF-urile încărcate de deținător (D2): octeți, tip verificat, SHA-256, plafoane. | SELECT admin / editor; scriere doar prin RPC |
| `red_pv_semnatari_antreprenor` | Persoanele desemnate să semneze pentru Antreprenor pe proiect (O1): utilizatorul, numele și funcția afișate, cine l-a desemnat, `retras_la`. | SELECT admin / editor; scriere: owner-ul și managerul de proiect al proiectului (D14) |
| `red_pv_semnatura_imagini` | Imaginea semnăturii unei persoane desemnate (opțională, PNG ≤ 200 KB), versionată. | SELECT admin / editor; scriere doar de persoana însăși; retragere de owner |
| `red_pv_semnare_texte` | Textele de acord, versionate, **integral**, imuabile. | SELECT authenticated; scriere doar prin migrare |
| `red_pv_semnare_contestatii` | Contestațiile după semnare (§7.15). | SELECT admin / editor; scriere prin RPC |
| `red_pv_semnare_blocaje` | Blocarea semnării electronice pe deținător, cu motiv și autor. | SELECT admin / editor; scriere prin RPC |

**Coloane noi:** `red_procese_verbale.metoda_semnare` (§7.3); ziua de contrasemnare pe UAT (după O3). Coloana existentă
`red_raspunsuri.semnatura_electronica_ref` (`20261126a:216`) **nu** se folosește (ține de răspuns și e editabilă de `authenticated`,
`20261131g_redari_stare_cost_rls.sql:262`).

**Gărzi în BD (L07):** trigger pe `red_procese_verbale` (cât există o cerere activă PV-ul nu se modifică; R1–R3 pe toate căile); trigger
pe `red_pv_semnare_telefoane` (versiune nouă / retragere → cererile active ale deținătorului retrase, codurile și sesiunile revocate);
CHECK-uri: hash-uri `^[0-9a-f]{64}$`, stare pe listă, `expira_la > deschisa_la`, mărimi plafonate, `%PDF-` la începutul octeților PDF.

**RPC-uri pentru operator (`authenticated`, admin / editor pe proiectul PV-ului, dacă nu e scris altfel)**

| Nume propus | Rol |
|---|---|
| `fn_red_semnare_telefoane_importa(octeti_fisier, nr_adresa, data_adresa, randuri, cheie_uuid)` | §7.4. |
| `fn_red_semnare_telefon_corecteaza(detinator, telefon, motiv, referinta, cheie_uuid)` | §7.4; **doar owner**. |
| `fn_red_semnare_pdf_incarca(pv, octeti, cheie_uuid)` | Operatorul încarcă PDF-ul (b); serverul calculează hash-ul și reține amprenta registrului de atunci. |
| `fn_red_semnare_confirma_pdf(pdf, sha256_vazut, amprenta_vazuta, cheie_uuid)` | A doua persoană confirmă PDF-ul față de versiunea registrului pe care o vede; sub lock pe PV, hash-ul și amprenta văzute trebuie să fie cele curente și cele de la încărcare; refuzat pentru cel care l-a încărcat (§7.5). |
| `fn_red_semnare_deschide(pdf, cheie_uuid)` | Precondițiile de la §7.1 sub lock-urile de la §7.10; reverifică hash-ul și amprenta față de confirmare (diferit = refuz, confirmarea → `invalidata`); scrie cererea, confirmarea → `folosita`, PV → `trimis_spre_semnare`, dovada, atomic. |
| `fn_red_semnare_retrage(cerere, versiune, motiv)` | CAS pe versiune; cererea → `retrasa`; revocă codurile și sesiunile. |
| `fn_red_semnare_olograf_decide(cerere, versiune, accept, motiv)` | §7.13. |
| `fn_red_semnare_antreprenor(cereri[], versiuni[], cheie_uuid)` | §7.12; doar persoanele din `red_pv_semnatari_antreprenor`; tot lotul sau nimic; fixează documentul canonic al fiecărei anexe și prefixul lanțului (§7.5). |
| `fn_red_semnare_anexa_ataseaza(cerere, sha256_continut_anexa, octeti_anexa, motiv_inlocuire?, cheie_uuid)` | §7.5: hash-ul conținutului = cel fixat; metadatele PDF-ului îl conțin (control de consistență, nu dovadă a paginilor); hash-ul octeților calculat de server; înlocuirea doar înainte de prima tipărire, cu motiv. |
| `fn_red_semnare_lista_zilei(uat, data, cereri[], confirmari_anexe[], cheie_uuid)` | Cere, pentru fiecare anexă inclusă, confirmarea operatorului că PDF-ul corespunde conținutului canonic (hash-ul octeților văzuți; lipsă / alt hash = refuzul întregii liste); înregistrează confirmările (`auth.uid()`) și descărcarea listei (hash-urile anexelor oficiale incluse), îngheață anexele (§7.5, §7.12); întoarce exact octeții păstrați. |
| `fn_red_semnare_finalizeaza(cerere, versiune, octeti_scan, data_contrasemnare, reprezentant, verificat_vizual, cheie_uuid)` | Doar din `semnata_antreprenor`, cu anexa oficială înghețată; verifică (a), (b), anexa oficială, prefixul și continuitatea lanțului (§7.5); cere confirmarea vizuală a operatorului (consemnată); scrie scanul și manifestul; PV → `semnat` cu metoda corespunzătoare; cererea → `finalizata`; atomic. |
| `fn_red_semnare_blocheaza(detinator, motiv)` / `…_deblocheaza` | Deblocarea doar admin. |
| `fn_red_semnare_contestatie_*` | §7.15; **doar operator** (nu există cale publică). |
| vederea `red_v_pv_semnari_urmarire` + lista paginată (keyset, L23) | Ecranul „Semnări la distanță”, fișa parcelei, dosarul de dovezi (§2, §7.16). |

**RPC-uri publice (`anon`)** — toate primesc tokenul personal, verifică formatul înainte de orice scriere, folosesc contoarele de la §7.7
și întorc același mesaj neutru pentru token inexistent, expirat sau fără cerere:

| Nume propus | Rol |
|---|---|
| `fn_red_semnare_public_stare(token)` | Lista de la §7.8. |
| `fn_red_semnare_public_cere_cod(token, cheie_uuid)` | Idempotent pe cheia de intenție (§7.6); limitele; anulează codul anterior; pune mesajul în lotul permanent **doar la telefonul pentru cod al cererii** (§7.11); fără restricție de oră (D13); refuz după `expira_la` (cererea nu mai e în fereastră). |
| `fn_red_semnare_public_verifica_cod(token, cod)` | §7.6; corect → cheia sesiunii de acces + dovadă. |
| `fn_red_semnare_public_document(token, sesiune)` | Octeții PDF-ului (b); dovada „document servit” cu hash-ul. |
| `fn_red_semnare_public_semneaza(token, sesiune, nume, versiune_acord, cheie_uuid, sha256_vazut?)` | Verifică legăturile sesiunii, cererea `deschisa` și neexpirată, numele nevid cu limită de lungime, versiunea acordului curentă; dovada; cererea → `semnata_detinator`. Idempotent pe cheie. |
| `fn_red_semnare_public_refuza(token, sesiune, obiectii, cheie_uuid)` | Răspuns `online` „nu particip, cu obiecții” (aceeași validare ca formularul, max 4.000 de caractere), cererea → `refuzata`, revocă sesiunile. Atomic. |
| `fn_red_semnare_public_olograf(token, sesiune, fisiere, cheie_uuid)` | §7.13; cererea → `incarcata_olograf`. |

### 7.10 Concurență și ordinea lock-urilor (L01, L06)

**Ordinea unică, pe toate căile (operator, public, trigger), scrisă în comentariul fiecărui RPC și trigger:**

0. contoarele publice `red_rate_limit` (`ip:`, `tc:`, `s:`) — doar RPC-urile publice, la început;
1. rândurile telefonului pentru cod ale deținătorilor atinși (`red_pv_semnare_telefoane`, `FOR UPDATE ORDER BY detinator_id`);
1'. lock consultativ pe HMAC-ul telefonului (regula D10) — după rândurile proprii, niciodată înainte;
2. PV-urile, `FOR UPDATE ORDER BY id`;
2'. rândul PDF-ului încărcat / confirmat (`red_pv_semnare_pdf`), `FOR UPDATE` — la confirmare și la deschidere, după PV, ca o
   schimbare a PV-ului să nu se poată strecura între verificarea amprentei și scriere;
3. cererile, `FOR UPDATE ORDER BY id`;
4. codurile și sesiunile cererii, `ORDER BY id`;
5. contoarele persistente pe deținător / telefon / proiect;
6. coada SMS (inserarea mesajului în lotul permanent; rezervarea și DLR-ul rămân în modulul SMS, cu lock-urile lui). **De verificat la
   S2** că niciun drum al modulului SMS nu blochează rânduri `red_*`.

**Importul / corecția telefonului:** (1) toate rândurile atinse, sortate, apoi (2) PV-urile cu cereri active ale acestor deținători,
sortate, apoi (3), (4). **Semnătura Antreprenorului în lot:** (2) toate PV-urile lotului, sortate, apoi (3) cererile, sortate; CAS pe
`versiune` la fiecare; o singură nepotrivire = refuzul întregului lot, cu lista PV-urilor schimbate. **Refuzul public:** (0) → (1) →
(2) → (3) → (4), **apoi** verificările, apoi INSERT în `red_raspunsuri` (care ia implicit `FOR KEY SHARE` pe `red_detinatori`).

**Lock-urile implicite numărate (L06):** cheile străine la INSERT (cerere → PV, deținător; dovadă → cerere; răspuns → deținător),
triggerele de jurnal, triggerul de pe PV.

Cazuri care trebuie să iasă corect (probe cu două sesiuni reale, L25):
- deținătorul semnează pe două telefoane deodată → exact una reușește, cealaltă vede „deja semnat”;
- operatorul retrage cererea exact când deținătorul semnează → câștigă cine ia primul lock-ul (3); celălalt primește motivul exact;
- un import de telefoane în timp ce deținătorul cere cod → se serializează pe (1); codul nu pleacă la vechiul număr după schimbare;
- PV-ul editat de un operator exact când altul deschide cererea → se serializează pe (2); deschiderea vede amprenta nouă și refuză
  (confirmarea invalidată, §7.5), sau editarea e refuzată de garda pe PV pentru că cererea e deja activă;
- aceeași cerere de cod trimisă de două ori (timeout + reluare cu aceeași cheie) → un singur cod, un singur SMS (§7.6);
- două loturi de semnătură a Antreprenorului care se suprapun → unul trece, celălalt e refuzat întreg;
- rezultat ambiguu în navigator (rețea căzută după „Semnez”) → reapel cu aceeași cheie UUID sau recitirea stării (L05).

### 7.11 SMS-ul cu cod și fișierele

**Autorizarea (O5).** Coada de azi lucrează cu loturi aprobate de owner și un text comun pe lot (`20261130a:81-110`); mesajul individual
nu are text (`:112-134`). Un cod e diferit la fiecare mesaj și trebuie să plece imediat. Propunerea:
- categorie nouă `redari_cod` (migrare în modulul SMS, cu review propriu); pe proiect, **un lot permanent** creat de admin și aprobat
  **o dată** de owner: șablonul cu loc pentru cod (versionat, GSM-7, un segment, **fără link**, D4), plafonul zilnic al proiectului
  (§7.7), data până la care e valabil, referința autorizării scrise a beneficiarului;
- fiecare cod adaugă **un mesaj** în acest lot, doar prin `fn_red_semnare_public_cere_cod`; **toate porțile existente se aplică la
  rezervare, neschimbate:** comutatorul general, comutatorul Redări (autorizarea beneficiarului), opt-out-ul, plafoanele zi / lună,
  orarul (08–20 pentru tot, cu excepția explicită doar pentru codul cerut de deținător, D13, §7.2); regula „șablon provizoriu doar pe `TEST-…`, cel mult 5 destinatari”
  se aplică și aici;
- lotul permanent se poate anula oricând de owner (oprește toate codurile proiectului).

**Adaptările concrete cerute de coada de azi (`supabase/migrations/20261130a_sms_mvp.sql`), toate în migrarea S2.** Coada a fost
construită pentru loturi fixe, cu lista destinatarilor înghețată la aprobare; lotul permanent încalcă trei presupuneri ale ei. Regulile
pentru **loturile obișnuite rămân exact cum sunt**; fiecare excepție se aplică doar categoriei `redari_cod` și are probă negativă pe un
lot obișnuit.
1. **Unicitatea `UNIQUE (lot_id, telefon)`** (`:129`): același telefon primește mai multe coduri în același lot permanent (cod nou după
   expirare, alt PV al aceleiași persoane), deci al doilea cod ar fi respins. Adaptare: mesajele de cod poartă legătura cu rândul
   codului (`cod_id`, UNIQUE); unicitatea `(lot_id, telefon)` devine index unic parțial **doar pe mesajele fără `cod_id`** (loturile
   obișnuite, neschimbate); un trigger cere `cod_id` nevid **dacă și numai dacă** lotul e `redari_cod`.
2. **Inserarea doar în lot `draft`** (triggerul de la `:320-328`): lotul permanent e aprobat, deci inserarea ar fi refuzată. Adaptare:
   excepție **doar** pentru lotul `redari_cod` în starea `aprobat` / `in_trimitere`, cu `cod_id` al unui cod neconsumat, neanulat,
   neexpirat, al cărui telefon e exact telefonul pentru cod al cererii; inserarea o face doar funcția de cerere a codului (DEFINER), nu
   rolul `authenticated`. La loturile obișnuite rămâne „doar în `draft`”. Aprobarea lotului permanent fixează șablonul, plafonul și
   valabilitatea, **nu** o listă de destinatari (lista fixată la aprobare rămâne regula loturilor obișnuite).
3. **Ciclul de rezervare / golire** (`fn_sms_rezerva`, `:699-746`): (a) când coada e goală, lotul trece în `coada_golita`
   (`:743`), stare din care nu mai primește mesaje — lotul permanent **nu** trece în `coada_golita`; se închide doar prin anulare de
   owner sau la data de valabilitate; (b) selecția automată a lotului (fără lot dat, `:714-717`) ia „cel mai vechi lot aprobat”, deci un
   lot permanent gol ar bloca celelalte loturi — selecția automată sare loturile `redari_cod` fără mesaje în coadă; (c) mesajul de cod
   trebuie să plece în minute, nu odată cu restul lotului: se rezervă **individual, după id-ul mesajului**, de un cron des (ex. la un
   minut) și / sau de un apel imediat al funcției de trimitere după cerere — alegerea se face în S2, cu probe pe simulator; (d) textul:
   lotul are un text comun (`sms_loturi.text`), aici șablonul; funcția de trimitere compune textul final din șablon + codul din tabelul
   temporar (mai jos), fără să-l scrie în `sms_mesaje`.
4. **Orarul** (D13): excepția pentru `redari_cod` se scrie în rezervare (`:716`, `:724`) **și** în verificarea dinaintea apelului
   extern (`sms-trimite/logica.ts:102`); celelalte categorii rămân 08–20, cu probă la 07:59 / 20:01.
5. **Reluarea fără al doilea cod** (L04, L05): cheia de intenție de la §7.6; reluarea cu aceeași cheie nu inserează alt mesaj și nu
   consumă din nou din limite sau din plafoanele SMS (plafonul zilnic se numără pe mesajele rezervate, `fn_sms_consum`, `:224-231`).

**Dovada trimiterii codului (§2):** mesajul SMS e legat de cerere (prin `cod_id`); în jurnalul de dovezi intră, separat:
- „cod cerut” (ora cererii, în BD);
- „cod acceptat de furnizor”, cu **ora înregistrării rezultatului acceptat** (`trimis_la`, `:362`);
- „livrare raportată” (livrat / eșuat), cu **ora primirii / aplicării raportului** în BD (`sms_dlr.primit_la`; la livrat și `sms_mesaje.livrat_la`, `:367`) și, separat, **ora raportată de
  operatorul telecom** (`sms_dlr.raportat_la`), care poate lipsi;
- „rezultat necunoscut” când mesajul a fost rezervat și furnizorul n-a răspuns; nu se retrimite automat, ca azi.
Numărul apare doar mascat. Oricare dintre ore poate lipsi; dosarul arată „—”, nu o oră presupusă.

**Păstrarea temporară a codului.** Expedierea e asincronă, deci codul trebuie să existe în clar până la predarea către furnizor:
- tabel separat, accesibil doar funcției care predă mesajele furnizorului: codul **criptat** (cheie proprie, nu în BD), legat de mesaj;
- **șters** (rândul) imediat ce furnizorul a primit mesajul sau la eșec / anulare, și oricum la expirarea codului (10 minute);
- codul nu apare în jurnalul SMS, în `sms_mesaje`, în jurnalele funcțiilor edge, în rapoartele de erori sau în DLR (DLR-ul are doar
  id-ul furnizorului, `20261130a:147-157`). Textul rămâne și în istoricul furnizorului; codul expiră oricum în 10 minute și e consumat
  la folosire.

**Fișierele: octeți în BD.** PDF-ul (b), anexa (c), scanul contrasemnat, pozele olografe și imaginile semnăturilor stau ca `bytea`, cu
plafoane (2 MB / 2 MB / 10 MB / 10 MB în total pe cerere / 200 KB); RPC-urile primesc octeții și calculează hash-ul în aceeași
tranzacție cu scrierea (L02). Fără Storage în flux, deci fără „fișier scris, legare neconfirmată” și **fără ștergere compensatorie**: la
rezultat necunoscut, clientul reapelează cu aceeași cheie UUID (L04, L05). Costul: ~0,5–3 MB pe PV A semnat electronic.

### 7.12 Semnătura Antreprenorului din ERP și contrasemnarea beneficiarului (D5)

**Cine are dreptul (O1):** persoanele din `red_pv_semnatari_antreprenor` pentru proiectul PV-ului, care au și nivel admin / editor
Redări. Lista o administrează owner-ul și managerul de proiect (D14, §1). Identitatea vine **numai** din `auth.uid()` (L08); numele și funcția se iau din listă de
server, nu din formular. **Operatorul care a deschis cererea poate fi și semnatarul Antreprenorului, dacă e persoană desemnată:**
deciziile nu cer separarea acestor roluri, iar riscul e asumat (§6.1).

**Ce se aplică pe document:** anexa de semnare a PV-ului, generată din ERP după semnare, conține în blocul Antreprenorului:
- numele și funcția persoanei desemnate (din listă), momentul semnării (ora serverului, Europe/Bucharest);
- **imaginea semnăturii**, dacă persoana și-a încărcat-o o dată (`red_pv_semnatura_imagini`, încărcată doar de ea însăși; o versiune
  nouă nu schimbă anexele deja generate); altfel, mențiunea „semnat electronic din platformă”;
- mențiunea că semnătura a fost aplicată din platformă de persoana desemnată, autentificată.
Anexa mai conține: nr. PV-ului, parcela, deținătorul, SHA-256 al PDF-ului (b) acceptat, evenimentele deținătorului (cod livrat,
cod verificat, semnat, numele tastat, versiunea textului de acord — cele înregistrate până la semnătura Antreprenorului), ce nu
dovedește semnarea (§6.1), prefixul lanțului de dovezi, codul anexei pe fiecare pagină și un bloc liber pentru reprezentantul
beneficiarului (nume, semnătură, data). Tot conținutul vine din documentul canonic fixat de server (§7.5). Text de la Juridic; fără
„generat automat”, fără nume de unelte.

**Semnarea în lot, cu confirmare explicită:**
1. În „Semnări la distanță”, persoana desemnată filtrează „semnat de deținător”, pe UAT / tronson, și bifează PV-urile (cel mult 50).
2. Fereastra de confirmare listează fiecare PV: nr., parcela, deținătorul, data semnării deținătorului, primele caractere ale hash-ului
   (b), cu link spre PDF și spre datele din registru. Textul „Semnez în numele Antreprenorului cele N procese-verbale de mai sus” se
   bifează, iar butonul arată numărul („Semnez 12 PV-uri”).
3. Un singur RPC (`fn_red_semnare_antreprenor`) primește lista exactă de cereri și versiunile văzute; sub lock-uri (§7.10) verifică
   dreptul, starea `semnata_detinator`, versiunea (CAS), amprenta PV-ului (a) și hash-ul (b); scrie pentru fiecare cerere dovada
   „semnat de Antreprenor” (utilizatorul, numele și funcția copiate, ora, hash-ul (b), hash-ul imaginii folosite) — hash-ul acestei
   dovezi e **prefixul** tipărit în anexă —, fixează documentul canonic al anexei și hash-ul lui (§7.5) și trece cererea în
   `semnata_antreprenor`. Tot lotul sau nimic (L02); aceeași cheie UUID = același rezultat (L04, L05).
4. ERP-ul generează anexele (PDF, în navigator, ca celelalte documente ale platformei) **doar din documentul canonic** citit de la server
   și le atașează prin `fn_red_semnare_anexa_ataseaza`, care verifică hash-ul conținutului fixat, nu și paginile PDF-ului: acestea
   le verifică operatorul la descărcarea listei zilei (§7.5). O anexă lipsă (ex. rețea
   căzută) se vede în ecran și se regenerează din același document canonic. **Prima atașare reușită = anexa oficială**; o înlocuire e
   posibilă doar până la prima tipărire, cu motiv; după aceea anexa e înghețată și lista zilei folosește exact octeții ei.

**Interfața minimă din S3** (selecția PV-urilor, fereastra de confirmare, atașarea anexei, lista zilei, încărcarea scanului) se
livrează în S3, ca felia să se poată proba cap-coadă; ecranul complet cu numere, filtre și alerte rămâne în S4.

**Ce dovadă rămâne:** cine (utilizatorul autentificat), ce nume și funcție, când, pe ce document (hash-ul (b) și amprenta (a)), cu ce
imagine (hash), în ce lot; toate în lanțul de dovezi al fiecărei cereri și în conținutul canonic al anexei. Anexa oficială tipărită
reprezintă acest conținut (hash-ul PDF-ului acceptat, prefixul lanțului); corespondența ei cu conținutul canonic e verificată de om
(§7.5).

**Contrasemnarea beneficiarului (la următoarea zi efectiv disponibilă, în lot):**
- **următoarea dată efectiv disponibilă** pentru un PV semnat de Antreprenor = prima zi de sesiune sau de contrasemnare (O3) a UAT-ului
  **strict după** ziua semnăturii Antreprenorului; **ziua de azi** contează doar dacă lista zilei de azi **nu a fost încă tipărită**
  (evenimentul „lista zilei descărcată”). Cazul tipic: Antreprenorul semnează într-o zi de sesiune, după ce sesiunea s-a încheiat și
  lista a fost tipărită → PV-ul trece la următoarea zi de sesiune / contrasemnare, nu la ziua de azi. Dacă nu mai există nicio astfel
  de zi, PV-ul apare cu alerta „fără zi de contrasemnare” până se programează o zi de contrasemnare (O3);
- starea `semnata_antreprenor` apare în ecran ca **„așteaptă contrasemnarea beneficiarului — [data]”** când există o dată efectiv
  disponibilă; altfel ca **„semnat de Antreprenor — fără zi de contrasemnare”** (alertă);
- **lista pentru ziua de sesiune** (pe UAT și dată): PV-urile care au acea dată ca următoare dată efectiv disponibilă, cu un fișier de
  tipărit (anexele oficiale, opțional și PDF-ul (b)) și un opis cu nr. PV-urilor și codurile anexelor, pe care reprezentantul îl
  semnează la primire; înainte de descărcare, operatorul confirmă pentru fiecare anexă, alături de conținutul canonic afișat din BD,
  că PDF-ul spune același lucru (consemnat); descărcarea listei îngheață anexele incluse (§7.5);
- după semnare, operatorul **încarcă scanul fiecărei anexe semnate** (PDF / JPG / PNG): ecranul arată alături anexa oficială, nr.
  PV-ului și codul anexei; **operatorul confirmă explicit** (bifă, consemnată cu identitatea lui în lanțul de dovezi) că pe scan citește
  nr. PV-ului și codul anexei oficiale. Aceasta e verificarea aleasă pentru scan: serverul nu citește imaginea, iar riscul unei asocieri
  greșite e asumat (§6.1). RPC-ul de finalizare scrie scanul, data contrasemnării și numele reprezentantului, PV → `semnat`
  (`semnat_primit_data` = data contrasemnării), cererea → `finalizata`;
- încărcarea întregului teanc dintr-un singur PDF, cu împărțirea pe PV-uri: eventual, mai târziu.
- Dacă beneficiarul cere altă formă (O2: borderou pe zi, semnătură electronică proprie), se schimbă doar acest pas.

### 7.13 Rezerva olografă (D2)

- **Cine:** deținătorul care are cererea deschisă și preferă hârtia; aceeași fereastră de 7 zile, același link, după cod (PDF-ul are date
  personale).
- **Ce face:** descarcă PDF-ul (b), îl tipărește, semnează, fotografiază toate paginile (sau îl scanează) și le încarcă prin pagină:
  JPG / PNG / PDF, cel mult 6 fișiere, 10 MB în total. Serverul verifică tipul după conținut (nu după nume), calculează SHA-256 și
  păstrează octeții; cererea → `incarcata_olograf`.
- **Verificarea operatorului:** vede pozele alături de PDF-ul (b): toate paginile, nr. PV-ului lizibil, semnătura prezentă la locul ei,
  niciun text schimbat vizibil. **Acceptă** → `semnata_detinator` (metoda `olograf_distanta`), apoi Antreprenorul și beneficiarul ca la
  §7.12; **respinge** cu motiv → înapoi la `deschisa` dacă fereastra e deschisă (deținătorul poate reîncărca), altfel `expirata`.
- **Fișiere ostile:** imaginile nu se afișează niciodată ca HTML; se servesc cu tipul verificat, ca `blob`, cu plafon de pixeli; PDF-urile
  nu se deschid în pagină cu scripturi. Probe cu PDF poliglot, imagine imensă, tip fals (S5).
- **Ce rămâne:** poza e o copie, fără legătură criptografică cu PDF-ul servit (§6.1).
- **Condiție a pilotului:** S5 rămâne felie separată de implementare, dar **pilotul cu deținători nu începe fără ea** (§11): un deținător
  din pilot care cere varianta pe hârtie trebuie să găsească fluxul promis în documente (D2, §10).

### 7.14 Cazurile urâte

| Caz | Ce se întâmplă |
|---|---|
| **Coproprietari** | Fiecare are PV-ul A propriu (`20261126a:245-248`) și semnează separat, cu telefonul lui. Parcela e „acoperită” abia când au semnat toți proprietarii activi (§4.1 pct. 7). Același telefon la două persoane: sesiune (D10). |
| **Utilizator / arendaș** | Semnează separat. Azi un singur PV A semnat de utilizator acoperă parcela (`20261130n:200-203`, `pv.js:231`); ce se întâmplă cât un proprietar are obiecții / contestație: O7. |
| **Moștenitor** | Doar dacă beneficiarul l-a comunicat ca moștenitor (și telefonul lui vine de la beneficiar, D3); altfel sesiune. |
| **Reprezentant cu mandat** (procură) | Procura nu se poate verifica la distanță → la pilot, doar la sesiune. |
| **Telefon greșit / lipsă** | Codul nu ajunge la deținător; acesta sună. Corecția doar prin fișier nou de la beneficiar sau de owner (§7.4); corecția retrage automat cererea; se deschide alta, în limita ferestrei sau cu aprobarea owner-ului după expirare (§7.2). |
| **Cod expirat / greșit** | Mesaj clar, „cere alt cod” în limitele de la §7.7; după limite → „contactați-ne”, cererea `blocata`. |
| **Are obiecții după ce a văzut PV-ul** | Butonul „Am obiecții”: răspunsul cu obiecții devine ultimul; parcela trece la „Obiecții de tratat” (§7.3); cererea e `refuzata`. |
| **Se răzgândește după ce a semnat, înainte de finalizare** | Semnătura și dovada rămân. Operatorul poate retrage cererea, cu motiv, până la clarificare. |
| **Contestă după finalizare** | §7.15. |
| **Nu semnează în 7 zile** | Cererea expiră; PV tip B (D11). |
| **Link redirecționat altcuiva** | Fără cod nu vede PV-ul și nu semnează (dar vede datele de la §7.8 și poate bloca, T5). |
| **PV regenerat după trimitere** | Imposibil cât cererea e activă. Operatorul retrage cererea, regenerează, confirmă din nou PDF-ul și deschide o cerere nouă (hash nou), în limitele de la §7.2. |
| **Deținătorul fără telefon / fără smartphone** | Sesiunea sau PV-ul B (D12). |
| **Deținător decedat / calitate contestată** | Operatorul retrage cererea; situația merge la beneficiar. |
| **Persoana desemnată pentru Antreprenor pleacă** | Owner-ul o retrage din listă; anexele deja semnate rămân valabile ca dovadă (numele și funcția sunt copiate în dovadă). |

### 7.15 Contestația după semnare

După `finalizata`, PV-ul e `semnat` și înghețat (§4.1 pct. 5). Contestația e un **obiect separat**:
- **înregistrarea: exclusiv prin operator** (contestație primită la telefon, în scris, pe e-mail, la sesiune, max 4.000 de caractere,
  cu canalul și, unde există, scanul scrisorii). Rând nou + eveniment în lanțul de dovezi. **Nicio dovadă nu se șterge.**
- **De ce nu din link:** finalizarea revocă sesiunile, iar linkul autorizează doar o cerere în fereastră (§7.2); o cale publică după
  finalizare ar cere un acces nou (cod SMS, limite, cotă) doar pentru un caz rar, încă o suprafață de atac pe un token care nu se poate
  revoca (§8.3), și ar trebui să nu poată autoriza nicio semnare nouă. Operatorul primește oricum contestația pe toate canalele de mai
  sus. După finalizare, pagina din link arată contactul proiectului „pentru întrebări sau contestații”; **nu** promite un buton de
  contestație.
- **suspendarea folosirii administrative (O7):** cât e deschisă, PV-ul nu mai acoperă parcela în centralizator, în `red_v_stare_parcela`
  și în PV C (apare separat, „semnătură contestată”); PV-ul rămâne `semnat` în tabel. Migrare proprie, paritate JS / SQL.
- **decizia** (`respinsa` / `admisa`, cu motiv): după O7; `admisa` → PV-ul nu mai acoperă parcela, care se reia la sesiune (PV nou).
- **notificarea:** alertă în ecranul de urmărire și în fișa parcelei (fără mail / SMS automat).

### 7.16 Ecranul „Semnări la distanță” (felia S4)

**Unde:** Redări → tab nou „Semnări la distanță”, pentru admin / editor (viewer: doar numerele, fără nume și fără telefoane). Filtre:
proiect, **UAT**, **tronson**; sus, numărul de PV-uri A în fiecare stare, pe UAT și pe tronson (tabel UAT × stare, cu totaluri).

**Nimic nu se numește „Trimis”.** Ecranul separă patru fapte diferite, fiecare cu ora lui: **PV disponibil** (cererea deschisă = PV pus
la dispoziție, de aici curge termenul), **anunț expediat** (e-mailul acceptat de serverul de e-mail; altfel „anunț netrimis” sau
„rezultat necunoscut”), **cod acceptat de furnizor** (SMS-ul cu cod predat furnizorului) și **livrare raportată** (raportul de livrare
al operatorului telecom: livrat / eșuat). Starea principală vine din cerere; anunțul și codul sunt coloane separate, ca o cerere fără
niciun mesaj plecat să nu arate ca „trimisă”.

| Stare în ecran | Definiția (derivată din cerere + jurnalul de dovezi) |
|---|---|
| **PV disponibil — link nedeschis** | cerere `deschisa`, pagina nedeschisă după deschiderea cererii |
| **Link deschis** | cerere `deschisa`, pagina deschisă, niciun cod verificat |
| **Cod verificat** | cerere `deschisa`, cel puțin un cod verificat, nesemnat |
| *De verificat (olograf)* | cerere `incarcata_olograf` |
| **Semnat de deținător** | `semnata_detinator` (electronic sau olograf acceptat), așteaptă Antreprenorul |
| **Semnat de Antreprenor** | `semnata_antreprenor`, **fără** dată efectiv disponibilă de contrasemnare (alertă, §7.12) |
| **Așteaptă contrasemnarea beneficiarului** | `semnata_antreprenor`, cu dată efectiv disponibilă (§7.12) |
| **Finalizat** | `finalizata`, fără contestație deschisă |
| **Expirat** | `expirata`, **sau** `deschisa` cu `expira_la` trecut (derivat din timestamp, chiar dacă nimeni n-a citit încă cererea; de trecut la PV B) |
| **Contestat** | `finalizata` cu contestație deschisă |
| *Altele* (restrânse) | `refuzata` (→ obiecții), `blocata`, `retrasa` |

| Coloană separată | Valori (fiecare cu ora ei; „—” unde lipsește) |
|---|---|
| **Anunț** | netrimis / expediat (acceptat de serverul de e-mail) / rezultat necunoscut / eșuat |
| **Cod** | niciun cod cerut / cerut, în coadă / acceptat de furnizor / livrare raportată: livrat sau eșuat / rezultat necunoscut / anulat |

- Fiecare număr se deschide într-o listă (keyset, L23): parcela, deținătorul, nr. PV, data deschiderii, termenul (zile rămase),
  ultimul eveniment, cu acțiunile stării: retrage; verifică poza; semnează ca Antreprenor (lot, §7.12); încarcă scanul contrasemnat;
  deschide dosarul de dovezi (§2).
- **Lista pentru ziua de sesiune:** pe UAT și pe dată, PV-urile care așteaptă contrasemnarea, cu fișierul de tipărit și opisul (§7.12)
  și starea încărcării scanurilor.
- **Alerte:** „expiră în 2 zile” (reamintirea, O6), „coduri cerute, niciunul verificat” (T5), „fără zi de contrasemnare”, „anexă
  negenerată”, „plafonul zilnic de coduri atins”.
- **O singură definiție** (L19): starea din ecran o calculează vederea `red_v_pv_semnari_urmarire`, folosită și de fișa parcelei, de
  dosarul de dovezi și de export; o eroare de citire se afișează ca eroare, nu ca „zero” (L18).

### 7.17 Ce trebuie schimbat în texte (de la Juridic, nu de la noi)

- **Formularul public:** descrierea opțiunii și declarația implicită (`RedariRaspunsPublic.jsx:21`, `:26`) — PR #1117 (draft); subsolul
  „nu afișează și nu cere date personale” (`:319`) se corectează (§4.3).
- **Modelul PV A** (șablonul `pv_a.docx`): secțiunea 2 („Act de identitate”) — mențiunea semnării de la distanță; secțiunea 4
  („Constatarea s-a făcut”) — „de la distanță, pe baza declarației online a deținătorului și a verificării comisiei pe teren la data …”;
  secțiunea 7 („Încheiat în 3 exemplare”) — formularea pentru documentul electronic. Modelul a fost trimis beneficiarului (§10).
- **Textul de acord:** include declarația de identitate („sunt [numele din PV] și semnez personal”); integral, versionat.
- **Anexa de semnare** (§7.12): conținutul de acolo; text stabilit cu Juridic.
- **SMS-ul cu codul:** cerințele de la §10; propunere de lucru: „Gazpet pt Transgaz: cod semnare PV predare teren 123456, valabil 10 min.
  Nu il dati nimanui; nu vi-l cerem la telefon.” (de verificat că încape în 160 de caractere cu numărul de contact).
- **Pagina de semnare:** termenul („semnarea până la [data] ora 20:00”), faptul că codul se poate cere la orice oră până la termen
  (D13) și, în ultima zi, avertismentul că semnarea trebuie terminată până la 20:00; rezumatul informării (O4), varianta pe hârtie (D2); după închiderea cererii, contactul proiectului pentru
  întrebări sau contestații (§7.15).
- **PV C:** coloana „PV A prin corespondență” (`pv.js:398-402`) ar număra și parcelele semnate electronic; coloana nouă și tratarea
  parcelelor mixte: O9 (§3); textul coloanelor de la Juridic.
- **Ghidul notificărilor:** „trimis spre semnare prin poștă” (`GHID_NOTIFICARI.md:28`) se actualizează (D12).

### 7.18 Integritatea și păstrarea dovezilor

**Ce garantăm:** „nemodificabil prin aplicație” — rolurile aplicației nu pot modifica sau șterge cererea, octeții, dovezile, textele de
acord și manifestul (doar RPC-uri, triggere care refuză UPDATE / DELETE). Bucketul `redari` are deja politici fără UPDATE / DELETE
(`20261126a:24-25`, `:1003-1007`), dar fluxul de semnare nu-l folosește (§7.11).

**Ce NU garantăm (T7, risc asumat prin D9):** administratorul BD (poate dezactiva triggerele; aceeași limită e scrisă deja pentru
`red_jurnal`, `20261126a:265`), o cale privilegiată, restaurarea unei copii vechi coerente.

**Lanțul de hash-uri** (cost mic, păstrat): fiecare dovadă conține hash-ul dovezii precedente. Anexa oficială tipărește **prefixul**
lanțului (hash-ul dovezii „semnat de Antreprenor”), iar anexa ajunge la beneficiar semnată — o copie în afara infrastructurii noastre,
valabilă pentru evenimentele de până la semnătura Antreprenorului, în măsura în care anexa tipărită corespunde conținutului canonic
(verificare umană până la S7, §7.5). Evenimentele adăugate după (anexa, descărcări, lista zilei, livrări
raportate târziu, contrasemnarea) sunt legitime și se verifică prin continuitatea lanțului de la prefix la capul curent (§7.5);
manifestul de finalizare reține ambele.
**Eventual, mai târziu:** marca temporală calificată pe evenimentele-cheie, sigiliul calificat pe documentul final (D9).

| Ce | Unde | Cât |
|---|---|---|
| PDF-ul (b), anexa (c), scanul contrasemnat, manifestul, pozele olografe | `red_pv_semnari`, `red_pv_semnare_olograf` (octeți) | ca PV-ul: până la sfârșitul perioadei de garanție din contract (termenul din informare) + conservare la litigiu |
| Jurnalul de dovezi, contestațiile, textele de acord, fișierele beneficiarului cu telefoane, telefonul pentru cod și proveniența lui | tabelele lor | idem |
| HMAC-urile codurilor, sesiunile | tabelele lor | 7 zile după închiderea cererii, apoi șterse (dovada evenimentelor rămâne în jurnal) |
| Codul criptat pentru expediere | tabel temporar | cel mult 10 minute (§7.11) |
| IP trunchiat / tipul browserului | jurnalul de dovezi | ca jurnalul (D8) |
| Imaginile semnăturilor persoanelor desemnate | `red_pv_semnatura_imagini` | cât e persoana în listă + cât anexele care le folosesc (au hash-ul imaginii) |

**„Doar adăugare” și expirarea retenției:** la expirare, ștergerea e o **operație de întreținere** (preview → „da”-ul owner-ului →
aplicare), cu un rând într-un registru de ștergeri (fără conținut). **Conservarea la litigiu:** un marcaj pe cerere, setat de owner,
suspendă ștergerea. **Copiile de siguranță** ale furnizorului BD păstrează datele șterse cât durează retenția copiilor (de trecut în
informare).

### 7.19 Ce apare în dosarul parcelei și în PV C

- **Fișa parcelei:** cererea, starea, istoricul de dovezi (fără telefon pentru viewer), PDF-ul supus semnării, anexa, scanul
  contrasemnat, contestațiile, butonul „Dosar de dovezi” (§2).
- **Registru / centralizator / export Model_6:** coloană „semnare electronică” cu starea din §7.16, coloana anunțului; coloane noi
  pentru numărul mascat și orele SMS-ului, separat (§2); fără date de contact complete.
- **PV C:** după §7.17 și O9; PV-urile care așteaptă contrasemnarea și contestațiile deschise apar separat.
- **Dosarul predat beneficiarului:** dosarul de dovezi (§2) = rezumatul + documentele suport (convocatorul exact, opisul, AR / retur,
  PV-ul de afișare, PDF-ul acceptat (b), anexa oficială, scanul contrasemnat, manifestul), cu opisul hash-urilor; jurnalul complet la
  cerere.

---

## 8. E-mailul către proprietari

### 8.1 Modelul transmis beneficiarului

Subiect „Predarea terenului după lucrările la conducta de gaze – sesiune la Primăria {COMUNA}”; corpul invită la sesiune, amintește
convocarea scrisă, dă linkul personal de răspuns `{LINK_RASPUNS}`, spune că cine nu poate veni și nu are obiecții primește PV-ul
„spre semnare, electronic”, că mesajul privește doar starea terenului, dă linkul informării și semnătura „în numele și cu
împuternicirea” beneficiarului. Condiții: **doar în plus față de convocarea scrisă; doar la adresa dată de beneficiar sau confirmată
de deținător; un mesaj de persoană; fără date despre parcelă; `{LINK_RASPUNS}` = același link personal ca în QR (D4).**

### 8.2 Ce lipsește din F2

**(1) Necesar pentru orice mesaj, inclusiv cel doar cu link** (convocarea, „PV gata de semnat”, reamintirea):

| Lipsă | Unde se vede |
|---|---|
| Transportul real (oprit în cod: `TRANSPORT_REAL_ACTIV = false`; procesarea refuză din prima instrucțiune) | `redariMailF2.mjs:4`, `:85-86` |
| OAuth de trimitere pe `redari@`, tokenul în Vault, wrapperul Gmail unic | `PLAN_EMAIL_REDARI.md:858-861`, `:884-890` |
| Reconcilierea rezultatelor și monitorizarea „Trimise” | `RAPORT_F2_EMAIL.md:193` |
| Autentificarea expeditorului: DKIM lipsă, DMARC `p=none` fără rapoarte; precondiție F2 = DKIM + DMARC cu rapoarte | `PLAN_EMAIL_REDARI.md:162-165`, `:871` |
| Informarea publicată (garda refuză altfel) | `redariMailF2.mjs:40`; pagina informării, PR #939 |
| Textul validat de Juridic și aprobat de beneficiar | dialogul Juridic din 17.11.2026 |
| Validarea L15 completă, DRY, concurența, apply → rollback → re-apply | `RAPORT_F2_EMAIL.md:85-92`, `:195` |
| Doar pentru „PV gata de semnat” și reamintire: tipurile de mesaj noi (azi loturile au doar convocări) | migrare F2 nouă (S6) |

**(2) Lipsuri generale F2, care NU condiționează un mesaj doar cu link:** generarea / legarea PDF-ului convocatorului și atașamentele
(`redariMailF2.mjs:30`; `RAPORT_F2_EMAIL.md:193`). Mesajele din această specificație **nu** au atașament.

### 8.3 Legătura cu semnarea și riscul cheii comune

- **E-mailul nu e canalul de semnare și nu poartă PV-ul.** Duce doar linkul personal; PV-ul se vede **doar** după codul SMS.
- **Același token ca scrisoarea (D4).** O adresă greșită, o căsuță comună, redirecționarea automată sau o căsuță compromisă dau linkul
  altcuiva. Fără telefon, acela nu semnează, dar vede datele de la §7.8 și poate bloca (T5). Riscul se scrie în informare.
- **Tokenul nu intră în:** urmărirea deschiderilor / clicurilor (fără pixel, fără redirecționare de link), jurnalele funcțiilor edge,
  rapoartele de erori, antetele mesajului (`X-Gazpet-Redari` are doar id-ul mesajului și hash-ul, `redariMailF2.mjs:71-82`), subiectul.
- **Procedura la compromitere:** tokenul e azi imuabil (`20261126a:180`), deci „revocăm linkul” nu există. La pilot: blocarea semnării
  electronice pe deținător (retragerea cererii, revocarea sesiunilor; semnarea continuă la sesiune / PV B). Rotirea tokenului: eventual,
  mai târziu, cu migrare proprie.
- Trei mesaje posibile, toate cu același link: (1) **convocarea** (§8.1); (2) **„PV-ul dumneavoastră e gata de semnat, până la [data]”**;
  (3) **reamintirea** cu 2 zile înainte (O6). (2) și (3): modele noi, de la Juridic, aprobate de beneficiar; în loturi aprobate de owner
  (`redariMailF2.mjs:37-45`); fără trimitere automată.
- Cine s-a dezabonat de la e-mail poate semna în continuare prin QR. Un singur `To`, fără copie (`redariMailF2.mjs:71-82`).

---

## 9. Fișa de securitate (CLAUDE.md pct. 7) și GDPR

**(a) Conținut extern citit:** tot ce tastează sau încarcă deținătorul — codul, numele, obiecțiile, pozele PV-ului semnat de mână,
antetul `User-Agent`; contestația (primită de la deținător și înregistrată de operator, §7.15); fișierul beneficiarului cu telefoane; confirmările de livrare SMS de la furnizor; PDF-ul încărcat de
operator; scanul contrasemnat. Toate sunt **date**: niciun text nu poate porni o acțiune în afara celei alese prin buton și nimic nu e
interpretat automat (pozele nu se citesc cu OCR / AI).

**(b) Ce scrie / face:** cererea și octeții ei, telefonul pentru cod, codurile (HMAC), codul criptat temporar, sesiunile, jurnalul de
dovezi, semnătura Antreprenorului, contestațiile, blocajele, un răspuns nou în `red_raspunsuri` (la refuz), `metoda_semnare` pe PV.
**Trimite SMS-uri** (codul) prin coada SMS, în lotul permanent aprobat de owner — **doar** la telefonul pentru cod. Nu atinge bani,
drepturi de acces sau setări. Trece PV-ul în `semnat` **doar** prin RPC-ul de finalizare al operatorului.

**(c) Identitatea:** RPC-urile publice rulează `SECURITY DEFINER` (ca formularul de azi), cu `search_path` fix, fără `service_role`.
RPC-urile operatorului verifică `auth.uid()` + nivelul Redări pe proiectul PV-ului; semnătura Antreprenorului verifică în plus lista
persoanelor desemnate; corecția telefonului verifică owner-ul, iar lista persoanelor desemnate verifică owner-ul sau
managerul de proiect al proiectului (D14). Funcția existentă care predă SMS-urile
furnizorului (rol de server) citește și codul criptat temporar: singurul loc nou cu acces la el, justificat de expedierea asincronă.
Generarea PDF-ului pe server (S7) are fișă proprie.

**(d) Cine pornește:**
- operatorul: doar admin / editor Redări, verificat în BD; deschiderea cere confirmarea PDF-ului de a doua persoană; semnătura
  Antreprenorului doar persoanele desemnate; corecția telefonului doar owner-ul;
- anonimul: doar cu tokenul personal + o cerere activă; limitele de la §7.7; SMS-ul pleacă doar la telefonul pentru cod. **Cel mai rău
  caz cu un link furat:** câteva SMS-uri la numărul deținătorului (în limite) și **indisponibilizarea semnării electronice** pentru
  acel deținător (T5), cu întoarcere la sesiune / PV B.

**(e) Ce cere confirmare umană:**
- importul fișierului beneficiarului (operatorul, cu nr. adresei) și corecțiile (owner-ul);
- confirmarea PDF-ului și deschiderea fiecărei cereri; acceptarea pozelor olografe; semnătura Antreprenorului (persoana desemnată, cu
  confirmare explicită pe lista de PV-uri); finalizarea; deciziile pe contestații; deblocarea unui deținător;
- **regula tare din pct. 7 se aplică** (citește conținut extern și trimite SMS): porțile sunt lotul permanent `redari_cod` aprobat de
  owner (șablon fix, plafoane, valabilitate), comutatorul Redări pornit de owner după autorizarea scrisă a beneficiarului, și cererea
  deschisă de un om;
- pornirea comutatorului SMS Redări, aprobarea lotului permanent, orice lot de e-mail — ca azi, doar owner-ul.

Toată automatizarea nouă primește rând în `public.automatizari` și în `registru_automatizari` la livrare (fără valori de secrete).

**GDPR — date noi prelucrate:**

| Dată | Propunere | De validat |
|---|---|---|
| Codul SMS | HMAC, șters la 7 zile după închiderea cererii; în clar doar criptat, cel mult 10 minute; niciodată în jurnale | — |
| Telefonul pentru cod și fișierul beneficiarului | Telefonul exista deja la beneficiar / în evidență; nou: fișierul păstrat, sursa, cine l-a importat / corectat | — |
| HMAC-ul telefonului, cifrele mascate | **Rămân date personale** (pseudonimizate) | — |
| Sesiunile de acces, istoricul accesării documentului | hash-ul cheii, legăturile, orele | — |
| Identificatorii SMS / DLR | id-ul mesajului, id-ul furnizorului, stările, orele (fără payload brut, ca azi) | — |
| IP + browser | **D8:** IP trunchiat (IPv4 la /24, IPv6 la /48) + familia browserului și a sistemului, derivate pe server; `User-Agent` complet nepăstrat. (Formularul de azi păstrează IP-ul complet, `20261126a:221-225`; neschimbat aici.) | — |
| Numele tastat, acordul (text integral), ora | Parte din dovadă | — |
| Pozele PV-ului semnat de mână (D2) | Octeți, cât PV-ul | informarea |
| Numele, funcția și imaginea semnăturii persoanelor desemnate de Antreprenor | Date ale angajaților; informare internă | informarea internă |
| Contestațiile | textul, ora, canalul, decizia | — |
| PV-ul afișat online | Doar după cod; fără cache public; tokenul nu ajunge în `Referer` (`RedariRaspunsPublic.jsx:112-120`) și e mascat în rapoartele de erori | — |

Ce trebuie adăugat în informare: §10. Cât timp informarea nu e publicată, fluxul nu pornește pe date reale.

---

## 10. Ce trebuie să spună documentele trimise beneficiarului (cerințe, nu texte)

Textele le scrie Juridic; aici e doar ce trebuie să acopere, ca fluxul de mai sus să fie cel anunțat.

**Planul procedurii (pct. 4.4) și convocatorul:**
- semnarea de la distanță se face electronic, prin **același link personal** din convocare, cu un **cod primit prin SMS** la numărul
  comunicat de beneficiar;
- **fereastra de 7 zile de la punerea la dispoziție a procesului-verbal** (formularea din plan; = deschiderea cererii, §7.2), cu
  data și ora exactă afișate pe pagina de semnare; anunțul (e-mail) e separat și nu mută termenul; la expirare, parcela se finalizează
  prin **PV tip B**;
- codul se poate cere **la orice oră** cât PV-ul e în fereastră (D13; celelalte SMS-uri rămân 08–20), până la termen;
- **rezerva:** PV-ul tipărit, semnat de mână, fotografiat și încărcat prin același link, în aceeași fereastră; dacă nici așa, sesiunea sau
  PV B;
- **contrasemnarea:** Antreprenorul semnează din platformă, prin persoana desemnată; reprezentantul beneficiarului contrasemnează la
  următoarea zi de sesiune, în lot — **cu întrebarea explicită dacă beneficiarul acceptă această formă** (O2) și dacă vrea o zi de
  contrasemnare când nu mai sunt zile de sesiune (O3);
- fraza „aceeași valoare ca unul semnat la sesiune” rămâne (D1);
- **telefoanele pentru cod vin doar de la beneficiar:** cererea ca beneficiarul să trimită în scris (fișier) orice corecție de telefon;
- ce primește beneficiarul la final: dosarul de dovezi (§2) — rezumatul și documentele suport, inclusiv PDF-ul acceptat și anexa
  contrasemnată;
- contestația după semnare se face prin contactul proiectului (§7.15), nu prin link.

**Informarea (GDPR), completată (O4):** scopul nou (semnarea electronică a PV-ului și păstrarea dovezilor); temeiul (Juridic); datele noi
din §9 (telefonul pentru cod, codul, evenimentele semnării, IP trunchiat și tipul browserului, numele tastat, pozele olografe);
destinatarii (furnizorul SMS, furnizorul BD / găzduirii, furnizorul de e-mail dacă se trimite anunțul); eventualele transferuri în afara
SEE (de verificat); duratele (§7.18), inclusiv copiile de siguranță și conservarea la litigiu; cui se adresează deținătorul pentru
drepturile lui.

**Acordul de prelucrare / împuternicirea beneficiar → Antreprenor:** să acopere trimiterea codurilor prin SMS și furnizorul SMS (ca
furnizor al Antreprenorului), păstrarea dovezilor semnării și durata, ce se predă beneficiarului la final; **autorizarea scrisă pentru
SMS** să numească și categoria „cod de semnare” (O5), pe lângă convocări.

**Modelul de SMS cu cod:** un segment GSM-7; **fără link** (D4), fără nume, fără date despre parcelă; expeditorul identificabil (Gazpet
pentru Transgaz); codul și valabilitatea (10 minute); „nu dați codul nimănui; nu vi-l cerem la telefon”; numărul de contact; aprobat de
beneficiar odată cu autorizarea scrisă.

**E-mailul „PV gata de semnat” și reamintirea (dacă se folosesc, O6):** același link personal, termenul (calculat de la punerea la
dispoziție, nu de la data e-mailului), fără atașament, fără date despre parcelă, doar în plus față de scrisoare. Reamintirea nu pleacă
pe SMS (D4: pe SMS doar codul).

**Modelul PV A:** mențiunile pentru semnarea de la distanță (§7.17); modelul a fost deja trimis, deci schimbarea se trimite din nou.

---

## 11. Etapele de livrare

Fiecare felie = branch + PR draft + review (Jakarinos + Fable / Copilot) + migrare proprie cu revenire și test (apply → rollback →
re-apply pe clonă, făcut de chat) acolo unde există. **Orice migrare, RPC sau modificare de drepturi cere acordul proprietarului.**
Estimările sunt orientative, **fără rundele de review** (istoric 2–5 runde pe migrare în Redări).

Reguli comune:
- **întâi proba sintetică**, cu transport inert (simulatorul SMS, transportul F2 oprit), pe PGlite și pe clonă (roluri reale, FK reale,
  două sesiuni PostgreSQL pentru concurență, RLS ca non-owner, L25); abia după ea probele cu numere interne;
- feliile cu termene se probează cu **ceas controlat** (cod, sesiune, fereastra de 7 zile cu exemplele de la §7.2, inclusiv deschiderea
  după 20:00, codul cerut noaptea și la 19:59 în ziua termenului, refuzul după 20:00 în ziua termenului, reamintirea) și
  **transport controlat** (simulatorul furnizorului, inclusiv timeout și DLR întârziat);
- nimic publicat care promite semnarea înainte ca fluxul să meargă cap-coadă pe proiectul de test;
- **activarea** SMS-ului (`redari_cod`) și a e-mailului (F2) sunt acte separate ale owner-ului, după acordurile scrise; nicio felie nu le
  pornește.

| Felie | Ce conține | Migrare | Depinde de | Estimare | Proba (întâi sintetică), apoi |
|---|---|---|---|---|---|
| **S0 — texte și documente** | Documentele către beneficiar (§10), textele (acord, anexă, SMS, pagina de semnare, model PV A), deciziile O1–O7, O9 | — | Juridic, beneficiar | 0,5–1 zi după texte | — |
| **S1 — cererea + codul + acceptarea** (prima felie utilă) | Tabelele (inclusiv cele ale lanțului de dovezi și ale anexei, folosite apoi de S3), importul telefoanelor (§7.4), încărcarea și confirmarea PDF-ului legată de amprenta registrului (§7.5), gărzile pe PV (R1–R3) și pe telefon, RPC-urile operatorului (deschide / retrage / blochează) și publice (stare, cere cod **cu transport inert** și cheie de intenție, verifică, document, semnează, refuză), secțiunea de semnare din pagina publică, limitele, termenele (§7.2), schimbarea regulii 3 (JS + SQL, paritate); starea în fișa parcelei | da | „da”-ul pe specificație | 5–7 zile | PGlite + DRY pe clonă (roluri, gărzi pe PATCH direct, concurență cu două sesiuni); ceas controlat; atacuri: token greșit, cod ghicit, cod reutilizat, sesiune veche pe cerere nouă, două semnări, blocare, telefon schimbat în timpul cererii, **PV schimbat între confirmare și deschidere (refuz)**, cerere de cod reluată cu aceeași cheie (un singur cod); pe `TEST-…` operatorul vede codul în ERP (gardă în BD pe codul proiectului); apoi Playwright pe proiectul de test Redări cu gardă de rețea |
| **S2 — codul pe SMS** | Categoria `redari_cod`, lotul permanent, **adaptările cozii de la §7.11** (unicitatea pe `cod_id`, inserarea în lotul permanent aprobat, fără `coada_golita` pentru el, selecția automată care îl sare când e gol, rezervarea individuală, textul compus din șablon, excepția de orar doar pentru cod, D13), codul criptat temporar și ștergerea lui, legătura cu DLR și evenimentele „cod acceptat de furnizor / livrare raportată / rezultat necunoscut” | da (modulul SMS) | S1, O5, autorizarea scrisă | 2–3 zile | Simulatorul furnizorului (inclusiv timeout și DLR întârziat); probe negative pe loturile obișnuite (aceleași reguli ca azi); apoi pe `TEST-…`, cel mult 5 numere interne, cu „da”-ul owner-ului pentru comutator |
| **S3 — semnătura Antreprenorului din ERP + contrasemnarea + finalizarea** | Lista persoanelor desemnate, imaginea semnăturii, semnarea în lot, documentul canonic și anexa oficială (§7.5), lista pentru ziua de sesiune cu data efectiv disponibilă, încărcarea scanului cu verificarea vizuală consemnată, finalizarea, manifestul; contestația prin operator și regula de acoperire (O7); PV C (O9); **interfața minimă** pentru selecție, confirmare, atașare, lista zilei și scan | da | S1, O1–O3, O7, O9 | 4–6 zile | Loturi suprapuse, CAS, anexă lipsă / regenerată, anexă cu alt hash de conținut (refuz), anexă cu pagini diferite și hash corect (acceptată tehnic; lista zilei nu se descarcă fără confirmarea operatorului pe fiecare anexă), înlocuire după tipărire (refuz), DLR sosit după semnătura Antreprenorului (prefixul rămâne valid), semnătură după tipărirea listei zilei (trece la următoarea dată), persoană retrasă din listă; cap-coadă pe proiectul de test |
| **S4 — ecranul „Semnări la distanță” + dosarul de dovezi** (felia de interfață) | Vederea de urmărire (stările și coloanele anunț / cod, §7.16), ecranul pe UAT / tronson, listele și acțiunile, alertele; dosarul de dovezi (rezumatul pe pagini + documentele suport, export Model_6); scanul PV-ului de afișare | da (vedere) | S3 | 3–4 zile | Paritatea stărilor (L19) pe un tabel de cazuri, inclusiv „anunț netrimis” și cererea expirată necitită; numere mari (keyset); istoric care nu încape pe o pagină; codul absent din export; eroare ≠ zero |
| **S5 — rezerva olografă** (**condiție a pilotului**) | Încărcarea prin link, verificarea operatorului, metoda `olograf_distanta` | da (mică) | S1, S3 | 2 zile | Fișiere ostile (PDF poliglot, imagine imensă, tip fals); respingere + reîncărcare în fereastră |
| **S6 — e-mailul „PV gata” + reamintirea** | Tipurile de mesaj în F2 | da (în lanțul F2) | F2 activ (§8.2 (1)), O6 | 1 zi după F2 | Transport inert; apoi doar adrese interne |
| **S7 — PDF-ul generat direct din platformă** | Serviciul de server care produce PDF-ul din registru și **anexa oficială** din documentul canonic (clientul nu mai trimite octeți); pasul de confirmare a PDF-ului și confirmarea anexei la lista zilei dispar | da | S1 | 4–6 zile | Paritate conținut registru ↔ PDF pe proiectul de test |
| **Pilot** | Un UAT, câțiva deținători care au ales opțiunea, cu „da”-ul owner-ului pe fiecare pas | — | **S0–S5** (rezerva olografă e condiție: pilotul cu deținători nu începe fără ea), O4, O5 | — | — |

Ce **nu** se poate proba fără date reale: livrarea SMS la numere de proprietari, comportamentul oamenilor (abandon, telefoane comune),
acceptarea de către beneficiar a documentului final.

---

## 12. Propuneri implicite și întrebări pentru avocat

### 12.1 Propuneri implicite (se aplică dacă proprietarul nu spune altfel)

| Subiect | Propunerea | Eventual, mai târziu |
|---|---|---|
| Cifre din telefon înainte de cod (fostul D13) | Niciuna („codul pleacă la numărul comunicat de beneficiar”) | — |
| Link compromis (fostul D15) | Blocarea semnării electronice pe deținător; semnarea continuă la sesiune / PV B | Rotirea tokenului (link nou), cu migrare proprie |
| Calea veche (fostul D17) | R1 + R2 în BD, R3 doar în UI (§7.3) | R3 în BD pentru PV-urile A create după o dată |
| Fișierele fluxului (fostul D20) | Octeți în BD (§7.11) | — |
| Limitele | Tabelul de la §7.7 | — |
| PDF-ul de la operator | Confirmarea unei a doua persoane, legată de amprenta versiunii registrului văzute (§7.5) | Dispare la S7 |
| Telefonul pentru cod | Import + corecție de owner (§7.4) | Citirea fișierului pe server; aprobarea fiecărui import de către owner |
| Anexa oficială | Generată în navigator din documentul canonic; paginile verificate de operator la lista zilei, consemnat (§7.5) | Generată de server (S7) |
| Integritatea | Lanțul de hash-uri, prefixul tipărit în anexa oficială (§7.5, §7.18) | Marcă temporală calificată; sigiliu calificat |
| Scanul contrasemnat | Încărcat pe PV, cu verificarea vizuală a operatorului consemnată (§7.12) | Teancul dintr-un PDF, împărțit pe PV-uri |
| Contestația după finalizare | Doar prin operator (§7.15) | — |
| Identificarea | Ce e decis (link + cod la telefonul beneficiarului) | Orice mecanism mai tare (identificare video, semnătură avansată) — doar dacă o cere beneficiarul |

### 12.2 Întrebări pentru avocat / Juridic (informative, nu blochează)

Proprietarul a decis varianta și rezerva (D1, D2); răspunsurile de mai jos pot ajusta **textele** (acord, anexă, informare, model PV),
nu alegerea.
1. **Î1.** Cum se încadrează, după Legea nr. 214/2024 și Codul civil, un PV semnat prin link personal + cod SMS, și ce formulare a frazei
   „aceeași valoare ca unul semnat la sesiune” o reflectă cel mai bine?
2. **Î2.** Condiția din acordul de mediu („recepția redării semnată de proprietar și beneficiar”) cere ceva anume în dosar?
3. **Î3.** Ce trebuie să conțină anexa de semnare ca să fie utilă în fața beneficiarului sau a unei instanțe?
4. **Î4.** Ce valoare are poza PV-ului semnat de mână (rezerva) și trebuie cerut ulterior originalul?
5. **Î5.** Moștenitorii și coproprietarii: ce mențiune intră în PV la secțiunea 2 când semnează la distanță?
6. **Î6.** Retragerea consimțământului după semnare și contestația înainte / după contrasemnare: ce efect au și cum se consemnează?
7. **Î7.** Ce trebuie scris în anexă despre ce **nu** dovedește semnarea (§6.1)?
8. **Î8.** Schimbarea modelului PV A (secțiunile 2, 4, 7) cere un nou acord al beneficiarului, fiind deja trimis?
9. **Î9.** Data PV-ului: a semnăturii deținătorului sau a ultimei contrasemnături? (Propunerea tehnică: `semnat_primit_data` = data
   contrasemnării beneficiarului; data semnăturii deținătorului rămâne în anexă.)
10. **Î10.** Reprezentarea (procură) și conflictul proprietar–utilizator (O7).
11. **Î11.** Cine păstrează dosarul probator după încheierea contractului cu beneficiarul, și cât?
12. **Î12.** Rolurile față de datele personale (beneficiar, Antreprenor, furnizorul SMS, furnizorul BD) și ce trebuie scris în informare
    despre exercitarea drepturilor.

---

## 13. Lecțiile L01–L25 (cum le respectă specificația)

Specificația nu are cod; regulile se aplică proiectării și devin criterii de acceptare pentru feliile S1–S7.

| Regulă | Unde |
|---|---|
| L01 | Lock înainte de verificări pe toate căile, inclusiv refuzul și lotul Antreprenorului; contorul de încercări incrementat înainte de comparare; CAS pe `versiune` la retragere, semnătura Antreprenorului, finalizare (§7.6, §7.10, §7.12) |
| L02 | Deschidere, semnare, refuz, încărcare olografă, semnătura Antreprenorului (lotul întreg), finalizare: fiecare într-un singur RPC; octeții în aceeași tranzacție cu scrierea (§7.9, §7.11, §7.12) |
| L03 | Deschiderea doar dacă hash-ul PDF-ului și amprenta registrului sunt exact cele confirmate (altfel confirmarea e invalidată); semnătura Antreprenorului și finalizarea doar dacă amprenta PV-ului și hash-ul PDF-ului sunt cele legate de cerere, iar prefixul tipărit e în lanț și lanțul continuă corect până la cap; anexa atașată doar pentru hash-ul conținutului fixat de server, paginile ei verificate de om la lista zilei (§7.5) |
| L04 | Cheie UUID per intenție la import, încărcarea / confirmarea PDF-ului, deschidere, **cererea de cod**, semnare, refuz, încărcare olografă, lot Antreprenor, anexă, lista zilei, finalizare; aceeași cheie + alt conținut = refuz (§7.6, §7.9) |
| L05 | Rezultat ambiguu → reapel cu aceeași cheie / recitire; fără ștergere compensatorie, fără retrimiterea SMS-ului `necunoscut`; anexa lipsă se regenerează, nu se ghicește (§7.10, §7.11, §7.12) |
| L06 | Ordinea completă: contoare publice → telefoane → lock consultativ pe telefon → PV-uri → cereri → coduri / sesiuni → contoare persistente → coada SMS; importul și lotul Antreprenorului în același sens; lock-urile implicite numărate (§7.10) |
| L07 | Gărzi în BD pe PV (R1–R3, și după închiderea cererii) și pe telefon; scrierile doar prin RPC (§7.3, §7.9) |
| L08 | Operator și persoana desemnată din `auth.uid()`; numele / funcția copiate de server; proveniența telefonului și `metoda_semnare` setate de server, imuabile; anonim doar prin token (§7.3, §7.4, §7.12) |
| L09 | Nivelul Redări verificat pe proiectul fiecărui PV / deținător atins, inclusiv în lot (§7.9, §7.12) |
| L10 | Codul ca HMAC cu secret propriu; în clar doar criptat ≤ 10 minute; sesiunea ca hash; nimic în jurnale; serviciul PDF din S7 cu secret propriu (§7.5, §7.6, §7.11) |
| L11 | n/a (fără extragere; pozele nu se citesc automat) |
| L12 | Refuzurile au motiv din listă închisă; lotul refuzat arată ce PV-uri s-au schimbat; rezumatul dosarului continuă pe pagini, documentele suport lipsă apar ca „lipsește din platformă”; nimic nu dispare tacit (§2, §7.9, §7.10) |
| L13 | Formatul tokenului / codului / hash-ului ancorat (`^…$`), testat pozitiv și negativ (§7.9) |
| L14 | O migrare pe felie, cu revenire și probă apply → rollback → re-apply (§11) |
| L15 | S1, S3, S4 schimbă vederi, triggere și RPC-uri publice: amprenta globală și manifestul, ca la celelalte migrări Redări (§11) |
| L16 | UNIQUE parțial „o cerere activă pe PV”; un singur cod activ pe cerere; UNIQUE (cerere, cheie de intenție) la cod; în coada SMS, `cod_id` UNIQUE și `(lot_id, telefon)` păstrat pentru loturile obișnuite (§7.11); o versiune activă de telefon pe deținător; o singură anexă oficială pe cerere; identitatea documentului = SHA-256 pe octeți (§7.3, §7.4, §7.5, §7.6) |
| L17 | O singură regulă de termen (data locală a deschiderii + 7 zile, ora 20:00, Europe/Bucharest), cu exemplele de la §7.2 (inclusiv deschiderea după 20:00); expirările pe timestamp exact; codul la orice oră până la termen, celelalte SMS-uri 08–20 (D13); probate cu ceas controlat (§7.2, §11) |
| L18 | Eroare ≠ „nu există PV de semnat” și ≠ „zero” în ecranul de urmărire; „anunț netrimis” și „rezultat necunoscut” ≠ trimis; orele lipsă = „—”, nu presupuse (§2, §7.8, §7.11, §7.16) |
| L19 | Starea parcelei, regula de acoperire și stările din ecranul de urmărire: o singură definiție, cu test de paritate JS / SQL (§7.3, §7.16) |
| L20 | Tranzițiile cererii dintr-un tabel; teste pe căile legitime (retragere, refuz, expirare, blocare, respingerea pozei, contestație) (§7.3) |
| L21, L22 | n/a (fără AI) |
| L23 | Listele de cereri / dovezi / ecranul de urmărire citite cu keyset (§7.9, §7.16) |
| L24 | Pagina publică: token de generație la schimbarea linkului, ca formularul de azi (`RedariRaspunsPublic.jsx:109-110`); rezultatele legate și de cerere / hash; ecranul de urmărire cu token de generație la schimbarea filtrelor (§7.6, §7.16) |
| L25 | Probe ca `anon` și ca non-owner, două sesiuni reale pentru concurență, fixture-uri cu FK reale, ceas și transport controlate (§11) |

---

## 14. Istoric

- **17.11.2026, r1** — prima versiune (PR #1116, draft).
- **17.11.2026, r2** — după review-ul documentului: deciziile de dinaintea primei felii, modelul de amenințări și proveniența telefonului,
  lanțul documentelor cu hash calculat de server, contractul codului și al sesiunii de acces, limitele persistente, ce se vede înainte de
  cod, calea veche de semnare, ordinea lock-urilor, SMS-ul cu cod și octeții în BD, contestația, „nemodificabil prin aplicație”, riscul
  cheii comune în e-mail, fișa și GDPR, întrebările pentru avocat; corecturile din starea de azi.
- **17.11.2026, r3** — intră deciziile proprietarului D1–D12 (§1): semnătura simplă ca variantă principală, cu riscurile asumate (§6.1);
  rezerva olografă păstrată (§7.13); codul doar la telefoanele beneficiarului (§7.4); semnătura Antreprenorului din ERP și contrasemnarea
  beneficiarului la ziua de sesiune (§7.12); fereastra de 7 zile și termenele dependente (§7.2); fără semnătură desenată, IP trunchiat,
  fără sigiliu calificat la pilot. Secțiuni noi: „Ce putem dovedi” și dosarul de dovezi (§2), ecranul „Semnări la distanță” (§7.16), ce
  trebuie să spună documentele către beneficiar (§10). „Ce trebuie decis” refăcut (§3, O1–O7); feliile reordonate (§11); întrebările
  pentru avocat devin informative (§12.2). Scoase: verificarea SIM-ului și a păstrării textelor la furnizorul SMS, confirmarea
  telefonului de a doua persoană (înlocuită de D3), semnătura desenată.
- **17.11.2026, r4** — după re-review-ul rundei 3 (GO cu condiții pentru document): confirmarea PDF-ului legată de amprenta versiunii
  registrului, cu refuz la deschidere dacă PV-ul s-a schimbat (§7.5); anexa oficială cu conținut fixat de server, o singură versiune
  tipărită, înghețată la prima tipărire, prefixul lanțului în locul capului (§7.5, §7.12, §7.18); verificarea vizuală a scanului
  consemnată ca risc asumat (§6.1); rezerva olografă (S5) condiție a pilotului (§11); o singură regulă de termen, de la punerea la
  dispoziție, cu exemplu calendaristic (§7.2, §10); orarul codului prezentat ca decizie deschisă O8 (§3, §7.2); contestația după
  finalizare doar prin operator (§7.15); adaptările cozii SMS și cheia de intenție la cererea de cod (§7.6, §7.11); stările „PV
  disponibil / anunț expediat / cod acceptat / livrare raportată” în locul lui „Trimis”, cu cele trei ore SMS separate (§2, §7.16);
  dosarul de dovezi cu documentele suport și continuare pe pagini, fără cod (§2); O1, O6 curățate, O8, O9 adăugate, O7 înainte de S3
  (§3); operatorul poate fi și semnatarul Antreprenorului (§6.1, §7.12); următoarea dată de contrasemnare efectiv disponibilă (§7.12).
- **17.11.2026, r5** — după re-review-ul rundei 4 (GO cu condiții pentru document): anexa oficială rămâne generată în navigator la
  pilot, iar garanția e delimitată — serverul fixează conținutul canonic și amprenta lui, corespondența paginilor PDF-ului o verifică
  operatorul la descărcarea listei zilei (confirmare consemnată pe fiecare anexă) și reprezentantul care contrasemnează; dosarul
  afișează conținutul canonic din BD; riscul rămas scris; anexa generată de server trece în S7 (§2, §6.1, §7.5, §7.9, §7.12, §11);
  lista persoanelor desemnate: până la decizia O1 doar owner-ul (§3, §7.1, §7.9, §7.12, §9); orarul codului decis (D13: codul la
  orice oră, celelalte SMS-uri 08–20; fără limita separată a ultimului cod), scos din lista de decis (§1, §3, §7.2, §7.11, §7.17, §10,
  §11).
- **17.11.2026, completare după r5** — administrarea listei persoanelor care semnează pentru Antreprenor e decisă de proprietar: owner-ul și managerul de proiect (D14); O1 rămâne doar pentru numirea persoanelor (§1, §3, §7.1, §7.9, §7.12, §9).
