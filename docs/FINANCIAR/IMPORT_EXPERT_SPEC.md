# Import WinMentor Expert (analiza descriptivă) — specificație v3

**Stare:** v3 după review Paw r2 (Copilot: NO-GO punctual, 5 corecții · Jakarinos: de refăcut punctual, N01–N15). v3 închide contractele cerute: staging serializat, destinație ⟂ clasificare cu funcție unică de rezolvare, snapshot imuabil + tentative noi, `validation_hash` canonic, derogări tipizate, date personale în tabel separat, final = lună întreagă, regim legacy conservat. Pregătită în sesiunea de chat la cererea lui Răzvan („dacă tot creăm o automatizare nouă, s-o facem cum trebuie din prima”). **Implementarea: sesiunea „Module ERP — programare” (modulul Financiar).** Migrările doar prin `scripts/livrare_migrare.sh`, cu OK-ul lui Răzvan pe schemă.

---

## 0. Pe scurt

Contabila (Mirela Popescu) exportă bilunar din WinMentor Expert „Analiza descriptivă holding” (XLSX, 12 coloane) — cheltuielile firmei pe contracte/șantiere. Azi: un singur import (iulie), făcut manual de Claude, cu o funcție care acceptă orice utilizator logat, scrie neatomic și suprascrie luna. **Aug final și sep intermediar stau neimportate.**

Ținta: **fișierul intră în ERP prin upload, se validează strict, un om aprobă exact ce a văzut (hash), iar activarea e atomică, serializată și auditabilă. Fiecare leu din fișier ajunge în exact o categorie de raportare, nimic nu se rescrie retroactiv, iar indicatorul afișat spune cinstit ce conține și ce nu.**

Faza 1 (acest document): upload + parser v1 + staging sigilat + activare + mapare tipizată + clasificare conturi + derogări + tab Contabilitate refăcut + reminder + backfill aug/sep. Iulie rămâne neatinsă (legacy).
Faza 2 (separat, doar dacă e nevoie reală): preluare din mail. **Ambii revieweri: NU în faza 1.**

**Perimetru faza 1 (N15):** o singură entitate, **Gazpet Instal SRL, RON**. `facturi_emise` nu are coloană de societate sau monedă (verificat 06.10), deci comparația venit ERP ↔ Expert are sens doar pe o singură entitate. `societate` rămâne în cheie, dar e fixată prin CHECK (`= 'GAZPET'`); multi-societate = proiect separat (ar cere izolarea mapărilor, clasificărilor, drepturilor, filtrelor ERP și a cheilor de reminder). **D6**: contabilitatea confirmă că exportul „holding” conține doar Gazpet Instal (precondiție înainte de prima activare nouă).

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

1. **I1 — Candidatul sigilat e un snapshot imuabil.** După ce un import iese din `procesare`, nu mai intră, nu se modifică și nu se șterge nicio linie, iar metadatele lui (lună, societate, variantă, perioadă, regim, manifest, hash-uri, raport) nu se mai schimbă; se schimbă doar câmpurile de tranziție (`stare`, `activat_*`, `respins_*`, `revizie`), și doar prin RPC-urile din §7. Garanția e în BD (trigger + lock pe părinte, §4.2), deci ține și pe calea privilegiată folosită de Edge, nu doar prin RLS.
2. **I2 — Activarea e serializată pe `(societate, luna)` și revalidează server-side.** RPC-ul nu crede nimic din payload: recalculează `validation_hash` din BD și îl compară cu cel văzut de om.
3. **I3 — Fiecare linie cu valoare ajunge în exact o categorie de raportare**, prin funcția unică din §6.1. Criteriul de completitudine e **numărul** de linii cu valoare fără categorie = 0, nu soldul `nealocat` (−100 sau +100/−100 nu înseamnă alocare completă). Contract nemapat = blocant, **nederogabil**.
4. **I4 — Istoria nu se rescrie (varianta A Copilot).** Maparea, clasificarea și categoria se îngheață pe linie la sigilare. O schimbare de configurare **nu invalidează** un candidat existent și nu atinge liniile lui; ca să aplici configurarea nouă, creezi o **tentativă nouă** (§3) din același fișier. Corectarea unei luni active = revizie nouă, aprobată, care o înlocuiește tranzacțional pe cea veche.
5. **I5 — O abatere de la regulile convenite nu se poate activa pe final decât cu o derogare tipizată**, owner-only, cu motiv, care spune **cum intră suma** în categorii (exclusă / tratată ca cost / reclasificată) — nu un simplu „ignoră”. Structura, contractul nemapat și perioada incompletă nu se derogă niciodată.
6. **I6 — Sume exacte.** `numeric`; semnul se păstrează (storno rămâne negativ); peste 4 zecimale sau peste limită → refuz explicit **înainte** de cast (fără rotunjire tăcută a BD); totalurile se calculează în BD; egalitățile de control sunt exacte; rotunjirea e doar la afișare.
7. **I7 — Capabilități separate și date personale izolate.** A propune ≠ a activa ≠ a mapa/clasifica ≠ a deroga (owner) ≠ a vedea date personale. Numele persoanelor stau într-un tabel separat; tabelul financiar e complet vizibil celor cu drept de citire, deci totalurile nu pierd niciun rând.

---

## 3. Fluxul și automatul de stări

```
Upload XLSX + (luna, varianta, perioada_pana) + cerere_id     [om cu „contab_propune”]
   │ edge `contab-expert-propune`: urcă fișierul (service_role, doar storage), apoi
   │ apelează RPC-urile CU JWT-ul utilizatorului (auth.uid() real; poarta e în SQL)
   ▼
contab_expert_creeaza(...)            → import 'procesare' (cerere_id UNIQUE ⇒ retry = același import)
contab_expert_adauga_linii(id, batch) → linii (UNIQUE(import_id, rand_fizic) ⇒ retry fără dubluri)
contab_expert_sigileaza(id, manifest) → 'propus'  sau  'invalid' (terminal, cu raport)
   │ ecran „Import propus”: rezumat, categorii, blocante, avertismente, diff vs activ, hash
   │ [owner] contab_expert_derogare(...) → hash nou, afișat din nou omului
   ▼
contab_expert_activeaza(id, hash_vazut, activ_vazut_id, confirm_regresie_fata_de, motiv_revizie)
   ▼
'activ'  (vechiul activ → 'inlocuit')        sau   contab_expert_respinge(id, motiv) → 'respins'

Configurare schimbată / contract mapat după sigilare:
contab_expert_tentativa_noua(id_vechi) → import nou 'procesare' (precedent_id = id_vechi, același
   obiect din storage, parser rerulat) ; candidatul vechi → 'depasit'
```

