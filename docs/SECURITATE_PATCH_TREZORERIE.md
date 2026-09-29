# SEC trezorerie — patch `20261003e_sec_trezorerie` (NEAPLICAT, doar local)

> Copilot a dat **GO DOAR PREGĂTIRE** pe acest domeniu, izolat: „matricea țintă de citire/scriere trebuie aprobată explicit; nu deduceți dreptul de modificare doar din dreptul de vizualizare”.
> Nimic din acest document nu s-a aplicat în producție. Investigația din BD (29.09.2026, proiect `dxczwkbciseqniprspcu`) a fost strict read-only: cataloage, numărători agregate și jurnalele gateway-ului API. **Niciun IBAN, sold sau altă valoare din tabele nu apare aici.**

## 1. Gaura: structurală, nu abuz demonstrat

| Tabel | Rânduri | Politica de azi | Efect |
|---|---|---|---|
| `trezorerie_conturi` (IBAN, cont intern, beneficiar, contract) | 33 | `trez_conturi_rw` FOR ALL TO authenticated USING/WITH CHECK `(auth.uid() IS NOT NULL)` | orice cont logat (31 de conturi auth, 29 non-owner) **citește, modifică și șterge** |
| `trezorerie_extras_linii` (solduri și rulaje din extras) | 33 | `trez_linii_rw`, identică | idem; ștergerea unui cont șterge în cascadă liniile lui |

- Tabelul `trezorerie_extras` nu există. Numele real e `trezorerie_extras_linii`, copilul prin FK (`ON DELETE CASCADE`) al lui `trezorerie_conturi`.
- ACL-urile de azi: `anon` și `authenticated` au `arwdDxtm` (inclusiv TRUNCATE, care ocolește RLS), iar pe secvențe au `rwU`. Pe tabele nu există triggere, granturi pe coloane sau view-uri dependente.
- Originea: migrarea `20260915200036 trezorerie_conturi_si_extrase`, aplicată prin MCP, nu e în repo. Datele au intrat printr-un import unic pe 15.09 (33 INSERT pe fiecare tabel), urmat de 16 UPDATE de împerechere. Nu există niciun DELETE (`pg_stat_user_tables`).
- **Nu există abuz demonstrat.** În jurnalele gateway-ului API, din 14.09 23:15 UTC până pe 29.09 23:14 UTC (toată viața tabelelor, 15 ferestre de 24h), sunt **0 cereri** cu `trezorerie` în cale sau în query string. Asta include REST direct și embedding. Nu există nici trafic GraphQL, iar `pg_graphql` nu e instalat. Limita: conexiunile SQL directe (pooler/5432) nu apar în acele jurnale.

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

**De ce A.** Nu există niciun ecran, edge sau cron care să aibă nevoie de acces, deci regresia e zero. Flagul `can_access_financiar` e deja precedentul BD pentru „financiar” și nu se poate auto-acorda. Riscul principal e scrierea: o schimbare de IBAN la un cont GBE e un vector de fraudă, iar ștergerea rupe cascada spre extrase și legătura cu `garantii`. B și C dau acces unor oameni care azi nu-l folosesc prin nicio interfață. Când va exista un ecran Trezorerie, lărgirea citirii înseamnă corpul unui singur helper.

La A seturile de citire și scriere coincid azi, dar sunt **două aprobări distincte, în doi helperi** (`fn_trezorerie_poate_citi` / `fn_trezorerie_poate_scrie`). Invariantul tehnic scriere ⊆ citire e testat: UPDATE/DELETE cu WHERE/RETURNING cer și SELECT.

**Decizii separate pentru Răzvan:**
1. Varianta A/B/C.
2. Cui îi pune `can_access_financiar`, dacă cuiva. E drept de acces, deci cere acord explicit.
3. **`garantii` (rezidual R1, mai jos)**: patch separat, da/nu.

## 4. Patch-ul

