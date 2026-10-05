# Import WinMentor Expert (analiza descriptivă) — specificație v2

**Stare:** v2 după review Paw r1 (Copilot: GO cu condiții, 8 P0 · Jakarinos: de refăcut, 22 probleme). Pregătită în sesiunea de chat la cererea lui Răzvan (06.10.2026: „dacă tot creăm o automatizare nouă, s-o facem cum trebuie din prima”). **Implementarea: sesiunea „Module ERP — programare” (modulul Financiar).** Migrările doar prin `scripts/livrare_migrare.sh`, cu OK-ul lui Răzvan pe schemă.

---

## 0. Pe scurt

Contabila (Mirela Popescu) exportă bilunar din WinMentor Expert „Analiza descriptivă holding” (XLSX, 12 coloane) — cheltuielile firmei pe contracte/șantiere. Azi: un singur import (iulie), făcut manual de Claude, cu o funcție care acceptă orice utilizator logat, scrie neatomic și suprascrie luna. **Aug final și sep intermediar stau neimportate.**

Ținta v2: **fișierul intră în ERP prin upload, se validează strict, un om aprobă exact ce a văzut, iar activarea e atomică, serializată și auditabilă. Niciun cost nu „dispare” pentru că n-a fost mapat, nimic nu se rescrie retroactiv, și rezultatul afișat spune cinstit ce conține și ce nu.**

Faza 1 (acest document): upload + parser v1 + staging sigilat + activare + mapare tipizată + clasificare conturi + tab Contabilitate refăcut + reminder + migrare iulie + backfill aug/sep.
Faza 2 (separat, doar dacă e nevoie reală): preluare din mail. **Ambii revieweri: NU în faza 1.**

---

## 1. Fapte verificate pe fișierele originale (06.10, openpyxl + Decimal)

| | Iulie (importat) | Aug final | Sep intermediar |
|---|---|---|---|
| Rânduri detaliu | 1.684 | 1.199 | 517 |
| `nr_crt` | 1..1684, fără goluri | 1..1219, **20 goluri** (133, 186–187, 201–202, 329–331, 400–401, 530–536, 1168–1170) | 1..517 |
| Date documente | **15.06**..31.07 | 01.08..31.08 | 01.09..17.09 |
| Venit (exact) | 9.960.450,88 | 0 | 0 |
| Chelt net (exact) | 6.567.399,405 | 5.435.486,73 | 2.911.545,07 |
| din care negative (storno) | −39.114,89 | **−911.642,15** | −1.631,00 |
| Max. zecimale | **3** | 2 | 2 |
| Rânduri non-detaliu | 537: 2 antet + subtotaluri „Total <dată>” / „Total <gestiune>” + `T O T A L   G E N E R A L` | doar 2 antet + 1 rând gol final | 2 antet |
| Total general în fișier | 9.960.450,88 / 6.567.399,405 = suma detaliilor ✓ | **lipsă** | **lipsă** |
| Celule îmbinate / formule / foi ascunse | 535 îmbinate / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Tip celulă `cont` | text | text **+ 8 numerice** (303, 205, 628…) | text |
| Rânduri cu venit ȘI chelt ≠ 0 / ambele 0 | 0 / 0 | 0 / 0 | 0 / 0 |

**Regulile convenite (mail Răzvan 21.08 + Marilena 24.08) — verificate pe `.CONTRACT` (col. G):**
| Regulă | Iul | Aug | Sep |
|---|---|---|---|
| Fără venituri în Expert | 39 rânduri | 0 ✓ | 0 ✓ |
| Fără salarii 64x | 200 / 1.240.702 | 0 ✓ | 0 ✓ |
| 625 fără partener (= diurnă, e în ERP) | 157 / 74.600 | 0 ✓ | 0 ✓ |
| Contract „SANTIER” | 74 / 530.243,80 | 0 ✓ | 0 ✓ (cele 2 rânduri „SANTIER” sunt pe **gestiune**, contractul e altul — corecție față de v1) |
| INVESTITII doar 213.x | — | 1 / 6.780 (213.01) ✓ | 6 / 397.940,75 (213.01/213.03) ✓ |
| 213.x pe alt contract | 4 / 471.957,40 | 0 | 0 |

