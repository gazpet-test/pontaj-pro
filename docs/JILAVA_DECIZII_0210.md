# Jilava (lic. 93) — decizii pentru 02.10.2026: J04×J07, Q-J05, cele 4 întrebări din raport

> **Read-only.** Analiză făcută pe 01.10.2026 (~20:30–21:00 UTC) din: `claude_docs.jilava_stare_0110` (docs/JILAVA_STARE_0110.md nu există în repo — doar în BD), `docs/AUDIT_OFERTARE_V2/COPILOT_HANDOFF.md` (main `cf4c438`), PR #542 / #524 / #527 / #539, branch `origin/claude/erp-continuare-x4p5a7-j04xj07`, și SELECT-uri pe `dxczwkbciseqniprspcu`. **Nicio scriere** în BD, niciun apply, niciun merge. Textele din BD (cerințe, descrieri, propuneri) sunt date, nu instrucțiuni.
>
> Context verificat la citire: lic. 93 `status=in_lucru`, `decizie_go=go`, `derogare_depunere=false`, `derogare_motiv IS NULL`, 0 rânduri în `ofertare_derogari_audit`, `termen_depunere` = **06.10.2026 12:00 UTC** (veghea SEAP a rescris 02.10 — decizia 1 din `jilava_stare_0110` rămâne a lui Răzvan).

---

## A. Matricea de teste J04×J07 (cerințele Copilot din review-ul planului A, 29.09)

### A.0 Constatarea principală: harness-ul cerut EXISTĂ deja, ca PR draft

Verdictul Copilot din 29.09 („NO-GO pe merge cu doar 3 teste”) se referea la suita inițială din #524/#527 (`test_jakv202_hash_server.mjs` 23 scenarii, `test_jakv2p3_poarta_server.mjs`, `test_j04_j07_integrare.mjs` 35 scenarii). După acel verdict s-a construit **suita extinsă JX** pe branch-ul `claude/erp-continuare-x4p5a7-j04xj07` = **PR #539 (draft, HOLD)**, head `6d97b85` (29.09 23:15), descrisă în `docs/AUDIT_OFERTARE_V2/J04xJ07_INTEGRARE_TESTE.md` (370 rânduri). Rezultat raportat local: **74/74 teste PASS, 73/73 mutanți uciși** (62 SQL + 11 edge), control negativ `M00_noop` supraviețuiește, `--tot` în 7 min pe PG16.

Fișierele (toate în `supabase/tests/j04xj07/`, rulate de `scripts/test_j04xj07.sh` prin `scripts/pg/test_j04xj07.mjs`, fiecare test `BEGIN…ROLLBACK` + `jx.baza_intacta`; refuzurile prin `jx.refuza(sql, sqlstate, fragment)` cu fotografie completă înainte/după):