| Din | În | Prin | Observație |
|---|---|---|---|
| — | `procesare` | `creeaza` | `cerere_id` UNIQUE: același `cerere_id` întoarce importul existent (retry al aceleiași cereri) |
| `procesare` | `propus` | `sigileaza` | manifest complet + verificări §5.4/§6 trecute (blocantele de reguli nu împiedică sigilarea; împiedică activarea) |
| `procesare` | `invalid` | `sigileaza` / edge | **terminal**: structură greșită, rând necunoscut, conversie eșuată, manifest incomplet. Retry = import nou |
| `propus` | `activ` | `activeaza` | §7.3 |
| `propus` | `respins` | `respinge` | terminal |
| `propus` | `depasit` | `tentativa_noua` | terminal; înlocuit de tentativa care îl citează |
| `activ` | `inlocuit` | `activeaza` (al altuia) | terminal; un `inlocuit` nu se reactivează — se reîncarcă |

**Retry vs recertificare (N02):** același `cerere_id` = retry tehnic (idempotent). Același fișier (`sha256_fisier`) pe aceeași `(luna, varianta)` cu alt `cerere_id`, cât există deja un import ne-terminal sau activ cu acel fișier → refuz „fișier deja încărcat”, cu excepția `tentativa_noua` (explicită, cu `precedent_id`). `procesare` rămas agățat > 1 h → `invalid` („timeout”) printr-un job de curățenie; nimic nu e activabil din el.

---

## 4. Model de date (migrare nouă, prin runner)

### 4.1 `contab_expert_importuri` (extinsă)
- existente: `id, luna, fisier_nume, storage_path, gmail_message_id, nr_linii, total_venit, total_cheltuiala, importat_la, importat_de`
- noi: `societate text not null default 'GAZPET' CHECK (societate='GAZPET')`, `moneda text not null default 'RON' CHECK (moneda='RON')`, `varianta` ('intermediar'|'final'|'legacy'), `perioada_de date`, `perioada_pana date`, `stare` ('procesare'|'invalid'|'propus'|'activ'|'respins'|'depasit'|'inlocuit'), `sursa` ('upload'|'legacy'), `cerere_id uuid UNIQUE`, `precedent_id` (FK, tentativa anterioară), `revizie int` (alocată **la activare**, §7.3), `motiv_revizie`, `sha256_fisier` (calculat de server), `sha_continut` (multiset normalizat — diagnostic), `parser_versiune`, `manifest jsonb` (§5.4), `raport_validare jsonb`, `nr_blocante_brute int`, `map_hash`, `clasif_hash`, `reguli_versiune`, `sigilat_la`, `propus_de`, `activat_de/_la`, `respins_de/_la/_motiv`, `regim_venit` ('erp'|'expert_legacy').
- CHECK-uri: `luna` = prima zi; `perioada_de = luna`; `luna ≤ perioada_pana ≤ ultima_zi(luna)`; **`varianta='final' ⇒ perioada_pana = ultima_zi(luna)`** (N09/Copilot N2 — documentele individuale din afara perioadei rămân avertisment, ca iulie cu 15.06); `varianta='legacy' ⇔ regim_venit='expert_legacy' ⇔ sursa='legacy'` (RPC-urile refuză crearea `legacy`: e doar rezultatul migrării).
- Unicitate: `UNIQUE (societate, luna) WHERE stare='activ'`; `UNIQUE (societate, luna, varianta, revizie) WHERE revizie IS NOT NULL`. Se renunță la `UNIQUE(luna)`.
- Trigger `contab_expert_importuri_imuabil`: după `procesare`, orice UPDATE în afara câmpurilor de tranziție → excepție; tranzițiile permise doar conform tabelului din §3.

### 4.2 `contab_expert_linii` (extinsă)
- noi: `rand_fizic int not null` + **`UNIQUE (import_id, rand_fizic)`** (identitatea tehnică; **NU `nr_crt`**), `venit_sursa/chelt_sursa text` (celula originală), `venit/cheltuiala numeric(18,4)`, `contract_norm`, `destinatie_tip`, `destinatie_proiect_id`, `clasa`, `familie_regula` (dacă linia încalcă o regulă §6.2), `categorie_bruta` (rezultatul §6.1 la sigilare), `hash_linie`. **Fără `persoana_nume`** (mutat în §4.3).
- `cont`, `document_nr` = **text** întotdeauna (8 conturi numerice în aug).
- **Serializarea scrierilor cu sigilarea (N05 / Copilot N5):** trigger `BEFORE INSERT OR UPDATE OR DELETE` pe linii care face `SELECT stare FROM contab_expert_importuri WHERE id = import_id FOR SHARE` și refuză dacă `stare <> 'procesare'`. `sigileaza` ia `FOR UPDATE` pe același rând părinte → un batch întârziat fie intră înaintea sigilării (și e numărat în manifest), fie așteaptă și apoi vede `propus` și e refuzat. Trigger-ul ține și pentru `service_role`. Test cu două sesiuni (§13).
- UPDATE pe linii: interzis complet (și în `procesare` — un batch greșit se reface ca import nou).

