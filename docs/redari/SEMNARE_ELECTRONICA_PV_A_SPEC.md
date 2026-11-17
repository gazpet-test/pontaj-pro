# Redări Lot 1 — semnarea electronică de la distanță a PV-ului tip A + e-mailul către proprietari (SPECIFICAȚIE)

Stare: 17.11.2026. **Doar document.** Nu există cod, migrare sau schimbare de date în acest PR. Nimic de aici nu e aprobat: fiecare
alegere marcată „de decis” o ia owner-ul, iar fiecare afirmație juridică marcată „de validat” o confirmă avocatul / Juridic.
**Documentul nu afirmă că vreo variantă e legală sau valabilă.**

Cuprins: 0. De ce · 1. Starea de azi · 2. Variantele · 3. Recomandarea · 4. Proiectarea variantei recomandate · 5. E-mailul către
proprietari · 6. Fișa de securitate și GDPR · 7. Etapele de livrare · 8. De decis și întrebări pentru avocat · 9. Lecțiile L01–L25.

---

## 0. De ce

Planul procedurii de predare a terenurilor (rev. 1, trimis beneficiarului) spune la pct. 4.4 că deținătorul poate alege, în formularul
online, opțiunea:

> „Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.”

și continuă: Antreprenorul generează din registru PV-ul tip A completat și îl transmite proprietarului spre semnare, electronic.
„PV-ul semnat astfel are aceeași valoare ca unul semnat la sesiune. Declarația online singură e probă a lipsei obiecțiilor, nu ține
locul semnăturii.” Aceeași frază apare în modelul de convocator (rev. 1) și în modelul de e-mail către proprietari trimis
beneficiarului. Semnarea prin poștă nu se mai folosește.

**În platformă nu există azi niciun flux de semnare electronică**, iar e-mailul către proprietari (felia F2) e construit doar parțial și
are transportul oprit. Specificația descrie ce ar trebui construit, ce variante există, ce recomandăm și ce trebuie decis înainte de
prima linie de cod.

---

## 1. Starea de azi (cu fișier:rând)

### 1.1 Ce se întâmplă după opțiunea „nu particip, fără obiecții”

1. **Formularul public** (`src/RedariRaspunsPublic.jsx`) înregistrează răspunsul prin RPC-ul `fn_red_raspuns_public`
   (`supabase/migrations/20261126a_redari_teren.sql:724-781`). Pentru această opțiune cere bifarea declarației
   (`RedariRaspunsPublic.jsx:152`, garda în BD la `20261126a:760` și în trigger la `:457`).
   - **Textul de azi nu spune nimic despre semnarea electronică.** Descrierea opțiunii: „Sunt de acord ca procesul-verbal să fie
     întocmit în lipsa mea.” (`RedariRaspunsPublic.jsx:21`); declarația implicită: „… sunt de acord ca procesul-verbal să fie întocmit
     în lipsa mea.” (`:26`). Declarația se poate înlocui pe proiect din `red_proiecte.text_declaratie` (`:141`); ce text are proiectul
     real nu verificăm aici (se citește din BD de chat).
   - **Decizia 6** (01.11): răspunsul nu trimite nimic și nu generează PV; operatorul face totul din Registru (`RedariRaspunsPublic.jsx:10`,
     `docs/redari/README.md:115`).
2. **Starea perechii (parcelă, deținător)** devine „A răspuns — fără obiecții” (`src/redari/stare.js:103`, rangul 5 din `:14`).
3. **PV-ul A** îl creează și îl generează operatorul (admin / editor) din fișa parcelei: `ModalPv.jsx` → `fn_red_pv_creeaza`, apoi
   „Generează DOCX” (`src/redari/ui/ModalPv.jsx:191-222`). Rezultatul e un **DOCX** în bucketul `redari`, versionat pe cale
   (`src/redari/pv.js:314-327`, `:375-392`). Nu există conversie DOCX → PDF în platformă.
4. **„Trimis spre semnare”** = un buton care schimbă doar starea și data (`ModalPv.jsx:325`, `:247`). Nu trimite nimic, nu
   leagă nicio dovadă. Starea parcelei devine „PV trimis spre semnare” (`stare.js:97`, rangul 3).
5. **„Semnat”** = operatorul încarcă un scan PDF / JPG / PNG (`ModalPv.jsx:249-260`, `pv.js:328-340`), cu bifele „Semnat fizic” și
   „Semnat la sesiune” (`ModalPv.jsx:327-328`). Baza de date cere pentru `semnat` data primirii și calea scanului
   (`supabase/migrations/20261129c_redari_pv_stari.sql:35-37`) și îngheață rândul după semnare (`:22-24`). Tranzițiile permise:
   `generat → trimis_spre_semnare | semnat | anulat`, `trimis_spre_semnare → semnat | anulat` (`:26-27`).
6. **PV C pe tronson** împarte PV-urile A semnate în „la sesiune” și „corespondență” după bifa `semnat_la_sesiune`
   (`pv.js:399-402`; coloana din `20261129a_redari_pv_schema.sql:37`). Un PV semnat electronic ar cădea azi la „corespondență”.
7. **Coloane pregătite, nefolosite:** `red_raspunsuri.semnatura_electronica_ref` (`20261126a:216`) și `red_procese_verbale.semnatari`
   (jsonb, `20261126a:241`). Niciun ecran nu le scrie.
8. Ghidul notificărilor spune încă „trimis spre semnare prin poștă” la PV A (`docs/redari/GHID_NOTIFICARI.md:28`).

### 1.2 Ce canale există

| Canal | Ce face azi | Unde |
|---|---|---|
| Link personal + QR din convocator | Duce la formularul public `/redari/raspuns/:token`. Tokenul are 43 de caractere aleatoare, e generat în BD, nu se schimbă, expiră la ultima zi de sesiune a UAT-ului + 30 de zile. Pagina nu afișează date personale. Limite: 30 de cereri / IP / 10 min și 5 / token / 10 min. | `20261126a:175-180`, `:295-300`, `:676-722`, `:286-292`; `RedariRaspunsPublic.jsx:9`, `:319` |
| SMS (SMSLink) | Doar loturi pe UAT, cu șablon fix, create de admin / editor și aprobate de owner. Confirmarea de livrare (DLR) vine prin `sms-dlr`. Comutatorul Redări e oprit până la autorizarea scrisă a beneficiarului și textul final; cât timp șablonul e „provizoriu”, merge doar pe proiecte `TEST-…`, cu cel mult 5 destinatari. | `docs/sms/ACTIVARE_SMS_REDARI.md:3-24`; `20261130a_sms_mvp.sql:70`, `:77`; `supabase/functions/sms-dlr/index.ts:1-3` |
| E-mail F2 (`redari@`) | Loturi aprobate de owner, construite parțial. **Transportul real e oprit în cod** și în BD; lipsesc OAuth de trimitere, Gmail, reconcilierea, DKIM / DMARC. | `supabase/functions/_shared/redariMailF2.mjs:4`, `:85-86`; `20261131a_redari_mail_f2_loturi.sql`; `docs/redari/RAPORT_F2_EMAIL.md:189-197` |
| Poșta / curierul cu confirmare | Canalul obligatoriu al convocării. E-mailul și SMS-ul sunt doar în plus. | `docs/redari/PLAN_EMAIL_REDARI.md:440-447`, `:909` |

