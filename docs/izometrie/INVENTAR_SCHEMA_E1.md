# Izometrie E1 — inventarul schemei live (§6.1)

- **Data**: 20.10.2026, seara. Proiect Supabase `dxczwkbciseqniprspcu`, PostgreSQL **17.6**.
- **Metodă**: doar SELECT pe catalog (`pg_class`, `pg_policies`, `pg_proc`, `pg_trigger`, `pg_default_acl`, `information_schema`) și pe date. **Nicio scriere, niciun drept, nicio migrare.**
- **Design de referință**: `IZOMETRIE_DESIGN_v2.md` v2.3 + deciziile `claude_context` #1788–#1790.
- **Cum se citește**: fiecare punct ?live din design are aici rezultatul. ⚠ = diferență față de design, de care trebuie ținut cont în E2+.

## Rezumat — ce schimbă inventarul în design

| # | Constatare | Consecință |
|---|---|---|
| 1 | ⚠ Tabelul pachetelor e **`executie_pachete_lansare`**, nu `executie_pachete`. Triggerele și funcțiile existente lucrează pe el. | Toate referințele din design la `executie_pachete` → `executie_pachete_lansare` (căile 4, 5, 21, E4a, E8). |
| 2 | ⚠ `executie_tevi` **nu are** `magazie_bucata_id` și nici `sudura_id`. Legătura existentă e inversă: `magazie_bucati.executie_teava_id` (FK, 0 rânduri folosite). | §1.14 „Legăturile: `magazie_bucata_id` și `sudura_id`” = coloane NOI în E4a/E4b. `executie_teava_id` se poate scoate (0 consumatori în date). |
| 3 | ⚠ `executie_pachete_exports` **există live** (coloane `snapshot_jsonb`, `fisier_path`, …), 0 rânduri, RLS deschis oricărui cont logat. | X6 spunea „doar în fixture”. Dovada folosită rămâne `executie_pachete_documente` (14 rânduri); exports = gol, de strâns sau de folosit pentru instantaneul din E8. |
| 4 | ⚠ `magazie_bucati.locatie_tip` acceptă doar `sediu` / `proiect`. | E2 extinde CHECK-ul și adaugă `depozit_id` + `tronson_id` (designul presupunea că „depozit” există). |
| 5 | ⚠ **LOT 2 n-are niciun depozit** în `logistica_depozite` (site 6). | Cele 3 depozite sunt propuse în preview (`E1_APPLY_PROPUS.sql` 3b). |
| 6 | **LOT 2 nu folosește modulul Izometrie vechi**: proiectul 3 are 0 pachete, 0 țevi, 0 documente. | **Q14 se închide**: E4a nu îngheață lucru real pe LOT 2. |
| 7 | Dirigintele pe proiectul 3 e deja **„Adrian Somesan”** (setat azi de chat). | §6.1 p16 rezolvat; nu mai e precondiție pentru E5. |
| 8 | ⚠ `avize_cjp` există cu **0 rânduri**, fără tabel de linii (articolele stau în `articole jsonb`); are deja `nr_complet` și `depozit_id`. | E7: tabelul e curat, dar liniile ar trebui normalizate (`avize_cjp_linii` din design nu există). |
| 9 | ⚠ Valorile LOT 1 din BD (T1 = 0+050, T7 = 24+100) **vin din pachete reale** (observații: `_00068 rev.1`, prima sudură T7S1 în `_00033`). | Q18 nu e „greșeală în BD”: e diferența dintre limita din PT și începutul real al execuției. Decizia rămâne la Razvan (preview). |
| 10 | Liniile de transport `din_stoc` identifică materialul **doar după text** (`denumire`); stocul cantitativ (`stocuri`) e pe `material_denumire`. | Interdicția din E2 (calea 13) nu se poate face „după categoria materialului”: se face pe depozitele LOT 2 + o listă de denumiri, sau pe o coloană nouă. De decis la E2. |
| 11 | **Default ACL**: tabelele create de `postgres` în `public` primesc automat `arwdxt` pentru `anon` și `authenticated`; secvențele, `rwU`. | Fiecare tabel / secvență izo nouă are nevoie de `REVOKE` explicit (designul îl cerea deja, aici e confirmat). Funcțiile noi nu primesc EXECUTE implicit pentru `anon`/`authenticated` (bine). |
| 12 | **Garda pe un branch Supabase (p10): NETESTATĂ.** `create_branch` a fost refuzat de clasificatorul de permisiuni al sesiunii („Modify Shared Resources”). | Rămâne test obligatoriu înainte de E2. Cere „da branch” scris direct în sesiunea Izometrie sau o regulă de permisiune. |

