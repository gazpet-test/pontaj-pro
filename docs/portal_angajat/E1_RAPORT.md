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

## E1-1b — 27.10.2026
1. Citite întâi lecțiile L01–L25; executat Pasul 0. Scrieri exclusiv în worktree, fără Git/BD/credențiale/deploy.
2. Migrare nouă `supabase/migrations/20261119a_portal_teren_provisioning.sql` și revenire omonimă în `supabase/revenire/`; fișierele migrării 18a nemodificate.
3. Rezervări cu UUID de intenție, hash de payload, unicitate pe angajat deschis/email; RLS fără granturi client și jurnal append-only.
4. Pregătire owner/modul exact `hr`; lock advisory email → angajat → rezervare; email prenume.nume, toate prenumele, fără diacritice, sufix .2/.3.
5. Retry cu aceeași cheie întoarce aceeași rezervare și UUID Auth/stare; alt payload este refuzat; fără rezervare nouă după timeout.
6. `handle_new_user`: corpul LIVE ancorat literal, owner/ACL/config verificate și manifest SHA256; ramură teren directă, fără fereastră manager și fără notificări.
7. Ramura obișnuită păstrează exact codul LIVE, cu rol inițial `in_asteptare` și fără clasificare; aprobarea ERP este numai owner și jurnalizată.
8. Constrângerea LIVE `profiles_role_chk` este extinsă pentru cele două roluri și restaurată exact la revenire; lista albă ERP rămâne cea LIVE.
9. Finalizare unică, service_role real, CAS și postcondiții inclusiv zero module; apelul repetat validează aceeași identitate și este idempotent.
10. Plecarea revocă în aceeași tranzacție; reactivarea nu reactivează contul. `creat_la` legacy rămâne NULL, fără inventarea unei date.
11. **Diferență față de r6:** brief-ul cere azi/ieri → revocat; predicatul comun folosește `termination_date > azi Europe/Bucharest`. Inclusiv hook-ul îl folosește; definiția veche a `fn_teren_eligibil` este manifestată și restaurată.
12. Poartă separată `fn_portal_porti_lipsa_1b`, fără funcții noi pentru teren; amprentează funcții public + auth.uid/jwt, ACL, coloane, RLS, politici și triggere. Conturile pending rămân alertă de inventar.
13. Revenire: lock înaintea comparației tuturor rândurilor/istoricului și DDL; refuz dacă s-au schimbat; restaurare exactă definiții/owner/ACL/config. Snapshot-urile datelor sunt hash-uri; Auth nu copiază parole.
14. `supabase/tests/portal_e1_1b.test.sql`: autorizare reală, coliziuni, metadate greșite, hook pending/aprobat, CAS/idempotent, plecare azi/ieri, nereactivare, angajat plecat între rezervare și creare, audit/callee drift.
15. Harness extins: 18a → 19a, regresii 18a, două sesiuni cu FIFO/barieră și wait PID, refuz rollback cu date/RLS noi, rollback/reapply 19a, restaurare 19a apoi 18a și comparație pg_dump.
16. **Rulate static:** `test_static_1b.py` 6/6 + `test_static.py` 3/3; ambele artefacte noi acceptate de validator; `bash -n` pentru harness, wrapper și concurență: trecute.
17. **Nerulate:** PostgreSQL 16/17, concurența SQL, apply/revenire/reapply, control_0e și Supabase Auth real. Operatorul rulează `PORTAL_PG_MAJOR=16 bash scripts/portal/harness_wsl.sh <slot>`; PG17 și GoTrue real rămân necesare pentru validare finală.

