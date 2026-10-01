# S-A — `profiles`: contul propriu nu-și mai poate acorda singur drepturi (29.09.2026)

- **Decizia lui Răzvan (29.09 seara):** „S-A — fix în seara asta, după GO-ul lui Copilot”. Domeniul aprobat: protecția `department` + `employee_id`. Înscrierea publică o oprește el.
- **Copilot, runda 1 (~23:05):** AUTO condiționat.
- **Copilot, runda 2 (~23:15, pe revizia 15738b4):** HOLD, pentru două motive:
  1. `auth.uid() IS NULL` deschidea excepția pe lipsa identității;
  2. 16 coloane depășesc mandatul.
- **Revizia curentă** răspunde la amândouă:
  - identitatea privilegiată e explicită;
  - migrarea de noapte are doar 2 coloane;
  - extensia la 16 coloane e separată și așteaptă acordul lui Răzvan.

## 1. Gaura
`profiles_update_own` (`USING/WITH CHECK auth.uid() = id`) lasă orice cont logat să-și modifice propriul rând. Triggerele live păzesc doar:

| Trigger (live) | Ce păzește | Cum |
|---|---|---|
| `prevent_role_escalation_trigger` | `role`, `is_owner` | RAISE pentru non-owner |
| `trg_enforce_owner_only_salary_flags` | `is_owner`, `can_access_salarii`, `can_access_personal_data`, `can_access_pontaj_brut`, `can_modify_employees`, `can_manage_contracts`, `can_access_diurne`, `can_access_financiar` | resetare tăcută |
| `trg_protect_can_access_pontaj_brut` | `can_access_pontaj_brut` | RAISE |

Neprotejate, dar folosite ca drept:

| Coloană | Unde dă drept | Migrare |
|---|---|---|
| `department` | 4 politici de scriere pe `department='HR'`: hr_autorizatii, hr_autorizatii_tipuri, hr_formare_profesionala, hr_recrutare_pozitii | **g (noaptea)** |
| `employee_id` | legarea contului de fișa altui angajat (semnătura/identitatea lui) | **g (noaptea)** |
| `email` | identitate în căutări după email (`HrAngajatNouWizard` → contul Cristianei, `Logistica` → m.alexandru), destinatarul mailurilor din edge functions | 30a (dimineața, cu acord) |
| `can_use_document_scanner` | SELECT `hr_autorizatii_propuneri`, INSERT `scanner_logs` | 30a |
| `can_manage_stoc` | ALL pe magazii, consumuri_proiect(_linii) | 30a |
| `can_create_comenzi`, `can_process_achizitii`, `can_access_ctc` | drepturi Comercial | 30a |
| `receive_tichete_*` ×6 | tichetele altor departamente | 30a |
| `receive_bonuri_consum` | preluarea bonurilor de consum (`ConsumuriBonuriTab`) | 30a |
| `whatsapp_tier` | nivelul notificărilor WhatsApp | 30a |

**Regresie:** până la 02.06.2026, `enforce_owner_only_salary_flags` (versiunile 20260516/0518/0519) păzea și scannerul, `receive_tichete_*`, cele 4 flaguri Comercial și `whatsapp_tier`. Migrarea `20260602105459 contracte_extensii_acte_aditionale_access` a rescris funcția și le-a scăpat. Comentariile din `App.jsx` (`saveEditMgr`) încă spun „trigger BD protejează”.

## 2. Fix
- **Noaptea — `20260929g_profiles_campuri_owner_only.sql`:** trigger nou, separat, `trg_profiles_campuri_owner_only` (BEFORE UPDATE), funcția `fn_profiles_campuri_owner_only()`, doar pe `department` + `employee_id`.
- **Dimineața, cu acordul lui Răzvan — `20260930a_profiles_campuri_owner_only_extins.sql`:** aceeași funcție (`CREATE OR REPLACE`), aceeași regulă de identitate, 16 coloane. Rollback-ul ei readuce varianta cu 2 coloane; nu scoate protecția.

Pentru ambele:
- SECURITY DEFINER, `search_path = public, pg_temp`, proprietar postgres, EXECUTE revocat pentru toți;
- întâi se verifică dacă s-a schimbat o coloană protejată (`IS DISTINCT FROM`, null-safe); dacă nu, UPDATE-ul trece fără altă verificare;
- nu ating date, politici, granturi sau funcțiile existente. Nimic din Ofertare.

## 3. Identitatea privilegiată — explicită, nu „lipsa identității”
O schimbare a unei coloane protejate trece **doar** dacă:

| Context | Cum e recunoscut | Cine e |
|---|---|---|
| cerere PostgREST, claims `role = 'service_role'` | claims JWT (`request.jwt.claims` / `request.jwt.claim.role`), semnate cu cheia service și validate de PostgREST | backend: edge functions |
| cerere PostgREST, claims `role = 'authenticated'` + `sub` = profil cu `is_owner` | claims JWT; `is_owner` e protejat de 2 triggere | owner-ul (Admin → Manageri) |
| fără claims (conexiune directă la BD) și `session_user IN ('postgres','supabase_admin')` | `session_user` = login-ul conexiunii; nu se schimbă în SECURITY DEFINER sau SET ROLE, deci nu e proprietarul funcției | migrări MCP/CLI (verificat: `session_user = postgres`), SQL editor, pg_cron (verificat: `cron.job.username` = doar `postgres`; niciun job nu atinge `profiles`) |

Orice altceva e refuzat cu 42501:
- anon, direct sau prin RPC;
- authenticated non-owner;
- claims fără `sub` sau cu `sub` fără profil;
- rol străin în claims;
- conexiune fără claims ca `authenticator`, `supabase_auth_admin` sau alt login.

**„Admin din UI” = owner.** `AdminPage` (`src/App.jsx:6443-6445`, `isSuperAdmin = profile?.is_owner === true`) e singurul ecran care editează profilul altcuiva. RLS permite UPDATE pe rândul altcuiva doar prin `profiles_update_owner` (apelantul e owner). Deci singurul admin legitim care schimbă `department`/`employee_id` altcuiva e un owner. Echivalența e consemnată aici.

**Inventar căi de scriere (29.09, read-only):**
- în `public`, singura funcție care scrie `profiles` e `handle_new_user` (INSERT id/email/name/`role='manager_santier'`; metadata de signup ignorată);
- singura funcție SECURITY DEFINER cu SQL dinamic apelabilă din API e `fn_completare_aplica` (listă albă pe `executie_proiecte`, nu atinge `profiles`);
- nicio funcție apelabilă din API nu schimbă rolul sau claims-urile;
- în `supabase/functions` niciun edge function nu scrie în `profiles`. Limită: e codul din repo; CI-ul `verifica` compară repo↔live doar pentru Ofertare. Chiar dacă ar exista un edge live nelistat, el ar trece doar cu claims `service_role`, adică o cheie service. Un apel fără claims e refuzat.

**Impact asupra pachetului conturi (după 02.10):** funcțiile R2 care „golesc claims” ca să acționeze ca sistem vor fi **refuzate** de acest trigger dacă schimbă `department`/`employee_id`, pentru că rulează sub login-ul `authenticator`. Pachetul trebuie adaptat (de ex. schimbarea făcută în context `service_role` sau o regulă explicită și testată) înainte de GO-ul lui.

## 4. Teste — `supabase/tests/profiles_campuri_owner_only.test.sql`
PG16 local, pe scheletul Supabase (politicile și triggerele de producție pe `profiles`, `handle_new_user` identic). Identitățile sunt simulate ca PostgREST:
- claims JWT + `SET ROLE`;
- conexiunile fără claims prin `SET SESSION AUTHORIZATION`;
- RPC de probă SECURITY DEFINER (există doar în test).

| Variantă | Rezultat |
|---|---|
| **g (noaptea)** | **154 aserțiuni OK**, în 4 treceri: migrare → reaplicare → rollback (gaura reprodusă) → reaplicare |
| **g + 30a (dimineața)** | **193 aserțiuni OK**, aceleași 4 treceri; schema după rollback = cea dinainte |

| Grup | Ce dovedește |
|---|---|
| S1 | legătura trigger → funcție → tabel; activ; SECURITY DEFINER, search_path, proprietar postgres; neapelabilă din API; amprenta definiției |
| S2 | department/employee_id: valoare→altă valoare, →NULL, ambele odată, amestec cu câmp permis → refuz 42501, rând neschimbat. **S2-EXT** (doar cu 30a): celelalte 14 refuzate. **S2-REZIDUAL** (doar g): `can_manage_stoc` încă se poate autoseta; limitare consemnată până la 30a |
| S3 | câmpuri personale trec; valorile neschimbate retrimise trec; rândul altcuiva = 0 rânduri |
| S4 | triggerele vechi funcționează ca înainte |
| S5 | owner prin JWT, service_role prin JWT, login postgres fără claims trec; actorul e verificat explicit în fiecare caz |
| S6 | anon direct = 0 rânduri (RLS; triggerul nu e atins) |
| **S11** | anon printr-un RPC SECURITY DEFINER (ajunge la rând) → refuz 42501 |
| **S12** | fără claims ca `authenticator` → refuz; fără claims ca `supabase_auth_admin` → refuz; claims authenticated fără `sub` → refuz; `sub` fără profil → refuz; rol străin în claims → refuz; rândul țintă rămâne neschimbat |
| **S13** | același RPC anon, doar câmp nesensibil → trece (verificarea strictă se face doar când se schimbă o coloană protejată) |
| S7 | owner retrogradat → refuz imediat |
| S8 | signup cu metadata „HR/superadmin/is_owner/flaguri” → profil fără drepturi; NULL→HR refuzat; INSERT și upsert din API refuzate |
| S9 | non-owner cu `department='HR'` și fișă: HR→altă valoare / NULL, employee_id→altă valoare / NULL → refuzate; nu poate da altcuiva |
| S10 | RPC SECURITY DEFINER apelat de non-owner (JWT) → refuz; apelat de owner → trece |

