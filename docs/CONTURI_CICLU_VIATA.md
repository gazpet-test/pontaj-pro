# Ciclul de viață al conturilor: legare automată, închidere la încetare, fost angajat ca extern

Specificație de implementare, 29.09.2026. Proiect Supabase `dxczwkbciseqniprspcu`, PG 17.6 în producție (local PG 16).
Cerințele lui Răzvan: **R1** legare automată cont↔fișă · **R2** contract încheiat → cont închis · **R3** fost angajat Gazpet ca posibil colaborator extern, cu acord sigur.
Documentul e scris din rapoartele de citire (BD, UI, teste) și din SELECT-uri de verificare făcute pe 29.09. În producție nu s-a scris nimic.

Migrări (fiecare cu `_ROLLBACK.sql` pereche):
- `supabase/migrations/20260929c_conturi_legare_automata.sql` (R1)
- `supabase/migrations/20260929d_conturi_inchidere_la_incetare.sql` (R2)
- `supabase/migrations/20260929e_fost_angajat_colaborare_externa.sql` (R3)

---

## 0. Decizii de luat cu Răzvan înainte de aplicare (A/B/C)

| # | Întrebare | Recomandare |
|---|---|---|
| D1 | **Înregistrarea publică de conturi.** În producție, confirmarea emailului e automată (`email_confirmed_at = created_at` la 10 din ultimele 12 conturi; recitit 29.09 seara: 15 din ultimele 20 confirmate în < 5 s). `createManager` apelează `supabase.auth.signUp` din browser, deci înscrierea publică e probabil pornită. Consecința: oricine are cheia anon (publică, e în bundle) își poate face cont cu `prenume.nume@gazpet.ro`. Cu R1 contul se leagă automat de fișa acelui om și primește acces la semnătura lui electronică (`hr_sem_self_*`). Riscul există și azi, doar că e mai larg: oricine își poate seta singur `employee_id` (vezi pct. A.4). Variante: **A** lăsăm așa, cu notificare la owner pentru fiecare legare automată · **B** oprim înscrierea publică (Dashboard → Auth → „Allow new users to sign up” OFF), iar conturile noi se creează din Dashboard → „Add user” · **C** facem o funcție edge `cont-nou`, cu poartă owner, pentru `auth.admin.createUser` (lucru separat, cu fișă în registru). | **B acum, C mai târziu.** Starea setării o verifică Răzvan în Dashboard; nu se poate citi din SQL. **După review (0.1):** migrarea c NU mai leagă singură la înscriere, deci nu mai depinde de D1 ca să fie sigură; B rămâne recomandat (un cont public tot primește `manager_santier` și citește `employees`). Cu B, `createManager` (signUp din browser) nu mai merge: toast-ul trimite la Dashboard → Add user, apoi „🔗 Leagă automat”. |
| D2 | Ce tip primește `razvantrusuhome@gmail.com`: `test` sau `extern`? | `test` |
| D3 | Alocările rămase după închiderea contului (aprobatori, responsabili, rute concediu): **A** doar alertă „Reasignează” · **B** dezactivare automată acolo unde există coloana `activ`. | **A**. Dezactivarea automată poate lăsa un flux fără niciun aprobator. |
| D4 | La reactivarea unui angajat (butonul „Activ.” din /admin) data încetării rămâne completată, iar cron-ul îl dezactivează din nou a doua zi la 04:00 UTC. Ștergem `termination_date` la reactivare, după o confirmare explicită? | **Da.** Implementat în `toggleEmp` (fără D4 reactivarea e anulată de cron a doua zi), **încă neconfirmat de Răzvan**. Urma nu se pierde: data veche se adaugă în `observatii_hr` („Reactivat la …; încetarea anterioară: …”). Dacă Răzvan zice „nu”, se scoate `termination_date:null` din `toggleEmp`. |
| D5 | Contul se închide în dimineața zilei `termination_date` (cron 04:00 UTC = 07:00 RO), la fel cum funcționează azi dezactivarea. Rămâne așa? | Da, fără schimbare de regulă. |
| D6 | Opțional, în migrarea 1: protejăm și `department` la auto-modificare? Azi oricine își poate pune singur `department='HR'` (prin politica `profiles_update_own`), iar asta deschide 4 politici HR. Același lucru e posibil pentru flagurile neprotejate (`can_create_comenzi`, `can_manage_stoc`, `can_access_ctc`, `can_process_achizitii`, `can_use_document_scanner`, `receive_*`). | Da pentru `department`. Pentru flaguri, doar după un grep care confirmă că UI-ul nu le scrie pe profilul propriu. |

