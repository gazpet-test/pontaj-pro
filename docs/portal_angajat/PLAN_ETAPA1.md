# Portal angajat mobil — planul etapei 1 (fără cod, fără migrări)

> **r4 (27.10, decizia lui Răzvan):** fără login separat. Fiecare angajat are **un singur cont ERP (Supabase Auth) de tip „teren”**, iar portalul e o vedere restrânsă a acestui cont. Secțiunea **„r4”** de la final înlocuiește arhitectura din §2 (rolul `portal_edge`, tokenul de sesiune propriu) și modul de login din r3. Activarea (pct. 10) și PIN-ul la fiecare deschidere (pct. 5) rămân, dar setează și deschid **contul ERP**.

> **r3 (26.10, deciziile lui Răzvan):** 1 = A, 2 = A, 3 = A cu mașinile din `logistica_active`, 4 = A, 5 = **PIN la fiecare deschidere**, 6–9 = A, 10 = nedecis. Secțiunea **„r3”** de la final **înlocuiește** părțile vechi despre sesiune (§2 „Telefonul și sesiunea”, `portal_sesiuni`, §3 pașii 2–3), inventar (§1 / §4.4) și activare.

Data: 26.10.2026.
- Sursa cererii: `claude_docs.spec_portal_angajat_mobil` (md5 `32f10c65…`), cu deciziile lui Răzvan din 26.10.
- Analiza codului: Jakarinos (read-only), raportul e în `paw-data/out/portal_jak_1.log`.
- Faptele din BD: citiri read-only pe prod, 26.10.
- Edge-ul `concediu-mobil` l-am citit pe prod, în versiunea 19 deployată.

**Nimic din acest plan nu se aplică fără „da”.**
- Fiecare migrare trece prin harness prodlike, Copilot, DRY și „da”.
- Drepturile nu le dă portalul nimănui.
- Linkurile nu le trimite Claude.

---

## 1. Ce există azi (fapte)

### Concediu `/co`
- Rută publică, fără cont: `src/ConcediuMobilPage.jsx`. Apelează edge-ul `concediu-mobil` (`verify_jwt=false`, cheie `service_role`).
- **Tokenul** stă în clar în `hr_concediu_tokens` (117 rânduri), are 32 hex, nu expiră și nu e de unică folosință.
  - E citit din URL (`?t=`).
  - Nu se verifică `employees.active`.
  - Nu există limită de rată și nici jurnal de încercări.
  - Nu există un ecran de generare sau regenerare: tokenurile vin dintr-un seed din 10.07. ERP-ul doar copiază linkul, iar HR îl trimite manual pe WhatsApp.
- **Aprobatorul e unic: Natalia Udrea (HR)**, hard-codat în edge-ul v3 din 14.07.
  - `hr_concediu_rute` (12 rânduri) și `hr_aprobatori` (7 activi, tipuri `mp` și `sef_birou`) **nu sunt folosite** la aprobare.
  - **Fluxul cerut acum (angajat → șef superior → HR) nu există.**
- **Stările** (CHECK): `depusa` → `aprobata_mp` → `aprobata`, plus `respinsa` și `anulata`. Sursele: `mobil`, `erp`, `reconciliere`, `import_scanat`.
  - Din 782 de cereri, doar 2 vin de pe mobil; majoritatea sunt din reconcilierea cu pontajul.
  - În ERP (`TabConcedii.jsx`, montat în `HR.jsx`), HR poate semna și pasul „MP”. UPDATE-ul nu verifică starea anterioară.
- **Soldul** (`v_hr_sold_co`, security_invoker) = `co_maxim_zile` (implicit 21) minus zilele `CO` din **pontajul** anului curent.
  - Cererile depuse sau aprobate încă nepontate **nu** scad din sold.
  - Depășirea soldului dă doar avertisment.
- **Edge-ul la POST:**
  - verifică perioada, zilele lucrătoare (`fn_zile_lucratoare`) și suprapunerea;
  - nu ia lock, deci două cereri simultane pot trece amândouă;
  - nu are cheie de idempotență;
  - `an` = anul curent, nu anul lui `data_start`.
- **Semnătura și PDF-ul** se fac doar în ERP: HR generează PDF-ul cu ultima semnătură salvată a angajatului. Depunerea de pe mobil nu lasă o dovadă separată de confirmare.

### Inventar
- Singura evidență de predare pe persoană este `magazie_inventar_angajat`:
  - legată de catalogul `magazie_echipamente`, cu `data_predare` și `data_retur` (returul e pe rând întreg);
  - `pv_path` nu se completează nicăieri.
- **Azi conține doar 129 de obiecte active, toate EIP** (`categorie=echipament`, `este_eip`).
  - Telefoanele, laptopurile și sculele **nu sunt înregistrate** ca predări.
  - `logistica_active.comodat_employee_id` înseamnă **mașina personală a angajatului folosită de firmă** (sens invers).
  - **Nu există evidență pentru mașina de serviciu predată unui angajat.** `logistica_alocari` și `sofer_employee_id` sunt alocări operaționale, nu custodie.
- Nu există coloane `denumire_en`.

### Alte constatări
- `employees.qr_pin` e PIN-ul pentru alimentările QR ale utilajelor. Stă **în clar** și e afișat în Logistica. **Nu se reutilizează.**
- Nu există infrastructură i18n.
- Service worker-ul există, dar nu ține date personale offline.
- 123 de angajați activi, dintre care 25 cu cont ERP și 94 cu `telefon`.

### Expuneri existente (independente de portal, de reparat separat, cu „da”)
- **P1:** `magazie_inventar_angajat` are politica `mia_select` = `true` pentru authenticated. Oricare dintre cei 25 de utilizatori ERP vede inventarul tuturor; inventarul are mărimi, deci date personale ușoare.
- **P1:** tokenurile `/co` sunt în clar, iar istoric au fost expuse larg. Migrarea `20261003d` a restrâns citirea, dar **nu le-a rotit**.
- **P2:** `anon` are GRANT complet (SELECT / INSERT / UPDATE / DELETE) pe `hr_cereri_concediu` și `magazie_inventar_angajat`. RLS-ul (politici doar `TO authenticated`) îl blochează azi, dar granturile trebuie revocate ca apărare în adâncime. `hr_concediu_tokens` are doar SELECT pentru authenticated, cu politica restrânsă la HR / owner.
- **P2:** edge-ul `/co` nu verifică `employees.active`, deci un angajat plecat cu token activ poate depune cereri.

---

## 2. Arhitectura propusă

- **Fără conturi Supabase Auth pentru cei 98 fără cont.** Contul ERP ar deschide RLS-ul existent, care e larg (vezi P1 de mai sus). Portalul are identitatea lui proprie: link personal + PIN, cu sesiune pe telefon.
- **Un singur edge nou, `portal-angajat`** (`verify_jwt=false`), **fără `service_role`** (r2, P1 Copilot).
  - Se conectează la Postgres cu un **rol dedicat `portal_edge`** (LOGIN, NOINHERIT, NOBYPASSRLS, fără drepturi pe tabele, **doar EXECUTE pe `fn_portal_*` de angajat**). Conexiunea vine dintr-un secret nou al edge-ului, `PORTAL_EDGE_DB_URL`, care intră în registrul de automatizări.
  - Un bug în edge nu poate atinge mai mult decât funcțiile portalului.
  - Funcțiile sunt SECURITY DEFINER, cu `search_path = public, pg_temp`, `REVOKE EXECUTE FROM PUBLIC, anon, authenticated, service_role` explicit pe fiecare și `GRANT` doar către `portal_edge`.
- **Funcțiile de administrare** (`link_genereaza` / `link_revoca` / `deblocheaza` / `reseteaza`) **nu trec prin edge**. Se apelează din ERP cu JWT-ul utilizatorului (`authenticated`) și verifică în corp, prin `auth.uid()`, owner sau modulul `hr`. Fiecare acțiune intră în jurnal cu profilul care a făcut-o.
  - Fiecare funcție primește **tokenul de sesiune**, nu `employee_id`. Funcția derivă angajatul din sesiune, verifică `employees.active` și întoarce **doar coloanele proprii**: fără CNP, salariu, IBAN sau semnături.
  - Așa, regula „doar datele proprii” stă într-un singur loc, testabil în harness, nu în React și nici în edge.
