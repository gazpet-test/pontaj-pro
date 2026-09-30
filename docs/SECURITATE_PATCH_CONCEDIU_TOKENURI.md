# Patch de securitate 20261003d — tokenurile de concediu (`hr_concediu_tokens`)

> **Domeniul verdictului (formulare Copilot, 30.09): citirea directă prin rolurile API este restrânsă; obținerea tokenurilor prin toate căile aplicației nu este încă demonstrată ca restrânsă.** Un edge cu `service_role` poate citi în continuare tabelul; faptul că nu e afectat de patch e compatibilitate, nu dovada că propriul endpoint e autorizat corect.
>
> **Revizia 4 (30.09): tiparul de livrare** — fișierul nu mai are BEGIN/COMMIT, ci garda de livrare de start/final legată de txid; **runnerul comun NU e portat** (NO-GO Copilot r4 pe `scripts/livrare_migrare.sh`, se reface în runda 5); **§9**. Logica patch-ului e neschimbată.
>
> **Stare: DOAR PREGĂTIRE, NEAPLICAT.** Runda 2 (răspuns la verdictul „GO CU CORECTURI pe logică”): §8. Copilot a dat „GO DOAR PREGĂTIRE” pe acest domeniu, separat de trezorerie (verdictul pe matrice, 30.09). Aplicarea cere **GO-ul lui Copilot pe revizia finală + acordul lui Răzvan**. Nimic nu s-a scris în producție: investigația a folosit doar SELECT pe cataloage și numărători agregate. **Nu s-a citit și nu apare aici nicio valoare de token, telefon sau IBAN.** Tokenurile din teste sunt fictive.

Fișiere:
- `supabase/migrations/20261003d_sec_concediu_tokens.sql` — migrarea (fără BEGIN/COMMIT din runda 4; tranzacția o deține runnerul de livrare — §9)
- `supabase/revenire/20261003d_sec_concediu_tokens_ROLLBACK.sql` — revenirea tehnică, fără GO de execuție (+ `supabase/revenire/README.md`)
- `scripts/test_sec_concediu_tokens.sh` + `supabase/tests/sec_concediu_tokens_schelet.sql` + `supabase/tests/sec_concediu_tokens.test.sql` — harness-ul PG16 local

Prefixul `20261003d` a fost verificat liber pe toate branch-urile `origin/*` și în worktree-urile `scratchpad/wt-*` (ocupate: `a` jak, `b` Ofertare, `c` RSVTI; `e` e rezervat trezoreriei).

---

## 1. Gaura: expunere structurală, nu furt demonstrat

| Fapt (producție, 29.09, read-only) | Valoare |
|---|---|
| Politici pe `hr_concediu_tokens` | una singură: `hr_tokens_sel` = `SELECT TO authenticated USING (auth.uid() IS NOT NULL)`, fără politici de scriere |
| RLS | activ, fără FORCE; owner `postgres`; fără moșteniri; fără ACL pe coloane |
| Privilegii efective (`has_table_privilege`) | `anon` și `authenticated`: toate 8 (inclusiv TRUNCATE, MAINTAIN pe PG17); PUBLIC: nimic; `service_role`: toate |
| Tabelul | PK `employee_id` (un token/angajat), `UNIQUE(token)`, `token` = 32 hex aleator, `activ`, `created_at`. **Nu are expirare și nici marcaj de folosire.** Niciun trigger propriu, nicio funcție din BD și niciun view nu îl referă |
| Origine | migrarea `20260710231046 hr_concediu_faza4_5_tokens_reconciliere`: `GRANT SELECT … TO authenticated -- HR vede link-urile în ERP` + politica de mai sus + seed pentru toți angajații activi |

**Criteriul real de valabilitate** este cel din edge-ul `concediu-mobil` (v10, `verify_jwt=false`, citit read-only): tokenul trece dacă respectă `^[a-f0-9]{32}$` **și** există un rând cu `token = t AND activ = true`. Edge-ul nu verifică expirarea (nu există), nici dacă angajatul mai lucrează în firmă.

| Numărătoare (agregat) | |
|---|---|
| Rânduri | **117**, toate create în aceeași zi (10.07.2026, seed-ul) |
| Valide la edge (activ + format) | **117 / 117** |
| — ale angajaților activi azi | 105 |
| — ale angajaților plecați (`active=false` și `termination_date` trecut) | **12** — linkul încă funcționează |
| Angajați activi fără token | 15 (angajați după 10.07: nu există mecanism care să creeze tokenuri noi; butonul le răspunde „Angajatul nu are token activ”) |

Ce dă un token, fără cont: `GET ?api=info` → numele, funcția, soldul CO și ultimele 8 cereri ale angajatului; `POST` → depune o cerere de concediu în numele lui (statut `depusa`, notificare la HR).