## 1. `magazie_bucati`

- **Coloane** (35): `id`, `proiect_id`, `comanda_furnizor_id`, `tip_material_id` (NOT NULL), `serie`, `sarja`, `dimensiune`, `grad_otel`, `standard`, `lungime_m`, `lungime_originala_m`, `greutate_kg`, `unghi_curba` (numeric), `cantitate` (def. 1), `um` (def. `buc`), `provenienta` (def. `gazpet`), `izolatie` (def. `neizolata`), `furnizor`, `producator`, `sursa_receptie` (def. `packing_list`), `fara_packing_list`, `nr_document`, `data_receptie`, `mtc_path`, `stare` (def. `sosit`), `locatie_tip` (def. `sediu`), `locatie_site_id`, `executie_teava_id`, `atribute` jsonb, `observatii`, `receptionat_de/la`, `created_by/at`, `updated_at`. Coincid cu ce scrie `ReceptieBucatiModal`; nu există `tip`, `perete_mm`, `depozit_id`, `tronson_id`.
- **CHECK-uri**: `stare` ∈ {sosit, receptionat, rezervata, montata, consumata, retur}; `locatie_tip` ∈ {sediu, proiect} ⚠; `provenienta` ∈ {beneficiar, gazpet}; `izolatie` ∈ {neizolata, PEHD, GRP} (⚠ „HDPE B3” de pe avize LOT 2 trebuie mapat pe `PEHD` sau CHECK-ul extins); `sursa_receptie` ∈ {packing_list, aviz, mtc, manual}.
- **FK**: `proiect_id` → `executie_proiecte`, `tip_material_id` → `magazie_tipuri_material`, `comanda_furnizor_id`, `executie_teava_id` → `executie_tevi`.
- **Indexuri**: pkey + proiect, comandă, tip, stare, serie, `executie_teava_id`. Niciun UNIQUE pe serie.
- **Triggere**: **niciunul**.
- **RLS**: activ. Politici PERMISSIVE pentru `authenticated`: SELECT `true`; INSERT/UPDATE/DELETE `auth.uid() IS NOT NULL`. Nicio politică restrictivă.
- **Date**: **18 rânduri, toate `gazpet`, toate `sosit`** (proiectele 1, 10, 15, 17, 24). Zero `beneficiar`. `executie_teava_id` folosit de 0 rânduri.
- **Tipuri de material** (`magazie_tipuri_material`, cheie `cheie`): 1 țeavă conductă (`teava`), 2 tub protecție, **3 curbă (`curba`, `are_unghi`)**, 4–8 fitinguri, 11 robinet, 14 godevil… → `tip_cod` din E2 se derivă din `cheie` (`teava` / `curba` / restul `alt`).

## 2. Corpurile funcțiilor

| Funcție | Ce face azi | Pentru design |
|---|---|---|
| `fn_executie_check_serie_unica` (trigger BEFORE INSERT / UPDATE OF `serie_unica` pe `executie_tevi`) | Σ lungimilor cu aceeași serie în proiect ≤ `lungime_originala_m` × 1,005; dacă `lungime_originala_m` lipsește, lasă tot („relax mode”). Pe `executie_pachete_lansare`. | Confirmat: nu pornește la UPDATE pe lungimi, toleranța e 0,5 %, nu 20 mm. Extinderea din E8 rămâne necesară. |
| `fn_executie_check_sudura_unica` (BEFORE INSERT / UPDATE OF `sudura_cod`) | Refuză același `sudura_cod` de două ori pe tronson. | Lucrează pe textul codului, nu pe identitatea normalizată → în E4b, pe LOT 2, trece pe (tronson, nr, sufix). |
| `fn_ep_auto_mp` (trigger pe proiecte) | Dacă `mp_employee_id` e gol și site-ul are **exact un** `manager_santier`, alege angajatul cu numele cel mai asemănător (`similarity > 0.45`). | Confirmă §5.6: alegere automată după nume. Recomandarea rămâne (fix separat). |
| `fn_get_next_nr_aviz(p_serie)` | Creează seria dacă lipsește și întoarce `last_nr + 1`. EXECUTE doar `postgres`, `service_role`. | OK pentru apel intern din funcțiile E5/E7. |
| `fn_executie_pachete_acces(p_scriere)` | Owner sau intrare în `user_module_access` cu `executie` (scriere) / `executie`, `ctc` (citire). **Ignoră `access_level`.** | Confirmat (v1, nereverificat → acum verificat). |
| `fn_transfer_executa` | Transfer cantitativ după `lower(material_denumire)` din `stocuri`, scrie `transferuri_*` + `stocuri_miscari`. | Calea 13: țeava beneficiar nu trebuie să treacă pe aici (vezi punctul 13). |
| `fn_consum_executa` | Consum cantitativ după denumire; cere `is_owner` sau `can_manage_stoc`; **nu atinge `magazie_bucati`**. | Calea 9 privește doar `executie_bonuri_consum_linii` (vezi punctul 9). |