### 4.3 `contab_expert_linii_persoane` (nou — date personale izolate, N07 / Copilot P0.8)
`linie_id` (PK, FK → linii) · `persoana_nume`. RLS SELECT: owner sau `can_access_salarii`. Scriere doar prin `adauga_linii` (în `procesare`). Tabelul financiar `contab_expert_linii` nu mai conține nume → oricine are drept de citire vede toate rândurile și toate sumele; numele se obțin doar printr-un join pe care RLS îl permite numai celor cu drept. **Nu** se folosește view `security_invoker` peste o coloană accesibilă direct.
- **Fișierul brut** (conține nume): URL semnat generat doar de RPC `contab_expert_fisier_url(id)` pentru owner sau (`contab_activeaza` **și** `can_access_salarii`). Bucket privat, fără politică de SELECT pentru `authenticated`.
- **Gestiunea** (ex. „BC98BLK NEGRU JENICA” = auto + șofer): **D7** — propunere: rămâne vizibilă celor cu drept de citire Contabilitate (e dată operațională de flotă, aceiași oameni o văd în Logistica; mascarea ar face analiza flotei imposibilă). Dacă Răzvan decide altfel, gestiunea trece și ea în tabelul personal.
- Rapoartele, diff-urile și erorile nu conțin nume de persoane (doar `rand_fizic`).

### 4.4 `contab_contract_map` (înlocuiește `contab_santier_map`)
- `contract_norm` **UNIQUE** (normalizat: trim, NBSP → spațiu, spații multiple → 1, uppercase; forma brută păstrată separat), `tip` ('proiect'|'parc_auto'|'investitii'|'centru_intern'|'exclus'), `proiect_id` (obligatoriu ⇔ `tip='proiect'`), `modificat_de/_la`, `motiv`.
- **Fără intervale de valabilitate** (N10): maparea curentă se îngheață pe linie la sigilare; istoria e în linii, nu în dicționar → nu pot exista două destinații pentru același contract.
- Scriere **doar prin RPC** `contab_mapare_seteaza(contract, tip, proiect_id, motiv)` (capabilitate `contab_mapare`), cu audit vechi → nou. Fără politici de INSERT/UPDATE/DELETE pentru `authenticated` (se elimină politica ALL veche).
- Seed: cele 24 existente; **PARC AUTO → `parc_auto`** (nu proiectul 24); SEDIU, ACHIZITII → `centru_intern`; INVESTITII → `investitii`; restul nemapate → le mapează Marilena din UI înainte de activare.

### 4.5 `contab_cont_clasificare` (nou — matricea conturilor)
Rânduri `(prefix, conditie, clasa, familie_regula)` cu `conditie` ∈ `oricare` | `cu_partener` | `fara_partener`; `UNIQUE (prefix, conditie)`. Rezolvare: **cel mai lung prefix** care se potrivește; la același prefix, rândul condițional care se potrivește bate `oricare`. Lipsă potrivire → `de_clarificat`. Scriere doar prin RPC (`contab_mapare`), cu audit.

**Seed propus (D1 — confirmat de contabilitate pe hash, §4.6):**
| Prefix | Condiție | Clasă | Familie regulă (§6.2) |
|---|---|---|---|
| 6 | oricare | `cost` | — |
| 64 | oricare | `exclus` (salariile vin din Salarii) | `cont_64` |
| 625 | cu_partener | `cost` (cazare — eligibil, **nu** dovadă că e cazare) | — |
| 625 | fara_partener | `exclus` (diurna vine din Diurne) | `625_fara_partener` |
| 302, 303 | oricare | `stoc_consumat` (tratat ca cost de proiect) — **de confirmat** | — |
| 213 | oricare | `investitie` | — |
| 205 | oricare | `investitie` | — |
| 167 | oricare | `finantare` (rate leasing — **nu** cost) | — |
| 471 | oricare | `avans` | — |
| 7 | oricare | `exclus` (pe regim ERP venitul nu vine de aici) | `venit_regim_erp` |
| *(oricare alt prefix)* | — | `de_clarificat` | `cont_de_clarificat` |

### 4.6 Versiuni de configurare și confirmarea D1 (N10 / Copilot N1)
- `map_hash` = sha256 al serializării canonice (sortate) a întregului `contab_contract_map`; `clasif_hash` = idem pentru `contab_cont_clasificare`; `reguli_versiune` = constanta regulilor din §6.2 (ex. `r1`). Se calculează **în SQL** și se îngheață pe import la sigilare. Nu există contor pe rând.
- `contab_clasif_confirmari (clasif_hash PK, confirmat_de, confirmat_la, nota)` — confirmarea contabilității se face **pe hash**. Orice modificare a matricei produce alt hash, deci cere o nouă confirmare. Doar Marilena (sau owner), prin RPC.
- **Activarea unui `final` cere ca `clasif_hash`-ul înghețat al candidatului să fie confirmat.** Intermediarele se pot activa cu matrice neconfirmată, cu badge „clasificare provizorie”.
- Un candidat sigilat cu o matrice neconfirmată, care apoi e confirmată fără modificări, are același hash → devine activabil fără tentativă nouă.

### 4.7 `contab_expert_derogari` (nou — I5, N04 / Copilot N4)
`id, import_id, familie_regula, tratament, clasa_noua, motiv, actor, la, nr_linii, suma`.
- `tratament` ∈ `exclude_din_cost` (categoria liniilor familiei → `exclus`) | `trateaza_cost` (categoria → după destinație, ca un cost) | `reclasifica` (cu `clasa_noua` dintr-o listă permisă: `cost`, `stoc_consumat`, `investitie`, `finantare`, `avans`, `exclus`).
- Familii derogabile: `venit_regim_erp`, `cont_64`, `625_fara_partener`, `investitii_cont`, `213_alt_contract`, `cont_de_clarificat`. **Nederogabile:** structură, rând necunoscut, contract nemapat, perioadă incompletă la final, intermediar peste final.
- Se adaugă doar prin RPC `contab_expert_derogare(import_id, familie, tratament, clasa_noua, motiv)`: owner verificat în BD, candidat `propus`, același advisory lock lunar ca activarea, o derogare activă per familie. `nr_linii`/`suma` sunt calculate de server (nu primite din payload). Derogarea modifică `validation_hash` (§7.2) → omul vede noul rezumat înainte să activeze.
- Liniile nu se modifică: categoria efectivă = `categorie_bruta` + derogarea familiei ei (funcția §6.1, deterministă).

### 4.8 `contab_gestiune_activ` (nou, opțional în faza 1 — recomandat)
Alias controlat `gestiune_norm → logistica_active.id`. Regex nr. auto / „EXCAVATOR|MOTOCOMPRESOR|…” doar **propune** aliasuri. Regula: gestiune = activ de flotă cunoscut **și** contract ≠ PARC AUTO → avertisment cu sumă (nu blocant: combustibilul unui utilaj pe șantier se poate aloca legitim lucrării).