Deci orice cont logat (inclusiv unul nou, fără niciun modul) putea lista toate cele 117 tokenuri prin REST și acționa în numele oricui pe `/co`. Este o **expunere structurală**: nu avem dovezi că s-a întâmplat. Contoarele `pg_stat` nu servesc ca probă: sunt resetate la repornire și cresc și din interogările de audit, inclusiv din ale noastre.

## 2. Actorii legitimi (dovezi din cod)

| Actor | Operație | Dovadă |
|---|---|---|
| **Edge `concediu-mobil`** (pagina publică `/co`) | SELECT `employee_id` după `token` + `activ` | sursa edge-ului: `createClient(URL, SUPABASE_SERVICE_ROLE_KEY)`, `.from('hr_concediu_tokens').select('employee_id').eq('token', token).eq('activ', true)`; pagina: `src/ConcediuMobilPage.jsx:12`, ruta `src/App.jsx:8575` |
| **Butonul „🔗 Link mobil”** din HR → Concedii | SELECT `token` pentru angajatul filtrat | `src/TabConcedii.jsx:341-345`. **Butonul nu e condiționat de `isHR`**: îl vede oricine ajunge în tabul Concedii |
| Cine ajunge în tabul Concedii | poarta rutei `/hr` | `src/App.jsx:8583` `ProtectedRoute requireModule="hr"` → `hasModuleAccess` (`src/App.jsx:106-112`): `is_owner === true` **sau** modul `'hr'` **sau** modul care începe cu `'hr.'`; tabul `concedii` nu are filtru suplimentar (`src/HR.jsx:230, 318`); verificarea internă `src/HR.jsx:158` aplică aceeași regulă |
| Creare / modificare / ștergere | niciuna din UI sau din BD | grep în `src/` și `supabase/`: singurul acces e SELECT-ul de mai sus; fără politici de scriere, deci azi scriu doar `service_role` și `postgres` |

**Predicatul de citire** reproduce exact poarta UI: `owner` SAU un rând în `user_module_access` cu `module = 'hr'` sau `left(module,3) = 'hr.'`, pentru `auth.uid()`. Comparația e case-sensitive, ca în JS: `'HR'` nu trece.
**Predicatul de scriere**: niciunul pentru `anon` și `authenticated`, la fel ca azi. Scrierea rămâne la `service_role`.

Cine vede linkurile azi prin UI (producție, 29.09): **10 conturi**, adică 2 owneri (Razvan Trusu, Tudorache Marilena Claudia) și 8 non-owneri cu modulul `hr`: Natalia Udrea (HR, admin), Madalina Tanase, Oana Nica, Cristina Dumitrescu (Administrativ), Mirela Popescu (Contabilitate), Mioara Olaru și Silviu Stanescu (Ofertare), contul „Claude” (IT). Toți au `hr:editor`, în afară de Natalia (`hr:admin`). Nu există azi sub-module `hr.*`. Cu patch-ul, **niciunul dintre ei nu pierde accesul.** Îl pierd doar conturile fără modulul HR, care oricum nu văd butonul și puteau citi doar direct prin REST.

## 3. Patch-ul (`20261003d_sec_concediu_tokens.sql`)

1. `BEGIN;` și `SET LOCAL search_path = public, pg_temp`, ca deparse-ul expresiilor să fie determinist.
2. **Precondiție fail-closed.** Face o amprentă text completă pe trei componente: tabel (kind, RLS, FORCE, owner, moșteniri, ACL pe coloane), politici (nume, comandă, permisiv, roluri, md5 pe `qual`/`with_check`, cu `NULL` → `'<NULL>'`) și privilegii efective pentru `anon`, `authenticated`, `public` și `service_role` (`has_table_privilege`, deci inclusiv PUBLIC și moștenirea; `has_any_column_privilege` pentru granturile pe coloane; `… WITH GRANT OPTION`). Comparațiile sunt `IS [NOT] DISTINCT FROM`. Acceptă doar **perechi complete**: live (politică live + ACL live) sau patch (reaplicare, fără efect net). Refuză orice stare mixtă sau necunoscută. Verifică și dependențele politicii (`profiles.id/is_owner`, `user_module_access.profile_id/module`, cu tipuri) **și invarianții sursei drepturilor** (runda 2, blocul `<invarianti-20261003d>`, `[pre:invarianti]`): RLS pe `profiles` și `user_module_access`, toate politicile lor de scriere (md5 pe expresii), triggerele `prevent_role_escalation_trigger` și `trg_enforce_owner_only_salary_flags` (activare, definiție, md5 pe corpul funcției) și `anon`/`authenticated` fără BYPASSRLS/superuser. Valorile sunt cele citite read-only pe live pe 30.09 cu aceeași interogare; orice diferență refuză patch-ul (§8).
3. Schimbarea: `DROP POLICY hr_tokens_sel` → `CREATE POLICY hr_tokens_sel_modul_hr … FOR SELECT TO authenticated USING (owner OR modul hr/hr.*)` → `REVOKE ALL … FROM PUBLIC, anon, authenticated` → `GRANT SELECT … TO authenticated`. `service_role` rămâne neatins.
4. **Postcondiție înainte de `COMMIT`**: aceeași amprentă trebuie să fie exact ținta, altfel se anulează tot.
5. `COMMIT;`. Fișierul nu are meta-comenzi psql, deci merge și ca un singur simple query.

