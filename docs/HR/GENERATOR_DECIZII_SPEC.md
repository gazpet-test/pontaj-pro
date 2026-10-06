# Specificație v1.1: Generator de decizii de numire (registru HR)

Destinatar: sesiunea „Module ERP — programare” (`session_016DH8ri5jCZPoDHhfWL9Z5i`). Versiunea v1.1 e din 06.10.2026 și a fost scrisă de sesiunea de chat. Pornește de la v1 (trei cercetări: BD, cod, NAS), integrează critica internă adversarială (45 de puncte) și verificările proprii făcute în această tură.

Toate verificările s-au făcut doar în citire: SELECT-uri, git și cod. Nu s-a modificat nimic în BD sau în repo, cu excepția acestui fișier, care e necomis.

**Legendă**
- **[V]**: fapt reverificat în tura v1.1 (06.10.2026).
- **(Cn)**: corectură preluată din punctul n al criticii.
- Punctele din critică respinse sau preluate modificat sunt în anexa „Critica respinsă”.

---

## 0. Pe scurt

### Ce zic despre deciziile tale

**1A+B (număr automat, plus număr manual cât timp documentele nu sunt toate în platformă): corect, și chiar obligatoriu.**

Pe NAS există numere duplicate (912 de două ori, ambele semnate) și goluri (762 lipsește). Fără număr manual nu putem importa trecutul și nu putem lucra în paralel cu Word-ul. Ca registrul să nu se strice, pun trei plase de siguranță:
1. **Numărul automat pornește abia după ce HR introduce, pentru anul respectiv, ultimul număr din registrul fizic (C1).** Până atunci se lucrează doar cu număr manual. Contorul gol nu mai poate da „1/2026”.
2. **Cât timp se mai fac decizii în Word, numărul îl dă platforma, niciodată invers (C2).** Butonul „Rezervă număr” alocă numărul atomic, iar HR îl trece în documentul Word. Așa contorul nu se ciocnește cu hârtia.
3. **Greșelile de tastare au frână (C4).** Un număr manual tastat greșit (9160 în loc de 916) cere confirmarea de „salt mare”. Contorul îl poate corecta doar owner-ul, cu motiv, iar corectura rămâne în istoric.

**2B (semnezi tu, Pantea sau Tudorache, după decizie, cu alegere la emitere): se face exact așa.**

La emitere alegi semnatarul dintre cei trei. Fiecare tip de decizie are un semnatar implicit, pe care îl stabilești tu pe tip (C8). Ce urmează e **risc de cunoscut, nu blocaj**:
- **Practica de până acum.** Toate cele peste 40 de decizii Gazpet citite pe NAS (2020–2026) sunt semnate de tine, ca reprezentant legal. Pe NAS nu există nicio împuternicire de semnare pentru Pantea sau Tudorache.
- **Preambulul diferă pe semnatar.** Textul „D-nul TRUSU RAZVAN MIHAIL, reprezentant legal…” nu poate rămâne același când semnează altcineva, așa că fiecare semnatar vine cu preambulul și blocul lui de semnătură.
- **Tudorache: de verificat în extrasul ONRC dacă e asociat sau co-administrator cu drept de reprezentare (C26).** Dacă da, semnează ca reprezentant legal, fără împuternicire. Dacă nu, e în aceeași situație ca Pantea.
- **Pantea (și Tudorache, dacă nu e reprezentant legal).** Până se încarcă o împuternicire scrisă (nr., dată, scan) și se validează juridic preambulul, la emitere apare un avertisment roșu. Cine emite îl confirmă explicit, iar confirmarea rămâne în istoric. Recomand să faci împuternicirea, dar nu e condiție de pornire.
- **Propria numire (C7).** Un semnatar împuternicit nu-și poate semna propria numire: Pantea nu poate semna numirea lui Pantea ca Coordonator SSM, ca la 912. Tu te poți numi singur, cu avertisment galben; precedentul e 914, Manager Proiect pe Mironu, semnată de tine.

**3 (RSVTI, PSI, Mediu, CTC-QC): da, intră toate în v1.**
- PSI și Mediu au modele pe NAS, atât pe firmă, cât și pe proiect.
- CTC-QC e o singură funcție cu trei etichete: Responsabil CTC, Responsabil CQ sau Responsabil cu Asigurarea Calității (AQ), după beneficiar.
- RSVTI nu are niciun model pe NAS. Temeiul se propune și se poate edita în draft. Până îl validează sesiunea juridică, emiterea cere confirmarea avertismentului roșu „temei nevalidat”. Așa o poți emite de acum, fără să aștepți juristul, dar știind riscul.
- **Mai propun două funcții, câte un rând de seed fiecare (le scoți dacă nu le vrei):**
  - **Responsabil deșeuri** (C39): are model pe NAS (227/2026), atestat în BD și îl cere Transgaz în fiecare set.
  - **„Lucrător desemnat SSM” pe firmă** (C37): modelul 16/2026 nu numește un „Inspector SSM”, ci un „lucrător desemnat”. Dacă îl țin sub Inspector SSM, registrul afișează altă funcție decât cea scrisă în decizie.

### Ce face v1
- registrul de decizii de numire, cu număr automat (după inițializarea anului) sau manual, plus rezervarea de numere pentru deciziile făcute încă în Word;
- redactarea pe șablon, pe funcție, cu verificarea atestatului din `hr_autorizatii`. Textul deciziei îl produce un singur loc, serverul, apoi se îngheață la emitere;
- alegerea semnatarului (Trusu, Pantea, Tudorache), fiecare cu preambulul lui;
- PDF A4 cu antetul Gazpet: se printează, se semnează de mână, iar scanul se urcă înapoi după o verificare „generat vs. scan”;
- istoricul complet: anulare, înlocuire, revocare, plus un jurnal insert-only;
- importul deciziilor vechi (inclusiv seria din cartea tehnică, ținută separat) cu număr manual și scan;
- propunerea de completare a echipei proiectului, aplicată doar după confirmare, în panoul existent „Completări propuse”;
- lista „De rezolvat”: emise nesemnate, propuneri neconfirmate, goluri în registru, importuri fără scan.

### Ce NU face v1
- semnătură electronică;
- DOCX;
- decizii colective (echipe de incendiu, prim ajutor, poluări) și decizii combinate generate. Combinatele vechi se pot importa;
- alte tipuri de decizii HR generate din șablon. Pentru ele doar se rezervă numărul (`ALTA_DECIZIE`);
- copierea automată în cartea tehnică CTC;
- centralizatorul SSM–PSI–Mediu cerut de Transgaz;
- numiri generate pentru colaboratori externi. La import și rezervare se acceptă un nume extern;
- OCR sau AI pe deciziile vechi;
- data comunicării către salariat (`comunicat_la`), amânată pentru v2.

### Ce s-a schimbat față de v1, pe scurt
- 2B se implementează acum. Lipsa împuternicirii devine avertisment roșu confirmabil, nu CHECK (C8).
- Contorul pe an trebuie inițializat explicit. Se adaugă rezervarea, iar toată alocarea trece printr-o singură funcție internă (C1–C5).
- Clientul nu mai poate ocoli RPC-urile: GRANT pe coloane, RLS strict pe draft, trigger de imuabilitate pe `current_user`, jurnal protejat (C6, C33).
- Textul deciziei se randează doar pe server, din șabloane; clientul face doar paginarea.
- Preambulul e text literal per semnatar, nu se mai compune din `firma_profil` (C17).
- Propunerile de efect sunt legate de decizie (`hr_decizie_id`) și expiră la înlocuire sau revocare (C9). Fiecare decizie are bifa `propune_efect`, pentru proiectele cu mai mulți RTE (C11).
- Drepturile sunt scrise ca predicate exacte. Superadmin nu mai înseamnă HR (C23–C25). Scanul semnat îl văd mai puțini oameni (C30, C31).
- Se adaugă importul pe serii (HR / carte tehnică), `ALTA_DECIZIE`, numele extern la import și data nulă la import (C16).
- PDF-ul are înălțime fixă A4 și verificare de depășire înainte de emitere. Testul de text se face pe randare, nu pe PDF (C18).

---

## 1. Fapte verificate

### BD (proiect `dxczwkbciseqniprspcu`)

**Ce există și ce nu**
- Nu există tabel de decizii de numire și nici registru general de intrări-ieșiri [V]: tabelele `*decizi*` existente sunt doar `ofertare_source_pack_decizii` și `cnsc_decizii`. Bucket-ul `hr-decizii` nu există [V].

**Semnatarii** [V] (`employees` + `profiles`)

| id | Nume | Funcție (`employees.functie`) | `profiles.role` / `department` | `is_owner` | Semnătură electronică |
|---|---|---|---|---|---|
| 121 | TRUSU RAZVAN MIHAIL | ADMINISTRATOR | superadmin / Administrativ | **true** | activă (raport v1) |
| 90 | PANTEA CONSTANTIN | MANAGER PROIECT | **superadmin** / Administrativ | false | nu |
| 125 | TUDORACHE MARILENA CLAUDIA | ECONOMIST | **superadmin** / (NULL) | **true** | nu |

Niciunul dintre cei trei nu are `can_manage_contracts` [V]. Owner-ii trec însă peste această verificare în `fn_completare_aplica`.

**Angajați**
- `employees` n-are coloană de gen, deci „Dl./D-na” se alege la redactare. Are `active` și `termination_date` [V].

**Datele firmei**
- `firma_profil` (id=1) [V]:

  | Câmp | Valoare |
  |---|---|
  | `denumire` | „GAZPET INSTAL S.R.L.” |
  | `cui` | „RO 22029920” |
  | `nr_reg_com` | **„J29/1650/2007”** (modelul 916 folosește „J2007001650296”) |
  | `sediu_social` | „Str. Fluturilor nr. 34, Ploiești, jud. Prahova, cod poștal 100292” (cu diacritice și cod poștal) |
  | `reprezentant_legal` | **„Trușu Răzvan”** (fără Mihail) |

  **Concluzie:** preambulul nu se poate compune din `firma_profil` ca să iasă identic cu 916 (C17).

**`executie_proiecte`**
- Are `rte_employee_id`, `rts_employee_id`, `mp_employee_id`, `nr_contract`, `data_contract`, `data_termen`, `nume` și `beneficiar`.
- **Are coloana `activ`** [V]: 23 de proiecte active, 5 inactive.
- N-are nicio coloană de recepție, status sau finalizare [V].
- Lipsește `nr_contract` la 1 din 28 de proiecte și `data_contract` la 1 din 28 [V].
- **`sef_santier_employee_id` nu există în BD.** E pe branch-ul `claude/erp-continuare-x4p5a7-sef-santier`, cu migrarea `20261017a` neaplicată și aflată „în verificare”.
- Politica `executie_proiecte_modify` (ALL) cere doar `auth.uid() IS NOT NULL` (raport v1).

**Mecanismul de confirmare** [V]

`executie_completari_propuse`:

| Ce | Detaliu |
|---|---|
| Coloane | `id`, `proiect_id`, `camp`, `valoare` (NOT NULL), `valoare_afisata`, `sursa` (NOT NULL, fără CHECK), `sursa_detaliu`, `dovada_path`, `confidenta` (0–100), `motiv`, `status`, `decis_de`, `decis_la`, `created_at` |
| `status` | CHECK pe propus / confirmat / respins / **expirat**. `expirat` nu e folosit azi |
| Politici | SELECT pentru `auth.uid() IS NOT NULL`; INSERT pentru owner sau `can_manage_contracts`; nicio politică de UPDATE |

`fn_completare_aplica(p_id, p_accepta)`:
- e SECURITY DEFINER și verifică doar dreptul (owner sau `can_manage_contracts`, 8 profiluri) și `status = 'propus'`;
- **nu verifică sursa propunerii și nici dacă dovada mai e valabilă** (C9);
- whitelist-ul de câmpuri conține `rte_employee_id`, `rts_employee_id`, `mp_employee_id` și câmpuri de contract, **fără `sef_santier_employee_id`**.

Panoul din `src/Executie.jsx` (~475–495, `origin/main`) deschide dovada cu **bucket-ul hardcodat**: `storage.from('executie-contracte').createSignedUrl(row.dovada_path)` (~706) [V] (C20).

**Atestate** (`hr_autorizatii`) [V]
- Coloane utile: `employee_id`, `tip_id`, `numar_autorizatie`, `emitent`, `data_emitere`, `data_expirare`, `fara_expirare`, `domenii`, `deleted_at`, `inlocuita_de_id`, `verificat_pe_scan`, `uploadat_de`, `extern_id`.
- Politici:
  - SELECT `true` pentru orice utilizator autentificat;
  - scriere (ALL) pentru owner, `can_modify_employees`, **orice superadmin** și departamentele HR / Administrativ (C23).

**Atestate pe funcție** (`hr_autorizatii_tipuri`, înregistrări neșterse; numărătorile sunt din raportul v1)