**Conturi care NU sunt cheltuială a perioadei (descoperite în review):**
- **167.1 — rate de leasing** (BT Leasing, BNP Paribas Leasing): aug 20 rânduri / 112.778,53, sep 9 / 55.994,80. E rambursare de datorie (finanțare), nu cost.
- **471 — cheltuieli în avans**: aug 1 / 24.542,29 (Ecovadis, „asigurare ISO”), pe contract SEDIU.
- **205 — imobilizări necorporale** (licențe): aug 150 lei Microsoft Project etc.
- **213.x — imobilizări corporale**: investiții.
- **3xx — stocuri** (302 materiale, 303 obiecte de inventar): aug 461 rânduri / 1.065.254. În practica Gazpet sunt materiale cumpărate direct pe șantier; tratamentul ca „cost de proiect” trebuie confirmat de contabilitate.

**Venit ERP (`facturi_emise.valoare_neta`)** — statusuri prezente: `emisa`, `trimisa` (ambele = facturi valide):
| Lună | Total | Fără proiect | Observație |
|---|---|---|---|
| iun | 9.734.013,09 | 6 fact. / 658.757,57 | cele 3 facturi `trimisa` fără proiect însumează −3,57 mil. (include o factură negativă — storno) |
| iul | 9.982.149,92 (3 facturi negative incluse) | 3 / 546.426,58 | Expert iul: 9.960.450,88 → **diferență 21.699,04** de explicat |
| aug | 9.819.158,54 | 2 / 23.812,51 | |
| sep | 6.609.642,97 | 2 / 61.652,89 | Expert sep e doar 01–17.09 → nu e comparabil pe toată luna |

**Contracte (`.CONTRACT`) fără mapare la proiect:** existente — SEDIU, SANTIER, HABAU OBOGA, PIATRA NEAMT OFERTARE, PROBE PRESIUNE, ACHIZITII; noi în aug/sep — MUNTENI BIRLAD, CONSTRUCTIE BRANDUSELOR, DISTRIBUTIE GAZE ADI IALOMITA VEST, NEPTUN HABAU, HABAU, INVESTITII. **PARC AUTO e azi mapat la un „proiect” (id 24)** — trebuie să devină categorie (§4).

**Dubluri**: rânduri identice pe TOATE cele 11 câmpuri: iul 42 grupuri / 63 apariții în plus; aug 15 / 16; sep 6 / 6. Eșantioanele arată linii legitime (aceeași factură, articole diferite). **Nu se deduplică nimic** (§6).

---

## 2. Invarianți (nenegociabili — orice implementare îi respectă)

1. **I1 — `propus` = import complet, sigilat, imuabil.** Niciun import parțial sau eșuat nu poate deveni activ. Liniile, raportul și totalurile unui import sigilat nu se mai modifică.
2. **I2 — Activarea e serializată pe lună și revalidează server-side.** RPC-ul nu crede raportul din JSON; recalculează din BD condițiile financiare și verifică versiunile pe care le-a văzut omul.
3. **I3 — Fiecare rând cu valoare are exact o destinație cunoscută** (proiect / parc auto / investiții / centru intern / finanțare / avans / exclus) — nu există „a dispărut pentru că n-a fost mapat”. `nealocat > 0` blochează activarea.
4. **I4 — Istoria activă nu se rescrie.** Destinația și clasificarea se îngheață pe linie la sigilare. O schimbare de mapare afectează doar importurile viitoare; corectarea unei luni active = revizie nouă, aprobată, care o înlocuiește tranzacțional pe cea veche.
5. **I5 — Un final nu poate activa încălcări care dublează sau omit costuri** (64x, 625 fără partener, venit ≠ 0, INVESTITII pe alt cont decât 213.x, contract necunoscut) decât cu **excepție owner-only, cu motiv**, auditată.
6. **I6 — Sumele sunt `numeric`**, semnul se păstrează (storno rămâne negativ), totalurile se calculează în BD, rotunjirea e doar la afișare.
7. **I7 — Capabilități separate**: a propune (upload) ≠ a activa ≠ a remapa/clasifica ≠ a vedea date personale. Automatizarea poate doar propune. Dreptul la date personale maschează numele, **nu ascunde valoarea**.

