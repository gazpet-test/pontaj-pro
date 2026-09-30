# SEC RSVTI: poarta pe `confirm_hr_autorizatie_rsvti` și pe jurnal (P1 / constatarea (1)), 29.09→03.10.2026

> **NEAPLICAT.** E un patch distinct, doar pentru suprafața RSVTI, așa cum a cerut Copilot. Se aplică doar după GO-ul lui Copilot pe această revizie și după acordul explicit al lui Răzvan (§7). Nu atinge Ofertare, datele, `profiles` sau alte funcții.
> **Revizia 4 (30.09): traseul de livrare** — răspuns la verdictul Copilot r3 (GO SQL, NO-GO apply): tranzacția o deține `scripts/livrare_migrare.sh`, fișierul nu mai are BEGIN/COMMIT, înregistrarea e în aceeași tranzacție; **§13**. Logica RSVTI e neschimbată.
> **Revizia 3 (30.09):** răspunsul la NO-GO-ul Copilot pe runda 2 (`e707ba5`, text integral în `SECURITATE_PATCH_RSVTI_VERDICT_COPILOT_R2.md`). Tabelul punct Copilot → schimbare → test → rezultat e la **§12**. Revizia 2 (corecturile verificatorului) e la §11; unde §0–§10 diferă de §11, e valabil textul actual.
> **Consemnarea corectă a efectului, până la decizia A (§8.2):** „INSERT direct restrâns la grupul autorizat și identitatea proprie”. NU „jurnal de confirmări integral verificabil” și NU „RSVTI securizat complet”: P1b, ștergerea prin cascadă și suprascrierea fișei prin confirmări retroactive rămân findings **OPEN** (§8); P1b e pasul următor prioritar.
> Tot ce am citit din producție a fost read-only: pe 29.09 după 21:30 UTC (runda 1: cataloage, `pg_policies`, ACL, `pg_stat_statements` doar rol și număr de apeluri, două SELECT-uri agregate care întorc doar numere și departamente) și pe 29.09 ~22:20 UTC (runda 2: **doar cataloage**: `pg_trigger`, `pg_proc`, `pg_policies`, `pg_class`, `pg_constraint`). N-am apelat nicio funcție a aplicației.

## 0. Pe scurt
- **Gaura închisă:** orice cont logat putea prelungi viza RSVTI a oricui, cu orice dată, printr-un apel RPC direct (`2099-01-01` ⇒ viză „valabilă” până în 2099; `infinity` ⇒ viză care nu mai expiră; `-infinity` sau o dată î.Hr. ⇒ gunoi pe fișă). Putea și să scrie direct în jurnal, în numele oricui.
- **Fix-ul are trei părți, tratate împreună:**
  - **Poarta:** aceeași regulă ca politica de scriere pe `hr_autorizatii`, printr-o singură funcție, `fn_poate_scrie_hr_autorizatii()`. E sursa unică a **porții RSVTI** (RPC + INSERT direct în jurnal), nu a tuturor scrierilor în `hr_autorizatii`: `fn_hr_autorizatie_propunere_accepta` are poarta ei (§3). Drepturile nimănui nu se schimbă.
  - **Regula datei:** data confirmării **efectuate** e finită, ≥ 2000-01-01 (regulă de business), nu e în viitor (azi în `Europe/Bucharest`) și nu precede emiterea autorizației. Data **omisă** (semnătura are acum `DEFAULT NULL::date`) și `NULL` explicit înseamnă azi în București. Scadența rămâne calculată în funcție, separat (§4.1).
  - **Jurnalul:** INSERT direct e permis doar celor care trec aceeași poartă, și doar în nume propriu. UPDATE și DELETE nu mai sunt permise din API.
- **Precondiții fail-closed (runda 2):** migrarea refuză dacă pe jurnal nu e **exact o** politică de scriere (cea de azi sau, la reaplicare, cea din patch) sau RLS e oprit, dacă pe `profiles` nu sunt **exact cele 4 triggere** analizate (cu md5) sau dacă RPC-ul live e altul. La final, o postcondiție verifică starea rezultată. Rollback-ul tehnic e **armat** (`SET LOCAL` propriu) și refuză orice stare care nu e exact patch-ul.
- **Teste (runda 3):** **393 de aserțiuni OK + 65 de verificări negative/fără urme/statice**, rulat de două ori, exit 0; detalii §12. Runda 2 avea: **358 de aserțiuni OK + 26 de verificări negative** pe PG16 local, pe ciclul complet (bază → refuzuri → migrare → reaplicare → refuzuri → rollback tehnic armat → reaplicare). Gaura e reprodusă pe varianta live și din nou după rollback. **14/14 mutanți** ai migrării sunt prinși de teste, **8/8 mutanți** ai precondițiilor/rollback-ului sunt prinși de harness. Testul de fus orar e determinist: verificat și cu ceas simulat, la 4 ore diferite (§5).
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
   - 0d: RPC-ul live nu e nici varianta analizată (`527c0e47…` + `DEFAULT CURRENT_DATE`), nici cea din patch (`6185a9dd…` + `DEFAULT NULL::date`), verificate în pereche;
   - 0a (runda 3): RLS activ pe `hr_autorizatii`; toate comparațiile sunt NULL-safe (`IS DISTINCT FROM`), deci o politică fără USING/WITH CHECK (md5 NULL) e refuzată;
   - 0f (runda 3): helperul e absent sau exact definiția aprobată (md5 corp + atribute + ACL, fără supraîncărcări), altfel refuz înainte de orice modificare.
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
4. **Postcondiții, înainte de `COMMIT;`** (fișierul are `BEGIN;` … `COMMIT;`, runda 3): 4a md5 RPC `6185a9dd…` + semnătura `DEFAULT NULL::date`, md5 helper `a59aeb46…`, fără supraîncărcări; 4b atributele (limbaj, volatilitate, SECURITY DEFINER, `proconfig` exact, proprietar postgres, tip întors); 4c pe jurnal RLS activ și exact politica din patch (md5 `780014ba…`); 4d **privilegiile efective** (`has_function_privilege` / `has_table_privilege` / `has_any_column_privilege` pentru `public`, `anon`, `authenticated`: acoperă PUBLIC, moștenirea prin roluri și granturile pe coloane); 4e ACL-ul exact al celor două funcții. Altfel se anulează tot. RPC-ul refuză și când poarta întoarce NULL (`IS NOT TRUE`).

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
  - trebuie să fie finită (`isfinite`) și ≥ **2000-01-01**. Pragul e o **regulă de business** (date plauzibile pentru vize care expiră în câțiva ani), **nu o dovadă** că orice dată anterioară e o greșeală; un caz real sub prag se discută, nu se forțează. Pragul e generos și acoperă și importuri vechi. `-infinity` și datele î.Hr. treceau pe live și aici erau acceptate și pentru HR (ADV-E2/E3);
  - nu poate fi înainte de `data_emitere`;
  - scadența rămâne calculată în funcție.
