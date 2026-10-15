# TKT-2026-0329, varianta B: cantități structurate + audit al răspunsurilor Autorității

**Stare:** SPECIFICAȚIE v3 (15.10.2026), după review r2 (NO-GO de la Jakarinos și de la Copilot).

Nimic nu e implementat. Migrările, deploy-urile și orice cost AI se fac doar cu „da” de la Răzvan.
**Decizie de pornire:** Răzvan, 14.10.2026, varianta B (`claude_context` #1758).
**Studii:** Jakarinos, `C:\Users\Public\paw-data\out\tkt0329_r1_jak.log`; harta codului din această sesiune (§2).

**Istoric:**
- **v1:** NO-GO de la amândoi (r1).
- **v2:** acoperire tri-state, rezervare per apel, identitatea articolului, DN cu parserul existent, perechi de roluri, audit pe dovezi fără AI, imuabilitate, lot canonic, golden. Tot NO-GO (r2): Jakarinos 9×P1, Copilot 8×P1.
- **v3**, schimbările:
  - plafonul e comun pe licitație și scop, cu `necunoscuta` în consum;
  - blocarea se face pe **muncă** (document + sha + extractor + felie), unic în toate stările, iar reluarea e doar umană;
  - deduplicarea se face doar pe repetarea aceleiași poziții;
  - `tip_lucrare` e separat de `masura` (branșamentele și protecțiile se compară separat);
  - acoperirea e pe perechi: rolurile nerezolvate țin `incomplet`;
  - calculul e valid doar pe manifestul curent (documente, extrageri, aliasuri, decizii), deci un calcul depășit nu e niciodată verde;
  - manifestul complet e imuabil;
  - simularea retrospectivă e un calcul imuabil distinct, iar dovezile sunt separate „istoric” / „simulare”;
  - ancorele leagă obiectul, lotul și proprietatea;
  - proveniența citirii se verifică după tipul sursei, plus `text_verificat`;
  - texte pe licitație, citite doar prin RPC;
  - cererea are câmpuri imuabile și stări controlate prin RPC;
  - lotul canonic e fără NULL;
  - declanșatoarele D1 sunt concrete;
  - migrarea de bază (PR2) e separată de migrarea H2 (PR4).

## 1. Problema, pe cazul real

**Tichetul** (Oana, 06.10): F3 și ATR dau lungimi de țeavă foarte diferite (6.400 m față de 3.995 m). Platforma n-a semnalat nimic și n-a propus clarificare. Un alt ofertant a întrebat, iar Autoritatea a răspuns. Platforma trebuie să vadă răspunsul din SEAP și să arate ce nu a sesizat la analiza inițială.

**Cazul este licitația 15 (Răcari).** Documentul 1624, „Răspuns consolidat nr. 2”:
- **Solicitarea nr. 7:** Fișa de date (II.2.4), Caietul de sarcini (secț. 5) și Anexa 1 la ATR dau 3.995,00 m PEHD SDR11 Dn 90, pe 16 obiective/străzi. F3 însumează 6.400 m. Doar 3 din 16 străzi coincid.
- **Răspunsul nr. 16:** „Întocmirea ofertei se va face conform lungimilor din ATR, un total de 3.995,00 m + lungimile aferente branșamentelor conform proiectului.” Tot acolo apare +87 m branșamente Dn 32.

**La noi, pe licitația 15:** 0 rânduri în `ofertare_cantitati` (extragerea nu a rulat) și 7 clarificări proprii, niciuna despre lungimi.

**Cauze:**
1. Extragerea nu e un pas sigur, iar absența ei nu se vede. Doar licitațiile 5 și 103 au cantități; 15, 101 și 102 au 0 sau aproape 0.
2. ATR nu are identitate cantitativă: e tipat `alta`, cu `tip_sursa` null, fără valoare ATR în CHECK.
3. Rândurile nu au pagină, DN, material, obiect structurat sau versiune de document.
4. H2 compară sume globale în metri și citește F3 din registrul vechi. `v_ofertare_contradictii` nu are consumator.
5. Clarificările primesc doar rândurile cu `diferenta_nota`, maximum 40.
6. Răspunsurile: `ofertare-raspuns-set` compară doar `efect_posibil`. Nu există o versiune păstrată a analizei noastre, iar `citire_noi` se suprascrie.

## 2. Ce există și se refolosește

| Bucată | Unde | Cum o folosim |
|---|---|---|
| Tipare documente | `_shared/tipDocument.mjs` (+ `api/_tipDocument.js`) | neschimbat; rolul cantitativ se stabilește pe secțiune (§5.0) |
| Extragere AI | `ofertare-cantitati-extrage` (felii 55k, gpt-5-mini, `poarta.ts`) | mod nou `structurat`; **traseul `x-radar-secret` nu poate cheltui în modul nou** (§4.3) |
| Parser DN | `dnuriDenumire` (`ofertare-plansa-citeste/handler.ts:339`, Dn standard + intervale) | mutat în `_shared/dn.ts`, folosit de ambele |
| Lot canonic | `_shared/lot.ts` ↔ `fn_ofertare_parse_lot` (`toate / lista / necunoscut`), poarta `eligibilitateLicitatie` | identic pe observații, snapshot și cache |
| Rezervare per apel | OCR: `ofertare_ocr_rezervari` + blocarea apelului în zbor (20261029b/c) | același tipar, tabele generice noi (§4.3) |
| Perechi întrebare–răspuns | `ofertare-document-nou-citeste` → `analiza.citire_noi.intrebari_raspunse[]` (`intrebare_originala`, `raspuns_original`, sha de proveniență) | sursa auditului; se copiază în audit cu sha, pentru că `citire_noi` se suprascrie |
| Inventar dispoziții | `ofertare-raspuns-set` `inventar` (tip, citat ≤ 400) | doar ca semnal secundar (tipul efectului), nu ca probă |
| Versiuni SEAP | rând nou + `seap_meta.inlocuieste_id`, sha în `ofertare_seap_fisiere` | familia de versiuni (§5.2) |

**Trasee plătite existente, în afara acestui flux:** `raspuns-set inventar` (acces pe modul, fără plafon), `plansa-citeste` (are poarta lui) și extragerea veche. Fluxul nou **nu le pornește automat**. Folosește doar ce au produs deja, cu proveniență verificată. Aducerea `raspuns-set inventar` sub poartă și plafon e un PR separat în plan (PR0b), pentru că astăzi e o scăpare de cost independentă de acest tichet.

## 3. Ce construim

```
documente: familie de versiuni + sha text (textul păstrat după sha)
   │  0. ACOPERIRE: ce documente / secțiuni sunt eligibile și ce rol au (fără AI)
   │  E. extragere structurată (AI plătit: cerere autorizată, rezervare per apel, cache, plafon)
   ▼
ofertare_cant_obs              observații (append-only, imuabile în BD)
   │  C. comparație DETERMINISTĂ pe perechi de roluri, cu stare de acoperire
   ▼
ofertare_cant_cmp              F3↔ATR, F3↔CS, F3↔Fișa, F3↔memoriu, F3↔planșe, F3↔C6 (imuabile, per calcul)
   │──► clarificari-propune (contradicții structurate) ──► H2 (tri-state, din comparator)
   │  Î. înghețare: snapshot coerent (manifest exact, per lot)
   ▼
ofertare_analiza_versiuni
   │  A. audit al răspunsurilor: reguli + om (AI în afara MVP)
   ▼
ofertare_audit_raspunsuri
```

## 4. Model de date

**Livrarea pe migrări:**
- **PR2:** migrarea de bază, cu toate obiectele de mai jos.
- **PR4:** o migrare mică, doar view-ul H2.

**Obiectele noi:**
- tabele: `ofertare_doc_texte`, `ofertare_cant_extrageri`, `ofertare_cant_felii`, `ofertare_ai_buget`, `ofertare_ai_cereri`, `ofertare_ai_rezervari`, `ofertare_cant_obs`, `ofertare_cant_doc_decizii`, `ofertare_cant_alias`, `ofertare_cant_calcul`, `ofertare_cant_cmp`, `ofertare_analiza_versiuni`, `ofertare_audit_raspunsuri`;
- funcțiile din §4.3, §4.5, §5.3 și §5.4;
- triggerele de imuabilitate.

### Securitate, pentru toate obiectele
- RLS activ.
- **SELECT** pentru `authenticated` cu `fn_are_acces_ofertare(licitatie_id)`, mai puțin `ofertare_doc_texte`, care se citește doar prin RPC autorizat (§4.1). **Fără INSERT, UPDATE sau DELETE din UI.**
- Scrierile se fac doar prin funcții `SECURITY DEFINER SET search_path = public, pg_temp`, cu `REVOKE ALL FROM PUBLIC, anon, authenticated`. `GRANT EXECUTE` se dă:
  - `service_role` pentru funcțiile edge;
  - `authenticated` doar pe RPC-urile cu decizie umană (cerere, alias, decizie de document, decizie de audit, înghețare manuală), care verifică rolul în corp: owner, responsabil sau admin Ofertare.
- Fiecare funcție verifică faptul că **toate ID-urile primite aparțin licitației și lotului** din cerere.
- **Imuabilitate în BD:** trigger `BEFORE UPDATE OR DELETE` care refuză **și pentru `service_role`**, pe coloană, fără excepție de rol:
  - **imuabile integral:** `ofertare_doc_texte`, `ofertare_cant_obs`, `ofertare_cant_cmp`, `ofertare_cant_calcul`, `ofertare_analiza_versiuni`;
  - **append-only cu revocare prin rând nou:** `ofertare_cant_alias`, `ofertare_cant_doc_decizii`;
  - **câmpuri imuabile, plus tranziții de stare doar prin RPC după un automat de stare explicit:**
    - `ofertare_ai_cereri`: acordul e imuabil (licitație, lot, scop, plafon, `aprobat_de/la`, `valabil_pana`); starea merge doar `activa → consumata | anulata`;
    - `ofertare_ai_rezervari`: `deschisa → decontata | necunoscuta | abandonata`, fiecare o singură dată;
    - `ofertare_audit_raspunsuri`: se schimbă doar coloanele de decizie umană.
- **Lotul canonic:** `lot_domeniu ∈ {toate, lista, necunoscut}`, `lot_nr int[] NOT NULL`, cu `CHECK ((lot_domeniu = 'lista') = (cardinality(lot_nr) > 0))`. Pentru `toate` / `necunoscut` = `'{}'`, fără NULL. Indexurile unice pe lot funcționează astfel corect.

### 4.1 Texte și observații
- **`ofertare_doc_texte(licitatie_id, sha256, text, creat_la)`**, PK `(licitatie_id, sha256)`.
  - Conține textul exact folosit la o extragere.
  - Nu are SELECT pentru `authenticated`; se citește doar prin `fn_ofertare_doc_text(lic, sha)`, cu `fn_are_acces_ofertare`. Așa nu există un magazin global de texte între licitații.
- **`ofertare_cant_obs`:**
  - **Proveniență:** `id`, `licitatie_id`, `document_id`, `doc_sha256`, `familie_id` (§5.2), `extragere_id`, `felie_nr`; lot canonic.
  - **Rol:** `rol_sursa` CHECK `f3 | c6 | lista_alt | atr | cs | fisa_date | memoriu | plansa | raspuns | alt`; `rol_decis_de` (`antet | marcaj | titlu | model | om`).
  - **Poziția articolului:** `pagina`, `tabel_nr`, `rand_nr`, `cod_articol`, `denumire`, plus `pozitie_cheie` = `familie|pagina|tabel|rand|cod`. Identitatea pozițională folosită de deduplicare.
  - **Tipul lucrării și măsura:**
    - `tip_lucrare` CHECK `conducta | bransament | protectie | alt`;
    - `masura` CHECK `lungime | montaj | proba | material | alt`.
  - **Obiect:** `obiect_brut`, `obiect_cheie`.
  - **Material și DN:** `material`, `dn_mm numeric[]`, `dn_model`, `dn_ambiguu`, `sdr`.
  - **Cantitate:** `um_norm`, `cantitate` (null ≠ 0), `e_total`, `e_subtotal`.
  - **Citat și extractor:** `citat` (≤ 300), `extractor_id` (= `model@prompt_ver@normalizator_ver`), `hash_rand`.
  - Unic `(extragere_id, felie_nr, hash_rand)`.

### 4.2 Extrageri, felii, cache, blocarea muncii
- **`ofertare_cant_extrageri`:**
  - `id`, `licitatie_id`, `document_id`, `doc_sha256`, `familie_id`, `extractor_id`, `felii_total`;
  - `stare` (`in_lucru | gata | partial | esuat`), `obs_relevante` (numărul observațiilor cu UM = m), `cerere_id`, `pornit_de`, momentele de timp.
- **Cache:** unic `(document_id, doc_sha256, extractor_id)` pe `stare = gata`.
  - O extragere `gata` cu `obs_relevante = 0` rămâne `gata`, dar acoperirea o raportează explicit drept „fără lungimi” (§5.0). Nu e ascunsă.
- **Munca** = `munca_id` = `document_id:doc_sha256:extractor_id:felie_nr`, independent de extragere.
  - **`ofertare_cant_felii`:** `munca_id`, `incercare` (implicit 1), `extragere_id`, `de_la`, `pana_la`, `sha_felie`, `stare` (`in_zbor | gata | esuat | necunoscut`), `rezervare_id`.
  - **Unic `(munca_id, incercare)`:** două extrageri pornite în paralel pe același document și aceeași felie primesc același `munca_id`. A doua inserare e refuzată înaintea oricărui apel.
  - O felie `necunoscut` sau `esuat` **nu se reia**. O reluare cere `incercare + 1`, creată doar de RPC-ul de decizie umană (owner / responsabil), cu motiv.
  - Reluarea unei extrageri trece doar prin feliile fără `gata`.

### 4.3 Cheltuiala: buget pe licitație, cerere, rezervare per apel
- **`ofertare_ai_buget(licitatie_id, scop, plafon_usd)`**, PK `(licitatie_id, scop)`, cu `scop ∈ (cant_extragere, audit_raspunsuri)`.
  - Plafonul vine din D3: 5 / 3 USD. Îl poate ridica doar owner-ul, prin RPC, iar istoricul se păstrează.
  - **Plafonul e pe licitație și scop, comun tuturor cererilor.**
- **`ofertare_ai_cereri`:** `id`, `licitatie_id`, lot canonic, `scop`, `aprobat_de`, `aprobat_la`, `valabil_pana`, `stare`.
  - O creează doar owner-ul sau responsabilul.
  - Orice cheltuială cere o cerere `activa`, inclusiv pentru worker-ul NAS sau orice proces automat. Secretul tehnic nu ține loc de acord.
- **`ofertare_ai_rezervari`:** `id`, `cerere_id`, `licitatie_id`, `scop`, `munca_id`, `incercare`, `suma_rezervata`, `stare`, `cost_real`, momentele de timp.
  - `suma_rezervata` = costul maxim al apelului: intrarea estimată după octeți + `max_tokens` la ieșire, la tariful maxim al modelului. Nicio reîncercare și niciun fallback automat.
  - Unic `(munca_id, incercare)` **în toate stările**: același apel nu poate primi a doua rezervare, nici după `necunoscuta`.
- **Consumul plafonului**, o singură formulă canonică (`fn_ofertare_ai_consum(lic, scop)`), testată pe fiecare stare:
  `consum = Σ cost_real (decontata) + Σ suma_rezervata (deschisa | necunoscuta | abandonata)`.
- **Funcții:**
  - `rezerva(cerere, munca_id, incercare, suma)`: `FOR UPDATE` pe `ofertare_ai_buget` (rândul licitației și scopului) → verifică `consum + suma ≤ plafon` → inserează.
  - `deconteaza(id, cost_real, tokeni)`: o singură dată.
  - `marcheaza_necunoscuta(id)`.
  - `abandoneaza(id)`: după 15 min, rămâne socotită.

### 4.4 Decizii umane: documente și aliasuri
- **`ofertare_cant_doc_decizii(licitatie_id, document_id, doc_sha256, decizie, de, la, motiv, revoca_id)`**, cu `decizie ∈ (nu_e_sursa_cantitativa, rol_confirmat:<rol>)`.
  - Un document eligibil cu rol nerezolvat (`alt` sau `model` neconfirmat) ține acoperirea `incomplet` până la o decizie aici (§5.0).
- **`ofertare_cant_alias(id, licitatie_id, cheie_a, cheie_b, confirmat_de, la, revoca_id)`:** append-only; o revocare e un rând nou.

### 4.5 Calcule și comparații
- **`ofertare_cant_calcul`**, imuabil:
  - `id`, `licitatie_id`, lot canonic;
  - `tip` (`curent | simulare`), `pe_snapshot_id` (doar pentru `simulare`);
  - `algoritm_versiune`, `praguri jsonb`;
  - **manifestul complet:**
    - `doc_manifest`: TOATE documentele eligibile cu sha, familie, rol și extragerea folosită (inclusiv cele cu 0 observații sau fără extragere);
    - `obs_manifest`;
    - `alias_manifest`: aliasurile active folosite, id + hash;
    - `decizii_manifest`;
  - `acoperire jsonb` (pe perechi, §5.0), `amprenta` (sha256 canonic peste tot ce e mai sus), `creat_la`.
- **`ofertare_cant_cmp`**, imuabil, câte un rând per (calcul, pereche de roluri, cheie):
  - `calcul_id`, `cheie`, `rol_a`, `rol_b`;
  - `val_a`, `val_b`, `obs_a[]`, `obs_b[]`;
  - `delta_abs`, `delta_rel`;
  - `verdict` CHECK `concordant | diferenta | lipsa_a | lipsa_b | conflict_sursa | neasociat`;
  - `importanta`.

### 4.6 Snapshot-ul analizei
- **`ofertare_analiza_versiuni`**, imuabil:
  - `id`, `licitatie_id`, lot canonic;
  - `tip` (`initiala | recalcul`), `declansator` (`clarificare_trimisa | termen_clarificari | manual`), `clarificare_declansatoare_id`;
  - `inghetata_la`, `inghetata_de`;
  - `doc_manifest_curent` (documentele eligibile la înghețare, cu sha);
  - `calcul_id` (nullable) + `coerenta` (`calcul_curent | calcul_depasit | fara_calcul`);
  - `acoperire`;
  - `clarificari jsonb`: clarificările **noastre** la acel moment, inclusiv cea care a declanșat înghețarea, cu text integral și status;
  - `amprenta`.
- Unic `(licitatie_id, lot_domeniu, lot_nr)` WHERE `tip = 'initiala'`.

### 4.7 Auditul
- **`ofertare_audit_raspunsuri`:**
  - **Context:** `id`, `licitatie_id`, lot, `versiune_analiza_id`, `document_id`, `doc_sha256`.
  - **Proveniența citirii:** `citire_sursa_tip` (`pdf | text`), `citire_sursa_sha`, `citire_completa`.
  - **Perechea:** `pereche_idx`, `intrebare_text`, `raspuns_text`, `text_verificat` (bool, §5.4).
  - **Ancore și efect:** `ancore jsonb`, `efect`.
  - **Clasificare:** `clasificare`, `cauza`, `regula`.
  - **Dovezi:** `dovezi_istoric jsonb` (ID-uri din snapshot) și `dovezi_simulare jsonb` (`calcul_id` cu `tip = simulare` + ID-uri `cmp` din el). Funcția de scriere verifică apartenența fiecărui ID.
  - **Decizia omului:** `decizie_om`, `decis_de`, `decis_la`, `nota`, doar prin `fn_ofertare_audit_decide`.
- Unic `(versiune_analiza_id, document_id, doc_sha256, pereche_idx)`.

## 5. Logica

### 5.0 Acoperirea, pe perechi (fără AI)
- **Documentele eligibile** sunt ultimele versiuni din fiecare familie (§5.2), cu tipul `lista_cantitati`, `cs_volum`, `fisa_date`, `alta` sau `raspuns_clarificare`, după poarta de lot.
- **Rolul pe secțiune se decide înainte de filtrare**, în ordinea:
  1. antetul formularului (F3/C6);
  2. marcaje pe pagină (`Aviz tehnic de racordare`, `\bATR\b`, `Anexa 1 la Avizul`);
  3. titlul documentului;
  4. decizia omului (§4.4);
  5. altfel `alt`, sau propunerea modelului marcată `model`.
- **O pereche F3↔X este `gata` doar dacă toate condițiile sunt îndeplinite:**
  1. toate documentele eligibile cu rolul F3 și cu rolul X au o extragere `gata` pe sha-ul curent;
  2. **niciun document eligibil nu are rol nerezolvat** (`alt` fără decizie `nu_e_sursa_cantitativa`, sau `model` neconfirmat). Altfel toate perechile sunt `incomplet` și apar lipsurile, pe document;
  3. dacă un rol are extrageri `gata` dar 0 observații relevante, perechea poate fi `gata`, iar UI-ul afișează „rolul X: fără lungimi găsite în doc …”.
- **Calculul curent e valid** doar dacă un manifest curent, calculat pe server (documente eligibile + sha + extrageri + aliasuri active + decizii), are amprenta egală cu `doc_manifest` + `alias_manifest` + `decizii_manifest` ale calculului. Altfel calculul e `depasit`.
- **H2 tri-state**, per pereche:
  - `necalculat`: fără calcul valid;
  - `incomplet`: blochează „verde”;
  - `gata`: verdictul comparatorului.
  H2 și clarificari-propune consumă **doar un calcul valid**. Un calcul depășit nu e niciodată verde. Lipsa (NOT_FOUND) nu înseamnă că nu există (DOES_NOT_EXIST).

### 5.1 Extragerea structurată (PR3)
- **Pornire:** cerere activă → edge `ofertare-cantitati-extrage` cu `mod: 'structurat'`. Fără cerere: 402 înainte de orice apel. `x-radar-secret` e refuzat pe acest mod.
- **Pe fiecare felie:**
  1. cache;
  2. inserarea în `ofertare_cant_felii` (blocarea muncii);
  3. `rezerva`;
  4. apel;
  5. `deconteaza`.
  Eroare sau rezultat necunoscut → `marcheaza_necunoscuta` + felia `necunoscut`.
- **Ce cere promptul**, rând cu rând: `[pagina, tabel, rand, cod_articol, denumire, obiect, material, dn_text, sdr, um, cantitate, e_total, e_subtotal, tip_lucrare, masura, citat]`. Fără calcule; null ≠ 0.
- **Normalizare deterministă:**
  - **DN:** `dnuriDenumire` mutat în `_shared/dn.ts`. Dezacordul cu modelul sau DN-urile multiple → `dn_ambiguu`, fără corecție automată. Teste obligatorii: `PEHD 100 SDR11 Dn 90` → 90; `De 90`; `Ø90`; `D=90mm`; `Dn 90/110`.
  - **UM:** `ml → m`.
  - **`obiect_cheie`:** fără diacritice, fără prefixe de tip, cu toate tokenurile numerice și satul/localitatea.
  - **Material:** listă închisă.
  - **`tip_lucrare` și `masura`:** valoarea modelului, verificată cu reguli pe denumire (`bransament` → `bransament`; `tub de protectie` → `protectie`; `montaj` / `proba` / `furnizare` → `masura`). La dezacord câștigă regula, iar rândul se marchează.

### 5.2 Comparația deterministă (PR4)
- **Familia de documente:**
  - versiunile se leagă prin `seap_meta.inlocuieste_id` / `cod_anterior`;
  - părțile aceluiași fișier, prin `— pNN_pagA-B` (212 și 213 = părți complementare ale listei de cantități).
  - În comparație intră doar ultima versiune; părțile complementare se unesc.
- **Deduplicarea se face doar pe repetarea aceleiași poziții:**
  - aceeași `pozitie_cheie` (familie, pagină, tabel, rând, cod) apărută de două ori (suprapunerea de 2.000 de caractere dintre felii, pagină dublată la tăiere) = o observație;
  - **valorile egale în poziții diferite NU sunt duplicate** (două poziții de câte 100 m pe aceeași stradă = 200 m);
  - dacă aceeași `pozitie_cheie` are valori diferite → `conflict_sursa`.
- **Agregarea, per rol:**
  - suma pe cheie se face doar peste `masura = lungime`, separat pe `tip_lucrare` (conductă, branșament și protecție se compară fiecare separat; D4);
  - totalurile și subtotalurile nu se adună cu detaliile: se compară separat (`suma_vs_total`);
  - două valori pentru aceeași cheie din documente necomplementare ale aceluiași rol → `conflict_sursa`, fără alegere.
- **Cheia:** `lot_domeniu|lot_nr|obiect_cheie|tip_lucrare|material|dn|um_norm`.
  - Potrivirea e exactă, plus aliasurile active din manifest.
  - Candidații apropiați se afișează doar ca sugestie.
  - `dn_ambiguu` → `neasociat`.
- **Formule:**
  - `delta_abs = val_b − val_a`;
  - `delta_rel = |delta_abs| / max(|val_a|, |val_b|)`;
  - rotunjire la 0,001 înaintea comparației;
  - null → `lipsa_*`; ambele 0 → `concordant`;
  - conversie de UM doar `ml ↔ m`.
- **Praguri:**
  - H2: `delta_rel > 0,001`;
  - „de semnalat” în clarificări: `|delta_abs| > 1 m` **și** `delta_rel > 1%`.
  - Pragurile și `algoritm_versiune` intră în amprentă și se fixează înainte de golden (§6).
- **Ieșirea:** rândurile `cmp` ale unui calcul. H2 și clarificari-propune consumă doar calculul valid (§5.0); clarificările primesc `diferenta` și `conflict_sursa`, ordonate, cu citate și pagini. Testele de paritate H2 pe licitațiile 5 și 103 intră în PR4.

### 5.3 Înghețarea (D1)
- **Declanșatoare:**
  1. trigger `AFTER UPDATE` pe `ofertare_clarificari`, când **prima** clarificare a noastră pentru licitație și lot trece în `trimisa` → `fn_ofertare_analiza_ingheata(..., 'clarificare_trimisa', clarificare_id)`, în aceeași tranzacție. Clarificarea declanșatoare intră în snapshot;
  2. la termenul-limită de clarificări, fără clarificare trimisă: rutina zilnică Ofertare (edge programat existent, nu `cron.job` nou) cheamă înghețarea cu `termen_clarificari`;
  3. butonul manual (responsabil).
- **Funcția nu refuză niciodată.** Păstrează realitatea:
  - `doc_manifest_curent` = documentele eligibile de acum;
  - `coerenta`:
    - `calcul_curent`: există un calcul valid pe același manifest;
    - `calcul_depasit`: există un calcul, dar documentele s-au schimbat;
    - `fara_calcul`.
  - Cu `calcul_depasit` / `fara_calcul`, acoperirea snapshot-ului e `incomplet`.
- Idempotentă: o a doua inițială pe același lot e refuzată de indexul unic. Recalculurile sunt `tip = recalcul`. Fără AI.

### 5.4 Auditul răspunsurilor (PR6; MVP = reguli + om)
- **Input:** perechile din `citire_noi.intrebari_raspunse` ale documentelor `raspuns_clarificare` apărute după snapshot.
- **Proveniența, verificată după tipul sursei** (ca în `document-nou-citeste/sursa.ts`):
  - `pdf` → `sursa_sha256` = sha-ul PDF-ului din `ofertare_seap_fisiere` / Storage;
  - `text` → `sha256(trim(text_extras))`.
  - `citire_completa = false` → auditul marchează documentul „citit parțial”, iar clasificarea maximă e `nedeterminabil`.
- **`text_verificat`:** întrebarea și răspunsul produse de model se caută ca subșir în `text_extras`, după normalizarea spațiilor.
  - Găsite → `true`.
  - Altfel → `false`: perechea nu poate primi automat `omisiune` sau `deja_observat`, doar `nedeterminabil` + cerere de verificare umană.
- **Ancore**, deterministe: obiectul (`obiect_cheie` găsit exact în snapshot), tipul lucrării, DN, lotul, **proprietatea** (lungime pe obiect / total pe DN / referință de document) și cifrele cu UM. Cifrele singure servesc doar la găsirea candidaților.
- **Clasificarea, în ordine:**
  1. **`deja_observat`:** o clarificare **a noastră** din snapshot (`trimisa` / `raspunsa`) are aceleași ancore de **obiect + lot + proprietate** (sau, pentru totaluri, DN + tip lucrare + proprietatea „total”). Similaritatea textului găsește candidații; confirmarea cere ancorele. `cauza = intrebat_de_noi`.
  2. **`modificare_ulterioara`:** valoarea sau cerința din snapshot (pe aceeași ancoră) diferă de efectul nou: valoare nouă în răspuns, document nou în familie, referință schimbată. `cauza = schimbat_de_raspuns | document_nou`.
  3. **`omisiune`**, numai cu dovadă:
     - **`detectat_neintrebat`:** snapshot-ul are un calcul valid (`calcul_curent`) cu `diferenta` sau `conflict_sursa` pe aceeași ancoră, iar noi n-am întrebat. `neasociat` singur **nu** ajunge;
     - **`analiza_incompleta`:** acoperirea snapshot-ului e `incomplet`, iar un **calcul `simulare`**, făcut cu comparatorul curent pe exact `doc_manifest_curent` (sha-urile) al snapshot-ului, dă `diferenta` / `conflict_sursa` pe aceeași ancoră. Simularea e imuabilă, are propriul manifest, algoritm, praguri și aliasuri, iar `pe_snapshot_id` o leagă de snapshot. Dovada intră în `dovezi_simulare`, cu eticheta „simulare retrospectivă”.
     - O **confirmare fără schimbare de documentație** primește `omisiune` doar prin una dintre aceste două cauze.
  4. Altfel → **`nedeterminabil`** (inclusiv „subiectul doar există în documente”).
- **Omul:** confirmat / respins prin RPC. Nimic nu se modifică automat.
- **AI în audit:** în afara MVP (plafonul D3 de 3 USD rămâne rezervat pentru el).

### 5.5 Interfața (PR4 + PR6)
- **Cantități → tab „Comparație”:**
  - acoperirea pe perechi, cu lipsurile pe document și butoanele „nu e sursă cantitativă” / „confirmă rolul”;
  - starea calculului (valid / depășit / lipsă) și butonul „Recalculează” (fără cost; extragerile lipsă cer o cerere de cheltuială separată);
  - tabelul pe cheie;
  - sugestiile de alias;
  - butonul „Îngheață”.
- **Clarificări → „Audit răspunsuri Autoritate”:** grupat pe clasificare și cauză, cu textul integral, `text_verificat`, ancorele și dovezile separate „istoric” / „simulare”, plus confirmat / respins.

## 6. Acceptanță (date reale, înainte de LIVE)

### 6.0 Golden fixture, construit ÎNAINTE de reglaj
Din documentele originale, **fără doc 1624**, cineva extrage de mână (sau o sesiune separată, verificată de om) pentru Dn 90 și Dn 32:
- tabelul cu cele 16 străzi;
- valorile ATR / CS / Fișă / F3;
- pagina și poziția fiecăreia.

Rezultatul e fișierul `supabase/tests/fixtures/tkt0329_racari_golden.json`. Promptul, normalizarea, cheile și pragurile se îngheață înaintea rulării pe golden. Doc 1624 rămâne **numai** oracol pentru audit.

**Documentele de intrare** (verificate în BD pe 15.10): Fișa 201, CS 198 + CS revizuit 318, ATR = paginile marcate din „Pth … part.1 — p01” (214), F3 = părțile 212 + 213 (familia „Liste de cantitati fara valori”), răspunsul nr. 1 (316).

### 6.1 Proba nouă (extracție + comparație)
Pe golden se măsoară separat:
- recall-ul cheilor;
- false-match;
- `neasociat`;
- fals-pozitivele `diferenta`;
- precizia valorilor.

Ținte: recall ≥ 15/16 străzi Dn 90, false-match 0, verdicte corecte pe toate cheile asociate. Ținta factuală, de confirmat pe golden: 13 `diferenta`, 3 `concordant`, total F3 6.400 / ATR 3.995, Dn 32 Δ ≈ 87 m.

### 6.2 Proba istorică (audit)
- **Snapshot A, „istoric”:** cum eram (0 observații, 7 clarificări, `fara_calcul`, acoperire `incomplet`). Pe doc 1624, solicitarea 7 / răspunsul 16, auditul face un calcul `simulare` pe sha-urile din snapshot. Rezultatul trebuie să fie `omisiune / analiza_incompleta`, cu dovada în `dovezi_simulare`, etichetată „simulare retrospectivă”.
- **Snapshot B, „nou fără întrebare”:** analiza nouă, cu calcul valid, fără clarificare de lungime. Dă `omisiune / detectat_neintrebat`, cu dovezi istorice.
- **Snapshot C, „nou cu întrebare”:** o clarificare a noastră pe aceleași ancore (obiect / total Dn 90 + proprietatea „lungime”). Dă `deja_observat`.
- **Negativ:** o clarificare a noastră cu aceleași cifre (Dn 90, 100 m), dar pe altă stradă, NU dă `deja_observat`.

### 6.3 Fals-pozitive pe alte licitații
Eșantion definit: 50 de chei aleatoare (seed fixat) din licitațiile 5 și 103, verificate de om pe documentele originale, nu pe registru. Ținta: fals-pozitive `diferenta` < 5%.

### 6.4 Cost și siguranță
- a doua extragere pe aceeași versiune = 0 apeluri (cache);
- plafonul refuză înaintea apelului;
- două extrageri concurente pe aceeași muncă (document + sha + extractor + felie): a doua e refuzată înaintea apelului; o felie `necunoscut` nu primește a doua rezervare;
- două cereri de câte 5 USD pe aceeași licitație nu permit mai mult de 5 USD (plafon pe licitație); rezervările `necunoscuta` intră în consum;
- un calcul depășit (document nou după calcul) dă H2 `necalculat`, nu verde;
- `x-radar-secret` pe modul structurat = refuz;
- scrierea `service_role` peste observații, comparații, calcule sau snapshot = refuzată de trigger; tranzițiile de stare nepermise = refuzate;
- `ofertare_doc_texte` nu e citibil direct de `authenticated`.

### 6.5 Teste
- unit, Deno / vitest: DN, cheie, dedup, praguri, reguli de audit;
- harness SQL: tabele, RLS, imuabilitate, rezervări, cerere, înghețare;
- paritate H2.

## 7. Plan pe PR-uri (fiecare: review Jakarinos + Copilot conv. 3, draft, merge prin chat cu „da”)

| PR | Conținut | BD | Cost AI |
|---|---|---|---|
| PR1 | această specificație | — | — |
| PR0b | `raspuns-set inventar` sub poarta owner/responsabil (scăpare de cost existentă) | — | — |
| PR2 | migrarea de bază: §4 integral (13 tabele), funcțiile (buget, cerere, rezervă / deconteaza / necunoscută / abandonează, decizii, înghețare + trigger D1, scrierea auditului, decizie audit), triggere de imuabilitate și stări, harness SQL, revenire | **da** | — |
| PR3 | `_shared/dn.ts` (mutare + teste), roluri pe secțiune, extragere structurată, cache, rezervare per felie | — | doar la rulare, pe cerere activă |
| PR4 | familie / dedup / comparator + acoperire tri-state + H2 + tab Comparație + alias + înghețare UI + paritate | view H2 (migrare mică) | 0 |
| PR5 | clarificari-propune primește contradicțiile structurate | — | — |
| PR6 | audit pe reguli (cu calculul `simulare`) + UI decizie | — | 0 |
| Probe | §6.0 golden → §6.1 → §6.2 → §6.3, pe licitația 15 apoi pe o licitație activă | date reale doar cu „da” | estimat sub 2 USD pe Răcari |

## 8. În afara MVP
- AI în audit pentru cazurile `nedeterminabil`, după ce le vedem numărul.
- Propunere de corecție a registrului `ofertare_cantitati` din comparație, cu aprobare.
- Textul OCR local pentru documentele scanate (laboratorul OCR).
- Audit retroactiv pe licitațiile închise.

## 9. Decizii Răzvan (15.10.2026, prin chat: A la toate)

- **D1:** înghețarea se face automat la prima clarificare a noastră trimisă sau la termenul-limită de clarificări, plus buton manual pentru responsabil.
- **D2:** extragerea folosește gpt-5-mini, cu normalizare deterministă după.
- **D3:** plafon pe licitație de 5 USD pentru extragere și 3 USD pentru audit, ridicabile de owner. În MVP auditul nu face apeluri AI, deci plafonul de audit rămâne rezervat pentru extinderea din §8.
- **D4:** MVP-ul acoperă doar lungimile (UM = m: conducte, branșamente, tuburi de protecție), cu DN și material.
- **D5:** proba de acceptanță e întâi Răcari (licitația 15, golden din §6.0), apoi o licitație activă cu termen de clarificări deschis.
