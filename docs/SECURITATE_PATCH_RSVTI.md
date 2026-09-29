# SEC RSVTI: poarta pe `confirm_hr_autorizatie_rsvti` și pe jurnal (P1 / constatarea (1)), 29.09→03.10.2026

> **NEAPLICAT.** E un patch distinct, doar pentru suprafața RSVTI, așa cum a cerut Copilot. Se aplică doar după GO-ul lui Copilot pe această revizie și după acordul explicit al lui Răzvan (§7). Nu atinge Ofertare, datele, `profiles` sau alte funcții.
> Tot ce am citit din producție a fost read-only, pe 29.09 după 21:30 UTC: cataloage, `pg_policies`, ACL, `pg_stat_statements` (doar rol și număr de apeluri) și două SELECT-uri agregate pe date, care întorc doar numere și departamente. N-am apelat nicio funcție a aplicației.

## 0. Pe scurt
- **Gaura închisă:** orice cont logat putea prelungi viza RSVTI a oricui, cu orice dată, printr-un apel RPC direct (`2099-01-01` ⇒ viză „valabilă” până în 2099). Putea și să scrie direct în jurnal, în numele oricui.
- **Fix-ul are trei părți, tratate împreună:**
  - **Poarta:** e aceeași regulă ca politica de scriere pe `hr_autorizatii`. Sursa e una singură, `fn_poate_scrie_hr_autorizatii()`, deci drepturile nimănui nu se schimbă.
  - **Regula datei:** data confirmării făcute nu poate fi în viitor și nici înainte de emiterea autorizației.
  - **Jurnalul:** INSERT direct e permis doar celor care trec aceeași poartă, și doar în nume propriu. UPDATE și DELETE nu mai sunt permise din API.
- **Teste:** **260 de aserțiuni OK** pe PG16 local, pe ciclul complet (bază → migrare → reaplicare → rollback tehnic → reaplicare). Gaura e reprodusă pe varianta live și din nou după rollback. Cinci mutanți ai patch-ului sunt prinși de teste.
- **Risc de regresie, verificat pe producție:** **0 conturi** au confirmat vize fără să treacă noua poartă. Toate cele 9 rânduri din jurnal sunt de la 2 conturi (HR și Administrativ). Pe fișe, alte 26 de confirmări au `confirmat_de` NULL: vin dintr-un import direct, nu din RPC.
- **Decizie pentru Răzvan:** operatorul RSVTI (Nica Eugen, departamentul Execuție) **nu trece** poarta, nici azi (nu poate scrie `hr_autorizatii`), nici după patch. N-a confirmat nicio viză prin aplicație. Dacă trebuie să confirme el vizele, e nevoie de un drept dedicat, cu decizia ta (A/B). Patch-ul nu-l adaugă.
- **Dependență:** poarta se sprijină pe `department`. Protecția lui (S-A, `trg_profiles_campuri_owner_only`) e **live din 29.09, 20:21 UTC**, verificat: md5 `c06d7ce0…` = cel canonic. Migrarea refuză să ruleze dacă S-A sau celelalte protecții de pe `profiles` nu sunt active (§3).

## 1. Gaura (definițiile live, 29.09)
| Suprafață | Azi | Efect |
|---|---|---|
| `confirm_hr_autorizatie_rsvti(bigint,date,text)` | SECURITY DEFINER, proprietar postgres, EXECUTE pentru `authenticated`, **nicio poartă**, orice `p_data_confirmare` | ocolește RLS pe `hr_autorizatii` (scriere permisă doar grupului HR). Oricine logat scrie `rsvti_ultima/urmatoarea_confirmare` + `rsvti_confirmat_de` pe orice autorizație |
| `hr_autorizatii_rsvti_confirmari`: politica INSERT | `auth.uid() IS NOT NULL` | jurnal falsificabil: orice `confirmat_de`, `employee_id`, dată, scadență |
| același tabel: GRANT | `arwdDxtm` pentru `anon` și `authenticated` | UPDATE/DELETE nu au politici, deci RLS le refuză deja (0 rânduri). GRANT-ul e inutil și periculos dacă apare vreodată o politică |