## 3. `avize_cjp` și `avize_serii_counter`

- **`avize_cjp`**: 0 rânduri. Coloane: `serie`, `nr`, `data`, `transport_id`, puncte de lucru, `tronson` (text), delegat, `articole` jsonb, totaluri (masă, ml, bucăți), `status`, `pdf_path`, `nr_complet`, `depozit_id`. Politică `ALL` pentru orice cont logat. Fără tabel de linii, fără vederi sau funcții care îl folosesc.
- **`avize_serii_counter`** (`serie`, `last_nr`): 8 serii `GAZ/TR/INTERN/{BAL,CAL,ONE,ORS,SED,SIS,TIF,TIG}`, toate cu `last_nr = 0`. ⚠ `ORS` există fără depozit corespunzător. Politici: SELECT `true`, **UPDATE pentru orice cont logat** → confirmă strângerea din E5 (altfel cineva poate pune `last_nr = 0`).

## 4. `executie_alerte_ai`

Există: 210 rânduri, ultima modificare **03.06.2026** (scrierea s-a oprit de atunci). Coloane: `proiect_id`, `nas_doc_id_hash`, `tip_alerta`, `mesaj`, `severitate`, `detalii`, `activa`, `confirmata_de/la`. Scriere permisă owner / `superadmin` / `manager_santier`; folosit de vederea `v_executie_alerte_count`. Modulul izo **nu scrie aici** (panou propriu).

## 5. Politici: notificări, arhiva de avize, bucket-uri

- **`notifications`**: SELECT / UPDATE / DELETE pe rândurile proprii sau owner; **INSERT pentru orice cont logat** (confirmă §5.6). Trigger `trg_notificari_ruteaza_ofertare` (BEFORE INSERT).
- **`logistica_avize_arhiva`**: SELECT `true`; INSERT / UPDATE / **DELETE pentru orice cont logat** (confirmă §5.6 și calea 15).
- **Bucket `avize`** (privat): INSERT și SELECT pentru `authenticated`; **nicio politică UPDATE / DELETE** (deci nimeni nu poate șterge din client). Căi: `AAAA-LL/AVZ-AAAA-NNNN_<ts>.pdf`.
- **Bucket `executie-pachete-pdf`** (privat): toate operațiile prin `fn_executie_pachete_acces` (scriere = UPDATE și DELETE permise). Căi: **`<pachet_id>/<AAAA-LL-ZZ>_<aleator>_<nume>`** → politica restrictivă din calea 8 se poate scrie pe primul segment (pachet → tronson → proiect).
- **`executie_pachete_lansare` / `_documente`**: prin `fn_executie_pachete_acces` (20261029a). **`executie_tevi`, `executie_tronsoane`**: `ALL` pentru orice cont logat, SELECT `true` → căile 1, 3, 21 sunt deschise azi, cum spunea designul.

## 6. Default ACL și versiunea

- PG **17.6** → `NULLS NOT DISTINCT` disponibil.
- `public`, obiecte create de `postgres`: tabele → `anon=arwdxt`, `authenticated=arwdxt`; secvențe → `anon=rwU`, `authenticated=rwU`; funcții → doar `postgres`, `service_role`. (Obiectele create de `supabase_admin` dau tot, inclusiv TRUNCATE.)
- Consecință: în migrările E2 fiecare tabel și fiecare secvență izo primește `REVOKE ALL … FROM anon, authenticated` explicit, apoi doar GRANT-urile din matrice.

