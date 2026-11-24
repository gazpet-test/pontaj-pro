# Achiziții: retur la furnizor pe reperele unei comenzi (TKT-2026-0347) — specificație v2

Data: 24.11.2026 · Stare: v2 după review NO-GO (24.11), de aprobat · Varianta aleasă de owner: **A** (retur pe linia de comandă, cu ieșire automată din stoc). Până la livrare se aplică **C**: ieșire manuală din Magazie (`ajustare_minus`) cu motivul „retur furnizor, comanda …”.

## 1. De ce

Se întâmplă ca repere recepționate și intrate deja în stoc să se dovedească neconforme. Ele se dau înapoi furnizorului, iar furnizorul trimite în schimb marfă conformă.

Exemplul din tichet: o linie de pe o comandă de furnizor are 450 de bucăți primite și intrate în stoc (`cantitate_intrata_stoc = 450`), iar toate 450 se returnează.

Azi ERP-ul nu are retur nicăieri: nici în Achiziții, nici în Magazie, nici în schemă. Consecințele:
- stocul arată bucăți care nu mai sunt fizic acolo;
- comanda nu spune că s-a returnat ceva;
- înlocuirea nu se poate recepționa pe aceeași linie, pentru că linia „are deja totul”.

## 2. Ce există azi (relevant)

- **Liniile comenzii** (`comenzi_furnizor_linii`) au trei cantități:
  - `cantitate`: comandată;
  - `cantitate_primita`: recepție pe repere;
  - `cantitate_intrata_stoc`: ce a intrat efectiv în stoc, incremental (TKT-2026-0195).
- **Intrarea în stoc** (`Achizitii.jsx`, `intraInStoc`):
  - linia se rezervă întâi printr-un update condiționat pe `cantitate_intrata_stoc`;
  - apoi se scrie o mișcare `stocuri_miscari` cu `tip = 'intrare_achizitie'`, `ref_tip = 'comanda_furnizor'`, `ref_id = comanda`;
  - locația e sediul sau proiectul, după `livrare_tip`.
- **Stocul** = suma `delta` din `stocuri_miscari` pe locație + denumire. CHECK-ul pe `tip` acceptă azi: `intrare_achizitie`, `ajustare_plus`, `ajustare_minus`, `transfer_out`, `transfer_in`, `consum_proiect`, `corectie_initiala`.
- **Fluxul comenzii (azi):** `draft → in_aprobare → emisa → in_tranzit → ajunsa → receptionata → in_stoc`.
  - „Recepție pe repere” apare doar în `emisa`, `in_tranzit` și `ajunsa`.
  - „Predare parțială în stoc” apare până la `receptionata`.
- **Triggere pe linii** (sincronizarea cu cererile interne, `trg_cfl_sync_cereri`, și potrivirea automată, `trg_cfl_automatch`) reacționează la cantități. Returul nu trebuie să redeschidă cereri interne deja satisfăcute: din punctul de vedere al cererii, marfa vine oricum, prin înlocuire.

## 3. Ce se construiește

### 3.0 Invarianții (cantitățile sunt cumulative; scad doar prin anularea unui retur)

Pe fiecare linie de comandă:

| Câmp | Sens | Cine îl crește |
|---|---|---|
| `cantitate_primita` | tot ce a sosit fizic, inclusiv înlocuirile | recepția (RPC, §3.3) |
| `cantitate_returnata` | tot ce s-a dat înapoi furnizorului (net de anulări) | returul / anularea (RPC) |
| `cantitate_intrata_stoc` | tot ce a intrat în stoc din linie | predarea în stoc (RPC, §3.3) |
| `cantitate_iesita_retur` | partea din retururi scoasă din stoc (net de anulări) | returul / anularea (RPC) |

Valori derivate, niciodată stocate:
- **primit net** = `primita − returnata`, adică ce avem de la furnizor;
- **în stoc din linie** = `intrata_stoc − iesita_retur`;
- **primit, dar neintrat în stoc** = primit net − în stoc din linie;
- **de înlocuit** = suma pe retururile deschise a `cantitate − cantitate_inlocuita`.

Constrângeri (CHECK pe linie):
- `0 ≤ iesita_retur ≤ intrata_stoc`;
- `0 ≤ returnata ≤ primita`;
- `0 ≤ returnata − iesita_retur ≤ primita − intrata_stoc`, adică returul din marfă neintrată nu depășește ce a fost neintrat.