| Funcție | Tip atestat | Înregistrări | Observații |
|---|---|---|---|
| RTE pe domenii | `RTE` (necesita_domenii) | 20 | doar 6 pe angajați, 14 pe externi; domeniile salvate sunt murdare; nomenclatorul e `isc_rte_domenii`, normalizarea e în `src/iscRte.js` (`normalizeazaDomeniiISC`:57, `acoperaDomeniul`:68) |
| RTE atestat MEC | `RTE_MONTAJ_IT` (emitent implicit MECMA [V]) | 2 | **de confirmat** că e același lucru |
| RTS | `RTS` | 2 | `emitent_default` = MDLPA [V], dar atestatele de pe disc sunt ISCIR, **de verificat** |
| Șef de șantier | niciunul | – | legea nu cere atestat |
| Manager proiect | `MANAGER_PROIECT_240` / `_60` (categoria cursuri) | 5 / 4 | – |
| CTC / QC | **lipsește tipul** | – | cele mai apropiate: `AUDITOR_INTERN`, `MANAGER_SMC`, `EXAMINARE_VIZUALA` |
| Inspector SSM | `INSPECTOR_SSM_80` / `_40` | 9 / 2 | stau greșit sub categoria „isu” [V] |
| Coordonator SSM | `COORDONATOR_SSM_90` (categoria „isu” [V]) | 2 | – |
| RSVTI | `RSVTI` (ISCIR [V]) | 1 | același angajat ca `RSVTI_EMPLOYEE_ID = 81` (NICA EUGEN), hardcodat în `AdeverinteLegator.jsx:30` [V] |
| PSI | `CADRU_TEHNIC_PSI` | 4 | – |
| Mediu | `RESPONSABIL_MEDIU` | 2 | – |
| Deșeuri | `RESPONSABIL_DESEURI` (categoria „mediu” [V]) | – | – |

**Coduri de rol refolosibile**
- `ofertare_pt_echipa_roluri.rol_cod`: rte, sef_santier, manager_proiect, responsabil_cq, responsabil_ssm, responsabil_mediu, responsabil_deseuri.

**Numerotare existentă**
- Modelul „auto + manual” e `fn_executie_assign_numar_document` [V]: un trigger cu FOR UPDATE pe rândul-părinte, iar pe ramura manuală `GREATEST(urmator, nr+1)`.
- Anti-modelul e `logistica_declaratii`: numărare + 1 în client, fără UNIQUE.

**Storage** [V]

| Bucket | Politici pentru `authenticated` | Concluzie |
|---|---|---|
| `executie-contracte` | SELECT / INSERT / UPDATE / DELETE | orice utilizator logat poate citi, înlocui sau șterge |
| `autorizatii` | SELECT / INSERT / DELETE, fără UPDATE (C22) | orice utilizator logat poate citi sau șterge |

Niciunul nu e potrivit pentru documente imuabile.

**Acces** [V]
- Cheia `hr` are 8 deținători, dintre care **doar 1 e din departamentul HR** (C24):

  | Nivel | Rol / departament | Câți |
  |---|---|---|
  | admin | superadmin / HR | 1 |
  | editor | superadmin / Administrativ | 3 |
  | editor | manager_santier / Ofertare | 2 |
  | editor | manager_santier / IT | 1 |
  | editor | contabilitate / Contabilitate | 1 |

- Nu există sub-chei `hr.*`.
- Un singur profil are `department = 'HR'`.
- Există 8 profiluri superadmin.
- Cheia `executie` are 13 deținători, iar `can_manage_contracts` = true are 8 profiluri.

### Cod

**Branch și checkout**
- Checkout-ul `/home/user/pontaj-pro` e pe `claude/erp-continuare-x4p5a7-sef-santier`, **curat**, sincronizat cu `origin` [V].
- Față de `origin/main` (0e9b7b0) e cu 6 commit-uri înainte și 1 în urmă: e0e4d60, 121991f, 10c4433, aabfb21, 8fb9bd9, 7378f5b.
- **Fix-ul `activ` → `active` din `openEchipaEdit` e comis în 10c4433 și pushat** [V] (C21). Afirmația din v1 („modificare necomisă”) era falsă.

**PDF**
- `renderHtmlToPdfBlob(html)` (`Achizitii.jsx:123`) [V]:
  - pune conținutul într-un holder de 794px lățime, cu înălțime liberă;
  - îl transformă în canvas cu html2canvas, apoi în **PNG pus în jsPDF pe 0,0,210,297**;
  - consecințe: PDF-ul n-are strat de text, iar un conținut care nu are exact raportul A4 iese **deformat** (C18).
- `getSemnaturaDataURL` e la `Achizitii.jsx:107`.

**Antet**
- Antetul Gazpet complet e `src/logo.js` → `LOGO_B64` (JPEG 953×146, cu datele firmei și ISO 9001/14001).
- `LOGO_PDF_B64` din Achiziții e varianta decupată, nepotrivită pentru decizii.

**Precedente și puncte de inserție**
- Precedentul cel mai apropiat e `src/AdeverinteLegator.jsx` (registru, Times, PDF, upload). Se randează în `HR.jsx:326` pe condiția `canAccessPersonal` [V].
- Poarta HR (`HR.jsx:149`) [V]:
  - lasă să treacă `is_owner`, **orice admin sau superadmin** și `department = 'HR'`;
  - pentru ceilalți, cere cheia `hr` sau o sub-cheie `hr.*`, după regula de prefix.
- Echipa din dashboard-ul Execuție e la `Executie.jsx:3074-3124` (liniile din v1; se recitesc pe branch-ul de lucru înainte de PR3).
- `imageToPdf` e la `CitesteOricePanel.jsx:133` [V] (decizia „TOTUL PDF”).

**Infrastructură de migrare și teste**
- Migrările se livrează prin `scripts/livrare_migrare.sh` (garda `gazpet.livrare_migrare`); rollback-ul stă în `supabase/revenire/`.
- Testele SQL sunt în `supabase/tests/`; modelul de urmat e `conturi_ciclu_viata.test.sql` [V].

**Bug-uri văzute în trecere**
- „CUI RO13038090” e tipărit în `DeclaratieTehnicaSection.jsx:287` **și în `SupapeDeclaratiiSection.jsx:615`** [V], deși antetul are RO 22029920.

### NAS (modele)

**Modelul F1** (HR 2025–2026, cel de urmat)
- structura: antet imagine, „DECIZIA NR {nr}/{dd.mm.yyyy}”, preambulul reprezentantului legal, „DECIDE:”, Art.1–4, „Administrator / Trusu Razvan”;
- sursa: `H:\1 - ANGAJATI - NATALIA\DECIZII NUMIRE PERSONAL\…\DECIZII NUMIRE draft 2025 …ORSOVA - JUPA.doc`.

**Modelul F2** (pe firmă, Delgaz, 13.01.2026)
- Art.1 se încheie cu „conform {temei}”;
- are 3 articole, fără „până la recepție”.

**Numerotarea în registrul HR**
- În 2026 numărătoarea pornește de la 6 (13.01). Numere folosite: 6–19, 226–240, 759–764, 911–916.
- În 2025 numărătoarea pornește de la 70 (20.02).
- Asta susține resetarea anuală, dar **doar parțial (C27)**: în 2024, 298 e datat în octombrie, după 368 din iulie, ceea ce sugerează altă serie. **De confirmat cu Natalia**, împreună cu întrebarea dacă registrul e comun cu celelalte decizii HR (saltul 240 → 759 sugerează că e comun).

**Seria Mironu 28.09.2026: 7 decizii pe 6 numere**

| Nr. | Funcție | Observații |
|---|---|---|
| 911 | CTC | – |
| **912** | Coordonator SSM | Pantea; semnată |
| **912** | Inspector SSM | Niculescu; semnată |
| 913 | RTE MEC | – |
| 914 | Manager Proiect | **Trusu, semnată de Trusu** (C7) |
| 915 | Șef șantier | – |
| 916 | RTE 1.1 | – |

Numărul 762/2026 lipsește din serie.

**Cartea tehnică (2020–2025)**
- Numerele sunt fără dată și **sunt altă serie** decât registrul HR: de exemplu 388–392/2025, 383 și 378/2024. 391/2025 „Pază” din HR ≠ 391 din cartea tehnică (C16).
- Conține decizii combinate: MP / Șef șantier 385/2024 și MP / Resp. CQ 244/2022.

---

## 2. Invarianți (nenegociabili în implementare)

1. **Numărul e unic pe (serie, an, număr, sufix).**
   - Seria e `HR` (registrul) sau `carte_tehnica` (doar la import). Anul = anul din `data_emitere`, iar la importul fără dată, anul se dă explicit.
   - Sufixul (de ex. „bis” pentru al doilea 912, sau „a”/„b” la deciziile combinate) e permis doar la import.
2. **Numărul se alocă doar în BD, atomic, printr-o singură funcție internă, `_hr_decizii_aloca` (C3).** O folosesc emiterea, rezervarea și importul. Nu există numărătoare în client.
   - Un număr manual ocupat dă eroare cu trimitere la decizia care îl ocupă.
   - Un număr manual mai mare decât contorul îl împinge la acea valoare. Peste `ultimul + 20` e nevoie de confirmarea „salt mare” (C4).
   - Un număr manual liber, sub contor (de ex. 762), e acceptat, iar contorul rămâne neschimbat.
   - Numărul automat = `ultimul + 1`, sărind peste numerele deja ocupate.
3. **Numărul automat există doar pe un an inițializat explicit (C1, C2).** Pentru fiecare an, HR sau owner-ul introduce „ultimul număr din registrul fizic” și abia apoi pornește numărul automat. Fără inițializare se lucrează doar manual.
4. **Data emiterii nu e în viitor (C5).** Dacă anul emiterii diferă de anul curent, numărul e obligatoriu manual și emiterea cere confirmarea avertismentului roșu. Regula se verifică în RPC, nu într-un CHECK.
5. **O decizie emisă e imuabilă.**
   - Textul e produs **doar de server**, din șabloane, și se îngheață la emitere în `continut`. Datele (persoană, proiect, contract, atestat, semnatar, firmă) se îngheață în `snapshot`.
   - Corectura NU se face prin editare: o decizie emisă și nesemnată se **anulează** (numărul rămâne ocupat, cu motiv); una semnată se **înlocuiește** sau se **revocă** printr-o decizie nouă.
   - Nu există DELETE pe decizii emise. Se pot șterge doar draft-urile, care n-au număr.
6. **Clientul nu poate scrie coloanele serverului (C6, C33).**
   - Din client se pot crea și modifica doar draft-uri, și doar coloanele de redactare (GRANT pe coloane). Orice tranziție de stare trece printr-un RPC SECURITY DEFINER.
   - Un trigger blochează orice UPDATE sau DELETE pe o decizie care nu e draft, dacă nu vine din RPC (`current_user` ≠ rolurile API).
7. **Istoricul e complet și nu se poate șterge.**
   - Fiecare tranziție, inclusiv operațiile pe contor, scrie un rând în `hr_decizii_evenimente`. Tabelul e insert-only pentru toată lumea, owner-ul inclus.
   - PDF-ul generat și scanul semnat au hash SHA-256 și stau într-un bucket fără UPDATE. DELETE are doar owner-ul, iar ștergerea se jurnalizează.
8. **Echipa proiectului se modifică doar la confirmare.**
   - O decizie semnată creează o *propunere* în `executie_completari_propuse`, legată de decizie prin `hr_decizie_id`.
   - Aplicarea o face owner-ul sau cineva cu `can_manage_contracts`, prin `fn_completare_aplica`, care există deja.
   - Când decizia e înlocuită sau revocată, propunerile ei încă neconfirmate trec în `expirat` (C9).
   - Generatorul NU face niciodată UPDATE direct pe `executie_proiecte`.
9. **Semnatarul (C7).**
   - Un semnatar care **nu** e reprezentant legal nu-și poate semna propria numire. Regula e blocantă și se verifică în RPC.
   - Reprezentantul legal care se numește pe sine primește doar avertisment galben.
   - La import regula nu se aplică.
10. **Date personale minime.**
    - Se folosesc doar numele, funcția, proiectul sau firma și datele atestatului (nr., dată, emitent, expirare). Fără CNP, domiciliu sau date medicale.
    - Scanul semnat, care e specimen de semnătură și ștampilă, îl văd mai puțini oameni decât PDF-ul generat (C31).
    - Nicio decizie și niciun scan nu se copiază în `executie-contracte` (C32).
11. **Fără semnătură electronică în v1.** Decizia iese cu spațiu gol pentru semnătură și ștampilă. HR-ul nu aplică semnătura altcuiva.

---

## 3. Model de date (PR1: o migrare cu tabele, RLS, GRANT, RPC-uri, triggere, bucket, seed și teste)

### 3.1 Tabele

