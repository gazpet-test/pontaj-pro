# Securitate — inventarul suprafeței privilegiate (backlog #157), 29→30.09.2026

> **DOAR PREGĂTIRE** (programul de noapte Copilot, pct. 8). Totul e read-only: cataloage, `get_advisors`, grep în repo. Nu s-a aplicat niciun REVOKE sau poartă. Fiecare propunere cere acordul lui Răzvan și trece prin preview → confirmare → `apply_migration` → `get_advisors`.
> Surse: workflow `wf_4bf75289-81f`, cu 1 inventar și 5 verificatori adversariali pe candidații critic/ridicat. Indiciile de exploatare le-am verificat eu, read-only, pe 29.09 la ~21:10 UTC.

## 0. Pe scurt pentru Răzvan
- **4 căi concrete de modificare neautorizată, confirmate de verificatori.** Oricine are cont (orice angajat logat) poate, printr-un apel RPC direct, fără ecran:
  1. `confirm_hr_autorizatie_rsvti`: prelungește viza RSVTI a oricui, cu orice dată, deci ascunde o viză expirată. Gravitate reală: **mare**.
  2. `fn_ofertare_alege_acoperire`: schimbă dovada aleasă pe orice cerință din orice licitație (inclusiv Jilava), fără modulul Ofertare. Ce alesese colegul se pierde fără istoric. **Mare.**
  3. `ofertare_inventar_pereche`: cu `p_prag=0` ascunde obligațiile găsite de al doilea cititor AI. **Ridicat.**
  4. `fn_stoc_ajustare`: modifică stocul oricărei poziții. **Mai grav decât părea:** tabelele de stoc sunt deschise oricui e logat și direct prin REST, iar `can_manage_stoc` și-l poate pune oricine singur. Extensia S-A 30a ar închide acest flag.
  - Plus `fn_transfer_executa` (ridicat, confirmat): mută stoc între oricare locații; tabelele sunt oricum deschise.
- **Indicii de exploatare: niciunul.** Toate verificările au dat 0:
  - confirmări RSVTI date de conturi fără drept HR;
  - confirmări RSVTI cu dată în viitor;
  - dovezi Ofertare alese de conturi fără modulul Ofertare;
  - ajustări de stoc făcute de conturi fără drept.

  Conturile din afara `@gazpet.ro` sunt 3, toate cunoscute: Acarpenaru (06.2026), `razvantrusuhome` (07.2026) și Dragoș Burdea / Adrom Evolution (01.09).
- **Alertare:** notificare push trimisă la ~21:05 UTC, conform regulii Copilot („o cale concretă → alertare imediată prin canalul intern, nu autoaprobarea schimbărilor de drepturi”). Nu am modificat nimic.
- **Riscul depinde de înscrierea publică (D1).** Dacă „Allow new users to sign up” e încă pornit, oricine de pe internet își poate face cont și intră în categoria „orice cont logat”. Confirmarea din Dashboard e urgentă.
- **Remediere recomandată, fără regresie** (după acordul tău): P2, P3, P6, P8, P11, P14, P15, apoi P1. P4, P5, P7, P9 și P12 cer întâi decizia ta despre cine are drept.

## 1. Verdictele verificatorilor adversariali (rezumat)
| Candidat | Verdict | Gravitate după verificare | Calea (neexecutată) | Remediere propusă | Risc de regresie |
|---|---|---|---|---|---|
| `confirm_hr_autorizatie_rsvti` | CONFIRMAT | mare (atribuibil: `confirmat_de`=uid) | `rpc(…, {p_autorizatie_id, p_data_confirmare:'2099-01-01'})` → vizele sar în viitor; jurnalul `hr_autorizatii_rsvti_confirmari` se poate falsifica și direct (INSERT `uid IS NOT NULL`) | poartă identică cu `hr_autorizatii_write_authorized` + dată ≤ azi; politica INSERT pe jurnal restrânsă | cine confirmă azi vize fără HR/Administrativ/`can_modify_employees` → preview `DISTINCT confirmat_de` înainte |
| `fn_ofertare_alege_acoperire` | CONFIRMAT | mare | `select id from ofertare_acoperire` (SELECT deschis) → `rpc(…, {p_acoperire_id})` → „ales” semnat cu uid-ul atacatorului | `IF NOT fn_are_acces_ofertare() THEN RAISE 42501` | mic: toți apelanții sunt deja în modulul Ofertare |
| `ofertare_inventar_pereche` | CONFIRMAT | ridicat | `rpc(…, {p_lic, p_prag:0})` → totul „acoperit”, golurile dispar din „Verificare independentă”; șterge și respingerile umane (`respins_de_om`), chiar și în folosire normală | poartă Ofertare + prag limitat + protecția `respins_de_om` | mic; UI nu trimite `p_prag` |
| `fn_stoc_ajustare` | CONFIRMAT | critic pe stoc | `POST /rest/v1/rpc/fn_stoc_ajustare` cu delta ±N; direct: RLS `stocuri_write`/`sm_insert` = `uid IS NOT NULL` | poartă `is_owner OR can_manage_stoc` + **protejarea flagului `can_manage_stoc`** (30a) + RLS pe stoc (A/B/C) | cei din Magazie/Achiziții fără flag; Achiziții inserează direct în `stocuri_miscari` |
| `fn_transfer_executa` | CONFIRMAT | ridicat (tabelele sunt oricum deschise) | `rpc(…)` → transfer „livrat” + stoc mutat; plus 2 defecte de integritate (diferențe de majuscule → stoc negativ; fără `FOR UPDATE`) | poartă (A/B/C) + `FOR UPDATE` + index unic + RLS | 3 module (Logistică, Achiziții, Magazie) — risc mare dacă poarta e prea strictă |