### 4.9 `contab_expert_audit` (nou)
Append-only: `import_id, actiune (creeaza/adauga_linii/sigileaza/invalideaza/tentativa_noua/derogare/activeaza/respinge/mapare/clasificare/confirmare_clasif), actor, la, detalii jsonb` (fără nume de persoane).

### 4.10 `contab_expert_obligatii` (nou — reminder, §10)
`(societate, luna, tip 'intermediar'|'final', scadenta date, satisfacuta_de import_id, satisfacuta_la)`, `UNIQUE (societate, luna, tip)`.

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
| 11 | L | `.Personal` | *(gol)* | persoană → tabelul §4.3 |

Normalizare permisă doar pentru: spații la capete, NBSP, spații multiple. **Fără fuzzy matching.** Antet diferit → `invalid` cu „format necunoscut — parser v1 nu se aplică” + semnătura găsită. O singură foaie vizibilă cu această schemă; zero sau mai multe → `invalid`. Foi/rânduri/coloane ascunse, formule în coloanele importate, fișier criptat/corupt → `invalid`.

### 5.2 Clasificarea fiecărui rând fizic
`antet` (primele 2) · `detaliu` (A = întreg pozitiv; text cu cifre acceptat prin conversie strictă) · `subtotal` (A începe cu `Total ` și B..G goale) · `total_general` (A normalizat fără spații = `TOTALGENERAL`) · `gol` (toate celulele goale — ignorat, numărat) · **orice alt rând nevid = `necunoscut` → `invalid`**. Toate rândurile fizice sunt numărate în manifest.

### 5.3 Conversii stricte
- Sume: int/float finite, sau text în format explicit (`1234.56` sau `1.234,56` românesc); ambiguu, `NaN`, `#VALUE!`, text liber → `invalid` cu rândul (nu zero implicit). Celulă goală ≠ 0 (pe detaliu: gol în ambele = avertisment).
- **Precizie (N08):** valoarea se trimite către RPC ca **text zecimal canonic**; `adauga_linii` o acceptă doar dacă respectă `^-?\d{1,12}(\.\d{1,4})?$` și abia apoi face cast la `numeric(18,4)`. Peste 4 zecimale sau peste 12 cifre întregi → `invalid` (nu rotunjire). Totalurile se țin în `numeric` fără limită de scară (sau `numeric(22,4)`), deci nu pot depăși.
- Date: `DD.MM.YYYY` cu validare calendaristică (31.02 → `invalid`); seriale Excel acceptate doar 1900-based, convertite fără fus.
- Text: fără trunchiere tăcută — peste limita câmpului → `invalid` cu rândul; `... ...` și gol la `.Personal` = lipsă.
- `nr_crt` repetat → `invalid`; goluri în secvență → avertisment.

### 5.4 Manifestul și controalele
- **Manifestul** (produs de edge, legat de `sha256_fisier` calculat de server, cerut complet de `sigileaza`; versiune necunoscută sau câmp lipsă → `invalid`): `parser_versiune`, `sha256_fisier`, nr. foi / foi vizibile, rânduri fizice pe clasă (antet/detaliu/subtotal/total_general/gol/necunoscut), formule = 0, ascunse = 0, total general găsit (valori text) sau absent, nr. linii trimise, suma venit/chelt calculată de parser (text).
- `sigileaza` verifică în SQL: nr. linii în BD = manifest; sumele recalculate din linii = cele din manifest (exact); total general prezent → egal exact cu suma detaliilor pe venit și pe chelt separat (sursa are max. 3 zecimale, deci egalitatea e exactă, fără toleranță) → altfel `invalid`; total general repetat/contradictoriu → `invalid`.
- Total general **lipsă** (aug/sep) → avertisment „fără sumă de control externă” — omul vede totalul și îl confirmă prin activare (intră în hash).
- Zero rânduri de detaliu → `invalid` (o lună fără activitate e în afara fazei 1 — asumat).
- **Limite (P18):** fișier ≤ 10 MB comprimat și ≤ 50 MB decomprimat (verificat pe intrările ZIP înainte de parsare), ≤ 3 foi, ≤ 20.000 rânduri, ≤ 50 coloane, ≤ 300.000 celule nevide, text ≤ 500 caractere/celulă, ≤ 30 s procesare. Depășire → `invalid`.

---

## 6. Categorii, reguli, blocante (anexă normativă — aceleași reguli în sigilare, activare și agregări)

### 6.1 Funcția unică `contab_expert_categorie(linie, derogare)` (N01 / Copilot N3)
Două axe, stocate separat pe linie: **destinația** (din contract, §4.4) și **clasa** (din cont, §4.5). Categoria de raportare se obține cu **precedență fixă** — clasa contabilă bate destinația, pentru că spune dacă suma e cost al perioadei:

| Pas | Condiție | Categorie |
|---|---|---|
| 0 | există derogare pe familia liniei | după `tratament` (§4.7), apoi se continuă de la pasul 1 cu clasa rezultată |
| 1 | contract nemapat | `nealocat` → blocant nederogabil (I3) |
| 2 | clasa `exclus` | `exclus` (subtip = familia: venit / salarii / diurnă / alt) |
| 3 | clasa `finantare` | `finantare` |
| 4 | clasa `avans` | `avans` |
| 5 | clasa `investitie` | `investitii` |
| 6 | clasa `de_clarificat` | `de_clarificat` (blocant pe final, vizibil separat pe intermediar) |
| 7 | clasa `cost` / `stoc_consumat` și destinație `proiect` | `proiect:<id>` |
| 8 | idem, destinație `parc_auto` / `centru_intern` / `exclus` | `parc_auto` / `centru_intern` / `exclus` |
| 9 | idem, destinație `investitii` (cont de cost pe contract INVESTITII) | `investitii` + familia `investitii_cont` |

