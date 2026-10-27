## E1-1a — 27.10.2026
1. Pasul 0 executat; citite lecțiile L01–L25, planul r4–r7 și faptele furnizate. Scrieri numai în worktree.
2. Adăugate `supabase/migrations/20261118a_portal_teren_identitate.sql` și revenirea omonimă în `supabase/revenire/`.
3. Rol `teren` izolat; clasificare completă, jurnal append-only, eligibilitate comună, hook STABLE fail-closed și poartă ACL.
4. Hook-ul NU este configurat/activat. `handle_new_user`, profiles și drepturile ERP existente nu sunt modificate.
5. Inventarul recalculează toate UUID-urile la apply, sub lock; verifică separat cele trei emailuri și fișele 55/70/NULL.
6. **`test.razvan@teren.gazpet.ro`: employee_id NULL, neeligibil; hook-ul refuză tokenul. Nu s-a inventat fișă.**
7. **HOLD:** lipsește inventarul revizuit al celor 21 de funcții PUBLIC; migrarea originală refuză atomic aplicarea.
8. `scripts/portal/inventar_public.sql` oferă interogarea read-only pentru operator; nu a fost executată. Lista nu se învață automat din țintă.
9. Harness PG17: `scripts/test_portal_e1.sh`, wrapper manual `scripts/portal/harness_wsl.sh`; livrare/revenire prin runner ca postgres NOSUPERUSER.
10. Harness-ul folosește EXCLUSIV o copie cu 21 de funcții sintetice (`prepare_fixture.py`); aceasta NU validează funcțiile PUBLIC din producție.
11. Testele SQL acoperă hook/RLS/ACL, ban, revocare, date locale, identitate proprie, inventar cu numere egale dar seturi diferite și audit.
12. Revenirea compară toate rândurile/jurnalul și metadatele DDL; harness-ul verifică refuzul cu istoric nou/RLS schimbat, dispariția obiectelor, pg_dump și rolurile originale.
13. Rulate: `python -X utf8 scripts/portal/test_static.py` — **3 teste trecute**; validator original/revenire/copie sintetică acceptate; ambele scripturi `bash -n` trecute.
14. **Nerulate:** PG17, Supabase Auth real, `control_0e.sql`, apply/rollback și testele SQL; rezultatele acestora NU sunt declarate trecute. WSL enumerare: E_ACCESSDENIED.
15. Fără Git, credențiale, conexiuni BD, deploy, date reale sau ALTER DEFAULT PRIVILEGES. E1-1b și modulele opt-in rămân în afara feliei.

