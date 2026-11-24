# Achiziții: retur la furnizor (TKT-2026-0347) — planul de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retur la furnizor pe reperele unei comenzi, cu ieșire atomică din stoc, recepția înlocuirii pe aceeași linie și protecția cantităților în BD. Specificația e v10, aprobată de review.

**Architecture:**
- Două PR-uri draft.
- **PR1 = BD.** O migrare L15 v2 care:
  - adaugă tabelele de retur, recepții, alocări și intenții;
  - leagă trigger-ele de lock pe stoc și de protecție pe linie;
  - adaugă RPC-urile `SECURITY DEFINER`.
  - Vine cu revenire, probe PGlite cu mutanți și concurență pe un cluster dispensabil.
- **PR2 = UI.** `Achizitii.jsx` și `Magazie.jsx` trec pe RPC-uri și primesc butonul Retur. Se îmbină doar după ce PR1 e aplicat pe producție.

**Tech Stack:** PostgreSQL 17 (Supabase), plpgsql, PGlite pentru probe, React 18 + Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-achizitii-retur-furnizor-design.md` (v10). Executorul citește spec-ul integral; planul nu-l repetă.

## Global Constraints

- **Repo public.**
  - Fără nume de persoane, firme, comenzi sau prețuri reale.
  - Testele folosesc doar date sintetice: comenzi `CMD_T_001…`, materiale `MAT_A`, `MAT_B`, UM `buc`/`m`, proiecte `P1`/`P2`, uuid-uri `00000000-0000-4000-8000-0000000000NN`.
- **NEAPLICAT.**
  - Migrarea, revenirea și scriptul de reconciliere a moștenirii se livrează nerulate pe producție.
  - Aplicarea (runner L15 v2) și orice DML pe date reale (atribuirea automată a moștenirii, §3.3b) le face chat-ul, după GO Jakarinos pe head, proba pe clona 176 și „da”-ul proprietarului.
- **Migrarea** urmează tiparul L15 v2 al `20270109a_izo_ocr_local_rezerva_sonnet.sql` (migrare care MODIFICĂ obiecte existente):
  - garda de start, plafonul pus de runner și amprenta globală;
  - dependențele verificate pe amprentă: `fn_stocuri_aplica_miscare`, `fn_stoc_ajustare`, `fn_transfer_executa`, `fn_cfl_sync_cereri`, `fn_cfl_automatch`, `fn_cerere_rollup_status`;
  - coloanele existente verificate prin `pg_attribute` + `format_type`;
  - refuz la reaplicare, lock-urile într-un singur punct NOWAIT cu buget de 1 s, postcondiții.
  - Fișier: `supabase/migrations/20270110a_achizitii_retur_furnizor.sql`.
- **Funcții.**
  - Toate RPC-urile: `SECURITY DEFINER SET search_path = public, pg_temp`, nume calificate.
  - Drepturi: `REVOKE ALL … FROM PUBLIC, anon, service_role` și `GRANT EXECUTE` doar `authenticated` pe RPC-urile UI. Funcțiile `*_intern` și cele de trigger rămân fără EXECUTE pentru clienți.
  - Erorile au un cod stabil la începutul mesajului (`CF_<COD>: …`, SQLSTATE `P0001`; dreptul = `42501`).
- **Tabele noi:**
  - `ENABLE ROW LEVEL SECURITY`;
  - politici doar `FOR SELECT TO authenticated`, cu predicatul „vede comanda” (același ca politica de SELECT a `comenzi_furnizor` de pe producție, copiat și verificat pe amprentă);
  - `REVOKE ALL` + `GRANT SELECT`.
  - Excepție: `comenzi_furnizor_intentii` nu are niciun GRANT pentru clienți.
- **Dreptul de scriere** = „achiziții cu drept de creare” sau owner, adică același predicat folosit azi de `ctx.canCreate`. Implementatorul îl citește din cod și din `user_module_access` și îl scrie o singură dată, ca `fn_cf_drept_achizitii_intern(uid uuid) RETURNS boolean`.
- Respectă `docs/paw/LECTII_REVIEW.md` (L01–L25) și raportează matricea în PR.
- Fișiere SQL fără BOM; `.mjs` fără shebang; LF.

## Decizii de construcție (review-ul le poate întoarce înainte de cod)

1. **Un singur tabel de intenții** pentru toate RPC-urile: `comenzi_furnizor_intentii(cheie uuid PK, rpc text, payload_hash text, autor uuid, rezultat jsonb, creat_la)`. Implementează „aceeași cheie + același payload = rezultatul comis” (spec §3.3).
2. **Cheia lock-ului de stoc** = textul EXACT al cheii din `stocuri`: `(locatie_tip, coalesce(locatie_id, 0), material_denumire)`, prin `pg_advisory_xact_lock(hashtextextended(…, 0))`, ca să coincidă cu rândul pe care îl actualizează `fn_stocuri_aplica_miscare`.
   - Normalizarea (trim + lower) se folosește DOAR la atribuirea moștenirii (§3.3b), nu la lock.
   - Abatere declarată față de spec §3.2 („denumire normalizată”).
3. **Comenzile `anulata` / `respinsa` și cele cu `este_servicii = true`** refuză toate RPC-urile noi (`CF_COMANDA_INVALIDA`). Spec-ul spune asta doar pentru servicii (§3.6); pentru anulate e decizia mea.
4. **Ordinea globală a lock-urilor** (L06), aceeași în toate RPC-urile și trigger-ele:
   1. `comenzi_furnizor` rândul comenzii `FOR SHARE`;
   2. `comenzi_furnizor_linii` rândul liniei `FOR UPDATE`;
   3. cheile de stoc: **toate** cheile pe care operația le atinge (intrare sau ieșire; la transportul direct sediul **și** proiectul), luate **înaintea primei mișcări de stoc**: întâi lock-urile advisory, sortate crescător după valoarea cheii (`fn_stoc_cheie`), apoi rândurile din `stocuri` `FOR UPDATE`, în aceeași ordine (actualizat în runda 2 a review-ului: transportul direct ținea rândul sediului și cerea abia apoi cheia lui, deci se putea bloca reciproc cu un retur care ținea cheia și aștepta rândul);
   4. rândurile de retur `FOR UPDATE`, în ordinea id-ului.
   - Pasul 0, înaintea tuturor: lock-ul advisory pe cheia de idempotență.
   - Trigger-ul de identitate pe linie ia doar pasul 1; la mutarea liniei în altă comandă, ambele comenzi `FOR SHARE`, în ordinea id-ului.
   - Dreptul se verifică după lock-uri și **se reverifică după ultima operație care poate aștepta** (la închiderea intenției; ștergerea poziției, după ștergeri).

## Review Focus

1. **Cantități zecimale** (12,5 m de țeavă): toate comparațiile pe `numeric`, fără rotunjire. Test `t_zecimale` în Task 4.
2. **Dublu-click / reîncercare după timeout în UI:** aceeași cheie, un singur efect. Test `c_reluare_cheie` (Task 5) și `ui_cheie_o_data` (Task 7).
3. **Comandă anulată după recepție, sau comandă de servicii:** returul e refuzat. Test `t_comanda_invalida` în Task 4.
4. **Material cu spații / majuscule diferite față de rândul din `stocuri`:** lock-ul și scăderea ating exact rândul liniei. Test `t_cheie_exacta` în Task 2.
5. **Ecran vechi deschis care salvează recepția în format absolut:** refuz curat, mesaj „reîncărcați pagina”, nicio scriere. Test `t_client_vechi` în Task 2 și `ui_eroare_client_vechi` în Task 6.

---

## PR1 — baza de date (branch `achizitii/retur-furnizor-bd`)

### Task 1: Migrarea, partea 1 — gărzile, tabelele, CHECK-urile, RLS

**Files:**
- Create: `supabase/migrations/20270110a_achizitii_retur_furnizor.sql` (secțiunile `$pre$`, 1–2)
- Create: `scripts/pglite/test_achizitii_retur_local.mjs` (runner-ul de probe; secțiunea t1)

**Interfaces:**
- Produces, tabelele (coloanele exact ca în spec §3.1, plus):
  - `comenzi_furnizor_retururi`:
    - copiile cheii de stoc: `denumire`, `um`, `locatie_tip`, `locatie_id`;
    - `cantitate_inlocuita`, `cantitate_renuntata`;
    - `inchis_fel CHECK IN ('acoperit','renuntat','anulat')`;
    - `retur_id UNIQUE`;
    - `cheie uuid UNIQUE`.
  - `comenzi_furnizor_receptii`: `id`, `linie_id`, `tip CHECK IN ('sold_initial','receptie','corectura')`, `cantitate numeric > 0`, `receptie_id` (la `corectura`: recepția consumată), `cheie`, `creat_la`.
  - `comenzi_furnizor_retur_alocari`: `id`, `receptie_id`, `retur_id`, `cantitate > 0`, `inversata_de_receptie_id NULL`.
  - `comenzi_furnizor_intentii` (decizia 1).
  - Pe `comenzi_furnizor_linii`:
    - coloana nouă `intrare_reconciliata boolean NOT NULL DEFAULT false`;
    - `CHECK (cantitate_intrata_stoc <= coalesce(cantitate_primita, cantitate)) NOT VALID`, apoi `VALIDATE` în aceeași migrare (proba pe clonă verifică întâi datele).
  - Pe `stocuri_miscari`: CHECK-ul pe `tip` extins cu `retur_furnizor` și `retur_furnizor_anulare`, același nume de constrângere.
  - Pe `stocuri_miscari`: CHECK nou cu sensul delta: `tip <> 'retur_furnizor' OR delta < 0`, `tip <> 'retur_furnizor_anulare' OR delta > 0`.

- [ ] **Step 1: Teste PGlite `t1_*` (pe schema producției încărcată din scheletul de test):**
  - `t1_tabele_rls`: toate tabelele noi au RLS activ, nicio politică de scriere, iar `authenticated` are doar SELECT (`intentii`: nimic);
  - `t1_check_tip`: un insert `retur_furnizor` cu delta 5 → eroare;
  - `t1_check_intrata`: un UPDATE care face `intrata_stoc > primita` → eroare;
  - `t1_reaplicare`: a doua aplicare → `CF_DEJA_APLICATA`.
- [ ] **Step 2:** Rulează `node scripts/pglite/test_achizitii_retur_local.mjs --sectiune t1` → FAIL (migrarea nu există).
- [ ] **Step 3:** Scrie `$pre$` + secțiunile 1–2 ale migrării, după Global Constraints.
- [ ] **Step 4:** Rulează din nou → PASS.
- [ ] **Step 5:** Commit `feat(achizitii): retur — tabele, CHECK-uri, RLS (migrare 20270110a, NEAPLICATĂ)`.

### Task 2: Lock-ul pe stoc, ștergerile, protecția liniei

**Files:**
- Modify: migrarea (secțiunea 3)
- Modify: `scripts/pglite/test_achizitii_retur_local.mjs` (t2)

**Interfaces:**
- `fn_stoc_cheie_lock(p_locatie_tip text, p_locatie_id bigint, p_denumire text) RETURNS void`: internă; ia lock-ul advisory (decizia 2).
- `fn_stoc_blocheaza(p_locatie_tip text, p_locatie_id bigint, p_denumire text) RETURNS numeric`: internă; lock + `stocuri.cantitate` (0 dacă rândul lipsește).
- Trigger `trg_stoc_miscari_lock_iesire`: `BEFORE INSERT ON stocuri_miscari FOR EACH ROW WHEN (NEW.delta < 0)` → `fn_stoc_cheie_lock`.
- Trigger `trg_stoc_miscari_lock_stergere`: `BEFORE DELETE ON stocuri_miscari`. Ia lock-ul și refuză (`CF_ISTORIC_PROTEJAT`) ștergerea mișcărilor `retur_furnizor*` și a celor `intrare_achizitie` cu `ref_tip IN ('comanda_furnizor','comanda_furnizor_linie')`.
- Trigger `trg_stocuri_lock_stergere`: `BEFORE DELETE ON stocuri`. Ia lock-ul și refuză dacă poziția are mișcări protejate.
- `fn_stoc_sterge_pozitie(p_stoc_id bigint) RETURNS jsonb`: UI; doar owner (ca azi); lock, apoi ștergerea mișcărilor neprotejate și a poziției, într-o tranzacție. Refuză cu `CF_ISTORIC_PROTEJAT`.
- Protecția liniei:
  - `REVOKE UPDATE (cantitate_primita, cantitate_intrata_stoc, intrare_reconciliata) ON comenzi_furnizor_linii FROM authenticated, anon`;
  - trigger `trg_cfl_protectie` `BEFORE UPDATE`, care refuză:
    - (a) schimbarea acestor 3 coloane fără `current_setting('app.cf_cantitati', true) = '1'` → `CF_CLIENT_VECHI: reîncărcați pagina`;
    - (b) schimbarea `denumire` / `um` când există dovada de recepție pe `OLD` (spec §3.2b) → `CF_MATERIAL_RECEPTIONAT`.
    - Trigger-ul ia `comenzi_furnizor FOR SHARE` (decizia 4, pasul 1).
- Marcajul se pune DOAR de RPC-uri, cu `set_config('app.cf_cantitati','1', true)` imediat înainte de UPDATE și resetat la `''` imediat după.

- [ ] **Step 1: Teste `t2_*`:**
  - `t2_ajustare_ia_lock`: o tranzacție A ține lock-ul cheii; un insert negativ din B așteaptă (verificat prin `pg_locks` în PGlite secvențial sau prin bariera din Task 5);
  - `t2_stergere_protejata`: `DELETE` pe o mișcare `intrare_achizitie` cu `ref_tip='comanda_furnizor'` → `CF_ISTORIC_PROTEJAT`; `fn_stoc_sterge_pozitie` pe o poziție fără istoric protejat → șterge tot;
  - `t_client_vechi`: `UPDATE comenzi_furnizor_linii SET cantitate_primita = 100` ca `authenticated` → eroare de drept pe coloană, iar ca `postgres` fără marcaj → `CF_CLIENT_VECHI`;
  - `t2_identitate`: linie în comandă `receptionata` cu `primita NULL` → `UPDATE denumire` → `CF_MATERIAL_RECEPTIONAT`; o linie dintr-o comandă `emisa`, fără recepție → redenumirea merge;
  - `t_cheie_exacta`: `MAT_A` și `mat_a ` în aceeași locație sunt chei diferite; returul pe `MAT_A` nu atinge `mat_a `.
- [ ] **Step 2:** Rulează `--sectiune t2` → FAIL.
- [ ] **Step 3:** Implementează secțiunea 3.
- [ ] **Step 4:** Rulează `--sectiune t1,t2` → PASS.
- [ ] **Step 5:** Commit.

### Task 3: Recepția și predarea prin RPC (jurnal, sold inițial, alocare, compensare)

**Files:**
- Modify: migrarea (secțiunea 4)
- Modify: testul (t3)

**Interfaces:**
- `fn_cf_intentie_reia_intern(p_cheie uuid, p_rpc text, p_payload jsonb) RETURNS jsonb`: întoarce rezultatul comis sau NULL. `CF_CHEIE_ALTI_PARAMETRI` dacă hash-ul diferă; rezultatul se dă doar autorului (spec §3.3).
- `fn_cf_intentie_inchide_intern(p_cheie uuid, p_rpc text, p_payload jsonb, p_rezultat jsonb) RETURNS void`.
- `fn_cf_linie_pregateste_intern(p_linie_id bigint, p_cere_dovada boolean) RETURNS comenzi_furnizor_linii`:
  - ia lock-urile 1–2;
  - verifică `CF_COMANDA_INVALIDA` (decizia 3);
  - transformă NULL în `cantitate` dacă există dovadă (spec §3.0), altfel `CF_FARA_RECEPTIE` când `p_cere_dovada`;
  - scrie rândul `sold_initial` dacă linia nu are jurnal și `primita > 0` (spec §3.3, „Soldul inițial”);
  - întoarce rândul blocat.
- `fn_cf_receptie_adauga(p_cheie uuid, p_linie_id bigint, p_cantitate numeric, p_primita_citita numeric) RETURNS jsonb`:
  - verifică `primita` curentă = `p_primita_citita`, altfel `CF_VALOARE_SCHIMBATA`;
  - pentru N > 0: rând `receptie`, apoi alocă retururile deschise de la cel mai vechi; un retur acoperit integral → `inchis_fel='acoperit'`;
  - pentru N < 0: cere `intrare_reconciliata`; `primita + N ≥ intrata_stoc`; compensarea cronologică (spec §3.3), scriind rânduri `corectura` și marcând alocările inversate;
  - întoarce `{primita, de_inlocuit, retururi_redeschise[]}`.
- `fn_cf_intra_stoc(p_cheie uuid, p_linie_id bigint, p_cantitate numeric, p_transfer_proiect boolean DEFAULT false) RETURNS jsonb`:
  - cere `intrare_reconciliata` și `p_cantitate ≤ primita − intrata_stoc`;
  - scrie mișcarea `intrare_achizitie` cu `ref_tip='comanda_furnizor_linie'`, `ref_id` = linia;
  - la `p_transfer_proiect`, cheamă `fn_transfer_executa` în aceeași tranzacție, ca `finalizeazaReceptieTransport`;
  - `intrata_stoc += p_cantitate`;
  - întoarce `{intrata_stoc, miscare_id}`.

- [ ] **Step 1: Teste `t3_*`:**
  - `t3_receptie_incrementala`: 40, apoi +60 → `primita=100`; o a doua cerere cu `p_primita_citita=40` → `CF_VALOARE_SCHIMBATA`;
  - `t3_sold_initial`: linie veche cu `primita=40`, fără jurnal; corectura −10 → `primita=30` și `corectura` pe `sold_initial`. Recepție nouă de 20, apoi −30 → consumă 20 din recepția nouă + 10 din sold (proba 14 din spec);
  - `t3_null_dovada`: comanda `emisa` cu NULL → `fn_cf_intra_stoc` refuză `CF_FARA_RECEPTIE`; aceeași comandă `receptionata` → NULL devine `cantitate`;
  - `t3_predare_atomica`: un insert de mișcare eșuat (forțat prin mutant) → `intrata_stoc` neschimbat;
  - `t3_transport_direct`: `p_transfer_proiect=true` → mișcarea de intrare la sediu și transferul pe proiect, iar `intrata_stoc` crește;
  - `t3_nereconciliata`: o linie cu mișcări vechi `ref_tip='comanda_furnizor'` și `intrare_reconciliata=false` → predarea, transportul și corectura negativă refuză `CF_NERECONCILIATA`; recepția pozitivă merge.
- [ ] **Step 2:** FAIL → **Step 3:** implementare → **Step 4:** PASS (`--sectiune t1,t2,t3`) → **Step 5:** commit.

### Task 4: Returul, anularea, închiderea, reconcilierea moștenirii

**Files:**
- Modify: migrarea (secțiunea 5 + `$post$`)
- Modify: testul (t4)
- Create: `scripts/achizitii_retur_reconciliere_mostenire.sql` (preview / aplicare, NERULAT)

**Interfaces:**
- `fn_cf_retur_inregistreaza(p_cheie uuid, p_linie_id bigint, p_cantitate numeric, p_din_stoc numeric, p_locatie_tip text, p_locatie_id bigint, p_motiv text, p_pv_path text, p_asteapta_inlocuire boolean) RETURNS jsonb`:
  - pașii din spec §3.3.1;
  - locația trebuie să fie sediul sau proiectul comenzii (`CF_LOCATIE_INVALIDA`);
  - `p_din_stoc NULL` → valoarea implicită;
  - întoarce `{retur_id, din_stoc, primita, intrata_stoc, stoc_ramas}`.
- `fn_cf_retur_anuleaza(p_cheie uuid, p_retur_id bigint, p_motiv text) RETURNS jsonb`: spec §3.3.2; folosește cheia de stoc salvată pe retur.
- `fn_cf_retur_inchide_fara_inlocuire(p_cheie uuid, p_retur_id bigint, p_motiv text) RETURNS jsonb`: spec §3.3.5.
- `fn_cf_reconciliaza_linie(p_cheie uuid, p_linie_id bigint, p_intrata_stoc numeric, p_motiv text) RETURNS jsonb`: doar owner; setează `intrata_stoc` și `intrare_reconciliata = true`.
- Scriptul de moștenire:
  - mod `preview`: `SELECT`-uri cu COUNT și lista liniilor atribuibile / ambigue;
  - mod `aplica`: UPDATE cu `RETURNING`, în tranzacție, cu garda `system_identifier` pentru clonă / producție;
  - liniile fără mișcări vechi de intrare primesc `intrare_reconciliata = true` doar în modul `aplica`.

- [ ] **Step 1: Teste `t4_*`:**
  - `t4_retur_stoc`: 100 primite, 40 intrate; două retururi de 20 → `intrata_stoc` 40 → 20 → 0, iar stocul scade cu 40 (spec §3.0);
  - `t4_retur_fara_stoc`: 20 primite, 0 intrate; retur 10 → nicio mișcare și `stoc_miscare_id NULL`;
  - `t4_stoc_insuficient`: stocul consumat după intrare → `CF_STOC_INSUFICIENT`, nicio scriere;
  - `t4_anulare`: o singură dată; refuzată după înlocuire; pune la loc exact `din_stoc`, în locația salvată;
  - `t4_renuntare`: retur 40, înlocuire 10, renunțare la 30, corectura recepției de 10 la 0 → `de_inlocuit = 10` (proba 12);
  - `t4_cronologic`: proba 13 din spec, ambele variante (−60 și −70);
  - `t_zecimale`: 12,5 m, retur 2,25 → valori exacte;
  - `t_comanda_invalida`: comandă `anulata` sau `este_servicii` → `CF_COMANDA_INVALIDA`;
  - `t4_drept`: utilizator fără drept → 42501; reluarea unei chei comise de autor după retragerea dreptului → rezultatul comis; o cheie nouă → 42501;
  - `t4_cereri_neschimbate`: statusul cererii interne legate e identic înainte și după fiecare RPC (proba 7);
  - `t4_proprietate`: 200 de secvențe aleatoare (recepție, predare, retur, anulare, înlocuire, renunțare, corectură):
    - CHECK-urile țin;
    - suma mișcărilor pe linie = `intrata_stoc`;
    - suma jurnalului = `primita` + retururile nete (proba 1).
- [ ] **Step 2:** FAIL → **Step 3:** implementare, cu `$post$` care verifică obiectele, drepturile, politicile și lock-urile ținute → **Step 4:** PASS (toate secțiunile) → **Step 5:** commit.

### Task 5: Livrarea L15 v2 — revenire, manifest, mutanți, concurență

**Files:**
- Create: `supabase/revenire/20270110a_achizitii_retur_furnizor_ROLLBACK.sql`
- Create: `supabase/tests/20270110a_achizitii_retur_furnizor.l15.obiecte.tsv` (generat pe PGlite cu pașii reali ai runnerului)
- Create: `supabase/tests/20270110a_achizitii_retur_furnizor_dryrun.sql`
- Create: `supabase/tests/20270110a_achizitii_retur_furnizor_concurenta.sh` (tiparul `…20270108a…_concurenta.sh`, cluster dispensabil)
- Modify: testul (mutanții)

**Interfaces:**
- **Revenirea:**
  - lock-urile migrării înaintea verificărilor;
  - refuză dacă există rânduri în oricare dintre tabelele noi sau mișcări `retur_furnizor*` (proba 8);
  - scoate trigger-ele, RPC-urile, tabelele și coloana `intrare_reconciliata`;
  - restaurează CHECK-urile, `REVOKE`-ul pe coloane și amprentele funcțiilor atinse.
- **Mutanți** (fiecare trebuie PRINS):
  - fără lock de stoc la retur;
  - fără reverificarea dreptului după lock;
  - fără CAS pe `p_primita_citita`;
  - fără garda de reconciliere la `fn_cf_intra_stoc`;
  - fără marcajul `app.cf_cantitati` (protecția dezactivată);
  - fără înghețarea identității pe NULL;
  - compensare FIFO în loc de LIFO;
  - fără refuzul renunțării la corectură;
  - fără `UNIQUE (retur_id)` pe anulare;
  - fără verificarea hash-ului payload-ului.
- **Concurența:**
  - `c_doua_retururi_aceeasi_linie`;
  - `c_doua_linii_aceeasi_cheie` (stoc 50, 40 + 40 → unul refuzat);
  - `c_retur_vs_ajustare_minus`;
  - `c_receptie_veche_vs_retur`;
  - `c_retur_vs_stergere_pozitie`;
  - `c_drept_retras_in_asteptare` (fiecare RPC de scriere);
  - `c_reluare_cheie`.
  - Toate cu barieră (observatorul vede `wait_event_type = 'Lock'`), plus câte un mutant pentru fiecare.

- [ ] **Step 1:** Scrie revenirea, dry-run-ul, concurența și mutanții. Rulează:
  - `node scripts/pglite/test_achizitii_retur_local.mjs` (complet) → 0 eșecuri, toți mutanții PRINȘI;
  - `RETUR_CLUSTER_DISPENSABIL=da bash supabase/tests/20270110a_achizitii_retur_furnizor_concurenta.sh <bază>` → „TOTUL OK” + toți mutanții PRINȘI.
- [ ] **Step 2:** `npx vite build` + `npx vitest run` verzi.
- [ ] **Step 3:** Commit, push, PR draft „Achiziții: retur la furnizor — PR1 baza de date (20270110a NEAPLICATĂ)”.
  - În corpul PR-ului: rezultatele reale ale rulărilor, matricea L01–L25 și comenzile pentru proba pe clona 176 (le rulează chat-ul).

## PR2 — interfața (branch `achizitii/retur-furnizor-ui`, din PR1)

### Task 6: Recepția și predarea din `Achizitii.jsx` prin RPC

**Files:**
- Modify: `src/Achizitii.jsx`:
  - recepția pe repere, ~2029: diferența + `p_primita_citita`;
  - `intraInStoc` ~2232 și `finalizeazaReceptieTransport`: prin `fn_cf_intra_stoc`;
  - redeschiderea butoanelor după regula spec §3.4.
- Create: `src/achizitiiRetur.js` (funcții pure: `diferentaReceptie(liniaCitita, valoareNoua)`, `poateRedeschideReceptia(linie, retururi)`, `mesajEroareCF(error)`)
- Test: `src/achizitiiRetur.test.js`

**Interfaces:**
- Consumes: RPC-urile din Task 3.
- `mesajEroareCF(error) → string` traduce codurile `CF_*`:
  - `CF_CLIENT_VECHI` și `CF_VALOARE_SCHIMBATA` → „Datele s-au schimbat între timp — reîncărcați pagina.”;
  - `CF_NERECONCILIATA` → „Recepție veche nereconciliată — cereți reconcilierea.”

- [ ] **Step 1:** Teste vitest:
  - `diferentaReceptie` (pozitiv, negativ, NULL inițial);
  - `poateRedeschideReceptia`;
  - `ui_eroare_client_vechi` (codul → mesajul exact).
- [ ] **Step 2:** FAIL → **Step 3:** implementare → **Step 4:** PASS + `npx vite build` → **Step 5:** commit.

### Task 7: Butonul Retur, anularea, închiderea, reconcilierea

**Files:**
- Create: `src/achizitii/ReturModal.jsx` (fereastra), `src/achizitii/ReturIstoric.jsx`
- Modify: `src/Achizitii.jsx` (butonul „↩️ Retur” pe reper, etichetele spec §3.4, „⚠️ de reconciliat” + butonul owner)
- Modify: `src/achizitiiRetur.js` (`limiteDinStoc(linie, cantitate) → {min, max, implicit}`, `deInlocuit(retur)`)
- Test: `src/achizitiiRetur.test.js`

**Interfaces:**
- Consumes: RPC-urile din Task 4.
- Cheia (`crypto.randomUUID()`) se generează o dată la deschiderea ferestrei și se refolosește la reîncercare.

- [ ] **Step 1:** Teste:
  - `limiteDinStoc` (exemplele spec §3.0);
  - `deInlocuit` (acoperit / renunțat / parțial);
  - `ui_cheie_o_data`: două trimiteri din aceeași fereastră folosesc aceeași cheie.
- [ ] **Step 2:** FAIL → **Step 3:** implementare (stil inline, paleta `G`) → **Step 4:** PASS + build → **Step 5:** commit.

### Task 8: Magazie — ștergerea prin RPC, etichetele mișcărilor noi

**Files:**
- Modify: `src/Magazie.jsx`:
  - `deleteStoc` ~103 → `fn_stoc_sterge_pozitie`, cu mesajul pentru `CF_ISTORIC_PROTEJAT`;
  - etichetele `retur_furnizor` și `retur_furnizor_anulare` în harta tipurilor ~410.
- Test: `src/achizitiiRetur.test.js` (maparea etichetelor, dacă e extrasă) sau testul existent al Magaziei.

- [ ] **Step 1:** Test pe etichete și pe calea de eroare → **Step 2:** FAIL → **Step 3:** implementare → **Step 4:** PASS + build + vitest complet.
- [ ] **Step 5:** Commit, push, PR draft „Achiziții: retur la furnizor — PR2 interfața (după aplicarea 20270110a)”.

## Ordinea de livrare și ce rămâne la proprietar

1. **PR1:** review Jakarinos până la GO. Apoi chat-ul:
   - proba pe clona 176: aplicare prin runner, dry-run, revenire, reaplicare;
   - modul `preview` al scriptului de moștenire pe producție (doar citire).
2. **„Da”-ul lui Răzvan pentru aplicarea pe producție.** Atunci:
   - Răzvan trece pe manual;
   - aplicarea în fereastra L15;
   - preview-ul moștenirii;
   - un al doilea „da” pentru `aplica` (DML pe date reale).
3. **PR2:** review Jakarinos, apoi îmbinare după aplicarea PR1. Până atunci rămâne varianta manuală C (ajustare în Magazie).
4. **Închiderea TKT-2026-0347** după publicarea PR2, cu mail către cel care l-a deschis (draft + „trimite”).
