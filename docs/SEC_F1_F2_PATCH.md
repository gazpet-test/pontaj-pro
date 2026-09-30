# SEC F1 + F2: TRUNCATE pe schema `public` și „auth.uid() IS NULL” în triggerele de pe `profiles` — 30.09.2026

> **Runda 3 (verdict r2: F1 GO pe logică, F2 NO-GO — ramura (a) trebuie legată și de rolul SQL efectiv, dovedit cu PostgREST real) — vezi §7. Runda 2 în §6.** 
> **F1 remediat pe relațiile existente + prevenție pentru creatorul postgres; risc rezidual OPEN pentru obiecte create de supabase_admin (necesită acceptarea explicită a lui Răzvan) + control de drift postflight: has_table_privilege anon/authenticated TRUNCATE = 0/0 după fiecare deploy/migrare.**
>
> **NEAPLICAT. Draft pentru review** (poarta GO/NO-GO Copilot) și pentru acordul explicit al lui Răzvan. Nicio migrare de aici nu a fost rulată; nu modifică date. Tot ce s-a citit din producție a fost **read-only** (30.09.2026, PG 17.6: `pg_class`/`aclexplode`, `pg_default_acl`, `pg_trigger`, `pg_proc`, `pg_policies`, `cron.job`, `has_table_privilege`, `pg_get_functiondef`). Nicio funcție a aplicației n-a fost apelată.
> Cele două constatări vin din `docs/SECURITATE_ADVISORS_2026-09-30.md` (§3 TRUNCATE, cerința Copilot §5; P14 din lista de patch-uri) și din inventarul whitebox (S09-21, „TRUNCATE nu e supus RLS”). Sunt tratate în **două migrări separate**, fiecare cu rollback propriu, ca să poată primi GO independent.

## 0. Pe scurt
| | F1 — TRUNCATE | F2 — uid NULL în triggerele `profiles` |
|---|---|---|
| Fișier | `supabase/migrations/20260930i_sec_f1_truncate_revoke.sql` | `supabase/migrations/20260930j_sec_f2_profiles_uid_null.sql` |
| Rollback | `..._ROLLBACK.sql` (același director) | `..._ROLLBACK.sql` (același director) |
| Obiecte atinse | drepturile TRUNCATE ale `anon` și `authenticated` pe **toate** relațiile din `public` (345 tabele din 374 + 129 view-uri cu bitul inert) + setarea implicită a lui `postgres` pe `public` | 3 funcții-trigger: `prevent_role_escalation`, `enforce_owner_only_salary_flags`, `protect_can_access_pontaj_brut` |
| Regresie pentru utilizatori | **zero** (nimic nu face TRUNCATE ca anon/authenticated; PostgREST nu poate emite TRUNCATE) | **zero** pentru utilizatorii reali (auth.uid() NOT NULL: cod identic). Contextele de sistem legitime (service_role prin REST, postgres/supabase_admin direct, pg_cron) trec în continuare |
| Ce refuză după patch | — | UPDATE pe `profiles` fără `sub` în JWT și în afara contextului de sistem: cheia **anon**, JWT authenticated fără sub, claims golite, conexiune ca `authenticator` fără claims ⇒ `42501` |
| Livrare | `scripts/livrare_migrare.sh` (branch `claude/erp-continuare-x4p5a7-sec-rsvti`); validatorul acceptă toate 4 fișierele | idem |

## 1. F1 — TRUNCATE pentru anon/authenticated pe toată schema

### 1.1 Constatarea (citită live, 30.09.2026)
- **374** de tabele (relkind r/p) în `public`. Cu TRUNCATE efectiv: **anon 332**, **authenticated 344**, **345** pentru cel puțin unul dintre ele (advisors §3B numărase 370 / 332 / 340 / 341 pe 30.09 dimineața; între timp au apărut `ctc_*`, `hr_formare_profesionala`, `logistica_imprumuturi` — toate cu TRUNCATE pentru authenticated, dovadă că setarea implicită lucrează în continuare). Printre ele: **`profiles` și `user_module_access`** (sursa drepturilor de acces), `employees`, `employee_salaries`, `hr_*`, `pontaj_*`, `stocuri*`, `ofertare_*` (66 din 82).
- **129 de view-uri** poartă și ele bitul TRUNCATE în ACL (inert: TRUNCATE nu se aplică pe view-uri), tot din setarea implicită.
- **29 de tabele fără** TRUNCATE pentru niciunul dintre roluri: `app_secrets`, 11 `_backup_*`, 17 `ofertare_*` blindate explicit (`ofertare_derogari_audit`, `ofertare_source_pack*`, `ofertare_seap_cereri/_fisiere`, `ofertare_cerinte_dovezi/_subiect/_titular`, `ofertare_raspuns_set*`, `ofertare_plansa_buget/_coada`, `ofertare_pt_capitole_versiuni`, `ofertare_cantitati_istoric`, `ofertare_subiecte_regula`).
- Asimetrii: 13 tabele doar la authenticated (`ctc_carti`, `ctc_documente_carte`, `ctc_template_pozitii`, `ctc_templates`, `hr_formare_profesionala`, `logistica_imprumuturi`, `ofertare_clarificari_puncte`, `ofertare_pt_afirmatii`, `ofertare_pt_capitole`, `ofertare_pt_legaturi`, `ofertare_pt_observatii`, `ofertare_pt_poarta`, `ofertare_seap_manifest`); 1 doar la anon (`ofertare_pt_pachet_fisiere` — REVOKE-ul din 20260924 făcut invers, advisors §3A).
- **Cauza**: `pg_default_acl` pe schema `public`, pentru rolurile `postgres` **și** `supabase_admin`, obiect `r` (tabele): `anon=arwdDxtm`, `authenticated=arwdDxtm` (D = TRUNCATE, m = MAINTAIN). `PUBLIC` nu are TRUNCATE nicăieri (0). Niciun grant TRUNCATE nu e WITH GRANT OPTION (0). Toate relațiile din `public` sunt ale lui `postgres`. `service_role` are TRUNCATE pe 369/374 (neatins de patch).
- **Mecanism / risc**: TRUNCATE nu trece prin RLS și nu declanșează triggerele de rând. PostgREST și pg_graphql nu îl pot emite. Exploatabil doar printr-o cale care rulează SQL arbitrar ca anon/authenticated — **azi nu există una** (advisors §3C). Riscul e latent (apărare în profunzime), nu activ.
- **Regresie**: **0** funcții din `public`/`extensions` conțin `TRUNCATE` (căutare `\mtruncate\M` fără `date_trunc` în `pg_proc.prosrc`), **0** joburi `cron.job`, iar în `src/`, `supabase/functions/`, `worker/` nu există TRUNCATE în SQL (advisors §3C).