Fișiere:
- `supabase/migrations/20261003e_sec_trezorerie.sql`: prefixul e liber pe toate branch-urile `origin/*` și în `scratchpad/wt-*`; `20261003d` e rezervat altui agent.
- `supabase/revenire/20261003e_sec_trezorerie_ROLLBACK.sql` + `README.md`.
- Harness și teste: `scripts/test_sec_trezorerie.sh`, `supabase/tests/sec_trezorerie_schelet.sql`, `supabase/tests/sec_trezorerie.test.sql`.

Ce face patch-ul, pe pași:
- **(a)** `BEGIN;` … `COMMIT;` în fișier, deci un singur gestionar al tranzacției. `SET LOCAL search_path = public, pg_temp` face deparse-ul determinist.
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
- **(c)** Postcondiție **înainte de COMMIT**:
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
- E un artefact excepțional, fără GO de execuție. Stă în afara `supabase/migrations/`. Nu există CI care să aplice migrări, iar convenția CLI descoperă doar acel director; harness-ul verifică asta.

## 6. Teste și rezultate

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
3. **Apply** cu `apply_migration`, ca `postgres`. Producția e PG 17.6, iar harness-ul rulează pe PG16. Dacă deparse-ul diferă, precondiția refuză **înainte de orice schimbare** (fail-closed). În acel caz se compară definițiile și se actualizează revizia după review; amprenta găsită nu se copiază automat.
4. **Verificare:** aceleași interogări de catalog ca în postcondiție, plus o numărare ca `authenticated` fără drepturi (0 rânduri) și ca owner (33).

## 8. Riscul de regresie și rezidualele

- **Utilizatorii de azi:** regresia e zero pe fluxuri. Niciun ecran, edge sau cron nu folosește tabelele; `postgres`/MCP și `service_role` sunt neafectați; FK-ul din `garantii` merge (verificările FK ocolesc RLS). La varianta A, azi doar cei 2 owneri văd tabelele prin API. Ce se pierde e accesul REST neutilizat al celor 29 de non-owneri.
- **R1, important: IBAN-urile rămân expuse prin `garantii`.** Tabelul `garantii` (copil prin FK al `trezorerie_conturi`, `ON DELETE SET NULL`) are aceeași politică deschisă (`garantii_rw` ALL, `auth.uid() IS NOT NULL`) și coloana proprie `iban`: 16 rânduri, dintre care **15 cu IBAN identic** cu contul de trezorerie legat. Nu l-am inclus în patch, pentru că are consumatori UI reali (Financiar → Registru garanții), un RPC `SECURITY DEFINER` (`garantii_adresa_eliberare`, care pune IBAN-ul în text pentru orice `p_id`, apelabil de orice cont logat) și un cron, adică alți actori și alt impact. Fără un patch pe `garantii`, protecția de **citire** a IBAN-urilor e parțială; protecția de **scriere** și de ștergere pe trezorerie e completă.
- **R2:** `garantii_adresa_eliberare` fără poartă de rol; intră în același patch viitor ca R1.
- **R3:** TRUNCATE și default privileges pe restul schemei rămân pentru patch-ul global (#9 din matrice).
- **R4:** scoaterea politicii nu invalidează copiile deja citite; scrierile deja făcute nu pot fi atribuite (tabelele nu au audit). Nu există indicii de modificări (0 DELETE, UPDATE-urile corespund împerecherii din 15.09).

## 9. Ce n-am putut verifica

- conexiunile SQL directe, care nu apar în jurnalele gateway-ului;
- comportamentul exact pe PG17: deparse-ul și MAINTAIN au fost testate doar logic pe PG16, iar pe PG17 precondiția refuză sigur dacă deparse-ul diferă;
- PostgREST real: testele folosesc `SET ROLE` + claims, nu gateway-ul.
- Abatere de raportat: o interogare agregată de investigație a grupat după coloana `sursa_imperechere` și a întors căi de fișiere (nu IBAN-uri, nu sume). Nu sunt reproduse nicăieri; de atunci am folosit doar `count(*) FILTER`.