**Neverificați adversarial** (plafonul de 5 verificatori; rămân cu verdictul inventarului): `fn_concediu_consolidare`/`fn_concediu_autogen`, `fn_ofertare_revizie_noua`, RLS `stocuri_miscari.sm_insert`, RLS `logistica_alimentari` DELETE/UPDATE.

## 2. Indicii de exploatare (SELECT read-only, 29.09 ~21:03 UTC)
| Indicator | Rezultat |
|---|---|
| `hr_autorizatii.rsvti_confirmat_de` în afara setului HR/Administrativ/owner/`can_modify_employees`/superadmin | 0 |
| `rsvti_ultima_confirmare` în viitor | 0 |
| `ofertare_acoperire` cu `ales` și `ales_de` fără modulul Ofertare (și non-owner) | 0 |
| `stocuri_miscari` ajustări cu `created_by` fără `is_owner`/`can_manage_stoc` (azi) | 0 |
| Conturi noi în ultimele 30 de zile | 5, dintre care 1 non-gazpet (Adrom Evolution, 01.09) |

Limită: dacă cineva și-a pus singur `can_manage_stoc`, apare ca „cu drept”. Nu există jurnal pe `profiles` care să arate cine a pus flagurile (cele 21 de conturi din lista de la 08:00).

## 3. Inventarul complet (raportul agentului, neschimbat)
# Backlog #157: inventarul suprafeței privilegiate (doar pregătire, fără REVOKE)

Proiect `dxczwkbciseqniprspcu`, 29.09.2026. Am rulat doar citiri pe cataloage (`pg_proc`, `pg_class`, `pg_policies`, `pg_auth_members`, `pg_default_acl`, `pg_constraint`, `pg_trigger`, `aclexplode`, `has_*_privilege`) și `get_advisors`. N-am apelat nicio funcție a aplicației și n-am rulat nimic din DDL/DML. În definițiile citite nu apare niciun secret. Apare doar un UUID de profil scris direct în cod, în `fn_concediu_consolidare`, și acela nu e secret. Repo: HEAD `6efb868`.

---

## 1. Advisor de securitate: 4 tipuri, 91 de semnalări

| Tip (lint) | Nivel | Număr | Ce conține |
|---|---|---|---|
| `authenticated_security_definer_function_executable` (0029) | WARN | **66** | Funcții SECURITY DEFINER pe care le poate apela orice utilizator logat. Analiza e la §2. |
| `anon_security_definer_function_executable` (0028) | WARN | **4** | `fn_sedinte_rsvp_submit`, `heartbeat_alerta`, `heartbeat_muti`, `fn_trg_categorie_cantitate` |
| `rls_enabled_no_policy` (0008) | INFO | **20** | 15 tabele `_backup_*` / `_eval_*`, plus `app_secrets`, `olx_tokens`, `piese_import_staging`, `rag_qr_log`, `storage_rls_errors` |
| `function_search_path_mutable` (0011) | WARN | **1** | `fn_sectiune_sursa`. Nu e SECURITY DEFINER, deci riscul e mic. |

Legături de remediere: [0028](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) · [0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) · [0008](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) · [0011](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)