- **„Azi” se ia în `Europe/Bucharest`.** Producția e în UTC, iar PostgREST acceptă `Prefer: timezone`. Între 00:00 și 03:00, ora României, ziua UTC e încă ieri, așa că o limită UTC ar refuza o confirmare legitimă „de azi”. Data implicită din UI (ziua UTC) e mereu ≤ ziua din București. Testele au rulat chiar într-o astfel de fereastră (UTC 29.09, București 30.09).
- **`NULL` explicit ⇒ azi în `Europe/Bucharest`** (runda 2, ADV-D5): aceeași referință ca limita, deci un `NULL` nu mai poate fi refuzat „în viitor” într-o sesiune cu fus orar la est de București. Înainte era `current_date`-ul sesiunii. UI-ul trimite mereu data, deci nu e o schimbare vizibilă.
- **Parametrul omis (runda 3, cerința Copilot):** semnătura are acum `DEFAULT NULL::date` (runda 2 păstra `DEFAULT CURRENT_DATE`, evaluat în fusul sesiunii: la 23:30 UTC, sesiune UTC, data omisă înregistra 29.09 în loc de 30.09). `CREATE OR REPLACE` acceptă schimbarea (același tip, același număr de valori implicite — verificat pe PG16; doar eliminarea unei valori implicite sau schimbarea tipului ei ar fi refuzate), iar ACL-ul se păstrează. Corpul rezolvă `coalesce(p_data_confirmare, v_azi)`. Tipurile nu se schimbă, deci UI-ul (care trimite mereu data) și PostgREST rămân compatibili. Dovada: testul cu ceas fix (§12).
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
| P1 | helper și RPC: SECURITY DEFINER, `search_path`, proprietar, ACL (fără PUBLIC/anon), semnătura neschimbată și fără parametru de scadență, poarta înaintea oricărei citiri, amprentele (RPC `6185a9dd…` în r3, helper `a59aeb46…`), COMMENT-ul helperului; jurnal: politica veche a dispărut, RLS activ și exact o politică de scriere (md5 `780014ba…`); GRANT-uri retrase; politicile HR neatinse |
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
- **`supabase/revenire/20261003c_sec_rsvti_poarta_jurnal_ROLLBACK.sql` = rollback TEHNIC (runda 3: mutat din `supabase/migrations/`).** Artefact de test / revenire excepțională, **fără GO de execuție** (verdict Copilot r2); `supabase/revenire/README.md` explică de ce niciun runner și niciun CI nu-l ating.
  - Readuce exact starea de azi (RPC live verbatim cu `DEFAULT CURRENT_DATE`, politica veche, GRANT-urile, fără helper), deci **redeschide gaura**. O folosire în producție cere decizia explicită a lui Răzvan + review separat; armarea nu e autorizare.
  - **Tranzacția:** fișierul nu are `BEGIN`/`COMMIT`; gestionarul e operatorul, cu un singur string: `BEGIN; SELECT set_config('gazpet.rollback_tehnic_20261003c', 'REDESCHIDE_GAURA_RSVTI:' || txid_current(), true); <fișierul> COMMIT;`.
  - **Armare legată de tranzacție (runda 3):** valoarea trebuie să fie `'REDESCHIDE_GAURA_RSVTI:' || txid_current()`. O setare de sesiune rămasă, una dintr-o tranzacție anterioară sau eșuată poartă alt txid ⇒ refuz. Armarea persistentă (`pg_db_role_setting`, nume comparat cu `lower()`) e refuzată chiar lângă o armare validă. La final se dezarmează și sesiunea.
  - **Precondiții:** starea = exact patch-ul r3 (RPC `6185a9dd…` + `DEFAULT NULL::date`, helper `a59aeb46…` + atribute + ACL, politica din patch singura de scriere). **Postcondiții:** RPC `527c0e47…` + `DEFAULT CURRENT_DATE`, helper absent, politica veche, RLS, privilegiile efective de azi. Un singur bloc DO; o dependență nouă de helper (S4) face DROP să eșueze.
  - Harness-ul dovedește că desfacerea e curată (`pg_dump` identic cu starea live).
- **Revenirea operațională păstrează poarta:**
  1. **Utilizator legitim refuzat** (`42501 Nu ai dreptul să confirmi viza RSVTI…`): dreptul se dă prin mecanismul existent (department HR/Administrativ sau `can_modify_employees`, setate de owner), **cu acordul lui Răzvan** (CLAUDE.md pct. 3). Dacă e nevoie de un drept doar pentru vize (de ex. operatorul RSVTI), trebuie un flag dedicat + o migrare nouă revizuită.
  2. **Dată legitimă refuzată** (`22023`):
     - se verifică **documentele** și **versiunea autorizației** (ex. la „Reînnoiește” s-a introdus viza autorizației vechi, §8);
     - refuzul „data confirmării precede emiterea” **nu dovedește** că `data_emitere` e greșită (poate fi, inclusiv din scannerul AI `hr-autorizatii-scan`, dar se stabilește din documente). **Nu se modifică o dată reală doar ca să treacă validarea**; fișa se corectează numai dacă documentul arată altă dată;
     - pragul 2000-01-01 e o regulă de business, nu o dovadă că orice dată anterioară e o greșeală; un caz real sub prag se discută.
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

**Pasul 1b (runda 3), tot read-only:** `SELECT relrowsecurity FROM pg_class WHERE oid='public.hr_autorizatii'::regclass` (așteptat `t`); pe `hr_autorizatii_write_authorized`, `qual IS NOT NULL AND with_check IS NOT NULL` (așteptat `t`); `SELECT count(*) FROM pg_proc WHERE proname='fn_poate_scrie_hr_autorizatii'` (așteptat 0); `pg_get_function_arguments` pe RPC = `… DEFAULT CURRENT_DATE …`.

**Pasul 2: confirmarea explicită a lui Răzvan**, pe exact acest fișier: sha256 `ed16a2d936cd9ca83e1beddcabab39d95ddad6c8135403ba9746c34939cb30ac`, 430 de linii (runda 4).

**Pasul 3 (runda 4, înlocuiește textul r3):** livrare prin **`scripts/livrare_migrare.sh`** — gestionarul unic al tranzacției: `psql --single-transaction` cu marcaj + migrare + `INSERT` în `supabase_migrations.schema_migrations`, toate în aceeași tranzacție (§13). NU `apply_migration` / `execute_sql`: fișierul le refuză (garda de livrare). Fără alte migrări, fără DML. Orice eroare, inclusiv chiar la înregistrare, anulează tot; pe succes, patch-ul și înregistrarea există simultan. Emulările r3 (a/b/c) sunt înlocuite de testul traseului efectiv (harness pasul 6).

**Pasul 4: verificare read-only imediat după apply.** Postcondițiile (înainte de COMMIT-ul runnerului) verifică deja amprentele, semnătura, atributele, politica, privilegiile efective și ACL-ul funcțiilor. Citirea de după apply doar confirmă:
- `SELECT version, name FROM supabase_migrations.schema_migrations WHERE name = 'sec_rsvti_poarta_jurnal'`: exact un rând. Dacă patch-ul e aplicat, dar neînregistrat (posibil doar în varianta c): **fără INSERT manual**; se raportează, iar reaplicarea fișierului e idempotentă (precondițiile acceptă starea patch-ului);
- privilegiile efective: `has_function_privilege` / `has_table_privilege` / `has_any_column_privilege` pentru `public`, `anon`, `authenticated` (așteptat: EXECUTE doar `authenticated`; pe jurnal nimic de scris pentru `public`/`anon`, fără UPDATE/DELETE pentru `authenticated`);
- **amprentele nu se actualizează automat.** Dacă pe PG17 o amprentă diferă, migrarea se oprește singură (fail-closed, nimic aplicat). Se compară definițiile (`pg_get_functiondef`, textul din `pg_policies`) PG16 ↔ PG17, iar revizia se actualizează doar după review; hash-ul găsit **nu** se adaugă automat în lista albă.
- RPC:
  - `md5(prosrc)` = `6185a9ddf13a9e666368858decfa9611`;
  - ACL = `{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}`;
  - `pg_get_function_arguments` = `p_autorizatie_id bigint, p_data_confirmare date DEFAULT NULL::date, p_observatii text DEFAULT NULL::text`.
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