Nu apare nicio altă cale: nicio altă funcție SQL nu scrie în jurnal sau în `rsvti_*` (verificat în `pg_proc`), niciun job `cron.job` nu atinge RSVTI și niciun edge function din repo nu apelează RPC-ul.

## 2. Ce schimbă (`supabase/migrations/20261003c_sec_rsvti_poarta_jurnal.sql`)
0. **Precondiții (fail-closed).** Migrarea se oprește dacă:
   - politica `hr_autorizatii_write_authorized` nu mai are textul analizat (md5 pe textul cu spațiile normalizate = `cc78b7fd…`) sau nu mai e singura politică de scriere pe `hr_autorizatii`;
   - protecțiile de pe `profiles` (role/is_owner, can_modify_employees, department/S-A) nu sunt toate active;
   - RPC-ul live nu e nici varianta analizată (`527c0e47…`), nici cea din patch (`49a9d3a7…`).
1. **`fn_poate_scrie_hr_autorizatii()`:**
   - LANGUAGE sql, STABLE, SECURITY DEFINER, `search_path = public, pg_temp`;
   - predicat **identic** cu politica: `is_owner` / `can_modify_employees` / `role='superadmin'` / `department IN ('HR','Administrativ')`, pe `auth.uid()`;
   - EXECUTE doar pentru `authenticated` (politica jurnalului îl evaluează ca authenticated) și `service_role`. Nu pentru PUBLIC sau anon;
   - întoarce doar dreptul apelantului.
2. **`confirm_hr_autorizatie_rsvti`**, aceeași semnătură, același tip returnat, aceleași efecte:
   - (a) **poarta**, înaintea oricărei citiri: `auth.uid()` NULL sau fără drept ⇒ `42501`;
   - (b) **data**: `> azi (Europe/Bucharest)` ⇒ `22023`; `< data_emitere` (când e completată) ⇒ `22023`;
   - (c) **scadența** = data + `interval_confirmare_rsvti_luni` al tipului (implicit 6), calculată în funcție;
   - ACL-ul rămâne neschimbat.
3. **Jurnalul:**
   - politica INSERT `…_insert_authenticated` se înlocuiește cu `…_insert_autorizat`: `(SELECT fn_poate_scrie_hr_autorizatii()) AND confirmat_de = (SELECT auth.uid())`;
   - `REVOKE UPDATE, DELETE … FROM anon, authenticated`;
   - `REVOKE INSERT … FROM anon`.

**Ce NU schimbă:**
- politicile de pe `hr_autorizatii` și `hr_autorizatii_tipuri`, deci cine poate scrie autorizații;
- EXECUTE pe RPC (UI-ul îl apelează ca authenticated);
- datele existente;
- TRUNCATE pe jurnal (e în PR-ul separat TRUNCATE/ACL, P14);
- UI-ul (`HR.jsx` e neatins).

## 3. Sursa unică de adevăr și verificarea sursei drepturilor
Copilot a cerut: „o copie a unei politici nu e suficientă fără verificarea sursei drepturilor”. Am verificat trei lucruri.
- **Politica sursă** (live): `hr_autorizatii_write_authorized`, ALL, `{authenticated}`, cu USING = WITH CHECK = predicatul de mai sus. E singura politică de scriere pe `hr_autorizatii`. Aceeași expresie (md5 `f2a295ca…`) e și pe `hr_autorizatii_tipuri_write_authorized`. Nu folosește nicio funcție helper, doar coloane din `profiles`.
- **Coloanele din care vine dreptul nu se pot autoatribui** (triggerele live, cu corpurile copiate byte cu byte în schelet):

| Coloană | Protecție live | Test |
|---|---|---|
| `is_owner`, `role` | `prevent_role_escalation_trigger` (RAISE pentru non-owner) | P3 |
| `can_modify_employees` | `trg_enforce_owner_only_salary_flags` (resetare tăcută) | P3: UPDATE acceptat, flag rămas false, poarta închisă |
| `department` | `trg_profiles_campuri_owner_only` (S-A, 42501) | P3: HR și Administrativ refuzate |
| rând nou în `profiles` | `profiles_insert_owner`; `handle_new_user` creează cu `manager_santier`, fără departament | (acoperit de S-A) |

