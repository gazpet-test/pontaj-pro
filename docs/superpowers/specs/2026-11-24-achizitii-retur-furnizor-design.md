# Achiziții: retur la furnizor pe reperele unei comenzi (TKT-2026-0347) — specificație v4

Data: 24.11.2026 · Stare: v4 după a treia rundă de review NO-GO (24.11), de aprobat · Varianta aleasă de owner: **A** (retur pe linia de comandă, cu ieșire automată din stoc). Până la livrare se aplică **C**: ieșire manuală din Magazie (`ajustare_minus`) cu motivul „retur furnizor, comanda …”.

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
- **Triggere pe linii** (sincronizarea cu cererile interne, `trg_cfl_sync_cereri`, și potrivirea automată, `trg_cfl_automatch`) reacționează la cantități. Pe producție, `fn_cfl_automatch` setează doar legătura la INSERT, iar `fn_cerere_rollup_status` se uită numai la statusul comenzilor de furnizor, nu la cantități (vezi §3.5).

## 3. Ce se construiește

### 3.0 Sensul cantităților (runda 3: sensul de azi rămâne neschimbat)

`cantitate_primita` **își păstrează sensul de azi**:
- e cantitatea efectivă a reperului, adică `qtyEfectiva`;
- NULL înseamnă „recepție fără repere”, deci cantitatea comandată;
- o folosesc PV-urile, lista de repere pentru transport (`achizitiiListaRepere.js`) și predarea în stoc.

Returul o **scade**, iar recepția unei înlocuiri o **crește**. Așa, toate documentele și transporturile existente arată în continuare „ce avem efectiv de la furnizor”, fără nicio schimbare în codul lor.

`cantitate_intrata_stoc` își păstrează sensul: ce e intrat în stoc din linie și încă al ei. Returul din stoc o **scade** cu partea scoasă din stoc.

Istoricul cumulat (cât s-a returnat, cât s-a înlocuit, cât s-a anulat) stă **doar** în tabelul `comenzi_furnizor_retururi`, nu în contori pe linie.

Liniile cu `cantitate_primita = NULL`:
- NULL înseamnă „recepție fără repere”. Asta dovedește că marfa a sosit **doar** dacă există o recepție, adică comanda are `receptie_mp_la` sau `receptie_achizitii_la`, statusul e `receptionata` / `in_stoc`, sau `cantitate_intrata_stoc > 0`.
- În aceste cazuri, la prima operație nouă, RPC-ul transformă NULL în `cantitate`, sub lock-ul liniei.
- Altfel (comandă emisă, în tranzit, ajunsă fără recepție) returul și anularea sunt refuzate cu „faceți întâi recepția”. Recepția incrementală pornește de la 0.

Reguli, toate verificate sub lock:
- **Returnabil maxim** = `primita` efectivă. Pe exemplul din review: 100 primite, un retur de 40 lasă 60, iar al doilea retur poate fi de până la 60.
- **Partea din stoc a unui retur** (`din_stoc`):
  - implicit `min(cantitate, intrata_stoc)`;
  - în fereastră se poate alege explicit, între `max(0, cantitate − (primita − intrata_stoc))` și `min(cantitate, intrata_stoc)`;
  - restul vine din marfa primită, dar neintrată.
  - Pe exemplul din review: 100 primite, 40 intrate, două retururi de câte 20 din stoc. `intrata_stoc` scade 40 → 20 → 0 și fiecare retur scoate 20 din stoc. Nu se scade nimic de două ori, pentru că nu există un al doilea contor.
- **CHECK pe linie:** `cantitate_intrata_stoc ≤ coalesce(cantitate_primita, cantitate)`. Pe datele de azi e adevărat; proba de pe clonă o verifică înainte de aplicare.

### 3.1 Date (migrare L15 v2, neaplicată până la „da”)