## 12. Runda 3 (30.09): răspuns la NO-GO Copilot
Verdictul Copilot pe runda 2 (`e707ba5`): **NO-GO pe revizie, GO pe direcție** (text integral: `SECURITATE_PATCH_RSVTI_VERDICT_COPILOT_R2.md`). Totul e local (PG16, `127.0.0.1:5482`). Nimic nu e aplicat în Supabase și nimic nu e commis.

| Punct Copilot | Schimbare | Test | Rezultat (r3 / r2) |
|---|---|---|---|
| Data **omisă** folosea `DEFAULT CURRENT_DATE` (fusul sesiunii) | Semnătura are `DEFAULT NULL::date`; corpul rezolvă `coalesce(…, azi București)`. `CREATE OR REPLACE` o acceptă (același tip și număr de valori implicite; ACL păstrat) | Pasul 7: ceas fix `libfaketime` 2026-09-29 23:30 UTC, sesiuni `UTC` și `Etc/GMT+12` (data sesiunii 29.09 < București 30.09): data omisă și `NULL` ⇒ 30.09. În suită: P7 și P7-TZ cu data omisă, la orice oră | r3: 12/12 OK. **r2 pică**: „C1 sesiune UTC: data OMISĂ → înregistrat 2026-09-29” |
| 0a nu era fail-closed pe NULL; RLS pe tabelul sursă neverificat | Toate comparațiile din pre/postcondiții trec pe `IS [NOT] DISTINCT FROM` (verificare statică: zero `<>`/`NOT IN`); 0a verifică `relrowsecurity` pe `hr_autorizatii` | 0b: politica sursă `ALL TO authenticated` fără USING/WITH CHECK, doar cu USING, `USING(true)` (control), RLS oprit pe `hr_autorizatii` | r3: REFUZATE, fără urme. **r2 TRECE** (fără USING/WITH CHECK; RLS oprit) |
| Helperul existent putea fi suprascris | 0f: absent sau exact definiția aprobată (md5 corp + atribute + ACL, fără supraîncărcări), înainte de orice modificare | 0b: alt corp, supraîncărcare; 2b: alt corp, SECURITY INVOKER, EXECUTE pentru anon | r3: REFUZATE. **r2 TRECE** (suprascrie tacit) |
| Atomicitatea nedemonstrată; un singur gestionar | `BEGIN;` … `COMMIT;` în fișier (verificare statică: prima/ultima instrucțiune, postcondiția înainte de COMMIT) | Pasul 6: runner (a) `psql -f` + ON_ERROR_STOP, (b) un singur query, (c) runner cu BEGIN propriu + înregistrare în `supabase_migrations.schema_migrations`, fiecare cu {fără eroare, `SELECT 1/0` după prima înlocuire de funcție, `SELECT 1/0` în postcondiție}; (a0) fără ON_ERROR_STOP; (c-reg) înregistrare eșuată | r3: 9/9 + a0 + c-reg conforme; la (c) WARNING-urile documentate (§7 pasul 3). **r2 cu runner (a): URME rămase** (helper/RPC comise); r2 cu (b)/(c): atomic (runnerul ține tranzacția) |
| Postcondiția: atribute și privilegii efective | 4b atribute; 4d `has_*` pentru `public`/`anon`/`authenticated` (moștenire, coloane); 4e ACL exact pe funcții; 4a include semnătura | 0b: UPDATE pe coloană către PUBLIC; UPDATE pe coloană către authenticated rămas după REVOKE (variantă a fișierului); rol moștenit (WITH INHERIT TRUE) cu UPDATE pentru authenticated și cu EXECUTE pe RPC pentru anon; RPC cu alt proprietar | r3: toate REFUZATE de postcondiție, totul anulat. **r2 TRECE** la toate 5 (cea către authenticated e o variantă a fișierului: pe r2, postcondiția pe `relacl` nu vede coloanele) |
| Notă de semantică | Un `GRANT … (coloană) TO authenticated` **dinainte** nu poate rămâne: `REVOKE UPDATE ON tabel` retrage și granturile pe coloane ale aceluiași rol (verificat). Rămân posibile cele prin PUBLIC sau prin roluri moștenite, iar acestea sunt testate | — | — |
| Rollback-ul în afara migrărilor | Mutat în `supabase/revenire/` + README (niciun runner, CI referă doar fișiere anume). Fișier fără BEGIN/COMMIT, string-ul operatorului | Pasul S (static) | r3: absent din `supabase/migrations`. r2: prezent |
| Armarea nu dovedea SET LOCAL | Armare legată de `txid_current()`; refuz pentru armare persistentă (`pg_db_role_setting`, `lower()`); dezarmare finală | 3a: 13 refuzuri (fără armare, altă valoare, stil r2, alt txid, comutator Ofertare, persistent pe bază, persistent pe rol cu majuscule, precondiții, S4). 3s, **o singură sesiune psql**: SET de sesiune preexistent; set_config de sesiune cu txid vechi; armare validă (locală + de sesiune) + eroare în fișier + ROLLBACK, apoi reluare fără armare nouă. Pasul 5: dezarmarea sesiunii | r3: toate REFUZATE, sesiunea dezarmată. **r2 EXECUTĂ** rollback-ul cu SET de sesiune preexistent și cu armare persistentă. Reluarea după eșec e refuzată și de r2 (SET LOCAL se anulează), deci acolo testul nu discriminează |
| Coerență cu #537 (NULL în poartă) | RPC: `fn_poate_scrie_hr_autorizatii() IS NOT TRUE` ⇒ 42501 | P4-NULL: helper care întoarce NULL | r3: 42501. **r2 TRECE** (poarta ocolită) |
| Procedura operațională și formulările | §6 și antetul rollback-ului: „precedă emiterea” nu dovedește că `data_emitere` e greșită, nu se modifică o dată reală; pragul 2000-01-01 e regulă de business; consemnarea „INSERT direct restrâns…” (antet); P1b, cascada și suprascrierea retroactivă OPEN, P1b pas următor prioritar; amprentele nu intră automat în lista albă (§7 pasul 4) | — | — |

**Rezultat harness:** `bash scripts/test_sec_rsvti.sh` cu `PGDATA_TEST=/tmp/pg_sec_rsvti_r3/data PGPORT_TEST=5482`, rulat de două ori: **393 de aserțiuni OK + 65 de verificări negative/fără urme/statice, exit 0** de fiecare dată.

**Mutanți pe fișierele noi** (harness-ul complet cu `MIGRARE_FISIER` / `ROLLBACK_FISIER`): **19/19 prinși**.
- Migrare:
  - fără RLS pe sursă, 0a ne-NULL-safe, fără 0f, 0f fără ACL, 0f fără atribute, fără 4b, fără 4d, 4d fără coloane → fiecare cade la scenariul lui;
  - fără BEGIN/COMMIT → pasul S;
  - `DEFAULT CURRENT_DATE` → postcondiția 4a oprește migrarea. Fără verificarea semnăturii din 4a → P1 (semnătură); comportamental, testul cu ceas pică pe r2 (tabelul de mai sus);
  - poarta `NOT` în loc de `IS NOT TRUE` → 4a (md5); comportamental, P4-NULL pe r2.
- Rollback: armare fără txid, fără refuzul persistenței, nume fără `lower()`, fără dezarmare, fără precondiția RPC / helper / politică → fiecare cade la scenariul lui.