### E1-1b — L01–L25: dovezi și limite
Referințe: M = `supabase/migrations/20261119a_portal_teren_provisioning.sql`; R = `supabase/revenire/20261119a_portal_teren_provisioning_ROLLBACK.sql`; T = `supabase/tests/portal_e1_1b.test.sql`. Toate dovezile SQL sunt **scrise, nerulate**.
- L01: M `fn_portal_cont_pregateste`, `fn_portal_cont_finalizeaza`, `fn_cont_aproba_erp`: lock înainte de verificările țintei; T refuz rezervare dublă; `scripts/portal/concurrency_1b.sh` două sesiuni reale.
- L02: M `fn_portal_cont_finalizeaza` actualizează rezervare + cont și jurnal în aceeași tranzacție, CAS cu verificarea fiecărui rezultat și postcondiții; T „Partial finalize”.
- L03: M finalizare CAS pe UUID, starea citită și `auth_user_id`, fără suprascrierea unei rezervări schimbate; T finalizare dublă și refuz după revocare.
- L04: M cheie UUID PK + payload_sha256(employee_id, auth.uid), UNIQUE angajat deschis/email; T aceeași cheie repetată, cheie cu alt angajat, altă cheie pe același angajat.
- L05: M pregătirea repetată întoarce starea și auth_user_id persistente; T reconciliere după finalizare; niciun fallback sau cleanup automat după timeout.
- L06: ordinea lock-urilor este comentată în fiecare RPC/trigger; namespace email înainte de angajat, apoi rezervare → clasificare → cont → profil; FK-urile către angajat/rezervare respectă ordinea. R blochează înainte de verificare.
- L07: M tabele cu RLS și fără granturi client, proveniență/jurnal scrise server-side, trigger employees; T SELECT direct refuzat, INSERT Auth ca supabase_auth_admin, privilegii teren verificate.
- L08: M RPC-urile client folosesc numai auth.uid() și refuză NULL; excepția finalizării verifică rolul SQL real service_role; `test_static_1b.py::test_client_executable_functions_have_no_identity_writer_or_dynamic_sql` trecut.
- L09: M pregătire owner sau intrare pe cheia exactă hr; aprobare numai is_owner; T rol hr fără modul/hr_extra/non-owner refuzate și modul hr acceptat.
- L10: nu se generează/parcurg parole ori PIN-uri; erorile noi de business au coduri generice. M snapshot Auth selectează numai identitatea/metadatele/ban-ul, fără encrypted_password; manifestul nu are granturi client.
- L11 n/a.
- L12: poarta 1a este păstrată și compară diferențele ambelor seturi de identități; poarta 1b nu ascunde conturile pending. Regresia `portal_e1_1a.test.sql::same_count_wrong_set` este relansată de harness.
- L13: M regex email/nume ancorate; metacaracterele domeniului sunt literale `[.]`; T nume cu diacritice/multiple prenume și nume cu un singur cuvânt. Casting invalid în metadate eșuează, fără continuare tacită.
- L14: M/R cer runner tranzacțional, lock/preflight înainte de CHECK/FK, postcondiții; R refuză date/istoric/DDL noi și nu folosește CASCADE. Harness: roundtrip, refuz date/RLS, pg_dump și revenire 19a înainte de 18a.
- L15: M `fn_portal_1b_snapshot`/poarta separată: corp+owner+ACL+config, auth.uid/jwt, RLS/politici/triggere/coloane; T callee drift fără schimbare ACL. Limită: nu există analiză tranzitivă arbitrară a funcțiilor legacy din alte scheme/extensii; amprenta acoperă public și helperii Auth expliciți.
- L16: M PK UUID, UNIQUE email canonic, employee_id NOT NULL + UNIQUE parțial rezervat/creat, conturi_teren.provisioning_id UNIQUE FK; T coliziune .2 și concurență în scriptul dedicat.
- L17: M predicat comun Europe/Bucharest, fără offset fix; T azi/ieri și active NULL. Semantica azi este cea cerută de brief, diferită de r6; tranziția reală la miezul nopții nu a fost executată.
- L18: M IS TRUE/IS NOT TRUE/IS DISTINCT FROM, liste albe de stări/roluri și excepții pentru rezervări/metadate/postcondiții nevalide; T neaprobat și in_creare nu primesc token.
- L19: M `fn_portal_angajat_eligibil` folosit de pregătire, creare, finalizare, revocare și fn_teren_eligibil/hook; `test_static_1b.py::test_hook_and_provisioning_share_employee_predicate` trecut; revenirea restaurează predicatul 18a.
- L20: T owner/hr legitimi și excepțiile negative, aprobare ERP, teren neconvertibil, finalizare validă/dublă/refuzată, angajat plecat între pași, reactivare fără cont reactivat și callee drift.
- L21 n/a.
- L22 n/a.
- L23 n/a.
- L24 n/a.
- L25: fixture pre-baseline cu corpul LIVE și trigger real pe auth.users; apeluri SET LOCAL ROLE authenticated/service_role/supabase_auth_admin și runner postgres NOSUPERUSER. Concurență cu FIFO + pg_stat_activity + wait ambele PID și motiv exact. **PG16/17 și GoTrue real nerulate; cele 9 teste trecute sunt numai statice.**