Exemplele din review se rezolvă așa:
- 100 primite, retur 40, apoi încă un retur: mai pot fi returnate 60, adică `primita − returnata`.
- 100 primite, 40 intrate în stoc, două retururi de câte 20 din stoc: ambele scot din stoc, pentru că `intrata − iesita` trece 40 → 20 → 0.

### 3.1 Date (migrare L15 v2, neaplicată până la „da”)

- **Pe `comenzi_furnizor_linii`:**
  - `cantitate_returnata` și `cantitate_iesita_retur`, `numeric NOT NULL DEFAULT 0`;
  - CHECK-urile de la §3.0;
  - liniile existente rămân la 0 și nu se modifică nicio cantitate existentă.
- **Tabel nou `comenzi_furnizor_retururi`** (fără UPDATE sau DELETE directe):
  - Identificare: `id`, `comanda_furnizor_id`, `linie_id`.
  - `tip`: `'retur' | 'anulare'`.
  - `retur_id`: FK la returul original. E NULL la `retur`, obligatoriu la `anulare`, iar `UNIQUE (retur_id)` asigură că un retur se anulează o singură dată.
  - `cantitate`: `numeric > 0`, mereu pozitivă; sensul îl dă `tip`.
  - `din_stoc`: `numeric ≥ 0, ≤ cantitate`.
  - `motiv text NOT NULL` (minim 5 caractere) și `pv_retur_path NULL`.
  - Înlocuirea:
    - `asteapta_inlocuire boolean`;
    - `cantitate_inlocuita numeric NOT NULL DEFAULT 0 CHECK (0 ≤ cantitate_inlocuita ≤ cantitate)`;
    - `inchis_la`, `inchis_motiv` (închis când e înlocuit integral sau închis fără înlocuire).
  - `stoc_miscare_id`: FK, NULL când `din_stoc = 0`.
  - Idempotență: `cheie uuid NOT NULL UNIQUE` și `payload_hash text NOT NULL`.
  - `creat_de`, `creat_la`.
- **Mișcări noi de stoc:** CHECK-ul pe `stocuri_miscari.tip` primește `retur_furnizor` (delta < 0) și `retur_furnizor_anulare` (delta > 0), ambele cu `ref_tip = 'comanda_furnizor_retur'`.
- **RLS, GRANT și REVOKE** după regulile repo-ului:
  - tabelul se poate citi de cine vede comanda;
  - scrierea directă e revocată pentru toți, inclusiv `authenticated`;
  - scrierea se face doar prin RPC-urile `SECURITY DEFINER`.

### 3.2 Serializarea pe stoc (comună cu celelalte ieșiri)

- **Helper nou `fn_stoc_blocheaza(locatie_tip, locatie_id, material_denumire) → numeric`:**
  - ia `pg_advisory_xact_lock` pe cheia stocului (hash pe locație + denumire normalizată), apoi întoarce cantitatea curentă din `stocuri`;
  - e un lock pe cheie, nu pe rând, deci merge și când rândul din `stocuri` nu există încă.
- **Toate RPC-urile care scad stocul îl folosesc:** returul, `fn_stoc_ajustare` (partea minus) și transferurile / consumurile care trec prin RPC.
  - Planul include auditul căilor care scad stocul direct din client: `transfer_out` și `consum_proiect`.
  - Fiecare cale găsită fie trece printr-un RPC cu lock, fie e listată ca preexistentă, cu tichet separat.
  - Intrările (delta > 0) nu au nevoie de lock pentru verificare, dar îl iau dacă scriu în aceeași tranzacție cu o ieșire.
- **Ordinea fixă a lock-urilor:** întâi linia comenzii (`FOR UPDATE`), apoi cheia de stoc. Nicio funcție nu le ia invers.

### 3.3 RPC-uri (toate `SECURITY DEFINER`, `search_path` fix, dreptul reverificat DUPĂ lock-uri — L01)

Dreptul: achiziții cu drept de creare sau owner, ca la recepție. Toate primesc `p_cheie uuid` pentru idempotență:
- aceeași cheie cu același payload întoarce rezultatul deja comis, fără efect nou;
- aceeași cheie cu alt payload e refuzată (`cheie_refolosita`);
- reconcilierea unei chei comise se face pe identitatea autorului, chiar dacă între timp și-a pierdut dreptul (lecția DCC);
- o scriere nouă cere dreptul.

