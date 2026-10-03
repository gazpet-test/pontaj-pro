# PR1 — „PF Package Shell”: dosarul propunerii financiare, versionat (specificație v3)

Stare: **v2 = v1 + condițiile Copilot din 03.10.2026, ~10:20** (GO cu condiții). Nimic aplicat.
Sursă: verdictul Copilot pe designul PF (03.10, ~03:07, GO cu condiții P0.1–P0.3), deciziile lui Răzvan din 03.10, verdictul Copilot pe spec v1 (03.10, ~10:20).
Prețurile și coeficienții proiectelor NU intră în repo. Ele stau în `claude_docs.pf_proiecte_active_raport` (privat).

## 1. Ce face PR1

- Introduce **dosarul propunerii financiare (PF)**, cu versiuni: cine a ofertat, în ce rol, cu ce instrument, ce valori au fost declarate și din ce documente.
- Legătura se face cu **exact un părinte**:
  - **licitația** (fluxul nou);
  - **proiectul de execuție** (dosarele istorice; niciunul dintre cele 22 de proiecte active nu are azi o licitație în `ofertare_licitatii`).
  - Nu fabricăm licitații istorice. Dosarul unei licitații rămâne al licitației și după adjudecare.
- **Valorile declarate** sunt afirmații financiare citate din documente, fiecare cu:
  - **rol**, adică ce fel de număr e;
  - **domeniu**, adică la cine se referă;
  - sursă, localizare și confirmare umană.
- **Închiderea versiunii** îngheață dosarul. Se scrie un manifest imuabil, construit pe server, al documentelor selectate explicit. Orice corectură înseamnă o versiune nouă.
- **Controlul** se face printr-un view doar de citire. Afișează diferențele dintre valorile de același rol și domeniu, fără toleranță implicită. Unde un termen lipsește, rezultatul e „neverificat” (NULL), nu 0 și nu „verde”.

## 2. Ce NU face

- Nu are parser sau import din XLS/XLSB/PDF și nu folosește AI.
- Nu scrie în `ofertare_calibrari`, `ofertare_preturi_materiale`, `ofertare_preturi_unitare`, `ofertare_cantitati`, `proiect_articole`, `oferta_materiale` sau `grafic_activitati`.
- Nu modifică `executie_proiecte.valoare_lei`, care rămâne valoarea contractuală curentă din Execuție. Istoria și celelalte domenii trăiesc în PF.
- Nu creează un registru nou de fișiere. Documentele rămân în `ofertare_formulare_registru`.
- **Nu dă verdict automat pe grafic** (vezi §5).

## 3. Schema (migrare `20261012a_ofertare_pf_pachete.sql` + `_ROLLBACK`, aplicată doar prin runner — redenumită din 20261009a, vezi §8)

### 3.0 Precondiții fail-closed (în stilul migrărilor existente)

- Pin pe helperii folosiți: semnătură, owner, SECURITY DEFINER, ACL.
- `extensions.digest` există.
- Tabelele părinte și coloanele referite există.

### 3.1 `ofertare_pf_pachete`

| coloană | tip | regulă |
|---|---|---|
| id | bigint identity | |
| licitatie_id | bigint null → ofertare_licitatii(id) ON DELETE RESTRICT | |
| proiect_id | bigint null → executie_proiecte(id) ON DELETE RESTRICT | **CHECK exact un părinte:** `(licitatie_id IS NOT NULL)::int + (proiect_id IS NOT NULL)::int = 1` |
| versiune | int not null | unic pe (părinte, rol_oferta, versiune) |
| eticheta | text not null | „depusă SEAP”, „revizie după clarificări”, „anexă subcontract” … |
| rol_oferta | text not null | CHECK: ofertant_unic, lider_asociere, asociat, subcontractant, tert_sustinator |
| instrument | text not null | CHECK: doclib, isdp, edevize, excel, boq, forfetar, altul, necunoscut |
| instrument_dovada | text | |
| moneda | text not null default 'RON' | CHECK: RON, EUR |
| stare | text not null default 'lucru' | CHECK: lucru, inchis, inlocuit |
| inlocuieste_id | bigint null → ofertare_pf_pachete(id) | RPC-ul verifică același părinte și același rol_oferta |
| data_depunere | timestamptz | dacă dovada are și ora |
| dovada_depunere | text | recipisă / export SICAP / opis semnat |
| nas_folder | text | proveniență, niciodată dovadă |
| documente_selectate | jsonb not null default '[]' | selecția EXPLICITĂ de lucru (registru_id-uri și intrări externe), editabilă doar în 'lucru' |
| manifest | jsonb null | scris DOAR de RPC-ul de închidere |
| manifest_hash | text | `encode(extensions.digest(manifest::text, 'sha256'), 'hex')` pe forma canonică (§3.4) |
| inchis_la / inchis_de | timestamptz / uuid | |
| created_at / created_by / updated_at / updated_by | | default now() / auth.uid() |