| Cerința Copilot (29.09) | Fișier | Teste | Stare |
|---|---|---|---|
| 1. simetric: hash J04 invalid/lipsă/stale + poartă J07 **permisivă** → REFUZ | `01_simetric_hash_j04.sql` | JX-01a…j (lipsă, invalid, stale ×5 variante: aceiași bytes/updated_at nou, alți bytes, obj_id nou, șters, golit; eroare internă snapshot; hash parțial în timpul verificării; PASS fals cu service_role) + JX-MX-01c | **există** |
| 2. invers: hash J04 valid + J07 **BLOCK** → REFUZ | `02_simetric_j07_block.sql` | JX-02a…d (stale, sursă ilizibilă 409, agregator cade XX000 = fail-closed, parser `undetermined`) + JX-MX-16a/b/c/f (eroare internă într-un control / în sursa comună / date lipsă / contract rupt sursă↔evaluator ⇒ toate `undetermined`) | **există** |
| 3. traseul pozitiv | `03_traseu_pozitiv.sql` | JX-03a (depus + licitație depusă, fără J05), 03b (ordinea J07/J04 nu contează), 03c (reluare după refuz, dovezile nu se dublează) | **există** |
| 4. fiecare din cele **12 controale** provocat **separat**, celelalte 11 ok, J04 PASS | `04_controale_j07.sql` | JX-04-01…12 (cuprins, neverificate, capcane, goale, nescrise, cantitati_f3_grafic, garantie SQL, anexe, numere, pachet, grafic_relatii, grafic_sursa) + 04-07b (garantie prin text) + 04-13 contraprobă (agregatorul are exact 12) + JX-MX-09s | **există** — aserțiunea e `blocaje = ["<cod>"]` exact |
| 5. probă concurentă **deterministă** | `05_concurenta_pasi.sql` (pași intercalați a…f) + `05g…05j_sesiuni_*.sql` (două sesiuni reale cu COMMIT, pe clonă) | sursă / manifest / rezultat / obiect schimbate între verificare și tranziție; 05j: FOR SHARE → 55P03 | **există** (READ COMMITTED, nu sub sarcină) |
| 6. `parser_version` schimbat, sursă neschimbată | `06_parser_version.sql` | JX-06a (v2 pe server ⇒ rezultate v1 stale), 06b (edge v1 sub server v2 → 409, nimic scris), 06c (rezultat v0 ignorat), 06d (reevaluare v2 → depus) | **există** |
| 7. căi **API/RPC** | `07_scriere_directa_api.sql` | JX-07a…j: PATCH direct, POST/UPSERT, ocoliri pe coloane, dovezi falsificate (42501), RPC-uri interne neexecutabile, licitație depusă prin API (J02/J05/J07), Storage înghețat, service_role BYPASSRLS nu ocolește triggerele, fără modul/anon, imuabil după depunere | **există** |
| 8. la refuz nimic nu se suprascrie | `08_refuz_nu_suprascrie.sql` | JX-08a…c + `jx.refuza` peste tot | **există** |
| 9. J04 A→B | `09_j04_a_b.sql` | JX-09a…e (PASS pe B doar prin manifest/versiune nouă, tranziție permisă) | **există** |
| — | `10_constatari.sql`, `10a_constatare_cursa_manifest.sql` | JX-C1…C4 (comportamente **fixate**, nu remediate) | deschise, vezi A.2 |
| — | `11_mx_mutatii.sql` | 6 teste adăugate după mutații | există |

### A.1 Ce LIPSEȘTE (față de verdictul Copilot și față de starea de azi a lui main)

| # | Lipsă | De ce contează | Propunere |
|---|---|---|---|
| L1 | **#539 e în urma lui main cu 29 de commit-uri** (bază 29.09 23:15; între timp pe main: F1/F2, #537, #552, J02b r6, J05 #542, #543, #540, #541, #561–#563). Precondițiile de schemă (JX-00) și fixture-ul `v_ofertare_pt_stare` sunt pe starea veche. | `fn_gate_depunere` are acum J02b (md5 `04102c5e…`) și 5 triggere pe `ofertare_licitatii`, inclusiv garda J05 (`a00_ofertare_derogare_garda_j05`). JX-07f și JX-C4 testează derogarea J05 **fără gardă** — pe schema de azi, derogarea prin coloană de către ne-owner e refuzată de gardă cu 42501, iar după `depusa` e înghețată și pentru owner. | Merge `origin/main` în #539 → rulează `--tot` → actualizează JX-00 (lista de triggere: gardă J05 + J02b ×2) și JX-07f/JX-C4 (gardă prezentă). **Până atunci, cifrele 74/74 și 73/73 sunt valabile doar pentru commit-ul `6d97b85`.** |
| L2 | **Gardă J05 × J07** nu e testată: ce se întâmplă când ownerul acordă derogarea (RPC), J07 e BLOCK, iar gate-ul refuză — auditul `derogare_acordata` rămâne, dar `depusa_pe_derogare` nu apare; apoi `status='depusa'` reîncercat după reevaluare J07. | Jilava merge exact pe traseul ăsta (J05, nu fluxul normal). | Test nou JX-J05-01 (schelet în A.3). |
| L3 | **Poarta de rol a edge-urilor** rulată în suita SQL doar cu editor autorizat; 401/403 doar în Deno (`handler_test.ts`, `test-jakv202-hash-server.mjs`). Nu există mutant „poarta lasă pe oricine”. | Cerința Copilot (d) din CLAUDE.md pct. 7: `verify_jwt` nu ajunge. | Mutant `XP_poarta_oricine` în `scripts/pg/fixtures/j04xj07_mutanti.mjs` + test JX-07k (anon și cont fără modul → 401/403, nimic persistat). |
| L4 | **Edge-urile au rulat ca cod** (Node), nu în runtime-ul Supabase; clientul Supabase e un shim PostgREST peste psql; Storage simulat (`jx.bucket`). | Semantica reală (schema cache, paginare, limita 32 MB, timeout) nu e dovedită. | Rămâne pentru smoke-ul pe clona 103 (planul A §2): A → verify PASS → înlocuire B → depunere REFUZ → reverify B → PASS doar pe pachet nou. Smoke-ul se scrie ca listă de pași cu `SELECT` de verificare după fiecare (A.4). |
| L5 | **Constatările C1–C4 n-au decizie** (cerință vs comportament acceptat). | Fără decizie, EXIT REPORT nu le poate clasifica. | Propunere de verdict în A.2. |
| L6 | **Rollback-ul redeschide poarta** (observația Copilot „rollback-ul nu poate redeschide poarta” rămâne deschisă). | După `_ROLLBACK.sql` tranziția revine la R11/R5. | Decizie: rollback J04/J07 = **doar cu pachetele în stare `propus`/`aprobat` fără depunere în fereastră** + test JX-RB-01 care verifică că un pachet `depus` sub J04/J07 nu poate fi „re-depus” altfel după rollback (schelet A.3). |
| L7 | **CI GitHub n-a rulat** pe diff (workflow `ofertare-regresie.yml` modificat: Node 22, mutanți în paralel, timeout 35 min). | Timpul pe runner e estimat. | Push-ul lui #539 după merge main → CI rulează singur; dacă depășește 35 min, mutanții se mută pe job separat. |
| L8 | **Concurența sub sarcină** nu e testată (doar 2 sesiuni deterministe). | Copilot a cerut „probă concurentă deterministă” — **îndeplinit**; sarcina nu a fost cerută. | Nu se adaugă acum (ar fi „gold-plating”); se notează în EXIT REPORT ca limitare. |