Ce nu vede advisorul:
- `olx_tokens` are **ALL (arwdDxtm) pentru anon și authenticated**. Singura protecție e RLS fără nicio politică. La `app_secrets` drepturile au fost retrase corect, doar `postgres` și `service_role` le au.
- Setările implicite (default privileges) sunt descrise la §3.

---

## 2. Funcțiile SECURITY DEFINER pe care anon și authenticated le pot apela

**Cifrele**
- În `public` există **207** funcții SECURITY DEFINER.
- **66** pot fi apelate de authenticated și **4** de anon: 3 prin `PUBLIC`, iar `fn_sedinte_rsvp_submit` printr-un GRANT direct către anon. Unice sunt 67.
- Celelalte 140 le pot apela doar `postgres` și `service_role`, adică igiena e bună acolo.
- În alte scheme care nu țin de sistem (`vault`, `pgbouncer`) nimic nu e apelabil de anon sau authenticated.
- **Toate cele 207 au `search_path` setat** (`public, pg_temp`, uneori și `extensions`).
- `anon` și `authenticated` nu moștenesc drepturi de la alte roluri. În `pg_auth_members` apar doar ca membri ai lui `authenticator` (fără inherit) și ai lui `postgres`.
- Niciuna dintre cele 67 nu folosește `pg_net`/`http`, nu scrie în `profiles` sau `user_module_access` și nu atinge salarii. `auth.users` e atins doar de `delete_user_by_admin` și `update_user_email_by_admin` (vezi §4).

### 2A. Funcții care scriu fără poartă de rol (în afară de §4)

Coloana „RLS pe ținta directă” spune dacă funcția **ocolește** RLS sau dacă RLS permite oricum același lucru oricui e logat.

| Funcție | Cine o apelează | Ce scrie | Poartă în corp | RLS pe ținta directă | Risc |
|---|---|---|---|---|---|
| `confirm_hr_autorizatie_rsvti(bigint,date,text)` | authenticated | INSERT în `hr_autorizatii_rsvti_confirmari` + **UPDATE `hr_autorizatii`** (`rsvti_ultima/urmatoarea_confirmare`, `confirmat_de`) | **niciuna** | `hr_autorizatii` se scrie doar de owner / `can_modify_employees` / superadmin / departamentul HR sau Administrativ, deci funcția **ocolește RLS** | **CRITIC** |
| `fn_ofertare_alege_acoperire(bigint)` | authenticated | UPDATE `ofertare_acoperire` (`ales`, `ales_de`): schimbă varianta aleasă pentru orice cerință din orice licitație | doar `auth.uid() IS NOT NULL` | UPDATE cere `fn_are_acces_ofertare()`, deci funcția **ocolește RLS** | **CRITIC** |
| `ofertare_inventar_pereche(bigint,text,int,real)` | authenticated | UPDATE `ofertare_inventar_ai` (`pereche_cerinta_id`, `verdict`). `p_prag` e ales de apelant: cu 0 totul iese „acoperit” și golurile „lipsa_din_registru” dispar. | **niciuna** | UPDATE cere `fn_are_acces_ofertare()`, deci funcția **ocolește RLS** | **CRITIC** |
| `fn_stoc_ajustare(text,bigint,text,text,numeric,text)` | authenticated | INSERT `stocuri_miscari` cu delta ±arbitrar în orice locație (creează sau șterge stoc) | **niciuna** (nici măcar `auth.uid`) | `sm_insert` = `auth.uid() IS NOT NULL`, deci RLS **permite oricum** și REST-ul direct face același lucru | **CRITIC** |
| `fn_transfer_executa(...)` | authenticated | INSERT `transferuri_interne`/`_linii` + 2× `stocuri_miscari` (mută stoc între oricare locații; verifică doar disponibilul) | **niciuna** | tabelele țintă au RLS `uid IS NOT NULL`, deci permite oricum | RIDICAT |
| `fn_concediu_consolidare(int,date)` și wrapperul `fn_concediu_autogen(int)` | authenticated | INSERT `hr_cereri_concediu` (cereri „depusa” cu text legal), UPDATE → `anulata` pe cererile de reconciliere, notificare către HR. `p_de_la` e ales de apelant (backfill istoric). | **niciuna** | `hr_cereri_ins/upd` = `uid IS NOT NULL`, deci permite oricum | RIDICAT |
| `fn_ofertare_revizie_noua(int,text,bigint)` | authenticated | INSERT `ofertare_acoperire_revizii` + `_istoric` (snapshot, `motiv` și `document_id` libere, numărul de revizie crește) | **niciuna** | INSERT cere `fn_are_acces_ofertare()`, deci funcția **ocolește RLS**. N-o apelează nimic din cod (docs C-13). | RIDICAT |
| `fn_ofertare_acoperire_reverifica_alese(bigint[])` | authenticated | UPDATE `ofertare_acoperire` (`valabil_la_depunere=false`, `reverificare_ceruta`) doar pe alegerile care au expirat cu adevărat | **niciuna** | ocolește RLS, dar rezultatul e determinist (marchează doar ce e expirat) | MEDIU |
| `fn_match_qr_rompetrol()` | authenticated | UPDATE + **DELETE** pe `logistica_alimentari` (potrivire deterministă ±0,5 l / ±2 zile) | doar `auth.uid()` | DELETE `uid IS NOT NULL`, deci RLS permite oricum (vezi colaterale) | MEDIU |
| `fn_get_next_nr_aviz(text)` | authenticated | INSERT/UPDATE `avize_serii_counter` (consumă numere de aviz, creează serii noi) | **niciuna** (comparație: `fn_get_next_nr_factura` are poartă de rol) | UPDATE e deschis; **INSERT n-are politică**, deci funcția ocolește RLS doar la crearea de serii | MEDIU |
| `heartbeat_scrie(text,bool,text,text)` | authenticated | UPSERT `procese_heartbeat` cu `cheie` și `mesaj` libere. Rândul nou e `activ=true`, `prag=120` implicit, iar după 2 h tăcere textul ajunge într-o notificare către owner prin `heartbeat_alerta`. | **niciuna** | `heartbeat_rw` ALL pentru `{public}` cu uid, deci permite oricum | MEDIU |
| `fn_check_diferenta_ore_bord_evogps(...)` | authenticated | INSERT `notifications` către owner și `admin_logistica` (text derivat din date) | niciuna | INSERT în notifications e deschis oricui e logat | scăzut |
| `fn_executie_swap_tevi_pozitie`, `fn_next_numar_comanda_furnizor` | authenticated | UPDATE `executie_tevi` / contor comenzi | `auth.uid()` | RLS ALL cu uid, deci permite oricum | scăzut |
| `fn_chat_mark_read`, `log_storage_upload_error` | authenticated | își scriu propriul rând sau un log | limitate la utilizatorul curent | – | scăzut |

