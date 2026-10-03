# PR1 — „PF Package Shell”: dosarul propunerii financiare, versionat (specificație)

Stare: **propunere pentru verdictul Copilot** (03.10.2026). Nimic aplicat.
Sursă: verdictul Copilot din 03.10 pe designul PF (GO cu condiții P0.1–P0.3) și deciziile lui Răzvan din 03.10.
Prețurile și coeficienții proiectelor NU intră în repo. Ele stau în `claude_docs.pf_proiecte_active_raport` (privat).

## 1. Ce face PR1

- Introduce **dosarul propunerii financiare (PF)**, cu versiuni: cine a ofertat, în ce rol, cu ce instrument, ce valori au fost declarate și din ce documente.
- Legătura se face cu **licitația** (fluxul nou) sau cu **proiectul de execuție** (dosarele istorice). Niciunul dintre cele 22 de proiecte active nu are azi o licitație în `ofertare_licitatii`.
- **Valorile declarate** sunt rânduri cu rol și domeniu (P0.1): total ofertă, plătibil, materiale beneficiar, cota Gazpet, subcontract, contract inițial, act adițional, ajustări, total grafic valoric. Fiecare are sursa (document + pagină/foaie) și confirmarea unui om.
- **Închiderea versiunii** îngheață dosarul (P0.2). Se scrie un manifest imuabil al documentelor, cu amprentele lor, iar după închidere nimic nu se mai modifică. O corectură înseamnă o versiune nouă, care o marchează pe cea veche „înlocuită”.
- **Controlul** se face printr-un view doar de citire. Afișează diferențele dintre valorile declarate (de exemplu total ofertă vs total grafic valoric) fără toleranță implicită, iar omul decide.

## 2. Ce NU face (P0.3)

- Nu are parser sau import din XLS/XLSB/PDF și nu folosește AI.
- Nu scrie în `ofertare_calibrari`, `ofertare_preturi_materiale`, `ofertare_preturi_unitare`, `ofertare_cantitati`, `proiect_articole`, `oferta_materiale` sau `grafic_activitati`.
- Nu modifică `executie_proiecte.valoare_lei`, care rămâne valoarea curentă folosită de Execuție.
- Nu creează un registru nou de fișiere. Documentele rămân în `ofertare_formulare_registru` (`fisier_path`, `fisier_hash`, `stare_depunere`).

## 3. Schema (migrare `20261009a_ofertare_pf_pachete.sql` + `_ROLLBACK`, aplicată doar prin runner)

### 3.1 `ofertare_pf_pachete`

| coloană | tip | regulă |
|---|---|---|
| id | bigint identity | |
| licitatie_id | bigint null → ofertare_licitatii(id) ON DELETE RESTRICT | |
| proiect_id | bigint null → executie_proiecte(id) ON DELETE RESTRICT | CHECK: cel puțin una dintre cele două legături |
| versiune | int not null | unic pe (licitatie_id, rol_oferta, versiune) sau pe (proiect_id, rol_oferta, versiune) |
| eticheta | text not null | de ex. „depusă SEAP”, „revizie după clarificări”, „anexă subcontract” |
| rol_oferta | text not null | CHECK: ofertant_unic, lider_asociere, asociat, subcontractant, tert_sustinator |
| instrument | text not null | CHECK: doclib, isdp, edevize, excel, boq, forfetar, altul, necunoscut |
| instrument_dovada | text | antet / nume foi / subsol |
| moneda | text not null default 'RON' | CHECK: RON, EUR |
| stare | text not null default 'lucru' | CHECK: lucru, inchis, inlocuit |
| inlocuieste_id | bigint null → ofertare_pf_pachete(id) | |
| data_depunere | date | |
| dovada_depunere | text | recipisă / export SICAP / opis semnat |
| nas_folder | text | proveniență, nu dovadă |
| manifest | jsonb null | scris DOAR la închidere |
| manifest_hash | text | sha256 pe manifestul canonic (pgcrypto `digest`) |
| inchis_la / inchis_de | timestamptz / uuid | |
| created_at / created_by / updated_at | | created_by default auth.uid() |

- **Invariant „un singur curent”:** index unic parțial pe (licitatie_id, rol_oferta) și pe (proiect_id, rol_oferta) WHERE stare <> 'inlocuit'.
- **Imuabilitate (trigger BEFORE UPDATE/DELETE):** când OLD.stare = 'inchis', singura tranziție permisă este inchis → inlocuit, făcută de funcția de versionare. DELETE e permis doar pentru stare = 'lucru'.

### 3.2 `ofertare_pf_valori` — valorile nominale, cu rol (P0.1)

| coloană | tip | regulă |
|---|---|---|
| id | bigint identity | |
| pachet_id | bigint not null → ofertare_pf_pachete ON DELETE CASCADE | trigger: INSERT/UPDATE/DELETE refuzat dacă pachetul nu e în 'lucru' |
| rol_valoare | text not null | CHECK: total_oferta, platibil, materiale_beneficiar, cota_gazpet, subcontract, contract_initial, act_aditional, ajustari, grafic_valoric |
| valoare | numeric(16,2) not null | fără TVA, dacă tva_inclus nu spune altfel |
| tva_inclus | boolean not null default false | |
| cota_pct | numeric(7,4) null | doar pentru cota_gazpet / subcontract; un procent nu se compară cu un total |
| baza_text | text | baza procentului, citată |
| sursa_registru_id | bigint null → ofertare_formulare_registru(id) | |
| sursa_text | text not null | document / cale NAS |
| localizare | text not null | pagină / foaie / celulă |
| confirmat_de / confirmat_la | uuid / timestamptz | închiderea cere ca toate valorile să fie confirmate |
| nota | text | |