### 1.3 Ce date avem despre deținător

- Telefonul și e-mailul stau în `red_detinatori_contact` (`20261126a:182-189`), vizibile doar pentru admin / editor. Vin din tipizatul
  beneficiarului (Anexa 7) sau le introduce operatorul. **Formularul public nu cere telefon sau e-mail** (`RedariRaspunsPublic.jsx:319`).
  Câmpul opțional de e-mail din formular e planificat (felia F1b, `PLAN_EMAIL_REDARI.md:845-848`), nu construit.
- Regula pentru specificație (din plan și din condițiile e-mailului): **folosim doar telefonul / e-mailul dat de beneficiar sau
  confirmat de deținător.** Cum se „confirmă” un număr e o decizie deschisă (§8, D3).
- Modelul de PV A cere „Act de identitate (serie, nr.)” și „Act doveditor al calității”. La distanță nu le vedem (vezi §4.6).

---

## 2. Variantele de semnare electronică

Încadrarea după Regulamentul (UE) nr. 910/2014 („eIDAS”), modificat prin Regulamentul (UE) 2024/1183, așa cum o înțelegem; **toată
coloana „încadrare” e de validat de avocat.** Pe scurt, regulamentul definește trei niveluri: semnătura electronică (simplă),
semnătura avansată (legată unic de semnatar, îl identifică, creată cu date aflate sub controlul lui exclusiv, orice modificare
ulterioară a documentului se poate detecta — art. 26) și semnătura calificată (avansată + certificat calificat + dispozitiv
calificat). Din câte înțelegem textul art. 25: unei semnături nu i se poate nega efectul juridic doar pentru că e electronică sau nu e
calificată, dar **numai cea calificată are, prin regulament, efectul unei semnături olografe**. Pentru celelalte, efectul îl dă legea
națională (Legea nr. 214/2024, care a înlocuit Legea nr. 455/2001) și aprecierea instanței. De aici vine întrebarea centrală pentru
avocat: ce înseamnă, pentru fiecare variantă, fraza din plan „aceeași valoare ca unul semnat la sesiune”.

| | A. Semnătură simplă în platformă (link + cod SMS) | B. PDF tipărit, semnat de mână, fotografiat și încărcat | C. Semnătură avansată / calificată la un furnizor extern | D. Doar declarația online + PV tip B |
|---|---|---|---|---|
| **Ce vede deținătorul** | Pagina din linkul personal (același QR / link din scrisoare); cere un cod pe SMS la numărul cunoscut; după cod vede PV-ul A complet; bifează acordul, își tastează numele (opțional desenează semnătura); primește confirmarea și PDF-ul final. | Descarcă PDF-ul (din același link, după cod) sau îl primește pe e-mail; îl tipărește, semnează, fotografiază, încarcă prin link. | Un e-mail / SMS de la furnizor; identificare (video, CEI, aplicație); semnează în aplicația furnizorului. | Nimic în plus față de formular. |
| **Ce dovadă rămâne** | Hash-ul PDF-ului afișat; momentul (ora serverului); canalul; numărul mascat la care a plecat codul și confirmarea de livrare; codul verificat (doar faptul și ora, nu codul); numele tastat; versiunea textului de acord; IP / browser (de decis, §6); totul legat de token și de PV, nemodificabil; pagina de dovezi lipită la PDF. | Imaginea / scanul cu semnătura olografă + aceleași metadate de încărcare. E o copie a unui document semnat olograf; originalul hârtie rămâne la deținător. | Fișierul semnat (PAdES), verificabil cu orice validator; dovezile furnizorului (identificare, jurnal). | Răspunsul online (`red_raspunsuri` + `red_raspunsuri_meta`); PV B semnat de comisie. |
| **Încadrare (de validat)** | Semnătură **simplă**. Unele elemente ale celei avansate sunt prezente (legătura cu un număr de telefon, detectarea modificării prin hash), dar „controlul exclusiv” și identificarea sunt discutabile. | Semnătură **olografă** pe hârtie, transmisă ca imagine; imaginea în sine nu e semnătură electronică avansată. | **Avansată** sau **calificată**, după produs. | Nicio semnătură a deținătorului. |
| **Cost** | Un SMS per cod (tariful din contractul SMS existent, 1–3 SMS per semnătură); dezvoltare internă (§7). | Zero extern; timp de operator la verificarea imaginii. | De cerut ofertă (n-am verificat prețuri): de regulă per semnătură / per identificare, plus abonament / integrare. | Zero. |
| **Ce cere de la beneficiar / avocat** | Acceptarea beneficiarului că PV-ul A semnat așa îndeplinește condiția din acordul de mediu; opinia avocatului pe efectul semnăturii simple; text de acord + SMS validate; pagina de dovezi; modificări în modelul PV A (§4.6). | Acceptarea copiei ca dovadă; eventual cererea originalului ulterior. | Acceptarea furnizorului ca sub-împuternicit (art. 28 GDPR) dacă primește date; contractul cu furnizorul. | Nimic nou, dar **nu respectă fraza din plan** (vezi mai jos). |
| **Riscuri** | Telefon greșit sau comun (soți, familie); link + telefon ajunse la altcineva; contestarea identității; dependență de SMS; trimiterea codului pornită de un anonim (abuz / cost — limitat, §4.3). | Imagine ilizibilă sau falsificată ușor; fără legătură criptografică între imagine și PDF; mulți deținători nu au imprimantă. | Puțini proprietari de teren (vârstnici, rural) au sau vor să facă identificare video / certificat; abandon mare; cost; încă un sub-împuternicit. | Contrazice planul trimis beneficiarului („declarația online singură … nu ține locul semnăturii”); parcela rămâne fără semnătura cerută de acordul de mediu. |

**D trebuie spus explicit:** varianta D nu e o variantă de semnare. Rămâne calea pentru cei care nu semnează deloc (plan, pct. 4.4,
ultima frază), nu un înlocuitor al semnăturii.

**Variantă de urmărit, nu de construit acum:** portofelul european de identitate digitală (eIDAS 2) ar trebui să permită
persoanelor fizice semnătura calificată gratuită pentru uz neprofesional. Stadiul în România la data semnărilor e **de verificat**;
dacă devine disponibil, ar putea înlocui C fără cost.

---

## 3. Recomandarea

**A ca variantă principală, B ca rezervă, contrasemnarea Gazpet / Transgaz separat; C doar dacă avocatul spune că A nu ajunge.**

De ce:
1. **A e singura care se potrivește oamenilor** (proprietari de teren din mediul rural, mulți vârstnici): un link pe care îl au deja
   (QR-ul din scrisoarea recomandată) și un cod pe telefon. C ar avea abandon mare; B cere imprimantă.
2. **A leagă doi factori independenți:** scrisoarea primită cu confirmare de primire (linkul personal) și telefonul comunicat de
   beneficiar (codul). Cine are doar unul dintre ele nu poate semna. Asta e mai mult decât „un click pe un link”.
