# Lot C / D1 — scrierea în tabelele Logistică legată de accesul pe modul (SPEC, nimic aplicat)

**Stare:** specificație, 03.10.2026. Sursa: auditul Logistică (claude_context #1578, Copilot: „D1 primul după PR-A”).
**Nu se aplică nimic** până la: decizia lui Răzvan pe întrebările de la §6 → migrare + test pe pg local → GO Copilot pe SQL → „aplica”.

## 1. Problema
Aproape toate tabelele `logistica_*` au politici de scriere `auth.uid() IS NOT NULL` (INSERT/UPDATE/DELETE). Accesul pe modul (`user_module_access`, nivel admin/editor/viewer) e verificat doar în interfață. Orice cont logat (inclusiv cineva fără modulul Logistică) poate, direct prin API, să modifice sau să șteargă alimentări, utilaje, stocuri de rezervor, fișe de service etc.

Excepții deja restrânse (nu se ating): `logistica_cesiuni_subcontractor` (DELETE), `logistica_importuri_rompetrol`, `logistica_qr_submit_log`, `logistica_service_parteneri`, `logistica_subcontractori` (DELETE), `logistica_telemetrie_zilnica`, `whatsapp_imports_log`, `whatsapp_messages_processed`.

## 2. Cine are azi acces la modul (citit din BD, 03.10.2026)
| Nivel | Cine |
|---|---|
| admin (3) | Amalia Cristiana Pușcașu, Daniel Oancea, Mitrache Alexandru |
| editor (8) | Apostol Andrut, Cristina Dumitrescu, Kostas T, Madalina Tanase, Mioara Olaru, Mirela Rosu, Oana Nica, Silviu Stanescu |
| viewer (5) | Eugen Nica, Marian Mănăilă, Mirela Popescu, Razvan Toma, Titi Jeno |
| owner | Razvan Trusu, Tudorache Marilena Claudia (bypass) |

Interfața: `canEdit = admin || editor` (viewer = doar citire). Aprobarea transporturilor și importurile folosesc însă și **rolul** (`superadmin`, `admin_logistica`): de ex. Titi Jeno are rolul `admin_logistica`, dar modulul doar `viewer`.

**Actualizat 03.10.2026 seara, după deciziile lui Răzvan (§6), APLICAT cu confirmare:** 7 editori din alte departamente au trecut pe viewer (Cristina Dumitrescu, Kostas T, Madalina Tanase, Mioara Olaru, Mirela Rosu, Oana Nica, Silviu Stanescu), iar Titi Jeno a trecut din viewer în editor. Stare nouă: **admin 3** (Cristiana, Daniel Oancea, Mitrache Alexandru) · **editor 2** (Apostol Andrut, Titi Jeno) · **viewer 11**. Rollback și id-uri: claude_context #1580.

## 3. Cine scrie din AFARA modulului (scanare cod pe main 79a5f09)
| Tabel | Scrie din | Ce face |
|---|---|---|
| `logistica_active` | AppMobilManageri (managerii de șantier), InventarCorectii (App) | stare „Nefunctional” la problemă raportată; nr_inventar din registru |
| `logistica_alocari` | TabSantiere (Execuție) | alocă / scoate utilaje pe șantier |
| `logistica_probleme`, `_jurnal` | AppMobilManageri | managerul raportează o problemă la utilaj |
| `logistica_transporturi`, `_continut` | Achiziții (cereri de transport); în Logistică acționează solicitantul, managerii plecare/destinație, aprobatorii (rol) | cerere, aprobare, confirmare primire, anulare |
| `logistica_furnizori` | Achiziții, Administrativ, CereriInterneProiect | registru comun de furnizori |
| `logistica_documente` | CitesteOricePanel (HR, Execuție, Financiar…), DocumentScannerButton | atașare documente utilaj |
| `logistica_setari`, `logistica_depozite` | App (setări firmă), UnitatiProtejate (Administrativ) | date de identificare firmă, depozite |

Tabele scrise **doar** din Logistică (20): achizitii_vrac, active_km_ore_ajustari, alimentari, avize_arhiva, bonuri_comune, cesiuni_subcontractor, declaratii, imprumuturi, mentenanta_istoric, mentenanta_plan, probleme_jurnal*, rezervoare, service_fise, service_fise_documente, service_intrari, subcontractori, supape, telemetrie_zilnica, whatsapp_* (*și din AppMobilManageri, vezi mai sus). Plus cele scrise din componente montate în Logistică: amc, amc_tipuri, piese_catalog, piese_istoric, piese_poze, alerte_consum, bonuri_carburant, categorii, costuri, curse_gps, oscar_dispense, tipuri_documente, comenzi_transport(_itemi), alimentari_card, active_poze, mentenanta_*, audit_log.

Nu sunt afectate: edge functions cu service_role (QR șoferi, importuri automate), funcțiile SECURITY DEFINER (fn_match_qr_rompetrol, fn_ocr_decide_manual, fn_sync_alimentari_to_active_km_ore, fn_cesiune_update_stoc_rezervor…). Triggerele **invoker** care scriu în Logistică: `update_stoc_rezervor` (alimentari → rezervoare), `update_stoc_achizitie` (achizitii_vrac → rezervoare), `check_alerta_consum` (bonuri_carburant → alerte_consum) — pornite doar din tabele Logistică, deci aceiași scriitori trebuie să aibă drept pe rezervoare / alerte_consum.

## 4. Propunere
Două funcții noi, ca `fn_are_acces_ofertare` (SECURITY DEFINER, `search_path = public, pg_temp`, EXECUTE doar `authenticated`):
- `fn_logistica_poate_scrie()` = owner **sau** `user_module_access(module='logistica', access_level IN ('admin','editor'))` [**sau** rol `admin_logistica` — vezi Q1]
- `fn_logistica_poate_sterge()` = owner **sau** `user_module_access(module='logistica', access_level='admin')` [**sau** rol `admin_logistica`]

| Grup | Tabele | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| G1 doar-Logistică | cele ~35 de la §3 (fără excepțiile din §1) | poate_scrie | poate_scrie | poate_sterge |
| G2 partajate | active | poate_scrie | poate_scrie **sau** rol `manager_santier` (raportarea defectului din teren pune stare „Nefunctional”); restrângerea doar pe coloana `stare` printr-un RPC = pas ulterior | poate_sterge |
| | alocari | poate_scrie **sau** acces `executie` | idem | poate_scrie **sau** acces `executie` |
| | probleme, probleme_jurnal | orice autentificat (raportare din teren) | poate_scrie **sau** autorul | poate_sterge |
| | transporturi, _continut | orice autentificat (cereri) | poate_scrie **sau** participant (solicitant / manager plecare / manager destinație) **sau** rol aprobator | poate_sterge **sau** solicitantul cât e „cerut” |
| | furnizori | orice autentificat | orice autentificat | poate_sterge |
| | documente | orice autentificat (CitesteOrice) | poate_scrie **sau** autorul | poate_sterge |
| | setari, depozite | owner **sau** poate_scrie **sau** acces `administrativ` | idem | owner |
| SELECT | toate | neschimbat în D1 (citirea e alt subiect) | | |

Livrare (ca la #595/#596): migrare `2026101xa_logistica_rls_modul.sql` cu snapshot-ul politicilor vechi + rollback complet, harness pe pg local (utilizator fără acces / viewer / editor / admin / owner / manager de șantier / service_role × INSERT/UPDATE/DELETE pe fiecare grup, plus triggerele de stoc), GO Copilot pe SQL, apoi runner-ul la „aplica”. Înainte de aplicare, lista de la §2 se recitește din BD (poate s-a schimbat).

**Note după scanarea suplimentară:**
- Butonul global „Cere transport” e afișat pentru modulul separat `comanda_transport` (de ex. Kostas, Titi) și deschide formularul din Logistică. Deci INSERT-ul pe `logistica_transporturi` / `_continut` trebuie să rămână deschis cererilor, cum e în tabel.
- Aprobarea transporturilor în UI se face pe rol (`superadmin`, `admin_logistica` — `isAprobatorTransport`). Cu Q1 = „doar modulul”, regula de UPDATE pe transporturi păstrează **explicit** excepția pentru aprobatori ca să nu rupă fluxul de azi, sau UI-ul se aliniază la modul. **De confirmat cu Răzvan la review-ul SQL.**

## 5. Riscuri
- Cine scrie azi fără drept în modul va primi eroare (ex. un viewer care importa ceva). Lista de la §2 + Q1/Q2 decid asta explicit.
- Ecranele din afara Logisticii nelistate la §3 (dacă scanarea a ratat ceva) ar primi erori RLS — harness-ul și o săptămână de urmărire a erorilor 42501 în Sentry după aplicare.
- Mesajele de eroare RLS în UI sunt tehnice; se pot traduce ulterior.

## 6. Decizii Răzvan (03.10.2026) — RĂSPUNSE
- **Q1 → A**: doar modulul (admin/editor) + owner. Rolul `admin_logistica` nu e suficient.
- **Q2 → A**: ștergere doar admin modul + owner.
- **Q3 → B**: editorii din alte departamente trec pe viewer (aplicat, vezi §2), plus Titi Jeno trece pe editor.

Întrebările inițiale:
- **Q1** Rolul `admin_logistica` (Titi Jeno: rol admin_logistica, modul viewer) dă drept de scriere? A) nu, doar modulul (Titi trece pe editor dacă trebuie să scrie) · B) da, rolul contează ca editor.
- **Q2** Ștergerea în tabelele Logistică: A) doar admin-ii modulului + owner (Cristiana, Daniel, Mitrache) · B) și editorii.
- **Q3** Editorii din alte departamente (Cristina Dumitrescu, Kostas, Madalina, Mioara, Mirela Rosu, Oana Nica, Silviu Stanescu) rămân editori pe Logistică? A) da, nu schimb nimic · B) îi trec pe viewer (cer listă de la tine).