### 2B. Funcțiile apelabile de anon

| Funcție | Ce face | Risc |
|---|---|---|
| `heartbeat_alerta()` (PUBLIC) | **Scriere de către anon**: INSERT `notifications` către toți ownerii + UPDATE `procese_heartbeat.alertat_la`. Scrie doar pentru procesele chiar tăcute, iar după primul apel nu mai repetă. Mai jos e cum se leagă de `heartbeat_scrie`. | MEDIU |
| `heartbeat_muti()` (PUBLIC) | Citire de către anon, adică de pe internet: `cheie`, `descriere`, `gazda` (hostnamele mașinilor interne), minutele de tăcere, `ultim_mesaj` | MEDIU |
| `fn_sedinte_rsvp_submit(uuid,text)` (anon) | UPDATE `sedinte_rsvp` pe baza unui token uuid. E intenționat: linkul public de RSVP din `RsvpSedintaPage.jsx`. | scăzut |
| `fn_trg_categorie_cantitate()` (PUBLIC) | Funcție de trigger; apelată prin RPC dă eroare. E doar zgomot în advisor. | scăzut |

Cum se leagă `heartbeat_scrie` de `heartbeat_alerta`: orice cont logat poate crea un proces fals cu un mesaj ales de el. După 2 h, `heartbeat_alerta` (pornit de cron sau chiar de anon) pune acel text într-o notificare către owner. E un vector de conținut extern (pct. 10), dar un cont logat poate scrie oricum direct în `notifications`.

### 2C. Funcții care scriu și au poartă de rol: 22, sunt în regulă

