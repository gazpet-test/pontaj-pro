# Import WinMentor Expert (analiza descriptivă) — specificație v5.1 (FINALĂ pentru implementare)

**Stare: design închis — Copilot r5 „GO cu condiții”, Jakarinos r5 „gata cu condiții”.** Condiții înainte de GO MERGE PR1: **D7 și D9 decise de Răzvan** (D9 cu Marilena). v5.1 = v5 + precizările textuale cerute în r5 (ordinea creare → parser, tratamentul implicit al familiilor fixe bate matricea, chei reale în `context_aprobare`, precondiția anti-drift a 1b, precizări editoriale). Următorul gate e direct pe PR1a/1b + RPC-uri + harness SQL, fără altă rundă de design.

Istoric: v5 după review Jakarinos r4 (cele 4 P0 Copilot r3 închise; V01–V06 închise în v5: rol proprietar dedicat fără DML pentru apelanți, `hash_linie` injectiv, contextul aprobării înghețat, excepția de migrare legacy, pragul real de revenire, invalidare tehnică separată de dreptul uman). v4 după review Paw r3 (Copilot: NO-GO punctual, 4 P0 · Jakarinos: de refăcut punctual, R01–R13). v4 închide: sursă ≠ snapshot (tabele separate, fără UPDATE), frontieră de încredere parser ↔ om (staging doar server-side), `snapshot_hash` + `review_hash` fără recursie, configurare versionată imuabilă citită o singură dată, abateri ca set + matrice familie × tratament, revizie din fișierul activ, invalidare durabilă, protecție pe toate tabelele snapshotului, CHECK-uri sigure la NULL și matricea etapelor 1a/1b. Istoric: v3 a închis staging serializat, destinație ⟂ clasificare, tentative noi, date personale separate, final = lună întreagă, iulie legacy. Pregătită în sesiunea de chat la cererea lui Răzvan („dacă tot creăm o automatizare nouă, s-o facem cum trebuie din prima”). **Implementarea: sesiunea „Module ERP — programare” (modulul Financiar).** Migrările doar prin `scripts/livrare_migrare.sh`, cu OK-ul lui Răzvan pe schemă.

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

1. **I1 — Trei straturi, fiecare cu imutabilitatea lui.** (a) **Sursa** (`contab_expert_linii_sursa`): rândurile citite de parser, doar INSERT, doar în `procesare`, doar pe calea server. (b) **Snapshotul** (`contab_expert_linii` + `_persoane` + `_abateri`): construit **atomic, o singură dată**, de sigilare, din sursă + o versiune de configurare; după aceea nimic nu se mai inserează, modifică sau șterge. (c) **Dovada aprobării** (`review_hash_activat`, activul comparat, actorul, momentul): scrisă o singură dată, la activare. Metadatele importului se schimbă doar prin câmpurile de tranziție din §4.1. Garanțiile sunt trigger-e în BD → țin și pe calea `service_role`.
2. **I2 — Activarea e serializată pe `(societate, luna)` și revalidează server-side.** RPC-ul recalculează `review_hash` și îl compară cu cel văzut de om; nu crede nimic din payload.
3. **I3 — Fiecare linie cu valoare ajunge în exact o categorie de raportare** (§6.1). Criteriul = **numărul** de linii cu valoare fără categorie = 0, nu soldul. Contract nemapat = blocant, nederogabil.
4. **I4 — Istoria nu se rescrie.** Snapshotul îngheață o **versiune de configurare imuabilă** (§4.6), citită o singură dată la sigilare. Configurarea nouă se aplică doar prin **tentativă nouă** din același fișier (§3) — inclusiv peste un import activ (revizie), care rămâne activ până la commit-ul succesorului.
5. **I5 — Regulile convenite sunt predicate fixe ale versiunii de reguli, independente de matricea editabilă.** O linie poate încălca mai multe reguli simultan (set). Pe final, fiecare pereche (linie, regulă) neacoperită de o derogare blochează. O derogare e owner-only, tipizată, și spune exact efectul financiar (§6.3). Structura, contractul nemapat, perioada incompletă, perimetrul neconfirmat nu se derogă.
6. **I6 — Sume exacte.** `numeric`; storno cu semn; peste 4 zecimale / 12 cifre întregi → refuz **înainte** de cast; totaluri calculate în BD; egalități exacte; rotunjire doar la afișare.
7. **I7 — Capabilități separate, date personale izolate, parser de încredere.** A propune ≠ a activa ≠ a mapa/clasifica ≠ a deroga (owner) ≠ a vedea date personale. Liniile ajung în BD **doar prin parserul server-side**: niciun utilizator, oricare ar fi drepturile lui, nu poate scrie direct sursă, manifest sau hash.

---

## 3. Fluxul și automatul de stări

```
Upload XLSX + (luna, varianta, perioada_pana, cerere_id)      [om cu „contab_propune”]
   │ edge `contab-expert-propune`:
   │   1. validează JWT-ul și citește capabilitatea din BD pentru auth.uid()
   │   2. urcă fișierul în bucket-ul privat, calculează sha256 pe octeții primiți
   │   3. intern_creeaza  (EXECUTE doar service_role) → import 'procesare'
   │   4. ABIA APOI parsează (parser v1) → intern_adauga_sursa (batch-uri) → intern_sigileaza
   │   orice eroare DUPĂ pasul 3 (ZIP corupt, ZIP-bombă, antet, conversie, batch)
   │        → intern_invalideaza (tranzacție separată) → 'invalid' durabil
   │   (o eroare la pașii 1–2 nu creează import: răspuns 4xx, nimic în BD)
   ▼
'procesare' ──► 'propus' (snapshot construit)   sau   'invalid' (terminal, raport salvat)
   │ ecran „Import propus”: categorii, abateri, blocante, avertismente, diff vs activ, review_hash
   │ [owner] contab_expert_derogare(...)  → review_hash nou, afișat din nou omului
   ▼
contab_expert_activeaza(id, review_hash_vazut, activ_vazut_id, confirm_regresie_fata_de, motiv_revizie)
   ▼
'activ' (vechiul activ → 'inlocuit')      sau     contab_expert_respinge(id, motiv) → 'respins'

Tentativă nouă din același fișier (configurare schimbată / revizie a activului):
edge `contab-expert-reia` (contab_propune) → intern_tentativa(sursa_id, cerere_id) → import nou
'procesare' cu precedent_id, același obiect din storage, parser rerulat;
sursa 'propus' → 'depasit' ; sursa 'activ' → rămâne 'activ' până la activarea succesorului
```

| Din | În | Prin | Observație |
|---|---|---|---|
| — | `procesare` | `intern_creeaza` / `intern_tentativa` | `cerere_id` UNIQUE, legat de payload + actor: același `cerere_id` cu același payload → același import; cu alt payload/actor → conflict |
| `procesare` | `propus` | `intern_sigileaza` | §7.1; blocantele de reguli nu împiedică sigilarea, împiedică activarea |
| `procesare` | `invalid` | `intern_sigileaza` (verificări eșuate) / `intern_invalideaza` / job timeout | **terminal**; starea și raportul se **salvează și se comit** (fără RAISE care să anuleze scrierea) |
| `propus` | `activ` | `activeaza` | §7.3 |
| `propus` | `respins` | `respinge` | terminal |
| `propus` | `depasit` | `intern_tentativa` | terminal; înlocuit de tentativa care îl citează |
| `activ` | `inlocuit` | `activeaza` (al succesorului) | terminal; un `inlocuit` nu se reactivează |

**Unicitatea artefactului (R07):** cel mult un import ne-terminal (`procesare`/`propus`) per `(societate, luna, varianta, sha256_fisier)` — index unic parțial, deci două upload-uri simultane ale aceluiași fișier nu pot trece amândouă. Un upload nou al unui fișier identic cu cel **activ** e refuzat cu „folosește «Revizie din fișierul activ»” (= `contab-expert-reia` pe activ). `intern_tentativa` e idempotentă pe `cerere_id`: un răspuns pierdut se recuperează repetând cererea.
**Timeout:** `procesare` mai vechi de 1 h → `intern_invalideaza('timeout')`, cu `FOR UPDATE SKIP LOCKED` (nu concurează cu o sigilare în curs).

---

## 4. Model de date (migrări noi, prin runner — etapele 1a/1b în §12)