## 7. Design final după analiza din 03.10 seara (de aici se scrie migrarea — NIMIC scris/aplicat încă)
**Instantaneu live (read-only, 03.10):** 46 de tabele în domeniu, 172 de politici, din care 122 de scriere deschise (`auth.uid() IS NOT NULL`); md5 politici (formula din 20261005b, pe cele 46 de tabele) = `0bbc8a8b9ed7f45c0b5008519ab47666` → precondiția migrării. Rămân în afara domeniului (deja pe rol): service_parteneri, telemetrie_zilnica, whatsapp_imports_log, whatsapp_messages_processed. Nume propus: `20261013a_logistica_rls_modul` (de verificat prefixul față de schema_migrations la scriere).

**Helperi** (SECDEF, sql, STABLE, `search_path = public, pg_temp`, EXECUTE doar authenticated/service_role): `fn_logistica_poate_scrie()` (owner ∨ modul logistica admin/editor), `fn_logistica_poate_sterge()` (owner ∨ modul logistica admin), `fn_acces_modul_scriere(text)` (owner ∨ modulul dat admin/editor — pentru executie/administrativ), `fn_logistica_rol_in(text[])`, `fn_logistica_transport_poate_edita(integer)` (poate_scrie ∨ rol aprobator ∨ solicitant/manager plecare/manager destinație pe transportul dat).

