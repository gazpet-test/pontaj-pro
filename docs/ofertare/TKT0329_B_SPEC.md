# TKT-2026-0329, varianta B: cantități structurate + audit al răspunsurilor Autorității

**Stare:** SPECIFICAȚIE v2 (15.10.2026), după review r1:
- Jakarinos NO-GO: 10×P1, 2×P2;
- Copilot NO-GO: 7×P1, 3×P2.

Nimic nu e implementat. Migrările, deploy-urile și orice cost AI se fac doar cu „da” de la Răzvan.
**Decizie de pornire:** Răzvan, 14.10.2026, varianta B (`claude_context` #1758).
**Studii:** Jakarinos, `C:\Users\Public\paw-data\out\tkt0329_r1_jak.log`; harta codului din această sesiune (§2).

**Schimbări față de v1, pe scurt:**
- **Acoperire tri-state.** Lipsa observațiilor nu mai înseamnă niciodată concordanță; „0 rânduri” iese `incomplet`, nu verde (§5.0).
- **Rezervare per apel, ca la OCR.** Fiecare apel are în registru un rând de rezervare propriu, cu blocare a apelului în zbor. Cheltuiala se face doar pe o cerere autorizată, păstrată în BD (§4.3).
- **Identitatea articolului** (cod, poziție, natură) și familia de documente. Fără sume duble; totalurile nu se adună cu detaliile; conflictele din același rol devin `conflict_sursa` (§5.2).
- **Parsarea DN** se face cu `dnuriDenumire` existent, mutat în `_shared`. Potrivirea e exactă, plus alias confirmat de om; nu mai există fuzzy automat (§5.1, §5.2).
- **Comparațiile se fac pe perechi de roluri**, cu formule fixate (§5.2).
- **Auditul e redefinit pe dovezi** (§5.4):
  - `omisiune` numai cu dovadă dintr-o regulă care ar fi semnalat diferența;
  - `modificare_ulterioara` = conținutul anterior comparat cu efectul nou.
  - **În MVP, auditul merge pe reguli + om, fără AI.**
- **Proveniență imuabilă în BD:** triggere care refuză și scrierile `service_role`, textele sursă păstrate după sha, manifestul exact și lotul în snapshot (§4).
- **Lotul** folosește modelul canonic `toate | lista | necunoscut` (§4.1).
- **Acceptanță în două probe** (istorică și nouă), cu fixture de aur construit înainte de reglaj (§6).

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

## 4. Model de date (o migrare, PR2)

### Securitate, pentru toate obiectele
- RLS activ.
- **SELECT** pentru `authenticated` cu `fn_are_acces_ofertare(licitatie_id)`. **Fără INSERT, UPDATE sau DELETE din UI.**
- Scrierile se fac doar prin funcții `SECURITY DEFINER SET search_path = public, pg_temp`, cu `REVOKE ALL FROM PUBLIC, anon, authenticated` și `GRANT EXECUTE` doar rolului care trebuie:
  - `service_role` pentru edge-uri;
  - `authenticated` doar pe RPC-urile de decizie umană, care verifică rolul în corp.
- Fiecare funcție verifică faptul că **toate ID-urile primite aparțin licitației** și lotului din cerere.
- **Imuabilitate în BD:** triggere `BEFORE UPDATE OR DELETE` care refuză **inclusiv pentru `service_role`** pe `ofertare_cant_obs`, `ofertare_cant_cmp`, `ofertare_analiza_versiuni`, `ofertare_doc_texte`, `ofertare_ai_cereri` aprobate, plus coloanele de clasificare și dovezi din audit.
  - Singura excepție la audit sunt coloanele de decizie umană, prin RPC dedicat.
  - Trigger-ul compară coloană cu coloană; nu ia în seamă rolul.

### 4.1 Texte și observații
- **`ofertare_doc_texte(sha256 PK, text, creat_la)`:** textul exact folosit la o extragere, adresat după conținut, imuabil. Așa, un snapshot poate fi reverificat și după reprocesarea documentului.
- **`ofertare_cant_obs`:**
  - **Identitate și proveniență:** `id`, `licitatie_id`, `document_id`, `doc_sha256` (FK → `ofertare_doc_texte`), `familie_id` (§5.2), `extragere_id`, `felie_nr`.
  - **Lot:** `lot_domeniu` (`toate | lista | necunoscut`), `lot_nr int[]`.
  - **Rol:** `rol_sursa` CHECK `f3 | c6 | lista_alt | atr | cs | fisa_date | memoriu | plansa | raspuns | alt`; `rol_decis_de` (`antet | regula | model`).
  - **Articol:** `pagina` (null dacă lipsește markerul), `tabel_nr`, `rand_nr`, `cod_articol`, `denumire`.
  - **Natură:** `natura` CHECK `lungime_fizica | montaj | proba | material | bransament | protectie | alt`.
  - **Obiect:** `obiect_brut`, `obiect_cheie` (§5.1).
  - **Material și DN:** `material`, `dn_mm numeric[]` (din `dnuriDenumire`), `dn_model`, `dn_ambiguu` (bool), `sdr`.
  - **Cantitate:** `um_norm`, `cantitate` (null ≠ 0), `e_total` (bool), `e_subtotal` (bool).
  - **Citat și extractor:** `citat` (≤ 300 caractere), `extractor` (`model@prompt_ver@normalizator_ver`), `hash_rand`.
  - Unic `(extragere_id, felie_nr, hash_rand)`.

### 4.2 Extrageri (jurnal + cache)
- **`ofertare_cant_extrageri`:**
  - `id`, `licitatie_id`, `document_id`, `doc_sha256`, `familie_id`;
  - `model`, `prompt_versiune`, `normalizator_versiune`;
  - `felii_total`, `felii_gata`;
  - `stare` CHECK `in_lucru | gata | partial | esuat`;
  - `cerere_id` (§4.3), `pornit_de`, `created_at`, `terminat_la`.
- **Cache:** unic `(document_id, doc_sha256, model, prompt_versiune, normalizator_versiune)` pe `stare = gata`. La refolosire, poarta de lot se re-evaluează (§5.0).
- **Felii:** `ofertare_cant_felii(extragere_id, felie_nr, de_la, pana_la, sha_felie, stare in_zbor | gata | esuat | necunoscut, rezervare_id)`.
  - Unic `(extragere_id, felie_nr)`.
  - O felie `necunoscut` nu se reîncearcă automat.
  - Reluarea trece doar prin feliile nefinalizate.

### 4.3 Cheltuiala: cerere autorizată, rezervare per apel, plafon
- **`ofertare_ai_cereri`** — acordul de cheltuială, păstrat în BD:
  - `id`, `licitatie_id`, `lot_domeniu`, `lot_nr`, `scop` (`cant_extragere`);
  - `plafon_usd`, `aprobat_de`, `aprobat_la`, `valabil_pana`, `stare` (`activa | consumata | anulata`).
  - O creează doar owner-ul sau responsabilul (RPC cu verificare de rol).
  - Worker-ul NAS sau orice proces automat poate cheltui **doar** pe o cerere activă. Secretul tehnic nu ține loc de acord.
- **`ofertare_ai_rezervari`** — câte un rând per apel plătit:
  - `id`, `cerere_id`, `licitatie_id`, `scop`, `corelatie` (unic: `extragere_id:felie_nr`);
  - `suma_rezervata` = costul maxim al apelului (intrare estimată după octeți + `max_tokens` ieșire, la tariful maxim al modelului, fără reîncercări automate);
  - `stare` (`deschisa | decontata | abandonata | necunoscuta`), `cost_real`, momentele de timp.
  - Unic pe `corelatie` cât timp starea e `deschisa`: a doua cerere identică în zbor e refuzată.
- **Funcții:**
  - `rezerva`: atomic, `FOR UPDATE` pe cerere; verifică `sum(deschise + decontate + abandonate) + suma ≤ plafon`.
  - `deconteaza(id, cost_real, tokeni)`: o singură dată.
  - `abandoneaza(id)`: după 15 min, păstrează suma socotită.
  - Un rezultat necunoscut lasă rezervarea socotită.
- **Ce limitează plafonul:** doar apelurile pornite de acest flux. Nicio reîncercare automată și niciun fallback de model fără o rezervare nouă.

### 4.4 Comparații
- **`ofertare_cant_calcul`:**
  - `id`, `licitatie_id`, `lot_domeniu`, `lot_nr`;
  - `algoritm_versiune`, `obs_manifest` (lista sortată de `obs.id` + `hash_rand`), `amprenta` (sha256 peste manifest + algoritm + praguri);
  - `acoperire jsonb` (§5.0), `stare` (`incomplet | gata`), `creat_la`.
- **`ofertare_cant_cmp`**, câte un rând per **pereche** de roluri și cheie:
  - `calcul_id`, `cheie` (§5.2), `rol_a` (`f3`), `rol_b`;
  - `val_a`, `val_b`, `obs_a[]`, `obs_b[]`;
  - `delta_abs`, `delta_rel`;
  - `verdict` CHECK `concordant | diferenta | lipsa_a | lipsa_b | conflict_sursa | neasociat`;
  - `importanta`.

### 4.5 Snapshot-ul analizei
- **`ofertare_analiza_versiuni`:**
  - `id`, `licitatie_id`, `lot_domeniu`, `lot_nr`, `tip` (`initiala | recalcul`);
  - `inghetata_la`, `inghetata_de`, `motiv`;
  - `documente jsonb` (`[{document_id, doc_sha256, familie_id, rol}]`, exact);
  - `calcul_id` (comparația folosită; trebuie să fie pe exact aceleași `doc_sha256`), `acoperire` (copiată din calcul);
  - `clarificari jsonb`: id, text integral, status și dată pentru clarificările **noastre**;
  - `amprenta`.
- Index unic parțial `(licitatie_id, lot_domeniu, lot_nr)` WHERE `tip = 'initiala'`.
- Înghețarea **refuză** dacă documentele curente ale licitației nu au aceleași sha ca cele din calcul (stare incoerentă).

### 4.6 Auditul
- **`ofertare_audit_raspunsuri`:**
  - **Context:** `id`, `licitatie_id`, `versiune_analiza_id`, `document_id` (răspunsul), `doc_sha256`.
  - **Perechea:** `pereche_idx` (din `citire_noi`), `citire_sha` (proveniența citirii), `intrebare_text`, `raspuns_text` (copiate integral).
  - **Ancore:** `ancore jsonb` (cifrele, DN-urile și obiectele găsite exact în text).
  - **Efect:** `efect` (`confirmare | modificare | cantitati | neclar`).
  - **Clasificare:** `clasificare` CHECK `omisiune | modificare_ulterioara | deja_observat | nedeterminabil`; `cauza` (§5.4); `dovezi jsonb` (ID-uri **din snapshot**, validate în funcție); `regula` (`regula@ver`).
  - **Decizia omului:** `decizie_om` (`confirmat | respins`), `decis_de`, `decis_la`, `nota`. Se scrie doar prin RPC `fn_ofertare_audit_decide`, cu acces la licitație și rol (owner, responsabil, admin Ofertare).
- Unic `(versiune_analiza_id, document_id, doc_sha256, pereche_idx)`.

## 5. Logica

### 5.0 Acoperirea (fără AI; condiție pentru comparație, H2 și înghețare)
- **Documentele eligibile** pentru o licitație și un lot sunt ultimele versiuni din fiecare familie (§5.2), cu tipul `lista_cantitati`, `cs_volum`, `fisa_date`, `alta` sau `raspuns_clarificare`.
- **Rolul pe secțiune se decide înainte de filtrare, determinist, în ordinea:**
  1. antetul formularului (F3/C6), cu `sectiuni.ts`;
  2. markeri în text pe pagină (`Aviz tehnic de racordare`, `\bATR\b`, `Anexa 1 la Avizul`): paginile marcate devin `atr` chiar dacă documentul e `alta`;
  3. titlul documentului (`fisa`, `caiet`, `memoriu`).
  Altfel rolul e `alt`, iar modelul îl poate propune doar marcat `rol_decis_de = model`, pentru verificare.
- **`acoperire`** = lista documentelor eligibile, fiecare cu:
  - `text` (`ok | lipsa | ocr_necesar`), luat din `text_extras` și `pagini_necitite`;
  - `extragere` (`gata | partial | esuat | lipsa`);
  - rolurile găsite.
- **Starea calculului:**
  - `gata` doar dacă **F3 și cel puțin un rol de referință** (ATR, CS sau Fișa de date) au extragere `gata` pe toate documentele lor eligibile;
  - altfel `incomplet`, cu motivul pe document.
- **H2 tri-state:**
  - `necalculat`: nicio extragere;
  - `incomplet`: blochează „verde” și se afișează ca „analiză incompletă”, nu ca concordanță;
  - `gata`: verdictul comparatorului.
  Lipsa (NOT_FOUND) nu înseamnă că nu există (DOES_NOT_EXIST).

### 5.1 Extragerea structurată (PR3)
- **Pornire:** UI, owner sau responsabil → creează sau folosește o `ofertare_ai_cereri` activă → edge `ofertare-cantitati-extrage` cu `mod: 'structurat'`. Fără o cerere activă se răspunde 402 înainte de orice apel. Traseul `x-radar-secret` e refuzat pe acest mod.
- **Pe fiecare felie:**
  1. verificare cache;
  2. `rezerva`;
  3. apel;
  4. `deconteaza`.
  Eroare de transport sau rezultat necunoscut → felia `necunoscut`, fără reîncercare.
- **Ce cere promptul**, rând cu rând: `[pagina, tabel, rand, cod_articol, denumire, obiect, material, dn_text, sdr, um, cantitate, e_total, e_subtotal, natura, citat]`. Fără calcule; null ≠ 0.
- **Normalizare deterministă după model**, cu teste:
  - **DN:** `dnuriDenumire(denumire + dn_text)`, care întoarce doar Dn standard. Dacă modelul dă alt DN decât parserul, sau parserul dă mai multe → `dn_ambiguu = true`, se păstrează ambele valori și **nu se corectează automat**.
    - Cazuri de test obligatorii: `PEHD 100 SDR11 Dn 90` → 90 (nu 100); `De 90`, `Ø90`, `D=90mm`, `Dn 90/110`.
  - **UM:** `ml → m`; altfel neschimbat.
  - **`obiect_cheie`:** minuscule, fără diacritice, fără prefixe de tip (`str.`, `strada`, `aleea`, `drumul`, `sos.`), cu **toate tokenurile numerice păstrate**, plus sat/localitate dacă documentul o dă (Răcari: „Colacu / Padurii”).
  - **Material:** listă închisă (`PE100`, `PEHD`, `OL`, `PE80`, …); `PE 100` → `PE100`.

### 5.2 Comparația deterministă (PR4)
- **Familia de documente:**
  - versiunile se leagă prin `seap_meta.inlocuieste_id` / `cod_anterior`;
  - părțile aceluiași fișier sunt legate prin numele `— pNN_pagA-B` (ex. 212 și 213 = părțile 1 și 2 ale listei de cantități; **complementare**, nu duplicate).
  - În comparație intră doar ultima versiune. Părțile complementare se unesc **după** deduplicare.
- **Deduplicare și agregare, în același rol:**
  1. observații identice (`cod_articol`, `obiect_cheie`, `dn`, `natura`, `cantitate`) din părți sau pagini diferite = o singură observație;
  2. **totalurile și subtotalurile nu se adună cu detaliile.** Pentru cheie se ia suma detaliilor; un total declarat se compară separat, ca verificare internă (`suma_vs_total`);
  3. se agregă numai `natura = lungime_fizica` (montajul, proba și materialul pentru aceeași conductă nu se adună peste lungime);
  4. două valori diferite pentru aceeași cheie și natură în același rol, din documente necomplementare → `conflict_sursa`, cu ambele valori, fără alegere.
- **Cheia:** `lot_domeniu|lot_nr|obiect_cheie|material|dn|um_norm|natura`.
  - **Potrivirea:** exactă; plus tabelul `ofertare_cant_alias(licitatie_id, cheie_a, cheie_b, confirmat_de)`, populat **doar de om** din UI.
  - Candidații apropiați (aceleași DN, material, UM, lot și tokenuri numerice, diferență doar de scriere) se **afișează** ca sugestie de alias. Până la confirmare rămân `neasociat`.
  - Un `dn_ambiguu` intră doar ca `neasociat`.
- **Formule:**
  - `delta_abs = val_b − val_a`;
  - `delta_rel = |delta_abs| / max(|val_a|, |val_b|)`;
  - valorile sunt egale ⇔ `delta_abs = 0`;
  - rotunjire la 0,001 m înaintea comparației;
  - null pe o parte → `lipsa_a` / `lipsa_b` (niciodată 0);
  - ambele 0 → concordant;
  - conversie de UM doar `ml ↔ m`, altfel nu se compară.
- **Praguri:**
  - **H2:** `delta_rel > 0,001`, ca azi;
  - **„diferență de semnalat”** (clarificări): `|delta_abs| > 1 m` **și** `delta_rel > 1%`.
  - Pragurile și `algoritm_versiune` intră în `amprenta` calculului. Valorile finale se fixează **înainte** de rularea pe golden (§6), nu după.
- **Ieșirea:**
  - rândurile `ofertare_cant_cmp` și starea calculului;
  - **H2** citește starea și verdictele din ultimul calcul `gata` pentru F3↔ATR, F3↔CS, F3↔Fișa, F3↔memoriu, F3↔planșe și F3↔C6. Când calculul e `gata`, înlocuiește sumele din `v_ofertare_pt_stare`; altfel H2 = `incomplet`.
    - PR4 include testele de paritate H2: pe licitațiile cu registru validat (5, 103), sursele vechi și comparatorul nou dau același verdict acolo unde ambele au date.
  - **clarificari-propune** primește verdictele `diferenta` și `conflict_sursa`, ordonate după `importanta`, cu citatele și paginile din ambele surse (maximum 40, plus numărul celor omise).

### 5.3 Înghețarea (funcția în PR2, butonul în PR4)
- `fn_ofertare_analiza_ingheata(lic, lot_domeniu, lot_nr, motiv)` scrie snapshot-ul §4.5 într-o singură tranzacție, din ultimul calcul al lotului.
- Refuză dacă documentele curente nu corespund calculului.
- Un calcul `incomplet` **se poate** îngheța (realitatea trebuie păstrată), dar snapshot-ul poartă `acoperire.stare = incomplet`.
- Fără AI; idempotentă pe amprentă.

### 5.4 Auditul răspunsurilor (PR5; în MVP doar reguli + om)
- **Input:** fiecare pereche din `citire_noi.intrebari_raspunse` a unui document `raspuns_clarificare` apărut după snapshot, cu `citire_sha` verificat pe `text_extras` curent. Tipul efectului din `raspuns-set` intră doar ca semnal.
  - Dacă documentul nu e citit, auditul nu-l pornește: îl raportează „necitit”. Citirea rămâne la poarta ei existentă.
- **Ancore:** se extrag determinist din întrebare și răspuns:
  - cifre cu UM;
  - DN-uri (`dnuriDenumire`);
  - `obiect_cheie` pentru numele de stradă găsite exact în snapshot;
  - referiri la documente (F3, ATR, Fișa, CS).
- **Clasificarea, în ordine:**
  1. **`deja_observat`:** o clarificare **a noastră** din snapshot (status `trimisa` sau `raspunsa`) atinge același subiect. Se verifică prin ancore comune (aceeași cheie sau aceleași cifre); candidații se caută pe text (Jaccard pe cuvintele întrebării, nu pe `cheie`), dar confirmarea cere ancore. `cauza = intrebat_de_noi`.
  2. **`modificare_ulterioara`:** răspunsul **schimbă** conținutul față de snapshot.
     - Exemple: o valoare nouă pentru o cheie existentă, ATR înlocuit ca referință, o cerință sau o cantitate care nu era.
     - Se compară valoarea din snapshot cu valoarea din răspuns sau dintr-o versiune nouă a documentului. Nu contează doar existența subiectului.
     - `cauza = schimbat_de_raspuns | document_nou`.
  3. **`omisiune`**, numai cu dovadă:
     - **`cauza = detectat_neintrebat`:** snapshot-ul are pe aceeași cheie sau ancore un verdict `diferenta`, `conflict_sursa` sau `neasociat` relevant, dar noi n-am întrebat;
     - **`cauza = analiza_incompleta`:** snapshot-ul are `acoperire = incomplet` pe documentele la care trimit ancorele, iar **comparatorul curent rulat pe exact documentele și sha-urile snapshot-ului** dă `diferenta`. Asta se marchează explicit „simulare retrospectivă”, nu „dovadă a analizei istorice”.
     - O **confirmare fără schimbare de documentație** cade aici doar dacă una dintre cele două cauze e dovedită.
  4. Altfel: **`nedeterminabil`**, inclusiv când subiectul doar „există” în documente, fără o regulă care să-l fi semnalat.
- **Dovezile** sunt numai ID-uri din snapshot-ul auditat (observații, comparații, clarificări, documente + sha). Funcția de scriere le verifică; orice ID străin → refuz.
- **Omul:** confirmat / respins prin RPC. Nimic nu modifică automat registrul, clarificările sau cantitățile.
- **AI în audit:** în afara MVP. Se reconsideră după ce vedem câte cazuri rămân `nedeterminabil` pe probe.

### 5.5 Interfața (PR4 + PR6)
- **Cantități → tab „Comparație”:**
  - starea de acoperire sus (documente eligibile cu starea lor; „analiză incompletă” cu roșu);
  - tabel pe cheie cu coloane per rol, Δ și verdict per pereche;
  - filtre: diferențe / conflicte / neasociate;
  - citat + pagină pe click;
  - sugestii de alias (confirmare de om);
  - butonul „Îngheață analiza inițială” (D1).
- **Clarificări → „Audit răspunsuri Autoritate”:** grupat pe clasificare și cauză, cu întrebarea și răspunsul integral, ancorele, dovezile din snapshot și butoanele confirmat / respins.

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
- **Snapshot A, „istoric”:** cum eram (0 observații, 7 clarificări, acoperire `incomplet`). Auditul pe doc 1624, solicitarea 7 / răspunsul 16, dă `omisiune / analiza_incompleta`, marcat „simulare retrospectivă”.
- **Snapshot B, „nou fără întrebare”:** analiza nouă, fără clarificare de lungime. Dă `omisiune / detectat_neintrebat`.
- **Snapshot C, „nou cu întrebare”:** dă `deja_observat`.

### 6.3 Fals-pozitive pe alte licitații
Eșantion definit: 50 de chei aleatoare (seed fixat) din licitațiile 5 și 103, verificate de om pe documentele originale, nu pe registru. Ținta: fals-pozitive `diferenta` < 5%.

### 6.4 Cost și siguranță
- a doua extragere pe aceeași versiune = 0 apeluri (cache);
- plafonul refuză înaintea apelului;
- două extrageri concurente pe aceeași felie: una e refuzată;
- `x-radar-secret` pe modul structurat = refuz;
- scrierea `service_role` peste observații, comparații sau snapshot = refuzată de trigger.

### 6.5 Teste
- unit, Deno / vitest: DN, cheie, dedup, praguri, reguli de audit;
- harness SQL: tabele, RLS, imuabilitate, rezervări, cerere, înghețare;
- paritate H2.

## 7. Plan pe PR-uri (fiecare: review Jakarinos + Copilot conv. 3, draft, merge prin chat cu „da”)

| PR | Conținut | BD | Cost AI |
|---|---|---|---|
| PR1 | această specificație | — | — |
| PR0b | `raspuns-set inventar` sub poarta owner/responsabil (scăpare de cost existentă) | — | — |
| PR2 | migrarea: §4 integral + funcțiile (rezervă / deconteaza / abandonează, cerere, înghețare, decizie audit) + triggere de imuabilitate + harness SQL + revenire | **da** | — |
| PR3 | `_shared/dn.ts` (mutare + teste), roluri pe secțiune, extragere structurată, cache, rezervare per felie | — | doar la rulare, pe cerere activă |
| PR4 | familie / dedup / comparator + acoperire tri-state + H2 + tab Comparație + alias + înghețare UI + paritate | view H2 (migrare mică) | 0 |
| PR5 | clarificari-propune primește contradicțiile structurate | — | — |
| PR6 | audit pe reguli + UI decizie | — | 0 |
| Probe | §6.0 golden → §6.1 → §6.2 → §6.3, pe licitația 15 apoi pe o licitație activă | date reale doar cu „da” | estimat sub 2 USD pe Răcari |

## 8. În afara MVP
- AI în audit pentru cazurile `nedeterminabil`, după ce le vedem numărul.
- Propunere de corecție a registrului `ofertare_cantitati` din comparație, cu aprobare.
- Textul OCR local pentru documentele scanate (laboratorul OCR).
- Audit retroactiv pe licitațiile închise.

## 9. Decizii pentru Răzvan (A/B/C)

- **D1 — înghețarea analizei inițiale**
  - **A (recomandat):** automat la prima clarificare a noastră trimisă sau, dacă nu trimitem nimic, la termenul-limită de clarificări. Plus buton manual pentru responsabil.
  - **B:** doar manual.
  - **C:** la fiecare calcul, cu istoric.
- **D2 — modelul de extragere**
  - **A (recomandat):** gpt-5-mini, cu normalizarea deterministă după.
  - **B:** Sonnet 5.5 (de ~5–10× mai scump).
  - **C:** A, cu B doar pe feliile fără DN sau obiect.
- **D3 — plafonul pe cererea de extragere**
  - **A (recomandat):** 5 USD pe licitație (auditul nu costă în MVP), ridicabil de owner.
  - **B:** 10 USD.
  - **C:** alte valori.
- **D4 — întinderea MVP**
  - **A (recomandat):** doar lungimi (UM = m: conducte, branșamente, tuburi de protecție), cu DN și material.
  - **B:** toate cantitățile F3.
- **D5 — probele**
  - **A (recomandat):** golden Răcari (§6.0) făcut de om sau verificat de om, apoi o licitație activă cu termen de clarificări deschis.
  - **B:** direct pe o licitație activă.
