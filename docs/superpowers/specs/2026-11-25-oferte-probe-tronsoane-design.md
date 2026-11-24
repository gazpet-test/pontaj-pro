# Oferte probe de presiune: mai multe tronsoane cu setări diferite pe aceeași ofertă (TKT-2026-0349) — specificație v2

Data: 25.11.2026 · Stare: propunere, varianta B. **Owner-ul a amânat tichetul (24.11):** documentul se pregătește acum, iar implementarea pornește doar când reia subiectul.

## 1. De ce

O ofertă de probă poate acoperi mai multe tronsoane cu setări diferite, de exemplu 10" la 36 bar și 12" la 48 bar. Azi o ofertă are un singur calcul (`probe_oferte.calc_id` sau calculul din fereastră): fie se fac oferte separate, fie se adună manual.

## 2. Ce există azi

- **`probe_oferte`:** câmpurile de preț (`proba_lei`, `pistonare_lei`, `uscare_lei`, `calibrare_lei`, `transport_lei`, `stat_dispozitie_lei`, `extra_lei`, `discount_pct`, bifele `inc_*`, `total_lei`), clientul, contactul și `calc_id`.
- **Motorul `calcProbe`** (`src/utils/probeCalc.js`): volum, durate și consum pe un tronson (DN, lungime, presiune, configurație aer / apă).
- **`pretPropusProba`:** prețul de referință + sporul configurației + podeaua minimă pe probă (`PRAG_MINIM_PROBA_LEI`, deja în cod).
- **`calcTransport(categorie, km)`:** după categoria utilajului.
- **PDF-ul și exportul Excel** ale ofertei, pe un singur calcul.

## 3. Ce se construiește (B)

1. **Coloana nouă `probe_oferte.tronsoane jsonb NULL`.**
   - NULL = oferta veche, cu un singur calcul: rămâne **exact** ca azi.
   - O ofertă care trece o dată la mai multe tronsoane rămâne în acest mod **chiar dacă ajunge la un singur tronson** (array cu 1 element). Nu se revine la `calc_id`, deci nu se pierde sursa calculului.
   - CHECK: dacă nu e NULL, e un array cu 1–20 elemente, fiecare cu câmpurile obligatorii (vezi snapshotul de la punctul 2).
2. **Snapshotul pe tronson**, salvat în JSON și **folosit la redeschidere și la export** (nu se recalculează din catalog):
   - intrările: `dn_id`, `dn_label`, `diametru_extern_mm`, `lungime_m`, `presiune_bar`, `config_id`, `config_denumire`, `tip_fluid`, `categorie_transport`, `debit`, `tarif_lei_h` / `tarif_lei_mc`, `spor_pct`, `eticheta`;
   - rezultatele: `v_conducta_mc`, `durata_proba_h`, `durata_pistonare_h`, `durata_total_h`, `consum_motorina_l`, `pret_proba_brut`, `pistonare_lei`, `uscare_lei`, `calibrare_lei`, `ramura_pret` (`referinta` | `durata_tarif` | `apa_mc`).
   - O configurație sau un DN dezactivat ulterior nu schimbă oferta salvată. La **editarea** unui tronson, se recalculează din catalogul curent doar tronsonul editat, iar un articol dezactivat se poate păstra doar neschimbat.
3. **Prețul pe tronson (funcția pură `pretTronson`):**
   - **aer:** `pretPropusProba(..., prag_min = 0)` (fără podea pe tronson). Dacă rezultatul e neaplicabil, ramura de azi: `durata_proba_h × tarif_lei_h`. Pistonarea, uscarea și calibrarea = `durata_pistonare_h × tarif_lei_h` fiecare, ca azi;
   - **apă:** `v_conducta_mc × tarif_lei_mc`, ca azi, fără pistonare, uscare sau calibrare.
4. **Agregarea pe ofertă (funcția pură `agregaTronsoane`):**
   - `proba_lei` = max(suma `pret_proba_brut`, **podeaua o singură dată**). Podeaua se aplică doar dacă există cel puțin un tronson pe aer cu `ramura_pret = referinta`, ca azi, unde podeaua ține de prețul propus pe referință. Dacă nu, nu se aplică.
   - `pistonare_lei`, `uscare_lei`, `calibrare_lei` = sumele.
   - Discountul se aplică pe `proba_lei`, ca azi.
   - **Transportul o singură dată:** dintre categoriile de transport ale tronsoanelor se alege cea cu **cel mai mare cost pentru distanța ofertei**, calculat cu `calcTransport`. Nu se folosește o „ordine” presupusă. O categorie fără tarif → salvarea e refuzată, cu mesajul „lipsește tariful de transport pentru categoria X”, ca să nu apară un transport 0 tăcut.
   - Rezultatele se scriu în câmpurile existente (`proba_lei` etc.), deci lista și totalurile de azi funcționează neschimbate.