3. **A lasă dovada cea mai bogată** dintre variantele ieftine (hash, momentul, telefonul, livrarea codului), iar pagina de dovezi se
   poate verifica oricând față de fișierul din bucket (fișierele din `redari` nu se pot modifica sau șterge de aplicație,
   `20261126a:22-24`, `:1003-1007`).
4. **B acoperă cine nu are telefon cu internet** sau nu are număr la beneficiar, prin același link, fără canal nou. **Atenție:** la B
   linkul + codul SMS tot sunt necesare ca să descarce PV-ul (PV-ul conține date personale). Fără telefon deloc, rămân sesiunea sau
   PV-ul B.
5. **Nu trimitem linkul pe SMS.** Codul vine pe SMS; linkul vine pe hârtie (QR) și, unde există, pe e-mail. Dacă linkul și codul ar
   veni pe același SMS, cei doi factori ar deveni unul singur (telefonul).
6. **Opțional, pentru integritate (de decis, D9):** PDF-ul final se sigilează cu sigiliul electronic calificat al Gazpet și o marcă
   temporală calificată. Nu schimbă natura semnăturii deținătorului (rămâne simplă), dar face orice modificare ulterioară vizibilă
   oricui, cu un validator standard.

---

## 4. Proiectarea variantei recomandate (A + B)

### 4.1 Fluxul, pas cu pas

**Operatorul (admin / editor Redări, în ERP):**
1. **Precondiții** (verificate în BD, nu doar în UI): ultimul răspuns al deținătorului este „nu particip, fără obiecții” (online, cu
   declarația bifată); PV-ul A al perechii există și e `generat` (sau `trimis_spre_semnare` fără cerere activă); verificarea parcelei pe
   teren e completată (data + comisia, pentru că PV-ul A „la distanță” se sprijină pe ea, §4.6); deținătorul are telefon cu sursă
   acceptată (§8, D3); nicio altă cerere activă pe PV.
2. **PDF-ul de semnat:** operatorul generează DOCX-ul ca azi, îl salvează ca PDF (pentru pilot: din Word, §8 D6) și îl încarcă în
   ecranul nou „Trimite spre semnare electronică”. Platforma verifică semnătura de fișier `%PDF-`, mărimea, calculează SHA-256 și îl
   arată operatorului pagină cu pagină înainte de confirmare.
3. **Deschide cererea** (un singur RPC, L02): scrie PDF-ul la o cale nouă, nemodificabilă; creează cererea de semnare cu hash-ul,
   telefonul (doar amprenta + forma mascată) și fereastra de semnare (de decis, ex. 30 de zile); trece PV-ul în
   `trimis_spre_semnare` cu data de azi. Cererea are o cheie UUID per intenție (L04).
4. **Anunțul** către deținător (opțional, nu e canalul de semnare): e-mailul „PV-ul e gata de semnat” cu același link personal (§5),
   unde există adresă și F2 e activ; altfel un SMS fără link („deschideți linkul / QR-ul din scrisoare”), cu șablon aprobat. Fără
   anunț, deținătorul îl vede oricum când redeschide QR-ul.
5. **Urmărirea:** în Registru și în fișa parcelei apar starea cererii (deschisă / semnată de deținător / refuzată / expirată /
   retrasă) și jurnalul de evenimente. Operatorul poate **retrage** cererea (cu motiv), de exemplu ca să corecteze PV-ul.
6. **Contrasemnarea** (după semnătura deținătorului): reprezentanții Gazpet și ai beneficiarului semnează PDF-ul final (cu pagina de
   dovezi), după decizia D5. Operatorul încarcă documentul contrasemnat prin RPC-ul de finalizare, care verifică legătura cu hash-ul
   semnat și trece PV-ul în `semnat`, atomic.

**Deținătorul (pe telefon, fără cont):**
1. Deschide linkul personal (QR sau e-mail). Dacă are un PV de semnat, pagina arată **doar** că „există un proces-verbal pregătit
   pentru semnare” și ultimele 2 cifre ale numărului la care va primi codul. **Nicio dată personală înainte de cod** (aceeași regulă ca
   formularul de azi, `RedariRaspunsPublic.jsx:9`).
2. Apasă „Trimite-mi codul”. Primește un SMS cu un cod de 6 cifre, valabil 10 minute.
3. Introduce codul. Abia acum vede **PV-ul A complet** (paginile PDF-ului, exact octeții din cerere) și îl poate descărca.
4. Are trei butoane:
   - **„Semnez”**: bifează textul de acord („Am citit procesul-verbal de mai sus și îl semnez electronic, în calitatea declarată…”,
     text de la Juridic), își tastează numele, opțional desenează semnătura (D7), apasă „Semnez”. Navigatorul trimite hash-ul calculat
     din octeții afișați; serverul îl compară cu cel din cerere.
   - **„Am obiecții”**: scrie obiecțiile; se înregistrează un răspuns nou cu obiecții, iar cererea se închide ca „refuzată” (§4.5).
   - **„Încarc PV semnat de mână”** (varianta B): încarcă PDF / JPG / PNG; se înregistrează ca „semnat olograf la distanță”, de
     verificat de operator.
5. Vede confirmarea și poate descărca PDF-ul cu pagina de dovezi. Primește (dacă are e-mail și F2 e activ) o copie a confirmării.

### 4.2 Stările

**PV-ul (`red_procese_verbale.stare`) nu primește stări noi.** Se refolosesc:
- `trimis_spre_semnare` = există o cerere de semnare deschisă (sau semnată de deținător, în așteptarea contrasemnării);
- `semnat` = documentul final (semnat de deținător + contrasemnat) e încărcat; `semnat_fizic = false`, `semnat_la_sesiune = false`;
- `anulat` = ca azi, cu motiv; **refuzat cât timp există o cerere activă** (întâi se retrage cererea).

**Cererea de semnare (stare proprie, listă închisă, tranzițiile într-un tabel, L20):**

| Din | În | Cine |
|---|---|---|
| — | `deschisa` | operator (RPC de deschidere) |
| `deschisa` | `semnata_detinator` | deținătorul (RPC public, după cod) |
| `deschisa` | `incarcata_olograf` | deținătorul (varianta B) |
| `deschisa` | `refuzata` | deținătorul („am obiecții”) |
| `deschisa` | `expirata` | automat, la citire, după `expira_la` (fără cron necesar) |
| `deschisa`, `semnata_detinator`, `incarcata_olograf` | `retrasa` | operator, cu motiv |
| `semnata_detinator`, `incarcata_olograf` | `finalizata` | operator (RPC de finalizare, care trece și PV-ul în `semnat`) |

`refuzata`, `expirata`, `retrasa`, `finalizata` sunt finale. O cerere nouă pe același PV se poate deschide doar dacă nu există alta
activă (UNIQUE parțial, L16).

**Starea parcelei** (`stare.js` și vederea `red_v_stare_parcela`, aceeași regulă în ambele, cu test de paritate, L19):
- se păstrează regula 3 „PV trimis spre semnare”, **cu o excepție nouă**: un răspuns cu obiecții înregistrat **după** deschiderea
  cererii (refuzul de la §4.5) trece înaintea ei, ca parcela să apară „Obiecții de tratat”, nu „trimis spre semnare”. Azi regula 3 ar
  ascunde obiecțiile (`stare.js:97` e verificată înaintea răspunsurilor, `:100-105`). Schimbarea atinge o vedere existentă: migrare
  proprie, cu L15 și paritate JS / SQL.