- **Tokenuri:**
  - linkul personal: 256 de biți aleatori;
  - sesiunea: 256 de biți;
  - **codul de activare** (r2, P1 Copilot): 8 cifre, de unică folosință, valabil 7 zile.
    - E afișat **o singură dată** lui HR, la generarea linkului, și se transmite **pe alt canal** decât linkul: linkul pe WhatsApp, codul verbal, telefonic sau pe hârtie, prin șeful de șantier.
    - Setarea PIN-ului cere **link + cod de activare**, deci un link scurs înainte de activare nu ajunge.
    - Codul se stochează bcrypt; 5 coduri greșite revocă linkul.
  - În BD se salvează **doar `sha256(token)`**. Linkul folosește **fragment** (`/p#…`), care nu ajunge în logurile serverului și nici în Referer. Pagina îl scoate imediat din bara de adresă. `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- **PIN-ul** se salvează cu `extensions.crypt(pin, extensions.gen_salt('bf', 10))` (pgcrypto 1.3 stă în schema `extensions`; funcțiile au `search_path = public, pg_temp`, deci apelul se califică explicit).
  - Ghicirea se oprește prin limite, nu prin hash: un PIN de 6 cifre are doar 10⁶ variante.
  - Se refuză PIN-urile triviale (000000, 123456, 111111…) și cele egale cu data nașterii (DDMMYY / YYMMDD din `employees.data_nasterii`).
- **Limite, persistente și atomice în BD** (nu în memoria edge-ului), **verificate înaintea calculului bcrypt** (anti-DoS):
  - pe angajat: 5 PIN-uri greșite consecutive → blocare 30 de minute; 15 greșite în 24 de ore → link revocat, iar resetul îl face HR (contorul pe fereastră nu blochează definitiv după greșeli vechi);
  - pe sursă: 30 de încercări eșuate pe oră. Sursa e **HMAC(IP, secret `PORTAL_IP_PEPPER`)**, nu SHA simplu, pentru că spațiul IPv4 se enumeră ușor;
  - răspunsurile sunt generice („link sau PIN invalid”).
- **Telefonul și sesiunea** (r2, P1 Copilot: telefoane comune / pierdute, XSS):
  - telefonul ține minte **linkul** 30 de zile, ca să nu-l caute iar angajatul (Q5);
  - **sesiunea de date** are o fereastră de **15 minute de inactivitate**, impusă **pe server** (`pin_valabil_pana` pe sesiune). După ea, orice citire (inventar, istoric) cere din nou PIN-ul, inclusiv pe un telefon comun;
  - **PIN de step-up** la depunerea sau anularea unei cereri **și la orice aprobare a șefului**;
  - pagina `/p` are CSP strict (fără scripturi terțe, `script-src 'self'`), nu folosește `dangerouslySetInnerHTML` și nu are librării de UI noi. Tokenul de sesiune scurt limitează paguba unui XSS;
  - delogarea și „deconectează toate telefoanele” sunt în portal.

### Tabele noi (schiță)

| Tabel | Câmpuri principale | Note |
|---|---|---|
| `portal_linkuri` | `id`, `employee_id`, `token_hash` UNIQUE, `cod_activare_hash`, `cod_gresite`, `creat_de`, `creat_la`, `activare_pana_la` (creat + 7 zile), `activat_la`, `revocat_la`, `revocat_motiv` | un singur link activ pe angajat (index unic parțial); linkul nou îl revocă pe cel vechi și **dezactivează tokenul `/co` al angajatului în aceeași tranzacție** (r2) |
| `portal_credentiale` | `employee_id` PK, `pin_hash`, `pin_setat_la`, `gresite_consecutive`, `gresite_total`, `blocat_pana`, `limba` (`ro` / `en`, implicit `ro`) | PIN-ul nu se citește niciodată în UI; resetarea șterge hash-ul |
| `portal_sesiuni` | `id`, `employee_id`, `link_id`, `token_hash` UNIQUE, `creat_la`, `ultima_folosire`, `pin_valabil_pana` (15 minute de inactivitate), `expira_la`, `revocat_la`, `eticheta_dispozitiv` | se revocă în cascadă la reset, la revocarea linkului și la `employees.active=false` |
| `portal_jurnal` | `id`, `employee_id` (null dacă e necunoscut), `actiune`, `rezultat`, `sursa_hash`, `ua_scurt`, `la` | doar adăugare (trigger de imuabilitate); fără tokenuri sau PIN; retenție 12 luni (Q7), cu job de curățare înregistrat în `automatizari` |
| `portal_rata` | `cheie` (tip + valoare HMAC), `fereastra`, `contor` | limitare pe IP / sursă, cu `INSERT … ON CONFLICT` atomic |
| `portal_idempotenta` | `employee_id`, `operatie`, `cheie`, `payload_hash`, `rezultat`, `la` | aceeași cheie cu alt payload e refuzată (r2) |

Toate au RLS activ, `REVOKE ALL` pentru PUBLIC / anon / authenticated, fără politici pentru clienți. Accesul trece numai prin funcții.

**Funcții** (toate `fn_portal_*`):
- `link_genereaza` / `link_revoca` / `deblocheaza`: doar HR / owner, din ERP;
- `deschide` (link → stare: PIN de setat / PIN cerut / blocat);
- `seteaza_pin`, `autentifica` (link + PIN → sesiune), `delogheaza`;
- `acasa` (nume, funcție, limbă);
- `inventar`;
- `concediu_context` (sold, istoric complet propriu), `concediu_zile`, `concediu_depune` (cu PIN de step-up și cheie de idempotență), `concediu_anuleaza` (doar din `depusa`);
- `limba_seteaza`;
- pentru șefi (Q1 A): `de_aprobat`, `aproba_sef`, `respinge_sef`.

---

## 3. Fluxurile

1. **Linkul personal.**
   - HR / owner apasă „Generează link” în ecranul de administrare (Q6). Primește `https://…/p#<token>` și îl trimite **manual** (WhatsApp / afișat pe ecran). Claude nu trimite nimic.
   - Linkul generat îl revocă pe cel vechi și toate sesiunile.
2. **Prima intrare.**
   - Linkul cu PIN nesetat duce la alegerea limbii, apoi la **codul de activare** primit pe celălalt canal, apoi la PIN-ul de 6 cifre, introdus de 2 ori.
   - Urmează sesiunea, apoi Acasă.
   - Dacă PIN-ul nu e setat în 7 zile, linkul expiră și HR generează altul.
3. **Telefon nou, sesiune expirată sau delogare:** același link + PIN. Linkul identifică persoana, PIN-ul o autentifică.
4. **PIN uitat sau link pierdut:** HR / owner apasă „Resetează”. Se revocă linkul, sesiunile și PIN-ul, iar angajatul pornește de la pasul 1 cu un link nou. (OTP prin SMS poate veni mai târziu, doar pentru resetări.)
5. **Plecarea angajatului:** `employees.active=false` → orice funcție portal refuză, iar sesiunile se revocă (trigger sau verificare la fiecare apel).
6. **Concediul.**
   - Angajatul alege perioada. Serverul calculează zilele lucrătoare și arată soldul („rămas după pontaj” și „cereri în curs”) și avertismentul de depășire.
   - Confirmarea cere PIN. `fn_portal_concediu_depune`:
     - ia lock pe angajat;
     - verifică suprapunerea;
     - setează `an = an(data_start)` și refuză intervalele care trec dintr-un an în altul (se depun 2 cereri);
     - pune `aprobator_id` = **șeful din `hr_concediu_rute`**. **Fără rută validă, depunerea e refuzată (`ruta_lipsa`)** și angajatul vede „cere-i lui HR să-ți stabilească șeful”. Trimiterea directă la HR se face doar printr-o rută explicită spre profilul HR, setată și jurnalizată de HR / owner (r2, P1 Copilot);
     - inserează `depusa`, `sursa='mobil'`;
     - jurnalizează depunerea cu id-ul sesiunii, ca dovadă de confirmare.
   - **Șeful** aprobă sau respinge (Q1) → `aprobata_mp` (`semnat_mp_de`). **HR** aprobă → `aprobata` (`semnat_hr_de`). Aprobarea HR rămâne în ERP, ca azi.
   - **Mașina de stări e în BD, pentru toate căile** (portal și ERP), cu un trigger pe `hr_cereri_concediu` (r2, P1 Copilot):
     - `depusa → aprobata_mp` doar de aprobatorul cererii;
     - `aprobata_mp → aprobata` doar de HR;
     - respingerea doar din `depusa` / `aprobata_mp`;
     - anularea de către angajat doar din `depusa`;
     - fără salturi și fără suprascrieri concurente (CAS pe status);
     - **nimeni nu își aprobă propria cerere.**

     Inserările din reconciliere / import (sursele `reconciliere`, `import_scanat`) își păstrează regulile lor. Dacă HR mai are voie să semneze și pasul șefului (de exemplu cu șeful absent), asta se face doar cu motiv obligatoriu, jurnalizat (Q9). Trigger-ul schimbă comportamentul `TabConcedii` (HR) pe căile nepermise: se testează în harness înainte, iar UI-ul afișează refuzul.
   - PDF-ul și semnătura rămân fluxul HR existent din ERP. Nu le schimbăm în etapa asta.