**Indecși:**
- maximum **un draft** per (părinte, rol_oferta): unic parțial WHERE stare = 'lucru';
- maximum **o versiune curentă închisă** per (părinte, rol_oferta): unic parțial WHERE stare = 'inchis';
- oricâte în stare 'inlocuit'.

**Imuabilitate (trigger BEFORE INSERT/UPDATE/DELETE):**
- **INSERT direct:** doar stare = 'lucru', cu manifest, manifest_hash, inchis_la și inchis_de NULL.
- **UPDATE/DELETE pe 'inchis' sau 'inlocuit':** refuz total.
- **Unica excepție:** tranziția exactă inchis → inlocuit (doar coloana stare), permisă numai când vine din funcția SECURITY DEFINER de închidere. Se verifică prin owner-ul controlat al funcției, NU printr-un GUC setat dintr-o funcție expusă (gate 0e).
- **Trecerea lucru → inchis:** tot numai din RPC-ul de închidere.
- **DELETE:** doar stare = 'lucru'.

### 3.2 `ofertare_pf_valori` — afirmații financiare versionate (tabel separat de viitorul `ofertare_pf_pozitii`)

| coloană | tip | regulă |
|---|---|---|
| id | bigint identity | |
| pachet_id | bigint not null → ofertare_pf_pachete ON DELETE CASCADE | trigger: INSERT/UPDATE/DELETE refuzat dacă pachetul nu e 'lucru' |
| rol_valoare | text not null | CHECK: total_oferta, platibil, materiale_beneficiar, contract_initial, act_aditional, ajustari, grafic_valoric, cota |
| domeniu_valoric | text not null | CHECK: asociere_total, gazpet, subcontract, beneficiar, lider, asociat |
| participant | text null | eticheta participantului pentru domeniile non-Gazpet (lider / asociat / subcontractor X) |
| valoare | numeric(16,2) not null | **poate fi negativă** (act adițional de reducere, ajustări negative); fără CHECK global ≥ 0, restricții doar pe rol |
| tva_inclus | boolean not null default false | |
| cota_pct | numeric(7,4) null | obligatoriu pentru rol 'cota'; un procent nu se compară numeric cu un total |
| baza_text | text | baza procentului, citată |
| sursa_registru_id | bigint null → ofertare_formulare_registru(id) | |
| sursa_externa_cheie | text null | cheia intrării externe din documente_selectate / manifest |
| localizare | text not null | pagină / foaie / celulă |
| confirmat_de / confirmat_la | uuid / timestamptz | |
| nota | text | |

### 3.3 RPC (SECURITY DEFINER, `SET search_path = public, pg_temp`, REVOKE ALL FROM PUBLIC, anon, GRANT EXECUTE authenticated, poartă de rol în corp)

**`fn_ofertare_pf_inchide(p_pachet bigint)`:**
- cere `fn_poate_scrie_pf()`, stare 'lucru' și cel puțin o valoare `total_oferta` sau `platibil`;
- cere ca toate valorile să fie confirmate;
- blochează scope-ul (părinte, rol_oferta);
- construiește manifestul **server-side** din `documente_selectate`, recitind metadatele reale din registru;
- refuză dacă vreo valoare confirmată are sursa în afara manifestului;
- scrie `manifest` + `manifest_hash`;
- trece versiunea curentă 'inchis' a scope-ului în 'inlocuit' și pe aceasta lucru → 'inchis', **în aceeași tranzacție**.