---

## 3. Fluxul

```
Upload XLSX (Financiar → Contabilitate)          [om cu capabilitatea „propune”]
   │ edge `contab-expert-propune` (poartă de rol în cod)
   ▼
importuri.stare = 'procesare'  ── eșec ──► 'invalid' (raport + motiv, reluabil)
   │ parser v1 → linii în batch (pe import_id; retry idempotent)
   ▼
RPC `contab_expert_sigileaza(import_id, nr_linii, sha_continut)`  (o tranzacție)
   │ verifică: nr linii BD = manifest, totaluri recalculate, amprentă, clasificare + destinație pe fiecare linie
   ▼
'propus'  (validat, sigilat; raport_validare + validation_hash + mapping_version + clasif_version)
   │ ecran „Import propus”: rezumat, blocante, avertismente, diferențe vs activul lunii
   ▼
Om cu capabilitatea „activează” → RPC `contab_expert_activeaza(import_id, validation_hash_vazut, activ_vazut_id)`
   │ advisory xact lock pe (societate, luna); revalidează; vechiul 'activ' → 'inlocuit'; noul → 'activ'; audit
   ▼
'activ'   (sau 'respins' cu motiv, de către același rol)
```

Stări: `procesare` → `invalid` | `propus` → `activ` | `respins`; `activ` → `inlocuit` (doar prin activarea altuia). Nimic nu se șterge.

---

## 4. Model de date (migrare nouă, prin runner)

### 4.1 `contab_expert_importuri` (extinsă)
- existente: `id, luna, fisier_nume, storage_path, gmail_message_id, nr_linii, total_venit, total_cheltuiala, importat_la, importat_de`
- noi: `societate text not null default 'GAZPET'` (raport „holding” — perimetrul explicit, intră în cheie), `varianta` ('intermediar'|'final'|'legacy'), `revizie int` (finalul se poate corecta: final r1 → r2, cu `motiv_revizie`), `perioada_de date`, `perioada_pana date` (declarate la upload, validate: în luna `luna`), `stare` (enum/CHECK de mai sus), `sursa` ('upload'|'mail'|'legacy'), `sha256_fisier`, `sha_continut` (amprentă peste rândurile normalizate, multiset — diagnostic, nu cheie), `parser_versiune` ('wme_analiza_descriptiva_v1'), `raport_validare jsonb`, `validation_hash`, `nr_blocante int`, `mapping_version`, `clasif_version`, `sigilat_la`, `propus_de`, `activat_de`, `activat_la`, `respins_de/_la/_motiv`, `exceptii_owner jsonb` (I5), `regim_venit` ('expert_legacy'|'erp').
- `luna` = prima zi a lunii (CHECK). Se renunță la `UNIQUE(luna)` → `UNIQUE (societate, luna) WHERE stare='activ'`.
- **Iulie** devine `varianta='legacy', regim_venit='expert_legacy', sursa='legacy', stare='activ'`, fără confirmator/validare inventate (rămân NULL = necunoscut).

### 4.2 `contab_expert_linii` (extinsă)
- noi: `rand_fizic int` (rândul din Excel — identitatea tehnică; **NU `nr_crt`**), `valoare_venit_sursa/valoare_chelt_sursa text` (celula originală), `venit/cheltuiala numeric(18,4)`, `destinatie_tip` + `destinatie_proiect_id` (înghețate la sigilare), `clasificare` (din §4.4, înghețată), `hash_linie`.
- `cont`, `document_nr` = **text** întotdeauna (8 conturi numerice în aug).
- Fără UPDATE/DELETE după sigilare (trigger + RLS fără politici de scriere pentru utilizatori).

