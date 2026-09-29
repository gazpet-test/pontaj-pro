# S-A — `profiles`: contul propriu nu-și mai poate acorda singur drepturi (29.09.2026)

Decizia lui Răzvan (29.09 seara): „S-A — fix în seara asta, după GO-ul lui Copilot”; înscrierea publică o oprește el.
Verdict Copilot (conv. 2, 29.09 ~23:05): „AUTO condiționat” — GO de principiu pentru apply în noaptea asta, strict pe acest domeniu, după GO pe SQL-ul exact, teste și procedura de revenire.

## 1. Gaura
`profiles_update_own` (`USING/WITH CHECK auth.uid() = id`) lasă orice cont logat să-și modifice propriul rând. Triggerele live păzesc doar:

| Trigger (live) | Ce păzește | Cum |
|---|---|---|
| `prevent_role_escalation_trigger` | `role`, `is_owner` | RAISE pentru non-owner |
| `trg_enforce_owner_only_salary_flags` | `is_owner`, `can_access_salarii`, `can_access_personal_data`, `can_access_pontaj_brut`, `can_modify_employees`, `can_manage_contracts`, `can_access_diurne`, `can_access_financiar` | resetare tăcută (NEW := OLD) |
| `trg_protect_can_access_pontaj_brut` | `can_access_pontaj_brut` | RAISE |

Neprotejate, dar folosite ca drept:

| Coloană | Unde dă drept |
|---|---|
| `department` | 4 politici de scriere pe `department='HR'`: hr_autorizatii, hr_autorizatii_tipuri, hr_formare_profesionala, hr_recrutare_pozitii |
| `employee_id` | legarea contului de fișa altui angajat (semnătura/identitatea lui) |
| `can_use_document_scanner` | SELECT pe hr_autorizatii_propuneri, INSERT pe scanner_logs |
| `can_manage_stoc` | ALL pe magazii, consumuri_proiect, consumuri_proiect_linii |
| `can_create_comenzi`, `can_process_achizitii`, `can_access_ctc` | drepturi Comercial (UI + funcții) |
| `receive_tichete_*` ×6 | primește tichetele altor departamente |
| `receive_bonuri_consum` | poate prelua bonuri de consum (`ConsumuriBonuriTab`) |
| `whatsapp_tier` | nivelul notificărilor WhatsApp |

**Regresie:** până la 02.06.2026, `enforce_owner_only_salary_flags` (versiunile 20260516/20260518/20260519) păzea și scannerul, `receive_tichete_*`, cele 4 flaguri Comercial și `whatsapp_tier`. Migrarea `20260602105459 contracte_extensii_acte_aditionale_access` a rescris funcția cu doar 6 coloane și le-a scăpat. Comentariile din `App.jsx` (`saveEditMgr`) încă spun „trigger BD protejează”.

## 2. Fix
Migrarea `supabase/migrations/20260929g_profiles_campuri_owner_only.sql` adaugă un trigger nou, separat: `trg_profiles_campuri_owner_only`, BEFORE UPDATE pe `profiles`, cu funcția `fn_profiles_campuri_owner_only()`:
- SECURITY DEFINER, `search_path = public, pg_temp`, EXECUTE revocat pentru toți;
- dacă apelantul nu e sistemul (`auth.uid()` NULL) și nu e owner, orice schimbare (`IS DISTINCT FROM`, null-safe) a celor 15 coloane → `RAISE 42501`. Refuzul e vizibil și atomic: nicio altă modificare din aceeași cerere nu se scrie;
- nu atinge date, politici, granturi, funcțiile/triggerele existente. Nimic din Ofertare.

## 3. Identitatea excepției (cine trece)
- **Owner:** `EXISTS (profiles WHERE id = auth.uid() AND is_owner)`. `is_owner` e protejat de două triggere (RAISE + reset) și nu poate fi setat de non-owner. `department`, metadata de la signup sau `role` NU deschid excepția.
- **Sistemul:** `auth.uid()` NULL = cheia service_role (edge functions), migrările, pg_cron. anon are tot `auth.uid()` NULL, dar nu are politică UPDATE pe `profiles` → 0 rânduri (testat).
- **RPC SECURITY DEFINER:** `auth.uid()` citește JWT-ul apelantului, nu `current_user`. Un RPC rulat ca postgres, apelat de un non-owner, e refuzat (testat S10).
- **Inventar căi de scriere (29.09, read-only):**
  - în `public`, singura funcție care scrie `profiles` e `handle_new_user` (INSERT id/email/name/`role='manager_santier'`; metadata de signup ignorată);
  - singura funcție SECURITY DEFINER cu SQL dinamic apelabilă din API e `fn_completare_aplica` (listă albă pe `executie_proiecte`, poartă `is_owner`/`can_manage_contracts`), care nu atinge `profiles`;
  - în `supabase/functions`, niciun edge function nu scrie în `profiles`;
  - INSERT prin API: doar owner (`profiles_insert_owner`).

