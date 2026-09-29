# Patch de securitate 20261003d — tokenurile de concediu (`hr_concediu_tokens`)

> **Stare: DOAR PREGĂTIRE, NEAPLICAT.** Copilot a dat „GO DOAR PREGĂTIRE” pe acest domeniu, separat de trezorerie (verdictul pe matrice, 30.09). Aplicarea cere **GO-ul lui Copilot pe revizia finală + acordul lui Răzvan**. Nimic nu s-a scris în producție: investigația a folosit doar SELECT pe cataloage și numărători agregate. **Nu s-a citit și nu apare aici nicio valoare de token, telefon sau IBAN.** Tokenurile din teste sunt fictive.

Fișiere:
- `supabase/migrations/20261003d_sec_concediu_tokens.sql` — migrarea (BEGIN/COMMIT în fișier)
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
2. **Precondiție fail-closed.** Face o amprentă text completă pe trei componente: tabel (kind, RLS, FORCE, owner, moșteniri, ACL pe coloane), politici (nume, comandă, permisiv, roluri, md5 pe `qual`/`with_check`, cu `NULL` → `'<NULL>'`) și privilegii efective pentru `anon`, `authenticated`, `public` și `service_role` (`has_table_privilege`, deci inclusiv PUBLIC și moștenirea; `has_any_column_privilege` pentru granturile pe coloane; `… WITH GRANT OPTION`). Comparațiile sunt `IS [NOT] DISTINCT FROM`. Acceptă doar **perechi complete**: live (politică live + ACL live) sau patch (reaplicare, fără efect net). Refuză orice stare mixtă sau necunoscută. Verifică și dependențele politicii (`profiles.id/is_owner`, `user_module_access.profile_id/module`, cu tipuri).
3. Schimbarea: `DROP POLICY hr_tokens_sel` → `CREATE POLICY hr_tokens_sel_modul_hr … FOR SELECT TO authenticated USING (owner OR modul hr/hr.*)` → `REVOKE ALL … FROM PUBLIC, anon, authenticated` → `GRANT SELECT … TO authenticated`. `service_role` rămâne neatins.
4. **Postcondiție înainte de `COMMIT`**: aceeași amprentă trebuie să fie exact ținta, altfel se anulează tot.
5. `COMMIT;`. Fișierul nu are meta-comenzi psql, deci merge și ca un singur simple query.

Amprenta de producție a fost recalculată read-only cu **aceeași interogare** și e identică cu starea live din fișier (PG17 adaugă doar `MAINTAIN`, tratat prin versiune). md5-ul politicii noi (`ab5d2578…`) e **identic pe PG16 (local) și PG18 (PGlite 0.5.8)**. Pe PG17 n-a fost rulat. Dacă diferă acolo, postcondiția anulează atomic migrarea. În cazul ăsta se compară definițiile și se revizuiește lista albă după review, nu se adaugă automat hash-ul găsit.

## 4. Testele și rezultatele

`bash scripts/test_sec_concediu_tokens.sh` rulează pe un cluster PG16 **dedicat** (port 5483, `/tmp/pg_sec_concediu`, `autovacuum=off`) și refuză dacă pe port răspunde alt cluster. Rulat de 2 ori complet: **exit 0 de fiecare dată**, cu **73 de verificări în harness** și suita de comportament de **33 de verificări**, rulată în fiecare scenariu. **18 mutanți prinși.**