### 4.3 `contab_contract_map` (înlocuiește `contab_santier_map`)
- `contract_text` (normalizat: trim, spații multiple → 1, NBSP → spațiu, uppercase; păstrăm și forma brută), `tip` ('proiect'|'parc_auto'|'investitii'|'centru_intern'|'exclus'), `proiect_id` (obligatoriu ⇔ tip='proiect'), `valabil_de/pana`, `versiune`, `modificat_de/_la`, `motiv`.
- Audit la orice schimbare (vechi → nou, cine, când, motiv).
- Seed inițial: cele 24 existente; **PARC AUTO → tip `parc_auto`** (nu proiectul 24); SEDIU, ACHIZITII → `centru_intern`; INVESTITII → `investitii`; SANTIER (iulie) → `centru_intern` cu notă „legacy, nealocat contabil”; restul nemapate → le mapează Mirela/Marilena din UI înainte de activare (I3).

### 4.4 `contab_cont_clasificare` (nou — matricea conturilor)
Clasificare pe **prefix de cont** (cel mai lung prefix câștigă): `clasa` ∈ `cost` | `investitie` | `finantare` | `avans` | `stoc_consumat` | `exclus` | `de_clarificat`.
**Seed propus (de confirmat o singură dată de contabilitate în UI — §11 D1):**
| Prefix | Clasă propusă | De ce |
|---|---|---|
| 6 (fără 64, 625-fără-partener) | `cost` | cheltuieli |
| 64 | `exclus` (regula 1: salariile vin din stat, nu de aici) — pe final = blocant I5 | |
| 625 cu partener | `cost` (cazare) · 625 fără partener = diurnă → blocant pe final | |
| 302, 303 | `stoc_consumat` (tratat ca cost de proiect) | materiale cumpărate direct pe șantier — **de confirmat** |
| 213, 205 | `investitie` | imobilizări |
| 167 | `finantare` | rate leasing — **NU** cost |
| 471 | `avans` | cheltuieli în avans |
| 7 | `exclus` (pe regim ERP venitul nu vine de aici) | |
| orice alt prefix | `de_clarificat` → **blocant pe final**, avertisment pe intermediar | |

`clasif_version` se îngheață pe import (I4).

### 4.5 `contab_gestiune_activ` (nou, opțional în faza 1 — recomandat)
Alias controlat `gestiune_text_normalizat → logistica_active.id`. Regex nr. auto / „EXCAVATOR|MOTOCOMPRESOR|…” doar **propune** aliasuri. Regula: gestiune = activ de flotă cunoscut **și** contract ≠ PARC AUTO → avertisment cu sumă (nu blocant: combustibilul unui utilaj pe șantier se poate aloca legitim lucrării — ex. „BC98BLK NEGRU JENICA” pe BILCIURESTI).

### 4.6 `contab_expert_audit` (nou)
Append-only: `import_id, actiune (propune/sigileaza/invalideaza/activeaza/respinge/exceptie/remapare/clasificare), actor, la, detalii jsonb`.

---

## 5. Contractul parserului `wme_analiza_descriptiva_v1`

### 5.1 Schema fizică (12 coloane, A–L) — validată exact
| idx | col | Antet rând 1 | Antet rând 2 | Câmp |
|---|---|---|---|---|
| 0 | A | `Nr` | `crt` | nr_crt |
| 1 | B | *(gol — structural)* | `Nr` | document_nr (text) |
| 2 | C | `Document` | `Data` | document_data |
| 3 | D | `.Parteneri` | *(gol)* | partener |
| 4 | E | `.Articole stoc` | *(gol)* | articol |
| 5 | F | `.Gestiuni` | *(gol)* | gestiune (NU proiect) |
| 6 | G | `.CONTRACT` | *(gol)* | contract → destinație |
| 7 | H | `Inca` | `Venit` | venit |
| 8 | I | `drare` | `Chelt` | cheltuială |
| 9 | J | `.TRONSON` | *(gol)* | tronson |
| 10 | K | `.Plan conturi` | *(gol)* | cont (text) |
| 11 | L | `.Personal` | *(gol)* | persoană |

Normalizare permisă doar pentru: spații la capete, NBSP, spații multiple. **Fără fuzzy matching.** Antet diferit → `invalid` cu „format necunoscut — parser v1 nu se aplică” + semnătura găsită (pentru un viitor parser v2). O singură foaie vizibilă cu această schemă; zero sau mai multe → blocant. Foi/rânduri/coloane ascunse, formule în coloanele importate, fișier criptat/corupt → blocant.