- **Echivalența comportamentală (P2):** pentru 9 identități, helperul dă același răspuns ca politica live, adică dacă identitatea poate scrie efectiv în `hr_autorizatii` și în `hr_autorizatii_tipuri`. Identitățile: owner, can_modify, superadmin, HR, Administrativ, Execuție, `role='hr'` fără departament, JWT fără profil, authenticated fără claims.

**Identitatea (modelul S-A):** decizia se ia pe identitate explicită, adică `sub`-ul JWT rezolvat la un profil cu drept. Nu există nicio cale „sistem”.

| Apelant | Rezultat |
|---|---|
| authenticated + sub cu drept | trece |
| authenticated + sub fără drept / fără profil / fără claims | 42501 |
| `service_role` (JWT fără sub) | 42501 (nu există niciun apelant backend: 0 edge-uri în repo, 0 cron, 0 funcții; `pg_stat_statements` de la 07.08: doar `authenticated` a apelat RPC-ul) |
| login postgres fără claims (MCP, SQL editor) | 42501 |
| anon | fără EXECUTE |

## 4. Regula datei: ce înseamnă `p_data_confirmare` (din cod)
- **UI, crearea autorizației** (`HR.jsx` ~L1837, L1900-1908): câmpul „**Data ultimei vize** (opțional)” trimite `p_data_confirmare = vizaInitiala`. E o viză deja făcută.
- **UI, editare** (`HR.jsx` ~L2081-2118): butonul „Confirmă viza” cere „Alege data confirmării vizei”, cu implicit `new Date().toISOString()`, adică ziua **UTC**.
- **Funcția** calculează scadența: `data + interval luni` (live: `v_next := (coalesce(p_data_confirmare, current_date) + make_interval(...))`). UI-ul doar o previzualizează (`setMonth`). Apelantul n-o trimite.
- **Concluzie:** `p_data_confirmare` = **data confirmării efectuate** și nu e scadența. De aici:
  - nu poate fi în viitor;
  - nu poate fi înainte de `data_emitere`;
  - scadența rămâne calculată în funcție.
- **„Azi” se ia în `Europe/Bucharest`.** Producția e în UTC, iar PostgREST acceptă `Prefer: timezone`. Între 00:00 și 03:00, ora României, ziua UTC e încă ieri, așa că o limită UTC ar refuza o confirmare legitimă „de azi”. Data implicită din UI (ziua UTC) e mereu ≤ ziua din București. Testele au rulat chiar într-o astfel de fereastră (UTC 29.09, București 30.09).
- **Neschimbat:**
  - `NULL` explicit ⇒ `current_date`, exact ca înainte (UI-ul trimite mereu data);
  - `DEFAULT CURRENT_DATE` rămâne în semnătură.
- Previzualizarea din UI (`setMonth`) și calculul SQL (`make_interval`) diferă la sfârșit de lună: 31.08 + 6 luni dă 03.03 în JS și 28.02 în SQL. Valoarea salvată e cea din SQL (P8). Diferența e preexistentă și e doar de afișare.

## 5. Teste
- **Fișiere:**
  - `supabase/tests/sec_rsvti_schelet.sql` (schelet);
  - `supabase/tests/sec_rsvti.test.sql` (teste, `-v gaura=true|false`);
  - `scripts/test_sec_rsvti.sh` (harness).
- **Rulare:** `bash scripts/test_sec_rsvti.sh [--opreste]`, pe PG16 local, `PGDATA=/tmp/pg_sec_rsvti`, `127.0.0.1:5442`, baza `sec_rsvti_test`.
- **Fidelitatea scheletului e verificată la încărcare:**
  - md5(prosrc) identic cu producția pentru RPC-ul live și pentru cele 4 triggere de pe `profiles`;
  - ACL-urile RPC-ului și ale celor 3 tabele sunt identice. Excepție: „m” (MAINTAIN) există doar în PG17;
  - md5 pe textul politicilor (deparse PG16 = PG17).