**`fn_ofertare_pf_versiune_noua(p_pachet bigint, p_eticheta text)`:**
- pornește de la versiunea 'inchis' a scope-ului și creează draftul unic în 'lucru';
- clonează antetul, documentele selectate și valorile, **cu confirmările șterse**;
- `inlocuieste_id` = versiunea sursă.

### 3.4 Manifest — forma canonică

O intrare per document, cu ordinea stabilă `ORDER BY registru_id NULLS LAST, cheie`:

```json
{ "registru_id": 123, "cheie": null, "cod": "F1", "denumire": "…", "fisier_path": "…",
  "marime": 12345, "hash_algoritm": "sha256", "hash_valoare": "…",
  "hash_sursa": "server|client", "hash_confirmat_de": "uuid|null", "hash_confirmat_la": "ts|null",
  "stare_depunere": "…", "provenienta": "…" }
```

- Manifestul = `jsonb_agg(intrare ORDER BY …)`.
- `manifest_hash = encode(extensions.digest(manifest::text, 'sha256'), 'hex')`.
- Hash-ul calculat în browser (`hash_sursa = 'client'`) e acceptat doar ca proveniență **confirmată de om**. Interfața nu îl prezintă niciodată drept „verificat de server”.

### 3.5 View de control `v_ofertare_pf_control` (security_invoker = on)

- Compară doar valori de **același rol și domeniu**, din surse diferite. De exemplu `total_oferta/gazpet` din F1 vs din formularul de ofertă vs din SEAP.
- Diferența e exactă, la ban. Când lipsește un termen: NULL / „neverificat”.
- **Graficul:** în PR1 afișează doar informativ dacă licitația are activități în `grafic_activitati` și dacă există un PDF de grafic în manifest. **Nu dă verdict pe sumă** (vezi §5).

### 3.6 Acces (RLS) — helper dedicat, fail-closed

- `fn_poate_citi_pf()` / `fn_poate_scrie_pf()`, ambele SECURITY DEFINER, folosite identic pe pachete, valori, view și RPC-uri.
- Regula propusă: **owner** SAU intrare explicită în `user_module_access` pe sub-modulul nou `'ofertare_pf'`.
  - Accesul general la Ofertare **nu** dă automat acces la valorile comerciale.
  - Cine primește `'ofertare_pf'` decide **doar Răzvan** (CLAUDE.md pct. 3). Până atunci vede doar owner-ul.
- REVOKE ALL FROM PUBLIC, anon pe tabele, secvențe, funcții și view.

## 4. Interfață

- **Fișa licitației** (`OfertareLicitatii.jsx`, lista TABS): o filă nouă, „💰 Propunere financiară”, vizibilă doar dacă `fn_poate_citi_pf()`. Conține:
  - versiunile (etichetă, rol, instrument, stare);
  - editorul de valori: rol, domeniu, participant, valoare (inclusiv negativă), TVA, sursă, localizare, „confirm”;
  - selecția explicită a documentelor din registru și a celor externe, cu hash (client-side marcat ca atare);
  - panoul de control;
  - butonul „Închide versiunea”, cu dialog de confirmare;
  - butonul „Versiune nouă”.
- **Fișa proiectului de execuție:** secțiunea „Propunere financiară (istoric)”, aceeași componentă pe `proiect_id`.
- Stil: inline styles G/S. Componentă `src/OfertarePF.jsx` + logică pură în `src/ofertarePF.js`, cu teste vitest.

## 5. Graficul fizic și valoric

**Decizia lui Răzvan (03.10)**, confirmată de Copilot ca direcție:
1. Graficul se face în **editorul existent** (`GraficLucrare.jsx` → `grafic_activitati`). Nu facem un al doilea editor în PF.
2. **PDF-ul graficului depus** intră în dosar, în selecția de documente și în manifest.
3. **Graficele vechi** (6 dosare istorice) rămân documente. Import structurat doar din Excel și doar după ce confirmăm semantica.

