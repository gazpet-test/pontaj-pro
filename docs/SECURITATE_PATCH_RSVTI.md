# SEC RSVTI: poarta pe `confirm_hr_autorizatie_rsvti` și pe jurnal (P1 / constatarea (1)), 29.09→03.10.2026

> **NEAPLICAT.** E un patch distinct, doar pentru suprafața RSVTI, așa cum a cerut Copilot. Se aplică doar după GO-ul lui Copilot pe această revizie și după acordul explicit al lui Răzvan (§7). Nu atinge Ofertare, datele, `profiles` sau alte funcții.
> **Revizia 2 (30.09):** conține corecturile verificatorului adversarial (verdict CU_CORECȚII, poarta rezistă). Tabelul constatare → schimbare → test e la **§11**.
> Tot ce am citit din producție a fost read-only: pe 29.09 după 21:30 UTC (runda 1: cataloage, `pg_policies`, ACL, `pg_stat_statements` doar rol și număr de apeluri, două SELECT-uri agregate care întorc doar numere și departamente) și pe 29.09 ~22:20 UTC (runda 2: **doar cataloage**: `pg_trigger`, `pg_proc`, `pg_policies`, `pg_class`, `pg_constraint`). N-am apelat nicio funcție a aplicației.

## 0. Pe scurt
- **Gaura închisă:** orice cont logat putea prelungi viza RSVTI a oricui, cu orice dată, printr-un apel RPC direct (`2099-01-01` ⇒ viză „valabilă” până în 2099; `infinity` ⇒ viză care nu mai expiră; `-infinity` sau o dată î.Hr. ⇒ gunoi pe fișă). Putea și să scrie direct în jurnal, în numele oricui.
- **Fix-ul are trei părți, tratate împreună:**
  - **Poarta:** aceeași regulă ca politica de scriere pe `hr_autorizatii`, printr-o singură funcție, `fn_poate_scrie_hr_autorizatii()`. E sursa unică a **porții RSVTI** (RPC + INSERT direct în jurnal), nu a tuturor scrierilor în `hr_autorizatii`: `fn_hr_autorizatie_propunere_accepta` are poarta ei (§3). Drepturile nimănui nu se schimbă.
  - **Regula datei:** data confirmării **efectuate** e o zi reală (finită, ≥ 2000-01-01), nu e în viitor (azi în `Europe/Bucharest`) și nu precede emiterea autorizației. `NULL` înseamnă azi în București. Scadența rămâne calculată în funcție, separat (§4.1).
  - **Jurnalul:** INSERT direct e permis doar celor care trec aceeași poartă, și doar în nume propriu. UPDATE și DELETE nu mai sunt permise din API.
- **Precondiții fail-closed (runda 2):** migrarea refuză dacă pe jurnal nu e **exact o** politică de scriere (cea de azi sau, la reaplicare, cea din patch) sau RLS e oprit, dacă pe `profiles` nu sunt **exact cele 4 triggere** analizate (cu md5) sau dacă RPC-ul live e altul. La final, o postcondiție verifică starea rezultată. Rollback-ul tehnic e **armat** (`SET LOCAL` propriu) și refuză orice stare care nu e exact patch-ul.
- **Teste:** **358 de aserțiuni OK + 26 de verificări negative** pe PG16 local, pe ciclul complet (bază → refuzuri → migrare → reaplicare → refuzuri → rollback tehnic armat → reaplicare). Gaura e reprodusă pe varianta live și din nou după rollback. **14/14 mutanți** ai migrării sunt prinși de teste, **8/8 mutanți** ai precondițiilor/rollback-ului sunt prinși de harness. Testul de fus orar e determinist: verificat și cu ceas simulat, la 4 ore diferite (§5).
- **Risc de regresie, verificat pe producție:** **0 conturi** au confirmat vize fără să treacă noua poartă. Toate cele 9 rânduri din jurnal sunt de la 2 conturi (HR și Administrativ). Pe fișe, alte 26 de confirmări au `confirmat_de` NULL: vin dintr-un import direct, nu din RPC.
- **Decizii pentru Răzvan** (niciuna nu e în patch; detalii la §8):
  1. Operatorul RSVTI (Nica Eugen, departamentul Execuție) **nu trece** poarta, nici azi, nici după patch. Dacă trebuie să confirme el vizele, e nevoie de un drept dedicat (A/B).
  2. INSERT direct în jurnal de către HR: **recomand REVOKE INSERT de la `authenticated`** (jurnal scris doar de RPC).
  3. P1b: grupul HR poate scrie direct `rsvti_*` pe fișă, inclusiv cu atribuire falsă, fără rând în jurnal.
  4. Jurnalul nu e doar-adăugare: ștergerea fizică a fișei îi șterge istoricul (CASCADE).
  5. O confirmare retroactivă suprascrie fișa cu o scadență mai veche (preexistent).
- **Dependență:** poarta se sprijină pe `department`. Protecția lui (S-A, `trg_profiles_campuri_owner_only`) e **live din 29.09, 20:21 UTC**, verificat: md5 `c06d7ce0…` = cel canonic. Precondiția 0c cere setul exact de 4 triggere de pe `profiles` (§3).

## 1. Gaura (definițiile live, 29.09)
| Suprafață | Azi | Efect |
|---|---|---|
| `confirm_hr_autorizatie_rsvti(bigint,date,text)` | SECURITY DEFINER, proprietar postgres, EXECUTE pentru `authenticated`, **nicio poartă**, orice `p_data_confirmare` | ocolește RLS pe `hr_autorizatii` (scriere permisă doar grupului HR). Oricine logat scrie `rsvti_ultima/urmatoarea_confirmare` + `rsvti_confirmat_de` pe orice autorizație, cu orice dată: 2099, `infinity`, `-infinity` (G2, G7; K4 la verificator) |
| `hr_autorizatii_rsvti_confirmari`: politica INSERT | `auth.uid() IS NOT NULL` | jurnal falsificabil: orice `confirmat_de`, `employee_id`, dată, scadență |
| același tabel: GRANT | `arwdDxtm` pentru `anon` și `authenticated` | UPDATE/DELETE nu au politici, deci RLS le refuză deja (0 rânduri). GRANT-ul e inutil și periculos dacă apare vreodată o politică |

Nu apare nicio altă cale: nicio altă funcție SQL nu scrie în jurnal sau în `rsvti_*` (verificat în `pg_proc`; singurele funcții care scriu în `hr_autorizatii` sunt RPC-ul și `fn_hr_autorizatie_propunere_accepta`, care nu atinge `rsvti_*`), niciun job `cron.job` nu atinge RSVTI și niciun edge function din repo nu apelează RPC-ul.

## 2. Ce schimbă (`supabase/migrations/20261003c_sec_rsvti_poarta_jurnal.sql`)
0. **Precondiții (fail-closed).** Migrarea se oprește, fără să schimbe nimic, dacă:
   - 0a: politica `hr_autorizatii_write_authorized` nu mai are textul analizat (md5 pe textul cu spațiile normalizate = `cc78b7fd…`);
   - 0b: nu mai e singura politică de scriere pe `hr_autorizatii`;
   - 0c: pe `profiles` nu sunt **exact** cele 4 triggere analizate: nume, funcție, md5 al corpului, `tgtype` 19 (BEFORE UPDATE FOR EACH ROW), activate (`O`), fără WHEN și fără listă de coloane, funcții SECURITY DEFINER cu `search_path=public, pg_temp`, proprietar postgres. Un trigger în plus, unul lipsă, dezactivat sau cu alt corp ⇒ refuz;
   - 0d: RPC-ul live nu e nici varianta analizată (`527c0e47…`), nici cea din patch (`42e0528e…`);
   - 0e: pe jurnal RLS nu e activ sau nu există **exact o** politică de scriere (ALL/INSERT/UPDATE/DELETE): cea de azi (`…_insert_authenticated`, md5 `with_check` `dc71e447…`) sau, la reaplicare, cea din patch (`…_insert_autorizat`, md5 `780014ba…`).
