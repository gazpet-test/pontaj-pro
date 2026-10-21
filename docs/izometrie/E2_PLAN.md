# Izometrie E2 — plan (registru + stocul LOT 2, nivel `stoc`)

Stare: **plan r2, fără cod** — integrează review-ul Copilot + Gemini (GO cu condiții, `paw-data/out/cop_e2_plan.log`, `gem_e2_plan.log`; tabelul din §5). Bază: design v2.3 §1.2–§1.4, §1.10–§1.12, §2.2, §5.4–§5.5, §6.3 E2 + `INVENTAR_SCHEMA_E1.md` + deciziile Razvan (#1788–#1790, 20.10: stocul în Magazie, vedere doar-citire în Execuție).

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

### 2.0 Ordinea (fără nicio fereastră) [R6]
1. migrarea E2a (schema + garda + căile închise) — nivelul rămâne `off` pe toate proiectele;
2. testele negative pe producție (§2.6) — „trece” înainte de pasul 3;
3. **activarea nivelului `stoc` pe proiectul 3, cu 0 bucăți beneficiar**, și **importul**: în aceeași tranzacție, rulate de chat după cele două „da”-uri (activare + sold). Nu există moment cu bucăți beneficiar pe un proiect `off`.

### 2.1 Rolul și granița de privilegiu [R7]
- `izo_registru_writer` NOLOGIN NOINHERIT, **fără BYPASSRLS** (Supabase nu-l dă): GRANT-uri explicite + politici **PERMISSIVE `TO izo_registru_writer`** pe fiecare tabel pe care îl citește/scrie (matricea §1.3 p6, partea E2).
- În `pg_auth_members` e permis **doar `postgres`** ca membru al rolului (necesar la `ALTER FUNCTION … OWNER TO`); `anon`/`authenticated`/`authenticator`/`service_role` fără SET/INHERIT — aserțiune în migrare.
- Writer-ul **nu deține** tabele, secvențe sau schema; deține doar funcțiile din lista albă. Toate entrypoint-urile DEFINER: `SET search_path = public, pg_temp`, obiecte schema-qualified (`public.…`), **fără SQL dinamic**.
- **Fără `ALTER DEFAULT PRIVILEGES` global**: ACL explicit pe fiecare obiect E2 (`REVOKE ALL … FROM anon, authenticated, PUBLIC`, apoi doar GRANT-urile din matrice) + aserțiune în migrare că niciun obiect E2 nu are drept pentru `anon`/`authenticated` în afara SELECT-urilor prevăzute.
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
| `magazie_bucati_miscari` | rândurile evenimentului: **`eveniment_id` FK NOT NULL** → evenimente, bucată (FK), rol, `din_loc`/`in_loc`, `lungime_mm`, `inainte`/`dupa` [R5] | doar funcțiile registrului |
| `izo_importuri` | **idempotența în BD** [R3]: UNIQUE (`proiect_id`, `import_id`), `payload_sha256` (calculat pe server din payload-ul canonic), sha256-urile Excelurilor sursă, `eveniment_id`, rezultatul (COUNT-uri), `stare` (`aplicat`/`stornat`) | doar `fn_izo_import_sold_initial` / storno |

Eveniment + mișcări + starea materializată din `magazie_bucati` se scriu **în aceeași tranzacție**, numai din funcțiile registrului [R5]. `server_ver` = o **secvență globală monotonă** (`izo_server_ver_seq`), setată la fiecare scriere a registrului, pentru delta-sync-ul din E6 [R12].
| `teava_certificate` + `teava_certificate_sarje` | certificatul 3.1 pe șarjă (structura acum, completarea în E3) | gestionar prin funcție (E3) |

Registrul: trigger care refuză orice UPDATE/DELETE, trigger contra TRUNCATE, REVOKE pe secvențe.

### 2.3 `magazie_bucati` — extinderea (coloanele existente se refolosesc, §1.2)
- Noi: `tip_cod` (din `magazie_tipuri_material.cheie`: `teava`/`curba`/`alt`), `uid`, `parinte_id`, `radacina_id`, `cod_bucata`, `capat_stanga/dreapta`, `serie_canon` (generată), `dezambiguare`, `lungime_aviz_mm`, `lungime_masurata_mm`, `lungime_mm`, `lungime_calculata`, `lungime_cm` (generată), `perete_mm`, `diametru_mm`, `lot`, `aviz_intrare_id`, `nr_crt_aviz`, `bend_no`, `capat_marcaj`, `certificat_id`, **`depozit_id`**, **`tronson_id`**, `server_ver`.
- CHECK `stare`: + `in_tranzit`, `pe_tronson`, `rest_nereutilizabil`, `taiata`, `deseu`, `pierduta`, `anulata` (fără `carantina`); `rezervata`/`consumata` refuzate pe `beneficiar` la nivel ≥ `stoc` (în gardă).
- CHECK `locatie_tip`: + `depozit`, `tronson` (azi doar `sediu`/`proiect`, inventar p1).
- `izolatie`: „HDPE B3” se mapează pe `PEHD` (CHECK-ul rămâne), textul original în `atribute`.
- **Garda** (trigger INVOKER pe `magazie_bucati`): OLD/NEW `beneficiar` și `fn_izo_nivel ≥ stoc` → cere `current_user = izo_registru_writer` **și** marcajul pe tranzacție. Rândurile `gazpet` (producția) și LOT 1 (`off`) nu sunt atinse.
- **Politici RESTRICTIVE** `TO anon, authenticated` pe INSERT/UPDATE/DELETE: `NOT (provenienta='beneficiar' AND fn_izo_nivel(proiect_id) <> 'off')`.
- **`tip_cod`** nu poate fi coloană generată din alt tabel [R11]: e o **copie controlată de server** (scrisă doar de funcțiile registrului din `magazie_tipuri_material.cheie`, cu CHECK `teava`/`curba`/`alt` și un trigger care refuză o valoare care nu bate cu `tip_material_id`).
- **`radacina_id = id` la rădăcină** [R10]: writer-ul ia `id` cu `nextval` explicit și scrie `radacina_id` în același INSERT (fără UPDATE ulterior); CHECK: `parinte_id IS NULL ⇔ radacina_id = id`.
- **Indexuri strict parțiale** (doar `provenienta = 'beneficiar'`; rândurile `gazpet` nu intră în niciunul) [R8, R9]:
  - **identitatea rădăcinii** [R1]: UNIQUE (`serie_canon`, `dezambiguare`) NULLS NOT DISTINCT WHERE `tip_cod = 'teava'` AND `parinte_id IS NULL` AND `stare <> 'anulata'` — două rădăcini cu aceeași serie canonică = conflict (R1 c). `dezambiguare` se completează **doar** prin `fn_izo_dezambiguare` (owner, motiv, poze, jurnal în registru), niciodată la import;
  - **frunzele** [D#1]: UNIQUE (`serie_canon`, `dezambiguare`, `sarja`, `lungime_cm`) NULLS NOT DISTINCT WHERE `tip_cod = 'teava'` AND `stare NOT IN ('taiata','anulata')` (R1 d);
  - **curbele**: UNIQUE (`serie_canon`, `sarja`, `unghi_curba`, `cod_bucata`) NULLS NOT DISTINCT WHERE `tip_cod = 'curba'` AND `stare <> 'anulata'`. **`bend_no` rămâne în afara cheii, ca în design v2.3 §1.2 [K#9]** — review-ul Copilot citează cheia din v1 (`unghi_grd`, `bend_no`); în v2.3 a fost scoasă pentru că foaia „CURBE LOT 2” **nu are număr de curbă**, iar un `bend_no` provizoriu ar fi făcut indexul inutil (fiecare valoare unică). La import `bend_no = NULL`, **niciodată o valoare provizorie**; se completează doar din sursă verificabilă (ex. packing list-ul furnizorului Gürgenler). Dacă preview-ul pe cele 405 curbe arată coliziuni, **cheia NU se extinde automat** (un `aviz_intrare_id` ar transforma un duplicat real într-o identitate „validă”): coliziunile se listează și se decid explicit — `dezambiguare` auditată (`fn_izo_dezambiguare`) sau `bend_no` real, dovedit din sursă. Până la decizie, preview-ul e neaplicabil (R13). **Reconfirmat de Copilot (GO).**
  - **codul pe arbore**: UNIQUE (`radacina_id`, `cod_bucata`) WHERE `stare <> 'anulata'`.
  - Toate exclud `anulata`, ca un re-import după storno să nu pice [R9]. Azi 0 rânduri `beneficiar` → indexurile se creează curat; importul verifică înainte, indexul e ultima barieră.
- **Preflight înaintea schimbării CHECK-urilor** [R8]: SELECT în migrare care verifică că toate cele 18 rânduri `gazpet` respectă CHECK-urile noi (stare, `locatie_tip`, `izolatie`); altfel migrarea pică.
- **Magazia existentă nu se strică între E2a și E2b** [R8] — intră în E2a (cod mic, UI): `STARE_META` și `LOCATIE_META` din `src/Magazie.jsx` completate defensiv cu stările/locurile noi (afișare „necunoscut” pentru orice valoare lipsă); filtrul `provenienta <> 'beneficiar'` în `src/ConsumuriBonuriTab.jsx:102`.

### 2.4 Căile vechi închise la nivelul `stoc` (§5.4)
| Cale | Mecanism |
|---|---|
| 3 — import REPLACE / DELETE pe `executie_tevi` | trigger care refuză DELETE din client pe proiectele cu nivel ≥ `stoc` (LOT 2 are azi 0 țevi, deci nu blochează lucru real). **Corectat de `20261102c` (21.10.2026, decizia Razvan, varianta A):** LOT 2 avea deja un pachet cu rânduri, iar ecranul vechi nu mai putea corecta un rând. La `stoc` se refuză doar rândurile / pachetele **legate de registru** (`magazie_bucati.executie_teava_id`); la `montaj` (E4a) se refuză tot. Importul REPLACE redevine neatomic, ca înainte de E2 (varianta atomică: E4a) |
| 9 — bonuri | trigger pe `executie_bonuri_consum_linii`: refuză `magazie_bucata_id` beneficiar pe proiect cu nivel ≥ `stoc` (+ filtru în UI) |
| 10, 11, 12 — recepția directă, producția, mutarea | prin gardă (testele de regresie: recepție `beneficiar` pe LOT 1 și producție `gazpet` pe proiectul 3 trec) |
| 13 — `din_stoc` pe transport | **Q-E2-1 = C**: fără trigger (calea nu atinge `magazie_bucati`); avertizare în UI-ul transportului pentru site-urile proiectelor cu nivel ≠ `off` |

### 2.5 Importul soldului inițial (funcție + preview, fără scriere până la „da”)
- **Preview local** (`scripts/izometrie/preview_e2_stoc.mjs`, `xlsx-js-style` deja instalat): citește cele două Exceluri, câte un mapping pe fiecare foaie (layout-ul diferit al „TEAVA 7.1 TOPLET”), produce JSON + raport.
  - **Reconcilierea obligatorie** (§6.3 E2): Topleț 7.1 = 1420 / 17 371,00 m (828 livrate / 10 120,02 m); 8,8 = 57; 6 m = 390; Jupânești 7.1 = 896 / 10 996,97 m (390 livrate); 8,8 = 184 / 2 288,80 m (168 livrate); curbe LOT 2 = 405. Cifrele nu bat → importul nu se propune.
  - **Excluderile**: 23 de placeholdere (4+1+6+10+2), rândul SBD, curbele altor loturi (Q-E2-3 = A: doar numărate în reconciliere ca „excluse — LOT 1: 3, LOT 3: 22”, fără listă de decizie); 2545CA (23) ca **conflict**, nu serie nouă.
  - **Depozitul** pe rând: Jupânești → JUP (9); Topleț → TOP (11), cu excepția grupurilor „DT/OS = ORSOVA” și a avizelor `CJPT-O` → **ORN (10)**, propuse pe grupuri și confirmate în preview.
  - **Starea**: livrate cu aviz CJPT/CJPJ + TR → `pe_tronson` pe `executie_tronsoane` 16–23 (montajul nu se presupune, E4c); în stoc → `receptionat` dacă există PV/NRCD, altfel `sosit`.
  - **Peretele** obligatoriu: din foaie (7,1 / 8,8) sau din descriere; la curbe din „CMFØ 610/{perete}/…”. Fără perete → rând de decis.
  - 0 coliziuni pe serie + șarjă + lungime (la cm) și pe curbe (serie + șarjă + unghi) — altfel lista merge la decizie.
- **Preview-ul e legat de sursă și e blocant** [R13]: fiecare rând poartă sha256-ul Excelului, foaia și rândul sursă; payload-ul de import conține sha256-urile, iar funcția le salvează în `izo_importuri`. Orice **2545CA nedecis, perete lipsă, depozit neclar sau coliziune** face preview-ul **neaplicabil** (nu doar avertisment): scriptul nu produce payload până la zero rânduri nedecise. Deciziile pe rânduri (excludere, corectare 2545CA → 254CA, grup Orșova) stau într-un fișier de decizii versionat, aplicat de script.
- **Aplicarea**: `fn_izo_import_sold_initial(p_proiect, p_import_id, p_payload jsonb)` (owner `izo_registru_writer`, EXECUTE doar `postgres`): calculează `payload_sha256`, apoi INSERT în `izo_importuri` `ON CONFLICT (proiect_id, import_id)` → **același hash: întoarce rezultatul anterior, fără efecte; alt hash: conflict, fără efecte** [R3]. Un eveniment `sold_initial`, bucățile, mișcările, într-o tranzacție. **O rulează sesiunea de chat, cu „da”-ul lui Razvan.**
- **Storno-ul importului e fail-closed** [R4]: `fn_izo_import_storno(p_proiect, p_import_id, p_motiv)` refuză dacă vreo bucată a importului are **orice eveniment ulterior** (ieșire, mutare, tăiere, montaj, inventar); altfel scrie evenimentul `storno` (bucățile → `anulata`) și marchează importul `stornat`. Fără inversare oarbă.
- **Activarea nivelului** `stoc` pe proiectul 3: prin `fn_izo_poate_activa`, cu 0 bucăți beneficiar, în aceeași tranzacție cu importul (§2.0).

### 2.6 Teste de acceptare E2a (pe branch, apoi pe producție înainte de activare)
Din §6.3 E2 + **testele negative cerute de review** (fiecare cu rezultatul așteptat scris dinainte):
- DML direct pe o bucată beneficiar a proiectului 3, **ca `authenticated` și ca `service_role`** → refuzat;
- funcție DEFINER deținută de `postgres`, **fără marcaj** pe tranzacție → refuzată;
- beneficiar ↔ gazpet și proiect LOT 2 ↔ LOT 1, în ambele sensuri → refuzate (garda OLD/NEW);
- `rezervata`/`consumata`/`carantina` pe beneficiar → refuzate;
- a doua rădăcină cu aceeași `serie_canon` → R1 (c); a doua frunză cu aceeași tripletă → R1 (d);
- **import concurent** cu același `import_id` (două sesiuni) → un singur efect; **același `import_id` cu payload diferit** → conflict, 0 efecte;
- **storno după un eveniment ulterior** pe o bucată → refuzat; storno fără evenimente ulterioare → bucățile `anulata`, re-importul trece;
- UPDATE / DELETE / TRUNCATE pe `magazie_bucati_evenimente` și `_miscari` → refuzate;
- DELETE din client pe `executie_tevi` LOT 2 → refuzat; linie de bon cu bucată beneficiar → refuzată;
- **regresie pozitivă**: producția `gazpet` pe proiectul 3 și recepția `beneficiar` pe LOT 1 trec neschimbate; Magazia (Stoc trasabil) afișează rândurile cu stări noi fără eroare;
- reconcilierea și excluderile, 0 coliziuni la curbe, perete pe fiecare rând, trei depozite (pe datele de preview).

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
6. **Q-E2-1 — DECIS FINAL (Razvan, 20.10): C — fără trigger în BD.** A („pe depozitele 9/10/11, după id”) nu se poate aplica: `logistica_transporturi` n-are depozit de plecare (doar `plecare_tip` + `plecare_site_id`), iar `din_stoc` mută doar stocul **cantitativ** (`stocuri`, după denumire, prin `fn_transfer_executa` din locația `('proiect', id)`) și **nu atinge `magazie_bucati`** — registrul de țeavă nu poate fi stricat pe această cale. Returul legitim de consumabile rămâne posibil; avizul intern de țeavă vine din modul în E7. **În UI**: la crearea unui transport cu plecare de pe site-ul unui proiect cu `fn_izo_nivel ≠ 'off'` (azi LOT 2, site 6) apare avertizarea „Țeava Transgaz iese doar din modulul de țeavă (Magazie → Țeavă proiecte)”. Variantele analizate inițial:
   - **A** (recomand; Copilot și Gemini aleg A): BD refuză liniile `din_stoc` pe transporturile care pleacă din **depozitele 9 / 10 / 11** (JUP / ORN / TOP), după id, nu după text; țeava de acolo iese doar prin `fn_izo_iesire`. Simplu și sigur; blochează și alte materiale cantitative din acele depozite (azi nu există stoc cantitativ acolo).
   - **B**: refuz doar pe liniile a căror denumire seamănă cu țeavă/curbă (listă de tipare). Mai permisiv, dar ghicește după text.
7. **Q-E2-2 — DECIS (Razvan, 20.10)**: tab nou „🧱 Țeavă proiecte” în Magazie, lângă „🔍 Stoc trasabil”.
8. **Q-E2-3 — DECIS (Razvan, 20.10): A.** Curbele LOT 1 (3) și LOT 3 (22) din fișierul LOT 2 nu se importă (LOT 1 e aproape închis și are materialele lui; LOT 3 nu e la Gazpet). În preview apar doar numărate, „excluse (LOT 1: 3, LOT 3: 22)”, pentru reconciliere.

## 4b. Livrarea efectivă a E2a (PR-ul migrării 20261102a)

- **În migrare**: rolul + granița (R7); `izo_proiect_config`, `izo_atribuiri`, `izo_importuri`, registrul (evenimente + mișcări, doar adaug), `izo_server_ver_seq`; extinderea `magazie_bucati` (coloane, CHECK-uri doar pe beneficiar, indexurile R1/R9); garda + RESTRICTIVE + politicile writer-ului; căile 3 (inclusiv **ștergerea pachetului**, găsită de harness: cascada pe țevi rula după dispariția pachetului) și 9; `fn_izo_seteaza_nivel` (activarea `stoc` refuză dacă proiectul are bucăți beneficiar în afara registrului), `fn_izo_import_sold_initial`, `fn_izo_import_storno`; ajutătoarele (inclusiv `fn_izo_uid`, pentru că writer-ul n-are drept pe schema `auth`).
- **Mutate din E2a** (nu sunt folosite de nimic în E2a; intră cu ecranele/fluxurile care le scriu, fiecare cu migrarea și testele ei): `teava_certificate*` → E3 (certificatul 3.1 la recepție); `izo_tronson_config` (executant, sens, perete proiectat) și `izo_surse_proiect` / `izo_ax_ancore` → E2b/E4b; `fn_izo_dezambiguare` → E2b (doar dacă preview-ul arată coliziuni reale; azi importul le refuză).
- **UI în E2a**: `STARE_META` din Magazie cu stările noi; filtrul din bonuri (bucățile beneficiar ale proiectelor protejate nu apar), tolerant la funcția încă neaplicată. Avertizarea de pe transport (Q-E2-1 = C) intră în E2b.
- **Preview-ul soldului inițial** (`scripts/izometrie/preview_e2_stoc.mjs`) vine în PR-ul următor (E2a-2), înainte de orice import; importul și activarea rămân pe decizia de dimineață a lui Razvan.
- **Harness**: `scripts/test_izometrie_e2a.sh` (PG16 local): 153 de verificări SQL (+ 20 pentru bonuri) + importul concurent + conexiune proaspătă / REPEATABLE READ / atribuire prin DEFINER din API + cursele cu barieră (ambele ordini, activare+import combinat, părinți, depozit șters) + refuzurile/revenirea. **Limită asumată**: în harness `postgres` e superuser, deci primitivele CREATE ROLE / ALTER OWNER / `pg_auth_members` pe Supabase se dovedesc doar pe branch (P1).

### 4c. Corecturi după review-ul PR #806 (Codex P1/P2, Copilot + Gemini A–E)

- **Garda strictă** (P1-1): `fn_izo_garda_scriitor` întoarce `false`, nu NULL, când marcajul lipsește (conexiune nouă); toate verificările folosesc `IS NOT TRUE`.
- **Protecție permanentă** (P1-2): un rând de registru (`tip_cod` setat) e protejat la orice nivel; „off” e refuzat după primul fapt (inclusiv stornat); un rând de registru nu poate sta pe un proiect off.
- **Lock pe proiect** (P1-3): `pg_advisory_xact_lock(73010, proiect)` — exclusiv în nivel / import / storno, partajat în garda pe bucăți, înainte de citirea nivelului; doar READ COMMITTED (REPEATABLE READ refuzat pe scrierile beneficiar și în funcțiile registrului).
- **Coloanele noi doar pe registru** (P1-4): CHECK `magazie_bucati_izo_doar_registru_check`; revenirea face preflight pe toate coloanele noi.
- **Activarea** (A, P2-5): 0 bucăți beneficiar pe proiect, oricare; porțile verificate la apel prin `fn_izo_porti_lipsa()` (19 triggere ENABLE ALWAYS, RLS, RESTRICTIVE, rol, ACL) — aceeași funcție e postcondiția 5.
- **Importul** (P2-6): payload validat fail-closed (cheie lipsă / null / tip greșit), surse cu fișier unic, fiecare rând trimite la o sursă declarată; `pe_tronson` = doar `tronson_id`, originea în `atribute.depozit_origine_id` (D, CHECK de loc exclusiv).
- **Citirea** (C, P2-8): `fn_izo_citire` = owner sau atribuire activă și valabilă azi pe ACEL proiect; accesul global prin modulul magazie/executie a fost scos. **DECIS (Razvan, 21.10.2026): A** — stocul de țeavă îl văd doar oamenii atribuiți proiectului (inginer, MP, gestionar, cu atribuire activă și valabilă) și owner-ul; modulul magazie/executie singur nu dă acces. Nu se mai propune lărgirea.
- **Reparentarea** (P2-9): țevi între pachete, pachete între proiecte/tronsoane, tronsoane între proiecte, depozit din registru pe alt site — refuzate dinspre/spre un proiect protejat. Atribuirile: fără DELETE/TRUNCATE, scrise doar de `postgres`.
- **Amprenta** extinsă: `proconfig`, volatilitatea, RLS/FORCE RLS, ACL-ul `magazie_bucati_id_seq`, parametrii secvențelor; secvența `magazie_bucati.id` numită explicit (precondiția 0g).
- **UI**: `StocTrasabilTab` paginat (registrul trece de 1000 de rânduri).
### 4d. Corecturi după review-ul r2 al PR #806 (Copilot NO-GO pe P1 nou, Codex r2, Gemini r2)

- **Protocolul de lock-uri** (Copilot P1, Codex P2-3/P2-6): peste tot ordinea e **rând → advisory**. Importul blochează FOR SHARE rândurile de loc (proiect, depozite, tronsoane) ÎNAINTE de lock-ul lui exclusiv pe proiect; mutările de depozit / tronson / site de proiect țin deja rândul (UPDATE) și apoi iau lock partajat pe proiectele OLD/NEW, crescător (`fn_izo_lock_partajat`). Căile vechi (DELETE / mutare țevi și pachete, garda bonurilor) iau și ele lock partajat + recitesc nivelul. Rândurile registrului se refuză în gardă fără lock (protecție permanentă), ca storno-ul (exclusiv, apoi FOR UPDATE pe bucăți) să nu se blocheze circular cu un UPDATE al clientului. Toate scrierile care ating registrul cer READ COMMITTED.
- **Citirea rândurilor registrului din `magazie_bucati`** (decizia A, 21.10): politica RESTRICTIVE `magbuc_izo_client_sel` — `tip_cod IS NULL OR fn_izo_citire(proiect_id)`; înainte, politica live `magbuc_sel USING (true)` lăsa orice utilizator autentificat să vadă bucățile din registru, chiar dacă evenimentele/importurile erau deja restrânse. Rândurile din afara registrului rămân vizibile ca azi. UI-ul (Țeavă proiecte) explică lista goală („fără atribuire pe proiect”).
- **Site-ul proiectului** (Codex P2-2): trigger nou `trg_proiecte_izo_site` — refuz cât proiectul are registru (editorul din Execuție îl putea schimba).
- **Pachetul** (Codex P2-5): protecția se decide pe AMBELE proiecte (al pachetului și al tronsonului, `fn_izo_proiecte_pachet`); concordanța proiect ↔ tronson e obligatorie la INSERT/UPDATE când vreunul are registru (pe live 0 neconcordanțe, 20.10).
- **Depozitul de origine** (Codex P2-7): **ales: referință protejată**, nu instantaneu — `fn_izo_depozit_in_registru` caută și în `atribute.depozit_origine_id`, deci un depozit care e doar origine nu-și mai poate schimba site-ul. Motiv: un singur adevăr (id-ul), fără nume/site copiate care pot diverge.
- **Porțile pe definiții** (Copilot P2, Codex P2-4): `fn_izo_porti_definitii()` = amprenta triggerelor (funcție, evenimente, coloane, stare), politicilor izo (comandă, tip, roluri, condiții), funcțiilor `fn_izo_*` (owner, DEFINER, search_path, corp, ACL), RLS + ACL pe tabelele protejate; valoarea de la migrare stă în COMMENT-ul funcției, `fn_izo_porti_lipsa` o compară. Verificarea rulează și la reapelul pe un proiect deja „stoc”. **Consecință asumată**: orice GRANT/REVOKE ulterior pe `magazie_bucati` sau orice funcție `fn_izo_*` nouă schimbă amprenta → activarea e refuzată până la o re-fixare deliberată (migrarea care o schimbă o re-fixează).
- **TRUNCATE** (Copilot P2): `magazie_bucati` — revocat de la service_role (îl avea pe live), postcondiție + poartă; revenirea îl redă.
- **Atribuirile** (Gemini P2): garda cere `session_user = postgres` ȘI `current_user = postgres` — o funcție DEFINER cu owner postgres chemată din API nu mai trece (harness 4c5).
- **Bonul de consum** (Codex P2-9): `src/lib/bonLinii.js` — bucățile din registru se verifică înainte de orice scriere; liniile noi se inserează și abia apoi se șterg cele vechi (după id); la un bon nou eșuat se șterge antetul. Testat cu un bon mixt.
- **Suprafața privilegiată** (Codex P2-8): `docs/izometrie/E2A_SUPRAFATA_PRIVILEGIATA.md` — doar evaluare.
- **Concurență** (Codex P3): harness-ul folosește o barieră reală (lock ținut de un controlor; B pornește doar după ce A e la barieră și e verificat că B așteaptă un lock), ambele ordini: activare↔recepție, dezactivare↔import, import↔storno, site depozit↔import, plus importul concurent. Paginarea din Magazie avansează cu rândurile primite efectiv și se oprește la o pagină goală (merge și sub limita API).
- **Notă P3** (Copilot): `pg_advisory_xact_lock(73010, proiect::integer)` — un id de proiect peste 2^31 dă eroare la cast (fail-closed); azi id-urile sunt mici.
- **Rămâne P1 (Codex)**: testul real pe un branch Supabase (PG17, roluri reale); amprenta revenirii se fixează pe țintă la dry-run, fără slăbirea listei.

### 4e. Corecturi după review-ul r3 al PR #806 (Copilot NO-GO P1 deadlock, Codex r3 NO-GO, Gemini GO)

- **Soldul inițial se aplică DOAR prin `fn_izo_activeaza_si_importa(proiect, import_id, payload, motiv)`** (Copilot P1, Codex P2-3): ia întâi rândurile de loc FOR SHARE (proiect, depozite, tronsoane, inclusiv originile), apoi lock-ul exclusiv, apoi activarea și importul — fără fereastră „off cu bucăți” și fără blocaj circular. `fn_izo_import_sold_initial` refuză dacă tranzacția ține deja lock-ul pe proiect în afara funcției combinate (ex. `seteaza_nivel` + import pe căi separate). Testat cu barieră, ambele ordini (harness 4e) + T12a.
- **Concordanța pachetelor la activare** (Copilot P2): activarea refuză dacă proiectul are pachete neconcordante (create cât ambele proiecte erau off).
- **Ajutătoarele interne** (Copilot P2, Codex P1-a): lock-ul partajat și lookup-urile (pachet / tronson / site / bucată / depozit) nu mai sunt executabile din API; gărzile căilor vechi sunt `SECURITY DEFINER` (owner postgres), garda pe bucăți ia lock-ul direct. `fn_izo_bucata_proiect` nu mai dezvăluie asocierea bucată–proiect.
- **READ COMMITTED** (Copilot P2): cerut doar când e implicat un proiect (bonul cu bucată gazpet în REPEATABLE READ trece — harness 4c). Pentru un proiect „off” se cere în continuare: o verificare „e protejat?” pe snapshot-ul vechi ar redeschide fereastra pe care o închide lock-ul.
- **Părinții blocați** (Codex P2-6): pachetul / tronsonul / bucata sunt luate FOR SHARE înainte de citirea relației; ierarhia lock-urilor e copil → părinte → advisory. Cursa „A mută pachetul + activează proiectul nou / B șterge o țeavă” → B așteaptă și refuză (harness 4g).
- **Depozitul de origine** (Codex P2-4): protejat și la DELETE și la schimbarea id-ului (nu doar a site-ului); testat secvențial (T7t/T7u) și concurent cu importul (harness 4f).
- **Căile vechi** (Codex P2-7): tronsoanele unui proiect cu registru nu se șterg; TRUNCATE pe `executie_tevi` / `executie_pachete_lansare` refuzat cât un pachet ține de un proiect cu registru (service_role are TRUNCATE pe live). 22 de triggere izo, toate ENABLE ALWAYS.
- **Bonul** (Codex P2-5): verificarea registrului înaintea oricărei scrieri (inclusiv antetul), antetul cu control de versiune (`updated_at`), liniile vechi recitite din BD la fiecare salvare (retry fără duplicate), ștergerea care afectează alt număr de rânduri = conflict. **Rămâne de decis de Razvan**: o salvare tranzacțională reală cere un RPC nou pe bonuri (schemă / RPC = cu „da”).
- **Porțile** (Codex P3-10): verifică și drepturile writer-ului pe tabele și secvențe; amprenta definițiilor include ACL-ul secvențelor.
- **Contractul de lock-uri** (Codex P3-9): sortarea e per apel, nu pe toată tranzacția; un blocaj circular rămas e detectat de PostgreSQL și anulează una dintre tranzacții (fail-closed, fără stare parțială) — operațiile se reiau. Nu promitem absența oricărui deadlock în compuneri arbitrare.
- **Citirea pe `magazie_bucati`** (Codex P1-a): închisă din r2 (`magbuc_izo_client_sel`); testele acoperă modul fără atribuire, atribuire expirată / viitoare și atribuire pe alt proiect.

### 4f. Corecturi după review-ul r4 al PR #806 (Copilot NO-GO 2×P1, Codex NO-GO, Gemini GO)

- **Bon ↔ storno** (Copilot P1-a, Codex 4): bucata deja protejată se refuză pe bon FĂRĂ lock; lock-ul (bucata FOR SHARE + advisory partajat) rămâne doar pentru beneficiarul încă în afara registrului. Harness 4h: storno ținut la barieră, bonul e refuzat imediat (nu așteaptă).
- **TRUNCATE ↔ activare** (Copilot P1-b): garda TRUNCATE ia lock partajat pe toate proiectele cu pachete, apoi recitește nivelul. Harness 6-pre (baza curată): activarea la barieră, TRUNCATE așteaptă și e refuzat.
- **Funcția combinată** (Codex 5): refuză dacă tranzacția ține deja lock-ul pe proiect (T12d).
- **Drepturile writer-ului** (Codex 8): verificate câte un privilegiu (`has_table_privilege(…, 'A,B')` = ORICARE); T12e. Amprenta porților include acum și CHECK-urile / FK-urile, indexurile și ownerii.
- **Retry-ul bonului** (Codex 2): versiunea nouă a antetului intră în modal după salvarea lui.
- **Limite documentate** (Codex 3/9/10): (a) ~~salvarea bonului nu e tranzacțională~~ → închis în §4g (RPC 20261102b); (b) ~~paginarea cu offset~~ → închis în §4g (keyset); (c) revenirea scoate DOAR o instalare fără date — după primul fapt, ieșirea e storno + export + decizie, nu revenire; (d) `server_ver` (E6).
- **Rămâne P1 (Codex 1)**: testul pe branch Supabase PG17 — `create_branch` din sesiune întoarce „cancelled” (confirmarea de cost nu ajunge la Razvan); branch-ul se creează din dashboard.

### 4g. r6 (Codex r5) + salvarea tranzacțională a bonurilor (decizia Razvan 21.10.2026)

- **#806b (decuplat din #806, decizia Razvan 21.10.2026):** acest branch (`izometrie/e2-bon`, stivuit pe `izometrie/e2`) aduce înapoi bonul RPC; r12–r13 adaugă garda antetului (trg_bonc_antet_garda: direct, doar anularea; crearea / editarea / preluarea doar prin RPC-uri), REVOKE DML pe linii și pentru service_role, postcondiția 4 (DEFINER care scriu pe linii, DEFINER dinamice nerevizuite, view-uri peste linii fără invoker) și refuzul preluării unui bon fără linii. Merge DOAR după #806 și după apply 20261102b.
- **Bonurile — migrarea separată `20261102b_bon_salvare_tranzactionala`** (revenire: `supabase/revenire/20261102b_…_ROLLBACK.sql`): `public.fn_bon_salveaza(p_bon_id, p_versiune, p_antet, p_linii)` și `public.fn_bon_preia(p_bon_id, p_versiune, p_costuri)` — **SECURITY DEFINER** (owner postgres; verifică explicit ce verificau politicile live: `auth.uid() IS NOT NULL`), search_path fix, EXECUTE pentru authenticated / service_role (nu anon). Liniile sunt închise pentru API (REVOKE de la anon / authenticated / service_role), iar antetul e păzit de `trg_bonc_antet_garda` (direct, doar anularea). Într-o tranzacție: antetul FOR UPDATE (antet întâi) → CAS pe `updated_at` → antet → liniile vechi șterse → cele noi (în ordinea trimisă). Bon nou: **numărul îl alocă serverul** (max+1 pe proiect și an, sub lock), iar idempotența creării vine din `cheie_operatie` (uuid generat o dată în client la deschiderea formularului). Retry după răspuns pierdut (aceeași cheie / aceeași versiune, același conținut) → același rezultat, fără dubluri; alt conținut → eroare / „modificat între timp” (40001). Gărzile E2a pe linii se aplică la fel (bucata din registru refuzată, atomic). UI-ul (ConsumuriBonuriTab) face UN apel; limita „bon netranzacțional” din §4f e închisă. Harness 4i: 15 verificări SQL + două salvări concurente pe aceeași versiune (una câștigă, cealaltă „modificat”) + revenire.
- **TRUNCATE pachete ↔ activare** (Codex r5 P2 nou): ordinea comună „tabel → advisory” — lock-ul exclusiv pe proiect ia întâi ACCESS SHARE pe pachete / țevi / tronsoane / bucăți (`fn_izo_blocheaza_tabele`, DEFINER, intern). Harness 6-pre2: tabelul ținut ca de un TRUNCATE la barieră → activarea așteaptă tabelul FĂRĂ advisory ținut, apoi trece.
- **Amprenta porților** (Codex r5 8): + FK-urile noi ale `magazie_bucati` (parinte, rădăcină, depozit, tronson); T12g (FK slăbit) / T12h (CHECK scos) → activarea refuzată.
- **Wrapper-e** (Codex r5 6): porțile refuză dacă o funcție din afara writer-ului sau un view / o regulă cheamă funcțiile registrului (T12i). Entrypoint-urile rămân acordate doar lui postgres (aplicarea de chat).
- **Paginarea** (Codex r5 9): pe cheie (id), nu pe offset — orice rând existent pe toată durata încărcării apare exact o dată.

### 4h. r7 (Jakarinos r6 N1–N3, Copilot r6 a–c, review #807 r3 → carantina)

- **Carantina**: stare beneficiar nouă `carantina` (CHECK + import în depozit) — neconformele 58/596 nu mai sunt stoc disponibil (decizia MP 21.10).
- **Bonuri — creare idempotentă pe operație** (N1): coloana `cheie_operatie` (uuid, UNIQUE parțial), generată o dată în client la deschiderea formularului; numărul se ALOCĂ pe server, atomic (max+1 pe proiect și an, sub lock); `UNIQUE (proiect_id, numar_bon)` în BD (Copilot b) — o creare din afara RPC-ului nu poate dubla numărul. Două ferestre identice → două bonuri; retry-ul aceleiași operații → același bon.
- **Bonuri — comparația de idempotență** (N2): antetul se blochează FOR SHARE înaintea citirilor de comparație (retry creare și retry editare). Harness 4i: editare ținută la barieră, retry-ul creării așteaptă antetul și refuză („alt conținut”), fără amestec.
- **Bonuri — politicile** (Copilot a): precondiția 0d2 cere politicile exacte de pe live (SELECT USING true ⇒ nicio linie ascunsă la numărarea celor șterse).
- **Registru — sesiune postgres directă** (N3): toate intrările writer-ului refuză `session_user ≠ postgres` (un wrapper DEFINER chemat din API nu trece — harness 4c5). Poarta wrapper-elor e insensibilă la majuscule (T12i2) și e doar plasă de siguranță peste **allowlist-ul ACL** (Copilot c): EXECUTE pe intrările writer-ului doar pentru owner și postgres (T12k).

- **Rămas pentru E6 (notă P3)**: `server_ver` vine din `nextval`, deci e unic dar nu ordonat la commit — două tranzacții concurente pot comite în ordine inversă numerelor. Delta-sync-ul din E6 nu se poate baza pe „> ultimul văzut” fără o fereastră de siguranță sau un marcaj la commit; se decide acolo.

## 5. Review-ul planului (Copilot + Gemini, GO cu condiții) → unde e integrat

| # | Condiția | Unde |
|---|---|---|
| R1 | Unicitate pe identitatea rădăcinii (`serie_canon`); `dezambiguare` doar prin decizie auditată | §2.3 indexuri + `fn_izo_dezambiguare` |
| R2 | Cheia curbelor cu `bend_no` | **design v2.3 [K#9] păstrat, reconfirmat de Copilot (GO)**: cheie (`serie_canon`, `sarja`, `unghi_curba`, `cod_bucata`); `bend_no = NULL` la import, completat doar din sursă verificabilă; coliziunile NU extind cheia automat, se decid explicit (dezambiguare auditată sau `bend_no` dovedit) — §2.3 |
| R3 | Idempotență în BD: UNIQUE (`proiect_id`, `import_id`) + `payload_sha256` | §2.2 `izo_importuri`, §2.5 |
| R4 | Storno fail-closed dacă există evenimente ulterioare | §2.5 `fn_izo_import_storno` |
| R5 | `eveniment_id` FK; eveniment + mișcări + stare într-o tranzacție | §2.2 |
| R6 | Ordinea schemă → test → activare cu 0 bucăți → import | §2.0 |
| R7 | Fără BYPASSRLS; GRANT + politici `TO` writer; doar `postgres` membru; writer fără tabele/secvențe/schema; DEFINER cu `search_path`, schema-qualified, fără SQL dinamic; fără `ALTER DEFAULT PRIVILEGES` global | §2.1 |
| R8 | Magazia nu se strică între E2a și E2b; preflight pe rândurile `gazpet`; indexuri strict parțiale | §2.3 |
| R9 | Indexurile exclud `anulata` (și `taiata` la frunze) | §2.3 |
| R10 | `radacina_id = id` la rădăcină | §2.3 (`nextval` explicit + CHECK) |
| R11 | `tip_cod` nu e coloană generată din alt tabel | §2.3 (copie controlată + trigger de coerență) |
| R12 | `server_ver` = secvență globală monotonă | §2.2 |
| R13 | Preview legat de sha256 + foaie + rând; 2545CA / perete / depozit / coliziune = neaplicabil | §2.5 |
| T | Testele negative obligatorii | §2.6 |
| N1 | `esantioneaza`: limită de eșantioane pentru segmente patologic de lungi; `pas_m = max(0.5, min(toleranta_m, 5))` (note P2/P3 din #803) | intră în PR-ul E2a (`src/lib/izoKml.js`) |
