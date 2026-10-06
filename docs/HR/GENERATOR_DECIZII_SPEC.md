# Specificație v1.5: Generator de decizii de numire (registru HR)

Destinatar: sesiunea „Module ERP — programare” (`session_016DH8ri5jCZPoDHhfWL9Z5i`). Versiunea v1.1 e din 06.10.2026 și a fost scrisă de sesiunea de chat. Pornește de la v1 (trei cercetări: BD, cod, NAS), integrează critica internă adversarială (45 de puncte) și verificările proprii făcute în această tură. **Versiunea v1.2 (06.10.2026 seara) integrează răspunsurile lui Răzvan la D1–D7 (`claude_context` #1622) și reverificările de după merge-ul #629 (șef de șantier).** Tot în v1.2: verificarea adversarială pe 3 unghiuri (consistență, drepturi, telefon), cu 38 de constatări (VA1–VA38), reverificate și integrate în text. **Versiunea v1.3 (06.10.2026 noaptea) integrează verdictele NO-GO de la Copilot (3×P0, 4×P1, 2×P2) și Jakarinos (J1–J23)**, verificate față de text și BD (doar SELECT); lista și locurile sunt în Anexa A, iar respingerile în „Critica respinsă”. **Versiunea v1.4 (06.10.2026 noaptea, runda 2) integrează verdictele NO-GO punctuale pe v1.3: Copilot (1×P0, 2×P1, 2×P2; P2-1…P2-5) și Jakarinos (13 constatări, J2-1…J2-13, blocante 1–4)**, verificate față de text și BD (doar SELECT). **Versiunea v1.5 (06.10.2026 noaptea, runda 3) integrează verdictele pe v1.4 (commit 42258b1): Copilot GO DESIGN cu 2×P1 + 1×P2 (P3-1…P3-3) și Jakarinos NO-GO cu 9 constatări (J3-1…J3-9, blocant J3-1)**, verificate față de text și BD (doar SELECT).

Toate verificările s-au făcut doar în citire: SELECT-uri, git și cod. Nu s-a modificat nimic în BD sau în repo, cu excepția acestui fișier (branch `claude/erp-continuare-x4p5a7-generator-decizii`, PR draft #630; v1.2 e comisă în 6a21982; v1.3 e comisă în c85c9e9; v1.4 e comisă în 42258b1; modificările v1.5 sunt necomise).

**Legendă**
- **[V]**: fapt reverificat în tura v1.1 sau v1.2 (06.10.2026).
- **(Cn)**: corectură preluată din punctul n al criticii.
- **(Dn)**: schimbare din răspunsul lui Răzvan la decizia Dn (v1.2).
- **(VAn)**: corectură din verificarea adversarială v1.2, punctul n (lista și unde s-a aplicat: Anexa A).
- **(Pn)**: corectură v1.3 din verdictul Copilot (P0-1…P0-3, P1-1…P1-4, P2.1, P2.2).
- **(Jn)**: corectură v1.3 din verdictul Jakarinos, constatarea n (J1–J23).
- **(V2-n)**: corectură v1.4 din reverificarea rundei 2 (verificator), punctul n.
- **(P2-n)**: corectură v1.4 din runda 2 Copilot (P2-1 snapshot atomic, P2-2 alocator la import, P2-3 baseline la înlocuirea scanului, P2-4 numele view-ului, P2-5 `cerere_emitere_hash`). Ca să nu se confunde, tag-urile v1.3 de prioritate 2 se scriu de acum **P2.1** (hash declarat) și **P2.2** (`_hr_azi()`).
- **(J2-n)**: corectură v1.4 din runda 2 Jakarinos, constatarea n (J2-1…J2-13).
- **(P3-n)**: corectură v1.5 din runda 3 Copilot (P3-1 helper de acoperire pur, P3-2 „golire” propusă la revocare, P3-3 UNIQUE pe `cerere_emitere`).
- **(J3-n)**: corectură v1.5 din runda 3 Jakarinos, constatarea n (J3-1…J3-9).
- Punctele din critică respinse sau preluate modificat sunt în anexa „Critica respinsă”.

---

## 0. Pe scurt

### Ce zic despre deciziile tale

**1A+B (număr automat, plus număr manual cât timp documentele nu sunt toate în platformă): corect, și chiar obligatoriu.**

Pe NAS există numere duplicate (912 de două ori, ambele semnate) și goluri (762 lipsește). Fără număr manual nu putem importa trecutul și nu putem lucra în paralel cu Word-ul. Ca registrul să nu se strice, pun trei plase de siguranță:
1. **Numărul automat pornește abia după ce HR introduce, pentru anul respectiv, ultimul număr din registrul fizic (C1).** Până atunci se lucrează doar cu număr manual. Contorul gol nu mai poate da „1/2026”.
2. **Cât timp se mai fac decizii în Word, numărul îl dă platforma, niciodată invers (C2).** Butonul „Rezervă număr” alocă numărul atomic, iar HR îl trece în documentul Word. Așa contorul nu se ciocnește cu hârtia. Registrul platformei e **registrul HR comun** (D1): regula ține pentru toate deciziile HR, nu doar pentru numiri.
3. **Greșelile de tastare au frână (C4).** Un număr manual tastat greșit (9160 în loc de 916) cere confirmarea de „salt mare”. Contorul îl poate corecta doar owner-ul, cu motiv, iar corectura rămâne în istoric.

**2B (semnezi tu, Pantea sau Tudorache, după decizie, cu alegere la emitere): se face exact așa.**

La emitere alegi semnatarul dintre cei trei. **Semnatarul implicit e Trușu (121) pe toate tipurile** (D2c); la emitere se poate schimba (C8). Ce urmează e **risc de cunoscut, nu blocaj**:
- **Practica de până acum.** Toate cele peste 40 de decizii Gazpet citite pe NAS (2020–2026) sunt semnate de tine, ca reprezentant legal. Pe NAS nu există nicio împuternicire de semnare pentru Pantea sau Tudorache.
- **Preambulul diferă pe semnatar.** Textul „D-nul TRUSU RAZVAN MIHAIL, reprezentant legal…” nu poate rămâne același când semnează altcineva, așa că fiecare semnatar vine cu preambulul și blocul lui de semnătură.
- **Reprezentant legal e doar Trușu (D2a).** Tudorache nu e: semnează pe bază de împuternicire, exact ca Pantea. Întrebarea ONRC din v1.1 (C26) e închisă.
- **Pantea și Tudorache semnează pe împuternicire scrisă, care se face pentru amândoi (D2b).** Până se încarcă împuternicirea (nr., dată, scan) și se validează juridic preambulul, la emitere (și la rezervarea unei numiri, VA17) apare avertismentul roșu R4. Cine emite îl confirmă explicit, iar confirmarea rămâne în istoric. Nu e condiție de pornire.
- **Propria numire (C7).** Un semnatar împuternicit nu-și poate semna propria numire: Pantea nu poate semna numirea lui Pantea ca Coordonator SSM, ca la 912, iar Tudorache nici pe a ei. Tu te poți numi singur, cu avertisment galben; precedentul e 914, Manager Proiect pe Mironu, semnată de tine.

**3 (RSVTI, PSI, Mediu, CTC-QC): da, intră toate în v1.**
- PSI și Mediu au modele pe NAS, atât pe firmă, cât și pe proiect.
- CTC-QC e o singură funcție cu trei etichete: Responsabil CTC, Responsabil CQ sau Responsabil cu Asigurarea Calității (AQ), după beneficiar. **Fără atestat obligatoriu în v1 și fără tip nou în nomenclatorul de atestate (D4).**
- RSVTI nu are niciun model pe NAS. Temeiul se propune și se poate edita în draft. Până îl validează sesiunea juridică, emiterea cere confirmarea avertismentului roșu „temei nevalidat”. Așa o poți emite de acum, fără să aștepți juristul, dar știind riscul.
- **Intră și cele două funcții propuse în plus (D6), câte un rând de seed fiecare:**
  - **Responsabil deșeuri** (C39): are model pe NAS (227/2026), atestat în BD și îl cere Transgaz în fiecare set.
  - **„Lucrător desemnat SSM” pe firmă** (C37): modelul 16/2026 nu numește un „Inspector SSM”, ci un „lucrător desemnat”. Dacă îl țin sub Inspector SSM, registrul afișează altă funcție decât cea scrisă în decizie.
  - Seed-ul rămâne la **15 tipuri**: cele două erau deja numărate în v1.1 (13 funcții de numire, plus `REVOCARE` și `ALTA_DECIZIE`).

**Cine emite (D3): Natalia și Marilena, plus tu.** Natalia (UDREA NATALIA ELENA, 126) trece prin `department = 'HR'`, Marilena (125) și tu, ca owneri. Superadmin nu intră. Dreptul lui Natalia apare la apply-ul PR1, după ce vezi listele exacte (cine emite și cine citește) și dai OK. De atunci, mutarea unui profil în departamentul HR înseamnă drept de emitere, deci se face doar cu OK-ul tău (VA10).

**Scanul (D5): fără semnătură electronică deocamdată, dar scanul semnat se urcă și de pe telefon.** Faci poze cu camera, câte una pe pagină, iar browserul le unește într-un singur PDF, în ordinea paginilor. Aplicația nu urcă pozele originale. Pe telefon însă ele pot rămâne în galerie, așa că „Fă poză” e calea recomandată (VA13).

**Riscurile din §8 (D7): acceptate ca atare,** fără a doua confirmare în v1.

### Ce face v1
- registrul de decizii de numire, cu număr automat (după inițializarea anului) sau manual, plus rezervarea de numere pentru deciziile făcute încă în Word;
- redactarea pe șablon, pe funcție, cu verificarea atestatului din `hr_autorizatii`. Textul deciziei îl produce un singur loc, serverul, apoi se îngheață la emitere;
- alegerea semnatarului, fiecare cu preambulul lui: implicit Trusu (D2c), iar Pantea și Tudorache pe împuternicire (D2a/b);
- PDF A4 cu antetul Gazpet: se printează, se semnează de mână, iar scanul se urcă înapoi după o verificare „generat vs. scan”. Scanul vine ca PDF (de la scanner) sau **din poze făcute cu telefonul, unite în browser într-un singur PDF (D5)**;
- istoricul complet: anulare, înlocuire, revocare, plus un jurnal insert-only;
- importul deciziilor vechi (inclusiv seria din cartea tehnică, ținută separat) cu număr manual și scan;
- propunerea de completare a echipei proiectului, aplicată doar după confirmare, în panoul existent „Completări propuse”;
- lista „De rezolvat”: emise nesemnate, propuneri neconfirmate, goluri în registru, importuri fără scan.

### Ce NU face v1
- semnătură electronică („momentan”, D5);
- îndreptarea automată a pozelor de scan (decupare, perspectivă, contrast). Pozele doar se convertesc în PDF (D5);
- DOCX;
- decizii colective (echipe de incendiu, prim ajutor, poluări) și decizii combinate generate. Combinatele vechi se pot importa;
- alte tipuri de decizii HR generate din șablon. Pentru ele doar se rezervă numărul (`ALTA_DECIZIE`);
- copierea automată în cartea tehnică CTC;
- centralizatorul SSM–PSI–Mediu cerut de Transgaz;
- numiri generate pentru colaboratori externi. La import și rezervare se acceptă un nume extern;
- OCR sau AI pe deciziile vechi sau pe scanul semnat;
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

### Ce s-a schimbat în v1.5 (runda 3 Copilot și Jakarinos, 06.10 noaptea)
- **Copilot: GO DESIGN pe 42258b1** pentru PR1 (nu GO APPLY); cele două P1 sunt concretizate aici, ca să poată da GO pe migrare (§9).
- **Previzualizarea primește numărul manual** (J3-1, blocant): `previzualizeaza(p_id, p_numar DEFAULT NULL)`; o decizie pe anul trecut se poate previzualiza, verifica (B7) și emite manual.
- **Acoperirea domeniului e funcție pură** (P3-1, J3-2): `_hr_acopera_domeniu(p_cerute, p_domenii_autorizate)`; domeniile atestatului și denumirile ISC intră în `v_in`. G2/G7 au context informativ separat, recalculat la emitere, în afara hash-ului.
- **Revocarea propune golirea câmpului din echipă** (P3-2): dacă proiectul îl are încă pe cel revocat, se naște o propunere „golește”, confirmată de om.
- **`cerere_emitere` e unic global** (P3-3).
- **Lock-ul semnatarului vine înaintea împuternicirii** (J3-3): legătura se citește din rândul deja blocat.
- **Contorul:** toate RPC-urile iau întâi lock-ul, apoi verifică; valori 0…99 999, „registru epuizat” (J3-4).
- **R5 acoperă și articolele noi** de termen și de înlocuire (J3-5).
- **Ținta în text:** titlul țintei e opțional (J3-6); identificarea ei include mereu anul și seria (J3-7).
- **Randarea HTML escapează tot** și substituția e nerecursivă (J3-8). Testul 64 cere `confirmat`, nu `aplicat` (J3-9).
- **D8–D11 confirmate din nou de Copilot** în runda 3; rămân de confirmat de tine (§9).

### Ce s-a schimbat în v1.4 (runda 2 Copilot și Jakarinos, 06.10 noaptea)
- **Emiterea citește intrările o singură dată** (P2-1, J2-5): `_hr_decizie_intrari` construiește sub lock-uri, într-o ordine fixă, o structură canonică; hash-ul, avertismentele, snapshot-ul și `continut` vin toate din ea, iar `_hr_decizie_randeaza` nu mai recitește tabele.
- **Modul de validare îl alege serverul** (J2-2): o revocare se validează mereu pe matricea `revocare`, și la previzualizare, și la emitere.
- **Fontul ales (12/11 pt) e parametru al emiterii** (`p_font_pt`), intră în `snapshot.font_pt` și în identitatea cererii (J2-3); cererea de emitere are hash de payload (P2-5).
- **Confirmarea efectului blochează întâi decizia, apoi propunerea** (J2-4), aceeași ordine ca la scanul unei înlocuiri/revocări.
- **`_hr_azi()` are EXECUTE pentru authenticated** (J2-1): e folosită în view, care rulează cu drepturile cititorului. View-ul se numește acum `v_hr_decizii_curente` (P2-4): conține și `emisa`; efectul operațional filtrează obligatoriu `semnata`.
- **Alocatorul la import verifică exact (serie, an, număr, sufix)** (P2-2): ordinea 912-bis → 912 nu mai contează.
- **Înlocuirea scanului** cere baseline-ul văzut și `cerere_id`, plus calea `semnat_*` (P2-3, J2-7, J2-8).
- **Contorul:** prima bază se calculează din valoarea nouă, nu din cea veche (J2-6).
- **Importul nu primește `REVOCARE`** (J2-9); snapshot-ul împuternicirii fără cale/hash și în §3.4 (J2-10).
- **Documentul:** termenul `data_efect_pana`, articolul de înlocuire și varianta fără atestat (R1 confirmat) au text definit (J2-11, J2-12, J2-13; formulările noi, de validat juridic).
- **Reverificare:** G3 (retrodatare) iese din hash-ul previzualizării și se calculează sub lock-ul contorului; altfel orice emitere paralelă din același an ar fi invalidat previzualizarea celorlalți (V2-1–V2-4).
- D8 = A, D9 = A, D10 = B și D11 = A: confirmate de Copilot în runda 2, **de confirmat de tine** (§9).

### Ce s-a schimbat în v1.3 (verdictele Copilot și Jakarinos, 06.10 noaptea)
- **Scrierea directă în registru e închisă și pentru `service_role`** (P0-1, J16): fără INSERT/UPDATE/DELETE/TRUNCATE pe tabelele registrului; triggerul de imuabilitate acoperă și INSERT și tranzițiile din draft.
- **O singură relație vie pe o țintă** (P0-2, J3): un rând nu poate fi și înlocuire și revocare; un singur UNIQUE pe ținta comună; ținta se blochează și se reverifică la emitere și la scan. Ținta poate fi doar o numire (J18). Înlocuirea și revocarea au efect imediat în v1 (J7).
- **Alocatorul primește sufixul** (P0-3, J2) și un validator comun de număr/an/dată pentru toate originile (J12). Saltul mare (R7) se întoarce din alocare și se jurnalizează (J23).
- **R3 se calculează pe server** (P1-1, J19); confirmările doar confirmă coduri calculate de server.
- **Idempotență** la rezervare, import, emitere, PDF și înlocuirea scanului (P1-3, J10, J11).
- **Împuternicirea e FK la decizia ei** (`imputernicire_decizie_id`, P1-4, D9 = A); semnatarii îi citesc doar owner-ii și HR (P1-2).
- **Drafturile se pot șterge** (J1): jurnalul păstrează id-ul, fără FK.
- **Propunerile pe echipă sunt protejate** (J5): clientul nu mai poate insera propuneri „de decizie”, iar `fn_completare_aplica` verifică legătura cu decizia. O singură regulă de eligibilitate pentru scan, backfill și confirmare (J6, J8, J9), cu „valabilă acum” pe ziua Europe/Bucharest (P2.2).
- **Previzualizarea e legată de versiunea emisă** (J20); hash-ul fișierelor e „declarat de client”, nu verificat (P2.1, J21).
- Mărunte: contorul păstrează baza primei inițializări (J13); combinatele au două upload-uri (J14); id-ul din cale are maxim 18 cifre (J15); TRUNCATE blocat pe jurnal (J17); `ALTA_DECIZIE` cu etichetă liberă la import (J22); revocarea are validări proprii (J4).
- D8 = A, D9 = A (cu FK) și D10 = B: confirmate de Copilot, **de confirmat de tine** (§9).

### Ce s-a schimbat în v1.2 (răspunsurile tale, 06.10 seara)
- **D1:** registrul platformei e registrul HR comun. Regula de tranziție din §4.F nu mai are condiție.
- **D2:** doar 121 e reprezentant legal. 90 și 125 sunt în seed ca împuterniciți, fără împuternicire înregistrată (R4 până la împuternicire și validarea preambulului, VA2). Semnatarul implicit e 121 pe toate cele 15 tipuri.
- **D3:** emitenții sunt Natalia (prin `department = 'HR'`), Marilena și tu (owneri). Niciun rând nou în `user_module_access` în v1. Listele (cine emite și cine citește) se verifică la apply-ul PR1.
- **D4:** `CTC_QC` fără atestat obligatoriu, fără tip nou de atestat.
- **D5:** fără semnătură electronică. Cerință nouă: scanul de pe telefon, din poze, unite în browser într-un PDF (funcțiile noi `pregatestePagina` + `paginiToPdf`, PR2). Bucket-ul primește doar PDF.
- **D6:** Responsabil deșeuri și Lucrător desemnat SSM intră în seed (erau deja numărate: total 15).
- **D7:** riscurile din §8 sunt acceptate.
- **Fapte noi [V]:** șef-santier e în main (d71da84, #629), iar `20261017a` e aplicată (v20261006141500). PR3 și PR5 nu mai așteaptă nimic de acolo. Coloana există, dar `fn_completare_aplica` nu o are în whitelist, deci `SEF_SANTIER` intră în seed cu `camp_efect = NULL` și primește efectul abia în PR5.
- **Verificarea adversarială (VA1–VA38):** predicatele de drept devin fail-closed (un `department` NULL nu mai trece de RPC-uri); `ALTA_DECIZIE` o văd doar owner-ii și HR; bucket-ul n-are DELETE; RPC-urile verifică fișierul în storage; R4 are o singură formulă; rezervarea unei numiri trece prin B1 și R4; modalul de scan are două moduri (cu și fără document generat), nu randează PDF-uri pe telefon și compune scanul la ~190 DPI.
- **Întrebări noi, neblocante:** D8 (cine urcă scanul), D9 (numărul împuternicirilor), D10 (contul de serviciu „Claude” și scanurile semnate). Detalii în §9.

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

**Calitatea de semnare (D2, închis):** reprezentant legal e doar 121. 90 și 125 semnează pe împuternicire scrisă, care urmează să se facă pentru amândoi.

**Emitenții (D3)** [V] (recitit în v1.2)

| id | Nume | Funcție | `profiles.role` / `department` | `is_owner` | `can_access_personal_data` | Chei `hr*` | Trece prin |
|---|---|---|---|---|---|---|---|
| 126 | UDREA NATALIA ELENA | REFERENT RESURSE UMANE | superadmin / **HR** | false | true | `hr` (admin), nicio sub-cheie `hr.*` | `department = 'HR'` |
| 125 | TUDORACHE MARILENA CLAUDIA | ECONOMIST | superadmin / (NULL) | **true** | true | – | owner |
| 121 | TRUSU RAZVAN MIHAIL | ADMINISTRATOR | superadmin / Administrativ | **true** | true | – | owner |

- Natalia e singurul profil cu `department = 'HR'` [V].
- `profiles.department` îl poate schimba doar owner-ul: triggerul `trg_profiles_campuri_owner_only` (`fn_profiles_campuri_owner_only`) refuză modificarea pentru ceilalți, deși politica `profiles_update_own` permite UPDATE pe propriul rând [V]. Nimeni nu se poate muta singur în HR.

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
- **`sef_santier_employee_id` există** [V] (v1.2): integer, FK `employees(id)`. Migrarea `20261017a` e aplicată pe live (v20261006141500), iar UI-ul e în `origin/main` (d71da84, #629). Un proiect îl are deja completat. În v1.1 coloana încă nu exista.
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
- whitelist-ul de câmpuri conține `rte_employee_id`, `rts_employee_id`, `mp_employee_id` și câmpuri de contract, **fără `sef_santier_employee_id`** [V] (recitit în v1.2, după aplicarea 20261017a). Confirmarea unei propuneri pe un câmp din afara listei dă eroarea „câmp nepermis”.

Panoul din `src/Executie.jsx` (~475–495, `origin/main`) deschide dovada cu **bucket-ul hardcodat**: `storage.from('executie-contracte').createSignedUrl(row.dovada_path)` (~706) [V] (C20; neschimbat în d71da84).

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
| CTC / QC | **lipsește tipul** | – | cele mai apropiate: `AUDITOR_INTERN`, `MANAGER_SMC`, `EXAMINARE_VIZUALA`. **D4: rămâne fără tip și fără atestat obligatoriu în v1** |
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

Bucket-urile de documente au deja limite de tip și mărime [V] (v1.2): `contracte-terti` 20 MB, doar `application/pdf`; `ctc-documente` 50 MB, doar PDF; `autorizatii` 10 MB, PDF și imagini. Modelul pentru `hr-decizii` e `contracte-terti` (§3.5, D5).

Tot pe storage [V] (verificarea adversarială):
- Triggerul `protect_objects_delete` de pe `storage.objects` refuză DELETE direct din SQL: un fișier se șterge doar prin Storage API, deci ștergerea nu se poate muta într-un RPC (VA19).
- Cele 107 politici de pe `storage.objects` nu fac niciun cast pe segmentele căii (VA23).
- `postgres`, owner-ul funcțiilor SECURITY DEFINER, are BYPASSRLS și SELECT pe `storage.objects`. `metadata` are `mimetype` și `size`, iar `owner_id` e text (VA20).

**Acces** [V]
- Cheia `hr` are 8 deținători, dintre care **doar 1 e din departamentul HR** (C24):

  | Nivel | Rol / departament | Câți |
  |---|---|---|
  | admin | superadmin / HR | 1 |
  | editor | superadmin / Administrativ | 3 |
  | editor | manager_santier / Ofertare | 2 |
  | editor | manager_santier / IT | 1 |
  | editor | contabilitate / Contabilitate | 1 |

- Nu există sub-chei `hr.*` [V] (și în v1.2: 0 rânduri).
- Un singur profil are `department = 'HR'`: Natalia (126) [V].
- Compoziția cheii `hr` e aceeași în v1.2: 8 deținători, singurul din HR fiind Natalia (admin) [V].
- Există 8 profiluri superadmin.
- Cheia `executie` are 13 deținători, iar `can_manage_contracts` = true are 8 profiluri: 3 din Administrativ, 3 din Ofertare, 1 de la Comercial și contul de serviciu „Claude” (IT, fără fișă de angajat, fără cheia `executie`) [V] (VA22).
- **Toți cei 7 deținători ai cheii `hr` din afara HR trec `exec` (§3.3)** [V] (VA1): 98 (Contabilitate) prin cheia `executie`; 153, 114, 82 (Administrativ), 87 și 109 (Ofertare) prin `executie` și `can_manage_contracts`; contul „Claude” prin `can_manage_contracts`. Cei 6 cu `can_manage_contracts` trec și `confirm`.
- `user_module_access.module` are FK pe `app_modules(key)`. În `app_modules` există `hr`, `hr.autorizatii`, `hr.personal`, `hr.recrutare` și `hr.training`, dar nu `hr.decizii` [V] (VA24).
- **8 profiluri non-owner au `department` NULL** [V] (VA16): 2 conturi de test („Test Fara Modul”, „Test Ofertare”), contul extern „Dragos Burdea (Adrom Evolution)”, 2 gestionari, Sorin Ioan, Liviu Toma și „Razvantrusuhome”. `handle_new_user` nu completează departamentul, deci orice cont nou pornește cu NULL [V].

### Cod

**Branch și checkout**
- **v1.2 [V]:** branch-ul `claude/erp-continuare-x4p5a7-sef-santier` e în main: `origin/main` = d71da84 (#629, „Câmp «Șef de șantier» pe fișa proiectului”). Tot ce era pe el (inclusiv 10c4433) a intrat în main. PR-urile generatorului pornesc din `origin/main`.
- Situația din v1.1, păstrată pentru istoric: checkout-ul era pe branch-ul sef-santier, cu 6 commit-uri înainte de `origin/main` (0e9b7b0) și 1 în urmă.
- **Fix-ul `activ` → `active` din `openEchipaEdit` e comis în 10c4433** [V] (C21) și a intrat în main odată cu #629. Afirmația din v1 („modificare necomisă”) era falsă.

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
- Echipa din dashboard-ul Execuție e, pe `origin/main` d71da84, la `Executie.jsx:3084-3134` [V] (v1.2; în v1 era 3074-3124). Lista `echipa` (:3033-3039) și formularul de editare (:3097-3102) au deja „Șef de șantier”. Se recitesc înainte de PR3.

**Poze și PDF în client (pentru scanul de pe telefon, D5)** [V] (v1.2, `origin/main` d71da84)
- `imageToPdf(file)` e la `CitesteOricePanel.jsx:133` (decizia „TOTUL PDF”):
  - primește **un singur fișier** și întoarce un `File` PDF cu **o singură pagină**, de mărimea imaginii (`unit: 'px'`, `format: [w, h]`);
  - citește cu `FileReader`, decodează într-un `Image`, micșorează la max 1600 px pe latura lungă, desenează pe un canvas cu fundal alb, re-encodează JPEG 82% și pune imaginea în jsPDF;
  - fiind redesenată pe canvas, **imaginea pierde metadatele EXIF** (GPS, ora, modelul telefonului) [V, din cod];
  - comentariul de la :127-131 dă mărimea tipică: o poză de 5–8 MB ajunge la ~200–400 KB.
- **Nu suportă mai multe imagini într-un PDF**, iar apelantul din același fișier (:241) urcă originalul dacă pică conversia. Ambele îl fac nepotrivit ca atare pentru scanul semnat (§6, D5).
- Copii și apelanți: copie identică în `HrAngajatNouWizard.jsx:70`; importat în `ctc/ctcDb.js:6` (folosit la :85) și `OfertareClarificari.jsx:14` (:366).
- Camera telefonului: `<input type="file" accept="image/*" capture="environment">` în `QrUtilajPage.jsx:911`, `TabScannerDocumenteHR.jsx:368`, `ScannerAmcButton.jsx:195`; cu `multiple` în `PiesePozeSection.jsx:208` și `ImprumuturiEchipamente.jsx:156`.
- `paginiDinBytes(bytes)` (numărul de pagini al unui PDF, funcție pură, cu teste vitest în `ctcUtil.test.js`) e la `ctc/ctcUtil.js:140`.
- Deep-link pe tab: `HR.jsx:247-254` deschide `/hr?tab=<cheie>`.
- `jspdf` 4.2.1 și `vitest` sunt deja în `package.json`.

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
- Asta susține resetarea anuală, dar **doar parțial (C27)**: în 2024, 298 e datat în octombrie, după 368 din iulie, ceea ce sugerează altă serie. **De confirmat cu Natalia** resetarea anuală și seria din 2024.
- Registrul comun nu mai e întrebare: Răzvan a ales ca registrul platformei să fie registrul HR comun (D1). Saltul 240 → 759 susținea deja asta.

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
   - Sufixul (de ex. „bis” pentru al doilea 912, sau „a”/„b” la deciziile combinate) e permis doar la import. Se normalizează într-un singur loc (`_hr_decizii_norm_sufix`: `lower(trim())`, gol sau `^[a-z]{1,6}$`) (P0-3, J2).
   - **Validator comun pentru toate originile** (`_hr_decizii_valideaza_numar`, J12): `numar` între 1 și 99 999; `an` între 2000 și anul curent; când `data_emitere` există, `extract(year FROM data_emitere) = an` (și la import); `data_emitere` nu e în viitor. Singura excepție scrisă a importului: lipsa datei (carte tehnică) și lipsa R6/R7.
2. **Numărul se alocă doar în BD, atomic, printr-o singură funcție internă, `_hr_decizii_aloca` (C3), care primește și sufixul (P0-3).** O folosesc emiterea, rezervarea și importul. Nu există numărătoare în client. La numărul automat și la numărul manual din platformă sau rezervare, orice sufix existent ocupă numărul; **la import conflictul e exact pe (serie, an, număr, sufix)**, inclusiv sufixul gol, ca rezultatul să nu depindă de ordinea importului (P2-2).
   - Un număr manual ocupat dă eroare cu trimitere la decizia care îl ocupă.
   - Un număr manual mai mare decât contorul îl împinge la acea valoare. Peste `ultimul + 20` e nevoie de confirmarea „salt mare” (C4).
   - Un număr manual liber, sub contor (de ex. 762), e acceptat, iar contorul rămâne neschimbat.
   - Numărul automat = `ultimul + 1`, sărind peste numerele deja ocupate.
3. **Numărul automat există doar pe un an inițializat explicit (C1, C2).** Pentru fiecare an, HR sau owner-ul introduce „ultimul număr din registrul fizic” și abia apoi pornește numărul automat. Fără inițializare se lucrează doar manual.
4. **Data emiterii nu e în viitor (C5).** „Azi” e mereu ziua de business Europe/Bucharest, prin `_hr_azi()` = `(now() AT TIME ZONE 'Europe/Bucharest')::date`, niciodată `current_date` (P2.2); la fel anul curent, expirările și valabilitatea. Dacă anul emiterii diferă de anul curent, numărul e obligatoriu manual și emiterea cere confirmarea avertismentului roșu. Regula se verifică în RPC, nu într-un CHECK.
5. **O decizie emisă e imuabilă.**
   - Textul e produs **doar de server**, din șabloane, și se îngheață la emitere în `continut`. Datele (persoană, proiect, contract, atestat, semnatar, firmă) se îngheață în `snapshot`.
   - Corectura NU se face prin editare: o decizie emisă și nesemnată se **anulează** (numărul rămâne ocupat, cu motiv); una semnată se **înlocuiește** sau se **revocă** printr-o decizie nouă.
   - Nu există DELETE pe decizii emise. Se pot șterge doar draft-urile, care n-au număr. Ștergerea unui draft lasă în jurnal evenimentul `stergere_draft`, cu ultima stare a rândului; jurnalul ține id-ul deciziei fără FK, ca istoricul să supraviețuiască ștergerii (J1).
6. **Clientul nu poate scrie coloanele serverului (C6, C33).**
   - Din client se pot crea și modifica doar draft-uri, și doar coloanele de redactare (GRANT pe coloane). Orice tranziție de stare trece printr-un RPC SECURITY DEFINER.
   - Un trigger blochează, dacă nu vine din RPC (`current_user` ∈ rolurile API): orice INSERT care nu e draft curat; orice UPDATE care schimbă starea sau coloanele serverului, inclusiv pornind de la un draft; orice UPDATE/DELETE pe o decizie care nu e draft (P0-1, J16).
   - **`service_role` nu are drept de scriere directă** pe tabelele registrului (`hr_decizii`, `hr_decizii_evenimente`, `hr_decizii_contor`, `hr_decizii_semnatari`, `hr_decizii_tipuri`): doar SELECT. Orice scriere trece prin funcțiile SECURITY DEFINER (P0-1).
7. **Istoricul e complet și nu se poate șterge.**
   - Fiecare tranziție, inclusiv operațiile pe contor, scrie un rând în `hr_decizii_evenimente`. Tabelul e insert-only pentru toată lumea, owner-ul inclus: fără UPDATE, DELETE și **TRUNCATE** (REVOKE plus trigger BEFORE TRUNCATE, J17). Garanția privește rolurile API; rolul `postgres` (migrări) o poate schimba doar printr-o migrare vizibilă.
   - PDF-ul generat și scanul semnat au hash SHA-256 **declarat de client** (calculat în browser, format validat, nerecalculat pe server, P2.1, J21) și stau într-un bucket **fără UPDATE și fără DELETE pentru utilizatorii autentificați în v1**: nimic nu se șterge prin API-ul de utilizator, nici de owner. Cheia `service_role` ocolește politicile de storage; riscul e delimitat în §8 (J17). Un scan înlocuit rămâne ca dovadă (§3.5, VA19).
8. **Echipa proiectului se modifică doar la confirmare.**
   - O decizie semnată creează o *propunere* în `executie_completari_propuse`, legată de decizie prin `hr_decizie_id`.
   - **Eligibilitatea efectului are o singură definiție** (`_hr_decizie_eligibila_efect(p_id)`, J6, J8, J9), folosită la scan, la backfill (PR5) și la confirmare: decizie `semnata`, de numire, `propune_efect = true`, `employee_id IS NOT NULL`, `tip.camp_efect` nenul și existent, proiect `activ`, `data_efect_pana` nulă sau ≥ azi, și B1 trecut (în afară de import). Data efectului din viitor nu împiedică propunerea, dar confirmarea ei e refuzată până la `data_efect`.
   - Clientul nu poate insera propuneri legate de decizii; `fn_completare_aplica` reverifică legătura completă (J5).
   - Aplicarea o face owner-ul sau cineva cu `can_manage_contracts`, prin `fn_completare_aplica`, care există deja.
   - Când decizia e înlocuită sau revocată, propunerile ei încă neconfirmate trec în `expirat` (C9).
   - Generatorul NU face niciodată UPDATE direct pe `executie_proiecte`.
9. **Semnatarul (C7).**
   - Un semnatar care **nu** e reprezentant legal nu-și poate semna propria numire. Regula e blocantă și se verifică în RPC.
   - Reprezentantul legal care se numește pe sine primește doar avertisment galben.
   - La import regula nu se aplică.
   - Reprezentant legal e doar 121 (D2a). Regula blocantă îi privește pe Pantea (90) și pe Tudorache (125).
10. **Date personale minime.**
    - Se folosesc doar numele, funcția, proiectul sau firma și datele atestatului (nr., dată, emitent, expirare). Fără CNP, domiciliu sau date medicale.
    - Scanul semnat, care e specimen de semnătură și ștampilă, îl văd mai puțini oameni decât PDF-ul generat (C31).
    - **`ALTA_DECIZIE` (D1: orice decizie HR din Word, inclusiv sancțiuni, încetări sau salarii) poate conține orice dată din document.** Rândul (descriere, persoană) și scanul le văd doar `owner` și `hr`, chiar dacă decizia e legată de un proiect (§3.3, VA7).
    - Nicio decizie și niciun scan nu se copiază în `executie-contracte` (C32).
    - **Scanul din poze (D5):** se urcă doar PDF-ul compus în browser. Metadatele pozelor (EXIF: GPS, ora, modelul telefonului) nu ajung în PDF, pentru că fiecare imagine e redesenată pe canvas. Aplicația nu urcă și nu păstrează pozele originale, dar nu le controlează pe telefon: pe calea „Din galerie” (și, pe unele telefoane Android, chiar pe „Fă poză”) ele rămân în galerie și, de regulă, în backup-ul personal (Google Photos, iCloud). De aceea „Fă poză” e calea recomandată, iar după salvare ecranul cere ștergerea pozelor (§4.A.6). Riscul rezidual e în §8 (VA13).
11. **Fără semnătură electronică în v1** (D5: „momentan”; se poate redeschide în v2). Decizia iese cu spațiu gol pentru semnătură și ștampilă. HR-ul nu aplică semnătura altcuiva.

---

## 3. Model de date (PR1: o migrare cu tabele, RLS, GRANT, RPC-uri, triggere, bucket, seed și teste)

### 3.1 Tabele

```sql
-- Semnatarii (2B: toti trei activi; D2: doar 121 e reprezentant legal). Scrierea doar prin migrare in v1, fara UI.
hr_decizii_semnatari (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id int NOT NULL REFERENCES employees(id),
  calitate text NOT NULL,                    -- 'Administrator' / 'Imputernicit' / 'Imputernicita' / …
  este_reprezentant_legal boolean NOT NULL DEFAULT false,
  preambul_text text NOT NULL,               -- text LITERAL pe persoana (C17, VA3); singura variabila permisa: {imputernicire}
  bloc_semnatura text NOT NULL,              -- „Administrator,\nTrusu Razvan”; tot literal
  preambul_validat boolean NOT NULL DEFAULT false,   -- true doar dupa OK juridic (sau model NAS, pt 121)
  imputernicire_decizie_id bigint,           -- D9 = A (P1-4): decizia ALTA_DECIZIE a imputernicirii; nr./data/scan se DERIVA
                                             -- din ea; FARA REFERENCES inline (hr_decizii nu exista inca): FK-ul vine DOAR din
                                             -- ALTER TABLE de dupa CREATE hr_decizii (Vf4)
  activ boolean NOT NULL DEFAULT true, ordine int
  -- FARA CHECK pe imputernicire (C8): lipsa ei = avertisment rosu R4 la emitere
)

-- Nomenclatorul de functii si sabloanele lor
hr_decizii_tipuri (
  cod text PRIMARY KEY,   -- vezi §5: RTE, RTE_MEC, RTS, SEF_SANTIER, MP, CTC_QC, INSPECTOR_SSM,
                          -- LUCRATOR_DESEMNAT_SSM, COORDONATOR_SSM, RSVTI, PSI, MEDIU,
                          -- RESPONSABIL_DESEURI, REVOCARE, ALTA_DECIZIE
                          -- seed: 15 = 13 functii de numire + REVOCARE + ALTA_DECIZIE (D6)
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
  semnatar_implicit_id bigint REFERENCES hr_decizii_semnatari(id),   -- „in functie de decizie” (C8); seed: 121 pe toate (D2c)
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
  versiune int NOT NULL DEFAULT 1,            -- J20: crescuta de trigger la fiecare UPDATE pe draft
  cerere_id uuid UNIQUE,                      -- J10/P1-3: cheie de idempotenta la rezervare/import (din client)
  cerere_hash text,                           -- sha256 al payload-ului normalizat; retry cu alt payload = eroare
  cerere_emitere uuid,                        -- J10: cheia apelului de emitere; retry identic intoarce rezultatul;
                                              -- P3-3: unica GLOBAL (index partial de mai jos), un uuid = o cerere
  cerere_emitere_hash text,                   -- P2-5: sha256 al payload-ului emiterii; acelasi uuid + alt payload = eroare
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
  CHECK (data_efect_pana IS NULL OR data_efect IS NULL OR data_efect_pana >= data_efect),
  CHECK (inlocuieste_id IS NULL OR revoca_id IS NULL),                         -- P0-2, J3
  CHECK (numar IS NULL OR numar BETWEEN 1 AND 99999),                          -- J12
  CHECK (an IS NULL OR an >= 2000),                                            -- J12 (limita de sus: in RPC, _hr_azi)
  CHECK (data_emitere IS NULL OR an IS NULL OR extract(year FROM data_emitere) = an),   -- J12, toate originile
  CHECK (numar_sufix ~ '^([a-z]{1,6})?$'),                                     -- P0-3: forma normalizata
  CHECK (pdf_sha256  IS NULL OR pdf_sha256  ~ '^[0-9a-f]{64}$'),               -- P2.1, J21: format, nu verificare
  CHECK (scan_sha256 IS NULL OR scan_sha256 ~ '^[0-9a-f]{64}$')
)
-- O singura relatie „vie” (inlocuire SAU revocare) pe aceeasi tinta (C12; P0-2, J3: un singur index pe tinta comuna)
CREATE UNIQUE INDEX hr_decizii_tinta_vie ON hr_decizii ((coalesce(inlocuieste_id, revoca_id)))
  WHERE coalesce(inlocuieste_id, revoca_id) IS NOT NULL AND stare NOT IN ('draft','anulata');
CREATE UNIQUE INDEX hr_decizii_cerere_emitere ON hr_decizii (cerere_emitere) WHERE cerere_emitere IS NOT NULL;   -- P3-3
ALTER TABLE hr_decizii_semnatari ADD FOREIGN KEY (imputernicire_decizie_id) REFERENCES hr_decizii(id);   -- singura declaratie (Vf4)
-- + index pe employee_id, proiect_id, tip_cod, (serie, an)

-- Contorul (doar seria HR)
hr_decizii_contor (
  serie text NOT NULL DEFAULT 'HR', an int NOT NULL,
  ultimul int NOT NULL DEFAULT 0 CHECK (ultimul BETWEEN 0 AND 99999),        -- J3-4
  auto_permis boolean NOT NULL DEFAULT false,      -- C1/C2: false = doar numar manual
  ultimul_initial int,                             -- baza PRIMEI initializari (goluri); nu se rescrie la repornire (J13)
  initializat_de uuid, initializat_la timestamptz, initializat_sursa text,   -- „registrul fizic, verificat de …”
  PRIMARY KEY (serie, an)
)

-- Jurnalul (insert-only pentru toata lumea)
hr_decizii_evenimente (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decizie_id bigint,                               -- FARA FK (J1): id istoric, supravietuieste stergerii draftului; NULL la contor
  serie text, an int,                              -- pentru evenimente de contor
  eveniment text NOT NULL,     -- creare, modificare_draft, emitere, pdf, scan, scan_inlocuit,
                               -- anulare, inlocuita, revocata, propunere_efect, propunere_expirata,
                               -- contor_initializat, contor_auto_oprit, contor_corectat, import, rezervare,
                               -- stergere_draft (J1, detalii = ultima stare a randului), salt_confirmat (J23),
                               -- propunere_omisa (J8: extern / neeligibil, cu motiv),
                               -- propunere_golire (P3-2: revocare, campul din echipa inca pe persoana revocata)
  stare_veche text, stare_noua text,
  de uuid, la timestamptz NOT NULL DEFAULT now(),
  detalii jsonb
)

-- Legatura propunere → decizie (C9). Schimbare ADITIVA pe un tabel existent: intra in OK-ul pe PR1.
ALTER TABLE executie_completari_propuse ADD COLUMN hr_decizie_id bigint REFERENCES hr_decizii(id);
-- J5: politica existenta completari_ins (owner OR can_manage_contracts) se inlocuieste in PR1 cu aceeasi conditie
--     PLUS `hr_decizie_id IS NULL AND sursa NOT IN ('decizie_numire','decizie_revocare')` (P3-2): propunerile generatorului le scrie doar RPC-ul.
```

**Seed-ul semnatarilor (D2)**

| `employee_id` | `calitate` | `este_reprezentant_legal` | `preambul_validat` | `imputernicire_*` | `ordine` |
|---|---|---|---|---|---|
| 121 (Trusu) | Administrator | true | true (model 916) | – | 1 |
| 90 (Pantea) | Imputernicit | false | false (de validat juridic) | `imputernicire_decizie_id` NULL până se înregistrează împuternicirea (D2b, P1-4) → R4 (formula din §4.A.2) | 2 |
| 125 (Tudorache) | **Imputernicita** (VA3) | **false** (D2a) | false (de validat juridic) | idem | 3 |

- `hr_decizii_tipuri.semnatar_implicit_id` = rândul lui 121, pe toate cele 15 tipuri (D2c). Seed-ul îl caută după `employee_id = 121`, nu după un id hardcodat.
- `preambul_text` și `bloc_semnatura` pentru 90 și 125 sunt texte literale pe persoană, din §5.1 (VA3).
- `SEF_SANTIER` intră cu `camp_efect = NULL` până la PR5 (§3.9, pasul 6) [V].

### 3.2 View

`v_hr_decizii_curente WITH (security_invoker = on)` (redenumit din `v_hr_decizii_active`, P2-4) conține deciziile de numire curente, **semnate sau emise și încă nesemnate**:
- `stare IN ('emisa','semnata')` (cele `inlocuita` și `revocata` ies singure, prin stare);
- `tip_cod NOT IN ('REVOCARE','ALTA_DECIZIE')`;
- `data_efect IS NULL OR data_efect <= _hr_azi()` (J6; la import, data efectului necunoscută = în vigoare de la semnare);
- `data_efect_pana IS NULL OR data_efect_pana >= _hr_azi()` (P2.2: ziua Europe/Bucharest, nu `current_date`);
- pentru `nivel = 'proiect'`, doar proiectele cu `executie_proiecte.activ = true` (C13). Coloana există [V].

Coloanele view-ului:
- `id`, `serie`, `an`, `numar`, `numar_sufix`, `nr_afisat` („916/28.09.2026”, „912-bis/28.09.2026”), `data_emitere`;
- `tip_cod`, `rol_cod`, `camp_efect`, `eticheta_functie`, `nivel`;
- `employee_id`, `nume` (din snapshot), `proiect_id`, `domenii_isc`, `data_efect`, `data_efect_pana`;
- `stare` și `semnata` (boolean).

UI-ul afișează deciziile `emisa` ca **„nesemnată”**, nu ca active (C13). Efectul pe echipă vine doar din `semnata`. **Regulă pentru orice consumator (P2-4):** orice efect operațional (echipă, CTC, Organigramă, `AdeverinteLegator` în v2) filtrează explicit `semnata = true`; numele „curente”, nu „active”, e ales ca să nu sugereze altceva.

**`_hr_azi()` în view (J2-1).** View-ul e `security_invoker`, deci funcțiile din el se execută cu drepturile cititorului: cu EXECUTE retras de la `authenticated`, orice SELECT pe view ar da „permission denied for function”, inclusiv pentru owner. `_hr_azi()` e de aceea **singura excepție** de la REVOKE-ul pe `_hr_*`: `STABLE`, fără acces la date, `GRANT EXECUTE TO authenticated` (§3.6, testul 42). Deciziile semnate cu `data_efect` viitoare apar în registru ca „în vigoare de la …”, nu în view (J6).

Îl folosesc cardurile Echipă din Execuție și, mai târziu, CTC și Organigrama din Ofertare. CTC, SSM, PSI, Mediu și MEC pe proiect NU primesc coloane noi în `executie_proiecte`: echipa extinsă se citește din view. Fiind `security_invoker`, view-ul respectă RLS-ul de pe `hr_decizii`, deci un editor `executie` vede doar deciziile pe proiect.

### 3.3 Drepturi: un singur helper, cu predicate exacte (C25, C44)

`fn_hr_decizii_poate(p_actiune text, p_decizie_id bigint DEFAULT NULL) RETURNS boolean`
- e `STABLE SECURITY DEFINER SET search_path = public, pg_temp`;
- are `GRANT EXECUTE TO authenticated`, ca UI-ul să-l poată întreba;
- o folosesc RLS-ul, storage-ul, toate RPC-urile și UI-ul, inclusiv butonul „Generează decizie” din Execuție. Nu există altă poartă.

Termenii folosiți în predicate, cu `p = profiles WHERE id = auth.uid()`:

```
owner      := coalesce(p.is_owner, false)
hr         := coalesce(p.department = 'HR', false)
              OR EXISTS (user_module_access WHERE profile_id = auth.uid() AND module = 'hr.decizii'
                         AND access_level IN ('editor','admin'))          -- D3 = B' (inchis 06.10, §9)
hr_citire  := hr OR EXISTS (… module = 'hr.decizii')                       -- orice nivel
exec       := EXISTS (user_module_access WHERE profile_id = auth.uid() AND module = 'executie')
              OR coalesce(p.can_manage_contracts, false)
confirm    := owner OR coalesce(p.can_manage_contracts, false)
are_fisa   := p.employee_id IS NOT NULL                                     -- D10 (VA22)
pe_proiect := decizia p_decizie_id exista, are nivel = 'proiect', stare <> 'draft'
              si tip_cod <> 'ALTA_DECIZIE'                                  -- VA7
              (o REVOCARE poate tinti doar o numire, J18, deci nu poate scoate
               la `exec` metadatele unei ALTA_DECIZIE)
```

**Fail-closed (VA16).** Termenii și helper-ul nu întorc niciodată NULL: helper-ul întoarce `coalesce(<expresie>, false)`, deci false pentru profil lipsă, acțiune necunoscută sau `p_decizie_id` inexistent.
- Motivul: cu `department` NULL, `p.department = 'HR'` dă NULL, iar `false OR NULL` tot NULL. RLS-ul tratează NULL ca refuz, dar într-un RPC SECURITY DEFINER `IF NOT fn(...) THEN RAISE` sare peste RAISE, pentru că `NOT NULL` e tot NULL. Azi 8 profiluri non-owner au `department` NULL, iar orice cont nou pornește așa (§1) [V].
- **Regulă de review pe toate RPC-urile:** `IF fn_hr_decizii_poate(...) IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'`, niciodată `IF NOT fn(...)`. Modelul existent e `IF NOT COALESCE(v_ok, false)` din `fn_completare_aplica` [V].

**O singură copie a predicatelor (VA1, VA21, VA22).** Termenii de mai sus se calculează în funcția internă `_hr_decizii_termeni(p_profile_id)`. `fn_hr_decizii_poate` o cheamă cu `auth.uid()`. Preview-ul de la apply și `fn_hr_decizii_emitenti` (§3.6) o rulează pe fiecare profil, deci listele arătate sunt exact cele pe care le aplică RLS-ul.

**Rolul `superadmin` NU apare în niciun predicat (C23, C24).**

**Cine trece azi (D3, închis: „Natalia și Marilena”)** [V]
- `owner`: 121 (Trusu) și 125 (Tudorache Marilena).
- `hr`: 126 (Udrea Natalia), prin `department = 'HR'`. E singurul profil din HR, iar departamentul îl poate schimba doar owner-ul (§1).
- `hr.decizii`: nimeni. **În v1 nu se creează niciun rând în `user_module_access`, iar PR1 nu inserează cheia `hr.decizii` în `app_modules`** (VA24). Cheia nu există acolo, iar `user_module_access.module` are FK pe `app_modules(key)` [V], deci ramura `hr.decizii` din predicat rămâne goală și nicio acordare nu e posibilă, nici din greșeală. Inserată „pentru completitudine”, cheia ar face posibilă o acordare printr-un simplu INSERT, în afara fluxului cu OK-ul tău, iar prin regula de prefix ar deschide și ruta `/hr`. Matricea din Admin → Manageri e o listă fixă de 11 chei (`App.jsx:7483-7495`) și nu citește `app_modules` [V]. Prima acordare nominală vine ca migrare (`app_modules` + `user_module_access`), cu preview și OK-ul tău.
- Emitenții sunt deci exact cei ceruți: Natalia, Marilena și tu. Superadmin-ii (Natalia e și ea superadmin) nu trec prin rol.
- **Ceilalți 7 deținători ai cheii `hr` nu primesc nimic PRIN cheia `hr`** (redactare, emitere, rezervare, scan, contor) (VA1). Prin `exec` însă toți 7 citesc deciziile de numire pe proiect și PDF-ul lor generat, iar cei 6 cu `can_manage_contracts` trec și `confirm`: văd scanul semnat pe proiect și confirmă efectul (§1) [V].

**Departamentul HR devine drept (VA10, VA21).** Răzvan a numit persoane („Natalia și Marilena”), iar predicatul le prinde printr-o clasă. Din PR1, `profiles.department = 'HR'` înseamnă drept de emitere, scan, import și contor în registrul HR, plus citirea tuturor scanurilor.
- Orice mutare a unui profil în sau din „HR” e acordare sau retragere de drept: preview și OK-ul lui Răzvan (CLAUDE.md pct. 3), indiferent dacă vine din Admin → Manageri (o poate face orice owner, deci și Marilena [V]) sau dintr-un tichet „mută-l pe X în HR”.
- La livrare: lecție `anti_bug` în `claude_context` și propunerea de a trece `department` în lista de drepturi din CLAUDE.md pct. 3, care azi enumeră doar `user_module_access`, rolurile și `is_owner`.
- Antetul tab-ului „Decizii” arată emitenții actuali (`fn_hr_decizii_emitenti`, §3.6), ca o schimbare să se vadă.

**Acordarea la livrare (CLAUDE.md pct. 3).** Dreptul lui Natalia apare în momentul apply-ului PR1, fiindcă predicatul există de atunci. Tot atunci apar și drepturile noi de citire pe deciziile de numire pe proiect (C31). De aceea preview-ul de la apply listează nominal, calculate cu `_hr_decizii_termeni` pe fiecare profil, patru mulțimi (VA1, VA22):
- emitenții (`owner OR hr`), așteptat exact {121, 125, 126};
- `citire` (tab-ul și registrul complet);
- `citire_doc` pe proiect: azi 17 profiluri, adică cei 3 de mai sus plus cele 14 profiluri `exec` (13 cu cheia `executie`, plus contul „Claude”) [V];
- `citire_scan` pe proiect: owner-ii, Natalia și cei cu `can_manage_contracts` care au fișă de angajat. Azi 10, pentru că, pe D10 = B, contul „Claude” nu intră [V].

Apply-ul se face doar dacă emitenții sunt exact {121, 125, 126} și doar cu OK-ul tău explicit pe toate cele patru liste.

**Avertizare păstrată pentru orice `hr.decizii` dat mai târziu.** Prin regula de prefix (`HR.jsx:160`, aceeași ca `hasModuleAccess`), sub-cheia deschide ruta `/hr`. Se dă nominal, cu OK-ul tău, și doar cuiva care are deja `hr`, până când celelalte tab-uri HR au gardă proprie (verificare în PR3).

| Acțiune | Predicat | Folosită la |
|---|---|---|
| `citire` | owner OR hr_citire | registrul complet, inclusiv draft-urile și deciziile pe firmă |
| `citire_doc` | owner OR hr_citire OR (exec AND pe_proiect) | PDF-ul generat; pentru `exec`, și rândul deciziei de numire pe proiect (politica SELECT, §3.4) |
| `citire_scan` | owner OR hr OR (confirm AND pe_proiect AND are_fisa) | scanul semnat (C31, modificat: vezi anexa; `are_fisa`: D10 = B, recomandat) |
| `redactare` | owner OR hr | INSERT / UPDATE pe draft |
| `emitere`, `rezervare`, `scan`, `anulare`, `import` | owner OR hr | RPC-urile respective |
| `contor` | owner OR hr | inițializarea anului, oprirea numărului automat |
| `owner` | owner | corectarea contorului, înlocuirea scanului, ștergerea draft-urilor altora (fișierele nu se mai șterg, VA19) |
| `confirmare_efect` | neschimbat: owner OR `can_manage_contracts`, prin `fn_completare_aplica` | – |

### 3.4 RLS, GRANT, triggere

**`hr_decizii`**

GRANT pe coloane (C6, C33):
```sql
-- Vf1 (P0-1, J16): pe Supabase default ACL-ul public da ALL lui anon/authenticated/service_role pe tabelele noi
-- [V: pg_default_acl, postgres 'r' → service_role=arwdDxtm]. Deci REVOKE explicit pe TOATE cele 5 tabele, inclusiv service_role:
REVOKE ALL ON hr_decizii, hr_decizii_evenimente, hr_decizii_contor, hr_decizii_semnatari, hr_decizii_tipuri
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON hr_decizii TO authenticated;
GRANT INSERT (tip_cod, eticheta_functie, nivel, employee_id, proiect_id, proiect_denumire, autorizatie_id,
              domenii_isc, titlu, temei, data_emitere, data_efect, data_efect_pana, semnatar_id,
              luare_la_cunostinta, propune_efect, inlocuieste_id, revoca_id) ON hr_decizii TO authenticated;
GRANT UPDATE (<aceeasi lista>) ON hr_decizii TO authenticated;
GRANT SELECT ON hr_decizii, hr_decizii_evenimente, hr_decizii_contor, hr_decizii_semnatari, hr_decizii_tipuri
  TO service_role;                            -- P0-1, J16, Vf1: DOAR SELECT; abatere motivata de la „regula casei”
GRANT SELECT ON hr_decizii_evenimente, hr_decizii_contor, hr_decizii_semnatari, hr_decizii_tipuri
  TO authenticated;                           -- filtrat de RLS (semnatari: doar `citire`, P1-2); nicio scriere din client
-- Nimic altceva. Test 42: has_table_privilege(r, t, p) = false pentru r in (anon, service_role),
-- p in (INSERT, UPDATE, DELETE, TRUNCATE), pe toate 5; pentru authenticated doar coloanele de mai sus pe hr_decizii.
```

Politici:

| Politică | Regulă |
|---|---|
| SELECT | `fn_hr_decizii_poate('citire') OR (nivel = 'proiect' AND stare <> 'draft' AND tip_cod <> 'ALTA_DECIZIE' AND fn_hr_decizii_poate('citire_doc', id))`. Excluderea `ALTA_DECIZIE` e și aici, și în `pe_proiect`: plasă dublă (VA7) |
| INSERT | WITH CHECK `fn_hr_decizii_poate('redactare') AND stare = 'draft' AND numar IS NULL AND origine = 'platforma' AND creat_de = auth.uid()` |
| UPDATE | USING `stare = 'draft' AND fn_hr_decizii_poate('redactare')`; WITH CHECK `stare = 'draft' AND numar IS NULL` |
| DELETE | USING `stare = 'draft' AND fn_hr_decizii_poate('redactare') AND (creat_de = auth.uid() OR fn_hr_decizii_poate('owner'))` |

Triggere:
- **`trg_hr_decizii_imuabil`** (BEFORE INSERT OR UPDATE OR DELETE, P0-1, J16): dacă `current_user IN ('authenticated','anon','service_role')`:
  - INSERT: refuz dacă nu e draft curat (`stare = 'draft'`, `origine = 'platforma'`, `numar`/`an` NULL, coloanele serverului la valorile implicite: `snapshot = '{}'`, `continut`, `cod_verificare`, `pdf_*`, `scan_*`, `emis_*`, `anulat_*`, `cerere_*` NULL);
  - UPDATE: refuz dacă `OLD.stare <> 'draft'`, dacă `NEW.stare <> 'draft'` sau dacă se schimbă vreo coloană a serverului (`IS DISTINCT FROM`), inclusiv `creat_de`, `origine`, `versiune`;
  - DELETE: refuz dacă `OLD.stare <> 'draft'`.
  **Funcția triggerului e SECURITY INVOKER (implicit) — obligatoriu (Vf2).** Ca SECURITY DEFINER, `current_user` ar fi owner-ul ei și triggerul n-ar bloca nimic; regula intră în review-ul PR1 și în testul 42. **Ordinea:** triggerele BEFORE rulează alfabetic, deci numele se aleg ca imuabilitatea să ruleze prima: `trg_hr_decizii_a_imuabil`, apoi `trg_hr_decizii_b_revocare`, `trg_hr_decizii_c_versiune` (Vf2).
  În RPC-urile SECURITY DEFINER, `current_user` e owner-ul funcției, deci trec. Înlocuiește flag-ul `set_config` din v1 (C6). Plasă dublă cu REVOKE-ul de mai sus: un `service_role` fără GRANT nu ajunge nici la trigger.
- **`trg_hr_decizii_versiune`** (BEFORE UPDATE, `WHEN (OLD.stare = 'draft' AND NEW.stare = 'draft')`, Vf11): `NEW.versiune := OLD.versiune + 1` la orice schimbare de redactare (J20); tranziția draft → emisa nu mai incrementează.
  - **Regulă de review pe fiecare RPC:** scrie explicit doar coloanele tranziției lui.
- **`trg_hr_decizii_revocare`** (BEFORE INSERT OR UPDATE, doar pe draft cu `tip_cod = 'REVOCARE'`): copiază din țintă `nivel`, `proiect_id`, `employee_id`, `persoana_nume` și `eticheta_functie` (C12), iar `titlu` ca `coalesce(tinta.titlu, NEW.titlu)` (Vf7): o numire importată fără titlu lasă redactorul să-l completeze, iar B10 îl cere. Ținta trebuie să fie o numire (`tip_cod NOT IN ('REVOCARE','ALTA_DECIZIE')`), altfel eroare (J18). Validările unei revocări sunt cele proprii din §4.A.2 (J4).
- **`trg_hr_decizii_jurnal`** (AFTER INSERT OR UPDATE OR DELETE pe draft; la UPDATE cu `WHEN (OLD.stare = 'draft' AND NEW.stare = 'draft')`, Vf11 — tranzițiile le jurnalizează doar RPC-ul, un singur eveniment): scrie în `hr_decizii_evenimente`; la DELETE scrie `stergere_draft` cu `to_jsonb(OLD)` în `detalii` (J1). Funcționează pentru că `decizie_id` din jurnal nu are FK. E **SECURITY DEFINER, cu `search_path` fix** (C33); altfel orice operație pe draft făcută din client ar pica, pentru că clientul nu are drept de scriere în jurnal.

**`hr_decizii_evenimente`**
- RLS: SELECT pentru `fn_hr_decizii_poate('citire')`.
- REVOKE INSERT / UPDATE / DELETE / TRUNCATE de la `anon`, `authenticated` și `service_role` (J17). Doar triggerele și RPC-urile scriu.
- Un trigger BEFORE UPDATE OR DELETE (pe rând) și unul BEFORE TRUNCATE (pe instrucțiune) ridică eroare **mereu**, inclusiv pentru owner (J17). Ca să schimbi asta e nevoie de o migrare vizibilă.

**`hr_decizii_contor`**
- RLS: SELECT pentru `citire`.
- Fără scriere din client: doar prin `_hr_decizii_aloca` și RPC-urile de contor.

**`hr_decizii_tipuri`, `hr_decizii_semnatari`**
- RLS: `hr_decizii_tipuri` SELECT pentru `auth.uid() IS NOT NULL`. **`hr_decizii_semnatari` SELECT doar pentru `fn_hr_decizii_poate('citire')`** (owner și HR, P1-2): leagă semnatarii de împuterniciri, iar ceilalți cititori văd semnatarul din `snapshot`-ul deciziei.
- Scrierea doar prin migrare. În v1 nu există ecran pentru semnatari.
- Împuternicirile pentru 90 și 125 (D2b) se înregistrează, după semnare, printr-o migrare de date (preview → OK) (VA4).
  - **Pe D9 = A** (recomandat, confirmat de Copilot; PR-urile pornesc pe el), împuternicirea e o decizie `ALTA_DECIZIE` din registru. Numărul vine din „Rezervă număr” (PR3) sau, dacă se semnează înainte, din import (PR4). Scanul trece prin modalul obișnuit, inclusiv din poze (§4.A.6, modul fără document generat). **Migrarea setează doar `imputernicire_decizie_id`** = id-ul acelei decizii (P1-4); nr., data și scanul se derivă la fiecare citire din decizie, deci un scan înlocuit ulterior e preluat automat. La emitere, `snapshot.semnatar.imputernicire` îngheață **doar id-ul, nr. și data** (Vf13, J2-10); calea și hash-ul scanului valabil atunci se scriu în evenimentul `emitere` (`detalii.imputernicire_scan`), pe care îl citesc doar cei cu `citire`, nu în snapshot-ul vizibil `exec`. Bucket-ul n-are folder separat pentru semnatari, iar scanul îl văd doar `owner` și `hr`, ca pe orice `ALTA_DECIZIE` (§3.3).
  - Pe D9 = B, vezi §9.
- În aceeași migrare de date intră, după OK-ul juridic, textul final al preambulului și `preambul_validat = true` (VA2). R4 dispare doar când formula din §4.A.2 devine falsă.

**`executie_completari_propuse`** (J5; schimbare pe tabel și RPC existente, intră în OK-ul pe PR1, nu în PR5)
- Coloana nouă `hr_decizie_id`.
- Politica `completari_ins` primește `AND hr_decizie_id IS NULL AND sursa NOT IN ('decizie_numire','decizie_revocare')` (P3-2) [V: azi WITH CHECK = owner OR `can_manage_contracts`]. Rândurile generatorului le inserează doar RPC-ul SECURITY DEFINER.
- `fn_completare_aplica` — **dispatch exclusiv pe `sursa` când `r.hr_decizie_id IS NOT NULL`** (P3-2, verificare runda 3): `'decizie_numire'` → calea de numire de mai jos; `'decizie_revocare'` → **doar** ramura de golire (sare și verificarea de numire, și corpul generic `SET %I = $1`); orice altă `sursa` cu `hr_decizie_id` nenul → eroare „propunere necorelată cu decizia”. Rândurile fără `hr_decizie_id` merg pe corpul de azi.
  - **Calea de numire (`sursa = 'decizie_numire'`):** la acceptare reverifică legătura completă: decizia există și `_hr_decizie_eligibila_efect` e true; `r.proiect_id = decizie.proiect_id`; `r.camp = tip.camp_efect`; `r.valoare = decizie.employee_id::text`; `data_efect` nulă sau ≤ `_hr_azi()`. Altfel eroare („propunere necorelată cu decizia” / „decizia nu mai e în vigoare” / „efect de la …”). Restul corpului rămâne neschimbat [V: whitelist și `IF NOT COALESCE(v_ok,false)`].
  - **Calea de golire (`sursa = 'decizie_revocare'`, P3-2).** Rândurile au `valoare = ''` (coloana e NOT NULL [V]) și `hr_decizie_id` = decizia de **revocare**. Lock-uri, în ordine: (1) revocarea `FOR UPDATE`; (2) ținta (`revoca_id`, citită din rândul blocat al revocării) `FOR SHARE`; (3) propunerea `FOR UPDATE`, cu reverificarea `status = 'propus'`. Ordinea e compatibilă cu `ataseaza_scan` (decizia nouă → ținta → propunerile), cu precizarea că ținta se citește doar după revocare. Sub aceste lock-uri cere: revocarea `semnata`, ținta ei `revocata`, `r.camp = tip_tinta.camp_efect`, iar valoarea curentă din proiect **încă egală** cu `tinta.employee_id`; atunci face `UPDATE executie_proiecte SET %I = NULL … WHERE id = r.proiect_id AND %I = tinta.employee_id` (SQL dinamic, aceeași whitelist). Dacă între timp echipa s-a schimbat → eroare „echipa nu-l mai are pe X; propunerea nu mai e necesară”, iar UI-ul o poate respinge. **Gardă de renumire (P3-2, verificare runda 3):** se refuză și dacă în `v_hr_decizii_curente` există o decizie `semnata` pe același `proiect_id` și același `camp_efect`, cu același `employee_id` → „X are o decizie în vigoare (nr …)”. Nu există alt drum de golire; respingerea lasă echipa neschimbată.
  - **Serializare cu înlocuirea/revocarea (J2-4).** Azi corpul începe cu `SELECT … FROM executie_completari_propuse WHERE id = p_id AND status = 'propus' FOR UPDATE` [V], iar decizia s-ar citi fără lock. Pentru rândurile cu `hr_decizie_id`, ordinea devine: (1) citește `hr_decizie_id` fără lock; (2) `SELECT … FROM hr_decizii WHERE id = hr_decizie_id FOR UPDATE`; (3) abia apoi propunerea `FOR UPDATE`, cu reverificarea `status = 'propus'` și a legăturii; (4) eligibilitatea sub ambele lock-uri. E aceeași ordine ca la `ataseaza_scan` (decizia nouă → ținta → propunerile țintei), deci nu apar blocaje circulare: o revocare care trece ținta în `revocata` așteaptă confirmarea sau e așteptată de ea, iar cine vine al doilea vede starea finală. Rândurile fără `hr_decizie_id` păstrează ordinea de azi.

### 3.5 Bucket `hr-decizii` (privat)

**Căi:** `<serie>/<an>/<decizie_id>/generat_<ts>.pdf` și `…/semnat_<ts>.pdf`, cu `<ts>` = `Date.now()`, adică doar cifre, cum cere regex-ul de mai jos. Id-ul deciziei e în cale (C30). Numele unic cu timestamp rezolvă retry-ul (C19).

**Configurarea bucket-ului (D5):** `file_size_limit` = 20 MB și `allowed_mime_types` = `{application/pdf}`, ca la `contracte-terti` [V]. Storage-ul refuză orice poză urcată direct, deci pozele de pe telefon trebuie convertite în client (§6). 20 MB ajunge: la 2400 px pe latura lungă (§6), o pagină din poză are ~0,5–1 MB, deci 10 pagini rămân sub limită, iar un PDF color de la scanner, de 1–2 pagini, la fel.

**Calea în politici (VA23).** Id-ul se ia cu `fn_hr_decizii_id_din_cale(name) RETURNS bigint`:
- e IMMUTABLE, nu citește date și are EXECUTE pentru authenticated, pentru că rulează în politici;
- întoarce NULL dacă `name !~ '^(HR|carte_tehnica)/[0-9]{4}/[1-9][0-9]{0,17}/(generat|semnat)_[0-9]{1,15}\.pdf$'`, și face cast-ul doar după ce regex-ul a trecut. **Id-ul are maxim 18 cifre** (< 9 223 372 036 854 775 807), deci cast-ul la `bigint` nu poate depăși intervalul (J15); un id de 19+ cifre întoarce NULL, nu eroare.

Seria și anul din cale se compară cu ale deciziei ca text (`split_part`), fără cast. Nicio politică nu face cast direct pe `storage.foldername(name)`. Politicile de pe `storage.objects` se evaluează pe toate bucket-urile, iar Postgres nu garantează ordinea condițiilor, deci un cast care pică pe căile altui bucket ar putea strica citirea și acolo. Fiecare politică începe cu `bucket_id = 'hr-decizii' AND`.

| Operație | Regulă |
|---|---|
| SELECT | `generat_*`: `fn_hr_decizii_poate('citire_doc', id)`; `semnat_*`: `fn_hr_decizii_poate('citire_scan', id)` |
| INSERT | Calea respectă regex-ul, iar seria și anul din cale sunt ale deciziei. `generat_*`: dreptul `emitere`, decizia în starea `emisa`, cu origine `platforma`. `semnat_*`: dreptul **`scan`** (același ca în `ataseaza_scan`, VA8), decizia în starea `emisa`; la înlocuirea scanului, `owner` și starea `semnata` |
| UPDATE | niciuna |
| DELETE | **niciuna în v1, nici pentru owner (VA19)** |

**De ce fără DELETE (VA19).** Cu DELETE pentru owner și INSERT pe deciziile `semnata`, un owner putea șterge `semnat_X.pdf` și urca alt fișier sub același nume. Decizia ar fi trimis la aceeași cale, cu `scan_sha256` vechi, fără nicio urmă în jurnal: DELETE + INSERT ocoleau lipsa UPDATE-ului. Evenimentul `fisier_sters` din v1.1 nici nu putea fi scris: UI-ul n-are drept de scriere în jurnal (§3.4), iar ștergerea nu se poate muta într-un RPC (`protect_objects_delete`, §1) [V].
- Un scan înlocuit rămâne ca dovadă, iar evenimentul `scan_inlocuit` trimite la un fișier care există.
- Fișierele orfane (upload reușit, RPC eșuat) rămân private, sub decizia din cale. Dacă vreodată e nevoie, curățarea se face prin migrare vizibilă.
- **Limita garanției (J17).** „Fără DELETE” ține pentru utilizatorii autentificați (inclusiv owner). Cheia `service_role` ocolește politicile de storage, iar Storage API o lasă să șteargă sau să suprascrie. În v1 nicio funcție, edge function sau script nu folosește bucket-ul cu cheia de serviciu; o ștergere privilegiată s-ar vedea ca discrepanță (fișier lipsă față de `scan_path` și hash-ul declarat). Riscul rezidual e în §8.
- **Decizii combinate (J14).** Calea conține id-ul deciziei, deci 385a și 385b primesc **două upload-uri distincte cu aceiași octeți** (`…/<id_a>/semnat_<ts>.pdf` și `…/<id_b>/semnat_<ts>.pdf`), cu același `scan_sha256`. Ecranul de import urcă același File de două ori, în secvență. Nu există document comun în v1.

### 3.6 RPC-uri

Toate sunt `SECURITY DEFINER SET search_path = public, pg_temp`, cu `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role` (Vf3: default ACL-ul pe funcții dă EXECUTE lui `service_role` [V]) și verificare de drept în corp, scrisă fail-closed: `IF fn_hr_decizii_poate(...) IS NOT TRUE THEN RAISE ... USING ERRCODE = '42501'` (§3.3, VA16). Cele publice au și `GRANT EXECUTE TO authenticated`.

| Funcție | Drept | Ce face |
|---|---|---|
| `_hr_decizii_aloca(p_serie, p_an, p_numar int, p_numar_sufix text, p_confirm_salt bool, p_origine text, p_data_emitere date)` → `(numar int, sufix text, salt jsonb, g3 jsonb)` (V2-1) | **internă**: REVOKE ALL de la PUBLIC, anon, authenticated, service_role (Vf3), apelată doar din RPC-uri | vezi §3.7 (P0-3, J2; `salt` = avertismentul R7 cu contorul, numărul cerut și confirmarea, J23) |
| `fn_hr_decizii_urmatorul_numar(p_an)` | `citire` | Numai informativ, fără lock: `{numar}` sau `{numar: null, motiv: 'an neinitializat'}`. |
| `fn_hr_decizii_contor_initializeaza(p_an, p_ultimul_fizic int, p_sursa text)` | `contor` | **Validează întâi parametrii (J3-4):** `p_an` între 2000 și anul curent (`_hr_azi()`), `p_ultimul_fizic` întreg nenul în `0..99999`, `p_sursa` nevidă. Creează rândul anului dacă lipsește. **Calculează întâi `v_nou := GREATEST(c.ultimul, p_ultimul_fizic)` pe rândul luat `FOR UPDATE`**, apoi `ultimul = v_nou`, **`ultimul_initial = coalesce(ultimul_initial, v_nou)`** (J2-6: într-un singur UPDATE, `coalesce(ultimul_initial, ultimul)` ar folosi valoarea **veche** a lui `ultimul`, deci prima inițializare la 916 pe un rând nou ar salva baza 0 și ar afișa golurile 1–916; baza primei inițializări nu se rescrie la repornire, J13), `auto_permis = true`, plus `initializat_*` și eveniment (cu baza veche și cea nouă). Dacă anul e deja inițializat cu auto pornit, dă eroare și trimite la „corectează”. |
| `fn_hr_decizii_contor_opreste_auto(p_an, p_motiv)` | `contor` | Ia rândul `FOR UPDATE` înainte de orice verificare (J3-4). `auto_permis = false` (de ex. dacă registrul de hârtie s-a reluat). Repornirea se face doar prin re-inițializare. |
| `fn_hr_decizii_contor_corecteaza(p_an, p_ultimul, p_motiv)` | `owner` | Pentru numerele manuale tastate greșit. **Protocol (J3-4):** validează `p_an` (2000…anul curent) și `p_ultimul` (întreg nenul, `0..99999`); ia **întâi** rândul contorului `FOR UPDATE` (același lock ca `_hr_decizii_aloca`, deci o emitere concurentă fie s-a comis deja și intră în `max`, fie așteaptă corectura); abia apoi calculează `max(numar)` și compară. Valoarea nouă trebuie să fie `≥ max(numar)` al deciziilor din serie și an în alte stări decât `anulata`. Numărul unei decizii anulate rămâne ocupat, iar alocarea automată sare peste el. Motivul e obligatoriu și se scrie eveniment. |
| `fn_hr_decizie_previzualizeaza(p_id, p_numar int DEFAULT NULL)` (J3-1) | `redactare` | `p_numar` = numărul manual intenționat (NULL = automat). Intră în `_hr_decizie_avertismente`, deci B3 („an trecut fără număr manual”) se decide ca la emitere, iar B8 se verifică informativ, fără lock (ocupat azi → B8; autoritatea rămâne alocarea). **Nu intră în hash**: identitatea emiterii îl conține deja (P2-5), iar lățimea rămâne cea a rezervei. Pentru draft: întoarce `{continut, avertismente, versiune, hash_previzualizare}`, calculate de aceleași funcții ca la emitere, fără alocare și fără scriere. G3 apare informativ, calculat fără lock, și **nu intră în hash** (V2-1). Dacă există blocanți, `continut` = NULL și se întorc doar avertismentele, nu o eroare de randare (V2-3). Numărul apare ca rezervă de lățime maximă („99999-bis”, afișat „____”), ca numărul final să nu poată schimba încadrarea (J20). `hash_previzualizare` = sha256 peste structura canonică `_hr_decizie_intrari(p_id)` (care conține și `versiune`, dar nu registrul anului, V2-1) + `continut` (P2-1). Modul de validare îl alege serverul din `tip_cod` (J2-2). |
| `fn_hr_decizie_emite(p_id, p_hash_previzualizare text, p_cerere_id uuid, p_font_pt int, p_numar int DEFAULT NULL, p_confirmari jsonb DEFAULT '[]', p_confirm_salt bool DEFAULT false)` | `emitere` | vezi §3.8 (J10, J20; `p_font_pt` ∈ {11, 12}, obligatoriu, J2-3; `cerere_emitere_hash`, P2-5; `cerere_emitere` unic global, P3-3) |
| `fn_hr_decizie_seteaza_pdf(p_id, p_path, p_sha256)` | `emitere` | **Ia decizia `FOR UPDATE` înainte de orice verificare (J11).** Stare `emisa`. Calea trebuie să fie `<serie>/<an>/<id>/generat_*.pdf`, cu seria, anul și id-ul deciziei, iar fișierul trece verificarea de mai jos (VA20); `p_sha256` are formatul `^[0-9a-f]{64}$` (P2.1). Dacă `pdf_path IS NULL`, setează. Dacă e deja setat **cu aceeași cale și același hash**, întoarce ok (idempotent, C19). Altfel dă eroare („PDF deja atașat”): primul PDF rămâne. PDF-ul e derivat: dacă upload-ul cade, se regenerează din `continut`, iar numărul nu se pierde. |
| `fn_hr_decizie_ataseaza_scan(p_id, p_path, p_sha256, p_verificari jsonb)` | `scan` | vezi §3.9 |
| `fn_hr_decizie_inlocuieste_scan(p_id, p_cerere_id uuid, p_scan_vechi_path, p_scan_vechi_sha256, p_path, p_sha256, p_motiv, p_verificari jsonb)` | `owner` | Stare `semnata`. Înlocuiește un scan urcat greșit (alt document, altă persoană, pagină nesemnată). Ia decizia `FOR UPDATE`. **Retry (J10, P2-3, J2-8):** `p_cerere_id` (uuid din client, generat la deschiderea modalului) intră în eveniment, împreună cu `cerere_hash` = sha256 peste (`p_scan_vechi_*`, `p_path`, `p_sha256`, `p_motiv`, `p_verificari`). Dacă există deja un eveniment `scan_inlocuit` al deciziei cu același `cerere_id`: același hash → ok, fără eveniment nou și **fără nicio schimbare a scanului curent** (oricare ar fi el acum); alt hash → eroare „cerere refolosită cu alt conținut”. Altfel, **baseline-ul**: `scan_path = p_scan_vechi_path AND scan_sha256 = p_scan_vechi_sha256`, altfel eroare „scanul s-a schimbat între timp; reîncarcă” (un retry întârziat A după o înlocuire B nu mai poate readuce scanul A). Apoi `p_path <> scan_path`, **aceeași validare completă a căii ca la `ataseaza_scan`: `<serie>/<an>/<id>/semnat_*.pdf`** (J2-7: un `generat_*.pdf` al aceleiași decizii nu poate deveni scan) și verificarea de fișier de mai jos (VA19, VA20). Un index unic parțial pe `hr_decizii_evenimente ((detalii->>'cerere_id')) WHERE eveniment = 'scan_inlocuit'` e plasa pentru două retry-uri simultane. `p_verificari` se validează ca la §3.9, pasul 3 (`lizibil = true` obligatoriu, plus `sursa` și `pagini`) (VA6). Evenimentul `scan_inlocuit` păstrează calea și hash-ul vechi, plus verificările noului scan. Actualizează `dovada_path` pe propunerile `propus` ale deciziei. Fișierul vechi rămâne în bucket ca dovadă (C15c, modificat: VA19). |
| `fn_hr_decizie_anuleaza(p_id, p_motiv)` | `anulare` | Doar din starea `emisa`, pentru orice origine. O rezervare nefolosită se anulează cu motivul „număr nefolosit”. Numărul rămâne ocupat. Motivul e obligatoriu, iar `anulat_de` și `anulat_la` se completează. |
| `fn_hr_decizie_rezerva(p_payload jsonb)` | `rezervare` | vezi §4.F (la numiri: B1 și R4, VA17). **`cerere_id` (uuid generat în client la deschiderea formularului) e obligatoriu** (P1-3, J10): dacă există deja un rând cu același `cerere_id` și același `cerere_hash`, întoarce rezultatul anterior (același număr), fără alocare nouă; cu alt hash → eroare „cerere refolosită cu alt conținut”. **Concurență (Vf9):** înainte de lookup, `pg_advisory_xact_lock(hashtext(cerere_id::text))`, astfel că al doilea apel simultan așteaptă și găsește rândul primului; plasă: `unique_violation` pe `cerere_id` → se reia lookup-ul și se întoarce rândul existent. La fel în `importa`. Validatorul comun de număr/an/dată se aplică (J12), inclusiv B3/R6 |
| `fn_hr_decizie_importa(p_payload jsonb)` | `import` | vezi §4.E; aceeași cheie `cerere_id` ca la rezervare (J10); `tip_cod = 'REVOCARE'` refuzat (J2-9) |
| `fn_hr_decizii_emitenti()` | `citire` | Lista nominală a profilurilor care trec azi `emitere`, cu calea prin care trec (owner, `department = 'HR'`, `hr.decizii`). Se calculează cu `_hr_decizii_termeni` și apare în antetul tab-ului (§7) (VA21). |

**Verificarea de fișier (VA20)**, în `seteaza_pdf`, `ataseaza_scan` și `inlocuieste_scan`; categoria din nume (`generat_` la PDF, `semnat_` la ambele RPC-uri de scan) face parte din verificare (J2-7). Fără ea, un upload întrerupt pe telefon, urmat de apelul RPC, ar lăsa decizia `semnata` fără fișier, iar propunerile pe echipă s-ar naște cu `dovada_path` mort.
- `SELECT metadata, owner_id FROM storage.objects WHERE bucket_id = 'hr-decizii' AND name = p_path` întoarce un rând;
- `metadata->>'mimetype' = 'application/pdf'`, iar `(metadata->>'size')::bigint` e între 1 și 20 971 520;
- `owner_id = auth.uid()::text`: cine urcă e cine atașează;
- seria, anul și id-ul din cale sunt ale deciziei.

`postgres`, owner-ul funcțiilor, are BYPASSRLS și SELECT pe `storage.objects` [V]. Dacă o condiție pică: eroare, fără tranziție.

**Funcții interne** (`REVOKE ALL ON FUNCTION _hr_* FROM PUBLIC, anon, authenticated, service_role`, Vf3; doar owner-ul RPC-urilor le execută; **singura excepție: `_hr_azi()`**, cu `GRANT EXECUTE TO authenticated`, pentru că rulează în view-ul `security_invoker`, J2-1):
- `_hr_decizii_termeni(p_profile_id)` calculează termenii de drept din §3.3 (o singură copie);
- `_hr_decizie_intrari(p_id, p_blocheaza bool)` (P2-1, J2-5): **singura citire** a intrărilor mutabile ale unui draft: rândul deciziei (inclusiv `versiune`), tipul, angajatul, atestatul (**inclusiv domeniile lui normalizate**, P3-1), proiectul, semnatarul, decizia de împuternicire, ținta (la înlocuire/revocare: număr, sufix, serie, an, dată, titlu, nume, funcție), plus **denumirile `isc_rte_domenii`** ale domeniilor cerute, pentru `{domenii}` (J3-2). **Nu** conține date din registrul anului (ultima `data_emitere` pentru G3): acelea se schimbă la orice emitere paralelă și nu sunt sub lock-urile de mai jos (V2-1). Întoarce o structură jsonb canonică (chei sortate, valori normalizate). Cu `p_blocheaza = true` (doar la `emite`) ia lock-urile în ordinea fixă din §3.8;
- `_hr_decizie_mod(p_tip_cod, p_operatie)` (J2-2): alege matricea de validări pe server: `REVOCARE` → `revocare`; altfel `emitere` / `rezervare` / `import` după RPC-ul apelant. Nu e parametru expus și nu are valoare implicită;
- `_hr_decizie_avertismente(p_intrari jsonb, p_context jsonb, p_numar int, p_mod text)` calculează lista de avertismente din §4.A.2 **din structurile primite, fără să citească tabele** (P2-1, J3-2): G2/G7 din `p_context`, restul din `p_intrari`; **G3** se calculează separat (V2-1, §3.7), iar B8 informativ la previzualizare îl adaugă RPC-ul (J3-1); primește numărul manual, deci poate decide ramura B3 „fără număr manual” (J23). `p_mod` vine **obligatoriu** din `_hr_decizie_mod` (J2-2; în v1.3 avea implicit `'emitere'`, iar o revocare emisă primea B1/B2). R7 nu se calculează aici, ci în alocare (`salt`), și se adaugă în aceeași listă persistată (J23);
- `_hr_decizii_valideaza_numar(p_serie, p_an, p_numar, p_sufix, p_data_emitere, p_origine)`: validatorul comun din §2.1 (J12);
- `_hr_decizii_norm_sufix(text)`: normalizarea sufixului (P0-3);
- `_hr_acopera_domeniu(p_cerute text[], p_domenii_autorizate text[])` (P3-1, J3-2): port SQL al `acoperaDomeniul` din client, cu aceeași normalizare; **pură** (`IMMUTABLE`, fără `FROM`): primește domeniile atestatului deja înghețate în `v_in` (`v_in.atestat.domenii`), nu id-ul lui. Vectorii de test sunt comuni (același tabel de cazuri în vitest și în testul SQL) (P1-1, J19);
- `_hr_decizie_context(p_intrari jsonb)` (J3-2): **singura** citire a celorlalte decizii pentru G2 și G7 (decizii curente pe același proiect/firmă și tip, RTE pe alte domenii). E context informativ: fără lock, **nu intră în hash** și nici în `snapshot`/`continut`; la previzualizare se întoarce separat, iar la emitere se recalculează după lock-urile din §3.8 (pasul 4). Afectează doar avertismente galbene, deci o diferență între cele două momente nu poate schimba documentul;
- `_hr_decizie_eligibila_efect(p_id)`: regula unică de eligibilitate a efectului (§2.8; J6, J8, J9);
- `_hr_azi()`: ziua de business Europe/Bucharest (P2.2); excepția de EXECUTE de mai sus (J2-1);
- `_hr_decizie_randeaza(p_intrari jsonb, p_numar, p_data)` produce `continut` din șabloanele din §5, **numai din structura primită**, fără recitirea tabelelor (P2-1). O variabilă obligatorie (în afara unui segment `[[ ]]`) fără valoare dă eroare, niciodată placeholder sau text trunchiat (J2-13). **Substituția e într-o singură trecere, nerecursivă** (J3-8): valorile introduse nu se mai scanează după `{…}` sau `[[ ]]`; `continut` e text simplu, fără markup.

`fn_hr_decizii_id_din_cale(name)` (§3.5) nu e internă: rulează în politicile de storage, deci are EXECUTE pentru authenticated. E IMMUTABLE și nu citește date.

`_hr_decizie_intrari`, `_hr_decizie_context`, `_hr_decizie_avertismente` și `_hr_decizie_randeaza` le folosesc atât `previzualizeaza`, cât și `emite` (avertismentele, și `rezerva` la numiri, cu intrările construite din payload), deci intrările, textul și avertismentele au **o singură sursă**.

### 3.7 Alocarea numărului (`_hr_decizii_aloca`)

```
sufix := _hr_decizii_norm_sufix(p_numar_sufix)  -- P0-3, J2
daca sufix <> '' AND p_origine <> 'import' → eroare „sufix permis doar la import”
daca p_serie = 'carte_tehnica':                 -- doar import; fara contor
    pg_advisory_xact_lock(hashtext('hr_decizii:carte_tehnica:' || p_an || ':' || p_numar))   -- J2: serializare fara contor
    verifica (serie, an, numar, sufix) liber → altfel eroare „nr X/an (carte tehnica) e folosit de #id”
    return (p_numar, sufix, NULL)
INSERT INTO hr_decizii_contor (serie, an) VALUES ('HR', p_an) ON CONFLICT DO NOTHING;
SELECT * INTO c FROM hr_decizii_contor WHERE serie = 'HR' AND an = p_an FOR UPDATE;
daca p_numar IS NULL:                           -- automat
    daca NOT c.auto_permis → eroare „numar automat oprit pentru p_an: initializeaza anul cu ultimul nr din registrul fizic”
    n := c.ultimul + 1
    cat timp exista (HR, p_an, n, sufix oarecare) → n := n + 1      -- sare peste numere manuale/importate
    daca n > 99999 → eroare „registru epuizat pentru p_an” (J3-4; inainte de orice scriere)
altfel:                                         -- manual
    daca p_origine = 'import':                  -- P2-2: conflict EXACT, inclusiv sufixul gol
        daca exista (HR, p_an, p_numar, sufix) → eroare „nr p_numar[-sufix]/p_an e folosit de decizia #id”
        -- 912 si 912-bis intra in orice ordine; 385, 385a, 385b pot coexista
    altfel:                                     -- platforma / rezervare: sufix mereu ''
        daca exista (HR, p_an, p_numar, sufix oarecare) → eroare „nr p_numar/p_an e folosit de decizia #id”
    daca p_origine <> 'import' AND p_numar > c.ultimul + 20:
        daca NOT p_confirm_salt → eroare 'salt_mare' (R7)
        salt := {cod:'R7', contor:c.ultimul, cerut:p_numar, confirmat_de:auth.uid(), confirmat_la:now()}   -- J23
    n := p_numar
daca p_origine <> 'import':                     -- V2-1: G3 sub lock-ul contorului, nu in hash
    daca exista (HR, p_an, stare <> 'anulata', data_emitere > p_data_emitere) → g3 := {cod:'G3', ultima:max(data_emitere)}
UPDATE hr_decizii_contor SET ultimul = GREATEST(ultimul, n) …;
return (n, sufix, salt, g3)
-- Autoritatea finala ramane UNIQUE (serie, an, numar, numar_sufix): unique_violation → aceeasi eroare prietenoasa.
```

Apelanții adaugă `salt` și `g3` în `avertismente` (G3 e galben, nu oprește emiterea; calculat după `FOR UPDATE` pe contor, deci două emiteri concurente în același an îl văd serializat, V2-1) și scriu evenimentul `salt_confirmat` (J23). Importul HR rămâne serializat pe rândul contorului (`FOR UPDATE`), deci regula exactă (P2-2) nu deschide o cursă; UNIQUE rămâne autoritatea finală. Validatorul comun (`_hr_decizii_valideaza_numar`, J12) rulează înainte de alocare în toate cele trei origini.

### 3.8 Emiterea (`fn_hr_decizie_emite`)

1. Verifică dreptul `emitere`; `p_font_pt` ∈ {11, 12}, altfel eroare (J2-3). Ia decizia cu `SELECT … FOR UPDATE WHERE id = p_id`.
   - **Identitatea cererii (P2-5, J2-3):** `v_hash_cerere := sha256` peste (`p_id`, `p_hash_previzualizare`, `p_numar`, codurile din `p_confirmari` sortate și deduplicate, `p_confirm_salt`, `p_font_pt`).
   - **Retry (J10):** dacă decizia are `stare <> 'draft'` și `cerere_emitere = p_cerere_id` (deci și dacă între timp a devenit `semnata` sau `anulata`, Vf10): cu `cerere_emitere_hash = v_hash_cerere` întoarce rezultatul salvat (`{id, an, numar, nr_afisat, cod_verificare, avertismente}`), fără alocare și fără eveniment; cu alt hash → eroare „cerere de emitere refolosită cu alt conținut” (P2-5).
   - Altfel trebuie `stare = 'draft'` și `origine = 'platforma'`.
   - **Unicitate globală (P3-3):** dacă `p_cerere_id` e deja pe **altă** decizie → eroare „cerere de emitere folosită pe alt draft”, fără alocare; plasa e indexul unic parțial din §3.1 (`unique_violation` → același mesaj).
2. **Citirea unică, sub lock (P2-1, J2-5):** `v_in := _hr_decizie_intrari(p_id, true)`. Ordinea lock-urilor e fixă și aceeași în toate RPC-urile care ating aceste rânduri:
   1. decizia nouă (`FOR UPDATE`, deja luat la pasul 1);
   2. ținta, dacă `inlocuieste_id` / `revoca_id` e setat (`FOR UPDATE`, P0-2, J3);
   3. `hr_decizii_semnatari` (rândul semnatarului, `FOR SHARE`); **abia din rândul blocat** se citește `imputernicire_decizie_id` (J3-3: o migrare D11 care retrage legătura fie s-a comis înainte și se vede, fie așteaptă emiterea);
   4. decizia de împuternicire derivată la 2.3 (`FOR SHARE`);
   5. `employees` (persoana), `hr_autorizatii` (atestatul), `executie_proiecte` (proiectul), `hr_decizii_tipuri` (tipul, V2-2), toate `FOR SHARE`, în această ordine;
   6. contorul (`FOR UPDATE`, abia la alocare, pasul 5).
   Ordinea nu creează cicluri noi: nicio funcție nu ia un rând `hr_decizii_semnatari` după ce a blocat o decizie de împuternicire, iar migrarea D11 atinge doar semnatarul (J3-3). Toate citirile ulterioare din această emitere folosesc **doar `v_in`**; nicio funcție nu mai recitește tabelele. Lock-urile `FOR SHARE` țin până la COMMIT, deci un UPDATE concurent pe proiect / atestat / semnatar așteaptă emiterea (sau emiterea îl așteaptă și vede valoarea comisă, din care se calculează și hash-ul). Tranzacția e scurtă; nu apar cicluri, pentru că `ataseaza_scan` ia doar decizia și ținta ei (pașii 1–2), iar `fn_completare_aplica` decizia și apoi propunerea (§3.4).
3. **Versiunea (J20, P2-1):** `hash_previzualizare` se recalculează **din `v_in`** (plus `continut` randat din `v_in` cu numărul-rezervă, ca la previzualizare); dacă diferă de `p_hash_previzualizare` → eroare „draftul s-a schimbat de la previzualizare; previzualizează din nou” (alt redactor, atestat sau proiect schimbat etc.). Verificarea B7 (încadrarea) făcută de client e deci legată de exact intrările emise. **Ținta:** B9 se reverifică din `v_in`, sub lock-ul de la pasul 2.2.
4. Calculează `v_ctx := _hr_decizie_context(v_in)` (după lock-uri, J3-2) și avertismentele cu `_hr_decizie_avertismente(v_in, v_ctx, p_numar, _hr_decizie_mod(tip_cod, 'emitere'))` (lista din §4.A.2; **o `REVOCARE` primește matricea `revocare`**, J2-2), **inclusiv R3, calculat pe server** cu `_hr_acopera_domeniu(cerute, v_in.atestat.domenii)` (P1-1, J19, P3-1).
   - Orice blocant (**B**) → eroare cu lista.
   - Orice roșu (**R**) calculat de server al cărui cod nu apare în `p_confirmari` → eroare cu lista; UI-ul îl afișează și cere confirmarea. Codurile din `p_confirmari` pe care serverul nu le-a calculat se ignoră și nu se salvează: confirmările doar confirmă, nu adaugă și nu înlocuiesc (P1-1).
   - Calculează `an = extract(year FROM data_emitere)` și rulează validatorul comun (J12). Dacă `an ≠ extract(year FROM _hr_azi())`, `p_numar` e obligatoriu (B3/R6).
5. Alocă numărul: `(n, _, salt, g3) := _hr_decizii_aloca('HR', an, p_numar, '', p_confirm_salt, 'platforma', data_emitere)`; `salt` (J23) și `g3` (V2-1) se adaugă în avertismente.
6. Construiește `snapshot` **din `v_in`** (P2-1):
   - persoana (nume, titlu și formele lui);
   - proiectul (`proiect_denumire`, `nr_contract`, `data_contract`, beneficiar, `data_termen`);
   - atestatul (tip, nr., dată, **emitent din `hr_autorizatii.emitent`** (C29), expirare, `verificat_pe_scan`, `uploadat_de`);
   - semnatarul (nume, calitate, `preambul_text`, `bloc_semnatura`, împuternicire: **doar id-ul deciziei, nr. și data**, derivate din `imputernicire_decizie_id` (P1-4). Calea și hash-ul scanului **nu** intră în snapshot: rândul unei decizii pe proiect îl citesc profilurile `exec`, iar P1-2 le ascunde metadatele împuternicirii; ele se scriu în evenimentul `emitere`, citit doar cu `citire` (Vf13, J2-10));
   - ținta, la înlocuire/revocare (nr. afișat, data, funcția), pentru articolul de înlocuire și pentru Art.1 al revocării (J2-12);
   - `temei`, `data_efect_pana` (J2-11) și **`font_pt = p_font_pt`** (Vf8, J2-3).
7. Randează: `continut := _hr_decizie_randeaza(v_in, n, data_emitere)`, care dă `{titlu, preambul, decide, articole[], bloc_semnatura, luare_la_cunostinta}`.
8. Calculează `cod_verificare := 'D' || id || '-' || left(encode(sha256(convert_to(continut::text,'UTF8')),'hex'), 8)`.
9. Face UPDATE strict pe coloanele tranziției: `stare = 'emisa'`, `an`, `numar`, `mod_numar`, `snapshot`, `continut`, `cod_verificare`, `avertismente` (toate, inclusiv cele galbene, R7 din alocare, plus confirmările `{cod, mesaj, confirmat_de, confirmat_la}`), `cerere_emitere = p_cerere_id`, `cerere_emitere_hash = v_hash_cerere`, `emis_de`, `emis_la`. Scrie evenimentul (cu `versiune`, `hash_previzualizare`, `font_pt` și `imputernicire_scan` {path, sha256}).
10. Întoarce `{id, an, numar, nr_afisat, cod_verificare, avertismente}`.

### 3.9 Scanul semnat (`fn_hr_decizie_ataseaza_scan`)

1. Verifică dreptul `scan` (fail-closed, §3.3) și ia decizia FOR UPDATE.
   - **Retry (VA34):** dacă decizia e deja `semnata`, iar `scan_path` și `scan_sha256` sunt identice cu cele primite, întoarce ok fără eveniment nou. E cazul unui răspuns pierdut pe rețea instabilă.
   - Altfel, starea trebuie să fie `emisa`.
   - **Ținta (P0-2, J3):** dacă decizia are `inlocuieste_id` / `revoca_id`, ia ținta `FOR UPDATE` și reverifică: ținta e încă `semnata` și nu există altă relație vie pe ea în afară de decizia curentă. Altfel eroare, fără tranziție (scanul rămâne în bucket, orfan).
2. Verifică calea: `<serie>/<an>/<id>/semnat_*.pdf`, cu seria, anul și id-ul deciziei, plus verificarea de fișier din §3.6 (VA20).
3. Verifică `p_verificari` (C15b), după modul ecranului (§4.A.6, VA5):
   - numiri cu document generat (origine `platforma`): `{nr, persoana, semnatura, stampila, cod}`, toate true. `cod` = „codul de pe hârtie e D{id}-xxxx afișat” (VA28); fără bifa asta, codul C15a ar fi doar decorativ;
   - numiri fără document generat (`rezervare`, `import`): `{nr, persoana, semnatar, semnatura, stampila}`, toate true. `semnatar` = „semnatarul de pe hârtie e cel înregistrat”, pentru că bifa `semnatura` confirmă doar că documentul e semnat, nu și cine l-a semnat (VA17). La import, `stampila` poate fi false doar cu `observatie` nevidă (de ex. „originalul nu are ștampilă”), ca bifa să nu devină o declarație falsă (VA31);
   - `ALTA_DECIZIE`: `{nr, semnatura}`;
   - pentru toate (D5): `lizibil` = true („toate paginile sunt complete și lizibile”), plus `sursa` (`'pdf'` sau `'foto'`), `pagini` (întreg ≥ 1, acceptat indiferent de sursă), `pagini_sursa` (`'detectat'` sau `'manual'`, VA29) și `generat` (true / false). Sunt obligatorii, dar doar informative;
   - lista intră în eveniment.
4. Face UPDATE: `scan_path`, `scan_sha256` (format `^[0-9a-f]{64}$`, valoare declarată de client, P2.1), `scan_de`, `scan_la`, `stare = 'semnata'`.
5. Ținte (efect imediat în v1: B9 refuză la emitere o înlocuire/revocare cu `data_efect` > `data_emitere`, J7):
   - `inlocuieste_id` → `inlocuita`;
   - `revoca_id` → `revocata`;
   - în ambele cazuri, `UPDATE executie_completari_propuse SET status = 'expirat' WHERE hr_decizie_id = <tinta> AND status = 'propus'`, cu eveniment `propunere_expirata` (C9);
   - **la revocare (P3-2):** dacă ținta e de nivel proiect, `tip_tinta.camp_efect` e nenul și există în `executie_proiecte`, iar valoarea curentă a câmpului e **încă** `tinta.employee_id` → inserează o propunere de golire: `camp = camp_efect`, `valoare = ''`, `valoare_afisata` = „(gol)”, `sursa = 'decizie_revocare'`, `hr_decizie_id` = revocarea, `dovada_path` = scanul revocării, `motiv` = „revocă {nume}; câmpul se golește”, `status = 'propus'`, cu eveniment `propunere_golire`. Altfel nimic (echipa nu-l mai are pe cel revocat). Golirea o face doar omul, la confirmare (§3.4). Condiția „proiect activ” **nu** se aplică aici (P3-2, verificare runda 3): pe un proiect inactiv câmpul cu persoana revocată nu rămâne fără urmă, iar confirmarea e oricum umană;
   - **la o numire nouă semnată (P3-2, verificare runda 3):** dacă tipul are `camp_efect` nenul și nivel proiect, propunerile `sursa = 'decizie_revocare'`, `status = 'propus'`, pe același `proiect_id` și `camp = camp_efect` trec în `expirat`, cu eveniment `propunere_expirata` (motiv „numire nouă nr …”); se blochează `FOR UPDATE` după ținte, în aceeași ordine.
6. Efect: dacă `_hr_decizie_eligibila_efect(p_id)` e true (§2.8; include `tip.camp_efect IS NOT NULL`, `nivel = 'proiect'`, `propune_efect`, **`employee_id IS NOT NULL`** (J8), proiect activ, decizie neexpirată (J6) **și coloana `camp_efect` există în `executie_proiecte`** (C40)):
   - pentru originile `platforma` și `rezervare`, regula include B1 (VA17). Dacă pică (împuternicit pe propria numire), scanul rămâne înregistrat, dar nu se naște nicio propunere, iar evenimentul notează motivul. La import, B1 nu se aplică (§4.E);
   - dacă regula pică din alt motiv (extern fără `employee_id`, proiect inactiv, decizie expirată), scanul se salvează oricum, fără propunere, cu eveniment `propunere_omisa` și motivul; tranzacția nu cade (J8);
   - citește valoarea curentă;
   - dacă e diferită de `employee_id`, inserează propunerea (tabelul din §4.A.7) și scrie eveniment;
   - numără celelalte rânduri `propus` pe același (proiect, câmp), pentru G8.
   - **v1.2 [V]:** de la `20261017a`, `sef_santier_employee_id` există, deci garda C40 nu mai oprește nimic pe `SEF_SANTIER`. Însă `fn_completare_aplica` nu are câmpul în whitelist, iar propunerea ar pica la confirmare („câmp nepermis”). De aceea `SEF_SANTIER` intră în seed cu `camp_efect = NULL`, iar PR5 îl setează odată cu whitelist-ul. Garda C40 rămâne ca plasă.
   - RPC-ul lucrează cu `tip.camp_efect` (SQL dinamic cu `%I`) și nu scrie literal `sef_santier_employee_id` în corp. Altfel ar bloca revenirea `20261017a`, care refuză dacă vreo funcție are coloana în corp (`supabase/revenire/20261017a_executie_sef_santier_ROLLBACK.sql:58-61`) [V].
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
- semnatarul (implicit `tip.semnatar_implicit_id`, adică 121 pe toate tipurile, D2c);
- bifele „luare la cunoștință” și „propune efect pe echipă”;
- `propune_efect` e implicit true, dar devine **false implicit** când pe proiect există deja un RTE activ pe alt domeniu, caz în care UI-ul întreabă explicit (C11).

**2. Avertismente.** Lista o calculează serverul (`_hr_decizie_avertismente`), la previzualizare și din nou la emitere, **inclusiv R3** (P1-1, J19), pe matricea aleasă de server din `tip_cod` (J2-2). Clientul poate anticipa R3 cu `acoperaDomeniul`, dar nu-l poate omite: serverul îl impune.

**Blocante (B)**: nu se pot trece cu confirmare.

| Cod | Condiție |
|---|---|
| B1 | Semnatarul **nu** e reprezentant legal și e chiar persoana numită (C7). Azi: Pantea sau Tudorache pe propria numire (D2a). Se calculează și la rezervarea unei numiri (§4.F, VA17) |
| B2 | Angajatul e inactiv sau are `termination_date < data_efect` (C34) |
| B3 | `data_emitere > _hr_azi()`; sau anul emiterii ≠ anul curent și nu s-a dat număr manual (C5; numărul manual vine ca parametru în `_hr_decizie_avertismente`, J23). Se aplică la emitere și la rezervare (J12) |
| B4 | Nivelul nu e compatibil cu `tip.nivel` (C14); eticheta nu e în lista tipului. **Excepții:** la `ALTA_DECIZIE` eticheta e liberă (rămân nivelul și `descriere` obligatorie, J22); la `REVOCARE` eticheta vine din țintă și nu se verifică în lista tipului (J4) |
| B5 | Textul tipului conține `{contract}`, iar proiectul n-are `nr_contract` (C42) |
| B6 | Atestatul ales nu e al angajatului, e șters (`deleted_at`), e înlocuit (`inlocuita_de_id`) sau n-are tipul cerut (C43) |
| B7 | Previzualizarea depășește o pagină A4 și la 11pt. Se verifică în client, iar butonul „Emite” rămâne inactiv (C18) |
| B8 | Numărul manual e ocupat (mesajul indică decizia care îl ocupă); numărul automat e cerut pe un an neinițializat |
| B9 | La înlocuire sau revocare: ținta nu e `semnata`; are deja altă înlocuire **sau** revocare vie (o singură relație vie pe țintă, P0-2, J3); ținta nu e o numire (`REVOCARE` / `ALTA_DECIZIE`, J18); `data_efect > data_emitere` (efectul viitor la înlocuire/revocare e v2, J7); sau, la înlocuire, are alt tip, alt nivel ori alt proiect (C12). Se verifică sub lock pe țintă, la emitere și din nou la scan |
| B10 | Câmpuri obligatorii lipsă: angajat, titlu, `data_emitere`, **`data_efect` (inclusiv la înlocuire și revocare, unde articolul folosește `{data_efect}`, V2-3)**, semnatar, iar la proiect și proiectul. La `REVOCARE`, persoana (angajat **sau** `persoana_nume`) vine din țintă, deci revocarea numirii unui extern trece (J4) |

**Roșii (R)**: emiterea merge doar cu confirmare explicită; confirmarea se salvează în `avertismente`, cu cine și când.

| Cod | Condiție |
|---|---|
| R1 | Atestat obligatoriu lipsă. Emiterea confirmată produce textul **fără** segmentul de atestat (segment opțional `[[ ]]` în §5.3), nu un număr gol sau inventat (J2-13) |
| R2 | Atestatul e expirat la `data_efect` și nu are `fara_expirare` |
| R3 | Domeniul cerut nu e acoperit (`_hr_acopera_domeniu` pe server, port al `acoperaDomeniul`, P1-1, J19) |
| R4 | Semnatarul nu e reprezentant legal, iar împuternicirea lui nu acoperă decizia (2B, C8). O singură formulă (VA2, P1-4), cu `i` = decizia `imputernicire_decizie_id`: `NOT este_reprezentant_legal AND (i IS NULL OR i.tip_cod <> 'ALTA_DECIZIE' OR i.stare <> 'semnata' OR i.scan_path IS NULL OR i.data_emitere IS NULL OR i.data_emitere > data_emitere OR NOT preambul_validat)`. Retragerea unei împuterniciri **nu** trece prin registru (J18/B9 interzic `ALTA_DECIZIE` ca țintă, iar anularea merge doar din `emisa`): se face prin migrare de date `imputernicire_decizie_id = NULL` (preview → OK Răzvan), după care R4 revine (Vf5, varianta A; de confirmat, §9). Un scan înlocuit al împuternicirii nu schimbă R4. Azi: Pantea și Tudorache, până la împuternicire **și** validarea preambulului (D2b). Se calculează la emitere și la rezervarea unei numiri (§4.F) |
| R5 | Text nevalidat juridic (C28): temeiul tipului e `propunere` (RSVTI, REVOCARE), **sau** decizia conține un articol condițional nevalidat — termenul (`data_efect_pana` completată) sau înlocuirea (`inlocuieste_id` setat), §5.1 (J3-5). Mesajul numește articolul. Dispare doar printr-o migrare după validarea juridică (`temei_sursa = 'validat_juridic'` pe tip, respectiv constanta articolelor condiționale validate în `_hr_decizie_avertismente`) |
| R6 | Anul emiterii ≠ anul curent (retrodatare peste an) (C5) |
| R7 | Număr manual peste `ultimul + 20` („salt mare”) (C4) |

**Galbene (G)**: informative.

| Cod | Condiție |
|---|---|
| G1 | Atestatul expiră înainte de `data_termen` a proiectului |
| G2 | Există deja o decizie activă pe același proiect, tip și domeniu, sau pe firmă pe același tip când `unic_activ`, pentru altă persoană. Sugerează „Înlocuiește” (C14) |
| G3 | `data_emitere` e anterioară ultimei decizii din registrul anului (retrodatare). Calculat în `_hr_decizii_aloca`, sub lock-ul contorului, nu în `_hr_decizie_intrari` (V2-1) |
| G4 | Proiectul n-are `data_contract` |
| G5 | Reprezentantul legal se numește pe sine (precedentul 914) (C7) |
| G6 | Tip RSVTI cu persoana ≠ `RSVTI_EMPLOYEE_ID = 81` din Adeverințe, până la v2 (C38) |
| G7 | Pe proiect există deja un RTE activ pe alt domeniu, iar `propune_efect` e false (C11) |
| G8 | Există deja o propunere `propus` pe același câmp, din nas, mail sau altă decizie. Apare la scan (C10) |
| G9 | Atestatul nu e `verificat_pe_scan` (atestatele le pot scrie și superadmin-ii, C23) |
| G10 | Temeiul diferă de cel implicit al tipului, sau temeiul are sursa `model_nas` (nevalidat juridic, dar folosit în practică) |
| G11 | La `REVOCARE`: semnatarul împuternicit revocă propria numire (informativ; B1 nu se aplică revocării, J4) |
| G12 | La `REVOCARE`: persoana din țintă e acum inactivă sau externă (informativ; B2 nu se aplică, J4) |

**Matricea pe moduri (J4, J12, J22).** `_hr_decizie_avertismente(…, p_mod)`, cu `p_mod` ales **numai** de `_hr_decizie_mod` pe server (J2-2):

| Mod | Se aplică | Nu se aplică |
|---|---|---|
| `emitere` (numire) | B1–B10, R1–R7, G1–G10 | – |
| `revocare` (`tip_cod = 'REVOCARE'`) | B3, B5 (dacă textul cere `{contract}`), B7, B8, B9, B10 (fără angajat; `titlu` obligatoriu, Vf7), **R4** (Vf6), R5, R6, R7, G11, G12 | B1, B2, B4 pe etichetă, B6, R1–R3, G1, G2, G5–G9 |
| `rezervare` (numire) | B1, B3, B4, B8, B10 (persoană + semnatar), R4, R6, R7 | restul (nu există text generat) |
| `rezervare` (`ALTA_DECIZIE`) | B3, B4 (doar nivel), B8, R6, R7 | restul |
| `import` | B4 (cu excepția `ALTA_DECIZIE`), B8 (conflict exact pe sufix, P2-2), validatorul comun de număr/an/dată; `REVOCARE` refuzat (J2-9) | B1, B2, B3 pe an, avertismentele de atestat, R6, R7 |

**3. Previzualizare.** Se cheamă `fn_hr_decizie_previzualizeaza`, iar `renderDecizieHtml` (§6) pune peste pagină „PROIECT — NEEMIS”, cu numărul „____” măsurat la lățimea maximă („99999-bis”). Aici se verifică și B7. Clientul păstrează `hash_previzualizare` și îl trimite la emitere (J20).

**4. Emitere.**
- Se cheamă `fn_hr_decizie_emite`, cu `hash_previzualizare`, un `cerere_id` generat la apăsarea „Emite” (păstrat la retry, cu exact aceiași parametri, P2-5), **`p_font_pt` = mărimea la care previzualizarea a încăput (12 sau 11, J2-3)**, număr automat sau manual, confirmările roșii și, după caz, `p_confirm_salt`. Dacă draftul s-a schimbat între timp, emiterea e refuzată și UI-ul cere o nouă previzualizare (J20).
- PDF-ul final se generează din `continut` și **se măsoară din nou** (`scrollHeight` ≤ 1123 px) înainte de upload. Dacă totuși depășește, PDF-ul nu se urcă și nu se înregistrează: decizia rămâne `emisa` fără PDF, apare în „De rezolvat” cu „PDF neînregistrat: depășește pagina”, iar HR o anulează și o refă. Un PDF decupat nu e niciodată rezultat valid (J20).
- Altfel se urcă în `…/generat_<ts>.pdf`.
- Calea și hash-ul se înregistrează cu `fn_hr_decizie_seteaza_pdf`.

**5. Descărcare și print.** Se semnează și se ștampilează de mână, de semnatarul ales.

**6. Scanul semnat (de pe calculator sau de pe telefon, D5).**
- **Două moduri ale ecranului (VA5, VA31):**
  - **cu document generat** (origine `platforma`): decizia generată alături de scan, bifa `cod` și nota de pagini (mai jos);
  - **fără document generat** (`rezervare`, `import`): `continut` e NULL și nu există `cod_verificare`, deci în locul generatului apare fișa din registru (nr./data, tip/etichetă, persoană, proiect, semnatar, descriere). Fără cod și fără comparația de pagini. Bifele sunt cele din §3.9, pasul 3.
- **Două surse, nu amestecate în v1:**
  - un PDF: de la scanner sau de la scanerul nativ al telefonului (iOS: Fișiere / Notițe → Scanează documente; Android: Google Drive → Scanează), care dă PDF decupat și îndreptat, fără cod nou (VA28). Se ia ca atare, iar paginile se numără cu `paginiDinBytes` (`ctc/ctcUtil.js:140`). Dacă întoarce null (PDF cu object streams, `ctc/ctcUtil.js:138-139`), apare câmpul obligatoriu „Câte pagini are scanul?”, ca în CTC (`ctc/ctcDb.js:90, 97`), cu `pagini_sursa = 'manual'` (VA29);
  - **poze (D5)**: una sau mai multe imagini, fiecare o pagină, unite în browser **într-un singur PDF**, în ordinea din listă, cu `pregatestePagina` + `paginiToPdf` (§6). Nu se folosește `imageToPdf` ca atare: face o singură pagină, iar apelantul lui urcă originalul dacă pică conversia (§1).
- **Pe telefon:** butonul „📷 Fă poză” (`capture="environment"`) e calea recomandată (VA13) și adaugă o pagină în listă la fiecare apăsare. Lista arată miniaturi numerotate, cu ↑ ↓ (ordine), ⟳ (rotire cu 90°) și ✕ (scoate). Alternativ, „🖼 Din galerie” alege mai multe poze deodată. Ordinea din FileList nu e garantat ordinea selecției, așa că lista o arată, iar omul o corectează (VA27). Inputul se resetează după fiecare alegere (`e.target.value = ''`, ca la `PiesePozeSection.jsx:209`).
- **Lista de pagini e doar în memorie** (fără IndexedDB în v1; aplicația nu are precedent) (VA36). Pe Android, Chrome poate închide tab-ul cât timp e deschisă aplicația de cameră, iar paginile deja făcute se pierd. De aceea, când modalul se deschide cu lista goală (inclusiv după o reîncărcare), apare sfatul: „Dacă pozele au dispărut când s-a deschis camera, fă-le cu aplicația Cameră și alege-le din «Din galerie»”.
- **Validări în client, înainte de conversie (VA32):**
  - imagini: se acceptă orice `image/*` sau tip gol, iar decizia o ia decodarea (`img.decode()`), nu o listă de tipuri, ca să treacă și HEIC-ul pe care îl decodează Safari. O poză nedecodabilă (HEIC pe Android sau pe desktop) dă mesajul „format neacceptat: fă poza din aplicație sau trimite JPG/PDF; pe Android, dezactivează HEIF în setările camerei sau folosește «Fă poză»”, fără să urce nimic;
  - PDF: primii 5 octeți trebuie să fie `%PDF-`; nu contează `file.type`, care poate fi gol. Înainte de upload, fișierul se reîmpachetează ca `new File([f], 'semnat_<ts>.pdf', {type: 'application/pdf'})`. Motivul: storage-js trimite un File ca multipart, cu tipul fișierului, și ignoră opțiunea `contentType` [V: `@supabase/storage-js` 2.105.3, `dist/index.mjs:596-600`]. Un PDF cu tip gol ar pleca deci ca `application/octet-stream`, iar bucket-ul doar-PDF l-ar refuza;
  - max 10 pagini, max 25 MB pe poza originală, iar PDF-ul final ≤ 20 MB (limita bucket-ului, §3.5).
- **Verificarea „generat vs. scan”, adaptată la poze (fără OCR sau AI, „Ce NU face”):**
  - **pe telefon nu se randează PDF-uri (VA14, VA27).** Chrome pe Android nu afișează PDF în iframe, iar aplicația previzualizează PDF-uri doar prin iframe [V: `HR.jsx:2577`, `AmcSection.jsx:156`, `Logistica.jsx:2583`]. De aceea:
    - generatul se afișează din `renderDecizieHtml` (HTML, scalat la lățimea ecranului; tap → ecran întreg);
    - scanul din poze se afișează din paginile procesate, adică exact JPEG-urile care intră în PDF, pe cadru A4;
    - PDF-ul de la scanner apare ca „PDF · N pagini”, cu butonul „Deschide” (tab nou, vizualizatorul telefonului). Opțional, prima pagină se randează cu pdf.js din CDN, ca în `SupapeDeclaratiiSection.jsx:81-106` (`pdfjs-dist` e în package.json, dar nu e importat nicăieri în src [V]);
    - pe desktop, cele două stau alăturat; pe telefon, unul sub altul sau pe două file;
  - bifele „nr. corect / persoana corectă / semnătura / ștampila” (C15b), plus „toate paginile sunt complete și lizibile” (`lizibil`, D5), iar în modul cu document generat și „codul de pe hârtie e cel afișat” (`cod`, VA28);
  - codul de verificare din subsol (D{id}-xxxx) se afișează mare lângă scan, ca omul să-l caute pe poză;
  - pozele înclinate sau cu umbre se acceptă dacă se citesc numărul, numele, semnătura, ștampila și codul. Altfel se refac. Nu se îndreaptă automat;
  - în modul cu document generat, numărul de pagini se compară cu generatul (care are mereu o pagină, B7). Dacă scanul are mai multe (de ex. „luare la cunoștință” pe verso), apare doar o notă, nu blocaj;
  - ecranul dă sfaturi scurte: toată foaia în cadru, pe o suprafață închisă la culoare, lumină uniformă, fără bliț și fără umbra telefonului.
- Fișierul se urcă în `…/semnat_<ts>.pdf`, cu hash-ul calculat pe PDF-ul compus (§6), apoi se cheamă `fn_hr_decizie_ataseaza_scan`, cu `p_verificari` din §3.9, pasul 3. Starea trece în `semnata`.
- **La o eroare de rețea (VA34),** UI-ul păstrează File-ul compus, calea și hash-ul până la succes. La retry nu recompune PDF-ul (hash-ul ar ieși altul, §6) și nu urcă din nou dacă obiectul există deja; RPC-ul e idempotent (§3.9, pasul 1).
- **Pozele originale (VA13):** aplicația nu le urcă și nu le păstrează, iar EXIF-ul lor (inclusiv GPS) nu trece în PDF (§2.10). Pe telefon însă pot rămâne. Pe calea „Din galerie” sunt deja în galerie (și, de regulă, în backup-ul Google Photos sau iCloud). Pe iOS, poza făcută cu „Fă poză” de regulă nu intră în galerie, dar pe Android depinde de aplicația de cameră. După salvarea unui scan din galerie, ecranul afișează: „Șterge pozele din galerie (și din «Șterse recent»)”.

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
2. La emitere se verifică B9 sub lock pe țintă: poate exista o singură relație vie (înlocuire **sau** revocare) pe aceeași țintă (P0-2, J3). În v1, `data_efect` a înlocuirii nu poate fi după `data_emitere` (J7).
3. Când noul scan e semnat, cea veche trece în `inlocuita`, propunerile ei neconfirmate trec în `expirat`, iar efectul propune noua persoană.
4. **Textul noii decizii spune ce înlocuiește (J2-12):** `_hr_decizie_randeaza` adaugă, când `inlocuieste_id` e setat, articolul comun de înlocuire (§5.1), cu identificarea țintei din `v_in`. Articolul intră în `continut`, deci în previzualizare și în `cod_verificare`.

### D. Revocare fără înlocuire
1. Se creează o decizie de tip `REVOCARE`, cu `revoca_id`. Ținta trebuie să fie o **numire** `semnata` (nu `REVOCARE`, nu `ALTA_DECIZIE`, J18) și să nu aibă altă relație vie (P0-2).
2. Triggerul copiază din țintă nivelul, proiectul, persoana, titlul și eticheta (C12). Validările sunt cele din modul `revocare` (§4.A.2, J4): fără B1, B2 și lista de etichete; revocarea numirii unui angajat plecat sau a unui extern trece, cu G11/G12.
2b. **Efect imediat în v1 (J7):** `data_efect` ≤ `data_emitere`. O revocare „de luna viitoare” se emite la data efectului; modelarea încetării la o dată viitoare e v2.
3. Art.1: „Incepand cu data de {data_efect}, se revoca Decizia nr. {nr_tinta} privind numirea {titlu} {nume} in functia de {functie_tinta}…”. Formularea e **de validat juridic**: `temei_sursa = 'propunere'`, deci R5. `{nr_tinta}` e identificarea canonică a țintei (J3-7, §5.2): număr cu sufix, apoi `/dd.mm.yyyy` dacă ținta are dată, altfel `/yyyy` (anul e mereu cunoscut), plus „ (seria carte tehnica)” pentru seria `carte_tehnica` — de ex. „385a/12.03.2024”, „391/2025 (seria carte tehnica)”. Două ținte cu același număr în ani sau serii diferite nu mai pot fi confundate. Segmentul `[[/{data_tinta}]]` din v1.4 dispare (înlocuit de forma canonică).
4. Când e semnată, ținta trece în `revocata`, iar propunerile ei neconfirmate trec în `expirat`.
5. **Golire propusă, nu automată (P3-2).** Dacă echipa proiectului îl are încă pe cel revocat în `camp_efect`, scanul revocării naște o propunere „golește câmpul” (§3.9, pasul 5), confirmată în panoul „Completări propuse” de owner sau `can_manage_contracts`; `fn_completare_aplica` golește doar dacă valoarea e încă persoana revocată (§3.4). Până la confirmare, cardul din Echipă arată „⚠ decizie revocată, echipa îl are încă pe X”.

### E. Import decizii vechi („Înregistrează decizie existentă”, PR4)

**Payload-ul:**
- `serie`: `HR` implicit, sau `carte_tehnica`;
- `an` și `numar`, obligatorii; `numar_sufix`, opțional (de ex. „bis”);
- `data_emitere`: **opțională la import** (C16a), pentru că deciziile din cartea tehnică n-au dată;
- `cerere_id` (uuid din client, obligatoriu): retry-ul cu același payload întoarce același rând (P1-3, J10);
- `tip_cod`: orice tip **în afară de `REVOCARE`** (J2-9: CHECK-ul cere `revoca_id` la `REVOCARE`, iar importul îl refuză). O revocare istorică se înregistrează ca `ALTA_DECIZIE` (descriere „revocă decizia nr. …”), fără efect automat asupra țintei; ținta rămâne cum e, iar HR o poate marca prin anulare doar dacă e `emisa`. `ALTA_DECIZIE` cu etichetă liberă acoperă tipurile din afara v1 (Pază, VT2, Gestionar); validatorul de etichetă are excepția explicită pentru `ALTA_DECIZIE` (J22);
- eticheta, nivelul, `employee_id` **sau** `persoana_nume` (extern), proiectul, atestatul (opțional);
- `semnatar_id` (implicit 121), `titlu`, `descriere`;
- `propune_efect`: implicit **false**;
- **`inlocuieste_id` / `revoca_id`: refuzate în v1** (Vf12), ca la rezervare: altfel scanul importului ar trece ținta în `inlocuita`/`revocata` fără B9 la emitere.

**Pașii:**
1. Funcția validează B4 (cu excepția `ALTA_DECIZIE`, J22), B8 (pe serie, an, număr, sufix, **exact**, P2-2) și coerența de nivel, **plus validatorul comun de număr/an/dată** (J12): număr 1–99 999, an ≤ anul curent, `an = extract(year FROM data_emitere)` când data există, data nu în viitor. B1, B2 și avertismentele de atestat nu se aplică trecutului.
2. Alocă prin `_hr_decizii_aloca(serie, an, numar, numar_sufix, false, 'import', data_emitere)` (P0-3):
   - seria HR împinge contorul anului cu GREATEST, dar **nu** pornește numărul automat;
   - seria `carte_tehnica` nu atinge contorul (C16b).
3. Construiește `snapshot` din datele de azi, marcat `snapshot.sursa = 'import'`. `continut` rămâne NULL: documentul este scanul.
4. Decizia intră în starea `emisa`, cu origine `import`.
5. Clientul urcă scanul și cheamă `fn_hr_decizie_ataseaza_scan` → `semnata`. Ecranul de scan e același ca la §4.A.6, în modul „fără document generat” (VA5), deci merge și din poze de pe telefon (D5); o decizie veche de 2 pagini devine un singur PDF.
   - **La numiri scanul e obligatoriu.** Un import fără scan apare în „De rezolvat” până se completează sau se anulează.

**Decizii combinate** (de ex. MP / Șef șantier 385/2024): câte un rând pe funcție, același număr, sufix „a” / „b”, **același fișier urcat de două ori**, câte o cale pe decizie, cu același hash (§3.5, J14).

**Propunerea de efect la import** (J8): chiar cu `propune_efect = true`, un extern (`persoana_nume`, fără `employee_id`) nu primește propunere; scanul se salvează, iar evenimentul `propunere_omisa` notează „extern”.

**Ordinea importului nu contează (P2-2):** 912-bis înainte de 912 intră la fel ca invers.

**Primul test e seria Mironu 28.09.2026:**
- 911 CTC, 912 Coordonator SSM (Pantea), 912-bis Inspector SSM, 913 RTE MEC, 914 MP (Trusu, semnată de Trusu: importul trece), 915 Șef șantier, 916 RTE 1.1;
- după import, `ultimul` pe 2026 ajunge la 916, cu `auto_permis` încă false.

### F. Rezervare și regula de tranziție (PR3) (C1, C2)

**Regula de tranziție:**
- **Cât timp se mai fac decizii HR în Word, numărul lor îl dă platforma, niciodată invers.**
- HR apasă „Rezervă număr” și completează tipul (implicit `ALTA_DECIZIE`), descrierea, data și, opțional, persoana și proiectul. O `ALTA_DECIZIE` legată de un proiect o văd tot doar owner-ii și HR (§3.3, VA7).
- **La numiri** (tip ≠ `ALTA_DECIZIE`, de ex. o decizie RTE făcută încă în Word), persoana și semnatarul sunt obligatorii (VA17). `fn_hr_decizie_rezerva` calculează B1 (blocant) și R4 (confirmabil, cu `p_confirmari` în payload) cu aceeași `_hr_decizie_avertismente` ca la emitere și le salvează în `avertismente`. Fără asta, o numire din Word semnată de un împuternicit pe propria numire, sau fără împuternicire, ar intra ca `semnata` și ar propune schimbarea echipei fără niciun avertisment (D2, C7).
- `fn_hr_decizie_rezerva` rulează validatorul comun și B3/R6 (J12), alocă numărul (automat dacă anul e inițializat, altfel manual; R7 din alocare intră în `avertismente`, J23) și creează rândul cu starea `emisa`, origine `rezervare` și `continut` NULL.
- **Idempotență (P1-3, J10):** formularul generează `cerere_id` la deschidere; un retry după răspuns pierdut întoarce același număr, nu consumă altul.
- Rezervarea nu poate purta `inlocuieste_id` / `revoca_id` în v1: înlocuirile și revocările se fac doar prin generator (J7, J18).
- HR trece numărul în documentul Word. După semnare urcă scanul (`ataseaza_scan` → `semnata`; PDF sau poze de pe telefon, ca la §4.A.6, în modul „fără document generat”), sau anulează rezervarea dacă n-a folosit numărul.
- La o numire, scanul produce propunerea de efect, ca la o decizie generată. B1 se reverifică înainte de propunere (§3.9, pasul 6).

**Registrul e comun (D1 = A, închis).** Registrul platformei e registrul HR comun, deci regula de tranziție ține pentru **toate** deciziile HR, din orice categorie. La pornirea PR3, HR primește regula scris: orice decizie HR nouă își ia numărul din „Rezervă număr” sau din generator, niciodată din registrul de hârtie.

**Numărul manual** rămâne disponibil și după tranziție. Fiecare utilizare apare cu `mod_numar = 'manual'` în registru și în jurnal. Restrângerea lui doar la owner, după ce se mută toate documentele, e decizie pentru v2.

### G. Contorul pe an (PR3)

1. **Inițializare.**
   - Înainte de prima emitere automată dintr-un an, HR verifică în registrul fizic ultimul număr dat. Pentru 2026: ce s-a dat după 28.09.
   - Importă sau rezervă manual numerele găsite.
   - Apasă „Pornește numerotarea automată pentru {an}”, introduce ultimul număr fizic și sursa (cine a verificat și unde). Asta cheamă `fn_hr_decizii_contor_initializeaza`.
2. **An nou.** Pe 1 ianuarie numărul automat e oprit pentru anul nou (nu are contor), până la inițializare. Inițializarea cu 0 înseamnă că registrul se resetează anual. Asta tratează C27 fără să presupună reguli.
3. **Goluri.** Numerele din intervalul `(ultimul_initial, ultimul]` care nu au niciun rând apar în „De rezolvat → Goluri în registru”. Golurile de dinainte de inițializare țin de registrul de hârtie și nu se afișează. `ultimul_initial` e baza **primei** inițializări: oprirea și repornirea numărului automat nu o rescriu, deci golurile dintre baza veche și cea nouă rămân vizibile (J13).

---

## 5. Șabloane v1

### 5.1 Structura și textul comun (din F1)

**Ordinea blocurilor:** antet, „DECIZIA NR {nr}/{dd.mm.yyyy}”, preambul (din semnatar), „DECIDE:”, Art.1 (din tip), articolele comune, blocul de semnătură, blocul opțional „ANGAJAT, am luat la cunostinta”.

**Articolele comune** (preluate exact din F1):

> Art.2 „Atributiile legate de aceasta functie sunt cele prevazute in Fisa Postului.”
> Art.3 (doar pe proiect) „Aceasta decizie isi pastreaza valabilitatea pana la receptia definitiva a lucrarii.”
> Art.4 (Art.3 pe firmă) „Prezenta decizie se comunica salariatului si va fi dusa la indeplinire prin intermediul Departamentului Personal.”

**Articole condiționale (v1.4; formulări noi, fără model NAS, de validat juridic → R5 pe decizia care le conține, calculat explicit, J3-5):**
- **Termen (J2-11).** Dacă `data_efect_pana` e completată: pe proiect, Art.3 devine „Aceasta decizie isi pastreaza valabilitatea pana la data de {data_efect_pana}.”; pe firmă se adaugă, înaintea articolului de comunicare, „Prezenta decizie isi produce efectele pana la data de {data_efect_pana}.”. Aceeași dată controlează expirarea din view și eligibilitatea efectului (§2.8), deci documentul și registrul nu pot spune durate diferite.
- **Înlocuire (J2-12).** Dacă `inlocuieste_id` e setat, după Art.1: „Prezenta decizie inlocuieste Decizia nr. {nr_tinta} privind numirea [[{titlu_tinta} ]]{nume_tinta} in functia de {functie_tinta}, care isi inceteaza efectele incepand cu data de {data_efect}.”. Articolele următoare se renumerotează. **Titlul țintei e segment opțional** (J3-6): o țintă importată fără titlu (semnată, deci imuabilă) se poate înlocui; numele rămâne obligatoriu. `{nr_tinta}` e forma canonică din §5.2 (J3-7).
- Numerotarea articolelor o face `_hr_decizie_randeaza`; testul de text cu 916 (test 30) rămâne neatins, pentru că 916 nu are nici termen, nici înlocuire.

**Preambulul.** E text literal din `hr_decizii_semnatari.preambul_text`, **nu se compune din `firma_profil`** (C17).

| Semnatar | Preambul | Validare | Bloc de semnătură |
|---|---|---|---|
| **121 (Trusu)** | Transcris **exact** din PDF-ul 916 la PR1, inclusiv numărul de Reg. Com. în formatul din model (J2007001650296), denumirea, sediul și codul fiscal din model. Structura F1: „D-nul TRUSU RAZVAN MIHAIL, reprezentant legal al S.C. GAZPET INSTAL SRL cu sediul in …, inregistrata la Registrul Comertului sub nr. … cod fiscal … in calitate de angajator;” | `preambul_validat = true` (model NAS) | „Administrator,\nTrusu Razvan” |
| **90 (Pantea)**: nu e reprezentant legal (D2a) | Propunere, text literal (VA3): „S.C. GAZPET INSTAL SRL, … [datele din model], reprezentata legal prin D-nul TRUSU RAZVAN MIHAIL, administrator, prin D-nul PANTEA CONSTANTIN, imputernicit[[ prin {imputernicire}]], in calitate de angajator;” | **de validat juridic**; `preambul_validat = false` → R4 (formula din §4.A.2) până la împuternicire (D2b) și validare | „Pentru Administrator,\nPantea Constantin”, **de validat juridic** |
| **125 (Tudorache)**: nu e reprezentant legal (D2a) | Propunere, text literal (VA3): același, dar „…, prin D-na TUDORACHE MARILENA CLAUDIA, imputernicita[[ prin {imputernicire}]], in calitate de angajator;” | idem | „Pentru Administrator,\nTudorache Marilena”, **de validat juridic** |

Varianta din v1.1 „Tudorache reprezentant legal, cu preambulul lui 121” a căzut (D2a): Tudorache semnează ca împuternicit, la fel ca Pantea.

**Textele sunt literale pe persoană (VA3).** În `preambul_text` și `bloc_semnatura`, singura variabilă permisă e `{imputernicire}` (§3.1). `{titlu}`, `{nume}` și restul variabilelor din §5.2 țin de persoana **numită**: folosite în preambul, ar da de exemplu „prin D-na PANTEA CONSTANTIN” când e numită o femeie. Segmentul `[[ prin {imputernicire}]]` apare în text doar după ce împuternicirea e înregistrată (§3.4).

### 5.2 Variabile (C41, C42)

**Sintaxa șablonului:**
- `{var}` se înlocuiește cu valoarea variabilei;
- `[[ … ]]` e un segment opțional, care apare doar dacă toate variabilele din el au valoare;
- o variabilă în afara unui segment opțional, fără valoare, oprește randarea cu eroare (J2-13). Seed-ul se verifică la PR1: pe orice tip cu `autorizatie_ceruta <> 'nu'`, `{aut_*}` apar **doar** în segmente opționale (testul 66);
- randarea o face **doar** `_hr_decizie_randeaza` (SQL), într-o singură trecere: valoarea unei variabile nu se mai interpretează ca șablon (J3-8), deci un temei care conține „{aut_nr}” apare literal;
- `continut` e **text simplu**; marcarea HTML o face doar clientul, prin escapare (§6, J3-8).

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
| `{domenii}` | un domeniu: „{cod} – {denumire}”. Mai multe: „domeniile: 6.3 - …; 8.4 (D) - …” (model 82/2025). Denumirile vin din `isc_rte_domenii`, **citite o dată în `_hr_decizie_intrari`** (J3-2) |
| `{aut_nr}`, `{aut_data}`, `{aut_emitent}`, `{aut_expirare}` | din snapshot; emitentul vine din `hr_autorizatii.emitent` (C29) |
| `{temei}` | `hr_decizii.temei` |
| `{nr_tinta}` | identificarea canonică a țintei (J3-7): `{numar}{-sufix}` + `/dd.mm.yyyy` (sau `/yyyy` când data lipsește) + „ (seria carte tehnica)” pe seria `carte_tehnica`; din `snapshot.tinta` |
| `{functie_tinta}`, `{nume_tinta}` | obligatorii, la REVOCARE și la înlocuire (J2-12), din `snapshot.tinta` |
| `{titlu_tinta}` | opțional, doar în segmentul `[[{titlu_tinta} ]]` (J3-6) |
| `{data_efect_pana}` | dd.mm.yyyy, doar în articolul de termen (J2-11) |
| `{imputernicire}` | doar în preambulul semnatarului: „Imputernicirea nr. {nr}/{dd.mm.yyyy}”, din `snapshot.semnatar.imputernicire` (derivat din `imputernicire_decizie_id`, P1-4). Formatul exact se validează juridic odată cu preambulul (VA3) |

**Textul se păstrează fără diacritice, ca în modele,** ca prima decizie generată să aibă textul identic cu 916.

### 5.3 Tipurile v1 (seed)

Textele marcate „transcris din …” se copiază literal din modelul NAS la PR1. Nu se inventează.

| Cod | Nivel | Art.1 (P = pe proiect, F = pe firmă) | Etichete alternative | Temei (`temei_sursa`) | Atestat (`autorizatie_ceruta`) | Efect |
|---|---|---|---|---|---|---|
| `RTE` | proiect | P: „Incepand cu data de {data_efect}, {titlu} {nume} se numeste in functia de RTE pentru {domenii}[[, in baza Autorizatiei nr. {aut_nr}/{aut_data}]] in cadrul proiectului „{proiect}”, contract de executie a lucrarilor nr. {contract}” | – | autorizația ISC (model_nas) | `RTE`, obligatorie + acoperirea domeniului | `rte_employee_id`, dacă `propune_efect` |
| `RTE_MEC` | proiect | P: „…se numeste in functia de RTE atestat MEC[[, in baza atestatului nr. {aut_nr}]] in cadrul proiectului „{proiect}”, contract de executie a lucrarilor nr. {contract}” (în 913 lipsește atestatul; **de confirmat**) | – | Ord. 364/2010 (propunere, **de verificat**) | `RTE_MONTAJ_IT`, recomandat (**de confirmat** că e același lucru) | doar view-ul. Pe Mironu, RTE pe domeniu umple `rte_employee_id` |
| `RTS` | proiect | P: „…se numeste in functia de Responsabil Tehnic cu Sudura[[ in baza atestatului {aut_emitent} nr. {aut_nr}]] in cadrul proiectului „{proiect}”, contract nr. {contract}” (model CORSEM) | – | atestatul (model_nas) | `RTS`, obligatoriu | `rts_employee_id` |
| `SEF_SANTIER` | proiect | P: „…se numeste in functia de {functie} in cadrul proiectului „{proiect}”, contract de executie a lucrarilor nr. {contract}” | Sef Santier / Sef de santier | – | nu | **seed cu `camp_efect = NULL`** (v1.2 [V]): coloana există de la 20261017a, dar `fn_completare_aplica` n-o are în whitelist. PR5 setează `sef_santier_employee_id` odată cu whitelist-ul (C40) |
| `MP` | proiect | P: „…se numeste in functia de {functie} in cadrul proiectului…” | Manager Proiect / Manager de proiect | – | `MANAGER_PROIECT_240` / `_60`, recomandat | `mp_employee_id` |
| `CTC_QC` | proiect | P: „…se numeste in functia de {functie} in cadrul proiectului…” | Responsabil CTC / Responsabil CQ / Responsabil cu Asigurarea Calitatii (AQ) | – | `nu` (D4, închis: fără tip nou în `hr_autorizatii_tipuri`, `autorizatie_tipuri` NULL) | doar view-ul |
| `INSPECTOR_SSM` | **proiect** | P: „…se numeste in functia de {functie} in cadrul proiectului…” | Inspector Sanatate si Securitate in Munca / Responsabil SSM (764) | – | `INSPECTOR_SSM_80` / `_40`, recomandat | doar view-ul |
| `LUCRATOR_DESEMNAT_SSM` (nou, C37; D6) | **firma** | F: „…se numeste in functia de lucrator desemnat privind prevenirea si protectia cat si cadru SSM conform art. 14 si art. 20 din HGR 1425/2006 actualizata prin HGR 955/2010.” (model 16/2026) | – | model_nas | `INSPECTOR_SSM_80` / `_40`, recomandat | doar view-ul |
| `COORDONATOR_SSM` | ambele | P: „…se numeste in functia de Coordonator Sanatate si Securitate in Munca in cadrul proiectului…”. F: „…se numeste in functia de Coordonator SSM conform HGR 300/2006 actualizata.” (model 19/2026) | Coordonator SSM | model_nas | `COORDONATOR_SSM_90`, obligatoriu | doar view-ul |
| `RSVTI` | firma | F: „Incepand cu data de {data_efect}, {titlu} {nume} se numeste in functia de Responsabil cu Supravegherea si Verificarea Tehnica a Instalatiilor (RSVTI)[[, in baza Autorizatiei ISCIR nr. {aut_nr}]][[, valabila pana la {aut_expirare}]], conform {temei}.” (J2-13: fără atestat, cu R1 confirmat, textul rămâne complet) | – | **propunere**: Legea 64/2008 republicată + PT ISCIR. **Nu există model**; de validat juridic → R5 | `RSVTI`, obligatoriu | doar view-ul + G6. v2: `AdeverinteLegator` citește RSVTI din decizia activă |
| `PSI` | ambele | F: „Numirea in functia de {functie} {pe_titlu} {nume} incepand cu data de {data_efect}, conform art. 12 din Legea 307/2006 si art. 13 din Legea 481/2004.” (model 15/2026). P: „…incepand cu data de {data_efect}, in cadrul proiectului „{proiect}”.” | Responsabil PSI / SU | model_nas | `CADRU_TEHNIC_PSI`, recomandat | doar view-ul |
| `MEDIU` | ambele | F: „Numirea in functia de {functie} {pe_titlu} {nume} incepand cu data de {data_efect}, conform art. 2 din Ordinul 175/2005 si art. 94 din OUG nr. 195/2005” (model 6/2026). P: „…, in cadrul proiectului „{proiect}”” | Responsabil de mediu | model_nas | `RESPONSABIL_MEDIU`, recomandat | doar view-ul |
| `RESPONSABIL_DESEURI` (nou, C39; D6) | ambele | F și P: **transcris din modelul 227/2026** (și 194/2022) | Responsabil deseuri / Responsabil gestiunea deseurilor (din model) | model_nas (din model) | `RESPONSABIL_DESEURI`, recomandat | doar view-ul |
| `REVOCARE` | **ambele** (nivelul se copiază din țintă) | vezi §4.D | – | **propunere** → R5 | – | niciunul |
| `ALTA_DECIZIE` (nou, C16d) | ambele | fără șablon (`are_sablon = false`): doar rezervare sau import, cu `descriere` | etichetă liberă | – | nu | niciunul; `unic_activ = false` |

**Total seed: 15 tipuri** (D6): 13 funcții de numire (`RTE`, `RTE_MEC`, `RTS`, `SEF_SANTIER`, `MP`, `CTC_QC`, `INSPECTOR_SSM`, `LUCRATOR_DESEMNAT_SSM`, `COORDONATOR_SSM`, `RSVTI`, `PSI`, `MEDIU`, `RESPONSABIL_DESEURI`), plus `REVOCARE` și `ALTA_DECIZIE`. Cele două din D6 (Lucrător desemnat SSM, model 16/2026, și Responsabil deșeuri, model 227/2026) erau deja numărate în v1.1; răspunsul le confirmă, totalul nu se schimbă.

**Varianta fără atestat (J2-13).** R1 rămâne confirmabil (decizie acceptată); pe RTE și RSVTI, segmentul de atestat e opțional, deci o emitere cu R1 confirmat dă „…se numeste in functia de RTE pentru {domenii} in cadrul proiectului …”, fără număr gol. Cu atestat, textul RTE e identic cu 916 (segmentul începe cu virgula din model; **de confirmat la transcriere** că 916 are virgulă acolo, altfel segmentul începe cu spațiu).

**Valori implicite și note:**
- **`semnatar_implicit_id`:** 121 pe toate cele 15 tipuri (D2c, închis: „Trusu”). La emitere se poate schimba oricând.
- Pe RTE, ce se întâmplă cu domeniile la G2 se decide în client.
- Temeiurile `model_nas` sunt cele folosite în practică, nevalidate juridic. Rămân în `hr_decizii_tipuri` și se schimbă prin migrare după validarea sesiunii juridice, când trec în `validat_juridic`.
- **Faza 2** (au modele pe NAS): Prim ajutor, Instalator EGD/EGT, VT2, decizii colective, centralizatorul SSM–PSI–Mediu.

---

## 6. Generare document

**Funcția și fișierul**
- **O funcție pură, `renderDecizieHtml(continut, snapshot, {nr_afisat, cod_verificare, previzualizare})`,** stă în fișierul nou `src/hrDeciziiDoc.js`. Ea face doar paginarea: textul vine gata randat de server în `continut`.
- Aceeași funcție produce previzualizarea și PDF-ul final. PDF-ul se poate regenera oricând din `continut`.
- Fără librării noi.

**Escaparea (J3-8)**
- `continut` vine de la server ca text simplu; `renderDecizieHtml` îl pune în pagină **doar prin escapare** (`&`, `<`, `>`, `"`, `'`) sau prin noduri text, niciodată prin interpolare brută în `innerHTML`. La fel `snapshot` (nume, proiect, contract, temei) și `nr_afisat`. Faptul că textul vine de la server nu-l face sigur: temeiul, numele proiectului și numărul contractului sunt editabile.
- Singurul markup e cel al șablonului de pagină din `hrDeciziiDoc.js` (antet, blocuri, subsol), scris static.
- Test: testul 69.

**Formatul paginii**
- HTML A4: 794px lățime, Times New Roman, antetul `LOGO_B64` din `src/logo.js` (antetul complet).
- **Înălțimea e fixă: 1123px, raportul A4 exact (C18).**
  - Holder-ul are `height: 1123px; overflow: hidden`, ca `renderHtmlToPdfBlob` (`Achizitii.jsx:123`, imagine pusă pe 0,0,210,297) să nu deformeze.
  - Înainte de emitere se măsoară `scrollHeight` pe conținut, cu numărul-rezervă de lățime maximă (J20). Peste limită se încearcă la 11pt; dacă tot depășește, „Emite” rămâne blocat (B7). **Mărimea aleasă (12 sau 11) se trimite ca `p_font_pt` la `fn_hr_decizie_emite` și se îngheață în `snapshot.font_pt` (Vf8, J2-3)**; face parte din identitatea cererii de emitere (P2-5). Randarea finală o folosește pe aceea, fără să mai aleagă. Formatul F1, cu 4 articole, încape pe o pagină.
  - După emitere, documentul final se măsoară din nou, la `snapshot.font_pt`; un document care depășește nu se urcă (§4.A.4, J20). Pentru că previzualizarea a folosit același font și numărul de lățime maximă, cazul rămâne teoretic (Vf8).
  - Paginarea pe mai multe pagini (`renderContractPdf`) rămâne pentru faza 2.
- **Importul din `Achizitii.jsx`:** `renderHtmlToPdfBlob` se importă de acolo. Dacă la build se vede că importul trage tot modulul Achiziții în chunk-ul HR, se face o copie locală de 15 linii în `hrDeciziiDoc.js`.

**Subsol (C15a)**
- „Cod verificare D{id}-{8 hex} · generat din PontajPRO”, cu codul la **cel puțin 9 pt, gri închis (#444–#555), monospace** (VA28). Trebuie să se citească pe o poză de telefon: un text gri de 6–7 pt, la ~120 DPI, cu JPEG și blur, se confundă ușor (b/6, 8/3).
- E singura abatere de la model și nu intră în comparația de text cu 916.

**Ce e și ce nu e PDF-ul**
- PDF-ul e imagine, fără strat de text, ca în restul platformei. Se acceptă în v1.
- „Regenerare” înseamnă **același text** (`continut`), nu același hash de fișier (C18).

**Hash**
- SHA-256 se calculează în client cu `sha256Hex` din `src/ofertarePachet.js:16-22`, pe blob-ul urcat, atât pentru PDF-ul generat, cât și pentru scan, și se trimite la RPC (VA38). `ofertarePachet.js` e un modul pur, fără importuri [V].
- **Ce garantează hash-ul (P2.1, J21):** e o sumă de control **declarată de cel care urcă**. Serverul validează formatul (64 hex) și verifică obiectul (existență, mime, mărime, uploader), dar nu recitește octeții. În UI și în documente se numește „amprentă declarată la încărcare”, nu „verificat de server”. La fel, `cod_verificare` leagă hârtia de `continut`, nu dovedește că PDF-ul urcat e randat din `continut`. O verificare server-side (edge function care citește obiectul) e candidat pentru v2, cu fișa din CLAUDE.md pct. 7.
- `crypto.subtle` există doar în context securizat (HTTPS sau localhost), iar `sha256Hex` aruncă deja „SubtleCrypto indisponibil (pagina nu e servită pe HTTPS?)”. De aceea testul 37 se face pe deploy-ul Vercel, nu pe `vite --host` deschis de pe telefon prin IP.
- La scanul din poze, hash-ul e al PDF-ului compus, adică al fișierului urcat, nu al pozelor (D5).
- jsPDF pune la fiecare construcție un File ID aleator și data creării [V: `node_modules/jspdf/dist/jspdf.es.js:1349-1359`, `3572-3573`]. Același set de poze, compus de două ori, dă deci alt hash. Retry-ul nu recompune (§4.A.6, VA34).

**Scanul din poze: `pregatestePagina` + `paginiToPdf` (D5, PR2; VA27, VA28)**
- Două funcții noi în `src/hrDeciziiDoc.js`, nu una singură. Fiecare poză se pregătește când e adăugată în listă, iar PDF-ul se compune o singură dată, la „Salvează”.
- `pregatestePagina(file, rot)` → `{dataUrl, w, h}`:
  - decodare cu `URL.createObjectURL` (ca la `PiesePozeSection.jsx:29-40`) și `img.decode()`, nu cu `FileReader` → dataURL, care dublează memoria la poze de 10–25 MB;
  - canvas cu dimensiunile de după rotire (0 / 90 / 180 / 270), fundal alb, max **2400 px** pe latura lungă (fără mărire), JPEG 85%;
  - la final `canvas.width = canvas.height = 0`, din cauza limitei de memorie pentru canvas din Safari pe iOS;
  - ⟳ re-randează din File-ul original, nu din pagina deja comprimată.
- `paginiToPdf(pagini)` → `new File([…], 'semnat_<ts>.pdf', {type: 'application/pdf'})`, cu **o pagină A4 pe imagine, în ordinea primită**:
  - `new jsPDF({unit: 'mm', format: 'a4', orientation, compress: true})`, apoi `addPage('a4', orientare)` pentru fiecare pagină de după prima și `addImage(dataUrl, 'JPEG', x, y, l, h, undefined, 'FAST')`, cu imaginea încadrată centrat, fără deformare;
  - **nu** `unit: 'px'`, ca la `CitesteOricePanel.jsx:148`. În jsPDF 4.2.1, „px” fără hotfix-ul `px_scaling` înseamnă 96/72 pt [V: `node_modules/jspdf/dist/jspdf.es.js:3548-3553`], deci un A4 calculat în px nu iese A4.
- **Rezoluția e mai mare decât la `imageToPdf` (VA28).** Acolo e max 1600 px, JPEG 82% (`CitesteOricePanel.jsx:132`, `:147`), adică ~120 DPI pe o foaie A4 care umple 85–90% din poză. Scanul însă e înregistrarea permanentă a actului semnat, iar codul din subsol trebuie să se citească. La 2400 px se ajunge la ~190 DPI, cât are PDF-ul generat (html2canvas cu scale 2 pe 794 px, `Achizitii.jsx:130`). O pagină are ~0,5–1 MB, deci 10 pagini rămân sub 20 MB.
- Fără librării noi: `jspdf` (4.2.1) e deja instalat și importat la fel ca în `CitesteOricePanel.jsx:19`.
- **Diferențe față de `imageToPdf`, cu motiv:**
  - mai multe imagini într-un singur PDF, în loc de una;
  - fiecare pagină e **A4** (210×297 mm), portret sau peisaj după imagine. Scanul se printează și se compară ca A4, la fel ca decizia generată;
  - **nu există fallback la original:** dacă o imagine nu se poate decoda, funcția aruncă eroare cu numele fișierului și nu întoarce nimic. Bucket-ul primește oricum doar PDF.
- **Metadate:** imaginea redesenată pe canvas și re-encodată nu mai are EXIF, deci nici GPS. Orientarea din EXIF o aplică browserul la decodare (comportamentul implicit în browserele actuale), iar butonul ⟳ acoperă restul cazurilor.
- **Test (VA33).** Calculul așezării pe pagină (`asezareA4(w, h, rot)`: orientare, scară, offset) stă într-un modul **pur** nou, `src/hrDeciziiUtil.js`, fără importuri. Se testează cu `vitest`, după modelul `ctc/ctcUtil.test.js`, iar `hrDeciziiDoc.js` îl importă de acolo.
  - Motivul: `hrDeciziiDoc.js` importă `renderHtmlToPdfBlob` din `Achizitii.jsx`, care importă `src/lib/supabase.js`. Acesta creează clientul chiar la încărcare, iar fără `.env` supabase-js 2.105.3 aruncă „supabaseUrl is required.” [V]. CI-ul rulează `npm test` cu toate testele (`.github/workflows/admin-alerte.yml:28`).
  - Conversia propriu-zisă se testează pe telefon (testul 37).
- `imageToPdf` și copia lui din `HrAngajatNouWizard.jsx:70` nu se ating.

**DOCX: nu în v1.** Un Word editabil scos din platformă rupe imuabilitatea. Pachetul `docx` există dacă va fi nevoie în v2.

**Stocare și legătura cu proiectul**
- Fișierele stau în bucket-ul `hr-decizii` (§3.5).
- Atașarea la proiect se face prin `v_hr_decizii_curente`. Cardul din Echipă afișează „Decizia nr X/dd.mm.yyyy”, cu link semnat la PDF-ul generat. Scanul are link doar pentru `citire_scan`.
- Nu se copiază nimic în `executie-contracte` (C32).

**Cartea tehnică CTC** (pozițiile 11/13/15/16 din template-ul 1): v2, printr-un buton „Pune în cartea tehnică” care copiază fișierul cu `incarcaFisier` (`ctc/ctcDb.js:82`).

---

## 7. UI și drepturi

### HR → tab nou „📜 Decizii”

**Unde și cine vede**
- Codul stă în fișierul nou `src/HrDecizii.jsx`. În `HR.jsx` se adaugă doar o intrare în lista de tab-uri și un rând de render, după modelul `AdeverinteLegator` (`HR.jsx:326`).
- Tab-ul apare doar dacă `fn_hr_decizii_poate('citire')`. **Nu se folosește `canAccessPersonal`** și nici poarta HR, care lasă superadmin-ii să treacă. Azi îl văd Răzvan, Marilena și Natalia (D3).
- **Flag-ul de drept** (de ex. `poateDecizii`) intră și în filtrul tab-urilor, și în dependențele efectului de deep-link de la `HR.jsx:251-254` (VA14, VA30). Azi efectul re-rulează doar pe `[loc.search, isSuperAdmin, canUseScanner, canAccessPersonal, isAdmin]` și setează tab-ul doar dacă e deja în listă [V]. Tab-ul „Decizii” apare însă abia după răspunsul RPC-ului, iar la Natalia `isAdmin` e deja true, deci fără flag linkul ar deschide tab-ul implicit.

**Registru**
- Filtre: an, serie, tip, stare, origine, proiect sau firmă, angajat, semnatar.
- Coloane: nr/data, funcție, persoană, proiect sau firmă, semnatar, stare (cu „nesemnată” pentru `emisa`), mod număr (A/M), PDF, scan ✓, lanț de înlocuire sau revocare.

**Acțiuni**, fiecare vizibilă doar dacă helper-ul de drept o permite:
- Decizie nouă, Previzualizare, Emite, Descarcă, Încarcă scan semnat (cu verificarea alăturată), Înlocuiește, Revocă, Anulează;
- Rezervă număr, Înregistrează decizie existentă (PR4);
- doar owner: Corectează contorul, Înlocuiește scanul.

**„Încarcă scan semnat”, funcțional pe telefon (D5)**
- Un modal comun pentru decizia generată, rezervare, import și înlocuirea scanului, cu cele două moduri din §4.A.6: cu document generat (origine `platforma`) și fără (rezervare, import) (VA5). Fluxul și verificările sunt cele din §4.A.6 și §3.9, pasul 3; la înlocuire trec prin `p_verificari` (VA6).
- Trei intrări:
  - „📷 Fă poză”: `<input type="file" accept="image/*" capture="environment" multiple>`. Pe telefon deschide direct camera și de regulă întoarce o singură poză pe apăsare, chiar cu `multiple`, așa că fiecare apăsare **adaugă** pagini în listă, nu le înlocuiește;
  - „🖼 Din galerie”: `<input type="file" accept="image/*" multiple>`, fără `capture`;
  - „📄 PDF”: `<input type="file" accept="application/pdf">`.
- Sub ele: lista paginilor, cu miniaturi numerotate, ↑ ↓, ⟳ și ✕, apoi previzualizarea din §4.A.6 (pe telefon fără randare de PDF, VA27), bifele de verificare și „Salvează scanul”.
- **Modalul trebuie să meargă la 360 px lățime** (butoane mari, fără tabel lat). Restul registrului poate rămâne gândit pentru desktop.
- Deep-link: `/hr?tab=decizii&scan=<id>` deschide direct modalul pe decizia respectivă. Așa HR deschide pe telefon linkul din „De rezolvat → emise nesemnate” și fotografiază hârtia pe loc. Modelul `?tab=` din `HR.jsx:247-254` nu ajunge singur (VA30):
  - `tab=decizii` merge doar cu flag-ul de drept pus în filtru și în dependențe (mai sus);
  - `scan=<id>` se tratează în `HrDecizii.jsx`, după ce s-au încărcat dreptul `scan` și decizia. Dacă decizia e `emisa`, se deschide modalul, iar `scan` se scoate din URL cu `navigate(…, {replace: true})`, ca să nu se redeschidă la refresh. Dacă e deja `semnata` sau `anulata`, apare „deja semnată de X la Y”, fără modal;
  - un utilizator nelogat ajunge înapoi pe același link după login, pentru că login-ul păstrează search-ul (`App.jsx:1156`) [V].
- Butonul apare doar dacă `fn_hr_decizii_poate('scan')` (azi Natalia, Marilena, tu). Pentru înlocuirea scanului: `owner`.

**Antetul anului:** contorul („ultimul nr: 916 · automat: oprit / pornit din 07.10 de X”) și butonul „Pornește numerotarea automată”. Lângă el, emitenții actuali, din `fn_hr_decizii_emitenti` („Emit: Trusu, Tudorache (owner), Udrea (HR)”), ca orice mutare în departamentul HR să se vadă (VA21).

**Istoric pe decizie:** evenimentele din `hr_decizii_evenimente`, cu confirmările de avertismente și verificările de scan.

**„De rezolvat”** (C45):
- emise nesemnate de peste 7 zile;
- propuneri de efect neconfirmate (`hr_decizie_id` cu status `propus`);
- importuri fără scan;
- goluri în registru (după inițializare);
- G6: RSVTI din decizia activă ≠ 81.

### Execuție → dashboard proiect → Echipă (`Executie.jsx:3084-3134` pe `origin/main` d71da84 [V]; în v1.1 era 3074-3124)

**Carduri de rol**
- Pe fiecare card de rol (RTE, RTS, MP, Șef șantier) apare una dintre etichete:
  - „Decizia nr X/data”;
  - „nesemnată”;
  - „⚠ fără decizie”;
  - „⚠ echipa ≠ decizia activă” (C10): echipa are altă persoană decât decizia activă;
  - „⚠ decizie revocată, echipa îl are încă pe X”.
- **Cardurile se leagă de decizii pe `tip_cod`** (`RTE`, `RTS`, `MP`, `SEF_SANTIER`), **nu pe `camp_efect`** (VA9). `camp_efect` e NULL la `SEF_SANTIER` până la PR5, ca la `RTE_MEC`, care merge în „Echipă extinsă”: o legare pe `camp_efect` ar lăsa cardul șefului de șantier fără etichetă.
- Coloana șefului de șantier există de la 20261017a [V], deci cardul lui primește etichetele de la PR3 (C40). Doar propunerea automată de efect pe el așteaptă PR5; deciziile semnate între timp primesc propunerea la PR5, prin backfill (§10).
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
- Scanul de pe telefon (D5) nu schimbă asta: pozele se procesează integral în browser (canvas și jsPDF), fără server, AI sau OCR. Nimeni și nimic nu „citește” conținutul scanului, în afară de omul care bifează verificarea.
- Dacă în faza 2 apare OCR sau AI pe deciziile vechi, intră conținut extern și e nevoie de fișă, plus poarta de confirmare.

**Drepturile noi apar doar la apply-ul PR1, pe listele aprobate de tine; niciun rând nou în `user_module_access` (D3, VA11).**
- Natalia trece prin `department = 'HR'`, iar Marilena și tu, prin owner (§3.3).
- Preview-ul de la apply listează nominal, calculate cu același predicat, emitenții (așteptat exact {121, 125, 126}) și cititorii noi: `citire`, plus `citire_doc` și `citire_scan` pe deciziile de numire pe proiect (C31). Apply-ul se face doar cu OK-ul tău pe toate listele (VA1, VA22).
- **Departamentul HR e drept din PR1 (VA10, VA21).** Orice mutare a unui profil în sau din „HR” e acordare sau retragere de drept, deci se face doar cu preview și OK-ul tău (CLAUDE.md pct. 3), indiferent de unde vine: Admin → Manageri (o poate face orice owner) sau un tichet. La livrare: lecție `anti_bug` în `claude_context` și propunerea de a trece `department` în lista din CLAUDE.md pct. 3.
- Orice `hr.decizii` ulterior: nominal, cu acordul tău explicit, pe persoană, ca migrare (`app_modules` + `user_module_access`). PR1 nu inserează cheia în `app_modules` (VA24).

**Scanul din poze (D5)**
- Bucket-ul primește doar PDF (`allowed_mime_types`), max 20 MB, și n-are nici UPDATE, nici DELETE (§3.5).
- Aplicația nu urcă pozele originale, iar EXIF/GPS nu trec în PDF (§2.10).
- Dreptul de urcare rămâne `scan` (owner sau hr), atât în RPC, cât și în politica de storage pentru `semnat_*` (VA8). Telefonul nu deschide un drum nou: aceeași sesiune, aceleași RPC-uri, aceleași politici.
- **Risc rezidual nou (D5), semnalat, neacoperit de D7 (VA13):** pot rămâne copii ale deciziilor semnate (semnătură, ștampilă, date personale) pe telefoanele emitenților și în backup-ul lor personal: pe calea „Din galerie” și, pe unele telefoane Android, și pe „Fă poză”. Platforma nu le urcă, dar nici nu le controlează. Atenuare: „Fă poză” e calea recomandată, ecranul cere ștergerea pozelor după salvare, iar testul 37 verifică ce rămâne în galerie.

**Integritatea registrului (v1.3)**
- **`service_role` fără scriere directă** pe cele cinci tabele ale registrului (P0-1, J16): doar SELECT. Abatere conștientă de la „regula casei” (GRANT `service_role` pe obiectele noi): un registru oficial nu trebuie să poată fi rescris de cheia de serviciu ocolind alocarea, emiterea și jurnalul. Dacă apare o automatizare care trebuie să scrie, primește EXECUTE pe un RPC dedicat, cu verificare de rol, nu drept pe tabel.
- **TRUNCATE** e retras de la toate rolurile API, iar jurnalul are trigger BEFORE TRUNCATE (J17).
- **Propunerile pe echipă** nu mai pot fi fabricate prin INSERT direct (J5): politica nouă exclude rândurile cu `hr_decizie_id`, iar `fn_completare_aplica` reverifică legătura. Schimbarea atinge un RPC existent, deci intră explicit în OK-ul pe PR1.
- **Risc rezidual delimitat (J17):** cheia `service_role` poate șterge sau suprascrie obiecte din bucket-ul `hr-decizii` prin Storage API (politicile nu o opresc). Nimic din v1 nu folosește cheia pe acest bucket; cheia stă doar în secretele edge și în scripturile owner-ului (vezi `registru_automatizari`). Detectare: `scan_path` fără obiect sau amprentă diferită la o eventuală verificare v2.
- **Hash-urile sunt declarate**, nu verificate de server (P2.1, J21; §6).
- **Emiterea e consistentă (P2-1, J2-5):** documentul emis e exact cel previzualizat, pe intrările citite o singură dată sub lock; confirmarea efectului e serializată cu înlocuirea/revocarea (J2-4).
- **Randarea nu interpretează date ca markup sau șablon (J3-8):** substituție într-o trecere pe server, escapare la randarea HTML.
- **Revocarea nu golește echipa singură (P3-2):** propune golirea; confirmarea e umană și verifică valoarea curentă.
- **Excepția `_hr_azi()` (J2-1):** singura funcție `_hr_*` cu EXECUTE pentru `authenticated`; nu citește date.

**Igiena obiectelor noi**
- Funcțiile sunt SECURITY DEFINER, cu `search_path` fix, REVOKE de la PUBLIC și anon și verificare de drept în cod, fail-closed (`IS NOT TRUE` → 42501, VA16). Funcțiile interne `_hr_*` nu au EXECUTE pentru authenticated, cu excepția `_hr_azi()` (J2-1). `fn_hr_decizii_id_din_cale` are EXECUTE, pentru că rulează în politici, dar e IMMUTABLE și nu citește date (§3.5).
- Tabelele au RLS pe `auth.uid()` plus drept, nu `USING(true)`, și GRANT pe coloane la `hr_decizii`.
- View-ul e `security_invoker`.
- După apply se rulează `get_advisors`.

**Livrare**
- Migrarea se livrează prin `scripts/livrare_migrare.sh`, cu rollback în `supabase/revenire/`.
- Înainte de apply e nevoie de GO de la Copilot, căruia i se trimite efectiv diff-ul SQL, și de OK-ul tău.
- Seed-ul (tipuri și semnatari) e inserare de date: se face după ce vezi preview-ul.

**Riscuri acceptate de Răzvan pe 06.10.2026 (D7: „e ok așa”).** Rămân ca atare în v1, fără a doua confirmare pe R1/R2:
- **Doi owneri (121 și 125)** pot emite, își pot confirma singuri avertismentele roșii, pot aplica efectul pe echipă și sunt și semnatari. Nu există a doua pereche de ochi pe aceste lanțuri (C35).
  - **Consecință dedusă din D2a + D7, ți-o semnalez (VA12, VA25):** Marilena (125) poate emite o decizie semnată de ea ca împuternicit și își poate confirma singură R4, adică avertismentul despre propria împuternicire. D7 s-a dat pe textul v1.1, când calitatea ei era încă întrebare (C26), dar întrebarea D7 a propus explicit „R confirmat doar de alt utilizator decât cel care emite”, iar răspunsul a fost „e ok așa”. De aceea nu o repun ca întrebare nouă. Dacă vrei totuși altfel, varianta e: R4 pe propria semnătură se confirmă doar de alt emitent.
  - Aceeași regulă pentru orice emitent: și Natalia își confirmă singură R1–R7 (D7: fără a doua confirmare) (VA25).
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

Răspunsurile din 06.10.2026 seara (`claude_context` #1622):

**D1 = A: registrul platformei e registrul HR comun.** Răzvan: „da”.
- Numirile se generează. Celelalte decizii HR, făcute încă în Word, își rezervă numărul aici (`ALTA_DECIZIE`).
- Unde: §0, §1 (NAS), §4.F (regula de tranziție, fără condiție). §4.G a rămas neschimbat (VA15).
- Consecință (VA7): în registru intră și deciziile HR sensibile, ca `ALTA_DECIZIE`, deci acestea le văd doar owner-ii și HR (§2.10, §3.3).
- Cu Natalia rămân de verificat doar resetarea anuală și seria din 2024 (la „De verificat”).

**D2: semnatarii.** Răzvan: (a) „Trusu este”, (b) „Pentru Marilena si Pantea”, (c) „Trusu”.
- (a) Reprezentant legal e doar Trușu (121). Tudorache (125) nu e: semnează pe împuternicire, ca Pantea (90). Întrebarea ONRC (C26) e închisă.
- (b) Se fac împuterniciri scrise pentru Tudorache și Pantea. Până se înregistrează (nr., dată, scan) și se validează preambulul, rămâne R4 confirmabil.
- (c) Semnatarul implicit e 121 pe toate cele 15 tipuri.
- Unde: §0, §1, §2.9, §3.1 (seed-ul semnatarilor), §3.4, §4.A (B1, R4), §4.F (rezervarea numirilor, VA17), §5.1, §5.3, testele 23, 34–35.

**D3: emit Natalia și Marilena.** Răzvan: „Natalia si Marilena”.
- Natalia (UDREA NATALIA ELENA, 126) trece prin `department = 'HR'`. Marilena (125) și tu treceți ca owneri. Superadmin nu intră.
- Encodat ca B′ din v1.1: `department = 'HR'` pentru Natalia, owner pentru Marilena (VA10). Consecința: din PR1, mutarea unui profil în departamentul HR e acordare de drept și cere OK-ul tău (§3.3, §8).
- În v1 nu se creează niciun rând `hr.decizii`, iar cheia nu intră în `app_modules` (VA24). Dreptul lui Natalia apare la apply-ul PR1, cu listele exacte în preview (emitenți și cititori, VA1, VA22) și OK-ul tău explicit (CLAUDE.md pct. 3).
- Avertizarea despre prefixul `hr.decizii` → ruta `/hr` rămâne pentru orice acordare ulterioară.
- Unde: §0, §1 (emitenții), §3.3, §3.6, §7, §8, testele 25–27, 36, 41.

**D4 = A: CTC-QC fără atestat obligatoriu în v1.** Răzvan: „da”.
- Fără tip nou în `hr_autorizatii_tipuri`.
- Unde: §0, §1 (atestate), §5.3, testul 39.

**D5 = A, plus scan de pe telefon.** Răzvan: „momentan Da pune functia de scan si de pe telefon cu poza”.
- Fără semnătură electronică în v1 (print → semnat de mână → scan). Se poate redeschide în v2.
- Cerință nouă: scanul semnat se urcă și de pe telefon, din poze făcute cu camera. Pozele se unesc în browser **într-un singur PDF**, în ordinea paginilor (`pregatestePagina` + `paginiToPdf`, PR2). Verificarea „generat vs. scan” rămâne umană, cu bifa nouă `lizibil`. Fără OCR, AI sau îndreptare automată.
- Unde: §0, §1 (cod), §2.10–11, §3.5, §3.9, §4.A.6, §4.E, §4.F, §6, §7, §8, testele 37–38.

**D6: intră ambele funcții.** Răzvan: „ambele”.
- Responsabil deșeuri (C39, model 227/2026) și Lucrător desemnat SSM pe firmă (C37, model 16/2026), câte un rând de seed fiecare.
- Erau deja numărate în seed-ul v1.1, deci totalul rămâne 15 tipuri (13 numiri + `REVOCARE` + `ALTA_DECIZIE`).
- Unde: §0, §3.1, §5.3, testul 39.

**D7: riscurile din §8 sunt acceptate ca atare.** Răzvan: „e ok asa”.
- Owner-ii își pot confirma singuri avertismentele roșii, iar superadmin-ii pot scrie atestate. Fără a doua confirmare în v1.
- Unde: §8.

### Deschise

Nicio decizie nu mai blochează PR1–PR5. Au apărut trei întrebări mici: două din răspunsuri, una din verificarea adversarială. Niciuna nu blochează; implementarea pornește pe recomandare.

**v1.5:** în runda 3, **Copilot a dat GO DESIGN pe 42258b1** pentru PR1 (nu GO APPLY): fără P0, fixurile rundei 2 închise; a cerut concretizarea a două P1 (P3-1, P3-2) înainte de GO pe migrare, ambele aplicate în v1.5. A confirmat din nou **D8 = A, D9 = A (condiționat juridic), D10 = B și D11 = A**. Toate rămân **de confirmat de Răzvan**. Jakarinos a dat NO-GO pe aceeași versiune (J3-1 blocant); constatările sunt aplicate în v1.5.

**v1.4:** în runda 2, Copilot a confirmat din nou **D8 = A, D9 = A, D10 = B și, nou, D11 = A** („niciuna dintre recomandări nu mi se pare greșită”; D9 = A condiționat de natura juridică a împuternicirii). Toate patru rămân **de confirmat de Răzvan**; spec-ul și PR-urile merg pe ele.

**v1.3:** Copilot a confirmat recomandările pe D8, D9 și D10. Rămân **recomandări confirmate de Copilot, de confirmat de Răzvan**; PR-urile pornesc pe ele, iar schimbarea ulterioară e locală (predicat sau o coloană).

1. **D8 = A (recomandat, confirmat de Copilot, de confirmat de Răzvan). Cine urcă scanul semnat (de pe orice dispozitiv)** (din D3 + D5). Copilot: „least privilege”; semnatarul nu primește drept de scriere în registru doar fiindcă semnează.
   - **A:** doar emitenții (Natalia, Marilena, tu), adică dreptul `scan` de azi.
   - **B:** și semnatarul care a semnat (de ex. Pantea), ca să fotografieze hârtia imediat după semnare.
   - **Recomand A.** Hârtia semnată ajunge oricum la HR pentru dosar, iar B ar da unui om din afara HR un drept de scriere în registrul oficial. PR3 se face pe A. Pe B se schimbă doar predicatul `scan`, pe care îl folosesc deja și RPC-ul, și politica de storage pentru `semnat_*` (VA8).
2. **D9 = A, cu `imputernicire_decizie_id` FK și snapshot la emitere (recomandat, confirmat de Copilot, de confirmat de Răzvan). Împuternicirile lui Pantea și Tudorache primesc număr în registrul HR?** (din D1 + D2b). Copilot condiționează A de natura juridică: dacă sesiunea juridică confirmă că împuternicirea se emite ca decizie internă, A e varianta curată; altfel B.
   - **A:** da. Dacă împuternicirea se face ca decizie a administratorului, își ia numărul din platformă (`ALTA_DECIZIE`, „Rezervă număr”) după PR3, sau intră la import (PR4) dacă se semnează înainte.
   - **B:** nu, e act separat (mandat), fără număr în registrul HR.
   - **Recomand A**, pentru că registrul e comun (D1). Pe A, scanul împuternicirii trece prin modalul obișnuit (inclusiv din poze), iar semnatarul are **`imputernicire_decizie_id`** (FK la decizie, P1-4), nu o cale copiată: nr., data și scanul curent se derivă din decizie, iar `snapshot`-ul deciziei emise păstrează exact ce era valabil la emitere. Bucket-ul n-are folder separat (§3.4). Pe B, PR3 primește în plus o intrare owner-only „Încarcă împuternicire” în același modal, cu calea `semnatari/<employee_id>/imputernicire_<ts>.pdf`, regex-ul din §3.5 extins și un test (VA4).
   - În ambele variante, R4 dispare doar când formula din §4.A.2 devine falsă: împuternicire înregistrată (nr., dată, scan), datată cel târziu la data deciziei, plus preambul validat (VA2).
3. **D10 = B (recomandat, confirmat de Copilot, de confirmat de Răzvan). Contul de serviciu „Claude” și scanurile semnate** (verificarea adversarială, VA22; CLAUDE.md pct. 3). Copilot: contul de serviciu n-are nevoie de specimenul de semnătură; `are_fisa` e o limitare fail-closed rezonabilă.
   - Contul „Claude” (IT, fără fișă de angajat, `can_manage_contracts`) [V] ar trece `confirm`, deci ar citi scanurile semnate ale deciziilor pe proiect (specimen de semnătură și ștampilă).
   - **A:** rămâne ca la contracte: vede și scanurile.
   - **B:** conturile fără fișă de angajat nu văd scanurile pe ramura `confirm` (condiția `are_fisa` din `citire_scan`). PDF-ul generat rămâne vizibil prin `exec`, iar confirmarea efectului prin `fn_completare_aplica` rămâne neschimbată.
   - **Recomand B.** Un cont de serviciu n-are nevoie de specimenul de semnătură, iar un drept nou se dă doar cu acordul tău explicit. PR1 se face pe B; A înseamnă doar scoaterea condiției `are_fisa`.

4. **D11 = A (recomandat, confirmat de Copilot în runda 2, de confirmat de Răzvan) (Vf5). Cum se retrage o împuternicire?** J18 interzice revocarea/înlocuirea unei `ALTA_DECIZIE` prin registru.
   - **A (recomandat, aplicat în spec):** migrare de date `imputernicire_decizie_id = NULL` (preview → OK Răzvan); R4 revine imediat. Fără excepție în reguli.
   - **B:** excepție la J18 pentru `ALTA_DECIZIE` referită din `hr_decizii_semnatari`, revocabilă prin generator, vizibilă doar owner + HR. Mai multă logică, mai multe teste.

### De verificat (nu sunt decizii)
- RTE MEC = `RTE_MONTAJ_IT`? Ord. 364/2010 e temeiul corect?
- Temeiurile pentru RSVTI și REVOCARE, plus preambulul și blocul de semnătură ale împuternicitului (sesiunea juridică).
- Textul împuternicirilor pentru Pantea și Tudorache (sesiunea juridică), apoi înregistrarea lor prin migrare de date (D2b).
- Emitentul RTS e ISCIR, nu MDLPA? Corectura se face în `hr_autorizatii.emitent` pe înregistrări, pentru că decizia preia emitentul de acolo.
- Formatul `{contract}`, `{nume}` și spațierea, prin comparație cu PDF-ul 916. Transcrierea literală a preambulului 916.
- Numerele date după 28.09.2026 în registrul fizic, înainte de inițializarea lui 2026.
- Cu Natalia: se resetează registrul anual? Ce e seria din 2024 (298 în octombrie, după 368 în iulie)? Faptul că registrul e comun nu mai e întrebare (D1).
- Scanul pe telefoanele reale ale emitenților (Android și iPhone): camera, HEIC, orientarea, mărimea PDF-ului, ce rămâne în galerie (D5, VA13).
- Natura juridică a împuternicirilor (decizie internă sau mandat) — de ea depinde D9 (Copilot, v1.3).
- Numirile pentru colaboratori externi: 14 din 20 de atestate RTE sunt pe externi. v1 generează doar pentru angajați; externii intră doar prin import sau rezervare.

---

## 10. Ordinea PR-urilor și testele de acceptare

| PR | Conținut | Dependențe |
|---|---|---|
| **PR1** | Migrare (nume la livrare, următorul prefix liber):<br>– 5 tabele noi și coloana `executie_completari_propuse.hr_decizie_id`;<br>– view, bucket `hr-decizii` cu politici, **doar PDF, max 20 MB** (D5), **fără UPDATE și fără DELETE** (VA19), `fn_hr_decizii_poate` (fail-closed, VA16), `_hr_decizii_termeni`, `fn_hr_decizii_id_din_cale` (VA23), `_hr_decizii_aloca`, `_hr_decizie_avertismente`, `_hr_decizie_randeaza` și RPC-urile din §3.6;<br>– triggere, RLS, GRANT pe coloane;<br>– seed: **15 tipuri** (13 numiri + `REVOCARE` + `ALTA_DECIZIE`; textele transcrise din modelele NAS; `semnatar_implicit_id` = 121 pe toate, D2c; `CTC_QC` fără atestat, D4; `SEF_SANTIER` cu `camp_efect` NULL [V]) și **3 semnatari** (121 reprezentant legal; 90 și 125 împuterniciți, cu preambul literal pe persoană, fără împuternicire înregistrată, D2, VA3).<br>PR1 **nu** inserează `hr.decizii` în `app_modules` (VA24).<br>**v1.3:** fără scriere `service_role` pe registru (P0-1); UNIQUE comun pe țintă + CHECK (P0-2); `_hr_decizii_aloca` cu sufix (P0-3); R3 pe server (`_hr_acopera_domeniu`, P1-1); `imputernicire_decizie_id` (P1-4); SELECT pe semnatari doar `citire` (P1-2); `cerere_id` (P1-3); `_hr_azi()` (P2.2); **schimbarea politicii `completari_ins` și a `fn_completare_aplica`** (J5, RPC existent: OK explicit)<br>**v1.4:** `_hr_decizie_intrari` + `_hr_decizie_mod` (P2-1, J2-2, J2-5); `p_font_pt` și `cerere_emitere_hash` (J2-3, P2-5); ordinea de lock în `fn_completare_aplica` (J2-4); EXECUTE pe `_hr_azi()` (J2-1); view-ul `v_hr_decizii_curente` (P2-4); alocator exact la import (P2-2); `inlocuieste_scan` cu baseline + `cerere_id` (P2-3, J2-7, J2-8); formula contorului (J2-6); șabloanele cu segmente opționale de atestat, termen și înlocuire (J2-11–13)<br>**v1.5:** `previzualizeaza(p_id, p_numar)` (J3-1); `_hr_acopera_domeniu` pur + `_hr_decizie_context` (P3-1, J3-2); propunerea de golire la revocare în `ataseaza_scan` și `fn_completare_aplica` + politica `completari_ins` (P3-2, RPC existent: OK explicit); UNIQUE pe `cerere_emitere` (P3-3); ordinea semnatar → împuternicire (J3-3); limitele și lock-ul contorului (J3-4); R5 pe articolele condiționale (J3-5); ținta canonică și titlul opțional (J3-6, J3-7); substituție nerecursivă (J3-8)<br>Plus rollback și teste SQL în `supabase/tests/hr_decizii.test.sql`, după modelul `conturi_ciclu_viata.test.sql` | **Nu mai e blocat de decizii:** D1, D3 și D6 sunt răspunse (06.10 seara). Apply doar cu OK-ul tău pe cele patru liste de drept din preview (emitenți, așteptat 121, 125, 126; `citire`; `citire_doc` și `citire_scan` pe proiect; D3, VA1, VA22) și cu GO de la Copilot |
| **PR2** | `src/hrDeciziiDoc.js`: `renderDecizieHtml` (cu escapare, J3-8), paginare A4 fixă, verificarea de depășire, PDF cu `LOGO_B64`, subsol cu cod lizibil pe poză (≥ 9 pt, VA28), hash cu `sha256Hex` (VA38)<br>+ **`pregatestePagina` + `paginiToPdf`** (poze → un PDF, o pagină A4 pe imagine, în `mm`, max 2400 px, în ordine, fără EXIF; D5, VA27, VA28)<br>+ `src/hrDeciziiUtil.js`, modul pur cu `asezareA4` și testul vitest (VA33) | PR1 aplicat |
| **PR3** | `src/HrDecizii.jsx` (registru, decizie nouă, emitere, scan cu verificare, anulare, înlocuire, revocare, **contor și inițializare, rezervare** cu B1/R4 la numiri, „De rezolvat”, emitenții în antet)<br>+ **modalul de scan funcțional pe telefon** (cameră, galerie, PDF; listă de pagini; două moduri, cu și fără document generat; fără randare de PDF pe telefon; 360 px; deep-link `?tab=decizii&scan=<id>` tratat în `HrDecizii.jsx`; D5, VA5, VA27, VA30)<br>+ tab-ul în `HR.jsx`, cu flag-ul de drept în filtru și în dependențele deep-link-ului (VA30)<br>+ cardurile Echipă (inclusiv Șef de șantier), legate pe `tip_cod` (VA9), și „Generează decizie” în `Executie.jsx`<br>+ panoul „Completări propuse” cu bucket-ul corect | PR2. **Merge-ul sef-santier e făcut** [V]: `origin/main` = d71da84 (#629). PR3 pornește din `origin/main` și recitește `Executie.jsx:3084-3134` (Echipă) și ~:706 (panoul) |
| **PR4** | Ecranul „Înregistrează decizie existentă” (serii HR și carte tehnică, sufix, combinate, externi), cu același modal de scan (și de pe telefon)<br>+ importul seriei Mironu 911–916 (date reale: preview → OK → apply) | PR3 |
| **PR5** | Activarea efectului pe `SEF_SANTIER`: `camp_efect = 'sef_santier_employee_id'` pe tip + extinderea whitelist-ului din `fn_completare_aplica`<br>+ **backfill** (date reale: preview → OK-ul tău → apply): propuneri pentru deciziile `SEF_SANTIER` pentru care `_hr_decizie_eligibila_efect` e true (deci și `propune_efect = true`, angajat nu extern, neexpirate, proiect activ, B1 trecut, J9), fără propunere, când echipa are altă persoană. Efectul se calculează doar la scan, deci altfel ar rămâne pentru totdeauna doar cu eticheta „⚠ echipa ≠ decizia activă” (VA9) | **`20261017a` e aplicată** [V] (v20261006141500), deci rămâne doar acordul tău (schimbare de RPC). După PR5, revenirea 20261017a refuză până se revine întâi PR5 (garda pe corpurile funcțiilor, `ROLLBACK.sql:58-61`) |

### Teste de acceptare

**Numerotare**
1. Două emiteri automate în același an primesc numere consecutive diferite. Contorul nu sare și nu se dublează (test de concurență cu două sesiuni).
2. Un număr manual ocupat dă eroarea „nr X/an e folosit de decizia #id”.
3. Manual 950/2026 duce `ultimul` la 950; următorul număr automat e 951.
4. Manual 762/2026 (liber, sub contor) e acceptat, iar contorul rămâne neschimbat. Un număr automat ulterior sare peste numerele manuale ocupate.
5. Pe un an neinițializat, numărul automat e refuzat cu mesaj clar; numărul manual merge. După `contor_initializeaza(2026, 916, …)`, numărul automat dă 917.
6. Manual 9160 fără confirmare dă eroarea „salt_mare”; cu confirmare trece. `contor_corecteaza` făcut de un utilizator non-owner e refuzat. Făcut de owner, sub `max(numar)` neanulat, e refuzat. **Concurență (J3-4):** corectarea și o emitere în același an, intercalat, în ambele ordini: contorul nu coboară niciodată sub un număr comis. Limite: `contor_initializeaza` / `contor_corecteaza` cu -1, 100000, NULL sau an viitor → refuz; contor la 99999 + număr automat → „registru epuizat”, fără scriere. După anularea lui 9160 și corecție, numărul automat continuă de la valoarea corectată și sare peste 9160 când ajunge acolo.
7. `data_emitere` în viitor e refuzată. Data de 30.12 a anului trecut, emisă în ianuarie, cere număr manual plus confirmarea R6. **Fluxul complet (J3-1):** draft pe anul trecut → `previzualizeaza(p_id)` fără număr → B3 și `continut` NULL; `previzualizeaza(p_id, 950)` → `continut` randat (B7 verificabil), R6 în listă; `emite(…, p_numar = 950, R6 confirmat)` → reușește. Cu 950 deja ocupat → B8 la previzualizare.

**Imuabilitate și ocolire** (C6, C33)

8. Ca redactor, prin API direct:
   - INSERT cu `stare = 'semnata'` / `origine = 'import'` / `numar` / `creat_de` străin → refuz (GRANT pe coloane sau WITH CHECK);
   - UPDATE pe un draft către `stare = 'emisa'` → refuz;
   - UPDATE sau DELETE pe o decizie emisă → refuz, inclusiv ca `service_role`.
9. Un draft se creează, se modifică și apoi se șterge de creator (sau de owner), dar nu de alt redactor. După ștergere, jurnalul păstrează `creare`, `modificare_draft` și `stergere_draft` cu același `decizie_id` (J1). Jurnalul nu se poate modifica, șterge sau trunchia de nimeni din API (J17).

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
23. Rezervare cu număr automat după inițializare: numărul intră în registru. Scanul ulterior o trece în `semnata`. O rezervare de numire cu scan produce propunere de efect. În plus (VA5, VA17):
    - rezervare RTE pe Pantea, cu semnatar Pantea → B1, refuz;
    - rezervare de numire pe altcineva, semnată de Tudorache fără împuternicire → cere confirmarea R4, salvată în `avertismente`;
    - rezervare de numire fără semnatar → refuz;
    - scanul unei rezervări se verifică în modul „fără document generat” (fișa din registru, fără cod, cu bifa `semnatar`).

**Drepturi și storage** (C24, C25, C30, C31)

24. Un superadmin fără departament HR și fără `hr.decizii` (de ex. Pantea) nu vede tab-ul și nu poate emite prin RPC.
25. Un editor `hr` din Ofertare nu poate redacta, emite, rezerva, importa sau urca scan (D3 = B′, închis). Ce vede vine doar din `exec` / `confirm`, adică deciziile de numire pe proiect (VA1; vezi și testul 36).
26. Un editor `executie`:
    - vede deciziile de numire pe proiect și PDF-ul lor generat;
    - nu vede deciziile pe firmă și nici `ALTA_DECIZIE` legate de un proiect (VA7);
    - nu poate descărca scanul semnat (`semnat_*`).
27. Un utilizator `can_manage_contracts` vede scanul unei decizii de numire pe proiect (ca să confirme), dar nu și pe al uneia pe firmă sau al unei `ALTA_DECIZIE` legate de proiect (VA7). Contul de serviciu „Claude” (fără `employee_id`) nu vede scanul (D10 = B).
28. Un utilizator doar-HR nu poate confirma efectul (`fn_completare_aplica` → „fără drepturi”).
29. `seteaza_pdf` repetat cu aceeași cale și același hash → ok. Cu altă cale → eroare. Pe lângă asta:
    - UPDATE în bucket → refuz; DELETE în bucket → refuz pentru oricine, **inclusiv owner** (VA19);
    - `seteaza_pdf`, `ataseaza_scan` sau `inlocuieste_scan` pe o cale fără obiect în storage, cu alt mimetype sau pe un obiect urcat de alt utilizator → refuz (VA20);
    - `inlocuieste_scan` cu aceeași cale ca `scan_path` sau fără `p_verificari.lizibil = true` → refuz; verificările noului scan apar în evenimentul `scan_inlocuit`, iar fișierul vechi rămâne în bucket (VA6, VA19);
    - un nume de fișier care nu respectă regex-ul din §3.5 (de ex. `HR/2026/x/semnat_1.pdf`) e refuzat la INSERT, iar listarea altor bucket-uri nu dă eroare (VA23).

**Document** (C18)

30. Textul randat de `_hr_decizie_randeaza` pentru datele lui 916 e identic cu transcrierea lui 916; comparația se face pe text, fără subsol. Regenerarea din `continut` dă același text.
31. PDF-ul are o pagină A4 nedeformată: canvas-ul are raport 794:1123. Un conținut prea lung dezactivează „Emite” (B7).
32. Variantele de gen: „Dl./D-na”, „pe domnul/pe doamna”, „numit/numita” ies corect pe PSI F și pe RTE P.

**Build și advisori**

33. `npm install` și `npx vite build` trec. `grep -n` confirmă că numele noilor funcții există. `get_advisors` nu dă avertismente noi.

**Răspunsurile v1.2 și faptele noi** (D2–D6)

34. **Semnatarul implicit (D2c).** Seed-ul are `semnatar_implicit_id` = rândul lui 121 pe toate cele 15 tipuri. Un draft nou, pe oricare tip, vine precompletat cu 121, iar emiterea fără schimbare are preambulul lui Trusu.
35. **Tudorache împuternicit (D2a/b).**
    - Seed: 125 are `este_reprezentant_legal = false`, iar singurul reprezentant legal e 121.
    - Tudorache semnatar pe numirea altcuiva, fără împuternicire înregistrată → R4. Emiterea merge doar cu confirmare, iar preambulul din `continut` e cel de împuternicit, nu cel al lui 121.
    - Tudorache semnatar pe propria numire → B1, emitere blocată.
    - Pe D9 = A, împuternicirea intră în registru ca `ALTA_DECIZIE` (rezervare sau import, apoi scan prin modal), iar migrarea de date setează doar `imputernicire_decizie_id` (VA4, P1-4); nr., data și scanul se derivă din decizie.
    - După înregistrarea împuternicirii și `preambul_validat = true`, R4 nu mai apare, iar segmentul „prin Imputernicirea nr. …” intră în text. Cu împuternicirea datată după `data_emitere`, sau cu `preambul_validat = false`, R4 rămâne (VA2).
    - Preambulul randat pentru 125 scrie „D-na TUDORACHE MARILENA CLAUDIA, imputernicita”, indiferent de genul persoanei numite (VA3).
36. **Emitenții (D3).**
    - Preview-ul de la apply-ul PR1: emitenții (`owner` / `hr`) sunt exact 121, 125 și 126. Listele `citire`, `citire_doc` și `citire_scan` pe proiect se văd nominal, calculate cu `_hr_decizii_termeni` (VA1, VA22).
    - Natalia (126: `department = 'HR'`, fără `hr.decizii`) vede tab-ul, redactează, emite, rezervă și urcă scanul. Marilena (owner) la fel.
    - Un profil sintetic cu cheia `hr` (editor), fără `department = 'HR'`, fără `hr.decizii`, fără `executie` și fără `can_manage_contracts`: nu vede tab-ul, RPC-urile îi răspund „fără drepturi”, iar SELECT pe `hr_decizii` și pe bucket îi întoarce 0 rânduri (VA1).
    - Caz separat, `hr` + `executie` (ca 98, Contabilitate): vede doar deciziile de numire pe proiect, fără draft-uri, decizii pe firmă, `ALTA_DECIZIE` sau scanuri (VA1, VA7).
    - Un utilizator non-owner care își schimbă singur `department` în „HR” e refuzat de triggerul existent (`fn_profiles_campuri_owner_only`).
    - După PR1, cheia `hr.decizii` nu există în `app_modules` (VA24).
37. **Scan din poze pe telefon (D5)**, pe Android (Chrome) și iPhone (Safari), pe deploy-ul Vercel (HTTPS), nu pe `vite --host`, unde `crypto.subtle` lipsește (VA38):
    - două poze făcute pe rând cu „📷 Fă poză”, apoi inversate cu ↑ ↓ → **un singur** `semnat_<ts>.pdf`, cu 2 pagini A4 reale (210×297 mm), în ordinea finală din listă (VA27);
    - o poză rotită cu ⟳ iese dreaptă în PDF;
    - PDF-ul nu conține EXIF/GPS (verificat cu un cititor de metadate);
    - codul D{id}-xxxx se citește pe scanul compus (VA28);
    - hash-ul trimis la RPC e al PDF-ului urcat;
    - `p_verificari` are `sursa = 'foto'` și `pagini = 2`, iar evenimentul le păstrează;
    - pe telefon, previzualizarea nu încearcă să randeze PDF (VA27);
    - deep-link `/hr?tab=decizii&scan=<id>` deschis pe telefon, cu utilizatorul logat și nelogat: ajunge în modal pe decizia respectivă, iar la refresh modalul nu se redeschide (VA30);
    - Android cu memorie puțină: dacă tab-ul se reîncarcă după cameră, apare sfatul cu „Din galerie” (VA36);
    - se notează dacă poza a rămas în galerie pe fiecare telefon de test (VA13).
38. **Validări la scan (D5).**
    - O poză nedecodabilă (HEIC pe Android sau pe desktop) dă mesaj clar și nu urcă nimic. Un HEIC ales din Fișiere pe iPhone, pe care Safari îl decodează, trece (VA32).
    - Un PDF cu `file.type` gol trece (verificare pe `%PDF-` și reîmpachetare ca `application/pdf`) (VA32).
    - O imagine urcată direct în `hr-decizii` e refuzată de storage (mime).
    - `ataseaza_scan` fără `lizibil = true` e refuzat; pe o decizie generată, și fără `cod = true` (VA28).
    - Un PDF de la scanner merge pe aceeași cale, iar paginile se citesc cu `paginiDinBytes`. Un PDF cu object streams (`paginiDinBytes` = null) cere numărul de pagini manual, iar upload-ul reușește cu `pagini_sursa = 'manual'` (VA29).
    - Un scan de 2 pagini pe o decizie generată de 1 pagină dă doar o notă, nu blocaj.
    - Peste 10 pagini sau peste 20 MB → refuz în client, cu mesaj.
    - Retry după un răspuns pierdut: `ataseaza_scan` întoarce ok, fără eveniment nou, iar în bucket rămâne un singur fișier (VA34).
    - Import cu `stampila = false` fără `observatie` → refuz; cu `observatie` → ok (VA31).
39. **Seed-ul de tipuri (D4, D6).**
    - Sunt exact 15 tipuri.
    - `LUCRATOR_DESEMNAT_SSM` (`nivel = 'firma'`) și `RESPONSABIL_DESEURI` (`nivel = 'ambele'`) au textele transcrise din 16/2026 și 227/2026.
    - `CTC_QC` are `autorizatie_ceruta = 'nu'`, iar emiterea lui fără atestat nu dă R1.
    - Nu apare niciun tip nou în `hr_autorizatii_tipuri`.
40. **Șef de șantier înainte și după PR5** [V].
    - Înainte de PR5, scanul semnat pe `SEF_SANTIER` nu creează nicio propunere (`camp_efect` NULL), iar cardul din Echipă arată totuși eticheta deciziei, pentru că se leagă pe `tip_cod` (VA9).
    - După PR5, același scenariu creează propunerea, iar `fn_completare_aplica` o aplică.
    - Backfill-ul din PR5 creează propuneri doar pentru deciziile `SEF_SANTIER` eligibile după `_hr_decizie_eligibila_efect`, fără propunere, unde echipa are altă persoană; preview-ul le listează înainte de OK (VA9). **Negativ (J9):** o decizie altfel eligibilă, dar cu `propune_efect = false`, nu primește propunere; la fel una pe extern.
    - Revenirea 20261017a refuză cât timp PR5 e aplicat.

**Verificarea adversarială (v1.2)**

41. **Fail-closed (VA16).** Un cont non-owner cu `department` NULL și fără chei (de ex. „Test Fara Modul” [V]) cheamă direct fiecare RPC public: `rezerva`, `importa`, `anuleaza`, `contor_*`, `seteaza_pdf`, `ataseaza_scan`, `inlocuieste_scan`, `previzualizeaza`, `emite`, `fn_hr_decizii_emitenti`. Toate refuză, cu 42501. `fn_hr_decizii_poate(x)` întoarce false, nu NULL, pentru fiecare acțiune, pentru o acțiune inventată și pentru un `p_decizie_id` inexistent.

**Verdictele Copilot și Jakarinos (v1.3).** Testele concurente rulează cu două sesiuni (`dblink` sau două conexiuni în scriptul de test), cu `pg_sleep` între verificare și scriere pentru a forța intercalarea.

42. **`service_role` și draftul (P0-1, J16).** Ca `service_role`: INSERT direct cu `stare = 'semnata'` → refuz (fără GRANT); UPDATE pe un draft către `stare = 'emisa'` sau cu `continut`/`numar` → refuz; TRUNCATE pe oricare tabel al registrului → refuz. Ca `authenticated`: UPDATE pe propriul draft care schimbă `snapshot`, `versiune` sau `creat_de` → refuz (trigger, rulat prin PostgREST). **Privilegii (Vf1, Vf3):** `has_table_privilege` pentru `anon` și `service_role` cu INSERT/UPDATE/DELETE/TRUNCATE = false pe toate 5 tabele; `has_function_privilege` EXECUTE = false pentru `anon`, `authenticated`, `service_role` pe toate `_hr_*` și false pentru `anon`/`service_role` pe RPC-uri; `prosecdef = false` pe funcția `trg_hr_decizii_a_imuabil` (Vf2). **Excepția (J2-1):** `has_function_privilege('authenticated', '_hr_azi()', 'EXECUTE') = true`, iar un SELECT **efectiv** din `v_hr_decizii_curente` ca editor `executie` (nu doar verificarea RLS pe tabel) întoarce rânduri, fără „permission denied”.
43. **Înlocuire vs. revocare concurente (P0-2, J3).** Sesiunea 1 emite o înlocuire, sesiunea 2 o revocare pe aceeași țintă, intercalat: exact una reușește; cealaltă primește B9. La fel cu scanurile atașate concurent. Un rând cu `inlocuieste_id` și `revoca_id` simultan → refuz (CHECK). `importa` cu `inlocuieste_id` sau `revoca_id` → refuz (Vf12). Ținta revocată între emiterea și scanul unei înlocuiri → `ataseaza_scan` refuză tranziția.
44. **Sufixul (P0-3, J2).** Import 912 apoi 912-bis → ambele intră; al doilea 912-bis → refuz; „ BIS ” se normalizează la „bis”. 385a și 385b intră; **la import**, 385 fără sufix după 385a → intră (conflict exact, P2-2), iar 912-bis importat **înaintea** lui 912 → ambele intră; manual 385 din platformă (emitere/rezervare) cu 385a ocupat → refuz. Sufix la emitere/rezervare → refuz. Număr automat cu 917a ocupat → sare la 918. Două importuri concurente 391/2025 în `carte_tehnica` → unul reușește, celălalt primește eroarea prietenoasă.
45. **Revocarea (J4, J18).** Revocarea numirii unui angajat devenit inactiv → trece (G12). Revocarea propriei numiri de către Pantea → trece (G11, nu B1). Revocarea unei numiri de extern → trece. Revocare cu țintă `ALTA_DECIZIE` legată de proiect → refuz; un editor `exec` nu vede nimic nou (J18). Revocare cu `data_efect > data_emitere` → B9 (J7). Revocare semnată de Pantea/Tudorache fără împuternicire → R4 (Vf6). **Toate cazurile de mai sus rulează prin RPC-urile publice complete** (`previzualizeaza` + `emite`, nu prin `_hr_decizie_avertismente` direct), ca să dovedească alegerea matricei pe server (J2-2). Revocarea unei numiri importate din cartea tehnică, fără titlu și fără dată → redactorul completează titlul, textul iese „Decizia nr. 391/2025 (seria carte tehnica) privind…” (Vf7, corectat J3-7). **Două ținte 391 (J3-7):** 391/2024 și 391/2025 din cartea tehnică, plus 391/2025 din HR → cele trei revocări au identificări diferite în text.
46. **Propuneri falsificate (J5).** Un utilizator `can_manage_contracts` inserează direct o propunere cu `hr_decizie_id` sau `sursa = 'decizie_numire'` → refuz (politică). O propunere a generatorului modificată de migrare de test pe alt proiect/câmp/angajat → `fn_completare_aplica` refuză („necorelată”). Propunerile manuale existente (fără `hr_decizie_id`) merg ca înainte.
47. **Valabilitatea (J6, P2.2).** Decizie semnată cu `data_efect` mâine: nu e în view; propunerea se naște, dar confirmarea e refuzată până la `data_efect`. Decizie cu `data_efect_pana` ieri: propunere neconfirmată → confirmarea e refuzată. Proiect devenit inactiv între scan și confirmare → refuz. Datele testului se construiesc relativ la `_hr_azi()` (`data_efect = _hr_azi() + 1`, `data_efect_pana = _hr_azi() - 1`); funcția nu se simulează (V2-4). Fusul orar se verifică direct pe expresie: `(timestamptz '2026-10-06 23:30Z' AT TIME ZONE 'Europe/Bucharest')::date = '2026-10-07'`.
48. **Extern la scan (J8).** Rezervare RTE pe extern cu `propune_efect = true`, apoi scan → `semnata`, fără propunere, cu `propunere_omisa`/„extern”; tranzacția nu cade. La fel la import.
49. **Idempotență (P1-3, J10, J11).** `rezerva` repetat cu același `cerere_id` și payload → același număr, contorul crește o singură dată; cu alt payload → eroare. `emite` repetat după COMMIT cu același `cerere_id` → același rezultat, un singur eveniment (nici `modificare_draft`, nici `versiune` incrementată la tranziție, Vf11); repetat după ce decizia a devenit `semnata` → același rezultat (Vf10). Două sesiuni simultane `rezerva` cu același `cerere_id` → un singur rând, ambele primesc același număr (Vf9). `inlocuieste_scan` repetat cu același `cerere_id` și payload → ok, un singur `scan_inlocuit`. Două `seteaza_pdf` concurente cu căi diferite → exact unul reușește, celălalt „PDF deja atașat”.
50. **Validatorul comun (J12).** Pe `importa`, `rezerva` și `emite`: număr 0 sau negativ → refuz; `an = 2025` cu `data_emitere` în 2026 → refuz; an viitor → refuz; data viitoare → refuz. Import fără dată pe carte tehnică → ok.
51. **Contorul după oprire (J13).** Inițializare la 916, rezervare manuală 930 (gol 917–929), oprire, re-inițializare la 930 → golul 917–929 apare în continuare în „De rezolvat”; `ultimul_initial` rămâne 916. **Separat (J2-6):** prima inițializare la 916 pe un an fără niciun rând de contor și fără importuri → `ultimul = 916` și `ultimul_initial = 916` (nu 0), iar „Goluri” e gol.
52. **Combinate (J14).** 385a și 385b, același File urcat de două ori, căi diferite, același `scan_sha256`; ambele `semnata`.
53. **Calea lungă (J15).** `fn_hr_decizii_id_din_cale` pe `HR/2026/9223372036854775808/semnat_1.pdf` și pe un id de 300 de cifre → NULL, fără eroare; listarea în alt bucket cu nume similar nu dă eroare.
54. **Storage și owner/serviciu (J17).** DELETE ca owner autentificat → refuz. Ca `service_role` prin Storage API: documentat ca risc rezidual (§8); testul doar constată comportamentul, pe un obiect de test, și îl notează.
55. **R3 pe server (P1-1, J19).** `emite` apelat direct, fără R3 în `p_confirmari`, pe un RTE al cărui atestat nu acoperă domeniul → refuz cu R3. Cu R3 confirmat → ok. Un cod inventat în `p_confirmari` nu apare în `avertismente`. Vectorii de `acoperaDomeniul` dau același rezultat în vitest și în SQL.
56. **Previzualizare vs. emitere (J20).** Redactorul A previzualizează; redactorul B modifică draftul; A emite cu hash-ul vechi → refuz. Text la limita paginii cu numărul „99999-bis” → B7 în previzualizare. Documentul final care ar depăși → nu se urcă, apare în „De rezolvat”. Text care încape doar la 11pt → clientul trimite `p_font_pt = 11`, `snapshot.font_pt = 11`, PDF-ul final la 11pt se urcă (Vf8, J2-3). `p_font_pt` = 10 sau NULL → refuz.
57. **Hash (P2.1, J21).** `seteaza_pdf` / `ataseaza_scan` cu `p_sha256` care nu are 64 hex → refuz. UI-ul afișează „amprentă declarată”.
58. **`ALTA_DECIZIE` la import (J22).** Import cu eticheta „Gestionar” (absentă din nomenclator) → ok; fără `descriere` → refuz.
59. **R7 jurnalizat (J23).** Manual 9160 cu confirmare → `avertismente` conține R7 cu contorul, numărul cerut și cine a confirmat; evenimentul `salt_confirmat` există. B3 „fără număr manual” se decide corect când numărul manual e dat.
60. **Semnatari și împuternicire (P1-2, P1-4).** Un editor `exec` face SELECT pe `hr_decizii_semnatari` → 0 rânduri. Împuternicirea lui Pantea înregistrată ca `ALTA_DECIZIE` semnată + `preambul_validat` → R4 dispare; scanul ei înlocuit → semnatarul vede noul scan fără migrare, iar o decizie emisă înainte păstrează în `snapshot` nr. și data împuternicirii, fără cale și hash (Vf13); un editor `exec` care citește o decizie de proiect nu vede `scan_path`/`scan_sha256` ai împuternicirii în `snapshot`. Retragerea prin migrare (`imputernicire_decizie_id = NULL`) → R4 revine; revocare sau înlocuire cu țintă `ALTA_DECIZIE` → refuz B9 (Vf5).

**Runda 2 (v1.4).** Aceeași regulă pentru testele concurente: două sesiuni, `pg_sleep` între citire și scriere, **ambele ordini de finalizare**.

61. **Snapshot atomic (P2-1, J2-5).** Sesiunea 1 emite (cu `pg_sleep` injectat după `_hr_decizie_intrari`); sesiunea 2 schimbă în același timp `executie_proiecte.nr_contract`, respectiv `hr_autorizatii.data_expirare` a atestatului, respectiv `hr_decizii_semnatari.preambul_text`. Rezultat acceptat doar unul din două: (a) sesiunea 2 așteaptă, emiterea folosește valorile vechi peste tot (hash, avertismente, `snapshot`, `continut` coerente), apoi modificarea trece; (b) modificarea a fost comisă înainte, iar emiterea e refuzată cu „draftul s-a schimbat de la previzualizare”. Niciodată `snapshot` cu o valoare și `continut` cu alta. R3/R2 sunt calculate pe exact atestatul înghețat. Plus (V2-1): două drafturi diferite din același an; după previzualizarea draftului A, B se emite; A se emite apoi cu hash-ul vechi → **reușește** (registrul anului nu e în hash); G3 apare pe A doar dacă data lui e anterioară lui B. Plus: `grep` în corpul lui `_hr_decizie_randeaza`, `_hr_decizie_avertismente` și `_hr_acopera_domeniu` nu găsește `FROM` pe tabelele de intrare; **helper-ele apelate din ele** (`pg_depend` / lista din corp) sunt doar funcții pure sau `_hr_azi()` (J3-2, P3-1); `_hr_acopera_domeniu` e `IMMUTABLE` și primește `text[]`, nu id. G2/G7 vin doar din `_hr_decizie_context` și nu schimbă hash-ul. **Semnatar vs. împuternicire (J3-3):** sesiunea 1 emite cu Pantea; sesiunea 2 rulează migrarea D11 (`imputernicire_decizie_id = NULL`), respectiv schimbă legătura pe altă decizie; ambele ordini: fie emiterea folosește legătura veche și migrarea așteaptă, fie emiterea vede legătura nouă (R4 recalculat; hash diferit → „draftul s-a schimbat”), niciodată împuternicirea retrasă cu legătura deja schimbată.
62. **Matricea la emitere (J2-2).** Prin `previzualizeaza` + `emite` publice: revocarea numirii proprii semnată de Pantea → trece cu G11 (nu B1); revocarea numirii unui angajat inactiv → trece cu G12 (nu B2). `_hr_decizie_avertismente` nu are valoare implicită pentru `p_mod` (`pg_get_function_arguments`).
63. **Fontul și identitatea emiterii (J2-3, P2-5).** Același `cerere_id` repetat cu aceiași parametri → același rezultat; cu alt `p_font_pt`, alt `p_numar`, alte confirmări sau alt `hash_previzualizare` → „cerere de emitere refolosită cu alt conținut”, fără alocare. `snapshot.font_pt` = valoarea trimisă.
64. **Confirmare vs. revocare (J2-4).** Sesiunea 1: `fn_completare_aplica` pe propunerea unei numiri; sesiunea 2: `ataseaza_scan` pe revocarea aceleiași numiri. Ordinea A (confirmarea ia lock-ul primul): revocarea așteaptă; după ea, ținta e `revocata`, propunerea `confirmat` (J3-9; statusurile sunt `propus`/`confirmat`/`respins`/`expirat` [V]), echipa are persoana, ținta e `revocata`, iar cardul arată „⚠ decizie revocată, echipa îl are încă pe X” (§4.D.5). Ordinea B (revocarea primul): confirmarea așteaptă și apoi e refuzată („decizia nu mai e în vigoare” / „deja decisă”), propunerea e `expirat`, echipa **nu** se schimbă. Același test cu o înlocuire în loc de revocare. Nicio rulare nu dă deadlock.
65. **Contor, scan, import (J2-6–J2-9, P2-3).**
    - `inlocuieste_scan` cu o cale `…/<id>/generat_*.pdf` existentă, urcată de același owner → refuz (J2-7).
    - A → S1 reușește (răspuns pierdut), B → S2 reușește, retry A (același `cerere_id`, același payload) → ok, **scanul curent rămâne S2**, niciun eveniment nou; un apel nou cu baseline S1 → „scanul s-a schimbat între timp” (P2-3, J2-8). Același `cerere_id` cu alt payload → refuz.
    - `importa` cu `tip_cod = 'REVOCARE'` → refuz cu mesaj clar; revocarea istorică intră ca `ALTA_DECIZIE` cu descriere, iar ținta nu își schimbă starea (J2-9).
66. **Text (J2-11, J2-12, J2-13).**
    - Decizie pe proiect cu `data_efect_pana` = 31.12.2026: Art.3 din `continut` conține „pana la data de 31.12.2026”; pe date construite relativ la `_hr_azi()` (`data_efect_pana = _hr_azi() - 1`, fără simularea ceasului, V2-4), decizia iese din view și confirmarea propunerii e refuzată. Pe firmă apare articolul de termen. Fără `data_efect_pana`, textul e cel din model (test 30 neschimbat).
    - O înlocuire emisă conține articolul „Prezenta decizie inlocuieste Decizia nr. …” cu nr./data/persoana/funcția țintei, iar codul de verificare se schimbă față de același text fără articol.
    - **R5 pe articolele noi (J3-5):** o înlocuire RTE (tip `model_nas`) și un RTE cu `data_efect_pana`, emise fără R5 în `p_confirmari` → refuz cu R5 (mesajul numește articolul); cu R5 confirmat → ok, confirmarea e în `avertismente`.
    - **Țintă fără titlu (J3-6):** import RTE fără titlu → scan → înlocuire cu altă persoană → previzualizarea și emiterea reușesc; textul conține „privind numirea {NUME}” fără „Dl./D-na”.
    - RTE și RSVTI emise fără atestat, cu R1 confirmat: textul e complet, fără „nr. /”, fără `{aut_nr}` rămas și fără număr inventat. Un șablon de test cu o variabilă obligatorie lipsă → eroare la randare, nu text. O înlocuire draft fără `data_efect` → previzualizarea întoarce B10 și `continut` NULL, nu eroare tehnică (V2-3). Verificarea seed-ului: pe toate tipurile cu `autorizatie_ceruta <> 'nu'`, `{aut_*}` apar doar în `[[ ]]`.
67. **Alocator la import (P2-2).** Import 912-bis, apoi 912 → ambele intră; două importuri concurente 912 (fără sufix) → unul reușește, celălalt primește eroarea prietenoasă. Emitere manuală 912 cu 912-bis ocupat → refuz.
68. **Snapshot-ul împuternicirii (J2-10).** După o emitere semnată de Pantea cu împuternicire înregistrată: `snapshot.semnatar.imputernicire` are doar id, nr. și dată; evenimentul `emitere` are `imputernicire_scan` {path, sha256}, vizibil cu `citire` și invizibil unui editor `exec` (RLS pe jurnal).
69. **Escapare și substituție (J3-8).** Temeiul `<img src=x onerror=alert(1)>`, proiectul `A & B "C"` și un temei care conține literal `{aut_nr}`: `continut` le conține literal (substituție nerecursivă, `{aut_nr}` nu se înlocuiește); previzualizarea și PDF-ul le afișează ca text, fără element `img` în DOM și fără execuție de script (test vitest pe `renderDecizieHtml` + verificare manuală).
70. **Golirea la revocare (P3-2).** RTE semnat → propunere confirmată → `rte_employee_id` = X. Revocare semnată → propunere `decizie_revocare` cu `valoare = ''`; confirmarea → câmpul devine NULL. Variante: între scan și confirmare echipa a fost schimbată pe Y → confirmarea refuzată, Y rămâne; echipa nu-l avea pe X la scan → nicio propunere de golire; inserare directă din client a unei propuneri `decizie_revocare` → refuz (politică); propunere `decizie_revocare` confirmată → nu trece prin verificarea de numire și nici prin `SET %I = $1` (fără eroare de tip pe `''`); `hr_decizie_id` nenul cu altă `sursa` → refuz; proiect inactiv la scanul revocării → propunerea de golire se naște totuși. **Renumire (verificare runda 3):** revocare X → propunere de golire; renumire X pe același proiect și câmp, semnată → propunerea de golire trece în `expirat`; dacă e forțată confirmarea (rând rămas `propus`), garda refuză „X are o decizie în vigoare”.
71. **`cerere_emitere` global (P3-3).** Același `p_cerere_id` pe două drafturi diferite → al doilea e refuzat („cerere de emitere folosită pe alt draft”), fără alocare.

---

**Note de proces**
- Specificația e pentru sesiunea Module ERP: `HR.jsx` și `Executie.jsx` țin de ea, la fel și merge-ul.
- Branch-ul `claude/erp-continuare-x4p5a7-sef-santier` e în main (d71da84, #629), iar `20261017a` e aplicată (v20261006141500) [V]. PR3 și PR5 nu mai așteaptă nimic de acolo.
- Fișierul e pe branch-ul `claude/erp-continuare-x4p5a7-generator-decizii` (PR draft #630). Modificările v1.5 sunt necomise (bază: v1.4, commit 42258b1): commit-ul îl face sesiunea care le-a cerut.

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
| C31 (cercul) | Scanul îl citesc doar redactorii, emitenții și owner-ul | Se adaugă `confirm` (owner sau `can_manage_contracts`), **doar pe deciziile de numire pe proiect**. v1.2: fără `ALTA_DECIZIE` (VA7) și fără conturile fără fișă de angajat (D10 = B, VA22) | Cine confirmă efectul pe echipă trebuie să vadă dovada semnată. Altfel confirmarea e oarbă |
| C45 (`comunicat_la`) | Data comunicării către salariat | Amânată pentru v2, notat la „Ce NU face” | Nu blochează nimic în v1. Bifa „luare la cunoștință” acoperă cazul uzual |
| C8 (semnatarul implicit) | `semnatar_implicit_id` per tip | Preluat, cu valoarea **121 peste tot**, confirmată de Razvan (D2c, 06.10 seara) | Repartiția pe tipuri e decizia lui Razvan, nu a specificației |

**v1.3 — verdictele Copilot (P) și Jakarinos (J).** Nicio constatare respinsă integral: toate au fost verificate față de text (și J5 față de BD [V]: `completari_ins` WITH CHECK = owner OR `can_manage_contracts`, `valoare` NOT NULL, `fn_completare_aplica` fără verificarea legăturii) și sunt reale. Preluate în altă formă decât cea propusă:

| Punct | Propunerea | Ce s-a făcut | Motiv |
|---|---|---|---|
| J7 | Fie efect imediat, fie încetare modelată la data efectului | **Efect imediat în v1** (B9: `data_efect ≤ data_emitere` la înlocuire/revocare) | Varianta cu încetare la dată cere stări intermediare și job pe dată; v1 nu are cron (§8). Revocarea „de luna viitoare” se emite la data efectului |
| J14 | Două uploaduri sau document comun | **Două uploaduri** cu aceiași octeți | Păstrează regula „id-ul deciziei în cale” și politicile existente; documentul comun ar cere o tabelă și autorizare nouă |
| J20 (încadrarea finală) | Verificare de încadrare și pe documentul final | Preluat, plus rezervă de lățime pentru număr; un document final care depășește **nu se urcă**, iar decizia se anulează și se reface | Emiterea nu se poate întoarce (numărul e alocat); refuzul upload-ului + „De rezolvat” e singura cale care nu înregistrează un PDF tăiat |
| J21 / P2.1 | Hash calculat de o componentă de încredere sau declarat explicit | **Declarat explicit** (format validat, denumire „amprentă declarată”) | Verificarea server-side cere o edge function cu fișă de automatizare; candidat v2 |
| P1-2 | Restrângere sau proiecție fără metadate | **Restrângere** la `citire` | Singurii care aleg semnatarul sunt emitenții (owner/HR); ceilalți văd semnatarul din `snapshot`. O proiecție ar fi un obiect în plus fără consumator |
| J17 (storage) | Protecție suplimentară pentru operațiile privilegiate sau delimitarea garanției | **Delimitarea garanției** (§2.7, §3.5, §8) | Storage API cu cheia de serviciu nu se poate opri din politici; nimic din v1 nu folosește cheia pe bucket |
| J4 (B1 la revocare) | Fără B1 | Fără B1, **cu G11 informativ** | Revocarea propriei numiri de către un împuternicit nu creează un drept nou, dar merită văzută |
| J10 (crearea draftului) | Cheie de idempotență și la creare | Doar la rezervare, import, emitere, PDF și înlocuirea scanului | Un draft duplicat nu consumă număr și se șterge (J1); restul operațiilor sunt cele care alocă sau tranziționează |

**v1.4 — runda 2 (P2-n Copilot, J2-n Jakarinos).** **Nicio constatare respinsă**: toate 18 au fost verificate față de text, iar J2-4 și față de BD [V: `fn_completare_aplica` începe cu `SELECT … executie_completari_propuse … FOR UPDATE`, decizia ar fi citită fără lock; izolare `read committed`]. Preluate în altă formă decât cea propusă:

| Punct | Propunerea | Ce s-a făcut | Motiv |
|---|---|---|---|
| P2-1 + J2-5 | Snapshot atomic / o singură structură sub protocol de consistență | Comasate: `_hr_decizie_intrari` cu lock-uri `FOR SHARE` în ordine fixă (nu un singur statement, nu `REPEATABLE READ`) | `FOR SHARE` oprește și modificările comise *după* citire, până la COMMIT; un snapshot de tranzacție ar evita doar recitirile, dar ar permite emiterea pe valori deja schimbate |
| P2-4 | View doar `semnata` sau redenumit | **Redenumit** `v_hr_decizii_curente`, cu regula „efect = `semnata`” | Cardurile Echipă trebuie să arate și „nesemnată” (C13); un al doilea view ar dubla regulile |
| P2-3 / J2-8 | Baseline + ideal `cerere_id` / cheie de idempotență | **Ambele** (baseline și `cerere_id` cu hash în eveniment) | Baseline-ul oprește retry-ul întârziat; `cerere_id` face retry-ul exact idempotent fără să depindă de ultimul eveniment |
| J2-4 | Lock pe decizie înaintea propunerii și la expirare | Preluat; la expirare ordinea exista deja (decizia nouă → ținta → propunerile) și e doar documentată | Schimbarea atinge `fn_completare_aplica` (RPC existent): intră în același OK explicit pe PR1 ca J5 |
| J2-9 | Exclude `REVOCARE` sau flux istoric distinct | **Exclus** din import; revocările istorice ca `ALTA_DECIZIE` | Fluxul istoric ar relaxa CHECK-ul și B9 pentru trecut; câștigul nu justifică riscul în v1 |
| J2-11, J2-12 | Randarea termenului și a înlocuirii | Preluat cu formulări **noi, fără model NAS**, marcate de validat juridic | Nu există în modelele citite; textul nu se inventează în tăcere, se semnalează |
| J2-13 | Varianta fără atestat prin segmente opționale | Preluat, plus regula generală „variabilă obligatorie lipsă = eroare” și verificarea seed-ului | Închide toată clasa de probleme, nu doar RTE/RSVTI |

**v1.5 — runda 3 (P3-n Copilot, J3-n Jakarinos).** **Nicio constatare respinsă**: toate 12 au fost verificate față de text, iar J3-9 și P3-2 și față de BD [V: CHECK pe `executie_completari_propuse.status` = propus/confirmat/respins/expirat; `valoare` NOT NULL; `fn_completare_aplica` face doar `UPDATE … SET %I = $1` cu whitelist]. Preluate în altă formă decât cea propusă:

| Punct | Propunerea | Ce s-a făcut | Motiv |
|---|---|---|---|
| P3-1 + J3-2 | Helper pur; denumirile ISC în intrări; context separat pentru G2/G7 | Comasate: `_hr_acopera_domeniu(text[], text[])` pur; domeniile și denumirile în `v_in`; `_hr_decizie_context` în afara hash-ului | G2/G7 sunt galbene: incluse în hash, orice decizie nouă pe proiect ar invalida previzualizările celorlalți (aceeași logică ca la G3, V2-1) |
| P3-2 | „Clear” propus sau coloanele legacy declarate neautoritare | **Clear propus**, cu `valoare = ''` + `sursa = 'decizie_revocare'`, golire condiționată de valoarea curentă | Coloanele `rte/rts/mp` au consumatori în Execuție; mutarea tuturor pe view e lucru mai mare decât v1. `valoare` e NOT NULL [V], deci sentinelă `''`, nu NULL |
| J3-1 | `p_numar` la previzualizare sau validări separate | **`p_numar DEFAULT NULL`**, în afara hash-ului | Hash-ul descrie documentul; numărul face parte deja din identitatea emiterii (P2-5), iar lățimea e rezervată |
| J3-5 | R5 pe articolele condiționale | R5 calculat pe prezența articolelor, nu un cod nou | Același risc (text nevalidat), aceeași confirmare; dispare la validare prin migrare |
| J3-6 | Titlul țintei opțional sau completare istorică | **Opțional** | Completarea istorică ar modifica o țintă semnată (imuabilă) sau ar cere coloană nouă |

---

## Anexa A — Jurnal

| Versiune | Data | Autor | Ce |
|---|---|---|---|
| **v1 (cercetare + spec)** | 06.10.2026 | sesiunea de chat | Trei cercetări în citire: BD (`dxczwkbciseqniprspcu`), cod (`origin/main` 0e9b7b0), NAS (modelele F1/F2, seria Mironu 911–916, cartea tehnică). Pe baza lor, specificația v1 în 11 secțiuni, cu 5 decizii deschise (D1–D5) |
| **critică internă** | 06.10.2026 | review adversarial (sesiunea de chat) | 45 de puncte: (A) contradicții și goluri 1–20, (B) afirmații nesusținute 21–29, (C) securitate și date personale 30–35, (D) funcții tratate greșit 36–40, (E) ce ar inventa implementatorul 41–45. Punctele critice: ocolirea RPC-urilor din client (C6), contorul gol la prima emitere (C1), 2B redeschisă (C8), cheia `hr` ≠ HR (C24) |
| **v1.1** | 06.10.2026 | sesiunea de chat | Specificația completă cu critica integrată: 2B implementată cum a cerut Razvan, inițializarea contorului, alocare unică, GRANT pe coloane și imuabilitate pe `current_user`, randare doar pe server, preambul literal, propuneri legate de decizie și expirabile, drepturi exacte, serii la import, 15 tipuri (+ Deșeuri, + Lucrător desemnat SSM, + ALTA_DECIZIE), 33 de teste. Punctele respinse sau modificate sunt în anexa „Critica respinsă” |
| **v1.2** | 06.10.2026 seara | sesiunea de chat | Răspunsurile lui Răzvan la D1–D7 (`claude_context` #1622), propagate în toate secțiunile și marcate (Dn): registrul HR comun (D1); doar 121 reprezentant legal, 90 și 125 împuterniciți, semnatar implicit 121 (D2); emitenți Natalia (prin `department = 'HR'`) și Marilena, fără rânduri noi de acces (D3); CTC-QC fără atestat (D4); fără semnătură electronică, plus **scanul de pe telefon din poze → un singur PDF** (`pregatestePagina` + `paginiToPdf`, bucket doar PDF, bifa `lizibil`) (D5); cele două funcții în seed, total tot 15 (D6); riscurile acceptate (D7). Fapte noi: sef-santier în main (d71da84), 20261017a aplicată, deci `SEF_SANTIER` intră cu `camp_efect` NULL până la PR5. PR1 nu mai e blocat. **Verificare adversarială pe 3 unghiuri (consistență, drepturi, telefon): 38 de constatări, 38 aplicate** (toate reverificate în fișier, cod și BD, doar în citire; dublurile dintre unghiuri comasate; câteva preluate în varianta minimă, vezi mai jos; 1 blocantă: predicatele NULL, VA16). Întrebări noi, neblocante: D8, D9 și D10. 41 de teste |
| **v1.3** | 06.10.2026 noaptea | sesiunea de chat (computed task) | Verdictele NO-GO pe v1.2: **Copilot** (3×P0, 4×P1, 2×P2; D8 = A, D9 = A cu FK, D10 = B confirmate) și **Jakarinos** (J1–J23). Toate verificate față de text, J5 și în BD (doar SELECT [V]). **32 de constatări, 32 aplicate** (8 în formă modificată, vezi „Critica respinsă”), niciuna respinsă integral. D8–D10 închise ca recomandări confirmate de Copilot, de confirmat de Răzvan. Teste noi 42–60 (concurente și negative); testele 9 și 40 extinse. 60 de teste | **Reverificare (verificator, aceeași noapte):** 14 constatări (Vf1–Vf14), toate confirmate și aplicate; una regresie P0 (Vf1: REVOKE-ul nu închidea `service_role`, confirmat pe `pg_default_acl` [V]). Întrebare nouă D11 (Vf5). |
| **v1.4** | 06.10.2026 noaptea | sesiunea de chat (computed task) | Runda 2 de verdicte NO-GO pe v1.3 (commit c85c9e9): **Copilot** (1×P0, 2×P1, 2×P2 → P2-1…P2-5; D8 = A, D9 = A, D10 = B, D11 = A confirmate) și **Jakarinos** (13 constatări, J2-1…J2-13, blocante 1–4). Verificate față de text, J2-4 și în BD (doar SELECT [V]). **18 constatări, 18 aplicate** (7 în formă modificată, vezi „Critica respinsă”), niciuna respinsă. Tag-urile v1.3 P2-1/P2-2 redenumite P2.1/P2.2. Teste noi 61–68 | **Reverificare (verificator): GO condiționat.** 4 constatări (V2-1…V2-4), toate confirmate și aplicate: V2-1 (P1, regresie din P2-1) G3 scos din `_hr_decizie_intrari`/hash și mutat în `_hr_decizii_aloca` sub lock-ul contorului; V2-2 `hr_decizii_tipuri` `FOR SHARE`; V2-3 `data_efect` explicit în B10 + previzualizare fără eroare tehnică; V2-4 testele 47/66 pe date relative la `_hr_azi()`. Niciuna respinsă |
| **v1.5** | 06.10.2026 noaptea | sesiunea de chat (computed task) | Runda 3 pe v1.4 (commit 42258b1): **Copilot GO DESIGN** pentru PR1 (2×P1 + 1×P2 → P3-1…P3-3; D8–D11 confirmate) și **Jakarinos NO-GO** (9 constatări, J3-1…J3-9, blocant J3-1). Verificate față de text, J3-9 și P3-2 și în BD (doar SELECT [V]). **12 constatări, 12 aplicate** (5 în formă modificată, vezi „Critica respinsă”), niciuna respinsă. Teste noi 69–71; teste extinse 6, 7, 45, 61, 64, 66. **Verificarea de după runda 3** (GO condiționat): 4 constatări pe fixul P3-2 (dispatch pe `sursa` contradictoriu, golire peste o renumire, comentariu §3.1 rămas pe v1.4, golire omisă pe proiect inactiv), toate aplicate; test 70 extins | – |

**Trasabilitatea v1.3:**

| Puncte | Ce s-a corectat | Unde |
|---|---|---|
| P0-1, J16 | `service_role` doar SELECT pe registru; trigger pe INSERT și pe tranzițiile din draft | §0, §2.6, §3.4, §8, teste 8, 42 |
| P0-2, J3 | CHECK exclusiv; un UNIQUE pe ținta comună; lock + reverificare la emitere și scan | §0, §3.1, §3.8, §3.9, B9, §4.C–D, test 43 |
| P0-3, J2 | `p_numar_sufix` + normalizare; lock consultativ pe carte tehnică | §2.1–2, §3.1, §3.6, §3.7, §4.E, test 44 |
| P1-1, J19 | R3 pe server (`_hr_acopera_domeniu`); confirmările doar confirmă | §3.6, §3.8, §4.A.2, test 55 |
| P1-2 | SELECT pe semnatari doar `citire` | §3.4, test 60 |
| P1-3, J10 | `cerere_id`/`cerere_hash`, `cerere_emitere`; retry la `inlocuieste_scan` | §3.1, §3.6, §3.8, §4.A.4, §4.E–F, test 49 |
| P1-4 | `imputernicire_decizie_id` FK; R4 derivat; snapshot la emitere | §3.1, §3.4, §3.8, R4, §9 D9, test 60 |
| P2.1, J21 | hash declarat, format validat | §2.7, §3.1, §3.6, §3.9, §6, §8, test 57 |
| P2.2 | `_hr_azi()` Europe/Bucharest peste tot | §2.4, §3.2, §3.6, B3, test 47 |
| J1 | jurnal fără FK; `stergere_draft` | §2.5, §3.1, §3.4, test 9 |
| J4, J18 | matrice de validări pe moduri; ținta doar numire; G11/G12 | §3.3, §3.4, §4.A.2, §4.D, test 45 |
| J5 | politica `completari_ins` + `fn_completare_aplica` în PR1 | §2.8, §3.1, §3.4, §8, §10 PR1, test 46 |
| J6, J8, J9 | `_hr_decizie_eligibila_efect` unică (scan, backfill, confirmare); `data_efect` în view | §2.8, §3.2, §3.4, §3.9, §4.E, §10 PR5, teste 40, 47, 48 |
| J7 | efect imediat la înlocuire/revocare | §3.9, B9, §4.C–D, test 45 |
| J11 | `FOR UPDATE` în `seteaza_pdf` | §3.6, test 49 |
| J12 | validator comun număr/an/dată | §2.1, §3.1, §3.6, §4.E–F, test 50 |
| J13 | `ultimul_initial` nu se rescrie | §3.1, §3.6, §4.G, test 51 |
| J14 | combinate: două upload-uri | §3.5, §4.E, test 52 |
| J15 | id în cale max. 18 cifre | §3.5, test 53 |
| J17 | TRUNCATE; garanția bucket-ului delimitată | §2.7, §3.4, §3.5, §8, teste 9, 54 |
| J20 | `versiune` + `hash_previzualizare`; rezervă de lățime; remăsurare finală | §3.1, §3.4, §3.6, §3.8, §4.A.3–4, §6, test 56 |
| J22 | excepția `ALTA_DECIZIE` la etichetă | B4, §4.E, test 58 |
| J23 | numărul manual în avertismente; R7 din alocare, jurnalizat | §3.6, §3.7, §3.8, B3, test 59 |
| Vf1 (P0-1, J16) | REVOKE ALL explicit pe toate 5 tabele, inclusiv `service_role` [V: default ACL]; GRANT-uri scrise explicit | §3.4, test 42 |
| Vf2 | triggerul de imuabilitate SECURITY INVOKER obligatoriu; ordinea BEFORE prin nume (`a_`/`b_`/`c_`) | §3.4, test 42 |
| Vf3 | REVOKE EXECUTE pe `_hr_*` și RPC-uri și de la `service_role` [V] | §3.6, test 42 |
| Vf4 | FK `imputernicire_decizie_id` doar prin ALTER | §3.1 |
| Vf5 (J18 vs P1-4) | retragerea împuternicirii prin migrare de date (varianta A, de confirmat) | R4, test 60, §9 |
| Vf6 (J4) | R4 și la `revocare` | §4.A.2, test 45 |
| Vf7 (J4) | `coalesce` pe titlu; `{nr_tinta}` cu sufix/serie; `[[/{data_tinta}]]` opțional | §3.4, §4.A.2, §4.D, test 45 |
| Vf8 (J20, B7) | `snapshot.font_pt` înghețat la emitere | §6, test 56 |
| Vf9 (J10) | advisory lock pe `cerere_id` + reluare la `unique_violation` | §3.6, test 49 |
| Vf10 (J10) | retry la emitere pe `stare <> 'draft'` | §3.8, test 49 |
| Vf11 | `WHEN` draft→draft pe jurnal și versiune | §3.4, test 49 |
| Vf12 (P0-2) | importul refuză `inlocuieste_id`/`revoca_id` | §4.E, test 43 |
| Vf13 (P1-2, P1-4) | snapshot fără cale/hash ale împuternicirii | §3.8, test 60 |
| Vf14 | rândul v1.3 reintrat în tabel; antet actualizat | Antet, Anexa A |

**Trasabilitatea v1.5 (runda 3):**

| Puncte | Ce s-a corectat | Unde |
|---|---|---|
| P3-1, J3-2 | `_hr_acopera_domeniu` pur pe `text[]`; domenii + denumiri ISC în `v_in`; `_hr_decizie_context` pentru G2/G7, în afara hash-ului | §0, §3.6, §3.8 pas 4, §5.2, test 61 |
| P3-2 | propunere de golire la revocare (`decizie_revocare`, `valoare = ''`), aplicată doar dacă valoarea e încă persoana revocată | §0, §3.1 (eveniment), §3.4, §3.9 pas 5, §4.D.5, §8, test 70 |
| P3-3 | UNIQUE parțial pe `cerere_emitere` + eroare pe alt draft | §3.1, §3.6, §3.8 pas 1, test 71 |
| P3-2 (verificare runda 3) | `fn_completare_aplica`: dispatch exclusiv pe `sursa` + lock-uri revocare → țintă FOR SHARE → propunere; gardă de renumire + expirarea golirilor la o numire nouă semnată; golirea propusă și pe proiect inactiv; comentariul din §3.1 aliniat la `NOT IN ('decizie_numire','decizie_revocare')` | §3.1, §3.4, §3.9 pas 5, test 70 |
| J3-1 | `previzualizeaza(p_id, p_numar DEFAULT NULL)`; B3/B8 la previzualizare | §0, §3.6, test 7 |
| J3-3 | semnatarul blocat înaintea împuternicirii; legătura citită din rândul blocat | §3.8 pas 2, test 61 |
| J3-4 | lock înainte de verificare la toate RPC-urile de contor; `0..99999`; „registru epuizat” | §3.1, §3.6, §3.7, test 6 |
| J3-5 | R5 și pe articolele de termen / înlocuire | R5, §5.1, test 66 |
| J3-6 | `[[{titlu_tinta} ]]` opțional | §5.1, §5.2, test 66 |
| J3-7 | `{nr_tinta}` canonic cu an și serie | §4.D, §5.1, §5.2, test 45 |
| J3-8 | substituție nerecursivă, `continut` text simplu, escapare în `renderDecizieHtml` | §3.6, §5.2, §6, §8, §10 PR2, test 69 |
| J3-9 | test 64: `confirmat`, nu `aplicat` | test 64 |

**Trasabilitatea v1.4 (runda 2):**

| Puncte | Ce s-a corectat | Unde |
|---|---|---|
| P2-1, J2-5 | `_hr_decizie_intrari`: o citire, lock-uri în ordine fixă; hash/avertismente/snapshot/`continut` din aceeași structură; `_randeaza` fără recitiri | §0, §3.6, §3.8, §8, §10 PR1, test 61 |
| P2-2 | alocator: conflict exact la import, „orice sufix” la platformă/rezervare | §2.2, §3.7, §4.A.2 (matrice), §4.E, teste 44, 67 |
| P2-3, J2-8 | `inlocuieste_scan` cu `cerere_id` + baseline `p_scan_vechi_*` | §3.6, teste 49, 65 |
| P2-4 | view redenumit `v_hr_decizii_curente`; efect doar din `semnata` | §3.2, §6, §10 PR1 |
| P2-5 | `cerere_emitere_hash` | §3.1, §3.6, §3.8, §4.A.4, test 63 |
| J2-1 | EXECUTE pe `_hr_azi()` pentru authenticated; SELECT efectiv din view | §3.2, §3.6, §8, test 42 |
| J2-2 | `_hr_decizie_mod` pe server, fără `p_mod` implicit | §3.6, §3.8, §4.A.2, teste 45, 62 |
| J2-3 | `p_font_pt` la emitere, în snapshot și în identitatea cererii | §3.6, §3.8, §4.A.4, §6, teste 56, 63 |
| J2-4 | `fn_completare_aplica`: decizia `FOR UPDATE` înaintea propunerii | §3.4, §3.8, §8, test 64 |
| J2-6 | `v_nou` calculat înainte de UPDATE la inițializarea contorului | §3.6, test 51 |
| J2-7 | `semnat_*` obligatoriu la `inlocuieste_scan` | §3.6, test 65 |
| J2-9 | importul refuză `REVOCARE`; revocări istorice ca `ALTA_DECIZIE` | §3.6, §4.A.2, §4.E, test 65 |
| J2-10 | §3.4 aliniat cu §3.8: snapshot fără cale/hash; calea în evenimentul `emitere` | §3.4, §3.8, test 68 |
| J2-11 | articol de termen `{data_efect_pana}` | §3.8, §5.1, §5.2, test 66 |
| J2-12 | articol de înlocuire cu ținta | §3.8, §4.C, §5.1, §5.2, test 66 |
| J2-13 | segmente opționale de atestat pe RTE/RSVTI; variabilă obligatorie lipsă = eroare | R1, §3.6, §5.2, §5.3, test 66 |
| V2-1 | G3 în afara hash-ului, calculat în `_hr_decizii_aloca` după `FOR UPDATE` pe contor | §0, §3.6, §3.7, §3.8 pas 5, G3, test 61 |
| V2-2 | `hr_decizii_tipuri` în lista de lock-uri | §3.8 pas 2.4 |
| V2-3 | B10 cu `data_efect`; previzualizarea cu blocanți întoarce `continut` NULL | §3.6, B10, test 66 |
| V2-4 | testele 47 și 66 pe date relative la `_hr_azi()`, fără simulare | teste 47, 66 |

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

**Reverificări făcute în tura v1.2** (doar SELECT, git și cod, 06.10.2026 seara):
- Emitenții 121, 125 și 126: rol, departament, `is_owner`, `can_access_personal_data`, cheile `hr*`. Natalia e singurul profil din HR. Cheia `hr` are tot 8 deținători, iar sub-chei `hr.*` nu există.
- Protecția lui `profiles.department`: politica `profiles_update_own`, plus triggerul `trg_profiles_campuri_owner_only` (owner-only).
- `executie_proiecte.sef_santier_employee_id` există (1 proiect completat), migrarea `20261017a` e înregistrată ca v20261006141500, iar `fn_completare_aplica` n-o are în whitelist (corpul recitit).
- `origin/main` = d71da84 (#629). Liniile `Executie.jsx` (Echipă 3084-3134, panoul ~706) și `HR.jsx` (147-162, 247-254).
- Garda din `supabase/revenire/20261017a_executie_sef_santier_ROLLBACK.sql:58-61` (refuz dacă o funcție are coloana în corp).
- `imageToPdf` (`CitesteOricePanel.jsx:133`: o imagine → o pagină, fără EXIF, fallback la original la :241), copia din `HrAngajatNouWizard.jsx:70`, apelanții (`ctc/ctcDb.js:85`, `OfertareClarificari.jsx:366`), intrările cu `capture="environment"`, `paginiDinBytes` (`ctc/ctcUtil.js:140`).
- Limitele bucket-urilor de documente (`contracte-terti` 20 MB, doar PDF).

**Reverificări pentru verificarea adversarială** (doar SELECT și cod, `origin/main` d71da84, 06.10.2026 seara):
- Cei 7 deținători `hr` din afara HR trec toți `exec`, iar 6 trec `confirm`; `exec` are 14 profiluri, `can_manage_contracts` are 8 (inclusiv contul „Claude”, IT, fără `employee_id`).
- 8 profiluri non-owner cu `department` NULL; `handle_new_user` nu completează departamentul; `fn_completare_aplica` folosește `IF NOT COALESCE(v_ok, false)`.
- FK `user_module_access_module_fk` → `app_modules(key)`; în `app_modules` nu există `hr.decizii`.
- Triggerele de pe `profiles`: `department` e protejat de `fn_profiles_campuri_owner_only`, iar `is_owner` și `can_manage_contracts` de alte triggere (`enforce_owner_only_salary_flags`, `prevent_role_escalation`).
- `storage.objects`: triggerul `protect_objects_delete`, 107 politici fără niciun cast, `postgres` cu BYPASSRLS și SELECT, `metadata` cu `mimetype` și `size`, `owner_id` text.
- Codul: `HR.jsx:239-254` (filtrul tab-urilor și efectul de deep-link), `App.jsx:1156` (login cu search), `App.jsx:7204` (departamentul se editează în Admin → Manageri) și `App.jsx:7483-7495` (matricea de module, listă fixă), iframe-urile PDF (`HR.jsx:2577`, `AmcSection.jsx:156`, `Logistica.jsx:2583`), pdf.js din CDN (`SupapeDeclaratiiSection.jsx:81-106`), `pdfjs-dist` neimportat, `CitesteOricePanel.jsx:132-152`, `PiesePozeSection.jsx:29-40` și `:209`, `ctc/ctcUtil.js:138-150`, `ctc/ctcDb.js:82-100`, `ofertarePachet.js:16-22`, `src/lib/supabase.js`, `Achizitii.jsx:13` și `:123-135`, `.github/workflows/admin-alerte.yml:28`, `OfertareOrganigrama.test.jsx:5`, nicio folosire de IndexedDB.
- `node_modules`: jsPDF 4.2.1 (`px` = 96/72 fără hotfix, File ID aleator și data creării la fiecare construcție), `@supabase/storage-js` și `supabase-js` 2.105.3 (multipart cu tipul fișierului; „supabaseUrl is required.”).

**Trasabilitatea răspunsurilor (v1.2):**

| Decizie | Unde |
|---|---|
| D1 | §0, §1 (NAS), §2.10 și §3.3 (`ALTA_DECIZIE`, VA7), §4.F, §9 |
| D2 | §0, §1, §2.9, §3.1, §3.4, §4.A (B1, R4), §4.F (rezervare, VA17), §5.1, §5.3, §9, testele 23, 34–35 |
| D3 | §0, §1, §3.3, §3.6 (`fn_hr_decizii_emitenti`), §7, §8, §9, §10 (PR1), testele 25–27, 36, 41 |
| D4 | §0, §1, §5.3, §9, testul 39 |
| D5 | §0, §1, §2.10–11, §3.5, §3.9, §4.A.6, §4.E, §4.F, §6, §7, §8, §9, §10 (PR2–PR4), testele 37–38 |
| D6 | §0, §3.1, §5.3, §9, testul 39 |
| D7 | §0, §8, §9 |
| Fapte noi (sef-santier, 20261017a) | §0, §1, §3.1, §3.9, §5.3, §7, §10 (PR3, PR5), testul 40 |

**Trasabilitatea verificării adversariale (v1.2).** Numerotarea VA1–VA38 urmează ordinea constatărilor: consistență 1–15, drepturi 16–26, telefon 27–38. Toate 38 sunt reale și aplicate; niciuna respinsă.

| Puncte | Ce s-a corectat | Unde |
|---|---|---|
| VA1, VA22 | cei 7 deținători `hr` citesc prin `exec` / `confirm`; preview cu patru liste nominale; contul „Claude” fără scanuri (D10 = B) | §1, §3.3, §8, §9 D10, §10 PR1, testele 25–27, 36 |
| VA2 | R4 cu o singură formulă (inclusiv `preambul_validat` și data împuternicirii) | §0, §3.4, §4.A.2, §9 D9, testul 35 |
| VA3 | preambul și bloc de semnătură literale pe persoană; `{imputernicire}` definit; „Imputernicita” la 125 | §3.1, §5.1, §5.2, testul 35 |
| VA4, VA37 | scanul împuternicirii trece prin registru (D9 = A), fără folder `semnatari/`; varianta B descrisă | §3.1, §3.4, §3.5, §9 D9, testul 35 |
| VA5, VA31 | modalul de scan în două moduri (cu și fără document generat); `stampila` false la import doar cu observație | §3.9, §4.A.6, §4.E, §4.F, §7, testele 23, 38 |
| VA6 | `p_verificari` la înlocuirea scanului | §3.6, §7, testul 29 |
| VA7, VA18 | `ALTA_DECIZIE` o văd doar owner-ii și HR (în `pe_proiect` și în politica SELECT) | §2.10, §3.3, §3.4, §4.F, §9 D1, testele 26–27, 36 |
| VA8 | INSERT pe `semnat_*` cu dreptul `scan`; titlul D8 | §3.5, §8, §9 D8 |
| VA9 | cardurile Echipă legate pe `tip_cod`; backfill pentru Șef de șantier în PR5 | §7, §10 PR5, testul 40 |
| VA10, VA21 | departamentul HR e drept (OK la orice mutare); emitenții în antetul tab-ului | §0, §3.3, §3.6, §7, §8, §9 D3 |
| VA11 | titlul secțiunii de drepturi din §8 | §8 |
| VA12, VA25 | auto-confirmarea R4 de către Marilena, marcată ca dedusă din D2a + D7; Natalia confirmă singură R1–R7 | §8 |
| VA13, VA26, VA35 | pozele pot rămâne pe telefon; „Fă poză” recomandat; risc rezidual nou | §0, §2.10, §4.A.6, §8, §9, testul 37 |
| VA14, VA27, VA30 | fără randare de PDF pe telefon; `pregatestePagina` + `paginiToPdf` în `mm`; deep-link cu flag de drept și `scan=` tratat în `HrDecizii.jsx` | §4.A.6, §6, §7, §10 PR2–PR3, testul 37 |
| VA15 | §0 pomenește D8–D10; §4.G scos din „Unde” la D1 | §0, §9 D1 |
| VA16 | predicate fail-closed, `IS NOT TRUE` → 42501 (blocant) | §1, §3.3, §3.6, §8, testul 41 |
| VA17 | B1 și R4 la rezervarea numirilor; B1 reverificat la scan; bifa `semnatar` | §0, §3.6, §3.9, §4.A.2, §4.F, testul 23 |
| VA19 | bucket fără DELETE; scanul înlocuit rămâne; `fisier_sters` scos | §1, §2.7, §3.1, §3.3, §3.5, §3.6, testul 29 |
| VA20 | RPC-urile verifică obiectul din storage (mime, mărime, cine l-a urcat) | §1, §3.6, §3.9, testul 29 |
| VA23 | `fn_hr_decizii_id_din_cale`, fără cast în politici | §1, §3.5, testul 29 |
| VA24 | PR1 nu inserează `hr.decizii` în `app_modules` | §1, §3.3, §8, §10 PR1, testul 36 |
| VA28 | 2400 px (~190 DPI), codul din subsol ≥ 9 pt, bifa `cod`, scanerul nativ al telefonului | §3.5, §3.9, §4.A.6, §6, testele 37–38 |
| VA29 | `paginiDinBytes` = null → număr de pagini introdus manual | §3.9, §4.A.6, testul 38 |
| VA32 | imagini acceptate după decodare (HEIC); PDF după `%PDF-`, reîmpachetat | §4.A.6, testul 38 |
| VA33 | `asezareA4` în modulul pur `src/hrDeciziiUtil.js` | §6, §10 PR2 |
| VA34 | retry idempotent la `ataseaza_scan`; UI-ul nu recompune | §3.9, §4.A.6, §6, testul 38 |
| VA36 | lista de pagini doar în memorie; sfatul de recuperare | §4.A.6, testul 37 |
| VA38 | `sha256Hex` refolosit; testul pe HTTPS | §6, §10 PR2, testul 37 |

**Preluate în varianta minimă sau modificată:**
- VA4 / VA37: varianta pe D9 = A, cu B descrisă în §9.
- VA7 / VA18: excludere în `pe_proiect` și în politică, fără CHECK pe nivel, ca o `ALTA_DECIZIE` să-și păstreze proiectul ca filtru pentru HR.
- VA9: backfill în PR5, nu doar eticheta.
- VA12 / VA25: marcat ca consecință, fără întrebare nouă, pentru că D7 a răspuns deja la „confirmare de alt utilizator”.
- VA19: fără DELETE, nu RPC de aprobare a ștergerii.
- VA21: varianta minimă, fără sub-cheie nominală.
- VA28: 2400 px, capătul de jos al intervalului propus.
- VA36: doar sfatul; IndexedDB nu intră în v1.

**Corecturi la constatări** (nu schimbă concluziile):
- VA27 atribuia lui `PiesePozeSection.jsx:29-40` și `img.decode()`; acolo e doar `URL.createObjectURL`, cu `onload`.
- VA21 punea `is_owner` și `can_manage_contracts` pe seama triggerului `fn_profiles_campuri_owner_only`; le acoperă alte triggere de pe `profiles` [V].
- VA24 spunea că o cheie nouă în `app_modules` ar apărea în matricea din Admin. Matricea e însă o listă fixă (`App.jsx:7483-7495`), iar codul nu citește `app_modules` nicăieri [V]. Concluzia rămâne: cu FK-ul satisfăcut, acordarea ar deveni posibilă printr-un simplu INSERT.

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