### 1.2 Ce face migrarea `20260930i`
0. **Garda de livrare** (start + final): rulează doar prin runner, în tranzacția lui.
1. **Precondiții fail-closed** (nimic modificat la refuz): toate relațiile din `public` sunt ale lui `postgres` (altfel `REVOKE … ON ALL TABLES` ar eșua la jumătate); `PUBLIC` nu are TRUNCATE (0 — nu îl retragem de la PUBLIC, ar fi o schimbare neanalizată); nu există TRUNCATE WITH GRANT OPTION la anon/authenticated (0).
2. **Inventar `RAISE NOTICE`**: un rând pentru fiecare tabel pe care anon/authenticated are TRUNCATE efectiv, plus totalurile (așteptat pe producție: 374 / 332 / 344 / 369). Rămâne în jurnalul livrării.
3. `REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;` — tabele, partiții, view-uri, tabele străine.
4. `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;` — tabelele noi create de `postgres` (migrări, SQL editor, MCP) nu mai primesc TRUNCATE.
5. **Postcondiții** (înainte de înregistrare/COMMIT): 0 relații din `public` cu TRUNCATE **efectiv** (`has_table_privilege` — include PUBLIC și moștenirea prin roluri) pentru `anon`, `authenticated`, `public`; setarea implicită a lui `postgres` fără D pentru cele două roluri; `service_role` neatins — r2: **exact** același număr ca în precondiție (salvat în GUC-ul de tranzacție `gazpet.f1_sr_before`, comparat cu `IS NOT DISTINCT FROM`; ±1 ⇒ refuz); r2: **sondă** — un tabel creat de `postgres` în `public` și unul într-o schemă de unică folosință (`_sec_f1_sonda_schema`), ambele șterse în aceeași tranzacție, nu primesc TRUNCATE pentru anon/authenticated (prinde și o setare implicită globală, pe care 3b nu o citește). Notă: `CREATE TABLE` în `public` declanșează event trigger-ele platformei (ex. reîncărcarea schemei PostgREST la COMMIT) — inofensiv, sondele nu mai există la COMMIT.

### 1.3 Limite / de notat
- **Setarea implicită a lui `supabase_admin`** (`pg_default_acl`, tot `arwdDxtm` către anon/authenticated) **nu se poate schimba ca `postgres`** (`ALTER DEFAULT PRIVILEGES FOR ROLE` cere apartenența la rol). Tabelele create de `supabase_admin` (platformă; rar) ar primi din nou TRUNCATE. Nu apare în migrare; rămâne consemnat. Remediere posibilă doar din dashboard/suport Supabase sau printr-o verificare periodică (`get_advisors` / SELECT-ul din §4).
- `MAINTAIN` (m) rămâne acordat — nu face parte din constatare; de discutat separat.
- Bitul TRUNCATE de pe view-uri e retras și el (inert); rollback-ul îl readuce prin `GRANT … ON ALL TABLES`.

### 1.4 Rollback `20260930i_…_ROLLBACK.sql`
**Revert TEHNIC, nu exact** (r2, marcat în antetul fișierului): pentru tabelele create după 30.09 nu reproduce o stare anterioară; **nu se rulează automat** (niciun runner/CI/cron). Redeschide gaura latentă — **fără GO de execuție**, doar la decizia explicită a lui Răzvan, cu motivul consemnat. Precondiție: 0 relații cu TRUNCATE pentru anon/authenticated (starea de după migrare). Pune la loc setarea implicită, apoi `GRANT TRUNCATE ON ALL TABLES` și retrage pe excepțiile de dinainte (29 + 13 + 1, listate nominal; tabelele dispărute între timp se sar cu NOTICE). Postcondiție: anon = total − 29 − 13, authenticated = total − 29 − 1 (pe 30.09: 332 / 344 din 374; tabelele create ulterior primesc TRUNCATE pentru ambele, ca sub setarea veche).

## 2. F2 — „IF auth.uid() IS NULL THEN RETURN NEW” în triggerele de pe `profiles`

### 2.1 Constatarea (citită live, 30.09.2026)
`profiles` are exact 4 triggere, toate `BEFORE UPDATE FOR EACH ROW` (tgtype 19), activate, fără WHEN / listă de coloane, funcții `SECURITY DEFINER`, `search_path=public, pg_temp`, proprietar `postgres`, plpgsql:

| Trigger | Funcție | md5(prosrc) live | Protejează | Comportament la `auth.uid()` NULL azi |
|---|---|---|---|---|
| `prevent_role_escalation_trigger` | `prevent_role_escalation` | `16112659be92143e6539ae0e54e47a06` | `role`, `is_owner` (RAISE) | **RETURN NEW necondiționat** |
| `trg_enforce_owner_only_salary_flags` | `enforce_owner_only_salary_flags` | `0470660c0a819981ff914355c7f6d00a` | `is_owner`, `can_access_salarii`, `can_access_personal_data`, `can_access_pontaj_brut`, `can_modify_employees`, `can_manage_contracts`, `can_access_diurne`, `can_access_financiar` (resetare tăcută) | **RETURN NEW necondiționat** |
| `trg_protect_can_access_pontaj_brut` | `protect_can_access_pontaj_brut` | `ff277c90e02ef03d1efb34cd7e87b1d4` | `can_access_pontaj_brut` (RAISE) | **RETURN NEW necondiționat** |
| `trg_profiles_campuri_owner_only` | `fn_profiles_campuri_owner_only` (S-A, 29.09) | `c06d7ce0f212c7bba2093c50614a88fc` | `department`, `employee_id` | claims + `session_user`, dar ramura `service_role` nelegată — **inclusă în patch în r4 (§8)** |