```sql
-- Semnatarii (2B: toti trei activi). Scrierea doar prin migrare in v1, fara UI.
hr_decizii_semnatari (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id int NOT NULL REFERENCES employees(id),
  calitate text NOT NULL,                    -- 'Administrator' / 'Asociat' / 'Imputernicit' / …
  este_reprezentant_legal boolean NOT NULL DEFAULT false,
  preambul_text text NOT NULL,               -- text LITERAL (C17); variabila permisa: {imputernicire}
  bloc_semnatura text NOT NULL,              -- „Administrator,\nTrusu Razvan”
  preambul_validat boolean NOT NULL DEFAULT false,   -- true doar dupa OK juridic (sau model NAS, pt 121)
  imputernicire_nr text, imputernicire_data date, imputernicire_path text,
  activ boolean NOT NULL DEFAULT true, ordine int
  -- FARA CHECK pe imputernicire (C8): lipsa ei = avertisment rosu R4 la emitere
)

-- Nomenclatorul de functii si sabloanele lor
hr_decizii_tipuri (
  cod text PRIMARY KEY,   -- vezi §5: RTE, RTE_MEC, RTS, SEF_SANTIER, MP, CTC_QC, INSPECTOR_SSM,
                          -- LUCRATOR_DESEMNAT_SSM, COORDONATOR_SSM, RSVTI, PSI, MEDIU,
                          -- RESPONSABIL_DESEURI, REVOCARE, ALTA_DECIZIE
  denumire text NOT NULL,
  eticheta_functie text NOT NULL,                       -- eticheta implicita din Art.1
  etichete_alternative text[] NOT NULL DEFAULT '{}',    -- pe TOATE tipurile (C36)
  nivel text NOT NULL CHECK (nivel IN ('proiect','firma','ambele')),
  are_sablon boolean NOT NULL DEFAULT true,             -- false: ALTA_DECIZIE (doar rezervare/import)
  art1_proiect text, art1_firma text,                   -- sintaxa sablon in §5
  temei_implicit text,
  temei_sursa text NOT NULL DEFAULT 'model_nas'
    CHECK (temei_sursa IN ('model_nas','propunere','validat_juridic')),   -- C28
  art_valabilitate_proiect text,                        -- „…pana la receptia definitiva a lucrarii.”
  autorizatie_tipuri text[],                            -- coduri din hr_autorizatii_tipuri
  autorizatie_ceruta text NOT NULL CHECK (autorizatie_ceruta IN ('obligatorie','recomandata','nu')),
  necesita_domeniu_isc boolean NOT NULL DEFAULT false,
  camp_efect text CHECK (camp_efect IN ('rte_employee_id','rts_employee_id','mp_employee_id','sef_santier_employee_id')),
  rol_cod text,                                         -- = ofertare_pt_echipa_roluri.rol_cod
  unic_activ boolean NOT NULL DEFAULT true,             -- G2: o singura decizie activa pe (proiect|firma, tip[, domeniu])
  semnatar_implicit_id bigint REFERENCES hr_decizii_semnatari(id),   -- „in functie de decizie” (C8)
  activ boolean NOT NULL DEFAULT true, ordine int
)

-- Registrul
hr_decizii (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  serie text NOT NULL DEFAULT 'HR' CHECK (serie IN ('HR','carte_tehnica')),   -- C16
  an int, numar int, numar_sufix text NOT NULL DEFAULT '',
  mod_numar text CHECK (mod_numar IN ('auto','manual')),
  origine text NOT NULL DEFAULT 'platforma' CHECK (origine IN ('platforma','import','rezervare')),
  tip_cod text NOT NULL REFERENCES hr_decizii_tipuri(cod),
  eticheta_functie text NOT NULL,
  descriere text,                             -- obligatorie la ALTA_DECIZIE
  nivel text NOT NULL CHECK (nivel IN ('proiect','firma')),
  employee_id int REFERENCES employees(id),
  persoana_nume text,                         -- doar import/rezervare fara angajat (extern) — C16e
  proiect_id bigint REFERENCES executie_proiecte(id),
  proiect_denumire text,                      -- precompletat din executie_proiecte.nume, editabil in draft
  autorizatie_id bigint REFERENCES hr_autorizatii(id),
  domenii_isc text[],                         -- coduri normalizate (1.1, 8.4D…)
  titlu text CHECK (titlu IN ('Dl.','D-na')), -- C41
  temei text,                                 -- precompletat din tip, editabil in draft (C28)
  data_emitere date, data_efect date, data_efect_pana date,
  semnatar_id bigint REFERENCES hr_decizii_semnatari(id),
  luare_la_cunostinta boolean NOT NULL DEFAULT false,
  propune_efect boolean NOT NULL DEFAULT true,          -- C11 (generalizat)
  inlocuieste_id bigint REFERENCES hr_decizii(id),
  revoca_id bigint REFERENCES hr_decizii(id),
  -- coloanele serverului (fara GRANT de scriere pentru client):
  snapshot jsonb NOT NULL DEFAULT '{}',
  continut jsonb,                             -- articolele randate de server, inghetate la emitere
  cod_verificare text,                        -- 'D{id}-{8 hex din sha256(continut)}' (C15a)
  avertismente jsonb NOT NULL DEFAULT '[]',   -- tot ce s-a semnalat + confirmarile (cod, de, la)
  stare text NOT NULL DEFAULT 'draft'
    CHECK (stare IN ('draft','emisa','semnata','anulata','revocata','inlocuita')),
  motiv_anulare text,
  pdf_path text, pdf_sha256 text, scan_path text, scan_sha256 text,
  creat_de uuid NOT NULL DEFAULT auth.uid(), creat_la timestamptz NOT NULL DEFAULT now(),
  emis_de uuid, emis_la timestamptz, scan_de uuid, scan_la timestamptz,
  anulat_de uuid, anulat_la timestamptz,

  UNIQUE (serie, an, numar, numar_sufix),
  CHECK ((stare = 'draft') = (numar IS NULL)),
  CHECK ((numar IS NULL) = (an IS NULL)),
  CHECK (numar_sufix = '' OR origine = 'import'),
  CHECK (serie = 'HR' OR origine = 'import'),
  CHECK ((nivel = 'proiect') = (proiect_id IS NOT NULL)),
  CHECK ((tip_cod = 'REVOCARE') = (revoca_id IS NOT NULL)),
  CHECK (tip_cod <> 'ALTA_DECIZIE' OR descriere IS NOT NULL),
  CHECK (data_emitere IS NOT NULL OR origine = 'import' OR stare = 'draft'),
  CHECK (employee_id IS NOT NULL OR origine <> 'platforma' OR stare = 'draft'
         OR (tip_cod = 'REVOCARE' AND persoana_nume IS NOT NULL)),
  CHECK (employee_id IS NOT NULL OR persoana_nume IS NOT NULL OR tip_cod = 'ALTA_DECIZIE' OR stare = 'draft'),
  CHECK (origine <> 'platforma' OR stare = 'draft'
         OR (titlu IS NOT NULL AND data_efect IS NOT NULL AND semnatar_id IS NOT NULL AND continut IS NOT NULL)),
  CHECK (data_efect_pana IS NULL OR data_efect IS NULL OR data_efect_pana >= data_efect)
)
-- O singura inlocuire / revocare „vie” pe aceeasi tinta (C12)
CREATE UNIQUE INDEX ON hr_decizii (inlocuieste_id) WHERE inlocuieste_id IS NOT NULL AND stare NOT IN ('draft','anulata');
CREATE UNIQUE INDEX ON hr_decizii (revoca_id)      WHERE revoca_id      IS NOT NULL AND stare NOT IN ('draft','anulata');
-- + index pe employee_id, proiect_id, tip_cod, (serie, an)

-- Contorul (doar seria HR)
hr_decizii_contor (
  serie text NOT NULL DEFAULT 'HR', an int NOT NULL,
  ultimul int NOT NULL DEFAULT 0,
  auto_permis boolean NOT NULL DEFAULT false,      -- C1/C2: false = doar numar manual
  ultimul_initial int,                             -- valoarea de la initializare (baza pentru „goluri”)
  initializat_de uuid, initializat_la timestamptz, initializat_sursa text,   -- „registrul fizic, verificat de …”
  PRIMARY KEY (serie, an)
)

-- Jurnalul (insert-only pentru toata lumea)
hr_decizii_evenimente (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decizie_id bigint REFERENCES hr_decizii(id),     -- NULL pentru evenimente de contor
  serie text, an int,                              -- pentru evenimente de contor
  eveniment text NOT NULL,     -- creare, modificare_draft, emitere, pdf, scan, scan_inlocuit, fisier_sters,
                               -- anulare, inlocuita, revocata, propunere_efect, propunere_expirata,
                               -- contor_initializat, contor_auto_oprit, contor_corectat, import, rezervare
  stare_veche text, stare_noua text,
  de uuid, la timestamptz NOT NULL DEFAULT now(),
  detalii jsonb
)

-- Legatura propunere → decizie (C9). Schimbare ADITIVA pe un tabel existent: intra in OK-ul pe PR1.
ALTER TABLE executie_completari_propuse ADD COLUMN hr_decizie_id bigint REFERENCES hr_decizii(id);
```

### 3.2 View

`v_hr_decizii_active WITH (security_invoker = on)` conține deciziile de numire valabile:
- `stare IN ('emisa','semnata')` (cele `inlocuita` și `revocata` ies singure, prin stare);
- `tip_cod NOT IN ('REVOCARE','ALTA_DECIZIE')`;
- `data_efect_pana IS NULL OR data_efect_pana >= current_date`;
- pentru `nivel = 'proiect'`, doar proiectele cu `executie_proiecte.activ = true` (C13). Coloana există [V].

Coloanele view-ului:
- `id`, `serie`, `an`, `numar`, `numar_sufix`, `nr_afisat` („916/28.09.2026”, „912-bis/28.09.2026”), `data_emitere`;
- `tip_cod`, `rol_cod`, `camp_efect`, `eticheta_functie`, `nivel`;
- `employee_id`, `nume` (din snapshot), `proiect_id`, `domenii_isc`, `data_efect`, `data_efect_pana`;
- `stare` și `semnata` (boolean).

UI-ul afișează deciziile `emisa` ca **„nesemnată”**, nu ca active (C13). Efectul pe echipă vine doar din `semnata`.

Îl folosesc cardurile Echipă din Execuție și, mai târziu, CTC și Organigrama din Ofertare. CTC, SSM, PSI, Mediu și MEC pe proiect NU primesc coloane noi în `executie_proiecte`: echipa extinsă se citește din view. Fiind `security_invoker`, view-ul respectă RLS-ul de pe `hr_decizii`, deci un editor `executie` vede doar deciziile pe proiect.

### 3.3 Drepturi: un singur helper, cu predicate exacte (C25, C44)

`fn_hr_decizii_poate(p_actiune text, p_decizie_id bigint DEFAULT NULL) RETURNS boolean`
- e `STABLE SECURITY DEFINER SET search_path = public, pg_temp`;
- are `GRANT EXECUTE TO authenticated`, ca UI-ul să-l poată întreba;
- o folosesc RLS-ul, storage-ul, toate RPC-urile și UI-ul, inclusiv butonul „Generează decizie” din Execuție. Nu există altă poartă.

Termenii folosiți în predicate, cu `p = profiles WHERE id = auth.uid()`:

```
owner      := p.is_owner
hr         := p.department = 'HR'
              OR EXISTS (user_module_access WHERE profile_id = auth.uid() AND module = 'hr.decizii'
                         AND access_level IN ('editor','admin'))          -- D3 = B' (recomandat, §9)
hr_citire  := hr OR EXISTS (… module = 'hr.decizii')                       -- orice nivel
exec       := EXISTS (user_module_access WHERE profile_id = auth.uid() AND module = 'executie')
              OR p.can_manage_contracts
confirm    := p.is_owner OR p.can_manage_contracts
pe_proiect := decizia p_decizie_id are nivel = 'proiect' AND stare <> 'draft'
```

**Rolul `superadmin` NU apare în niciun predicat (C23, C24).**

| Acțiune | Predicat | Folosită la |
|---|---|---|
| `citire` | owner OR hr_citire | registrul complet, inclusiv draft-urile și deciziile pe firmă |
| `citire_doc` | owner OR hr_citire OR (exec AND pe_proiect) | PDF-ul generat |
| `citire_scan` | owner OR hr OR (confirm AND pe_proiect) | scanul semnat (C31, modificat: vezi anexa) |
| `redactare` | owner OR hr | INSERT / UPDATE pe draft |
| `emitere`, `rezervare`, `scan`, `anulare`, `import` | owner OR hr | RPC-urile respective |
| `contor` | owner OR hr | inițializarea anului, oprirea numărului automat |
| `owner` | owner | corectarea contorului, înlocuirea scanului, ștergerea de fișiere, ștergerea draft-urilor altora |
| `confirmare_efect` | neschimbat: owner OR `can_manage_contracts`, prin `fn_completare_aplica` | – |

### 3.4 RLS, GRANT, triggere

**`hr_decizii`**

GRANT pe coloane (C6, C33):
```sql
REVOKE ALL ON hr_decizii FROM anon, authenticated;
GRANT SELECT, DELETE ON hr_decizii TO authenticated;
GRANT INSERT (tip_cod, eticheta_functie, nivel, employee_id, proiect_id, proiect_denumire, autorizatie_id,
              domenii_isc, titlu, temei, data_emitere, data_efect, data_efect_pana, semnatar_id,
              luare_la_cunostinta, propune_efect, inlocuieste_id, revoca_id) ON hr_decizii TO authenticated;
GRANT UPDATE (<aceeasi lista>) ON hr_decizii TO authenticated;
GRANT ALL ON hr_decizii TO service_role;   -- regula casei; triggerul de imuabilitate il opreste si pe el
```

Politici:

| Politică | Regulă |
|---|---|
| SELECT | `fn_hr_decizii_poate('citire') OR (nivel = 'proiect' AND stare <> 'draft' AND fn_hr_decizii_poate('citire_doc', id))` |
| INSERT | WITH CHECK `fn_hr_decizii_poate('redactare') AND stare = 'draft' AND numar IS NULL AND origine = 'platforma' AND creat_de = auth.uid()` |
| UPDATE | USING `stare = 'draft' AND fn_hr_decizii_poate('redactare')`; WITH CHECK `stare = 'draft' AND numar IS NULL` |
| DELETE | USING `stare = 'draft' AND fn_hr_decizii_poate('redactare') AND (creat_de = auth.uid() OR fn_hr_decizii_poate('owner'))` |