1. **`fn_poate_scrie_hr_autorizatii()`:**
   - LANGUAGE sql, STABLE, SECURITY DEFINER, `search_path = public, pg_temp`;
   - predicat **identic** cu politica: `is_owner` / `can_modify_employees` / `role='superadmin'` / `department IN ('HR','Administrativ')`, pe `auth.uid()`;
   - EXECUTE doar pentru `authenticated` (politica jurnalului îl evaluează ca authenticated) și `service_role`. Nu pentru PUBLIC sau anon;
   - întoarce doar dreptul apelantului. COMMENT-ul spune explicit că e poarta RSVTI, nu sursa tuturor scrierilor HR.
2. **`confirm_hr_autorizatie_rsvti`**, aceeași semnătură, același tip returnat, aceleași efecte:
   - (a) **poarta**, înaintea oricărei citiri: `auth.uid()` NULL sau fără drept ⇒ `42501`;
   - (b) **data confirmării efectuate** (`v_data = coalesce(p_data_confirmare, azi București)`): `> azi (Europe/Bucharest)` ⇒ `22023`; nefinită sau `< 2000-01-01` ⇒ `22023`; `< data_emitere` (când e completată) ⇒ `22023`;
   - (c) **scadența** = data + `interval_confirmare_rsvti_luni` al tipului (implicit 6), calculată în funcție;
   - ACL-ul rămâne neschimbat.
3. **Jurnalul:**
   - politica INSERT `…_insert_authenticated` se înlocuiește cu `…_insert_autorizat`: `(SELECT fn_poate_scrie_hr_autorizatii()) AND confirmat_de = (SELECT auth.uid())`;
   - `REVOKE UPDATE, DELETE … FROM anon, authenticated`;
   - `REVOKE INSERT … FROM anon`.
4. **Postcondiții**, în aceeași tranzacție: md5 RPC = `42e0528e…`, md5 helper = `a59aeb46…`, pe jurnal RLS activ și exact politica de scriere din patch (md5 `780014ba…`), GRANT-urile de scriere retrase. Altfel se anulează tot.

**Ce NU schimbă:**
- politicile de pe `hr_autorizatii` și `hr_autorizatii_tipuri`, deci cine poate scrie autorizații;
- EXECUTE pe RPC (UI-ul îl apelează ca authenticated);
- datele existente;
- TRUNCATE/TRIGGER pe jurnal (sunt în PR-ul separat TRUNCATE/ACL, P14);
- UI-ul (`HR.jsx` e neatins).

## 3. Poarta = regula politicii; verificarea sursei drepturilor
Copilot a cerut: „o copie a unei politici nu e suficientă fără verificarea sursei drepturilor”. Am verificat trei lucruri.
- **Politica sursă** (live): `hr_autorizatii_write_authorized`, ALL, `{authenticated}`, cu USING = WITH CHECK = predicatul de mai sus. E singura politică de scriere pe `hr_autorizatii`. Aceeași expresie (md5 `f2a295ca…`) e și pe `hr_autorizatii_tipuri_write_authorized`. Nu folosește nicio funcție helper, doar coloane din `profiles`.
- **Ce acoperă helperul:** exact poarta RSVTI, adică cine confirmă o viză prin RPC și cine inserează direct în jurnal. **Nu** e sursa tuturor scrierilor în `hr_autorizatii`: `fn_hr_autorizatie_propunere_accepta(bigint)` (acceptarea propunerilor AI din „Citire autorizații”) creează sau leagă autorizații cu poarta ei (owner sau `can_access_personal_data`) și nu atinge `rsvti_*` (catalog live, 29.09). De aceea runda 2 a reformulat COMMENT-ul helperului și antetul migrării.
- **Coloanele din care vine dreptul nu se pot autoatribui.** Precondiția 0c cere **setul exact** de triggere de pe `profiles` (citit live, PG 17.6, 29.09 ~22:20 UTC: exact aceste 4, toate `tgtype` 19, `O`, fără WHEN/coloane, SECURITY DEFINER, `search_path=public, pg_temp`, proprietar postgres):

| Trigger | Funcție (md5 `prosrc`) | Protejează | Test |
|---|---|---|---|
| `prevent_role_escalation_trigger` | `prevent_role_escalation()` `16112659be92143e6539ae0e54e47a06` | `is_owner`, `role` (RAISE pentru non-owner) | P3 |
| `trg_enforce_owner_only_salary_flags` | `enforce_owner_only_salary_flags()` `0470660c0a819981ff914355c7f6d00a` | `can_modify_employees` (resetare tăcută) | P3: UPDATE acceptat, flag rămas false, poarta închisă |
| `trg_profiles_campuri_owner_only` | `fn_profiles_campuri_owner_only()` `c06d7ce0f212c7bba2093c50614a88fc` | `department` (S-A, 42501) | P3: HR și Administrativ refuzate |
| `trg_protect_can_access_pontaj_brut` | `protect_can_access_pontaj_brut()` `ff277c90e02ef03d1efb34cd7e87b1d4` | `can_access_pontaj_brut` (nu intră în poartă; face parte din setul exact) | — |
| rând nou în `profiles` | `profiles_insert_owner`; `handle_new_user` creează cu `manager_santier`, fără departament | | (acoperit de S-A) |

  Un al 5-lea trigger (de exemplu unul care scrie `department` dintr-un câmp editabil, sortat după S-A, scenariul S2 al verificatorului) ar ocoli protecțiile fără să le atingă. Runda 1 verifica doar prezența celor 3 protecții, iar migrarea trecea. Acum e refuzată (harness 0b, S2).
- **Echivalența comportamentală (P2):** pentru 9 identități, helperul dă același răspuns ca politica live, adică dacă identitatea poate scrie efectiv în `hr_autorizatii` și în `hr_autorizatii_tipuri`. Identitățile: owner, can_modify, superadmin, HR, Administrativ, Execuție, `role='hr'` fără departament, JWT fără profil, authenticated fără claims. Verificatorul a adăugat încă 5 (ADV-D3): `department='hr'` (litere mici), `'HR '` (cu spațiu), `role hr` + can_modify, `admin_logistica`, `sef_echipa` + Administrativ.

**Identitatea (modelul S-A):** decizia se ia pe identitate explicită, adică `sub`-ul JWT rezolvat la un profil cu drept. Nu există nicio cale „sistem”.

| Apelant | Rezultat |
|---|---|
| authenticated + sub cu drept | trece |
| authenticated + sub fără drept / fără profil / fără claims | 42501 |
| `service_role` (JWT fără sub) | 42501 (nu există niciun apelant backend: 0 edge-uri în repo, 0 cron, 0 funcții; `pg_stat_statements` de la 07.08: doar `authenticated` a apelat RPC-ul) |
| login postgres fără claims (MCP, SQL editor) | 42501 |
| anon | fără EXECUTE |