- `auth.uid()` (definiția live) = `request.jwt.claim.sub` sau `request.jwt.claims->>'sub'`. E NULL nu doar pentru service_role / conexiuni directe, ci și pentru **cheia anon** (claims `{"role":"anon"}`, fără sub), pentru un JWT `authenticated` fără `sub`, sau pentru claims golite. În toate aceste cazuri cele 3 triggere sar peste verificare.
- Cale reală de exploatare azi: RLS pe `profiles` are politici doar pentru `authenticated` (`profiles_update_own`, `profiles_update_owner`), deci un UPDATE ca `anon` prin REST e refuzat de RLS înainte de trigger. Gaura devine activă dacă apare vreodată o politică pentru anon, o funcție SECURITY DEFINER care face UPDATE pe `profiles` cu claims lipsă, sau un JWT fără sub acceptat de PostgREST. E o apărare în profunzime pentru **sursa drepturilor** (aceleași câmpuri pe care S-A le-a blindat pentru `department`).
- `user_module_access`: **0 triggere** (`pg_trigger`), politici doar pentru `authenticated` (select/insert/update/delete owner). Nimic de reparat pentru F2; intră în F1 (TRUNCATE).
- Contexte de sistem care ating `profiles` azi: `handle_new_user` (trigger pe `auth.users`, INSERT — nu e afectat, triggerele sunt BEFORE UPDATE); **0** funcții din BD care fac `UPDATE profiles`; **0** joburi cron care ating `profiles`; `supabase_auth_admin` n-are UPDATE pe `profiles`. Edge functions / worker cu cheia service_role trec prin claim-ul `role = 'service_role'`.

### 2.2 Ce face migrarea `20260930j`
0. **Garda de livrare** (start + final).
1. **Precondiții fail-closed** (`md5(prosrc)` canonic, pattern S-A): fiecare dintre cele 3 funcții are exact o definiție, atributele analizate (plpgsql, SECURITY DEFINER, `search_path=public, pg_temp`, proprietar postgres, RETURNS trigger, 0 argumente) și corpul **exact** varianta live (md5 de mai sus) sau, la reaplicare, exact varianta din patch; setul de triggere pe `profiles` e exact cel de 4; `fn_profiles_campuri_owner_only` e varianta canonică `c06d7ce0…`. Orice diferență ⇒ refuz, nimic modificat (testat: un corp modificat e prins — „doar 2 din 3 funcții”). ACL-ul celor 3 funcții e salvat pentru comparația de la final.
2. `CREATE OR REPLACE` pe cele 3 funcții. Singura schimbare: blocul `IF auth.uid() IS NULL THEN RETURN NEW; END IF;` devine
   ```
   IF auth.uid() IS NULL THEN
     v_rol_claim  := nullif(request.jwt.claim.role, '')
     v_rol_claims := nullif(request.jwt.claims::jsonb->>'role', '')   -- JSON invalid: auth.uid() de mai sus a căzut deja cu 22P02
     IF ambele nevide ȘI diferite THEN RAISE 42501;                    -- r2: surse contradictorii ⇒ fail-closed
     v_rol := coalesce(v_rol_claim, v_rol_claims)
     IF v_rol = 'service_role' AND session_user = 'authenticator'
        AND current_setting('role', true) = 'service_role' THEN RETURN NEW;   -- r2: conexiunea PostgREST; r3: + rolul SQL efectiv
     IF v_rol IS NULL AND session_user IN ('postgres', 'supabase_admin') THEN RETURN NEW;  -- conexiune directă, fără claims
     RAISE EXCEPTION '…' USING ERRCODE = '42501';                                -- anon, JWT fără sub, claims golite, alt rol
   END IF;
   ```
   Restul corpului (verificările pentru utilizatori reali, mesajele, resetarea tăcută din `enforce_owner_only_salary_flags`) e **identic** cu varianta live. `current_user` **nu** e folosit: funcțiile sunt SECURITY DEFINER, deci `current_user` e mereu `postgres` înăuntru; identitatea reală e în claims + `session_user` — exact regula din S-A.
3. **Postcondiții**: md5(prosrc) = variantele din patch r3 (`cf75b37d522e2a6b0b9c9eabd72c27b4`, `daaa561298c10c259944600e6c39467e`, `2eec050b53f37ec995da79e93a2a4686`; r2 era `a57629d9…`/`0f66e336…`/`cf47425d…`, r1 era `de9d346b…`/`096211e9…`/`e26b5f2b…`, neaplicat nicăieri), atributele neschimbate, **ACL identic** cu cel de dinainte (comparat text cu text), tot 4 triggere active pe `profiles`.

### 2.3 Cine trece / cine e refuzat după F2 (la `auth.uid()` NULL)
| Context | Înainte | După |
|---|---|---|
| Edge function / worker NAS / cron prin REST cu cheia `service_role` (claim role = service_role, session_user = authenticator, rol efectiv service_role) | trece | **trece** |
| Orice sesiune care NU e authenticator și își pune claim role = service_role prin `set_config` (ex. rol SQL cu UPDATE, postgres→SET ROLE authenticated) | trece | **42501** (r2) |
| claim.role și claims.role contradictorii | trece | **42501** (r2) |
| Sesiune `authenticator` al cărei rol SQL efectiv NU e service_role (ex. RPC rulat ca authenticated/anon care își pune singur claim-urile service_role prin `set_config`) | trece | **42501** (r3) |
| `psql`/MCP/migrare ca `postgres` sau `supabase_admin`, fără claims (inclusiv pg_cron) | trece | **trece** |
| Cheia **anon** prin REST (`{"role":"anon"}`, fără sub) | trece (dacă RLS ar lăsa) | **42501** |
| JWT `authenticated` **fără** `sub` / claims golite | trece | **42501** |
| Conexiune ca `authenticator` (sau alt rol) fără claims | trece | **42501** |
| Utilizator real (sub prezent) | verificările de azi | **identic** |