- **Starea de azi reprodusă și demonstrată**: amprenta locală = producția. Suita „gaura” (8) trece pe live. Suita patch **pică pe live**, iar 12/12 verificări-cheie pică izolat.
- **Comportament după patch** (suita, 33): edge-ul cu `service_role` validează tokenul, poate revoca (UPDATE `activ`) și reemite (INSERT), cu scrierile anulate în test. Owner, HR, cont Ofertare cu modul `hr` și sub-modul `hr.concedii` văd **exact aceleași rânduri ca azi** (număr + md5). Conturile fără modul, cu alte module, cu capcane de prefix (`HR`, `hrana`, `hr_extern`, `xhr.`, `' hr'`), departament HR fără modul, superadmin fără modul, `can_access_personal_data` fără modul, uid fără profil și JWT fără `sub` văd 0 rânduri, pe un tabel cu 5 rânduri (control pozitiv). `anon` primește refuz de privilegiu la SELECT, TRUNCATE și INSERT. Nimeni logat, nici HR, nici ownerul, nu poate scrie sau face TRUNCATE. PUBLIC/coloane/GRANT OPTION sunt goale. Robustețe: HR vede în continuare și dacă `profiles`/`user_module_access` ar fi restrânse la rândul propriu.
- **3 emulări de runner** (drum fericit, înregistrare): `psql -v ON_ERROR_STOP=1 -f`; un singur simple query `psql -c "$(cat f)"`; runner cu tranzacție proprie `BEGIN; <fișier> INSERT INTO supabase_migrations.schema_migrations …; COMMIT;` într-un string, pe o tabelă locală creată doar pentru emulare.
- **Eroare injectată** (`SELECT 1/0` după prima schimbare, `PERFORM 1/0` în postcondiție, `SELECT 1/0` înainte de `COMMIT`) × 4 emulări: e1s, **e1n = `psql -f` fără ON_ERROR_STOP**, e2, e3. **În toate 12 cazurile starea rămâne inițială și migrarea nu e înregistrată.** Mutantul fără `BEGIN/COMMIT` e prins în e1n, unde prima schimbare rămâne. ⚠️ `psql -f` fără `ON_ERROR_STOP` întoarce cod 0 la eroare SQL. Starea rămâne corectă, dar un runner care înregistrează după codul de ieșire ar înregistra greșit. De aceea se aplică doar cu `ON_ERROR_STOP=1` sau prin `apply_migration`.
- **Precondiții negative (16), toate refuzate fără urme**: politică live fără USING (qual NULL), cu `USING (true)`, pe roluri `public`, RESTRICTIVE; politică permisivă în plus; politică de scriere în plus; RLS dezactivat; FORCE; owner schimbat; grant pe coloană; ACL mixt; PUBLIC cu SELECT; anon care moștenește SELECT printr-un alt rol; politică patch + ACL live; politică live + ACL patch; dependență lipsă.
- **Revenirea**: e refuzată când nu e armată, când e armată cu valoare greșită sau fără txid, cu **setare de sesiune rămasă**, cu **armare + eroare + reluare fără armare nouă**, cu armare + revenire eșuată + reluare, și când pornește din live. **Armarea persistentă** e refuzată în trei forme: `ALTER DATABASE SET`, `ALTER ROLE SET` cu nume cu majuscule și o armare persistentă care **nimerește exact txid-ul viitor**. Ultima dovedește că verificarea `pg_db_role_setting` e necesară separat de legarea de txid. Eroarea injectată în revenire lasă patch-ul intact. Revenirea armată corect aduce **exact** starea live (amprentă + gaura reprodusă) și dezarmează comutatorul și în sesiune. Reaplicarea după revenire funcționează.
- **Mutanți (18), toți prinși.** Pe patch: fără DROP al politicii vechi, `USING(true)`, fără ramura owner, fără `hr.*`, prefix larg `LIKE 'hr%'`, orice uid, `TO public`, `FOR ALL`, anon păstrat, authenticated păstrat, fără `GRANT SELECT`. Fiecare e anulat de postcondiție (stare live, neînregistrat) și, cu postcondiția scoasă, **9 din 11** sunt prinși și de comportament. `TO public` și `FOR ALL` sunt declarat echivalente comportamental: le acoperă REVOKE-ul și le prinde doar postcondiția. Pe precondiție (2): „acceptă orice stare”, „fără verificarea tabelului”. Mutantul fără BEGIN/COMMIT. Pe revenire (4): fără verificare persistentă, fără legarea de txid, fără verificarea stării de pornire, fără dezarmare.

## 5. Procedura de aplicare (după GO Copilot + acordul lui Răzvan)

1. **Preview read-only**: rulezi interogarea de amprentă (blocul `<amprenta-20261003d>`) și o compari cu starea live din fișier. Numeri conturile care văd linkurile (owner + modul `hr`/`hr.*`), fără valori de tokenuri.
2. **Confirmarea lui Răzvan** pe preview și pe deciziile din §6. Deciziile nu sunt condiție pentru patch.
3. **Apply** cu `apply_migration` (nume `sec_concediu_tokens`) cu textul integral al fișierului, sau cu `psql -v ON_ERROR_STOP=1 -f`. Nu se lipesc bucăți.
4. **Verificare**: amprenta = ținta. Contul de test fără modul (`test.fara.modul@…`) citește 0 rânduri prin REST. Natalia apasă „🔗 Link mobil” și primește linkul. Un link `/co` existent se deschide în continuare. Nimic nu se actualizează automat în listele albe: orice diferență de amprentă se analizează.

Revenirea nu are GO de execuție. Se folosește doar la cererea explicită a lui Răzvan + review specific, în forma din antetul fișierului.

## 6. DECIZIILE lui Răzvan (separat de patch)

**(1) Revocarea/reemiterea celor 117 tokenuri expuse.** Restrângerea SELECT **nu invalidează** o copie obținută anterior: cine a listat tokenurile până acum le poate folosi în continuare pe `/co`. Opțiuni:
- **A — reemitere pentru toți** (recomandat dacă se vrea închiderea expunerii). Operațional: fiecare link trimis pe WhatsApp încetează să mai meargă, iar HR (Natalia) trebuie să retrimită 105 linkuri noi angajaților activi, din butonul „🔗 Link mobil”. Tehnic se face cu `service_role`, în pattern-ul preview → confirmare → apply: `SELECT count(*)` pe ce se schimbă; apoi `UPDATE hr_concediu_tokens SET token = replace(gen_random_uuid()::text,'-','') WHERE … RETURNING employee_id`, fără afișarea tokenurilor; apoi verificare cu numărători.
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