Amprenta de producție a fost recalculată read-only cu **aceeași interogare** și e identică cu starea live din fișier (PG17 adaugă doar `MAINTAIN`, tratat prin versiune). md5-ul politicii noi (`ab5d2578…`) e **identic pe PG16 (local) și PG18 (PGlite 0.5.8)**. Pe PG17 n-a fost rulat. Dacă diferă acolo, postcondiția anulează atomic migrarea. În cazul ăsta se compară definițiile și se revizuiește lista albă după review, nu se adaugă automat hash-ul găsit.

## 4. Testele și rezultatele

`bash scripts/test_sec_concediu_tokens.sh` rulează pe un cluster PG16 **dedicat** (port 5483, `/tmp/pg_sec_concediu`, `autovacuum=off`) și refuză dacă pe port răspunde alt cluster. Rulat de 2 ori complet (după runda 2): **exit 0 de fiecare dată**, cu **91 de verificări în harness** și suita de comportament de **33 de verificări**, rulată în fiecare scenariu, plus suita `runda2` (12). **19 mutanți prinși.** Detaliile rundei 2: §8.

> **Runda 4:** punctele „3 emulări de runner” și „eroare injectată × 4 emulări” de mai jos sunt **înlocuite** de testul traseului real de livrare (§9). Cifrele actuale: 90 de verificări în harness, 21 de mutanți.

- **Starea de azi reprodusă și demonstrată**: amprenta locală = producția. Suita „gaura” (8) trece pe live. Suita patch **pică pe live**, iar 12/12 verificări-cheie pică izolat.
- **Comportament după patch** (suita, 33): edge-ul cu `service_role` validează tokenul, poate revoca (UPDATE `activ`) și reemite (INSERT), cu scrierile anulate în test. Owner, HR, cont Ofertare cu modul `hr` și sub-modul `hr.concedii` văd **exact aceleași rânduri ca azi** (număr + md5). Conturile fără modul, cu alte module, cu capcane de prefix (`HR`, `hrana`, `hr_extern`, `xhr.`, `' hr'`), departament HR fără modul, superadmin fără modul, `can_access_personal_data` fără modul, uid fără profil și JWT fără `sub` văd 0 rânduri, pe un tabel cu 5 rânduri (control pozitiv). `anon` primește refuz de privilegiu la SELECT, TRUNCATE și INSERT. Nimeni logat, nici HR, nici ownerul, nu poate scrie sau face TRUNCATE. PUBLIC/coloane/GRANT OPTION sunt goale. Robustețe: HR vede în continuare și dacă `profiles`/`user_module_access` ar fi restrânse la rândul propriu.
- **3 emulări de runner** (drum fericit, înregistrare): `psql -v ON_ERROR_STOP=1 -f`; un singur simple query `psql -c "$(cat f)"`; runner cu tranzacție proprie `BEGIN; <fișier> INSERT INTO supabase_migrations.schema_migrations …; COMMIT;` într-un string, pe o tabelă locală creată doar pentru emulare.
- **Eroare injectată** (`SELECT 1/0` după prima schimbare, `PERFORM 1/0` în postcondiție, `SELECT 1/0` înainte de `COMMIT`) × 4 emulări: e1s, **e1n = `psql -f` fără ON_ERROR_STOP**, e2, e3. **În toate 12 cazurile starea rămâne inițială și migrarea nu e înregistrată.** Mutantul fără `BEGIN/COMMIT` e prins în e1n, unde prima schimbare rămâne. ⚠️ `psql -f` fără `ON_ERROR_STOP` întoarce cod 0 la eroare SQL. Starea rămâne corectă, dar un runner care înregistrează după codul de ieșire ar înregistra greșit. De aceea se aplică doar cu `ON_ERROR_STOP=1` sau prin `apply_migration`.
- **Precondiții negative (16), toate refuzate fără urme**: politică live fără USING (qual NULL), cu `USING (true)`, pe roluri `public`, RESTRICTIVE; politică permisivă în plus; politică de scriere în plus; RLS dezactivat; FORCE; owner schimbat; grant pe coloană; ACL mixt; PUBLIC cu SELECT; anon care moștenește SELECT printr-un alt rol; politică patch + ACL live; politică live + ACL patch; dependență lipsă.
- **Revenirea**: e refuzată când nu e armată, când e armată cu valoare greșită sau fără txid, cu **setare de sesiune rămasă**, cu **armare + eroare + reluare fără armare nouă**, cu armare + revenire eșuată + reluare, și când pornește din live. **Armarea persistentă** e refuzată în trei forme: `ALTER DATABASE SET`, `ALTER ROLE SET` cu nume cu majuscule și o armare persistentă care **nimerește exact txid-ul viitor**. Ultima dovedește că verificarea `pg_db_role_setting` e necesară separat de legarea de txid. Eroarea injectată în revenire lasă patch-ul intact. Revenirea armată corect aduce **exact** starea live (amprentă + gaura reprodusă) și dezarmează comutatorul și în sesiune. Reaplicarea după revenire funcționează.
- **Mutanți (18), toți prinși.** Pe patch: fără DROP al politicii vechi, `USING(true)`, fără ramura owner, fără `hr.*`, prefix larg `LIKE 'hr%'`, orice uid, `TO public`, `FOR ALL`, anon păstrat, authenticated păstrat, fără `GRANT SELECT`. Fiecare e anulat de postcondiție (stare live, neînregistrat) și, cu postcondiția scoasă, **9 din 11** sunt prinși și de comportament. `TO public` și `FOR ALL` sunt declarat echivalente comportamental: le acoperă REVOKE-ul și le prinde doar postcondiția. Pe precondiție (2): „acceptă orice stare”, „fără verificarea tabelului”. Mutantul fără BEGIN/COMMIT. Pe revenire (4): fără verificare persistentă, fără legarea de txid, fără verificarea stării de pornire, fără dezarmare.

