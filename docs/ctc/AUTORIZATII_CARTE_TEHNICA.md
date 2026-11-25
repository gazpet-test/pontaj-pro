# CTC — autorizațiile sudorilor pentru cartea tehnică (TKT-2026-0389)

Tab-ul „🪪 Autorizații” din CTC: autorizațiile de sudor (angajați și personal extern), doar citire, fără acces la modulul HR.
Piese: migrarea `supabase/migrations/20261222b_ctc_autorizatii_citire.sql` (revenirea în `supabase/revenire/`), funcția edge
`ctc-autorizatie-fisier`, ecranul `src/ctc/CtcAutorizatii.jsx`. Probe: `scripts/pglite/test_ctc_autorizatii_local.mjs`,
`src/ctcAutorizatiiMigrare.test.js`.

## Scanul, pe fiecare rând

| Valoarea `scan` din listă | Ce vede utilizatorul în CTC |
|---|---|
| `atasat` (fișier pe autorizație) | butonul „Deschide” — link semnat de 60 de secunde, într-o filă nouă |
| `dosar_personal` (dovada e doar documentul din dosarul personal) | „scanul e în dosarul personal — cere HR să-l atașeze la autorizație”, fără buton; deasupra tabelului, câte astfel de autorizații sunt |
| `lipsa` | „fără scan” |

Dosarul personal NU se deschide din CTC (nicio semnare în alt bucket). Când HR atașează fișierul la autorizație, rândul trece singur pe
„Deschide”.

## Firmele de control nedistructiv (NDT) — 20270111a

A doua secțiune a tab-ului, „🔬 Firme de control nedistructiv”: autorizațiile firmelor care fac radiografia, ultrasunetele etc., doar
citire, fără acces la modulul Ofertare. Specificația: `docs/superpowers/specs/2026-11-25-ctc-autorizatii-ndt-design.md` (v4).
Piese: migrarea `supabase/migrations/20270111a_ctc_autorizatii_ndt.sql` (revenirea în `supabase/revenire/`, lista obiectelor L15 în
`supabase/tests/20270111a_ctc_autorizatii_ndt.l15.obiecte.tsv`, dry-run-ul pentru clonă în `supabase/tests/20270111a_ctc_autorizatii_ndt_dryrun.sql`),
ramura `ndt_document_id` a funcției edge `ctc-autorizatie-fisier`, ecranele `src/ctc/CtcAutorizatii.jsx` și `src/OfertareParteneri.jsx`.
Probe: `scripts/pglite/test_ctc_autorizatii_ndt_local.mjs`, `src/ctcAutorizatiiNdt.test.js`, `src/CtcAutorizatiiNdt.test.jsx`.

- **Introducerea:** Ofertare → Parteneri → firma → „📎 Documente” → categoria „🔬 Autorizație control nedistructiv (NDT)”; câmpul
  „Metoda (RT/UT/PT/MT/VT)”. Fișierul se urcă în `parteneri/<firmă>/ndt/`. Schimbarea categoriei unui document cu fișier (în sau din NDT)
  cere un fișier nou („Pentru categoria nouă, încărcați din nou fișierul (se mută în dosarul potrivit)”); cel vechi se șterge după salvare.
- **Garda din BD** (trigger pe `ofertare_parteneri_documente`, toate căile de scriere): NDT = exact `parteneri/<firma rândului>/ndt/<nume>`;
  altă categorie = nu sub `ndt/`; fără segmente `.` / `..`, backslash, `%`, caractere de control (lista explicită U+0001–U+001F și
  U+007F–U+009F, aceeași în BD, edge și ecran, independentă de colaționarea bazei), cale goală (doar spațiu / tab / LF / VT / FF / CR);
  o cale nu poate fi a două documente (index unic). Spațiile, diacriticele și lungimea numelui sunt permise.
- **În CTC:** firma, CUI, nr., emitent, metoda, datele, starea (Valabilă / Expirată / Valabilitate necunoscută, după ziua din România) și
  „Deschide scanul” doar când documentul are fișier. Calea, observațiile și contactul firmei NU ajung în CTC.
- **Deschiderea:** RPC-ul dă calea doar pentru un document NDT cu calea în forma de mai sus (altfel 404, același răspuns pentru
  „nu există” / „nu e NDT” / „fără fișier”); edge-ul reverifică forma cu EXACT regula din BD (fără firmă, pe care o verifică RPC-ul) și
  semnează 60 s în bucket-ul `ofertare`: orice cale pe care o întoarce RPC-ul se semnează (de ex. `scan cu spatii.pdf`, diacritice, nume
  lung). Regula e probată pe tabelul comun `supabase/tests/20270111a_ctc_autorizatii_ndt_cazuri_cale.json` (trigger + RPC în PGlite,
  edge + ecran în vitest) și pe căi aleatoare trecute prin trigger, RPC și codul edge-ului în aceeași probă. Ramura sudorilor e neschimbată.