| Pas | Mod | Aserțiuni |
|---|---|---|
| 0 | schelet = producția de azi: **gaura reprodusă** | 16 OK |
| 1 | după migrare | 76 OK |
| 2 | după reaplicare (idempotență) | 76 OK |
| 3 | rollback tehnic: `pg_dump --schema-only` **identic** cu pasul 0; **gaura redeschisă** | 16 OK |
| 4 | reaplicare: gaura închisă | 76 OK |
| | **Total** | **260 OK, PASS** |

| Grup | Ce dovedește |
|---|---|
| G1–G6 (gaura) | RPC = live (md5 `527c0e47…`); non-HR prin RPC → viză până la **2099-07-01**, deși direct în `hr_autorizatii` nu poate scrie (RLS); cont fără profil confirmă; jurnal falsificat în numele owner-ului, alt angajat, dată 2098; **UPDATE/DELETE pe jurnal = 0 rânduri deja azi** (dovada că REVOKE-ul nu schimbă comportamentul); anon INSERT deja refuzat de RLS; anon fără EXECUTE |
| P1 | helper și RPC: SECURITY DEFINER, `search_path`, proprietar, ACL (fără PUBLIC/anon), semnătura neschimbată și fără parametru de scadență, poarta înaintea oricărei citiri, amprenta corpului; politica veche a dispărut, cea nouă e helper + atribuire; GRANT-uri retrase; politicile HR neatinse |
| P2 | helper ≡ politica live, pe matricea de 9 identități |
| P3 | sursa drepturilor nu se autoatribuie (department HR/Administrativ, role, is_owner refuzate; can_modify_employees resetat) |
| P4 | refuz 42501: non-HR (dată validă și atacul 2099), id inexistent (fără oracol), `role=hr` fără departament, JWT fără profil, authenticated fără claims, service_role, postgres fără claims; anon fără EXECUTE pe RPC și pe helper; jurnal și fișă neschimbate |
| P5 | jurnal: non-HR (în nume propriu sau al owner-ului), HR în numele altcuiva, HR anonim → refuz RLS; HR în nume propriu trece (dreptul păstrat); UPDATE/DELETE (HR și owner prin API) → fără GRANT; anon → fără GRANT |
| P6 | **traseele legitime:** owner, can_modify, superadmin, HR (observații tăiate), Administrativ azi (butonul „Confirmă viza”), data implicită din UI (ziua UTC), fluxul „Adaugă autorizație” (INSERT ca HR + viza inițială); dreptul retras de owner ⇒ 42501 imediat |
| P7 | mâine / 2099 → 22023 (și pentru HR); cu o zi înainte de `data_emitere` → 22023; exact `data_emitere` trece; fișă fără `data_emitere` → fără limită inferioară; sesiune în UTC+14: limita rămâne „azi București”; `NULL` → `current_date`; erorile vechi (tip fără viză, autorizație ștearsă) neschimbate; refuzurile nu scriu nimic |
| P8 | scadența: 31.08 + 6 luni = 28.02; tip cu 12 luni; interval necompletat = 6; al 4-lea argument sau `p_urmatoarea_confirmare` numit → 42883; toate cele 15 rânduri respectă data + interval; niciun rând în viitor |

**Controale negative** (rulate manual pe aceeași bază):

| Variantă testată | Ce o prinde |
|---|---|
| teste PATCH fără migrare | eșec (helperul lipsește) |
| mutant A, fără poartă | P1 (poziția porții); comportamental: **P4** |
| mutant B, fără limita „viitor” | **P7** |
| mutant C, politica fără atribuire | **P5** |
| mutant D, fără limita `data_emitere` | **P7** |
| mutant E, helper cu `role='hr'` în plus | **P2** (echivalența cu politica) |

În plus, reaplicarea peste un RPC necunoscut e **refuzată de precondiția 0d**, adică fail-closed.

Limită: validarea dinamică e doar locală. Pe producție, după apply, verificarea e read-only (§7). Atacul nu se încearcă pe date reale.

## 6. Revenirea
- **`…_ROLLBACK.sql` = rollback TEHNIC.**
  - Readuce exact starea de azi: RPC-ul live verbatim, politica veche, GRANT-urile, fără helper.
  - Deci **redeschide gaura**. În producție se rulează doar la cererea explicită a lui Răzvan, cu motivul consemnat.
  - Harness-ul dovedește că desfacerea e curată (`pg_dump` identic).