### 2.4 Rollback `20260930j_…_ROLLBACK.sql`
Readuce **exact** corpurile live din 30.09 (md5 verificat în postcondiție: `16112659…`, `0470660c…`, `ff277c90…`), adică redeschide ocolirea. Precondiție: cele 3 funcții sunt exact variantele din patch (sau deja cele live — idempotent); nu se readuce varianta veche peste ceva neanalizat. ACL și atribute verificate identice. **Revenirea operațională** (păstrează politica): dacă un context de sistem legitim e refuzat cu 42501, mesajul spune rolul JWT și `session_user`; se decide explicit dacă intră în lista de sistem (o nouă migrare revizuită), nu se revine tacit.

## 3. Verificare făcută (local, PostgreSQL 17) — runda 1; runda 2 în §6, harness-ul e acum în repo
Harness pe un cluster local (roluri `anon`/`authenticated`/`service_role`/`authenticator`/`supabase_admin`, `auth.uid()`/`auth.role()` cu definițiile live, `profiles` cu cele 4 triggere cu corpurile live — md5 identice cu producția — și tabele de probă), fiecare fișier rulat exact ca prin runner (`psql --single-transaction`, marcajul `gazpet.livrare_migrare` legat de txid):
- garda de livrare refuză fără marcaj; validatorul `scripts/livrare_validator.py` acceptă toate 4 fișierele (OK 6 / 7 / 7 / 7 instrucțiuni);
- **F1**: inventarul NOTICE listează tabelele; după apply 0 TRUNCATE pentru anon/authenticated pe tabele și view-uri, service_role neatins, un tabel creat ulterior nu mai primește TRUNCATE (INSERT/SELECT etc. rămân); reaplicare idempotentă; rollback readuce drepturile pe relațiile existente la 30.09 — revert tehnic, NU exact pentru relațiile create ulterior (excepțiile inexistente sunt sărite cu NOTICE), rollback a doua oară e refuzat de precondiție, apply după rollback merge;
- **F2**: apply / reapply / rollback / rollback a doua oară / apply din nou — toate trec, md5 exact la fiecare pas, ACL neschimbat; un corp modificat live e refuzat de precondiția 0b. Comportament: `postgres` direct ✔, `supabase_admin` direct ✔, `authenticator` + claims service_role ✔, cheia anon ✘ 42501, authenticated fără sub ✘ 42501, `authenticator` fără claims ✘ 42501; utilizator non-owner: schimbarea propriului `role` refuzată ca înainte, `can_access_salarii` resetat tăcut ca înainte, `department` refuzat de S-A ca înainte; owner poate schimba `role`/`can_access_pontaj_brut` altcuiva ca înainte.
Ce NU s-a testat: pe producție nimic (read-only); PostgREST real (claims puse de PostgREST, nu prin `set_config`).

## 4. Cum se aplică (după GO Copilot + acordul lui Răzvan)
Traseul oficial, `scripts/livrare_migrare.sh` (branch `claude/erp-continuare-x4p5a7-sec-rsvti`; parola din `~/.pgpass`, endpointul de scriere aprobat):
```
sha256sum supabase/migrations/20260930i_sec_f1_truncate_revoke.sql      # -> hex aprobat
bash scripts/livrare_migrare.sh --migrare supabase/migrations/20260930i_sec_f1_truncate_revoke.sql \
     --sha256 <hex64> --versiune <AAAALLZZHHMMSS> --tinta-db postgres --tinta-sistem <system_identifier> \
     --tinta-host <host> --tinta-port <port>
# apoi, separat, 20260930j_sec_f2_profiles_uid_null.sql (același tipar)
```
Ordinea F1 → F2 nu contează (independente). `apply_migration` / `execute_sql` MCP **nu** le pot aplica (garda). Preview read-only înainte (aceleași numere ca în §1.1 / §2.1):
```sql
SELECT count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'TRUNCATE')) AS anon,
       count(*) FILTER (WHERE has_table_privilege('authenticated', c.oid, 'TRUNCATE')) AS authenticated, count(*) AS total
  FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p');
SELECT proname, md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('prevent_role_escalation','enforce_owner_only_salary_flags','protect_can_access_pontaj_brut','fn_profiles_campuri_owner_only');
```
După apply: aceleași SELECT-uri (așteptat 0 / 0 / 374; md5 `cf75b37d…`, `daaa5612…`, `2eec050b…`, `c06d7ce0…` neschimbat), `get_advisors`, apoi un test din UI: owner schimbă drepturi în Administrare utilizatori (trebuie să meargă ca înainte); un cont fără is_owner nu poate (ca înainte).

## 5. Decizii pentru Răzvan (nu sunt în patch)
1. GO/NO-GO pe F1 și F2 separat (recomandare: ambele — regresie zero verificată).
2. `MAINTAIN` pentru anon/authenticated (tot din setarea implicită) — de retras într-un patch separat sau nu.
3. Setarea implicită a lui `supabase_admin` (§1.3) — verificare periodică sau cerere la Supabase.
4. Rollback-urile stau în `supabase/migrations/` (convenția de pe `main`); pe branch-ul RSVTI s-a introdus `supabase/revenire/` pentru rollback-uri tehnice — de unificat la merge.

## 6. Runda 2 (30.09.2026) — răspunsul la verdictul review

### 6.1 F1 (GO pe logică, o corectură)
- 3c: `v_sr < v_total - 10` (prea larg) → numărul exact din precondiție (`gazpet.f1_sr_before`, `set_config(…, true)`), postcondiție `v_sr_after IS NOT DISTINCT FROM v_sr_before`.
- 3b rămâne (setarea implicită a lui postgres pe `public` fără TRUNCATE pentru anon/authenticated) + 3d nou: sonda (tabel nou al lui postgres în `public` + într-o schemă de unică folosință, șterse în tranzacție).
- ROLLBACK marcat în antet: revert tehnic, nu exact pentru tabelele create după 30.09, nu se rulează automat.
- **Risc rezidual OPEN**: obiectele create de `supabase_admin` (setarea lui implicită nu se poate schimba ca postgres) — cere acceptarea explicită a lui Răzvan. **Control de drift postflight**, după fiecare deploy/migrare:
  ```sql
  SELECT count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'TRUNCATE')) AS anon,
         count(*) FILTER (WHERE has_table_privilege('authenticated', c.oid, 'TRUNCATE')) AS authenticated
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f');  -- așteptat 0 / 0
  ```