### 4.1 `contab_expert_importuri` (extinsă)
- existente: `id, luna, fisier_nume, storage_path, gmail_message_id, nr_linii, total_venit, total_cheltuiala, importat_la, importat_de`
- noi: `societate` (CHECK `='GAZPET'`), `moneda` (CHECK `='RON'`), `varianta` ('intermediar'|'final'|'legacy'), `perioada_de`, `perioada_pana`, `stare` ('procesare'|'invalid'|'propus'|'activ'|'respins'|'depasit'|'inlocuit'), `sursa` ('upload'|'legacy'), `cerere_id uuid UNIQUE`, `cerere_payload_hash`, `precedent_id` (FK), `sha256_fisier` (calculat de edge pe octeții primiți), `parser_versiune`, `reguli_versiune`, `config_versiune_id` (FK §4.6), `manifest jsonb`, `raport_validare jsonb`, `snapshot_hash`, `sigilat_la`, `propus_de` (actorul uman inițiator), `regim_venit` ('erp'|'expert_legacy'). `societate` și `moneda` sunt `NOT NULL` cu default (iulie primește GAZPET/RON la backfill) — altfel unicitatea „un singur activ” n-ar ține (NULL e distinct în UNIQUE).
- **câmpuri de tranziție** (singurele modificabile după `procesare`, fiecare doar de operația sa): `stare`, `revizie` + `motiv_revizie` (activare), `activat_de/_la`, `review_hash_activat`, `activ_comparat_id`, `activ_comparat_snapshot_hash`, `context_aprobare jsonb` (activare, §7.2), `respins_de/_la/_motiv` (respingere), `invalid_motiv`, `invalidat_de_tehnic` (invalidare, §7.1).
- **CHECK-uri sigure la NULL (R11)** — un CHECK cu NULL trece, deci fiecare condiție e scrisă explicit:
  - după 1b, `NOT NULL` pe coloane: `societate, moneda, sursa, stare, varianta, regim_venit`;
  - `sursa <> 'upload' OR (perioada_de IS NOT NULL AND perioada_pana IS NOT NULL AND cerere_id IS NOT NULL AND sha256_fisier IS NOT NULL AND parser_versiune IS NOT NULL AND reguli_versiune IS NOT NULL AND propus_de IS NOT NULL)`;
  - `luna = date_trunc('month', luna)`; `perioada_de IS NULL OR perioada_de = luna`; `perioada_pana IS NULL OR perioada_pana BETWEEN luna AND (luna + interval '1 month - 1 day')`;
  - `varianta <> 'final' OR perioada_pana = (luna + interval '1 month - 1 day')` (cu `perioada_pana NOT NULL` impus de condiția upload);
  - `(varianta = 'legacy') = (sursa = 'legacy') AND (sursa = 'legacy') = (regim_venit = 'expert_legacy')`;
  - `stare NOT IN ('propus','activ','inlocuit') OR sursa = 'legacy' OR (snapshot_hash IS NOT NULL AND config_versiune_id IS NOT NULL)`; `stare NOT IN ('activ','inlocuit') OR sursa = 'legacy' OR (review_hash_activat IS NOT NULL AND context_aprobare IS NOT NULL)`.
- Unicitate: `UNIQUE (societate, luna) WHERE stare='activ'`; `UNIQUE (societate, luna, varianta, revizie) WHERE revizie IS NOT NULL`; `UNIQUE (societate, luna, varianta, sha256_fisier) WHERE stare IN ('procesare','propus')`. Se renunță la `UNIQUE(luna)` (în 1b).
- Trigger `contab_expert_importuri_imuabil`: DELETE refuzat mereu; după `procesare`, UPDATE în afara câmpurilor de tranziție → excepție; tranzițiile de stare doar conform tabelului §3; scrierile de tranziție permise doar când operația respectivă și-a setat marcajul de sesiune (§4.9).

### 4.2 `contab_expert_linii_sursa` (nou — stratul sursă, R01)
`id, import_id, rand_fizic, nr_crt, document_nr, document_data, partener, articol, gestiune, contract_brut, venit_text, chelt_text, venit, cheltuiala, tronson, cont, persoana_nume, hash_linie` · **`UNIQUE (import_id, rand_fizic)`**.
- INSERT doar prin `intern_adauga_sursa` (service_role), cu `FOR SHARE` pe părinte și `stare='procesare'`; retry pe același `rand_fizic` → no-op doar dacă **toate** câmpurile (inclusiv `persoana_nume`) sunt identice, altfel conflict (P1.1 Copilot).
- UPDATE/DELETE refuzate mereu. **Fără politici RLS de SELECT** pentru `authenticated` (conține nume) — o citesc doar funcțiile SECURITY DEFINER.
- `hash_linie` = sha256 peste textul `jsonb_build_array(rand_fizic, nr_crt, document_nr, document_data::text, partener, articol, gestiune, contract_brut, venit_canonic, chelt_canonic, tronson, cont, persoana_nume)::text` — vector JSON cu **`null` explicit** (deci NULL ≠ textul literal `\N`, separatorii din text sunt escapați de JSON → codificare injectivă, V02); text exact cum l-a normalizat parserul (§5.1), sume ca șiruri cu exact 4 zecimale (`"-12.3400"`). Calculat **în SQL** la inserare (nu primit).

### 4.3 `contab_expert_linii` (extinsă — stratul snapshot)
- noi: `sursa_id` (FK → sursa, NULL doar la legacy), `rand_fizic`, `contract_norm`, `destinatie_tip`, `destinatie_proiect_id`, `clasa`, `categorie_bruta`, `hash_linie`. **`persoana_nume` iese** (→ §4.4).
- Rândurile se creează **numai** de `intern_sigileaza`, printr-un singur `INSERT … SELECT` din sursă + versiunea de configurare (§4.6) + funcția de reguli (§6) — nu există pas de UPDATE. După aceea: INSERT/UPDATE/DELETE refuzate (trigger cu verificarea stării părintelui sub `FOR SHARE` + marcajul operației, §4.9).
- Liniile iulie (legacy) rămân cum sunt, cu coloanele noi NULL.
- `contab_expert_linii_abateri (linie_id, familie)` PK compus — **setul** de reguli încălcate de fiecare linie (R05 / P0.4); creat de sigilare, imuabil.

### 4.4 `contab_expert_linii_persoane` (date personale izolate)
`linie_id` (PK, FK → linii) · `persoana_nume`. Creat de sigilare (din sursă) și, pentru iulie, de migrarea 1b (357 rânduri). **Aceleași trigger-e de imutabilitate** ca liniile (R10). RLS SELECT: owner sau `can_access_salarii`. Cititorii fac `LEFT JOIN` de la liniile financiare (niciodată `INNER JOIN`, care ar pierde sume).
- **Fișierul brut**: URL semnat doar prin RPC `contab_expert_fisier_url(id)` pentru owner sau (`contab_activeaza` **și** `can_access_salarii`). Bucket privat, fără politică SELECT pentru `authenticated`.
- **Gestiunea** (ex. „BC98BLK NEGRU JENICA” = auto + șofer): **D7 — decizie a lui Răzvan înainte de schema PR1** (§11). Varianta A (propusă): rămâne în liniile financiare, vizibilă celor cu drept de citire Contabilitate. Varianta B: trece în `_persoane` împreună cu toate copiile ei (aliasurile din §4.8, raport, diff, audit).
- Rapoartele, diff-urile, erorile și auditul conțin `rand_fizic`, nu nume.

### 4.5 Dicționarele editabile
- `contab_contract_map`: `contract_norm UNIQUE`, `tip` ('proiect'|'parc_auto'|'investitii'|'centru_intern'|'exclus'), `proiect_id` (⇔ `tip='proiect'`), `motiv`. Seed: cele 24 existente; **PARC AUTO → `parc_auto`** (nu proiectul 24); SEDIU, ACHIZITII → `centru_intern`; INVESTITII → `investitii`; restul le mapează Marilena din UI.
- `contab_cont_clasificare`: `(prefix, conditie ∈ oricare|cu_partener|fara_partener, clasa)`, `UNIQUE (prefix, conditie)`; cel mai lung prefix câștigă; la același prefix, condiția care se potrivește bate `oricare`; fără potrivire → `de_clarificat`. Seed (D1): 6 → `cost`; 64 → `exclus`; 625/cu_partener → `cost`; 625/fara_partener → `exclus`; 302, 303 → `stoc_consumat` (**de confirmat**); 213, 205 → `investitie`; 167 → `finantare`; 471 → `avans`; 7 → `exclus`.
- Matricea decide doar **clasa**; regulile convenite (§6.2) sunt predicate fixe **și au un tratament implicit care bate matricea** (§6.3): dacă cineva setează `64 → cost`, salariile rămân totuși `exclus` (și pe intermediar), iar abaterea `cont_64` apare oricum și cere derogare owner pe final.
- Scriere **doar prin RPC** (`contab_mapare`), care ia `pg_advisory_xact_lock(hashtext('contab_config'))`, aplică modificarea și creează o nouă versiune (§4.6) în aceeași tranzacție. Fără politici de scriere pentru `authenticated`; politica ALL veche pe `contab_santier_map` se elimină.