- **Revenirea operațională păstrează poarta:**
  1. **Utilizator legitim refuzat** (`42501 Nu ai dreptul să confirmi viza RSVTI…`): dreptul se dă prin mecanismul existent (department HR/Administrativ sau `can_modify_employees`, setate de owner), **cu acordul lui Răzvan** (CLAUDE.md pct. 3). Dacă e nevoie de un drept doar pentru vize (de ex. operatorul RSVTI), trebuie un flag dedicat + o migrare nouă revizuită.
  2. **Dată legitimă refuzată** (`22023`):
     - o dată în viitor e o greșeală de introducere;
     - o dată înainte de emitere înseamnă că `data_emitere` din fișă e greșită (poate fi completată și de scannerul AI, `hr-autorizatii-scan`). Se corectează fișa din „Editează”, apoi se confirmă viza.
  3. **Funcția e defectă:** se face `CREATE OR REPLACE` cu corecția, revizuit (GO Copilot). Nu se revine niciodată la varianta fără poartă.

## 7. Apply: preview → confirmare → apply → verificare
Condiții: GO Copilot pe această revizie (îi trimit diff-ul efectiv și rezultatul testelor) și **acordul explicit al lui Răzvan**. Patch-ul nu e pe Ofertare, dar se aplică tot numai cu acordul lui.

**Pasul 1: preview read-only, imediat înainte.** Se aplică numai dacă toate valorile ies ca mai jos.
```sql
-- (a) amprentele pe care se bazează patch-ul (așteptat: 527c0e47…, {postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}, cc78b7fd… ×2, dc71e447…, 3 triggere active)
SELECT md5(prosrc), proacl::text FROM pg_proc WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure;
SELECT policyname, md5(regexp_replace(qual,'\s+',' ','g')) q, md5(regexp_replace(with_check,'\s+',' ','g')) w
  FROM pg_policies WHERE schemaname='public' AND tablename='hr_autorizatii' AND cmd IN ('ALL','INSERT','UPDATE','DELETE');
SELECT policyname, md5(coalesce(with_check,'')) FROM pg_policies WHERE schemaname='public' AND tablename='hr_autorizatii_rsvti_confirmari';
SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND NOT tgisinternal ORDER BY 1;
-- (b) riscul de regresie (doar număr + departament). Așteptat: nicio linie cu trece_poarta=false în afară de „(confirmat_de NULL)”.
WITH conf AS (SELECT confirmat_de uid, 'jurnal' sursa FROM public.hr_autorizatii_rsvti_confirmari
              UNION ALL SELECT rsvti_confirmat_de, 'fisa' FROM public.hr_autorizatii WHERE rsvti_confirmat_de IS NOT NULL OR rsvti_ultima_confirmare IS NOT NULL),
     per AS (SELECT uid, count(*) FILTER (WHERE sursa='jurnal') nj, count(*) FILTER (WHERE sursa='fisa') nf FROM conf GROUP BY uid)
SELECT CASE WHEN u.uid IS NULL THEN '(confirmat_de NULL)' WHEN p.id IS NULL THEN '(fără profil)' ELSE coalesce(p.department,'(fără departament)') END departament,
       (u.uid IS NOT NULL AND p.id IS NOT NULL AND (p.is_owner OR p.can_modify_employees OR p.role='superadmin' OR p.department IN ('HR','Administrativ'))) trece_poarta,
       count(*) conturi, sum(nj) randuri_jurnal, sum(nf) fise
  FROM per u LEFT JOIN public.profiles p ON p.id = u.uid GROUP BY 1,2 ORDER BY 2,1;
-- (c) cine a apelat RPC-ul (așteptat: doar authenticated)
SELECT userid::regrole, sum(calls) FROM extensions.pg_stat_statements WHERE query ILIKE '%confirm_hr_autorizatie_rsvti%' GROUP BY 1;
```
Rezultatele din 29.09, ~21:40 UTC:
- (a): toate conforme.
- (b): HR, 1 cont, 6 rânduri în jurnal, 2 fișe, trece; Administrativ, 1 cont, 3 rânduri, 3 fișe, trece; `(confirmat_de NULL)`, 0 rânduri în jurnal, 26 de fișe (import, nu RPC).
- (c): `authenticated`, 1 apel de la resetarea din 07.08.
- Alte cifre:
  - poarta o trec azi 10 din 31 de profile: 2 owneri; non-owneri: 6 can_modify, 6 superadmin, 1 HR, 4 Administrativ (categoriile se suprapun);
  - `role='hr'` fără poartă: 0;
  - rânduri din jurnal cu dată în viitor la creare: 0; înainte de emitere: 0; cu scadența diferită de calcul: 0; cu angajat nepotrivit: 0;
  - rânduri pe fișe fără `data_emitere`: 2;
  - autorizații de externi cu viză: 0.