---

## 4. Ecranele (mobile-first, RO / EN, RO implicit)

Portalul e o pagină publică nouă `/p`, într-un chunk separat, fără xlsx / jspdf. Textele stau într-un dicționar simplu `src/portal/i18n.js`, fără librării noi. Denumirile obiectelor vin din `denumire_en` (coloană nouă, cu fallback pe română).

1. **Limba** (RO / EN), salvată pe telefon și în `portal_credentiale.limba`.
2. **Setează PIN-ul** / **Introdu PIN-ul**, cu mesajele de blocare („încearcă din nou după HH:MM”, „cere un link nou de la HR”).
3. **Acasă:** salut + 2 butoane mari („Inventarul meu”, „Concediu”) + „De aprobat (N)” doar pentru șefi (Q1 A) + delogare.
4. **Inventarul meu:** obiectele active (denumire, mărime, cantitate, data predării) și, separat, istoricul celor returnate. Doar citire. („Confirm primirea / raportez o problemă” rămân pentru o etapă ulterioară.)
5. **Concediu:** soldul, cerere nouă (calendar, zile lucrătoare calculate de server, aprobatorul afișat), istoricul propriu cu stări, anulare cât e `depusa`.
6. **De aprobat** (șefi, Q1 A): cererile oamenilor din ruta lor → aprob / resping, cu motiv.
7. **ERP, administrare portal** (HR / owner, Q6): lista angajaților cu starea portalului (fără link / link trimis / PIN setat / blocat / revocat), cu acțiunile generează, revocă, deblochează și resetează, plus jurnalul pe angajat. **Fără afișarea PIN-ului.** Linkul se vede o singură dată, la generare.

---

## 5. Drepturi
- Portalul **nu creează profiluri, conturi sau `user_module_access`** și nu dă drepturi ERP nimănui.
- Ecranul de administrare din ERP e accesibil owner-ului și celor care au **deja** acces la modulul `hr` / `hr.*`. Orice cheie nouă sau acces nou se face doar cu „da”.
- Rutele șef → angajat (`hr_concediu_rute`) sunt date reale: completarea lor pentru 123 de oameni se face cu „da” (Q2).

---

## 6. Riscuri și cum le închide planul

| Risc | Măsura |
|---|---|
| edge cu `service_role` care primește `employee_id` arbitrar și întoarce datele altcuiva | edge-ul nu face query-uri; funcțiile derivă identitatea din sesiune; teste în harness: sesiunea A nu vede nimic din B |
| ghicirea PIN-ului / enumerarea linkurilor | linkuri de 256 de biți hash-uite, limite persistente pe angajat și IP, blocare și revocare, mesaje generice |
| link scurs (WhatsApp, captură de ecran) | singur nu ajunge, e nevoie și de PIN; HR îl revocă dintr-un clic; linkul nu stă în URL-ul serverului |
| angajat plecat | verificare `employees.active` la fiecare apel + revocarea sesiunilor |
| două cereri simultane / retry dublu | lock pe angajat + cheie de idempotență + verificarea suprapunerii în aceeași tranzacție |
| șeful își aprobă singur concediul / ocolește ruta | verificare pe server: aprobatorul = ruta angajatului, altcineva decât angajatul, CAS pe status |
| date personale | doar coloanele proprii; jurnal fără tokenuri sau PIN, IP hash-uit, retenție 12 luni; fără CNP / salariu / IBAN |
| `/co` vechi rămâne deschis cu tokenuri în clar și ocolește controalele noi | **trecere pe angajat:** generarea linkului de portal dezactivează în aceeași tranzacție tokenul `/co` al acelui angajat (inclusiv în pilot); la lansarea generală `/co` se închide (Q4) |
| link scurs înainte de activare | codul de activare de unică folosință, pe alt canal |
| telefon comun / pierdut | fereastra PIN de 15 minute pe server, PIN de step-up la acțiuni, „deconectează toate telefoanele”, revocarea de către HR |
| bug în edge | rol `portal_edge` fără `service_role` și fără tabele, doar EXECUTE pe funcții |
| inventar incomplet („tot ce primește”) | azi datele sunt doar EIP: completitudinea ține de înregistrare (Q3), nu de portal |

---

## 7. Etapele după plan
1. **E1, BD + edge:**
   - migrarea nouă `2026111xa_portal_angajat` (tabele, funcții, `denumire_en`) + edge-ul `portal-angajat`;
   - harness prodlike cu teste de izolare, limite, blocare, revocare, idempotență și tranziții;
   - Copilot + Jakarinos (securitate); DRY + „da”; deploy-ul edge-ului cu „da”.
2. **E2, UI `/p`** RO / EN + ecranul de administrare din ERP.
3. **E3, pilot pe 5 oameni** (aleși de Răzvan), apoi extindere și închiderea `/co`.
4. **Separat, cu „da”:** reparația expunerilor existente din §1 (politica `mia_select`, granturile `anon`, verificarea `active` în `/co`).

---

## 8. Decizii cerute lui Răzvan (A / B, cu recomandarea pe A)

1. **Unde aprobă șeful:**
   - **A:** în portal, secțiunea „De aprobat”. Merge și pentru șefii fără cont ERP și nu atinge `HR.jsx` / `TabConcedii.jsx`.
   - B: în ERP. Cere cont ERP pentru fiecare șef și modificarea `TabConcedii.jsx`.
2. **Cine e șeful superior:**
   - **A:** `hr_concediu_rute` (azi 12 / 123), completat de HR pentru toți. **Fără rută, depunerea e refuzată** (`ruta_lipsa`); trimiterea directă la HR se face doar ca rută explicită, setată de HR.
   - B: din `employees` (departament / funcție), după o regulă. Fragil.
3. **Inventarul (telefon, mașină, scule):** azi există doar EIP.
   - **A:** se înregistrează în Magazie ca echipamente (categoriile `it`, `vehicul`, `scule`), cu predarea existentă. Fără schemă nouă; portalul le arată automat.
   - B: tabel nou de custodie pentru mașinile din `logistica_active`. Mai multă muncă, evidență separată.
4. **`/co`:**
   - **A:** portalul îl înlocuiește. La lansare, tokenurile vechi se dezactivează și angajații primesc linkul nou.
   - B: coexistă o perioadă.
5. **Sesiunea (r2):**
   - **A:** linkul ținut minte 30 de zile pe telefon + PIN după 15 minute de inactivitate (impus pe server) + PIN la fiecare depunere / anulare / aprobare.
   - B: PIN la fiecare deschidere a paginii.
6. **Ecranul de administrare:**
   - **A:** rută nouă în ERP `/portal-admin` (o linie în `App.jsx`), pentru owner + cei cu modulul `hr`.
   - B: tab în HR, ceea ce înseamnă modificarea `HR.jsx`.
7. **Jurnalul:**
   - **A:** IP-ul stocat doar ca hash, retenție 12 luni.
   - B: fără IP.
8. **Limba:** confirmi RO implicit, cu EN la alegere?
9. **Pasul șefului în ERP (r2):** după trigger-ul cu mașina de stări:
   - **A:** HR poate semna pasul șefului doar cu motiv obligatoriu (șef absent etc.), jurnalizat;
   - B: HR nu mai poate semna niciodată pasul șefului.
10. **Codul de activare (r2):**
    - **A:** 8 cifre, pe alt canal decât linkul (verbal / pe hârtie prin șeful de șantier);
    - B: HR activează manual fiecare telefon, după un apel cu angajatul.

## r2 (26.10, după review-ul Copilot pe r1: NO-GO, P0 0, 6 P1)

Toate cele 6 P1 sunt închise în plan:
1. setarea PIN-ului doar cu linkul → cod de activare de unică folosință, pe alt canal;
2. sesiunea bearer de 30 de zile → fereastră PIN de 15 minute pe server + step-up și la aprobări + CSP;
3. `service_role` în edge → rolul `portal_edge`, doar EXECUTE; administrarea prin JWT ERP + `auth.uid()`;
4. ERP-ul ocolește fluxul șef → HR → mașina de stări în BD pentru toate căile (Q9);
5. `/co` paralel în pilot → dezactivarea tokenului `/co` la generarea linkului;
6. fallback automat la HR → `ruta_lipsa`, cu rută HR doar explicită.