## 4. Regula datei: ce înseamnă `p_data_confirmare` (din cod)
- **UI, crearea autorizației** (`src/HR.jsx:1837`, `:2006`, `:1901-1906`): câmpul „**Data ultimei vize** (opțional)” trimite `p_data_confirmare = vizaInitiala`. E o viză deja făcută.
- **UI, editare** (`src/HR.jsx:2083`, `:2108-2113`, `:2269`): „Data vizei”, cu implicit `new Date().toISOString()`, adică ziua **UTC**; butonul „Confirmă viza RTS”.
- **Funcția** calculează scadența: `data + interval luni`. UI-ul doar o previzualizează (`setMonth`, `src/HR.jsx:1842-1843`). Apelantul n-o trimite.
- **Concluzie:** `p_data_confirmare` = **data confirmării efectuate** și nu e scadența. De aici:
  - nu poate fi în viitor;
  - trebuie să fie o zi reală: finită (`isfinite`) și ≥ **2000-01-01**. Autorizațiile cu viză RSVTI expiră în câțiva ani, deci o viză de dinainte de 2000 e sigur o greșeală de introducere. Pragul e generos și acoperă și importuri vechi. `-infinity` și datele î.Hr. treceau pe live și aici erau acceptate și pentru HR (ADV-E2/E3);
  - nu poate fi înainte de `data_emitere`;
  - scadența rămâne calculată în funcție.
- **„Azi” se ia în `Europe/Bucharest`.** Producția e în UTC, iar PostgREST acceptă `Prefer: timezone`. Între 00:00 și 03:00, ora României, ziua UTC e încă ieri, așa că o limită UTC ar refuza o confirmare legitimă „de azi”. Data implicită din UI (ziua UTC) e mereu ≤ ziua din București. Testele au rulat chiar într-o astfel de fereastră (UTC 29.09, București 30.09).
- **`NULL` explicit ⇒ azi în `Europe/Bucharest`** (runda 2, ADV-D5): aceeași referință ca limita, deci un `NULL` nu mai poate fi refuzat „în viitor” într-o sesiune cu fus orar la est de București. Înainte era `current_date`-ul sesiunii. UI-ul trimite mereu data, deci nu e o schimbare vizibilă.
- **Rămâne ca înainte:** parametrul **omis** ia `DEFAULT CURRENT_DATE` din semnătură, evaluat în fusul sesiunii. La est de București rezultatul poate fi cel mult un refuz `22023`; la vest, data rămâne „ieri”, ca azi. Semnătura rămâne neschimbată pentru compatibilitatea cu UI-ul (P1), iar UI-ul nu omite niciodată data.
- Previzualizarea din UI (`setMonth`) și calculul SQL (`make_interval`) diferă la sfârșit de lună: 31.08 + 6 luni dă 03.03 în JS și 28.02 în SQL. Valoarea salvată e cea din SQL (P8). Diferența e preexistentă și e doar de afișare.

### 4.1 Data confirmării efectuate ≠ scadența (cerința Copilot, review plan v2, 30.09)
Cerința: „Pentru RSVTI, separați data confirmării efectuate de data următoarei scadențe.” **Sunt deja separate**, ca două câmpuri și două concepte, în schemă, în RPC, în UI și în alerte:

| Strat | Data confirmării EFECTUATE | Scadența următoare | Dovadă |
|---|---|---|---|
| Schemă, jurnal | `data_confirmare date NOT NULL` | `urmatoarea_confirmare date NOT NULL` | `supabase/tests/sec_rsvti_schelet.sql:351-352` (copie fidelă a schemei live, 29.09) |
| Schemă, fișă | `rsvti_ultima_confirmare date` | `rsvti_urmatoarea_confirmare date` | `supabase/tests/sec_rsvti_schelet.sql:316-317` |
| RPC | singurul parametru de dată: `p_data_confirmare` → `v_data` | `v_next`, calculat din tip; nu există parametru | `supabase/migrations/20261003c_sec_rsvti_poarta_jurnal.sql:145` (semnătura), `:158` (`v_data`), `:201` (`v_next`), `:213-214` (jurnal), `:221-222` (fișă) |
| Regula „nu în viitor” | se aplică datei efectuate | nu se aplică (scadența e de regulă în viitor) | `…poarta_jurnal.sql:187-198` |
| UI | „Data ultimei vize” / „Data vizei” (intrare) | „Următoarea viză” (doar afișare, calculată) | `src/HR.jsx:2006`, `:2269` / `:1842-1843`, `:2259-2261`, `:2282` |
| Alerte | — | citesc doar scadența | `src/adminAlerte.js:93` |

**Teste:** P10 (coloane distincte în ambele tabele; RPC-ul primește doar data efectuată; o confirmare de azi produce o scadență în viitor, acceptată; jurnalul și fișa le stochează separat), P8 (un al 4-lea argument sau `p_urmatoarea_confirmare` ⇒ 42883), PF (toate rândurile: scadența = data + interval). **Nu e nevoie de o schimbare de schemă.** Opțional, doar documentare: `COMMENT ON COLUMN` pe cele 4 coloane. Nu e în patch.

## 5. Teste
- **Fișiere:**
  - `supabase/tests/sec_rsvti_schelet.sql` (schelet, neschimbat);
  - `supabase/tests/sec_rsvti.test.sql` (teste, `-v gaura=true|false`);
  - `scripts/test_sec_rsvti.sh` (harness, inclusiv scenariile negative).
- **Rulare:** `bash scripts/test_sec_rsvti.sh [--opreste]`, pe PG16 local. Implicit `PGDATA=/tmp/pg_sec_rsvti`, `127.0.0.1:5442`, baza `sec_rsvti_test`. Runda 2 a rulat pe `PGDATA_TEST=/tmp/pg_sec_rsvti_r2 PGPORT_TEST=5462`.
- **Fidelitatea scheletului e verificată la încărcare:**
  - md5(prosrc) identic cu producția pentru RPC-ul live și pentru cele 4 triggere de pe `profiles`;
  - ACL-urile RPC-ului și ale celor 3 tabele sunt identice. Excepție: „m” (MAINTAIN) există doar în PG17;
  - md5 pe textul politicilor (deparse PG16 = PG17).

| Pas | Mod | Rezultat |
|---|---|---|
| 0 | schelet = producția de azi: **gaura reprodusă** | 17 OK |
| 0b | precondiții negative pe starea live, fiecare într-o tranzacție anulată: politică INSERT în plus (S1), politica de azi relaxată, RLS oprit, al 5-lea trigger (S2), S-A dezactivat, corp de trigger schimbat, trigger AFTER cu același nume, RPC necunoscut → **refuzate**; `pg_dump` identic | 9 verificări |
| 1 | după migrare | 108 OK |
| 2 | după reaplicare (idempotență) | 108 OK |
| 2b | reaplicare peste o politică ALL în plus / peste un RPC corectat ulterior → **refuzate** | 2 verificări |
| 3a | rollback tehnic: nearmat, armat cu altă valoare, cu comutatorul Ofertare, cu `SET LOCAL` expirat (tranzacție anterioară), peste un RPC corectat ulterior (S3), peste un helper schimbat, peste politica patch-ului relaxată, peste o politică în plus, cu o dependență nouă (S4) → **refuzate**; `pg_dump` identic | 10 verificări |
| 3 | rollback tehnic **armat**: comutatorul dezarmat după COMMIT; `pg_dump --schema-only` **identic** cu pasul 0; **gaura redeschisă**; suita PATCH **cade** pe starea live (pe aserțiunea P1, nu din alt motiv) | 17 OK + 2 verificări |
| 4 | reaplicare: gaura închisă; suita GAURA **cade** pe starea patch | 108 OK + 1 verificare |
| 5 | rollback armat **greșit** (`SET` de sesiune): după rulare comutatorul e dezarmat; reaplicare ⇒ schema de la pasul 4 | 2 verificări |
| | **Total** | **358 OK + 26 verificări negative, PASS** |