- eticheta „PV trimis spre semnare” primește, în UI, detaliul „electronic: semnat de deținător, așteaptă contrasemnarea” când e cazul
  (din cerere, fără stare nouă de parcelă).

### 4.3 Obiectele de bază de date (doar lista și rolul; nimic creat aici)

Regulile casei pentru toate: tabele cu RLS pornit, `REVOKE ALL` de la `anon` / `authenticated` și acordare explicită; funcții
`SECURITY DEFINER SET search_path = public, pg_temp`, `REVOKE EXECUTE FROM PUBLIC`, `GRANT` doar pe RPC-urile dedicate; identitatea
operatorului **numai** din `auth.uid()` + `fn_red_nivel()` pe proiectul fiecărui id atins (L08, L09); erorile așteptate întoarse ca
jsonb cu motiv din listă închisă (ca `fn_red_raspuns_public`); triggerele de jurnal existente (`fn_red_jurnal`) pe tabelele cu date de
operator, **nu** pe tabelul de coduri.

**Tabele noi**

| Nume propus | Rol | Cine citește / scrie |
|---|---|---|
| `red_pv_semnari` | Cererea de semnare: PV, deținător, starea (lista de la §4.2), calea PDF-ului de semnat + SHA-256 + mărimea, telefonul ca amprentă HMAC + forma mascată + sursa (beneficiar / declarat), fereastra (`expira_la`), `versiune`, cheia UUID a intenției, cine a deschis / retras / finalizat și când, calea documentului final + hash. UNIQUE parțial: o cerere activă pe PV. | SELECT admin / editor (viewer: doar starea, prin vedere fără telefon); scriere **doar** prin RPC |
| `red_pv_semnare_coduri` | Codurile trimise: amprenta codului (cu sare + secret, **niciodată codul în clar**), creat / expiră / consumat, numărul de încercări, legătura cu mesajul SMS (pentru livrare). Rândurile se șterg la 30 de zile după închiderea cererii (dovada rămâne în tabelul de mai jos). | nimeni direct; doar funcțiile DEFINER |
| `red_pv_semnare_dovezi` | Jurnalul de dovezi, **doar adăugare** (trigger care refuză UPDATE / DELETE, ca `red_jurnal`): pagină deschisă, cod cerut, cod trimis / livrat (din DLR), cod greșit, cod verificat, document afișat (hash), acord (versiunea și hash-ul textului), nume tastat, semnătură desenată (hash + cale), semnat, refuz, încărcare olografă, retragere, finalizare. Ora serverului, IP și browser (după D8). | SELECT admin / editor; scriere doar prin RPC |
| `red_pv_semnare_sesiuni` | Cheia scurtă (30 min) dată după cod, ca paginile următoare să nu mai ceară codul; stocată ca amprentă. | nimeni direct |

**Coloane noi pe tabelele existente:** niciuna obligatorie. PV-ul rămâne cum e; modul de semnare se deduce din cererea `finalizata`.
Coloana existentă `red_raspunsuri.semnatura_electronica_ref` (`20261126a:216`) **nu** se folosește pentru PV (ține de răspuns, nu de
document, și e editabilă de `authenticated`, `20261131g_redari_stare_cost_rls.sql:262`); de decis la implementare dacă se retrage.

**Gărzi în BD (L07):**
- trigger pe `red_procese_verbale`: cât există o cerere activă, PV-ul nu se modifică (fișier generat, câmpuri, anulare); singura cale
  spre `semnat` pentru un PV cu cerere activă e RPC-ul de finalizare;
- trigger pe `red_detinatori_contact`: schimbarea telefonului **retrage automat** cererea activă a deținătorului (cu motiv „telefon
  schimbat”), ca un cod să nu mai poată pleca la alt număr pe aceeași cerere;
- CHECK-uri: hash-uri `^[0-9a-f]{64}$`, stare pe listă, `expira_la > deschisa_la`, cale în prefixul proiectului.

**RPC-uri pentru operator (`authenticated`, admin / editor pe proiectul PV-ului)**

| Nume propus | Rol |
|---|---|
| `fn_red_semnare_deschide(pv, cale_pdf, sha256, marime, cheie_uuid)` | Verifică precondițiile de la §4.1, lock-urile în ordinea de la §4.4, scrie cererea + trece PV-ul în `trimis_spre_semnare` + dovada „deschisă”, într-o tranzacție. Aceeași cheie + același conținut = același rezultat; aceeași cheie + alt conținut = refuz. |
| `fn_red_semnare_retrage(cerere, versiune, motiv)` | CAS pe versiune; cererea → `retrasa`; dovadă. PV-ul rămâne `trimis_spre_semnare` și poate fi anulat sau trimis din nou. |
| `fn_red_semnare_finalizeaza(cerere, versiune, cale_final, sha256_final, data)` | Doar din `semnata_detinator` / `incarcata_olograf`; verifică fișierul final (cale nouă, PDF); PV → `semnat` cu `fisier_semnat_path` = documentul final, `semnat_fizic = false`, `semnat_la_sesiune = false`; cererea → `finalizata`; dovadă. Totul atomic. |
| `fn_red_semnare_lista(proiect)` / vederea `red_v_pv_semnari` | Pentru Registru, fișa parcelei, centralizator, PV C (fără telefon pentru viewer). |

**RPC-uri publice (`anon`, singurele acordate lui `anon`)** — toate primesc tokenul personal, verifică formatul înainte de orice
scriere, folosesc contorul `red_rate_limit` existent (`ip:` și `t:`) și întorc același mesaj neutru pentru token inexistent,
expirat sau fără cerere (fără enumerare):

| Nume propus | Rol |
|---|---|
| `fn_red_semnare_public_stare(token)` | „Există PV de semnat?” + ultimele 2 cifre ale numărului + starea cererii. Fără nume, fără parcelă în plus față de formularul de azi. |
| `fn_red_semnare_public_cere_cod(token)` | Generează codul, îl salvează ca amprentă, pune SMS-ul în coada SMS **doar la numărul din cerere** (nu primește număr de la client). Limite: un cod nou la cel mult 60 s; 3 coduri / cerere / 24 h; 6 coduri / cerere în total; plafon zilnic pe proiect; comutatorul SMS Redări. Peste limită → mesaj „contactați-ne”. |
| `fn_red_semnare_public_verifica_cod(token, cod)` | 5 încercări pe cod; la a 5-a greșeală codul se anulează; la 3 coduri anulate cererea se blochează (doar operatorul o redeschide, ca cerere nouă). Corect → cheia de sesiune (30 min) + dovadă. |
| `fn_red_semnare_public_document(token, sesiune)` | Întoarce PDF-ul cererii (octeții, mărime plafonată) sau, dacă se alege calea cu funcție edge, un link semnat de scurtă durată (§4.7). |
| `fn_red_semnare_public_semneaza(token, sesiune, sha256_vazut, nume, versiune_acord, desen_sha256?, user_agent)` | Lock în ordinea de la §4.4; verifică: cerere `deschisa`, neexpirată, hash-ul văzut = hash-ul cererii = fișierul PV-ului; nume nevid, cu limită de lungime; versiunea textului de acord = cea curentă. Scrie dovada și trece cererea în `semnata_detinator`. Repetarea cu aceleași date întoarce același rezultat (idempotent); a doua semnare concurentă primește „deja semnat”. |
| `fn_red_semnare_public_refuza(token, sesiune, obiectii)` | Înregistrează în `red_raspunsuri` un răspuns `online`, opțiunea „nu particip, cu obiecții”, cu textul (aceeași validare ca formularul, max 4.000 de caractere), cererea → `refuzata`, dovadă. Atomic. |
| `fn_red_semnare_public_incarca_olograf(token, sesiune, …)` | Doar pentru B. Anonimul nu poate scrie în Storage: încărcarea trece printr-o funcție edge cu poartă pe token + sesiune, sau fișierul (plafonat, ex. 10 MB) intră ca octeți prin RPC. De ales la felia B. |