P2 incluse: limitarea înainte de bcrypt, HMAC pe IP, fereastra de 24 de ore pentru cele 15 greșeli, idempotența legată de payload, REVOKE explicit, jurnalul acțiunilor de administrare.

### Verdict Copilot pe r2: **GO pentru E1** (P0 0, P1 0)

GO-ul e pentru implementare, nu pentru producție: poarta reală e pe SQL-ul și edge-ul efective. P2 de respectat în E1:
- `portal_idempotenta` cu `UNIQUE(employee_id, operatie, cheie)`, iar coliziunea se tratează atomic;
- cele 15 minute sunt **TTL absolut** după ultima introducere a PIN-ului (nu fereastră sliding), mai ușor de demonstrat pe un telefon comun;
- se documentează exact privilegiile lui `portal_edge`: CONNECT pe bază, USAGE pe schema `public`, EXECUTE doar pe funcțiile listate, nimic pe tabele sau secvențe; harness-ul verifică ACL-ul real.

La review-ul E1, poarta va fi pe ACL-ul `portal_edge`, corpurile SECURITY DEFINER, trigger-ul global de stare, concurență și idempotență.

---

## r3 — deciziile lui Răzvan din 26.10 (înlocuiește părțile vechi indicate sus)

**Decis:** 1 A (șeful aprobă în portal), 2 A (`hr_concediu_rute`, fără fallback), 4 A (portalul înlocuiește `/co`), 6 A (`/portal-admin`), 7 A (IP ca HMAC, 12 luni), 8 A (RO implicit), 9 A (HR semnează pasul șefului doar cu motiv). Rămân 3 (parțial), 5 (proiectat mai jos) și 10.

### Pct. 3: inventarul

- **Telefoane și scule** se înregistrează în Magazie ca echipamente (categoriile `it` / `scule`), cu predarea existentă. Portalul le arată automat, din `magazie_inventar_angajat` (+ `denumire_en`).
- **Mașinile rămân în `logistica_active`**, iar portalul le citește de acolo, doar citire.
- **Blocaj de date, verificat pe prod 26.10:** `logistica_active` **nu are nicio atribuire a unei mașini de serviciu către un angajat**.
  - Singura coloană cu angajat, `comodat_employee_id`, înseamnă invers: mașina **personală** a angajatului, folosită de firmă.
  - `logistica_alocari` leagă activul de un șantier sau mecanic, iar `sofer_employee_id` e pe transporturi. Niciuna nu e custodie.
  - Variante pentru Răzvan:
    - **(a)** o coloană nouă pe `logistica_active` (de exemplu `utilizator_employee_id` + `utilizator_de_la`), completată în Logistica. Atinge `Logistica.jsx`, deci cere „da”. Portalul citește apoi „mașina mea” cu nr. de înmatriculare, marcă și model;
    - **(b)** mașinile se amână până există evidența. În prima versiune portalul arată doar Magazie.

### Pct. 5: PIN la fiecare deschidere (varianta lui Răzvan)

**Fluxul:**
- Angajatul **deschide aplicația, scrie PIN-ul și intră**.
- Linkul personal servește **doar la activarea inițială**.
- La activare, telefonul primește o **cheie de dispozitiv** invizibilă pentru angajat: 256 de biți, în `localStorage`, iar în BD doar `sha256`.
- La fiecare deschidere se trimit **cheia de dispozitiv + PIN-ul**. Un PIN singur nu identifică pe nimeni: cu 123 de oameni, PIN-ul n-ar putea fi și nume, și parolă fără enumerare.

**Cum rămâne sigur:**
- **Doi factori:** telefonul activat (cheia) + PIN-ul. Un link scurs după activare nu mai deschide nimic. Un telefon furat fără PIN e oprit de limite.
- **Limitele, persistente în BD, verificate înaintea bcrypt:**
  - 5 PIN-uri greșite consecutive pe dispozitiv → blocare 30 de minute;
  - 10 greșite în 24 de ore → dispozitivul se revocă, iar reactivarea o face HR, cu link + cod nou;
  - pe sursă: HMAC(IP), 30 de eșecuri pe oră;
  - mesaje generice.
- **Sesiunea scurtă:**
  - după PIN, sesiunea ține **15 minute absolut** (TTL fix, nu se prelungește la activitate);
  - tokenul stă doar în memorie / `sessionStorage`: închizi aplicația, iar data viitoare scrii iar PIN-ul;
  - la expirare se cere din nou PIN-ul.
  - Pentru că PIN-ul tocmai a fost introdus, **nu mai cerem PIN suplimentar** la depunere sau aprobare cât sesiunea e validă (recomandarea mea). Dacă Răzvan vrea o protecție în plus pentru aprobări, se poate cere PIN la aprobare dacă au trecut peste 5 minute de la introducere.
- **Telefon comun** (mai mulți angajați pe același telefon): fiecare își activează propria cheie. La deschidere apare lista numelor activate **pe acel telefon** → alegi numele → PIN-ul tău. Lista nu există pe alte telefoane.
- **Telefon nou sau pierdut:** HR revocă dispozitivul (sau toate) și generează link + cod nou. Maximum 2 dispozitive active pe angajat.
- **XSS:** CSP strict, fără scripturi terțe. Cheia de dispozitiv singură nu ajunge fără PIN, iar sesiunea trăiește 15 minute.

**Schema, schimbată față de r2:**
- `portal_dispozitive`: `id`, `employee_id`, `cheie_hash` UNIQUE, `eticheta`, `activat_la`, `ultima_folosire`, `gresite_consecutive`, `blocat_pana`, `revocat_la`, `revocat_motiv`;
- contorul pe 24 de ore e în `portal_rata`;
- `portal_sesiuni`: `id`, `dispozitiv_id`, `employee_id`, `token_hash`, `creat_la`, `expira_la` (= creat + 15 min, fix), `revocat_la`. Dispare `pin_valabil_pana`;
- `portal_credentiale` rămâne un singur PIN pe angajat, valabil pe toate dispozitivele lui.

**Diferența față de varianta A (r2):**

| | A (r2): link ținut minte + fereastră PIN de 15 minute | Varianta lui Răzvan (r3): PIN la fiecare deschidere |
|---|---|---|
| ce face angajatul zilnic | deschide; PIN doar dacă au trecut 15 minute de la ultima folosire | deschide → PIN → intră |
| ce identifică telefonul | linkul ținut minte | cheia de dispozitiv (invizibilă) |
| sesiunea de date | se prelungește cât folosește | 15 minute fix, în memorie |
| PIN la depunere / aprobare | da (step-up) | nu: sesiunea e scurtă și abia deschisă cu PIN |
| telefon comun / lăsat deblocat | protejat după 15 minute de inactivitate | protejat la fiecare închidere / redeschidere și după 15 minute fix |
| complexitate | fereastră sliding + step-up | mai simplu: un singur punct de PIN |
| verdict de securitate | GO Copilot (r2) | de re-verificat (Copilot r3); după mine e cel puțin la fel de sigur |

### Pct. 10: activarea (nedecis), cu o variantă mai ușoară

Problema P1 din r1 rămâne: **cine are doar linkul nu trebuie să poată activa contul**, deci al doilea factor la activare e obligatoriu.

- **A (rămâne recomandarea pentru angajații departe de birou):** codul de 8 cifre, de unică folosință, pe alt canal decât linkul (verbal / pe hârtie prin șeful de șantier).
- **A′, mai ușor, fără să slăbească P1: activarea față în față, cu QR.**
  - HR sau șeful de șantier (cu acces la `/portal-admin`) deschide pe ecranul lui un **QR de activare** valabil **10 minute**, de unică folosință, care conține linkul + codul.
  - Angajatul îl scanează, își alege PIN-ul și gata. Nu se trimite nimic pe WhatsApp și nu se dictează niciun cod.
  - Al doilea factor e **prezența fizică** în fața cuiva cu cont ERP; QR-ul expiră repede și nu circulă.
  - Se potrivește la angajare / instruire sau pe șantier, când șeful e acolo.
- **Combinat (propunerea mea):** A′ ca regulă, A pentru cei care nu pot veni față în față.
- **Respins:** activarea doar cu linkul sau cu date cunoscute de alții (CNP, data nașterii, telefon), pentru că redeschide P1.

