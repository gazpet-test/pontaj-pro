# SEC trezorerie — patch `20261003e_sec_trezorerie` (NEAPLICAT, doar local)

> Copilot a dat **GO DOAR PREGĂTIRE** pe acest domeniu, izolat: „matricea țintă de citire/scriere trebuie aprobată explicit; nu deduceți dreptul de modificare doar din dreptul de vizualizare”.
> **Runda 2 (30.09): răspuns la verdictul Copilot „GO CU CORECTURI” pe 877919e — §10.** Formulările de mai jos au fost corectate conform verdictului (fără „protecție completă”, fără „regresie zero”). Tiparul de livrare (runda 4) e portat doar ca gărzi în fișier; runnerul comun e NO-GO la Copilot r4 și se reface în runda 5 (§11).
> Nimic din acest document nu s-a aplicat în producție. Investigația din BD (29.09.2026, proiect `dxczwkbciseqniprspcu`) a fost strict read-only: cataloage, numărători agregate și jurnalele gateway-ului API. **Niciun IBAN, sold sau altă valoare din tabele nu apare aici.**

## 1. Gaura: structurală, nu abuz demonstrat

| Tabel | Rânduri | Politica de azi | Efect |
|---|---|---|---|
| `trezorerie_conturi` (IBAN, cont intern, beneficiar, contract) | 33 | `trez_conturi_rw` FOR ALL TO authenticated USING/WITH CHECK `(auth.uid() IS NOT NULL)` | orice cont logat (31 de conturi auth, 29 non-owner) **citește, modifică și șterge** |
| `trezorerie_extras_linii` (solduri și rulaje din extras) | 33 | `trez_linii_rw`, identică | idem; ștergerea unui cont șterge în cascadă liniile lui |

- Tabelul `trezorerie_extras` nu există. Numele real e `trezorerie_extras_linii`, copilul prin FK (`ON DELETE CASCADE`) al lui `trezorerie_conturi`.
- ACL-urile de azi: `anon` și `authenticated` au `arwdDxtm` (inclusiv TRUNCATE, care ocolește RLS), iar pe secvențe au `rwU`. Pe tabele nu există triggere, granturi pe coloane sau view-uri dependente.
- Originea: migrarea `20260915200036 trezorerie_conturi_si_extrase`, aplicată prin MCP, nu e în repo. Datele au intrat printr-un import unic pe 15.09 (33 INSERT pe fiecare tabel), urmat de 16 UPDATE de împerechere. Contoarele `pg_stat_user_tables` nu arată niciun DELETE — **limită**: contoarele nu sunt un jurnal imuabil (se pot reseta, nu supraviețuiesc tuturor evenimentelor) și nu atribuie operatorul.
- **Nu există abuz demonstrat.** În jurnalele gateway-ului API, din 14.09 23:15 UTC până pe 29.09 23:14 UTC (toată viața tabelelor, 15 ferestre de 24h), sunt **0 cereri** cu `trezorerie` în cale sau în query string. Asta include REST direct și embedding. Nu există nici trafic GraphQL, iar `pg_graphql` nu e instalat. Limite: conexiunile SQL directe (pooler/5432) nu apar în acele jurnale; absența numelui tabelului din URL-uri **nu exclude accesul indirect printr-un RPC** (o funcție apelată prin `/rpc/…` poate citi/scrie tabelul fără ca numele lui să apară în cale).

## 2. Actorii legitimi (dovezi)

| Actor | Ce face azi | Dovadă |
|---|---|---|
| Ecrane UI | **Niciunul** nu citește și nu scrie aceste tabele (0 referințe în `src/` pe toate branch-urile remote) | `git grep trezorerie_conturi\|trezorerie_extras` pe `origin/*`: doar docs |
| Registrul de garanții (vecinul funcțional) | citește `v_garantii_situatie` / `v_garantii_plafon_emitent`, scrie `garantii`, apelează RPC-ul `garantii_adresa_eliberare`; fără join la trezorerie | `src/GarantiiRegistru.jsx:42`, `:101-102`, `:118` |
| Poarta modulului Financiar (citire) | `/financiar` = `is_owner` SAU modulul `financiar[.*]` în `user_module_access` | `src/App.jsx:106-113`, `:998`, `:8586` |
| Scrierea în UI Financiar | `is_owner` SAU rol `superadmin`/`contabilitate` | `src/Financiar.jsx:1312-1313`, tab-urile GBE/Registru `:1429-1430` |
| Flagul financiar din BD | `can_access_financiar` (owner-only, protejat de `enforce_owner_only_salary_flags`) e precedentul BD pentru „financiar” | `fn_ai_inbox_poate_confirma` (`p_modul='financiar'` → `can_access_financiar`) |
| Edge / cron / RPC | niciun edge din repo, niciun cron (0 din 51) și nicio funcție nu atinge tabelele. `garantii_alerte` citește doar `garantii` | `pg_proc.prosrc`, `cron.job` (doar numărători), `supabase/functions/` |
| Claude prin MCP (`postgres`, BYPASSRLS) | importul și împerecherea din 15.09 | `pg_stat_user_tables`; neafectat de patch |
| `service_role` (BYPASSRLS) | nicio utilizare azi; neafectat | testat local |