**Pasul 2: confirmarea explicită a lui Răzvan**, pe exact acest fișier: sha256 `ea6d2c3a…fdae54`, 214 linii.

**Pasul 3:** un singur `apply_migration`, cu numele `sec_rsvti_poarta_jurnal` și conținutul exact al fișierului. Fără alte migrări, fără DML. Dacă o precondiție pică, nu se aplică nimic: tranzacția se anulează și se reanalizează.

**Pasul 4: verificare read-only după apply.**
- RPC:
  - `md5(prosrc)` = `49a9d3a7fb8f30d9cb043db25f97f57f`;
  - ACL = `{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}`;
  - `pg_get_function_arguments` neschimbat.
- Helper:
  - `md5(prosrc)` = `a59aeb46d5007222067276184a63aaa0`;
  - ACL = `{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}`;
  - `prosecdef`, `proconfig` = `search_path=public, pg_temp`.
- Jurnalul:
  - politicile sunt exact `…_insert_autorizat` (INSERT, `{authenticated}`, `with_check` conține `fn_poate_scrie_hr_autorizatii` și `confirmat_de`) și `…_select_authenticated`;
  - `relacl` = `{postgres=arwdDxtm/postgres,anon=rDxtm/postgres,authenticated=arDxtm/postgres,service_role=arwdDxtm/postgres}`.
- `hr_autorizatii_write_authorized` e neschimbată (preview a).
- `get_advisors`, doar ca diagnostic. Așteptat: `fn_poate_scrie_hr_autorizatii` apare în lint 0029. E doar citire și întoarce doar dreptul apelantului, ca `fn_are_acces_ofertare`. RPC-ul rămâne în 0029, pentru că trebuie apelat de UI, dar acum are poartă.
- Funcțional: la prima confirmare reală făcută de HR, un SELECT read-only pe ultimul rând din jurnal (`confirmat_de` = contul HR, data ≤ azi). Pe producție nu se face nicio probă de atac.

**Pasul 5:** rând nou în jurnalul Copilot (`COPILOT_HANDOFF.md` + `handoff_copilot`) și în `handoff_activ`.

## 8. Riscul de regresie și ce rămâne deschis
**Regresie (utilizatori legitimi):**
- **0 conturi afectate** pe istoricul real (§7 b).
- UI-ul trimite mereu o dată ≤ azi: implicit ziua UTC, altfel aleasă de om. Singurul refuz nou pentru HR e o dată în viitor sau înainte de emitere. Pe istoric: 0 cazuri.
- **Posibil refuz legitim:** `data_emitere` completată greșit, inclusiv de scannerul AI (`hr-autorizatii-scan` o completează doar unde lipsea). Mesajul spune exact ce e de corectat (§6.2).
- Operatorul RSVTI (Execuție) nu poate confirma. N-a făcut-o niciodată în aplicație (0 rânduri) → decizia lui Răzvan.
- Un eventual apelant backend cu `service_role` ar fi refuzat. Nu am găsit niciunul: repo, `cron.job`, `pg_proc`, `pg_stat_statements` (cu limitele de la §10).