### 4.4 Concurență și ordinea lock-urilor (L01, L06)

Ordinea unică pe toate căile (operator și public): **PV `FOR UPDATE` → cererea `FOR UPDATE` → codurile (după id)**. Scrisă în
comentariul fiecărui RPC. Verificările de stare, hash și limite se fac după lock. Cazuri care trebuie să iasă corect:
- deținătorul semnează pe două telefoane deodată → exact una reușește, cealaltă vede „deja semnat”;
- operatorul retrage cererea exact când deținătorul semnează → câștigă cine ia primul lock-ul; celălalt primește motivul exact;
- operatorul schimbă telefonul în timp ce deținătorul cere cod → retragerea automată și cererea de cod se serializează pe cerere;
- rezultat ambiguu în browser (rețea căzută după „Semnez”) → pagina recitește starea cu aceeași sesiune; nu retrimite semnarea cu alte
  date (L05).

### 4.5 Cazurile urâte

| Caz | Ce se întâmplă |
|---|---|
| **Coproprietari** | Fiecare are PV-ul A propriu (PV-ul A e pe deținător, `20261126a:245-248`), deci fiecare semnează separat, cu telefonul lui. Parcela e „acoperită” abia când au semnat toți proprietarii activi (`pv.js:227-235`). Doi coproprietari cu **același număr** de telefon: de decis (D10). |
| **Utilizator / arendaș** | Semnează separat, pentru folosința curentă (plan, pct. 4.7); PV-ul lui semnat acoperă parcela după regula de azi (`pv.js:231`). Același flux. |
| **Moștenitor** | Doar dacă beneficiarul l-a comunicat ca moștenitor (actul doveditor nu se poate verifica la distanță); altfel sesiune. De confirmat cu avocatul (Î6). |
| **Telefon greșit** | Codul ajunge la altcineva, care nu are linkul (scrisoarea); deținătorul nu primește codul și sună. Telefonul se corectează doar din sursa acceptată (D3); corectarea retrage automat cererea; se deschide alta. **Nu se schimbă numărul la telefon, la cererea cuiva care spune că e deținătorul.** |
| **Cod expirat / greșit** | Mesaj clar, buton „cere alt cod” în limitele de la §4.3; după limite → „contactați-ne”, cererea blocată, operatorul vede motivul. |
| **Se răzgândește, are obiecții după ce a văzut PV-ul** | Butonul „Am obiecții” (§4.1). Răspunsul cu obiecții devine ultimul răspuns; parcela trece la „Obiecții de tratat” (§4.2); PV-ul se corectează / anulează de operator; cererea e `refuzata`. |
| **Se răzgândește după ce a semnat** | Semnătura rămâne (dovada nu se șterge). Ce se întâmplă juridic cu o retragere după semnare: întrebare pentru avocat (Î7). Operatorul poate să nu finalizeze (retrage cererea) până la clarificare. |
| **Link redirecționat altcuiva** | Fără codul de pe telefonul deținătorului, cel care are linkul nu vede PV-ul și nu poate semna. Dacă deținătorul dă singur și codul, dovezile arată ce s-a întâmplat; riscul rezidual e scris în pagina de acord („nu dați codul nimănui”). |
| **Două semnări concurente** | §4.4. |
| **PV regenerat după trimitere** | Imposibil cât cererea e activă (garda din BD). Ca să corecteze, operatorul retrage cererea, regenerează, deschide cerere nouă (hash nou). Orice nepotrivire între hash-ul văzut, cel al cererii și fișierul PV-ului = refuz „documentul s-a schimbat; așteptați un link nou”. |
| **Token expirat** | Tokenul de răspuns expiră la ultima zi de sesiune + 30 de zile (`20261126a:295-300`). Semnarea folosește fereastra **cererii** (`expira_la`), nu expirarea răspunsului: RPC-urile de semnare acceptă tokenul doar dacă are o cerere activă în fereastră. Formularul de răspuns rămâne închis după expirare, ca azi. |
| **Deținătorul fără telefon / fără smartphone** | B (dacă are cum descărca PDF-ul — tot cu cod), altfel sesiunea sau PV-ul B. |
| **Deținător decedat / calitate contestată** | Operatorul retrage cererea; situația merge la beneficiar. |

### 4.6 Ce trebuie schimbat în texte (de la Juridic, nu de la noi)

- **Formularul public:** descrierea opțiunii și declarația implicită spun „întocmit în lipsa mea” (`RedariRaspunsPublic.jsx:21`, `:26`),
  pe când planul și convocatorul spun „sunt de acord să primesc procesul-verbal completat, spre semnare, electronic”. Trebuie aliniate.
  Juridic a lăsat deja deschisă decizia „doar electronic” (dialogul Juridic din 17.11.2026, §3).
- **Modelul PV A** (șablonul `pv_a.docx`):
  - secțiunea 2, „Act de identitate (serie, nr.)”: la distanță nu se completează; mențiunea propusă „semnat electronic de la distanță;
    identificare prin linkul personal din convocare și cod trimis pe telefon” — text de la Juridic;
  - secțiunea 4, „Constatarea s-a făcut”: are doar „la sediul Primăriei” și „pe teren”; lipsește „de la distanță, pe baza declarației
    online a deținătorului și a verificării comisiei pe teren la data …”;
  - secțiunea 7, „Încheiat în 3 exemplare”: pentru documentul electronic, formularea se schimbă;
  - **modelul a fost trimis beneficiarului**: o schimbare de model poate cere din nou acordul lui (Î9).
- **Pagina de dovezi** (anexa PDF-ului final): numărul PV-ului, hash-ul documentului semnat, ora serverului, numărul mascat, ora
  livrării codului, ora verificării, numele tastat, textul de acord (versiunea), mențiunea că deținătorul a semnat electronic. Text
  stabilit cu Juridic. **Fără „generat automat” și fără nume de unelte** (regula „fără AI în ce ajunge la oameni”).
- **SMS-ul cu codul:** șablon fix, de aprobat (Juridic + owner + beneficiar), un segment GSM-7, de forma „Gazpet pt Transgaz: codul
  pentru semnarea procesului-verbal de predare a terenului este 123456. Valabil 10 minute. Nu îl dați nimănui.” (doar propunere).