**Amprente r3 (PG16):** RPC `md5(prosrc)` = `6185a9ddf13a9e666368858decfa9611` (r2 `42e0528e…`, neaplicat); helper `a59aeb46d5007222067276184a63aaa0` (neschimbat); politica jurnalului `md5(with_check)` = `780014ba883836d16ffb7a014c7430c6` (neschimbat); migrarea sha256 `5a355506f18505494f296dcd93a52a7df7450d8e47033c00b0cfe80393d0853b` (415 linii); rollback-ul sha256 `795ea5a0793c0eec0dcee5d8b1ab4a63ba2b63ea6fea5764977a591b6a6c5e2a` (234 de linii).

**Limite:** comportamentul exact al `apply_migration` nu se poate observa local (de aceea cele 3 emulări). Deparse-ul PG17 al `DEFAULT NULL::date` și al politicii e presupus identic; dacă diferă, migrarea se oprește singură (§7 pasul 4). Testele de discriminare și mutanții rulează din scripturi scratch (nu în repo), pe același cluster.

## 13. Runda 4 — traseul de livrare (răspuns la verdictul Copilot #538 r3)
Verdict r3 (`docs/SECURITATE_PATCH_RSVTI_VERDICT_COPILOT_R3.md` pe #538): GO pe SQL, NO-GO pe apply, pentru că `COMMIT`-ul din fișier comitea patch-ul **înaintea** `INSERT`-ului în `supabase_migrations.schema_migrations`. Cerința: **un singur gestionar de tranzacție** care include DDL-ul, postcondițiile și înregistrarea. Logica patch-ului nu s-a schimbat; s-a schimbat doar artefactul de livrare. Totul e local; nimic aplicat, nimic pushat.

**a) Traseul efectiv: de ce NU `apply_migration` (MCP).** `apply_migration` trimite SQL-ul la Management API (`POST /v1/projects/{ref}/database/migrations`, cod server închis; issue public supabase/mcp#241). Nici documentația Supabase (`search_docs`), nici codul public al MCP-ului nu spun dacă execuția și `INSERT`-ul în `schema_migrations` sunt în aceeași tranzacție, deci **nu se poate demonstra**. Pentru comparație, CLI-ul public (`supabase db push`, `pkg/migration/file.go`) pune instrucțiunile și `INSERT`-ul într-un singur `pgconn.Batch`, „implicitly transactional”, dar un `COMMIT` din fișier ar rupe și acolo tranzacția. Concluzia: traseul oficial e unul demonstrabil local, cu `psql`.

**Procedura oficială** — `scripts/livrare_migrare.sh` (identic în #538 și #542, sha256 `9f921a0a…` la acest commit):
```
bash scripts/livrare_migrare.sh supabase/migrations/20261003c_sec_rsvti_poarta_jurnal.sql -- "<URI conexiune directă / Supavisor session mode, rol postgres>"
# = psql -X -q -v ON_ERROR_STOP=1 --single-transaction \
#       -f marcaj.sql  (SELECT set_config('gazpet.livrare_migrare', '20261003c_sec_rsvti_poarta_jurnal:' || txid_current(), true))
#       -f 20261003c_sec_rsvti_poarta_jurnal.sql
#       -f inregistrare.sql  (verifică marcajul; refuză dacă name='20261003c_sec_rsvti_poarta_jurnal' există deja;
#                              INSERT (version AAAALLZZHHMMSS UTC, name, statements = fișierul întreg))
```
- Refuză înainte de conexiune un fișier cu control de tranzacție (`BEGIN;`, `COMMIT`, `ROLLBACK`, `ABORT`, `START TRANSACTION`, `PREPARE TRANSACTION`, în afara comentariilor `--`) sau fără garda de livrare.
- `version` = timestamp UTC de 14 cifre (formatul folosit de `apply_migration` în producție, citit read-only din `schema_migrations`: ultimele versiuni `20260929…`); `name` = numele fișierului fără `.sql` (ca `20260929f_v_claude_context_start`); coloanele reale: `version, statements, name, created_by, idempotency_key, rollback` (information_schema, read-only).
- **Precondiție de operare:** un `psql` ≥ 16 și un URI de conexiune cu rol `postgres` (parola bazei). Din sesiunea Claude există doar MCP, deci livrarea o rulează Răzvan (sau o sesiune cu URI-ul dat explicit de el). Transaction-mode pooler (6543) nu e necesar; se folosește conexiunea directă sau session mode (5432).

**b) Fișierul fără BEGIN/COMMIT.** `BEGIN;` → garda de livrare de **start**; `COMMIT;` → garda de livrare de **final** (după postcondiții). Ambele: `current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003c_sec_rsvti_poarta_jurnal:' || txid_current()` ⇒ `RAISE`. Ordinea în tranzacție: marcaj → gardă start → precondiții → DDL → postcondiții → gardă final → verificare + `INSERT` înregistrare → `COMMIT` (al runnerului). Postcondițiile rămân înainte de sfârșitul tranzacției (verificare statică în harness). Noul fișier: sha256 `ed16a2d936cd9ca83e1beddcabab39d95ddad6c8135403ba9746c34939cb30ac`, 430 linii.

**c) Fișierul rulat singur, fără runner.** `transaction_timestamp() <> statement_timestamp()` nu e fiabil; soluția robustă e marcajul **legat de txid**: `set_config(..., true)` e local tranzacției, iar în autocommit fiecare instrucțiune are alt txid. Demonstrat în harness (toate refuzate de garda de start, `pg_dump` identic, nicio înregistrare): `psql -f` simplu; un singur query (`psql -c`, echivalentul `execute_sql`); `psql --single-transaction` fără marcaj; marcaj de **sesiune** dintr-o tranzacție anterioară; `SET` de sesiune fără txid. Deci `apply_migration` / `execute_sql` pe acest fișier **refuză** (fail-closed) — nu există cale accidentală spre „aplicat, neînregistrat”.
- **Limite documentate:** (1) cine pune manual marcajul corect în aceeași tranzacție (`BEGIN; set_config(…txid…); \i fișier; COMMIT;`) ocolește înregistrarea — e o acțiune deliberată, nu un accident; harness-ul o folosește intern (faza de patch fără tabel de înregistrare). (2) Un `END;` la nivel de instrucțiune (sinonim `COMMIT`) nu se poate deosebi textual de finalul unui corp plpgsql; îl prinde garda de **final** (marcajul dispare la COMMIT): runnerul eșuează și **nu înregistrează**, dar ce era înainte de `END;` rămâne comis. Testat ca mutant; regula de review: niciun `END;` în afara corpurilor `$…$`.
- Dacă apare totuși „aplicat, neînregistrat” (ex. livrare manuală), conform verdictului: stop, reconciliere prin verificări read-only (amprentele din pasul de sanity), fără rollback tehnic pentru a alinia istoricul.

**d) Harness (`scripts/test_sec_rsvti.sh, pasul 6 rescris + pasul S`), traseul real, pe o bază auxiliară cu `schema_migrations` având coloanele din producție:**

| Test | Rezultat |
|---|---|
| livrare fără eroare | patch + **o** înregistrare (version, name, `statements[1]` = fișierul octet cu octet) |
| reluare după succes (altă versiune) | refuz „deja înregistrată”, tot anulat, `pg_dump` identic, tot 1 înregistrare (fără dublare) |
| `1/0` după prima schimbare · `1/0` în postcondiție | stare inițială (`pg_dump` identic), 0 înregistrări |
| **eroare injectată CHIAR la `INSERT`-ul în `schema_migrations`** (trigger BEFORE INSERT care verifică întâi că patch-ul e instalat în tranzacție — deci toate postcondițiile și garda de final au trecut — apoi `RAISE`) | definiții/politici/ACL inițiale (`pg_dump` identic), **0 înregistrări** |
| reluarea permisă după eșecul înregistrării | patch + exact o înregistrare |
| fișierul singur (5 variante de mai sus) | refuzat de garda de start, fără urme |
| fișier cu `COMMIT;` / `select 1; commit ;` | runnerul refuză înainte de conexiune |
| fișier cu `END;` la nivel de instrucțiune | garda de final eșuează, neînregistrat (limita 2) |