- **Ofertare**, cu poarta `fn_are_acces_ofertare()` sau `fn_ofertare_source_pack_poate_decide()`: `fn_ofertare_cerinta_titular_seteaza`, `fn_ofertare_cerinte_dovada_adauga`, `fn_ofertare_doc_bifa_relevanta`, `fn_ofertare_seap_cere`, `fn_ofertare_source_pack_decide`, `fn_ofertare_source_pack_import`, `fn_ofertare_subiect_muta`, `fn_ofertare_subiecte_aplica`, `fn_ofertare_clasifica_registre`, `ofertare_clarificare_exceptie_identitate`, `ofertare_clarificare_reconfirma`, `ofertare_clarificari_notifica`, `ofertare_transfer_conflicte_confirma`.
- `ofertare_plansa_coada_inscrie`: poarta e ownerul sau responsabilul.
- `ofertare_derogare_depunere`: poarta e `fn_gate_depunere_derogare_owner`, adică doar ownerul.
- `fn_completare_aplica`: ownerul sau `can_manage_contracts`. SQL-ul dinamic e cu `%I` și câmpurile sunt dintr-o listă permisă.
- `fn_consum_executa`: ownerul sau `can_manage_stoc`.
- `fn_get_next_nr_factura`: ownerul, superadmin, `admin_logistica` sau contabilitate.
- `fn_hr_autorizatie_propunere_accepta`: ownerul sau `can_access_personal_data`.
- `fn_ocr_decide_manual`, plus `delete_user_by_admin` / `update_user_email_by_admin` (§4).
- ⚠️ Tipar fragil în `fn_consum_executa`: `IF v_uid IS NOT NULL AND NOT EXISTS(...)`, adică verificarea se sare când `uid` e NULL. Azi e sigur, pentru că anon n-are EXECUTE. Dacă cineva îi dă vreodată GRANT lui anon, devine ocolire.

### 2D. Funcții doar de citire: 24, risc mic

`fn_ai_inbox_poate_confirma`, `fn_are_acces_ofertare`, `fn_categorie_cantitate`, `fn_chat_total_unread`, `fn_get_export_period_for_date` (ascunde sumele fără drept pe salarii), `fn_is_app_owner`, `fn_is_chat_admin`, `fn_is_chat_member`, `fn_ofertare_cost_ai`, `fn_ofertare_diff_revizii`, `fn_ofertare_obiect_in_pachet_inghetat`, `fn_ofertare_source_pack_poate_decide`, `fn_ofertare_subiect_clasifica`, `fn_subiect_total`, `fn_vehicule_fara_gps_history`, `fn_zile_lucratoare`, `garantii_adresa_eliberare` (citește IBAN și contractul, dar `garantii_rw` e oricum deschis oricui e logat), `hr_verifica_eligibilitate_legator`, `match_carte_utilaj`, `match_normative`, `my_employee_id`, `ofertare_pagini_goale`, `ofertare_pregatire_extragere`, `poate_edita_documente_firma`.

### Colateral: RLS permisiv care face inutil un REVOKE doar pe funcție

Grant-urile implicite Supabase sunt prezente, deci RLS e singura barieră.
- `stocuri_miscari.sm_insert`: `uid IS NOT NULL`. Orice cont logat poate falsifica stocul direct prin REST, nu doar prin `fn_stoc_ajustare`.
- `logistica_alimentari`: DELETE/UPDATE cu `uid IS NOT NULL`. Orice cont logat poate șterge bonuri de combustibil.
- `hr_cereri_concediu`: INSERT/UPDATE cu `uid IS NOT NULL`.
- `notifications`: INSERT cu `uid IS NOT NULL`. Se pot trimite notificări false oricui, inclusiv ownerului.
- Cozile `ofertare_*_coada` au politica ALL cu uid. E deja documentat în `AUDIT_OFERTARE_V2` (S02-01), nu reiau.

---

## 3. TRUNCATE (cerința Copilot §5)

**Mecanismul.** TRUNCATE **nu trece prin RLS** și nu declanșează triggerele de rând. Nici PostgREST, nici pg_graphql nu pot emite TRUNCATE, deci drepturile de mai jos se pot exploata **doar** printr-o cale care rulează SQL arbitrar ca anon sau authenticated. **Azi nu există o asemenea cale** (vezi 3C). Riscul e latent: lipsește un strat de apărare în profunzime.

**Cauza.** Setările implicite pentru tabele (`pg_default_acl`, schema `public`, rolurile `postgres` și `supabase_admin`) dau **`arwdDxtm` (inclusiv TRUNCATE și MAINTAIN) către anon și authenticated** la fiecare tabel nou. `PUBLIC` nu are TRUNCATE pe niciun tabel.

### 3A. Tabelele Ofertare de pachet, poartă și licitații: drepturi efective