1. **`fn_cf_retur_inregistreaza(p_cheie, p_linie_id, p_cantitate, p_motiv, p_pv_path, p_asteapta_inlocuire)`**
   1. Lock pe linie, apoi lock pe stoc (§3.2), apoi reverificarea dreptului.
   2. Validare: `0 < cantitate ≤ primita − returnata`.
   3. `din_stoc = min(cantitate, intrata_stoc − iesita_retur)`. Restul, `cantitate − din_stoc`, trebuie să încapă în „primit, dar neintrat”; altfel se refuză.
   4. Dacă `din_stoc > 0`: cantitatea întoarsă de `fn_stoc_blocheaza` trebuie să fie ≥ `din_stoc`. Altfel: refuz „în stoc sunt doar X; restul a fost consumat sau transferat”, fără nicio scriere.
   5. Mișcarea `retur_furnizor` (−`din_stoc`), apoi `returnata += cantitate` și `iesita_retur += din_stoc`, apoi rândul `retur`. Totul într-o singură tranzacție.
2. **`fn_cf_retur_anuleaza(p_cheie, p_retur_id, p_motiv)`**: anulează integral un retur introdus greșit.
   - Se refuză dacă returul are deja `cantitate_inlocuita > 0` (întâi se corectează înlocuirea) sau dacă a fost deja anulat.
   - Pune la loc stocul: mișcare `retur_furnizor_anulare` (+`din_stoc`).
   - Scade contorii: `returnata −= cantitate` și `iesita_retur −= din_stoc`.
   - Închide returul cu motivul și scrie rândul `anulare`.
   - Lock-urile se iau în aceeași ordine ca la retur.
3. **`fn_cf_receptie_adauga(p_cheie, p_linie_id, p_cantitate_sosita)`**: recepția devine **incrementală** („au sosit încă N”), în locul valorii absolute scrise azi din formular (`Achizitii.jsx` ~2029). Așa o recepție veche nu mai poate suprascrie un retur.
   - Lock pe linie, reverificarea dreptului, apoi `primita += N`.
   - Cantitatea sosită acoperă întâi retururile deschise cu `asteapta_inlocuire`, în ordinea vechimii (`cantitate_inlocuita += min(...)`). Un retur acoperit integral primește `inchis_la`.
   - Ecranul „Recepție pe repere” trimite diferența față de valoarea citită, cu verificarea că valoarea curentă e cea citită. Dacă între timp s-a schimbat ceva, cere reîncărcare.
4. **`fn_cf_intra_stoc(p_cheie, p_linie_id, p_cantitate)`**: înlocuiește perechea din client „rezervare + insert mișcare” din `intraInStoc` cu o tranzacție.
   - Lock pe linie; `p_cantitate ≤ primit, dar neintrat`.
   - Mișcarea `intrare_achizitie`, apoi `intrata_stoc += p_cantitate`.
   - „Predare parțială” și „Predare magazie” folosesc numai acest RPC.
5. **`fn_cf_retur_inchide_fara_inlocuire(p_cheie, p_retur_id, p_motiv)`**: pentru cazul în care furnizorul nu mai trimite marfă (notă de credit sau renunțare). Pune `asteapta_inlocuire = false` și `inchis_la`; nu atinge stocul.

### 3.4 Interfață (`Achizitii.jsx`, cardul comenzii)

- **„↩️ Retur” pe reperele cu primit net > 0.** Fereastra arată:
  - maximul returnabil și cât iese din stoc, din ce locație;
  - motivul, PV-ul sau poza, „așteptăm înlocuire”.
  - La trimitere, cheia (uuid) se generează o singură dată pe deschiderea ferestrei. O reîncercare după timeout trimite aceeași cheie și primește rezultatul deja comis.
- **Pe reper:**
  - „primit X · returnat Y · net Z”;
  - „⏳ de înlocuit N” cât timp există retururi deschise;
  - pe fiecare retur deschis: „Anulează returul” și „Închide fără înlocuire”, cu motiv.