Rezultat: `bash scripts/test_sec_rsvti.sh` (PGDATA_TEST=/tmp/pg_livr4_rsvti/data PGPORT_TEST=5617), de 2 ori: **393 aserțiuni OK + 68 verificări negative/fără urme/statice, exit 0** de fiecare dată.

**Mutanți (runda 4):** harness-ul complet, câte o rulare per mutant (`MIGRARE_FISIER` / `ROLLBACK_FISIER` / `LIVRARE_FISIER`): **26/26 prinși** — cei 11 mutanți r3 ai migrării (M08 „fără BEGIN/COMMIT” e retras: acum e starea corectă) și 7 ai rollback-ului, re-generați pe noul fișier; plus noii: migrare fără garda de start / fără garda de final / cu fișierul r3 (BEGIN/COMMIT) → pasul S; garda fără txid → 6.5 (marcaj de sesiune); runner cu înregistrarea în tranzacție separată → **6.3 (eroare la INSERT: urmă rămasă)**; runner fără `--single-transaction` → 6.1; fără refuzul „deja înregistrată” → 6.2; fără refuzul controlului de tranzacție → 6.6.

**Rămâne deschis:** GO Copilot pe runda 4 (diff-ul efectiv: migrare + `scripts/livrare_migrare.sh` + harness) și acordul lui Răzvan; accesul `psql` + URI pentru operator; rularea pe PG17 (producția) rămâne neverificată local — refuzul e fail-closed (§ amprente).

## 14. Runda 5 — runner (răspuns la verdictul Copilot R4, `docs/LIVRARE_MIGRARE_VERDICT_COPILOT_R4.md`)
Verdict R4: NO-GO pe `scripts/livrare_migrare.sh` ca standard comun (filtrul textual spart, TOCTOU, `"$@"` liber la psql, „cod ≠0 = nimic comis” prea tare, unicitate dedusă din IF EXISTS). **Migrarea RSVTI e neschimbată** (sha256 `ed16a2d936cd9ca83e1beddcabab39d95ddad6c8135403ba9746c34939cb30ac`; gărzile de start/final rămân). S-a refăcut doar runnerul; nimic aplicat, nimic pushat.

**Domeniul standardului:** doar operațiile migrării care participă la tranzacția PostgreSQL. `--single-transaction` NU anulează efecte externe/netranzacționale (`CREATE INDEX CONCURRENTLY`, `VACUUM`, `dblink`, notificări trimise, secvențe avansate) — asemenea operații nu au loc în acest format.

**Limită de încredere (declarată):** marcajul `gazpet.livrare_migrare` + gărzile sunt o gardă de **protocol**, nu o autorizație și nici o protecție împotriva administratorului bazei. Un operator privilegiat care le ocolește deliberat (marcaj pus manual, `psql` direct) nu e oprit. Diferit de acceptarea **accidentală** a unui `END;`, care acum e refuzată înainte de conexiune.

**a) Validator real — `scripts/livrare_validator.py`** (Python 3 stdlib, nicio dependență nouă; sha256 `121827e3fa4b…`). Tokenizer lexical: comentarii `--` și `/* */` imbricate, `'…'` (cu `''`), `E'…'` (escape `\`), `"…"`, dollar-quoting `$tag$…$tag$` (deci corpurile PL/pgSQL). Pe codul de nivel superior: împarte la `;` și refuză instrucțiunile care încep cu BEGIN / START / COMMIT / END / ROLLBACK / ABORT / SAVEPOINT / RELEASE / PREPARE TRANSACTION (COMMIT/ROLLBACK PREPARED incluse); refuză **orice backslash** (meta-comenzi psql, oriunde pe linie: `\i`, `\c`, `\set`, `\g`, `\!`) și interpolarea de variabile psql (`:var`, `:'var'`; `::` permis); cere garda `'gazpet.livrare_migrare'`. Literal/comentariu/dollar-quote neterminat, non-UTF-8, NUL, fișier ilizibil, orice excepție ⇒ **refuz** (fail-closed; runnerul tratează orice cod ≠0 drept refuz, fără pipeline ⇒ fără SIGPIPE/141). Limită conștientă: corpurile SQL-standard `BEGIN ATOMIC … END` sunt refuzate (se folosesc `$$…$$`). Acceptate (verificat): RSVTI 20261003c, 20261003e (#541), 20261003d (#540), 20261003b (#537), 20261001a (J05).

**b) Identitatea artefactului.** Copie unică: `mktemp -d` (700) + fișier `chmod 400`; sha256(copie) comparat cu sha256-ul **aprobat** dat explicit (`--sha256 <hex64>` sau `--aprobare <fișier sha256sum>`). ACEEAȘI copie: validare, `psql -f`, `statements`. În tranzacție, după INSERT: `sha256(statements[1]) == sha256 aprobat`, altfel ROLLBACK.

**c) Argumente — listă albă.** `--migrare --sha256|--aprobare --versiune --tinta-db [--tinta-sistem --host --port --user --service]`, fiecare validat pe regex (fără `=`/spații ⇒ nu pot deveni conninfo/URI). Orice altceva (`-v ON_ERROR_STOP=0`, `-f`, `-c`, `--set`, `-d <URI>`, `--`) ⇒ refuz **înainte de conexiune** (cod 2). Respinse și `PGPASSWORD`, `PGOPTIONS`, `PGDATABASE`, `PSQLRC`. **Parola:** niciodată pe linia de comandă sau în chat — `~/.pgpass` (chmod 600) / `PGPASSFILE`, sau `PGSERVICE` + `pg_service.conf` (`--service`).

**d) Ordinea în tranzacție (psql -X -v ON_ERROR_STOP=1 --single-transaction):** (1) `pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'))` — PRIMA; (2) **confirmarea țintei**: `current_database() = --tinta-db` și, opțional, `pg_control_system().system_identifier = --tinta-sistem`; (3) istoric: refuz dacă **numele** SAU **versiunea** există deja; (4) marcajul legat de txid; (5) copia; (6) INSERT + verificarea sha. Totul înainte de DDL până la pasul 5.

**e) Rezultat — 3 stări** (după o reconciliere read-only pe conexiune nouă, care ia întâi același lock consultativ ⇒ tranzacția livrării s-a terminat):

| Cod | Stare | Criteriu |
|---|---|---|
| 0 | APLICAT + ÎNREGISTRAT confirmat | rând name+version cu sha256(statements[1]) = aprobat (chiar dacă psql a pierdut confirmarea) |
| 10 | NEAPLICAT confirmat | niciun rând name+version (înregistrarea e în aceeași tranzacție ⇒ nimic comis) și psql a raportat eroare |
| 20 | NECUNOSCUT | reconcilierea nu poate stabili starea ⇒ **fără retry, fără rollback automat**; se rulează manual interogarea read-only tipărită + amprentele obiectelor (§12: `md5(prosrc)` RPC/helper, politica jurnalului) |
| 2 / 3 | refuz argumente / artefact-validator | înainte de orice conexiune |