### 4.6 `contab_config_versiuni` (nou — snapshot de configurare, R04 / N10)
`id, map jsonb, clasif jsonb, aliasuri_flota jsonb, map_hash, clasif_hash, creat_de, creat_la, motiv` — **imuabilă** (trigger). Fiecare modificare de dicționar produce o versiune nouă, sub lock-ul `contab_config`. Hash-urile = sha256 al JSON-ului canonic (chei sortate, elemente sortate după cheie), calculate în SQL.
- `intern_sigileaza` citește **o singură dată** `id`-ul celei mai noi versiuni și rezolvă **toate** liniile din jsonb-ul acelei versiuni (nu din tabelele vii) → liniile, `map_hash` și `clasif_hash` provin din aceeași configurare, indiferent de editările concurente.
- `contab_clasif_confirmari (id bigint identity PK, clasif_hash UNIQUE, confirmat_de, confirmat_la, nota)` — D1 se confirmă **pe hash**, prin RPC (Marilena / owner). Activarea unui `final` cere ca `clasif_hash`-ul versiunii înghețate să fie confirmat. Intermediarele se pot activa cu matrice neconfirmată (badge „clasificare provizorie”).
- `contab_perimetru_confirmari (id bigint identity PK, societate, moneda, confirmat_de, confirmat_la, nota)`, `UNIQUE (societate, moneda)` — D6, prin RPC (Marilena / owner). **Orice** activare nouă (intermediar sau final) cere confirmarea perimetrului (R08).

### 4.7 `contab_expert_derogari` (nou — I5)
`id, import_id, familie, tratament, clasa_noua, motiv, actor, la, nr_perechi, suma_venit, suma_chelt` · **`UNIQUE (import_id, familie)`**.
- Se creează doar prin `contab_expert_derogare` (owner, candidat `propus`, lock lunar — §7.3). `nr_perechi` și sumele le calculează serverul.
- **Imuabile** (fără UPDATE/DELETE; trigger). Corectarea unei derogări greșite = tentativă nouă. După activare, nimic nu se mai poate adăuga (starea nu mai e `propus`).
- Tratamentul trebuie să fie permis pentru familie (§6.3); dacă, pe vreo linie, efectul ar intra în conflict cu o derogare existentă pe altă familie a aceleiași linii, RPC-ul **refuză** (nu alege una).

### 4.8 `contab_gestiune_activ` (opțional în faza 1 — recomandat)
Alias `gestiune_norm → logistica_active.id`, inclus în versiunea de configurare (§4.6), deci înghețat consecvent. Regex nr. auto / „EXCAVATOR|MOTOCOMPRESOR|…” doar **propune** aliasuri. Gestiune = activ de flotă cunoscut **și** contract ≠ PARC AUTO → avertisment cu sumă (nu blocant).

### 4.9 Protecție, marcaje de operație, audit
- **Privilegii — garanția principală (V01).** Tabelele protejate și toate funcțiile `contab_*` aparțin unui rol dedicat **`contab_owner`** (`NOLOGIN`, fără `BYPASSRLS`, fără membri: nimeni nu-l poate prelua prin `SET ROLE`). `anon`, `authenticated` și **`service_role`** nu au INSERT/UPDATE/DELETE/TRUNCATE pe niciun tabel protejat (`REVOKE ALL` + doar `SELECT` unde RLS permite) — singura cale de scriere sunt funcțiile `SECURITY DEFINER` deținute de `contab_owner`.
- **Marcaj de operație — control intern suplimentar:** fiecare funcție setează local tranzacției `contab.op = '<operatie>'`; trigger-ele verifică marcajul **și** starea părintelui (citită `FOR SHARE`). Marcajul nu e o capabilitate (o variabilă custom poate fi setată de oricine) — protecția reală e lipsa privilegiilor DML; marcajul prinde doar greșelile de implementare din interiorul funcțiilor.
- **În afara garanției, declarat explicit:** rolul de administrare DDL (`postgres`, folosit de runner la migrări) și orice superuser pot altera tabelele sau dezactiva trigger-ele. Mitigare: migrările trec doar prin runner, cu OK-ul lui Răzvan pe schemă și SHA verificat.
- Tabele protejate: `importuri`, `linii_sursa`, `linii`, `linii_abateri`, `linii_persoane`, `derogari`, `config_versiuni`, confirmările, `audit`. FK-urile spre snapshot: `ON DELETE RESTRICT`.
- `contab_expert_audit`: append-only, `import_id, actiune, actor, la, detalii jsonb` (fără nume de persoane).
- `contab_expert_obligatii` (reminder): `id bigint identity`, `(societate, luna, tip 'intermediar'|'final') UNIQUE`, `scadenta`, `satisfacuta_de`, `satisfacuta_la` (§10).

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
| 11 | L | `.Personal` | *(gol)* | persoană → sursă, apoi `_persoane` (§4.4) |

Normalizare permisă doar pentru: spații la capete, NBSP, spații multiple. **Fără fuzzy matching.** Antet diferit → `invalid` cu „format necunoscut — parser v1 nu se aplică” + semnătura găsită. O singură foaie vizibilă cu această schemă; zero sau mai multe → `invalid`. Foi/rânduri/coloane ascunse, formule în coloanele importate, fișier criptat/corupt → `invalid`.

### 5.2 Clasificarea fiecărui rând fizic
`antet` (primele 2) · `detaliu` (A = întreg pozitiv; text cu cifre acceptat prin conversie strictă) · `subtotal` (A începe cu `Total ` și B..G goale) · `total_general` (A normalizat fără spații = `TOTALGENERAL`) · `gol` (toate celulele goale — ignorat, numărat) · **orice alt rând nevid = `necunoscut` → `invalid`**. Toate rândurile fizice sunt numărate în manifest.

### 5.3 Conversii stricte
- Sume: int/float finite, sau text în format explicit (`1234.56` sau `1.234,56` românesc); ambiguu, `NaN`, `#VALUE!`, text liber → `invalid` cu rândul (nu zero implicit). Celulă goală ≠ 0 (pe detaliu: gol în ambele = avertisment).
- **Precizie (N08):** valoarea se trimite către RPC ca **text zecimal canonic**; `intern_adauga_sursa` o acceptă doar dacă respectă `^-?\d{1,12}(\.\d{1,4})?$` și abia apoi face cast la `numeric(18,4)`. Peste 4 zecimale sau peste 12 cifre întregi → `invalid` (nu rotunjire). Totalurile se țin în `numeric` fără limită de scară (sau `numeric(22,4)`), deci nu pot depăși.
- Date: `DD.MM.YYYY` cu validare calendaristică (31.02 → `invalid`); seriale Excel acceptate doar 1900-based, convertite fără fus.
- Text: fără trunchiere tăcută — peste limita câmpului → `invalid` cu rândul; `... ...` și gol la `.Personal` = lipsă.
- `nr_crt` repetat → `invalid`; goluri în secvență → avertisment.

### 5.4 Manifestul și controalele
- **Manifestul** (produs de edge, legat de `sha256_fisier` calculat de server, cerut complet de `intern_sigileaza`; versiune necunoscută sau câmp lipsă → `invalid`): `parser_versiune`, `sha256_fisier`, nr. foi / foi vizibile, rânduri fizice pe clasă (antet/detaliu/subtotal/total_general/gol/necunoscut), formule = 0, ascunse = 0, total general găsit (valori text) sau absent, nr. linii trimise, suma venit/chelt calculată de parser (text).
- `intern_sigileaza` verifică în SQL: nr. linii în BD = manifest; sumele recalculate din linii = cele din manifest (exact); total general prezent → egal exact cu suma detaliilor pe venit și pe chelt separat (sursa are max. 3 zecimale, deci egalitatea e exactă, fără toleranță) → altfel `invalid`; total general repetat/contradictoriu → `invalid`. Manifestul e produs de parserul server-side și ajunge în BD doar pe canalul intern (§7.1) — un utilizator nu-l poate furniza.
- Total general **lipsă** (aug/sep) → avertisment „fără sumă de control externă” — omul vede totalul și îl confirmă prin activare (intră în hash).
- Zero rânduri de detaliu → `invalid` (o lună fără activitate e în afara fazei 1 — asumat).
- **Limite (P18):** fișier ≤ 10 MB comprimat și ≤ 50 MB decomprimat (verificat pe intrările ZIP înainte de parsare), ≤ 3 foi, ≤ 20.000 rânduri, ≤ 50 coloane, ≤ 300.000 celule nevide, text ≤ 500 caractere/celulă, ≤ 30 s procesare. Depășire → `invalid`.

