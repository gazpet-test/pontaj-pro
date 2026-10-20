# Izometrie E2 — plan (registru + stocul LOT 2, nivel `stoc`)

Stare: **plan, fără cod**. Bază: design v2.3 §1.2–§1.4, §1.10–§1.12, §2.2, §5.4–§5.5, §6.3 E2 + `INVENTAR_SCHEMA_E1.md` + deciziile Razvan (#1788–#1790, 20.10: stocul în Magazie, vedere doar-citire în Execuție).

## 0. Precondiții (înainte de orice migrare)

| # | Ce | Cine / „da” |
|---|---|---|
| P1 | **Testul gărzii pe branch Supabase** (§6.1 p10): CREATE ROLE `izo_registru_writer` NOLOGIN NOINHERIT + criteriul SET/INHERIT, ALTER FUNCTION … OWNER, GRANT-uri și politici `TO` rol (inclusiv `storage.objects`), marcajul pe tranzacție în garda INVOKER + testul negativ. GO → garda din design; NO-GO → varianta slabă (riscul 2), cu decizie separată | „da branch” scris de Razvan în sesiunea Izometrie |
| P2 | #803 pe main (gata, bba4aca9); tronsoanele 16–23 și depozitele 9/10/11 în BD (gata) | — |
| P3 | Contul Cioc Janeta activat (primul login) | Janeta / HR |

## 1. Livrarea în două PR-uri

- **E2a — schema + garda + importul soldului inițial** (fără UI de lucru zilnic). Livrează: stocul LOT 2 în ERP, vizibil doar-citire.
- **E2b — UI-ul de stoc**: Magazie → „Țeavă proiecte”, vedere doar-citire în Execuție → Izometrie, ieșirea simplă, inventarul pe depozit, exportul Excel/PDF.
Motiv: schema și datele reale primesc review și „da” separat de ecrane; un import greșit se poate stornează înainte să lucreze cineva pe el.

## 2. E2a — migrarea (o singură migrare + fișierul de revenire în `supabase/revenire/`)

### 2.1 Rolul și funcțiile de bază
- `izo_registru_writer` NOLOGIN NOINHERIT (criteriul din P1, verificat și ca test în migrare: niciun rol în afară de `postgres` cu SET/INHERIT; `anon`/`authenticated`/`authenticator`/`service_role` fără SET ROLE).
- `fn_izo_nivel(proiect)` → `off`/`stoc`/`montaj` (SECURITY DEFINER, STABLE).
- `fn_izo_acces(proiect, cheie, nivel_minim)` → bool (DEFINER, owner `postgres`, EXECUTE doar pentru `izo_registru_writer`); citește `user_module_access`, `profiles.is_owner`, `izo_atribuiri`.
- `fn_izo_poate_activa(proiect, nivel)`: verifică existența triggerelor și a politicilor nivelului.
- Test în migrare: lista funcțiilor cu owner `izo_registru_writer` = exact lista albă, altfel migrarea pică.

### 2.2 Tabele noi (toate: RLS activ, `REVOKE ALL … FROM anon, authenticated` explicit — default ACL-ul live dă `arwdxt`, inventar p6 —, clientul doar SELECT pe proiectele atribuite)
| Tabel | Ce ține | Scrie |
|---|---|---|
| `izo_proiect_config` | `nivel_izo`, `toleranta_mm` (20), `prag_rest_mm` (500), etichete fișă, `format_sudura` (TR, fără zerouri), `conventie_sufixe` + sursa, praguri | owner; `conventie_sufixe` doar MP prin funcție (E4b) |
| `izo_tronson_config` | `sens_numerotare`, `perete_proiectat` pe zone, `executant` pe interval (Petroconst T16/T17, contract 76) | owner |
| `izo_atribuiri` | proiect, profil, rol (`inginer_izometrie`, `manager_aprobator`, `inlocuitor_aprobator`, `gestionar`, `rts_rte`), `depozit_id`, valabilitate, `acordat_de` | owner |
| `izo_surse_proiect` | PT / KML / acte: tip, revizie, sha256, fișier | owner |
| `izo_ax_ancore` | ancorele de calibrare (din preview-ul E1) | owner |
| `magazie_bucati_evenimente` | antetul registrului (doar adaug): tip, proiect, document, `storno_de_eveniment_id` UNIQUE, motiv, `declarat_de`, `aplicat_de`, ore, `import_id` | doar funcțiile registrului |
| `magazie_bucati_miscari` | rândurile evenimentului: bucată, rol, `din_loc`/`in_loc`, `lungime_mm`, `inainte`/`dupa` | doar funcțiile registrului |
| `teava_certificate` + `teava_certificate_sarje` | certificatul 3.1 pe șarjă (structura acum, completarea în E3) | gestionar prin funcție (E3) |

Registrul: trigger care refuză orice UPDATE/DELETE, trigger contra TRUNCATE, REVOKE pe secvențe.

### 2.3 `magazie_bucati` — extinderea (coloanele existente se refolosesc, §1.2)
- Noi: `tip_cod` (din `magazie_tipuri_material.cheie`: `teava`/`curba`/`alt`), `uid`, `parinte_id`, `radacina_id`, `cod_bucata`, `capat_stanga/dreapta`, `serie_canon` (generată), `dezambiguare`, `lungime_aviz_mm`, `lungime_masurata_mm`, `lungime_mm`, `lungime_calculata`, `lungime_cm` (generată), `perete_mm`, `diametru_mm`, `lot`, `aviz_intrare_id`, `nr_crt_aviz`, `bend_no`, `capat_marcaj`, `certificat_id`, **`depozit_id`**, **`tronson_id`**, `server_ver`.
- CHECK `stare`: + `in_tranzit`, `pe_tronson`, `rest_nereutilizabil`, `taiata`, `deseu`, `pierduta`, `anulata` (fără `carantina`); `rezervata`/`consumata` refuzate pe `beneficiar` la nivel ≥ `stoc` (în gardă).
- CHECK `locatie_tip`: + `depozit`, `tronson` (azi doar `sediu`/`proiect`, inventar p1).
- `izolatie`: „HDPE B3” se mapează pe `PEHD` (CHECK-ul rămâne), textul original în `atribute`.
- **Garda** (trigger INVOKER pe `magazie_bucati`): OLD/NEW `beneficiar` și `fn_izo_nivel ≥ stoc` → cere `current_user = izo_registru_writer` **și** marcajul pe tranzacție. Rândurile `gazpet` (producția) și LOT 1 (`off`) nu sunt atinse.
- **Politici RESTRICTIVE** `TO anon, authenticated` pe INSERT/UPDATE/DELETE: `NOT (provenienta='beneficiar' AND fn_izo_nivel(proiect_id) <> 'off')`.
- **Indexuri parțiale** (doar `beneficiar`): țeavă UNIQUE (`serie_canon`, `dezambiguare`, `sarja`, `lungime_cm`) NULLS NOT DISTINCT pe frunze; curbă UNIQUE (`serie_canon`, `sarja`, `unghi_curba`, `cod_bucata`); cod pe arbore UNIQUE (`radacina_id`, `cod_bucata`). Azi sunt 0 rânduri `beneficiar`, deci indexurile se creează curat; importul verifică înainte, indexul e ultima barieră.

### 2.4 Căile vechi închise la nivelul `stoc` (§5.4)
| Cale | Mecanism |
|---|---|
| 3 — import REPLACE / DELETE pe `executie_tevi` | trigger care refuză DELETE din client pe proiectele cu nivel ≥ `stoc` (LOT 2 are azi 0 țevi, deci nu blochează lucru real) |
| 9 — bonuri | trigger pe `executie_bonuri_consum_linii`: refuză `magazie_bucata_id` beneficiar pe proiect cu nivel ≥ `stoc` (+ filtru în UI) |
| 10, 11, 12 — recepția directă, producția, mutarea | prin gardă (testele de regresie: recepție `beneficiar` pe LOT 1 și producție `gazpet` pe proiectul 3 trec) |
| 13 — `din_stoc` pe transport | **de decis (Q-E2-1, mai jos)**: liniile de transport recunosc materialul doar după text |

### 2.5 Importul soldului inițial (funcție + preview, fără scriere până la „da”)
- **Preview local** (`scripts/izometrie/preview_e2_stoc.mjs`, `xlsx-js-style` deja instalat): citește cele două Exceluri, câte un mapping pe fiecare foaie (layout-ul diferit al „TEAVA 7.1 TOPLET”), produce JSON + raport.
  - **Reconcilierea obligatorie** (§6.3 E2): Topleț 7.1 = 1420 / 17 371,00 m (828 livrate / 10 120,02 m); 8,8 = 57; 6 m = 390; Jupânești 7.1 = 896 / 10 996,97 m (390 livrate); 8,8 = 184 / 2 288,80 m (168 livrate); curbe LOT 2 = 405. Cifrele nu bat → importul nu se propune.
  - **Excluderile**: 23 de placeholdere (4+1+6+10+2), rândul SBD, curbele LOT 1/LOT 3 (lista separată, la decizie); 2545CA (23) ca **conflict**, nu serie nouă.
  - **Depozitul** pe rând: Jupânești → JUP (9); Topleț → TOP (11), cu excepția grupurilor „DT/OS = ORSOVA” și a avizelor `CJPT-O` → **ORN (10)**, propuse pe grupuri și confirmate în preview.
  - **Starea**: livrate cu aviz CJPT/CJPJ + TR → `pe_tronson` pe `executie_tronsoane` 16–23 (montajul nu se presupune, E4c); în stoc → `receptionat` dacă există PV/NRCD, altfel `sosit`.
  - **Peretele** obligatoriu: din foaie (7,1 / 8,8) sau din descriere; la curbe din „CMFØ 610/{perete}/…”. Fără perete → rând de decis.
  - 0 coliziuni pe serie + șarjă + lungime (la cm) și pe curbe (serie + șarjă + unghi) — altfel lista merge la decizie.
- **Aplicarea**: `fn_izo_import_sold_initial(p_import jsonb)` (owner `izo_registru_writer`, EXECUTE doar `postgres`/owner): un eveniment `sold_initial` pe import (`import_id`), bucățile + mișcările, idempotentă pe `import_id`. **O rulează sesiunea de chat, cu „da”-ul lui Razvan**; rollback = storno pe tot evenimentul.
- **Activarea nivelului** `stoc` pe proiectul 3: `UPDATE izo_proiect_config` prin `fn_izo_poate_activa`, cu „da” separat, după import.

### 2.6 Teste de acceptare E2a (pe branch, apoi pe producție după apply)
Din §6.3 E2: scrierea directă PostgREST pe bucată beneficiar a proiectului 3 → refuzată; beneficiar → gazpet → refuzat; funcție DEFINER cu owner `postgres` → refuzată; `rezervata`/`consumata` → refuzate; a doua tripletă identică → R1 (d) / index; `carantina` → refuzată; regresie LOT 1 + producție; DELETE pe `executie_tevi` LOT 2 → refuzat; reconcilierea și excluderile; 0 coliziuni la curbe; perete pe fiecare rând; trei depozite.

## 3. E2b — UI (PR separat, după E2a)
- **Magazie**: tab nou „🧱 Țeavă proiecte” lângă „🔍 Stoc trasabil” (azi nu există un tab „Stocuri”; tab-urile sunt Materiale / Magazii / Transferuri / Consum / Catalog / Echipamente / Stoc trasabil / Producție — **Q-E2-2**). Filtre: proiect → depozit (JUP/ORN/TOP) → tip (7,1 / 8,8 / 6 m / curbe) → stare (disponibil / în drum spre depozit / pe tronson / montat). Totaluri buc + m. `STARE_META` extins cu stările noi.
- **Execuție → Izometrie**: aceeași sursă (vedere `v_izo_stoc` cu `security_invoker`), doar citire.
- **Ieșirea simplă** din depozit pe tronson (gestionar): `fn_izo_iesire(bucăți, tronson, nr aviz CJPT/CJPJ)` → `pe_tronson`.
- **Inventarul pe depozit** (§1.12) + `v_izo_divergente` (registru vs stare salvată) + export Excel/PDF.

## 4. Ce cere „da”-ul lui Razvan (prin chat)
1. **„da branch”** (P1) — în sesiunea Izometrie.
2. **Schema E2a** (migrarea de mai sus, inclusiv rolul nou) — după GO Copilot/Gemini/Codex.
3. **Soldul inițial** — pe raportul de preview (reconciliere + excluderi + depozite pe grupuri + conflictele 2545CA), aplicat de chat.
4. **Activarea nivelului `stoc`** pe proiectul 3.
5. **Drepturile Cioc Janeta** (după primul ei login): `magazie` editor + `izo_atribuiri` gestionar pe depozitele 9, 10, 11. Nimic altceva.
6. **Q-E2-1** — interdicția `din_stoc` (calea 13), pentru că liniile de transport n-au proiect sau tip de material:
   - **A** (recomand): BD refuză liniile `din_stoc` pe transporturile care pleacă dintr-un depozit LOT 2 (site 6); țeava de acolo iese doar prin `fn_izo_iesire`. Simplu și sigur; blochează și alte materiale cantitative din acele depozite (azi nu există stoc cantitativ acolo).
   - **B**: refuz doar pe liniile a căror denumire seamănă cu țeavă/curbă (listă de tipare). Mai permisiv, dar ghicește după text.
7. **Q-E2-2** — locul ecranului: tab nou „Țeavă proiecte” (recomand) sau sub-vedere în „Stoc trasabil”.
8. **Q-E2-3** — curbele LOT 1 (3) și LOT 3 (22) din fișierul LOT 2: **A** excluse și listate separat (recomand), **B** importate pe proiectele lor (LOT 1 rămâne `off`, deci ar intra pe calea veche).