### 0.1 Corecții după review (29.09 seara) — ce s-a schimbat față de prima variantă

| Constatare | Ce s-a schimbat | Teste |
|---|---|---|
| **Critic** — legarea la ORICE înscriere (signUp public + confirmare automată ⇒ oricine ia fișa și semnătura altcuiva) | `handle_new_user` leagă singur **doar pe calea de încredere** (`auth.users.raw_app_meta_data.gazpet_legare_automata = true`, pe care îl poate pune doar `service_role` prin API-ul admin — cârlig pentru funcția edge `cont-nou`, D1-C). Altfel contul se creează nelegat, owner-ul primește **propunerea** `cont_legare_propusa` (candidatul unic, cu „dacă nu-l recunoști, NU-l lega”) și confirmă dintr-un clic: Admin → Manageri → „🔗 Leagă automat” (previzualizare cu data creării contului → confirmare). Pentru Răzvan: „legarea automată” = sistemul găsește singur fișa; legătura efectivă o dă owner-ul (sau calea de încredere). | R1-00, R1-20 |
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

### A.3 `public.handle_new_user()` extinsă
Rămâne `SECURITY DEFINER`, cu `search_path` schimbat în `public, pg_temp`. Triggerul `on_auth_user_created` nu se atinge.

**După review (0.1), comportamentul e:** potrivirea rulează la fiecare cont nou, dar `UPDATE … employee_id` se face **doar** dacă `NEW.raw_app_meta_data ->> 'gazpet_legare_automata' = 'true'` (calea de încredere: `auth.admin.createUser({…, app_metadata:{gazpet_legare_automata:true}})` cu `service_role`, din viitoarea funcție edge `cont-nou` cu poartă owner). Pe signUp public și pe Dashboard → Add user: contul rămâne nelegat și owner-ii primesc `cont_legare_propusa` („Cont nou X → propunere: NUME (#id, prin email/nume). Dacă tu ai creat contul, confirmă din Admin → Manageri → „Leagă automat”. Dacă nu-l recunoști, NU-l lega și închide-l.”) — pe orice domeniu. `cont_nelegat` rămâne pentru @gazpet.ro cu 0 / >1 candidați / candidat ocupat / eroare. Schița de mai jos e varianta inițială (legare la orice înscriere) — vezi codul din migrare.
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
- `department` și flagurile scăpate de `enforce_owner_only_salary_flags` sunt tratate separat de migrarea `20260929g_profiles_campuri_owner_only` (alt lot, D6); cele două triggere sunt compatibile (ambele 42501).
- `handle_new_user` și cron-ul rulează cu `auth.uid()` NULL, deci trec. Owner-ul trece și el. UI-ul nu scrie nicăieri `employee_id` în afara modalului de owner (D.3).

### A.5 Legarea la cerere, cu previzualizare: `public.fn_cont_leaga_automat(p_simulare boolean DEFAULT true)`
- `RETURNS TABLE(profile_id uuid, email text, rezultat text, employee_id integer, employee_name text, metoda text, cont_creat_la timestamptz)` (după review: `email` = emailul de logare, plus metoda și data creării contului, ca owner-ul să recunoască un cont pe care nu l-a creat). Semnătura s-a schimbat → migrarea face `DROP FUNCTION IF EXISTS … (boolean)` înainte de `CREATE`.
- Rezultatele posibile: `legat`, `de_legat` (în simulare), `ambiguu` (mai mulți candidați **sau** mai multe conturi nelegate cu același candidat unic), `fara_candidat`, `candidat_ocupat`, `email_diferit` (`profiles.email ≠ auth.users.email`: sărit, de verificat manual), `eroare`.
- **Poartă în cod:** `auth.uid()` nenul și profilul apelantului are `is_owner`; altfel `RAISE … ERRCODE '42501'`.
- Parcurge doar profilurile cu `employee_id IS NULL AND COALESCE(tip_cont,'angajat') = 'angajat'`.
- `p_simulare=true` nu scrie nimic. Cu `false`, face `UPDATE … WHERE employee_id IS NULL`, fiecare rând în sub-bloc cu EXCEPTION.
- Drepturi: GRANT EXECUTE TO authenticated; REVOKE FROM PUBLIC, anon.
- Acoperă cazul „contul a apărut înaintea fișei”. Nu adăugăm trigger pe `employees` INSERT, ca să păstrăm suprafața de automatizare mică.

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

**Risc rezidual:** un JWT de acces deja emis rămâne valabil până la expirare (setarea „JWT expiry” din Auth, implicit 3600 s). Revocarea sesiunii oprește doar reîmprospătarea lui.

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

**Capcana cu triggerele owner-only.** Când închiderea o declanșează cineva din HR care nu e owner (`can_modify_employees`, adică Natalia, Oana, Cristina, Mădălina, Cristiana sau `claude@`), `auth.uid()` rămâne cel al acelui om. Atunci `trg_enforce_owner_only_salary_flags` pune la loc, **fără nicio eroare**, 8 flaguri, iar testul T3 confirmă asta. Soluția (a) de mai sus rezolvă problema fără să modifice cele 3 triggere existente:
- Claims se golesc doar în funcția internă, pe care niciun client nu o poate apela, și doar pentru UPDATE-ul care pune flagurile pe false.
- `set_config(…, true)` e local tranzacției. Dacă apare o eroare după golire, anularea subtranzacției readuce singură valorile GUC. Pe drumul normal le restaurăm explicit, pentru că o funcție cu `SET search_path` **nu** restaurează alte GUC-uri la ieșire.
- **Interzis:** să pui `SET "request.jwt.claims" = ''` în definiția funcției. În producție `postgres` nu e superuser, deci `CREATE FUNCTION` ar da „permission denied to set parameter”. Local ar trece, pentru că acolo e superuser. Ar fi un test verde care minte.

### B.4 Wrapper-ul pentru owner: `public.fn_cont_inchide_owner(p_profile_id uuid, p_motiv text) RETURNS text`
- **Poartă în cod:** apelantul e owner (`auth.uid()` nenul); altfel eroare 42501. Apoi apelează `fn_cont_inchide(…, 'manual_owner', <employee_id-ul profilului>)`.
- Se folosește pentru acțiunile din alertă: cont extern, cont activ pentru un angajat inactiv fără dată de încetare, dezactivare făcută înainte de data încetării.
- GRANT EXECUTE TO authenticated; REVOKE FROM PUBLIC, anon.

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

**De ce AFTER UPDATE, cu WHEN pe `active`, și nu `UPDATE OF active`:**
- **Calea UI** `saveEditEmp` trimite doar `termination_date`. `fn_employees_termination_notify` (BEFORE) pune `NEW.active=false`. Un trigger `UPDATE OF active` **nu ar porni**, pentru că nu ține cont de schimbările făcute de triggerele BEFORE. Triggerul AFTER vede NEW final. Același lucru pentru `toggleEmp`, care trimite `active` (și `termination_date`).
- **Calea cron** (`hr_auto_deactivate_terminated`, jobul 13, 04:00 UTC, rulează ca postgres fără JWT) face `UPDATE active=false`, fără să schimbe `termination_date`. Primul bloc din triggerul BEFORE nu se execută, dar AFTER prinde tranziția. În jurnal apare `facut_de = NULL`, adică „sistem”.
- **Jobul cron și `fn_employees_termination_notify` nu se modifică.** Nu există alte triggere AFTER UPDATE pe employees, iar sufixul `zz` doar fixează ordinea față de viitorul trigger R3.

### B.6 Restaurarea: `public.fn_cont_restaureaza(p_jurnal_id bigint, p_nota text) RETURNS jsonb`
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
- **Poartă:** owner, `can_modify_employees` sau `can_access_personal_data`. Pentru ceilalți întoarce **0 rânduri**, fără eroare, iar UI-ul doar ascunde indicatorul.
- GRANT EXECUTE TO authenticated; REVOKE FROM PUBLIC, anon.

### B.8 Alerta extinsă: `CREATE OR REPLACE public.fn_admin_conturi_alerte()` (aceeași semnătură, aceeași poartă owner)
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
- ⚠️ `employees` are politica SELECT `USING (true)`, deci nota o poate citi orice utilizator logat. UI-ul avertizează: „fără date sensibile; documentul semnat se pune în Documente personale”.

### C.2 Protecția stării: `public.fn_employees_colab_ext_protectie()` (SECURITY DEFINER)
Funcția e atașată la două triggere:
- `trg_employees_colab_ext_protectie_ins`: `BEFORE INSERT … WHEN (NEW.colaborare_externa_status <> 'necunoscut' OR NEW.colaborare_externa_confirmat_de IS NOT NULL OR NEW.colaborare_externa_confirmat_la IS NOT NULL)`. Pornește și aruncă eroare: o fișă nouă începe întotdeauna ca „necunoscut”.
- `trg_employees_colab_ext_protectie_upd`: `BEFORE UPDATE … WHEN` se schimbă oricare dintre cele 5 coloane (`IS DISTINCT FROM`).
  - `auth.uid()` NULL (sistem, cron, service_role, migrare) → `RAISE … 42501`: „starea o setează doar un om din platformă”.
  - Apelantul nu e owner și nu are `can_modify_employees` → 42501.
  - Status ≠ `necunoscut` și `NEW.termination_date IS NULL` → eroare („doar pentru contracte încheiate sau cu dată de încetare”).
  - `necunoscut` → golește `confirmat_de/la` și `document`.
  - Altfel **forțează** `confirmat_de := auth.uid()` și `confirmat_la := now()`: nu se acceptă valori venite din client.
- Rulează înaintea lui `trg_employees_termination_notify` (ordine alfabetică), dar cele două nu depind una de alta.
- **După review — acordul e legat de încetarea curentă:** `WHEN`-ul triggerului de UPDATE include și `active` / `termination_date`. La reactivare (`OLD.active IS NOT TRUE AND NEW.active IS TRUE`) sau la ștergerea datei de încetare, funcția pune `necunoscut` și golește proveniența, nota și documentul, **înainte** de verificările de rol — e direcția sigură (nu deduce niciun acord), deci merge și pe calea de sistem (admin fără JWT). Dacă s-au schimbat doar `active`/`termination_date` fără reset (ex. cron-ul), funcția iese imediat. Efect: „accepta” nu poate rămâne pe un angajat activ și nu se moștenește la următoarea plecare.

### C.3 Jurnalul acordului: `public.hr_colaborare_externa_jurnal`
- Coloane: `id` identity PK, `employee_id integer NOT NULL` (fără FK), `status_vechi`, `status_nou`, `nota`, `document`, `facut_de uuid` (NULL = sistem), `facut_la timestamptz NOT NULL DEFAULT now()`, `sursa text NOT NULL DEFAULT 'manual' CHECK (sursa IN ('manual','reset_automat'))`. Rândul de reset are nota „Resetat automat: fișa a fost reactivată / data încetării a fost ștearsă; acordul era pentru încetarea din …”.
- Append-only: trigger care refuză UPDATE, DELETE și TRUNCATE.
- RLS: SELECT pentru `auth.uid() IS NOT NULL` și (owner SAU `can_modify_employees` SAU `can_access_personal_data`). Fără politici de scriere; REVOKE INSERT/UPDATE/DELETE/TRUNCATE de la authenticated, ALL de la anon; GRANT SELECT authenticated, ALL service_role.
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
- Dacă s-a schimbat statusul, nota sau documentul → `INSERT` în `hr_colaborare_externa_jurnal`, cu `facut_de = auth.uid()`.
- Dacă statusul a plecat de la `accepta`, sau angajatul a fost reactivat (`OLD.active IS NOT TRUE AND NEW.active IS TRUE`) → `UPDATE hr_personal_extern SET activ = false, updated_at = now() WHERE fost_angajat_employee_id = NEW.id AND activ`.
- **Activarea nu se face niciodată automat.** Un om bifează „Colaborare activă”.

### C.6 Funcțiile apelabile din UI
Ambele sunt `SECURITY DEFINER SET search_path = public, pg_temp`, cu poartă în cod: `auth.uid()` nenul și owner sau `can_modify_employees`. GRANT EXECUTE TO authenticated; REVOKE FROM PUBLIC, anon.

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
- **Verificare:** `--rollback` compară schema cu `pg_dump`, înainte și după. Trebuie să iasă identică, fără `ROLLBACK_DIFF_TOLERAT`.

---

## G. Aplicarea în producție (Claude) + fișa de securitate

### G.1 Local, înainte de orice
1. `git fetch --all --prune && git pull --ff-only`. Branch nou și PR (fără push direct pe `main`).
2. Rulezi `bash scripts/test_conturi_ciclu_viata.sh --reaplica` și apoi `--rollback`. Ambele trebuie să iasă cu cod 0.
3. `npm install` apoi `npx vitest run` și `npx vite build`.
4. `git diff --stat` **nu** trebuie să conțină `src/Ofertare*`, `src/ofertare*`, `supabase/functions/ofertare-*`, SalariiPage (App.jsx ~8076-8200), Logistica.jsx, Administrativ.jsx sau ServiceTab.jsx.

### G.2 Verificări în producție înainte de aplicare (doar SELECT)
- Hash-ul `md5(pg_get_functiondef(...))` pentru `handle_new_user`, `fn_employees_termination_notify`, `enforce_owner_only_salary_flags`, `prevent_role_escalation`, `protect_can_access_pontaj_brut` trebuie să fie identic cu schelet-ul. Dacă au fost modificate între timp, te oprești și le arăți lui Răzvan.
- `cron.job` 13: se verifică doar comanda, fără să fie copiată nicăieri, pentru că jobul are secrete.
- Obiectele cu numele noi nu trebuie să existe deja.
- Cifrele de reper: 31 de profiluri, 25 legate, 6 nelegate, 2 owneri.

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
- `pg_get_triggerdef` pe `trg_employees_zz_ciclu_cont`: AFTER UPDATE, cu WHEN pe `active`.
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
- **Avertismente așteptate** pentru funcțiile SECURITY DEFINER apelabile de `authenticated`: `fn_cont_inchide_owner`, `fn_cont_restaureaza`, `fn_cont_leaga_automat`, `fn_admin_conturi_alerte`, `fn_cont_stare_angajati`, `fn_colaborare_externa_seteaza`, `fn_fost_angajat_leaga_extern`. Sunt intenționate, cu poartă de rol în cod, și se notează în registru.

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

### G.12 Fișa de securitate (`registru_automatizari`, CLAUDE.md pct. 7)
Fără edge function nouă, fără cron nou, fără secret nou. Cron-ul `hr_auto_deactivate_terminated` rămâne neschimbat și devine declanșator indirect.

| | R1: `handle_new_user` (trigger `on_auth_user_created`) | R2: `trg_employees_zz_ciclu_cont` → `fn_cont_inchide` | R3: triggerele colab / extern |
|---|---|---|---|
| (a) Conținut extern citit | Emailul contului nou. Cu înscriere publică (D1), e **text scris de oricine**. Mai citește `employees.name/email` (introduse de HR). | `employees.active/termination_date` (introduse de HR / cron) | Nota și documentul (text scris de HR) |
| (b) Ce scrie | `profiles.employee_id` (doar pe NULL), `notifications` pentru owneri. Nu trimite mail. Nu dă drepturi. | Șterge `user_module_access` și `profile_sites`, pune flagurile pe false, `auth.users.banned_until`, revocă sesiuni și tokeni, scrie jurnal și `notifications`. **Doar ia drepturi**, nu le dă niciodată. Nu trimite mail. | Jurnalul acordului; `hr_personal_extern.activ = false` (doar dezactivează) |
| (c) Identitate | SECURITY DEFINER `postgres` (BYPASSRLS, nu superuser). Necesar pentru că GoTrue (`supabase_auth_admin`) nu are drepturi pe `public`. Fără `service_role`. | SECURITY DEFINER `postgres`. Necesar pentru `auth.*` și tabelele owner-only. Claims se golesc doar pentru UPDATE-ul de flaguri pe false. | SECURITY DEFINER `postgres` |
| (d) Cine pornește | Crearea unui cont în GoTrue | Orice UPDATE pe `employees` permis de RLS (owner / `can_modify_employees`) sau cron-ul. Funcțiile interne au REVOKE de la anon, authenticated și service_role. RPC-urile din UI verifică `is_owner` **în cod**. | RPC-urile verifică owner / `can_modify_employees` în cod. Triggerele refuză `auth.uid()` NULL. |
| (e) Confirmare umană | **După review:** la signUp public / Dashboard legarea NU se face singură — owner-ul primește propunerea și confirmă (previzualizare → confirmare, cu data creării contului). Legare fără confirmare doar pe calea de încredere (`app_metadata` pus de `service_role`, deci de o funcție cu poartă owner). Potrivirea e pe emailul de logare, fără suprascriere, legătura și emailul profilului sunt protejate. Regula tare (a)+(b) e respectată (poartă = confirmarea owner-ului). D1-B rămâne recomandat. | Reacordarea drepturilor (restaurarea) e doar owner, explicit. Închiderea nu cere confirmare, pentru că direcția e sigură, iar declanșatorul e o dată pusă de un om. | Acordul îl setează doar un om, niciodată automat. Activarea externului o face doar un om. |