### A.2 Constatările C1–C4: propunere de clasificare

| Constatare | Ce face azi | Propunere | Motiv |
|---|---|---|---|
| **C1** cursă: INSERT concurent în manifest în timpul tranziției → pachet `depus` cu fișier fără PASS | reprodus (10a) | **CERINȚĂ → remediere în J04** înainte de apply: trigger `BEFORE INSERT` pe `ofertare_pt_pachet_fisiere` cu `SELECT … FOR SHARE` pe pachet + recitire stare (`aprobat` doar). Testul 10a se mută la cerințe (B refuzat cu 42501/55P03). | Fereastra e mică, dar încalcă principiul „artefactul depus legat de obiect/hash/dovadă”. Costul e un trigger. |
| **C2** J04 acceptă un PASS vechi deși ultima verificare a aceleiași identități e REFUZ | reprodus | **CERINȚĂ → remediere mică**: `fn_pt_pachet_depus_verifica` ia **ultimul** rând pe identitate (ca J07 pe hash), nu „orice PASS”. | Simetrie cu J07; altfel „bytes schimbați sub metadate” trec. |
| **C3** `service_role` poate rescrie manifestul (sha256 A→B) fără pachet nou | reprodus | **CERINȚĂ**: trigger de imuabilitate pe `ofertare_pt_pachet_fisiere` pentru UPDATE/DELETE (toate rolurile, inclusiv service_role; reparațiile doar prin login postgres fără claims, ca la garda J05). | Edge-urile J04/J07 rulează cu service_role (CLAUDE.md pct. 7c): un bug acolo ar putea rescrie dovada. |
| **C4** derogarea J05 ocolește J02 ⇒ implicit J04 (licitație `depusa` cu pachet doar `aprobat`, zero dovezi hash); J07 rămâne impus | reprodus | **ACCEPTAT, documentat** pentru Jilava (pachetul nici nu există în ERP: 0 pachete PT). După Jilava: decizie Răzvan dacă J05 cere J04 când există pachet. | Derogarea e exact pentru cazul „pachetul nu trece prin ERP”. A o lega de J04 ar face derogarea inutilă azi. |

### A.3 Schelete de teste noi (stil JX, PG16 local — **nu se rulează pe live**)