- **Pe `comenzi_furnizor_linii`:** fără coloane noi, doar CHECK-ul de mai sus (cu `NOT VALID` + `VALIDATE` după verificarea de pe clonă).
- **Tabel nou `comenzi_furnizor_retururi`** (fără UPDATE sau DELETE directe):
  - Identificare: `id`, `comanda_furnizor_id`, `linie_id`.
  - `tip`: `'retur' | 'anulare'`.
  - `retur_id`: FK, obligatoriu la `anulare`; `UNIQUE (retur_id)`, deci o anulare pe retur.
  - `cantitate`: `> 0`, sensul îl dă `tip`. `din_stoc`: `0 ≤ din_stoc ≤ cantitate`.
  - `motiv` (minim 5 caractere), `pv_retur_path`.
  - Înlocuirea:
    - `asteapta_inlocuire`;
    - `cantitate_inlocuita` (`0 ≤ cantitate_inlocuita ≤ cantitate`), crescută doar de RPC-ul de recepție;
    - `inchis_la`, `inchis_motiv`.
    - Pentru că tabelul e „fără UPDATE direct”, doar RPC-urile pot schimba câmpurile de înlocuire și închidere; un trigger refuză orice alt UPDATE.
  - `stoc_miscare_id`, `cheie uuid UNIQUE`, `payload_hash`, `creat_de`, `creat_la`.
- **Tipuri noi de mișcare:** `retur_furnizor` (delta < 0) și `retur_furnizor_anulare` (delta > 0), ambele cu `ref_tip = 'comanda_furnizor_retur'`.
- **RLS:** tabelul se poate citi de cine vede comanda. Scrierea directă e revocată tuturor; se scrie doar prin RPC.

### 3.2 Serializarea pe stoc: un singur punct, pentru toate căile

În loc să adaptez fiecare cale care scade stocul (unele scriu direct din client), lock-ul stă **în baza de date, pe mișcare**:
- un trigger `BEFORE INSERT ON stocuri_miscari FOR EACH ROW WHEN (NEW.delta < 0)` ia `pg_advisory_xact_lock` pe cheia stocului (hash pe locație + denumire normalizată);
- orice ieșire, din orice cale (RPC sau client), se serializează pe aceeași cheie;
- trigger-ul **nu** schimbă regulile existente: o ajustare sau un consum care duce stocul pe minus merge în continuare, ca azi.

Returul ia **același** lock **înainte** să verifice stocul (prin helperul `fn_stoc_blocheaza`, care ia lock-ul și citește `stocuri.cantitate`). De aceea o altă ieșire concurentă fie s-a comis înainte, și returul vede stocul scăzut, fie așteaptă după retur.

Așa, returul nu poate duce stocul pe minus. Celelalte căi rămân cum sunt, iar trecerea lor la „fără minus” ar fi o decizie separată.

Ordinea fixă a lock-urilor: linia comenzii (`FOR UPDATE`) → cheia de stoc → rândul de retur, la anulare și înlocuire.

### 3.2b Protecția cantităților liniei, pe toate căile

- Pe `comenzi_furnizor_linii`, coloanele `cantitate_primita` și `cantitate_intrata_stoc` nu mai pot fi scrise direct:
  - `REVOKE UPDATE (cantitate_primita, cantitate_intrata_stoc)` de la `authenticated` și `anon`;
  - plus un trigger `BEFORE UPDATE` care refuză orice schimbare a lor dacă nu vine dintr-un RPC al acestui modul (marcaj de tranzacție `set_config('app.cf_cantitati', '1', true)`, pus doar de RPC-uri).
- Un client vechi, rămas deschis, care încearcă `update({ cantitate_primita })` primește eroare și mesajul „reîncărcați pagina”. Nu se poate suprascrie un retur.
- Celelalte coloane ale liniei (denumire, preț, termen, observații) rămân editabile ca azi.

### 3.3b Recepția cu transport direct și locația returului

- `finalizeazaReceptieTransport` (intrare în sediu și transfer pe proiect, „transport direct”) trece și el prin `fn_cf_intra_stoc`, cu parametrul `p_transfer_proiect`. Intrarea, transferul și `intrata_stoc += N` se fac într-o singură tranzacție.
- **Locația returului.** Marfa unei linii poate fi la sediu sau pe proiect, după transfer. Returul primește `p_locatie_tip` / `p_locatie_id`:
  - fereastra oferă doar locațiile comenzii (sediul și proiectul ei), cu stocul curent din fiecare;
  - lock-ul (§3.2) se ia pe cheia locației alese.