| Grup | Ce dovedește |
|---|---|
| G1–G7 (gaura) | RPC = live (md5 `527c0e47…`); non-HR prin RPC → viză până la **2099-07-01**, deși direct în `hr_autorizatii` nu poate scrie (RLS); cont fără profil confirmă; jurnal falsificat în numele owner-ului, alt angajat, dată 2098; **UPDATE/DELETE pe jurnal = 0 rânduri deja azi** (dovada că REVOKE-ul nu schimbă comportamentul); anon INSERT deja refuzat de RLS; anon fără EXECUTE; non-HR cu `-infinity` acceptat |
| P1 | helper și RPC: SECURITY DEFINER, `search_path`, proprietar, ACL (fără PUBLIC/anon), semnătura neschimbată și fără parametru de scadență, poarta înaintea oricărei citiri, amprentele (RPC `42e0528e…`, helper `a59aeb46…`), COMMENT-ul helperului; jurnal: politica veche a dispărut, RLS activ și exact o politică de scriere (md5 `780014ba…`); GRANT-uri retrase; politicile HR neatinse |
| P2 | helper ≡ politica live, pe matricea de 9 identități |
| P3 | setul exact de 4 triggere pe `profiles`; sursa drepturilor nu se autoatribuie (department HR/Administrativ, role, is_owner refuzate; can_modify_employees resetat) |
| P4 | refuz 42501: non-HR (dată validă și atacul 2099), id inexistent (fără oracol), `role=hr` fără departament, JWT fără profil, authenticated fără claims, service_role, postgres fără claims; anon fără EXECUTE pe RPC și pe helper; jurnal și fișă neschimbate |
| P5 | jurnal: non-HR (în nume propriu sau al owner-ului), HR în numele altcuiva, HR anonim → refuz RLS; HR în nume propriu trece (dreptul păstrat, limitele în grupul R); UPDATE/DELETE (HR și owner prin API) → fără GRANT; anon → fără GRANT |
| P6 | **traseele legitime:** owner, can_modify, superadmin, HR (observații tăiate), Administrativ azi (butonul „Confirmă viza”), data implicită din UI (ziua UTC), fluxul „Adaugă autorizație” (INSERT ca HR + viza inițială); dreptul retras de owner ⇒ 42501 imediat |
| P7 | mâine / 2099 → 22023 (și pentru HR); cu o zi înainte de `data_emitere` → 22023; exact `data_emitere` trece; fișă fără `data_emitere` → doar minimul 2000-01-01; `NULL` → azi București; erorile vechi (tip fără viză, autorizație ștearsă) neschimbate; refuzurile nu scriu nimic |
| P7-TZ | **determinist** (preluat din ADV-D4): ambele zone rulează mereu. În `Etc/GMT+12`, azi București e acceptat, iar `NULL` dă azi București. În `Pacific/Kiritimati`, `current_date`-ul sesiunii e refuzat exact când e „mâine” în București, `NULL` dă azi București, iar mâine e refuzat. La orice oră, cel puțin o zonă are altă dată decât Bucureștiul (aserțiune), deci `v_azi := current_date` și `coalesce(…, current_date)` pică. Numărul de aserțiuni și de rânduri scrise e același la orice oră (`teste.rpc_stare` anulează scrierea) |
| P8 | scadența: 31.08 + 6 luni = 28.02; tip cu 12 luni; interval necompletat = 6; al 4-lea argument sau `p_urmatoarea_confirmare` numit → 42883 |
| P9 | `infinity` → 22023 (viitor); `-infinity`, `0044-03-15 BC`, `1999-12-31` → 22023 (minim); exact `2000-01-01` trece; refuzurile nu scriu nimic |
| P10 | data efectuată ≠ scadența (§4.1) |
| PF | toate cele 19 rânduri scrise de suită: scadența = data + interval; niciunul în viitor, nefinit sau înainte de 2000 |
| R1–R5 | **reziduale documentate** (§8), aserțiunile confirmă că există, nu că sunt dorite: INSERT direct HR cu `id`/`created_at` alese (și în viitor) și angajat ≠ fișa (R1); HR scrie direct `rsvti_*` cu `rsvti_confirmat_de` = owner, fără jurnal (R2); ștergerea fizică a fișei șterge istoricul prin CASCADE (R3); o confirmare retroactivă suprascrie fișa (R4); reînnoirea cu „Data ultimei vize” anterioară noii emiteri → 22023, fișa rămâne fără viză (R5) |

**Controale negative: mutanți ai migrării** (fiecare aplicat pe o bază nouă; din testele implementatorului sunt neutralizate doar amprentele md5, iar din mutant, postcondițiile, altfel orice mutant ar pica trivial):

| Mutant | Testele implementatorului | Bateria adversarială (copie r2) |
|---|---|---|
| fără poartă / poarta doar pe identitate | P1 (poziția porții) | ADV-A1 / ADV-A5 |
| `v_azi := current_date` | P6 acum; **P7-TZ la orice oră** | ADV-D4 |
| fără limita „viitor” | P7 | ADV-E1 |
| fără limita `data_emitere` | P7 | ADV-D1 |
| politica jurnalului fără atribuire / fără helper | P1, P5 | ADV-C3 / ADV-C1 |
| helper cu „uid NULL ⇒ sistem” / cu `role='hr'` | **P2** | supraviețuiesc (acoperite de P2) |
| fără REVOKE UPDATE/DELETE | P1 | ADV-C9 |
| [r2] `coalesce(p_data_confirmare, current_date)` | P7 / **P7-TZ** | ADV-D5 [r2] |
| [r2] fără minim/`isfinite` · minim 1900 · minim exclusiv | P9 (-infinity · 1999-12-31 · exact 2000-01-01) | ADV-E2 · E3b · E4 [r2] |

**14/14 prinși** de testele implementatorului, 12/14 și de bateria adversarială.

**Controale negative: mutanți ai precondițiilor și ai rollback-ului.** Pentru fiecare, harness-ul complet a rulat pe o copie și **a căzut**, 8/8:

| Mutant | Unde cade harness-ul |
|---|---|
| fără precondiția 0e (politici jurnal) | S1: migrarea e oprită tot, dar de **postcondiție** (a doua linie); harness-ul observă că s-a schimbat motivul |
| 0c doar „prezența” celor 4 (fără numărul exact) | S2: al 5-lea trigger → migrarea ar trece |
| fără verificarea RLS pe jurnal | RLS oprit: oprită de postcondiție (a doua linie); motivul se schimbă |
| rollback fără armare | rollback nearmat → ar trece |
| rollback fără md5 RPC | S3 → ar trece peste o corecție ulterioară |
| rollback fără md5 helper | helper schimbat → ar trece |
| rollback fără verificarea politicii | politica patch-ului relaxată → ar trece |
| rollback fără dezarmare | pasul 5: comutatorul de sesiune rămâne armat |

