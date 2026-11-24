# Achiziții: retur la furnizor pe reperele unei comenzi (TKT-2026-0347) — specificație v1

Data: 24.11.2026 · Stare: propunere, de aprobat · Varianta aleasă de owner: **A** (retur pe linia de comandă, cu ieșire automată din stoc). Până la livrare se aplică **C**: ieșire manuală din Magazie (`ajustare_minus`) cu motivul „retur furnizor, comanda …”.

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
- **Fluxul comenzii:** `draft → in_aprobare → emisa → in_tranzit → ajunsa → receptionata → in_stoc`.
  - „Recepție pe repere” apare doar în `emisa`, `in_tranzit` și `ajunsa`.
  - „Predare parțială în stoc” apare până la `receptionata`.
- **Triggere pe linii** (sincronizarea cu cererile interne, `trg_cfl_sync_cereri`, și potrivirea automată, `trg_cfl_automatch`) reacționează la cantități. Returul nu trebuie să redeschidă cereri interne deja satisfăcute: din punctul de vedere al cererii, marfa vine oricum, prin înlocuire.

## 3. Ce se construiește

### 3.1 Date (migrare, L15 v2, neaplicată până la „da”)

- **Tabel nou `comenzi_furnizor_retururi`:**
  - `id`, `comanda_furnizor_id`, `linie_id` (FK la `comenzi_furnizor_linii`);
  - `cantitate numeric > 0`, `motiv text NOT NULL` (minim 5 caractere);
  - `pv_retur_path text NULL` (PV sau poză, în bucket-ul existent al comenzilor);
  - `asteapta_inlocuire boolean NOT NULL DEFAULT true`;
  - `stoc_miscare_id` (FK la `stocuri_miscari`, NULL dacă marfa nu intrase în stoc);
  - `creat_de`, `creat_la`.
  - Fără UPDATE sau DELETE directe. Corectura se face cu un retur de semn invers, adică „anulare retur”, tot prin RPC și cu motiv.
- **Coloană nouă pe linie: `cantitate_returnata numeric NOT NULL DEFAULT 0 CHECK (>= 0)`.** Liniile existente rămân la 0; nu se schimbă nicio cantitate existentă.
- **CHECK-ul pe `stocuri_miscari.tip`** primește `retur_furnizor`: delta negativă, `ref_tip = 'comanda_furnizor_retur'`.
- RLS, GRANT-uri și REVOKE după regulile repo-ului. Tabelul nou e citibil de cine vede comanda.

### 3.2 RPC `fn_cf_retur_inregistreaza(p_linie_id, p_cantitate, p_motiv, p_pv_path, p_asteapta_inlocuire)`

`SECURITY DEFINER`, `search_path` fix. Într-o singură tranzacție:

1. **Drept:** același drept ca la recepție, adică achiziții cu drept de creare, sau owner. Se verifică după lock (L01).
2. **Lock** pe linie (`FOR UPDATE`).
3. **Validări:** `cantitate > 0` și `cantitate ≤ cantitate_primita − cantitate_returnata`.
4. **Partea din stoc:** `min(cantitate, cantitate_intrata_stoc − (ce s-a scos deja din stoc prin retur))`. Dacă e mai mare decât 0:
   - se verifică stocul curent pe locația comenzii, pentru acea denumire;
   - dacă nu ajunge, refuz cu mesaj: „în stoc sunt doar X; restul a fost consumat sau transferat”;
   - altfel se inserează mișcarea `retur_furnizor` cu delta negativă.
5. **Pe linie:** `cantitate_returnata += cantitate` și `cantitate_primita −= cantitate`.
6. **Pe stocul liniei:** `cantitate_intrata_stoc −= partea din stoc`. Așa înlocuirea poate intra din nou prin fluxul normal.
7. Se inserează rândul în `comenzi_furnizor_retururi` și se întoarce rândul creat.

Statusul comenzii nu se schimbă automat. O comandă `in_stoc` cu înlocuire așteptată redeschide doar recepția pe repere (vezi 3.3).

### 3.3 Interfață (`Achizitii.jsx`, cardul comenzii)

- **Pe fiecare reper cu `cantitate_primita > 0`: buton „↩️ Retur”**, vizibil pentru cine are dreptul de recepție. Se deschide o fereastră cu:
  - cantitatea (maximul precompletat);
  - motivul;
  - PV-ul sau poza (opțional);
  - „Așteptăm înlocuire de la furnizor” (bifat implicit).
  - Fereastra arată cât iese din stoc și din ce locație.
- **Pe reper:** eticheta „↩️ returnat N” și, cât timp `asteapta_inlocuire`, „⏳ de înlocuit N”.
- **„📦 Recepție pe repere” și „🏬 Predare parțială în stoc”** apar și în `receptionata` / `in_stoc` dacă vreo linie are înlocuire așteptată. Recepția înlocuirii crește din nou `cantitate_primita`, iar predarea intră în stoc prin `intraInStoc`, neschimbat.
- **Istoricul retururilor** apare pe comandă: dată, reper, cantitate, motiv, PV, cine a înregistrat.
- **Magazie:** mișcările `retur_furnizor` apar în istoricul de stoc cu eticheta „Retur la furnizor · comanda …”.

### 3.4 Ce NU face

- Nu trimite nimic furnizorului: fără mail și fără document generat automat. PV-ul de retur rămâne document încărcat.
- Nu atinge facturarea și nici notele de credit.
- Nu schimbă cererile interne și nici statusul comenzii automat.
- Nu face retur pe comenzile de servicii (`este_servicii`).

## 4. Variante respinse

- **B. Doar ieșire din Magazie de tip „retur furnizor”, cu comanda trecută pe bon.**
  - Mai ieftin, dar comanda rămâne „completă”.
  - Înlocuirea nu se poate recepționa pe linie.
  - Achizițiile nu văd returul.
- **Retur ca status nou al comenzii întregi.** Returul e pe reper și pe cantitate, nu pe comandă; o comandă are de obicei mai multe repere.

## 5. Riscuri și probe (pentru plan și review)

1. **Concurență:** două retururi simultane pe aceeași linie nu pot depăși cantitatea primită. Se testează cu barieră și cu un mutant fără lock.
2. **Retragerea dreptului între verificare și scriere:** reverificare după lock (lecția de la DCC PR1).
3. **Stoc insuficient** (consumat sau transferat după intrare): refuz clar, fără mișcare parțială.
4. **Triggerele `trg_cfl_sync_cereri` și `trg_cfl_automatch`:** proba arată că un retur nu modifică starea cererilor interne legate.
5. **Comandă cu predări parțiale + retur + înlocuire + predare:** suma mișcărilor pe linie egalează `cantitate_intrata_stoc`.
6. **Revenire:** scriptul de revenire refuză dacă există rânduri în `comenzi_furnizor_retururi` sau mișcări `retur_furnizor`, ca să nu se piardă date.

## 6. Livrare

Felii, toate cu PR draft:
1. **BD:** migrare + RPC + teste pglite + probă pe clona 176. Aplicarea pe producție doar cu „da”, în fereastra L15.
2. **Interfață:** butonul, fereastra, etichetele, istoricul și redeschiderea recepției.

Review: Jakarinos pe fiecare felie. Codul îl scrie Rocky.

Până la livrare (varianta **C**): în Magazie, ieșire `ajustare_minus` din locația comenzii, cu motivul „retur furnizor, comanda <număr>, <reper>”. Marfa conformă primită în schimb intră cu `ajustare_plus`, cu motivul „înlocuire retur, comanda <număr>”, pentru că linia comenzii figurează deja ca primită integral.