## 5. Procedura de aplicare (după GO Copilot + acordul lui Răzvan)

1. **Preview read-only**: rulezi interogarea de amprentă (blocul `<amprenta-20261003d>`) și interogarea de invarianți (blocul `<invarianti-20261003d>`, cu `SET search_path = public, pg_temp`) și le compari cu listele albe din fișier. Listezi **nominal** conturile care ar vedea linkurile (owner + modul `hr`/`hr.*`, cu `access_level` și modulul exact), fără valori de tokenuri, și **separat** categoriile excluse intenționat (departament HR, superadmin, `can_access_personal_data` fără modul).
2. **CONDIȚIE: aprobarea explicită a lui Răzvan asupra grupului țintă** rezultat din preview (inclusiv: orice `hr.*`, `hr` cu `viewer`, valoarea exactă `'hr.'`, conturile de agent precum „Claude”, conturile din alte departamente cu modul `hr`). Fără această aprobare nu se aplică. Revocarea/reemiterea (§6) rămâne o operație separată și **nu** e condiție pentru patch; un drept distinct pentru distribuirea linkurilor poate veni ulterior.
2b. **Probă obligatorie înainte de apply**: invarianții sursei drepturilor sunt egali cu cei din fișier (îi verifică oricum precondiția, atomic). Dacă diferă, se analizează ce s-a schimbat pe `profiles`/`user_module_access` și se consemnează revizia; nu se copiază hash-ul nou în fișier fără review.
3. **Apply (runda 4, înlocuiește textul anterior)**: numai prin runnerul de livrare comun, **după GO-ul lui Copilot pe runda 5** (§9); până atunci nu există traseu de apply aprobat. NU `apply_migration` / `execute_sql` / `psql -f`: fișierul le refuză prin garda de livrare. Nu se lipesc bucăți. Dacă apare totuși „aplicat, neînregistrat” (livrare manuală): stop, reconciliere read-only, fără rollback tehnic pentru a alinia istoricul.
4. **Verificare**: amprenta = ținta. Contul de test fără modul (`test.fara.modul@…`) citește 0 rânduri prin REST. Natalia apasă „🔗 Link mobil” și primește linkul. Un link `/co` existent se deschide în continuare. Nimic nu se actualizează automat în listele albe: orice diferență de amprentă se analizează.

Revenirea nu are GO de execuție. Se folosește doar la cererea explicită a lui Răzvan + review specific, în forma din antetul fișierului.

## 6. DECIZIILE lui Răzvan (separat de patch)