### Ordinea livrării NDT (coordonatorul)

1. **Proba pe clonă PG17**: manifestul `scripts/livrare_l15_manifest.sh --iesire` (trebuie să conțină exact obiectele din lista revizuită),
   apoi apply → `supabase/tests/20270111a_ctc_autorizatii_ndt_dryrun.sql` (ROLLBACK, `DRY 20270111a TOTUL OK`) → revenire → re-apply.
2. **Migrarea** pe producție: `scripts/livrare_migrare.sh … --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale supabase/migrations/20270111a_ctc_autorizatii_ndt.l15.tsv`.
3. **Funcția edge** `ctc-autorizatie-fisier` v2, cu `verify_jwt = true`. Probele după publicare:

   | Cerere | Așteptat |
   |---|---|
   | `{ "autorizatie_id": <sudor cu scan> }`, cont CTC | 200 (neschimbat) |
   | `{ "ndt_document_id": <NDT cu fișier> }`, cont CTC | 200 + `url` (60 s) |
   | `{ "ndt_document_id": <document non-NDT> }`, cont CTC | 404 |
   | `{ "ndt_document_id": … }`, cont fără CTC | 403 |
   | `{ "autorizatie_id": 1, "ndt_document_id": 2 }` | 400 |

4. **Merge** (aplicația). Test în ERP: un document NDT pe o firmă de test din Parteneri, apoi CTC → Autorizații → „Deschide scanul”.

| Starea | Ecranul |
|---|---|
| merge FĂRĂ migrare | secțiunea NDT: „Secțiunea nu e încă activă…”; în Parteneri, categoria NDT e refuzată la salvare (CHECK-ul vechi), cu eroarea afișată |
| migrare + merge, FĂRĂ edge-ul nou | lista apare; „Deschide scanul” răspunde 400 (edge-ul vechi nu cunoaște cheia), mesajul se afișează |
| după revenire | ca „merge fără migrare”; edge-ul v2 răspunde 503 pe ramura NDT |

**Revenirea NDT** (ordinea: UI → edge fără ramura NDT → BD): refuză dacă există documente NDT sau căi în dosare `ndt/` (se lămuresc întâi
din Parteneri); verifică CHECK-ul, trigger-ul, indexul și detaliul complet al celor trei funcții; apoi CHECK-ul vechi, scoate trigger-ul,
funcția gărzii, indexul și cele două RPC-uri, și verifică absența lor. Revenirea 20261222b (sudorii) refuză cât timp 20270111a e aplicată.

## Ordinea livrării (coordonatorul)

1. **BASELINE**: `scripts/ctc_autorizatii_amprente.sql` pe producție (READ ONLY); coloana `linie_baseline` în blocul `BASELINE 20261222b`.
   Ultima secțiune dă numărătorile (atașat / dosar personal / lipsă).
2. **Proba pe clonă PG17**, prin runner, plafon 2000: apply → revenire → re-apply.
3. **Migrarea** pe producție: `scripts/livrare_migrare.sh … --plafon-tranzactie-ms 2000`.
4. **Funcția edge** `ctc-autorizatie-fisier`, cu `verify_jwt = true`.
5. **Probele după publicare** (cererea: `POST { "autorizatie_id": <id> }`):

   | Cerere | Așteptat |
   |---|---|
   | cont cu CTC, autorizație de sudor cu scan atașat | 200 + `url` (expiră în 60 s) |
   | cont fără CTC | 403 |
   | autorizație de alt tip (ex. ANRE) | 404 |
   | fără JWT | 401 |

6. **Merge** (deploy-ul aplicației vine automat). Test în ERP cu un cont CTC: lista, „Deschide”, rândurile „în dosarul personal”.

## Ce vede utilizatorul în stările intermediare

| Starea | Ecranul |
|---|---|
| după migrare, înainte de merge | nimic nou (aplicația veche nu are tab-ul) |
| după funcția edge, înainte de merge | nimic nou |
| după merge (ordinea de mai sus) | totul funcționează |
| merge FĂRĂ migrare | tab-ul spune „Secțiunea nu e încă activă (se activează odată cu actualizarea bazei de date).” |
| merge cu migrarea, FĂRĂ funcția edge | lista apare; „Deschide” spune „Deschiderea scanului nu e încă activă (se activează odată cu actualizarea serverului).” |
| după revenire | ca „merge fără migrare”; funcția edge răspunde 503 |

## Revenirea

Scoate doar cele trei funcții. Înainte, compară DETALIUL COMPLET al fiecăreia (tip, limbaj, definer, volatilitate, strict, leakproof,
proprietar, configurație, tipul întors, drepturi, corp) cu starea livrată; orice diferență (de exemplu un drept în plus) = refuz, cu
câmpurile care diferă, și nimic șters. Livrarea revenirii: tot prin runner, cu plafon (comanda e în antetul fișierului).