**f) Harness — pasul 6 rescris** (`scripts/test_sec_rsvti.sh`; PGDATA_TEST=/tmp/pg_sec_rsvti_r5, port 5713): 6.0 validator (35 refuzuri: `END;`, `SELECT '--'; COMMIT;`, `\i`, `\c`, `\set`, `SELECT 1 \g`, `:var`, BEGIN ATOMIC, neterminate…; 11 acceptări: `END` în corp `$f$`, COMMIT în literal/comentariu/dollar-quote imbricat…; + migrările PR-urilor paralele); 6.1–6.4 succes / reluare / erori injectate inclusiv la INSERT / reluare după eroarea de înregistrare; 6.5 fișierul fără runner; 6.6 12 mutanți de fișier + `COMMIT;` cu ~2 MB după (fostul 141) ⇒ cod 3, **psql nepornit** (santinelă), `pg_dump` identic, 0 înregistrări; 6.7 sha greșit / sursă modificată ⇒ 3; **TOCTOU**: clientul modifică sursa după pregătire ⇒ se execută + înregistrează copia aprobată (`statements` == copia); `--aprobare`; 6.8 7 opțiuni nepermise, `--host` cu conninfo, 4 variabile, versiune invalidă ⇒ 2 fără conexiune; `--tinta-sistem` greșit ⇒ 10 fără urme, corect ⇒ 0; 6.9 COMMIT reușit + confirmare pierdută ⇒ **0 (nu „nimic comis”)**, pierdere înainte de server ⇒ 10, reconciliere imposibilă ⇒ **20** și o reluare ulterioară refuzată fără dublare; 6.10 **două procese reale concurente**, același nume, versiuni diferite ⇒ exact unul 0, celălalt 10, o înregistrare, un singur efect; versiune refolosită ⇒ 10; 6.11 mutanți: fără advisory lock (⇒ 2 înregistrări), fără comparația sha, sursa în loc de copie (TOCTOU), fără validator, argumente libere, validator fără END, validator fără literali — **7/7 prinși**.

Simularea pierderii conexiunii e un client-wrapper (rulează real, raportează cod 2) — pierderea reală de rețea nu e reprodusă, dar reconcilierea nu depinde de cauză.

Rezultat: de 2 ori, **393 aserțiuni OK + 142 verificări negative/fără urme/statice/mutanți, exit 0**. Runner sha256 `0363dae0d1ab…`.

**Rămâne deschis:** GO Copilot pe runda 5 și acordul lui Răzvan; operatorul cu `psql` ≥ 16 + `.pgpass`/service; PG17 (producția) neverificat local — orice diferență e refuz fail-closed.

## 15. Runda 6 — runner (răspuns la verdictul Copilot R5, `docs/LIVRARE_MIGRARE_VERDICT_COPILOT_R5.md`)
Verdict R5: NO-GO ca standard comun, **arhitectura rundei 5 se păstrează** (copia aprobată + sha, lista albă, înregistrarea în tranzacție, starea NECUNOSCUT). S-au închis cele 4 blocante. **Migrarea RSVTI e neschimbată** (sha256 `ed16a2d936cd…`). Nimic aplicat pe live, nicio conexiune la Supabase, nimic pushat.