### 5.2 Clasificarea fiecărui rând fizic
`antet` (primele 2) · `detaliu` (A = întreg pozitiv; text cu cifre acceptat prin conversie strictă) · `subtotal` (A începe cu `Total ` și B..G goale) · `total_general` (A normalizat fără spații = `TOTALGENERAL`) · `gol` (toate celulele goale — ignorat, numărat) · **orice alt rând nevid = `necunoscut` → blocant**. Toate rândurile fizice sunt numărate în raport.

### 5.3 Conversii stricte
- Sume: int/float finite, sau text în format explicit (`1234.56` sau `1.234,56` românesc); ambiguu, `NaN`, `#VALUE!`, text liber → **blocant pe rând** (nu zero implicit). Celulă goală ≠ 0 (pe detaliu: gol în ambele = avertisment).
- Precizie: `numeric(18,4)`; sumele se adună în Decimal (în edge) și se recalculează în SQL la sigilare; comparațiile cu ±0,01 pe valori nerotunjite.
- Date: `DD.MM.YYYY` cu validare calendaristică (31.02 → blocant); seriale Excel acceptate doar 1900-based, convertite fără fus.
- Text: fără trunchiere tăcută — peste limită → blocant cu rândul; `... ...` și gol la `.Personal` = lipsă.
- `nr_crt` repetat → blocant; goluri în secvență → avertisment.

### 5.4 Controale
- Total general **prezent** → Venit și Chelt verificate separat față de suma detaliilor (fără subtotaluri), toleranță 0,01 → altfel blocant. Repetat/contradictoriu → blocant.
- Total general **lipsă** (aug/sep) → avertisment „fără sumă de control externă” — omul confirmă totalul afișat.
- Zero rânduri de detaliu → blocant.
- Limite: fișier ≤ 10 MB, ≤ 20.000 rânduri, ≤ 50 coloane, ≤ 30 s procesare.

---

## 6. Validarea la sigilare — blocante vs avertismente

| Verificare | Intermediar | Final |
|---|---|---|
| Structură / tipuri / date / total contradictoriu / rând necunoscut | **blocant** | **blocant** |
| Contract fără destinație (I3) | **blocant** | **blocant** |
| Cont `de_clarificat` | avertisment | **blocant** |
| Venit ≠ 0 pe regim ERP | avertisment | **blocant** (excepție owner) |
| 64x | avertisment | **blocant** (excepție owner) |
| 625 fără partener | avertisment | **blocant** (excepție owner) |
| INVESTITII pe cont ≠ 213/205 · 213 pe alt contract | avertisment | **blocant** (excepție owner) |
| Activ de flotă cunoscut pe contract ≠ PARC AUTO | avertisment cu sumă | avertisment cu sumă |
| Goluri `nr_crt`, storno, dubluri (multiset pe toate câmpurile), document în afara perioadei | avertisment | avertisment |
| Niciun document în luna declarată | **blocant** (lună greșită) | **blocant** |
| Intermediar peste un final activ | — | **blocant** (în SQL) |
| Intermediar cu acoperire mai mică decât activul | avertisment + confirmare explicită | — |
| Diferențe față de activul lunii | afișate: total, nr. linii, adăugări/eliminări pe multiset, **mutări între destinații** (un total egal poate ascunde mutări mari) | idem |

Excepțiile owner-only se cer pe **familie de abatere**, cu motiv, și se salvează în `exceptii_owner` + audit.

---

## 7. Activarea — RPC `contab_expert_activeaza`