- **PV C:** coloana „PV A prin corespondență” (`pv.js:399-402`) ar număra și semnăturile electronice. De decis cu Juridic dacă apare o
  coloană / mențiune separată „semnat electronic”.
- **Ghidul notificărilor:** „trimis spre semnare prin poștă” (`GHID_NOTIFICARI.md:28`) se actualizează odată cu livrarea.

### 4.7 Ce se păstrează ca dovadă, unde și cât timp

| Ce | Unde | Cât |
|---|---|---|
| PDF-ul supus semnării | bucketul `redari`, cale nouă, nemodificabilă | ca PV-ul: până la sfârșitul perioadei de garanție din contract (termenul din informare) |
| PDF-ul final (cu pagina de dovezi, contrasemnat) | bucketul `redari`, `fisier_semnat_path` | idem |
| Jurnalul de dovezi | `red_pv_semnare_dovezi` | idem |
| Amprentele codurilor, sesiunile | tabelele lor | 30 de zile după închiderea cererii, apoi șterse |
| IP / browser | în jurnalul de dovezi (dacă D8 = A sau C) | ca dovezile; de validat de avocat |
| Semnătura desenată (dacă D7 ≠ A) | bucketul `redari`, cale nouă | ca PV-ul |

**Afișarea PDF-ului către anonim.** Anonimul nu are acces la bucket. Două căi, de ales la felia publică: (1) PDF-ul supus semnării se
păstrează și ca octeți în BD (plafonat, ex. 2 MB), iar RPC-ul public îl întoarce după cod — **fără `service_role`**; (2) o funcție edge
care verifică tokenul + sesiunea prin RPC și dă un link semnat de 5 minute — cere `service_role` pentru Storage, deci justificare și
poartă (fișa §6). Recomandăm (1). Afișarea paginilor pe telefon: `pdfjs-dist` e deja dependență (folosită azi pe server, în `api/`);
folosirea în browser e nouă și se verifică la build. Altfel, PDF-ul se deschide în vizualizatorul telefonului (pe unele telefoane se
descarcă în loc să se afișeze).

**Unirea PDF-ului cu pagina de dovezi.** `pdf-lib` e în dependențe, dar a avut probleme la build pe Vercel cu importurile dinamice; de
probat. Dacă nu merge, documentul final rămâne două fișiere (PV-ul + anexa de dovezi) legate prin hash, iar contrasemnarea le cuprinde
pe amândouă.

### 4.8 Ce apare în dosarul parcelei și în PV C

- **Fișa parcelei:** cererea, starea, istoricul de dovezi (fără telefon pentru viewer), PDF-ul supus semnării, documentul final.
- **Registru / centralizator:** coloană „semnare electronică” (deschisă / semnată de deținător / refuzată / expirată / finalizată).
- **Export Model_6:** coloană separată, fără date de contact.
- **PV C:** numără PV-ul A semnat electronic după decizia de la §4.6.
- **Dosarul predat beneficiarului:** documentul final + pagina de dovezi; jurnalul complet la cerere.

---

## 5. E-mailul către proprietari

### 5.1 Modelul transmis beneficiarului

Subiect „Predarea terenului după lucrările la conducta de gaze – sesiune la Primăria {COMUNA}”; corpul invită la sesiune, amintește
convocarea scrisă, dă linkul personal de răspuns `{LINK_RASPUNS}`, spune că cine nu poate veni și nu are obiecții primește PV-ul
„spre semnare, electronic”, că mesajul privește doar starea terenului, dă linkul informării și semnătura „în numele și cu
împuternicirea” beneficiarului. Condiții: **doar în plus față de convocarea scrisă; doar la adresa dată de beneficiar sau confirmată
de deținător; un mesaj de persoană; fără date despre parcelă; `{LINK_RASPUNS}` = același link personal ca în QR.**

### 5.2 Ce lipsește din F2 ca să poată pleca

| Lipsă | Unde se vede |
|---|---|
| Transportul real (oprit în cod: `TRANSPORT_REAL_ACTIV = false`; procesarea refuză din prima instrucțiune) | `redariMailF2.mjs:4`, `:85-86` |
| OAuth de trimitere pe `redari@`, tokenul în Vault, wrapperul Gmail unic | `PLAN_EMAIL_REDARI.md:858-861`, `:884-890` |
| Reconcilierea rezultatelor și monitorizarea „Trimise” | `RAPORT_F2_EMAIL.md:193` |
| Autentificarea expeditorului: DKIM lipsă, DMARC `p=none` fără rapoarte; precondiție F2 = DKIM + DMARC cu rapoarte | `PLAN_EMAIL_REDARI.md:162-165`, `:871` |
| Informarea publicată (garda refuză altfel) | `redariMailF2.mjs:40`; pagina informării, PR #939 |
| Textul validat de Juridic și aprobat de beneficiar (modelul de la §5.1) | dialogul Juridic din 17.11.2026 |
| Atașamente: modulul acceptă un singur PDF; generarea / legarea PDF-ului în snapshot nu e făcută | `redariMailF2.mjs:31`, `RAPORT_F2_EMAIL.md:193` |
| Tipul de mesaj „PV gata de semnat” (azi loturile au doar mesaje text de convocare) | migrare F2 nouă |
| Validarea L15 completă, DRY, concurența, apply → rollback → re-apply | `RAPORT_F2_EMAIL.md:85-92`, `:195` |

### 5.3 Legătura cu semnarea

- **E-mailul nu e canalul de semnare și nu poartă PV-ul ca atașament.** PV-ul are date personale și date despre parcelă, iar condiția
  e „fără date despre parcelă”. E-mailul duce doar linkul personal; PV-ul se vede după codul SMS.
- Două mesaje posibile, ambele cu același link personal: (1) **convocarea** (modelul de la §5.1), înainte de sesiune; (2) **„PV-ul
  dumneavoastră e gata de semnat”**, după deschiderea cererii — model nou, de la Juridic, aprobat de beneficiar.
- Ambele intră în loturile aprobate de owner (regula F2, `redariMailF2.mjs:37-45`); fără trimitere automată la deschiderea cererii
  (decizia 6 rămâne: nimic nu pleacă singur).
- Cine s-a dezabonat de la e-mail poate semna în continuare prin QR.
- Un singur `To`, fără copie (`redariMailF2.mjs:71-83`).

---

## 6. Fișa de securitate (CLAUDE.md pct. 7) și GDPR

**(a) Conținut extern citit:** tot ce tastează deținătorul — codul, numele, textul obiecțiilor, semnătura desenată, fișierul încărcat
la B, antetul `User-Agent`; plus confirmările de livrare SMS (DLR) de la furnizor. Toate sunt **date**: niciun text tastat nu poate
porni o acțiune în afara celei alese prin buton, iar textul obiecțiilor nu e interpretat de nimic automat.

**(b) Ce scrie / face:** scrie cererea, codurile (amprente), sesiunile, jurnalul de dovezi, un răspuns nou în `red_raspunsuri` (la
refuz), fișiere noi în bucketul `redari` (doar căi noi; nimic suprascris sau șters). **Trimite SMS-uri** (codul) prin coada SMS
existentă — **doar** la numărul din cerere, niciodată la un număr venit de la client. Nu atinge bani, drepturi de acces sau setări.
Trece PV-ul în `semnat` **doar** prin RPC-ul de finalizare al operatorului, nu prin acțiunea deținătorului.