Triggere:
- **`trg_hr_decizii_imuabil`** (BEFORE UPDATE OR DELETE): dacă `OLD.stare <> 'draft'` și `current_user IN ('authenticated','anon','service_role')`, ridică eroare. În RPC-urile SECURITY DEFINER, `current_user` e owner-ul funcției, deci trec. Înlocuiește flag-ul `set_config` din v1 (C6).
  - **Regulă de review pe fiecare RPC:** scrie explicit doar coloanele tranziției lui.
- **`trg_hr_decizii_revocare`** (BEFORE INSERT OR UPDATE, doar pe draft cu `tip_cod = 'REVOCARE'`): copiază din țintă `nivel`, `proiect_id`, `employee_id`, `persoana_nume`, `titlu` și `eticheta_functie` (C12).
- **`trg_hr_decizii_jurnal`** (AFTER INSERT OR UPDATE OR DELETE pe draft): scrie în `hr_decizii_evenimente`. E **SECURITY DEFINER, cu `search_path` fix** (C33); altfel orice operație pe draft făcută din client ar pica, pentru că clientul nu are drept de scriere în jurnal.

**`hr_decizii_evenimente`**
- RLS: SELECT pentru `fn_hr_decizii_poate('citire')`.
- REVOKE INSERT / UPDATE / DELETE de la `anon`, `authenticated` și `service_role`. Doar triggerele și RPC-urile scriu.
- Un trigger BEFORE UPDATE OR DELETE ridică eroare **mereu**, inclusiv pentru owner. Ca să schimbi asta e nevoie de o migrare vizibilă.

**`hr_decizii_contor`**
- RLS: SELECT pentru `citire`.
- Fără scriere din client: doar prin `_hr_decizii_aloca` și RPC-urile de contor.

**`hr_decizii_tipuri`, `hr_decizii_semnatari`**
- RLS: SELECT pentru `auth.uid() IS NOT NULL`.
- Scrierea doar prin migrare. `imputernicire_path` stă în bucket-ul `hr-decizii`, sub `semnatari/…`, cu citire `citire`.

**`executie_completari_propuse`**
- Neschimbat, în afară de coloana nouă.
- Rândurile generatorului le inserează RPC-ul SECURITY DEFINER.

### 3.5 Bucket `hr-decizii` (privat)

**Căi:** `<serie>/<an>/<decizie_id>/generat_<ts>.pdf` și `…/semnat_<ts>.pdf`. Id-ul deciziei e în cale (C30). Numele unic cu timestamp rezolvă retry-ul (C19).

| Operație | Regulă |
|---|---|
| SELECT | `generat_*`: `fn_hr_decizii_poate('citire_doc', id)`; `semnat_*`: `fn_hr_decizii_poate('citire_scan', id)`; `semnatari/*`: `citire`. Id-ul se ia din `(storage.foldername(name))[3]::bigint` |
| INSERT | `fn_hr_decizii_poate('emitere')` și există decizia cu acel id, în starea `emisa`. Pentru înlocuirea de scan, `owner` și starea `semnata`. Sub `semnatari/*` (scanul împuternicirii), doar `owner`; calea se trece apoi în `hr_decizii_semnatari` prin migrare |
| UPDATE | niciuna |
| DELETE | doar `fn_hr_decizii_poate('owner')`. Ștergerea se face doar după `fn_hr_decizie_inlocuieste_scan`, care scrie evenimentul |

### 3.6 RPC-uri

Toate sunt `SECURITY DEFINER SET search_path = public, pg_temp`, cu `REVOKE ALL FROM PUBLIC, anon` și verificare de drept în corp. Cele publice au și `GRANT EXECUTE TO authenticated`.

| Funcție | Drept | Ce face |
|---|---|---|
| `_hr_decizii_aloca(p_serie, p_an, p_numar int, p_confirm_salt bool, p_origine text)` | **internă**: REVOKE de la authenticated, apelată doar din RPC-uri | vezi §3.7 |
| `fn_hr_decizii_urmatorul_numar(p_an)` | `citire` | Numai informativ, fără lock: `{numar}` sau `{numar: null, motiv: 'an neinitializat'}`. |
| `fn_hr_decizii_contor_initializeaza(p_an, p_ultimul_fizic int, p_sursa text)` | `contor` | Creează rândul anului dacă lipsește. `ultimul = GREATEST(ultimul, p_ultimul_fizic)`, `ultimul_initial = ultimul`, `auto_permis = true`, plus `initializat_*` și eveniment. Dacă anul e deja inițializat cu auto pornit, dă eroare și trimite la „corectează”. |
| `fn_hr_decizii_contor_opreste_auto(p_an, p_motiv)` | `contor` | `auto_permis = false` (de ex. dacă registrul de hârtie s-a reluat). Repornirea se face doar prin re-inițializare. |
| `fn_hr_decizii_contor_corecteaza(p_an, p_ultimul, p_motiv)` | `owner` | Pentru numerele manuale tastate greșit. Valoarea nouă trebuie să fie `≥ max(numar)` al deciziilor din serie și an în alte stări decât `anulata`. Numărul unei decizii anulate rămâne ocupat, iar alocarea automată sare peste el. Motivul e obligatoriu și se scrie eveniment. |
| `fn_hr_decizie_previzualizeaza(p_id)` | `redactare` | Pentru draft: întoarce `{continut, avertismente}`, calculate de aceleași funcții ca la emitere, fără alocare și fără scriere. Numărul apare ca „____”. |
| `fn_hr_decizie_emite(p_id, p_numar int DEFAULT NULL, p_confirmari jsonb DEFAULT '[]', p_confirm_salt bool DEFAULT false)` | `emitere` | vezi §3.8 |
| `fn_hr_decizie_seteaza_pdf(p_id, p_path, p_sha256)` | `emitere` | Stare `emisa`. Calea trebuie să fie `<serie>/<an>/<id>/generat_*.pdf`. Dacă `pdf_path IS NULL`, setează. Dacă e deja setat **cu aceeași cale și același hash**, întoarce ok (idempotent, C19). Altfel dă eroare. PDF-ul e derivat: dacă upload-ul cade, se regenerează din `continut`, iar numărul nu se pierde. |
| `fn_hr_decizie_ataseaza_scan(p_id, p_path, p_sha256, p_verificari jsonb)` | `scan` | vezi §3.9 |
| `fn_hr_decizie_inlocuieste_scan(p_id, p_path, p_sha256, p_motiv)` | `owner` | Stare `semnata`. Înlocuiește un scan urcat greșit (alt document, altă persoană, pagină nesemnată). Evenimentul păstrează calea și hash-ul vechi. Actualizează `dovada_path` pe propunerile `propus` ale deciziei. Fișierul vechi îl șterge apoi owner-ul din storage, iar UI-ul scrie evenimentul `fisier_sters` (C15c). |
| `fn_hr_decizie_anuleaza(p_id, p_motiv)` | `anulare` | Doar din starea `emisa`, pentru orice origine. O rezervare nefolosită se anulează cu motivul „număr nefolosit”. Numărul rămâne ocupat. Motivul e obligatoriu, iar `anulat_de` și `anulat_la` se completează. |
| `fn_hr_decizie_rezerva(p_payload jsonb)` | `rezervare` | vezi §4.F |
| `fn_hr_decizie_importa(p_payload jsonb)` | `import` | vezi §4.E |

**Funcții interne** (REVOKE de la authenticated):
- `_hr_decizie_avertismente(p_id)` calculează lista de avertismente din §4.A.2;
- `_hr_decizie_randeaza(p_id, p_numar, p_data)` produce `continut` din șabloanele din §5.

O folosesc atât `previzualizeaza`, cât și `emite`, deci textul și avertismentele au **o singură sursă**.

### 3.7 Alocarea numărului (`_hr_decizii_aloca`)

```
daca p_serie = 'carte_tehnica':                 -- doar import; fara contor
    verifica (serie, an, numar, sufix) liber → altfel eroare „nr X/an (carte tehnica) e folosit de #id”
    return p_numar
INSERT INTO hr_decizii_contor (serie, an) VALUES ('HR', p_an) ON CONFLICT DO NOTHING;
SELECT * INTO c FROM hr_decizii_contor WHERE serie = 'HR' AND an = p_an FOR UPDATE;
daca p_numar IS NULL:                           -- automat
    daca NOT c.auto_permis → eroare „numar automat oprit pentru p_an: initializeaza anul cu ultimul nr din registrul fizic”
    n := c.ultimul + 1
    cat timp exista (HR, p_an, n, sufix oarecare) → n := n + 1      -- sare peste numere manuale/importate
altfel:                                         -- manual
    daca exista (HR, p_an, p_numar, sufixul cerut) → eroare „nr p_numar/p_an e folosit de decizia #id”
    daca p_origine <> 'import' AND p_numar > c.ultimul + 20 AND NOT p_confirm_salt → eroare 'salt_mare' (R7)
    n := p_numar
UPDATE hr_decizii_contor SET ultimul = GREATEST(ultimul, n) …;
return n
```

### 3.8 Emiterea (`fn_hr_decizie_emite`)

1. Verifică dreptul `emitere`. Ia decizia cu `SELECT … FOR UPDATE WHERE id = p_id AND stare = 'draft' AND origine = 'platforma'`.
2. Calculează avertismentele cu `_hr_decizie_avertismente(p_id)` (lista din §4.A.2).
   - Orice blocant (**B**) → eroare cu lista.
   - Orice roșu (**R**) al cărui cod nu apare în `p_confirmari` → eroare cu lista; UI-ul îl afișează și cere confirmarea.
   - R3 (acoperirea domeniului) vine doar din client, în `p_confirmari` (C43).
3. Calculează `an = extract(year FROM data_emitere)`. Dacă `an ≠ an(current_date)`, `p_numar` e obligatoriu (B3/R6).
4. Alocă numărul: `n := _hr_decizii_aloca('HR', an, p_numar, p_confirm_salt, 'platforma')`.
5. Construiește `snapshot`, cu datele de acum:
   - persoana (nume, titlu și formele lui);
   - proiectul (`proiect_denumire`, `nr_contract`, `data_contract`, beneficiar, `data_termen`);
   - atestatul (tip, nr., dată, **emitent din `hr_autorizatii.emitent`** (C29), expirare, `verificat_pe_scan`, `uploadat_de`);
   - semnatarul (nume, calitate, `preambul_text`, `bloc_semnatura`, împuternicire);
   - `temei`.
6. Randează: `continut := _hr_decizie_randeaza(…)`, care dă `{titlu, preambul, decide, articole[], bloc_semnatura, luare_la_cunostinta}`.
7. Calculează `cod_verificare := 'D' || id || '-' || left(encode(sha256(convert_to(continut::text,'UTF8')),'hex'), 8)`.
8. Face UPDATE strict pe coloanele tranziției: `stare = 'emisa'`, `an`, `numar`, `mod_numar`, `snapshot`, `continut`, `cod_verificare`, `avertismente` (toate, inclusiv cele galbene, plus confirmările `{cod, mesaj, confirmat_de, confirmat_la}`), `emis_de`, `emis_la`. Scrie evenimentul.
9. Întoarce `{id, an, numar, nr_afisat, cod_verificare, avertismente}`.

### 3.9 Scanul semnat (`fn_hr_decizie_ataseaza_scan`)

1. Verifică dreptul `scan` și starea `emisa` (FOR UPDATE).
2. Verifică calea: `<serie>/<an>/<id>/semnat_*.pdf`.
3. Verifică `p_verificari` (C15b):
   - pentru numiri: `{nr, persoana, semnatura, stampila}`, toate true;
   - pentru `ALTA_DECIZIE`: `{nr, semnatura}`;
   - lista intră în eveniment.
4. Face UPDATE: `scan_path`, `scan_sha256`, `scan_de`, `scan_la`, `stare = 'semnata'`.
5. Ținte:
   - `inlocuieste_id` → `inlocuita`;
   - `revoca_id` → `revocata`;
   - în ambele cazuri, `UPDATE executie_completari_propuse SET status = 'expirat' WHERE hr_decizie_id = <tinta> AND status = 'propus'`, cu eveniment `propunere_expirata` (C9).
6. Efect: dacă `tip.camp_efect IS NOT NULL`, `nivel = 'proiect'`, `propune_efect` e true **și coloana `camp_efect` există în `executie_proiecte`** (C40):
   - citește valoarea curentă;
   - dacă e diferită de `employee_id`, inserează propunerea (tabelul din §4.A.7) și scrie eveniment;
   - numără celelalte rânduri `propus` pe același (proiect, câmp), pentru G8.
7. Întoarce `{stare, propunere_id?, concurente: n}`.

---

## 4. Fluxuri

### A. Decizie nouă (HR sau owner)

**1. Draft.** Se completează:
- tipul și nivelul (proiect sau firmă, dacă tipul e „ambele”);
- angajatul și titlul: Dl. sau D-na, propus din ultima decizie a persoanei, altfel obligatoriu de ales (C41);
- proiectul și `proiect_denumire` (precompletat, editabil);
- atestatul: lista vine din `hr_autorizatii` ale angajatului, neșterse, neînlocuite, filtrate pe `autorizatie_tipuri`;
- domeniile ISC (normalizate cu `normalizeazaDomeniiISC`) și eticheta, din `eticheta_functie` și `etichete_alternative`;
- temeiul (precompletat din tip);
- data emiterii (implicit azi) și data efectului;
- semnatarul (implicit `tip.semnatar_implicit_id`);
- bifele „luare la cunoștință” și „propune efect pe echipă”;
- `propune_efect` e implicit true, dar devine **false implicit** când pe proiect există deja un RTE activ pe alt domeniu, caz în care UI-ul întreabă explicit (C11).

