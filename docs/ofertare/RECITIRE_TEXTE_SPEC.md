# Recitirea textelor documentelor (Haiku 4.5 → Haiku 5.5) — specificație v1

Stare: **propunere (PR draft, doar documentație)**. Fără migrare aplicată, fără deploy, fără cost și fără scrieri în BD până la GO-urile
review-ului (Copilot + Jakarinos, două runde) și la „da”-ul lui Răzvan pe preview-ul cu cifre.

## 1. De ce

Laboratorul de citire a arătat că textele listelor de cantități scanate, citite cu `claude-haiku-4-5`, pierd 44–63 % din cantități și
inventează pagini. `ofertare-ingest-doc` citește din 15.10.2026 (commit `6f8a22c`) cu `claude-haiku-5-5`, dar textele vechi au rămas
în `ofertare_documente_atribuire.text_extras`. Cantitățile B (TKT-0329) și orice probă plătită pe ele ar măsura textul stricat.
Răzvan a aprobat recitirea cu Haiku 5.5 (16.10). Primul val cuprinde DOAR listele de cantități.

## 2. Principii

1. **Nimic nu se pierde.** Textul vechi se arhivează în `ofertare_doc_texte`, tabelul content-addressed și imuabil din 20261031a, ÎNAINTE să fie înlocuit.
   Snapshot-urile și auditurile care țin sha-ul vechi rămân reproductibile.
2. **Citirea e separată de aplicare.** Recitirea produce un text NOU în arhivă, alături de cel vechi. Documentul nu se schimbă până la
   decizia owner-ului, luată per document, după raportul de comparație.
3. **Aplicarea e CAS.** Textul se înlocuiește numai dacă `text_extras` are EXACT sha-ul din plan (`sha_vechi`), sub lock-urile
   din 20261031b (licitație `FOR KEY SHARE` → document `FOR NO KEY UPDATE`). Altfel răspunsul e `text_depasit` și nu se scrie nimic.
4. **Proveniența e cea din 31b.** Textul nou primește `ofertare_doc_texte_prov` cu `origine = 'transcriere'` și producătorul `recitire-haiku-5-5`, în
   aceeași tranzacție cu înlocuirea. Textul vechi NU primește proveniență, pentru că nu știm cum a fost produs, deci nu devine „valid” pentru B.
5. **Invalidarea vine din chei, nu din ștergeri.** Tot ce ține de cantitățile B e legat de `doc_sha256`. Deciziile (`text_confirmat`, roluri),
   extragerile și observațiile făcute pe sha-ul vechi încetează să se aplice documentului de la sine, dar rămân ca istoric. Nu se șterge nimic.
6. **Banii trec prin poartă.** Recitirea o pornește doar owner-ul. Fiecare apel AI rezervă suma estimată sub lock-ul valului, iar
   rezervarea se decontează după apel. Un rezultat necunoscut rămâne rezervat, deci plafonul nu se poate depăși (fail-closed).

## 3. Primul val: listele de cantități (preview, cifre din BD, 16.10, read-only)

Există 27 de documente `tip = lista_cantitati` cu text, în total 505 pagini. Ele se împart după cine a produs textul:

| Grup | Documente | Pagini | Cine a citit | În val |
|---|---|---|---|---|
| A. citite de AI cu Haiku 4.5 (`ai_usage_log`) | 137, 138, 139 (lic. 3); 165, 166, 167, 168, 169, 170, 171 (lic. 5); **212, 213 (lic. 15)**; 434 (lic. 93) | 385 | `ofertare-ingest-doc`, `claude-haiku-4-5-20251001`; costul inițial 2,53 USD | DA, recitire AI |
| B. copii ale lic. 5 în lic. 103 | 1288, 1289, 1290, 1291, 1292, 1293, 1294 | 120 | fără apel AI propriu; text identic (md5) și aceeași mărime cu 165–171 | DA, refolosire fără AI, DOAR dacă sha256 al PDF-ului e identic |
| C. extrase cu pdftotext de NAS | 1605–1611 (lic. 3) | — | worker NAS, fără AI | NU (nu e citire Haiku) |

**Date derivate pe cele 20 de documente din val (A+B), toate 0:**