**Numărători de azi (fără nume):** 31 de profiluri, dintre care 2 owneri. **`can_access_financiar` = 0 profiluri** (nici ownerii nu îl au). Modulul `financiar` îl au 4 non-owneri, toți cu rol de scriere în UI. Rolurile `superadmin`/`contabilitate` le au 7 non-owneri, dintre care 3 fără modulul financiar. Modulele administrativ/execuție/ofertare le au 17 non-owneri, dintre care 13 fără nimic financiar.

## 3. Matricea țintă: decizie pentru Răzvan (citire și scriere separat)

| Variantă | CITIRE | SCRIERE | Cine pierde față de azi | Ecrane afectate |
|---|---|---|---|---|
| **A (recomandată)** | owner + `can_access_financiar` | owner + `can_access_financiar` (decizie separată, alt helper) | 29 de non-owneri pierd citirea și scrierea, inclusiv cei 4 cu modul financiar. Azi rămân **doar cei 2 owneri**, pentru că nimeni nu are flagul. Accesul se dă ulterior punând flagul (owner-only) | **niciunul** (nu există consumator UI) |
| B | owner + flag + modulul `financiar` (4 non-owneri) | owner + flag | 25 pierd citirea; 29 pierd scrierea | niciunul |
| C | owner + flag + modulul `financiar` + rol `superadmin`/`contabilitate` (7 non-owneri) | owner + flag + modulul `financiar` la nivel editor/admin (4) | 22 pierd citirea; 25 pierd scrierea | niciunul |

**De ce A.** În inventarul verificat nu au fost identificați consumatori afectați (niciun ecran în `src/`, niciun edge din repo, niciun cron, nicio funcție din BD). Inventarul edge-urilor din repo **nu certifică** toate implementările deployate live. Flagul `can_access_financiar` e deja precedentul BD pentru „financiar” și nu se poate auto-acorda. Riscul principal e scrierea: o schimbare de IBAN la un cont GBE e un vector de fraudă, iar ștergerea rupe cascada spre extrase și legătura cu `garantii`. B și C dau acces unor oameni care azi nu-l folosesc prin nicio interfață. Când va exista un ecran Trezorerie, lărgirea citirii înseamnă corpul unui singur helper.

La A seturile de citire și scriere coincid azi, dar sunt **două aprobări distincte, în doi helperi** (`fn_trezorerie_poate_citi` / `fn_trezorerie_poate_scrie`). Invariantul tehnic scriere ⊆ citire e testat: UPDATE/DELETE cu WHERE/RETURNING cer și SELECT.

**Decizii separate pentru Răzvan:**
1. Varianta A/B/C.
2. Cui îi pune `can_access_financiar`, dacă cuiva. E drept de acces, deci cere acord explicit.
3. **`garantii` (§8 R1)**: incident separat PRIORITAR (integritate + RPC + consumatori), nu „da/nu”.
4. **DELETE cu cascadă** — decizie separată de aprobat (§10.1).

## 4. Patch-ul

Fișiere:
- `supabase/migrations/20261003e_sec_trezorerie.sql`: prefixul e liber pe toate branch-urile `origin/*` și în `scratchpad/wt-*`; `20261003d` e rezervat altui agent.
- `supabase/revenire/20261003e_sec_trezorerie_ROLLBACK.sql` + `README.md`.
- Harness și teste: `scripts/test_sec_trezorerie.sh`, `supabase/tests/sec_trezorerie_schelet.sql`, `supabase/tests/sec_trezorerie.test.sql`.

