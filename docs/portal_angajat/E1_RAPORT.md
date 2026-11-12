## E1-1a — 27.10.2026
1. Pasul 0 executat; citite lecțiile L01–L25, planul r4–r7 și faptele furnizate. Scrieri numai în worktree.
2. Adăugate `supabase/migrations/20261118a_portal_teren_identitate.sql` și revenirea omonimă în `supabase/revenire/`.
3. Rol `teren` izolat; clasificare completă, jurnal append-only, eligibilitate comună, hook STABLE fail-closed și poartă ACL.
4. Hook-ul NU este configurat/activat. `handle_new_user`, profiles și drepturile ERP existente nu sunt modificate.
5. Inventarul recalculează toate UUID-urile la apply, sub lock; verifică separat cele trei emailuri și fișele 55/70/NULL.
6. **Contul de test teren (fără fișă): employee_id NULL, neeligibil; hook-ul refuză tokenul. Nu s-a inventat fișă.**
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

## E1-1a/1b r3 — 09.11.2026 (reluare, Copilot r2: NO-GO, P1 2)
Branch-ul a fost adus la zi cu main prin merge (fara rebase). Migrarile din main de dupa 27.10 nu redefinesc
handle_new_user, profiles_role_chk, hook-ul sau rolurile; niciuna nu da EXECUTE prin PUBLIC pe o functie noua
(scanare statica). Verificarea reala ramane inventarul read-only pe prod (`scripts/portal/inventar_prod_e1.sql`).

1. **P1-01 (inventar ERP):** `erp` numai pentru conturile din lista aprobata explicit de owner, fixata in migrare ca
   sha256 pe `auth.users.id::text` (fara UUID-uri sau emailuri in repo). Fisa, `is_owner` sau un drept pe modul nu
   mai clasifica nimic. Refuz atomic: lista goala, element invalid / duplicat / fara cont, cont teren in lista, owner
   lipsa din lista; postconditie: numarul `erp` = numarul de hash-uri. Restul = `neaprobat` (hook 403 pana la
   `fn_cont_aproba_erp`). Fixture nou: cont legat de fisa + drept pe modul, neaprobat -> 403; aprobat de owner -> token.
2. **P1-02 (net):** `fn_portal_net_md5()` = lista exacta + md5 revizuite, fixate inainte de apply; seturile se compara
   in ambele directii, corpurile se compara cu md5-ul revizuit. Harness: corp schimbat inainte de apply (aceeasi
   semnatura, acelasi numar) = refuz, pe net si pe public; amprentele fixture-ului intra in copie ca literali.
3. **Poarta / amprenta 1b pe lista alba (L15):** r2 amprenta toata schema public si toate randurile din employees /
   profiles / auth.users, deci orice migrare a altui modul sau orice editare HR o inrosea si bloca revenirea.
   r3: functiile portalului + handle_new_user cu callee-urile tranzitive revizuite (fn_cont_candidati_angajat ->
   fn_nume_cuvinte / fn_nume_familie -> extensions.unaccent; fn_cont_notifica_owneri), triggerele de pe auth.users,
   profiles, notifications si tabelele portalului, triggerul portalului pe employees, constrangerile profiles; datele
   portalului + profilurile cu rolurile noi + conturile teren. Teste: schimbare fara legatura = poarta verde si
   revenire posibila; trigger nou pe profiles, trigger Auth sau trigger de revocare dezactivat = rosu; cont ERP nou
   dupa 19a = revenire refuzata.
4. **Nerulate de mine:** PostgreSQL (harness PG16/17), concurenta, Auth real. Rulate: `test_static.py` 5/5,
   `test_static_1b.py` 7/7, `test_static_r2.py` 2/2, validatorul de livrare pe 18a / 19a / revenirea 18a, `bash -n`.
5. **Inainte de DRY:** chat-ul ruleaza `inventar_prod_e1.sql`; listele public / net / ERP se completeaza din rezultat
   (lista ERP cu „da”-ul lui Razvan); harness-ul PG16 trebuie sa dea PASS pe artefactul completat.

| Regula | Dovada r3 |
|---|---|
| L01 | n/a pentru delta (fara RPC nou); ordinea lock-urilor 18a/19a neschimbata. |
| L02 | Inventarul si postconditia ERP in aceeasi tranzactie a runnerului; tabelul temporar ON COMMIT DROP. |
| L05 | Neschimbat: HOLD-urile harness-ului cer cod 10 (NEAPLICAT confirmat) si zero obiecte ramase. |
| L07 | Clasificarea `erp` numai server-side, la apply sau prin `fn_cont_aproba_erp`; teste 1a `linked account approved`. |
| L08 | Identitatea aprobata = hash pe id din lista revizuita, nu din metadate client; aprobarea ulterioara ramane auth.uid() owner. |
| L12 | Toate conturile primesc un tip (erp / teren / neaprobat); hash-urile fara cont = refuz, nu se ignora tacit. |
| L13 | `^[0-9a-f]{64}$` ancorat; generatorul de fixture refuza marcaje lipsa / duble, UUID invalid, amprente incomplete. |
| L14 | Refuz atomic dovedit in harness pentru fiecare abatere; revenirea 1b refuza datele portalului / rolurile noi, nu editarile HR. |
| L15 | Lista alba explicita cu callee-uri tranzitive; enumerare din catalog (semnatura canonica), fara regex pe SQL. |
| L16 | Lista ERP fara duplicate (cardinality = count DISTINCT). |
| L18 | Lista goala / `'{}'` = refuz; comparatii IS DISTINCT FROM; semnatura absenta inregistrata ca absenta. |
| L20 | Cai legitime testate: owner aprobat, aprobarea contului legat, schimbare fara legatura acceptata. |
| L25 | Fixture cu FK / CHECK reale si apeluri ca supabase_auth_admin / authenticated; testele SQL sunt scrise, nerulate de mine. |
| L03, L04, L06, L09–L11, L17, L19, L21–L24 | n/a pentru delta r3. |

## E1-1a/1b r4 — 09.11.2026 (Jakarinos r3: NO-GO, P1 2, P2 1)
1. **Inventarul ERP:** `= ANY((SELECT lista ...))` era forma ANY(subinterogare) (text = text[]), deci calea pozitiva
   ar fi picat la apply. Acum `EXISTS (... WHERE hash = ANY(a.lista))`; harness-ul verifica `erp:1,neaprobat:2,teren:3`.
2. **Lista alba 1b:** se adauga callee-urile tranzitive ale triggerelor de pe profiles (fn_profiles_protectie_legatura
   -> fn_identitate_privilegiata -> fn_identitate_claims, fn_identitate_eticheta, fn_profiles_campuri_owner_only,
   prevent_role_escalation, enforce_owner_only_salary_flags, protect_can_access_pontaj_brut). Fixture: lant sintetic pe
   3 niveluri; teste: helper de nivel 2 / 3 schimbat = poarta rosie si revenire refuzata. Test static de paritate
   triggere-profiles-din-migrari -> lista alba. Triggerele create doar pe prod se confirma cu sectiunea 8 a inventarului.
3. **Inventarul read-only:** ORDER BY pe expresie, nu pe pozitie cu COLLATE; sectiunea 7 (structura concediului,
   fara date) si sectiunea 8 (triggerele / definitiile de pe calea portalului).
4. Verificari: statice 15/15, validatorul de livrare, `bash -n`, parserul PostgreSQL 17 + PL/pgSQL pe toate fisierele
   E1 si pe fragmentele SQL din harness. Harness-ul PG ramane la operator.

## E1-1b r5 — 09.11.2026 (Jakarinos r4: P0 0, P1 0, P2 1)
- Amprenta 1b include configuratia `pg_sequence` a secventelor din lista alba (fara contor). Teste: incrementul schimbat
  = poarta rosie si revenire refuzata; `nextval` = poarta verde.

## E1-1a/1b r6–r7 — 10.11.2026
- r6: listele din inventarul read-only pe prod (10.11): net (12, sesiunea de chat), ERP (27 de hash-uri, confirmate de
  owner); lista public verificata identica. Jakarinos r6: NO-GO (P1 1, P2 1), ambele despre ce se invata la apply.
- r7, P1: callee-urile EXTERNE din lista alba 1b si triggerele de pe auth.users / profiles / notifications (cu functiile
  lor) se compara cu ancorele revizuite din prod (`scripts/portal/ancore_1b.sql` = sectiunea 9 a inventarului) inainte de
  apply si inca o data la final; ancore goale sau diferite = refuz atomic. Fixture: notifications + triggerul de rutare.
  Harness: functia triggerului de pe notifications schimbata / trigger de pe profiles dezactivat inainte de apply = refuz.
- r7, P2: owner-ul functiilor net (supabase_admin) verificat inainte de baseline; harness: owner schimbat = refuz.
- Ancorele de productie se completeaza din sectiunea 9 (o rulare read-only); pana atunci 19a refuza atomic.

## E1-1b r8 — 11.11.2026 (ancorele de productie)
- `origin/main` adus prin merge (fara conflicte). Migrarile intrate intre timp (20261131f/g, 20261202a–20261208b,
  20261211a) si cele din PR-urile deschise (20261209a, 20261132a, 20261131e) nu ating `handle_new_user`, triggerele de
  pe auth.users / profiles / notifications sau functiile ancorate; nu lasa functii noi executabile de PUBLIC (ar schimba
  setul de 21 din 18a). Numele 18a / 19a nu se ciocnesc cu nimic de pe origin; versiunea se da explicit la livrare.
- 19a, marcajul `PORTAL_1B_ANCORE`: valoarea rulata read-only pe prod de sesiunea de chat (`ancore_1b.sql` la
  c0e22df7, 11.11.2026): 16 functii (cele 10 numite + 6 ale triggerelor, fara handle_new_user) si 7 triggere active.
- `test_static_1b.py`: pentru ancore completate verifica si completitudinea (functii = cele 10 numite + functiile
  triggerelor, fiecare trigger activ cu md5 si functie, fiecare functie cu md5 / owner / DEFINER / config / ACL).
- Harness: artefactul original refuza in continuare pe clusterul efemer (`PORTAL_1B_ANCHOR_CHANGED`), copia de test
  primeste ancorele clusterului (`prepare_fixture_1b.py`), deci comanda si asteptarile raman aceleasi.

| Regula | Dovada r8 |
|---|---|
| L12 | Setul de ancore e complet fata de interogare (test static nou); lipsa / diferenta = refuz. |
| L14 | Neschimbat: refuz atomic inainte de orice obiect, verificare repetata la final; revenirea neatinsa. |
| L15 | Ancore din catalogul prod (md5 corp, owner, DEFINER, config, ACL; triggere: activare, md5 definitie, functie). |
| L18 | Valoare goala tot refuz (`= '{}'`), comparatie `IS DISTINCT FROM`. |
| L19 | O singura interogare in `ancore_1b.sql`, 19a si inventar (paritate testata). |
| L25 | Harness-ul PG17 si testele SQL raman la operator; Auth real = testul B1 pe proiect separat. |
| L01–L11, L13, L16, L17, L20–L24 | n/a pentru delta r8 (fara cod nou in afara literalului si a testului). |

## E1-1a/1b r9 — 11.11.2026 (bugetul de lock la aplicare; al doilea recenzent r8: NO-GO, P1 1, P2 3)
- **P1-01 disponibilitate.** Toate patru fisierele (18a, 19a, revenirile) au `SET LOCAL lock_timeout = '3s'` si
  `statement_timeout = '15s'`. Lock-urile pe tabelele folosite de utilizatori se iau O SINGURA DATA, in blocul `$locks$`:
  `LOCK ... NOWAIT` intr-o subtranzactie, reincercat la 50 ms, cel mult 3 s. Cat timp incearca, aplicarea nu sta in
  coada lock-ului, deci citirile ERP si login-urile nu se aseaza in spatele ei (cauza principala a blocajelor DDL);
  o incercare ratata elibereaza tot ce luase. Peste buget: `55P03 PORTAL_LOCK_BUDGET`, tranzactia se anuleaza, runnerul
  da 10 (NEAPLICAT confirmat). La aplicare, tot ce citeste doar catalogul (ancore, lista alba, functii, tabele noi)
  ruleaza INAINTE de `$locks$`; dupa el raman doar pasii care chiar cer lock-ul.
- **P2-01.** Dupa 19a, `handle_new_user` scrie pentru orice cont nou si randul `conturi_tip` = `neaprobat`
  (`sursa = cont_nou_e1_1b`), in aceeasi tranzactie cu profilul `in_asteptare`: inventarul Auth ramane complet, poarta
  nu mai raporteaza `inventar identitati`, hook-ul il refuza pana la `fn_cont_aproba_erp` (care accepta deja randul
  `neaprobat`). Test: `portal_e1_1b.test.sql` (un rand, fara autor, auditat; poarta verde).
- **P2-02.** Fiecare fisier de revenire spune in antet cand refuza si care e procedura de urgenta; detaliile in
  `E1_REVENIRE_AUTH.md` (sectiunea r9). Stub-ul `fn_auth_token_hook` ramas dupa revenirea 18a e pastrat intentionat
  (motivul in antetul revenirii 18a); se sterge doar printr-o migrare separata, dupa confirmarea dezactivarii hook-ului.
- **P2-03.** `$priv$` inaintea oricarei schimbari, cu mesaj `PORTAL_PRIVILEGES_MISSING: <lista>`: CREATEROLE si o proba
  EFECTIVA (CREATE ROLE + GRANT catre authenticator + REVOKE + DROP pe un rol de proba, intr-o subtranzactie anulata
  intentionat); REFERENCES pe auth.users / employees, TRIGGER pe employees, proprietar pe profiles si pe functiile
  inlocuite, dreptul de LOCK (UPDATE / DELETE / TRUNCATE / MAINTAIN), cate unul pe rand. Revenirea 18a cere si ADMIN pe
  `teren` (REVOKE din authenticator + DROP ROLE).
- **Adresele conturilor teren** (decizia lui Razvan, 11.11): 18a identifica cele 3 conturi teren existente prin
  sha256 pe `auth.users.id::text` (ca lista ERP), cu fisa 55 / 70 / fara fisa. Fixture-ul de test foloseste ID-uri si
  adrese sintetice (`e1000000-...`, `teren.fixture.*@teren.gazpet.ro`), iar `prepare_fixture.py --teren` pune
  hash-urile lor in copia de harness. Adresele raman in commit-urile vechi ale branch-ului si in `PLAN_ETAPA1.md` de pe
  main pana la merge (aici scoase); istoricul nu se rescrie (fara force-push).

### Lock-urile, pe fiecare fisier (masurate in harness: `scripts/portal/concurrency_lock.sh`)
Durata = de la `$locks$` pana la commit. Estimarile sunt pentru prod (~150 de conturi, ~150 de profiluri); harness-ul
masoara asteptarea maxima a unui trafic concurent real si o compara cu plafonul de 3 s.

| Fisier | Tabel | Nivel | De ce | Cat tine | Ce blocheaza pentru utilizatori |
|---|---|---|---|---|---|
| 18a | auth.users | SHARE ROW EXCLUSIVE | cerut de FK-urile conturi_* -> auth.users; setul de conturi fix pana la clasificare | coada 18a, estimat < 1 s | scrierile Auth: actualizarea la login, conturi noi, ban. Citirile NU. |
| 18a | employees | SHARE ROW EXCLUSIVE | cerut de FK-ul conturi_teren -> employees | idem | editarile HR. Citirile NU. |
| 18a | profiles | SHARE | legatura fisa / is_owner neschimbata intre verificare si clasificare | idem | scrierile in profiles (Admin, conturi noi). Citirile NU. |
| 18a | user_module_access | — (r8: SHARE) | 18a nu-l citeste | — | nimic |
| 19a | conturi_teren / conturi_tip, jurnal | ACCESS EXCLUSIVE / SHARE | coloane noi / fara scrieri concurente | tot 19a | nimic (le foloseste doar hook-ul, care nu e pornit) |
| 19a | auth.users | SHARE ROW EXCLUSIVE | FK portal_provisioning -> auth.users; handle_new_user inlocuit fara conturi noi in zbor | coada 19a, estimat < 1 s | scrierile Auth. Citirile NU. |
| 19a | employees | SHARE ROW EXCLUSIVE (r8: ACCESS EXCLUSIVE) | FK + triggerul de revocare | idem | editarile HR. Citirile NU. |
| 19a | profiles | ACCESS EXCLUSIVE | cerut de ALTER ... CHECK (rolurile teren / in_asteptare) | idem (r8: tot 19a) | TOT pe profiles, inclusiv citirile ERP, doar pe coada |
| 19a | user_module_access | SHARE (r8: ACCESS EXCLUSIVE) | drepturile conturilor teren fixe intre poarta si amprenta | idem | scrierile. Citirile NU. |
| revenire 19a | auth.users, employees, profiles | ACCESS EXCLUSIVE | cerut de DROP FK / DROP TRIGGER / ALTER CHECK; luat INAINTEA verificarii (L14) | toata revenirea, estimat < 1 s | tot pe cele trei tabele (login, citiri ERP) |
| revenire 19a | user_module_access | SHARE | stabilitate pentru verificare | idem | scrierile |
| revenire 18a | auth.users, employees | ACCESS EXCLUSIVE | cerut de DROP-ul FK-urilor conturi_*; inaintea verificarii (L14) | toata revenirea, estimat < 1 s | tot pe cele doua tabele (login, citiri HR) |

Probele din harness (PG17, sesiuni reale):
- `lock_observe` (18a, 19a, revenire 19a, revenire 18a): tranzactia completa, oprita intr-o pauza inainte de commit;
  modurile din `pg_locks` si 8 probe de utilizator (citire / scriere pe cele 4 tabele, `lock_timeout` 200 ms) trebuie sa
  fie exact cele din tabel; pauza se anuleaza, nu ramane nimic.
- `lock_budget_refusal` (18a cu o scriere lunga pe auth.users, 19a cu o citire lunga pe profiles): runnerul refuza cu
  `PORTAL_LOCK_BUDGET` si cod 10 in ~3 s, fara obiecte ramase; CAT TIMP incearca, citirile si scrierile pe auth.users /
  employees / profiles trec (aplicarea nu blocheaza pe nimeni cat asteapta).
- `traffic_start/stop` (aplicarea reala 18a si 19a): trafic continuu (citiri / scrieri profiles si employees, login
  simulat = UPDATE pe auth.users); nicio eroare, asteptarea maxima <= 3000 ms (`PORTAL_BUDGET_MS`), afisata in log.
- Negativ: CREATEROLE lipsa si REFERENCES pe auth.users lipsa = `PORTAL_PRIVILEGES_MISSING`, nimic creat; hash-urile
  teren de productie pe fixture = `PORTAL_TERRAIN_INVENTORY_CHANGED`; revenirea 18a cu un cont nou = refuz.

Verificat de Rocky (fara harness, care ramane la chat): build, vitest, parserul PostgreSQL (libpg-query 17) si un test de
fum semantic pe PGlite (PostgreSQL 18, o singura sesiune, rol NOSUPERUSER): 18a -> teste 1a -> 19a -> teste 1b ->
cont nou -> revenire 19a refuzata cu cont nou -> revenire + re-aplicare 19a in aceeasi tranzactie -> revenire 19a ->
revenire 18a (fara atestare / cu cont nou = refuz) -> revenire 18a; plus refuzurile de drepturi. Concurenta reala
(NOWAIT, 55P03, trafic) nu se poate proba intr-o singura sesiune: o dovedeste doar harness-ul PG17.

| Regula | Dovada r9 |
|---|---|
| L01 / L06 | Ordinea lock-urilor scrisa in fiecare fisier (auth.users -> employees -> profiles -> user_module_access); NOWAIT = aplicarea nu asteapta niciodata tinand un lock pe tabelele utilizatorilor, deci nu poate intra in deadlock cu traficul. |
| L08 | Neschimbat (handle_new_user: autorul clasificarii noi e NULL, nu un parametru). |
| L12 / L18 | `$priv$` aduna toate lipsurile, nu se opreste tacit; lista teren: exact 3 hash-uri distincte, altfel refuz. |
| L14 | O tranzactie; revenirile iau lock-urile INAINTEA verificarii „fara date noi”; apply -> revenire -> re-apply testat (harness + PGlite). |
| L15 | Amprentele / ancorele neschimbate; FK-urile 19a adaugate la final cu numele generate in r8 (aceeasi definitie). |
| L20 | Cai legitime testate: trafic concurent fara erori, aplicarea trece cu lock-urile libere. |
| L25 | Doua sesiuni reale + bariere (fisier / pg_stat_activity), motivul exact (`PORTAL_LOCK_BUDGET`, cod 10), PG17 NOSUPERUSER. |
| L02–L05, L07, L09–L11, L13, L16, L17, L19, L21–L24 | n/a pentru delta r9. |

## E1-1a/1b r10 — 11.11.2026 (plafon pe durata sectiunii critice; ambii recenzenti r9: NO-GO pe aceeasi tema)

Problema (al doilea recenzent r9 P1-01): bugetul de 3 s plafona doar ASTEPTAREA lock-urilor; odata obtinute, ele se tin
pana la COMMIT. Jakarinos r9 P2: 19a lua ACCESS SHARE implicit pe tabelele utilizatorilor inainte de `$locks$` (crearea
functiilor `LANGUAGE sql` le analizeaza corpul), iar verificatorul static nu prindea un `SELECT` pus acolo; bariera din
`lock_observe` putea expira cu COMMIT.