| Dată derivată | Câte |
|---|---|
| `ofertare_cerinte` (din care confirmate) | 0 (0) |
| `ofertare_cantitati` (F3 vechi) | 0 |
| `ofertare_clauze_contract` | 0 |
| `ofertare_triere` | 0 |
| `ofertare_raspuns_set_doc` | 0 |
| decizii și extrageri B | 0 |

Toate cele 20 de documente au `status_procesare = procesat` și `pagini_necitite` gol.

**Cost estimat.** Haiku 5.5 costă 0,10 / 0,50 USD pe milion de tokeni (intrare / ieșire), sub pragul de 100k tokeni pe cerere; tabelul de prețuri e în
`_shared/ocrLocal.ts`. Asta înseamnă ~1/10 din prețul Haiku 4.5. Cele 385 de pagini au costat 2,53 USD cu Haiku 4.5, deci recitirea ar costa ~0,25 USD.
Cu marjă pentru ieșire mai lungă (tabele transcrise complet) și pentru reluările la `max_tokens`, **plafonul propus pentru val e 1,00 USD**.
Copiile din grupul B costă 0.

## 4. Model de date (migrarea `20261101a_ofertare_recitire`, NEAPLICATĂ până la „da”)

Toate tabelele noi au RLS activ. Citirea e permisă doar cu `fn_are_acces_ofertare()`; scrierea se face DOAR prin funcțiile de mai jos.

```
ofertare_recitiri            -- valul
  id, nume, plafon_usd (0 < p ≤ 10, 2 zecimale), model ('claude-haiku-5-5'), stare ('deschis' | 'inchis'),
  creat_de (owner), creat_la
ofertare_recitire_doc        -- un document din val
  id, recitire_id, document_id, licitatie_id, sha_vechi (sha256 text_extras la planificare),
  pdf_sha256 (setat de edge, din octeții PDF-ului), sursa_refolosire_id (alt rând din același val, același pdf_sha256),
  stare ('planificat' | 'in_citire' | 'citit' | 'aplicat' | 'respins' | 'esuat' | 'depasit' | 'revenit'),
  pagini_procesate, text_partial (acumulat între invocări, șters la „citit”), sha_nou, completitudine ('integral' | 'partial'),
  pagini_necitite int[], raport jsonb (comparația, §6), cost_usd, decis_de, decis_la, motiv,
  UNIQUE (recitire_id, document_id)
ofertare_recitire_rezervari  -- un apel AI
  id, recitire_doc_id, incercare, suma_rezervata, cost_real, stare ('deschisa' | 'decontata' | 'necunoscuta'), creat_la, inchisa_la,
  UNIQUE (recitire_doc_id, incercare)
```

Fiecare tranziție de stare trece printr-o funcție care verifică starea veche (ca `fn_ofertare_cb_tranzitie`). Rândurile `aplicat` și `revenit` sunt
imuabile.

## 5. Funcții

| Funcție | Cine | Ce face |
|---|---|---|
| `fn_ofertare_recitire_planifica(p_nume, p_plafon_usd, p_docs jsonb)` | **owner** | Creează valul. `p_docs = [{document_id, sha_vechi}]`, fiecare `sha_vechi` egal cu sha-ul curent (altfel refuz, nimic creat). Refuză documentele fără text, de tip `plansa`, cu extragere B `in_lucru` sau aflate deja într-un val deschis. |
| `fn_ofertare_recitire_rezerva(p_recitire_doc_id, p_incercare, p_suma)` | service_role | Ia valul `FOR UPDATE`. Consumul (decontat + deschis + necunoscut) plus suma trebuie să încapă în plafon, altfel `{refuz: 'plafon'}`. |
| `fn_ofertare_recitire_deconteaza(p_rezervare_id, p_cost)` / `_necunoscuta(p_rezervare_id)` | service_role | Închide rezervarea. Un cost necunoscut rămâne socotit la valoarea rezervată. |
| `fn_ofertare_recitire_progres(p_recitire_doc_id, p_pagini_procesate, p_text_partial, p_pdf_sha256)` | service_role | Salvează progresul între invocări. Rândul trebuie să fie în `in_citire`. La prima invocare se fixează `pdf_sha256`; dacă alt rând are deja același `pdf_sha256`, mai târziu nu se poate schimba. |
| `fn_ofertare_recitire_text_pune(p_recitire_doc_id, p_text, p_completitudine, p_pagini_necitite, p_raport)` | service_role | Pune textul nou în `ofertare_doc_texte` (content-addressed) și trece rândul în `citit` cu `sha_nou`. **Nu atinge documentul.** |
| `fn_ofertare_recitire_refoloseste(p_recitire_doc_id, p_sursa_id)` | service_role | Copia din grupul B: sursa e în același val, e `citit` sau `aplicat` și are ACELAȘI `pdf_sha256`. Copia primește `sha_nou` și raportul sursei, cu cost 0. |
| `fn_ofertare_recitire_aplica(p_recitire_doc_id, p_sha_nou)` | **owner** | Tranzacție unică, pașii la §7. |
| `fn_ofertare_recitire_respinge(p_recitire_doc_id, p_motiv)` | **owner** | Trece rândul din `citit` în `respins`. Textul nou rămâne în arhivă, nefolosit. |
| `fn_ofertare_recitire_revino(p_recitire_doc_id)` | **owner** | CAS pe `sha_nou`: dacă documentul are încă textul recitit, pune înapoi textul vechi din arhivă, fără proveniență, și trece rândul în `revenit`. Altfel `text_depasit`. |