**2. Avertismente.** Lista o calculează serverul (`_hr_decizie_avertismente`), la previzualizare și din nou la emitere. Clientul adaugă doar R3.

**Blocante (B)**: nu se pot trece cu confirmare.

| Cod | Condiție |
|---|---|
| B1 | Semnatarul **nu** e reprezentant legal și e chiar persoana numită (C7) |
| B2 | Angajatul e inactiv sau are `termination_date < data_efect` (C34) |
| B3 | `data_emitere > current_date`; sau anul emiterii ≠ anul curent și nu s-a dat număr manual (C5) |
| B4 | Nivelul nu e compatibil cu `tip.nivel` (C14); eticheta nu e în lista tipului |
| B5 | Textul tipului conține `{contract}`, iar proiectul n-are `nr_contract` (C42) |
| B6 | Atestatul ales nu e al angajatului, e șters (`deleted_at`), e înlocuit (`inlocuita_de_id`) sau n-are tipul cerut (C43) |
| B7 | Previzualizarea depășește o pagină A4 și la 11pt. Se verifică în client, iar butonul „Emite” rămâne inactiv (C18) |
| B8 | Numărul manual e ocupat (mesajul indică decizia care îl ocupă); numărul automat e cerut pe un an neinițializat |
| B9 | La înlocuire sau revocare: ținta nu e `semnata`; are deja altă înlocuire sau revocare emisă; sau, la înlocuire, are alt tip, alt nivel ori alt proiect (C12) |
| B10 | Câmpuri obligatorii lipsă: angajat, titlu, date, semnatar, iar la proiect și proiectul |

**Roșii (R)**: emiterea merge doar cu confirmare explicită; confirmarea se salvează în `avertismente`, cu cine și când.

| Cod | Condiție |
|---|---|
| R1 | Atestat obligatoriu lipsă |
| R2 | Atestatul e expirat la `data_efect` și nu are `fara_expirare` |
| R3 | Domeniul cerut nu e acoperit (`acoperaDomeniul`, doar în client) |
| R4 | Semnatarul nu e reprezentant legal și n-are împuternicire înregistrată sau preambul validat (2B, C8) |
| R5 | Temeiul tipului e `propunere`, nevalidat juridic (RSVTI, REVOCARE) (C28) |
| R6 | Anul emiterii ≠ anul curent (retrodatare peste an) (C5) |
| R7 | Număr manual peste `ultimul + 20` („salt mare”) (C4) |

**Galbene (G)**: informative.

| Cod | Condiție |
|---|---|
| G1 | Atestatul expiră înainte de `data_termen` a proiectului |
| G2 | Există deja o decizie activă pe același proiect, tip și domeniu, sau pe firmă pe același tip când `unic_activ`, pentru altă persoană. Sugerează „Înlocuiește” (C14) |
| G3 | `data_emitere` e anterioară ultimei decizii din registrul anului (retrodatare) |
| G4 | Proiectul n-are `data_contract` |
| G5 | Reprezentantul legal se numește pe sine (precedentul 914) (C7) |
| G6 | Tip RSVTI cu persoana ≠ `RSVTI_EMPLOYEE_ID = 81` din Adeverințe, până la v2 (C38) |
| G7 | Pe proiect există deja un RTE activ pe alt domeniu, iar `propune_efect` e false (C11) |
| G8 | Există deja o propunere `propus` pe același câmp, din nas, mail sau altă decizie. Apare la scan (C10) |
| G9 | Atestatul nu e `verificat_pe_scan` (atestatele le pot scrie și superadmin-ii, C23) |
| G10 | Temeiul diferă de cel implicit al tipului, sau temeiul are sursa `model_nas` (nevalidat juridic, dar folosit în practică) |

**3. Previzualizare.** Se cheamă `fn_hr_decizie_previzualizeaza`, iar `renderDecizieHtml` (§6) pune peste pagină „PROIECT — NEEMIS”, cu numărul „____”. Aici se verifică și B7.

**4. Emitere.**
- Se cheamă `fn_hr_decizie_emite`, cu număr automat sau manual, confirmările roșii și, după caz, `p_confirm_salt`.
- PDF-ul final se generează din `continut` și se urcă în `…/generat_<ts>.pdf`.
- Calea și hash-ul se înregistrează cu `fn_hr_decizie_seteaza_pdf`.

**5. Descărcare și print.** Se semnează și se ștampilează de mână, de semnatarul ales.

**6. Scanul semnat.**
- Imaginile se convertesc în PDF cu `imageToPdf`.
- **Ecranul arată alăturat PDF-ul generat și scanul**, cu bifele „nr. corect / persoana corectă / semnătura / ștampila” (C15b). Codul de verificare din subsol ajută la potrivire.
- Fișierul se urcă în `…/semnat_<ts>.pdf`, apoi se cheamă `fn_hr_decizie_ataseaza_scan`. Starea trece în `semnata`.

**7. Efect pe echipă.** Dacă se aplică (§3.9, pasul 6), se inserează în `executie_completari_propuse`:

| Câmp | Valoare |
|---|---|
| `camp` | `camp_efect` |
| `valoare` | `employee_id::text` |
| `valoare_afisata` | numele |
| `sursa` | `'decizie_numire'` |
| `sursa_detaliu` | „Decizia nr X/dd.mm.yyyy” |
| `hr_decizie_id` | id-ul deciziei |
| `dovada_path` | `scan_path` (relativ la bucket-ul `hr-decizii`) |
| `confidenta` | 100 |
| `motiv` | „înlocuiește {nume actual}”, dacă valoarea curentă e diferită |
| `status` | `'propus'` |

- Dacă valoarea curentă e deja angajatul, nu se inserează nimic.
- Confirmarea se face în panoul existent „Completări propuse” din Execuție (owner sau `can_manage_contracts`). **Panoul se modifică în PR3** (C20): dacă rândul are `hr_decizie_id`, deschide dovada din `hr-decizii`, nu din `executie-contracte`.
- Propunerile concurente (G8) se marchează în panou ca „concurente”.

### B. Anulare
- O decizie emisă și nesemnată (greșeală, nu s-a semnat) trece în `anulata`, cu motiv.
- Numărul rămâne ocupat și n-are niciun efect: nu există încă nicio propunere, pentru că propunerile se nasc doar la scan.
- Pentru un număr manual tastat greșit, owner-ul poate apoi corecta contorul (§3.6).

### C. Înlocuire
1. Pe o decizie semnată, „Înlocuiește” deschide un draft nou, precompletat (același tip, nivel, proiect, domeniu), cu `inlocuieste_id`.
2. La emitere se verifică B9: poate exista o singură înlocuire vie pe aceeași țintă.
3. Când noul scan e semnat, cea veche trece în `inlocuita`, propunerile ei neconfirmate trec în `expirat`, iar efectul propune noua persoană.

### D. Revocare fără înlocuire
1. Se creează o decizie de tip `REVOCARE`, cu `revoca_id`. Ținta trebuie să fie `semnata`.
2. Triggerul copiază din țintă nivelul, proiectul, persoana, titlul și eticheta (C12).
3. Art.1: „Incepand cu data de {data_efect}, se revoca Decizia nr. {nr_tinta}/{data_tinta} privind numirea {titlu} {nume} in functia de {functie_tinta}…”. Formularea e **de validat juridic**: `temei_sursa = 'propunere'`, deci R5.
4. Când e semnată, ținta trece în `revocata`, iar propunerile ei neconfirmate trec în `expirat`.
5. **Fără efect automat pe proiect:** `valoare` e NOT NULL și `fn_completare_aplica` nu știe să golească un câmp. Pe cardul din Echipă apare „⚠ decizie revocată, echipa îl are încă pe X”.

### E. Import decizii vechi („Înregistrează decizie existentă”, PR4)

**Payload-ul:**
- `serie`: `HR` implicit, sau `carte_tehnica`;
- `an` și `numar`, obligatorii; `numar_sufix`, opțional (de ex. „bis”);
- `data_emitere`: **opțională la import** (C16a), pentru că deciziile din cartea tehnică n-au dată;
- `tip_cod`: orice tip. `ALTA_DECIZIE` cu etichetă liberă acoperă tipurile din afara v1 (Pază, VT2, Gestionar);
- eticheta, nivelul, `employee_id` **sau** `persoana_nume` (extern), proiectul, atestatul (opțional);
- `semnatar_id` (implicit 121), `titlu`, `descriere`;
- `propune_efect`: implicit **false**.

**Pașii:**
1. Funcția validează doar B4, B8 (pe serie, an, număr, sufix) și coerența de nivel. B1, B2 și avertismentele de atestat nu se aplică trecutului.
2. Alocă prin `_hr_decizii_aloca(serie, an, numar, …, 'import')`:
   - seria HR împinge contorul anului cu GREATEST, dar **nu** pornește numărul automat;
   - seria `carte_tehnica` nu atinge contorul (C16b).
3. Construiește `snapshot` din datele de azi, marcat `snapshot.sursa = 'import'`. `continut` rămâne NULL: documentul este scanul.
4. Decizia intră în starea `emisa`, cu origine `import`.
5. Clientul urcă scanul și cheamă `fn_hr_decizie_ataseaza_scan` → `semnata`.
   - **La numiri scanul e obligatoriu.** Un import fără scan apare în „De rezolvat” până se completează sau se anulează.

**Decizii combinate** (de ex. MP / Șef șantier 385/2024): câte un rând pe funcție, același număr, sufix „a” / „b”, același fișier scanat.

**Primul test e seria Mironu 28.09.2026:**
- 911 CTC, 912 Coordonator SSM (Pantea), 912-bis Inspector SSM, 913 RTE MEC, 914 MP (Trusu, semnată de Trusu: importul trece), 915 Șef șantier, 916 RTE 1.1;
- după import, `ultimul` pe 2026 ajunge la 916, cu `auto_permis` încă false.

### F. Rezervare și regula de tranziție (PR3) (C1, C2)

**Regula de tranziție:**
- **Cât timp se mai fac decizii HR în Word, numărul lor îl dă platforma, niciodată invers.**
- HR apasă „Rezervă număr” și completează tipul (implicit `ALTA_DECIZIE`), descrierea, data și, opțional, persoana și proiectul.
- `fn_hr_decizie_rezerva` alocă numărul (automat dacă anul e inițializat, altfel manual) și creează rândul cu starea `emisa`, origine `rezervare` și `continut` NULL.
- HR trece numărul în documentul Word. După semnare urcă scanul (`ataseaza_scan` → `semnata`), sau anulează rezervarea dacă n-a folosit numărul.
- Dacă rezervarea e pentru o numire (de ex. o decizie RTE făcută încă în Word), scanul produce propunerea de efect, ca la o decizie generată.

**Condiție:** regula are sens doar dacă registrul e comun cu celelalte decizii HR (D1 = A). Altfel, deciziile din alte categorii date pe hârtie se vor ciocni cu numerele din platformă.

**Numărul manual** rămâne disponibil și după tranziție. Fiecare utilizare apare cu `mod_numar = 'manual'` în registru și în jurnal. Restrângerea lui doar la owner, după ce se mută toate documentele, e decizie pentru v2.

### G. Contorul pe an (PR3)

1. **Inițializare.**
   - Înainte de prima emitere automată dintr-un an, HR verifică în registrul fizic ultimul număr dat. Pentru 2026: ce s-a dat după 28.09.
   - Importă sau rezervă manual numerele găsite.
   - Apasă „Pornește numerotarea automată pentru {an}”, introduce ultimul număr fizic și sursa (cine a verificat și unde). Asta cheamă `fn_hr_decizii_contor_initializeaza`.
2. **An nou.** Pe 1 ianuarie numărul automat e oprit pentru anul nou (nu are contor), până la inițializare. Inițializarea cu 0 înseamnă că registrul se resetează anual. Asta tratează C27 fără să presupună reguli.
3. **Goluri.** Numerele din intervalul `(ultimul_initial, ultimul]` care nu au niciun rând apar în „De rezolvat → Goluri în registru”. Golurile de dinainte de inițializare țin de registrul de hârtie și nu se afișează.

---

## 5. Șabloane v1

### 5.1 Structura și textul comun (din F1)

**Ordinea blocurilor:** antet, „DECIZIA NR {nr}/{dd.mm.yyyy}”, preambul (din semnatar), „DECIDE:”, Art.1 (din tip), articolele comune, blocul de semnătură, blocul opțional „ANGAJAT, am luat la cunostinta”.

**Articolele comune** (preluate exact din F1):

> Art.2 „Atributiile legate de aceasta functie sunt cele prevazute in Fisa Postului.”
> Art.3 (doar pe proiect) „Aceasta decizie isi pastreaza valabilitatea pana la receptia definitiva a lucrarii.”
> Art.4 (Art.3 pe firmă) „Prezenta decizie se comunica salariatului si va fi dusa la indeplinire prin intermediul Departamentului Personal.”

**Preambulul.** E text literal din `hr_decizii_semnatari.preambul_text`, **nu se compune din `firma_profil`** (C17).