Ce face patch-ul, pe pași:
- **(a)** Runda 4: fără `BEGIN;`/`COMMIT;` în fișier; garda de livrare de start/final (legată de txid) — tranzacția o deține runnerul de livrare (§11). `SET LOCAL search_path = public, pg_temp` face deparse-ul determinist.
- **(b)** Precondiții fail-closed și NULL-safe (`IS DISTINCT FROM`, liste de acceptare, nu de refuz):
  - tabelele există;
  - RLS e activ pe ambele;
  - `auth.uid()` și coloanele din `profiles` există;
  - amprenta completă a politicilor (nume|comandă|permisivă|roluri|md5 USING|md5 WITH CHECK) aparține uneia din exact **două perechi acceptate**: (politicile de azi, helperi absenți) sau (politicile patch-ului, helperi exacți ca md5 `prosrc`, `prosecdef`, `proconfig`, owner `postgres`, volatilitate, limbaj). Orice altă combinație e refuzată, inclusiv o stare mixtă sau un helper cu altă semnătură.
- **Schimbări:**
  - 2 helperi `SECURITY DEFINER SET search_path = public, pg_temp`, cu `EXECUTE` doar pentru `authenticated` (revocat de la PUBLIC/anon/service_role);
  - 4 politici pe tabel (SELECT → citi; INSERT/UPDATE/DELETE → scrie), înfășurate în `(SELECT …)` pentru initPlan;
  - `REVOKE ALL` de la PUBLIC/anon/authenticated (acoperă și MAINTAIN pe PG17), apoi `GRANT SELECT, INSERT, UPDATE, DELETE` pentru authenticated;
  - secvențe: anon fără nimic, authenticated `USAGE, SELECT` (fără `setval`);
  - `service_role` și `postgres` neschimbate.
- **(b2) Runda 2:** precondiția compară starea **completă** (§10.2) și invarianții sursei drepturilor (§10.3).
- **(c)** Postcondiție **înainte de garda de final și de COMMIT-ul runnerului** (runda 2: plus amprenta completă exactă și service_role înainte/după, §10.2):
  - amprenta politicilor;
  - RLS activ;
  - zero granturi pe coloane;
  - grantee-i ⊆ {postgres, service_role, authenticated};
  - **privilegii efective** `has_table_privilege` / `has_any_column_privilege` / `has_sequence_privilege` / `has_function_privilege` pentru `anon`, `public`, `authenticated`, `service_role` (MAINTAIN verificat doar pe ≥ PG17);
  - atributele exacte ale helperilor.

## 5. Revenirea

Fișierul nu are BEGIN/COMMIT. Operatorul trimite un singur string:
`BEGIN; SELECT set_config('gazpet.rollback_tehnic_20261003e', 'REDESCHIDE_TREZORERIE:' || txid_current(), true); <fișier> COMMIT;`

- Armarea e legată de `txid_current()`.
- Refuză armarea persistentă (`pg_db_role_setting`, prin `lower()`, deci și cu majuscule).
- Pornește doar din starea exactă a patch-ului și refuză dacă helperii au alte dependențe.
- Are postcondiție și se dezarmează în aceeași tranzacție.
- **Redeschide** citirea și scrierea pentru orice cont logat (politicile de azi, identice). **Nu readuce** privilegiile anon, TRUNCATE/REFERENCES/TRIGGER/MAINTAIN sau `setval`, pentru că niciun flux nu le folosește. E aceeași regulă pe care Copilot a cerut-o la #537/#538: revenirea păstrează protecțiile care nu afectează funcționalitatea.
- **Nu e un model de revenire sigură** (verdict §3): redeschide exact citirea/scrierea neautorizată reparată. Rămâne **artefact tehnic excepțional**, fără GO de execuție, **nu revenire operațională** — faptul că păstrează REVOKE TRUNCATE nu o face acceptabilă operațional. Fișierul revenirii nu a fost certificat de Copilot.
- E un artefact excepțional, fără GO de execuție. Stă în afara `supabase/migrations/`. Nu există CI care să aplice migrări, iar convenția CLI descoperă doar acel director; harness-ul verifică asta.

## 6. Teste și rezultate

> **Actualizat în runda 2/4:** cifrele și „cele 3 emulări” de mai jos sunt ale rundei 1. Acum emulările sunt înlocuite de livrarea emulată după tiparul rundei 4 (§11), iar testele rundei 2 sunt în §10.4. Rezultatul curent: **860 verificări, 26 mutanți, exit 0 de 2 ori**.

Mediul: PostgreSQL 16.13 local (`/tmp/pg_sec_trezorerie`, 127.0.0.1:5484). Superuserul e `supabase_admin`, iar **`postgres` e NON-superuser cu BYPASSRLS**, ca în producție. `anon`/`authenticated` sunt NOLOGIN, `service_role` are BYPASSRLS, ACL-urile vin din default privileges Supabase. Datele sunt fictive (`RO00TEST…`). Scheletul verifică fidelitatea: md5 al expresiei de azi = cel din producție (`dc71e447…`).

