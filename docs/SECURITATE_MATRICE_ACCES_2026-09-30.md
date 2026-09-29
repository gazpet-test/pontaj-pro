# Matricea de acces efectiv pe obiectele sensibile — producție `dxczwkbciseqniprspcu`

> **DOAR READ-ONLY, pregătire pentru decizia lui Răzvan.** Nu s-a aplicat niciun REVOKE, GRANT, UPDATE sau apel de funcție care scrie. Toate interogările sunt SELECT pe cataloage + numărători agregate. **Nu am citit și nu afișez nicio valoare sensibilă** (IBAN, CNP, token, parolă, email complet) — doar existența, tipul coloanei și numărul de rânduri.
> Investigație: 29.09.2026 ~22:00–23:00 UTC. Extindere a incidentului OPEN din `INCIDENT_EGRESS_2026-09-25.md` §5 și a inventarului din `SECURITATE_ADVISORS_2026-09-30.md`. Verdictul Copilot cerea „privilegiu efectiv + RLS + politica actorului, nu doar GRANT" — asta livrează acest fișier.

---

## §0. Definiția „accesibil" și metoda

**„Accesibil" pentru un actor pe o operație** = are TOATE trei:
1. **privilegiu efectiv** — `has_table_privilege(actor, tabel, op)` = true (GRANT direct, prin default privileges, sau moștenit de rol). Am verificat și `pg_auth_members`: `anon` și `authenticated` **nu moștenesc** de la alt rol (sunt doar membri `noinherit` ai lui `authenticator`), deci privilegiul efectiv = privilegiul direct.
2. **RLS** — dacă RLS e activ (toate cele 370 de tabele `public` îl au) fără nicio politică pentru actor → **NEACCESIBIL** prin API, oricâte GRANT-uri ar fi. Dacă RLS e inactiv sau tabelul e FORCE fără politică, contează doar GRANT-ul.
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

**Verificarea decisivă (nu doar teoretică):** am simulat actorul „authenticated fără niciun modul" (contul real de test `test.fara.modul@…`: `role=manager_santier`, `is_owner=false`, 0 module, 0 flaguri, 0 site-uri — exact ce creează `handle_new_user`) prin `SET LOCAL ROLE authenticated` + `request.jwt.claims` cu `sub`-ul lui, și am numărat rândurile efectiv întoarse de fiecare tabel și bucket. La fel pentru `anon`.

**Interogări folosite (toate read-only):** `pg_roles`, `pg_auth_members`, `pg_class.relacl`/`relrowsecurity`/`relforcerowsecurity`, `pg_policies`, `pg_proc` (`prosecdef`, `proconfig`, `prosrc`), `pg_trigger`/`pg_get_triggerdef`, `pg_default_acl`, `pg_attribute.attacl`, `has_table_privilege`/`has_function_privilege`/`has_schema_privilege`/`has_column_privilege`, `information_schema.columns`, `storage.buckets`, `storage.objects` (doar `count` + `sum(size)`), `count(*)` agregat pe date. Definițiile citite nu conțin secrete.

