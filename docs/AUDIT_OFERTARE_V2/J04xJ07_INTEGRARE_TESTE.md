# J04 × J07 — integrare, teste și verificarea prin mutații

> **Stare (istoric 29.09–02.10): DOAR LOCAL.** Branch `claude/erp-continuare-x4p5a7-j04xj07`, fără push. Pentru starea de azi vezi §0.A. **Nimic nu e aplicat în producție**: nicio migrare, niciun deploy de edge, nicio scriere în Supabase. În etapa de reparații nu am deschis nicio conexiune la Supabase, nici măcar un SELECT. Freeze pe Ofertare până după Jilava (02.10.2026, 12:00). Merge-ul și apply-ul se fac numai cu **GO de la Copilot + acordul lui Răzvan**, în ordinea din PLAN §2: J04 → J07; apply migrare → `get_advisors` → deploy edge → merge → `verifica` verde.

## 0.A Actualizare 06–07.10.2026 (noaptea): C1–C3 remediate, livrare la standard, fixture = live

> **Tot fără apply.** Codul J04/J07 e pe main din 02.10 (#539), dar migrările `20260930a` / `20261003a` și edge-urile `ofertare-pachet-verifica` / `ofertare-poarta-text` NU sunt live (verificat read-only 06.10). Apply-ul cere: GO Copilot pe delta + „aplica” de la Răzvan, prin `scripts/livrare_migrare.sh`, J04 înaintea lui J07.

- **C1 (cursa INSERT în manifest ↔ tranziția aprobat→depus) — CERINȚĂ, remediată:** `trg_pt_fisier_insert_stare` (BEFORE INSERT, SECDEF) blochează pachetul `FOR SHARE` și recitește starea COMISĂ; contractul e cel al R11 (propus: orice rol; aprobat: doar `depus_final` / `dovada_seap`), dar pentru toate rolurile, inclusiv `service_role`. JX-C1 (`10a_cursa_manifest.sql`, două sesiuni): B așteaptă tranziția (55P03 la `lock_timeout` 2 s), apoi e refuzat 42501; pachetul depus nu are fișiere verificabile fără PASS.
- **C2 (PASS vechi acceptat după un REFUZ ulterior) — CERINȚĂ, remediată:** `fn_pt_pachet_depus_verifica` decide pe ULTIMA verificare a fișierului (`ORDER BY id DESC LIMIT 1`), ca J07 (ultimul rezultat pe hash). Mesajul de refuz neschimbat. JX-C2: REFUZ ulterior → tranziția refuzată; bytes corecți + reverificare → depus.
- **C3 (service_role rescria manifestul A→B) — CERINȚĂ, remediată:** `trg_pt_fisier_imuabil` (BEFORE UPDATE OR DELETE, SECDEF): UPDATE refuzat pentru toți; DELETE doar cât pachetul e `propus` (inclusiv cascada de la ștergerea pachetului propus la o aprobare eșuată). Excepție unică: `fn_pt_manifest_administrare()` = conexiune fără claims JWT ca `postgres` / `supabase_admin` (modelul gărzii J05). JX-C3 + JX-C3b.
- **C4** rămâne CONSTATARE acceptată (derogarea J05 ocolește J02 și implicit J04; J07 rămâne impus) — singura constatare fixată.
- **Livrare la standard:** ambele migrări au garda `gazpet.livrare_migrare` (start + final), fără `BEGIN/COMMIT`, validator OK. Precondiții pinuite pe starea LIVE citită 06.10: J04 cere `fn_pt_pachet_depus_verifica` = R11 live (md5 `2fdd91f2…`) sau deja-J04; J07 cere `fn_gate_depunere` (md5 `04102c5e…`) și `fn_ofertare_pt_pachet_poarta_documentatie` (md5 `68620a64…`) exact ca live sau deja patch-uite, ACL-urile live, și J04 livrat înainte. Postcondiții: triggere exacte, SECDEF + search_path, ACL închis, J07 inserat exact o dată cu R5 / J05 păstrate.
- **Fixture = live:** transplantul J02b (20261004a) + garda J05 (20261001a) din repo reproduce EXACT amprentele live (md5 / SECDEF / volatilitate / search_path / ACL) ale celor 9 funcții urmărite — verificat în setup (`LIVE_0610`), deci și pinurile md5 trec în harness. Fișierul `j04xj07_live_0610.sql` a rămas gol: nu a fost nevoie de text copiat din producție.
- **Teste noi:** JX-J05-01 (derogare owner prin RPC + J07 stale → REFUZ J07; după recalcul → depusă pe derogare), JX-J05-02 (după depunere derogare_* înghețate pentru owner / editor / service_role; administrarea poate repara), JX-07k (poarta de rol a edge-urilor: anonim → 401, fără modul → 403, nimic persistat; runner-ul suportă `ca=anon`).
- **Mutanți noi:** XC1_manifest_fara_lock, XC1_manifest_orice_stare, XC2_orice_pass, XC3_manifest_rescriibil, XC3_service_ca_administrare, XP_poarta_oricine (edge).
- **Harness-urile vechi** (`test_jakv202_hash_server`, `test_jakv2p3_poarta_server`, `test_j04_j07_integrare`) aplică migrările prin garda de livrare (`scripts/pg/fixtures/livrare_garda.mjs`) și primesc același transplant live; harness-ul J07 izolat livrează J04 + revenirea lui (rămâne tabelul de dovezi, cerut de precondiția de ordine a lui J07).
- **JX-07e:** suprafața RPC SECDEF/VOLATILE cuprinde acum și cele 3 RPC-uri J02b (live identice; testate în `scripts/test_j02b_na_confirmare.mjs`).
- **Deschis — decizie Răzvan (L6):** precondiție la REVENIRE (ex. refuz dacă există pachete `aprobat` nedepuse, care după revenire s-ar putea depune fără J04/J07). Nu am inventat politica; revenirile rămân ca înainte.

## 0. Pe scurt

- **Ce e integrat:** J04 (#524, hash SHA-256 calculat pe server) și J07 (#527, poarta server cu 12 controale), prin merge local. Serverul impune ambele porți la `aprobat → depus`, independent una de alta.
- **Suita extinsă** (PostgreSQL 16 local, ASSERT în SQL): **74/74 PASS**. Componența: 63 de teste pe cerințele Copilot 1–9, JX-00 (schema), 6 teste JX-MX adăugate după verificarea prin mutații și 4 constatări fixate.
- **Verificarea prin mutații:** **73/73 mutanți uciși** (62 SQL + 11 edge), iar controlul negativ `M00_noop` supraviețuiește, cum trebuie. Toți cei 13 supraviețuitori din verdictul de la 29.09 sunt acum prinși: M16b + 5 variante pe funcție, M16c, M19b, X19e, M09s, X01c, M16f, M17b. La fel sunt prinse 8 variante noi: M16c pe fiecare funcție (5) și XH04a/b/c (3). Pe suita veche de 68 de teste, toate cele 21 supraviețuiau sau erau invizibile.
- **Restul testelor:** harness-urile PG vechi (10/10), testele Deno (4 + 41), `node --test` (11) și `npx vite build` sunt verzi. Comanda unică `bash scripts/test_j04xj07.sh --tot` iese cu 0 în 7 min 00 s.
- **Ce rămâne deschis** e în §7: edge-urile au rulat ca cod, nu deployate; clientul Supabase e simulat; constatările C1–C4 așteaptă decizie; CI-ul GitHub n-a rulat pe acest diff.

## 1. Cum s-a făcut integrarea

### 1.1 Commit-uri

| # | Commit | Ce conține |
|---|---|---|
| bază | `3df5614` | `origin/main` la 29.09 (#533) |
| 1 | `4073880` | merge `origin/jak/v2-j04-hash-server` @ `615553b` (J04, PR #524): **0 conflicte** (verificat cu `git merge-tree`) |
| 2 | `9574aeb` | merge `origin/jak/v2-j07-poarta-server` @ `03519ba` (J07, PR #527) peste J04: **2 conflicte**, rezolvate în §1.2 |
| 3 | `4b03281` | suita extinsă `supabase/tests/j04xj07` (68 de teste), 13 mutanți, pașii CI |
| 4 | commit-ul acestui document | reparațiile după verificarea prin mutații (§4) și acest raport |

Branch-urile sursă nu au fost atinse: fără push și fără rebase pe ele. Merge-ul s-a făcut doar în worktree.

### 1.2 Conflicte și rezolvări (fișier:linie)

1. **`src/OfertarePropunere.jsx`**, funcția `inregistreazaDepunere` (butonul „Marchează depus”, definită la `:1881`). Hunk-ul în conflict ocupa liniile 1902–1928 din fișierul cu markeri.
   - **Partea J04:** manifest idempotent (reluarea după un REFUZ nu rescrie manifestul append-only), apoi `supabase.functions.invoke('ofertare-pachet-verifica')`, refuzurile pe fișier afișate în UI și `update({stare:'depus'}).select('id').single()`.
   - **Partea J07:** `insert(rows)` în bloc, apoi `citestePoartaServer(supabase, licId, { recalculeazaText: true })` și `update({stare:'depus'})`.
   - **Rezolvarea** păstrează ambele verificări, înainte de `stare='depus'`, cum cere PLAN §2 J07. Se află la `src/OfertarePropunere.jsx:1902–1932`:
     - `:1902–1913` manifestul idempotent din J04;
     - `:1914–1918` comentariul cu regula: serverul le impune oricum pe amândouă la tranziție;
     - `:1919–1921` J04: invoke `ofertare-pachet-verifica` și afișarea refuzurilor;
     - `:1922–1923` J07: `citestePoartaServer(…, { recalculeazaText: true })`, apelat **după** manifest, pentru că hash-ul sursei include `pachet_fisiere`;
     - `:1924–1929` motivele se adună: rulează ambele verificări chiar dacă prima refuză, iar orice eroare sau răspuns invalid înseamnă BLOCK;
     - `:1930–1932` `update({ stare: 'depus' }).select('id').single()` și `if (!depus)`, preluate din J04.
2. **`docs/AUDIT_OFERTARE_V2/P3_TRIAJ_UI_ONLY.md`**, conflict add/add (git a tratat fișierul ca binar). Am păstrat versiunea din main: UTF-8, cu decizia H1. Copia din J07 era o versiune mai veche, în UTF-16, cu mojibake.

Restul fișierelor J07 s-au îmbinat automat: UI-ul (`src/Ofertare*.jsx`, `src/ofertare*.js`), edge-ul `ofertare-poarta-text`, fixture-urile și CI-ul.

### 1.3 Pe server: fișierele sunt identice cu sursele și nicio funcție nu e comună

- `git diff <branch-sursă> HEAD` dă **0 diferențe** pe:
  - migrările `20260930a_ofertare_pachet_hash_server_jakv202{,_ROLLBACK}.sql` (J04) și `20261003a_ofertare_poarta_server_jakv2p3{,_ROLLBACK}.sql` (J07);
  - `supabase/functions/ofertare-pachet-verifica/`, `ofertare-poarta-text/`, `_shared/poartaOfertare.ts` și `_shared/ofertarePoartaText.mjs`.

  Nici merge-ul, nici reparațiile de acum n-au atins SQL-ul de business sau codul edge.
- **Unde intră fiecare:**
  - J04 modifică `fn_pt_pachet_depus_verifica` (trigger `trg_pt_pachet_depus_verifica`).
  - J07 adaugă blocul `-- J07 BEGIN/END` în `fn_ofertare_pt_pachet_poarta_documentatie` (trigger `trg_ofertare_pt_pachet_poarta_documentatie`) și în `fn_gate_depunere` (licitația „depusă”).
  - Nicio funcție nu e modificată de amândouă.
- **Ordinea:** migrările rulează `20260930a` (J04) → `20261003a` (J07), fără coliziune de prefix. Pe `ofertare_pt_pachet`, triggerele BEFORE rulează în ordine alfabetică: matrice → documentație (R5 + J07) → depus (R11 + J04). JX-00 fixează ordinea și faptul că reaplicarea J04 → J07 e idempotentă.

### 1.4 Main a avansat

`origin/main` a ajuns la `76fd89d` (#534: `App.jsx`, `Executie.jsx`, `HrFormareProfesionala.jsx`, `Tichete.jsx`) și nu atinge niciun fișier J04/J07/Ofertare. Branch-ul **nu e rebazat** pe el; integrarea cu main o decide coordonatorul. După ea, `--tot` trebuie rulat din nou.

## 2. Cerințele Copilot (COPILOT_REVIEW_PLAN_A_2026-09-29 §2), numerotate 1–9

Numerotarea e cea din antetul fișierelor de test (`NN_*.sql` = cerința NN).

| # | Cerința (§2) | Teste |
|---|---|---|
| 1 | scenariul simetric: hash J04 invalid / lipsă / stale + poartă J07 permisivă → REFUZ | JX-01a…j, JX-MX-01c |
| 2 | inversul: hash J04 valid și curent + J07 BLOCK → REFUZ; include regula „o eroare internă = BLOCK” (PLAN §2 J07) | JX-02a…d, JX-MX-16a/b/c/f |
| 3 | traseul pozitiv: hash și poartă curente, toate condițiile fluxului normal satisfăcute → succes | JX-03a…c |
| 4 | fiecare dintre cele 12 controale J07 provocat separat, cu celelalte satisfăcute | JX-04-01…12, JX-04-07b, JX-04-13 (contraprobă), JX-MX-09s |
| 5 | probă concurentă deterministă: sursa, manifestul sau rezultatul se schimbă între verificare și tranziție; ambele porți impuse pe server, pe versiuni coerente | JX-05a…f (pași intercalați), JX-05g…j (două sesiuni reale, cu COMMIT) |
| 6 | `parser_version` schimbat, cu sursa neschimbată | JX-06a…d |
| 7 | scrierea directă pe căile API/RPC permise aplicației | JX-07a…j |
| 8 | la refuz, starea și dovezile anterioare nu sunt suprascrise | JX-08a…c, plus `jx.refuza` în toată suita (fotografie completă înainte și după fiecare refuz) |
| 9 | J04 A→B: reverify B cu manifestul încă pe A → REFUZ; PASS numai după un manifest sau o versiune nouă, printr-o tranziție permisă | JX-09a…e |

În plus: JX-00 (precondiția de schemă) și JX-C1…C4 (constatări fixate, nu cerințe; vezi §7).

## 3. Testele JX-*: ce dovedește fiecare și ce cerință acoperă

**Cum rulează un test:**
- Fiecare test e un bloc `BEGIN … ROLLBACK` într-o sesiune psql proprie, urmat de `jx.baza_intacta`: după ROLLBACK, baza trebuie să fie identică cu fotografia de bază.
- Fișierele marcate `-- @clona` (05g–05j, 10a) au nevoie de COMMIT-uri reale între două sesiuni. Rulează pe o clonă de unică folosință.
- Orice refuz trece prin `jx.refuza(sql, sqlstate, fragment)`: refuzul e obligatoriu, cu codul exact și fragmentul de mesaj, iar fotografia completă de dinainte și de după trebuie să fie aceeași.
- Pașii `-- @edge` rulează **handler-ele reale** ale edge-urilor (§4.2).

**Coloana „Mutanți prinși”** arată câți mutanți din catalog ucide testul, cu nume când sunt cel mult 4. Cifrele vin din rularea din §6.

| Test | Ce dovedește (descrierea din `jx.start`) | Cerința | Rezultat | Mutanți prinși |
|---|---|---|---|---|
| JX-00 | schema: J04→J07 aplicate și reaplicate fără diferențe; 3 triggere BEFORE active (matrice → J07 → J04); R5/R11/J05/matrice/politici neatinse | precondiție (schema J04→J07) | PASS | — (structural; exclus din numărătoare) |
| JX-01a | hash LIPSĂ (edge J04 nerulat / nedeployat) + J07 permisivă → REFUZ J04 | 1 | PASS | 2: fara_j04, j04_doar_depus_final |
| JX-01b | hash INVALID (bytes din bucket ≠ SHA din manifest) → edge J04 persistă REFUZ + J07 permisivă → REFUZ J04 | 1 | PASS | 5 |
| JX-01c | hash STALE: PASS, apoi obiectul reurcat cu ACEEAȘI bytes (updated_at nou) + J07 permisivă → REFUZ J04 (identitatea contează, nu doar SHA) | 1 | PASS | 3: fara_j04, j04_fara_identitate, j04_doar_depus_final |
| JX-01d | hash STALE: PASS, apoi obiectul suprascris cu ALȚI bytes (updated_at/eTag/size noi) + J07 permisivă → REFUZ J04 | 1 | PASS | 3: fara_j04, j04_fara_identitate, j04_doar_depus_final |
| JX-01e | hash STALE: PASS, apoi obiect șters + reurcat (alt obj_id, aceleași bytes) + J07 permisivă → REFUZ J04 | 1 | PASS | 3: fara_j04, j04_fara_identitate, j04_doar_depus_final |
| JX-01f | hash STALE: PASS, apoi obiectul ȘTERS din bucket + J07 permisivă → REFUZ J04 (obiect inexistent) | 1 | PASS | 2: fara_j04, j04_doar_depus_final |
| JX-01g | hash STALE: PASS, apoi obiectul GOLIT (size 0) + J07 permisivă → REFUZ J04 (obiect gol) | 1 | PASS | 2: fara_j04, j04_doar_depus_final |
| JX-01h | eroare internă J04 (RPC snapshot indisponibil) → 4 REFUZ persistate, fără PASS + J07 permisivă → REFUZ J04 | 1 | PASS | 4: fara_j04, j04_doar_depus_final, XH04b_handler_ok_ignora_refuz, XH04c_handler_refuz_nepersistat |
| JX-01i | hash PARȚIAL: obiect rescris ÎN TIMPUL verificării (snapshot înainte ≠ după) → 3 PASS + 1 REFUZ + J07 permisivă → REFUZ J04 pe acel fișier | 1 | PASS | 4: fara_j04, j04_doar_depus_final, XV_verificator_fara_snapshot_dupa, XH04c_handler_refuz_nepersistat |
| JX-01j | PASS FALS scris direct cu cheia de serviciu: calculat≠declarat → CHECK; SHA corect dar identitate de obiect inventată → acceptat ca rând, REFUZ la tranziție (J07 permisivă) | 1 | PASS | 3: fara_j04, j04_fara_identitate, j04_doar_depus_final |
| JX-02a | J04 PASS curent + J07 NErecalculată după manifestul depunerii (rezultate text stale) → REFUZ J07 | 2 | PASS | 16 |
| JX-02b | J04 PASS curent + J07 INDISPONIBILĂ (sursa text ilizibilă: edge 409, nimic scris) → REFUZ J07 | 2 | PASS | 12 |
| JX-02c | J04 PASS curent + agregatorul J07 aruncă eroare internă → tranziția cade (fail-closed), nimic scris | 2 | PASS | 4: fara_j07, M02c_impune_noop, j07_doar_la_aprobare, M16e_impune_inghite_eroarea |
| JX-02d | J04 PASS curent + edge J07 persistă „undetermined” (eroare de parser) pe hash-ul curent → REFUZ J07 | 2 | PASS | 8 |
| JX-03a | J04 PASS + J07 OK → pachet depus (1 rând, depus_la = ora serverului, aprobarea neatinsă) → licitație depusă | 3 | PASS | 1: j04_doar_depus_final |
| JX-03b | ordinea verificărilor nu contează: J07 înainte de J04 → depus (dovezile J04 nu intră în hash-ul J07) | 3 | PASS | 0 |
| JX-03c | reluare după refuz (ca UI-ul): primul „depus” refuzat fără J07 → nimic scris; J07 → al doilea „depus” reușește cu aceleași dovezi J04 | 3 | PASS | 10 |
| JX-04-01 | control cuprins singur BLOCK (cuprins gol: capitolele licitației șterse (cu legătura lor) — pachetul nu mai are niciun capitol) + celelalte 11 ok + J04 PASS → REFUZ cu [cuprins] | 4 | PASS | 5 |
| JX-04-02 | control neverificate singur BLOCK (cerință cu legătura de capitol BLOCATĂ de om (R09) — nu mai e verificată) + celelalte 11 ok + J04 PASS → REFUZ cu [neverificate] | 4 | PASS | 6 |
| JX-04-03 | control capcane singur BLOCK (cerință-capcană nouă („ofertele neconforme vor fi respinse”) fără capitol) + celelalte 11 ok + J04 PASS → REFUZ cu [capcane] | 4 | PASS | 6 |
| JX-04-04 | control goale singur BLOCK (capitol obligatoriu nou, fără conținut și fără fișier) + celelalte 11 ok + J04 PASS → REFUZ cu [goale] | 4 | PASS | 6 |
| JX-04-05 | control nescrise singur BLOCK (capitol obligatoriu nou scris de AI, nerescris de om) + celelalte 11 ok + J04 PASS → REFUZ cu [nescrise] | 4 | PASS | 6 |
| JX-04-06 | control cantitati_f3_grafic singur BLOCK (fronturile graficului (1200 m) nu mai corespund listei F3 (1000 m), peste toleranța de 0,1%) + celelalte 11 ok + J04 PASS → REFUZ cu [cantitati_f3_grafic] | 4 | PASS | 6 |
| JX-04-07 | control garantie singur BLOCK (garanția oferită (24 luni) sub minimul cerut (36 luni) — partea SQL structurată) + celelalte 11 ok + J04 PASS → REFUZ cu [garantie] | 4 | PASS | 8 |
| JX-04-08 | control anexe singur BLOCK (capitolul trimite la „Anexa 2”, care nu există în cuprins (evaluatorul text real)) + celelalte 11 ok + J04 PASS → REFUZ cu [anexe] | 4 | PASS | 8 |
| JX-04-09 | control numere singur BLOCK (capitolul spune 371 branșamente, cerințele 372 (evaluatorul text real)) + celelalte 11 ok + J04 PASS → REFUZ cu [numere] | 4 | PASS | 8 |
| JX-04-10 | control pachet singur BLOCK (piesă declarată („Anexa 2”) fără fișier în pachetul final (evaluatorul text real)) + celelalte 11 ok + J04 PASS → REFUZ cu [pachet] | 4 | PASS | 8 |
| JX-04-11 | control grafic_relatii singur BLOCK (versiune nouă de grafic cu relație FS contrazisă de datele declarate (B începe înainte să se termine A)) + celelalte 11 ok + J04 PASS → REFUZ cu [grafic_relatii] | 4 | PASS | 6 |
| JX-04-12 | control grafic_sursa singur BLOCK (piesă de grafic depusă, generată din altă versiune (grafic@v7) decât cea înghețată (v1)) + celelalte 11 ok + J04 PASS → REFUZ cu [grafic_sursa] | 4 | PASS | 6 |
| JX-04-07b | control garantie singur BLOCK prin TEXT (structurat ok 36/36, dar capitolul spune 48 luni; evaluatorul real) + celelalte 11 ok + J04 PASS → REFUZ cu [garantie] | 4 | PASS | 9 |
| JX-04-13 | contraprobă: fără schimbare, același flux (J04 + J07) → blocaje=[] și depus reușește; agregatorul are exact cele 12 controale | 4 | PASS | 2: j07_doar_cuprins, j07_fara_text |
| JX-05a | SURSA J07 editată între verificare și tranziție → REFUZ J07 (hash nou); după recalcul → depus (J04 rămâne valabil) | 5 | PASS | 15 |
| JX-05b | MANIFEST: rând depus_final nou între verificare și tranziție → REFUZ J07 (hash) → după recalcul J07, REFUZ J04 (fără PASS pe fișierul nou) → după reverificare, depus | 5 | PASS | 11 |
| JX-05c | REZULTAT J07: rând nou „block” pe ACELAȘI hash între verificare și tranziție → REFUZ (ultimul rezultat câștigă) | 5 | PASS | 7 |
| JX-05d | OBIECT J04 rescris între verificare și tranziție (J07 rămâne OK: obiectele nu intră în hash-ul J07) → REFUZ J04 | 5 | PASS | 3: fara_j04, j04_fara_identitate, j04_doar_depus_final |
| JX-05e | CONTROL SQL (fronturi grafic) schimbat între verificare și tranziție → REFUZ: controalele SQL se evaluează live la tranziție, nu din cache | 5 | PASS | 5 |
| JX-05f | „stale” se decide prin HASH, nu prin timp: sursa schimbată → REFUZ; readusă byte-identic → același hash → verdictul vechi valabil → depus | 5 | PASS | 15 |
| JX-05g | două sesiuni: A verificat + vede OK în tranzacția ei; B editează sursa J07 și face COMMIT → tranziția lui A REFUZATĂ | 5 | PASS | 10 |
| JX-05h | două sesiuni: B adaugă un fișier în manifest și face COMMIT după verificarea lui A → tranziția lui A REFUZATĂ (J07, apoi J04) | 5 | PASS | 10 |
| JX-05i | două sesiuni: B persistă un rezultat J07 „block” pe același hash și face COMMIT → tranziția lui A REFUZATĂ | 5 | PASS | 7 |
| JX-05j | două sesiuni pe obiect: rescris+COMMIT de B → REFUZ J04; în timpul tranziției lui A, B blocat pe FOR SHARE (55P03); după COMMIT, obiect înghețat R12 | 5 | PASS | 6 |
| JX-06a | parser_version nou pe server, sursa identică (același sursa_hash) + J04 PASS → cele 4 rezultate text vechi nu mai contează → REFUZ | 6 | PASS | 13 |
| JX-06b | edge-ul J07 rămas pe parserul v1 după upgrade-ul serverului la v2 → 409, nimic persistat → REFUZ în continuare | 6 | PASS | 9 |
| JX-06c | rezultat „ok” scris cu ALT parser_version (v0) pe hash-ul curent → ignorat → REFUZ; reevaluarea cu parserul serverului → depus | 6 | PASS | 16 |
| JX-06d | după upgrade la v2, edge-ul v2 reevaluează aceeași sursă → rezultate v2 → depus (calea permisă spre verde e reevaluarea) | 6 | PASS | 0 |
| JX-07a | PATCH direct stare=depus (editor, fără UI): fără nicio verificare → REFUZ J07; cu J07 OK dar fără J04 → REFUZ J04 | 7 | PASS | 11 |
| JX-07b | POST pachet nou direct în „depus”/„aprobat” (editor → RLS) → REFUZ; UPSERT pe pachetul existent fără verificări → REFUZ; cheia de serviciu cu J04+J07 OK → INSERT „depus” tot REFUZ (J07 pachet_versiune) | 7 | PASS | 12 |
| JX-07c | ocoliri pe coloane (editor): depus_la / aprobat_* / versiune / licitatie_id / retrogradare aprobat→propus → REFUZ; depus_la antedatat e rescris de server | 7 | PASS | 2: M18a_fara_trigger_matrice, M18b_matrice_orice_tranzitie |
| JX-07d | dovezi falsificate prin API: INSERT/UPDATE/DELETE pe verificări J04 și rezultate J07 (editor, anon) → permission denied | 7 | PASS | 2: M18d_dovezi_update_authenticated, M18e_dovezi_update_authenticated_fara_trigger |
| JX-07e | RPC-uri: cele interne J04/J07 (snapshot, sursă text, impune, controale) neexecutabile de authenticated/anon; poarta_server e read-only; suprafața RPC SECURITY DEFINER volatilă e cunoscută și nu atinge pachetul/dovezile | 7 | PASS | 1: M18f_rpc_ocolire_triggere |
| JX-07f | licitație „depusă” prin API: fără pachet depus → REFUZ J02; derogare de ne-owner (RPC sau coloană) → 42501; derogare owner cu J07 BLOCK → REFUZ J07, auditul J05 anulat atomic | 7 | PASS | 10 |
| JX-07g | Storage prin API (editor): obiectele din pachetul aprobat sunt înghețate — UPDATE/DELETE fără efect, reupload la aceeași cale refuzat, upsert refuzat | 7 | PASS | 0 |
| JX-07h | cheia de serviciu (BYPASSRLS), fără dovezi: UPDATE stare=depus → REFUZ (triggerele nu se ocolesc cu BYPASSRLS) | 7 | PASS | 11 |
| JX-07i | fără drept: utilizator fără modulul Ofertare → UPDATE fără efect (RLS); anon → fără efect sau permission denied; chiar cu ambele verificări OK | 7 | PASS | 2: M18c_rls_update_liber, M18h_fara_gate_licitatie |
| JX-07j | după depunere pachetul e imuabil pe orice cale: editor → fără efect (RLS), cheia de serviciu → REFUZ; manifestul nu mai primește rânduri | 7 | PASS | 2: M18a_fara_trigger_matrice, M18c_rls_update_liber |
| JX-08a | dovezi acumulate (REFUZ J04 tehnic + PASS J04 + rezultate J07) rămân byte-identice după 5 refuzuri de tipuri diferite; stare, aprobare, depus_la neatinse | 8 | PASS | 11 |
| JX-08b | append-only pe server: UPDATE/DELETE/TRUNCATE pe verificările J04 și rezultatele J07 → REFUZ pentru cheia de serviciu (GRANT) și superuser (trigger, toate cele 6 combinații); DELETE pe auditul J05 refuzat; manifest/pachet nemodificabile din API | 8 | PASS | 8 |
| JX-08c | edge-urile refuzate nu scriu nimic: J04 pe pachet inexistent (404) sau depus (409), J07 pe sursă ilizibilă (409); rezultatele noi se ADAUGĂ, cele vechi rămân (prefix identic) | 8 | PASS | 1: XH04a_handler_orice_stare |
| JX-09a | A verificat (PASS) → obiect înlocuit cu B → REFUZ (verificare veche); reverify B cu manifestul pe A → REFUZ persistat (SHA diferit) → tranziția tot REFUZ | 9 | PASS | 3: fara_j04, j04_fara_identitate, XV_verificator_fara_sha |
| JX-09b | PASS „fabricat” pentru B (cheia de serviciu, identitatea reală a obiectului B): calculat=declarat=B → acceptat ca rând, dar nu acoperă manifestul A → REFUZ; calculat=B/declarat=A → CHECK | 9 | PASS | 3: fara_j04, M01b_j04_fara_potrivire_sha, XV_verificator_fara_sha |
| JX-09c | aplicația NU poate „actualiza” manifestul A→B pe v1: UPDATE/DELETE → permission denied; rând duplicat → unique; rând nou B lângă A → A tot cere PASS pe bytes A → REFUZ | 9 | PASS | 3: fara_j04, M18g_manifest_update_authenticated, XV_verificator_fara_sha |
| JX-09d | calea PERMISĂ: pachet nou v2 (propus → manifest → J07 → aprobat → depunere cu B → J04 + J07) → depus; v1 nu mai poate fi depus, deși are PASS valabil pe bytes-ii A (J07 pachet_versiune) | 9 | PASS | 13 |
| JX-09e | A→B→A: bytes-ii A readuși (identitate nouă) → PASS-ul vechi e stale → REFUZ; reverify → PASS pe A → depus (PASS = bytes din manifest + obiectul curent) | 9 | PASS | 2: fara_j04, j04_fara_identitate |
| JX-C2 | CONSTATARE #4: PASS vechi + REFUZ ulterior pe ACEEAȘI identitate de obiect (bytes schimbați sub metadate) → J04 lasă tranziția să treacă | constatare (nu cerință) | PASS | 2: XV_verificator_fara_sha, XH04c_handler_refuz_nepersistat |
| JX-C3 | CONSTATARE: cheia de serviciu poate RESCRIE manifestul (sha256 A→B) și apoi depune B pe pachetul v1, fără versiune nouă | constatare (nu cerință) | PASS | 1: j04_doar_depus_final |
| JX-C4 | CONSTATARE #3: derogarea J05 (owner) + J07 OK → licitație depusă cu pachetul doar aprobat, fără nicio dovadă J04 | constatare (nu cerință) | PASS | 1: M18h_fara_gate_licitatie |
| JX-C1 | CONSTATARE #1: INSERT concurent în manifest în timpul tranziției → pachet depus cu fișier fără PASS (cursa reprodusă, neremediată) | constatare (nu cerință) | PASS | 0 |
| JX-MX-16a | eroare internă REALĂ într-un control SQL (grafic scris de om / AI cu „es” nenumeric) → grafic_relatii undetermined, nu ok → REFUZ; celelalte 11 ok, J04 PASS | 2 + PLAN J07 „eroare = BLOCK” | PASS | 9 |
| JX-MX-16b | eroare internă în sursa comună (v_ofertare_pt_stare aruncă la citire) → TOATE cele 12 controale undetermined (fail-closed pe fiecare handler de excepție) → REFUZ | 2 + PLAN J07 „eroare = BLOCK” | PASS | 25 |
| JX-MX-16c | date indisponibile fără excepție (licitația lipsește din v_ofertare_pt_stare: st NULL, contor NULL) → TOATE cele 12 controale undetermined → REFUZ | 2 + PLAN J07 „lipsă = BLOCK” | PASS | 25 |
| JX-MX-16f | contract rupt sursă SQL ↔ evaluator (coloana fraze_anexe redenumită în v_ofertare_pt_stare): evaluatorul REAL aruncă pe anexe → undetermined persistat (nu ok) → REFUZ [anexe] | 2 + PLAN J07 „eroare = BLOCK” | PASS | 9 |
| JX-MX-09s | garanția STRUCTURATĂ (24 < 36) blochează independent de text: și cu un rezultat text „ok” pe hash-ul curent → REFUZ [garantie], detaliul din SQL | 4 | PASS | 7 |
| JX-MX-01c | REFUZ al edge-ului cu SHA = manifest și identitatea curentă (dimensiune din metadate ≠ bytes) nu ține loc de PASS → REFUZ J04 (J07 permisivă) | 1 | PASS | 4: fara_j04, X01c_j04_accepta_orice_rezultat, XH04b_handler_ok_ignora_refuz, XH04c_handler_refuz_nepersistat |

## 4. Verificarea prin mutații

### 4.1 Ce a găsit verdictul din 29.09 și ce s-a reparat

| Constatare (severitate) | Reparație | Dovadă (§6) |
|---|---|---|
| **M16** „eroare internă → ok” nu era prins pe 8 din cele 12 controale J07, cele SQL (**major**) | Trei teste noi în `11_mx_mutatii.sql`: **JX-MX-16a** (grafic cu „es” nenumeric, eroare SQL reală în `ofertare_ctl_grafic_relatii`); **JX-MX-16b** (view-ul comun `v_ofertare_pt_stare` aruncă 22012 → toate 12 undetermined); **JX-MX-16c** (licitația lipsește din view, fără excepție → toate 12 undetermined). În catalog: M16b combinat + 5 variante pe funcție; M16c combinat + 5 variante pe funcție, acestea din urmă noi | M16b_* sunt uciși de JX-MX-16b (cel pe `grafic_relatii` și de 16a). M16c_* sunt uciși de JX-MX-16c. Toți 12 supraviețuiau suitei vechi: pentru M16b pe funcție dovada e în jurnalele verificării, restul l-am reconfirmat azi pe `4b03281` |
| JX-08b testa doar 4 din cele 6 combinații append-only pe superuser (minor) | JX-08b acoperă acum toate cele 6: am adăugat UPDATE pe `ofertare_poarta_rezultate_text` (`08_refuz_nu_suprascrie.sql:54`) și DELETE pe `ofertare_pt_pachet_verificari` (`:52`) | M19b și X19e: uciși de JX-08b |
| JX-04-07 nu separa cele două straturi ale garanției (M09s, minor) | JX-04-07 verifică acum și `detalii` = mesajul ramurii SQL structurate (`04_controale_j07.sql:119`). **JX-MX-09s**: un rezultat text „ok” injectat pe hash-ul curent, cu structurat 24 < 36 → tot BLOCK, cu detaliul din SQL | M09s: ucis de JX-04-07 și JX-MX-09s |
| Clauza `v.rezultat = 'PASS'` din predicatul J04 nu era fixată de niciun test (X01c, minor) | **JX-MX-01c**: un REFUZ al edge-ului cu SHA egal cu manifestul și identitatea obiectului curent (metadatele spun 999 B, bytes-ii sunt 8 B) nu ține loc de PASS | X01c: ucis de JX-MX-01c |
| Codul de legătură al edge-urilor (handler.ts / index.ts) era duplicat în runner, deci invizibil suitei SQL (M17b, M16f, minor) | Runner-ul rulează acum **handler-ele reale** (§4.2), iar statusul HTTP e verificat strict. Catalogul are 11 mutanți edge. **JX-MX-16f**: contract rupt între sursa SQL și evaluator (coloană redenumită în view) → evaluatorul real aruncă → undetermined persistat → REFUZ. Pentru GO rămân obligatorii și testele Deno și `node --test` (`--si-edge`, deja în CI) | M17b: ucis de JX-06b. M16f: ucis de JX-MX-16f. XH04a/b/c (noi): uciși de JX-08c, JX-01b, JX-01h, JX-01i, JX-05j, JX-08a, JX-C2, JX-MX-01c |

Implementarea J04/J07 **nu s-a schimbat**: toate constatările erau lipsuri de test, iar codul verificat era corect. Suita nouă trece integral pe codul nemutat.

### 4.2 Cum rulează acum edge-urile în suita SQL (`scripts/pg/test_j04xj07.mjs`)

- **Handler-ele reale:** un pas `-- @edge j04 <pachet>` apelează `creeazaHandler()` din `ofertare-pachet-verifica/index.ts`, iar `-- @edge j07 <licitație>` apelează `handle()` din `ofertare-poarta-text/handler.ts`. Ambele trec prin poarta de rol reală, `_shared/poartaOfertare.ts`, și folosesc `verificare.mjs` și `evalueaza.mjs` reale. Node importă fișierele `.ts` prin type stripping, deci e nevoie de **Node ≥ 22.18**: runner-ul verifică și refuză altfel.
- **Ce e simulat:**
  - Clientul Supabase e un „PostgREST” minimal peste sesiunea psql a testului (`jx.rest`). Fiecare apel e o instrucțiune SQL rulată într-o subtranzacție; o eroare SQL devine `{ error }`, ca la PostgREST, fără să rupă tranzacția testului.
  - Edge-ul lucrează ca `service_role`. Poarta de rol rulează `fn_are_acces_ofertare` ca `authenticated`, cu claims-urile utilizatorului.
  - Download-ul din Storage citește bytes-ii din `jx.bucket`, iar metadatele stau în `storage.objects`.
- **Status strict:** fiecare pas `@edge` trebuie să întoarcă 200, sau statusul cerut explicit (`status=404` / `status=409`). Un edge căzut (5xx) sau un 409 neașteptat oprește testul, deci nu poate trece drept „refuz”.
- **`parser=<v>`:** același cod, „deployat” cu `PARSER_VERSION = <v>`, dintr-o copie temporară a edge-urilor.
- **Mutant edge:** o copie temporară a celor 6 fișiere edge, cu înlocuirea aplicată. Copia se încarcă **după** starea de bază, deci baza se construiește cu edge-urile reale. Dacă ancora lipsește sau importul pică, mutantul e NEAPLICAT, adică FAIL, nu „ucis”.

### 4.3 Tabelul mutațiilor M1–M19 (+ X): testele care le prind

- **Catalogul** e în `scripts/pg/fixtures/j04xj07_mutanti.mjs`:
  - **Mutanții SQL** sunt blocuri DO care rescriu implementarea reală din baza de test (funcție, trigger, politică, grant). Refuză să se aplice dacă ancora lipsește sau efectul nu se vede.
  - **Mutanții edge** sunt înlocuiri textuale pe copia temporară.
  - Cele 13 nume vechi (`fara_j04` etc.) sunt păstrate. Dublurile exacte M01a, M02a, M02d, M16d, M17a nu se rulează a doua oară: echivalența e notată în coloana „Ce strică”.
- **Coloana „Înainte”:** rezultatul pe suita de 68 de teste (verificarea din 29.09, reconfirmată azi pe `4b03281` pentru mutanții reparați sau noi).
- **Coloana „Acum”:** rezultatul pe suita de 74 de teste (§6).

| Grup | Mutant | Fel | Ce strică | Înainte (suita de 68, 29.09) | Acum: prins de |
|---|---|---|---|---|---|
| control | `M00_noop` | sql | control negativ: nicio schimbare (trebuie să supraviețuiască) | SUPRAVIEȚUIA (corect) | SUPRAVIEȚUIEȘTE (corect: control negativ) |
| M1 | `fara_j04` | sql | (= M01a) bucla J04 scoasă din fn_pt_pachet_depus_verifica: rămâne doar R11 (rolurile depus_final / dovada_seap prezente) | UCIS | **UCIS** (24): JX-01a, JX-01b, JX-01c, JX-01d, JX-01e, JX-01f, JX-01g, JX-01h, JX-01i, JX-01j, JX-05b, JX-05d, JX-05h, JX-05j, JX-07a, JX-07b, JX-07h, JX-08a, JX-09a, JX-09b, JX-09c, JX-09d, JX-09e, JX-MX-01c |
| M1 | `M01b_j04_fara_potrivire_sha` | sql | dovada PASS nu mai trebuie să aibă SHA-ul din manifest | UCIS | **UCIS** (1): JX-09b |
| M1 (X) | `X01c_j04_accepta_orice_rezultat` | sql | orice rând de verificare (și un REFUZ) cu SHA + identitate potrivite ține loc de PASS | SUPRAVIEȚUIA (reconfirmat 29.09 pe 4b03281) | **UCIS** (1): JX-MX-01c |
| M1 | `j04_fara_identitate` | sql | PASS acceptat fără identitatea obiectului (id / updated_at / eTag / size) | UCIS | **UCIS** (9): JX-01c, JX-01d, JX-01e, JX-01j, JX-05d, JX-05j, JX-08a, JX-09a, JX-09e |
| M1 | `j04_fara_lock` | sql | fără FOR SHARE pe storage.objects până la COMMIT (obiectul poate fi rescris în timpul tranziției) | UCIS | **UCIS** (1): JX-05j |
| M1 | `j04_doar_depus_final` | sql | dovadă cerută doar pentru depus_final (propunerea, borderoul, dovada SEAP scapă) | UCIS | **UCIS** (32): JX-01a, JX-01b, JX-01c, JX-01d, JX-01e, JX-01f, JX-01g, JX-01h, JX-01i, JX-01j, JX-02a, JX-03a, JX-04-01, JX-04-02, JX-04-03, JX-04-04, JX-04-05, JX-04-06, JX-04-07, JX-04-08, JX-04-09, JX-04-10, JX-04-11, JX-04-12, JX-04-07b, JX-05d, JX-05j, JX-08a, JX-09d, JX-C3, JX-MX-16a, JX-MX-16f |
| M2 | `fara_j07` | sql | (= M02a) blocul J07 scos din triggerul pachetului | UCIS | **UCIS** (39): JX-02a, JX-02b, JX-02c, JX-02d, JX-03c, JX-04-01, JX-04-02, JX-04-03, JX-04-04, JX-04-05, JX-04-06, JX-04-07, JX-04-08, JX-04-09, JX-04-10, JX-04-11, JX-04-12, JX-04-07b, JX-05a, JX-05b, JX-05c, JX-05e, JX-05f, JX-05g, JX-05h, JX-05i, JX-06a, JX-06b, JX-06c, JX-07a, JX-07b, JX-07h, JX-08a, JX-09d, JX-MX-16a, JX-MX-16b, JX-MX-16c, JX-MX-16f, JX-MX-09s |
| M2 | `M02b_fara_j07_licitatie` | sql | blocul J07 scos din fn_gate_depunere (licitație „depusă”) | UCIS | **UCIS** (1): JX-07f |
| M2 | `M02c_impune_noop` | sql | ofertare_poarta_impune nu mai impune nimic | UCIS | **UCIS** (40): JX-02a, JX-02b, JX-02c, JX-02d, JX-03c, JX-04-01, JX-04-02, JX-04-03, JX-04-04, JX-04-05, JX-04-06, JX-04-07, JX-04-08, JX-04-09, JX-04-10, JX-04-11, JX-04-12, JX-04-07b, JX-05a, JX-05b, JX-05c, JX-05e, JX-05f, JX-05g, JX-05h, JX-05i, JX-06a, JX-06b, JX-06c, JX-07a, JX-07b, JX-07f, JX-07h, JX-08a, JX-09d, JX-MX-16a, JX-MX-16b, JX-MX-16c, JX-MX-16f, JX-MX-09s |
| M2 | `j07_doar_la_aprobare` | sql | (= M02d) J07 impus doar la propus→aprobat, nu și la aprobat→depus | UCIS | **UCIS** (39): JX-02a, JX-02b, JX-02c, JX-02d, JX-03c, JX-04-01, JX-04-02, JX-04-03, JX-04-04, JX-04-05, JX-04-06, JX-04-07, JX-04-08, JX-04-09, JX-04-10, JX-04-11, JX-04-12, JX-04-07b, JX-05a, JX-05b, JX-05c, JX-05e, JX-05f, JX-05g, JX-05h, JX-05i, JX-06a, JX-06b, JX-06c, JX-07a, JX-07b, JX-07h, JX-08a, JX-09d, JX-MX-16a, JX-MX-16b, JX-MX-16c, JX-MX-16f, JX-MX-09s |
| M2 | `fara_pachet_versiune` | sql | fără verificarea „pachetul curent” (pachet_versiune) | UCIS | **UCIS** (2): JX-07b, JX-09d |
| M3 | `M03_cuprins` | sql | controlul cuprins întoarce mereu ok | UCIS | **UCIS** (3): JX-04-01, JX-MX-16b, JX-MX-16c |
| M4 | `M04_neverificate` | sql | controlul neverificate întoarce mereu ok | UCIS | **UCIS** (4): JX-04-02, JX-08a, JX-MX-16b, JX-MX-16c |
| M5 | `M05_capcane` | sql | controlul capcane întoarce mereu ok | UCIS | **UCIS** (3): JX-04-03, JX-MX-16b, JX-MX-16c |
| M6 | `M06_goale` | sql | controlul goale întoarce mereu ok | UCIS | **UCIS** (3): JX-04-04, JX-MX-16b, JX-MX-16c |
| M7 | `M07_nescrise` | sql | controlul nescrise întoarce mereu ok | UCIS | **UCIS** (3): JX-04-05, JX-MX-16b, JX-MX-16c |
| M8 | `M08_cantitati_f3_grafic` | sql | controlul cantitati_f3_grafic întoarce mereu ok | UCIS | **UCIS** (4): JX-04-06, JX-05e, JX-MX-16b, JX-MX-16c |
| M9 | `M09_garantie` | sql | controlul garantie întoarce mereu ok (ambele straturi) | UCIS | **UCIS** (11): JX-02a, JX-02b, JX-04-07, JX-04-07b, JX-05a, JX-05f, JX-06a, JX-06c, JX-MX-16b, JX-MX-16c, JX-MX-09s |
| M9 | `M09s_garantie_doar_structurat` | sql | garanția fără ramura SQL structurată (rămâne doar rezultatul text) | SUPRAVIEȚUIA (reconfirmat 29.09 pe 4b03281) | **UCIS** (2): JX-04-07, JX-MX-09s |
| M9 | `M09t_garantie_doar_text` | sql | garanția fără rezultatul text (rămâne doar ramura structurată) | UCIS | **UCIS** (7): JX-02a, JX-02b, JX-04-07b, JX-05a, JX-05f, JX-06a, JX-06c |
| M10 | `M10_anexe` | sql | controlul text anexe întoarce mereu ok | UCIS | **UCIS** (11): JX-02a, JX-02b, JX-02d, JX-04-08, JX-05a, JX-05f, JX-06a, JX-06c, JX-MX-16b, JX-MX-16c, JX-MX-16f |
| M11 | `M11_numere` | sql | controlul text numere întoarce mereu ok | UCIS | **UCIS** (10): JX-02a, JX-02b, JX-04-09, JX-05a, JX-05c, JX-05f, JX-06a, JX-06c, JX-MX-16b, JX-MX-16c |
| M12 | `M12_pachet` | sql | controlul text pachet întoarce mereu ok | UCIS | **UCIS** (10): JX-02a, JX-02b, JX-04-10, JX-05a, JX-05f, JX-05i, JX-06a, JX-06c, JX-MX-16b, JX-MX-16c |
| M13 | `M13_grafic_relatii` | sql | controlul grafic_relatii întoarce mereu ok | UCIS | **UCIS** (4): JX-04-11, JX-MX-16a, JX-MX-16b, JX-MX-16c |
| M14 | `M14_grafic_sursa` | sql | controlul grafic_sursa întoarce mereu ok | UCIS | **UCIS** (3): JX-04-12, JX-MX-16b, JX-MX-16c |
| M3–M14 | `j07_doar_cuprins` | sql | agregatorul evaluează un singur control (cuprins) — „implementarea care verifică doar unul” | UCIS | **UCIS** (39): JX-02a, JX-02b, JX-02d, JX-03c, JX-04-02, JX-04-03, JX-04-04, JX-04-05, JX-04-06, JX-04-07, JX-04-08, JX-04-09, JX-04-10, JX-04-11, JX-04-12, JX-04-07b, JX-04-13, JX-05a, JX-05b, JX-05c, JX-05e, JX-05f, JX-05g, JX-05h, JX-05i, JX-06a, JX-06b, JX-06c, JX-07a, JX-07b, JX-07f, JX-07h, JX-08a, JX-09d, JX-MX-16a, JX-MX-16b, JX-MX-16c, JX-MX-16f, JX-MX-09s |
| M3–M14 | `j07_fara_text` | sql | agregatorul fără cele 4 controale text | UCIS | **UCIS** (29): JX-02a, JX-02b, JX-02d, JX-03c, JX-04-07, JX-04-08, JX-04-09, JX-04-10, JX-04-07b, JX-04-13, JX-05a, JX-05b, JX-05c, JX-05f, JX-05g, JX-05h, JX-05i, JX-06a, JX-06b, JX-06c, JX-07a, JX-07b, JX-07f, JX-07h, JX-09d, JX-MX-16b, JX-MX-16c, JX-MX-16f, JX-MX-09s |
| M15 | `M15a_stale_ttl_24h` | sql | „proaspăt” = calculat în ultimele 24 h, nu pe hash-ul sursei | UCIS | **UCIS** (13): JX-02a, JX-03c, JX-05a, JX-05b, JX-05f, JX-05g, JX-05h, JX-06c, JX-07a, JX-07b, JX-07f, JX-07h, JX-09d |
| M15 | `M15b_stale_dupa_ultimul_manifest` | sql | „proaspăt” = calculat după ultimul rând de manifest, nu pe hash | UCIS | **UCIS** (11): JX-02a, JX-03c, JX-05a, JX-05b, JX-05f, JX-05g, JX-06c, JX-07a, JX-07b, JX-07f, JX-07h |
| M15 | `j07_fara_hash` | sql | (M15c) rezultatul text nelegat de hash-ul sursei | UCIS | **UCIS** (13): JX-02a, JX-03c, JX-05a, JX-05b, JX-05f, JX-05g, JX-05h, JX-06c, JX-07a, JX-07b, JX-07f, JX-07h, JX-09d |
| M15 | `j07_primul_rezultat` | sql | (M15d) primul rezultat pe hash, nu ultimul (o reevaluare „block” ulterioară ignorată) | UCIS | **UCIS** (3): JX-02d, JX-05c, JX-05i |
| M16 | `M16a_text_eroare_ok` | sql | ofertare_ctl_text: excepție → ok | UCIS | **UCIS** (3): JX-02b, JX-MX-16b, JX-MX-16c |
| M16 | `M16b_sql_eroare_ok` | sql | excepție → ok în toate cele 5 funcții SQL cu handler propriu | SUPRAVIEȚUIA (reconfirmat 29.09 pe 4b03281) | **UCIS** (2): JX-MX-16a, JX-MX-16b |
| M16 | `M16b_contor` | sql | excepție → ok în ofertare_ctl_contor (cuprins / neverificate / capcane / goale / nescrise) | SUPRAVIEȚUIA | **UCIS** (1): JX-MX-16b |
| M16 | `M16b_cantitati_f3_grafic` | sql | excepție → ok în ofertare_ctl_cantitati_f3_grafic | SUPRAVIEȚUIA | **UCIS** (1): JX-MX-16b |
| M16 | `M16b_garantie` | sql | excepție → ok în ofertare_ctl_garantie | SUPRAVIEȚUIA | **UCIS** (1): JX-MX-16b |
| M16 | `M16b_grafic_sursa` | sql | excepție → ok în ofertare_ctl_grafic_sursa | SUPRAVIEȚUIA | **UCIS** (1): JX-MX-16b |
| M16 | `M16b_grafic_relatii` | sql | excepție → ok în ofertare_ctl_grafic_relatii | SUPRAVIEȚUIA | **UCIS** (2): JX-MX-16a, JX-MX-16b |
| M16 | `M16c_sql_indisponibil_ok` | sql | „date indisponibile” fără excepție (view fără rând / contor NULL) → ok în toate 5 | SUPRAVIEȚUIA (reconfirmat 29.09 pe 4b03281) | **UCIS** (1): JX-MX-16c |
| M16 | `M16c_contor` | sql | contor indisponibil → ok | SUPRAVIEȚUIA (reconfirmat 29.09 pe 4b03281) | **UCIS** (1): JX-MX-16c |
| M16 | `M16c_cantitati_f3_grafic` | sql | comparația F3 / grafic indisponibilă → ok | SUPRAVIEȚUIA (reconfirmat 29.09 pe 4b03281) | **UCIS** (1): JX-MX-16c |
| M16 | `M16c_garantie` | sql | garanția structurată indisponibilă → ok | SUPRAVIEȚUIA (reconfirmat 29.09 pe 4b03281) | **UCIS** (1): JX-MX-16c |
| M16 | `M16c_grafic_sursa` | sql | sursa graficului indisponibilă → ok | SUPRAVIEȚUIA (reconfirmat 29.09 pe 4b03281) | **UCIS** (1): JX-MX-16c |
| M16 | `M16c_grafic_relatii` | sql | datele graficului indisponibile → ok | SUPRAVIEȚUIA (reconfirmat 29.09 pe 4b03281) | **UCIS** (1): JX-MX-16c |
| M16 | `j07_undetermined_ok` | sql | (= M16d) agregatorul blochează doar pe „block”: undetermined trece | UCIS | **UCIS** (21): JX-02a, JX-02b, JX-02d, JX-03c, JX-05a, JX-05b, JX-05f, JX-05g, JX-05h, JX-06a, JX-06b, JX-06c, JX-07a, JX-07b, JX-07f, JX-07h, JX-09d, JX-MX-16a, JX-MX-16b, JX-MX-16c, JX-MX-16f |
| M16 | `M16e_impune_inghite_eroarea` | sql | ofertare_poarta_impune înghite eroarea agregatorului | UCIS | **UCIS** (1): JX-02c |
| M16 | `M16g_text_lipsa_ok` | sql | rezultat text lipsă → ok | UCIS | **UCIS** (15): JX-02a, JX-03c, JX-05a, JX-05b, JX-05f, JX-05g, JX-05h, JX-06a, JX-06b, JX-06c, JX-07a, JX-07b, JX-07f, JX-07h, JX-09d |
| M17 | `j07_ignora_parser` | sql | (= M17a) ofertare_ctl_text ignoră parser_version | UCIS | **UCIS** (3): JX-06a, JX-06b, JX-06c |
| M18 | `M18a_fara_trigger_matrice` | sql | triggerul matricei de tranziții șters | UCIS | **UCIS** (4): JX-07c, JX-07j, JX-08a, JX-09d |
| M18 | `M18b_matrice_orice_tranzitie` | sql | matricea permite orice tranziție de stare | UCIS | **UCIS** (2): JX-07c, JX-08a |
| M18 | `M18c_rls_update_liber` | sql | RLS: authenticated poate UPDATE orice pachet, fără modulul Ofertare | UCIS | **UCIS** (2): JX-07i, JX-07j |
| M18 | `M18d_dovezi_update_authenticated` | sql | authenticated poate UPDATE dovezile (triggerele append-only rămân) | UCIS | **UCIS** (1): JX-07d |
| M18 | `M18e_dovezi_update_authenticated_fara_trigger` | sql | ca M18d + triggerele append-only fără UPDATE | UCIS | **UCIS** (2): JX-07d, JX-08b |
| M18 | `M18f_rpc_ocolire_triggere` | sql | RPC SECURITY DEFINER pentru authenticated care depune cu triggerele oprite (session_replication_role) | UCIS | **UCIS** (1): JX-07e |
| M18 | `M18g_manifest_update_authenticated` | sql | manifestul devine modificabil de authenticated | UCIS | **UCIS** (2): JX-08b, JX-09c |
| M18 | `M18h_fara_gate_licitatie` | sql | poarta licitației „depusă” (trg_gate_depunere: J02 + J05 + J07) ștearsă | UCIS | **UCIS** (3): JX-07f, JX-07i, JX-C4 |
| M19 | `M19a_j04_dovezi_update_superuser` | sql | trigger append-only J04 fără UPDATE (superuser rescrie verificări) | UCIS | **UCIS** (1): JX-08b |
| M19 | `M19b_j07_rezultate_update_superuser` | sql | trigger append-only J07 fără UPDATE (superuser rescrie rezultate) | SUPRAVIEȚUIA (reconfirmat 29.09 pe 4b03281) | **UCIS** (1): JX-08b |
| M19 | `M19c_dovezi_update_service_role` | sql | ambele triggere fără UPDATE + GRANT UPDATE service_role | UCIS | **UCIS** (1): JX-08b |
| M19 | `M19d_grant_update_service_role_trigger_intact` | sql | GRANT UPDATE service_role, triggerele intacte | UCIS | **UCIS** (1): JX-08b |
| M19 (X) | `X19e_j04_dovezi_delete_superuser` | sql | trigger append-only J04 fără DELETE | SUPRAVIEȚUIA (reconfirmat 29.09 pe 4b03281) | **UCIS** (1): JX-08b |
| M19 (X) | `X19f_j07_rezultate_delete_superuser` | sql | trigger append-only J07 fără DELETE | UCIS | **UCIS** (1): JX-08b |
| M16 | `M16f_evaluator_eroare_ok` | edge | evaluatorul text (evalueaza.mjs): excepție → ok | SUPRAVIEȚUIA în suita SQL (prins doar de Deno) | **UCIS** (1): JX-MX-16f |
| M17 | `M17b_handler_ignora_parser` | edge | handler J07: fără 409 la parser diferit de server; rezultate etichetate cu versiunea serverului | invizibil: runner-ul vechi nu executa handler.ts (prins doar de Deno) | **UCIS** (1): JX-06b |
| X-edge | `XE_garantie_evaluator_ok` | edge | evaluatorul dă ok pe garantie deși ar bloca | UCIS | **UCIS** (1): JX-04-07b |
| X-edge | `XE_anexe_evaluator_ok` | edge | evaluatorul dă ok pe anexe deși ar bloca | UCIS | **UCIS** (1): JX-04-08 |
| X-edge | `XE_numere_evaluator_ok` | edge | evaluatorul dă ok pe numere deși ar bloca | UCIS | **UCIS** (1): JX-04-09 |
| X-edge | `XE_pachet_evaluator_ok` | edge | evaluatorul dă ok pe pachet deși ar bloca | UCIS | **UCIS** (1): JX-04-10 |
| X-edge | `XV_verificator_fara_sha` | edge | verificatorul J04 nu mai compară SHA-ul (PASS cu SHA-ul din manifest) | UCIS | **UCIS** (6): JX-01b, JX-05j, JX-09a, JX-09b, JX-09c, JX-C2 |
| X-edge | `XV_verificator_fara_snapshot_dupa` | edge | verificatorul J04 fără al doilea snapshot (obiect rescris în timpul verificării) | UCIS | **UCIS** (1): JX-01i |
| X-edge | `XH04a_handler_orice_stare` | edge | handler J04 verifică și pachete ne-aprobate (fără 409) | invizibil: runner-ul vechi nu executa index.ts | **UCIS** (1): JX-08c |
| X-edge | `XH04b_handler_ok_ignora_refuz` | edge | handler J04 răspunde ok=true chiar cu REFUZ-uri | invizibil: runner-ul vechi nu executa index.ts | **UCIS** (4): JX-01b, JX-01h, JX-05j, JX-MX-01c |
| X-edge | `XH04c_handler_refuz_nepersistat` | edge | handler J04 nu persistă REFUZ-urile (doar PASS) | invizibil: runner-ul vechi nu executa index.ts | **UCIS** (6): JX-01b, JX-01h, JX-01i, JX-08a, JX-C2, JX-MX-01c |

**Detecție printr-un singur test.** Mutanții prinși de un singur test: M01b (JX-09b), X01c (JX-MX-01c), `j04_fara_lock` (JX-05j), M02b (JX-07f), M16b pe `contor` / `cantitati_f3_grafic` / `garantie` / `grafic_sursa` (JX-MX-16b), M16c și toate variantele lui (JX-MX-16c), M16e (JX-02c), M18d (JX-07d), M18f (JX-07e), M19a–d, X19e, X19f (JX-08b), M16f (JX-MX-16f), M17b (JX-06b), XE_* (câte unul: JX-04-07b / 08 / 09 / 10), XV fără al doilea snapshot (JX-01i) și XH04a (JX-08c).

Ei sunt prinși, dar protecția stă într-un singur test. Dacă testul respectiv e slăbit la o modificare, pasul de mutanți din CI pică, pentru că mutantul ar supraviețui. De aceea catalogul rulează la fiecare PR.

**Teste care nu ucid niciun mutant:**
- JX-00 e structural și exclus din numărătoare.
- JX-03b și JX-06d sunt trasee pozitive. Pică doar dacă implementarea blochează greșit, iar mutanții din catalog slăbesc porțile, nu le înăspresc.
- JX-07g verifică Storage R12; catalogul nu are mutanți pe politicile Storage.
- JX-C1 e o constatare (cursa reprodusă).

## 5. Comenzi de rulare

```bash
# O SINGURĂ COMANDĂ pentru GO (din rădăcina repo-ului; PG16 local gestionat de script, 127.0.0.1, fără chei Supabase):
bash scripts/test_j04xj07.sh --tot          # suita 74 + mutanții 73 (+ control negativ) + 10 harness-uri PG vechi
                                            # + Deno (handler J07, hash J04) + node --test (paritate UI/Edge, ordinea UI)
# Variante:
bash scripts/test_j04xj07.sh                # doar suita extinsă (~18 s)
bash scripts/test_j04xj07.sh --mutanti      # + verificarea prin mutații (JX_PARALEL=4 implicit)
bash scripts/test_j04xj07.sh --si-vechi     # + harness-urile PG existente
bash scripts/test_j04xj07.sh --si-edge      # + Deno și node --test
bash scripts/test_j04xj07.sh -- '^11'       # doar fișierele de test care se potrivesc regex-ului
# Un singur mutant, direct pe runner (PG16 local deja pornit):
JX_MUTANT=M16b_contor PGURI_ADMIN=postgres://postgres@127.0.0.1:5440/postgres node scripts/pg/test_j04xj07.mjs
# Catalogul, în paralel, cu rezumat JSON:
PGURI_ADMIN=postgres://postgres@127.0.0.1:5440/postgres JX_PARALEL=4 JX_REZUMAT=/tmp/m.json node scripts/pg/test_j04xj07_mutanti.mjs
# Build:
npx vite build
```

**Cerințe:** PostgreSQL 16 (binarele din `/usr/lib/postgresql/16/bin`), Node ≥ 22.18, iar pentru `--si-edge` / `--tot` și Deno 2.x.

**Variabile:** `PGDATA_TEST` (implicit `/tmp/pg_j0407/data_jx`), `PGPORT_TEST` (implicit 5440), `PGLOG_TEST`, `JX_PARALEL`.

**Rularea din acest raport**, pe un cluster propriu:

```bash
PGDATA_TEST=/tmp/pg_j0407/data_fix PGPORT_TEST=5440 PGLOG_TEST=/tmp/pg_j0407/fix/pg.log JX_PARALEL=6 bash scripts/test_j04xj07.sh --tot
```

**CI** (`.github/workflows/ofertare-regresie.yml`):
- jobul `postgres` rulează acum pe **Node 22** (pentru handler-ele `.ts`) și are timeout de 35 min. Pașii lui: `node scripts/pg/test_j04xj07.mjs`, apoi `node scripts/pg/test_j04xj07_mutanti.mjs` (`JX_PARALEL=3`);
- jobul `deno` rulează handler-ul J07 și hash-ul J04;
- jobul `unit` rulează `node --test`.

## 6. Rezultate exacte (29.09.2026, local)

**Mediu:**
- PostgreSQL 16.13, pe un cluster propriu `/tmp/pg_j0407/data_fix`, 127.0.0.1:5440, auth trust local;
- Node v22.22.2 și Deno 2.9.7;
- worktree la `4b03281` + diff-ul din acest commit.

**Rezultatele:**
- **`bash scripts/test_j04xj07.sh --tot`:** `exit=0`, `real 7m0.029s`. Pe părți:
  - **Suita:** `PASS J04×J07 extins: 74/74 teste (70 cerințe + 4 constatări fixate), 4 constatări raportate. Funcții urmărite: 6; parser edge: j07-text-v1.` Rularea separată durează ~18 s.
  - **Mutanții:** `PASS mutanți J04×J07: 73/73 uciși (62 SQL + 11 edge), control negativ SUPRAVIEȚUIEȘTE; 344 s, 6 în paralel.` O rulare anterioară a aceluiași catalog, pe aceleași teste, a dat 73/73 în 314 s.
  - **Harness-urile PG vechi, 10/10 PASS:** `test_r9b_probe23`, `test_r5_review_f`, `test_r4_coada_plansa`, `test_jakv201_tranzitie`, `test_jakv207_rls`, `test_jakv203_gate_depusa`, `test_jakv205_derogare_audit`, `test_jakv2p3_poarta_server` (J07-P3), `test_jakv202_hash_server` (J04: 23 de scenarii) și `test_j04_j07_integrare` (35 de scenarii).
  - **Deno:** `supabase/functions/ofertare-poarta-text` → `ok | 4 passed | 0 failed`; `scripts/test-jakv202-hash-server.mjs` → `ok | 41 passed | 0 failed`.
  - **`node --test scripts/test-jakv2p3.mjs scripts/test-j04-j07-integrare.mjs`:** `# tests 11`, `# pass 11`, `# fail 0`.
- **Înainte și după pe mutanții reparați:** suita veche (`git archive 4b03281`, 68 de teste), rulată cu catalogul nou, pe M16c_{contor, cantitati_f3_grafic, garantie, grafic_sursa, grafic_relatii}, M16b_sql_eroare_ok, M16c_sql_indisponibil_ok, M09s, M19b, X19e și X01c: **11/11 SUPRAVIEȚUIESC**. `M00_noop` supraviețuiește și el, cum e corect. Pe suita nouă, toți 11 sunt uciși (tabelul din §4.3).
- **`npx vite build`:** `✓ built in 17.09s`, `exit=0`. Singurul avertisment e cel obișnuit, despre dimensiunea chunk-urilor; `dist/` e ignorat de git.
- **Pe codul nemutat,** fiecare test trece integral, inclusiv `jx.baza_intacta` după ROLLBACK. Bazele de test (`jakv0407_test_*`) se șterg la final.

## 7. Ce rămâne NEDOVEDIT sau deschis

1. **Edge-urile au rulat ca cod, nu deployate.** Handler-ele reale au rulat în Node, nu în runtime-ul Supabase Edge (Deno). Rămân nedovedite:
   - `Deno.serve`, `verify_jwt`, CORS, variabilele de mediu, timeout-urile și limitele de execuție;
   - clientul Supabase real: suita folosește un shim PostgREST peste psql, deci semantica supabase-js / PostgREST (paginare HTTP, coduri de eroare, schema cache) nu e testată;
   - Storage-ul real: download-ul e simulat din `jx.bucket`. Streaming-ul și limita de 32 MB sunt acoperite doar de testele Deno J04.
2. **Poarta de rol a rulat doar cu un utilizator autorizat.** În suita SQL, poarta reală (`poartaOfertare.ts`) a rulat numai cu editorul, care are acces. Refuzurile 401 și 403 sunt dovedite doar de testele Deno (`handler_test.ts`, `test-jakv202-hash-server.mjs`). Catalogul nu are un mutant „poarta lasă pe oricine”.
3. **Schema e un fixture, nu live.** Suita folosește fixture-ul R5, lanțul de migrări din repo și fixture-urile `jakv2p3`. View-ul `v_ofertare_pt_stare` e o aproximare: fixture-ul „nu pretinde că reproduce integral corpusul live”. Paritatea cu live s-a verificat doar la nivel de schelet, prin SELECT read-only pe catalog, la commit-ul `4b03281`. În etapa de acum n-am deschis nicio conexiune.
4. **Constatările JX-C1…C4 rămân deschise.** Testele fixează comportamentul actual, nu îl remediază. Decizia e la Copilot + Răzvan:
   - **C1:** un INSERT concurent în manifest, în timpul tranziției, lasă pachetul depus cu un fișier fără PASS;
   - **C2:** J04 acceptă un PASS vechi deși ultima verificare a aceleiași identități de obiect e REFUZ;
   - **C3:** `service_role` poate rescrie manifestul (A→B fără pachet nou);
   - **C4:** derogarea J05 ocolește J04.
5. **UI-ul e verificat static, nu end-to-end.** Ordinea „ambele verificări înainte de depus” din `OfertarePropunere.jsx` e dovedită doar de `scripts/test-j04-j07-integrare.mjs`, nu în browser. Serverul impune oricum ambele porți, iar asta e dovedit pe PG.
6. **Rollback-ul poate redeschide poarta.** Fișierele `_ROLLBACK.sql` sunt testate de harness-urile vechi, J04 și J07-P3. Observația Copilot „Rollback-ul nu poate redeschide poarta” rămâne deschisă: după rollback, tranziția revine la R11/R5, adică poarta hash / J07 se redeschide. E o constatare în harness-ul de integrare; decizia e la Copilot + Răzvan.
7. **CI-ul GitHub n-a rulat pe acest diff,** pentru că nu am făcut push. Schimbările din workflow (Node 22 pe jobul `postgres`, mutanții în paralel, timeout 35 min) sunt validate doar local: YAML-ul parsat și aceleași comenzi pe PG16 local. Timpul pe runner-ul GitHub e estimat, nu măsurat.
8. **Mutațiile acoperă un catalog finit.** Cei 73 de mutanți arată că suita prinde **aceste** clase de defecte, nu orice defect posibil. Detecțiile printr-un singur test sunt enumerate în §4.3.
9. **Concurența e dovedită determinist, nu sub sarcină.** Testele folosesc două sesiuni reale (05g–j, C1), în READ COMMITTED, ca PostgREST. Nu au rulat sub sarcină și nici cu multe sesiuni paralele.
10. **Branch-ul e în urma lui main** (§1.4). După integrarea cu main, `--tot` trebuie rulat din nou.

## 8. Producție

**Nu am aplicat nimic.** Concret:
- nicio migrare (fără `apply_migration`) și niciun `execute_sql` cu DML;
- niciun deploy de edge și nicio rulare AI plătită;
- fără push și fără conexiune la Supabase în etapa de reparații.

Pașii următori, **după 02.10.2026, 12:00**, numai cu GO Copilot + acordul lui Răzvan, în ordinea din PLAN §2:
1. **J04:** rebase pe main, apoi smoke pe 103 conform PLAN §2 (A → verify PASS → înlocuire cu B → depunere REFUZ → reverify B). Precizarea Copilot din cerința 9 se aplică: PASS pe B numai după un manifest sau o versiune nouă, printr-o tranziție permisă (JX-09a…d).
2. **J07:** numai după ce J04 e live, cu re-review Copilot pe rezolvarea conflictului din §1.2.

Pentru fiecare pas se trimite întâi delta către Copilot, iar verdictul se trece în jurnalul din `COPILOT_HANDOFF.md`.