- **Recepția redeschisă:** „📦 Recepție pe repere” și „🏬 Predare în stoc” apar și în `receptionata` / `in_stoc` cât timp „de înlocuit” > 0 sau există marfă primită, dar neintrată.
- **Istoricul retururilor pe comandă:** retururi, anulări, înlocuiri, închideri, cu cine și când.
- **Magazie:** mișcările `retur_furnizor` și `retur_furnizor_anulare` apar în istoricul de stoc, cu comanda.

### 3.5 Cererile interne

`trg_cfl_sync_cereri` recalculează starea cererii la orice UPDATE pe linie, dar `fn_cerere_rollup_status` se uită doar la **statusul** comenzilor de furnizor legate, nu la cantități. Returul, anularea și recepția incrementală nu schimbă statusul comenzii, deci starea cererii rămâne aceeași. Proba din §5 verifică asta explicit, inclusiv pentru un retur fără înlocuire.

### 3.6 Ce NU face

- Nu trimite nimic furnizorului.
- Nu atinge facturi sau note de credit.
- Nu schimbă statusul comenzii.
- Nu face retur pe comenzile de servicii.

## 4. Variante respinse

- **B. Doar ieșire din Magazie de tip „retur furnizor”, cu comanda trecută pe bon.**
  - Mai ieftin, dar comanda rămâne „completă”.
  - Înlocuirea nu se poate recepționa pe linie.
  - Achizițiile nu văd returul.
- **Retur ca status nou al comenzii întregi.** Returul e pe reper și pe cantitate, nu pe comandă; o comandă are de obicei mai multe repere.

## 5. Riscuri și probe (pentru plan și review)

Fiecare probă are și un mutant care trebuie să pice: se scoate lock-ul, reverificarea sau CHECK-ul corespunzător.

1. **Invarianții (§3.0)** pe secvențe aleatoare de recepție, predare, retur, anulare, înlocuire și închidere: CHECK-urile nu se încalcă niciodată, iar suma mișcărilor de stoc pe linie = `intrata_stoc − iesita_retur`. Test de proprietate, minim 200 de secvențe.
2. **Concurență:**
   - două retururi simultane pe aceeași linie;
   - două retururi pe linii diferite, cu aceeași denumire și locație, dintr-un stoc de 50 (40 + 40, unul refuzat);
   - retur concurent cu `fn_stoc_ajustare` minus;
   - recepție veche contra retur nou.
   Toate cu barieră.
3. **Retragerea dreptului** între verificare și scriere, pe fiecare RPC: refuz. Reconcilierea cheii comise de autor merge.
4. **Idempotență:** aceeași cheie repetată nu are efect dublu, iar o cheie cu alt payload e refuzată.
5. **Anulare:** o singură dată; refuzată după înlocuire; pune la loc exact `din_stoc`.
6. **Înlocuire:** parțială, multiplă, peste mai multe retururi, în ordinea vechimii; închiderea fără înlocuire.
7. **Cererile interne:** statusul cererii legate e identic înainte și după fiecare operație.
8. **Revenire:**
   - scriptul ia lock pe `comenzi_furnizor_linii` și `comenzi_furnizor_retururi` înaintea verificării;
   - refuză dacă există retururi, mișcări `retur_furnizor*` sau contori nenuli;
   - restaurează `fn_stoc_ajustare` și varianta din client a `intraInStoc`.
9. **Non-owner:** toate căile rulate și cu un utilizator achiziții fără drept de owner, plus refuzul pentru un utilizator fără drept.

## 6. Livrare

Felii, toate cu PR draft:
1. **BD:** migrare (contori, tabel, tipuri de mișcare) + RPC-urile §3.3 + `fn_stoc_blocheaza` și adoptarea lui în `fn_stoc_ajustare` + teste pglite cu mutanți + probă pe clona 176. Aplicarea pe producție doar cu „da”, în fereastra L15.
2. **Interfață:** recepția incrementală și predarea prin RPC, butonul Retur, anularea, închiderea, etichetele, istoricul și redeschiderea recepției.

Review: Jakarinos pe fiecare felie. Codul îl scrie Rocky.

Până la livrare (varianta **C**): în Magazie, ieșire `ajustare_minus` din locația comenzii, cu motivul „retur furnizor, comanda <număr>, <reper>”. Marfa conformă primită în schimb intră cu `ajustare_plus`, cu motivul „înlocuire retur, comanda <număr>”, pentru că linia comenzii figurează deja ca primită integral.