**(1) Revocarea/reemiterea celor 117 tokenuri expuse.** Restrângerea SELECT **nu invalidează** o copie obținută anterior: cine a listat tokenurile până acum le poate folosi în continuare pe `/co`. Opțiuni:
- **A — invalidare totală, apoi reemitere doar pentru eligibilii confirmați** (recomandat dacă se vrea închiderea expunerii; rescris după verdictul Copilot):
  1. **Invalidarea tuturor celor 117 credentiale vechi** (niciun token vechi nu mai trece, nici la `?api=info`, nici la POST).
  2. **Emiterea/activarea de credentiale noi numai pentru angajații confirmați ca eligibili** de Răzvan (azi candidații sunt cei 105 activi cu token). Un simplu `UPDATE … SET token = …` pe toate rândurile NU e acceptabil: ar da celor 12 plecați credentiale noi, încă active.
  3. **Cei 12 angajați plecați: dezactivați** (`activ = false`, fără token nou) **după confirmarea lui Răzvan**, nominal.
  4. **Cei 15 activi fără token: decizie separată de creare**; nu intră implicit în rotație.
  5. **Preview nominal, fără tokenuri**: pentru fiecare rând vizat — `employee_id`, numele angajatului, clasificarea (activ-eligibil / plecat / fără token), acțiunea propusă (reemitere / dezactivare / nimic) și starea de referință (`activ`, `created_at`, `employees.active`, `termination_date`, plus un md5 al tokenului curent calculat în BD, neafișat ca valoare, doar ca amprentă de stare). **Apply-ul verifică în aceeași tranzacție că starea de referință nu s-a schimbat** de la confirmare; orice diferență oprește tot (nu se suprascrie tacit).
  6. **Eligibilitatea angajatului și expirarea se verifică la edge atât la `?api=info`, cât și la POST** (controale complementare mecanismului de emitere, nu alternative). Lipsa informației de eligibilitate nu devine automat „eligibil” sau „neeligibil”: comportamentul se decide explicit.
  7. Operațional: linkurile trimise pe WhatsApp încetează să meargă; HR retrimite linkurile noi eligibililor din butonul „🔗 Link mobil”. Tehnic cu `service_role`, pattern preview → confirmare → apply, cu `RETURNING employee_id` (niciodată tokenul) și verificare prin numărători.
  8. Până la rotație sau o invalidare echivalentă, consemnarea rămâne: **„expunerea directă redusă; credentialele anterior accesibile rămân utilizabile”**. Cererile existente nu se șterg și nu se declară frauduloase automat.
- **B — doar dezactivarea celor 12 ai angajaților plecați** (`activ=false`), fără efort pentru cei activi. Expunerea rămâne pentru cei 105.
- **C — nimic** acum, cu riscul acceptat explicit.

Oricare dintre ele e operație pe date reale: cere acordul lui explicit și se face separat de acest patch.

**(2) Verificarea expirării / valabilității.** Azi un token e valabil pe viață, inclusiv după plecarea angajatului. Variante de decis:
- (a) edge-ul refuză tokenul dacă angajatul nu e activ, adică `employees.active` / `termination_date`;
- (b) coloană `expira_la` + reemitere periodică;
- (c) un mecanism care creează tokenuri pentru angajații noi (azi 15 activi n-au).

Toate sunt schimbări de edge sau schemă, deci patch-uri separate.

**(3) Categorii care văd azi linkurile prin UI.** Patch-ul păstrează exact poarta UI, deci **nu pierde nimeni** accesul din UI. Totuși, butonul „🔗 Link mobil” nu cere HR: îl vede oricine are modulul `hr`, inclusiv 4 conturi fără rol HR sau acces la date personale (Cristina Dumitrescu, Mirela Popescu, Mioara Olaru, Silviu Stanescu), plus contul „Claude” (IT). Dacă tokenurile trebuie restrânse la HR propriu-zis, varianta propusă de matrice e `owner | can_access_personal_data | departament HR`, sau `hr` cu `access_level='admin'`. Atunci **cei 4 ar pierde butonul**, care în forma actuală le-ar afișa un mesaj înșelător („Angajatul nu are token activ”). Pentru asta e nevoie de un patch nou în BD plus ascunderea butonului în UI. Orice sub-modul `hr.*` acordat de acum încolo dă și el acces la tokenuri.

## 7. Ce n-a fost verificat / limite