`SECURITY DEFINER SET search_path = public, pg_temp`, `REVOKE EXECUTE FROM PUBLIC`, `GRANT` doar `authenticated`, proprietar cu privilegii minime. În ordine, într-o tranzacție:
1. `auth.uid()` = om (nu contul de automatizare) cu capabilitatea „activează” **citită acum din BD** (nu din payload).
2. `pg_advisory_xact_lock(hashtext('contab_expert'), hashtext(societate||luna))` — serializează inclusiv prima activare a lunii.
3. Recitește importul: `stare='propus'`, sigilat, `nr_blocante=0` recalculat din linii (I2), `validation_hash` = cel văzut de om, `mapping_version`/`clasif_version` neschimbate de la sigilare (altfel: „validarea e învechită — revalidează”).
4. Activul curent al lunii = cel văzut de om (`activ_vazut_id`); altfel refuz „între timp s-a schimbat activul — revezi comparația”.
5. Ierarhie: intermediar peste final → refuz; final peste final = revizie (cere `motiv_revizie`).
6. Vechiul activ → `inlocuit`; noul → `activ`; audit. Orice eroare → rollback total.
7. Re-activarea unui import deja activ = idempotent (nu face nimic). Un `inlocuit` nu se reactivează niciodată (se reimportă ca revizie nouă).

`contab_expert_respinge(import_id, motiv)` — aceeași poartă, fără lock de lună.

---

## 8. Securitate (fișa CLAUDE.md pct. 7)

**Capabilități** (în `user_module_access`, sub-chei noi; se acordă DOAR cu acordul explicit al lui Răzvan):
| Capabilitate | Cine (propunere) |
|---|---|
| `financiar.contab_propune` (upload) | Mirela, Marilena |
| `financiar.contab_activeaza` | Marilena, owner |
| `financiar.contab_mapare` (remapare contracte, clasificare conturi, aliasuri flotă) | Marilena, owner |
| date personale (`persoana_nume`) | owner, `can_access_salarii` (ca azi) |
| citire Contabilitate | owner + `financiar` (azi: orice autentificat — **se restrânge**) |
| automatizare (faza 2) | doar `contab_propune` |

- (a) Conținut extern: XLSX-ul (și în faza 2 mailul). Tratat ca date; textul din celule afișat ca text simplu (fără HTML), nu interpretat.
- (b) Scrie: staging + linii (stare `procesare/propus/invalid`), storage. Activarea și remaparea doar prin RPC cu om. Nu trimite mail, nu atinge drepturi.
- (c) Edge-ul folosește `service_role` doar pentru storage + insert în staging; **poarta de rol e în cod** (citește capabilitatea din BD pentru `auth.uid()` din JWT). `verify_jwt` rămâne activ.
- (d) Cine pornește: doar utilizator cu `contab_propune`; calea veche `x-ingest-secret` se **închide**.
- (e) Confirmare umană: activare, respingere, excepții, remapare, clasificare.
- **Storage**: bucket privat dedicat `contabilitate` (nu `documente-proiect`), obiect creat de server la upload (`<societate>/<luna>/<uuid>.xlsx`), fără overwrite; edge-ul nu acceptă `storage_path` arbitrar de la client.
- **RLS**: linii sigilate fără UPDATE/DELETE; `contab_contract_map` / `contab_cont_clasificare` scriere doar `contab_mapare` (se elimină politica ALL veche — politicile permisive se combină prin OR); `persoana_nume` **mascat** pentru cei fără drept (view `security_invoker` care întoarce `NULL` pe coloană), rândul și valoarea rămân vizibile — totalurile văzute de oricine cu drept de citire sunt complete (I7). Raport/diff/fișier brut: aceeași regulă de mascare; fișierul brut doar pentru `contab_activeaza`.
- Rând în `public.automatizari` + secțiune în `registru_automatizari` (inclusiv cron-ul de reminder).

---

## 9. Tab „Contabilitate” — ce afișează

Doar importul **activ** al lunii (istoricul variantelor separat, pe un sub-tab). Antet: varianta, revizia, perioada, cine a activat, avertismentele acceptate.

**Caseta de control lunar** (mereu vizibilă):
- Venit ERP total = alocat proiectelor + **fără proiect** (anomalie vizibilă, nu blocantă) · data calculului (venitul ERP se poate schimba după activare).
- Cheltuieli Expert total = proiecte + parc auto + investiții + centru intern + finanțare + avans + exclus — **închide la ban pe totalul fișierului**; `nealocat` = 0 (I3).
- Storno (sumă negativă) separat.
- Iulie: badge „legacy — venit din contabilitate, include salarii; necomparabil cu lunile de după” + reconcilierea punctuală ERP 9.982.149,92 vs Expert 9.960.450,88 (Δ 21.699,04, de explicat pe documente).
- Intermediar: badge „provizoriu, documente 01–17.09” și venitul ERP pe aceeași perioadă alături de cel pe toată luna.