**Harness-ul complet a rulat de 2 ori, ambele cu exit 0: `PASS: 994 verificări OK, 15 mutanți prinși`** (74 de verificări de scenariu + aserțiunile suitelor).

- **Comportament**, pe fiecare categorie din matrice, citire și scriere separat (SELECT/INSERT/UPDATE/DELETE pe ambele tabele):
  - categoriile: owner, `can_access_financiar`, modul financiar fără flag, rol de scriere UI fără modul, cont execuție oarecare, flag NULL, JWT fără profil, authenticated fără UID, anon (inclusiv TRUNCATE), `service_role` și `postgres` neafectați;
  - secvențe: anon `nextval`, authenticated `setval`;
  - invariantul scriere ⊆ citire; anon EXECUTE pe helper;
  - FK-ul `garantii` → trezorerie merge ca azi;
  - rezidualul `garantii.iban` e documentat ca aserțiune.
- **Discriminare:**
  - suita `patch` (96 aserțiuni) **cade** pe starea de azi și după revenire;
  - suita `initial` (88) trece pe starea de azi și **cade** pe patch;
  - suita `revenire` (88) trece după revenire.
- **Precondiții negative** (fiecare în cele 3 emulări, deci 18 refuzuri + 2):
  - N1 politică în plus, N2 RLS oprit, N3 politică fără USING/WITH CHECK (NULL), N4 helper cu alt corp, N5 helper cu altă semnătură, N6 roluri schimbate în public;
  - N7 pereche mixtă, N8 reaplicare peste o politică în plus.
  - La toate: refuz, stare identică (snapshot md5 pe politici, ACL-uri, funcții și date), migrare neînregistrată.
- **Eroare injectată** după prima schimbare și, separat, în postcondiție, **în toate cele 3 emulări**: `psql -f`, un singur simple query `psql -c "$(cat f)"`, și runner cu tranzacție proprie + `INSERT INTO supabase_migrations.schema_migrations` în același string (tabelă creată doar pentru emulare). În toate: starea rămâne inițială, migrarea nu e înregistrată, iar suita `initial` trece după fiecare.
- **Aplicare:** prin fiecare emulare (emularea 3 înregistrează o singură dată), reaplicare idempotentă (snapshot identic), reaplicare după revenire.
- **Revenire:** refuzată când e nearmată, cu token greșit, cu litere mici, armată în altă tranzacție, cu setare de sesiune rămasă, după armare + eroare + reluare fără armare nouă, cu armare persistentă pe rol, cu armare persistentă pe bază (cu majuscule), peste un helper modificat, sau pornită din starea inițială. Armată corect: postcondiția trece, iar comutatorul e dezarmat în aceeași tranzacție.
- **Mutanți: 15/15 prinși.**
  - Pe migrare, M1–M10 (citire extinsă la modulul financiar, scriere dedusă din citire, UID NULL trece, anon își păstrează granturile, fără EXECUTE, SECURITY INVOKER, fără owner, SELECT `true`, TRUNCATE păstrat, flag NULL tratat ca adevărat) sunt refuzați de postcondiție fără urme. Fără postcondiție, suita de comportament îi prinde pe 8 din 10. **M2** (scriere dedusă din citire) și **M6** (INVOKER) sunt invizibili în comportament la varianta A și îi prinde **doar** postcondiția; de aceea postcondiția e obligatorie.
  - M11: fără precondiții, helperul străin ar fi suprascris tacit.
  - Pe revenire, R1–R4: fără armare, fără verificarea persistenței, fără verificarea stării de pornire, fără dezarmare.

## 7. Procedura de apply (după acordul lui Răzvan)

1. **Preview read-only** (execute_sql): amprenta politicilor de azi = perechea „inițială” din precondiție, `can_access_financiar` = 0 (sau lista aprobată), 0 cereri REST noi, `SELECT version()`.
2. **Acordul explicit al lui Răzvan** pe varianta de matrice (A/B/C) și, separat, pe eventualele flaguri. Pentru B/C se schimbă corpul helperului și amprentele din migrare și revenire, apoi se rulează din nou harness-ul. Nu există actualizare automată a listelor albe.
3. **Apply** numai prin runnerul de livrare comun, **după GO-ul Copilot pe runda 5** (§11); NU `apply_migration` / `execute_sql` (fișierul le refuză prin garda de livrare). Rulează ca `postgres`. Producția e PG 17.6, iar harness-ul rulează pe PG16. Dacă deparse-ul diferă, precondiția refuză **înainte de orice schimbare** (fail-closed). În acel caz se compară definițiile și se actualizează revizia după review; amprenta găsită nu se copiază automat.
4. **Verificare:** aceleași interogări de catalog ca în postcondiție, plus o numărare ca `authenticated` fără drepturi (0 rânduri) și ca owner (33).