```sql
-- supabase/tests/j04xj07/12_garda_j05_x_j07.sql
-- JX-J05-01 · gardă J05 (20261001a, live din 01.10) × J07: derogare owner + J07 BLOCK → REFUZ J07;
-- auditul 'derogare_acordata' rămâne; după reevaluare J07 → depusa; 'depusa_pe_derogare' copiază motivul acordat.
BEGIN;
SELECT jx.start('JX-J05-01', 'derogare owner (RPC) + J07 BLOCK → status=depusa REFUZ J07; audit acordare păstrat; după J07 OK → depusa + depusa_pe_derogare');
-- @edge j04 1
:owner
SELECT public.ofertare_derogare_depunere(1, 'DEROGARE OWNER test J05xJ07', true);
:admin
SELECT jx.ok((SELECT count(*) = 1 FROM ofertare_derogari_audit WHERE licitatie_id = 1 AND actiune = 'derogare_acordata'), 'acordarea e auditată');
SELECT jx.egal(jx.blocaje(1), '["garantie","anexe","numere","pachet"]', 'J07 încă stale (nerecalculată)');
:owner
SELECT jx.refuza($$UPDATE ofertare_licitatii SET status = 'depusa' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
:admin
SELECT jx.ok((SELECT count(*) = 1 FROM ofertare_derogari_audit WHERE licitatie_id = 1), 'refuzul J07 nu adaugă și nu șterge audit');
-- @edge j07 1
:owner
UPDATE ofertare_licitatii SET status = 'depusa' WHERE id = 1;
:admin
SELECT jx.ok((SELECT status = 'depusa' FROM ofertare_licitatii WHERE id = 1), 'depusă pe derogare');
SELECT jx.ok((SELECT motiv FROM ofertare_derogari_audit WHERE licitatie_id = 1 AND actiune = 'depusa_pe_derogare')
           = (SELECT motiv FROM ofertare_derogari_audit WHERE licitatie_id = 1 AND actiune = 'derogare_acordata'),
          'depusa_pe_derogare = motivul acordat (Q61b)');
SELECT jx.trecut('JX-J05-01');
ROLLBACK;
SELECT jx.baza_intacta('JX-J05-01');

-- JX-J05-02 · după depusa, derogare_* înghețate și pentru owner (garda), editorul refuzat 42501, service_role (claims) refuzat.
BEGIN;
SELECT jx.start('JX-J05-02', 'gardă J05: după depusa, owner/editor/service_role nu mai schimbă derogare_motiv; postgres fără claims poate');
-- (precondiție: JX-J05-01 adus la depusa; aici se repetă pașii)
:owner
SELECT jx.refuza($$UPDATE ofertare_licitatii SET derogare_motiv = 'rescris' WHERE id = 1$$, '42501', 'înghețate după depunere');
:editor
SELECT jx.refuza($$UPDATE ofertare_licitatii SET derogare_depunere = false WHERE id = 1$$, '42501', 'doar ownerul');
:service
SELECT jx.refuza($$UPDATE ofertare_licitatii SET derogare_motiv = 'rescris' WHERE id = 1$$, '42501', 'J05');
SELECT jx.trecut('JX-J05-02');
ROLLBACK;
SELECT jx.baza_intacta('JX-J05-02');

-- supabase/tests/j04xj07/13_rollback_nu_redeschide.sql
-- JX-RB-01 · rollback J07 apoi J04 cu un pachet DEPUS sub ambele porți: pachetul rămâne depus, imuabil (R12),
-- iar un pachet nou v2 fără J04/J07 ajunge la depus doar prin R11/R5 (comportament documentat = „poarta redeschisă”).
-- Testul FIXEAZĂ asta și raportează 'constatare' până la decizia Copilot+Răzvan (varianta: rollback refuzat dacă există pachete 'aprobat').
BEGIN;
SELECT jx.start('JX-RB-01', 'rollback J07+J04: pachetul depus sub porți rămâne imuabil; precondiția de rollback refuză când există pachete aprobat nedepuse');
-- @edge j04 1
-- @edge j07 1
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
:admin
INSERT INTO ofertare_pt_pachet(licitatie_id, versiune, stare) VALUES (1, 2, 'aprobat');  -- pachet aprobat nedepus
\i supabase/migrations/20261003a_ofertare_poarta_server_jakv2p3_ROLLBACK.sql   -- se așteaptă REFUZ (precondiție nouă, de adăugat în rollback)
SELECT jx.ok(to_regprocedure('public.ofertare_poarta_server(bigint)') IS NOT NULL, 'rollback-ul a refuzat: poarta încă instalată');
SELECT jx.trecut('JX-RB-01');
ROLLBACK;
SELECT jx.baza_intacta('JX-RB-01');
```