---

## 6. Categorii, reguli, derogări (anexă normativă — implementată o singură dată, în SQL, ca funcții versionate `…_r1`; aceleași funcții în sigilare, activare și agregări)

`reguli_versiune` selectează **funcțiile** folosite (ex. `contab_expert_categorie_r1`, `contab_expert_abateri_r1`). O schimbare de reguli = funcții `_r2` noi; cele vechi rămân, deci un snapshot vechi se poate recalcula identic.

### 6.1 Categoria — funcția unică (N01)
Două axe stocate separat: **destinația** (din contract) și **clasa** (din cont, eventual modificată de derogare, §6.3). Clasa bate destinația:

| Pas | Condiție | Categorie |
|---|---|---|
| 1 | contract nemapat | `nealocat` → blocant nederogabil |
| 2 | linie cu venit ≠ 0 (col. H, regim ERP) | `exclus` (subtip venit) — **întotdeauna**; venitul nu intră niciodată în marjă și nu devine cost |
| 3 | clasa efectivă `exclus` | `exclus` (subtip după abatere: salarii / diurnă / alt) |
| 4 | clasa efectivă `finantare` | `finantare` |
| 5 | clasa efectivă `avans` | `avans` |
| 6 | clasa efectivă `investitie` | `investitii` |
| 7 | clasa efectivă `de_clarificat` | `de_clarificat` |
| 8 | clasa `cost` / `stoc_consumat`, destinație `proiect` | `proiect:<id>` |
| 9 | idem, destinație `parc_auto` / `centru_intern` / `exclus` | `parc_auto` / `centru_intern` / `exclus` |
| 10 | idem, destinație `investitii` | `investitii` (abaterea `investitii_cont` se calculează separat, §6.2) |

`categorie_bruta` = rezultatul fără derogări (înghețat pe linie). Categoria efectivă = aceeași funcție aplicată cu clasa efectivă (§6.3) — deterministă, calculată la afișare, în hash și la activare.
Linii cu venit **și** cheltuială ≠ 0 nu există în fișiere (verificat) → dacă apar, `invalid`.
**Identitatea de control:** Σ pe categorii = totalul fișierului, exact, separat pe venit și pe cheltuială.

### 6.2 Abaterile — predicate fixe ale `r1`, evaluate independent (R05)
Fiecare predicat se evaluează pe fiecare linie, independent de matricea editabilă; rezultatul e un **set** (`contab_expert_linii_abateri`).

| Familie | Predicat (r1) | Intermediar | Final |
|---|---|---|---|
| `venit_regim_erp` | venit ≠ 0 | avertisment | blocant |
| `cont_64` | cont începe cu `64` | avertisment | blocant |
| `625_fara_partener` | cont începe cu `625` și partener gol | avertisment | blocant |
| `investitii_cont` | destinație `investitii` și cont nu începe cu `213` (inclusiv 205 — regula convenită: pe contractul INVESTITII doar 213.x) | avertisment | blocant |
| `213_alt_contract` | cont începe cu `213` și destinație ≠ `investitii` | avertisment | blocant |
| `cont_de_clarificat` | clasa din matrice = `de_clarificat` | avertisment (categorie separată) | blocant |

Exemple de suprapunere: 641 pe INVESTITII → {`cont_64`, `investitii_cont`}; 625 fără partener pe INVESTITII → {`625_fara_partener`, `investitii_cont`}; cont necunoscut pe INVESTITII → {`cont_de_clarificat`, `investitii_cont`}.
**Blocante rămase** (activare finală) = numărul de **perechi (linie, familie)** cu familie fără derogare. Pe intermediar, perechile sunt doar avertismente, dar categoria e tot cea din §6.1 → nimic nu se dublează nici provizoriu (ex. 625 fără partener stă la `exclus`).

Alte verificări (nederogabile sau doar informative):
| Verificare | Intermediar | Final |
|---|---|---|
| Structură / tipuri / date / total contradictoriu / rând necunoscut / manifest | `invalid` | `invalid` |
| Contract nemapat | blocant, nederogabil | blocant, nederogabil |
| Niciun document în luna declarată | blocant | blocant |
| Perimetru (D6) neconfirmat | blocant | blocant |
| Matrice (D1) neconfirmată pe hash | badge „provizoriu” | blocant |
| Intermediar peste un final activ | blocant | — |
| Intermediar cu acoperire mai mică decât activul | confirmare explicită a regresiei | — |
| Activ de flotă cunoscut pe contract ≠ PARC AUTO; goluri `nr_crt`; storno; dubluri (multiset); document în afara perioadei | avertisment | avertisment |
| Diferențe față de activul lunii | afișate: total, nr. linii, adăugări/eliminări pe multiset, mutări între categorii | idem |

### 6.3 Matricea familie × tratament × efect (R06 / P0.4) — **D9, de validat de Răzvan + Marilena**

**Tratamentul implicit (fără derogare) — bate matricea editabilă**, pe intermediar și pe final (Copilot r5), ca nimic să nu intre în marjă doar pentru că matricea a fost editată:
| Familie | Clasa efectivă implicită |
|---|---|
| `venit_regim_erp` | `exclus` (întotdeauna) |
| `cont_64` | `exclus` |
| `625_fara_partener` | `exclus` |
| `213_alt_contract` | `investitie` |
| `investitii_cont` | `investitie` (propunere D9: rămâne în afara marjei, la investiții) |
| `cont_de_clarificat` | `de_clarificat` |
Ordinea de calcul a clasei efective: clasa din matrice → suprascrisă de tratamentul implicit al oricărei familii prezente → suprascrisă de derogarea owner (unde există). Dacă o linie are două familii cu tratamente implicite diferite (ex. 641 pe INVESTITII: `cont_64` → exclus, `investitii_cont` → investitie), câștigă **`exclus`** (cel mai conservator: nu intră nici în marjă, nici în investiții), iar pe final ambele perechi rămân blocante până la derogare.

O derogare schimbă doar **clasa efectivă** a liniilor familiei; coloanele venit/cheltuială nu se mută niciodată una în alta.

| Familie | Tratamente permise | Efect pe clasă → categorie |
|---|---|---|
| `venit_regim_erp` | `confirma_exclus` | niciunul (venitul rămâne `exclus`, §6.1 pas 2); doar acoperă blocantul |
| `cont_64` | `confirma_exclus` · `trateaza_cost` | `exclus` · `cost` → categoria după destinație |
| `625_fara_partener` | `confirma_exclus` · `trateaza_cost` | `exclus` · `cost` → după destinație |
| `investitii_cont` | `accepta_investitie` · `confirma_exclus` | `investitie` → `investitii` · `exclus` |
| `213_alt_contract` | `accepta_investitie` | `investitie` → `investitii` (destinația nu contează) |
| `cont_de_clarificat` | `reclasifica` (cu `clasa_noua` ∈ cost, stoc_consumat, investitie, finantare, avans, exclus) | `clasa_noua` → categoria corespunzătoare |

**Compunere pe aceeași linie:** dacă o linie are mai multe familii derogate, clasele lor efective trebuie să coincidă; dacă diferă (ex. `cont_64 / trateaza_cost` și `investitii_cont / confirma_exclus` pe aceeași linie), al doilea apel `contab_expert_derogare` e **refuzat** cu lista liniilor în conflict. Familiile fără efect pe clasă (`venit_regim_erp`) nu intră în conflict.
**Textul „nu include” din UI** (§9) se regenerează din efectele reale: dacă există `625_fara_partener / trateaza_cost`, „diurne” dispare din lista de excluderi și apare „include 625 fără partener tratat ca cost (derogare owner, X lei)”.

---

## 7. RPC-uri