| Tabel | anon TRUNCATE | authenticated TRUNCATE | PUBLIC | ACL (`relacl`) | Triggere TRUNCATE | TRUNCATE real, dacă ar exista o cale SQL |
|---|---|---|---|---|---|---|
| `ofertare_licitatii` | **da** | **da** | nu | `anon=arwdDxtm`, `authenticated=arwdDxtm` | niciunul (doar BEFORE UPDATE/INSERT) | **Blocat de FK**: e referit de 46 de FK-uri, iar 7 tabele referente n-au TRUNCATE pentru authenticated, 12 nu au pentru anon (ex. `ofertare_derogari_audit`, `ofertare_source_pack`). Fără CASCADE dă eroare de FK; cu CASCADE îi lipsește dreptul. Protecția e accidentală. |
| `ofertare_pt_pachet` | **da** | **da** | nu | `anon=arwdDxtm`, `authenticated=arwDxtm` (fără `d`) | niciunul (doar BEFORE UPDATE/INSERT) | **anon: posibil** împreună cu `_fisiere`, pentru că are TRUNCATE pe amândouă. authenticated: blocat, fiindcă n-are TRUNCATE pe `_fisiere`, care face referință la `pt_pachet`. |
| `ofertare_pt_pachet_fisiere` | **da** | nu | nu | `anon=arwdDxtm`, `authenticated=arxtm` | – | anon: posibil. **REVOKE-ul a fost făcut invers**: s-a retras de la authenticated, dar a rămas la anon. |
| `ofertare_pt_poarta` | nu | **da** | nu | `authenticated=arwdDxtm` (anon retras) | – | authenticated: blocat. TRUNCATE CASCADE trece prin `pt_pachet` și ajunge la `_fisiere`, unde lipsește dreptul. |
| `ofertare_derogari_audit` | nu | nu | nu | `authenticated=r` | **da**: trigger imuabil pe TRUNCATE/DELETE/UPDATE | protejat corect |

Moștenire prin `pg_auth_members`: niciuna, deci drepturile efective sunt egale cu cele directe. Pentru anon, DELETE prin REST pe `pt_pachet` și `_fisiere` e blocat de RLS, fiindcă nu există politici pentru anon. `pt_poarta` n-are politică de DELETE.

### 3B. Toată schema `public`

- Tabele: **370**. Cu TRUNCATE pentru anon: **332**. Pentru authenticated: **340**. Pentru oricare dintre ele: **341**. Fără TRUNCATE: 29 (`app_secrets`, 11 `_backup_*`, 17 `ofertare_*` blindate). Singurul tabel cu trigger care blochează TRUNCATE e `ofertare_derogari_audit`.
- Ofertare: **66 din 82** de tabele `ofertare_*` au TRUNCATE pentru anon sau authenticated. Printre ele: `ofertare_acoperire`, `_istoric`, `_revizii`, `ofertare_cerinte`, `ofertare_documente_atribuire`, `ofertare_clarificari`, `ofertare_inventar_ai`, `ofertare_garantii`, `ofertare_pt_*`, `ofertare_rfq_*`. Doar authenticated le are pe `ofertare_clarificari_puncte`, `ofertare_pt_afirmatii`, `ofertare_pt_capitole`, `ofertare_pt_legaturi`, `ofertare_pt_observatii`, `ofertare_pt_poarta`, `ofertare_seap_manifest`. Doar anon le are pe `ofertare_pt_pachet_fisiere`.
- Primele 30, în ordine alfabetică: `_backup_acoperire_racari_20260921`, `_backup_clar63_20260927`, `_dedup_racari_20260911`, `_eval_candidati_inainte_20260921`, `_eval_runda1_20260921`, `_eval_runda2_20260921`, `ai_dezbateri`, `ai_dezbateri_mesaje`, `ai_documente_inbox`, `ai_feedback`, `ai_usage_log`, `app_modules`, `avize_cjp`, `avize_serii_counter`, `beneficiari`, `calendar_days`, `chat_members`, `chat_messages`, `chatbot_conversations`, `chatbot_easter_eggs`, `chatbot_usage`, `claude_bot_runs`, `claude_bot_silentiate`, `claude_bot_sugestii`, `claude_context`, `claude_docs`, `comanda_linii`, `comenzi`, `comenzi_aprobatori`, `comenzi_documente`.

### 3C. Funcții care fac TRUNCATE sau DELETE fără WHERE pe Ofertare

- **Nicio** funcție din schemele care nu țin de sistem nu conține `TRUNCATE`, fie SECURITY DEFINER, fie INVOKER.
- SQL dinamic (`EXECUTE`) apare doar în `fn_completare_aplica` (cu poartă, `%I` și listă permisă) și `fn_tichete_notif_on_insert` (neapelabilă de anon sau authenticated).
- DELETE pe tabele `ofertare_*` apare doar în 2 funcții, ambele cu WHERE:
  - `fn_ofertare_cerinta_titular_seteaza`: `WHERE cerinta_id=…`, cu poartă Ofertare.
  - `fn_ofertare_acoperire_rescrie`: `WHERE id IN (...)`, apelabilă doar de `service_role`.