| Semnatar | Preambul | Validare | Bloc de semnătură |
|---|---|---|---|
| **121 (Trusu)** | Transcris **exact** din PDF-ul 916 la PR1, inclusiv numărul de Reg. Com. în formatul din model (J2007001650296), denumirea, sediul și codul fiscal din model. Structura F1: „D-nul TRUSU RAZVAN MIHAIL, reprezentant legal al S.C. GAZPET INSTAL SRL cu sediul in …, inregistrata la Registrul Comertului sub nr. … cod fiscal … in calitate de angajator;” | `preambul_validat = true` (model NAS) | „Administrator,\nTrusu Razvan” |
| **90 (Pantea)** și **125 (Tudorache)**, dacă ONRC nu arată calitate de reprezentant legal | Propunere: „S.C. GAZPET INSTAL SRL, … [datele din model], reprezentata legal prin D-nul TRUSU RAZVAN MIHAIL, administrator, prin {titlu} {NUME}, {calitate}[[, imputernicit(a) prin {imputernicire}]], in calitate de angajator;” | **de validat juridic**; `preambul_validat = false` → R4 | propunere „Pentru Administrator,\n{Nume Prenume}”, **de validat juridic** |
| **125 (Tudorache)**, dacă ONRC arată asociat / co-administrator cu drept de reprezentare | Preambul de reprezentant legal, ca la 121 | `este_reprezentant_legal = true`, fără R4 | – |

### 5.2 Variabile (C41, C42)

**Sintaxa șablonului:**
- `{var}` se înlocuiește cu valoarea variabilei;
- `[[ … ]]` e un segment opțional, care apare doar dacă toate variabilele din el au valoare;
- randarea o face **doar** `_hr_decizie_randeaza` (SQL).

| Variabilă | Valoare |
|---|---|
| `{data_efect}` | dd.mm.yyyy |
| `{titlu}` | „Dl.” / „D-na” |
| `{pe_titlu}` | „pe domnul” / „pe doamna” |
| `{numit_a}` | „numit” / „numita” |
| `{nume}` | `employees.name` din snapshot (NUME PRENUME); **de comparat cu 916** (majuscule, ordine) |
| `{functie}` | eticheta aleasă |
| `{proiect}` | `proiect_denumire` |
| `{contract}` | „{nr_contract}” sau „{nr_contract}/{data_contract}”; **formatul exact (și spațiul dinaintea virgulei) se ia din 916** |
| `{domenii}` | un domeniu: „{cod} – {denumire}”. Mai multe: „domeniile: 6.3 - …; 8.4 (D) - …” (model 82/2025). Denumirile vin din `isc_rte_domenii` |
| `{aut_nr}`, `{aut_data}`, `{aut_emitent}`, `{aut_expirare}` | din snapshot; emitentul vine din `hr_autorizatii.emitent` (C29) |
| `{temei}` | `hr_decizii.temei` |
| `{nr_tinta}`, `{data_tinta}`, `{functie_tinta}` | doar la REVOCARE |

**Textul se păstrează fără diacritice, ca în modele,** ca prima decizie generată să aibă textul identic cu 916.

### 5.3 Tipurile v1 (seed)

Textele marcate „transcris din …” se copiază literal din modelul NAS la PR1. Nu se inventează.

| Cod | Nivel | Art.1 (P = pe proiect, F = pe firmă) | Etichete alternative | Temei (`temei_sursa`) | Atestat (`autorizatie_ceruta`) | Efect |
|---|---|---|---|---|---|---|
| `RTE` | proiect | P: „Incepand cu data de {data_efect}, {titlu} {nume} se numeste in functia de RTE pentru {domenii}, in baza Autorizatiei nr. {aut_nr}/{aut_data} in cadrul proiectului „{proiect}”, contract de executie a lucrarilor nr. {contract}” | – | autorizația ISC (model_nas) | `RTE`, obligatorie + acoperirea domeniului | `rte_employee_id`, dacă `propune_efect` |
| `RTE_MEC` | proiect | P: „…se numeste in functia de RTE atestat MEC[[, in baza atestatului nr. {aut_nr}]] in cadrul proiectului „{proiect}”, contract de executie a lucrarilor nr. {contract}” (în 913 lipsește atestatul; **de confirmat**) | – | Ord. 364/2010 (propunere, **de verificat**) | `RTE_MONTAJ_IT`, recomandat (**de confirmat** că e același lucru) | doar view-ul. Pe Mironu, RTE pe domeniu umple `rte_employee_id` |
| `RTS` | proiect | P: „…se numeste in functia de Responsabil Tehnic cu Sudura[[ in baza atestatului {aut_emitent} nr. {aut_nr}]] in cadrul proiectului „{proiect}”, contract nr. {contract}” (model CORSEM) | – | atestatul (model_nas) | `RTS`, obligatoriu | `rts_employee_id` |
| `SEF_SANTIER` | proiect | P: „…se numeste in functia de {functie} in cadrul proiectului „{proiect}”, contract de executie a lucrarilor nr. {contract}” | Sef Santier / Sef de santier | – | nu | `sef_santier_employee_id`, **activ doar după PR5**. Până atunci RPC-ul vede că lipsește coloana și nu propune nimic (C40) |
| `MP` | proiect | P: „…se numeste in functia de {functie} in cadrul proiectului…” | Manager Proiect / Manager de proiect | – | `MANAGER_PROIECT_240` / `_60`, recomandat | `mp_employee_id` |
| `CTC_QC` | proiect | P: „…se numeste in functia de {functie} in cadrul proiectului…” | Responsabil CTC / Responsabil CQ / Responsabil cu Asigurarea Calitatii (AQ) | – | nu (D4) | doar view-ul |
| `INSPECTOR_SSM` | **proiect** | P: „…se numeste in functia de {functie} in cadrul proiectului…” | Inspector Sanatate si Securitate in Munca / Responsabil SSM (764) | – | `INSPECTOR_SSM_80` / `_40`, recomandat | doar view-ul |
| `LUCRATOR_DESEMNAT_SSM` (nou, C37) | **firma** | F: „…se numeste in functia de lucrator desemnat privind prevenirea si protectia cat si cadru SSM conform art. 14 si art. 20 din HGR 1425/2006 actualizata prin HGR 955/2010.” (model 16/2026) | – | model_nas | `INSPECTOR_SSM_80` / `_40`, recomandat | doar view-ul |
| `COORDONATOR_SSM` | ambele | P: „…se numeste in functia de Coordonator Sanatate si Securitate in Munca in cadrul proiectului…”. F: „…se numeste in functia de Coordonator SSM conform HGR 300/2006 actualizata.” (model 19/2026) | Coordonator SSM | model_nas | `COORDONATOR_SSM_90`, obligatoriu | doar view-ul |
| `RSVTI` | firma | F: „Incepand cu data de {data_efect}, {titlu} {nume} se numeste in functia de Responsabil cu Supravegherea si Verificarea Tehnica a Instalatiilor (RSVTI), in baza Autorizatiei ISCIR nr. {aut_nr}[[, valabila pana la {aut_expirare}]], conform {temei}.” | – | **propunere**: Legea 64/2008 republicată + PT ISCIR. **Nu există model**; de validat juridic → R5 | `RSVTI`, obligatoriu | doar view-ul + G6. v2: `AdeverinteLegator` citește RSVTI din decizia activă |
| `PSI` | ambele | F: „Numirea in functia de {functie} {pe_titlu} {nume} incepand cu data de {data_efect}, conform art. 12 din Legea 307/2006 si art. 13 din Legea 481/2004.” (model 15/2026). P: „…incepand cu data de {data_efect}, in cadrul proiectului „{proiect}”.” | Responsabil PSI / SU | model_nas | `CADRU_TEHNIC_PSI`, recomandat | doar view-ul |
| `MEDIU` | ambele | F: „Numirea in functia de {functie} {pe_titlu} {nume} incepand cu data de {data_efect}, conform art. 2 din Ordinul 175/2005 si art. 94 din OUG nr. 195/2005” (model 6/2026). P: „…, in cadrul proiectului „{proiect}”” | Responsabil de mediu | model_nas | `RESPONSABIL_MEDIU`, recomandat | doar view-ul |
| `RESPONSABIL_DESEURI` (nou, C39; D6) | ambele | F și P: **transcris din modelul 227/2026** (și 194/2022) | Responsabil deseuri / Responsabil gestiunea deseurilor (din model) | model_nas (din model) | `RESPONSABIL_DESEURI`, recomandat | doar view-ul |
| `REVOCARE` | **ambele** (nivelul se copiază din țintă) | vezi §4.D | – | **propunere** → R5 | – | niciunul |
| `ALTA_DECIZIE` (nou, C16d) | ambele | fără șablon (`are_sablon = false`): doar rezervare sau import, cu `descriere` | etichetă liberă | – | nu | niciunul; `unic_activ = false` |

**Valori implicite și note:**
- **`semnatar_implicit_id`:** 121 pe toate tipurile, până îmi spui altfel pe tip (D2c). La emitere se poate schimba oricând.
- Pe RTE, ce se întâmplă cu domeniile la G2 se decide în client.
- Temeiurile `model_nas` sunt cele folosite în practică, nevalidate juridic. Rămân în `hr_decizii_tipuri` și se schimbă prin migrare după validarea sesiunii juridice, când trec în `validat_juridic`.
- **Faza 2** (au modele pe NAS): Prim ajutor, Instalator EGD/EGT, VT2, decizii colective, centralizatorul SSM–PSI–Mediu.

---

## 6. Generare document

**Funcția și fișierul**
- **O funcție pură, `renderDecizieHtml(continut, snapshot, {nr_afisat, cod_verificare, previzualizare})`,** stă în fișierul nou `src/hrDeciziiDoc.js`. Ea face doar paginarea: textul vine gata randat de server în `continut`.
- Aceeași funcție produce previzualizarea și PDF-ul final. PDF-ul se poate regenera oricând din `continut`.
- Fără librării noi.

**Formatul paginii**
- HTML A4: 794px lățime, Times New Roman, antetul `LOGO_B64` din `src/logo.js` (antetul complet).
- **Înălțimea e fixă: 1123px, raportul A4 exact (C18).**
  - Holder-ul are `height: 1123px; overflow: hidden`, ca `renderHtmlToPdfBlob` (`Achizitii.jsx:123`, imagine pusă pe 0,0,210,297) să nu deformeze.
  - Înainte de emitere se măsoară `scrollHeight` pe conținut. Peste limită se încearcă la 11pt; dacă tot depășește, „Emite” rămâne blocat (B7). Formatul F1, cu 4 articole, încape pe o pagină.
  - Paginarea pe mai multe pagini (`renderContractPdf`) rămâne pentru faza 2.
- **Importul din `Achizitii.jsx`:** `renderHtmlToPdfBlob` se importă de acolo. Dacă la build se vede că importul trage tot modulul Achiziții în chunk-ul HR, se face o copie locală de 15 linii în `hrDeciziiDoc.js`.

**Subsol (C15a)**
- Text mic, gri: „Cod verificare D{id}-{8 hex} · generat din PontajPRO”.
- E singura abatere de la model și nu intră în comparația de text cu 916.

**Ce e și ce nu e PDF-ul**
- PDF-ul e imagine, fără strat de text, ca în restul platformei. Se acceptă în v1.
- „Regenerare” înseamnă **același text** (`continut`), nu același hash de fișier (C18).

**Hash**
- SHA-256 se calculează în client cu `crypto.subtle.digest`, pe blob-ul urcat, atât pentru PDF-ul generat, cât și pentru scan. Se trimite la RPC.

**DOCX: nu în v1.** Un Word editabil scos din platformă rupe imuabilitatea. Pachetul `docx` există dacă va fi nevoie în v2.

**Stocare și legătura cu proiectul**
- Fișierele stau în bucket-ul `hr-decizii` (§3.5).
- Atașarea la proiect se face prin `v_hr_decizii_active`. Cardul din Echipă afișează „Decizia nr X/dd.mm.yyyy”, cu link semnat la PDF-ul generat. Scanul are link doar pentru `citire_scan`.
- Nu se copiază nimic în `executie-contracte` (C32).

**Cartea tehnică CTC** (pozițiile 11/13/15/16 din template-ul 1): v2, printr-un buton „Pune în cartea tehnică” care copiază fișierul cu `incarcaFisier` (`ctc/ctcDb.js:82`).

---

## 7. UI și drepturi

### HR → tab nou „📜 Decizii”

**Unde și cine vede**
- Codul stă în fișierul nou `src/HrDecizii.jsx`. În `HR.jsx` se adaugă doar o intrare în lista de tab-uri și un rând de render, după modelul `AdeverinteLegator` (`HR.jsx:326`).
- Tab-ul apare doar dacă `fn_hr_decizii_poate('citire')`. **Nu se folosește `canAccessPersonal`** și nici poarta HR, care lasă superadmin-ii să treacă.

**Registru**
- Filtre: an, serie, tip, stare, origine, proiect sau firmă, angajat, semnatar.
- Coloane: nr/data, funcție, persoană, proiect sau firmă, semnatar, stare (cu „nesemnată” pentru `emisa`), mod număr (A/M), PDF, scan ✓, lanț de înlocuire sau revocare.

**Acțiuni**, fiecare vizibilă doar dacă helper-ul de drept o permite:
- Decizie nouă, Previzualizare, Emite, Descarcă, Încarcă scan semnat (cu verificarea alăturată), Înlocuiește, Revocă, Anulează;
- Rezervă număr, Înregistrează decizie existentă (PR4);
- doar owner: Corectează contorul, Înlocuiește scanul.

**Antetul anului:** contorul („ultimul nr: 916 · automat: oprit / pornit din 07.10 de X”) și butonul „Pornește numerotarea automată”.