**Ceas simulat.** Testul de fus orar trebuie să prindă mutantul la orice oră. Am rulat pe un PG16 separat (`127.0.0.1:5463`), cu `libfaketime` instalat local în container, doar pentru test:
- momente: 30.09 12:30 UTC (București 15:30, discriminează doar Kiritimati), 30.09 10:30 UTC (ambele zone), 15.12 12:30 UTC (iarnă, doar Kiritimati), 15.12 11:30 UTC (iarnă, ambele), plus rularea reală (01:40 București, doar GMT+12);
- rezultat la fiecare moment: harness-ul complet **358 + 26, PASS**, bateria adversarială r2 PASS, iar mutanții `v_azi := current_date` și `coalesce(…, current_date)` **prinși** de P7-TZ și de ADV-D4/D5.

**Suita adversarială a verificatorului** (în scratchpad, nu în repo; originalul e neatins). Copia runda 2 schimbă doar ce contrazice intenționat corecturile: S1/S2/S3 așteaptă acum refuzul, S4 folosește noul md5, D5 e determinist, E2/E3 sunt refuzate, plus limitele E3b/E4. Totul e marcat `[r2]`. Rezultate pe 5462:

| Scenariu | Rezultat |
|---|---|
| L (live) | controale K: 9 OK, atacurile reușesc |
| V | bateria PATCH pe live **cade** (vacuitate) |
| P (patch) | 60 OK (61 între ~13:00 și ~15:00, ora Bucureștiului: D4 are atunci ambele ramuri) |
| S1 | migrarea **REFUZATĂ** (0e) + 3 OK |
| S2 | migrarea **REFUZATĂ** (0c) + 3 OK |
| S3 | rollback nearmat **REFUZAT**, armat **REFUZAT** (precondiția md5) + 4 OK, gaura rămâne închisă |
| S4 | rollback armat **REFUZAT** (dependență) + 3 OK |
| S5 | 6 OK |

Limită: validarea dinamică e doar locală. Pe producție, după apply, verificarea e read-only (§7). Atacul nu se încearcă pe date reale.

## 6. Revenirea
- **`…_ROLLBACK.sql` = rollback TEHNIC, armat.**
  - Readuce exact starea de azi: RPC-ul live verbatim, politica veche, GRANT-urile, fără helper. Deci **redeschide gaura**. În producție se rulează doar la cererea explicită a lui Răzvan, cu motivul consemnat.
  - **Armare (runda 2):** fișierul nu face nimic fără `SET LOCAL gazpet.rollback_tehnic_20261003c = 'REDESCHIDE_GAURA_RSVTI';`, pusă în **aceeași tranzacție**, pe prima linie. Comutatorul e al acestui patch: cel de la Ofertare, `…_20261003b`, nu-l armează. `SET LOCAL` expiră la COMMIT, iar la final rollback-ul dezarmează și sesiunea, deci nici un `SET` pus greșit nu rămâne armat (pasul 5 din harness).
  - **Precondiții (runda 2, S3):** starea curentă trebuie să fie **exact** patch-ul: md5 RPC `42e0528e…`, md5 helper `a59aeb46…`, iar pe jurnal, politica din patch trebuie să fie singura de scriere. Peste o corecție ulterioară a RPC-ului (alt md5) rollback-ul **refuză**: nu readuce tacit varianta fără poartă peste o versiune neanalizată. Se reanalizează.
  - **Postcondiții:** RPC = live (`527c0e47…`), helper absent, politica veche singura de scriere. O dependență nouă de helper (S4) face DROP să eșueze. Tot fișierul e **un singur bloc DO**, deci nu se aplică „pe jumătate”, nici fără tranzacție.
  - Harness-ul dovedește că desfacerea e curată (`pg_dump` identic).
  - Folosire: preview read-only (md5 curente), apoi un `apply_migration` cu linia `SET LOCAL` + conținutul exact al fișierului (sha256 `7311c5d588ce25c7115ebbba2a9e513305ad2284f3545f88b5688aed39069f68`, 170 de linii), apoi verificare read-only (md5 RPC = `527c0e47…`, helper absent). Dacă `apply_migration` n-ar rula într-o tranzacție, `SET LOCAL` n-ar avea efect și rollback-ul ar refuza (fail-closed).
- **Revenirea operațională păstrează poarta:**
  1. **Utilizator legitim refuzat** (`42501 Nu ai dreptul să confirmi viza RSVTI…`): dreptul se dă prin mecanismul existent (department HR/Administrativ sau `can_modify_employees`, setate de owner), **cu acordul lui Răzvan** (CLAUDE.md pct. 3). Dacă e nevoie de un drept doar pentru vize (de ex. operatorul RSVTI), trebuie un flag dedicat + o migrare nouă revizuită.
  2. **Dată legitimă refuzată** (`22023`):
     - o dată în viitor sau înainte de 2000 e o greșeală de introducere;
     - o dată înainte de emitere înseamnă că `data_emitere` din fișă e greșită (poate fi completată și de scannerul AI, `hr-autorizatii-scan`) sau, la „Reînnoiește”, că s-a introdus viza autorizației vechi (§8). Se corectează fișa din „Editează”, apoi se confirmă viza.
  3. **Funcția e defectă:** se face `CREATE OR REPLACE` cu corecția, revizuit (GO Copilot). Nu se revine niciodată la varianta fără poartă.

## 7. Apply: preview → confirmare → apply → verificare
Condiții: GO Copilot pe această revizie (îi trimit diff-ul efectiv și rezultatul testelor) și **acordul explicit al lui Răzvan**. Patch-ul nu e pe Ofertare, dar se aplică tot numai cu acordul lui.