- **Exploatarea efectivă**: nu s-au citit jurnalele API/edge. Ar putea conține tokenuri în URL (`?t=`), așa că se analizează doar cu filtrare atentă și cu acordul lui Răzvan.
- **PG17**: testele rulează pe PG16. md5-ul politicii noi e confirmat pe PG16 și PG18, dar nu pe PG17. Protecția e postcondiția atomică.
- **Emulările** reproduc runner-ele, nu `apply_migration` însuși. Presupunem că trimite textul ca un singur query, sau în tranzacție proprie, cu înregistrarea după, și ambele variante sunt demonstrate. Local, runner-ul e superuser, iar pe Supabase e `postgres` ne-superuser: DDL-ul pe un tabel al cărui owner e `postgres` merge în ambele cazuri.
- **Simularea actorilor** folosește `SET ROLE` + claims. Asta demonstrează traseul RLS/privilegii, nu reproduce integral PostgREST sau edge-ul (`session_user` rămâne `postgres`; politica nu îl folosește).
- **Edge-urile deployate**: 140 în producție, 50 în repo. S-a citit doar `concediu-mobil`. Pentru celelalte s-a verificat doar că nicio funcție din BD și niciun view nu referă tabelul. Un edge cu `service_role` nu e afectat de patch. Un edge care ar citi tokenurile **cu JWT-ul utilizatorului** ar fi restrâns ca REST-ul, ceea ce e comportamentul dorit.
- Roluri de infrastructură (`pg_read_all_data`, `supabase_read_only_user`, `supabase_etl_admin` etc.) pot citi tabelul. Sunt limită de încredere, în afara patch-ului.

## 8. Runda 2 — răspuns la verdict (Copilot 30.09, „GO CU CORECTURI pe logică”)