Funcțiile sunt `SECURITY DEFINER SET search_path = public, pg_temp`. EXECUTE: owner-ul (verificat cu `is_owner` în corp) prin
`authenticated`; cele service_role sunt revocate de la PUBLIC / anon / authenticated.

## 6. Citirea (edge: `ofertare-ingest-doc`, mod nou `recitire`)

- **Cine o pornește:** doar un JWT de **owner**. Fără `x-ingest-secret`: secretul tehnic nu ține loc de acord. Corpul cererii: `{mod: 'recitire', recitire_doc_id}`.
- **PDF-ul:** se descarcă din bucket-ul `ofertare` (`fisier_path`), cu limita de 60 MB, și se calculează sha256 pe octeți.
  - Dacă un rând din același val cu același `pdf_sha256` e deja `citit`, se apelează `refoloseste` și nu se face niciun apel AI.
  - Dacă nu, se citește cu **Haiku 5.5, forțat pentru acest mod**: aceleași felii de 8 pagini, aceleași prompturi și marcaje `⟦PAGINA N⟧`, aceeași înjumătățire la `max_tokens`.
- **Banii:** fiecare apel AI trece prin `rezerva` → apel → `deconteaza`, iar un rezultat incert se închide cu `necunoscuta`. Progresul se salvează după fiecare felie; cel mult 2 apeluri pe invocare, ca la ingest.
- **Ce nu face edge-ul:**
  - nu trece prin `ofertare_ingest_garda_rezultat`;
  - nu scrie `ofertare_documente_atribuire`;
  - nu schimbă `status_procesare`.
- **Raportul de comparație**, salvat în `raport` la `citit`. Se calculează determinist, fără AI, cu `_shared/cantNumar.ts`:
  - lungimea textului, vechi și nou;
  - paginile cu marcaj găsite, față de `pagini`, plus paginile necitite;
  - numărul de tokeni numerici și numărul de cantități cu unitatea `m` (vechi și nou);
  - suma cantităților în `m` pe document (vechi și nou);
  - paginile din textul vechi fără corespondent în PDF (marcaje peste `pagini` = pagini inventate).

## 7. Aplicarea (`fn_ofertare_recitire_aplica`, owner, per document)

O singură tranzacție, cu ordinea lock-urilor din 31b:

1. Lock pe rândul `ofertare_recitire_doc`, care trebuie să fie `citit`, iar `sha_nou` trebuie să fie egal cu parametrul. Așa owner-ul aplică exact textul din raportul pe care l-a văzut.
2. Lock pe licitație `FOR KEY SHARE`, apoi pe document `FOR NO KEY UPDATE`.
3. CAS: sha256(`text_extras`) trebuie să fie `sha_vechi`. Altfel rândul trece în `depasit` și răspunsul e `{refuz: 'text_depasit'}`.
4. Refuz (`extragere_in_lucru`) dacă există o extragere B `in_lucru` pe acest document.
5. Arhivează textul vechi: `INSERT INTO ofertare_doc_texte … ON CONFLICT DO NOTHING`, fără proveniență.
6. `UPDATE ofertare_documente_atribuire`:
   - `text_extras` = textul nou;
   - `pagini_necitite` = cele ale recitirii;
   - `status_procesare` = `procesat` la integral, `partial` altfel;
   - `procesat_la` = `now()`.
