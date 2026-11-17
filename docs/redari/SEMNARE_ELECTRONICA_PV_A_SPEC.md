# Redări Lot 1 — semnarea electronică de la distanță a PV-ului tip A + e-mailul către proprietari (SPECIFICAȚIE)

Stare: 17.11.2026, runda 2 (după review-ul documentului). **Doar document.** Nu există cod, migrare sau schimbare de date în acest PR.
Nimic de aici nu e aprobat: fiecare alegere marcată „de decis” o ia proprietarul (Răzvan), iar fiecare întrebare juridică o lămurește
avocatul / Juridic. **Documentul nu afirmă că vreo variantă e legală sau valabilă.** Orice migrare, RPC sau modificare de drepturi
propusă aici **necesită acordul proprietarului** înainte de implementare și se livrează în felii separate, cu review propriu.

Cuprins: 0. De ce · 1. Ce trebuie decis înainte de prima felie de cod · 2. Starea de azi · 3. Variantele · 4. Recomandarea și
modelul de amenințări · 5. Proiectarea variantei recomandate · 6. E-mailul către proprietari · 7. Fișa de securitate și GDPR ·
8. Etapele de livrare · 9. De decis și întrebări pentru avocat · 10. Lecțiile L01–L25 · 11. Istoric.

Termeni folosiți: **cerere** = cererea de semnare electronică a unui PV A; **sesiune de acces** = cheia scurtă primită de deținător după
ce introduce corect codul SMS (nu are legătură cu „sesiunea la primărie”); **nemodificabil prin aplicație** = nu poate fi schimbat de
rolurile aplicației (anonim, utilizator autentificat, inclusiv admin / editor Redări, și funcțiile edge ale aplicației) — **nu** și de
administratorul bazei de date sau de o restaurare din copie (vezi §5.14).

---

## 0. De ce

Planul procedurii de predare a terenurilor (rev. 1, trimis beneficiarului) spune la pct. 4.4 că deținătorul poate alege, în formularul
online, opțiunea:

> „Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.”

și continuă: Antreprenorul generează din registru PV-ul tip A completat și îl transmite proprietarului spre semnare, electronic.
„PV-ul semnat astfel are aceeași valoare ca unul semnat la sesiune. Declarația online singură e probă a lipsei obiecțiilor, nu ține
locul semnăturii.” Aceeași frază apare în modelul de convocator (rev. 1) și în modelul de e-mail către proprietari trimis
beneficiarului.