### Ce s-a schimbat (aceeasi forma in toate cele 4 fisiere)
1. **Timeout-urile sunt primele instructiuni** (`lock_timeout` 3 s, `statement_timeout` 15 s), inaintea lock-ului
   consultativ; acesta se ia cu `pg_try_advisory_xact_lock` + refuz `PORTAL_DELIVERY_BUSY` (runnerul il tine deja din
   `1_pre`, reintrant; acolo nu tine nimic al utilizatorilor, doar alte livrari il pot astepta). PostgreSQL 17 cerut.
2. **Inainte de `$locks$` nu se atinge niciun tabel existent.** 18a creeaza tabelele `conturi_*` fara FK; 19a are
   `fn_portal_angajat_eligibil` si `fn_portal_1b_snapshot` in plpgsql (corpul nu se analizeaza la creare), inlocuieste
   `handle_new_user` / `fn_teren_eligibil` tot inainte (vizibile altor sesiuni abia la COMMIT, atomic cu CHECK-ul nou),
   iar lock-urile pe `conturi_*` (cascada unei stergeri din auth.users) s-au mutat in `$locks$`. Dovada: `pg_locks` al
   sesiunii dupa prefix = gol (PGlite pe toate 4 fisierele; harness: `lock_pre_observe`); controlul negativ pe 19a r9
   arata exact ce a gasit Jakarinos (ACCESS SHARE pe auth.users, employees, profiles, user_module_access, conturi_*).
3. **Dupa `$locks$` ramane O SINGURA instructiune (`$critic$`)**: FK-urile pe tabelele noi goale, re-verificarea
   premiselor pe date, scrierile, poarta, amprenta (18a); coloanele `conturi_teren`, CHECK-ul (un singur ALTER DROP + ADD),
   FK-urile, triggerul de revocare, reconcilierea, poarta, amprenta (19a); verificarea „fara date noi” + restaurarea +
   stergerile (reveniri). Un singur drum dus-intors client-server in loc de ~20.
4. **Plafonul**: la obtinerea lock-urilor, `$locks$` seteaza `statement_timeout` 2 s (pentru `$critic$`) si porneste
   `transaction_timeout` = 2 s de la zero (intai 0, ca un plafon mai mare mostenit de la rol / baza sa nu ramana activ).
   **[Formulare GRESITA in r10, corectata in r11 — vezi sectiunea r11: COMMIT-ul propriu-zis NU e plafonat.]**
   Serverul termina sesiunea daca tranzactia nu a ajuns la COMMIT in 2 s de la obtinerea lock-urilor — oricate
   instructiuni, oricat dureaza fiecare, oricat asteapta clientul sau reteaua intre ele (inclusiv inregistrarea
   runnerului). Terminarea = ROLLBACK, toate lock-urile eliberate, runnerul raporteaza NEAPLICAT (cod 10).
   `statement_timeout` singur NU ar fi ajuns: nu acopera pauzele dintre instructiuni.
5. **Fereastra 18a -> 19a (P2-01)**: in `$critic$`, sub SHARE ROW EXCLUSIVE pe auth.users (niciun cont nou pana la
   COMMIT), 19a clasifica `neaprobat` (sursa `reconciliere_e1_1b`) orice cont fara rand in `conturi_tip` (creat cu
   handle_new_user vechi intre livrari; rolul din profil ramane cel vechi, ca la conturile nelistate din 18a). Un cont
   teren (domeniu sau `tip_cont`) aparut intre livrari = refuz `PORTAL_1B_TERRAIN_UNCLASSIFIED` (nu avea o cale legitima).
   Am ales reconcilierea, nu o singura tranzactie: runnerul livreaza si inregistreaza un fisier pe tranzactie (istoricul
   pe nume + sha256), iar combinarea ar cere schimbarea runnerului, revizuit separat. Revenirea 18a refuza oricum dupa
   orice cont nou (neschimbat).
6. **Revenirile**: aceleasi reguli (punctele 1–4).

### Lock-urile si cat tin (r10)
Fereastra = de la primul lock tinut pe tabelele utilizatorilor pana la eliberarea lor (dupa COMMIT); plafonul de 2 s
acopera tot pana la INTRAREA in COMMIT, in toate fisierele; COMMIT-ul adauga durata scrierii lui (r11). „Cel mult 2 s”
din tabel = „cel mult 2 s pana la intrarea in COMMIT + COMMIT-ul (de regula milisecunde)”.

| Fisier | Tabel | Nivel | Instructiunea care il cere | Ce blocheaza |
|---|---|---|---|---|
| 18a | auth.users / employees | SHARE ROW EXCLUSIVE | `ADD CONSTRAINT ... FOREIGN KEY` (conturi_tip, conturi_teren) | scrierile Auth (login, conturi noi) / editarile HR; citirile NU |
| 18a | profiles | SHARE | stabilitatea legaturii fisa / is_owner intre verificare si clasificare | scrierile in profiles; citirile NU |
| 19a | auth.users / employees | SHARE ROW EXCLUSIVE | FK-urile portal_provisioning; `CREATE TRIGGER` pe employees | scrierile Auth / HR; citirile NU |
| 19a | profiles | ACCESS EXCLUSIVE | `ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_chk, ADD CONSTRAINT profiles_role_chk CHECK (...)` | tot, inclusiv citirile ERP, cel mult 2 s |
| 19a | user_module_access | SHARE | amprenta drepturilor conturilor teren (revenirea compara exact) | scrierile; citirile NU |
| revenire 19a | auth.users, employees, profiles | ACCESS EXCLUSIVE | `DROP TABLE portal_provisioning` (FK-uri), `DROP TRIGGER` pe employees, ALTER CHECK | tot, cel mult 2 s |
| revenire 18a | auth.users, employees | ACCESS EXCLUSIVE | `DROP TABLE conturi_tip / conturi_teren` (FK-uri) | tot, cel mult 2 s |

De ce nu se poate mai putin pe profiles: in PostgreSQL, `DROP CONSTRAINT` si `ADD CONSTRAINT ... CHECK` (si varianta
`NOT VALID`) cer ACCESS EXCLUSIVE; doar FK-ul (SHARE ROW EXCLUSIVE) si `VALIDATE CONSTRAINT` (SHARE UPDATE EXCLUSIVE) au
niveluri mai mici. Stergerea unui FK sau a unui trigger (reveniri) cere ACCESS EXCLUSIVE pe tabelul referit. Singura
alternativa ar fi renuntarea la rolurile noi in CHECK (schimbare de design, nu de livrare).

### Masurat
- PGlite (wasm, PG18, o sesiune), volum ~2x productia (406 conturi / profiluri, 403 angajati, 1.603 drepturi, 606 tabele
  x 20 de coloane, 1.528 de functii in public): sectiunea critica (`$critic$` + COMMIT) **18a 75 ms, 19a 46 ms, revenire
  19a 70 ms, revenire 18a 35 ms** (wasm e mai lent decat serverul real).
- Estimare pe productie (~150 de conturi, ~200 de profiluri / angajati): lucrul pe server sub 0,1 s + 5 drumuri
  dus-intors dupa lock (`$critic$`, cele 3 instructiuni ale runnerului, COMMIT) x latenta pooler-ului (zeci de ms) =
  **sub 0,3 s**, fata de plafonul de 2 s; peste plafon = ROLLBACK automat, nu blocare mai lunga.
- Harness PG17 (de rulat de chat), praguri care pica testul: `masurat` pe aplicarea / revenirea reala, pe fixture si pe
  un cluster nou cu volum (`supabase/tests/portal_e1_volum.sql`): fereastra <= 1000 ms (`PORTAL_FEREASTRA_MS`) si
  asteptarea maxima a traficului (citiri / scrieri profiles, employees, login simulat) <= 1000 ms (`PORTAL_BLOCARE_MS`);
  `lock_cap_refusal`: 19a completa, clientul sta 3 s intre instructiuni cu lock-urile tinute => sesiunea inchisa de
  `transaction_timeout`, fereastra ~2 s (<= 2,5 s), nimic ramas; `lock_pre_observe` pe toate 4 fisierele;
  `lock_budget_refusal` cu 10 esantioane `pg_locks` (niciun lock tinut continuu in timpul reincercarilor);
  `lock_observe` cu bariera care nu se poate incheia cu succes (expirata = `PORTAL_BARIERA_EXPIRATA` => ROLLBACK, starea
  verificata dupa). Harness-ul cere acum PG17 (PG16 nu are `transaction_timeout`).
- Static (`scripts/portal/buget_lock.py`, folosit de `test_static.py` / `test_static_1b.py`): pe langa r9 — timeout-urile
  primele, doar `pg_try_advisory_xact_lock`, PG17, plafonul dupa bucla, exact o instructiune dupa `$locks$`, si niciun
  lock implicit pe tabele existente inainte de `$locks$` (referinte in cod executat, corpuri de functii non-plpgsql,
  apeluri ale functiilor portalului care citesc astfel de tabele, `EXECUTE` dinamic intr-un DO). 36 de mutanti respinsi
  (inclusiv cel al lui Jakarinos, `SELECT count(*) FROM public.profiles` inainte de `$locks$`) si 3 martori acceptati
  (corp plpgsql, literal, comentariu). Portul node al acestor teste: OK.

| Regula | Dovada r10 |
|---|---|
| L01 / L06 | Ordinea in `$locks$`: auth.users -> employees -> profiles -> user_module_access -> conturi_* (ca stergerea unui cont, in cascada); NOWAIT; inainte de `$locks$` niciun lock pe tabele existente (static + `pg_locks`). |
| L02 | Coada fiecarui fisier = o singura instructiune `$critic$`, totul sau nimic. |
| L12 / L18 | Reconcilierea numara si raporteaza conturile (`PORTAL_1B_RECONCILIATE: n`); cont teren neclasificat = refuz explicit, nu clasificare tacita. |
| L14 | O tranzactie; revenirile: lock inaintea verificarii, verificarea inaintea restaurarii, in `$critic$`; apply -> revenire -> re-apply (PGlite + harness). |
| L15 | Amprentele / ancorele neschimbate; FK-urile 18a cu numele generate in r9 (aceeasi definitie in catalog); snapshot-ul 1b neschimbat ca continut (doar plpgsql). |
| L20 | Cai legitime: trafic concurent fara erori pe aplicari SI reveniri; contul obisnuit aparut intre livrari trece (neaprobat). |
| L25 | Sesiuni reale + bariere care nu pot face COMMIT, fereastra masurata de alta sesiune, prag care pica testul, plafon dovedit cu sesiune inchisa de server, volum pe cluster nou, PG17 NOSUPERUSER. |
| L03–L05, L07–L11, L13, L16, L17, L19, L21–L24 | n/a pentru delta r10. |

## E1-1a/1b r11 — 11.11.2026 (garantia de timp formulata exact si dovedita pe toate cele 4 fluxuri)

Ambii recenzenti r10: NO-GO doar pe garantia de timp. Jakarinos P2: PG17 dezactiveaza `transaction_timeout` la intrarea
in COMMIT (xact.c REL_17_STABLE, inainte de `RecordTransactionCommit()`), cand lock-urile sunt inca tinute => un COMMIT
intarziat (flush WAL, replicare sincrona) poate depasi 2 s fara rollback; formularea r10 („pana la COMMIT, inclusiv
COMMIT-ul”) era deci gresita. Al doilea recenzent P1-01: nu era DEMONSTRAT ca ceasul setat in tranzactia deja inceputa
porneste de la setare si acopera pauza clientului dintre `$locks$` si `$critic$`; proba exista doar pentru 19a si nu
fusese rulata.

### Garantia, formulata exact (aceeasi in 18a, 19a, revenirea 19a, revenirea 18a)
> **[INFIRMAT in r12]** Primul punct de mai jos („ceasul pornit la lock-uri”) e FALS cand tranzactia are deja un
> `transaction_timeout` pornit: harness-ul PG17 real (proba `mostenit`) a aratat lock-uri tinute 3,7 s si tranzactia
> ajunsa la COMMIT. Garantia valabila e cea din sectiunea r12. Punctul „Ce NU plafoneaza” (COMMIT-ul) ramane valabil.

- **Ce plafoneaza ceasul.** `$locks$`, imediat dupa obtinerea lock-urilor, seteaza `transaction_timeout` intai pe 0
  (opreste un ceas mostenit de la rol / baza / inceputul tranzactiei), apoi pe 2 s: PG17 porneste ceasul in acel moment
  daca nu e deja pornit (de aici cele doua setari). De acolo PANA LA INTRAREA IN COMMIT trec cel mult 2 s: instructiunea
  `$critic$`, inregistrarea runnerului, orice pauza a clientului sau a retelei intre instructiuni (inclusiv intre
  `$locks$` si `$critic$`). Peste 2 s serverul termina sesiunea (FATAL, si cand e activa, si cand asteapta clientul) =>
  ROLLBACK, toate lock-urile eliberate, nimic schimbat, runnerul raporteaza NEAPLICAT.
- **Ce NU plafoneaza.** COMMIT-ul propriu-zis. PG17 opreste `transaction_timeout` la intrarea in COMMIT, iar
  `statement_timeout` e oprit inainte de commit; lock-urile se elibereaza abia dupa scrierea commit-ului. COMMIT-ul
  adauga deci: constrangerile amanate (niciuna: fara `DEFERRABLE` in cele 4 fisiere), scrierea + flush-ul WAL (de regula
  milisecunde) si, NUMAI daca serverul are replicare sincrona configurata, asteptarea standby-ului — nelimitata de niciun
  timeout (proba `lock_commit_lent` o arata). Daca productia nu are replicare sincrona, COMMIT-ul = flush WAL local;
  de confirmat pe instanta reala in DRY (chat-ul): `SHOW synchronous_standby_names` (asteptat gol) si `synchronous_commit`.
- **Pe scurt:** sectiunea critica e plafonata la 2 s pana la intrarea in COMMIT; COMMIT-ul adauga durata scrierii WAL,
  de regula milisecunde. Nu promitem „maximum 2 s” pe toata durata lock-urilor.

### DECIZIE pentru Razvan (de scris „da” / „nu” inainte de aplicare)
1. **Acceptarea limitei:** la aplicare si la reveniri, lock-urile pe tabelele utilizatorilor tin cel mult 2 s pana la
   intrarea in COMMIT + durata COMMIT-ului (de regula milisecunde). Pe 19a si pe reveniri asta inseamna ca, in acest
   interval, loginurile si (pe profiles / la reveniri) citirile ERP asteapta. Daca serverul ar avea replicare sincrona si
   standby-ul ar fi blocat, COMMIT-ul ar putea tine mai mult; nu exista mecanism PostgreSQL care sa-l anuleze (o
   anulare in timpul asteptarii doar o opreste, tranzactia ramane comisa local).
2. **Fereastra de aplicare:** in afara orelor de lucru (seara tarziu / dimineata devreme, cand aproape nimeni nu e
   logat), cu chat-ul urmarind runnerul; inainte, in DRY pe clona: `SHOW synchronous_standby_names` (asteptat gol) si
   timpii reali (estimare: sub 0,3 s de la primul lock la eliberare).

### Ce s-a schimbat in r11
1. **Formularea** in cele 4 fisiere SQL (antet + blocul `$locks$`, textul `PORTAL_LOCKS ... pana la intrarea in COMMIT`),
   in acest raport si in `E1_REVENIRE_AUTH.md`. Logica SQL neschimbata (aceleasi instructiuni, aceleasi lock-uri).
2. **`lock_cap_refusal` pe TOATE cele 4 fluxuri** (18a, 19a, revenire 19a, revenire 18a), in 3 moduri, cu sesiuni reale:
   - `critic`: clientul sta 3 s INTRE `$locks$` si `$critic$` (fara nicio instructiune; sesiunea „idle in transaction”);
   - `commit`: clientul sta 3 s DUPA `$critic$`, inainte de COMMIT;
   - `mostenit`: un `transaction_timeout` de 10 s pornit la inceputul tranzactiei + 3 s de lucru pe server INAINTE de
     `$locks$` + pauza de 3 s dupa `$critic$`. Arata semantica reala: daca ceasul ar porni la inceputul tranzactiei,
     sesiunea ar muri inainte de lock-uri (fara fereastra => test picat); daca ceasul mostenit ar ramane activ, ar muri
     la 10 s (fereastra ~6 s => test picat). Asteptat: inchidere la ~2 s de la lock-uri si ~5 s de la inceput.
   Pentru fiecare: sesiunea inchisa de server (o linie noua `terminating connection due to transaction timeout` in
   jurnalul serverului), fereastra de lock masurata din ALTA sesiune intre 1,9 s si 2,5 s, pauza clientului incepuse
   dupa lock-uri si inainte de inchidere (ceasul serverului), sesiunea disparuta, cele 8 probe de utilizator libere,
   starea neschimbata, traficul concurent asteapta <= 2,5 s. Daca sesiunea NU ar fi inchisa, clientul trimite o eroare
   explicita (`PORTAL_PLAFON_NEDECLANSAT`) => ROLLBACK, testul pica (nu se comite nimic din greseala).
3. **`lock_commit_lent` (proba optionala, pastrata fiindca e simpla si sigura):** pe un cluster efemer nou dedicat,
   autovacuum oprit, `synchronous_standby_names` spre un standby inexistent (confirmat: o tranzactie de proba asteapta
   SyncRep). 18a ruleaza complet si intra in COMMIT; dupa 3 s sesiunea e tot in COMMIT (SyncRep), cu lock-urile 18a,
   fara `transaction timeout`; la eliberarea asteptarii tranzactia se COMITE (starea = aplicat). Fereastra masurata > 3 s.
   Deci limita e reala si exact cea descrisa mai sus.
4. **Rulare fara WSL:** `scripts/portal/harness_win.sh` = harness-ul din Git Bash cu binarele Windows PostgreSQL 17
   (`PORTAL_PG_BIN`), fara `su` / `chown`, copie LF noua in `<PORTAL_TMP_BAZA>/tmp_portal_<slot>_XXXXXXXX` (ambele cai
   obligatorii, fara valori implicite), cluster efemer pe 127.0.0.1:6700+slot (verificat liber cu `pg_isready`; alte
   baze locale nu sunt atinse), fara socket unix, locale builtin C.UTF-8. Ca sa mearga pe
   Windows, harness-ul nu mai foloseste meta-comenzi psql (`\!` ruleaza in cmd.exe) si nici FIFO: pauzele / barierele
   clientului sunt SQL trimis pe stdin, dupa ce serverul a terminat partea 1 (`pg_stat_activity`: „idle in transaction”
   cu marcajul ca ultima instructiune) — la fel in `lock_budget_refusal` si in cursa din `concurrency_1b.sh`.
   Adaptoarele `psql` / `pg_dump` scot CR-ul din iesirea Windows. Linux / WSL: neschimbat (`harness_wsl.sh`).

### Dovezi (de rulat de chat; la mine `psql` / binarele PG si `bash -n` cer aprobare)
- `PORTAL_PG_BIN=<binare PG17> PORTAL_TMP_BAZA=<dosar de lucru> bash scripts/portal/harness_win.sh 3 60` (Git Bash,
  din worktree). In log: `LOCK_CAP 18a|19a|rev19a|rev18a
  critic|commit|mostenit` (12 linii), `LOCK_COMMIT_LENT 18a`, restul probelor r10, ultima `PASS ... r11 ...` cu `cod=0`.
- Sau WSL cu PG17: `harness_wsl.sh` (neschimbat), aceleasi linii.

| Regula | Dovada r11 |
|---|---|
| L01 / L06 | Neschimbate (ordinea si NOWAIT din r10); probele ruleaza pe fisierele reale, nu pe copii simplificate. |
| L02 | Coada = `$critic$`; in modul `critic` partea 2 incepe exact cu `$critic$` (verificat: un singur `$locks$` in partea 1, `$critic$` doar in partea 2). |
| L14 | O tranzactie; ROLLBACK la inchidere verificat prin starea dinainte, pe aplicari si pe reveniri. |
| L18 | Inchiderea se dovedeste pozitiv (linie noua in jurnalul serverului + fereastra masurata), nu din lipsa unei erori; marcaj neatins / plafon nedeclansat = eroare explicita. |
| L20 | Traficul legitim concurent (citiri / scrieri, login simulat) masurat in toate cele 12 probe, prag care pica testul. |
| L25 | Sesiuni reale + bariera pe stdin dupa starea serverului (fara sleep orb), timpi pe ceasul serverului, a doua sesiune pentru eliberare, praguri care pica testul, PG17 NOSUPERUSER, comportamentul real aratat (modul `mostenit`, COMMIT intarziat), nu presupus. |
| L03–L05, L07–L13, L15–L17, L19, L21–L24 | n/a pentru delta r11 (doar comentarii SQL + harness). |

## E1-1a/1b r12 — 11.11.2026 (harness-ul PG17 real a infirmat plafonul r11 in varianta „mostenit”)

Chat-ul a rulat harness-ul pe PostgreSQL 17.11 (WSL). r10: toate probele de lock trec pe cele 4 fluxuri, apoi
`volum: fixture incomplet`. r11: `LOCK_CAP 18a critic` si `commit` trec (sesiune inchisa la 2001 ms de la lock-uri,
2031 ms de la BEGIN), apoi **`fereastra cap_18a_mostenit: lock-uri tinute 3729 ms > 2500 ms`**: cu un
`transaction_timeout` de 10 s deja pornit, `set_config` 0 apoi 2 s dupa lock-uri NU a dat 2 s; nimic nu a inchis
sesiunea pana la eroarea trimisa intentionat de client. Garantia r11 („cel mult 2 s de la lock-uri pana la intrarea in
COMMIT”) era deci FALSA in acest caz. In cazurile critic / commit iesise bine doar pentru ca BEGIN-ul si lock-urile
erau aproape simultane.