Exemple: 167 pe contract de proiect → `finantare` (nu cost de proiect); 205 pe SEDIU → `investitii`; 64 pe proiect → `exclus`; cont necunoscut → `de_clarificat`; 302 pe ORSOVA → `proiect:<ORSOVA>`.
Venitul (col. H) pe regim ERP nu intră niciodată în marjă: liniile cu venit ≠ 0 sunt `exclus` (familia `venit_regim_erp`). (În fișiere nu există linii cu venit și cheltuială simultan ≠ 0 — verificat; dacă apar → `invalid`.)
**Identitatea de control:** Σ pe categorii = totalul fișierului, **exact**, separat pentru venit și pentru cheltuială.

### 6.2 Familii de reguli și efectul lor
| Familie / verificare | Intermediar | Final | Derogabil |
|---|---|---|---|
| Structură / tipuri / date / total contradictoriu / rând necunoscut / manifest | `invalid` | `invalid` | nu |
| Contract nemapat (`nealocat`) | **blocant** | **blocant** | nu |
| Niciun document în luna declarată | **blocant** | **blocant** | nu |
| `final` cu perioadă incompletă | — | imposibil (CHECK) | nu |
| Intermediar peste un final activ | **blocant** | — | nu |
| `cont_de_clarificat` | avertisment (categoria separată) | **blocant** | da |
| `venit_regim_erp` (venit ≠ 0) | avertisment | **blocant** | da |
| `cont_64` | avertisment | **blocant** | da |
| `625_fara_partener` | avertisment | **blocant** | da |
| `investitii_cont`: contract INVESTITII pe cont ≠ 213.x (regula convenită: INVESTITII = doar 213.x; 205 e investiție prin clasă, pe orice contract) | avertisment | **blocant** | da |
| `213_alt_contract`: 213.x pe alt contract decât INVESTITII | avertisment | **blocant** | da |
| Activ de flotă cunoscut pe contract ≠ PARC AUTO | avertisment cu sumă | avertisment cu sumă | — |
| Goluri `nr_crt`, storno, dubluri (multiset pe toate câmpurile), document în afara perioadei | avertisment | avertisment | — |
| Intermediar cu acoperire mai mică decât activul | confirmare explicită a regresiei (§7.3) | — | — |
| Diferențe față de activul lunii | afișate: total, nr. linii, adăugări/eliminări pe multiset, **mutări între categorii** (agregat când împerecherea e ambiguă) | idem | — |

Pe intermediar, regulile încălcate nu blochează, dar categoria lor e cea din §6.1 (ex. 625 fără partener intră la `exclus`, nu la cost) → nu se dublează nimic nici provizoriu.
`nr_blocante_brute` se calculează la sigilare; **blocantele rămase** = brute minus familiile acoperite de o derogare; se recalculează în `activeaza`.

---

## 7. RPC-uri

Toate: `SECURITY DEFINER SET search_path = public, pg_temp`, `REVOKE EXECUTE FROM PUBLIC`, `GRANT` doar `authenticated`, capabilitatea **citită din BD** pentru `auth.uid()` (niciodată din payload). Edge-ul le apelează cu JWT-ul utilizatorului.

### 7.1 Staging
- `contab_expert_creeaza(cerere_id, luna, varianta, perioada_pana, storage_path_server, sha256_fisier)` — `contab_propune`; refuză `legacy`; idempotent pe `cerere_id`; refuză fișierul deja încărcat (§3).
- `contab_expert_adauga_linii(import_id, batch jsonb)` — `contab_propune`, `propus_de = auth.uid()`, `FOR SHARE` pe părinte, `stare='procesare'`; valori ca text (§5.3); `ON CONFLICT (import_id, rand_fizic) DO NOTHING` doar dacă linia existentă e identică (altfel excepție).
- `contab_expert_sigileaza(import_id, manifest)` — `FOR UPDATE` pe părinte; verificările §5.4; calculează destinație, clasă, familie, `categorie_bruta` pe fiecare linie cu configurarea curentă; îngheață `map_hash`, `clasif_hash`, `reguli_versiune`; scrie `raport_validare`, `nr_blocante_brute`; → `propus` sau `invalid`.
- `contab_expert_tentativa_noua(import_id)` — `contab_propune`; sursa trebuie să fie `propus`; sub lock-ul lunar o trece în `depasit` și creează un import nou `procesare` cu `precedent_id`, același `storage_path`/`sha256_fisier`; edge-ul rerulează parserul.

### 7.2 `validation_hash` — contract canonic (Copilot N3 / N05)
Calculat **numai în SQL**, de funcția `contab_expert_validation_hash(import_id)`: sha256 peste serializarea canonică (JSON cu chei sortate, numere ca text zecimal canonic, linii sortate după `rand_fizic`) a:
`societate, luna, varianta, perioada_de, perioada_pana, regim_venit, parser_versiune, sha256_fisier, manifest, map_hash, clasif_hash, reguli_versiune` · lista `(rand_fizic, hash_linie, destinatie_tip, destinatie_proiect_id, clasa, familie_regula, categorie_bruta)` · totalurile pe categorii **după derogări** · `raport_validare` · derogările active `(familie, tratament, clasa_noua, motiv, actor)` · `id`-ul activului curent al lunii și `validation_hash`-ul lui.
Ecranul „Import propus” afișează hash-ul calculat de server; `activeaza` îl primește înapoi și îl recalculează. Orice diferență → „ce ai văzut nu mai e actual — reîncarcă ecranul”.

### 7.3 `contab_expert_activeaza(import_id, hash_vazut, activ_vazut_id, confirm_regresie_fata_de, motiv_revizie)` — ordinea exactă (N06)
1. Utilizator om, cu `contab_activeaza` (contul de automatizare e refuzat).
2. `pg_advisory_xact_lock(hashtext('contab_expert'), hashtext(societate||luna))` — serializează și prima activare a lunii.
3. **Reverifică dreptul după așteptarea lock-ului** (poate fi fost revocat între timp).
4. **Ramura idempotentă:** dacă importul e deja `activ` → întoarce „deja activ”, fără efecte.
5. `stare = 'propus'` (altfel refuz cu starea curentă).
6. `contab_expert_validation_hash(import_id) = hash_vazut`.
7. Blocante rămase = 0; dacă `final`: `clasif_hash` confirmat (§4.6), D6 confirmat (flag de configurare), perioada completă (CHECK).
8. Activul curent al lunii = `activ_vazut_id` (NULL dacă nu există); altfel refuz „activul s-a schimbat — revezi comparația”.
9. Ierarhie: intermediar peste final → refuz; final peste final → `motiv_revizie` obligatoriu; intermediar peste intermediar cu `perioada_pana` mai mică → `confirm_regresie_fata_de` trebuie să fie exact id-ul activului curent.
10. `revizie` = max(revizie pe `(societate, luna, varianta)`) + 1, alocată aici (sub lock → fără „final r2” dublu).
11. Vechiul activ → `inlocuit`; noul → `activ`; obligațiile §10 satisfăcute; audit. Orice eroare → rollback total.