**Rămâne deschis** (nu e în mandatul acestui patch; fiecare punct cere decizie separată):
1. Grupul HR poate scrie în continuare **direct** `rsvti_*` în `hr_autorizatii` (politica ALL), fără regula datei. E dreptul lor de azi. Închiderea ar fi un trigger care permite `rsvti_*` doar prin RPC. Nu există scrieri directe în cod: `HR.jsx`, `HrPersonalExtern.jsx`, `TabDocumentePersonale.jsx`, `AdeverinteLegator.jsx` și edge-ul `hr-autorizatii-scan` nu trimit `rsvti_*`. Ar fi fără regresie, dar schimbă drepturile HR, deci e propunere (P1b).
2. HR poate insera direct în jurnal, **în nume propriu**, cu dată și scadență alese de el. Nu schimbă fișa și nici statusul (`v_hr_autorizatii_status` citește doar din `hr_autorizatii`), iar indicatorul „dată în viitor” l-ar vedea. Varianta mai strictă e **REVOKE INSERT de la authenticated**, adică jurnalul scris doar prin RPC. În repo nu există INSERT direct, dar absența la grep nu dovedește nefolosirea → decizia ta.
3. `hr_autorizatii_tipuri.interval_confirmare_rsvti_luni` e editabil de grupul HR (azi 6 la toate cele 3 tipuri cu viză). Un interval absurd ar întinde scadențele. E dreptul lor de azi; o limită (de ex. 1–24 de luni) ar fi o decizie separată.
4. TRUNCATE pe jurnal pentru `anon`/`authenticated` rămâne. E în PR-ul separat TRUNCATE/ACL (P14). Nu se poate atinge prin PostgREST.
5. Un defect latent, preexistent: pe o autorizație de extern (`employee_id` NULL), RPC-ul ar pica pe NOT NULL în jurnal. Azi nu există autorizații de externi cu viză (0).

## 9. Fișa (CLAUDE.md pct. 7)
Nu e o automatizare nouă: nu e edge function, cron, trigger sau webhook. Nu intră în `registru_automatizari`. Fișa e pentru calea de scriere privilegiată:
- (a) **Conținut extern citit:** niciunul. `p_observatii` e text liber, doar salvat. `data_emitere` poate veni indirect din scannerul AI și e folosită doar ca limită inferioară (poate doar refuza).
- (b) **Ce scrie:** un rând în jurnal și 5 coloane `rsvti_*` + `modificat_la` pe o autorizație. Nu trimite mail, nu atinge bani sau drepturi.
- (c) **Identitate:** SECURITY DEFINER (postgres), ca să scrie `hr_autorizatii` și jurnalul pentru UI. Ocolirea RLS e acum condiționată de **exact** predicatul RLS pe care îl ocolește.
- (d) **Cine o pornește:** doar `authenticated`, cu poartă de **rol în cod** (nu doar JWT valid: cheia anon n-are EXECUTE, iar authenticated fără drept ia 42501).
- (e) **Confirmare umană:** acțiunea e ea însăși confirmarea făcută de un om din HR (butonul din UI). Nimic automat.

## 10. Ce n-am putut verifica
- **Edge functions live:** am verificat doar codul din repo. N-am citit sursele deployate. Chiar dacă ar exista un apelant nelistat, cu `service_role` ar fi refuzat (42501), deci fail-closed.
- **`pg_stat_statements`:** acoperă doar perioada de la 07.08.2026 și a avut 46 de evacuări de intrări. Deci „doar authenticated” e un indiciu, nu o dovadă.
- **Scripturi externe** (tura de noapte, NAS, Apps Script) care ar scrie direct în jurnal cu un JWT de utilizator. N-am găsit niciunul în repo. Unul care scrie în nume propriu, cu un cont din grupul HR, ar trece. Unul care scrie în numele altcuiva sau cu un cont fără drept ar fi refuzat, și exact asta e scopul.
- **Validarea e pe PG16 local:** producția e PG17.6. Fidelitatea e verificată pe corpuri, ACL (fără „m”) și textul politicilor. Diferențele de planificare dintre versiuni nu afectează predicatele.
- **Ce semnifică viza în regulament** (cine are voie legal să confirme, RTS sau RSVTI) nu reiese din cod. Regula de drept e cea din politica existentă, neschimbată.