**Interne de staging** (`intern_creeaza/adauga_sursa/sigileaza/tentativa`): deținute de `contab_owner`, `SECURITY DEFINER SET search_path = public, pg_temp`, `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE TO service_role` — le apelează doar edge-ul, după ce a verificat JWT-ul; primesc `actor uuid` (din JWT) și **reverifică în BD** că actorul are `contab_propune` și (după creare) că `actor = propus_de`.
**Tehnică** (`intern_invalideaza`): aceleași privilegii + `pg_cron`; **nu cere drept uman** (V06), poate face doar `procesare → invalid` și înregistrează identitatea tehnică (`edge:contab-expert-propune` / `cron:timeout`) + actorul, dacă există. Nu poate crea, propune, activa sau deroga nimic.
**Publice**: `SECURITY DEFINER`, `REVOKE … FROM PUBLIC`, `GRANT … TO authenticated`, capabilitatea citită din BD pentru `auth.uid()`.
**Erori de business** (validare, conflict, drept lipsă) se întorc ca rezultat `{ok:false, cod, mesaj}`; un `invalid` se scrie și se comite. Coduri stabile: `CONFLICT_STALE` (review_hash sau activul s-a schimbat), `DREPT_LIPSA`, `STARE_INVALIDA`, `BLOCANTE`, `PERIMETRU_NECONFIRMAT`, `MATRICE_NECONFIRMATA`, `REGRESIE_NECONFIRMATA`, `IERARHIE`, `DEROGARE_CONFLICT`, `FISIER_DUPLICAT`.

### 7.1 Staging (interne)
- `intern_creeaza(actor, cerere_id, luna, varianta, perioada_pana, storage_path, sha256_fisier, fisier_nume)` — actor cu `contab_propune`; refuză `legacy`; sub lock lunar: idempotent pe `cerere_id` (payload + actor identice → același id; altfel conflict), `FISIER_DUPLICAT` dacă același sha e activ sau ne-terminal pe `(luna, varianta)`.
- `intern_adauga_sursa(import_id, actor, batch jsonb)` — `actor = propus_de` și încă are `contab_propune` (drept revocat → refuz; edge-ul apelează apoi `intern_invalideaza`); `FOR SHARE` pe părinte, `stare='procesare'`; valori ca text (§5.3); `hash_linie` calculat în SQL; retry identic → no-op, diferit → conflict.
- `intern_sigileaza(import_id, actor, manifest)` — aceeași verificare a actorului; `FOR UPDATE` pe părinte; marcaj `contab.op='sigileaza'`; citește o singură dată versiunea curentă de configurare (§4.6); verifică manifestul și controalele (§5.4); construiește în aceeași tranzacție, prin `INSERT … SELECT`, liniile snapshot, abaterile și persoanele; calculează și îngheață `snapshot_hash`; → `propus`. La verificări eșuate: scrie `invalid` + raport și **comite** (fără RAISE).
- `intern_invalideaza(import_id, motiv, raport, identitate_tehnica, actor NULL)` — `FOR UPDATE` (job-ul de timeout: `SKIP LOCKED`); `procesare` → `invalid`; idempotent dacă deja `invalid`; refuz pe alte stări; fără verificare de drept uman (vezi mai sus).
- `intern_tentativa(actor, sursa_id, cerere_id)` — actor cu `contab_propune`; sub lock lunar; **întâi** idempotența pe `cerere_id` (cerere existentă cu același payload/actor → același id, chiar dacă sursa a devenit între timp `depasit`), **apoi** sursa ∈ {`propus`, `activ`}; creează import `procesare` cu `precedent_id`, aceleași `storage_path`/`sha256_fisier`/`varianta`/perioadă; sursa `propus` → `depasit`, sursa `activ` rămâne `activ`. Edge-ul rerulează apoi parserul.

### 7.2 Hash-uri — fără recursie (P0.1 / R02)
- **`snapshot_hash`** — calculat **o dată**, la sigilare, înghețat pe import: sha256 peste JSON-ul canonic (chei sortate, numere ca text cu 4 zecimale, NULL explicit) al: `societate, luna, varianta, perioada_de, perioada_pana, regim_venit, parser_versiune, reguli_versiune, sha256_fisier, manifest, config_versiune_id, map_hash, clasif_hash` + lista liniilor **sortată după `rand_fizic`**: `(rand_fizic, hash_linie, contract_norm, destinatie_tip, destinatie_proiect_id, clasa, categorie_bruta, familii sortate)` + `raport_validare`.
- **`context_aprobare`** — JSON canonic construit de `contab_expert_context(import_id)`: derogările sortate după familie `(id, familie, tratament, clasa_noua, motiv, actor)` + totalurile pe categorii **efective** + `activ_curent_id` + `activ_curent.snapshot_hash` + `activ_curent.review_hash_activat` (valori **stocate** → fără recursie) + D1: `clasif_hash` + `contab_clasif_confirmari.id` sau `null` (neconfirmat) + D6: `contab_perimetru_confirmari.id` sau `null`. Confirmările sunt rânduri imuabile (trigger), deci id-ul le identifică reproductibil. **`context_aprobare` persistat la activare este exact obiectul folosit la calculul hash-ului acceptat** (construit o dată, sub lock, apoi și hash-uit, și salvat) — nu un context recitit ulterior.
- **`review_hash`** = sha256(`snapshot_hash` ‖ `context_aprobare`::text canonic).
- Ecranul „Import propus” citește într-o singură interogare rezumatul și `review_hash`; `activeaza` îl recalculează. La activare se stochează `review_hash_activat`, `activ_comparat_id`, `activ_comparat_snapshot_hash` **și `context_aprobare` exact** (V03) → dovada istorică se reproduce din contextul înghețat (sha256(`snapshot_hash` ‖ `context_aprobare`) = `review_hash_activat`), nu din confirmările sau activul de azi; un intermediar activat cu matrice neconfirmată rămâne dovedit „neconfirmat” și după confirmarea ulterioară.

### 7.3 `contab_expert_activeaza(import_id, review_hash_vazut, activ_vazut_id, confirm_regresie_fata_de, motiv_revizie)` — ordinea exactă
1. Utilizator om, cu `contab_activeaza` (contul de automatizare e refuzat).
2. `pg_advisory_xact_lock(hashtext('contab_expert'), hashtext(societate||luna))`.
3. **Reverifică dreptul** după lock.
4. Dacă importul e deja `activ` → `{ok:true, deja_activ:true}` (idempotent).
5. `stare='propus'` (altfel `STARE_INVALIDA`).
6. Activul curent = `activ_vazut_id` **și** `contab_expert_review_hash(import_id) = review_hash_vazut` — oricare diferă → **același cod `CONFLICT_STALE`** („ce ai văzut nu mai e actual — reîncarcă”).
7. Perimetru D6 confirmat (`PERIMETRU_NECONFIRMAT`); dacă `final`: `clasif_hash` confirmat (`MATRICE_NECONFIRMATA`) și zero perechi blocante rămase (`BLOCANTE`); pe ambele variante: zero `nealocat`, zero blocante nederogabile.
8. Ierarhie: intermediar peste final → `IERARHIE`; final peste final → `motiv_revizie` obligatoriu; intermediar peste intermediar cu `perioada_pana` mai mică → `confirm_regresie_fata_de` = id-ul activului curent (`REGRESIE_NECONFIRMATA`).
9. `revizie` = max pe `(societate, luna, varianta)` + 1 (sub lock).
10. Vechiul activ → `inlocuit`; noul → `activ` + dovada (§7.2); obligațiile §10 satisfăcute prin upsert (create dacă lipsesc); audit. Orice excepție tehnică → rollback total.

`contab_expert_respinge(import_id, motiv)` și `contab_expert_derogare(import_id, familie, tratament, clasa_noua, motiv)`: **același lock lunar**, reverificarea dreptului după lock, `stare='propus'`. Editările de dicționare nu au nevoie de lock-ul lunar: candidatul e un snapshot al unei versiuni imuabile.

### 7.4 Publice auxiliare
`contab_mapare_seteaza`, `contab_clasif_seteaza` (versiune nouă, §4.6), `contab_clasif_confirma(clasif_hash, nota)`, `contab_perimetru_confirma(nota)`, `contab_expert_fisier_url(id)`, `contab_expert_rezumat(id)` (rezumat + `review_hash` într-o singură citire).

---

## 8. Securitate (fișa CLAUDE.md pct. 7)

**Capabilități** (sub-chei noi în `user_module_access`; definite și testate cu identități de test în PR1, **acordate în producție DOAR cu acordul explicit al lui Răzvan**, exact cele cerute — D4):
| Capabilitate | Cine (propunere) |
|---|---|
| `financiar.contab_propune` (upload, tentativă nouă, revizie din fișier) | Mirela, Marilena |
| `financiar.contab_activeaza` (activare, respingere) | Marilena, owner |
| `financiar.contab_mapare` (contracte, matrice, aliasuri flotă, confirmare matrice D1, confirmare perimetru D6) | Marilena, owner |
| derogări (§6.3) | **doar owner** |
| date personale (`_persoane`, fișier brut) | owner, `can_access_salarii` (+ `contab_activeaza` pentru fișierul brut) |
| citire Contabilitate | owner + `financiar` (azi: orice autentificat — **se restrânge**) |
| automatizare (faza 2) | doar `contab_propune` |