**Istoric pe decizie:** evenimentele din `hr_decizii_evenimente`, cu confirmările de avertismente și verificările de scan.

**„De rezolvat”** (C45):
- emise nesemnate de peste 7 zile;
- propuneri de efect neconfirmate (`hr_decizie_id` cu status `propus`);
- importuri fără scan;
- goluri în registru (după inițializare);
- G6: RSVTI din decizia activă ≠ 81.

### Execuție → dashboard proiect → Echipă (`Executie.jsx:3074-3124`, recitit pe branch-ul de lucru)

**Carduri de rol**
- Pe fiecare card de rol (RTE, RTS, MP; Șef șantier **doar dacă există coloana**, C40) apare una dintre etichete:
  - „Decizia nr X/data”;
  - „nesemnată”;
  - „⚠ fără decizie”;
  - „⚠ echipa ≠ decizia activă” (C10): echipa are altă persoană decât decizia activă;
  - „⚠ decizie revocată, echipa îl are încă pe X”.
- Butonul „Generează decizie” deschide același modal, precompletat cu proiectul, rolul și persoana curentă.

**Echipa extinsă**
- Un rând „Echipă extinsă din decizii”: CTC, SSM, PSI, Mediu, Deșeuri, MEC.

**Butoanele**
- Apar doar dacă `fn_hr_decizii_poate('emitere')`, apelat o dată la încărcare. Nu se replică predicatul în JS.

**Panoul „Completări propuse”** (C20)
- Pentru rândurile cu `hr_decizie_id`, deschide dovada din bucket-ul `hr-decizii`.
- Afișează sursa „Decizia nr X/data” și marchează propunerile concurente.

---

## 8. Securitate

**Fără automatizări în v1**
- Nu există cron, edge functions sau AI care citește conținut extern, deci fișa de la pct. 7 din CLAUDE.md nu se aplică.
- Dacă în faza 2 apare OCR sau AI pe deciziile vechi, intră conținut extern și e nevoie de fișă, plus poarta de confirmare.