## 4. Teste — `supabase/tests/profiles_campuri_owner_only.test.sql`
PG16 local, pe scheletul Supabase (politicile și triggerele de producție pe `profiles`, `handle_new_user` identic). Identitățile sunt simulate ca PostgREST: claims JWT + `SET ROLE authenticated` / `anon` / `service_role`.

**Rezultat: 150 aserțiuni OK**, în 4 treceri: migrare → a doua aplicare → rollback tehnic (schema = cea dinainte; gaura reprodusă) → reaplicare.

| Grup | Ce dovedește |
|---|---|
| S1 | trigger activ; funcție SECURITY DEFINER cu search_path fixat; neapelabilă din API |
| S2 | fiecare din cele 15 coloane refuzată pentru non-owner; valoare→NULL refuzată; amestec cu câmp permis refuzat integral; rândul rămâne neschimbat |
| S3 | câmpurile personale (nume, WhatsApp, preferințe mail) trec; valorile neschimbate retrimise (formularul Manageri) trec; rândul altcuiva = 0 rânduri |
| S4 | triggerele vechi funcționează ca înainte |
| S5 | owner (pe alții și pe sine, prin JWT ca în UI), service_role și admin fără JWT trec |
| S6 | anon = 0 rânduri |
| S7 | owner retrogradat → refuz imediat |
| S8 | signup cu metadata „HR/superadmin/is_owner/flaguri” → profil fără drepturi; apoi NULL→HR refuzat; INSERT și upsert din API refuzate |
| S9 | non-owner care are deja `department='HR'` și fișă: HR→altă valoare, HR→NULL, employee_id→altă valoare/NULL, ambele odată → refuzate; nu poate da altcuiva (0 rânduri) |
| S10 | RPC SECURITY DEFINER apelat de non-owner → refuzat; apelat de owner → trece |

Limitare: validarea dinamică e doar locală. Pe producție, după apply, se verifică doar read-only (definiție, activare, privilegii); nu se încearcă atacul pe profile reale.

## 5. Revenirea (păstrează protecția)
`…_ROLLBACK.sql` e **rollback tehnic** (harness). Șterge protecția și redeschide gaura, deci **nu** e procedura de revenire. În producție se rulează doar la cererea explicită a lui Răzvan.

Revenirea operațională:
1. **Un flux legitim e refuzat** (mesaj `42501 Doar owner-ul poate modifica <coloana>`): modificarea o face owner-ul (Admin → Manageri) sau backend-ul cu service_role. Triggerul rămâne.
2. **O coloană chiar trebuie editată de utilizator:** o migrare nouă, revizuită (GO Copilot), scoate doar acea coloană din `CASE`, cu `CREATE OR REPLACE FUNCTION`.
3. **Funcția e defectă și refuză tot:** efectul e fail-closed doar pentru non-owneri (owner, service_role și migrările trec). Se repară cu `CREATE OR REPLACE`, fără DROP.

## 6. Fișa automatizării (CLAUDE.md pct. 7)
- (a) **Conținut extern citit:** niciunul. Compară doar NEW/OLD și `profiles.is_owner`.
- (b) **Ce poate scrie/face:** nimic. Doar refuză un UPDATE. Nu trimite mail, nu atinge bani sau drepturi, nu modifică date.
- (c) **Identitate:** SECURITY DEFINER (postgres), necesar ca să citească `profiles.is_owner` indiferent de RLS; nu scrie nimic.
- (d) **Cine o pornește:** orice UPDATE pe `profiles`. Nu e apelabilă direct (EXECUTE revocat); decizia se ia pe identitatea JWT (`auth.uid()`), nu pe rolul bazei.
- (e) **Acțiuni cu confirmare umană:** niciuna în trigger. Corectarea profilelor deja privilegiate (§7) cere preview → confirmarea lui Răzvan.

## 7. Ce NU face — pentru Răzvan (30.09, 08:00)
- **Datele existente nu se repară.** 21 de non-owneri au azi flaguri active (lista: SELECT read-only din 29.09, în chat). Fără jurnal pe `profiles` nu se poate dovedi cine le-a setat între 02.06 și azi; lipsa provenienței nu dovedește compromiterea. Orice corectare: preview → confirmare → apply.
- **Înscrierea publică:** nu e considerată oprită fără dovadă (setarea Auth „Allow new users to sign up” din Supabase). Oprirea ei nu înlocuiește protecția.
- `profiles.email` rămâne neprotejat; e acoperit de pachetul conturi R1 (după 02.10).
