# Izometrie E3 — avizul Transgaz + recepția curentă (plan, varianta minimă pentru testul Janetei)

Branch `izometrie/e3`, stivuit pe `izometrie/e2` (#806). La merge-ul #806 se face retarget pe `main` înainte de ștergerea branch-ului de bază (anti-bug #1785). Sursa: design v2.3 §1.4, §2.3, §6.3 E3; decizia Razvan 21.10 (chat): varianta minimă, proiect separat „TEST IZOMETRIE”, OCR-ul (E9) mai târziu. Structura documentelor vine de la chat (două PDF-uri reale LOT 2, fără identificatori), iar exemplele de test sunt în `C:\Users\Public\claude-server\pv_test\`.

## 0. Ce face E3 minim (și ce nu)

**Face:**
- Introducerea MANUALĂ a unui document de intrare, pe două șabloane:
  - **aviz țeavă**: aviz de însoțire, de la producătorul țevii către Transgaz;
  - **listă de ambalare curbe**: TRUCK / container, prin importator.
- Scanul atașat (PDF sau poză → `imageToPdf`), cu `sha256_original` și `sha256_pdf`, marcate „declarat de client” (§1.4: SQL nu citește Storage).
- **Totaluri verificate, blocante la confirmare:**
  - țeavă: Σ m și Σ kg = totalul de pe aviz;
  - curbe: Σ bucăți, Σ pachete, Σ net (și brut, dacă e scris) = totalurile listei;
  - suma include rândurile refuzate [D#14].
- **Pe fiecare rând:** decizia `primit` | `refuzat_la_receptie` (cu motiv; nu creează bucată) | `primit_neconform` (cu motiv; intră în stare `carantina`, nedisponibil — vezi Q-E3-3).
- **Măsurătoarea la recepție față de document:**
  - lungimea pentru țeavă, unghiul pentru curbă;
  - peste toleranță → observație obligatorie pe rând;
  - neconformitatea → `primit_neconform`.
- **Confirmarea** de către gestionar (Janeta, pe depozitul avizului) → bucățile intră în registru în starea `sosit`, disponibile la montaj [D2#12], cu evenimentul `intrare_aviz`, `aviz_intrare_id`, `nr_crt_aviz`, `lot`, `greutate_kg`, `lungime_aviz_mm` / `lungime_masurata_mm`.
- **PV-ul de recepție** (nr + dată) pus pe un document confirmat → bucățile lui trec `sosit` → `receptionat`.

**Nu face (etape ulterioare):**
- OCR-ul (E9);
- certificatele 3.1 (rămân pentru E3b; alerta MEDIUM blochează doar „gata de recepție”);
- reconcilierea zilnică ERP ↔ Excel și criteriul de oprire a Excelului (E3b; cere 10 zile lucrătoare cu 0 diferențe);
- avizul intern (E7).

## 1. Modelul de date (migrarea `20261103b_izometrie_e3_documente`)

Tabelele noi au prefixul `izo_`, ca în E2. Design-ul le numește `teava_documente_intrare*` (Q-E3-1).

**`izo_documente_intrare`** (antet):
- **Identitate și legături:** `id`, `proiect_id`, `depozit_id`.
- **Tipul:** `sablon` ∈ {`aviz_teava`, `lista_ambalare_curbe`}; `sursa_tip` ∈ {`aviz_transgaz`} (E2 a folosit importul; inventarul vine mai târziu).
- **Documentul:**
  - comune: `furnizor`, `furnizor_cif`, `nr_document`, `data_document`; UNIQUE (`furnizor`, `nr_document`, `data_document`);
  - aviz țeavă: `cumparator`, `transport_nr` (T-1144), `nume_proiect`, `lot`, `loc_livrare`, `data_incarcare`, `data_descarcare`, `nr_camion`;
  - listă curbe: `factura`, `importator`, `destinatar`, `referinta_client`, `referinta_furnizor`, `placa_camion_container`.
- **Totalurile de pe document:** `total_m`, `total_kg` (țeavă); `total_bucati`, `total_pachete`, `total_net_kg`, `total_brut_kg` (curbe).
- **Scanul:** `scan_cale` (bucket `avize`, cale uuid dată de server), `sha256_original`, `sha256_pdf`, `hash_declarat_de_client` = true.
- **Starea:** `stare` ∈ {`draft`, `confirmat`, `anulat`}; `confirmat_de`, `confirmat_la`.
- **PV:** `pv_receptie_nr`, `pv_receptie_data`, `pv_pus_de`, `pv_pus_la`.
- **Audit:** `creat_de`, `creat_la`, `updated_at`.

**`izo_documente_intrare_randuri`:**
- **Legătura:** `document_id`, `nr_crt`.
- **Comune:** `serie` (țeavă: nr. țeavă; curbă: bend number), `sarja` (curbă: pipe heat number), `lot` (nr. lot, la țeavă), `specificatie`, `greutate_kg`.
- **Țeavă:** `lungime_doc_m`, `lungime_masurata_m`.
- **Curbă:** `cod`, `item`, `diametru_mm`, `perete_mm`, `unghi_doc`, `unghi_masurat`, `standard`, `cantitate`, `pachet_nr`, `dimensiuni_cm`, `net_kg`, `brut_kg`.
- **Decizia:** `decizie` ∈ {`primit`, `refuzat_la_receptie`, `primit_neconform`}, `motiv`, `observatie`, `avertismente` text[] (calculate).
- **Legătura la registru:** `bucata_id` (pus la confirmare).

**Regulile:**
- Documentul `confirmat` e imutabil: fără UPDATE / DELETE pe rânduri, iar pe antet doar PV-ul și anularea, prin funcții.
- `anulat` e permis doar fără bucăți ieșite din depozit (în E3: doar pe documente fără bucăți mutate). Anularea face storno pe evenimentul `intrare_aviz`.

## 2. Funcțiile

- **Draftul** (antet + rânduri) se scrie din UI prin RPC-uri DEFINER: `fn_izo_doc_salveaza(p_doc_id, p_versiune, p_antet, p_randuri)`, cu CAS pe `updated_at`, ca la bonul RPC. Altă cale de scriere directă nu există (REVOKE DML pentru anon / authenticated / service_role, lecția r11–r12).
- **`fn_izo_doc_verifica(p_doc_id)`** → avertismente și blocante:
  - totalurile;
  - formatul seriei `999AA99999` (avertizare);
  - coliziune canonică cu registrul sau în același document (conflict de decis);
  - caractere ușor de confundat 5/S, 0/O, 1/I, 8/B (avertizare);
  - scan dublat pe `sha256_original` sau pe (furnizor, nr, dată) (avertizare);
  - diferența măsurat ↔ document peste toleranță fără observație (blocant);
  - rând `primit_neconform` sau `refuzat` fără motiv (blocant).
- **`fn_izo_doc_confirma(p_doc_id, p_versiune)`**:
  - verifică drepturile: gestionar pe `proiect_id` + `depozit_id` (`izo_atribuiri`) sau owner;
  - verifică `fn_izo_nivel(proiect) = 'stoc'` și că nu e niciun blocant;
  - creează bucățile prin calea writer-ului (marcaj, lock-uri, eveniment `intrare_aviz`), în aceeași tranzacție.
- **`fn_izo_doc_pv(p_doc_id, p_nr, p_data)`**: bucățile `sosit` ale documentului trec în `receptionat`, cu eveniment.

**Decizia de arhitectură (Q-E3-2):** funcțiile writer din E2a cer `session_user = postgres` (N3), adică pot fi chemate doar din sesiunile chat-ului. Confirmarea din UI de către Janeta cere o intrare nouă, apelabilă din API: `fn_izo_doc_confirma`, cu verificarea de rol în corp, care cheamă intern scrierea registrului (writer).
- Ce trebuie revizuit:
  - porțile (allowlist ACL, wrapper-ele care cheamă writer-ul, închiderea citirilor) primesc explicit noua intrare;
  - ea scrie DOAR bucăți ale propriului document, cu stare impusă (`sosit` / `carantina`) și proiect / depozit luate din document, nu din argumente.
- Asta e o lărgire a suprafeței privilegiate. De aceea ar trebui revizuită separat (Copilot / Jak) înainte de cod.

## 3. Storage

- Bucket-ul `avize` e privat, cu căi `proiect/<uuid>.pdf`.
- **Politici:**
  - INSERT pentru gestionarul proiectului;
  - DELETE doar cât documentul e `draft`;
  - UPDATE niciodată;
  - SELECT pentru gestionar, owner și cei atribuiți proiectului.
- Edge-ul pentru `sha256` pe server vine în E9. Până atunci, hash-ul e declarat de client și e afișat așa.

## 4. UI (Magazie → „🧾 Documente de intrare”, `src/IzoDocumenteIntrare.jsx`)

- **Lista** documentelor proiectului: stare, totaluri, „are PV”.
- **Editorul**: antetul pe șablon + tabelul de rânduri (adăugare rând, lipire din Excel / tabel).
- **Pe fiecare rând:** decizie, motiv, măsurat; totalurile calculate lângă cele de pe document (verde / roșu); avertismentele.
- **Butoanele:** „Verifică” (fn_izo_doc_verifica), „Confirmă recepția” (doar gestionar / owner, activ doar fără blocante), „Pune PV”.
- Reutilizează `imageToPdf` (CitesteOricePanel) pentru poze și stilul existent (G / S).

## 5. Testele

- **Harness** (pe schema E2a):
  - un document cu sume greșite nu se confirmă;
  - un rând refuzat nu creează bucată, iar suma bate cu el inclus;
  - un document confirmat dă bucăți `sosit`, apoi PV → `receptionat`;
  - un neconform dă `carantina` (nedisponibil);
  - dublura (furnizor, nr, dată) e refuzată;
  - confirmarea de către un ne-gestionar e refuzată;
  - un document confirmat nu se mai editează;
  - ștergerea scanului după confirmare e refuzată (politica storage, testată pe branch);
  - curse: două confirmări simultane → una;
  - anon / authenticated fără DML pe tabelele noi.
- **Datele de test** = cele trei documente din `pv_test` (aviz 6 m OK, aviz 12 m cu rândul 7 refuzat și rândul 11 măsurat 12,19 / 12,22, lista curbe cu 9006 neconformă 45° → 30°):
  - ținta: 40 de bucăți disponibile, 259,73 m (după lungimea din document), + 1 curbă în carantină;
  - cu lungimile măsurate: 259,70 m (`totals.json` → `alt.lungime_masurata`).

## 6. Proiectul de test „TEST IZOMETRIE” (datele le aplică chat-ul, după merge-ul E2 și „da”-ul lui Razvan)

E2 e deja izolat pe proiect: registrul, nivelul, atribuirile, depozitul și citirea sunt toate pe `proiect_id`. Pentru testul Janetei nu trebuie cod nou, doar date:
1. Un rând în `executie_proiecte` („TEST IZOMETRIE”, cod intern `TEST-IZO`), cu un site propriu.
2. Un depozit pe site-ul acela (`logistica_depozite`, ex. „DM TEST IZO”).
3. Atribuirile în `izo_atribuiri`: Janeta `gestionar` pe proiect și depozit; Razvan owner (are deja bypass).
4. `fn_izo_seteaza_nivel(<proiect_test>, 'stoc', 'test Janeta')`.
5. Datele de test, pe calea importului (`fn_izo_import_sold_initial`), din payload-ul generat de `scripts/izometrie/payload_test_avize.mjs` (preview + sha256; vine pe acest branch).

**Atenție:**
- Registrul e append-only. Datele de test rămân pentru totdeauna pe proiectul de test (se pot doar storna). LOT 2 nu e atins.
- Rapoartele / listele care agregă toate proiectele ar trebui să poată ascunde `TEST-IZO`. Propun un filtru pe codul intern, fără schemă nouă.

## 7. Întrebări deschise (A / B / C)

- **Q-E3-1, numele tabelelor:**
  - A `izo_documente_intrare*` (ca E2, recomandat);
  - B `teava_documente_intrare*` (ca design-ul).
- **Q-E3-2, confirmarea din UI:**
  - A intrare API nouă, cu rolul verificat în corp și revizuită separat (recomandat; altfel Janeta nu poate confirma singură);
  - B gestionarul pregătește draftul, iar confirmarea o face chat-ul / owner-ul din sesiune postgres (nepractic zilnic).
- **Q-E3-3, neconformitatea la recepție** (ex. curba măsurată la alt unghi). D#14 spune „refuz, fără carantină”, dar E2 a introdus `carantina` pentru cele 2 țevi LOT 2 la decizia lui Razvan, iar fișa de test cere carantină:
  - A `primit_neconform` → `carantina` (recomandat, aliniat cu E2 și cu testul);
  - B doar refuz.
- **Q-E3-4, toleranțele măsurat ↔ document:**
  - lungime: propun ±10 mm pe țeavă (12,19 față de 12,22 = 30 mm → observație obligatorie);
  - unghi: ±0,5°.
- **Q-E3-5, ce intră în `lungime_mm` (lungimea curentă a bucății):**
  - A cea măsurată când există, altfel cea din document (recomandat: montajul folosește realul);
  - B cea din document.
- **Q-E3-6, curbele în registru:**
  - serie = bend number, șarjă = heat, unghiul;
  - `cod`-ul complet păstrat în `atribute`;
  - pachetul (2 curbe / pachet) doar pe rândul documentului, nu ca entitate.

## 7b. E3b — corecțiile (decizia Razvan A, 21.10.2026): după E3, ÎNAINTE de prima recepție reală pe LOT 2

E3 livrează doar căile „normale” plus două corecții: anularea ciornei de către gestionar și înlocuirea unui document anulat pe id + motiv (design r5d §13.3–13.4). Restul corecțiilor din `C:\Users\Public\livrare\izo_gaps.txt` intră într-o etapă scurtă, E3b, cu propriul design revizuit și propria migrare. Toate au același tipar ca E3: funcție administrativă sau API cu rol verificat, context de operație în gardă, eveniment + mișcări în registru (doar adaug), motiv obligatoriu, responsabilul pe proiect.
- **corecție de câmp pe o bucată:** eveniment `corectie` + mișcare `corectat`, cu `inainte` / `dupa` (doar câmpurile corectabile, pe o listă revizuită), motiv; doar responsabilul;
- **pierdut / găsit:** evenimentele `pierdut` / `gasit` (există deja în CHECK-ul E2a), cu motiv și locul găsirii;
- **carantina:** ieșirea din carantină (decizie, motiv) și intrarea în carantină după recepție;
- **storno parțial pe import:** pe o listă de bucăți, fail-closed ca storno-ul complet (refuz peste mișcări ulterioare);
- **corecție doar pe PV:** numărul / data PV-ului, fără să atingă stările bucăților (eveniment de corecție legat de `receptie_pv`);
- **istoricul ciornei:** versiunile unui draft (cine, când, ce s-a schimbat), fără să intre în hash-ul documentului.

Ordinea: design E3b → review Copilot + Jakarinos → migrare + harness → aplicare (chat-ul, după „da”-ul lui Razvan) → abia apoi prima recepție reală pe LOT 2.

## 8. Ordinea livrării

1. Acest plan (review + răspunsuri la Q-E3-1…6).
2. Scriptul de payload de test (`payload_test_avize.mjs`), util imediat după merge-ul E2.
3. Migrarea 20261103b (tabele + RPC-uri + porți actualizate + storage), harness-ul, revenirea, testul PG17 pe branch.
4. UI-ul.
5. Testul cu Janeta: aceleași 3 documente, introduse de ea.
