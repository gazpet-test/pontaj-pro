# Agentul verificator — faza 1: semnalele în ERP (migrarea 20270106a, NEAPLICATĂ)

Decizia de design: Tema 1 din dezbaterea cu Jakarinos („bun cu schimbări”). Agentul de noapte (serverul AI) verifică proiectele din Execuție
și scrie DOAR semnale; oamenii le văd și acționează. Faza 1 = infrastructura din ERP (tabel, drepturi, RPC-uri, ecran). Regulile de verificare
(ce document dovedește ce obligație, pragurile) le scrie coordonatorul separat, cu validarea responsabilului operațional; pilot: un proiect
Transgaz cu ordin de începere, apoi încă unul. Agentul NU atașează documente și NU scrie în alte tabele: are EXECUTE doar pe `fn_executie_semnal_scrie`.

## Ce e un semnal
Un rând în `executie_semnale`, unic pe **(proiect, tip, obiect)** — aceeași problemă actualizează semnalul, nu creează altul.

| câmp | ce înseamnă |
|---|---|
| `flux` | `lipsuri` / `tichete` / `corespondenta` (cele trei execuții izolate ale agentului) |
| `tip` | cod stabil, `^[a-z][a-z0-9_]{1,59}$` (ex. `termen_apropiat`, `document_negasit`, `camp_lipsa_erp`, `polita_expira`); un tip stă pe un singur flux |
| `obiect` | ce anume (ex. `contract:termen`, `polita:GBE`, `camp:nr_contract`) |
| `gravitate` | `info` / `atentie` / `critic` |
| `titlu`, `detalii` | pentru om |
| `constatare` | `constatat` (cu dovadă) · `negasit_in_surse` (documentul NU a fost găsit în sursele consultate — NU înseamnă că lipsește; `surse_consultate` obligatorie) · `camp_lipsa` (câmp gol în ERP; `dovada_ref` = câmpul) |
| `dovada_sursa` / `dovada_data` / `dovada_fragment` / `dovada_ref` | sursa (`document` / `mail` / `camp_erp`), data sursei, fragmentul scurt, linkul sau calea NAS |
| `dovada_amprenta` | md5 canonic al dovezii, pus de SERVER; decide „dovadă nouă” |
| `termen`, `termen_baza`, `termen_confirmat` | termenul identificat, baza calculului, dacă e confirmat |
| `incertitudine`, `propunere` | explicația incertitudinii; ce propune agentul |
| `responsabil_employee_id`, `responsabil_sursa` | angajatul titular; `agent` (propus) sau `om` (stabilit de om — agentul nu-l mai schimbă) |
| `stare` | `nou` → `in_lucru` / `asteapta_informatii` → `rezolvat` / `respins` (omul); `rezolvat` / `respins` → `nou` doar agentul, doar cu dovadă nouă |
| `stare_motiv`, `stare_dovada`, `actiune_ref`, `stare_de`, `stare_la` | decizia omului: motivul, dovada rezolvării / respingerii, legătura cu tichetul / acțiunea, cine, când |
| `regula_versiune` | versiunea regulii care a produs semnalul |
| `detectat_la`, `ultima_verificare`, `versiune` | prima detectare; ultima rulare care l-a confirmat; versiunea rândului (CAS pentru ecran) |

Jurnal doar-adăugare `executie_semnale_jurnal`: `creat` / `actualizat` / `redeschis` (agent), `stare` / `responsabil` (om), cu diferențele `{câmp: [vechi, nou]}`.

## Drepturile (o singură funcție, `fn_executie_semnal_drept`)
Citire = owner SAU managerul de proiect (`profiles.employee_id = executie_proiecte.mp_employee_id`) SAU responsabilul semnalului, TOȚI și cu
restricția pe proiect din 20261209a (`fn_executie_proiect_permis`). Schimbarea stării / responsabilului = aceiași. Un cont cu acces general pe
modul (viewer / editor / admin) sau șeful de șantier NU vede semnalele (0 rânduri) dacă nu e owner / MP / responsabil.