- (a) **Conținut extern:** XLSX-ul. Tratat ca date; textul din celule afișat ca text simplu (fără HTML), neinterpretat.
- (b) **Scrie:** storage + staging (sursă) + snapshot prin sigilare, doar în `procesare`. Activarea, respingerea, derogarea, maparea, confirmările — doar prin RPC-uri publice, de oameni. Nu trimite mail, nu atinge drepturi.
- (c) **Identitate — `service_role`, justificat:** edge-ul îl folosește pentru storage și pentru RPC-urile `intern_*`. Motivul (P0.2 / R03): liniile, manifestul și hash-ul fișierului trebuie să vină **doar** de la parserul server-side; dacă utilizatorul le-ar putea trimite direct (RPC cu JWT), ar putea fabrica un import coerent numeric. Riscul `service_role` (sare peste RLS) e limitat: **`service_role` nu are DML pe tabelele `contab_*`** (§4.9) — poate doar să apeleze `intern_*`, care reverifică dreptul actorului.
- (d) **Cine pornește:** utilizator cu `contab_propune` — verificat **în cod** (edge: JWT + capabilitate din BD, înainte de upload) și **din nou în SQL** în internele de staging (`intern_creeaza/adauga_sursa/sigileaza/tentativa`). `intern_invalideaza` e operație tehnică (§7): nu cere drept uman și poate doar `procesare → invalid`. `verify_jwt` nu e suficient (cheia anon e un JWT valid). Endpoint-ul vechi `contab-expert-import` și calea `x-ingest-secret` se închid.
- (e) **Confirmare umană:** activare, respingere, derogare (owner), mapare, clasificare, confirmările D1/D6.
- **Storage:** bucket privat `contabilitate`, obiect creat de edge (`<societate>/<luna>/<uuid>.xlsx`), fără overwrite, fără SELECT pentru `authenticated`; descărcare doar prin `contab_expert_fisier_url`.
- **RLS:** `importuri` și `linii` (snapshot) — SELECT pentru owner + `financiar`; `linii_sursa` — fără SELECT pentru `authenticated`; `_persoane` — owner / `can_access_salarii`; `derogari`, confirmări, `config_versiuni`, `audit`, `obligatii` — SELECT pentru owner + `financiar`; **nicio politică de scriere** pentru `authenticated` pe vreun tabel `contab_*` (toate scrierile prin RPC); politica ALL veche pe `contab_santier_map` eliminată.
- Rând în `public.automatizari` + secțiune în `registru_automatizari` (edge-uri `contab-expert-propune` / `contab-expert-reia`, cron reminder, job timeout).

---

## 9. Tab „Contabilitate” — ce afișează

Doar importul **activ** al lunii (istoricul tentativelor și reviziilor pe un sub-tab). Antet: varianta, revizia, perioada, cine a activat, derogările (cu efectul lor) și avertismentele acceptate, starea matricei (confirmată / provizorie).

**Caseta de control lunar** (mereu vizibilă):
- Venit ERP total = alocat proiectelor + **fără proiect** — afișat ca „reconciliere incompletă” când „fără proiect” ≠ 0 (nu blochează importul Expert) · data calculului (venitul ERP se poate schimba după activare).
- Cheltuieli Expert total = Σ categorii efective §6.1 — egalitate **exactă** în `numeric`. Afișare la 2 zecimale; dacă suma valorilor rotunjite diferă de totalul rotunjit, rândul explicit „rotunjire afișare: x,xx”.
- Storno (sumă negativă) separat.

**Venitul ERP:** `facturi_emise.valoare_neta`, `status IN ('emisa','trimisa')`, facturi negative incluse cu semn, **`data` între `perioada_de` și `perioada_pana` ale importului activ** (pe intermediar: aceeași perioadă ca exportul; alături, informativ, toată luna). RON.

**Pe proiect (regim `erp`):** venit ERP pe `proiect_id` − Σ linii cu categoria efectivă `proiect:<id>` = **„Marjă din export”**. Sub ea, lista „nu include: …” generată din efectele reale (§6.3), implicit: salarii (Salarii), diurne (Diurne), costul utilajelor proprii (pontaj utilaje), cheltuieli centrale, finanțare, investiții.

**Iulie (regim `expert_legacy`):** afișată **exact ca azi** (venit și cheltuieli din Expert, pe contract, fără reclasificare), badge „legacy — venit din contabilitate, include salarii și diurne; necomparabil cu lunile de după” și reconcilierea punctuală ERP 9.982.149,92 vs Expert 9.960.450,88 (Δ 21.699,04). Numele persoanelor: din `_persoane`, cu `LEFT JOIN`, doar pentru cei cu drept.

---

## 10. Reminder (pg_cron, Europe/Bucharest) — N13 / R13

- Obligațiile (§4.9) se creează idempotent (`INSERT … ON CONFLICT DO NOTHING`): `intermediar` scadent pe **20**, `final` pentru luna precedentă scadent pe **15**.
- **Satisfacere durabilă:** activarea face upsert pe obligație (o creează dacă lipsește) și o marchează satisfăcută; un `final` satisface și `intermediar`-ul aceleiași luni dacă era deschis. La generare, cron-ul **reconciliază** cu istoricul activărilor (orice import `activ`/`inlocuit` al variantei, sau final pentru intermediar) → o obligație creată târziu nu e raportată fals. Starea ulterioară a importului nu redeschide obligația.
- Cron-ul zilnic tratează **toate** obligațiile scadente și nesatisfăcute (recuperează rulări ratate). Mesajul descrie cea mai avansată tentativă a lunii/variantei: „lipsește” / „în procesare” / „invalid — reîncărcați” / „propus, așteaptă activare (N blocante)” / „respins — reîncărcați” (prioritate: propus > procesare > invalid/respins, apoi cea mai recentă).
- Notificare în platformă (`notifications`, fără mail automat) către Mirela + Marilena din ziua scadenței; la **+2 zile** → și Răzvan. Cheie unică `(obligatie_id, destinatar, etapa)` → idempotent. Monitorizare: rândul cron-ului în `automatizari` + ultima rulare.

---

## 11. Decizii (cine, când, ce blochează)

Implementarea pornește cu valorile propuse; asta **nu** înseamnă aprobarea schemei pentru APPLY, acordarea drepturilor sau validarea contabilă. Editările creează versiuni noi, nu modifică snapshoturile.

| Decizie | Cine | Blochează schema PR1? | Momentul obligatoriu |
|---|---|---|---|
| **D7** — gestiunea (auto + șofer): A rămâne vizibilă cititorilor Contabilitate (propus) / B trece în `_persoane` cu toate copiile | **Răzvan** | **da** | înainte de GO MERGE PR1 |
| **D9** — matricea familie × tratament × efect (§6.3), inclusiv „venitul rămâne mereu exclus” și 205 pe INVESTITII = abatere | **Răzvan**, cu Marilena pe sensul financiar | **da** (contractul derogărilor) | înainte de GO MERGE PR1 |
| **D1** — matricea conturilor (302/303 = cost de proiect? 167 / 471 în afara costului?) | Marilena | nu (seed neconfirmat, confirmare pe hash) | înainte de primul `final`; RPC-ul o impune |
| **D6** — exportul „holding” = doar Gazpet Instal SRL, RON | Marilena / Mirela | nu (poarta e în PR1) | înainte de **orice** activare nouă |
| **D2** — SEDIU, ACHIZITII separat, fără repartizare | Răzvan | nu | repartizare ulterioară = regulă nouă versionată |
| **D3** — indicatorul „Marjă din export” + lista generată | Răzvan | nu | înainte de acceptarea UI |
| **D4** — capabilitățile §8 și cui se dau | **Răzvan, explicit** | nu (identități de test) | înainte de acordarea în producție; OK separat pe schemă înainte de APPLY |
| **D5** — mail (faza 2) amânat | Răzvan | nu | contract și review separate |
| **D8** — iulie rămâne legacy (propus) sau se reîncarcă ulterior ca `final` cu derogări | Răzvan | nu | oricând după livrare |

---

## 12. Migrare și cutover (R11)