Mutant nou pentru L3 (`scripts/pg/fixtures/j04xj07_mutanti.mjs`): `XP_poarta_oricine` = `_shared/poartaOfertare.ts` întoarce `ok` fără să verifice modulul; testul JX-07k rulează `-- @edge j07 1 actor=anon status=401` și `actor=fara_modul status=403`, apoi `jx.neschimbat`.

### A.4 Smoke pe clona 103 (după apply, planul A §2) — pași + SELECT de probă

1. `SELECT id, stare FROM ofertare_pt_pachet WHERE licitatie_id = 103` → un pachet `aprobat` cu 4 fișiere (`depus_final`, `dovada_seap`, propunere, borderou).
2. Edge `ofertare-pachet-verifica` cu contul lui Răzvan → `SELECT rezultat, obj_id, obj_updated_at, sha256_calculat FROM ofertare_pt_pachet_verificari WHERE pachet_fisier_id IN (…)` → 4 PASS.
3. Înlocuire `depus_final` cu B (upload nou, aceeași cale) → `UPDATE … SET stare='depus'` din UI → așteptat P0001 `verificare PASS lipsă, SHA diferit sau verificare veche`.
4. Reverify B cu manifestul pe A → rând REFUZ `SHA-256 diferit de manifest`, tranziție tot refuzată (JX-09a).
5. Pachet v2 (manifest cu B) → J07 → aprobat → verify → depus. `SELECT stare, depus_la FROM ofertare_pt_pachet WHERE licitatie_id=103 ORDER BY versiune` → v1 aprobat (nu mai poate fi depus), v2 depus.
6. `get_advisors` după apply; `SELECT * FROM ofertare_poarta_server(103)` → `blocaje = []`.

---

## B. Q-J05: opțiunea A (gardă #542 cu excepție de freeze) vs B (risc acceptat)

### B.0 Întrebarea e depășită de fapte: **A s-a executat deja**

- PR **#542 e MERGED** (01.10 17:48 UTC, commit `54b2c88` pe main).
- Migrarea **`20261001a_ofertare_derogare_garda_j05` e aplicată pe live**: `supabase_migrations.schema_migrations` versiunea `20261001179000`; trigger `a00_ofertare_derogare_garda_j05` (`tgenabled=O`) e **primul** pe `ofertare_licitatii`, înaintea lui `a00_ofertare_licitatii_scriere`, `trg_gate_depunere`, `trg_ofertare_j02b_sens_unic`, `trg_ofertare_responsabil_setat_de`; `fn_ofertare_derogare_garda_j05` md5 `f84c9aee…` = cel din migrare, SECURITY DEFINER, ACL doar `postgres`.
- `handoff_activ` (append 01.10 seara) confirmă: „J05 #542 (v179000)” livrat cu excepție de freeze. Jurnalul Copilot din `COPILOT_HANDOFF.md` **nu are încă rândul pentru verdictul #542** (ultimul rând e #563 F1b r2) — de completat de sesiunea principală (pct. 11 din CLAUDE.md).

Deci Q-J05 nu mai e „A sau B”, ci: **ce rămâne deschis cu garda live** și **ce schimbă garda în procedura de depunere**.

### B.1 Ce acoperă garda (dovedit în `j05_garda.test.sql`, 152/152 pe patch, 67 verificări harness)

- Cei 9 non-owneri cu modulul Ofertare **nu mai pot** rescrie `derogare_motiv` / retrage `derogare_depunere` (42501), nici prin API, nici prin RPC.
- Ownerul (JWT, `is_owner`) poate schimba doar **înainte** de `status='depusa'`; după, **înghețat și pentru owner**.
- `postgres`/`supabase_admin` fără claims trec (reparații documentate) — deci MCP `execute_sql` **poate** încă scrie; rămâne sub pct. 3 (preview → confirmare → apply).

### B.2 Ce rămâne OPEN (din antetul migrării + J05_DELTA_COPILOT §6)