### Verdict Copilot pe r3 (26.10): **GO**
- **Pct. 5** (cheie de dispozitiv + PIN la fiecare deschidere + sesiune de 15 minute fix): păstrează GO-ul din r2, fără P1 nou. Condiții de implementare:
  - cheia se generează cu CSPRNG în browser; în BD stă doar hash-ul; verificarea se face pe server;
  - limitele sunt atomice și se verifică înaintea bcrypt; maximum 2 dispozitive;
  - CSP strict face parte din frontieră.
  - P2: `sessionStorage` nu garantează „PIN la fiecare deschidere” la restaurarea sesiunii în browser, așa că se testează pe telefoanele țintă. TTL-ul de 15 minute pe server limitează impactul.
- **Pct. 10 A′** (QR față în față): închide P1-1 din r1. Obligatoriu:
  - emiterea doar de rolul autorizat;
  - legarea de angajatul selectat;
  - consum atomic, de unică folosință;
  - expirare pe server;
  - audit.

---

## r4 — un singur cont ERP de tip „teren” (decizia lui Răzvan, 27.10)

**De ce:** modulul Probe teren (live, #888 / #889) verifică `auth.uid()` + `user_module_access`. Un login separat ar da aceleiași persoane două identități. Așa, portalul (`/m`) e o vedere restrânsă a contului ERP: inventar + concedii, plus butoanele modulelor pe care persoana le are explicit (de exemplu Probe teren pentru ILIE CORADO FLORINEL, emp 55, și MITITELU PETRONEL, emp 70; azi niciunul nu are cont).

### Ce am găsit pe prod (read-only, 27.10): de ce contul „teren” NU poate fi un `authenticated` obișnuit

- **290 de tabele** din `public` au o politică SELECT pentru `authenticated` cu `true` sau `auth.uid() IS NOT NULL`. Printre ele:
  - `employees`, cu granturi pe coloanele `cnp`, `iban`, `adresa`;
  - `hr_cereri_concediu`, `hr_aprobatori`, `hr_concediu_rute`, `hr_employees_audit`, `hr_autorizatii`;
  - contractele, facturile emise, `logistica_active`.
- **154 de tabele** au scriere deschisă oricărui `authenticated`.
- **207 funcții SECURITY DEFINER** sunt executabile de `authenticated`.
- `handle_new_user` (trigger pe `auth.users`) dă oricărui cont nou un profil cu **`role = 'manager_santier'`** și trimite notificări owner-ilor.

Concluzia: dacă cei ~98 de oameni de pe teren ar primi conturi `authenticated`, ar putea citi CNP-ul, IBAN-ul și adresa tuturor colegilor și ar putea scrie în 154 de tabele. **Asta e inacceptabil.** Separat de portal, înseamnă că azi oricare dintre cei 33 de utilizatori ERP vede CNP / IBAN prin API. Flag-ul `can_access_personal_data` (6 oameni) e respectat doar în UI. E o expunere P1 existentă, de reparat separat, cu „da”.

### Arhitectura r4

1. **Rol Postgres dedicat `teren`** (NOLOGIN, acordat lui `authenticator`, ca `authenticated`).
   - Un **Custom Access Token Hook** Supabase pune `role = 'teren'` în JWT pentru conturile cu `app_metadata.tip_cont = 'teren'`. Toate celelalte conturi rămân neschimbate (`authenticated`).
   - Efectul: politicile `TO authenticated` **nu se aplică** rolului `teren`, iar `teren` **nu are niciun grant pe tabele**.
   - Ce poate face un cont teren:
     - cele 21 de funcții executabile de PUBLIC (aceleași pe care le are deja `anon`; doar una e DEFINER, se verifică în E1);
     - funcțiile portalului, `GRANT EXECUTE … TO teren`;
     - modulele în care a fost inclus explicit (pct. 4).
   - Hook-ul rulează la **fiecare** emitere de token, pentru toți utilizatorii. Trebuie să fie trivial, testat și să nu arunce excepții: o eroare acolo ar bloca login-ul tuturor. Intră în registrul de automatizări și se configurează în Supabase Auth, cu „da”.
2. **Conturile.**
   - Le creează HR / owner din `/portal-admin`, printr-un edge `portal-admin`:
     - edge-ul verifică JWT-ul ERP și rolul (owner / modulul `hr`);
     - folosește `service_role` **doar** pentru API-ul admin Auth (creare, ban, revocare de sesiuni).
   - Contul se creează cu:
     - `email_confirm = true` și o parolă aleatoare de 64 de octeți, aruncată imediat: nimeni nu o știe, deci login-ul cu parolă e imposibil;
     - `app_metadata = {tip_cont: 'teren', employee_id}`. `app_metadata` poate fi scris doar de admin, nu de utilizator.
   - **Emailul-identificator:** recomand `t<employee_id>@teren.gazpet.ro`, pe un subdomeniu fără MX, fără nume (Q11).
     - Varianta lui Răzvan, `prenume.nume@teren.gazpet.ro`, se ciocnește (MITITELU are 4 angajați) și pune numele în identificatorul Auth.
     - Pe acest domeniu nu se trimite niciun mail. Recuperarea parolei e dezactivată pentru teren; resetul îl face HR.
   - `handle_new_user` primește o ramură: pentru `tip_cont = 'teren'` → `role = 'teren'`, `employee_id` din `app_metadata` (validat: angajat activ, fără alt cont), fără notificări (Q14). Schimbarea funcției se face cu md5 pe corpul LIVE și restaurare exactă.
3. **Activarea (pct. 10) și PIN-ul (pct. 5), ca în r3, dar pe contul ERP.**
   - Activarea: link + cod de activare pe alt canal, sau QR față în față de 10 minute. Angajatul alege PIN-ul, iar telefonul primește cheia de dispozitiv.
   - **Login la fiecare deschidere, prin edge-ul `portal-login`:**
     - edge-ul primește cheia de dispozitiv + PIN-ul;
     - verificarea și limitele (5 / 30 de minute, 10 / 24 de ore, HMAC pe IP) se fac în BD, înaintea bcrypt;
     - dacă e OK, edge-ul emite o **sesiune Supabase** fără parolă: `admin.generateLink(magiclink)` + `verifyOtp(token_hash)` pe server, fără mail trimis;
     - revocă celelalte sesiuni ale contului (`signOut` cu scope `others`);
     - întoarce sesiunea, pe care clientul o ține doar în memorie / `sessionStorage`.
   - **Poarta de 15 minute:** la login se înregistrează `session_id` din JWT în `portal_sesiuni`, cu TTL absolut de 15 minute. Funcțiile portalului și politicile modulelor deschise rolului `teren` cer `fn_portal_sesiune_valida()`. Un refresh token furat poate reînnoi JWT-ul, dar după 15 minute de la PIN nu mai deschide date.
   - Rolul `portal_edge` din r2 / r3 **dispare**. Clientul cheamă funcțiile direct, cu JWT-ul `teren`, iar identitatea vine din `auth.uid()`.
4. **Modulele cu drepturi explicite (Probe teren).**
   - **A (recomandat):** fiecare modul se deschide **opt-in** rolului `teren`. Politicile și granturile lui primesc și `TO teren`, cu aceleași verificări (`auth.uid()` + `user_module_access` / `probe_teren_drept`) + poarta de 15 minute. Asta e o schimbare în migrarea modulului Probe (sesiunea care îl deține), cu „da”. Drepturile (`user_module_access`) se dau tot cu „da”.
   - B: conturile teren cu drepturi pe module primesc `authenticated`. **Nerecomandat:** le-ar da acces la cele 290 de tabele largi, inclusiv CNP / IBAN.
5. **Revocarea la plecare.**
   - Funcțiile portalului verifică `employees.active` la fiecare apel, cu efect imediat.
   - `/portal-admin` și un job zilnic fac `ban` pe contul Auth și șterg sesiunile pentru `employees.active = false`. Jobul intră în `automatizari` și în registru.
   - Resetarea PIN-ului / telefonului revocă toate sesiunile și dispozitivele.
6. **UI ERP:** un cont teren care deschide `/` e redirecționat la `/m`. Contul nu poate citi `profiles` / `user_module_access` prin RLS-ul `authenticated`, deci `/m` își ia meniul dintr-o funcție `fn_portal_acasa()` (nume, limbă, butoanele modulelor permise).

### Impactul asupra deciziilor
- **5 (PIN la fiecare deschidere): rămâne.** Doar că PIN-ul deschide acum o sesiune Supabase, emisă de server, plus poarta de 15 minute.
- **10 (activarea): rămâne** (cod pe alt canal și / sau QR față în față). Activarea leagă PIN-ul și dispozitivul de contul ERP creat de HR.
- **Securitatea:**
  - rolul `portal_edge` dispare;
  - RLS-ul existent nu se aplică rolului `teren` (grant-uri zero pe tabele);
  - limitarea PIN-ului e pe cont, dispozitiv și IP, în BD;
  - sesiunea Supabase ține o oră (expirarea JWT a proiectului) cu refresh, dar datele sunt închise după 15 minute de la PIN;
  - plecarea angajatului înseamnă verificare `active` + ban + ștergerea sesiunilor.

### Decizii noi (r4)
- **11. Emailul-identificator:**
  - **A:** `t<employee_id>@teren.gazpet.ro`;
  - B: `prenume.nume@teren.gazpet.ro`, cu sufix la coliziuni.
- **12. Separarea:**
  - **A:** rolul `teren` prin Custom Access Token Hook;
  - B: repararea tuturor celor 290 + 154 de politici largi înainte de lansare (luni de muncă).
- **13. Modulele pentru teren:**
  - **A:** opt-in pe modul (Probe întâi);
  - B: `authenticated` pentru cei cu drepturi (nerecomandat).
- **14. `handle_new_user`:**
  - **A:** ramura `tip_cont = 'teren'` (rol `teren`, legare deterministă de fișă, fără notificări);
  - B: profilul se corectează manual după creare.
- **Separat, cu „da”:** repararea expunerii CNP / IBAN / adresă din `employees` pentru toți utilizatorii ERP (politica `employees_select_all_authenticated` = `true` + granturile pe coloane).

---

## r5 — contractul de securitate pentru r4 (după review-ul Copilot conv. 5 pe r4: NO-GO, P0 0, 8 P1, 5 P2)

Copilot acceptă direcția r4 (un singur cont, rolul `teren`, module opt-in; deciziile 11–14 pe A) și cere un contract mai strict. Mai jos, fiecare P1 cu corecția din specificație și **dovada obligatorie în E1**: harness prodlike + un test real al fluxului Auth pe un proiect / branch Supabase de test, înainte de orice DRY.

**P1-01 — clasificarea contului nu poate eșua deschis.**
- **Sursa autoritativă** e o tabelă server-side, `conturi_teren`:
  - coloane: `auth_user_id` PK, `employee_id` UNIQUE, `stare` ∈ {`in_creare`, `activ`, `revocat`}, `provisioning_id` UNIQUE, `creat_de`, `creat_la`;
  - RLS, fără granturi pentru clienți.
- **Hook-ul** (Custom Access Token):
  - dacă `auth_user_id` e în `conturi_teren` **sau** `app_metadata.tip_cont = 'teren'` → `role = 'teren'`, doar dacă rândul există, e `activ` și `employee_id` coincide cu metadatele;
  - orice lipsă, conflict sau eroare **pentru un astfel de cont** → hook-ul **refuză emiterea tokenului** acelui cont. Nu există fallback la `authenticated`;
  - pentru conturile fără rând și fără marker, hook-ul nu schimbă nimic și nu poate arunca excepții. Calea e trivială și testată, ca un hook defect să nu blocheze cei 33 de utilizatori existenți.
- **Procedura de urgență:**
  - dezactivarea hook-ului e precedată **automat** de `ban` pe toate conturile `teren` (scriptul de urgență din `/portal-admin` sau un job), apoi de oprirea hook-ului. Fără hook nu există niciun cont `teren` utilizabil, deci nu poate apărea niciun `authenticated` cu acces larg;
  - JWT-urile deja emise expiră în maximum o oră, iar poarta de sesiune (P1-04) le refuză imediat, pentru că sesiunile se revocă în BD.
- **Teste:** marker absent sau invalid, schimbarea tipului, angajat inactiv, refresh după schimbarea metadatelor, hook dezactivat după procedura de urgență.

**P1-02 — izolarea rolului `teren`, demonstrată, nu presupusă.**
- E1 conține un **preflight** în harness și în DRY:
  - granturile efective ale rolului `teren` pe tabele, view-uri, secvențe, scheme și funcții (inclusiv prin PUBLIC);
  - apartenențele (`teren` nu e membru al `authenticated` / `anon`, nu are BYPASSRLS);
  - schemele expuse prin PostgREST.
- **`ALTER DEFAULT PRIVILEGES`**: funcțiile noi nu primesc EXECUTE pentru PUBLIC. Se revocă explicit pe fiecare funcție nouă, iar poarta automată verifică.
- **Audit pe cele 21 de funcții PUBLIC** (în special DEFINER-ul): li se revocă EXECUTE pentru `teren`, sau se demonstrează că sunt inofensive.
- **Teste ca rol `teren` real**, prin REST, RPC, Storage (buckets), Realtime și GraphQL, unde sunt activate: zero acces în afara listei.
- **Amprenta ACL-urilor** rolului `teren` intră într-o poartă permanentă (ca `fn_izo_porti_lipsa`). Orice grant nou o face roșie.

**P1-03 — emiterea sesiunii, contract strict.**
- `portal-login` cheamă `generateLink(magiclink)` **doar** pentru un `auth_user_id` existent, citit din `conturi_teren` (stare `activ`), niciodată după un email venit din cerere. Fără creare implicită de cont.
- `verifyOtp` rulează pe un **client Auth separat**, fără sesiune persistentă, distinct de clientul `service_role`.
- După `verifyOtp`, backend-ul verifică `sub` = contul așteptat, rolul `teren` și `session_id`.
- OTP-ul și refresh token-ul nu apar în loguri, URL-uri sau erori.
- Retry, timeout, OTP consumat și două login-uri concurente se testează (L05: timeout = rezultat necunoscut, urmat de reconciliere).
- Se măsoară limitele de rată Auth pentru `generateLink`.
- **Revocarea celorlalte sesiuni nu se bazează pe `signOut(others)`**. Autoritatea e poarta din BD (P1-04): un login nou face CAS pe versiunea sesiunii, iar toate sesiunile vechi devin invalide atomic, indiferent de JWT-urile lor. `signOut` e doar curățenie.
- Varianta e plauzibilă tehnic, dar **trebuie dovedită pe un proiect de test** înainte de DRY. **(r6) Nu există alternativă automată:** dacă testul real `generateLink` + `verifyOtp` eșuează, autentificarea rămâne în HOLD și revine la review cu o alternativă documentată. Semnarea manuală a unui JWT e eliminată.

**P1-04 — poarta de 15 minute pe toate căile.** `fn_portal_sesiune_valida()` (DEFINER, `STABLE`) verifică:
- `auth.uid()` și `session_id` din `auth.jwt()`;
- rândul exact din `portal_sesiuni`, nerevocat, cu `expira_la` = momentul PIN + 15 minute, **absolut, fără prelungire la refresh**;
- `versiune_sesiune` = cea curentă a contului (un login nou o incrementează prin CAS, deci invalidează atomic sesiunea veche);
- eligibilitatea (P1-06).

Funcția e apelată de **fiecare** funcție a portalului, de **fiecare** politică `TO teren` (restrictivă, P1-05) și de orice edge care servește conturi `teren`. Testul decisiv: după minutul 15, un refresh Auth reușit nu permite nicio citire sau scriere, inclusiv prin apel direct la API.

**P1-05 — opt-in pe modul, cu poartă efectivă.** Fiecare modul deschis rolului `teren` are un **contract scris** în migrarea lui:
- granturile minime pentru `teren`;
- o politică **RESTRICTIVE `TO teren`** (se combină cu AND), cu: dreptul exact din `user_module_access` (cheia modulului) + `fn_portal_sesiune_valida()` + eligibilitatea, alături de politica permisivă;
- inventarul complet al RPC-urilor și edge-urilor modulului, fiecare cu aceleași verificări în corp;
- butonul din `/m` nu autorizează nimic.

Pentru **Probe teren**, testele acoperă: drept da / nu / revocat, sesiune expirată, angajat inactiv, apel direct la fiecare RPC / edge. Modificarea e în migrarea modulului Probe, cu sesiunea care îl deține, cu „da”.

**P1-06 — revocarea la plecare, imediată.**
- **Un singur predicat server-side**, `fn_teren_eligibil(uid)`:
  - angajat activ;
  - fără `termination_date` trecută;
  - contul din `conturi_teren` în stare `activ`;
  - nebanat.
  - Îl folosesc toate căile de la P1-04 / P1-05.
- La închiderea contractului (`termination_date` sau `active = false`), un trigger DB marchează în aceeași tranzacție `conturi_teren.stare = 'revocat'` și revocă `portal_sesiuni`, deci accesul se închide imediat.
- `ban` pe Auth și ștergerea sesiunilor le face edge-ul / jobul zilnic, care e doar reconciliere.
- Reactivarea angajatului **nu** reactivează contul și nici drepturile: HR le reactivează explicit.
- Jurnal persistent pentru revocare și revenire.
- Contul owner-ului nu poate fi niciodată un cont `teren`.

**P1-07 — provisioning fără conturi parțiale sau privilegiate.**
Ordinea:
1. `fn_portal_cont_pregateste(employee_id)` (HR / owner verificat în corp, lock pe angajat) inserează `conturi_teren(stare = 'in_creare', provisioning_id)`, cu UNIQUE pe `employee_id`, deci două cereri concurente nu pot crea două conturi.
2. Edge-ul creează contul Auth cu `app_metadata = {tip_cont: 'teren', employee_id, provisioning_id}`.
3. **`handle_new_user`** (ramura `teren`) găsește rândul `in_creare` cu același `provisioning_id` și `employee_id`, apoi creează **direct** profilul cu `role = 'teren'`, fără nicio fereastră cu `manager_santier` și fără notificări. Rând lipsă sau neconcordant → **excepție, iar crearea contului Auth eșuează**.
4. Edge-ul trece rândul în `activ` (CAS). Un eșec după crearea Auth lasă `in_creare`, iar contul e inutilizabil (hook-ul refuză orice altă stare decât `activ`). Reluarea e idempotentă după `provisioning_id`.
5. `service_role` rămâne o cheie largă: disciplina e în cod (doar Auth Admin API). Se acceptă ca risc documentat și se reduce prin edge minim și audit.

Schimbarea `handle_new_user` se face cu **manifest de versiune + sha256** pe definiția completă (corp, ACL, owner, `search_path`) și test de rollback / reaplicare (P2-04).

**P1-08 — două garanții separate.**
- **Garanția server:** nicio sesiune Auth care nu e înregistrată prin fluxul PIN (rând valid în `portal_sesiuni`, P1-04) nu accesează date, indiferent cum a fost obținut JWT-ul: refresh, schimbare de parolă sau email prin API-ul Auth. Pentru `teren`, schimbarea parolei / emailului din API e dezactivată (refuzată de hook / de setări).
- **Comportamentul UI:** sesiunea se ține **doar în memorie**, nu în `localStorage` și nici în `sessionStorage`. Orice reîncărcare sau redeschidere cere PIN-ul.
- Limita e declarată: o aplicație web nu poate detecta pe server fiecare închidere a browserului. Garanția literală e „PIN la fiecare încărcare a paginii + maximum 15 minute de la PIN”.

**P2** (de urmat în E1):
- domeniul `teren.gazpet.ro` configurat explicit fără recepție, iar fluxurile Auth de email / recovery sunt oprite pentru `teren`;
- cheia de dispozitiv ca **challenge-response cu cheie privată neexportabilă** (WebCrypto, ECDSA non-extractable în IndexedDB) în loc de secret transmis;
- indicatori de sănătate pentru hook (tokenuri refuzate, erori de refresh), fără secrete în loguri;
- manifest + sha256 pentru `handle_new_user`;
- `fn_portal_acasa()` minimă, iar UI-ul distinge eroarea de lipsa modulelor.

---

## r6 — cele 3 P1 rămase din re-review-ul r5 (Copilot conv. 5: NO-GO, P0 0, P1 3, P2 4)

Copilot închide la nivel de plan P1-02, 04, 05, 06 și 08 din r4 și cere trei corecții locale, C1–C3. **Ele înlocuiesc** textul corespunzător din r5.

**C1 — clasificarea explicită a TUTUROR conturilor, fail-closed.**
- **Tabela `conturi_tip`:** `auth_user_id` PK, `tip` ∈ {`erp`, `teren`}, `sursa`, `clasificat_de`, `clasificat_la`. RLS, fără granturi pentru clienți, jurnal la orice schimbare.
- **Înainte de activarea hook-ului:**
  - se inventariază cele 33 de conturi existente, toate `erp`, **fără nicio schimbare a drepturilor lor**;
  - se verifică `count(auth.users) = count(conturi_tip)`.
- **Hook-ul**, la fiecare emitere de token:
  - `erp` → tokenul rămâne neschimbat (`authenticated`);
  - `teren` → `role = 'teren'`, doar dacă `conturi_teren` are rândul `activ`, coerent cu `employee_id` și cu metadatele;
  - **rând lipsă, tip necunoscut, inconsistență sau eroare de citire → tokenul e refuzat.** Niciun caz nu ajunge la `authenticated` din lipsă de clasificare.
  - Prețul declarat: o eroare de infrastructură la clasificare poate refuza temporar și conturile ERP. Nu promitem disponibilitate printr-un fallback nesigur.
- **Conturile noi:** `handle_new_user` inserează în aceeași tranzacție rândul `conturi_tip`:
  - `teren` doar pe calea provisioning-ului (C2);
  - altfel `erp`, ca azi.
  - Fără rând, hook-ul refuză primul token, deci un cont creat pe altă cale nu primește nimic până nu e clasificat.
- **Fostul cont teren:** tipul nu se șterge niciodată. Rândul `teren` rămâne, iar revocarea se face prin `conturi_teren.stare = 'revocat'`. Dispariția markerului `app_metadata` nu schimbă nimic, pentru că sursa e `conturi_tip`. Trecerea `teren → erp` cere „da” și se jurnalizează.
- **Procedura de urgență** (dezactivarea hook-ului), în ordine:
  1. provisioning-ul se îngheață;
  2. toate conturile `teren` primesc ban în Auth și `conturi_teren.stare = 'revocat'`;
  3. sesiunile portalului se revocă;
  4. **se verifică** 0 conturi `teren` nebanate și 0 sesiuni portal valide;
  5. abia apoi se schimbă configurația Auth.
  - Re-activarea e procedura inversă, cu verificarea clasificării.
- **Test negativ decisiv:** un cont teren cu markerul absent și rândul lipsă sau inaccesibil nu primește **niciodată** un JWT `authenticated`.

**C2 — rezervarea există înaintea contului Auth.**
- **Două tabele:**
  - `portal_provisioning`:
    - coloane: `provisioning_id` PK, `employee_id`, `stare` ∈ {`rezervat`, `creat`, `finalizat`, `anulat`}, `cerut_de`, `cerut_la`, `auth_user_id` NULL până la creare;
    - un index UNIQUE parțial pe `employee_id` pentru stările `rezervat` / `creat` (o singură rezervare deschisă pe angajat).
  - `conturi_teren`:
    - coloane: `auth_user_id` PK, `employee_id` UNIQUE, `provisioning_id` UNIQUE (FK), `stare` ∈ {`in_creare`, `activ`, `revocat`}, proveniență.
- **Ordinea:**
  1. `fn_portal_cont_pregateste(employee_id)` (HR / owner verificat în corp, lock pe angajat → `portal_provisioning` → `conturi_tip`, în această ordine, L06) inserează `portal_provisioning(rezervat)`. Două cereri concurente pentru același angajat se lovesc de indexul UNIQUE.
  2. Edge-ul creează contul Auth cu `app_metadata = {tip_cont: 'teren', employee_id, provisioning_id}`.
  3. **`handle_new_user`**, în tranzacția GoTrue:
     - validează rezervarea (`rezervat`, același `employee_id`, angajat eligibil);
     - inserează `conturi_tip(NEW.id, 'teren')`, `conturi_teren(NEW.id, …, 'in_creare')` și profilul cu `role = 'teren'`;
     - trece rezervarea în `creat` cu `auth_user_id = NEW.id`.
     - Orice nepotrivire → excepție, iar crearea Auth eșuează. Nu există niciodată un profil `manager_santier`.
  4. Edge-ul face CAS `conturi_teren` `in_creare → activ` și `portal_provisioning → finalizat`, doar după postcondiții: profilul `teren`, clasificarea `teren`, fără alte drepturi.
- **Timeout / rezultat necunoscut (L05):** reluarea după `provisioning_id`:
  - dacă `auth_user_id` e deja setat, se reconciliază utilizatorul existent, fără creare nouă;
  - dacă a rămas `rezervat` și utilizatorul Auth nu există (căutat după emailul determinist `t<employee_id>@teren.gazpet.ro`), se reia crearea.
  - Hook-ul refuză orice cont `in_creare`, deci un cont la jumătate nu poate fi folosit.

**C3 — fără alternativă JWT.** Fallback-ul cu JWT semnat manual e eliminat (vezi P1-03 r5). Un eșec al fluxului Auth înseamnă HOLD + review nou.

**P2 din r5, preluate în E1:**
- **P2-01:** hook-ul **nu** blochează schimbarea parolei / emailului prin API-ul Auth (rulează doar la emiterea tokenului). Afirmația din r5 se retrage. Garanția rămâne poarta PIN: o schimbare de parolă sau email nu deschide nimic fără o sesiune `portal_sesiuni` înregistrată după PIN. În E1 se testează și se dezactivează, unde Supabase permite, schimbarea emailului / parolei pentru `teren`.
- **P2-02:** `generateLink` lucrează cu emailul. Backend-ul îl ia din contul Auth verificat (`auth_user_id` din `conturi_teren` → admin `getUserById` → email), niciodată din cerere. Se testează și cazul unui cont șters concurent, care nu are voie să ducă la o creare implicită.
- **P2-03:** inventarul tuturor rolurilor care creează funcții în `public` (postgres, supabase_admin, rolurile `izo_*_writer` etc.), cu `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` pentru fiecare. Poarta ACL a rolului `teren` prinde orice scăpare.
- **P2-04:** `termination_date` e de tip `date`, iar semantica e: ultima zi lucrată inclusiv, în fusul **Europe/Bucharest**. `fn_teren_eligibil` compară `termination_date >= (now() AT TIME ZONE 'Europe/Bucharest')::date`, deci acoperă și trecerea timpului fără niciun UPDATE. Trigger-ul acoperă schimbarea în BD. Se testează tranziția exactă la miezul nopții.

---

## r7 — ultima P1 din re-review-ul r6 (Copilot conv. 5: NO-GO, P0 0, P1 1, P2 3)

C2 și C3 sunt închise. C1 conținea o contradicție: „altfel `erp`, ca azi” lăsa orice cont nou (de exemplu prin `auth.signUp` cu cheia anon) să primească automat `erp`, adică `authenticated` cu acces la tabelele largi. **Varianta A a lui Copilot, aleasă:**

**C1′ — `erp` se acordă doar printr-o aprobare server-side.**
- **Cum se creează azi conturile ERP** (din `src/App.jsx`, `createManager`):
  - fie `supabase.auth.signUp` din client, dacă înscrierea publică e permisă;
  - fie Supabase Dashboard → Auth → Add user, când înscrierea e oprită (D1-B).
  - Legarea de fișă o confirmă deja owner-ul („🔗 Leagă automat” / Edit → Fișă angajat, R1).
  - Starea reală a înscrierii publice nu se poate citi din BD: **se verifică în E1** cu un `auth.signUp` real cu cheia anon, pe proiectul de test, și se notează pentru prod.
- **Regula nouă:**
  - `handle_new_user` **nu mai inserează niciodată** `conturi_tip = 'erp'`. Pentru un cont nou non-teren nu se inserează nicio clasificare, deci hook-ul **refuză tokenul** până la aprobare;
  - **aprobarea ERP** e o funcție nouă, `fn_cont_aproba_erp(auth_user_id)`: doar owner, verificat în corp, jurnalizată. Inserează `conturi_tip = 'erp'` și se leagă în fluxul existent de confirmare a contului (Admin → Manageri). Un manager nou nu se poate loga până nu îl confirmă owner-ul;
  - `teren` rămâne doar prin provisioning (C2);
  - **cele 33 de conturi existente** se clasifică explicit `erp` la inventarul dinaintea activării hook-ului, fără schimbarea drepturilor.
- **Test decisiv în E1:** un utilizator nou fără aprobare ERP și fără provisioning teren nu obține un JWT `authenticated` pe nicio cale Auth (signUp, Dashboard add user, invite, magic link), înainte de `fn_cont_aproba_erp`.
- **Separat, de semnalat lui Răzvan:** dacă înscrierea publică e azi **permisă** pe prod, oricine poate deja crea un cont `authenticated` și citi cele 290 de tabele (inclusiv CNP / IBAN). E o expunere existentă, independentă de portal. Ce se recomandă:
  - „Allow new users to sign up” = OFF;
  - conturile se creează doar din Dashboard / edge-ul admin;
  - verificarea o face chat-ul în Supabase Dashboard.

**P2 din r6, preluate în E1:**
- **P2-01:** procedura de urgență include, pe lângă `ban`, **revocarea refresh token-urilor** (ștergerea sesiunilor Auth ale conturilor `teren`). Un test real arată că, după dezactivarea hook-ului, nici login-ul, nici refresh-ul nu emit un JWT `authenticated` pentru un cont `teren`. Dacă testul eșuează, procedura rămâne HOLD.
- **P2-02:** preflight-ul compară **exact** seturile de `auth_user_id` (`auth.users` ↔ `conturi_tip`) în ambele direcții: lipsuri, orfani, duplicate. Numărarea nu ajunge.
- **P2-03:** finalizarea provisioning-ului (`conturi_teren → activ` și `portal_provisioning → finalizat`) se face într-**un singur RPC tranzacțional**, `fn_portal_cont_finalizeaza`, cu CAS și postcondiții. Edge-ul nu face două scrieri separate.

### Verdict Copilot pe r7 (27.10): **GO pentru începerea E1** (P0 0, P1 0, P2 4)

GO-ul acoperă cod, migrări pregătite, harness PG17 prodlike și testul Supabase Auth într-un mediu izolat. **Nu** autorizează merge, deploy, DRY sau apply pe prod: acestea au porți separate și cer „da”-ul lui Răzvan.

P2 de urmat în E1:
- respingerea tokenului de către hook nu trebuie să împiedice crearea contului Auth neaprobat; se testează cu Auth real;
- `fn_cont_aproba_erp`: doar owner, identitatea țintă verificată, audit append-only, fără conversie `teren → erp`, test cu non-owner;
- preflight-ul compară exact toate identitățile din `auth.users` (inclusiv pending / invite și orfani);
- configurația reală a înscrierii publice pe prod se verifică fără modificări; dacă e activă, se escaladează imediat la Răzvan.

La review-ul implementării se cer dovezi (fișier / linie / test) pentru L02, L04, L05, L07–L09, L14–L20 și L25.

### Starea reală la 27.10 (chat, citit din Dashboard)
- Supabase Auth: „Allow new users to sign up” = **OFF**, anonymous sign-ins = OFF, Confirm email = ON. Expunerea prin înscriere publică **nu există**. Rămâne P1-ul existent: `employees` are SELECT `USING (true)` pentru orice `authenticated`, deci CNP / IBAN sunt vizibile.
- **3 conturi „teren” create pe 27.10 ca `authenticated` obișnuite:** `florinel.ilie@teren.gazpet.ro`, `petronel.mititelu@teren.gazpet.ro`, `test.razvan@teren.gazpet.ro`.
  - Profilul are `role = manager_santier` și au doar `probe_teren` editor.
  - **Până la migrarea spre rolul `teren`, au accesul larg al oricărui `authenticated`** (cele 290 de tabele, inclusiv CNP / IBAN).
  - În E1:
    - inventarul `conturi_tip` le clasifică `teren`;
    - migrarea le trece pe rolul `teren`, cu `conturi_teren` + `portal_provisioning` reconstruite (provisioning retroactiv, cu „da”);
    - testul Probe teren rulează pe rolul `teren`.
  - Până atunci, Răzvan decide dacă rămân active, cu riscul de mai sus, sau sunt suspendate până la E1.

### Decizia /co (Răzvan, 27.10): **C3**
Tokenurile `/co` nu se ating acum.

**În planul de lansare** (etapa 3, la închiderea `/co`):
- se dezactivează toate tokenurile `hr_concediu_tokens` (`activ = false`, cu RETURNING pentru revenire);
- se golește textul în clar: coloana `token` primește o valoare-sentinelă / NULL, după ce se verifică că niciun cod nu o mai citește;
- se oprește edge-ul `concediu-mobil` și ruta `/co`.

Fiecare pas se face cu preview → „da” → apply.

Până la lansare, trecerea pe angajat rămâne: generarea unui cont de portal dezactivează tokenul `/co` al acelui angajat.

### Decizia pct. 3, mașinile (Răzvan, 27.10): **(a)**
- **Câmp nou de custodie pe `logistica_active`:** angajatul care are mașina de serviciu, plus data de la care o are. Se completează în Logistica și atinge `Logistica.jsx`.
- **Portalul** citește „mașina mea” printr-o funcție DEFINER: nr. de înmatriculare, marcă, model, doar pentru angajatul curent.
- **Etapa** e separată, după E1. Fără cod până atunci și fără migrare fără „da” separat.
- **Telefoanele și sculele** intră în Magazie ca echipamente.
