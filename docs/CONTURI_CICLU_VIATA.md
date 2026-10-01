# Ciclul de viață al conturilor: legare automată, închidere la încetare, fost angajat ca extern

Specificație de implementare, 29.09.2026. Proiect Supabase `dxczwkbciseqniprspcu`, PG 17.6 în producție (local PG 16).
Cerințele lui Răzvan: **R1** legare automată cont↔fișă · **R2** contract încheiat → cont închis · **R3** fost angajat Gazpet ca posibil colaborator extern, cu acord sigur.
Documentul e scris din rapoartele de citire (BD, UI, teste) și din SELECT-uri de verificare făcute pe 29.09. În producție nu s-a scris nimic.
**Runda 3 (30.09 seara):** corecturile celor două verificări adversariale pe `4f78368` — secțiunea **0.3**. Tot DOAR LOCAL; în producție doar SELECT pe catalog și numărători agregate (fără CNP-uri / emailuri).

Migrări (fiecare cu `_ROLLBACK.sql` pereche):
- **precondiție LIVE (nu face parte din pachet):** `supabase/migrations/20260929g_profiles_campuri_owner_only.sql` — S-A, live din 29.09 23:21 RO, copiat exact de pe branch-ul S-A (`md5(prosrc) = c06d7ce0f212c7bba2093c50614a88fc`); rollback-ul pachetului NU îl atinge
- `supabase/migrations/20260929c_conturi_legare_automata.sql` (R1)
- `supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql` (R2)
- `supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql` (R3)

**Amprente (r6, 01.10.2026 — c: revalidarea candidatului sub lock (C-RACE-LINK-1); d: cheia gazpet.persoana.emp (D-RACE-CNP-NULL) + amprente în postcondiții; e: email exact cu fișă inactivă = refuz (E-LIFECYCLE-2B) + postcondiții pe lock-uri)** — `sha256sum` pe fișierele din branch, de comparat la livrare:

| Fișier | sha256 |
|---|---|
| `20260929c_conturi_legare_automata.sql` | `286e1afb1f15cc316b1565d048e2a282f81d956b27851786e4e6326ae1490eb7` |
| `20260929d_conturi_inchidere_la_incetare.sql` | `ddc04baaa48cff28f69ae009f8276b891d935b94aec79571cc7cae410ded52e7` |
| `20260929e_fost_angajat_colaborare_externa.sql` | `870fdb3f8252e64e4e0ff136a21e2ba431da3e9aee8657448875e47c6745bd59` |
| `20260929c_conturi_legare_automata_ROLLBACK.sql` | `be29df2cf6c1261af75e57d8bd54f3d0b8ebd69b9e39331805debba4200c1592` |
| `20260929d_conturi_inchidere_la_incetare_ROLLBACK.sql` | `c2e41e0e028ee9027823f48540e95fb2801cfad5fa16d2af9b291d739163b0e1` |
| `20260929e_fost_angajat_colaborare_externa_ROLLBACK.sql` | `5db7153f28fc5a625c3d48e5fb10cd5e86393b18eef8037368dfdac2251dffa3` |

**Livrare (r6; live la 20261001201500): versiuni și comenzile runner-ului (acceptate de Copilot: 210000 / 211500 / 213000).** Ordinea e strictă c → d → e, iar versiunile sunt > 20261001184500 (ultima de pe live la 01.10) și strict crescătoare. După fiecare pas, runner-ul rulează gate-ul 0e (cod 30/31 = stop).
```
bash scripts/livrare_migrare.sh --migrare supabase/migrations/20260929c_conturi_legare_automata.sql \
  --sha256 286e1afb1f15cc316b1565d048e2a282f81d956b27851786e4e6326ae1490eb7 --versiune 20261001210000 \
  --tinta-db <baza> --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P>
bash scripts/livrare_migrare.sh --migrare supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql \
  --sha256 ddc04baaa48cff28f69ae009f8276b891d935b94aec79571cc7cae410ded52e7 --versiune 20261001211500 \
  --tinta-db <baza> --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P>
bash scripts/livrare_migrare.sh --migrare supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql \
  --sha256 870fdb3f8252e64e4e0ff136a21e2ba431da3e9aee8657448875e47c6745bd59 --versiune 20261001213000 \
  --tinta-db <baza> --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P>
```

**Aliniere SEC F2 r4 (01.10.2026).** `fn_identitate_privilegiata` întoarce `'service_role'` DOAR cu predicatul copiat textual din F2 (`20260930j`):
`v_rol = 'service_role' AND session_user = 'authenticator' AND current_setting('role', true) = 'service_role'`; `request.jwt.claim.role` și
`claims.role` contradictorii ⇒ NULL. Claims `service_role` fără `SET ROLE` / sub `authenticated` / dintr-o sesiune `postgres` ⇒ NULL
(teste R1-14c, 7 cazuri, decizia = cea a triggerului S-A rescris de F2). `fn_identitate_eticheta`: aceeași legare; claims nelegate ⇒
`service_role_nelegat:<rol>`. Gate 0e (`scripts/control_0e.sql` de pe main) pe baza locală după aplicare: 0 rânduri — pentru asta
`fn_pgrst_pre_request` citește `session_id` prin funcția internă `fn_identitate_sesiune()`, iar UPDATE-ul dinamic al flagurilor din
`fn_cont_restaureaza` s-a mutat în funcția internă `fn_cont_restaureaza_flaguri(uuid, jsonb)` (ambele fără EXECUTE pentru anon/authenticated/service_role; lista albă de flaguri reverificată în helper).

---

## 0. Decizii de luat cu Răzvan înainte de aplicare (A/B/C)