### 6.2 F2 (NO-GO → reparat)
La `auth.uid() IS NULL` trec DOAR: (a) `v_rol = 'service_role' AND session_user = 'authenticator'` (PostgREST); (b) `v_rol IS NULL AND session_user IN ('postgres','supabase_admin')` (conexiune directă). Cele două surse ale rolului (`request.jwt.claim.role`, `request.jwt.claims->>'role'`; JSON invalid în claims ⇒ `auth.uid()` cade primul cu 22P02, fail-closed, înainte ca ramura să fie evaluată — nu „NULL”) nu au voie să se contrazică (ambele nevide și diferite ⇒ 42501). Altfel 42501. Corpurile utilizatorilor reali neschimbate; md5 pre-check-urile pe corpurile live neschimbate (`16112659…`, `0470660c…`, `ff277c90…`); md5 noi (postcondiție + acceptate la reaplicare / ca precondiție în ROLLBACK):
| funcție | md5 prosrc r2 (înlocuit de r3, §7) |
|---|---|
| prevent_role_escalation | `a57629d9181332660443bed7b5eccd5b` |
| enforce_owner_only_salary_flags | `0f66e3367e230fe2b4a271e3387ce10d` |
| protect_can_access_pontaj_brut | `cf47425d97bd9b4b1c03d78bff7b6e6e` |

Întărirea „și `current_setting('role') = 'service_role'` pe ramura (a)” a fost făcută în r3 (§7), după testul cu PostgREST real — care a arătat că fără ea r2 era ocolibil printr-un RPC.

### 6.3 Harness-ul (reluabil)
`bash scripts/test_sec_f1_f2.sh` — cluster PostgreSQL 17 local nou (initdb în director temporar, doar socket unix), refuză dacă `PGHOST` indică o gazdă nelocală, șterge PGHOST/PGUSER/DATABASE_URL etc. Fixture: `supabase/tests/sec_f1_f2_fixture.sql` (roluri, `auth.uid()` stub pe `request.jwt.claim.sub`/`claims`, `profiles`, politici deschise intenționat — se testează triggerele, nu RLS; `service_role` BYPASSRLS ca în Supabase; rolul LOGIN `atacator` cu UPDATE pe profiles) + `supabase/tests/sec_f1_f2_fixture_triggers.sql` (S-A cu md5 `c06d7ce0…`, ACL, cele 4 triggere). Corpurile live ale celor 3 funcții se iau din fișierul ROLLBACK (precondiția 0b verifică md5-ul). Matricea F2 rulează pe **fiecare funcție separat** (doar triggerul ei activ; eroarea trebuie să poarte numele funcției). Generatorul corpurilor F2 (md5 calculat) nu e în repo; md5-urile sunt verificate de postcondiția migrării.

### 6.4 Rezultat r2: 76 PASS / 0 FAIL
| # | caz | așteptat | rezultat (×3 funcții) |
|---|---|---|---|
| F1-a | service_role −1 tabel (REVOKE injectat) | 3c refuză | PASS |
| F1-b | service_role +1 tabel (GRANT injectat) | 3c refuză | PASS |
| F1-c | setare implicită GLOBALĂ postgres cu TRUNCATE (3b n-o vede) | sonda 3d refuză | PASS |
| F1-d | fără pasul 2 | 3b/3d refuză | PASS |
| F1-e | eșecurile nu lasă urme (nici schema-sondă) | — | PASS |
| F1-f | fără runner | garda refuză | PASS |
| F1-g | aplicare | anon/auth 0/0, service_role = înainte, 0 sonde | PASS |
| F1-h | tabel nou postgres după migrare | anon/auth fără TRUNCATE, service_role cu | PASS |
| F1-i | reaplicare | idempotent | PASS |
| F2-7 | utilizatori reali (sub), 9 scenarii owner/non-owner | ieșire IDENTICĂ live vs patch | PASS |
| F2-7b | non-owner refuzat / resetat tăcut; owner schimbă role, is_owner, can_* | — | PASS |
| 1a | postgres→SET ROLE authenticated + claim.role=service_role, fără sub | 42501 | PASS ×3 |
| 1b | rol SQL `atacator` (UPDATE pe profiles) + claim.role=service_role | 42501 | PASS ×3 |
| 1c | `atacator` + claims {role:service_role} | 42501 | PASS ×3 |
| 2 | authenticator→anon + claims anon, fără sub | 42501 | PASS ×3 |
| 3 | authenticator→authenticated, fără sub | 42501 | PASS ×3 |
| 4a/4b | authenticator fără claims (cu/fără SET ROLE service_role) | 42501 | PASS ×3 |
| 5a/5b/5c | PostgREST simulat: login authenticator, SET ROLE service_role, claims service_role (claims / claim.role / ambele) | trece | PASS ×3 |
| 6a/6b | postgres / supabase_admin direct, fără claims | trece | PASS ×3 |
| 6c/6d | postgres direct CU claims anon / service_role | 42501 | PASS ×3 |
| 8a/8b/8c | claims.role ≠ claim.role (ambele sensuri; și ca postgres) | 42501 | PASS ×3 |
| 9a | claims JSON invalid | 22P02 (auth.uid() cade primul — fail-closed) | PASS ×3 |
| 9b | sesiune postgres→SET ROLE authenticated, claims golite | trece (ramura b: session_user postgres — doar un superuser poate face asta) | PASS ×3 |
| 9c | authenticator→authenticated, claims golite | 42501 | PASS ×3 |
| 9d | claims {role:""} + claim.role=service_role, authenticator | trece (rol gol = absent) | PASS ×3 |
| F2-pre | corp live modificat | precondiția 0b refuză | PASS |

Control negativ: aceeași matrice rulată cu corpurile LIVE (F2 neaplicat) lasă să treacă toate cazurile 1a–4b, 6c/6d, 8a–8c — gaura e reală și discriminată de teste.
Validator (`python3 validator.py`): F1 OK 6, F1 ROLLBACK OK 7, F2 OK 7, F2 ROLLBACK OK 7 instrucțiuni.