Limitare: validarea dinamică e doar locală. Pe producție, după apply, se verifică doar read-only (§6); nu se încearcă atacul pe profile reale.

## 5. Revenirea (păstrează protecția)
- `20260929g_…_ROLLBACK.sql` e **rollback tehnic** (harness). Redeschide gaura; în producție se rulează doar la cererea explicită a lui Răzvan.
- `20260930a_…_ROLLBACK.sql` readuce varianta cu 2 coloane și păstrează protecția.

Revenirea operațională:
1. **Flux legitim refuzat** (`42501 Doar owner-ul poate modifica <coloana>`): schimbarea o face owner-ul sau backend-ul cu service_role. Triggerul rămâne.
2. **O coloană chiar trebuie editată de utilizator:** o migrare nouă, revizuită (GO Copilot), o scoate doar pe ea (`CREATE OR REPLACE`), fără DROP.
3. **Funcția e defectă și refuză tot:** fail-closed doar pentru schimbările protejate ale non-owner-ilor. Se repară cu `CREATE OR REPLACE`.

## 6. Apply și verificarea integrității (după GO)
- Un singur `apply_migration` cu exact `20260929g_profiles_campuri_owner_only.sql`. Fără alte migrări, fără DML.
- Verificare read-only pe live:
  - legătura trigger → funcție → tabel (`tgrelid`, `tgfoid`), `tgenabled = 'O'`;
  - funcția: proprietar, ACL (fără EXECUTE pentru PUBLIC/anon/authenticated/service_role), `prosecdef`, `proconfig`;
  - **corpul funcției:** `md5(prosrc)` live = `c06d7ce0f212c7bba2093c50614a88fc` (canonic, calculat din migrarea testată; corpul e stocat exact). Amprenta fișierului (`c2a4744c…`) și cea a `pg_get_functiondef` din PG16 local (`1f23d176…`) sunt artefacte diferite: se raportează separat și nu se compară între ele.
- `get_advisors` doar ca diagnostic.

## 7. Fișa automatizării (CLAUDE.md pct. 7)
- (a) **Conținut extern citit:** niciunul. Compară NEW/OLD, claims-urile cererii, `session_user` și `profiles.is_owner`.
- (b) **Ce poate scrie/face:** nimic. Doar refuză un UPDATE. Nu trimite mail, nu atinge bani sau drepturi, nu modifică date.
- (c) **Identitate:** SECURITY DEFINER (postgres), ca să citească `profiles.is_owner` indiferent de RLS; nu scrie.
- (d) **Cine o pornește:** orice UPDATE pe `profiles`. Nu e apelabilă direct; decizia se ia pe claims + `session_user`, nu pe rolul curent al bazei.
- (e) **Confirmare umană:** nu e nevoie în trigger. Corectarea profilelor deja privilegiate cere preview → confirmarea lui Răzvan.

Fișa se trece în `claude_docs.registru_automatizari` după apply. E tabela de documentație a lui Claude, nu date de business, iar CLAUDE.md pct. 7 cere actualizarea în aceeași sesiune.

## 8. Ce NU face — pentru Răzvan (30.09, 08:00)
- **Extensia 30a** (email + 13 flaguri): pregătită și testată (193 OK). Se aplică doar cu acordul tău; până atunci restul gaurii rămâne deschis (S2-REZIDUAL).
- **Datele existente nu se repară.** 21 de non-owneri au azi flaguri active. Fără jurnal pe `profiles`, proveniența lipsește; asta nu dovedește nici compromiterea. Orice corectare: preview → confirmare → apply.
- **Înscrierea publică:** nu e considerată oprită fără dovadă (setarea Auth „Allow new users to sign up”).