**1. Lexic (validator + prolog).**
- `--` se termină la LF **sau CR** (PostgreSQL: `newline = [\n\r]`); spațiul alb = exact setul PostgreSQL `[ \t\n\r\f\v]`. `SELECT 1; -- c<CR>COMMIT;` ⇒ refuz.
- **Invarianță la `standard_conforming_strings`**: orice backslash într-un literal obișnuit `'…'` (inclusiv `U&'…'`) ⇒ refuz; literalii cu backslash se scriu `E'…'` (interpretați identic în ambele moduri). Fără backslash în `'…'`, împărțirea textului e aceeași cu `on` și cu `off` — deci nicio setare venită din conexiune (ALTER ROLE/DATABASE … SET, serviciu) și nicio schimbare dinamică (ex. `set_config('standard_' || 'conforming_strings', …)` într-un corp `$$`) nu poate face serverul să vadă altceva decât validatorul. Corpurile `$…$` nu sunt afectate (dollar-quoting ignoră backslash-ul).
- Refuz oriunde în fișier (inclusiv comentarii/corpuri) a numelor `standard_conforming_strings`, `client_encoding`, `escape_string_warning`, `backslash_quote`. La nivel superior: refuz `RESET` (orice, inclusiv `RESET ALL`), `SET NAMES/SCHEMA/TRANSACTION/SESSION CHARACTERISTICS`, `SET` pe parametrii lexicali, `set_config(…)` cu primul argument nedeterminat sau protejat (inclusiv `search_path`). **`search_path` — subset verificat:** acceptat DOAR `SET LOCAL search_path = public, pg_temp` (forma folosită în #541, #540, J05); orice altă formă ⇒ refuz. `SET search_path` ca atribut de funcție (`CREATE FUNCTION … SET search_path = …`) nu e instrucțiune de nivel superior ⇒ neafectat.
- **Prolog generat de runner** (`0_prolog.sql`, primul `-f`, nu din migrare): `SET TRANSACTION ISOLATION LEVEL READ COMMITTED; SET LOCAL standard_conforming_strings = on; SET LOCAL client_encoding = 'UTF8';` + un `DO` care verifică toate trei; în plus `PGCLIENTENCODING=UTF8` la conexiune (parametru de pornire ⇒ prioritate față de setările rolului/bazei; și valoarea la care ar readuce un `RESET`).
- **Garda**: validatorul cere un **apel real** `current_setting('gazpet.livrare_migrare' …)` în cod — la nivel superior sau într-un corp `$…$` analizat lexical; comentariu / literal izolat / comentariu în corp ⇒ refuz. Este o verificare de **prezență**; poziția și logica gărzilor (prima/ultima, ce refuză) rămân parte din **review-ul artefactului aprobat**.

**2. Identitatea țintei — și la reconciliere.** `--tinta-sistem <system_identifier>` e **OBLIGATORIU** (lipsă ⇒ refuz 2 fără conexiune); `--tinta-proiect` opțional (compară `current_setting('gazpet.proiect_aprobat')`, un marcaj de bază ce ar trebui pus pe live printr-o operație separată aprobată — **neactivat**). Aceeași interogare read-only e folosită ca **pre-verificare** (înainte de livrare) și **reconciliere** (după): întoarce `db|system_identifier|proiect|relevante|exacte`, iar runnerul compară ținta de fiecare dată. Ținta greșită ⇒ **22**, niciodată 0. De verificat read-only pe live înainte de prima livrare reală: că rolul operatorului poate apela `pg_control_system()` și valoarea `system_identifier` (intră în aprobare).

**3. Izolare.** `SET TRANSACTION ISOLATION LEVEL READ COMMITTED` e **primul** în tranzacția principală și în reconciliere (`…READ COMMITTED, READ ONLY`); lock-ul consultativ e o instrucțiune **separată**, înaintea interogării istoricului ⇒ după obținerea lock-ului istoricul e citit cu snapshot nou. Nu depinde de `default_transaction_isolation`.

**4. Clasificare** (relevante = nume SAU versiune; exacte = nume + versiune + sha aprobat; conflicte = relevante − exacte):

| Cod | Stare | Criteriu |
|---|---|---|
| 0 | APLICAT + ÎNREGISTRAT | după livrare: exact 1 relevant și el e perechea exactă. Dacă psql a raportat eroare: „aplicat de această execuție (confirmare pierdută) sau de o livrare concurentă a aceluiași artefact” — **nu** se presupune automat confirmare pierdută |
| 10 | NEAPLICAT confirmat | 0 rânduri relevante pe ținta confirmată și psql a raportat eroare |
| 11 | DEJA ÎNREGISTRATĂ | la pre-verificare: exact perechea aprobată ⇒ „… e deja înregistrată cu artefactul aprobat (sha256 …); nu s-a reaplicat.” — livrarea nu se trimite |
| 12 | NEPORNIT | pre-verificarea n-a putut rula ⇒ nimic trimis |
| 20 | NECUNOSCUT | reconcilierea imposibilă (sau psql „succes” fără înregistrare) ⇒ fără retry, fără rollback automat |
| 21 | CONFLICT | orice alt istoric relevant (alt nume/versiune/sha, dubluri) — la pre-verificare (nimic trimis) sau după livrare ⇒ reconciliere manuală, fără retry |
| 22 | ȚINTĂ NECONFIRMATĂ | pre-verificarea sau reconcilierea a ajuns pe altă țintă |
| 2 / 3 | refuz argumente / artefact-validator | înainte de orice conexiune |

**Harness** (`scripts/test_sec_rsvti.sh`; PGDATA_TEST=/tmp/pg_sec_rsvti_r6, port **5823**; clusterul B `/tmp/pg_sec_rsvti_r6_b`, port 5824, oprit la final). Păstrate: toate testele rundei 5, inclusiv **eroarea chiar la INSERT-ul înregistrării** (6.3/6.4); ajustate la noile coduri (reluare cu altă versiune ⇒ 21; concurență ⇒ 0 + 21).
- 6.0: 60 refuzuri (noi: 3 cazuri CR, cele 2 probe din verdict, backslash în `'…'`/`U&'…'`, parametrii lexicali în SET/set_config/comentariu/literal/corp, RESET, SET NAMES/SCHEMA/TRANSACTION, search_path în alte forme, set_config dinamic) / 17 acceptări (noi: forma verificată search_path, `SET LOCAL lock_timeout`, set_config pe `gazpet.*`, `E'…'` cu backslash, CRLF, backslash în literal din corp `$$`); 6.0g garda: 5 refuzuri / 3 acceptări. Migrările #537, #540, #541, J05 și RSVTI — **acceptate** (doar citire).
- 6.6: + mutanții de fișier CR și cele 2 probe din verdict ⇒ cod 3, psql nepornit.
- 6.12 (conexiune „ostilă”: `ALTER DATABASE … SET standard_conforming_strings = off, client_encoding = 'LATIN1', default_transaction_isolation = 'repeatable read'`, verificată): probele din verdict (cu și fără SET) și CR ⇒ refuz înainte de conexiune, `t_atac` absent; sonda din migrare vede `on|UTF8|read committed`, `E'a\\b'` = `a\b`; migrarea RSVTI ⇒ 0, `statements` = artefact octet cu octet; **starea finală** cu validatorul slăbit (fără regula backslash): runnerul real ⇒ 10, `t_atac` absent; mutantul fără prologul scs ⇒ `t_atac` **comis** (prins pe stare, nu pe cod).
- 6.13 (`ALTER SYSTEM SET default_transaction_isolation = 'repeatable read'`): T1 — livrarea care a trecut de pre-verificare și așteaptă lock-ul vede COMMIT-ul precedent ⇒ A=0, B=21, 1 înregistrare, 1 efect; T2 — reconcilierea (pre-verificarea) pornită cât livrarea ține lock-ul ⇒ după COMMIT: 11 cu mesajul exact; două procese simultane ⇒ 0 + 21. Mutanți: fără RC în tranzacția principală (⇒ 2 înregistrări), fără RC în reconciliere (⇒ 0 în loc de 11), lock în același SELECT cu istoricul (⇒ 0) — **prinși**. Izolarea implicită se readuce la final (și la pornirea harness-ului).
- 6.14 (2 clustere, aceeași bază, `system_identifier` diferit; pe B perechea exactă): control — cu identitatea lui B ⇒ 11; W1 conexiune la B cu identitatea aprobată A ⇒ **22**, nimic trimis; W2 reconcilierea redirecționată spre B după livrarea reală pe A ⇒ **22**, nu 0; `--tinta-proiect` greșit ⇒ 22 fără urme, corect ⇒ 0. Mutanți: fără verificarea țintei (W1 ⇒ 11, W2 ⇒ 0), doar `current_database()`, `--tinta-sistem` opțional — **prinși**.
- 6.15: același nume/altă versiune, aceeași versiune/alt nume, perechea exactă + alt rând cu același nume, nume+versiune cu alt sha ⇒ **21**, nimic trimis, istoricul și `pg_dump` neschimbate; perechea exactă preexistentă și **reluarea exactă după succes** ⇒ **11** (mesajul verificat pe linie întreagă); dublură apărută între livrare și reconciliere ⇒ 21. Mutanți: formula r5 (numără doar perechea), 11 la „≥1 exactă”, 0 la „≥1 exactă”, fără pre-verificare — **prinși**.
- 6.16: mutanți de validator — fără CR, fără regula backslash, fără parametrii lexicali, fără verificarea SET, fără set_config, fără subsetul search_path, garda textuală — **7/7 prinși** (plus v_end, v_lit din r5).

Rezultat: suita completă de **2 ori, exit 0** (393 aserțiuni OK + 192 verificări negative/fără urme/statice/mutanți). Validator sha256 `fa42296190fc…`, runner `1e1459f1fc41…`.

**Limite declarate (neschimbate):** domeniul = doar operații tranzacționale PostgreSQL; marcajul/garda = protocol, nu autorizație; PG17 (producția) neverificat local — orice diferență e refuz fail-closed. **Rămâne deschis:** GO Copilot pe runda 6 și acordul lui Răzvan; verificarea read-only pe live a `pg_control_system()` pentru rolul operatorului.

## 16. Runda 7 — runner (răspuns la verdictul Copilot R6, `docs/LIVRARE_MIGRARE_VERDICT_COPILOT_R6.md`)

Doar cele 3 blocante; arhitectura și restul regresiei (inclusiv eroarea injectată chiar la INSERT-ul înregistrării) neschimbate.

1. **COPY** — validatorul refuză ORICE instrucțiune de nivel superior care conține `COPY` (FROM STDIN, TO STDOUT, PROGRAM,
   fișier), înainte de conexiune (cod 3). Nu se încearcă modelarea formatului de date COPY. Migrările actuale (RSVTI,
   trezorerie, concediu, ofertare, J05) nu folosesc COPY — rămân acceptate. Test 6.17: fragmentul exact din verdict, între
   gărzi ⇒ refuz 3, psql nepornit, `proba_livrare_copy` absentă, 0 înregistrări. Control dinamic: cu validatorul slăbit
   (regula COPY scoasă) runnerul real lasă tabela **comisă** (rândul `$date$`, COMMIT executat de psql) și raportează 10 —
   deci regula e cea care oprește atacul, iar verificarea se face pe starea finală, nu pe exit code.
2. **Configurare** — `set_config`: apelul e recunoscut în orice formă (`set_config`, `pg_catalog.set_config`,
   `"set_config"`, `pg_catalog."set_config"`, `"pg_catalog"."SET_CONFIG"`); primul argument COMPLET, până la virgula de nivel 0,
   trebuie să fie UN literal static simplu `'…'` (fără E/U&, cast, concatenare, literal continuat, `$…$`) ⇒ altfel refuz.
   `SET`: numele e parsat ca ident(.ident)*, normalizat (neciat ⇒ lower, citat ⇒ exact, calificări unite), iar comparația
   cu parametrii protejați e fără majuscule (ca `guc_name_compare` din PostgreSQL) și pe ultima componentă; după nume se
   cere `=`/`TO`/`FROM CURRENT` — orice altă sintaxă (SET ROLE, SESSION AUTHORIZATION, TIME ZONE, CONSTRAINTS…) ⇒ refuz.
   Cele 3 exemple din verdict sunt refuzate (6.0 și 6.18, prin runner, fără urme); `SET LOCAL search_path = public, pg_temp`,
   `set_config('gazpet.…', <expresie>, true)` și `current_setting('gazpet.…')` rămân acceptate (6.18: APLICAT).
   Delimitare păstrată: corpurile dinamice / funcțiile apelate rămân în review-ul artefactului; validatorul nu e sandbox.
3. **Instanța autoritativă** — aprobarea țintei = `--tinta-db` + `--tinta-sistem` + **endpointul de scriere**
   `--tinta-host` + `--tinta-port` (acum OBLIGATORII; fostele `--host/--port` au dispărut; `PGHOSTADDR`,
   `PGTARGETSESSIONATTRS` refuzate). Pre-verificarea, tranzacția principală (în `1_pre`) și reconcilierea cer
   `pg_is_in_recovery() = false`; altfel 22 (pre-verificare/reconciliere) sau refuz explicit în tranzacție. Limită: un
   `--service` cu `hostaddr` în pg_service.conf rămâne responsabilitatea operatorului (host/port explicite au prioritate).
   Test 6.19 cu **replică fizică reală** (pg_basebackup -R din clusterul A, port 5903, `pg_wal_replay_pause()`; același
   nume de bază și același system_identifier verificate): R1 endpoint = replica ⇒ 22, nimic trimis; R2 livrare pe primar
   + confirmare pierdută + reconciliere redirecționată la replica întârziată (0 rânduri) ⇒ **22, niciodată 10**; R2b idem
   cu psql 0 ⇒ 22; R3 tranzacția principală pe replică ⇒ „instanța e în recovery”, primarul confirmă 0 ⇒ 10.

Mutanți noi, toți prinși: runner — fără in_recovery la reconciliere (dă 10 fals, exact scenariul din verdict), fără
verificarea din tranzacția principală, `--tinta-host` opțional; validator — fără regula COPY, set_config pe primul token,
set_config citat nerecunoscut, comparație GUC sensibilă la majuscule, SET nerecunoscut acceptat.

Porturi: A 5901, B 5902, replica 5903 (`/tmp/pg_sec_rsvti_r7*`). Suita completă rulată de 2 ori, exit 0:
`PASS test_sec_rsvti: 393 aserțiuni OK + 225 verificări negative/fără urme/statice OK`. PG17 tot neverificat local.
NEAPLICAT pe live, nepushat.

## 17. Runda 8 — runner (răspuns la verdictul Copilot R7, `docs/LIVRARE_MIGRARE_VERDICT_COPILOT_R7.md`)

Un singur blocant + condițiile operaționale; arhitectura și regresia rundelor 4–7 neschimbate.

1. **Identificatori Unicode `U&"…"`** — tokenizerul validatorului refuză la nivel superior orice ghilimea (`"` sau `'`)
   precedată de tokenii `U`, `&` (cuvintele sunt normalizate la majuscule ⇒ și `u&`; comentariile/spațiile sunt sărite ⇒
   și `U& /* c */ "…"`, fail-closed chiar dacă PostgreSQL n-ar lega acolo prefixul), indiferent de conținut și de
   calificare (`pg_catalog.U&"…"`, `"pg_catalog".U&"…"`). Plus: cuvântul `UESCAPE` la nivel superior ⇒ refuz. Fără listă de
   escape-uri (`\005F` nu e tratat special). Corpurile `$…$` nu sunt afectate (nu sunt nivel superior; revin review-ului).
   **Decizia la `U&'…'` (literal):** refuzat la fel, la nivel superior. Motiv: valoarea lui se decodifică în server, deci un
   `set_config(U&'search\005Fpath', …)` sau orice alt argument comparat de validator ar fi verificat pe alt text decât cel
   executat; regula `set_config` cerea deja un literal simplu `'…'`, dar refuzul general e mai simplu și nu depinde de
   poziție. Niciuna din migrările aprobate nu folosește `U&` / `UESCAPE` (verificat).
2. **Condiții operaționale (implementate în runner, înainte de conexiune):**
   * `PGSERVICE`, `PGSERVICEFILE`, `PGSYSCONFDIR` moștenite din mediu ⇒ refuz 2 (serviciul se dă DOAR prin `--service`).
   * `--service S` ⇒ se citește configurația EFECTIVĂ în ordinea libpq (`~/.pg_service.conf`, apoi
     `$(pg_config --sysconfdir)/pg_service.conf` doar dacă S nu e în fișierul utilizatorului); secțiunea poate conține
     numai chei pe listă albă (host, port, dbname, user, ssl*, connect_timeout, application_name, passfile, keepalives*);
     `hostaddr`, `options`, `target_session_attrs`, `service`, orice altceva ⇒ refuz 2; serviciu negăsit / sysconfdir
     nedeterminabil ⇒ refuz 2. host/port/dbname rămân suprascrise de `--tinta-host/--tinta-port/--tinta-db`.
     `PGHOSTADDR` era deja refuzat ⇒ endpointul efectiv = cel aprobat (precondiție verificată, nu doar declarată).
   * **`pg_control_system()`** — pre-verificarea (read-only) cere întâi `has_function_privilege(…, 'EXECUTE')`; lipsa
     dreptului ⇒ NEPORNIT 12 cu mesaj explicit, nimic trimis. Nu există cale de relaxare.
   * **PG17** (producția) rămâne neverificat local (clusterele de test sunt PG16) — consemnat.

**Teste noi** (`scripts/test_sec_rsvti.sh` 6.0, 6.21–6.23): 6.0 — 12 cazuri U&/UESCAPE refuzate (probele din verdict,
`u&`, comentariu/linie nouă între U& și ghilimele, `U&'…'` în argument), 3 acceptate (`a & b`, identificatorul citat
`"U&"`, U& în corp `$$`); migrările #537/#538/#540/#541/#542 acceptate. 6.21 — cele 4 probe (2 principale, UESCAPE '!',
`"pg_catalog".`) livrate prin runner între gărzi ⇒ refuz 3, psql nepornit, `t_uni` absentă, 0 înregistrări, pg_dump
identic; formele aprobate (`SET LOCAL search_path = public, pg_temp` + `set_config('gazpet.…')` static) ⇒ APLICAT +
înregistrat. 6.22 — control dinamic direct pe PG local, fără validator: toate 3 formele schimbă `search_path`, forma
concatenată pune `client_encoding = LATIN1` (blocantul era real); validator slăbit + runner real ⇒ migrarea APLICATĂ cu
`search_path = public,pg_catalog`; mutanții „fără regula U&” și „fără UESCAPE” prinși. 6.23 — PGSERVICE/PGSERVICEFILE/
PGSYSCONFDIR ⇒ refuz 2; `--service` cu hostaddr / options / inexistent ⇒ refuz 2; `--service` curat ⇒ APLICAT; rol fără
drept pe `pg_control_system()` ⇒ 12 explicit, fără urme; mutantul fără verificarea dreptului prins.

Suita completă rulată de 2 ori, exit 0: `PASS test_sec_rsvti: 393 aserțiuni OK + 253 verificări negative/fără urme/statice OK`.
NEAPLICAT pe live. **Rămâne deschis:** GO Copilot pe runda 8 și acordul lui Răzvan; verificarea pe live (read-only) a
dreptului rolului operatorului pe `pg_control_system()`; PG17.
