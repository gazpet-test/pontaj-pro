# Matricea de acces efectiv pe obiectele sensibile — producție `dxczwkbciseqniprspcu`

> **DOAR READ-ONLY, pregătire pentru decizia lui Răzvan.** Nu s-a aplicat niciun REVOKE, GRANT, UPDATE sau apel de funcție care scrie. Toate interogările sunt SELECT pe cataloage + numărători agregate. **Nu am citit și nu afișez nicio valoare sensibilă** (IBAN, CNP, token, parolă, email complet) — doar existența, tipul coloanei și numărul de rânduri.
> Investigație: 29.09.2026 ~22:00–23:00 UTC. Extindere a incidentului OPEN din `INCIDENT_EGRESS_2026-09-25.md` §5 și a inventarului din `SECURITATE_ADVISORS_2026-09-30.md`. Verdictul Copilot cerea „privilegiu efectiv + RLS + politica actorului, nu doar GRANT" — asta livrează acest fișier.

---

## Revizia 2 (30.09): corecturile Copilot

Verdict Copilot: „GO CU CORECTURI ca bază pentru decizia lui Răzvan" (`SECURITATE_MATRICE_ACCES_VERDICT_COPILOT.md`). Toate verificările noi sunt read-only (cataloage + `count(*)`; simulările în `SET TRANSACTION READ ONLY` + `SET LOCAL ROLE`). Nicio valoare sensibilă citită.

| Punct Copilot | Schimbare în v2 |
|---|---|
| FORCE RLS / BYPASSRLS | §0 pct. 2 rescris: FORCE fără politică = refuz și pentru proprietarul tabelului (dacă n-are BYPASSRLS); BYPASSRLS sare RLS, dar **nu dă privilegii**. Retras „`supabase_read_only_user` scrie tot": are SELECT pe 370 tabele (prin `pg_read_all_data`), scriere pe **0**. Ownerul aplicației (`is_owner`) nu trece automat: 9 tabele cu GRANT îi întorc mai puțin decât totalul + 13 fără GRANT (§0.3). |
| Roluri, `roleid → member` | Corectat: `authenticator` e **membru** (member) în `anon`/`authenticated`/`service_role` (roleid), `inherit=false`, `set=true`; nu invers. `anon`/`authenticated` nu sunt membri în niciun rol. Privilegiu efectiv = direct + PUBLIC + coloane: PUBLIC are 0 granturi pe tabele `public`; granturi pe coloane doar la `iot_dispozitive` (redundante). |
| Simularea | §0.4 nou: ce demonstrează / ce nu (PostgREST, Storage, edge; `session_user` rămâne `postgres`); tabelele goale (65) nu dovedesc nici acces, nici refuz. |
| §1.1 vs S-A | Corectat: 3 triggere vechi sar verificarea când `auth.uid()` e NULL; S-A g (live, `md5(prosrc)=c06d7ce0…`) verifică explicit identitatea. Corpurile celor 4 descrise exact. |
| TRUNCATE | §2 #9 corectat: ocolește RLS și triggerele DELETE, **execută** triggerele ON TRUNCATE. Singurul în `public`: `ofertare_derogari_audit` (J05). |
| Scrieri | Coloanele I/U/D = **permis structural** (GRANT + politică). „Demonstrat dinamic local" doar unde există harness local (S-A pe `profiles`). Nicio scriere testată în producție. |
| 297/324 | Recalculat: **297/348 ≈ 85,3%** (definiție exactă în §0.5); 297/370 ≈ 80,3% din toate tabelele. „324" nu e reproductibil; „77%" era greșit aritmetic. |
| `contracte_terti` | Rândul arată permisiunea efectivă: I/U/D = ✅ Y (politica ALL permisivă anulează porțile stricte). |
| Token/PIN activ | Criteriu real: token concediu = `activ` (fără expirare/folosire) → 117 (105 la angajați activi); QR-PIN = `qr_pin + qr_pin_active + employees.active` → **44** (nu 49). |
| Lipsuri | §5 nou: excepțiile INSERT pentru anon (enumerare), `v_ofertare_identitate_tokens` ca anon (0/212), RPC/edge/URL semnate, metadate Storage vs descărcare. §6 nou: reconcilierea #1 cu 30a (Sarcina 2). |

---

## §0. Definiția „accesibil" și metoda

**„Accesibil" pentru un actor pe o operație** = are TOATE trei:
1. **privilegiu efectiv** — `has_table_privilege(actor, tabel, op)` = true. Include GRANT direct, GRANT către `PUBLIC`, moștenire și granturi pe coloane. *(v2, corectat)* În `pg_auth_members` (roleid = rolul acordat, member = cine îl primește): `authenticator` (LOGIN, NOINHERIT) e **membru** în `anon`, `authenticated`, `service_role` cu `inherit=false, set=true` — poate face `SET ROLE` în ele, nu le moștenește privilegiile. `anon` și `authenticated` **nu sunt membri în niciun rol** (au ca membri pe `authenticator` și `postgres`). Deci privilegiul lor efectiv = GRANT direct + PUBLIC + coloane. Verificat: `PUBLIC` are 0 granturi pe tabelele/view-urile din `public`; granturi pe coloane există doar la `iot_dispozitive` (UPDATE pe 3 coloane, redundante cu UPDATE pe tabel). PUBLIC contează la **funcții** (EXECUTE implicit) și scheme.
2. **RLS** *(v2, corectat)* — cu RLS activ și nicio politică aplicabilă, accesul e **refuzat** (default-deny), oricâte GRANT-uri ar fi; GRANT-ul e necesar, nu suficient. Proprietarul tabelului (`postgres`) e scutit de RLS doar dacă tabelul **nu** e FORCE; cu FORCE și fără politică e refuzat și el — cu excepția rolurilor BYPASSRLS. **BYPASSRLS** înseamnă doar „politicile nu se aplică"; **nu acordă** privilegii: rolul tot are nevoie de GRANT (sau de `pg_read_all_data`) ca să citească/scrie.
3. **politica aplicabilă** — am evaluat fiecare expresie `USING`/`WITH CHECK`. Legenda verdictului:

| Cod | Ce verifică politica | Cine trece |
|---|---|---|
| **Y** | `true` / `auth.uid() IS NOT NULL` / echivalent | oricine e logat |
| **O** | rând propriu (`user_id/profile_id/uploadat_de = auth.uid()`) sau owner | proprietarul rândului + owner |
| **R** | filtru pe conținut (`privat=false`, `persoana_nume IS NULL`, join la acces) | oricine logat, dar doar pe subsetul permis |
| **C/B** | membru/admin de chat | doar membrii chat-ului |
| **S** | flag **auto-atribuibil** (`can_manage_stoc`, `can_use_document_scanner`) | oricine și-l pune singur (vezi §2 escaladare) |
| **M** | `fn_are_acces_ofertare()` = owner SAU modulul `ofertare` în `user_module_access` | modulul Ofertare |
| **A** | `poate_edita_documente_firma()` = owner SAU `administrativ`/`administrativ.documente` admin/editor | modulul Administrativ |
| **F** | owner sau flag protejat de trigger (`can_access_salarii/personal_data/pontaj_brut/financiar/diurne`, `can_modify_employees`, `can_manage_contracts`, roluri) | doar cei îndreptățiți |
| **-** | fără GRANT sau fără politică → neaccesibil prin API |

**Verificarea decisivă (citire, nu scriere):** am simulat actorul „authenticated fără niciun modul" (contul real de test `test.fara.modul@…`: `role=manager_santier`, `is_owner=false`, 0 module, 0 flaguri, 0 site-uri — exact ce creează `handle_new_user`) prin `SET LOCAL ROLE authenticated` + `request.jwt.claims` cu `sub`-ul lui, și am numărat rândurile efectiv întoarse de fiecare tabel și bucket. La fel pentru `anon`.