## 7. Proiectele 1 și 3

| | Proiect 1 (LOT 1) | Proiect 3 (LOT 2) |
|---|---|---|
| Nume | Lot 1 – Conductă … Prunișor – Orșova – Băile Herculane – Jupa | LOT 2 Orșova – Prunișor – Jupa – Transgaz |
| Site | 4 („Gazpet – Orsova Lot 1”) | 6 („Gazpet LOT 2 Orsova”) |
| MP | 117 (Toma Razvan Alin) | 117 |
| Diriginte (`coordonator_transgaz`) | Adrian Somesan | **Adrian Somesan** (corectat azi) |
| Tronsoane | 11 (T1–T11, toate „neinceput”) | **0** |
| Pachete / țevi / documente | 6 pachete, 375 țevi | **0 / 0 / 0** |
| Depozite (`logistica_depozite`) | Balvanești (BAL), Sisești (SIS) | **niciunul** |

`executie_tronsoane`: UNIQUE (`proiect_id`, `cod`); `status` CHECK; `ordine` implicit 0 (pe LOT 1 toate 0); trigger doar `updated_at`. `logistica_depozite`: UNIQUE `cod_3litere` (exact 3 caractere), FK `site_id`.

## 8. Accesul

- În `user_module_access` **nu există nicio sub-cheie** `executie.*` sau `magazie.*`: `executie` 1 admin + 14 editor, `ctc` 2 admin + 11 editor, `magazie` 1 admin + 15 editor.
- Pentru cei trei oameni (Titi Jeno, Toma Razvan Alin, Cioc Janeta) rămân valabile datele din §5.1b (citite pe 20.10). **Nu am acordat nimic.**
- Cheia nouă `executie.izometrie` (E4b) va fi prima sub-cheie a Execuției → filtrarea taburilor (calea 17) trebuie făcută odată cu ea.

## 9. Bonurile de consum

- Liniile sunt în **`executie_bonuri_consum_linii`** (cu `magazie_bucata_id` → `magazie_bucati`), 0 rânduri. UI-ul (`src/ConsumuriBonuriTab.jsx:102`) propune bucăți `sosit` / `receptionat` de orice proveniență.
- Nicio funcție și niciun trigger nu scad stocul de bucăți din bon (doar notificare la INSERT pe antet). `consumuri_proiect_linii` e alt flux, cantitativ, după denumire.
- Calea 9 din E2: trigger pe `executie_bonuri_consum_linii` care refuză o bucată `beneficiar` a unui proiect cu nivel ≥ `stoc` + filtru în UI.

## 10. Garda pe branch Supabase — **NETESTAT**

`list_branches` = niciun branch. Prima cerere `create_branch` a căzut cu „Invalid or expired requestState”. După „da branch”-ul lui Razvan (transmis de chat), a doua cerere a fost **refuzată de clasificatorul de permisiuni al sesiunii** („Modify Shared Resources”). Nu am ocolit refuzul și nu am cerut altei sesiuni să creeze branch-ul.
**Ce rămâne**: cele 4 primitive (CREATE ROLE NOLOGIN NOINHERIT + criteriul SET/INHERIT; ALTER FUNCTION … OWNER; GRANT-uri și politici `TO` rol, inclusiv `storage.objects`; marcajul pe tranzacție în garda INVOKER) + testul negativ. **E2 nu pornește fără acest test.**

## 11. `auth-js` offline

Netestat în E1 (test în browser, aparține E6).

## 12. Recalculul `poz_km_m`

**Există**: triggere de instrucțiune pe `executie_tevi` (AFTER INSERT / UPDATE / DELETE → `fn_executie_recalc_poz_km(pachet)`), plus `trg_executie_pachete_recalc_poz_km` la schimbarea `km_start_m` pe pachet. Comentariul „TODO” din `src/Izometrie.jsx:609` e depășit.

## 13. Transportul: liniile `din_stoc`

`logistica_transporturi_continut` (`transport_id`, `tip`, `active_id`, `denumire`, `cantitate`, `unitate_masura`, `din_stoc`, …): 99 de linii `din_stoc = true`. Materialul se recunoaște **doar după `denumire`**; nu există legătură cu proiectul, cu proveniența sau cu un tip de material. Triggere: doar numărul transportului. → Interdicția din E2 trebuie definită pe altceva decât categoria (propunere la E2).