### 3.3 RPC (SECURITY DEFINER, search_path fixat, REVOKE de la PUBLIC, GRANT authenticated, cu poartă de rol în corp)

- `fn_ofertare_pf_inchide(p_pachet bigint)`. Cere `fn_are_acces_ofertare()`, stare 'lucru', cel puțin un `total_oferta` sau `platibil` și toate valorile confirmate. Construiește manifestul din `ofertare_formulare_registru`: pentru licitație, rândurile aplicabile cu fisier_path; pentru pachetele istorice pe proiect, lista atașată explicit (cu `hash_sursa` = 'client' / 'server'). Scrie `manifest_hash`, iar stare devine 'inchis'.
- `fn_ofertare_pf_versiune_noua(p_pachet bigint, p_eticheta text)`. Copiază antetul și valorile neconfirmate într-o versiune nouă, în 'lucru'. La închiderea versiunii noi, cea veche trece în 'inlocuit', în aceeași tranzacție.

### 3.4 View de control `v_ofertare_pf_control` (security_invoker = on)

Pentru fiecare pachet:
- totalul declarat pe fiecare rol;
- Σ `grafic_activitati.valoare_lei` pentru licitația pachetului;
- diferența total_oferta − Σ grafic, afișată exact;
- marcaj „grafic lipsă” dacă licitația cere grafic valoric și nu există nimic în editor.

Fără toleranță. Fără verdict „verde” când lipsesc termenii comparației (rămâne „neverificat”).

### 3.5 RLS

- **SELECT:** `fn_are_acces_ofertare()` sau owner sau modulul `financiar`. Nu doar `auth.uid() IS NOT NULL`: valorile sunt date comerciale sensibile.
- **INSERT/UPDATE:** `fn_are_acces_ofertare()`. Triggerele de imuabilitate se aplică peste.
- **DELETE pachet:** owner și doar stare 'lucru'.
- Cu `REVOKE ALL FROM anon`.

## 4. Interfață

- **Fișa licitației** (`OfertareLicitatii.jsx`, lista TABS): o filă nouă, „💰 Propunere financiară”, cu:
  - lista versiunilor (etichetă, rol, instrument, stare);
  - editorul de valori (rol, valoare, TVA, sursă, localizare, „confirm”);
  - documentele din registru, doar citire, cu amprentă și stare depunere;
  - panoul de control din view;
  - butonul „Închide versiunea”, cu dialog de confirmare.
- **Fișa proiectului de execuție:** secțiunea „Propunere financiară (istoric)”, aceeași componentă pe `proiect_id`, pentru cele 22 de dosare istorice.
- Stil: inline styles G/S, componentă nouă `src/OfertarePF.jsx` + logica pură în `src/ofertarePF.js`, cu teste vitest.

## 5. Graficul fizic și valoric (decizia lui Răzvan, 03.10 — supusă verdictului Copilot)

1. Pentru licitațiile care cer grafic fizic și valoric, **graficul se face în editorul existent** (`GraficLucrare.jsx` → `grafic_activitati`, cu `licitatie_id`, `durata_zile`, `valoare_lei`, export MS Project).
2. Dosarul PF **verifică automat** că suma graficului valoric = totalul ofertei (F1), pe același domeniu, fără TVA (view-ul de la 3.4).
3. **PDF-ul graficului depus** intră în dosar ca document: rând în registru și în manifest.
4. **Graficele vechi** (6 dosare istorice: grafic valoric ISDP, grafic valoric la clarificări, grafic de prețuri, grafic estimat de plăți, grafic de execuție, grafic actualizat) rămân documente. Import structurat doar dacă avem sursa în Excel, și asta într-un PR separat, după ce stabilim că e același obiect semantic cu graficul din editor.

## 6. Teste și livrare

- vitest pe `ofertarePF.js`: rolurile, „neverificat” când lipsește un termen, diferențe exacte la ban, fără toleranță.
- Harness PG16: imuabilitatea după închidere (UPDATE/DELETE refuzate), unicitatea „curent”, manifest_hash stabil, RLS (anon refuzat, fără acces Ofertare doar citire refuzată, cu acces scriere OK), versiune nouă → cea veche 'inlocuit' atomic, mutant fără trigger de imuabilitate prins de test.
- Build complet (`npx vite build`) înainte de PR.
- Migrarea se aplică doar prin `scripts/livrare_migrare.sh`, cu „aplica” de la Răzvan. Populăm cele 22 de dosare istorice separat: preview → confirmare.

## 7. Întrebări pentru Copilot

1. `ofertare_pf_valori` ca tabel separat (recomandarea mea: clar, mic, PR2-ul `ofertare_pf_pozitii` nu mai poartă roluri de rezumat) sau rânduri `tip_piesa='rezumat'` direct în `ofertare_pf_pozitii`, din PR1?
2. Părinte dublu `licitatie_id` / `proiect_id`, cu CHECK cel puțin unul, sau creăm licitații „istorice” pentru cele 22 de proiecte și păstrăm un singur părinte?
3. Manifest JSONB + sha256 pe forma canonică (pgcrypto `digest`), cu `hash_sursa` client/server pentru documentele care nu sunt în registru: suficient pentru P0.2?
4. Controlul grafic vs total: domeniul corect e totalul fără TVA, cu OS și diverse incluse? Cum tratăm graficele care exclud capitolele 5.1 / diverse și neprevăzute?
5. RLS de citire: `fn_are_acces_ofertare()` + owner + financiar e strâns suficient?
6. Mai e ceva P0 înainte ca Jakarinos să înceapă implementarea?