Nu s-a atins BEGIN/COMMIT și nici traseul de livrare (runda 4 comună, se portează după #538/#542). Nimic aplicat pe live; pe Supabase doar SELECT pe cataloage (fără date de rând, fără tokenuri).

### 8.1 Sursa drepturilor pe live (read-only, 30.09)

| Obiect | Stare efectivă | Efect asupra autoatribuirii |
|---|---|---|
| `profiles` | RLS on (fără FORCE, owner `postgres`). Scriere: `profiles_insert_owner` / `profiles_delete_owner` / `profiles_update_owner` = doar owner; **`profiles_update_own` = oricine își poate face UPDATE la propriul rând** | UPDATE `is_owner` pe rândul propriu e oprit de triggere: `prevent_role_escalation_trigger` (ridică excepție la schimbarea `role`/`is_owner` de un non-owner; rulează primul, ordine alfabetică) și `trg_enforce_owner_only_salary_flags` (resetează `is_owner` + flagurile `can_access_*` la valoarea veche). INSERT profil propriu: doar owner |
| `user_module_access` | RLS on. INSERT/UPDATE/DELETE: **doar owner**; fără triggere | un cont fără modul nu poate insera/modifica/prelua rânduri |
| `handle_new_user` (SECURITY DEFINER, creează profilul la signup) | nu referă `is_owner` și nici `raw_*_meta_data` | profil nou = `is_owner` implicit `false` |
| Alte funcții SECURITY DEFINER care scriu în `profiles`/`user_module_access` | niciuna găsită (căutare pe `prosrc` după `INSERT INTO`/`UPDATE`) | — |
| `anon` / `authenticated` | fără BYPASSRLS, fără superuser | — |

**Concluzie: azi un cont `authenticated` fără modul NU își poate autoatribui `is_owner` sau un rând în `user_module_access`** (pe căile verificate). Nu e finding blocant de autoatribuire.

**Finding-uri noi (neblocante pentru acest patch, de raportat separat):**
- **F1 — TRUNCATE pe sursa drepturilor.** `anon` și `authenticated` au `SELECT, INSERT, UPDATE, DELETE, TRUNCATE` pe `profiles` și `user_module_access` (default privileges Supabase). TRUNCATE **ocolește RLS**. Nu dă drepturi (nu se poate autoatribui nimic), dar un TRUNCATE pe `user_module_access` (nicio FK nu o referă) ar șterge toate drepturile, iar pe `profiles` … CASCADE ar lovi toate tabelele care o referă. PostgREST nu expune TRUNCATE, deci calea realistă e doar SQL direct / o funcție cu SQL dinamic; e igienă de privilegii, nu exploatare demonstrată. Același tipar ca pe `hr_concediu_tokens` (pe care patch-ul îl repară doar local).
- **F2 — ocolirea triggerelor când `auth.uid()` e NULL.** `prevent_role_escalation` / `enforce_owner_only_salary_flags` sar peste verificare fără `sub` în JWT. Pentru `authenticated` fără `sub`, `profiles_update_own` nu potrivește niciun rând, deci nu e exploatabil prin API; dar orice cale `service_role` (edge-uri) poate seta `is_owner` fără verificare. Limită de încredere, ca în §7.
- **Limită a căutării:** funcțiile cu SQL dinamic (`EXECUTE format(...)`) care ar scrie în aceste tabele nu sunt prinse de căutarea textuală; nici edge-urile (140 deployate) nu au fost inventariate pentru scrieri în `profiles`/`user_module_access`.

### 8.2 Cerință → schimbare → test → rezultat

| Cerință (verdict) | Schimbare | Test | Rezultat |
|---|---|---|---|
| §2 invarianții sursei drepturilor legați de aprobare | precondiție `[pre:invarianti]` în migrare (bloc `<invarianti-20261003d>`, liste albe = live 30.09); scheletul local reproduce politicile de scriere + triggerele live (corpurile funcțiilor cu md5 identic cu `prosrc` live) | 7 precondiții negative `INV:` (trigger dezactivat, trigger șters, corp funcție schimbat, politică INSERT pe rândul propriu, politică UPDATE lărgită, RLS oprit pe `user_module_access`, `authenticated BYPASSRLS`); mutantul `PRE_fara_invarianti` | toate refuzate fără urme; mutant prins; amprenta locală = live (drumul fericit trece precondiția) |
| §4 autoatribuire | `t.escaladare` + `t.incercari_autoatribuire` (încercare + citire tokenuri în ACEEAȘI tranzacție) | X1–X8: UPDATE `is_owner` propriu (+ `can_access_personal_data`), INSERT `hr` / `hr.concedii` propriu, UPDATE rând propriu → `hr`, preluarea rândului `hr` al altcuiva, INSERT profil propriu `is_owner=true` (uid fără profil), DELETE profil owner | pe patch: toate refuzate (`P0001` / `42501` / 0 rânduri) și **vede=0**; suita PICĂ pe live (discriminare). Demonstrație: cu triggerele `profiles` oprite, peste patch, contul fără modul devine owner și vede 5/5 → de aceea precondiția |
| §4 revocare în sesiune existentă | — | HR citește; se șterge accesul HR (commit); același JWT (claims identice), tranzacție nouă. La fel pentru owner retrogradat (`is_owner=false`), fără modul HR | 0 rânduri în ambele; contul HR rămâne superadmin + dept HR + date personale → nicio altă ramură |
| §4 limitele grupului | 3 conturi fictive noi: `hr` viewer, `hr.recrutare`, valoarea exactă `'hr.'` | L1–L3, marcate `[DE APROBAT]` și afișate de harness ca „ALEGERI DE APROBAT” | regula actuală (= poarta UI) **le dă acces la toate tokenurile**; e o alegere care intră în aprobarea grupului țintă (§5 pas 2), nu „HR legitim” automat |
| §4 dependențe RLS fără privilegii | — | fără SELECT pe `user_module_access.module` (grant doar pe alte coloane), fără SELECT pe `profiles.is_owner`, fără SELECT pe `user_module_access`, fără EXECUTE pe `auth.uid()` | **refuz sigur** `42501` pentru toți (owner, HR, Ofertare-hr, fără modul), niciodată rânduri, niciun fallback. Efect consemnat: **utilizatorii legitimi pierd și ei butonul** într-o asemenea stare. (USAGE pe schema `auth` NU e o dependență: politica reține OID-ul funcției) |
| §4 token copiat înainte de patch | — | pe live, contul fără modul copiază un token FICTIV (neafișat); patch; listarea → 0; lookup-ul edge (`service_role`, `token + activ + format`) cu copia | **copia trece încă validarea edge** (`employee_id` corect). Limita patch-ului, raportată ca atare, nu cosmetizată; se închide doar prin §6 A |
| §4 rotație (operație separată) | schelet documentat mai jos | — | neimplementat (nu face parte din acest patch) |
| §5 aprobarea grupului țintă = condiție | procedura §5 pas 2 + 2b rescrise | — | — |
| domeniul verdictului | formularea din antet | — | — |
| §3 opțiunea A | §6 (1) A rescrisă (invalidare 117 → reemitere doar eligibili; 12 plecați dezactivați după confirmare; 15 fără token = decizie separată; preview nominal fără tokenuri + verificarea stării neschimbate la apply; eligibilitate/expirare la info ȘI POST) | — | — |

### 8.3 Schelet pentru testul de rotație (se implementează odată cu operația §6 A, nu acum)

Pe un schelet cu edge-ul emulat (lookup `token + activ + format` + verificarea eligibilității/expirării, aceeași funcție pentru `?api=info` și POST):
1. Stare inițială: tokenuri vechi pentru un eligibil E, un plecat P și un rând fără token F; copiile vechi se păstrează în variabile, niciodată afișate.
2. Preview nominal (fără tokenuri) → confirmare → apply cu verificarea stării de referință; o variantă în care starea se schimbă între preview și apply → apply-ul **refuză**, nimic modificat.
3. Aserțiuni: tokenul vechi al lui E și al lui P refuzat la info **și** la POST; tokenul nou al lui E acceptat la ambele; P fără token nou și `activ=false`; F neatins; niciun rând „reemis” pentru P.
4. Mutanți: `UPDATE` pe toate rândurile (P primește token nou → prins), verificarea doar la info (POST cu token vechi → prins), fără verificarea stării de referință (→ prins).
5. Logurile probelor: `RETURNING employee_id`, numărători și md5 de stare; niciun token în clar.

### 8.4 Ce rămâne deschis
- **Aprobarea lui Răzvan pe grupul țintă** (inclusiv L1–L3 și conturile de agent) — condiție de apply.
- Livrarea atomică: doar tiparul (gărzi) e portat (§9); runnerul comun = runda 5 (NO-GO Copilot r4), apoi portare + GO.
- F1 (TRUNCATE pe `profiles`/`user_module_access`), F2 (ocolirea triggerelor fără `auth.uid()`): patch-uri separate, cu acordul lui Răzvan.
- Inventarul căilor `service_role` (edge-uri) care citesc tokenurile sau scriu în sursa drepturilor.
- Rotația (§6 A) și verificarea eligibilității/expirării în edge: operații separate.

## 9. Runda 4 — tiparul de livrare (gărzile), fără runner

Cerința comună (verdictul Copilot r3 pe #538): un singur gestionar de tranzacție care include DDL-ul, postcondiția și înregistrarea în `supabase_migrations.schema_migrations`. **Runnerul comun `scripts/livrare_migrare.sh` (#538, 95be8d4) a primit NO-GO de la Copilot în r4** (`wt-sec-rsvti/docs/LIVRARE_MIGRARE_VERDICT_COPILOT_R4.md`: filtrul de control al tranzacției e ocolibil, fișierul verificat/executat/înregistrat poate diferi, opțiunile psql nu sunt blocate) și se reface în runda 5. De aceea aici **NU e copiat**; s-a portat doar tiparul din fișier. Logica patch-ului e neschimbată. Totul e local; nimic aplicat, nimic pushat.

**a) Fișierul** — `BEGIN;` → garda de livrare de **start**, `COMMIT;` → garda de **final** (după postcondiție); ambele: `current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003d_sec_concediu_tokens:' || txid_current()` ⇒ `RAISE`. Ordinea: marcaj → gardă start → precondiție (+ invarianți) → schimbare → postcondiție → gardă final → înregistrare → COMMIT al runnerului. Verificare statică în harness (pasul 0): fără control de tranzacție, garda de start prima, cea de final ultima, postcondiția înainte.

**b) Harness** (`scripts/test_sec_concediu_tokens.sh`, pașii 2–3): livrarea e **emulată în harness** după tiparul rundei 4 (`psql --single-transaction` cu marcaj + fișier + verificare marcaj/reluare + `INSERT` în `schema_migrations` cu coloanele din producție). E o probă a **fișierului**, nu a runnerului; testele runnerului (filtru, copie aprobată, opțiuni psql) țin de runda 5.