### 6.5 Neverificabil local
- ~~PostgREST real~~ — verificat în r3 cu PostgREST 13.0.4 (§7).
- Conexiunile reale ale workerului NAS / pg_cron / Supavisor (session_user efectiv) — de confirmat în producție după apply: dacă vreun context legitim primește 42501, mesajul arată rolul JWT și session_user.
- Nimic rulat pe producție (doar SELECT în runda 1).

## 7. Runda 3 (30.09.2026) — ramura (a) legată de rolul SQL efectiv, dovedit cu PostgREST real

**Verdict r2**: F1 GO pe logică (doar formularea din documentație — corectată: rollback-ul F1 e revert tehnic, NU exact, peste tot); F2 NO-GO: ramura (a) trebuie să lege și rolul SQL EFECTIV, nu doar `session_user = 'authenticator'` + claim-ul JWT, cu dovadă pe un PostgREST real.

### 7.1 PostgREST real: ce valori vede o funcție
PostgREST **13.0.4** (release-ul oficial `postgrest-v13.0.4-linux-static-x86-64.tar.xz` de pe GitHub, sha256 binar `22fd686b…c4c6`), cluster PostgreSQL 17 local, `authenticator` LOGIN NOINHERIT cu `anon`/`authenticated`/`service_role` acordate, `jwt-secret` aleator, `auth.uid()` ca în Supabase. Sonda (`scripts/test_sec_f2_postgrest.sh`) apelată prin HTTP `POST /rpc/...`:

| JWT | funcție | session_user | current_user | `current_setting('role')` | `request.jwt.claim.role` | `request.jwt.claims` | auth.uid() |
|---|---|---|---|---|---|---|---|
| anon | INVOKER | authenticator | anon | anon | NULL (nesetat) | `{"exp":…,"role":"anon"}` | NULL |
| anon | DEFINER (sql și plpgsql) | authenticator | **postgres** | anon | NULL | idem | NULL |
| authenticated + sub | INVOKER | authenticator | authenticated | authenticated | NULL | `{"exp":…,"role":"authenticated","sub":"2222…"}` | 2222… |
| authenticated + sub | DEFINER | authenticator | **postgres** | authenticated | NULL | idem | 2222… |
| service_role, fără sub | INVOKER | authenticator | service_role | service_role | NULL | `{"exp":…,"role":"service_role"}` | NULL |
| service_role, fără sub | DEFINER | authenticator | **postgres** | **service_role** | NULL | idem | NULL |

Concluzii: (1) `current_setting('role')` = rolul din JWT și **nu se schimbă** în SECURITY DEFINER (doar `current_user` devine proprietarul) ⇒ e condiția corectă pentru ramura (a). (2) PostgREST 13 nu mai setează GUC-urile vechi `request.jwt.claim.*` — rolul vine doar din `request.jwt.claims`; codul le citește pe ambele (compatibil). (3) `session_user` = `authenticator` pentru toate cererile REST.

**Gaura din r2, reprodusă pe PostgREST real**: un RPC SECURITY INVOKER apelat cu JWT `authenticated` fără sub care face `set_config('request.jwt.claims','{"role":"service_role"}',true)` + `set_config('request.jwt.claim.role','service_role',true)` apoi `UPDATE profiles SET role='owner'` — cu r2 **trecea** (E2E-6 FAIL, rol schimbat în `owner`); cu r3 ⇒ 42501.

### 7.2 Schimbarea r3
Ramura (a): `v_rol = 'service_role' AND session_user = 'authenticator' AND current_setting('role', true) = 'service_role'`. Restul identic cu r2 (ramura b, contradicții, mesaje, corpul pentru utilizatori reali). md5 pre-check pe corpurile live neschimbate; md5 noi (postcondiție migrare, precondiție ROLLBACK):
| funcție | md5 prosrc r3 |
|---|---|
| prevent_role_escalation | `cf75b37d522e2a6b0b9c9eabd72c27b4` |
| enforce_owner_only_salary_flags | `daaa561298c10c259944600e6c39467e` |
| protect_can_access_pontaj_brut | `2eec050b53f37ec995da79e93a2a4686` |

### 7.3 Teste
- `bash scripts/test_sec_f1_f2.sh`: **88 PASS / 0 FAIL** (cele 76 din r2 + 12 noi): 10a authenticator + SET ROLE service_role + claims service_role ⇒ trece; 10b authenticator + SET ROLE authenticated + claims service_role ⇒ 42501; 10c authenticator fără SET ROLE + claims service_role ⇒ 42501; 10d authenticator + SET ROLE anon + claims service_role ⇒ 42501 (×3 funcții).
- `POSTGREST=/cale/postgrest bash scripts/test_sec_f2_postgrest.sh` (opțional, doar local, refuză PGHOST nelocal; exit 3 = SKIP fără binar): **11 PASS / 0 FAIL** — sonda; PATCH service_role pe `role` și `can_*` ⇒ permis (fără resetare); PATCH authenticated non-owner pe `role` ⇒ refuzat; PATCH authenticated fără sub / anon ⇒ 42501; RPC cu `set_config` (doar claim.role — contradicție ⇒ 42501; claims + claim.role consistente ⇒ 42501, oprit DOAR de legarea r3); starea finală fără escaladare. Control: același script cu fișierul r2 (`F2_FILE=…`) ⇒ E2E-6/E2E-7 FAIL.

### 7.4 Neverificabil local
- `session_user` efectiv al conexiunilor Supabase: Supavisor/pooler, pg_cron (`cron.job.username`), workerul NAS, Edge Functions care folosesc conexiune directă în loc de REST — de confirmat în producție după apply; un context legitim refuzat primește 42501 cu rolul JWT și session_user în mesaj.
- Versiunea PostgREST din proiectul Supabase (testat 13.0.4) și eventualul `db-pre-request` configurat de platformă.
- Nimic rulat pe producție; nicio scriere în Supabase.

## 8. Runda 4 (30.09–01.10.2026): a 4-a funcție (`fn_profiles_campuri_owner_only`) + rezidualul SET ROLE