**Pe proiect**: venit ERP (statusuri `emisa`, `trimisa`; facturi negative incluse cu semn) − costuri Expert cu clasa `cost`/`stoc_consumat` = **„Marjă din export”** (nu „rezultat”). Sub ea, explicit: „nu include: salarii (Salarii), diurne (Diurne), costul utilajelor proprii (pontaj utilaje), cheltuieli centrale” (§11 D3). Parc auto, investiții, centru intern, finanțare — separate, nu intră în marja lucrărilor.

---

## 10. Reminder (pg_cron, Europe/Bucharest)

Obligații pe `(luna, varianta)`: intermediar pentru 1–15 → **20** ale lunii; final pentru luna precedentă → **15**. Stări distincte în notificare: „fișierul lipsește” / „încărcat, dar nevalidat (invalid)” / „propus, așteaptă activare” / „activ ✓”. Notificare în platformă (`notifications`, fără mail automat) către Mirela + Marilena în ziua termenului; la **+2 zile calendaristice** fără `activ` → notificare către Răzvan. Cheie unică `(tip, luna, varianta, destinatar, etapa)` → idempotent la rerulări; monitorizare: rândul cron-ului în `automatizari` + ultima rulare.

---

## 11. Decizii de business (cer acordul lui Răzvan / al contabilității — implementarea pornește cu valorile propuse, editabile din UI)

- **D1 — Matricea conturilor (§4.4)**: seed-ul propus e editabil; **Marilena îl confirmă o singură dată** în UI înainte de prima activare de final. Întrebarea cheie: 302/303 (materiale) = cost de proiect? 167 (leasing) și 471 (avans) în afara costului?
- **D2 — Centrele interne (SEDIU, ACHIZITII, SANTIER-legacy)**: în faza 1 **nu se repartizează** pe proiecte, apar separat. O cheie de repartizare (pe venit / pe ore) e o decizie ulterioară.
- **D3 — Numele indicatorului**: „Marjă din export” cu lista explicită a ce nu conține. Un P&L complet pe proiect (Expert + Salarii + Diurne + Utilaje) e alt proiect, după ce fiecare sursă are aceeași perioadă.
- **D4 — Capabilitățile din §8** și cui se dau: **doar cu acordul explicit al lui Răzvan**, exact cele cerute.
- **D5 — Calea mail (faza 2)**: amânată. Dacă Mirela nu adoptă upload-ul în 1–2 luni, se face un harvester determinist (expeditor permis, atașament `.xlsx`, message-id + attachment-id, limite), care doar **propune**.

---

## 12. Migrare și cutover (o singură livrare coordonată, prin runner)

1. **Înainte**: etalon iulie — `count`, sume pe contract, `sum(venit)`, `sum(cheltuiala)`, nr. linii cu persoană; inventar cititori (`Financiar.jsx` → `ContabilitateWMTab`, orice view/RPC care citește `contab_expert_*`).
2. **Oprește calea veche**: `contab-expert-import` v12 → stub 410 (sau ștearsă) **în aceeași fereastră** cu migrarea (eliminarea `UNIQUE(luna)` rupe `upsert onConflict:'luna'`).
3. Migrarea: coloane noi, stări, tabele noi, RLS, RPC-uri, seed mapare + clasificare, conversie iulie → `legacy/activ`, recalcul `destinatie_*`/`clasificare` pe liniile iulie și **compararea cu etalonul** (aceleași sume pe contract; diferențe = refuz în `$post$`).
4. Frontend: tab-ul citește doar activul; ecranul de upload/propus/activare.
5. Rollback planificat înainte de prima variantă nouă (după ce există 2 variante pe o lună, `UNIQUE(luna)` nu mai poate fi reintrodus).
6. **Backfill**: aug final, apoi sep intermediar — **prin același flux uman** (upload de Marilena/Mirela sau de Răzvan, propus → activare), nu prin script. Aug intermediar nu se importă (înlocuit de final). Fișierele originale le are Răzvan în mail (thread-urile din 15.09 și 21.09).