`contab_expert_respinge(import_id, motiv)` și `contab_expert_derogare(...)`: **același lock lunar** și aceeași reverificare a dreptului după lock → nu se pot intercala cu o activare. Schimbările de mapare/clasificare nu au nevoie de lock: candidatul e snapshot (I4), iar hash-ul lui nu depinde de configurarea curentă.

---

## 8. Securitate (fișa CLAUDE.md pct. 7)

**Capabilități** (sub-chei noi în `user_module_access`; definite și testate cu identități de test în PR1, **acordate în producție DOAR cu acordul explicit al lui Răzvan**, exact cele cerute — D4):
| Capabilitate | Cine (propunere) |
|---|---|
| `financiar.contab_propune` (upload, tentativă nouă) | Mirela, Marilena |
| `financiar.contab_activeaza` (activare, respingere) | Marilena, owner |
| `financiar.contab_mapare` (contracte, matrice conturi, aliasuri flotă, confirmarea matricei) | Marilena, owner |
| derogări (§4.7) | **doar owner** |
| date personale (`contab_expert_linii_persoane`, fișier brut) | owner, `can_access_salarii` (+ `contab_activeaza` pentru fișierul brut) |
| citire Contabilitate | owner + `financiar` (azi: orice autentificat — **se restrânge**) |
| automatizare (faza 2) | doar `contab_propune` |

- (a) Conținut extern: XLSX-ul. Tratat ca date; textul din celule se afișează ca text simplu (fără HTML) și nu e interpretat.
- (b) Scrie: staging + linii (doar în `procesare`), storage. Activarea, respingerea, derogarea și maparea doar prin RPC cu om. Nu trimite mail, nu atinge drepturi.
- (c) Edge-ul folosește `service_role` **doar pentru upload în storage**; toate scrierile în BD trec prin RPC-uri apelate cu JWT-ul utilizatorului → poarta de rol e în SQL. `verify_jwt` rămâne activ și, în plus, handler-ul verifică capabilitatea înainte de upload.
- (d) Cine pornește: doar utilizator cu `contab_propune`; endpoint-ul vechi `contab-expert-import` și calea `x-ingest-secret` se **închid**.
- (e) Confirmare umană: activare, respingere, derogare (owner), mapare, clasificare, confirmarea matricei.
- **Storage:** bucket privat dedicat `contabilitate`, obiect creat de server (`<societate>/<luna>/<uuid>.xlsx`), fără overwrite, fără politică SELECT pentru `authenticated`; descărcare doar prin `contab_expert_fisier_url` (§4.3). Edge-ul nu acceptă `storage_path` de la client.
- **RLS:** `contab_expert_importuri/_linii` SELECT pentru owner + `financiar`, fără politici de scriere pentru `authenticated`; dicționarele RPC-only; politica ALL veche pe `contab_santier_map` eliminată (politicile permisive se combină prin OR).
- Rând în `public.automatizari` + secțiune în `registru_automatizari` (edge + cron reminder + job de curățenie).

---

## 9. Tab „Contabilitate” — ce afișează

Doar importul **activ** al lunii (istoricul tentativelor și reviziilor pe un sub-tab). Antet: varianta, revizia, perioada, cine a activat, derogările și avertismentele acceptate, starea matricei (confirmată / provizorie).

**Caseta de control lunar** (mereu vizibilă):
- Venit ERP total = alocat proiectelor + **fără proiect** — afișat ca „reconciliere incompletă” când „fără proiect” ≠ 0 (nu blochează importul Expert: e o anomalie a ERP) · data calculului (venitul ERP se poate schimba după activare).
- Cheltuieli Expert total = Σ categorii §6.1 (proiecte + parc auto + investiții + centru intern + finanțare + avans + exclus + de_clarificat) — egalitate **exactă** în `numeric`. Afișarea e la 2 zecimale; dacă suma valorilor rotunjite diferă de totalul rotunjit, se afișează explicit rândul „rotunjire afișare: x,xx” (N08).
- Storno (sumă negativă) separat.

**Venitul ERP (P03):** `facturi_emise.valoare_neta`, `status IN ('emisa','trimisa')`, facturi negative incluse cu semn, **`data` între `perioada_de` și `perioada_pana` ale importului activ** (pe intermediar: aceeași perioadă ca exportul; alături, informativ, venitul pe toată luna). RON (singura monedă în perimetrul fazei 1).

**Pe proiect (regim `erp`):** venit ERP (regula de mai sus, pe `proiect_id`) − Σ linii cu categoria `proiect:<id>` = **„Marjă din export”** (nu „rezultat”). Sub ea, explicit: „nu include: salarii (Salarii), diurne (Diurne), costul utilajelor proprii (pontaj utilaje), cheltuieli centrale, finanțare, investiții”. Dacă importul are derogări, lista se completează automat cu efectul lor (ex. „include 625 fără partener tratat ca cost — derogare owner”).

**Iulie (regim `expert_legacy`, N11):** se afișează **exact ca azi** (venit și cheltuieli din Expert, pe contract, fără reclasificare), cu badge „legacy — venit din contabilitate, include salarii și diurne; necomparabil cu lunile de după” și reconcilierea punctuală ERP 9.982.149,92 vs Expert 9.960.450,88 (Δ 21.699,04, de explicat pe documente). Formula de marjă nouă **nu** se aplică iuliei.

---

## 10. Reminder (pg_cron, Europe/Bucharest) — N13