### 8.1 Ce s-a găsit
`fn_profiles_campuri_owner_only()` (triggerul `trg_profiles_campuri_owner_only`, protejează `department` și `employee_id`, SECURITY DEFINER, md5 live `c06d7ce0f212c7bba2093c50614a88fc`, reconfirmat live 30.09) era declarată în r1–r3 „model, nu se atinge”, dar avea exact gaura din r2: `IF v_rol = 'service_role' THEN RETURN NEW;`, fără legare de conexiune sau de rolul efectiv. Vectorul real: un utilizator **cu sub** (non-owner) apelează un RPC SECURITY INVOKER care face `set_config('request.jwt.claims','{"role":"service_role","sub":…}')` + `set_config('request.jwt.claim.role','service_role')`, apoi `UPDATE profiles SET employee_id=…`. Cum `auth.uid()` nu e NULL, celelalte 3 triggere nu intervin pe aceste coloane; decide doar a 4-a — și trecea. (Fără sub, UPDATE-ul era deja oprit de `prevent_role_escalation` r3.)

### 8.2 Schimbarea r4
- Migrarea include acum și a 4-a funcție cu aceeași disciplină: precondiție md5 live `c06d7ce0…` SAU md5 patch (reaplicare), atribute neschimbate (plpgsql, SECDEF, `search_path=public, pg_temp`, proprietar postgres, ACL comparat înainte/după), setul de 4 triggere intact. Singura schimbare în corp: ramura `service_role` devine `v_rol = 'service_role' AND session_user = 'authenticator' AND current_setting('role', true) = 'service_role'`, plus regula „claim.role și claims.role nevide și diferite ⇒ 42501” (aliniată cu celelalte 3). Ramura directă (`v_rol IS NULL AND v_sub IS NULL` + `session_user` postgres/supabase_admin), ramura owner și mesajele rămân identice. Verificarea separată „0c: a 4-a e c06d7ce0…” a fost înlocuită de 0a/0b pe 4 funcții.
- Precondiție nouă **0e**: refuz dacă există funcții SECURITY INVOKER executabile de authenticated/anon care conțin `EXECUTE`/`set_config`/`SET ROLE` (§8.4; extinsă în r5, §8.6).
- ROLLBACK: readuce și a 4-a funcție la corpul live `c06d7ce0…` (precondiție: md5 patch nou sau deja live).

| funcție | md5 live (pre-check / rollback) | md5 patch r4 |
|---|---|---|
| prevent_role_escalation | `16112659be92143e6539ae0e54e47a06` | `cf75b37d522e2a6b0b9c9eabd72c27b4` (neschimbat față de r3) |
| enforce_owner_only_salary_flags | `0470660c0a819981ff914355c7f6d00a` | `daaa561298c10c259944600e6c39467e` (neschimbat) |
| protect_can_access_pontaj_brut | `ff277c90e02ef03d1efb34cd7e87b1d4` | `2eec050b53f37ec995da79e93a2a4686` (neschimbat) |
| fn_profiles_campuri_owner_only | `c06d7ce0f212c7bba2093c50614a88fc` | **`9acc36a4067eddbdf29956220023ea92`** (nou) |

### 8.3 Teste r4 (local, PG 17 + PostgREST 13.0.4)
- `bash scripts/test_sec_f1_f2.sh`: **157 PASS / 0 FAIL**. Nou: fixture = cele 4 md5 live; control „corp live c06d7ce0… ⇒ authenticated + claims service_role schimbă department” (gaura reprodusă); 0e (gadget INVOKER cu `set_config` ⇒ refuz); md5 după apply = cele 4 variante patch; matricea completă (1a…10d) rulată și pe a 4-a funcție, separat pe `department` și pe `employee_id`, plus 11a owner real ⇒ trece, 11b non-owner real ⇒ 42501, 11c anon ⇒ 42501, 11d sub non-owner + claims/claim.role service_role ca authenticated ⇒ 42501 (10a SET ROLE service_role ⇒ trece; 10b SET ROLE authenticated ⇒ 42501; 10c fără SET ROLE ⇒ 42501; 6a postgres direct ⇒ trece); reaplicare idempotentă; rollback ⇒ 4 md5 live + comportament utilizatori reali identic cu live; rollback reaplicat; reapply după rollback; precondiția refuză un corp modificat al celei de-a 4-a (și în rollback).
- `POSTGREST=… bash scripts/test_sec_f2_postgrest.sh`: **16 PASS / 0 FAIL + 1 REZIDUAL ACCEPTAT**. Nou: E2E-8 service_role PATCH department/employee_id ⇒ permis; E2E-9 non-owner PATCH employee_id ⇒ 42501; E2E-10 non-owner (sub) RPC `set_config` claims/claim.role service_role + UPDATE employee_id ⇒ 42501; E2E-11 stare; CONTROL-r3: a 4-a readusă la `c06d7ce0…` ⇒ același RPC schimbă employee_id (gaura reprodusă). RPC-urile de atac sunt create după apply (altfel 0e refuză — exact rolul ei).

### 8.4 Rezidual acceptat: gadget SET ROLE în RPC SECURITY INVOKER
Mecanism: PostgreSQL verifică `SET ROLE` față de `session_user`, nu față de `current_user`. Prin PostgREST `session_user` = `authenticator`, care e membru `service_role`; deci un RPC **SECURITY INVOKER** apelat ca authenticated care face `PERFORM set_config('role','service_role',true)` și își falsifică claims trece toate cele 3 condiții ale ramurii (a) (reprodus: REZIDUAL ACCEPTAT R-1 în `test_sec_f2_postgrest.sh`). În SECURITY DEFINER `SET ROLE` e interzis. Un astfel de gadget ar fi oricum o escaladare mai largă decât profiles (orice tabel ca service_role, peste RLS) — Copilot l-a acceptat explicit ca rezidual, nu blocker.

Audit live read-only (01.10.2026 ~01:40): în `public` 57 funcții INVOKER, 38 executabile de authenticated, **0** care conțin `EXECUTE` sau `set_config` / `SET ROLE`.