5. **Salvarea printr-un RPC nou `fn_probe_oferta_salveaza(p_oferta_id bigint, p_date jsonb) RETURNS jsonb`**, doar pentru ofertele în modul tronsoane:
   - `SECURITY DEFINER`, `search_path` fix, același drept ca politicile de azi ale `probe_oferte`;
   - **lock** pe rândul ofertei; refuz dacă `status = 'trimisa'` (regula nouă, aplicată pe server);
   - validează fiecare tronson față de catalog (DN și configurație existente, presiune ≤ `presiune_max_bar`) și snapshotul (recalculat pe server prin aceeași formulă, port SQL al funcțiilor pure, cu toleranță 0,01 lei);
   - scrie `tronsoane` + câmpurile agregate **atomic**;
   - creează oferta nouă în același RPC, când `p_oferta_id` e NULL.
   - Scrierea directă pe `tronsoane` e blocată: trigger care refuză orice UPDATE al coloanei în afara RPC-ului, prin marcaj de tranzacție.
   - Ofertele vechi (NULL) se salvează pe calea de azi, neschimbată.
6. **Ecranul:** „+ Tronson” transformă fereastra în lista de tronsoane, cu totalurile și regulile aplicate afișate („transport: categoria X, cel mai scump pentru Y km”; „podea aplicată: da / nu”).
7. **PDF și Excel:**
   - ofertele multi-tronson primesc un tabel al tronsoanelor din snapshot, cu **paginare**: PDF pe mai multe pagini A4, câte o captură pe pagină, cu antetul repetat; nu se comprimă totul pe o singură pagină;
   - ofertele vechi ies identic.
   - Probe cu 20 de tronsoane și etichete lungi.

## 4. Ce NU face

- Nu schimbă formula de calcul pe tronson și nici tarifele.
- Nu migrează ofertele vechi.
- Nu leagă tronsoanele de proiectele din Execuție.

## 5. Riscuri și probe

1. **Exemplul din tichet** (10" la 36 bar + 12" la 48 bar): suma = suma tronsoanelor; transportul o singură dată (cea mai scumpă categorie); podeaua o singură dată.
2. **Podeaua:** două tronsoane cu câte 1.000 brut → `proba_lei` = podeaua o dată, nu de două ori. Un tronson pe ramura `durata_tarif` → fără podea.
3. **Regresie:** ofertele vechi (`tronsoane` NULL) au aceleași valori, același PDF și același Excel ca pe `main`.
4. **Server:**
   - o configurație care nu suportă presiunea → refuz, cu tronsonul numit;
   - oferta `trimisa` → refuz;
   - un UPDATE direct pe `tronsoane` → refuz;
   - un snapshot alterat (preț ≠ recalcul) → refuz.
5. **Un singur tronson rămas:** oferta rămâne în modul tronsoane, cu calculul intact.
6. **Catalog schimbat după salvare:** redeschiderea și exportul arată valorile din snapshot.
7. **Tarif de transport lipsă** → refuz cu mesaj, nu transport 0.
8. **Migrarea** (L15 v2): coloana + CHECK + trigger + RPC.
   - Revenirea: lock `ACCESS EXCLUSIVE` pe `probe_oferte` înaintea verificării „există oferte cu `tronsoane` diferit de NULL” (refuz), apoi DROP, în aceeași tranzacție.
   - Test concurent: o salvare pornită în timpul revenirii așteaptă și apoi e refuzată, sau revenirea e refuzată.

## 6. Livrare

- Un PR: migrare (coloană + CHECK + trigger + RPC, NEAPLICATĂ) + funcțiile pure `pretTronson` / `agregaTronsoane` (testate, cu paritate față de SQL-ul din RPC) + ecran + PDF / Excel paginat.
- Review Jakarinos, probă pe clonă.
- Aplicarea doar cu „da”, după ce owner-ul reia tichetul.