- Obligațiile (§4.10) se generează pentru fiecare lună: `intermediar` scadent pe **20** ale lunii, `final` pentru luna precedentă scadent pe **15**.
- **Satisfacere durabilă:** o obligație se marchează `satisfacuta_de/_la` în momentul activării; un `final` activat satisface și obligația `intermediar` a aceleiași luni dacă era încă deschisă. Starea ulterioară a importului (ex. `inlocuit`) nu redeschide obligația.
- Cron-ul zilnic tratează **toate** obligațiile scadente și nesatisfăcute (nu doar „azi = termen”) → o rulare ratată se recuperează la următoarea. Mesajul arată starea reală: „lipsește” / „încărcat, dar invalid” / „propus, așteaptă activare (și blocantele)” / „respins — reîncărcați”.
- Notificare în platformă (`notifications`, fără mail automat) către Mirela + Marilena din ziua scadenței; la **+2 zile** → și către Răzvan. Cheie unică `(obligatie_id, destinatar, etapa)` → idempotent la rerulări. Monitorizare: rândul cron-ului în `automatizari` + ultima rulare.

---

## 11. Decizii (cine, când, ce blochează)

Implementarea pornește cu valorile propuse; asta **nu** înseamnă aprobarea schemei pentru APPLY, acordarea drepturilor sau validarea contabilă. Editările creează versiuni noi (hash nou), nu modifică liniile sigilate.

| Decizie | Cine | Blochează PR1 (cod)? | Momentul obligatoriu |
|---|---|---|---|
| **D1** — matricea conturilor (302/303 = cost de proiect? 167 / 471 în afara costului?) | Marilena | nu (seed **neconfirmat**, confirmare pe hash implementată) | înainte de primul `final`; RPC-ul o impune |
| **D2** — centrele interne (SEDIU, ACHIZITII) se afișează separat, fără repartizare pe proiecte | Răzvan | nu | o repartizare ulterioară = regulă nouă, versionată |
| **D3** — indicatorul „Marjă din export” cu lista explicită a ce nu conține | Răzvan | nu | înainte de acceptarea UI |
| **D4** — capabilitățile §8 și cui se dau | **Răzvan, explicit** | nu (identități de test) | înainte de acordarea în producție; activarea nu include automat accesul la date personale |
| **D5** — calea mail (faza 2) amânată; harvester determinist doar dacă upload-ul nu e adoptat în 1–2 luni | Răzvan | nu | contract și review separate |
| **D6** — exportul „holding” conține doar Gazpet Instal SRL, în RON | Marilena / Mirela | nu | înainte de prima activare nouă (flag în configurare) |
| **D7** — gestiunea (auto + șofer) rămâne vizibilă celor cu drept de citire (propunere) sau trece în tabelul personal | Răzvan | **da** (schimbă schema §4.3) | înainte de schema PR1 |
| **D8** — iulie: rămâne legacy (propunere) sau se reîncarcă ulterior prin fluxul nou, ca `final`, cu derogări owner pe venit/64/625 | Răzvan | nu (implicit: rămâne legacy) | oricând după livrare |

---

## 12. Migrare și cutover (N11–N12)

1. **Înainte**: etalon iulie — `count`, sume pe contract, `sum(venit)`, `sum(cheltuiala)`, nr. linii cu persoană, plus ieșirea actuală a tab-ului (sumar pe șantier) salvată ca fixture; inventarul cititorilor (`Financiar.jsx` → `ContabilitateWMTab`, orice view/RPC care citește `contab_expert_*` sau `contab_santier_map`).
2. **PR1a — aditiv și compatibil** (se poate aplica singur): tabele noi, coloane noi nullable, RPC-uri, trigger-e, seed mapare + clasificare, obligații. Tab-ul vechi continuă să funcționeze neschimbat.
3. **PR1b — restrictiv**, aplicat **doar în aceeași fereastră cu deploy-ul PR3** (cititorii compatibili): mută `persoana_nume` în `contab_expert_linii_persoane` (iulie: 357 linii), restrânge RLS, elimină politica ALL și `UNIQUE(luna)`, marchează iulie `legacy/activ/expert_legacy` **fără a recalcula destinații sau clase** (rămân NULL; afișarea legacy folosește coloanele vechi), oprește `contab-expert-import` v12 (stub 410). `$post$`: etalonul iulie identic (sume, numărători, inclusiv numele mutate 1:1).
4. **Rollback:** script în `supabase/revenire/` pentru fiecare migrare, armat înainte de APPLY; criteriu de oprire = etalon diferit sau tab-ul vechi/nou nu încarcă iulie. După ce o lună are 2 variante, `UNIQUE(luna)` nu mai poate fi reintrodus — rollback-ul PR1b e valabil doar până la primul backfill.
5. **Backfill**: aug final, apoi sep intermediar — **prin același flux uman** (upload de Marilena/Mirela sau de Răzvan → propus → activare), nu prin script. Aug intermediar nu se importă (înlocuit de final). Sep final: 15.10, prin fluxul normal.

---

## 13. Teste minime (criteriu de acceptare)

**Parser (unit, fixture-uri sintetice + cele 3 originale):** antet exact / B1 gol / „Inca”+„drare” / coloană mutată, lipsă, în plus / două foi candidate; clasificarea fiecărui rând (subtotaluri iulie cu celule îmbinate, `T O T A L   G E N E R A L`, gol la final, rând necunoscut, `nr_crt` text/fracționar/repetat, goluri); sume int/float/3 zecimale/**5 zecimale → invalid**/**13 cifre → invalid**/negative/text românesc/ambiguu/`#VALUE!`/gol; date 31.02, an bisect, serial Excel; document „F”, cont numeric 303 → text, `... ...`; total prezent corect / greșit / repetat / lipsă; formule, foi ascunse, fișier corupt, ZIP-bombă, peste limite. **Pe originale**: 1.684 / 1.199 / 517 rânduri, cele 20 goluri din aug, sumele exacte din §1.