- În `src`, `supabase/functions` și `worker` nu există TRUNCATE în SQL. Singurele apariții sunt `Deno.open(... truncate:true)` pe fișiere.
- **Concluzie §5: nu există funcție SECURITY DEFINER apelabilă de anon sau authenticated care să facă TRUNCATE ori DELETE fără WHERE pe tabelele Ofertare.**

### 3D. Setările implicite pentru funcții

`pg_default_acl` pentru rolul `postgres` în `public` adaugă doar `service_role=X`, dar **setarea globală `PUBLIC=EXECUTE` n-a fost retrasă**. Orice funcție nouă creată fără `REVOKE ... FROM PUBLIC` explicit ajunge apelabilă de anon. Exact așa au ajuns `heartbeat_alerta`, `heartbeat_muti` și `fn_trg_categorie_cantitate`, plus 20 de funcții INVOKER de tip trigger/helper. Pentru `supabase_admin` implicit e chiar `anon=X` și `authenticated=X`.

---

## 4. `delete_user_by_admin` / `update_user_email_by_admin`: confirmat, nu e incident

Amândouă verifică la început, în corp, `EXISTS(profiles WHERE id=auth.uid() AND is_owner)`, altfel dau `RAISE`. Au `search_path = public, pg_temp`. EXECUTE îl au doar `postgres`, `service_role` și `authenticated`, **nu anon**. `delete_user_by_admin` blochează și ștergerea propriului cont. Le apelează doar `App.jsx` L7580 și L6713.

---

## Propuneri, fără apply (fiecare cere acordul lui Razvan și trece prin pct. 3/4)

Riscul de regresie l-am estimat prin grep în `src/`, `supabase/functions/`, `worker/`, `scripts/` și prin căutarea apelurilor din alte funcții SQL.