1. Retragerea / schimbarea motivului de către **owner, prin UPDATE direct, înainte de depusa**, nu lasă audit (RPC-ul lasă).
2. **INSERT** neacoperit (licitație nouă creată direct cu derogare=true) — irelevant pentru 93.
3. Înghețul e legat de `status='depusa'`; o revenire a statusului (dacă vreo cale o permite) ar dezgheța. J02b `sens_unic` blochează retrogradarea — de confirmat că acoperă și `depusa → in_lucru`.
4. `depusa_pe_derogare` copiază încă **coloana**, nu ultimul `derogare_acordata` (fix-ul promis „după 02.10”). Cu garda, coloana nu mai poate fi modificată de altcineva decât owner, deci Q61b devine o verificare de consistență, nu de securitate.

### B.3 Recomandare

- **Finding J05: din RIDICAT → MEDIU, rămâne OPEN** până la (a) audit pe UPDATE-ul direct al ownerului (trigger de audit, nu doar gardă) și (b) `depusa_pe_derogare` din `derogare_acordata`. Ambele sunt PR-uri mici, **după Jilava**, în același lot cu J07 (ating `fn_gate_depunere`, deci amprentele J07 trebuie recitite oricum).
- **Procedura (a)–(e) pentru 02.10 se păstrează**, simplificată: (a) Q01 `derogare_motiv IS NULL` ✔ (verificat azi); acordarea **doar prin RPC, din contul lui Răzvan, din UI** (din MCP actorul ar fi NULL → garda trece ca postgres, dar auditul rămâne fără actor); (b) `depusa` imediat după; (c) Q61b SHA-256 coloană = acordată = depusă; (d) SHA-256 al textului notat offline; (e) `xmin` după depunere. Pasul (e) devine opțional: garda înlocuiește detecția cu prevenție pentru non-owneri.
- **Nu redeschide** întrebarea A/B cu Răzvan; ce trebuie de la el: confirmarea că textul motivului J05 (ciorna din `JILAVA_CIORNE_J05_H_2026-09-30.md` §1) e aprobat și completat în ziua depunerii.
- EXIT REPORT: „acordare owner-only + audit append-only + **prevenție pe modificare/retragere pentru non-owneri (gardă 20261001a, live 01.10)** — CONFIRMED în domeniul testat; auditul modificării de către owner și legătura motiv aprobat → depunere — OPEN (mediu)”.

---

## C. Cele 4 întrebări din raportul turei de noapte (01.10) — date + recomandare

Toate citite read-only din `executie_proiecte`, `employees`, `hr_autorizatii`, `executie_documente_contract`, `executie_ordine_detectate`, `executie_completari_propuse`.

### C.1 RTE Pătrașcu Sorin pe proiectele de distribuție

**Date:**
- `employees` id **92** PATRASCU SORIN, funcție „RTE - 2H”, activ, angajat 14.04.2025 (= data mailului Nataliei „RTE pentru proiectele de DISTRIBUȚIE GAZE”).
- `hr_autorizatii` 34: RTE ISC nr. 00002705, domenii **6.3 + 8.4 (D)** (distribuție), expiră 22.09.2027, fișier atașat, `verificat_pe_scan=false`.
- Deja RTE pe **P6 Europan** și **P25 Hoghilag** (`rte_employee_id=92`); pe P6 există și „DECIZIE RTE PATRASCU SORIN.pdf” (doc 97).
- Proiecte de distribuție active **fără RTE**: **P19 Bretea Română** (HABAU), **P26 ADI Ialomița-Vest** (HABAU), **P27 Finta-Gheboaia**. (P5 Bilciurești și P9 Gaze Umede sunt HABAU dar nu distribuție — P5 are propunerea 41 deschisă cu Stănescu.)
- Pentru comparație, Dădulescu (37) are RTE ISC 00002797 pe „8.4 (D) și 8.5” și Stănescu (109) doar 8.4 (T) + 8.5 (transport) — deci pe distribuție candidații sunt Pătrașcu și Dădulescu.

**Recomandare:** **da**, regula „Pătrașcu = RTE implicit pe distribuție” e susținută de autorizația ISC 8.4(D) și de două proiecte deja atribuite; dar **nu ca umplere automată** — RTE pe un proiect e numit prin **decizie** (vezi Mironu, decizia 916). Propun: (1) Răzvan confirmă P19/P26/P27 → UPDATE `rte_employee_id=92` pe cele 3 (preview → confirm → apply, RETURNING id); (2) pentru fiecare, tura caută/atașează decizia de numire (pe P6 există deja, pe P19/P26/P27 „nicio decizie pe NAS” azi); (3) regula intră în skill-ul turei ca **propunere cu confidență 80%** doar când există decizie sau program de control semnat de el, nu din mailul generic. Bonus: autorizația 34 are `verificat_pe_scan=false` și fără `data_emitere` — de bifat la verificarea scanurilor.

