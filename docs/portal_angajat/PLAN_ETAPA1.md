# Portal angajat mobil — planul etapei 1 (fără cod, fără migrări)

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