**Interogări folosite (toate read-only):** `pg_roles`, `pg_auth_members`, `pg_class.relacl`/`relrowsecurity`/`relforcerowsecurity`, `pg_policies`, `pg_proc` (`prosecdef`, `proconfig`, `prosrc`), `pg_trigger`/`pg_get_triggerdef`, `pg_default_acl`, `pg_attribute.attacl`, `has_table_privilege`/`has_function_privilege`/`has_schema_privilege`/`has_column_privilege`, `information_schema.columns`, `storage.buckets`, `storage.objects` (doar `count` + `sum(size)`), `count(*)` agregat pe date. Definițiile citite nu conțin secrete.

**Actori:** `anon` · `authenticated` fără modul (`manager_santier` nou) · `authenticated` cu modulul relevant · `owner` (`is_owner`) · `service_role`.

### §0.3 Roluri privilegiate și ownerul aplicației (v2)
| Rol | BYPASSRLS | Ce poate efectiv (catalog 30.09) |
|---|---|---|
| `service_role` | da | SELECT pe 370/370 tabele, INSERT pe 367/370 — prin GRANT-uri, nu prin BYPASSRLS. Actor legitim de infrastructură (edge). |
| `postgres` | da (NOSUPERUSER) | proprietarul tabelelor + membru `pg_read_all_data`; RLS nu i se aplică. |
| `supabase_admin` | superuser | tot. |
| `supabase_read_only_user` | da | **doar citire**: SELECT pe 370 prin `pg_read_all_data`; INSERT/UPDATE/DELETE pe **0** tabele. *(afirmația v1 „scrie tot" — retrasă)* |
| owner aplicație (`is_owner`, rulează ca `authenticated`) | nu | trece **doar** politicile care îl includ explicit sau sunt „Y". Simulare read-only: vede mai puțin decât totalul pe 9 tabele cu GRANT (`olx_tokens`, `rag_qr_log`, `storage_rls_errors`, `iot_privat_acces` 1/2, `_backup_acoperire_racari_20260921`, `_backup_clar63_20260927`, 3× `_eval_*`) și 0 pe 13 tabele fără GRANT (12 `_backup_*`, `app_secrets`). La scriere, triggerele (ex. auditul J05, înghețul Ofertare) îl pot refuza și pe el. |

### §0.4 Ce demonstrează simularea și ce nu (v2)
- `SET LOCAL ROLE authenticated` + `request.jwt.claims` reproduce **evaluarea** RLS + GRANT pentru acel `sub`; `current_user` devine rolul API, dar **`session_user` rămâne `postgres`** (verificat). Funcțiile care decid pe `session_user` (ex. `fn_profiles_campuri_owner_only` când lipsesc claims) se pot comporta altfel decât prin PostgREST (unde login-ul e `authenticator`).
- Nu reproduce: PostgREST (parsare, `max_rows`, GUC-uri per cerere, mapare erori), serverul Storage (descărcarea obiectului, URL-uri semnate), edge functions (rulează cu cheia lor, adesea service_role).
- **Zero rânduri pe un tabel gol ≠ lipsă de acces.** 65 de tabele au 0 rânduri; pentru ele verdictul e doar structural (politică + GRANT). Pentru tabelele nevide, zero rânduri întoarse = refuz demonstrat pentru acel actor.
- Doar **citirea** e demonstrată dinamic. INSERT/UPDATE/DELETE din §1 sunt **permise structural**; niciuna nu a fost încercată în producție.

### §0.5 Numărătoarea „Y" (v2, recalculată)
- **Numărător 297** = tabelele din `public` cu (a) ≥1 politică PERMISSIVE pentru SELECT/ALL aplicabilă lui `authenticated` (rol `authenticated` sau `public`) cu expresia `true` sau `auth.uid() IS NOT NULL`, (b) GRANT SELECT pentru `authenticated`, (c) fără politici RESTRICTIVE (există 0 pe SELECT). 299 au politica, 2 backup-uri n-au GRANT → 297.
- **Numitor 348** = tabelele pe care **cel puțin un** cont logat le poate citi prin API (GRANT SELECT + ≥1 politică permisivă SELECT/ALL pentru `authenticated`). **297/348 ≈ 85,3%.** Raportat la toate cele 370: 80,3%.
- Confirmare dinamică (cont fără modul, read-only): din cele 297, **241 nevide sunt vizibile integral** (vizibil = total, 241/241); 56 sunt goale (doar structural). Nicio tabelă non-Y nu e vizibilă integral; 4 parțial (`ai_documente_inbox` 3/1296, `contab_expert_linii` 1327/1684, `iot_citiri`, `iot_dispozitive`). Total: 245 tabele întorc rânduri, 416.127 din 475.288.

**Cifre de ansamblu (efectiv, nu doar GRANT):**
- `public`: **370 tabele** (toate RLS on; 12 FORCE = doar `_backup_*`), **134 view-uri** (toate `security_invoker=on` — corect).
- `anon` logat de pe internet: GRANT SELECT pe 332 tabele, dar **0 rânduri efectiv vizibile** (nicio politică `anon`, cu 16 excepții de INSERT — vezi §2) și **0 obiecte Storage**. Semnătura de bază Supabase e respectată pentru anon la citire.
- `authenticated` fără modul: **245 tabele întorc rânduri (416.055 rânduri)** din 357 cu GRANT; **20 de bucket-uri Storage, ~5,07 GB**.
- **297 din 348 tabele citibile prin API (≈85,3%) sunt „Y" la SELECT** = orice cont logat le citește integral *(v2; v1 scria greșit „297/~324 ≈ 77%")*.

---

## §1. Matricea obiect × operație × actor

Coloana „actor decisiv" arată cel mai slab actor care **trece**. `anon`=❌ peste tot la citire/scriere (fără politici), cu excepțiile INSERT din §2. `service_role`=✅ unde are GRANT (370 SELECT / 367 INSERT); `owner` ✅ doar unde politica îl include (excepțiile în §0.3). Coloanele S/I/U/D = SELECT/INSERT/UPDATE/DELETE pentru **authenticated fără modul**. **S** = demonstrat dinamic (citire read-only); **I/U/D = permis structural** (GRANT + politică), nedemonstrat prin scriere în producție. Excepție „demonstrat dinamic local": `profiles` (harness S-A, PG16 local, 154/193 aserțiuni).

### 1.1 `profiles` / `user_module_access` / `profile_sites` / `app_modules` — grup **profiles/escaladare**

| Obiect | S | I | U | D | Sensib. | Note |
|---|---|---|---|---|---|---|
| `profiles` (31 rânduri, toate cu email; 2 owneri) | ✅ Y (toate 31) | ⚠️ owner | ⚠️ **rând propriu** (`profiles_update_own`) + owner | ❌ owner | **critic** | Oricine logat vede toate profilurile. `profiles_update_own` (`auth.uid()=id`) lasă orice user să-și modifice **propriul** rând → vezi escaladarea din §2. |
| `user_module_access` (156) | ✅ Y (toate) | ❌ owner | ❌ owner | ❌ owner | **critic** | Scrierea e strict owner (corect). Citirea e deschisă: oricine vede cine ce modul are. |
| `profile_sites` (52) | ✅ Y | ❌ owner | ❌ owner | ❌ owner | ridicat | idem — scriere owner-only, citire deschisă. |
| `app_modules` (38) | ✅ Y | ❌ owner | ❌ owner | ❌ owner | mediu | catalog module; scriere owner-only. |

**Triggere de protecție pe `profiles` (toate SECURITY DEFINER, owner `postgres`, `search_path` setat) — CONFIRMATE active (`tgenabled='O'`):**
- `prevent_role_escalation` → blochează `role` și `is_owner` pentru non-owner.
- `enforce_owner_only_salary_flags` → blochează `is_owner, can_access_salarii, can_access_personal_data, can_access_pontaj_brut, can_modify_employees, can_manage_contracts, can_access_diurne, can_access_financiar`.
- `protect_can_access_pontaj_brut` → dublează protecția pe `can_access_pontaj_brut`.
- `trg_profiles_campuri_owner_only` (`fn_profiles_campuri_owner_only`, S-A g, live, `md5(prosrc)=c06d7ce0f212c7bba2093c50614a88fc` = migrarea testată) → blochează `department` și `employee_id`.

*(v2, corectat — v1 spunea greșit că toate patru sar verificarea.)* Corpurile citite din catalog:

| Trigger (BEFORE UPDATE, FOR EACH ROW) | Când lipsește `auth.uid()` | Ce face |
|---|---|---|
| `prevent_role_escalation_trigger` | **RETURN NEW** (sare) | dacă `role` sau `is_owner` se schimbă și apelantul nu e owner → RAISE |
| `trg_enforce_owner_only_salary_flags` | **RETURN NEW** (sare) | apelant non-owner → **resetare tăcută** la OLD pentru `is_owner, can_access_salarii, can_access_personal_data, can_access_pontaj_brut, can_modify_employees, can_manage_contracts, can_access_diurne, can_access_financiar` (fără eroare) |
| `trg_protect_can_access_pontaj_brut` | **RETURN NEW** (sare) | `can_access_pontaj_brut` schimbat de non-owner → RAISE |
| `trg_profiles_campuri_owner_only` (S-A g) | **NU sare** | dacă `department`/`employee_id` se schimbă, trece doar: claims `role=service_role`; claims `authenticated` + `sub` al unui owner; fără claims **și** `session_user IN (postgres, supabase_admin)`. Orice altceva (anon, non-owner, claims fără `sub`, login `authenticator`/`supabase_auth_admin` fără claims) → 42501 |

„`auth.uid()` NULL" nu înseamnă doar service_role: e NULL și pentru **anon** (JWT fără `sub`). La primele 3, un apel anon care ar ajunge la `profiles` printr-o funcție DEFINER ar trece; azi e latent (RLS n-are politică anon; singura funcție care scrie `profiles` e `handle_new_user`, INSERT).