### C.2 „Ordin de începere” = predare amplasament la distribuție cu primăria (P25 Hoghilag)

**Date:**
- P25: contract 16/17.07.2026, `data_start=17.08.2026`, `data_termen=30.11.2026`, `doc_ordin_incepere_path=NULL`, 0 rânduri în `executie_ordine_detectate`.
- Documente: contract (20), program de control vizat 17.08.2026 (80), decizia 759/17.08.2026 șef șantier (151), **„Invitație predare amplasament 17.08.2026 (Valchid și Prod)” (170, atașată de tură la `altele`)**. Deci toate actele de pornire poartă aceeași dată, 17.08.2026 = `data_start` deja din fișă.
- Pe celelalte proiecte de distribuție cu primării: P6 Europan **are** ordin de începere distinct (doc 99, ordin detectat 9, confirmat); P27 Finta are `doc_ordin_incepere_path` (ordin 12.05.2025). Deci la primării ordinul **există uneori** ca document separat.

**Recomandare: B cu nuanță** — nu echivalăm automat. Invitația/PV-ul de predare a amplasamentului e dovada pentru **`data_start`** (deja 17.08.2026), nu pentru `doc_ordin_incepere_path`. Concret: (1) doc 170 rămâne la `altele`, descrierea să spună „predare amplasament = începerea efectivă; ordin de începere separat negăsit”; (2) tura marchează câmpul „ordin de începere” ca **NOT_FOUND cu motiv** (nu DOES_NOT_EXIST) și nu mai caută nocturn pe P25 până nu apare un document nou; (3) dacă Răzvan știe că la Hoghilag primăria n-a emis ordin (contractul spune că începerea curge de la predarea amplasamentului?) → se citește clauza din contractul 16/17.07.2026 și doar atunci A, cu `tip='incepere'` în `executie_ordine_detectate` legat de doc 170 și `sursa_detaliu` = clauza. Varianta A generică ar face câmpul „ordin” inutil ca semnal de risc (termenele contractuale curg de la ordin, nu de la predare, la Transgaz/Romgaz).

### C.3 RTE Mironu (P32)