## RPC-ul agentului: `fn_executie_semnal_scrie(p_semnal jsonb)` — EXECUTE exclusiv `service_role`, fără JWT de utilizator
Cheile EXACTE (necunoscute = refuz 22023): `proiect_id`, `flux`, `tip`, `obiect`, `gravitate`, `titlu`, `constatare`, `regula_versiune`
(obligatorii) + `detalii`, `surse_consultate` (listă de texte), `dovada_sursa`, `dovada_data` (`AAAA-LL-ZZ`), `dovada_fragment`, `dovada_ref`,
`termen`, `termen_baza`, `termen_confirmat`, `incertitudine`, `propunere`, `responsabil_employee_id` (opționale; `null` = lipsă).
Răspuns `{ok, actiune, id, stare, versiune}` cu `actiune` ∈ `creat` · `actualizat` (ceva s-a schimbat, diferențele în jurnal) · `neschimbat`
(doar `ultima_verificare`) · `redeschis` (semnal închis de om, dovadă NOUĂ → `nou`) · `neschimbat_inchis` (semnal închis de om, aceeași dovadă → NU
reapare). Agentul nu poate atinge starea / motivul / dovada / acțiunea omului și nici responsabilul stabilit de om; gărzile stau în BD (trigger
BEFORE), nu doar în RPC.

Exemplu: `select fn_executie_semnal_scrie('{"proiect_id": 12, "flux": "lipsuri", "tip": "termen_apropiat", "obiect": "contract:termen", "gravitate": "atentie",
"titlu": "Termenul contractului se apropie", "constatare": "constatat", "dovada_sursa": "camp_erp", "dovada_data": "2026-11-21", "dovada_fragment": "data_termen = 2026-12-11",
"dovada_ref": "executie_proiecte.data_termen", "termen": "2026-12-11", "termen_baza": "câmpul data_termen", "termen_confirmat": true, "propunere": "Verificați dacă e nevoie de act adițional.",
"regula_versiune": "lipsuri-v1"}'::jsonb)`.

## RPC-ul omului: `fn_executie_semnal_stare(p_id, p_versiune, p_stare, p_motiv, p_dovada, p_actiune_ref, p_responsabil, p_schimba_responsabil)`
EXECUTE `authenticated`; dreptul de mai sus, verificat după lock; CAS pe `versiune` (`{ok: false, motiv: 'conflict', semnal}` = ecranul reîncarcă).
Rezolvarea, respingerea și redeschiderea cer motiv. `p_stare` NULL = starea rămâne (și textele ei); `p_schimba_responsabil = true` aplică `p_responsabil`.

## Ecranul
Execuție → proiect → fila „🔔 Semnale” (`src/ExecutieSemnale.jsx`); pentru owner, în Execuție → Proiecte, panoul „🔔 Semnale — toate proiectele”
(închis implicit). Filtre: gravitate, stare, flux, text, „arată și rezolvate / respinse”; sortare după termen sau gravitate; detalii cu dovada,
propunerea, decizia și istoricul; formular de schimbare a stării (motiv, dovadă, acțiune) și a responsabilului.

## Probe
`node scripts/pglite/test_executie_semnale_local.mjs` (PGlite, pașii reali L15 v2; drepturi pe 9 conturi, dedup, respins nu reapare, agentul nu
atinge starea omului, revenirea, 31 de mutanți, paritatea tranzițiilor, dry-run-ul pentru clonă), `npx vitest run src/executieSemnaleLogica.test.js
src/ExecutieSemnale.test.jsx`. Pe clonă: `supabase/tests/20270106a_executie_semnale_dryrun.sql` (după aplicarea prin runner).

## Ce NU e în faza 1 (faza 2, coordonatorul)
Regulile de verificare și sursele permise ale fiecărui flux; agentul propriu-zis (programare, credențiale `service_role` pe server, limite de
consum, reluare); fișa de securitate în registrul automatizărilor; recapitularea de dimineață; pragurile de evaluare ale pilotului (semnale utile,
timp economisit minus timpul de verificare, dubluri, cost pe semnal util).