**Reguli** (W = poate_scrie, D = poate_sterge; SELECT neschimbat; unde era politică `ALL` se pune un SELECT identic cu citirea de azi):
- G1 (W/W/D): achizitii_vrac, active_poze, alerte_consum, alimentari, alimentari_card, amc, amc_tipuri, audit_log, avize_arhiva, bonuri_carburant, bonuri_comune, categorii, comenzi_transport(_itemi), costuri, curse_gps, declaratii, imprumuturi, mentenanta_istoric/plan, oscar_dispense, piese_catalog/istoric/poze, rezervoare, service_fise(_documente), service_intrari, service_itemi_preset, supape, tipuri_documente. Doar INSERT: active_km_ore_ajustari, importuri_rompetrol, qr_submit_log. INSERT+UPDATE: cesiuni_subcontractor, subcontractori (DELETE-urile lor pe rol rămân neatinse).
- active: INSERT W · UPDATE USING W ∨ rol manager_santier, CHECK W ∨ (manager_santier ∧ stare='Nefunctional') (raportul din /m; cei 10 manageri cu profile_sites au toți rolul ăsta) · DELETE D.
- alocari: W ∨ modul executie (TabSantiere), la toate trei.
- probleme, probleme_jurnal: INSERT/UPDATE W ∨ created_by = eu (AppMobilManageri trimite created_by) · DELETE D.
- documente: INSERT/UPDATE W ∨ created_by = eu (CitesteOrice/DocumentScanner trimit created_by) · DELETE D.
- furnizori: INSERT rămâne deschis (politica actuală NU se atinge — registru comun) · UPDATE W ∨ administrativ · DELETE D.
- setari, depozite: INSERT/UPDATE W ∨ administrativ · DELETE D.
- transporturi: INSERT W ∨ (solicitant_id = eu ∧ status='cerut') · UPDATE fn_logistica_transport_poate_edita(id) · DELETE D ∨ (solicitant = eu ∧ status='cerut').
- transporturi_continut: toate trei prin fn_logistica_transport_poate_edita(transport_id) (editarea transportului șterge și reface pozițiile — nu e „ștergere” de utilizator).
- Triggerele invoker (alimentari→rezervoare, achizitii_vrac→rezervoare, bonuri_carburant→alerte_consum) rămân acoperite: aceiași scriitori au W pe țintă. Restul triggerelor/funcțiilor care scriu sunt SECDEF.

**De întrebat la review-ul SQL:**
- **Q4 — aprobarea transporturilor pe rol.** Azi aprobă din UI rolurile superadmin + admin_logistica. 6 superadmini nu au scriere în Logistică: Nica Oana, Pantea, Dumitrescu Cristina, Tănase Mădălina, Kostas, Udrea. Propunere: (A) excepția pe rol rămâne în fn_logistica_transport_poate_edita și fluxul nu se schimbă — **recomandat** · (B) doar modulul, iar UI-ul se aliniază.
- Natalia (can_modify_employees, intră în /admin) nu va mai putea schimba datele firmei și depozitele. Rămân la owner + Logistică + Administrativ.

**De făcut în UI înainte de aplicare (PR mic):** ștergerile din avize_arhiva, documente și amc șterg PDF-ul din Storage ÎNAINTE de rândul din BD. Când RLS refuză (editor, nu admin), rămâne rândul fără PDF. Ordinea trebuie inversată (BD, apoi Storage), iar butonul de ștergere ascuns pentru non-admin. Și lista de transporturi afișează ✏️/🗑 oricui vede tabul.

**Pașii rămași:** schelet `supabase/tests/rls_logistica_schelet.sql` (cele 172 de politici, verificat cu md5 0bbc8a8b…) → migrare + `supabase/revenire/…_ROLLBACK.sql` → `scripts/test_rls_logistica.sh` (pe modelul test_rls_garantii.sh; identități: fără acces, viewer, editor, admin, owner, manager_santier, comanda_transport, executie, administrativ, superadmin; plus triggerele de stoc) → Copilot → „aplica”.