**Decizia proprietarului din 17.11.2026 (închisă, nu se mai redeschide aici):** semnarea de la distanță se face **doar electronic**;
PV-ul nu se mai trimite spre semnare prin poștă; proprietarii fără e-mail / fără telefon cu internet rămân la sesiunea de la primărie
sau la PV-ul tip B. Alinierea textului opțiunii din formularul public și a convocatoarelor e în lucru separat (PR #1117, draft).

**În platformă nu există azi niciun flux de semnare electronică**, iar e-mailul către proprietari (felia F2) e construit doar parțial și
are transportul oprit. Specificația descrie ce ar trebui construit, ce variante există, ce recomandăm și ce trebuie decis înainte de
prima linie de cod.

---

## 1. Ce trebuie decis înainte de prima felie de cod

Șapte decizii. Fără ele, nicio felie cu migrare nu începe. Detaliile sunt în secțiunile indicate; lista completă de decizii e la §9.1.

| # | Decizia | A | B | Recomandare |
|---|---|---|---|---|
| 1 | **Metoda principală și rezerva**, în cadrul deciziei „doar electronic” (§3, §4) | Semnătură simplă în platformă (link personal + cod SMS) **și** rezerva „PV semnat de mână, fotografiat, încărcat prin link” (varianta B din §3) | **Doar** semnătura în platformă; cine nu o poate folosi merge la sesiune sau la PV B (exact textul deciziei din 17.11) | **B.** Rezerva olografă cere oricum telefon cu internet și cod (PV-ul are date personale), deci acoperă foarte puțini oameni și lasă cea mai slabă dovadă; dacă avocatul o cere, se adaugă ca felie separată (S6). Precondiție în ambele variante: textele aprobate (formular, acord, SMS, pagina de dovezi) și acceptarea scrisă a beneficiarului. |
| 2 | **Identificarea și proveniența telefonului; protecția față de operatorul intern** (§4.2, §5.4) | Telefonul se poate folosi pentru cod doar dacă are proveniență verificabilă (importul beneficiarului sau corecție scrisă a beneficiarului) **și** e confirmat de o a doua persoană; cel care deschide cererea nu e cel care a introdus / modificat telefonul | Orice telefon din evidență, cu jurnal, fără separarea responsabilităților; riscul fraudei interne **acceptat explicit în scris** de proprietar | **A.** Dacă echipa Redări e prea mică pentru doi oameni diferiți la fiecare cerere, B devine o alegere conștientă a proprietarului, nu o scăpare. |
| 3 | **Contractul documentelor și al dovezilor** (§5.3, §5.14) | PDF-ul supus acordului se păstrează ca octeți în BD, hash calculat de server; documentul final = PDF-ul acceptat neschimbat + anexa de dovezi (cu hash-urile) contrasemnată; garanția = „nemodificabil prin aplicație” + lanț de hash-uri, fără ancoră externă | Ca A + **ancoră independentă** a lanțului de dovezi (marcă temporală calificată pe fiecare eveniment-cheie: semnare, refuz, finalizare) | **A la pilot**, cu riscul rămas scris în dosar; **B** dacă avocatul (Î3) spune că dosarul trebuie să reziste și la contestarea integrității infrastructurii. B are cost per marcă temporală (de cerut ofertă). |
| 4 | **Codurile, sesiunile, limitele, linkul compromis** (§5.5, §5.6, §6.3) | Contractul de la §5.5 + limitele persistente de la §5.6; la link compromis se **blochează semnarea electronică pe deținător** (un comutator nou, simplu); semnarea continuă la sesiune | Ca A + **rotirea tokenului** (link nou, scrisoare nouă) | **A la pilot.** Tokenul e azi imuabil (`20261126a:180`); rotirea lui schimbă un mecanism existent și cere migrare proprie. |
| 5 | **Semnatarii necesari și contestațiile** (§5.11, §5.12) | Contestația e un obiect separat (nu șterge dovada); cât e deschisă, PV-ul nu mai acoperă parcela în centralizator / PV C; semnătura utilizatorului **nu** închide parcela cât un proprietar are obiecții / contestație deschise | Contestația doar se consemnează; regulile de acoperire rămân ca azi | **A**, cu întrebările Î7, Î12, Î13 la avocat. Atinge regula de acoperire (`20261130n:198-214`, `pv.js:229-235`): migrare proprie, cu paritate JS / SQL. |
| 6 | **Retenția, datele tehnice, informarea** (§7) | Minimul: IP trunchiat + familia browserului; retenție = cea a PV-ului; informarea completată înainte de orice date reale | IP complet + browser complet, păstrate până la expirarea termenului de contestare, apoi trunchiate | **A**, dacă avocatul nu cere B pentru valoarea probatorie (Î8). |
| 7 | **Autorizarea SMS-ului cu cod și porțile de activare** (§5.10) | Categorie SMS nouă „cod de semnare”, cu un **lot permanent** pe proiect aprobat o dată de proprietar (șablon versionat, plafoane, dată de expirare), sub aceleași porți (comutatorul general, comutatorul Redări, autorizarea Transgaz, intervalul 08–20) | Fiecare cod aprobat individual (inutilizabil pentru un cod valabil 10 minute) | **A.** Activarea SMS și a e-mailului rămân acte separate ale proprietarului, după acordurile scrise. |

**Reguli pentru felii (§8):** S1 nu publică nimic care promite un flux încă indisponibil; fiecare felie are întâi proba sintetică, cu
transport inert (simulatorul SMS, transportul F2 oprit); S3 și S5 se probează cu ceas și transport controlate; activarea SMS-ului și a
e-mailului rămâne separată, după acorduri. Orice migrare, RPC sau modificare de drepturi cere acordul proprietarului.

---

## 2. Starea de azi (cu fișier:rând, verificat pe `origin/main` la 17.11.2026)

### 2.1 Ce se întâmplă după opțiunea „nu particip, fără obiecții”

1. **Formularul public** (`src/RedariRaspunsPublic.jsx`) înregistrează răspunsul prin RPC-ul `fn_red_raspuns_public`
   (`supabase/migrations/20261126a_redari_teren.sql:724-781`). Pentru această opțiune cere bifarea declarației
   (`RedariRaspunsPublic.jsx:152`, garda în BD la `20261126a:760` și în trigger la `:457`).
   - **Textul de azi nu spune nimic despre semnarea electronică.** Descrierea opțiunii: „Sunt de acord ca procesul-verbal să fie
     întocmit în lipsa mea.” (`RedariRaspunsPublic.jsx:21`); declarația implicită: „… sunt de acord ca procesul-verbal să fie întocmit
     în lipsa mea.” (`:26`). Declarația se poate înlocui pe proiect din `red_proiecte.text_declaratie` (`:141`); ce text are proiectul
     real nu verificăm aici (se citește din BD de chat). Alinierea cu decizia din 17.11: PR #1117 (draft).
   - **Decizia 6** (01.11): răspunsul nu trimite nimic și nu generează PV; operatorul face totul din Registru (`RedariRaspunsPublic.jsx:10`,
     `docs/redari/README.md:115`).
2. **Starea perechii (parcelă, deținător)** devine „A răspuns — fără obiecții” (`src/redari/stare.js:103`, rangul 5 din `:14`).
3. **PV-ul A** îl creează și îl generează operatorul (admin / editor) din fișa parcelei: `ModalPv.jsx` → `fn_red_pv_creeaza`, apoi
   „Generează DOCX” (`src/redari/ui/ModalPv.jsx:191-222`). Rezultatul e un **DOCX** în bucketul `redari`, versionat pe cale
   (`src/redari/pv.js:314-327`, `:375-392`), legat de rând prin `fisier_generat_path`. Nu există conversie DOCX → PDF în platformă.
4. **„Trimis spre semnare”** = un buton care schimbă doar starea și data (`ModalPv.jsx:325`, `:247`). Nu trimite nimic, nu
   leagă nicio dovadă. Starea parcelei devine „PV trimis spre semnare” (`stare.js:97`, rangul 3).
5. **„Semnat”** = operatorul încarcă un scan PDF / JPG / PNG (`ModalPv.jsx:248-260`, `pv.js:328-340`), cu bifele „Semnat fizic” și
   „Semnat la sesiune” (`ModalPv.jsx:327-328`), printr-o actualizare directă a rândului cu CAS (`ModalPv.jsx:263-265`). Baza de date cere
   pentru `semnat` data primirii și calea scanului (`supabase/migrations/20261129c_redari_pv_stari.sql:35-37`). După `semnat` / `anulat`
   rândul e înghețat, **cu o excepție: `remediat_la`** (urmărirea obiecțiilor) rămâne modificabil (`20261129c:21-24`); identitatea PV-ului
   nu se schimbă niciodată (`:17-20`). Tranzițiile permise: `generat → trimis_spre_semnare | semnat | anulat`,
   `trimis_spre_semnare → semnat | anulat` (`:26-27`). Nu există tranziție din `semnat`.
6. **PV C pe tronson numără PARCELE**, nu PV-uri: o parcelă intră la „PV A la sesiune” dacă are **cel puțin un** PV A semnat cu
   `semnat_la_sesiune = true`, altfel la „corespondență” (`pv.js:398-402`; coloana din `20261129a_redari_pv_schema.sql:37`). Deci o
   parcelă cu un coproprietar semnat la sesiune și altul semnat electronic apare la „sesiune”; o parcelă semnată doar electronic ar
   apărea azi la „corespondență”.
7. **Acoperirea parcelei prin PV A** (`fn_red_parcela_acoperita_a`, `20261130n_redari_pv_utilizatori.sql:198-214`, oglinda JS
   `pv.js:229-235`): parcela e acoperită dacă a semnat **un** utilizator / arendaș, **sau** dacă au semnat toți proprietarii activi.
8. **Coloane pregătite, nefolosite:** `red_raspunsuri.semnatura_electronica_ref` (`20261126a:216`) și `red_procese_verbale.semnatari`
   (jsonb, `20261126a:241`). Niciun ecran nu le scrie.
9. Ghidul notificărilor spune încă „trimis spre semnare prin poștă” la PV A (`docs/redari/GHID_NOTIFICARI.md:28`).

### 2.2 Ce canale există

| Canal | Ce face azi | Unde |
|---|---|---|
| Link personal + QR din convocator | Duce la formularul public `/redari/raspuns/:token`. Tokenul are 43 de caractere aleatoare, e generat în BD, **nu se schimbă** (nu există revocare sau rotire), expiră la ultima zi de sesiune a UAT-ului + 30 de zile. Limitele **diferă pe apeluri**: citirea formularului (`fn_red_formular_public`) are doar limita de 30 / IP / 10 min (`:690`); trimiterea răspunsului (`fn_red_raspuns_public`) are 30 / IP / 10 min și 5 / token / 10 min (`:746`, `:749`). | `20261126a:175-180`, `:286-292`, `:295-300`, `:676-722`; `RedariRaspunsPublic.jsx:9` |
| SMS (SMSLink) | Doar loturi pe UAT, cu un **text comun pe lot** (`sms_loturi.text`), create de admin / editor și aprobate de owner; mesajul individual nu are text propriu. Confirmarea de livrare (DLR) vine prin `sms-dlr`. Comutatorul Redări e oprit până la autorizarea scrisă a beneficiarului și textul final; cât timp șablonul e „provizoriu”, merge doar pe proiecte `TEST-…`, cu cel mult 5 destinatari. SMS extern doar între 08 și 20. | `docs/sms/ACTIVARE_SMS_REDARI.md:3-24`; `20261130a_sms_mvp.sql:18`, `:70`, `:77`, `:81-110`, `:112-134`; `supabase/functions/sms-dlr/index.ts:1-3` |
| E-mail F2 (`redari@`) | Loturi aprobate de owner, construite parțial. **Transportul real e oprit în cod** și în BD; lipsesc OAuth de trimitere, Gmail, reconcilierea, DKIM / DMARC. | `supabase/functions/_shared/redariMailF2.mjs:4`, `:85-86`; `20261131a_redari_mail_f2_loturi.sql`; `docs/redari/RAPORT_F2_EMAIL.md:189-197` |
| Poșta / curierul cu confirmare | Canalul obligatoriu al convocării. E-mailul și SMS-ul sunt doar în plus. Pentru semnarea PV-ului, poșta nu se mai folosește (decizia 17.11). | `docs/redari/PLAN_EMAIL_REDARI.md:440-447`, `:909` |

### 2.3 Ce vede cine are linkul (azi, fără niciun cod)

`fn_red_formular_public` întoarce, pentru un token valid: **identificatorul parcelei, UAT-ul, denumirea proiectului**, zilele de
sesiune, **existența unui răspuns anterior** (`deja_raspuns`), textul declarației, textul GDPR și contactul proiectului
(`20261126a:706-720`); antetul paginii afișează parcela, UAT-ul și proiectul (`RedariRaspunsPublic.jsx:80-95`). Pagina nu afișează
numele, adresa sau telefonul deținătorului, dar **identificatorul parcelei + UAT-ul pot identifica indirect persoana** (sunt date
personale în sens larg). Formularea din subsolul paginii, „pagina nu afișează și nu cere date personale” (`:319`), e mai largă decât
ce face pagina; corectarea ei ține de textele S1 (§8).

### 2.4 Ce date avem despre deținător și cine le poate schimba

- Telefonul și e-mailul stau în `red_detinatori_contact` (`20261126a:182-189`), vizibile doar pentru admin / editor (`:889`). Vin din
  tipizatul beneficiarului (Anexa 7) sau le introduce operatorul. **Admin / editor pot modifica oricând telefonul** (`:904-905`) și
  **pot citi tokenul** (`:875`, `:890`). Nu se păstrează proveniența unui telefon (cine l-a introdus, din ce sursă); jurnalul general
  `red_jurnal` reține doar numele câmpurilor schimbate pentru contact (`:265`).
- **Formularul public nu cere telefon sau e-mail.** Câmpul opțional de e-mail din formular e planificat (felia F1b,
  `PLAN_EMAIL_REDARI.md:845-848`), nu construit.
- Modelul de PV A cere „Act de identitate (serie, nr.)” și „Act doveditor al calității”. La distanță nu le vedem (vezi §5.13).

---

## 3. Variantele de semnare electronică

**Context (rezumatul nostru al textului regulamentului, nu o opinie juridică).** Regulamentul (UE) nr. 910/2014 („eIDAS”), modificat
prin Regulamentul (UE) 2024/1183, definește trei niveluri: semnătura electronică (simplă), semnătura avansată (art. 26: legată unic de
semnatar, îl identifică, creată cu date aflate sub controlul lui exclusiv, orice modificare ulterioară a documentului se poate detecta)
și semnătura calificată (avansată + certificat calificat + dispozitiv calificat). Art. 25 spune că unei semnături nu i se poate nega
efectul juridic doar pentru că e electronică sau nu e calificată, iar semnătura calificată are efectul echivalent al semnăturii
olografe. La nivel național se aplică Legea nr. 214/2024 (care a înlocuit Legea nr. 455/2001).

**Ce nu știm și întrebăm (§9.2):** ce nivel are, juridic, fiecare variantă de mai jos aplicată acestui PV; ce efect are în raport cu
fraza din plan „aceeași valoare ca unul semnat la sesiune”; dacă acordul de mediu cere o anumită formă. Rândul „Încadrare” din tabel
e **ipoteza noastră de lucru, formulată ca întrebare** pentru avocat.

| | A. Semnătură în platformă (link + cod SMS) | B. PDF tipărit, semnat de mână, fotografiat și încărcat | C. Semnătură avansată / calificată la un furnizor extern | D. Doar declarația online + PV tip B |
|---|---|---|---|---|
| **Ce vede deținătorul** | Pagina din linkul personal (același QR / link din scrisoare); cere un cod pe SMS la numărul din evidență; după cod vede PV-ul A complet; bifează acordul, își tastează numele (opțional desenează semnătura); primește confirmarea și poate descărca PDF-ul. | Descarcă PDF-ul **din același link, după cod** (singura cale; PDF-ul nu se trimite pe e-mail); îl tipărește, semnează, fotografiază, încarcă prin link. | Un e-mail / SMS de la furnizor; identificare (video, CEI, aplicație); semnează în aplicația furnizorului. | Nimic în plus față de formular. |
| **Ce dovadă rămâne** | Că linkul personal și un cod trimis la numărul din evidență au fost folosite, când, pe ce document (hash calculat de server), cu ce text de acord și ce nume tastat; livrarea codului (DLR); datele tehnice după D8. **Nu dovedește cine a folosit linkul și codul** (§4.2). | Imaginea cu semnătura olografă + metadatele încărcării. Originalul hârtie rămâne la deținător. | Fișierul semnat (PAdES), verificabil cu un validator; dovezile furnizorului (identificare, jurnal). | Răspunsul online (`red_raspunsuri` + `red_raspunsuri_meta`); PV B semnat de comisie. |
| **Încadrare (întrebare pentru avocat)** | E semnătură simplă? Ce elemente ale celei avansate lipsesc (controlul exclusiv, identificarea)? | E o copie a unui document semnat olograf? E compatibilă cu „doar electronic”? | Avansată sau calificată, după produs? | Nu e o semnătură a deținătorului. |
| **Cost** | Un SMS per cod (tariful din contractul SMS existent, 1–3 SMS per semnătură); dezvoltare internă (§8). | Zero extern; timp de operator la verificarea imaginii. | De cerut ofertă (n-am verificat prețuri). | Zero. |
| **Ce cere de la beneficiar / avocat** | Acceptarea beneficiarului; opinia avocatului (Î1, Î2, Î11); texte validate; modificări în modelul PV A (§5.13). | Acceptarea copiei ca dovadă; eventual cererea originalului. | Rolul furnizorului față de datele personale (de lămurit, Î15); contractul cu furnizorul. | Nimic nou, dar **nu respectă fraza din plan**. |
| **Riscuri** | Modelul de amenințări de la §4.2: operator intern, telefon comun / al unei rude, SIM înlocuit, cod redirecționat, link furat (blocare). | Imagine ilizibilă sau ușor falsificată; fără legătură criptografică între imagine și PDF; puțini au imprimantă. | Abandon mare la proprietari de teren vârstnici / din rural; cost; încă un furnizor cu date personale. | Contrazice planul; parcela rămâne fără semnătura cerută. |

**D nu e o variantă de semnare.** Rămâne calea pentru cei care nu semnează deloc (plan, pct. 4.4, ultima frază).

**De urmărit, nu de construit acum:** portofelul european de identitate digitală (eIDAS 2) ar trebui să permită persoanelor fizice
semnătura calificată gratuită pentru uz neprofesional. Stadiul în România la data semnărilor e **de verificat**.

---

## 4. Recomandarea și modelul de amenințări

### 4.1 Recomandarea

**A ca variantă unică la pilot; contrasemnarea Gazpet / beneficiar separat; B doar dacă avocatul o cere (decizia 1 din §1); C doar
dacă avocatul spune că A nu ajunge.**

De ce:
1. **A se potrivește oamenilor** (proprietari de teren din mediul rural, mulți vârstnici): un link pe care îl au deja (QR-ul din
   scrisoarea recomandată) și un cod pe telefon. C ar avea abandon mare; B cere imprimantă.
2. **A cere două elemente distincte:** scrisoarea primită cu confirmare (linkul personal) și telefonul din evidență (codul). Cine are
   doar unul dintre ele nu poate semna. **Nu sunt factori independenți în sens strict:** ambele pot ajunge la aceeași persoană (aceeași
   gospodărie, telefonul unei rude trecut în evidență) sau pot fi controlate de un operator intern (§4.2). E mai mult decât „un click pe
   un link”, mai puțin decât o identificare.
3. **A lasă cea mai bogată urmă dintre variantele ieftine** (hash, momentul, telefonul, livrarea codului). Urma arată **folosirea
   linkului și a codului**, nu identitatea celui care le-a folosit.
4. **Nu trimitem linkul pe SMS.** Codul vine pe SMS; linkul vine pe hârtie (QR) și, unde există, pe e-mail. Linkul și codul pe același
   SMS ar reduce cele două elemente la unul singur (telefonul).
5. **Integritatea** (decizia 3 din §1): ce garantăm e „nemodificabil prin aplicație” (§5.14). O ancoră independentă (marcă temporală
   calificată pe lanțul de dovezi) e opțiunea cu cost, dacă avocatul o cere.

### 4.2 Modelul de amenințări

| # | Cine / ce | Scenariul | Ce propunem | Ce rămâne |
|---|---|---|---|---|
| T1 | **Operator intern** (admin / editor Redări) | Azi poate citi tokenul și modifica telefonul (§2.4). Își trece propriul număr, deschide o cerere, cere codul și semnează în locul deținătorului. Retragerea automată la schimbarea telefonului (§5.8) invalidează cererea veche, dar **nu** împiedică o cerere nouă pe numărul fals. | **Proveniența telefonului** (§5.4): telefonul folosit pentru cod are sursă verificabilă (importul beneficiarului cu fișierul lui, sau corecția scrisă a beneficiarului, cu nr. de înregistrare) și e confirmat de **altă persoană** decât cea care l-a introdus; **cererea o deschide altcineva** decât cel care a introdus / modificat telefonul; totul în jurnalul de dovezi; în Registru, alertă „telefon schimbat recent” la cererile deschise în 30 de zile de la o schimbare. Eticheta „dat de beneficiar” **nu** e o declarație liberă a operatorului: o setează serverul din importul sau din corecția înregistrată. | Doi operatori complici; proprietarul (is_owner) ocolește orice separare; un import fals. Dacă separarea nu e posibilă cu echipa de azi, **riscul se acceptă explicit de proprietar** (decizia 2 din §1, D14). |
| T2 | **Altcineva din gospodărie** | Plicul e deschis de o rudă; telefonul din evidență e al aceleiași rude (sau comun). Ruda semnează. | Textul de acord: „Declar că sunt [numele din PV] și că semnez personal”; SMS-ul: „Nu dați codul nimănui”; doi coproprietari cu același număr → blocat (D10). | **Nu se poate împiedica tehnic.** Dovada arată folosirea linkului și a codului, nu cine. Întrebare pentru avocat (Î11). |
| T3 | **SIM înlocuit / număr portat / număr reatribuit** | Numărul din evidență ajunge la altă persoană (fraudă la operatorul telecom sau număr vechi refolosit). | Telefon cu proveniență recentă; fereastra cererii scurtă (D11); nu știm dacă furnizorul SMS oferă o verificare de SIM înlocuit (de verificat; azi nu o folosim). | Rămâne risc; dovada nu-l poate exclude. |
| T4 | **Cod redirecționat** | Redirecționarea SMS-urilor, oglindirea pe alt dispozitiv, sau cineva sună deținătorul „din partea Gazpet” și îi cere codul. | SMS: „Gazpet nu vă cere niciodată codul la telefon”; codul valabil 10 minute, legat de o singură cerere (§5.5). | Rămâne risc de inginerie socială. |
| T5 | **Link furat** (QR fotografiat, plic interceptat, e-mail citit de altcineva, §6.3) | Fără telefon, atacatorul nu vede PV-ul și nu semnează, dar vede datele dinainte de cod (§5.7), poate cere coduri (care pleacă la deținător) și poate consuma încercările: **blochează semnarea electronică legitimă**. | Limite persistente și răcire temporară, nu blocare definitivă (§5.6); SMS-ul spune „Dacă nu ați cerut codul, sunați la …”; operatorul vede tiparul „coduri cerute, neverificate” și poate bloca semnarea electronică pe deținător (D15). | Indisponibilizarea căii electronice pentru acel deținător; rămâne sesiunea / PV B. |
| T6 | **Navigator modificat** | Trimite alt hash, alt nume, altă versiune de acord, alt număr de telefon. | Serverul nu primește număr de la client; hash-ul e calculat de server; acordul se leagă de versiunea și textul integral din BD (§5.3, §5.5). | — |
| T7 | **Administratorul BD / o cale privilegiată / restaurarea unei copii** | Modifică sau înlocuiește dovezi, fișiere și hash-uri împreună, coerent. | **Adversar exclus** din garanția „nemodificabil prin aplicație”. Detectarea cere o ancoră independentă (§5.14, decizia 3). | Fără ancoră: nedetectabil. |

---

## 5. Proiectarea variantei recomandate (A)

### 5.1 Fluxul, pas cu pas

**Operatorul (admin / editor Redări, în ERP):**
1. **Precondiții** (verificate în BD, sub lock, §5.9): ultimul răspuns al deținătorului e „nu particip, fără obiecții” (online, cu
   declarația bifată); PV-ul A al perechii există și e `generat` sau `trimis_spre_semnare` fără cerere activă; verificarea parcelei pe
   teren e completată (data + comisia, §5.13); deținătorul are un **telefon acceptat** (§5.4), confirmat, iar operatorul care deschide
   cererea nu e cel care l-a introdus; semnarea electronică nu e blocată pe deținător (D15); nicio altă cerere activă pe PV.
2. **PDF-ul de semnat (D6):** la pilot, operatorul salvează DOCX-ul generat ca PDF (din Word) și îl încarcă în ecranul nou „Trimite
   spre semnare electronică”. Platforma verifică `%PDF-` și mărimea și îl arată pagină cu pagină. **O a doua persoană** (alt admin /
   editor) confirmă, alături de datele din registru, că PDF-ul corespunde (§5.3). Hash-ul îl calculează **serverul** din octeții primiți.
3. **Deschide cererea** (un singur RPC, L02): scrie octeții PDF-ului și hash-ul calculat de server, legătura cu DOCX-ul și cu amprenta
   rândului PV (§5.3), versiunea telefonului acceptat, fereastra de semnare (D11) și trece PV-ul în `trimis_spre_semnare` cu data de
   azi. Cheie UUID per intenție (L04).
4. **Anunțul** (opțional, nu e canalul de semnare): e-mailul „PV-ul e gata de semnat” cu același link personal (§6), unde există adresă
   și F2 e activ; altfel un SMS fără link („deschideți linkul / QR-ul din scrisoare”), cu șablon aprobat. Fără anunț, deținătorul îl
   vede oricum când redeschide QR-ul. Nimic nu pleacă automat la deschidere (decizia 6).
5. **Urmărirea:** în Registru și în fișa parcelei apar starea cererii și jurnalul de dovezi. Operatorul poate **retrage** cererea (cu
   motiv), de exemplu ca să corecteze PV-ul.
6. **Contrasemnarea și finalizarea** (după semnătura deținătorului, D5): reprezentanții Gazpet și ai beneficiarului semnează **anexa de
   dovezi**, care conține hash-ul PDF-ului acceptat (§5.3). RPC-ul de finalizare primește octeții anexei contrasemnate, verifică
   legăturile și trece PV-ul în `semnat`, atomic.

**Deținătorul (pe telefon, fără cont):**
1. Deschide linkul personal (QR sau e-mail). Vede ce vede și azi (§2.3) plus, dacă are un PV de semnat, mesajul „există un
   proces-verbal pregătit pentru semnare” (lista exactă: §5.7).
2. Apasă „Trimite-mi codul”. Primește un SMS cu un cod de 6 cifre, valabil 10 minute (doar între 08 și 20, regula SMS-ului extern).
3. Introduce codul. Abia acum vede **PV-ul A complet** (exact octeții din cerere) și îl poate descărca.
4. Are două butoane:
   - **„Semnez”**: bifează textul de acord (text de la Juridic, versionat, păstrat integral), își tastează numele, opțional desenează
     semnătura (D7), apasă „Semnez”. Acordul se leagă de hash-ul pe care **serverul** l-a servit în sesiunea de acces.
   - **„Am obiecții”**: scrie obiecțiile; se înregistrează un răspuns nou cu obiecții, iar cererea se închide ca „refuzată” (§5.11).
5. Vede confirmarea și poate descărca PDF-ul semnat, cu cheia sesiunii de acces încă valabile. Nu primește PDF-ul pe e-mail.

### 5.2 Stările și calea veche de semnare

**PV-ul (`red_procese_verbale.stare`) nu primește stări noi.** Se refolosesc:
- `trimis_spre_semnare` = există o cerere deschisă / semnată de deținător, **sau** a existat una închisă fără finalizare;
- `semnat` = documentul final e legat; `semnat_fizic = false`, `semnat_la_sesiune = false`;
- `anulat` = ca azi, cu motiv; **refuzat cât timp există o cerere activă** (întâi se retrage cererea).

**Coloană nouă propusă pe PV: `metoda_semnare`** ∈ {`sesiune`, `teren`, `electronic_distanta`} (+ `olograf_distanta` doar dacă D1 păstrează
B), **setată de server** (trigger BEFORE, imuabilă după `semnat`, L08), ca metoda reală să fie consemnată și nu dedusă din bife.

**Calea veche** (încărcarea scanului + „semnat” prin actualizarea directă, `ModalPv.jsx:234-269`) — **regula propusă (D17, de aprobat):**
- **R1.** `electronic_distanta` se poate seta **numai** de RPC-ul de finalizare. Triggerul pe PV verifică, la trecerea în `semnat` cu
  această metodă, că există în aceeași tranzacție cererea `finalizata` a PV-ului, cu documentul final egal cu `fisier_semnat_path`;
  cum cererea se scrie doar prin RPC (§5.8), un PATCH direct nu o poate falsifica.
- **R2.** Pe un PV A care a avut **orice** cerere electronică (inclusiv retrasă / refuzată / expirată), calea directă spre `semnat` se
  acceptă doar pentru semnarea **în prezență** (`sesiune` sau `teren`, cu `semnat_fizic = true`), cu motiv obligatoriu, consemnat în
  jurnalul de dovezi al ultimei cereri. Regula stă în trigger (nu doar în UI) și ține și după închiderea cererii, inclusiv la PATCH
  direct (L07). Nu cere o a doua aprobare: semnarea în prezență se face cu actul de identitate văzut.
- **R3.** Scanul primit „de la distanță” (fără sesiune, fără teren) nu mai e o metodă pentru PV A noi (decizia 17.11, poșta nu se mai
  folosește). **De decis** dacă R3 se impune în BD pentru toate PV-urile A create după o dată, sau doar se scoate din UI (PV-urile vechi
  semnate prin poștă rămân cum sunt).

**Cererea de semnare (stare proprie, listă închisă, tranzițiile într-un tabel, L20):**

| Din | În | Cine |
|---|---|---|
| — | `deschisa` | operator (RPC de deschidere) |
| `deschisa` | `semnata_detinator` | deținătorul (RPC public, cu sesiune de acces) |
| `deschisa` | `refuzata` | deținătorul („am obiecții”) |
| `deschisa` | `expirata` | automat, la prima citire după `expira_la` (fără cron) |
| `deschisa` | `blocata` | automat, la epuizarea limitelor (§5.6) |
| `deschisa`, `semnata_detinator`, `blocata` | `retrasa` | operator, cu motiv; automat la schimbarea telefonului acceptat |
| `semnata_detinator` | `finalizata` | operator (RPC de finalizare, care trece și PV-ul în `semnat`) |

(+ `incarcata_olograf` doar dacă D1 păstrează B.) `refuzata`, `expirata`, `retrasa`, `finalizata` sunt finale; `blocata` se închide doar
prin retragere. O cerere nouă pe același PV se poate deschide doar dacă nu există alta activă (UNIQUE parțial, L16). După
`finalizata`, contestația e un obiect separat (§5.12), nu o tranziție.

**Starea parcelei** (`stare.js` și vederea `red_v_stare_parcela`, aceeași regulă în ambele, cu test de paritate, L19):
- se păstrează regula 3 „PV trimis spre semnare”, **cu o excepție nouă**: un răspuns cu obiecții înregistrat **după** deschiderea
  cererii (refuzul de la §5.11) trece înaintea ei, ca parcela să apară „Obiecții de tratat”. Azi regula 3 ar ascunde obiecțiile
  (`stare.js:97` e verificată înaintea răspunsurilor, `:100-105`). Schimbarea atinge o vedere existentă: migrare proprie, cu L15 și
  paritate JS / SQL.
- contestația deschisă (§5.12) se vede pe parcelă după decizia 5 din §1.
- eticheta „PV trimis spre semnare” primește, în UI, detaliul „electronic: semnat de deținător, așteaptă contrasemnarea” când e cazul.

### 5.3 Lanțul documentelor (de la registru la documentul final)

Trei documente distincte, fiecare cu hash-ul calculat de **server** (`sha256` în SQL pe octeții din BD), niciodată declarat de client:

| | Document | Ce leagă | Cum se verifică |
|---|---|---|---|
| (a) | **Sursa:** DOCX-ul generat din registru (`fisier_generat_path`, `pv.js:314-327`) + **amprenta rândului PV** | Cererea reține calea DOCX-ului și o amprentă a câmpurilor PV-ului (calculată de server, sub lock, la deschidere). Garda de pe PV (§5.8) interzice orice schimbare cât cererea e activă. | La finalizare, serverul recalculează amprenta: diferită = refuz (L03). |
| (b) | **PDF-ul supus acordului** | Octeții stau în BD (`bytea`, plafon 2 MB), hash-ul îl calculează serverul la deschidere. Deținătorul primește exact acești octeți, iar sesiunea de acces e legată de acest hash (§5.5). Acordul se leagă de hash-ul servit, nu de cel trimis de navigator (navigatorul îl poate trimite doar ca verificare suplimentară; o nepotrivire = refuz). | Oricine recalculează sha256 al PDF-ului păstrat și îl compară cu cel din cerere și din anexa (c). |
| (c) | **Documentul final:** anexa de dovezi, contrasemnată | Anexa e un PDF care tipărește: nr. PV, hash-ul lui (b), evenimentele semnării, versiunea și textul acordului, hash-ul ultimului eveniment din lanțul de dovezi (§5.14). Contrasemnatarii semnează anexa (D5); PDF-ul (b) rămâne **neschimbat** (contrasemnarea și anexa schimbă octeții, deci nu se aplică peste (b)). RPC-ul de finalizare primește octeții anexei contrasemnate (plafon 10 MB), calculează hash-ul, verifică (b), (a) și capul lanțului și scrie un **manifest de finalizare** (text canonic: hash-urile (a), (b), (c), capul lanțului, ora) cu hash propriu. `fisier_semnat_path` indică anexa contrasemnată. | Dosarul = (b) + (c) + manifestul; hash-ul din (c) trebuie să fie egal cu sha256 al lui (b). **Conținutul** lui (c) (că tipărește hash-ul corect) nu se poate verifica în SQL: îl verifică omul la finalizare (patru ochi), iar după aceea oricine, cu orice cititor PDF. |

**Cum se împiedică încărcarea altui PDF decât cel din registru.** La pilot (D6 = A, PDF salvat din Word de operator) **nu se poate
împiedica tehnic, doar detecta**: (1) a doua persoană confirmă PDF-ul față de datele din registru înainte de deschidere (patru ochi,
consemnat cu `auth.uid()` ei); (2) navigatorul extrage textul PDF-ului și verifică, orientativ, că apar nr. PV-ului și identificatorul
parcelei (nu e dovadă, doar o plasă); (3) contrasemnatarii compară cu registrul. **Împiedicarea** cere ca PDF-ul să fie produs de
server direct din registru (D6 = C): un serviciu de server care citește registrul, generează PDF-ul și îl scrie printr-un RPC dedicat,
cu secret propriu (L10). E o felie separată, cu fișă de securitate proprie (rulează fără utilizator, deci cu rol de server justificat).

### 5.4 Telefonul acceptat pentru cod (proveniența)

Tabel nou, separat de `red_detinatori_contact` (calea existentă de editare a contactului rămâne neschimbată):

- `red_pv_semnare_telefoane`: deținătorul, telefonul (normalizat), **sursa** ∈ {`import_beneficiar` (lotul de import + hash-ul rândului
  din fișierul beneficiarului), `corectie_beneficiar` (nr. + data adresei scrise a beneficiarului), `confirmat_in_prezenta` (la sesiune,
  cu actul văzut)}, `introdus_de` / `introdus_la` (server, din `auth.uid()`), `confirmat_de` / `confirmat_la` (**altă persoană**, refuz dacă
  e aceeași), `versiune`, `retras_la`. Coloanele de proveniență le setează serverul și sunt imuabile (L08).
- Se poate folosi pentru cod doar versiunea **confirmată** și nereatrasă; cererea reține versiunea. Orice schimbare (versiune nouă sau
  retragere) retrage automat cererile active ale deținătorului (§5.8).
- **Separarea responsabilităților:** deschiderea cererii e refuzată dacă `auth.uid()` = `introdus_de` al versiunii folosite. Rezultat:
  cel puțin două persoane diferite la fiecare cerere (cine introduce telefonul ≠ cine confirmă și ≠ cine deschide).
- **Nu se schimbă numărul la telefon, la cererea cuiva care spune că e deținătorul** (decizia D3 = A: doar beneficiarul sau prezența).
- Alternativa (decizia 2 din §1 = B, D14): fără tabel nou, telefonul din contact, riscul T1 acceptat în scris de proprietar.

### 5.5 Codul și sesiunea de acces (contractul anti-reutilizare)

**Codul:**
- generat de server (aleator criptografic), 6 cifre, valabil 10 minute; păstrat ca HMAC cu secret propriu al fluxului (nu cu secretul
  altui modul, L10), legat de cerere și de versiunea telefonului; textul în clar doar temporar, pentru expediere (§5.10);
- **un singur cod activ pe cerere:** emiterea unui cod nou anulează, în aceeași tranzacție, codurile anterioare ale cererii;
- verificarea, sub lock-ul cererii (§5.9): întâi se incrementează contorul de încercări, apoi se compară; **verificarea reușită consumă
  codul atomic** (`UPDATE … SET consumat_la = now() WHERE id = … AND consumat_la IS NULL AND anulat_la IS NULL AND expira_la > now()
  RETURNING`; 0 rânduri = refuz). Un cod consumat nu mai deschide nimic.

**Sesiunea de acces:**
- emisă doar la verificarea reușită: cheie aleatoare de 32 de octeți, păstrată ca hash; în navigator stă în memoria tab-ului
  (`sessionStorage`), niciodată în URL sau în `localStorage`;
- **legată de:** cerere + deținător + hash-ul PDF-ului (b) + versiunea telefonului; expiră la min(30 de minute, `expira_la` al cererii);
- fiecare RPC public reverifică **toate** legăturile sub lock: cererea e în starea cerută de acțiune, hash-ul PDF-ului cererii = cel din
  sesiune, versiunea telefonului = cea curentă, sesiunea nu e revocată;
- **revocare** în aceeași tranzacție cu evenimentul: retragere, refuz, expirare, blocare, finalizare, schimbarea / retragerea telefonului
  acceptat, blocarea semnării electronice pe deținător (D15).

**Scenariul din review, acoperit explicit:** deținătorul validează codul (sesiunea S1 pe cererea C1); operatorul retrage C1 și deschide C2
pe același token. S1 e revocată la retragere și, oricum, e legată de C1 și de hash-ul lui C1: **nu autorizează nimic pe C2**. Pentru C2
deținătorul cere un cod nou.

**Reluarea după succes, separată de o acțiune nouă:**
- semnarea poartă o cheie UUID per intenție, generată în navigator înainte de primul apel (L04); aceeași cheie + aceleași date (hash,
  nume, versiunea acordului) → **același rezultat** (idempotent, L05), chiar dacă între timp cererea a trecut în `semnata_detinator`;
  aceeași cheie + alte date → refuz; altă cheie pe o cerere deja semnată → „deja semnat” (nu a doua semnare);
- după `semnata_detinator`, sesiunea mai permite doar recitirea rezultatului și descărcarea; **nu** refuzul și nici altă semnare;
- după expirarea sesiunii, starea („semnat la ora …”) se vede fără cod, în lista de la §5.7; orice acțiune nouă cere cod nou.

### 5.6 Limitele (pe cerere, persistente pe deținător și pe telefon, pe proiect)

| Nivel | Limită propusă (de confirmat) | Ce se întâmplă peste |
|---|---|---|
| Cerere | un cod nou la cel mult 60 s; 3 coduri / 24 h; 6 coduri în total; 5 încercări greșite pe cod (a 5-a anulează codul) | după 3 coduri anulate prin încercări: cererea → `blocata` |
| Deținător (persistent, peste toate cererile, nu se resetează la cerere nouă) | 10 coduri / 30 de zile; 2 cereri blocate | semnarea electronică se oprește pe deținător; o redeschide doar un **admin**, cu motiv, după ce l-a sunat pe deținător |
| Telefon (HMAC al numărului, peste deținători) | 5 coduri / 24 h | refuz „contactați-ne” |
| Proiect | **20 de coduri / zi la pilot, 60 / zi după** (valori explicite, în setări, schimbate doar de proprietar); codurile consumă și din plafonul SMS general (implicit 200 / zi, 1.500 / lună, `20261130a:68-69`) | refuz „contactați-ne”; alertă în Registru |
| Apeluri publice | contoarele `red_rate_limit` existente (`ip:` 30 / 10 min) + chei **separate** pentru cererea de cod (`tc:` pe hash-ul tokenului) și pentru acțiunile cu sesiune (`s:` pe hash-ul sesiunii) | citirea documentului și semnarea nu consumă din cota pe token, deci cine are doar linkul nu poate epuiza cota celui care are și codul |

**Atacul de blocare (T5).** Cine fură linkul poate cere coduri (pleacă la deținător) și poate greși intenționat. Limitele de mai sus
**nu** îl pot opri să indisponibilizeze calea electronică pentru acel deținător; ele doar îl împiedică să ghicească codul și să trimită
SMS-uri în altă parte. Atenuări: „blocata” e o stare a cererii, nu o blocare definitivă a deținătorului; SMS-ul cu cod spune „Dacă nu ați
cerut codul, sunați la …”; operatorul vede în Registru tiparul „coduri cerute, niciunul verificat”. Ce rămâne: o semnare legitimă
amânată sau mutată la sesiune.

**Redeschiderea:** după `blocata`, cererea se retrage; o cerere nouă se deschide doar de un admin, cu motiv, și **nu** resetează
contoarele persistente.

### 5.7 Ce se vede înainte de cod

Lista închisă, pentru cine are doar tokenul:
- tot ce întoarce azi `fn_red_formular_public` (§2.3: identificatorul parcelei, UAT-ul, proiectul, zilele de sesiune, existența unui
  răspuns, textele, contactul) — neschimbat;
- **în plus**, din RPC-ul nou de stare: „există un PV pregătit pentru semnare: da / nu” și starea cererii pe trei valori (`de semnat`,
  `semnat`, `închis`), fără motiv, fără nume, fără date din PV;
- **ultimele cifre ale telefonului:** de decis (D13). **A** = nicio cifră („codul pleacă la numărul comunicat de beneficiar”); **B** =
  ultimele 2 cifre. Recomandare **A**: 2 cifre ajută puțin (cine nu primește codul sună oricum) și dezvăluie o parte din număr oricui
  are linkul.

Ce **nu** se vede înainte de cod: PV-ul, numele, stare terenului, obiecțiile, telefonul (după D13), istoricul de dovezi.

**Protecția apelurilor vechi.** RPC-ul nou nu micșorează ce dezvăluie deja `fn_red_formular_public`; un răspuns neutru pe RPC-ul nou
protejează doar de enumerarea tokenurilor, care e deja nepractică (43 de caractere aleatoare). Protecția reală a datelor dinainte de
cod e secretul tokenului + limitele. RPC-ul de citire a formularului are azi doar limita pe IP (§2.2); S3 propune și pentru el cheia pe
token (`t:`), ca toate apelurile publice să aibă aceleași limite. O eventuală reducere a datelor din formularul de azi (ex. ascunderea
identificatorului parcelei) e o decizie separată, cu Juridic, nu face parte din această specificație.

### 5.8 Obiectele de bază de date (doar lista și rolul; nimic creat aici)

Regulile casei pentru toate: tabele cu RLS pornit, `REVOKE ALL` de la `anon` / `authenticated` și acordare explicită; funcții
`SECURITY DEFINER SET search_path = public, pg_temp`, `REVOKE EXECUTE FROM PUBLIC`, `GRANT` doar pe RPC-urile dedicate; identitatea
operatorului **numai** din `auth.uid()` + `fn_red_nivel()` pe proiectul fiecărui id atins (L08, L09); erorile așteptate întoarse ca
jsonb cu motiv din listă închisă (ca `fn_red_raspuns_public`); triggerele de jurnal existente (`fn_red_jurnal`) pe tabelele cu date de
operator, **nu** pe tabelele de coduri și sesiuni.

**Tabele noi**

| Nume propus | Rol | Cine citește / scrie |
|---|---|---|
| `red_pv_semnari` | Cererea: PV, deținător, starea (§5.2), PDF-ul (b) ca octeți + SHA-256 + mărime, calea DOCX (a) + amprenta rândului PV, versiunea telefonului acceptat, fereastra (`expira_la`), `versiune`, cheia UUID, confirmarea PDF-ului de a doua persoană, cine a deschis / retras / finalizat și când, anexa (c) ca octeți + hash, manifestul de finalizare. UNIQUE parțial: o cerere activă pe PV. | SELECT admin / editor (viewer: doar starea, prin vedere fără telefon și fără octeți); scriere **doar** prin RPC |
| `red_pv_semnare_telefoane` | Telefonul acceptat și proveniența lui (§5.4). | SELECT admin / editor; scriere doar prin RPC |
| `red_pv_semnare_coduri` | Codurile: HMAC-ul codului, creat / expiră / consumat / anulat, încercări, legătura cu mesajul SMS. | nimeni direct; doar funcțiile DEFINER |
| `red_pv_semnare_sesiuni` | Sesiunile de acces (§5.5): hash-ul cheii, legăturile, expirarea, revocarea. | nimeni direct |
| `red_pv_semnare_dovezi` | Jurnalul de dovezi, **doar adăugare pentru rolurile aplicației** (trigger care refuză UPDATE / DELETE, ca `red_jurnal`); fiecare rând conține hash-ul rândului precedent al cererii (lanț, §5.14). Evenimente: pagină deschisă, cod cerut / trimis / livrat (DLR) / greșit / verificat, document servit (hash), descărcare, acord (versiune + hash text), nume tastat, semnătură desenată (hash), semnat, refuz, blocare, retragere, finalizare, contestație. | SELECT admin / editor; scriere doar prin RPC |
| `red_pv_semnare_texte` | Textele de acord, versionate, **integral** (nu doar hash), imuabile. | SELECT authenticated; scriere doar prin migrare |
| `red_pv_semnare_contestatii` | Contestațiile după semnare (§5.12). | SELECT admin / editor; scriere prin RPC |
| `red_pv_semnare_blocaje` | Blocarea semnării electronice pe deținător (D15), cu motiv și autor. | SELECT admin / editor; scriere prin RPC |

**Coloane noi pe tabelele existente:** `red_procese_verbale.metoda_semnare` (§5.2, setată de server). Coloana existentă
`red_raspunsuri.semnatura_electronica_ref` (`20261126a:216`) **nu** se folosește pentru PV (ține de răspuns și e editabilă de
`authenticated`, `20261131g_redari_stare_cost_rls.sql:262`); de decis la implementare dacă se retrage.

**Gărzi în BD (L07):**
- trigger pe `red_procese_verbale`: cât există o cerere activă, PV-ul nu se modifică (fișier generat, câmpuri, anulare); regulile R1–R3
  de la §5.2 se aplică pe toate căile, și după închiderea cererii;
- trigger pe `red_pv_semnare_telefoane` (și, dacă D14 = B, pe `red_detinatori_contact`): o versiune nouă sau retragerea telefonului
  **retrage automat** cererile active ale deținătorului și le revocă codurile și sesiunile;
- CHECK-uri: hash-uri `^[0-9a-f]{64}$`, stare pe listă, `expira_la > deschisa_la`, mărimi plafonate, `%PDF-` la începutul octeților.

**RPC-uri pentru operator (`authenticated`, admin / editor pe proiectul PV-ului)**

| Nume propus | Rol |
|---|---|
| `fn_red_semnare_telefon_propune(detinator, telefon, sursa, referinta, cheie_uuid)` / `fn_red_semnare_telefon_confirma(id, versiune)` | §5.4; confirmarea refuzată pentru același utilizator. |
| `fn_red_semnare_confirma_pdf(pv, octeti, cheie_uuid)` | Pasul de patru ochi: a doua persoană confirmă PDF-ul (hash calculat de server); fără confirmare, deschiderea e refuzată. |
| `fn_red_semnare_deschide(pv, sha256_confirmat, cheie_uuid)` | Verifică precondițiile de la §5.1 sub lock-urile de la §5.9 (inclusiv separarea de la §5.4), scrie cererea, trece PV-ul în `trimis_spre_semnare`, dovada „deschisă”, într-o tranzacție. Aceeași cheie + același conținut = același rezultat; aceeași cheie + alt conținut = refuz. |
| `fn_red_semnare_retrage(cerere, versiune, motiv)` | CAS pe versiune; cererea → `retrasa`; revocă codurile și sesiunile; dovadă. |
| `fn_red_semnare_finalizeaza(cerere, versiune, octeti_anexa, data, cheie_uuid)` | Doar din `semnata_detinator`; verifică (a), (b), capul lanțului (§5.3); scrie (c) și manifestul; PV → `semnat` cu `metoda_semnare = electronic_distanta`; cererea → `finalizata`; dovadă. Totul atomic. |
| `fn_red_semnare_blocheaza(detinator, motiv)` / `…_deblocheaza` | D15; deblocarea doar admin. |
| `fn_red_semnare_contestatie_*` | §5.12. |
| vederea `red_v_pv_semnari` + lista paginată (keyset, L23) | Pentru Registru, fișa parcelei, centralizator, PV C (fără telefon pentru viewer). |

**RPC-uri publice (`anon`)** — toate primesc tokenul personal, verifică formatul înainte de orice scriere, folosesc contoarele de la §5.6
și întorc același mesaj neutru pentru token inexistent, expirat sau fără cerere:

| Nume propus | Rol |
|---|---|
| `fn_red_semnare_public_stare(token)` | Lista de la §5.7. |
| `fn_red_semnare_public_cere_cod(token)` | Limitele de la §5.6; anulează codul anterior; pune mesajul în coada SMS **doar la telefonul acceptat al cererii** (nu primește număr de la client); refuz în afara intervalului 08–20. |
| `fn_red_semnare_public_verifica_cod(token, cod)` | §5.5; corect → cheia sesiunii de acces + dovadă. |
| `fn_red_semnare_public_document(token, sesiune)` | Octeții PDF-ului (b), după sesiune; dovada „document servit” cu hash-ul. |
| `fn_red_semnare_public_semneaza(token, sesiune, nume, versiune_acord, cheie_uuid, desen?, sha256_vazut?)` | Lock-uri §5.9; verifică legăturile sesiunii (§5.5), cererea `deschisa` și neexpirată, numele nevid cu limită de lungime, versiunea acordului = cea curentă; scrie dovada și trece cererea în `semnata_detinator`. Idempotent pe cheie (§5.5). |
| `fn_red_semnare_public_refuza(token, sesiune, obiectii, cheie_uuid)` | Răspuns `online` „nu particip, cu obiecții” în `red_raspunsuri` (aceeași validare ca formularul, max 4.000 de caractere), cererea → `refuzata`, revocă sesiunile, dovadă. Atomic. |

### 5.9 Concurență și ordinea lock-urilor (L01, L06)

**Ordinea unică, pe toate căile (operator, public, trigger), scrisă în comentariul fiecărui RPC și trigger:**

0. contoarele publice `red_rate_limit` (`ip:`, `tc:`, `s:`) — doar RPC-urile publice, la început, ca azi; niciun alt drum nu le ia după
   lock-urile de mai jos;
1. rândul telefonului acceptat al deținătorului (`red_pv_semnare_telefoane`, `FOR UPDATE`), sau, dacă D14 = B, rândul din
   `red_detinatori_contact`; **un drum nu blochează niciodată contactul altui deținător**;
1'. lock consultativ pe HMAC-ul telefonului (pentru regula „același număr la doi coproprietari”, D10) — după rândul propriu, niciodată
   înainte;
2. PV-urile, `FOR UPDATE ORDER BY id`;
3. cererile, `FOR UPDATE ORDER BY id`;
4. codurile și sesiunile cererii, `ORDER BY id`;
5. contoarele persistente pe deținător / telefon / proiect;
6. coada SMS (inserarea mesajului în lotul permanent; rezervarea și DLR-ul rămân în modulul SMS, cu lock-urile lui). **De verificat la
   S4** că niciun drum al modulului SMS nu blochează rânduri `red_*` (altfel se adaugă în ordine).

**Schimbarea telefonului** (operatorul): actualizarea rândului ia implicit lock-ul (1); triggerul ia apoi (2) toate PV-urile cu cereri
active ale deținătorului, sortate, apoi (3) cererile, apoi (4). Același sens ca drumurile publice, deci fără ciclu. Schimbarea poate
atinge mai multe cereri / PV-uri: toate în aceeași tranzacție, sortate.

**Refuzul** (`…_public_refuza`): (0) → (1) → (2) → (3) → (4), **apoi** verificările (sesiune, stare, expirare, text), apoi INSERT în
`red_raspunsuri`. INSERT-ul ia implicit `FOR KEY SHARE` pe `red_detinatori` (cheia străină) și pornește triggerele existente de validare
și jurnal; e compatibil cu actualizările obișnuite ale deținătorului (care nu schimbă cheia).

**Lock-urile implicite numărate (L06):** cheile străine la INSERT (cerere → PV, deținător; dovadă → cerere; răspuns → deținător),
triggerele de jurnal, triggerul de pe PV.

Cazuri care trebuie să iasă corect (probe cu două sesiuni reale, L25):
- deținătorul semnează pe două telefoane deodată → exact una reușește, cealaltă vede „deja semnat”;
- operatorul retrage cererea exact când deținătorul semnează → câștigă cine ia primul lock-ul (3); celălalt primește motivul exact;
- operatorul schimbă telefonul în timp ce deținătorul cere cod → se serializează pe (1); codul nu pleacă la vechiul număr după schimbare;
- două cereri de cod simultane pe aceeași cerere → un singur cod activ;
- rezultat ambiguu în navigator (rețea căzută după „Semnez”) → pagina reapelează cu aceeași cheie UUID sau recitește starea (L05).

### 5.10 SMS-ul cu cod și păstrarea fișierelor

**Autorizarea categoriei (decizia 7 din §1).** Coada de azi lucrează cu loturi aprobate de proprietar și un text comun pe lot
(`20261130a:81-110`); mesajul individual nu are text (`:112-134`). Un cod e diferit la fiecare mesaj și trebuie să plece imediat.
Propunerea:
- categorie nouă `redari_cod` (migrare în modulul SMS, cu review propriu); pe proiect, **un lot permanent** creat de admin și aprobat
  **o dată** de proprietar, pe versiunea văzută: șablonul cu loc pentru cod (versionat, GSM-7, un segment), plafonul zilnic al proiectului
  (§5.6), data până la care e valabil, referința autorizării scrise Transgaz;
- fiecare cod adaugă **un mesaj** în acest lot, doar prin `fn_red_semnare_public_cere_cod`; **toate porțile existente se aplică la
  rezervare, neschimbate:** comutatorul general, comutatorul Redări (autorizarea Transgaz), intervalul 08–20, opt-out-ul, plafoanele zi /
  lună; regula „șablon provizoriu doar pe `TEST-…`, cel mult 5 destinatari” se aplică și aici;
- lotul permanent se poate anula oricând de proprietar (oprește toate codurile proiectului).

**Păstrarea temporară a codului.** Expedierea e asincronă (coada), deci codul trebuie să existe în clar până la predarea către furnizor;
un HMAC nu se poate transforma înapoi în cod. Contractul propus:
- tabel separat, accesibil doar funcției care predă mesajele furnizorului: codul **criptat** (cheie proprie, nu în BD), legat de mesaj;
- **șters** (rândul, nu doar golit) imediat ce furnizorul a primit mesajul sau la eșec / anulare, și oricum la expirarea codului
  (10 minute), de curățarea care rulează la fiecare cerere de cod;
- codul nu apare în jurnalul SMS, în `sms_mesaje`, în jurnalele funcțiilor edge, în rapoartele de erori sau în DLR (DLR-ul are doar
  id-ul furnizorului, `20261130a:147-157`); la rezultat necunoscut (`necunoscut`) nu se retrimite, ca azi;
- **la furnizor:** textul SMS-ului (cu codul) rămâne în istoricul furnizorului. **De verificat** în contractul SMSLink cât îl păstrează
  și dacă se poate șterge sau ascunde; altfel se declară în informare (furnizor + durată). Codul expiră oricum în 10 minute și e
  consumat la folosire, deci valoarea lui după expirare e nulă.

**Fișierele (varianta aleasă: octeți în BD).** PDF-ul (b), anexa (c) și semnătura desenată stau ca `bytea` în tabelele cererii, cu
plafoane (2 MB / 10 MB / 200 KB); RPC-urile primesc octeții și calculează hash-ul în aceeași tranzacție cu scrierea cererii (L02).
Nu se folosește Storage pentru fluxul de semnare, deci nu există „fișier scris, legare neconfirmată” și **nu există ștergere
compensatorie**: la rezultat necunoscut (timeout), clientul reapelează cu aceeași cheie UUID și primește același rezultat (L04, L05).
Costul: mărimea BD crește cu ~0,5–2 MB pe PV A semnat electronic (de estimat pe numărul de PV-uri A ale Lotului 1). Alternativa
(Storage + verificarea hash-ului de o funcție edge cu rol de server + reconciliere după timeout) e mai complicată și nu e recomandată.

### 5.11 Cazurile urâte

| Caz | Ce se întâmplă |
|---|---|
| **Coproprietari** | Fiecare are PV-ul A propriu (`20261126a:245-248`), deci fiecare semnează separat, cu telefonul lui. Parcela e „acoperită” abia când au semnat toți proprietarii activi (§2.1 pct. 7). Doi coproprietari cu **același număr**: D10. |
| **Utilizator / arendaș** | Semnează separat, pentru folosința curentă (plan, pct. 4.7). Azi un singur PV A semnat de utilizator acoperă parcela (`20261130n:200-203`, `pv.js:231`). **De decis** dacă mai acoperă parcela cât un proprietar are obiecții / contestație deschise (decizia 5 din §1, D16, Î12). |
| **Moștenitor** | Doar dacă beneficiarul l-a comunicat ca moștenitor (actul doveditor nu se poate verifica la distanță); altfel sesiune. Î6. |
| **Reprezentant cu mandat** (procură) | Caz **separat** de moștenitor: semnează în numele deținătorului. Procura nu se poate verifica la distanță → la pilot, doar la sesiune; Î12. |
| **Telefon greșit** | Codul ajunge la altcineva, care nu are linkul; deținătorul nu primește codul și sună. Telefonul se corectează doar din sursa acceptată (§5.4); corectarea retrage automat cererea; se deschide alta. |
| **Cod expirat / greșit** | Mesaj clar, „cere alt cod” în limitele de la §5.6; după limite → „contactați-ne”, cererea `blocata`, operatorul vede motivul. |
| **Are obiecții după ce a văzut PV-ul** | Butonul „Am obiecții”. Răspunsul cu obiecții devine ultimul răspuns; parcela trece la „Obiecții de tratat” (§5.2); cererea e `refuzata`; PV-ul se corectează / anulează de operator. |
| **Se răzgândește după ce a semnat, înainte de finalizare** | Semnătura și dovada rămân. Operatorul poate să nu finalizeze (retrage cererea, cu motiv) până la clarificare. Efectul juridic: Î7. |
| **Contestă după finalizare** | §5.12. |
| **Link redirecționat altcuiva** | Fără cod, cel care are linkul nu vede PV-ul și nu semnează (dar vede datele de la §5.7 și poate bloca, T5). Dacă deținătorul dă singur și codul, dovada arată doar folosirea linkului și a codului; riscul e scris în pagina de acord și în SMS. |
| **Două semnări concurente** | §5.9. |
| **PV regenerat după trimitere** | Imposibil cât cererea e activă (garda din BD). Ca să corecteze, operatorul retrage cererea, regenerează, confirmă din nou PDF-ul (patru ochi) și deschide o cerere nouă (hash nou). |
| **Token expirat** | Tokenul de răspuns expiră la ultima zi de sesiune + 30 de zile (`20261126a:295-300`). Semnarea folosește fereastra **cererii** (`expira_la`): RPC-urile de semnare acceptă tokenul doar dacă are o cerere activă în fereastră. Formularul de răspuns rămâne închis după expirare, ca azi. |
| **Deținătorul fără telefon / fără smartphone** | Sesiunea sau PV-ul B (decizia 17.11). |
| **Deținător decedat / calitate contestată** | Operatorul retrage cererea; situația merge la beneficiar. |

### 5.12 Contestația după semnare

După `finalizata`, PV-ul e `semnat` și înghețat (§2.1 pct. 5) și nu există tranziție înapoi. Contestația devine un **obiect separat**:
- **înregistrarea:** de operator (contestație primită la telefon, în scris, pe e-mail, la sesiune) sau de deținător din link, după cod
  (buton „Contest semnătura”, text liber, max 4.000 de caractere). Rând nou în `red_pv_semnare_contestatii` + eveniment în lanțul de
  dovezi. **Nicio dovadă nu se șterge sau modifică.**
- **suspendarea folosirii administrative (decizia 5 din §1):** cât contestația e deschisă, PV-ul nu mai acoperă parcela în
  centralizator, în `red_v_stare_parcela` și în PV C (apare separat, „semnătură contestată”); PV-ul rămâne `semnat` în tabel (nu se
  anulează). Schimbarea atinge regula de acoperire și starea parcelei: migrare proprie, paritate JS / SQL.
- **decizia:** contestația se închide (`respinsa` / `admisa`, cu motiv) de **responsabilul de contract sau de proprietar**, după opinia
  Juridic; `admisa` înseamnă că PV-ul nu mai acoperă parcela, iar parcela se reia la sesiune (PV nou). Cine decide exact: de stabilit
  (D18).
- **notificarea:** alertă în Registru și în fișa parcelei pentru responsabil (fără mail / SMS automat).
- **vizibilitatea:** în dosarul parcelei (§5.15), în exportul pentru beneficiar și în PV C.
- **efectul juridic** al contestației, înainte și după contrasemnare: întrebare pentru avocat (Î7, Î13).

### 5.13 Ce trebuie schimbat în texte (de la Juridic, nu de la noi)

- **Formularul public:** descrierea opțiunii și declarația implicită spun „întocmit în lipsa mea” (`RedariRaspunsPublic.jsx:21`, `:26`),
  pe când planul și convocatorul spun „sunt de acord să primesc procesul-verbal completat, spre semnare, electronic”. Alinierea e
  decisă (17.11) și e în PR #1117 (draft). Subsolul „nu afișează și nu cere date personale” (`:319`) se corectează (§2.3).
- **Modelul PV A** (șablonul `pv_a.docx`):
  - secțiunea 2, „Act de identitate (serie, nr.)”: la distanță nu se completează; mențiunea propusă „semnat electronic de la distanță;
    identificare prin linkul personal din convocare și cod trimis pe telefon” — text de la Juridic;
  - secțiunea 4, „Constatarea s-a făcut”: are doar „la sediul Primăriei” și „pe teren”; lipsește „de la distanță, pe baza declarației
    online a deținătorului și a verificării comisiei pe teren la data …”;
  - secțiunea 7, „Încheiat în 3 exemplare”: pentru documentul electronic, formularea se schimbă;
  - **modelul a fost trimis beneficiarului**: o schimbare de model poate cere din nou acordul lui (Î9).
- **Textul de acord:** include declarația de identitate („sunt [numele din PV] și semnez personal”, T2); se păstrează integral, versionat.
- **Anexa de dovezi** (§5.3 (c)): nr. PV-ului, hash-ul PDF-ului acceptat, ora serverului, numărul mascat, ora livrării codului, ora
  verificării, numele tastat, textul de acord (versiunea), capul lanțului de dovezi, mențiunea că deținătorul a semnat electronic și
  ce **nu** dovedește semnarea (identitatea persoanei). Text stabilit cu Juridic. **Fără „generat automat” și fără nume de unelte.**
- **SMS-ul cu codul:** șablon fix, de aprobat (Juridic + proprietar + beneficiar), un segment GSM-7, de forma „Gazpet pt Transgaz: cod
  semnare PV predare teren 123456, valabil 10 min. Nu il dati nimanui; Gazpet nu vi-l cere la telefon.” (doar propunere; de verificat
  că încape în 160 de caractere cu numărul de contact).
- **PV C:** coloana „PV A prin corespondență” (`pv.js:398-402`) ar număra și parcelele semnate doar electronic. De decis cu Juridic dacă
  apare o coloană separată „semnat electronic” și cum se tratează parcelele mixte (un coproprietar la sesiune, altul electronic: azi intră
  la „sesiune”, §2.1 pct. 6).
- **Ghidul notificărilor:** „trimis spre semnare prin poștă” (`GHID_NOTIFICARI.md:28`) se actualizează (decizia 17.11).

### 5.14 Integritatea și păstrarea dovezilor

**Ce garantăm:** „nemodificabil prin aplicație” — rolurile aplicației (anonim, autentificat inclusiv admin / editor, funcțiile edge ale
aplicației) nu pot modifica sau șterge cererea, octeții, dovezile, textele de acord și manifestul (doar RPC-uri, triggere care refuză
UPDATE / DELETE). Bucketul `redari` are deja politici fără UPDATE / DELETE (`20261126a:24-25`, `:1003-1007`), dar fluxul de semnare nu-l
folosește (§5.10).

**Ce NU garantăm (adversar exclus, T7):** administratorul BD (poate dezactiva triggerele; aceeași limită e scrisă deja pentru `red_jurnal`,
`20261126a:265`), o cale privilegiată (consola furnizorului, o cheie de server scăpată), restaurarea unei copii vechi a bazei, coerentă
cu fișierele și hash-urile ei.

**Lanțul de hash-uri:** fiecare dovadă a cererii conține hash-ul dovezii precedente; capul lanțului intră în anexa (c) și în manifest.
Lanțul face o modificare **detectabilă doar dacă capul lui e păstrat undeva în afara infrastructurii noastre**; altfel cine poate
modifica dovezile poate recalcula și lanțul.

**Ancora independentă (opțiune, decizia 3 din §1, D9):**
- **marcă temporală calificată** (RFC 3161, de la un prestator calificat) pe capul lanțului la fiecare eveniment-cheie (semnare, refuz,
  finalizare, contestație) — cost per marcă, de cerut ofertă; protejează și evenimentele dinaintea finalizării;
- **copie la un terț:** capul lanțului tipărit în anexa contrasemnată (c), pe care o primește beneficiarul în dosar — fără cost, dar
  acoperă doar momentul finalizării;
- **sigiliul calificat Gazpet + marca temporală aplicate doar la final** fac vizibilă orice modificare ulterioară a documentului final, dar
  **nu protejează evenimentele anterioare** (cineva care le-a modificat înainte de sigilare nu e detectat).

**Ce se păstrează, unde și cât:**

| Ce | Unde | Cât |
|---|---|---|
| PDF-ul supus acordului (b), anexa (c), manifestul | `red_pv_semnari` (octeți) | ca PV-ul: până la sfârșitul perioadei de garanție din contract (termenul din informare) + conservare la litigiu |
| Jurnalul de dovezi, contestațiile, textele de acord integrale | tabelele lor | idem |
| Proveniența telefonului | `red_pv_semnare_telefoane` | idem |
| HMAC-urile codurilor, sesiunile | tabelele lor | 30 de zile după închiderea cererii, apoi șterse (dovada evenimentelor rămâne în jurnal) |
| Codul criptat pentru expediere | tabel temporar | cel mult 10 minute (§5.10) |
| IP / browser | în jurnalul de dovezi, după D8 | după D8 (§7) |
| Semnătura desenată (dacă D7 ≠ A) | octeți, în cerere | ca PV-ul |

**„Doar adăugare” și expirarea retenției.** Regula „doar adăugare” e pentru rolurile aplicației, cât durează retenția. La expirare,
ștergerea e o **operație de întreținere** (rolul de administrare a BD, cu preview → „da”-ul proprietarului → aplicare, ca orice ștergere
de date reale), cu un rând într-un registru de ștergeri (ce cerere, câte rânduri, data, cine a aprobat; fără conținut). **Conservarea la
litigiu:** un marcaj pe cerere, setat de proprietar, suspendă ștergerea. **Copiile de siguranță** ale furnizorului BD păstrează datele
șterse cât durează retenția copiilor (de verificat la furnizor și de trecut în informare); la o restaurare, ștergerile din registru se
aplică din nou.

### 5.15 Ce apare în dosarul parcelei și în PV C

- **Fișa parcelei:** cererea, starea, istoricul de dovezi (fără telefon pentru viewer), PDF-ul supus semnării, anexa, contestațiile.
- **Registru / centralizator:** coloană „semnare electronică” (deschisă / semnată de deținător / refuzată / expirată / blocată /
  finalizată / contestată).
- **Export Model_6:** coloană separată, fără date de contact.
- **PV C:** după decizia de la §5.13; contestațiile deschise apar separat (§5.12).
- **Dosarul predat beneficiarului:** PDF-ul acceptat (b) + anexa contrasemnată (c) + manifestul; jurnalul complet la cerere. Cine
  păstrează dosarul probator după încheierea contractului: Î14.

---

## 6. E-mailul către proprietari

### 6.1 Modelul transmis beneficiarului

Subiect „Predarea terenului după lucrările la conducta de gaze – sesiune la Primăria {COMUNA}”; corpul invită la sesiune, amintește
convocarea scrisă, dă linkul personal de răspuns `{LINK_RASPUNS}`, spune că cine nu poate veni și nu are obiecții primește PV-ul
„spre semnare, electronic”, că mesajul privește doar starea terenului, dă linkul informării și semnătura „în numele și cu
împuternicirea” beneficiarului. Condiții: **doar în plus față de convocarea scrisă; doar la adresa dată de beneficiar sau confirmată
de deținător; un mesaj de persoană; fără date despre parcelă; `{LINK_RASPUNS}` = același link personal ca în QR.**

### 6.2 Ce lipsește din F2

**(1) Necesar pentru orice mesaj, inclusiv cel doar cu link** (convocarea și „PV gata de semnat”):

| Lipsă | Unde se vede |
|---|---|
| Transportul real (oprit în cod: `TRANSPORT_REAL_ACTIV = false`; procesarea refuză din prima instrucțiune) | `redariMailF2.mjs:4`, `:85-86` |
| OAuth de trimitere pe `redari@`, tokenul în Vault, wrapperul Gmail unic | `PLAN_EMAIL_REDARI.md:858-861`, `:884-890` |
| Reconcilierea rezultatelor și monitorizarea „Trimise” | `RAPORT_F2_EMAIL.md:193` |
| Autentificarea expeditorului: DKIM lipsă, DMARC `p=none` fără rapoarte; precondiție F2 = DKIM + DMARC cu rapoarte | `PLAN_EMAIL_REDARI.md:162-165`, `:871` |
| Informarea publicată (garda refuză altfel) | `redariMailF2.mjs:40`; pagina informării, PR #939 |
| Textul validat de Juridic și aprobat de beneficiar | dialogul Juridic din 17.11.2026 |
| Validarea L15 completă, DRY, concurența, apply → rollback → re-apply | `RAPORT_F2_EMAIL.md:85-92`, `:195` |
| Doar pentru „PV gata de semnat”: tipul de mesaj nou (azi loturile au doar mesaje de convocare) | migrare F2 nouă |

**(2) Lipsuri generale F2, care NU condiționează un mesaj doar cu link:** generarea / legarea PDF-ului convocatorului în snapshot și
atașamentele (modulul acceptă un singur PDF, `redariMailF2.mjs:30`; `RAPORT_F2_EMAIL.md:193`). Mesajele din această specificație **nu**
au atașament.

### 6.3 Legătura cu semnarea și riscul cheii comune

- **E-mailul nu e canalul de semnare și nu poartă PV-ul.** Duce doar linkul personal; PV-ul se vede **doar** după codul SMS și se
  descarcă doar din pagină, după cod (o singură regulă, și pentru varianta B dacă se păstrează).
- **Același token ca scrisoarea.** E-mailul propagă aceeași cheie: o adresă greșită, o căsuță comună (familie, firmă), redirecționarea
  automată sau o căsuță compromisă dau linkul altcuiva. Fără telefon, acela nu semnează, dar vede datele de la §5.7 și poate bloca (T5).
  Riscul se scrie în informare și se cântărește la decizia de a trimite e-mailul.
- **Tokenul nu intră în:** urmărirea deschiderilor / clicurilor (fără pixel, fără redirecționare de link), jurnalele funcțiilor edge,
  rapoartele de erori, antetele mesajului (antetul `X-Gazpet-Redari` are doar id-ul mesajului și hash-ul, `redariMailF2.mjs:71-82`),
  subiectul.
- **Procedura la compromitere** (deținătorul spune că altcineva a primit e-mailul / scrisoarea): azi tokenul e imuabil, deci „revocăm
  linkul” **nu există**. De construit (D15): (a) la pilot, blocarea semnării electronice pe deținător (`red_pv_semnare_blocaje`), cu
  retragerea cererii și revocarea sesiunilor; semnarea continuă la sesiune; (b) mai târziu, dacă e nevoie, rotirea tokenului (link nou,
  scrisoare nouă), cu migrare proprie, pentru că schimbă triggerul care face tokenul imuabil.
- Două mesaje posibile, ambele cu același link: (1) **convocarea** (§6.1), înainte de sesiune; (2) **„PV-ul dumneavoastră e gata de
  semnat”**, după deschiderea cererii — model nou, de la Juridic, aprobat de beneficiar.
- Ambele intră în loturile aprobate de proprietar (`redariMailF2.mjs:37-45`); fără trimitere automată la deschiderea cererii (decizia 6).
- Cine s-a dezabonat de la e-mail poate semna în continuare prin QR. Un singur `To`, fără copie (`redariMailF2.mjs:71-82`).

---

## 7. Fișa de securitate (CLAUDE.md pct. 7) și GDPR

**(a) Conținut extern citit:** tot ce tastează deținătorul — codul, numele, textul obiecțiilor și al contestației, semnătura desenată
(și fișierul încărcat, dacă D1 păstrează B), antetul `User-Agent`; confirmările de livrare SMS (DLR) de la furnizor; PDF-ul încărcat de
operator. Toate sunt **date**: niciun text nu poate porni o acțiune în afara celei alese prin buton și nimic nu e interpretat automat.

**(b) Ce scrie / face:** cererea și octeții ei, telefonul acceptat, codurile (HMAC), codul criptat temporar, sesiunile, jurnalul de dovezi,
contestațiile, blocajele, un răspuns nou în `red_raspunsuri` (la refuz), `metoda_semnare` pe PV. **Trimite SMS-uri** (codul) prin coada
SMS, în lotul permanent aprobat de proprietar — **doar** la telefonul acceptat al cererii. Nu atinge bani, drepturi de acces sau setări.
Trece PV-ul în `semnat` **doar** prin RPC-ul de finalizare al operatorului.

**(c) Identitatea:** RPC-urile publice rulează `SECURITY DEFINER` (ca formularul de azi), cu `search_path` fix, fără `service_role`.
RPC-urile operatorului verifică `auth.uid()` + nivelul Redări pe proiectul PV-ului. Funcția care predă SMS-urile furnizorului (existentă,
rol de server) citește și codul criptat temporar: e singurul loc nou cu acces la el, justificat de expedierea asincronă (§5.10). Generarea
PDF-ului pe server (D6 = C) ar fi o felie separată, cu fișă proprie.

**(d) Cine pornește:**
- operatorul: doar admin / editor Redări, verificat în BD; deschiderea cere separarea de la §5.4 și confirmarea PDF-ului de a doua
  persoană;
- anonimul: doar cu tokenul personal + o cerere activă; limitele de la §5.6; SMS-ul pleacă doar la telefonul acceptat, deci pagina nu
  poate fi folosită ca să trimită SMS-uri în altă parte. **Cel mai rău caz cu un link furat:** câteva SMS-uri la numărul deținătorului
  (în limite) **și indisponibilizarea semnării electronice** pentru acel deținător (T5), cu întoarcere la sesiune.

**(e) Ce cere confirmare umană:**
- introducerea + confirmarea telefonului acceptat (două persoane);
- confirmarea PDF-ului și deschiderea fiecărei cereri — legate de **documentul (hash) și telefonul (versiune) autorizate**;
- finalizarea (operatorul, după contrasemnare); deciziile pe contestații; deblocarea unui deținător;
- **regula tare din pct. 7 se aplică** (citește conținut extern și trimite SMS): porțile sunt lotul permanent al categoriei `redari_cod`
  aprobat de proprietar (șablon fix, plafoane, valabilitate), comutatorul Redări pornit de proprietar după autorizarea scrisă a
  beneficiarului, și cererea deschisă de un om;
- pornirea comutatorului SMS Redări, aprobarea lotului permanent, orice lot de e-mail — ca azi, doar proprietarul.

Toată automatizarea nouă primește rând în `public.automatizari` și în `registru_automatizari` la livrare (fără valori de secrete).

**GDPR — date noi prelucrate și minimul propus:**

| Dată | Propunere minimă | De validat |
|---|---|---|
| Codul SMS | HMAC, șters la 30 de zile după închiderea cererii; în clar doar criptat, cel mult 10 minute, pentru expediere; niciodată în jurnale | textul la furnizor (§5.10) |
| Telefonul acceptat și proveniența lui | Telefonul era deja în evidență; nou: sursa, cine l-a introdus / confirmat, când | — |
| HMAC-ul telefonului, cifrele mascate | **Rămân date personale** (pseudonimizate, nu anonime) | — |
| Sesiunile de acces | hash-ul cheii, legăturile, orele; 30 de zile | — |
| Istoricul accesării documentului | evenimentele „document servit / descărcat”, cu ora | — |
| Identificatorii SMS / DLR | id-ul mesajului, id-ul furnizorului, stările, orele (fără payload brut, ca azi) | — |
| IP + browser | **Minimul (D8 = C):** IP trunchiat (IPv4 la /24, IPv6 la /48) + familia browserului și a sistemului, derivate pe server; `User-Agent` complet nepăstrat. **Alternativa:** IP complet + UA complet până la expirarea termenului de contestare, apoi trunchiate. Precedent: formularul de azi păstrează IP-ul complet (`red_raspunsuri_meta`, `20261126a:221-225`). | da (Î8) |
| Numele tastat, acordul (text integral), ora | Parte din dovadă | — |
| Semnătura desenată | Doar dacă D7 ≠ A | da |
| Fișierele olografe | Doar dacă D1 păstrează B | da |
| Contestațiile | textul, ora, canalul, decizia | — |
| PV-ul afișat online | Doar după cod; fără cache public; tokenul nu ajunge în `Referer` (`RedariRaspunsPublic.jsx:112-120`) și e mascat în rapoartele de erori | — |

**Ce trebuie adăugat în informare** (textul îl dă Juridic; informarea rev. 1 are deja telefonul, e-mailul, „semnătura și observațiile
din procesul-verbal” și furnizorul SMS):
- **scopul** nou: semnarea electronică a procesului-verbal și păstrarea dovezilor semnării;
- **temeiul** juridic: de confirmat de Juridic;
- **destinatarii / furnizorii:** furnizorul SMS (și ce păstrează el, §5.10), furnizorul BD / găzduirii, furnizorul de e-mail (dacă se
  trimite anunțul), eventualul prestator de marcă temporală (D9) sau de semnătură (C); eventualele transferuri în afara SEE: de verificat;
- **datele** de la tabelul de mai sus, inclusiv datele tehnice (IP, browser) după D8;
- **duratele sau criteriile** de păstrare (§5.14), inclusiv copiile de siguranță și conservarea la litigiu;
- **exercitarea drepturilor:** cui se adresează deținătorul (rolurile Transgaz / Gazpet după autorizarea scrisă, Î15) și cum.

Cât timp informarea nu e publicată, fluxul nu pornește pe date reale (aceeași regulă ca la e-mail).

---

## 8. Etapele de livrare

Fiecare felie = branch + PR draft + review (Jakarinos + Fable / Copilot) + migrare proprie cu revenire și test (apply → rollback →
re-apply pe clonă, făcut de chat) acolo unde există. **Orice migrare, RPC sau modificare de drepturi cere acordul proprietarului.**
Estimările sunt orientative, **fără rundele de review** (istoric 2–5 runde pe migrare în Redări).

Reguli comune:
- **întâi proba sintetică**, cu transport inert (simulatorul SMS, transportul F2 oprit), pe PGlite și pe clonă (roluri reale, FK reale,
  două sesiuni PostgreSQL pentru concurență, RLS ca non-owner, L25); abia după ea probele cu numere interne;
- **S3 și S5 se probează cu ceas controlat** (expirările codului, ale sesiunii și ale cererii, intervalul 08–20, în fixture-uri cu timp
  injectat doar în harness) **și cu transport controlat** (simulatorul furnizorului, inclusiv timeout și DLR întârziat);
- **activarea** SMS-ului (`redari_cod`) și a e-mailului (F2) sunt acte separate ale proprietarului, după acordurile scrise; nicio felie
  nu le pornește.

| Felie | Ce conține | Migrare | Depinde de | Estimare | Proba sintetică (întâi), apoi |
|---|---|---|---|---|---|
| **S0 — decizii** | Cele 7 decizii de la §1 și restul de la §9.1; opinia avocatului; acceptarea beneficiarului | — | — | — | — |
| **S1 — texte** | Textele (acord, anexa de dovezi, SMS, e-mailul „PV gata”, model PV A) pregătite pe branch; **nimic publicat** care să promită semnarea înainte ca S5 să meargă (pagina publică nu afișează secțiune de semnare, e-mailul „PV gata” nu se trimite) | — | Juridic, beneficiar | 0,5–1 zi după texte | Generarea DOCX pe proiectul de test Redări |
| **S2 — cererea (operator)** | Tabelele, telefonul acceptat (§5.4), confirmarea PDF-ului, gărzile pe PV (R1–R3) și pe telefon, RPC-urile deschide / retrage / blochează, vederea; ecranele; starea în Registru / fișă | da | S0 | 3–4 zile | PGlite + DRY pe clonă (roluri, separarea responsabilităților, gărzi pe PATCH direct, concurență cu două sesiuni); apoi Playwright pe proiectul de test Redări cu gardă de rețea |
| **S3 — pagina publică** | RPC-urile publice (stare, cere cod **cu transport inert**, verifică, document, semnează, refuză); secțiunea de semnare; limitele; schimbarea regulii 3 (JS + SQL, paritate) | da | S2, S1 | 3–5 zile | Ceas + transport controlate; probe ca `anon` pe clonă; atacuri: token greșit, cod ghicit, cod reutilizat, sesiune veche pe cerere nouă, două semnări, blocare; pe `TEST-…` operatorul vede codul în ERP (gardă în BD pe codul proiectului) |
| **S4 — codul pe SMS** | Categoria `redari_cod`, lotul permanent, codul criptat temporar și ștergerea lui, legătura cu DLR | da (modulul SMS) | autorizarea scrisă a beneficiarului + textul final | 1–2 zile | Simulatorul furnizorului; apoi pe `TEST-…`, cel mult 5 numere interne, cu „da”-ul proprietarului pentru comutator |
| **S5 — finalizarea** | Anexa de dovezi, lanțul de hash-uri, manifestul, RPC-ul de finalizare, contrasemnarea după D5; PV C, export, ghid; contestația și regula de acoperire (decizia 5) | da | S3, D5, D9 | 3–4 zile | Ceas controlat; cap-coadă pe proiectul de test, întâi cu transport inert, apoi cu un telefon intern |
| **S6 — B (olograf la distanță)** | Doar dacă D1 păstrează B: încărcarea prin link (octeți prin RPC), verificarea de către operator | da (mică) | S3, D1 | 1–2 zile | Fișiere ostile (PDF poliglot, imagine imensă, tip fals) |
| **S7 — e-mailul „PV gata”** | Tipul de mesaj în F2 | da (în lanțul F2) | F2 activ (§6.2 (1)) | 1 zi după F2 | Transport inert; apoi doar adrese interne |
| **Pilot** | Un UAT, câțiva deținători care au ales opțiunea, cu „da”-ul proprietarului pe fiecare pas | — | toate | — | — |

Ce **nu** se poate proba fără date reale: livrarea SMS la numere de proprietari, comportamentul oamenilor (abandon, telefoane comune),
acceptarea de către beneficiar a documentului final.

---

## 9. De decis și întrebări

### 9.1 De decis de proprietar

| | Întrebare | A | B | C | Recomandare |
|---|---|---|---|---|---|
| D1 | Metoda și rezerva (în cadrul „doar electronic”) | A + rezerva olografă B | doar A; altfel sesiune / PV B | A + furnizor extern | **B** (decizia 1 din §1) |
| D2 | — | *(unită cu D1)* | | | |
| D3 | De unde vine telefonul acceptat | doar beneficiar (import / corecție scrisă) + confirmat în prezență | + declarat de deținător în formular | + comunicat operatorului la telefon | **A**; B doar după Î5 |
| D4 | Linkul de semnare | același link personal (QR / e-mail), cu fereastra proprie a cererii | link nou, pe e-mail | link nou, pe SMS | **A** (C pune linkul și codul pe același canal) |
| D5 | Contrasemnarea Gazpet + beneficiar | semnătură calificată pe anexa de dovezi | anexa tipărită, semnată de mână, scanată | doar Gazpet pe anexă; beneficiarul confirmă pe PV C | de întrebat beneficiarul; **A** dacă o acceptă |
| D6 | PDF-ul de semnat | operatorul îl salvează din Word, confirmat de a doua persoană | conversie automată DOCX → PDF | PV A generat ca PDF pe server, din registru | **A** la pilot, **C** țintă (§5.3) |
| D7 | Semnătura desenată | nu (bifă + nume tastat) | opțională | obligatorie | **A** sau **B** |
| D8 | IP / browser la dovezi | IP complet + browser complet, ca la răspunsuri | IP complet + browser complet, trunchiate după termenul de contestare | IP trunchiat + familia browserului (minimul) | **C**, dacă Î8 nu cere altceva |
| D9 | Ancora independentă / sigiliul | marcă temporală calificată la fiecare eveniment-cheie | nimic la pilot (risc scris în dosar) | sigiliu + marcă temporală doar pe documentul final | **B** la pilot; **A** dacă Î3 o cere (C nu protejează evenimentele anterioare) |
| D10 | Doi coproprietari cu același telefon | blocat → sesiune | permis, marcat în dovezi | permis, cu confirmarea operatorului | **A** |
| D11 | Fereastra de semnare | 30 de zile | 14 zile | până la termenul PV C pe tronson | **A** (o fereastră mai scurtă reduce puțin riscul T3, dar crește abandonul) |
| D12 | *(închisă: „doar electronic”, decizia proprietarului din 17.11.2026)* | | | | |
| D13 | Cifre din telefon înainte de cod | niciuna | ultimele 2 | — | **A** (§5.7) |
| D14 | Protecția față de operatorul intern | proveniență + două persoane (§5.4) | risc acceptat în scris, fără separare | — | **A** (decizia 2 din §1) |
| D15 | Link compromis | blocarea semnării electronice pe deținător | + rotirea tokenului | — | **A** la pilot |
| D16 | Utilizatorul închide parcela când un proprietar are obiecții / contestă | nu, cât obiecția / contestația e deschisă | da, ca azi | — | **A**, după Î12 |
| D17 | Calea veche după o cerere electronică (§5.2) | R1 + R2 + R3 în BD | R1 + R2 în BD, R3 doar în UI | doar R1 | **B** (R3 în BD doar după decizia pe PV-urile vechi) |
| D18 | Cine decide o contestație | responsabilul de contract | proprietarul | responsabilul, cu confirmarea proprietarului | **C** |
| D19 | Autorizarea SMS-ului cu cod | lot permanent `redari_cod` pe proiect | aprobare per cod | — | **A** (decizia 7 din §1) |
| D20 | Fișierele fluxului | octeți în BD | Storage + verificare pe server + reconciliere | — | **A** (§5.10) |

### 9.2 Întrebări pentru avocat / Juridic

1. **Î1.** Ce efect are, după Legea nr. 214/2024 și Codul civil, un PV semnat prin link personal + cod SMS între deținător, Transgaz și
   Gazpet? Ce nivel de semnătură e, în sensul eIDAS? E suficient pentru fraza din plan „aceeași valoare ca unul semnat la sesiune”, sau
   fraza trebuie reformulată?
2. **Î2.** Condiția din acordul de mediu („recepția redării semnată de proprietar și beneficiar”) cere o anumită formă a semnăturii?
   Cine poate contesta (APM, proprietarul, beneficiarul) și ce ar trebui să arate dosarul ca să reziste?
3. **Î3.** Ce trebuie să conțină anexa de dovezi ca să fie utilă în fața unei instanțe sau a beneficiarului? Trebuie ca integritatea să
   reziste și la contestarea infrastructurii Gazpet (ancora independentă, D9)?
4. **Î4.** Dacă se păstrează varianta B: e compatibilă cu „doar electronic”? Ce valoare are copia? Trebuie cerut ulterior originalul?
5. **Î5.** Un număr de telefon declarat chiar de deținător poate fi folosit pentru cod, sau doar cel dat de beneficiar?
6. **Î6.** Moștenitorii și coproprietarii: se poate semna la distanță fără verificarea actului doveditor / de identitate? Ce mențiune
   intră în PV la secțiunea 2?
7. **Î7.** Retragerea consimțământului după semnare: ce efect are și cum se consemnează?
8. **Î8.** Temeiul și durata pentru IP / browser / semnătura desenată; e suficient minimul de la §7 pentru valoarea probatorie?
9. **Î9.** Schimbarea modelului PV A (secțiunile 2, 4, 7) cere un nou acord al beneficiarului, fiind deja trimis?
10. **Î10.** Contrasemnarea reprezentanților Gazpet și Transgaz pe anexa de dovezi, după deținător: e acceptabilă? Data PV-ului e cea a
    semnăturii deținătorului sau a ultimei contrasemnături?
11. **Î11.** Sunt acceptabile riscurile de identificare rămase (§4.2: persoană din gospodărie, SIM înlocuit, cod dat altcuiva) și riscul
    fraudei interne (T1), cu măsurile propuse? Ce trebuie scris în anexă despre ce **nu** dovedește semnarea?
12. **Î12.** Reprezentarea (procură), coproprietatea și conflictul proprietar–utilizator: poate semnătura unui utilizator / arendaș să
    închidă parcela când un proprietar contestă sau refuză? Poate un mandatar semna la distanță?
13. **Î13.** Ce efect are o contestație primită înainte de contrasemnare, respectiv după? Ce trebuie făcut cu PV-ul și cu parcela?
14. **Î14.** Cine păstrează dosarul probator (PDF-ul acceptat, anexa, jurnalul de dovezi) după încheierea contractului cu Transgaz, și cât?
15. **Î15.** Ce rol are fiecare față de datele personale (Transgaz, Gazpet, furnizorul SMS, furnizorul BD, eventualul prestator de marcă
    temporală / semnătură)? Furnizorul SMS e sub-împuternicit în sensul art. 28 GDPR, iar autorizarea scrisă Transgaz îl acoperă și pentru
    codurile de semnare? Ce trebuie scris în informare despre exercitarea drepturilor?

---

## 10. Lecțiile L01–L25 (cum le respectă specificația)

Specificația nu are cod; regulile se aplică proiectării și devin criterii de acceptare pentru feliile S2–S7.

| Regulă | Unde |
|---|---|
| L01 | Lock înainte de verificări pe toate căile, inclusiv refuzul; contorul de încercări incrementat înainte de comparare; CAS pe `versiune` la retragere / finalizare (§5.5, §5.9) |
| L02 | Deschidere, semnare, refuz, finalizare: fiecare într-un singur RPC; octeții în aceeași tranzacție cu cererea (§5.8, §5.10) |
| L03 | Finalizarea doar dacă amprenta PV-ului, hash-ul PDF-ului și capul lanțului sunt cele legate de cerere (§5.3) |
| L04 | Cheie UUID per intenție la deschidere, semnare, refuz, finalizare; aceeași cheie + alt conținut = refuz (§5.5, §5.8) |
| L05 | Rezultat ambiguu → reapel cu aceeași cheie / recitire; fără ștergere compensatorie, fără retrimiterea SMS-ului `necunoscut` (§5.9, §5.10) |
| L06 | Ordinea completă: contoare publice → telefon / contact → lock consultativ pe telefon → PV-uri → cereri → coduri / sesiuni → contoare persistente → coada SMS; lock-urile implicite numărate (§5.9) |
| L07 | Gărzi în BD pe PV (R1–R3, și după închiderea cererii) și pe telefon; scrierile doar prin RPC (§5.2, §5.8) |
| L08 | Operator din `auth.uid()`; proveniența telefonului și `metoda_semnare` setate de server, imuabile; anonim doar prin token (§5.2, §5.4) |
| L09 | Nivelul Redări verificat pe proiectul fiecărui PV / deținător atins (§5.8) |
| L10 | Codul ca HMAC cu secret propriu; în clar doar criptat ≤ 10 minute; sesiunea ca hash; nimic în jurnale (§5.5, §5.10) |
| L11 | n/a (fără extragere) |
| L12 | Refuzurile au motiv din listă închisă; nimic nu dispare tacit (§5.8) |
| L13 | Formatul tokenului / codului / hash-ului ancorat (`^…$`), testat pozitiv și negativ (§5.8) |
| L14 | O migrare pe felie, cu revenire și probă apply → rollback → re-apply (§8) |
| L15 | S2, S3, S5 schimbă vederi, triggere și RPC-uri publice: amprenta globală și manifestul, ca la celelalte migrări Redări (§8) |
| L16 | UNIQUE parțial „o cerere activă pe PV”; un singur cod activ pe cerere; identitatea documentului = sha256 pe octeți (§5.2, §5.5) |
| L17 | Expirările pe timestamp exact, ora serverului; intervalul 08–20 în Europe/Bucharest; probate cu ceas controlat (§5.5, §8) |
| L18 | Eroare ≠ „nu există PV de semnat”: pagina arată eroarea separat (§5.7) |
| L19 | Regula de stare și regula de acoperire în JS și SQL, cu test de paritate (§5.2, §5.12) |
| L20 | Tranzițiile cererii dintr-un tabel; teste pe căile legitime (retragere, refuz, expirare, blocare, contestație) (§5.2) |
| L21, L22 | n/a (fără AI) |
| L23 | Listele de cereri / dovezi citite cu keyset (§5.8) |
| L24 | Pagina publică: token de generație la schimbarea linkului, ca formularul de azi (`RedariRaspunsPublic.jsx:109-110`); rezultatele legate și de cerere / hash, nu doar de token (§5.5) |
| L25 | Probe ca `anon` și ca non-owner, două sesiuni reale pentru concurență, fixture-uri cu FK reale, ceas și transport controlate (§8) |

---

## 11. Istoric

- **17.11.2026, r1** — prima versiune (PR #1116, draft).
- **17.11.2026, r2** — după review-ul documentului: secțiunea nouă „Ce trebuie decis înainte de prima felie de cod” (§1); modelul de
  amenințări (§4.2) și proveniența telefonului (§5.4); lanțul documentelor cu hash calculat de server (§5.3); contractul codului și al
  sesiunii de acces (§5.5); limitele persistente și atacul de blocare (§5.6); ce se vede înainte de cod (§5.7); calea veche de semnare
  (§5.2); ordinea completă a lock-urilor (§5.9); SMS-ul cu cod și octeții în BD (§5.10); contestația (§5.12); „nemodificabil prin
  aplicație” și ancora independentă (§5.14); riscul cheii comune în e-mail (§6.3); fișa și GDPR completate (§7); întrebările Î11–Î15 și
  încadrarea juridică formulată ca întrebare (§3, §9.2); corecturile din starea de azi (§2); D12 scoasă (decizia din 17.11).