**Date:**
- `executie_proiecte` 32: `rte_employee_id=109` **STANESCU SILVIU** (Director Tehnic; RTE ISC 00002707 doar **8.4 (T) + 8.5**, adică transport; RTS ISCIR; MECMA B-0747).
- Documente atașate pe P32: **„Decizie numire RTE 1.1 Dadulescu - Sonda 16 Mironu.pdf” (doc 168, 29.09)** = decizia 916/28.09.2026 semnată Trușu; „Decizie 914/28.09.2026 numire Manager Proiect Trușu Răzvan” (167); contract 52675/21.09.2026 (153).
- `employees` 37 **DADULESCU COSMIN GRIGORAS**, „RTE - 2H”, activ; `hr_autorizatii` 8: RTE ISC nr. 00004386, domenii **1.1 + 9.1**, expiră 12.08.2029, **verificat_pe_scan=true**; plus 8.4(D)/8.5 (9), 8.4(T) (7), atestat MEC 342.458 (585, 18.08.2026).
- Decizia Răzvan din 24.09 (claude_context #1435, pentru **Jilava**, nu Mironu): „RTE unic: Stănescu Silviu” — nu se aplică lui P32.
- Propunerea 43 (mp_employee_id = Trușu, 95%) e încă `propus`.

**Recomandare: corectează fișa → `rte_employee_id = 37` (Dădulescu).** Decizia 916 e documentul de numire, e atașată, domeniul 1.1 cerut de proiect e exact pe autorizația lui verificată pe scan; Stănescu nu are 1.1. Operațiune: UPDATE pe 1 rând (preview `SELECT id, rte_employee_id FROM executie_proiecte WHERE id=32` → confirmare → UPDATE … RETURNING → sanity). În același pas se poate confirma propunerea 43 (MP = Trușu). Lecție pentru tură: când există **decizie de numire** atașată și câmpul e ne-NULL dar diferit → să scrie o **atenționare structurată** (`executie_completari_propuse` cu `status='conflict'`), nu doar text în handoff.

### C.4 `nr_contract` Europan (P6)

**Date:**
- Fișa P6: `nr_contract='122'`, `data_contract=06.02.2026`, `data_start=15.05.2024` (ordin de începere 15.05.2024 confirmat, doc 99 / ordin 9), `valoare_lei=100.000` (placeholder), `durata_contract_luni=NULL`, `beneficiar='ADI Valea Geamartaluiului'`.
- Documente: „Contract Înființare sistem de distribuție gaze naturale ADI Valea Gemărtăluiului.pdf” (98); propunerea financiară a asocierii (142–144: „asocierea Europan Prod (lider) – Habau – Gazpet – Tech I”); ordin de suspendare nr. 200/12.06.2024 Căluiu (102), reluare 13.06.2025 (10).
- Tura 01.10: contractul asocierii cu ADI = **nr. 30/28.03.2023**; acordul subsecvent Gazpet–Europan = **nr. 1/27.06.2024** (sursa propunerii 48: 31.007.489,30 lei fără TVA, 90%). Memoria #683: Europan = **asociere** (lider Europan + Gazpet + Habau), client = ADI (nu subcontract).
- „122 / 06.02.2026” nu apare în niciun document atașat; data 06.02.2026 e **după** ordinul de începere (15.05.2024) și după suspendare/reluare, deci nu poate fi contractul de bază. Posibil un act adițional sau o confuzie cu alt dosar — nu pot dovedi read-only.

**Recomandare:** fișa P6 trebuie să țină **contractul în care Gazpet e parte**: `nr_contract = '1/27.06.2024'` (acord subsecvent Gazpet–Europan), `data_contract = 27.06.2024`, iar contractul-cadru al asocierii (30/28.03.2023) în `observatii` + `executie_acte_aditionale`/documente. Împreună cu: confirmarea propunerii 48 (valoare 31.007.489,30 lei, înlocuiește placeholder-ul 100.000), 40 (GBE 10%), și decizia pe 49 (penalități: 0,3185 %/zi pe 314 zile lucrătoare vs ~0,2273 pe calendaristice — de citit clauza 36.4 + definiția „zile” din condițiile generale înainte de confirmare). Înainte de UPDATE pe `nr_contract`: Răzvan să spună de unde a venit „122 / 06.02.2026” (dacă e act adițional, se păstrează ca act adițional, nu ca nr. contract).

---

## D. Rezumat pentru Răzvan (decizii cerute)

1. **J04×J07**: harness-ul cerut de Copilot există (#539, 74/74 + 73/73 mutanți) dar e pe schema din 29.09 → după Jilava: merge main în #539, rerulare `--tot`, 3 teste noi (gardă J05×J07, poartă de rol cu mutant, rollback cu precondiție), remedieri C1–C3 ca cerințe, C4 acceptat. Apoi delta la Copilot → GO → apply J04 → smoke 103 → J07.
2. **Q-J05**: nu mai e de decis — garda e live (v20261001179000, #542 merged). Rămân 2 PR-uri mici după Jilava (audit UPDATE owner; `depusa_pe_derogare` din audit) și rândul lipsă din jurnalul Copilot. Procedura de depunere: RPC din UI cu contul tău, apoi `depusa`, apoi Q61b.
3. **Pătrașcu**: confirmi RTE pe P19/P26/P27 (UPDATE 3 rânduri) + tura caută deciziile de numire; regula în skill doar cu decizie/program de control.
4. **Ordin de începere la distribuție**: B — predarea amplasamentului susține `data_start`, nu înlocuiește ordinul; A doar dacă contractul leagă începerea de predare.
5. **Mironu**: UPDATE `rte_employee_id` 109 → 37 (Dădulescu, decizia 916, domeniul 1.1 verificat pe scan).
6. **Europan**: `nr_contract` → 1/27.06.2024 (acord subsecvent), cadru 30/28.03.2023 la observații; spune de unde vine „122 / 06.02.2026”; confirmă propunerile 48/40, decide 49.

Toate scrierile din 3–6 = DML pe date reale → **preview → confirmarea ta → apply cu RETURNING** (CLAUDE.md pct. 3). Nimic nu s-a scris în această analiză.