**(c) Identitatea:** RPC-urile publice rulează `SECURITY DEFINER` (ca formularul de azi), cu `search_path` fix, fără `service_role`.
RPC-urile operatorului verifică `auth.uid()` + nivelul Redări pe proiectul PV-ului. Trimiterea SMS-ului folosește calea existentă a
modulului SMS. Singurul loc unde ar apărea `service_role` e varianta (2) de la §4.7 (nerecomandată) sau încărcarea olografă prin
funcție edge (de justificat la felia B).

**(d) Cine pornește:**
- operatorul: doar admin / editor Redări, verificat în BD (nu doar în UI);
- anonimul: doar cu tokenul personal + o cerere activă; limitele de la §4.3 (IP, token, coduri, încercări, plafon zilnic pe proiect,
  comutatorul SMS Redări); SMS-ul pleacă doar la numărul cunoscut, deci un atacator nu poate folosi pagina ca să trimită SMS-uri în
  altă parte; cel mai rău caz cu un link furat: câteva SMS-uri la numărul deținătorului.

**(e) Ce cere confirmare umană:**
- deschiderea fiecărei cereri (operatorul, după ce vede PDF-ul);
- finalizarea (operatorul, după contrasemnare);
- **regula tare din pct. 7 se aplică** (citește conținut extern și trimite SMS): poarta e că SMS-ul are text fix aprobat, merge doar la
  număr dat de beneficiar / confirmat, și doar după o cerere deschisă de un om;
- pornirea comutatorului SMS Redări (owner, după autorizarea scrisă a beneficiarului), textul codului, orice lot de e-mail — ca azi.

Toată automatizarea nouă primește rând în `public.automatizari` și în `registru_automatizari` la livrare (fără valori de secrete).

**GDPR — date noi prelucrate și minimul propus:**

| Dată | Propunere minimă | De validat |
|---|---|---|
| Codul SMS | Doar amprenta, ștearsă la 30 de zile după închiderea cererii; codul în clar nu se salvează nicăieri (nici în jurnalul SMS) | da — atenție la textul SMS-ului salvat în modulul SMS (de mascat codul) |
| Telefonul folosit | Deja în evidență; în cerere doar amprentă + ultimele cifre | — |
| IP + browser la semnare | De decis (D8). Precedent: formularul de azi le păstrează deja (`red_raspunsuri_meta`, `20261126a:221-225`) | da |
| Numele tastat, acordul, ora | Parte din dovadă | — |
| Semnătura desenată | Doar dacă D7 ≠ A | da |
| PV-ul afișat online | Doar după cod; fără cache public; tokenul nu ajunge în `Referer` (deja: `RedariRaspunsPublic.jsx:112-120`) și e mascat în rapoartele de erori | — |

**Ce trebuie adăugat în informare** (textul îl dă Juridic; informarea rev. 1 are deja telefonul, e-mailul, „semnătura și observațiile
din procesul-verbal” și furnizorul SMS): scopul nou „semnarea electronică a procesului-verbal”; codul trimis pe SMS și păstrarea lui
doar ca amprentă; datele tehnice de la semnare (IP, browser, ora), dacă se păstrează, și cât; afișarea PV-ului online după cod;
eventualul furnizor de semnătură (doar la C) sau de marcă temporală / sigiliu (D9). Cât timp informarea nu e publicată, fluxul nu
pornește pe date reale (aceeași regulă ca la e-mail).

---

## 7. Etapele de livrare

Fiecare felie = branch + PR draft + review (Jakarinos + Fable / Copilot) + migrare proprie cu revenire și test (apply → rollback →
re-apply pe clonă, făcut de chat) acolo unde există. Estimările sunt orientative, **fără rundele de review** (istoric 2–5 runde pe
migrare în Redări).

| Felie | Ce conține | Migrare | Depinde de | Estimare | Ce se probează fără date reale |
|---|---|---|---|---|---|
| **S0 — decizii** | Răspunsurile la §8 (owner) și opinia avocatului; acceptarea beneficiarului pentru A + B și pentru schimbarea modelului PV A | — | — | — | — |
| **S1 — texte** | Opțiunea și declarația din formular aliniate cu planul; șablonul PV A (§4.6); textul de acord; pagina de dovezi; SMS-ul cu cod; e-mailul „PV gata” | — (doar șabloane / UI text) | Juridic, beneficiar | 0,5–1 zi după texte | Generarea DOCX pe proiectul de test Redări |
| **S2 — cererea (operator)** | Tabelele, gărzile pe PV și contact, RPC-urile deschide / retrage, vederea; ecranul „Trimite spre semnare electronică” (încărcare PDF, hash, previzualizare); starea în Registru / fișă | da | S0 | 2–3 zile | PGlite + DRY pe clonă (roluri, gărzi, concurență cu două sesiuni); Playwright pe proiectul de test Redări cu gardă de rețea |
| **S3 — pagina publică** | RPC-urile publice (stare, cere cod **cu SMS inert**, verifică, document, semnează, refuză); secțiunea de semnare pe pagina linkului personal; limitele; schimbarea regulii 3 din stare (JS + SQL, paritate) | da | S2, S1 | 3–5 zile | Codul nu pleacă: pe proiectele `TEST-…` operatorul vede codul în ERP (gardă în BD pe codul proiectului, ca la SMS); probe ca `anon` pe clonă; atacuri: token greșit, cod ghicit, două semnări, hash diferit |
| **S4 — codul pe SMS** | Tipul de mesaj „cod semnare” în coada SMS, șablon fix versionat, plafoane, legătura cu DLR, mascarea codului în jurnalul SMS | da | autorizarea scrisă a beneficiarului + textul final (aceleași condiții ca SMS-ul Redări) | 1–2 zile | Pe `TEST-…`, cel mult 5 numere interne, cu „da”-ul owner-ului pentru comutator |
| **S5 — finalizarea** | Pagina de dovezi (PDF), unirea / legarea cu PV-ul, RPC-ul de finalizare, contrasemnarea după D5; PV C, export, ghid | da | S3, D5, D9 | 2–3 zile | Pe proiectul de test Redări, cap-coadă, cu un telefon intern |
| **S6 — B (olograf la distanță)** | Încărcarea prin link (cale fără `service_role` sau funcție edge cu poartă), verificarea de către operator | da (mică) | S3, D2 | 1–2 zile | Fișiere ostile (PDF poliglot, imagine imensă, tip fals) |
| **S7 — e-mailul „PV gata”** | Tipul de mesaj în F2 | da (în lanțul F2) | F2 activ (§5.2) | 1 zi după F2 | Doar cu adrese interne |
| **Pilot** | Un UAT, câțiva deținători care au ales opțiunea, cu „da”-ul owner-ului pe fiecare pas | — | toate | — | — |

Ce **nu** se poate proba fără date reale: livrarea SMS la numere de proprietari, comportamentul oamenilor (abandon, telefoane comune),
acceptarea de către beneficiar a documentului final.

---

## 8. De decis și întrebări

### 8.1 De decis de owner (A / B / C)