| Test | Rezultat |
|---|---|
| livrare fără eroare | patch + **o** înregistrare (`statements[1]` = fișierul octet cu octet); owner/HR văd exact ce vedeau |
| `1/0` după prima schimbare · în postcondiție · înainte de garda de final | stare inițială, gaura reprodusă, **0 înregistrări** |
| **eroare injectată CHIAR la `INSERT`-ul în `schema_migrations`** (trigger BEFORE INSERT care verifică întâi că patch-ul e instalat în tranzacție) | stare inițială, **0 înregistrări** |
| reluarea după eșecul înregistrării / după succes | permisă (patch + o înregistrare) / refuzată „deja înregistrată”, fără dublare |
| fișierul singur: `psql -f`, `psql -c` (ca `execute_sql`), `--single-transaction` fără marcaj, marcaj de sesiune rămas, `SET` fără txid | refuzat de garda de start, fără urme, 0 înregistrări |
| mutanți pe gardă: fără garda de start, garda fără txid; fără garda de final / `COMMIT` în fișier (static) | prinși |
| `COMMIT;` / `select 1; commit ;` / `END;` la nivel de instrucțiune, rulate prin livrare | eșuate și **neînregistrate, dar prima parte rămâne comisă** → **LIMITĂ OPEN**, NU numărată ca mutant prins (conform verdictului r4); se închide doar prin validatorul runnerului din runda 5, înainte de execuție. Static, `COMMIT`-urile sunt prinse; `END;` nu |

**Rezultat:** `PGPORT=5641 PGBASE=/tmp/pg_conc_r4 bash scripts/test_sec_concediu_tokens.sh`, de 2 ori: **exit 0**, 90 de verificări în harness + 33 în suita patch, **21 de mutanți prinși**.

**Rămâne deschis:** runnerul comun (runda 5) + portarea lui aici + GO Copilot; criteriul general de atomicitate (COMMIT/END accidental) = OPEN; rularea pe PG17 neverificată local (refuzul e fail-closed).