## 14. Decizia #1787

Citită: OCR local întâi; AI plătit doar la eșec, pe document, pornit de un om; datele extrase intră doar după confirmare umană. Designul §2.12 e aliniat.

## 15. Executantul

- `executie_tura_subcontractori`: id 14 = PETROCONST, proiect 3 / site 6, 17.08–27.08.2026, „Sudura obiecte speciale TR16/TR17”, `contract_id` NULL; pe LOT 1: SUBTRANSCON (id 6, subtraversări), ROMINSTA (id 15, „TR10”).
- `contracte_terti` id 76: PETROCONST S.A., nr. 390 / 25.05.2026, „Montaj conducta DN600 Jupa LOT 2”, 6.070.726 lei, activ, `site_id` și `santiere_ids` NULL.
- Propunerea pentru `izo_tronson_config.executant` (scrisă la E2, cu „da”): T16, T17 = Petroconst (contract 76); restul Gazpet.

## 16. Dirigintele

`executie_proiecte.coordonator_transgaz` = „Adrian Somesan” pe ambele proiecte. Rezolvat.

## 17. Peretele (`perete_mm`)

`magazie_bucati` n-are coloană de perete; `dimensiune` e text liber. Pentru LOT 2, la import (E2): din numele foii („TEAVA 7.1 TOPLET”, „8,8 TOPLET”, „TEAVA 7.1 MM”, „TEAVA 8.8 MM”, „7.1 X 6ML”) și din descriere („ø 610 x 7.1 mm”); la curbe din descriere („CMFØ 610/8/L360NE/6,1 - 20˚”, pereți 8 / 8,8 / 10 / 12,5). Un rând fără perete clar rămâne de decis.

---

## Ce urmează: E2 (registrul + stocul LOT 2, nivel `stoc`)

1. **Precondiții** (de la Razvan, prin chat): testul gărzii pe branch (p10) cu permisiunea dată în sesiunea Izometrie; apply-ul din E1 (tronsoane LOT 2, cele 3 depozite; LOT 1 după Q18); activarea contului Cioc Janeta.
2. **Migrarea E2** (draft + revenire în `supabase/revenire/`, livrată de chat prin `livrare_migrare.sh`, doar cu „da”):
   - `magazie_bucati`: coloanele noi din §1.2 (`tip_cod`, `uid`, `parinte_id`, `radacina_id`, `cod_bucata`, capete, `serie_canon`, `dezambiguare`, lungimi în mm, `lungime_cm`, `perete_mm`, `diametru_mm`, `lot`, `aviz_intrare_id`, `nr_crt_aviz`, `depozit_id`, `tronson_id`, `certificat_id`, `server_ver`); CHECK-urile `stare` și `locatie_tip` extinse doar pentru `beneficiar`; maparea „HDPE B3” → `izolatie`.
   - `magazie_bucati_evenimente` + `_miscari` (doar adaug), `izo_proiect_config`, `izo_tronson_config`, `izo_atribuiri`, `izo_surse_proiect`, `izo_ax_ancore`; rolul `izo_registru_writer`, `fn_izo_nivel`, `fn_izo_acces`, garda OLD/NEW, politicile RESTRICTIVE; REVOKE explicit (punctul 6).
   - căile 3, 9 (trigger pe `executie_bonuri_consum_linii`), 10, 11, 12 și interdicția `din_stoc` (punctul 13, regula de recunoaștere de decis).
   - indexurile UNIQUE (serie + șarjă + lungime la cm, curbele) **după** preview-ul cu 0 coliziuni.
3. **Importul stocului LOT 2 cu preview**: parser pe foi (layout-ul diferit al „TEAVA 7.1 TOPLET”), reconcilierea cu cifrele din §6.3 E2, excluderile (23 de placeholdere, SBD, curbe LOT 1/3), 2545CA ca conflict, separarea Orșova Nord (avize CJPT-O / DT-OS = ORSOVA) pe grupuri confirmate. Preview-ul se face din fișierele Excel, fără scriere.
4. **UI** (decizia Razvan, 20.10): Magazie → Stocuri → „Țeavă proiecte” (stoc pe proiect, depozit, tip, stare), plus vederea doar-citire în Execuție → Izometrie, din aceeași sursă.