**Precondiție anti-drift a 1b (fail-closed, Copilot r5):** între APPLY 1a și APPLY 1b, v12 rămâne funcțional. 1b verifică întâi că inventarul `contab_expert_importuri` este **exact** cel auditat la etalon (azi: doar iulie, id-ul ei); orice rând creat de v12 după etalon → 1b se oprește cu eroare și cere review explicit (nu completare implicită). Recomandat: fereastra 1a → 1b cât mai scurtă și anunțată contabilității.

**Etalon înainte de orice:** iulie — `count`, sume pe contract, `sum(venit)`, `sum(cheltuiala)`, nr. linii cu persoană, ieșirea actuală a tab-ului salvată ca fixture; inventarul cititorilor (`Financiar.jsx` → `ContabilitateWMTab`, orice view/RPC pe `contab_expert_*` / `contab_santier_map`).

| Obiect | PR1a — aditiv (se poate aplica singur) | PR1b — restrictiv (doar în fereastra cu deploy PR3) |
|---|---|---|
| Tabele noi (`linii_sursa`, `_abateri`, `_persoane`, `derogari`, `config_versiuni`, confirmări, `audit`, `obligatii`, `contract_map`, `cont_clasificare`) | create, goale sau cu seed; trigger-ele lor active | — |
| Coloane noi pe `importuri` / `linii` | adăugate **nullable**, fără CHECK-uri noi, fără trigger pe tabelele vechi | backfill iulie: `sursa/varianta='legacy'`, `regim_venit='expert_legacy'`, `stare='activ'`; apoi `NOT NULL` + CHECK-urile §4.1 + trigger-ele §4.9 pe tabelele vechi |
| `persoana_nume` | rămâne pe `linii` (tab-ul vechi îl citește) | **excepția de migrare (V04)**, în ordinea: (1) iulie marcată legacy; (2) funcția de unică folosință `contab_migrare_legacy_persoane()` (deținută de `contab_owner`, marcaj `migrare_legacy`) copiază 1:1 cele 357 de nume în `_persoane` — precondiția „niciun rând în `_persoane` pentru acest import” se verifică **o singură dată, la începutul operației de copiere** (nu per rând într-un trigger BEFORE ROW, care ar vedea rândurile deja inserate de aceeași comandă); trigger-ul acceptă marcajul doar pentru un import `sursa='legacy'`; (3) verificare 357 = 357; (4) coloana se elimină; (5) **funcția se șterge în aceeași migrare** → indisponibilă la runtime |
| `UNIQUE(luna)` | rămâne (scriitorul vechi depinde de el) | eliminat; indexurile unice parțiale §4.1 create |
| RLS | doar pe tabelele noi | restrânsă pe tabelele vechi; politica ALL veche eliminată |
| RPC-uri noi + edge-uri noi | instalate, dar **poarta `contab_flux_nou_activ = false`** (rând de configurare) → toate RPC-urile noi răspund `FLUX_INACTIV` | poarta trece pe `true` în aceeași migrare |
| Edge vechi `contab-expert-import` v12 | rămâne funcțional (nu atinge tabelele/trigger-ele noi) — testat | stub 410, în aceeași fereastră |

- `$post$` după fiecare etapă: etalonul iulie identic (sume, numărători, numele mutate 1:1 în 1b).
- **Rollback:** script în `supabase/revenire/` pentru fiecare etapă, armat înainte de APPLY; criteriu de oprire = etalon diferit sau tab-ul (vechi după 1a / nou după 1b) nu încarcă iulie. **Pragul real (V05):** rollback-ul structural al 1b e valabil doar cât nu există **niciun** import `sursa='upload'` (în orice stare — un `invalid` și un `propus` pe aceeași lună fac deja imposibil `UNIQUE(luna)`); scriptul verifică asta și refuză altfel. După primul upload, revenirea = **oprire, nu ștergere**: `contab_flux_nou_activ=false` (RPC-urile noi răspund `FLUX_INACTIV`), istoricul rămâne intact, iar corecția se face înainte (forward-fix), prin runner.
- **Backfill:** aug final, apoi sep intermediar — **prin același flux uman** (upload → propus → activare), nu prin script. Aug intermediar nu se importă. Sep final: 15.10, prin fluxul normal.

---

## 13. Teste minime (criteriu de acceptare)

**Parser (unit, fixture-uri sintetice + cele 3 originale):** antet exact / B1 gol / „Inca”+„drare” / coloană mutată, lipsă, în plus / două foi candidate; clasificarea fiecărui rând (subtotaluri iulie cu celule îmbinate, `T O T A L   G E N E R A L`, gol la final, rând necunoscut, `nr_crt` text/fracționar/repetat, goluri); sume int/float/3 zecimale/**5 zecimale → invalid**/**13 cifre → invalid**/negative/text românesc/ambiguu/`#VALUE!`/gol; date 31.02, an bisect, serial Excel; document „F”, cont numeric 303 → text, `... ...`; total prezent corect / greșit / repetat / lipsă; formule, foi ascunse, fișier corupt, ZIP-bombă, peste limite. **Pe originale**: 1.684 / 1.199 / 517 rânduri, cele 20 goluri din aug, sumele exacte din §1.

**SQL real (Postgres 17, rol non-superuser, RLS reală — modelul `scripts/pg/test_*.mjs` + pas în CI). Testele verifică **codul** rezultatului (§7), nu textul.**
- **frontiera de încredere**: `authenticated` (chiar cu `contab_propune`) apelează `intern_*` → `permission denied`; `service_role` cu actor fără drept → `DREPT_LIPSA`; **`service_role` care își setează singur `contab.op='sigileaza'` și face INSERT/UPDATE/DELETE direct pe snapshot, sursă, `_persoane` → `permission denied`** (V01); `SET ROLE contab_owner` din `service_role`/`authenticated` → refuzat; edge fără JWT / fără capabilitate → 401/403 **înainte** de upload; `storage_path` din client ignorat.
- **staging**: eșec la batch 2 → `intern_invalideaza` comis, nimic activabil; retry identic pe `rand_fizic` → fără dubluri; retry cu alt `persoana_nume` → conflict; INSERT în sursă după sigilare (inclusiv `service_role`) → refuz; **batch care deține primul lock-ul → sigilarea așteaptă (observat în `pg_locks`) și numără batch-ul**; **sigilarea deține lock-ul → batch-ul așteaptă și e refuzat**; UPDATE/DELETE pe sursă, snapshot, `_persoane`, `_abateri`, derogări, `config_versiuni` (inclusiv `service_role`, fără marcaj) → refuz; manifest incomplet / versiune necunoscută → `invalid`; eroare înaintea manifestului (ZIP corupt) → `invalid` comis; **drept revocat după creare → batch refuzat → `intern_invalideaza` comis fără drept uman** (V06); timeout fără utilizator logat (cron) → `invalid` cu identitatea `cron:timeout`; timeout concurent cu sigilarea → `SKIP LOCKED`, fără `invalid` peste un `propus`.
- **configurare**: editare a matricei în timpul sigilării (între rezolvarea liniilor și calculul hash-urilor) → liniile și `clasif_hash` aparțin aceleiași versiuni; setarea `64 → cost` nu elimină abaterea `cont_64`.
- **tratament implicit (D9)**: matrice editată `64 → cost` și `625/fara_partener → cost` → pe **intermediar** liniile rămân `exclus`, marja neschimbată; 641 pe INVESTITII → `exclus` (conservator) + ambele perechi blocante pe final; 213 pe ORSOVA → `investitii`.
- **ordinea creare → parser**: ZIP corupt / ZIP-bombă după `intern_creeaza` → `invalid` durabil; eroare de autentificare înainte de creare → nimic în BD.
- **categorii și abateri**: 167/proiect → `finantare`; 205/SEDIU → `investitii`; **205/INVESTITII → `investitii` + abaterea `investitii_cont`**; 64/proiect → `exclus`; cont necunoscut → `de_clarificat`; **641/INVESTITII → {`cont_64`,`investitii_cont`}, o singură derogare → încă blocant pe final**; nemapat cu sold negativ și zero → blocant; Σ categorii = total exact; 0,004 + 0,004 → rândul de rotunjire.
- **derogări**: fiecare tratament din §6.3 verificând **clasa, categoria, venitul, cheltuiala** și textul „nu include”; `venit_regim_erp / trateaza_cost` → refuz (nepermis); tratamente incompatibile pe aceeași linie → `DEROGARE_CONFLICT`; non-owner → `DREPT_LIPSA`; derogare pe familie nederogabilă → refuz; a doua derogare pe aceeași familie → refuz; derogare după ce omul a văzut `review_hash` → activare `CONFLICT_STALE`; derogare pe import activ → `STARE_INVALIDA`.
- **activare**: propus valid / invalid / respins / depășit / înlocuit; intermediar peste final → `IERARHIE`; final fără perioadă (NULL) → imposibil (CHECK); final cu matrice neconfirmată → `MATRICE_NECONFIRMATA`, apoi confirmare pe același hash → OK; **intermediar fără D6 → `PERIMETRU_NECONFIRMAT`**; final r2 cu motiv și revizie alocată; idempotență pe activ (pasul 4 înaintea pasului 5); regresie de intermediar fără / cu confirmare; eroare injectată după dezactivarea vechiului → rollback, vechiul rămâne activ.
- **hash**: A activ → review B → B activ → review C (fără recursie); `review_hash_activat` al lui B reproductibil ulterior din `context_aprobare`; **intermediar activat cu matrice neconfirmată → confirmare ulterioară → dovada intermediarului rămâne identică** (V03); `partener` NULL vs textul `\N` → `hash_linie` diferit (V02); ordine diferită a rândurilor în interogare → același hash; modificarea oricărui câmp sursă → alt `snapshot_hash`.
- **concurență (două sesiuni)**: două activări pe aceeași lună (cu și fără activ anterior) → a doua `CONFLICT_STALE`; luni diferite nu se blochează; respinge vs activează; derogare vs activare; drept revocat cât activarea așteaptă lock-ul → `DREPT_LIPSA`; două upload-uri simultane ale aceluiași fișier → unul `FISIER_DUPLICAT`.
- **tentative și revizie**: propus → tentativă (maparea nouă) → vechiul `depasit` și neatins; **activ → revizie din același fișier → activul rămâne activ până la activarea succesorului**; tentativă repetată cu același `cerere_id` (răspuns pierdut) → același id; același `cerere_id` cu alt payload/actor → conflict.
- **roluri și RLS**: anon, autentificat fără financiar, fiecare capabilitate, owner, cont de automatizare; DML direct pe orice tabel `contab_*` → refuz; `EXECUTE` revocat de la PUBLIC; politica ALL veche eliminată.
- **confidențialitate**: utilizator fără drept salarial vede toate rândurile și totalul complet (`LEFT JOIN`), SELECT direct pe `_persoane` și pe `linii_sursa` → 0 rânduri; fără URL pentru fișierul brut; activator fără `can_access_salarii` → fără fișier brut; raport/diff/audit fără nume.
- **venit și marjă**: venit ERP fără proiect și facturi negative în casetă; marja intermediarului pe aceeași perioadă; iulie legacy identică cu etalonul; mutare între categorii cu total neschimbat → apare în diff.
- **reminder**: intermediar activat apoi înlocuit de final → obligația rămâne satisfăcută; **activare înainte ca obligația să existe → creată satisfăcută**; generare după backfill → fără alertă falsă; cron ratat → recuperat; rerulare → fără notificări duble; mesajul „în procesare”.
- **migrare**: etalonul iulie identic după 1a și după 1b; **1a → 1b rulat cu trigger-ele reale instalate**: copierea celor 357 de nume reușește, o a doua rulare a funcției de migrare e refuzată, funcția nu mai există după 1b (V04); **rollback 1b cu două tentative neactivate pe aceeași lună → refuzat de verificarea pragului**, iar `contab_flux_nou_activ=false` oprește fluxul fără pierdere de istoric (V05); după 1a: tab-ul vechi și edge-ul v12 funcționează, RPC-urile noi → `FLUX_INACTIV`; după 1b: NULL pe câmpurile obligatorii ale unui import upload → refuz; iulie legacy acceptată.