**Gaura de escaladare (§2, expunerea #1):** flagurile **NU** acoperite de niciun trigger, deci **auto-atribuibile** de orice user pe propriul rând via `profiles_update_own`: `can_manage_stoc`, `can_create_comenzi`, `can_process_achizitii`, `can_access_ctc`, `can_use_document_scanner`, toate `receive_tichete_*`, `receive_bonuri_consum`, `whatsapp_enabled`, `whatsapp_tier`, `phone_whatsapp`.

### 1.2 Date de personal — grup **RLS citire + Storage** / **RSVTI+jurnal**

| Obiect | Sensib. | authenticated fără modul | Actor legitim |
|---|---|---|---|
| `employees` (172) | **critic** | **S=✅ Y (toate 172, din care 149 cu IBAN, 120 telefon; QR-PIN valabile = 44** după criteriul `fn_qr_lookup_pin`: `qr_pin + qr_pin_active + active`; 49 nenule) — opțiuni interimare: `SECURITATE_EMPLOYEES_OPTIUNI_INTERIMARE.md`; I/U=⚠️ `owner\|can_modify_employees`; D=owner | oricine logat citește **IBAN-uri + telefoane + QR-PIN-uri** |
| `hr_employees_private` (19: CNP, adresă, dată naștere) | **critic** | **S/I/U=❌ `owner\|can_access_personal_data`**; D=owner. Efectiv: **0 rânduri vizibile** pt. contul fără modul | corect gated |
| `employee_salaries` (120) | **critic** | ❌ `owner\|can_access_salarii` (0 vizibile) | corect |
| `salarii_stat_linii` (118), `salarii_importuri`, `hr_salarii_audit` (215) | **critic** | ❌ `owner\|can_access_salarii` (0 vizibile) | corect |
| `diurna_payments` / `diurna_payment_details` (23/1674) | ridicat | ❌ `owner\|salarii\|diurne` (0 vizibile) | corect |
| `pontaj_records` (21.928) | ridicat | **S=✅ Y (toate)**; I/U=`owner\|can_access_pontaj_brut`; D=owner | oricine logat citește tot pontajul |
| `pontaj_brut_istoric`/`pontaj_net_istoric`/`supliment_hrana_istoric` | ridicat | ❌ `owner\|can_access_pontaj_brut` (0 vizibile) | corect |
| `hr_documente_personale` (4137) | **critic** | ❌ `owner\|can_access_personal_data` (0 vizibile) | corect |
| `hr_ci_extrase` (9: extrase CI) | **critic** | ❌ `owner\|can_access_personal_data` (0 vizibile) | corect |
| `hr_recrutare_candidati`/`_interactiuni` (42/49) | ridicat | ❌ `owner\|can_access_personal_data` (0 vizibile) | corect |
| `hr_autorizatii` (560) | ridicat | **S=✅ Y (toate)**; scriere `owner\|can_modify_employees\|superadmin\|dept HR/Administrativ` | citire deschisă |
| `hr_autorizatii_rsvti_confirmari` (9) — jurnal RSVTI | **critic** | **S=✅ Y; I=✅ Y (`auth.uid() IS NOT NULL`)** | **oricine logat poate falsifica jurnalul de vize RSVTI direct** (vezi §2 #4) |
| `hr_recomandari` (32), `hr_personal_extern` (25) | mediu | S/I/U=✅ Y | citire+scriere deschise |
| `hr_concediu_tokens` (117: token/angajat) | **critic** | **S=✅ Y (toate 117)**; criteriul real al edge-ului `concediu-mobil`: `token` + `activ=true`, fără expirare, fără folosire unică, fără verificarea `employees.active` → **117 valabile** (105 la angajați activi, 12 la inactivi) | vezi §2 #2 — tokenurile deschid `/co` public |
| `ordine_deplasare_arhiva` (259) | ridicat | ❌ `owner\|can_access_personal_data` (0 vizibile) | corect |
| `hr_employees_audit` (11) | mediu | S=✅ Y | jurnal ștergeri angajați, citibil |

### 1.3 Tabele cu tokenuri / secrete — grup **RLS citire + Storage**

Coloane cu nume de tip token/secret/key/refresh și cine le citește **efectiv**:

| Tabel.coloană | anon | auth fără modul | Expus efectiv? |
|---|---|---|---|
| `app_secrets` (key, **value**, 2 rânduri) | ❌ fără GRANT | ❌ fără GRANT (0 col) | **NU** — REVOKE corect, doar postgres/service_role. |
| `olx_tokens` (access_token, refresh_token, 1 rând) | GRANT ALL, dar RLS 0 politici | GRANT SELECT, RLS 0 politici → **0 rânduri** | **NU prin API** (RLS blochează), dar **igienă proastă**: GRANT ALL încă pe anon/authenticated. Tokenurile n-au fost citite. |
| `hr_concediu_tokens` (**token**, 117) | ❌ | **✅ Y — 117 tokenuri citibile** | **DA** (ridicat — vezi §2 #2) |
| `employees.qr_pin` (44 valabile, 49 nenule) | ❌ | **✅ Y — citibile** | **DA** (ridicat — vezi §2 #3) |
| `iot_integrari` (config jsonb: `salus.pin_hash`, `tuya/vicare client_id`, `audi.tokens`) | ❌ | **✅ Y** (`auth.uid() IS NOT NULL`) | **DA parțial** — configurări integrări citibile de orice cont logat; `audi.tokens` e null acum, `salus.pin_hash` prezent. Mediu. |
| `sedinte_rsvp.token` (uuid, 6) | ❌ | ✅ Y | DA, low. Valabilitate = existența tokenului (fără expirare; `fn_sedinte_rsvp_submit`, EXECUTE anon) → 6. |
| `v_ofertare_identitate_tokens` (view, coloană `token`) | GRANT da, **0/212 rânduri** (verificat v2) | ✅ | **NU e secret**: „token" = cuvinte din `ofertare_licitatii.obiect/autoritate` (potrivire lexicală). Vezi §5.2. |
| `settings.value` (iban_firma etc.), `logistica_setari`, `necesar_setari` | ❌ | ✅ Y | valori de config, nu secrete reutilizabile; `settings.iban_firma` = IBAN firmă (public pe facturi). Mediu-low. |
| coloane `*tokens_in/out`, `total_tokens` (contoare AI) | — | ✅ | irelevant (numere de tokeni AI, nu secrete). |

### 1.4 Storage — grup **RLS citire + Storage**

37 bucket-uri, **toate `public=false`**. `anon` vede **0 obiecte / 0 bucket-uri**. `authenticated` fără modul vede **20 bucket-uri, ~5,07 GB**. Verdict per operație pentru authenticated fără modul:

| Bucket | obj / MB | S | I | U | D | Sensib. | Verdict |
|---|---|---|---|---|---|---|---|
| `documente-flota` | 1258 / 460 | ✅Y | ✅Y | ✅Y | ✅Y | ridicat | **oricine logat citește ȘI șterge** documente flotă |
| `executie-contracte` | 184 / 1494 | ✅Y | ✅Y | ✅Y | ✅Y | ridicat | idem — contracte execuție, RW complet |
| `rapoarte-zilnice` | 682 / 279 | ✅Y | ✅Y | ✅Y | ✅Y | mediu | RW complet |
| `ai-documente-inbox` | 60 / 15 | ✅Y | ✅Y | ✅Y | ✅Y | ridicat | conține scanuri HR (53 obiecte cu `modul_tinta=hr`), RW complet |
| `facturi-emise` | 78 / 19 | ✅Y | ✅Y | ✅Y | ✅Y | ridicat | facturi, RW complet |
| `executie-pachete-pdf` | 27 / 5 | ✅Y | ✅Y | ✅Y | ✅Y | mediu | RW complet |
| `service-fise-documente` | 1 | ✅Y | ✅Y | ✅Y | ✅Y | mediu | RW complet |
| `productie` | 4 | ✅Y | ✅Y | ✅Y | ✅Y | mediu | RW complet |
| `documente-upa` | 0 | ✅Y | ✅Y | ✅Y | ✅Y | mediu | RW complet |
| `comenzi-furnizor` | 719 / 338 | ✅Y | ✅Y | — | ⚠️owner | ridicat | citire+upload oricine; delete owner |
| `autorizatii` | 417 / 212 | ✅Y | ✅Y | — | ✅Y | ridicat | citire+upload+**delete** oricine (fără U) |
| `contracte-terti` | 149 / 296 | ✅Y | ⚠️`owner\|can_manage_contracts` | ⚠️ | ⚠️owner | ridicat | **citire deschisă** oricui; scriere gated |
| `documente-firma` | 100 / 99 | ✅Y | ⚠️A | ⚠️A | ⚠️A | ridicat | **citire deschisă**; scriere `poate_edita_documente_firma()` |
| `documente-proiect` | 1535 / 1463 | ✅Y | ❌ | ❌ | ❌ | mediu | doar citire, oricine logat |
| `executie-borderouri` | 78 / 45 | ✅Y | ✅Y | ✅Y | ⚠️owner | mediu | RW; delete owner |
| `qr-bonuri` | 511 / 58 | ✅Y | ✅Y | — | ⚠️`owner\|admin_logistica` | mediu | citire+upload oricine |
| `tichete-atasamente` | 182 / 22 | ✅Y | ✅Y | — | ⚠️`owner\|rând propriu` | mediu | citire+upload oricine |
| `packing-lists` | 6 | ✅Y | ✅Y | ✅Y | ⚠️owner | low | |
| `avize` | 23 | ✅Y | ✅Y | — | — | low | |
| `sedinte-pdf` | 7 | ✅Y | ✅Y | ✅Y | — | low | |
| `templates` | 2 | ✅Y | ⚠️`owner\|superadmin` | ⚠️ | ⚠️ | low | citire deschisă |
| **Gated corect (0 vizibile pt. fără modul):** | | | | | | | |
| `documente-personal` | 4213 / 1860 | ❌F | ❌F | ❌F | ❌F | **critic** | `owner\|can_access_personal_data` — corect |
| `ofertare` | 1483 / 6249 | ❌M | ❌M | ❌M | ❌M | ridicat | `fn_are_acces_ofertare()` + îngheț pachet — corect |
| `contracte-comodat` | 24 | ❌F | ❌F | ❌F | ❌F | ridicat | `owner\|personal_data\|admin_logistica` |
| `ordine-deplasare-pdf` | 259 / 57 | ❌F | ❌F | ❌F | ❌F | ridicat | `owner\|can_access_personal_data` |
| `pontaj-brut-istoric` / `pontaj-net-istoric` | 105/17 | ❌F | ❌F | — | ❌F | ridicat | `owner\|can_access_pontaj_brut` |
| `supliment-hrana-istoric` | 13 | ❌F | ❌F | — | ❌F | mediu | idem |
| `whatsapp-motorina-bonuri` | 833 / 156 | ❌F | ❌F | ❌F | ❌F | mediu | `owner\|admin_logistica` |
| `hr-semnaturi` | 15 | ⚠️F/O | ⚠️F/O | ❌F | ❌F | ridicat | `personal_data` sau folderul propriu (`my_employee_id`) |
| `recrutare-cv` | 45 / 17 | ❌F | — | — | — | ridicat | doar `owner\|can_access_personal_data` la citire |
| `cladire-camere`, `documente-amc`, `oferte`, `tichete`, `probe-citiri`, `chat-imagini` | 0–2 | vezi note | | | | low | fără politici sau goale |

### 1.5 Financiar / comercial — grup **RLS citire + Storage** (și **Ofertare-autorizare** pentru prețuri)

| Obiect | S | I | U | D | Sensib. |
|---|---|---|---|---|---|
| `facturi_emise` (77) | ✅Y | ✅Y | ✅Y | ⚠️owner | ridicat |
| `facturi_serii_counter` | ✅Y | — | ✅Y | — | low |
| `contracte_terti` (85) | ✅Y | ✅ **Y efectiv** | ✅ **Y efectiv** | ✅ **Y efectiv** | ridicat — *(v2)* politica permisivă `contracte_terti_write` (ALL, `auth.uid() IS NOT NULL`) se cumulează prin OR cu `_insert/_update/_delete` (`owner\|can_manage_contracts`, owner) → porțile stricte nu au efect |
| `contracte_linii` (1) | ✅Y | ⚠️`owner\|can_manage_contracts` | ⚠️ | ⚠️owner | mediu |
| `contracte_acte_aditionale` (24) | ✅Y | ⚠️`owner\|can_manage_contracts` | ⚠️ | ⚠️owner | mediu |
| `contracte_polite`/`_acte`, `gbe_polite`/`_restituiri`, `garantii` (16) | ✅Y | ✅Y | ✅Y | ✅Y | mediu | RW complet oricine logat |
| `contracte_subcontract_facturi` (113)/`_import` | ✅Y | ✅Y | ✅Y | ✅Y | mediu | RW complet |
| `comenzi_furnizor` (135) + `_linii` (368) | ✅Y | ✅Y (ALL=Y) | ✅Y | ✅Y | ridicat | RW complet oricine logat |
| `comenzi_furnizor_documente` (258) | ✅Y | ✅Y | ⚠️O | ⚠️O | mediu | |
| `comenzi_furnizor_aprobari` (91) | ✅Y | ✅Y | ⚠️O/aprobator | ⚠️owner | ridicat | oricine logat poate INSERT aprobare |
| `executie_situatii_plata` (44) + `_linii` (128) | ✅Y | ✅Y | ✅Y | ✅Y | ridicat | certificate/situații de plată, RW complet |
| `trezorerie_conturi` (33, **IBAN**) + `_extras_linii` (33) | ✅Y | ✅Y | ✅Y | ✅Y | **critic** | **IBAN-uri conturi + extrase, RW complet oricine logat** |
| `contab_expert_linii` (1684) | ⚠️R (`persoana_nume IS NULL`) + salarii pt. restul | — | — | — | ridicat | liniile cu nume de persoană doar `owner\|can_access_salarii`; restul deschis |
| `ofertare_preturi_materiale` (3860), `_preturi_unitare` (24) | ✅Y | ✅Y (ALL=Y) | ✅Y | ✅Y | ridicat | **prețuri unitare, RW complet oricine logat** (nu gated pe Ofertare!) |
| `ofertare_oferte_furnizori` (2400) | ✅Y | ✅Y | ✅Y | ✅Y | ridicat | oferte furnizori, RW complet (politici `public`, `auth.uid()`) |
| `ofertare_cantitati` (2155) | ✅Y | ⚠️M | ⚠️M | ⚠️M | mediu | scriere gated pe Ofertare; citire deschisă |
| `ofertare_parteneri`, `_calibrari_subcontractori`, `oferta_materiale`, `probe_oferte`, `ofertare_oferte_deschidere`, `ofertare_rfq_oferte/_preturi` | ✅Y | ✅Y | ✅Y | ✅Y | mediu | RW complet oricine logat |

### 1.6 Stoc / transferuri — grup **stoc/transferuri**

| Obiect | S | I | U | D | Note |
|---|---|---|---|---|---|
| `stocuri` (445) | ✅Y | ✅Y | ✅Y | ✅Y | `stocuri_write` ALL=`auth.uid()` → orice cont logat modifică stocul direct prin REST |
| `stocuri_miscari` (668) | ✅Y | ✅Y (`sm_insert`=Y) | ⚠️owner | ⚠️owner | INSERT deschis → falsificare mișcări direct, nu doar prin `fn_stoc_ajustare` |
| `transferuri_interne` (55) + `_linii` (171) | ✅Y | ✅Y | ✅Y | ✅Y | RW complet oricine logat |
| `magazii` (25), `consumuri_proiect`/`_linii` | ✅Y | ⚠️`owner\|can_manage_stoc`(S) | idem | idem | scriere gated pe `can_manage_stoc` (dar auto-atribuibil, §2 #1) |

### 1.7 Ofertare autorizare + RSVTI — grup **Ofertare-autorizare** / **RSVTI+jurnal**

Cele 5 RPC-uri SECURITY DEFINER confirmate în `SECURITATE_ADVISORS_2026-09-30.md` §2A rămân neschimbate (verificat: `confirm_hr_autorizatie_rsvti`, `fn_ofertare_alege_acoperire`, `ofertare_inventar_pereche` — fără poartă de rol; `fn_stoc_ajustare`, `fn_transfer_executa` — fără poartă, RLS permite oricum). Nu le reiau în detaliu aici; sunt reflectate în expunerile §2. Notabil: `ofertare_licitatii` UPDATE = `fn_are_acces_ofertare() OR modul financiar`; DELETE = owner.

---

## §2. Top 10 expuneri, după gravitate (cu dovada)

**Critic** = schimbare de privilegii / secrete reutilizabile / ștergeri-modificări majore. **Ridicat** = citire neautorizată de date sensibile.

**#1 — CRITIC — Auto-escaladare de flaguri operaționale pe propriul profil.**
Politica `profiles_update_own` = `USING (auth.uid() = id) WITH CHECK (auth.uid() = id)` lasă orice user să-și modifice propriul rând. Cele 4 triggere de protecție acoperă doar `role, is_owner, salariile/personal_data/pontaj_brut/contracts/diurne/financiar, department, employee_id`. **Rămân neprotejate și auto-atribuibile:** `can_manage_stoc`, `can_create_comenzi`, `can_process_achizitii`, `can_access_ctc`, `can_use_document_scanner`, `receive_*`. Consecințe: cu `can_manage_stoc` treci porțile pe `magazii/consumuri/fn_stoc_ajustare`; cu `can_use_document_scanner` pornești edge-urile HR plătite (`hr-autorizatie-citeste`, `hr-recomandare-citeste`) care citesc scanuri din `documente-personal`. Azi 14 non-owneri au `can_manage_stoc` (nu se poate dovedi cine i-a pus). Dovadă: `pg_policies profiles_update_own` + lipsa flagurilor din corpul celor 4 triggere (`enforce_owner_only_salary_flags`, `prevent_role_escalation`, `protect_can_access_pontaj_brut`, `fn_profiles_campuri_owner_only`).

**#2 — RIDICAT/CRITIC — 117 tokenuri de concediu valabile (criteriul edge: `activ`), citibile de orice cont logat.**
`hr_concediu_tokens` (coloana `token`, 117 rânduri active): `hr_tokens_sel` = `SELECT USING (auth.uid() IS NOT NULL)`. Tokenul e cheia paginii **publice** `/co?t=TOKEN` (`ConcediuMobilPage.jsx` → edge `concediu-mobil`, `verify_jwt=false`), care permite depunerea de cereri de concediu în numele angajatului. Un cont logat oarecare poate lista toate cele 117 tokenuri și depune/vizualiza cereri pentru oricine. Dovadă: politica `hr_tokens_sel` + `concediu-mobil` fără JWT.

**#3 — RIDICAT — QR-PIN-urile șoferilor + IBAN/telefoane citibile de orice cont logat.**
`employees` `SELECT USING (true)`: 172 rânduri, din care **149 cu IBAN, 120 telefoane, 44 QR-PIN valabile** (49 nenule). PIN-urile deschid fluxurile QR (`qr-alimentare-submit`, `qr-bon-comun-lookup`, `verify_jwt=false`). `trezorerie_conturi` (33 IBAN) e nu doar citibilă ci **RW complet** (`trez_conturi_rw` ALL=`auth.uid()`). Dovadă: `employees_select_all_authenticated`=`true`, `trez_conturi_rw`.

**#4 — CRITIC — Jurnalul de vize RSVTI se poate falsifica direct.**
`hr_autorizatii_rsvti_confirmari` `INSERT WITH CHECK (auth.uid() IS NOT NULL)` + `confirm_hr_autorizatie_rsvti` (DEFINER, fără poartă de rol) care face UPDATE pe `hr_autorizatii.rsvti_*`. Orice cont logat prelungește o viză RSVTI cu orice dată (inclusiv viitoare) și scrie în jurnal, ascunzând o viză expirată. `hr_autorizatii` are și `SELECT USING (true)` (560 rânduri vizibile). Dovadă: politica INSERT + corpul RPC din inventarul precedent.

**#5 — CRITIC — Stoc și transferuri modificabile de orice cont logat (direct prin REST).**
`stocuri` (`stocuri_write` ALL=`auth.uid()`), `stocuri_miscari` (`sm_insert`=`auth.uid()`), `transferuri_interne`/`_linii` (ALL=`auth.uid()`). Un patch doar pe `fn_stoc_ajustare`/`fn_transfer_executa` NU închide calea — REST-ul direct face același lucru. Dovadă: politicile de mai sus.

**#6 — CRITIC — Financiar-comercial cu RW complet pentru orice cont logat.**
`executie_situatii_plata`/`_linii`, `comenzi_furnizor`/`_linii`, `facturi_emise` (I/U deschise), `contracte_subcontract_facturi`, `ofertare_preturi_materiale`/`_unitare`, `ofertare_oferte_furnizori`, `garantii`, `gbe_*` — toate cu politici `auth.uid() IS NOT NULL`/`true`. Prețurile unitare și oferta furnizorilor (avantaj comercial la licitații) se pot citi ȘI rescrie. Notă: pe `contracte_terti` politica strictă `contracte_terti_insert/update/delete` (`owner|can_manage_contracts`) e **anulată** de politica permisivă `contracte_terti_write` ALL=`auth.uid()` (politicile permisive se cumulează cu OR). Dovadă: `pg_policies` pe aceste tabele.

**#7 — RIDICAT — Storage: buckete cu RW complet și citire deschisă pentru orice cont logat.**
`documente-flota`, `executie-contracte` (1,5 GB contracte), `ai-documente-inbox` (53 scanuri HR), `facturi-emise`, `rapoarte-zilnice` — S/I/U/D toate `bucket_id=...` fără verificare de rol → oricine logat poate șterge/suprascrie. `contracte-terti`, `documente-firma`, `documente-proiect`, `comenzi-furnizor`, `autorizatii` — citire deschisă oricui logat. Dovadă: politicile pe `storage.objects`.

**#8 — RIDICAT — `ai-documente-inbox`: scanuri HR vizibile prin poartă permisivă.**
`ai_documente_inbox` SELECT = `uploadat_de=auth.uid() OR modul_tinta IS NULL OR fn_ai_inbox_poate_confirma(modul_tinta, entitate_id)`. Ramura `modul_tinta IS NULL` (3 rânduri „nedecise") + bucketul deschis fac ca scanuri să fie accesibile mai larg decât HR. 1275 de rânduri au `modul_tinta=hr`; 53 obiecte HR sunt în bucketul deschis la S/I/U/D. Dovadă: `fn_ai_inbox_poate_confirma` (întoarce true când `p_modul IS NULL`).

**#9 — CRITIC (latent) — TRUNCATE + MAINTAIN/REFERENCES/TRIGGER pe ~toată schema.**
Default privileges pentru rolul `postgres` în `public` acordă `anon`+`authenticated` **`arwdDxtm`** la fiecare tabel nou. Efectiv: **anon TRUNCATE pe 332 tabele, authenticated pe 340**; MAINTAIN 332/344; REFERENCES/TRIGGER 332. *(v2, corectat)* TRUNCATE ocolește RLS și **nu** declanșează triggerele DELETE/de rând, dar **execută triggerele ON TRUNCATE** (statement-level). În `public` există unul singur: `trg_ofertare_derogari_audit_imuabil` pe `ofertare_derogari_audit` (J05, BEFORE DELETE OR UPDATE OR TRUNCATE → RAISE 42501); în plus acolo nici anon, nici authenticated n-au TRUNCATE. (Alt trigger TRUNCATE: `cron.job`, sistem.) TRUNCATE mai e blocat de FK-uri fără CASCADE. **Latent** azi: nicio funcție DEFINER apelabilă de anon/auth face TRUNCATE, iar PostgREST nu poate emite TRUNCATE (confirmat: singurele DEFINER cu SQL dinamic sunt `fn_completare_aplica` — cu poartă și `%I` — și `fn_tichete_notif_on_insert` — neapelabilă). Rămâne lipsă de apărare în profunzime. Dovadă: `pg_default_acl` (postgres, public, tables = `anon=arwdDxtm, authenticated=arwdDxtm`).

**#10 — MEDIU — `net` (pg_net) accesibil larg; `olx_tokens` GRANT ALL rezidual.**
`net.http_post/get/delete/collect_response` au EXECUTE pt. `anon`+`authenticated`, iar `net._http_response` (617 rânduri) are ACL `PUBLIC=arwdDxtm` cu `USAGE` pe schema `net` pentru anon/auth — potențial pot fi citite corpuri de răspuns ale apelurilor HTTP ieșite (posibil cu secrete în headere/URL). Reachable doar prin SQL direct/funcție INVOKER, nu prin PostgREST (schema `net` nu e expusă), deci latent ca #9 — de verificat (§4). `olx_tokens` păstrează GRANT ALL pe anon/authenticated (blocat doar de RLS fără politici); de aliniat la `app_secrets` (REVOKE). Dovadă: `has_function_privilege` pe `net.*`, `relacl` pe `net._http_response`, `pg_class.relacl` pe `olx_tokens`.

---

## §3. Propunere de acces legitim per obiect prioritar (pentru decizia lui Răzvan — NU decizie)

Fiecare rând e o **întrebare pentru tine**, nu o schimbare. Nimic nu se aplică fără „da" explicit + preview→confirm→apply.

| Obiect | Cine are nevoie legitim (propunere) | De ce |
|---|---|---|
| `profiles` flaguri operaționale | Doar ownerul le setează (mută-le sub `enforce_owner_only_salary_flags` sau într-un trigger nou). Auto-editarea proprie rămâne doar pt. `email_notifications_*`, `phone_whatsapp`, nume. | Un flag care deschide bani/stoc/AI plătit nu poate fi auto-acordat. |
| `hr_concediu_tokens` | citire: `owner\|can_access_personal_data\|dept HR`. Validarea tokenului rămâne în edge (service_role). | Tokenul e echivalent cu identitatea angajatului la depunere concediu. |
| `employees` (IBAN/telefon/qr_pin) | citire completă: HR/salarizare/owner. Restul angajaților: doar coloane neutre (nume, funcție, departament) printr-un view. `qr_pin`: doar `admin_logistica`+owner. | IBAN/PIN nu trebuie la orice cont logat. |
| `trezorerie_conturi`/`_extras` | `owner\|can_access_financiar` (citire+scriere). | Conturi bancare + extrase = date financiare. |
| `hr_autorizatii_rsvti_confirmari` + `confirm_hr_autorizatie_rsvti` | scriere: `owner\|can_modify_employees\|dept HR/Administrativ`; dată ≤ azi. INSERT direct în jurnal restrâns la aceiași. | Integritatea vizelor RSVTI (siguranță). |
| `hr_autorizatii` (citire) | `owner\|HR\|Administrativ\|admin_logistica` (au nevoie de vize la planificare); nu chiar oricine. | Vize = date de personal. |
| stoc (`stocuri`,`stocuri_miscari`,`transferuri_*`) | scriere: `owner\|can_manage_stoc` (+`admin_logistica`/`achizitii` de decis A/B/C); RLS pe tabele, nu doar pe RPC. | Închide și calea REST directă. |
| financiar-comercial (`facturi_emise`, `executie_situatii_plata*`, `comenzi_furnizor*`, `contracte_*`) | scriere: rolurile care chiar operează (financiar/contabilitate/achiziții/owner); citire: de restrâns la cei cu treabă. | Avantaj comercial + integritate documente. |
| `ofertare_preturi_*`, `ofertare_oferte_furnizori`, `ofertare_cantitati` | `fn_are_acces_ofertare()` la citire ȘI scriere (nu doar la scriere pe unele). | Prețurile/ofertele sunt miezul competitiv Ofertare. |
| Storage RW-deschis (`documente-flota`, `executie-contracte`, `ai-documente-inbox`, `facturi-emise`, `rapoarte-zilnice`, `comenzi-furnizor`, `autorizatii`, `contracte-terti`, `documente-firma`) | citire+scriere pe modulul respectiv (logistică/execuție/HR/financiar/administrativ), nu „orice cont logat". | Documente reale ale firmei; DELETE deschis e periculos. |
| TRUNCATE/MAINTAIN/default privileges | REVOKE de la anon+authenticated pe toată schema + `ALTER DEFAULT PRIVILEGES` (P14 din inventar). Regresie zero (nimic nu face TRUNCATE). | Apărare în profunzime. |
| `olx_tokens`, `iot_integrari` | REVOKE ALL anon/auth pe `olx_tokens`; `iot_integrari` citire doar owner/admin_logistica. | Igienă secrete/config. |
| `net.*` / `net._http_response` | de restrâns EXECUTE și SELECT la service_role/postgres (dacă nimic din UI nu le cheamă direct). | Posibil leak de corpuri de răspuns HTTP. |

**Ordinea sugerată de patch-uri (grupurile cerute):** (1) **profiles/escaladare** (#1 — cel mai ieftin, oprește auto-acordarea) → (2) **RSVTI+jurnal** (#4) + **Ofertare-autorizare** (cele 5 RPC, risc de regresie mic) → (3) **RLS citire + Storage** pe datele critice (`hr_concediu_tokens`, `employees` IBAN/PIN, `trezorerie`, buckete RW-deschise) → (4) **stoc/transferuri** (cere decizia A/B/C) → (5) **TRUNCATE/default privileges** (regresie zero). Toate separat, cu teste pe calea REST directă, nu doar pe RPC/UI.

---

## §4. Ce n-am putut verifica (limite)

- **Cine a pus flagurile** (`can_manage_stoc` la 14 non-owneri etc.): `profiles` nu are istoric/audit; nu se poate atribui. La fel, `user_module_access.granted_by` există dar n-am corelat.
- **Exploatare efectivă**: am confirmat *posibilitatea* structurală (privilegiu+RLS+politică), nu că cineva a abuzat. Indiciile din inventarul precedent (§2 acolo) au dat 0, dar verificările sunt limitate (jurnale falsificabile, fără istoric pe `profiles`).
- ~~`v_ofertare_identitate_tokens`~~ — închis în v2 (§5.2).
- **`net._http_response`** conținut: am confirmat GRANT-ul și 617 rânduri, dar **nu am citit** corpurile (ar putea conține secrete) — nu știu dacă rețin efectiv tokenuri; de verificat cu grijă (fără a afișa valori).
- **Cron (`cron.job`)**: RLS on, `authenticated`/`anon` fără GRANT de citire (doar `supabase_admin`/`postgres`); nu am putut lista comenzile cron ca să confirm cu ce identitate rulează joburile (ex. `heartbeat_alerta`) — rămâne întrebarea din inventar despre chei în text în comenzile cron.
- **Politici pe partiții `realtime.messages_*`**: `anon/authenticated` au `arw` pe `realtime.messages` (RLS on, politici gestionate de Supabase); n-am evaluat politicile realtime — în afara scopului.
- **Efectiv vs. `authenticator`**: vezi §0.4 (limitele simulării).
- **Coloane sensibile numărate, nu citite**: „cu IBAN=149" etc. sunt `count(*) FILTER (WHERE col IS NOT NULL)`; n-am extras nicio valoare.

---

## §5. Completări v2 (lipsurile semnalate de Copilot)

### 5.1 „Excepțiile INSERT pentru anon" — enumerare exactă
Cifra „16" din v1 **nu e reproductibilă** din catalog; o înlocuiesc cu lista completă. Anon are GRANT INSERT pe 332 de tabele, dar trece doar politicile al căror rol include `anon` (direct sau prin `public`). Toate sunt enumerate mai jos; **niciuna nu dă INSERT efectiv lui anon**, pentru că fiecare expresie cere `auth.uid()` nenul sau un profil, iar pentru anon (JWT fără `sub`) `auth.uid()` e NULL (verificat read-only: `auth.uid()=NULL`, `auth.role()='anon'`). Restrictivele nu acordă nimic singure.

| Tabel | Politică (cmd) | WITH CHECK |
|---|---|---|
| `_dedup_racari_20260911` | `dedup_racari_rw` (ALL) | `auth.uid() IS NOT NULL` |
| `claude_docs` | `claude_docs_insert_owners` | EXISTS profil owner |
| `contracte_templates` | `ctpl_ins` | `auth.uid() IS NOT NULL` |
| `executie_ordine_detectate` | `ord_det_insert` | `auth.uid() IS NOT NULL` |
| `hr_documente_personale` | `hr_docp_insert_policy` | profil `can_access_personal_data\|is_owner` |
| `hr_documente_personale_tipuri` | `hr_docp_tipuri_modify_policy` (ALL) | idem (USING) |
| `hr_semnaturi_electronice` | `hr_sem_insert_policy` | idem |
| `locatii_cheltuieli` / `locatii_furnizori` / `locatii_inchiriate` | `*_all` (ALL) | `auth.uid() IS NOT NULL` |
| `marketing_postari` / `marketing_santiere` | `mk_post_ins` / `mk_sant_ins` | `auth.uid() IS NOT NULL` |
| `ofertare_brokeri` | `brokeri_all` (ALL) | `auth.uid() IS NOT NULL` |
| `ofertare_calibrari_subcontractori` | `ocs_ins` | `auth.uid() IS NOT NULL` |
| `ofertare_cerinte` | `ofertare_cerinte_fara_pack_direct` (**RESTRICTIVE**, `{anon,authenticated}`) | `sursa_pack_id IS NULL` — nu acordă |
| `ofertare_cerinte_pozitii` | `ofertare_cerinte_pozitii_insert` | `fn_are_acces_ofertare()` |
| `ofertare_oferte_furnizori` | `oof_ins` | `auth.uid() IS NOT NULL` |
| `pontaj_brut_istoric` / `pontaj_net_istoric` / `supliment_hrana_istoric` | `*_insert` | profil `can_access_pontaj_brut\|is_owner` |
| `procese_heartbeat` | `heartbeat_rw` (ALL) | `auth.uid() IS NOT NULL` |
| `sedinte_rsvp` | `sedinte_rsvp_all` (ALL) | `auth.uid() IS NOT NULL` |
| `upa_achizitii` | `upa_achizitii_all` (ALL) | `auth.uid() IS NOT NULL` |
| `storage.objects` (7) | `Pontaj brut/net insert authorized`, `Supliment hrana insert authorized`, `documente_personal_insert`, `hr_semnaturi_insert`, `avize_authenticated_insert` (`auth.role()='authenticated'`), `upa docs authenticated all` | toate cer profil / `authenticated` / `auth.uid()` |

Scrieri reale ale lui anon există doar prin **RPC** (vezi 5.3): `fn_sedinte_rsvp_submit` (intenționat) și `heartbeat_alerta` (PUBLIC).

### 5.2 `v_ofertare_identitate_tokens` ca anon
Read-only (`SET TRANSACTION READ ONLY; SET LOCAL ROLE anon`, claims `{"role":"anon"}`; verificat `current_user=anon`, `session_user=postgres`, `transaction_read_only=on`): anon are GRANT SELECT, view-ul e `security_invoker=on`, rezultat **0 rânduri** din **212** (sursa `ofertare_licitatii`: 88 rânduri, anon vede 0) → refuzul e demonstrat, nu efect de tabel gol. Coloana `token` = cuvinte extrase din `obiect`/`autoritate` ale licitațiilor (identificare lexicală), **nu credențial**.

### 5.3 Căi prin RPC, edge și URL-uri semnate
**RPC (SECURITY DEFINER apelabile din API) care ating obiectele din top 10** — pe lângă cele 5 din `SECURITATE_ADVISORS_2026-09-30.md` §2A (`confirm_hr_autorizatie_rsvti` #4, `fn_stoc_ajustare`/`fn_transfer_executa` #5, `fn_ofertare_alege_acoperire`, `ofertare_inventar_pereche` #6):
- `fn_qr_lookup_pin(text)` (citește `employees.qr_pin`) — EXECUTE doar `postgres`/`service_role` → **nu** e oracol de PIN din API. ✅
- `fn_sedinte_rsvp_submit(uuid,text)` — anon, UPDATE pe `sedinte_rsvp` prin token (intenționat).
- `heartbeat_alerta` / `heartbeat_muti` — PUBLIC (vezi advisors #P11).
- `fn_bonuri_consum_notif_on_insert` (singura funcție care citește `receive_bonuri_consum`) — trigger, neapelabilă.
- Nicio funcție DB nu citește `phone_whatsapp`/`whatsapp_enabled`/`whatsapp_tier`.

**Edge cu `verify_jwt=false`:** live sunt **65** din 140; în `supabase/functions` (repo) sunt 28 dintre ele. Cele din repo sunt porțite prin antet-secret verificat în Vault (`fn_verifica_radar_secret`/`_fisier_secret`/`iot_secret_get`: `dovezi-valabilitate-alerta`, `nas-upload-url`, `ofertare-*` cron, `olx-aplicari-sync`, `vercel-relay`, `iot-*`, `salus`/`tuya`/`vicare`) sau prin `getUser` + verificare de rol în cod (`hr-extrage-ci`, `ofertare-document-nou-citeste`). Observații:
| Edge (repo) | Poartă | Atinge | Notă |
|---|---|---|---|
| `hr-autorizatii-scan` | `x-hr-secret` vs `SEAP_IMPORT_SECRET` | `hr_documente_personale`, URL semnate 3600 s pe scanuri HR | secret comun cu importul SEAP |
| `hr-digest-saptamanal` | `x-hr-secret` — compară și cu o **constantă din cod** | `hr_autorizatii`, `hr_documente_personale` | constanta e în repo (valoarea nu se reproduce aici) → de mutat în Vault |
| `ofertare-garantie-mail` | `getUser` doar (orice cont logat) | `ofertare_garantii`, bucket `ofertare`, trimite mail | de verificat poarta de rol (pct. 7 CLAUDE.md) |
| `ofertare-fisier-semnat` / `nas-upload-url` | secret Vault | generează URL semnate (`ofertare`, orice bucket cerut) | cine are secretul are descărcare |
| `recrutare-aplica` | public (intenționat) | INSERT candidați + upload CV | formular public |
Live, **în afara repo** (cod citit read-only, valori nereproduse): `concediu-mobil` (token concediu, #2), `qr-alimentare-submit` (PIN prin `fn_qr_lookup_pin`, #3), `chuck_norris_hr_bot` (antet-secret cu **valoare de rezervă scrisă în cod**), `detect_plate_orphan_msgs` (rol owner/admin_logistica **sau antet de ocolire cu constantă în cod** → pornește procesare AI plătită + UPDATE `logistica_alimentari`). `notify-whatsapp` are `verify_jwt=true` dar **nicio verificare de rol**: orice JWT valid — inclusiv cheia anon, publică — poate trimite template-uri WhatsApp de pe numărul firmei către **orice număr** (`recipient_phone`, `force=true` ocolește test_mode). Restul de ~35 de edge-uri live cu `verify_jwt=false` fără cod în repo (ex. `tmp-dl`, `tmp-dc-up`, `tmp-copy-paza`, `tmp-probe-url`, `fisier-intern`, `qr-bon-comun-lookup`, `qr-utilaj-info`, `nightly_patrol_bot`, `extract_external_bon`, `cleanup-recycle-bin`) — **neinspectate**; `tmp-*` sunt candidate la ștergere (decizia lui Răzvan).

**URL-uri semnate:** un URL semnat e purtător (bearer) până la expirare, fără altă autentificare. Se generează fie de client (Storage cere SELECT pe obiect conform politicii `storage.objects`), fie de edge cu service_role (fără RLS; poarta e doar cea din edge). Durate găsite în repo: 300 s (`iot-camera`), 600 s (`nas-upload-url`), 900 s (`meta-publish`), 3600 s (`hr-autorizatii-scan`), `minute*60` configurabil (`ofertare-fisier-semnat`). Nepersistarea URL-urilor semnate în tabele nu a fost verificată exhaustiv.

### 5.4 Storage: metadate vs descărcare
- **Metadate** = rândurile din `storage.objects` (nume, dimensiune, mimetype, owner). Cifrele din §1.4 (20 bucket-uri, ~5,07 GB pentru contul fără modul) sunt **numărători pe metadate** sub simularea RLS — asta e ce s-a demonstrat.
- **Descărcarea** trece prin serverul Storage, care aplică **aceeași** politică SELECT pe `storage.objects` cu JWT-ul utilizatorului (doc. Supabase Storage Access Control: select → download și list; insert → upload; update+select+insert → upsert; delete → remove). Deci: cine vede metadatele unui obiect îl poate descărca — **permis structural, nedemonstrat** (nu s-a descărcat nimic, conform cerinței).
- Toate cele 37 de bucket-uri sunt `public=false` → fără URL public; singurele ocoliri ale politicii sunt URL-urile semnate (5.3) și edge-urile cu service_role.
- Schema `storage` nu e expusă prin PostgREST; lista/descărcarea se fac doar prin API-ul Storage.

---

## §6. Reconcilierea #1 (profiles) cu 30a (Sarcina 2)

Sursa 30a: `supabase/migrations/20260930a_profiles_campuri_owner_only_extins.sql` de pe `claude/erp-continuare-x4p5a7-sa-profiles` (`7a36257`), citit din git, **nemodificat**. Pe rândul propriu, orice cont logat are UPDATE pe **toate** cele 32 de coloane (GRANT tabel + `profiles_update_own`: `USING/WITH CHECK auth.uid() = id`). Legendă: **P** = protejată azi · **P30a** = protejată doar după 30a · **I** = auto-editabilă inofensivă · **R** = auto-editabilă **cu risc**.

| Coloană | Protecție azi (live) | 30a | Clasificare |
|---|---|---|---|
| `id` | WITH CHECK `auth.uid()=id` | — | P |
| `email` | — | da | **R** → P30a (identitate în căutări + destinatar mail) |
| `name` | — | — | I (afișare; atenție: apare în notificări/semnături) |
| `role` | `prevent_role_escalation` (RAISE) | — | P |
| `department` | S-A g (RAISE) | da | P |
| `created_at` | — | — | I |
| `email_notifications_enabled`, `email_notifications_logistica` | — | — | I (doar preferințe proprii) |
| `is_owner` | 2 triggere | — | P |
| `can_access_salarii`, `can_access_personal_data`, `can_modify_employees`, `can_manage_contracts`, `can_access_diurne`, `can_access_financiar` | `enforce_owner_only_salary_flags` (resetare tăcută) | — | P |
| `can_access_pontaj_brut` | 2 triggere | — | P |
| `can_use_document_scanner`, `can_create_comenzi`, `can_process_achizitii`, `can_manage_stoc`, `can_access_ctc` | — | da | **R** → P30a |
| `receive_tichete_logistica/_hr/_administrativ/_it/_comercial/_financiar` | — | da | **R** → P30a (citire tichete altor departamente) |
| `receive_bonuri_consum` | — | da | **R** → P30a |
| `whatsapp_tier` | — | da | **R** (mic) → P30a |
| `whatsapp_enabled` | — | **nu** | I azi (vezi mai jos) |
| `phone_whatsapp` | — | **nu** | **R (latent)** — vezi mai jos |
| `employee_id` | S-A g (RAISE) | da | P |

**Cum folosește codul câmpurile în discuție:**
- `receive_bonuri_consum`: `src/ConsumuriBonuriTab.jsx:90` îl citește, `:118` `canPrelua = is_owner || receive_bonuri_consum` → dă dreptul de **preluare** a bonurilor de consum (din UI); în BD îl citește doar triggerul `fn_bonuri_consum_notif_on_insert` (notificări către destinatari). Acordă o capabilitate → corect inclus în 30a.
- `whatsapp_enabled`, `whatsapp_tier`, `phone_whatsapp`: în repo apar doar în formularul Admin → Editează manager (`src/App.jsx:6668-6675` scrie; `:7481-7535` UI; `whatsapp_tier` scris doar dacă editorul e owner, dar asta e verificare UI, nu BD). Nicio funcție DB și niciun edge din repo nu le citește. Live, singurul consumator găsit e edge-ul `notify-whatsapp` (nu e în repo): **trimite** template-uri către `phone_whatsapp` al unui `recipient_user_id`, dacă `whatsapp_enabled` și `whatsapp_tier ≠ 'info'`. `notification_logs` are 1 rând și niciun apelant în cod → sistemul e practic inactiv.
- **Bot-ul WhatsApp identifică utilizatorul după `phone_whatsapp`? NU (după ce am găsit).** Fluxul WhatsApp de motorină e un **import de arhivă exportată** (`ImportWhatsAppModal.jsx`, `whatsapp_messages_processed`) care potrivește după **numele autorului** din chat și plăcuța detectată de AI (`detect_plate_orphan_msgs`), nu după telefon. Nu există webhook de mesaje WhatsApp primite (nici în repo, nici printre edge-urile live inspectate). Deci azi nu e posibilă preluarea identității prin `phone_whatsapp`.
- **Ce se întâmplă dacă un cont își pune numărul altcuiva:** azi, nimic automat (niciun apelant). Dacă `notify-whatsapp` e pornit pe viitor, notificările destinate contului respectiv (conținut intern: tichete, alerte) ar pleca spre numărul ales — **rutare greșită / scurgere către un terț**, nu preluare de identitate. Dacă se construiește vreodată un bot de intrare care identifică după telefon, câmpul devine **credențial** și auto-editarea lui = preluare de identitate.

**Concluzie (propunere, fără a modifica 30a):**
1. #1 **nu e acoperit integral de 30a**: rămân auto-editabile `phone_whatsapp` și `whatsapp_enabled`. Propun adăugarea lor la lista 30a (sau într-o 30b) — cost mic: singurul editor legitim e ownerul prin Admin (`App.jsx:6668-6672`), deci nicio regresie.
2. Alternativă dacă Răzvan vrea ca angajatul să-și seteze singur numărul: păstrat auto-editabil, dar orice viitor consumator (`notify-whatsapp`, bot) trebuie să-l trateze ca **neverificat** (confirmare prin cod OTP înainte de rutare).
3. Separat de 30a: `notify-whatsapp` trebuie porțit pe rol (owner/service_role) — azi e apelabil cu cheia anon (§5.3).
4. 30a nu repară datele existente (21 de non-owneri cu flaguri active) — preview → confirmare → apply, decizia lui Răzvan.

---

*Fișier generat read-only (v1 29.09, v2 30.09). Nu s-a aplicat nicio migrare, nicio scriere în producție.*
