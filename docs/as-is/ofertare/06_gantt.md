# 06 — Gantt / grafic de execuție (AS-IS), Ofertare · repo main @ 55779b5 · schema live 23.09.2026

Surse citite integral: `src/GraficLucrare.jsx` (317 l.), `src/graficCPM.js` (135), `src/GraficPoarta.jsx` (438), `src/ofertarePoarta.js` (258), `src/graficRelatii.test.js` (179), `src/ofertareControale.js` 1-60 + 585-661, `supabase/functions/ofertare-genereaza-capitol/index.ts` (384), regiuni grafic din `src/OfertarePropunere.jsx`, `src/OfertareOrganigrama.jsx`, `src/OfertareLicitatii.jsx`, `src/App.jsx`, migrațiile `20260913_ofertare_pt_stare_grafic_avertismente.sql`, `20260914_ofertare_pt_stare_grafic_declarat.sql`, `20260913_ofertare_pt_pachet_manifest.sql`, `20260913_fn_ofertare_personal_disponibil.sql`. Schema/date live prin `execute_sql`.

## 0. Inventar obiecte

### Tabele (live, `information_schema`)
| Tabel | Coloane | Constrângeri | RLS | Triggere | Funcții SQL `%grafic%` |
|---|---|---|---|---|---|
| `grafic_activitati` | id, proiect_id, licitatie_id, wbs, denumire, durata_zile (int, default 1, CHECK ≥0), jalon bool, **predecesori jsonb** `[{id,tip,lag}]`, **resurse text**, nivel int, ordine int, note, valoare_lei numeric, created_at, updated_at | PK; `grafic_ancora` CHECK (proiect_id OR licitatie_id NOT NULL); FK → executie_proiecte / ofertare_licitatii ON DELETE CASCADE | sel/ins/upd/del `auth.uid() IS NOT NULL` | **niciunul** | **niciuna** |
| `grafic_parametri` | id, licitatie_id (UNIQUE, FK cascade), **parametri jsonb** (mod, data_start, durata_luni, echipe, mediu, iarna, os_zile, procurare_zile, receptie_zile, include_bransamente, nr_bransamente, srm, srm_zile, **fronturi[]** {nume,lungime_m,dn,echipe}, jaloane[], ferestre_operator, cantitati_asumate, tip_lucrare), updated_at, updated_by | PK, UNIQUE(licitatie_id) | sel/ins/upd/del authenticated | niciunul | niciuna |
| `grafic_versiuni` | id, licitatie_id (FK cascade), versiune int, **mod text default 'oferta'**, generat_la, generat_de uuid, durata_zile int, **poarta jsonb []**, **snapshot jsonb {}**, **activitati jsonb []**, nota | PK, UNIQUE(licitatie_id, versiune) | **doar SELECT + INSERT** (append-only; fără UPDATE/DELETE policy) | niciunul | niciuna |

Nu există tabel de calendar, de resurse alocate pe activități, nici `grafic_*` pentru proiecte de execuție dincolo de `grafic_activitati.proiect_id`.