| # | Candidat | Propunere | Cine o folosește / regresie |
|---|---|---|---|
| P1 | `confirm_hr_autorizatie_rsvti` | **Poartă în corp**, identică cu politica `hr_autorizatii_write_authorized`: `IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id=auth.uid() AND (p.is_owner OR p.can_modify_employees OR p.role='superadmin' OR p.department IN ('HR','Administrativ'))) THEN RAISE EXCEPTION ... USING ERRCODE='42501'`. **Fără REVOKE.** | `HR.jsx` L1929 (viza inițială la crearea autorizației: utilizatorul are deja drept de scriere, deci nicio regresie) și L2137 (butonul „Confirmă viza”). De verificat dacă RTS-ul sau șeful de șantier confirmă vize fără să fie în departamentul HR. Dacă da, trebuie un flag dedicat (A/B). |
| P2 | `fn_ofertare_alege_acoperire` | Poartă: `IF auth.uid() IS NULL OR NOT fn_are_acces_ofertare() THEN RAISE`. Opțional: refuz dacă licitația are pachet `aprobat`/`depus`. | `OfertareLicitatii.jsx` L2627, `OfertareCerinte.jsx` L224/L236. Toți apelanții sunt deja în modulul Ofertare, deci **regresie zero** pentru utilizatorii legitimi. |
| P3 | `ofertare_inventar_pereche` | Poartă `fn_are_acces_ofertare()` + prag minim (ex. `p_prag := greatest(coalesce(p_prag,0.45),0.30)`) sau scoaterea parametrului din semnătura publică. | `OfertareLicitatii.jsx` L2410, care apelează **fără `p_prag`** (implicit 0.45), deci regresie zero. |
| P4 | `fn_stoc_ajustare` | Poartă `is_owner OR can_manage_stoc` (ca în `fn_consum_executa`). **Și** strângerea `stocuri_miscari.sm_insert` (altfel ocolirea rămâne prin REST), dar asta e o decizie separată (A/B/C), fiindcă trebuie mai întâi grep după INSERT-uri directe din client. | `Magazie.jsx` L295 (modalul de ajustare). Regresie: cei din Magazie fără `can_manage_stoc` pierd ajustarea. De confirmat lista. |
| P5 | `fn_transfer_executa` | Poartă care trebuie decisă cu Razvan (A: `can_manage_stoc`; B: + `admin_logistica`; C: + accesul la modulul `achizitii`). | **3 module**: `Logistica.jsx` L5447, `Achizitii.jsx` L2027, `Magazie.jsx` L1245. Risc de regresie **mare** dacă poarta e prea strictă. |
| P6 | `fn_ofertare_revizie_noua` | `REVOKE EXECUTE ON FUNCTION public.fn_ofertare_revizie_noua(integer,text,bigint) FROM authenticated;` | **0 apelanți** (grep; docs `03_acoperire_resurse.md` C-13), deci **regresie zero**. |
| P7 | `fn_concediu_consolidare` / `fn_concediu_autogen` | `REVOKE EXECUTE ... fn_concediu_consolidare(integer,date) FROM authenticated;` + poartă în `fn_concediu_autogen` (rescrisă în plpgsql): `is_owner OR can_access_personal_data OR department='HR'`. | Triggerul `trg_pontaj_co_autogen` (pe `pontaj_records`) e **SECURITY DEFINER (postgres)**, deci nu e afectat de REVOKE. UI: `TabConcedii.jsx` L272 („Generează lipsă”). Regresie: doar dacă apasă butonul cineva din afara HR. |
| P8 | `fn_ofertare_acoperire_reverifica_alese` | `REVOKE EXECUTE ... FROM authenticated;` | Singurul apelant e edge-ul `ofertare-acoperire/core.ts` L530, cu clientul service_role (în același flux apelează `fn_ofertare_acoperire_rescrie`, care e doar service_role). Regresie zero; de confirmat la deploy. |
| P9 | `fn_match_qr_rompetrol` | Poartă identică cu `fn_ocr_decide_manual` (`is_owner OR can_access_pontaj_brut OR role IN ('admin_logistica','contabilitate')`). | `Logistica.jsx` L8993, `ImportRompetrolModal.jsx` L559. Regresie: operatorii de import fără aceste roluri. |
| P10 | `fn_get_next_nr_aviz` | Poartă ca la `fn_get_next_nr_factura` sau REVOKE. | **0 apelanți** în repo și în alte funcții SQL. REVOKE cu risc mic; de verificat să nu fie apelat din alt proiect. |
| P11 | `heartbeat_alerta`, `heartbeat_muti`, `fn_trg_categorie_cantitate` | `REVOKE EXECUTE ON FUNCTION public.heartbeat_alerta(), public.heartbeat_muti(), public.fn_trg_categorie_cantitate() FROM PUBLIC, anon, authenticated;` | Nu apar în UI. `heartbeat_muti` e apelată doar de `heartbeat_alerta` (DEFINER). Cron-ul `heartbeat_alerta` rulează, presupun, ca `postgres`; **de verificat în `cron.job`**, pe care nu l-am citit fiindcă nu e pe lista de cataloage. Triggerele nu cer EXECUTE la declanșare. Închide cele 4 semnalări anon (rămâne RSVP, care e intenționat). |
| P12 | `heartbeat_scrie` (+ politica `heartbeat_rw`) | Întâi aflăm cu ce identitate îl apelează „tura de noapte” (nu e în repo). Dacă e service_role: REVOKE de la authenticated. Dacă e JWT de utilizator: fără INSERT de chei noi (doar UPDATE pe cheile existente) + politica restrânsă. | Risc: dacă e revocat orbește, tura de noapte nu mai raportează. |
| P13 | Setarea implicită pentru funcții | `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;` (global, nu doar `IN SCHEMA`). | Funcțiile existente nu sunt afectate. Pentru funcțiile noi care trebuie să fie publice (de tip RSVP) trebuie GRANT explicit. |
| P14 | TRUNCATE pe toată schema | `REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;` + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;` (setările `supabase_admin` probabil nu se pot schimba ca `postgres`, de notat). | **Regresie zero, verificată**: nicio funcție SQL, edge sau worker nu face TRUNCATE, iar PostgREST nu poate. |
| P15 | Grant-uri anon pe pachet + `olx_tokens` | `REVOKE ALL ON public.ofertare_pt_pachet, public.ofertare_pt_pachet_fisiere FROM anon;` (corectează REVOKE-ul făcut invers) și `REVOKE ALL ON public.olx_tokens FROM anon, authenticated;` (ca la `app_secrets`). | Anon n-are politici pe tabelele de pachet, deci nicio utilizare funcțională. `olx_tokens`: de verificat că `olx-aplicari-sync` folosește service_role. |

**Ordinea propusă** (tot după acord): P6, P8, P11 și P14 n-au regresie și pot merge într-o singură migrare. Urmează P2, P3 și P1 (poartă în corp, cu risc mic). La final P4, P5, P7, P9 și P12, care cer mai întâi decizia A/B/C a lui Razvan despre cine are drept.