## 8. Riscul de regresie și rezidualele

- **Utilizatorii de azi:** nu au fost identificați consumatori afectați în inventarul verificat; probele raportate acoperă ecranele din `src/` (toate branch-urile remote), edge-urile din repo, cron-urile și funcțiile din BD — nu și edge-urile deployate care nu sunt în repo sau accesul indirect prin RPC-uri necunoscute; `postgres`/MCP și `service_role` sunt neafectați; FK-ul din `garantii` merge (verificările FK ocolesc RLS). La varianta A, azi doar cei 2 owneri văd tabelele prin API. Ce se pierde e accesul REST neutilizat al celor 29 de non-owneri.
- **R1, important: IBAN-urile rămân expuse prin `garantii`.** Tabelul `garantii` (copil prin FK al `trezorerie_conturi`, `ON DELETE SET NULL`) are aceeași politică deschisă (`garantii_rw` ALL, `auth.uid() IS NOT NULL`) și coloana proprie `iban`: 16 rânduri, dintre care **15 cu IBAN identic** cu contul de trezorerie legat. Nu l-am inclus în patch, pentru că are consumatori UI reali (Financiar → Registru garanții), un RPC `SECURITY DEFINER` (`garantii_adresa_eliberare`, care pune IBAN-ul în text pentru orice `p_id`, apelabil de orice cont logat) și un cron, adică alți actori și alt impact. Fără un patch pe `garantii`, protecția de **citire** a IBAN-urilor e parțială. Pentru trezorerie: **accesul direct prin rolurile API evaluate este restrâns conform matricei** (§3, varianta A).
- **`garantii` = INCIDENT SEPARAT, PRIORITAR** (verdict §3), nu rezidual opțional de confidențialitate: tabelul e **modificabil** de orice cont logat (integritate financiară: legătura cu trezoreria, IBAN-ul, beneficiarul — testat D5 în §10), iar RPC-ul `garantii_adresa_eliberare` generează text din aceste date. Remedierea trebuie să acopere **tabelul, RPC-ul și consumatorii legitimi** (UI Registru garanții, cron `garantii_alerte`). Restrângerea urgentă a trezoreriei nu e condiționată de el.
- **R2:** `garantii_adresa_eliberare` fără poartă de rol; intră în același patch viitor ca R1.
- **R3:** TRUNCATE și default privileges pe restul schemei rămân pentru patch-ul global (#9 din matrice).
- **R4:** scoaterea politicii nu invalidează copiile deja citite; scrierile deja făcute nu pot fi atribuite (tabelele nu au audit). Nu există indicii de modificări (0 DELETE, UPDATE-urile corespund împerecherii din 15.09).

## 9. Ce n-am putut verifica

- conexiunile SQL directe, care nu apar în jurnalele gateway-ului;
- comportamentul exact pe PG17: deparse-ul și MAINTAIN au fost testate doar logic pe PG16, iar pe PG17 precondiția refuză sigur dacă deparse-ul diferă;
- PostgREST real: testele folosesc `SET ROLE` + claims, nu gateway-ul.
- Abatere de raportat: o interogare agregată de investigație a grupat după coloana `sursa_imperechere` și a întors căi de fișiere (nu IBAN-uri, nu sume). Nu sunt reproduse nicăieri; de atunci am folosit doar `count(*) FILTER`.

## 10. Runda 2 — răspuns la verdict (Copilot 30.09, „GO CU CORECTURI” pe 877919e)

Nimic aplicat pe live. Pe Supabase doar SELECT pe cataloage (fără date de rând, fără IBAN-uri): amprenta completă a obiectelor trezoreriei și invarianții `profiles`, 30.09.

### 10.1 DELETE cu cascadă: decizie separată, de aprobat de Răzvan

În varianta A, **un singur flag — `can_access_financiar` — acordă efectiv citire, creare, modificare ȘI ștergere pe toate rândurile ambelor tabele.** Separarea în doi helperi nu face drepturile independent atribuibile unui utilizator: cine primește flagul (azi sau în viitor) primește toate patru. Răzvan trebuie să aprobe explicit această consecință, **inclusiv pentru atribuirile viitoare ale flagului**.

DELETE nu se deduce din „poate opera financiar”. Efectul demonstrat pe fixture (§10.4, D4): ștergerea unui cont șterge **în cascadă toate extrasele lui** (`ON DELETE CASCADE`) și pune pe **NULL legătura din `garantii`** (`ON DELETE SET NULL`); restul rândurilor rămân neatinse.

**Alternativă (NU implementată, doar descrisă): „DELETE doar owner”.** O a treia funcție `fn_trezorerie_poate_sterge()` = `is_owner` (fără flag), cu politicile `trez_*_delete` pe ea; SELECT/INSERT/UPDATE rămân pe `can_access_financiar`. Cere politică distinctă, amprente noi, teste noi și **review nou** — nu e o simplă schimbare de corp de helper. B/C (§3) se scriu cu `OR` și paranteze, iar populațiile se recalculează pe preview-ul curent; alegerea lor cere și ea review nou.

### 10.2 Perechea completă de privilegii (verdict §2)

Precondiția compară starea **completă**, nu doar perechea politici–helperi. Blocul `<amprenta-20261003e>` (text identic în precondiție și postcondiție; verificat static de harness) produce patru amprente:
- **obiecte** (2 tabele + 2 secvențe): tip de relație, RLS/FORCE, owner, moșteniri, partiționare, granturi pe coloane, triggere, **ACL complet** (grantor, orice grantee, fiecare privilegiu, grant option). MAINTAIN (doar PG17) e scos din listă și verificat separat: deținătorii MAINTAIN = deținătorii TRUNCATE;
- **secvențe**: `pg_get_serial_sequence(tabel,'id')`, default-ul coloanei `id`, dependența `pg_depend` `a` spre `tabel.id`, tip/start/increment/min/max/cache/cycle — deci secvențele sunt **cele legate de coloanele ID**, nu obiecte cu numele așteptat;
- **privilegii efective** (cu grant options) pentru `anon`, `authenticated`, PUBLIC, `service_role` — acoperă moștenirea prin roluri;
- **helperi**: semnătură, tip întors, limbaj, SECURITY DEFINER, volatilitate, `proconfig`, owner, md5 `prosrc`, **ACL complet** și EXECUTE efectiv.

Stări acceptate (listă de acceptare, NULL-safe): **live de azi** (valori citite read-only pe live 30.09, PG17 = identice cu scheletul local PG16), **patch exact** (reaplicare fără efect net) și **starea lăsată de revenirea tehnică** (politici deschise, ACL strâns, fără helperi). Orice altceva → refuz **înainte de orice modificare**. În particular: patch + DELETE retras intenționat → refuz, DELETE **nu** se reacordă.

Postcondiția cere **exact** amprentele țintă (niciun rol în plus pe helperi, toate proprietățile secvențelor, SELECT-ul authenticated pe secvențe, grant options) și compară **privilegiile efective ale `service_role` înainte/după** (valoarea „înainte” e reținută local tranzacției de precondiție).

### 10.3 Invarianții sursei drepturilor (verdict §2 ultimul paragraf, §4)

Abordarea din #540 (61a0e28), adaptată la `can_access_financiar`. Bloc `<invarianti-20261003e>`, liste albe = live 30.09 (read-only): `profiles` (RLS on, fără FORCE, owner `postgres`), politicile de **scriere** de pe `profiles` (INSERT/DELETE/UPDATE-altcuiva doar owner; `profiles_update_own` permite UPDATE pe rândul propriu), triggerele `prevent_role_escalation_trigger` (excepție la `is_owner`/`role`) și `trg_enforce_owner_only_salary_flags` (resetează `is_owner` și **toate `can_access_*`, inclusiv `can_access_financiar`**) cu md5 pe definiție și pe `prosrc` + SECURITY DEFINER, tipurile coloanelor `id`/`is_owner`/`can_access_financiar`, `anon`/`authenticated` fără BYPASSRLS/superuser. Orice diferență → refuz.

**Finding nou (informativ):** pe live, `profiles` are încă 2 triggere (`trg_profiles_campuri_owner_only`, `trg_protect_can_access_pontaj_brut`) care nu sunt în invariant — protecții suplimentare, nu necesare pentru demonstrație. Pe live `is_owner`/`can_access_financiar` sunt NOT NULL; scheletul le lasă nullable doar pentru testul „flag NULL” (invariantul verifică tipul, nu NOT NULL). Limitele din #540 §8.1 se aplică și aici: F1 (TRUNCATE pe `profiles`), F2 (triggerele sar verificarea când `auth.uid()` e NULL → orice cale `service_role` poate seta flagul), funcțiile cu SQL dinamic și edge-urile deployate neinventariate.

### 10.4 Cerință → schimbare → test → rezultat

| Cerință (verdict) | Schimbare | Test (harness) | Rezultat |
|---|---|---|---|
| §2 perechea completă; §4 reaplicare după DELETE retras | precondiția pe amprenta completă (10.2) | I1: patch, `REVOKE DELETE … FROM authenticated`, reaplicare prin livrare și prin tranzacția runnerului | **refuz înainte de modificări**, DELETE rămâne retras; mutantul „precondiția r1” (doar politici+helperi) îl **reacordă tacit** → prins |
| §4 ACL străin pe helper | ACL complet al helperilor în pre/post | I2a–d: EXECUTE către rol suplimentar, PUBLIC, `WITH GRANT OPTION`, `service_role` | toate refuzate, stare identică |
| §4 derivă de structură | amprenta obiectelor + secvențelor | I3a–m: owner tabel, FORCE RLS, moștenire, secvență `OWNED BY NONE`, **secvență înlocuită cu același nume și ACL identic**, INCREMENT, tip secvență, grant pe coloană, rol suplimentar, grant option, anon care moștenește un rol cu SELECT, trigger adăugat; owner schimbat pe starea patch | toate refuzate; mutantul fără verificarea secvențelor e prins de I3e |
| §2 postcondiție exactă (helperi, secvențe, service_role) | postcondiția pe amprenta completă + service_role înainte/după | mutanți M12 (EXECUTE către rol în plus), M13 (grant option authenticated), M14 (service_role pierde TRUNCATE), M15 (CACHE secvență), M16 (rol suplimentar pe tabel) | toți refuzați de postcondiție; **fără ea, toți cinci sunt invizibili în comportament** |
| §2/§4 sursa drepturilor | `[pre:invarianti]` | I4a–i: trigger dezactivat, trigger șters, corpul `enforce` fără resetarea flagului, politică INSERT profil propriu, UPDATE owner lărgit, RLS oprit pe `profiles`, flag de tip text, trigger SECURITY INVOKER, `authenticated BYPASSRLS` | toate refuzate; mutantul fără invarianți e prins; demonstrație: cu triggerele oprite, peste patch, contul fără drept își pune flagul și **vede 3/3** |
| §4 autoatribuire (politici + triggere reale) | — | suita `sec_trezorerie_runda2.test.sql`, X1–X7: UPDATE propriu `can_access_financiar`, `is_owner`, ambele (cont cu modul financiar), flagul altcuiva, INSERT profil propriu cu flag / `is_owner` (uid fără profil), DELETE profil owner; încercarea și citirea/scrierea trezoreriei în **aceeași** tranzacție | pe patch: flag resetat / `P0001` / `42501` / 0 rânduri, **vede=0, modifică=0**; control X0 (flag legitim) 3/3; suita **cade pe starea de azi** |
| §4 retragerea flagului în sesiune | — | I6: aceeași sesiune psql, aceleași claims JWT; T1 citește 3; ownerul retrage flagul (commit); tranzacții noi | vede 0, UPDATE 0, DELETE 0, INSERT refuzat de RLS; nicio scriere rămasă |
| §4 efectele DELETE pe fixture | — | D0–D5 (suita runda2) | neautorizat (execuție, modul financiar fără flag, JWT fără profil): 0 rânduri, conturi/extrase/legături **identice** (md5); anon: `42501`; autorizat (owner, flag): exact 1 cont, extrasele lui în cascadă, legătura din `garantii` → NULL, restul neatins (md5 calculat independent); **D5 LIMITĂ**: orice cont logat rupe legătura direct pe `garantii` (în afara patch-ului) |
| §3 formulări | §1, §3, §8 corectate | — | „protecție completă” și „regresie zero” eliminate; limitele `pg_stat` și ale inventarului edge consemnate |
| §3 `garantii` | §8 | D5 | incident separat **PRIORITAR** (tabel + RPC + consumatori) |
| §3 revenirea | §5 | — | artefact tehnic, fără GO, **nu revenire operațională** |

**Limita fixture-ului:** contul legat are un singur extras; cascada e verificată pe număr și md5, nu pe mai multe extrase per cont.

**Rezultat:** `PGDATA_TEST=/tmp/pg_trez_r2 PGPORT_TEST=5651 bash scripts/test_sec_trezorerie.sh`, de 2 ori: **exit 0, `PASS: 860 verificări OK, 26 mutanți prinși`** (15 inițiali + M12–M16 + 3 mutanți de gardă + 3 ai precondiției rundei 2).

### 10.5 Ce rămâne deschis
- Aprobarea lui Răzvan: varianta A **și** consecința flagului unic (inclusiv DELETE cu cascadă și atribuirile viitoare) — sau „DELETE doar owner” (review nou).
- `garantii`: incident separat prioritar.
- Revenirea: nu a fost adaptată la amprenta completă (pornește tot din perechea politici + helperi); rămâne artefact tehnic fără GO.
- Livrarea: runnerul comun (runda 5), apoi portare + GO Copilot.
- PG17: amprentele au fost comparate pe live doar pentru starea inițială; starea patch pe PG17 rămâne neverificată (refuz fail-closed).

## 11. Runda 4 — tiparul de livrare (gărzile), fără runner

Fișierul nu mai are `BEGIN;`/`COMMIT;`: garda de livrare de **start** (prima instrucțiune) și de **final** (ultima, după postcondiție), ambele `current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003e_sec_trezorerie:' || txid_current()` ⇒ `RAISE`. **Runnerul comun `scripts/livrare_migrare.sh` NU e portat**: a primit NO-GO la Copilot r4 (`wt-sec-rsvti/docs/LIVRARE_MIGRARE_VERDICT_COPILOT_R4.md`) și se reface în runda 5. Harness-ul emulează livrarea după tipar (`psql --single-transaction`: marcaj + fișier + verificare marcaj/reluare + `INSERT` în `schema_migrations` cu coloanele din producție) — probă a **fișierului**, nu a runnerului.

| Test | Rezultat |
|---|---|
| livrare fără eroare | patch + **o** înregistrare (`statements[1]` = fișierul, octet cu octet) |
| eroare după prima schimbare · în postcondiție (livrare și tranzacția runnerului) | stare inițială, 0 înregistrări |
| **eroare injectată CHIAR la `INSERT`-ul în `schema_migrations`** (trigger BEFORE INSERT care verifică întâi că patch-ul e instalat în tranzacție) | stare inițială, **0 înregistrări** |
| reluare după eșecul înregistrării / după succes | permisă (patch + o înregistrare) / refuzată „deja înregistrată”, fără dublare |
| fișierul fără marcaj: `psql -f`, `psql -c`, `--single-transaction` fără marcaj, marcaj de sesiune rămas, `SET` fără txid | refuzat de garda de start, fără urme |
| mutanți: fără garda de start, garda fără txid, fără garda de final / `COMMIT` în fișier (static) | prinși |
| `COMMIT;` / `select 1; commit ;` / `END;` rulate prin livrare | eșuate, neînregistrate, **dar parțial comise → LIMITĂ OPEN**, nenumărate ca mutanți prinși; se închid doar prin validatorul runnerului (runda 5) |

Noul fișier: sha256 `c1cbf26987fb72bac742daecb12859009aaf1802ce6304a002e029c9425dfc1d`, 470 de linii.

## Livrare: runner comun ed7ecb0 (GO Copilot R9)

Migrarea se livrează DOAR prin runnerul comun `scripts/livrare_migrare.sh` + `scripts/livrare_validator.py`, copiate
byte cu byte din ed7ecb0 (branch #538, validator a6188fb neschimbat):
sha256 runner `bb223d90dcd3e932d7be8211cffb24cbbb6d0053c21bba333beca833892efb71`,
sha256 validator `9356d2871ebd09b3184992193d3a249f29eca497c2ddce6c5488f1909cbb450d`.
Validatorul acceptă migrarea (`python3 scripts/livrare_validator.py supabase/migrations/20261003e_sec_trezorerie.sql <tag>` ⇒ `OK`).

```bash
bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261003e_sec_trezorerie.sql \
  --sha256 c1cbf26987fb72bac742daecb12859009aaf1802ce6304a002e029c9425dfc1d \
  --versiune <AAAALLZZHHMMSS> --tinta-db <baza> --tinta-sistem <system_identifier> \
  --tinta-host <host_scriere_aprobat> --tinta-port <port> [--tinta-proiect <marcaj>] [--user <operator>]
```
(sha256 de mai sus = artefactul la commitul acestei secțiuni; la livrare se folosește sha256-ul APROBAT atunci.)
Parola doar din `~/.pgpass`/`PGPASSFILE`; `--service`, URI-uri și opțiuni psql suplimentare sunt refuzate (exit 2).

Limite (verdict R9, `docs/LIVRARE_MIGRARE_VERDICT_COPILOT_R9.md` pe #538):
- GO-ul e pentru standardul de livrare, NU autorizează merge/apply.
- La fiecare livrare: SHA-256 artefact, țintă + operator aprobați, pre/postcondiții, acordul lui Răzvan.
- Opriri / reporniri / rollback — aprobate separat.
- PG17 neverificat (server de test PG16); `pg_control_system()` rămâne (verificarea țintei).
- Codurile 0/11 confirmă înregistrarea, nu înlocuiesc verificarea structurii + smoke.
- Rezultat necunoscut / conflict / țintă neconfirmată ⇒ fără retry sau rollback automat (reconciliere manuală).