## L01–L25 — dovezi și limite
- L01: migrare:3–26 — advisory înaintea verificărilor, apoi lock auth.users/profiles înainte de inventar; UNIQUE în BD.
- L02: `scripts/test_portal_e1.sh::runner` folosește livrarea într-o singură tranzacție; `fn_conturi_tip_audit` jurnalizează atomic schimbările.
- L03 n/a.
- L04 n/a — fără provisioning, cantități, bani sau trimiteri în E1-1a.
- L05: runner-ul existent păstrează reconcilierea și codurile NECUNOSCUT; harness-ul nu reîncearcă automat livrări cu rezultat ambiguu.
- L06: migrare:14–26 și revenire:2–13 — aceeași ordine advisory → auth.users → tabele dependente; documentată în SQL.
- L07: migrare:44–97 și `fn_portal_porti_lipsa`; SQL `client` verifică permission denied inclusiv pe tabelele-sursă cu politici largi, INSERT și UPDATE (test PG nerulat).
- L08: `fn_teren_eligibil` leagă ținta de auth.uid(); excepție server numai rolul Auth real; proveniența nu e scriibilă de clienți; audit server-side.
- L09: SQL `client` — auto-verificarea colegului/NULL refuzată; nu există RPC nou cu acces la proiecte/module (test PG nerulat).
- L10: `fn_auth_token_hook` returnează numai eroarea generică 403; fixture-urile CNP/IBAN sunt sintetice; fără credențiale.
- L11 n/a.
- L12: poarta compară ambele diferențe de seturi; SQL `same_count_wrong_set` dovedește cazul numărătorilor egali (test PG nerulat).
- L13: `test_static.py::test_fixture_refuses_missing_or_duplicate_marker` trecut; UUID malformat este refuzat în SQL `bad` (PG nerulat).
- L14: gărzi runner, preflight, postcondiții; revenire cu lock înainte de comparația integrală date/jurnal/DDL, fără CASCADE; harness apply → refuz retry → rollback → refuz retry (PG nerulat).
- L15: poarta verifică ACL efectiv inclusiv coloane/secvențe/view-uri/MAINTAIN și membership; revenirea amprentează definiții/owner/config/ACL/RLS/politici/triggere. **HOLD pentru baseline-ul și auditul tranzitiv al celor 21 PUBLIC: surse absente, fără pretenție de conformitate completă.**
- L16: conturi_tip PK UUID, conturi_teren PK UUID și employee_id UNIQUE/FK; NULL permis explicit pentru contul de test, fără eligibilitate.
- L17: `fn_teren_eligibil` folosește Europe/Bucharest și ultima zi inclusiv; SQL `ended` testează ieri/azi (PG nerulat; tranziția reală la miezul nopții nu a fost simulată).
- L18: hook fără clasificare/tip valid/citire/claims valide → 403; eligibilitate IS TRUE; SQL missing/bad_type/inaccessible/unknown_active (PG nerulate).
- L19: `fn_teren_eligibil` este predicatul unic pentru hook și auto-verificare; fără duplicare în UI/edge.
- L20: `portal_e1_1a.test.sql` include ERP și teren valide, toate stările neeligibile, ban, marker absent și ACL drift (PG nerulat).
- L21 n/a.
- L22 n/a.
- L23 n/a.
- L24 n/a.
- L25: bootstrap PG17 NOSUPERUSER/BYPASSRLS, membership de test fără INHERIT, RLS și granturi reale, apel hook ca supabase_auth_admin și clienți ca teren/authenticated; **dovada de execuție PG rămâne de obținut**.

### E1-1a — integrare (Izometrie, 27.10)
- **Lista albă PUBLIC completată:** cele 21 de semnături din inventarul read-only de pe prod (`scripts/portal/inventar_public.sql`). 20 sunt SECURITY INVOKER, deci rolul `teren`, fără tabele, nu poate citi sau scrie nimic prin ele. Singura DEFINER, `fn_trg_categorie_cantitate`, e funcție de trigger și nu se poate apela prin RPC. Fixture-ul harness-ului o înlocuiește cu 21 de funcții sintetice.
- **Constatare pe prod:** schema `auth` dă USAGE doar lui anon / authenticated / service_role / postgres, iar `postgres` **nu are GRANT OPTION**. De aceea s-a adăugat helper-ul DEFINER `public.fn_portal_uid()` (EXECUTE doar `teren`). **Politicile `TO teren` din modulele opt-in vor folosi `fn_portal_uid()`, nu `auth.uid()`**. Testul verifică și că `teren` nu ajunge la schema `auth`.
- `MAINTAIN` (PG17) intră în poartă doar pe serverele de la 17 în sus. Harness-ul acceptă PG16 doar explicit (`PORTAL_PG_MAJOR=16`).
- **Testul:** reparată coliziunea variabilă / alias (`p`) în bucla pe funcții (L-coliziune).
- **Rezultat:** `PORTAL_PG_MAJOR=16 scripts/portal/harness_wsl.sh 4` → **PASS** (apply prin runner ca postgres NOSUPERUSER, hook, izolarea `teren`, poarta, inventarul, revenirea).
- **Rămâne:**
  - rularea pe **PG17** (în WSL nu există PG17; cere repo PGDG pe server, o schimbare de sistem care cere „da”);
  - review Copilot;
  - E1-1b (provisioning, `handle_new_user`, aprobarea ERP, revocarea).