- **Datele existente.**
  - Proba de pe clonă listează liniile din comenzi `in_stoc` primite prin transport direct, care au `intrata_stoc = 0` deși au mișcări `intrare_achizitie` cu `ref_id` = comanda.
  - Corectura lor (`intrata_stoc` = suma acelor mișcări) e **DML pe date reale** și se aplică doar după preview și „da”, înaintea primului retur pe acele comenzi.
  - Până atunci, RPC-ul de retur refuză liniile cu mișcări de intrare care nu se potrivesc cu `intrata_stoc` („recepție veche nereconciliată”).

### 3.3 RPC-uri (`SECURITY DEFINER`, `search_path` fix, dreptul reverificat DUPĂ lock-uri — L01)

Dreptul: achiziții cu drept de creare sau owner. Toate primesc `p_cheie uuid`:
- aceeași cheie cu același payload întoarce rezultatul deja comis;
- aceeași cheie cu alt payload e refuzată;
- reluarea se face pe identitatea autorului; o scriere nouă cere dreptul.

1. **`fn_cf_retur_inregistreaza(p_cheie, p_linie_id, p_cantitate, p_din_stoc NULL, p_motiv, p_pv_path, p_asteapta_inlocuire)`**
   1. Lock pe linie, apoi transformarea NULL → `cantitate`, apoi lock pe stocul liniei, apoi reverificarea dreptului.
   2. Validări: `0 < cantitate ≤ primita`; `din_stoc` (implicit sau dat) în intervalul de la §3.0; stocul ≥ `din_stoc`, altfel refuz cu „în stoc sunt doar X”.
   3. Dacă `din_stoc > 0`, mișcarea `retur_furnizor` (−`din_stoc`) din locația aleasă (§3.3b). Dacă `din_stoc = 0`, nu se scrie nicio mișcare și `stoc_miscare_id` rămâne NULL. Apoi `primita −= cantitate` și `intrata_stoc −= din_stoc`, apoi rândul `retur`.
2. **`fn_cf_retur_anuleaza(p_cheie, p_retur_id, p_motiv)`**
   - Se refuză dacă returul e deja anulat sau dacă `cantitate_inlocuita > 0`.
   - Aceleași lock-uri, apoi mișcarea `retur_furnizor_anulare` (+`din_stoc`, doar dacă `din_stoc > 0`, în aceeași locație ca returul), apoi `primita += cantitate`, `intrata_stoc += din_stoc`.
   - Rândul `anulare`; returul primește `inchis_la` și motivul.
3. **`fn_cf_receptie_adauga(p_cheie, p_linie_id, p_cantitate_sosita, p_primita_citita)`**: recepția incrementală.
   - Verificare: `primita` curentă = `p_primita_citita`, altfel `valoare_schimbata` (recepția din formular nu mai poate suprascrie un retur).
   - Apoi `primita += N`, iar N acoperă retururile deschise care așteaptă înlocuire, în ordinea vechimii; un retur acoperit integral se închide.
   - „Recepție pe repere” trimite doar diferența. Când o valoare scade (corectură sau „reper anulat de furnizor = 0”), N e negativ, dar numai până la `intrata_stoc`; sub ea e refuz, iar pentru asta există returul.
   - **Compensarea la N negativ:** corectura scade întâi `cantitate_inlocuita` pe retururile acoperite de recepții, în ordinea inversă a alocării (cel mai nou întâi). Fiecare retur atins se redeschide (`inchis_la = NULL`), iar `asteapta_inlocuire` revine pe adevărat. Alocările stau într-un jurnal `comenzi_furnizor_retur_alocari` (retur, recepția care a alocat, cantitate), ca inversarea să fie exactă.
4. **`fn_cf_intra_stoc(p_cheie, p_linie_id, p_cantitate)`**: înlocuiește perechea din client „rezervare + insert” din `intraInStoc`.
   - Lock pe linie; `p_cantitate ≤ primita − intrata_stoc`.
   - Mișcarea `intrare_achizitie`, apoi `intrata_stoc += p_cantitate`.