### Date live
- `grafic_versiuni`: **1 singur rând** — licitatie 85 (Laza), versiune 1, `mod='import'`, `generat_de=NULL`, 660 zile, `poarta=[]` (0 elemente), 66 activități în forma „import" (`cod, es, ef, ls, lf, marja, critic, durata, echipa, pachet, predecesori[{cod,relatie,lag}]`), `snapshot` keys: `sursa, echipe, jaloane, conventie, importat_de, unitate_timp`. Notă: „Import 1:1 al graficului DEPUS pe 10.07.2026 … NU e generat de motor". Nu există cod în repo care să scrie `mod='import'` — rândul a fost inserat prin SQL/MCP, în afara UI.
- `grafic_activitati`: licitatie 5 → 20 rânduri (18 cu resurse text, 19 cu predecesori, ultima modificare 17.09.2026) **fără niciun rând în grafic_versiuni și fără grafic_parametri**; proiect 25 (Hoghilag, execuție) → 24 rânduri; licitatie 85 → **0 rânduri** (versiunea importată nu a fost „desfăcută" în editor).
- `grafic_parametri`: licitatie 3 (mod oferta, 6 fronturi, 29.985 m, iarna=true, data_start 2027-03-01, 36 luni) — fără activități, fără versiuni.
- `v_ofertare_pt_stare` live: 85 → grafic_versiune 1/import/0 avertismente/fronturi NULL; 3 → versiune NULL, fronturi_m 29985, lista_f3_m NULL; 5 → versiune NULL, fronturi NULL, lista_f3_m 6520.
- `ofertare_pt_pachet`: **0 rânduri** (nici un pachet aprobat încă).
- `ofertare_norme_productivitate`: 19 rânduri; **una singură `incredere='validat'`** — `PE_LANT` (retea_pehd, 100 m/zi, coef_iarna 0.7, coef_teren_greu 0.6, validat_de Razvan Trusu). Toate cele 18 `conducta_otel` sunt `propus` ⇒ poarta graficului blochează (`norme: block`) orice licitație cu `tip_lucrare='conducta_otel'`; motorul oricum e doar PEHD (`motorPEHD`).

### Rută / meniu
- `src/App.jsx:49` import; `:153-157` `GraficLucrareRoute` → `:8593` `<Route path="/grafic/:tip/:id" …>`; tip ∈ {`proiect` → `executie_proiecte`, `licitatie` → `ofertare_licitatii`}.
- Intrare din Ofertare: `src/OfertareLicitatii.jsx:2967` link `📅 Poarta grafic + Gantt (drum critic, MS Project, F9)` → `/grafic/licitatie/${l.id}`.
- Același tabel `grafic_activitati` e folosit de Execuție (`proiect_id`), fără poartă/versiuni (PoartaGrafic e montat doar `!eProiect` — `GraficLucrare.jsx:235`).
- `OfertareOrganigrama.jsx:644` citește doar `grafic_parametri.parametri.echipe` ca indiciu; comentariu `:20-22`: „`resurse` e text liber … totalul din Gantt e câmp manual (noduri.muncitori_gantt)".
- `ofertare-organigrama-spec/index.ts:79,166`: spec-ul AI are doar un flag `corelare_grafic: bool` (cerința spune că organigrama trebuie corelată cu graficul); nu citește tabelele grafic.

---

## A. PIPELINE

Câmpuri: Stage · Trigger · UI/component · Function/API/RPC · Tables/views · Input · Output · Status_before → Status_after · Human_gate · AI_action · Versioning · Provenance · Downstream_consumer · Failure/retry

### G01 — Parametri grafic (fronturi, echipe, durată, calendar-flags)
- Stage: pregătire intrări
- Trigger: omul editează în „Poarta grafic" (`GraficPoarta.jsx:393-431`), sau „Propune din cantități" (`:261-276`)
- UI: `PoartaGrafic` → `setParam`/`setFront` `:257-258`; `salveaza` `:278-284`
- Function/API: `supabase.from('grafic_parametri').upsert({licitatie_id, parametri: p, updated_at, updated_by}, {onConflict:'licitatie_id'})` `:280`
- Tables: `grafic_parametri` (W); citește `ofertare_cantitati` (id, obiect, categorie, denumire, um, cantitate, cantitate_plansa, status) `:239`, `ofertare_norme_productivitate` `:240`, `ofertare_cerinte` filtrate ilike grafic/jalo/durata `:241-242`, `grafic_versiuni` (listă) `:243`
- Input: cantități (fronturile propuse din `randuriFront` `:45-53`: rânduri um='m', fără „total", întâi TITLU SECȚIUNE ~ rețea|conduct|extindere, altfel categorie ~ rețea|conduct), text cerințe (durata max regex `(\d{1,3})\s*luni` `:251-255`)
- Output: `grafic_parametri.parametri` jsonb (un singur rând per licitație, **suprascris la fiecare save**, fără istoric)
- Status: — (nu există stare; `dirty` doar în React)
- Human_gate: da (omul completează; nicio validare server)
- AI_action: nu
- Versioning: **nu** — upsert; `snapshot.parametri` din `grafic_versiuni` e singura copie istorică (doar la G03)
- Provenance: `updated_by` uuid, `updated_at`
- Downstream: G02 checklist, G03 motor, `v_ofertare_pt_stare.grafic_fronturi_m` (CTE `gp`: `sum(fronturi[].lungime_m)`), `OfertareOrganigrama.jsx:644` (`parametri.echipe`)
- Failure: toast; nicio reîncercare

### G02 — Checklist „Poarta grafic" (client-side)
- Stage: control intrări
- Trigger: `useMemo` la fiecare schimbare `p/cantitati/norme/cerinte` `GraficPoarta.jsx:287-313`
- Function: pură în componentă; rânduri `k ∈ {cant, front, norme, echipe, durata, cerinte, brans, ferestre}` cu `stare ok|warn|block`; `blocat = poarta.some(stare==='block')` `:314`
- Tables: doar citire (vezi G01)
- Output: array `poarta` în memorie; **persistat doar în `grafic_versiuni.poarta` la G03** `:327`
- Human_gate: butonul „Generează grafic" `disabled={blocat || busy}` `:374`
- Versioning: nu
- Downstream: `v_ofertare_pt_stare.grafic_avertismente` = count(`poarta[]` cu `stare<>'ok'`) pe ULTIMA versiune (view live, CTE la coloana `grafic_avertismente`)
- Failure: UI-only; regulile nu există server-side (un INSERT direct în `grafic_versiuni` cu `poarta=[]` trece — exact cazul Laza v1)

### G03 — Generare grafic + îngheț versiune (motorul PEHD)
- Stage: generare
- Trigger: click „⚙️ Generează grafic (ofertă|intern)" `GraficPoarta.jsx:316-348`
- UI: `genereaza()`; `window.confirm` dacă există rânduri: „Graficul curent (N rânduri) va fi ÎNLOCUIT … Versiunea veche rămâne în istoric" `:318` (afirmație inexactă — vezi BP-05)
- Function: `motorPEHD(p, norme)` `:80-174` (client, pur) → `{rows, factor, intern, total}`; `cpmTotal` `:178-192` (forward pass duplicat, doar FS/SS)
- Tables (W, ordinea din cod): (1) `grafic_versiuni.insert({licitatie_id, versiune: max+1 (calculat client `:324`), mod: p.mod, generat_de: profile.id, durata_zile: total, poarta, snapshot:{parametri, cantitati (toate rândurile), norme (tip_lucrare), cerinte_ids, factor_intindere, durata_interna_zile}, activitati: gen (id-uri temporare negative, predecesori pe id temporar, FĂRĂ es/ef), nota})` `:325-329`; (2) `grafic_activitati.delete().eq('licitatie_id')` `:332`; (3) insert rânduri fără predecesori `.select('id, ordine')` `:333-335`; (4) mapare id temporar→real pe `ordine` și `update predecesori` **rând cu rând** `:337-341`
- Input: parametri + norme (PE_LANT: `productie_zi`, `coef_teren_greu` dacă mediu=oras, `coef_iarna` dacă `!p.iarna`) `:81-84`
- Output: rânduri noi în `grafic_activitati` + rând nou în `grafic_versiuni`
- Status_before → after: nu există coloană de stare; „ultima versiune" = `max(versiune)`
- Human_gate: confirm() + butonul blocat pe roșu (client)
- AI_action: nu (motor determinist)
- Versioning: `versiune = (versiuni[0]?.versiune||0)+1` calculat în browser; UNIQUE(licitatie_id, versiune) prinde doar coliziunea exactă
- Provenance: `generat_de`, `generat_la`, `snapshot` (parametri/cantități/norme/cerințe_ids)
- Downstream: editor G04, view `grafic_versiune`, `grafic_versiune_mod`, `grafic_activitati_declarate`, `grafic_avertismente`; pachet (G08) copiază numărul
- Failure: **ne-tranzacțional** — dacă pică între (1) și (3)/(4): versiune înghețată fără activități, sau activități fără predecesori; toast, fără rollback

### G04 — Editor Gantt (working copy) + CPM
- Stage: editare
- Trigger: pagina `/grafic/:tip/:id`; `load()` `GraficLucrare.jsx:49-60`
- UI: tabel editabil `:284-311` (denumire, durata_zile, jalon, predecesori text „3FS, 7SS+10", resurse text liber, valoare_lei), `adauga` `:73-78`, `sterge` (DELETE imediat în BD, fără curățarea dependențelor: „dependențele către ea rămân de curățat manual" `:81`), `muta` `:86-94`, `salveaza` `:96-121`
- Function: `calcCPM(rows)` din `graficCPM.js:24-71` în `useMemo` `:63`; `textToPred/predToText` `graficCPM.js:16-20`
- Tables: `grafic_activitati` (R/W, per rând: insert/update), `executie_proiecte` sau `ofertare_licitatii` (R, doar antet)
- Input: rânduri BD; `dataStart` = `luc.data_start` (doar proiect) sau **azi** `:59` — pentru licitație data de start din `grafic_parametri.data_start` ajunge în editor doar prin `onDataStart` după generare `GraficPoarta.jsx:342`, la reload revine la „azi"
- Output: `grafic_activitati` actualizat; **es/ef/ls/lf/float/critic NU se persistă** (doar în `rez` React)
- Status: `dirty` local
- Human_gate: buton „Salvează graficul"
- Versioning: **nu** — salvarea nu creează `grafic_versiuni`, nu marchează divergența
- Provenance: `updated_at` pe rând; fără `updated_by`
- Downstream: G05/G06/G07 export, G09 generator capitole (citește `grafic_activitati` LIVE)
- Failure: toast la primul rând eșuat → `return` (rândurile anterioare rămân scrise: salvare parțială)

### G05 — Export PDF (imagine)
- Trigger: „📄 Export PDF" `GraficLucrare.jsx:123-142`; html2canvas + jsPDF A3 landscape; `pdf.save('grafic_{tip}_{id}.pdf')` `:138`
- Tables: niciuna (nu se scrie nicăieri; fără hash, fără `pt_pachet_fisiere`)
- Input: DOM-ul SVG cu `rez` curent (working copy, chiar nesalvat)
- Downstream: omul îl atașează manual la pachet / SEAP

### G06 — Export F9 (Excel fizic-valoric)
- Trigger: „📊 Export F9" `GraficLucrare.jsx:148-189`; `xlsx-js-style`; luni = blocuri de 30 zile (`l*30`) `:169`; valoarea repartizată proporțional cu zilele; `XLSX.writeFile(...)` `:185`
- Tables: niciuna; fără hash; **include `valoare_lei`** (element de preț — la Conpet e cerut, la alte autorități interzis în PT; comentariu `OfertarePropunere.jsx:104-107`)
- Input: `rows` + `rez` din working copy

### G07 — Export MSPDI (MS Project XML)
- Trigger: „🗓 Export MS Project" `GraficLucrare.jsx:230-231` → `exportMSPDI({rows, rez, dataStart, titlu, fisier})` `GraficPoarta.jsx:195-223`
- Function: construiește XML string; `<PredecessorLink><Type>${p.tip === 'SS' ? 3 : 1}</Type>` `:203` (**FF→1, SF→1**, adică FS); `<Calendars>` „Calendaristic 7 zile", toate zilele lucrătoare 08-12/13-17 `:215`; `MinutesPerWeek 3360`; `Start/Finish` din `addZile(dataStart, c.es/ef-1)` `:205`; `<Critical>` din `rez` `:207`; `<Cost>` = valoare_lei `:207`
- Output: `Blob` → `a.download = fisier.xml` `:221`; **nu se urcă în storage, nu se hash-uiește, nu apare în `ofertare_pt_pachet_fisiere`**
- Downstream: doar omul (clarificări: „fișierul editabil cerut" — lecția Hoghilag `OfertarePropunere.jsx:152`)

### G08 — Pachet PT (manifest cu SHA-256) — legătura cu graficul
- Trigger: „Aprobă pachetul" `OfertarePropunere.jsx:1727-1775` (`aprobaPachet`)
- Function: `evalueazaPoarta(st)` block → refuz `:1729`; generează DOAR `propunere_docx` + `borderou_docx` `:1738-1741`; `sha256Hex` per blob; `construiesteManifest({… sursaVersiune: sursaVersiuneCapitole(capitole)})` `:1742`
- Tables: `ofertare_pt_pachet.insert({licitatie_id, versiune, grafic_versiune: st?.grafic_versiune || null, …})` `:1751`; `ofertare_pt_pachet_fisiere` (rol, nume, sha256, fisier_path, sursa_versiune) `:1767`; storage bucket `ofertare`
- Link cu graficul: **un singur întreg `grafic_versiune`** (max din view) copiat pe pachet; nicio piesă de grafic generată/hash-uită de pachet; `sursa_versiune` e amprenta capitolelor, nu a graficului
- Downstream: `v_ofertare_pt_stare.pachet_fisiere` → `controlGraficSursa` (G10)

### G09 — Consum de generatorul PT (`ofertare-genereaza-capitol`)
- Trigger: UI „Generează capitol" (owner/responsabil; poartă de rol `index.ts:181-199`)
- Function: `pachetFapte()` `index.ts:74-169`; graficul: `supabase.from('grafic_activitati').select('ordine, denumire, durata_zile, jalon, resurse').eq('licitatie_id', licId).order('ordine').limit(200)` `:81` (client `service_role` `:203`)
- Prompt: `GRAFICUL DE EXECUȚIE (N activități):\n- {ordine}. {denumire} — {jalon|durata zile}; resurse: …` `:145-146`; fără valori (comentariu `:143-144`); dacă lipsă: „nu există încă activități în ERP — duratele și eșalonarea rămân [DE COMPLETAT]" `:147`
- Citește: **tabela LIVE `grafic_activitati`, nu `grafic_versiuni`**; nu transmite `versiune`, `mod`, `data_start`, `durata_luni`, `fronturi`, `es/ef`, drum critic, nici totalul de zile (nu calculează CPM server-side)
- Output: `ofertare_pt_capitole.continut` (sursa='ai'), optimistic pe `versiune` `:364-370`
- Provenance: nu se scrie ce versiune de grafic a intrat în prompt (`ai_usage_log` are doar tokens/cost `:334-338`)

### G10 — Consum de poarta PT (`evalueazaPoarta` + `v_ofertare_pt_stare`)
- Trigger: orice randare a porții (card licitație, panou PT, semnătură, aprobare pachet) — `ofertarePoarta.js:21`
- View (live `pg_get_viewdef`): `grafic_versiune = max(versiune)`; `grafic_avertismente = count(poarta[] cu stare<>'ok')` pe ultima versiune; `grafic_fronturi_m = round(sum(parametri->fronturi[].lungime_m))` din `grafic_parametri` (CTE `gp`); `lista_f3_m` = Σ `ofertare_cantitati` um='m', categorie ~ conduct|rețea, tip_sursa='lista_f3', fără „total"; `grafic_activitati_declarate = activitati` ultima versiune; `grafic_versiune_mod = mod` ultima versiune; `pachet_fisiere` = manifestul ultimului pachet
- Rânduri de poartă:
  - `grafic` `ofertarePoarta.js:107-116`: `stare: !st.grafic_versiune ? 'warn' : (st.grafic_avertismente > 0 ? 'warn' : 'ok')` — **doar advisory**
  - `cantitati` (H2) `:119-120` → `controlCantitati` `ofertareControale.js:30-52`: `f3==null → block`; `gr==null → warn`; `|gr-f3|/f3 > 0.001 → block`; dif≠0 → warn — **blocant**; compară `grafic_parametri.fronturi` (nu activitățile, nu versiunea înghețată)
  - `grafic_sursa` `:142-143` → `controlGraficSursa` `ofertareControale.js:653-661`: fișiere din manifest cu nume/rol ~ `/grafic|gantt|pert|drum critic|eșalonare|program de execu/i`; există piese și `!grafic_versiune` → **block** `SCHEDULE_NOT_FROM_FROZEN_VERSION`; altfel ok (**nu verifică hash-ul piesei vs versiune, doar existența oricărei versiuni**)
  - `grafic_relatii` `:144-145` → `controlRelatiiGrafic` `ofertareControale.js:611-646`: fără versiune/activități → warn; activități fără es/ef (motor) → **ok „nimic de confruntat"** `:620-621`; declarate fără relații → warn `NO_RELATIONS_DECLARED`; `verificaRelatii` conflict → **block** `RELATION_DATE_CONFLICT`; predecesor lipsă/tip necunoscut → block
- Semnătura: `verdictSemnatura` `:161` — `ok → verde`, altfel `galben` (warn-urile de grafic nu opresc depunerea)

### G11 — Import versiune din ofertă depusă (`mod='import'`)
- Trigger: fără UI; rândul Laza v1 are `generat_de=NULL`, `poarta=[]`, activitati în forma `{cod, es, ef, ls, lf, marja, critic, durata, echipa, pachet, predecesori[{cod,relatie,lag}]}`; fixture `test-fixtures/laza/grafic_pert_depus.json`, `anexa5_activitati.json`
- Function: SQL direct (MCP); `normalizeazaActivitati` `ofertareControale.js:599-609` acceptă ambele forme
- Nu populează `grafic_activitati` (85 → 0 rânduri) ⇒ editorul e gol, generatorul de capitole nu vede graficul, dar poarta îl vede

---

## B. OBJECT lifecycle — `schedule` (working) și `schedule version` (frozen)

### B1. `schedule` = rândurile din `grafic_activitati` (per licitatie_id sau proiect_id)
| Câmp | AS-IS |
|---|---|
| where_created | (a) G03 `genereaza()` `GraficPoarta.jsx:332-341` (delete-all + insert + update predecesori); (b) G04 `adauga`+`salveaza` `GraficLucrare.jsx:73-78, 107-112`; (c) seed manual SQL (proiect 25 Hoghilag, licitatie 5) |
| where_updated | G04 `salveaza` (update per rând `:114-116`), `sterge` (delete imediat `:82`), `muta` (reordonare) |
| how_versioned | **nu** — tabela e mutabilă in-place; nu există `versiune`, `hash`, `updated_by`, trigger de audit. Singura „copie" e `grafic_versiuni.activitati` de la momentul G03 (cu id-uri temporare, nu cele reale) |
| how_invalidated | niciodată explicit; G03 face `delete().eq('licitatie_id')` (invalidare prin înlocuire totală) |
| how_confirmed | niciun câmp/stare; „confirmarea" e implicită în existența unei `grafic_versiuni` (care nu e legată de rândurile curente) |
| how_linked_to_source (cantități/fronturi) | indirect: motorul citește `grafic_parametri.fronturi` (propuse din `ofertare_cantitati`, dar copiate ca numere) și scrie `denumire = "{front} — Dn…, L m"` `GraficPoarta.jsx:115`; **nicio FK/ID de cantitate sau front pe rând**; `wbs` există în schemă dar nu e scris nicăieri (grep: 0 utilizări în src) |
| how_linked_to_final_package | **deloc**: pachetul (G08) nu conține piesa de grafic și nu reține hash/ID de activități; generatorul de capitole (G09) citește tabela live fără a nota versiunea |
| computed fields | es/ef/ls/lf/float/critic/total: **doar în memorie** (`calcCPM` în `useMemo` `GraficLucrare.jsx:63`) și în fișierele exportate; nu în BD |

### B2. `schedule version` = rând `grafic_versiuni`
| Câmp | AS-IS |
|---|---|
| where_created | G03 `GraficPoarta.jsx:325-329` (INSERT înainte de a atinge `grafic_activitati`); G11 SQL manual (`mod='import'`) |
| where_updated | niciodată (RLS: doar SELECT/INSERT — append-only real) |
| what it snapshots | `activitati` = rândurile generate de motor **înainte de insert** (id-uri temporare negative, predecesori pe id temporar, **fără es/ef**), `snapshot` = {parametri, toate `cantitati` ale licitației, norme filtrate, `cerinte_ids`, `factor_intindere`, `durata_interna_zile`}, `poarta` = checklist-ul G02, `durata_zile` = total CPM, `nota` text. **Fără hash** (nici pe activitati, nici pe fișiere exportate), fără `data_start` la nivel de coloană (e în `snapshot.parametri.data_start`) |
| `mod` | text, default `'oferta'`; valori întâlnite în cod: `'oferta'` (durate întinse pe `durata_luni` cu factor ≥1 `:141-161`), `'intern'` (norme reale), `'import'` (transcris 1:1 din oferta depusă, doar în date/teste, nu scris de UI). Semantica: **cine/cum a produs activitățile**, nu o stare de workflow (nu există draft/final/depus) |
| how_versioned | `versiune = max+1` din lista încărcată în browser `:324`; UNIQUE(licitatie_id, versiune) |
| how_invalidated | niciodată; „curentă" = `max(versiune)` peste tot (view, poartă, pachet) — o versiune veche nu poate fi „aleasă" |
| how_confirmed | nu există semnătură/aprobare pe versiune; `pachet.grafic_versiune` e copiat automat din view la aprobarea pachetului (`OfertarePropunere.jsx:1751`), fără verificare că activitățile curente ≡ versiunea |
| how_linked_to_source | `snapshot.cantitati` (copie completă) + `snapshot.cerinte_ids`; fără hash/versiune a cantităților |
| how_linked_to_final_package | `ofertare_pt_pachet.grafic_versiune` (int, fără FK către `grafic_versiuni.id`); manifestul nu conține piesa de grafic |

---

## C. Răspunsuri la întrebările-cheie

**(1) CPM client-side? persistat?** — Da, exclusiv client. `graficCPM.js:24-71` (`calcCPM`, forward+backward, float, critic, ciclu) rulează în `useMemo` (`GraficLucrare.jsx:63`); un al doilea forward-pass minimal `cpmTotal` în `GraficPoarta.jsx:178-192`. Nicio funcție SQL/edge de CPM (`pg_proc ILIKE '%grafic%'` → 0). Persistate sunt DOAR intrările (`durata_zile`, `predecesori`, `ordine`); `grafic_versiuni.durata_zile` reține totalul, iar `activitati` **nu conține es/ef** pentru versiunile de motor (`controlRelatiiGrafic` chiar se bazează pe asta: „ES/EF nu sunt declarate … nimic de confruntat" `ofertareControale.js:618-621`). Excepție: versiunea `import` (Laza) are es/ef/ls/lf/marja/critic declarate manual.

**(2) Tipuri de dependență implementate vs etichetate** —
- Parser `textToPred` `graficCPM.js:17-20`: acceptă `FS|SS|FF|SF` + lag ±.
- `calcCPM` `:37` forward: `p.tip === 'SS' ? es+lag : ef+lag` ⇒ **FF și SF sunt tratate ca FS**; backward `:57-59` la fel (doar SS special).
- `cpmTotal` `GraficPoarta.jsx:187`: identic (SS vs restul=FS).
- `exportMSPDI` `:203`: `Type = SS?3:1` ⇒ **FF/SF exportate ca FS**.
- `verificaRelatii` `graficCPM.js:122-126`: implementează corect toate 4 (FS/SS/FF/SF) — dar e doar controlul declarațiilor din poartă, nu planificatorul.
- Motorul PEHD emite doar FS și SS (`:91-137`).
- UI help text `GraficLucrare.jsx:220`: menționează doar „3FS" și „7SS+10".
⇒ Efectiv implementate: **FS, SS (+lag/lead)**. FF/SF: parsate, verificate în poartă, dar **ignorate în calcul și export**.

**(3) Calendar** — Nu există calendar de lucru. Reguli:
- Zile **calendaristice** de la ziua 0, sfârșit exclusiv (`graficCPM.js:9`, `GraficLucrare.jsx:5-7` „calendarul de lucru vine în v2").
- Luni = `30.44` zile (`zileLuni` `GraficPoarta.jsx:76`) la motor; **30 zile** la F9 (`GraficLucrare.jsx:169`); MSPDI `DaysPerMonth 30`, `MinutesPerWeek 3360` (7 zile × 8h) și calendar „Calendaristic 7 zile" `GraficPoarta.jsx:213-215`.
- Iarnă: două mecanisme exclusive — (a) `p.iarna=true` → coeficient 1 (fără reducere de randament) + rând informativ de 75 zile „Întrerupere tehnologică de iarnă" de la 1 dec, `predecesori=[ordin FS +lag]`, **nu constrânge CPM-ul** `:162-171`; (b) `p.iarna=false` → `coefIarna = norme.coef_iarna || 0.7` aplicat pe TOATĂ durata lanțului `:84,113` (nu doar pe lunile de iarnă).
- Teren greu: `mediu==='oras' ? coef_teren_greu||0.6 : 1` `:83`.
- Sărbători legale: **nu** — tabela de sărbători a HR (`App.jsx:4406,4536`, `fn_zile_lucratoare` folosit de `TabConcedii.jsx:451`) nu e folosită de grafic.
- Duplicare: JS (motor) ≠ JS (F9: 30 zile) ≠ XML (MSPDI: 7 zile lucrătoare 8h) ≠ SQL (view-ul nu are nicio regulă de calendar) ≠ prompt (generatorul primește doar „N zile" pe activitate, fără start/durată totală/calendar). `coef_iarna`/`coef_teren_greu` stau în `ofertare_norme_productivitate` dar fallback-urile 0.7/0.6/100 sunt hard-codate în `GraficPoarta.jsx:82-84`.

**(4) Resurse** — `grafic_activitati.resurse` e **text liber** (`"Echipa 1 · excavator"`, `"PFA Mărutoiu + șef șantier"`, `"Echipă SRM + subcontractor"` — `GraficPoarta.jsx:90-138`, date live licitatie 5). Nicio FK către `employees`, `logistica_active`, `ofertare_organigrama`. `parametri.echipe` = un întreg. `fn_ofertare_personal_disponibil(p_la_data)` / `fn_ofertare_echipamente_disponibile` (SECURITY INVOKER, `20260913_fn_ofertare_personal_disponibil.sql:20-53`) sunt apelate doar din `OfertarePropunere.jsx:1478,1597` (pachet personal / echipamente pentru PT) și **nu sunt legate de grafic**: nu există „alocare" (available→allocated) — funcția răspunde doar „cine are autorizație valabilă la data X", fără să știe de fronturi/perioade. `OfertareOrganigrama.jsx:20-22` confirmă: „n-are histogramă de personal — `resurse` e text liber … totalul din Gantt e câmp manual (noduri.muncitori_gantt)".

**(5) Freeze/version** — vezi B2. Snapshot = JSON complet al activităților generate (pre-insert) + parametri + toate cantitățile + norme + `cerinte_ids` + checklist; **fără hash**. Creat DOAR la click „Generează grafic" (`GraficPoarta.jsx:325`), **nu** la salvarea editorului, **nu** la aprobarea pachetului (pachetul doar copiază `max(versiune)`), **nu** la semnătura porții. Working ≠ version: editorul salvează liber în `grafic_activitati` fără să atingă `grafic_versiuni` (`GraficLucrare.jsx:96-121`), nu există comparație/diff/avertisment; poarta PT raportează `versiunea N, fără avertismente` chiar dacă activitățile au fost rescrise după. Cazul live: licitatie 5 — 20 activități editate până la 17.09, 0 versiuni; licitatie 85 — 1 versiune, 0 activități. `mod` = proveniența activităților (`oferta|intern|import`), nu stare.

**(6) Export MSPDI** — Există: `exportMSPDI` `GraficPoarta.jsx:195-223`, buton `GraficLucrare.jsx:230-231`. Download direct în browser (`Blob` + `a.click()`); **nu** se urcă în storage, **nu** primește sha256, **nu** intră în `ofertare_pt_pachet_fisiere` (pachetul generează doar 2 DOCX `OfertarePropunere.jsx:1738-1741`). La fel PDF (`exportPdf`) și F9 (`exportF9`). Nu există export DOCX/PNG al Gantt-ului. Nu există import MSPDI.

**(7) Generator capitole** — citește **tabela live `grafic_activitati`** (`index.ts:81`), nu `grafic_versiuni`; nici `grafic_parametri`. Nu știe versiunea, data de start, durata ofertată în luni, fronturile, drumul critic. Nu loghează ce a citit (doar cost în `ai_usage_log`).

**(8) Poarta PT** — rânduri și caracter:
| Rând | Sursă | Blocant? |
|---|---|---|
| `grafic` (versiune înghețată + `grafic_avertismente`) | `max(versiune)`, `poarta[]` ultimei versiuni | **advisory** (warn/ok; niciodată block) `ofertarePoarta.js:110` |
| `cantitati` H2 (`lista_f3_m` vs `grafic_fronturi_m`) | `grafic_parametri.fronturi` (nu activitățile, nu versiunea) vs `ofertare_cantitati` tip_sursa=lista_f3 | **block** la F3 lipsă sau diferență >0.1 % `ofertareControale.js:33-47`; warn dacă fronturi lipsă |
| `grafic_sursa` (piesă de grafic în manifest fără versiune) | `pachet_fisiere` regex nume/rol | **block** `SCHEDULE_NOT_FROM_FROZEN_VERSION` `:657`; ok dacă există ORICE versiune |
| `grafic_relatii` (relații vs date declarate) | `grafic_activitati_declarate` ultima versiune | **block** la conflict / predecesor lipsă / tip necunoscut; ok automat pentru versiuni de motor |
Verdictul semnăturii: `verde` doar dacă totul e ok, altfel `galben` — dar warn nu oprește depunerea (`verdictSemnatura :161`; `aprobaPachet` refuză doar `block` `OfertarePropunere.jsx:1729`).

---

## D. BREAK_POINTS (fără remediere)

| # | Tip | Loc | Comportament curent (citat) |
|---|---|---|---|
| BP-01 | rule duplicated (CPM) | `src/graficCPM.js:24-71` vs `src/GraficPoarta.jsx:178-192` | Două implementări de forward pass; ambele `p.tip === 'SS' ? es[p.id] + lag : ef[p.id] + lag` — FF/SF cad pe ramura FS. `verificaRelatii` `:122-126` are semantica corectă pentru FF/SF, deci un grafic cu FF/SF ar fi „consistent" în poartă dar calculat greșit în editor/MSPDI. |
| BP-02 | rule duplicated (calendar/luni) | `GraficPoarta.jsx:76` `Math.round(luni*30.44)`; `GraficLucrare.jsx:169` `const ls0 = l * 30, le0 = (l + 1) * 30`; `GraficPoarta.jsx:213` `<DaysPerMonth>30</DaysPerMonth>`; `:215` calendar 7 zile × 8h | Trei convenții de lună/zi; F9 și MSPDI se pot decala față de totalul motorului; MS Project va afișa 8h×7 zile, nu zile calendaristice. |
| BP-03 | rule duplicated (coeficienți) | `GraficPoarta.jsx:82-84` `Number(pe?.productie_zi) \|\| 100`, `\|\| 0.6`, `\|\| 0.7` vs `ofertare_norme_productivitate` | Fallback-uri hard-codate egale cu valorile validate — dacă norma se schimbă în BD dar rândul nu e `validat`, poarta blochează; dacă lipsește complet, motorul rulează tăcut cu 100/0.6/0.7. |
| BP-04 | UI vs server (poartă grafic) | `GraficPoarta.jsx:287-314` (checklist) + `:374` `disabled={blocat \|\| busy}`; RLS `grafic_versiuni` INSERT = `auth.uid() IS NOT NULL` | Blocajul „Generează" e doar în React; orice client autentificat poate insera o versiune cu `poarta=[]` (cazul real Laza v1: `poarta_n=0`, `generat_de=NULL`) ⇒ view-ul raportează `grafic_avertismente=0` și poarta PT „versiunea 1, fără avertismente". |
| BP-05 | working ≠ final (editor vs versiune) | `GraficLucrare.jsx:96-121` `salveaza` scrie doar `grafic_activitati`; `GraficPoarta.jsx:318` confirm „Versiunea veche rămâne în istoric" | Versiunea reține activitățile generate (id temporare), nu cele editate; editările ulterioare (durate, predecesori, rânduri noi/șterse) nu ajung în nicio versiune și nu declanșează avertisment. Live: licitatie 5 are 20 activități editate și 0 versiuni; view-ul → rând `grafic` = warn „nicio versiune generată", H2 = warn (fără fronturi). |
| BP-06 | final ≠ submitted (pachet) | `OfertarePropunere.jsx:1738-1741` `surse = [propunere_docx, borderou_docx]`; `:1751` `grafic_versiune: st?.grafic_versiune \|\| null` | Pachetul înregistrează numai numărul `max(versiune)`; piesa de grafic depusă la SEAP (PDF/XLSX/XML descărcate din editor) nu are hash în manifest. `controlGraficSursa` `ofertareControale.js:653-661` trece `ok` dacă există **orice** versiune, indiferent dacă fișierul din manifest a fost produs din ea. |
| BP-07 | version lost (import fără activități) | `grafic_versiuni` id=1 (lic. 85) `mod='import'`, `activitati` 66 rânduri; `grafic_activitati` lic. 85 = 0 rânduri | Nu există cod de import; versiunea nu poate fi deschisă/editată în Gantt și nu ajunge în promptul generatorului (`index.ts:81` citește `grafic_activitati`) ⇒ capitolul va primi „nu există încă activități în ERP". |
| BP-08 | version lost (generare ne-atomică) | `GraficPoarta.jsx:325-341` INSERT versiune → DELETE activități → INSERT fără predecesori → UPDATE per rând | Fără tranzacție/RPC: eroare la pasul 3/4 lasă versiunea înghețată fără activități sau activități fără relații; `versiune = (versiuni[0]?.versiune \|\| 0) + 1` `:324` calculat din starea din browser. |
| BP-09 | artifact without hash | `GraficLucrare.jsx:138` `pdf.save(...)`, `:185` `XLSX.writeFile(...)`, `GraficPoarta.jsx:220-222` `new Blob([xml])` + `a.click()` | Toate exporturile sunt descărcări locale din working copy (posibil nesalvat: `rows` din state), fără sha256, fără rând în `ofertare_pt_pachet_fisiere`, fără notarea versiunii/`dataStart` folosite. |
| BP-10 | available → allocated | `grafic_activitati.resurse text`; `fn_ofertare_personal_disponibil` (`…personal_disponibil.sql:20-53`) apelată doar în `OfertarePropunere.jsx:1478,1597`; `OfertareOrganigrama.jsx:20-22` | Nu există alocare: disponibilitatea e „autorizație valabilă la data X", Gantt-ul scrie „Echipa 1 · sudor PE" ca text; organigrama cere `muncitori_gantt` manual. Nicio verificare că echipele din `parametri.echipe` există. |
| BP-11 | consumer reads live, not frozen | `ofertare-genereaza-capitol/index.ts:81` `from('grafic_activitati')…limit(200)`; `:145-147` | Capitolul se scrie din tabela mutabilă (fără versiune, fără `data_start`, fără durata în luni, fără drum critic); `ai_usage_log` nu reține ce grafic a intrat în prompt; capitolul poate contrazice versiunea înghețată pe care poarta o consideră „ok". |
| BP-12 | H2 compară parametrii, nu graficul | view CTE `gp`: `sum(parametri->'fronturi'[].lungime_m)`; `ofertareControale.js:30-52` | `grafic_fronturi_m` vine din `grafic_parametri` (editabil oricând, fără versiune), nu din activitățile generate sau din versiunea înghețată; poarta poate fi verde pe H2 cu un grafic generat pe fronturi vechi. Lic. 3 live: fronturi 29.985 m, F3 NULL → `block` „lipsește lista F3". |
| BP-13 | rând `grafic` niciodată blocant | `ofertarePoarta.js:110` `stare: !st.grafic_versiune ? 'warn' : (st.grafic_avertismente > 0 ? 'warn' : 'ok')` | Lipsa totală a graficului în ERP e doar rezervă la semnătură (galben); blocajul apare abia dacă manifestul conține un fișier numit „grafic/gantt/pert" (`controlGraficSursa`) — dar manifestul actual nu conține niciodată astfel de piese (BP-06), deci `grafic_sursa` iese mereu `ok` „pachetul nu conține (încă) piese de grafic". |
| BP-14 | start date nepersistată în editor | `GraficLucrare.jsx:59` `setDataStart((eProiect ? luc?.data_start : null) \|\| new Date().toISOString().slice(0,10))` | Pentru licitații data de start a exporturilor (PDF/F9/MSPDI) e „azi" la fiecare deschidere, nu `grafic_parametri.data_start` (2027-03-01 la lic. 3); doar după o generare în aceeași sesiune `onDataStart(p.data_start)` `GraficPoarta.jsx:342`. |
| BP-15 | ștergere fără curățarea relațiilor | `GraficLucrare.jsx:81-84` `window.confirm("… dependențele către ea rămân de curățat manual")` + `delete().eq('id')` imediat | Predecesorii orfani rămân în jsonb; `calcCPM` îi ignoră tăcut (`filter(p => byId[p.id])` `graficCPM.js:33`), deci graficul se recalculează fără avertisment. |
| BP-16 | `wbs` nefolosit / id-uri ca coduri | schema `grafic_activitati.wbs text`; `grafic_versiuni.activitati[].id` negative temporare | Codurile de activitate din versiune (id temporar) nu corespund cu id-urile reale din `grafic_activitati` (mapate pe `ordine` `GraficPoarta.jsx:337`); nu există cheie stabilă între versiune, editor și piesele depuse (`cod` WBS apare doar în importul Laza). |