**Pasul 1: preview read-only, imediat înainte.** Se aplică numai dacă toate valorile ies ca mai jos. Interogările se rulează separat, pentru că `execute_sql` întoarce doar ultimul rezultat.
```sql
-- (a) amprentele pe care se bazează patch-ul (= precondițiile 0a–0e). Așteptat:
--   RPC: md5 527c0e47…, ACL {postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres};
--   hr_autorizatii: o singură politică de scriere, hr_autorizatii_write_authorized, cc78b7fd… ×2;
--   jurnal: RLS activ (t); exact 2 politici: …_insert_authenticated (INSERT, dc71e447…) și …_select_authenticated (SELECT);
--   profiles: EXACT 4 triggere, toate tgtype 19, tgenabled O, fara_when t, coloane '':
--     prevent_role_escalation_trigger     | prevent_role_escalation()         | 16112659be92143e6539ae0e54e47a06
--     trg_enforce_owner_only_salary_flags | enforce_owner_only_salary_flags() | 0470660c0a819981ff914355c7f6d00a
--     trg_profiles_campuri_owner_only     | fn_profiles_campuri_owner_only()  | c06d7ce0f212c7bba2093c50614a88fc
--     trg_protect_can_access_pontaj_brut  | protect_can_access_pontaj_brut()  | ff277c90e02ef03d1efb34cd7e87b1d4
SELECT md5(prosrc), proacl::text FROM pg_proc WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure;
SELECT policyname, md5(regexp_replace(qual,'\s+',' ','g')) q, md5(regexp_replace(with_check,'\s+',' ','g')) w
  FROM pg_policies WHERE schemaname='public' AND tablename='hr_autorizatii' AND cmd IN ('ALL','INSERT','UPDATE','DELETE');
SELECT c.relrowsecurity, p.policyname, p.cmd, md5(coalesce(p.with_check,'')) w
  FROM pg_class c LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
 WHERE c.oid = 'public.hr_autorizatii_rsvti_confirmari'::regclass ORDER BY 2;
SELECT t.tgname, t.tgfoid::regprocedure, md5(p.prosrc), t.tgtype, t.tgenabled, t.tgqual IS NULL AS fara_when, t.tgattr::text AS coloane
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal ORDER BY 1;
-- (b) riscul de regresie (doar număr + departament). Așteptat: nicio linie cu trece_poarta=false în afară de „(confirmat_de NULL)”.
WITH conf AS (SELECT confirmat_de uid, 'jurnal' sursa FROM public.hr_autorizatii_rsvti_confirmari
              UNION ALL SELECT rsvti_confirmat_de, 'fisa' FROM public.hr_autorizatii WHERE rsvti_confirmat_de IS NOT NULL OR rsvti_ultima_confirmare IS NOT NULL),
     per AS (SELECT uid, count(*) FILTER (WHERE sursa='jurnal') nj, count(*) FILTER (WHERE sursa='fisa') nf FROM conf GROUP BY uid)
SELECT CASE WHEN u.uid IS NULL THEN '(confirmat_de NULL)' WHEN p.id IS NULL THEN '(fără profil)' ELSE coalesce(p.department,'(fără departament)') END departament,
       (u.uid IS NOT NULL AND p.id IS NOT NULL AND (p.is_owner OR p.can_modify_employees OR p.role='superadmin' OR p.department IN ('HR','Administrativ'))) trece_poarta,
       count(*) conturi, sum(nj) randuri_jurnal, sum(nf) fise
  FROM per u LEFT JOIN public.profiles p ON p.id = u.uid GROUP BY 1,2 ORDER BY 2,1;
-- (b2) runda 2, informativ (doar numere): confirmări existente care n-ar trece noul minim. Așteptat: 0 și 0.
SELECT (SELECT count(*) FROM public.hr_autorizatii_rsvti_confirmari WHERE NOT isfinite(data_confirmare) OR data_confirmare < '2000-01-01') jurnal_sub_minim,
       (SELECT count(*) FROM public.hr_autorizatii WHERE NOT isfinite(rsvti_ultima_confirmare) OR rsvti_ultima_confirmare < '2000-01-01') fise_sub_minim;
-- (c) cine a apelat RPC-ul (așteptat: doar authenticated)
SELECT userid::regrole, sum(calls) FROM extensions.pg_stat_statements WHERE query ILIKE '%confirm_hr_autorizatie_rsvti%' GROUP BY 1;
```
Rezultatele din 29.09:
- (a), ~21:40 UTC: toate conforme. Verificat din nou pe cataloage la ~22:20 UTC (runda 2): exact cele 4 triggere de mai sus, cu md5, `tgtype` 19, `O`, fără WHEN/coloane; RLS activ pe cele 3 tabele; pe jurnal exact cele 2 politici; RPC live `527c0e47…`, helper inexistent.
- (b): HR, 1 cont, 6 rânduri în jurnal, 2 fișe, trece; Administrativ, 1 cont, 3 rânduri, 3 fișe, trece; `(confirmat_de NULL)`, 0 rânduri în jurnal, 26 de fișe (import, nu RPC).
- (b2): nerulat. În runda 2 am citit doar cataloage. Minimul se aplică numai confirmărilor noi, deci (b2) e doar informativ.
- (c): `authenticated`, 1 apel de la resetarea din 07.08.
- Alte cifre (runda 1):
  - poarta o trec azi 10 din 31 de profile: 2 owneri; non-owneri: 6 can_modify, 6 superadmin, 1 HR, 4 Administrativ (categoriile se suprapun);
  - `role='hr'` fără poartă: 0;
  - rânduri din jurnal cu dată în viitor la creare: 0; înainte de emitere: 0; cu scadența diferită de calcul: 0; cu angajat nepotrivit: 0;
  - rânduri pe fișe fără `data_emitere`: 2;
  - autorizații de externi cu viză: 0.

**Pasul 2: confirmarea explicită a lui Răzvan**, pe exact acest fișier: sha256 `efdd64a01cd10fbe8bd5507cb8bc5cc29a88f544440e763a6bc639f1a68a98aa`, 281 de linii.

**Pasul 3:** un singur `apply_migration`, cu numele `sec_rsvti_poarta_jurnal` și conținutul exact al fișierului. Fără alte migrări, fără DML. Dacă o precondiție sau o postcondiție pică, nu se aplică nimic: tranzacția se anulează și se reanalizează.

**Pasul 4: verificare read-only după apply.** Postcondițiile migrării verifică deja, în tranzacție, amprentele, politica și GRANT-urile. Citirea de după apply doar confirmă.
- RPC:
  - `md5(prosrc)` = `42e0528ed5af58c0cccc7b801aef4193`;
  - ACL = `{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}`;
  - `pg_get_function_arguments` neschimbat.
- Helper:
  - `md5(prosrc)` = `a59aeb46d5007222067276184a63aaa0`;
  - ACL = `{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}`;
  - `prosecdef`, `proconfig` = `search_path=public, pg_temp`.
- Jurnalul:
  - RLS activ;
  - politicile sunt exact `…_insert_autorizat` (INSERT, `{authenticated}`, `md5(with_check)` = `780014ba883836d16ffb7a014c7430c6`) și `…_select_authenticated`. Textul e `(( SELECT fn_poate_scrie_hr_autorizatii() AS fn_poate_scrie_hr_autorizatii) AND (confirmat_de = ( SELECT auth.uid() AS uid)))`. Md5-ul e calculat pe PG16. Pe live (PG17) aceleași construcții se deparsează identic, verificat pe `firma_profil_*` și `grafic_act_*`. Dacă totuși ar diferi, postcondiția anulează migrarea (fail-closed) și se reanalizează;
  - `relacl` = `{postgres=arwdDxtm/postgres,anon=rDxtm/postgres,authenticated=arDxtm/postgres,service_role=arwdDxtm/postgres}`.
- `hr_autorizatii_write_authorized` e neschimbată (preview a).
- `get_advisors`, doar ca diagnostic. Așteptat: `fn_poate_scrie_hr_autorizatii` apare în lint 0029. E doar citire și întoarce doar dreptul apelantului, ca `fn_are_acces_ofertare`. RPC-ul rămâne în 0029, pentru că trebuie apelat de UI, dar acum are poartă.
- Funcțional: la prima confirmare reală făcută de HR, un SELECT read-only pe ultimul rând din jurnal (`confirmat_de` = contul HR, data ≤ azi). Pe producție nu se face nicio probă de atac.
- De spus echipei HR la apply: la „Reînnoiește”, „Data ultimei vize” nu mai poate fi anterioară noii date de emitere (§8).

**Pasul 5:** rând nou în jurnalul Copilot (`COPILOT_HANDOFF.md` + `handoff_copilot`) și în `handoff_activ`.