### 1. Semantica `transaction_timeout` in PG17, cand e schimbat in mijlocul tranzactiei
- **Ce e documentat si pe ce ne bazam:** ceasul e al TRANZACTIEI — porneste la inceputul ei (BEGIN explicit sau
  tranzactia implicita a unei instructiuni), cu valoarea in vigoare atunci, si se opreste la final (iar la COMMIT, la
  intrarea in COMMIT: proba `lock_commit_lent`). In sursa: `StartTransaction()` (xact.c) porneste ceasul daca valoarea e
  > 0. Asta e singurul comportament pe care se sprijina r12.
- **Ce NU e documentat si nu folosim:** schimbarea valorii in mijlocul tranzactiei trece prin functia de atribuire a
  setarii (`assign_transaction_timeout`, postgres.c). Proba r11 a aratat pe 17.11: pornit din 0 in mijlocul tranzactiei
  => ceasul porneste la setare (critic / commit); deja pornit (10 s) + 0 apoi 2 s => NU s-a obtinut un ceas de 2 s de
  la setare (mostenit). Concluzia de lucru: o schimbare in mijlocul tranzactiei nu e un mecanism pe care sa ne bazam.
  **Limita onesta:** pe server nu am sursa 17.11 si nici acces la paginile postgresql.org / GitHub (nu sunt pe lista de
  domenii permise), deci trimiterea exacta la cod o cer chat-ului (extrasul `assign_transaction_timeout` si
  `StartTransaction` din REL_17_STABLE, pentru review). Ce nu depinde de asta: proba de mai jos.
- **Proba, pe acelasi server:** `semantica_tt` (inceputul harness-ului), 7 cazuri cu timpi reali, fiecare intr-o sesiune
  noua: `armat_la_begin` (1,5 s din conexiune; PRAG care pica testul: inchis la ~1,5 s), `setat_din_zero`,
  `armat_0_apoi_1s_in_DO` (forma r10 / r11), `armat_set_local_0`, `armat_mai_mic`, `armat_mai_mare`, `r11_mostenit`
  (exact proba picata). Fiecare linie `SEMANTICA_TT` spune „inchis” / „neinchis” si dupa cat; ultima linie explica cum se
  citesc (inchis la valoarea de la BEGIN = schimbarea nu repune ceasul; ~1,5 s = il repune de la setare; neinchis = l-a
  oprit). Rezultatul intra in raport la rulare; designul nu depinde de el, cu exceptia primului caz.

### 2. Plafonul, independent de aceasta semantica si de ce a setat sesiunea / rolul
- **Alegerea: pregatirea ramane in ACEEASI tranzactie, ceasul e pus de la bun inceput (BEGIN), iar bugetul TOTAL al
  tranzactiei e plafonat la 2 s.** Runnerul trimite `transaction_timeout = 2000` ca parametru de pornire al conexiunii
  livrarii (`livrare_migrare.sh --plafon-tranzactie-ms 2000`, PR separat **#1054**, cu testul lui
  `scripts/test_livrare_plafon.sh`). Sursa valorii in server e `client`, prioritara fata de `ALTER ROLE / ALTER DATABASE
  … SET`, deci PostgreSQL porneste ceasul la BEGIN-ul lui `psql --single-transaction` cu exact 2 s, orice ar avea rolul /
  baza. Fisierele nu mai ating `transaction_timeout` (contractul static: numele apare o singura data in codul executat,
  in verificare; niciun `RESET`). `$pre$` cere `2000/client` inaintea lock-ului consultativ si a oricarei schimbari:
  runner vechi / fara optiune, pooler care pierde parametrul, ceas schimbat in tranzactie (alta valoare SAU aceeasi
  valoare: sursa devine `session`) => `PORTAL_PLAFON_TRANZACTIE_REQUIRED`, nimic schimbat.
- **Atomicitatea (de ce nu o tranzactie separata pentru partea critica):** daca pregatirea s-ar comite separat si partea
  critica ar refuza, ar ramane obiectele pregatirii (rol, functii, tabele goale) fara curatenie automata — exact ce
  refuzurile atomice de pana acum interzic. In aceeasi tranzactie, orice refuz (eroare, `PORTAL_LOCK_BUDGET`, inchiderea
  sesiunii de catre ceas) = ROLLBACK la TOT, pregatirea inclusa. Pretul: cele 2 s includ si pregatirea (pe fixture
  ~30 ms; de masurat in DRY pe clona) si asteptarea lock-urilor.
- **Asteptarea lock-urilor:** NOWAIT + reincercare la 50 ms pana la **1 s de la BEGIN** (`now()` = inceputul
  tranzactiei; inainte 3 s de la intrarea in `$locks$`), ca sa ramana cel putin ~1 s pentru `$critic$`; peste = 55P03,
  nimic schimbat.
- **Compatibil cu runnerul oficial:** da, tot `psql --single-transaction`, o singura tranzactie; schimbarea ceruta e
  doar optiunea noua din #1054 (fara ea, comportamentul runnerului ramane neschimbat, iar aceste migrari refuza).
  **Ordinea de merge: #1054 inainte de #892.** La DRY / aplicare: endpointul trebuie sa transmita parametrul de pornire
  (conexiunea directa il transmite; un pooler care il ignora e prins de prolog = refuz, fara efecte).

### 3. Probele (cele 4 fluxuri: 18a, 19a, revenire 19a, revenire 18a)
`lock_cap_refusal`, toate conectate exact ca runnerul, clientul tine sesiunea 3 s fara instructiuni:
- `critic` / `commit`: fara niciun timeout prealabil; pauza intre `$locks$` si `$critic$` / dupa `$critic$`;
- `mostenit`: ROLUL are `transaction_timeout = 10s` (verificat `10000/user` intr-o conexiune obisnuita), 0,8 s de lucru
  INAINTE de `$locks$`, pauza dupa `$critic$`;
- `mic`: rolul are 500 ms (`500/user`), la fel 0,8 s de lucru inainte.
Asteptat in toate: conexiunea livrarii vede `2000/client`; serverul inchide sesiunea (linie noua in jurnal) la
**~2 s de la BEGIN** (fereastra [1950, 2400] ms; daca s-ar socoti de la lock-uri, mostenit / mic ar da ~2,8 s; daca ar
conta rolul, 10 s / 0,5 s inainte de lock-uri); lock-urile tinute <= timpul de la BEGIN; sesiune disparuta, probe libere,
stare neschimbata, trafic concurent masurat. `plafon_refuz` pe fiecare flux: fara plafon in conexiune (`0/default`),
`SET LOCAL` 10 s in tranzactie (`10000/session`), `SET LOCAL` cu aceeasi valoare (`2000/session`) => refuz in `$pre$`,
nimic schimbat. Plus `PLAFON_RUNNER 18a` (runnerul fara optiune => cod 10), `LOCK_BUDGET` (refuz la >= 1 s si < 2 s de
la BEGIN, din mesajul serverului), `LOCK_COMMIT_LENT` (conectat cu plafon 2 s: COMMIT-ul asteapta > 3 s fara inchidere,
apoi se comite — limita ramane). `LOCK_PRE` / `LOCK_OBS` tin intentionat tranzactia deschisa: ruleaza pe o copie in care
plafonul cerut si cel din conexiune sunt 120 s (`copie_obs`, exact o inlocuire), nu sunt probe de plafon.

### 4. `volum: fixture incomplet`
Cauza: verificarea numara in `pg_class` si indexurile `volum_tN_pkey` (1.200 in loc de 600 de tabele). Reparat: doar
`relkind = 'r'`, nume exacte prin regex, plus conturi / profiluri legate de fise / drepturi pe module numarate exact;
harness-ul tipareste `VOLUM: 400|400|1600|600|1500` si pica cu valorile gasite daca difera.

### 5. Garantia r12 (aceeasi in cele 4 fisiere, in PR si in E1_REVENIRE_AUTH.md)
- **Plafonat:** de la BEGIN-ul tranzactiei de livrare (deci si de la primul lock, care vine dupa) PANA LA INTRAREA IN
  COMMIT trec cel mult 2 s — pregatirea, asteptarea lock-urilor, `$critic$`, inregistrarea runnerului, orice pauza a
  clientului / retelei. Peste: serverul inchide sesiunea => ROLLBACK la tot, runnerul raporteaza NEAPLICAT (10).
- **Neplafonat (limita r11, neschimbata):** COMMIT-ul propriu-zis — flush WAL (de regula milisecunde) si, numai cu
  replicare sincrona, asteptarea standby-ului.
- **Decizia pentru Razvan (r11) ramane, cu doua precizari:** limita e acum mai stricta (2 s de la BEGIN, nu de la
  lock-uri); asteptarea lock-urilor e de cel mult 1 s (refuz mai des daca cineva tine tabelele — sigur, se reia).

### Dovezi
- Mine: contractul static (portul node al `buget_lock.py` + mutantii din `test_static*.py`): cele 4 fisiere acceptate,
  46/46 mutanti respinsi (inclusiv „plafon repornit in `$locks$`”, `SET LOCAL transaction_timeout`, fara verificare,
  `2000/session`, verificare dupa lock-ul consultativ, reincercare socotita de la `$locks$`, `RESET`), 3 martori acceptati.
- De rulat de chat (la mine binarele PG, Python si `bash -n` cer aprobare):
  `wsl -d Ubuntu-24.04 -u root -- bash /mnt/c/Users/Gazpet-Ai/rdr-wt/portal-e1-r12/scripts/portal/harness_wsl.sh <slot> 160`
  si, pentru #1054, `wsl -d Ubuntu-24.04 -u postgres -- bash /mnt/c/Users/Gazpet-Ai/rdr-wt/portal-e1-r12/scripts/test_livrare_plafon.sh <slot>`.

| Regula | Dovada r12 |
|---|---|
| L01 / L06 | Ordinea lock-urilor si NOWAIT neschimbate; reincercarea socotita de la BEGIN (static: mutant respins). |
| L02 | Pregatirea si partea critica raman in ACEEASI tranzactie (nu o tranzactie separata pentru partea critica: un refuz ar lasa pregatirea comisa); coada = `$critic$`, o singura instructiune dupa `$locks$`. |
| L14 | O singura tranzactie: refuzul / inchiderea = ROLLBACK la tot, pregatirea inclusa; verificat prin starea dinainte pe aplicari si reveniri (`lock_cap_refusal`, `plafon_refuz`, `PLAFON_RUNNER`). |
| L18 | Inchiderea dovedita pozitiv (linie noua in jurnal + fereastra + timpul de la BEGIN), refuzurile pe mesajul exact (`PORTAL_PLAFON_TRANZACTIE_REQUIRED: <valoare>/<sursa>`). |
| L20 | Trafic legitim concurent in toate probele de plafon (16), cu prag; traficul / observatorul ruleaza fara setarea de rol a probei. |
| L25 | Comportamentul PG17 aratat (`semantica_tt`, prag pe singurul caz folosit), sesiuni reale, timpi pe ceasul serverului, a doua sesiune; nicio presupunere despre schimbarea ceasului in mijlocul tranzactiei. |
| restul | n/a pentru delta r12 (plafon + harness + volum + runner). |

## E1-1a/1b r13 — 11.11.2026 (un singur caz de plafon picat pe PG17 real: cauza = ceasul de perete al WSL)

Harness-ul r12 (`bdf30bf0`) pe PostgreSQL 17.11 in WSL: `SEMANTICA_TT` confirma designul r12; `LOCK_CAP` trece pe 14 din
16 variante (inchis la 2000–2002 ms de la BEGIN); pica `plafon rev18a/mostenit: inchis la 3204 ms de la BEGIN`
(FEREASTRA 2348 ms, TRAFIC 2344 ms); `rev18a/mic` si volumul nu au mai rulat.

### Cauza (din artefactele rularii, nu presupusa)
- **Dovada directa:** `/var/log/syslog` din WSL: `systemd-resolved: Clock change detected` la **16:46:41.139**, adica in
  fereastra probei (BEGIN 16:46:39.031 = `xact_start`; FATAL in jurnalul serverului 16:46:42.232). WSL2 isi potriveste
  ceasul de perete cu gazda Windows in salturi: in syslog apar astfel de linii la ~30–60 s pe toata ziua.
- **Toate cele trei masuratori sunt umflate cu ACEEASI marime (~1,2 s):** inchis 3201 ms (jurnal) / 3204 ms
  (observator); FEREASTRA 2348 ms = 2000 − 856 + ~1200; TRAFIC 2344 ms. Exact asa arata un salt INAINTE de ~1,2 s:
  duratele se citesc pe ceasul de perete (`xact_start`, `clock_timestamp()`, jurnal, `date`), iar ceasul
  `transaction_timeout` e `setitimer(ITIMER_REAL)` (numara timp monoton). In timp real sesiunea a fost inchisa la 2 s.
- **Ipotezele din brief, verificate:** (1) conexiunea nu primea `2000/client` — FALS: `$pre$` din aceeasi sesiune a trecut
  (cere exact `2000/client`) si proba verificase `vl`; (2) instructiune neintreruptibila / `DROP ROLE` — FALS: sesiunea
  era `idle in transaction` de la 901 ms (fisierul `pauza_*.t`: marcajul vazut de server), `$critic$` (cu `DROP ROLE`)
  se terminase, iar clientul nu a mai trimis nimic pana la ~3,9 s; (3) proba masoara gresit pornirea clientului — FALS:
  `xs` = `xact_start` al serverului, confirmat si de jurnal; (4) efect de ordine — FALS: starea verificata `t` inainte,
  rolul resetat dupa fiecare proba. Ce masura gresit proba: durate pe un ceas care poate sari.
- **Limita reala, mica (PostgreSQL):** la semnal, PG compara ceasul de perete cu termenul; un salt INAPOI de X ms in
  timpul tranzactiei amana inchiderea cu X ms (inainte = inchidere la timp sau mai devreme). La fel bugetul de
  asteptare al lock-urilor (`clock_timestamp() - now()`). Pe productie (NTP potriveste lin, fara salturi) neglijabil;
  garantia exacta: „≤ 2 s pe ceasul serverului”. Nimic de schimbat in migrari sau in runner.

### Ce s-a schimbat (doar harness-ul; migrarile, revenirile si runnerul #1054 neschimbate)
- `ceas_*` (`concurrency_lock.sh`): abaterea ceasului de perete fata de ceasul MONOTON (`/proc/uptime`) pe toata durata
  fiecarei probe `LOCK_CAP` si a cazului `semantica armat_la_begin`. |abatere| >= 100 ms => masuratoare **NEVALIDA in
  ambele sensuri** (si cand ar fi trecut: un salt inapoi ar putea ascunde o inchidere tarzie) => linia `CEAS_SALT`, proba
  se repeta (cel mult 3 incercari; nevalida de 3 ori = esec). `masurat` (aplicarile reale, nerepetabile) pica explicit
  „NEVALIDA, de rerulat” daca ceasul a sarit; liniile `LOCK_CAP` / `MASURAT` arata abaterea.
- Un esec de plafon NU mai opreste harness-ul: `ESEC_PLAFON <flux>/<mod>: <motive>` si se continua (toate 16 probe,
  volumul, commit-ul lent); la final `PLAFON_ESECURI` = lista completa si cod 1 (lista se tipareste si la orice alta
  oprire). Esecurile de integritate (stare schimbata, sesiune ramasa, lock ramas) raman fatale pe loc.
- `harness_wsl.sh`: la final `CEAS_WSL` = liniile `Clock change detected` din syslog-ul WSL din timpul rularii (dovada
  independenta pentru `CEAS_SALT`).

| Regula | Dovada r13 |
|---|---|
| L14 | Neschimbat: refuz / inchidere = ROLLBACK la tot; dupa fiecare incercare (si repetare) starea verificata inainte de a continua. |
| L18 | Masuratoare cu ceasul sarit = NEVALIDA (nu „trecut”), in ambele sensuri; esecurile listate toate, nu doar primul. |
| L25 | Cauza aratata din artefactele rularii (syslog WSL, jurnalul serverului, fisierul pauzei, observatorul), nu presupusa; timpii validati fata de un ceas independent (monoton). |
| restul | n/a pentru delta r13 (doar harness). |

## E1-1a/1b r14 — 11.11.2026 (plafonul trebuie sa ajunga la server PRIN POOLER)

Harness-ul r13 pe PostgreSQL 17.11: toate cele 16 `LOCK_CAP` trec (2000–2003 ms), `SEMANTICA_TT` confirma designul, volumul
trece; singurul esec = proba optionala de COMMIT intarziat. Dar faptele de pe productie (citite de chat, doar citire):
PostgreSQL 17.6, `synchronous_commit = on`, `synchronous_standby_names` gol; conexiunea noastra trece prin pooler-ul
Supabase (session mode), care **nu transmite optiunile de conectare** (`PGOPTIONS` / `options=` => serverul vede
`0/default`). Designul r12–r13 (`2000/client`) ar fi refuzat mereu pe productie. Ce trece prin pooler (probat de chat):
`SET transaction_timeout = 2000` ca instructiune de sesiune INAINTE de `BEGIN` => in tranzactie `2000/session`.