SQL de control (read-only) pentru rutina post-deploy — trebuie să întoarcă **0 rânduri**; e exact interogarea precondiției 0e din migrare (varianta r5, §8.6):
```sql
SELECT g.functie
  FROM (SELECT p.oid::regprocedure::text AS functie,
               CASE WHEN p.prokind IN ('f', 'p') THEN pg_get_functiondef(p.oid) END AS def
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname IN ('public', 'graphql_public') AND p.prokind IN ('f', 'p') AND NOT p.prosecdef
           AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) g
 WHERE g.def ~* '\mexecute\M' OR g.def ~* 'set_config' OR g.def ~* 'set\s+(session\s+|local\s+)?role'
 ORDER BY 1;
```

Limitele sunt în §8.6.

### 8.5 Neverificabil local
Aceleași ca §7.4; nimic aplicat pe Supabase.

### 8.6 Runda 5 (01.10.2026) — NO-GO pe 0e, reparat
Verdict: a 4-a funcție, md5-urile și rollback-ul sunt confirmate; NO-GO doar pe precondiția 0e. Fiecare punct, schimbarea și testul:

| # | Problema | Schimbarea r5 | Test |
|---|---|---|---|
| 1 | 0e scana doar `prosrc`; o funcție `LANGUAGE sql BEGIN ATOMIC … END` are corpul în `prosqlbody`, cu `prosrc` gol, deci scăpa | se scanează `pg_get_functiondef(p.oid)`, adică definiția reconstruită (corpul, inclusiv BEGIN ATOMIC, și clauzele `SET` din antet), doar pentru `prokind IN ('f','p')`. `CASE` garantează că nu e evaluată pe agregate/window, unde ar da eroare | harness: gadget BEGIN ATOMIC cu `set_config('role',…)` ⇒ refuz; BEGIN ATOMIC cu `set_config('request.jwt.claims',…)` ⇒ refuz; control: interogarea r4 (prosrc) are 0 potriviri pe același gadget; agregat în `public` ⇒ nu dă eroare, nu blochează |
| 1 | regexul rata `SET SESSION ROLE` | `'set\s+(session\s+\|local\s+)?role'` (plus `'\mexecute\M'`, `'set_config'`) | gadget plpgsql `SET SESSION ROLE` ⇒ refuz; `SET LOCAL ROLE` ⇒ refuz; `EXECUTE` dinamic ⇒ refuz; clauză `SET role = …` în antet (proconfig) ⇒ refuz |
| 1 | doar schema `public` | `public` ȘI `graphql_public` (ambele expuse de PostgREST) | funcție în `graphql_public` cu `EXECUTE` ⇒ refuz |
| 2 | teste | 9 cazuri de refuz, fiecare gadget creat ÎNAINTE de apply și șters după, cu numele funcției verificat în mesaj; plus un caz negativ: SECURITY DEFINER cu `set_config`, `EXECUTE` revocat de la PUBLIC, schemă neexpusă, agregat ⇒ F2 se aplică | `test_sec_f1_f2.sh` |
| 3 | fals-pozitive | **rămân fail-closed intenționat** (comentariu cu „execute”, `set_config` inofensiv, o funcție al cărei nume conține `set_config`, `RESET ROLE`). La refuz, un om analizează lista de funcții din mesajul 0e și decide: rescrie funcția, îi revocă EXECUTE de la anon/authenticated sau o face SECURITY DEFINER. Regexul nu se relaxează | fals-pozitiv „comentariu cu execute” ⇒ refuz (documentat ca așteptat) |
| 4 | R-1 verifica doar răspunsul; mesajul E2E-7 promitea mai mult decât verifica | R-1 recitește rândul din BD după cererea REST (persistare: `department` D_SR → `rezidual`). E2E-7 verifică explicit `role`, `is_owner`, `can_access_salarii`, `can_access_pontaj_brut`, `can_access_financiar`, `can_modify_employees`; `department`/`employee_id` sunt verificate în E2E-11, înainte de R-1/CONTROL-r3, care le modifică intenționat | `test_sec_f2_postgrest.sh` |
| 5 | doc | SQL-ul de control din §8.4 = interogarea nouă 0e | — |

Limite cunoscute (neacoperite de 0e, intenționat):
- **Scheme de platformă Supabase: `extensions`, `storage`, `realtime`** (și altele interne). Funcțiile de aici sunt ale platformei, schemele nu sunt expuse de PostgREST (`db-schemas` = public, graphql_public), iar noi nu le modificăm. Scanarea live din 01.10 (făcută de coordonator) a găsit 12 potriviri de platformă, de exemplu `realtime.apply_rls`, care face `SET ROLE`. Lista exactă o dă interogarea de mai jos (aceeași logică, pe schemele neexpuse); o recitim la fiecare upgrade de platformă, doar ca informare, nu ca blocaj:
```sql
SELECT n.nspname, p.oid::regprocedure AS functie, p.prosecdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname IN ('extensions', 'storage', 'realtime') AND p.prokind IN ('f', 'p')
   AND (CASE WHEN p.prokind IN ('f', 'p') THEN pg_get_functiondef(p.oid) END) ~* '(\mexecute\M|set_config|set\s+(session\s+|local\s+)?role)'
 ORDER BY 1, 2;
```
- **Apelurile indirecte sunt acoperite doar parțial.** O funcție expusă (public/graphql_public) care cheamă un helper INVOKER din altă schemă, iar helperul face `SET ROLE`/`set_config('role',…)`, nu e prinsă decât dacă textul funcției expuse conține el însuși unul dintre tipare. 0e nu urmărește graful de apeluri.
- Detecția e textuală: un gadget scris ocolind tiparele (de ex. un apel dinamic construit prin concatenare într-o funcție din altă schemă) nu e prins. De aceea rezidualul rămâne „acceptat și monitorizat”, nu „eliminat”.

Rezultate r5 (local, PG 17 + PostgREST 13.0.4):
- `bash scripts/test_sec_f1_f2.sh`: **167 PASS / 0 FAIL** (157 din r4, din care cazul 0e unic e înlocuit de 9 cazuri de refuz + controlul prosrc + cazul negativ).
- `POSTGREST=… bash scripts/test_sec_f2_postgrest.sh`: **16 PASS / 0 FAIL**, plus „REZIDUAL ACCEPTAT R-1”, cu persistarea verificată (nu contează ca FAIL).
- Nimic rulat pe Supabase. Interogarea 0e nouă se rulează pe live de coordonator și trebuie să întoarcă 0 rânduri.