---

## 14. Ordinea de implementare (PR-uri mici; merge ≠ APPLY)

0. **Înainte de GO MERGE PR1:** deciziile D7 și D9 (Răzvan).
1. **PR1 — Migrări 1a (aditivă) + 1b (restrictivă) + RPC-uri + teste SQL** (fără UI). Review Jakarinos + Copilot GO MERGE / GO APPLY (SHA). APPLY 1a cu OK-ul lui Răzvan pe schemă; **1b doar împreună cu deploy-ul PR3**.
2. **PR2 — Edge `contab-expert-propune` + `contab-expert-reia` + parser v1 + teste unit** pe cele 3 originale.
3. **PR3 — UI**: upload, ecran „Import propus” (categorii / abateri / blocante / avertismente / diff / derogări / `review_hash`), activare, revizie din fișier, mapare contracte, matricea conturilor + confirmare, confirmare perimetru, caseta de control, tab refăcut (inclusiv afișarea legacy). Deploy coordonat cu APPLY 1b.
4. **PR4 — Reminder cron** + job timeout + rând `automatizari` + `registru_automatizari`.
5. **Backfill** aug final + sep intermediar prin UI, cu Marilena. Sep final: 15.10 prin fluxul normal.

---

## Anexa A — Jurnal review
| Rundă | Reviewer | Verdict | Esențial |
|---|---|---|---|
| r1 (06.10, v1) | Copilot | GO cu condiții | 8 P0: staging atomic, activare serializată + revalidare, destinație obligatorie, mapare înghețată, reguli de dublare blocante pe final, sume decimale, venit fără proiect în control, RLS care nu ascunde valoarea |
| r1 (06.10, v1) | Jakarinos | de refăcut | 22 probleme (11 blocante): definiția rezultatului, clasificarea conturilor, statusuri venit ERP, staging, concurență, capabilități, RLS persoană, mapare, antet 12 coloane, clasificare rânduri, conversii stricte, migrare/cutover; corecție cifre SANTIER sep |
| r2 (06.10, v2) | Copilot | NO-GO punctual („foarte aproape”) | 5 corecții: lock comun insert/sigilare + UNIQUE(import_id, rand_fizic); destinație ⟂ clasificare; snapshot imuabil vs versiuni (varianta A); `validation_hash` canonic + derogări tipizate; PII fără view `security_invoker` + final = lună întreagă |
| r2 (06.10, v2) | Jakarinos | de refăcut punctual | N01–N15: funcție unică de categorie, tentative, reguli unice, derogări în hash, sigiliu + manifest, ordinea idempotenței, PII + fișier brut + gestiune, precizie, final parțial, D1 pe versiune, iulie conservată, PR1 aditiv/restrictiv, obligații durabile, teste financiare, perimetru |
| r3 (06.10, v3) | Copilot | NO-GO punctual („dacă v4 schimbă doar aceste puncte, GO pe design”) | 4 P0: hash autoreferențial; parserul ocolibil prin RPC direct; sigilarea cere UPDATE interzis; o singură `familie_regula` + tratamente fără sens. P1: PII în sigiliu, compatibilitate v12 în 1a |
| r3 (06.10, v3) | Jakarinos | de refăcut punctual | R01–R13: aceleași 4 + snapshot de configurare consecvent, matrice familie × tratament × efect, revizie din fișierul activ + retry, D6 pe orice activare, invalidare durabilă, protecție pe toate tabelele snapshotului, CHECK-uri NULL + matricea 1a/1b, coduri de eroare în teste, obligații create târziu |
| r4 (06.10, v4) | Jakarinos | de refăcut punctual (structura „implementabilă, fără redesign”) | P0.1–P0.4 Copilot r3 închise; R01, R04–R08, R12–R13 închise; noi V01–V06: marcajul nu e capabilitate (→ rol `contab_owner`, fără DML pentru `service_role`), `hash_linie` neinjectiv (→ vector JSON), contextul D1/D6 al aprobării neînghețat (→ `context_aprobare`), copierea persoanelor legacy fără excepție executabilă, pragul de rollback prea târziu, invalidarea tehnică vs dreptul uman revocabil; NOT NULL pe `societate/moneda/reguli_versiune` |
| r4 (v4) | Copilot | netrimis (coliziune pe canal cu altă sesiune) | v5 trimis direct |
| r5 (06.10, v5) | Copilot | **GO cu condiții** — „designul e închis; următorul gate direct pe PR1a/1b + RPC + harness SQL, fără v6” | toate P0/P1 r3 închise; niciun P0 nou; condiții: D7, D9 (cu tratamentul implicit al familiilor fixe care bate matricea), ordinea `intern_creeaza` înainte de parser, chei reale în `context_aprobare`, 1b refuză drift-ul v12 — toate preluate textual în v5.1 |
| r5 (06.10, v5) | Jakarinos | **gata cu condiții** (D7 + D9 înainte de GO MERGE PR1) | V01–V06 și R02/R03/R09/R10/R11 închise; „după D7 + D9, sesiunea de programare poate implementa PR1 fără să inventeze reguli de contract”; 3 sugestii editoriale preluate în v5.1 |