| # | Întrebare | Recomandare |
|---|---|---|
| D1 | **Înregistrarea publică de conturi.** În producție, confirmarea emailului e automată (`email_confirmed_at = created_at` la 10 din ultimele 12 conturi; recitit 29.09 seara: 15 din ultimele 20 confirmate în < 5 s). `createManager` apelează `supabase.auth.signUp` din browser, deci înscrierea publică e probabil pornită. Consecința: oricine are cheia anon (publică, e în bundle) își poate face cont cu `prenume.nume@gazpet.ro`. Cu R1 contul se leagă automat de fișa acelui om și primește acces la semnătura lui electronică (`hr_sem_self_*`). Riscul există și azi, doar că e mai larg: oricine își poate seta singur `employee_id` (vezi pct. A.4). Variante: **A** lăsăm așa, cu notificare la owner pentru fiecare legare automată · **B** oprim înscrierea publică (Dashboard → Auth → „Allow new users to sign up” OFF), iar conturile noi se creează din Dashboard → „Add user” · **C** facem o funcție edge `cont-nou`, cu poartă owner, pentru `auth.admin.createUser` (lucru separat, cu fișă în registru). | **B acum, C mai târziu.** Starea setării o verifică Răzvan în Dashboard; nu se poate citi din SQL. **După review (0.1):** migrarea c NU mai leagă singură la înscriere, deci nu mai depinde de D1 ca să fie sigură; B rămâne recomandat (un cont public tot primește `manager_santier` și citește `employees`). Cu B, `createManager` (signUp din browser) nu mai merge: toast-ul trimite la Dashboard → Add user, apoi „🔗 Leagă automat”. |
| D2 | Ce tip primește `razvantrusuhome@gmail.com`: `test` sau `extern`? | `test` |
| D3 | Alocările rămase după închiderea contului (aprobatori, responsabili, rute concediu): **A** doar alertă „Reasignează” · **B** dezactivare automată acolo unde există coloana `activ`. | **A**. Dezactivarea automată poate lăsa un flux fără niciun aprobator. |
| D4 | La reactivarea unui angajat (butonul „Activ.” din /admin) data încetării rămâne completată, iar cron-ul îl dezactivează din nou a doua zi la 04:00 UTC. Ștergem `termination_date` la reactivare, după o confirmare explicită? | **Da.** Implementat în `toggleEmp` (fără D4 reactivarea e anulată de cron a doua zi), **încă neconfirmat de Răzvan**. Urma nu se pierde: data veche se adaugă în `observatii_hr` („Reactivat la …; încetarea anterioară: …”). Dacă Răzvan zice „nu”, se scoate `termination_date:null` din `toggleEmp`. |
| D5 | Contul se închide în dimineața zilei `termination_date` (cron 04:00 UTC = 07:00 RO), la fel cum funcționează azi dezactivarea. Rămâne așa? | Da, fără schimbare de regulă. |
| D7 | **(30.09; refăcut în runda 3 pe AMBELE surse)** Garda „aceeași persoană” compară CNP-ul normalizat din `hr_employees_private.cnp` (sursa aplicației: Admin → Angajați → Editează, AdeverinteLegator; UNIQUE) **și** din `employees.cnp` (doar wizard-ul „Angajat nou”). O fișă **fără CNP în nicio sursă** = situație incompletă → contul NU se închide automat, doar alertă `cont_inchidere_suspendata` + `cont_activ_fost_angajat` cu `motiv_neinchis='cnp_lipsa'`. **Acoperirea în producție (SELECT agregat, 30.09, fără CNP-uri):** 120 de fișe active — 6 cu CNP (toate în `hr_employees_private`, **0** în `employees.cnp`), **114 fără CNP**; din cele 25 de conturi legate, **24 sunt pe fișe fără CNP**. Cu A, R2 ar închide azi automat 1 cont din 25; restul ar rămâne alertă + închidere manuală. **A** strict (implementat) · **B** fără CNP se închide oricum (pierde garda „alt contract activ”) · **C** fără CNP se închide dacă nicio altă fișă activă nu se potrivește pe nume de familie / email (azi: 18 din 24 s-ar închide, 6 ar rămâne alertă; cere cod + GO). Query-ul de acoperire pe ambele surse: G.2. | **A + completarea CNP-urilor în `hr_employees_private`** (scanner CI → Adeverințe → confirmare) înainte de apply; C doar ca tranziție, dacă completarea durează. **NU** copiem CNP-uri în `employees.cnp`: `employees` e citibilă de orice cont logat (regresie GDPR). |
| D8 | **(audit C A3-iv)** Orice cont cu `can_modify_employees` (6 conturi, inclusiv `claude@`) poate închide orice cont non-owner punând o dată de încetare ≤ azi (reversibil: jurnal + restaurare owner). **A** acceptăm, documentat (implementat azi) · **B** automat doar când declanșatorul e owner / cron, din HR doar „de confirmat” · **C** automat, cu excepția conturilor cu flaguri sensibile (`can_modify_employees`, `can_access_salarii`…), care merg la owner. | **C** (recomandarea auditului); necesită GO separat. |
| D9 | **(audit A #5 / B #6)** Revocarea EFECTIVĂ a JWT-urilor deja emise: `fn_pgrst_pre_request` e creat de migrarea d, dar **activarea** e schimbare de configurație globală: `ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.fn_pgrst_pre_request'; NOTIFY pgrst, 'reload config';` + JWT expiry 3600 → 900 s (Dashboard → Auth; Storage/Realtime nu trec prin hook). **Runda 3:** după corecturi, un cont revocat (închidere deschisă / ban activ) nu mai e „om” pentru R3 și nu mai scrie `employees` / `hr_employees_private` (R2-39). **Fereastra rămasă** fără D9: citirile / scrierile pe celelalte tabele cu RLS pe `auth.uid()` (ex. `employees` — CNP, IBAN — citibilă de orice logat) până la expirarea JWT-ului (≤ 1 h) și politicile pe flaguri până rulează coada (≤ 5 min, calea HR). | **Decizia lui Răzvan:** acceptare de risc documentată (fereastră ≤ 1 h, doar pe calea HR și doar pentru conturi închise) **sau** D9 în aceeași fereastră de apply cu d (recomandat: D9 imediat după testul LIVE pe un cont de test). |
| D10 | **(audit C A1-iii)** Înscrierea publică oprită (D1-B) ca **precondiție de GO**. | Da. |
| D6 | Opțional, în migrarea 1: protejăm și `department` la auto-modificare? Azi oricine își poate pune singur `department='HR'` (prin politica `profiles_update_own`), iar asta deschide 4 politici HR. Același lucru e posibil pentru flagurile neprotejate (`can_create_comenzi`, `can_manage_stoc`, `can_access_ctc`, `can_process_achizitii`, `can_use_document_scanner`, `receive_*`). | Da pentru `department`. Pentru flaguri, doar după un grep care confirmă că UI-ul nu le scrie pe profilul propriu. |
| D11 | **(runda 3)** Cât de largă e „situația incompletă” pe nume: acum = altă fișă ACTIVĂ fără CNP cu **același nume de familie** (în ambele sensuri) sau același email → contul NU se închide. Azi, dacă fișele lor ar avea CNP, 6 din 25 de conturi legate ar fi „posibil alt contract” din cauza unei alte fișe active fără CNP cu același nume de familie (rude / omonime); cu regula strictă „familie + încă un cuvânt comun” ar fi 0. **A** familie (implementat, conservator: nu închide pe un om poate încă angajat) · **B** familie + încă un cuvânt comun (mai puține alerte, pierde contractul nou cu prenumele scris altfel). | **A** până la completarea CNP-urilor (atunci regula nu mai contează: se aplică doar fișelor active FĂRĂ CNP). |
| D12 | **(runda 3)** Fusul orar: UI-ul Foști angajați (`HrFostiAngajati.jsx:85`, `ziRomania()`) folosește ziua RO, iar BD (`CURRENT_DATE` în UTC: R3 — `fn_hr_personal_extern_fost_angajat`, `fn_fost_angajat_leaga_extern`; R2; `fn_employees_termination_notify`; cron 13 la 04:00 UTC) ziua UTC. Între 00:00 și 02:00/03:00 RO o fișă cu data de încetare „azi” apare în Foști angajați, dar „Trece ca extern” e refuzat („nu e a unui fost angajat”). | Lot separat: toate comparațiile de dată (pachetul + `fn_employees_termination_notify` + cron 13) pe `(now() AT TIME ZONE 'Europe/Bucharest')::date` **deodată**; NU piesă cu piesă (s-ar desincroniza dezactivarea de închidere). Până atunci UI-ul poate folosi `ziBaza()` (ziua BD) și în Foști angajați. |

### 0.1 Corecții după review (29.09 seara) — ce s-a schimbat față de prima variantă

| Constatare | Ce s-a schimbat | Teste |
|---|---|---|
| **Critic** — legarea la ORICE înscriere (signUp public + confirmare automată ⇒ oricine ia fișa și semnătura altcuiva) | *(Istoric — înlocuit de 0.2 #1: triggerul nu mai leagă deloc; calea de încredere = RPC-ul `fn_cont_leaga_la_creare`, A.3b.)* `handle_new_user` leagă singur **doar pe calea de încredere** (`auth.users.raw_app_meta_data.gazpet_legare_automata = true`, pe care îl poate pune doar `service_role` prin API-ul admin — cârlig pentru funcția edge `cont-nou`, D1-C). Altfel contul se creează nelegat, owner-ul primește **propunerea** `cont_legare_propusa` (candidatul unic, cu „dacă nu-l recunoști, NU-l lega”) și confirmă dintr-un clic: Admin → Manageri → „🔗 Leagă automat” (previzualizare cu data creării contului → confirmare). Pentru Răzvan: „legarea automată” = sistemul găsește singur fișa; legătura efectivă o dă owner-ul (sau calea de încredere). | R1-00, R1-20 |
| **Major** — potrivirea din `profiles.email`, pe care utilizatorul și-l poate schimba singur | Potrivirea (`fn_cont_leaga_automat`, alerta `fara_angajat`) se face pe **emailul de logare** `auth.users.email`; profilurile cu `profiles.email ≠ auth.users.email` apar ca `email_diferit` și sunt sărite. `trg_profiles_protectie_legatura` refuză și schimbarea lui `profiles.email` de către non-owner (42501). Producție 29.09: 0 nepotriviri, iar UI-ul schimbă emailul doar din modalul owner-ului. | R1-14, R1-21 |
| **Major** — pasul pe nume accepta doar prenumele (`ana.maria@` → IONESCU ANA MARIA) | Numele de familie (primul cuvânt din `employees.name`) e obligatoriu printre tokeni; ordinea rămâne liberă. Producție (SELECT 29.09): 22/22 legături reale găsite și cu regula strictă, 0 candidați unici greșiți. | R1-22 |
| **Major** — extern NELEGAT, activ, cu numele unui fost angajat care a refuzat (fără marcaj, fără acord) | Triggerul de pe `hr_personal_extern` refuză (23514, HINT „HR → Foști angajați → Trece ca extern”) un rând nelegat + activ al cărui nume (fără diacritice, orice ordine, cu numele de familie, un set îl conține pe celălalt) sau email e al unui fost angajat; excepție: owner-ul (omonim = altă persoană). Se verifică la INSERT și la schimbarea `nume`/`email`/`activ` (rândurile vechi rămân editabile). UI: blocare în `ModalPersoana` + avertisment „Omonim cu fostul angajat” în listă. Restrângerea INSERT/UPDATE pe `hr_personal_extern` la owner/HR rămâne **decizie a lui Răzvan** (drepturi de acces) — nu s-a făcut. | R3-22 |
| **Major** (×2) — acordul „accepta” supraviețuia reangajării și se moștenea la plecarea următoare | Acordul e legat de **încetarea curentă**: la reactivare (`active` → true) sau la ștergerea datei de încetare, `fn_employees_colab_ext_protectie` îl readuce la „necunoscut” (fără proveniență/notă/document) și pe calea de sistem; jurnalul primește rândul `sursa='reset_automat'` („acordul era pentru încetarea din …”, `facut_de` = cine a reactivat sau NULL = sistem). Poarta pe externul legat cere și ca fișa să fie **încă** a unui fost angajat. UI: „↩ Reangajat Gazpet (fișa activă)” în Personal extern. | R3-20, R3-21 |
| **Major** — alertele `inchis_dar_deblocat` / `inchis_cu_acces_rest` nu aveau acțiunea în UI | Modalul „Editează Manager” arată pe un cont închis **„🔒 Reaplică închiderea”** (același `fn_cont_inchide_owner` → `deja_inchis`, convergent) lângă „↩ Restaurează”; textul alertei: „Reaplică închiderea… NU folosi Restaurează: redă TOT accesul — doar dacă omul revine în firmă”; confirmarea restaurării spune același lucru. | vitest (adminAlerte, gardă statică App.jsx) |
| Minor — cont închis își repunea flaguri / email cu JWT-ul încă valabil | `trg_profiles_protectie_legatura`: dacă există închidere nerestaurată, orice UPDATE de la non-owner → 42501 (verificare cu `to_regclass`, migrarea c rămâne independentă de d). | R2-24 |
| Minor — „Dezact.” noaptea (00:00–03:00 RO) nu închidea contul | `toggleEmp` pune data implicită = ziua BD (`ziBaza()`, UTC = `CURRENT_DATE`), la fel bannerul din „Editează Angajat”. Textul alertei pentru dată trecută explică „dezactivată înainte de dată sau închidere eșuată”. Cazul „fișă deja inactivă, data ajunge” rămâne doar alertă critică + închidere manuală (fără cron nou). | vitest (`ziBaza`) |
| Minor — `fn_cont_restaureaza` accepta orice formă de snapshot | Refuză (22023, jurnalul NU e marcat) dacă snapshot-ul nu are `versiune=1`, `flaguri{}`, `module[]`, `santiere[]`, `banned_until`. G.7 convertește explicit. | R2-25 |
| Minor — 2 conturi nelegate cu același candidat | Ambele `ambiguu`, și în previzualizare, și la aplicare. | R1-23 |
| Minor — rollback c înaintea lui d lăsa triggerul R2 fără notificare | Gardă de ordine în rollback-ul c (refuz 55000, fără efect) + toate notificările din `fn_cont_inchide` / `fn_employees_ciclu_cont` sunt best-effort (`BEGIN … EXCEPTION`). | harness (gardă), R2-26 |
| Minor — `stareContProfil` ignora banul fără jurnal | `fn_cont_stare_angajati` întoarce owner-ului toate conturile (și nelegate); coloana „Stare” arată „🔒 Logare blocată (fără jurnal)”. HR vede în continuare doar conturile legate. | R2-27, vitest |
| Minor — badge „Fost angajat” pe fișa HR era cod mort | Butonul „📇 Fișa” din Foști angajați citește fișa după id și deschide `ModalProfilAngajat` (badge + „Cont platformă”). | — (UI) |
| Minor — „Trece ca extern” pentru cei care au refuzat; dovada nu se putea actualiza | Ascuns la „Refuză”; buton „📎 Actualizează dovada” (aceeași stare, notă/document nou → `confirmat_la` nou). | vitest (gardă statică) |
| Minor — coliziunea de nume fără avertisment; fără dezlegare | Confirmarea arată externul existent (firmă, telefon, activ) și „colaborarea devine INACTIVĂ până la Acceptă”; „✂️ Dezleagă de fișă” în Personal extern (owner/HR; triggerul pune `activ=false` la dezlegare). | R3-23 |
| Minor — `alocari_ramase` afișa nume de tabele | Etichete + locul real (Achiziții → tab Aprobatori, HR → Recrutare; restul „fără ecran: în BD, cu Claude”), link spre primul loc editabil. | vitest |
| Minor — bannerul HR din „Editează Angajat” (RLS doar owner pe jurnal) | Starea vine din `fn_cont_stare_angajati` (accesibil HR); pentru non-owner: „anunță owner-ul (Răzvan)”. | — (UI) |

### 0.2 Corecții după S-A live și review Copilot (30.09)

**Context.** Triggerul S-A `trg_profiles_campuri_owner_only` (20260929g) e LIVE din 29.09 23:21 RO. Copilot a aprobat modelul de identitate: trec DOAR identități explicite — claims `role='service_role'` (din 01.10: legat de `session_user='authenticator'` + `current_setting('role')='service_role'`, ca SEC F2 r4); claims `role='authenticated'` + `sub` = profil owner; FĂRĂ claims → doar `session_user IN ('postgres','supabase_admin')`. „`auth.uid() IS NULL` ⇒ sistem” e interzis; `current_user` într-o funcție SECURITY DEFINER nu e apelantul. Cele 3 audituri (A identitate, B condiții Copilot, C fișă + pct. 4) au dat NO-GO pe varianta din 29.09; tabelul de mai jos e răspunsul, punct cu punct. Harness-ul rulează acum cu S-A ca precondiție live și cu login-urile reale (`authenticator`, `supabase_auth_admin`, `postgres`); aceleași teste rulate pe varianta din 29.09 (cu psql continuând după erori) pică la 58 de ID-uri de test, inclusiv toate ID-urile noi din coloana „Teste” (unele eșecuri vechi sunt efecte în cascadă ale #1).

| # | Constatare (audit) | Schimbare | Teste |
|---|---|---|---|
| 1 | **CRITIC** (A #1, B #1a, C A1-1, M3) — calea de încredere R1 nu mergea în producție: `handle_new_user` rulează pe login-ul GoTrue (`supabase_auth_admin`, fără claims), S-A refuza `UPDATE employee_id` cu 42501, eroarea era înghițită, iar pe alte domenii decât gazpet.ro owner-ul nu afla nimic | `handle_new_user` **nu mai scrie** `employee_id` (doar potrivire + notificare). RPC nou `fn_cont_leaga_la_creare(p_profile_id)` (c, A.3b): identitate DOAR `service_role` (funcția edge `cont-nou`, după `createUser`) sau `owner`; reverifică atomic (profil `FOR UPDATE` + indexul unic) marcajul `gazpet_legare_automata`, legătura liberă, `tip_cont`, emailul profilului = cel de logare, candidatul unic și liber; anunță `cont_legat_automat` / `cont_nelegat: eroare la legare`. `cont_nelegat` pleacă pe **orice** domeniu la eroare de potrivire și pe calea de încredere. `supabase_auth_admin` NU intră în lista albă S-A | T2b, SA-02, R1-01…R1-13 (prin `creeaza_cont_owner` = GoTrue + RPC), R1-30, R1-31, R1-32, R1-34 |
| 2 | **CRITIC latent** (A #2, B #2, C A3-c, M2) — `fn_cont_inchide` golea `request.jwt.claims` / `claim.sub` ca UPDATE-ul de flaguri să pară „sistem” (impersonare; cu S-A extins 20260930a închiderea din UI s-ar fi anulat toată) | Fără niciun `set_config('request.jwt…')`. Decizia pe identitatea explicită (`fn_identitate_privilegiata`): owner / service_role / db_login → flagurile pe loc; altfel (HR prin UI) totul se revocă pe loc, iar flagurile intră în coada `conturi_inchideri_coada` (tip `flaguri`) și le pune pe false `fn_conturi_inchideri_sweep` (pg_cron la 5 min, login postgres). Varianta „claims service_role puse local” a fost respinsă (falsificare) | R2-01 (coadă → sweep), R2-18, R2-32 (grep), R2-33; rularea cu S-A extins (20260930a ca a doua precondiție): 1128/1128 |
| 3 | **MAJOR** (A #3, B #5) — o închidere eșuată nu se mai reîncerca (cron-ul 13 atinge doar `active=true`); fișă dezactivată înainte de dată = cont niciodată închis; data pusă ulterior pe o fișă inactivă nu declanșa nimic | Coada: `reincercare` (eroare → reîncercare la fiecare rulare, cu `incercari` / `ultima_eroare`), `programata` (dezactivat înainte de dată → închis la scadență). Triggerul R2 pornește și la schimbarea `termination_date`. Sweep-ul reverifică TOATE condițiile (fișă încă inactivă, dată ajunsă, legătură, owner, tip cont, gardă); reactivarea anulează programările; restaurarea anulează tot din coadă | R2-05, R2-19, R2-19-bis, R2-36, R2-37 |
| 4 | **MAJOR** (A #4, B #2, C A2, M1) — `trg_profiles_protectie_legatura` lăsa să treacă `auth.uid() IS NULL` (GoTrue, `authenticator` cu claims golite, anon printr-un RPC SECURITY DEFINER) | Funcții comune interne (c, A.0): `fn_identitate_claims` / `fn_identitate_privilegiata` (logica S-A copiată 1:1) / `fn_identitate_uid` / `fn_identitate_om` / `fn_identitate_eticheta`, SECURITY DEFINER, `search_path` fixat, fără EXECUTE pentru API. Protecția trece doar pe `fn_identitate_privilegiata() IS NOT NULL`; verificarea pe `employee_id` rămâne (redundantă cu S-A, apărare în adâncime). **Triggerul S-A e neatins** | R1-14 (existent), R1-14b (matrice 9 identități: decizia comună = S-A = protecția) |
| 5 | **MAJOR** (A #5, B #6, C A3-e) — JWT-ul de acces deja emis rămâne valabil până la 1 h; sesiunile / refresh tokenurile | `fn_cont_inchide` **șterge** `auth.refresh_tokens` și `auth.sessions` (postgres are DELETE pe ambele, verificat live 30.09). Hook `fn_pgrst_pre_request` (d, B.5c): refuză 42501 o cerere authenticated cu închidere deschisă, ban activ sau `session_id` inexistent. **Creat, NEACTIVAT** (D9) | R2-01, R2-29, R2-29b (caracterizarea riscului fără hook) |
| 6 | **MAJOR** (A #6, B #1b, C A1-2) — TOCTOU: `fn_cont_leaga_automat(false)` recalcula lista și lega și conturi apărute după previzualizare | Semnătură nouă `fn_cont_leaga_automat(p_simulare, p_confirmate jsonb)`: aplicarea leagă DOAR perechile `[{profile_id, employee_id}]` din previzualizare care se potrivesc încă (`neconfirmat` / `schimbat` altfel; fără listă → 22023). Previzualizarea arată și `cont_provider` / `cont_incredere`. `App.jsx` trimite lista confirmată | R1-19, R1-20, R1-21, R1-23, R1-33 |
| 7 | **MAJOR** (A #7) — harness-ul dădea verde fals (`SET ROLE` lasă `session_user = postgres`; S-A lipsea din listă; GUC-uri vechi `claim.sub/role`) | Lista: `live: …20260929g…` ca precondiție (aplicată înaintea instantaneului „dinainte”, fără reaplicare / rollback). Schelet: rol `authenticator` LOGIN NOINHERIT (membru anon/authenticated/service_role); `ca_utilizator` / `ca_anon` / `ca_service_role` = `SET SESSION AUTHORIZATION authenticator` + `SET ROLE` + doar `request.jwt.claims`; `ca_login(<login>)` fără claims; `creeaza_cont` = `SET SESSION AUTHORIZATION supabase_auth_admin`; `creeaza_cont_owner` = GoTrue + RPC cu service_role | T2b, T3, SA-01…SA-03 |
| 8 | **MINOR** (A #8, B #7, C A6) — „`facut_de` NULL = sistem” amesteca cron, migrare, service_role, GoTrue | Coloana `facut_de_identitate` în ambele jurnale (`db_login:postgres` · `service_role` · `owner:<uuid>` · `authenticated:<uuid>` · `fara_identitate:<login>`, cu `@<login>` când claims vin dintr-o conexiune directă); `facut_de` = omul din platformă (JWT prin PostgREST) sau NULL | R2-01, R2-02, R2-03, R2-17, R2-19-bis, R2-33, R3-25 |
| 9 | **MINOR** (A #9) — porțile owner foloseau `auth.uid()` (un `sub` non-uuid dădea 22P02) | Toate porțile owner din c/d: `fn_identitate_privilegiata() = 'owner'`; uid-ul din `fn_identitate_uid()` | R1-35 |
| 10 | **Condiția Copilot lipsă** (B #4, C A3-e) — garda „alt contract activ”, atomică | `fn_cont_garda_persoana(employee_id)`: aceeași persoană = același CNP normalizat; `pg_advisory_xact_lock` pe persoană luat în trigger ÎNAINTEA subtranzacțiilor de închidere + `trg_employees_persoana_lock` (INSERT / UPDATE OF cnp, active, termination_date) ia același lock. Alt contract activ sau CNP lipsă → NU se închide, doar `cont_inchidere_suspendata` + motiv în alertă. La încheierea ultimului contract se închid și conturile legate de fișele vechi ale aceleiași persoane. *Runda 3 (0.3 #1): CNP-ul citit doar din `employees.cnp` era insuficient — acum ambele surse + nume / email.* | R2-28a, R2-28b, R2-28c, R2-28d (două conexiuni, `dblink`, `lock_timeout` → 55P03, plus control cu alt CNP) |
| 11 | **Condiția Copilot parțială** (B #5-iii, #5-iv) — situații incomplete închise fără verificare | Cont legat marcat `extern` / `test` / `sistem` → neînchis, alertă. Cont NELEGAT cu emailul de logare = emailul fișei încheiate → `cont_posibil_aceeasi_persoana` (fără închidere) | R2-30, R2-31 |
| 12 | Condiția Copilot „fără restaurare automată la reactivare” (B #8) — acoperită, dar testată parțial | Nicio schimbare de comportament; teste: flaguri, șantiere, sesiuni rămân închise; doar `termination_date = NULL` nu redă nimic; sweep-ul nu re-închide un cont restaurat (*runda 3, 0.3 #6: triggerul îl re-închidea la corecția datei — corectat, R2-40*). Restaurarea: lock profil → jurnal (aceeași ordine ca închiderea, B #7b) + **previzualizare** `p_simulare` (C A3-v) | R2-10, R2-11c, R2-36 |
| 13 | R3 (B #9) — „om” = orice claims `authenticated`; schimbarea datei pe o fișă inactivă păstra acordul | Poarta R3 cere `fn_identitate_om()` (JWT prin PostgREST, login `authenticator`): o sesiune postgres/MCP cu claims de HR falsificate e refuzată. Resetul la „necunoscut” și la SCHIMBAREA datei de încetare | R3-07b, R3-24 |
| 14 | pct. 4 (audit C P1–P5) | P1: jurnalele și coada — `service_role` doar SELECT (fără snapshot fabricat / „restaurat” fals). P2: gărzile append-only rămân SECURITY INVOKER (doar RAISE) — excepție motivată. P3: `service_role` scos din GRANT-urile RPC-urilor cu poartă owner/HR (+ view). P4: `handle_new_user` fără EXECUTE pentru service_role (rollback-ul îl repune, ca în producție). P5: coloanele R3 vizibile tuturor logaților — documentat (D1-B + restrângerea politicilor = decizie de drepturi) | R1-18, R2-12, R2-14b, R2-38, R3-25 |

**Ce NU s-a rezolvat în cod (decizii / pași ai lui Răzvan):** D7 (CNP lipsă), D8 (cine poate declanșa închiderea), D9 (activarea hook-ului + JWT expiry), D10 (înscrierea publică), funcția edge `cont-nou` (nu există încă; până atunci calea de încredere = owner cheamă RPC-ul sau „Leagă automat”), UI-ul pentru bifarea individuală a perechilor și pentru previzualizarea restaurării (azi: listă completă în `window.confirm`; RPC-ul acceptă deja perechi individuale / `p_simulare`), trecerea S-A pe funcția comună (GO separat), `tip_cont` în lista S-A (GO separat), secretele în clar din `cron.job.command` (de mutat în Vault, lot separat).

### 0.3 Runda 3 (30.09): corecturile verificatorilor

**Context.** Două verificări adversariale pe `4f78368` (verificatorul 1: sondele P0–P12, `conturi_adv.sql`; verificatorul 2: scenariile X1–X10, `verif_conturi_v2/`) au dat **CU_CORECȚII**. Toate scenariile au fost reproduse întâi pe `4f78368` (cluster local separat), apoi pe codul nou. Testele noi, rulate pe migrările din `4f78368` (psql continuând după erori): **37 de aserțiuni pică + 11 erori** (obiecte / coloane inexistente) — toate ID-urile noi de mai jos; pe codul nou trec toate. În producție: doar SELECT pe catalog (`hr_employees_private`: coloane, UNIQUE, politici, trigger) și numărători agregate (acoperirea CNP), fără CNP-uri sau emailuri.

| # | Constatare (verificare) | Schimbare | Teste |
|---|---|---|---|
| 1 | **MAJOR** (X1) — garda „alt contract activ” / „situație incompletă” citea CNP-ul DOAR din `employees.cnp`. Aplicația îl ține în `hr_employees_private.cnp` (Admin → Angajați → Editează, AdeverinteLegator; index **UNIQUE**, deci a doua fișă a aceluiași om nu poate primi același CNP acolo); `employees.cnp` îl scrie doar wizard-ul. HR închidea contul unui om care avea încă un contract activ creat fără CNP | d: `fn_cont_persoana_cnp` = CNP-urile fișei din **ambele surse** (`COALESCE(NULLIF(hp.cnp,''), e.cnp)`; dacă sursele diferă — 0 cazuri la 30.09 — contează ambele valori); `fn_cont_alt_contract_activ` compară pe ambele surse. „Situație incompletă” nouă **`posibil_alt_contract`**: altă fișă ACTIVĂ fără niciun CNP cunoscut care se potrivește pe **numele de familie** (`fn_nume_cuvinte`, în ambele sensuri: familia fiecăreia printre cuvintele celeilalte — prinde și ordinea inversată) **sau pe email** → NU se închide, doar alertă (`cont_inchidere_suspendata` cu fișa și ce e de făcut; `motiv_neinchis='posibil_alt_contract'`). Mesajul „CNP lipsă” spune acum „nici în datele personale, nici pe fișă” și nu mai apare când CNP-ul e doar în tabela privată. **Lock pe persoană** pe cheile CNP (ambele surse) + cuvintele numelui + email: îl iau garda, `trg_employees_persoana_lock` (acum și `UPDATE OF name, email`; o scriere care DOAR încheie / dezactivează nu mai ia chei — cron-ul 13) și triggerul nou `trg_hr_employees_private_persoana_lock` (INSERT / UPDATE OF cnp, employee_id / DELETE) → închide și **X2** (o fișă nouă FĂRĂ CNP nu lua niciun lock). `fn_nume_cuvinte` s-a mutat din e în c (+ `fn_nume_familie`), ca d să nu depindă de e. **NU** se copiază CNP-uri în `employees.cnp` (tabela e citibilă de orice cont logat: regresie GDPR) | R2-28e (CNP doar în datele personale → se închide, fără „CNP lipsă” fals; A pe fișă + B în datele personale; invers), R2-28e-lock (dblink: CNP pus în datele personale în timpul încheierii → 55P03, contextul arată `fn_cont_lock_chei`; control), **X1** / R2-28f (nume, email, ordine inversată, control cu rudă cu alt CNP), **X2** (dblink) |
| 2 | **MEDIU** (X10, P1a–g) — un cont HR închis mai lucra ca HR până rula coada (≤ 5 min, flagurile TRUE) și cu JWT-ul vechi (≤ 1 h): acord R3, „Trece ca extern”, încheierea contractului altcuiva (= închiderea contului lui), golirea CNP-urilor, starea conturilor | c: `fn_identitate_revocata(uid)` = închidere nerestaurată sau ban activ; **`fn_identitate_om` întoarce NULL pentru un cont revocat** → porțile R3 refuză imediat (42501). d: `fn_cont_stare_angajati` → 0 rânduri pentru un cont revocat; trigger-gardă **statement-level** `trg_employees_00_cont_revocat` și `trg_hr_employees_private_00_cont_revocat`: orice INSERT / UPDATE / DELETE făcut cu JWT-ul unui cont revocat → 42501 (cron-ul, migrările, service_role — fără uid — și conturile active nu sunt atinse; toate traseele existente au trecut). Efect secundar voit: P1l (contul închis își reactivează singur fișa) e acum refuzat, nu doar fără efect. **Rămâne** fereastra pe RLS-ul celorlalte tabele (citiri / scrieri pe flaguri și `auth.uid()` până la expirarea JWT-ului) → D9 | R2-39 (P1a–g, P1l, ban fără jurnal, HR activ neafectat, restaurare) |
| 3 | **MEDIU latent** (P10) — `is_owner` și `role` pe `profiles` nepăzite pentru identitățile fără `auth.uid()` (bypass-ul `auth.uid() IS NULL` din `prevent_role_escalation` / `enforce_owner_only_salary_flags`): anon / authenticator cu claims golite / GoTrue printr-un RPC SECURITY DEFINER puteau pune `is_owner = true` — ancora identității „owner” a întregului pachet | c: `trg_profiles_protectie_legatura` refuză (42501) `is_owner` / `role` schimbate de o identitate neprivilegiată; trec doar owner JWT (Admin → Manageri), service_role, postgres fără claims (cron-ul 13 nu scrie `profiles`; închiderea / restaurarea nu ating `role` / `is_owner`) | R1-14b extins: 9 identități × `is_owner` / `role` (anon, authenticator, GoTrue → 42501; HR / simplu → P0001 din triggerul vechi; owner, service_role, postgres → trec) |
| 4 | SCĂZUT (P9c) — rollback-ul d trecea cu o intrare „flaguri” deschisă (cont închis pe calea HR cu flagurile încă TRUE, rămas așa fără jurnal și fără coadă) | rollback d: **„Gardă coadă flaguri”** — refuz 55000 cât timp există `tip='flaguri' AND rezolvat_la IS NULL` (inclusiv intrări oprite după limita de încercări); mesajul spune cum se rezolvă | harness: intrare de test → rollback-ul d refuzat din motivul corect, schema neschimbată |
| 5 | SCĂZUT — ordinea lock-urilor: sweep-ul bloca intrarea din coadă, apoi profilul; închiderea / restaurarea: profilul, apoi coada → posibil 40P01 | sweep-ul citește candidații FĂRĂ lock; pentru fiecare: persoana (garda, advisory) → profilul (FOR UPDATE) → intrarea (FOR UPDATE, recitită) → jurnalul; handler-ul de eroare ia și el profilul înaintea intrării. **Ordinea uniformă în pachet: persoană → profil → coadă / jurnal** | R2-42 (dblink, date confirmate: cât timp sweep-ul așteaptă profilul, tranzacția care ține profilul ia intrarea cu NOWAIT) |
| 6 | MINOR (X3) — un cont restaurat de owner se re-închidea la o corecție a datei de încetare | d: `fn_cont_restaurare_activa` (ultima închidere a contului e restaurată) → triggerul NU re-închide și NU programează cât timp nu e o **plecare nouă** (trecerea activ → inactiv); owner-ul primește `cont_inchidere_suspendata` („RESTAURAT de owner”); sweep-ul anulează o intrare mai veche decât restaurarea; alerta spune `restaurat` (nu `esuat_sau_neprins`), prioritate săptămânală în UI. Blocajul se ridică explicit: închiderea manuală a owner-ului sau o plecare nouă | R2-40 (corecție, dată viitoare, alertă, plecare nouă → închis din nou) |
| 7 | MINOR (X6) — coada reîncerca la nesfârșit și owner-ul primea o notificare la 5 minute după ce o citea | coada: `urmatoarea_incercare_la` (backoff 5 min · 2^(n-1), max. 6 h), **`abandonat_la` după 8 eșecuri** (intrarea rămâne DESCHISĂ: alerta `esuat_abandonat` / `flaguri_abandonate`, rollback-ul d o vede), `notificat_la` (o notificare la primul eșec — dacă nu a dat-o deja triggerul — și una la oprire, și după citire); un eveniment nou pe intrare = ciclu nou | R2-41 (3 rulări = 1 încercare, 7 eșecuri → +320 min, a 8-a → oprire + o notificare, nimic după citire, închiderea manuală rezolvă intrarea) |
| 8 | LOW (P12b) — alerta `fara_angajat` arăta emailul de logare schimbat și candidatul, fără niciun semn | `alocari` pe `fara_angajat`: `email_diferit` + `email_profil` (emailul de logare ≠ `profiles.email`) și `email_neconfirmat`; UI: „⚠️ Emailul de logare diferă de cel din profil (…)” | R1-21b (și emailul de LOGARE schimbat prin GoTrue), vitest |
| 9 | LOW, doar doc | ordinea de livrare (G.0), fusul orar (D12), P7b în A7 | — |
| 10 | Condiția Copilot (review plan v2, 30.09) — R1 nu se schimbă tacit | doc: A.3b (crearea autorizată vs înscrierea publică, contractul funcției `cont-nou`), A.2 (30a nu face retroactiv de încredere `profiles.email`; potrivirea = email de logare confirmat + marcaj), C.1 („fost angajat” ≠ acord). **Schimbare explicită în R1** (singura din runda 3): emailul de logare trebuie să fie **confirmat** (`email_confirmed_at`) — `fn_cont_leaga_la_creare` → `email_neconfirmat`, „Leagă automat” îl sare, alerta îl marchează | R1-36 |

**Rulare:** `bash scripts/test_conturi_ciclu_viata.sh --reaplica --rollback` → **426** aserțiuni pe fiecare trecere completă (26 în trecerea „doar BAZĂ”), **1308** în total, inclusiv gărzile harness-ului (ordine, coadă flaguri) și verificarea rollback-urilor **pas cu pas** (după rollback-ul lui e schema = cea de după d; după rollback-ul lui d = cea de după c). Aceeași rulare cu S-A extins (20260930a ca a doua precondiție): 1308/1308. `npx vitest run src/conturiCicluViata.test.js src/adminAlerte.test.js`: 68/68; `npx vite build`: OK.

**Ce NU s-a aplicat în runda 3 și de ce:**
- **Copierea CNP-urilor în `employees.cnp`** — respinsă (GDPR: `employees` e citibilă de orice cont logat). Garda citește `hr_employees_private` din funcții SECURITY DEFINER.
- **Blocarea scrierilor unui cont revocat pe TOATE tabelele** — doar `employees` și `hr_employees_private` (sursa gărzii și a închiderilor) + porțile R3 + `profiles` (deja). Restul tabelelor (RLS pe `auth.uid()` / flaguri) = hook-ul D9; o gardă pe fiecare tabelă ar fi o schimbare largă, în afara pachetului.
- **Fusul orar Europe/Bucharest pe server** — doar propus (D12): atinge `fn_employees_termination_notify` și cron-ul 13, deci trebuie schimbat tot odată, într-un lot separat.
- **Omonimia R3 cu o literă schimbată (P7b)** — neschimbată; se închide doar prin restrângerea politicilor de scriere pe `hr_personal_extern` (decizie de drepturi, A7).

**Decizii rămase pentru Răzvan (runda 3):** D7 refăcut (acoperirea CNP e aproape nulă), D9 (fereastra rămasă: acceptare de risc sau hook în fereastra de apply), D11 (cât de largă e regula „posibil alt contract”), D12 (fusul orar), ordinea de livrare (G.0).

---

## A. Migrarea 1 (R1): `20260929c_conturi_legare_automata.sql`

### A.1 Coloana `profiles.tip_cont`
```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tip_cont text
  CONSTRAINT profiles_tip_cont_chk CHECK (tip_cont IN ('angajat','extern','test','sistem'));
COMMENT ON COLUMN public.profiles.tip_cont IS 'NULL = nemarcat (tratat ca angajat). extern/test/sistem = excepție marcată o singură dată de owner, scoate contul din alerta „fără angajat”.';
```
Migrarea nu atinge datele. Marcarea celor 6 conturi nelegate e pas DML separat, cu confirmare (G.5).

### A.2 Potrivirea cont → angajat: `public.fn_cont_candidati_angajat(p_email text)`
`RETURNS TABLE(employee_id integer, employee_name text, metoda text, profil_legat uuid)`, `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp`. E funcție internă: `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated, service_role`.

Reguli exacte:
1. **Universul de căutare**: `employees.active IS TRUE AND (termination_date IS NULL OR termination_date > CURRENT_DATE)`.
2. **Pasul email** (orice domeniu): `lower(btrim(e.email)) = lower(btrim(p_email))`, cu `e.email` nenul și nevid (Răzvan are `''`).
   - Dacă găsește ≥1 potriviri, întoarce doar potrivirile pe email (`metoda='email'`) și **nu mai trece la pasul nume**. Două fișe cu același email înseamnă ambiguitate: contul nu se leagă.
3. **Pasul nume** (doar când pasul email n-a găsit nimic și domeniul e exact `gazpet.ro`):
   - tokeni = `array_remove(regexp_split_to_array(upper(extensions.unaccent(split_part(lower(btrim(p_email)),'@',1))), '[._-]+'), '')`;
   - trebuie să existe **cel puțin 2 tokeni distincți**. Un singur token (`popescu@`) nu se potrivește niciodată;
   - cuvintele numelui = `regexp_split_to_array(upper(extensions.unaccent(btrim(e.name))), '[[:space:]-]+')`;
   - potrivire = `cuvinte @> tokeni` **și** `cuvinte[1] = ANY(tokeni)`: fiecare token e un cuvânt întreg din nume, **în orice ordine**, iar numele de familie (primul cuvânt) e obligatoriu. Inițialele nu trec (`m.alexandru`, `konstantinos.t` dau 0), nici doar prenumele (`ana.maria@` → 0 pentru IONESCU ANA MARIA);
   - `extensions.unaccent` se scrie întotdeauna cu schema în față.
4. `profil_legat` = `profiles.id` care are deja acel `employee_id`, dacă există.

Pe cele 25 de legături reale, regula fără ordine găsește corect 22 și nu dă niciun fals pozitiv; cu numele de familie obligatoriu tot 22/22 (SELECT 29.09 seara, pe `auth.users.email`). Apelanții trimit întotdeauna emailul de **logare** (`auth.users.email`), niciodată `profiles.email`. Varianta cu ordinea „prenume.nume” ar fi ratat `apostol.andrut` și `titi.jeno`.

**Decizia de legare**, luată de apelant: se leagă numai dacă `count(*) = 1` **și** `profil_legat IS NULL`. Numărarea se face înainte de a exclude angajații deja legați: dacă ies 2 candidați și unul are deja cont, contul nou nu se leagă.

**Identitatea pe care se face potrivirea (condiția Copilot, review plan v2, 30.09 — runda 3):**
- potrivirea citește DOAR **emailul de logare** (`auth.users.email`), **confirmat** (`email_confirmed_at` nenul — runda 3, R1-36), niciodată `profiles.email`. Un profil cu `profiles.email ≠ auth.users.email` e `email_diferit` (sărit la legare, marcat în alertă — R1-21, R1-21b);
- legarea FĂRĂ om în buclă (calea de încredere, A.3b) cere în plus **marcajul** `raw_app_meta_data.gazpet_legare_automata = true`, pe care îl poate pune doar API-ul admin (service_role); legarea la cerere (A.5) o confirmă owner-ul pe perechi;
- **20260930a (S-A extins) NU face retroactiv de încredere `profiles.email`:** de la aplicarea lui, `email` se schimbă doar de owner / service_role / postgres, dar valorile existente au putut fi schimbate de titularul contului prin `profiles_update_own` până la apply-ul lui c (care le păzește din acel moment prin `trg_profiles_protectie_legatura`; 30a doar dublează paza în S-A). De aceea nimic din pachet nu folosește `profiles.email` ca identitate — doar ca etichetă afișată și, la calea de încredere, ca verificare suplimentară (trebuie să fie EGAL cu emailul de logare).

### A.3 `public.handle_new_user()` extinsă
Rămâne `SECURITY DEFINER`, cu `search_path` schimbat în `public, pg_temp`. Triggerul `on_auth_user_created` nu se atinge.

**Corecția 30.09 (0.2 #1):** triggerul NU mai face deloc `UPDATE … employee_id` (sub login-ul GoTrue S-A îl refuză). Pe calea de încredere legarea o face RPC-ul `fn_cont_leaga_la_creare` (A.3b), chemat de `cont-nou` cu service_role; `cont_nelegat` pleacă pe orice domeniu la eroare și pe calea de încredere. Textul următor descrie varianta din 29.09 (istoric). **După review (0.1), comportamentul era:** potrivirea rulează la fiecare cont nou, dar `UPDATE … employee_id` se face **doar** dacă `NEW.raw_app_meta_data ->> 'gazpet_legare_automata' = 'true'` (calea de încredere: `auth.admin.createUser({…, app_metadata:{gazpet_legare_automata:true}})` cu `service_role`, din viitoarea funcție edge `cont-nou` cu poartă owner). Pe signUp public și pe Dashboard → Add user: contul rămâne nelegat și owner-ii primesc `cont_legare_propusa` („Cont nou X → propunere: NUME (#id, prin email/nume). Dacă tu ai creat contul, confirmă din Admin → Manageri → „Leagă automat”. Dacă nu-l recunoști, NU-l lega și închide-l.”) — pe orice domeniu. `cont_nelegat` rămâne pentru @gazpet.ro cu 0 / >1 candidați / candidat ocupat / eroare. Schița de mai jos e varianta inițială (legare la orice înscriere) — vezi codul din migrare.
```sql
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (NEW.id, NEW.email,
          INITCAP(REPLACE(REPLACE(SPLIT_PART(NEW.email,'@',1),'.',' '),'_',' ')), 'manager_santier')
  ON CONFLICT (id) DO NOTHING;                       -- neschimbat

  -- R1 sub-bloc 1: legarea. Nicio eroare de aici nu are voie să blocheze crearea contului.
  BEGIN
    SELECT count(*), min(employee_id), min(employee_name), bool_or(profil_legat IS NOT NULL)
      INTO v_n, v_emp, v_nume, v_ocupat
      FROM public.fn_cont_candidati_angajat(NEW.email);
    IF v_n = 1 AND NOT v_ocupat THEN
      UPDATE public.profiles SET employee_id = v_emp
       WHERE id = NEW.id AND employee_id IS NULL;     -- nu suprascrie niciodată
      v_legat := FOUND;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user R1 (%): % [%]', NEW.email, SQLERRM, SQLSTATE;
  END;

  -- R1 sub-bloc 2: notificarea owner-ilor (separat, ca o eroare aici să nu anuleze legarea)
  BEGIN
    -- v_legat         → 'cont_legat_automat': „🔗 Cont nou <email> legat automat de <NUME> (#id, prin email/nume)”
    -- nelegat & @gazpet.ro → 'cont_nelegat': „⚠️ Cont nou <email> nelegat: <0 candidați | N candidați | candidatul unic are deja cont>”
    PERFORM public.fn_cont_notifica_owneri(...);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING '...'; END;
  RETURN NEW;
END;
```
- Pe INSERT **nu** se pune `employee_id` direct, pentru că indexul unic `uniq_profiles_employee_id` ar face INSERT-ul să pice, și odată cu el crearea contului. Legarea se face printr-un UPDATE separat, în sub-bloc cu `EXCEPTION`.
- `createManager` face după aceea `profiles.upsert({id,email,name,role,department})`. Upsert-ul scrie doar coloanele primite, deci păstrează `employee_id`.
- **Helper intern** `public.fn_cont_notifica_owneri(p_type text, p_title text, p_message text, p_link text DEFAULT '/admin')`:
  - inserează în `notifications` câte un rând pentru fiecare `profiles.is_owner = true`, cu `modul='HR'` (valoare permisă de CHECK);
  - dedupe: sare peste owner-ul care are deja o notificare necitită cu același `type` și același `message`;
  - are propriul `BEGIN … EXCEPTION → RAISE WARNING`, deci nu blochează niciodată apelantul;
  - REVOKE de la PUBLIC, anon, authenticated, service_role.

### A.3b Crearea AUTORIZATĂ a contului vs înscrierea publică (condiția Copilot: R1 nu se schimbă tacit)
Sunt trei căi de creare a unui cont GoTrue; **doar una** leagă fișa fără om în buclă, iar ea e definită explicit aici.

| Cale | Cine | Ce face R1 |
|---|---|---|
| **Înscrierea publică** — `supabase.auth.signUp` cu cheia anon (`createManager` azi; D1/D10: de oprit înainte de GO) | oricine are cheia anon (e în bundle) | `handle_new_user`: profil nelegat, rol `manager_santier`; owner-ul primește **propunerea** `cont_legare_propusa` (sau `cont_nelegat`). **Niciodată legare.** `raw_app_meta_data` nu poate fi pus din signUp → fără marcaj |
| **Dashboard → Add user** | owner, manual | la fel ca înscrierea publică (fără marcaj): propunere; legarea o confirmă owner-ul din Admin → Manageri → „🔗 Leagă automat” (perechi confirmate, A.5) sau Edit → Fișă angajat |
| **Crearea autorizată = funcția edge `cont-nou`** (**NU există încă**; până atunci: calea de mai sus) | doar owner-ul, prin UI | contractul ei, fixat de pachet: (1) **poartă de rol în cod** — citește JWT-ul apelantului și cere `profiles.is_owner` (NU doar `verify_jwt`: cheia anon e un JWT valid, CLAUDE.md pct. 7d); (2) `auth.admin.createUser({ email, email_confirm: true, app_metadata: { gazpet_legare_automata: true } })` cu cheia service; (3) `rpc('fn_cont_leaga_la_creare', { p_profile_id })` cu cheia service → RPC-ul reverifică atomic (profil `FOR UPDATE` + index unic): marcajul, **emailul de logare confirmat** (runda 3), legătura liberă, `tip_cont`, `profiles.email` = emailul de logare, candidatul UNIC și liber; întoarce `legat` / `email_neconfirmat` / `fara_marcaj_incredere` / `ambiguu` / … și anunță owner-ul (`cont_legat_automat` / `cont_nelegat`); (4) întoarce rezultatul în UI. Fișa ei în `registru_automatizari` se scrie înainte de livrare: (a) emailul tastat de owner — nu conținut extern; (b) creează un cont + leagă o fișă (acces la semnătura de pe fișă); (c) service_role, justificat de API-ul admin GoTrue; (d) poartă owner în cod; (e) owner-ul care o pornește = confirmarea umană. |

`fn_cont_leaga_la_creare` acceptă DOAR identitățile `service_role` (funcția `cont-nou`) și `owner` (JWT); postgres fără claims, GoTrue, authenticator, HR, contul însuși, anon → 42501 (R1-31). Fără marcaj → `fara_marcaj_incredere`, chiar și cu service_role (R1-32).

### A.4 Protejarea legăturii: `public.fn_profiles_protectie_legatura()` + trigger `trg_profiles_protectie_legatura`
Trigger `BEFORE UPDATE ON profiles FOR EACH ROW`, funcție `SECURITY DEFINER SET search_path = public, pg_temp`.
```sql
IF auth.uid() IS NOT NULL
   AND (NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.tip_cont IS DISTINCT FROM OLD.tip_cont)
   AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_owner) THEN
  RAISE EXCEPTION 'Doar owner poate lega un cont de o fișă sau marca tipul contului' USING ERRCODE = '42501';
END IF;
RETURN NEW;
```
- Închide o gaură existentă: `profiles_update_own` permite oricui să-și pună singur `employee_id` = orice angajat nelegat (96 de angajați activi n-au cont). Asta dă acces la semnătura electronică a acelui angajat, prin `my_employee_id()`.
- **După review:** refuză și schimbarea `profiles.email` de către non-owner (potrivirea nu se mai poate falsifica, notificările nu pot fi deturnate), iar pe un cont cu închidere nerestaurată (R2) refuză **orice** UPDATE de la non-owner (JWT-ul emis înainte de închidere rămâne valabil până la o oră). Referința la `conturi_inchideri_jurnal` e păzită de `to_regclass` (c rămâne independentă de d).
- **Corecția 30.09 (0.2 #4):** poarta nu mai e `auth.uid()` (codul de mai sus e istoric), ci `fn_identitate_privilegiata() IS NOT NULL` — aceeași regulă ca S-A: owner JWT, service_role JWT, login postgres/supabase_admin fără claims. GoTrue (`supabase_auth_admin`), `authenticator` cu claims golite și anon printr-un RPC SECURITY DEFINER sunt refuzați (R1-14b).
- **Relația cu S-A (live):** ordinea BEFORE UPDATE pe `profiles` (alfabetică): `prevent_role_escalation_trigger` → `trg_enforce_owner_only_salary_flags` → `trg_profiles_campuri_owner_only` (S-A) → `trg_profiles_protectie_legatura` → `trg_protect_can_access_pontaj_brut`. S-A decide primul pe `department` / `employee_id`; `tip_cont`, `email` și contul închis le păzește doar protecția. Mesajele diferă, SQLSTATE e același (42501): UI-ul și testele se bazează pe SQLSTATE. Un `sub` care nu e uuid dă 22P02 din triggerele VECHI (`auth.uid()`), tot refuz. S-A NU refuză doar „authenticated non-owner”: refuză și login-urile fără claims în afară de postgres/supabase_admin — de aceea `handle_new_user` nu mai scrie în `profiles`.
- Cron-ul (login postgres) și migrările trec prin identitatea explicită `db_login`, nu prin „lipsa identității”. UI-ul nu scrie nicăieri `employee_id` în afara modalului de owner (D.3).
- **Runda 3 (P10):** și `is_owner` / `role` trec doar de o identitate privilegiată explicită (42501 altfel). Triggerele vechi `prevent_role_escalation` / `enforce_owner_only_salary_flags` au bypass „`auth.uid() IS NULL`” → anon / authenticator cu claims golite / GoTrue printr-un RPC SECURITY DEFINER puteau pune `is_owner = true` (ancora „owner” a tuturor porților pachetului) sau `role = superadmin`. Owner-ul din UI (JWT), service_role și postgres trec; un authenticated non-owner e refuzat înainte, de `prevent_role_escalation` (P0001). Matricea R1-14b acoperă 9 identități × `employee_id` / `tip_cont` / `is_owner` / `role`.

### A.5 Legarea la cerere, cu previzualizare: `public.fn_cont_leaga_automat(p_simulare boolean DEFAULT true, p_confirmate jsonb DEFAULT NULL)`
- **Corecția 30.09 (0.2 #6):** aplicarea (`p_simulare=false`) cere `p_confirmate = [{profile_id, employee_id}]` (lista din previzualizare, 22023 fără ea) și leagă doar perechile care se potrivesc încă; rezultate noi `neconfirmat` (cont apărut după previzualizare) și `schimbat`. Coloane noi: `cont_provider`, `cont_incredere`. Poarta: `fn_identitate_privilegiata() = 'owner'`. EXECUTE doar `authenticated` (P3). Punctele de mai jos descriu restul, neschimbat.
- `RETURNS TABLE(profile_id uuid, email text, rezultat text, employee_id integer, employee_name text, metoda text, cont_creat_la timestamptz)` (după review: `email` = emailul de logare, plus metoda și data creării contului, ca owner-ul să recunoască un cont pe care nu l-a creat). Semnătura s-a schimbat → migrarea face `DROP FUNCTION IF EXISTS … (boolean)` înainte de `CREATE`.
- Rezultatele posibile: `legat`, `de_legat` (în simulare), `ambiguu` (mai mulți candidați **sau** mai multe conturi nelegate cu același candidat unic), `fara_candidat`, `candidat_ocupat`, `email_diferit` (`profiles.email ≠ auth.users.email`: sărit, de verificat manual), `eroare`.
- **Poartă în cod:** `auth.uid()` nenul și profilul apelantului are `is_owner`; altfel `RAISE … ERRCODE '42501'`.
- Parcurge doar profilurile cu `employee_id IS NULL AND COALESCE(tip_cont,'angajat') = 'angajat'`.
- `p_simulare=true` nu scrie nimic. Cu `false`, face `UPDATE … WHERE employee_id IS NULL`, fiecare rând în sub-bloc cu EXCEPTION.
- Drepturi: GRANT EXECUTE TO authenticated; REVOKE FROM PUBLIC, anon.
- Acoperă cazul „contul a apărut înaintea fișei”. Nu adăugăm trigger pe `employees` INSERT, ca să păstrăm suprafața de automatizare mică.
- **Runda 3 (condiția Copilot):** un cont cu emailul de logare **neconfirmat** iese `email_neconfirmat` (sărit, ca `email_diferit`); owner-ul îl leagă manual după confirmare. În producție confirmarea e automată la înscriere, deci azi nu schimbă nimic; contează pentru invitații neacceptate / Dashboard fără auto-confirmare. `App.jsx` afișează motivul în previzualizare.

### A.6 Diagnosticul pentru alertă: `public.fn_admin_conturi_alerte()` + view-ul `public.v_admin_conturi_alerte`
Semnătura se fixează **definitiv** din migrarea 1. Migrarea 2 face `CREATE OR REPLACE` cu aceeași semnătură, ca view-ul să nu se rupă.
```sql
RETURNS TABLE(id text, cod text, profile_id uuid, email text, tip_cont text, is_owner boolean,
              employee_id integer, employee_name text, employee_active boolean, termination_date date,
              banned_until timestamptz, jurnal_id bigint, inchis_la timestamptz,
              candidati jsonb, alocari jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
```
- **Poartă:** `auth.uid()` nenul și apelantul e owner; altfel `RAISE EXCEPTION … ERRCODE '42501'`. `incarcaSursaAdmin` transformă codul 42501 în starea `denied`. În migrarea 1 funcția întoarce doar `cod='fara_angajat'`: `employee_id IS NULL AND COALESCE(tip_cont,'angajat')='angajat'`, oricare ar fi domeniul, cu `candidati` = `jsonb_agg` din `fn_cont_candidati_angajat(auth.users.email)`; coloana `email` = emailul de logare (`COALESCE(u.email::text, p.email)`).
- `id` = `cod || ':' || COALESCE(profile_id::text, 'e' || employee_id)`. E text, unic și se poate ordona, cum cere `citesteToate`.
- **View:** `CREATE VIEW public.v_admin_conturi_alerte WITH (security_invoker = on) AS SELECT * FROM public.fn_admin_conturi_alerte();`
  - GRANT SELECT pe view și EXECUTE pe funcție TO authenticated; REVOKE ALL FROM anon; REVOKE EXECUTE FROM PUBLIC.
  - `auth.users` (banned_until) se citește **numai** în funcția SECURITY DEFINER; `authenticated` nu primește niciun drept pe schema `auth`.
- **Runda 3 (P12b):** pe `fara_angajat`, `alocari` poartă marcajele de identitate: `email_diferit` + `email_profil` (emailul de logare ≠ `profiles.email`, ex. adresa de logare schimbată prin GoTrue spre adresa de serviciu a altcuiva) și `email_neconfirmat`. UI-ul le afișează înaintea candidaților („⚠️ Emailul de logare diferă de cel din profil (…)”). Corpul din c e copiat IDENTIC în rollback-ul d (verificat de harness: după rollback-ul d schema = cea de după c).
- **Cine are acces:** `adminAlerte.js` cere cheia `admin_alerte` (o are doar Răzvan) plus modulul sursei. Administrarea conturilor e oricum doar a owner-ului (tab-ul Manageri din /admin), deci sursa e **doar owner**, atât în BD, cât și în UI (`ownerOnly`, D.4).

### A.7 Drepturi și igienă (CLAUDE.md pct. 4)
- Toate funcțiile noi: `SECURITY DEFINER SET search_path = public, pg_temp`.
- Cele interne primesc `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated, service_role`. Doar `REVOKE FROM PUBLIC` nu ajunge: testul T6 arată că Supabase dă EXECUTE implicit lui anon.
- Migrarea trebuie să ruleze de două ori fără erori (`CREATE OR REPLACE`, `IF NOT EXISTS`, `DROP TRIGGER IF EXISTS` urmat de `CREATE TRIGGER`). Nu se folosesc construcții care există doar în PG 17.

---

## B. Migrarea 2 (R2): `20260929d_conturi_inchidere_la_incetare.sql`

### B.1 Ce închide și ce NU atinge
| Se închide (cu snapshot) | Nu se atinge |
|---|---|
| `user_module_access` (DELETE) | `role`, `department`, `is_owner`, `name`, `email`, `phone_whatsapp`, `whatsapp_tier` |
| `profile_sites` (DELETE). Sunt drepturi pe șantiere, pe care UI-ul le șterge și le reinserează la editare. Rândurile opresc mailurile `reminder-rapoarte`; Sorin mai are unul. | legătura `profiles.employee_id`, care rămâne pentru istoric și restaurare |
| cele 22 de flaguri booleene `^(can_\|receive_\|email_notifications_)` și `whatsapp_enabled` → false | pontaje, aprobări, documente, `notifications` (inclusiv cele 393 necitite ale lui Sorin), `chat_members` |
| `auth.users.banned_until = '2999-12-31 00:00:00+00'` (aceeași valoare ca la închiderea manuală; nu folosim `infinity`, GoTrue citește data ca timestamp) | alocările de flux (D3): `comenzi_aprobatori`, `necesar_responsabili`, `hr_aprobatori`, `marketing_aprobatori`, `hr_concediu_rute`, `tichete_default_responsabili`, `hr_recrutare_pozitii.responsabil_id`. Primesc doar alertă. |
| `auth.refresh_tokens.revoked = true` (`user_id` e **varchar**, se compară cu `id::text`) + `DELETE FROM auth.sessions` (`user_id` e uuid; tokenii legați cad prin `ON DELETE CASCADE`) | `ofertare_licitatii.responsabil_id`: modul înghețat, se documentează doar |

**Risc rezidual:** un JWT de acces deja emis rămâne valabil până la expirare (setarea „JWT expiry” din Auth, 3600 s în producție). Revocarea sesiunii oprește doar reîmprospătarea lui. **Corecția 30.09:** refresh tokenurile și sesiunile se ȘTERG; hook-ul `fn_pgrst_pre_request` (B.5c) închide fereastra pentru PostgREST după activare (D9); Storage / Realtime rămân acoperite doar de un JWT expiry mai scurt.

Lista de flaguri se calculează la rulare, în `public.fn_cont_flaguri() RETURNS text[]` (STABLE, internă), din `pg_attribute`:
- condiții: coloanele booleene din `profiles` cu `attname ~ '^(can_|receive_|email_notifications_)|^whatsapp_enabled$'` și `attname <> 'is_owner'`;
- azi dau exact 22, verificat pe 29.09;
- un flag nou care respectă convenția de nume intră automat. Testul R2-00 fixează lista, ca schimbarea să nu treacă neobservată.

### B.2 Jurnalul append-only: `public.conturi_inchideri_jurnal`
```sql
CREATE TABLE public.conturi_inchideri_jurnal (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id      uuid NOT NULL,          -- fără FK: jurnalul supraviețuiește ștergerii contului
  email           text NOT NULL,
  employee_id     integer,                -- fără FK (append-only; un SET NULL ar fi blocat)
  motiv           text NOT NULL CHECK (length(btrim(motiv)) >= 5),
  sursa           text NOT NULL CHECK (sursa IN ('trigger_contract_incheiat','manual_owner','import_manual')),
  snapshot        jsonb NOT NULL,         -- {versiune:1, flaguri:{…}, module:[…], santiere:[…], banned_until, profil:{role,department,name,email}, rezumat:{…}}
  facut_de        uuid,                   -- auth.uid() al declanșatorului; NULL = sistem (cron / migrare)
  facut_la        timestamptz NOT NULL DEFAULT now(),
  restaurat_de    uuid,
  restaurat_la    timestamptz,
  restaurare_nota text,
  CONSTRAINT conturi_inchideri_restaurare_chk CHECK ((restaurat_de IS NULL) = (restaurat_la IS NULL))
);
CREATE UNIQUE INDEX uq_conturi_inchidere_deschisa ON public.conturi_inchideri_jurnal(profile_id) WHERE restaurat_la IS NULL;
CREATE INDEX idx_conturi_inchideri_employee ON public.conturi_inchideri_jurnal(employee_id);
```
- **Append-only**, prin `trg_conturi_inchideri_append_only` (BEFORE UPDATE OR DELETE, FOR EACH ROW) și un trigger BEFORE TRUNCATE pe instrucțiune:
  - DELETE și TRUNCATE sunt refuzate întotdeauna;
  - UPDATE e permis **doar** o dată, trecând `restaurat_de/la/restaurare_nota` din NULL în valori, cu toate celelalte coloane neschimbate.
- **RLS activ**, cu o singură politică: `SELECT TO authenticated USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_owner))`.
  - Fără politici de scriere.
  - `REVOKE ALL … FROM anon`; `REVOKE INSERT, UPDATE, DELETE, TRUNCATE … FROM authenticated`; `GRANT SELECT … TO authenticated`; `GRANT ALL … TO service_role`.
  - Scrierea se face numai prin funcțiile SECURITY DEFINER de mai jos.
- Indexul unic parțial face idempotența sigură și la rulări simultane: pentru un profil poate exista cel mult o închidere nerestaurată.

### B.3 `public.fn_cont_inchide(p_profile_id uuid, p_motiv text, p_sursa text, p_employee_id integer DEFAULT NULL) RETURNS text`
Funcție internă (REVOKE de la PUBLIC, anon, authenticated, service_role), `SECURITY DEFINER SET search_path = public, pg_temp`. Întoarce `'inchis' | 'deja_inchis' | 'sarit_owner' | 'inexistent'`.
```sql
v_actor  := auth.uid();                                   -- se reține ÎNAINTE de a goli claims
v_claims := current_setting('request.jwt.claims', true);
v_sub    := current_setting('request.jwt.claim.sub', true);
SELECT * INTO v_p FROM public.profiles WHERE id = p_profile_id FOR UPDATE;   -- serializează pe profil
IF NOT FOUND THEN RETURN 'inexistent'; END IF;
IF v_p.is_owner THEN                                      -- SIGURANȚĂ: owner-ul nu se închide niciodată automat
  PERFORM fn_cont_notifica_owneri('cont_owner_neinchis', '⚠️ Contract încheiat pentru un OWNER', …);
  RETURN 'sarit_owner';
END IF;
SELECT id INTO v_jurnal FROM conturi_inchideri_jurnal WHERE profile_id = p_profile_id AND restaurat_la IS NULL;
IF v_jurnal IS NULL THEN
  v_snap := {versiune:1, flaguri: to_jsonb(v_p) restrâns la fn_cont_flaguri(),
             module: [{module, access_level, granted_at, granted_by}] ORDER BY module,
             santiere: [rândurile profile_sites fără id/profile_id],
             banned_until: auth.users.banned_until (valoarea de dinainte),
             profil: {role, department, name, email},
             rezumat: {module:n, santiere:n, flaguri_true:n, sesiuni:n, refresh_tokens_active:n}};
  INSERT INTO conturi_inchideri_jurnal(profile_id, email, employee_id, motiv, sursa, snapshot, facut_de)
  VALUES (…, v_actor) RETURNING id INTO v_jurnal;
  v_rez := 'inchis';
ELSE
  v_rez := 'deja_inchis';                                 -- NU suprascrie primul snapshot
END IF;
-- aplicarea e convergentă: rulează și pe 'deja_inchis', ca să scoată un acces redat manual între timp
DELETE FROM user_module_access WHERE profile_id = p_profile_id;
DELETE FROM profile_sites      WHERE profile_id = p_profile_id;
PERFORM set_config('request.jwt.claims', '', true);       -- auth.uid() devine NULL, deci cele 3 triggere
PERFORM set_config('request.jwt.claim.sub', '', true);    -- owner-only de pe profiles nu mai anulează resetarea
EXECUTE format('UPDATE public.profiles SET %s WHERE id = $1',
               (SELECT string_agg(format('%I = false', f), ', ') FROM unnest(fn_cont_flaguri()) f)) USING p_profile_id;
PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub, ''), true);
UPDATE auth.users SET banned_until = '2999-12-31 00:00:00+00'
 WHERE id = p_profile_id AND (banned_until IS NULL OR banned_until < '2999-12-31 00:00:00+00');
UPDATE auth.refresh_tokens SET revoked = true, updated_at = now()
 WHERE user_id = p_profile_id::text AND revoked IS DISTINCT FROM true;
DELETE FROM auth.sessions WHERE user_id = p_profile_id;
IF v_rez = 'inchis' THEN PERFORM fn_cont_notifica_owneri('cont_inchis_automat', '🔒 Cont închis: <email>', '<motiv> · jurnal #<id>'); END IF;
RETURN v_rez;
```
**Notificările** (`cont_owner_neinchis`, `cont_inchis_automat`) sunt best-effort, fiecare în `BEGIN … EXCEPTION → RAISE WARNING`: închiderea rămâne făcută și dacă notificarea pică (inclusiv funcția lipsă după un rollback în ordine greșită).

**Corecția 30.09 (0.2 #2) — schița de mai sus e ISTORICĂ.** `fn_cont_inchide` nu mai golește claims (era impersonarea „lipsei identității”, interzisă de modelul aprobat). Cu identitate privilegiată explicită (owner, service_role, db_login = pg_cron / migrare) flagurile se pun pe false pe loc; pe calea HR (identitate neprivilegiată) tot restul se revocă pe loc, flagurile intră în `conturi_inchideri_coada` (`tip='flaguri'`) și le pune pe false `fn_conturi_inchideri_sweep` (pg_cron `conturi_inchideri_coada`, la 5 minute, login postgres). Jurnalul primește `facut_de_identitate`. Refresh tokenurile se șterg (nu doar se revocă). Sursa nouă `coada_contract_incheiat` = închidere făcută de sweep.

**Capcana cu triggerele owner-only (istoric, motivul variantei vechi).** Când închiderea o declanșează cineva din HR care nu e owner (`can_modify_employees`, adică Natalia, Oana, Cristina, Mădălina, Cristiana sau `claude@`), `auth.uid()` rămâne cel al acelui om. Atunci `trg_enforce_owner_only_salary_flags` pune la loc, **fără nicio eroare**, 8 flaguri, iar testul T3 confirmă asta. Soluția (a) de mai sus rezolvă problema fără să modifice cele 3 triggere existente:
- Claims se golesc doar în funcția internă, pe care niciun client nu o poate apela, și doar pentru UPDATE-ul care pune flagurile pe false.
- `set_config(…, true)` e local tranzacției. Dacă apare o eroare după golire, anularea subtranzacției readuce singură valorile GUC. Pe drumul normal le restaurăm explicit, pentru că o funcție cu `SET search_path` **nu** restaurează alte GUC-uri la ieșire.
- **Interzis:** să pui `SET "request.jwt.claims" = ''` în definiția funcției. În producție `postgres` nu e superuser, deci `CREATE FUNCTION` ar da „permission denied to set parameter”. Local ar trece, pentru că acolo e superuser. Ar fi un test verde care minte.

### B.4 Wrapper-ul pentru owner: `public.fn_cont_inchide_owner(p_profile_id uuid, p_motiv text) RETURNS text`
- **Poartă în cod:** `fn_identitate_privilegiata() = 'owner'` (corecția 30.09); altfel eroare 42501. Apoi apelează `fn_cont_inchide(…, 'manual_owner', <employee_id-ul profilului>)` — owner-ul are identitate privilegiată, deci închiderea e completă pe loc (R2-17), și cu S-A extins.
- Se folosește pentru acțiunile din alertă: cont extern, cont activ pentru un angajat inactiv fără dată de încetare, dezactivare făcută înainte de data încetării.
- GRANT EXECUTE TO authenticated; REVOKE FROM PUBLIC, anon.

### B.3a Garda „aceeași persoană”: `public.fn_cont_garda_persoana(p_employee_id)` (runda 3: ambele surse de CNP + nume / email)
- **CNP-ul fișei** = `fn_cont_persoana_cnp(id)`: valorile normalizate (litere + cifre, majuscule) din `hr_employees_private.cnp` (sursa aplicației, UNIQUE) și `employees.cnp` (wizard); „CNP cunoscut” = `COALESCE(NULLIF(hp.cnp,''), e.cnp)` nenul, iar dacă sursele diferă contează ambele.
- Întoarce, DUPĂ lock: `cnp_lipsa` (niciun CNP, D7) · `alt_contract_activ:<id>` (altă fișă ACTIVĂ cu un CNP comun, în oricare sursă) · `posibil_alt_contract:<id>` (altă fișă ACTIVĂ **fără niciun CNP**, cu același email sau cu același nume de familie — familia fiecăreia printre cuvintele celeilalte, `fn_nume_cuvinte` / `fn_nume_familie`; D11) · NULL = se poate închide. Orice rezultat nenul → NU se închide automat, doar `cont_inchidere_suspendata` + motivul în alertă.
- **Lock pe persoană** (`pg_advisory_xact_lock`, ținut până la COMMIT) pe chei: `gazpet.persoana:<CNP>` (fiecare CNP), `gazpet.persoana.nume:<CUVÂNT>` (fiecare cuvânt al numelui), `gazpet.persoana.email:<email>`; luate în ordinea hash-ului (aceeași ordine în orice tranzacție), recalculate după lock (max. 3 treceri). Aceleași chei le iau `trg_employees_persoana_lock` (INSERT și UPDATE OF cnp, active, termination_date, name, email — dar nu scrierile care DOAR încheie / dezactivează, ca lotul cron-ului 13) și `trg_hr_employees_private_persoana_lock` (INSERT / UPDATE OF cnp, employee_id / DELETE) → nici o fișă nouă (și fără CNP, X2), nici un CNP pus în datele personale nu se strecoară între verificare și închidere (R2-28d, R2-28e-lock).
- Contenția: un INSERT / o redenumire pe `employees` așteaptă o închidere în curs care are un cuvânt comun în nume (milisecunde, o cerere PostgREST = o tranzacție). Deadlock posibil doar între două instrucțiuni multi-rând concurente (ex. un import mare în timpul cron-ului) — PostgreSQL îl detectează (40P01) și anulează una; lotul cron-ului nu mai ia chei pe dezactivări, deci nu intră în asta.

### B.3b Contul revocat nu mai lucrează (runda 3, X10 / P1)
- `fn_identitate_revocata(uid)` (c) = închidere nerestaurată în jurnal sau `banned_until > now()`. Un astfel de cont, cu JWT-ul emis înainte de închidere (valabil ≤ 1 h până la D9) și cu flagurile încă TRUE (calea HR, până la coadă):
  - nu mai e „om” (`fn_identitate_om` = NULL) → acordul R3, „Trece ca extern”, legarea / dezlegarea externilor → 42501;
  - nu mai scrie `employees` și `hr_employees_private`: `trg_employees_00_cont_revocat` / `trg_hr_employees_private_00_cont_revocat` (BEFORE, FOR EACH STATEMENT) → 42501 (nu mai poate încheia contractul altcuiva = închide contul altuia, goli CNP-uri, edita fișe, se reactiva singur);
  - `fn_cont_stare_angajati` → 0 rânduri.
- Cron-ul, migrările, service_role (fără uid) și conturile active nu sunt atinse. Restul tabelelor rămân pe RLS până la D9 (fereastra din D9).

### B.5 Triggerul pe employees: `public.fn_employees_ciclu_cont()` + `trg_employees_zz_ciclu_cont`
```sql
CREATE TRIGGER trg_employees_zz_ciclu_cont AFTER UPDATE ON public.employees FOR EACH ROW
  WHEN (OLD.active IS DISTINCT FROM NEW.active)
  EXECUTE FUNCTION public.fn_employees_ciclu_cont();
```
Funcția e `SECURITY DEFINER SET search_path = public, pg_temp` și întoarce NULL.
- **true → false**, pentru fiecare `profiles.employee_id = NEW.id`:
  - dacă `NEW.termination_date IS NOT NULL AND NEW.termination_date <= CURRENT_DATE`: apelează `fn_cont_inchide(pid, format('Contract încheiat la %s (fișa #%s)', …), 'trigger_contract_incheiat', NEW.id)` în sub-bloc `BEGIN … EXCEPTION WHEN OTHERS`. La eroare trimite notificarea `cont_inchidere_esuata` cu SQLERRM. **Nu blochează niciodată** UPDATE-ul din HR și nici lotul cron-ului;
  - altfel (fără dată, sau cu dată în viitor): **nu închide**, trimite doar notificarea `cont_angajat_inactiv_fara_incetare`.
- **false → true** (reactivare): **nu redă nimic**. Dacă există o închidere nerestaurată, trimite notificarea `cont_angajat_reactivat` („accesul NU a fost redat automat; restaurarea din jurnal o face doar owner-ul”).
- `active` NULL nu declanșează nimic, pentru că verificarea e `IS TRUE` / `IS FALSE`.
- Toate notificările din trigger (inclusiv cea din handler-ul de eroare) sunt în propriul `BEGIN … EXCEPTION`: nici o notificare lipsă nu blochează UPDATE-ul din HR sau lotul cron-ului (R2-26).
- **Limită cunoscută:** o fișă dezactivată ÎNAINTE de data încetării (cu dată viitoare) nu mai e prinsă când data trece (cron-ul filtrează `active = true`) → rămâne alerta critică `cont_activ_fost_angajat` + „Închide contul acum”. `toggleEmp` folosește ziua BD (UTC), deci „Dezact.” nu mai creează singur cazul ăsta noaptea.

**Corecția 30.09 (0.2 #3, #10, #11):** `WHEN (OLD.active IS DISTINCT FROM NEW.active OR OLD.termination_date IS DISTINCT FROM NEW.termination_date)`. La închidere: garda `fn_cont_garda_persoana` (CNP, lock pe persoană, ÎNAINTEA subtranzacțiilor) → alt contract activ / CNP lipsă → `cont_inchidere_suspendata`, fără închidere; cont `extern`/`test`/`sistem` → la fel; eroare → coadă `reincercare` + `cont_inchidere_esuata`; cont nelegat cu emailul fișei → `cont_posibil_aceeasi_persoana`; dezactivare cu dată în viitor → coadă `programata`; reactivare → programările / reîncercările se anulează. Limita „fișă dezactivată înainte de dată” de mai jos e închisă de coadă.
**Runda 3:** garda citește CNP-ul din ambele surse și are `posibil_alt_contract` (B.3a); conturile legate de celelalte fișe încheiate ale aceleiași persoane se caută tot pe ambele surse. **Cont restaurat de owner** (`fn_cont_restaurare_activa`: ultima închidere a contului e restaurată) + fără plecare nouă (`OLD.active` nu era TRUE: corecția datei, data pusă ulterior pe o fișă inactivă) → NU se re-închide și NU se programează; owner-ul primește `cont_inchidere_suspendata` („RESTAURAT de owner (jurnal #…)”). O plecare nouă (fișa trece din activă în inactivă) sau închiderea manuală a owner-ului ridică blocajul (R2-40).

**De ce AFTER UPDATE, cu WHEN pe `active`, și nu `UPDATE OF active`:**
- **Calea UI** `saveEditEmp` trimite doar `termination_date`. `fn_employees_termination_notify` (BEFORE) pune `NEW.active=false`. Un trigger `UPDATE OF active` **nu ar porni**, pentru că nu ține cont de schimbările făcute de triggerele BEFORE. Triggerul AFTER vede NEW final. Același lucru pentru `toggleEmp`, care trimite `active` (și `termination_date`).
- **Calea cron** (`hr_auto_deactivate_terminated`, jobul 13, 04:00 UTC, rulează ca postgres fără JWT) face `UPDATE active=false`, fără să schimbe `termination_date`. Primul bloc din triggerul BEFORE nu se execută, dar AFTER prinde tranziția. În jurnal apare `facut_de = NULL`, adică „sistem”.
- **Jobul cron și `fn_employees_termination_notify` nu se modifică.** Nu există alte triggere AFTER UPDATE pe employees, iar sufixul `zz` doar fixează ordinea față de viitorul trigger R3.

### B.6 Restaurarea: `public.fn_cont_restaureaza(p_jurnal_id bigint, p_nota text, p_simulare boolean DEFAULT false) RETURNS jsonb`
- **Corecția 30.09:** poarta `fn_identitate_privilegiata() = 'owner'`; lock pe profil ÎNAINTEA jurnalului (ordinea din `fn_cont_inchide`); `p_simulare=true` întoarce ce s-ar reda (module, șantiere, flaguri, ban) fără nicio scriere; restaurarea anulează intrările deschise din coadă, iar după ea **nimic nu re-închide automat contul până la o acțiune explicită**: închiderea manuală a owner-ului sau o plecare NOUĂ (fișa redevine activă și se încheie iar). Corecțiile datei pe fișa încă inactivă nu îl mai re-închid (runda 3, X3 — înainte îl re-închideau). EXECUTE doar `authenticated`.
- **Poartă în cod:** `auth.uid()` nenul și profilul apelantului are `is_owner`; altfel eroare 42501. Asta respinge și cron-ul, `service_role`, anon și orice non-owner.
- Blochează rândul din jurnal cu `FOR UPDATE`. Rândul trebuie să aibă `restaurat_la IS NULL` (altfel eroare „deja restaurat”), profilul trebuie să existe, iar `p_nota` trebuie să aibă cel puțin 5 caractere.
- **Forma snapshot-ului** se verifică înainte de orice scriere: `versiune = 1`, `flaguri` obiect, `module` și `santiere` liste, cheia `banned_until` prezentă; altfel `22023` cu HINT „Corectează importul (G.7)” și jurnalul NU se marchează restaurat.
- Reface ce era în snapshot:
  - **Module:** `INSERT … ON CONFLICT (profile_id, module) DO NOTHING`, doar pentru modulele care mai există în `app_modules`. `granted_by = auth.uid()`, `granted_at = now()`; valorile originale rămân în jurnal. Modulele sărite apar în rezultat.
  - **Șantiere:** la fel, doar pentru `sites` care mai există.
  - **Flaguri:** UPDATE dinamic, doar pe cheile care se află și în `fn_cont_flaguri()`. Apelantul e owner, deci triggerele owner-only permit fără să mai fie nevoie de golirea claims.
  - **Ban:** `banned_until` ia valoarea din snapshot (de regulă NULL).
  - Sesiunile nu se refac: omul se loghează din nou.
- La final scrie `restaurat_de`, `restaurat_la`, `restaurare_nota` și întoarce `{module_refacute, module_sarite, santiere, flaguri}`.
- GRANT EXECUTE TO authenticated; REVOKE FROM PUBLIC, anon.

### B.7 Starea contului pentru fișa HR: `public.fn_cont_stare_angajati() RETURNS TABLE(employee_id integer, profile_id uuid, email text, stare text, inchis_la timestamptz, jurnal_id bigint)`
- `stare` poate fi `activ`, `inchis` (există închidere nerestaurată) sau `blocat` (ban fără jurnal, de ex. o închidere manuală neimportată).
- Owner-ul primește **toate** conturile (inclusiv cele nelegate, cu `employee_id` NULL) — sursa coloanei „Stare” din Admin → Manageri; HR / date personale primesc doar conturile legate de fișe. AdminPage o citește în `loadAll` și pentru bannerul din „Editează Angajat” (vizibil și HR).
- **Poartă:** owner, `can_modify_employees` sau `can_access_personal_data`. Pentru ceilalți întoarce **0 rânduri**, fără eroare, iar UI-ul doar ascunde indicatorul. **Runda 3:** și un cont revocat (închis / banat), chiar cu flagurile încă TRUE, primește 0 rânduri (P1g).
- GRANT EXECUTE TO authenticated; REVOKE FROM PUBLIC, anon.

### B.5b Coada închiderilor + sweep (30.09)
- `public.conturi_inchideri_coada(id, profile_id, employee_id, tip ∈ {flaguri, reincercare, programata}, motiv, scadent_la, incercari, ultima_eroare, creat_la, creat_de_identitate, rezolvat_la, rezultat)`; o singură intrare deschisă per (profil, tip); RLS: SELECT doar owner (`auth.uid() IS NOT NULL`); `service_role` doar SELECT; scriere doar prin funcțiile R2.
- `public.fn_conturi_inchideri_sweep()`: gardă `fn_identitate_privilegiata() IS NOT NULL`, EXECUTE revocat de la anon/authenticated/service_role; procesează intrările scadente (`FOR UPDATE SKIP LOCKED`), reverifică toate condițiile, întoarce numărătoarea pe rezultate. Programat în migrare (dacă există `cron`): `cron.schedule('conturi_inchideri_coada', '*/5 * * * *', 'SELECT public.fn_conturi_inchideri_sweep()')`; rollback-ul d îl scoate. Lucrează DOAR pe coadă → aplicarea nu închide nimic din datele existente.
- **Runda 3 (X6):** coloane noi `urmatoarea_incercare_la` (backoff după eșec: 5 min · 2^(n-1), max. 6 h), `abandonat_la` (după **8** eșecuri coada nu mai reîncearcă; intrarea rămâne DESCHISĂ — alerta `esuat_abandonat` / `flaguri_abandonate`, rollback-ul d o vede), `notificat_la` (owner-ul e anunțat o singură dată la primul eșec — dacă nu l-a anunțat deja triggerul — și o dată la oprire, `cont_inchidere_abandonata`; nu la fiecare rulare, nici după ce citește). Un eveniment nou pe aceeași intrare (HR salvează din nou fișa, altă eroare din trigger) pornește un ciclu nou (încercările de la 0). O intrare oprită se rezolvă din Admin → Manageri: „🔒 Închide contul acum” / „Reaplică închiderea” (owner, pe loc).
- **Runda 3 (ordinea lock-urilor):** candidații se citesc FĂRĂ lock (nu mai e `FOR UPDATE SKIP LOCKED` pe coadă); pentru fiecare intrare: persoana (garda, doar pentru închideri) → profilul (`FOR UPDATE`) → intrarea (`FOR UPDATE`, recitită; dacă s-a rezolvat între timp, se sare) → jurnalul (în `fn_cont_inchide`). Aceeași ordine ca `fn_cont_inchide` și `fn_cont_restaureaza` (profil înaintea cozii) → fără ciclul coadă ↔ profil (40P01). Handler-ul de eroare ia și el profilul înaintea intrării (R2-42).

### B.5c Hook PostgREST pre-request: `public.fn_pgrst_pre_request()` (creat, NEACTIVAT)
- Pentru claims `role='authenticated'` cu `sub` uuid: 42501 dacă există închidere deschisă, `banned_until > now()` sau `session_id` din token lipsește din `auth.sessions`. anon / service_role neatinse. EXECUTE pentru anon/authenticated/service_role (PostgREST îl cheamă cu rolul cererii).
- Activarea (D9): `ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.fn_pgrst_pre_request'; NOTIFY pgrst, 'reload config';`. Rollback-ul d refuză (55000) cât timp hook-ul e activ.

### B.8 Alerta extinsă: `CREATE OR REPLACE public.fn_admin_conturi_alerte()` (aceeași semnătură, aceeași poartă owner)
- **30.09:** poarta `fn_identitate_privilegiata() = 'owner'`; `cont_activ_fost_angajat` primește în `alocari` motivul (`motiv_neinchis`: owner / tip_cont / fara_data / data_viitoare / cnp_lipsa / alt_contract_activ / in_coada / esuat_sau_neprins, plus `alt_contract`, `coada`); `inchis_cu_acces_rest` arată `flaguri_in_coada`. **Runda 3:** motive noi `posibil_alt_contract` (B.3a), `esuat_abandonat` (coada oprită), `restaurat` (în locul lui `esuat_sau_neprins` pentru un cont restaurat de owner), plus `restaurat: {jurnal_id, restaurat_la}` și `coada.{urmatoarea_incercare_la, abandonat_la}`; CNP-ul din ambele surse; `inchis_cu_acces_rest.flaguri_abandonate`; `fara_angajat.{email_diferit, email_profil, email_neconfirmat}`. UI-ul (`adminAlerte.js` → `motivNeinchis`, `marcajeIdentitate`) afișează acum motivul; `restaurat` are prioritate `week` (decizia owner-ului, nu urgență).
| `cod` | Condiție | Prioritate în UI |
|---|---|---|
| `fara_angajat` | ca în A.6 | attention |
| `cont_activ_fost_angajat` | profil legat de un angajat cu `active IS NOT TRUE`, fără închidere nerestaurată și nebanat (`banned_until IS NULL OR banned_until < now()`). Acoperă owner-ul sărit, dezactivarea fără dată sau cu dată în viitor și închiderea eșuată. | critical |
| `inchis_dar_deblocat` | închidere nerestaurată, dar `banned_until` e NULL sau în trecut | critical |
| `inchis_cu_acces_rest` | închidere nerestaurată și totuși are rânduri în `user_module_access`/`profile_sites` sau vreun flag din listă pe true | critical |
| `reactivat_acces_neredat` | angajat cu `active IS TRUE` și închidere nerestaurată pe profilul lui | week |
| `alocari_ramase` | închidere nerestaurată și rânduri rămase în: `comenzi_aprobatori(activ)`, `necesar_responsabili(activ)`, `hr_aprobatori(activ)`, `marketing_aprobatori`, `hr_concediu_rute(aprobator_profile_id)`, `tichete_default_responsabili`, `hr_recrutare_pozitii(responsabil_id, activ, deleted_at IS NULL)`. Numărul pe tabel merge în `alocari`. | attention |
| `inactiv_fara_data` | `employees.active IS FALSE AND termination_date IS NULL`, cu sau fără cont. Azi sunt 8 fișe demo (id 1–8), fără conturi. | missing |

Coloanele din tabelele de alocări au fost verificate în `information_schema` pe 29.09. `tichete_asignati` rămâne pe dinafară, fiind istoric de asignare. Tabelele Ofertare nu se citesc.

### B.9 Importul celor două închideri manuale de pe 29.09
Nu intră în migrare. E pas DML separat (G.7).

---

## C. Migrarea 3 (R3): `20260929e_fost_angajat_colaborare_externa.sql`

### C.1 Coloane noi pe `employees`
```sql
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS colaborare_externa_status text NOT NULL DEFAULT 'necunoscut',
  ADD COLUMN IF NOT EXISTS colaborare_externa_confirmat_de uuid,          -- fără FK: nu blocăm ștergerea unui cont
  ADD COLUMN IF NOT EXISTS colaborare_externa_confirmat_la timestamptz,
  ADD COLUMN IF NOT EXISTS colaborare_externa_nota text,
  ADD COLUMN IF NOT EXISTS colaborare_externa_document text;              -- cale storage / referință document (opțional)
ALTER TABLE public.employees
  ADD CONSTRAINT employees_colab_ext_status_chk CHECK (colaborare_externa_status IN ('necunoscut','accepta','refuza')),
  ADD CONSTRAINT employees_colab_ext_dovada_chk CHECK (
    (colaborare_externa_status = 'necunoscut'
       AND colaborare_externa_confirmat_de IS NULL AND colaborare_externa_confirmat_la IS NULL
       AND colaborare_externa_document IS NULL)
    OR (colaborare_externa_status <> 'necunoscut'
       AND colaborare_externa_confirmat_de IS NOT NULL AND colaborare_externa_confirmat_la IS NOT NULL
       AND (length(btrim(COALESCE(colaborare_externa_nota,''))) >= 5 OR colaborare_externa_document IS NOT NULL)));
```
- Constrângerile se adaugă cu gardă `IF NOT EXISTS` în `pg_constraint`, ca migrarea să poată rula de două ori.
- Starea implicită e `necunoscut` și **nu se deduce niciodată automat**.
- **„Fost angajat” ≠ acordul de colaborare (condiția Copilot):** „fost angajat” e o stare CALCULATĂ a fișei (`termination_date <= azi` și `active` ne-TRUE); marcajul „Fost angajat Gazpet” de pe un extern (`hr_personal_extern.fost_angajat_gazpet`) spune DOAR că omul a avut contract cu Gazpet. Niciunul nu implică un acord: acordul e separat, tri-valent (`necunoscut` / `accepta` / `refuza`), implicit `necunoscut`, setat doar de un om (owner / HR) cu dovadă, și e legat de încetarea CURENTĂ (se resetează la reactivare / schimbarea datei). Colaborarea activă cere `accepta`; `necunoscut` și `refuza` o blochează la fel (C.4).
- ⚠️ `employees` are politica SELECT `USING (true)`, deci nota o poate citi orice utilizator logat. UI-ul avertizează: „fără date sensibile; documentul semnat se pune în Documente personale”.

### C.2 Protecția stării: `public.fn_employees_colab_ext_protectie()` (SECURITY DEFINER)
Funcția e atașată la două triggere:
- `trg_employees_colab_ext_protectie_ins`: `BEFORE INSERT … WHEN (NEW.colaborare_externa_status <> 'necunoscut' OR NEW.colaborare_externa_confirmat_de IS NOT NULL OR NEW.colaborare_externa_confirmat_la IS NOT NULL)`. Pornește și aruncă eroare: o fișă nouă începe întotdeauna ca „necunoscut”.
- `trg_employees_colab_ext_protectie_upd`: `BEFORE UPDATE … WHEN` se schimbă oricare dintre cele 5 coloane (`IS DISTINCT FROM`).
  - **30.09:** „om” = `fn_identitate_om()` (JWT authenticated prin PostgREST, login `authenticator`); altfel (sistem, cron, service_role, migrare, sesiune postgres cu claims de HR falsificate) → `RAISE … 42501`: „starea o setează doar un om din platformă”. Resetul la „necunoscut” se face și la SCHIMBAREA datei de încetare pe o fișă inactivă (R3-24). **Runda 3:** „om” = și cont NErevocat — un HR cu contul tocmai închis (JWT încă valabil, flagurile încă TRUE) nu mai decide acordul (R2-39, P1a–d).
  - Apelantul nu e owner și nu are `can_modify_employees` → 42501.
  - Status ≠ `necunoscut` și `NEW.termination_date IS NULL` → eroare („doar pentru contracte încheiate sau cu dată de încetare”).
  - `necunoscut` → golește `confirmat_de/la` și `document`.
  - Altfel **forțează** `confirmat_de := auth.uid()` și `confirmat_la := now()`: nu se acceptă valori venite din client.
- Rulează înaintea lui `trg_employees_termination_notify` (ordine alfabetică), dar cele două nu depind una de alta.
- **După review — acordul e legat de încetarea curentă:** `WHEN`-ul triggerului de UPDATE include și `active` / `termination_date`. La reactivare (`OLD.active IS NOT TRUE AND NEW.active IS TRUE`) sau la ștergerea datei de încetare, funcția pune `necunoscut` și golește proveniența, nota și documentul, **înainte** de verificările de rol — e direcția sigură (nu deduce niciun acord), deci merge și pe calea de sistem (admin fără JWT). Dacă s-au schimbat doar `active`/`termination_date` fără reset (ex. cron-ul), funcția iese imediat. Efect: „accepta” nu poate rămâne pe un angajat activ și nu se moștenește la următoarea plecare.

### C.3 Jurnalul acordului: `public.hr_colaborare_externa_jurnal`
- Coloane: `id` identity PK, `employee_id integer NOT NULL` (fără FK), `status_vechi`, `status_nou`, `nota`, `document`, `facut_de uuid` (NULL = sistem), `facut_la timestamptz NOT NULL DEFAULT now()`, `sursa text NOT NULL DEFAULT 'manual' CHECK (sursa IN ('manual','reset_automat'))`. Rândul de reset are nota „Resetat automat: fișa a fost reactivată / data încetării a fost ștearsă; acordul era pentru încetarea din …”.
- Append-only: trigger care refuză UPDATE, DELETE și TRUNCATE.
- RLS: SELECT pentru `auth.uid() IS NOT NULL` și (owner SAU `can_modify_employees` SAU `can_access_personal_data`). Fără politici de scriere; REVOKE ALL de la anon / authenticated / service_role; GRANT SELECT authenticated, service_role (P1, 30.09). Coloană nouă `facut_de_identitate`.
- Se scrie **numai** din triggerul AFTER de la C.5.

### C.4 Legătura cu tabela de externi
```sql
ALTER TABLE public.hr_personal_extern
  ADD COLUMN IF NOT EXISTS fost_angajat_employee_id integer,
  ADD COLUMN IF NOT EXISTS fost_angajat_gazpet boolean GENERATED ALWAYS AS (fost_angajat_employee_id IS NOT NULL) STORED;
ALTER TABLE public.hr_personal_extern ADD CONSTRAINT hr_personal_extern_fost_angajat_fk
  FOREIGN KEY (fost_angajat_employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;   -- cu gardă IF NOT EXISTS
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_personal_extern_fost_angajat
  ON public.hr_personal_extern(fost_angajat_employee_id) WHERE fost_angajat_employee_id IS NOT NULL;
```
- Marcajul „Fost angajat Gazpet” = `fost_angajat_gazpet` (coloană generată, nu se poate desincroniza).
- **PostgREST:** embed-urile existente (`hr_autorizatii`/`hr_recomandari`/ofertare → `emp:employees`, `ext:hr_personal_extern`) nu sunt afectate. Între `hr_personal_extern` și `employees` existau deja relații M2M prin `hr_autorizatii` și `hr_recomandari`, iar azi nimeni nu face embed direct între ele. Un embed nou trebuie scris cu `!hr_personal_extern_fost_angajat_fk`. În UI citim separat, după id-uri (D.2).
- **Protecție** `trg_hr_personal_extern_fost_angajat`, BEFORE INSERT OR UPDATE, funcție SECURITY DEFINER. E necesară pentru că politica UPDATE de pe tabelă permite **oricărui** utilizator logat să scrie.
  - Setarea sau schimbarea lui `fost_angajat_employee_id` cere `auth.uid()` nenul și owner sau `can_modify_employees` (altfel 42501). Angajatul țintă trebuie să aibă `termination_date IS NOT NULL AND termination_date <= CURRENT_DATE AND active IS NOT TRUE`.
  - Dacă `NEW.fost_angajat_employee_id IS NOT NULL AND NEW.activ IS TRUE` și statusul angajatului ≠ `accepta` → `RAISE … ERRCODE '23514'` „Colaborarea poate fi activă doar dacă fostul angajat a acceptat”.
  - **După review** poarta are trei părți: (1) legarea/dezlegarea doar owner/HR, ținta = fost angajat; la **dezlegare** `activ := false`; (2) rând legat + activ ⇒ fișa e **încă** a unui fost angajat (23514 „e din nou activă”) **și** acordul e `accepta`; (3) rând **nelegat** + activ cu numele/emailul unui fost angajat ⇒ 23514 „E fost angajat Gazpet (fișa #id NUME)…” cu HINT spre HR → Foști angajați; excepție doar owner-ul (omonim = altă persoană). Potrivirea: `fn_extern_fost_angajat_potrivire(nume, email)` (internă) peste `fn_nume_cuvinte` (fără diacritice, cuvinte distincte): email identic, sau ≥ 2 cuvinte, numele de familie al fișei prezent, un set îl conține pe celălalt. Se verifică la INSERT și când se schimbă `nume`/`email`/`activ`.
  - Efectul: motorul de ofertare, care filtrează după `ext.activ`, nu poate folosi un fost angajat fără acord **pe rândurile noi sau modificate**, fără nicio modificare în codul Ofertare. Limite care rămân: rândurile vechi nemodificate (25 azi, 0 omonime cu foști angajați la 29.09), activarea unui omonim de către owner, și politicile `hr_personal_extern_insert/update` care lasă orice logat să scrie (restrângerea la owner/HR = decizie de drepturi, cu acordul lui Răzvan). Cele 25 de rânduri existente nu sunt legate, deci nu sunt afectate.

### C.5 Sincronizarea: `public.fn_employees_colab_ext_after()` + `trg_employees_zz_colab_ext`
```sql
CREATE TRIGGER trg_employees_zz_colab_ext AFTER UPDATE ON public.employees FOR EACH ROW
  WHEN (OLD.colaborare_externa_status IS DISTINCT FROM NEW.colaborare_externa_status
     OR OLD.colaborare_externa_nota   IS DISTINCT FROM NEW.colaborare_externa_nota
     OR OLD.colaborare_externa_document IS DISTINCT FROM NEW.colaborare_externa_document
     OR OLD.active IS DISTINCT FROM NEW.active)
  EXECUTE FUNCTION public.fn_employees_colab_ext_after();
```
- Dacă s-a schimbat statusul, nota sau documentul → `INSERT` în `hr_colaborare_externa_jurnal`, cu `facut_de = fn_identitate_om()` și `facut_de_identitate = fn_identitate_eticheta()` (30.09).
- Dacă statusul a plecat de la `accepta`, sau angajatul a fost reactivat (`OLD.active IS NOT TRUE AND NEW.active IS TRUE`) → `UPDATE hr_personal_extern SET activ = false, updated_at = now() WHERE fost_angajat_employee_id = NEW.id AND activ`.
- **Activarea nu se face niciodată automat.** Un om bifează „Colaborare activă”.

### C.6 Funcțiile apelabile din UI
Ambele sunt `SECURITY DEFINER SET search_path = public, pg_temp`, cu poartă în cod: `fn_identitate_om()` nenul (30.09) și owner sau `can_modify_employees`. GRANT EXECUTE TO authenticated; REVOKE FROM PUBLIC, anon, service_role (P3).

- `fn_colaborare_externa_seteaza(p_employee_id integer, p_status text, p_nota text, p_document text DEFAULT NULL) RETURNS jsonb`:
  - validează statusul și dovada (pentru `accepta`/`refuza`: nota de cel puțin 5 caractere sau document), apoi face `UPDATE employees SET status, nota, document`;
  - `confirmat_*` le pune triggerul din C.2;
  - un apel cu aceleași valori nu schimbă nimic și nu scrie în jurnal. O notă nouă înseamnă reconfirmare și actualizează `confirmat_la`.
- `fn_fost_angajat_leaga_extern(p_employee_id integer, p_extern_id bigint DEFAULT NULL) RETURNS bigint`:
  - angajatul trebuie să fie fost angajat (ca în C.4);
  - dacă există deja un rând de extern legat, îi întoarce id-ul (idempotent);
  - cu `p_extern_id`: leagă rândul existent, dacă e nelegat, și pune `activ := activ AND status = 'accepta'`;
  - fără `p_extern_id`: `INSERT` cu `nume = e.name`, `functie = COALESCE(e.functie, e.position)`, `telefon = e.telefon`, `email = NULLIF(e.email,'')`, `observatii = 'Fost angajat Gazpet (fișa #id), contract încheiat la <dată>'`, `activ = (status = 'accepta')`, `created_by = auth.uid()`;
  - la coliziune pe `uq_hr_personal_extern_nume` → eroare cu HINT „Există deja externul <nume> (#id): leagă-l explicit”.
- Dezlegarea se face cu `UPDATE hr_personal_extern SET fost_angajat_employee_id = NULL`, din UI (Personal extern → detalii → „✂️ Dezleagă de fișă”), de owner sau de cineva cu `can_modify_employees`; triggerul verifică rolul și pune `activ = false` (reactivarea trece prin verificarea de omonimie).
- La coliziunea de nume, confirmarea din UI arată externul existent (firmă, telefon, email, activ) și avertizează că, fără „Acceptă”, colaborarea lui devine INACTIVĂ.

### C.7 Ofertare după 02.10 (doar documentare; nu se implementează acum)
- **Azi, fără nicio schimbare în Ofertare:**
  - un fost angajat trecut ca extern e „utilizabil” în ofertare doar prin `ext.activ = true`, iar asta cere acordul `accepta` pentru încetarea curentă (C.2, C.4). Un extern **nelegat** nou/modificat cu numele unui fost angajat e refuzat (C.4 (3)); rămân excepțiile din C.4 (rânduri vechi, owner, politicile de scriere largi);
  - autorizațiile și recomandările lui rămân pe `employee_id` și sunt excluse de `titularActiv` (`emp.active = false`, în `ofertare-acoperire/core.ts:116` și `OfertareLicitatii.jsx:3090`).
- **De făcut după 02.10:**
  - În `ofertare-acoperire/core.ts`, un titular `emp` inactiv se consideră disponibil **ca extern** doar dacă există simultan: un rând `hr_personal_extern` cu `fost_angajat_employee_id = emp.id` și `activ = true`, iar pe fișă `colaborare_externa_status = 'accepta'`.
  - Embed-ul se scrie explicit: `hr_personal_extern!hr_personal_extern_fost_angajat_fk(...)`.
  - Omul apare marcat „Fost angajat Gazpet · colaborator extern” și **nu** se numără la „personal propriu”.
  - Se cere un angajament de disponibilitate per licitație, care e document distinct de acordul general.
  - Dacă `confirmat_la` e mai vechi de 6 luni, apare avertisment „reconfirmă acordul”.
  - Autorizațiile nu se mută pe `extern_id`; `hr_autorizatii` are CHECK „exact unul”, deci se citesc prin legătură.
  - Testele se adaugă atunci în suita Ofertare.

---

## D. UI

Reguli generale: stilurile se scriu inline cu paleta G/S a fiecărui fișier, fără librării noi. Modulele Ofertare, SalariiPage, Logistica.jsx, Administrativ.jsx și ServiceTab.jsx nu se ating.

### D.1 HR: `src/HrFostiAngajati.jsx` (fișier nou) + tab în `HR.jsx`
- **Tab nou în `HR.jsx`:** `{ key: 'fosti', icon: '🗂️', label: 'Foști angajați' }` și `{!load && tab === 'fosti' && <HrFostiAngajati profile={profile} showToast={showToast} />}`. În HR.jsx se modifică doar aceste 2 linii, plus badge-ul din Arhivă de mai jos.
- **Date citite:**
  - `employees.select('id,name,functie,position,department,hire_date,termination_date,active,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document').not('termination_date','is',null).neq('active', true)`;
  - `hr_personal_extern.select('id,fost_angajat_employee_id,activ').not('fost_angajat_employee_id','is',null)`;
  - `rpc('fn_cont_stare_angajati')`: dacă întoarce 0 rânduri sau eroare, indicatorul de cont nu se afișează;
  - `profiles.select('id,name')` pentru a afișa numele celui care a confirmat.
- **Pe fiecare rând:**
  - badge **„Fost angajat Gazpet”** (pastilă `G.hr+'22'`/`G.hr`, `borderRadius:4, fontSize:10, fontWeight:600`, ca în TabPersonal) și data încetării;
  - **control în trei stări**: Necunoscut / Acceptă / Refuză (galben / verde / roșu). Alegerea „Acceptă” sau „Refuză” deschide un mini-formular cu notă (obligatorie, cel puțin 5 caractere) și document opțional → `rpc('fn_colaborare_externa_seteaza')`. Sub control apare „Confirmat de <Nume> la <dată oră>” și nota;
  - „Istoric” (vizibil pentru owner, `can_modify_employees` și `can_access_personal_data`): `hr_colaborare_externa_jurnal` filtrat după `employee_id`;
  - indicator de cont: „🔒 Cont închis automat la <dată>” (`stare='inchis'`), „⚠️ Cont încă activ” (`activ`, cu link către alertă) sau nimic;
  - buton „Trece ca extern” (dacă nu e legat) → `rpc('fn_fost_angajat_leaga_extern')`. Dacă răspunsul e eroarea de coliziune pe nume, se oferă alegerea externului existent. Rândurile deja legate arată „Extern #id · colaborare activă/inactivă”.
- **Cine editează:** `const poateColab = profile?.is_owner === true || profile?.can_modify_employees === true` (nu `isAdmin`). Ceilalți văd controlul fără să-l poată folosi.
- **După review:** „📎 Actualizează dovada” (aceeași stare, notă/document nou); „Trece ca extern” ascuns la „Refuză”; confirmarea coliziunii arată externul existent și efectul (inactiv); „📇 Fișa” deschide `ModalProfilAngajat` (HR.jsx citește fișa după id); istoricul arată resetul automat ca „sistem (reset automat)”.
- **Filtre:** stare acord (toate, necunoscut, acceptă, refuză) și căutare după nume.
- **În `HR.jsx`:**
  - Arhivă (~2460-2473): lângă „🔒 Contract încheiat” se adaugă badge-ul „Fost angajat Gazpet”;
  - `ModalProfilAngajat` (~1680): o linie „Cont platformă: <email> · activ / închis automat la … / fără cont”, din `fn_cont_stare_angajati`, plus badge-ul în antet când `esteFostAngajat(emp)`.

### D.2 Personal extern: `src/HrPersonalExtern.jsx`
- **Rândul din listă (~138-141):** dacă `p.fost_angajat_gazpet`, lângă nume apare badge-ul „Fost angajat Gazpet” și pastila stării de acord.
- **Starea de acord:** se citește separat, `employees.select('id,name,termination_date,colaborare_externa_status,colaborare_externa_confirmat_la').in('id', idsLegate)`, fără embed (vezi C.4).
- **Detalii extinse (~155-161):** „Acord colaborare: Acceptă · confirmat la …” și un link către HR → Foști angajați.
- **`ModalPersoana` (~283-286):** dacă rândul e legat și statusul ≠ `accepta` (sau fișa legată e din nou activă), bifa „Colaborare activă” e dezactivată, cu textul „Se poate activa doar după ce fostul angajat acceptă (HR → Foști angajați)” / „reangajat”. Erorile `23514` din trigger se arată după mesaj (acord lipsă / reangajat / omonim).
- **După review:** lista citește și foștii angajați (`employees` cu dată de încetare, inactivi) și marchează: „↩ Reangajat Gazpet (fișa activă)” în locul badge-ului pentru un rând legat de o fișă reactivată; „⚠️ Omonim cu fostul angajat #id — nelegat” pentru rândurile nelegate care se potrivesc (`fostAngajatPotrivit`, aceeași regulă ca BD). `ModalPersoana` blochează salvarea unui extern nou/redenumit/activat omonim cu un fost angajat (owner: confirmare explicită). Detalii: „✂️ Dezleagă de fișă” (props `poateLega`, `esteOwner` din HR.jsx).

### D.3 Admin: `src/App.jsx` (AdminPage)
- **Tabelul Manageri (~7501):** coloane noi „Fișă angajat” (numele sau „— nelegat”) și „Stare” („Activ”, „🔒 Închis <dată>”, sau tipul contului: extern/test/sistem). Datele vin din `profiles` (deja `select('*')`) și din `employees`, deja încărcate, plus jurnalul (RLS owner).
- **Modalul „Editează Manager” (owner):**
  - select „Fișă angajat”: angajații activi fără profil, plus cel curent. Eroarea de index unic apare ca „fișa are deja cont”;
  - select „Tip cont”: — / angajat / extern / test / sistem. Ambele se salvează prin `profiles.update`;
  - dacă există închidere nerestaurată: banner roșu „Cont închis automat la <dată> (jurnal #id). Salvarea NU redă accesul”, plus confirmare `window.confirm` dacă owner-ul bifează module pe un cont închis;
  - butoane „🔒 Închide contul acum” (`rpc('fn_cont_inchide_owner')`, cu motiv obligatoriu) și „↩ Restaurează din jurnal” (`rpc('fn_cont_restaureaza')`, cu notă obligatorie și confirmare). Rezultatul afișează modulele sărite.
- **Secțiunea „Jurnal închideri conturi”** din tab-ul Manageri (doar owner): listă cu data, email, motiv, sursă, cine a făcut-o, și restaurat (sau nu).
- **Butonul „Leagă automat conturile nelegate”:** `rpc('fn_cont_leaga_automat', {p_simulare:true})` → previzualizare → confirmare → `{p_simulare:false}`.
- **Link-uri directe din alerte:** `/admin?tab=managers&cont=<profile_id>` deschide modalul contului; `/admin?tab=employees&angajat=<id>` deschide „Editează Angajat”. Se citesc cu `useSearchParams` după `loadAll`.
- **`createManager` (~6646):** verifică eroarea de la `upsert`. După creare citește `profiles.employee_id`; cum signUp nu mai leagă singur, toast-ul cere confirmarea prin „🔗 Leagă automat” (sau Edit → Fișă angajat). Dacă înscrierea publică e oprită (D1-B), toast-ul trimite la Dashboard → Add user.
- **Previzualizarea „Leagă automat”** arată pe fiecare rând metoda și data creării contului, motivele celor sărite (inclusiv `email_diferit`) și avertismentul „leagă doar conturile pe care le recunoști”.
- **Modalul „Editează Manager”** pe un cont închis: „🔒 Reaplică închiderea” + „↩ Restaurează din jurnal” (cu textul „redă TOT accesul: doar dacă omul revine în firmă”).
- **`toggleEmp` (~6660):**
  - verifică `error` (azi nu o verifică);
  - la dezactivarea unui angajat cu cont legat: `window.confirm('Contul <email> va fi închis automat (drepturi scoase, logare blocată). Continui?')`;
  - la reactivare (D4): `window.confirm` + `{active:true, termination_date:null}` și toast „Accesul NU se redă automat”; data veche se adaugă în `observatii_hr`; confirmarea spune că acordul de colaborare externă revine la „Necunoscut”;
  - data implicită a încetării = `ziBaza()` (UTC = `CURRENT_DATE`), nu ziua RO (altfel, noaptea, contul nu se închidea).
- **„Editează Angajat” (~6884-6886):** când `termination_date <= azi` și fișa are cont legat, lângă bannerul existent apare „Contul platformei <email> va fi închis automat la salvare”. Dacă data e în viitor: „… va fi închis automat în dimineața zilei <dată>”.
- **`src/TabSemnaturi.jsx:78`:** mesajul devine „Contul tău nu e legat de fișa de angajat. Cere-i lui Răzvan să facă legătura (Admin → Manageri → Editează).”

### D.4 Alerte de administrare: `src/adminAlerte.js` + `src/AdministratorAlerte.jsx` (fără nicio mutație)
- **Sursa nouă** în `SURSE_ADMIN`: `{ id: 'conturi', label: 'Conturi platformă', module: 'admin_alerte', ownerOnly: true, path: '/admin?tab=managers' }`.
- **`areAccesSursa`:** după verificarea `areAccesAdministrator`, se adaugă `if (source.ownerOnly) return profile.is_owner === true`.
- **`SELECT_ADMIN.v_admin_conturi_alerte`:**
  ```
  'id,cod,profile_id,email,tip_cont,is_owner,employee_id,employee_name,employee_active,termination_date,banned_until,jurnal_id,inchis_la,candidati,alocari'
  ```
- **`alerteConturi(rows, today)`** (funcție pură, exportată):
  - pune prioritatea din tabelul B.8;
  - `date` = `termination_date` sau data din `inchis_la`;
  - `path` pe fiecare rând: `/admin?tab=managers&cont=<profile_id>` sau, pentru `inactiv_fara_data`, `/admin?tab=employees&angajat=<id>`;
  - `owner`: „Owner · Admin → Manageri” / „HR · Admin → Angajați”;
  - `locator`: `v_admin_conturi_alerte · <cod>`;
  - `impact` = **acțiunea de făcut**:
    - `fara_angajat`: „Leagă fișa (Editează → Fișă angajat) sau marchează tipul (extern/test/sistem)”, plus candidații („1 candidat: X, are deja cont” / „2 candidați: X, Y” / „niciun candidat”);
    - `cont_activ_fost_angajat`: „Închide contul acum sau corectează fișa”; pentru owner: „OWNER: nu se închide automat, decide manual”; pentru dată lipsă sau în viitor, motivul;
    - `inchis_dar_deblocat` / `inchis_cu_acces_rest`: „Reaplică închiderea (Admin → Manageri → Edit → „🔒 Reaplică închiderea”; jurnal #id). NU folosi „Restaurează”: redă TOT accesul — doar dacă omul revine în firmă.”;
    - `reactivat_acces_neredat`: „Dacă revine în firmă: Restaurează din jurnal #id. Altfel verifică reactivarea”;
    - `alocari_ramase`: „Reasignează: Achiziții → tab Aprobatori (aprobator comenzi) (1); …” (`ALOCARI_CONTURI`: etichetă + cale; tabelele fără ecran de editare sunt marcate „în BD, cu Claude”); link-ul duce la primul loc editabil;
    - `inactiv_fara_data`: „Completează data încetării sau șterge fișa demo”.
- **În `incarcaSursaAdmin`:** `if (source.id === 'conturi') rows = alerteConturi(await read('v_admin_conturi_alerte'), today)`. Se folosește `from(view).select`, deci **fără `.rpc(`**, cum cere `adminAlerte.test.js:35-37`.
- **`AdministratorAlerte.jsx`:**
  - `SOURCE_LINK_LABELS.conturi = 'contul'`;
  - în `RandAlerta`, `openSource(item.path || source.path)`.
- Scrierile (legare, marcare, închidere, restaurare) stau **doar** în App.jsx AdminPage.

---

## E. Teste

**Rulare:** `bash scripts/test_conturi_ciclu_viata.sh`, `--reaplica`, `--rollback`; `npx vitest run`; `npx vite build`.

**Pregătire:**
- `supabase/tests/conturi_ciclu_viata.migrari.txt` primește cele 3 căi c/d/e (azi are exemple cu x/y/z).
- **Completări în schelet** (`conturi_schelet_supabase.sql`), cu DDL citit din producție:
  - indexurile `uniq_profiles_employee_id` și `uq_hr_personal_extern_nume`;
  - `sites` cu câteva rânduri;
  - `profile_sites` (id, profile_id FK CASCADE, site_id, created_at, valid_until, granted_by, note);
  - `comenzi_aprobatori`, `necesar_responsabili`, `hr_aprobatori`, `marketing_aprobatori`, `hr_concediu_rute`, `tichete_default_responsabili`, `hr_recrutare_pozitii` (subset de coloane, cf. B.8);
  - notă: auth.users are owner `supabase_auth_admin` și în producție nu se pot adăuga triggere pe el.
- Secțiunea BAZĂ (T0–T6) trebuie să rămână verde.

### E.1 R1 (legare)
- R1-01 Email identic (majuscule/minuscule, spații), un singur angajat activ → legat, `metoda='email'`; owner-ii primesc `cont_legat_automat`.
- R1-02 Nume cu diacritice: `ȘTEFĂNESCU ANA-MARIA` + `ana-maria.stefanescu@gazpet.ro` → legat. La fel cu ț/ş/ţ scrise cu sedilă.
- R1-03 Ordinea nu contează: `stefanescu.ana@gazpet.ro` → legat de aceeași fișă.
- R1-04 Doi angajați activi `POPESCU ION` + `ion.popescu@gazpet.ro` → nelegat, notificare `cont_nelegat`, rând `fara_angajat` cu 2 candidați.
- R1-05 Zero potriviri (`test.ofertare@gazpet.ro`) → nelegat, profil creat normal, `role='manager_santier'`.
- R1-06 Singura potrivire e un angajat inactiv, sau cu `termination_date <= azi` → nelegat.
- R1-07 Candidatul unic are deja cont → nelegat, fără eroare, contul se creează (indexul unic nu e încălcat).
- R1-08 Inițiale: `m.alexandru@`, `konstantinos.t@` → 0 candidați.
- R1-09 Un singur token (`popescu@gazpet.ro`, cu un singur POPESCU activ) → nelegat. `ion.ion@` → nelegat (sub 2 tokeni distincți).
- R1-10 Domeniu extern: `ion.popescu@gmail.com` → pasul nume nu se aplică. Email identic pe fișă (`x@adromevolution.ro`) → legat.
- R1-11 Email duplicat pe 2 fișe active → nelegat și **fără** trecere la pasul nume.
- R1-12 Fără suprascriere: profil existent cu `employee_id` setat + crearea contului → `employee_id` rămâne același.
- R1-13 Izolarea erorilor: trigger temporar (în tranzacția testului) care aruncă eroare la UPDATE `profiles.employee_id` → contul și profilul există, `employee_id` e NULL. Separat: trigger temporar care aruncă pe `notifications` → legarea rămâne făcută.
- R1-14 Securitate: un utilizator își schimbă singur `employee_id` → 42501. La fel pentru `tip_cont` → 42501. Owner-ul poate schimba ambele. Admin (fără JWT) poate.
- R1-15 `tip_cont='altceva'` → 23514.
- R1-16 Owner citește `v_admin_conturi_alerte` → vede `fara_angajat`. După `tip_cont='test'` rândul dispare. Cu `tip_cont='angajat'` și nelegat, rândul rămâne.
- R1-17 Non-owner, inclusiv HR cu `can_modify_employees` și modulul `admin_alerte` → 42501 pe view. anon → refuzat. `authenticated` nu are SELECT pe `auth.users`.
- R1-18 Drepturi: anon/authenticated **nu** au EXECUTE pe `fn_cont_candidati_angajat`, `fn_cont_notifica_owneri`, `handle_new_user`. Au EXECUTE pe `fn_admin_conturi_alerte` și `fn_cont_leaga_automat`, dar primesc 42501 dacă nu sunt owner.
- R1-19 `fn_cont_leaga_automat(true)` nu scrie nimic (număr de rânduri neschimbat). Cu `false` leagă doar potrivirile unice. Non-owner → 42501.

### E.2 R2 (închidere)
- R2-00 `fn_cont_flaguri()` = exact cele 22 de nume așteptate, fără `is_owner`.
- R2-01 **Calea UI, HR non-owner** (`teste.ca_utilizator(u_hr)`): `UPDATE employees SET termination_date = CURRENT_DATE` (doar coloana asta). Se verifică:
  - 0 rânduri în `user_module_access` și `profile_sites`;
  - toate cele 22 de flaguri pe false, **inclusiv** `can_access_salarii`, `can_access_personal_data`, `can_access_pontaj_brut`, `can_modify_employees`, `can_manage_contracts`, `can_access_diurne`, `can_access_financiar`;
  - `banned_until = '2999-12-31'`, 0 sesiuni, refresh tokens revocați;
  - 1 rând în jurnal, cu `facut_de = u_hr` și snapshot cu modulele, flagurile, șantierele și `banned_until` de dinainte.
- R2-02 Calea `toggleEmp` (`active=false` + `termination_date=azi`) → la fel.
- R2-03 **Calea cron:** `teste.cron_hr_auto_deactivate_terminated()` pe o fișă cu data de ieri → închis, `facut_de IS NULL`, `sursa='trigger_contract_incheiat'`.
- R2-04 `active=false` fără `termination_date` → **neînchis** (module intacte, fără ban), notificare `cont_angajat_inactiv_fara_incetare`, alerte `cont_activ_fost_angajat` și `inactiv_fara_data`.
- R2-05 `active=false` cu dată de încetare în viitor → neînchis, alertă.
- R2-06 Dată în viitor, fișa rămâne activă → nimic. Data se mută la `CURRENT_DATE` (ca admin), rulează cron-ul → închis.
- R2-07 **Owner:** fișa owner-ului e încheiată → profilul rămâne neatins (`is_owner`, module, fără ban), notificare `cont_owner_neinchis`, **0 rânduri în jurnal**, alertă critică.
- R2-08 **Idempotență:** `fn_cont_inchide` de 2 ori → 1 rând în jurnal, snapshot identic cu primul, al doilea rezultat e `deja_inchis`. Reactivare urmată de cron → tot un singur rând deschis.
- R2-09 **Convergență:** după închidere, owner-ul reinserează manual un modul → alerta `inchis_cu_acces_rest`. Al doilea apel îl scoate, fără snapshot nou.
- R2-10 **Reactivare:** accesul nu se redă (0 module, ban păstrat). Notificare `cont_angajat_reactivat`, alertă `reactivat_acces_neredat`.
- R2-11 **Restaurare de către owner:** module, șantiere și flaguri identice cu snapshot-ul, `banned_until` revine la valoarea veche, `restaurat_de/la` completate. Al doilea apel → eroare „deja restaurat”.
- R2-12 Restaurarea e refuzată pentru: HR non-owner (42501), utilizator simplu (42501), anon (fără EXECUTE), `service_role` și admin fără JWT (42501, pentru că `auth.uid()` e NULL).
- R2-13 Restaurarea sare peste un modul care nu mai există în `app_modules` și îl raportează în rezultat, fără eroare.
- R2-14 Jurnal append-only: ca admin, DELETE / UPDATE pe `snapshot` / TRUNCATE → excepție. A doua setare a lui `restaurat_*` → excepție.
- R2-15 **RLS pe jurnal:** owner-ul vede rândurile, HR non-owner vede 0. INSERT/UPDATE/DELETE prin API → 42501 pentru orice utilizator. anon → refuzat.
- R2-16 Funcțiile interne: anon/authenticated/service_role nu au EXECUTE pe `fn_cont_inchide`, `fn_cont_flaguri`, `fn_employees_ciclu_cont`. `SELECT fn_cont_inchide(...)` ca HR → 42501, dar UPDATE-ul pe employees făcut de HR (R2-01) funcționează: triggerul nu cere EXECUTE de la cel care declanșează.
- R2-17 `fn_cont_inchide_owner`: owner-ul închide un cont extern (fără fișă; jurnal cu `employee_id NULL`). Non-owner → 42501. Pe un profil owner întoarce `sarit_owner`.
- R2-18 **Claims restaurate:** în aceeași tranzacție, după R2-01, `auth.uid() = u_hr` și `current_user = 'authenticated'`.
- R2-19 **Izolarea erorilor:** trigger temporar care aruncă la DELETE pe `user_module_access` → UPDATE-ul pe employees reușește (`active=false`). Profilul rămâne neschimbat (subtranzacția e anulată), iar owner-ii primesc notificarea `cont_inchidere_esuata` și alerta `cont_activ_fost_angajat`.
- R2-20 Cron pe un lot de 2 fișe, dintre care una pică → ambele sunt dezactivate (lotul nu e blocat).
- R2-21 **Istoricul neatins:** rândul din `profiles` există, legătura `employee_id` e păstrată, notificările vechi ale profilului sunt neschimbate, `hr_employees_audit` nu primește rânduri noi.
- R2-22 `fn_cont_stare_angajati`: HR cu `can_modify_employees` vede `inchis` și data. Un utilizator simplu primește 0 rânduri.
- R2-23 `alocari_ramase`: un cont închis care e încă `comenzi_aprobatori.activ` → rând cu `alocari = {"comenzi_aprobatori":1}`.

### E.3 R3 (fost angajat / acord)
- R3-01 Implicit: fișele existente și cele noi au `necunoscut`, fără câmpuri de proveniență.
- R3-02 INSERT cu `accepta` (inclusiv cu `confirmat_de` fals) → excepție.
- R3-03 HR cu `can_modify_employees`, prin funcție, pe un fost angajat: `accepta` + notă → `confirmat_de = u_hr`, `confirmat_la ≈ now()`, rând în jurnal (necunoscut→accepta).
- R3-04 Fără notă și fără document → excepție. Notă sub 5 caractere → excepție.
- R3-05 Utilizator simplu → 42501. anon → fără EXECUTE.
- R3-06 UPDATE direct prin API, făcut de HR, cu `confirmat_de` = uid-ul owner-ului → triggerul îl rescrie cu `u_hr`, iar jurnalul se completează.
- R3-07 Sistemul (admin fără JWT) sau `service_role` schimbă statusul → 42501. Acordul nu se setează niciodată automat.
- R3-08 CHECK-ul (cu triggerul de protecție dezactivat în tranzacția testului): `accepta` fără `confirmat_de` → 23514.
- R3-09 Setarea statusului pentru un angajat fără `termination_date` → excepție.
- R3-10 Revenire la `necunoscut` → câmpurile de proveniență se golesc, apare rând în jurnal, externul legat trece pe `activ=false`.
- R3-11 `fn_fost_angajat_leaga_extern` rulat de HR → rând nou cu `fost_angajat_gazpet = true`. `activ = false` când statusul e `necunoscut` și `true` când e `accepta`. Al doilea apel întoarce același id.
- R3-12 Coliziune pe nume cu un extern existent → eroare cu HINT. Legarea cu `p_extern_id` funcționează.
- R3-13 Al doilea rând legat de același angajat → 23505.
- R3-14 Un utilizator simplu, pe care RLS îl lasă să facă UPDATE pe tabelă:
  - setarea sau ștergerea lui `fost_angajat_employee_id` → 42501;
  - `activ=true` pe un rând legat cu status `necunoscut` → 23514;
  - `activ=true` cu status `accepta` → permis.
- R3-15 Legarea unui angajat activ → excepție.
- R3-16 Din `accepta` în `refuza` → externul trece singur pe `activ=false`. Înapoi în `accepta` → externul **rămâne** pe false.
- R3-17 Jurnalul acordului: append-only. RLS: owner, HR (`can_modify_employees`) și `can_access_personal_data` văd rândurile; utilizatorul simplu vede 0.
- R3-18 Nicio regresie: un utilizator simplu mai poate insera și actualiza un extern **nelegat** cu `activ=true`.
- R3-19 Ștergerea (de către owner) a unei fișe inactive legate de un extern → blocată de FK RESTRICT (23503).
- R3-20 Reactivarea fostului angajat → externul legat trece pe `activ=false`.

### E.3b Teste adăugate după review (29.09 seara)
- **R1-00** signUp public cu emailul de pe fișă → nelegat + `cont_legare_propusa`. **R1-01…R1-13** folosesc `teste.creeaza_cont_owner` (calea de încredere). **R1-14** schimbarea `profiles.email` de către utilizator → 42501; owner-ul poate. **R1-19** previzualizarea are `cont_creat_la`.
- **R1-20** signUp cu emailul personal de pe fișă / cu `prenume.nume@gazpet.ro` → nelegate, propuneri la owner, legare după confirmarea owner-ului. **R1-21** email falsificat în profil → `email_diferit`, sărit, alerta pe emailul de logare. **R1-22** `ana.maria@` / `maria.ana@` → 0; cu numele de familie → 1. **R1-23** două conturi cu același candidat → ambele `ambiguu`, nimic legat.
- **R2-24** cont închis: auto-repunerea `email_notifications_*` / `whatsapp_enabled` și schimbarea emailului → 42501. **R2-25** snapshot în forma veche → 22023, jurnalul nemarcat. **R2-26** `fn_cont_notifica_owneri` redenumită temporar → cron-ul și dezactivarea fără dată nu pică, contul se închide. **R2-27** owner: `inchis` / `blocat` / `activ` și pentru conturi nelegate; HR doar legate.
- **R3-20** (extins) reactivare → acord „necunoscut”, rând `reset_automat`; activarea externului pentru un reangajat → 23514; a doua încetare fără acord nou → 23514; cu acord nou → permis; fișă activă cu „accepta” forțat → 23514 („doar pentru un fost angajat”). **R3-21** reset pe calea admin (fără 42501, `facut_de` NULL) și la ștergerea datei; cron-ul nu atinge acordul. **R3-22** omonime (diacritice, ordine, prenume în plus, email) → 23514 cu HINT; „Radu Mihaela” și rândul inactiv → permise; activarea omonimului: simplu/HR refuz, owner permis; editarea altor câmpuri nu reverifică. **R3-23** dezlegare → `activ=false`, marcaj dispărut, reactivarea omonimului → 23514.
- **Harness `--rollback`:** rollback-ul c rulat înaintea lui d/e → refuzat, schema neschimbată.
- **Verificare prin mutații** (locală, în scratchpad): fiecare corecție scoasă pe rând face harness-ul să pice exact la testul ei (13/13).

### E.5 Teste adăugate / schimbate la 30.09 (după S-A live și review Copilot)
Rulare: `bash scripts/test_conturi_ciclu_viata.sh --reaplica --rollback` → 367 aserțiuni pe fiecare trecere completă (26 în trecerea „doar BAZĂ” după rollback), 1128 în total, + gardă de ordine; aceeași rulare cu S-A extins (20260930a ca a doua precondiție, din scratchpad): 1128/1128.
- **BAZĂ:** T2b (GoTrue = login `supabase_auth_admin`, fără claims), T3 (PostgREST = login `authenticator`, doar `request.jwt.claims`), SA-01 (S-A live, md5 canonic), SA-02 (S-A refuză GoTrue, acceptă postgres), SA-03.
- **R1:** R1-14b (matricea de 9 identități), R1-18 (drepturi noi, P3/P4), R1-19/20/21/23 (aplicare cu lista confirmată), R1-30 (calea de încredere cu S-A), R1-31 (poarta RPC-ului: HR / cont / anon / authenticator / supabase_auth_admin / postgres refuzați, owner și service_role trec), R1-32 (fără marcaj), R1-33 (TOCTOU), R1-34 (notificare pe orice domeniu), R1-35 (sub non-uuid).
- **R2:** R2-01 (calea HR: revocare pe loc + flaguri prin coadă), R2-02/R2-17 (owner JWT: pe loc), R2-03 (cron: `SET SESSION AUTHORIZATION postgres`, `db_login:postgres`), R2-05 (programare), R2-10 (nimic redat), R2-11c (previzualizare restaurare), R2-14b (P1), R2-19/19-bis (reîncercare), R2-28a–d (garda „alt contract activ”, inclusiv concurență cu `dblink`), R2-29/29b (hook pre-request), R2-30, R2-31, R2-32 (grep `set_config('request.jwt`), R2-33 (authenticator fără claims nu e „sistem”), R2-36 (restaurarea respectată), R2-37 (programare la scadență / anulată la reactivare), R2-38 (pct. 4).
- **R3:** R3-07b (postgres cu claims HR falsificate → 42501), R3-24 (schimbarea datei resetează acordul), R3-25 (identitatea în jurnal, P1, P3).

### E.6 Teste adăugate în runda 3 (30.09 seara, după verificările adversariale)
Rulare: `bash scripts/test_conturi_ciclu_viata.sh --reaplica --rollback` → 426 aserțiuni pe fiecare trecere completă (26 în „doar BAZĂ”), **1308** în total cu cele 4 verificări ale harness-ului (gardă de ordine, gardă coadă flaguri, 2 rollback-uri pas cu pas); aceeași rulare cu S-A extins (20260930a ca a doua precondiție): 1308/1308. Scheletul are acum `hr_employees_private` (DDL / politici / trigger de producție). Pe migrările din `4f78368`, testele noi (psql continuând după erori) dau 37 de aserțiuni picate + 11 erori (obiecte noi lipsă) — fiecare ID de mai jos pică acolo.
- **R2-42** (constatarea 5, primul test din fișier, înaintea oricărui DDL; date confirmate prin dblink, curățate la final): sweep-ul (altă conexiune) așteaptă profilul ținut de altă tranzacție FĂRĂ să țină intrarea din coadă (acea tranzacție o ia cu NOWAIT) → fără ciclu coadă ↔ profil.
- **R2-28e-lock / X2** (tot la început, dblink): CNP-ul persoanei în curs de încheiere pus în `hr_employees_private` pe o fișă nouă → 55P03 (contextul: `fn_cont_lock_chei` din `fn_hr_employees_private_persoana_lock`); fișă nouă activă cu același nume FĂRĂ CNP → 55P03 (`fn_employees_persoana_lock`); controale cu alt CNP / alt nume → trec.
- **R1-14b** extins (P10): `is_owner` / `role` pe 9 identități. **R1-18**: funcțiile noi din c interne. **R1-21b** (P12b): marcajul `email_diferit` + `email_profil`, și pentru emailul de LOGARE schimbat prin GoTrue. **R1-36** (condiția Copilot): `email_neconfirmat` pe calea de încredere, în „Leagă automat” și în alertă; legat după confirmare.
- **R2-28e** (X1, CNP în datele personale): doar acolo → se închide fără „CNP lipsă” fals; A pe fișă + B în datele personale → nu se închide; invers → nu se închide; alerta `alt_contract_activ` cu fișa B.
- **X1 / R2-28f**: contractul nou activ cu același nume și FĂRĂ CNP → nu se închide, `cont_inchidere_suspendata` cu fișa B și „completează CNP-ul”, alerta `posibil_alt_contract`; același email (alt nume de familie) și ordinea inversată → la fel; control (rudă cu alt CNP cunoscut + om fără CNP cu alt nume de familie) → se închide.
- **R2-38** (runda 3): cele 9 funcții noi din d interne, SECURITY DEFINER + `search_path`; 2 triggere pe `hr_employees_private`.
- **R2-39** (X10, P1a–g, P1l): HR închis pe calea HR, înainte de coadă, cu JWT-ul vechi: nu e „om”, acordul R3 / „Trece ca extern” / încheierea contractului altcuiva / golirea CNP-ului (fișă și date personale) / propria reactivare → 42501, starea conturilor → 0 rânduri; HR activ neafectat; ban fără jurnal → la fel; după restaurare → din nou „om”.
- **R2-40** (X3): cont restaurat + corecția datei / dată viitoare pe fișa inactivă → nu se re-închide, nu se programează, owner-ul e anunțat, alerta `restaurat`; plecare nouă (activ → inactiv) → închis din nou (jurnal nou).
- **R2-41** (X6): backoff (3 rulări = 1 încercare, +5 min), 7 eșecuri → +320 min, a 8-a → oprire + o singură notificare, nimic după citire, alerta `esuat_abandonat`, închiderea manuală rezolvă intrarea.
- **Harness:** gardă coadă flaguri (P9c) și rollback-urile pas cu pas.
- **Vitest** (`adminAlerte.test.js`): motivele din BD în textul alertei (inclusiv `restaurat` = prioritate `week`, fără „eșuat”), marcajele de identitate pe `fara_angajat`, `inchis_cu_acces_rest` cu flaguri în coadă / oprite.

### E.4 Vitest
Fișier nou `src/conturiCicluViata.js` (funcții pure) + `src/conturiCicluViata.test.js`:
- `esteFostAngajat(emp, today)`:
  - true doar când `termination_date` există, e `<= today` și `active !== true`;
  - false pentru o fișă inactivă fără dată și pentru o dată în viitor.
- `valideazaColab(status, nota, document)`:
  - `necunoscut` e valid fără notă;
  - `accepta`/`refuza` cer notă (după `trim`) de cel puțin 5 caractere sau document;
  - un status necunoscut sistemului e invalid.
- `etichetaColab(status)`: textele și culorile pentru cele 3 stări.
- `mesajStareCont(row)`: „Cont închis automat la …”, „Cont încă activ”, sau nimic.

Completări în `src/adminAlerte.test.js`:
- **Acces:** `areAccesSursa`, sursa `conturi`:
  - owner cu `admin_alerte` → true;
  - owner fără cheie → false;
  - non-owner cu `admin_alerte` + `hr` + `administrativ` → false.
- **Fără citire la refuz:** `incarcaSursaAdmin` pentru `conturi`, cu non-owner → `denied`, iar `client.from` nu e apelat.
- **Citirea pentru owner:** `from('v_admin_conturi_alerte').select(SELECT_ADMIN[...], {count:'exact'})` și `.order('id')`.
- **`alerteConturi` pe fiecare `cod`:**
  - prioritatea din B.8;
  - `id` `conturi:<id>`;
  - `path` pe fiecare rând;
  - owner-ul marcat „nu se închide automat”;
  - candidații 0 / 1 ocupat / 2 descriși corect;
  - `sorteazaAlerte` funcționează pe rezultat.
- **Garda statică existentă** (fără mutații în `adminAlerte.js` și `AdministratorAlerte.jsx`) rămâne verde.
- **Gardă statică nouă:** `HrFostiAngajati.jsx` nu conține `.from('employees').update(`. Statusul trece doar prin `rpc('fn_colaborare_externa_seteaza'`.
- **După review:** `ziBaza` (00:30 RO = ziua precedentă UTC); `stareContProfil` cu `blocat`; `cuvinteNume` / `fostAngajatPotrivit` / `esteEroareOmonim` / `esteEroareReangajat` / `autorJurnalAcord`; `poateActivaColaborarea(…, fostInca=false)`; alertele „Reaplică închiderea” și `ALOCARI_CONTURI`; gărzi statice: `toggleEmp` folosește `ziBaza()`, butonul „Reaplică închiderea” e în blocul contului închis, „Leagă automat” face previzualizarea înainte de confirmare, „Trece ca extern” e ascuns la „Refuză”.

---

## F. Rollback (fiecare fișier idempotent, rulat în ordinea e → d → c)
- **`20260929e_…_ROLLBACK.sql`:**
  - DROP pe triggerele `trg_employees_zz_colab_ext`, `trg_employees_colab_ext_protectie_ins/_upd`, `trg_hr_personal_extern_fost_angajat` și pe funcțiile lor (inclusiv `fn_extern_fost_angajat_potrivire`, `fn_nume_cuvinte`);
  - DROP pe `fn_colaborare_externa_seteaza` și `fn_fost_angajat_leaga_extern`;
  - DROP TABLE `hr_colaborare_externa_jurnal`;
  - pe `hr_personal_extern`: DROP index, constrângere, `fost_angajat_gazpet`, `fost_angajat_employee_id`;
  - pe `employees`: DROP constrângerile și cele 5 coloane.
  - ⚠️ Se pierd marcajele și acordurile. Înainte, Claude exportă `employees` (coloanele colab), jurnalul și legăturile în `claude_context`, cu confirmare.
- **`20260929d_…_ROLLBACK.sql`:**
  - DROP pe `trg_employees_zz_ciclu_cont` și `fn_employees_ciclu_cont`;
  - DROP pe `fn_cont_inchide_owner`, `fn_cont_restaureaza`, `fn_cont_stare_angajati`, `fn_cont_inchide`, `fn_cont_flaguri`;
  - `CREATE OR REPLACE fn_admin_conturi_alerte`, cu corpul **din migrarea c** (doar `fara_angajat`);
  - DROP TABLE `conturi_inchideri_jurnal` (cu triggerele de append-only).
  - Conturile închise **rămân închise**, adică partea sigură. ⚠️ Jurnalul se exportă înainte în `claude_context`.
- **`20260929c_…_ROLLBACK.sql`:**
  - **gardă de ordine** la început: dacă `fn_cont_inchide(uuid,text,text,integer)` sau `conturi_inchideri_jurnal` mai există → `RAISE … 55000` („rulează DUPĂ rollback-urile e și d”), fără niciun efect (verificat de harness);
  - `handle_new_user` revine la corpul original, **verbatim** (cu `search_path TO 'public'`);
  - DROP pe `trg_profiles_protectie_legatura`, `fn_profiles_protectie_legatura`, `v_admin_conturi_alerte`, `fn_admin_conturi_alerte`, `fn_cont_leaga_automat`, `fn_cont_candidati_angajat`, `fn_cont_notifica_owneri`;
  - DROP COLUMN `profiles.tip_cont`.
  - Legăturile deja făcute rămân (sunt date corecte).
- **30.09:** rollback-ul d scoate și jobul pg_cron `conturi_inchideri_coada`, coada, sweep-ul, garda / lock-ul pe persoană, hook-ul (refuză 55000 dacă hook-ul e ACTIV pe `authenticator`) și `fn_cont_restaureaza` în ambele semnături; rollback-ul c scoate funcțiile de identitate, `fn_cont_leaga_la_creare`, `fn_cont_leaga_automat` (ambele semnături) și repune EXECUTE pentru service_role pe `handle_new_user` (ACL-ul de producție); garda de ordine a lui c verifică și obiectele din e. **Niciun rollback nu atinge S-A** (precondiție live; verificat: instantaneul „dinainte” include S-A, iar SA-01 trece după rollback).
- **Verificare:** `--rollback` compară schema cu `pg_dump`, înainte și după. Trebuie să iasă identică, fără `ROLLBACK_DIFF_TOLERAT`.
- **Runda 3:** (1) **Gardă coadă flaguri** în rollback-ul d: refuz 55000 cât timp există o intrare `tip='flaguri'` deschisă (cont închis pe calea HR cu flagurile încă TRUE, inclusiv intrări oprite) — altfel contul rămânea închis „pe jumătate”, fără jurnal și fără coadă (P9c); harness-ul o verifică (intrare de test → refuz din motivul corect, schema neschimbată). (2) Rollback-ul d scoate și triggerele puse pe `hr_employees_private` (lock pe persoană, cont revocat), fără să atingă tabela; readuce `fn_admin_conturi_alerte` la corpul din c (cu marcajele de identitate). (3) `fn_nume_cuvinte` / `fn_nume_familie` / `fn_identitate_revocata` stau în c → le scoate rollback-ul c (rollback-ul e nu mai scoate `fn_nume_cuvinte`). (4) Harness-ul verifică acum rollback-ul **pas cu pas**: după rollback-ul lui e schema = cea de după d, după rollback-ul lui d = cea de după c (instantanee `pg_dump` la prima aplicare). (5) Intrările deschise `programata` / `reincercare` se pierd la rollback (nu sunt conturi pe jumătate închise: închiderea lor nu s-a făcut) → se exportă înainte, cu jurnalul.

---

## G. Aplicarea în producție (Claude) + fișa de securitate

### G.0 Ordinea de livrare (runda 3)
- **Migrarea d se aplică DOAR împreună cu (sau după) merge-ul UI-ului din acest PR.** Pe `main`, `toggleEmp` reactivează fără să șteargă `termination_date` (D4 e doar pe branch): cu d aplicat, a doua zi la 04:00 UTC cron-ul 13 ar dezactiva din nou fișa → trecerea activ → inactiv = plecare nouă → contul (chiar și unul restaurat) se închide din nou. Ordinea sigură: merge UI (deploy Vercel ~3 min) → apply c → DML `tip_cont` → apply d → apply e, în aceeași fereastră; D9 imediat după testul LIVE (D9).
- Fusul orar (D12) NU se schimbă în acest pachet.

### G.1 Local, înainte de orice
1. `git fetch --all --prune && git pull --ff-only`. Branch nou și PR (fără push direct pe `main`).
2. Rulezi `bash scripts/test_conturi_ciclu_viata.sh --reaplica` și apoi `--rollback`. Ambele trebuie să iasă cu cod 0.
3. `npm install` apoi `npx vitest run` și `npx vite build`.
4. `git diff --stat` **nu** trebuie să conțină `src/Ofertare*`, `src/ofertare*`, `supabase/functions/ofertare-*`, SalariiPage (App.jsx ~8076-8200), Logistica.jsx, Administrativ.jsx sau ServiceTab.jsx.

### G.2 Verificări în producție înainte de aplicare (doar SELECT)
- Hash-ul `md5(pg_get_functiondef(...))` pentru `handle_new_user`, `fn_employees_termination_notify`, `enforce_owner_only_salary_flags`, `prevent_role_escalation`, `protect_can_access_pontaj_brut` trebuie să fie identic cu schelet-ul. Dacă au fost modificate între timp, te oprești și le arăți lui Răzvan.
- `cron.job` 13: se verifică doar comanda, fără să fie copiată nicăieri, pentru că jobul are secrete.
- **30.09:** `md5(prosrc)` pentru `fn_profiles_campuri_owner_only` = `c06d7ce0f212c7bba2093c50614a88fc` (S-A live; verificat 30.09) și ordinea triggerelor BEFORE UPDATE pe `profiles` (A.4); `has_table_privilege('postgres', 'auth.refresh_tokens'|'auth.sessions', 'DELETE')` = true (verificat 30.09); `pgrst.db_pre_request` NU e setat pe `authenticator`; nu există job cron `conturi_inchideri_coada`; acoperirea CNP (D7).
- Obiectele cu numele noi nu trebuie să existe deja.
- Cifrele de reper: 31 de profiluri, 25 legate, 6 nelegate, 2 owneri.
- **Runda 3:** (1) `hr_employees_private` are definiția din schelet (coloane, `CHECK cnp ~ '^[0-9]{13}$'`, UNIQUE(cnp), FK-uri, 4 politici, doar triggerul `trg_hr_employees_private_touch`; verificat pe catalog 30.09) — d îi adaugă 2 triggere; (2) **acoperirea CNP pe ambele surse** (D7; numai numărători, fără CNP-uri):
  ```sql
  WITH e AS (SELECT e.id, e.active, e.termination_date,
                    COALESCE(NULLIF(upper(regexp_replace(COALESCE(p.cnp,''),'[^0-9A-Za-z]','','g')),''),
                             NULLIF(upper(regexp_replace(COALESCE(e.cnp,''),'[^0-9A-Za-z]','','g')),'')) AS cnp,
                    EXISTS (SELECT 1 FROM profiles pr WHERE pr.employee_id = e.id) AS are_cont
               FROM employees e LEFT JOIN hr_employees_private p ON p.employee_id = e.id)
  SELECT count(*) FILTER (WHERE active AND (termination_date IS NULL OR termination_date > CURRENT_DATE)) AS active,
         count(*) FILTER (WHERE active AND (termination_date IS NULL OR termination_date > CURRENT_DATE) AND cnp IS NULL) AS active_fara_cnp,
         count(*) FILTER (WHERE are_cont) AS legate, count(*) FILTER (WHERE are_cont AND cnp IS NULL) AS legate_fara_cnp
    FROM e;
  ```
  La 30.09: 120 / 114 / 25 / 24.

### G.3 Confirmarea lui Răzvan
Îi arăți rezumatul, deciziile D1–D6 și lista de teste trecute. Aștepți un „da” explicit.

### G.4 `apply_migration` c → verificări
- **Înainte:** Răzvan știe că, după c, conturile noi NU se mai leagă singure la signUp/Dashboard: primește propunerea și confirmă cu „🔗 Leagă automat” (sau se face funcția edge `cont-nou`, D1-C, care setează `app_metadata.gazpet_legare_automata`).
- Pentru toți cei 31, `SELECT p.email, (SELECT jsonb_agg(c) FROM fn_cont_candidati_angajat(p.email) c) FROM profiles p` (postgres, fără poartă):
  - pe cei 25 legați, cel puțin 22 au candidat unic = legătura reală și **0** au un candidat unic diferit;
  - cei 6 nelegați au 0 candidați.
- Drepturile verificate prin `has_function_privilege('anon'|'authenticated', …)`.

### G.5 DML `tip_cont` (preview → confirmare → apply)
- **Propunere de tipuri:**
  - `claude@gazpet.ro` → `sistem`;
  - `test.fara.modul@gazpet.ro`, `test.ofertare@gazpet.ro` → `test`;
  - `razvantrusuhome@gmail.com` → după D2;
  - `acarpenaru@gmail.com`, `dragos.burdea@adromevolution.ro` → `extern`.
- **Aplicare:** UPDATE cu `RETURNING id`, făcut ca postgres (`auth.uid()` NULL, deci triggerul de protecție permite).
- **Verificare:** `fara_angajat` = 0 rânduri.

### G.6 `apply_migration` d → verificări
- **30.09:** `SELECT jobname, schedule, username FROM cron.job WHERE jobname = 'conturi_inchideri_coada'` → `*/5 * * * *`, `postgres`; coada goală; `SELECT fn_conturi_inchideri_sweep()` ca postgres → `{}`. Actualizare `registru_automatizari` (G.12) ÎNAINTE de apply.
- `pg_get_triggerdef` pe `trg_employees_zz_ciclu_cont`: AFTER UPDATE, cu WHEN pe `active`.
- **Runda 3:** `trg_employees_persoana_lock` (BEFORE INSERT OR UPDATE OF cnp, active, termination_date, name, email), `trg_employees_00_cont_revocat` și `trg_hr_employees_private_00_cont_revocat` (BEFORE … FOR EACH STATEMENT), `trg_hr_employees_private_persoana_lock`; coada are coloanele `urmatoarea_incercare_la`, `abandonat_la`, `notificat_la`; un UPDATE de test pe o fișă ca HR activ trece (fără 42501).
- Privilegii pe funcțiile interne.
- Politica pe jurnal și `REVOKE`-urile.

### G.7 DML: importul închiderilor manuale (preview → confirmare → apply)
- **Jurnal:** 2 rânduri, `sursa='import_manual'`, `facut_de=NULL`, `motiv='Închidere manuală 29.09 la cererea lui Răzvan (claude_context 1483)'`. ⚠️ 1483 are forma `{profile:{…flaguri…}, module:[…]}`, pe care `fn_cont_restaureaza` o **refuză** (B.6): DML-ul o convertește explicit în forma B.2 — `versiune: 1`, `flaguri` = `profile` restrâns la `fn_cont_flaguri()`, `module` (cu `access_level`), `santiere`, `banned_until`, `profil`, `rezumat` — iar preview-ul se verifică cu un SELECT pe `snapshot->'flaguri'` / `jsonb_typeof(...)` înainte de INSERT. Snapshot-ul = JSON-ul din 1483 convertit, completat cu:
  - rândul actual `profile_sites` al lui Sorin (azi 1, neinclus în 1483);
  - `banned_until` anterior = NULL.
- **Convergența lui Sorin:** apoi, ca postgres, `SELECT fn_cont_inchide('<sorin>', '…', 'import_manual')` → `deja_inchis`. Funcția șterge rândul din `profile_sites`, deci se opresc mailurile `reminder-rapoarte`.
- **Verificări:**
  - în jurnal sunt 2 rânduri deschise;
  - `profile_sites` pentru Sorin = 0;
  - pentru Sorin **și** acarpenaru nu apare alerta `cont_activ_fost_angajat`.
- **Citirea alertei** o face Răzvan din /administrator. Dacă o face Claude, doar într-o tranzacție `BEGIN; set_config('request.jwt.claims', '{"sub":"01ab5a45-…","role":"authenticated"}', true); SELECT …; ROLLBACK;`, fără nicio scriere.

### G.8 `apply_migration` e → verificări
- `employees`: toate rândurile au `colaborare_externa_status='necunoscut'`.
- `hr_personal_extern`: tot 25 de rânduri, 25 active, 0 legate.
- FK-ul și indexul unic există.
- PostgREST își reîncarcă schema singur. Dacă nu, `NOTIFY pgrst, 'reload schema'`.

### G.9 `get_advisors` (security + performance)
- **Obiectele noi nu au voie să producă:** `rls_disabled`, `security_definer_view`, `function_search_path_mutable`, `policy_exists_rls_disabled`.
- **Avertismente așteptate** pentru funcțiile SECURITY DEFINER apelabile de `authenticated`: `fn_cont_inchide_owner`, `fn_cont_restaureaza`, `fn_cont_leaga_automat`, `fn_cont_leaga_la_creare`, `fn_admin_conturi_alerte`, `fn_cont_stare_angajati`, `fn_colaborare_externa_seteaza`, `fn_fost_angajat_leaga_extern`, `fn_pgrst_pre_request` (și anon: hook-ul, prin construcție). Sunt intenționate, cu poartă de rol în cod, și se notează în registru.

### G.10 Frontend și testare
- PR, build validat, merge după OK-ul lui Răzvan, deploy Vercel în ~3 minute.
- **Testare LIVE** (cu Ctrl+Shift+R):
  - Admin → Manageri: coloanele și jurnalul;
  - /administrator: sursa „Conturi platformă”;
  - HR → Foști angajați: Sorin apare cu badge și „Cont închis”;
  - HR → Personal extern.
- **Pagini de verificat** că nu au erori PGRST201 (doar citire): HR → Recomandări și Ofertare → Organigramă.

### G.11 Final de sesiune
- Se actualizează `registru_automatizari` cu fișa de mai jos și `handoff_activ`.
- **Lecții noi în `claude_context`:**
  - capcana triggerelor owner-only cu `auth.uid()` setat;
  - `UPDATE OF col` nu vede schimbările făcute de BEFORE;
  - un `SET` pe GUC `request.*` în definiția unei funcții pică în producție (non-superuser);
  - `REVOKE FROM PUBLIC` nu ajunge.
- **Pending de raportat:**
  - D1: înscrierea publică;
  - funcția edge `reminder-rapoarte` nu filtrează `valid_until` (codul e doar în producție);
  - `notify-whatsapp` nu are poartă de rol;
  - `employees` e citibil de toți (CNP, IBAN, adresă);
  - `hr_personal_extern` poate fi scris de oricine e logat;
  - `Executie.jsx:2955` filtrează `.eq('activ')` pe `employees`, dar coloana e `active`;
  - `HR.jsx:285` folosește `G.pink`, care nu există;
  - 5 angajați inactivi au încă `qr_pin_active = true`.

### G.12 Fișa de securitate (`registru_automatizari`, CLAUDE.md pct. 7) — revizia 30.09 + runda 3 (fișa auditului C, actualizată după corecții)

Se scrie în `registru_automatizari` **ÎNAINTE** de GO / apply (nu la final). Fără valori de secrete.

**Ce aduce pachetul.** Fără edge function nouă și fără secret nou. **UN job pg_cron nou**: `conturi_inchideri_coada` (`*/5 * * * *`, login postgres, `SELECT public.fn_conturi_inchideri_sweep()`). 13 triggere (scriu: ciclul R2, sincronizarea R3 și protecția R3 care rescrie proveniența; restul gărzi / lock pe persoană — runda 3: +3, lock-ul pe `hr_employees_private` și cele 2 gărzi „cont revocat”), funcții interne (identitate, notificări, gardă, coadă), 8 RPC-uri cu poartă în cod, 1 hook PostgREST **neactivat**. Declanșatori existenți care devin indirecți: `on_auth_user_created` (GoTrue), cron 13 `hr_auto_deactivate_terminated` (postgres, 04:00 UTC), UPDATE-urile pe `employees` din UI, scrierile CNP-ului în `hr_employees_private` (Admin → Angajați → Editează, AdeverinteLegator — doar lock pe persoană, nu închid nimic).

**Modelul de identitate (aprobat de Copilot, identic cu S-A):** trec doar claims `service_role`, claims `authenticated` + `sub` owner, sau login postgres/supabase_admin FĂRĂ claims (`fn_identitate_privilegiata`). „Om” (R3, atribuire) = JWT `authenticated` venit prin PostgREST (`session_user = authenticator`, `fn_identitate_om`). „`auth.uid() IS NULL` ⇒ sistem” nu mai apare nicăieri; niciun obiect din `public` nu mai scrie `request.jwt.*` (test R2-32). **Runda 3:** „om” cere în plus un cont NEREVOCAT (`fn_identitate_revocata`: închidere nerestaurată în jurnal sau ban activ) — un cont închis nu mai trece de porțile R3 și nu mai scrie în `employees` / `hr_employees_private` nici cu JWT-ul emis înainte de închidere (R2-39). Privilegiile explicite nu se schimbă (owner-ul nu poate fi închis de pachet: R2-07, R2-17).

**Starea live pe care se sprijină fișa (SELECT read-only, 29–30.09):** pe `profiles` 4 triggere BEFORE UPDATE (3 vechi cu bypass `auth.uid() IS NULL` + S-A 2 coloane, md5 `c06d7ce0…`); 20260930a (S-A extins) NU e aplicat (pachetul e verificat și cu el: 1128/1128 la 30.09, 1308/1308 în runda 3); `hr_employees_private` (runda 3, catalog): `cnp` UNIQUE + CHECK 13 cifre, RLS cu 4 politici (SELECT / INSERT / UPDATE: `can_access_personal_data` sau owner; DELETE: owner), trigger `trg_hr_employees_private_touch` — CNP-ul îl scriu Admin → Angajați → Editează și AdeverinteLegator (după confirmarea unui om); pe `notifications` doar `trg_notificari_ruteaza_ofertare`, niciun cron nu citește `notifications` → notificările `cont_*` rămân în aplicație; nimic automat nu scrie `employees.termination_date` / `active` în afară de UI și cron 13; postgres are UPDATE pe `auth.users`, DELETE pe `auth.sessions` și `auth.refresh_tokens`; `authenticator` = LOGIN NOINHERIT, fără `pgrst.db_pre_request`; `jwt_exp = 3600`.

#### A1. R1: `on_auth_user_created` → `handle_new_user()` (c, A.3)
- **(a)** `NEW.email` (ales de ORICINE cât timp înscrierea publică e pornită — D1/D10, neverificat), `raw_app_meta_data.gazpet_legare_automata` (doar API-ul admin = service_role), `employees.name/email` (HR).
- **(b)** INSERT în `profiles` (rol `manager_santier`, ca până acum) + `notifications` către owneri. **Nu mai scrie `employee_id`** (30.09). Nu trimite mail, nu atinge bani.
- **(c)** SECURITY DEFINER (proprietar postgres), `session_user = supabase_auth_admin`, fără claims, fără service_role. DEFINER e necesar: GoTrue nu are drepturi în `public`.
- **(d)** Oricine creează un cont GoTrue (signUp public cu cheia anon, Dashboard, API admin).
- **(e)** Legarea NU se face din trigger: public/Dashboard → propunere + confirmarea owner-ului pe perechi (A5); calea de încredere → RPC-ul A1b. Runda 3: „Leagă automat” sare peste emailurile de logare neconfirmate (`email_neconfirmat`).
- **Verdict (a)∩(b):** triggerul doar citește și notifică → intersecția nu mai produce drepturi. Rămâne: inundarea owner-ilor cu notificări la signUp public (dedupe doar pe mesaj identic) → D10.

#### A1b. RPC `fn_cont_leaga_la_creare(p_profile_id)` (c, A.3b) — calea de încredere
- **(a)** marcajul `gazpet_legare_automata` (pus doar cu service_role), emailul de logare, `employees`.
- **(b)** `profiles.employee_id` (doar din NULL, candidat unic și liber, sub `FOR UPDATE` + index unic) → acces la semnătura de pe fișă; notificări owner.
- **(c)** SECURITY DEFINER; identitatea apelantului: DOAR `service_role` (funcția edge `cont-nou`, cu poartă owner în edge) sau `owner`. S-A acceptă ambele.
- **(d)** EXECUTE: `authenticated` + `service_role`; poarta de rol în cod refuză HR, anon, authenticator / supabase_auth_admin / postgres fără claims (R1-31).
- **(e)** Confirmarea umană = owner-ul care folosește `cont-nou` (edge-ul încă nu există: până atunci owner-ul cheamă RPC-ul sau „Leagă automat”). Fără marcaj → `fara_marcaj_incredere` (R1-32). **Runda 3 (schimbare explicită în R1, A.3b):** emailul de logare trebuie să fie CONFIRMAT (`email_confirmed_at`), altfel `email_neconfirmat` (R1-36); crearea autorizată (edge `cont-nou`) îl confirmă ea, înscrierea publică nu intră pe calea asta.

#### A2. Gardă: `trg_profiles_protectie_legatura` (c, A.4)
- **(a)** nu citește conținut extern. **(b)** doar refuză (42501): `employee_id`, `tip_cont`, `email`, `is_owner` / `role` (runda 3), orice UPDATE pe un cont închis. **(c)** DEFINER (jurnalul are RLS doar owner). **(d)** orice UPDATE pe `profiles`.
- **Corectat 30.09:** trece doar `fn_identitate_privilegiata() IS NOT NULL` (M1). GoTrue, authenticator cu claims golite, anon printr-un RPC → refuz (R1-14b).
- **Runda 3 (P10):** și `is_owner` / `role` — pe care triggerele vechi le lăsau libere oricărei identități fără `auth.uid()` — trec doar cu identitate privilegiată: owner JWT (Admin → Manageri), service_role, postgres fără claims. Anon / authenticator cu claims golite / GoTrue → 42501; HR / cont simplu → refuzați ca înainte de triggerul vechi (R1-14b extins pe 9 identități). Cron-ul 13 nu scrie `profiles`; închiderea / restaurarea nu ating `role` / `is_owner`.

#### A3. R2: `trg_employees_zz_ciclu_cont` → `fn_employees_ciclu_cont()` → `fn_cont_inchide()` (d, B.3–B.5)
- **(a)** Nu citește conținut extern direct: `employees.active / termination_date / name / cnp / email` și (runda 3) `hr_employees_private.cnp` sunt puse de oameni (owner / HR / date personale) sau de cron 13 (care aplică date puse de oameni). CNP-ul din datele personale poate veni din scanarea CI (AdeverinteLegator), dar se scrie doar după confirmarea unui om; un CNP greșit poate cel mult suspenda o închidere (alertă) sau rata o potrivire (închidere reversibilă, owner-ul restaurează). Condiție: niciun import automat să nu scrie aceste câmpuri (adevărat azi).
- **(b)** **Doar ia drepturi:** DELETE `user_module_access` / `profile_sites`, cele 22 de flaguri → false (pe loc sau prin coadă), `auth.users.banned_until = 2999-12-31`, DELETE `auth.refresh_tokens` și `auth.sessions`, jurnal + coadă + `notifications`. Nu dă drepturi, nu trimite mail, nu atinge bani.
- **(c)** DEFINER (proprietar postgres), fără service_role (necesar pentru `auth.*` și tabelele doar-owner). **Corectat 30.09 (M2):** fără golirea claims; flagurile se scriu doar cu identitate privilegiată explicită, altfel coada.
- **(d)** Oricine are UPDATE pe `employees` prin RLS (owner + `can_modify_employees`, 6 conturi inclusiv `claude@`), cron 13, service_role / postgres direct. Poarta = politica RLS; un HR poate închide orice cont non-owner punând o dată ≤ azi (reversibil) → **D8** (recomandat C). Runda 3: un cont revocat (închis / banat) nu mai scrie în `employees` / `hr_employees_private` nici cu JWT-ul vechi (A4c, R2-39).
- **(e) Condițiile Copilot:**

| Condiție | Stare 30.09 | Unde / test |
|---|---|---|
| Owner-ul exclus | ✓ | `fn_cont_inchide` sub `FOR UPDATE`; R2-07, R2-17 |
| Garda „alt contract activ”, atomică | ✓ (runda 3: pe AMBELE surse de CNP) | `fn_cont_garda_persoana` (CNP din `hr_employees_private` **și** `employees`) + lock pe persoană (CNP-uri, cuvintele numelui, email) luat și de `trg_employees_persoana_lock`, și de `trg_hr_employees_private_persoana_lock`; R2-28a–e, R2-28e-lock, X2 |
| Situație incompletă → doar alertă | ✓ | fără dată / dată viitoare / CNP lipsă în ambele surse / tip cont ≠ angajat / cont nelegat al aceleiași persoane / **(runda 3) altă fișă ACTIVĂ fără CNP cu același nume de familie sau email** (`posibil_alt_contract`); R2-04, R2-05, R2-28c, R2-30, R2-31, X1 / R2-28f; D7, D11 |
| Revocare efectivă (inclusiv sesiunile) | ✓ parțial → complet după D9 | sesiuni + refresh tokens șterse pe loc (R2-01); **runda 3:** cu JWT-ul vechi contul nu mai e „om”, nu mai scrie în `employees` / `hr_employees_private`, starea conturilor → 0 rânduri (R2-39); restul tabelelor (RLS pe `auth.uid()` / flaguri) până la expirarea JWT-ului: hook creat și testat (R2-29), activarea = D9 |
| Jurnal de revenire | ✓ | append-only, `facut_de_identitate`, service_role doar citire (R2-14, R2-14b) |
| Reactivare fără restaurare automată | ✓ | R2-10 (module, flaguri, șantiere, sesiuni, ban) |
| Contul restaurat de owner nu se re-închide singur | ✓ (corectat în runda 3, X3: înainte triggerul îl re-închidea la corecția datei) | cât timp ultima închidere e restaurată, nici sweep-ul (intrările mai vechi decât restaurarea → `anulat_restaurat`), nici triggerul (corecția datei, data pusă pe o fișă inactivă, programarea) nu îl re-închid; owner-ul e anunțat, alerta `restaurat`. Blocajul se ridică doar prin închiderea manuală a owner-ului sau o plecare NOUĂ (activ → inactiv); R2-36, R2-40 |
| Restaurare doar owner, cu previzualizare | ✓ (UI: previzualizarea încă nefolosită) | `fn_cont_restaureaza(…, p_simulare)`; R2-11c, R2-12 |

#### A3b. Automatizare NOUĂ: pg_cron `conturi_inchideri_coada` → `fn_conturi_inchideri_sweep()` (d, B.5b)
- **(a)** Nu citește conținut extern: coada (scrisă doar de funcțiile R2) + `employees` / `profiles` / jurnal.
- **(b)** Doar ia drepturi: flaguri → false pe conturi cu închidere deschisă; închide conturile din coadă (reîncercare / programare) după reverificarea TUTUROR condițiilor (inclusiv garda pe ambele surse de CNP). Nu dă drepturi. Un cont restaurat de owner nu e re-închis: restaurarea anulează intrările deschise, iar o intrare mai veche decât restaurarea e anulată (`anulat_restaurat`) — regula completă în A3 („Contul restaurat…”, R2-40).
- **Runda 3 (X6, lock-uri):** după eșec, backoff 5 min · 2^(n-1) (max. 6 h); după **8** eșecuri intrarea se oprește (`abandonat_la`), rămâne deschisă și vizibilă (alerta `esuat_abandonat` / `flaguri_abandonate`, garda rollback-ului d); owner-ul primește o notificare la primul eșec și una la oprire, nu la fiecare rulare (R2-41). Ordinea lock-urilor: persoană → profil → intrare → jurnal, aceeași ca în închidere / restaurare (R2-42).
- **(c)** Job pg_cron ca **postgres** (identitate explicită `db_login`), fără service_role, fără claims. Funcția e DEFINER cu gardă `fn_identitate_privilegiata() IS NOT NULL`.
- **(d)** Doar pg_cron / postgres: EXECUTE revocat de la anon / authenticated / service_role (R2-33, R2-38). Lucrează DOAR pe coadă → aplicarea migrării nu închide nimic din datele existente.
- **(e)** Declanșatorul inițial e mereu o dată de încetare pusă de un om; închiderea e reversibilă (jurnal + restaurare owner).

#### A3c. Hook PostgREST `fn_pgrst_pre_request()` (d, B.5c) — NEACTIVAT
- **(a)** doar claims-urile cererii. **(b)** doar refuză (42501) cererile unui cont închis / banat / cu sesiune ștearsă. **(c)** DEFINER (citește jurnalul, `auth.users`, `auth.sessions`). **(d)** PostgREST, la fiecare cerere, DUPĂ activare. **(e)** Activarea = D9 (acordul lui Răzvan); rollback-ul d refuză cât timp e activ.

#### A4. Gărzi append-only: `trg_conturi_inchideri_append_only` / `_fara_truncate` (d) și `trg_hr_colab_ext_jurnal_imuabil` (e)
- Refuză DELETE / TRUNCATE (și UPDATE, în afara completării unice a restaurării pe jurnalul R2). SECURITY INVOKER **intenționat** (P2: doar RAISE, nu accesează date); `search_path` fixat, EXECUTE revocat. Conforme.

#### A4b. Lock pe persoană: `trg_employees_persoana_lock` + `trg_hr_employees_private_persoana_lock` (d, runda 3)
- **(a)** CNP-ul din `employees` și din `hr_employees_private`, `employees.name` / `email` (HR). **(b)** nu scrie nimic: doar `pg_advisory_xact_lock` pe cheile persoanei — fiecare CNP normalizat, fiecare cuvânt al numelui, emailul — în ordinea hash-ului (serializează încheierea unui contract cu crearea / reactivarea altuia pentru aceeași persoană și cu apariția CNP-ului în datele personale). **(c)** DEFINER. **(d)** `employees`: INSERT / UPDATE OF cnp, active, termination_date, name, email (fără scrierile care DOAR încheie / dezactivează, ca lotul cron-ului 13); `hr_employees_private`: INSERT / UPDATE OF cnp, employee_id / DELETE. Conform. Contenție: milisecunde pe numele cu un cuvânt comun (B.3a).

#### A4c. Gardă „cont revocat”: `trg_employees_00_cont_revocat` + `trg_hr_employees_private_00_cont_revocat` (d, runda 3, B.3b)
- **(a)** nu citește conținut extern: uid-ul din JWT, jurnalul R2, `auth.users.banned_until`. **(b)** doar refuză (42501) orice INSERT / UPDATE / DELETE făcut cu JWT-ul unui cont revocat (închidere nerestaurată sau ban activ); BEFORE, FOR EACH STATEMENT. **(c)** DEFINER (citește jurnalul doar-owner și `auth.users`). **(d)** orice scriere pe cele 2 tabele; cron-ul, migrările, service_role (fără uid) și conturile active nu sunt atinse (R2-39: HR activ neafectat). **(e)** —. Limită: celelalte tabele rămân pe RLS până la expirarea JWT-ului → D9.

#### A5. R3: `trg_employees_colab_ext_protectie_ins/_upd` (e, C.2)
- **(a)** nota / documentul (text scris de HR), `active`, `termination_date`. **(b)** forțează `confirmat_de/la` din sesiune; reset la „necunoscut” la reactivare / ștergerea / **schimbarea** datei (direcția sigură); altfel doar refuză. **(c)** DEFINER. **(d)** UPDATE pe `employees`; decizia cere un OM (`fn_identitate_om`): refuzate explicit service_role, pg_cron / migrări (`db_login`), GoTrue și o sesiune postgres/MCP cu claims de HR falsificate (R3-07, R3-07b). **(e)** Tri-starea o decide doar un om ✓. Nicio automatizare nu apelează `fn_colaborare_externa_seteaza`.

#### A6. R3: `trg_employees_zz_colab_ext` → `fn_employees_colab_ext_after()` (e, C.5)
- **(a)** copiază nota și documentul (HR). **(b)** scrie în `hr_colaborare_externa_jurnal` (cu `facut_de_identitate`), pune `hr_personal_extern.activ = false` — doar dezactivează. **(c)** DEFINER (authenticated nu scrie în jurnal; service_role doar citește — P1). **(d)** UPDATE pe `employees`. **(e)** ✓

#### A7. R3: `trg_hr_personal_extern_fost_angajat` (e, C.4)
- **(a)** `NEW.nume` / `NEW.email` — orice cont logat poate scrie în `hr_personal_extern`, deci practic conținut extern. **(b)** doar refuză sau pune `activ=false` la dezlegare; (a)∩(b) nu produce scrieri în alte tabele. **(c)** DEFINER. **(d)** orice cont logat; legarea / dezlegarea doar un om owner / HR (`fn_identitate_om`). **(e)** un omonim îl activează doar owner-ul. Limită (verificatorul 1, **P7b**, neschimbată în runda 3): potrivirea pe nume se ocolește cu o variantă („Popescu I.”, o literă schimbată) — se închide doar prin restrângerea politicilor de scriere pe `hr_personal_extern` (decizie de drepturi, Răzvan).

#### A8. Notificări `fn_cont_notifica_owneri()` (c)
- **(a)** textul poate conține `NEW.email` (extern), `employees.name`, motivul. **(b)** `notifications` doar pentru owneri, tipurile: `cont_legat_automat`, `cont_legare_propusa`, `cont_nelegat`, `cont_owner_neinchis`, `cont_inchis_automat`, `cont_inchidere_esuata`, `cont_inchidere_suspendata` (runda 3: și pentru `posibil_alt_contract` și contul restaurat), `cont_inchidere_abandonata` (runda 3, coada oprită), `cont_posibil_aceeasi_persoana`, `cont_angajat_inactiv_fara_incetare`, `cont_angajat_reactivat` — rămân în aplicație (fără mail / WhatsApp, verificat live). **(c)** DEFINER. **(d)** internă, EXECUTE revocat. **(e)** informativă; o propunere e date, nu instrucțiune (pct. 10).

#### RPC-uri pornite de un om (nu sunt automatizări; listate pentru (d))
| RPC | Poartă în cod | EXECUTE | Ce face |
|---|---|---|---|
| `fn_cont_leaga_automat(boolean, jsonb)` | owner | authenticated | leagă DOAR perechile confirmate din previzualizare |
| `fn_cont_leaga_la_creare(uuid)` | service_role / owner | authenticated, service_role | calea de încredere (A1b) |
| `fn_admin_conturi_alerte()` + `v_admin_conturi_alerte` | owner | authenticated | doar citire |
| `fn_cont_inchide_owner` | owner | authenticated | închidere manuală (completă pe loc) |
| `fn_cont_restaureaza(bigint, text, boolean)` | owner | authenticated | **redă drepturi** din snapshot; cu previzualizare |
| `fn_cont_stare_angajati` | owner / HR / date personale, cont nerevocat (altfel 0 rânduri) | authenticated | doar citire |
| `fn_colaborare_externa_seteaza` | om owner / HR | authenticated | setează acordul |
| `fn_fost_angajat_leaga_extern` | om owner / HR | authenticated | creează sau leagă un extern |
| `fn_pgrst_pre_request` | — (doar refuză) | anon, authenticated, service_role | hook, neactivat (D9) |

#### pct. 4 (obiecte noi) — stare 30.09
- Tabele noi (`conturi_inchideri_jurnal`, `conturi_inchideri_coada`, `hr_colaborare_externa_jurnal`): RLS activ, o singură politică SELECT cu `auth.uid() IS NOT NULL`, fără politici de scriere, fără `USING(true)`; `service_role` doar SELECT (P1); secvențele revocate.
- View `v_admin_conturi_alerte`: `security_invoker = on`, SELECT doar `authenticated` (P3).
- Funcții: toate SECURITY DEFINER cu `search_path = public, pg_temp` (excepție motivată: cele 2 gărzi append-only, P2); interne cu `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`; RPC-urile fără service_role acolo unde poarta e owner / om (P3); `handle_new_user` fără EXECUTE pentru service_role (P4).
- P5 (documentat): coloanele `colaborare_externa_nota/_document` moștenesc `employees_select_all_authenticated USING (true)`; `fost_angajat_employee_id` moștenește scrierea pentru orice logat, păzită de trigger → D10 + restrângerea politicilor (decizie de drepturi).

**Condiții pentru GO pe apply:** (1) D7–D12 decise de Răzvan (runda 3: D7 refăcut pe ambele surse, D11, D12) și ordinea de livrare (G.0); (2) fișa de mai sus în `registru_automatizari`; (3) GO Copilot pe delta 30.09 + runda 3 (diff-ul efectiv trimis în chat, pct. 11); (4) harness `--reaplica --rollback` verde (S-A live) + rularea de verificare cu 20260930a; (5) G.2 (md5-uri, drepturi, acoperirea CNP pe ambele surse).
