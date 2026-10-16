# TKT-2026-0329, varianta B: cantități structurate + audit al răspunsurilor Autorității

**Stare:** SPECIFICAȚIE v8 — **aprobată la review r8** (15.10.2026): Copilot GO, Jakarinos GO cu fix-uri (fără blocaj de schemă; fix-urile sunt obligații de implementare, §6.6).

Nimic nu e implementat. Migrările, deploy-urile și orice cost AI se fac doar cu „da” de la Răzvan.
**Decizie de pornire:** Răzvan, 14.10.2026, varianta B (`claude_context` #1758).
**Studii:** Jakarinos, `C:\Users\Public\paw-data\out\tkt0329_r1_jak.log`; harta codului din această sesiune (§2).

**Istoric:**
- **v1:** NO-GO de la amândoi (r1).
- **v2:** acoperire tri-state, rezervare per apel, identitatea articolului, DN cu parserul existent, perechi de roluri, audit pe dovezi fără AI, imuabilitate, lot canonic, golden. Tot NO-GO (r2): Jakarinos 9×P1, Copilot 8×P1.
- **v3**, schimbările (tot NO-GO, r3: Jakarinos 6×P1, Copilot 7×P1):
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
- **v4**, schimbările (tot NO-GO, r4: Jakarinos 5×P1, Copilot 4×P1):
  - originea și completitudinea textului: `sinteza_ai` nu e sursă de extragere și nici de verificare a citatelor;
  - perechea e `gata` doar cu sursa integrală, cel puțin o observație pe fiecare rol (sau decizie umană „verificat fără lungimi”) și cel puțin o cheie comună;
  - validitatea calculului include algoritmul, pragurile și extractorul;
  - rezervarea e o limită superioară demonstrabilă (octeți ≥ tokeni), iar o depășire blochează bugetul;
  - înghețarea materializează textele tuturor documentelor din manifest și lucrează as-of termen, cu `inghetat_tardiv`;
  - D1: trigger pe INSERT sau UPDATE, lacăt consultativ, `ON CONFLICT` care întoarce inițiala existentă, iar eroarea nu blochează clarificarea;
  - identitatea completă a subiectului (lot, tip lucrare, DN, material, obiect sau total, proprietate), fără wildcard;
  - „alegere între valori existente” ≠ modificare ulterioară;
  - poziția = offset absolut al citatului găsit în cod;
  - auditul e versionat pe rulare și pe hash-ul întrebării;
  - o singură decizie sau alias activ, serializat;
  - versiunea felierii și `sha_felie` intră în identitatea muncii.
- **v5**, schimbările (tot NO-GO, r5: Jakarinos 4×P1, Copilot 4×P1):
  - originea textului se stabilește numai din proveniență demonstrabilă: `pagini_procesate` (scris doar de ingest) sau marcaj explicit; textele vechi fără dovadă = `necunoscuta`, tratate ca sinteza;
  - proveniența e scoasă din rândul de conținut și pusă în `ofertare_doc_texte_prov`;
  - identitatea rândului = linia-sursă a unui citat localizat unic (citatele multiple → nedovedită);
  - observațiile se cer pe fiecare document al rolului, nu pe rol;
  - verdictul `incomplet` pe cheie, cu propagare la H2;
  - `modificare_ulterioara` cere absența demonstrată pe surse complete;
  - momentul D1 = termenul, pe orice cale, după termen;
  - snapshot în două faze (minimal + complet) pe calea de eroare;
  - asocierea întrebare–răspuns e dovedită prin localizare unică, ordine, delimitatori și numere;
  - identitatea perechii include răspunsul și poziția;
  - execuția auditului e separată de citire;
  - poziția feliei intră în identitatea muncii.
- **v6**, schimbările (tot NO-GO, r6: Jakarinos 3×P1, Copilot 3×P1):
  - originea textului = rând de proveniență scris de producător pe exact sha-ul (ingest, citire, planșă); contoarele nu mai sunt dovadă; textele vechi se folosesc doar cu `text_confirmat` uman;
  - identitatea articolului = intervale de citat suprapuse (citatele disjuncte pe aceeași linie = articole distincte);
  - deciziile au scope pe rol și secțiune;
  - snapshot imuabil + completări append-only;
  - clarificările și calculul sunt filtrate as-of `moment_referinta` (`trimisa_la` nou; data necunoscută nu e dovadă);
  - perechile Q&A se asociază pe blocuri de solicitare (antetul răspunsului e permis);
  - `modificare_ulterioara` cere absența dovedită prin căutare deterministă pe textul brut;
  - identitatea perechii e grupată pe Q+A, cu pozițiile ca listă.
- **v7**, schimbările (tot NO-GO, r7: Jakarinos 4×P1, Copilot 4×P1):
  - identitatea articolului = poziția tokenului cantității în sursă (`cantitate_offset`), cu valori brute în observație și grupare determinată în comparator;
  - absența e dovedită cu un parser numeric pe **tot** textul documentelor relevante (o fereastră locală dovedește doar prezența); efectele nenumerice → `nedeterminabil`;
  - jurnal imuabil al clarificărilor, cu textul exact la trimitere / răspuns; snapshot-ul reconstruiește din jurnal;
  - vedere efectivă canonică a completărilor;
  - `text_confirmat` e decizie pe document + sha;
  - un singur predicat `fn_ofertare_text_valid` pentru toate porțile.
- **v8**, schimbările:
  - `modificare_ulterioara` automat **doar** pentru `document_nou`, comparat prin comparator; un răspuns doar text → om. Dovada absenței din text liber iese din MVP;
  - prezența unei valori: agregare în comparator (totaluri neimprimate) sau parser cu toate interpretările și convenția documentului;
  - token ambiguu → `incomplet`;
  - jurnal: versiunea trimisă (din `trimisa`) e separată de status; un singur trigger, întâi jurnalul, apoi înghețarea;
  - predicatul de text pe document + sha;
  - deduplicarea pe offset doar dacă metadatele coincid, altfel `conflict_sursa`;
  - o singură funcție `pozitieDovedita()`.

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
- tabele: `ofertare_analiza_erori`, `ofertare_analiza_completari`, `ofertare_clarificari_jurnal`, `ofertare_doc_texte`, `ofertare_doc_texte_prov`, `ofertare_cant_extrageri`, `ofertare_cant_felii`, `ofertare_ai_buget`, `ofertare_ai_cereri`, `ofertare_ai_rezervari`, `ofertare_cant_obs`, `ofertare_cant_doc_decizii`, `ofertare_cant_alias`, `ofertare_cant_calcul`, `ofertare_cant_cmp`, `ofertare_analiza_versiuni`, `ofertare_audit_raspunsuri`;
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
- **`ofertare_doc_texte(licitatie_id, sha256, text, creat_la)`**, PK `(licitatie_id, sha256)`. Conține **doar conținutul**: textul exact folosit la o extragere și textul fiecărui document din manifestul unui snapshot (§5.3).
- **`ofertare_doc_texte_prov(id, licitatie_id, document_id, sha256, origine, completitudine, pagini_necitite, constatat_la)`**, append-only: proveniența unei apariții a textului. Se referă din manifestele calculelor și snapshot-urilor; nu se pune în rândul de conținut.
  - **`origine`**, stabilită **numai dintr-o dovadă legată de exact sha-ul textului**:
    - `transcriere`: există un rând de proveniență scris **de producător, în momentul scrierii**, cu `sha256(text)` egal. PR3 adaugă această scriere în `ofertare-ingest-doc` (după fiecare actualizare a `text_extras`). Contoarele (de ex. `pagini_procesate`) **nu** sunt dovadă: `ofertare-plansa-citeste` suprascrie `text_extras` cu „PLANȘĂ: … Rezumat citire AI” fără să le reseteze;
    - `sinteza_ai`: rând de proveniență scris de `document-nou-citeste` (forma din `scriere.ts`) sau de `ofertare-plansa-citeste` (forma `PLANȘĂ:` / `Rezumat citire AI`, `handler.ts:108`). PR3 adaugă scrierea în ambele;
    - `transcriere_confirmata`: un text vechi (fără rând de proveniență), confirmat de om pe exact acel sha, prin decizia `text_confirmat` (§4.4). UI-ul îi arată primele și ultimele pagini, alături de PDF;
    - `necunoscuta`: orice altceva.
    Doar `transcriere` și `transcriere_confirmata` pot fi sursă de extragere și de verificare a citatelor. Toate porțile folosesc **același predicat**, `fn_ofertare_text_valid(lic, document_id, sha)` = există pentru **acest document și acest sha** un rând de proveniență `transcriere` sau o decizie `text_confirmat` activă. Manifestul reține ID-ul exact al rândului sau al deciziei. Confirmarea documentului A nu validează documentul B cu text identic (test). Predicatul e folosit de: acoperirea (§5.0), extragerea (§5.1), `text_verificat` și căutarea de absență (§5.4). Test obligatoriu: ingest → citire de planșă care suprascrie textul → `sinteza_ai`, nu `transcriere`.
  - **`completitudine`:** `integral | partial` (din `pagini_necitite` și `status_procesare` la acel moment).
  - Nu are SELECT pentru `authenticated`; se citește doar prin `fn_ofertare_doc_text(lic, sha)`, cu `fn_are_acces_ofertare`. Așa nu există un magazin global de texte între licitații.
- **`ofertare_cant_obs`:**
  - **Proveniență:** `id`, `licitatie_id`, `document_id`, `doc_sha256`, `familie_id` (§5.2), `extragere_id`, `felie_nr`; lot canonic.
  - **Rol:** `rol_sursa` CHECK `f3 | c6 | lista_alt | atr | cs | fisa_date | memoriu | plansa | raspuns | alt`; `rol_decis_de` (`antet | marcaj | titlu | model | om`).
  - **Poziția articolului:**
    - `pagina` (din markerul absolut `⟦PAGINA n⟧` + `pagina_offset`), `cod_articol`, `denumire`;
    - `rand_interval` `[inceput, sfarsit)`: intervalul absolut al **liniei-sursă** (de la ultimul `\n` dinaintea citatului până la următorul `\n` după el) în textul documentului `doc_sha256`. Se calculează în cod, nu din numerotarea modelului;
    - `citat_interval` `[inceput, sfarsit)`: intervalul absolut al citatului în document;
    - `pozitie_dovedita` = true **numai dacă citatul apare exact o dată** în textul feliei (după normalizarea spațiilor). Două sau mai multe apariții → nedovedită;
    - **`cantitate_offset`:** poziția absolută, în document, a **tokenului numeric al cantității**. Se găsește în cod: în intervalul citatului se caută valoarea `cantitate` cu parserul numeric (§5.4). Citatul trebuie să conțină cantitatea.
      - `pozitie_dovedita` = true **numai dacă** citatul apare exact o dată în felie **și** în citat există exact un token numeric a cărui **interpretare unică**, după convenția documentului (§5.4, parserul), e egală cu `cantitate`, cu UM-ul lui.
      - Un token ambiguu (de ex. `3.995` într-un document fără convenție stabilită) → `valoare_ambigua`, iar cheia lui e `incomplet`.
      - Altfel → nedovedită.
      - O singură funcție, `pozitieDovedita()`, aplică toate condițiile (§5.1 o folosește).
    - **Identitatea articolului = `familie|doc_sha256|cantitate_offset`**: două observații sunt același articol **dacă și numai dacă** au același `cantitate_offset`. Fragmentele de context din citat nu contează.
      - Exemplu: `R1 Strada A 100 m; R2 Strada A 100 m` are două offseturi de cantitate distincte → 200 m, chiar dacă citatele se suprapun pe `R2`.
    - În observație se păstrează **doar valorile brute**: `rand_interval`, `citat_interval`, `cantitate_offset`. Nicio cheie derivată nu se persistă, deci nu depinde de ordinea extragerii.
  - **Tipul lucrării și măsura:**
    - `tip_lucrare` CHECK `conducta | bransament | protectie | alt`;
    - `masura` CHECK `lungime | montaj | proba | material | alt`.
  - **Obiect:** `obiect_brut`, `obiect_cheie`.
  - **Material și DN:** `material`, `dn_mm numeric[]`, `dn_model`, `dn_ambiguu`, `sdr`.
  - **Cantitate:** `um_norm`, `cantitate` (null ≠ 0), `e_total`, `e_subtotal`.
  - **Citat și extractor:** `citat` (≤ 300), `extractor_id` (= `model@prompt_ver@normalizator_ver@feliere_ver`), `hash_rand`.
  - Unic `(extragere_id, felie_nr, hash_rand)`.

### 4.2 Extrageri, felii, cache, blocarea muncii
- **`ofertare_cant_extrageri`:**
  - `id`, `licitatie_id`, `document_id`, `doc_sha256`, `familie_id`, `extractor_id`, `felii_total`;
  - `stare` (`in_lucru | gata | partial | esuat`), `obs_relevante` (numărul observațiilor cu UM = m), `cerere_id`, `pornit_de`, momentele de timp.
- **Cache:** unic `(document_id, doc_sha256, extractor_id)` pe `stare = gata`.
  - O extragere `gata` cu `obs_relevante = 0` rămâne `gata`, dar **nu poate susține singură o pereche `gata`** (§5.0).
- **Munca** = `munca_id` = `document_id:doc_sha256:extractor_id:de_la:sha_felie`, independent de extragere.
  - Poziția feliei (`de_la`) intră în identitate: două felii cu text identic în poziții diferite sunt munci diferite.
  - `sha_felie` e hash-ul textului feliei; versiunea felierii e în `extractor_id`.
  - **`ofertare_cant_felii`:** `munca_id`, `incercare` (implicit 1), `extragere_id`, `de_la`, `pana_la`, `sha_felie`, `stare` (`in_zbor | gata | esuat | necunoscut`), `rezervare_id`.
  - **Unic `(munca_id, incercare)`:** două extrageri pornite în paralel pe același document și aceeași felie primesc același `munca_id`. A doua inserare e refuzată înaintea oricărui apel.
  - O felie `necunoscut` sau `esuat` **nu se reia**. O reluare cere `incercare + 1`, creată doar de RPC-ul de decizie umană (owner / responsabil), cu motiv.
  - Reluarea unei extrageri trece doar prin feliile fără `gata`.

### 4.3 Cheltuiala: buget pe licitație, cerere, rezervare per apel
- **`ofertare_ai_buget(licitatie_id, scop, plafon_usd, blocat)`**, PK `(licitatie_id, scop)`, cu `scop ∈ (cant_extragere, audit_raspunsuri)`.
  - Plafonul vine din D3: 5 / 3 USD. Îl poate ridica doar owner-ul, prin RPC, iar istoricul se păstrează.
  - **Plafonul e pe licitație și scop, comun tuturor cererilor.**
- **`ofertare_ai_cereri`:** `id`, `licitatie_id`, lot canonic, `scop`, `aprobat_de`, `aprobat_la`, `valabil_pana`, `stare`.
  - O creează doar owner-ul sau responsabilul.
  - Orice cheltuială cere o cerere `activa`, inclusiv pentru worker-ul NAS sau orice proces automat. Secretul tehnic nu ține loc de acord.
- **`ofertare_ai_rezervari`:** `id`, `cerere_id`, `licitatie_id`, `scop`, `munca_id`, `incercare`, `suma_rezervata`, `stare`, `cost_real`, momentele de timp.
  - `suma_rezervata` = o **limită superioară demonstrabilă**:
    - tokenii de intrare ≤ octeții UTF-8 ai promptului + datelor, pentru că un token de text are cel puțin un octet; regula e folosită deja la arbitrajul OCR;
    - tokenii de ieșire ≤ `max_tokens`;
    - prețul e tariful din cod pentru `model`.
    Nicio reîncercare și niciun fallback automat.
  - **Depășire:** dacă `cost_real > suma_rezervata` (tarif schimbat la furnizor), `deconteaza` înregistrează costul real, **blochează bugetul** licitației și scopului (`ofertare_ai_buget.blocat = true`, deblocabil doar de owner) și întoarce semnal de depășire. Nu se continuă tăcut.
  - Unic `(munca_id, incercare)` **în toate stările**: același apel nu poate primi a doua rezervare, nici după `necunoscuta`.
- **Consumul plafonului**, o singură formulă canonică (`fn_ofertare_ai_consum(lic, scop)`), testată pe fiecare stare:
  `consum = Σ cost_real (decontata) + Σ suma_rezervata (deschisa | necunoscuta | abandonata)`.
- **Funcții:**
  - `rezerva(cerere, munca_id, incercare, suma)`: `FOR UPDATE` pe `ofertare_ai_buget` (rândul licitației și scopului) → verifică `consum + suma ≤ plafon` → inserează.
  - `deconteaza(id, cost_real, tokeni)`: o singură dată.
  - `marcheaza_necunoscuta(id)`.
  - `abandoneaza(id)`: după 15 min, rămâne socotită.

### 4.4 Decizii umane: documente și aliasuri
- **`ofertare_cant_doc_decizii(licitatie_id, document_id, doc_sha256, rol, sectiune, decizie, de, la, motiv, revoca_id)`**, cu `decizie ∈ (nu_e_sursa_cantitativa, rol_confirmat, verificat_fara_lungimi, sursa_partiala_acceptata, text_confirmat)`.
  - `sectiune` = intervalul de pagini sau caractere vizat (`*` = tot documentul).
  - `verificat_fara_lungimi` pe `*` e permis doar când **toate** secțiunile cu rol ale documentului au 0 observații; altfel decizia se ia pe secțiune.
  - **`text_confirmat`** e decizie de **proveniență**: se ia pe `(document_id, doc_sha256)`, cu `rol` și `sectiune` = NULL obligatoriu (CHECK); o singură decizie activă per document și sha.
  - **O singură decizie activă** per `(document_id, doc_sha256, rol, sectiune, clasa)`. RPC-ul serializează pe cheie (`pg_advisory_xact_lock`) și revocă explicit decizia anterioară. Scope-ul complet intră în `decizii_manifest`.
  - Un document eligibil cu rol nerezolvat (`alt` sau `model` neconfirmat) ține acoperirea `incomplet` până la o decizie aici (§5.0).
- **`ofertare_cant_alias(id, licitatie_id, cheie_a, cheie_b, confirmat_de, la, revoca_id)`:** append-only; o revocare e un rând nou.
  - Perechea se păstrează canonic (`cheie_a < cheie_b`), cu o singură relație activă per pereche. Lanțurile se rezolvă la o cheie reprezentativă determinată (cea mai mică), serializate prin RPC.

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
  - `acoperire jsonb` (pe perechi, §5.0), `amprenta` (sha256 canonic peste tot ce e mai sus, **inclusiv** `algoritm_versiune`, `praguri` și `extractor_id` cerut), `creat_la`.
- **`ofertare_cant_cmp`**, imuabil, câte un rând per (calcul, pereche de roluri, cheie):
  - `calcul_id`, `cheie`, `rol_a`, `rol_b`;
  - `val_a`, `val_b`, `obs_a[]`, `obs_b[]`;
  - `delta_abs`, `delta_rel`;
  - `verdict` CHECK `concordant | diferenta | lipsa_a | lipsa_b | conflict_sursa | neasociat | incomplet` (`incomplet` = cheia are rânduri cu poziție nedovedită în suprapunere sau un document fără observații în acel rol); `motiv_incomplet`;
  - o pereche cu cel puțin o cheie `incomplet` **nu poate fi `gata`** pentru H2 (se propagă `incomplet`);
  - `importanta`.

### 4.6 Snapshot-ul analizei
- **`ofertare_analiza_versiuni`**, imuabil:
  - `id`, `licitatie_id`, lot canonic;
  - `tip` (`initiala | recalcul`), `declansator` (`clarificare_trimisa | termen_clarificari | manual`), `clarificare_declansatoare_id`;
  - `inghetata_la`, `inghetata_de`;
  - `doc_manifest_curent` (documentele eligibile **as-of** `moment_referinta`, cu sha, `origine`, `completitudine`; textul fiecăruia e materializat în `ofertare_doc_texte` în aceeași tranzacție; dacă textul nu e disponibil → `text_indisponibil` pe document);
  - `moment_referinta` și `inghetat_tardiv` (bool), după regula din §5.3;
  - rândul de snapshot conține **doar** manifestul (ID + sha + proveniență) as-of și clarificările as-of. E integral imuabil.
- **`ofertare_analiza_completari(id, snapshot_id, texte jsonb, calcul_id, coerenta, stare, motiv, creat_la)`**, append-only:
  - materializarea textelor și legătura cu calculul se adaugă ca rânduri noi;
  - **vederea efectivă**, canonică:
    - pentru fiecare sha din manifest se ia textul din cea mai recentă completare validă care îl conține (textul e același pentru același sha);
    - snapshot-ul e `complet` dacă toate sha-urile manifestului sunt acoperite;
    - calculul asociat = cel din cea mai recentă completare cu `coerenta = calcul_curent`, altfel niciunul.
    Vederea e funcția `fn_ofertare_snapshot_efectiv(id)`. Rezultatul ei (ID-ul completărilor folosite) intră în amprenta execuției auditului;
  - o reluare adaugă un rând nou, doar pentru sha-urile din manifest, fără să rescrie nimic.
  - (legătura cu calculul și coerența stau în `ofertare_analiza_completari`, mai jos);
  - `acoperire`;
  - `clarificari jsonb`: clarificările **noastre** **as-of `moment_referinta`**, reconstruite **numai din jurnal**.
    - **`ofertare_clarificari_jurnal(id, clarificare_id, licitatie_id, eveniment, text, text_sha256, la)`**, append-only, imuabil. `eveniment ∈ (trimisa, raspunsa, retrasa)`.
    - Îl scrie un trigger pe `ofertare_clarificari` la INSERT / UPDATE de status, cu **textul exact al întrebării în acel moment**.
    - **Versiunea trimisă și statusul sunt separate:**
      - **textul** = textul din **ultimul eveniment `trimisa`** cu `la ≤ moment_referinta`; doar evenimentul `trimisa` îngheață versiunea trimisă;
      - **statusul as-of** = ultimul eveniment de orice tip cu `la ≤ moment_referinta`. `raspunsa` / `retrasa` schimbă doar statusul, nu versiunea.
      - O editare locală după trimitere nu atinge versiunea trimisă. Dacă se retrimite, apare un eveniment `trimisa` nou, cu textul nou.
    - Clarificările fără eveniment `trimisa` în jurnal (cele vechi, de dinainte de PR2, sau cele al căror prim eveniment e `raspunsa`) apar cu `versiune_necunoscuta` și **nu pot servi** drept dovadă `deja_observat` (→ `nedeterminabil`).
    - **Ordinea:** un **singur trigger** pe `ofertare_clarificari` (`fn_trg_clarificari_jurnal_ingheata`) inserează întâi evenimentul în jurnal, apoi, dacă e cazul, cheamă înghețarea, în aceeași tranzacție. Evenimentul declanșator e astfel vizibil snapshot-ului. Test dedicat.
    - Clarificarea declanșatoare intră în conținut doar dacă evenimentul ei `trimisa` are `la ≤ moment_referinta`; altfel e doar metadată (`clarificare_declansatoare_id`).
    - Teste:
      - trimisă înainte de termen → înghețare eșuată → editată și trecută în `raspunsa` după termen → înghețare tardivă: snapshot-ul conține textul trimis inițial;
      - trimisă cu textul A → editată local în B → `raspunsa`, toate înainte de termen: snapshot-ul conține A, cu status `raspunsa`;
      - clarificare veche al cărei prim eveniment e `raspunsa`: `versiune_necunoscuta`;
  - `amprenta`.
- Unic `(licitatie_id, lot_domeniu, lot_nr)` WHERE `tip = 'initiala'`.

### 4.7 Auditul
- **`ofertare_audit_raspunsuri`:**
  - **Context:** `id`, `licitatie_id`, lot, `versiune_analiza_id`, `document_id`, `doc_sha256`.
  - **Proveniența citirii:** `citire_sursa_tip` (`pdf | text`), `citire_sursa_sha`, `citire_completa`.
  - **Citirea:** `citire_id` = `document_id` + `citire_sursa_sha` + `citit_la`.
  - **Execuția auditului:** `executie_id` = `citire_id` + `regula` (versiunea regulilor) + amprenta dovezilor disponibile (calcul / simulare / texte). O execuție nouă pe aceeași citire, de pildă după completarea dovezilor, e permisă. `inlocuieste_id` leagă rezultatul aceleiași perechi din execuția anterioară.
  - **Perechea:** perechile cu același `sha(întrebare normalizată + răspuns normalizat)` se grupează întâi. `pereche_id` = acel sha, cu `pozitii[]` (lista canonică, sortată, a intervalelor dovedite) și `multiplicitate`.
  - `intrebare_text`, `raspuns_text`, `text_verificat`, `asociere_dovedita` (bool, §5.4).
  - **Ancore și efect:** `ancore jsonb`, `efect`.
  - **Clasificare:** `clasificare`, `cauza`, `regula`.
  - **Dovezi:** `dovezi_istoric jsonb` (ID-uri din snapshot) și `dovezi_simulare jsonb` (`calcul_id` cu `tip = simulare` + ID-uri `cmp` din el). Funcția de scriere verifică apartenența fiecărui ID.
  - **Decizia omului:** `decizie_om`, `decis_de`, `decis_la`, `nota`, doar prin `fn_ofertare_audit_decide`.
- Unic `(versiune_analiza_id, executie_id, pereche_id)`. Rezultatele succesive sunt rânduri imuabile noi; UI arată ultima execuție, cu istoricul.

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
  2. textul lor trece `fn_ofertare_text_valid` (`transcriere` sau `transcriere_confirmata`) cu `completitudine = integral`, sau există o decizie `sursa_partiala_acceptata`. Un text `sinteza_ai` sau `necunoscuta` nu se extrage și ține perechea `incomplet`;
  3. **niciun document eligibil nu are rol nerezolvat** (`alt` fără decizie `nu_e_sursa_cantitativa`, sau `model` neconfirmat);
  4. **fiecare document (și fiecare secțiune cu rol) eligibil al celor două roluri are cel puțin o observație relevantă.** Altfel decide omul, cu `verificat_fara_lungimi` pe **acel** document. Exemplu: F3-A cu observații și F3-B cu 0 → `incomplet` până la decizia pe F3-B;
  4b. nicio cheie a perechii nu are verdict `incomplet`;
  5. **există cel puțin o cheie comparabilă** între cele două roluri. Perechea fără nicio cheie comună e `incomplet`, niciodată `concordant`.
  Altfel perechile sunt `incomplet`, cu lipsurile afișate pe document și pe motiv.
- **Calculul curent e valid** doar dacă un manifest curent, calculat pe server (documente eligibile + sha + origine / completitudine + extrageri + aliasuri active + decizii **+ `algoritm_versiune`, pragurile și `extractor_id` cerute de codul activ**), are amprenta egală cu cea a calculului. Altfel calculul e `depasit`: un comparator sau un extractor nou invalidează H2 și clarificările până la recalcul sau re-extragere.
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
  - **Poziția:** `pozitieDovedita()` (§4.1) — citat unic în felie **și** token de cantitate unic, cu interpretare unică. Altfel `pozitie_dovedita = false`: rândul nu poate fi deduplicat, iar dacă e în zona de suprapunere, cheia lui primește `incomplet` (§5.2).
  - **`tip_lucrare` și `masura`:** valoarea modelului, verificată cu reguli pe denumire (`bransament` → `bransament`; `tub de protectie` → `protectie`; `montaj` / `proba` / `furnizare` → `masura`). La dezacord câștigă regula, iar rândul se marchează.

### 5.2 Comparația deterministă (PR4)
- **Familia de documente:**
  - versiunile se leagă prin `seap_meta.inlocuieste_id` / `cod_anterior`;
  - părțile aceluiași fișier, prin `— pNN_pagA-B` (212 și 213 = părți complementare ale listei de cantități).
  - În comparație intră doar ultima versiune; părțile complementare se unesc.
- **Deduplicarea se face doar pe repetarea aceleiași poziții:**
  - observațiile cu poziție dovedită și **același `cantitate_offset`** (din felii suprapuse) se grupează. Se comasează într-o observație **numai dacă toate câmpurile semantice coincid** (obiect_cheie, DN, material, tip_lucrare, masura, UM, valoare). Orice dezacord → `conflict_sursa` pe cheile implicate, fără să se aleagă o variantă. Gruparea se face determinist, la fiecare calcul, și intră în manifest. Offseturile diferite = observații distincte;
  - un rând cu poziție nedovedită în zona de suprapunere → cheia lui primește `incomplet` (posibil dublat).
  - Teste obligatorii:
    - un tabel tăiat între două felii;
    - același rând citat diferit în două felii → o observație;
    - două rânduri identice ca text pe linii diferite → două observații, sau `incomplet` dacă nu se pot localiza unic;
    - două articole distincte pe aceeași linie, cu aceeași valoare → două observații, **inclusiv când citatul primului se întinde peste al doilea** (`R1 Strada A 100 m; R2` / `R2 Strada A 100 m`);
  - **valorile egale în poziții diferite NU sunt duplicate** (două poziții de câte 100 m pe aceeași stradă = 200 m);
  - dacă același `cantitate_offset` are valori sau metadate diferite → `conflict_sursa`.
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
  1. același trigger unic (`AFTER INSERT OR UPDATE OF status`, după scrierea în jurnal), când o clarificare a noastră ajunge în `trimisa` (inclusiv INSERT direct `trimisa` pentru clarificările depuse extern, `OfertareClarificari.jsx`) și nu există încă o inițială → `fn_ofertare_analiza_ingheata(..., 'clarificare_trimisa', clarificare_id)`. Clarificarea declanșatoare intră în snapshot;
  2. la termenul-limită de clarificări, dacă nu există încă o inițială (indiferent dacă există clarificări trimise): rutina Ofertare cheamă înghețarea cu `termen_clarificari` și **`moment_referinta` = termenul**;
  3. butonul manual (responsabil).
- **Concurență și idempotență:**
  - funcția ia `pg_advisory_xact_lock(hash(lic, lot))`, apoi `INSERT … ON CONFLICT DO NOTHING` și **întoarce inițiala existentă** fără eroare;
  - înghețarea are două faze:
    1. **minimală**, doar SQL simplu: inserează rândul imuabil al snapshot-ului (manifest as-of + clarificări as-of). Fără ea nu există snapshot;
    2. **completare**: un rând în `ofertare_analiza_completari` (textele + calculul), într-un sub-bloc separat. Dacă eșuează, rândul de snapshot rămâne (snapshot fără completare = „minimal”), iar o reluare adaugă o completare nouă.
    - Teste: succes complet; eșec în faza 2 cu snapshot păstrat; reluare care adaugă completarea fără să rescrie nimic.
  - în trigger, o excepție prinsă după faza 1 lasă snapshot-ul minimal. Dacă eșuează și faza 1, eroarea intră în `ofertare_analiza_erori` și **niciodată** nu blochează actualizarea clarificării. Atunci UI-ul arată „analiza inițială nepăstrată” pentru acel lot;
  - test: două clarificări trecute concurent în `trimisa` și o înghețare manuală anterioară → o singură inițială, ambele clarificări trimise.
- **`moment_referinta`, pe orice cale** (trigger, rutină, buton): dacă termenul-limită de clarificări a trecut și nu există încă o inițială, `moment_referinta` = termenul-limită și `inghetat_tardiv = true`. Altfel `moment_referinta` = acum.
  - Test: clarificare înregistrată `trimisa` după termen, înaintea rutinei → snapshot as-of termen, marcat tardiv.
- **As-of:** manifestul cuprinde doar documentele și versiunile existente la `moment_referinta` (`created_at` / `seap_meta.publicat` ≤ `moment_referinta`). Dacă rularea are loc după termen și un document a fost reprocesat între timp, documentul e marcat `text_indisponibil` (nu se folosește textul nou), iar snapshot-ul are `inghetat_tardiv = true`.
- **Funcția nu refuză niciodată.** Păstrează realitatea:
  - `doc_manifest_curent` = documentele eligibile **as-of `moment_referinta`**;
  - `coerenta` (în completare):
    - `calcul_curent`: există un calcul valid pe același manifest **și** `creat_la ≤ moment_referinta`. Un calcul creat după `moment_referinta` nu e dovadă istorică, chiar dacă manifestul coincide: intră la simulare;
    - `calcul_depasit`: există un calcul, dar documentele s-au schimbat;
    - `fara_calcul`.
  - Cu `calcul_depasit` / `fara_calcul`, acoperirea snapshot-ului e `incomplet`.
- **Materializarea textelor:** în aceeași tranzacție, textul fiecărui document din manifest se copiază în `ofertare_doc_texte` (cu origine și completitudine), inclusiv documentele fără extragere. Simularea retrospectivă (§5.4) folosește **doar** aceste texte. Documentele `text_indisponibil` sunt excluse din simulare, care se marchează `simulare_partiala`.
- Recalculurile sunt `tip = recalcul`. Fără AI.

### 5.4 Auditul răspunsurilor (PR6; MVP = reguli + om)
- **Input:** perechile din `citire_noi.intrebari_raspunse` ale documentelor `raspuns_clarificare` apărute după snapshot.
- **Proveniența, verificată după tipul sursei** (ca în `document-nou-citeste/sursa.ts`):
  - `pdf` → `sursa_sha256` = sha-ul PDF-ului din `ofertare_seap_fisiere` / Storage;
  - `text` → `sha256(trim(text_extras))`.
  - `citire_completa = false` → auditul marchează documentul „citit parțial”, iar clasificarea maximă e `nedeterminabil`.
- **`text_verificat`:** întrebarea și răspunsul produse de model se caută ca subșir, după normalizarea spațiilor, **doar** într-un text care trece `fn_ofertare_text_valid` pentru aceeași versiune (sha) a documentului. Un text `sinteza_ai`, adică rezumatul și perechile modelului, nu e niciodată sursă de verificare: fără transcriere, `text_verificat = false`.
  - Găsite → `true`.
- **`asociere_dovedita`:**
  - întrebarea și răspunsul trebuie localizate **unic** în aceeași transcriere, cu răspunsul **după** întrebare;
  - documentul se împarte determinist în **blocuri de solicitare**: un bloc începe la un antet `Solicitarea nr. N` / `Întrebarea N` și se termină la următorul antet de solicitare **cu alt număr**. Antetul `Răspuns solicitarea nr. N` aparține blocului N;
  - întrebarea și răspunsul trebuie să fie în **același bloc**, întrebarea înaintea antetului de răspuns, iar răspunsul după el;
  - un document fără antete numerotate are un singur bloc. În el se acceptă doar o pereche unică; altfel asocierea e nedovedită.
  - Altfel asocierea e nedovedită → perechea primește doar `nedeterminabil`.
  - Test pozitiv: `Solicitarea nr. 1 / întrebare / Răspuns solicitarea nr. 1 / răspuns` → dovedită.
  - Test negativ: întrebarea 1 cu răspunsul 2 din același document → nedovedită.
  - Altfel → `false`: perechea nu poate primi automat `omisiune` sau `deja_observat`, doar `nedeterminabil` + cerere de verificare umană.
- **Ancore**, deterministe. **Identitatea subiectului** = lot + `tip_lucrare` + DN + material (când apare) + obiect (pentru proprietatea „lungime pe obiect”) sau „total” (pentru proprietatea „total pe DN”) + proprietatea. Cifrele cu UM servesc doar la găsirea candidaților.
  - O dimensiune critică lipsă (lot, tip lucrare sau DN) **nu e wildcard**: regula nu se aplică, iar perechea merge la `nedeterminabil`.
- **Clasificarea, în ordine:**
  1. **`deja_observat`:** o clarificare **a noastră** din snapshot (`trimisa` / `raspunsa`) are **aceeași identitate de subiect**, completă (vezi Ancore). Similaritatea textului găsește candidații; confirmarea cere identitatea. `cauza = intrebat_de_noi`.
  2. **`modificare_ulterioara`, în MVP doar `cauza = document_nou`:**
     - o versiune nouă a unui document din familie (`seap_meta.inlocuieste_id`), apărută după `moment_referinta`, are pe **aceeași cheie** o valoare diferită de versiunea din snapshot;
     - ambele versiuni au extragere completă (acoperire `gata` pe cheie, fără `incomplet` sau `conflict_sursa`), iar textul lor trece `fn_ofertare_text_valid` cu `completitudine = integral`. O sursă parțială nu ajunge, nici cu `sursa_partiala_acceptata`;
     - comparația se face prin comparator (sume pe cheie, inclusiv totaluri obținute prin agregare), nu prin căutare de text.
     - Un răspuns **doar text** care pare să schimbe ceva (fără document nou) **nu** primește automat `modificare_ulterioara`: merge la regula 3, apoi la `nedeterminabil`, pentru om. „Dovada absenței” din textul liber nu se automatizează în MVP.
     - **Prezența unei valori** (folosită de regula 3 și de alegerea între valori existente) se stabilește în două feluri:
       - comparatorul: suma pe aceeași cheie din snapshot egală cu valoarea, inclusiv totaluri **neimprimate**, de ex. ATR 2.000 + 1.995 = 3.995;
       - **parserul numeric** (`_shared/numar.ts`) pe textul valid. Parserul întoarce **toate interpretările** unui token și aplică **convenția documentului**: dacă documentul are forme neambigue `1.234,56`, punctul înseamnă mii; dacă are `1,234.56`, invers; altfel un token `3.995` rămâne ambiguu, cu interpretările {3995, 3,995}. O interpretare compatibilă cu valoarea + UM ajunge pentru „prezentă”.
     - Teste:
       - ATR cu 2.000 + 1.995 fără total, răspunsul confirmă 3.995 → prezentă prin agregare, deci nu e modificare;
       - `3.995 m` în sursă și răspunsul `3,9950 m` → interpretare compatibilă, plus cazul în care sensul e 3995;
       - document nou cu altă valoare pe aceeași cheie → `modificare_ulterioara / document_nou`.
     - Dacă valoarea din răspuns **exista deja** în unul dintre roluri (de ex. Răcari: răspunsul confirmă 3.995 din ATR, iar F3 avea 6.400), răspunsul **alege între valori existente**: nu e modificare ulterioară și trece la regula 3.
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

**Textele lor sunt vechi** (scrise înainte de rândurile de proveniență), deci pentru probă primesc `text_confirmat` de la om, pe sha, sau se re-ingestează după PR3. **Documentele de intrare** (verificate în BD pe 15.10): Fișa 201, CS 198 + CS revizuit 318, ATR = paginile marcate din „Pth … part.1 — p01” (214), F3 = părțile 212 + 213 (familia „Liste de cantitati fara valori”), răspunsul nr. 1 (316).

### 6.1 Proba nouă (extracție + comparație)
Pe golden se măsoară separat:
- recall-ul cheilor;
- false-match;
- `neasociat`;
- fals-pozitivele `diferenta`;
- precizia valorilor.

Ținte: recall ≥ 15/16 străzi Dn 90, false-match 0, verdicte corecte pe toate cheile asociate. Ținta factuală, de confirmat pe golden: 13 `diferenta`, 3 `concordant`, total F3 6.400 / ATR 3.995, Dn 32 Δ ≈ 87 m.

### 6.2 Proba istorică (audit)
- **Snapshot A, „istoric”** (regula 2 nu se aplică: 3.995 exista în ATR/CS/Fișă): cum eram (0 observații, 7 clarificări, `fara_calcul`, acoperire `incomplet`). Pe doc 1624, solicitarea 7 / răspunsul 16, auditul face un calcul `simulare` pe sha-urile din snapshot. Rezultatul trebuie să fie `omisiune / analiza_incompleta`, cu dovada în `dovezi_simulare`, etichetată „simulare retrospectivă”.
- **Snapshot B, „nou fără întrebare”:** analiza nouă, cu calcul valid, fără clarificare de lungime. Dă `omisiune / detectat_neintrebat`, cu dovezi istorice.
- **Snapshot C, „nou cu întrebare”:** o clarificare a noastră pe aceleași ancore (obiect / total Dn 90 + proprietatea „lungime”). Dă `deja_observat`.
- **Negative:**
  - o clarificare a noastră cu aceleași cifre (Dn 90, 100 m), dar pe altă stradă, NU dă `deja_observat`;
  - una pe aceeași stradă, dar despre branșamente Dn 32, NU dă `deja_observat` pentru conducta Dn 90;
  - una despre totalul Dn 90 pe alt lot NU dă `deja_observat`.
- **Proveniență:** o pereche Q&A care apare doar într-un text `sinteza_ai` are `text_verificat = false` → `nedeterminabil`.

### 6.3 Fals-pozitive pe alte licitații
Eșantion definit: 50 de chei aleatoare (seed fixat) din licitațiile 5 și 103, verificate de om pe documentele originale, nu pe registru. Ținta: fals-pozitive `diferenta` < 5%.

### 6.4 Cost și siguranță
- a doua extragere pe aceeași versiune = 0 apeluri (cache);
- plafonul refuză înaintea apelului;
- două extrageri concurente pe aceeași muncă (document + sha + extractor + felie): a doua e refuzată înaintea apelului; o felie `necunoscut` nu primește a doua rezervare;
- două cereri de câte 5 USD pe aceeași licitație nu permit mai mult de 5 USD (plafon pe licitație); rezervările `necunoscuta` intră în consum;
- un calcul depășit (document nou după calcul, sau `algoritm_versiune` / `extractor_id` nou) dă H2 `necalculat`, nu verde;
- F3 și ATR cu 0 observații relevante, sau fără nicio cheie comună → perechea `incomplet`, niciodată verde;
- un document cu `completitudine = partial` (fără decizie) → perechea `incomplet`;
- o depășire `cost_real > suma_rezervata` blochează bugetul (test cu tarif simulat);
- `x-radar-secret` pe modul structurat = refuz;
- scrierea `service_role` peste observații, comparații, calcule sau snapshot = refuzată de trigger; tranzițiile de stare nepermise = refuzate;
- `ofertare_doc_texte` nu e citibil direct de `authenticated`.

### 6.5 Teste
- unit, Deno / vitest: DN, cheie, dedup, praguri, reguli de audit;
- harness SQL: tabele, RLS, imuabilitate, rezervări, cerere, înghețare;
- paritate H2.

### 6.6 Obligații de implementare (review r8: Copilot GO, Jakarinos GO cu fix-uri; se închid în review-urile pe cod)
- **PR2:**
  - atomicitatea jurnal → înghețare: evenimentul declanșator e vizibil snapshot-ului;
  - izolarea `text_confirmat`: același sha în documentele A și B, doar A confirmat → B rămâne nevalidat.
- **PR3** (`pozitieDovedita()` + parser):
  - **orice** cantitate fără dovadă numerică (de ex. sursa are `100 m`, modelul dă `1000 m`) ține cheia `incomplet`, **indiferent de zona de suprapunere**, și nu intră în agregare;
  - convenții numerice contradictorii în același document (`1.234,56` și `1,234.56`, apoi `3.995 m`) păstrează ambiguitatea → cheia `incomplet`; testul se face și cu ordinea secțiunilor inversată;
  - testul de agregare folosește o convenție demonstrabilă (`2.000,00 m + 1.995,00 m`). Fără convenție, rezultatul corect e `incomplet`.
- **PR4:**
  - conflictul semantic la același offset, **inclusiv** pe `e_total` / `e_subtotal` (detaliu vs total) → `conflict_sursa`, independent de ordinea observațiilor;
  - propagarea `incomplet` până la H2.
- **PR6:** un răspuns doar text și sursele parțiale nu produc automat `modificare_ulterioara`.

## 7. Plan pe PR-uri (fiecare: review Jakarinos + Copilot conv. 3, draft, merge prin chat cu „da”)

| PR | Conținut | BD | Cost AI |
|---|---|---|---|
| PR1 | această specificație | — | — |
| PR0b | `raspuns-set inventar` sub poarta owner/responsabil (scăpare de cost existentă) | — | — |
| PR2 | migrarea de bază: §4 integral (17 tabele, cu `ofertare_analiza_erori`, `ofertare_doc_texte_prov`, `ofertare_analiza_completari` și `ofertare_clarificari_jurnal` + triggerul pe `ofertare_clarificari`), funcțiile (buget, cerere, rezervă / deconteaza / necunoscută / abandonează, decizii, înghețare + trigger D1, scrierea auditului, decizie audit), triggere de imuabilitate și stări, harness SQL, revenire | **da** | — |
| PR3 | `_shared/dn.ts` (mutare + teste), rândurile de proveniență scrise de producători (`ofertare-ingest-doc` → transcriere; `document-nou-citeste` și `plansa-citeste` → sinteza_ai), roluri pe secțiune, extragere structurată, cache, rezervare per felie | — | doar la rulare, pe cerere activă |
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