**Condiția Copilot pentru verificarea automată:** verificarea „suma graficului valoric = total F1” **nu intră în PR1 ca verdict**. Are nevoie întâi de două lucruri:
- **Ce rânduri se însumează.** `grafic_activitati` are WBS/niveluri. Suma brută poate dubla valoarea dacă și părintele, și copiii au valoare. Trebuie stabilit: doar frunzele, sau un flag „intră în total valoric”.
- **Ce domeniu economic acoperă graficul.** Un grafic contractual poate exclude legitim OS 5.1, procurarea sau diversele. Comparăm doar cu valoarea PF de **același domeniu**, nu obligatoriu cu total_oferta.

Până atunci rezultatul e „neverificat”, nu „neconform”. Comparația automată vine într-un PR separat, după ce stabilim semantica.

## 6. Teste și livrare

- **vitest pe `ofertarePF.js`:**
  - roluri × domenii;
  - „neverificat” când lipsește un termen;
  - diferențe exacte la ban, fără toleranță;
  - valori negative.
- **Harness PG16:**
  - exact un părinte;
  - draft unic și curent unic, fără ca versiunea curentă să dispară în timpul draftului;
  - imuabilitate: UPDATE/DELETE pe inchis și inlocuit refuzate, INSERT direct cu stare inchis refuzat, tranziția inchis → inlocuit refuzată din afara RPC-ului;
  - închidere atomică V1 → inlocuit + V2 → inchis;
  - versiunea nouă cu confirmările șterse;
  - manifest_hash stabil (aceeași selecție dă același hash);
  - refuz la închidere când o valoare are sursa în afara manifestului;
  - RLS: anon refuzat, fără `'ofertare_pf'` refuzat, owner OK;
  - mutanți: fără trigger de imuabilitate; index pe `<> 'inlocuit'`.
- Build complet (`npx vite build`) înainte de PR.
- Migrarea se aplică doar prin `scripts/livrare_migrare.sh`, cu „aplica” de la Răzvan. Populăm cele 22 de dosare istorice separat: preview → confirmare.

## 7. Verdict Copilot pe spec v1 (03.10.2026, ~10:20) — GO cu condiții, toate preluate în v2

- **P0.1:** versionarea curentului (draft unic + închis unic, tranziție atomică la închidere) și clonarea valorilor cu confirmările șterse.
- **P0.2:** imuabilitate completă pentru inchis/inlocuit; tranziția doar din RPC; INSERT direct numai 'lucru'; fără GUC din funcție expusă.
- **P0.3:** `domeniu_valoric` pe fiecare valoare, separat de `rol_valoare`.
- **P1:**
  - tabel `valori` separat;
  - XOR pe părinte, fără licitații fictive;
  - manifest server-side, determinist, cu snapshot de hash;
  - fiecare valoare confirmată are sursa în manifest;
  - selecție explicită de documente;
  - valori negative permise;
  - helper RLS dedicat.
- **P2:** data_depunere timestamptz, updated_by, verificarea inlocuieste_id, pin pe helperi, NULL în loc de 0 în control.
- **Grafic:** direcția Răzvan e GO. Verdictul automat pe suma graficului e amânat până la semantica rândurilor însumabile și a domeniului.

## 8. v3 — ce s-a schimbat după validarea livrării lui Jakarinos și preflight-ul pe live (03.10.2026)

Validarea (harness + simulare prod-like) a găsit 2 blocante (build `OfertarePF.jsx:194`; `GRANT … WITH ADMIN OPTION` care pică pe un `postgres` nesuperuser) și repetarea NO-GO-ului de la 20261010a (drepturi pentru `service_role`, secvențe deschise). Preflight-ul read-only pe live a mai găsit unul: **`postgres` nu are USAGE WITH GRANT OPTION pe schema `auth`** (owner `supabase_admin`), deci executorul PF nu poate primi drept pe `auth`. Decizii (Răzvan, 03.10: „tot ce e testat”):