7. Pune proveniența: `INSERT ofertare_doc_texte_prov`, cu `origine = 'transcriere'`, producătorul `recitire-haiku-5-5`, completitudinea și paginile necitite.
8. Trece rândul în `aplicat` (cu `decis_de` / `decis_la`) și scrie în `raport.derivate` numărătorile datelor derivate găsite în acel moment (§3). Pentru val sunt 0.
   Nu se șterge și nu se recalculează nimic. Cerințele confirmate se invalidează singure, pentru că amprenta lor (`fn_ofertare_cerinta_amprenta`) conține `procesat_la`.

**Efecte asupra TKT-0329 B:**
- `text_confirmat` pe sha-ul vechi nu mai contează. Textul nou e valid direct prin proveniența `transcriere`, deci nu mai cere `text_confirmat`. Dacă e parțial, cere în schimb `sursa_partiala_acceptata`.
- Pentru proba de pe lic. 15 rămâne de setat plafonul `cant_extragere`. Poarta de cerere e cea din 31a, iar extragerea pornește pe sha-urile noi.

## 8. Ce NU face mecanismul

- Nu recitește altceva decât lista explicită a valului. Valul 2 (celelalte tipuri, ~950 de documente) e un plan separat, cu preview propriu.
- Nu recitește planșele, care au fluxul lor (`ofertare-plansa-citeste`), nici documentele cu text pdftotext sau docx.
- Nu șterge nimic: textele, deciziile, extragerile și snapshot-urile vechi rămân.
- Nu trimite mailuri și nu atinge drepturi.

## 9. Teste (harness PG16, ca `scripts/test_ofertare_cantitati_b.sh`)

- **planifica:** refuză un sha_vechi greșit, un val dublat sau un ne-owner.
- **Bani:** rezerva respectă plafonul sub concurență (2 sesiuni), iar `necunoscuta` rămâne socotită.
- **text_pune:** nu schimbă `ofertare_documente_atribuire`. Verificat prin hash pe rând, înainte și după.
- **refoloseste:** refuză un pdf_sha256 diferit sau un alt val.
- **aplica:**
  - CAS cu text schimbat între timp → `depasit`;
  - extragere `in_lucru` → refuz;
  - textul vechi e în arhivă, cu `CHECK` pe sha;
  - proveniența e pe sha-ul nou;
  - `fn_ofertare_cb_text_valid` devine valid pe sha-ul nou, iar deciziile pe sha-ul vechi nu se mai aplică;
  - concurența cu `fn_ofertare_cb_text_scrie` și cu `fn_ofertare_cb_extragere_incepe_grup` nu produce deadlock (3 sesiuni).
- **revino:** CAS pe sha_nou; după revenire textul vechi nu e valid pentru B.
- **Edge (Deno, cu mock-uri):**
  - fără JWT de owner → 403;
  - cu `x-ingest-secret` → refuz;
  - refolosire fără AI;
  - plafonul atins oprește valul înainte de apel;
  - reluarea după 2 apeluri.

## 10. Livrare propusă

1. Acest PR, doar specificația, intră în review: Copilot + Jakarinos, două runde.
2. PR cod: migrarea `20261101a` + revenirea + harness-ul + modul `recitire` în ingest-doc. Review tot în două runde. Merge-ul îl face chat-ul.
3. **Cu „da” de la Răzvan:**
   - apply-ul migrării;
   - deploy-ul `ofertare-ingest-doc`;
   - `planifica` cu exact lista de la §3 și plafonul de 1,00 USD.
4. Citirea pornită de owner: întâi 212 și 213, apoi restul valului. Raportul de comparație (§6) ajunge la chat, cu cifrele per document.
5. `aplica` per document, cu „da”-ul lui Răzvan pe raport.
6. Apoi proba plătită B pe lic. 15, pe sha-urile noi.