## 8. Riscul de regresie și ce rămâne deschis
**Regresie (utilizatori legitimi):**
- **0 conturi afectate** pe istoricul real (§7 b).
- UI-ul trimite mereu o dată ≤ azi: implicit ziua UTC, altfel aleasă de om. Refuzurile noi pentru cine are drept: dată în viitor, înainte de 2000-01-01 sau nefinită, înainte de emitere. Pe istoric: 0 cazuri în viitor sau înainte de emitere. Pentru minim vezi preview (b2).
- **Reînnoire (R5 / ADV-D1), schimbare vizibilă:** la „Reînnoiește” (`src/HR.jsx:1901-1908`), dacă „Data ultimei vize” e viza autorizației **vechi**, deci anterioară noii `data_emitere`, RPC-ul întoarce 22023. Autorizația nouă rămâne salvată, fără viză, cu toast-ul „Autorizație salvată, dar viza RTS a eșuat: … nu poate fi înainte de emiterea autorizației”. Remediu: „Confirmă viza” cu o dată ≥ emiterea. Înainte, viza veche se lipea pe autorizația nouă. Refuzul e comportamentul corect (o viză nu poate preceda emiterea autorizației vizate), dar e de anunțat echipei HR.
- **Posibil refuz legitim:** `data_emitere` completată greșit, inclusiv de scannerul AI (`hr-autorizatii-scan` o completează doar unde lipsea). Mesajul spune exact ce e de corectat (§6.2).
- Operatorul RSVTI (Execuție) nu poate confirma. N-a făcut-o niciodată în aplicație (0 rânduri) → decizia lui Răzvan.
- Un eventual apelant backend cu `service_role` ar fi refuzat. Nu am găsit niciunul: repo, `cron.job`, `pg_proc`, `pg_stat_statements` (cu limitele de la §10).

**Rămâne deschis: decizii pentru Răzvan.** Nu sunt în mandatul acestui patch și fiecare cere o decizie separată. Testele R1–R5 dovedesc că fiecare comportament există.
1. **(P1b) Grupul HR scrie direct `rsvti_*` în `hr_autorizatii`** (politica ALL), fără regula datei și **cu atribuire falsă** (R2 / ADV-C5): poate pune `rsvti_confirmat_de` = oricine (de ex. owner-ul), `rsvti_confirmat_la` arbitrar și o scadență 2099, **fără niciun rând în jurnal**. E dreptul lor de azi.
   - Închidere propusă: un trigger BEFORE INSERT OR UPDATE pe `hr_autorizatii` care refuză orice schimbare a coloanelor `rsvti_*` când `current_user` nu e proprietarul RPC-ului (postgres). Așa `rsvti_*` se scriu doar prin RPC, care aplică poarta, regula datei și jurnalul.
   - Nu există scrieri directe în cod: `HR.jsx`, `HrPersonalExtern.jsx`, `TabDocumentePersonale.jsx`, `AdeverinteLegator.jsx`, edge-ul `hr-autorizatii-scan` și `fn_hr_autorizatie_propunere_accepta` nu trimit `rsvti_*`. Ar fi fără regresie, dar schimbă drepturile HR, deci e propunere.
2. **INSERT direct HR în jurnal — mai larg decât scria runda 1** (R1 / ADV-C4). În nume propriu, HR alege `id`, `created_at` (retrodatat sau **în viitor**), un `employee_id` diferit de cel al fișei, data și scadența.
   - **Corectură:** runda 1 spunea că indicatorul „dată în viitor” l-ar vedea. E **fals**: indicatorul compară `data_confirmare` cu `created_at`, iar HR le alege pe amândouă (R1: dată 2099, `created_at` 2099 ⇒ indicatorul nu-l vede).
   - Fișa și statusul rămân neschimbate (`v_hr_autorizatii_status` citește fișa), dar jurnalul nu mai e o probă de încredere.
   - **DECIZIE A/B pentru Răzvan:**
     - **A (recomandat): `REVOKE INSERT ON public.hr_autorizatii_rsvti_confirmari FROM authenticated`.** Jurnalul e scris doar de RPC, care calculează tot. În repo nu există INSERT direct. Politica `…_insert_autorizat` rămâne o plasă sau se șterge. Riscul: un script extern nelistat care inserează direct (n-am găsit, §10) ar primi 42501;
     - **B (minim):** GRANT INSERT doar pe coloanele `autorizatie_id, employee_id, data_confirmare, urmatoarea_confirmare, confirmat_de, observatii` (fără `id` și `created_at`, care iau valorile implicite) plus, în politică, `employee_id = (SELECT employee_id FROM hr_autorizatii WHERE id = autorizatie_id)`. Tot ar rămâne data și scadența alese de HR, iar ca să le închidă, B ar trebui să dubleze în politică regulile RPC-ului. De aceea A e mai simplu și mai sigur.
3. **Jurnalul NU e doar-adăugare** (R3 / ADV-C7). REVOKE UPDATE/DELETE închide doar calea directă pe jurnal. HR poate șterge **fizic** fișa (politica ALL pe `hr_autorizatii` permite DELETE), iar FK-ul `hr_autorizatii_rsvti_confirmari_autorizatie_id_fkey` e `ON DELETE CASCADE` (verificat live: `confdeltype = c`). Istoricul confirmărilor dispare cu fișa.
   - UI-ul șterge doar logic (`deleted_at`, `src/HR.jsx:640`, `:1561`), deci ștergerea fizică e posibilă doar prin REST direct.
   - Închideri posibile (decizie): FK `ON DELETE RESTRICT`/`NO ACTION`, sau DELETE fizic retras de la `authenticated` pe `hr_autorizatii` (schimbă politica ALL). Patch-ul nu schimbă comportamentul.
4. **O confirmare retroactivă suprascrie fișa** (R4 / ADV-F1, preexistent). Fișa ia **ultima confirmare introdusă**, nu cea mai recentă efectuată. De exemplu, după o viză de ieri, introducerea uneia din 2025-02-01 coboară scadența la 2025-08-01, iar observația de ieri dispare de pe fișă. Jurnalul le păstrează pe amândouă.
   - Direcția e cea sigură (viza apare restantă mai devreme), dar informația e greșită.
   - Fix posibil (schimbă efectul RPC-ului, deci decizie separată): fișa se actualizează doar dacă `v_data ≥ rsvti_ultima_confirmare`, sau se recalculează din `max(data_confirmare)` din jurnal.
5. `hr_autorizatii_tipuri.interval_confirmare_rsvti_luni` e editabil de grupul HR (azi 6 la toate cele 3 tipuri cu viză). Un interval absurd ar întinde scadențele. E dreptul lor de azi; o limită (de ex. 1–24 de luni) ar fi o decizie separată.
6. TRUNCATE și TRIGGER pe jurnal pentru `anon`/`authenticated` rămân (ADV-G1). Sunt în PR-ul separat TRUNCATE/ACL (P14). Nu se pot atinge prin PostgREST.
7. Un defect latent, preexistent: pe o autorizație de extern (`employee_id` NULL), RPC-ul ar pica pe NOT NULL în jurnal (23502, nimic scris; ADV-D6). Azi nu există autorizații de externi cu viză (0).
8. De știut, fără să fie o gaură (by design Supabase):
   - cine are cheia `service_role` poate pune în JWT `sub`-ul unui HR și trece poarta în numele lui (ADV-A8);
   - în SQL direct ca `authenticated`, claims se pot seta cu `set_config` (ADV-B5), dar calea nu e expusă prin REST;
   - poarta decide pe identitatea din claims, ca orice politică RLS Supabase.

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
- **Scripturi externe** (tura de noapte, NAS, Apps Script) care ar scrie direct în jurnal cu un JWT de utilizator. N-am găsit niciunul în repo. Unul care scrie în nume propriu, cu un cont din grupul HR, ar trece. Unul care scrie în numele altcuiva sau cu un cont fără drept ar fi refuzat, și exact asta e scopul. Cu decizia A de la §8.2, ar fi refuzat și primul.
- **Validarea e pe PG16 local:** producția e PG17.6. Fidelitatea e verificată pe corpuri, ACL (fără „m”) și textul politicilor. Diferențele de planificare dintre versiuni nu afectează predicatele. Md5-ul politicii noi e calculat pe PG16. Forma deparse e identică pe PG17 la politici live cu aceleași construcții, iar dacă ar diferi, postcondiția oprește migrarea.
- **Date sub minimul 2000-01-01:** în runda 2 am citit doar cataloage. Numărul confirmărilor existente sub minim e în preview (b2), informativ.
- **Precondiția 0c** verifică triggerele de pe `profiles`, nu și alte căi de scriere a coloanelor de drept (funcții SECURITY DEFINER care fac UPDATE pe `profiles`, reguli). Acestea țin de S-A și de inventarul #157, nu de acest patch.
- **Ce semnifică viza în regulament** (cine are voie legal să confirme, RTS sau RSVTI) nu reiese din cod. Regula de drept e cea din politica existentă, neschimbată.