**Nu se acordă drepturi noi prin PR-uri.** Orice acordare de `hr.decizii` (D3 = B') se face cu acordul tău explicit, pe persoană.

**Igiena obiectelor noi**
- Funcțiile sunt SECURITY DEFINER, cu `search_path` fix, REVOKE de la PUBLIC și anon și verificare de drept în cod. Funcțiile interne `_hr_*` nu au EXECUTE pentru authenticated.
- Tabelele au RLS pe `auth.uid()` plus drept, nu `USING(true)`, și GRANT pe coloane la `hr_decizii`.
- View-ul e `security_invoker`.
- După apply se rulează `get_advisors`.

**Livrare**
- Migrarea se livrează prin `scripts/livrare_migrare.sh`, cu rollback în `supabase/revenire/`.
- Înainte de apply e nevoie de GO de la Copilot, căruia i se trimite efectiv diff-ul SQL, și de OK-ul tău.
- Seed-ul (tipuri și semnatari) e inserare de date: se face după ce vezi preview-ul.

**Riscuri acceptate** (de confirmat de tine, D7):
- **Doi owneri (121 și 125)** pot emite, își pot confirma singuri avertismentele roșii, pot aplica efectul pe echipă și sunt și semnatari. Nu există a doua pereche de ochi pe aceste lanțuri (C35).
  - Atenuare: orice confirmare și orice aplicare rămân nominal în jurnal.
- **Atestatele le pot scrie și superadmin-ii** (C23). Un superadmin își poate crea un atestat și primi o decizie fără avertisment roșu.
  - Atenuare: G9 („atestat neverificat pe scan”), plus `uploadat_de` în snapshot.

**Găuri existente, în afara scope-ului**, de pus ca task separat pentru sesiunea Module [V]:
1. `executie_proiecte_modify` (ALL) permite oricărui utilizator logat să scrie rte, rts și mp prin API. Până se repară, decizia nu e singura sursă a echipei, ci sursa auditată.
2. În bucket-ul `executie-contracte`, orice utilizator autentificat poate face SELECT, INSERT, UPDATE și DELETE.
3. În bucket-ul `autorizatii`, orice utilizator autentificat poate face SELECT, INSERT și DELETE.
4. Pe `hr_autorizatii`, SELECT e `true` pentru orice utilizator autentificat. Scrierea o au și toți superadmin-ii, plus departamentul Administrativ.
5. Pe `executie_completari_propuse`, SELECT e deschis oricărui utilizator logat. Generatorul pune acolo doar numele și calea, nu fișierul.
6. `HR.jsx:149` lasă în `/hr` orice admin sau superadmin. Generatorul nu se bazează pe poarta asta.
7. „CUI RO13038090” e tipărit în `DeclaratieTehnicaSection.jsx:287` și `SupapeDeclaratiiSection.jsx:615`, deși antetul are RO 22029920.

---

## 9. Decizii pentru Razvan

### Închise

**1A+B: număr automat + manual.** Implementarea e în §3.7 și §4.F–G, cu inițializare explicită pe an.

**2B: semnează Trusu, Pantea sau Tudorache, după decizie.** Implementarea:
- toți trei sunt activi;
- fiecare are preambulul lui;
- lipsa împuternicirii sau a validării juridice dă R4 confirmabil;
- împuternicitul nu-și semnează propria numire (B1).

**3: RSVTI, PSI, Mediu și CTC-QC intră în v1** (§5.3).

### Deschise

1. **D1. Registrul.**
   - **A:** registrul platformei e **registrul HR comun**. Numirile se generează, iar celelalte decizii HR, făcute încă în Word, își **rezervă** numărul aici.
   - **B:** registrul ține doar numirile, cu risc de coliziune cu numerele date în Word.
   - **Recomand A**, cu atât mai mult cu cât ai spus „până mutăm toate documentele în platformă”. Rămâne de confirmat cu Natalia că registrul fizic e comun.
2. **D2. Ce mai rămâne la 2B.**
   - (a) Extrasul ONRC: are Tudorache calitate de reprezentant legal? De aici rezultă preambulul ei.
   - (b) Faci împuterniciri scrise pentru Pantea (și Tudorache, dacă e cazul)? Recomand da; nu blochează pornirea.
   - (c) Semnatarul implicit pe tip. De exemplu: SSM și PSI pe Pantea? Toate pe tine? Implicit pun 121 peste tot.
3. **D3. Cine din HR redactează și emite.** Recomandarea s-a inversat față de v1 (C24).
   - **A:** cheia existentă `hr`. Nu recomand: din cei 8 deținători, doar 1 e din HR. Ceilalți sunt 2 din Ofertare, 1 din IT, 1 de la Contabilitate și 3 superadmin din Administrativ. Ar primi drept de emitere în registrul oficial.
   - **B′ (recomandat):** `department = 'HR'` (azi 1 profil) **sau** sub-cheia nouă `hr.decizii`, acordată nominal, cu acordul tău, pe persoană. Superadmin nu intră.
   - **Atenție:** prin regula de prefix, `hr.decizii` deschide ruta `/hr`. În PR3 se verifică dacă celelalte tab-uri HR au gardă proprie. Dacă nu au, `hr.decizii` se dă doar celor care au deja `hr`.
4. **D4. CTC/QC fără atestat.**
   - **A:** fără atestat obligatoriu în v1.
   - **B:** tip nou `CTC_QC` în `hr_autorizatii_tipuri`, adică o schimbare de nomenclator.
   - **Recomand A.**
5. **D5. Semnătura electronică.**
   - **A:** niciodată în v1 (print, semnat de mână, scan).
   - **B:** doar când semnatarul e chiar utilizatorul logat.
   - **Recomand A.**
6. **D6. Cele două funcții propuse în plus.**
   - Responsabil deșeuri și Lucrător desemnat SSM pe firmă intră în v1?
   - **Recomand da**: câte un rând de seed fiecare, cu model pe NAS.
7. **D7. Riscurile acceptate din §8.**
   - Owner-ii își pot confirma singuri avertismentele roșii.
   - Superadmin-ii pot scrie atestate.
   - Le accepți ca atare în v1, sau vrei a doua confirmare pe R1/R2 (de ex. „R confirmat doar de alt utilizator decât cel care emite”)?

### De verificat (nu sunt decizii)
- RTE MEC = `RTE_MONTAJ_IT`? Ord. 364/2010 e temeiul corect?
- Temeiurile pentru RSVTI și REVOCARE, plus preambulul și blocul de semnătură ale împuternicitului (sesiunea juridică).
- Emitentul RTS e ISCIR, nu MDLPA? Corectura se face în `hr_autorizatii.emitent` pe înregistrări, pentru că decizia preia emitentul de acolo.
- Formatul `{contract}`, `{nume}` și spațierea, prin comparație cu PDF-ul 916. Transcrierea literală a preambulului 916.
- Numerele date după 28.09.2026 în registrul fizic, înainte de inițializarea lui 2026.
- Cu Natalia: registrul e comun? Se resetează anual? Ce e seria din 2024 (298 în octombrie, după 368 în iulie)?
- Numirile pentru colaboratori externi: 14 din 20 de atestate RTE sunt pe externi. v1 generează doar pentru angajați; externii intră doar prin import sau rezervare.

---

## 10. Ordinea PR-urilor și testele de acceptare

| PR | Conținut | Dependențe |
|---|---|---|
| **PR1** | Migrare (nume la livrare, următorul prefix liber):<br>– 5 tabele noi și coloana `executie_completari_propuse.hr_decizie_id`;<br>– view, bucket `hr-decizii` cu politici, `fn_hr_decizii_poate`, `_hr_decizii_aloca`, `_hr_decizie_avertismente`, `_hr_decizie_randeaza` și RPC-urile din §3.6;<br>– triggere, RLS, GRANT pe coloane;<br>– seed: 15 tipuri (textele transcrise din modelele NAS) și 3 semnatari.<br>Plus rollback și teste SQL în `supabase/tests/hr_decizii.test.sql`, după modelul `conturi_ciclu_viata.test.sql` | D1, D3, D6 răspunse (D2 nu blochează). Apply doar cu OK-ul tău și GO de la Copilot |
| **PR2** | `src/hrDeciziiDoc.js`: `renderDecizieHtml`, paginare A4 fixă, verificarea de depășire, PDF cu `LOGO_B64`, subsol cu cod, hash | PR1 aplicat |
| **PR3** | `src/HrDecizii.jsx` (registru, decizie nouă, emitere, scan cu verificare, anulare, înlocuire, revocare, **contor și inițializare, rezervare**, „De rezolvat”)<br>+ tab-ul în `HR.jsx`<br>+ cardurile Echipă și „Generează decizie” în `Executie.jsx`<br>+ panoul „Completări propuse” cu bucket-ul corect | **după merge-ul branch-ului sef-santier** (atinge aceleași zone din `Executie.jsx`; branch-ul e azi cu 6 commit-uri înainte de main [V]) |
| **PR4** | Ecranul „Înregistrează decizie existentă” (serii HR și carte tehnică, sufix, combinate, externi)<br>+ importul seriei Mironu 911–916 (date reale: preview → OK → apply) | PR3 |
| **PR5** (după 20261017a) | Activarea efectului pe `SEF_SANTIER` + extinderea whitelist-ului din `fn_completare_aplica` | acordul tău (schimbare de RPC) |

### Teste de acceptare

**Numerotare**
1. Două emiteri automate în același an primesc numere consecutive diferite. Contorul nu sare și nu se dublează (test de concurență cu două sesiuni).
2. Un număr manual ocupat dă eroarea „nr X/an e folosit de decizia #id”.
3. Manual 950/2026 duce `ultimul` la 950; următorul număr automat e 951.
4. Manual 762/2026 (liber, sub contor) e acceptat, iar contorul rămâne neschimbat. Un număr automat ulterior sare peste numerele manuale ocupate.
5. Pe un an neinițializat, numărul automat e refuzat cu mesaj clar; numărul manual merge. După `contor_initializeaza(2026, 916, …)`, numărul automat dă 917.
6. Manual 9160 fără confirmare dă eroarea „salt_mare”; cu confirmare trece. `contor_corecteaza` făcut de un utilizator non-owner e refuzat. Făcut de owner, sub `max(numar)` neanulat, e refuzat. După anularea lui 9160 și corecție, numărul automat continuă de la valoarea corectată și sare peste 9160 când ajunge acolo.
7. `data_emitere` în viitor e refuzată. Data de 30.12 a anului trecut, emisă în ianuarie, cere număr manual plus confirmarea R6.

**Imuabilitate și ocolire** (C6, C33)

8. Ca redactor, prin API direct:
   - INSERT cu `stare = 'semnata'` / `origine = 'import'` / `numar` / `creat_de` străin → refuz (GRANT pe coloane sau WITH CHECK);
   - UPDATE pe un draft către `stare = 'emisa'` → refuz;
   - UPDATE sau DELETE pe o decizie emisă → refuz, inclusiv ca `service_role`.
9. Un draft se poate șterge de creator sau de owner, dar nu de alt redactor. Jurnalul nu se poate modifica sau șterge de nimeni din API.

**Semnatar** (C7, C8)

10. Pantea semnatar pe numirea lui Pantea → B1, emitere blocată. Trusu semnatar pe numirea lui Trusu → doar G5. Importul lui 914 trece.
11. Pantea semnatar pe numirea altcuiva, fără împuternicire → R4. Emiterea merge doar cu confirmare, iar confirmarea apare în `avertismente`, cu cine și când. Preambulul din `continut` e cel al lui Pantea, nu al lui Trusu.

**Avertismente**

12. RTE cu autorizație expirată → R2, emitere doar cu confirmare. RTE cu atestatul altui angajat sau șters → B6.
13. Angajat inactiv → B2. Proiect fără `nr_contract` pe RTE → B5. RSVTI pe proiect → B4. RSVTI fără temei validat → R5.

**Efect pe echipă** (C9–C11)

14. Scan semnat pe un RTE cu `rte_employee_id` gol → rând în „Completări propuse”, cu `hr_decizie_id`. Panoul deschide scanul din `hr-decizii`. Owner-ul confirmă și câmpul se completează. Dacă există deja altă persoană, apare „înlocuiește X”.
15. Înlocuire semnată înainte de confirmarea propunerii vechi → propunerea veche devine `expirat`, iar `fn_completare_aplica` pe ea dă „deja decisă”.
16. Al doilea RTE pe alt domeniu, cu `propune_efect = false` → nicio propunere și niciun „înlocuiește” fals.

**Ciclu de viață** (C12)

17. Înlocuire: noua decizie semnată face ca cea veche să treacă în `inlocuita`, iar lanțul e vizibil. O a doua înlocuire emisă pe aceeași țintă e refuzată.
18. Revocare: ținta nesemnată → refuz. Revocarea semnată face ca ținta să treacă în `revocata`, iar nivelul, persoana și proiectul sunt copiate din țintă.
19. Anulare: numărul rămâne ocupat, fără efect. O rezervare nefolosită se poate anula.

**Import și rezervare** (C16)

20. Import Mironu: cele 7 decizii pe 6 numere (912 și 912-bis) intră, cu scan. Contorul 2026 ajunge la 916, iar `auto_permis` rămâne false.
21. Import din cartea tehnică 391/2025 nu se ciocnește cu 391/2025 din HR și nu mută contorul HR. Importul fără dată merge doar cu `origine = 'import'`.
22. O decizie combinată 385/2024 intră ca 385a și 385b, cu același scan. Un extern intră cu `persoana_nume`.
23. Rezervare cu număr automat după inițializare: numărul intră în registru. Scanul ulterior o trece în `semnata`. O rezervare de numire cu scan produce propunere de efect.

**Drepturi și storage** (C24, C25, C30, C31)

24. Un superadmin fără departament HR și fără `hr.decizii` (de ex. Pantea) nu vede tab-ul și nu poate emite prin RPC.
25. Un editor `hr` din Ofertare nu are niciun drept pe decizii, dacă D3 = B′.
26. Un editor `executie`:
    - vede deciziile pe proiect și PDF-ul lor generat;
    - nu vede deciziile pe firmă;
    - nu poate descărca scanul semnat (`semnat_*`).
27. Un utilizator `can_manage_contracts` vede scanul unei decizii pe proiect (ca să confirme), dar nu și pe al uneia pe firmă.
28. Un utilizator doar-HR nu poate confirma efectul (`fn_completare_aplica` → „fără drepturi”).
29. `seteaza_pdf` repetat cu aceeași cale și același hash → ok. Cu altă cale → eroare. UPDATE în bucket → refuz. DELETE făcut de non-owner → refuz.

**Document** (C18)

30. Textul randat de `_hr_decizie_randeaza` pentru datele lui 916 e identic cu transcrierea lui 916; comparația se face pe text, fără subsol. Regenerarea din `continut` dă același text.
31. PDF-ul are o pagină A4 nedeformată: canvas-ul are raport 794:1123. Un conținut prea lung dezactivează „Emite” (B7).
32. Variantele de gen: „Dl./D-na”, „pe domnul/pe doamna”, „numit/numita” ies corect pe PSI F și pe RTE P.

**Build și advisori**

33. `npm install` și `npx vite build` trec. `grep -n` confirmă că numele noilor funcții există. `get_advisors` nu dă avertismente noi.

---

**Note de proces**
- Specificația e pentru sesiunea Module ERP: `HR.jsx` și `Executie.jsx` țin de ea, la fel și merge-ul.
- Pe branch-ul `claude/erp-continuare-x4p5a7-sef-santier` nu mai e nimic necomis [V]. PR3 așteaptă doar merge-ul acestui branch.
- Fișierul de față e necomis: commit-ul și PR-ul (draft) le face sesiunea care îl preia, sau sesiunea de chat la cererea ta.

---

## Anexa — Critica respinsă sau preluată modificat

Toate cele 45 de puncte au fost evaluate. Mai jos sunt doar cele respinse sau preluate altfel decât au fost propuse; restul sunt integrate, cu trimiterea (Cn) în text.

| Punct | Propunerea criticii | Ce s-a făcut | Motiv |
|---|---|---|---|
| C1 (alternativa) | „Rezervă / importă” trece în PR3 | Doar **rezervarea** și inițializarea trec în PR3. Importul rămâne în PR4 | Cu inițializarea explicită a anului, riscul de ciocnire dispare fără să grăbim ecranul de import, care e mai mare (serii, combinate, externi) |
| C2 (golurile) | Tab-ul arată toate golurile sub contor | Arată doar golurile **de după inițializare** (`ultimul_initial`) | Sub inițializare sursa e registrul de hârtie. În 2026 golurile ar fi 1–5, 20–225, 241–758…, adică zgomot fără acțiune posibilă |
| C4 (recalcularea la anulare) | La anularea pe motiv „număr greșit”, contorul se recalculează automat | **Respins.** În loc: corecție owner-only cu motiv, plus alocare care sare peste numerele ocupate | Recalcularea automată contrazice invariantul „numărul anulat rămâne ocupat”, se poate ciocni cu alocări concurente și ascunde greșeala. Corecția explicită lasă urmă în jurnal |
| C5 (forma) | `CHECK data_emitere <= current_date` | Regula se verifică în RPC (B3) | Un CHECK cu `current_date` nu e imutabil: s-ar reevalua la orice UPDATE ulterior și ar bloca operațiile legitime pe rânduri vechi (de ex. anularea) |
| C6 (mecanismul) | WITH CHECK enumerat pe toate coloanele serverului | GRANT pe coloane, plus un WITH CHECK scurt, plus trigger pe `current_user` | Același efect, mai greu de uitat o coloană nouă: o coloană fără GRANT e implicit inaccesibilă clientului. `current_user` înlocuiește flag-ul `set_config` |
| C9 (varianta minimă) | Un format parsabil în `sursa_detaliu` | **Respins** în favoarea FK-ului `hr_decizie_id` | Parsarea textului e fragilă. Coloana e aditivă, nullable și intră în același OK pe PR1 |
| C11 (forma) | Bifa `rte_principal` | Bifa generală `propune_efect`, pe orice tip | Aceeași problemă poate apărea la RTS sau MP (de ex. o înlocuire temporară); o singură bifă acoperă toate cazurile |
| C13 (faptul) | „`executie_proiecte` n-are nicio coloană de status” | Parțial inexact: **există `activ`** [V] (23 de proiecte active, 5 inactive). View-ul o folosește | Corectura de fond a criticii (excluderea proiectelor închise) e preluată |
| C16e | `employee_id` NOT NULL exclude externii, deci trebuie relaxat | Relaxat **doar** la import și rezervare (`persoana_nume`). Generarea pentru externi rămâne în afara v1 | Generarea pentru externi cere atestate pe `extern_id`, alt preambul (colaborare, nu angajator) și altă bază legală. E temă separată |
| C18 (forma) | Blocare directă dacă `scrollHeight > 1123` | Întâi se încearcă la 11pt, apoi se blochează | Păstrează regula din v1 (11pt) și evită blocările pe depășiri de un rând |
| C28 (blocarea) | Emiterea RSVTI și REVOCARE blocată până la OK-ul juridic | **Respins.** Temeiul e editabil în draft, iar `temei_sursa = 'propunere'` dă R5, confirmabil | Razvan a cerut explicit RSVTI în v1 („adaugă și RSVTI”). O blocare până la jurist ar goli cererea. Riscul rămâne vizibil și jurnalizat. Critica oferea ea însăși alternativa |
| C30 (forma) | Căi separate `proiect/<id>/…` și `firma/…` | Id-ul deciziei în cale, plus politica cu EXISTS prin `fn_hr_decizii_poate` | O singură regulă de drept, aceeași ca în RLS. Mutarea unei decizii între nivelele de proiect și firmă nu e posibilă oricum (imuabilitate) |
| C31 (cercul) | Scanul îl citesc doar redactorii, emitenții și owner-ul | Se adaugă `confirm` (owner sau `can_manage_contracts`), **doar pe deciziile pe proiect** | Cine confirmă efectul pe echipă trebuie să vadă dovada semnată. Altfel confirmarea e oarbă |
| C45 (`comunicat_la`) | Data comunicării către salariat | Amânată pentru v2, notat la „Ce NU face” | Nu blochează nimic în v1. Bifa „luare la cunoștință” acoperă cazul uzual |
| C8 (semnatarul implicit) | `semnatar_implicit_id` per tip | Preluat, dar cu valoarea **121 peste tot** până la răspunsul D2c | Repartiția pe tipuri e decizia lui Razvan, nu a specificației |

---

## Anexa A — Jurnal

| Versiune | Data | Autor | Ce |
|---|---|---|---|
| **v1 (cercetare + spec)** | 06.10.2026 | sesiunea de chat | Trei cercetări în citire: BD (`dxczwkbciseqniprspcu`), cod (`origin/main` 0e9b7b0), NAS (modelele F1/F2, seria Mironu 911–916, cartea tehnică). Pe baza lor, specificația v1 în 11 secțiuni, cu 5 decizii deschise (D1–D5) |
| **critică internă** | 06.10.2026 | review adversarial (sesiunea de chat) | 45 de puncte: (A) contradicții și goluri 1–20, (B) afirmații nesusținute 21–29, (C) securitate și date personale 30–35, (D) funcții tratate greșit 36–40, (E) ce ar inventa implementatorul 41–45. Punctele critice: ocolirea RPC-urilor din client (C6), contorul gol la prima emitere (C1), 2B redeschisă (C8), cheia `hr` ≠ HR (C24) |
| **v1.1** | 06.10.2026 | sesiunea de chat | Specificația completă cu critica integrată: 2B implementată cum a cerut Razvan, inițializarea contorului, alocare unică, GRANT pe coloane și imuabilitate pe `current_user`, randare doar pe server, preambul literal, propuneri legate de decizie și expirabile, drepturi exacte, serii la import, 15 tipuri (+ Deșeuri, + Lucrător desemnat SSM, + ALTA_DECIZIE), 33 de teste. Punctele respinse sau modificate sunt în anexa „Critica respinsă” |

**Reverificări făcute în tura v1.1** (doar SELECT, git și cod):
- Coloanele `employees`, `profiles`, `firma_profil`, `hr_autorizatii`, `executie_completari_propuse` și `executie_proiecte` (inclusiv `activ`: 23 de proiecte active, 5 inactive; 1 din 28 fără `nr_contract`).
- Rolurile și departamentele semnatarilor.
- Compoziția cheii `hr` (8 deținători: 1 HR, 2 Ofertare, 1 IT, 1 Contabilitate, 3 Administrativ).
- 8 superadmin; cheia `executie` cu 13 deținători; `can_manage_contracts` la 8 profiluri.
- Politicile de storage pe `autorizatii` și `executie-contracte`.
- Politicile pe `hr_autorizatii` și `executie_completari_propuse`; corpul lui `fn_completare_aplica`; corpul lui `fn_executie_assign_numar_document`.
- Lipsa bucket-ului `hr-decizii` și a tabelelor de decizii.
- `renderHtmlToPdfBlob` (0,0,210,297).
- Bucket-ul hardcodat din `Executie.jsx:706`.
- Poarta `HR.jsx:149`.
- `RSVTI_EMPLOYEE_ID = 81`.
- Starea branch-ului sef-santier: curat, cu 10c4433 pe remote.
- CUI-ul greșit, prezent în două fișiere.

**Trasabilitatea criticii:**

| Puncte | Unde |
|---|---|
| C1–C5 | §2.2–4, §3.6–3.7, §4.F–G |
| C6 | §2.6, §3.4 |
| C7 | §2.9, B1 / G5 |
| C8 | §0, §3.1, §5.1, §9 |
| C9 | §2.8, §3.1, §3.9 |
| C10 | G8, §7 |
| C11 | `propune_efect`, G7 |
| C12 | B9, §3.1, §4.D |
| C13 | §3.2 |
| C14 | B4 / G2 |
| C15 | §3.9, §4.A.6, §6 |
| C16 | §3.1, §4.E |
| C17 | §1, §5.1 |
| C18 | §6, B7 |
| C19 | §3.5–3.6 |
| C20 | §4.A.7, §7 |
| C21–C24 | §1, §9 |
| C25 | §3.3 |
| C26 | §0, §9 D2 |
| C27 | §1, §4.G |
| C28 | `temei_sursa`, R5 |
| C29 | §3.8 |
| C30–C31 | §3.3, §3.5 |
| C32 | §2.10, §6 |
| C33 | §3.4 |
| C34 | B2 |
| C35 | §8, D7 |
| C36–C37 | §5.3 |
| C38 | G6 |
| C39 | §5.3, D6 |
| C40 | §3.9, §7 |
| C41–C42 | §5.2, B5 |
| C43 | B6, R3 |
| C44 | §3.3 |
| C45 | §7, „Ce NU face” |