---

## 13. Teste minime (criteriu de acceptare)

**Parser (unit, pe fixture-uri sintetice + cele 3 originale):** antet exact / B1 gol / „Inca”+„drare” / coloană mutată, lipsă, în plus / două foi candidate; clasificarea fiecărui rând (subtotaluri iulie, `T O T A L   G E N E R A L`, gol la final, rând necunoscut, `nr_crt` text/fracționar/repetat, goluri); sume int/float/3 zecimale/negative/text românesc/ambiguu/`#VALUE!`/gol; date 31.02, an bisect, serial Excel; document „F”, cont numeric 303 → text, `... ...`; total prezent corect / greșit cu 0,009 / 0,011 / repetat / lipsă; formule, foi ascunse, fișier corupt, peste limite. **Pe originale**: 1.684 / 1.199 / 517 rânduri, cele 20 goluri din aug, sumele exacte din §1.

**SQL real (Postgres 17, rol non-superuser, RLS reală — modelul `scripts/pg/test_*.mjs` + pas în CI):**
- staging: eșec la batch 2 → nimic activabil; retry fără duplicate; sigilare cu manifest greșit → refuz; UPDATE pe linie sigilată → refuz.
- activare: propus valid / invalid / respins / înlocuit; intermediar peste final → refuz; final r2 cu motiv; idempotență pe activ; retry întârziat după înlocuire → refuz; eroare injectată după dezactivarea vechiului → rollback, vechiul rămâne activ.
- concurență: două sesiuni activează pe aceeași lună (cu și fără activ anterior) — a doua așteaptă lock-ul (observat în `pg_locks`) și e refuzată ca „activul s-a schimbat”; luni diferite nu se blochează; remapare în timpul review-ului → validarea veche respinsă.
- roluri: anon, autentificat fără financiar, `contab_propune`, `contab_activeaza`, `contab_mapare`, owner, cont de automatizare (doar propune), rol revocat înainte de activare, RPC apelat direct, DML direct pe mapări/stări/linii → refuz; `EXECUTE` revocat de la PUBLIC; politica ALL veche eliminată.
- confidențialitate: utilizator fără drept salarial vede totalul complet și `persoana_nume` NULL; fișierul brut inaccesibil fără `contab_activeaza`; obiect din alt prefix inaccesibil.
- migrare: etalonul iulie identic înainte/după.

---

## 14. Ordinea de implementare recomandată (PR-uri mici)

1. **PR1 — Migrare + RPC-uri + teste SQL** (fără UI): schema, stări, mapare tipizată, clasificare, RLS, sigilare, activare, conversie iulie, oprirea v12. Review Jakarinos + Copilot GO MERGE / GO APPLY (SHA). Apply cu OK Răzvan pe schemă.
2. **PR2 — Edge `contab-expert-propune` + parser v1 + teste unit** pe cele 3 originale.
3. **PR3 — UI**: upload, ecran „Import propus” (blocante/avertismente/diff/excepții), activare, mapare contracte, matricea conturilor, caseta de control, tab refăcut.
4. **PR4 — Reminder cron** + rând `automatizari` + `registru_automatizari`.
5. **Backfill** aug final + sep intermediar prin UI, cu Marilena. Sep final: 15.10 prin fluxul normal.

---

## Anexa A — Jurnal review
| Rundă | Reviewer | Verdict | Esențial |
|---|---|---|---|
| r1 (06.10, v1) | Copilot | GO cu condiții | 8 P0: staging atomic, activare serializată + revalidare, destinație obligatorie, mapare înghețată, reguli de dublare blocante pe final, sume decimale, venit fără proiect în control, RLS care nu ascunde valoarea |
| r1 (06.10, v1) | Jakarinos | de refăcut | 22 probleme (11 blocante): definiția rezultatului, clasificarea conturilor, statusuri venit ERP, staging, concurență, capabilități, RLS persoană, mapare, antet 12 coloane, clasificare rânduri, conversii stricte, migrare/cutover; corecție cifre SANTIER sep |
| r2 (v2) | — | în curs | |