## 11. Runda 2 (30.09): corecturile verificatorului
Verdictul verificatorului adversarial pe revizia 1 (commit `300c2a2`): **CU_CORECȚII, poarta rezistă**. Toate corecturile de mai jos sunt aplicate local și testate. Nimic nu e aplicat în producție.

| # | Constatare | Schimbare | Test |
|---|---|---|---|
| 1 | **MEDIU (S1):** migrarea nu verifica politicile jurnalului. Cu o a doua politică INSERT permisivă, un non-HR falsifica jurnalul în numele owner-ului și după migrare | Precondiția **0e**: RLS activ + **exact o** politică de scriere (cea de azi, cu md5 `dc71e447…`, sau la reaplicare cea din patch, cu md5 `780014ba…`). **Postcondiția** §4: exact politica din patch, RLS, GRANT-uri | harness 0b: politică INSERT în plus, politica de azi relaxată, RLS oprit → refuz; 2b: politică ALL în plus la reaplicare → refuz; adv r2 S1: REFUZATĂ; P1; mutanții H `pre_fara_jurnal` și `pre_fara_rls` prinși (postcondiția e a doua linie) |
| 2 | **MEDIU (S3):** rollback-ul nu verifica nimic. Peste un RPC corectat ulterior readucea varianta fără poartă și granturile largi | Rollback-ul e un singur bloc DO: **armare** `SET LOCAL gazpet.rollback_tehnic_20261003c` (proprie), **precondiții** (md5 RPC `42e0528e…`, md5 helper `a59aeb46…`, politica din patch singura de scriere), **postcondiții** (= live), **dezarmare** | harness 3a: 9 refuzuri (nearmat, altă valoare, comutator Ofertare, `SET LOCAL` expirat, S3, helper, politică relaxată, politică în plus, S4) + `pg_dump` fără urme; 3: `pg_dump` după rollback identic cu live; 5: armare de sesiune dezarmată; adv r2 S3 nearmat și armat REFUZAT, S4 REFUZAT; mutanții H `rb_*` 5/5 prinși |
| 3 | **(S2)** 0c verifica doar prezența celor 3 protecții, nu setul exact de triggere pe `profiles` | 0c = **setul exact de 4 triggere** (nume, funcție, md5, `tgtype` 19, `O`, fără WHEN/coloane, SECURITY DEFINER, `search_path`, proprietar), citit live. Doc §7 (fosta linie 155, „3 triggere”) corectat cu lista exactă | harness 0b: al 5-lea trigger, S-A dezactivat, corp schimbat, AFTER cu același nume → refuz; P3 (setul exact); adv r2 S2: REFUZATĂ; mutantul H `pre_triggere_doar_prezenta` prins |
| 4 | Testul de fus orar depindea de ora rulării | **P7-TZ** preia ADV-D4 (`Etc/GMT+12` + `Pacific/Kiritimati`), ambele zone mereu, număr constant de aserțiuni și de rânduri (`teste.rpc_stare`) | ceas simulat (`libfaketime`) la 4 momente + rularea reală: 358 + 26 de fiecare dată; `v_azi := current_date` și `coalesce(…, current_date)` prinși de fiecare dată |
| 5 | §8: jurnalul **nu** e doar-adăugare (DELETE fizic pe fișă + CASCADE, ADV-C7) | Documentat (§8.3), fără schimbare de comportament; FK verificat live (`confdeltype = c`) | R3 |
| 6 | INSERT-ul direct HR e mai larg decât spunea doc-ul (`id`, `created_at` retro sau viitor, `employee_id` ≠ fișă, ADV-C4) | §8.2 corectat („indicatorul l-ar vedea” era fals). **DECIZIE A/B:** A (recomandat) REVOKE INSERT de la `authenticated`; B minim = GRANT pe coloane + verificarea `employee_id` în politică | R1 |
| 7 | Scrierea directă HR pe `rsvti_*` permite atribuire falsă (`rsvti_confirmat_de` = owner, fără jurnal, ADV-C5) | Inclusă în propunerea **P1b** (§8.1): trigger care permite `rsvti_*` doar prin RPC | R2 |
| 8 | Mărunte: date nefinite/absurde acceptate (ADV-E2/E3); `NULL` ⇒ `current_date` al sesiunii, inconsecvent cu limita (ADV-D5); ADV-F1 și ADV-D1 nedocumentate | RPC: `isfinite(v_data)` + minim `2000-01-01` (22023); `v_data := coalesce(p_data_confirmare, v_azi)`, adică azi București. F1 documentat (§8.4), D1 documentat (§8, regresie vizibilă) | P9 (4 refuzuri + limita), P7 și P7-TZ (`NULL`), adv r2 D5/E2/E3/E3b/E4; mutanții `r2_*` 4/4 prinși; R4 (F1), R5 (D1) |
| 9 | COMMENT-ul helperului („sursa unică pentru cine scrie autorizații HR”) era prea larg: există și `fn_hr_autorizatie_propunere_accepta` | COMMENT reformulat: „poarta RSVTI … Nu e sursa tuturor scrierilor în hr_autorizatii: fn_hr_autorizatie_propunere_accepta are poarta ei”. La fel antetul migrării și §3 (poarta ei: owner sau `can_access_personal_data`, verificat în catalog) | P1 (COMMENT) |
| 10 | Cerința Copilot (review plan v2, 30.09): „separați data confirmării efectuate de data următoarei scadențe” | **Deja separate** în schemă (câte 2 coloane în jurnal și pe fișă), RPC (o singură dată de intrare, scadența calculată), UI și alerte: dovezile fișier:linie la §4.1. Fără schimbare de schemă | P10, P8, PF |

**Amprente noi (PG16):**
- RPC `md5(prosrc)` = `42e0528ed5af58c0cccc7b801aef4193` (runda 1: `49a9d3a7…`, niciodată aplicat);
- helper = `a59aeb46d5007222067276184a63aaa0` (neschimbat);
- politica jurnalului `md5(with_check)` = `780014ba883836d16ffb7a014c7430c6`;
- migrarea: sha256 `efdd64a0…68a98aa`, 281 de linii;
- rollback-ul: sha256 `7311c5d5…39069f68`, 170 de linii.

**Neaplicat din listă:** nimic. Punctele 5–7 sunt, conform cererii, doar documentate, ca decizii pentru Răzvan.