**SQL real (Postgres 17, rol non-superuser, RLS reală — modelul `scripts/pg/test_*.mjs` + pas în CI):**
- **staging**: eșec la batch 2 → nimic activabil; retry cu același `cerere_id` și același batch → fără dubluri; batch modificat pe același `rand_fizic` → excepție; **INSERT după sigilare → refuz (inclusiv ca `service_role`)**; **batch concurent cu sigilarea (două sesiuni, așteptare observată în `pg_locks`) → batch-ul refuzat după commit-ul sigilării**; UPDATE pe metadatele unui import sigilat → refuz; manifest incomplet / versiune necunoscută → `invalid`.
- **categorii (§6.1)**: 167/proiect → `finantare`; 205/SEDIU → `investitii`; 64/proiect → `exclus`; cont necunoscut → `de_clarificat`; nemapat cu sold negativ și cu sold zero (+100/−100) → blocant; Σ categorii = total exact; 0,004 + 0,004 vs total → rândul de rotunjire la afișare.
- **reguli și derogări**: aceeași familie pe intermediar vs final, cu/fără derogare, verificând **categoria și suma rezultată**, nu doar avertismentul; derogare de non-owner → refuz; derogare pe familie nederogabilă → refuz; derogare din payload cu `nr_linii` fals → ignorat (recalculat); derogare pe alt candidat; derogare adăugată după ce omul a văzut hash-ul → activare refuzată.
- **activare**: propus valid / invalid / respins / depășit / înlocuit; intermediar peste final → refuz; final cu perioadă parțială → imposibil; final cu matrice neconfirmată → refuz, apoi confirmare pe același hash → OK; final r2 cu motiv și revizie alocată corect; idempotență pe activ (pasul 4 înaintea pasului 5); regresie de intermediar fără / cu `confirm_regresie_fata_de` corect; eroare injectată după dezactivarea vechiului → rollback, vechiul rămâne activ.
- **concurență (două sesiuni)**: două activări pe aceeași lună (cu și fără activ anterior) — a doua așteaptă lock-ul și e refuzată „activul s-a schimbat”; luni diferite nu se blochează; respinge vs activează; derogare vs activare; **drept revocat cât activarea așteaptă lock-ul → refuz**; remapare în timpul review-ului → candidatul neschimbat, hash neschimbat; tentativă nouă → candidat nou cu maparea nouă, cel vechi `depasit` și neatins.
- **roluri**: anon, autentificat fără financiar, `contab_propune`, `contab_activeaza`, `contab_mapare`, owner, cont de automatizare (doar propune), RPC apelat direct, DML direct pe mapări/stări/linii → refuz; `EXECUTE` revocat de la PUBLIC; politica ALL veche eliminată.
- **confidențialitate**: utilizator fără drept salarial vede toate rândurile și totalul complet, nu poate citi `contab_expert_linii_persoane` (SELECT direct → 0 rânduri), nu obține URL pentru fișierul brut; activator fără `can_access_salarii` → nu obține fișierul brut; raport/diff/audit fără nume.
- **venit și marjă (N14)**: venit ERP fără proiect și facturi negative păstrate în casetă; marja intermediarului folosește aceeași perioadă; iulie legacy afișată identic cu etalonul; mutare între categorii cu total neschimbat apare în diff.
- **reminder**: intermediar activat apoi înlocuit de final → obligația rămâne satisfăcută; cron ratat în ziua scadenței → recuperat a doua zi; rerulare → fără notificări duble.
- **edge**: fără JWT / JWT fără `contab_propune` → 401/403 înainte de upload; `storage_path` din client ignorat; endpoint vechi → 410.
- **migrare**: etalonul iulie identic înainte/după PR1a și PR1b; tab-ul vechi funcționează după PR1a.

---

## 14. Ordinea de implementare (PR-uri mici; merge ≠ APPLY)

1. **PR1 — Migrări (1a aditivă, 1b restrictivă) + RPC-uri + teste SQL** (fără UI). Review Jakarinos + Copilot GO MERGE / GO APPLY (SHA). APPLY 1a cu OK-ul lui Răzvan pe schemă; **1b doar împreună cu PR3**.
2. **PR2 — Edge `contab-expert-propune` + parser v1 + teste unit** pe cele 3 originale.
3. **PR3 — UI**: upload, ecran „Import propus” (categorii/blocante/avertismente/diff/derogări/hash), activare, mapare contracte, matricea conturilor + confirmare, caseta de control, tab refăcut (inclusiv afișarea legacy). Deploy coordonat cu APPLY 1b.
4. **PR4 — Reminder cron** + rând `automatizari` + `registru_automatizari`.
5. **Backfill** aug final + sep intermediar prin UI, cu Marilena. Sep final: 15.10 prin fluxul normal.

---

## Anexa A — Jurnal review
| Rundă | Reviewer | Verdict | Esențial |
|---|---|---|---|
| r1 (06.10, v1) | Copilot | GO cu condiții | 8 P0: staging atomic, activare serializată + revalidare, destinație obligatorie, mapare înghețată, reguli de dublare blocante pe final, sume decimale, venit fără proiect în control, RLS care nu ascunde valoarea |
| r1 (06.10, v1) | Jakarinos | de refăcut | 22 probleme (11 blocante): definiția rezultatului, clasificarea conturilor, statusuri venit ERP, staging, concurență, capabilități, RLS persoană, mapare, antet 12 coloane, clasificare rânduri, conversii stricte, migrare/cutover; corecție cifre SANTIER sep |
| r2 (06.10, v2) | Copilot | NO-GO punctual („foarte aproape”) | P0.2/P0.6/P0.7 închise; 5 corecții: lock comun insert/sigilare + UNIQUE(import_id, rand_fizic); destinație ⟂ clasificare cu precedență; snapshot imuabil vs versiuni (varianta A) + versiuni globale; `validation_hash` canonic + derogări tipizate; PII fără view `security_invoker`; final = lună întreagă; P1: revizie alocată server-side, `invalid` terminal |
| r2 (06.10, v2) | Jakarinos | de refăcut punctual | P10/P11/P13/P17/P20/P22 închise; N01–N15: funcție unică de categorie, tentative noi pentru revalidare, reguli unice (INVESTITII 213, 625 condițional), derogări cu dovadă în hash, sigiliu complet + manifest, ordinea idempotenței + lock comun la respingere, PII + fișier brut + gestiune, precizie fără rotunjire tăcută, final parțial, confirmarea D1 pe versiune, iulie conservată, PR1 aditiv vs restrictiv, obligații durabile la reminder, teste financiare, perimetru o singură societate |
| r3 (v3) | — | în curs | |