**Actori:** `anon` · `authenticated` fără modul (`manager_santier` nou) · `authenticated` cu modulul relevant · `owner` (`is_owner`) · `service_role` (**BYPASSRLS — notat, actor legitim de infrastructură, nu „neîndreptățit"**; vede și scrie tot, la fel `postgres`/`supabase_admin`/`supabase_read_only_user` care au BYPASSRLS).

**Cifre de ansamblu (efectiv, nu doar GRANT):**
- `public`: **370 tabele** (toate RLS on; 12 FORCE = doar `_backup_*`), **134 view-uri** (toate `security_invoker=on` — corect).
- `anon` logat de pe internet: GRANT SELECT pe 332 tabele, dar **0 rânduri efectiv vizibile** (nicio politică `anon`, cu 16 excepții de INSERT — vezi §2) și **0 obiecte Storage**. Semnătura de bază Supabase e respectată pentru anon la citire.
- `authenticated` fără modul: **245 tabele întorc rânduri (416.055 rânduri)** din 357 cu GRANT; **20 de bucket-uri Storage, ~5,07 GB**.
- **≈77% din tabele (297 din ~324 cu politici de citire) sunt „Y" la SELECT** = orice cont logat le citește integral.

---

## §1. Matricea obiect × operație × actor

Coloana „actor decisiv" arată cel mai slab actor care **trece**. `anon`=❌ peste tot la citire/scriere (fără politici), cu excepțiile INSERT din §2. `owner` și `service_role`=✅ peste tot (owner prin politici, service_role prin BYPASSRLS). Coloanele S/I/U/D = SELECT/INSERT/UPDATE/DELETE pentru **authenticated fără modul** dacă nu se spune altfel.

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
- `trg_profiles_campuri_owner_only` (`fn_profiles_campuri_owner_only`) → blochează `department` și `employee_id`; verifică JWT claims + `session_user` (rezistă și la conexiune directă non-owner).
- Toate patru **sar verificarea când `auth.uid() IS NULL`** (service_role/migrări) — corect pentru infra, dar înseamnă că orice cale service_role scrie orice pe profil.

**Gaura de escaladare (§2, expunerea #1):** flagurile **NU** acoperite de niciun trigger, deci **auto-atribuibile** de orice user pe propriul rând via `profiles_update_own`: `can_manage_stoc`, `can_create_comenzi`, `can_process_achizitii`, `can_access_ctc`, `can_use_document_scanner`, toate `receive_tichete_*`, `receive_bonuri_consum`, `whatsapp_enabled`, `whatsapp_tier`, `phone_whatsapp`.

### 1.2 Date de personal — grup **RLS citire + Storage** / **RSVTI+jurnal**

| Obiect | Sensib. | authenticated fără modul | Actor legitim |
|---|---|---|---|
| `employees` (172) | **critic** | **S=✅ Y (toate 172, din care 149 cu IBAN, 120 telefon, 49 qr_pin activ)**; I/U=⚠️ `owner\|can_modify_employees`; D=owner | oricine logat citește **IBAN-uri + telefoane + QR-PIN-uri** |
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
| `hr_concediu_tokens` (117: token/angajat) | **critic** | **S=✅ Y (toate 117 tokenurile, toate active)** | vezi §2 #2 — tokenurile deschid `/co` public |
| `ordine_deplasare_arhiva` (259) | ridicat | ❌ `owner\|can_access_personal_data` (0 vizibile) | corect |
| `hr_employees_audit` (11) | mediu | S=✅ Y | jurnal ștergeri angajați, citibil |

### 1.3 Tabele cu tokenuri / secrete — grup **RLS citire + Storage**

Coloane cu nume de tip token/secret/key/refresh și cine le citește **efectiv**:

| Tabel.coloană | anon | auth fără modul | Expus efectiv? |
|---|---|---|---|
| `app_secrets` (key, **value**, 2 rânduri) | ❌ fără GRANT | ❌ fără GRANT (0 col) | **NU** — REVOKE corect, doar postgres/service_role. |
| `olx_tokens` (access_token, refresh_token, 1 rând) | GRANT ALL, dar RLS 0 politici | GRANT SELECT, RLS 0 politici → **0 rânduri** | **NU prin API** (RLS blochează), dar **igienă proastă**: GRANT ALL încă pe anon/authenticated. Tokenurile n-au fost citite. |
| `hr_concediu_tokens` (**token**, 117) | ❌ | **✅ Y — 117 tokenuri citibile** | **DA** (ridicat — vezi §2 #2) |
| `employees.qr_pin` (49 active) | ❌ | **✅ Y — citibile** | **DA** (ridicat — vezi §2 #3) |
| `iot_integrari` (config jsonb: `salus.pin_hash`, `tuya/vicare client_id`, `audi.tokens`) | ❌ | **✅ Y** (`auth.uid() IS NOT NULL`) | **DA parțial** — configurări integrări citibile de orice cont logat; `audi.tokens` e null acum, `salus.pin_hash` prezent. Mediu. |
| `sedinte_rsvp.token` (uuid, 6) | ❌ | ✅ Y | DA, dar low (token RSVP ședințe). |
| `v_ofertare_identitate_tokens` (view, coloană `token`) | ✅ (anon col select=true) | ✅ | **De verificat** (view `security_invoker` — vede doar ce vede actorul; probabil 0 pt. anon fiindcă tabelele-sursă n-au politici anon). Vezi §4. |
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
| `contracte_terti` (85) | ✅Y | ⚠️`owner\|can_manage_contracts` | ⚠️ | ⚠️owner | ridicat (dar politica `contracte_terti_write` ALL=Y anulează gate-urile — vezi §2 #6) |
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

**#2 — RIDICAT/CRITIC — 117 tokenuri de concediu citibile de orice cont logat.**
`hr_concediu_tokens` (coloana `token`, 117 rânduri active): `hr_tokens_sel` = `SELECT USING (auth.uid() IS NOT NULL)`. Tokenul e cheia paginii **publice** `/co?t=TOKEN` (`ConcediuMobilPage.jsx` → edge `concediu-mobil`, `verify_jwt=false`), care permite depunerea de cereri de concediu în numele angajatului. Un cont logat oarecare poate lista toate cele 117 tokenuri și depune/vizualiza cereri pentru oricine. Dovadă: politica `hr_tokens_sel` + `concediu-mobil` fără JWT.

**#3 — RIDICAT — QR-PIN-urile șoferilor + IBAN/telefoane citibile de orice cont logat.**
`employees` `SELECT USING (true)`: 172 rânduri, din care **149 cu IBAN, 120 telefoane, 49 `qr_pin` active**. PIN-urile deschid fluxurile QR (`qr-alimentare-submit`, `qr-bon-comun-lookup`, `verify_jwt=false`). `trezorerie_conturi` (33 IBAN) e nu doar citibilă ci **RW complet** (`trez_conturi_rw` ALL=`auth.uid()`). Dovadă: `employees_select_all_authenticated`=`true`, `trez_conturi_rw`.

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
Default privileges pentru rolul `postgres` în `public` acordă `anon`+`authenticated` **`arwdDxtm`** la fiecare tabel nou. Efectiv: **anon TRUNCATE pe 332 tabele, authenticated pe 340**; MAINTAIN 332/344; REFERENCES/TRIGGER 332. TRUNCATE ocolește RLS și triggerele. **Latent** azi: nicio funcție DEFINER apelabilă de anon/auth face TRUNCATE, iar PostgREST nu poate emite TRUNCATE (confirmat: singurele DEFINER cu SQL dinamic sunt `fn_completare_aplica` — cu poartă și `%I` — și `fn_tichete_notif_on_insert` — neapelabilă). Rămâne lipsă de apărare în profunzime. Dovadă: `pg_default_acl` (postgres, public, tables = `anon=arwdDxtm, authenticated=arwdDxtm`).

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
- **`v_ofertare_identitate_tokens`** (view cu coloană `token`, `anon_col_select=true`): fiind `security_invoker`, probabil întoarce 0 rânduri pentru anon (tabelele-sursă n-au politici anon), dar n-am rulat un SELECT ca anon pe el ca să confirm numărul — de verificat.
- **`net._http_response`** conținut: am confirmat GRANT-ul și 617 rânduri, dar **nu am citit** corpurile (ar putea conține secrete) — nu știu dacă rețin efectiv tokenuri; de verificat cu grijă (fără a afișa valori).
- **Cron (`cron.job`)**: RLS on, `authenticated`/`anon` fără GRANT de citire (doar `supabase_admin`/`postgres`); nu am putut lista comenzile cron ca să confirm cu ce identitate rulează joburile (ex. `heartbeat_alerta`) — rămâne întrebarea din inventar despre chei în text în comenzile cron.
- **Politici pe partiții `realtime.messages_*`**: `anon/authenticated` au `arw` pe `realtime.messages` (RLS on, politici gestionate de Supabase); n-am evaluat politicile realtime — în afara scopului.
- **Efectiv vs. `authenticator`**: testele „ca authenticated" folosesc `SET ROLE` + claims, care reproduce fidel calea PostgREST pentru RLS, dar `statement_timeout` și alte GUC-uri per-request pot diferi marginal.
- **Coloane sensibile numărate, nu citite**: „cu IBAN=149" etc. sunt `count(*) FILTER (WHERE col IS NOT NULL)`; n-am extras nicio valoare.

---

*Fișier generat read-only. Nu s-a făcut git, nu s-a atins alt fișier, nu s-a aplicat nicio migrare.*