5. **`fn_cf_retur_inchide_fara_inlocuire(p_cheie, p_retur_id, p_motiv)`**: `asteapta_inlocuire = false` și `inchis_la`.

### 3.4 Interfață (`Achizitii.jsx`, cardul comenzii)

- **„↩️ Retur” pe reperele cu primit net > 0.** Fereastra arată:
  - maximul returnabil și cât iese din stoc, din ce locație;
  - motivul, PV-ul sau poza, „așteptăm înlocuire”.
  - La trimitere, cheia (uuid) se generează o singură dată pe deschiderea ferestrei. O reîncercare după timeout trimite aceeași cheie și primește rezultatul deja comis.
- **Pe reper:**
  - „primit (efectiv) X · returnat Y” (Y din tabelul de retururi);
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

1. **Invarianții (§3.0)** pe secvențe aleatoare de recepție, predare, retur, anulare, înlocuire și închidere: CHECK-ul nu se încalcă; suma mișcărilor de stoc pe linie = `intrata_stoc`; `primita` = recepții − retururi + anulări; liniile cu `primita = NULL` se comportă ca azi până la prima operație nouă. Test de proprietate, minim 200 de secvențe. Plus: PV-urile și lista de repere pentru transport, generate înainte și după, folosesc aceeași `qtyEfectiva`.
2. **Concurență:**
   - două retururi simultane pe aceeași linie;
   - două retururi pe linii diferite, cu aceeași denumire și locație, dintr-un stoc de 50 (40 + 40, unul refuzat);
   - retur concurent cu `fn_stoc_ajustare` minus;
   - recepție veche contra retur nou.
   Toate cu barieră.
3. **Retragerea dreptului** între verificare și scriere, pe fiecare RPC: refuz. Reconcilierea cheii comise de autor merge.
4. **Idempotență:** aceeași cheie repetată nu are efect dublu, iar o cheie cu alt payload e refuzată.
5. **Anulare:** o singură dată; refuzată după înlocuire; pune la loc exact `din_stoc`.
6. **Înlocuire:** parțială, multiplă, peste mai multe retururi, în ordinea vechimii; închiderea fără înlocuire; corectura negativă după o înlocuire redeschide exact returul atins.
10. **Căi vechi:** un client vechi care scrie direct `cantitate_primita` e refuzat; recepția prin transport direct actualizează `intrata_stoc`; un retur pe o comandă emisă fără recepție e refuzat; un retur doar din marfă neintrată nu scrie mișcare.
7. **Cererile interne:** statusul cererii legate e identic înainte și după fiecare operație.
8. **Revenire:**
   - scriptul ia lock pe `comenzi_furnizor_linii` și `comenzi_furnizor_retururi` înaintea verificării;
   - refuză dacă există retururi, alocări sau mișcări `retur_furnizor*`; elimină toate obiectele noi (tabele, trigger-e, RPC-uri, REVOKE-ul pe coloane) și restaurează CHECK-urile și tipurile de mișcare de dinainte;
   - scoate trigger-ul de lock și restaurează varianta din client a `intraInStoc` și a recepției.
9. **Non-owner:** toate căile rulate și cu un utilizator achiziții fără drept de owner, plus refuzul pentru un utilizator fără drept.

## 6. Livrare

Felii, toate cu PR draft:
1. **BD:** migrare (contori, tabel, tipuri de mișcare) + RPC-urile §3.3 + trigger-ul de lock pe ieșirile din `stocuri_miscari` + `fn_stoc_blocheaza` + teste pglite cu mutanți + probă pe clona 176. Aplicarea pe producție doar cu „da”, în fereastra L15.
2. **Interfață:** recepția incrementală și predarea prin RPC, butonul Retur, anularea, închiderea, etichetele, istoricul și redeschiderea recepției.

Review: Jakarinos pe fiecare felie. Codul îl scrie Rocky.

Până la livrare (varianta **C**): în Magazie, ieșire `ajustare_minus` din locația comenzii, cu motivul „retur furnizor, comanda <număr>, <reper>”. Marfa conformă primită în schimb intră cu `ajustare_plus`, cu motivul „înlocuire retur, comanda <număr>”, pentru că linia comenzii figurează deja ca primită integral.
