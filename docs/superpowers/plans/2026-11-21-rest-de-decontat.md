# Rest de decontat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pe fiecare proiect din Execuție, restul de decontat = bază (ofertă + NR/NCS + acte adiționale) − situațiile de lucrări confirmate, în bani (articol / obiect / proiect) și în cantități (articol).

**Architecture:** BD = sursa unică: tabele noi pentru notele NR/NCS, situațiile detaliate și propunerile turei de noapte, câteva coloane noi pe `proiect_articole` / `executie_proiecte`, o funcție de drept unică, RPC-uri de confirmare atomice și vederi `security_invoker` care fac tot calculul (L19). Browserul doar parsează determinist XLS/DOCX, propune potriviri și afișează; PDF-urile scanate și propunerile pe descriere vin de la tura de noapte (AI local) în tabelul de propuneri, iar omul confirmă.

**Tech Stack:** Postgres (Supabase) + migrări L15 v2 cu gardă de start; React 18 (inline styles G/S), SheetJS (xlsx-js-style deja instalat), `src/devizParser.js`; vitest; probe SQL pe clona locală (PG 17, 127.0.0.1:5434).

**Spec:** `docs/superpowers/specs/2026-11-21-rest-de-decontat-design.md` (PR #1157). Executorii citesc ambele.

## Global Constraints

- Fără AI în cloud în fluxul ăsta: XLS/DOCX parsate în browser fără AI; PDF-uri scanate și potriviri pe descriere doar prin AI local (tura de noapte); modelul doar propune, omul confirmă.
- Citire bani: owner, managerul proiectului (`executie_proiecte.mp_employee_id` = `profiles.employee_id` al utilizatorului), sub-modul nou `executie_rest_decontat` în `user_module_access` (orice nivel = citire; editor/admin = confirmare). Accesul general `executie` NU dă citire.
- Încărcare/confirmare: owner, MP-ul proiectului, `executie_rest_decontat` editor/admin; documentele de bază (AA / NR / NCS + devize) și de responsabilul de contracte al proiectului (`executie_proiecte.responsabil_contracte_externe_id`).
- Nicio persoană numită în cod, migrări, teste sau commit-uri (repo public). Niciun drept acordat de migrare.
- Migrări L15 v2: gardă de start ca în `20261208a_executie_devize_tinte.sql` (current_user postgres + `gazpet.livrare_migrare`), refuz la reaplicare, verificarea coloanelor folosite în `information_schema`, fișier de revenire `supabase/revenire/<migrare>_ROLLBACK.sql`, manifest `.l15.tsv` (`scripts/livrare_l15_manifest.sh`), test `supabase/tests/<migrare>_dryrun.sql`. **NEAPLICATE** — aplicarea pe producție e a lui Răzvan.
- Tabele noi: ENABLE RLS + politici prin funcția de drept + GRANT authenticated/service_role; vederi `WITH (security_invoker = on)`; funcții `SECURITY DEFINER SET search_path = public, pg_temp`, REVOKE EXECUTE FROM PUBLIC, GRANT doar cui le cheamă.
- Nu se modifică fluxul borderou/certificat din `TabSituatiiPlata.jsx` și nici `executie_situatii_plata*` (doar se citesc). Nu se atinge SalariiPage.
- Stil: inline styles cu G/S, fără librării noi, fără TypeScript. Regulile `docs/paw/LECTII_REVIEW.md` (L01–Lnn) se respectă și se raportează în PR.
- Prețurile = cele din ofertă / acte (ultimul act care schimbă prețul); ajustările din situații nu intră în cantități, se arată separat.
- Cantitățile se compară doar pe articol; pe obiect / proiect doar bani.

## Review Focus

1. Aceeași situație încărcată de două ori (același fișier sau alt fișier cu același nr.) → nu se dublează; al doilea fișier cere „înlocuiește” explicit, versiunea veche devine inactivă. Test: Task 1 `t_dublare_situatie`.
2. UM diferit între situație și bază („100 MC” vs „MC”, „HM” vs „M”) → convertit sau „de verificat”, niciodată adunat brut. Test: Task 3 `um diferit -> de_verificat`.
3. Act adițional legat de NR/NCS → notele nu se mai adună; dacă AA devine inactiv, notele contează din nou. Test: Task 1 `t_aa_leaga_note`.
4. Cantități negative (regularizări, NR) se adună cu semn; restul negativ („peste ofertă”) e semnalat, nu tăiat la zero. Test: Task 1 `t_negative_peste_oferta`.
5. Un utilizator cu acces general la Execuție (șef de șantier) care citește direct tabelele / vederile prin API → zero rânduri. Test: Task 1 `t_drept_sef_santier`.

---

### Task 1: Schema, dreptul, calculul și confirmarea (migrarea A)

**Files:**
- Create: `supabase/migrations/20270105a_executie_rest_decontat.sql` (+ `.l15.tsv`)
- Create: `supabase/revenire/20270105a_executie_rest_decontat_ROLLBACK.sql`
- Test: `supabase/tests/20270105a_executie_rest_decontat_dryrun.sql`

**Interfaces:**
- Produces:
  - `executie_note_modificare(id bigint pk, proiect_id bigint fk executie_proiecte, tip text check in ('NR','NCS'), numar text, data_aprobare date, act_aditional_id bigint null fk executie_acte_aditionale, descriere text, fisier_path text, activ boolean default true, creat_de uuid, creat_la timestamptz)`.
  - `proiect_articole` + coloane: `cheie text`, `nota_id bigint null fk`, `act_aditional_id bigint null fk`, `mod_import text check in ('diferente','lista_completa')`, `activ boolean default true`, `fisier_amprenta text`, `confirmat_de uuid`, `confirmat_la timestamptz`, `tip_rand text default 'articol' check in ('articol','os','diverse')`. Rândurile existente rămân `activ = true`, `cheie` completată de migrare cu `fn_rest_decontat_cheie`.
  - `executie_sl_detaliu(id, proiect_id, sl_id bigint null fk executie_situatii_plata, nr_situatie text not null, luna int, an int, fisier_path, amprenta text not null, versiune int, activ boolean, inlocuieste_id bigint null, total_citit numeric, total_referinta numeric, confirmat_de uuid, confirmat_la timestamptz)` + index unic parțial `(proiect_id, nr_situatie) WHERE activ`.
  - `executie_sl_detaliu_linii(id, detaliu_id fk on delete cascade, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate_perioada numeric, cantitate_cumulat_doc numeric null, pret_unitar numeric, valoare numeric, cheie text null, tip_rand text check in ('articol','articol_nou','os','diverse','fara_detaliu'), potrivire text check in ('exact','cod','descriere_confirmata','manual'))`.
  - `executie_proiecte` + coloane `configurare_completa_la timestamptz`, `configurare_exceptie_motiv text` (folosite în Task 2).
  - `fn_rest_decontat_cheie(p_obiect text, p_deviz text, p_cod text, p_nr text) returns text` — IMMUTABLE; normalizează (trim, upper, spații multiple → unul); `p_nr` intră în cheie doar dacă nu e NULL (apelantul îl dă doar când codul se repetă în același deviz).
  - `fn_rest_decontat_drept(p_proiect bigint, p_nivel text) returns boolean` — `p_nivel` ∈ `'citire'|'confirmare'|'documente_baza'`; regula din Global Constraints; o singură definiție, folosită de RLS, RPC-uri și ecran.
  - `fn_rest_decontat_confirma_baza(p_proiect bigint, p_sursa text, p_act_aditional_id bigint, p_nota_id bigint, p_mod text, p_fisier text, p_amprenta text, p_linii jsonb) returns jsonb` — `p_sursa` ∈ `contract_initial|act_aditional|nota_renuntare|nota_comanda_suplimentara`; o singură tranzacție; refuz la amprentă deja confirmată pentru aceeași sursă; cheia calculată în BD; întoarce `{inserate, ids}`.
  - `fn_rest_decontat_confirma_situatie(p_proiect bigint, p_nr_situatie text, p_sl_id bigint, p_fisier text, p_amprenta text, p_linii jsonb, p_inlocuieste boolean, p_prag_diferenta numeric default 1.00) returns jsonb` — refuz dacă proiectul nu are bază confirmată (rânduri `contract_initial` active); refuz la nr. existent activ fără `p_inlocuieste` (iar `p_inlocuieste` cere `confirmare`); refuz la aceeași amprentă; `total_referinta` = valoarea de bază a SL din `executie_situatii_plata` când `p_sl_id` e dat; diferență > prag fără cheia `"accept_diferenta": true` în `p_linii` = refuz; linie cu `um` diferit de UM-ul cheii (după normalizarea din `fn_rest_decontat_um`) = refuz.
  - `fn_rest_decontat_um(p_um text) returns table(um text, factor numeric)` — „100 MC” → (`MC`, 100), „HM” → (`M`, 100), restul (upper/trim, 1).
  - `v_executie_rest_decontat_baza` — pe (proiect, cheie): cantitate, valoare, pret_unitar (ultimul act), um. Regula fără dublare: `contract_initial` + NR/NCS **nelegate** de un AA activ + rândurile AA; pentru un AA `lista_completa`, rândurile anterioare ale obiectelor atinse de el se ignoră.
  - `v_executie_rest_decontat` — pe (proiect, cheie): baza (cant, valoare), decontat (Σ `cantitate_perioada` × factor din detaliile active; valoare), rest cant / rest valoare, `pct_decontat`, `peste_oferta boolean`, `nedecontat boolean`; plus rândurile `articol_nou` cu bază 0.
  - `v_executie_rest_decontat_obiect` — sume în bani pe (proiect, obiect_cod) și pe proiect (`obiect_cod IS NULL`).
  - `v_executie_rest_decontat_lipsuri` — (proiect_id, tip ∈ `fara_oferta|sl_fara_detaliu|aa_fara_deviz|nota_fara_deviz`, referinta text).
  - Toate vederile: `security_invoker = on` și filtrate prin `fn_rest_decontat_drept(proiect_id,'citire')`.

- [ ] **Step 1: Write the failing dry-run test** `supabase/tests/20270105a_executie_rest_decontat_dryrun.sql` (în tranzacție, ROLLBACK la final, identități sintetice), cu blocurile:
  - `t_dublare_situatie`: aceeași amprentă de două ori → excepție; alt fișier, același nr., fără `p_inlocuieste` → excepție; cu `p_inlocuieste` → vechea `activ=false`, decontatul = doar versiunea nouă.
  - `t_aa_leaga_note`: bază 100 m; NCS +20 → bază 120; AA legat de NCS cu +20 și +5 pe alt articol → bază 120 + 5 (nu 140); AA dezactivat → bază 120.
  - `t_negative_peste_oferta`: SL1 +80, SL2 −10, SL3 +50 pe bază 100 → decontat 120, rest −20, `peste_oferta = true`.
  - `t_drept_sef_santier`: utilizator cu `executie` viewer + șef de șantier, fără `executie_rest_decontat` și nu MP → 0 rânduri din toate cele patru vederi și din cele trei tabele noi; MP-ul proiectului → vede doar proiectul lui.
  - `t_um`: bază „100 MC” cantitate 2 → 200 MC; linie SL în `MC` 50 → rest 150; linie în `ML` → excepție.
  - `t_fara_baza`: confirmarea unei situații pe un proiect fără `contract_initial` → excepție.
- [ ] **Step 2: Run it on the clone; expect FAIL** (obiectele nu există): `psql -h 127.0.0.1 -p 5434 ... -f supabase/tests/20270105a_executie_rest_decontat_dryrun.sql` → eroare „relation … does not exist”.
- [ ] **Step 3: Write the migration** with the objects above, following the guard pattern of `20261208a`. Coloanele citite din tabelele existente se verifică în blocul `$pre$` (lista de tipuri).
- [ ] **Step 4: Apply on the clone via the L15 v2 runner, then run the dry-run; expect all blocks PASS** (`NOTICE ... ok` pe fiecare bloc, fără excepții neprinse).
- [ ] **Step 5: Run the rollback on the clone and the migration again** → ambele curate.
- [ ] **Step 6: Commit** (`feat(executie): rest de decontat — schema, drept, calcul (20270105a, NEAPLICATĂ)`), PR draft, brief Jak cu SHA-ul head-ului.

### Task 2: Poarta proiectului nou (migrarea B)

**Files:**
- Create: `supabase/migrations/20270105b_executie_proiect_configurare.sql` (+ `.l15.tsv`, ROLLBACK, `supabase/tests/20270105b_..._dryrun.sql`)

**Interfaces:**
- Consumes: `executie_proiecte.configurare_completa_la`, `configurare_exceptie_motiv` (Task 1); `fn_rest_decontat_drept`.
- Produces: `fn_executie_proiect_configurare_completa(p_proiect bigint, p_motiv text default null) returns jsonb` — setează `configurare_completa_la = now()` doar dacă proiectul are rânduri `contract_initial` active; altfel doar owner-ul, cu `p_motiv` nevid (scris în `configurare_exceptie_motiv` + jurnal); de chemat de owner / MP / `executie_rest_decontat` editor.
- Semantica (decizie de construcție): „în configurare” = `configurare_completa_la IS NULL`. Poarta blochează: (a) `fn_rest_decontat_confirma_situatie` (deja din Task 1, prin lipsa bazei) și (b) marcarea proiectului ca finalizat la configurare; NU blochează pontajul, rapoartele, logistica. Proiectele existente nu se modifică; apar în `v_executie_rest_decontat_lipsuri` ca `fara_oferta`.

- [ ] **Step 1: Failing dry-run test**: proiect fără ofertă → `fn_executie_proiect_configurare_completa` excepție pentru MP; owner fără motiv → excepție; owner cu motiv → ok + motiv salvat; proiect cu ofertă confirmată → ok pentru MP.
- [ ] **Step 2: Run on clone → FAIL.**
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Apply on clone + run test → PASS; rollback + reapply curate.**
- [ ] **Step 5: Commit** (în același PR cu Task 1 sau următorul, după verdictul Jak).

### Task 3: Parsarea situației detaliate și potrivirea (browser, fără AI)

**Files:**
- Create: `src/restDecontat/parsareSituatie.js`, `src/restDecontat/potrivire.js`
- Modify: `src/devizParser.js` (doar `export` pentru normalizarea UM existentă, dacă e internă)
- Test: `src/restDecontat/parsareSituatie.test.js`, `src/restDecontat/potrivire.test.js` (fixture-uri sintetice, fără date reale)

**Interfaces:**
- Produces:
  - `parseSituatieExcel(arrayBuffer) -> { antet: {nr_situatie, luna, an}, linii: [{obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate_perioada, cantitate_cumulat_doc, pret_unitar, valoare, tip_rand}], total }` — recunoaște antetele coloanelor („cantitate în perioadă / luna curentă”, „cumulat”, „preț unitar”, „valoare”), rândul OS și „diverse” → `tip_rand` `os`/`diverse`.
  - `parseDevizModificare(file) -> { linii: [...] }` — pentru AA / NR / NCS; refolosește `parseDeviz` și păstrează semnul cantităților.
  - `potrivesteLinii(linii, baza) -> [{...linie, cheie_propusa, nivel: 'exact'|'cod'|'descriere'|'de_verificat', scor}]` — `baza` = rânduri din `v_executie_rest_decontat_baza`; ordinea: cod + obiect → cod singur (unic în proiect) → similaritate pe denumire (tokeni, ≥ 0.85 = `descriere`, sub = `de_verificat`); UM diferit după `normalizeUm` → `de_verificat` indiferent de nivel.
  - `cheieClient(obiect, deviz, cod, nr)` — oglinda lui `fn_rest_decontat_cheie`, doar pentru afișare; cheia scrisă o calculează BD-ul.
- [ ] **Step 1: Failing tests**: fixture XLS sintetic cu 3 obiecte, un cod repetat în același deviz, o linie OS, o cantitate negativă → `linii.length`, `tip_rand`, semnul păstrat, `total` = suma valorilor; potrivire: cod+obiect → `exact`; cod existent în alt obiect → `cod`; denumire aproape identică fără cod → `descriere`; **um diferit -> de_verificat**; cod inexistent → `de_verificat`.
- [ ] **Step 2: `npx vitest run src/restDecontat` → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npx vitest run src/restDecontat` → PASS; `npx vite build` curat.**
- [ ] **Step 5: Commit + PR draft + Jak.**

### Task 4: Ecranul de încărcare cu previzualizare și confirmare

**Files:**
- Create: `src/restDecontat/IncarcareDocument.jsx`
- Test: `src/restDecontat/IncarcareDocument.test.jsx`

**Interfaces:**
- Consumes: Task 3 (`parseSituatieExcel`, `parseDevizModificare`, `potrivesteLinii`); RPC-urile din Task 1; amprenta = SHA-256 al fișierului (Web Crypto).
- Produces: `<IncarcareDocument proiectId tip="situatie"|"baza" sursa? client onGata />` — alege fișierul (sau o propunere din `executie_rest_decontat_propuneri`, Task 6), arată tabelul de previzualizare (nivelul potrivirii colorat; `de_verificat` cere alegerea articolului sau „articol nou, în afara ofertei”), totalul citit vs referința, mod import (`diferente` implicit, `lista_completa`), „înlocuiește” doar când nr. există; controlul cumulatului: dacă `cantitate_cumulat_doc` ≠ decontatul anterior + perioada (toleranță 0,001), rândul devine `de_verificat`; butonul „Confirm” activ doar fără rânduri `de_verificat` nerezolvate; apelează RPC-ul și arată eroarea BD-ului în clar. Fișierul se urcă în Storage (bucketul existent al proiectului, cale `rest_decontat/<proiect>/<amprenta>`).
- [ ] **Step 1: Failing test** (vitest + client fals): cu un rând `de_verificat` butonul e dezactivat; după alegerea articolului se activează; la confirmare RPC-ul primește `p_linii` cu `cheie` NULL pentru `articol_nou` și `p_inlocuieste=false`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS + build curat.**
- [ ] **Step 5: Commit + PR draft + Jak.**

### Task 5: Tab-ul „💰 Rest de decontat” în proiect

**Files:**
- Create: `src/restDecontat/RestDecontatTab.jsx`
- Modify: `src/Executie.jsx` (tab nou `rest_decontat`, vizibil doar când `fn_rest_decontat_drept(proiect,'citire')` e true — cheamă RPC-ul, nu deduce din rol)
- Test: `src/restDecontat/RestDecontatTab.test.jsx`

**Interfaces:**
- Consumes: `v_executie_rest_decontat`, `v_executie_rest_decontat_obiect`, `v_executie_rest_decontat_lipsuri`, `IncarcareDocument` (Task 4).
- Produces: totaluri sus (bază, decontat, rest, %), lista „lipsuri” (fără ofertă / SL fără detaliu / AA fără deviz / NR-NCS fără deviz), semnalul „nedecontat deloc sau sub 20% când proiectul a trecut de 70% din valoare decontată” (pragurile ca constante în fișier), grupare pe obiect (bani) → articol (bani + cantități), filtre „doar cu rest”, „nedecontat deloc”, „peste ofertă”, ajustările de preț (din `executie_situatii_plata.valoare_ajustare_lei`, doar citite) într-un rând separat, fără efect pe cantități, export Excel (xlsx-js-style), butoane de încărcare (doar cu drept `confirmare` / `documente_baza`), butonul „configurare completă” (Task 2).
- [ ] **Step 1: Failing test**: cu date false — totalul pe proiect = suma obiectelor; filtrul „peste ofertă” lasă doar rândurile cu rest negativ; fără drept de citire tab-ul nu apare.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS + `npx vite build`.**
- [ ] **Step 5: Commit + PR draft + Jak.**

### Task 6: Propunerile turei de noapte (AI local) + registrul automatizărilor

**Files:**
- Create: `supabase/migrations/20270105c_rest_decontat_propuneri.sql` (+ `.l15.tsv`, ROLLBACK, dryrun)
- Modify: skill-ul turei de noapte (`.claude/skills/tura-noapte` sau unde e versionat) — pas nou „rest de decontat”
- Create: `docs/executie/REST_DECONTAT_TURA_NOAPTE.md` (fișa de securitate a–e)

**Interfaces:**
- Produces: `executie_rest_decontat_propuneri(id, proiect_id, tip text check in ('situatie','baza'), sursa_baza text null, referinta text, fisier_path, amprenta, linii jsonb, metoda text check in ('xls','ocr_local'), stare text check in ('noua','confirmata','respinsa'), creat_la)`; `fn_rest_decontat_propune(p_proiect, p_tip, p_sursa_baza, p_referinta, p_fisier, p_amprenta, p_linii jsonb, p_metoda) returns bigint` — EXECUTE doar `service_role`; nu scrie nimic în bază / decontat; idempotent pe (proiect, amprentă). Confirmarea din ecran (Task 4) marchează propunerea `confirmata`.
- Tura de noapte: caută pe NAS / mail situațiile detaliate și devizele AA / NR / NCS lipsă (din `v_executie_rest_decontat_lipsuri`), XLS → aceeași parsare (Node, același modul din Task 3), PDF scanat → cititoarele locale, denumiri fără cod → Ollama propune `cheie_propusa`; scrie DOAR prin `fn_rest_decontat_propune`.
- [ ] **Step 1: Failing dry-run test**: `authenticated` nu poate chema `fn_rest_decontat_propune`; aceeași amprentă de două ori → un singur rând; o propunere nu schimbă `v_executie_rest_decontat`.
- [ ] **Step 2: Run on clone → FAIL. Step 3: Implement. Step 4: PASS + rollback/reapply curate.**
- [ ] **Step 5: Fișa de securitate** (citește conținut extern + scrie doar propuneri; poarta = confirmarea umană din Task 4; identitate service_role justificată: tura rulează fără utilizator) — și rândul pentru `public.automatizari` + secțiunea din `registru_automatizari` pregătite ca SQL NERULAT în PR (le scrie chat-ul după „da”).
- [ ] **Step 6: Commit + PR draft + Jak.**

## Ordinea de livrare și ce rămâne la Răzvan

PR1 = Task 1 + 2 (BD), PR2 = Task 3, PR3 = Task 4 + 5, PR4 = Task 6. Merge după GO Jak pe head + CI verde. Aplicarea migrărilor pe producție, acordarea sub-modulului `executie_rest_decontat`, completarea `mp_employee_id` acolo unde lipsește și încărcarea datelor Lot 1 (ofertă, 6 AA, 15 SL) = doar cu „da”-ul lui Răzvan, prin chat.
