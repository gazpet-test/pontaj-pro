# Oferte probe de presiune: mai multe tronsoane cu setări diferite pe aceeași ofertă (TKT-2026-0349) — specificație v1

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

1. **Coloană nouă `probe_oferte.tronsoane jsonb NULL`:** listă ordonată de tronsoane `{dn_id, lungime_m, presiune_bar, config_id, tip_fluid, eticheta}`.
   - NULL = oferta veche, cu un singur calcul. Rămâne **exact** cum e azi, citită și editată pe calea veche.
   - O ofertă nouă cu ≥ 2 tronsoane folosește `tronsoane`, iar `calc_id` rămâne NULL.
   - CHECK: dacă nu e NULL, e un array cu 2–20 de elemente, fiecare cu câmpurile obligatorii și valori pozitive. Validarea structurii e în BD; validarea valorilor față de catalog (DN, configurație) e în ecran și în RPC-ul de salvare (punctul 5).
2. **Calculul pe tronson:** `calcProbe` pe fiecare tronson, iar pentru aer `pretPropusProba` pe fiecare (cu sporul configurației lui). Pistonarea, uscarea și calibrarea se calculează pe tronson, ca azi, și se adună.
3. **Agregarea pe ofertă:**
   - **Transportul se ia o singură dată**, după categoria de utilaj cea mai „grea” dintre tronsoane (ordinea categoriilor din `calcTransport`), pe distanța ofertei.
   - **Podeaua minimă de preț** se aplică o singură dată, pe **totalul** probelor, nu pe fiecare tronson. Un tronson mic nu mai e ridicat separat la podea.
   - Discountul se aplică pe totalul probelor, ca azi pe `proba_lei`.
   - `proba_lei`, `pistonare_lei`, `uscare_lei` și `calibrare_lei` = sumele pe tronsoane, salvate în câmpurile existente. Așa, lista ofertelor, totalurile și rapoartele de azi funcționează fără schimbări.
4. **Ecranul (`Ofertare.jsx`, fereastra ofertei de probă):**
   - butonul „+ Tronson” transformă calculul din fereastră într-o listă: DN, lungime, presiune, configurație filtrată după presiune (ca azi), etichetă;
   - sub listă apar totalurile și regula aplicată („transport o singură dată: categoria X”; „podea aplicată pe total: da / nu”);
   - eliminarea până la un singur tronson revine la forma de azi.
5. **Salvarea:**
   - atomică, prin update-ul existent;
   - validarea din ecran se repetă la salvare: fiecare `dn_id` și `config_id` există, iar configurația suportă presiunea tronsonului;
   - o ofertă `trimisa` nu se mai poate edita, ca azi.
6. **PDF și Excel:** tabelul tronsoanelor (etichetă, DN, lungime, presiune, fluid, volum, durată) înaintea totalurilor; ofertele vechi ies identic cu azi.

## 4. Ce NU face

- Nu schimbă formula de calcul pe tronson și nici tarifele.
- Nu migrează ofertele vechi.
- Nu leagă tronsoanele de proiectele din Execuție.

## 5. Riscuri și probe

1. **Exemplul din tichet** (10" la 36 bar + 12" la 48 bar):
   - suma probelor = suma calculelor individuale;
   - transportul o singură dată;
   - podeaua aplicată doar dacă totalul e sub ea.
2. **Regresie:** o ofertă veche (`tronsoane` NULL) are aceleași valori, același PDF și același Excel ca înainte (test pe ofertele existente, comparat cu `main`).
3. **Configurația care nu suportă presiunea unui tronson:** salvarea e refuzată, cu tronsonul numit.
4. **Un singur tronson în listă:** revine la forma veche (`tronsoane` NULL).
5. **Apă și aer amestecate pe aceeași ofertă:** permis. Pistonarea, uscarea și calibrarea apar doar pentru aer, ca azi.
6. **Migrarea:** L15 v2, doar coloana + CHECK. Revenirea refuză dacă există oferte cu `tronsoane` diferit de NULL.

## 6. Livrare

- Un PR: migrare (NEAPLICATĂ) + `probeCalc` (o funcție pură `agregaTronsoane`, testată) + ecran + PDF / Excel.
- Review Jakarinos, probă pe clonă.
- Aplicarea doar cu „da”, după ce owner-ul reia tichetul.