## E1-1a r2
- Pasul 0 executat; modificari exclusiv in worktree, fara Git/DB/deploy/credentiale.
- 18a: inventar ERP numai pe dovezile aprobate; restul `neaprobat`, NOTICE numai cu numarul.
- Hook: `neaprobat` refuzat; ERP cere claims.role=authenticated; teste pending si rol neasteptat.
- 19a: owner poate aproba neaprobat → erp; UPDATE jurnalizat, autor server-side; lipsa clasificarii ramane admisa pentru conturile noi.
- Baseline: cele 21 de md5 furnizate fixate in migrare; cele 12 net fixate la apply; definitie, DEFINER, owner, config si ACL comparate integral.
- Poarta: zero apartenente teren, authenticator→teren obligatoriu, set exact de scheme aplicative, functii/relatii/coloane/secvente in toate schemele accesibile.
- Interpretare explicita necesara: pg_catalog exclus ca suprafata interna; obiectele standard information_schema (OID<16384) amprentate separat la apply, fara granturi noi. Altfel un PG standard este permanent rosu; aceasta exceptie extinde baseline-ul celor 33 din brief.
- Revenire 18a: atestare Auth in aceeasi tranzactie, dupa verificarea snapshot-ului si inainte de DROP; stub sigur pastrat. Procedura: E1_REVENIRE_AUTH.md.
- Snapshot harness: schema separat, date ORDER BY cheia primara, secvente incluse; UPDATE fara schimbare semantica trebuie sa pastreze snapshot-ul identic.
- Testul static 1b citeste numai definitia LIVE sanitizata din fapte_prod/handle_new_user_27_10.sql, fara dependenta de live/.
- Executat: test_static.py (3), test_static_1b.py (6), test_static_r2.py (2): 11/11; bash -n scripts/test_portal_e1.sh: PASS.
- Adaugat SQL: drift corp/DEFINER/ACL/config/net, schema/functie/relatie noua, membership arbitrar, lipsa authenticator, aprobare pending si stub.
- NERULAT: PostgreSQL, concurenta reala, roundtrip DDL, Auth/PostgREST. Operatorul ruleaza PORTAL_PG_MAJOR=16; niciun PASS PG revendicat.
- Limita: md5-urile prod sunt cele furnizate, neverificate local pe prod; callee-urile tranzitive ale functiilor existente/net nu pot fi certificate din inventarul disponibil.

## L01–L25 — verificare revizia r2
| Regula | Dovada / limita |
|---|---|
| L01 | 18a blocheaza profiles + user_module_access inainte de inventar; fn_cont_aproba_erp blocheaza parintele Auth inainte de clasificare. Concurenta PG nerulata. |
| L02 | Apply/revenire raman tranzactii unice ale runnerului; aprobarea + jurnalul sunt in acelasi RPC/trigger. |
| L03 | n/a |
| L04 | n/a pentru delta; protocolul UUID provisioning existent pastrat. |
| L05 | Runnerul si reconcilierea existente nemodificate; E1_REVENIRE_AUTH.md cere reconciliere la rezultat necunoscut. |
| L06 | Ordinea lockurilor documentata in 18a/19a; revenirea ia lock inainte de snapshot. |
| L07 | fn_portal_porti_lipsa verifica accesul efectiv pe toate schemele aplicative; baseline RLS + ACL fara clienti; teste SQL schema_drift/column_drift. |
| L08 | fn_cont_aproba_erp pastreaza auth.uid() + owner; testele GUC marcate simulare, dovada Auth reala ramane nerulata. |
| L09 | Aprobare numai owner; poarta verifica orice schema cu USAGE si orice membership teren. Teste arbitrary_membership/schema_drift. |
| L10 | Hook/stub eroare generica; NOTICE fara emailuri; test_portable_fact_has_no_inventory. |
| L11 | n/a |
| L12 | Inventar complet auth.users↔conturi_tip, necunoscutele raman neaprobat; teste inventory/pending. |
| L13 | Generator fixture refuza marker lipsa/duplicat (test_fixture_refuses_missing_or_duplicate_marker); domeniul verificat prin egalitate, fara regex de email. |
| L14 | Snapshot include baseline nou, DDL/RLS/politici/triggere; atestare inainte de DROP, stub pastrat intentionat; roundtrip numai pregatit in harness, nerulat. |
| L15 | Amprenta completa in portal_public_baseline; body_drift/definer_drift/acl_drift/config_drift/net_drift. Limita explicita: callee tranzitive necertificate din lipsa definitiilor prod/net; exceptie catalog documentata. |
| L16 | PK baseline pe semnatura canonica; CHECK conturi_tip extins explicit, FK/UNIQUE existente pastrate. |
| L17 | Predicatul existent Europe/Bucharest nemodificat; test_hook_and_provisioning_share_employee_predicate trecut static. |
| L18 | Hook refuza necunoscut/neaprobat/rol ERP incorect; amprente comparate IS DISTINCT FROM; snapshot propaga erorile q. |
| L19 | Hook/provisioning pastreaza helperul comun; test de paritate static 1b trecut, md5 fixture distinct de artefactul prod. |
| L20 | Teste pozitive ERP/teren/aprobare pending si negative de rol, acces, drift; stub permite eveniment ERP identic. SQL nerulat. |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a |
| L24 | n/a |
| L25 | 11 teste statice executate; fixture owner demonstrat si pending neaprobat; harness NOSUPERUSER/regresii/concurenta pastrate, PG16 si Auth real raman nerulate. |