- **Migrarea** devine `20261012a_ofertare_pf_pachete.sql` (sortează după 20261011a, ultima aplicată). Livrare: migrarea ÎNAINTE de merge.
- **Identitatea în rolul executor**: wrapper `public.fn_ofertare_pf_uid()` (SQL, STABLE, SECURITY DEFINER, owner `postgres`, `SELECT auth.uid()`), EXECUTE doar pentru `ofertare_pf_executor`; precondiție pe md5-ul `auth.uid()` de pe live. Executorul nu primește nimic pe `auth`. Testat: wrapper-ul întoarce sub-ul apelantului, nu al ownerului.
- **Drepturi**: `service_role` nu primește nimic (tabele, view, RPC-uri); secvențele identity fără drepturi; ACL verificat EXACT (aclexplode). `GRANT ofertare_pf_executor TO postgres WITH INHERIT TRUE, SET TRUE` (fără ADMIN OPTION). Postcondiție fail-closed că executorul poate folosi efectiv `extensions.digest` și wrapper-ul.
- **Scriere PF**: doar owner sau `user_module_access.access_level IN ('admin','editor')` pe `ofertare_pf` (precedentul 20261005b); `viewer` doar citește.
- **Filiație**: închiderea cere ca `inlocuieste_id` să fie exact versiunea închisă curentă a scope-ului (sau NULL dacă nu există).
- **Hash legacy din registru** (Q1, „necunoscutele din registru” din NOTE.md-ul lui Jakarinos): `fisier_hash` e text liber, introdus manual — se compară normalizat (`lower(btrim())`) și doar când arată ca `^[0-9a-f]{64}$`; algoritm/sursă/mărime rămân NULL („proveniență necunoscută”). Fără coloane noi în registru în PR1.
- **Graficul** (Q2/Q5, „marcajul PDF grafic” din NOTE.md): `grafic_are_activitati` = EXISTS pe `grafic_activitati.licitatie_id` / `proiect_id` (politica live `grafic_act_sel` = `auth.uid() IS NOT NULL`, pinuită în precondiții); `grafic_pdf_in_manifest` rămâne NULL / „neverificat” până la un `rol_document` explicit (spec ulterior). Fără verdict pe sumă.
- **Semne pe valori** (Q3): fără CHECK în PR1; regula pe roluri (≥ 0 pentru total/plătibil/contract/grafic, orice semn pentru act adițional/ajustări, cota 0–100) rămâne de decis.
- **UI**: accesul PF se re-verifică doar la schimbarea userului (evenimentele de sesiune ale aceluiași user nu mai demontează dosarul); eroarea PF apare doar în tab-ul PF; lipsa migrării (PGRST202) ascunde PF fără banner.
- **Revenire**: a doua armare separată dacă există drafturi; refuz mereu dacă există versiuni închise/înlocuite.
- **Teste**: harness PG17 + PG16 + etapă prod-like (postgres nesuperuser, default privileges și ACL-ul `auth` ca pe live, sesiuni prin `authenticator`), fiecare refuz verificat pe mesajul exact, gate 0e în harness, 13 mutanți prinși (inclusiv r2 pe configurația live).
- **r4 (după NO-GO-ul Copilot pe e3bd3f4, P0 „confused deputy”)**: orice folosire a unui document din registru (`documente_selectate.registru_id`, `sursa_registru_id`, închiderea) cere pe server ȘI acces general la Ofertare pentru apelant — helper `fn_ofertare_pf_acces_ofertare()` (SECDEF peste `fn_are_acces_ofertare()`, EXECUTE pentru `authenticated` și executor); registrul trebuie să fie al aceleiași licitații ca dosarul; dosarele pe proiect nu pot folosi registrul (doar documente externe); refuzul vine înaintea FK-ului, cu același mesaj pentru id existent sau inexistent (fără oracol); politica executorului pe registru cere și helper-ul. Consecință asumată: un editor PF fără Ofertare lucrează doar cu dosare cu documente externe. După închiderea de către cineva cu Ofertare, metadatele registrului din manifest (cod, denumire, cale, hash, stare) sunt vizibile oricărui cititor PF — manifestul face parte din dosar. La schimbarea userului drepturile PF devin imediat „fără acces” până la re-verificare.