### Ce s-a schimbat
- **Runnerul (#1054, runda 11):** cu `--plafon-tranzactie-ms N`, pe O conexiune, psql fara `--single-transaction`:
  `SET transaction_timeout = N` (sesiune) → `BEGIN` → prologul (primul dupa BEGIN: cere `N/session` din
  `pg_catalog.pg_settings`, pune marcajul `gazpet.plafon_tranzactie = 'N:<txid>'`) → lock, tinta, istoric, marcaj → copia →
  inregistrarea → **garda finala** (valoarea tot `N/session` + marcajul, iar `clock_timestamp() − transaction_timestamp()`
  ≤ N ms) → `COMMIT` → `RESET transaction_timeout`. Cu `ON_ERROR_STOP`, la orice eroare psql se opreste si inchide
  conexiunea, serverul anuleaza tranzactia. Pre-verificarea, reconcilierea si gate-ul 0e incep cu
  `SET transaction_timeout = 0` (un backend refolosit de pooler nu le poate impune plafonul ramas). Fara optiune:
  NESCHIMBAT (psql `--single-transaction`, aceleasi fisiere, fara SET).
- **Validatorul runnerului (P2 Jakarinos r13):** cu plafon (`--plafon-tranzactie`), refuz (cod 3, fara conexiune) pentru
  orice artefact in care `transaction_timeout` sau `pg_settings` apar altfel decat in citirea exacta
  `FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout'` — oriunde: SET / SET LOCAL / set_config / RESET /
  ALTER ROLE|FUNCTION … SET / CREATE FUNCTION … SET, in DO, in corpuri, prin concatenare (`'transaction' || '_timeout'`),
  in comentarii (fail-closed) — si pentru orice `RESET ALL`. Mutantul din verdict (`SET LOCAL transaction_timeout = 0;
  SELECT pg_sleep(3)`) = refuz 3. SQL-ul dinamic construit din bucati (ex. `chr(95)`) nu se vede static: il prinde garda
  finala (valoare schimbata = `PLAFON_SCHIMBAT`; ceas oprit apoi repornit = `PLAFON_DEPASIT`), ROLLBACK, nimic comis.
  ~~Limita declarata: o asemenea ocolire DELIBERATA intr-un artefact aprobat poate intarzia inchiderea, dar nu poate
  comite.~~ **FALS in r14** (Jakarinos r14 P2): garda si COMMIT-ul erau mesaje separate, deci o pauza client / retea dupa
  garda permitea COMMIT dupa termen. Corectat in r15 (garda si COMMIT-ul intr-un singur mesaj), vezi sectiunea r15.
- **Cele 4 fisiere:** `$pre$` cere exact `2000/session` din `pg_catalog.pg_settings` (calificat: al doilea recenzent r13
  P1, umbrirea prin `pg_temp.pg_settings`) **si** marcajul plafonului `'2000:' || txid_current()`. Refuza `0/default`,
  `2000/client` (optiunea r13), `2000/user` (rolul), `2000/database`, alta valoare de sesiune, si `2000/session` fara marcaj
  (SET LOCAL in tranzactie). Comentariile nu mai numesc ceasul / vederea (regula validatorului cu plafon).
- **De ce `2000/session` vazut de prolog dovedeste ceasul pornit la BEGIN cu 2000:** valoarea unui GUC se schimba intr-un
  backend doar prin instructiuni rulate in el (reload-ul de configuratie si `ALTER ROLE` nu ating o valoare de sesiune);
  intre BEGIN si prolog nu ruleaza nimic (prologul e primul fisier al runnerului dupa BEGIN), deci valoarea de la BEGIN =
  cea din prolog, iar PG17 armeaza ceasul la inceputul tranzactiei cu valoarea curenta. SQL-ul SINGUR nu poate deosebi
  „SET inainte de BEGIN” de „SET LOCAL dupa BEGIN” (ambele au sursa `session`) => ordinea o garanteaza runnerul (fisierele
  lui), iar migrarea cere in plus marcajul pus de prolog numai dupa verificare; validatorul si garda finala acopera
  artefactul. Dovezi in harness: `semantica sesiune_inainte_de_begin` (SET 1500, 1 s pauza, BEGIN => inchis la ~1,5 s de
  la BEGIN, nu de la SET) si refuzul `set_local_in_tranzactie`.
- **Harness:** livrarile simulate direct incep EXACT ca runnerul (`liv` / `obs`: SET de sesiune, BEGIN, prolog, …,
  COMMIT); toate cele 16 `LOCK_CAP` pe forma noua; `plafon_refuz` = 6 cazuri (fara plafon, optiunea de conectare r13, rol,
  alta valoare, SET LOCAL fara marcaj, **umbrire**: `CREATE TEMP TABLE pg_settings` fals + marcaj falsificat, cu dovada in
  aceeasi tranzactie ca o citire necalificata vede falsul => fisierul vede `0/default` => refuz). Proba de COMMIT
  intarziat: cauza esecului r13 = tranzactia de activare (`SELECT txid_current()`) nu scria WAL, iar PostgreSQL asteapta
  standby-ul doar dupa o tranzactie care a scris WAL => acum `CREATE TEMP TABLE`; daca mediul tot nu activeaza replicarea
  sincrona, `LOCK_COMMIT_LENT … NEEXECUTAT` fara sa pice rularea (`LOCK_COMMIT_LENT_STARE` la final).
  `harness_wsl.sh` ruleaza in plus testul validatorului si proba runnerului (`test_livrare_plafon.sh`: ok, rol, lent,
  client care pierde optiunile = pooler simulat, umbrire, validator, garda finala, fara optiune).

### Garantia (formulare exacta, in cele 4 fisiere, in runner si in PR)
**Aproximativ 2 s de la BEGIN pana la intrarea in COMMIT** — timeout PostgreSQL pe ceasul serverului, nu timp real strict
(masurat 2000–2003 ms). **COMMIT-ul propriu-zis nu e plafonat**: pe productie, fara replicare sincrona
(`synchronous_standby_names` gol), inseamna scrierea WAL a commit-ului (de regula milisecunde).

### Nota P2 (al doilea recenzent r13): secventele
Atomicitatea e completa pentru schema si datele comise, nu si pentru secvente: daca reconcilierea din 19a insereaza in
`conturi_tip`, triggerul de audit consuma valori din `conturi_tip_jurnal_id_seq` (existenta din 18a); un refuz ulterior
anuleaza randurile si schema, dar poate lasa goluri in secventa. Nu e pierdere de date (scris si in antetul 19a).

| Regula | Dovada r14 |
|---|---|
| L08 | Identitatea livrarii neschimbata (`current_user = 'postgres'` + marcajul runnerului); marcajul plafonului e o garda de protocol, nu o autorizatie (ca marcajul livrarii). |
| L13 | Validatorul: numaratoare pe text brut + text comprimat, fail-closed; test pozitiv (citirea exacta, de doua ori) si negativ (18 cazuri, `scripts/test_livrare_validator_plafon.py`). |
| L14 | O tranzactie: SET de sesiune inainte, BEGIN / COMMIT in fisierele runnerului; orice eroare = conexiune inchisa = ROLLBACK la tot; reconcilierea decide codul (10 / 0 / 20). |
| L15 | Umbrirea `pg_temp.pg_settings` inchisa prin calificare (`pg_catalog`), verificata static (mutant) si in harness (`plafon_refuz umbrire`, `test_livrare_plafon.sh umbrire`). |
| L18 | Refuzurile pe mesajul exact (`<valoare>/<sursa> marcaj <marcaj>`); proba de COMMIT neexecutabila = `NEEXECUTAT`, nu „trecut”. |
| L20 | Caile legitime: aplicarea / revenirea reala prin runner (`masurat`, volum) si fara optiune (regresie `PLAFON_FARA`, mutantul acceptat fara plafon). |
| L25 | Comportamentul PG17 aratat cu prag (`sesiune_inainte_de_begin`); pooler simulat (client fara optiuni); doua sesiuni reale in probele de plafon. |
| restul | n/a pentru delta r14 (runner + validator + preflight + harness). |

## E1-1a/1b r15 — 11.11.2026 (termenul trebuie sa tina pana la COMMIT; doar runnerul #1054 r3)

Verdictul Jakarinos r14: #1054 NO-GO, un singur P2 — in runner, garda finala (timpul de la BEGIN) si `COMMIT` erau
instructiuni (mesaje) separate. Un artefact care opreste ceasul si il reporneste (SQL dinamic; sau o functie EXISTENTA cu
`SET transaction_timeout = 0`, la iesirea careia valoarea restaurata porneste un ceas NOU de N ms) trece garda, iar o
pauza client / retea inainte de COMMIT lasa tranzactia sa comita dupa termen. Afirmatia r14 „poate intarzia inchiderea,
dar nu poate comite” era FALSA (taiata mai sus). Al doilea recenzent: GO cu conditii la aplicare (P0 = 0, P1 = 0, P2 = 2).

### Ce s-a schimbat (runnerul; SQL-ul portalului NESCHIMBAT, SHA-urile raman)
- `9_fin.sql` = UN SINGUR mesaj de interogare (instructiunile legate cu `\;` in psql): `SET CONSTRAINTS ALL IMMEDIATE`
  (triggerele amanate ruleaza ACUM, inaintea garzii, nu in COMMIT) → `SET LOCAL search_path = pg_catalog, pg_temp` →
  garda (niciun cursor `WITH HOLD` deschis — s-ar materializa in COMMIT; valoarea tot `N/session` + marcajul; timpul de la
  BEGIN pe ceasul SERVERULUI ≤ N) → `COMMIT`. `RESET transaction_timeout` ramane mesaj separat, dupa COMMIT.
- De ce inchide golul: serverul primeste mesajul intreg inainte sa-l execute, deci intre garda si COMMIT nu exista drum
  client↔server; la eroarea garzii serverul abandoneaza restul mesajului (COMMIT-ul nu se executa), psql
  (`ON_ERROR_STOP`) iese, conexiunea se inchide, tranzactia se anuleaza. Orice pauza a clientului / retelei cade ACUM
  inaintea garzii si e numarata de ea. ~~Intre garda si COMMIT nu mai ruleaza cod SQL venit din artefact.~~ (r17: FALS —
  un trigger amanat poate reamana si lasa alt trigger amanat pentru COMMIT; vezi sectiunea r17.)
- Rearmarea ceasului din garda (0, apoi timpul ramas) NU e folosita: in forma de un mesaj n-ar adauga nimic si ar schimba
  valoarea verificata. Semantica rearmarii (valoare > 0 cu ceasul oprit ⇒ ceas nou de N ms; 0 ⇒ oprit) e cea citata de
  verdict din sursa PG 17.6 (`postgres.c`); n-am putut deschide sursa (domeniu in afara listei aprobate) — proba e
  comportamentala, in harness (controalele de mai jos).
- Preflight-ul celor 4 fisiere: NESCHIMBAT. Forma noua nu schimba nimic din ce vad ele (`2000/session` + marcajul pus de
  prolog); garda finala e a runnerului. Fisierele portalului nu ating ceasul (validatorul cu plafon le accepta), deci
  pentru ele garantia de mai jos e cea „fara ocolire”.

### Garantia r15 (formulare exacta)
- **Fara ocolire** (cazul celor 4 fisiere): serverul inchide sesiunea la ~2 s de la BEGIN daca tranzactia n-a ajuns in
  COMMIT (timeout PostgreSQL pe ceasul serverului, nu timp real strict).
- **Cu orice ocolire a ceasului din artefact**: livrarea NU poate COMITE daca de la BEGIN pana la garda finala (ultima
  instructiune inaintea intrarii in COMMIT, in acelasi mesaj) au trecut peste N ms pe ceasul serverului.
- **Ce NU garanteaza:** (1) COMMIT-ul propriu-zis NU e plafonat (P2-01 al doilea recenzent): scrierea WAL, actiunile
  ON COMMIT ale tabelelor temporare, iar cu replicare sincrona si asteptarea standby-ului — cere acceptul explicit al lui
  Razvan; (2) o ocolire deliberata poate TINE tranzactia (si lock-urile) deschisa peste N pana ajunge la garda — nu comite,
  dar inchiderea intarzie; (3) ceasul serverului e ceas de perete; (4) validatorul e garda de PROTOCOL (refuza formele
  vizibile static), nu dovada — SQL-ul dinamic din bucati si apelul unei functii existente trec de el (scris ca test).

### Notele celui de-al doilea recenzent (r14, fara cod nou)
- **P2-01 — COMMIT neplafonat:** confirmat, nereparat (vezi mai sus); conditie de aplicare: acceptul explicit al ownerului.
- **P2-02 — secventa jurnalului:** un refuz al tranzactiei poate lasa goluri in ID-urile `conturi_tip_jurnal_id_seq`; fara
  pierdere de randuri comise; nu blocheaza aplicarea.
- **Revenirea:** dupa ce portalul a fost folosit (date noi), revenirea completa poate refuza INTENTIONAT; NU e mecanism de
  urgenta (procedura de urgenta: `E1_REVENIRE_AUTH.md` — oprirea hook-ului din configuratia Auth, fara SQL).

### Teste r15
- `scripts/test_livrare_plafon.sh` (PG17 real, in `harness_wsl.sh`), cazuri noi, fiecare cu CONTROL care arata ca forma
  veche comitea dupa termen: `PLAFON_REARMARE` (N = 2000, ceas oprit prin SQL dinamic si repornit la ~1,5 s, pauza client
  1 s chiar inaintea liniei COMMIT ⇒ control r11 comite, forma r15 `PLAFON_DEPASIT`, nimic comis), `PLAFON_FUNCTIE`
  (functie existenta cu `SET transaction_timeout = 0`), `PLAFON_AMANAT` (trigger `DEFERRABLE INITIALLY DEFERRED` ⇒ fara
  `SET CONSTRAINTS ALL IMMEDIATE` ruleaza in COMMIT, dupa garda), `PLAFON_CURSOR` (cursor `WITH HOLD` ⇒ refuz). Cazurile
  vechi neschimbate (`PLAFON_FARA` = fara optiune, ca inainte).
- `scripts/test_livrare_forma_fin.sh` (fara BD, psql fals): cu optiunea, `9_fin.sql` = exact 2 mesaje
  ([constrangeri; search_path; garda; COMMIT] + [RESET]); fara optiune, invocarea `--single-transaction` de dinainte.
- `scripts/test_livrare_validator_plafon.py`: 20 de cazuri (2 noi = limita validatorului, acceptate) + cele 4 fisiere.
- Harness-ul portalului (`liv` / `obs`) simuleaza inceputul livrarii ca runnerul; garda finala si COMMIT-ul in acelasi
  mesaj se probeaza in testele runnerului de mai sus (LOCK_CAP masoara inchiderea de catre server, neschimbata).

| Regula | Dovada r15 |
|---|---|
| L14 | O tranzactie; garda + COMMIT in acelasi mesaj: la eroarea garzii COMMIT-ul nu se executa, conexiunea se inchide = ROLLBACK; reconcilierea decide codul. |
| L15 | Garda nu poate fi umbrita: `search_path` fixat pe `pg_catalog` in mesajul final, functiile calificate; citirea calificata neschimbata. |
| L18 | Refuz pe mesaj exact (`PLAFON_DEPASIT`, `PLAFON_CURSOR`, `PLAFON_SCHIMBAT`); controalele care nu se activeaza = proba nefunctionala = ESEC, nu „trecut”. |
| L20 | Caile legitime: fara optiune neschimbat (`PLAFON_FARA`, `FORMA_FARA`); triggerele amanate legitime ruleaza tot (doar mai devreme); `PLAFON_OK` / `PLAFON_ROL` / `PLAFON_POOLER` comit. |
| L25 | Expected independent (psql fals + impartitor propriu de mesaje); PG17 real, NOSUPERUSER; fiecare mutant cu control functional. |
| restul | n/a pentru delta r15 (doar runnerul + testele lui + `harness_wsl.sh`). |

## E1-1a/1b r16 — 11.11.2026 (harness-ul PG17 pe r15: 3 esecuri, toate de MEDIU / TEST; runnerul si SQL-ul neschimbate)

Rularea r15 (`harness_wsl.sh 5`, PG 17.11): `harness=1 validator=0 forma=1 runner=1`. Cauzele, din loguri:

1. **RUNNER — `rearmare control: cod 10`.** Controlul e construit corect: proba de semantica din ACEEASI rulare
   (`SEMANTICA_TT armat_0_apoi_1s_in_DO`: oprit apoi repornit cu 1 s la 0,5 s ⇒ inchis la 1508 ms) arata ca pe 17.11
   oprirea + repornirea pornesc un ceas NOU, deci controlul (ceas nou de 2 s la ~1,55 s, COMMIT la ~2,6 s) trebuia sa
   comita. Serverul l-a inchis la 20:02:29.119, la 0,6 s dupa un salt al ceasului de perete WSL (20:02:28.524, lista
   `CEAS_WSL`): timeout-urile PostgreSQL masoara pe ceasul de perete, un salt inainte le declanseaza mai devreme. Testul
   runnerului nu avea detectorul de salt pe care il are harness-ul (r13).
   Reparat: `asteapta_ceas` pe cazurile cu timpi (lent, garda timp, rearmare, functie, amanat, cursor + controalele lor) —
   abatere perete/monoton ≥ 100 ms = caz NEVALID in ambele sensuri (si cand ar fi trecut), curatat si repetat (≤ 3 ori).
2. **FORMA — `fara: fisierele trimise mentioneaza plafonul`.** Fals pozitiv al testului: baza tinta a testului se numea
   `plafon_test`, iar `1_pre.sql` (fara optiune, neschimbat) contine `current_database() IS DISTINCT FROM 'plafon_test'`.
   Runnerul fara optiune trimite aceleasi fisiere ca inainte. Reparat: baza `forma_test`, garda ca datele testului nu
   contin cuvintele cautate si CONTROL ca aceeasi cautare gaseste plafonul in fisierele trimise CU optiune.
3. **HARNESS — `ESEC_PLAFON */mic` (4 din 16).** Proba asteapta `rc != 0` SI exact o inchidere noua in jurnalul serverului
   (`n1 == n0 + 1`); a primit `rc=2` si 3 inchideri. Jurnalul serverului arata in fiecare fereastra „mic” doua instructiuni
   de TRAFIC inchise la 500 ms (valoarea pusa pe rol) inaintea clientului. Traficul harness-ului are `transaction_timeout = 0`
   si jurnalul lui e curat: instructiunile veneau de la o bucla de trafic RAMASA dintr-o rulare anterioara oprita pe
   acelasi slot (alt director din `/tmp`, alta versiune), care se conecta la clusterul nou de pe acelasi port. Nu e
   regresie (codul harness-ului e identic intre r14 si r15).
   Reparat, fara sa slabeasca proba (tot exact O inchidere, a clientului): bucla de trafic se opreste si cand harness-ul
   care a pornit-o nu mai exista; la orice iesire (si la `fail`) harness-ul opreste buclele din fundal inaintea clusterului;
   `harness_wsl.sh` refuza sa porneasca daca pe slot au ramas procese din rulari vechi si verifica la final ca rularea
   n-a lasat procese; la o numaratoare gresita proba tipareste inchiderile din fereastra si marcheaza `CLIENT STRAIN`.

SQL-ul celor 4 fisiere: neschimbat (SHA-urile raman). Runnerul (`livrare_migrare.sh`): neschimbat.

| Regula | Dovada r16 |
|---|---|
| L18 | Saltul de ceas = NEVALID, nu „trecut”; numaratoarea gresita ramane esec, cu cauza tiparita (`INCHIDERI_IN_FEREASTRA`, `CLIENT STRAIN`). |
| L20 | Proba nu e slabita: tot `n1 == n0 + 1`; controlul de rearmare tot trebuie sa COMITA; forma tot cauta `transaction_timeout` / `plafon`, acum cu control pozitiv. |
| L25 | Expected independent: control pozitiv in testul de forma; validitatea timpilor fata de ceasul monoton (`/proc/uptime`). |
| restul | n/a (doar teste + harness). |

## E1-1a/1b r17 — 11.11.2026 (runnerul #1054 r5: triggerele reamanate dupa garda, inchidere prin catalog)

Harness-ul PG 17.11 pe r16c a trecut integral (cod 0). Al doilea recenzent: runner GO (P2 de notat). Jakarinos r16: #1054
NO-GO, un P2 nou; #892 GO cu conditii dupa #1054.

**P2 (Jakarinos r16).** `SET CONSTRAINTS ALL IMMEDIATE` ruleaza triggerul amanat A; A executa `SET CONSTRAINTS ALL
DEFERRED` si insereaza intr-un tabel cu trigger amanat B; B ramane in coada (PG17 `AfterTriggerSetState` proceseaza doar
evenimentele devenite imediate), garda trece, iar in COMMIT B opreste ceasul si doarme => comite dupa termen. Afirmatia
r15 „intre garda si COMMIT nu mai ruleaza cod SQL venit din artefact” era FALSA (taiata mai sus). Repetarea
`SET CONSTRAINTS` nu e dovada (B poate reamana la randul lui).

### Ce s-a schimbat (runnerul; SQL-ul portalului NESCHIMBAT, SHA-urile raman)
- Garda finala (acelasi mesaj cu COMMIT-ul, dupa `SET CONSTRAINTS ALL IMMEDIATE`) refuza cu `PLAFON_AMANABIL` (nimic
  comis) daca in tranzactia curenta a fost creat sau modificat: un trigger amanabil (`pg_trigger.tgdeferrable`, si cele
  interne — mai strict decat „ne-interne”), o constrangere amanabila (`pg_constraint.condeferrable`; si
  `ALTER CONSTRAINT … DEFERRABLE`, `ENABLE / DISABLE TRIGGER`), sau functia (`pg_proc`) a oricarui trigger amanabil,
  inclusiv a celor EXISTENTE.
- „Creat sau modificat in tranzactia curenta” = randul de catalog are `age(xmin) <= 0`. `age(xid)` =
  `(int32)(GetStableLatestTransactionId() − xid)`, cu referinta = xid-ul de VARF, alocat de prolog (`txid_current()`)
  inaintea oricarui cod al artefactului; garda verifica referinta (`age(xid(pg_current_xact_id())) = 0`, altfel refuz).
  Subtranzactiile (blocuri EXCEPTION, SAVEPOINT) au xid propriu, mai mare decat al parintelui („a child always has an XID
  later than its parent”, `AssignTransactionId`) => `age < 0`, prinse. De aceea NU `xmin = pg_current_xact_id()`: in
  subtranzactie `pg_current_xact_id()` da tot varful, iar egalitatea ar rata randurile scrise in blocuri EXCEPTION.
  Fals pozitiv posibil (fail-closed): o alta sesiune pornita dupa BEGIN-ul nostru care comite un obiect amanabil.
- Sursa PG17 n-am putut-o deschide (domeniu in afara listei aprobate): argumentele de mai sus sunt din cunoasterea sursei
  si au fost verificate EMPIRIC pe PGlite (PG 18, acelasi cod): xmin-ul unui FK creat in bloc EXCEPTION = xid-ul de varf
  + 1 (`age = −1`); obiectele comise anterior `age > 0`; o subtranzactie anulata nu lasa nimic vizibil; scenariul A → B
  reprodus (dupa `SET CONSTRAINTS ALL IMMEDIATE` doar A rulase, B a rulat in COMMIT). SQL-ul EXACT al garzii, extras din
  runner, a fost rulat pe PGlite pe 11 cazuri (toate cu rezultatul asteptat). Dovada pe PG 17 = harness-ul.
- Observatie din proba: la un FK amanabil cu `ON DELETE / ON UPDATE CASCADE`, doar triggerele de verificare
  (`RI_FKey_check_*`) sunt amanabile; cele de actiune (`RI_FKey_cascade_*`) sunt ne-amanabile, ruleaza imediat.

### Garantia r17 (formulare exacta; aceeasi in runner, validator si descrierile #1054 / #892)
- **Ce e garantat:** pentru orice artefact care NU a creat si NU a modificat obiecte amanabile, de la BEGIN pana la
  intrarea in COMMIT trec cel mult ~N ms (garda refuza peste N ms de la BEGIN pe ceasul serverului, oricum ar opri /
  reporni artefactul ceasul; fara ocolire serverul inchide sesiunea la ~N ms — timeout PostgreSQL, nu timp real strict).
  Artefactele care AU creat / modificat obiecte amanabile sunt refuzate (`PLAFON_AMANABIL`, nimic comis).
- **Ce NU e garantat (limite declarate):** (1) COMMIT-ul propriu-zis: scrierea WAL, `ON COMMIT DROP`, procesarea interna,
  cu replicare sincrona si asteptarea standby-ului; (2) codul PREEXISTENT din baza care ruleaza amanat — triggerele /
  constrangerile amanabile existente (neatinse de artefact) ruleaza inaintea garzii, dar daca propriul lor cod reamana
  evenimente, acelea raman pentru COMMIT; iar ce cheama ele INDIRECT (functiile apelate din functia triggerului,
  triggerele ne-amanabile pornite de scrierile lui, operatorii tipurilor din cheile verificate) nu e verificat, chiar
  daca artefactul le-a creat sau inlocuit pe acestea din urma; (3) un operator care ocoleste deliberat runnerul;
  (4) o ocolire deliberata a ceasului poate TINE tranzactia deschisa peste N pana la garda (nu comite); (5) ceasul
  serverului e ceas de perete. Validatorul si garda sunt garzi de PROTOCOL, nu autorizatie.
- **Consecinta acceptata:** o migrare legitima care creeaza / modifica constrangeri sau triggere amanabile (sau functia
  unui trigger amanabil) nu se poate livra cu plafon => se livreaza FARA optiune, cu review. La fel migrarile care se
  bazeaza pe verificarea la COMMIT (ex. copil inserat inaintea parintelui intr-un FK amanabil, intr-un trigger):
  `SET CONSTRAINTS ALL IMMEDIATE` le poate schimba rezultatul (observatia celui de-al doilea recenzent).

### Cele 4 fisiere ale portalului
Citite pe `portal/e1`: niciun `DEFERRABLE` / `INITIALLY DEFERRED` / `CONSTRAINT TRIGGER` / `SET CONSTRAINTS` / cursor
`WITH HOLD` (doar un comentariu in 18a: „fara DEFERRABLE”). FK-urile noi (`conturi_* -> auth.users / employees`,
`portal_provisioning -> employees / auth.users`, `conturi_teren.provisioning_id`) si `UNIQUE`-ul din 19a sunt
ne-amanabile; triggerele noi sunt triggere obisnuite (BEFORE / AFTER, ne-amanabile). Deci nu creeaza nimic amanabil —
ADEVARAT. Ramane O conditie de verificat pe productie (read-only): 19a face `CREATE OR REPLACE` pe
`public.handle_new_user()` si `public.fn_teren_eligibil(uuid)`, iar revenirea 18a pe `public.fn_auth_token_hook(jsonb)`;
daca vreuna ar fi functia triggerului amanabil ne-intern existent pe productie, garda ar refuza livrarea cu plafon
(`PLAFON_AMANABIL`, nimic comis — fail-closed, nu pericol). Dupa migrarile din repo, acel trigger e
`trg_red_raspunsuri_mail_sursa` (functia `fn_red_mail_raspuns_sursa_ceruta()`, 20261130k), iar FK-urile amanabile sunt
cele din 20260929b si 20261008a — niciuna din cele 3 functii de mai sus. Confirmarea read-only pe productie:
`SELECT tgrelid::regclass, tgname, tgfoid::regprocedure FROM pg_trigger WHERE tgdeferrable AND NOT tgisinternal;`

### Teste r17
- `scripts/test_livrare_plafon.sh` (PG17, in `harness_wsl.sh`): `PLAFON_REAMANAT` (scenariul exact din verdict; CONTROL
  = forma r4c, clientul de test scoate blocul `PLAFON_AMANABIL` ⇒ COMITE dupa termen, ≥ 1,5 s, fara inchidere de server;
  forma r17 ⇒ `PLAFON_AMANABIL`, nimic comis), `PLAFON_FK_AMANABIL` (FK `DEFERRABLE` creat intr-o subtranzactie; artefactul
  verifica singur ca xmin-ul nu e al varfului; fara optiune ⇒ 0), `PLAFON_FUNCTIE_AMANATA` (functia unui trigger amanabil
  existent inlocuita; fara optiune ⇒ 0), `PLAFON_FARA_AMANABILE` (FK / UNIQUE / trigger amanabile EXISTENTE folosite +
  FK / trigger ne-amanabile noi ⇒ 0). `PLAFON_AMANAT` mutat pe un trigger PREEXISTENT (altfel l-ar refuza noua regula):
  tot control fara `SET CONSTRAINTS` ⇒ comite, forma livrata ⇒ `PLAFON_DEPASIT`, nu `PLAFON_AMANABIL`. Functiile din
  fixture-uri: `REVOKE EXECUTE … FROM PUBLIC` (gate-ul 0e, r4b).
- `scripts/test_livrare_forma_fin.sh`: ordinea in mesajul final (constrangeri → search_path → amanabile → cursor →
  valoare → timp → COMMIT) + cele trei surse din catalog si verificarea referintei.
- Nerulate inca pe PG 17 (in sesiunea de lucru nu s-a putut rula bash / python); de rulat cu
  `scripts/portal/harness_wsl.sh 5 200`, ca la r16c.

| Regula | Dovada r17 |
|---|---|
| L14 | O tranzactie; refuzul garzii e in acelasi mesaj cu COMMIT-ul ⇒ COMMIT-ul nu se executa, ROLLBACK; reconcilierea decide codul (10). |
| L15 | Inchiderea pe catalog (pg_trigger / pg_constraint / pg_proc), nu pe textul SQL; `search_path = pg_catalog`, functii / tipuri calificate. |
| L18 | Refuz explicit pe mesaj exact (`PLAFON_AMANABIL`); referinta neconfirmata = refuz, nu „trecut”; controlul nefunctional (blocul negasit) = cod 7 = ESEC. |
| L20 | Caile legitime: obiectele amanabile EXISTENTE nu dau fals pozitiv (`PLAFON_FARA_AMANABILE`, `PLAFON_AMANAT`, `PLAFON_OK`); fara optiune neschimbat (`PLAFON_FARA`, `FORMA_FARA`, `*_fara`). |
| L25 | Control pe forma r4c pentru scenariul din verdict; subtranzactia dovedita in artefact; PG17 NOSUPERUSER in harness; expected scris in test, nu derivat din runner. |
| restul | n/a (doar runner + testele lui + raport). |

## E1-1a/1b r18 — 12.11.2026 (proba pe productie: plafonul de 2 s consumat de drumurile client-server; runnerul r6 / runda 14)

### Constatarea (proba din 12.11.2026, owner-ul pe manual, nimic schimbat)
Forma de livrare r17 (`SET transaction_timeout = 2000` de sesiune, BEGIN, prolog, 1_pre, fisierul, 3_inreg, mesajul
final) a lui 18a, prin pooler-ul Supabase (session mode) de pe serverul din Ploiesti: serverul a inchis sesiunea cu
„terminating connection due to transaction timeout” pe la linia 373 din 627, inca in verificari, INAINTEA lock-urilor;
nimic schimbat (verificat). Masurat separat pe acelasi traseu: 60 x `SELECT 1;` cu `psql -f` intr-o tranzactie = 2476 ms
= ~41 ms pe instructiune. psql trimite un fisier instructiune cu instructiune si asteapta raspunsul fiecareia, iar
18a are 59 de instructiuni de nivel superior (19a 47, revenirile 8 / 7, 20261213a una singura), plus ~11 ale runnerului:
~70 x 41 ≈ 2,9 s DOAR de retea pe 18a, ~58 x 41 ≈ 2,4 s pe 19a. Pe harness (cluster local) drumul e ~0, de aceea trecea.

**Ce inseamna pentru ORICE livrare cu plafon de pe un traseu cu latenta:** plafonul (ceasul `transaction_timeout`
pornit la BEGIN + garda finala pe ceasul serverului) masoara si timpul retelei. O livrare trimisa instructiune cu
instructiune consuma din plafon ~(numarul de mesaje dupa BEGIN) x RTT inainte de orice lucru al migrarii; pe acelasi
fisier, rezultatul depinde de unde e rulat runnerul. O proba pe harness fara latenta NU dovedeste incadrarea pe productie.
Garantia ramane corecta (fail-closed: s-a anulat tot), dar livrarea devenea imposibila.

### Ce s-a schimbat (runnerul + testele; SQL-ul celor 4 fisiere ale portalului NESCHIMBAT, SHA-urile raman)
- Cu `--plafon-tranzactie-ms`, TOATA tranzactia (BEGIN ... garda finala, COMMIT) e UN SINGUR mesaj de interogare
  (`scripts/livrare_mesaj.sh`, sursat doar cu optiunea): `SET transaction_timeout = N` (mesaj de sesiune), apoi
  `SELECT $lm_<aleator>$<M>$lm_<aleator>$ \gexec` — serverul intoarce M, iar `\gexec` il trimite „literally” ca un mesaj
  (documentatia psql), apoi `RESET`. M = BEGIN; prolog (primul, neschimbat); verificarea „un mesaj”; 1_pre; COPIA;
  despartitor; 3_inreg; NOTICE LIVRARE_TIMP; garda finala r13 (+ NOTICE PLAFON_TIMP); COMMIT. Serverul citeste mesajul
  intreg inainte sa-l execute ⇒ intre BEGIN si COMMIT nu mai exista niciun drum client-server.
- **Dovada in server, la fiecare livrare** (DO `$mesaj_unic$`, imediat dupa prolog, inaintea lock-urilor):
  `current_query()` (textul intregului mesaj curent) trebuie sa aiba lungimea exacta calculata de runner, sha256 al
  restului mesajului = cel calculat de runner, iar felia copiei = sha256 APROBAT. Mesaj despartit (alt client, alt
  mecanism) sau octet schimbat ⇒ `MESAJ_UNIC`, refuz, nimic comis (10). Nu depindem de presupuneri despre psql.
- De ce nu `psql -c "<fisier>"`: 18a are 48 KB, 19a 62 KB, linia de comanda Windows are 32.767 caractere. De ce nu
  `\;` intre instructiunile artefactului: runnerul ar trebui sa re-imparta si sa RESCRIE artefactul exact ca lexerul psql
  (o nepotrivire ar strica in tacere un corp de functie); forma aleasa trimite copia octet cu octet, nerescrisa.
- Diferente de semantica (scrise in antetul `livrare_mesaj.sh`): serverul citeste literalii intregului mesaj la primire
  (prologul nu mai schimba `standard_conforming_strings` pentru restul mesajului — validatorul refuza deja backslash-ul in
  literalii obisnuiti, deci citirea e identica; 18a / 19a / revenirile n-au niciun backslash, 20261213a doar in corpul
  DO, citit de plpgsql la executie); `statement_timestamp()` e acelasi pe tot mesajul (`now()` / `clock_timestamp()`,
  folosite de portal, neschimbate); meta-comenzile / variabilele psql nu mai sunt interpretate — validatorul le refuza
  la nivel superior (cu si fara plafon; teste noi in `test_livrare_validator_plafon.py`: `\set`, `\i`, `\if`, `\gexec`,
  `\;`, `\!`, `:x`, `:'x'`). Cele 4 fisiere ale portalului: acceptate cu plafon, fara meta-comenzi.
- `--genereaza-in <dosar_nou>`: runnerul face toate verificarile locale si scrie fisierele livrarii, FARA conexiune
  (cod 40) — folosit de proba pe productie, ca ea sa trimita exact textul livrarii.
- Fara optiune: neschimbat (`psql --single-transaction`, aceleasi 4 fisiere).

### Drumuri ramase si bugetul (la 41 ms pe drum)
| | intre BEGIN si COMMIT | in afara tranzactiei (pe conexiunea livrarii) |
|---|---|---|
| r17 (instructiune cu instructiune) | 18a: ~70 drumuri ≈ 2,9 s; 19a: ~58 ≈ 2,4 s | conectare, SET |
| r18 (un mesaj) | **0** | conectare (TCP / TLS / autentificare), SET (1), SELECT-ul care intoarce M (1 + transferul lui M, ~2 x artefactul), incarcarea lui M (inaintea lui BEGIN), RESET (1) |

Bugetul pentru server (prolog, lock-uri, verificari, migrare, inregistrare, garda): 2000 − 0 x 41 = **2000 ms** (in r17:
negativ pe 18a si ~−380 ms pe 19a). Singurul efect al retelei ramas in interiorul ceasului: daca clientul nu citeste
raspunsurile, serverul se poate bloca la trimitere cand i se umple bufferul — timpul e numarat (fail-closed).
SELECT-ul care intoarce M ruleaza in tranzactia lui implicita sub acelasi N (fara lock-uri; un esec acolo = nimic trimis).

### Probe
- `scripts/test_livrare_forma_fin.sh` (fara BD): fisierele 00_sesiune (doar SET), 5_mesaj (O interogare + `\gexec`),
  9_reset; M verificat octet cu octet de `scripts/test_livrare_mesaj_unic.py` (independent: octetii artefactului
  original + sha-ul lui; ordinea pasilor; lungimea, felia rest, felia copiei) + control (copia schimbata ⇒ respins);
  `--genereaza-in` ⇒ cod 40, niciun apel psql; fara optiune neschimbat.
- `scripts/test_livrare_plafon.sh` (PG17): controalele r12-r13 modifica acum mesajul prin
  `scripts/test_livrare_psql_control.sh`; rearmare / functie: control instructiune cu instructiune + pauza 1 s ⇒ COMITE
  dupa termen; pauza inserata in mesaj ⇒ `MESAJ_UNIC`; forma livrata ⇒ comite in termen, garda masurata 1,5–2 s;
  `PLAFON_MESAJ_UNIC`: acelasi mesaj trimis instructiune cu instructiune ⇒ `MESAJ_UNIC` (10); copie fara „;” final si cu
  comentariu fara LF ⇒ aplicata; NOTICE-ul migrarii ajunge in jurnalul livrarii.
- `scripts/test_portal_e1.sh` sectiunea **LATENTA** (cluster nou, proxy TCP `scripts/portal/proxy_latenta.py`, 21 ms pe
  sens ≈ 42 ms pe drum, ca utilizatorul harness-ului — `tc netem` ar cere root si ar intarzia tot loopback-ul; proxy-ul e
  oprit la final si de `iesire_curata` la orice iesire): calibrare (60 x `SELECT 1;` ≥ 2100 ms); CONTROL 18a in forma
  veche ⇒ NU incape (NEAPLICAT 10, inchis de server / garda, nimic ramas); forma noua pe 18a / 19a / rev19a / rev18a ⇒
  APLICAT, cu marja = 2000 − PLAFON_TIMP tiparita (comparata cu livrarea fara latenta). Harness-ul fara latenta: aceleasi
  livrari, acum in forma noua.
- `scripts/portal/dry_prod_e1.sh` — proba pe PRODUCTIE pentru coordonator (owner-ul pe manual): 18a apoi 19a in forma
  exacta de livrare cu plafon 2000, O tranzactie terminata cu ROLLBACK (ambele impart acelasi plafon — mai strict decat
  doua livrari; `--doar-18a` = exact livrarea 18a); refuz daca system_identifier / db / in_recovery nu sunt cele date sau
  18a / 19a sunt deja in istoric; timpii (PORTAL_LOCKS, LIVRARE_TIMP, PLAFON_TIMP, total), amprenta schemei inainte / dupa
  (trebuie identica, altfel cod 5); parola doar din pgpass. Comanda: in antetul scriptului.

### Constatare pe 20261213a (raportata, SQL neatins)
`supabase/revenire/20261213a_executie_acces_proiect_perf_ROLLBACK.sql` e REFUZATA de validator cu plafon: comentariile
din antet mentioneaza `SET transaction_timeout = 3000;` / `RESET transaction_timeout;` (validatorul numara fail-closed si
comentariile). Migrarea 20261213a e acceptata. Daca revenirea trebuie livrata prin runner cu plafon, comentariile se
reformuleaza (decizia autorului ei, alt PR).

| Regula | Dovada r18 |
|---|---|
| L14 | O tranzactie, acum intr-un mesaj: orice eroare ⇒ restul mesajului sarit (protocol), conexiunea inchisa, ROLLBACK; reconcilierea decide codul. Proba pe productie = aceeasi forma, cu ROLLBACK. |
| L15 | Integritatea mesajului verificata in server pe octeti (lungime + sha256), nu pe text / regex; copia = sha256 aprobat. |
| L18 | Mesaj despartit / schimbat = refuz explicit `MESAJ_UNIC`; controalele nefunctionale (transformare negasita) = cod 7; proba pe productie: amprenta diferita = cod 5, nu „OK”. |
| L20 | Caile legitime: forma livrata APLICA (plafon, latenta, fara optiune); copia fara „;” final aplicata; fara optiune neschimbat. |
| L25 | Expected din artefactul original si sha-ul lui (`test_livrare_mesaj_unic.py`), control pe forma veche (latenta, pauza), PG17 NOSUPERUSER, latenta reala pe socket. |
| restul | n/a (runner + teste + raport). |

## E1-1a r19 — 12.11.2026 (proba pe productie trece de plafon, se opreste la postconditia 18a: diagnosticul portilor)

### Constatarea (proba r18 pe productie, nimic comis)
Mesajul unic a trecut prin pooler neschimbat, lock-urile la ~340 ms de la BEGIN, total ~1,2 s: plafonul nu mai e problema.
`$critic$` a ajuns la pasul 5 (`PORTAL_ERP: 27, PORTAL_NEAPROBATE: 7`), apoi `PORTAL_POSTCONDITION_FAILED`:
`fn_portal_porti_lipsa()` intoarce cel putin o poarta, iar mesajul nu spune care. Amprenta schemei dupa = inainte.

**Ce e deja exclus de proba insasi** (verificarile ruleaza INAINTEA postconditiei si au trecut): `$public_pre$` a
confirmat ca setul functiilor din `public` executabile de PUBLIC e exact lista de 21 si ca fiecare are md5-ul revizuit
(proprietar postgres), iar in `net` setul executabil = exact cele 12 chei, fara DEFINER, md5 + proprietar revizuite. Deci
NU e o lista de functii imbatranita, NU e versiunea pg_net. Iar portile `amprenta:` compara cu `portal_public_baseline`,
scris din catalog IN ACEEASI tranzactie cu cateva instructiuni mai devreme: nu pot raspunde la ce s-a aplicat pe productie
intre review si proba. Raman (in ordinea probabilitatii): `relatie:` / `secventa:` (tabel, vedere sau secventa cu drept
pentru PUBLIC intr-o schema la care ajunge teren — inventarul din 10.11 nu le-a listat), `teren scheme USAGE` / `functie:`
(alta schema cu USAGE pentru PUBLIC, sau o functie ne-standard in `information_schema`), `teren CREATE ...`.

### Ce s-a adaugat (SQL-ul celor 4 fisiere ale portalului NESCHIMBAT, SHA-urile raman)
- `scripts/portal/dry_prod_e1.sh --diagnostic-porti`: aceleasi garzi de tinta (system_identifier, in_recovery, istoricul,
  parola doar din pgpass, plafonul 2000 ms, amprenta inainte = dupa); DOAR 18a, pana inainte de postconditie, apoi lista
  completa a portilor (`DIAG_PORTI_LIPSA <i>: <poarta>`, cu detalii: schema, tip, proprietar, drepturi), garda finala,
  ROLLBACK. Rezultatul: `porti_lipsa.txt` in jurnal (o poarta pe linie); completitudinea se verifica (numarul anuntat de
  server = liniile primite, numerotate 1..N), altfel cod 1.
- Copia 18a de diagnostic: `scripts/portal/diag_porti_taie.py` scoate din copia protejata a runnerului (sha256 aprobat)
  EXACT pasul 5 din `$critic$` (postconditia + amprenta pentru revenire), pe marcajele existente — refuz daca vreunul nu
  apare exact o data. Blocul de diagnostic: `scripts/portal/diag_porti.sql` (doar citire, un singur apel al portii).
- NU e forma de livrare si nu se poate confunda cu ea: fara 3_inreg (nicio inregistrare in istoric), fara 19a, fara COMMIT
  nicaieri, alt alias (`diagnostic_porti_nu_e_livrare`), eticheta DIAGNOSTIC_PORTI_18a in verificarea un mesaj si in garda.
  Verificat local INAINTE de conexiune: `scripts/portal/test_diag_porti_mesaj.py` (independent de taietor: copia din mesaj
  = copia aprobata cu O SINGURA bucata stearsa, care incepe cu comentariul + postconditia si dupa care ramane doar
  `END $critic$;`; COMMIT doar in `ON COMMIT DROP`; bloc doar citire) trebuie sa-l accepte, iar verificatorul livrarii
  (`scripts/test_livrare_mesaj_unic.py`) trebuie sa-l REFUZE.
- `--doar-genereaza <dosar_nou>`: construieste si verifica mesajul (oricare mod) fara conexiune, cod 40 — textul se poate
  citi inainte de rulare.

Comanda (coordonatorul, owner-ul pe manual; aceeasi tinta ca proba r18):
```
PSQL_BIN=<psql-ul livrarii> bash scripts/portal/dry_prod_e1.sh --tinta-host <endpoint> --tinta-port <port> \
  --tinta-db postgres --tinta-sistem <system_identifier> --user <utilizatorul livrarii> --diagnostic-porti --jurnal <dosar_nou>
```
Cod 0 = diagnostic rulat (lista tiparita, chiar daca nu e goala). Optional, inainte: acelasi apel cu `--doar-genereaza <dosar_nou>`.

### Lista pentru owner: ce inseamna fiecare poarta, cum se verifica doar prin citire, ce se schimba
Interogarile ruleaza pe productie intr-o tranzactie `BEGIN READ ONLY; ... ROLLBACK;`. Rolul `teren` nu exista inca, dar el
ajunge la obiecte DOAR prin PUBLIC (e NOINHERIT, membru in nimic), deci se intreaba pentru `public` (ca sectiunea 0 din
`scripts/portal/inventar_prod_e1.sql`). Raspunsul asteptat al fiecareia: 0 randuri (la A: exact cele 3 scheme, `create` = false).

| Poarta | Pe intelesul unui om | Ce se schimba ca sa treaca |
|---|---|---|
| `teren scheme USAGE` | Contul de teren ar vedea o schema in plus fata de cele 3 revizuite (sau ar lipsi una). | Schema in plus: drept de curatat (`REVOKE USAGE ... FROM PUBLIC`, dupa ce rolurile ERP primesc explicit ce le trebuie) = **decizia owner-ului**; SAU schema intra in lista din 18a, cu functiile ei in amprente = **SHA nou + review**. |
| `teren CREATE public` / `teren CREATE schema accesibila` | Orice cont de teren ar putea crea tabele / functii intr-o schema comuna. | Drept de curatat (`REVOKE CREATE ON SCHEMA ... FROM PUBLIC`) = **decizia owner-ului**. Nu se accepta prin lista. |
| `relatie:<nume>` | Contul de teren ar putea citi (sau scrie) direct acel tabel / vedere, cu tokenul lui. | Aproape mereu drept de curatat (`REVOKE ... ON <tabel> FROM PUBLIC`; anon / authenticated au granturile lor) = **decizia owner-ului**. O exceptie in 18a ar slabi poarta (teren ar citi tabelul) — nerecomandat. |
| `secventa:<nume>` | Contul de teren ar putea citi / avansa un contor (secventa). | Drept de curatat (`REVOKE ... ON SEQUENCE ... FROM PUBLIC`) = **decizia owner-ului**. |
| `functie:<semnatura>` | O functie pe care contul de teren ar putea-o apela, nerevizuita. In `public` / `net` e exclusa (verificata mai devreme); ramane o schema in plus sau o functie ne-standard in `information_schema`. | `REVOKE EXECUTE ... FROM PUBLIC` = **decizia owner-ului**; SAU functia intra in lista revizuita din 18a = **SHA nou + review**. |
| `amprenta:<semnatura>` | Obiectul s-a schimbat intre doua citiri din ACEEASI tranzactie — nu e o lista veche. | Nimic pe productie: e un defect al portii, se analizeaza din detaliul diagnosticului (fixat / acum) = **SHA nou + review**. |
| `inventar identitati`, `teren lipsa / atribute / membership`, `config incompleta: authenticator teren` | Obiecte create de 18a insasi, sub lock: nu ar trebui sa apara. | Defect al migrarii (sau al mediului: rolul `authenticator`) = **SHA nou + review**. |

```sql
-- A. schemele la care ajunge teren (prin PUBLIC); asteptat exact information_schema, net, public si create = false
SELECT n.nspname, has_schema_privilege('public', n.oid, 'CREATE') AS create_public
  FROM pg_namespace n
 WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_' AND has_schema_privilege('public', n.oid, 'USAGE')
 ORDER BY 1 COLLATE "C";
-- B. relatii cu orice drept pentru PUBLIC in acele scheme (fara catalogul standard doar-citire din information_schema)
SELECT n.nspname, c.relname, c.relkind, c.oid < 16384 AS din_initdb, c.relacl::text AS drepturi
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_' AND has_schema_privilege('public', n.oid, 'USAGE')
   AND c.relkind IN ('r','p','v','m','f')
   AND (has_table_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR has_any_column_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
   AND NOT (n.nspname = 'information_schema' AND c.oid < 16384 AND c.relkind IN ('r','v')
            AND NOT has_table_privilege('public', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            AND NOT has_any_column_privilege('public', c.oid, 'INSERT,UPDATE,REFERENCES'))
 ORDER BY 1, 2;
-- C. secvente cu drept pentru PUBLIC
SELECT n.nspname, c.relname, c.relacl::text AS drepturi
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'S' AND n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_'
   AND has_schema_privilege('public', n.oid, 'USAGE') AND has_sequence_privilege('public', c.oid, 'USAGE,SELECT,UPDATE')
 ORDER BY 1, 2;
-- D. functii executabile prin PUBLIC in afara listelor public (21) / net (12) si a catalogului standard
SELECT n.nspname, p.oid::regprocedure::text AS functie, p.prosecdef, pg_get_userbyid(p.proowner) AS proprietar,
       p.oid < 16384 AS din_initdb
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_' AND has_schema_privilege('public', n.oid, 'USAGE')
   AND has_function_privilege('public', p.oid, 'EXECUTE') AND n.nspname NOT IN ('public', 'net')
   AND NOT (n.nspname = 'information_schema' AND p.oid < 16384 AND NOT p.prosecdef AND p.proowner = n.nspowner)
 ORDER BY 1, 2;
```
Diagnosticul da lista autoritara (aceeasi functie ca postconditia, in tranzactia reala); A-D sunt verificarea omului si se
pot rula oricand, fara `teren` si fara lock-uri.

### Propunere pentru viitor (doar text, fara cod acum)
1. **Postconditia sa spuna ce lipseste**: in `$critic$`, `v := public.fn_portal_porti_lipsa(); IF v <> '{}' THEN RAISE
   EXCEPTION 'PORTAL_POSTCONDITION_FAILED: % porti: %', cardinality(v), array_to_string(v, '; ')` (numele sunt obiecte de
   schema, fara date personale), la fel postconditia 1b. Schimba SHA-ul lui 18a (si 19a) => se face ODATA cu
   actualizarea listelor, in acelasi review, nu separat.
2. **Listele sa nu imbatraneasca intre review si aplicare**: (a) un script DOAR de citire `scripts/portal/verifica_porti_e1.sql`
   (interogarile A-D + sectiunile 0-2 din inventar, comparate cu literalii din migrare: cele 21 + md5, cele 12 + md5,
   cele 3 scheme), cu iesire „LISTE_LA_ZI” sau diferenta exacta; (b) `dry_prod_e1.sh` (si runnerul, pentru 18a / 19a) il
   ruleaza in conexiunea read-only de la pasul 3 si REFUZA sa trimita proba / livrarea daca listele nu mai corespund
   (fara lock-uri, fara `teren`); (c) paritate pe harness (L19): aceleasi cazuri stricate (relatie, secventa, schema,
   functie) date si diagnosticului si scriptului, cu acelasi rezultat; (d) regula de proces: orice migrare aplicata pe
   productie dupa review-ul listelor (aici 20261213a, 20261214a) => scriptul se reruleaza in ziua probei / aplicarii.

### Teste r19
- `scripts/portal/test_static_diag_porti.py` (fara BD, fara bash, 18 cazuri): taietura pe 18a real (CRLF si LF) si 5
  refuzuri (marcaj dublu / lipsa, fara `END $critic$;`, postconditie mutata, text dupa END); mesajul construit din textul
  REAL al runnerului (heredoc-urile 0_prolog / 1_pre / lm_fin) acceptat; verificatorul livrarii il refuza; mutanti
  refuzati cu motivul exact: COMMIT final / in bloc, inregistrare in istoric, taietura prea mare / lipsa / cu inlocuire,
  copie schimbata, bloc cu DELETE / EXECUTE / nerevizuit, octet schimbat dupa calcul.
- `scripts/portal/test_diag_porti.sh` (bash, fara conexiune): `--diagnostic-porti --doar-genereaza` => 40, verificatorii
  (diagnostic accepta, livrare refuza); modul normal neschimbat (invers); taietor stricat / bloc cu scriere intr-o copie a
  scripturilor => refuz 3 inainte de conexiune; dosar existent => 2.
- `scripts/test_portal_e1.sh` (PG17, inainte de aplicarea reala): tabel + secventa cu drept pentru PUBLIC => proba
  normala `PORTAL_POSTCONDITION_FAILED` (ca pe productie), diagnosticul numeste exact `relatie:diag_poarta_fixture` si
  `secventa:diag_poarta_fixture_seq` (+ detaliul), ROLLBACK, amprenta identica, istoricul neatins; dupa curatare: proba
  OK si diagnosticul 0 porti.

| Regula | Dovada r19 |
|---|---|
| L12 | Lista completa: numarul anuntat de server = liniile primite, numerotate 1..N; altfel cod 1 (nu „OK”); NULL = NECUNOSCUT. |
| L13 | Marcajele taieturii: octeti exacti, linie intreaga, exact o data (refuz altfel), fara regex pe SQL; teste pozitive + negative. |
| L14 | O tranzactie, un mesaj, ROLLBACK; fara COMMIT / inregistrare (verificat local inainte de conexiune); amprenta inainte = dupa. |
| L15 | Poarta neschimbata (aceeasi functie, aceleasi liste); diagnosticul doar o citeste. |
| L18 | Lista goala (0 porti) distincta de lista lipsa / incompleta / NULL; proba picata ramane cod 1. |
| L19 | Lista autoritara = un apel al functiei portii; detaliile (si A-D) sunt ajutor de citire, paritatea propusa la pct. 2c. |
| L25 | Verificatorul independent de taietor (stergere pura vs marcaje); textul real al runnerului; PG17 NOSUPERUSER cu poarta stricata real. |
| restul | n/a (unealta de diagnostic + teste + raport; fara schema, RPC, date sau drepturi noi). |

## E1-1a r20 — 12.11.2026 (cauza postconditiei 18a: doua tabele ale extensiei pg_net; citirile A-D reparate)

### Constatarea (citire pe productie, tranzactie READ ONLY, coordonatorul)
- A: exact `information_schema`, `net`, `public`, fara CREATE — in regula.
- B: doua relatii, ambele ale extensiei pg_net, proprietar `supabase_admin`: `net._http_response` si `net.http_request_queue`,
  cu toate drepturile pentru PUBLIC (acordate de `supabase_admin`). Rolul `teren` ajunge la ele prin PUBLIC => poarta
  intoarce `relatie:_http_response`, `relatie:http_request_queue` => `PORTAL_POSTCONDITION_FAILED`. Pe harness tabelele
  pg_net nu existau / nu aveau aceste drepturi, de aceea a trecut.
- C a picat (`... is not a sequence`: un index a ajuns la `has_sequence_privilege`, filtrul pe `relkind` din WHERE nu
  are ordine garantata), D nu a mai rulat; A picase intai pe `ORDER BY 1 COLLATE "C"` (literal intreg, nu pozitie).
  Probabil (de confirmat cu C reparat): si secventa cozii (`net.http_request_queue_id_seq`) are drept pentru PUBLIC,
  pentru ca `net.http_post` (INVOKER) scrie in coada cu drepturile apelantului.

### Ce s-a adaugat (SQL-ul celor 4 fisiere ale portalului NESCHIMBAT, SHA-urile raman)
- `scripts/portal/porti_citire.sql`: o tranzactie `BEGIN READ ONLY ... ROLLBACK`, doar catalog; A-D reparate (ordonare pe
  coloana; `has_*_privilege` doar in `CASE` pe `relkind`; semnaturi explicite) + E-L pentru decizie: proprietarul schemei
  `net` si al extensiei, cine poate retrage drepturi, drepturile pe fiecare obiect din `net` (beneficiar, acordant,
  `pg_init_privs`), amprenta de structura a obiectelor la care ajunge PUBLIC (pentru varianta c), functiile / joburile
  cron / triggerele care folosesc pg_net si ca ce rol ruleaza (fara corpuri si fara comenzi: doar adevarat / fals si
  nume), setarea PostgREST din baza, rolurile cu login. Iesirea: nume, roluri, drepturi, numere, md5-uri de structura.
  Rulare: `psql -X -v ON_ERROR_STOP=1 -f scripts/portal/porti_citire.sql`.
- `scripts/portal/test_static_porti_citire.py` (24 de cazuri): fara scrieri / DDL / control de tranzactie / functii cu
  efect / comenzi psql; nicio citire de randuri din tabele de date; `has_sequence_privilege` doar in `CASE WHEN
  c.relkind = 'S'`; nicio ordonare pe pozitie cu COLLATE; mutantii (inclusiv interogarile A si C din r19) refuzati.
- `scripts/portal/porti_citire_pglite.mjs`: rularea efectiva pe PostgreSQL in proces (PGlite, PG17) cu schema falsa in
  forma de pe productie (drepturile din B, indexul care a rupt C) — 29 de verificari, inclusiv controalele de mai jos.
- `scripts/test_portal_e1.sh`: pe clusterul PG17, cu portile stricate intentionat din r19, `porti_citire.sql` numeste
  EXACT aceleasi obiecte ca diagnosticul (B = `diag_poarta_fixture`, C = `diag_poarta_fixture_seq`, D = 0), nimic ramas.

### Variantele pentru cele doua tabele pg_net (decizia owner-ului; nimic aplicat)
Cum folosesc aplicatia pg_net (din repo; lista autoritara = sectiunile H / I / L ale scriptului, pe productie):
- joburi cron care apeleaza `net.http_post` direct, toate cu `username = postgres` (verificat in migrarile 20261015b /
  20261016a): `recycle_bin_cleanup_zilnic`, `rag_utilaj_process_queue`, `rag_utilaj_process_pending`, `redirect-mai-gov`,
  `reminder-rapoarte-zilnice`, `necesar-deschidere` / `-reminder` / `-inchidere`, `probleme-parc-reminder`,
  `upa-plafon-alerta`, `api_consum_extern_zilnic`, `normative_scan_continua`, `sms_sold_zilnic`,
  `polite_alerte_departamente` (+ `ofertare_rc_necitit`, programat in afara migrarilor, de confirmat cu I);
- functii SECURITY DEFINER (proprietar postgres) chemate de cron: `iot_cron_tick`, `iot_lumini_cron_tick`,
  `ofertare_ingest_tick` (citeste si coada si raspunsurile), `ofertare_extragere_tick` (citeste raspunsurile);
- triggere SECURITY DEFINER (proprietar postgres), pornite de scrieri ale utilizatorilor: `fn_detect_ordine_trigger`,
  `fn_ai_inbox_trigger_clasificare`;
- citiri manuale / rutina zilnica: `net._http_response` ca `postgres` (MCP, runbook-ul normative-scan);
- edge functions: niciuna nu atinge tabelele (doar comentarii); nicio functie INVOKER apelata de utilizatori nu foloseste
  `net.` (de confirmat cu H: `exec_authenticated` / `exec_anon` pe randurile cu `security_definer = false`).
Toate ruleaza deci ca `postgres` (sau ca workerul pg_net), iar `postgres` ajunge azi la cele doua tabele DOAR prin PUBLIC
(B: ACL-ul are numai `supabase_admin` si PUBLIC).

| | (a) REVOKE pe tabele FROM PUBLIC | (b) REVOKE USAGE pe schema net FROM PUBLIC | (c) poarta accepta explicit obiectele pg_net |
|---|---|---|---|
| Cine o poate face | Doar proprietarul (`supabase_admin`) sau cine are drept de redistribuire; dat de `postgres`, REVOKE-ul NU are efect (doar WARNING) — demonstrat pe PGlite; pe productie: E / F (`postgres_poate_retrage`). Practic: cerere la suportul Supabase. | La fel: cine a acordat USAGE lui PUBLIC (probabil `supabase_admin`, de confirmat cu E). | Noi, prin migrare (SHA nou + review). |
| Ce strica | Fara GRANT-uri explicite inainte: TOATE apelurile pg_net ale lui `postgres` (joburile, tick-urile, triggerele de mai sus). Minimul pentru `http_post`: INSERT + SELECT(id) pe coada (`RETURNING id`) + USAGE pe secventa — doar INSERT nu ajunge (demonstrat); SELECT pe raspunsuri pentru tick-uri si citirile manuale; acelasi lucru pentru `supabase_functions_admin` / `service_role` daca le folosesc. | Doar rolurile fara USAGE explicit pe `net` (E arata cine il are; platforma il da la crearea extensiei lui postgres, anon, authenticated, service_role, supabase_functions_admin). Mai putin riscant decat (a), daca E confirma granturile explicite. | Nimic in aplicatie. |
| Rezista la actualizarea pg_net? | Nu e garantat: daca drepturile vin din scriptul extensiei (F: `drepturi_initiale_extensie`), o actualizare le poate pune la loc => poarta ar inrosi din nou (fail-closed, nu o gaura). | La fel (evenimentul platformei la crearea extensiei + scripturile de actualizare). | Amprenta fixata inrosește poarta la orice schimbare (fail-closed); se re-amprenteaza prin review. |
| Ce se schimba in 18a / 19a | Nimic (SHA-urile raman); doar rerulare `porti_citire.sql` + proba. | 18a: schemele asteptate devin `information_schema`, `public` => SHA nou; 19a neschimbat. | 18a: lista revizuita a obiectelor pg_net (vezi mai jos) => SHA nou; 19a: semnatura functiei noi in `fn_portal_1b_snapshot` => SHA nou. Review nou pe ambele. |
| Ce decide owner-ul | Daca deschide cererea la Supabase si fereastra de GRANT-uri. | La fel + lista rolurilor cu USAGE explicit. | Daca accepta ca `teren` sa ramana, fata de pg_net, exact ca anon / authenticated azi. |
| Risc operational | Mare (toate joburile pe un singur pas facut de altcineva; revenire posibila la actualizari). | Mediu. | Mic. |

Ce ar urma ca cod pentru (c), dupa decizie (NU e facut in r20):
- 18a: functie noua `public.fn_portal_net_rel_md5()` cu literalii revizuiti din sectiunea G (cheia = `net.<relatie>`,
  valoarea = md5-ul amprentei: tip, proprietar, ACL, RLS, coloane), completata din citirea pe productie, NU invatata la
  apply (ca `fn_portal_net_md5`); in `$public_pre$`: setul obiectelor din `net` la care ajunge PUBLIC = exact cheile
  (ambele directii), fiecare membru al extensiei pg_net, amprenta identica, altfel `PORTAL_NET_BASELINE_UNREVIEWED_OR_CHANGED`;
  in `fn_portal_porti_lipsa()`: `relatie:` / `secventa:` sar DOAR peste obiectele din `net` cu amprenta identica cu
  literalul (orice drept in plus, coloana noua, alt proprietar, alt obiect = poarta ramane rosie).
- 19a: `fn_portal_net_rel_md5()` in lista din `fn_portal_1b_snapshot`.
- Harness: tabelele pg_net in forma de pe productie (proprietar `supabase_admin`, drepturile din B, membre ale extensiei);
  mutanti: drept in plus pentru anon, coloana noua, obiect nou in `net` cu drept pentru PUBLIC, obiect nemembru al
  extensiei => poarta rosie; paritate `porti_citire.sql` (B / C / G) = poarta.

**Recomandarea: (c)**, cu amprenta fixata — este singura in puterea noastra, nu atinge joburile si ramane fail-closed la
actualizarile platformei. Igiena (a) / (b) e o tema separata a intregii baze (nu doar a portalului), de discutat cu
suportul Supabase. Prima rerulare a `porti_citire.sql` decide detaliile (secventa cozii in C, cine poate retrage in E / F,
originea drepturilor in F).

### Teste r20
- `python3 scripts/portal/test_static_porti_citire.py` — 24 OK (fisierul real LF si CRLF, ASCII, 20 de mutanti refuzati
  cu motivul exact, literalii cu cuvinte interzise acceptati).
- `node scripts/portal/porti_citire_pglite.mjs` (dupa `npm install --no-save @electric-sql/pglite@0.3`) — 29 OK: forma
  veche A pica exact ca pe productie; A / B / C / D / D_numar / E-L corecte pe schema falsa; REVOKE de la ne-proprietar
  = WARNING, ACL neschimbat; dupa REVOKE de la proprietar B / C / G goale, dar `http_post` al unui rol obisnuit pica;
  doar INSERT + USAGE pe secventa nu ajunge; cu SELECT(id) merge.
- `scripts/test_portal_e1.sh` (PG17, ruleaza coordonatorul): cazul de paritate de mai sus.

| Regula | Dovada r20 |
|---|---|
| L12 | Fiecare sectiune apare exact o data (test static); lipsa unei sectiuni = refuz, nu „0 randuri”. |
| L13 | Predicatele pe text (corpuri, comenzi cron) doar ca adevarat / fals, cu `[.]` in loc de escape; test pozitiv + negativ pe PGlite (functie fara pg_net nu apare). |
| L14 | O tranzactie READ ONLY + ROLLBACK, fara scrieri (test static + harness: starea neschimbata). |
| L15 | Poarta neschimbata; propunerea (c) = amprenta pe structura + ACL, fixata inainte de apply, nu invatata. |
| L18 | `IS TRUE` / `IS FALSE` pe rezultatele CASE (NULL nu trece drept fals). |
| L19 | Paritate `porti_citire.sql` = diagnosticul portii pe acelasi cluster (B / C / D). |
| L25 | Expected din productie (B, mesajele de eroare), PG17 real in harness + PGlite; controale pe forma veche si pe REVOKE. |
| restul | n/a (script de citire + teste + raport; fara schema, RPC, date sau drepturi noi). |

## E1-1a/1b r21 — 12.11.2026 (varianta c pregatita ca DRAFT: poarta accepta cele trei obiecte pg_net doar cu amprenta din productie)

Decizia owner-ului intre (c) si cererea la suportul Supabase NU e luata; (c) e gata de review daca o alege. Cele doua nu se
exclud: daca suportul retrage drepturile PUBLIC, poarta ramane verde fara nicio schimbare (vezi „mai putin acces”).
**SHA-urile celor 4 fisiere se schimba** (18a, 19a, ambele reveniri) => review nou pe toate.

### Ce s-a schimbat
- **18a, lista unica**: `fn_portal_net_rel_aprobat()` (marcajul listei in corp) = `net._http_response`,
  `net.http_request_queue`, `net.http_request_queue_id_seq`, cu md5-urile citite pe productie (porti_citire.sql G, 12.11).
  Nu se invata la apply; se schimba doar prin review.
- **18a, definitia unica a amprentei (L19)**: `fn_portal_net_rel_amprenta(oid)` = exact expresia sectiunii G (tip,
  proprietar, ACL, RLS, FORCE RLS, coloane cu tip / NOT NULL / ACL), acelasi search_path (`pg_catalog, pg_temp`).
  Textul dintre marcajele `AMPRENTA_NET_REL` e identic in migrare si in porti_citire.sql (test static).
- **18a, predicatele comune**: `fn_portal_net_rel_acceptat(oid)` (in net + in lista + amprenta identica; lipsa = fals) si
  `fn_portal_teren_rel_drept(oid)` (orice drept al lui teren pe tabel / coloane / secventa). Poarta si preconditia le
  folosesc pe amandoua; bucla relatiilor din poarta nu mai calculeaza dreptul a doua oara.
- **Poarta**: un obiect din net trece DOAR daca e acceptat; orice drept nou (tabel, coloana, secventa), coloana noua, tip
  schimbat, alt proprietar, RLS pornit sau orice alt obiect din net la care `teren` are acces = `relatie:<nume>` /
  `secventa:<nume>`, ca pana acum (r22: corectat; un obiect nou din net fara niciun drept pentru `teren` nu e privit).
  Mai putin acces (PUBLIC retras de proprietar) = obiectul nu mai e accesibil, poarta nu-l mai priveste (verde).
  Nou: `teren PostgREST expune net` daca setarile PostgREST scrise IN baza (rolul authenticator) contin net.
- **Preconditia `$public_pre$`**: forma listei (`PORTAL_NET_REL_LIST_INVALID`); orice obiect din net accesibil lui teren
  si neacceptat = `PORTAL_NET_REL_UNREVIEWED_OR_CHANGED: <obiectele>`, refuz atomic; NOTICE `PORTAL_NET_REL: n obiecte
  pg_net accesibile prin PUBLIC, toate cu amprenta revizuita (3 in lista)`.
- **Postconditiile spun ce lipseste**: `PORTAL_POSTCONDITION_FAILED: <n> porti: <lista>` (18a) si
  `PORTAL_1B_POSTCONDITION: <n> porti: <lista>` (19a); comparatia e `IS DISTINCT FROM` (o poarta NULL nu mai trece).
  Revenirile: `PORTAL_ROLLBACK_NEW_DATA_OR_CONFIG: amprenta <identica|schimbata fata de apply>; porti: <lista>` (la fel
  1b), `PORTAL_1B_ROLLBACK_POSTCONDITION: porti 18a: <lista>`. Doar nume de obiecte de schema, fara date.
- **Revenirea 18a**: amprenta DDL si stergerile includ cei 4 helperi. **19a**: `fn_portal_1b_snapshot` ii amprenteaza.
- **porti_citire.sql**: G cu marcajele definitiei unice; sectiune noua M (ce functii poate rula teren: schema, semnatura,
  DEFINER, functie de trigger, cuvantul EXECUTE in corp, apel pg_net; doar adevarat / fals, fara corpuri).
- **dry_prod_e1.sh**: la proba picata, lista din mesajul postconditiei in `porti_postconditie.txt` (o poarta pe linie);
  NOTICE-ul `PORTAL_NET_REL` la timpi. **scheme_expuse.sh** (nou): schemele expuse de API, citite din raspunsul API-ului.
- **Diagnosticul r19** (`diag_porti_taie.py`, verificatorul mesajului, testele lui): adaptate la postconditia pe doua linii.
- **Harness**: scheletul are tabelele pg_net in forma productiei (proprietar supabase_admin, toate drepturile pentru
  PUBLIC), deci harness-ul nu mai trece pe o stare mai curata decat cea reala; amprentele lor = exact lista de productie
  (verificat prin G), deci copia de harness NU inlocuieste lista.

### Ce poate face rolul `teren` cu pg_net (raspunsul cerut, probat)
1. **La nivel SQL, da**: prin drepturile PUBLIC de pe productie, `teren` ar putea apela cele 12 functii `net.*`
   (inclusiv `http_get` / `http_post` / `http_delete`: cereri HTTP trimise de baza), ar putea scrie direct in coada si
   ar putea citi coada si raspunsurile tuturor apelurilor pg_net. Probat: PGlite (`net_rel_pglite.mjs`: inserare in coada
   si citirea raspunsurilor ca `teren`) si harness-ul PG17 (aceeasi proba, tranzactie anulata). Poarta NU poate inchide
   asta: drepturile sunt ale lui `supabase_admin`, iar un REVOKE dat de `postgres` nu are efect (r20).
2. **Ce il opreste azi** (toate trei trebuie sa ramana adevarate; primele doua le impune poarta, a treia scriptul):
   - `teren` nu se poate loga (NOLOGIN, membru in nimic, NOINHERIT; poarta: `teren atribute` / `teren membership`);
   - functiile pe care le poate rula = exact cele 21 din public + cele 12 din net, cu corpul / DEFINER / ACL fixate prin
     md5 (orice functie noua = `functie:<semnatura>`); singura DEFINER e o functie de trigger (nu se poate apela direct);
     porti_citire.sql M (de rulat pe productie) arata, fara corpuri, daca vreuna are SQL dinamic (asteptat: niciuna din public);
   - API-ul REST (singura cale a lui `teren` spre baza) cheama doar tabele / functii din schemele expuse; `net` nu are
     voie sa fie expusa. Din baza se vede doar configurarea scrisa in baza (poarta + porti_citire.sql J; pe productie J =
     0 randuri); configurarea proiectului se citeste din raspunsul API-ului cu `scripts/portal/scheme_expuse.sh` (cod 1 daca
     net e expusa, 2 = necunoscut), la fiecare proba / livrare 18a-19a.
3. **Inchiderea completa** = drepturile PUBLIC retrase de proprietar (cererea catre suport, in raportul intern r21).
   Daca se intampla, poarta ramane verde (mai putin acces), iar lista din 18a poate fi golita intr-o migrare ulterioara.

### Teste r21
- `python3 scripts/portal/test_static_net_rel.py` — 12 OK: definitia unica (text identic + search_path), lista unica cu
  valorile productiei (expected din jurnalul citirii), aceleasi predicate in poarta si preconditie, helperii peste tot
  (verificarea „exista”, amprenta DDL 18a = revenire 18a, stergeri, lista 1b, harness), postconditii cu lista si
  `IS DISTINCT FROM`; 11 mutanti refuzati cu motivul exact.
- `node scripts/portal/net_rel_pglite.mjs` (PGlite PG17, `npm install --no-save @electric-sql/pglite@0.3`) — 24 OK: schema
  falsa in forma productiei da EXACT md5-urile productiei; paritate G = helperul; 9 mutanti (drept pe tabel / coloana /
  secventa, coloana noua, tip schimbat, alt proprietar, RLS, obiect nou, PUBLIC retras); `teren` la nivel SQL; conditia
  PostgREST pe 5 cazuri (inclusiv `network`, fara potrivire pe subsir).
- Restul statice: `test_static.py` 8, `test_static_1b.py` 12, `test_static_r2.py` 2, `test_static_diag_porti.py` 18,
  `test_static_porti_citire.py` 24, `scripts/test_livrare_validator_plafon.py` PASS; `porti_citire_pglite.mjs` 29 OK.
- Test de fum local (PGlite, o sesiune, fixture-ul harness-ului, postgres NOSUPERUSER; nu e in repo): 18a cu drept in plus /
  obiect nou in net = refuz care le numeste; poarta stricata = `PORTAL_POSTCONDITION_FAILED: 2 porti: relatie:...;
  secventa:...`; apply 18a, poarta verde, 6 abateri dupa apply = rosu cu numele lor, reparate = verde; testele 1a; 19a
  (copia cu ancorele clusterului) + testele 1b; revenirile 19a si 18a refuzate cu mesajul nou, apoi reale. Concurenta,
  plafonul si traficul raman la harness-ul PG17.
- Harness PG17 (`scripts/test_portal_e1.sh`, coordonatorul): refuzurile `PORTAL_NET_REL_UNREVIEWED_OR_CHANGED` inainte de
  apply; mesajul postconditiei si `porti_postconditie.txt` cu exact cele doua porti; porti_citire.sql B / C cu obiectele
  pg_net, G = md5-urile productiei, M = 33; dupa apply 6 abateri rosii + refacute verzi, PUBLIC retras verde; `teren` la
  nivel SQL; „functii ramase” cu cei 4 helperi.
- **Nerulate de mine**: harness-ul PG17, `bash -n`, `scheme_expuse.sh --test` (bash cere aprobare pe acest server).

| Regula | Dovada r21 |
|---|---|
| L07 | Regula de acces in BD: poarta + preconditia (fara cai ocolitoare); `teren` fara cale de SQL, verificata pe trei niveluri. |
| L12 | Lista portilor completa in mesaj; obiect accesibil dar neacceptat = refuz numit; necunoscut (NULL) = `NECUNOSCUT`, nu „0”. |
| L13 | Chei `^net[.][a-z_][a-z0-9_]*$`, md5 `^[0-9a-f]{32}$`; LIKE fara backslash (`_` mai larg = mai strict); test `network`. |
| L14 | O tranzactie; preconditie inainte de orice obiect; reveniri cu lock inaintea verificarii, refuz cu motiv; fum apply -> revenire. |
| L15 | Amprenta pe structura + proprietar + ACL (si pe coloane), fixata inainte de apply din productie, nu invatata; enumerare din catalog, fara regex pe SQL. |
| L18 | `IS DISTINCT FROM` la toate postconditiile / refuzurile; `IS TRUE` / `IS NOT TRUE` pe predicate; cheie lipsa = fals. |
| L19 | O definitie a amprentei (text identic, test static + paritate PGlite), un predicat de acces si unul de acceptare, folosite si de poarta si de preconditie. |
| L20 | Cai legitime: forma productiei verde, PUBLIC retras verde, coloana stearsa verde, revenire dupa reparare. |
| L25 | Expected din jurnalul productiei; fixture cu aceleasi drepturi ca productia (PUBLIC inclus); NOSUPERUSER; PG17 real la harness. |
| restul | n/a (fara cozi, bani, AI, UI; L01 / L06 neschimbate: nicio ordine noua de lock). |

## E1-1a/1b r22 — 12.11.2026 (review r21: merge NO-GO, proba cu ROLLBACK GO cu conditii, aplicarea NO-GO: 2 x P1, 1 x P2)

**18a se schimba (SHA nou)**; 19a si revenirile neschimbate. Lista obiectelor pg_net din 18a e acum **DE_COMPLETAT**:
pana cand coordonatorul reciteste G pe productie si lipeste cele trei valori, 18a refuza atomic
(`PORTAL_NET_REL_LIST_NECOMPLETATA`), deci si proba cu ROLLBACK refuza. Ordinea pasilor: la sfarsitul sectiunii.

### P1 — amprenta pg_net acoperea doar drepturi / structura
- `fn_portal_net_rel_amprenta` (18a) = sectiunea G din `porti_citire.sql` (acelasi text, test static) contine acum, pe
  langa tip / proprietar / ACL / RLS / FORCE / coloane: **DEFAULT**, IDENTITY si GENERATED pe fiecare coloana;
  **triggerele** (definitia completa cu evenimente si WHEN, starea `tgenabled`, md5 al definitiei functiei); **politicile**
  (comanda, permisiva, rolurile pe nume, USING, WITH CHECK); **regulile**; **constrangerile** (si FK-urile care trimit spre
  obiect); **indecsii**; pentru **secventa** parametrii (tip, start, pas, min / max, cache, ciclu; fara valoarea curenta) si
  coloana care o detine (OWNED BY / identity); plus, pentru orice functie de aplicatie de care depind triggerele / politicile
  / DEFAULT-urile / CHECK-urile / indecsii / regulile (pg_depend): semnatura, DEFINER, proprietarul, configuratia si md5-ul
  definitiei. Nu contine OID-uri (nume peste tot), deci e aceeasi pe un cluster nou cu aceeasi schema.
- Valorile din 12.11 (forma r21) nu mai sunt valabile; testul static refuza orice valoare r21 ramasa in 18a.
  `scripts/portal/net_rel_completeaza.py` citeste iesirea `psql -At -F '|'` a lui `porti_citire.sql`, refuza daca G nu are
  EXACT cele trei obiecte sau daca un md5 nu corespunde textului de pe aceeasi linie, si scrie ACELEASI valori in 18a si in
  testul static (`PROD_R22`); tipareste SHA-ul nou al lui 18a.
- Harness-ul PG17 citeste G pe clusterul efemer inainte de apply (acelasi script, `--json`) si pune valorile in copia 18a.

### P1 — lipsa unei cai indirecte spre pg_net: auditul tranzitiv (porti_citire.sql, sectiunea N)
Doar catalog, in aceeasi tranzactie READ ONLY, fara corpuri in iesire. Radacini: functiile pe care le poate rula `teren`
(prin PUBLIC; pe productie cele 21 din public + 12 din net), `fn_teren_eligibil` / `fn_portal_uid` daca exista, si
relatiile pe care `teren` le poate scrie. Muchii (supra-aproximare: in plus, niciodata in minus):
functie -> functie pentru fiecare nume urmat de `(` din corp (calificat sau rezolvat cu search_path-ul functiei +
pg_catalog; search_path mostenit = toate schemele; toate supraincarcarile), corpurile BEGIN ATOMIC prin pg_depend;
functie -> relatie pentru orice cuvant egal cu numele unei relatii din schemele caii (sau dintr-o schema numita in corp);
relatie -> functie prin triggere, politici, DEFAULT, CHECK, indecsi, reguli; vedere -> tabelele citite; FK; mostenire.
Limita de adancime declarata: 8. Iesire: `N_audit_rezumat` (13 numere), `N_audit_nod` (fiecare functie / relatie atinsa:
adancime, DEFINER / INVOKER, proprietar, limbaj, search_path fixat / MOSTENIT, daca apeleaza net, ce obiect din net atinge,
SQL dinamic, primeste text, executa text primit, distanta pana la net), `N_audit_cale` (o cale martor pentru FIECARE
radacina din afara net care ajunge la net), `N_audit_nerezolvat` (SQL dinamic, corp opac, executor de text din nucleu,
adancime depasita), `N_audit_necunoscut` (nume urmat de `(` fara functie: de regula text din mesaje).
Asteptat pe productie: `cai_spre_net = 0` si 0 nerezolvate — sau listele lor, pe care le revizuim.

**Ce dovedeste** (la momentul citirii): daca `N_audit_cale` si `N_audit_nerezolvat` sunt goale, din nicio functie pe care
o poate rula `teren` si din nicio relatie pe care o poate scrie nu exista, pe muchiile de mai sus, pana la 8 pasi, un drum
spre o functie sau o relatie din schema net (net.http_*, coada, raspunsurile, secventa).
**Ce NU dovedeste**: (1) apeluri prin operatori / cast-uri / functiile de I/O ale tipurilor, triggere de eveniment,
functiile de suport ale agregatelor (nu sunt muchii in graf); (2) ce fac functiile din pg_catalog (capete de incredere),
in afara executorilor de text listati; (3) interiorul functiilor C / internal din afara pg_catalog (apar ca NEREZOLVAT);
(4) obiecte temporare care ar umbri la rulare un nume de relatie necalificat intr-o functie cu search_path mostenit
(`teren` nu poate crea obiecte temporare fara SQL, dar auditul nu o dovedeste); (5) **nimic dupa momentul citirii**:
poarta din 18a fixeaza prin md5 functiile pe care le poate rula `teren` (orice functie noua executabila = rosu), dar NU
calee-urile unei functii DEFINER sau functiile triggerelor de pe tabele pe care `teren` nu le scrie; o schimbare acolo se
vede doar la urmatoarea rulare a auditului (propunerea de verificare periodica, mai jos).
Proba pe PGlite (`audit_tranzitiv_pglite.mjs`, 16 cazuri): lant pe 3 niveluri pana la un DEFINER (calea exacta), apel
necalificat prin search_path cu net, search_path mostenit, citirea raspunsurilor, scriere intr-un tabel cu trigger spre
pg_net, tabel scriibil de PUBLIC cu trigger, vedere peste raspunsuri, BEGIN ATOMIC, SQL dinamic cu text de la apelant,
`EXECUTE format(...)` cu numele construit, `query_to_xml`, limbaj internal, lant de 10 (adancime depasita), nume
inexistent, nume pg_net doar in comentariu (raportat). Cazul curat (cuvinte SQL urmate de `(`, apel intre doua functii
public): 0 / 0 / 0. Un mutant al auditului (fara muchiile de apel) pica 10 verificari. Volum: 1.500 de functii + 400 de
tabele = ~35 s pe PGlite (mai lent decat serverul); sectiunea are plafonul ei de 120 s.

**Corecturi la r21** (din verdict): sectiunea H pe productie are **10 functii `public` + 1 din `extensions`**
(`extensions.grant_pg_net_access()`), nu 11 din public; „orice al patrulea obiect = rosu” corect este „orice obiect din
net la care `teren` are acces = rosu” (un obiect nou din net fara niciun drept pentru `teren` nu e privit).

### P2 — verificarea „net nu e expusa prin API” devine blocanta
- `scheme_expuse.sh --tinta-host <host> --user <utilizator>`: API-ul intrebat trebuie sa fie AL bazei tinta — referinta
  proiectului (20 de caractere) din utilizatorul pooler-ului (`postgres.<ref>`) sau din host-ul direct (`db.<ref>.supabase.co`)
  => `SUPABASE_URL` exact `https://<ref>.supabase.co`; fara referinta (cluster local de proba) doar `http://127.0.0.1:<port>`;
  altfel cod 3. Referinta si cheia nu se tiparesc.
- `dry_prod_e1.sh`: `--api-url` obligatoriu + cheia publica in `SUPABASE_ANON_KEY`; primul pas dupa argumente, inainte de
  orice conexiune: cod 1 (net expusa) / 2 (necunoscut) / 3 (nelegat) = **refuz 23**, nimic trimis. Fara optiune de a-l sari
  (doar `--doar-genereaza`, care nu se conecteaza nicaieri).
- `scripts/portal/livrare_e1.sh` (pasul de pre-livrare 18a / 19a si revenirile lor): aceeasi verificare, apoi `exec`
  runnerul oficial cu EXACT argumentele primite; API rosu / necunoscut = 23, runnerul nu porneste; alta migrare = 2.
- Harness: API-uri REST false doar pe 127.0.0.1 (`api_sonda_stub.py`): dry_prod 23 cu net expusa / raspuns necunoscut si 2
  fara `--api-url` (fara conexiune, fara jurnal); `livrare_e1.sh` 23 cu net expusa (nimic aplicat), 40 cu API verde +
  `--genereaza-in` (argumentele ajung neschimbate la runner), 2 pe alta migrare.
- **Ramane neacoperit**: (1) runnerul pornit direct, fara `livrare_e1.sh` (regula de lucru: 18a / 19a doar prin el);
  (2) cineva expune `net` din panoul proiectului DUPA livrare — baza nu vede configurarea panoului.
  **Propunere pentru rutina zilnica (doar text, rutina neschimbata)**: „Portal: `scheme_expuse.sh --tinta-host <host>
  --user <utilizator>` (cheia publica) + `SELECT public.fn_portal_porti_lipsa()` + `porti_citire.sql` N; orice cod ≠ 0,
  poarta ≠ `{}` sau `cai_spre_net` / `nerezolvate` ≠ 0 = mesaj catre Razvan, fara nicio actiune automata.”

### Pentru coordonator (ordinea; nimic din ele nu scrie in productie)
1. Harness PG17: `PORTAL_PG_BIN=<binare PG17> PORTAL_TMP_BAZA=<dosar de lucru> bash scripts/portal/harness_win.sh 0`
   (sau `bash scripts/test_portal_e1.sh` pe Linux / WSL, ca postgres). Plus local: `bash scripts/portal/scheme_expuse.sh
   --test`, `bash scripts/portal/test_diag_porti.sh`.
2. Productie, doar citire: `psql -X -At -F '|' -v ON_ERROR_STOP=1 -f scripts/portal/porti_citire.sql <conexiunea> >
   porti_citire_prod.out` (formatul `-At -F '|'` il cere scriptul de la pasul 3). De trimis la review: liniile `G_*` si
   `N_audit_*` (fara corpuri; doar nume, numere, md5).
3. `python3 scripts/portal/net_rel_completeaza.py porti_citire_prod.out` (verificare), apoi `... --scrie` => commit
   fast-forward pe branch, SHA-ul nou al lui 18a tiparit de script.
4. `SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<cheia publica> bash scripts/portal/scheme_expuse.sh
   --tinta-host <host> --user <utilizator>` — asteptat cod 0 (`scheme expuse: public,graphql_public`).
5. Proba cu ROLLBACK, intai doar 18a: `SUPABASE_ANON_KEY=<cheia publica> PSQL_BIN=<psql> bash scripts/portal/dry_prod_e1.sh
   --tinta-host <host> --tinta-port <port> --tinta-db postgres --tinta-sistem <system_identifier> --user <utilizator>
   --api-url https://<ref>.supabase.co --doar-18a --jurnal <dosar nou>`; apoi aceeasi comanda fara `--doar-18a`.
6. Aplicarea (dupa GO + „da”): `bash scripts/portal/livrare_e1.sh --api-url https://<ref>.supabase.co -- <argumentele
   runnerului, ca pana acum, cu --plafon-tranzactie-ms 2000>`.

### Teste r22
- `python3 scripts/portal/test_static_net_rel.py` — 24 OK: definitia unica (si fara politici doar intr-unul = refuz),
  lista DE_COMPLETAT / completata = PROD_R22 / pe jumatate / cu valori r21 / cheie in plus, refuzul NECOMPLETATA in
  `$public_pre$`, amprenta are triggere / politici / DEFAULT-uri / secventa (mutant r21 refuzat); `net_rel_completeaza.py`:
  trei obiecte cu CRLF si `||` in text, al patrulea obiect, obiect lipsa, md5 care nu corespunde.
- `python3 scripts/portal/test_static_porti_citire.py` — 27 OK (sectiunile N, corpul citit doar prin cele doua expresii ale
  grafului, plafonul propriu al lui N). `test_static.py` 9 (nou: copia de fixture cu `--net-rel`), `test_static_1b.py` 12, `test_static_r2.py` 2,
  `test_static_diag_porti.py` 18 OK; validatorul livrarii pe 18a OK (si cu `--plafon-tranzactie`).
- `node scripts/portal/net_rel_pglite.mjs` — 40 OK: amprenta noua ≠ r21; lista DE_COMPLETAT = toate respinse; paritate G =
  helperul; cu lista din G: 9 mutanti r21 + trigger nou, politica noua, DEFAULT schimbat / nou, regula noua, index nou, CHECK
  cu functie, OWNED BY NONE, alt pas = RESPINS; setval (valoarea secventei) = acceptat; trigger revizuit: corp schimbat /
  dezactivat = RESPINS, refacut = acceptat.
- `node scripts/portal/audit_tranzitiv_pglite.mjs` — 16 cazuri OK; `node scripts/portal/porti_citire_pglite.mjs` — 29 OK.
- `npx vitest run`: 219 fisiere OK, 1 pica local (`scripts/noduri_cuplare_import_sql.test.js`: „Invalid or unexpected
  token”, cauza cunoscuta shebang + CRLF la checkout pe Windows; fisier neatins de PR); `npx vite build` OK.
- **Nerulate de mine**: harness-ul PG17, `scheme_expuse.sh --test`, `test_diag_porti.sh`, testele API din harness (bash cere
  aprobare pe acest server).

| Regula | Dovada r22 |
|---|---|
| L07 | Poarta + preconditia in BD; API-ul verificat blocant inainte de proba / livrare; ce ramane in afara (runner direct, panou) scris. |
| L12 | Nimic tacut: nerezolvat / necunoscut listate, nu ignorate; lista pg_net necompletata = refuz numit; G cu alt numar de obiecte = refuz. |
| L13 | Expresiile grafului fixate (lista alba in testul static); chei / md5 ancorate; legarea API cu `^...$`; caz `subdomeniu_fals`. |
| L15 | Amprenta pe triggere (tgfoid prin definitie + md5, tgenabled, WHEN), politici (qual / with check), DEFAULT, secventa, functii dependente; audit tranzitiv din catalog, SQL dinamic / search_path mostenit marcate; lanturi de 2-3 niveluri testate. |
| L18 | Cod API 2 (necunoscut) = refuz ca 1; `IS DISTINCT FROM` neschimbat; `lnet` NULL -> fals explicit (coalesce). |
| L19 | O definitie a amprentei (18a = G, test static + paritate PGlite + harness); acelasi script de citire G pe productie si in harness. |
| L20 | Cai legitime: setval acceptat, trigger revizuit acceptat, PUBLIC retras verde, API verde -> runnerul primeste exact argumentele. |
| L25 | Expected din constructia cazului (drumul exact), mutanti pe fiecare clasa (inclusiv auditul stricat), PG17 la harness, NOSUPERUSER. |
| restul | n/a (L01-L06, L08-L11, L16, L17, L21-L24: fara cozi, identitate noua, bani, AI, UI; ordinea lock-urilor neschimbata). |

## E1-1a r23 — 12.11.2026 (auditul tranzitiv pe productie: 1 cale, 38 nerezolvate, adancimea 8 atinsa => varianta d + auditul precis)

**18a si revenirea 18a se schimba (SHA nou)**; 19a si revenirea 19a neschimbate. Lista obiectelor pg_net ramane
**DE_COMPLETAT** (amprentele G se lipesc dupa forma finala a lui 18a, pasul 3 de mai jos). Nimic aplicat, nicio BD.

### Ce am ales si de ce
Amandoua, pentru ca impreuna se pot DOVEDI: **(d)** micsoreaza suprafata (teren executa in `public` doar
`fn_teren_eligibil` si `fn_portal_uid`, ambele DEFINER, care doar citesc patru tabele), iar **auditul precis** arata
asta din catalog, cu muchii doar acolo unde PostgreSQL chiar executa ceva. Cu (d) aplicat, dovada nu mai depinde de
cele 618 functii atinse de modelul r22: radacinile din `public` sunt doua, iar drumul lor e scurt si revizuibil de un om.

### Cele 21 de functii: clasificarea (din productie, porti_citire.sql M, 12.11)
- **18 functii de TRIGGER** (intorc `trigger`): `auto_cost_from_tichet`, `auto_flag_agabaritic`, `check_alerta_consum`,
  `fn_contracte_linii_updated_at`, `fn_executie_touch_updated_at`, `fn_trg_categorie_cantitate` (singura DEFINER),
  `gen_numar_transport`, `hr_recrutare_touch_updated_at`, `notify_tichet_opener_on_resolve`, `set_updated_at`,
  `tg_active_lipsa_fisa`, `tg_hr_employees_private_touch`, `tg_lsf_touch_updated`, `update_hr_semnaturi_modificat_la`,
  `update_modificat_la_hr_docp`, `update_modificat_la_ord_setari`, `update_stoc_achizitie`, `update_stoc_rezervor`.
  Nu se pot apela direct („trigger functions can only be called as triggers”, si pentru proprietar), iar la declansare
  PostgreSQL NU verifica EXECUTE => **niciun GRANT**. Probat pe PG17 (PGlite) cu textul real din 18a: dupa REVOKE,
  `set_updated_at` ruleaza la UPDATE facut de `authenticated`; apelul direct = eroare 0A000.
- **3 apelabile**: `get_istoric_importuri_evogps()` = RPC din UI (`src/Logistica.jsx`, apelat ca `authenticated`);
  `fn_claude_context_cleanup()` si `fn_notif_lipsa_fisa_service(bigint)` = fara apelant in repo si fara job cron care sa
  le numeasca cu prefixul `public.` (sectiunea I); `fn_notif_lipsa_fisa_service` are forma unui ajutor apelat dintr-un
  trigger (de ex. `tg_active_lipsa_fisa`), deci rolul care scrie tabelul are nevoie de EXECUTE pe ea.
  **GRANT EXECUTE catre `authenticated` si `service_role`** (rolurile prin care le apeleaza azi aplicatia, API-ul si
  functiile edge), ca nimic sa nu se strice; `anon` nu (nicio cale fara login). Apelantii reali din baza se citesc
  inainte de apply cu `scripts/portal/public21_apelanti.sql` (mai jos); daca nu apare niciun apelant, lista de GRANT se
  poate restrange intr-o migrare ulterioara.

### Ce face 18a (varianta d), in ordine (toate inainte de `$locks$`, fara tabele de aplicatie)
1. `$public_pre$` (neschimbat): setul de functii cu PUBLIC = exact cele 21 revizuite, corpurile = md5-urile revizuite.
2. Clasificarea `PORTAL_PUBLIC_CLASIFICARE` (tabel temporar): 21 de randuri = lista alba; `$public_d_pre$` verifica pe
   catalog ca exact cele cu granturi goale intorc `trigger`, proprietarul e `postgres`, rolurile sunt doar
   `authenticated` / `service_role` (altfel `PORTAL_PUBLIC_CLASIFICARE_INVALIDA` / `_SCHIMBATA: <functia>`, nimic
   schimbat) si noteaza GRANT-urile care lipsesc azi (rolul nu are EXECUTE explicit). Fara SQL dinamic (regula bugetului
   de lock: nimic neanalizabil inainte de `$locks$`).
3. GRANT static pe cele 3 catre `authenticated, service_role`; REVOKE static `... FROM PUBLIC` pe toate 21 (testul static
   compara ambele liste cu clasificarea).
4. `$public_d_post$`: niciuna din 21 cu PUBLIC, `teren` nu executa niciuna, rolurile cu GRANT le pot executa, iar in
   `public` `teren` executa DOAR cele doua functii ale portalului; altfel `PORTAL_PUBLIC_D_POSTCONDITIE: <lista>`.
   NOTICE: `PORTAL_PUBLIC_D: 21 functii fara PUBLIC (18 de trigger, 3 apelabile); GRANT-uri adaugate: <n>`.
5. Baseline-ul (L15) primeste amprenta celor 21 DUPA (d) (corp, DEFINER, proprietar, configuratie, ACL) + randul
   `grant_d:` cu GRANT-urile adaugate (pentru revenire). Poarta: in `public`, orice functie executabila de `teren` in
   afara celor doua = `functie:<semnatura>`, chiar daca e in baseline; orice schimbare de ACL / corp pe cele 21 =
   `amprenta:<semnatura>`.

**Revenirea 18a**: inaintea stergerii baseline-ului retrage EXACT GRANT-urile din `grant_d:` si reda `GRANT EXECUTE ...
TO PUBLIC` pe lista alba => drepturile celor 21 = cele dinainte de 18a (ca multime pe fiecare functie; probat: drepturi
implicite si drepturi explicite deja existente pentru anon / authenticated / service_role, apoi re-aplicare).

### Riscuri si cum le verificam INAINTE, doar prin citire
- **Ce se poate strica**: un rol care apeleaza azi una din cele 3 DOAR prin PUBLIC si nu e `authenticated` /
  `service_role` (de ex. un rol intern al platformei, un job cron care ruleaza ca alt rol, un trigger INVOKER declansat de
  scrierile altui rol) ar primi `42501 permission denied`. Functiile de trigger nu au acest risc. `postgres` (cron, MCP)
  e proprietarul, deci nu pierde nimic.
- **De ce `pg_stat_user_functions` nu ajunge**: numara doar cu `track_functions` pornit (implicit `none`), nu spune
  ROLUL apelantului, se reseteaza odata cu statisticile si nu vede functiile SQL inlinate. Lipsa unui numar nu inseamna
  „nefolosita”.
- **Ce citim in plus** (nimic nu scrie, fara corpuri / comenzi / texte afisate):
  1. `scripts/portal/public21_apelanti.sql`: `P_clasificare` (trigger, DEFINER, triggerele si tabelele lor, drepturile
     explicite anon / authenticated / service_role), `P_apelanti_corp` (functiile care le apeleaza din SQL, DEFINER sau
     de trigger, pe ce tabele), `P_dependente` (politici, DEFAULT-uri, vederi), `P_cron` (joburile care le numesc, cu
     sau fara prefix, si rolul lor), **`P_pierde`** (rolurile care se pot loga + rolurile API care le pot executa azi DOAR
     prin PUBLIC = exact cine ar pierde dreptul), `P_statistici`.
  2. `scripts/portal/public21_apelanti_pss.sql` (daca exista pg_stat_statements): rolul care a rulat instructiuni ce le
     numesc (doar rol / functie / numar; cu `track = top` se vad doar instructiunile de nivel superior).
  3. Jurnalele API din panoul proiectului (cererile `rpc/<nume>` din ultimele zile) si codul functiilor edge publicate
     (nu toate sunt in repo).
  Regula: daca `P_pierde` are un rol in afara de `teren` pe una din cele 3, iar 1-3 arata ca il foloseste, se adauga in
  clasificare inainte de apply (schimbare de 18a, review nou).
- **Revenirea**: aceeasi tranzactie de revenire reda PUBLIC (vezi mai sus); un GRANT uitat dupa apply se repara si fara
  revenire (`GRANT EXECUTE ... TO <rol>`), dar poarta il vede (`amprenta:`) => se face prin migrare revizuita.
- **L15**: drepturile celor 21 raman in baseline (amprenta cu ACL de dupa d); orice GRANT / REVOKE ulterior pe ele = rosu.

### Auditul precis (porti_citire.sql N, rescrisa)
- **Starea** = (obiect, rolul efectiv, operatia pe relatie). Rolul de pornire: `teren` (dupa 18a) sau PUBLIC (inainte).
  Intrarea intr-o functie DEFINER schimba rolul in proprietar; triggerul ruleaza cu rolul care scrie (sau proprietarul,
  daca e DEFINER); actiunea RI a unui FK ruleaza ca proprietarul copilului; vederea, ca proprietarul ei (sau apelantul,
  la `security_invoker`).
- **Radacini** = ce poate APELA rolul: functii executabile, **fara functiile de trigger** (listate separat:
  `N_audit_trigger_exclus`), plus relatiile pe care are un drept (citirea evalueaza politicile, scrierea triggerele).
  Radacinile din `net` sunt riscul acceptat (lista scurta in `N_audit_radacina`), nu se exploreaza.
- **Muchii**: apel din corp NUMAI cu EXECUTE al rolului curent pe tinta (PostgreSQL verifica la fiecare apel);
  citire / scriere NUMAI cu dreptul rolului pentru acea operatie (cuvantul operatiei trebuie sa apara in corp); trigger
  NUMAI pentru operatia care il declanseaza (bitii `tgtype`); politica NUMAI pentru un rol care nu ocoleste RLS si caruia
  i se aplica politica; FK NUMAI pentru `ON DELETE / ON UPDATE CASCADE / SET NULL / SET DEFAULT` (si TRUNCATE CASCADE);
  vedere, regula, DEFAULT / CHECK / index, mostenire. **Nu sunt muchii** (scris in SQL): verificarile RI la INSERT /
  UPDATE in copil (citesc parintele ca proprietarul lui, fara RLS, fara triggere), FK `NO ACTION` / `RESTRICT` (doar
  verifica), citirea unei vederi materializate (nu ruleaza interogarea). Supra-aproximari ramase (muchii in plus, nu in
  minus): cuvintele din siruri / comentarii, orice comanda a unei politici, functiile din DEFAULT / CHECK / index /
  politici fara verificarea EXECUTE.
- **Fara limita de adancime**: inchidere completa cu `UNION` pe stari (multimea e finita, ciclurile se opresc singure);
  distanta pana la net = parcurgere in latime inversa, un strat pe iteratie, pana la stratul gol. „Adancime depasita”
  nu mai exista; NEREZOLVAT = doar SQL dinamic, corp opac, executor de text = **esec al auditului** daca nu e gol.
- **Calea falsa din productie (r22)** `notify_tichet_opener_on_resolve -> tichete -> politica -> fn_is_app_owner ->
  profiles -> fk -> hr_documente_personale -> trigger -> ... -> net.http_post`: pornea dintr-o functie de trigger
  (nu e radacina) si trecea printr-un FK la simpla citire a lui `profiles` (nu e muchie). Reprodusa pe PGlite in aceeasi
  forma: 0 cai; aceeasi forma cu un DELETE real si FK CASCADE spre un trigger DELETE: calea exacta, cu rolurile.
- **Asteptat**: pe productie inainte de 18a (rolul PUBLIC): radacinile din `public` = cele 3 apelabile, 18 excluse; dupa
  18a (harness): `rol_radacina = teren`, radacinile din `public` = exact `fn_portal_uid()` + `fn_teren_eligibil(uuid)`,
  0 cai, 0 nerezolvate, radacinile `net` = 12 functii + coada, raspunsurile, secventa.
- **Ce NU dovedeste** (ramane din r22): apeluri prin operatori / cast-uri / functiile de I/O ale tipurilor, triggere de
  eveniment, functiile de suport ale agregatelor; interiorul functiilor din `pg_catalog` (in afara executorilor de text
  listati); nimic dupa momentul citirii (de aceea propunerea de rulare periodica din r22 ramane).
- Volum: 1.500 de functii + 400 de tabele cu politici, FK in cascada si triggere = ~2 s pe PGlite.

### Ce ramane ca risc acceptat cu (c) + (d) — pentru owner
Dupa 18a, contul de teren poate executa, la nivel SQL, cele 12 functii `net.*` (inclusiv cererile HTTP ale bazei) si
are drepturi pe coada, raspunsurile si secventa pg_net, exact ca `anon` si `authenticated` azi, pentru ca drepturile
acelea sunt date de proprietarul extensiei (platforma), nu de noi. Ce il opreste sa le foloseasca: (1) rolul nu se
poate loga (NOLOGIN, membru in nimic) — o impune poarta; (2) nu are nicio cale de a rula SQL: in `public` poate executa
doar cele doua functii ale portalului, care doar citesc patru tabele (varianta d, poarta + auditul N); (3) schema `net`
nu e expusa prin API — verificata tehnic la fiecare proba si livrare (blocant). Inchiderea definitiva (drepturile
PUBLIC retrase de pe pg_net) = cererea catre suportul Supabase; daca vine, poarta ramane verde fara nicio schimbare.

### Pentru coordonator (ordinea; nimic din ele nu scrie in productie)
1. Harness PG17 (`scripts/test_portal_e1.sh` / `harness_win.sh`): noile verificari (d) + N inainte / dupa apply.
2. Productie, doar citire: `porti_citire.sql` (G + N noua) si `public21_apelanti.sql` (+ `_pss.sql` daca exista
   pg_stat_statements), format `-At -F '|'`. De trimis la review: `G_*`, `N_audit_rezumat` / `_radacina` / `_cale` /
   `_nerezolvat`, toate `P_*`.
3. Daca `P_pierde` nu cere alt rol: `net_rel_completeaza.py <iesirea porti_citire> --scrie` (valorile G de azi: neschimbate
   de r23, verificate pe iesirea r22 a productiei); altfel, intai clasificarea.
4. Restul ca in r22 (scheme_expuse.sh, proba cu ROLLBACK, apoi aplicarea dupa GO + „da”).

### Teste r23
- `node scripts/portal/public_d_pglite.mjs` (PGlite PG17, textul real din 18a si din revenire) — 35 OK: 21 fara PUBLIC,
  3 apelabile cu GRANT, teren doar cele doua functii, 42501 pentru teren, triggerul fara EXECUTE ruleaza ca
  authenticated, apelul direct al unei functii de trigger = 0A000, `grant_d:` = 6 pe ACL implicit / 0 pe drepturi
  explicite, revenirea reface exact drepturile (ambele forme), re-aplicare; 6 mutanti respinsi cu motivul exact si nimic
  schimbat; functie public noua cu PUBLIC = postconditie rosie; GRANT lipsa = scrierea / RPC-ul legitim pica cu 42501;
  `public21_apelanti.sql` pe aceeasi schema (apelantul din trigger, jobul cron fara comanda, `P_pierde` inainte = cele 3,
  dupa = nimic).
- `node scripts/portal/audit_tranzitiv_pglite.mjs` — 77 OK pe 24 de cazuri (EXECUTE lipsa / prin DEFINER, scriere fara /
  cu drept, trigger pe alta operatie, functie de trigger exclusa, calea falsa r22 = 0, FK CASCADE = calea exacta, FK NO
  ACTION = 0, politica pentru PUBLIC / pentru alt rol, vedere cu / fara drept, partitie, BEGIN ATOMIC, lant de 13 pasi
  fara limita, forma 18a cu teren) + 6 mutanti ai auditului (fara EXECUTE, triggere ca radacini, FK generic, scriere fara
  drept, politica fara roluri, trigger pe orice operatie), toti respinsi de cazul lor.
- Statice: `test_static_public_d.py` 15 OK (clasificarea = productia M, GRANT / REVOKE = clasificarea, ordinea, poarta,
  revenirea; 13 mutanti), `test_static_porti_citire.py` 32 OK (N fara limita, UNION, EXECUTE, triggere excluse; fisierele
  noi de citire), `test_static.py` 9 (inclusiv validatorul livrarii si bugetul de lock pe 18a), `test_static_1b.py`,
  `test_static_r2.py`, `test_static_diag_porti.py`, `test_static_net_rel.py` OK; `test_livrare_validator_plafon.py` PASS.
- `porti_citire_pglite.mjs`, `net_rel_pglite.mjs` OK. `npx vitest run`: 219 fisiere OK, 1 pica local (acelasi
  `scripts/noduri_cuplare_import_sql.test.js`, shebang + CRLF pe Windows, neatins); `npx vite build` OK.
- Harness PG17 actualizat (fixture: 01..18 functii de trigger, 19..21 apelabile, trigger pe `facturi` cu 01; refuzul
  clasificarii gresite; N inainte / dupa apply; (d) dupa apply; testul 1a: apel legitim, trigger fara EXECUTE, GRANT lipsa,
  PUBLIC redat). **Nerulat de mine** (bash / binarele PG17 cer aprobare pe acest server).

| Regula | Dovada r23 |
|---|---|
| L07 | Suprafata in BD: REVOKE PUBLIC + poarta (in public doar cele doua functii, orice alta = rosu); auditul porneste doar din ce se poate apela efectiv. |
| L12 | Nimic tacut: triggerele excluse listate, NEREZOLVAT = esec, „adancime depasita” eliminata (inchidere completa); `P_statistici` 0 = necunoscut, nu „nefolosita”. |
| L14 | O tranzactie; clasificarea verificata pe catalog inainte de orice schimbare; revenire exacta (grant_d:) testata apply -> revenire -> re-aplicare. |
| L15 | Cele 21 raman in baseline cu ACL de dupa d; clasificarea din productie (expected independent in test); fara SQL dinamic inainte de lock-uri. |
| L18 | Rolul PUBLIC fara OID: comparatia cu proprietarul ar fi dat NULL si taia politicile (prins de test, `coalesce` la fals). |
| L19 | O singura definitie a muchiilor (`muchie`), folosita si de inchidere, si de distanta / calea martor; aceeasi clasificare pentru GRANT, REVOKE si postconditie (test static). |
| L20 | Cai legitime: authenticated / service_role apeleaza, triggerul se declanseaza, revenirea reda PUBLIC, drepturile explicite existente raman. |
| L25 | Expected din regulile PostgreSQL si din citirea de productie (nu din codul testat); mutanti pe fiecare regula; NOSUPERUSER si PG17 la harness. |
| restul | n/a (L01-L06, L08-L11, L13, L16, L17, L21-L24: fara cozi, identitate noua, bani, AI, UI; ordinea lock-urilor neschimbata). |