| | Întrebare | A | B | C | Recomandare |
|---|---|---|---|---|---|
| D1 | Varianta principală | semnătură simplă în platformă cu cod SMS | doar PDF semnat olograf și încărcat | furnizor extern (avansată / calificată) | **A** |
| D2 | Rezerva pentru cine nu poate face A | PDF olograf încărcat prin același link (B) | doar sesiune sau PV B | furnizor extern | **A** |
| D3 | De unde vine telefonul acceptat pentru cod | doar de la beneficiar | + declarat de deținător în formular, marcat în dovezi | + comunicat operatorului la telefon | **A** pentru pilot; B doar după Î5 |
| D4 | Linkul de semnare | același link personal (QR / e-mail), cu fereastra proprie a cererii | link nou, trimis pe e-mail | link nou, trimis pe SMS | **A** (C pune linkul și codul pe același canal) |
| D5 | Contrasemnarea Gazpet + beneficiar | semnătură calificată pe PDF-ul final | tipărit, semnat de mână, scanat | doar Gazpet pe PV A; beneficiarul confirmă pe PV C | de întrebat beneficiarul; **A** dacă o acceptă |
| D6 | PDF-ul de semnat | operatorul salvează DOCX-ul ca PDF și îl încarcă | conversie automată (de construit) | PV A generat direct ca PDF | **A** pentru pilot |
| D7 | Semnătura desenată | nu (bifă + nume tastat) | opțională | obligatorie | **A** sau **B** (C exclude telefoanele vechi) |
| D8 | IP la dovezi | IP complet + browser, vizibile doar admin / editor (ca la răspunsuri) | doar browser | IP trunchiat | după Î8; implicit **A** |
| D9 | Sigiliu calificat Gazpet + marcă temporală pe PDF-ul final | da | nu (pilot fără) | doar marcă temporală | **B** la pilot, **A** după |
| D10 | Doi coproprietari cu același telefon | blocat → sesiune | permis, marcat în dovezi | permis, cu confirmarea operatorului | **A** |
| D11 | Fereastra de semnare | 30 de zile de la deschidere | 14 zile | până la termenul PV C pe tronson | **A** |
| D12 | Textul opțiunii din formular | „doar electronic” (ca planul) | „electronic sau la sesiune” | păstrat cum e | **A** (decizia deschisă de Juridic) |

### 8.2 Întrebări pentru avocat / Juridic

1. **Î1.** Ce efect are, după Legea nr. 214/2024 și Codul civil, un PV semnat cu semnătură electronică simplă (link personal + cod SMS)
   între deținător, Transgaz și Gazpet? E suficient pentru afirmația din plan „aceeași valoare ca unul semnat la sesiune”, sau fraza
   trebuie reformulată?
2. **Î2.** Condiția din acordul de mediu („recepția redării semnată de proprietar și beneficiar”) cere o anumită formă a semnăturii?
   Cine poate contesta (APM, proprietarul, beneficiarul) și ce ar trebui să arate dosarul ca să reziste?
3. **Î3.** Ce trebuie să conțină pagina de dovezi ca să fie utilă în fața unei instanțe sau a beneficiarului? Ajută sigiliul calificat
   Gazpet + marca temporală calificată (D9)?
4. **Î4.** Varianta B (PDF semnat de mână, fotografiat): ce valoare are copia? Trebuie cerut ulterior originalul pe hârtie?
5. **Î5.** Un număr de telefon declarat chiar de deținător în formular poate fi folosit pentru cod, sau doar cel dat de beneficiar?
6. **Î6.** Moștenitorii și coproprietarii: se poate semna la distanță fără verificarea actului doveditor / de identitate? Ce mențiune
   intră în PV la secțiunea 2?
7. **Î7.** Retragerea consimțământului după semnare (deținătorul revine): ce efect are și cum se consemnează?
8. **Î8.** Temeiul și durata pentru IP / browser / semnătura desenată; textul de completat în informare (§6).
9. **Î9.** Schimbarea modelului PV A (secțiunile 2, 4, 7) și a textului din formular cere un nou acord al beneficiarului, fiind deja
   trimise?
10. **Î10.** Contrasemnarea reprezentanților Gazpet și Transgaz: e acceptabil să semneze după deținător, pe PDF-ul cu pagina de dovezi,
    cu semnătură calificată (D5)? Data PV-ului e cea a semnăturii deținătorului sau a ultimei contrasemnături?

---

## 9. Lecțiile L01–L25 (cum le respectă specificația)

Specificația nu are cod; regulile se aplică proiectării și devin criterii de acceptare pentru feliile S2–S7.

| Regulă | Unde |
|---|---|
| L01 | Lock pe PV și cerere înainte de verificări; CAS pe `versiune` la retragere / finalizare (§4.3, §4.4) |
| L02 | Deschidere, semnare, refuz, finalizare: fiecare într-un singur RPC (§4.3) |
| L03 | Hash-ul văzut = hash-ul cererii = fișierul PV-ului, altfel refuz (§4.3, §4.5) |
| L04 | Cheie UUID per intenție la deschidere; semnarea repetată identică e idempotentă (§4.3) |
| L05 | Rezultat ambiguu în browser → recitire cu aceeași sesiune, nu retrimitere cu alte date (§4.4) |
| L06 | Ordinea unică PV → cerere → coduri, scrisă în fiecare RPC (§4.4) |
| L07 | Gărzi în BD pe PV și pe contact; scrierile doar prin RPC (§4.3) |
| L08 | Operator din `auth.uid()`; anonim doar prin token; niciun id de utilizator din parametri (§4.3, §6) |
| L09 | Nivelul Redări verificat pe proiectul fiecărui PV / deținător atins (§4.3) |
| L10 | Codul doar ca amprentă, limită de încercări și blocare; fără telefon / cod în loguri (§4.3, §6) |
| L11 | n/a (fără extragere) |
| L12 | Refuzurile au motiv din listă închisă; nimic nu dispare tacit (§4.3) |
| L13 | Formatul tokenului / codului / hash-ului ancorat (`^…$`), testat pozitiv și negativ (§4.3) |
| L14 | O migrare pe felie, cu revenire și probă apply → rollback → re-apply (§7) |
| L15 | Felia S3 schimbă vederea de stare și RPC-uri publice: amprenta globală și manifestul, ca la celelalte migrări Redări (§4.2, §7) |
| L16 | UNIQUE parțial „o cerere activă pe PV” (§4.2) |
| L17 | Expirările pe timestamp exact, ora serverului; ferestrele în Europe/Bucharest (§4.3) |
| L18 | Eroare ≠ „nu există PV de semnat”: pagina arată eroarea separat (§4.1) |
| L19 | Regula de stare a parcelei în JS și SQL, cu test de paritate (§4.2) |
| L20 | Tranzițiile cererii dintr-un tabel; teste pe căile legitime (retragere, refuz, expirare) (§4.2) |
| L21, L22 | n/a (fără AI) |
| L23 | Listele de cereri / dovezi citite cu keyset (§4.8) |
| L24 | Pagina publică: token de generație la schimbarea linkului, ca formularul de azi (`RedariRaspunsPublic.jsx:109-110`) |
| L25 | Probe ca `anon` și ca non-owner, două sesiuni reale pentru concurență, fixture-uri cu FK reale (§7) |
